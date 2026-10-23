# JavaScript · 领域首页

<StatusBadge state="ready" note="12 章中文补充正文全部完成（含阶段项目），与 javascript.info 主线配套使用" />

## 这个领域解决什么问题

**本站不重写 JavaScript 教程。** 这个领域的主体学习材料是 [javascript.info](https://javascript.info/)。本站这一领域的 12 章正文不重复它已经讲得很好的语法清单，而是解决它覆盖不到的三件事：按什么顺序读它（[学习地图](/javascript/learning-map)）、它一带而过但你一定会踩的语言层故障（引用语义、闭包、`this`、微任务顺序、原型链、模块互操作），以及读完之后怎么衔接 [TypeScript](/typescript/)、浏览器与 [Node.js](/backend/)。

不重写的原因很直接：

- JavaScript 的语言特性由 ECMA-262 标准驱动，每年都在变。javascript.info 持续跟随标准更新，本站单独维护一份教程只会很快过时，而且质量追不上。
- 它自带配套练习题和答案，这是「看完就忘」和「真的会写」之间的差别。重写一遍题库的成本远高于它带来的收益。
- 你已经要学的东西够多了：HTML、CSS、TypeScript、Vue、Fastify、SQL、Docker、Nginx。同一份知识不应该有两个来源。

但 javascript.info 的内容量远超本站路线所需。全读完需要几个月，其中相当一部分（Frames and windows、Web components、Binary data、动画的 JS 实现）对本路线的第一、二期没有直接价值。**这个领域真正的产出是取舍**：哪些必须做练习、哪些只需通读、哪些先跳过。

反过来，跳过它去直接学框架的代价非常具体：

- Vue 的 `watch` 回调不触发 —— 因为不知道传进去的是引用还是拷贝，也不知道「引用类型」在 JS 里到底意味着什么。
- `async` 函数拿不到返回值 —— 因为不理解 Promise 的解包规则和 `await` 的执行时机。
- `forEach` 里的 `async` 回调「不等待」，导致并发请求顺序全乱 —— 因为 `forEach` 不识别返回的 Promise，而 `for...of` 会逐个等待。
- 回调里的 `this` 变成 `undefined` —— 因为没搞清楚箭头函数与普通函数在 `this` 绑定上的区别。
- `??` 和 `||` 用反，`0`、`''`、`false` 被意外当成「空值」处理。
- 看到 Vue 3 响应式源码里的 `Proxy` 完全读不下去 —— 因为 `proxy` 那一章没读。
- `import` 和 `require` 混写，本地能跑、打包后报 `xxx is not a function`。

这些坑没有一个能靠「多看几个框架示例」解决，全都是语言层面的基础。

## 前置知识

**无。** 在 `.vitepress/domains.ts` 里本领域的 `prerequisites` 为空数组，这是准确的：JavaScript 不依赖 CSS，也不依赖任何框架，打开浏览器按 `F12` 就能开始练。

但按[学习路线](/guide/roadmap)的实际顺序，建议在学完 [HTML](/html/) 之后再开始。原因是 javascript.info 第二部分（Browser: Document, Events, Interfaces）几乎每一章都在操作 DOM，如果你连 `<form>`、`<label>`、`<button>` 的语义都没搞清楚，读「Forms, Controls」那一节会事倍功半。

CSS 可以和 JavaScript 并行推进，两者没有依赖关系。

## 本站的 12 章补充正文

这些章节是中文原创讲解，与 javascript.info 互补而不是替代：它负责系统教学与练习，本站负责知识地图、易错点的深挖、真实报错的读法，以及通往 TypeScript、浏览器 DOM、Node.js 后端的衔接。**顺序建议：先按下面的路线跟读 javascript.info，读到对应主题时来本站章节做「易错点 + 练习」的收口，不要反过来。**

| 章节 | 内容 | 什么时候读 |
| --- | --- | --- |
| [1. 学习地图与章节对照](/javascript/learning-map) | javascript.info 分部/章节的中文对照表、必读与可跳过的取舍、术语中英对照、时间预算 | 开始之前先读这一章 |
| [2. 类型、值与引用语义](/javascript/types-and-values) | 7 种原始类型与 `typeof` 的真实结果、引用与拷贝、浅拷贝与深拷贝的边界、`==` 与类型转换 | 读完 Fundamentals 与 Objects 之后 |
| [3. 对象、数组与常用方法](/javascript/objects-and-arrays) | 属性枚举与 `for...in` 的坑、`Map`/`Set`/`WeakMap` 的取舍、`JSON` 序列化边界、数组方法分组与 `sort` 的正确用法 | 读完 Data types 之后 |
| [4. 函数、作用域、闭包与 this](/javascript/functions-and-scope) | 三种函数写法的真实差异、作用域链与提升、闭包捕获的是变量、`this` 的四条绑定规则 | 读完 Advanced working with functions 之后 |
| [5. 原型链、class 与封装](/javascript/prototypes-and-classes) | 原型链查找过程、手写 `new`、`class` 与原型继承的真实差异、私有字段、方法丢失 `this` 的修法 | 学 Vue / Pinia 之前 |
| [6. 事件循环、Promise 与 async/await](/javascript/asynchronous) | 微任务与宏任务的真实顺序、Promise 链的错误传播、四种组合器、`for await`、超时与取消、竞态 | 本路线最重要的一章，读完 async 之后 |
| [7. DOM 操作与事件系统](/javascript/dom-and-events) | 查询与创建、事件流三阶段与事件委托、`passive` 监听器、三种 Observer、焦点与表单交互 | 读完 Document / Events 之后 |
| [8. fetch、同源策略与浏览器存储](/javascript/network-and-storage) | CORS 到底由谁决定、`fetch` 的错误分层与超时取消、三种请求编码、`localStorage`/`sessionStorage`/`cookie`/`IndexedDB` 的分工 | 学[后端开发](/backend/)之前 |
| [9. ES 模块、动态导入与迭代器](/javascript/modules-and-iterators) | ESM 与 CommonJS 的真实差异、循环依赖症状、`import()` 与代码分割、迭代协议与生成器 | 开始[前端工程化](/frontend-engineering/)之前 |
| [10. 错误处理与 DevTools 调试](/javascript/errors-and-debugging) | 错误类型与自定义错误类、未捕获错误的两条路、真实报错文案的读法、断点类型、强制同步布局的定位 | 读完 Code quality 之后，之后长期回查 |
| [11. JS 层面的无障碍与性能](/javascript/accessibility-and-performance) | 焦点管理与焦点陷阱、`aria-live` 的正确用法、长任务与分片、虚拟列表、监听器泄漏 | 做完阶段项目之后回读 |
| [12. 阶段项目：纯 JavaScript 待办清单](/javascript/project) | 不用框架与构建工具，把状态与视图分离做出一个可验收的待办应用 | 进入 [TypeScript](/typescript/) 之前必须完成 |

## javascript.info 章节与本站路线的对应关系

下面两张表是本领域的核心内容。「处理建议」只有三档：**全读全做**（正文和练习题都要完成）、**通读**（读正文，练习题挑着做）、**可跳**（本站路线不需要，遇到时回查即可）。

### 第一部分：The JavaScript language

| javascript.info 章节 | 处理建议 | 在本站的什么时机读 |
| --- | --- | --- |
| [An Introduction to JavaScript](https://javascript.info/intro) | 通读 | 开始之前，10 分钟 |
| [JavaScript Fundamentals](https://javascript.info/first-steps) | 全读全做 | 学完 HTML 第 1–2 章后立即开始 |
| [Code quality](https://javascript.info/code-quality) | 只读 [Debugging in the browser](https://javascript.info/debugging-chrome)，其余通读 | 同上，这一章决定你后面排查问题的效率 |
| [Objects: the basics](https://javascript.info/object) | 全读全做 | Fundamentals 之后，引用与拷贝是重灾区 |
| [Data types](https://javascript.info/data-types) | 全读全做；[Regular expressions](https://javascript.info/regular-expressions) 可后置 | 同上 |
| [Advanced working with functions](https://javascript.info/advanced-functions) | 全读全做 | 必须在开始 TypeScript 之前完成 |
| [Object properties configuration](https://javascript.info/property-descriptors) | 通读 | 只需知道 `writable` / `enumerable` / `configurable` 存在，用到时回查 |
| [Prototypes, inheritance](https://javascript.info/prototypes) | 通读；[原型继承](https://javascript.info/prototype-inheritance) 与 [原生原型](https://javascript.info/native-prototypes) 必读 | 学 Vue 之前 |
| [Classes](https://javascript.info/classes) | 全读全做 | 学 Vue / Pinia 之前。ES class 语法是理解 TS class 的前提 |
| [Error handling](https://javascript.info/error-handling) | 全读全做 | 学[后端开发](/backend/)之前 |
| [Promise, async/await](https://javascript.info/async) | 全读全做，本路线最重要的一章 | 必须在开始 TypeScript 之前完成 |
| [Generators, advanced iteration](https://javascript.info/generators-iterators) | 只读 [Iterables](https://javascript.info/iterable)，generators 可跳 | 需要时回查 |
| [Modules](https://javascript.info/modules) | 全读全做 | 开始[前端工程化](/frontend-engineering/)之前 |
| [Proxy and Reflect](https://javascript.info/proxy) | 通读，动手改几个例子 | 学 Vue 3 响应式之前，这一章是 Vue 3 的直接基础 |

### 第二部分：Browser: Document, Events, Interfaces

| javascript.info 章节 | 处理建议 | 在本站的什么时机读 |
| --- | --- | --- |
| [Document](https://javascript.info/document) | 全读全做 | 学完 [HTML](/html/) 全部章节之后 |
| [Introduction to Events](https://javascript.info/introduction-browser-events) | 全读全做；[事件委托](https://javascript.info/event-delegation) 与 [浏览器默认行为](https://javascript.info/default-browser-action) 是重点 | 同上 |
| [UI Events](https://javascript.info/ui) | 通读 | 学完 [CSS](/css/) 之后 |
| [Forms, Controls](https://javascript.info/forms-controls) | 全读全做 | 学完 HTML 第 6 章（表单）之后 |
| [Loading documents and additional resources](https://javascript.info/onload-ondomcontentloaded) | 通读 | 学 Vite 构建产物之前，理解 `defer` / `DOMContentLoaded` / `load` 的区别 |
| [Frames and windows](https://javascript.info/frames-and-windows) | 可跳 | 本路线不涉及 iframe 与跨窗口通信 |
| [Network requests](https://javascript.info/network) | 全读全做；[Fetch](https://javascript.info/fetch) 与 [Fetch API](https://javascript.info/fetch-api) 是重点 | 学[后端开发](/backend/)之前，前后端联调的基础 |
| Storing data in the browser（[localStorage](https://javascript.info/localstorage)、[Cookie](https://javascript.info/cookie)） | localStorage 必读，Cookie 通读 | 学 Vue Router 与登录态持久化之前 |
| [Animation](https://javascript.info/animation) | 只读 [CSS 动画](https://javascript.info/css-animations)，JS 动画可跳 | 配合 CSS 领域的过渡与动画章节 |
| [Web components](https://javascript.info/web-components) | 可跳 | 本路线使用 Vue 单文件组件，不涉及原生 Web Components |
| Binary data, files | 可跳 | 需要处理文件上传时再回查 |

## 学习顺序建议

推荐的完整节奏是：

1. **HTML 第 1–8 章** → 建立结构感。
2. **javascript.info 第一部分**：Fundamentals → Code quality → Objects → Data types → Advanced functions → Promise/async。这一段是连续的，中途不要插框架。Prototypes / Classes / Modules / Proxy 可以稍后补。
3. **HTML 第 9–10 章 + CSS 领域**，与 javascript.info 第二部分（Document → Events → Forms）并行。
4. **TypeScript 领域**。
5. 剩下的 Prototypes、Classes、Error handling、Network、Modules、Proxy 在进入 Vue 之前补齐。

**不能跳过的三章**：`closure`（闭包，在 Advanced working with functions 下）、`async`（整个 Promise 部分）、`proxy`。闭包不理解，你看不懂任何框架的生命周期与依赖收集；Promise 不理解，你写不出正确的接口调用代码；Proxy 不理解，Vue 3 的响应式对你就是黑魔法。

**可以放心跳过的**：Web components、Frames and windows、Binary data、JS 动画实现、正则表达式全文（先学会 `test` / `match` / `replace` 三个方法即可，正则细节用到时查）。

## JavaScript → TypeScript 衔接

开始本站 [TypeScript](/typescript/) 领域之前，你需要在 javascript.info 上完成这些内容，缺任何一项都会在 TS 里以「看不懂报错」的形式还回来：

| 必须已掌握 | 为什么 TypeScript 需要它 |
| --- | --- |
| 7 种原始类型与 `typeof` 的结果 | TS 的 `string` / `number` / `boolean` / `null` / `undefined` / `symbol` / `bigint` 直接对应它们，`typeof` 收窄是最常用的类型守卫 |
| 对象、引用与拷贝、浅拷贝的问题 | TS 的对象类型、`readonly`、结构类型（structural typing）都建立在「JS 对象是引用」这个事实上 |
| 数组方法与回调签名（`map` / `filter` / `reduce` / `forEach`） | TS 里这些方法的类型全是泛型，回调参数的类型推断就来自这里 |
| 解构赋值与剩余参数 | TS 的元组类型、函数重载、`...args` 的类型标注都以它为前提 |
| 闭包与作用域 | 理解 TS 的类型收窄为什么在回调里会「失效」 |
| `this` 与箭头函数 | TS 有专门的 `this` 参数类型，不懂 JS 的 `this` 就没法读 |
| class 语法、继承、私有字段 | TS 的 class 是 JS class 的超集，`private` / `protected` / `readonly` 直接叠加在上面 |
| Promise 与 `async` / `await` | TS 的 `Promise<T>`、`Awaited<T>`、异步函数的返回值类型都建立在此之上 |
| ES Modules 的 `import` / `export` | TS 的模块系统与声明文件（`.d.ts`）完全基于它 |
| `null` 与 `undefined` 的实际出现场景 | TS 的 `strictNullChecks` 就是为了强制处理它们，这是 TS 收益最大的一项 |

**判断标准**：给你一段 30 行左右、含 `async` 函数和数组 `map` 的 JS 代码，你能不看文档说出每个变量在运行时的类型，能说清函数返回的是值还是 Promise，能指出哪里可能因为 `undefined` 而抛错——达到这个程度就可以开始 TypeScript 了。

## 学习方法

- **优先读中文版** [zh.javascript.info](https://zh.javascript.info/)。章节 slug 与英文版一致，翻译质量可用。遇到术语翻译别扭的地方（尤其是 `strict mode`、`proxy`、`microtask` 附近）对照英文版。
- **练习题必须自己写，不要直接看答案。** 每章的 Task 都在页面底部，答案默认折叠。javascript.info 的练习题设计得比正文更值钱。
- **在浏览器控制台里跑，不要建项目。** 按 `F12` 打开 DevTools 的 Console 面板，`Shift + Enter` 换行，`Ctrl/Cmd + Enter` 执行。需要多文件时用一个 `index.html` + `<script type="module">` 就够了，不要过早引入构建工具。
- **善用断点而不是 `console.log`。** 读完 Debugging in the browser 那一节后，强制自己在 Scope 面板里看闭包捕获的变量，在 Call Stack 里看调用链。这是本站后面所有章节都会用到的技能。
- **每读完一章，用自己的话写下三句话**：这一章讲了什么、哪个点是我原来搞错的、它会在什么真实场景下咬我一口。写不出来就是没读懂。

## 阶段项目

**纯 JavaScript 待办清单**（不使用任何框架和构建工具）。这是进入 TypeScript 领域之前的验收关卡。

技术约束：

- 只用 `index.html` + 若干 `.js` 文件，通过 `<script type="module">` 引入，用任意静态服务器打开（不要用 `file://` 直接双击，ES Modules 会因跨域限制失败）。
- 数据用 `localStorage` 持久化，页面刷新后状态不丢。
- 至少用一次 `fetch` 从本地或任意返回 JSON 的接口拉取初始数据，并正确处理加载失败的情况。

功能要求：

- 新增、编辑、删除、标记完成、按状态筛选（全部 / 进行中 / 已完成）。
- 列表渲染用一个事件委托绑定，而不是给每一项单独 `addEventListener`。
- 有一个 `render()` 函数负责把状态重新画到 DOM 上，禁止在事件回调里零散地改 DOM。这一条是理解 Vue 响应式的关键铺垫——你会亲身感受到「手动同步状态与视图」有多痛苦。

验收标准：

- 代码在 DevTools 的严格模式下无报错，控制台无 warning。
- 删除最后一项后 UI 正确显示空状态，不是留下一个空白区域。
- `fetch` 失败时页面不白屏，能看到明确的错误提示。
- 你能指着代码说清楚：状态存在哪里、谁触发更新、DOM 是怎么被重建的。
- 全程没有使用 `var`，没有使用 `innerHTML` 拼接用户输入的字符串（后者会造成 XSS）。

## 官方文档与延伸阅读

- [javascript.info（英文原版）](https://javascript.info/) —— 本领域的主体学习材料。
- [zh.javascript.info（中文翻译版）](https://zh.javascript.info/) —— 内容与英文版同步，推荐首选。
- [MDN JavaScript 文档（中文）](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript) —— 查 API 的标准入口，每个方法都有示例和兼容性表。
- [MDN JavaScript 全局对象参考](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects) —— 忘了 `Array.prototype.reduce` 的参数顺序时来这里。
- [MDN Web API（中文）](https://developer.mozilla.org/zh-CN/docs/Web/API) —— javascript.info 第二部分涉及的 `document`、`fetch`、`localStorage` 等都属于 Web API，权威说明在这里。
- [ECMA-262 标准](https://tc39.es/ecma262/) —— 语言行为的最终裁决来源。日常开发不需要读，但当你和别人的说法冲突时，这里是唯一答案。
- [Can I use](https://caniuse.com/) —— 查某个特性在目标浏览器上的支持情况。

## 版本说明

本领域的路线建议基于 **javascript.info 当前线上版本**编写，核实时间为 2026 年 10 月。

需要注意的是：

- javascript.info 是持续更新的项目，章节结构和 slug 会调整。本页表格里的链接如果失效，直接从 [站点首页目录](https://javascript.info/) 进入对应章节即可，章节标题基本稳定。
- 表格里的「可跳 / 通读 / 全读全做」判断是针对本站这条路线（Vue 3 + Fastify + VPS 部署）给出的，换一条路线结论会不同。
- ECMAScript 每年发布一个新版本。本路线不追求覆盖最新特性——凡是 javascript.info 已经写进正文的，就是可以安全使用的；还停留在提案阶段的，本站不会涉及。
