# Node.js 运行时：模块、事件循环与流——为什么一段同步循环能让整个服务不响应

你的接口本地压测正常，上线后偶尔一个请求慢，接着**所有接口一起变慢**，健康检查也开始超时。看监控，CPU 只用了 12%，内存正常，数据库没有慢查询。你在日志里加了一行「进入处理函数」，发现这条日志在慢的那几秒里**一条都没有**——不是数据库慢，是根本没有代码在跑。原因是有人在导出报表的接口里写了个 `for` 循环同步拼 50 万行 CSV。Node 只有一个事件循环，那段循环把唯一的线程占住了，其他所有连接排在后面。

另一个典型故障：`npm run dev` 起来后，你把 `package.json` 加了 `"type": "module"`，紧接着满屏 `ReferenceError: require is not defined in ES module scope`、`SyntaxError: Cannot use import statement outside a module`。你以为是 TypeScript 或依赖坏了，其实是同一个 `.js` 后缀被两套模块系统按不同规则解释。

第三个：产品要支持导出 2GB 日志。你用 `fs.readFile` 把整个文件读进内存转 base64 再发出去，容器 OOM 被杀。改成流之后内存稳定在 30MB。中间隔着的概念就叫**背压（backpressure）**。

这三个故障的共同点是：它们都不是「代码写错了」，而是**你以为 Node 在按某种方式调度，实际不是**。这一章把三件事讲清楚：Node 作为宿主环境与浏览器的差别、CommonJS 与 ES Modules 在 Node 里的真实差异、事件循环的阶段模型与流的位置。前置：[事件循环、Promise 与 async/await](/javascript/asynchronous)（微任务与宏任务的基础模型，本章直接扩展它）、[ES 模块、动态导入与迭代器](/javascript/modules-and-iterators)（语言层的 `import`/`export` 语法）。本章所有顺序和数字都在本机 Node v25.4.0 实跑，贴的是终端原文。

## Node 与浏览器是两个宿主：能力表与缺失表

[异步那一章](/javascript/asynchronous)说过：JS 引擎只有一个调用栈，能并发靠的是**宿主环境**在栈外把活干完再把回调排回来。浏览器提供的栈外能力是网络栈、定时器线程池、DOM 事件与渲染流水线；Node 提供的是 **libuv**（事件循环 + 线程池）、操作系统接口（文件、进程、信号、socket）和一批内置模块。语言层（ECMAScript）在两边完全一致——`Promise`、`await`、微任务语义没有任何差别，**所有「Node 特有的行为」都来自宿主**。

| 能力 / 概念 | 浏览器 | Node |
| --- | --- | --- |
| DOM、`window`、`document`、`localStorage` | 有 | **没有**。全局对象是 `globalThis` + `process`、`console`、`Buffer` |
| 同源策略、CORS | 强制，浏览器拦截跨源请求 | **不存在**。服务端可以请求任何地址，CORS 只是浏览器的规则，别在服务端「设 CORS 来保护自己」 |
| 文件 / 网络 / 子进程 / 信号 | 沙箱内不允许 | 全部可以，见 `node:fs`、`node:net`、`node:child_process`、`process.on('SIGTERM')` |
| 内置模块前缀 | 无此概念 | 一律写 `node:` 前缀（`import fs from 'node:fs'`），避免与 npm 包同名冲突 |
| 模块系统 | 只有 ESM（`import`） | **ESM 与 CommonJS 双轨共存**，由后缀与 `package.json` 的 `type` 决定 |
| I/O 并发来源 | 浏览器网络栈 / 定时器线程池 | libuv 事件循环 + 线程池（文件 IO、DNS、部分 crypto） |
| 宏任务组织 | 一条 task queue + 渲染步骤 | libuv 的多个阶段（timers / poll / check / close），**没有渲染帧** |
| `process.nextTick` | 不存在 | 存在，Node 专有队列，优先于微任务（下文实测） |
| `setImmediate` | 不存在 | 存在，落在 check 阶段 |
| `requestAnimationFrame` | 存在 | 不存在，也没有「帧」的概念 |
| 阻塞后果 | 页面卡住、动画掉帧 | **所有请求一起停**，包括健康检查 |
| 模块级可变状态的共享范围 | 每个页面重新加载 | **同一进程内所有请求共享**（下文实测并发计数） |

最后一行值得单独强调。浏览器里一个页面出问题最多影响自己；Node 里一个进程服务全站流量，模块作用域里写 `let cache = {}` 就是全局状态，同步死循环就是全站瘫痪。这一章末尾的「阻塞」一节和第 2 章的「并发下状态混乱」都是这个差别的直接后果。

顺带一个能省两小时的问题：**为什么 Node 里 `require('express')` 不写 `node:` 前缀也没事**。Node 的解析顺序是「内置 → 路径 → 包的 `main`/`exports`」，`node:` 前缀的作用是**强制走内置那一档**。写 `require('fs')` 在早期能跑，但如果哪天有人发布了一个叫 `fs` 的包、或者你的依赖树里出现了同名包，行为就变了。统一加前缀是无成本的正确做法。

## CommonJS 与 ES Modules：不是语法糖差异，是两套加载机制

先给判定规则（Node 侧，语言层的模块规则见 [ES 模块、动态导入与迭代器](/javascript/modules-and-iterators)）：

| 文件形态 | 被当成 |
| --- | --- |
| `.mjs` | 一定是 ES Module |
| `.cjs` | 一定是 CommonJS |
| `.js`，**最近的** `package.json` 里 `"type": "module"` | ES Module |
| `.js`，`package.json` 没有 `type` 或为 `"commonjs"` | CommonJS |
| `.ts` / `.mts` / `.cts` | 由 TypeScript 编译目标与运行时的加载器决定，本站后端统一用 `"type": "module"` + `.ts` |

「最近的 `package.json`」是关键：Node 从文件所在目录**向上找第一个含 `type` 字段的 `package.json`**，找到就按它判，找不到默认 CommonJS。子目录里放一个自己的 `package.json` 就能改变那一棵树的后缀语义——某些库正是这么在 `type: module` 的包里塞几个 CJS 文件的。

两者的真实差异（不是「写法不同」，是**加载时机与能力不同**）：

| 维度 | CommonJS | ES Modules |
| --- | --- | --- |
| 语法 | `require()` / `module.exports` | `import` / `export` |
| 加载时机 | **运行时、同步**，执行到那一行才加载 | **静态声明、异步**，`import` 声明在代码执行前就被解析（hoisting） |
| 条件加载 | `if (x) require('y')` 直接可行 | 静态 `import` 不能放 `if` 里，要用动态 `import()` 返回 Promise |
| 循环依赖 | 拿到「已执行到一半」的 `exports`，静默出 `undefined` | 静态绑定 + TDZ，常报 `Cannot access 'x' before initialization` |
| 路径解析 | 可省略扩展名与目录（`require('./util')` 命中 `util.js` / `util/index.js`） | **必须写全**：`import './util.js'`，省略扩展名报 `ERR_MODULE_NOT_FOUND` |
| 目录 index | `require('./dir')` 命中 `dir/index.js` | 不支持，必须写到具体文件 |
| 顶层 `await` | **不支持** | 支持 |
| 文件级全局 | `__dirname`、`__filename`、`require`、`module`、`exports` | 全部没有，改用 `import.meta.url` 等 |
| `this` | `module.exports` | `undefined` |
| 缓存 | `require.cache`，按解析后的绝对路径 | 模块记录表，一个 URL 一个实例，两边都只加载一次 |

### 本机实测：两套全局的可用性

下面这几行报错我都在 Node v25.4.0 真实跑出来了，可以直接背下来当排查手册。ESM 侧（`node --input-type=module`，从标准输入执行）：

```text
M1 __dirname 抛错: ReferenceError: __dirname is not defined
M2 require 抛错: ReferenceError: require is not defined
M3 import.meta.url -> file:///D:/work/learns/[eval1]
M4 typeof import.meta.resolve -> function
M5 createRequire 拿到 package.json 类型: object
```

CommonJS 侧（`node --input-type=commonjs`）：

```text
C1 __dirname -> .
C2 typeof require -> function | typeof module.exports -> object
C3 require 内置模块 OK: a\b
C5 typeof exports -> object | import 语句作为声明会在此文件编译期就报错
C4 CJS 里动态 import() OK: function
```

两个细节值得注意。**第一，`C4` 打在 `C5` 后面**：动态 `import()` 返回 Promise，即使调用点写在同步代码里，被导入的模块也要等微任务之后才可用；这就是「CJS 里可以用 `import()`，但不能用 `import` 声明」的实际表现。**第二**，我一开始想验证 CommonJS，用的是 `node -`（不带 `--input-type`），结果拿到的是这条报错：

```text
ReferenceError: __dirname is not defined in ES module scope
    at file:///D:/work/learns/[eval1]:1:54
```

因为本项目根目录的 `package.json` 写了 `"type": "module"`，**连 `-e` 和标准输入求值的默认语言都被它带跑了**。我随后单独验证过：`node -e "const v = await Promise.resolve(1); console.log(v)"` 在这个目录里直接输出 `1`——顶层 `await` 能用，说明 `-e` 的字符串被当成 ESM 解析了。这是个真实踩坑点：把调试命令复制到不同 `type` 的目录里，行为会不一样。

CommonJS 里想用 `import.meta` 的报错更狠，是**编译期**错误，`try/catch` 拦不住：

```text
SyntaxError: Cannot use 'import.meta' outside a module
    at makeContextifyScript (node:internal/vm:194:14)
```

### 互操作：正确写法

**ESM 里要用 CJS**（最常见：某些老包的 `require` 专用配置、或要读 JSON）：

```js
// ESM：读 JSON 不再支持 import 之外的 assert 语法差异，用 createRequire 最稳
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);   // 上面 M5 就是这么跑通的
const pkg = require('../package.json');           // 直接拿到对象，不用管扩展名

// __dirname 的等价替换：这一行建议抄进你的工具模块
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

**CJS 里要用 ESM**：只能用动态 `import()`，且必须等 Promise：

```js
// CommonJS 文件
module.exports = async function handler() {
  const { someEsmOnlyLib } = await import('some-esm-only-lib');  // 见 C4：异步
  return someEsmOnlyLib();
};
```

反过来——**CommonJS 里写 `await import()` 的顶层**、或 `require()` 一个含顶层 `await` 的 ES 模块——是版本敏感的高风险区。

<Callout type="unverified" title="require 能否加载 ES 模块，请动手前核对官方文档">

较新的 Node 引入了在 CommonJS 中同步 `require()` 部分 ES 模块的能力，但它对**含顶层 `await` 的模块**仍然受限，且这项能力的默认开关与稳定级别在各版本间变过好几次。我没有在本机为这一条构造真实文件跑通（需要额外的 `.mjs`/`.cjs` 测试文件），所以**本章不断言它在你手上的 Node 版本里默认开启**。写代码时的稳妥规则是：**一个包内部只选一种模块系统作为主形态**，跨系统边界时显式用 `createRequire` 或动态 `import()`，别指望隐式互操作。以 [Node.js 模块 API 文档](https://nodejs.org/docs/latest/api/modules.html) 与 [ESM 文档](https://nodejs.org/docs/latest/api/esm.html) 的当前版本为准。

</Callout>

选型建议，针对本站后端：**统一 ESM**。理由是三点——静态 `import` 让打包器和分析工具能查死引用；顶层 `await` 让「启动时等配置加载完」这类逻辑写在模块顶层就够；`import.meta.url` 比 `__dirname` 更符合 URL 语义（Windows 路径问题少）。**唯一必须记住的代价**：`import` 相对路径要写扩展名，以及 CJS 生态的老包要用 `createRequire` 兜。

## 事件循环的阶段模型：与浏览器逐条对照

[异步那一章](/javascript/asynchronous)给的模型是「同步栈跑空 → 排空微任务 → 取一个宏任务 → 再排空微任务」。这个模型在 Node 里**依然成立**，只是「宏任务队列」被换成了 libuv 的多个阶段。一轮 tick 的大致顺序：

```text
进程启动（once） → 执行主模块（脚本）
        ↓
   ┌───────────────────────────── 事件循环的一轮 ─────────────────────────────┐
   │  timers          到点的 setTimeout / setInterval 回调                    │
   │  pending cb      上一轮某些系统操作的回调                                │
   │  idle / prepare  内部使用                                                │
   │  poll            新的 I/O：读文件、收请求、socket 数据到达（也会在这里等）│
   │  check           setImmediate 回调                                       │
   │  close cb        close 事件回调，如 socket.on('close')                   │
   └──────────────────────────────────────────────────────────────────────────┘
        ↑ 每个阶段之间、每个回调之后：先跑 process.nextTick 队列，再排空微任务队列
```

浏览器与 Node 的对照表（**必背**，第 2 章和第 4 章的行为解释都靠它）：

| 概念 | 浏览器 | Node | 本章是否实测 |
| --- | --- | --- | --- |
| 微任务队列 | `Promise.then/catch/finally`、`queueMicrotask`、`await` 恢复 | 完全相同的语义与来源 | 是 |
| `process.nextTick` | 无 | Node 专有队列，**排在微任务之前**（回调上下文中实测） | 是 |
| 宏任务组织 | 一条 task queue，按来源投递 | libuv 多阶段队列 | 是 |
| `setImmediate` | 无 | check 阶段 | 是 |
| `setTimeout` | task queue（定时器任务源） | timers 阶段 | 是 |
| 渲染步骤 / rAF | 有，一帧一次 | 无 | — |
| 嵌套 5 次后最小 4ms | HTML 规范规定 | 无此规则（`delay` 小于 1 设为 1） | — |
| 饿死宏任务 | 微任务递归会让 `setTimeout` 不响 | `nextTick` / 微任务递归会饿死**所有阶段**，包括 poll | 是（nextTick 递归） |
| 阻塞表现 | 页面卡住 | 所有请求停摆 | 是（50ms → 728ms） |

### 实测一：顶层与回调里，顺序不一样

同一段代码（`node --input-type=module`，Node v25.4.0，2026-10-17），我在顶层注册 `setTimeout(0)`、`setImmediate`、`queueMicrotask`、`Promise.then`、`process.nextTick`，然后在 `fs.readFile` 的回调里再注册一遍。终端原文：

```text
=== 第一段：顶层（脚本阶段）===
A1 同步开始
A7 同步结束
=== 第四段：阻塞实测 ===
B7 死循环跑了 700ms，空转次数约 5,680,139
A4 queueMicrotask
A5 promise then
A6 nextTick
A3 setImmediate
A2 setTimeout(0)
B6 计划 50ms 后，实际耗时 728 ms
=== 第二段：I/O 回调内 ===
=== 第三段：nextTick 递归 vs 微任务递归 ===
B3 nextTick
B5 nextTick 递归结束，次数 3
B4 promise then
B2 setImmediate
B1 setTimeout(0)
```

读法分三块：

| 场景 | 观察到的顺序 | 结论 |
| --- | --- | --- |
| I/O 回调内（`readFile`） | `nextTick` → `promise then` → `setImmediate` → `setTimeout` | 回调上下文里 **nextTick 确实在微任务之前**，与官方文档一致 |
| 顶层（ESM） | `queueMicrotask` → `promise then` → `nextTick` → `setImmediate` → `setTimeout` | **微任务抢在了 nextTick 前面**，与上一条不同 |
| 顶层（CommonJS） | `nextTick` → `queueMicrotask` → `promise then` → … | 与 I/O 回调一致 |

第三行是另一段实测（`node - <<EOF`，`--input-type` 未指定即 CommonJS）：

```text
CJS-C1 同步开始
CJS-C7 同步结束
CJS-C6 nextTick
CJS-C4 queueMicrotask
CJS-C5 promise then
CJS-C3 setImmediate
CJS-C2 setTimeout(0)
CJS-D3 定时器回调内 nextTick
CJS-D4 定时器回调内 promise then
CJS-D2 定时器回调内 setImmediate
CJS-D1 定时器回调内 setTimeout
```

**这张表最有价值的两点**：

1. **顶层顺序取决于模块系统**。在 ESM 里，主模块的求值本身是被包在一个 Promise 任务里跑的，同步体一结束就先过了微任务检查点，所以 `queueMicrotask` / `Promise.then` 的回调先跑完，才轮到 `nextTick` 队列；CommonJS 的主模块是普通同步脚本，结束后先进 `nextTick` 队列。这是「文档说 nextTick 优先」与你在 ESM 入口看到的顺序打架的根因。**机制解释属于我的推断**（我实测的是顺序，不是内部实现），但**顺序本身是实测事实**，可以据此排查。
2. **`setImmediate` 与 `setTimeout(0)` 的相对顺序在顶层不确定，在回调里确定**。顶层两个都是「本轮之后」，谁先取决于定时器创建耗时与 libuv 轮询时机，官方文档明确说不可依赖；但在 I/O 回调里，poll 阶段之后一定是 check（`setImmediate`），再到下一轮 timers，于是 `D2` 稳定早于 `D1`。**要「本次 I/O 之后、其他请求之前」就用 `setImmediate`，别用 `setTimeout(0)`。**

`B3` / `B5` 那两行还证明了一件事：`nextTick` 回调里再 `nextTick`，会在**同一个 tick 内递归跑完**才允许进入微任务和其他阶段。把递归条件写错（比如忘了 `n < 3`）就是「服务端再也不处理任何新请求」的经典死法。

<Callout type="verified" title="以上顺序与数字来自本机一次运行">

环境：Windows 10 x64 + Node v25.4.0，2026-10-17。命令形态是把脚本通过标准输入交给 `node --input-type=module` 或 `node --input-type=commonjs` 执行（`node --input-type=module - <<'EOF' … EOF`），用 `console.log` 打印顺序、`Date.now()` 差值计时。定时器实际耗时受机器负载影响，**顺序可复现，毫秒数不可当规格引用**。

</Callout>

## 阻塞事件循环：一个 while 让 50ms 变成 728ms

上面那两次实跑里最该抄进事故手册的是这两行：

```text
B7 死循环跑了 700ms，空转次数约 5,680,139
B6 计划 50ms 后，实际耗时 728 ms
```

**定时器回调在同步代码跑完之前不可能执行**，这不是「不准」，是「根本拿不到线程」。`setTimeout` 的 50ms 只是「什么时候变成到期」，到期后要等事件循环有空去跑它。把这段循环换成「解析 30MB JSON」或「同步遍历 20 万条记录」，就是文章开头那个「CPU 12%、接口集体变慢」的现场。

服务端把阻塞放大成故障的路径很直接：

```text
一个请求进入 → 处理函数同步跑了 800ms
    ↓ 这 800ms 内
    · 新连接的 TCP 握手可以被内核 accept 队列接住，但不会进入 JS
    · 已建立的连接上的第二个请求：数据到了，回调排队 → 客户端超时
    · /healthz 健康检查：同样是回调 → 同样超时 → 负载均衡判定实例不健康 → 摘流量
    · 摘流量后剩下的实例接到更多请求 → 每个都同步阻塞 → 雪崩
```

**判断是不是阻塞问题**，不看 CPU 使用率（忙等会打满一个核，但整体看着不高），看这三样：

```bash
# 1. libuv 线程池与事件循环延迟：lag 持续几十毫秒以上就有同步在抢线程
node --cpu-prof --heap-prof server.js        # 采样式 CPU profile，产出 .cpuprofile 用 Chrome DevTools 打开

# 2. 进程内自检：注册一个每 100ms 的定时器，打印实际间隔
#    间隔稳定 =100ms 说明没被阻塞；出现 300/700/1500 就是同步代码在抢
setInterval(() => {
  const lag = Date.now() - expected; expected += 100;
  if (lag > 50) console.warn('事件循环延迟', lag, 'ms');
}, 100);

# 3. 生产环境更正规的做法：monitorEventLoopDelay()（nodeperf_hooks）
```

**修法按「这段工作能不能异步化」分两类**：

| 情况 | 做法 |
| --- | --- |
| 本来就是 I/O（读文件、查库、调第三方） | 换成异步 API：`fs.readFileSync` → `await fs.promises.readFile`；同步 crypto（`crypto.pbkdf2Sync`）→ 异步版（`crypto.pbkdf2`）。密码哈希这类「看起来是 CPU 活」实际会被 libuv 线程池接住，见[认证：Session、Cookie 与密码哈希](/backend/auth-session) |
| 真是 CPU 密集（压缩、图片、大 JSON、复杂排序） | 移出去：`worker_threads` 起工作线程；或 `child_process` 起子进程；或**丢进队列由独立 worker 进程慢慢做**（推荐，见[文件上传、定时任务与后台作业](/backend/uploads-and-jobs)与[为什么需要异步解耦](/message-queue-cloud/why-async)） |
| 只是偶尔慢、又必须同步 | 把循环切片：每处理 N 条就 `await new Promise(r => setImmediate(r))` 让出一次事件循环。这是「协作式让出」，能把 800ms 的单次阻塞变成一串可被打断的小块 |

第三种救急写法要理解代价：让出之后其他回调会插进来执行，你的中间状态必须是自洽的，不能假设「两次循环之间没人动我的数据」——这就接到了下一节的流。

## Buffer 与流：大文件的唯一正确处理方式

`Buffer` 是 Node 对一段原始字节的标准表示，`Buffer.alloc(1024)` 得到一个长度 1024 的字节容器（本机实测 `S3 Buffer.alloc(1024) 构造器: Buffer byteLength: 1024`）。字符串与 Buffer 的边界要拎清楚：**字符串是 UTF-16 语义的文本，Buffer 是字节**。`buf.toString('utf8')` 只有在缓冲区里装着**完整字符**时才安全——把一条 500KB 的流每 64KB 切一刀再各自 `toString`，切口处的中文多半变成 ``。正确做法用 `pipeline` 加 `string_decoder`，或者干脆全程保持字节。

一次性读进内存 vs 流式，两种写法的差别只有一句话：**前者的峰值内存等于文件大小，后者等于 `highWaterMark`**。

```js
// 反面：2GB 文件 → 进程 RSS 冲到 2GB+ → 容器 OOMKilled
const buf = await fs.promises.readFile('huge.log');
res.end(buf.toString('base64'));

// 正面：内存恒定，慢的消费者会反过来让生产者停下来
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
await pipeline(createReadStream('huge.log'), res);
```

`highWaterMark`（高水位线）是流内部缓冲区的字节阈值，超过它 `write()` / `push()` 就返回 `false`，这个返回值就是**背压信号**。本机实测（Node v25.4.0）：

```text
S1 createReadStream readableHighWaterMark: 65536
S2 流式读取 backend/index.md：块数 1 字节 12174 首块类型 Buffer
S3 Buffer.alloc(1024) 构造器: Buffer byteLength: 1024
S4 连续 12 次 write 返回值(1=true,0=false): 1,0,0,0,0,0,0,0,0,0,0,0
S5 writableLength: 98304  writableHighWaterMark: 16384
```

这张输出里有三个能直接用于排查的事实：

1. `fs.createReadStream` 的 `readableHighWaterMark` 是 **65536（64 KiB）**，普通 `stream.Writable` / `Readable` 默认是 **16384（16 KiB）**。别在代码里硬编码 8KB，除非你显式传了 `highWaterMark`。
2. `S4` 那串 `1,0,0,0,0,...`：**只有第一次 `write()` 返回 `true`**，之后连续返回 `false`，因为每个 chunk 是 8 KiB、高水位 16 KiB、而我的 sink 每 10ms 才消费一块。`false` 的意思不是「失败」，是「缓冲区已经堆到阈值，你该停了」。
3. `S5` 的 `writableLength: 98304` 说明**即使返回 `false`，Node 仍然把数据收进了缓冲区**——它不会拒绝你的写入。忽略 `false` 的后果是缓冲区无上限增长，直到内存耗尽。这就是「用流但还是 OOM」的成因。

正确的背压处理两种，优先第一种：

```js
// 姿势一：pipeline 自己处理背压与错误清理，永远优先用它
import { pipeline } from 'node:stream/promises';
await pipeline(createReadStream(src), createGzip(), createWriteStream(dst));

// 姿势二：手写异步循环时必须等 drain
for await (const chunk of readable) {
  if (!writable.write(chunk)) {
    await once(writable, 'drain');   // 缓冲区降到高水位以下时触发
  }
}
writable.end();
```

`drain` 事件的含义是「缓冲区终于降到高水位以下，可以继续写了」。实测里 `writableLength` 从 98304 一路被 10ms 一次的消费掏空，期间就会触发 `drain`（见第 2 章的读 body 例子）。

三种常见误用，每一条都能让线上出事：

| 误用 | 后果 | 正确做法 |
| --- | --- | --- |
| `readable.pipe(writable)` 但不用 `pipeline` | `writable` 出错时 `readable` 不会被关闭 → **文件描述符泄漏**，久了报 `EMFILE: too many open files` | 一律用 `pipeline()`，它会传播错误并清理所有流 |
| 手写 `readable.on('data')` + `writable.write()` 不管返回值 | 读得比写得快时无限堆积；「背压失效」= 内存爆炸 | 用 `for await` + 等 `drain`，或 `pipeline` |
| 以为 `pipe` 会自动 `end` 目标流，或以为它不会 | `pipe` 默认会 `end` 目标（可用 `{ end: false }` 关掉），但**不会**在源头出错时结束目标 | 明确用 `pipeline`，行为可预测 |

<Callout type="verified" title="顺带实测到一个顶层 await 的坑">

那次流实验的最后一步写了 `await finished(slow)`，而这个 `Writable` 我忘了调 `.end()`，于是 `'finish'` 永远不会触发。Node 没有卡住等我，而是直接退出并打印：

```text
Warning: Detected unsettled top-level await at file:///D:/work/learns/[eval1]:20
await finished(slow);
^
```

进程退出码是 **13**。这是「顶层 await 等一个永远不会定下来的 Promise」的标准症状，报错信息里 `Detected unsettled top-level await` 这串字很有辨识度。服务启动脚本里如果卡在「没有任何日志就退出了」，先看是不是这个。

</Callout>

## 进程与环境变量：配置读取的正确姿势

Node 给每个进程的东西比浏览器多，也更容易写出「本地能跑线上崩」。

```js
process.env.NODE_ENV            // 一定是 string 或 undefined，没有 boolean
process.argv                    // [node 路径, 脚本路径, ...用户参数]
process.exitCode = 1            // 优先设置它，而不是直接 process.exit(1)
process.cwd()                   // 启动时的工作目录，与「脚本所在目录」不是一回事
__dirname（CJS）/ fileURLToPath(import.meta.url)（ESM）
```

三个必须记住的点：

**一，`process.env` 的每个值都是字符串。** `NODE_ENV=0` 或 `DEBUG=false` 传进来都是**非空字符串**，`if (process.env.DEBUG)` 恒为真——这类 bug 排查起来极其费时间。写一个显式的转换函数并只在启动时读一次：

```ts
// config.ts：入口集中校验，缺配置就在启动期炸掉，不要等第一个请求
import { z } from 'zod';   // 或自己写校验，见下文

const Schema = z.object({
  PORT: z.coerce.number().int().default(3000),        // coerce 处理 string → number
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  RATE_LIMIT_MS: z.coerce.number().int().positive().default(1000),
});

export const config = Schema.parse({
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  RATE_LIMIT_MS: process.env.RATE_LIMIT_MS,
});
```

好处是：**配置错误在启动那 100ms 暴露**，而不是等第一个请求踩到 `undefined`。容器里启动失败会被编排系统反复重启并打出明确日志，比「进程活着但所有接口 500」好定位得多。

**二，别在模块顶层用 `process.exit()`。** 它立即终止进程，**不等待 I/O 完成、不 flush stdout**，你的错误日志可能一条都没写出去。用 `process.exitCode = 1` 然后让事件循环自然结束，或者显式 `await` 关闭资源后再退出。优雅关闭（SIGTERM → 停止接新请求 → 等存量请求完成）是[服务部署：Docker、优雅关闭与配置](/backend/docker-and-shutdown)的主题。

**三，`.env` 文件是开发便利，不是运行时机制。** Node 本身不会读 `.env`（较新版本有 `--env-file` 这类开关，但**默认行为与选项名请以 [process 文档](https://nodejs.org/docs/latest/api/process.html) 当前版本核对**，本章未实测）。生产环境应当由部署平台注入真实环境变量，代码里永远不要出现「读 `.env` 文件」的分支——那意味着密钥被打包进了镜像。

## 常见错误与排查

**1. `ReferenceError: require is not defined in ES module scope`（或 `__dirname is not defined in ES module scope`）。** 现象：加了 `"type": "module"` 或把文件改成 `.mjs` 之后满屏这个错。**本章已实测**两条原文（`ReferenceError: __dirname is not defined`、`ReferenceError: require is not defined`）。原因：文件被 Node 判成 ESM，而 ESM 没有 CJS 那套文件级全局。确认：检查**从该文件向上第一个** `package.json` 的 `type` 字段；或临时把文件改名为 `.cjs` 看是否立刻能跑。修法：`require` → 顶部 `import`；`__dirname` → `path.dirname(fileURLToPath(import.meta.url))`；确实要读 JSON 或调老包就显式 `createRequire(import.meta.url)`。

**2. `SyntaxError: Cannot use import.meta outside a module` / `Cannot use import statement outside a module`。** 现象：CJS 文件里写了 `import.meta`，或 `type` 为 `commonjs` 的包里写了 `import` 声明。原因：这是**编译期**语法错误（本章实测原文 `SyntaxError: Cannot use 'import.meta' outside a module`），`try/catch` 拦不住，因为它发生在解析阶段。确认：看栈顶有没有 `makeContextifyScript`。修法：把该文件的模块形态改正（改后缀或改 `type`），或把 `import()` 写成动态导入。

**3. 定时器/微任务顺序和预期不一致，`nextTick`「没排在最前面」。** 现象：你按「`process.nextTick` 优先于所有微任务」写断言，结果在 ESM 入口脚本里失败。原因：主模块的求值形态（ESM 是 Promise 任务，CJS 是普通脚本）改变了检查点顺序——本章两张实测表就是这个现象的证据。确认：把同一段代码分别用 `--input-type=module` 和 `--input-type=commonjs` 各跑一次，对比顺序。修法：**别依赖顶层顺序**。要「本次操作结束后立刻做」在回调/处理函数内用 `nextTick`，要「I/O 之后、下一轮之前」用 `setImmediate`；测试断言应写成「集合相同、相对顺序符合阶段规则」，而不是硬编码一条全局顺序。

**4. 服务整体变慢但 CPU、内存、数据库都正常。** 现象：健康检查偶尔超时，日志里出现长时间空档。原因：事件循环被同步代码阻塞（本章实测：700ms 循环让 50ms 定时器变成 728ms）。确认：跑一个每 100ms 的自检定时器打印 lag；或用 `--cpu-prof` 采 profile 看火焰图里有没有长长的同步栈。修法：I/O 换异步 API；CPU 密集移出（worker / 子进程 / 队列）；救急就把大循环切片 + `setImmediate` 让出。

**5. 用了 `pipe` 还是把内存打爆。** 现象：下载/转码大文件时 RSS 一路上扬，最终 OOM。原因：忽略了 `write()` 的返回值（实测那串 `1,0,0,0,...`），或用了 `readable.on('data')` 手动转发却不等 `drain`。确认：打印 `writableLength`，若远超 `writableHighWaterMark` 就是在堆积。修法：改用 `pipeline()`；手写就用 `for await` + `await once(writable, 'drain')`。

**6. 长跑进程报 `EMFILE: too many open files`。** 现象：运行几小时后所有文件操作都失败，新连接也被拒。原因：流没有全部关闭——`pipe` 不会在源头出错时结束目标，`createReadStream` 挂在那里没人管。确认：Windows 用任务管理器看句柄数，Linux 用 `ls /proc/<pid>/fd | wc -l`（本条未在本机做长跑复现，属机制说明）。修法：所有流组合一律走 `pipeline()`；自己创建的流确保每条错误路径都能 `destroy()` / `close()`。

**7. `if (process.env.FEATURE_FLAG)` 恒为真，或端口号变成字符串拼接。** 现象：关掉的开关还是生效；`process.env.PORT + 1` 得到 `"30001"`。原因：`process.env` 的值全是字符串，非空即真。确认：打印 `typeof process.env.PORT`。修法：启动时用 schema 集中 `coerce` + 校验，业务代码不直接读 `process.env`。

## 练习

<Exercise title="练习 1 · 预测 ESM 入口的输出顺序" difficulty="基础">

在 `type` 字段为 `module` 的目录里，用 ESM 执行下面代码，写出完整输出顺序。

```js
console.log('1');
setTimeout(() => console.log('2'), 0);
setImmediate(() => console.log('3'));
Promise.resolve().then(() => console.log('4')).then(() => console.log('5'));
queueMicrotask(() => console.log('6'));
process.nextTick(() => console.log('7'));
console.log('8');
```

<template #answer>

**`1` `8` `4` `6` `5` `7` `3` `2`。** 这段我按题目原样在 Node v25.4.0（ESM，2026-10-17）跑过，终端原文就是这八行；同一份代码换成 `--input-type=commonjs` 跑，输出是 `1 8 7 4 6 5 3 2`。推理分三段：

1. **微任务先于 `nextTick`**——这是本章 ESM 顶层实测到的行为（`A4 queueMicrotask` → `A5 promise then` → `A6 nextTick`），而 CommonJS 顶层实测是 `nextTick` 在前（上面第二串）。**同一段代码、唯一差别是模块系统，顺序就变了。**
2. **`5` 排在 `6` 之后**：链上的第二个 `then` 要在 `4` 的回调执行完才入队，而 `6` 早就在队列里了。微任务队列「本轮排空、新入队的追加到队尾」这条规则在浏览器和 Node 里完全一致（[异步那一章](/javascript/asynchronous)已实跑过同一个规律）。
3. **`3` 早于 `2`**：`setImmediate` 在 check 阶段，`setTimeout(0)` 在下一轮 timers 阶段；我这两次实跑里都是 `3` 先。**但官方文档明确说顶层这一对顺序不可依赖**，别把它当规格。

动手验证（把 `--input-type=module` 换成 `commonjs` 再跑一次）：

```bash
node --input-type=module - <<'EOF'
console.log('1');
setTimeout(() => console.log('2'), 0);
setImmediate(() => console.log('3'));
Promise.resolve().then(() => console.log('4')).then(() => console.log('5'));
queueMicrotask(() => console.log('6'));
process.nextTick(() => console.log('7'));
console.log('8');
EOF
```

**这道题真正要练的是两条可迁移的结论**：① 链上/`await` 之后的回调入队时刻在「上一个回调结束之后」，不是「你写代码的时候」；② 顶层的 `nextTick` 与微任务相对顺序由模块形态决定，所以别拿它写断言——需要「同步活干完立刻做」用 `queueMicrotask`，需要「本轮 I/O 之后、下一轮之前」用 `setImmediate`，`setTimeout(fn, 0)` 在两边都不是正确表达。

</template>

</Exercise>

<Exercise title="练习 2 · 把一段 CommonJS 迁到 ESM" difficulty="基础">

下面文件所在包要迁到 `"type": "module"`。列出会报错的行、给出改写后的完整版本，并说明 `readFile` 与 `createReadStream` 该选哪个。

```js
const fs = require('fs');
const path = require('path');
const config = require('./config.json');
const logger = require('./logger');          // logger.js 里用 __filename 定位日志目录

function readConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
}
module.exports = { readConfig, config };
```

<template #answer>

会出问题的点：全部 4 行 `require`（`ReferenceError: require is not defined`，本章已实测原文）、`__dirname`（`ReferenceError: __dirname is not defined in ES module scope`，同样实测过）、`module.exports`、以及 `require('./config.json')` 这类**省略扩展名**的路径。

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('./config.json');            // JSON 用 createRequire 最省事
const logger = (await import('./logger.js')).default; // 扩展名必须写全

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function readConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
}
export { config, logger };
```

迁移中容易忘的两件事：**`import` 声明不能放在函数或 `if` 里**，条件加载要换成动态 `import()`；**ESM 的 `import` 是异步的**，本章实测过动态导入的回调落在同步代码之后（`C4` 打在 `C5` 后面），所以别在 `require` 的语义下假设它同步可用。

`readFile` 还是 `createReadStream`：文件是**几 KB 的配置**就 `readFile`（一次拿全、代码简单）；文件**大小不可控或要转发给下游**（上传、导出、代理响应）就必须用流——峰值内存从「等于文件大小」降到「等于 `highWaterMark`」，实测 `fs.createReadStream` 的默认高水位是 65536 字节。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误：把事件循环卡死" difficulty="进阶">

写一段最小代码，让一个每 100ms 打点的定时器出现「中间断档 1 秒以上」，然后：① 解释为什么打印的间隔不是 100 的倍数；② 把这段活改成不阻塞事件循环的两种做法；③ 说明为什么用 `worker_threads` 之后仍然不能随便开满 CPU 核数。

<template #answer>

复现代码（预期输出：先看到连续几条 100ms，然后突然 `lag ≈ 1000ms`，之后恢复；与本章实测的「50ms 变 728ms」是同一现象）：

```js
let expected = Date.now() + 100;
setInterval(() => {
  const now = Date.now();
  console.log('间隔实际', now - (expected - 100), 'ms，偏差', now - expected, 'ms');
  expected += 100;
}, 100);

setTimeout(() => {                       // 1 秒后开始同步死循环
  const until = Date.now() + 1000;
  while (Date.now() < until) { /* 空转，模拟大 JSON 解析 */ }
  console.log('死循环结束');
}, 1100);
```

**① 为什么间隔不是 100 的倍数**：`setInterval` 的 100ms 只决定「回调什么时候变为到期」，到期后必须等事件循环走到 timers 阶段、且前面的同步栈跑空才能执行。阻塞期间到期的若干次不会补发，也不会排队成多次——libuv 同一定时器在回调未跑之前不会重复触发，所以你会看到「一次大跳」而不是「一串小跳」。另外定时器本身不保证精确（[异步那一章](/javascript/asynchronous)实测 `delay=0` 落在 15–16ms）。

**② 两种不阻塞的做法**：（a）改成异步/分片——把 1 秒的循环切成每次处理 N 条并 `await new Promise(r => setImmediate(r))`，让出事件循环；（b）把整块计算移出主线程——`worker_threads` 或 `child_process`，主线程只等它的消息/Promise。

**③ 为什么不能开满核**：worker 的 CPU 消耗是真实的机器资源，容器有 CPU 配额（cgroup limit）。开 8 个 worker 而配额是 2 核，结果是所有 worker 一起被限流，主线程的事件循环回调也会**因为拿不到 CPU 时间片而变慢**——这时你观察到的「事件循环延迟」不再是同步代码造成的，而是被调度饿死。合理做法：worker 数按 `os.availableParallelism()`（不是 `os.cpus().length`，后者在容器里读到的是宿主机核数）与配额共同决定，并把重活交给独立进程/队列而不是同一实例内的线程池。

</template>

</Exercise>

<Exercise title="练习 4 · 背压实验：读返回值并解释" difficulty="进阶">

`highWaterMark` 为 16384 的 `Writable`，每次写入 8192 字节且消费速度是每 10ms 一块。① 连续 12 次 `write()` 的返回值序列是什么？② 第 12 次之后缓冲区里大概有多少字节？③ 如果消费速度改成每 1ms，返回值序列会怎么变？

<template #answer>

**① 本章实测的返回值序列**（我按这个配置真实跑过）：

```text
1,0,0,0,0,0,0,0,0,0,0,0
```

第一次 `write` 时缓冲区是空的，写入后 8192 未超过 16384 → `true`；第二次写入后到 16384，**达到**高水位 → 之后每次都是 `false`。注意 `true` 只出现一次，这是很多人以为「背压机制坏了」的原因。

**② 缓冲区字节数**：实测 `writableLength: 98304`，即 `12 × 8192`——**返回 `false` 并没有拒绝任何写入**。Node 只是「通知」你该停了；你不听，它就继续收，直到内存耗尽。

**③ 消费变成每 1ms**：前几次仍然会返回 `false`（同步 `for` 循环里 12 次 `write` 是**瞬间**完成的，10ms/1ms 的回调都还没开始跑，一个字节都没被消费掉），所以返回值序列**不变**。这个改法的实验设计是错的——要观察真正的背压，必须把写入分散开：

```js
for await (const chunk of readable) {
  if (!writable.write(chunk)) await once(writable, 'drain');
}
```

这才是背压生效的形状：写入被 `drain` 卡住，`writableLength` 始终在高水位附近上下浮动，`readable` 的消费速度被自然拖慢（`for await` 停住时，可读流也会停止 push，内存保持恒定）。**结论：`write()` 返回值的意义只在「你会等 `drain`」的前提下才成立**，同步循环里看返回值是看不出背压的。

</template>

</Exercise>

<Exercise title="练习 5 · 配置读取的健壮化" difficulty="挑战">

把下面这段改成「启动期就暴露所有配置问题、业务代码不直接碰 `process.env`、且能安全处理空字符串与布尔值」的版本，并说明为什么 `NODE_ENV` 缺失时不该默认成 `production`。

```js
const PORT = process.env.PORT || 3000;
const DEBUG = process.env.DEBUG !== 'false';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
module.exports = { PORT, DEBUG, SESSION_SECRET };
```

<template #answer>

三个具体问题：`process.env.DEBUG` 为**未设置**时 `undefined !== 'false'` 为 `true`，于是「没配 DEBUG」=「DEBUG 开着」；`SESSION_SECRET` 用了硬编码兜底，**生产环境忘配密钥时会静默使用公开的弱密钥**；`PORT` 没做类型转换，`'abc'` 会一路带到 `listen` 才报 `ERR_INVALID_ARG_TYPE`。

```ts
// config.ts
function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  if (v === '' || v === '0' || v.toLowerCase() === 'false') return false;
  if (v === '1' || v.toLowerCase() === 'true') return true;
  throw new Error(`环境变量布尔值无法解析: ${v}`);
}

const raw = {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  DEBUG: process.env.DEBUG,
  SESSION_SECRET: process.env.SESSION_SECRET,
};

const errors: string[] = [];
const env = (raw.NODE_ENV ?? 'development') as 'development' | 'test' | 'production';
if (!['development', 'test', 'production'].includes(env)) errors.push(`NODE_ENV 非法: ${raw.NODE_ENV}`);

let port = 3000;
if (raw.PORT !== undefined) {
  port = Number(raw.PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) errors.push(`PORT 非法: ${raw.PORT}`);
}

const secret = raw.SESSION_SECRET ?? '';
if (env !== 'development' && secret.length < 32) errors.push('SESSION_SECRET 缺失或过短（生产环境必须显式提供）');

if (errors.length) {
  console.error('配置校验失败:\n - ' + errors.join('\n - '));
  process.exitCode = 1;
  throw new Error('启动期配置校验失败');      // 让进程带着明确原因退出，别等第一个请求
}

export const config = Object.freeze({
  env, port, debug: bool(raw.DEBUG, env !== 'production'), sessionSecret: secret,
});
```

要点四条：**一次读、一次校验、冻结导出**（`Object.freeze` 防止运行时被某处改掉，那类 bug 极难查）；**生产环境缺失密钥必须拒绝启动**，而不是给默认值；**布尔解析要区分「未设置」与「设置成假值」**；**先设 `process.exitCode = 1` 再抛**，避免直接 `process.exit()` 丢掉日志（本章正文第三条）。

`NODE_ENV` 缺失不该默认 `production`：默认成生产意味着开发时**错误堆栈被隐藏、日志级别被收紧、缓存被打开**，出问题时你什么都看不见；而默认成 `development` 的风险（关掉安全校验）应该用「生产必须显式设置」的启动期校验来兜住——就像上面 `secret` 那条。这与[服务部署：Docker、优雅关闭与配置](/backend/docker-and-shutdown)里「环境隔离靠配置而非代码分支」的原则一致。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Node.js 事件循环、timers 与 `process.nextTick`](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) —— 核实本章「阶段模型」示意图与「`nextTick` 在回调上下文中优先于微任务」「`setImmediate` 在 check 阶段」「顶层 `setTimeout(0)` 与 `setImmediate` 顺序不可依赖」三条。
- [Node.js ESM 文档](https://nodejs.org/docs/latest/api/esm.html) —— 核实本章模块判定规则表：`.mjs`/`.cjs`/`package.json` 的 `type`、「最近的 package.json」、ESM 必须写扩展名、顶层 await 只在模块可用。
- [Node.js modules（CommonJS）文档](https://nodejs.org/docs/latest/api/modules.html) —— 核实 CJS 的解析顺序、`require.cache`、以及 `require()` 加载 ES 模块的当前支持范围（本章练习中标为 unverified 的那条要在这里核对）。
- [Node.js stream API](https://nodejs.org/docs/latest/api/stream.html) 与 [stream/promises 的 `pipeline`](https://nodejs.org/docs/latest/api/stream.html#pipeline) —— 核实 `highWaterMark` 的含义、`write()` 返回 `false` 的语义、`drain` 事件的触发时机，以及「用 `pipe` 不处理错误会泄漏资源」。
- [Node.js `process` 文档](https://nodejs.org/docs/latest/api/process.html) —— 核实 `process.env` 全为字符串、`process.exit()` 不等待 I/O、`exitCode` 与退出码含义（本章实测的 13 对应 unsettled top-level await）。
- [Node.js timers 文档](https://nodejs.org/docs/latest/api/timers.html) —— 核实 `delay` 小于 1 或 `NaN` 会被设为 1、非整数向下取整、不保证精确时间与顺序。
- [MDN 在 JavaScript 中通过 queueMicrotask() 使用微任务](https://developer.mozilla.org/zh-CN/docs/Web/API/HTML_DOM_API/Microtask_guide) —— 浏览器侧的调度模型原文，用来对照本章的浏览器/Node 对照表。
- [Node.js `http` 模块 API](https://nodejs.org/docs/latest/api/http.html) —— 下一章手写服务器会用到，本章只到「宿主能力」为止。

## 下一章

这一章讲的是「Node 这个宿主怎么调度你的代码、怎么加载你的模块、怎么搬字节」；[用 node:http 手写最小服务器](/backend/minimal-http-server) 就立刻把这些知识压到一个具体场景里：一个 HTTP 请求进来，`req` 是一个可读流（于是本章的高水位、背压、`data`/`end` 全部生效），`res` 是一个可写流（于是本章实测过的 `ERR_STREAM_WRITE_AFTER_END`、重复 `end` 会崩进程这些行为都成了真实故障），而 URL 解析、方法分发、状态码设置都得自己写。写完你会清楚地知道[Fastify 入门](/backend/fastify-basics)那个框架到底替你兜了哪几件事——以及它兜掉的那几件事里，哪一件出错时你会完全看不懂报错。
