# 统一错误处理：让每一个异常都从同一道门出去

接口 500，前端只拿到一句纯文本 `Internal Server Error`。用户说「点了没反应」，你打开服务器日志，除了 `Error` 一行什么都没有——不知道哪个用户、哪次操作、哪一层。**这是没做统一出口的代价：错误发生了，但信息没被采集。**

第二种更糟：有人把堆栈直接返回给客户端。安全扫描报告里贴着一段响应体，里面有 `D:/app/node_modules/pg-pool/index.js:45` 这样的绝对路径和内网数据库的 `10.244.3.17:5432`——**一条错误响应就把技术栈、部署路径和网络拓扑交了出去**（本章实测 413 个字符）。第三种：处理请求途中抛了一个没人接住的异常，进程直接死了，客户端收到的不是错误响应而是连接重置（实测 `TypeError: fetch failed`、`cause.code = 'ECONNRESET'`、退出码 `1`）。第四种是钱：接口超时后前端自动重试，同一笔订单扣了两次（本章五种实现的真实扣款次数：2、1、2、1、0）。

四种故障的共同解法是同一个：**代码里只能有一个地方决定「异常如何变成响应、如何变成日志、进程要不要退出」。** 前置：[分层架构与请求处理链路](/backend/layered-architecture) 定下 service 抛领域错误、controller 负责映射的分工；[Node.js 运行时](/backend/node-runtime) 的事件循环模型解释了本章所有异常传播。

## 业务错误和程序错误的处理路径完全相反

| 维度 | 业务错误（expected） | 程序错误（unexpected） |
| --- | --- | --- |
| 谁产生的 | service 的规则判断、入口校验 | 类型错误、空引用、驱动异常、代码 bug |
| 例子 | 邮箱已被注册、余额不足、未登录、越权、限流 | `Cannot read properties of null`、`ECONNREFUSED`、SQL 拼错 |
| 有没有「正确答案」 | 有，产品规定了提示文案 | 没有，只能给「服务异常」 |
| HTTP 状态码 | 4xx（按语义选） | 5xx |
| message 能不能给客户端 | 能，而且应该给 | **不能**，原文里通常有内部信息 |
| 要不要重试 | 不该（重试还是同样的错） | 由调用方按退避策略决定，服务端不自动重试整条链路 |
| 日志级别 / 告警 | `warn`；不告警（业务错误是正常流量） | `error` + 完整堆栈 + 上报；要，突增说明有 bug 或依赖挂了 |
| 该在哪一层拦 | service 抛出、controller 映射 | 只能被最外层兜住 |

**最危险的一条推论**：程序错误的 `message` 里经常带内部信息，因为驱动和第三方库的错误文案就是给人调试用的——实测那条 `connect ECONNREFUSED 10.244.3.17:5432` 就是 PostgreSQL 客户端的标准报错，它没错，错在你把它发给了客户端。所以做法是**看类型不看内容**：只有你显式声明「这是业务错误」的对象才允许带原文出去。判据可以用 `instanceof`、`expose` 字段或 `code` 白名单，但必须唯一。

## 十三种故障的实测响应矩阵

一个 `node:http` 服务器，路由全部故意造故障，出口只有一个 `renderError`：

```js
class AppError extends Error {
  constructor({ code, message, httpStatus, details }) {          // code 是判别式字段
    super(message); Object.assign(this, { name: 'AppError', code, httpStatus, details, expose: true });
  }
}
let seq = 0;
function renderError(err, req, res, sink) {
  const requestId = 'req_' + (++seq);
  const business = err instanceof AppError;                 // 唯一的判据
  const httpStatus = business ? err.httpStatus : 500;       // 程序错误一律 500，不看它挂的 statusCode
  const body = business
    ? { error: { code: err.code, message: err.message, requestId, ...(err.details ? { details: err.details } : {}) } }
    : { error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试', requestId } };
  sink.push({                                               // 日志写全，响应写少
    level: httpStatus >= 500 ? 'error' : 'warn', requestId, url: req?.url,
    err: { name: err?.name, message: err?.message, stack: err?.stack, cause: err?.cause?.message, raw: String(err) },
  });
  res.statusCode = httpStatus; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body));
}
// 路由只写正常路径，异常沿调用栈往上冒：
//   try { res.end(JSON.stringify({ data: await route() })) } catch (err) { renderError(err, req, res, logs) }
```

十三种故障打进去，用 `/sk_live_|10\.244\.|node_modules|at Pool|in SQL:/` 扫每个响应体，全部「安全」。终端原文（末列是 `res.text().length`）：

```text
  /not-found           404   RESOURCE_NOT_FOUND          安全   77
  /email-taken         409   EMAIL_ALREADY_REGISTERED    安全   84
  /quota               429   RATE_LIMITED                安全   71
  /type-error          500   INTERNAL_ERROR              安全   81
  /db-down             500   INTERNAL_ERROR              安全   81
  /sql                 500   INTERNAL_ERROR              安全   81
  /status-400-program  500   INTERNAL_ERROR              安全   81
  /throw-string        500   INTERNAL_ERROR              安全   82
  /nested-cause        500   INTERNAL_ERROR              安全   82
```

`/type-error`、`/db-down`（内网 IP）、`/sql`（把 `sk_live_` 密钥拼进了报错原文）全部塌缩成同一个 81 字符的 500 响应。**内部信息不是「尽量别泄露」，而是结构上不可能泄露**——出口根本没读它们的 `message`；同一批日志里仍然完整记着 `"message":"connect ECONNREFUSED 10.244.3.17:5432"` 和含绝对路径的 `stack`。

`/status-400-program` 是被人为挂上 `statusCode = 400` 的程序错误，**出口没有采信它**，仍然给 500——凡是「谁都能改的字段」都不能当判据。`/throw-string` 是抛非 `Error` 值的后果（实测 `e.stack === undefined`、`instanceof Error = false`），日志只能记下 `String(err)`。`/nested-cause` 相反：`Error('配置文件解析失败', { cause: inner })` 让出口照旧给 500、日志单独记 `cause.message`——**序列化 `cause` 是日志的责任，不是响应的责任**。

**`requestId` 同时出现在响应体和日志里**——本节唯一不可省的设计：用户截图给你「错误编号 req_6」，你 `grep req_6` 就能看到完整栈。ID 写法见[日志与监控](/backend/logging-and-monitoring)。

<Callout type="verified" title="本章矩阵与退出码都是本机跑出来的">

Windows 10 x64 + Node v25.4.0，2026-10-18。服务器 `listen(0)` 起在临时端口、自己 `fetch` 自己；退出码由 `spawnSync(process.execPath, ['--input-type=module', '-e', 代码])` 逐条取回。如实交代三点：泄露正则是我自己写的，只能证明「这些已知敏感串没出现」，**且只扫了响应体、没扫响应头**；矩阵实跑 13 条，上面略去 `/syntax`、`/throw-object` 两条同类结果；临时脚本已删除。

</Callout>

## 为什么堆栈绝不能进响应

反例就一行：`catch (e) { res.end(JSON.stringify({ message: e.message, stack: e.stack })) }`，套在两层 `await` 的异步调用外面。实测响应体前 300 字符（总长 413）：

```text
{"message":"connect ECONNREFUSED 10.244.3.17:5432","stack":"Error: connect ECONNREFUSED 10.244.3.17:5432\n    at deeper (file:///D:/work/learns/backend/.scratch/errors.mjs:92:76)\n    at inner (file:///D:/work/learns/backend/.scratch/errors.mjs:92:130)\n    at file:///D:/work/learns/backend
```

一行之内泄露了四样东西：**内网 IP 与端口**（数据库在哪个网段、横向探测的起点）；**绝对路径**（操作系统类型、部署目录结构、源码文件名，文件名往往暴露业务）；**依赖与内部函数名**（精确匹配库版本，直接对着已知 CVE 打）；**完整 SQL、报错原文与密钥片段**（`/sql` 那条不需要利用链就能拿走可用的第三方凭据）。再加一条工程理由：客户端拿到栈**什么都做不了**，但响应体从 81 字符涨到 413，日志按 message 分组也失效——每个请求的栈行号不同，同一个 bug 会裂成无数个 issue。正确分配是：**栈只进日志，响应只给 `code` + 人类可读的 `message` + `requestId`。**

## 异步异常有两条路，进程行为有三种结局

`try/catch` 只覆盖同步阶段。下面十一种抛法逐条跑在子进程里，`exit=` 是真实退出码，`stdout` 是真实输出。

```text
  同步 throw，同步 try 包     exit=0   stdout: catch 到了: 同1
  async 抛，try 里漏 await    exit=1   stdout: catch 没执行
  async 抛，await + try       exit=0   stdout: catch 到了: 有await
  try 里注册定时器再抛        exit=1   stdout: (空)
  finally 里 return 吞掉 throw exit=0  stdout: 返回值: R
  抛字符串                    exit=0   stdout: typeof: string | e.stack = undefined | instanceof Error = false
  .catch 里再抛               exit=1   stdout: (空)
  注册了 uncaughtException    exit=0   stdout: A 前面的同步语句 / B 后面的同步语句 / 兜底 handler 收到: 炸了
  没注册 uncaughtException    exit=1   stdout: A 前面的同步语句 / B 后面的同步语句
  脚本中途同步抛（无 handler） exit=1   stdout: A 前面的同步语句
  脚本中途同步抛（有 handler） exit=0   stdout: A 前面的同步语句
```

三条硬结论：

1. **漏一个 `await`，`catch` 一次都不会执行**（第 2 行 stdout 就是「catch 没执行」），并且**进程以 1 退出**。服务端最经典的「日志里只有一句 unhandled rejection、请求返回一半」就是这么来的。
2. **`try` 里注册定时器再抛，什么都拦不住**（第 4 行 exit=1）：注册那行成功了，回调在之后的宏任务里执行，栈已经换；`setImmediate`/`process.nextTick` 同理。**`finally` 里的 `return` 会吞掉 `try` 的 `throw`**（第 5 行返回 `R`，异常消失），所以出口附近写 `finally` 只允许清理。
3. **注册 `uncaughtException` 后进程不退出（exit=0），但当前脚本剩下的同步代码整段放弃**——第 11 行里 `B 后面的同步语句` 没打印；对比第 9、10 行，定时器里的异常不影响主脚本跑完，**同步 throw 才当场中止**。兜底 handler 换来的不是「不崩」，而是「带着半完成状态继续活着」：锁没释放、连接池半开、事务没回滚。

## 未捕获异常打进正在处理的请求：客户端拿到什么

退出码还是「脚本」层面的，服务进程里的后果要真实起一个服务器才看得出。父进程用 `spawn` 起一个子进程跑服务器，对一个「故意不回应」的请求发 `fetch`：

```js
// 子进程：/inflight 分支不 res.end，30ms 后从定时器里抛一个没人接住的异常
const SERVER = `import http from 'node:http';
http.createServer((req, res) => { if (req.url === '/inflight') { setTimeout(() => { throw new Error('定时任务里没人接的异常'); }, 30); return; } res.end('ok'); })
  .listen(0, '127.0.0.1', function () { console.log('PORT ' + this.address().port); });`;
// 父进程：spawn(process.execPath, ['--input-type=module', '-e', SERVER])，从子进程 stdout 抓出端口号，
// 然后 try { await fetch('http://127.0.0.1:' + port + '/inflight') } catch (e) { console.log(e.name, e.message, e.cause?.code) }
// 最后 child.on('close', (code, signal) => console.log(code, signal))
```

实跑：

```text
  客户端 fetch 抛: TypeError: fetch failed
  e.cause: Error: read ECONNRESET | code=ECONNRESET
  子进程退出: exitCode = 1 | signal = null
  服务端 stderr: Error: 定时任务里没人接的异常  <-  at Timeout._onTimeout (file:///.../[eval1]:1:168)
```

三个必须据此设计的点：**客户端收到的是连接重置而不是 500**——没有响应体，`fetch` 直接 reject，所以前端不能只处理 `res.ok === false`，必须处理 `fetch` 本身抛错；**`read ECONNRESET` 在 `err.cause` 里，不在 `err.message` 里**——只 `log(err.message)` 会把「连不上、重置、超时」记成同一句 `fetch failed`，所以记录错误的地方都必须序列化 `cause`；**`exitCode = 1`、`signal = null`**——是 JS 层未捕获异常导致的主动退出，不是被 OOM killer 或 `SIGKILL` 干掉，这个区分决定了你去看代码还是去看内存监控。

兜底 handler 只做两件事，`uncaughtException` 与 `unhandledRejection` 各一个：`logger.fatal({ err })` 写全现场，然后 `process.exit(1)`。**绝不在这里继续服务**，重启交给容器；注意 `process.exit()` 不 flush stdout（[Node.js 运行时](/backend/node-runtime)已实测），要先等日志落盘。优雅关闭见[服务部署：Docker、优雅关闭与配置](/backend/docker-and-shutdown)。

## 出口挂在 Fastify 的哪个位置

Fastify 已经帮你把路由的异常兜住了，你要做的是替换那个默认出口。

<Callout type="unverified" title="下面这段 Fastify 写法未在本机运行">

本机没有安装 fastify（本章不装依赖），以下**没有执行过**；机制描述是我用 WebFetch 在 2026-10-18 读取 [Fastify 错误处理文档](https://fastify.dev/docs/latest/Reference/Errors/) 与 [钩子文档](https://fastify.dev/docs/latest/Reference/Hooks/) 核实的：

- 默认处理器「把错误序列化成含 `statusCode`、`error`、`message` 属性的 JSON 体」，且「堆栈跟踪不是默认载荷的一部分」。**不写任何错误处理代码也不会泄露栈**——但默认体里没有 `code`、没有 `requestId`，契约与可观测性仍然不合格，这才是你要写自定义出口的理由。
- 「这个错误处理器会在 Error 对象存在时采用其中的头部信息与状态码」，加上「statusCode 低于 500 本身并不是消息可以安全对外暴露的保证」——这正是 `/status-400-program` 那行担心的事。在自定义处理器里再抛新错误「会调用父级的 errorHandler」，重新抛出非 `Error` 值则落到默认处理器：**出口里不能再抛**。
- `onError` 钩子在自定义错误处理器**之前**触发，在其中调用 `reply.send()` 会抛异常——所以 `onError` 用来记日志、打点，**不能决定响应体**，决定响应体是 `setErrorHandler` 的活；`setNotFoundHandler` 则要用来让 404 走同一套结构，否则契约裂开（它的完整签名与触发条件我没取到原文，动手前请自己核对）。

</Callout>

## 重试与幂等的边界：五种实现，五个真实扣款次数

出口做对了只解决响应。异常一旦涉及**副作用已经完成但响应丢了**，就要处理重试与幂等。场景：第一次调用服务端执行成功、但响应被判定丢失，客户端重试。五种实现的终端原文（A 无键；B 有键、串行重试；C 有键但「先查后写」、同键并发两次；D 有键且「先原子占位」、同键并发两次；E 键卡在已占位未完成）：

```text
  A>>> 扣款次数 = 2 | 订单 = ["ord_1","ord_2"]
  B>>> 扣款次数 = 1 | 订单 = ["ord_1"] （串行重试下键生效）
  C| 同一把键并发两次（先查后写）: fulfilled:{"orderId":"ord_1","amount":100} | fulfilled:{"orderId":"ord_2","amount":100}
  C>>> 扣款次数 = 2 ← 竞态窗口导致重复扣款，幂等键形同虚设
  D| 同一把键并发两次（先占位，唯一约束）: fulfilled:{"orderId":"ord_1","amount":100} | fulfilled:{"orderId":"ord_1","amount":100}
  D>>> 扣款次数 = 1 ← 这才是正确的实现
  E| 键卡在「已占位未完成」（崩溃遗留）: 抛 IDEMPOTENT_REQUEST_IN_FLIGHT | 扣款次数 = 0
```

C 与 D 的唯一区别是占位是否原子：C 先 `db.keys.get(key)` 判断、再 `await`（真实项目里那是查一次缓存或 DB）、最后才 `set`，那个 `await` 就是竞态窗口；D 先做「不存在才写入」的原子占位（对应 `INSERT ... ON CONFLICT DO NOTHING`），占到才调网关，占不到就分两种情况——已完成直接回原结果、未完成抛 `IDEMPOTENT_REQUEST_IN_FLIGHT`。

**B 的成功是运气**：串行重试恰好没撞上那个窗口。规则是「占位与写入必须在同一个原子操作里」，而不是「我加了幂等键」。另外三条：**幂等键必须来自客户端**（服务端自己生成的键对「同一个用户按两次提交」毫无识别力，传输用 `Idempotency-Key` 请求头）；**「标记完成」要和副作用写进同一条事务**，否则副作用成功而键停在 in_flight，重试就重复扣款；**键要绑定用户与路由并带 `expires_at`**，E 行证明了没有 TTL 时一次崩溃会让这把键永久卡住合法请求。

| 情况 | 能不能重试 | 为什么 |
| --- | --- | --- |
| `PUT` / `DELETE`（同一个资源 id） | 能 | 语义幂等；第二次 `DELETE` 的 404 要按「目标状态已达成」处理（见[HTTP 与 REST 原理](/backend/http-and-rest)） |
| `POST` 无幂等键 | **不能自动重试** | A 行就是代价 |
| `POST` 带 `Idempotency-Key` 且服务端是 D 行 | 能 | 但要处理 in-flight 冲突（给 409，让客户端稍后再试） |
| 429 / 503（带 `Retry-After`）、4xx 业务错误 | 前者按退避重试，后者不能 | 服务端明确说了「等一下」；业务错误重试还是同一个错 |
| 收到 500 | **默认不能** | 副作用可能已经发生，除非整条链路幂等 |
| `ECONNRESET` / `ETIMEDOUT`（响应丢失） | 只有幂等才能重试 | 实测：这种失败**没有响应体可读**，你连状态码都拿不到 |

退避还要带抖动（jitter），否则一整批客户端会在同一时刻同时重试，把刚恢复的服务再打倒（重试风暴的完整讨论在[分布式会话、限流与幂等](/data-storage/session-rate-limit-idempotency)）。

## 常见错误与排查

**1. 出口里读 `err.message` 或 `err.statusCode`。** 现象：某天响应体里出现 SQL 或内网 IP。确认：把数据库密码改错、打一个接口看响应体（`/db-down` 就是这么造的）。修：判据改成 `instanceof AppError`；非业务错误**不看它的任何字段**，固定 500 + 固定文案。

**2. 超时后盲目重试非幂等接口。** 现象：重复下单、重复扣款、重复发短信。原因：`fetch` reject 不代表服务端没执行。确认：按 C 行那样并发跑一次看副作用次数。修：D 行的形状——先原子占位再执行副作用。

**3. 错误码满天飞、前端硬编码中文文案匹配。** 现象：改一句提示文案，前端分支失效。确认：全文搜 `message ===`、`includes('已被注册')`。修：建一张集中登记表，让「未登记的 code」和「code 与状态码漂移」在测试里直接失败：

```js
const CONTRACT = { RESOURCE_NOT_FOUND: 404, EMAIL_ALREADY_REGISTERED: 409, VALIDATION_FAILED: 400, RATE_LIMITED: 429, INTERNAL_ERROR: 500 };
function check(err) {
  if (!(err instanceof AppError)) return ['非业务错误必须被出口转成 INTERNAL_ERROR'];
  const p = [];
  if (!(err.code in CONTRACT)) p.push('code 未登记: ' + err.code);
  else if (CONTRACT[err.code] !== err.httpStatus) p.push(`状态码漂移: 登记 ${CONTRACT[err.code]} 实际 ${err.httpStatus}`);
  if (!/^[A-Z][A-Z0-9_]*$/.test(err.code ?? '')) p.push('code 命名不合规');
  return p;
}
```

实跑四条样例的返回值（放进单元测试就能挡住漂移）：

```text
  RESOURCE_NOT_FOUND      → []
  RESOURCE_NOT_FOUND      → ["状态码漂移: 登记 404 实际 500"]
  user_not_found          → ["code 未登记: user_not_found","code 命名不合规"]
  SMS_SEND_FAILED         → ["code 未登记: SMS_SEND_FAILED"]
```

## 练习

<Exercise title="练习 1 · 把七个错误分类填进表" difficulty="基础">

各判一类（业务 / 程序），写出应返回的状态码，以及 `message` 能否原文给客户端：① 邮箱已注册；② `connect ECONNREFUSED 10.0.0.8:6379`；③ 未登录访问受保护接口；④ `Cannot read properties of undefined (reading 'map')`；⑤ 请求体缺 `name`；⑥ 已登录但访问别人的资源；⑦ 第三方短信接口返回 502。

<template #answer>

① 业务 / 409 / 可以（产品文案）。② 程序 / 503 或 500 / **不可以**，含内网 IP。③ 业务 / 401 / 可以。④ 程序 / 500 / 不可以。⑤ 业务（入口契约）/ 400 / 可以，但只给字段名与规则。⑥ 业务 / 403 / 可以，但**别说出资源存在**。⑦ 程序（依赖故障）/ 502 或 503 / 不可以，但可以给「短信通道暂时不可用」。

</template>

</Exercise>

<Exercise title="练习 2 · 预测四种抛法的输出与退出码" difficulty="进阶">

不运行，先写出每个脚本的 stdout 和退出码，再用本章的 `spawnSync` 方式实测（都在 ESM 顶层，都不注册 handler）：

```text
a)  console.log('A'); throw new Error('x'); console.log('B')
b)  console.log('A'); Promise.reject(new Error('x')); console.log('B')
c)  console.log('A'); (async () => { throw new Error('x') })(); console.log('B')
d)  console.log('A'); try { await (async () => { throw new Error('x') })() } catch { console.log('C') } console.log('B')
```

<template #answer>

a：只有 `A`，exit 1（同步未捕获异常当场中止脚本）。b：`A` `B`，exit 1（`Promise.reject` 没人接，异常在**微任务**里才变成 unhandled rejection，此时同步脚本已经跑完）。c：`A` `B`，exit 1（IIFE 立即执行但返回 rejected Promise，没人 `await` 就等于 b）。d：`A` `C` `B`，exit 0（`await` + `try` 是唯一正确的组合）。

b 和 c 最该刻住：**「同步代码全部执行完毕」和「进程随后以 1 退出」是两件事**——访问日志都打完了进程才死，而客户端其实拿不到响应（本章实测 `ECONNRESET`）。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误：绕过自己的防线把内部信息漏出去" difficulty="挑战">

本章出口已经保证非业务错误不带 `message`。请设计**三种仍然会泄露内部信息**的写法（也就是绕过自己这道防线的错法），并说明每种怎么测出来。

<template #answer>

**写法一：出口读了 `err.statusCode`。** `reply.code(err.statusCode ?? 500)` 之后，任何人（包括依赖库）给错误挂个 `statusCode: 400`，出口就走「不是程序错误」的路径；再写一句 `if (httpStatus < 500) body.message = err.message`，内部文案就出去了。测法：本章 `/status-400-program`——人为造一个 `statusCode = 400` 的程序错误，断言响应仍是 500 且 body 固定。

**写法二：业务错误类被滥发。** 有人在 service 里图省事 `throw new AppError({ code: 'DB_FAIL', message: dbErr.message, httpStatus: 500 })`，它 `instanceof AppError` 为真，出口就把 `message` 原样发出去了。**判据不能只看类型，还要看 `httpStatus` 与 `code` 是否一致**：用 `CONTRACT` 表 + `check()` 把「5xx 的 code 不许带自由 message」写成规则，再在单元测试里遍历所有会抛的 `AppError` 断言这一点。

**写法三：响应头与附带信息。** 状态码和 body 都干净，但出口里写了 `reply.header('x-debug-target', process.env.DATABASE_URL)`（调试期加的忘了删），或 `details` 带了内部限流桶名。测法：**别只看 body**——把完整响应头一起 dump 出来做正则扫描（`sk_live_|postgres://|10\.\d|/app/|node_modules`）。本章检测脚本就只扫了 body，verified 框里已写明它证明不了响应头干净。通用手段是给集成测试加一个「响应体与响应头脱敏断言」中间件。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Fastify 错误处理](https://fastify.dev/docs/latest/Reference/Errors/) 与 [Fastify 钩子](https://fastify.dev/docs/latest/Reference/Hooks/) —— 核实默认错误体只含 `statusCode`/`error`/`message`、栈不在默认载荷里、处理器会采用 Error 上已有的状态码与头部、自定义处理器里再抛会走父级处理器，以及 `onError` 早于 `setErrorHandler` 触发。2026-10-18 WebFetch 读取；本章 Fastify 段落据此写成并标 unverified。
- [Node.js `process` 文档](https://nodejs.org/docs/latest/api/process.html) 与 [错误码约定](https://nodejs.org/docs/latest/api/errors.html) —— 核实 `uncaughtException` 不适合用来让进程继续运行、`exitCode` 的语义（本章退出码为实测值，默认行为以你所用版本为准），以及系统错误自带 `code` 字段：**它与本章业务错误的 `code` 是两套命名空间**，别让 `err.code === 'ECONNRESET'` 被登记成业务码。

## 下一章

接下来要让「谁在调这个接口」进入这条链路。[认证：Session、Cookie 与密码哈希](/backend/auth-session) 解决三件事：口令该怎么存（那一章会把 scrypt 的参数阶梯、每秒可尝试次数和 Node 默认 `maxmem` 挡住哪一档参数实测出来）、登录态怎么在服务端与浏览器之间往返（`Set-Cookie` 每个属性各防谁）、以及为什么 `SameSite` 和 CSRF 令牌是两道不能互相替代的防线。
