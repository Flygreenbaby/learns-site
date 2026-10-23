# 常规流与格式化上下文：容器为什么塌陷，BFC 到底管什么

## 先做三个预测

一个只有浮动子元素的容器：

```html
<div class="card"><span class="f"></span></div>
```

```css
.card { width: 300px; background: #e0e0ff; }
.f    { float: left; width: 100px; height: 80px; }
```

1. `.card` 的高度是多少？
2. 给 `.card` 加 `overflow: clip`，高度会变吗？
3. 在 `.card` **后面**放一个 `clear: both` 的兄弟元素，`.card` 的高度会恢复吗？

| 问题 | 常见预测 | 实测结果 |
| --- | --- | --- |
| 1. 容器高度 | 80（被子元素撑起来） | **0** |
| 2. 加 `overflow: clip` | 变成 BFC，能撑起来 | **仍然 0**，而且浮动内容被裁掉、无法命中 |
| 3. 后面加 `clear: both` 的兄弟 | 容器被顶开、恢复 80 | 容器**仍 0**；兄弟元素的顶边正好贴在浮动底边（1180 = 1180），位置对了，容器背景依然什么都没盖住 |

第 2 条和第 3 条是本章的重点。它们分别推翻了两个流传很广的简化说法——「`overflow` 只要不是 `visible` 就能包住浮动」和「浮动出问题就在后面加个 `clear`」。

<Callout type="verified" title="本章实测说明">

方法与环境同第 1、2、3 章：静态页面 + `getBoundingClientRect()` / `getComputedStyle()` / `elementFromPoint()`，Qoder 内置浏览器（`Chrome/150.0.7871.114` + `Electron/43.1.1`）、Windows 10 x64、DPR 1.25、视口 638px，核实于 2026 年 10 月 16 日。

两个探针设计上的坑值得写出来，因为它们正是这类 bug 的成因：

- **浮动会污染后续用例。** 第一版探针把十个用例直接顺着写在同一页里，结果第一个容器里的浮动逃出了容器（父盒没建立 BFC），后面的用例全部被它挤偏——`#t2b` 里本该「被挤窄」的块盒读到了 `x=200`、`#t2c` 读到 `x=300`。重写后把**每个用例包进一个 `display: flow-root` 的 `<section>`**，让上一题的浮动无法泄漏到下一题，读数才与规范一致。
- **等宽会让用例退化。** 有一个「行盒被浮动挤窄」的用例，我把浮动设成 300px 宽、被测块盒也是 300px 宽，实测行盒 `x=0`、宽度 288——看着像「浮动没起作用」。真实原因是剩余空间为 0，所有行盒整体掉到浮动下方。改成浮动 100px 之后，才测出预期的「块盒 `x=0`、行盒 `x=100`」。

结论层面我只写这两次实测能支撑的部分；`contain` 的其他取值、旧浏览器行为等在正文里明确标注为未实测。

</Callout>

## 常规流先把两件事分开：块盒铺满，行盒避让

「常规流」（normal flow）在规范里是 [CSS 2.2 §9.4](https://www.w3.org/TR/CSS22/visuren.html#visual_box_model) 描述的默认排布规则：块级盒子沿包含块顶部依次竖着排，行内内容组成行盒（line box）。浮动不属于常规流，但它**不改变块盒的尺寸规则，只改变行盒的可用宽度**。

把 `width: auto` 的普通块盒、`width: 300px` 的普通块盒，分别放在一个 100px 宽的左浮动旁边，实测：

| 被测元素 | 边界盒 x | 边界盒宽度 | 行盒 x | 行盒宽度 |
| --- | --- | --- | --- | --- |
| 容器 400px，块盒 `width: auto` | 0 | **400**（铺满） | 100 | 192 |
| 容器 638px，块盒 `width: 300px` | 0 | **300** | 100 | 192 |

两个表格里最关键的对比是：**块盒自己的边界盒从不被浮动挤窄**（`x=0`、宽度按常规流规则算），被挤窄的是它内部的**行盒**（`x` 从 0 跳到 100）。

这就是为什么这段代码的表现总反直觉：

```css
.card { background: #cfc; }        /* 没有设宽度 */
```

`.card` 的背景会铺满整行，一直伸到浮动底下，看起来像「背景被图片压住了」。不是 bug：背景画在块盒边界盒上，而边界盒不受浮动影响。

顺带一条同源规则：如果给元素写了**显式宽度**，那么即使它是 BFC 根，也**不会被挤窄，只会被整体位移**。实测（左浮动 100px，块盒 `width: 300px`、`overflow: hidden`）：

| 声明 | 边界盒 x | 边界盒宽度 | 效果 |
| --- | --- | --- | --- |
| `overflow: hidden`（BFC） | **100** | 300 | 位移，宽度不变，必要时溢出包含块 |
| `display: flow-root`（BFC） | **100** | 300 | 同上 |
| `width: auto` + `overflow: hidden`（容器 400px） | **100** | **300** | 精确挤窄到剩余空间 |

只有把宽度交还给 `auto`，BFC 才能真正「贴着浮动排」。这一条解释了老式两栏布局为什么要写 `overflow: hidden` **并且不写宽度**。

## 浮动到底做了哪几件事

把散落在各处的规则收拢成六条，全部有实测支撑。

**1. 脱离常规流，不给父盒贡献高度。** 开头那一问就是这个：容器 `height: 0`。

**2. `display` 被块级化。** `<span style="float: left">` 的 computed `display` 是 **`block`**（实测），不需要先改成块盒才能设宽高。规范出处见 [CSS 2.2 §9.5.1](https://www.w3.org/TR/CSS22/visuren.html#floats)。

**3. 同向浮动并排，放不下就整体往下掉。** 容器 400px，三个 `float: left; width: 180px` 的块实测：

| 元素 | x | y | 说明 |
| --- | --- | --- | --- |
| 第 1 个 | 10 | 70 | 贴左边缘 |
| 第 2 个 | 190 | 70 | 紧接第 1 个右边缘（190 = 10 + 180） |
| 第 3 个 | 10 | **110** | 180×3 = 540 > 400，掉到下一排并回到左边缘 |

浮动换行时**对齐的是当前可用的最高浮动边缘**，这也是「浮动布局里第三个元素掉到不齐的位置」的经典成因。

**4. 行盒避让，块盒不避让。** 见上一节。

**5. `clear` 只搬动自己。** 实测：容器里只有一个浮动（`height: 80`），容器后面紧跟一个 `clear: both; height: 40` 的兄弟。

| 读数 | 值 |
| --- | --- |
| 容器高度 | **0** |
| 浮动底边 | 1180 |
| 清除元素顶边 | **1180**（与浮动底边完全重合） |

清除元素被正确搬到了浮动下方，但**父容器的高度没有被救回来**——它的背景、边框、点击区域仍然是 0 高。所以「后面加个 `clear` 就好了」只解决了视觉上的堆叠，没解决容器塌陷。

**6. 浮动上的 `auto` 外边距不居中。** `float: left; width: 100px; margin-left: auto; margin-right: auto` 在 400px 容器里实测 `x=10`（即容器的内容左边缘），两个 auto 都归 0。居中要用别的手段（第 3 章的 `margin: 0 auto` 只对**常规流里的块盒**有效）。

还有一条值得记住：**`float` 在 Flexbox 和 Grid 容器里会被完全忽略**。实测容器 400px，子元素分别写 `float: left` / `float: right`：

| 容器 | 子 1 x | 子 2 x | 子 2 的 computed `display` |
| --- | --- | --- | --- |
| `display: flex` | 10 | **110**（紧挨着子 1，没有被推到右） | `block`（被块级化成 flex item） |
| `display: grid; grid-template-columns: 1fr 1fr` | 10 | **210**（落在第二列） | `block` |

写 `float: right` 却放进 flex 容器里，浮动不生效、也不会报错——这是迁移老代码时最常见的「样式写了但没反应」。

## 格式化上下文到底管什么

规范里，一个**格式化上下文**（formatting context）就是一套排布规则的作用域：块盒在块级格式化上下文（BFC）里竖排，文字与行内盒在行内格式化上下文（IFC）里成行。[CSS 2.2 §9.4.1](https://www.w3.org/TR/CSS22/visuren.html) 定义了 BFC，MDN 的[块级格式化上下文](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_display/Block_formatting_context)给了可操作的清单。

把「BFC 有什么用」说成一个开关是最常见的误解。它其实是**四条边界规则**，而且每一条都能测：

| BFC 根的行为 | 实测证据 |
| --- | --- |
| ① 包含内部的浮动（浮动撑得起它的高度） | 见下一节的对照表：`flow-root` / `hidden` / `auto` 等 → 80 |
| ② 不与**子孙**的外边距折叠（子的顶边留在自己家里） | 普通父盒：子相对父顶偏移 **0**、父高 **20**；`flow-root` 父盒：偏移 **20**、父高 **40** |
| ③ 自身的边界盒不与浮动重叠（宁可变窄/位移） | `width: auto` 时 `x=100 w=300`（挤窄）；`width: 300px` 时 `x=100 w=300`（位移） |
| ④ **不改变**它作为块盒参与外部折叠的身份 | 两个 `flow-root` 兄弟，`margin-bottom: 20` 与 `margin-top: 30` 相邻 → 实测间距仍是 **30**（照常折叠） |

第 ④ 条最容易被忽略：建立 BFC 只影响「盒子内部」和「盒子与浮动的关系」，它不会让外边距折叠消失。第 3 章讲的兄弟折叠规则对 BFC 根照样适用。

另外，**BFC 内部照样折叠**：实测一个 `flow-root` 父盒里两个子元素（`margin-bottom: 20` / `margin-top: 30`），子间距是 30，父盒总高 70 = 20 + 30 + 20。BFC 阻断的是「穿透到父盒外面」，不是「内部相邻外边距合并」。

## 建立 BFC 的手段：一张实测对照表

被测对象统一是：300px 宽的容器，内部只有一个 100×80 的左浮动子元素。理想情况是容器高度 = 80。

| 容器声明 | 实测容器高度 | 是否包含浮动 | 副作用 |
| --- | --- | --- | --- |
| 什么都不写（默认块盒，`overflow: visible`） | 0 | 否 | —— |
| `display: flow-root` | **80** | 是 | 无（不裁剪、不产生滚动、不改宽度） |
| `overflow: hidden` | **80** | 是 | 溢出内容被裁掉，**可被脚本滚动**（实测 `scrollTop` 设为 40 生效） |
| `overflow: auto` | **80** | 是 | 溢出时出现滚动条；同样可滚动 |
| `overflow: scroll` | **95.2** | 是 | 常驻双向滚动条，多出的 15.2px 是横向滚动条占位 |
| `overflow: clip` | **0** | **否** | 溢出内容被裁掉，且**不可滚动**（实测 `scrollTop` 恒为 0） |
| `contain: layout` | **80** | 是 | 影响包含块与尺寸语义，需谨慎 |
| `display: inline-block` | **80** | 是 | 变成行内级块盒：参与行盒、受 `font-size` 空白影响 |
| `display: table-cell` | **80** | 是 | 变成表格单元：外边距失效、受表格布局算法约束 |
| `display: table-caption` | **80** | 是 | 语义上属于表格标题，不适合当布局手段 |
| 尾部插入 `clear: both` 的空元素（clearfix） | **80** | **不是 BFC** | 靠清除元素把容器顶开，见下一节 |

`overflow: clip` 那一行是本章最需要强调的实测结果，它同时打脸两种想当然：

- 「`clip` 和 `hidden` 差不多，只是不给滚」——不对，**`clip` 连浮动都不包含**。
- 「`clip` 至少更省」——它在**裁剪**上和 `hidden` 一致（实测：在容器下方 20px 处探测命中点，`visible` 命中的是溢出的子元素，`hidden` / `clip` / `auto` 三个都命中不到，说明子内容确实没画出来），但在**建立 BFC** 上失败。

这个组合的后果很实际：一个只有浮动子元素的容器加上 `overflow: clip`，容器高度是 0，浮动又会被裁到看不见——**内容凭空消失，而 DOM 里一切正常**。

MDN 的 [`overflow` 文档](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow)对此有明文：**除 `visible` 与 `clip` 之外的所有值都会建立新的 BFC**。也就是说这不是浏览器的偏差行为，而是规范就如此区分——`clip` 被划到「裁剪但不改格式化上下文」那一档。

<Callout type="unverified" title="未实测的部分">

- `contain: content`、`contain: strict`、`contain: paint` 的浮动包含行为**没有单独实测**。可以确认的只有 `contain: layout` 能包含浮动（80）。`paint` 类containment 还会顺带裁剪溢出，是否也建立 BFC 请以实测为准。
- `overflow-clip-margin` 对 `clip` 的影响未实测。
- 上表所有读数来自单个 Chromium 150 环境。`display: flow-root` 在旧浏览器（尤其是需要兼容 IE 的项目）里的支持情况本章不做断言。

</Callout>

## clearfix 的真实身份：它不是 BFC

经典的 clearfix：

```css
.card::after {
  content: '';
  display: block;
  clear: both;
}
```

实测容器高度从 0 变成 80。但机制**不是**建立 BFC，而是：在容器末尾插入一个块盒，它带着 `clear: both`，于是被推到所有浮动下方；这个插入的块盒属于容器内部，所以把容器撑高了。用 `<br clear="both">` 达到同样效果（实测也是 80），只是它把修复写进了 HTML。

三条后果值得在意：

- 容器多了一个伪元素参与布局。**这条不是推测**：实测把 clearfix 放进 `display: grid; grid-template-columns: 1fr 1fr; gap: 10px` 的 300px 容器里，`::after` 拿到的是**第二格**，computed 宽度 `145px`（正好 (300 − 10) / 2）；放进 `display: flex; gap: 10px` 的容器里，它占一个主轴位置、自身 `width` 解析为 `0px`。也就是说它会真实吃掉一个 flex/grid 槽位，连带改变 `gap` 的数量和 `align-*` / `justify-*` 的视觉结果。
- 它只解决高度塌陷，**不解决**「背景伸到浮动底下」和「外边距穿透」——那两个是 BFC 的 ② ③ 条职责。
- 换成 `display: flow-root` 一行就够，没有伪元素、没有额外 DOM、没有滚动副作用。**新代码请直接用 `flow-root`**，把 clearfix 留给需要兼容老浏览器的存量文件。

## 现代布局里还需要学这些吗

需要，但用途变了。Flexbox / Grid 的容器天然包含子项，两栏布局也不再用「浮动 + `overflow: hidden`」。剩下三个高频场景仍然要靠本章的规则：

- **文字环绕图片。** 这是浮动目前唯一无可替代的能力：`float` 让行盒避让，`shape-outside` 在这个基础上做异形环绕。想「图片右边贴文字」就必须理解块盒/行盒的区别。
- **阻止外边距穿透。** 卡片列表第一项的 `margin-top` 跑到容器外面，把整个卡片往下推——这是第 3 章的父子折叠问题，标准修法就是给容器 `display: flow-root`。
- **调试第三方 CSS。** 看到 `overflow: hidden` 先别改：它很可能正在承担包含浮动或裁剪溢出两个职责之一。删掉之前按下面的排查顺序验证。

## 常见错误与排查

**症状：容器高度 0，背景/边框看不见，后面的内容叠上来了。**
成因：容器内部只有浮动或绝对定位子元素。
修法优先级：`display: flow-root` → 需要裁剪溢出时用 `overflow: hidden` → 存量兼容代码用 clearfix。不要为了这个症状加 `height`。

**症状：改了 `overflow: hidden` 之后下拉框、气泡、焦点环被裁掉。**
成因：`overflow` 不是 `visible` 会同时建立 BFC **和**裁剪溢出；`hidden` 还会创建滚动容器（脚本能滚，用户看不见滚动条）。
排查：用 `getComputedStyle(el).overflow` 沿 DOM 往上找第一个非 `visible` 的祖先；把它换成 `display: flow-root`（只需包含浮动时）或 `overflow: clip`（只需裁剪、且没有浮动时）。

**症状：加了 `overflow: clip` 想当 `flow-root` 用，结果内容整个不见了。**
成因：`clip` 不建立 BFC（见对照表），容器高度 0，同时把子内容裁掉。
修法：换 `display: flow-root`；确实需要裁剪再叠加 `overflow: clip`，但要清楚这时高度是靠 `flow-root` 撑起来的。

**症状：在浮动后面加了 `clear` 的兄弟元素，位置对了但容器还是没高度。**
成因：`clear` 只搬动自己。
修法：让**容器**建立 BFC，或者在容器**内部**末尾放清除元素（就是 clearfix）。

**症状：图片旁边的文字换行位置诡异，或者第三个浮动掉到意料之外的地方。**
排查顺序：① DevTools 里选中元素，Elements 面板底部/computed 区看 `display`、`float`、`overflow`、`contain`；② 用 `getBoundingClientRect()` 分别读**块盒**和 `Range.getClientRects()` 读**行盒**，两者不一致就是浮动在挤行盒；③ 检查是不是显式宽度挡住了挤窄（见「位移 vs 挤窄」表）。

**症状：浮动子元素在 Flex/Grid 容器里不生效，也不报错。**
成因：flex item / grid item 的 `float` 被忽略（实测两组 x 坐标完全按 flex/grid 排布）。
修法：改用 `margin-left: auto` / `justify-content` / `grid-column` 来表达同样的意图，把 `float` 声明删掉，别留一条永不生效的声明迷惑下一个维护者。

## 练习

<Exercise title="练习 1 · 预测六个高度" difficulty="基础">

容器都是 `width: 300px`，内部只有**一个**子元素 `<span class="f"></span>`，其中 `.f { float: left; width: 100px; height: 80px; }`。请分别写出下面六种容器声明下**容器的高度**，并说明浮动是否被包含。

| 编号 | 容器声明 |
| --- | --- |
| ① | （无） |
| ② | `overflow: visible` |
| ③ | `overflow: clip` |
| ④ | `overflow: hidden` |
| ⑤ | `display: flow-root` |
| ⑥ | `display: inline-block` |

再回答一问：⑥ 的高度结果和 ④ 相同，但⑥ 会带来什么④ 没有的问题？

<template #answer>

| 编号 | 高度 | 包含浮动 |
| --- | --- | --- |
| ① | 0 | 否 |
| ② | 0 | 否 |
| ③ | **0** | **否** —— `clip` 不建立 BFC，这是唯一非直觉的一档 |
| ④ | 80 | 是，同时裁剪溢出、创建可脚本滚动的滚动容器 |
| ⑤ | 80 | 是，且无裁剪、无滚动副作用 |
| ⑥ | 80 | 是，但容器变成**行内级**块盒 |

⑥ 的三个副作用：容器会和同行其他内容排在一起（受 `font-size`、`line-height` 与空白字符影响，常见后果是底部多出一条空隙）；`margin: 0 auto` 之类的水平居中失效；语义上它不再是一个独立的块级区域，后续改成 flex/grid 时行为会跳变。

依据：规范把「除 `visible` 与 `clip` 之外的 `overflow` 取值」都划入建立 BFC 的一档，`display: flow-root` 与 `inline-block`、`table-cell` 也各自建立独立格式化上下文。本章对照表里的 0 / 0 / 80 / 80 / 80 / 80 就是这六条的实测读数。

</template>

</Exercise>

<Exercise title="练习 2 · 修一个真实的两栏片段" difficulty="进阶">

下面是从存量项目里抠出来的片段（HTML 结构不可改，样式可以改）。图片想「左图右文」，实测现象有三个：**① 文字只在第一行绕到图片右边，第二行开始又回到最左；② `.box` 的背景是浅蓝，结果整条 300px 宽的背景把图片下半截盖住了；③ 后面紧跟的 `.next` 卡片位置错乱，压到了图片上。**

```html
<section class="iso">
  <img class="thumb" src="…" alt="">
  <div class="box">…长文本…</div>
</section>
<div class="next">下一张卡片</div>
```

```css
.iso  { width: 300px; }
.thumb { float: left; width: 100px; height: 80px; }
.box   { width: 300px; background: #cfe; }
.next  { width: 300px; height: 40px; background: #fc9; }
```

请指出每个现象的根因，并给出只改 CSS 的最小修法（三处），说明每处改动带来的连锁后果。

<template #answer>

先把三个现象对上号：

**① 只有第一行绕排** —— 不是 bug，是本章的核心规则：浮动只挤窄**行盒**，而 `.box` 的边界盒按常规流铺满。文字能绕图片是因为行盒被挤窄（实测：块盒 `x=0 w=300`，行盒 `x=100 w=192`）；如果图片高度只有 80px，超过 80px 之后的行就不再被挤窄，于是「第二行回到最左」——**这个现象本身说明布局是按预期工作的**，需要改的是「希望整段文字都待在图片右边」这个意图。

**② 背景盖住图片** —— 同样是块盒不被挤窄：`.box` 有显式 `width: 300px` 且 `x=0`，它的背景铺满 300px，正好压在浮动下半部分上面。

**③ `.next` 压到图片上** —— `.iso` 没有建立 BFC，浮动逃出容器，`.iso` 的高度只由 `.box` 决定，而 `.next` 在 `.iso` 之后按常规流排，所以撞上仍然「活着」的浮动。

最小修法（三处，都只改 CSS）：

```css
/* 修 ③：让 .iso 包含浮动 */
.iso { display: flow-root; }

/* 修 ①②：让 .box 变成 BFC 根，并把宽度交还给 auto */
.box { width: auto; overflow: hidden; }   /* 或 display: flow-root */
```

- `.iso { display: flow-root }`：`.iso` 高度由 80 撑开（本章对照表 ⑤），`.next` 自然被推到下方。不要用 `.next { clear: both }`——实测那只会搬动 `.next` 自己，`.iso` 的背景/点击区域依旧是塌陷的。
- `.box` 的 `width: 300px` 必须删掉：实测显式宽度下 BFC 根**只位移不挤窄**（`x=100`、宽度仍是 300，右边溢出包含块）。改成 `auto` 后它精确挤成 200px，文字全部待在图片右侧，背景也不再压住图片。
- `.box` 用 `display: flow-root` 替代 `overflow: hidden` 更好：不需要裁剪溢出，避免「内容被裁」「脚本可滚动」两个副作用。若项目要兼容不支持 `flow-root` 的老浏览器，退回 `overflow: hidden`，并接受裁剪。

如果同时给 `.box` 写了 `overflow: clip` 又想用它包浮动，就会踩到本章开头第 2 问的坑：`clip` 不建立 BFC，`width: auto` 时它只会被位移或整体掉到浮动下方，而溢出内容不可滚动地消失。

</template>

</Exercise>

<Exercise title="练习 3 · 把 clearfix 换成 flow-root，需要注意什么" difficulty="进阶">

一个存量项目里有 40 处这样的写法：

```css
.group::after { content: ''; display: block; clear: both; }
```

技术债工单要求统一改成 `display: flow-root`。请列出改动前必须确认的四件事，并说明每件可能踩到什么。已知项目的 `.group` 里既有浮动子元素，也有普通块级子元素；构建链里没有视觉回归测试。

<template #answer>

**1. 有没有代码依赖那个伪元素。** `::after` 是一个参与布局的块盒：`:last-child` 与 `.group > *:nth-last-child(1)` 命中的是**真实**子元素（伪元素不参与结构选择器），但 `:only-child`、`+`/`~` 组合器、以及 JS 里的 `children` 都不受它影响——真正会被影响的是把 `::after` 当装饰用的项目（例如给 `.group::after` 设了 `background`、`height`、动画）。改之前全局搜 `::after` 的 `.group` 相关规则；`grep -rn "::after" src/` 五分钟能扫完。

**2. 它同时是不是 flex/grid 容器。** clearfix 的伪元素在 flex/grid 容器里**会变成一个真实的项目**——实测在 `grid-template-columns: 1fr 1fr; gap: 10px` 的 300px 容器里，`::after` 占了第二格（宽度 `145px`），在 flex 容器里它占一个主轴位、自身宽度解析为 `0px`。这类代码改成 `flow-root` 时是**净收益**（少一个幽灵 item），但收益会表现为「间距变了、最后一格空了」。没有视觉回归测试时，要人工抽查带 `gap` 的容器。

**3. 它同时有没有依赖 `clear` 的其他用途。** 如果某个 `.group` 内部靠 `clear: both` 做「浮动结束后强制换行」（例如图片墙里最后一行要贴齐），去掉 clearfix 会让后续内容挤到浮动旁边。搜 `clear` 的用法，区分「为了撑高度」和「为了换行」——只有前者可以换成 `flow-root`。

**4. 外边距折叠行为会变。** 这是最隐蔽的一条：`flow-root` 会阻断**父子之间**的穿透折叠（实测：普通父盒子偏移 0 / 父高 20 → `flow-root` 父盒子偏移 20 / 父高 40），而 clearfix 不阻断（伪元素只是把一个带 `clear` 的块塞进来，父盒仍是普通块盒）。所以改完之后，`.group` 第一个子元素的 `margin-top` 会**留在内部**，视觉上整块内容往下移、容器变高。这类改动会连带影响 `overflow` 判定与滚动高度，需要按第 3 章的规则逐个复核。

顺带一条工程做法：改动量大时不要一次性全替换。先把 `.group` 的样式抽成一条可覆盖的工具类（例如 `.flow-root { display: flow-root }`），逐个容器替换并当场目视确认，最后再清理 40 处 `::after`。这样每次改动的可观察面只有一个容器，符合「没有视觉回归测试就缩小单次改动半径」的原则。

</template>

</Exercise>

## 官方文档与延伸阅读

- [CSS 2.2 §9.4 Normal flow / §9.4.1 Block formatting contexts](https://www.w3.org/TR/CSS22/visuren.html) —— BFC 的规范定义（本章用 WebFetch 复核了小节编号：9.4 是常规流，9.4.1 是 BFC，9.5 是浮动）。
- [CSS 2.2 §9.5 Floats](https://www.w3.org/TR/CSS22/visuren.html#floats) —— 浮动规则原文，含「被浮动的盒子的 `display` 会被块级化」这一条（实测 `span + float` 的 computed `display` 为 `block`）。
- [MDN 块级格式化上下文（BFC）](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_display/Block_formatting_context) —— 建立 BFC 的元素清单，与本章对照表可互相印证。
- [MDN `overflow`](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow) —— 明确写出「除 `visible` 与 `clip` 之外的所有取值都会建立新的 BFC」，以及 `hidden` 可编程滚动 / `clip` 不行的区别；[中文版本](https://developer.mozilla.org/zh-CN/docs/Web/CSS/overflow) 已同步。
- [MDN `display`](https://developer.mozilla.org/en-US/docs/Web/CSS/display) 与 [CSS Display Module Level 3 草案](https://www.w3.org/TR/css-display-3/) —— `flow-root` 的定义与块级化（blockification）规则。
- [MDN `clear`](https://developer.mozilla.org/en-US/docs/Web/CSS/clear) —— `clear` 只作用于自身所在元素的顶边。
- [MDN `contain`](https://developer.mozilla.org/en-US/docs/Web/CSS/contain) 与 [CSS Containment Module Level 3](https://www.w3.org/TR/css-contain-3/) —— `contain: layout` 建立独立格式化上下文；本章只实测了 `layout` 一个取值。
- [MDN `getBoundingClientRect()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect) 与 [`Range.getClientRects()`](https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects) —— 前者读块盒，后者读行盒；本章「块盒铺满、行盒避让」的对照表就是这两个 API 的差异应用。
- 上一章：[盒模型与外边距折叠](/css/box-model) —— 折叠规则本身；本章讲 `flow-root` 为什么能阻断它。

## 下一章

第 5 章 [Flexbox](/css/flexbox) 开始讲真正的现代布局：主轴与交叉轴、`flex` 简写的三个分量、以及 `flex-basis` 与 `width` 谁赢。想继续巩固本章的前置内容，可以回读[第 3 章 盒模型与外边距折叠](/css/box-model)。
