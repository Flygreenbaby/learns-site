# Flexbox：项目宽度不是你写的值，而是分配算法算出来的

一段导航栏五个链接，每个 `flex: 1`，375px 屏上最后一个被挤出屏幕，整站出现横向滚动条。一张卡片的 `flex: 1` 子项里放了 `overflow-x: auto` 的代码块，代码块把子项撑到 900px，卡片背景一起爆开。

两个现象的原因都不在「`flex: 1` 写错了」，而在于你把 `flex: 1` 当成「宽度 1 份」，它实际是三个分量的一次赋值，这三个分量要过一套带上下限的迭代算法，算完才是宽度。算法装上，这类现象全能提前预测。

本章所有表格都是**按规范算法手算**的结果，不是浏览器读数——我没有在你的环境里跑布局探针，所以不出现「实测」字样。核对方法每张表都一样：DevTools 选中子项 → Computed 面板读 `width`，或用 Chrome 的 Layout → Flexbox 覆盖层把主轴尺寸直接画在页面上。

## 主轴与交叉轴：flex-direction 选的是哪条轴

`display: flex` 之后容器内部不再是常规流，而是两条轴：**主轴（main axis）**是项目依次排开的方向，**交叉轴（cross axis）**与它垂直。

`flex-direction` 不是「横排还是竖排」，它选的是**行内轴还是块轴**：

| 取值 | 主轴是 | main-start 在 |
| --- | --- | --- |
| `row` | 行内轴（inline axis） | 文本起始侧（`ltr` 为左，`rtl` 为右） |
| `row-reverse` | 行内轴，反向 | 文本结束侧 |
| `column` | 块轴（block axis） | 块流起始侧（横排文本里是上） |
| `column-reverse` | 块轴，反向 | 块流结束侧 |

所以 `row` 跟随的是**文字方向**，不是物理上的「从左到右」。把容器写成 `writing-mode: vertical-rl`，行内轴变成上→下、块轴变成右→左，于是 `row` 的项目竖着排开，`column` 反而横向排。

<Callout type="verified" title="row 跟行内轴、column 跟块轴已核实">

核实于 2026 年 10 月 17 日，来源 [MDN `flex-direction`](https://developer.mozilla.org/en-US/docs/Web/CSS/flex-direction)：`row` 的定义是「将弹性容器的主轴定义为与文本方向相同」，`column` 是「主轴与块轴相同」，并明确 `row`/`row-reverse` 受容器 `dir` 影响。该页未逐条写出 `vertical-rl` 下的结论，**上一段竖排推演是我按行内轴/块轴定义加上 [CSS Writing Modes Level 4](https://www.w3.org/TR/css-writing-modes-4/) 得出的**，动手前请在 DevTools 里核对项目排布方向。

</Callout>

这条为什么值得纠结：`justify-content` 管**主轴**、`align-items` 管**交叉轴**。把 `row` 改成 `column`，两者的物理效果整体互换——「只改一个值怎么全乱了」就是轴归属变了，属性本身没变。

## flex 容器对子项做的两件事：块级化、margin 不折叠

衔接[第 3 章 盒模型](/css/box-model)与[第 4 章 常规流与格式化上下文](/css/flow-and-bfc)：

1. **子项被块级化（blockification）**。`<span>` 直接做 flex 子项时 computed `display` 变成 `block`，`inline-block` 也变 `block`。你写的规则和算出来的值不一致是正常的，所以别为了「撑满」给 `<a>` 加 `display: block`，正解是 `flex: 1` 或 `align-self: stretch`。
2. **子项之间不折叠 margin**。相邻两子项各 `margin: 20px`，之间是 40px 而不是常规流的 20px——弹性容器内部不是块格式化上下文，「同在一个 BFC 的相邻块盒」这个前提不成立。

第 2 条只作用于**直接子项这一层**。子项自己仍是普通块容器，它内部的两个嵌套块照样折叠，于是出现「外层 `gap: 0`、内层两块却重叠，间距怎么调都不对」。完整折叠清单回读[第 3 章](/css/box-model)。

另有一条第 4 章的遗留：`.box::after { content: ''; display: block; clear: both }` 这类 clearfix，如果 `.box` 同时是 flex 容器，那个伪元素会**变成一个真实项目**、占掉一个主轴位置——存量项目「多出一格空白」的常见来源。

## flex 简写的三个分量

<Callout type="verified" title="四个关键字的展开值已核实">

核实于 2026 年 10 月 17 日，来源 [MDN `flex`](https://developer.mozilla.org/en-US/docs/Web/CSS/flex)（[中文](https://developer.mozilla.org/zh-CN/docs/Web/CSS/flex)同内容）：

| 你写的 | 展开为 grow / shrink / basis |
| --- | --- |
| `flex: initial` | `0 1 auto` |
| `flex: auto` | `1 1 auto` |
| `flex: none` | `0 0 auto` |
| `flex: 1`（单个数字） | `1 1 0%` |
| 完全不写 flex 规则 | 三属性初始值 `0 1 auto`，等价 `flex: initial` |

同页的形式化语法是 `flex = none | [ <'flex-grow'> <'flex-shrink'>? || <'flex-basis'> ]`；只写一个数字时 `flex-shrink` 补 `1`、`flex-basis` 补 `0%`。

</Callout>

三条直接结论：

- **`flex: 1` 不等于 `flex: auto`。** 前者基准 `0%`，后者基准 `auto`（= 内容尺寸）。空间充裕时经常算出同一个数，一旦需要收缩或内容宽度不等就分叉（见下面表 2、表 3）。
- **只写 `flex-grow: 1` 不够。** 它只改一个分量，`basis` 仍是 `auto`。这是「加了 `flex-grow: 1` 怎么还是不等宽」的直接原因。
- **`flex: none` 才是「固定尺寸」的写法。** 单写 `width: 100px` 不阻止收缩（shrink 默认 `1`），只是收缩后可能被下限顶回来。

## 尺寸分配算法：基准、剩余空间、上下限

规范 §9.3 的简化叙述，四步：

**① 求基准（used flex basis）。** `flex-basis` 是长度或百分比就按容器内容盒解析；是 `auto` 回落到 `width`；`width` 也是 `auto` 就取内容尺寸（纯文本项目约等于 max-content）。

**② 求剩余空间。** `容器内容盒主轴尺寸 − Σ基准 − Σmargin − Σgap`。正数叫自由空间，负数叫溢出量。

**③ 分配。** 自由空间为正：按 grow 因子**均分**，增量 = 自由空间 × `grow_i / Σgrow`，与内容宽度无关。溢出为负：按 **`shrink_i × basis_i` 加权**——`flex-shrink: 2` 的项目不一定收缩更多，还要看它的基准。

**④ 套上下限后重跑 ②③。** 算出的尺寸被 `min-width`/`max-width`（横排容器；竖排看 `min-height`）夹紧，被夹住的项目「冻结」，尺寸从可用空间扣掉，其余项目重新分配。**只要有一个项目被上下限夹住，其余项目的比例就变了**，这是「按公式算完却对不上」的根源。

### 表 1：三个 100px 内容的项目放进 400px 容器

统一输入：容器 `display: flex`、内容盒 400px、无 padding/border/gap/margin，子项内容宽各 100px，并显式写 `min-width: 0` 关掉自动最小尺寸（下限生效见后面的表）。

| 子项写法 | 展开 | Σ 基准 | 剩余空间 | 每项增量 | 最终宽度 |
| --- | --- | --- | --- | --- | --- |
| `flex: 1` | `1 1 0%` | 0 | +400 | +133.33 | **133.33px** |
| `flex: 1 1 0` | `1 1 0px` | 0 | +400 | +133.33 | **133.33px** |
| `flex: auto` | `1 1 auto` | 300 | +100 | +33.33 | **133.33px** |
| `flex: 1 1 auto` | 同上 | 300 | +100 | +33.33 | **133.33px** |
| `flex: initial` | `0 1 auto` | 300 | +100 | grow 为 0，不分 | **100px**（右剩 100px） |
| `flex: none` | `0 0 auto` | 300 | +100 | 不分也不收缩 | **100px** |
| 什么都不写 | `0 1 auto` | 300 | +100 | 不分 | **100px** |

前四行收敛到同一个数不是巧合：内容宽相等、grow 相等时，「从 0 起均分」与「从内容起均分剩余」结果相同。**`flex: 1` 与 `flex: 1 1 0` 的差别只在容器主轴尺寸不确定时**——`0%` 需要按容器解析，解析不了就退化成 `auto`；本例容器是确定的 400px，所以完全一致。

133.33 × 3 = 399.99，余下的 0.01px 由浏览器补齐，DevTools 里很可能读到 `133.33 / 133.33 / 133.34`。那是舍入，不是算法差异。

### 表 2：内容宽度不等时立刻分叉

容器仍 400px，三项内容宽 40 / 60 / 100px，`min-width: 0`。

| 子项写法 | Σ 基准 | 剩余空间 | 最终宽度 | 比例 |
| --- | --- | --- | --- | --- |
| `flex: 1` | 0 | +400，各 +133.33 | 133.33 / 133.33 / 133.33 | **严格 1:1:1** |
| `flex: auto` | 200 | +200，各 +66.67 | 106.67 / 126.67 / 166.67 | 内容宽的更宽 |
| `flex: 1 1 100px` | 300 | +100，各 +33.33 | 133.33 / 133.33 / 133.33 | 等宽（基准相同） |

**想严格等宽就把基准归零**；想让宽度保留内容差异（工具条按钮按文字长度自适应）就保留 `auto`。

### 表 3：收缩方向，加权与均分不同

| 输入 | 基准 | 算法 | 最终 |
| --- | --- | --- | --- |
| 容器 200px，三项各 100px，`flex: auto`，`min-width: 0` | Σ=300，溢出 −100 | 每项减 100×(1×100/300)=33.33 | **各 66.67px** |
| 容器 200px，同上但 `flex: 1` | Σ=0，自由 +200 | 均分 grow | **各 66.67px** |
| 容器 250px，A 内容 100、B 内容 250，均 `flex: auto` | Σ=350，溢出 −100 | A 减 100×100/350=28.57；B 减 71.43 | **A 71.43 / B 178.57** |
| 容器 250px，同上但均 `flex: 1 1 0` | Σ=0，自由 +250 | 均分，与内容无关 | **各 125px** |
| 容器 250px，A、B 均 100px 内容，均 `flex: 0 1 auto` | Σ=200，自由 **+50** | grow 为 0，不分配 | **各 100px，剩 50px 空白** |

最后一行：`flex-grow: 0` 时容器留白，不是 bug，空白归 `justify-content` 管。

### 表 4：`min-width: auto` 这张下限生效的表

全站 flex 问题出现频率最高的一张。容器 200px、**一个**项目、项目内是一段不可断行的长 URL，其 min-content 尺寸假设 260px。

| 子项写法 | 理想尺寸 | 第 ④ 步夹紧 | 最终 | 后果 |
| --- | --- | --- | --- | --- |
| `flex: 1 1 0`，`min-width` 保持 `auto` | 200px | 自动最小尺寸 = min-content = 260 | **260px** | 容器被撑破；省略号不生效 |
| `flex: 1 1 0` + `min-width: 0` | 200px | 下限 0 | **200px** | 内容溢出项目，`overflow: hidden` + `ellipsis` 开始工作 |
| `flex: 1 1 0` + `overflow: hidden` | 200px | 项目是滚动容器 → 自动最小尺寸 0 | **200px** | 同上，内容被裁 |
| `flex: none` | 260px（基准=内容） | 不收缩 | **260px** | 溢出，符合「固定尺寸」预期 |

<Callout type="verified" title="自动最小尺寸的取值规则已核实">

核实于 2026 年 10 月 17 日，来源 [MDN `min-width`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/min-width)：`min-width: auto` 对块盒、行内盒解析为 `0`，但「对于弹性项目和网格项目，最小宽度取指定的建议尺寸（例如 `width` 的值）、转移尺寸（设了 `aspect-ratio` 且高度确定时计算），否则使用 `min-content` 尺寸」；且「如果该弹性或网格项目是滚动容器，自动最小尺寸为 `0`」。

最后一句就是表 4 第三行的依据：不必写 `min-width: 0`，让项目成为滚动容器同样能把下限压到 0。

</Callout>

## flex-basis 与 width 谁赢

`flex-basis` 是长度或百分比时**它赢**，`width` 在主轴方向被忽略（但仍参与自动最小尺寸里的「建议尺寸」）。`flex-basis: auto` 时才回落到 `width`。

- `flex-basis: 0` 与 `0%`：容器主轴尺寸确定时数值一致；**不确定**时百分比无法解析，`0%` 退化成 `auto`，`0` 仍是 `0`。这是「等宽突然失效」的现场。
- 两者都受 `box-sizing` 影响：`content-box` 下基准是内容盒，`border-box` 下含 padding 与 border。这正是[第 3 章](/css/box-model)要求全局 `border-box` 的原因——否则 `flex-basis: 200px` 配 `padding: 12px` 两套盒模型差 24px。
- 百分比基准解析的是**容器内容盒的主轴尺寸**，不是父项目尺寸。
- `min-width`/`max-width` 在第 ④ 步夹紧，优先级高于分配结果。

## 对齐：四个属性的分工与 gap

| 属性 | 哪条轴 | 管什么 | 常用值 |
| --- | --- | --- | --- |
| `justify-content` | 主轴 | 一行内所有项目 + 多余空间的分布 | `flex-start` / `center` / `flex-end` / `space-between` / `space-around` / `space-evenly` |
| `align-items` | 交叉轴 | 这一行里**每个**项目的位置或拉伸 | `stretch`（初始值）/ `flex-start` / `center` / `flex-end` / `baseline` |
| `align-self` | 交叉轴 | **单个项目**覆盖 `align-items` | 同上，另加 `auto` |
| `align-content` | 交叉轴 | **多行之间**如何分配整块空间 | `stretch` / `center` / `space-between` / … |

三条易错规则：

1. **`align-items: stretch` 只在项目交叉轴尺寸为 `auto` 时生效。** 写了 `height: 100px` 就不拉伸。等高卡片的正解是保持默认 `stretch`，卡片内部再 `flex-direction: column` 让正文吃掉剩余高度。
2. **`align-content` 在单行容器上看不到效果。** 它分配行与行之间的空间，只有一行时无从分配。「写了 `align-content: center` 为什么还贴顶」不是 bug，单行交叉轴居中用 `align-items: center`。
3. **`space-between` 两端贴边，`space-evenly` 才等距留边。** 换行时不满的最后一行也会被 `space-between` 拉散——标签云最后一行分居两端就是这个。

`gap`（= `row-gap column-gap`）加在**项目之间**、不加在容器边缘，比 `margin` 方案干净：不需要 `*:not(:last-child)` 这类选择器补间距（衔接[第 2 章 选择器](/css/selectors)）。

<Callout type="warn" title="row-gap 与 column-gap 分别落在哪条轴本章未核实">

`gap: 20px` 简写在 `flex-direction` 为 `row` 和 `column` 时都能得到 20px 项目间距，日常够用。但**只写一个长写属性**（例如只写 `column-gap`）时，在多行 + `column` 方向的容器里间距落在哪条轴，各家文档与实现历史上不一致。需要精确控制时就用 `gap` 简写设等值，或在 DevTools 的 Flexbox 覆盖层里直接看间距画在哪；规范口径以 [MDN `gap`](https://developer.mozilla.org/en-US/docs/Web/CSS/gap) 当前内容为准复核。

</Callout>

## flex-wrap、多行与 order

`nowrap`（默认）不换行，宁可收缩，收缩到自动最小尺寸为止然后溢出。`wrap` 才允许换行，`wrap-reverse` 把行的堆叠方向反过来。换行判定看**收缩后的总尺寸**是否仍超可用空间，所以一个被 `min-width: auto` 卡住的大项目能独自占满一整行——「明明设了 `width: 30%` 怎么一行只放两个」的原因之一就是基准 30% 加上 padding、gap 后已超 30%。

`gap: 16px` 配 `flex-basis: 25%` 会吃掉 3 处共 48px，导致每行只放得下 3 个；再用 `space-between`，最后一行就被拉散。**二维严格对齐该用 Grid，别用 flex-wrap 硬凑**（下一章）。

`order: <整数>`，初始 `0`，只改**视觉顺序**，不改 DOM、不改 Tab 焦点顺序、不改读屏器朗读顺序（无障碍要求见 [HTML](/html/)）。所以 `order` 适合「把主按钮挪到右边」这种小事，不适合重排语义顺序；用它做视觉重排时，DOM 里必须写成用户应当经历的顺序。

## 常见错误与排查

**1. 子项不收缩、容器横向溢出。** 现象：`flex-basis: 300px` 的项目在小屏不缩。原因：`flex-shrink` 被写成 `0`（常见于 `flex: none`），或 shrink 是 `1` 但被 `min-width: auto` 顶住。确认：Computed 看 `flex-shrink` 和 `min-width`；`min-width` 是 `auto` 且 `width` 等于内容 min-content 就是后者。修法：要收缩写 `flex: 1 1 auto` + `min-width: 0`；要固定就明确 `flex: none` 并保证容器够宽。

**2. `text-overflow: ellipsis` 完全不生效。** 现象：三件套齐了文字仍撑破父级。原因：省略号的前提是宽度**受限**，而 flex 子项的自动最小尺寸 = min-content，`white-space: nowrap` 下 min-content 就是整行文字宽。确认：临时把 `white-space` 改回 `normal`，布局立刻正常即为下限问题。修法：该子项加 `min-width: 0`（或 `overflow: hidden`）——第 5 章最高频的一行修复。

**3. 只写 `flex-grow: 1` 结果不等宽。** 原因：`basis` 仍是 `auto`，内容宽差被保留（表 2 第二行）。确认：把三段文本改成等长，宽度立刻相等。修法：写完整 `flex: 1 1 0` 或 `flex: 1`。

**4. 改成 `column` 后「对齐属性突然全不对」。** 原因：主轴换了归属，`justify-content` 与 `align-items` 物理方向互换。确认：先回答「现在主轴是横还是竖」再看属性。修法：改思维不改规则。

**5. `align-items: center` 后背景不再铺满整行。** 原因：`align-items` 初始值才是 `stretch`，改 `center` 等于放弃拉伸，高度回落内容高。确认：看子项 `height` 是否等于行高。修法：保留 `stretch`，垂直居中交给子项内部的 `display: flex`。

**6. flex 子项里 `height: 100%` 失效。** 原因：百分比高度要解析成**确定的**父项高度；容器高度由内容决定时没有可解析的基准，父项被 `stretch` 拉伸也不保证百分比跟随。确认：父项 Computed `height` 是 `auto`/0 即是。修法：用默认 `stretch` + 内部 `flex: 1` 撑开，或迁到 Grid 用 `1fr` 行轨道。

**7. 幽灵项目或多出的空白格。** 现象：容器里莫名多一格空隙。原因：clearfix 的 `::after` 在 flex 容器里变成真实项目，或某个 `width: 0` 的元素仍占一个主轴位。确认：DevTools 的元素树里看容器实际子项数（伪元素要单独看 Computed）。修法：删掉 clearfix，改 `display: flow-root`（见[第 4 章](/css/flow-and-bfc)）。

**8. `gap` 与旧的 `margin-right` 双重间距。** 现象：迁移后间距翻倍。确认：Layout 面板盒模型图 + 覆盖层间距标注。修法：一律 `gap` 优先，清掉方向性 margin，只在需要容器外边距时保留。

## 练习

<Exercise title="练习 1 · 预测四种写法下的宽度" difficulty="基础">

容器 `display: flex; width: 500px`，无 padding、gap、边框。三个子项内容宽 80 / 120 / 100px，`min-width` 均为 `0`。下面四种写法各应用到**全部**子项（共四种情形），算出每种情形下三个子项的最终宽度，并指出哪两种写法在此场景下等价。

```css
.a { flex: 1; }
.b { flex: auto; }
.c { flex: initial; }
.d { flex: none; }
```

<template #answer>

Σ内容宽 = 300px，容器 500px。

| 写法 | 展开 | Σ 基准 | 剩余空间 | 最终宽度（80/120/100 顺序） |
| --- | --- | --- | --- | --- |
| `flex: 1` | `1 1 0%` | 0 | +500，各 +166.67 | 166.67 / 166.67 / 166.67 |
| `flex: auto` | `1 1 auto` | 300 | +200，各 +66.67 | 146.67 / 186.67 / 166.67 |
| `flex: initial` | `0 1 auto` | 300 | +200，grow 0 不分 | 80 / 120 / 100，右剩 200px |
| `flex: none` | `0 0 auto` | 300 | +200，不分不缩 | 80 / 120 / 100，右剩 200px |

**等价的是 `initial` 与 `none`**——在「剩余空间为正」的场景里两者都是 grow 0，差别（shrink 1 对 0）根本没触发。把容器改成 200px 再算就分叉：`initial` 按 `1×basis/300` 加权收缩，溢出 100px → A 减 26.67、B 减 40、C 减 33.33，得 **53.33 / 80 / 66.67**（合计 200）；`none` 仍是 80 / 120 / 100，溢出 100px。

所以真正要记的是：**`1` 对 `auto` 差在基准，`initial` 对 `none` 差在收缩。**

</template>

</Exercise>

<Exercise title="练习 2 · 为什么 min-width 0 能救省略号" difficulty="基础">

`min-width: 0` 那一行被注释掉了。请说明：① `.title` 实际多宽；② 为什么省略号没出现；③ 取消注释后第 ④ 步夹紧发生了什么。

```css
.wrap { width: 300px; display: flex; gap: 8px; }
.badge { flex: none; }                        /* 内容宽 60px */
.title { flex: 1 1 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* .title { min-width: 0; } */
```

假设 `.title` 里是一串不换行文字，其 min-content 宽 420px。

<template #answer>

可用空间 = 300 − 60（badge，`flex: none` 即 `0 0 auto`，基准 60） − 8（gap） = 232px。`.title` 基准 0 且是唯一 grow 项 → 理想尺寸 232px。

① 注释掉 `min-width: 0` 后，`min-width: auto` 的自动最小尺寸取 min-content。因为写了 `white-space: nowrap`，整段文字不可断行，min-content = 420px。第 ④ 步把理想值 232 抬到 **420px**。`.wrap` 自身边框盒仍是 300px（宽度由外部约束决定），需求 60 + 8 + 420 = 488px → 溢出 188px。

② 省略号需要「宽度受限」且「内容超出」。这里 `.title` 宽度根本没被限制（它自己就是 420px），内容恰好等于宽度，`overflow: hidden` 无东西可裁，`text-overflow` 无事可做，文字一路伸出容器。

③ 取消注释后下限为 0，夹紧不再抬升，`.title` 落在 232px；420px 文字在 232px 盒里被裁，`text-overflow: ellipsis` 才有内容替换成省略号。

补充：`overflow: hidden` 单独也能修——按核实过的 `min-width` 规则，项目成为滚动容器时自动最小尺寸直接是 0。本题两者都写了，任一生效即可。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造只有窄屏才暴露的溢出" difficulty="进阶">

下面这段导航（5 个链接）**只改一个声明**，让它在 1200px 容器里完全正常、在 375px 容器里必然横向溢出。写出你改的声明，并给出 DevTools 一步确认的方法。

```css
.nav { display: flex; gap: 12px; padding: 8px; }
.nav a { flex: 1 1 220px; color: inherit; text-decoration: none; }
```

<template #answer>

改法：`flex: 1 1 220px` → `flex: 1 0 220px`（`flex-shrink` 归零）。

**宽屏为什么正常**：容器 1200px，内容盒 = 1200 − 2×8 = 1184px；4 处 gap 共 48px；可用 = 1184 − 48 = 1136px。Σ 基准 = 5 × 220 = 1100px < 1136，自由空间 +36px 按 grow 均分 → 每项 +7.2px，得 227.2px，合计正好 1136。看起来整齐贴边，无任何异常。

**窄屏为什么溢出**：容器 375px，内容盒 359px，可用 = 359 − 48 = 311px，而 `shrink: 0` 使 Σ 基准固定 1100px。第 ③ 步不做收缩，第 ④ 步也没有可抬升的下限 → 五个项目共 1100px 硬塞进 311px，**溢出 789px**，页面出现横向滚动条。

**一步确认**：选中容器，打开 Layout → Flexbox 覆盖层，项目的主轴尺寸会被描出来；再把 `flex-shrink` 临时改回 `1`（DevTools 里直接编辑规则），溢出立刻消失就证明收缩被关掉是唯一致因。若改回 `1` 仍溢出，说明还有第二个原因——子项 `min-width: auto` 顶住了下限，此时去 Computed 看 `min-width` 读数区分。同一个现象两个成因，靠这条区分。

正确修法：`flex: 1 1 220px` 配窄屏 `flex-wrap: wrap`，或整块改用 Grid 的 `repeat(auto-fill, minmax(220px, 1fr))`（下一章）。

</template>

</Exercise>

<Exercise title="练习 4 · 三栏布局的基准设计" difficulty="挑战">

需求：横向卡片，左图标固定 48px，中间正文（可能有很长 URL，要省略号），右按钮宽度按文字自适应（按 64px 计）。三者 `gap: 16px`。写出全部 CSS，并算出容器 1024px 与 320px 时正文区的宽度。

<template #answer>

```css
.card   { display: flex; gap: 16px; align-items: flex-start; box-sizing: border-box; }
.icon   { flex: none; width: 48px; }
.text   { flex: 1 1 0; min-width: 0; overflow: hidden;
          white-space: nowrap; text-overflow: ellipsis; }
.action { flex: none; }
```

可用空间 = 容器内容盒 − Σ(不生长项基准) − Σgap（两处共 32px）。

- 1024px：1024 − 48 − 64 − 32 = **880px**，`.text` 独占全部自由空间。
- 320px：320 − 48 − 64 − 32 = **176px**。基准为 0，所以这不是收缩而是均分（自由空间仍为正 176px），`.text` 直接得 176px。
- 再窄就线性吃掉：200px 时是 200 − 144 = 56px，仍然不溢出。这正是「基准归零 + `min-width: 0`」的价值——收缩路径没有拐点，不会出现「算完发现要收缩两次」的抖动。

三个易错点：① 图标和按钮必须 `flex: none`。只写 `width: 48px` 不够，`width` 不阻止收缩，小屏下会被压（或被它的 min-content 顶成溢出）。② `.text` 的 `min-width: 0` 不能省，否则长 URL 直接撑破三栏。③ `align-items: flex-start` 是为了按钮不被拉成整行高；要等高就让每张卡内部各自 `flex-direction: column`，而不是给三者写同一个固定高度。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN `flex`](https://developer.mozilla.org/en-US/docs/Web/CSS/flex)（[中文](https://developer.mozilla.org/zh-CN/docs/Web/CSS/flex)）—— **已核实**：`initial`/`auto`/`none`/单数字的展开值与形式化语法。用来复核表 1、表 2 每行的输入值。
- [MDN `flex-direction`](https://developer.mozilla.org/en-US/docs/Web/CSS/flex-direction) —— **已核实**：`row` 与文本方向一致、`column` 与块轴一致、受 `dir` 影响。核实「竖排书写模式下主轴方向」一节。
- [MDN `min-width`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/min-width) —— **已核实**：弹性项目自动最小尺寸取 min-content、滚动容器时为 0。核实表 4 与常见错误 1、2。
- [MDN `flex-shrink`](https://developer.mozilla.org/en-US/docs/Web/CSS/flex-shrink) —— 核实收缩按 `shrink × basis` 加权，即表 3 第 3 行的算法依据。
- [MDN `flex-basis`](https://developer.mozilla.org/en-US/docs/Web/CSS/flex-basis) —— 核实 `auto` 回落到 `width`、`box-sizing` 如何影响基准解析。
- [MDN 弹性容器中的项目对齐](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_flexible_box_layout/Aligning_items_in_a_flex_container) —— 核实四个对齐属性的轴归属，以及 `align-content` 在单行容器上的表现。
- [MDN Flexbox 布局指南（中文）](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_flexible_box_layout) 与 [基本概念](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_flexible_box_layout/Basic_concepts_of_flexbox) —— 核实「弹性容器 / 项目 / 两条轴」术语，以及 `flex-shrink`、`flex-basis` 的初始值与子项块级化。
- [CSS Flexible Box Layout Level 1 规范](https://www.w3.org/TR/css-flexbox-1/) —— §9.3 是本章四张推演表的原始算法来源；「文档与浏览器不一致」时以此为准。
- [MDN `gap`](https://developer.mozilla.org/en-US/docs/Web/CSS/gap) —— 本章标为未核实的「长写属性落在哪条轴」，以此页当前内容复核。
- 前置：[盒模型与外边距折叠](/css/box-model)、[常规流与格式化上下文](/css/flow-and-bfc)。排查路径见 [调试布局](/css/debugging-layout)。

## 下一章

Flexbox 只有一条主轴，交叉轴上的关系全靠 `align-*` 和嵌套结构去凑——「标题区等高、正文区也等高」的卡片、「第 3 列跨两行」的仪表盘，它表达不了。下一章 [Grid：轨道、fr 单位与响应式卡片墙](/css/grid) 把决策权从项目交回容器：先在 `grid-template-columns` 里定好轨道再放项目，并且能写出完全不依赖媒体查询的响应式卡片墙。尺寸分配还有卡住的地方，先用 [调试布局](/css/debugging-layout) 的 Flexbox 覆盖层把真实尺寸读出来再回来对表。
