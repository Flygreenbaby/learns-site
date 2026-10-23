# JS 层面的无障碍与性能：能用鼠标点不等于能用

一个只有鼠标能用的页面，在键盘用户那里是**打不开的抽屉**：Tab 走不进弹层、Enter 点不动 div、焦点掉到看不见的位置、关掉弹窗后光标不知去哪了。同一份代码在性能侧还有另一副样子：列表一长就卡顿、点击后 200 毫秒没反应、页面开着十分钟内存一路抬升。

这两类问题都属于「代码没报错，但功能不成立」。HTML 与 CSS 领域讲了结构与表现层的无障碍（[HTML 第 9 章 无障碍](/html/accessibility)、[表单](/html/forms)），但**动态部分只能由 JS 负责**：焦点的移动、状态的播报、DOM 增删后语义的同步。性能同理：布局与资源是 [浏览器渲染机制](/frontend-engineering/rendering-pipeline) 那一章，本章只管 JS 这一侧——主线程占用、监听器数量、内存留存。

<Callout type="info" title="本章的验证边界">

本章的代码是**浏览器侧**实现，本站环境没有可用的浏览器渲染环境，**未在本机浏览器中运行验证**（`prefers-reduced-motion` 的 CSS 部分除外）。但 `tabindex` 三种取值的语义、`aria-live` 三种取值与「`assertive` 不要用除非真的紧急」这两条结论，已核对 MDN（核实时间 2026-10-17），文中逐处标注。所有支持度类结论（长任务观察器、`scheduler.yield`）标为以官方文档为准。

</Callout>

## 无障碍：JS 只负责三件事

**可到达**（键盘能不能走到）、**可感知**（状态变化能不能被读到）、**可预期**（焦点会不会莫名其妙跑掉）。绝大多数「这个页面不无障碍」的投诉都落在这三条之一，而只有这三条是 JS 的活。

### 「能用鼠标点」为什么不够

| 用户与场景 | 他们怎么操作 | 你的代码必须提供什么 |
| --- | --- | --- |
| 只用键盘（运动障碍、熟练用户） | Tab / Shift+Tab / Enter / Space / 方向键 | 所有可操作元素可聚焦、顺序合理、焦点可见 |
| 屏幕阅读器用户（失明） | 听可访问树，Tab 或快捷键跳转 | 控件有名称、状态变化能播报、动态内容语义同步 |
| 放大与缩放（低视力） | 200% 缩放、横向滚动 | 焦点不能被裁掉；出现横向滚动后 Tab 到屏幕外的元素要能自动滚进视口 |
| 动效敏感（前庭功能敏感） | 系统设置「减弱动态效果」 | JS 驱动的动画也要尊重 `prefers-reduced-motion` |

一条判断标准：**把鼠标放到一边，只用键盘把整个功能做一遍**。做不完就是缺陷，不用等到读屏测试。

### 键盘可达三原则，与 tabindex 的三种取值

1. **可聚焦**：原生可交互元素（`button`、`a[href]`、`input`、`select`、`textarea`）天生可聚焦，不需要 `tabindex`。给非原生元素加 `tabindex="0"` 是最后手段。
2. **顺序正确**：Tab 顺序 = **DOM 源码顺序**。所以视觉顺序靠 CSS 排（`order`、`flex-direction: row-reverse`、grid 区域）时，源码顺序必须仍然等于阅读顺序；做不到就要手工接管方向键。
3. **焦点可见**：`:focus-visible` 必须有可见样式。`outline: none` 而不补替代样式，是把键盘用户直接锁在门外（选择器细节见 [选择器](/css/selectors)）。

`tabindex` 取值（MDN 核实 2026-10-17）：

| 取值 | 行为 | 正确用法 | 错误用法 |
| --- | --- | --- | --- |
| `0` | 进入 Tab 顺序，排在所有正值之后，彼此按源码顺序 | 让自制的复合控件（如自定义下拉的触发按钮，若你坚持不用 `button`）可聚焦；让 `tabindex="-1"` 容器变成可 Tab 的目标 | 给每个 `div` 都加 `tabindex="0"`，Tab 十次才走到提交按钮 |
| `-1` | **不**在 Tab 顺序里，但**可以**用 JS `focus()` 聚焦，也能被点击聚焦 | **程序化聚焦的主力**：弹层容器、跳过导航的目标（`main`）、表单第一个错误字段、toast 容器 | 用它去「隐藏」一个可交互元素（它仍在可访问树里） |
| 正数（`1`、`2`…） | 排在 `0` 之前，按数字大小排序，上限 32767 | **没有正确用法** | 想「让导航先 Tab 到」而写 `tabindex="1"`——它会插到全页所有元素前面，包括页头 logo，且以后每加一个控件都要重排全部数字 |

MDN 的原话是「建议只使用 `0` 与 `-1`，避免大于 `0` 的值」，理由是这让依赖键盘与辅助技术的人更难导航。**正数 `tabindex` 是本站明确禁止的写法**：你要控制顺序，就改 DOM 结构顺序。

`focus()` 的两个配套细节：`el.focus({ preventScroll: true })` 阻止页面跳动；`preventScroll` 之后自己决定要不要 `scrollIntoView({ block: "nearest" })`。另一条更常见的翻车：**给一个 `display: none` 的元素调 `focus()` 静默无效**（元素不可聚焦，但不报错），所以「点了没反应」常常是聚焦早了——要等元素真正显示出来再聚焦（或在 `transitionend`/下一帧）。

### 动态内容的焦点管理：弹层的三步

规则只有一条：**视图结构变了，焦点必须有个交代**。打开时移进去、待在里面出不去（焦点陷阱）、关闭时回到打开它的那个元素。少了第三步的后果很具体：键盘用户关掉弹层后，Tab 从页面顶部重来。

### ARIA 状态的 JS 侧维护

ARIA 属性不是装饰，是**读屏唯一能看到的真相**。视觉变了而属性没变，读屏就活在一个旧世界里：

| 属性 | 谁维护 | JS 侧义务 |
| --- | --- | --- |
| `aria-expanded` | 触发它的按钮 | 展开/收起每次都要写，且值是字符串 `"true"`/`"false"`；配合 `aria-controls="面板id"` |
| `aria-hidden` | 被隐藏的那棵子树 | 用 `aria-hidden="true"` 隐藏一个**含可聚焦元素**的容器是错的——鼠标看不见了，键盘还能 Tab 进去。要么同时 `display: none`，要么给里面每个可交互元素设 `tabindex="-1"` |
| `aria-live` | 播报容器 | 容器**必须先在 DOM 里**，之后再改它的内容。动态插入一个带 `aria-live` 的元素，然后立刻填字，多数读屏不会播报 |
| `role` | 语义补丁 | 只在「CSS 抹掉了原生语义」时补：`list-style: none` 之后给 `ul` 补 `role="list"`（详见 [HTML 第 8 章](/html/layout-semantics)）。除此之外别乱加 role——ARIA 第一规则是能用原生元素就别用 role |

「DOM 结构不变、只有视觉变化」的同步场景最容易被漏：一个可折叠面板，箭头旋转了、内容展开了，但 `aria-expanded` 还是 `false`；一个列表加了筛选，条数变了，但没有任何播报；一个按钮从「保存」变成「保存中」，可访问名称仍是旧的。这类改动全部要落到属性上：`setAttribute("aria-expanded", String(open))`，而不是靠 `classList` 让 CSS 换图标。

### aria-live 三种取值与滥用后果

MDN 核实的取值与代价（2026-10-17）：

| 取值 | 含义 | 用在 | 滥用后果 |
| --- | --- | --- | --- |
| `off` | 不主动播报，除非焦点正在这块区域 | 高频变化且不是主功能的内容（比分、行情、新闻滚动条） | 该报的不报，用户以为页面没反应 |
| `polite` | 等当前朗读告一段落再报 | **默认选它**：结果数量变化、保存成功、筛选生效 | 延迟几百毫秒，用户以为没生效，会连点两次 |
| `assertive` | 最高优先级，立即打断当前朗读，可能清空队列 | 真正紧急且有时间窗口（会话将过期、验证码已失效） | 打断本身会让人迷失——MDN 明确写「除非打断是必需的，否则不要用」 |

三条实务结论：

- **播报文案要短、要含结论**：`已删除 1 项，剩余 6 项` 比 `操作成功` 有用。
- **一个页面只放 1–2 个 live region**，别给每个组件各配一个；多个 region 同时更新会互相打断，用户听到的是碎片。
- **别给逐字符追加的内容加 `aria-live`**（打字机效果、进度百分比每秒变化）：读屏会逐字追读，等于噪音。这类要做成节流后的摘要（每 N 秒一次），或只在结束时播报。

### 别用 div 做按钮

`<div class="btn" @click>` 缺的不是样式，是一整套行为：不可聚焦（要 `tabindex="0"`）、Enter/Space 不触发（要手写 `keydown`，且 Space 是 `keyup` 才触发、Enter 是 `keydown`，两者规则不同）、没有 `button` role、没有 `type` 所以在表单里默认当提交按钮、`disabled` 属性对它无效（要自己判）。**一个 `<button>` 全都免费给你**。语义与样式的分工见 [HTML 第 6 章 表单](/html/forms) 与 [无障碍](/html/accessibility)。

如果已经在 `div` 上写了点击逻辑，最小修复不是补 keydown，而是换元素。真要在 `div` 里放两个可点击区域（比如卡片整体可点、里面又有收藏按钮），正确做法是**内部放 `button`、整卡用一个覆盖的 `a` 或 `button`**，而不是给外层加 keydown。

### 动效与 prefers-reduced-motion

`prefers-reduced-motion` 是媒体查询，CSS 侧写法见 [过渡与动画](/css/transitions-and-animations)。JS 侧要读它，否则你的脚本动画绕过了用户设置：

```js
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
function animate(open) {
  if (reduce.matches) { panel.hidden = !open; return; }   // 直接切状态，不动画
  panel.classList.toggle("is-open", open);
}
reduce.addEventListener("change", () => {/* 用户在系统设置里改了，立刻重新应用 */});
```

注意是「减弱」不是「关闭」：位移类（视差、弹跳、翻页滑动）该去掉，颜色/透明度渐隐一般保留。用 `matchMedia` 而不是 `navigator.mediaDevices` 之类的判断，也不要读 UA。

### 表单校验的可访问反馈

校验逻辑写对了，反馈方式错了照样不合格。四条一起做：

```js
function markFieldInvalid(input, message) {
  const msg = document.getElementById(input.getAttribute("aria-describedby"));
  msg.textContent = message;                       // 改文本，别整段重建节点
  input.setAttribute("aria-invalid", "true");      // 状态给读屏
  input.classList.add("is-invalid");               // 视觉：颜色 + 图标 + 文字，不只靠红框
}
function handleInvalidSubmit(errors) {
  const first = document.getElementById(errors[0].fieldId);
  first.focus();                                   // 提交后把焦点送到第一个错误字段
  first.scrollIntoView({ block: "center" });
}
```

关键点：错误消息元素要在 HTML 里**预先存在**并用 `aria-describedby` 关联到输入框（这样聚焦输入框时读屏会念出提示），你只改它的 `textContent`；`aria-invalid` 是状态，不要每次提交都设 `false` 再设 `true`（会造成重复播报）；**焦点要移到第一个错误字段**，否则视障用户不知道自己为什么「点了没反应」。原生校验 UI 与自定义气泡的取舍见 [HTML 第 6 章](/html/forms)。

### 跳过导航与区域跳转

页面第一段可 Tab 内容应该是「跳到主要内容」的链接，`href="#main"`，默认视觉隐藏、`:focus` 时出现（移出视口而不是 `display: none`，否则不可聚焦），目标 `<main id="main" tabindex="-1">` 加 `tabindex="-1"` 保证点完焦点真的过去。结构和 landmark 命名见 [HTML 第 8 章](/html/layout-semantics)；JS 在这里的唯一义务是**不要在跳转后把焦点抢回导航**。

### 屏幕阅读器测试的最小方法

不需要成为专家，也不需要装付费软件。系统自带的就够：

| 系统 | 打开方式 | 说明 |
| --- | --- | --- |
| Windows | `Ctrl + Win + Enter` 打开 Narrator | 自带；功能比 NVDA 少但足以发现「没有名称」「状态没变」这两类问题 |
| macOS / iOS | `Cmd + F5` 或「三指轻点」开启 VoiceOver | 自带；Safari 下组合最完整 |

三个动作，十分钟能做完：

1. **只看声音不用眼睛**：打开弹层、切一次筛选、删一项，听它有没有交代结果。
2. **听可访问树**：读屏朗读的是**可访问树（accessibility tree）**，不是 DOM。所以 `aria-hidden` 的子树它当不存在、`display: none` 的也不读、`list-style: none` 可能让它不再把 `ul` 当列表、`div` 里的文字读得出但不是控件。
3. **在 DevTools 里核对**：Elements 面板右侧 **Accessibility** 标签页显示某个节点的 role、名称、状态。名称是空的（计算出的 accessible name 为 `""`）——读屏就只会念「按钮」，这是最常见的缺陷。这一面板的位置以 [Chrome DevTools 文档](https://developer.chrome.com/docs/devtools/) 为准，本站未在浏览器中验证其当前入口名称。

## 性能：先测量，再动手

### 长任务与主线程：为什么点了没反应

浏览器的主线程同时负责解析 HTML、跑 JS、算样式、布局、绘制、派发事件。**这些活排队做**。一个跑 300 毫秒的同步循环，会让这 300 毫秒内的点击、输入、滚动全部排队——用户感受是「卡」，而 CPU 可能根本没满载。

**长任务（long task）** 的量级概念：MDN 把占用主 UI 线程 **50 毫秒以上**的任务称为长任务（核实 2026-10-17）。这个数字是**经验阈值不是硬边界**：它是指标统计口径（也是 INP 类指标关注的原因），不是「49ms 就免费」——真正影响手感的是**输入到下一次呈现的延迟**。所以把它当作「超过这个量级就该拆开」的信号，而不是目标本身。

### 测量优先：三档工具

```js
const t0 = performance.now();
renderHugeList(items);
console.log("[list:render]", (performance.now() - t0).toFixed(1), "ms");  // 手动计时，看相对变化
console.time("render"); renderHugeList(items); console.timeEnd("render"); // 同一功能的简写
```

`performance.now()` 比 `Date.now()` 适合测量的原因：它是单调高精度时钟，不受系统时间调整影响，且返回小数毫秒。`Date.now()` 用于「两次日志之间隔了多久」够了，用于基准测试不行。

系统化的观察用 `PerformanceObserver`（下面示例②），但记住**先量再优化**：没有「这一步多少毫秒」这个数字，你无法判断优化是否有效，也无法在两个方案之间做决定。

### 优化手段与优先级

按「收益 / 成本」从高到低：

| 手段 | 什么时候用 | 注意 |
| --- | --- | --- |
| **事件委托** | 列表项多、项会增删 | 一个监听器挂在容器上，用 `event.target.closest('[data-action]')` 找目标；同时省下「渲染后事件失效」那一类 bug，见 [DOM 操作与事件系统](/javascript/dom-and-events) |
| **防抖 / 节流** | 输入即时搜索、滚动、resize、提交按钮 | 防抖（debounce）等停止后执行，节流（throttle）限定频率。别忘了**兜底最大等待时间**和卸载时清理待执行定时器 |
| **拆分长任务** | 单次计算超过一帧（约 16ms） | `requestAnimationFrame` 分片：每帧处理一部分，帧末让出主线程让浏览器能绘制与响应输入 |
| **代码分割 / 懒加载** | 首屏用不到的功能 | 动态 `import()`，见 [ES 模块、动态导入与迭代器](/javascript/modules-and-iterators)；构建侧的产物切分与预加载见 [Vite 构建侧](/frontend-engineering/vite-build) |
| **读写分离** | 循环里既读几何属性又改样式 | 见下一小节，这是最容易顺手修掉的一项 |
| **虚拟列表** | 条数大到 DOM 节点本身成为成本（经验量级：几百到几千行以上，以实测为准） | 只渲染视口内的行 + 上下缓冲，用 padding 或 transform 撑出滚动高度；不要为 50 条数据引入虚拟列表 |
| **Web Worker** | 纯计算、有明确输入输出 | 见下一小节，通信成本是硬门槛 |

`scheduler.yield()` 是这类 API 里更新的一个（把剩余工作让给后续任务、优先处理输入），**支持度本站未核实**：请以 [MDN Web API 入口](https://developer.mozilla.org/en-US/docs/Web/API) 与 [Can I use](https://caniuse.com/) 为准。在 rAF 分片已经够用的场景里，不需要为它写降级分支。

`requestAnimationFrame` 分片的最小形状：

```js
function processInChunks(items, work, done) {
  let i = 0;
  (function step() {
    const start = performance.now();
    while (i < items.length && performance.now() - start < 8) work(items[i++]);  // 每帧只干 8ms
    if (i < items.length) requestAnimationFrame(step); else done();
  })();
}
```

预算写成 8ms 而不是 16ms，是给样式/布局/绘制留位置——一帧里你要渲染。

### 避免强制同步布局：读写分离

几何属性（`offsetHeight`、`getBoundingClientRect`、`clientWidth`）被读取时，浏览器**必须**先把待处理的样式与布局算完才能得到正确值。于是在循环里「改一下、读一下」会反复触发同步布局，把一次布局变成 N 次，这就是 **forced reflow / layout thrashing**。

```js
// 反例：每次写之前都读，触发 N 次布局
const heights = items.map(el => { el.classList.add("pre"); return el.offsetHeight; });
// 正确：全部读完，再全部写
const heights = items.map(el => el.offsetHeight);
items.forEach(el => el.classList.add("pre"));
```

症状识别：Performance 面板里密集的样式/布局块、Console 出现 `Forced reflow is a likely performance bottleneck` 类警告。做法就一条：**读阶段和写阶段分开，中间不要交替**。

### Web Worker 的适用边界与通信成本

适合：解析大文件、图像/音频处理、大数组排序与过滤、加解密、复杂校验。不适合：任何要操作 DOM 的事（Worker 里没有 `document`）、I/O 密集的接口聚合（Node/浏览器都是异步 I/O，不需要线程）、单次小于几毫秒的计算（通信开销压不过收益）。

通信走 `postMessage`，值是**结构化克隆（structured clone）**——深拷贝，等于 `structuredClone(value)` 的成本。这个事实决定用法：

- 传一个十万项数组进去、再传回来，你要付两次全量拷贝。数据量大时改用 **Transferable**（`ArrayBuffer`、`OffscreenCanvas`）把所有权移交过去，拷贝成本归零，但原线程就不能再用它了。
- 别为了「算一个和」开 Worker，也别为了「避免卡住」在 Worker 里跑一个内部会同步阻塞的库。
- Worker 里的 `console` 输出会带上来源，调试成本更高；先证明主线程真的被它占住了再搬。

`structuredClone` 本身也有成本（大对象深拷贝），而且**不能克隆函数、DOM 节点、Symbol**——本机 Node v25.4.0 实跑 `structuredClone(() => {})` 抛 `DataCloneError: () => {} could not be cloned.`。用它的典型场景是「给状态做一份互不干扰的快照」（[阶段项目](/javascript/project) 里的撤销/重做），别把它放进每帧执行的渲染路径。

### 内存：四个泄漏源与两个 Weak 工具

判定标准：**移除元素不等于释放内存**。只要还有一个引用指向它，GC 就动不了，DevTools 里它就出现在 `Detached DOM tree`（脱离文档但仍存活）。堆快照三份对比法的操作在[错误处理与 DevTools 调试](/javascript/errors-and-debugging) 的 Memory 一节。

| 泄漏源 | 典型代码 | 修法 |
| --- | --- | --- |
| 监听器没解绑 | 组件卸载/弹层关闭后，仍挂在 `document` 或长期存在的元素上 | 记录 `AbortController`，`controller.abort()` 一次性解绑整组监听（`addEventListener(name, fn, { signal })`） |
| 定时器/`requestAnimationFrame` 循环没停 | 轮询、动画在页面切走后还在跑 | `clearTimeout`/`cancelAnimationFrame` 与启动写在同一作用域；用 `visibilitychange` 暂停 |
| 闭包持有 DOM 引用 | 模块级数组 push 了元素；监听器捕获了整个容器 | 只捕获需要的字段（id、index）而不是 DOM 节点；集合改存 id |
| 缓存无上限 | `const cache = new Map()` 越攒越多 | 定上限并按 LRU 淘汰，或直接换 `WeakMap` |

两个 Weak 工具的分工，别记混：

- **`WeakMap`**：键是对象且**不阻止键被回收**。用于「给别人的元素挂元数据」（`uiState.set(button, { pending: true })`），元素消失时条目自动可回收。代价：不可遍历、没有 `size`——所以你**不能**靠它做淘汰统计。
- **`WeakRef`**：弱引用一个对象，`deref()` 可能返回 `undefined`。用于缓存「有就用、没了就算了」的大对象。**不要**用它替代正确的解绑，也不要假设 `FinalizationRegistry` 何时触发（引擎决定，可能永远不触发）。

非 JS 因素（图片尺寸与格式、字体阻塞、CSS 体积、缓存策略）不在本章，见 [浏览器渲染机制与关键渲染路径](/frontend-engineering/rendering-pipeline) 与 [性能指标与 Core Web Vitals](/frontend-engineering/performance)：JS 的优化只影响 INP 与一部分 TBT，图片加载慢靠事件委托是治不好的。

### 示例①：键盘可操作 + 读屏同步的弹层（含焦点陷阱）

HTML 骨架——容器先存在（`aria-live` 的容器必须是先落 DOM 再改内容）：

```html
<button id="open-btn" aria-haspopup="dialog" aria-expanded="false">编辑待办</button>

<div id="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" hidden>
  <h2 id="dlg-title">编辑「买牛奶」</h2>
  <form id="dlg-form">
    <label for="dlg-text">标题</label>
    <input id="dlg-text" name="text" required>
    <p id="dlg-error" aria-live="polite"></p>
    <button type="submit">保存</button>
    <button type="button" data-action="close">取消</button>
  </form>
</div>

<p id="status" role="status" aria-live="polite" class="sr-only"></p>
```

```js
const openBtn = document.getElementById("open-btn");
const dialog  = document.getElementById("dialog");
const live    = document.getElementById("status");
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
let lastFocused = null;

function focusables() {
  return [...dialog.querySelectorAll(FOCUSABLE)].filter(el => !el.disabled && el.offsetParent !== null);
}

function openDialog() {
  lastFocused = document.activeElement;       // 关闭时还原到这里
  dialog.hidden = false;
  openBtn.setAttribute("aria-expanded", "true");
  const first = focusables()[0];
  (first ?? dialog).focus();                  // 陷阱：容器带 tabindex="-1" 时也能接住焦点
  document.body.style.overflow = "hidden";
}

function closeDialog() {
  dialog.hidden = true;
  openBtn.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();  // 关键一步
}

// 焦点陷阱：Tab 到最后一项时绕回首项，Shift+Tab 反向
dialog.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeDialog(); return; }
  if (e.key !== "Tab") return;
  const items = focusables();
  if (items.length === 0) { e.preventDefault(); return; }
  const first = items[0], last = items.at(-1);
  if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
});

openBtn.addEventListener("click", openDialog);
dialog.addEventListener("click", (e) => { if (e.target.closest('[data-action="close"]')) closeDialog(); });

function announce(text) {
  live.textContent = "";                 // 先清空，保证同样的文案也能再报一次
  requestAnimationFrame(() => { live.textContent = text; });
}

document.getElementById("dlg-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("dlg-text");
  const err = document.getElementById("dlg-error");
  if (!input.value.trim()) {
    err.textContent = "标题不能为空";
    input.setAttribute("aria-invalid", "true");
    input.focus();                        // 错误要交给焦点，不是只画红框
    return;
  }
  err.textContent = ""; input.removeAttribute("aria-invalid");
  closeDialog();
  announce("已保存待办：" + input.value.trim());   // 关闭后读屏才知道发生了什么
});
```

自查四步，每步都能在两分钟内做完：**只用 Tab 走一遍能否进出**（不能被困在陷阱外的页面上，也不能 Tab 到弹层背后的按钮）；**Esc 能否关闭**；**关闭后焦点是否回到打开它的那个按钮**；**开读屏保存一次，是否听到「已保存」**。

<Callout type="unverified" title="示例①未在真实浏览器与读屏中运行">

上面这段代码按 ARIA 与 `tabindex` 的规范语义编写（`tabindex` 取值、`aria-live` 取值、`aria-expanded` 维护方式已核对 MDN，2026-10-17），但**未在本机浏览器执行、未用 Narrator/VoiceOver 实际朗读验证**。原生 `<dialog>` + `showModal()` 自带焦点陷阱与还原，能用它就用它，本例手写是为了让你理解框架弹窗里到底发生了什么。

</Callout>

### 示例②：用 PerformanceObserver 观察长任务

```js
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.warn("[perf:longtask]", {
      duration: Math.round(entry.duration),        // 已核实：长任务定义为 ≥50ms
      start: Math.round(entry.startTime),
      attribution: entry.attribution?.[0]?.name,   // 提示来源：dom | script | same-origin-ancestor …
    });
  }
});
observer.observe({ type: "longtask", buffered: true });   // buffered 取观察前已经发生的
```

预期形态：主线程被占 50ms 以上时打出 `[perf:longtask] { duration: 312, … }`；一次交互若卡到用户能察觉，通常能看到 1–3 条。用 `performance.mark` / `measure` 给可疑函数打点后，可以把「哪段代码产生的长任务」对上（在长任务前后各打一个 mark，比较 `startTime`）。

<Callout type="unverified" title="长任务观察器的支持度与条目字段">

`longtask` 条目属于 **Long Tasks API**，MDN 明确标注该特性 **非 Baseline、Limited availability**（核实 2026-10-17），也就是说**部分主流浏览器不支持**，`observe({ type: "longtask" })` 会抛 `TypeError`——上线前必须包 `try/catch` 并让它在不支持时静默降级。

更新一层的 `long-animation-frame`（LoAF，MDN 定义为「渲染更新延迟超过 50ms」、同样标注非 Baseline）与 `event`（事件耗时，`observe` 的 `durationThreshold` 默认 104ms）两类条目属于较新能力，**本站未核实其在目标浏览器上的可用性与字段名**。用之前请在 [MDN PerformanceObserver.observe](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver/observe) 与 [Can I use](https://caniuse.com/) 上确认，别把监控代码写成只有 Chrome 能跑。

</Callout>

## 常见错误与排查

**1）给 div 加了 click，键盘按 Enter 什么都不发生。** 现象：鼠标能点，Tab 到不了或按了没反应。原因：`div` 不可聚焦、不响应 Enter/Space。确认：Tab 看焦点是否落上去。修：**换成 `<button>`**。如果确实要自制控件，补 `tabindex="0"` + `role` + keydown 只是及格线，成本远高于原生元素。

**2）正数 tabindex 让 Tab 顺序变得无法维护。** 现象：加了 `tabindex="1"` 之后，全页顺序都变了，每加一个控件都要重排数字。原因：正值排在所有 `0` 之前。确认：按 Tab 数一遍顺序是否等于视觉顺序。修：**删掉所有正数值**，改 DOM 源码顺序；只有需要程序化聚焦的地方用 `-1`。

**3）用 `aria-hidden` 隐藏弹层背后的内容，键盘仍能 Tab 进去。** 现象：读屏跳过了背景，但 Tab 会走到看不见的高额按钮上，Enter 之后焦点消失。原因：`aria-hidden` 只影响可访问树，**不影响焦点顺序**。确认：弹层打开时按 Tab，看状态栏焦点目标。修：给背景容器设 `inert`，或把其中可交互元素逐个 `tabindex="-1"`（并保存原值以便还原）；`display: none` 也能同时解决两者。

**4）动态插入 `aria-live` 容器并立刻填内容，什么都不播。** 现象：视觉上看得到消息，读屏没念。原因：可访问树还没把这个 region 登记进去。确认：把容器预先写进 HTML、只在里面改文本，是否就能播。修：**容器常驻 DOM**，只更新其 `textContent`；要重播同一句文案就先清空再赋值（示例①的 `announce()`）。

**5）列表每次筛选都重建 DOM，读屏逐条朗读整个列表。** 现象：键盘用户按一次「只看未完成」，要听三十条内容。原因：把容器当成 `aria-live` 区域，DOM 大规模变化被当作更新播报。确认：读屏是否在变化时开始长篇朗读。修：**live region 只放摘要**（`剩余 6 项`），列表本身不要 `aria-live`；焦点在重建后移回稳定位置（筛选按钮或列表标题，配合 `tabindex="-1"`）。

**6）`innerHTML` 重建列表导致焦点丢失。** 现象：每敲一个字，输入框就失去焦点、输入法打断候选。原因：包含输入框的容器被整体替换，旧节点连同焦点一起没了。确认：`document.activeElement` 是否变成 `body`。修：**增量更新而不是整表重建**（只改需要改的行），或把输入框放在重建范围之外；事件改用委托，见[阶段项目](/javascript/project)里「整表重建的取舍」。

**7）在滚动/resize 回调里直接读 `getBoundingClientRect` 再改样式。** 现象：滚动时明显掉帧，Performance 里布满小布局块。原因：交替读写造成强制同步布局。确认：Console 是否出现 forced reflow 警告。修：读阶段集中读、写阶段集中写；再用节流或 rAF 把回调对齐帧。

**8）防抖之后的回调在页面卸载后仍执行，改到了已消失的 DOM。** 现象：报错 `Cannot read properties of null`，或偶发不报错但状态错。原因：定时器没在清理时取消。确认：把待执行的定时器 id 收进数组，卸载钩子里逐个 `clearTimeout`。修：**启动与清理写在同一作用域**（`AbortController` 管监听器 + 定时器表管计时），这与框架组件卸载清理是同一个义务。

**9）给逐帧变化的进度数字挂 `aria-live`。** 现象：读屏用户听不到任何有效信息，只有连续打断。原因：更新频率远高于朗读速度。确认：`assertive`/`polite` 区域是否每帧都变。修：只报节流后的摘要或结束时的结果，把实时数字放进普通文本（用户可主动去读）。

## 练习

<Exercise title="练习 1 · 检查一段自制按钮的可访问性" difficulty="基础">

下面的「删除按钮」有哪些缺陷？逐条列出并给出改法（最多改一次元素，不要写 keydown 处理）。

```html
<div class="del" onclick="removeItem(3)">删除</div>
```

<template #answer>

四个缺陷：① 不可聚焦，键盘完全到不了；② Enter/Space 不触发；③ 没有控件语义，读屏只当普通文本念出「删除」，用户不知道能按；④ 「删除」没有说明删除**什么**，读屏的按钮列表里会出现一排「删除」。

改法：

```html
<button type="button" class="del" data-action="remove" data-id="3">
  删除 <span class="sr-only">「买牛奶」</span>
</button>
```

`<button>` 一次解决 ①②③；`type="button"` 避免它在 form 里默认提交；隐藏文本补上目标（也可以用 `aria-label="删除「买牛奶」"`，但可见文本要包含标签内容）。第 ④ 条与「图标按钮必须有名称」是同一类问题：只有 SVG 的按钮要么 `aria-label`，要么 `<title>` + `role="img"`，见 [HTML 第 9 章](/html/accessibility)。

</template>

</Exercise>

<Exercise title="练习 2 · 判断 tabindex 取值" difficulty="基础">

四个需求，各该写什么（`tabindex="0"` / `tabindex="-1"` / 不加）：① 弹层容器本身，需要在打开时 `focus()`；② 跳过导航链接的目标 `<main>`；③ 一个用 `div` 做的手风琴面板，只在标题展开后需要被 Tab 到；④ 表单项里的输入框。另：为什么「让导航栏先被 Tab 到」而写 `tabindex="1"` 是错的？

<template #answer>

① `tabindex="-1"`——只要程序化聚焦，不要进 Tab 顺序。② `tabindex="-1"`——同理，链接跳转后焦点要能落到它。③ 这个需求本身是错的：手风琴的正确结构是「`button` 控制 `aria-expanded`，面板不需要可聚焦」；若面板里有交互元素，那些元素原生可 Tab，`tabindex` 一个都不用加。④ **不加**，`input` 天生可聚焦，多余的 `tabindex="0"` 只是噪音。

`tabindex="1"` 错在语义层面：正值排在**所有** `0` 之前，也就是它会插到页面每一个自然顺序元素前面，包括你排第二第三个 nav 的兄弟；而且此后每加一个控件都要重排全部数字，顺序与 DOM 结构彻底脱钩。MDN 的建议是只用 `0` 与 `-1`。要控制顺序就改源码顺序。

</template>

</Exercise>

<Exercise title="练习 3 · aria-live 选型" difficulty="进阶">

五种变化，各选 `off` / `polite` / `assertive` / 不用 live region，并说明理由：① 保存成功后「已保存」；② 搜索联想下拉里每次击键的结果；③ 待办列表筛选后剩余条数；④ 「会话将在 60 秒后过期」；⑤ 后台任务进度百分比（每帧更新）。

<template #answer>

① `polite`，且文案含结论。② **不用 live region**：逐字符变化会形成追读噪音；联想列表交给用户主动浏览（`role="listbox"` + 方向键 + `aria-activedescendant`，见 [HTML 第 6 章](/html/forms) 与 ARIA 授权实践）。③ `polite`——这是「操作有没有生效」的唯一非视觉通道，短文案 `剩余 6 项`。④ `assertive`——真正有时间窗口、打断是必需的（MDN 明确「除非打断是必需的否则不要用」），60 秒提示属于此类；同时视觉上也必须有倒计时。⑤ **不用 live region 或 `off`**：每帧更新读屏追不上；改成节流摘要（每 2 秒一次或每 25% 一次）+ 结束时报一次最终结果。

判断口诀：**这条信息是不是「用户刚做完动作的结果」**——是就 `polite`；是紧急且会错过就 `assertive`；是高频流就 `off` 或干脆不报。

</template>

</Exercise>

<Exercise title="练习 4 · 用测量决定优化手段" difficulty="进阶">

场景：待办列表 2000 条，每次输入筛选关键词都卡顿，Performance 面板看到主线程被连续长任务占满，Console 有 `Forced reflow` 警告。你手上有四个候选方案（虚拟列表、防抖、读写分离、Web Worker）。请按「先做哪个」排序，并说明每一步要用什么数字证明它有效。

<template #answer>

顺序：**③ 读写分离 → ② 防抖 → ① 虚拟列表 → ④ Web Worker**。

理由：`Forced reflow` 是已经告诉你的确切病因——每次击键触发「重建 DOM → 读高度 → 再写样式」的交替循环，改动成本最低、收益最直接；修完再看数字，很可能已经够了。第二步防抖把「每击键一次全量筛选」降到每 150–250ms 一次，消除的是频率而不是单次成本。第三步虚拟列表解决的是 DOM 节点数量本身，成本最高（滚动定位、动态行高、搜索后重置滚动位置），2000 条在读写分离 + 防抖后仍卡才上。第四步：筛选是「遍历数组读几个字段」，结构化克隆的进出成本很可能压过计算收益，属于最不该做的选项（纯计算量大且与 DOM 无关时才搬 Worker）。

每步的量化方式：`performance.now()` 在筛选函数前后各取一次，记录「输入一个字符到列表更新完成」的耗时；再用 `PerformanceObserver` 数 `longtask` 条数与最长 duration。**同一次输入序列（比如粘同一句话）跑三遍取中位数**，优化前后各测一次；只说「感觉流畅了」不算做过性能优化。

</template>

</Exercise>

<Exercise title="练习 5 · 找出一段代码里的三个泄漏" difficulty="挑战">

```js
const history = [];                      // 模块顶层
function openPanel(node) {
  history.push(node);                    // 记录打开过的元素
  window.addEventListener("keydown", onKey);
  const timer = setInterval(() => render(node), 1000);
  panelCache.set(node, { scroll: node.scrollTop });
}
function closePanel() { panel.hidden = true; }
```

指出三个泄漏源、说明各自为什么「移除了元素却没释放内存」，并给出修法。

<template #answer>

① `history` 是模块级数组，`push` 进去的 DOM 节点**永久强引用**：即使节点从文档里删掉，数组还指着它，GC 不能回收，DevTools 里表现为 `Detached DOM tree` 增长。修法：改存稳定标识（`id`/`index`），或给它设上限（`history.splice(0, history.length - 20)`）。

② `addEventListener` 在 `window` 上、每次打开都加一次且从不解绑：不仅泄漏，还会让 `onKey` 被调用 N 次。修法：一个 `AbortController` 管一组——`window.addEventListener("keydown", onKey, { signal })`，关闭时 `controller.abort()`；或者把监听器提到模块顶层只注册一次，靠状态判断是否响应。

③ `setInterval` 从不停止，回调里的箭头函数闭包捕获了 `node`，于是「定时器活着 → 闭包活着 → DOM 活着」这条链永远断不掉，且页面切到后台仍在每秒渲染。修法：把 `timer` 存起来，`closePanel()` 里 `clearInterval(timer)`；用 `cancelAnimationFrame`/`visibilitychange` 处理动画类循环。

另有一条同类：`panelCache` 用 `Map` 以 DOM 节点为键 → 键强引用节点。改成 **`WeakMap`**（键弱引用，节点消失条目即可回收），代价是不能遍历、没有 `size`，所以你不能再靠它统计「缓存了多少」——需要上限的场景要用 `Map` + 手动淘汰。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN · tabindex](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/tabindex) —— 核实本章表格：三种取值的行为、`-1` 可程序化聚焦、以及「建议只用 0 与 -1、避免正值」的原文（2026-10-17 读取）。
- [MDN · aria-live](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live) —— 核实 `off`/`polite`/`assertive` 三个取值的语义、`assertive` 会打断并可能清空队列、以及「region 要预先存在、之后更新内容」的用法要求。
- [W3C ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/) —— 弹窗、手风琴、组合框等模式的键盘交互与属性组合的标准答案；示例①的焦点陷阱就是 dialog 模式的简化版。
- [MDN · Focus API](https://developer.mozilla.org/en-US/docs/Web/API/Focus_API) —— 核实 `focus()`、`focusin`/`focusout`、`preventScroll` 选项的行为。
- [MDN · prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) —— 核实媒体查询写法与「减弱而非关闭」的取向，配合 [过渡与动画](/css/transitions-and-animations)。
- [MDN · PerformanceLongTaskTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming) —— 核实长任务的 50ms 定义、`type: "longtask"` 与 `buffered: true` 写法，以及「非 Baseline」的支持度结论。
- [MDN · PerformanceObserver.observe](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver/observe) —— 核实各条目类型的来源与 `durationThreshold`（事件条目默认 104ms）；`long-animation-frame` 的 50ms 阈值核实自 [PerformanceLongAnimationFrameTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming)。
- [MDN · structuredClone](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone) —— 核实不可克隆的值类型（函数、DOM 节点）与抛 `DataCloneError` 的行为（本机 Node 实跑一致）。
- [javascript.info · Event delegation](https://javascript.info/event-delegation) —— 事件委托的最小实现，用于核实本章第一手的写法。
- [Can I use](https://caniuse.com/) —— 动手前核对 `longtask`、`scheduler.yield`、`inert` 在你目标浏览器上的支持度。

## 下一章

本章处理「代码没报错但体验不成立」：键盘与读屏的那一半，主线程与内存的那一半。两半的共同方法都是**把假设变成测量**——无障碍用键盘和读屏走一遍，性能用 `performance.now()` 与长任务条目数一遍。这一章的工具在[错误处理与 DevTools 调试](/javascript/errors-and-debugging)里都出现过，那一章解决「有报错怎么读」，本章解决「没报错怎么查」。

下一章把整条 JavaScript 路线合上：[阶段项目：纯 JavaScript 待办清单](/javascript/project)。它会要求你在这里学到的东西全部落地——`state` + `render()` 的单一渲染入口、列表的事件委托、删除后的空状态与 `aria-live` 播报数量、`localStorage` 与 `fetch` 的失败分支。做完它就可以进 [TypeScript](/typescript/)。
