# Grid：先定轨道再放项目，fr 分的是剩余空间

一个卡片墙，`grid-template-columns: repeat(3, 1fr)`，看着很稳。上线后有人在卡片里放了一个 40 字符的英文链接，第一列被撑到 520px，三列变成两列加一条横向滚动条。另一个「响应式」卡片墙写了四个断点，客户把它塞进 320px 宽的侧边栏，四张卡直接叠成一列超宽。

两个问题都出在同一个误解上：把 `1fr` 当成「等宽的一份」。`fr` 分配的是**剩余空间**，而且裸写的 `1fr` 隐含一个下限——项目内容的 min-content。理解这两点，横向滚动和断点表能同时少掉一大半。

本章表格都是**按规范算法手算**的结果，我没有在你的环境里跑布局探针，所以不写「实测」。核对方法统一：Chrome DevTools 选中容器 → Elements 面板右侧 Layout 区块勾选 Grid 覆盖层，轨道线、轨道尺寸、项目跨度会直接画在页面上；单个项目再进 Computed 读 `width`/`height`。

## 轨道是 Grid 的第一等公民

Flexbox 里容器只说「你们几个依次排」，尺寸由项目自己贡献；Grid 反过来：**先在容器上把轨道（track）定好，再决定项目放进哪条轨道**。轨道就是 `grid-template-columns` / `grid-template-rows` 里的一个个尺寸函数，它们之间的边界叫**线（line）**，线之间围出的矩形叫**格（cell）**，项目占据的一块或多块格叫**网格区域（grid area）**。

```css
.layout {
  display: grid;
  grid-template-columns: 240px 1fr 320px;   /* 三条列轨道 */
  grid-template-rows: auto 1fr auto;        /* 三条行轨道 */
  gap: 16px 24px;                            /* row-gap column-gap */
}
```

写在这里的六个尺寸函数**与项目内容无关地先成立**（除了下面会看到的 `fr` 隐含下限）。这是 Grid 能「不依赖媒体查询做响应式」的根因：轨道规则是容器的一条声明，项目数量变了也不用改它。

## fr 的真实语义：分剩余空间，且自带 min-content 下限

<Callout type="verified" title="fr、auto、min-content、max-content 的定义已在 MDN 核实">

核实于 2026 年 10 月 17 日，来源 [MDN `grid-template-columns`](https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-columns)：

- `fr`：「一个带 `fr` 单位的非负维度，指定轨道的 flex 因子。每个以 `<flex>` 定尺寸的轨道按其在剩余空间中占的比例取值」，并且「**出现在 `minmax()` 之外时，它隐含一个自动最小值（即 `minmax(auto, <flex>)`）**」。
- `max-content`：「占用该轨道的网格项目中最大内容贡献（maximal content contribution）」。
- `min-content`：「占用该轨道的网格项目中最大最小内容贡献（minimal content contribution）」。
- `auto` 作为最大值取该轨道项目的 `max-content`；作为最小值取「项目中最大的最小尺寸（由 `min-width`/`min-height` 指定），通常对应 `min-content`，但并非总是」。
- 「**只有 `auto` 轨道尺寸能被 `align-content` 与 `justify-content` 拉伸**，因此默认情况下 `auto` 定宽的轨道会占满剩余空间。」

</Callout>

这四条各自意味着什么，用一张表看：

| 尺寸函数 | 基准来自 | 会随容器变宽而变宽吗 | 内容能把它撑破吗 |
| --- | --- | --- | --- |
| `<length>`（`240px`） | 你写的数 | 不会 | 会（内容溢出轨道，轨道尺寸不变） |
| `min-content` | 轨道内所有项目里最大的最小内容宽 | 不会 | 不会（它就是内容的下限） |
| `max-content` | 轨道内最大的完整内容宽（不换行时的宽度） | 不会 | 不会，但可能把整行撑出容器 |
| `auto` | 等价 `minmax(auto-min, max-content)`，再被拉伸吃掉剩余空间 | **会**（可被 `justify-content` 拉伸） | 撑破方式是「变得很宽」而不是溢出 |
| `1fr` | 等价 `minmax(auto, 1fr)`：先给所有非 fr 轨道和 gap 让路，再按因子分剩余 | **会**（吃掉全部剩余） | **会**：下限是 min-content，长词能把轨道顶到超过容器 |
| `minmax(0, 1fr)` | 同上但下限归零 | 会 | 不会，内容只会在格子里溢出 |

最后一行就是本章开头那个 bug 的修法。**把 `repeat(3, 1fr)` 写成 `repeat(3, minmax(0, 1fr))`**，轨道宽度就变成纯算术、不再受内容勒索。

### 数一数列：fr 分的到底是什么

容器内容盒 600px，`gap: 20px`：

```css
.grid { width: 600px; display: grid; gap: 20px;
        grid-template-columns: 200px 1fr 2fr; }
```

步骤：① 先扣固定轨道和间距 → `600 − 200 − 2×20 = 340px` 是「剩余空间」。② `fr` 因子合计 3 → `1fr = 340/3 = 113.33px`，`2fr = 226.67px`。③ 校验：`200 + 113.33 + 226.67 + 40 = 600` ✓。

注意 113.33 **不是** 容器宽度的 1/3（那是 200px），而是**剩余**的 1/3。这就是「`fr` 是剩余空间的份额」的实际含义，也解释了为什么 `grid-template-columns: 200px 1fr` 的第二列在窄屏上会突然变得很挤——固定轨道优先吃掉了全部可用宽度。

下限什么时候生效：轨道内某项目的 min-content 大于 `113.33px`（比如一个不换行的 `<pre>` 或长 URL），该轨道就至少是那个 min-content，其余 `fr` 轨道按同一规则再算一遍——**总和超出容器，出现横向滚动**。规范里这一步是迭代：先按固定与 min 求和、扣掉不足、再分配，所以「一个项目撑破一列」的现场经常伴随「另外几列同时被压窄」。

## minmax() 与 auto 的配合

```css
.sidebar { grid-template-columns: minmax(180px, 25%) 1fr; }
```

`minmax(180px, 25%)`：下限 180px、上限容器宽度的 25%。当容器 600px 时上限 150px **小于**下限，`minmax` 的规则是**取下限**（`min` 优先，规范写作 max 小于 min 时结果等于 min），得 180px。这条规则很容易记反，写 `minmax` 时值得先在纸上算一遍上下限谁大。

`auto` 与 `1fr` 的差别在实践里只有一条要看：**`auto` 先按内容定尺寸、再吃剩余；`fr` 完全不看内容（除非被 min-content 顶住）**。想让列「按内容宽窄自适应」用 `auto`，想让列「按容器比例走」用 `fr`。两者混在一条声明里是常见需求（`auto auto 1fr`：两列贴内容、第三列填满剩余）。

## repeat() 与 auto-fill / auto-fit

`repeat()` 不只是少打几个字。`repeat(3, 1fr)` 是**确定 3 条轨道**；`repeat(auto-fill, …)` / `repeat(auto-fit, …)` 是**让容器自己数能放几条**。

<Callout type="verified" title="auto-fill 与 auto-fit 的差异已在 MDN 核实">

核实于 2026 年 10 月 17 日，来源 [MDN `repeat()`](https://developer.mozilla.org/en-US/docs/Web/CSS/repeat)：

- `auto-fill`：「指定一个自动重复器，重复到填满空间；解析为不导致有约束（有最大尺寸）的内容盒溢出的**最大**重复次数。」
- `auto-fit`：「表现与 `auto-fill` 相同，只是在放置完网格项目之后，**任何空的重复轨道会被塌陷（collapse）**。空轨道指没有放入或跨越其中的 in-flow 网格项目。」
- 塌陷的后果：「**被塌陷的轨道被视为单一固定尺寸函数 `0px`，其两侧的 gutter（间距）也随之塌陷。**」

最后那句常被忽略：`auto-fit` 消灭的轨道不仅宽度归 0，连它旁边的 `gap` 也一起消失，所以 `auto-fit` 的剩余空间是「轨道 + 间距」两笔一起回收的。

</Callout>

### 对照表：同样 5 个项目，容器宽度变化

输入：`grid-template-columns: repeat(auto-fill | auto-fit, minmax(200px, 1fr))`，`gap: 0`，5 个项目按默认顺序自动放置。轨道数 = 容器宽 ÷ 200px 向下取整。

| 容器内容盒 | 轨道数 | 空轨道 | `auto-fill` 每轨 | `auto-fit` 每轨 |
| --- | --- | --- | --- | --- |
| 400px | 2 | 0（第 1 列放 1、3、5，第 2 列放 2、4） | 200px | **200px（完全相同）** |
| 600px | 3 | 0（三列各至少一项） | 200px | **200px（相同）** |
| 1000px | 5 | 0（一行正好放满） | 200px | **200px（相同）** |
| 1200px | 6 | 1（第 6 列无项目） | 200px，右侧留 200px 空白 | 塌陷 → 5 轨 → **240px** |
| 1400px | 7 | 2 | 200px，右侧留 400px 空白 | 塌陷 → 5 轨 → **280px** |

**这张表最重要的结论是反直觉的：5 个项目时，容器窄于 1200px 两者完全等价。** 因为「空轨道」的判定是**整条列**没有任何项目，而自动放置会依次填满每一列——项目数 ≥ 列数时不存在空列。想让 `auto-fit` 体现价值，得是「项目数少于列数」的场景：

| 容器内容盒 | 轨道数 | 空轨道（3 个项目） | `auto-fill` | `auto-fit` |
| --- | --- | --- | --- | --- |
| 600px | 3 | 0 | 各 200px | 各 200px |
| 800px | 4 | 1 | 各 200px，右侧空 200px | 塌陷 → 3 轨，各 266.67px |
| 1000px | 5 | 2 | 各 200px，右侧空 400px | 塌陷 → 3 轨，各 333.33px |

`gap` 参与计算时轨道数会变小，且塌陷会回收间距。以 `gap: 20px`、容器 1000px、`minmax(200px, 1fr)` 为例：可放列数 = `floor((1000 + 20) / (200 + 20)) = 4`。`auto-fill` → 4 条轨道、3 处间距共 60px，剩余 `940 / 4 = 235px` 每轨；3 个项目占前 3 列，第 4 列空。`auto-fit` → 第 4 列塌成 `0px` **且它左侧那处 20px 间距也塌陷** → 3 条轨道、2 处间距 40px，`(1000 − 40) / 3 = 320px` 每轨。

选型口径：**`auto-fill` = 「格子数固定，空位留白」**（适合要对齐到网格的仪表盘、日历）；**`auto-fit` = 「项目少时把空位吃掉、剩余项目拉伸铺满」**（适合 3 张卡片也要占满整行的营销页）。

## 显式网格与隐式网格

`grid-template-columns/rows` 声明的范围是**显式网格**。项目超出这个范围（放进行 4，而只定义了 3 行），浏览器就在外面**追加轨道**，那是**隐式网格**，尺寸由这三条控制：

```css
.rows { grid-template-columns: repeat(3, 1fr);
        grid-auto-rows: minmax(80px, auto);   /* 隐式行 */
        grid-auto-columns: 120px;             /* 隐式列 */
        grid-auto-flow: row; }                /* row | column | dense | row dense */
```

三个容易踩的地方：① `grid-auto-rows` 的初始值是 `auto`，隐式行会按内容撑开——这常导致「行高忽大忽小」。② `grid-template-rows` 里没写的行不受 `align-content` 之外的行为影响，但**只有 `auto` 轨道可被 `align-content`/`justify-content` 拉伸**（已核实），所以 `grid-auto-rows: 1fr` 与 `grid-auto-rows: auto` 在对齐表现上不同。③ 隐式轨道**不在 `-1` 的计数范围内**，见下一节。

## 线编号：grid-column: 1 / -1 的含义与陷阱

N 条轨道有 N+1 条线，编号从 1 开始；**负数从最后一根线往回数，`-1` 是显式网格的最后一条线**。

```css
.header { grid-column: 1 / -1; }   /* 从第 1 条线到显式网格最后一条线 = 横跨全部列 */
.item-a { grid-column: 2 / span 2; }  /* 从第 2 条线起占两列 */
```

`1 / -1` 是最常用的「占满整行」写法，但它的 `-1` 指的是**显式网格**的最后一条线。如果项目溢出到隐式轨道（比如你只声明了 3 列却有 5 列内容），`-1` 不包含那些隐式列，横跨范围就会比你以为的窄。安全做法是把列数交给变量或 `auto-fill`，然后让跨列项用命名线（下一节）而不是 `1 / -1`。

## 命名线与 grid-template-areas

命名线在尺寸函数前面用方括号：

```css
.layout { grid-template-columns: [full-start] minmax(1rem, 1fr) [content-start] min(1100px, 100% - 2rem) [content-end] minmax(1rem, 1fr) [full-end]; }
.layout { grid-column: full; }        /* 等价 1 / -1，但读得懂 */
.main   { grid-column: content; }
```

`grid-template-areas` 用字符串画出地图，每个字符串是一行、每个空格分隔的 token 是一格：

```css
.page {
  display: grid;
  grid-template-columns: 200px 1fr 1fr;
  grid-template-areas:
    "head head head"
    "nav  main aside"
    "nav  foot  ."      /* . 是空单元格 */
    ".    foot  .";
  gap: 12px;
}
.page > header { grid-area: head; }
.page > nav    { grid-area: nav; }
.page > main   { grid-area: main; }
```

<Callout type="verified" title="grid-template-areas 的矩形要求与空单元格已核实">

核实于 2026 年 10 月 17 日，来源 [MDN `grid-template-areas`](https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas)：空单元格是「一个或多个 `.` 字符组成的序列（如 `.`、`...`）」；「列出的每个字符串创建一行，字符串中的每个单元格创建一个列」；区域名必须写成带引号的 `<string>`；**「同名单元格创建的单个命名区域跨越这些格——除非这些格构成矩形，否则该声明无效（invalid）」**。

两个实际后果：① 每行的格数必须一致，否则该行被丢弃、后面的行整体错位；② 把 `a` 写成 L 形不会报错，而是**整条 `grid-template-areas` 声明失效**，症状是「区域名全都不生效」，页面退回自动放置。

</Callout>

`grid-area` 是 `grid-row-start / grid-column-start / grid-row-end / grid-column-end` 的简写，写名字时等价于放置到那个命名区域。用它给单个项目定位，比在容器上堆四个 `grid-template-areas` 更省事。

## 自动放置算法与 dense

没指定位置的项目按 `grid-auto-flow` 摆放，默认 `row`：**逐个尝试，从当前行的第一列开始，找到第一个能容纳该项目的连续空格就放下，然后游标继续向后（不回头）**。这就是「稀疏（sparse）」放置。

后果：一个大项目挡住位置后，后面本可以塞进空洞的小项目不会回填——

```css
.gallery { grid-template-columns: repeat(4, 1fr); grid-auto-rows: 120px; gap: 8px; }
.big     { grid-column: span 3; }          /* 第 1 行的 1-3 列 */
```

第 1 行只剩第 4 列，第 2 个项目只能去第 2 行，第 1 行第 4 列后面留下一条错位的空洞。**`grid-auto-flow: row dense`** 会改变这一点：允许后续小项目**回填**前面留下的空洞，代价是**视觉顺序与 DOM 顺序不再一致**（读屏器和键盘 Tab 仍按 DOM 走，见 [HTML](/html/)）。所以内容型列表慎用 `dense`，图库、仪表盘这类「位置不重要、密度优先」的场景才划算。

`grid-auto-flow: column` 让游标沿列推进（配合固定高度的容器做横向滚动的时间轴）；`column dense` 同理。想让某个项目先占位、其余绕开它，显式给它 `grid-row`/`grid-column` 就够了，不需要 `dense`。

## 子项对齐：justify-items、align-items、place-*、justify-self

Grid 里有三组「对齐」，管的层级完全不同，先分清层级再看轴：

| 属性 | 作用对象 | 轴 |
| --- | --- | --- |
| `justify-content` / `align-content` | **整个轨道块**在容器里怎么放（只有轨道总尺寸小于容器时才有空间可分；且仅 `auto` 轨道可被拉伸） | 行内 / 块 |
| `justify-items` / `align-items` | 容器内**所有项目**在自己格子内的位置 | 行内 / 块 |
| `justify-self` / `align-self` | **单个项目**覆盖 `*-items`（初始值 `auto` = 沿用容器） | 行内 / 块 |

`justify-self`/`align-self` 想生效，前提是该维度上项目尺寸**小于**格子——`stretch`（初始值）会把项目拉满格子，此时 `center` 看起来「没效果」。想居中就把项目宽度定死（`width: fit-content` 是最省事的写法）。

`place-*` 是两两合并的简写，顺序固定是**块轴在前、行内轴在后**：`place-items: center` = `align-items: center; justify-items: center`，`place-content: space-between center` = `align-content: space-between; justify-content: center`。于是那个著名的单行居中：

```css
.center-everything { display: grid; place-items: center; }
```

它比 `flex` 方案短，是因为 Grid 的两个轴各有一个独立属性，而 flex 需要 `justify-content` + `align-items` 两个名字，还得先想清楚主轴是哪条（[第 5 章](/css/flexbox)）。

## Grid 还是 Flexbox：选择边界

| 判据 | 用 Flexbox | 用 Grid |
| --- | --- | --- |
| 维度 | 一维（一行或一列） | 二维（行和列要对齐） |
| 谁决定尺寸 | **内容驱动**：项目多少、多宽决定排布（工具条、标签组） | **布局驱动**：先定轨道再塞项目（页面骨架、卡片墙） |
| 跨行跨列需求 | 表达不了 | `grid-column: span 2` |
| 「第 3 项要和第 7 项左边缘对齐」 | 做不到 | 天然成立 |
| 少量项目的自由排列 | 顺手 | 也能，但要写放置规则 |

一句话口径：**当你开始写 `nth-child` 或 `margin-left: auto` 去凑对齐，说明你需要 Grid；当你发现 Grid 里每条轨道都想用 `auto` 让内容说话，说明你需要 Flexbox。** 两者不互斥：外层 Grid 定骨架、组件内部 flex 排内容，是本站落地页项目（[阶段项目](/css/project)）的推荐搭法。

## 不依赖媒体查询的响应式卡片墙

```css
.cards {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
}
.cards > .card {
  display: grid;
  grid-template-rows: auto 1fr auto;   /* 标题 / 正文 / 页脚各自一行 */
}
.card__media { aspect-ratio: 16 / 9; object-fit: cover; }
```

```html
<ul class="cards">
  <li class="card"><img class="card__media" src="…" alt=""><h3>标题</h3><p>正文…</p><footer><a href="#">详情</a></footer></li>
  <!-- 再放 1～11 张，容器宽度任意 -->
</ul>
```

逐部分解释为什么这么写：

- **`repeat(auto-fit, …)`**：容器自己按 `minmax` 的下限去数能排几列（已核实的 `auto-fill` 定义：解析为不造成溢出的最大重复次数），项目数和列数都不需要写进 CSS。断点因此消失——不是「只有一个断点」，是**没有断点**。
- **`minmax(…, 1fr)` 的上限 `1fr`**：所有列等宽地吃掉剩余空间，宽屏上不会出现「280px 窄列 + 一大片右侧空白」。
- **为什么下限不写 `280px`**：`minmax(280px, 1fr)` 在容器窄于 280px 时（比如 320px 屏上被侧栏挤出来的 260px 卡片区域）会**强制轨道至少 280px**，直接产生横向溢出。下限必须能跟随容器收缩。
- **`min(100%, 280px)`**：这就是那一步。`100%` 在这里解析为**网格容器内容盒的宽度**，`min()` 取两者中较小的：容器 ≥ 280px 时下限是 280px（保持「每列不窄于 280」的设计意图），容器 < 280px 时下限自动降到容器宽，永不溢出。
- **为什么不用 `minmax(auto, 1fr)`**：`auto` 下限 = 项目 min-content，卡片里一个长链接就能把列顶宽；`min(100%, 280px)` 是固定/百分比下限，不受内容勒索。
- **`gap: 1rem`**：`auto-fit` 塌陷空列时相邻 `gap` 一起回收（已核实），所以卡片数不满一行时不会出现「最后一张卡右边挂着一段空白」。
- **卡内 `grid-template-rows: auto 1fr auto`**：让正文行吃掉多余高度，页脚始终贴底。跨卡片的行高**不会自动对齐**，因为每张卡是独立的网格根。要真正跨卡对齐标题/正文/页脚，就得用 `subgrid`（下一节）或把三行提到父容器上定义。

<Callout type="unverified" title="百分比在 auto-repeat 下限里的解析本章未核实">

`min(100%, 280px)` 中的 `100%` 我按「网格容器内容盒宽度」解释。规范里轨道尺寸的百分比基准与 `repeat(auto-fill/auto-fit)` 的重复次数计算是两件事，个别浏览器历史上在这里算错过（把百分比下限按错误基准解析，导致列数少算一列）。**本章没有核实具体实现进度**：动手前请在 DevTools 的 Grid 覆盖层里读出实际轨道数与每轨尺寸，再用 [Can I use](https://caniuse.com/css-grid) 复核你的目标浏览器；如果不确定，退一步用 `minmax(280px, 1fr)` 并接受「容器必须 ≥ 280px」这个约束，或者改用 `@container` 容器查询（[响应式设计](/css/responsive-design)）。

</Callout>

## grid 简写与 subgrid

`grid` 是 `grid-template` 系与 `grid-auto-*` 的超级简写：

```css
.a { grid: 60px / 1fr 2fr; }            /* 行 / 列；会重置命名线和 grid-template-areas */
.b { grid-template-columns: 60px; }     /* 只动一个维度，不会连带重置 */
```

**日常建议用 `grid-template-columns`/`-rows` 单独写。** `grid` 简写的重置行为（把没写的 `grid-template-areas` 清空、命名线丢失）很容易造成「我明明定义了区域名怎么全没了」。

`subgrid` 让子元素**继承父网格的轨道**而不是自建一套：

```css
.cards { display: grid; gap: 1rem;
         grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); }
.card  { display: grid;
         grid-row: span 3;                    /* 跨父网格的 3 条行轨道 */
         grid-template-rows: subgrid; }
.card > h3 { grid-row: 1; }                   /* 所有卡片的标题共用父网格的第 1 行 */
.card > p  { grid-row: 2; }
```

这样最高的那张卡决定第 1 行的高度，其余卡片的标题栏跟着变高，正文与页脚在所有卡片上水平对齐——这是 `grid-template-rows: auto 1fr auto` 各自为政的写法做不到的。前提：子项**必须明确跨足够的父轨道**（`grid-row: span 3`），否则 `subgrid` 只占一条轨道、失去意义。

## display: contents 的坑

```css
.card { display: contents; }   /* 卡片的盒子消失，它的子元素直接成为父网格的项目 */
```

它确实能让「语义上有一层容器、布局上想拍平」的写法成立（比如 `<ul>` 套 `<li>` 时让 `<li>` 直接成为网格项目）。三个代价：

1. **该元素自己的所有盒相关样式失效**——`background`、`border`、`padding`、`box-shadow` 都没地方画了。整卡要背景色就不能用 `contents`。
2. **可访问性风险。** 元素不生成盒子时，它在无障碍树里的角色可能一并丢失（`ul` 的列表语义、`nav` 的地标语义）。规范（CSS Accessibility）已要求保留元素自身的语义，但各浏览器进度不一，**本章未核实当前实现状态**，动手前用 DevTools 的 Accessibility 面板确认列表/地标是否还在；细节见 [HTML](/html/)。
3. **它不改变父容器的轨道定义。** 项目数量变多只是让更多项目参与自动放置，`dense`、隐式轨道那些规则照旧生效，别指望它「智能重排」。

替代方案：只想去掉某一层包装就改 HTML 结构（第 3 条也顺带解决）；需要背景/边框时把样式挂到真正的网格项目上，或用 `display: grid` + `grid-template-rows: subgrid` 保住结构。

## 常见错误与排查

**1. `repeat(3, 1fr)` 被一段长英文/URL 撑破，出现横向滚动。** 原因：裸 `1fr` = `minmax(auto, 1fr)`，下限是内容 min-content（已核实）。确认：Grid 覆盖层看该列实际宽度，是否远大于容器 ÷ 3。修法：`repeat(3, minmax(0, 1fr))`；文本侧配合 `overflow-wrap: anywhere`。

**2. `grid-column: 1 / -1` 没有横跨整行。** 原因：`-1` 只数到**显式网格**最后一条线，项目溢出到隐式列时范围比你以为的窄。确认：DevTools 里选中该元素看它跨越的线号，数一数容器声明了几条列轨道。修法：显式写死列数后再用 `1 / -1`，或改用命名线 `grid-column: full`。

**3. 写了 `grid-template-areas` 但所有区域名都不生效。** 原因：某个同名区域不成矩形，或某行的格数与其他行不一致——按已核实的规则，**整条声明无效**，不是部分生效。确认：把声明逐行抄到纸上数列数；临时只保留两行看是否恢复。修法：修正矩形与格数，用 `.` 补齐。

**4. 隐式行高忽大忽小 / 只有几行被撑开。** 原因：超出显式范围的行走的是 `grid-auto-rows`（初始 `auto`），你没定义它。确认：覆盖层里看行的编号，超出 `grid-template-rows` 数量的那些行是隐式行。修法：`grid-auto-rows: minmax(<行高>, auto)`，或干脆不写死行、全部交给 `auto` 拉伸。

**5. `justify-items: center` 没效果，或 `justify-content: center` 没效果。** 两种不同原因：`justify-items` 在 `stretch`（默认）下会把项目拉满格子，居中当然看不见——先给项目 `width: fit-content`；`justify-content` 只在**轨道总宽小于容器**时才有空间可分，而 `fr` 轨道已经把剩余空间吃光了，且只有 `auto` 轨道可被拉伸（已核实）——所以 `repeat(3, 1fr)` 配 `justify-content: space-between` 一定看不到效果。修法：把轨道改成固定长度或 `minmax(…, auto)`，或直接用 `max-width` 限容器宽。

**6. `auto-fit` 没把卡片拉宽。** 原因：项目数 ≥ 列数时**不存在空轨道**，`auto-fit` 与 `auto-fill` 等价（对照表第一张已经算过）。确认：数一下项目总数和覆盖层里的列数。修法：这不是 bug；真要「宽屏最多 4 列、卡片不无限拉伸」就给容器 `max-width: calc(280px * 4 + 3rem)` 或加一个 `repeat(4, …)` 配合容器查询。

**7. 轨道宽度和你算的不一样，总是差一层 padding。** 原因：`gap` 与百分比轨道解析的是**内容盒**，而容器上有 `padding`；`box-sizing` 是 `content-box` 时你按 `width` 扣的数是边框盒。修法：全局 `box-sizing: border-box`（[第 3 章](/css/box-model)），并且明确百分比下限的参照是内容盒。

**8. 用了 `display: contents` 之后背景消失、读屏器不再播报列表。** 见上一节。确认：Accessibility 面板里检查列表/地标语义。修法：改结构，或退回普通网格并把视觉样式挂到真实项目上。

## 练习

<Exercise title="练习 1 · 算出每条轨道的宽度" difficulty="基础">

容器内容盒 600px，`gap: 20px`。分别算出下列三种定义下每条列轨道的宽度，并说明第三种与前两种的差别在哪一步。

```css
.a { grid-template-columns: 1fr 1fr 1fr; }
.b { grid-template-columns: 150px 1fr 1fr; }
.c { grid-template-columns: minmax(220px, 1fr) 1fr 1fr; }
```

<template #answer>

**a**：无固定轨道，剩余 = `600 − 2×20 = 560`，因子合计 3 → 每轨 `186.67px`。校验 `3×186.67 + 40 = 600` ✓。

**b**：先扣固定 150px → 剩余 `600 − 150 − 40 = 410`，两条 `1fr` → 各 `205px`。**注意 `1fr` 不等于 200px**（600 的 1/3），它分的是剩余空间。

**c**：三条都是 `1fr` 上限，初分各 `186.67px`。第 1 条轨道下限 `220px > 186.67px` → 被抬到 `220px`，多占 `33.33px`。冻结第 1 条，剩余 `600 − 220 − 40 = 340` 给后两条 → 各 `170px`。结果 **220 / 170 / 170**。

差别就在「**夹紧后重跑分配**」这一步——和第 5 章 flex 的第 ④ 步是同一套迭代思想：任何轨道被下限顶住，其余轨道都要重新算。所以「按公式一次算完」在带 `minmax` 的网格里经常得出错误结论。

</template>

</Exercise>

<Exercise title="练习 2 · 判断 auto-fill 与 auto-fit" difficulty="基础">

定义：`grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))`，`gap: 0`，容器内容盒 700px。

① 有几条轨道、每条多宽？② 放 8 个项目时，两行各放几个、有没有空轨道？③ 把 `auto-fill` 换成 `auto-fit`，结果变不变？④ 放 3 个项目时，两个关键字各是什么结果？

<template #answer>

① 轨道数 = `floor(700 / 160) = 4`。Σ 基准 4×160 = 640，剩余 60px 由 4 条 `1fr` 均分 → **每轨 175px**（合计 700 ✓）。

② 8 个项目 → 2 行 × 4 列正好填满，**没有空轨道**。

③ **不变。** 空轨道的定义是「整条轨道没有任何项目」（已核实），4 列都有项目，所以 `auto-fit` 无可塌陷，与 `auto-fill` 完全等价。

④ 3 个项目 → 第 1 行放 1、2、3 列，**第 4 列整列全空**。`auto-fill`：4 条轨道各 175px，右侧 175px 是空的。`auto-fit`：第 4 列塌成 `0px` → 剩 3 条轨道，`700 / 3 = 233.33px` 每轨，三个项目被拉宽铺满整行。

这题考的就是那条反直觉规则：**`auto-fit` 只在「项目数 < 轨道数」时才与 `auto-fill` 分道扬镳**，项目再多也拉不出差别。

</template>

</Exercise>

<Exercise title="练习 3 · 故意写坏 grid-template-areas 并解释症状" difficulty="进阶">

下面用 `grid-template` 简写声明了行列与区域。上线后的症状是：**整页所有元素垂直堆成一列，两列轨道像完全不存在**，控制台没有任何报错。请解释为什么，并给出修正后的声明。

```css
.page {
  display: grid;
  grid-template:
    "head head" 60px
    "side main" 1fr
    "main foot" auto / 200px 1fr;
}
.page > header { grid-area: head; }
.page > aside  { grid-area: side; }
.page > main   { grid-area: main; }
.page > footer { grid-area: foot; }
```

<template #answer>

`main` 这个 token 出现在第 2 行第 2 列和第 3 行第 1 列，两个格组成的形状是**对角线，不是矩形**。按已核实的规则：「除非这些格构成矩形，否则该声明无效」。

关键在于「无效」的作用域：这里写的是 `grid-template` **简写**，一条声明要么整体生效、要么整体作废。作废之后 `/` 后面的 `200px 1fr` 列轨道也一起没了——显式网格变成 0 条列、0 行，于是所有项目退回自动放置，各自落进追加出来的隐式轨道，视觉上就是「全部堆成一列」。这正是常见错误 3 里「区域名全都不生效」的放大版：不是某一行写错，是整条声明被丢弃。

修正：把 `main` 改成矩形（只占第 2 行第 2 列），页脚横跨第 3 行：

```css
.page {
  grid-template:
    "head head" 60px
    "side main" 1fr
    "foot foot" auto / 200px 1fr;
}
```

逐条复核：`head` = 第 1 行两格（1×2 矩形 ✓）；`side` 单格 ✓；`main` 单格 ✓；`foot` = 第 3 行两格 ✓；每行都是 2 个 token，与 `/` 后的两条列轨道数量一致 ✓。若确实需要 `main` 覆盖第 2、3 行的第 2 列，就写成 `"side main"` + `". main"`（用 `.` 补空单元格），它同样是矩形。

排查动作（两步就能定位这类问题）：① DevTools 选中容器，Layout 面板看 Grid 覆盖层——**区域覆盖完全不出现**说明整条声明被判无效，而不是某一行的问题；② 把声明拆成 `grid-template-columns` + `grid-template-rows` + `grid-template-areas` 三条分别写，作废面就只有区域那一条，症状会从「整页塌掉」降级成「区域没生效」，好定位得多。这也是日常更推荐分开写的原因之一。

</template>

</Exercise>

<Exercise title="练习 4 · 把断点表删掉" difficulty="进阶">

一个卡片墙原本用媒体查询实现：≥1200px 四列、≥800px 三列、≥520px 两列、否则一列。要求改成不写任何 `@media`，且满足两条额外约束：Ⅰ. 每列不窄于 260px；Ⅱ. 容器被塞进 240px 宽的侧边栏时**不产生横向溢出**；Ⅲ. 卡片少于一行时，剩余空间留在右侧而不是把两张卡拉伸到超宽。给出 CSS，并逐条说明它是怎么被满足的。

<template #answer>

```css
.cards {
  display: grid;
  gap: 1rem;
  /* 约束 Ⅲ 要求空位留白 → 用 auto-fill；Ⅱ 要求下限能跟随容器 → 用 min() */
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
}
```

- **Ⅰ（每列 ≥ 260px）**：`minmax(…, 260px 一侧)` 是下限，任何情况下轨道不小于它（在容器允许的前提下）。容器 1200px 时列数 = `floor((1200 + 16) / (260 + 16)) = floor(1216/276) = 4` → 与原来的四列断点一致；800px → `floor(816/276) = 2`，得 2 列而不是原设计的 3 列。**这是这套写法要付出的代价**：列数由下限和 `gap` 共同决定，想精确复现断点得回头调 `gap` 或下限（比如把下限改成 240px 后 800px 能给到 3 列）。断点表被删掉，不等于设计意图自动保住。
- **Ⅱ（240px 容器不溢出）**：`min(100%, 260px)` 中 `100%` 解析为容器内容盒宽，`240px < 260px` → 取下限 240px，轨道恰好等于容器，不溢出。
- **Ⅲ（剩余空间留白）**：用 `auto-fill` 保留空轨道（已核实的差异：`auto-fit` 会把空轨塌成 `0px` 并回收其 `gap`，从而拉伸剩余项目）。1200px 下 4 条轨道 = 基准 4×260 = 1040px，加 3 处间距 48px，余下 112px 由 4 条 `1fr` 均分 → 每轨 288px。只有 2 张卡时它们是两张 288px 的卡，右侧两条空轨（共 288×2 + 16 = 592px）留在原地，卡片不会被拉成 590px 宽。

如果客户改主意要求「两张卡也要铺满一行」，只把 `auto-fill` 换成 `auto-fit`，一行改完——这正是「轨道规则只有一条声明」的收益。

</template>

</Exercise>

<Exercise title="练习 5 · 跨卡片对齐标题与页脚" difficulty="挑战">

承接「不依赖媒体查询的响应式卡片墙」一节：每张卡是「图 / 标题 / 正文 / 页脚」，标题有的两行、有的一行，导致各卡正文起始高度不一致。用 `subgrid` 给出方案，并回答两点：① 为什么每张卡自己写 `grid-template-rows: auto 1fr auto` 不够？② 为什么 `subgrid` 之前必须写 `grid-row: span 4`？

<template #answer>

```css
.card  { display: grid; grid-row: span 4; grid-template-rows: subgrid; }
.card > img    { grid-row: 1; }
.card > h3     { grid-row: 2; }
.card > p      { grid-row: 3; }
.card > footer { grid-row: 4; }
```

① 每张卡自建三行轨道时，卡与卡之间**没有任何轨道关系**：各自的第 1 行由自己内容决定，「A 卡标题 1 行、B 卡标题 2 行」时正文起点必然不同。`subgrid` 把行的定义权交回父网格——所有卡片跨的是**同一批**父行轨道，第 2 行（标题行）的高度由这一行里最高的标题决定，同排卡片自动对齐。

② `grid-template-rows: subgrid` 只是「继承父轨道」的声明，**不会自动扩张**：卡片默认只占一条父行，子网格就只有一条轨道，四个子项会挤进去。`grid-row: span 4` 明确说「这张卡覆盖 4 条父行」，subgrid 才有 4 条可继承的轨道。父网格的行是隐式的（`grid-auto-rows` 初始 `auto`），隐式行能吸收内容所以不会塌，但**行高对齐的收益要靠卡片跨满同样的行数**。

还有一种最坏情况：某张卡因 `dense` 或显式放置与父行轨道错开，它继承的第 1 条 subgrid 轨道实际是父网格的正文行，图片会占进正文的高度，卡片互相压盖。`subgrid` 不做智能避让，它只是轨道继承。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN Grid 布局指南（中文）](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_grid_layout) —— 核实「轨道 / 线 / 格 / 区域」术语体系与本章分节顺序。
- [MDN `grid-template-columns`](https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-columns) —— **已核实**：`fr` 按剩余空间的比例取值、裸 `fr` 隐含 `minmax(auto, <flex>)`、`auto`/`min-content`/`max-content` 的定义、只有 `auto` 轨道可被 `justify-content`/`align-content` 拉伸。核实「fr 的真实语义」全节与常见错误 1、5。
- [MDN `repeat()`](https://developer.mozilla.org/en-US/docs/Web/CSS/repeat) —— **已核实**：`auto-fill` 的重复次数定义、`auto-fit` 塌陷空轨道、塌陷轨道视为 `0px` 且两侧 gutter 一起塌陷。核实两张对照表的结论。
- [MDN `grid-template-areas`](https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas) —— **已核实**：`.` 空单元格语法、每个字符串一行、同名区域必须成矩形否则声明无效。核实「命名线与区域」一节和练习 3。
- [MDN `minmax()`](https://developer.mozilla.org/en-US/docs/Web/CSS/minmax) —— 核实 max 小于 min 时结果取下限，即 `minmax(180px, 25%)` 在 600px 容器得 180px 的依据。
- [MDN 自动放置](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Auto-placement_in_grid_layout) —— 核实稀疏放置与 `dense` 的回填行为，以及 `grid-auto-flow` 各取值。
- [MDN Grid 线放置](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Grid_layout_using_line-based_placement) —— 核实线编号与负数从 `-1` 起算的范围是**显式网格**，即常见错误 2 的依据。
- [MDN Grid 与其他布局方式的关系](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Relationship_of_grid_layout_with_other_layout_methods) —— 核实「一维 vs 二维」的官方选型口径。
- [MDN 基本概念](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Basic_concepts_of_grid_layout)、[`gap`](https://developer.mozilla.org/en-US/docs/Web/CSS/gap)、[`display`](https://developer.mozilla.org/en-US/docs/Web/CSS/display) —— 分别核实隐式网格、`gap` 在 Grid 中的适用性、`display: contents` 的定义（含可访问性提示）。
- [CSS Grid Layout Level 1](https://www.w3.org/TR/css-grid-1/) 与 [Level 2](https://www.w3.org/TR/css-grid-2/) —— §12 轨道尺寸解析算法（Initialize → Maximize → Expand Flexible Tracks）是练习 1 那道「夹紧后重跑」的原始出处；`subgrid` 定义在 Level 2。
- 前置：[Flexbox](/css/flexbox)（同一套「基准 + 剩余分配 + 上下限夹紧」思想）、[盒模型与外边距折叠](/css/box-model)（百分比与 `box-sizing` 的基准）。后续：[响应式设计](/css/responsive-design) 里的容器查询，[调试布局](/css/debugging-layout) 里的 Grid 覆盖层排查路径。

## 下一章

Grid 解决了「二维对齐」，但页面还有第三类需求：把元素从流里拿出来——弹窗、下拉菜单、吸顶导航。它们靠的是定位（positioning）与层叠上下文（stacking context），而「加了 `z-index: 9999` 还被压在下面」几乎总是因为某个父元素上的 `transform` 或 `opacity` 悄悄建了新的层叠上下文。下一章 [定位与层叠上下文](/css/positioning-and-stacking) 就处理这件事。想马上验证本章的轨道算法有没有理解对，去 [阶段项目](/css/project) 的卡片墙要求那一条，用 `minmax` 写法实现一遍「不依赖媒体查询」。
