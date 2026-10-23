# 阶段项目：语义化个人学习档案页

前面 9 章讲了 HTML 的九个方面：解析与容错、文档骨架、文本语义、链接与 URL、图片与多媒体、表单、表格、页面结构、无障碍。每一章都有练习，但练习是**碎片化**的——每个练习只考一个知识点。

这一章不一样。它要求你**从零写出一个完整的、真实的页面**，并且这个页面必须同时满足前面所有章节的要求。做完它，HTML 领域才算真正完成。

<Callout type="verified" title="本章带有一份真实可运行的参考实现">

本站提供了一份完整的参考实现，就两个文件：

- `/examples/html-archive/index.html`
- `/examples/html-archive/style.css`

在本地启动本站后（见 [如何使用本站](/guide/how-to-use)），用 `npm run dev` 起的开发服务器访问：

```
http://localhost:5173/examples/html-archive/index.html
```

<Callout type="warn" title="开发服务器下必须写全 index.html">

`public/` 目录里的文件在 `npm run dev` 下由 Vite 直接静态提供，**不会**把目录 URL 自动解析到 `index.html`。所以访问 `http://localhost:5173/examples/html-archive/`（结尾不带文件名）会命中 VitePress 的单页应用回退，返回站点外壳，再由前端路由渲染成「页面不存在」。HTTP 状态码是 200，看状态码判断不出来，只有看响应正文才发现拿到的是 VitePress 外壳而不是这个页面。

构建之后（`npm run build`）用静态服务器托管 `.vitepress/dist/` 时，目录 URL 由服务器（nginx、`vitepress preview` 等）解析，`/examples/html-archive/` 和 `/examples/html-archive/index.html` 都能打开。

</Callout>

它也可以脱离本站独立运行：把这两个文件复制到任意目录，双击 `index.html` 即可（这种方式下 CSS 走 `file://` 协议加载，同样生效）。

**参考实现的验证状态**（核实时间：2026 年 10 月）：

| 验证项 | 工具 | 结果 |
| --- | --- | --- |
| HTML 结构 | W3C Nu Html Checker（validator.w3.org/nu/，版本 26.10.12） | **0 错误、0 警告**，2 条 info（见下方说明） |
| CSS 语法 | postcss 解析 | 通过（65 条规则、4 条 at-rule、187 条声明，无语法错误） |
| 配色对比度 | 按 WCAG 2.2 相对亮度公式逐对计算 | 17 组配色全部通过：文本 ≥6.70:1（要求 4.5:1），非文本 ≥4.83:1（要求 3:1） |
| 真实浏览器结构检查 | Chrome（DevTools Protocol） | 标题层级严格递进；landmark 各 1 个且已命名；10/10 个 `<th>` 带 `scope`；0 个无名称的可聚焦元素；跳转链接是第一个 Tab 焦点；638px 宽度下无横向溢出 |
| 320px 回流 | Chrome，约束根元素宽度为 320px | 除表格滚动容器外无元素溢出（近似测试，见下方说明） |
| 禁用 CSS 后的阅读顺序 | Chrome，禁用样式表后遍历文本节点 | 顺序完全符合预期（跳转链接 → 站名 → 导航 → 标题 → 正文 → 各分区） |
| 外部链接 | curl | 5 个外链全部返回 200 |

**两条 info 是什么**：Nu 校验器报告「The "list" role is unnecessary for element "ul"」两次，指向主导航的 `<ul>` 和标签列表的 `<ul>`。这是**刻意为之**：这两个列表在 CSS 里设了 `list-style: none`，而 Safari + VoiceOver 在列表标记被移除后**不再把 `<ul>` 当作列表**，因此必须用 `role="list"` 补回语义（第 8 章讲过）。校验器按 HTML 规范判断「不需要」，但按浏览器 + 辅助技术的实际行为判断「需要」——这是一个真实的规范与实现之间的缝隙，值得记住。

**未验证的部分**：本站**没有**在真实浏览器中执行 200% 文本缩放走查、没有用屏幕阅读器实际朗读过这个页面、320px 测试是约束元素宽度的近似方法（媒体查询未触发）。这三项需要你在自己的环境里做，方法见第五章的验收清单。

</Callout>

---

## 一、项目目标

做一个**你自己的学习档案页**：记录你正在学什么、学到哪了、踩过哪些坑、下一步打算做什么。

选这个题目有三个原因：

1. **内容是你自己的**，所以你不会为了「凑内容」而写假数据。第 3 章讲过 `<time>`、第 7 章讲过表格、第 8 章讲过 `<article>`——这个项目里的每一条内容都对应一个真实的语义选择。
2. **它真的有用**。半年后你回来翻自己的档案，能看到当时的计划和踩过的坑。这不是练习题，是你以后会真的打开的页面。
3. **它不需要 JavaScript**。整个项目是纯 HTML + CSS。这让你能把全部注意力放在语义结构上，而不是被交互逻辑分心。等你学完 CSS 领域，再回来给它加交互，是很好的复习。

### 1.1 明确不做什么

为了避免范围蔓延，这个项目**明确排除**以下内容：

- 不用 JavaScript（包括「点击展开」「排序」「暗色模式切换按钮」）
- 不用任何框架、构建工具、CSS 预处理器
- 不做多页面路由（单页即可；想做多页是扩展任务）
- 不做响应式的复杂断点重排（单列布局天然响应式）
- 不追求视觉设计上的「好看」——这个项目考的是**结构和语义**，不是审美

暗色模式用 `prefers-color-scheme` 媒体查询实现（跟随系统），不需要 JS。参考实现里就是这么做的。

---

## 二、需求清单

你的页面必须包含以下 8 个部分。每个部分都标注了它考察的章节。

| # | 部分 | 必须包含 | 考察章节 |
| --- | --- | --- | --- |
| 1 | 跳转链接 | `<body>` 第一个子元素，指向 `#main-content` | 8 |
| 2 | 页头 | 站点名（可点击回首页）+ 主导航（`<nav>` + `<ul>`，已命名） | 3、8 |
| 3 | 主体 | `<main id="main-content" tabindex="-1">`，内含下面 4–7 | 8 |
| 4 | 自我介绍 | 一个 `<article>`，含 `<header>`（`<h1>` + 元信息）、至少一个 `<section>`（带 `aria-labelledby`）、`<footer>`（标签列表） | 4、8 |
| 5 | 学习进度 | 一个**数据表格**：`<caption>`、`<thead>`、`<tbody>`、`<tfoot>`，所有表头带 `scope`，数字列右对齐 + 等宽数字，外套可键盘滚动的容器 | 7、9 |
| 6 | 学习计划 | 一个 `<ol>`，每项含 `<strong>` 标出的技术名和一句「为什么在这一步」 | 4 |
| 7 | 学习笔记 | 至少 3 条 `<article>`，每条含 `<h3>` 标题、`<time>` 日期、一段解释「为什么」的正文 | 3、4、8 |
| 8 | 页脚 | 一段说明文字 + `<small>` 版权/更新时间 | 4、8 |

另外两个**可选但推荐**的部分：

- 一个 `<aside>`（相关资源链接），带 `aria-labelledby`
- 一个 `<dl>`（常见问题），考察定义列表的使用

### 2.1 关于「学习笔记」的要求

第 7 条是最能体现学习质量的部分。要求每条笔记回答三个问题：

1. **现象**：你遇到了什么？（最好是一段代码或一句报错）
2. **原因**：为什么会这样？（必须解释到机制层面，不能只说「浏览器就是这么设计的」）
3. **以后怎么办**：下次遇到同类问题怎么排查？

参考实现里的三条笔记（`<p>` 里放 `<div>`、`<section>` 不加 `aria-labelledby`、相对 URL 丢掉末段）就是按这个格式写的。

<Callout type="warn" title="不要写「今天学了 HTML，很开心」这种笔记">

这类笔记没有信息量，半年后你自己看了也不知道当时学了什么。

判断标准很简单：**如果这条笔记删掉，你会在未来某个时刻重复踩同一个坑吗？** 会 → 值得记；不会 → 不写。

这也是本站的内容原则（见[如何使用本站](/guide/how-to-use)）在你自己项目上的应用：不为数量写空洞内容。

</Callout>

---

## 三、分步实施

按下面的顺序做，每一步都对应前面某一章。不要跳步——跳步的后果通常要到第 6 步验收时才发现，返工成本更高。

### 第 1 步：搭骨架（对应第 2、3 章）

新建一个目录（比如 `my-archive/`），创建 `index.html` 和 `style.css`。先写骨架：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>我的学习档案</title>
<meta name="description" content="……">
<link rel="stylesheet" href="style.css">
</head>
<body>

<a href="#main-content" class="skip-link">跳到主要内容</a>

<header class="site-header">
  <!-- 站点名 + 主导航 -->
</header>

<main id="main-content" tabindex="-1">
  <!-- 内容 -->
</main>

<footer class="site-footer">
  <!-- 页脚 -->
</footer>

</body>
</html>
```

**这一步的检查点**：`<meta charset>` 在前 1024 字节内；`<title>` 存在；viewport 没有 `user-scalable=no`；`lang="zh-CN"`。

### 第 2 步：写内容，不写样式（对应第 4–8 章）

**这一步不要碰 CSS。** 把需求清单里的 8 个部分全部用纯语义标签写完。

为什么先不写样式：第 3 章讲过「禁用 CSS 测试」——如果 DOM 顺序本身就是对的，禁用 CSS 后页面应该完全可读。先写内容能让你在**没有视觉干扰**的情况下判断结构是否正确。等结构对了再加样式，样式就只是「让正确的结构更好看」；反过来做，你会不自觉地用 CSS 去掩盖结构错误。

**这一步的检查点**：

- 只有一个 `<h1>`，层级严格递进（用第 8 章的 Console 脚本查）
- 每个 `<section>` 都有 `aria-labelledby`
- 每个 `<nav>` 都有 `aria-label`
- 表格的每个 `<th>` 都有 `scope`
- 所有 `<img>`（如果有）都有 `alt`
- 没有任何 `<div>` 承担了语义角色（逐个问自己：这个 `<div>` 换成 `<section>`/`<aside>`/`<nav>`/`<header>` 会更准确吗？）

### 第 3 步：跑校验器（对应第 9 章）

把 `index.html` 上传到 [https://validator.w3.org/nu/](https://validator.w3.org/nu/)。

**要求：0 错误。** 警告（warning）可以逐条看，info 可以接受（参考实现就有 2 条 info）。

这一步会暴露第 2 步没发现的问题：嵌套不合法、属性拼写错误、`<main>` 位置不对、`<tfoot>` 位置不对、`<col>` 放在了 `<colgroup>` 外面等等。

<Callout type="info" title="校验器报错读不懂怎么办">

Nu 的报错信息是英文的，而且经常很技术化。三个技巧：

1. **看 `extract` 字段**。报错信息里带的那段代码片段（`extract`）直接告诉你问题出在哪几个字符上。
2. **看行号，去源码里数**。报错说 line 47，就去第 47 行看，通常问题就在附近 ±3 行。
3. **把报错信息复制到搜索引擎**，加上「html spec」或「MDN」。绝大多数常见错误都有人问过。

不要靠猜改代码。第 1 章讲过，HTML 解析器会容错，所以「浏览器里看起来正常」不等于「写对了」——校验器是唯一能告诉你「写没写对」的工具。

</Callout>

### 第 4 步：写样式（对应第 9 章，以及未来的 CSS 领域）

现在才写 CSS。参考实现的 `style.css` 可以直接作为起点，它包含：

- CSS 变量（设计令牌），亮色/暗色两套
- 全部使用 `rem` 的尺寸
- 跳转链接的「移出视口」隐藏法
- `:focus-visible` 焦点增强（不移除默认 outline）
- 表格的 `border-collapse: collapse`、`th` 左对齐覆盖、`.num` 右对齐 + `tabular-nums`
- 表格滚动容器（`overflow-x: auto`）
- `prefers-reduced-motion` 和打印样式

**你至少要自己写对的部分**（不要直接抄，先自己写，再对照）：

1. 跳转链接的隐藏方式
2. 焦点样式
3. 表格的边框合并与对齐
4. 暗色模式的变量切换

**这一步的检查点**：

- 所有颜色对比度达标（用 DevTools 颜色选择器或 WebAIM 工具逐个查）
- 没有任何 `outline: none` 或 `outline: 0`
- 没有 `px` 字号（`px` 只允许出现在边框宽度、圆角这类不影响文本缩放的场景）
- 没有 `user-scalable=no`

### 第 5 步：键盘走查（对应第 9 章）

把鼠标放到一边，只用键盘：

- [ ] 第 1 次 Tab 落在跳转链接上，且**看得见**
- [ ] 点击跳转链接后，焦点在 `<main>` 上（Console 查 `document.activeElement.id`）
- [ ] 从头 Tab 到尾，每一步焦点都可见
- [ ] Tab 顺序和视觉顺序一致
- [ ] 表格滚动容器能被 Tab 聚焦，并用方向键横向滚动

### 第 6 步：验收（对应第 9 章的清单）

执行第五章给出的完整验收清单。

### 第 7 步：部署（可选）

把两个文件放到任何能提供静态文件的地方：

- 本地：双击打开即可
- 自己的 VPS：`scp` 上去，Nginx 指到那个目录（工程工具与部署领域会讲）
- 局域网机顶盒：同上

这是「纯静态」带来的最大好处：**部署目标没有任何限制**。

---

## 四、验收标准

以下 14 条全部满足，项目才算完成。每条都标注了对应的 WCAG 2.2 成功准则（等级）和验证方法。

| # | 验收项 | WCAG SC | 验证方法 |
| --- | --- | --- | --- |
| 1 | W3C Nu 校验器 0 错误 | — | 上传到 validator.w3.org/nu/ |
| 2 | 恰好 1 个 `<h1>`，标题层级无跳级 | 1.3.1 / 2.4.6 | 第 8 章的 Console 脚本 |
| 3 | 恰好 1 个 `body > header`、1 个 `main`、1 个 `body > footer` | 1.3.1 | Console 查 `querySelectorAll` 长度 |
| 4 | 跳转链接是第一个 Tab 焦点，且聚焦时可见 | 2.4.1 / 2.4.7 | 按 1 次 Tab，看屏幕 |
| 5 | `<main>` 有 `id` 和 `tabindex="-1"`，点击跳转链接后 `document.activeElement` 是它 | 2.4.1 | Console |
| 6 | 所有 `<nav>` 已命名且名称互不相同 | 4.1.2 | Console 列出 `aria-label` |
| 7 | 所有 `<section>` 和 `<aside>` 都有可访问名称 | 4.1.2 | Console 统计带名称的比例 = 100% |
| 8 | 表格所有 `<th>` 带 `scope`（或复杂表用 `headers`/`id`） | 1.3.1 | Console 统计 |
| 9 | 所有 `<img>` 有 `alt`（装饰图为空字符串） | 1.1.1 | Console 查 `hasAttribute('alt')` |
| 10 | 键盘可到达所有可交互元素，焦点全程可见，无焦点陷阱 | 2.1.1 / 2.4.7 / 2.1.2 | 手工 Tab 走查 |
| 11 | 正文对比度 ≥4.5:1，非文本对比度 ≥3:1，亮暗两模式都查 | 1.4.3 / 1.4.11 | DevTools 颜色选择器 |
| 12 | 200% 缩放无内容丢失；320px 宽度无需二维滚动 | 1.4.4 / 1.4.10 | 手工缩放 + 设备模拟 |
| 13 | 禁用 CSS 后内容顺序完全可读 | 1.3.2 | 禁用样式后通读 |
| 14 | 没有任何「仅靠颜色」传达的信息 | 1.4.1 | 灰度模式截图对比 |

<Callout type="verified" title="参考实现对这 14 条的满足情况">

参考实现的实际验证结果（2026 年 10 月，Chrome + Nu 26.10.12）：

| 条目 | 结果 | 证据 |
| --- | --- | --- |
| 1 | 通过 | Nu 报告 0 错误 0 警告 |
| 2 | 通过 | 浏览器实测：h1×1 → h2×5 → h3×3，无跳级 |
| 3 | 通过 | 浏览器实测：各 1 个 |
| 4 | 通过 | 浏览器实测：第一个可聚焦元素文本为「跳到主要内容」 |
| 5 | 通过 | `<main id="main-content" tabindex="-1">` 存在于源码 |
| 6 | 通过 | 浏览器实测：1 个 nav，名称「主导航」 |
| 7 | 通过 | 浏览器实测：5/5 section、1/1 aside 已命名 |
| 8 | 通过 | 浏览器实测：10/10 `<th>` 带 `scope` |
| 9 | 通过 | 浏览器实测：0 个缺 `alt` 的图片（页面本身无图片） |
| 10 | 通过 | 浏览器实测：12 个可聚焦元素，0 个无名称；`aria-hidden` 内 0 个可聚焦元素 |
| 11 | 通过 | 17 组配色按公式计算全部达标（见本章开头表格） |
| 12 | **部分通过** | 320px 用约束元素宽度的近似方法验证无溢出；**200% 缩放未实测** |
| 13 | 通过 | 浏览器实测：禁用样式后文本顺序完全符合预期 |
| 14 | 通过 | 当前页链接用「加粗 + 3px 下划线 + `aria-current`」三通道；进度数字带 `+`/`-` 符号 |

第 12 条的 200% 缩放部分、以及用真实屏幕阅读器朗读整页，是**留给你做的**。方法在第 9 章第十章。

</Callout>

---

## 五、常见踩坑

按出现频率排序。每一条都来自前面章节讲过的机制，这里只列「在项目里长什么样」。

**坑 1：`<h1>` 写了两个。**
一个是站点名（「我的学习档案」），一个是页面标题（「关于这份档案」）。站点名应该用 `<p>` 或 `<div>` 加 CSS 字号，**不是 `<h1>`**。`<h1>` 是文档的主标题，一个页面只有一个。参考实现里站点名是 `<p class="site-title">`。

**坑 2：表格忘了 `<tbody>`，CSS 写 `table > tr` 不生效。**
第 7 章讲过：解析器会隐式插入 `<tbody>`。要么显式写 `<tbody>`，要么 CSS 用 `table tbody tr`。

**坑 3：`<tfoot>` 写在 `<tbody>` 前面。**
HTML5 要求 `<tfoot>` 在所有 `<tbody>` 之后。校验器会报，但浏览器不报。

**坑 4：`<section>` 里放了 `<h2>` 就以为有语义了。**
没有 `aria-labelledby` 就是 `generic`，等于 `<div>`（第 8 章）。

**坑 5：嵌套的 `<header>` 以为自己是 banner。**
`<article>` 里的 `<header>` 是 `sectionheader`，不是 landmark。这不是错误，但**不要指望它出现在 landmark 跳转列表里**（第 8 章）。

**坑 6：跳转链接用 `display: none` 隐藏。**
结果是不可聚焦，跳转链接失效。必须用「移出视口」的方式（第 8、9 章）。

**坑 7：`<main>` 放在了 `<div class="wrapper">` 里，校验器报错。**
`<main>` 的祖先只能是 `html`、`body`、`div`、无名 `form`、自定义元素。注意 `div` 是**允许**的，但 `section`/`article`/`nav`/`header`/`footer` 不允许（第 8 章）。

**坑 8：表格容器没有 `tabindex="0"`。**
键盘用户无法横向滚动（第 7 章）。

**坑 9：暗色模式直接沿用亮色的灰色次要文本。**
对比度不达标（第 9 章）。必须两套变量分别核实。

**坑 10：用 `<div onclick>` 做了「展开笔记」按钮。**
ARIA 第一规则：用 `<details>` + `<summary>`，或者 `<button>` + `aria-expanded`（第 9 章）。

**坑 11：`<address>` 里写了邮政地址或一句说明文字。**
`<address>` 是**联系方式**。参考实现刻意**没有**用 `<address>`，因为这份档案没有联系方式——这本身就是第 4 章那条规则的应用（第 4 章）。

**坑 12：相对链接在本地双击打开正常，部署后 404。**
第 5 章讲过：相对 URL 会丢掉当前路径的最后一段。本地 `file://` 和部署后的路径结构不同。解决：部署时保持目录结构一致，或者用绝对路径 + 正确的 base。

---

## 六、扩展任务（可选）

做完主线之后，按兴趣选做。每个都标注了它会让你练到什么。

**扩展 1：多页面版本。**
把「学习笔记」拆成独立页面，主页只放摘要。练习：相对链接（第 5 章）、`<nav>` 的 `aria-current`（第 8 章）、跨页面一致的 landmark 结构。

**扩展 2：两级表头表格。**
把进度表改成「计划/已完成/完成率」三组，每组再分「第一期/第二期」。练习：`colspan`、`scope="colgroup"`、`headers`/`id`（第 7 章）。

**扩展 3：响应式表格双方案。**
给进度表同时实现方案 A（横向滚动）和方案 B（卡片堆叠），用媒体查询在 640px 切换。练习：第 7 章第十一章的选型判断、`data-label` + `::before`、视觉隐藏 `thead` 的正确方式。

**扩展 4：加一个真正的表单。**
「记录一条新笔记」的表单（纯 HTML，提交到一个不存在的地址也行，重点是结构）。练习：`<label>` 关联、`fieldset`/`legend`、约束校验属性、`autocomplete`（第 6 章）。

**扩展 5：打印样式。**
让页面打印出来是一份干净的 A4 文档：隐藏导航和跳转链接、表格不横向滚动、链接显示 URL。练习：`@media print`、`a[href]::after { content: " (" attr(href) ")" }`。

**扩展 6：用 `<dialog>` 做一个「关于本页」弹窗。**
练习：原生 `<dialog>` + `showModal()` 的焦点陷阱（第 9 章）。这是这个项目里**唯一允许写 JavaScript**的扩展。

---

## 七、做完之后

HTML 领域到此完成。你的下一步是 **CSS 领域**（[CSS 领域首页](/css/)）。

为什么 CSS 是下一步而不是 JavaScript：

1. 这个项目里你已经**用到了** CSS 的很多机制（变量、媒体查询、Flexbox、`overflow`、`position`），但都是「照参考实现抄」的状态。CSS 领域会把这些机制讲透：盒模型、层叠与继承、选择器优先级、布局三件套（流式 / Flexbox / Grid）、定位与层叠上下文。
2. JavaScript 你已经有 javascript.info 的资源（[JavaScript 入口](/javascript/)），不需要本站重造。但 CSS 没有同等质量的中文系统教程，本站的 CSS 领域会补上这一块。
3. 顺序上，CSS 在 TypeScript 之前，是因为 Vue 3 的组件样式（scoped CSS、CSS 变量传参）需要 CSS 基础，而 TypeScript 不需要。

**做完这个项目后建议的复习方式**：过两周再打开你的档案页，用第 9 章的审计脚本重新跑一遍。你会发现当时觉得「显然正确」的写法，现在能看出问题——这就是进步的证据。

---

## 八、参考实现的完整源码

下面贴出参考实现的完整 HTML，方便你对照阅读。**建议先自己做第 1–3 步，再来看这份源码**——直接抄会失去大部分学习价值。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>我的学习档案 · HTML 阶段项目参考实现</title>
<meta name="description" content="HTML 领域阶段项目「语义化个人学习档案页」的参考实现，用于对照学习语义标签、文档大纲与无障碍结构。">
<link rel="stylesheet" href="style.css">
</head>
<body>

<a href="#main-content" class="skip-link">跳到主要内容</a>

<header class="site-header">
  <p class="site-title"><a href="index.html">我的学习档案</a></p>
  <nav aria-label="主导航">
    <ul role="list">
      <li><a href="index.html" aria-current="page">档案首页</a></li>
      <li><a href="#progress">学习进度</a></li>
      <li><a href="#plan">学习计划</a></li>
      <li><a href="#notes">学习笔记</a></li>
    </ul>
  </nav>
</header>

<main id="main-content" tabindex="-1">

  <article aria-labelledby="profile-title">
    <header>
      <h1 id="profile-title">关于这份档案</h1>
      <p class="meta">
        建立于 <time datetime="2026-10-16">2026 年 10 月 16 日</time>
        · 最近更新 <time datetime="2026-10-16">2026 年 10 月 16 日</time>
      </p>
    </header>

    <p>
      这是我学习全栈开发的个人档案页。它同时是 HTML 领域阶段项目的参考实现：
      整个页面只用 <abbr title="HyperText Markup Language">HTML</abbr> 和
      <abbr title="Cascading Style Sheets">CSS</abbr> 写成，没有一行 JavaScript，
      没有构建工具，没有任何依赖。
    </p>

    <p>
      把 <code>style.css</code> 的 <code>&lt;link&gt;</code> 注释掉再刷新，
      你会看到一个没有样式但<strong>顺序完全正确、内容完全可读</strong>的页面。
      这是检验语义结构是否正确的最直接方法。
    </p>

    <section aria-labelledby="goal-title">
      <h2 id="goal-title">学习目标</h2>
      <p>短期目标是能独立把一个想法做成上线可访问的产品。为此需要掌握：</p>
      <ul>
        <li>用正确的语义结构表达内容，而不是靠 <code>&lt;div&gt;</code> 堆砌</li>
        <li>用 CSS 控制呈现，让结构与样式彻底分离</li>
        <li>用 TypeScript 建立可维护的前端与后端代码</li>
        <li>把成品部署到自己的服务器上并长期维护</li>
      </ul>
    </section>

    <footer>
      <p class="meta">本条档案涉及的主题：</p>
      <ul role="list" class="tag-list">
        <li>HTML</li>
        <li>CSS</li>
        <li>学习方法</li>
      </ul>
    </footer>
  </article>

  <section id="progress" aria-labelledby="progress-title">
    <h2 id="progress-title">学习进度</h2>

    <p>
      下表记录各领域的第一期进度。<strong>计划章节</strong>是当前规划的章节数，
      会随课程建设变化，因此这里的数字仅作示例。
    </p>

    <div class="table-wrap" tabindex="0" role="region" aria-label="各领域学习进度表，可横向滚动">
      <table>
        <caption>2026 年 10 月各领域学习进度</caption>
        <colgroup>
          <col class="col-domain">
          <col span="3" class="col-num">
          <col class="col-note">
        </colgroup>
        <thead>
          <tr>
            <th scope="col">领域</th>
            <th scope="col" abbr="计划">计划章节</th>
            <th scope="col" abbr="完成">已完成</th>
            <th scope="col" abbr="完成率">完成率</th>
            <th scope="col">备注</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">HTML</th>
            <td class="num">11</td>
            <td class="num">11</td>
            <td class="num">100%</td>
            <td>含阶段项目，已完成闭环</td>
          </tr>
          <tr>
            <th scope="row">CSS</th>
            <td class="num">18</td>
            <td class="num">0</td>
            <td class="num">0%</td>
            <td>大纲已定，正文待写</td>
          </tr>
          <tr>
            <th scope="row">TypeScript</th>
            <td class="num">16</td>
            <td class="num">0</td>
            <td class="num">0%</td>
            <td>需先完成 JavaScript 外链课程</td>
          </tr>
          <tr>
            <th scope="row">Vue 3</th>
            <td class="num">12</td>
            <td class="num">0</td>
            <td class="num">0%</td>
            <td>依赖 TypeScript</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">合计</th>
            <td class="num">57</td>
            <td class="num">11</td>
            <td class="num">19%</td>
            <td>第一期共 10 个领域</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <p class="note">
      表格中「完成率」列的数字右对齐，并启用
      <code>font-variant-numeric: tabular-nums</code>，
      这样不同位数的百分比也能按位对齐比较。
    </p>
  </section>

  <section id="plan" aria-labelledby="plan-title">
    <h2 id="plan-title">学习计划</h2>

    <p>第一期的主线是「能上线」。顺序不能随意调换，因为每一步都依赖前一步：</p>

    <ol>
      <li>
        <strong>HTML</strong>
        —— 先能正确地表达内容。这一步做不扎实，后面所有布局和无障碍工作都要返工。
      </li>
      <li>
        <strong>CSS</strong>
        —— 再能控制呈现。重点是盒模型、层叠与继承、Flexbox 与 Grid。
      </li>
      <li>
        <strong>JavaScript</strong>
        —— 使用已有的 <a href="https://javascript.info/">javascript.info</a> 资源，不重造教程。
      </li>
      <li>
        <strong>TypeScript</strong>
        —— 为后续的 Vue 与 Node.js 打底，重点是类型推导与泛型。
      </li>
      <li>
        <strong>Vue 3 + Vite</strong>
        —— 前端主线框架，用组合式 API 与 <code>&lt;script setup&gt;</code>。
      </li>
      <li>
        <strong>Node.js + Fastify</strong>
        —— 后端主线，重点是请求生命周期与插件机制。
      </li>
      <li>
        <strong>SQL + PostgreSQL</strong>
        —— 数据库主线，先手写 SQL 再用 Prisma 做 ORM。
      </li>
      <li>
        <strong>Git</strong>
        —— 贯穿全程，不是单独的一步。
      </li>
      <li>
        <strong>Linux 基础</strong>
        —— 服务器操作的最小集。
      </li>
      <li>
        <strong>Docker + Nginx</strong>
        —— 把成品部署到自己的服务器上。
      </li>
    </ol>
  </section>

  <section id="notes" aria-labelledby="notes-title">
    <h2 id="notes-title">学习笔记</h2>

    <p>只记录那些「查了资料才搞明白、且以后还会再遇到」的问题。</p>

    <article aria-labelledby="note-1">
      <header>
        <h3 id="note-1">为什么 <code>&lt;p&gt;</code> 里不能放 <code>&lt;div&gt;</code></h3>
        <p class="meta"><time datetime="2026-10-16">2026 年 10 月 16 日</time></p>
      </header>
      <p>
        因为解析器在 <code>&lt;p&gt;</code> 内部遇到块级元素的开始标签时，
        会先自动闭合当前的 <code>&lt;p&gt;</code>。这不是浏览器 bug，
        而是规范里写明的容错行为。实际生成的 DOM 是
        <code>&lt;p&gt;&lt;/p&gt;&lt;div&gt;…&lt;/div&gt;</code>，
        中间那个空的 <code>&lt;p&gt;</code> 会带来意想不到的外边距。
      </p>
    </article>

    <article aria-labelledby="note-2">
      <header>
        <h3 id="note-2"><code>&lt;section&gt;</code> 不加 <code>aria-labelledby</code> 等于白写</h3>
        <p class="meta"><time datetime="2026-10-16">2026 年 10 月 16 日</time></p>
      </header>
      <p>
        按 HTML-AAM 的映射表，<code>&lt;section&gt;</code> 只有在拥有可访问名称时
        才映射为 <code>region</code> 角色，否则映射为 <code>generic</code>——
        和 <code>&lt;div&gt;</code> 在无障碍树上没有区别。
        而子元素里有个 <code>&lt;h2&gt;</code> 并<strong>不会</strong>自动给父元素名称，
        必须显式用 <code>aria-labelledby</code> 指过去。
      </p>
    </article>

    <article aria-labelledby="note-3">
      <header>
        <h3 id="note-3">相对 URL 会丢掉最后一段路径</h3>
        <p class="meta"><time datetime="2026-10-16">2026 年 10 月 16 日</time></p>
      </header>
      <p>
        当前地址是 <code>/docs/html/links.html</code> 时，
        <code>href="../css/"</code> 解析为 <code>/docs/css/</code>；
        但当前地址是 <code>/docs/html</code>（没有结尾斜杠）时，
        同样的 <code>href</code> 解析为 <code>/css/</code>——
        因为 <code>html</code> 被当作文件名丢掉了。
        这就是「本地双击打开正常，部署后 404」的常见原因。
      </p>
    </article>
  </section>

  <section id="faq" aria-labelledby="faq-title">
    <h2 id="faq-title">常见问题</h2>

    <dl>
      <dt>为什么不直接学框架？</dt>
      <dd>
        框架解决的是「组织大量交互逻辑」的问题。在只有一个静态页面时，
        框架带来的复杂度远大于收益，而且它掩盖了 HTML 与 CSS 的真实行为。
      </dd>

      <dt>进度数据存在哪里？</dt>
      <dd>
        哪都没存。这个参考实现是纯静态的两个文件，表里的数字是你自己手打进 <code>&lt;td&gt;</code> 的文本，
        页面上没有任何脚本、没有 <code>localStorage</code>、也没有后端。
        想让它自动更新就得引入脚本和数据存储，那属于 JavaScript 领域的内容，不在本章范围内；
        这一章考察的是<strong>表格结构与表头关联</strong>（第 7 章），数据从哪来不在验收标准里。
      </dd>

      <dt>这个页面能直接部署吗？</dt>
      <dd>
        可以。它是两个文件（<code>index.html</code> 与 <code>style.css</code>），
        放到任何能提供静态文件的地方都能访问，
        包括 <abbr title="Virtual Private Server">VPS</abbr> 上的 Nginx、
        局域网里的一台机顶盒，或者直接双击用浏览器打开。
      </dd>
    </dl>
  </section>

  <aside aria-labelledby="resources-title">
    <h2 id="resources-title">相关资源</h2>
    <ul>
      <li><a href="https://html.spec.whatwg.org/multipage/">HTML Standard（WHATWG）</a></li>
      <li><a href="https://developer.mozilla.org/zh-CN/docs/Web/HTML">MDN HTML 文档（中文）</a></li>
      <li><a href="https://validator.w3.org/nu/">W3C Markup Validation Service</a></li>
      <li><a href="https://www.w3.org/TR/WCAG22/">WCAG 2.2</a></li>
    </ul>
  </aside>

</main>

<footer class="site-footer">
  <p>
    这是一份纯静态的个人学习档案，没有服务器、没有数据库、没有账号系统。
    所有内容都由我自己维护，发现写错的地方就直接改文件。
  </p>
  <p><small>HTML 领域阶段项目参考实现 · 最后更新于 <time datetime="2026-10-16">2026 年 10 月</time></small></p>
</footer>

</body>
</html>
```

`style.css` 的完整内容较长（约 300 行），不在这里重复贴出。请直接打开 `/examples/html-archive/style.css` 阅读——文件里有逐段注释，解释了每条规则对应哪个无障碍准则或哪个章节的知识点。

---

## 九、官方文档与延伸阅读

- [W3C Markup Validation Service (Nu Html Checker)](https://validator.w3.org/nu/)：本项目的验收工具
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)：验收标准里所有 SC 编号的来源
- [HTML Standard](https://html.spec.whatwg.org/multipage/)：遇到「到底允不允许这么写」时的最终裁决
- [MDN HTML（中文）](https://developer.mozilla.org/zh-CN/docs/Web/HTML)：日常查阅
- [W3C WAI Tutorials](https://www.w3.org/WAI/tutorials/)：表格、图片、表单的无障碍教程
- [javascript.info](https://javascript.info/)：完成本项目后的 JavaScript 学习资源（本站不重造）

---

HTML 领域到此全部完成：**9 章知识 + 1 个阶段项目 + 1 份经过真实验证的参考实现**。

下一章进入 [CSS 领域](/css/)。
