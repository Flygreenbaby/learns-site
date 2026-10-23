# JavaScript 学习地图：javascript.info 该按什么顺序读、读到哪一节就够

`for (var i = 0; i < 3; i++) setTimeout(() => console.log(i))` 打印 `3 3 3`，你在评论区看到三种互相矛盾的解释；`async` 返回的是值还是 Promise，只能靠试；Vue 的 `watch` 不触发，你以为是框架的锅，其实是你不知道传进去的是引用还是拷贝。答案都在 javascript.info 里，但**它是一百多节内容**：不知顺序、不知取舍，要么在不需要的情节上烧掉几十小时，要么跳过语言直接学框架、然后在语言层面反复卡住。

这张地图解决两件事：**主线在哪、本站补什么**。

## 本站不重做一份 JS 教程

语言特性由 ECMA-262 每年推进，个人笔记很快过时；javascript.info 自带 Task，那是「看完就忘」与「真的会写」的差别，重写题库成本远超收益；同一份知识不该有两个来源——你还要学 HTML、CSS、TypeScript、Vue、Fastify、SQL、Docker。

所以本站只做它没有的三件事：**中文知识地图**（哪节管哪个坑）、**衔接**（哪节决定你读不懂 TS 的什么、Vue 的什么）、**易错点集中清算**（把散在十几节里的引用语义与转换规则合并成可查的表）。跳过它只读本站，你拿到结论而不是推导；只读它而不取舍，时间花在不需要的情节上。

## 正确用法：跟读主线，本站做三个动作

1. 按对照表选一节，读 [zh.javascript.info](https://zh.javascript.info/) 对应章节（slug 与英文版一致，`/closure` → `https://zh.javascript.info/closure`）。
2. 做完它的 Task（做法见后）。
3. 术语卡住回本页术语表；要「这坑怎么咬你」的场景解释，读本站对应章。
4. **自己跑一遍**：本站 JS 各章关键结论都在 Node v25.4.0 上验证过，你能复现，不必相信口头结论。

## 对照表：javascript.info 章节 → 中文要点 → 本站补充 → 前置依赖

<Callout type="verified" title="章节标题与链接取自当日抓取的首页目录">

抓取时间 2026-10-17，来源 [javascript.info](https://javascript.info/)，页面标注 Last updated October 16, 2026。下表只写抓取结果里出现的标题与 slug；部分标题下有「More…」折叠，本页不猜测被折叠的小节，统计只算可见项。

</Callout>

### 第一部分 The JavaScript language

| 章节（关键小节） | 中文要点 | 本站补充 | 前置 |
| --- | --- | --- | --- |
| [An introduction](https://javascript.info/getting-started)：intro、manuals、devtools | 能做什么、规范与实现、控制台 | — | 无 |
| [JavaScript Fundamentals](https://javascript.info/first-steps)：variables、types、type conversions、comparison、[nullish ??](https://javascript.info/nullish-coalescing-operator) | 变量、类型与转换、比较与 `??` | [第 2 章 类型与值](/javascript/types-and-values)、[第 4 章 函数与作用域](/javascript/functions-and-scope) | [HTML](/html/) |
| [Code quality](https://javascript.info/code-quality)：[debugging](https://javascript.info/debugging-chrome)、coding style、polyfills | 断点与 Scope 面板、垫片与转译 | [第 10 章 调试](/javascript/errors-and-debugging) | 上面两组 |
| [Objects: the basics](https://javascript.info/object-basics)：objects、[references and copying](https://javascript.info/object-copy)、this、[optional chaining](https://javascript.info/optional-chaining)、[to primitive](https://javascript.info/object-toprimitive) | 引用与拷贝、GC、`?.`、对象转原始值 | [第 2 章](/javascript/types-and-values)、[第 3 章](/javascript/objects-and-arrays) | Fundamentals |
| [Data types](https://javascript.info/data-types)：array、[array methods](https://javascript.info/array-methods)、map and set、[destructuring](https://javascript.info/destructuring-assignment)、[JSON](https://javascript.info/json) | 数组与方法、Map/Set、解构、JSON 边界 | [第 3 章 对象与数组](/javascript/objects-and-arrays) | Objects |
| [Advanced working with functions](https://javascript.info/advanced-functions)：rest 与 spread、[closure](https://javascript.info/closure)、the old var、[arrow revisited](https://javascript.info/arrow-functions)、bind | 闭包、作用域链、`var` 包袱、this | [第 4 章 函数、作用域、闭包与 this](/javascript/functions-and-scope) | Objects + Data types |
| [Object properties configuration](https://javascript.info/object-properties)：[descriptors](https://javascript.info/property-descriptors)、getters | 三个标志位、`defineProperty` | [第 3 章](/javascript/objects-and-arrays)（只讲到够用） | Data types |
| [Prototypes, inheritance](https://javascript.info/prototypes)：[inheritance](https://javascript.info/prototype-inheritance)、[native prototypes](https://javascript.info/native-prototypes) | 原型链、内置原型 | [第 5 章 原型链与 class](/javascript/prototypes-and-classes) | Advanced functions |
| [Classes](https://javascript.info/classes)：inheritance、[private fields](https://javascript.info/private-protected-properties-methods)、instanceof | class 语法、`#` 私有字段 | [第 5 章](/javascript/prototypes-and-classes) | Prototypes |
| [Error handling](https://javascript.info/error-handling)：[try...catch](https://javascript.info/try-catch) | 异常流、`finally`、自定义 Error | [第 10 章](/javascript/errors-and-debugging) | Advanced functions |
| [Promises, async/await](https://javascript.info/async)：chaining、promise API、[microtasks](https://javascript.info/microtask-queue)、[async/await](https://javascript.info/async-await) | 状态与链式、错误冒泡、微任务 | [第 6 章 事件循环与 async](/javascript/asynchronous) | **本路线最重要一组** |
| [Generators, advanced iteration](https://javascript.info/generators-iterators) | generator、异步迭代器 | 只需 [iterables](https://javascript.info/iterable) → [第 9 章](/javascript/modules-and-iterators) | Data types |
| [Modules](https://javascript.info/modules)：export/import、dynamic imports | 实时绑定、动态导入 | [第 9 章 ES 模块](/javascript/modules-and-iterators) | 工程化之前 |
| [Miscellaneous](https://javascript.info/js-misc)：[Proxy and Reflect](https://javascript.info/proxy)、BigInt、unicode、eval | Proxy 拦截、BigInt 不混算 | Proxy 是 [Vue 响应式](/vue/reactivity) 前置；BigInt → [第 2 章](/javascript/types-and-values) | Classes + Errors |

### 第二部分 Browser: Document, Events, Interfaces

| 章节 | 中文要点 | 本站补充 | 前置 |
| --- | --- | --- | --- |
| [Document](https://javascript.info/document)：DOM tree、searching、attributes 与 properties、size and scrolling | 节点类型、属性 vs 特性 | [第 7 章 DOM 与事件](/javascript/dom-and-events) | [HTML](/html/) 全部 |
| [Introduction to Events](https://javascript.info/events)：[bubbling](https://javascript.info/bubbling-and-capturing)、[delegation](https://javascript.info/event-delegation)、[default action](https://javascript.info/default-browser-action) | 冒泡捕获、委托、阻止默认 | [第 7 章](/javascript/dom-and-events) | Document |
| [UI Events](https://javascript.info/event-details)：mouse、pointer、keyboard | 事件对象与滚动 | 需要时回查 | Document + Events |
| [Forms, controls](https://javascript.info/forms-controls)：focus/blur、change 与 input、submit | 表单属性与校验时机 | — | [HTML 表单](/html/) |
| [Document and resource loading](https://javascript.info/loading)：[DOMContentLoaded](https://javascript.info/onload-ondomcontentloaded)、[async 与 defer](https://javascript.info/script-async-defer) | 脚本加载时机 | [Vite 开发侧](/frontend-engineering/vite-dev) | Document |
| [Miscellaneous（浏览器）](https://javascript.info/ui-misc)：Mutation observer、[event loop](https://javascript.info/event-loop) | 变化监听、任务与微任务 | [第 6 章](/javascript/asynchronous)、[第 11 章](/javascript/accessibility-and-performance) | Promises |

### 第三部分 Additional articles

| 章节 | 中文要点 | 本站补充 | 前置 |
| --- | --- | --- | --- |
| [Frames and windows](https://javascript.info/frames-and-windows) | iframe、跨窗口通信 | 可跳 | — |
| [Binary data, files](https://javascript.info/binary) | ArrayBuffer、Blob、File | [上传与作业](/backend/uploads-and-jobs) | 前两部分 |
| [Network requests](https://javascript.info/network)：[Fetch](https://javascript.info/fetch)、[跨域](https://javascript.info/fetch-crossorigin)、[WebSocket](https://javascript.info/websocket)、[SSE](https://javascript.info/server-sent-events) | 请求生命周期、预检、长连接 | [第 8 章 fetch 与同源](/javascript/network-and-storage)、[实时通信](/realtime/) | 第二部分，下[后端](/backend/) 之前 |
| [Storing data in the browser](https://javascript.info/data-storage)：[Cookie](https://javascript.info/cookie)、[localStorage](https://javascript.info/localstorage)、IndexedDB | 三种存储的容量与生命周期 | [第 8 章](/javascript/network-and-storage) | Network |
| [Animation](https://javascript.info/animation)：[CSS animations](https://javascript.info/css-animations)、JS animations | rAF 驱动动画 | [过渡与动画](/css/transitions-and-animations) | [CSS](/css/) |
| [Web components](https://javascript.info/web-components) | 自定义元素、Shadow DOM | 可跳，本站用 Vue SFC | — |
| [Regular expressions](https://javascript.info/regular-expressions) | 标志、捕获组、灾难性回溯 | 用到时回查 | Data types |

## 学习顺序建议：必须先读、可延后、可以跳

| 档位 | 内容 | 为什么 |
| --- | --- | --- |
| 必须先读且做练习 | Fundamentals → Objects → Data types（数组、JSON 优先）→ Advanced functions → Promises | 这五组决定你能不能读懂框架源码；闭包与微任务是硬门槛 |
| 必须先读单个小节 | Debugging in the browser | 排查效率影响后面所有领域 |
| 可延后 | Prototypes、Classes、Errors、Modules、Proxy | class 在 [TypeScript](/typescript/) 前、Modules 在 [前端工程化](/frontend-engineering/) 前、Proxy 在 [Vue 响应式](/vue/reactivity) 前补齐 |
| **延后到对应领域** | Network、Storage、event loop、Node 侧运行时话题 | fetch 与 Cookie 的真实痛点在服务端与部署时才出现，留到 [后端开发](/backend/)、[数据存储进阶](/data-storage/)；javascript.info 只讲浏览器环境，Node 的事件循环差异见 [Node.js 运行时](/backend/node-runtime) |
| 可以跳 | Frames、Web components、Binary、JS 动画、正则全文、generators、eval、WeakRef | 本路线（Vue 3 + Fastify + VPS）不需要 |

判断规则：读完一节能否用三句话说出「它解决什么故障」。说不出就是没读。

## 时间预算：按每小时 1 节估

节数按当日抓到的可见目录数（有折叠的只会更多）：

| 范围 | 可见节数 | 只读正文 | 正文 + Task | 本站建议 |
| --- | --- | --- | --- | --- |
| 第一部分 | 约 94 | 约 94 h | 约 190 h | 「必须」五组 + Debugging：45–55 h |
| 第二部分 | 约 32 | 约 32 h | 约 64 h | 与 HTML/CSS 并行：20 h |
| 第三部分 | 约 48 | 约 48 h | 约 96 h | 只读 Network + Storage：15 h |

全读并做完练习约 350 小时；**本站路线建议 80–90 小时**。这是量级估计不是承诺。排期用「每小时 1 节」换算，别用「每天 N 章」——做 Task 卡住时时间会翻倍，计划要能吸收浮动。

## javascript.info 课后题的正确做法

1. **先看题**，不重读正文；能直接做出来说明正文可跳。
2. **限时 20 分钟**。超时不是「忘了」而是模型没建立，回去只读对应小节。
3. **写完必须运行**：浏览器 `F12` Console（`Shift + Enter` 换行），或 `node -e "..."`、`node --input-type=module -e "..."`。只看代码不运行是这条路线上最贵的习惯。
4. 对完答案**合上页面重写一遍**；第二遍写不出来说明你读的是解法不是思路。
5. **自己加一个改动**：返回值从对象改成数组、`var` 换成 `let`，先预测再运行。这一步把「一道题」变成「一个机制」。

## 英文原版与中文译本怎么取舍

- 默认读 [zh.javascript.info](https://zh.javascript.info/)：与英文版同步，slug 一致，术语首现带英文原名。
- 这几处切英文版对照：strict mode、proxy、microtask、unicode——中文行文容易把「实参/形参」「可迭代/类数组」「绑定/引用」抹平。
- 译本偶尔滞后。与实现不一致时以 [ECMA-262](https://tc39.es/ecma262/) 和 [MDN](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript) 为准。
- 别因为英文好就跳过中文地图：读懂单节是语言问题，知道哪节能跳是取舍问题。

## 术语中英对照表

| 英文 | 中文 | 一句话解释 |
| --- | --- | --- |
| primitive | 原始类型 | 不可变、按值比较：undefined、boolean、number、bigint、string、symbol、null |
| reference type | 引用类型 | 变量持有对象地址而非对象本身，只按身份比较 |
| typeof | 类型运算符 | 返回字符串；`typeof null` 是 `"object"`，历史缺陷 |
| truthy / falsy | 真值 / 假值 | 转成布尔的结果；假值只有 `false 0 -0 0n "" null undefined NaN` |
| coercion | 类型转换 | 值被自动转成另一类型；显式与隐式要分开看 |
| ToPrimitive | 对象转原始值 | 依次尝试 `Symbol.toPrimitive`、`valueOf`、`toString` |
| TDZ | 暂时性死区 | `let`/`const` 声明前名字已存在，访问抛 ReferenceError |
| hoisting | 变量提升 | 声明提前可见；`var` 置 `undefined`，`let`/`const` 只绑定不初始化 |
| scope | 作用域 | 变量可见范围：全局、函数、块 |
| scope chain | 作用域链 | 内层向外层逐层查找的链，决定闭包能捕获什么 |
| closure | 闭包 | 函数连同创建时的词法环境保留，可持续访问外部变量 |
| higher-order function | 高阶函数 | 以函数为参数或返回函数；`map/filter/reduce` 是日常形态 |
| callback | 回调 | 交给他人在合适时机调用的函数 |
| IIFE | 立即调用函数表达式 | 历史上用来造块级作用域 |
| pure function | 纯函数 | 同输入同输出、无副作用；框架渲染函数要求它 |
| side effect | 副作用 | 修改外部状态：I/O、改对象、改 DOM |
| mutation | 就地修改 | 直接改原对象/数组；`sort/splice/reverse/push` 是典型 |
| immutability | 不可变性 | 用新值替换旧值而非就地改，React 状态更新依赖它 |
| shallow copy | 浅拷贝 | 只复制第一层，内层仍共享 |
| deep copy | 深拷贝 | 整棵结构被复制：`structuredClone` |
| garbage collection | 垃圾回收 | 按可达性判定，引用为 0 的对象被回收，时机不可预测 |
| prototype chain | 原型链 | 属性查找逐级向上直到 `null`；class、instanceof 建立在它之上 |
| delegation | 原型委托 | 通过原型链而非拷贝复用行为 |
| this | 接收者 | 由调用方式决定而非定义位置；箭头函数不绑定 `this` |
| binding | 绑定 | 用 `call/apply/bind` 手工指定 `this` |
| lexical environment | 词法环境 | 变量名到值的映射，加上对外层环境的引用 |
| event loop | 事件循环 | 依次处理任务与微任务检查点的调度机制 |
| microtask | 微任务 | Promise 回调、`queueMicrotask`；当前任务结束后立刻清空 |
| macrotask | 宏任务 | 定时器、I/O、DOM 事件；每轮取一个 |
| thenable | 类 Promise | 带 `then` 的对象，会被 `resolve` 吞掉 |
| iterable / iterator | 可迭代对象 / 迭代器 | 实现 `Symbol.iterator`；`next()` 返回 `{ value, done }` |
| array-like | 类数组 | 有 `length` 与索引但没数组方法，需 `Array.from` |
| destructuring | 解构 | 从对象/数组按形状取值 |
| rest / spread | 剩余 / 展开 | 同一语法的两种位置：收集 vs 展开 |
| ESM / CJS | ES 模块 / 公共模块 | `import/export` 与 `require/exports`，语义与加载时机都不同 |
| property descriptor | 属性描述符 | `value/writable/enumerable/configurable` 或 `get/set` |
| enumerable | 可枚举 | 是否出现在 `for...in` 与 `Object.keys` |
| nullish | 空值 | 仅指 `null` 与 `undefined`，`??` 只判它 |
| optional chaining | 可选链 | `?.` 遇到 nullish 短路整条链 |
| structural typing | 结构类型 | TypeScript 的比较方式：形状匹配即可赋值 |

## 本站 JS 领域 12 章地图

| # | 章节 | 承担什么 |
| --- | --- | --- |
| 1 | 本页 | 顺序、取舍、术语 |
| 2 | [类型、值与引用语义](/javascript/types-and-values) | `typeof` 表、相等性、转换、TDZ、`??` 与 `?.` |
| 3 | [对象、数组与常用方法](/javascript/objects-and-arrays) | `for...in`、Map/Set、JSON 边界、数组方法分组、排序、解构 |
| 4 | [函数、作用域、闭包与 this](/javascript/functions-and-scope) | 闭包、作用域链、`this` 决策表 |
| 5 | [原型链、class 与封装](/javascript/prototypes-and-classes) | 原型查找、class 边界、私有字段 |
| 6 | [事件循环、Promise 与 async/await](/javascript/asynchronous) | 任务与微任务顺序、错误冒泡、并发 API |
| 7 | [DOM 操作与事件系统](/javascript/dom-and-events) | 属性 vs 特性、委托、默认行为 |
| 8 | [fetch、同源策略与浏览器存储](/javascript/network-and-storage) | 请求生命周期、跨域、存储取舍 |
| 9 | [ES 模块、动态导入与迭代器](/javascript/modules-and-iterators) | 实时绑定、CJS 与 ESM、`Symbol.iterator` |
| 10 | [错误处理与 DevTools 调试](/javascript/errors-and-debugging) | `try...catch` 边界、断点方法论 |
| 11 | [JS 层面的无障碍与性能](/javascript/accessibility-and-performance) | 键盘可达、焦点管理、长任务 |
| 12 | [阶段项目：纯 JavaScript 待办清单](/javascript/project) | 进 TypeScript 前的验收关卡 |

## 常见错误与排查

这一节是**学法上的错误**；语言层面的坑在第 2、3 章各自的这一节。

1. **通读不写代码。** 现象：读完觉得会了，第一道题就卡住。原因：JS 的细节全在运行结果层面，读文本建立不了预期。怎么确认：合上教程在 Console 默写示例并运行。修法：把「读」换成「预测 → 运行 → 对答案」。
2. **跳过闭包。** 现象：读框架里的 `effect`、`watch`、composable 全靠猜。原因：生命周期与依赖收集都是闭包的应用。怎么确认：说出 `for (var)` 与 `for (let)` 里三个回调各打印什么（练习 1 就是这道题）。修法：回 [closure](https://javascript.info/closure) 做完 Task。
3. **把教程当唯一来源。** 现象：教程与 MDN 不一致，按教程写完线上出错。原因：教程是二手解释，兼容性口径会滞后。怎么确认：同一结论用 MDN 加一次实跑交叉验证。修法：版本相关结论都跑一行 `typeof` 探测。
4. **需求还没来就精读第三部分。** 现象：WebSocket、Binary 读了两个月，项目一行没写。原因：它们不属于第一、二期。怎么确认：问「这周写的代码会用到吗」。修法：按对照表标「可跳」，时间还给[阶段项目](/javascript/project)。
5. **只做题不总结。** 现象：拷贝污染、`==` 转换同一类坑反复出现。原因：题按节做，坑按机制出现。修法：每章写三句——讲什么、我原来哪里搞错、什么场景咬我。
6. **按目录顺序无差别精读，或一上来就搭构建工具。** 现象：两个月还没碰异步，或练习没写先折腾配置。原因：目录顺序不等于依赖顺序；前半程只需 Console 或 Node。修法：先读「必须」五组；一个 `index.html` 加 `<script type="module">` 就够，构建留到 [前端工程化](/frontend-engineering/)。

## 练习

<Exercise title="练习 1 · 预测这段真实代码的输出" difficulty="基础">

先预测四行输出，再运行验证。

```js
const a = [1, 2, 3];
const b = a;
b.push(4);
const c = [...a];
c[0] = 99;
console.log('A:', JSON.stringify(a), JSON.stringify(b), JSON.stringify(c));
console.log('B:', a == b, a === b, a.length === c.length);
const d = { list: a };
JSON.parse(JSON.stringify(d)).list.push(5);
console.log('C:', JSON.stringify(d.list), a.length);
const sum = a.reduce((t, n) => t + n, 0);
console.log('D:', sum, c.includes(undefined), c.at(-1));
```

<template #answer>

Node v25.4.0（Windows 10，2026-10-17）实跑的真实输出：

```text
A: [1,2,3,4] [1,2,3,4] [99,2,3,4]
B: true true true
C: [1,2,3,4] 4
D: 10 false 4
```

- **A**：`b = a` 复制的是引用，`b.push` 改的是同一个对象。`c = [...a]` 复制元素，元素是原始值时拷贝与原件互不影响，`c[0] = 99` 不回写 `a`。
- **B**：内容相同的两个独立数组，`==` 与 `===` 都返回 `false`；这里为 `true` 只因为 `a` 与 `b` 是同一个对象。数组没有值比较语义，只有身份比较。
- **C**：`stringify → parse` 造出全新的深拷贝，往它 push 不影响 `d.list`，`a.length` 仍是 `4`。代价是丢 `undefined`、函数、`Symbol`，`Date` 变字符串，见 [第 3 章](/javascript/objects-and-arrays)。
- **D**：`sum = 10`；`c.includes(undefined)` 为 `false`（`includes` 查值不查空洞）；`c.at(-1)` 为 `4`。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造两个报错并解释" difficulty="基础">

写一段**运行时**抛 `ReferenceError`、消息含 `before initialization` 的代码；再写一段**解析阶段**就失败、任何一行都不执行的代码。说出差别，并给出验证命令。

<template #answer>

```js
value;       // ReferenceError: Cannot access 'value' before initialization
let value = 1;

const c;     // SyntaxError: Missing initializer in const declaration
```

`ReferenceError` 是**运行时**错误：代码已开始执行，跑到那行才失败。`SyntaxError` 是**解析期**错误：整脚本无法编译，前面的语句也不会执行——本站观察它时用了 `new Function("const c;")`，直接写会让整段脚本一起挂掉。

验证命令与真实输出（Node v25.4.0）：

```bash
node --input-type=module -e "try{ typeof inTdz; let inTdz; }catch(e){ console.log(e.constructor.name + ': ' + e.message) }"
```

```text
typeof let-before-decl => ReferenceError: Cannot access 'inTdz' before initialization
bare read in TDZ       => ReferenceError: Cannot access 'inTdz2' before initialization
const no init          => SyntaxError: Missing initializer in const declaration
```

顺带一条常被误传的事实：`typeof` 对**未声明**标识符安全返回 `"undefined"`，对**已声明未初始化**的 `let` 会抛错。细节见 [第 2 章](/javascript/types-and-values)。

</template>

</Exercise>

<Exercise title="练习 3 · 排期并证明或推翻一个说法" difficulty="挑战">

两问。(1) 每天 1.5 小时，只读「必须先读且做练习」五组加 Debugging 一节并做完 Task，按 1 节/小时（做练习的节按 2 小时）估算需要多少天，你第几天开始进入 [TypeScript](/typescript/)？(2) 有人断言「`??` 和 `||` 行为一样，只是新写法」，用 `node -e` 构造至少三个推翻它的表达式，再构造一个混写导致失败的表达式并写出真实报错。

<template #answer>

**(1)** 按当日抓到的可见节数：Fundamentals 18（有编程经验的只需精读 `??`、类型转换、比较）、Code quality 6（只精读 Debugging）、Objects 8、Data types 12（Number/String 细节后置）、Advanced functions 11、Promises 8，合计约 63 节、**约 104 小时**：每天 1.5 小时约 **70 天**，每天 3 小时约 35 天；做了上述压缩后现实值约 45–55 小时。建议**第 20 天左右**（读完 Objects + Data types 的数组部分）就开始边写本站第 2、3 章边用 TS，异步那 8 节与[阶段项目](/javascript/project) 同时收尾。

**(2)** 实跑结果（Node v25.4.0）：

```text
0 || 'x'    => x            （0 被当成假值）
0 ?? 'x'    => 0            （0 不是空值）
'' || 'x'   => x
'' ?? 'x'   => （空字符串本身）
false ?? 5  => false
1 || 2 ?? 3 => SyntaxError: Unexpected token '??'
```

`||` 走 falsy 判定（假值七个：`false 0 -0 0n "" null undefined NaN`），`??` 只判 nullish（`null`、`undefined`）。分歧点全是「合法的 0 / 空字符串 / false」：表单里的 `age = 0`、开关里的 `enabled = false`。混写是语法禁止，写成 `(1 || 2) ?? 3` 才合法（本站跑出 `1`）。见 [第 2 章](/javascript/types-and-values)。

这条练习真正要练的是方法：**任何口头断言都能用一行命令变成事实**。这也是本站各章标 `verified` / `unverified` 的原因。

</template>

</Exercise>

## 官方文档与延伸阅读

- [javascript.info 首页目录](https://javascript.info/) —— **已核实**：对照表全部章节标题与 slug、三部分结构、节数统计口径。
- [zh.javascript.info](https://zh.javascript.info/) —— 核实你要读的那节有没有中文版。
- [MDN JavaScript 参考（中文）](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference) —— 核实术语表里每个 API 的签名与兼容性。
- [MDN 逻辑运算符](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators) —— 核实练习 3 的「`??` 不能与 `||`/`&&` 无括号混写」。
- [ECMA-262 当前草案](https://tc39.es/ecma262/) —— 教程与实现不一致时的最终裁决。
- [TC39 proposals](https://github.com/tc39/proposals) —— 核实某特性是否已进标准；本站只讲已发布特性。
- [Can I use](https://caniuse.com/) —— 涉及较新 API 时先来这里而不是教程。
- [Node.js 文档](https://nodejs.org/docs/latest/) —— 本机示例环境 Node v25.4.0。
- 前置：[HTML](/html/)、[CSS](/css/)；衔接：[TypeScript](/typescript/)、[Vue](/vue/)、[后端开发](/backend/)。

## 下一章

地图有了，接着清算第一个重灾区：类型与值。`typeof null === "object"`、`0 == ""` 为什么是 `true`、`{...obj}` 拷了多深、`let` 在声明前访问为什么抛错而不是 `undefined`——这些不是零散怪癖，而是同一套语义规则的不同出口。[类型、值与引用语义](/javascript/types-and-values) 把每条跑成真实输出再列表，并说明它们在 TypeScript 里如何表达（见 [基础类型与类型注解](/typescript/basic-types)）。随后读 [对象、数组与常用方法](/javascript/objects-and-arrays)，两章合起来覆盖 javascript.info 的 Fundamentals、Objects、Data types 三组里你会在项目里踩到的全部部分。
