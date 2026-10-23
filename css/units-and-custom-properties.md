# 值、单位与自定义属性：设计令牌与主题切换

三个都花过我一晚上时间的 bug，全都出自本章：

- 组件嵌得越深、内边距越大。因为 `padding: 1em` 的 `em` 相对**这个元素自己的字号**，而字号是 `1.1em` 一层层乘下来的。
- 深色模式只暗了一半。因为某个中间层重新声明了同名语义变量，而自定义属性只继承、不合并，整棵子树被那份旧值锁死。
- `clamp(1rem + 0.5vw, 2rem, 1.5rem)` 写了却「不响应视口」。因为在 1600px 以下它恒等于 `1.5rem`，中间那个 `2rem` 一辈子取不到。

共同点是：**CSS 的值不是字面量，是待解析的表达式**。`1em`、`50%`、`var(--x)` 都要等浏览器知道「相对谁」「在哪用」才能算出数。本章把解析基准做成可查的表，再把散落的字面量收进自定义属性（custom property），形成一套能整体切换的设计令牌（design token）。

<Callout type="info" title="本章的核实方式">

单位定义、`color-mix()` 语法、自定义属性的继承与回退规则、`attr()` 的局限，已于 2026-10-17 用 WebFetch 对 MDN 核实，文末逐条标注对应结论。本任务无浏览器环境，具体数值一律写「预期结果是…」，验证动作交给 DevTools 的 Computed 面板。

</Callout>

<Callout type="unverified" title="这些能力的支持度请自行核实">

本章用到的 `lh`、`svh`/`lvh`/`dvh`、`oklch()`、`color-mix()`、`@property` 与 `attr()` 的类型参数都是较新的东西，它们在各浏览器的落地时间本章没有逐个核实。写法上请保证每个新能力都有旧写法兜底（例如在 `--neutral-0: oklch(100% 0 0)` 之前先给一行 `--neutral-0: #fff`），动手前按特性名在 [Can I use](https://caniuse.com/) 上确认目标浏览器。

</Callout>

## 长度单位各自相对什么解析

「相对什么」这一列是本章唯一需要背的东西，其余都能推。

| 单位 | 解析基准 | 适合 | 风险 |
| --- | --- | --- | --- |
| `px` | 绝对单位，`1px = 1/96 inch`；高分屏上一个 CSS 像素对应多个设备像素 | 边框、1px 分隔线、必须像素对齐的东西 | 不跟随用户字号偏好 |
| `em` | **该元素自己的** computed `font-size`；用在 `font-size` 上时指**继承来的**字号 | 随本组件文字一起缩放的 `padding`、`gap` | 嵌套复利 |
| `rem` | 根元素（通常 `html`）的 `font-size`；用在根元素自己的 `font-size` 上时指它的初始值。浏览器默认多为 `16px`，但会被用户偏好改掉 | 全站字号与间距阶梯 | 根字号被别人改动 → 整站一起偏 |
| `%` | **不是 `<length>`**，是 `<percentage>`；基准随被赋值的属性而变 | 相对容器的宽度 | 「相对谁」永远要查，不能猜 |
| `vw` | 视口初始包含块宽度的 1% | `clamp()` 的斜率项 | 桌面滚动条是否计入需自查，易撑出横向滚动 |
| `vh` | 视口初始包含块高度的 1%。**`vh` 等价于 `lvh`** | 少用 | 移动浏览器地址栏伸缩时被裁 |
| `svh` | 小视口（small viewport）：可伸缩的浏览器界面**全部展开**时的视口 | 「内容绝不被遮挡」的场景 | 界面收起时上下留白 |
| `lvh` | 大视口（large viewport）：可伸缩界面**全部收起**时的视口 | 全屏背景 | 界面展开时把内容盖住 |
| `dvh` | 动态视口（dynamic viewport）：随界面展开/收起**实时变化** | 需贴合当前可见区的浮层、全屏编辑器 | 滚动过程中尺寸会变，触发重排；MDN 明确警告这会退化 UI 并损耗性能 |
| `ch` | 元素字体里字符 `0`（U+0030）的推进宽度；无法测量时按 `0.5em` 宽、`1em` 高 | `max-width: 65ch` 控制行宽 | 中文字体下 `0` 宽与汉字宽不成比例 |
| `ex` | 元素字体的 x-height，常见 `1ex ≈ 0.5em` | 与基线对齐的微小偏移 | 跨字体不可移植 |
| `lh` | 该元素 computed `line-height` 换算成绝对长度 | 让装饰块高度与理想行高一致 | 实际行盒会因内容偏离理论值 |
| `pt` | 绝对单位，`1pt = 1/72 inch` | 打印样式表 | 屏幕上没有任何优势 |

`ch` 那条值得展开：`max-width: 65ch` 是英文排版的经典行宽。中文一个汉字约 `1em` 宽，而多数中文字体里 `1ch` 明显小于 `1em`，直接套 `65ch` 会得到过宽的一行。预期结果：中文正文用 `max-width: 36rem` 上下更可控。

## 嵌套 em 的复利

`em` 是**自相对**的，于是它会乘算。三层嵌套 `.card { font-size: 1.2em }` → `.card__body { font-size: 1.1em }` → `.card__note { font-size: 1.1em; padding: 1em }`。从 `16px` 起算，预期结果：`19.2px` → `21.12px` → `23.232px`，而那个 `padding: 1em` 是 **23.232px，不是 16px**。再嵌一层就 25px。组件库里的「深层字号失控」「列表项内边距越来越肥」都是这个。

两条规矩：**字号一律 `rem`**，让每层基准固定为根字号；只有确实要「跟着本组件文字缩放」的量才用 `em`，且只出现在该组件自己的声明里、不往下传。

`rem` 的对应风险是根字号本身。`html { font-size: 62.5% }` 这种「让 1rem = 10px」的老技巧会覆盖用户在浏览器里设定的字号偏好（MDN 写明根字号「user-defined preferences may modify this」）。想要 18px 就写 `1.125rem`，别为了凑整数改根。

## 百分比相对谁

| 写法 | 基准 |
| --- | --- |
| `width: 50%` | 包含块的**内容宽度**（[第 3 章](/css/box-model)） |
| `padding` / `margin` 四边任意方向 | 一律按包含块**宽度** |
| `font-size: 120%` | **父元素**的 computed `font-size`（与 `1.2em` 等价） |
| `line-height: 120%` vs `line-height: 1.2` | 前者在每个子元素上按它自己的字号重算；后者是倍数、**被继承**、不重算 |
| `top` / `left` 百分比 | 包含块对应轴向尺寸（`absolute` 的包含块是 padding box，见[第 7 章](/css/positioning-and-stacking)） |
| `translate(50%, 50%)` | **自身**尺寸 |

`line-height` 那行是高频分歧点：子元素改字号时，无单位版本会跟着重算、百分比版本不会。全站基准请用**无单位**。

## 移动浏览器为什么不该用 vh 铺满首屏

移动浏览器滚动时会收起地址栏与工具栏，视口高度随之变化，于是有三套视口尺寸：小视口 = 界面全部展开，大视口 = 界面全部收起，动态视口实时跟随。而 **`vh` 等价于 `lvh`**（大视口）。

```css
.hero-bad { min-height: 100vh; }  /* 地址栏展开时底部内容落在屏幕外 */
.hero-ok  { min-height: 100svh; } /* 永远全部可见；界面收起时下边留白 */
.sheet    { height: 100dvh; }     /* 严丝合缝；代价是滚动时重新布局 */
```

选择规则：**背景与 hero 用 `svh`；需要贴合可见区的浮层用 `dvh`；`vh` 只用在桌面为主的场景**。

## calc()、min()、max()、clamp()

`calc()` 是算术，不是「任何数学表达式」。四条规则：

- `+` 和 `-` 两侧必须**同类型**，或在允许 `<length-percentage>` 的属性里长度与百分比混用（`calc(100% - 2rem)` 合法）。
- `+` 和 `-` 两侧**必须留空格**。`calc(100% -10px)` 里的 `-10px` 被当成带符号的值，整条声明语法失效。这是 `calc` 最常见的静默失败。
- `*` 至少一侧是**无单位数字**：`calc(1rem * 1.5)` 合法，`calc(1rem * 1rem)` 不合法。
- `/` 右侧必须是**无单位数字**：`calc(100% / 3)` 合法，`calc(100vw / 1rem)` 不合法。除以 `0` 让声明变成 IACVT。

`min()` / `max()` 接受任意个参数；`clamp(MIN, VAL, MAX)` 固定三个，语义是 `max(MIN, min(VAL, MAX))`，且**当 `MIN > MAX` 时 `MIN` 获胜**——不是报错，是静默偏向 MIN。上一条 bug 就出在这里。

### 流式字号的每一项

```css
:root { --step-0: clamp(1rem, 0.9rem + 0.5vw, 1.25rem); }
```

`1rem`（16px）是**下限**，`1.25rem`（20px）是**上限**，中间 `0.9rem + 0.5vw` 是**斜率项**——视口每宽 100px 字号涨 0.5px，前面的 `0.9rem` 把这条直线抬到合适截距。取四个点（`1rem = 16px`）：

| 视口宽度 | 斜率项 `14.4 + 0.5%·W` | clamp 结果 | 由哪项决定 |
| --- | --- | --- | --- |
| 320px | 16.0px | **16px** | 恰好等于下限 |
| 768px | 18.24px | **18.24px** | 区间内，真正流式 |
| 1280px | 20.8px | **20px** | 撞上限 |
| 1920px | 24.0px | **20px** | 仍被上限压住 |

反推上限触发点：解 `14.4 + 0.005W = 20` 得 `W = 1120px`，即 1120px 以上字号恒定 20px。**这套「先定两个边界、再解斜率与触发宽度」的算法，比抄一段 `clamp()` 有用。**

再看坏例子 `clamp(1rem + 0.5vw, 2rem, 1.5rem)`：`MIN = 16 + 0.005W`、`VAL = 32`、`MAX = 24`。`min(32, 24) = 24`，结果恒为 `max(16 + 0.005W, 24)`——视口不超过 1600px 时恒为 **24px**，超过后 `MIN` 反超才开始增长。**中间值 `2rem` 永远不出现**：作者真正想要的是 `min()` 或 `max()`，不是流式字号。

## 颜色表示法与对比度

```css
.a { color: #1e293b; }                 /* #RGB / #RGBA / #RRGGBB / #RRGGBBAA */
.b { color: #1e293b80; }               /* 最后两位才是 alpha：80 hex ≈ 50% */
.c { color: rgb(30 41 59 / 0.5); }     /* 现代空格语法，斜杠分隔 alpha */
.d { color: hsl(215 32% 17% / 0.5); }  /* 调色阶时比 rgb 直观 */
.e { color: color-mix(in oklab, var(--brand) 20%, white); }
.f { color: oklch(62% 0.19 258); }     /* 感知均匀的亮度/彩度/色相 */
.g { border-color: currentColor; }     /* 取该元素 computed color */
```

`#RRGGBBAA` 的顺序要单独强调：很多人按 `ARGB` 写，得到一个完全无关的颜色——alpha 是**最后一组**。

`color-mix()` 的几条已核实规则：省略插值空间时**默认 `in oklab`**；极坐标空间（`hsl`、`hwb`、`lch`、`oklch`）可附加 `shorter hue` / `longer hue` / `increasing hue` / `decreasing hue`；两个颜色都省略百分比时各按 50%，只写一个时另一个取 `100% - X%`；两者之和不等于 100% 时按比例**归一化**；**和小于 100% 时结果乘上一个等于该和的 alpha**（等价于跟透明混色）。矩形空间列表含 `srgb`、`srgb-linear`、`display-p3`、`lab`、`oklab`、`xyz` 等。

```css
color-mix(in lch increasing hue, hsl(200 50% 80%), coral)  /* 极坐标 + 色相方向 */
color-mix(in oklab, teal 20%, olive 30%, blue 50%)         /* 三色，百分比归一化 */
```

为什么用 `oklab` / `oklch`：`hsl` 的 `L` 不是感知均匀的——同样 `L: 60%` 的蓝和黄视觉明暗差很多，用 `hsl` 拉色阶会「中间几档突然变亮」。`oklch` 的 `L` 是感知均匀亮度，梯度更可控。但**对比度最终仍要量**，不要靠亮度数值推断。

可读性两条硬规矩：

- **别用透明度做文字色。** `color: #00000080` 的实际对比度取决于它压在什么背景上，换背景就变。要浅灰就用 `color-mix(in oklab, var(--color-text) 60%, var(--color-bg))`，得到确定的不透明色，对比度可复算。
- 阈值口径：正文至少 **4.5:1**、大号文本至少 **3:1**（WCAG AA），站内完整口径见 [HTML 无障碍](/html/accessibility)。CSS 侧的推论是：**颜色令牌成对定义（`--color-text` 与 `--color-bg` 一起换），永远不要只换其中一个。**

## 自定义属性：语法、继承与覆盖

```css
--brand-color: #2563eb;   /* 两个连字符开头；名字大小写敏感 */
--Brand-Color: #dc2626;   /* 这是另一个变量，不是拼写错误 */
```

三条机制，第一条最容易被误解。

**它是继承的，不是层叠合并的。** MDN 原文：自定义属性「are subject to the cascade and inherit their value from their parent」——它受层叠影响（同名变量的多条声明按特异性与源顺序决胜），但**每个元素只有一个值，从父元素传下来**。中间层重新声明 `--color-text`，整棵子树就全切到新值，祖先那份**不可访问**，没有「合并」这回事。开头那个「深色模式只暗了一半」就是这么来的。

**值在使用处才解析。** MDN：「The value is computed where it is needed, not stored and reused in other places of a stylesheet.」`--size: 2em` 存在某处时什么都还没算，只有 `font-size: var(--size)` 落到的那个元素才按它自己的字号解析。副产品：同一个含 `em` 或 `%` 的变量在不同元素上算出不同值是正常的。

**几乎任何值都被当成合法。** 自定义属性解析时浏览器还不知道它将被用在哪个属性上，所以一律收下；出错发生在替换之后——这叫 IACVT（invalid at computed-value time）。MDN 的处理规则：**遇到无效的 `var()` 替换时，使用该属性的 initial 或 inherited 值。**

```css
:root { --text-color: 16px; }    /* 合法：自定义属性不校验值 */
p { color: var(--text-color); }  /* 替换后 color: 16px → IACVT */
```

预期结果：`p` 的 `color` **不是黑色字面量**，而是「`color` 可继承 → 取继承值；父级也没有 → 取 initial（浏览器默认文字色）」。它最坑的地方在于全程静默：DevTools 里只有一条被划掉的声明，和一个不像你写的 Computed 值。

## var() 的回退值

```css
var(--brand-color)                           /* 未定义且无回退 → IACVT */
var(--brand-color, #2563eb)                  /* 回退值 */
var(--text-color, var(--brand-color, gray))  /* 多级回退的唯一正确写法：嵌套 var() */
var(--list, red, blue)                       /* 回退值是 "red, blue"：第一个逗号之后全是回退 */
```

MDN 明确写了：**第一个逗号与函数结尾之间的全部内容都算回退值，允许含逗号**；要提供多级回退，正确做法是**嵌套 `var()`**，不是并列写多个候选。

注意回退值只在「变量未定义」时生效，它兜不住「变量存在但值不适用于该属性」——那种情况走 IACVT，不是回退。

`@property` 是这条链的解药：它可以显式声明 `inherits`、`initial-value` 与语法类型，让变量在赋值时就校验、并且**可动画**。本章不展开，用法以 [MDN `@property`](https://developer.mozilla.org/en-US/docs/Web/CSS/@property) 为准。

## 令牌挂在哪里：:root 与组件级

判据只有一条：**这个值是全局的还是这个组件的？**

```css
/* 全局：主题色、字号阶梯、间距阶梯、圆角、阴影、层级 */
:root { --color-bg: #fff; --space-4: 1rem; --z-modal: 400; }

/* 组件级：只在本组件内有意义，用组件自己的变量名暴露可调接口 */
.card { --card-pad: var(--space-4); padding: var(--card-pad); }
.card--dense { --card-pad: calc(var(--space-4) / 2); }   /* 变体只改一个变量 */
```

组件级变量的价值在**变体**：`.card--dense` 不重写 `padding` 声明（那会撞上特异性战争），只重定义 `--card-pad`。这是把[第 2 章](/css/selectors)「低特异性但足够精确」落地的办法之一。反向规则：不要把只有一个人用的值放进 `:root`——全局命名空间是稀缺资源，`--team-card-hover-shadow-offset-2` 这种变量一旦进去就没人敢删。

## 主题切换：完整可运行示例

结构是两层令牌：**原始层**（`--blue-600` 这类具体颜色，不随主题变）与**语义层**（`--color-bg` 这类角色名，切主题只重映射语义层）。下面的两个文件可以直接建好打开。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>主题切换</title>
<script>
  /* 在首次绘制前把用户选择写回 html，避免闪一下浅色 */
  if (localStorage.theme) document.documentElement.dataset.theme = localStorage.theme;
</script>
<link rel="stylesheet" href="theme.css">
</head>
<body>
  <button id="t" type="button">切换主题</button>
  <p>正文颜色由 <code>--color-text</code> 决定。</p>
  <script>
    document.getElementById('t').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.theme = next;
    });
  </script>
</body>
</html>
```

```css
/* theme.css —— 原始层与尺度：两个主题共用，不随主题变化 */
:root {
  --neutral-0: oklch(100% 0 0);
  --neutral-900: oklch(18% 0.01 260);
  --blue-600: oklch(50% 0.19 258);
  color-scheme: light;
}

/* 语义层：浅色作为默认 */
:root {
  --color-bg: var(--neutral-0);
  --color-text: var(--neutral-900);
  --color-accent: var(--blue-600);
  --color-border: color-mix(in oklab, var(--neutral-900) 15%, var(--neutral-0));
}
```

语义层的深色值要写成**两条**规则：一条给手动指定，一条给系统偏好。它们不能合并成一条选择器列表，因为 media 那条必须多一个出口条件。

```css
:root[data-theme="dark"] {
  --color-bg: oklch(18% 0.015 260);
  --color-text: oklch(96% 0.01 260);
  --color-accent: oklch(72% 0.16 250);
  --color-border: color-mix(in oklab, var(--color-text) 20%, var(--color-bg));
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-bg: oklch(18% 0.015 260);
    --color-text: oklch(96% 0.01 260);
    --color-accent: oklch(72% 0.16 250);
    --color-border: color-mix(in oklab, var(--color-text) 20%, var(--color-bg));
    color-scheme: dark;
  }
}
body { margin: 0; padding: 2rem; background: var(--color-bg); color: var(--color-text); }
button { padding: .5rem 1rem; border: 1px solid var(--color-border);
         background: transparent; color: var(--color-accent); border-radius: .5rem; }
```

为什么这套能跑通，靠的是特异性算术（回顾[第 1 章](/css/how-it-works)）：`:root` 是 `(0,1,0)`，`:root[data-theme="dark"]` 和 `:root:not([data-theme="light"])` 都是 `(0,2,0)`（`:not()` 本身不计，括号里的属性选择器计入）。用户手动选浅色时 `:not([data-theme="light"])` **不匹配**，media 整条退出层叠，默认浅色留下。**如果偷懒把 media 写成 `:root`，它和默认同特异性，按源顺序 media 在后 → 用户选浅色会被系统深色压过去。** 这是「本地能跑、换环境就错」的典型。

深色值写两遍是这个模式的固有重复，可用构建期 mixin 或 `@layer` 整理，但不要为了少写一遍而删掉出口条件。另外别漏 `color-scheme`：它让浏览器按主题渲染表单控件、滚动条与默认画布背景，只换自定义属性的话原生控件还是白的。

`setProperty` 这条路也存在：`document.documentElement.style.setProperty('--color-accent', '#f59e0b')` 写的是**内联样式**，特异性最高、压过以上所有规则，适合「强调色运行时自定义」这类需求，不适合做主题切换。DOM 事件与样式操作的完整写法见 [DOM 操作与事件系统](/javascript/dom-and-events)。

## attr() 与它的已知局限

MDN 原话：**`attr()` 可以用在任意 CSS 属性上，但对 `content` 之外的属性支持是实验性的。** 语法是 `attr(<name> <type>?, <fallback>?)`——可指定类型与回退值，属性缺失或无法解析成该类型时取回退。另一条硬限制：出于安全考虑**不能用 `attr()` 拼 URL**，用了 `attr()` 的值会被标记为「`attr()`-tainted」，把它用作或放进 `<url>` 会让整条声明变成 IACVT。

```css
.quote::before { content: open-quote attr(data-quote); }  /* 今天唯一稳的用法 */
.badge { width: attr(data-size px); }                     /* 规范允许，浏览器多半不生效 */
```

工程结论：`attr()` 只用在 `::before` / `::after` 的 `content`。想让 HTML 属性值变成布局尺寸，用自定义属性传：`<div style="--w: 30">` 配 `width: calc(var(--w) * 1%)`。

## 设计令牌：一套完整命名方案

命名分三段：**类别 - 角色 - 变体**。类别固定（`color` / `text` / `space` / `radius` / `shadow` / `z`），工具能按前缀分组补全。

```css
:root {
  /* 1. 原始色板：只描述颜色本身 */
  --color-neutral-0: oklch(100% 0 0);
  --color-neutral-100: oklch(95% 0.005 260);
  --color-neutral-900: oklch(18% 0.01 260);
  --color-blue-500: oklch(62% 0.19 258);
  --color-blue-600: oklch(50% 0.19 258);
  --color-red-500: oklch(58% 0.21 25);

  /* 2. 语义色：组件只允许引用这一层 */
  --color-bg: var(--color-neutral-0);
  --color-bg-raised: var(--color-neutral-100);
  --color-text: var(--color-neutral-900);
  --color-text-muted: color-mix(in oklab, var(--color-text) 62%, var(--color-bg));
  --color-link: var(--color-blue-600);
  --color-danger: var(--color-red-500);
  --color-focus-ring: var(--color-blue-500);

  /* 3. 字号阶梯：需要流式的档位交给 clamp */
  --text-xs: 0.75rem;   --text-sm: 0.875rem;  --text-base: 1rem;
  --text-lg: clamp(1.125rem, 1rem + 0.5vw, 1.25rem);
  --text-xl: clamp(1.25rem, 1.1rem + 0.6vw, 1.5rem);
  --text-2xl: clamp(1.5rem, 1.2rem + 1.2vw, 2.25rem);
  --leading-tight: 1.2; --leading-normal: 1.55;

  /* 4. 间距阶梯：4px 起，8 之后按 1.5 倍递增 */
  --space-1: 0.25rem; --space-2: 0.5rem;  --space-3: 0.75rem; --space-4: 1rem;
  --space-6: 1.5rem;  --space-8: 2rem;    --space-12: 3rem;   --space-16: 4.5rem;

  /* 5. 圆角：小角给控件，大角给卡片，full 只给圆形元素 */
  --radius-sm: 0.25rem; --radius-md: 0.5rem; --radius-lg: 0.875rem; --radius-full: 9999px;

  /* 6. 阴影：四档，只在这一层混入颜色与偏移 */
  --shadow-1: 0 1px 2px oklch(18% 0.01 260 / 12%);
  --shadow-2: 0 2px 6px oklch(18% 0.01 260 / 16%);
  --shadow-3: 0 8px 20px oklch(18% 0.01 260 / 20%);
  --shadow-4: 0 18px 44px oklch(18% 0.01 260 / 26%);

  /* 7. 层级：有限档位，配合第 7 章的 isolation 使用 */
  --z-base: 0; --z-dropdown: 100; --z-sticky: 200;
  --z-overlay: 300; --z-modal: 400; --z-toast: 500;
}
```

四条纪律比命名方案本身更重要：

1. **组件只引用语义层**，不引用原始层。写 `var(--color-text-muted)`，不写 `var(--color-neutral-500)`，否则主题永远切不干净。
2. **阶梯只留档位，不留「刚好需要」的值**。出现 `--space-4-plus-2px` 就说明设计稿的间距节奏本身不对。
3. **层级是语义的**：`--z-modal` 表示「这是模态层」，不表示「比 dropdown 大 300」。要压过模态，先想清楚是不是真该压过。
4. **改主题只改语义层**，原始层一个字节都不动——这条可以直接当 code review 检查项。

## 常见错误与排查

### 症状：变量明明写了，拿到的却是回退值

变量名**大小写不一致**（`--Brand` 与 `--brand` 是两个变量），或变量声明在拿不到的作用域上。选中元素看 Computed 面板底部的 Custom 区域，它列出该元素可见的自定义属性及其值与来源规则；缺就是没继承到。全站统一小写 kebab-case，并加一条 lint。

### 症状：一条属性静默失效，DevTools 里被划掉

IACVT——变量值合法但对目标属性不合法。把 `var(...)` 临时换成字面量，若生效就说明是变量的值不对而不是选择不对。落点看属性可不可继承：`color`、`font-size` 可继承 → 取继承值；`border-radius`、`width` 不可继承 → 取初始值。注意 `var(--x, 回退)` 兜不住这种情况；反复出错的位置用 `@property` 注册类型，让它早点报错。

### 症状：深层组件的内边距一档比一档大

嵌套 `em` 复利。Computed 同时看该元素的 `font-size` 和 `padding`，两者数值相等即确诊。字号一律 `rem`；`em` 只出现在组件自己的声明里。

### 症状：`calc(100% -10px)` 完全不生效

`-` 前没有空格，`-10px` 被解析成带符号的值，整条声明语法错误。把 `10px` 换成 `1rem` 仍无效、加空格立刻有效。`calc()` 里 `+` 和 `-` 两侧永远留空格；顺手检查有没有两个长度相乘或长度除以长度，那两类也不合法。

### 症状：100vh 的区块底部被移动端工具栏吃掉

`vh` 等于 `lvh`，按界面收起时的大视口算。设备工具栏里切换地址栏状态，比较 `innerHeight` 与元素高度。hero 用 `svh`，贴合可见区的浮层用 `dvh` 并接受滚动时重排的代价。

### 症状：切深色后有一块区域还是浅色

某个中间层重新声明了同名语义变量，而自定义属性只继承、不合并，整棵子树被那份旧值锁死。选中出问题的**最内层**元素，在 Custom 区域看这个变量由哪条规则给出。组件级变量必须引用语义令牌（`--card-bg: var(--color-bg-raised)`），不要直接给颜色字面量。

### 症状：clamp 写了三档却看不出随视口变化

`MIN > MAX` 时 `MIN` 获胜、中间项被完全跳过。手算 `max(MIN, min(VAL, MAX))` 在两个视口宽度下的值（练习 2 的路子）。保证 `MIN ≤ MAX`；如果你其实只想要「取较小的那个」，那该用 `min()` 而不是 `clamp()`。

## 练习

<Exercise title="练习 1 · 预测六个解析值" difficulty="基础">

根元素 `font-size` 为 `18px`。写出下面每一项的 computed 值。

```css
html       { font-size: 18px; }
body       { font-size: 1rem; }
.section   { font-size: 1.5em; }
.section p { font-size: 120%; }
.callout   { padding: 1rem 2em; width: 50%; }   /* 在 .section 里，.section 内容宽 600px */
.card      { font-size: 1.5rem; }
```

1. `body` 的 `font-size`
2. `.section` 的 `font-size`
3. `.section p` 的 `font-size`
4. `.callout` 的 `padding-left`（`.callout` 未改字号）
5. `.callout` 的 `padding-top`
6. `.card` 的 `font-size`

<template #answer>

1. **18px**。`1rem` = 根字号。
2. **27px**。`em` 用在 `font-size` 上按**继承来的**字号算：`1.5 × 18`。
3. **32.4px**。`120%` 按**父元素**（`.section`）字号：`1.2 × 27`。
4. **54px**。`padding: 1rem 2em` 的第二值是左右；`em` 按 `.callout` **自己**的 computed 字号算，它继承 `.section` 的 `27px` → `2 × 27`。
5. **18px**。第一值是上下，用的是 `rem`，与所在层级字号无关。
6. **27px**。`1.5rem = 1.5 × 18`，与 `.card` 挂在哪个祖先下**无关**——这就是 `rem` 抗复利的性质。

第 4、5 两题是本题唯一的考点集中处：同一条 `padding: 1rem 2em` 里两个单位用了**两个不同基准**（根字号 vs 自身字号）。如果第一反应是「都跟字号有关所以差不多」，那第 1 题和第 6 题的差别也就白算了。

</template>

</Exercise>

<Exercise title="练习 2 · 拆解一个 clamp" difficulty="进阶">

给定 `font-size: clamp(1rem, 0.8rem + 0.8vw, 1.4rem)`（`1rem = 16px`）。

1. 三项分别是什么角色？
2. 算出视口 360px、750px、1200px、1600px 时的 computed 字号。
3. 求出「撞下限」与「撞上限」的两个临界视口宽度。
4. 设计师要求窄屏字号不小于 18px，这个 `clamp` 要改哪一项？

<template #answer>

1. `MIN = 1rem = 16px`（下限）、`VAL = 0.8rem + 0.8vw = 12.8 + 0.008W`（斜率项）、`MAX = 1.4rem = 22.4px`（上限）。计算式 `max(MIN, min(VAL, MAX))`。
2. 逐项代入：360px → `15.68` → `max(16, 15.68)` = **16px**（被下限托住）；750px → `18.8` = **18.8px**（区间内，真正流式）；1200px → `22.4` = **22.4px**（恰好撞上限）；1600px → `25.6` → 被上限压回 **22.4px**。
3. 下限临界：`12.8 + 0.008W = 16` → `W = 400px`，以下恒为 16px。上限临界：`12.8 + 0.008W = 22.4` → `W = 1200px`，以上恒为 22.4px。**真正的流式区间只有 400～1200px 这 800px 宽。**
4. 只改 `MIN`：`clamp(1.125rem, 0.8rem + 0.8vw, 1.4rem)`。但要回头验算斜率项在 400px 处的值（`16px`）是否已高于新的 18px——本例没有（16 < 18），所以下限从 400px 起生效；如果有，流式区间会被整体推高，需要同时调整斜率或上限。

第 3 题是这题真正要练的东西：`clamp()` 的三项不是「三个候选值」，而是**一条折线的三段**。手算两个临界宽度，比在浏览器里拖滚动条盲调快得多。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造一次 IACVT" difficulty="进阶">

预期是把按钮文字设成红色、胶囊圆角。实际结果：文字变成**黑色**，圆角变成了 **0**。请解释两条声明各自为什么失效，以及为什么两条的「失效落点」不一样。

```css
:root { --btn-color: 200; --btn-radius: 9999; }
.btn  { color: var(--btn-color); }
.pill { border-radius: var(--btn-radius); }
```

<template #answer>

两条都是 **IACVT**：自定义属性解析时不校验值（`--btn-color: 200`、`--btn-radius: 9999` 都合法），替换到目标属性上之后才变得不合法（`color: 200` 非法、`border-radius: 9999` 缺单位）。MDN 的处理规则是：**无效的 `var()` 替换 → 该属性的 initial 或 inherited 值。** 落点由「这个属性可不可继承」决定：

- `color` **可继承** → 取继承值。`body` 没设颜色，一路继承到 initial，也就是浏览器默认文字色（黑）。所以「看起来像回退到黑色」其实不是回退，是**继承**。
- `border-radius` **不可继承** → 取 initial，即 `0`。于是胶囊变成了直角方块。

**这就是两条表现的差别**：同一个变量出错，可继承属性表现为「继承了别人的值」，不可继承属性表现为「等于什么都没写」。DevTools 里两条声明都会被划掉，但 Computed 面板给出的值完全不同——前者与父元素相同，后者是 `0px`。

修法：`--btn-color: oklch(58% 0.21 25);`、`--btn-radius: 9999px;`（或者组件里写 `border-radius: calc(var(--btn-radius) * 1px)`，此时 `9999 * 1px` 是合法的 `number × length`）。反复出错的变量用 `@property` 注册成 `<color>` / `<length>` 类型，让它在赋值时就报错而不是拖到替换点。

</template>

</Exercise>

<Exercise title="练习 4 · 写出主题切换的选择器" difficulty="进阶">

要求：默认浅色；系统偏好深色时自动深色；用户手动选浅色时，即使系统深色也必须浅色。给出三条规则的选择器（不写声明体），并说明「用户手动选浅色」为什么能赢。再指出如果 media 里的选择器写成 `:root` 会发生什么。

<template #answer>

```css
:root { /* 浅色默认 */ }
:root[data-theme="dark"] { /* 手动深色 */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* 系统深色，且未被钉成浅色 */ }
}
```

特异性：`:root` 是 `(0,1,0)`，另两条都是 `(0,2,0)`。三种状态各只有一次匹配：未手动选择 + 系统深色 → media 那条赢默认；手动浅色 + 系统深色 → `:not([data-theme="light"])` **不匹配**，media 整条退出层叠，默认浅色留下；手动深色 + 系统浅色 → 只有 `[data-theme="dark"]` 匹配。

**如果 media 写成 `:root`**：它与默认声明同特异性 `(0,1,0)`，按**源顺序**决胜，media 块在后面 → 「系统深色 + 用户手动选浅色」会被系统深色压过去。本地测试（系统本来浅色）完全看不出问题，换台机器就错。

还有两件事不能漏：每套主题都要写 `color-scheme`，否则原生控件与滚动条不跟变；以及首屏闪烁——把读 `localStorage` 的那行 `<script>` 放在 `<head>` 里、样式表 `<link>` **之前**执行。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN `length`](https://developer.mozilla.org/en-US/docs/Web/CSS/length) —— 核实单位表全部条目：`em`/`rem`/`ch`/`ex`/`lh` 的解析基准、`ch` 无法测量时按 `0.5em`、`1px = 1in/96`、`1pt = 1in/72`、**`vh` 等价于 `lvh`**、small / large / dynamic viewport 三个定义，以及 `dvh` 会在滚动时改变尺寸并损耗性能的警告（2026-10-17）。
- [MDN `<length-percentage>`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/length-percentage) —— 核实「百分比不是 `<length>`」这条，以及两者可混用的属性范围。
- [MDN `calc()`](https://developer.mozilla.org/en-US/docs/Web/CSS/calc) 与 [CSS Values and Units Level 4](https://www.w3.org/TR/css-values-4/) —— 核实 `+`/`-` 两侧需同类型且需留空格、`*` 至少一侧为 `<number>`、`/` 右侧必须为 `<number>`；配合 [`clamp()`](https://developer.mozilla.org/en-US/docs/Web/CSS/clamp) 核实 `max(MIN, min(VAL, MAX))` 与「`MIN > MAX` 时 `MIN` 获胜」。
- [MDN 使用 CSS 自定义属性](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties) —— 核实「自定义属性受层叠影响并从父元素继承」「值在使用处才计算、解析时几乎一律收下」「无效替换后落到 initial 或 inherited 值」，以及 `getComputedStyle` / `setProperty` 的读写方式（2026-10-17）。
- [MDN `var()`](https://developer.mozilla.org/en-US/docs/Web/CSS/var) —— 核实「第一个逗号之后全部是回退值、允许含逗号」与「多级回退要嵌套 `var()`」。
- [MDN `color-mix()`](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix) —— 核实默认插值空间 `in oklab`、矩形与极坐标空间清单、四个 hue 方向关键字、百分比归一化、「和小于 100% 时乘 alpha」，以及页面两个示例（2026-10-17）。
- [CSS Color Module Level 4](https://www.w3.org/TR/css-color-4/) —— 核实 `#RRGGBBAA` 的 alpha 位置、`rgb()`/`hsl()` 的空格与斜杠语法，以及 `lab()`/`oklch()` 与感知均匀性。
- [MDN `attr()`](https://developer.mozilla.org/en-US/docs/Web/CSS/attr) —— 核实「`content` 之外的属性支持是实验性的」、`attr(<name> <type>?, <fallback>?)` 语法，以及「不能拼 URL，attr-tainted 值进入 `<url>` 会使声明 IACVT」（2026-10-17）。
- [MDN `@property`](https://developer.mozilla.org/en-US/docs/Web/CSS/@property) —— 核实注册自定义属性可显式控制 `inherits`、`initial-value` 与语法类型（本章只作为 IACVT 的解药指路）。
- [MDN `color-scheme`](https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme) —— 核实「只换自定义属性不会让原生控件与滚动条跟着变」。
- [Can I use](https://caniuse.com/) —— 按特性名（`color-mix`、`dvh`、`container queries`）搜索，动手前核实目标浏览器支持度。
- 上一章：[定位与层叠上下文](/css/positioning-and-stacking) —— `--z-*` 档位的由来，以及 `isolation: isolate` 与层级令牌如何配合。

## 下一章

令牌解决「同一套值在很多处保持一致」，响应式解决「同一套值在不同尺寸下要不一样」。[第 9 章 响应式设计](/css/responsive-design) 讲视口三件套里 `width=device-width` 与 `initial-scale` 各防哪类事故、断点为什么该由内容崩在哪决定而不是由设备型号决定、容器查询如何让「被塞进侧边栏的卡片」彻底摆脱媒体查询，以及 `@supports` 的渐进增强写法范式。回到 [CSS 领域首页](/css/) 可查看本领域全局路线。
