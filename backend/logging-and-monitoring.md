# 结构化日志与指标：`console.log` 拼出来的字符串在排障第一步就输了

线上「下单偶尔转圈 5 秒」。你打开日志，看到的是这样的行：

```text
2026-10-18T03:14:23.054Z 203.0.113.7 usr_42 POST /api/resources 500 4.4ms "Mozilla/5.0 (Windows NT 10.0)" req_9f3c211ab0
```

然后你要回答三个问题：**哪个接口的 p95 涨了**、**那段时间 5xx 占比多少**、**受影响的是哪些用户**。三个都要「按字段分组再聚合」，而这行日志里唯一的结构是空格——`POST /api/resources` 中间那个空格让「第几个词是路由」当场失效。本章把这段日志和它的结构化版本各生成 20000 行实测过：**按空格取第 4 个词当路由，20000 行全部取错**（取到的是 HTTP 方法）；改成「找第一个以 `/` 开头的词」又把 `GET /api/resources` 和 `POST /api/resources` 合并成同一个端点，6 个真实路由只剩 4 组。你后面所有 grep、awk、Grafana 面板都建在这个基础上，基础错了结论就全错。

第二类故障更难查：日志里到底有没有明文密钥？本章第一版脱敏代码跑出来的是 `[email:4b1d1c80]' failed: … (password=hunter2)`——**按字段名脱敏管不住藏在 `err.message` 自由文本里的密钥**，同一次运行还漏了嵌套在 `user.session.id` 里的会话标识。7 个敏感值原文全部落进日志行，是我自己写的扫描脚本抓出来的。

第三类：你有一堆告警，但没有一条能说「用户正在受影响」。真正该响的是成功率与延迟分位数掉出 SLO，而分位数是从直方图桶里估出来的，**桶边界选错会让你在 SLO 达标时报警、或已经违规时静默**——50000 个样本实测，8 桶线性边界把 p95 从 80.8ms 估成 93.0ms（偏差 15.1%）。

前置：[统一错误处理](/backend/error-handling) 把 `requestId`、`cause` 序列化与「日志写全、响应写少」交给你，本章接上日志载体与指标；[Web 安全](/backend/web-security) 的结论是脱敏清单的前提——**日志是第三条数据泄露通道**，前两条是响应体和数据库。

## 手写一个 NDJSON logger：级别、request id、脱敏

输出格式先定死：**一行一个 JSON（NDJSON）**。机器可解析、能被任何采集器逐行转发、`tail -f` 人眼还能读。下面是本机跑过的实现骨架（只用 `node:` 内置模块；省掉 `child()`、非 Error 抛出的兜底分支、`scrubDeep` 的递归路径判定和 `SCRUB_TEXT` 的 8 条形状规则，其余逐字照抄）：

```js
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const SECRET = /(sessionid|authtoken|apikey|apisecret|password|clientsecret|privatekey|authorization|cookie|cvv|otp|token)/;
const PII = /(email|mobile|phone|idcard|cardnumber|remoteaddr|clientip)/;
const H = (v) => createHash('sha1').update(String(v)).digest('hex').slice(0, 8);
// 按完整路径判定：user.session.id 这行的字段名只是 id，只看名字永远漏
const classify = (p) => { const f = '_' + p.join('.').toLowerCase().replace(/[_-]/g, '') + '_';
  return SECRET.test(f) ? 'secret' : PII.test(f) ? 'pii' : null; };
const als = new AsyncLocalStorage();                     // request id 就靠它贯穿全链路
export function makeLogger({ name = 'app', level = process.env.LOG_LEVEL ?? 'info', base = {}, sampleRate = {}, sink }) {
  const min = LEVELS[level], counters = new Map();
  const api = { emit(lv, msg, fields, err) {
    if (LEVELS[lv] < min) return false;                 // 级别过滤发生在序列化之前
    const every = sampleRate[lv];
    if (every) {                                        // 同一种消息每 every 条留 1 条，头一条一定留
      const k = lv + ':' + (msg ?? ''), n = (counters.get(k) ?? 0) + 1; counters.set(k, n);
      if (n % every !== 1) return false;
      fields = { ...fields, sample: n + 'of' + every };
    }
    const rec = { time: new Date().toISOString(), level: lv, name, ...(als.getStore() ?? {}), ...base };
    if (err) rec.err = { name: err.name, message: scrubText(err.message), code: err.code,
      cause: err.cause?.message && scrubText(String(err.cause.message)),
      stack: err.stack?.split(/\r?\n/).slice(1, 5) };   // 栈只截 4 行，与「栈只进日志」一致
    Object.assign(rec, scrubDeep(fields ?? {}));
    if (msg !== undefined) rec.msg = scrubText(msg);
    sink(scrubDeep(rec)); return true;                  // 生产环境请直接用 pino，别把这段搬上线
  } };
  for (const lv of Object.keys(LEVELS)) api[lv] = (m, f, e) => api.emit(lv, m, f, e);
  return api;
}
```

入口中间件生成一次 `reqId`、之后所有层不用传参：`await als.run({ reqId: 'req_9f3c211ab0' }, () => { log.info('db.query', { table: 'resources', sqlMs: 4.21, params: { userId: 'usr_42', email: 'zhang.san@example.com' } }); log.error('db.write.failed', { table: 'resources' }, new Error("insert owner 'zhang.san@example.com' failed: … (password=hunter2)", { cause: new Error('pool exhausted') })); })`。真实落出来的两行（同批另有 `debug` 级 `route.matched`、`warn` 级 `upstream.retry`、`info` 级 `req.out`，`req.out` 里的 `route` 是模板 `POST /api/resources/:id`）：

```text
{"time":"2026-10-18T03:14:23.054Z","level":"info","name":"api","reqId":"req_9f3c211ab0","table":"resources","sqlMs":4.21,"params":{"userId":"usr_42","email":"[redacted:4b1d1c80]"},"msg":"db.query"}
{"time":"2026-10-18T03:14:23.056Z","level":"error","name":"api","reqId":"req_9f3c211ab0","err":{"name":"Error","message":"insert into resources owner '[email:4b1d1c80]' failed: connect ECONNREFUSED 10.244.3.17:5432 (password=[redacted]","cause":{"name":"Error","message":"pool exhausted","code":"POOLSATURATED"}},"table":"resources","msg":"db.write.failed"}
```

三个设计决定：`reqId` 靠 `AsyncLocalStorage` 注入，异步分支和 `Promise.all` 里自动带上（手动传参漏一层就断链）；级别过滤在序列化之前，生产 `info` 时 `debug` 分支连 `JSON.stringify` 都不执行；PII 用 `sha1` 前 8 位摘要（仍可按值分组），密钥直接 `[redacted]`。注意 `ip` 第一版是摘要、第二版是明文——**这是策略选择不是技术结论**。

<Callout type="verified" title="本章 logger、聚合与分位数数字都在本机跑出">

Windows 10 x64 + Node v25.4.0，2026-10-18，`node backend/.scratch/lm-logger.mjs`，只用 `node:` 内置模块。如实交代边界：日志行写进内存数组后打印，**没有落盘**，文件轮转与并发写未验证；`reqId` 用固定值是为了可复现；聚合与分位数样本是合成的对数正态 + 1.5% 长尾（种子 20261018），不是真实流量。临时脚本已删除。

</Callout>

## 字符串拼接错在哪：一次 20000 行的对照实验

同一批流量（6 个路由、20000 行、字段完全相同）写成三种形态：空格分隔的一行、`k=v` 拼接、NDJSON；然后**假装自己是三个月后的你**，用「按空格取第 4 个词」「取第一个以 `/` 开头的词」「取等号前的键」三种规则读回来。

```text
  样本 N = 20000 行；真实路由种数 = 6
  按"第 4 个空格分词"当路由：种数 = 4，其中不以 / 开头的行数 = 20000/20000
  按"第一个以 / 开头的分词"当路由：种数 = 4（值 = /api/resources/:id | /api/resources | /api/users/me | /搜索）
  k=v 拼法：route 错 20000/20000 行（解析出 5 种）, status 错 0 行, ua 错 9927 行（种数 1 vs 真实 4）
  NDJSON JSON.parse 解析出的路由种数 = 6
  体积: 字符串 2.27 MB, NDJSON 4.44 MB (膨胀 95.9%)
  解析耗时: split 49.9 ms, JSON.parse 28.1 ms
  结构化之后才做得到：按路由聚合 POST /api/resources n=3390 p95=79.7 p99=123.7 5xx=197
  字段级过滤: status=503 且 route 含 ":id" 的行数 = 209
```

1. **positional 解析在这份数据上 100% 失败**，因为 `POST /api/resources` 自己就含空格；「第一个以 `/` 开头的词」看着能用，但它把方法丢了，`GET` 与 `POST` 同一路径变成同一个端点，per-endpoint SLO 从第一天起就是错的。
2. **`k=v` 不是结构化**。它只把失败点从空格挪到值里的空格：`ua=Mozilla/5.0 (Windows NT 10.0; Win64; x64)` 只能读出 `Mozilla/5.0`（9927 行读错），`route` 只能读出 `DELETE`。带空格、带 `=`、带引号的字段是默认情况（URL、SQL、User-Agent、异常原文），不是边角。别拿性能当借口：这次 `JSON.parse` 反而比带分支的 `split` 快（28.1 vs 49.9 ms），NDJSON 的真实代价只是体积 +95.9%。

## 级别与采样：让 debug 可以在生产打开

```text
  min=debug 实际写出 100 条 / 尝试 200 条；min=info 实际写出 200 条 / 尝试 300 条（debug 全被丢掉）
  info sink 里含 "level":"debug" 的行数: 0
  采样：1000 条 debug 调用 -> 写出 10 条；warn 不受采样影响: 1 条
  采样行样例: {"time":"...","level":"debug","name":"s","key":"k6","sample":"301of100","msg":"cache.miss"}
```

那 200 次尝试只写出 100 条，是因为 100 条 `trace` 低于门槛被丢——**级别是「门槛」不是「标签」**，写日志的人常反过来理解：先打日志再看级别。采样两个要点：**按消息形状采样**而不是按全局比例（`sampleRate = { debug: 100 }` 是「同一种 debug 每 100 条留 1 条」，否则高频循环会挤掉你真正想看的稀有 debug）；**保留 `sample: "301of100"`**，看日志的人必须知道这条代表 100 条，否则他会用 10 条样本算出「命中率 10%」——需要精确率的东西一律走指标。

## 哪些字段必须脱敏：字段名不够，还得管路径和自由文本

第一版只按字段名脱敏，扫描脚本当场报了 7 个明文泄露：

```text
A 只脱敏顶层字段名 password 的产物:
  {"...","email":"li@example.org","password":"[redacted]","user":{"session":{"id":"sid_abc123def456"}},
   "card":{"number":"6222021234567890123"},"dsn":"postgres://app:S3cr3tPw@10.244.3.17:5432/main",
   "note":"联系 zhang@example.com 或 13812345678","msg":"auth failed for li@example.org password=hunter2 ..."}
  泄露: hunter2 | S3cr3tPw | sid_abc123def456 | 6222021234567890123 | li@example.org | zhang@example.com | 13812345678

B 路径脱敏 + 自由文本正则后:
  {"...","email":"[redacted:9b7856c8]","password":"[redacted]","user":{"session":{"id":"[session:1b82a847]"}},
   "card":{"number":"[card:318a90b9]"},"dsn":"postgres://[user]:[pass]@10.244.3.17:5432/main",
   "note":"联系 [email:23d0cf2d] 或 [mobile:1cc0e18d]",
   "msg":"auth failed for [email:9b7856c8] password=[redacted] issuer=postgres://[user]:[pass]@10.244.3.17:5432/main"}
  B 仍泄露的值: 无（0 个）
```

| 动作 | 挡住什么 | 本次实测的证据 |
| --- | --- | --- |
| 按**完整路径**判定 | 嵌套对象里的凭据，字段名只是 `id` | A 漏 `sid_abc123def456` → B `[session:1b82a847]` |
| 对**自由文本**做形状匹配 | 第三方库拼进 `err.message` 的秘密 | A 漏 `password=hunter2` → B `password=[redacted]` |
| 连接串单独处理（留 host、抹掉 user:pass） | 排障要知道打到哪台库，凭据不需要 | `postgres://[user]:[pass]@10.244.3.17:5432/main` |

抄进评审清单的三分法：**必须 `[redacted]`**——密码与其哈希、OTP、`Authorization`/`Cookie`、token、session id、API key、卡号与 CVV、私钥、请求体文件内容、连接串口令；**可留哈希**（可分组不可还原）——邮箱、手机号、身份证号、用户 ID、设备指纹、IP（按合规口径）、文件名；**可留原文**——时间戳、level、`reqId`、路由模板、方法、状态码、耗时、服务与版本、错误 `name`/`code`、SQL 的参数化模板。

还要单独强调「路由模板 vs 实际 URL」：`/order/13812345678` 直接把手机号写进每一行——**记 `route`（模板），别记 `url`**，见「常见错误」第 1 条。同理，Fastify/pino 默认会把 `req.headers` 整个序列化，`cookie`、`authorization` 就进去了，这类库的默认字段必须显式覆盖。

<Callout type="unverified" title="pino 与 Fastify 的集成写法未在本机运行">

本机没有 pino 也没有 fastify（本章不装依赖），所以以下**一行都没执行**：pino 的 `redact: { paths: [...], censor: '[Redacted]' }` 路径语法、level 运行时热切换、Fastify 用 `loggerInstance` 接管默认日志。能力确实存在，但**选项名与通配写法请以 [pino 官方文档](https://getpino.io/) 与 [Fastify Logger 文档](https://fastify.dev/docs/latest/Reference/Logger/) 当前版本核对**。生产环境直接用 pino，但要拿上面那张「按路径判定」的表去验证你的 pino 配置是否真盖住了嵌套字段——配置错的人多半以为已经盖住了。

</Callout>

## 可观测三支柱：logs / metrics / traces 各自回答什么

- **日志**：这一次具体发生了什么、哪个用户、什么参数。答不了整体趋势（要扫全部行），成本与流量线性。
- **指标**：这段时间整体怎么样、p95 多少。答不了单个请求的细节（值已被聚合掉），成本与**标签基数**相关而几乎与 QPS 无关。
- **链路**：时间花在哪一跳、哪个下游慢。答不了业务参数与错误原因，跨服务改造贵（本章未实测，需要多服务环境）。

三者是**漏斗**不是三选一：指标告诉你「03:14 起 `POST /api/resources` 的 p95 从 80ms 涨到 900ms、5xx 从 0.7% 涨到 4%」→ 链路或访问日志定位到「慢在 `sms` 下游」→ `grep reqId` 拿到那一行完整错误与栈。没有指标你不知道该 grep 什么；只有日志没有指标，告警就得跑全文扫描（等它跑完用户已经投诉了）。`reqId` 是胶水，跨服务时升级成 W3C Trace Context 的 `traceparent` 原样下传，单体内不需要。

## 指标类型：counter 只能增、gauge 可增可减、histogram 是累计桶

```text
  请求 counter 累计 = 300（只能增，进程重启归零 → 必须用 rate() 看）
  队列 gauge 当前 = 180（可增可减，重启后由采集器重新读真实值）
  histogram le=[10,50,100,500] 累计计数 = [2,4,5,6], sum=1138 n=7 → mean=162.57
  时间序列基数 = le 桶数 + 2（sum 与 count）
```

[Prometheus 官方指标类型文档](https://prometheus.io/docs/concepts/metric_types/)（2026-10-18 WebFetch 核对）：counter「单调递增」，gauge「可增可减」，histogram「用带 `le` 标签的桶分组，含隐含 `+Inf` 桶」，两者都额外暴露 `_sum` 与 `_count`，**summary 在客户端算分位数、histogram 在服务端算**。两个语义坑：

- `le` 桶是「小于等于该边界的累计数」，不是这一档的独立计数：`[2,4,5,6]` 表示 `<=10` 有 2 个、`<=50` 有 4 个且含那 2 个，**做差才是区间数**。
- counter 不能看绝对值：`300` 重启后归零，跨重启求差会得到负数，面板一律 `rate()` / `increase()`。
延迟该用哪个：官方说 histogram 更省，且 summary 的客户端分位数**不能跨实例合并**（两个 pod 的 p95 平均起来不是整体 p95），多实例必须用 histogram。

## 分位数：平均值骗人，桶边界再骗一次

```text
  n=50000  mean=50.22ms  p50=30.24  p90=63.31  p95=80.79  p99=580.14  p99.9=2531.26  max=6804.60
  低于均值 mean 的样本占比 = 81.5%
```

**81.5% 的请求比「平均延迟」更快**。看板只写「平均 50ms」，那 1.5%（750 个）慢到 1～7 秒的请求被完全抹平，而它们恰好是「用户投诉」的那批。P50 答典型体验，P95 答常见偏差，P99/P99.9 答尾部与偶发故障——三个都要，但**告警只挂 P95/P99 与错误率**。

把同一数据集塞进固定边界桶，再用桶内线性插值反算分位数：

```text
  线性 8 桶  le=[5,10,25,50,100,250,500,1000]
     p50 真30.2/估32.5(7.5%)   p90 真63.3/估77.3(22.1%)   p95 真80.8/估93.0(15.1%)   p99 真580.1/估611.1(5.3%)
     +Inf 桶样本数=297 (0.59%)
  对数 11 桶  le=[1,2,5,...,1000,2000]：p50 真30.2/估34.0(12.5%)，其余三档与上面完全一样

  SLO "p95 <= 100ms"：真实 p95=80.8 → 达标；8 桶线性估计 p95=93.0 → 达标（偏差 15.1%）
  同一 SLO 换成命中率口径 = 97.21% 请求 <= 100ms，可直接用 le 桶计数算，不需要插值
  le 最大桶是 1000ms，超过它的全进 +Inf，插值只能报 1000 —— 尾部被硬截断
```

1. **插值假设分布均匀，延迟分布从不均匀。** p90 估高 22.1% 因为它落在 `50..100` 这个宽桶里，p99 只错 5.3% 因为 580 落在 `500..1000`。同一个直方图误差随分位点跳——**桶边界要覆盖 SLO 阈值附近**，把 `le` 设成 SLO 值本身（100），这个 SLO 就能避开插值改用命中率口径。
2. **+Inf 截断是静默的。** 真实 max 6804ms，8 桶直方图永远报不出超过 1000 的值。要么把边界拉到 SLO 的 10 倍，要么补一条 `requests_slow_over_2s_total` counter。
更贴近进程本身：`perf_hooks.monitorEventLoopDelay` 在同一个人为阻塞 5×60ms 的负载下只改 `resolution`——20ms 分辨率的窗口里 `min=20.20 p50=31.44 p90=60.13 p99=60.26`，1ms 分辨率的同一负载是 `min=0.13 p50=15.71 p90=16.10 p99=60.13`。两次都是 5 次 60ms 阻塞，但 20ms 档的 `min` 就是 20.20ms——**低于分辨率的延迟根本测不到**，这是量具的桶太宽，不是程序变慢。计时同理：同步 20 万次 `sqrt` 的 `hrtime` 差 4399900 ns（4.3999 ms），同区间 `Date.now` 只差 4 ms；`await sleep(5ms)` 实测 9.402 ms（Windows 定时器粒度）。**耗时一律 `hrtime.bigint()`（纳秒、单调），时间戳一律 UTC ISO**——`Date.now()` 会被 NTP 回拨和夏令时打穿，见[文件上传、定时任务与后台作业](/backend/uploads-and-jobs)的 DST 一节。

## RED 与 USE：一组面向用户，一组面向资源

| 方法 | 展开 | 适用 | 本章的对应实测 |
| --- | --- | --- | --- |
| RED | **R**ate 速率、**E**rrors 错误、**D**uration 时长 | 每个对外接口 | 按路由的 n、5xx、p95/p99 |
| USE | **U**tilisation 利用率、**S**aturation 饱和度、**E**rrors | 每个资源（CPU、内存、连接池、队列） | 事件循环延迟、`rss`（[第 13 章](/backend/uploads-and-jobs)实测 235MB）、`POOLSATURATED` |

RED 是 SLO 的来源：`rate(requests_total[5m])`、`sum(5xx)/sum(all)`、`histogram_quantile(0.95, ...)`；**USE 用来解释 RED 为什么掉了**，不拿来到处告警。Node 最特殊的资源是事件循环：CPU 30% 看着毫无压力，但一次同步 60ms 的序列化会让这段时间**所有**请求排队——这正是 `monitorEventLoopDelay` 的 p99 从 15ms 跳到 60ms 的含义。**饱和度比利用率更能杀死 Node 进程**，务必单独出一个指标（`nodejs_eventloop_lag_p99_seconds` 之类）；连接池等待队列、上传并发与 `rss`、任务积压同理。

## 告警要基于症状，不是原因

一条判据：**这个指标异常时用户完全没受影响，就不该叫醒人。**

| 症状型（该告警） | 原因型（该做看板，不该告警） |
| --- | --- |
| 5xx 占比 5 分钟窗口超过 1% | CPU 使用率 > 80% |
| p95 超过 SLO 且持续 2 个窗口 | 内存使用率 > 75% |
| 某路由速率跌到基线 20%（或涨到 5 倍） | 某台机器 load 高 |

原因型告警是疲劳的主因：CPU 80% 天天响，值班学会忽略，于是真出事那天的 5xx 也被忽略。**告警数量本身是指标**——每周被叫醒超过 2 次非 actionable 的告警，就该删告警而不是加看板。假设 SLO 是「p95 ≤ 100ms，错误率 ≤ 1%」，阈值设计走一遍：

- **贴着 SLO 挂，不贴着数据挂**：真实 p95 是 80.8ms，告警写 `p95 > 80ms` 就会在系统健康时天天响。
- **把桶误差算进阈值**：p95 是从 `le=[...,50,100,250,...]` 插值来的，实测误差 15.1%。阈值 100ms 时偏差还在容忍内；SLO 若定成 85ms，插值会随机翻转结论——改法是边界加密到 `le=80,90,100`，或改用命中率口径（实测 97.21% ≤ 100ms）。
- **多窗口 + 双确认**：`(错误率 5m > 2%) AND (错误率 1h > 1%)`，短窗口抓突发、长窗口抓持续，同时满足才响，能滤掉绝大多数发布抖动与单次探针失败；更严格的是 burn rate（错误预算消耗速率）。正文必须带 `route`、时间窗、`runbook` 和一条可复制的日志查询——写不出这条查询的告警说明它还停留在「有东西变了」。恢复阈值要比触发阈值宽松（触发 2%、恢复 1%），否则指标在阈值附近抖动会形成每分钟一次的告警风暴，本章探针实测里就有这种抖动源。

## 健康检查：liveness 与 readiness 不能是同一个端点

| 端点 | 回答 | 失败后谁动手 | 里面能放什么 |
| --- | --- | --- | --- |
| liveness（`/livez`） | 这个进程还有救吗 | 编排器**杀掉并重启** | 只看自己：事件循环还在转吗、启动是否完成 |
| readiness（`/readyz`） | 现在能接流量吗 | 负载均衡**摘掉实例**，不重启 | 强依赖状态、配置是否加载、是否正在排空 |
| startup（`/startupz`） | 启动完了吗 | 前两个探针在此之前不要开始 | 冷启动慢的重活（预热缓存、加载模型） |

[官方文档](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)（2026-10-18 核对）里 liveness 的语义很硬：探针返回非 0 时「the kubelet kills the container and restarts it」。所以**把数据库连通性放进 liveness 是自杀**：数据库抖 30 秒，编排器把整个集群逐个重启，重启完还连不上，再来一轮——自己制造一次级联故障。本章实测的 ③ 就是依赖故障场景，`/livez` 全程 200、`/readyz` 503，**这才是对的**：

```text
  ① 启动中（config 未加载）   livez 200  22.6ms   readyz 503   3.5ms
  ② 就绪                      livez 200   1.6ms   readyz 200   1.5ms
  ③ 连接池打满（依赖故障）     livez 200   1.5ms   readyz 503   1.5ms
     readyz body = {"ok":false,"checks":{"config":true,"db":"saturated","drain":false}}
  ④ 优雅关闭排空中            livez 200   1.7ms   readyz 503   1.6ms
  ⑤ 对端进程在探针里同步阻塞 300ms: {"code":"ERR","ms":266.6,"body":"TimeoutError: The operation was aborted due to timeout"}
     把超时放宽到 2000ms 后同一个端点返回 200 用了 344.6ms
```

1. **① 是本机第一版实现的 bug，被我抓到了**：`/readyz` 在配置没加载完就返回 200，因为 `ok` 的判断漏了 `state.started`，补上后才是 503。**「启动中的实例接到流量」是发布期 500 的最常见来源之一**——为「启动完成」留独立标志，但别把它做成 liveness 条件（那样启动慢会被反复杀掉，正确工具是 startup probe）。
2. **③ 与 ④ 是两种不同的 503**，body 必须能区分（`db:"saturated"` 等依赖就好，`drain:true` 是正在排空），运维靠 body 判断，别只看状态码；优雅关闭见[服务部署](/backend/docker-and-shutdown)。
3. **⑤ 是「活着但没用」**：进程在、端口在，handler 里一句同步 300ms 阻塞（一次大 JSON、一段正则回溯、一次同步加解密）就让 250ms 预算的探针拿 TimeoutError，放宽到 2s 同一端点仍返回 200。这解释了 liveness 超时为何要留余量：太紧会因一次 GC 杀掉健康实例，太松则真死锁没人管。写探针 handler 的唯一规则是**里面不能有任何 await 外部依赖或同步重活**。

## 常见错误与排查

**1. 日志里用实际路径当 `route`。** 现象：分组统计出现几十万种「路由」，指标后端被标签基数打爆，看板只剩 top10。原因：`/orders/12345` 每个 id 都是新分组。确认：`count(distinct route)` 超过几百就怀疑。修：记注册时的模板（Fastify 的 `reply.routeOptions.url`、Express 的 `req.route.path`），实际路径单独放字段并考虑脱敏。

**2. 用 `err.message` 拼日志，忽略 `cause`。** 现象：所有下游失败都记成同一句 `fetch failed`。原因：[统一错误处理](/backend/error-handling) 实测过 `ECONNRESET` 藏在 `err.cause` 里。确认：故意在 service 第 3 步抛异常，看日志能否定位到第 3 步。修：序列化固定输出 `name / message / code / cause.name / cause.code`，外部调用前后、状态跃迁、重试各一条 `debug`。

**3. 指标只放平均值。** 现象：客户说卡，看板显示平均 40ms。原因：均值被长尾抹平（实测 81.5% 样本低于均值）。确认：同一数据集把 mean / p50 / p95 / p99 并列（本章 50.22 / 30.24 / 80.79 / 580.14）。修：延迟一律 histogram + 分位数。

**4. 健康检查里查数据库，且 liveness 与 readiness 共用一个端点。** 现象：数据库抖动导致整批 pod 被重启，恢复从 30 秒变 20 分钟。确认：`kubectl get events`（需要真实集群，本机未验证）里大量 `Killing`。修：拆两个端点（实测 ③ 就是正确形状），依赖状态只进 readiness 并加超时与缓存。

## 练习

<Exercise title="练习 1 · 把日志行按位置解析错" difficulty="基础">

```text
2026-10-18T03:14:23.057Z 203.0.113.7 usr_42 POST /api/resources 500 8.14ms "curl/8.5.0" req_9f3c211ab0
```

① 按空格取第 5 个词当路由，取到的是什么？② 用「第一个三位数字」提取状态码会不会误命中？③ 把它改写成 NDJSON（字段：time, ip, user, method, route, status, durMs, ua, reqId）。

<template #answer>

① `/api/resources`——方法丢了，于是 `GET` 与 `POST` 同一路径被合并统计（本章实测：6 个真实路由只剩 4 组）。② 会。本行 `203.0.113.7` 里没有独立成词的三位数，但 ip 换成 `10.0.1.22`、或 URL 里出现 `/v1/200/orders` 就误命中；正确做法是让 `status` 成为独立字段。③

```json
{"time":"2026-10-18T03:14:23.057Z","ip":"203.0.113.7","user":"usr_42","method":"POST","route":"POST /api/resources","status":500,"durMs":8.14,"ua":"curl/8.5.0","reqId":"req_9f3c211ab0"}
```

`route` 应写成模板 `POST /api/resources/:id`，见「常见错误」第 1 条。

</template>

</Exercise>

<Exercise title="练习 2 · 用桶误差反推直方图边界" difficulty="进阶">

SLO 是「p95 ≤ 120ms」，现有直方图边界 `[10, 50, 100, 250, 500, 1000]`。① 参照本章实测（SLO=100ms 时 8 桶把 p95 从 80.8 估成 93.0），说明这套边界在 120ms 阈值上的问题。② 给出修改后的边界与理由。③ 什么口径能完全绕开插值？

<template #answer>

① 120ms 落在 `100..250` 这个 150ms 宽的桶里，插值假设区间均匀、实际不是：真实 p95 = 118ms 时估计值可能到 130ms 以上，直接翻转 SLO 结论。② 阈值附近加密并向尾部延伸：`[10, 50, 80, 100, 120, 150, 200, 300, 500, 1000, 3000]`——边界贴着 SLO 值本身放一条（120），最大边界远大于你愿意讨论的延迟，避免 +Inf 吞尾（本章 +Inf 吞了 0.59%，真实 max 6804ms 不可见）。③ 命中率口径 `sum(rate(_bucket{le="120"}[5m])) / sum(rate(_count[5m]))`，不需要插值——本章实测这个数是 97.21%。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误：让健康检查拖死服务" difficulty="挑战">

写一个「看起来最负责任」的 `/readyz`：串行 await 数据库 `SELECT 1`、Redis `PING`、第三方短信网关心跳，每个都不设超时；探针配置 `timeoutSeconds: 1, periodSeconds: 1, failureThreshold: 3` 且 liveness 也用这个端点。预测并发 100 个探针时发生什么，并逐处给出改法。

<template #answer>

**故障链**：探针每秒一次 → 每次跑三次外部调用且不设超时 → 依赖稍慢时 handler 排队 → 排队吃光连接池（本章日志里那个 `cause.code = 'POOLSATURATED'` 就是结局）→ 探针 1 秒超时判失败 → 3 次后 liveness 失败 → 按官方语义「kubelet kills the container and restarts it」→ 重启后连接池重建，探针继续打 → 循环。最讽刺的是**服务本来能正常处理业务请求，是被健康检查打死的**。

改法：① 每个子检查独立 `Promise.race` 超时，总预算小于 `timeoutSeconds`（留一半余量）；② 结果缓存 1～3 秒，让并发探针共享一次检查；③ liveness 与 readiness 拆成两端点，liveness 只答「事件循环还转吗」（见实测 ⑤）；④ 弱依赖从 readiness 删掉，改成独立指标 + 告警；⑤ `periodSeconds: 1` 要乘副本数才算真实压力，多副本时放宽到 5～10 秒。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Prometheus 指标类型](https://prometheus.io/docs/concepts/metric_types/) —— 核实 counter「单调递增」、gauge「可增可减」、histogram「`le` 桶 + 隐含 `+Inf`」、`_sum`/`_count`、summary 客户端分位数无法跨实例合并。2026-10-18 WebFetch 读取；桶误差与分位数数值是本机实测。
- [Kubernetes 配置 liveness、readiness、startup 探针](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) —— 核实 liveness 失败时「kubelet kills the container and restarts it」与 `initialDelaySeconds` / `periodSeconds` 语义。**本章没有任何 k8s 命令在本机执行过**，且该页抓取内容不完整：「readiness 不该校验第三方依赖」这条请以该页与 [Pod 生命周期](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) 当前版本自行确认。
- [Node.js perf_hooks](https://nodejs.org/docs/latest/api/perf_hooks.html)、[process](https://nodejs.org/docs/latest/api/process.html)、[async_hooks](https://nodejs.org/docs/latest/api/async_hooks.html) —— 核实 `monitorEventLoopDelay()` 的方法、`hrtime.bigint()` 单调纳秒、`memoryUsage()` 中 `heapUsed` 与 `rss` 的差别。实测发现 `length`、`exceeding` 在 v25.4.0 上是 `undefined`，动手前按你的版本核对可用属性。生产请直接用 [pino](https://getpino.io/) 与 [Fastify Logger 参考](https://fastify.dev/docs/latest/Reference/Logger/)，本机未安装，相关写法一律标未验证。

## 下一章

本章管「看得见的故障」：结构化日志加 `reqId` 定位单次请求，指标与 SLO 化告警告诉你用户正在受影响，分开的 liveness/readiness 让编排器帮你而不是帮倒忙。[文件上传、定时任务与后台作业](/backend/uploads-and-jobs) 管「一跑就看不见」的三类活：上传会把内存与磁盘打满（实测三种接收方式的 `rss` 差异、魔数嗅探与路径穿越拦截），定时任务会被事件循环漂移、重复执行和夏令时坑到（用 `Intl` 实测「02:30 在 2026-03-08 的 New York 根本不存在」），后台作业则要求任务落到持久化队列，否则[统一错误处理](/backend/error-handling) 里那个没人接住的异常会把整条待办一起带走。
