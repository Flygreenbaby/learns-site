# 图片与多媒体：srcset、picture 与 video

图片是绝大多数网页里**体积占比最大的资源**。一个没做优化的页面，图片可能占总体积的 80%。而 HTML 在图片上的能力远比 `<img src="...">` 复杂——它需要在「清晰度」「文件大小」「不同屏幕」「不同网络条件」之间做权衡，这些权衡的入口都在 HTML 属性里。

这一章的重点是 `srcset` / `sizes` / `picture`，它们是响应式图片的核心，也是最容易写错的部分。

## img 的基础：三个必须写对的属性

```html
<img src="/images/chart.png" alt="2026 年各季度销售额柱状图" width="800" height="450">
```

### src

图片 URL。如果加载失败，浏览器会显示 `alt` 文本和一个破图图标（各浏览器表现不同）。

### alt：不是可选的

`alt` 在三种情况下会被真实使用：

1. 图片加载失败时显示
2. 读屏软件朗读给视障用户
3. 搜索引擎理解图片内容

**写 `alt` 的原则是「描述这张图片在此处所承载的信息」，而不是「描述这张图片长什么样」。**

四种典型情形：

| 图片类型 | alt 写法 | 例子 |
| --- | --- | --- |
| 承载信息的图片 | 完整描述其传达的信息 | `alt="2026 年各季度销售额柱状图，Q1 120 万，Q2 180 万，Q3 150 万，Q4 260 万"` |
| 链接或按钮里的图片 | 描述它的功能 | `alt="返回首页"`（不是 `alt="logo"`） |
| 纯装饰性图片 | **空字符串** `alt=""` | `alt=""` |
| 内容已在周围文字中说明 | 空字符串 `alt=""` | 见下方说明 |

```html
<!-- 装饰性图片：必须写 alt=""，不能省略 alt 属性 -->
<img src="/divider.svg" alt="" width="200" height="12">

<!-- 错误：省略 alt 属性。部分读屏软件会朗读文件名 "divider.svg" -->
<img src="/divider.svg">

<!-- 错误：写无意义的描述 -->
<img src="/divider.svg" alt="分隔线图片">
```

**为什么装饰性图片要写 `alt=""` 而不是省略属性**：这是两种完全不同的信号。`alt=""` 明确告诉读屏软件「这是装饰，跳过」；省略 `alt` 则表示「作者忘了写」，读屏软件会退而朗读文件名或 URL，用户会听到「斜杠 images 斜杠 divider 点 svg」这种噪音。

图表类图片的 `alt` 尤其重要。如果数据本身在页面其他地方（比如同时提供了数据表格），可以写 `alt="销售趋势图，详细数据见下方表格"`，避免重复朗读。

### width 与 height：为了消除布局偏移

```html
<img src="/photo.jpg" alt="..." width="1200" height="800">
```

写这两个属性的价值**不是**控制显示尺寸（那是 CSS 的工作），而是**让浏览器在图片下载完成前就知道它的宽高比**。

不写的后果是：页面先渲染出来，图片区域高度为 0；图片下载完成后突然撑开，把下面的内容全推下去。如果用户此时正在阅读或准备点击，就会发生**布局偏移（layout shift）**——这是 Google Core Web Vitals 里 CLS（Cumulative Layout Shift，累积布局偏移）指标衡量的东西。

现代浏览器会根据 `width` 和 `height` 属性**自动计算 `aspect-ratio`**，即使你用 CSS 把图片缩放到别的尺寸，占位空间的比例也是对的：

```css
img {
  width: 100%;   /* 覆盖属性里的 1200px */
  height: auto;  /* 配合 aspect-ratio 保持比例 */
}
```

注意 `width` 和 `height` 属性里写的是**像素数字，不带单位**。写 `width="1200px"` 是无效的，浏览器会忽略它。

## 图片格式的选择

| 格式 | 特点 | 适用场景 |
| --- | --- | --- |
| **SVG** | 矢量，无限缩放不失真，体积通常很小，可用 CSS/JS 操控 | 图标、Logo、图表、简单插画 |
| **WebP** | 有损与无损都支持，压缩率明显优于 JPEG/PNG，支持透明和动画 | 照片和图形的通用选择 |
| **AVIF** | 比 WebP 压缩率更高，支持 HDR 和广色域，但编码慢、老浏览器不支持 | 大尺寸照片、对体积敏感的场景 |
| **JPEG** | 有损，不支持透明，兼容性最好 | 照片的兜底格式 |
| **PNG** | 无损，支持透明，体积大 | 需要无损的图形、截图、透明背景 |
| **GIF** | 只有 256 色，支持动画，体积大 | 基本不该再用了，动画用 WebP/AVIF 或 `<video>` |

实践建议：

1. **图标一律用 SVG**。用 PNG 或图标字体做图标，在高分屏上会模糊或需要多套资源。
2. **照片用 WebP，配 JPEG 兜底**。AVIF 更好但兼容性和编码速度是问题，可以按需提供。
3. **截图和需要无损的图形用 PNG**，不要为了体积小用 JPEG——JPEG 在文字边缘会产生振铃伪影（模糊的彩色边）。
4. **不要用 GIF 做动画**。同样内容用 `<video>`（mp4/webm）体积通常小一个数量级，而且 `<video>` 可以静音自动播放，在移动端体验和 GIF 一样。

## 响应式图片：为什么需要它

一张 1200px 宽的照片，在下面四种情况下需要的文件完全不同：

| 场景 | 需要的图片 |
| --- | --- |
| 手机，1x 屏，显示宽度 360px | 360px 宽就够 |
| 手机，3x 屏，显示宽度 360px | 1080px 宽才清晰 |
| 桌面，1x 屏，显示宽度 1200px | 1200px |
| 桌面，2x 屏（Retina），显示宽度 1200px | 2400px |

如果只提供一个 2400px 的版本，手机用户会白白下载几 MB。如果只提供 360px 的版本，Retina 桌面用户看到的是一张糊图。

HTML 提供了两套机制解决这个问题，**用途不同，不要混淆**：

- **`srcset` + `sizes`**：同一张图，提供多个**尺寸**版本，让浏览器根据屏幕选一个。**用于分辨率切换。**
- **`<picture>` + `<source>`**：提供多个**不同**的图片，由你指定在什么条件下用哪个。**用于艺术指导（art direction）和格式回退。**

## srcset 与 sizes

### 两种描述符

`srcset` 的每一项由「URL + 描述符」组成，描述符有两种：

```html
<!-- x 描述符：像素密度 -->
<img src="photo-800.jpg"
     srcset="photo-800.jpg 1x,
             photo-1600.jpg 2x,
             photo-2400.jpg 3x"
     alt="...">
```

```html
<!-- w 描述符：图片的真实像素宽度 -->
<img src="photo-800.jpg"
     srcset="photo-400.jpg 400w,
             photo-800.jpg 800w,
             photo-1600.jpg 1600w,
             photo-2400.jpg 2400w"
     sizes="(max-width: 600px) 100vw,
            (max-width: 1200px) 50vw,
            800px"
     alt="...">
```

关键区别：

- **`x` 描述符**告诉浏览器「这张图是为几倍屏准备的」。浏览器直接按自己的 DPR 挑。**不能配 `sizes`**（写了也会被忽略），因为它假设图片显示尺寸固定。
- **`w` 描述符**告诉浏览器「这张图本身有多少像素宽」。**必须配 `sizes`**，因为浏览器需要知道图片会显示多大，才能算出需要多少像素。

### sizes 是什么

`sizes` 回答的问题是：**这张图片在页面上会占据多宽？** 它的值是一系列「媒体条件 + 长度」，最后一个是默认值：

```html
sizes="(max-width: 600px) 100vw,   <!-- 视口 ≤600px 时，图片占满整个视口宽度 -->
       (max-width: 1200px) 50vw,   <!-- 视口 ≤1200px 时，图片占视口一半 -->
       800px"                      <!-- 其他情况，图片固定 800px 宽 -->
```

长度单位可以用 `vw`（视口宽度的 1%）、`px`、`em`、`calc()` 等。

### 浏览器怎么挑

选图算法大致是：

1. 从上到下匹配 `sizes` 里的媒体条件，得到图片的**显示宽度**（比如 400px）
2. 乘以设备的 **DPR**（比如 2），得到需要的**实际像素宽度**（800px）
3. 在 `srcset` 里找**第一个 ≥ 800w** 的候选，选中它

所以 `w` 描述符必须写图片的**真实像素宽度**，写错了浏览器就会选错图。这是最常见的错误：把 `400w` 标在一张实际 800px 宽的图上，浏览器会以为它只有 400px，在高 DPR 屏上选了它，结果图片被拉伸变糊。

<Callout type="info" title="你无法精确控制浏览器选哪张图">

浏览器有选择自由：在慢速网络下它可能主动选更小的图，缓存里已有的图也可能被优先使用。这是标准允许的行为，目的是让浏览器为省流量做优化。所以不要依赖「一定会选某一张」来做测试，DevTools 的 Network 面板禁用缓存后刷新才能看到真实选择。

</Callout>

### src 仍然是必需的

`srcset` 是**渐进增强**。不支持 `srcset` 的环境会用 `src`，所以 `src` 必须存在且应当是一个合理的中等尺寸版本。

## picture：艺术指导与格式回退

```html
<picture>
  <!-- 格式回退：从上到下，第一个浏览器支持的 type 生效 -->
  <source srcset="/img/photo.avif" type="image/avif">
  <source srcset="/img/photo.webp" type="image/webp">
  <img src="/img/photo.jpg" alt="..." width="1200" height="800">
</picture>
```

`<picture>` 里可以放任意个 `<source>`，浏览器**从上往下**找第一个匹配的，然后用它替换 `<img>` 的 `src`/`srcset`。匹配条件有两种：

- `type`：浏览器是否支持这个 MIME 类型
- `media`：媒体查询是否匹配

**最后一个 `<img>` 是必需的兜底**，不能被省略。

### 艺术指导：不同屏幕用不同构图

这是 `<picture>` 独有的能力，`srcset` 做不到：

```html
<picture>
  <!-- 手机上用竖构图的特写 -->
  <source media="(max-width: 600px)" srcset="/img/hero-portrait.jpg">
  <!-- 平板用中等构图 -->
  <source media="(max-width: 1024px)" srcset="/img/hero-medium.jpg">
  <!-- 桌面用宽幅全景 -->
  <img src="/img/hero-wide.jpg" alt="产品全貌" width="1920" height="800">
</picture>
```

**为什么需要这个**：一张 1920×800 的宽幅图缩到 375px 宽的手机上，主体会小到看不清。正确的做法不是缩小，而是**换一张为小屏幕重新构图的图**（比如只保留主体的特写）。这叫 art direction。

**`srcset` 做不到这件事**——它假设所有候选都是同一张图的不同尺寸版本，只能按分辨率挑，不能按屏幕换构图。

### 两者可以组合

```html
<picture>
  <source
    media="(max-width: 600px)"
    srcset="/img/hero-p-400.webp 400w, /img/hero-p-800.webp 800w"
    sizes="100vw"
    type="image/webp">
  <source
    srcset="/img/hero-w-800.webp 800w, /img/hero-w-1600.webp 1600w"
    sizes="100vw"
    type="image/webp">
  <img src="/img/hero-w-1200.jpg" alt="产品全貌" width="1200" height="600">
</picture>
```

`<source>` 内部同样可以用 `srcset` + `sizes`。这是最完整的写法，也是最啰嗦的——只在真正需要时才这么写。

### 怎么选

| 需求 | 用什么 |
| --- | --- |
| 同一张图，按屏幕分辨率选清晰度 | `srcset` + `sizes` |
| 不同屏幕用不同构图的图 | `<picture>` + `media` |
| 提供 WebP/AVIF 并回退到 JPEG | `<picture>` + `type` |
| 以上都要 | `<picture>` 里套 `srcset` |

## 懒加载与加载优先级

### 原生懒加载

```html
<img src="/img/below-fold.jpg" alt="..." loading="lazy" width="800" height="600">
```

`loading="lazy"` 让浏览器推迟加载，直到图片接近视口时才请求。现代浏览器（Chrome、Firefox、Safari）都已支持原生 `loading` 属性，不再需要 IntersectionObserver 手写懒加载库。

**关键原则：首屏图片绝对不要加 `loading="lazy"`。** 这会推迟首屏关键资源的加载，直接拖慢 LCP（Largest Contentful Paint）指标。懒加载只对**折叠线以下**的图片有意义。

另一个注意点：懒加载图片**必须写 `width`/`height`**，否则浏览器不知道要预留多大空间，图片进入视口时依然会造成布局偏移——懒加载反而制造了 CLS。

### 加载优先级

```html
<!-- 首屏主图：提高优先级 -->
<img src="/img/hero.jpg" alt="..." fetchpriority="high" width="1920" height="800">

<!-- 非关键的辅助图片：降低优先级 -->
<img src="/img/thumbnail.jpg" alt="..." fetchpriority="low" loading="lazy">
```

`fetchpriority` 是较新的属性，浏览器支持度不如 `loading` 普遍，请以 [MDN 的 fetchpriority 页面](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Attributes/fetchpriority) 的兼容性表为准。它属于渐进增强——不支持的浏览器会忽略它，不会报错。

`decoding="async"` 也是可用的提示，告诉浏览器可以异步解码图片，避免阻塞主线程：

```html
<img src="/img/photo.jpg" alt="..." decoding="async">
```

## figure 与 figcaption

```html
<figure>
  <img src="/img/architecture.png" alt="系统架构图" width="1000" height="600">
  <figcaption>图 1：请求从 Nginx 进入，经 Fastify 处理后查询 PostgreSQL。</figcaption>
</figure>
```

`<figure>` 表示「一段自包含的内容，被主文引用但移除后不影响主文的理解」，`<figcaption>` 是它的标题（必须是 `<figure>` 的第一个或最后一个子元素）。

适用对象不只是图片——代码块、图表、视频、引用都可以放进 `<figure>`：

```html
<figure>
  <pre><code>const server = Fastify()</code></pre>
  <figcaption>清单 1：创建 Fastify 实例</figcaption>
</figure>
```

**什么时候不该用 `<figure>`**：如果图片只是正文的插图，删掉它正文就读不通了，那它不属于「自包含内容」，直接用 `<img>` + `<p>` 说明就好。滥用 `<figure>` 会让读屏软件反复播报「图形，标题……」，反而干扰阅读。

## SVG 的三种引入方式

```html
<!-- 方式 1：作为图片 -->
<img src="/icon.svg" alt="设置图标" width="24" height="24">

<!-- 方式 2：内联 -->
<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  <path d="M12 2L2 22h20L12 2z" fill="currentColor"/>
</svg>

<!-- 方式 3：CSS 背景（写在 CSS 里，不是 HTML） -->
```

| 方式 | 能用 CSS 改样式 | 能用 JS 操作 | 能被缓存 | 能交互 |
| --- | --- | --- | --- | --- |
| `<img>` | 否 | 否 | 是 | 否 |
| 内联 `<svg>` | 是 | 是 | 否（随 HTML 下载） | 是 |
| CSS 背景 | 部分 | 否 | 是 | 否 |

选择建议：

- **纯装饰图标、数量多、样式固定** → `<img>`，能被浏览器缓存，HTML 也干净。
- **需要跟随主题变色（比如暗色模式）** → 内联 `<svg>` + `fill="currentColor"`，这样颜色跟着 CSS 的 `color` 走。这是暗色模式图标的主流做法。
- **需要动画或交互** → 内联 `<svg>`。

内联 SVG 有一个重要注意点：**如果它是装饰性的，加 `aria-hidden="true"`**，否则读屏软件会尝试朗读 SVG 内部的 `<title>` 或路径数据。如果它承载信息，则用 `role="img"` + `<title>` 元素提供可访问名称。

## audio 与 video

```html
<video controls width="800" height="450" poster="/img/cover.jpg" preload="metadata">
  <source src="/video/intro.webm" type="video/webm">
  <source src="/video/intro.mp4" type="video/mp4">
  <track kind="subtitles" src="/video/intro-zh.vtt" srclang="zh" label="中文字幕" default>
  <p>你的浏览器不支持 video 元素，可以<a href="/video/intro.mp4">下载视频</a>观看。</p>
</video>
```

属性说明：

| 属性 | 作用 |
| --- | --- |
| `controls` | 显示浏览器自带的播放控件。**不加就没有任何控件**，用户无法播放/暂停 |
| `poster` | 视频加载前显示的封面图 |
| `preload` | `none`（不预加载）/ `metadata`（只加载元数据，默认行为因浏览器而异）/ `auto`（浏览器自行决定） |
| `autoplay` | 自动播放。**现代浏览器要求同时 `muted` 才允许**，否则会被拦截 |
| `loop` | 循环播放 |
| `muted` | 静音 |
| `playsinline` | iOS 上内联播放，不强制全屏 |

多个 `<source>` 的作用和 `<picture>` 一样：从上往下，第一个浏览器能播放的格式生效。`<video>` 内部的文本是**所有 source 都失败时**的兜底内容。

`<track>` 用于字幕、章节、描述等文本轨道，格式是 WebVTT（`.vtt`）。`kind` 的常见值：`subtitles`（字幕）、`captions`（含音效说明的字幕，无障碍必需）、`descriptions`（音频描述）、`chapters`（章节导航）。

`<audio>` 的属性与 `<video>` 基本一致，只是没有视觉部分。

<Callout type="warn" title="autoplay 的现实约束">

所有主流浏览器都禁止带声音的自动播放——这是为了防止「一打开页面就外放声音」的糟糕体验。要让视频自动播放，必须同时 `muted`：

```html
<video autoplay muted loop playsinline poster="/cover.jpg">
```

这也是为什么很多网站的「背景视频」都是静音循环的。如果你的产品需要自动播放带声音的视频，正确做法是先让用户交互（点击一个播放按钮），再在事件处理里调用 `video.play()`。

</Callout>

## 常见错误与排查

### 症状：图片在高分屏上模糊

按顺序排查：
1. 图片源文件本身的分辨率够不够？在 Retina 屏上显示 400px 宽的图片，源文件至少需要 800px。
2. `srcset` 的 `w` 描述符是否写了图片的**真实像素宽度**？写小了浏览器会选错图。
3. CSS 有没有把图片放大到超过源文件尺寸？比如源文件 400px，CSS 设成 `width: 800px`。

### 症状：页面加载时内容突然往下跳（CLS 高）

**原因**：`<img>` 没写 `width` 和 `height`。加上它们，浏览器就能在图片下载前预留正确比例的空间。

**排查**：Chrome DevTools → Performance 面板录制加载过程，查看 Layout Shift 事件；或 Lighthouse 跑一次，CLS 相关建议会直接指出是哪些元素。

### 症状：srcset 看起来没生效，总是加载 src

按顺序排查：
1. `w` 描述符有没有配 `sizes`？没有 `sizes` 时浏览器用视口宽度估算，可能总是选到你以为「不会选」的那张。
2. `srcset` 里的 URL 是否真的可访问？Network 面板看有没有 404。
3. **浏览器缓存**。已经缓存的图会被优先使用。DevTools 勾选 "Disable cache" 后硬刷新。
4. `srcset` 的语法有没有写错？多个候选之间用**逗号**分隔，每个候选内部 URL 和描述符之间用**空格**分隔。

### 症状：图片下方有几像素的空白

**原因**：`<img>` 是行内元素（inline），默认 `vertical-align: baseline`，会在下方留出字体降部（descender）的空间。

**解决**：

```css
img { display: block; }        /* 或 */
img { vertical-align: middle; }
```

### 症状：视频在 iOS Safari 上不自动播放

检查是否同时有 `muted` 和 `playsinline`。iOS 要求内联自动播放的视频必须静音，且需要 `playsinline` 才不会强制进入全屏播放器。

## 练习

<Exercise title="练习 1 · 写出响应式图片" difficulty="进阶">

需求：一张产品主图，在设计稿里的表现是——

- 视口宽度 ≤ 600px：图片占满屏幕宽度（100vw）
- 视口宽度 601px–1200px：图片占屏幕一半（50vw），左右各有一栏内容
- 视口宽度 > 1200px：图片固定 600px 宽

你手上有同一张图的四个尺寸版本：`p-400.jpg`（400×300）、`p-800.jpg`（800×600）、`p-1200.jpg`（1200×900）、`p-2400.jpg`（2400×1800）。

写出完整的 `<img>` 标签（含 `alt`、`width`、`height`）。

<template #answer>

```html
<img
  src="/img/p-1200.jpg"
  srcset="/img/p-400.jpg 400w,
          /img/p-800.jpg 800w,
          /img/p-1200.jpg 1200w,
          /img/p-2400.jpg 2400w"
  sizes="(max-width: 600px) 100vw,
         (max-width: 1200px) 50vw,
         600px"
  alt="产品外观：银色金属机身，正面为一块无边框屏幕"
  width="1200"
  height="900">
```

**每部分的选择理由**：

**`srcset` 用 `w` 描述符而不是 `x`**：因为图片的显示宽度会随视口变化（100vw / 50vw / 600px 三种情况），必须告诉浏览器每张图的真实像素宽度，让它结合显示宽度和 DPR 自己算。`x` 描述符只适用于显示宽度固定的情况。

**`w` 的值必须等于文件真实宽度**：`p-400.jpg` 是 400px 宽，就写 `400w`。写错会导致浏览器选图错误。

**`sizes` 的三个分支**：
- `(max-width: 600px) 100vw` —— 视口 ≤600px，图片占满视口
- `(max-width: 1200px) 50vw` —— 视口 601–1200px（前一个条件已排除 ≤600px），图片占一半
- `600px` —— 兜底，视口 >1200px 时图片固定 600px

注意媒体条件是**从上往下匹配，第一个为真的生效**，所以第二个不需要写成 `(min-width: 601px) and (max-width: 1200px)`。

**`src` 选 `p-1200.jpg`**：这是一个中等偏大的版本，在不支持 `srcset` 的环境里既能保证清晰度又不会太大。

**`width="1200" height="900"`**：与 `src` 指向的那张图的实际尺寸一致。浏览器会由此推出 `aspect-ratio: 4/3`，即使 CSS 把图片缩放到别的宽度，占位空间的比例也是对的，不会产生布局偏移。

**验证方法**：Chrome DevTools → Network 面板 → 筛选 Img → 勾选 "Disable cache" → 用设备模拟模式（`Ctrl+Shift+M`）切换不同视口宽度和 DPR，观察实际请求的是哪个文件。同时可以在 Console 里读 `document.querySelector('img').currentSrc` 看浏览器最终选了哪张。

</template>

</Exercise>

<Exercise title="练习 2 · srcset 还是 picture" difficulty="进阶">

判断下面三个需求分别该用 `srcset`、`<picture>`，还是两者结合，并写出代码：

1. 一张 3000px 宽的产品照片，需要在手机上省流量、在 Retina 桌面上清晰，**构图不变**。
2. 一张横幅图：桌面上是 1920×600 的全景（产品在整个办公环境中），手机上是 750×1000 的竖构图（只有产品特写）。
3. 一张插画，希望优先提供 AVIF，其次 WebP，最后回退到 PNG。

<template #answer>

**需求 1：只用 `srcset` + `sizes`**

构图不变、只是分辨率不同，这正是 `srcset` 的用途。用 `<picture>` 是杀鸡用牛刀，会让 HTML 变长且没有任何额外收益。

```html
<img
  src="/img/product-1200.jpg"
  srcset="/img/product-600.jpg 600w,
          /img/product-1200.jpg 1200w,
          /img/product-2000.jpg 2000w,
          /img/product-3000.jpg 3000w"
  sizes="(max-width: 768px) 100vw, 600px"
  alt="产品照片"
  width="3000"
  height="2000">
```

**需求 2：必须用 `<picture>` + `media`**

这是**艺术指导（art direction）**：手机上不是把全景图缩小，而是**换一张完全不同构图的竖图**。`srcset` 做不到——它假设所有候选是同一张图的不同尺寸，浏览器只会按分辨率挑，不会按屏幕换构图。

```html
<picture>
  <source
    media="(max-width: 768px)"
    srcset="/img/banner-m-375.jpg 375w, /img/banner-m-750.jpg 750w"
    sizes="100vw">
  <img
    src="/img/banner-d-1920.jpg"
    srcset="/img/banner-d-960.jpg 960w, /img/banner-d-1920.jpg 1920w"
    sizes="100vw"
    alt="产品在办公环境中的使用场景"
    width="1920"
    height="600">
</picture>
```

注意这里 `<source>` 和 `<img>` 内部**各自又用了 `srcset`**——这是两者的结合：先用 `media` 决定用哪套图（横构图还是竖构图），再用 `srcset` 在那套图里按分辨率挑。

**`width`/`height` 只能写一组**，这里写的是桌面版（`<img>` 上的那张）的尺寸。手机版比例不同，在小屏幕上仍会有轻微的布局偏移。如果要完全避免，需要用 CSS 配合媒体查询设置 `aspect-ratio`：

```css
.banner img { aspect-ratio: 1920 / 600; width: 100%; height: auto; }
@media (max-width: 768px) {
  .banner img { aspect-ratio: 750 / 1000; }
}
```

**需求 3：只用 `<picture>` + `type`**

这是纯粹的**格式回退**，与分辨率无关。

```html
<picture>
  <source srcset="/img/illustration.avif" type="image/avif">
  <source srcset="/img/illustration.webp" type="image/webp">
  <img src="/img/illustration.png" alt="插画说明" width="800" height="600">
</picture>
```

浏览器从上往下找第一个它支持的 `type`。不支持 AVIF 的浏览器会跳过第一个 `<source>`，检查 WebP，以此类推。最后的 `<img>` 是必需的兜底。

**如果既要格式回退又要分辨率切换**，就在每个 `<source>` 里同时写 `srcset` + `sizes`，并为每种格式准备多个尺寸——文件数量会成倍增长，所以要权衡是否真的需要。

</template>

</Exercise>

<Exercise title="练习 3 · 找出性能与无障碍问题" difficulty="基础">

审查这段代码，指出所有问题：

```html
<header>
  <img src="/logo.png" width="120">
  <img src="/hero-4000px.jpg" alt="英雄图" loading="lazy">
</header>

<main>
  <p>下面是我们的产品截图：</p>
  <img src="/screenshot.png">
  <img src="/decoration.svg" alt="装饰用的波浪线">
</main>
```

<template #answer>

**问题 1：Logo 没有 `alt`**

`<img src="/logo.png">` 完全省略了 `alt` 属性。如果 Logo 在链接里（很常见），读屏软件会尝试朗读文件名或链接内容，用户听到的是「logo 点 png」。

修正——如果 Logo 在返回首页的链接里：

```html
<a href="/"><img src="/logo.svg" alt="返回首页" width="120" height="32"></a>
```

`alt` 描述的是**功能**（返回首页），不是外观（公司 Logo）。

**问题 2：Logo 用了 PNG 而不是 SVG，且没有 `height`**

Logo 是典型的矢量图形，用 SVG 在任何屏幕上都清晰且体积更小。另外只写了 `width` 没写 `height`，浏览器无法推算宽高比，仍会产生布局偏移——**两个属性必须成对出现**。

**问题 3：首屏主图加了 `loading="lazy"`**

这是**性能上最严重的错误**。首屏主图（hero image）通常就是 LCP（Largest Contentful Paint）元素，加 `lazy` 会让浏览器推迟加载它，直接拖慢首屏。`loading="lazy"` 只应该用在**折叠线以下**的图片上。

修正：删掉 `loading="lazy"`，并考虑加 `fetchpriority="high"`：

```html
<img src="/hero-1600.webp" srcset="..." sizes="100vw"
     alt="..." width="1600" height="900" fetchpriority="high">
```

**问题 4：4000px 的图直接原图输出，没有 srcset**

4000px 宽的 JPEG 可能有几 MB。手机用户和 1x 屏桌面用户完全不需要这么大的图。应当提供多个尺寸版本并用 `srcset` + `sizes`，同时考虑转成 WebP。

**问题 5：`alt="英雄图"` 是无效描述**

「英雄图」是 hero image 的直译，它描述的是**这张图在页面里的角色**，而不是**它承载的信息**。视障用户听到「英雄图」得不到任何有用信息。

修正：描述图片实际内容。如果是产品照片就写产品特征，如果是纯装饰就写 `alt=""`。

**问题 6：产品截图完全没有 `alt`**

`<img src="/screenshot.png">` 既没有 `alt` 也没有 `width`/`height`。截图通常承载大量信息，需要认真写 `alt`；如果截图内容在正文里已经完整描述过，可以写 `alt="产品设置页面截图，内容如上所述"`。

**问题 7：装饰性图片的 alt 写成了描述**

`alt="装饰用的波浪线"` 会让读屏软件朗读「装饰用的波浪线」——这是纯粹的噪音，对用户没有任何价值。装饰性图片必须写 `alt=""`：

```html
<img src="/decoration.svg" alt="" width="800" height="24">
```

**修正后的完整代码**：

```html
<header>
  <a href="/"><img src="/logo.svg" alt="返回首页" width="120" height="32"></a>
  <img
    src="/hero-1600.webp"
    srcset="/hero-600.webp 600w, /hero-1200.webp 1200w, /hero-2000.webp 2000w"
    sizes="100vw"
    alt="三个人在开放式办公室里围绕一台笔记本电脑讨论"
    width="2000" height="1125"
    fetchpriority="high">
</header>

<main>
  <p>下面是我们的产品截图：</p>
  <img src="/screenshot.png" alt="产品设置页面，左侧是导航菜单，右侧是账户选项" width="1280" height="800">
  <img src="/decoration.svg" alt="" width="800" height="24">
</main>
```

**这道题的通用检查清单**（可以拿去审查自己的代码）：

1. 每个 `<img>` 都有 `alt` 吗？（装饰图写 `alt=""`，不能省略）
2. `alt` 描述的是信息还是外观？链接里的图描述的是功能吗？
3. 每个 `<img>` 都有 `width` **和** `height` 吗？
4. 首屏图片有没有被误加 `loading="lazy"`？
5. 大图有没有提供 `srcset` 多尺寸版本？
6. 图标和 Logo 是不是该用 SVG？

</template>

</Exercise>

## 官方文档与延伸阅读

- [WHATWG HTML 标准 · 图片](https://html.spec.whatwg.org/multipage/images.html) —— `img`、`picture`、`source`、`srcset`/`sizes` 的选图算法、`figure`、`figcaption` 的规范定义。**「浏览器怎么挑图」的权威答案在这里。**
- [MDN · 响应式图片](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Responsive_images) —— 本章 `srcset`/`sizes`/`picture` 内容的最佳补充阅读，有完整的示例。
- [MDN · `<img>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/img) —— 所有属性、选图算法说明、浏览器兼容性表。
- [MDN · `<picture>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/picture)
- [MDN · `<video>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/video) —— 包含 autoplay 策略的说明。
- [MDN · `<track>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/track) —— 字幕轨道与 WebVTT。
- [MDN · `<figure>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/figure)
- [MDN · fetchpriority 属性](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Attributes/fetchpriority) —— 加载优先级，注意查看兼容性表。
- [W3C WAI · 图片无障碍教程](https://www.w3.org/WAI/tutorials/images/) —— `alt` 文本写法的权威指导，按图片类型分了七种情形，比本章讲得更细。
- [MDN · `<img>` 的 width 属性](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/img#width) —— 关于宽高比自动计算的说明。

## 下一章

图片是「展示」，接下来是「收集用户输入」——这是 HTML 里最复杂、也最容易做错的部分：[表单](/html/forms)。
