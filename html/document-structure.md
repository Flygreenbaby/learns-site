# 文档骨架：DOCTYPE、head 与元数据

一个 HTML 文档里，用户能看见的内容全在 `<body>` 里，但决定这个页面**能否被正确解析、在手机上是否正常缩放、被搜索引擎和社交软件如何展示**的东西，全在 `<head>` 里。

这一章逐行拆解一个完整的文档骨架，说清每一行为什么在那儿、删掉会怎样。

## 完整骨架

先看整体，后面逐个解释：

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>页面标题 - 站点名</title>
    <meta name="description" content="一句话说明这个页面的内容，用于搜索结果摘要。">
    <link rel="stylesheet" href="/assets/style.css">
    <link rel="icon" href="/favicon.ico" sizes="any">
  </head>
  <body>
    <!-- 页面内容 -->
  </body>
</html>
```

这 8 行 head 内容里，前三项（`charset`、`viewport`、`title`）是**几乎任何页面都必须有的**，其余按需。

## `<html lang>`：不是可选的装饰

```html
<html lang="zh-CN">
```

`lang` 属性的值是一个 **BCP 47 语言标签**。常见的取值：

| 值 | 含义 |
| --- | --- |
| `zh-CN` | 简体中文（中国大陆） |
| `zh-TW` | 繁体中文（台湾） |
| `zh-Hant` | 繁体中文（不限地区，按文字体系划分） |
| `en` | 英语（不指定地区） |
| `en-US` | 美式英语 |

`zh-CN` 和 `zh-Hant` 的区别值得说明：前者按**地区**划分，后者按**文字体系**划分。如果你写的是繁体中文但不想限定地区，用 `zh-Hant` 更准确。

这个属性有五个真实的、可观察的作用：

1. **读屏软件的发音**。中文和英文的语音引擎完全不同。没有 `lang`，读屏软件会用默认语言去念，英文单词会被逐字母拼读，中文会被念成乱码音。
2. **连字符断词（hyphenation）**。CSS 的 `hyphens: auto` 依赖 `lang` 才知道在哪个位置可以断行。
3. **字体选择**。浏览器在 `font-family` 没有指定具体字体时，会用 `lang` 来决定 fallback 到哪个中文字体。这直接影响「同一个字体族在简体和繁写下渲染出的字形是否地道」——比如「骨」「直」「门」这几个字，简繁字形不同。
4. **浏览器翻译提示**。没有 `lang` 时，浏览器不知道当前页面语言，可能对本就是中文的页面弹出「是否翻译此页」。
5. **搜索引擎的语言信号**。

`lang` 也可以用在任何元素上做局部覆盖，比如中文页面里的一段英文引文：

```html
<p>正如标准里写的：<q lang="en">The html element represents a document.</q></p>
```

<Callout type="warn" title="常见错误：lang 写错或写成 zh">

`lang="zh"` 是合法的（表示中文，不区分简繁），但对简体中文页面不够精确。`lang="chinese"`、`lang="cn"`、`lang="zh_CN"`（下划线）都是**错误的**——最后这个尤其常见，因为很多编程语言的 locale 用下划线，但 BCP 47 用连字符。写错不会报错，但读屏软件和字体选择都会失效。

</Callout>

## `<meta charset="utf-8">`

```html
<meta charset="utf-8">
```

作用在[上一章](/html/what-is-html#第-1-步-字节流-→-字符流-编码解码)已经讲过：告诉浏览器用什么编码把字节解释成字符。

三个必须知道的点：

**1. 它必须在前 1024 字节内。** 标准要求包含编码声明的元素完整地出现在文档前 1024 字节中。所以把它放在 `<head>` 的第一个位置。如果你在它前面塞了大量注释或内联 CSS，声明可能失效。

**2. 它必须和文件实际编码一致。** 光写 `utf-8` 不够，文件本身也得以 UTF-8 保存。VS Code 右下角状态栏显示当前编码，点击可以「通过编码保存」。

**3. HTTP 响应头的优先级更高。** 如果服务器返回了 `Content-Type: text/html; charset=gbk`，那么文档里的 `<meta charset="utf-8">` 会被忽略。这是本地打开正常、部署到服务器后乱码的典型原因。

**为什么是 UTF-8 而不是 GBK**：UTF-8 能表示 Unicode 的全部字符（包括 emoji、各种语言文字），是 Web 的事实标准。GBK 只能表示中文相关字符，页面里出现一个 emoji 就会变成 `?`。

## `<meta name="viewport">`：移动端的开关

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

这是移动端布局的**总开关**，不理解它就没法做响应式设计。

### 没有它会发生什么

移动浏览器的渲染流程分两步。首先它假设你写的是一个**没有适配移动端的老网页**，于是用一个默认的**虚拟视口（layout viewport）**宽度去布局——历史上 iOS Safari 用 980px，其他浏览器多在 980px 附近。布局完成后，它把整个 980px 宽的页面**缩小**塞进物理屏幕，让用户能看到全貌再手动放大。

结果就是：你的手机屏幕上，所有文字都小到看不清，需要双指放大才能读。

### 这行代码做了什么

- `width=device-width`：把虚拟视口宽度设为设备的**逻辑像素宽度**（CSS 像素），而不是 980px。iPhone 上通常是 390 或 430，Android 上通常是 360 或 412。
- `initial-scale=1`：初始缩放比例为 1，即 1 个 CSS 像素对应 1 个设备无关像素。

两个都写是必要的：只写 `width=device-width`，在横竖屏切换时某些浏览器行为不一致；只写 `initial-scale=1`，视口宽度可能不是设备宽度。

### 关于 `user-scalable=no` 和 `maximum-scale=1`

你会在很多老教程和框架模板里看到：

```html
<!-- 不推荐 -->
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
```

这样做的动机是防止用户双指缩放破坏布局。但**这是无障碍问题**：视力不好的用户被剥夺了放大页面的能力。WCAG 2.2 的成功准则 1.4.4（Resize Text）要求文本能被放大到 200%。iOS Safari 从 10 开始会直接忽略 `user-scalable=no`。

**结论：不要写 `user-scalable=no` 和 `maximum-scale`。** 如果你的布局在用户缩放后会坏掉，问题在布局，不在缩放。

## `<title>`：唯一一个必然被使用的元数据

```html
<title>HTML 文档骨架 - 全栈学习手册</title>
```

`title` 是 `<head>` 里**唯一必需的元素**（HTML 标准规定每个文档都应当有一个非空的 title，除少数例外情形）。它出现在：

- 浏览器标签页标题
- 书签名称
- 搜索结果标题
- 社交软件分享链接时的标题
- 读屏软件切换到新窗口时的播报
- Windows 任务栏 / macOS Dock 的悬停提示

写作要点：

1. **每个页面必须唯一**。整个网站所有页面都叫「首页」是常见错误，会导致用户开了十个标签页分不清。
2. **重要信息放前面**。标签页宽度有限，后面的会被截断。`HTML 文档骨架 - 全栈学习手册` 比 `全栈学习手册 - HTML 文档骨架` 好，因为截断时留下的是页面主题。
3. **不要在 title 里塞关键词堆砌**。这既影响可读性，也是搜索引擎明确惩罚的行为。

## `<meta name="description">`

```html
<meta name="description" content="一句话说明这个页面的内容。">
```

搜索引擎在生成搜索结果摘要时会**参考**这个内容。需要如实说明的是：

- 搜索引擎不保证一定使用你写的 description，它可能根据用户的搜索词从页面正文中截取更相关的片段。
- 各搜索引擎是否把 description 作为**排名因素**，官方从未明确承诺。把它当作「影响点击率的摘要文案」来写，比当作「SEO 技巧」更准确。
- 内容应当真实概括页面，长度通常在 50–160 个字符之间比较合适（过长会被截断）。

<Callout type="unverified" title="关于 SEO 效果的说明">

搜索引擎的排名算法是不公开的、且持续变化。本站不会给出「这样写能提高排名」的断言。以上关于 description 用途的描述基于 MDN 与搜索引擎公开文档的一般说明，具体效果请以各搜索引擎的官方文档为准，并自行验证。

</Callout>

## `<link>`：外部资源与文档关系

`<link>` 用来声明当前文档与外部资源的关系，由 `rel` 属性指定关系类型。

```html
<link rel="stylesheet" href="/assets/style.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="canonical" href="https://example.com/docs/html">
<link rel="preload" href="/fonts/main.woff2" as="font" type="font/woff2" crossorigin>
```

| `rel` 值 | 作用 |
| --- | --- |
| `stylesheet` | 引入 CSS。**这是最常见的用法。** |
| `icon` | 网站图标（favicon） |
| `canonical` | 声明本页的规范 URL，用于处理重复内容 |
| `preload` | 提前加载当前页面**一定会用到**的关键资源 |
| `prefetch` | 空闲时预取用户**可能会访问**的下一个页面的资源 |
| `alternate` | 声明同一内容的其他版本（如其他语言、RSS 订阅源） |
| `noopener` | 用于 `<a>`，切断新窗口对原窗口的引用 |

<Callout type="warn" title="preload 与 prefetch 的区别，以及滥用的代价">

`preload` 是**高优先级**加载，用于当前页面的关键资源（首屏字体、首屏大图）。它会在解析到这一行时就开始加载。

`prefetch` 是**最低优先级**，浏览器空闲时才做，用于下一个页面的资源。

常见错误是给一堆资源都加 `preload`。preload 之间会互相抢带宽，还会**阻塞**其他更重要的资源，结果反而拖慢首屏。经验法则：只 preload「CSS 里引用了、但浏览器要等 CSS 下载解析完才能发现」的资源，主要是字体。

</Callout>

## `<base>`：强大但危险

```html
<base href="/docs/" target="_blank">
```

`<base>` 改变**整个文档**中所有相对 URL 的解析基准，以及所有链接的默认 `target`。

它是一个全局开关，副作用极大：

- 页面里所有的相对链接、`<img src>`、`<script src>`、甚至 CSS 里的 `url()` 都会被影响
- 锚点链接 `#section` 会被解析成 `<base href>` + `#section`，点击后可能跳转到别的页面
- 一个文档只能有一个 `<base>`，多个时只有第一个生效，且不会有警告

**建议：除非你在做一个所有资源路径都需要动态前缀的单页应用，否则不要用 `<base>`。** 现代构建工具（Vite 的 `base` 配置项）能更安全地解决同样的问题。

## `<body>` 与文档结构约束

`<body>` 包含所有可见内容。几条容易忽略的规则：

1. 一个文档只能有一个 `<body>` 和一个 `<head>`。
2. `<head>` 必须在 `<body>` 之前。
3. 这两个标签**可以省略**——解析器会自动补上。这就是为什么你在上一章看到 `<html><head>...</head><body>...</body></html>` 和不写它们的例子都能工作。但**不要省略**，因为省略会导致一些边界情况下的解析歧义，且工具链（模板引擎、压缩器）处理起来更容易出错。
4. `<body>` 的直接子元素里，**文本节点是不应该出现的**。所有可见文本都应当在某个块级元素内。裸文本虽然能显示，但会让 CSS 布局难以控制，也不利于语义化。

## 常见错误与排查

### 症状：手机上文字极小，需要放大才能看

**原因**：缺少 `<meta name="viewport">`，浏览器用了 980px 的虚拟视口。

**排查**：DevTools 切换到设备模拟模式（Chrome 快捷键 `Ctrl + Shift + M`），查看顶部的尺寸显示。如果布局视口是 980px 而不是设备宽度，就是这个问题。

### 症状：本地打开正常，部署后中文乱码

**原因**：服务器返回的 `Content-Type` 响应头指定了非 UTF-8 编码，且优先级高于 `<meta charset>`。

**排查**：DevTools → Network → 点击文档请求 → Response Headers，检查 `Content-Type` 的 charset 值。Nginx 的解决办法是在配置里加 `charset utf-8;`，或者确保不发送冲突的 charset。

### 症状：favicon 不显示

按顺序检查：
1. 文件路径是否正确（注意 `/favicon.ico` 是根路径相对，`favicon.ico` 是当前目录相对）
2. `<link rel="icon">` 的 `type` 是否和文件格式匹配（SVG 图标需要 `type="image/svg+xml"`）
3. **浏览器缓存**。favicon 缓存非常顽固，普通刷新可能无效，需要硬刷新或在新标签页直接访问图标 URL 确认文件本身可访问

### 症状：改了 `<head>` 里的内容但没生效

**原因**：可能是把元素写到了错误的位置。`<link>`、`<meta>`、`<title>` 都属于 head 内容，写在 `<body>` 里时解析器会做特殊处理（有些会被移动到 head，有些会被忽略），行为不直观。

**排查**：DevTools 的 Elements 面板看实际 DOM 树里这些元素在哪。

## 练习

<Exercise title="练习 1 · 找出骨架里的错误" difficulty="基础">

下面这段文档骨架有 4 处问题，找出来并说明原因：

```html
<html lang="zh_CN">
  <head>
    <title>我的网站</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
    <meta charset="utf-8">
    <base href="/">
  </head>
  <body>
    欢迎来到我的网站
  </body>
</html>
```

<template #answer>

**问题 1：缺少 `<!DOCTYPE html>`。** 文档会进入怪异模式（quirks mode），盒模型计算方式改变——`width` 会包含 padding 和 border。详见[上一章](/html/what-is-html#标准模式与怪异模式-doctype-的真实作用)。

**问题 2：`lang="zh_CN"` 用了下划线。** BCP 47 语言标签使用连字符，正确写法是 `zh-CN`。下划线版本不会被识别为有效语言标签，读屏软件的语音选择、字体 fallback、连字符断词都会失效。

**问题 3：`user-scalable=no`。** 剥夺了用户缩放页面的能力，违反 WCAG 2.2 成功准则 1.4.4（Resize Text，要求文本可放大到 200%）。iOS Safari 从版本 10 起直接忽略这个设置，所以它既造成无障碍问题又没什么实际效果。

**问题 4：`<meta charset>` 的位置。** 它排在 `<title>`、`<meta name="viewport">` 之后。虽然这几行加起来还远没到 1024 字节，但**编码声明应当尽可能靠前**——它决定了后面所有字节如何被解释。如果前面有大量内容（长标题、注释、内联样式），声明可能落在 1024 字节之外而失效。

**另外还有两个值得改进的地方**（不算严格错误）：

- `<title>` 是「我的网站」，所有页面都一样。应当每个页面唯一，且把页面主题放前面。
- `<body>` 里有裸文本节点「欢迎来到我的网站」。应当包在 `<p>` 或 `<h1>` 里。裸文本难以用 CSS 控制，也缺乏语义。
- `<base href="/">` 在没有明确需要时是危险的，会影响整个文档所有相对 URL 的解析，包括锚点链接。

**修正版**：

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>首页 - 我的网站</title>
  </head>
  <body>
    <h1>欢迎来到我的网站</h1>
  </body>
</html>
```

</template>

</Exercise>

<Exercise title="练习 2 · viewport 的推理" difficulty="进阶">

一个页面的 CSS 里写了：

```css
.container { width: 100%; max-width: 1200px; margin: 0 auto; }
```

分别说明在以下三种情况下，用一台逻辑宽度为 390px 的手机访问时，`.container` 的实际宽度是多少，以及页面是否需要横向滚动：

1. 文档中有 `<meta name="viewport" content="width=device-width, initial-scale=1">`
2. 文档中没有 viewport meta
3. 文档中有 `<meta name="viewport" content="width=1200">`

<template #answer>

**情况 1：`.container` 宽度 390px，不需要横向滚动。**

`width=device-width` 把布局视口设为 390px。`width: 100%` 相对于父元素，最终解析为 390px。`max-width: 1200px` 不生效（390 < 1200）。这是正常的响应式表现。

**情况 2：`.container` 宽度 980px（或该浏览器的默认虚拟视口宽度），页面被整体缩小显示，文字很小。**

没有 viewport meta 时，移动浏览器假设页面没有做移动端适配，使用默认的虚拟视口宽度（iOS Safari 历史上是 980px，不同浏览器和版本可能不同）进行布局。`.container` 于是是 980px，然后整个 980px 的渲染结果被缩放到 390px 的物理屏幕上。**不需要横向滚动**，但所有内容都小到难以阅读，用户需要双指放大。

注意这里的 980px 不是标准规定的固定值，而是各浏览器的实现选择，所以不应依赖具体数字。

**情况 3：`.container` 宽度 1200px，需要横向滚动。**

`width=1200` 强制把布局视口设为 1200px。`.container` 的 `width: 100%` 解析为 1200px。如果 `initial-scale` 没有相应设置，浏览器需要把 1200px 缩放到 390px 屏幕；但一旦用户放大到 1:1，就会出现横向滚动条。

这种写法的用途是：你有一个固定宽度、不打算做响应式的桌面页面，希望在手机上保持原来的比例而不是被拉伸或重排。

**核心结论**：`width=device-width` 是响应式设计的**前提**。没有它，所有 `@media (max-width: ...)` 查询都不会按你预期触发——因为布局视口宽度是 980px，不是 390px，媒体查询看到的是 980px。这是初学者做响应式时最常踩的坑之一。

</template>

</Exercise>

<Exercise title="练习 3 · title 的写法" difficulty="基础">

为一个中文技术博客的以下三个页面写 `<title>`，并说明你的命名规则：

1. 博客首页
2. 一篇标题为「Flexbox 的 align-items 与 align-content 到底有什么区别」的文章
3. 「关于我」页面

<template #answer>

参考答案（站点名假设为「前端笔记」）：

```html
<!-- 1. 首页 -->
<title>前端笔记 - 关注 CSS 布局与浏览器渲染原理</title>

<!-- 2. 文章页 -->
<title>Flexbox 的 align-items 与 align-content 到底有什么区别 - 前端笔记</title>

<!-- 3. 关于页 -->
<title>关于我 - 前端笔记</title>
```

**命名规则与理由**：

1. **首页是唯一把站点名放前面的**。因为用户直接搜站点名时，首页应当首先匹配；而且首页没有更具体的主题可以放前面。首页的 title 还应当带一句站点定位说明，这在搜索结果里比光秃秃的站点名信息量大得多。

2. **内容页把页面主题放前面，站点名放后面，用 ` - ` 分隔**。原因有两个：
   - 标签页宽度有限，浏览器会截断尾部。主题在前能保证截断后仍然看得出这是哪一页。
   - 用户同时打开多个标签页时，标签上显示的是 title 的开头部分，主题在前才能区分。

3. **分隔符的选择**。常用的是 `-`（连字符）、`|`（竖线）、`·`（间隔号）。三者在搜索引擎里的处理基本一致，选一个全站统一即可。避免用 `>` 或 `>>`，在 HTML 里需要转义且视觉噪音大。

4. **不要重复站点名多次**，比如 `前端笔记 - Flexbox 区别 - 前端笔记`。

5. **长度控制**。中文字符在搜索结果里占用宽度较大，整体控制在 30 个汉字以内比较安全，超出部分会被截断并显示省略号。

**验证方式**：把 title 复制到一个宽度有限的容器里看会不会被截断，或者直接在搜索引擎里搜一下同类标题，观察显示效果。

</template>

</Exercise>

## 官方文档与延伸阅读

- [WHATWG HTML 标准 · 文档语义（含 `<html>`、`<head>`、`<title>`、`<meta>`、`<base>`、`<link>`）](https://html.spec.whatwg.org/multipage/semantics.html) —— 本章所有元素的权威定义。
- [WHATWG HTML 标准 · `<html>` 元素](https://html.spec.whatwg.org/multipage/semantics.html#the-html-element) —— `lang` 属性的规范性说明。
- [MDN · `<meta>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/meta) —— 所有 `name` 和 `http-equiv` 取值的清单。
- [MDN · viewport meta 标签](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/meta/name/viewport) —— 各个 viewport 属性的详细说明。
- [MDN · Viewport meta tag（指南）](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Viewport_meta_tag) —— 移动端视口的工作机制，本章「没有它会发生什么」一节的来源。
- [MDN · `<title>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/title)
- [MDN · `<base>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/base) —— 注意页面上的警告框，MDN 自己也强调了这个元素的风险。
- [MDN · `<link>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/link)
- [MDN · link 类型](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Attributes/rel) —— `rel` 所有取值的完整清单。
- [W3C Internationalization · HTML 中的语言声明](https://www.w3.org/International/questions/qa-html-language-declarations) —— `lang` 属性该写什么值的权威指导。
- [Open Graph 协议](https://ogp.me/) —— 社交分享卡片的 `og:*` 元数据规范。

## 下一章

骨架搭好了，接下来填充内容：[文本语义——标题、段落、列表与强调](/html/text-semantics)。
