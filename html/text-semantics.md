# 文本语义：标题、段落、列表与强调

HTML 里有几十个用于文本的元素，绝大多数人只用了其中 5 个：`p`、`div`、`span`、`strong`、`br`。这不是因为其他元素没用，而是因为它们的**区别是语义层面的，视觉上几乎看不出来**——所以在没有 CSS 的裸页面里，你看不出 `<em>` 和 `<i>` 有什么不同（其实有，`em` 默认斜体，`i` 也默认斜体，视觉上完全一样）。

但它们的区别在三个地方会真实体现出来：

1. **读屏软件**。视障用户听到的是「强调」还是「重要」还是「技术术语」，语气完全不同。
2. **搜索引擎与阅读器**。它们靠语义标签理解页面结构，`article` 里的 `h1` 和 `div` 里的加粗字体不是一回事。
3. **可维护性**。当你要改样式时，`<strong>` 告诉你「这里是重要信息」，而 `<span class="bold">` 只告诉你「这里是粗的」——前者能推导出该用什么颜色，后者不能。

这一章的目标是让你**根据内容的含义选标签，而不是根据想要的样子选标签**。

## 标题层级：h1–h6

### 基本规则

```html
<h1>文档主标题</h1>
<h2>第一级小节</h2>
<h3>小节下的小节</h3>
<h2>第二级小节</h2>
<h3>小节下的小节</h3>
<h4>更细的一层</h4>
```

三条硬规则：

**1. 不能跳级。** 从 `h2` 直接到 `h4` 是错误的。读屏软件的用户会用「跳到下一个标题」的功能浏览页面，跳级会让他们以为自己漏掉了内容。无障碍检测工具（如 axe、Lighthouse）会把跳级报为问题。

**2. 不要用标题当「大字」。** 想要大字号应该用 CSS。`<h1 style="font-size: 16px">` 这种写法既污染语义又难维护。

**3. 标题后面必须跟它统领的内容。** 一个空的标题（后面没有正文）是无意义的。

### 关于 h1 的数量：一个被纠正过的误解

你可能读过这样的说法：「HTML5 引入了文档大纲算法，所以每个 `<section>` 或 `<article>` 里都可以用 `<h1>`，浏览器会自动根据嵌套层级计算出实际层级。」

**这个说法现在已经不成立了。** 那个「隐式大纲算法」从未被任何浏览器或辅助技术实现过——也就是说，你在 `<section>` 里写的 `<h1>`，读屏软件就是当作 `h1` 播报的，不会因为嵌套在 `section` 里就变成 `h2`。

HTML 标准后来删除了那个算法。现行标准里对文档大纲的定义非常直接：**大纲就是文档中所有标题按树序排列的结果**，由 `h1`–`h6` 的层级本身决定，分节内容（`section`、`article`、`nav`、`aside`）**不会产生任何隐含的标题层级**。

所以实践结论是：

- 一个页面通常只有一个 `h1`，代表页面主题。
- 后续层级严格按 `h2` → `h3` → `h4` 递进，不要跳级。
- 即使内容被包在 `<article>` 或 `<section>` 里，也要用它在整个页面中**实际所处的层级**，而不是从 `h1` 重新开始。

### `hgroup`

```html
<hgroup>
  <h1>HTML 文本语义</h1>
  <p>标题、段落、列表与强调的正确用法</p>
</hgroup>
```

`hgroup` 用来把一个标题和它的相关副标题包在一起，让副标题**不出现在文档大纲里**。上面这个例子中，大纲只有「HTML 文本语义」一项，那行 `<p>` 副标题不算标题。

如果你只是想让副标题显示得小一点，用 CSS 就够了；`hgroup` 的价值在于明确表达「这行不是标题，是标题的附属说明」。

## 段落：p

```html
<p>这是一个段落。段落是文本语义的基本单位。</p>
```

`<p>` 有一个必须知道的内容模型限制：**它只能包含短语内容（phrasing content），不能包含块级元素。**

这直接导致了[第一章](/html/what-is-html#先看一个会让人困惑的现象)开头那个现象：

```html
<!-- 错误写法 -->
<p>说明文字
  <div class="note">注意事项</div>
</p>

<!-- 浏览器实际生成的结构 -->
<p>说明文字</p>
<div class="note">注意事项</div>
```

`<p>` 里能放什么：文本、`<a>`、`<strong>`、`<em>`、`<code>`、`<span>`、`<img>`、`<br>`、`<input>` 等**行内元素**。
`<p>` 里不能放什么：`<div>`、`<p>`、`<ul>`、`<table>`、`<section>`、`<form>`、`<h1>`–`<h6>` 等**块级元素**。

<Callout type="warn" title="不要用 p 包一整块内容">

一个常见的坏习惯是把大段内容全塞进一个 `<p>`，中间用 `<br>` 换行。这会让文本失去结构：读屏软件无法分辨哪里是一个独立的意群，搜索引擎也拿不到段落级信息。应当按语义拆成多个 `<p>`、`<ul>`、`<h2>` 等。

</Callout>

## div 与 span：无语义容器

- `<div>`：块级无语义容器，用于**样式或脚本需要**把一块内容包起来时。
- `<span>`：行内无语义容器，同理。

它们不是错误，但它们是**最后的选择**。正确的思考顺序是：

1. 这块内容是什么？——是导航？用 `<nav>`。是一组列表项？用 `<ul>`。是一句引用？用 `<blockquote>`。
2. 找不到合适的语义元素了吗？——那就用 `<div>`，并给它一个能说明用途的 `class`。

**检验你是否滥用 div 的方法**：把 CSS 全部禁用（Chrome DevTools 里可以用 "Emulate CSS media type" 或直接在 Sources 面板停用样式表），页面内容是否依然以合理的顺序、合理的分组呈现？如果禁用 CSS 后整个页面变成一坨分不清结构的文字，说明你的语义全靠 class 名撑着，而这些信息读屏软件和搜索引擎都拿不到。

## 列表：ul、ol、dl

### 无序列表 ul

用于**顺序无关**的一组条目：

```html
<ul>
  <li>HTML</li>
  <li>CSS</li>
  <li>TypeScript</li>
</ul>
```

最常见的误用是「导航栏不用 ul」。导航本质上就是一组链接条目，语义上是列表：

```html
<nav aria-label="主导航">
  <ul>
    <li><a href="/">首页</a></li>
    <li><a href="/docs/">文档</a></li>
    <li><a href="/about/">关于</a></li>
  </ul>
</nav>
```

读屏软件会播报「列表，3 项」，让用户知道导航有多少个入口。用一堆裸 `<a>` 则丢失了这个信息。CSS 去掉项目符号只需 `list-style: none`（注意部分浏览器会因此也移除列表语义，需要加 `role="list"` 补救，详见[无障碍章节](/html/accessibility)）。

### 有序列表 ol

用于**顺序有意义**的条目：

```html
<ol>
  <li>克隆仓库</li>
  <li>安装依赖</li>
  <li>启动开发服务器</li>
</ol>
```

几个有用的属性：

```html
<!-- 从 5 开始编号 -->
<ol start="5">
  <li>第五项</li>
  <li>第六项</li>
</ol>

<!-- 倒序编号，适合排行榜 -->
<ol reversed>
  <li>第三名</li>
  <li>第二名</li>
  <li>第一名</li>
</ol>

<!-- 手动指定某项的编号 -->
<ol>
  <li>第一项</li>
  <li value="10">第十项</li>
  <li>第十一项（自动接续 value）</li>
</ol>
```

判断该用 `ul` 还是 `ol` 的标准很简单：**把条目打乱顺序，含义会不会变？** 会变就用 `ol`。

### 描述列表 dl

用于**术语 + 解释**的键值对结构：

```html
<dl>
  <dt>HTML</dt>
  <dd>描述文档结构与语义的标记语言。</dd>

  <dt>CSS</dt>
  <dd>描述文档如何呈现的样式语言。</dd>
  <dd>也用于定义布局和动画。</dd>

  <dt>JavaScript</dt>
  <dt>ECMAScript</dt>
  <dd>前者是后者在浏览器环境中的实现加上 Web API。</dd>
</dl>
```

- `<dt>`（description term）：术语
- `<dd>`（description details）：解释，可以有多个
- 一个 `<dt>` 可以对应多个 `<dd>`，多个 `<dt>` 也可以共享后续的 `<dd>`

`<dl>` 适合的场景：词汇表、配置项说明、元数据键值对（如「作者 / 发布日期 / 分类」）、FAQ。

<Callout type="warn" title="dl 的常见误用">

不要用 `<dl>` 来做「一行两列的表格数据」。如果数据是结构化的记录（每行有相同的列含义），应该用 `<table>`。`<dl>` 表达的是「术语—解释」关系，不是行列关系。

</Callout>

## 强调与重要：em、strong 以及它们的视觉替身

这是文本语义里区分度最细、也最容易搞混的一组。关键在于理解：**HTML 里有两组元素，一组表达语义，一组只表达视觉，它们默认样式看起来一样。**

| 元素 | 默认样式 | 语义 |
| --- | --- | --- |
| `<em>` | 斜体 | **强调（stress emphasis）**：改变句子的语气重心 |
| `<i>` | 斜体 | **另一种语气或语态**：技术术语、外文短语、思想活动、分类名 |
| `<strong>` | 粗体 | **重要性（strong importance）**：这段内容很关键 |
| `<b>` | 粗体 | **吸引注意**：关键词、产品名、导语，不带额外重要性 |
| `<mark>` | 黄底黑字 | **高亮**：因为上下文相关而被标记出来（如搜索结果命中） |
| `<small>` | 小字 | **附注、次要信息**：版权声明、免责声明、法律细节 |
| `<s>` | 删除线 | **不再准确或不再相关**的内容 |
| `<del>` | 删除线 | **从文档中被移除**的内容（编辑痕迹），可带 `datetime` |
| `<ins>` | 下划线 | **新插入**的内容（编辑痕迹），可带 `datetime` |

### em 与 i 的区别

```html
<p>这个函数<em>必须</em>在事务中调用。</p>
<!-- 语气：不是「可以」，是「必须」 -->

<p>这种现象在心理学上称为 <i lang="la">déjà vu</i>。</p>
<!-- 语义：这是一个外来术语，不是我在强调它 -->
```

两者默认都是斜体，但读屏软件对 `<em>` 会改变语气（加重），对 `<i>` 通常不做特殊处理（部分会切换语音语言，如果标了 `lang`）。

### strong 与 b 的区别

```html
<p><strong>警告：此操作会永久删除数据，无法撤销。</strong></p>
<!-- 语义：这条信息至关重要 -->

<p>本文对比 <b>Vue</b> 和 <b>React</b> 的状态管理方案。</p>
<!-- 语义：这是需要吸引注意的关键词，但不比别的更重要 -->
```

判断标准：**如果去掉这个标签，读者会不会错过重要信息？** 会就用 `strong`，不会而只是想让它显眼就用 `b`（或者干脆用 CSS）。

### mark：搜索结果高亮

```html
<p>你搜索了「层叠」，找到 3 处匹配：CSS 的<mark>层叠</mark>顺序由特异性决定……</p>
```

`<mark>` 表示「因为当前上下文而被标记出来」，注意是**上下文相关**——同一段文字在别的场景里不需要高亮。

### del 与 ins：编辑痕迹

```html
<p>会议时间定在 <del datetime="2026-10-01">10 月 1 日</del> <ins datetime="2026-10-05">10 月 8 日</ins>。</p>
```

`datetime` 属性的值是修改发生的时间（格式见下文 `<time>` 一节）。`<del>` 和 `<s>` 的区别：`<del>` 表示「这段内容被从文档里删掉了，保留是为了记录变更」，`<s>` 表示「这段内容还在，但已经不准确了」（比如原价）。

## 引用：blockquote、q、cite

```html
<blockquote cite="https://html.spec.whatwg.org/multipage/semantics.html">
  <p>The html element represents a document.</p>
</blockquote>

<p>标准里说 <q>the html element represents a document</q>。</p>

<p>这段引自 <cite>HTML 标准</cite>。</p>
```

三者的区别：

- **`<blockquote>`**：块级长引用，浏览器默认会缩进。`cite` 属性放引用来源的 URL（**注意：这个 URL 不会显示出来**，如果需要让用户看到，得自己在里面写一个链接）。
- **`<q>`**：行内短引用，浏览器会自动加上引号（英文环境是 `"`，中文环境可能是 `「」`，取决于浏览器）。
- **`<cite>`**：**作品的标题**（书名、文章名、电影名），默认斜体。

<Callout type="warn" title="cite 的一个历史变化">

在 HTML4 里 `<cite>` 表示「引用本身」，HTML5 把它改为专指「作品的标题」。所以用 `<cite>` 包人名是错误的——那是 HTML4 的遗留用法，网上很多老教程还在这么教。人名应该直接写文本，或用 `<span class="author">`。

</Callout>

## 时间与日期：time

```html
<p>本文发布于 <time datetime="2026-10-16">2026 年 10 月 16 日</time>。</p>

<p>会议时间：<time datetime="2026-10-20T14:30">10 月 20 日下午 2 点半</time></p>

<p>这篇文章写了 <time datetime="PT2H30M">两个半小时</time>。</p>
```

`<time>` 的价值在于：`datetime` 属性提供**机器可读**的标准格式，而标签内的文本可以是任何人类友好的写法。这让浏览器可以提供「添加到日历」、搜索引擎能理解时间线、脚本能直接读取。

`datetime` 的合法格式（遵循 ISO 8601 的子集）：

| 格式 | 含义 |
| --- | --- |
| `2026-10-16` | 日期 |
| `2026-10` | 年月 |
| `2026` | 年份 |
| `14:30` | 时间 |
| `2026-10-20T14:30` | 日期 + 时间 |
| `2026-10-20T14:30:00+08:00` | 带时区偏移 |
| `2026-10-20T06:30:00Z` | UTC 时间 |
| `PT2H30M` | 时长（2 小时 30 分） |
| `P3D` | 时长（3 天） |

时长的格式容易写错：前缀必须是 `P`（period），时间部分前还要加 `T`。`2H30M` 是非法的，必须写 `PT2H30M`。

## 代码与技术文本：code、pre、kbd、samp、var

```html
<p>运行 <code>npm install</code> 安装依赖。</p>

<pre><code>const a = 1
const b = 2
console.log(a + b)</code></pre>

<p>按 <kbd>Ctrl</kbd> + <kbd>C</kbd> 复制。</p>

<p>控制台输出：<samp>Error: module not found</samp></p>

<p>函数 <code>add(<var>x</var>, <var>y</var>)</code> 返回两数之和。</p>
```

| 元素 | 用途 |
| --- | --- |
| `<code>` | 一段计算机代码 |
| `<pre>` | 预格式化文本，**保留空白与换行** |
| `<kbd>` | 用户需要输入的键盘按键 |
| `<samp>` | 程序的输出（sample） |
| `<var>` | 变量名 |

`<pre>` + `<code>` 的组合是代码块的标准写法：`<pre>` 负责保留格式，`<code>` 负责标记这是代码。这也是本站代码块的底层结构（语法高亮由构建工具注入 `<span class="...">`）。

**`<pre>` 里的空白是敏感的**。这带来一个常见的排版陷阱：

```html
<!-- 会在代码块开头产生一行空行和缩进 -->
<pre><code>
  const a = 1
</code></pre>

<!-- 正确写法：内容紧贴标签 -->
<pre><code>const a = 1</code></pre>
```

## 其他文本元素

### abbr：缩写

```html
<p><abbr title="Cascading Style Sheets">CSS</abbr> 的层叠机制……</p>
```

鼠标悬停会显示 `title` 里的全称。**但 `title` 在移动端完全无法访问**（没有悬停），所以如果全称很重要，应该在正文里也写出来一次：

```html
<p>层叠样式表（<abbr title="Cascading Style Sheets">CSS</abbr>）的层叠机制……</p>
```

### address：联系方式，不是地址

```html
<address>
  问题反馈：<a href="mailto:support@example.com">support@example.com</a>
</address>
```

**这是最容易被误解的元素。** `<address>` 表示的是「**最近的 `<article>` 或 `<body>` 的联系信息**」，不是「一个邮政地址」。如果你在文章里写「公司位于北京市海淀区……」，那是正文内容，**不应该**用 `<address>` 包裹。

### hr：主题分隔

```html
<h2>第一章</h2>
<p>……</p>
<hr>
<h2>第二章</h2>
```

表示段落级主题转换。不要用它当装饰性分隔线——那是 CSS 的工作（用 `border-bottom`）。

### br 与 wbr：换行的两种情况

```html
<!-- br：强制换行 -->
<p>第一行<br>第二行</p>

<!-- wbr：建议换行点，只在空间不够时才断 -->
<p>这个超长标识符 <code>getTheCurrentUserOfTheApplication</code><wbr>FromCache</code> 会溢出容器。</p>
```

`<br>` 是**强制**换行，`<wbr>`（word break opportunity）是**可选**换行点——只在容器宽度不够时才在那里断开，够宽时不产生任何效果。

<Callout type="danger" title="不要用 br 做布局">

`<br><br>` 制造段落间距、`<br>` 把两列内容对齐——这些都是错误用法。段落间距用 CSS 的 `margin`，多列布局用 Flexbox 或 Grid。用 `br` 排版的页面在不同屏幕宽度下会完全失控，且无法响应式。

</Callout>

## 常见错误与排查

### 症状：读屏软件把整页读成一坨，找不到重点

**排查**：检查标题层级是否连续。在 Chrome 里装一个标题结构查看扩展，或在 Console 执行：

```js
[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
  .map(h => `${h.tagName} ${h.textContent.trim()}`)
  .join('\n')
```

看输出是否严格递进、有没有跳级、有没有空标题。

### 症状：`<p>` 里的 `<div>` 跑到了外面

见本章「段落」一节。这是解析器的容错行为，不是 bug。改用 `<span>` 或把 `<p>` 换成 `<div>`。

### 症状：列表的项目符号消失后，读屏软件不再播报「列表」

**原因**：Safari 的一个已知行为——当 `<ul>` 或 `<ol>` 的 `list-style-type` 被设为 `none` 时，Safari 会移除其列表语义（`role="list"`）。

**解决**：

```css
ul { list-style: none; }
```
```html
<ul role="list">
  <li>...</li>
</ul>
```

这是少数需要显式写 ARIA `role` 来**恢复**原生语义的情况。详见[无障碍章节](/html/accessibility)。

### 症状：`<pre>` 代码块第一行是空行

**原因**：`<pre>` 保留所有空白，包括标签后的换行。把内容紧贴标签写。

## 练习

<Exercise title="练习 1 · 选择正确的语义元素" difficulty="基础">

把下面这段「语义全靠 div 和 class」的代码改写成语义化 HTML。不要改变视觉意图（视觉意图由 CSS 实现，这里只关心结构）：

```html
<div class="article">
  <div class="title">理解 CSS 层叠</div>
  <div class="subtitle">发布于 2026 年 10 月 16 日</div>
  <div class="content">
    <div class="para">层叠（cascade）是 CSS 的核心机制。</div>
    <div class="para">它的三个决定因素是：<span class="bold">来源与重要性</span>、<span class="bold">特异性</span>、<span class="bold">顺序</span>。</div>
    <div class="para">详细定义见 <span class="italic">CSS Cascading and Inheritance Level 4</span>。</div>
    <div class="para">运行 <span class="mono">npm run dev</span> 可以看到效果。</div>
  </div>
  <div class="footer">
    <div class="contact">联系作者：author@example.com</div>
  </div>
</div>
```

<template #answer>

```html
<article>
  <hgroup>
    <h1>理解 CSS 层叠</h1>
    <p>发布于 <time datetime="2026-10-16">2026 年 10 月 16 日</time></p>
  </hgroup>

  <p>层叠（cascade）是 CSS 的核心机制。</p>

  <p>它的三个决定因素是：<strong>来源与重要性</strong>、<strong>特异性</strong>、<strong>顺序</strong>。</p>

  <p>详细定义见 <cite>CSS Cascading and Inheritance Level 4</cite>。</p>

  <p>运行 <code>npm run dev</code> 可以看到效果。</p>

  <footer>
    <address>联系作者：<a href="mailto:author@example.com">author@example.com</a></address>
  </footer>
</article>
```

**每处改动的理由**：

- `.article` → `<article>`：这是一篇独立的、可被单独引用的内容，正是 `<article>` 的定义。
- `.title` → `<h1>`：文章标题。
- `.subtitle` → 放进 `<hgroup>` 里的 `<p>`：这样副标题不会进入文档大纲。日期用 `<time datetime>` 提供机器可读格式。
- `.content` 这层 div **直接删掉**：它没有任何语义，`<article>` 已经是容器了。`.para` → `<p>`。
- `.bold` → `<strong>`：这三个因素是本文的关键信息，属于「重要性」而非仅仅「吸引注意」。如果只是为了视觉上的强调而非重要性，应当用 `<b>` 或直接 CSS。
- `.italic` → `<cite>`：这是一个规范文档的**标题**，正是 `<cite>` 的用途。注意不要写成 `<i>`——虽然视觉一样，但语义不同。
- `.mono` → `<code>`：这是一条要执行的命令。
- `.footer` → `<footer>`：`<article>` 的页脚。
- `.contact` → `<address>`：这是该 article 的联系信息，完全符合 `<address>` 的定义（注意 `<address>` 是「联系信息」而非「邮政地址」）。邮箱应当是可点击的 `mailto:` 链接。

</template>

</Exercise>

<Exercise title="练习 2 · 判断 ul / ol / dl" difficulty="基础">

以下四组内容，分别应该用 `ul`、`ol` 还是 `dl`？说明理由。

1. 网站的顶部导航菜单（首页 / 文档 / 博客 / 关于）
2. 部署一个项目的步骤（安装依赖 → 构建 → 上传 → 重启服务）
3. 一份 API 文档里的参数说明（`name`：用户名，必填；`age`：年龄，可选）
4. 页脚的一列友情链接

<template #answer>

**1. 导航菜单 → `ul`**

理由：菜单项之间没有必然的先后顺序（把「关于」放第一个不会改变含义）。虽然视觉上导航通常是横向排列且没有项目符号，但语义上它是一组条目，用 `<ul>` 能让读屏软件播报「列表，4 项」，用户能立刻知道有多少个入口。

```html
<nav aria-label="主导航">
  <ul>
    <li><a href="/">首页</a></li>
    <li><a href="/docs/">文档</a></li>
    <li><a href="/blog/">博客</a></li>
    <li><a href="/about/">关于</a></li>
  </ul>
</nav>
```

**2. 部署步骤 → `ol`**

理由：顺序有实际意义。跳过「构建」直接「上传」会失败，把「重启服务」放在最前面没有意义。判断标准就是「打乱顺序含义会不会变」——会变，所以用 `ol`。

**3. API 参数说明 → `dl`**

理由：这是典型的「术语 + 解释」结构，每个参数名是一个 `<dt>`，它的说明是对应的 `<dd>`。

```html
<dl>
  <dt><code>name</code></dt>
  <dd>用户名，必填，字符串。</dd>

  <dt><code>age</code></dt>
  <dd>年龄，可选，正整数。</dd>
</dl>
```

注意：如果参数说明包含多个列（名称、类型、是否必填、默认值、说明），那它其实是**表格数据**，应该用 `<table>` 而不是 `<dl>`。区分标准是——`<dl>` 适合「一个术语配一到几句解释」，`<table>` 适合「每条记录有相同的多个字段」。

**4. 页脚友情链接 → `ul`**

理由：与导航同理，是一组无序的条目。

</template>

</Exercise>

<Exercise title="练习 3 · em/i 与 strong/b 的辨析" difficulty="进阶">

为下面每个句子选择正确的元素，并解释为什么另一个不合适：

1. 「你**必须**先关闭文件再删除它。」（表达：不做会出错）
2. 「这个错误在文档里被称为 **ENOTFOUND**。」（表达：这是一个专有名词）
3. 「本文重点讨论 **Vue** 与 **React** 的差异。」（表达：这两个词是关键词，需要显眼）
4. 「我心想，*这下完了*。」（表达：内心活动）

<template #answer>

**1. 用 `<strong>`**

```html
<p>你<strong>必须</strong>先关闭文件再删除它。</p>
```

这里是**重要性**——不这样做会导致错误，是关键信息。不是语气强调，而是「这条内容很重要」。

如果用 `<em>`，读屏软件会用加重的语气朗读，但语义上传达的是「我在强调这个词的语气」，而不是「这是关键警告」。差别在读屏体验上：`<strong>` 会让部分读屏软件提示「重要」。

**2. 用 `<code>`（不是 `<i>` 也不是 `<b>`）**

```html
<p>这个错误在文档里被称为 <code>ENOTFOUND</code>。</p>
```

`ENOTFOUND` 是一个错误码标识符，属于代码范畴，`<code>` 最准确。如果坚持要在 `<i>` 和 `<b>` 之间选，应当选 `<i>`——因为 `<i>` 的语义之一是「技术术语」。但既然有 `<code>`，就不该退而求其次。

**3. 用 `<b>`**

```html
<p>本文重点讨论 <b>Vue</b> 与 <b>React</b> 的差异。</p>
```

这两个词需要吸引注意，但它们并不比句子里的其他信息更重要——去掉加粗，读者也不会错过关键警告。这正是 `<b>` 的定义：「吸引注意力，但不表示额外的重要性」。

用 `<strong>` 会过度标注：如果一篇文章里到处是 `<strong>`，读屏软件用户会被反复打断，重要信息的信号就被稀释了。**`<strong>` 应该很稀少。**

（更工程化的做法是：这种视觉需求直接用 CSS，比如给关键词包一个 `<span class="keyword">`。语义上它确实只是样式需求。）

**4. 用 `<i>`**

```html
<p>我心想，<i>这下完了</i>。</p>
```

这是 `<i>` 最标准的用例之一——HTML 标准明确列出 `<i>` 适用于「另一种语气或语态的文本」，例子包括技术术语、外文短语、**思想活动**、分类名。

用 `<em>` 是错的：这里不是在强调「这下完了」这几个字的语气重心，而是标记「这段文字的性质是内心独白，区别于叙述正文」。

**总结这四题的判断框架**：

| 你想表达的是 | 用 |
| --- | --- |
| 这条信息很关键，错过会出问题 | `strong` |
| 这个词需要显眼，但重要性一般 | `b` 或 CSS |
| 我在改变这句话的语气重心 | `em` |
| 这段文字的性质不同（术语/外文/内心活动/分类） | `i` |
| 这是代码或标识符 | `code` |

</template>

</Exercise>

## 官方文档与延伸阅读

- [WHATWG HTML 标准 · 文本级语义](https://html.spec.whatwg.org/multipage/text-level-semantics.html) —— `a`、`em`、`strong`、`small`、`s`、`cite`、`q`、`code`、`var`、`samp`、`kbd`、`sub`/`sup`、`i`、`b`、`u`、`mark`、`time`、`br`、`wbr` 的规范定义。想搞清楚「两个看起来一样的元素到底区别在哪」，这里是唯一权威答案。
- [WHATWG HTML 标准 · 分组内容](https://html.spec.whatwg.org/multipage/grouping-content.html) —— `p`、`hr`、`pre`、`blockquote`、`ol`、`ul`、`li`、`dl`、`dt`、`dd` 的规范定义，包括各自的内容模型（能嵌套什么）。
- [WHATWG HTML 标准 · 章节](https://html.spec.whatwg.org/multipage/sections.html) —— `h1`–`h6`、`hgroup`、`header`、`footer`、`address`，以及现行的文档大纲定义。本章「h1 数量」一节的依据。
- [MDN · HTML 元素参考](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements) —— 按元素查用法和浏览器兼容性。
- [MDN · `<time>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/time) —— `datetime` 所有合法格式的完整列表。
- [MDN · `<address>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/address) —— 注意页面上明确说明了「不用于邮政地址」以及不应用于哪些场景。
- [MDN · HTML 元素的内容分类](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Content_categories) —— 什么是「短语内容」「流内容」「分区内容」，理解 `<p>` 为什么不能装 `<div>` 的关键。

## 下一章

结构有了，接下来把内容连起来：[链接与导航](/html/links)。
