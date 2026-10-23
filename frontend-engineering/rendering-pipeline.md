# 浏览器渲染机制与关键渲染路径：白屏那两秒里，浏览器严格按顺序做了五件事

首页白屏 1.8 秒，然后内容「啪」地一次性全出现。你猜是网络慢，Network 面板里所有资源却在 600 毫秒内下完了；你又猜是 JS 太大，把入口 chunk 从 900 KB 压到 300 KB，**白屏几乎没动**。两次失败有个共同原因：你不知道这段时间里浏览器按什么顺序做事，也就不知道该动哪一类资源。

往前，[Vite 开发侧](/frontend-engineering/vite-dev)和构建侧交出的是一个带哈希的 `index.html`，`head` 里躺着 `<link rel="stylesheet">` 和 `<script type="module" crossorigin>`。从这章开始是另一侧：**字节 → 像素**。五个阶段（解析、样式计算、布局、绘制、合成）有严格依赖顺序，其中两处能被外部资源卡住——这就是「渲染阻塞资源（render-blocking resource）」，也是第 7 章资源策略与第 8 章指标共同的因果底座。

一句能直接用的结论：**白屏时长几乎只由三件事决定——HTML 何时到达、首屏 CSS 何时可用、主线程被 JS 占了多久。** 图片、字体、异步 chunk 通常不制造白屏，它们影响的是「内容完整」和「可交互」。

<Callout type="unverified" title="本章核实方式：机制讲解，未做浏览器实测">

本章所有时间线数字都是**推演示例**，我没有在本机录制过任何页面（`node_modules` 里没有浏览器自动化依赖）。阶段模型、「CSS 阻塞渲染 / 同步脚本阻塞解析」、`defer` 与 `async` 的差异是长期稳定的浏览器行为，权威出处见文末 MDN；**具体阈值与新特性（`font-display` 各档时间线、`content-visibility`、`fetchpriority`）我不下结论**，以 MDN 与 caniuse 当前内容为准。

</Callout>

## 五个阶段：每一步的输入、输出与被卡住的方式

| 阶段 | 输入 | 输出 | 会被什么卡住 |
| --- | --- | --- | --- |
| 解析 HTML | 字节流 | DOM 树 + 资源请求队列 | 同步 `<script>`（解析暂停） |
| 解析 CSS | 字节流 | CSSOM | 网络本身；但**渲染**必须等它 |
| 构造渲染树 | DOM + CSSOM | 可见节点及其计算样式 | 任一未就绪的阻塞型样式表 |
| 布局（layout / reflow） | 渲染树 | 每个盒子的几何位置与尺寸 | 前面有未确定尺寸、字体替换 |
| 绘制（paint） | 布局结果 | 一层层绘制指令 | 复杂阴影、滤镜、超大面积重绘 |
| 合成（composite） | 分层后的绘制结果 | 屏幕上的像素 | 主线程被长任务占住，拿不到下一帧 |

两个容易被跳过的事实：**解析和下载是并行的**——浏览器一边解析 HTML 一边把发现的资源丢进请求队列，这个「预扫描（preload scanner）」就是 `<link rel="preload">` 存在的唯一理由，而**预扫描看不见 CSS 文件内部的 `url()`**，要等 CSS 下载完、CSSOM 建好才知道那张图要下（这就是第 7 章「首屏 LCP 图写在 CSS 里就要 `preload`」的直接后果）；**DOM 建好 ≠ 页面显示出来**——`DOMContentLoaded` 只代表解析走完、同步脚本跑完，不保证首屏已绘制，而 `display:none` 的节点不进渲染树、不做布局，`visibility:hidden` 的仍在树里算几何，异步模块里看不见的组件同理，见 [渲染性能](/vue/rendering-performance)。

## 关键渲染路径：两条阻塞，机制完全不同

「阻塞」在这条路径上有两种，混为一谈就会开错药。

**CSS 阻塞渲染（render-blocking）。** 浏览器不会「先画一版没样式的页面」——它必须等到**能影响首屏的样式全部就绪**才做首次绘制，否则你会看到内容闪一下再重排。所以 `head` 里三个样式表意味着三次下载 + 三次解析 + 一次样式计算，全都排在首次绘制之前。**但它不阻塞解析**：HTML 照样往下走，DOM 照样在长，只是不出画面。例外：`media` 明确不匹配当前设备的样式表（典型是打印样式）不进关键路径，仍会下载但不挡绘制——完整的「哪些算渲染阻塞」清单易变，动手前用文末 MDN 懒加载那一页核对。

**JavaScript 阻塞解析（parser-blocking）。** 裸 `<script src="...">`（没有 `defer`/`async`）会让解析器**停在原地**，等脚本下载完、执行完才继续解析后面的 HTML；历史原因是脚本被允许改写文档本身。表现就是你最熟悉的那种白屏：`head` 里一个同步脚本 + 慢 CDN = 下面的内容和样式全都得等它。

四种写法，这张表是本章最该记住的东西：

| 写法 | 下载 | 阻塞解析 | 执行时机 | 顺序保证 |
| --- | --- | --- | --- | --- |
| 裸 `<script src>` | 阻塞式：解析停下等它 | **是** | 下载完立刻执行 | 按文档顺序 |
| `<script async>` | 与解析并行 | 否 | 下载完**立刻**执行（可能早于 DOM 建完） | **无**，谁先下完谁先跑 |
| `<script defer>` | 与解析并行 | 否 | 解析完之后、`DOMContentLoaded` 之前 | 按文档顺序 |
| `<script type="module">` | 与解析并行 | 否 | 天生 defer 语义 | 按文档顺序，依赖图内部自洽 |

由此两条：**现代打包产物的入口几乎必然是 `type="module"`**（第 4 章实测输出就是这样），所以「把 script 挪到 body 末尾」「给产物入口补一个 `defer`」这类改动等于没改——它本来就不阻塞解析，真正能改变形状的是关键路径上的样式表数量和首屏执行的代码量。**`async` 只适合「什么时候执行都行、且不依赖别人」的脚本**（统计代码最常见）；用它加载要操作 DOM 的应用代码就会遇到 `Cannot read properties of null`，多个 SDK 互相依赖时更是随机坏，因为顺序不可控。

然后是那条最反直觉的依赖链：**外部 CSS 后面的内联脚本要等这张样式表下载完才执行**——脚本执行时需要能读到已计算的样式，于是样式表把排在它后面的脚本间接拖住，脚本又反过来拖住解析。**CSS 通过 JS 间接阻塞了 HTML**：你并没有给解析器加什么，只是加了一张样式表和一个排在它后面的脚本，白屏却长了三段——这正是「我只加了一个 CSS，怎么白屏更久了」的答案。

## 重排、重绘、合成：交互期比加载期更常出问题

加载期不是终点。流水线后半段每次改动都要重跑，代价差别极大：

| 你改了什么 | 走哪些阶段 | 代价 |
| --- | --- | --- |
| `width` / `top` / `font-size` / 增删节点 / 读 `offsetHeight` | 布局 → 绘制 → 合成 | **最贵**：可能波及整棵树的几何 |
| `color` / `background` / `box-shadow`（几何不变） | 绘制 → 合成 | 中：不重算几何 |
| `transform` / `opacity` | 只有合成 | **最便宜**：几何与绘制都能复用，常能在合成器线程跑 |

这就是「把 300 毫秒的 `width` 过渡换成 `transform: scale()` 就顺了」的机制解释，不是玄学，是躲开了布局；CSS 侧那条动画与合成层的结论见 [过渡与动画](/css/transitions-and-animations)。但合成层不免费，每层都要独立纹理，所以别给一堆元素刷 `will-change` 或 `translateZ(0)`「提层」——只在真正会动的少数元素上声明，动画结束后让它失效。

另一条更容易踩的是**强制同步布局（forced synchronous layout）**：在 JS 里读几何量（`offsetHeight`、`getBoundingClientRect()`、`scrollTop`）会要求浏览器**立刻**把待处理的布局算完，否则给不出正确的数。

```js
// 反例：读—写交替，每一行都强制一次布局
for (const el of list) {
  const h = el.offsetHeight        // 读 → 强制布局（阻塞在这里）
  el.style.height = h * 2 + 'px'   // 写 → 让下一次读又要重算
}
```

预期现象：这段放进滚动或 resize 回调，帧率立刻塌掉，Performance 里能看到一根根紫色 Layout 条挤在 JS 执行之间。修法固定三步：**先批量读、再批量写**（拆成「一遍收集、二遍赋值」，N 次布局压成 1 次）；或缓存几何量；或改用不触发布局的属性。

帧预算：60 Hz 屏幕每帧约 **16.7 毫秒**，主线程上超过 50 毫秒的任务就是「长任务（long task）」，期间画面不动、输入不被响应。这条因果在第 8 章变成 TBT 与 INP——那里写了 INP 由「输入延迟 + 处理时长 + 展示延迟」三段构成，分别对应**主线程被长任务占着（流水线没法开始）→ 回调本身跑太久 → 回调触发的大范围布局与绘制太重**。

## 把这些阶段读出来：Performance 面板看什么（未在本机跑过）

时间轴最前面那段空白的**右端就是首次绘制**，左右端之间出现的所有条就是你的关键路径；`DOMContentLoaded` 早于首次绘制完全正常，别拿它当「可交互」。主线程轨道上：**紫色 Layout 段**反复出现且越来越宽 = 强制同步布局或大范围重排（对照上一节那个读—写循环）；**又长又宽的 JS 条**是首屏执行成本，它期间没有渲染 = 白屏，压入口体积真正会体现在图上的就是这里。网络轨道上某个资源**开始得很晚**，要么它靠 CSS 才发现（背景图、字体），要么靠 JS 插入——这一条直接决定 `preload` 该不该加。丢弃帧与长任务在帧轨道上标红，第 8 章把它们量化成 TBT/INP。

## 产物侧的接口：第 4 章那两个标签决定了关键路径

接点非常具体，就是构建输出 `head` 里那两行。`<link rel="stylesheet" crossorigin href="/assets/index-xxxx.css">` 是**渲染阻塞的**：入口 CSS 只有一个文件、排在首次绘制之前，这是第 4 章说「CSS 体积也压白屏」的原因（异步 chunk 的样式被折进 JS、加载时才插 `style` 标签，不阻塞首屏，代价是那块内容晚一点才有样式）。`<script type="module" crossorigin src="/assets/index-xxxx.js">` **不阻塞解析**，但要等前面所有同步样式表就绪才执行，执行耗时全落在白屏或不可交互窗口里；`crossorigin` 把这条请求变成 CORS 请求，和 `preload` 漏写 `crossorigin` 导致「下载两次」是同一件事的两面（第 7 章）。动态 `import()` 的 chunk 由 Vite 的 preload helper 补 `link rel="modulepreload"`，那是**提前下载与编译**，不是渲染阻塞项——反过来给所有 chunk 手写 `preload`，就是把带宽分给当前用不到的代码。

**加载期你能控制的关键路径变量只有四个：HTML 何时到达、哪些样式表排在首次绘制前、脚本用什么属性加载、主线程在首屏执行多少代码。** 其余（图片、字体、异步 chunk、埋点）影响「内容完整」与「可交互」，用错工具去优化就是白忙。

## 常见错误与排查

1. **所有资源 600 ms 下完却白屏 2 秒 / 入口 JS 体积减半白屏几乎没变** —— 同一个根因：瓶颈在**阻塞结构**不在体积，你优化的东西不在这条链上。确认：Performance 里首次绘制之前主线程是否有一条 JS 执行横跨大半；Network 里 CSS 是否排在 JS 之后才开始。修：**先拆阻塞、再减体积**——先只把脚本改 `defer` 或 module（不改体积）测一次，两次数字一比就知道该动哪一类资源。
2. **`Cannot read properties of null`，且只在硬刷新时出现** —— 脚本执行比它要操作的元素更早：用了 `async`，或依赖关系写在乱序加载里。确认：标签上有没有 `async`；Network 里两个脚本的完成时间对一下。修：改 `defer`（保序）或 module，或把逻辑挂到 `DOMContentLoaded` 之后（[DOM 操作与事件系统](/javascript/dom-and-events)）。
3. **滚动/拖拽掉帧，Performance 里一片紫色 Layout 条** —— 滚动回调里读几何量触发强制同步布局，或动画用了会改几何的属性。确认：找出读—写交替那段代码；把动画属性临时换成 `transform` 看掉帧是否消失。修：批量读再批量写；用 `transform`/`opacity`；把重活挪出滚动回调。
4. **文字先空一下再出现、或先出现一版再「抖」成最终样子；图片加载完成时下方内容整体往下跳** —— 同一个因果的两种表现：几何在内容到达后被重算。字体是未就绪时的绘制策略由 `font-display` 决定、替换那一刻整段重排（**各档精确时间行为以 MDN `font-display` 当前内容为准**）；图片是没写固有尺寸，先按占位布局、图到达后推开后面的内容。确认：Network 里字体/图片的时刻，布局位移（CLS）轨道上是否有对应跳变（第 8 章「最隐蔽的 CLS 来源」）。修：图片写 `width`/`height` 或 `aspect-ratio`（[图片与媒体](/html/images-media)）；字体选档 + 度量覆盖，中文务必子集化。
5. **`loading="lazy"` 加在首屏大图上，白屏更久** —— 懒加载要先有布局才能判断该图是否进视口，请求被推迟到布局之后，而这张图正是首屏内容。确认：Network 里这张图的开始时间是否明显晚于首次布局。修：首屏图永不 lazy，只给折叠以下的图加；首屏大图要反过来提前（第 7 章）。

## 练习

<Exercise title="练习 1 · 预测三种写法的白屏时长" difficulty="基础">

HTML 100 ms 到齐，外链 CSS 与外链 JS 各 300 ms 下载、200 ms 执行。三种写法：A `head` 里裸 `<script>` + `<link rel=stylesheet>`；B 脚本加 `defer`；C 脚本加 `async`。① 各场景首次绘制大概何时？② `async` 场景可能出什么新问题？③ 说出判断依据（不许猜，要按「什么阻塞什么」推）。

<template #answer>

A：解析在脚本处停住，等 JS 下载(300) + 执行(200)，CSS 在这期间就绪，首次绘制约 500 ms 之后，且 DOM 被截断。B：解析一路到底，CSS 与 JS 并行，脚本执行推到解析后 → 首次绘制主要由 CSS 决定，约 400 ms 内；比 A 少的正是「脚本阻塞解析」那 200 ms 串行段。C：绘制时刻与 B 接近（`async` 既不阻塞解析也不阻塞绘制），**但脚本可能在 DOM 建到一半就执行**，于是出现 `Cannot read properties of null`——要操作的节点还不存在。依据只有两条阻塞：CSS 挡绘制、裸脚本挡解析；`async`/`defer` 都不挡解析，区别只在执行时机与顺序保证。

</template>

</Exercise>

<Exercise title="练习 2 · 读一段真实瀑布流" difficulty="进阶">

Network 面板（禁缓存、首次访问）：`index.html` 120 ms 完成；`index-a1b2c3.css` 130 ms 开始、420 ms 完成；`hero.jpg` 从 **700 ms** 才开始；`Detail-9f8e.js` 从 640 ms 开始。① `hero.jpg` 为什么这么晚？给两种可能并说明怎么区分。② `Detail-9f8e.js` 是谁发起的？③ 要让 `hero.jpg` 提前，正确的两个手段是什么？什么情况下其中一个是错的？

<template #answer>

① 可能一：它是 **CSS 里的 `background-image`**——预扫描看不见，要等 CSS 下载完、CSSOM 建好才知道要下它，所以时间点紧跟 CSS 完成之后（420 → 700 之间是样式计算与布局），这是「资源发现时机」的标准形状。可能二：它由 JS 插入（首屏渲染后才有那个节点），或被 `loading="lazy"` 推迟到布局判断完视口才开始。区分：在 Elements 面板搜那个节点是不是静态写在 HTML 里；把 CSS 里那条 `background` 临时注释掉再录一次，请求消失就是可能一。② Vite 的 preload helper 补的 `modulepreload` 加运行时 `import()`：异步 chunk，由路由切换或首屏后的懒加载边界发起。③ 手段一：把首屏图从 CSS 背景改成真正的 `img` 写进 HTML，让预扫描能发现它（**首选**，顺带修掉「LCP 元素是 `div`」）。手段二：`<link rel="preload" as="image" ...>`。后者在这些情况下是错的：`as`/`crossorigin` 写错会**下载两次**、首屏带宽更差（第 7 章）；若那张图本来就是被 lazy 拖住的 `img`，`preload` 只是掩盖问题，正确做法是去掉 lazy。

</template>

</Exercise>

<Exercise title="练习 3 · 把一次掉帧定位到具体阶段" difficulty="挑战">

用户反馈点开抽屉动画时明显卡一下。Performance 录到：一次 80 ms 的 JS 任务、随后 40 ms 的 Layout、再 20 ms 的 Paint；抽屉的 CSS 是 `width: 0 → 480px` 的过渡。① 三段各属于流水线哪一步？② 为什么 80 ms 的 JS 会让动画「掉一帧以上」？③ 给两条修法并按收益排序。

<template #answer>

① JS = 主线程执行（可能含读几何量触发的同步布局）；Layout = 布局（几何重算）；Paint = 绘制。② 帧预算 16.7 ms：主线程被占住超过一帧，这次更新就来不及提交，画面重复上一帧；80 ms 大约掉 4–5 帧，而超过 50 ms 本身就是长任务，期间输入也不被响应（第 8 章量化成 TBT/INP）。③ 收益第一：**把 `width` 过渡换成 `transform: translateX()`**——几何不变，Layout 那 40 ms 整段消失，剩下绘制与合成甚至能推到合成器线程；它也不再推开兄弟内容，顺带消掉一次布局位移。第二：**拆开那 80 ms 的 JS**——看它是同步渲染/过滤列表还是读写交替；后者改成「先批量读再批量写」，前者分批或推到交互之后再算。**注意顺序**：先换属性再动 JS，两条同时做你就无法判断哪条起了作用。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN · 浏览器如何工作](https://developer.mozilla.org/zh-CN/docs/Web/Performance/How_browsers_work) 与 [MDN · 关键渲染路径](https://developer.mozilla.org/zh-CN/docs/Web/Performance/Critical_rendering_path) —— 核实第一节那张表（解析 → 样式 → 布局 → 绘制 → 合成的顺序与各步输入输出），以及「CSS 阻塞渲染、JS 阻塞解析」的区别和「字节 → DOM/CSSOM → 渲染树 → 布局 → 绘制」这条链。
- [MDN · script 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Element/script) —— 那张四行属性表的权威来源：`defer`、`async`、`type="module"` 的执行时机与顺序保证。
- [MDN · 懒加载](https://developer.mozilla.org/zh-CN/docs/Web/Performance/Lazy_loading) 与 [MDN · `rel="preload"`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Attributes/rel/preload) —— 核实「哪些资源算渲染阻塞、`media` 不匹配时不阻塞」、`loading="lazy"` 需要布局才能判断可见性（常见错误 5），以及「只有晚于预扫描发现的资源才值得预加载」（练习 2 第③问）。标为「未核实」的细节以 [MDN Web 性能](https://developer.mozilla.org/zh-CN/docs/Web/Performance) 当前描述为准，支持度回 [caniuse](https://caniuse.com/) 确认。
- 站内衔接：[Vite 构建侧](/frontend-engineering/vite-build)（`head` 里那两个标签怎么生成）、[HTTP 缓存与资源加载策略](/frontend-engineering/http-caching)（同一条关键路径上的资源从哪来、缓存成什么样）、[性能指标与 Core Web Vitals](/frontend-engineering/performance)（每个阶段怎么变成 LCP/INP/CLS 的数字）、[过渡与动画](/css/transitions-and-animations)、[调试布局](/css/debugging-layout)、[DOM 操作与事件系统](/javascript/dom-and-events)。

## 下一章

第 4 章交出产物，本章解释产物被浏览器加载时发生了什么。两者之间还差一层——**同一份产物第二次访问时不再从网络走**。下一章 [HTTP 缓存与资源加载策略](/frontend-engineering/http-caching) 处理这件事：强缓存与协商缓存、带哈希的文件名为什么是长缓存的前提、以及为什么 HTML 绝对不能被长缓存住。
