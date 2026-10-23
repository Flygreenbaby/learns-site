# 错误处理与 DevTools 调试：报错信息是线索，不是判决书

页面上一行红字，多数人的动作是截图发出去问，或者把这句话丢进搜索引擎——两种都浪费了一条已经写明白的结论：**`name` 告诉你故障属于哪一层，`stack` 告诉你它从哪一路走到这里**。`TypeError` 和 `ReferenceError` 的排查方向从一开始就不同。

本章前半把「读报错」变成固定流程：错误分类、`Error` 字段、`throw` 与 `try/catch/finally` 的边界、未捕获错误在浏览器和 Node 里分别走哪条路。后半补上报错读不出来时的手段：六种断点、调用栈与 Scope、Performance 与 Memory。

<Callout type="verified" title="语言层结论全部实跑过">

本章所有报错文案、`stack` 首行、`cause`、`AggregateError`、未处理 rejection 的进程行为，都在本机 **Node v25.4.0**（Windows 10 x64，`C:\Program Files\nodejs\node.exe`——安装目录写成通用形式，不含本机私有路径，2026-10-17）实跑取得，原文照抄。DevTools 面板的操作路径与浏览器特有文案未在本机浏览器验证，见对应标注。

</Callout>

## 错误分类：先看 name，再决定往哪一层查

内置错误类型不是分类好看，每种产生时机不同，修法就不同。表中 message 是实跑原文：

| 类型 | 什么时候产生 | 实跑 message | 该改哪一层 |
| --- | --- | --- | --- |
| `SyntaxError` | 解析阶段，代码还没执行 | `Unexpected token ';'`、`Invalid left-hand side in assignment` | 改语法；报的位置常不是真正写错处 |
| `ReferenceError` | 标识符查不到，或在 TDZ 内访问 | `notDefinedVariable is not defined`、`Cannot access 'value' before initialization` | 拼写、作用域、脚本加载顺序 |
| `TypeError` | 值的类型与运算要求不匹配 | `Cannot read properties of null (reading 'items')`、`o.fn is not a function`、`Assignment to constant variable.`、`Cannot destructure property 'a' of 'null' as it is null.` | 数据形状，多半是上游漏下 `undefined` |
| `RangeError` | 值超出允许范围 | `toFixed() digits argument must be between 0 and 100`、`Invalid array length`、`Maximum call stack size exceeded` | 参数校验或递归终止条件 |
| `URIError` | 编解码参数畸形 | `URI malformed` | 只可能是 `encodeURI` 家族传错，见 [fetch、同源策略与浏览器存储](/javascript/network-and-storage) |
| `AggregateError` | 多个错误打包 | `All promises were rejected` | 别读 message，读 `errors` |
| `DOMException` | Web API 抛的，不是语言层 | `DataCloneError`、`AbortError` | 读 `name`，去 Web API 文档查 |

三条实跑补充，都是选型级的：

- **`DOMException` 在 Node 里也是全局**：`typeof DOMException` → `"function"`；`new DOMException(…, "DataCloneError")` 的 `code` 为 `25`，`instanceof Error` 为 `true`。所以 `catch` 到的可能是宿主 API 抛的，这类只按 `name` 分。
- **`structuredClone` 与 `JSON.stringify` 的分界**：`structuredClone(() => {})` 抛 `DataCloneError: () => {} could not be cloned.`；但**自引用对象 `structuredClone` 成功不抛**，`JSON.stringify` 抛 `Converting circular structure to JSON` 并附两行 `--> starting at object with constructor 'Object'` / `--- property 'self' closes the circle`。
- **`SyntaxError` 在同一份脚本里 `try/catch` 包不住**（解析期就抛）。上表两句是用 `new Function("let a = ;")` 和 `eval("1 = 2")` 捕获到的。看到 `SyntaxError` 别去找运行时数据，代码没跑到那行。

## Error 对象值得看的只有四个字段

```js
const err = new Error("表单校验未通过", { cause: inner });
err.name;    // "Error"：可写，错误分类的载体
err.message; // 唯一给人读的部分，会改文案，别拿它做分支
err.stack;   // new Error() 那一刻固定的字符串，之后 throw 多少次都不变
err.cause;   // ES2022：把上一层原始错误挂在下面
```

`cause` 链 + 每层自己的 `stack`，等于同时拿到「在哪被包装」和「最初在哪发生」。实跑：

```text
outer: Error: 配置解析失败
cause: SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
```

后半句是 `JSON.parse("{bad")` 的原文——位置从 1 计数还带行列。项目里本地存储的数据坏了就是这一句。

### 自定义错误类：用 code 判别，不用 message 匹配

`instanceof` 跨 realm（iframe、Worker）会失效，`message` 是给人读的、会随版本变。可靠做法是加一个稳定的 `code`。下面这段实跑过：

```js
class ValidationError extends Error {
  name = "ValidationError";                     // 设了才影响 stack 首行；不设则是 "Error: …"
  constructor(message, { field, code = "VALIDATION", cause } = {}) {
    super(message, { cause });                  // cause 在 super 里透传，不要事后赋值
    this.field = field;
    this.code = code;                           // 判别式字段，调用方只看它
  }
}
// 实跑：e.name / e.code / e.field / e.cause.message →
// ValidationError  VALIDATION  port  端口必须是数字
// instanceof ValidationError = true，instanceof Error = true
```

调用方因此能写成有限分支，而不是正则匹配文案：

```js
switch (e.code) {
  case "NETWORK":    return showRetryBar();
  case "VALIDATION": return highlightField(e.field);
  default:           return reportToServer(e);   // 不认识的一律往上抛，别静默吞
}
```

这套「用可辨识字段收窄到具体分支」在 [TypeScript 第 3 章 收窄](/typescript/unions-and-narrowing) 里由类型系统直接检查：每个错误类给一个字符串字面量 `code`，`if (e.code === "VALIDATION")` 之后 `e.field` 才有类型。同一个设计，JS 靠约定，TS 靠编译器。

## throw 可以抛任何值，所以只抛 Error 实例

`throw` 后面是表达式，不是类型检查点。实跑抛字符串的结果：

```text
typeof = string   value = 只是一个字符串   stack = undefined   instanceof Error = false
```

代价很具体：**没有调用栈，你连它从哪来都不知道**，`name`/`message` 也不存在，日志采集收到一串 `undefined`。Python 习惯的 `throw "原因"` 在 JS 里就是这个后果。要传结构化信息就抛带 `code` 的子类；第三方库抛 plain object 时，在系统边界用 `new Error(desc, { cause: value })` 归一化，`cause` 保留原值。

## try/catch/finally：三个会咬人的边界

### finally 的 return 能吞掉异常

```js
function trap() { try { throw new Error("里面抛了"); } finally { return "finally 的返回值"; } }
console.log(trap());   // 实跑 → "finally 的返回值"，那个 throw 消失了
```

`finally` 里出现 `return`（或 `break`、`throw`）会**接管控制流**：异常被丢弃、`try` 的返回值被替换。反过来，`try` 里 `return` 时 `finally` 仍执行（实跑打印了 `finally 仍然执行`，返回值仍是 `try` 的）。规则：**`finally` 只写清理，永远不写 `return`**。

### 同步异常与异步异常是两条捕获路径

这是 [事件循环、Promise 与 async/await](/javascript/asynchronous) 的报错版。实跑：

```text
### try 包住但漏了 await，catch 是否执行: false
### 最终由 unhandledRejection 接住: TypeError: 异步里的 TypeError
### 定时器里的同步异常由 uncaughtException 接住: 宏任务里抛
```

`try { asyncFn() }`（漏 `await`）**接不住任何东西**，异常在下一个微任务里变成未处理 rejection；`try { setTimeout(() => { throw … }) }` 也接不住，因为那句本身成功返回，回调在之后的宏任务里执行、栈已换。正确的三种接法：

```js
try { const data = await loadTodos(); }              // 1) await + try/catch，缺一不可
catch (e) { if (e.code === "TIMEOUT") return retry(); }

const rs = await Promise.allSettled([a(), b()]);      // 2) 要全部分类：实跑 status 为 fulfilled,rejected
try { await Promise.any([fa(), fb()]); }               // 3) 竞速全失败：抛 AggregateError
catch (e) { console.log(e.name, e.errors.map(x => x.message)); }
// 实跑：AggregateError: All promises were rejected | errors: 接口 A 超时 | 接口 B 500
```

`AggregateError` 的 `message` 永远是那句固定文案，**只记 message 的日志等于什么都没记**，必须序列化 `errors`。

### 别把 catch 当流程控制

`obj[key]` 键不存在时返回 `undefined` 不抛错，所以 `try { value = obj[key] } catch { value = fallback }` 的 `catch` 是死代码，该写 `obj[key] ?? fallback`。反之「读 localStorage 的 JSON」确实抛 `SyntaxError`，包 `try/catch` 回落到默认值才是有意义的用法。判断标准就一句：**这一行有没有可能真的抛错**。

## 未捕获错误的两条路

`try/catch` 覆盖不到的（回调里抛的、没人接的 rejection、语法错误）落到全局。两个环境机制不同，**生产风险也完全不同**。

### 浏览器：error 与 unhandledrejection

```js
window.addEventListener("error", (e) => {
  // ErrorEvent 只读字段：message / filename / lineno / colno / error
  report({ msg: e.message, at: `${e.filename}:${e.lineno}:${e.colno}`, stack: e.error?.stack });
});
window.addEventListener("unhandledrejection", (e) => {
  report({ msg: String(e.reason?.message ?? e.reason), stack: e.reason?.stack });
  e.preventDefault();   // 不写这行，报错仍会打到控制台
});
```

MDN 核实四点（2026-10-17）：`ErrorEvent` 的只读字段就是上面五个；`window.onerror`（属性形式）的签名是 **五个参数** `(message, source, lineno, colno, error)`，与 `addEventListener` 收单个事件对象的形状不同，抄代码别混用；属性形式要取消默认行为得 `return true`，事件形式用 `preventDefault()`；**只有同步抛出的脚本错误走 `error`，rejection 走 `unhandledrejection`**，且跨域脚本的 rejection 不触发后者。

补一条：图片/脚本/样式加载失败也派发 `error`，但这类事件**不冒泡**，要用捕获阶段监听（`addEventListener("error", h, true)`），与 [DOM 操作与事件系统](/javascript/dom-and-events) 的捕获规则一致。`lineno`/`colno` 是**打包后文件**的行列，不是你源码的行号。

### Node：uncaughtException 与 unhandledRejection

实跑三组，这是本章最需要记住的行为差别：

```text
# 不注册任何 handler
同步语句仍然执行
Error: 没人接的 rejection
    at file:///.../rej1.mjs:1:16     → 退出码 1

# 注册 unhandledRejection
### 被 unhandledRejection 捕获: Error: 没人接的 rejection
进程继续运行到此处                    → 退出码 0

# 注册 uncaughtException，同步调用链中途抛
### uncaughtException: Error: 埋得很深 → 退出码 0，但它后面的 console.log 与 setTimeout 注册都没执行
```

| 情况 | 默认行为 | 装了 handler（实跑） |
| --- | --- | --- |
| 未处理 Promise rejection | 打印错误，**进程退出码 1** | 不退出，继续跑（0） |
| 未捕获同步异常 | 打印栈，崩溃退出 | 进程不崩，但**当前脚本剩下的同步代码整段放弃** |

`uncaughtException` 是**最后的日志兜底，不是错误恢复机制**：它把「崩溃」换成「带着未知状态继续跑」——锁没释放、连接池半开、事务没回滚。正确姿势是记录后主动退出，让进程管理器重启，与 [后端统一错误处理](/backend/error-handling) 是同一个决定。

## 读调用栈：找第一个属于你项目文件的帧

```text
TypeError: o.fn is not a function
    at file:///C:/.../err1.mjs:9:53        ← 抛错点，最上面
    at show (file:///C:/.../err1.mjs:2:9)   ← 谁调用了它
```

**从上往下扫，找第一个属于你项目文件的帧**，其余跳过：`node:internal/...`、`at Number.toFixed (<anonymous>)`、`at decodeURIComponent (<anonymous>)` 都是引擎帧。`<anonymous>` 表示这一帧**没有可显示的函数名**——内建函数、匿名箭头函数、`new Function` 造出来的函数都会显示成它；一串 `<anonymous>` 说明你在引擎或库内层，往上翻。递归错误长成一个文件一行重复几百遍，别往下读，直接看这帧里**哪个参数在变**（不变就是终止条件写错）。

### 压缩后的堆栈与 sourcemap

线上你拿到的是 `at Object.<anonymous> (https://cdn.example.com/app.3f9c1a.js:1:28451)`——第 1 行第 28451 列，整个 bundle 压成一行，行号失效。三条出路按成本排：① 构建产出 sourcemap 并上传错误监控平台，由它还原成 `src/todos.js:57:20`（选项见 [Vite 构建侧](/frontend-engineering/vite-build)）；② Sources 面板 `Ctrl+P` 打开压缩文件，右键 `Add source map…` 填 map 地址；③ 只按 `message` 猜，最差，只在错误分类明显时可用。

<Callout type="warn" title="sourcemap 不要公开托管">

sourcemap 含原始源码。生产产物若带 `//# sourceMappingURL=app.js.map` 且该 map 公网可访问，等于公开源码。要么只传私有监控平台，要么构建时把 map 与公网产物分离、内部保留。

</Callout>

## DevTools 调试方法论

<Callout type="unverified" title="面板操作路径未在本机浏览器验证">

下面关于 Sources、Performance、Memory、Network 的入口、按钮名称与右键菜单项，**未在本站环境执行过真实浏览器操作**（本机 Node 无法渲染页面）。断点类型与面板归属是稳定概念，但菜单位置随版本变化；对不上时用 `Ctrl+Shift+P` 命令菜单搜功能名，比翻菜单可靠。名称以 [Chrome DevTools 文档](https://developer.chrome.com/docs/devtools/) 为准，另见 [布局调试方法论](/css/debugging-layout)。

</Callout>

### Console：当查询台，不是打印台

```js
console.table(rows);   console.group("阶段 3"); console.groupEnd();
console.time("render"); /* … */ console.timeEnd("render");
console.assert(list.length > 0, "列表为空", list);   // 只在条件为假时打印
console.count("render");  // 数调用次数，判断「渲染跑了几遍」最快
```

| 引用 | 含义 |
| --- | --- |
| `$_` | 上一条表达式的返回值，刚查完能接着 `Object.keys($_)` |
| `$0`–`$4` | 最近 5 次在 Elements 选中的 DOM 节点。选中表格 → 切 Console 写 `$0.querySelectorAll('tr').length` |
| `$$(sel)` | 等价 `querySelectorAll` 但返回**数组**，能直接 `.map` |
| `copy(x)` | 序列化进剪贴板；要一份响应体当 mock 时比手抄可靠 |

打日志时把「你以为的形状」和实际值一起打：`console.log(typeof x, x)`——只打值时 `null` 与 `undefined`、`"1"` 与 `1` 长得很像。

### Sources：断点有六种，选错类型等于白设

| 断点类型 | 入口 | 用在什么场景 |
| --- | --- | --- |
| 行断点 | 点行号 | 已知函数可疑，看进来时的参数 |
| 条件断点 | 右键行号 → `Add conditional breakpoint` | **循环里第 337 次才错**、只有某个 id 有问题；不写条件你要按 300 次 F10 |
| 日志断点 | 右键行号 → `Add logpoint` | 不能停的场景（动画、拖拽、rAF 回调），打印但不中断 |
| DOM 断点 | Elements 右键节点 → `Break on…`（subtree / attribute / node removal） | 「谁改了这个节点」「谁加的 class」——回答这类问题的唯一手段 |
| XHR 断点 | Sources 右侧 `XHR/fetch Breakpoints` → `+` 填 URL 片段 | 请求发出前看最终 payload；确认「参数到底发出去了没」 |
| Pause on exceptions | Sources 顶部 `⏸` 图标，旁有 `Pause on async exceptions` | 报错但不知抛点——停在真正 `throw` 的那行，而不是栈顶 |

它会被**已被 catch 的异常**打断，此时在右侧断点面板取消 `Caught exceptions`，只停未捕获的。

### step over / into / out，以及为什么 step into 掉进框架里

`F10` 执行当前行不进去；`F11` 进入被调函数；`Shift+F11` 跑完当前函数回到调用方。**「想进自己的函数却进了框架内部」只有一个原因：那一行调的是别人的代码**——`list.map(fn)` 按 F11 进的是 `Array.prototype.map`。两个解法：

- 别 step into 带回调的高阶函数那一行，改成**在回调第一行设行断点再 Resume**，最快。
- 已经进去了就 `Shift+F11`，或干脆**在 Call Stack 里点你想要的那一帧**——上下文和 Scope 会跟着切过去，不必一步步走。

把库文件加入忽略列表（Sources 右键 → `Ignore this context`）后，step into 只会进你的代码。

### Call Stack 与 Scope 才是断点的产出

停在断点上只读两样：Call Stack 选帧（回答「谁在什么时候调用它的」，重点看有没有**预期外的调用者**）；Scope 的 Local / Closure 分组（回答「此刻它以为的数据是什么」）。Closure 分组直接列出这个闭包捕获了哪些变量，是 [函数、作用域、闭包与 this](/javascript/functions-and-scope) 的可视化：回调「拿到旧值」时，答案就在那里。断点面板上方还能直接输入表达式求值，作用域是当前帧的，比在 Console 重新取全局对象准。

### Performance 入门：先找长任务

固定流程：**Performance → `Record` → 操作页面 → `Stop` → 先看 `Main` 轨道有没有宽块**。读火焰图记住**横轴是时间不是深度**，一块宽就是占时长；`Main` 轨道上深橙是任务、紫是渲染、绿是网络，长任务处有红色小三角。`Bottom-Up` 回答「哪个函数自身最耗时」，`Call Tree` 回答「哪条链把时间带进来的」。

Console 里出现 `Layout Thrashing (Force Redraw)` 类警告、或 `Rendering` 轨道密集重排，就是**强制同步布局**，读写分离的做法见 [JS 层面的无障碍与性能](/javascript/accessibility-and-performance)；位移类问题看 `Layout Shifts` 轨道。

### Memory：三份快照对比

定位内存问题靠**对比**而不是看绝对值：页面稳定后拍 A → 做一轮可疑操作（开弹层再关、切筛选十次）拍 B → **再重复同一轮**拍 C。B 里多出来但 C 里没了的是缓存，**A 与 C 之间还在增长的才是泄漏**。用 `Objects allocated between snapshot 1 and snapshot 3` 过滤，找 `Detached DOM tree` 字样；对可疑对象右键 → `Retainers`，顺着「谁还引用着它」往上找到那个数组、那个 `Map`、那个没解绑的监听器。

更轻的入口是 Performance 面板勾 `Memory` 跑时间线：健康的堆是锯齿状但底部平稳，**底部一路抬升就是泄漏**。代码成因清单在下一章。

### Network：先分清「是不是 JS 的错」

`Failed to fetch`、页面卡住、数据是空的，都不一定是代码问题。四个动作（过滤语法与 CORS 细节见 [fetch、同源策略与浏览器存储](/javascript/network-and-storage)）：看 **Status**（`200` 但结构不对 = 你的解析错；`CORS error` = 服务端 header；`net::ERR_BLOCKED_BY_CLIENT` = 插件拦的）；看 **Request headers** 里 `Origin`、`Cookie` 有没有带上；右键 `Copy` → `Copy as cURL` 脱离浏览器复现；**勾 `Preserve log`**，否则跳一次页日志全空，「点提交就什么都不剩」根本查不了。

### 三个土办法：debugger 语句、二分注释、规范化日志

```js
function applyFilter(state, filter) {
  if (filter === "archived") debugger;   // 只有走到这条分支才停，能进版本库
  return state.todos.filter(t => t.status === filter);
}
```

`debugger` 等价于行断点，适合「只有某个分支会触发」，**用完必须删**——留在主干上会让所有走到那条路的用户在 DevTools 打开时卡死。**二分注释法**：位置不明时把可疑区间注释一半看报错是否消失，每次砍一半，十行代码四次定位完。**加日志的规范**（临时日志不规范的代价是上线时不知道哪些该删、事后看不出谁打的）：

```js
console.log("[todos:render]", { count: state.todos.length, filter: state.filter });
//              ^^^^^^^^^^ 前缀=模块:动作    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ 判断所需的最小变量集
```

前缀必写（删除时全局搜 `[todos` 一次清干净）；不要打整个 `state`，看不到重点还可能拖慢渲染；提交前删掉，或交给 [ESLint 与 Prettier](/frontend-engineering/lint-and-format) 的 `no-console` 规则做门禁。日志的价值在你写下它的十分钟。

## 「复现不了」的四种成因

| 成因 | 典型表现 | 动作 |
| --- | --- | --- |
| 数据依赖 | 只有某个用户/某条记录会错 | 要到那条数据；把响应存下来做 mock；在渲染入口 `console.assert` 记录畸形数据出现的那一刻 |
| 时序依赖 | 快点几下才错、慢网才错、偶尔白屏 | 竞态，见 [事件循环、Promise 与 async/await](/javascript/asynchronous)；Network 切慢速档；在两个异步回调里各打一条带时间戳的日志看先后 |
| 环境差异 | 本地好线上炸、Chrome 好 Safari 炸 | 先排构建差异（sourcemap、代码分割、缓存），见 [HTTP 缓存与资源加载策略](/frontend-engineering/http-caching)；再用 [Can I use](https://caniuse.com/) 核对专有 API |
| 随机性 | 每次顺序都不同 | 查 `Object.keys` 顺序假设、渲染里掺了 `Date.now()`/`Math.random()`、并发请求的**完成顺序**（`Promise.all` 结果顺序稳定，完成顺序不） |

一个习惯：**出错现场要能重建**。把关键状态收进一个纯对象（[阶段项目](/javascript/project) 的 `state` + `render()`），排查时在 Console 改 `state` 再 `render()` 就重现了，比在 DOM 上手动点十步可靠。

## 六个真实报错的排查路径

**1）`Cannot read properties of undefined (reading 'x')`**（实跑同族：`Cannot read properties of null (reading 'items')`）
先看：引擎把**读不到的那个键名**给了你，先确定链条里哪一环是 `undefined`。最可能：接口字段改名、`find`/`filter` 返回 `undefined`、下标越界再取属性。确认：在报错行的**上一行**打断点看对象的真实形状；数据来自接口就直接看 Network 响应体。修法取决于这个 `undefined` 是否合法：合法就兜底（`?.` / 默认值），不合法别在渲染层静默，回到取数据那一层。

**2）`o.fn is not a function`**（实跑文案一致）
先看：`is` 前的完整表达式和它出现在哪一帧。最可能：属性名拼错；`import` 形状不对（默认导出与具名导出写反）；循环依赖里被依赖方还没执行完；那个值其实是字符串或数字。确认：打 `typeof o.fn`——`undefined` 说明属性根本不存在，其他类型说明被覆盖；模块问题去源文件核对 `export default` / `export const` 与导入写法，见 [ES 模块、动态导入与迭代器](/javascript/modules-and-iterators)。**「本地能跑、打包后才报这句」几乎一定是模块形状或循环依赖**。

**3）`Maximum call stack size exceeded`**（实跑文案一致，栈为同一行重复）
先看：重复出现的那一帧，和它每次进来时哪个参数在变。最可能：递归无终止条件、A↔B 间接互调、`render()` 里不小心调自己；也可能是序列化自引用对象（实跑另一条就是 `Converting circular structure to JSON`）。确认：两帧之间有没有真实推进；若是循环引用，检查状态对象里是不是塞进了 DOM 节点或父引用——那正是下一章的泄漏源头之一。

**4）`Assignment to constant variable.`**（实跑文案一致，含句点）
先看：报错行与等号左边那个变量名。最可能：把 `const` 当「不可变」用（`const list = []; list = [...]` 错、`list.push()` 合法），或从 `let` 改成 `const` 后漏改某处赋值。确认：全局搜变量名。记住 `const` 只锁绑定不锁内容——若你改的是对象内容而数据没变，那不是这个问题（见 [类型、值与引用语义](/javascript/types-and-values)）。

**5）`Cannot access 'value' before initialization`**（实跑文案一致）
先看：变量名和它的声明行。最可能：暂时性死区（TDZ），跑到了 `let`/`const` 声明之前，高频长相是模块循环依赖、类字段初始化顺序、`const` 函数写在调用点之后；实跑的最小复现正是「函数 `load` 引用了后面声明的 `const value`，而它在声明前被调用」。确认：**别去查拼写**——`is not defined` 才是「变量不存在」，`before initialization` 是「存在但你跑早了」，两句修法完全不同。

**6）`Failed to fetch`**
先看：**别看 Console，先看 Network 那条请求**。这句是「请求没成功」的统称，本身不含原因。最可能：CORS（Console 通常还有更长的 `…has been blocked by CORS policy`）、服务没起或端口错、插件拦截、混合内容（HTTPS 页请求 HTTP 接口）、离线。确认：`Copy as cURL` 到终端跑——能通说明问题在浏览器侧，不能通在服务端。Node 侧对应物已实跑：连不上抛 `TypeError: fetch failed`，真实原因在 `e.cause`（本次为 `Error: bad port`），**所以生产日志必须序列化 `cause`**。`AbortSignal.timeout()` 本机 Node 存在（`typeof` 为 `function`），超时同样报 `fetch failed`；浏览器里被 abort 的请求抛 `AbortError`（`DOMException`）这一条**未在本机浏览器验证**，以 [MDN AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) 为准。

## 常见错误与排查

**1）`catch` 接不住异步异常，日志只剩一句 unhandled rejection。** 现象：包了 `try/catch` 控制台仍报未处理 rejection。原因：漏 `await`，`catch` 只覆盖同步阶段（实跑证明它一次都没执行）。确认：加 `await`，若 `catch` 立刻生效就是它。修：`await` + `try/catch` 或链尾 `.catch()`；`forEach` 里的 `async` 回调换 `for...of` / `Promise.all`。

**2）抛字符串，线上日志全是 `undefined`。** 现象：采集平台收到的栈为空。原因：非 `Error` 值没有 `stack`（实跑 `e.stack === undefined`）。确认：打 `e instanceof Error`。修：只抛 `Error` 子类；边界处归一化。

**3）`finally` 里写 `return`，异常被静默吞掉。** 现象：函数返回了不该返回的值，`catch` 从没进过。原因：`finally` 的 `return` 接管控制流（实跑已证）。确认：搜 `finally` 块里的 `return`/`break`/`throw`。修：`finally` 只做清理。

**4）用 `message` 匹配决定分支，换个引擎或版本就失效。** 现象：某环境分支不生效。原因：`message` 是给人读的，本章那六句原文在不同 V8 版本间已经在变。确认：搜 `e.message.includes(`。修：`instanceof` + `code`；需跨 realm 时只靠 `code`。

**5）在 `uncaughtException` 里打个日志就让进程继续跑。** 现象：不崩了，但过会儿数据错乱、内存缓涨、偶发 500。原因：接管默认行为等于「带着半完成状态继续服务」，实跑可见当前脚本剩余同步代码被整段放弃、清理根本没跑。确认：改成记录后 `process.exit(1)`，看问题是否消失。修：兜底 handler 只负责「写完整最后一条日志 + 退出」，重启交给进程管理器，见 [服务部署：Docker、优雅关闭与配置](/backend/docker-and-shutdown)。

**6）断点打在编译后的行上，永远不停。** 现象：F8 无反应。原因：Sources 里打开的是 bundle 而不是 `src` 原始树；或 sourcemap 未生成；或该行只在 `dev` 存在、被 tree-shaking 摇掉了。确认：左侧 Page 树里有没有 `src` 分组、行号是否有淡色标记。修：本地用 `npm run dev` 起 dev server 调试，别拿 build 产物调，见 [Vite 开发侧](/frontend-engineering/vite-dev)。

## 练习

<Exercise title="练习 1 · 制造并读出 cause 链" difficulty="基础">

写一段代码：`JSON.parse` 一个不合法字符串，外层用 `new Error("配置读取失败", { cause: 原错误 })` 包一层抛出。回答：(a) 外层错误的 `stack` 首行是什么？(b) `cause.message` 是什么？(c) 为什么 `cause` 要在 `super()` 里透传而不是事后赋值？

<template #answer>

(a) `Error: 配置读取失败`——`stack` 头部用**构造时的 `name`**，你没改 `name` 就永远是 `Error`。(b) 本机 Node v25.4.0 实跑 `JSON.parse("{bad")` 得 `Expected property name or '}' in JSON at position 1 (line 1 column 2)`，位置从 1 计数并带行列；其他引擎文案不同，这正说明不能拿 `message` 做分支。(c) 事后赋值也能写进去，但会破坏一条约定：**`Error` 的关键信息（`name`/`message`/`stack`/`cause`）应在构造点定死**，否则跨层传递时没人知道哪个 `cause` 属于哪一层。子类里必须透传：

```js
class ConfigError extends Error {
  constructor(msg, cause) { super(msg, { cause }); this.name = "ConfigError"; this.code = "CONFIG"; }
}
```

</template>

</Exercise>

<Exercise title="练习 2 · 读栈定位：该改哪一行" difficulty="进阶">

带 sourcemap 的栈如下（抛错点在最上，与实跑排列一致）：

```text
TypeError: Cannot read properties of undefined (reading 'deadline')
    at TodoItem.render (src/TodoItem.js:23:18)
    at src/list.js:41:26
    at Array.map (<anonymous>)
    at renderList (src/list.js:40:14)
    at HTMLFormElement.handleAdd (src/main.js:88:5)
```

回答：(1) 第一个「你自己写的且最可能出错」的帧是哪个？(2) `Array.map (<anonymous>)` 要不要读，为什么显示 `<anonymous>`？(3) 这条栈能否证明异常是同步发生的？(4) 改动落在 `main.js:88` 还是 `TodoItem.js:23`？

<template #answer>

(1) `TodoItem.render (src/TodoItem.js:23:18)`——第一个项目文件的帧。(2) 不读。`Array.map` 是引擎内建函数、没有可显示函数名所以显示 `<anonymous>`；这一帧只是**结构信息**（`render` 在 map 回调里被调用），不是故障点，所有 `(<anonymous>)`、`node:internal/…` 都跳过。(3) 能。从 `handleAdd` 到 `render` 是**同一个帧栈**，说明整条链在一个同步任务里完成，外层 `try` 也接得住；若跨到微/宏任务，栈会出现新入口帧且外层 `try` 接不住（本章已实跑）。(4) 两处都要，但顺序是：在 `TodoItem.js:23` 打断点看那个对象的真实形状 → 发现缺 `deadline` → 回 `main.js:88` 查是谁构造的新项。在 `render` 里加 `?.` 只是把报错变成静默画错，**根因多半是新增项时没写这个字段**。一句话：从下往上找第一个自己的帧，从上往下找数据来源。

</template>

</Exercise>

<Exercise title="练习 3 · 预测输出与异常归属" difficulty="进阶">

```js
function f() { try { return "A"; } catch { console.log("B"); } finally { console.log("C"); } }
async function g() { throw new TypeError("D") }
try { f(); g(); } catch (e) { console.log("E", e.message) }
console.log("F", f());
window.addEventListener("unhandledrejection", (e) => console.log("H", e.reason.message));
```

按顺序列出输出，指出异常最终由谁接住。同一份代码跑在 Node 上有什么不同？

<template #answer>

同步阶段：`C` → `C` → `F A`。`f()` 里 `try` 先准备好返回值，`finally` 在返回**之前**执行（打印 `C`），`catch` 不执行；最后一行再次调用 `f()`，所以 `C` 出现两次。`g()` **没有 await**，外层 `catch` 不执行（不打印 `E`），rejected Promise 在微任务里落到全局：`H D`。

跑在 Node：把 `unhandledrejection` 换成 `process.on("unhandledRejection", r => console.log("H", r.message))`，顺序一致；**不注册 handler 时 Node 打印错误并以退出码 1 结束进程**，浏览器只打一条红字、页面继续跑。这两点已在本机实跑。

补充：把 `finally` 改成 `finally { return "C2" }`，则 `F A` 变 `F C2`；若 `try` 里换成 `throw`，异常被彻底吞掉、返回值变 `C2`——就是本章那条 `finally` 规则。

</template>

</Exercise>

<Exercise title="练习 4 · 用 code 给 fetch 失败分类" difficulty="进阶">

写 `loadTodos()`：`fetch` 一个 JSON 接口，三种失败（连不上、HTTP 4xx/5xx、响应体不是合法 JSON）要能被调用方用 `err.code` 区分，且调用方不许读 `err.message`。写出实现与调用侧分支，并说明「`fetch` 对 4xx 不抛错，所以 4xx 不算错误」这个推论错在哪。

<template #answer>

```js
class LoadError extends Error {
  constructor(code, message, cause) { super(message, { cause }); this.name = "LoadError"; this.code = code; }
}
async function loadTodos(url) {
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(5000) }); }
  catch (e) { throw new LoadError("NETWORK", "接口连不上", e); }   // fetch failed / AbortError
  if (!res.ok) throw new LoadError("HTTP", `HTTP ${res.status}`);   // 4xx/5xx 必须自己判
  try { return await res.json(); }
  catch (e) { throw new LoadError("PARSE", "响应不是合法 JSON", e); }
}
try { state.todos = await loadTodos("/api/todos.json"); }
catch (e) {
  switch (e.code) {
    case "NETWORK": showRetryBar(); break;
    case "HTTP":    showError("服务异常"); break;
    case "PARSE":   showError("数据格式不对"); break;
    default: throw e;
  }
}
```

「4xx 不算错误」错在结论不在前提：`fetch` 只在**网络层**失败时 reject，`404`/`500` 是正常完成的响应（`res.ok === false`）。不检查 `res.ok` 的话，`res.json()` 会拿到 HTML 错误页并抛 `SyntaxError`，于是「接口 404」被伪装成「数据格式坏了」，排查方向整个跑偏——这就是 `HTTP` 分支必须排在 `json()` 之前的原因。超时通常也值得单独给 `TIMEOUT`，因为文案和「再试一次」的交互不同。

</template>

</Exercise>

<Exercise title="练习 5 · 为四个场景选断点类型" difficulty="挑战">

从「行断点 / 条件断点 / logpoint / DOM 断点 / XHR 断点 / pause on exceptions」里为每个场景选一种并说明理由：① 列表第 337 项渲染时报错，其它项正常。② 有个 class 被不知哪来的代码在 2 秒后加到某个 div 上。③ 请求 payload 少了一个字段，发送前经过 6 层封装。④ 报错只有 `Cannot read properties of undefined`，栈顶在第三方库里。

<template #answer>

① **条件断点**：`index === 336` 或 `item.id === 已知那个 id`。循环里逐个 F10 不可行，条件断点把「只有这一条数据有问题」编码进断点——数据依赖类问题的第一动作永远是拿到那条数据。
② **DOM 断点 → attribute modifications**：Elements 右键该节点设断，等 2 秒，停下时 Call Stack 就是「谁加的 class」。这是唯一能回答「谁改了 DOM」的手段，加日志只在你能猜到改动方时才有效。
③ **XHR 断点**（填 URL 片段）在发出前停住，Scope 看最终 payload；再在 6 层封装的每层入口加 **logpoint**，一次复现就看到字段在哪层被丢掉，比逐层打断点快，也不会打断后续请求。
④ **`pause on exceptions`**（必要时勾 async 版本）：栈顶在库内说明是库读你传进去的数据时炸的，你要的是「异常那一刻的入参」而不是库那行代码。停住后在 Call Stack 点到自己项目那一帧，Scope 随之切换；再把库文件 `Ignore this context`，后续 step 只走你的代码。

</template>

</Exercise>

## 官方文档与延伸阅读

- [javascript.info · Error handling](https://javascript.info/error-handling) —— 本站路线标为「全读全做」；本章是它的工程化补完，用于核实自定义错误类该带哪些字段。
- [javascript.info · Debugging in the browser](https://javascript.info/debugging-chrome) —— DevTools 入门，用于核对本章 Sources/Console 描述与当前版本是否一致。
- [MDN · Error](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error) —— 核实 `cause` 构造选项写法、四个字段性质与内建错误类型的继承关系。
- [MDN · AggregateError](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AggregateError) —— 核实 `errors` 字段与 `Promise.any` 的关系（本章已实跑）。
- [MDN · Window error event](https://developer.mozilla.org/en-US/docs/Web/API/Window/error_event) —— 核实 `onerror` 五参数签名、`return true` 取消默认行为、「同步错误走 error / rejection 走 unhandledrejection」（2026-10-17 读取）。
- [MDN · Window unhandledrejection event](https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event) —— 核实 `reason` 字段、可取消性与「跨域 rejection 不触发」。
- [MDN · ErrorEvent](https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent) —— 核实五个只读字段。
- [MDN · PerformanceLongTaskTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming) —— 核实长任务定义（占用主线程 50ms 以上）、`observe({ type: "longtask", buffered: true })` 写法与「非 Baseline」的支持度结论。
- [Node.js · process 文档](https://nodejs.org/docs/latest/api/process.html) —— 核实 `uncaughtException`/`unhandledRejection` 的官方定位与「不要靠它让进程继续运行」的措辞；实跑数据来自本机 v25.4.0，默认值以你所用版本文档为准。
- [Chrome DevTools](https://developer.chrome.com/docs/devtools/) —— 面板入口与快捷键的权威来源，本章面板描述未经浏览器验证，动手前对照。

## 下一章

本章处理「代码已经出错怎么办」：读错误对象、读栈、用面板定位。下一章换到「代码没出错但体验不对」那一侧——[JS 层面的无障碍与性能](/javascript/accessibility-and-performance)：键盘走不走得到、读屏听不听得到、主线程是不是被你的 JS 占住、监听器和定时器有没有在吃内存。两章共通点是**用测量代替猜测**：一个靠断点与栈，一个靠 `PerformanceObserver` 与堆快照。

再往后是 [阶段项目：纯 JavaScript 待办清单](/javascript/project)，那里要你把「状态与视图分离」亲手实现一遍，本章的错误分类与 `render()` 调试手法会直接用上。语言读到这一步就可以进 [TypeScript](/typescript/) 了，判断标准在 [JavaScript 学习地图](/javascript/learning-map)。
