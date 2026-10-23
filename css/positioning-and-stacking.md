# 定位与层叠上下文：z-index 为什么没生效

`position: fixed; inset: 0; z-index: 9999` 的弹窗被一条 64px 的导航压住，你把 9999 改成 999999，没有用——这两个元素**从来就不在同一个比较体系里**。`z-index` 不是全局层号，它只在同一个层叠上下文（stacking context）内被比较；而上下文由谁创建，多半是某个 `transform` 或 `opacity` 顺手决定的，那行代码原本是为了做动画。

同族故障还有三个：`absolute` 元素跑到文档左上角（父元素没定位）；`fixed` 的悬浮按钮跟着页面滚走（祖先有 `transform`）；`sticky` 写完一动不动（父容器 `overflow: hidden`）。它们的共同结构是：**你声明的是「相对谁」和「第几层」，浏览器把它们交给两个算法**——包含块（containing block）算法和层叠上下文算法。两个算法都沿祖先链找答案，而祖先上的声明经常是别的目的留下的。本章给的就是这两条推导链。

<Callout type="info" title="本章的核实方式">

规范类结论已于 2026-10-17 用 WebFetch 对 MDN 与 W3C 草案核实，文末逐条标注对应哪个结论。本任务没有浏览器运行环境，所以**全章不声称在浏览器里跑过**：具体数值一律写成「预期结果是…」并附 DevTools 验证动作。

</Callout>

## 五个 position 值的包含块规则

`top`/`right`/`bottom`/`left`（及简写 `inset`）只回答「离那条边多远」，「哪条边」由包含块给出，选取规则按 `position` 分两套。

| `position` | 脱离常规流 | 包含块取自哪一层 | 偏移基准 | 创建层叠上下文 |
| --- | --- | --- | --- | --- |
| `static` | 否 | 最近的块容器（block container）或建立格式化上下文的祖先的 **content box** | `inset` 完全无效 | 否 |
| `relative` | 否，原位置保留 | 同上，content box | 自身在流中的位置 | 仅当 `z-index` 非 `auto` |
| `absolute` | 是 | 最近非 `static` 祖先的 **padding box**；没有则初始包含块 | 该 padding box 四边 | 仅当 `z-index` 非 `auto` |
| `fixed` | 是 | 视口（分页媒体为 page area），祖先有例外 | 视口边界 | 是，无论 `z-index` |
| `sticky` | 否，留在流中 | 同 `static` 那条规则 | 最近滚动祖先 ∩ 自身包含块 | 是，无论 `z-index` |

三个必须记住的细节：

1. **`absolute` 用 padding box，`static`/`relative`/`sticky` 用 content box。** 给 `position: relative` 的容器加 `padding`，它内部 `absolute` 子元素的 `top: 0` 仍贴在 padding 外缘而不是内容区——这就是「下拉菜单离按钮远了 12px」的来源。
2. **「已定位祖先」的定义是 `position` 不为 `static`**，`relative`/`absolute`/`fixed`/`sticky` 都算。`position: static` 配 `top: 20px` 是零效果。
3. `relative` 被偏移之后它自己的 padding box 一起搬走，**内部 `absolute` 后代的坐标原点跟着搬**。用 `relative` 当定位垫片时记住这条。

`absolute` 元素的 `inset` 百分比按包含块对应轴向尺寸解析（水平按宽、垂直按高）。这和[第 3 章](/css/box-model)「`margin` 百分比一律按宽度」是两套基准。

## absolute 的查找链，以及找不到祖先时落到哪

`absolute` 的包含块 = 从自己往上**第一个**满足任一条的祖先：

- `position` 不为 `static`；
- `transform`、`rotate`、`scale`、`translate`、`perspective`、`filter`、`backdrop-filter` 任一取非 `none`；
- `contain` 含 `layout` 或 `paint`（包括简写 `strict`、`content`）；
- `will-change` 列了任一「会形成包含块」的属性；
- `content-visibility: auto`。

这份清单对 `fixed` 同样成立。**这就是最高频故障的地基**：`absolute` 和 `fixed` 都可能被一个你根本没打算让它负责定位的祖先接管。

一个真实场景：`.card { position: relative }` 上有 hover 动画 `transform: translateY(-4px)`，卡片角上的 `.card__badge { position: absolute; top: 0; right: 0 }` 会跟着上浮——`.card` 一直是包含块，变化的是坐标原点被偏移。若 `.card` 上没有 `relative` 而是靠 `transform` 接管，徽标原本落在更外层祖先上，hover 后突然跳到卡片角。「一 hover 徽标就跳位」就是这么来的。

整条链都不满足时，包含块落到**初始包含块（initial containing block，ICB）**：尺寸等于视口、位于文档原点的矩形。预期结果是元素出现在文档左上角并**跟着页面滚走**，而不是像 `fixed` 那样钉在屏幕上。这一条是两者最容易被混起来的区别：都以「视口那么大一块」为基准，锚点却在文档上。

验证动作：DevTools 选中元素，在 Computed 面板从自身向上逐级看 `position`、`transform`、`filter`、`will-change`、`contain` 这五项，第一个非默认值的祖先就是包含块。

## inset 简写与 auto margin 居中

`inset` 是 `top`/`right`/`bottom`/`left` 的简写，**物理**方向，不随 `writing-mode`、`direction` 变化；多值顺序同 `margin`（1 到 4 个），接受 `<length>`、`<percentage>` 和 `auto`。要写逻辑方向用 `inset-block-start` / `inset-inline-end`。

居中靠过约束方程：`left + margin-left + border-left + padding-left + width + padding-right + border-right + margin-right + right = 包含块宽度`。当 `left`、`right` 都给值、`width` 明确、两个 `margin` 为 `auto` 时，剩余空间被**平摊给两个 auto margin** → 居中：

```css
.overlay { position: fixed; inset: 0; }                  /* 撑满：最常见的遮罩 */
.dialog  { position: fixed; inset: 0; margin: auto; z-index: 200;
           width: min(92vw, 480px); height: fit-content; }
```

**坑在这里**：把 `width` 去掉试试。非替换的 `absolute`/`fixed` 盒子在 `width: auto` 且 `left`/`right` 都非 `auto` 时，`auto` margin 先按 `0` 解算，盒子**被拉伸填满**——你得到全屏白块而不是居中卡片。所以 `inset: 0; margin: auto` 的前提是两个轴向各有一个明确尺寸。

过约束时谁赢：`top` 与 `bottom` 都给值且高度明确时 `top` 生效；`left`/`right` 都给值且宽度明确时 `ltr` 下 `left` 生效，`rtl` 下 `right` 生效。

## fixed 的包含块被祖先改写

最小复现只要三行：

```html
<div class="scroller"><button class="fab">回到顶部</button></div>
```

```css
.scroller { transform: translateZ(0); min-height: 200vh; }
.fab { position: fixed; right: 1rem; bottom: 1rem; }
```

预期结果：按钮不钉在屏幕右下角，而贴在 `.scroller` 的 padding box 右下角，滚动时跟着内容走——你会得出「悬浮按钮只在不滚动时才悬浮」这种诡异结论。

`transform` 通常不是你手写的。来源就这几类：滚动进场动画库（大量 `will-change: transform`）、hover 缩放、`filter: blur()` 背景虚化、`backdrop-filter` 毛玻璃、性能优化加的 `contain: paint`、`content-visibility: auto`。它们在你不知情时**同时**改写定位基准和层叠归属。工程结论：`fixed` 浮层不要放在被动画接管的子树里。

## sticky 的触发条件与「为什么不生效」

`sticky` 是 `relative` 与 `fixed` 的混合体：留在常规流里，按 `inset` 阈值碰到**最近滚动祖先**的边界时被钉住，直到**自身包含块**的另一边把它推走。两个矩形约束任一不成立，就完全看不出效果。

| 现象 | 原因 | 怎么确认 | 怎么修 |
| --- | --- | --- | --- |
| 一动不动 | 某个轴的 `inset` 全是 `auto` | Computed 看 `top` 是否为 `auto` | 给 `top: 0`。MDN：某轴两个 inset 均为 `auto` 时该轴的 `sticky` 等同 `relative` |
| 一动不动 | 直接父级或更近祖先 `overflow` 非 `visible` | 逐级看 `overflow-x`/`overflow-y` | 换成 `display: flow-root`（[第 4 章](/css/flow-and-bfc)：同样阻断外边距穿透但不建滚动容器） |
| 粘了 0px，像没粘 | 包含块无可滑动余量：父容器高度正好等于 sticky 元素高度 | 量两个高度是否相等 | 让父容器包住更多内容，或把 sticky 上提一层 |
| 横向粘不住纵向正常 | 该轴祖先宽度由内容撑开、无溢出 | 比 `scrollWidth` 与 `clientWidth` | 给祖先显式宽度或 `min-width: max-content` |
| 页面滚不动、容器内滚才动 | 最近的「有滚动机制的祖先」是那个内部容器 | MDN：粘向 `overflow` 为 `hidden`/`scroll`/`auto`/`overlay` 的最近祖先，**即使它当前并没有真的在滚** | 移到该容器外，或把 `hidden` 换成 `clip`（不建滚动容器但会裁剪） |
| 粘住后被后续内容盖住 | sticky 无条件创建层叠上下文，内部 `z-index` 出不去 | 见下文清单 | 给 sticky 元素**本身**设 `z-index` 档位 |

`overflow-x: hidden` 会连带把 `overflow-y` 计算成 `auto`（[CSS Overflow](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow) 的计算规则，本站[第 4 章](/css/flow-and-bfc)处理过），所以「为了治横向溢出写的 `overflow-x: hidden`」经常就是 sticky 失效的元凶。

<Callout type="unverified" title="flex 或 grid 子项上的 sticky">

「flex row 容器里的 sticky 子项要先被交叉轴拉伸到满尺寸才能纵向粘住」在社区文章里流传很广，但我没在 MDN 或 W3C 草案上核实到对应条文，不作为结论给出。遇到这种组合先在目标浏览器验证。

</Callout>

## 层叠上下文：创建条件清单

以下任一成立，该元素就创建新的层叠上下文（清单来自 MDN《The stacking context》）：

- 文档根 `<html>`；
- `position: absolute` 或 `relative` 且 `z-index` 不为 `auto`；
- `position: fixed` 或 `sticky`（**无论 `z-index`**）；
- `container-type` 为 `size` 或 `inline-size`（见[第 9 章](/css/responsive-design)）；
- flex 或 grid 容器的**子项**且 `z-index` 不为 `auto`；
- `opacity` 小于 `1`；`mix-blend-mode` 不为 `normal`；
- 以下任一取非 `none`：`transform`、`scale`、`rotate`、`translate`、`filter`、`backdrop-filter`、`perspective`、`clip-path`、`mask` / `mask-image` / `mask-border`；
- `isolation: isolate`；
- `will-change` 列了任一「非初始值即创建上下文」的属性；
- `contain` 含 `layout` 或 `paint`（包括 `strict`、`content`）；
- 被放入顶层（top layer）的元素及其 `::backdrop`，如全屏与 `popover` 元素；
- 用 `@keyframes` 动画过上述某属性且 `animation-fill-mode: forwards`。

对照前一节的包含块清单：`transform` / `filter` / `will-change` / `contain` **两边都在**。一行 `transform: translateZ(0)` 同时改掉你的定位基准、层叠归属和绘制顺序归属——这就是「改了一行看不懂的动画代码，弹窗层级全乱」的机制解释。

## 上下文内部的绘制顺序

同一上下文内，从底到顶七层：

1. 上下文根元素自己的背景与边框；
2. `z-index` 为负的子层叠上下文，按 `z-index` 升序；
3. 常规流中的**块级**盒（非定位），按树序；
4. 浮动，按树序；
5. 常规流中的**行级**内容（行盒、文本、替换元素），按树序；
6. `z-index: auto` 或 `0` 的定位元素，以及 `z-index: 0` 的子上下文，按树序；
7. `z-index` 为正的子上下文，按 `z-index` 升序。

这张表解释三个「反直觉但正确」的现象：

- **负 `z-index` 元素消失**：它落到第 2 层，若祖先没创建上下文就掉在 `<html>` 背景之上、常规流块盒之下，被父背景盖住。修法是给父级 `isolation: isolate`。
- **`z-index` 对 `static` 无效，但对 flex/grid 子项有效**：后者在第 6/7 层参与排序，非 `auto` 还创建上下文。
- **不定位的兄弟盖不住定位的兄弟**：前者第 3 层，后者只要 `z-index` 非负就至少第 6 层。所以「给普通块写 `z-index: 1`」是空话，必须同时 `position: relative`，或让它成为 flex/grid 子项。

## z-index 只在自身上下文内比较：完整复现

这一页可以单独存成文件打开，稳定复现「9999 被压住」。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>z-index 9999 为什么被压住</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  .topbar {
    position: relative;   /* 定位 + 非 auto z-index → 创建层叠上下文 */
    z-index: 100;
    height: 64px;
    background: #0f172a;
    color: #fff;
  }
  .content {
    transform: translateZ(0);   /* 就这一行，同时改写包含块与层叠归属 */
    min-height: 200vh;
    padding: 2rem;
    background: #f8fafc;
  }
  .modal {
    position: fixed;
    inset: 0;
    margin: auto;
    z-index: 9999;
    width: min(90vw, 420px);
    height: 240px;
    padding: 1.5rem;
    background: #fff;
  }
</style>
</head>
<body>
  <nav class="topbar">顶部导航（z-index: 100）</nav>
  <main class="content">
    <p>正文区。它的 <code>transform: translateZ(0)</code> 来自某个滚动动画库。</p>
    <div class="modal">弹窗：position: fixed + z-index: 9999</div>
  </main>
</body>
</html>
```

预期结果：弹窗被 `topbar` 压住一条边，而且它不贴在屏幕正中（居中基准是 `.content` 的 padding box），滚动时跟着滚走。

逐层判断（用 MDN 的「版本号」类比：`父序号-子序号`，先比父）：

| 步骤 | 判断 | 结果 |
| --- | --- | --- |
| 1 | `.modal` 是 `fixed`，本应以视口为包含块，但祖先 `.content` 有 `transform: translateZ(0)` | 包含块 = `.content` 的 padding box，定位先错一次 |
| 2 | 谁为 `.modal` 创建上下文？`.content`（`transform` 非 `none`） | `9999` 只能在 `.content` 内部起作用 |
| 3 | `.content` 属于 root 上下文，本身未定位、`z-index` 为 `auto` | `transform` 让它作为**原子整体**参与比较，等效序号 `0` |
| 4 | `.topbar` 是 `relative` + `z-index: 100`，也在 root 上下文 | 序号 `100` |
| 5 | 比较发生在 root 上下文：`0-9999` 对比 `100-…` | `100` 赢，弹窗被压住 |

三条修法，按推荐度：**A** 把浮层移出被污染的子树（框架 portal，或原生 `popover` 进顶层）——唯一让 `9999` 真的当 `9999` 用的办法。**B** 删掉 `.content` 上那行 `transform`：如果它是动画库为了「GPU 加速」加的，它现在什么也没加速，只是把你的弹窗埋了。**C** 给 `.content` 加 `position: relative; z-index: 101`：能修但最脆弱，你在给一个本不该参与全局层级竞争的容器分配全局层级，下一个 `transform` 出现就重来；选 C 就把原因写进注释。

MDN 的创建清单点名了 fullscreen 与 popover 两类顶层元素；模态 `<dialog>` 同样进入顶层这一点本章未单独核实，用前查文档。

## z-index: auto 与 z-index: 0 的区别

两者在**定位**上完全等价，差别只在层叠：

| 写法 | 是否创建层叠上下文 | 内部定位后代的 `z-index` 能否参与外层比较 |
| --- | --- | --- |
| `position: relative; z-index: auto` | 否 | 能——回到祖先的上下文比较 |
| `position: relative; z-index: 0` | 是 | 不能——全被封在里面 |

两者都在第 6 层，所以它们彼此按树序；区别只体现在**子孙能不能越级**。例外：`position: fixed`/`sticky` 无条件创建上下文，与 `z-index` 无关；flex/grid 子项同样是 `auto` 不创建、非 `auto` 创建。

实际含义：组件用 `auto`，它内部某个 `z-index: 50` 的浮层就会越级跑到外面跟全局比；改成 `0` 后被关住，越级消失，但那个本该盖住一切的浮层也可能盖不住了。**这就是「加了一行毫不相干的 `z-index: 0`，另一个组件的 tooltip 掉到内容下面」的原因。**

## isolation: isolate 是工程手段

`isolation: isolate` 只创建层叠上下文，不改变视觉、不改变包含块，比 `opacity: .999` 或 `translateZ(0)` 干净得多。

它解决的是**组件向外**的问题：在设计系统的组件根上写 `isolation: isolate`，内部所有 `z-index` 被封住，不污染宿主页面。**它不解决组件向上**的问题：自己的浮层被外面压住时，`isolate` 只会关得更牢。两个方向分清——怕内部层级影响别人 → `isolate`；怕别人压住我的浮层 → 移出这个子树（portal / top layer）。

配合[第 8 章](/css/units-and-custom-properties)的设计令牌：`z-index` 也该做成有限档位（`--z-dropdown` < `--z-sticky` < `--z-overlay` < `--z-modal` < `--z-toast`）。冲突就从「数字比大小」变成「档位语义对不对」，`9999` 这种数字在 code review 里可以直接打回。

## order 与视觉顺序、Tab 顺序不一致

`order` 只改 flex/grid 的**视觉**排列，不改 DOM 顺序；而 Tab 焦点顺序、屏幕阅读器朗读顺序都跟着 DOM 走。于是把「上一个 / 下一个」用 `order` 调换，键盘用户 Tab 出来的顺序和眼睛看到的就反了。同类手段还有 `grid-template-areas`、负 `margin`、`top`/`left` 定位——都是「只搬视觉不搬文档」。

风险按场合分：表单字段（提交按钮被搬到顶部，Tab 却先走完所有字段）、导航项（读屏顺序与视觉不符，站内口径见 [HTML 无障碍](/html/accessibility)）都有真实危害；图库、指标卡这类顺序不承载语义的排列通常无害。规则：**顺序承载语义的地方保持 DOM 顺序 = 视觉顺序**，需要挪位置就改 HTML 本身。

验证动作：不用 DevTools，直接按 Tab 走一遍，看焦点框是否按视觉顺序移动。这个测试 30 秒，能抓出一整类问题。

## 常见错误与排查

### 症状：absolute 元素跑到文档左上角，还跟着页面滚

原因：祖先链上没有非 `static` 定位、也没有 `transform` 类替代者，包含块落到 ICB。怎么确认：Computed 面板逐级看祖先 `position`/`transform`/`filter`/`will-change`/`contain`。怎么修：给语义上该包住它的容器加 `position: relative`——必须是**同一组件**的根，不是随手抓一个最近的块元素，否则[第 9 章](/css/responsive-design)的容器查询会一起错位。

### 症状：z-index 数字已经很大，仍然被压住

原因：祖先创建了层叠上下文，数字只在内部有效。怎么确认：从被压元素向上逐级查 `transform`/`filter`/`backdrop-filter`/`will-change`/`contain`/`opacity`（是否小于 1）/`isolation`/`container-type`，命中任意一条即找到边界。怎么修：优先移出该子树（portal / top layer），不要抬数字。

### 症状：fixed 的悬浮按钮滚动时跟着走

原因：祖先 `transform`/`filter`/`will-change: transform`/`contain: layout` 接管了包含块。怎么确认：临时把怀疑祖先的 `transform` 改成 `none`，按钮立刻归位即确诊。怎么修：把 `fixed` 元素移到 `<body>` 直接子级，或让动画只作用于容器内部的子元素。

### 症状：sticky 完全不生效

原因按概率：`inset` 全 `auto`（等价于没给偏移，等于不粘）；祖先 `overflow` 非 `visible` 让滚动容器换了人；父容器高度正好等于 sticky 元素高度，没有可粘的行程；最近的滚动祖先是某个内部容器而非页面。怎么确认：先看 Computed 的 `top` 是否 `auto`，再向上找**第一个** `overflow` 非 `visible` 的祖先，再量父容器与自身的高度差。怎么修：补上 `top` 之类的偏移值；把用来 clearfix 的 `overflow: hidden` 换成 `display: flow-root`（它不创建滚动容器），并让父容器真正包住后续内容。

### 症状：inset: 0 加 margin: auto 之后撑满而不是居中

原因：`width`（或 `height`）是 `auto`，盒子被拉伸、`auto` margin 解为 `0`。怎么确认：Computed 看 `width` 是否等于包含块宽度。怎么修：两个轴向都给明确尺寸，高度用 `height: fit-content`。

### 症状：负 z-index 的元素直接消失

原因：它被画到第 2 层，祖先没创建上下文，于是被父元素背景盖住。怎么确认：改成 `z-index: 0` 就出现。怎么修：给父元素 `isolation: isolate`，把比较收进父级。

### 症状：下拉菜单被下一个 section 的标题盖住

原因：那个 section 上有 `transform`（进场动画初始态）或 `opacity: .99`，于是它作为**一个整体**被提升成层叠上下文，内部的 `z-index` 全被关起来与兄弟比较，而它与菜单之间只在父上下文里比。菜单挂在自己上下文内的第 9999 层，跨上下文时这些数字不参与比较。怎么确认：在 DevTools 里禁用该 section 的 `transform`，菜单立刻浮上来。怎么修：给菜单所在容器一个明确的 `z-index` 档位，或把菜单挂到 `<body>`；同时把动画库的初始 `transform` 换成 `opacity` + `visibility`——`opacity: 0` 同样创建上下文，但至少不改变包含块。

### 症状：Tab 焦点在页面上乱跳

原因：`order`、负 `margin` 或定位把视觉顺序和 DOM 顺序解开了。怎么确认：按 Tab 走一遍并记录顺序，与肉眼顺序对照。怎么修：改 HTML 结构本身、撤掉视觉重排手段。

## 练习

<Exercise title="练习 1 · 预测包含块" difficulty="基础">

写出 `#tip` 的包含块是哪个元素、取自哪一层，以及 `top: 0; left: 0` 的落点。再回答第二问：把 `#card` 的 `filter` 换成 `position: relative`，`#tip` 的位置会变吗？

```html
<div id="page"><div id="card"><div id="tip"></div></div></div>
```

```css
#page { position: static; padding: 40px; }
#card { position: static; padding: 24px; filter: drop-shadow(0 2px 2px rgba(0,0,0,.3)); }
#tip  { position: absolute; top: 0; left: 0; }
```

<template #answer>

包含块是 `#card`，取它的 **padding box**。`#card` 的 `position` 是 `static`，本来不合格，但 `filter` 取了非 `none` 值，按规范它照样形成包含块。`top: 0; left: 0` → `#tip` 落在 `#card` 的 padding box 左上角，会盖在它的 padding 区域上（padding 属于 padding box 内侧，不会被退让到内容区）。

第二问：**位置不变，机制变了。** `position: relative` 同样让 `#card` 成为 padding box 包含块，坐标一致。变的是副作用：`relative` 要有 `z-index` 非 `auto` 才创建上下文（此时不创建），而 `filter` **无条件**创建上下文。所以换成 `relative` 之后 `#card` 内部的 `z-index` 反而更自由。这一问的考点就是：包含块清单与层叠上下文清单是两份**交集很大但不相同**的清单。

</template>

</Exercise>

<Exercise title="练习 2 · 排出绘制顺序" difficulty="进阶">

`body` 内六个元素按给出的顺序并列（`.g` 是 `.d` 的子元素）。写出从最底到最顶的绘制顺序，并回答第二问。

```css
.a { }                                          /* 普通块盒 */
.b { float: left; width: 100px; height: 40px; }
.c { position: relative; z-index: auto; }
.d { position: relative; z-index: 0; }
.e { position: relative; z-index: -1; }
.f { display: flow-root; }                      /* 普通块盒，内有文本 */
.g { position: absolute; z-index: 5; }
```

第二问：把 `.d` 改成 `z-index: auto`，`.g` 的位置会怎么变？

<template #answer>

root 上下文内按七层：第 1 层 `<html>`/`body` 背景 → 第 2 层 `.e`（负 `z-index` 上下文）→ 第 3 层常规流块盒按树序 `.a`、`.f` → 第 4 层浮动 `.b` → 第 5 层行级内容（`.f` 内文本、裸文本节点）→ 第 6 层 `z-index` 为 `auto`/`0` 的定位元素按树序 `.c`、`.d` → 第 7 层：root 层没有正 `z-index` 的（`.g` 不在这里）。

于是 `.e` 在 `.a` 与 `.f` 的**背景之下**：只要 `.a` 有背景色 `.e` 就看不见。这正是「负 z-index 消失」那条错误的成因。

第二问：`.d` 改成 `auto` 后不再创建上下文，`.g` 回到 root 上下文、`z-index: 5` 被排到第 7 层 → **盖住 `.a`～`.f` 全部**，包括 `.c`。而 `z-index: 0` 时 `.g` 的序号是 `0-5`，被封在 `.d` 里，root 层任何 `z-index >= 1` 的东西都能压住它。**这就是 `auto` 与 `0` 的唯一实际差别：子孙能不能越级。**

</template>

</Exercise>

<Exercise title="练习 3 · 故意让 sticky 失效" difficulty="进阶">

下面这个吸顶工具栏预期贴住视口顶部，实际一动不动。给出**三个互相独立**的失效原因（每个都能单独致失效），说明 DevTools 里怎么逐条确认，以及各自修法。

```html
<div class="page"><div class="section"><div class="toolbar">工具栏</div><div class="body-text">很长的正文</div></div></div>
```

```css
html, body { margin: 0; }
.page    { overflow-x: hidden; }
.section { overflow: hidden; }
.toolbar { position: sticky; top: 0; background: #fff; }
```

<template #answer>

**原因 1：`.section { overflow: hidden }`。** sticky 粘向最近的「有滚动机制的祖先」，`hidden` 属于这一类。工具栏只能在 `.section` 这个此刻并不真滚的容器内粘，页面滚动时它跟着 `.section` 走。确认：把 `overflow` 改 `visible`，立刻生效即确诊。修：换成 `display: flow-root`。

**原因 2：`.page { overflow-x: hidden }` 连带把 `overflow-y` 计算成 `auto`。** 一个轴为 `hidden`/`clip`、另一轴为 `visible` 时，`visible` 会被计算成 `auto`。`.page` 因此成为比 `<html>` 更近的滚动容器。确认：读 `.page` 的 computed `overflowY`，预期得到 `auto` 而不是你写的 `visible`。修：别用 `overflow-x: hidden` 治横向溢出，改成给溢出源本身加 `max-width: 100%` 或 `overflow-wrap: anywhere`。

**原因 3：约束矩形没有余量。** 若 `.section` 因 `overflow: hidden` 实际只包住工具栏与可见内容，sticky 可用滑动空间为 0，于是「粘 0 像素」。单独复现：给 `.toolbar` 的父级一个恰好等于它自身高度的 `height`。修：让 sticky 元素的父级包住它之后的所有内容。

补充一条「看着像 bug 其实是特性」：粘住之后被后面某个带 `transform` 的面板盖住。sticky 无条件创建上下文，需要**它自己**有 `z-index` 才能排在后续内容之上——给工具栏一个 `--z-sticky` 档位，而不是给内部元素加 `9999`。

</template>

</Exercise>

<Exercise title="练习 4 · 定位一个下拉菜单" difficulty="挑战">

按钮在带 hover 缩放动画的卡片里。要求：菜单必须盖住卡片之后的所有内容、随按钮移动、且在 `direction: rtl` 的镜像版本里也正确。写出 CSS 并说明两个关键选择。

```html
<div class="card"><button class="trigger">操作</button><ul class="menu"><li>重命名</li><li>删除</li></ul></div>
```

```css
.card { position: relative; transition: transform .2s; }
.card:hover { transform: scale(1.02); }
.menu { list-style: none; margin: 0; padding: .5rem; background: #fff; }
```

<template #answer>

```css
.menu {
  position: absolute;
  inset-block-start: 100%;   /* 逻辑属性：rtl 与竖排下仍表示「按钮那条边之后」 */
  inset-inline-start: 0;     /* 替代 left: 0 */
  z-index: 1;                /* 让菜单成为上下文，把内部层级封住 */
}
```

**选择 1：逻辑属性而不是 `inset` 简写。** `inset` 是**物理**方向（MDN 明确写了它不随 writing-mode / directionality 变化），rtl 下 `left: 0` 会把菜单贴到错误的角。

**选择 2：`z-index: 1` 而不是 `z-index: 9999`。** 卡片有 `transform`，它既是包含块改写者又是上下文创建者，菜单的层级只在 `.card` 内部有意义。真要盖住**别的卡片**，唯一可靠做法是把菜单移出 `.card`（portal 或 `popover`），否则就得给这张卡片一个更高的全局档位。给 `.menu` 非 `auto` 的 `z-index` 是防御性做法：它创建上下文，把二级子菜单的 `z-index: 2` 封在内部，不会越级影响别的卡片。

**顺带一条**：`scale(1.02)` 只在 hover 时出现，会改变坐标原点，菜单跳 1～2px。这不是 bug，是包含块跟着变换走的必然结果。修法是把缩放挪到卡片内部的包装层，让 `.card` 始终不带 `transform`。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN `position`](https://developer.mozilla.org/en-US/docs/Web/CSS/position) —— 核实五个定位值的偏移基准、`static` 下 `inset` 无效、sticky「某轴两个 inset 均为 `auto` 时该轴等同 `relative`」、`fixed` 被祖先 `transform`/`perspective`/`filter`/`will-change: transform` 改写包含块，以及过约束时 `top` 与 `left`（`rtl` 下 `right`）获胜（2026-10-17）。
- [MDN Containing block](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Containing_block) —— 核实那张表（`static`/`relative`/`sticky` 取 content box、`absolute` 取最近非 `static` 祖先的 padding box、无祖先时落到 ICB），以及「`position: static` 但带 `transform`/`filter`/`backdrop-filter`/`contain`/`will-change`/`content-visibility: auto` 的祖先仍然形成包含块」的完整清单（2026-10-17）。
- [MDN The stacking context](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_positioning/Understanding_z_index/The_stacking_context) —— 核实创建条件全清单（含 `container-type`、`isolation`、`mix-blend-mode`、`animation-fill-mode: forwards`、top layer）与「`0` 会创建、`auto` 不会」「子上下文序号只在其父上下文内有意义」（2026-10-17）。
- [CSS 2.1 附录 E 层叠呈现模型](https://www.w3.org/TR/CSS21/zindex.html) —— 七层绘制顺序的规范来源；[CSS 2.2 §9 视觉格式化](https://www.w3.org/TR/CSS22/visuren.html) 是同一主题的现行整理版。
- [MDN `inset`](https://developer.mozilla.org/en-US/docs/Web/CSS/inset) —— 核实 `inset` 为**物理**方向、1 到 4 值顺序同 `margin`、接受 `auto` 与百分比且百分比按包含块对应轴向计算。
- [MDN `contain`](https://developer.mozilla.org/en-US/docs/Web/CSS/contain) —— 核实 `layout`/`paint`/`strict`/`content` 会为 `absolute` 与 `fixed` 后代创建包含块。
- [MDN `isolation`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/isolation) 与 [MDN `will-change`](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change) —— 前者核实 `isolate` 只创建上下文、无其他副作用；后者核实 `will-change: transform` 等价于提前创建包含块与上下文。
- [MDN `overflow`](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow) 与 [MDN 块级格式化上下文](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_display/Block_formatting_context) —— 核实 `overflow-x/y` 互相牵动的计算规则，以及用 `display: flow-root` 替代 `overflow: hidden` 的依据。
- [MDN Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API) —— 修法 A「用顶层替代 z-index 军备竞赛」的入口；模态 `<dialog>` 是否同样进入顶层请查此文档。
- [Can I use: position: sticky](https://caniuse.com/css-sticky) —— 动手前核实目标浏览器支持度。
- 上一章：[Flexbox](/css/flexbox) 与 [Grid](/css/grid) —— 本章解释为什么这两种布局的子项上 `z-index` 也有效，以及 `order` 的来源。

## 下一章

定位算的是「相对哪条边」，单位算的是「那条边有多长」。[第 8 章 值、单位与自定义属性](/css/units-and-custom-properties) 讲清 `em` 与 `rem` 各自的解析基准（以及嵌套 `em` 的复利）、移动浏览器 `vh` 的地址栏问题、`clamp()` 三项各自扮演什么角色，然后把颜色、字号、间距、阴影和 `z-index` 档位一起收进设计令牌（design token）——你上一份 `z-index: 9999` 的正确归宿，是一个叫 `--z-modal` 的语义档位。回到 [CSS 领域首页](/css/) 可查看本领域全局路线。
