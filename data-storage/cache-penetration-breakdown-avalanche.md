# 穿透、击穿、雪崩：三种把数据库打爆的事故，回源曲线长得不一样

凌晨 0:30 的告警永远是同一句：「数据库 QPS 异常」。但三个团队的处置完全错了路：A 团队上线了 singleflight，第二天照样炸——因为炸的原因是有人拿 `-1` 和随机字符串遍历详情接口（穿透），每一次都"未命中"，合并请求只能合并**同一个键**的并发，救不了**各不相同的不存在键**。B 团队加了布隆过滤器，首页照样炸——缓存实例主从同时挂掉（雪崩），布隆过滤器本身就在缓存实例里，皮之不存。C 团队给 TTL 加了抖动，数据库照被 5000 并发打穿——那个日销十万单的爆款 SKU 只有**一个键**，抖动改变不了"它就过期在这一刻"（击穿）。

三个词在面试八股里长得像三兄弟，在监控图上其实是三条完全不同的曲线：**穿透是"缓存永远不会命中"的查询流量**；**击穿是"一个键过期瞬间"的请求洪峰**；**雪崩是"一批键或整个缓存实例"同时失效**。区分它们的唯一标准是回源请求的**键分布和时间形态**，而对策互不通用——上一章 [Cache-Aside 与读写模式](/data-storage/caching-patterns)给了你骨架代码（"查不到 → 回源 → 回填"三段式），本章给这个骨架上刑具：先跑通三种事故，再逐一给方案、算副作用。

本章所有数字来自本机 Node 写的 mini 缓存层模拟（虚拟时钟、确定性种子），完整代码贴在下面，你可以直接复跑。**它不是 Redis 实测**——Redis 侧命令一律标预期结果。

## 先把三个概念钉死：一张表 + 一句口诀

| | 穿透 penetration | 击穿 breakdown | 雪崩 avalanche |
| --- | --- | --- | --- |
| 查的是什么 | **不存在**的数据（缓存注定 miss） | **一个**热点键 | **一大批**键 / 整个实例 |
| 触发时机 | 恶意遍历、脏数据上游、爬虫 | 热点键 TTL 到点那一刻 | 大批键同刻过期、缓存宕机、重启迁移 |
| 回源键分布 | 键几乎不重复 | 同一个键重复成千次 | 海量键各回一次 |
| singleflight 能救吗 | 不能 | **能** | 不能（键不同无从合并） |
| 布隆能救吗 | **能** | 不能（数据存在） | 不能 |
| TTL 抖动能救吗 | 无关 | 基本无关 | **能**（治"同刻"这个因） |
| 一句话 | 查不到 | 一个没了 | 全没了 |

复现工具：下面这个 mini 缓存层是本章三个事故的全部复现环境。把它存成 `sim.cjs`，本机 `node sim.cjs` 直接跑（纯内存模型：后端固定 40 ms 延迟、缓存读 1 ms、虚拟毫秒时钟、`Map` 存缓存；不含网络与真实调度）。

```js
'use strict';
function makeRand(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pctl(arr, p) {
  if (!arr.length) return '0.0';
  const s = arr.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
}
function simulate(o) {
  const rand = makeRand(20261018);
  const backendMs = o.backendMs ?? 40, cacheMs = 1;
  const ttl = o.ttl ?? 60000, jitter = o.ttlJitter ?? 0;
  const sf = !!o.singleflight, logical = !!o.logical;
  const cacheNull = !!o.cacheNull, nullTtl = o.nullTtl ?? 10000;
  const bloom = !!o.bloomReject;
  const cache = new Map(), inflight = new Map(), events = [];
  let ri = 0, backend = 0, hits = 0, stale = 0, blocked = 0, joined = 0, maxPending = 0;
  const lat = [], perSec = new Map();
  for (const w of (o.prewarm || [])) cache.set(w.key, { hardAt: w.hardAt, softAt: w.softAt ?? w.hardAt });
  const reqs = o.requests; // [{at, key, exists=true}] 已按 at 排序
  while (ri < reqs.length || events.length) {
    const na = ri < reqs.length ? reqs[ri].at : Infinity;
    if (events.length) events.sort((a, b) => a.doneAt - b.doneAt);
    const nd = events.length ? events[0].doneAt : Infinity;
    if (na <= nd) {
      const r = reqs[ri++];
      const e = cache.get(r.key);
      if (e && e.hardAt > r.at) {
        if (logical && e.softAt <= r.at) {
          stale++; lat.push(cacheMs);
          if (!inflight.has(r.key)) {
            const arr = { list: [] }; inflight.set(r.key, arr); backend++;
            perSec.set(Math.floor(r.at / 1000), (perSec.get(Math.floor(r.at / 1000)) || 0) + 1);
            events.push({ key: r.key, exists: true, doneAt: r.at + backendMs, arr, sf: true });
            if (events.length > maxPending) maxPending = events.length;
          }
          continue;
        }
        hits++; lat.push(cacheMs); continue;
      }
      if (!r.exists && bloom) { blocked++; lat.push(2); continue; }
      if ((sf || logical) && inflight.has(r.key)) { inflight.get(r.key).list.push(r.at); joined++; continue; }
      backend++;
      perSec.set(Math.floor(r.at / 1000), (perSec.get(Math.floor(r.at / 1000)) || 0) + 1);
      const arr = { list: [r.at] };
      if (sf) inflight.set(r.key, arr);
      events.push({ key: r.key, exists: r.exists, doneAt: r.at + backendMs, arr, sf });
      if (events.length > maxPending) maxPending = events.length;
    } else {
      const ev = events.shift();
      if (ev.sf) inflight.delete(ev.key);
      for (const a of ev.arr.list) lat.push(ev.doneAt - a + cacheMs);
      if (ev.exists || cacheNull) {
        const base = ev.exists ? ttl : nullTtl;
        const span = jitter ? Math.round(base * (1 + (rand() * 2 - 1) * jitter)) : base;
        cache.set(ev.key, logical
          ? { hardAt: Number.MAX_SAFE_INTEGER, softAt: ev.doneAt + ttl }
          : { hardAt: ev.doneAt + span, softAt: ev.doneAt + span });
      }
    }
  }
  const n = reqs.length;
  let peak = 0; for (const v of perSec.values()) if (v > peak) peak = v;
  return { backend, hits: ((hits + stale) / n * 100).toFixed(1) + '%', stale, joined, blocked,
    p50: pctl(lat, 0.5), p99: pctl(lat, 0.99), maxConc: maxPending, peakQps: peak };
}
const S = (a) => a.sort((x, y) => x.at - y.at);

// —— 事故 1：击穿。热键在第 5 ms 物理过期，之后 10 ms 内到达 2000 个并发 ——
const K = 'product:9527';
const burst = S(Array.from({ length: 2000 }, (_, i) => ({ at: 5.0 + i * 0.005, key: K })));
const pre = [{ key: K, hardAt: 5 }];
console.log('击穿·无防护        ', JSON.stringify(simulate({ requests: burst, prewarm: pre })));
console.log('击穿·singleflight  ', JSON.stringify(simulate({ requests: burst, prewarm: pre, singleflight: true })));
console.log('击穿·逻辑过期      ', JSON.stringify(simulate({
  requests: burst, prewarm: [{ key: K, hardAt: Number.MAX_SAFE_INTEGER, softAt: 5 }],
  singleflight: true, logical: true, ttl: 60000 })));

// —— 事故 2：穿透。200 个不存在的 id 各查 10 次（同 id 隔 20 ms）——
const ghost = S(Array.from({ length: 2000 }, (_, i) => ({ at: i * 0.1, key: 'user:' + (i % 200), exists: false })));
console.log('穿透·无防护        ', JSON.stringify(simulate({ requests: ghost })));
console.log('穿透·空值缓存      ', JSON.stringify(simulate({ requests: ghost, cacheNull: true })));
console.log('穿透·空值+sf       ', JSON.stringify(simulate({ requests: ghost, cacheNull: true, singleflight: true })));
console.log('穿透·布隆拦截      ', JSON.stringify(simulate({ requests: ghost, bloomReject: true })));
// 同一个假键在 10 ms 内被打 2000 次
const storm = S(Array.from({ length: 2000 }, (_, i) => ({ at: i * 0.005, key: 'user:404', exists: false })));
console.log('穿透·假键风暴·仅空值', JSON.stringify(simulate({ requests: storm, cacheNull: true })));
console.log('穿透·假键风暴·空值+sf', JSON.stringify(simulate({ requests: storm, cacheNull: true, singleflight: true })));

// —— 事故 3：雪崩。1 万个键预热、TTL 300 s 整点同刻过期，295~305 s 到达 5 万请求 ——
// 注意：随机流 R2 是全局共享的，各行按下列顺序消耗——改动顺序会改变每行数字（但仍同量级）
const R2 = makeRand(7);
const keys = Array.from({ length: 10000 }, (_, i) => 'sku:' + i);
const mk = () => S(Array.from({ length: 50000 }, () => ({ at: 295000 + R2() * 10000, key: keys[Math.floor(R2() * 10000)], exists: true })));
console.log('雪崩·TTL 同刻      ', JSON.stringify(simulate({ requests: mk(), prewarm: keys.map((k) => ({ key: k, hardAt: 300000 })) })));
const preJ = keys.map((k) => ({ key: k, hardAt: 300000 + Math.round((R2() * 2 - 1) * 30000) })); // ±10% 抖动
console.log('雪崩·抖动预热      ', JSON.stringify(simulate({ requests: mk(), prewarm: preJ })));
console.log('雪崩·宕机全冷      ', JSON.stringify(simulate({ requests: mk() })));
console.log('雪崩·宕机全冷+sf   ', JSON.stringify(simulate({ requests: mk(), singleflight: true })));
```

<Callout type="verified" title="以下所有模拟数字为本机实测输出">

Windows 10 x64、**Node v25.4.0**、2026-10-18 运行。下表每一行都对应上文脚本按声明顺序跑出的真实输出（临时脚本按项目约定验证后已清理，代码清单完整随本章保留，直接可跑）。这是**纯 JS 进程内模型，不是 Redis 实测**：虚拟时钟 + 确定性随机种子、没有网络往返、单进程事件循环、后端延迟固定 40 ms。数字用于比较各方案的**相对效果与量级**，不能外推成生产容量参数；场景 3 的随机流按代码注释声明的顺序消耗，调换顺序数字会变（量级不变）。

</Callout>

实测主表（列名为 simulate 返回值；p50/p99 是**请求侧等待延迟**，单位 ms）：

| 场景 | 回源次数 | 合并等待 | 陈旧返回 | 拦截 | 回源 QPS 峰值 | 并发回源峰值 | p50 / p99 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 击穿 · 无防护 | **2000** | 0 | 0 | — | 2000/s | 2000 | 41.0 / 41.0 |
| 击穿 · singleflight | **1** | 1999 | 0 | — | 1/s | 1 | 36.0 / 40.9 |
| 击穿 · 逻辑过期 | **1** | 0 | 2000 | — | 1/s | 1 | **1.0 / 1.0** |
| 穿透 · 200 假 id×10 无防护 | 2000 | 0 | — | 0 | 2000/s | 401 | 41.0 / 41.0 |
| 穿透 · 空值缓存（无互斥） | **528** | 0 | — | 0 | 528/s | 401 | 1.0 / 41.0 |
| 穿透 · 空值缓存 + singleflight | **200** | 328 | — | 0 | 200/s | 200 | 1.0 / 41.0 |
| 穿透 · 布隆拦截 | **0** | — | — | 2000 | 0/s | 0 | 2.0 / 2.0 |
| 穿透 · 同一假键 10ms 风暴 · 仅空值 | 2000 | 0 | — | 0 | 2000/s | 2000 | 41.0 / 41.0 |
| 穿透 · 同一假键 10ms 风暴 · 空值+sf | 1 | 1999 | — | 0 | 1/s | 1 | 36.0 / 40.9 |
| 雪崩 · TTL 同刻 300 s | 9323 | 0 | — | — | **4034/s** | 219 | 1.0 / 41.0 |
| 雪崩 · TTL ±10% 抖动 | 5584 | 0 | — | — | **1737/s** | 95 | 1.0 / 41.0 |
| 雪崩 · 实例宕机全冷 | 10120 | 0 | — | — | 4024/s | 248 | 1.0 / 41.0 |
| 雪崩 · 冷启动加 singleflight | 9931 | 210 | — | — | 3872/s | 226 | 1.0 / 41.0 |

三张曲线各读出一个铁事实：击穿行 `2000 → 1` 是合并的力量；穿透行 `528 → 200` 说明**空值缓存要配互斥才收敛**（回源延迟 40 ms 期间到达的重复查询仍各自打库，528 就是这么来的）；雪崩最后一行 `9931` 与无防护的 `10120` 几乎一样——**singleflight 对雪崩无效**，因为回源的是 1 万个不同的键。

## 穿透：查的是「不存在」，缓存层对它永远 miss

**怎么复现**。本机：上面的场景 2 代码。真实环境配方（未在本机执行）：对一个 `GET /api/user/:id` 用随机负数与超长 id 循环打 10 万次，若接口把"查无此人"当正常返回 null，每一发都穿透到 DB。

**监控上怎么认出它**。特征组合：DB 的 QPS 涨但**每查询耗时极短**（走主键/唯一索引返回空行，几乎不动 buffer pool，CPU 低、连接占用高）；Redis `keyspace_misses` 暴涨但 `evicted_keys` 不动（不是被淘汰的）；应用日志里请求参数聚合后 **id 高度分散且重复率极低**；业务上"用户不存在"比例异常。击穿和雪崩在这条轴上都对不上——它们的 id 分布要么极度集中、要么全是正常键。

**方案矩阵**：

| 方案 | 原理 | 副作用 |
| --- | --- | --- |
| 入口校验 | id 必须为正整数/符合雪花规则，垃圾直接 400 | 只能挡格式垃圾，挡不住"格式合法的遍历" |
| 空值缓存 | 查无此人返回 null 也写缓存（`NULL` 占位），短 TTL 60s 量级 | 见下文三条 |
| 布隆过滤器 | 全量 id 预载，"不存在"在网关/应用层直接拒 | 假阳性方向性、删除难、重建窗口，见下文 |
| 认证与限流 | 遍历行为按调用方限流 | 误伤爬虫之外的正常批量调用；见[分布式会话、限流与幂等](/data-storage/session-rate-limit-idempotency)与 [OWASP](https://owasp.org/) 的自动化威胁类目 |

**空值缓存**的三条副作用：数据"从不存在变成存在"后，null 占位在 TTL 内让新用户查不到自己——写路径插入数据时必须**同时删 null 键**（这是[缓存一致性](/data-storage/cache-consistency)的场景之一）；攻击者只要不断换**新**的不存在 id，null 键就只增不减，内存被攻击者的键空间撑爆（上一章：`allkeys-lru` 替你收尸，`noeviction` 让你写挂）；以及实测的收敛问题——它挡不住回源延迟窗口内的并发重复（528 行的教训），所以空值缓存与 singleflight 是**一对组合拳**，不是二选一。

**布隆过滤器（bloom filter）**用实测说。本机自实现（`Uint8Array` 位数组 + FNV-1a 与 djb2 双哈希做 `h1 + i·h2` 线性组合）：

```js
function fnv1a(s, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) + s.charCodeAt(i)) >>> 0; return h >>> 0; }
class Bloom {
  constructor(bits, k) { this.bits = bits; this.k = k; this.a = new Uint8Array(Math.ceil(bits / 8)); }
  _pos(s) { const o = []; let x = fnv1a(s, 2166136261); const st = djb2(s) | 1;
    for (let i = 0; i < this.k; i++) { o.push(x % this.bits); x = (x + st) >>> 0; } return o; }
  add(s) { for (const p of this._pos(s)) this.a[p >>> 3] |= 1 << (p & 7); }
  has(s) { for (const p of this._pos(s)) if ((this.a[p >>> 3] & (1 << (p & 7))) === 0) return false; return true; }
}
// 定参：m = -n·ln(p)/(ln2)^2 位，k = (m/n)·ln2 次
const N = 1000000, TARGET = 0.01;
const bits = Math.ceil(-N * Math.log(TARGET) / (Math.LN2 * Math.LN2)); // 9585059
const k = Math.round((bits / N) * Math.LN2); // 7
// 实测回路：灌满 100 万，再拿 100 万**从未插入过**的对照串查询
const bf = new Bloom(bits, k);
for (let i = 0; i < N; i++) bf.add('user:' + i);
let fp = 0;
for (let i = 0; i < N; i++) if (bf.has('ghost:' + i)) fp++; // 实测 fp/N = 0.993%，理论 1.004%
```

实测（本机 Node v25.4.0，插入 100 万条、查询 100 万条不存在的对照，与理论值逐项对照）：

| 实验 | 实测 | 理论 |
| --- | --- | --- |
| n=100 万、p=1%、m=9,585,059 bit（1,198,133 B ≈ 1.14 MB）、k=7 | 假阳性 0.993% | 1.004% |
| 同上，假阴性（已插入却没查到） | **0 条** | 0（定义使然） |
| k 分别取 2 / 4 / 7 / 10 / 16（内存固定） | 3.550% / 1.357% / 0.996% / 1.306% / 3.562% | 3.547 / 1.355 / 1.004 / 1.300 / 3.545 |
| 按 100 万定容却塞进 200 万（k=7） | **15.730%** | 15.745% |
| 100 万 id 放进 JS `Set` 的堆增量 | 约 63 MB（对照布隆 1.14 MB；受 GC 时机影响，只作量级参考） | — |

从表里读定参纪律：**容量 n 要按"未来 12 个月的行数"拍，拍小了假阳性非线性恶化**（1% → 15.7%）；k 有最优值，两头都变差；每降一档假阳性付约 0.5 bit/元素——p=5% 要 0.74 MB、1% 要 1.14 MB、0.1% 要 1.71 MB、0.01% 要 2.29 MB（同为本机计算）。三条工程性质必须背下：假阳性是**单向**的（说"没有"一定没有，说"有"可能没有），所以布隆后面仍需空值缓存兜那 1% 漏进来的假阳性；**不支持删除**（位被多个元素共享，计数布隆/ribbon 可代偿或周期性全量重建，重建窗口内新写入的数据必须先进过滤器，否则正常用户被判"不存在"——这是布隆最恶性的一类事故）；放进程内存则每个实例各一份、启动要全量灌，放 Redis（官方模块 RedisBloom，未在本机验证，见[官方文档](https://redis.io/docs/)）则每次判定多一跳网络——低价值接口不值得，高价值接口用 L1 布隆 + L2 RedisBloom 分层。

## 击穿：一个键的死，一群请求的账

**复现**：场景 1，热键在第 5 ms 过期、2000 并发到达，无防护回源 2000、**并发回源峰值 2000**——连接池瞬间被同一个 SQL 占满，这才是击穿杀死 DB 的真实姿势（不是 QPS 高，是**全等的慢查询并发**）。

**监控上怎么认**：慢查询日志里**同一条 SQL 文案出现成千次**；Redis 侧单键访问速率异常（`redis-cli --hotkeys` 或访问日志聚合，预期用法未实测）；DB CPU 陡增但 `keyspace_misses` 涨幅不大（1 个键 miss 也算 1）——misses 少而回源多，是击穿区别于穿透的信号。

**方案矩阵与实测对照**：

| 方案 | 实测效果 | 副作用 |
| --- | --- | --- |
| 互斥重建 / singleflight | 2000 → **1** 回源；1999 等待 | 等待者 p99 40.9 ms；持锁者崩了键永挂 → 锁必须带超时；进程内互斥只护本实例，多实例各回一次（N 实例 → N 次回源，通常可接受） |
| 逻辑过期 | 2000 → **1** 回源；p99 **1.0 ms** | 2000 个请求全部拿到**陈旧值**；键物理上不过期 → 内存只进不出，需配清扫任务（对照上一章 `expired_keys` 不涨的排查线索） |
| 不设 TTL + 主动刷新（Refresh-Ahead） | 等效逻辑过期的工程化版本 | 刷新任务的失败重试与惊群要自己管 |
| L1 进程缓存兜底 | L2 过期瞬间，各实例 L1 大概率还有 | 新鲜度下限变成 L1 的 TTL |

互斥重建与逻辑过期是**两种哲学**：前者"宁可一起等 40 ms，也要拿到新值"，后者"宁可给你旧的，也不让任何人等"。对价格、库存文案这类键选后者；对"改完必须马上可见"的键选前者，并接受瞬时排队。生产上 singleflight 的互斥如果用 Redis `SETNX` 做分布式锁，锁本身成了新的争用点与故障点——用[分布式锁](/data-storage/distributed-lock)章的清单自检，多数场景进程内互斥 + 每实例最多回源一次就够了。

## 雪崩：一批键同刻死，或缓存实例一起没

**复现**：场景 3 两条成因都量了——TTL 同刻（回源峰值 **4034/s**）、实例宕机全冷（**4024/s**，和 TTL 同刻几乎一样，雪崩不分"过期"还是"没落"，只看"miss 的键够不够多"）。

**监控上怎么认**：命中率**全线**塌（区别于击穿的单键、穿透的高 miss 低重复）；Redis 侧可能是 `connected_clients` 断崖或哨兵/集群事件；DB 是**所有表**一起慢；若由"大批过期"引起，`INFO keyspace` 的 `expires` 与过期时刻相关；若由宕机引起，应用日志先出现连接错误。

**方案矩阵**：

| 方案 | 实测/原理 | 副作用 |
| --- | --- | --- |
| TTL 加抖动 | ±10% 抖动 → 峰值 4034 → **1737/s**，回源总量 9323 → 5584 | 抖动幅度必须覆盖**流量时段宽度**：cron 整点同步流量下，TTL 抖动 ±3% 只是把同刻过期变成同分钟过期 |
| 高可用 | 主从切换、集群（见[持久化与复制](/data-storage/redis-persistence)） | 切换窗口仍会 miss 一波，HA 不是免死金牌 |
| 热键不过期 | 爆款键不设 TTL、由写路径主动失效 | 与淘汰章互斥：常驻键在 `allkeys-lru` 下反而是被淘汰对象 → 常驻键放 `noeviction` 实例 |
| 多级缓存 L1 兜底 | L2 全灭时 L1 还在，各实例自己扛 | 部署后全空窗 → 冷启动限流 |
| **回源限流 + 熔断** | DB 只有一定并发额度：给回源路径单独设令牌桶/信号量，超出直接降级 | 被限的合法请求体验变差 → 必须配合下面的降级路径 |
| 降级路径 | 缓存全宕时的回答顺序 | 每一级都有业务代价 |

缓存层为什么必须有**限流与熔断**：穿透/击穿/雪崩的解法都在"减少回源量"，但模拟里雪崩的并发回源峰值仍有两百多——只要 miss 率 × 流量 > DB 承载力，就必然出事故，而**唯一保住 DB 的手段是不让超额请求到 DB**。限流器（如每秒放行 N 次回源）把洪峰削成 DB 能吃的常量；熔断器在 DB RT 恶化时直接断掉回源、全员走降级，防止 DB 被拖死后连"写"都进不来（缓存事故的最坏结局是库和缓存一起瘫痪）。限流算法细节在[分布式会话、限流与幂等](/data-storage/session-rate-limit-idempotency)。

**降级路径按数据形态设计，不是临场拍脑袋**：

| 顺序 | 手段 | 适用 | 例子 |
| --- | --- | --- | --- |
| 1 | 返回进程内陈旧副本（L1/最近一次快照） | 允许分钟级陈旧 | 商品价格显示缓存快照 |
| 2 | 返回粗粒度/静态默认 | 能容忍降级信息 | 推荐位兜底成热销榜、评分兜底成"暂无" |
| 3 | 排队 + 限量回源 | 读必须新鲜但可排队 | 秒杀页限每秒 50 次回源，其余返回"请稍后" |
| 4 | 功能降级 | 该模块非核心 | 关闭"猜你喜欢"，保交易主链路 |

恢复后的最后一刀：**熔断闭合前必须预热**。缓存冷状态下熔断一放，恢复流量立刻再造一次雪崩——按 key 前缀分批回填或限慢启动，观察 `keyspace_hits` 爬回基线再全量放行（预热与验收动作见[阶段项目](/data-storage/project)）。

## 常见错误与排查

**1. 加了 singleflight，击穿时 DB 连接池还是爆。** 现象：单实例看代码没问题，多实例部署后照样翻车。原因：进程内合并只护自家，N 个实例并发 miss 同一键 = N 次回源，实例扩容后 N 可能上百。确认：数一下同一 SQL 的并发来源 IP（应用实例）。修法：N 次通常仍远小于 2000 次，可接受则不动；要全局 1 次就上 Redis 版互斥（接受锁风险）或逻辑过期。

**2. 空值缓存 TTL 设了 24 小时，新注册用户查不到自己。** 现象："我刚注册为什么显示不存在"。原因：该 id 的 null 占位早在库里有了。确认：`GET` 该键看到 null 标记。修法：存在性翻转的写路径删 null 键；null TTL 压到分钟级；穿透型键空间攻击另配限流（见上一章"数据源黑洞"）。

**3. 布隆过滤器上线后，一部分正常用户被永久判"不存在"。** 现象：新写入的实体查不到，老数据正常。原因：过滤器全量重建期间新增的数据没进新集，或用了标准布隆却需要删除语义后手删了元素（标准布隆删不了）。确认：按创建时间切一批样本看判定结果。修法：双写（入库同时增量 add）+ 重建时双过滤器切换；删除需求真实存在就换 counting bloom 或接受"布隆只做存在性预筛、判定仍回源"的定位。

**4. TTL 抖动 ±5% 上线，大促整点照样雪崩。** 现象：曲线峰值只削了一点。原因：抖动窗口（60 s×5%=3 s）小于流量尖峰本身（整点涌入 1 分钟），过期时刻在尖峰内重新对齐。确认：把预热时刻/写入时刻画直方图。修法：抖动按"流量时段宽度"反推——要么打散**写入时刻**（后台预热分批随机延迟），要么 TTL 基数本身加随机（`base + rand(0, base*0.3)` 起步）。

**5. 逻辑过期上线后 Redis 内存只涨不跌。** 现象：`expired_keys` 纹丝不动，`used_memory` 爬升，命中率很好看。原因：键物理永不过期，全靠后台刷新，僵尸键（不再被读的）永生。确认：对比 `INFO keyspace` 的 keys 数与业务对象数。修法：给逻辑过期键配一个远大于业务容忍度的物理 TTL（如 7 天）作兜底清扫，并让刷新失败时走真实过期——把"永不消失"改成"几乎不消失"。

**6. 熔断器当限流用，结果平时好好的、洪峰一来才反应。** 现象：DB 先被打挂，熔断才打开——晚了。原因：熔断的触发条件是"下游失败率/延迟恶化"，它不会预防过载。确认：看熔断器状态切换日志时间戳 vs DB 慢日志时间戳。修法：回源路径先挂**主动限流**（固定额度），熔断只做最后一道墙；两者参数分开评审。

## 练习

<Exercise title="练习 1 · 看图说话判事故" difficulty="基础">

三份监控快照，各判断是穿透、击穿还是雪崩，并各说一条最能定性的证据：(a) DB QPS ×40，慢日志同一条主键 SQL 并发 900，Redis misses 只涨了几百；(b) misses 暴涨 30 倍，`keyspace_hits` 占比跌到 8%，Redis 与 DB 连接均正常，应用日志里查询 id 去重率 99%；(c) 命中率从 97% 直线跌到 11% 持续 4 分钟，同时应用侧大量 timeout 后恢复，DB 全表 RT 抬升。

<template #answer>

(a) 击穿：证据是"同一条 SQL 高并发 + misses 涨幅小"——少数热键的 miss 被并发放大成回源洪峰（对照实测：2000 请求只产生 1 次 keyspace 级 miss 的语义，但打库 2000 次）。(b) 穿透：id 高去重 + miss 率暴涨 + Redis 存活，典型"查不存在"(c) 雪崩：全线同时塌 + 连接层错误（Redis 实例侧出过事）后自愈。判分点：(a) 不能答成"DB 慢查询优化问题"，必须指出键分布。

</template>

</Exercise>

<Exercise title="练习 2 · 给布隆定参" difficulty="进阶">

你的用户 id 全集当前 500 万，预计一年 800 万，希望假阳性 ≤ 0.5%。用本章公式算 m、最优 k、占用字节；再回答：k 取 3 行不行？过滤器放应用进程里和放 Redis 里各举一个决定性缺点（不许答"看情况"）。

<template #answer>

m = -n·ln(p)/(ln2)² = -8,000,000×ln(0.005)/0.4805 ≈ 8.80×10⁷ bit ≈ **10.5 MB**；k = (m/n)·ln2 ≈ 7.6 → **8**。n 必须按增长后的 800 万定，按 500 万定就是实测表里"塞两倍 → 15.7%"的下场。k=3 不行：对照实测在内存固定时 k=2 已劣化到 3.55%，k 偏离最优值两侧都变差，3 次哈希在这个规模下假阳性远超 0.5%。进程内：每实例各存 10.5 MB 且**启动要全量灌 800 万 id**，冷启动拖慢、扩缩容时各实例间版本不一致；Redis：每次存在性判定一跳 RTT，热点接口等于**给每个请求（包括本来会命中的）都加了网络往返**，防穿透的成本可能高于穿透本身的损失。

</template>

</Exercise>

<Exercise title="练习 3 · 故意写坏 singleflight 并解释症状" difficulty="进阶">

下面的互斥重建有一处错误，会导致特定情况下该键在一段时间内**所有请求直接报错**而不是等待。指出错误、说明触发条件与线上症状，给出修正：

```js
const flying = new Map();
async function load(key) {
  if (flying.has(key)) return flying.get(key);
  const p = db.query(key).then((rows) => { flying.delete(key); return rows; });
  flying.set(key, p);
  return p;
}
```

<template #answer>

错在**没有 catch 分支的清理**：`db.query` 失败时 promise 以 rejection 结束，`flying.delete` 在 `.then` 里不会执行 → 这个 rejected promise 永久留在 Map 里；后续所有请求 `return flying.get(key)` 拿到同一条已被拒绝的 promise，**每个请求都立刻失败**，且没人会再触发真实回源——击穿被你用代码固化成了"永久击穿"。线上症状：该键 100% 报错、直到进程重启；以及首个 rejection 无 catch 可能被 Node 判成 unhandledRejection。修正：`finally` 里 `flying.delete(key)`，等待者各自拿到 rejection 后自行决定重试/降级；生产版还应给 promise 包一层超时（持锁者查询卡死 = 全键挂起）。这正是本章击穿表里"互斥重建"一行的副作用条目的代码化版本——模拟里没演示锁泄漏，是因为 simulate 引擎里回源必然完成。

</template>

</Exercise>

<Exercise title="练习 4 · 设计一次雪崩演习" difficulty="挑战">

给你一个 3 实例应用 + 1 Redis + 1 MySQL 的详情页服务（日活峰值读 8 万 QPS、命中率 98%、热键 top100 占流量 60%）。设计一场**可控的雪崩演习**：怎么制造"缓存全宕"、观测哪些指标、什么情况下立刻终止演习，以及演习要验证的三条降级路径的验收标准。Redis 不可用无法本机实跑——这是**方案设计题**，写出可执行清单即可。

<template #answer>

制造：低峰期把 Redis 实例停容器（或 ACL 断连接），比"删键"更接近真实故障（连超时都没有，直接 error）。观测：回源 QPS（应出现 ~1600/s 的理论峰值=8 万×miss 全量化）、DB CPU/连接池占用、熔断器状态、错误率、p99。终止红线：DB 连接池 > 80% 或写接口 RT 翻倍——雪崩演习的底线是**不让演习变成事故**，写路径优先保命。三条验收：① 限流器把回源压到预设额度（如 500/s）且超额请求走降级而非排队雪崩；② L1/快照兜底让 top100 热键在 60% 流量上仍返回旧值（错误率 <1%）；③ 恢复后预热流程使 `keyspace_hits` 在 N 分钟内爬回 98%，期间熔断自动闭合不误放（验证"先预热再闭合"而不是反过来）。判分点：有终止红线、有"恢复方向"的验收、承认写路径与读路径要分开演练。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Redis 官方文档入口](https://redis.io/docs/) —— 用于核实三件事：`INFO` 里 `keyspace_hits/keyspace_misses/expired_keys/evicted_keys` 的确切计数口径（本章监控判据依赖它，官方未逐字承诺计数时机）；官方 RedisBloom 模块是否存在及其删除支持现状（本章自实现布隆只论证了方向性结论）；`--hotkeys` 等运维命令的真实语义。本文 WebFetch 核实未成功，相关表述全部标了"未在本机验证/预期"，以官网为准。
- [OWASP 官网](https://owasp.org/) —— 穿透常由恶意遍历驱动，核实"自动化攻击/资源滥用"类目与限流建议，用于本章穿透方案表的定性依据。
- [Node.js process 文档](https://nodejs.org/api/process.html) —— 本章模拟脚本与 `Set`/布隆内存对照所用 `memoryUsage()` 的官方说明（数值受 GC 影响的提醒出自该文档语义）。
- [缓存模式：Cache-Aside 与 Read/Write-Through](/data-storage/caching-patterns) 与 [Redis 过期与内存淘汰](/data-storage/expiry-and-eviction) —— 站内前置：三段式骨架代码与 TTL 不精确、淘汰策略是本章所有方案的底座。

## 下一章

本章保证的是"流量再怪，数据库还活着"——穿透挡在门口、击穿合并成一次、雪崩削峰加降级。但缓存层活下来之后还欠着一条承诺：用户写了新数据，读到的不能是旧的。[缓存一致性与更新失效策略](/data-storage/cache-consistency) 正面处理写路径的全部竞态：先删还是先写、延迟双删到底双不双得动、订阅 binlog 失效是不是银弹，以及"一致性"在缓存语境里真正可兑现的限度。
