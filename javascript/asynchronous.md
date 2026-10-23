# 事件循环、Promise 与 async/await：搞清「什么时候执行」这一半

`async` 函数明明发了请求，外面拿到的却是 `Promise { <pending> }`；给列表做搜索，输入快了以后**旧请求的结果把新结果覆盖掉**；`forEach` 里写 `async` 回调，五个请求看起来都发了，日志顺序却和预期完全不同；loading 标志永远转圈，因为某条分支没有 `catch`。

这四类问题的共同点：**代码写对了，执行的时机不是你想的那样**。JavaScript 是单线程的，但「单线程」不等于「顺序执行」——回调被排进两条不同的队列，微任务会插队，`await` 之后的代码其实是「以后」才跑的。想预测行为，只需要一套模型：**调用栈、微任务队列、宏任务队列**，加上 Promise 的解包规则。

本章所有顺序与耗时都在本机 Node v25.4.0 跑过，贴的是真实输出。前置：[函数、作用域、闭包与 this](/javascript/functions-and-scope)（回调与闭包，尤其是 `debounce` 那种「状态藏在闭包里」的写法）。

## 为什么单线程还能并发：三个部件的分工

JS 引擎只有一个调用栈（call stack），一次只能做一件事。能「并发」是因为栈外面还有东西：**宿主环境**（浏览器的网络栈/定时器线程池、Node 的 libuv 线程池）在栈外把耗时的事做完，再把回调**排回栈**执行。

| 部件 | 归谁 | 管什么 |
| --- | --- | --- |
| 调用栈 | JS 引擎 | 当前同步代码，函数进出 |
| 微任务队列（microtask queue） | JS 引擎（宿主提供入队能力） | `Promise.then/catch/finally` 回调、`queueMicrotask`、`await` 之后的剩余部分、`MutationObserver` |
| 宏任务队列（macrotask / task queue） | 宿主 | `setTimeout`/`setInterval` 回调、I/O 事件、DOM 事件回调、脚本本体 |
| 渲染步骤 | 浏览器 | `requestAnimationFrame` 回调、样式计算、绘制 |

调度规则一句话：**同步栈跑空 → 把微任务队列整个排空（含执行中新入队的）→ 取一个宏任务 → 再排空微任务 → …**。所以微任务永远插在任何宏任务前面，而一个死循环的微任务链会饿死宏任务（本章实跑第三行输出就是这个现象）。

**浏览器与 Node 的差别只在细节**：入队规则、微任务与 Promise 语义完全一致（同一份 ECMAScript / WHATWG 规定），但宏任务的组织方式不同——Node 用 libuv 的多个阶段（timers → poll → check …），有 `process.nextTick` 这条**比微任务还靠前**的队列，`setImmediate` 落在 check 阶段；浏览器有渲染帧与 `requestAnimationFrame`。本节不展开 Node 事件循环的六个阶段，完整对照见[Node.js 运行时：模块、事件循环与流](/backend/node-runtime)。

## `setTimeout(fn, 0)` 的真实延迟：不是 0，也不是「立刻」

先说能确定的部分（规范/文档规定）：

- `delay` 为 `0` 或负数时不会立刻执行，浏览器按「下一个时机」处理；HTML 标准规定 `delay` 小于 1 时取 1。[MDN `setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout) 原文：**「负值的行为与 0 相同」**、**「`delay` 为 0 会在下一个事件循环周期执行，而非立刻」**、**「实际延迟可能比设定值更长」**。
- **嵌套节流**：同页核实到 MDN 的表述——「按 HTML 标准，当 `setTimeout` 被嵌套调用第 5 次之后，浏览器会强制最小延迟 4 毫秒」，即前几次约 0ms、之后约 4ms。
- **后台标签页节流**：MDN 明确「为降低后台标签负载，浏览器会强制最小延迟」，并给出 Firefox 桌面版非活跃标签最小 1 秒、Chrome 分 minimal / throttling（每秒检查一次）/ intensive（每分钟检查一次）三档。
- **Node 侧**：[timers 文档](https://nodejs.org/api/timers.html)规定 `delay` 大于 2147483647、**小于 1 或 `NaN` 时会被设为 1**，非整数延迟向下取整，且「不会保证精确时间」。

本机 Node v25.4.0 实测（2026-10-17）：

```text
delay=0 单次实测耗时 ms: 16,16,16,16,16
delay=1 单次实测耗时 ms: 15,15,15
delay=1000 单次实测耗时 ms: 1003
setImmediate 等待 ms: 0.113
```

以及负值的警告原文：

```text
TimeoutNegativeWarning: -100 is a negative number.
Timeout duration was set to 1.
```

<Callout type="verified" title="上面数字来自本机一次运行，别当规格用">

环境：Windows 10 x64 + Node v25.4.0，`node -` 从标准输入执行，用 `Date.now()` / `performance.now()` 差值计时。`delay=0` 稳定落在 15–16ms 是这台机器这一次的观察（与定时器轮询粒度和机器负载有关），**不是 Node 的承诺值，也不是浏览器值**——浏览器里 `setTimeout(0)` 通常在个位数毫秒。需要精确计时请别用 `setTimeout`：用 `performance.now()` 测差值、用 `setInterval` + 漂移补偿，或把要求改成「不晚于 X 毫秒」。

</Callout>

结论落地成三句：**别用 `setTimeout(fn, 0)` 表达「下一轮再做」**（要「本帧同步做完后再做」就用 `queueMicrotask`，要「等浏览器画完」用 `requestAnimationFrame`）；**别用 `setTimeout` 做精确计时器**（节流、超时判定要允许误差）；**别假设 delay 是你写的那个数**（嵌套 5 次后浏览器抬到 4ms，后台标签抬到 1s）。

## 微任务与宏任务：经典混合代码与逐步推演

代码：

```js
console.log('1 同步');
setTimeout(() => console.log('2 setTimeout(0) 宏任务'), 0);
Promise.resolve().then(() => console.log('3 then 第一个')).then(() => console.log('4 链上的 then'));
queueMicrotask(() => console.log('5 queueMicrotask'));
console.log('6 同步末尾');
```

<Callout type="verified" title="以下输出是 Node v25.4.0 的终端原文">

核实于 2026-10-17：

```text
1 同步
6 同步末尾
3 then 第一个
5 queueMicrotask
4 链上的 then
2 setTimeout(0) 宏任务
```

同一份代码加上 `process.nextTick` 后，`nextTick` 的回调排在所有 Promise 微任务**之前**（Node 专有队列）：

```text
1 同步
7 同步
6 process.nextTick（Node 专有）
3 then 第一个微任务
5 queueMicrotask
4 then 链第二个微任务
2 setTimeout(0) 宏任务
```

</Callout>

逐步推演第一段：

| 时刻 | 发生什么 | 微任务队列 | 宏任务队列 |
| --- | --- | --- | --- |
| 脚本开始 | `1` 打印 | 空 | 空 |
| 执行 `setTimeout` | 回调交给宿主定时器 | 空 | [T1] |
| 执行 `Promise.resolve().then(3)` | 已 resolve，回调立刻入队 | [3] | [T1] |
| 执行 `queueMicrotask(5)` | 入队尾 | [3, 5] | [T1] |
| `6` 打印，栈空 | 开始排微任务 | [5] → 空 | [T1] |
| 跑 `3` | 它 `return` 使链上下一个 then 入队 | [4] | [T1]（`4` 在 `3` 之后入队，所以排在 5 之后） |
| 跑 `5` → 跑 `4` | 队列空，才允许取宏任务 | 空 | [T1] |
| 跑 `2` | 定时器回调 | 空 | 空 |

关键的一条：**「`4` 排在 `5` 后面」**。链上的第二个 `then` 不是「早就排好的」，它要在 `3` 的回调**执行完并确定返回值之后**才入队——这就是微任务队列「执行中新入队的会追加到队尾，仍然在当前这一轮排空」的表现。用一张图记住：

```text
C 同步末尾
微任务轮次 1
微任务轮次 2
微任务轮次 3
A setTimeout(0) 宏任务
```

（对应代码：`setTimeout` 打头排了宏任务，微任务链自己 `queueMicrotask(loop)` 转了 3 轮；宏任务一直等到微任务队列空才执行。**微任务里递归入队会饿死宏任务**，这是真实的故障模式：页面卡住、定时器不响。）

**浏览器里 `requestAnimationFrame` 的位置**：rAF 回调不属于上面两个队列，它在「渲染步骤」里跑，一帧一次，在微任务排空之后、样式与布局之前。所以「同步改完样式后读尺寸」用 rAF，「等本次任务彻底结束」用 `setTimeout(0)`，「同一批状态改完立刻做一次合并」用微任务。

<Callout type="unverified" title="rAF 的精确时机未在本机浏览器验证">

本节只写了规范层面的相对位置（rAF 在渲染帧内、微任务之后），没有在你的浏览器里实测打印顺序，也不给出「rAF 相对 `setTimeout(0)` 谁先」的绝对结论——两者在不同帧与负载下顺序会变。需要精确验证请在浏览器控制台用同一份代码跑一遍，或用 [CSS 动画与合成层](/css/transitions-and-animations)、[浏览器渲染机制与关键渲染路径](/frontend-engineering/rendering-pipeline) 里给的 DevTools Performance 面板录一帧看。

</Callout>

## Promise 的语义：状态、解包、链上的错误传播

三条不可简化的规则：

1. **状态只能单向变**：`pending → fulfilled` 或 `pending → rejected`，一旦确定不可再改，重复 `resolve` 无效。
2. **`then` 永远返回一个新的 Promise**，它的状态由回调的返回值决定：返回原始值/对象 → fulfilled 为该值；**返回 Promise → 等新 Promise 定下来再解包（unwrap）**；`return await x` 同理；抛错 → rejected。
3. **错误沿链向后传播，直到遇到最近的 `catch`**；链尾没 `catch` 就是「未处理的 rejection」（下一节）。

实跑（错误传播链）：

```text
错误传播链: catch:原始错误 -> finally -> then 收到:catch 的返回值
finally 不改值: 原值
finally 抛错会盖掉结果: finally 里抛错
executor 抛错会变成 rejection: 同步抛错
```

读法：`Promise.reject(new Error('原始错误'))` → `catch` 吞掉错误并返回 `'catch 的返回值'` → `finally` 执行但**不改变值** → 后面的 `then` 收到的是 catch 的返回值。三条要点：

- **`catch` 的位置决定它接住谁**。放在链尾接住前面所有；放在中间则它之后的 `then` 不再看到原错误（错误被「降级」成正常值）。想在最外层统一处理，`catch` 就该只出现在链尾一次。
- **`finally` 不改值但会重抛**：`finally` 的返回值被丢弃（实跑 `finally 不改值: 原值`），但**它自己抛错会盖掉原本的结果**（`finally 抛错会盖掉结果`）。所以 `finally` 里只做清理（关 loading、`clearTimeout`），别放逻辑。
- **executor 里同步抛错自动变成 rejection**（实跑 `executor 抛错会变成 rejection`）：`new Promise(() => { throw e })` 不会把异常抛给外面，外面必须 `catch`。这也是为什么 `Promise` 构造器里不要写可能抛错的同步逻辑却不处理。

`async` 函数是这套规则的语法糖：**永远返回 Promise**，`throw` 等价于返回 rejected Promise。实跑：

```text
async 函数返回: true
被 catch 到: async 里抛错
await 前
主线程同步继续
await 后（微任务）
```

最后三行是同一个脚本的输出：`async` 函数在遇到 `await` 前**同步执行**，`await` 之后的部分作为微任务恢复。这条就是「await 之前的代码立刻跑、之后要等」的准确表述，也是下面「忘 await」和「循环串行」两个坑的根因。

## 四个组合器：什么时候用哪个

| 方法 | 结果 | 一个失败会怎样 | 适用 |
| --- | --- | --- | --- |
| `Promise.all` | 全部 fulfilled 的数组（**顺序按入参数组**，不按完成先后） | 立刻 reject（快失败），其余不取消 | 一组请求构成一次原子操作：缺一即整体失败 |
| `Promise.allSettled` | `{status, value/reason}` 数组，永远 fulfilled | 各自记录，不影响别人 | 批量但要逐个上报成败（并发上传、健康检查） |
| `Promise.race` | 第一个**定下来**的结果，成功或失败都算 | 谁先定谁说话 | 超时（配一个会 reject 的定时器）、竞速 CDN |
| `Promise.any` | 第一个 fulfilled 的结果；全失败 → `AggregateError` | 前面的失败被忽略 | 多源容错：任一成功即可 |

实跑输出：

```text
all 失败: boom → 其他 Promise 不会被取消，只是结果拿不到
allSettled: ["fulfilled:a","rejected:boom","fulfilled:c"]
race 取先定的: 快
race 先失败: e1
any 取先成功: 第二个成功
any 全失败: AggregateError | errors 数量: 2
allSettled 全失败也能逐个看: x,y
```

三个容易被误解的点：

1. **`all` 的失败不会取消其他请求**，只是你拿不到它们的结果了（第一行）。想真正取消要 `AbortController`（下一节），否则请求继续在后台跑、继续消耗带宽与服务端资源。
2. **「一个失败就全崩」的正确处理不是去掉 `all`**，而是按语义选：需要原子性就保留 `all` 并在**外层** `try/catch`，同时把失败原因归一化；不需要原子性就换 `allSettled` 然后自己判：

```js
const results = await Promise.allSettled(urls.map(fetchJson));
const ok = [], failed = [];
results.forEach((r, i) => (r.status === 'fulfilled' ? ok : failed).push({ url: urls[i], r }));
if (failed.length) reportBatchFailure(failed);   // 别把 rejected 当 fulfilled 用
```

3. **`all` 的结果顺序 ≠ 完成顺序**，靠的是入参索引，所以拿它做「并发但保持顺序」的加载器是安全的；想要完成顺序就用事件式写法（每个任务自己 `then` 上报）。

## 串行 `await` 的性能陷阱与并行改法

实跑对照（每个任务 300ms / 200ms）：

```text
串行 3 次 await 耗时 ms: 923 abc
并行 Promise.all 耗时 ms: 307 abc
for...of 里逐个 await ms: 626
先 map 启动再统一 await ms: 200
forEach 后立刻: [] 耗时 ms: 0
120ms 后才完成: [1,2,3]
```

三条结论都在这六行里：

```js
// 1. 无依赖的串行 await：总耗时是求和，白等
const a = await fetchA();      // 300ms 之后才发第二个
const b = await fetchB();

// 2. 并行改法：先全部启动，再统一等
const [a, b] = await Promise.all([fetchA(), fetchB()]);

// 3. for 循环里的 await 同样串行（626ms ≈ 3×200ms + 开销）
for (const id of ids) await load(id);
const tasks = ids.map((id) => load(id));    // 200ms：调用即启动
await Promise.all(tasks);
```

`forEach` + `async` 那两行是**另一个独立错误**：`forEach` 不识别回调返回的 Promise，也不会等，所以打印时数组还是空的。`forEach` 里放 `async` 回调等价于「发射后不管」。要顺序就 `for...of`，要并发就 `map` + `Promise.all`，没有第三种。

**并行不是免费的**：并发数直接压到服务端与浏览器连接数上（浏览器对同一域名的并发连接数有上限，HTTP/1.1 时代通常是个位数；换成 HTTP/2/3 后这条限制形态变了，但服务端的配额与背压还在）。一次性 `map` 一千个 id 会造成失败率上升与内存峰值。有上限时用简易限流器（实跑：并发 2、5 个 200ms 任务 → `耗时 ms 623`，与 `ceil(5/2)×200 = 600` 吻合；不限流全并发是 201ms）：

```js
function pLimit(concurrency) {
  const queue = [];
  let active = 0;
  const next = () => { if (active < concurrency && queue.length) { active++; queue.shift()(); } };
  return (fn) => new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject).finally(() => { active--; next(); }));
    next();
  });
}
const run = pLimit(2);
const results = await Promise.all(ids.map((id) => run(() => load(id))));
```

**取舍判据**：任务彼此独立且服务端扛得住 → 并发；有共享可变状态、有限流/配额、或后一个依赖前一个 → 串行；两者之间 → 限流并发 + `allSettled` 收集成败。

## 顶层 await 与模块条件

顶层 `await` 只能在**模块**里用（ESM / `.mjs`），CommonJS 的 `require` 不支持。实跑：

```bash
node --input-type=module -e "const v = await Promise.resolve('顶层 await 拿到的值'); console.log(v);"
# 顶层 await 拿到的值
```

用了顶层 `await` 的模块，**整个模块的求值（evaluation）会推迟到该 Promise 完成**，导入方拿到的绑定此时才就绪。后果有两个要记住：一是它会串起一条「等待链」，多个模块各自顶层 `await` 时总耗时取决于最慢的那个（引擎会并行求值，但你的初始化时间不再可控）；二是**循环依赖 + 顶层 await** 是 TDZ 报错的高发组合（[上一章](/javascript/prototypes-and-classes)里 `Cannot access 'Cls' before initialization` 的一种成因）。所以：能放进函数里显式 `await` 的初始化就别写顶层；只有「模块级单例配置加载」这类确实必须一次性的才用。构建侧对 `top-level-await` 的支持与代码分割影响见[Vite 构建侧：打包、代码分割与产物分析](/frontend-engineering/vite-build)。

## 错误处理的边界：未处理的 rejection 会怎样

**Node 侧（实跑）**：`Promise.reject` 没有任何 `catch`，进程直接崩掉，退出码 1，`setTimeout` 回调不再执行：

```text
Error: 没人 catch 的错误
    at [eval]:1:16
    ...
Node.js v25.4.0
退出码: 1
```

**浏览器侧**：不会崩，但会在控制台报 `Uncaught (in promise) Error: ...`，并且可以监听 `window.addEventListener('unhandledrejection', e => { e.reason; /* Error */ })` 兜底上报（`e.preventDefault()` 可抑制默认日志）。

<Callout type="unverified" title="浏览器 unhandledrejection 的行为未在本机浏览器实测">

「Node 默认终止进程、浏览器只打日志」这个对照里，**Node 一半我实测过（上面输出）**，浏览器一半依据 [MDN `unhandledrejection`](https://developer.mozilla.org/zh-CN/docs/Web/API/Window/unhandledrejection_event) 与规范描述，我没在浏览器里跑。请在目标浏览器验证后再写监控代码；另外 Node 的行为可用 `--unhandled-rejections` 调整为 `warn` 或 `strict`，具体取值以 [process 文档](https://nodejs.org/api/process.html) 当前版本为准，本章不断言默认值会变。

</Callout>

可操作的三条边界：① **每个 `async` 调用点要么 `catch` 要么把 rejection 交回调用者**（别在中间「吃掉」错误只 `console.log`）；② **入口层负责兜底**：UI 事件处理器、定时器回调、顶层 `await` 处是最常见的「没人接」的位置，那里加一次 `try/catch` + 用户可见的提示，见[统一错误处理](/backend/error-handling)与[错误处理与 DevTools 调试](/javascript/errors-and-debugging)；③ **`await` 一个可能 reject 的 Promise 时，`try` 只包住必要范围**——`try` 包太大把后面的正常代码也纳入错误分支，是「错误处理互相干扰」的常见来源。

## 取消与超时：`AbortController` 与 `Promise.race`

`Promise.race` 做超时的完整可用版本（实跑）：

```js
async function withTimeout(promise, ms, label = '操作') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超过 ${ms}ms`)), ms);
  });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(timer); }   // 不清掉：定时器会一直吊着进程/事件循环
}
```

```text
未超时: 数据
超时: 拉取 超过 100ms
```

**`race` 只是「不再等它」，并没有取消底层工作**，这句我在实跑里明确验证过：

```text
AbortController 取消: AbortError / aborted | 原 Promise 没有被取消，只是不再被消费
signal.aborted = true
AbortSignal.timeout 是否存在: function
```

要真的停止，必须让被取消方能感知 `signal`。`fetch` 原生支持：

```js
const ac = new AbortController();
el.addEventListener('click', () => ac.abort());     // 用户点「取消」

try {
  const res = await fetch('/api/search?q=' + q, { signal: ac.signal });
  // ...
} catch (e) {
  if (e.name === 'AbortError') { /* 主动取消，别当失败上报 */ }
  else { /* 真的网络错误 */ }
}
```

两点必须区分：**`AbortError` 不是故障**，别混进错误监控（`error.name === 'AbortError'` 单独分支）；一次性超时可以用 `AbortSignal.timeout(ms)`（本机 Node 25 里该静态方法存在），它比手写 `race` 更省事，且能直接把 signal 传给 `fetch`。自己写的异步任务想支持取消，就把 `signal` 作为参数传进去、在关键点检查 `signal.aborted` 并 `signal.addEventListener('abort', reject)`。

## 竞态：旧结果覆盖新结果

现象：搜索框输入 `ab`，请求 A（`a`）与 B（`ab`）都在飞，A 后到，列表显示成了 `a` 的结果。这不是「异步慢」，是**没有定义「谁是最新」**。两种修法：

```js
// 修法 1：序号（丢弃过期结果）
let seq = 0;
async function search(q) {
  const my = ++seq;
  const data = await api(q);
  if (my !== seq) return;        // 已有更新的请求，结果作废
  render(data);
}

// 修法 2：AbortController（连过期请求都不发完）
let ac;
async function search(q) {
  ac?.abort();
  ac = new AbortController();
  const data = await api(q, { signal: ac.signal });   // 这里可能抛 AbortError
  render(data);
}
```

序号法「省不了流量但一定显示正确」；`abort` 法省流量但要求 `catch AbortError`。生产里通常两个一起用。**同一模式在其他位置也会咬你**：组件卸载后回调仍在 `setState`、`watch` 回调里发请求、`useEffect` 依赖变化时的重复请求。框架给的都是这两个修法的封装——Vue 的 [computed 与 watch](/vue/computed-and-watch)（`onCleanup` / 侦听器回调里的取消）、React 的 [useEffect 与 watch 的对照](/react/use-effect)（清理函数 + `AbortController` 或 `ignore` 标志）。网络层的对应实践在 [fetch、同源策略与浏览器存储](/javascript/network-and-storage)。

## 手写 debounce 与 throttle：完整可用版

`debounce`（等安静下来再做）与 `throttle`（每段时间做一次）都是闭包 + 定时器，区别只在「重置」还是「限流」。实跑输出与代码：

```js
function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}
```

```text
连敲 3 次 @0
执行 -> abc @213ms
静默 500ms 后再敲一次 @500
执行 -> 后面独立的一次 @741ms
```

**三次触发只执行一次，且用的是最后一个参数 `abc`**（因为每次调用都 `clearTimeout` 并重设），执行时刻比最后一次调用晚约 200ms。

```js
function throttle(fn, gap) {
  let lastRun = 0;
  let timer = null;
  let queued = null;
  return function (...args) {
    const now = Date.now();
    if (now - lastRun >= gap) {          // 距上次已超间隔：立即执行
      lastRun = now;
      fn.apply(this, args);
      return;
    }
    queued = { args, ctx: this };        // 间隔内：记下最新参数
    if (!timer) {                        // 只在队首起一个尾随定时器
      timer = setTimeout(() => {
        timer = null;
        lastRun = Date.now();
        fn.apply(queued.ctx, queued.args);
      }, gap - (now - lastRun));
    }
  };
}
```

```text
第1次(立即) @0
第3次(gap 内, 覆盖第2次参数) @302
检查点 @354
第4次(距上次已超 gap, 立即) @705
```

这版输出说明了两件常被忽略的事：**第一次一定立即执行**（不然滚动/缩放响应慢半拍）；**间隔内的最后一次不会丢**（尾随调用，@302 那次跑的是第 3 次的参数，第 2 次的被覆盖）。如果不需要尾随调用，把 `timer` 分支删掉即可，但那会让「最后一次输入」被吞——搜索类场景不能这样。

选型判据：**事件密集但只关心最终状态**（搜索输入、窗口 resize 后重排）→ `debounce`；**事件密集且要按节奏持续响应**（滚动加载、拖拽位置、上报进度）→ `throttle`。轮询（`setInterval` 拉数据）另有一层要求：**上一轮没回来就不能发下一轮**，否则请求堆积——用递归 `setTimeout` 而不是 `setInterval`：

```js
async function poll(signal) {
  while (!signal.aborted) {
    const started = Date.now();
    try { await refresh(); } catch (e) { report(e); }
    const wait = Math.max(1000, 5000 - (Date.now() - started));  // 扣掉请求耗时
    await new Promise((r) => setTimeout(r, wait));               // 顺序保证：串行
  }
}
```

`setInterval` 的问题正是「不等上一次完成」，慢响应会让 N 个请求同时在飞；这也是本页唯一一处「串行 await 是**对的**」的场景——它依赖前一轮的完成。

## Node 侧差异：一句话版

Node 里没有浏览器那套「帧」概念，微任务语义完全相同（`Promise`、`queueMicrotask` 表现一致），差别集中在宏任务：libuv 的阶段模型 + `process.nextTick` 优先于所有微任务（本章实跑已见）+ `setImmediate`。服务端写并发时还要多考虑「事件循环被同步代码阻塞会影响所有请求」，展开在 [Node.js 运行时：模块、事件循环与流](/backend/node-runtime)。

## 常见错误与排查

**1. 忘了 `await`，拿到 `Promise { <pending> }`。** 现象：变量是 Promise，`.map` 报 `xxx is not a function`，或 UI 显示 `[object Promise]`。原因：`async` 函数永远返回 Promise（本章实跑 `async 函数返回: true`）。确认：`console.log(Promise.resolve(v) instanceof Promise)` 风格地直接打印，或看是不是 `Promise {…}`。修法：加 `await`；或 `.then()`。注意「加了 `await` 但加在错的地方」也算这条：`arr.map(async f)` 返回的是 Promise 数组，必须外面再套一次 `await Promise.all(...)`。

**2. `forEach` + `async` 回调不等。** 实跑铁证：`forEach 后立刻: [] 耗时 ms: 0`，120ms 后才变成 `[1,2,3]`。原因：`forEach` 忽略回调返回值。确认：把 `forEach` 换 `for...of` 后顺序立刻正常。修法：`for...of` + `await`（串行）或 `map` + `Promise.all`（并发）。

**3. 无依赖的 `await` 写在循环里，接口耗时线性叠加。** 现象：本地 5 个请求共 1 秒。原因：`for` 里 `await`（实跑 `for...of 里逐个 await ms: 626` 对 `先 map 启动再统一 await ms: 200`）。确认：Network 面板看请求是依次还是同时开始。修法：先启动全部再统一 `await`；有配额/限流需求用 `pLimit`。

**4. `Promise.all` 一个失败全崩，或缺了 `catch`。** 现象：整块数据空白，控制台 `Uncaught (in promise)`。原因：`all` 是快失败语义（本章实跑第一行）且下游没接。确认：把 `all` 换 `allSettled` 后至少能拿到成功的部分。修法：按语义选组合器；需要原子性就在外层 `try/catch` 并给可恢复的降级 UI。

**5. `await` 在 `try` 外面，或 `catch` 里没重新抛出。** 现象：错误被吞，页面停在「成功前」的状态。原因：`catch(e) { console.log(e) }` 只记录不处理，调用方以为成功。确认：在 `catch` 里加 `console.log('走到了这里')`；或临时把 `catch` 删掉看是否冒出来。修法：要么真正恢复（重试/降级/返回错误对象 `{ ok: false, error }`），要么 `throw` 交回上层，别默默吃掉。

**6. `Promise` executor 里抛错却没 `catch`。** 现象：`Uncaught (in promise)`，但代码里找不到 `throw`。原因：executor 同步抛错会变成该 Promise 的 rejection（实跑 `executor 抛错会变成 rejection: 同步抛错`），而 `new Promise(...)` 这种「就地不接住」的写法很容易漏。修法：包 `try/catch` 或 `reject(e)`；更根本的是**能用 `async` 函数就别手写 `new Promise`**（`Promise` 构造器里的 `resolve/reject` 忘记调用是最常见的「永远 pending」来源）。

**7. 超时用了 `race` 但请求还在跑。** 现象：取消/超时后服务端仍然收到完整请求，浏览器连接被占满。原因：`race` 只影响「谁的结果被用」（实跑：`原 Promise 没有被取消，只是不再被消费`）。修法：传 `AbortController` 的 `signal` 给 `fetch`，或用 `AbortSignal.timeout(ms)`。

**8. loading 永远转圈。** 现象：请求失败后 spinner 不停。原因：`finally` 缺失，`loading = false` 写在成功分支里；或某条 `return` 提前退出跳过了清理。确认：把清理逻辑集中到 `finally`，看是否消失。修法：`try { ... } finally { loading = false }`（`finally` 不改值这条已在本章实跑，可安全放清理）。

**9. 竞态：旧响应覆盖新响应。** 现象：结果和最后一次输入不一致，偶发。原因：没有「最新」的概念。确认：在回调里打印请求发起顺序与响应到达顺序，两者不同即是。修法：序号丢弃过期，或 `abort` 上一个（见「竞态」节）。

## 练习

<Exercise title="练习 1 · 预测输出顺序" difficulty="基础">

写出下面代码的完整输出顺序（假设定时器回调都排在下一个宏任务）：

```js
console.log('A');
setTimeout(() => console.log('B'), 0);
Promise.resolve().then(() => console.log('C')).then(() => console.log('D'));
async function f() { console.log('E'); await null; console.log('F'); }
f();
console.log('G');
```

<template #answer>

顺序是 **`A E G C F D B`**。这段我在 Node v25.4.0 里实跑过（2026-10-17），终端原文：

```text
A
E
G
C
F
D
B
```

推演：同步段打完 `A`、`E`（`f` 在 `await` 前同步执行）、`G`；`B` 进宏任务队列；`C`（`then`）与 `F`（`await` 恢复，本质也是微任务）都在队列里，`C` 先入队所以先跑；`C` 的回调让 `D` 入队，但 `F` 更早就在队列里，所以 `F` 先于 `D`；`D` 跑完微任务队列空，才轮到宏任务 `B`。

这题的重点不是背顺序，而是掌握两条：**`async` 函数在 `await` 之前的部分是同步的**（`E` 紧跟 `A`），**`await` 之后的恢复相当于微任务，且入队时刻与 `then` 竞争同一队列**。

</template>

</Exercise>

<Exercise title="练习 2 · 把串行改成并行并限流" difficulty="进阶">

下面函数抓 20 个用户，本地跑约 20 × 300ms。改成「并发但最多 4 个同时在跑」，且任何一个失败都不能影响其他 19 个的结果收集。

```js
async function loadAll(ids) {
  const out = [];
  for (const id of ids) out.push(await fetchUser(id));
  return out;
}
```

<template #answer>

```js
function pLimit(concurrency) {
  const queue = [];
  let active = 0;
  const next = () => { if (active < concurrency && queue.length) { active++; queue.shift()(); } };
  return (fn) => new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject).finally(() => { active--; next(); }));
    next();
  });
}

async function loadAll(ids) {
  const run = pLimit(4);
  return Promise.allSettled(ids.map((id) => run(() => fetchUser(id))));
}
```

两处关键：**先 `map` 出「已启动」的任务再统一等**（`for` + `await` 是串行，本章实跑 626ms 对 200ms 就是这个差别）；**用 `allSettled` 而不是 `all`**（`all` 快失败，一个 404 会让你丢全部结果，实跑 `all 失败: boom → 其他 Promise 不会被取消`）。返回值是 `{status, value/reason}` 数组，消费时先判 `status`。

验证限流有没有生效：`run(() => { console.log('开始', id); ... })` 看同一时刻最多 4 条；或按本章实跑方式计时（并发 2、5 个 200ms 任务 → 623ms；不限流 → 201ms）。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释现象" difficulty="基础">

下面三段各自有什么问题、会出现什么现象（含控制台报错原文的类型），给出修法。

```js
// ①
const users = ids.map(async (id) => await fetchUser(id));
render(users);

// ②
try {
  const res = await fetch(url);
  const data = await res.json();
  return data;
} catch (e) { console.error(e); }

// ③
const ac = new AbortController();
const data = await Promise.race([fetch(url).then(r => r.json()), timeoutP(1000)]);
ac.abort();
```

<template #answer>

① `users` 是 **Promise 数组**，`render` 拿到的是 20 个 `Promise { <pending> }`，UI 显示 `[object Promise]` 或 `data.map is not a function` 类错误（取决于渲染逻辑）。修法：`const users = await Promise.all(ids.map(fetchUser))`。

② 错误被 `catch` 后函数**隐式返回 `undefined`**，调用方 `data.xxx` 抛 `TypeError: Cannot read properties of undefined`——即「原始错误 + 一个二次错误」。修法：`catch` 里 `throw` 或返回明确的空值契约（`{ ok: false }`），并在调用处处理；参见[统一错误处理](/backend/error-handling)。

③ 两处问题：`Promise.race` 超时后**请求并没有被取消**（本章已验证「原 Promise 没有被取消，只是不再被消费」），而且 `ac.signal` 从没传给 `fetch`，`ac.abort()`  abort 的是「什么都没挂上去」的 controller，等于空操作。修法：`fetch(url, { signal: ac.signal })`，并在 `catch` 里用 `e.name === 'AbortError'` 区分主动取消与真实失败；或直接 `AbortSignal.timeout(1000)` 交给 `fetch`。

</template>

</Exercise>

<Exercise title="练习 4 · 手写一个会自己计时的 debounce" difficulty="进阶">

实现 `debounce(fn, wait)`，要求：① 连敲 N 次只执行一次且用最后一次参数；② 提供 `.cancel()`；③ 输出真实执行时刻与最后一次调用的差值以便验证。写出你的验证方式。

<template #answer>

```js
function debounce(fn, wait) {
  let timer = null;
  const wrapper = function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn.apply(this, args); }, wait);
  };
  wrapper.cancel = () => { clearTimeout(timer); timer = null; };
  wrapper.isPending = () => timer !== null;
  return wrapper;
}
```

验证脚本（本章第一段 debounce 输出的来源就是这个思路）：

```js
const t0 = Date.now();
const ms = () => Date.now() - t0;
const d = debounce((v) => console.log(`执行 -> ${v} @${ms()}ms`), 200);
console.log('连敲 3 次 @' + ms());
d('a'); d('ab'); d('abc');
```

真实输出：

```text
连敲 3 次 @0
执行 -> abc @213ms
```

`213ms` 而不是精确 `200ms`，正是本章「实际延迟可能比设定值更长」的表现；**判据应该是「只执行了一次、参数是最后一次、时刻落在 200ms 之后」**，而不是断言等于 200。测试框架里别用真实时间，用 `vi.useFakeTimers()` + `vi.advanceTimersByTime(200)`，见[测试体系](/frontend-engineering/testing)。

顺带一条高频 bug：`wrapper` 必须用 `function` 而不是箭头，否则 `.apply(this, args)` 里的 `this` 是包装函数自己的接收者——箭头写法会把接收者丢掉（[上一章](/javascript/functions-and-scope)的 class 方法回调问题）。

</template>

</Exercise>

<Exercise title="练习 5 · 修一个卸载后仍写状态的异步组件" difficulty="挑战">

下面是简化版的「组件挂载时拉数据」，卸载后异步回调仍在写状态（React 会告警，Vue 里则可能写到一个已销毁的实例上）。用两种不同机制分别修好：① 清理函数 + 标志位；② `AbortController`。并说明「哪个更彻底」。

<template #answer>

```js
// ① 标志位：不取消请求，只丢弃结果（等价于本章的序号法）
function useProfile(id) {
  let ignore = false;
  useEffect(() => {
    ignore = false;
    fetchUser(id).then((u) => { if (!ignore) setState(u); });
    return () => { ignore = true; };
  }, [id]);
}

// ② AbortController：连请求一起掐掉
function useProfile(id) {
  useEffect(() => {
    const ac = new AbortController();
    fetchUser(id, { signal: ac.signal })
      .then(setState)
      .catch((e) => { if (e.name !== 'AbortError') report(e); });
    return () => ac.abort();
  }, [id]);
}
```

**② 更彻底**，因为它同时解决三件事：结果不再被写、网络流量与服务端工作被真正中断、连接不被无谓占用。代价是必须区分 `AbortError`（主动取消，不该上报）和真实失败，且要求被取消方支持 `signal`（`fetch` 支持，普通的 `setTimeout` 封装不支持，得自己挂 `signal.addEventListener('abort', ...)`）。

① 的价值在于**通用**：任何无法取消的异步源（第三方 SDK、已发出的 WebSocket 消息的应答）都能用「丢弃结果」兜住。两个一起写是生产常见做法。

对照框架侧的标准姿势：[useEffect 与 watch 的对照](/react/use-effect)（清理函数）、[computed 与 watch](/vue/computed-and-watch)（`onCleanup`）、[生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject)（卸载时机）。这一节的现象本质是[闭包](/javascript/functions-and-scope)：清理函数闭包住了 `ignore`/`ac`，所以「回调执行时读到的仍是那次挂载自己的变量」。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN `setTimeout` / `Window.setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout) —— 核实本章「负值等同 0」「嵌套 5 次后最小 4ms」「后台标签页节流」「实际延迟可能更长」四条。
- [MDN 在 JavaScript 中通过 queueMicrotask() 使用微任务](https://developer.mozilla.org/zh-CN/docs/Web/API/HTML_DOM_API/Microtask_guide) —— 核实本章的调度模型原文：「微任务在每个任务完成后、下一个任务或渲染更新之前处理」，即「栈空 → 排空微任务 → 才取下一个宏任务」。
- [MDN `Promise` 参考](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise) —— 核实 `all` / `allSettled` / `race` / `any` 的结果形态与 `AggregateError`，以及 `finally` 不改值。
- [MDN `AbortController` / `AbortSignal`](https://developer.mozilla.org/zh-CN/docs/Web/API/AbortController) —— 核实 `AbortError` 名称、`AbortSignal.timeout` 的存在与 `fetch` 的 `signal` 选项。
- [Node.js timers 文档](https://nodejs.org/api/timers.html) —— 核实本章 Node 侧三条：`delay` 小于 1 或 `NaN` 会被设为 1、非整数取整、不保证精确时间与顺序；`setImmediate` 的定位也在这一页。
- [javascript.info · Promise, async/await](https://javascript.info/async) —— 主教材对应章节（本站不复制其正文与题目），`microtaskqueue`、`promise-api` 两节练习建议全做；[Error handling](https://javascript.info/error-handling) 与本章「未处理 rejection」一节互补。

## 下一章

这一章处理的是「什么时候执行」，全部在语言层；到 [DOM 操作与事件系统](/javascript/dom-and-events) 会把同一套模型套到浏览器事件上：事件的三个阶段与冒泡/捕获、`preventDefault` 与 `stopPropagation` 的差别、事件委托为什么能只绑一个监听器（以及它和闭包的配合），还有你在本章反复看到的「回调里拿到的 `this` 是 `currentTarget`」这件事的完整解释。前一章的[原型链、class 与封装](/javascript/prototypes-and-classes)则解释了你在这里写的每一个 `class` 方法为什么会丢 `this`。
