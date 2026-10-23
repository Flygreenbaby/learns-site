# 语义化布局与文档大纲

前面几章讲的是「一小块内容怎么写对」。这一章讲的是「整个页面怎么组织」。

页面布局这件事，在 2010 年前后经历了一次彻底的变化：从 `<table>` 布局，到 `<div>` + CSS 浮动，再到 Flexbox / Grid，最后到今天——**布局交给 CSS，结构交给语义标签**。很多人卡在第三步：会用 Flexbox 排版了，但整个页面还是十几个 `<div class="header">`、`<div class="nav">`、`<div class="main">`。

这在视觉上没有任何问题。问题在于：

- **屏幕阅读器用户无法用「地标跳转」导航**。他们可以按 `banner` / `main` / `navigation` / `complementary` / `contentinfo` 这些 landmark 在页面区块间快速跳转（NVDA 里是 `D` 键循环 landmark，VoiceOver 里用转子）。`<div class="header">` 不产生 landmark，用户只能一行一行往下读。
- **浏览器的阅读模式（Reader Mode）无法提取正文**。Safari、Firefox、Edge 的阅读模式靠语义标签判断哪块是正文，`<article>` 是最强的信号。全是 `<div>` 的页面，阅读模式要么不触发，要么提取出一堆导航和广告。
- **搜索引擎的正文识别变差**。这一点后面会诚实说明边界。
- **半年后你自己看不懂代码**。`<div class="box2">` 和 `<aside aria-label="相关章节">` 的信息量差了一个数量级。

---

## 一、七个布局元素

| 元素 | 表示什么 | 隐式 ARIA 角色 |
| --- | --- | --- |
| `<header>` | 一组介绍性内容或导航辅助 | 见第二章（**取决于位置**） |
| `<nav>` | 导航链接的主要区块 | `navigation` |
| `<main>` | 文档的主体内容 | `main` |
| `<article>` | 独立、自包含、可单独分发的内容 | `article` |
| `<section>` | 文档中的一个主题性分区 | `region`（**仅当有可访问名称时**），否则 `generic` |
| `<aside>` | 与周围内容间接相关的补充内容 | 见第二章（**取决于位置**） |
| `<footer>` | 所在区块的收尾内容 | 见第二章（**取决于位置**） |

上表第 3 列不是我从 MDN 抄的概括，而是 **HTML-AAM 1.0** 规范里「HTML 元素到 ARIA 角色的映射表」的原文。这张映射表是理解本章的关键，因为**同一个标签在不同位置会映射到不同角色**。

---

## 二、最容易搞错的一件事：`header` / `footer` / `aside` 的角色取决于位置

这是本章最重要、也是被误解最多的一点。

先看规范原文（HTML-AAM 1.0 的映射表，逐条）：

| HTML 写法 | 映射到的 ARIA 角色 |
| --- | --- |
| `header`（**scoped to the body element**，即不在任何分节内容内） | `banner` |
| `header`（scoped to the `main` 元素，或某个分节内容元素内） | `sectionheader` |
| `footer`（scoped to the body element） | `contentinfo` |
| `footer`（scoped to the `main` 元素，或某个分节内容元素内） | `sectionfooter` |
| `aside`（scoped to the body 或 main 元素） | `complementary` |
| `aside`（scoped to a sectioning content element） | **有可访问名称时**是 `complementary`，**否则**是 `generic` |
| `section` | **有可访问名称时**是 `region`，**否则**是 `generic` |

「分节内容元素」（sectioning content）指 `<article>`、`<aside>`、`<nav>`、`<section>` 这四个。

### 2.1 这意味着什么

```html
<body>
  <header>站点标题 + 主导航</header>   <!-- ← banner landmark -->
  <main>
    <article>
      <header>文章标题 + 作者 + 日期</header>  <!-- ← sectionheader，不是 banner -->
      <p>正文……</p>
      <footer>文章标签 + 版权</footer>          <!-- ← sectionfooter，不是 contentinfo -->
    </article>
    <aside>相关推荐</aside>                     <!-- ← generic！因为在 article 之外的 sectioning 内？ -->
  </main>
  <footer>站点页脚</footer>                     <!-- ← contentinfo landmark -->
</body>
```

上面这段里：

- `<body>` 直接子元素的 `<header>` 是 **banner**（页头地标）；
- `<article>` 里的 `<header>` **不是** banner，它只是那篇文章的头部；
- 同理，`<article>` 里的 `<footer>` **不是** contentinfo；
- `<main>` 直接子元素的 `<aside>` 是 **complementary**（补充内容地标）。

<Callout type="warn" title="为什么这个区别很重要">

如果一个页面有多个 banner landmark，屏幕阅读器用户按 landmark 跳转时会得到一个毫无意义的列表——「页头、页头、页头、页头」，因为他每进一篇文章都会遇到一个 `<header>`。

 landmark 的价值在于**唯一且可辨识**。banner 应该只有一个（页面顶部的那个），contentinfo 应该只有一个（页面底部的那个），main 只能有一个。

所以：**能嵌套用 `<header>`/`<footer>` 是好事**（让文章内部结构清晰），但要理解嵌套的那个不是地标。

</Callout>

### 2.2 `<section>` 和 `<aside>` 不命名就等于白写

映射表里那两行「有可访问名称时是 region/complementary，否则是 generic」，实践中被大量忽略。

```html
<!-- 这个 section 对屏幕阅读器来说就是一个普通 div -->
<section>
  <h2>安装步骤</h2>
  <p>...</p>
</section>

<!-- 这个 section 才是 region landmark，可以被跳转 -->
<section aria-labelledby="install-heading">
  <h2 id="install-heading">安装步骤</h2>
  <p>...</p>
</section>
```

<Callout type="info" title="有 h2 子元素不等于有可访问名称">

「可访问名称」（accessible name）是一个有明确定义的概念，来自 ARIA 的可访问名称计算规则。子元素里有个 `<h2>` **不会**自动让父 `<section>` 获得可访问名称——你必须用 `aria-labelledby` 指向那个标题，或者用 `aria-label` 直接给一个名字。

这是很多人对 `<section>` 的核心误解：以为写了 `<section>` + `<h2>` 就有了语义地标。实际上，没有 `aria-labelledby`，它在无障碍树里的角色就是 `generic`，和 `<div>` 完全一样。

</Callout>

用 `aria-labelledby` 而不是 `aria-label` 的理由：**避免文字重复**。标题文字改了一处，另一处忘改，就会出现「地标名叫『安装步骤』但标题写着『部署步骤』」的不一致。`aria-labelledby` 引用同一个元素，天然同步。

### 2.3 `sectionheader` / `sectionfooter` 是较新的角色

`sectionheader` 和 `sectionfooter` 出现在 ARIA 1.3 中。在更早的映射里，嵌套的 `<header>`/`<footer>` 被映射为「无对应角色」或 `generic`。

**本站未在真实屏幕阅读器中逐项验证各浏览器/AT 组合对这两个新角色的支持情况。** 实践上的安全结论是：**别依赖它们**。你写嵌套 `<header>` 的目的是让代码结构清晰、让 CSS 选择器好写，而不是为了让屏幕阅读器宣告「章节页头」。真正需要用户跳转的地标是 banner / main / navigation / complementary / contentinfo / region 这几个。

---

## 三、`<main>`：页面的主体

`<main>` 的规则最少但最严格，全部来自 HTML 规范原文：

**规则 1：一个文档中，不带 `hidden` 属性的 `<main>` 只能有一个。**

> A document must not have more than one main element that does not have the hidden attribute specified.

注意后半句：可以有多个 `<main>`，但**除一个以外全部必须带 `hidden`**。这个例外是为单页应用（SPA）设计的——比如一个页面里有多套主内容区，通过 JS 切换显示，未显示的那些标 `hidden`。对于普通多页面站点，就写一个 `<main>`。

**规则 2：`<main>` 的祖先元素受限。**

> A hierarchically correct main element is one whose ancestor elements are limited to `html`, `body`, `div`, `form` without an accessible name, and autonomous custom elements.

翻译成人话：`<main>` **不能**放在 `<article>`、`<aside>`、`<header>`、`<footer>`、`<nav>`、`<section>` 里面，也不能放在一个有可访问名称的 `<form>` 里面。允许的祖先只有 `html`、`body`、`div`、无名 `form`、自定义元素。

这条规则经常被违反。典型的错误结构：

```html
<!-- 错误：main 在 section 里 -->
<body>
  <section class="wrapper">
    <main>...</main>
  </section>
</body>

<!-- 正确 -->
<body>
  <main class="wrapper">...</main>
</body>
```

`<div>` 是被允许的，所以下面这样合法（虽然没什么必要）：

```html
<body>
  <div id="app">
    <main>...</main>
  </div>
</body>
```

**规则 3：`<main>` 里不放「跨页面共享的内容」。**

规范说 `<main>` 表示「文档的主体内容」（the dominant contents of the document）。站点导航、侧栏、页脚、Logo、搜索框、版权信息——这些在多个页面重复出现的东西，**不属于** `<main>`。

```html
<body>
  <a href="#main-content" class="skip-link">跳到主要内容</a>

  <header>
    <a href="/">站点名</a>
    <nav aria-label="主导航">...</nav>
  </header>

  <main id="main-content">
    <h1>这一页独有的标题</h1>
    <p>这一页独有的内容</p>
  </main>

  <footer>
    <p>© 2026</p>
  </footer>
</body>
```

**规则 4：给 `<main>` 加 `id`，用于跳转链接。** MDN 明确提到这一点：给 `<main>` 加 `id` 属性可以让它成为「跳到主要内容」链接的目标。

---

## 四、`<article>` vs `<section>` vs `<div>`

这三个元素的选择是日常写页面时最常见的犹豫。用两个问题就能定下来。

### 问题一：这块内容脱离本页还有意义吗？

这是 `<article>` 的判断标准。规范说 `<article>` 表示「一个自包含的 composition，可以被独立分发或复用」。实操化的测试：

> **如果把这块内容单独抓出来放进 RSS 订阅、发到社交平台、或者贴到另一个页面上，它还能独立读懂吗？**

| 内容 | 能独立分发吗 | 用什么 |
| --- | --- | --- |
| 一篇博客文章 | 能 | `<article>` |
| 一条论坛帖子 | 能 | `<article>` |
| 一条用户评论 | 能（带上「谁评论了什么」的上下文） | `<article>` |
| 一个商品卡片（含标题、图、价、按钮） | 能 | `<article>` |
| 一个新闻站点首页上的一篇报道摘要 | 能 | `<article>` |
| 「安装步骤」这一节 | 不能，离开上下文就没意义 | `<section>` |
| 「常见问题」这一节 | 不能 | `<section>` |
| 页面右侧的相关链接栏 | 不能 | `<aside>` |
| 纯粹为了套一层 CSS 的容器 | 无关语义 | `<div>` |

### 问题二：这块内容是一个有标题的主题分区吗？

是 → `<section>`（并配 `aria-labelledby` 指向它的标题）。
否，只是需要个盒子 → `<div>`。

HTML 规范在 `<section>` 的说明里明确建议：**每个 `<section>` 都应该有一个标题（heading）**。如果你写了一个 `<section>` 却想不出该给它什么标题，那它大概率应该是个 `<div>`。

### 嵌套：评论列表的经典模式

规范自己给的示例就是嵌套 `<article>`。一篇博客 + 其评论：

```html
<article>
  <header>
    <h1>理解 HTML 解析器</h1>
    <p>发布于 <time datetime="2026-09-12">2026 年 9 月 12 日</time></p>
  </header>

  <p>正文第一段……</p>

  <section aria-labelledby="comments-heading">
    <h2 id="comments-heading">评论（3）</h2>

    <article>
      <header>
        <h3>读者 A</h3>
        <p><time datetime="2026-09-13">2026 年 9 月 13 日</time></p>
      </header>
      <p>关于 foster parenting 那部分……</p>
    </article>

    <article>
      <header>
        <h3>读者 B</h3>
        <p><time datetime="2026-09-14">2026 年 9 月 14 日</time></p>
      </header>
      <p>请问 quirks mode 那节……</p>
    </article>
  </section>

  <footer>
    <p>标签：<a href="/tags/html">HTML</a></p>
  </footer>
</article>
```

要点：

- 每条评论是一个独立的、可分发的 composition → `<article>`；
- 评论**区**是一个主题分区 → `<section>`，带标题和 `aria-labelledby`；
- 标题层级严格递进：文章的 `h1` → 评论区的 `h2` → 每条评论的 `h3`。

### `<div>` 不是脏词

不要为了「显得语义化」而把所有 `<div>` 都换成 `<section>`。这是另一个常见错误——**滥用 `<section>` 会污染地标列表**，屏幕阅读器用户的 landmark 跳转列表里塞满了没有意义的 region。

`<div>` 的正确用途：

- 只为 CSS 布局服务的容器（`.wrapper`、`.grid`、`.card-body`）；
- 只为 JS 挂载服务的容器（`<div id="app">`）；
- 一组内容的非语义包装（比如一个 flex 行里的几个元素）。

判断标准：**如果把这个元素换成 `<div>`，页面的语义会不会有损失？** 会 → 用语义标签；不会 → 就用 `<div>`，别绕弯。

---

## 五、`<nav>`：不是所有链接组都是导航

规范说 `<nav>` 表示「一个链接到当前文档内其他部分、或到其他文档的**主要**导航区块」。关键词是「主要」（major）。

**该用 `<nav>` 的：**

- 站点主导航
- 页面内目录（TOC）
- 上一页 / 下一页
- 面包屑
- 站点页脚里的分组链接

**不该用 `<nav>` 的：**

- 正文里顺带提到的几个链接
- 文章末尾的「相关阅读」（那是 `<aside>` 或 `<section>` 里的 `<ul>`）
- 一个孤零零的链接

一个页面可以有多个 `<nav>`，但**必须用 `aria-label` 或 `aria-labelledby` 区分它们**，否则屏幕阅读器用户看到的地标列表是「导航、导航、导航、导航」。

```html
<header>
  <nav aria-label="主导航">
    <ul>
      <li><a href="/guide/roadmap.html">学习路线</a></li>
      <li><a href="/html/">HTML</a></li>
    </ul>
  </nav>
</header>

<main id="main-content">
  <h1>HTML 是什么</h1>

  <nav aria-label="本页目录">
    <h2 id="toc">本页目录</h2>
    <ol aria-labelledby="toc">
      <li><a href="#what">定义</a></li>
      <li><a href="#pipeline">解析流程</a></li>
    </ol>
  </nav>
</main>

<footer>
  <nav aria-label="页脚导航">
    <ul>
      <li><a href="/about.html">关于</a></li>
    </ul>
  </nav>
</footer>
```

<Callout type="info" title="nav 里应该用列表吗">

规范不强制，但**强烈推荐**用 `<ul>`（第 3 章讲过原因：屏幕阅读器会宣告「列表，5 项」，用户能知道导航有多少项）。

一个已知的坑：如果用 CSS `list-style: none` 去掉项目符号，**Safari + VoiceOver 会不再把它当作列表**（这是 Safari 的一个刻意行为，理由是「你去掉了列表的视觉标记，可能就不想让它被当作列表」）。补救方法是加 `role="list"`：

```css
nav ul { list-style: none; }
```

```html
<ul role="list">...</ul>
```

这个技巧在第 3 章讲 `<ul>` 时提过，这里再强调一次，因为导航是它最常出现的场景。

</Callout>

---

## 六、`<aside>`：补充内容，不是侧边栏

`<aside>` 的语义是「与**周围内容**间接相关的内容」。注意是「周围内容」，不是「页面」——这决定了它的含义随位置变化（第二章讲过）。

**适合 `<aside>` 的内容：**

- 侧边栏里的「相关章节」「推荐阅读」
- 拉出式引语（pull quote）
- 广告位
- 术语解释框、旁注
- 文章旁边的作者简介（如果它是文章的补充而非页面主体的一部分）

**不适合 `<aside>` 的内容：**

- 页面主导航（那是 `<nav>`）
- 文章正文里的小节（那是 `<section>`）
- 仅仅因为「在视觉上位于侧边」的内容 —— **位置不决定语义**

最后一点是最常见的误用。很多人看到设计稿右边有一栏，就无脑写 `<aside>`。但如果那一栏放的是「本章目录」，它其实是 `<nav aria-label="本章目录">`；如果放的是「本文的核心代码」，它是正文的一部分，应该在 `<main>` 里，只是用 CSS 把它排到右边。

```html
<!-- 错误：视觉在侧边就写 aside -->
<aside>
  <h2>本章目录</h2>
  <ul>...</ul>
</aside>

<!-- 正确：它本质是导航 -->
<nav aria-label="本章目录">
  <h2>本章目录</h2>
  <ul role="list">...</ul>
</nav>
```

用 CSS Grid 或 Flexbox 完全可以把它排到右边——**布局位置和语义标签是两个正交的维度**。

---

## 七、`<header>` 与 `<footer>` 的内容

### `<header>`

规范说 `<header>` 表示「其最近祖先分节内容的介绍性内容」。它可以包含：

- 标题（`<h1>`–`<h6>`，或 `<hgroup>`）
- Logo、站点名
- 导航（`<nav>` 可以放在 `<header>` 里）
- 搜索框
- 作者、日期等元信息

`<header>` **不包含**分节内容，也就是说你不能在 `<header>` 里放 `<section>` 或 `<article>`。而且 `<header>` 不能嵌套 `<header>`。

### `<footer>`

规范说 `<footer>` 表示「其最近祖先分节内容的收尾内容」。典型内容：

- 作者、版权信息
- 相关链接
- `<address>`（第 3 章讲过：**`<address>` 是联系方式，不是邮政地址**）

```html
<footer>
  <address>
    问题反馈：<a href="https://github.com/">项目 Issue 页</a>
  </address>
  <p><small>本站内容基于 2026 年 10 月核实的官方文档编写。</small></p>
</footer>
```

`<footer>` 同样不能包含分节内容，也不能嵌套 `<footer>`。

<Callout type="warn" title="footer 不必在视觉上位于底部">

`<footer>` 是语义标签，不是布局指令。`<article>` 里的 `<footer>`（文章标签、作者信息）通常紧跟在正文后面，视觉上并不在页面底部。不要因为它叫 footer 就用 CSS 把它推到屏幕底端。

</Callout>

---

## 八、文档大纲：一个必须纠正的误解

第 3 章（文本语义）讲标题时详细展开过，这里只做结论性回顾，因为它是布局章节绕不开的话题。

**旧的「隐式大纲算法」（HTML5 早期草案）说**：分节内容元素（`<article>`/`<aside>`/`<nav>`/`<section>`）会创建新的分节范围，因此在这些元素内部，标题层级会**自动降级**——你可以在每个 `<section>` 里都从 `<h1>` 开始写，浏览器会算出它是 h2、h3。

**现实是**：这个算法从未被任何浏览器或辅助技术实现，并已从现行标准中移除。

**现行标准的文档大纲就是「文档中所有标题按树序排列」**，分节内容元素**不产生任何隐含层级**。

所以规则很简单：**标题层级由你自己写对，不要指望 `<section>` 帮你降级。**

```html
<!-- 错误：以为 section 会自动降级 -->
<main>
  <h1>HTML 教程</h1>
  <section>
    <h1>第一章</h1>       <!-- 实际就是 h1，不是 h2 -->
    <section>
      <h1>1.1 节</h1>     <!-- 实际还是 h1 -->
    </section>
  </section>
</main>

<!-- 正确 -->
<main>
  <h1>HTML 教程</h1>
  <section aria-labelledby="ch1">
    <h2 id="ch1">第一章</h2>
    <section aria-labelledby="ch1-1">
      <h3 id="ch1-1">1.1 节</h3>
    </section>
  </section>
</main>
```

**自查方法**：F12 Console 执行

```js
[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
  .map(h => `${h.tagName} ${h.textContent.trim()}`)
  .join('\n')
```

打印出来看一眼层级是否严格递进、有没有跳级。

---

## 九、跳转链接（Skip Link）

这是**性价比最高的无障碍改进**，成本大约 10 行代码。

**问题**：一个页面的主导航有 20 个链接。键盘用户每次打开页面都要按 20 次 Tab 才能到达正文。屏幕阅读器用户可以用 landmark 跳转绕过，但**只用键盘、不用读屏软件**的人（运动障碍用户、习惯键盘操作的高级用户）没有这个能力。

**解决**：在 `<body>` 的最开头放一个指向 `#main-content` 的链接，视觉上默认隐藏，获得焦点时显示。

```html
<body>
  <a href="#main-content" class="skip-link">跳到主要内容</a>

  <header>...</header>
  <main id="main-content" tabindex="-1">...</main>
</body>
```

```css
.skip-link {
  position: absolute;
  top: 0;
  left: 0;
  transform: translateY(-100%);   /* 移出视口，但仍在 DOM 中可聚焦 */
  background: #3e63dd;
  color: #fff;
  padding: 8px 16px;
  z-index: 100;
}
.skip-link:focus {
  transform: translateY(0);        /* 获得焦点时滑入 */
}
```

三个必须注意的点：

**① 不要用 `display: none` 隐藏。** `display: none` 和 `visibility: hidden` 的元素**无法获得焦点**，链接就失效了。用「移出视口」的方式（`transform` 或 `clip-path` + 绝对定位）才能保持可聚焦。

**② `<main>` 上加 `tabindex="-1"`。** 点击跳转链接后，浏览器会把焦点移到 `#main-content`。但 `<main>` 默认不可聚焦，某些浏览器（历史上以 Safari 和旧版 IE 为甚）在这种情况下**只滚动页面、不移动焦点**，导致用户按 Tab 时又从页面顶部开始。`tabindex="-1"` 让元素可以被程序化聚焦但不出现在 Tab 序列中，正好解决这个问题。

**③ 链接文字要说明目的。** 写「跳到主要内容」而不是「点击这里」。屏幕阅读器用户会听到链接文字，「点击这里」毫无信息量。

本站当前使用的 VitePress 默认主题**已经内置了跳转链接**（英文界面下文字为 "Skip to content"，可通过主题配置改为中文）。你可以在浏览器里按 Tab 键，第一个焦点就是它。

---

## 十、完整页面骨架模板

把前面所有内容合起来，一个语义完整、无障碍合格的页面骨架：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HTML 是什么：文档、解析与容错 · 全栈学习手册</title>
  <meta name="description" content="从解析器视角理解 HTML：字节到字符、字符到 token、token 到 DOM 树，以及为什么浏览器不报错。" />
</head>
<body>
  <a href="#main-content" class="skip-link">跳到主要内容</a>

  <header>
    <p><a href="/">全栈学习手册</a></p>
    <nav aria-label="主导航">
      <ul role="list">
        <li><a href="/guide/roadmap.html">学习路线</a></li>
        <li><a href="/html/" aria-current="page">HTML</a></li>
        <li><a href="/css/">CSS</a></li>
        <li><a href="/typescript/">TypeScript</a></li>
      </ul>
    </nav>
  </header>

  <main id="main-content" tabindex="-1">
    <article aria-labelledby="article-title">
      <header>
        <h1 id="article-title">HTML 是什么：文档、解析与容错</h1>
        <p>
          更新于 <time datetime="2026-10-16">2026 年 10 月 16 日</time>
          · 阅读约 25 分钟
        </p>
      </header>

      <section aria-labelledby="s1">
        <h2 id="s1">一、HTML 是一种数据格式</h2>
        <p>……</p>
      </section>

      <section aria-labelledby="s2">
        <h2 id="s2">二、解析流程</h2>
        <p>……</p>

        <aside aria-label="术语补充">
          <h3>什么是 token</h3>
          <p>……</p>
        </aside>
      </section>

      <footer>
        <p>标签：<a href="/tags/html" rel="tag">HTML</a></p>
      </footer>
    </article>

    <nav aria-label="上一章 / 下一章">
      <ul role="list">
        <li><a href="/html/">← HTML 领域首页</a></li>
        <li><a href="/html/document-structure.html">文档骨架 →</a></li>
      </ul>
    </nav>
  </main>

  <footer>
    <address>
      发现问题？<a href="https://github.com/">在 Issue 中反馈</a>
    </address>
    <p><small>内容基于 2026 年 10 月核实的官方文档编写。</small></p>
  </footer>
</body>
</html>
```

这个骨架产生的 landmark 列表（屏幕阅读器用户可跳转的）：

| Landmark | 来源 | 数量 |
| --- | --- | --- |
| `banner` | `<body>` 下的 `<header>` | 1 |
| `navigation`「主导航」 | 第一个 `<nav aria-label>` | 1 |
| `main` | `<main>` | 1 |
| `article` | `<article>` | 1 |
| `region`「一、HTML 是一种数据格式」 | 有 `aria-labelledby` 的 `<section>` | 2 |
| `complementary`「术语补充」 | `<main>` 内有 `aria-label` 的 `<aside>` | 1 |
| `navigation`「上一章 / 下一章」 | 第二个 `<nav aria-label>` | 1 |
| `contentinfo` | `<body>` 下的 `<footer>` | 1 |

注意：`<article>` 里的 `<header>` 和 `<footer>` **不在**这个列表里——它们不是 banner 和 contentinfo（第二章）。

### 10.1 `aria-current="page"`

上面主导航里用了 `aria-current="page"`。它告诉辅助技术「这个链接指向当前页面」。屏幕阅读器会读成「HTML，当前页面」。

对于面包屑，用法是 `aria-current="page"` 标在最后一项。对于分页控件，用 `aria-current="page"` 标在当前页码上。

不要试图用 `class="active"` + 视觉高亮来代替——CSS 类名对辅助技术是不可见的。

---

## 十一、语义标签与 SEO：诚实的边界

这是需要说清楚边界的地方，因为网上流传的说法差异很大。

**能确定的：**

- 搜索引擎的爬虫确实解析 HTML 并构建 DOM，语义标签是它能拿到的结构信息的一部分；
- Google 有专门处理结构化数据的机制（Schema.org / JSON-LD），那套东西**与本章讲的语义标签是两回事**——JSON-LD 是显式声明「这是一个 Recipe，烹饪时间 30 分钟」，语义标签只是 HTML 结构；
- 阅读模式、RSS 生成器、内容抓取工具严重依赖 `<article>` 和标题层级，这是可观察的事实。

**不能确定的：**

<Callout type="unverified" title="语义标签对搜索排名的影响，本站不做断言">

「用了 `<article>` 排名就会上升」这类说法，本站**没有找到可核实的官方依据**。Google 的排名算法不公开，其官方文档也只说明「我们会解析 HTML 结构以理解页面」，不会说「section 标签加多少分」。

Google 的搜索文档站点（developers.google.com/search）在本站的核实环境中**网络不可达**，因此无法引用原文。

务实的结论：语义标签的**主要收益是无障碍和可维护性**，这两点是确定的、可验证的。SEO 收益当作附带效果，不要当作选择理由，更不要相信任何声称能精确量化的说法。

</Callout>

---

## 十二、常见错误与排查

**症状 1：屏幕阅读器的 landmark 列表里有 4 个「导航」，分不清。**
原因：页面有多个 `<nav>` 但都没命名。解决：每个 `<nav>` 加 `aria-label` 或 `aria-labelledby`。

**症状 2：landmark 列表里有 6 个「banner」。**
原因：在每篇 `<article>` 里都写了 `<header>`，但你用的浏览器/AT 组合把它们都映射成了 banner（旧版映射规则下的行为）。解决：确认 `<header>` 确实是嵌套在 `<article>`/`<section>` 内而不是 `<body>` 直接子元素；如果 AT 仍然宣告多个 banner，可以给嵌套的 `<header>` 加 `role="presentation"` 或干脆换成 `<div class="article-header">`（这是妥协方案，优先修结构）。

**症状 3：写了 `<section>` 和 `<h2>`，但屏幕阅读器的 region 列表里没有它。**
原因：`<section>` 没有可访问名称，映射为 `generic`。解决：加 `aria-labelledby="标题id"`。

**症状 4：`<main>` 在 W3C 校验器里报错。**
原因：`<main>` 的祖先元素不合法（在 `<section>`/`<article>`/`<nav>` 等里面），或者页面上有多个不带 `hidden` 的 `<main>`。解决：见第三章的规则 1 和规则 2。

**症状 5：跳转链接看不见，按 Tab 也没反应。**
原因：用了 `display: none` 或 `visibility: hidden` 隐藏它。解决：改用「移出视口」的隐藏方式（`transform: translateY(-100%)` 或 `clip-path: inset(50%)` + 绝对定位）。

**症状 6：点了跳转链接，页面滚过去了，但按 Tab 又从页面第一个链接开始。**
原因：焦点没有真正移到 `<main>`。解决：给 `<main>` 加 `tabindex="-1"`。

**症状 7：`<aside>` 里的侧边栏，屏幕阅读器完全没有宣告。**
原因：`<aside>` 嵌套在某个分节内容元素内，且没有可访问名称 → 映射为 `generic`。解决：加 `aria-label`，或者确认它应该在 `<main>` 的直接层级下。

**症状 8：整页 `<div class="xxx">`，阅读模式提取不出正文。**
原因：没有 `<article>` 或 `<main>`。解决：正文包一层 `<article>`（如果可独立分发）或至少 `<main>`。

---

## 十三、练习

<Exercise title="练习 1：把 div 汤改成语义化结构" difficulty="基础">

下面是一个博客文章页的骨架，全部用 `<div>` 实现。请改写成语义化结构，并对每处改动说明理由。

```html
<div class="page">
  <div class="top">
    <div class="logo">我的博客</div>
    <div class="menu">
      <a href="/">首页</a> | <a href="/archive">归档</a> | <a href="/about">关于</a>
    </div>
  </div>

  <div class="content">
    <div class="post">
      <div class="post-head">
        <div class="title">理解 CSS 层叠</div>
        <div class="meta">2026-10-01 · 阅读 12 分钟</div>
      </div>
      <div class="body">
        <div class="part">
          <div class="h">一、层叠的三个来源</div>
          <p>……</p>
        </div>
        <div class="part">
          <div class="h">二、优先级计算</div>
          <p>……</p>
        </div>
      </div>
      <div class="post-foot">标签：CSS</div>
    </div>

    <div class="sidebar">
      <div class="h">相关文章</div>
      <a href="/p/1">文章一</a>
      <a href="/p/2">文章二</a>
    </div>
  </div>

  <div class="bottom">© 2026 我的博客</div>
</div>
```

<template #answer>

```html
<body>
  <a href="#main-content" class="skip-link">跳到主要内容</a>

  <header>
    <p><a href="/">我的博客</a></p>
    <nav aria-label="主导航">
      <ul role="list">
        <li><a href="/" aria-current="page">首页</a></li>
        <li><a href="/archive">归档</a></li>
        <li><a href="/about">关于</a></li>
      </ul>
    </nav>
  </header>

  <div class="layout">
    <main id="main-content" tabindex="-1">
      <article aria-labelledby="post-title">
        <header>
          <h1 id="post-title">理解 CSS 层叠</h1>
          <p>
            <time datetime="2026-10-01">2026 年 10 月 1 日</time>
            · 阅读 12 分钟
          </p>
        </header>

        <section aria-labelledby="s1">
          <h2 id="s1">一、层叠的三个来源</h2>
          <p>……</p>
        </section>

        <section aria-labelledby="s2">
          <h2 id="s2">二、优先级计算</h2>
          <p>……</p>
        </section>

        <footer>
          <p>标签：<a href="/tags/css" rel="tag">CSS</a></p>
        </footer>
      </article>
    </main>

    <aside aria-label="相关文章">
      <h2>相关文章</h2>
      <ul role="list">
        <li><a href="/p/1">文章一</a></li>
        <li><a href="/p/2">文章二</a></li>
      </ul>
    </aside>
  </div>

  <footer>
    <p><small>© 2026 我的博客</small></p>
  </footer>
</body>
```

CSS 负责把 `.layout` 排成两栏（`display: grid; grid-template-columns: 1fr 280px;`）。

逐处说明：

**① `.top` → `<header>`。** 它在 `<body>` 直接层级下，映射为 `banner` landmark。用户可以一键跳到页头。

**② `.logo` 里的文字 → `<a href="/">`。** 站点名应该是可点击回首页的链接，这是通用约定。外面包 `<p>` 而不是 `<div>`，因为它是短语内容；也可以直接不包，`<a>` 作为 `<header>` 的子元素是合法的。

**③ `.menu` → `<nav aria-label="主导航">` + `<ul>`。** 三个改动：加 `<nav>` 产生 navigation landmark；加 `aria-label` 让它在多导航页面里可辨识；把「`|` 分隔的裸链接」改成列表——第 3 章讲过，屏幕阅读器会宣告「列表，3 项」，用户立刻知道导航规模。分隔符 `|` 是纯视觉的，应该用 CSS 的 `::after` 或 gap 实现，不该进 HTML。

**④ 首页链接加 `aria-current="page"`。** 告诉辅助技术当前在首页。

**⑤ `.content` → `<div class="layout">`。** 这个容器**保留 `<div>`**。它只是为了 CSS 两栏布局，没有任何语义，换成 `<section>` 反而是错的（会污染地标列表）。这是「`<div>` 不是脏词」的直接体现。

**⑥ 新增 `<main id="main-content" tabindex="-1">`。** 原代码完全没有主体区域标记。这是最严重的缺失——没有 `<main>`，屏幕阅读器用户无法跳过导航直达正文，跳转链接也无从建立。

**⑦ `.post` → `<article aria-labelledby="post-title">`。** 一篇博客文章是典型的「可独立分发的自包含内容」，通过第四章的 RSS 测试。加 `aria-labelledby` 让它有可访问名称（`article` 角色本身不需要名称，但有名称时屏幕阅读器能读出「理解 CSS 层叠，文章」而不是「文章」）。

**⑧ `.post-head` → `<header>`。** 它在 `<article>` 内部，所以映射为 `sectionheader` 而**不是** banner（第二章）。这正是它该在的位置。

**⑨ `.title` → `<h1>`，`.h` → `<h2>`。** 原代码所有标题都是 `<div>`，文档大纲完全丢失。改成 `h1` → `h2` 严格递进（第八章）。

**⑩ `.meta` 里的日期 → `<time datetime="2026-10-01">`。** 第 3 章讲过：`<time>` 给机器可读的日期格式，视觉文字可以是任意人类友好形式。原代码的 `2026-10-01` 只是一串文本，浏览器和爬虫都不知道它是日期。

**⑪ `.body` → 去掉。** 这一层没有语义，`<article>` 直接包含两个 `<section>` 即可。少一层嵌套，DOM 更浅，CSS 选择器更简单。

**⑫ `.part` → `<section aria-labelledby>`。** 每部分是一个有标题的主题分区，通过第四章的「有标题的主题分区」测试。加 `aria-labelledby` 才产生 region landmark（第二章 2.2）。

**⑬ `.post-foot` → `<footer>`。** 在 `<article>` 内，映射为 `sectionfooter`，不是 contentinfo。标签链接加 `rel="tag"`。

**⑭ `.sidebar` → `<aside aria-label="相关文章">`。** 它是文章的补充内容，不是主体。它在 `<main>` **之外**、`<body>` 层级下（scoped to body）→ 映射为 `complementary` landmark。**必须有 `aria-label`**：如果把它挪进 `<article>` 内部，没有名称就会退化成 `generic`（第二章映射表）。加 `aria-label` 让它在任何位置都安全。

侧栏里的链接同样改成 `<ul>`。

**⑮ `.bottom` → `<footer>`。** `<body>` 直接子元素 → contentinfo landmark。版权信息包 `<small>`（第 3 章：`<small>` 表示附属细则、法律声明这类内容）。

**⑯ 新增跳转链接。** 原代码没有，这是键盘用户的重大障碍（第九章）。

**⑰ `<div class="page">` 去掉了。** `<body>` 本身就是页面容器，再套一层没有意义。如果确实需要限制最大宽度，样式直接加在 `<body>` 上，或者用 `.layout` 那层。

改完后的 landmark 清单：banner ×1、navigation「主导航」×1、main ×1、article ×1、region ×2、complementary「相关文章」×1、contentinfo ×1。每一个都唯一或已命名，屏幕阅读器用户可以精确跳转。

</template>

</Exercise>

<Exercise title="练习 2：判断 article / section / aside / div" difficulty="进阶">

为一个「在线课程平台」的**课程详情页**选择元素。对每一项给出你的选择和判断依据（用第四章的两个问题）。

1. 页面顶部的站点 Logo + 全局导航条
2. 课程标题、封面图、讲师、「立即报名」按钮组成的区块
3. 课程介绍正文（含「课程大纲」「适合人群」「常见问题」三个小节）
4. 「课程大纲」这一小节
5. 页面右侧的「讲师其他课程」列表
6. 页面右侧的「本课目录」（点击可跳到正文对应小节）
7. 用户评价区，每条评价含头像、昵称、评分、内容、时间
8. 单条评价
9. 底部支付区的外层容器（为了让它和上面的内容并排显示）
10. 视频播放器下方的「笔记」输入区（用户可在此记笔记，仅本页可见）

<template #answer>

| # | 内容 | 选择 | 依据 |
| --- | --- | --- | --- |
| 1 | Logo + 全局导航 | `<header>` 内嵌 `<nav aria-label="主导航">` | `<body>` 直接子元素的 header → banner landmark。导航部分单独用 `<nav>`，因为它是「主要导航区块」 |
| 2 | 课程标题 + 封面 + 讲师 + 报名按钮 | `<header>`（在 `<main>` 或 `<article>` 内） | 这是该课程内容的「介绍性内容」，正好符合 `<header>` 的定义。不要写成 `<section>`——它不是一个独立主题分区，是主体的引子 |
| 3 | 课程介绍正文整体 | `<article>`（如果课程页可被独立分享/收录）或 `<main>` 直接包含 | 通过 RSS 测试：这个课程介绍单独抓出来放到别处仍能读懂 → `<article>` 合适。同时它必须在 `<main>` 内 |
| 4 | 「课程大纲」小节 | `<section aria-labelledby="syllabus">` + `<h2 id="syllabus">` | 有标题的主题分区，但脱离本页无意义 → 不是 `<article>`。加 `aria-labelledby` 才产生 region landmark |
| 5 | 讲师其他课程 | `<aside aria-label="讲师其他课程">` | 与课程主体**间接相关**的补充内容，符合 `<aside>` 定义。它视觉上在侧边，但决定用它的是语义而非位置。必须有 `aria-label`（第二章 2.2） |
| 6 | 本课目录 | `<nav aria-label="本课目录">` | **不是 `<aside>`**——它本质是导航（链接到文档内其他部分），规范里 `<nav>` 的定义明确包含页内目录。这是第六章点名的典型误用 |
| 7 | 用户评价区 | `<section aria-labelledby="reviews">` + `<h2>` | 是一个有标题的主题分区，包含多个独立条目。用 `<section>` 做容器，每条评价用 `<article>` |
| 8 | 单条评价 | `<article>` | 通过 RSS 测试：一条评论是独立的、可分发的 composition。规范自己给的嵌套示例就是「文章 + 评论」，见第四章 |
| 9 | 底部支付区外层容器 | `<div>` | **纯粹为了 CSS 并排布局**，无语义。换成 `<section>` 会污染地标列表。这是「`<div>` 不是脏词」的标准场景 |
| 10 | 笔记输入区 | `<section aria-labelledby="notes">` 或直接 `<div>` + `<form>` | 判断题：它是不是「补充内容」？不是——它是本页的核心交互之一。是不是主题分区？是（有「我的笔记」标题）→ `<section>`。里面放 `<form>`，表单本身按第 6 章的规范写 |

**几处需要展开的：**

**第 5 vs 第 6 是这道题的核心。** 两者在视觉上都在右侧栏，很多人会都写成 `<aside>`。但语义完全不同：

- 「讲师其他课程」= 与本课**间接相关**的补充信息 → `<aside>`
- 「本课目录」= 指向**本文档内其他部分**的链接集 → `<nav>`

判断方法：问「这块内容的作用是**补充说明**，还是**帮助导航**？」如果是后者，无论它在视觉上位于哪里，都是 `<nav>`。

**第 7 vs 第 8 的嵌套逻辑。** 评价**区**是分区（`<section>`），单条评价是独立 composition（`<article>`）。这和第四章博客 + 评论的例子结构完全一致：

```html
<section aria-labelledby="reviews">
  <h2 id="reviews">用户评价（128）</h2>

  <article aria-labelledby="r1">
    <h3 id="r1">王同学的评价</h3>
    <p>评分：<data value="5">★★★★★</data></p>
    <p>内容讲得很清楚，特别是层叠那章。</p>
    <footer><time datetime="2026-09-20">2026-09-20</time></footer>
  </article>
  <!-- 更多评价 -->
</section>
```

注意这里用了 `<data value="5">`——`<data>` 元素（第 3 章没细讲）用于把人类可读文本和机器可读值关联起来，和 `<time>` 是同一类机制。评分的视觉是星星，机器值是 `5`。

**第 2 为什么不单独包一层。** 有人会写：

```html
<section class="course-hero">
  <h1>课程标题</h1>
  ...
</section>
```

这在语义上是错的：`<section>` 表示「文档中的一个**主题性分区**」，而课程标题区不是分区，是主体的引子。用 `<header>` 才对。如果它需要 CSS 类名，直接 `<header class="course-hero">`——语义标签一样可以有 class。

**第 10 的边界情况。** 如果笔记区在页面右侧、且你认为它是「补充」，用 `<aside aria-label="我的笔记">` 也说得通。这里的关键不是哪个答案唯一正确，而是**你要能说出理由**。如果理由是「因为它在右边」，那就是错的；如果理由是「因为它是正文之外的辅助功能，不影响主要内容理解」，那 `<aside>` 成立。

</template>

</Exercise>

<Exercise title="练习 3：审计一个页面的 landmark 结构" difficulty="挑战">

用浏览器打开任意一个你常用的网站（新闻站、电商、文档站都可以），完成以下审计并写出结论：

1. 在 Console 里执行一段脚本，列出页面所有的 landmark（`banner` / `navigation` / `main` / `article` / `region` / `complementary` / `contentinfo`）及其可访问名称。
2. 判断：有几个 `banner`？有几个 `main`？有几个 `navigation`？多个 `navigation` 是否都有名称？
3. 按 Tab 键 10 次，记录前 10 个焦点落在哪里。有没有跳转链接？如果没有，你需要按多少次 Tab 才能到达正文？
4. 给出三条具体的改进建议，每条说明「改哪个元素、加什么属性、解决什么问题」。

<template #answer>

这道题没有标准答案，但有一套可复用的方法和判断标准。

**第 1 步的审计脚本：**

```js
// 列出页面上所有语义地标元素及其可访问名称
const selectors = {
  banner: 'body > header',
  navigation: 'nav',
  main: 'main',
  article: 'article',
  region: 'section[aria-label], section[aria-labelledby]',
  complementary: 'aside[aria-label], aside[aria-labelledby], body > aside, main > aside',
  contentinfo: 'body > footer'
}

const report = []
for (const [role, sel] of Object.entries(selectors)) {
  document.querySelectorAll(sel).forEach(el => {
    report.push({
      角色: role,
      名称: el.getAttribute('aria-label')
        || (el.getAttribute('aria-labelledby')
            ? document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim()
            : '(未命名)')
        || '(未命名)',
      标签: el.tagName.toLowerCase(),
      文本预览: el.textContent.trim().slice(0, 40)
    })
  })
}
console.table(report)
```

这个脚本是**近似**的：它按 CSS 选择器猜角色，而真实的角色计算要考虑嵌套（第二章的 scoping 规则）。比如 `body > header` 才可能是 banner，`article > header` 不是——脚本已经用 `body >` 处理了这一点，但 `aside` 的情况更复杂（取决于是否在 sectioning content 内且是否有名称）。要得到权威结果，应该用浏览器扩展（如 aXe、WAVE）或 Lighthouse 的无障碍审计。

<Callout type="unverified">

这段脚本依据标准 DOM API 编写，未在本站实际运行验证。`?.` 可选链和 `Object.entries` 在所有现代浏览器中受支持。

</Callout>

**第 2 步的判断标准：**

| 检查项 | 合格标准 | 不合格的典型表现 |
| --- | --- | --- |
| `banner` 数量 | 恰好 1 个 | 0 个（用 `<div class="header">`）或多个（嵌套 header 被误映射） |
| `main` 数量 | 恰好 1 个 | 0 个（最常见）、多个（SPA 切换时忘记 `hidden`） |
| `navigation` 命名 | 每个都有 `aria-label`/`aria-labelledby` | 报告里出现 3 行「navigation / (未命名)」 |
| `contentinfo` 数量 | 恰好 1 个 | 0 个（页脚是 `<div>`） |
| `region` 数量 | 少而精，每个都有意义 | 十几个（`<section>` 滥用）或 0 个 |

**关于 `region` 数量的判断需要格外小心。** 一个页面有 8 个 region 不一定是坏事（长文档页确实需要多个可跳转分区），但如果每个 region 的名字都是「(未命名)」，说明作者写了 `<section>` 却没加 `aria-labelledby`——这些 section 实际上根本没成为 region（它们是 generic），脚本能选中它们只是因为写了 `aria-label` 属性选择器。真正的问题是：**页面上有多少 `<section>` 是白写的？**

补充一条检查：

```js
// 有多少 <section> 没有可访问名称（即实际上是 generic）
const total = document.querySelectorAll('section').length
const named = document.querySelectorAll('section[aria-label], section[aria-labelledby]').length
console.log(`${named}/${total} 个 section 有可访问名称`)
```

**第 3 步的键盘审计：**

记录格式建议：

```
Tab 1  → 跳转链接「跳到主要内容」（好）/ Logo 链接（无跳转链接）
Tab 2  → 主导航第 1 项
...
Tab 15 → 终于到达正文第一个链接
```

关键数字是「**到达正文需要多少次 Tab**」。经验参考：

| 次数 | 评价 |
| --- | --- |
| 1 次（有跳转链接） | 优秀 |
| ≤5 次 | 可接受 |
| 6–15 次 | 差，需要跳转链接 |
| >15 次 | 严重问题，键盘用户实际上无法使用 |

电商和新闻站经常落在最后一档，因为它们的主导航是巨型 mega menu，几十个链接。

**第 4 步的建议模板：**

好的建议要包含三部分——**改什么、怎么改、解决什么**。示例：

> **建议 1**：`<div class="site-header">` 改为 `<header>`（保持在 `<body>` 直接子级）。
> **解决**：页面当前没有 banner landmark，屏幕阅读器用户无法用「跳到页头」快速回到导航，只能靠逐元素遍历。

> **建议 2**：给 3 个 `<nav>` 分别加 `aria-label="主导航"` / `"页内目录"` / `"页脚导航"`。
> **解决**：landmark 列表里出现 3 个无名的「导航」，用户无法区分，跳转功能实际失效。

> **建议 3**：在 `<body>` 开头加 `<a href="#main" class="skip-link">跳到主要内容</a>`，并给主体容器加 `<main id="main" tabindex="-1">`。
> **解决**：键盘用户到达正文需要按 23 次 Tab。这是本页最严重的可操作性问题（对应 WCAG 2.1 SC 2.1.1 Keyboard 和 2.4.1 Bypass Blocks）。

**做完这道练习后你会发现一件事**：绝大多数真实网站在 landmark 结构上是不合格的，包括很多知名的大站。这不是为了让你觉得「反正大家都做不好」，而是说明——**你把这个做对，就已经超过了行业平均水平**，而成本只是写对标签名和加几个 `aria-label`。

</template>

</Exercise>

---

## 十四、官方文档与延伸阅读

以下链接均已核实可访问（核实时间：2026 年 10 月）。

**规范**

- [HTML Standard — Sections](https://html.spec.whatwg.org/multipage/sections.html)：`body`、`article`、`section`、`nav`、`aside`、`header`、`footer`、`address`、`hgroup` 的定义，以及文档大纲的现行说明
- [HTML Standard — Grouping content / The main element](https://html.spec.whatwg.org/multipage/grouping-content.html)：`main` 的唯一性规则和「hierarchically correct main element」的祖先限制原文
- [HTML AAM 1.0（HTML 元素到 ARIA 角色的映射）](https://www.w3.org/TR/html-aam-1.0/)：**第二章那张映射表的权威来源**。搜「header (scoped to the body element)」「aside (scoped to a sectioning content element)」可以看到逐条规则
- [ARIA in HTML](https://www.w3.org/TR/html-aria/)：每个 HTML 元素允许写哪些 ARIA 属性、隐式角色是什么

**MDN（中文）**

- [`<main>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/main)
- [`<article>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/article)
- [`<section>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/section)
- [`<aside>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/aside)
- [`<header>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/header) · [`<footer>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/footer) · [`<nav>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/nav)
- [ARIA 角色参考（中文）](https://developer.mozilla.org/zh-CN/docs/Web/Accessibility/ARIA/Reference/Roles)

**MDN（英文，landmark 角色的详细说明）**

- [`banner` role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/banner_role)
- [`contentinfo` role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/contentinfo_role)
- [`complementary` role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/complementary_role)

**其他**

- [WebAIM: Semantic Structure](https://webaim.org/techniques/semanticstructure/)：从辅助技术使用者视角讲语义结构，含 landmark 导航的实操说明
- [W3C Markup Validation Service](https://validator.w3.org/nu/)：校验 `main` 的位置、元素嵌套合法性

---

到这里，页面的结构和内容都讲完了。还剩一件事：怎么让**所有人**都能用——包括用屏幕阅读器的人、只用键盘的人、色觉障碍的人、认知障碍的人。下一章是 [HTML 层面的无障碍](/html/accessibility)，会把本章零散提到的 ARIA 规则系统化，并讲清楚一个反直觉的原则：**ARIA 的第一条规则是「如果能用原生 HTML，就不要用 ARIA」**。
