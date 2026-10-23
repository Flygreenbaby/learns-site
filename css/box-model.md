# 盒模型与外边距折叠：尺寸怎么算，间距为什么不是你想的那个数

## 先看三个都「算对了」的数字

一个元素：`width: 200px`、`padding: 20px`、`border: 5px solid`，`box-sizing` 用默认的 `content-box`。问：它在页面上占多宽？

三个常见答案各自来自不同的测量方式，而浏览器实测给的是**三个都不一样的数**：

| 测量方式 | 实测值 | 读到的是哪一层 |
| --- | --- | --- |
| `element.offsetWidth` | `250` | 内容 + padding + border，取整到整数 |
| `element.clientWidth` | `240` | 内容 + padding，**不含 border** |
| `element.getBoundingClientRect().width` | `249.6` | 内容 + padding + border，带小数 |

`250` 和 `249.6` 的差不是 bug：前者是布局引擎内部的整数化结果，后者是 CSS 像素下的真实盒子边界，在 `devicePixelRatio = 1.25` 的屏幕上会被对齐到设备像素。结论：**判断尺寸只看 `getBoundingClientRect()`，判断 API 返回值不要混用 `offsetWidth` 和 `clientWidth`**——它们差一个 border，用它俩做减法很容易得出「border 没了」的错误结论。

真正让人困惑的是后面两件事：

```css
.wrap { width: 400px; height: 100px; }
.inner { margin-top: 10%; }     /* 实测 40px，不是 10px */
```

垂直方向的外边距按**水平宽度**算。以及：

```css
.parent { background: #eee; }        /* 没有 border，没有 padding */
.parent > .child { margin-top: 20px; }
```

实测父容器与子元素的顶边**完全重合**（差值 0），父容器高度等于子元素高度。那 20px 外边距跑到了父元素外面去。

这两件事合起来解释了日常布局里一大半「间距莫名其妙」的问题。本章把它们讲成可以推导的规则。

<Callout type="verified" title="本章实测说明">

方法与环境同第 1、2 章：静态页面 + `getComputedStyle()` / `getBoundingClientRect()`，Qoder 内置浏览器（`Chrome/150.0.7871.114` + `Electron/43.1.1`）、Windows 10 x64、DPR 1.25、视口 638px，核实于 2026 年 10 月 16 日。

一条踩坑记录值得先说：**本章第一版探针给每个容器加了 `border: 1px solid` 做视觉分隔，于是所有「外边距穿透」用例全部测不出穿透**——border 本身就是穿透的阻断条件，我把干扰变量写进了被测对象。改用 `background` 分隔后结果才与规范一致。这也是本章后面推荐用 `outline` 调试的原因（`outline` 不参与布局；它对折叠的影响未单独实测，但它不产生 border 盒，所以不会引入上面那种污染）。

出现 `23.2px`、`44.2px`、`249.6px` 这类小数是行盒高度与 DPR 取整的结果，不是折叠规则的一部分。判断折叠有没有发生，只看等式关系（父高 = 子高？差值 = 0？），不看小数。

</Callout>

## 盒子的四层与 `box-sizing` 改的是哪一层

一个块级盒子从内到外四层：内容（content）、内边距（padding）、边框（border）、外边距（margin）。前三层属于元素自己，**外边距不属于任何盒子，它是盒子之间的空隙**。

`box-sizing` 只改变一件事：`width` / `height`（以及 `min-*`、`max-*`）**这条线画到哪一层**。实测同一套声明、只切 `box-sizing`：

| `box-sizing` | `width: 200px; padding: 20px; border: 5px solid` | 实测 `offsetWidth` | 实测 `clientWidth` | 实测 `rect.width` |
| --- | --- | --- | --- | --- |
| `content-box`（初始值） | width 指内容层 | `250` | `240` | `249.6` |
| `border-box` | width 指到 border 外沿 | `200` | `190` | `200` |

所以 `border-box` 下 `width: 200px` 的内容区只剩 `200 − 2×20 − 2×5 = 150px`。这不是「省了 50px」，而是**同样的 width 换了含义**：

- `content-box`：`实际占位 = width + padding + border`，写 padding 会把兄弟元素顶走。
- `border-box`：`实际占位 = width`，写 padding 会挤压内容。

这就是社区惯例 `*, *::before, *::after { box-sizing: border-box }` 的由来——它让「我给这个卡片 300px」和「它确实占 300px」这两句话一致。

但 UA 默认样式表里表单控件**本来就不统一**，实测（Chromium 150，读 `getComputedStyle`）：

| 元素 | 默认 `box-sizing` |
| --- | --- |
| `<input type="text">` | `content-box` |
| `<textarea>` | `content-box` |
| `<button>` | `border-box` |
| `<select>` | `border-box` |
| 普通 `<div>` | `content-box` |

于是加全局 `border-box` 时，`<input>` / `<textarea>` 的内容区会被自己的 `padding` 吃掉（宽度不变了），而 `<button>` / `<select>` 毫无变化。给表单加内边距后「输入框里的文字被挤掉、按钮却正常」就是这么来的——不是浏览器 bug，是两种默认值撞在一起。反过来，把全局规则设成 `content-box` 会让 `<button>`、`<select>` 的占位变大，破坏它们与 `<input>` 的高度对齐。

## 百分比的基准：几乎全部看「内联尺寸」

把 `width: 400px; height: 100px` 的容器当包含块，四种百分比实测：

| 声明 | 实测结果 | 基准 |
| --- | --- | --- |
| `width: 50%` | 内容宽 `200px` | 包含块内容宽 400px |
| `padding-left: 10%` | `40px`；此时该元素 `width` 计算值变成 `360px`（它是 `auto`） | 包含块内容宽 400px |
| `margin-top: 10%` | **`40px`** | 包含块内容宽 400px，**与它的方向无关** |
| `height: 50%`（父 `height: 100px`） | `50px` | 父元素内容高 |
| `height: 50%`（父 `height: auto`，父实测高 `23.2px`） | `23.2px`，等于自身内容高度 | **百分比被丢弃，按 `auto` 处理** |

`margin-top: 10%` 换成父元素高度为 `auto` 的容器再测，仍然是 `40px`——**基准与父元素有没有高度无关**。

规范把这条写得很死：[CSS 2.2 §8.3](https://www.w3.org/TR/CSS22/visuren.html) 规定 `margin-*` 的百分比参照包含块的 **width**；padding 同理。于是有了两个实际后果：

1. **竖着的间距会跟着横向尺寸变。** 响应式里最常见的连锁反应：一个 `padding: 10%` 的卡片在窄屏下纵向内边距急剧缩小（因为宽度小了），看起来像塌了。解法是把纵向间距换成固定值或 `rem`，别用百分比。
2. **百分比高度需要一个「确定的」父高度。** 这条坑到今天还在生产环境每天制造 bug，正确的处理是给祖先链补上 `height`，或者改用 Flexbox / Grid 的拉伸（下一版布局章节展开），而不是继续调百分比。

顺带把第 1 章的值计算串起来：`width: 50%` 的 **specified value** 是 `50%`，**computed value** 已经是像素数（`getComputedStyle` 读到的就是它），**used value** 才是布局最终分配的值。上面表格里 `padding-left: 10%` 那行 `width` 从 `auto` 变成 `360px`，就是 used value 阶段的减法结果。

## 外边距折叠：只在垂直方向发生的合并

### 规则本体

相邻的两个垂直外边距不会相加，而是**合并成一个**：

- 全是正数 → 取最大值。
- 有正有负 → 最大值 + 最小值（负的那个数照加）。
- 全是负数 → 取最小值（绝对值最大的那个）。

合并可以跨越多方连续参与（一长串相邻边距合成一个结果），参与方包括：兄弟之间、父元素与它的第一个/最后一个子元素之间、以及元素自己的上下边距（当它高度为 0、无 padding、无 border 时）。

### 实测数字

兄弟之间（普通块流）：

| 用例 | 声明 | 实测间距 | 说明 |
| --- | --- | --- | --- |
| 20 / 30 | 上边 `margin-bottom: 20`，下边 `margin-top: 30` | `30` | 取最大 |
| 20 / −10 | 上边 `margin-bottom: 20`，下边 `margin-top: -10` | `10` | 20 + (−10) |
| −5 / −30 | 上边 `margin-bottom: -5`，下边 `margin-top: -30` | `−30` | 全负取最小，盒子发生重叠 |
| 20 / 30 / 40 | 连续三个块各自 `margin-top` | `30`、`40` | 每对相邻各自取最大 |
| 20 / −10 / 30 | 中间块上下各 `−10`，末块 `margin-top: 30` | `10`、`20` | 两组合并，中间块高度 20 不参与 |

浏览器 UA 默认样式带来的折叠（实测）：

| 元素 | UA 默认值 | 相邻关系 | 实测间距 |
| --- | --- | --- | --- |
| `<p>` | `margin: 16px 0` | 段落 → 列表 | `16`（不是 32） |
| `<ul>` | `margin: 16px 0`、`padding-inline-start: 40px` | 列表 → `<h1>` | `21.44` |
| `<h1>` | `font-size: 32px`、`font-weight: 700`、`margin: 0.67em` | `<h1>` → 段落 | `21.44`（不是 21.44 + 16 = 37.44） |

`0.67em × 32px = 21.44px` 是 h1 的上下外边距，它比段落的 16px 大，所以合并结果是 21.44。**这一组数字直接解释了「为什么我加了 `margin-bottom: 40px`，标题和正文之间却几乎没有变化」**——你的 40px 和 UA 的 16px 折叠成 40px，如果你加的是 10px，它就消失了。

### 谁不参与折叠（实测）

| 场景 | 声明 | 实测间距 | 结论 |
| --- | --- | --- | --- |
| 普通块流 | `margin-bottom: 20` + `margin-top: 30` | `30` | 折叠 |
| `display: flex`（column） | 同上 | `50` | **不折叠**，老老实实相加 |
| `display: grid` | 同上 | `50` | **不折叠** |
| 后一个元素 `float: left` | 同上 | `50` | 浮动盒不参与折叠 |
| 后一个元素 `display: inline-block` | 同上 | `50` | 行内块不参与折叠 |

于是「把父容器改成 `display: flex`」既是一种**阻止折叠**的手段，也是一种**风险**：你原本指望 30px 的地方会变成 50px。上面表格里 flex 与 grid 那两行就是这个效应的直接测量。

### 穿透：父元素与子元素之间的折叠

父元素没有 border、没有 padding、没有间隙内容时，它的第一个子元素的 `margin-top` 会「穿」到父元素外面去（末子的 `margin-bottom` 同理）。实测：

| 场景 | 实测差值（子顶边 − 父顶边） | 实测父容器高度 |
| --- | --- | --- |
| 父无 border/padding，子 `margin-top: 20` | `0` | `23.2` = 子高度（20px 完全跑到外面） |
| 父 `padding-top: 1px` | `21` | `44.2` = 1 + 20 + 23.2 |
| 父 `display: flow-root` | `20` | `43.2` = 20 + 23.2 |
| 末子 `margin-bottom: 25`，父无遮挡 | — | `20` = 子高度（25 跑到外面） |
| 末子 `margin-bottom: 25`，父 `overflow: hidden` | — | `45` = 20 + 25（留在里面） |

**空元素还会把自己上下两个边距合并掉**（self-collapsing margins）。实测对比：一个 `margin: 10px 0` 的块，后面跟一个 `margin-top: 60px` 的块——

| 前者有没有内容 | 前者实测高度 | 到后者的实测距离 |
| --- | --- | --- |
| 有文本 | `23.2px` | `60`（= max(10, 60)） |
| 空 `<div>` | `0` | `50`（它的 10px 已算在自己顶边之上，与后面 60px 合并成 60） |

这就是「插一个空的 `<div>` 想撑开间距，结果间距反而比预期小」的成因：空块把自己的 10px 上下边距合并成了一个 10px，而不是加出 20px。

### 阻止折叠的断面汇总

| 手段 | 实测是否有效 | 副作用 |
| --- | --- | --- |
| 父元素加 `border`（哪怕 1px） | 有效（第一版探针正是因为这个「看不见」穿透） | 改变占位尺寸 |
| 父元素加 `padding`（1px 即可） | 有效，实测差值从 0 变 `21` | 改变占位尺寸与内容宽度 |
| 父元素 `display: flow-root` | 有效，实测差值 `20`，父高 `43.2` | 几乎无副作用，**现代首选** |
| 父元素 `overflow: hidden` | 有效（末子用例实测 45 vs 20） | 创建滚动容器，会裁掉溢出内容、影响下拉层 |
| 父元素 `display: flex` / `grid` | 有效（子间距实测 50 而非 30） | 间距变大，所有子元素变成 flex/grid 项目 |
| 子元素 `float` / `inline-block` | 有效（实测 50） | 脱离或改变行内布局 |

`flow-root` 是这几个里唯一「只做一件事」的：它把元素变成块级格式化上下文（BFC）的根，从而阻断父子边距穿透并让容器包住浮动内容，不裁剪、不产生滚动条、不改变子元素的显示类型。[第 4 章](/css/flow-and-bfc)会正式讲 BFC；本章先记住结论：**要让父容器「接住」子元素的外边距，写 `display: flow-root`。**

## `auto` 外边距与居中

`margin: 0 auto` 只做一件事：**把水平方向的剩余空间按左右两份分配**。前提是 `width` 是确定值。实测：

| 用例 | 容器宽 | 元素宽 | 实测左偏移 | 实测右偏移 |
| --- | --- | --- | --- | --- |
| `width: 120px; margin-left/right: auto` | `300px` | 120px | `90` | `90` |
| `width: auto; margin-left: auto` | `300px` | 撑满 300px | `0.8`（即 0，DPR 取整） | — |

第二行 `getComputedStyle(...).marginLeft` 读回来是 `0px`——没有剩余空间可分，`auto` 就当 0 处理。所以「用 `margin-left: auto` 把元素推到右边」在 `width: auto` 的块元素上完全无效，必须给它一个确定宽度（或者改用 Flexbox 的 `margin-left: auto`，那里它对自动宽度的项目也生效，因为 flex 项目的尺寸由另一套算法决定——这是第 5 章的内容）。

垂直方向的 `auto` 边距一律按 0 计算，不存在「`margin: auto` 垂直居中」。实测：把一个 `margin-top: auto; margin-bottom: auto; height: 20px` 的块放进 120px 高的普通块容器，`getComputedStyle` 读回 `marginTop` / `marginBottom` 都是 `0px`，元素顶边与容器顶边重合（偏移 0）。

## 常见错误与排查

### 症状：间距是 30px，但我写了 20 + 30

折叠。用 `getBoundingClientRect()` 量两个元素的 `top`/`bottom`，得到实际间距后，把它和「你写的两个数之和」对比。差一大截基本就是折叠。**要拉开距离时改其中一个方向**：只用上边的 `margin-bottom` 或只用下边的 `margin-top`，别两边都写。

### 症状：给容器加了 `padding`，里面的百分比宽度元素溢出了

`padding-left: 10%` 这类百分比按包含块 width 算，而 `content-box` 下容器的实际占位是 `width + padding`。两处任一改成 `border-box`，或者把子元素的百分比换成 `flex-basis` / Grid 轨道，都能解决。先用 Computed 面板确认到底哪一层超了，别急着改数值。

### 症状：卡片顶部留白消失，或者整张卡片往下移了十几像素

末/首子外边距穿透。判定方法：比较父容器和第一个子元素的 `getBoundingClientRect().top`，**相等就是穿透**。修复写 `display: flow-root`（实测差值从 0 变 20），不要用 `overflow: hidden` 硬修——它顺手把你的下拉菜单裁掉了。

### 症状：`height: 50%` 毫无效果，元素高度等于内容高度

父元素高度是 `auto`，百分比高度被丢弃。三条路：给祖先链补确定高度、用 Flexbox/Grid 拉伸、或者干脆改用 `min-height: 50vh` 这类视口单位。继续调百分比数字是浪费时间的。

### 症状：`* { box-sizing: border-box }` 之后表单控件里的文字被挤掉了

`<input>` 的 `padding` 现在从 `width` 里扣。给需要内边距的控件改用 `width: fit-content` 或加大 `width`，或者只对布局容器施加 `border-box`。

### 症状：明明没写 `margin`，元素之间却有 16px 空隙

UA 默认样式表。`<p>`、`<ul>`、`<h1>` 等都自带边距（实测 `<p>` 是 `16px 0`，`<h1>` 是 `0.67em` 即 21.44px）。排查用 Computed 面板看 `margin-top`/`margin-bottom` 的来处，它会指出该声明来自哪个样式表。重置样式表要么全清（`* { margin: 0 }`，代价是所有语义间距要靠类显式给出），要么不动——两种都行，混着用才出事。

## 练习

<Exercise title="练习 1 · 预测五个数" difficulty="基础">

不打开浏览器，写出下面每个盒子的实测值（假设 DPR = 1、根字号 16px、字体默认）。

```css
.a { box-sizing: content-box; width: 100px; padding: 10px; border: 2px solid; }
.b { box-sizing: border-box;   width: 100px; padding: 10px; border: 2px solid; }
.c { width: 50%; }              /* 放在 .a 的内容盒里 */
.d { margin-top: 20%; }         /* 放在宽度 200px 的容器里 */
.b > .content-row { /* 只问 .b 的内容区宽度 */ }
```

1. `.a` 的 `getBoundingClientRect().width`
2. `.b` 的 `getBoundingClientRect().width`
3. `.c` 的宽度
4. `.d` 的 `margin-top` 计算值
5. `.b` 的内容区宽度

<template #answer>

1. **124px**。`content-box` 下占位 = `100 + 10×2 + 2×2`。
2. **100px**。`border-box` 下占位就是 `width`。
3. **50px**。`.a` 的内容盒宽度是 100px，百分比按它算。
4. **40px**。`20% × 200px`（宽度），与它是垂直方向无关。
5. **76px**。`100 − 10×2 − 2×2 = 76`。

第 4 题错的人通常是按容器高度算的百分比；第 5 题错的人多半忘了 border 也要扣。这两条就是本章「百分比基准」和「`box-sizing` 改的是含义不是大小」两个结论的直接应用。

</template>

</Exercise>

<Exercise title="练习 2 · 三个间距到底剩多少" difficulty="进阶">

四组块级元素，容器无 padding、无 border，每组里三个块高度都是 20px。写出每组的**外边距合并结果**（即相邻块边框之间实测会是多少）。

```css
/* 组 1 */ #g1a { margin-bottom: 30px; } #g1b { margin-top: 12px; }
/* 组 2 */ #g2a { margin-bottom: 8px;  } #g2b { margin-top: -25px; }
/* 组 3 */ #g3a { margin-bottom: -8px; } #g3b { margin-top: -25px; }
/* 组 4 */ #g4a { margin-bottom: 40px; } #g4b { margin-top: -6px; margin-bottom: -14px; } #g4c { margin-top: 22px; }
```

再回答：组 4 中 `#g4b` 的顶边到 `#g4c` 的顶边，垂直距离是多少？如果把 `#g4` 容器改成 `display: grid`，这个距离变成多少？

<template #answer>

- **组 1：30px**（全正取最大）。
- **组 2：−17px**（`8 + (−25)`，盒子互相重叠）。
- **组 3：−25px**（全负取最小）。
- **组 4**：`#g4a`→`#g4b` 为 `40 + (−6) = 34px`；`#g4b`→`#g4c` 为 `22 + (−14) = 8px`。注意这是**两组合并**，中间元素的 `margin-top: -6` 与 `margin-bottom: -14` **不会先自我合并**（它有 20px 高度，不是 self-collapsing 的情形）。
- 组 4 中 `#g4b` 顶边到 `#g4c` 顶边的距离：`#g4b` 的顶边在 `#g4a` 底边下方 34px，`#g4c` 的顶边在 `#g4b` 底边下方 8px，而 `#g4b` 自身高 20px → **顶到顶 = 20 + 8 = 28px**。同理 `#g4a` 顶到 `#g4b` 顶 = `20 + 34 = 54px`。
- 把容器改成 `display: grid`（或 `flex` + `column`）后，**实测三组数字完全一样：34 / 8 / 28**。这不是折叠还在发生，而是一个数值巧合：每一对相邻边距里都恰好只有一个正数和一个负数，于是「最大正数 + 最小负数」＝「直接相加」。同一套声明换成组 1 那种两个正数的情况（30 与 12），块流是 30、flex/grid 就是 42（这一条按「不折叠即相加」推导，未单独实测）——本章的 flex / grid 用例实测的正是这一种（20 与 30：块流 30，flex 50，grid 50）。

**本题的两个自查点**：一是组 4 里 `#g4b` 的两处负边距——如果你把 −6 和 −14 先合成了一个 −20，说明 self-collapsing 的条件用错了对象，它只在元素高度为 0（且无 padding、无 border）时发生，本章空 `<div>` 用例实测过这个区别（有内容时间距 60，空块时 50）。二是最后那条「换 grid 数字没变」——如果你的第一反应是「那 flex 里外边距还是会折叠」，就漏掉了「相同结果可能来自不同机制」这件事，而排查时能区分这两者，靠的是把正数个数与负数个数分开看。

</template>

</Exercise>

<Exercise title="练习 3 · 修一个真实的穿透问题" difficulty="进阶">

下面这个卡片，设计稿要求：卡片背景紧贴标题上方留 24px 空白。实际效果是卡片背景从标题文字上方 0px 开始，且整张卡片在页面里往下移了 24px。

```html
<section class="card"><h2 class="card-title">标题</h2><p>正文</p></section>
```

```css
.card { background: #f4f4f5; }
.card-title { margin: 24px 0 12px; }
.card p { margin: 0; }
```

给出两种修法、说明各自为什么有效，并指出哪种会带来别的改变。要求：修改后 `section` 与 `h2` 的 `getBoundingClientRect().top` 差值必须是 24。

<template #answer>

**诊断**：`.card` 没有 border、没有 padding，`h2` 的 `margin-top: 24px` 与父元素 `.card` 的上外边距合并（父元素自身 `margin-top` 为 0，合并结果 24px 落在卡片**外面**）→ 卡片背景顶边与标题顶边重合，整张卡片被推下 24px。这正是本章实测的「差值 0、父高 = 子高」那组结果。

**修法 A：`display: flow-root`（推荐）**

```css
.card { background: #f4f4f5; display: flow-root; }
```

`.card` 成为 BFC 的根，父子边距不再合并 → 差值变 `24`，卡片背景高度也接住了原本逃逸的 24px。实测同类用例：差值从 0 变 20、父容器高 43.2（= 20 + 23.2），即 20px 外边距被完整保留在容器内部。副作用：几乎只有「它会包住内部浮动」，这在现代布局里通常是好事。

**修法 B：给父元素加 padding（会改变尺寸）**

```css
.card { background: #f4f4f5; padding-top: 1px; }
```

padding 是阻断断面，差值变 `25`（1 + 24）。实测同类用例差值正是 `padding + margin`。副作用更大：卡片整体高度增加、内容区宽度减少（`content-box` 下还会撑大占位）。想要「24px 背景留白」的正确写法不是 `padding-top: 24px` 吗？——是的，但那样标题自己的 `margin-top: 24` 也留在里面，就变成 48px 留白，需要同时把标题的 `margin-top` 改成 0。**这正是「先量差值再决定修哪一层」的意义**：不测量的话，你会反复调数字却不知道间距来自边距还是内边距。

**不推荐的修法**：`overflow: hidden`。它同样有效（实测末子用例：父高 45 对比 20），但它创建滚动容器，会裁掉以后加进来的任何溢出内容（下拉、阴影、focus ring）。用 `flow-root`。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN 掌握 margin 合并](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_box_model/Mastering_margin_collapsing) —— 本章折叠规则的权威讲解，含「哪些情况不合并」的完整清单；[英文版](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_box_model/Mastering_margin_collapsing) 内容相同。
- [MDN 盒模型](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_box_model) 与 [盒模型介绍](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_box_model/Introduction_to_the_CSS_box_model) —— 四层盒子的定义。
- [MDN `box-sizing`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/box-sizing) —— 含浏览器对表单控件的默认值说明。
- [CSS 2.2 §8 Visual formatting and box model](https://www.w3.org/TR/CSS22/box.html) —— 盒模型与 `box-sizing` 的规范原文；边距百分比与折叠见同级文档 [§8.3 外边距折叠](https://www.w3.org/TR/CSS22/visuren.html)。
- [CSS Box Model Module Level 3 草案](https://drafts.csswg.org/css-box-3/) —— 较新的模块划分，日常以 CSS 2.2 的表述为准。
- [MDN 块级格式化上下文（BFC）](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_display/Block_formatting_context) —— `flow-root` 为什么能阻断折叠的解释，也是第 4 章的主线。
- [MDN `getBoundingClientRect()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect) 与 [`offsetWidth`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/offsetWidth) —— 本章开头那张「三个数字」表的出处，注意两者对 border 的处理差异。

## 下一章

下一章：[常规流与格式化上下文：BFC 与浮动](/css/flow-and-bfc) —— 第 4 章正式讲 BFC、浮动与 `clear`，也就是本章反复提到的「`display: flow-root` 为什么能阻断折叠」背后的机制；浮动会把「块盒不被挤窄、行盒被挤窄」这条规则的作用域讲清楚。
