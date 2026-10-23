# HTML 是什么：文档、解析与容错

## 先看一个会让人困惑的现象

把下面这段代码保存成 `test.html` 用浏览器打开，然后在开发者工具的 Elements 面板里看实际生成的结构：

```html
<p>第一段开始
  <div>我是一个 div</div>
第一段结束</p>
```

你写的意图大概是「一个段落，里面嵌了一个 div」。但 Elements 面板里看到的实际结构是：

```html
<p>第一段开始</p>
<div>我是一个 div</div>
第一段结束
```

`<p>` 被提前关闭了，`第一段结束` 变成了裸露在外的文本节点，你写的那个 `</p>` 结束标签被浏览器直接丢弃。**没有报错，没有警告，页面看起来"差不多对"**——这正是 HTML 最需要理解的地方。

这一章要回答的问题是：浏览器拿到一段 HTML 文本之后，到底做了什么？为什么它会这样"擅自修改"你的代码？理解了这套机制，上面这种现象就不需要死记硬背，而是可以推导出来的。

## HTML 是标记语言，不是编程语言

先把概念摆正，因为术语混淆会导致后面所有讨论都失焦。

HTML（HyperText Markup Language，超文本标记语言）是一种**描述文档结构的数据格式**，和 JSON、XML 是同一类东西。它：

- 没有变量、没有条件判断、没有循环、没有函数
- 不能"执行"任何操作，只能"描述"文档由哪些部分组成、各部分是什么含义
- 是**声明式**的：你说"这是一篇文章的标题"，而不是"请把这里的文字设为 24px 加粗"

最后这一点是理解 HTML 的关键。HTML 描述的是**含义（语义）**，具体怎么呈现由浏览器的默认样式表和 CSS 决定。这就是为什么同一个 `<h1>` 在不同浏览器、不同 CSS 下看起来不一样，但它始终是"一级标题"这个含义，读屏软件永远会用同样的方式朗读它。

对比一下三种技术各自负责什么：

| 技术 | 负责 | 类比 |
| --- | --- | --- |
| HTML | 结构与语义：这是什么 | 建筑的结构图纸：这里是承重墙，那里是窗户 |
| CSS | 呈现：长什么样 | 装修方案：墙刷什么颜色，窗户多大 |
| JavaScript | 行为：能做什么、如何响应用户 | 水电与智能家居：按开关灯会亮 |

## 准确的术语：元素、标签、属性

这三个词在日常交流里经常混用，但它们的区别在排查问题时很重要。

```html
<a href="https://example.com/" class="link">示例链接</a>
```

- **元素（element）**：从 `<a>` 到 `</a>` 的**整体**，包括开始标签、内容和结束标签。元素是文档树里的一个节点。
- **标签（tag）**：`<a>` 是开始标签（start tag），`</a>` 是结束标签（end tag）。标签只是元素的边界记号。
- **属性（attribute）**：写在开始标签里的名值对，这里是 `href="https://example.com/"` 和 `class="link"`。

所以「闭合标签」的准确说法是「元素有结束标签」，而不是「标签闭合了」。

有一类元素没有内容也没有结束标签，称为**空元素（void element）**。HTML 标准里明确列出的空元素是：`area`、`base`、`br`、`col`、`embed`、`hr`、`img`、`input`、`link`、`meta`、`param`、`source`、`track`、`wbr`。

```html
<!-- 以下三种写法在 HTML 中效果完全相同 -->
<img src="a.png" alt="示例">
<img src="a.png" alt="示例"/>
<img src="a.png" alt="示例" />
```

HTML 解析器会把 `/>` 里的那个斜杠**直接忽略**（规范中称为 "self-closing flag"，对空元素而言它没有任何作用）。所以 `/>` 写法不是错的，只是冗余。它有意义是在 JSX 和 Vue 模板里——那里 `/>` 是必须的语法。

<Callout type="warn" title="注意：斜杠对非空元素无效">

`<div/>` **不会**创建一个自闭合的 div。解析器会把它当作普通的 `<div>` 开始标签处理，于是后面所有内容都被吞进这个 div，直到遇到 `</div>` 或文档结束。这是一个真实存在且不容易发现的坑，因为视觉上看不出问题。

</Callout>

## 浏览器如何把文本变成文档树

HTML 的解析过程在标准里有非常精确的规定。整体分为几步：

### 第 1 步：字节流 → 字符流（编码解码）

服务器传来的是一串字节。浏览器必须先知道用什么字符编码去解释这些字节。判断顺序大致是：

1. HTTP 响应头的 `Content-Type: text/html; charset=utf-8`
2. 文档里的 `<meta charset="utf-8">`
3. 都没有时使用浏览器的默认编码猜测

这就是为什么**乱码几乎总是编码问题**，而不是 HTML 语法问题。文件用 UTF-8 保存，但没声明 `charset`，浏览器可能按 GBK 解释，中文就变成一堆乱码。

标准还规定：包含字符编码声明的那个元素必须**完整地出现在文档的前 1024 字节内**。所以 `<meta charset="utf-8">` 要尽量靠前写，放在 `<head>` 的第一个位置是最稳妥的做法。

### 第 2 步：字符流 → Token（词法分析）

解析器逐个字符扫描，把文本切成一个个 token：开始标签 token、结束标签 token、注释 token、文本 token、DOCTYPE token。这一步有个专门的**分词器（tokenizer）**，它有自己的状态机——比如遇到 `<` 就进入标签状态，在标签状态里遇到 `>` 才结束。

这解释了一个常见疑问：为什么 `<script>` 里的 `<` 不会被当成标签开始？因为分词器在遇到 `<script>` 后切换到专门的脚本数据状态，直到看见 `</script` 才切回来。

### 第 3 步：Token → 节点树（树构建）

这是最关键、也最反直觉的一步。树构建器维护一个**开放元素栈（stack of open elements）**和一个**当前插入模式（insertion mode）**。插入模式决定了"在这个位置遇到这个 token 该怎么办"。

主要插入模式包括：`initial`、`before html`、`before head`、`in head`、`after head`、`in body`、`text`、`in table`、`after body`、`after after body` 等。

回到开头那个例子。解析到 `<div>` 时：

1. 当前插入模式是 `in body`，开放元素栈里有 `html > body > p`
2. 规范规定：在 `in body` 模式下遇到 `div` 开始标签时，**如果栈里在 button scope 内存在 `p` 元素，就先关闭这个 `p`**
3. 于是 `<p>` 被弹出栈并闭合
4. 然后 `div` 作为 `body` 的子元素插入
5. 后面那个 `</p>` 找不到对应的开放 `p`，被当作错误忽略

整个过程完全由规范规定，**所有浏览器的行为必须完全一致**。这就是为什么你能靠推理而不是试错来预测结果。

### 第 4 步：节点树 → 渲染树 → 布局 → 绘制

DOM 树建好后，浏览器结合 CSS 计算每个节点的样式，生成渲染树，计算位置和大小（布局），最后画到屏幕上。这部分属于 CSS 和浏览器渲染的范畴，会在 [CSS 领域](/css/)和前端工程化领域展开。

## 容错：HTML 与 XML 的根本区别

XML 的解析规则是「格式不良即失败」（well-formedness），一个标签没闭合，整个文档解析报错。HTML 完全相反：**它规定了如何从每一种错误中恢复**。

这是 HTML5 相对早期 HTML 的一个重大变化。在 HTML4 时代，各浏览器对错误 HTML 的处理方式不一致，导致同一份代码在 IE 和 Firefox 里生成不同的 DOM——那是"浏览器战争"时代前端最痛苦的问题之一。HTML5 把错误恢复行为写进了标准，从此所有浏览器解析同一段错误代码，得到**逐字节相同**的 DOM 树。

几个典型的容错行为：

| 你写的 | 浏览器实际生成 | 规则 |
| --- | --- | --- |
| `<ul><li>A<li>B</ul>` | `<ul><li>A</li><li>B</li></ul>` | 遇到新的 `<li>` 自动关闭上一个 `<li>` |
| `<p>a<p>b` | `<p>a</p><p>b</p>` | `<p>` 不能嵌套 `<p>`，遇到新的自动关闭旧的 |
| `<div><span>x</div>` | `<div><span>x</span></div>` | 文档结束时自动闭合所有未闭合元素 |
| `<table>裸文本<tr>...` | 裸文本被移到 `<table>` **前面** | 术语叫 foster parenting（寄养） |
| `<a href=x>无引号属性</a>` | `href="x"` | 属性值可以不加引号，但不能含空格或 `>` |
| `<DIV CLASS="a">` | `<div class="a">` | 标签名和属性名大小写不敏感 |

<Callout type="info" title="为什么要理解这些，而不是「写对就行了」">

三个实际场景：
1. **Vue / React 模板**：Vue 模板会被编译，React 的 JSX 会被 Babel 转换成 JavaScript。它们对 HTML 的容错程度**远低于浏览器**——浏览器能自动修好的东西，模板编译器往往直接报错或生成错误结构。知道浏览器的容错规则，你才能看懂那些看起来很奇怪的编译错误。
2. **服务端渲染的 HTML**：后端模板拼接出来的 HTML 常常不完整，浏览器会静默修复，导致你在 DevTools 里看到的结构和后端输出的字符串不一致。
3. **富文本编辑器 / 爬虫**：处理用户粘贴的脏 HTML 时，你必须知道浏览器会怎么解析它。

</Callout>

## 标准模式与怪异模式：DOCTYPE 的真实作用

很多人以为 `<!DOCTYPE html>` 只是"必须写的仪式"。它实际上有一个非常具体的功能：**告诉浏览器用哪种模式解析和渲染文档**。

- 有 `<!DOCTYPE html>` → **标准模式（standards mode）**，按现行规范渲染
- 没有 DOCTYPE，或写了一个古老的 DOCTYPE → **怪异模式（quirks mode）**，浏览器会模拟 90 年代末的行为

怪异模式最著名的差异是盒模型：在怪异模式下，`width` 包含 padding 和 border（即 IE 早期的行为），而在标准模式下 `width` 只指内容宽度。这会导致同一份 CSS 布局完全不同。

还有一种中间状态叫**接近标准模式（almost standards mode）**，由某些老式 DOCTYPE 触发，差异主要在表格单元格内图片的垂直对齐上。

`<!DOCTYPE html>` 之所以这么短，正是因为它唯一的作用就是触发标准模式——它不引用任何 DTD，浏览器也不做校验。注意它**不是** HTML 元素，没有结束标签，也不能写成 `<doctype html>`（虽然大小写不敏感所以那样也能工作，但不符合惯例）。

## 空白字符的处理

这里有一个非常普遍的误解，值得单独澄清。

```html
<p>这些    空格     会     被折叠</p>
```

页面上显示为「这些 空格 会 被折叠」，多个空格变成一个。**很多人以为这是 HTML 解析器做的，其实不是。**

HTML 解析器会**原样保留**这些空白字符在文本节点里。折叠是 CSS 的 `white-space` 属性造成的——它的初始值是 `normal`，含义就是「折叠连续的空白字符，并在需要时换行」。

验证方法：在 DevTools 的 Console 里执行

```js
document.querySelector('p').textContent
```

你会看到那些多余的空格都还在字符串里。

这个区别很重要，因为它意味着你可以通过 CSS 改变空白行为：

```css
pre { white-space: pre; }        /* 保留所有空白，<pre> 的默认值 */
code { white-space: pre-wrap; }  /* 保留空白但允许换行 */
.nowrap { white-space: nowrap; } /* 折叠空白但禁止换行 */
```

同时它也解释了一个 Vue/JSX 里的经典问题：为什么两个并排的行内元素之间会有一条缝隙？因为你在 HTML 里换行了，那个换行符是一个空白字符，被 CSS 渲染成了一个空格宽度的间隔。

## 常见错误与排查

### 症状：中文显示成乱码

**原因**：字符编码不匹配。

**排查步骤**：
1. DevTools → Network 面板 → 点击文档请求 → 查看 Response Headers 里有没有 `charset`
2. 查看 `<head>` 里有没有 `<meta charset="utf-8">`，且是否在前 1024 字节内
3. 确认编辑器实际保存的编码（VS Code 右下角可以看到并切换）

三处必须一致。最常见的情况是文件存成了 UTF-8，但漏写了 `<meta charset>`。

### 症状：布局莫名其妙错位，但 HTML 看着没问题

**原因**：解析器的容错行为改变了你的结构。

**排查方法**：不要看你写的源码，看 DevTools Elements 面板里的**实际 DOM 树**。把它和你以为的结构对比，差异处就是问题。特别注意 `<p>`、`<table>`、`<ul>` 这三类有严格内容模型限制的元素。

### 症状：`<div/>` 之后所有内容都跑到 div 里了

**原因**：斜杠对非空元素无效，见前文。改成 `<div></div>`。

### 症状：整个页面的 CSS 尺寸都不对

**原因**：漏写 `<!DOCTYPE html>`，进入了怪异模式。

**排查方法**：DevTools → Elements 面板，看最顶上的文档节点。Firefox 会在文档节点上标注渲染模式；Chrome 可以在 Console 里执行 `document.compatMode`，返回 `'BackCompat'` 表示怪异模式，`'CSS1Compat'` 表示标准模式。

## 练习

<Exercise title="练习 1 · 预测 DOM 结构" difficulty="基础">

不使用浏览器，写出下面这段 HTML 经过解析后实际生成的 DOM 结构（用缩进表示层级）：

```html
<body>
  <p>段落一
  <p>段落二
    <div>一个 div</div>
  <ul>
    <li>项目 A
    <li>项目 B
  </ul>
</body>
```

<template #answer>

实际结构：

```html
<body>
  <p>段落一</p>
  <p>段落二</p>
  <div>一个 div</div>
  <ul>
    <li>项目 A</li>
    <li>项目 B</li>
  </ul>
</body>
```

**逐步推导**：

1. 第二个 `<p>` 出现时，第一个 `<p>` 被自动关闭（`p` 不能嵌套 `p`）。
2. `<div>` 出现时，当前开放的 `<p>`（段落二）被先关闭，然后 `div` 成为 `body` 的直接子元素——**注意 div 没有跑到 p 里面**。
3. `<ul>` 出现，成为 `body` 的子元素。
4. 第二个 `<li>` 出现时，第一个 `<li>` 被自动关闭。
5. `</ul>` 和 `</body>` 正常匹配。

写完之后请务必用浏览器验证一次。核对方式：打开 DevTools 的 Elements 面板，逐层展开对比。如果和你的预测不一致，回到本章「容错」一节找对应的规则。

</template>

</Exercise>

<Exercise title="练习 2 · 空白字符从哪来" difficulty="基础">

下面两个例子的视觉效果有什么不同？为什么？

```html
<!-- 例子 A -->
<button>取消</button><button>确定</button>

<!-- 例子 B -->
<button>取消</button>
<button>确定</button>
```

<template #answer>

例子 A 的两个按钮**紧贴在一起，中间没有间隙**。例子 B 的两个按钮之间**有一个空格宽度的间隙**。

**原因**：例子 B 中两个 `</button>` 和 `<button>` 之间有一个换行符。HTML 解析器把这个换行符保留为文本节点的内容；CSS 的 `white-space: normal`（初始值）把这个空白字符渲染成一个空格的宽度。

**这不是 HTML 解析器折叠或插入的**，解析器只是忠实保留了源码里的换行。

**关键理解**：在 HTML 源码里，标签之间的换行和缩进是有视觉后果的。当你需要两个行内元素严格紧贴时，要么写在同一行，要么用 CSS 消除（例如给父元素设 `font-size: 0`，或用 Flexbox/Grid 布局——后者是更好的做法，因为 Flex 容器的子元素之间不会有空白文本节点造成的间隙）。

**验证方式**：在 Console 执行 `document.body.childNodes.length`，例子 B 会比例子 A 多出空白文本节点。

</template>

</Exercise>

<Exercise title="练习 3 · 判断渲染模式" difficulty="进阶">

下面三个文档分别处于哪种渲染模式？

```html
<!-- 文档 1 -->
<html><head><title>t</title></head><body>x</body></html>

<!-- 文档 2 -->
<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html><head><title>t</title></head><body>x</body></html>

<!-- 文档 3 -->
<!doctype html>
<html><head><title>t</title></head><body>x</body></html>
```

<template #answer>

- **文档 1：怪异模式（quirks mode）**。完全没有 DOCTYPE。
- **文档 2：接近标准模式（almost standards mode）**。这是一个不带 URL 的老式 transitional DOCTYPE。如果加上 `SYSTEM "http://www.w3.org/TR/html4/loose.dtd"`，多数浏览器仍会判为接近标准模式；具体的 DOCTYPE 列表在各浏览器的渲染模式实现里都有定义。
- **文档 3：标准模式（standards mode）**。`<!doctype html>` 与 `<!DOCTYPE html>` 等价——DOCTYPE 关键字大小写不敏感。

**验证方式**：在每种情况下打开 Console 执行 `document.compatMode`：

| 返回值 | 含义 |
| --- | --- |
| `'CSS1Compat'` | 标准模式 或 接近标准模式 |
| `'BackCompat'` | 怪异模式 |

注意 `document.compatMode` 无法区分标准模式和接近标准模式，两者都返回 `'CSS1Compat'`。

**实际影响**：怪异模式下 `width` 包含 padding 和 border，标准模式下不包含。所以文档 1 的盒模型计算会和文档 3 完全不同——即使 CSS 一模一样。

</template>

</Exercise>

## 官方文档与延伸阅读

- [WHATWG HTML 标准 · 解析 HTML](https://html.spec.whatwg.org/multipage/parsing.html) —— 本章「解析流程」「插入模式」「容错规则」的权威来源。分词器和树构建算法的完整状态机定义都在这里。内容非常技术化，不需要通读，当作查证工具用。
- [WHATWG HTML 标准 · 语法](https://html.spec.whatwg.org/multipage/syntax.html) —— DOCTYPE、元素、属性、空元素列表、字符引用的语法规则。
- [WHATWG HTML 标准 · 渲染](https://html.spec.whatwg.org/multipage/rendering.html) —— 浏览器默认样式（即 HTML 元素在没有 CSS 时长什么样）的规定。想理解「为什么 `h1` 默认加粗大字」看这里。
- [MDN · HTML 文档结构](https://developer.mozilla.org/zh-CN/docs/Web/HTML) —— 中文入门讲解。
- [MDN · Document.compatMode](https://developer.mozilla.org/zh-CN/docs/Web/API/Document/compatMode) —— 本章练习用到的 API。
- [MDN · white-space](https://developer.mozilla.org/zh-CN/docs/Web/CSS/white-space) —— 空白折叠的真实来源。

## 下一章

理解了浏览器如何处理 HTML 文本之后，下一步是[写出一个正确的文档骨架](/html/document-structure)：DOCTYPE、`lang` 属性、字符编码、viewport，以及 `<head>` 里那些看不见但很重要的元数据。
