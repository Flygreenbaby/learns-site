# 响应式设计：断点由内容决定，容器由自身决定

「我写了 `@media (max-width: 768px)`，卡片在手机上确实是单列了，可它被塞进右侧 320px 的侧边栏里还是一排四个，字挤成一团。」这是本章要解决的核心故障，而它的一句话答案是：**媒体查询看的是视口，你要看的是容器**。

其余三个高频故障也各有机制：没加 viewport 标签的页面在手机上被当成桌面站，按 980px 宽的虚拟视口渲染再整体缩小，于是 `16px` 的文字变成马赛克、媒体查询也按 980 判档；`100vh` 的区块底部被移动浏览器的地址栏吃掉；`100vw` 在桌面上把滚动条宽度也算进去，页面凭空多出一条横向滚动。

本章的顺序：先讲清「视口到底是什么」，再讲断点怎么选，然后分两条路——**页面级**用媒体查询与偏好查询，**组件级**用容器查询；最后补上只有移动端才有的三件事：安全区、可点击尺寸、与输入方式无关的布局。

<Callout type="info" title="本章的核实方式">

视口元标签各指令的定义、无标签时的 980px 虚拟视口、`container-type` 的取值与副作用、`env(safe-area-inset-*)` 的语义、`@supports` 与 `@media` 的语法与特性清单，已于 2026-10-17 用 WebFetch 对 MDN 核实，文末逐条标注。本任务无浏览器环境，具体数值一律写「预期结果是…」，验证动作交给 DevTools 的设备工具栏与 Computed 面板。

</Callout>

## 视口三件套：不加 viewport 标签会发生什么

先区分三个视口：**理想视口**（设备在当前方向下能显示的 CSS 像素宽度）、**布局视口**（CSS 布局使用的宽度，媒体查询看的就是它）、**视觉视口**（用户此刻实际看到的那块区域，缩放改变的是它）。

MDN 解释了不加标签的后果：部分设备会用一个**比屏幕更宽的虚拟视口**渲染页面再整体缩小，例如屏幕宽 640px 时按 980px 渲染；原因是「并非所有页面都为移动端优化，直接按小视口渲染会破相或难看」。

预期结果对比：

| 写法 | 布局视口 | 后果 |
| --- | --- | --- |
| 无 viewport 标签 | 虚拟视口（移动浏览器常见 980px） | 页面按桌面宽度排版再缩小，文字发虚；`@media (max-width: 768px)` **不匹配** |
| `width=device-width` | 等于理想视口 | 排版按真实宽度，媒体查询按真实宽度判档 |
| 再加 `initial-scale=1` | 同上，缩放比例钉在 100% | 防止内容横向溢出时浏览器自行缩小整页 |

`width=device-width` 里 `device-width` 是「设备屏幕在 CSS 像素下的物理尺寸」这个特殊值；`initial-scale` 定义设备宽度与视口尺寸的比例，**取值范围 0.0 到 10.0**。MDN 对 `initial-scale=1` 的定位很实在：「如果溢出内容导致了不期望的缩小、你又希望页面从 100% 缩放开始，就加上它——但通常你应该避免内容横向溢出。」也就是说 `initial-scale` 是**补救项**，不是魔法开关：治标不治本，真正要修的是溢出源。

两个额外规则：`user-scalable=no` / `maximum-scale=1` 不要写，它禁掉双指放大，而放大是低视力用户的主要手段（口径见 [HTML 无障碍](/html/accessibility)），iOS Safari 早在多年版本前就已忽略它。`viewport-fit=cover` 是唯一需要额外记的一个：它让视口铺满整个显示区域（包括刘海与圆角那一圈），代价是必须配合安全区变量把重要内容挪回来（见后文）。

## 断点该由内容决定，不是由设备决定

设备名断点（`max-width: 375px`、`min-width: 1024px`）是错的，原因很朴素：设备尺寸每年都在增加新的，而你的内容不会跟着重新设计。

正确的做法是**从内容「崩在哪」反推**。步骤：

1. 把样式表里所有媒体查询注释掉，页面只留一套单列样式。
2. DevTools 设备工具栏打开，宽度从 1440px 连续拖到 320px，不要跳。
3. 每当看到「先是不好看、然后是不能看」的那一刻，记下宽度。常见崩点三类：行宽失控（一行文字长到眼睛追不上）、列数该减（并排元素互相挤压）、结构该折叠（导航项换行或溢出）。
4. **在崩点外侧留一点余量**再取整，得到断点；取整到 4 的倍数或与间距阶梯对齐，方便记忆。
5. 只有一个崩点就只写一个断点。**单断点优先**——两个断点意味着三种排版状态要维护，而绝大多数页面只需要两种。

| 观察到的崩点 | 内容需要什么 | 断点怎么定 |
| --- | --- | --- |
| 卡片在 640px 以下图片压得文字只剩两行 | 图片与文字改成上下排列 | `@container card (width < 22rem)`；`@media (max-width: 660px)` 只在它独占整行时等价 |
| 正文一行超过 90 个汉字读不下去 | 限制行宽，与视口无关 | 用 `max-width: 36rem`，**不要**用断点 |
| 表格在 720px 以下出现横向滚动 | 减列或换结构 | 优先改内容（隐藏次要列），断点作兜底 |
| 导航 6 项在 900px 以下换行 | 折叠成菜单 | 数出不换行所需最小宽度再取整 |

第一行的区分很关键：卡片的两列/单列本质是「这块地方有多宽」的问题，跟视口无关，所以该用容器查询。

## 媒体查询语法

```css
/* 单一条件；Media Queries Level 4 的范围语法，比 min/max 前缀更直观 */
@media (width >= 900px) { }
@media (min-width: 900px) { }              /* 等价写法，兼容面更广 */

/* 区间：两个条件用 and 连接，二者必须同时为真 */
@media (min-width: 400px) and (max-width: 700px) { }
@media (400px <= width <= 700px) { }       /* 等价的范围写法 */

/* 逗号是逻辑或：任一匹配即整条为真 */
@media (hover: hover), (pointer: fine) { }

/* 媒体类型可以省略；用 not / only 时保守写法要带上 all */
@media not all and (min-width: 900px) { }
@media only screen and (width >= 900px) { }   /* only 必须与媒体类型一起用 */
```

`and` 是「一条查询里的逻辑与」，逗号是「多条查询的逻辑或」，写错会得到看起来一样、失效条件完全不同的两份代码。`not` 在 Level 3 只能否定**整个查询**（不能只否定某个表达式），Level 4 放宽了；要兼容旧环境就写 `not all and (...)`。`only` 的唯一用途是阻止不认识媒体查询的老浏览器把整条读进去。

**移动优先的具体含义是「只用 `min-width` 向上加**，而不是一堆 `max-width` 向下改。混用会出事：

```css
/* 错误：两段都会命中 500px 的设备 */
@media (max-width: 600px) { .nav { display: none; } }
@media (min-width: 400px) { .nav { display: flex; } }
```

预期结果：这两条在 400–600px 区间**同时匹配**，谁赢取决于源顺序，改一处就翻车。修法：只保留一个方向；确实需要区间时明确写 `@media (400px <= width < 600px)`，让区间显式且不重叠。

## 特征查询：按用户偏好与输入能力出样式

视口尺寸只是媒体特性的一种。本章会用到这些（清单与所属级别来自 MDN 的 `@media` 页面）：

| 特性 | 问的是什么 | 注意 |
| --- | --- | --- |
| `prefers-color-scheme` | 偏好浅色还是深色（Level 5） | 与 `[data-theme]` 手动切换配合，见[第 8 章](/css/units-and-custom-properties) |
| `prefers-reduced-motion` | 是否要求减少动效（Level 5） | 用它把动画时长降到 0，别只降透明度 |
| `prefers-contrast` | 是否要求更高/更低对比度（Level 5） | 与 `forced-colors` 不是一回事 |
| `forced-colors` | UA 是否强制限制了调色板（Level 5） | 开启时你的颜色全部作废，靠 `border` 与间距表达层级 |
| `hover` / `any-hover` | **主**输入设备能否悬停 / **任一**能 | `hover` 只问主设备，触屏笔记本会给出意外结果 |
| `pointer` / `any-pointer` | 主/任一指向设备的精度（`none`/`coarse`/`fine`） | 用来微调控件尺寸，不要用来隐藏功能 |
| `display-mode` | 以什么模式显示（fullscreen / standalone / browser） | PWA 独立窗口与浏览器标签共用一份 CSS 时的唯一区分手段 |
| `scripting` | JS 是否可用（Level 5） | 用来给「无 JS」准备纯 CSS 的导航 |

<Callout type="unverified" title="动手前先查 caniuse">

上表标注 Level 5 的几条以及 `display-mode`、`scripting`，在各浏览器的落地时间并不一致，本章没有逐个核实支持度。把它们用于**增强**（写在查询内部、有默认退路）是安全的；用于**必要条件**（查询不成立就没样式）之前，先在 [Can I use](https://caniuse.com/) 按特性名确认目标浏览器。

</Callout>

`hover` 的正确用法不是「区分手机和桌面」，而是**别把悬停当成唯一的状态表达**：

```css
/* 错：触屏上永远不会出现这个状态，删除按钮只能靠长按发现 */
.row:hover .delete { opacity: 1; }

/* 对：状态始终可见可点，悬停只是额外反馈 */
.delete { opacity: .65; }
@media (hover: hover) and (pointer: fine) {
  .delete:hover { opacity: 1; }
}
```

## 容器查询：让组件自己决定

组件的宽度取决于它被放进哪里，跟视口无关。容器查询（container query）把判断依据从视口换成**最近的查询容器**。第一步是在容器上声明，`container-type` 的取值（核实自 MDN）：

| 取值 | 建立什么 | 副作用 |
| --- | --- | --- |
| `normal`（初始值） | **不是**尺寸/滚动/锚点容器；只能被容器样式查询与「仅按名字」的查询命中 | 无 |
| `inline-size` | 只在**行内轴**（水平书写模式下即宽度）上做尺寸查询 | 施加 `style` + `inline-size` containment：行内尺寸被隔离计算，块尺寸仍由内容决定 |
| `size` | 两个轴向都能查 | 施加 `style` + `size` containment：**两个方向的尺寸都在隔离中计算，没有显式或上下文尺寸时容器会塌陷** |
| `scroll-state` / `anchored` | 供滚动状态查询 / 锚定查询使用 | 不施加 containment，尺寸不隔离 |

containment 必须存在是为了切断循环：查询结果改内部样式 → 内部样式改容器尺寸 → 查询结果又变；规范用「隔离计算」剪断这条链。副作用是 `container-type: size` 的容器高度不再由内容撑开——预期结果是直接变成 0 高。**日常几乎总是用 `inline-size`**，确实要按高度切布局才用 `size` 并给容器定高。

四条必须记住的规则：

1. **容器查询命中的是容器的后代，不是容器自己。** 所以「卡片本体要变两列」必须给它套一层 `.card-slot` 当容器——这是容器查询最常见的「写了没反应」。
2. **`@container` 不加名字时命中最近的尺寸容器**；加名字后按名字**逐字匹配**（大小写敏感），找不到同名容器时整条静默失效、不报错。
3. 后代里可以用**容器查询单位** `cqi` / `cqb` / `cqmin` / `cqmax` 按容器尺寸取值（`font-size: clamp(0.875rem, 0.7rem + 2cqi, 1.125rem)`）。
4. `container-type` 为 `size` 或 `inline-size` 会**创建层叠上下文**（[第 7 章](/css/positioning-and-stacking)的清单里有这条）。加了它之后组件内部 `z-index` 出不去，这不是 bug 是特性，但要提前知道。

与媒体查询的取舍一句话：**样式关心「我这块地方有多宽」用容器查询，关心「整个页面是什么形态」用媒体查询。** 导航折叠、页脚列数、整站侧栏开合属于后者；卡片、列表项、按钮组、图表区块属于前者。

## @supports：特性检测与渐进增强

`@supports`（特性查询）测的是「这个浏览器认不认这条声明」。语法要点（核实自 MDN）：条件必须是**带括号的 `property: value`**，可用 `and` / `or` / `not` 组合，`not` 在顶层不需要外层括号、但与其他运算符连用时要加。

```css
@supports (display: grid) { }
@supports (display: grid) and (not (display: inline-grid)) { }
@supports selector(h2 > p) { }                 /* 测选择器支持，依赖具体选择器的落地情况 */
```

写法范式只有一种正确的：**基线样式写在块外面，增强样式写在块里面**。

```css
/* 基线：任何浏览器都能用 */
.stack > * + * { margin-top: var(--space-4); }

/* 增强：支持 gap 就用 gap，不再需要兄弟选择器 */
@supports (gap: 1rem) {
  .stack { display: flex; flex-direction: column; gap: var(--space-4); }
  .stack > * + * { margin-top: 0; }
}
```

反面写法（把基线写进 `@supports not (...)`）会在「正向与负向都不匹配」时让样式完全丢失，而且版本演进后 `not` 分支迟早变成死代码。**永远正向增强，不要负向兜底。** 给容器查询加一层检测时，测的同样是「属性 + 值」这一对——`@supports (container-type: inline-size) { … }` 里包住 `container-type` 声明和 `@container` 规则，不支持时卡片保持单列、内容完整可读。

## 零媒体查询的卡片组件

目标：同一份卡片代码，放进全宽区域自动多列，放进侧边栏自动单列，窄到 300px 也不溢出。全程**不写一个 `@media`**。

```html
<ul class="cards">
  <li class="card-slot">
    <article class="card">
      <img class="card__thumb" src="thumb.jpg" alt="" width="480" height="270">
      <div class="card__body"><h3 class="card__title">标题</h3><p>两行说明文字。</p>
        <a class="card__more" href="#">查看详情</a></div>
    </article>
  </li>
  <!-- 其余卡片同结构 -->
</ul>
```

```css
/* 1. 列数：交给 auto-fit，不查询任何东西 */
.cards {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
}

/* 2. 每张卡片自己是「一个查询容器的后代」，容器是它的 slot */
.card-slot { container-type: inline-size; container-name: card; }

.card {
  display: grid; gap: var(--space-2); align-content: start; height: 100%;
  padding: var(--space-4); background: var(--color-bg-raised);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-1);
}
.card__thumb { display: block; inline-size: 100%; block-size: auto;
               aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--radius-sm); }

/* 3. 卡片够宽时转成「图在左、文在右」 */
@container card (width >= 26rem) {
  .card { grid-template-columns: 9rem 1fr; gap: var(--space-4); align-items: start; }
  .card__thumb { aspect-ratio: 1; }
}
/* 4. 更宽时标题升一档，纯用容器查询单位做流式 */
@container card (width >= 40rem) {
  .card__title { font-size: clamp(1.125rem, 1rem + 1.5cqi, 1.5rem); }
}
```

三处设计意图：`min(18rem, 100%)` 是防溢出的关键——可用宽度不足 18rem 时轨道按 100% 走，否则 `auto-fit` 会造出比容器更宽的轨道、页面横向滚动（回指 [Grid](/css/grid)）；`height: 100%` 成立是因为 grid 项默认被拉伸、`.card-slot` 的行高确定；`container-name: card` 让嵌套容器不误命中外层。

预期结果：1280px 全宽区域里 4 列、每列约 300px，卡片走 16:9 上图下文字；把同一份 HTML 放进 `width: 320px` 的 `<aside>`，`auto-fit` 收成 1 列，`@container` 因 slot 不到 26rem 也不转两栏——**没有任何媒体查询参与**。这就是「组件被塞进侧边栏」这个真实故障的正解。

## 文字与间距的响应式

字号阶梯用 `clamp()` 定义成令牌（[第 8 章](/css/units-and-custom-properties)），这是唯一一处「页面级响应」该写的地方：

```css
:root {
  --text-base: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
  --text-2xl: clamp(1.5rem, 1.2rem + 1.2vw, 2.25rem);
  --space-4: clamp(0.75rem, 0.6rem + 0.5vw, 1rem);   /* 间距也可以流式 */
}
```

三条规矩：**正文只做小幅浮动**（上下限差 10%–15% 就够，正文大幅缩放会改变每行字数，读起来像换了篇文章）；**大标题才需要大斜率**；**行高与字号反向**——字号越大行高倍数越小（标题 `1.1`–`1.2`，正文 `1.5`–`1.7`），否则大标题的留白会松散到看不出是一行。

间距优先靠**内容自适应**而不是断点改值：`gap` 用 `clamp()`，外边距用 `margin-inline: auto` + `max-width`，需要「窄屏贴边、宽屏留白」时用 `padding-inline: max(1rem, (100% - 72rem) / 2)` 这类一行式，而不是三段媒体查询。

## 图片：CSS 侧只做配合

`srcset` / `sizes` / `<picture>` 的选择逻辑归 [HTML 图片与媒体](/html/images-media)，那边讲图源与像素密度候选，本章只补 CSS 侧的配合。

```css
img { max-width: 100%; height: auto; }             /* 1. 不溢出、不拉伸变形 */
.cover { inline-size: 100%; block-size: 100%; object-fit: cover; object-position: center; }
.box { aspect-ratio: 16 / 9; overflow: hidden; }   /* 2. 占位防布局位移 */
svg { fill: currentColor; }                        /* 3. 图标颜色跟随文字令牌 */
```

`width`/`height` 属性写在 HTML 上、CSS 里只留 `max-width: 100%` + `height: auto`，浏览器能从属性推出宽高比，图片加载前后不跳版；需要固定形状时用 `aspect-ratio` + `object-fit: cover`，别再用 `padding-top` 百分比那套旧技巧。**容器查询能改变图片的显示区域，但换不了图源**——按容器宽度取不同分辨率仍要靠 `sizes`，而 `sizes` 写的是视口占比不是容器像素宽，这层错配目前无解，需要时用 `<picture>` 手动分档。

## 窄屏下的表格、表单与导航

**表格**（结构与语义口径见 [HTML 表格](/html/tables)）三种策略的取舍：① **减列**——把次要列合并进主列单元格，唯一无损的方案，优先；② **横向滚动容器**——`overflow-x: auto` 包住表格并给出可发现的视觉线索（左右渐隐遮罩或「可横向滑动」提示），代价是内容被藏起来；③ **重排成定义列表**——用 `display: grid` 做出 `dt`/`dd` 观感，代价是破坏表格语义、读屏不再报列头。**不要把 ③ 当默认方案**：数据可比性是表格存在的理由，拆掉之后它就不是一张表了。

**表单**：窄屏下标签移到控件上方（`flex-direction: column`），不要用占位符代替 `<label>`；输入框字号不低于 `16px`，否则 iOS 聚焦时会强制放大整页；键盘类型由 HTML 的 `inputmode` 决定，CSS 只管尺寸与间距；错误提示放在控件**下方**并保持文档顺序。

**导航**：折叠成汉堡菜单的前提是键盘可用——用 `<button aria-expanded>` 加一个开合状态。窄屏下该做的第一件事是**减少导航项**，而不是换一种把它们塞小的方式。

## 移动端安全区与 dvh

`env(safe-area-inset-*)` 的语义（核实自 MDN）：从视口的上/右/下/左内边缘到「安全放置内容」的矩形的距离，**在视口是普通矩形且没有工具栏、动态键盘等占用空间时四个值都是 `0`**，否则是大于 `0` 的 px 值。配合它的是 viewport 标签里的 `viewport-fit=cover`（视口被缩放以填满设备显示区域，MDN 明确写了「强烈建议用安全区 inset 变量确保重要内容不落到显示区外」）。

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

```css
.tabbar {
  position: fixed; inset-inline: 0; bottom: 0;
  padding-block: var(--space-2) calc(var(--space-2) + env(safe-area-inset-bottom, 0px));
  padding-inline: max(var(--space-3), env(safe-area-inset-left));
}
.hero { min-height: 100svh; }                    /* 界面全部展开时也不裁内容 */
.sheet { max-height: 100dvh; }                   /* 需要正好贴合可见区的浮层 */
```

`env()` 的第二个参数是回退值，写成 `env(safe-area-inset-bottom, 0px)` 可以避免在不支持该变量的环境里整条 `calc()` 失效。`padding-inline: max(..., env(...))` 的作用是：**没有刘海时用常规边距，有刘海时按刘海让位**，两个条件不用查询就都覆盖了。

预期结果：不写 `viewport-fit=cover` 时 `env(safe-area-inset-bottom)` 一直是 `0`（视口本来就没铺到圆角区），加了它才有非零值。这是很多人「写了安全区代码却看不出效果」的原因。

## 可点击区域与输入方式无关

触屏上没有悬停、没有精确指针，靠尺寸保证可用性。**可点击区域不小于内容视觉尺寸**，控件之间的间距也是可点性的一部分。

- 独立控件按 **44×44 CSS px** 做（这是移动端通行口径，也覆盖了戴手套、单手驾驶等场景）；
- 空间紧凑的控件（行内链接、表格里的按钮）按 **24×24** 作为底线，四周再留间距凑够判定范围；
- 别用 `@media (pointer: coarse)` 来「只在触屏上加大按钮」——桌面触屏一体机、带触屏的笔记本会被误判。正确做法是**用一套在所有输入方式下都可点的尺寸**，`pointer` 查询只用来做锦上添花的微调。

<Callout type="unverified" title="尺寸阈值的出处">

44px 与 24px 是两个不同来源的口径（前者来自移动端交互规范惯例，后者出现在 WCAG 对最小目标尺寸的条款里）。本站无障碍章节是最终口径来源，见 [HTML 无障碍](/html/accessibility)；本章只给 CSS 侧的落地做法，不裁决阈值本身。

</Callout>

同理，**状态不要只靠悬停表达**、**关闭按钮不要只靠图标**、**不要依赖 `title` 属性**——这三条在触屏上都失效，跟断点无关。

## 常见错误与排查

### 症状：手机上页面像缩略图，媒体查询完全不匹配

缺 viewport 标签，布局视口落到虚拟视口（常见 980px）。控制台读 `window.innerWidth`，远大于设备物理宽度即确诊；补上 `<meta name="viewport" content="width=device-width, initial-scale=1">`。

### 症状：写了 `initial-scale=0`，整页缩得看不见内容

`initial-scale` 是缩放比例、范围 0.0–10.0，`0` **不是「自动」**；各家浏览器把它夹到哪一档并不一致（这一条我没核实到统一条文）。改成 `1` 立刻正常就能确诊。要自适应就写 `initial-scale=1` 或只留 `width=device-width`——控制缩放的正常手段是让内容不横向溢出。

### 症状：某个宽度下样式莫名其妙，改一处另一处塌

`min-width` 与 `max-width` 混用造成区间重叠（或留空档）。把每条查询的命中区间写成不等式看有没有相交，或在 DevTools 的 Styles 面板看当前匹配了哪几条规则。统一改成移动优先的 `min-width` 阶梯；真需要区间就写 `@media (400px <= width < 600px)`，别拆成两条。

### 症状：卡片在设备工具栏里正常，塞进侧边栏就挤爆

断点按视口定，而组件的可用宽度由容器定。用 `resize: horizontal; overflow: auto` 给测试外层加一个可拖拽的宽度并拖动它——**这一步经常被跳过**，只测视口永远发现不了容器侧的问题。组件级判断改成容器查询（见上文完整示例）。

### 症状：页面凭空多出一条横向滚动条

用了 `100vw`。有纵向滚动条时 `vw` 按**包含滚动条**的视口宽度算，所以 `100vw` 比可用内容宽度宽出一个滚动条。比较 `document.documentElement.clientWidth` 与 `window.innerWidth`，不相等即命中。布局宽度改用 `100%`；给外层加 `overflow-x: hidden` 只是遮症状。

### 症状：hover 才出现的操作在手机上找不到

把悬停当成了唯一的状态表达。DevTools 里切到触屏设备（悬停能力消失）再看一遍即可确诊。状态常显、悬停只做增强反馈（前文代码）。

### 症状：容器查询写好了但完全不生效

按顺序排除四种：① 被查询的元素**就是容器本身**（容器不能查自己，必须套 slot）；② `container-name` 与 `@container` 后的名字没逐字对上（大小写敏感，不匹配时静默失效）；③ `container-type` 忘了设或值是 `normal`（只允许名字查询，尺寸条件永远不成立）；④ 用了 `container-type: size` 而容器没有显式高度，块尺寸被隔离计算后**塌成 0**——日常应该用 `inline-size`。确认办法：选中查询命中的**后代**元素看 Elements 面板有没有 container 徽标，再把条件临时改成 `@container card (width >= 0px)`，若生效说明是阈值问题而不是绑定问题。

## 练习

<Exercise title="练习 1 · 四种 viewport 写法的后果" difficulty="基础">

设备屏幕理想视口为 390px。写出下面每种写法下**布局视口的宽度**，以及 `@media (max-width: 768px)` 是否匹配、`@media (width >= 900px)` 是否匹配。

```html
<!-- A -->（没有任何 viewport 标签）
<!-- B --><meta name="viewport" content="width=device-width">
<!-- C --><meta name="viewport" content="width=1024">
<!-- D --><meta name="viewport" content="width=device-width, initial-scale=0">
```

<template #answer>

- **A：虚拟视口，典型值 980px**（MDN 给的正是「屏幕 640px 却按 980px 渲染再缩小」的例子，具体数值随 UA 而变）。`max-width: 768px` **不匹配**、`width >= 900px` **匹配** → 桌面布局被整体缩小，文字发虚。这就是最典型的「我的媒体查询在手机上没反应」。
- **B：390px**。前者匹配、后者不匹配。这是正确基线。
- **C：1024px**。两条都按 1024 判：`max-width: 768px` 不匹配、`width >= 900px` **匹配**。这种写法只在「让纯桌面站点在手机上勉强可用」时有意义，代价是用户必须双指放大才能读正文。
- **D：布局视口仍是 390px，但初始缩放被写成 0**。合法区间 0.0–10.0，所以 `0` 能通过语法检查、不会像非法值那样被整条忽略；它的语义是「缩放到 0 倍」，浏览器会把它夹到允许范围，落到哪一档各家不一致。**没有理由写 0**：不锁缩放就根本不写 `initial-scale`，或者写 `initial-scale=1`。

A 与 C 最有教学价值：媒体查询**都按一个远大于屏幕的宽度判档**、症状完全相同，但原因不同（一个 UA 兜底、一个自己指定），必须读 `window.innerWidth` 才能分清。

</template>

</Exercise>

<Exercise title="练习 2 · 从内容推出断点" difficulty="进阶">

一个特性卡片区，每张卡片包含 40px 图标 + 标题（最长 8 个汉字）+ 两行说明（每行约 30 个汉字）。卡片左右内边距各 `1rem`。请回答：

1. 单张卡片的**最小可读宽度**大约是多少（一个汉字宽约等于 `1em`，说明字号 16px）？
2. 由此推出这个区域的断点应该怎么定？为什么不是 768px？
3. 如果同一份卡片还要放进 320px 的侧边栏，方案要怎么改？
4. 说明你会用哪个 CSS 特性把「列数」这件事彻底交给内容自己决定。

<template #answer>

1. 两行 30 个汉字：`30 × 16px = 480px` 内容宽，加 `2 × 16px` 内边距 → **约 512px**。但这是「一行不折」的极端值；并排时每行字数会减少，可接受下限大致 `18rem`（288px，每行约 18 个汉字仍可读）。**取 288px 作轨道最小值。**
2. 断点由「几列能装下」决定，不由屏幕型号决定。`n` 列时每列约 `W / n`（减去 gap），`n = 3` 要求 `W ≥ 3 × 288 + 2 × 24 ≈ 912px`，所以断点落在 **912px 附近**（取整到 `57rem`）。768px 只是个恰好常见的数字，对这个内容没有意义：在 768px 塞三列，每列 240px，说明文字折成四行、卡片高度失控。
3. 放进 320px 侧边栏时按视口写的断点全失效（视口 1440px、容器 320px）。改成**容器查询**：每张卡片套一层 slot 声明 `container-type: inline-size`，卡片内部横排还是竖排按 slot 宽度判。
4. 列数交给 `repeat(auto-fit, minmax(min(18rem, 100%), 1fr))`——轨道数量由可用宽度算出来，**一个媒体查询都不用**。

第 2 题的推导比答案重要：写不出 `3 × 288 + 2 × 24`，说明断点还是抄来的。第 4 题是本章最该形成肌肉记忆的组合——**auto-fit 管列数、容器查询管组件内部、媒体查询只管页面形态**。

</template>

</Exercise>

<Exercise title="练习 3 · 故意让容器查询失效" difficulty="进阶">

下面的代码预期「卡片宽于 26rem 时图在左、文在右」，实际永远走单列。找出**三个各自独立**的问题，说明怎么确认并给出修法。

```css
.card { container-type: inline-size; container-name: cards;
        display: grid; gap: var(--space-2); }

@container card (width >= 26rem) {
  .card { grid-template-columns: 9rem 1fr; }
}
```

<template #answer>

**问题 1：容器查询命中不到声明它自己的元素。** `.card` 既是容器又是被改的元素，而 `@container` 只作用于容器的**后代**——「按自己的尺寸改自己的样式」会造成循环。确认：把规则选择器临时改成某个 `.card > *` 子元素，条件就开始生效。修法：外面套一层 `.card-slot` 承担容器角色，`container-type` 放它身上。

**问题 2：`container-name: cards` 与 `@container card` 没对上。** 名字逐字、大小写敏感；带名字的查询找不到同名容器时整条**静默失效、浏览器不报错**。确认：把查询里的名字改成 `cards` 立刻生效，或去掉名字让它命中最近的尺寸容器。

**问题 3：阈值 26rem 大于轨道实际可达的宽度。** `inline-size` 只隔离行内轴，slot 的宽度仍由外层轨道决定。若外层是 `repeat(auto-fit, minmax(min(18rem, 100%), 1fr))` 而区域只够两列，每列约 300px，永远到不了 `26rem`（416px），前两条修好后条件依然不成立。确认：选中 `.card-slot` 在 Computed 面板读实际 inline size，或给它加 `outline` 目视。修法：把阈值降到轨道真实可达的范围（如 `width >= 20rem`），或接受「两栏版只在单列全宽时出现」并写成注释。

排查顺序值得记住：**先确认绑定关系（谁查谁），再确认名字匹配，最后才怀疑阈值**；反过来做会在一个根本不生效的规则上花掉半小时。

</template>

</Exercise>

<Exercise title="练习 4 · 零媒体查询的页脚" difficulty="挑战">

要求：页脚含品牌区 + 三组链接。窄的时候全部单列堆叠，宽的时候变成「品牌占一份、链接各占一份」；再宽时链接组换成横向多列。全程**不写 `@media`**。写出 CSS 并说明为什么这样能覆盖三种形态，以及剩下的一种情况必须用什么补。

<template #answer>

```css
.footer-inner {
  display: grid;
  gap: clamp(1rem, 0.6rem + 2vw, 3rem);
  grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr));
  align-items: start;
}
.footer { padding-block: var(--space-8); background: var(--color-bg-raised); }
.footer__group > ul { list-style: none; margin: .5rem 0 0; padding: 0;
                      display: grid; gap: .375rem; }
```

三种形态为什么自动出现：`auto-fit` 会尽可能多放轨道并把空轨道收成 0——可用宽度小时只剩 1 列（全部堆叠），中等宽度时 4 条轨道（品牌 + 三组链接各占一份），再宽时多出来的宽度被 `1fr` 平摊、四组一起变宽。`gap` 用 `clamp()`，「挤在一起」也被宽度带走了，**不需要任何查询**。

必须补的只剩**内容形态本身的变化**：如果宽的时候要求链接组「横排成一行、组间用竖线分隔」，那已经是组内排列方向问题，`auto-fit` 做不到。这时用容器查询：给 `.footer-inner`（或它的 slot）声明 `container-type: inline-size`，写 `@container footer (width >= 60rem) { .footer__group > ul { grid-auto-flow: column; } }`。

最重要的判断是：**「响应」有两类——尺寸自适应（交给 auto-fit / clamp / minmax，零查询）和形态切换（必须查询，而且应该查容器）**。把前者写成媒体查询是把简单事做复杂，把后者硬塞进 auto-fit 是做不出来。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN viewport 元标签](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport) —— 核实「无标签时用比屏幕更宽的虚拟视口（980px 例子）」、`width=device-width` 的定义、`initial-scale` 取值范围 0.0–10.0 与「内容溢出时用来固定 100% 缩放」的定位、`viewport-fit=cover` 与安全区变量的配合建议（2026-10-17）。
- [MDN `container-type`](https://developer.mozilla.org/en-US/docs/Web/CSS/container-type) —— 核实四个取值及其 containment 副作用、`size` 在无显式尺寸时会塌陷、`inline-size` 只允许查行内轴、隔离计算是为切断循环，以及 `@container card (width > 400px)` 的范围条件写法（2026-10-17）。
- [MDN 容器查询](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries) —— 核实「查询命中后代而非容器本身」的绑定关系、`container-name` 与容器查询单位 `cqi` 的写法。
- [MDN `@media`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media) —— 核实本章特征表里的媒体特性及其所属级别，以及 `and` 是逻辑与、逗号是逻辑或、`not` 在 Level 3 只能否定整个查询、`only` 必须与媒体类型连用、范围语法 `(400px <= width <= 700px)`（2026-10-17）。
- [MDN `env()`](https://developer.mozilla.org/en-US/docs/Web/CSS/env) —— 核实 `safe-area-inset-*` 的定义（视口为矩形且无工具栏/动态键盘占用时四个值均为 `0`，否则为大于 0 的 px 值）与 `env(变量, 回退值)` 的两参数语法（2026-10-17）。
- [MDN `@supports`](https://developer.mozilla.org/en-US/docs/Web/CSS/@supports) —— 核实 `and`/`or`/`not` 的组合规则、`not` 何时需要额外括号、`selector()` 的存在，以及「基线在外、增强在内」的示例范式（2026-10-17）。
- [MDN 使用媒体查询](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using) —— 完整查询语法与移动优先写法的参考。
- [Can I use](https://caniuse.com/) —— 本章涉及容器查询、`dvh`、`forced-colors`、`selector()` 等较新特性，动手前按特性名逐个核实目标浏览器。
- 上一章：[值、单位与自定义属性](/css/units-and-custom-properties) —— `clamp()` 三项的角色与响应式字号令牌，本章把它们排进真实断点策略。
- 站内相关：[定位与层叠上下文](/css/positioning-and-stacking)（`container-type` 创建层叠上下文）、[Flexbox](/css/flexbox)、[Grid](/css/grid)（`auto-fit` / `minmax` 轨道算法）、[HTML 图片与媒体](/html/images-media)（`srcset` 与 `sizes`）、[HTML 表格](/html/tables)、[HTML 无障碍](/html/accessibility)。

## 下一章

到这里，静态样式的全部机制讲完了。[第 10 章 过渡与动画](/css/transitions-and-animations) 解决的是「状态之间怎么变」：哪些属性可以被过渡、为什么动画 `width` 和 `top` 会掉帧而 `transform` 与 `opacity` 通常不会、合成层是什么代价，以及 `prefers-reduced-motion` 该怎么落地——它也正是本章「用户偏好类查询」最直接的使用场景。回到 [CSS 领域首页](/css/) 可查看本领域全局路线。
