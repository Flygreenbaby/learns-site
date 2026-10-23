# 链接与导航：href、rel 与 URL

`<a>` 是 HTML 里看起来最简单的元素，但它是**唯一一个错误写法会造成安全漏洞的元素**，也是相对路径问题的主要来源。这一章把 URL 解析规则和 `rel` 系列属性讲清楚。

## a 元素与 href

```html
<a href="https://example.com/docs/">文档</a>
```

- `<a>` 代表 anchor（锚点）。
- `href` 是 hypertext reference（超文本引用），值是一个 URL。
- 没有 `href` 的 `<a>` 是**占位符**，不是链接：它不会被聚焦，读屏软件不会播报为链接，鼠标悬停也没有手型光标。

```html
<!-- 这是一个占位符，不是链接 -->
<a>未激活的链接</a>
```

`<a>` 可以包裹**流内容**（几乎任何元素），包括块级元素——这是 HTML5 相对 HTML4 的一个变化。所以下面这样写是合法的：

```html
<a href="/posts/1" class="card">
  <h2>文章标题</h2>
  <p>摘要文字……</p>
  <img src="/thumb.jpg" alt="">
</a>
```

这种「整卡片可点击」的模式在现代 UI 里很常见。但要注意里面不能再嵌套 `<a>`，也不能嵌套交互式元素（`<button>`、`<input>`），因为交互式内容不能嵌套在交互式内容里。

## URL 的类型与相对路径解析

这是最容易出错、也最值得彻底搞懂的部分。

### 六种写法

以当前页面 URL 为 `https://example.com/docs/html/links.html` 为例：

| 写法 | 类型 | 解析结果 |
| --- | --- | --- |
| `https://cdn.example.com/a.js` | 绝对 URL | `https://cdn.example.com/a.js` |
| `/assets/style.css` | 根相对 URL | `https://example.com/assets/style.css` |
| `other.html` | 相对 URL | `https://example.com/docs/html/other.html` |
| `../css/index.html` | 相对 URL（上级） | `https://example.com/docs/css/index.html` |
| `//cdn.example.com/a.js` | 协议相对 URL | 继承当前协议（`https://cdn.example.com/a.js`） |
| `#section-2` | 片段 URL | 当前页面 + `#section-2` |

另外还有几种非 http 协议的 URL：

```html
<a href="mailto:someone@example.com">发邮件</a>
<a href="mailto:someone@example.com?subject=反馈&body=内容">带主题和正文</a>
<a href="tel:+8613800138000">拨打电话</a>
<a href="sms:+8613800138000">发短信</a>
```

### 相对路径的关键规则：最后一段是「文件」还是「目录」

这是相对路径错误的头号来源。规则是：**解析相对 URL 时，基准 URL 的最后一段被当作「文件名」丢弃，剩下的才是目录。**

对比这两种情况：

```
当前页面：https://example.com/docs/html/links.html
链接：    other.html
结果：    https://example.com/docs/html/other.html
          （丢掉 links.html，基准目录是 /docs/html/）
```

```
当前页面：https://example.com/docs/html        ← 注意结尾没有斜杠
链接：    other.html
结果：    https://example.com/docs/other.html   ← 不是你以为的 /docs/html/other.html
          （丢掉 html，基准目录是 /docs/）
```

**这就是为什么「结尾有没有斜杠」很重要。** 服务器配置里 `https://example.com/docs/html` 通常会 301 重定向到 `https://example.com/docs/html/`，就是为了避免这个歧义。但如果你直接打开本地文件（`file:///D:/work/docs/html`），没有服务器帮你重定向，相对路径就会解析错。

记忆方法：**把基准 URL 想成一个文件路径，砍掉最后一个 `/` 之后的部分，剩下的就是「当前目录」。**

### 关于协议相对 URL

```html
<!-- 老写法，现在不推荐 -->
<script src="//cdn.example.com/lib.js"></script>
```

它的产生背景是 HTTP/HTTPS 混合内容问题：早年页面可能是 http 也可能是 https，用协议相对写法可以避免混合内容警告。**现在全站 HTTPS 已经是默认前提，这种写法只剩缺点**（比如在 `file://` 下打开会解析成 `file://cdn.example.com/...` 而失败）。

**建议：直接写完整的 `https://`。**

### `<base>` 会改变一切

如果文档里有 `<base href="...">`，那么**所有**相对 URL 都以它为基准，而不是以当前页面 URL 为基准。这个副作用非常大，详见[文档骨架一章](/html/document-structure#base-强大但危险)。

## target 与一个真实的安全问题

```html
<a href="https://example.com/" target="_blank">在新标签页打开</a>
```

`target` 的合法值：

| 值 | 行为 |
| --- | --- |
| `_self` | 当前标签页（默认） |
| `_blank` | 新标签页/新窗口 |
| `_parent` | 父级浏览上下文（iframe 的父页面） |
| `_top` | 最顶层浏览上下文（跳出所有 iframe 嵌套） |
| 自定义名称 | 打开或复用一个具名窗口 |

### 反向标签劫持（reverse tabnabbing）

新开的页面可以通过 `window.opener` 拿到原页面的引用，然后执行：

```js
// 恶意页面上的代码
window.opener.location = 'https://phishing-site.example.com/'
```

原页面的标签页就被悄悄替换成了钓鱼网站。用户看到的是「我刚才点的那个标签页」，很容易上当。

**历史上的解决办法**是显式写 `rel="noopener"`：

```html
<a href="https://example.com/" target="_blank" rel="noopener">链接</a>
```

**现状**：所有主流浏览器现在都**默认对 `target="_blank"` 隐含 `rel="noopener"`**（Chrome 88+、Firefox 79+、Safari 12.1+ 起）。所以在现代浏览器里不写也是安全的。

**但仍然建议显式写上**，原因有两个：一是老浏览器和某些嵌入式 WebView 仍然有漏洞；二是显式声明让代码意图清晰，也便于静态检查工具识别。

## rel 属性：链接关系的完整清单

`rel`（relationship）声明当前文档与目标资源的关系。它可以有多个值，用空格分隔。

### 安全与隐私相关

```html
<!-- 切断 window.opener 引用 -->
<a href="..." target="_blank" rel="noopener">

<!-- 不发送 Referer 头（也不让对方知道用户从你这儿来） -->
<a href="..." rel="noreferrer">

<!-- 两者同时（noreferrer 已隐含 noopener 的效果） -->
<a href="..." target="_blank" rel="noopener noreferrer">
```

`noopener` 和 `noreferrer` 的区别值得说清：

- `noopener`：新页面拿不到 `window.opener`。**解决安全问题。**
- `noreferrer`：不发送 `Referer` 请求头。**解决隐私问题。** 它同时也隐含了 `noopener` 的效果。

外链到不信任的站点时，写 `rel="noopener noreferrer"` 是常见做法。

### SEO 相关

```html
<!-- 告诉搜索引擎不要把权重传递给这个链接 -->
<a href="..." rel="nofollow">赞助商链接</a>

<!-- 声明本页的规范 URL，处理重复内容 -->
<link rel="canonical" href="https://example.com/docs/links">

<!-- 声明同一内容的其他版本 -->
<link rel="alternate" hreflang="en" href="https://example.com/en/docs/links">
```

`nofollow` 的语义是「我不为这个链接背书」。适合用在用户生成内容（评论区）和付费/赞助链接上。需要如实说明：各搜索引擎如何处理 `nofollow` 是它们自己的策略，`nofollow` 只是一个**提示（hint）**而非指令。

### 资源加载相关

```html
<link rel="stylesheet" href="style.css">
<link rel="preload" href="font.woff2" as="font" type="font/woff2" crossorigin>
<link rel="prefetch" href="next-page.js">
<link rel="icon" href="favicon.ico">
```

详见[文档骨架一章](/html/document-structure#link-外部资源与文档关系)。

## 下载链接：download 属性

```html
<a href="/files/report.pdf" download>下载报告</a>
<a href="/files/report.pdf" download="2026年报告.pdf">下载并重命名</a>
```

`download` 告诉浏览器「不要导航到这个 URL，而是下载它」。带值时会作为建议的文件名。

**两个真实限制**：

1. **同源限制**。跨域链接上的 `download` 属性，浏览器会忽略你指定的文件名（部分浏览器会完全忽略 download 行为，直接导航）。要跨域下载并控制文件名，服务端需要设置 `Content-Disposition: attachment; filename="..."` 响应头。
2. **文件名不一定被采用**。浏览器可能因为安全策略（如可执行文件）或用户设置而修改文件名。`download` 的值只是**建议**。

## 锚点与页内导航

```html
<!-- 目标 -->
<h2 id="section-2">第二节</h2>

<!-- 链接 -->
<a href="#section-2">跳到第二节</a>
```

几个实践要点：

**1. 用 `id` 而不是 `<a name>`。** `<a name="xxx">` 是 HTML4 的老写法，现在已经废弃，用任何元素的 `id` 都可以。

**2. 固定头部会遮挡锚点目标。** 如果页面有 `position: sticky` 的顶部导航栏，跳转到 `#section-2` 时标题会被导航栏挡住。解决办法是 CSS 的 `scroll-margin-top`：

```css
h2 {
  scroll-margin-top: 5rem; /* 等于固定导航栏的高度 */
}
```

**3. 「回到顶部」的标准写法。**

```html
<!-- 有效，但会在 URL 里留下 #top，且不是标准片段 -->
<a href="#top">回到顶部</a>
```

`#top` 是一个特殊值：HTML 标准规定，如果找不到 `id="top"` 的元素，浏览器会滚动到文档顶部。但更清晰的做法是给页面顶部一个真实的 id，或者用按钮 + JavaScript。

**4. URL 里的片段会进入历史记录。** 点页内锚点会新增一条浏览器历史记录，用户点「后退」会在锚点之间来回跳，而不是回到上一页。这是标准行为，但常常让用户困惑。如果需要避免，得用 JavaScript 的 `history.replaceState` 处理。

## 链接还是按钮？

这是一个真实的、经常被做错的选择。判断标准很简单：

| 用 `<a>` | 用 `<button>` |
| --- | --- |
| 导航到另一个 URL（包括页内锚点） | 触发一个动作，不改变 URL |
| 用户应该能「在新标签页打开」「复制链接地址」 | 例如：提交表单、打开弹窗、展开折叠、删除记录 |
| 右键菜单里的「在新标签页打开」有意义 | 右键「在新标签页打开」没有意义 |

**典型错误**：

```html
<!-- 错：用链接触发一个动作 -->
<a href="#" onclick="openModal()">打开弹窗</a>
<a href="javascript:void(0)" onclick="submitForm()">提交</a>

<!-- 对 -->
<button type="button" onclick="openModal()">打开弹窗</button>
<button type="submit">提交</button>
```

用 `<a href="#">` 触发动作有三个实际问题：

1. 点击后 URL 会多一个 `#`，并新增一条历史记录，用户点后退时弹窗不会关，而是先在原地跳一次。
2. `href="javascript:..."` 会带来 CSP（内容安全策略）问题，很多安全策略会直接禁止 `javascript:` 协议。
3. `<a>` 和 `<button>` 的键盘行为不同：`<button>` 响应 `Enter` **和** `Space`，`<a>` 只响应 `Enter`。用 `<a>` 做按钮，习惯按空格的用户会发现按钮没反应。

反过来也成立：**用 `<button>` 做导航也是错的**，因为用户失去了「在新标签页打开」和「复制链接」的能力。

## 常见错误与排查

### 症状：本地打开正常，部署后所有链接 404

**最常见原因**：部署到了子目录，但链接用的是根相对路径。

比如站点部署在 `https://example.com/learns/` 下，而你写的是 `/html/index.html`，浏览器会请求 `https://example.com/html/index.html`——路径里丢了 `/learns/`。

**解决**：
- VitePress：修改 `base` 配置项为 `'/learns/'`
- Vite：修改 `base` 配置项
- 手写 HTML：改用相对路径，或者在构建时用变量注入前缀

### 症状：点击链接后页面跳到顶部

**原因**：`href="#"`。`#` 后面没有片段标识符时，浏览器会滚动到文档顶部。

**解决**：如果这是个动作按钮，改用 `<button type="button">`。如果确实需要保留 `<a>`（比如为了样式），写 `href="#!"` 之类不会匹配任何元素的片段，或者用 `event.preventDefault()`。

### 症状：新标签页打开的链接导致原页面被替换

**原因**：反向标签劫持，见前文。加 `rel="noopener"`。

### 症状：download 属性对跨域文件不起作用

**原因**：同源限制。需要服务端设置 `Content-Disposition` 响应头。

### 症状：链接点不动，但样式看起来正常

按顺序排查：
1. `<a>` 有没有 `href` 属性？没有 `href` 的 `<a>` 不是链接，不可点击也不可获得焦点。
2. 有没有被其他元素盖住？DevTools 里用元素选择器点一下那个位置，看选中的是不是 `<a>`。常见元凶是 `position: absolute` 的装饰元素、`::after` 伪元素、或者 z-index 更高的兄弟元素。
3. 父元素有没有 `pointer-events: none`？
4. 有没有 JavaScript 调用了 `preventDefault()` 但后续逻辑出错？看 Console。

## 练习

<Exercise title="练习 1 · 相对路径解析" difficulty="基础">

当前页面的 URL 是 `https://example.com/blog/2026/post.html`。写出下面每个 `href` 解析后的完整 URL：

1. `../index.html`
2. `/about.html`
3. `comments.html`
4. `./assets/img.png`
5. `../../admin/`
6. `#comments`
7. `//static.example.com/lib.js`
8. `mailto:a@b.com?subject=Hi`

<template #answer>

先确定基准目录。当前 URL 是 `https://example.com/blog/2026/post.html`，砍掉最后一段（`post.html`），**基准目录是 `https://example.com/blog/2026/`**。

1. `../index.html` → `https://example.com/blog/index.html`
   从基准目录上一级（`/blog/`）再拼 `index.html`。

2. `/about.html` → `https://example.com/about.html`
   根相对路径，从域名根开始，忽略当前目录。

3. `comments.html` → `https://example.com/blog/2026/comments.html`
   直接在基准目录下拼接。

4. `./assets/img.png` → `https://example.com/blog/2026/assets/img.png`
   `./` 显式表示「当前目录」，与直接写 `assets/img.png` 等价。

5. `../../admin/` → `https://example.com/admin/`
   上两级：`/blog/2026/` → `/blog/` → `/`，再拼 `admin/`。

6. `#comments` → `https://example.com/blog/2026/post.html#comments`
   片段 URL，页面不变，只加片段标识符。

7. `//static.example.com/lib.js` → `https://static.example.com/lib.js`
   协议相对 URL，继承当前页面的协议（https）。

8. `mailto:a@b.com?subject=Hi` → 不是 http URL，不会解析成网页地址，而是唤起系统的邮件客户端，收件人 `a@b.com`，主题 `Hi`。

**最容易错的是第 1 和第 5 题。** 关键就是记住「砍掉最后一段得到基准目录」这条规则。

**自检方法**：在浏览器 Console 里可以直接验证，`URL` 构造函数实现了完整的 RFC 3986 解析算法：

```js
new URL('../index.html', 'https://example.com/blog/2026/post.html').href
// 'https://example.com/blog/index.html'
```

</template>

</Exercise>

<Exercise title="练习 2 · 链接还是按钮" difficulty="基础">

判断下面每个交互应该用 `<a>` 还是 `<button>`，并写出正确的 HTML：

1. 商品卡片，点击后跳转到商品详情页
2. 商品详情页的「加入购物车」
3. 文章列表底部的「加载更多」（用 JS 追加内容，不刷新页面）
4. 文章列表底部的「下一页」（跳转到 `/list?page=2`）
5. FAQ 的问题条目，点击展开答案
6. 页脚的「回到顶部」

<template #answer>

**1. 商品卡片跳转 → `<a>`**

改变 URL、导航到新页面，用户应该能在新标签页打开它。

```html
<a href="/products/123" class="card">
  <h2>商品名称</h2>
  <p class="price">¥199</p>
</a>
```

**2. 加入购物车 → `<button>`**

触发一个动作，不改变 URL。用户「在新标签页打开加入购物车」是没有意义的。

```html
<button type="button">加入购物车</button>
```

`type="button"` 是必须的——如果这个按钮在 `<form>` 里，不写 type 会默认为 `submit`，导致点击时意外提交表单。

**3. 加载更多 → `<button>`**

虽然它「加载了更多内容」，但 URL 没有变化，是纯粹的页面内动作。

```html
<button type="button" id="load-more">加载更多</button>
```

**4. 下一页 → `<a>`**

URL 变成了 `/list?page=2`，这是导航。用户可能想在新标签页打开第二页，或者把这个链接发给别人。

```html
<a href="/list?page=2" rel="next">下一页</a>
```

**3 和 4 的区别是这道题的核心**：都是「显示更多内容」，但一个改变 URL 一个不改变，所以语义完全不同。判断标准永远是「URL 变不变」，不是「内容变不变」。

**5. FAQ 展开 → `<button>`**

页面内动作。更好的做法是配合原生 `<details>`，可以完全不用 JavaScript：

```html
<details>
  <summary>如何重置密码？</summary>
  <p>进入设置页面，点击「安全」标签……</p>
</details>
```

如果必须用 JS 实现，正确写法是按钮控制 `aria-expanded` 和内容区的可见性：

```html
<button type="button" aria-expanded="false" aria-controls="faq-1">
  如何重置密码？
</button>
<div id="faq-1" hidden>
  <p>进入设置页面……</p>
</div>
```

**6. 回到顶部 → 用 `<a>` 最简单，但要看情况**

如果用纯 HTML 实现，`<a href="#top">` 是合理的（它是一个页内导航）：

```html
<a href="#top">回到顶部</a>
```

但缺点是会在历史记录里增加条目，且滚动是瞬间的（除非配合 CSS `scroll-behavior: smooth`）。

如果用 JS 实现平滑滚动且不改变 URL，那应该用 `<button>`：

```html
<button type="button" id="back-to-top">回到顶部</button>
```

**两种都可以接受，取决于你选择哪种实现方式。** 关键是不能出现 `<a href="#" onclick="scrollToTop()">` 这种混合写法——它同时具有两种方案的缺点。

</template>

</Exercise>

<Exercise title="练习 3 · 找出安全问题" difficulty="进阶">

审查下面这段页脚代码，指出所有安全和隐私问题，并给出修正版：

```html
<footer>
  <p>
    友情链接：
    <a href="https://partner-a.example.com/" target="_blank">合作伙伴 A</a>
    <a href="https://partner-b.example.com/" target="_blank">合作伙伴 B</a>
  </p>
  <p>
    赞助内容：<a href="https://sponsor.example.com/">赞助商</a>
  </p>
  <p>
    <a href="https://cdn.example.com/report.pdf" download="年度报告.pdf">下载年度报告</a>
  </p>
  <p>
    <a href="#" onclick="window.print()">打印本页</a>
  </p>
</footer>
```

<template #answer>

**问题 1：外链缺少 `rel="noopener noreferrer"`**

两个 `target="_blank"` 的链接都没有 `rel`。虽然现代浏览器默认隐含 `noopener`，但：
- 老浏览器和部分嵌入式 WebView 仍有反向标签劫持风险
- 显式声明能让代码意图清晰，也便于静态扫描工具识别

另外，这两个是**外部站点**，通常不希望对方通过 `Referer` 头知道用户从你的页面来，加 `noreferrer` 更合适。

**问题 2：赞助链接缺少 `rel="nofollow"`（或 `sponsored`）**

赞助商链接是典型的「我不为这个链接背书」场景。不加 `nofollow` 可能被搜索引擎视为链接交易。

**问题 3：跨域 download 不会生效**

`https://cdn.example.com/report.pdf` 与当前页面跨域，`download="年度报告.pdf"` 指定的文件名会被浏览器忽略。如果确实需要控制文件名，必须由 `cdn.example.com` 返回：

```
Content-Disposition: attachment; filename="年度报告.pdf"
```

**问题 4：用 `<a href="#">` 触发打印动作**

这是「链接 vs 按钮」的典型错误：
- 点击后 URL 会多一个 `#` 并新增历史记录
- `<a>` 不响应空格键，键盘用户按空格无法触发
- 语义错误：打印是一个动作，不是导航

**修正版**：

```html
<footer>
  <p>
    友情链接：
    <a href="https://partner-a.example.com/" target="_blank" rel="noopener noreferrer">合作伙伴 A</a>
    <a href="https://partner-b.example.com/" target="_blank" rel="noopener noreferrer">合作伙伴 B</a>
  </p>
  <p>
    赞助内容：<a href="https://sponsor.example.com/" rel="nofollow sponsored noopener">赞助商</a>
  </p>
  <p>
    <!-- 文件名需要 CDN 端设置 Content-Disposition，这里保留 download 作为意图声明 -->
    <a href="https://cdn.example.com/report.pdf" download="年度报告.pdf">下载年度报告</a>
  </p>
  <p>
    <button type="button" onclick="window.print()">打印本页</button>
  </p>
</footer>
```

**补充说明**：

- `rel` 可以有多个值，用空格分隔。`nofollow sponsored` 同时表达「不背书」和「这是赞助内容」——`sponsored` 是较新增加的值，语义比 `nofollow` 更精确，两者一起写兼容性最好。
- 打印按钮改成 `<button type="button">` 后，键盘用户可以用 Tab 聚焦、用 Enter 或 Space 触发，行为与其他按钮一致。
- 如果想让打印按钮看起来像链接，用 CSS 实现（`background: none; border: 0; color: var(--link-color); text-decoration: underline; cursor: pointer;`），**不要为了样式而牺牲语义**。

</template>

</Exercise>

## 官方文档与延伸阅读

- [WHATWG HTML 标准 · 链接](https://html.spec.whatwg.org/multipage/links.html) —— `<a>`、`<area>`、`<link>` 与 `rel` 所有取值的规范定义。想查某个 `rel` 值的确切语义，看这里。
- [MDN · `<a>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/a) —— 属性清单、可访问性说明、`target="_blank"` 的安全注意事项。
- [MDN · link 类型](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Attributes/rel) —— `rel` 全部取值的速查表。
- [MDN · `<a>` 的 download 属性](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/a#download) —— 同源限制的说明。
- [MDN · 什么是 URL？](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Howto/Web_mechanics/What_is_a_URL) —— 相对 URL 与绝对 URL 的入门讲解。
- [MDN · URL API](https://developer.mozilla.org/zh-CN/docs/Web/API/URL) —— 练习里用到的 `new URL(relative, base)`，它实现了完整的 URL 解析算法，是验证相对路径最可靠的工具。
- [MDN · scroll-margin-top](https://developer.mozilla.org/zh-CN/docs/Web/CSS/scroll-margin-top) —— 解决固定导航栏遮挡锚点目标的问题。
- [RFC 3986 · Uniform Resource Identifier (URI): Generic Syntax](https://datatracker.ietf.org/doc/html/rfc3986) —— 相对 URL 解析算法的原始规范（第 5 节 Reference Resolution）。

## 下一章

链接解决了「页面之间」的连接，接下来看页面里承载信息量最大的部分：[图片与多媒体](/html/images-media)。
