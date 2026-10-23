# 过渡与动画：哪些属性能动、贵在哪里、怎么让它不打扰人

## 先看两个都会遇到的现象

**现象一：写了 `transition`，第一次却不播。**

```css
.toast { transition: opacity 300ms ease-out; opacity: 0; }
.toast.is-visible { opacity: 1; }   /* 给刚插入 DOM 的元素加这个类，它直接出现，没有淡入 */
```

不是「transition 没生效」，而是**规范规定元素首次样式更新不触发过渡**——浏览器没有「上一个状态」可以插值。

**现象二：动画一卡一卡。** `transition: width 400ms` 的每一帧都要重算布局，连带所有兄弟盒重排；换成 `transform: translateX()` 帧率立刻不同。区别不在「动了几个属性」，而在**这个属性属于渲染流水线的哪一级**。

<Callout type="info" title="本章的核实方式">

本机没有可用的浏览器条件，因此**本章不写「实测」**，只给「预期结果是…」与对应的 DevTools 查看方式。规范级结论（`fill-mode` 四值、可动画属性分类、`transition-behavior` 与 `@starting-style`、`will-change` 警告原文、动画值列表补齐规则、缓动关键字的贝塞尔数值、`prefers-reduced-motion` 取值）已用 WebFetch 核对 MDN 与 W3C，核实时间 **2026-10-17**，来源见文末。DevTools 面板的功能与入口（Performance、Rendering > Paint flashing、Layers）**未能核实**——本环境访问不了 developer.chrome.com，相关处标 unverified。

</Callout>

## `transition` 的四个分量与精确写法

| 分量 | 初始值 | 要点 |
| --- | --- | --- |
| `transition-property` | `all` | 明确列出属性名，逗号分隔 |
| `transition-duration` | `0s` | **必须显式写**，`0s` 等于没有过渡 |
| `transition-timing-function` | `ease` | 见缓动一节 |
| `transition-delay` | `0s` | 只在需要错开时写 |

简写里**第一个时间值是 duration，第二个是 delay**：`transition: opacity 1s 200ms` 是「延迟 200ms、用 1s 过渡」，`transition: opacity 200ms 1s` 是「延迟 1s、用 200ms 过渡」。顺序写反就是「delay 怎么这么大」的标准来源；在 Computed 面板搜 `transition`，四个长属性分开列出，谁是 duration 谁是 delay 一眼可辨。

现在还有第五个长属性 `transition-behavior`（初始值 `normal`），管离散属性要不要参与过渡，见下一节。

**别用 `all`。** 三层代价：

1. **不可控**——`transition: all 300ms` 让所有属性共用一条时长和缓动。颜色想要 150ms、位移想要 400ms，`all` 一律给 300ms。
2. **意外过渡**——JS 改 class 时顺带把 `width`、`padding`、`font-size` 也过渡了，你看到「整块内容在缓慢蠕动」，而代码里根本没有这条声明。
3. 每次样式变更要为更多属性做差异比对——理论上更重，但幅度取决于实现，本站未做性能对比。**真正的理由是可控性，不是性能。**

```css
.menu {
  transition:
    opacity 160ms ease-out,
    transform 220ms cubic-bezier(0.2, 0, 0, 1),
    visibility 0s linear 220ms;   /* 退出时延迟隐藏，进入时把 delay 覆盖回 0s */
}
```

`visibility` 参与过渡时会中途跳到目标值，所以「`0s` + 延迟」能保住淡出过程可见——完整用法见后面的示例。

## 可过渡属性：默认全部能动，问题在怎么动

「只有少数属性能过渡」不准确。MDN 原文：CSS 动画与过渡依赖可动画（animatable）属性的概念，**除非另有说明，所有 CSS 属性都是可动画的**。真正的区别是插值方式，规范分四类：

| 类型 | 行为 | 代表属性 |
| --- | --- | --- |
| 按计算值插值 | 逐分量插值，能出中间态 | `opacity`、`transform`、`color`、`width`、`margin`、`box-shadow` |
| 可重复列表 | 列表长度不齐时补齐再逐项插值 | `background-size` 等列表值 |
| 离散（discrete） | 不插值，**在进度 50% 处一次性翻转** | `display`、`visibility`、`content-visibility` |
| 不可动画 | 在关键帧和过渡里被忽略 | 例如 `animation-name` 自身 |

自定义属性也在这一族：**未注册的是离散的，用 `@property` 注册过的按计算值插值**——给某个变量做过渡时这一条决定成败，见[值、单位与自定义属性](/css/units-and-custom-properties)。

`display` 的历史限制正来自「离散」：没有中间值可插。传统解法是绕开（`visibility` + `opacity`，或 `height: 0` 配 `overflow: hidden`），规范侧的正面解需要两个特性配合：

```css
.popover {
  display: none; opacity: 0;
  transition: opacity 200ms ease-out, display 200ms allow-discrete;
}
.popover.is-open {
  display: block; opacity: 1;
  @starting-style { opacity: 0; }   /* 提供首次样式更新的起点 */
}
```

机制（引 MDN）：`allow-discrete` 让离散属性参与过渡，且「当动画涉及 `display: none` 或 `content-visibility: hidden` 时，浏览器会在两值间翻转，使被过渡的内容在整个时长内保持可见」——从 `none` 到 `block` 时**在进度 0% 就切到 `block`**，所以淡出期间元素还在。`@starting-style` 则补上首次样式更新的起点，因为「为避免意外行为，CSS 过渡默认不会在元素的首次样式更新时触发」。

<Callout type="unverified" title="这两个特性属于较新增能力">

MDN 把 `@starting-style` 标为 Baseline 2024（自 2024 年 8 月起跨主流浏览器可用），`transition-behavior` 更晚。是否覆盖到位你的目标浏览器，动手前查 [Can I use](https://caniuse.com/)。不支持时的表现通常是**静默的**：规则被忽略，元素直接出现和消失，没有报错。

</Callout>

`auto` 尺寸是另一类限制：`height: auto` 不是可计算的长度，没有可插值的中间值，`transition: height` 从 `0` 到 `auto` 直接跳变。规范在推进关键词插值（较新特性），支持度以 caniuse 为准；当前稳妥替代是动画一个已知像素值，或动画 `grid-template-rows: 0fr → 1fr`。

## 缓动函数族：曲线形状就是情绪

关键字与等价贝塞尔控制点（核对自 MDN，2026-10-17）：

| 关键字 | 等价 | 观感 |
| --- | --- | --- |
| `linear` | `cubic-bezier(0, 0, 1, 1)` | 匀速。机械感、进度条、循环旋转 |
| `ease` | `cubic-bezier(0.25, 0.1, 0.25, 1)` | 起步稍快、收尾很慢。**默认值** |
| `ease-in` | `cubic-bezier(0.42, 0, 1, 1)` | 越动越快，末尾「砸出去」。适合离场 |
| `ease-out` | `cubic-bezier(0, 0, 0.58, 1)` | 一冲就快、缓缓停住。适合入场 |
| `ease-in-out` | `cubic-bezier(0.42, 0, 0.58, 1)` | 两头慢中间快。适合位置平移 |

规律只有两条：**入场用 `ease-out`**（来得快、停得稳，像被接住），**离场用 `ease-in`**（走得越来越快，像被抽走）。`ease` 是默认值，但在 UI 里几乎从不是最优解——收尾拖得长，短时长下显得「黏」。

`cubic-bezier(x1, y1, x2, y2)` 的第一、三个分量（时间轴）必须落在 0–1，第二、四个（进度轴）可以越界，越界就产生回弹过冲：`cubic-bezier(0.34, 1.56, 0.64, 1)` 就是「轻微过头再回落」的弹性手感。

另外两族：`steps(n)` 把时间等分成 n 段（默认 `jump-end`，`step-start` / `step-end` 分别是 `steps(1, jump-start)` / `steps(1, jump-end)`），逐帧精灵图用它，别用它做 UI 位移；`linear(0, 0.25 50%, 1)` 用分段点描任意速度曲线，能做贝塞尔表达不了的复合缓动，属 CSS Easing Functions Level 2，支持度以 caniuse 为准，只在需要精确复刻设计稿缓动时才值得用。

## `animation` 的八个分量与 `fill-mode` 的闪回

| 分量 | 初始值 | 说明 |
| --- | --- | --- |
| `animation-name` | `none` | 简写里**建议放最后**，避免与其它值歧义（MDN 明确推荐） |
| `animation-duration` | `0s` | 不写就等于不动 |
| `animation-timing-function` | `ease` | 每个关键帧段各应用一次，不是整条一次 |
| `animation-delay` | `0s` | 可为负：表示「从中间开始播」，做错位循环好用 |
| `animation-iteration-count` | `1` | 可为小数，配合 `fill-mode` 决定停在哪个进度 |
| `animation-direction` | `normal` | `reverse` / `alternate` / `alternate-reverse` |
| `animation-fill-mode` | `none` | 见下表 |
| `animation-play-state` | `running` | 装饰性循环靠它暂停 |

`animation-timeline`（初始值 `auto`）也在这个简写里，是滚动驱动动画的入口，本站不展开。`fill-mode` 四值定义核对自 MDN（2026-10-17）：

| 取值 | 规范定义 | 你会看到什么 |
| --- | --- | --- |
| `none` | 动画不在执行时不给目标应用任何样式 | 延迟期间用「自身样式」，结束后弹回 → **两头都闪** |
| `backwards` | 应用第一个相关关键帧的值，并在 `animation-delay` 期间保持 | 延迟期间已是入场起点；结束后仍弹回 → **一头闪** |
| `forwards` | 目标保留执行中最后一个相关关键帧的计算值 | 结束停在终点；延迟期间还是原样 → **另一头闪** |
| `both` | 同时遵守 `forwards` 与 `backwards` | 两头都不闪。入场动画的默认选择 |

「第一个/最后一个相关关键帧」取决于 `animation-direction`：`reverse` 时相关首帧是 `100%`；`alternate` 配偶数 `iteration-count` 时 `forwards` 保留的是 `0%` 的值。`forwards` 还有隐蔽后果：动画值在层叠中高于普通声明，被冻结的属性会**持续压制你后续对该属性的 `transition`**。MDN 同时写明，被动画的属性表现得像已包含在 `will-change` 里，且动画期间创建的层叠上下文会保留——直接关联[定位与层叠上下文](/css/positioning-and-stacking)。

### 多动画叠加与逗号列表

动画数量由 `animation-name` 的逗号项数决定。规范原文：值列表从第一项开始对齐，**多出来的值不被使用；某个分量的值数量不足时，UA 必须把它的列表重复计算直到够用**——所以 `animation: a 2s, b 1s;` 配一条 `animation-fill-mode: both;` 会让两条都用 `both`，而不是只作用第一条。

同一属性被两条动画同时改写时**声明在后的赢**（MDN 明确说后声明的动画在层叠中覆盖前者）。别指望两条动画各让一半 `transform`——`transform` 只有一个值；要复合效果就写进同一条 `@keyframes`，或者拆开：外层负责位移，内层负责缩放。

## 性能：为什么 `transform` 便宜而 `width` 贵

概念级链条（完整机制见[浏览器渲染机制与关键渲染路径](/frontend-engineering/rendering-pipeline)）：样式计算 → 布局（layout，旧称重排 reflow）→ 绘制（paint）→ 合成（composite）。动画每帧都要重走这条链，**能从哪一级开始重走，决定它有多贵**。

| 属性 | 触发的最重一级 | 代价 |
| --- | --- | --- |
| `transform`、`opacity` | 合成 | 便宜：几何与位图不变，合成线程搬现成纹理 |
| `color`、`background-color`、`border-color` | 绘制 | 中等：不重排但要重画 |
| `box-shadow` | 绘制 | 偏贵：阴影区远大于元素，重绘面积大 |
| `filter` | 绘制 + 合成（且创建层叠上下文） | 中偏贵：模糊要重算一片像素 |
| `width`/`height`/`top`/`left`/`margin`/`padding` | 布局 | 最贵：连带兄弟与祖先全部重排 |
| `font-size`、`letter-spacing` | 布局 | 贵：文字重排 |

观察方法（预期结果）：Rendering 面板勾选 Paint flashing 后播放动画，**动画 `transform` 时不应出现大面积闪烁，动画 `width` 时元素与它的兄弟会一起闪**；再用 Performance 录 3 秒以上看主线程的紫色 Layout 条，**动画 `top`/`width` 时它每帧都出现，换成 `translate` 后应当消失**。

<Callout type="unverified" title="面板名称与开关位置未能核实">

上面两步依赖 Chrome DevTools 的 Rendering > Paint flashing 与 Performance 面板，本环境无法核实官方文档原文与菜单位置，版本差异也可能改动入口。用 `Ctrl+Shift+P` 命令菜单搜「paint flashing」比翻菜单稳。结论本身（几何属性走布局、`transform`/`opacity` 走合成）是引擎层面的稳定事实。

</Callout>

### `will-change`：提示，不是加速器

MDN 的三条警告原文：**「把 `will-change` 作为处理已存在的性能问题的最后手段，不要用它预防性能问题」**；**「过度使用会让页面变慢而不是更快……过多的 `will-change` 造成过多内存占用并让渲染更复杂」**；**「在 `<body>` 这类大范围节点上应用非 `auto` 值实际会伤害性能」**。它还推荐「用脚本在变化前后开关」——写进静态样式表等于宣告「这个元素一直在变」，浏览器会长期保留优化。合法取值是 `auto`、`scroll-position`、`contents` 与属性名，`none` 和 `all` 不是；也不要写进 `@keyframes`（被动画的属性已经表现得像加了它）。

```css
.drag-handle { will-change: transform; }   /* 可接受：窄范围、高频可预测 */
* { will-change: transform, opacity; }     /* 别这样 */
```

## 动效设计：时长是经验值，不是标准

<Callout type="warn" title="下表是经验区间而非规范">

「微反馈 100–150ms、常规 200–300ms、大位移 400ms 级别」来自广泛实践共识，**不是任何标准的规定**。不同产品、刷新率、语境下都该重调。当起点，不当验收线。

</Callout>

| 场景 | 时长 | 缓动 |
| --- | --- | --- |
| 点击态、开关、勾选 | 100–150ms | `ease-out` |
| hover 反馈、下拉展开 | 150–250ms | `ease-out` |
| 面板滑入、卡片状态变化 | 200–300ms | `cubic-bezier(0.2, 0, 0, 1)` |
| 入场、页面级大位移 | 350–450ms | 同上 |
| 超过 500ms | 除非用户在等待，否则拖沓 | — |

**入场只有三种范式**，可组合但别同时上四种：位移 + 透明度（`translateY(12px)` + `opacity: 0`，最通用）、缩放 + 透明度（`scale(0.96)`，用于弹出层）、纯透明度（最克制，用于内容替换）。三条纪律：位移幅度控制在 8–24px，超过就是「页面在搬家」；**同批元素用错开（stagger）而不是同时**，`animation-delay: calc(var(--i) * 60ms)` 一行解决；**退场比入场短**（150ms 内），用户对「等东西消失」的耐心远低于「等东西出现」。

`animation` 与 `transition` 的选择边界：

| 用 `transition` | 用 `animation` |
| --- | --- |
| 状态在两三个值之间来回切换，起终点由层叠决定 | 有多阶段中间态、循环，或要播一次与状态无关的效果 |
| 由 JS 改 class 自然驱动 | 需要 `fill-mode` / `direction` / `iteration-count` 这类时间轴控制 |
| 只有一两个属性变化 | 需要关键帧编排与错开 |

口诀：**没有中间态就写 transition。** 一旦你开始为「播完回到原状」写 JS，说明该用 `animation` 并监听 `animationend`。

## `prefers-reduced-motion`：两种写法与为什么必须写

取值只有两个（核对自 MDN，2026-10-17）：`reduce` 表示用户已开启减弱动效；`no-preference` 表示未表态且**求值为 false**，而 `@media (prefers-reduced-motion)` 等价于 `@media (prefers-reduced-motion: reduce)`。受众是前庭功能障碍与动效敏感用户，也包含大量只是不想要屏幕晃动的普通用户——这是[无障碍第 8 章](/html/accessibility)「技术必须容忍用户偏好」的延伸。

**写法一：在自定义属性层面全局降级**（推荐，因为不需要 `!important`）。

```css
:root { --dur-fast: 160ms; --dur-base: 260ms; --dur-slow: 420ms; --stagger: 60ms; }
@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0.01ms; --dur-base: 0.01ms; --dur-slow: 0.01ms; --stagger: 0ms; }
}
.card { animation: card-in var(--dur-slow) var(--ease-out) both; }
```

用 `0.01ms` 而不是 `0s`：`0s` 不派发 `transitionend` / `animationend`，靠事件收尾的 JS 会永远等不到。

**写法二：逐条关闭位移、保留状态反馈**——减弱的是「动」，不是「反馈」。

```css
@media (prefers-reduced-motion: reduce) {
  .card { transition: opacity 120ms linear; transform: none; }
  .spinner { animation-duration: 2s; }   /* 保留旋转，只放慢 */
}
```

**不要**用 `* { animation: none !important; transition: none !important }` 一把梭：它把焦点环、加载指示、开关滑块的反馈一并抹掉，制造新的可访问性问题，还依赖 `!important`。

## 完整示例：下拉菜单 + 卡片入场 + 按钮点击反馈

```html
<div class="dropdown">
  <button class="dropdown__trigger" aria-expanded="false" aria-controls="nav-p">产品</button>
  <div class="dropdown__panel" id="nav-p"><a href="#">Web 应用</a><a href="#">小程序</a></div>
</div>
<main class="feature-grid">
  <article class="card" style="--i: 0">…</article>
  <article class="card" style="--i: 1">…</article>
</main>
<button class="btn btn--primary">立即注册</button>
```

```css
/* 1) 下拉菜单：进入快、退出慢，退出结束后才隐藏 */
.dropdown__panel {
  opacity: 0; transform: translateY(-8px) scale(0.98); transform-origin: top left;
  visibility: hidden;
  transition: opacity 160ms ease-out, transform 220ms var(--ease-out),
              visibility 0s linear 220ms;
}
.dropdown.is-open .dropdown__panel {
  opacity: 1; transform: none; visibility: visible; transition-delay: 0s;
}

/* 2) 卡片入场：错开 60ms，both 锁住首帧 */
.card { opacity: 0; transform: translateY(16px) scale(0.98); }
.card.is-in {
  animation: card-in var(--dur-slow) var(--ease-out) both;
  animation-delay: calc(var(--i) * var(--stagger));
}
@keyframes card-in { to { opacity: 1; transform: none; } }

/* 3) 按钮：位移极短，按下瞬时收缩 */
.btn--primary {
  transition: transform var(--dur-fast) var(--ease-out),
              background-color var(--dur-fast) var(--ease-out);
}
.btn--primary:hover  { background-color: var(--brand-strong); }
.btn--primary:active { transform: scale(0.97); transition-duration: 60ms; }

@media (prefers-reduced-motion: reduce) {
  .card { opacity: 1; transform: none; }
  .card.is-in { animation: none; }
  .dropdown__panel { transform: none; }
  .btn--primary:active { transform: none; }
}
```

预期结果与验证方式：

| 交互 | 预期 | 怎么看 |
| --- | --- | --- |
| 打开菜单 | 面板自上方 8px 滑入，约 220ms | Styles 里看 `.is-open` 的 `transition-delay` 是否覆盖为 `0s` |
| 关闭菜单 | 淡出后 `visibility` 才变 hidden | Computed 搜 `visibility`，它不会立刻变 |
| 卡片入场 | 两张相差 60ms 依次淡入上移 | 刷新后看 `.is-in` 何时被 JS 加上 |
| 点击按钮 | 缩到 0.97 再弹回 | 按住鼠标看 Computed 的 `transform` 矩阵 |
| 开启减弱动效 | 无位移无淡入，颜色反馈仍在 | Rendering 面板可模拟该媒体特性（入口未核实） |

**这里唯一不能省的是首屏兜底**：`.card { opacity: 0 }` 意味着 JS 不执行时页面一片空白。需要无 JS 可用时，把 0 只写在支持 JS 的分支里，或整段交给 `@starting-style` 那条路径。

## 常见错误与排查

### 症状：加了 `transition` 但样式没有过渡

按概率排四个原因：① 忘写 `transition-duration`（初始值 `0s`）；② 改的是 `display` 或 `height: auto` 这类离散/不可插值值；③ 只在 `.is-open` 里写过渡，触发时那条声明刚刚才生效；④ 首次渲染，规范默认不触发。确认：Computed 搜 `transition-duration` 看是不是 `0s`。

### 症状：元素刚插入就改状态，动画不播

即现象一。三种修法：把状态改动推到下一帧（`requestAnimationFrame` 里再改 class，稳妥用双层 rAF）；改前读一次 `el.offsetHeight` 强制样式刷新；或用 `@starting-style`。预期换任一种后淡入正常出现。

### 症状：入场第一帧「闪一下原位」再开始

`animation-delay` 大于 0 而 `fill-mode` 是 `none`，延迟期间用的是元素自身样式。补 `both` 或 `backwards`。自查：把 `animation-delay` 临时改成 `0s`，闪烁消失即确认是 fill-mode 问题。

### 症状：动画结束后弹回原位、或 hover 缩放完全无反应

弹回依次查三处：`alternate` 配偶数 `iteration-count` 时最后相关帧其实是 `0%`；同名 `@keyframes` 写了两条、后一条覆盖前一条；`animation-direction` 是 `reverse`。hover 缩放没反应则多半是某个 `fill-mode: forwards` 把 `transform` 占住了——动画值高于普通声明，`transition` 改不动它；修法是监听 `animationend` 后清掉 `animation`，或把入场改写成 `transition` + `@starting-style`。两种情况都靠 Computed 面板里 `transform` 的实际矩阵值确认，不要凭目测。

### 症状：动画卡顿，Performance 里每帧都有紫色 Layout

动画的是几何属性。把 `width`/`height`/`top`/`left`/`margin` 换成 `transform`；非改尺寸不可（展开高度）时退一步动画 `grid-template-rows`。加 `will-change` 之后更卡、显存吃紧则是滥用后果——全局搜 `will-change`，只保留被证实卡顿的少数元素，并在动画结束后清回 `auto`。

### 症状：`prefers-reduced-motion` 生效后完全感觉不到点击反馈

用了 `* { transition: none !important }` 一把梭。改成逐条降级：去掉位移与缩放，保留 100–150ms 的颜色/透明度变化——**减弱动效不等于取消反馈**。

## 练习

<Exercise title="练习 1 · 读一条 transition 简写" difficulty="基础">

写出下面四条声明各自的 property、duration、delay、timing-function，并指出哪两条最容易被误读。

```css
.a { transition: opacity 1s 200ms ease-in; }
.b { transition: 200ms 1s transform; }
.c { transition: color .2s, background-color .2s; }
.d { transition: all 300ms ease-out 100ms; }
```

<template #answer>

| 规则 | property | duration | delay | timing |
| --- | --- | --- | --- | --- |
| a | `opacity` | 1s | 200ms | `ease-in` |
| b | `transform` | **200ms** | **1s** | `ease`（未写，取初始值） |
| c | `color` 与 `background-color` | 各 0.2s | 各 0s | `ease` |
| d | 所有可过渡属性 | 300ms | 100ms | `ease-out` |

误解最大的是 **b**：属性名写在最后、两个时间值连写，肉眼容易把 200ms 当 delay。第二是 **d**：100ms 延迟加在所有属性上，包括 hover 反馈——鼠标移上去要等 100ms 才有颜色变化，感觉就是「按钮不跟手」。附带一条：a 的 `ease-in` 用在入场上是错的，入场该 `ease-out`。

</template>

</Exercise>

<Exercise title="练习 2 · 预测 fill-mode 的四种结果" difficulty="进阶">

```css
@keyframes slide {
  from { transform: translateX(-100px); opacity: 0; }
  to   { transform: none; opacity: 1; }
}
.el { transform: translateX(20px); opacity: 1; }
.el.run { animation: slide 600ms ease-out 400ms FILL; }
```

分别令 `FILL` 为 `none`、`backwards`、`forwards`、`both`，回答两个时刻的 `transform`：**延迟期间（第 200ms）**与**结束后（第 1200ms）**；再回答把 `animation-direction` 改成 `reverse` 后 `forwards` 的结果。

<template #answer>

| FILL | 第 200ms（延迟期间） | 第 1200ms（结束后） |
| --- | --- | --- |
| `none` | `translateX(20px)`，`opacity: 1`（自身样式）→ **闪** | 回到 `translateX(20px)` → **闪回** |
| `backwards` | `translateX(-100px)`，`opacity: 0`（相关首帧） | 回到 `translateX(20px)` → 仍闪回 |
| `forwards` | `translateX(20px)` → 延迟期间仍闪 | 保持 `translateX(0)`，`opacity: 1` |
| `both` | 首帧态 | 末帧态，两头都不闪 |

`reverse` + `forwards`：`reverse` 从 `100%` 走到 `0%`，所以最后一个相关关键帧是 `0%`，结束后保留 **`translateX(-100px)`、`opacity: 0`**——元素直接消失。这就是「写了 forwards 反而看不见」的标准答案。

</template>

</Exercise>

<Exercise title="练习 3 · 把贵的动画改便宜" difficulty="进阶">

下面是某抽屉组件的样式，逐条改写并说明理由，同时写出你验证改动所用的 DevTools 操作。

```css
.drawer { width: 0; overflow: hidden; transition: width 400ms linear, padding 400ms linear; }
.drawer.is-open { width: 360px; padding: 24px; }
.drawer__shadow { box-shadow: 0 0 24px rgba(0,0,0,.4); transition: box-shadow 400ms; }
.drawer__title { font-size: 14px; transition: font-size 400ms ease; }
.drawer.is-open .drawer__title { font-size: 18px; }
```

<template #answer>

```css
.drawer {
  inline-size: 360px;
  transform: translateX(-100%);
  visibility: hidden;
  transition: transform 380ms cubic-bezier(0.2, 0, 0, 1), visibility 0s linear 380ms;
}
.drawer.is-open { transform: none; visibility: visible; transition-delay: 0s; }
.drawer__shadow { opacity: 0; transition: opacity 200ms ease-out; }
.drawer.is-open .drawer__shadow { opacity: 1; }
.drawer__title { font-size: 16px; }
```

- `width` → `translateX(-100%)`：从每帧重排降到只走合成；`padding` 过渡一并删掉，间距交给固定宽度下的布局。
- `box-shadow` 过渡 → 阴影常驻、用一层覆盖物的 `opacity` 控制出现：阴影重绘区远大于元素。
- `font-size` 过渡**去掉**：字号过渡触发整段文字重排，「字在慢慢长大」看起来像渲染故障。要强调就改字重或颜色。
- `linear` → `cubic-bezier(0.2, 0, 0, 1)`：位移动画匀速会显得机械且不减速。

验证：开 Rendering > Paint flashing，改动前后各播放一次——预期改动前抽屉与相邻内容每帧闪烁，改动后闪烁消失或只剩抽屉自身；再用 Performance 录 3 秒比较紫色 Layout 条总时长。`visibility` 那条是**必需的**，否则关闭状态下抽屉仍挡在屏幕上吃掉点击。

</template>

</Exercise>

<Exercise title="练习 4 · 故意制造一次闪回并解释" difficulty="挑战">

下面这段做「卡片列表错开入场」，说明它为什么**必然出现第一帧闪烁**，再给出两种修法（不引入 `!important`、不引入新 JS，其中一种依赖较新特性）。

```css
.card { opacity: 0; }
.card.is-in { animation: card-in 420ms ease-out; animation-delay: calc(var(--i) * 70ms); }
@keyframes card-in { to { opacity: 1; } }
```

<template #answer>

**现象**：延迟期间卡片已是「可见但透明」且占着高度的状态，页面像被按住不动，然后突然淡入。

**根因**：`animation` 简写没写 `fill-mode`，取初始值 `none`——规范定义「动画不在执行时不给目标应用任何样式」。延迟期间用的是 `.card { opacity: 0 }`，动画开始后才跳到首帧，两段之间没有插值关系。

**修法一（零新特性）**：改成 `animation: card-in 420ms ease-out both;`。`both` 延迟期间锁首帧、结束后锁末帧。副作用要写注释：结束后 `opacity: 1` 由动画 origin 保持，会压过后续对该属性的 `transition`；若卡片之后还要 hover 变透明度，改用 `forwards` 并在 `animationend` 里清掉 `animation`。

**修法二（新特性，不写 animation）**：

```css
.card {
  transition: opacity 420ms ease-out, transform 420ms var(--ease-out);
  transition-delay: calc(var(--i) * 70ms);
  @starting-style { opacity: 0; transform: translateY(16px); }
}
```

常态即终态，只在 `@starting-style` 里给起点，连 class 都不用加。代价是它属于较新特性（MDN 标 Baseline 2024），不支持时卡片直接出现——降级效果可接受，但这点**必须写进注释**，否则下一个人以为动画坏了。

**为什么没有 `!important` 解**：闪烁不是层叠竞争造成的，加权重改变不了 fill-mode 的时间语义。第一反应是 `opacity: 0 !important` 的话，回到[选择器与特异性](/css/selectors)的「`!important` 的真实位置」。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN · `animation-fill-mode`](https://developer.mozilla.org/en-US/docs/Web/CSS/animation-fill-mode) —— 核实 `fill-mode` 四值定义、「动画期间创建的层叠上下文会保留」「被动画的属性表现得像已包含 `will-change`」。
- [CSS Animations Level 1（W3C）](https://www.w3.org/TR/css-animations-1/) —— 核实「动画数量由 `animation-name` 决定、值列表不足则重复、多余值不使用」，即多动画叠加一节。
- [MDN · `animation`](https://developer.mozilla.org/en-US/docs/Web/CSS/animation) —— 核实八个分量与初始值、`animation-timeline: auto`、`name` 放最后的推荐、「后声明的动画覆盖前者」。
- [MDN · Animatable properties](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animated_properties) —— 核实「除非另有说明所有属性都可动画」、四类插值方式、离散值在 50% 翻转、注册与未注册自定义属性之差。
- [MDN · `transition-behavior`](https://developer.mozilla.org/en-US/docs/Web/CSS/transition-behavior) 与 [`@starting-style`](https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style) —— 核实 `allow-discrete` 的翻转时机、「过渡默认不在首次样式更新时触发」与 Baseline 2024 状态（现象一的根因）。
- [MDN · `animation-timing-function`](https://developer.mozilla.org/en-US/docs/Web/CSS/animation-timing-function) —— 核实五个关键字的贝塞尔数值、`steps()` 四种 jump 变体、`linear()` 语法。缓动表的数字全部来自本页。
- [MDN · `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) —— 核实只有 `reduce` / `no-preference`、后者求值为 false、简写等价于 `: reduce`。
- [MDN · `will-change`](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change) —— 核实三条警告原文、「用脚本在变化前后开关」的推荐、合法取值清单。
- [Can I use](https://caniuse.com/) —— 核实 `@starting-style`、`transition-behavior`、`linear()` 的目标浏览器支持度；这三项**必须**回这里查。
- [Chrome DevTools 文档入口](https://developer.chrome.com/docs/devtools/) —— Performance / Rendering / Layers 面板的权威说明。**本环境访问不到该域名，本章的面板描述未经核实。**
- 上一章：[响应式设计](/css/responsive-design) —— 断点与偏好类媒体查询；本章的 `prefers-reduced-motion` 正是同一族查询的一员。

## 下一章

上一章[响应式设计](/css/responsive-design)解决了「在不同宽度与偏好下怎么摆」，本章解决「动起来之后怎么写、怎么不卡」。下一章[布局调试方法论](/css/debugging-layout)换一个立场：前 10 章讲怎么写对，它讲写错了怎么找出来。它给一条固定的六步路径（结构 → 包含块 → 盒模型 → 格式化上下文 → 层叠来源 → 外部覆盖），把 Styles、Computed、盒模型图、Flexbox/Grid 检查器、二分禁用规则逐一对应到每一步，再用三个案例跑一遍。本章的合成层与重排/重绘概念，正是第 11 章判断「这是样式问题还是渲染问题」的前提；想先把本章跑起来，回到 [CSS 领域首页](/css/) 查看已完成章节。
