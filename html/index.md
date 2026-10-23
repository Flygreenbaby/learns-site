# HTML · 领域首页

<StatusBadge state="ready" note="9 章正文 + 1 个阶段项目，可连续学习" />

## 这个领域解决什么问题

HTML 常被误认为是「最简单的技术，看一遍就会」。实际情况是：**绝大多数前端的疑难问题，根源都在 HTML 结构写错了。**

具体表现为：

- CSS 布局怎么调都不对 —— 因为该用 `<ul>` 的地方写了一堆 `<div>`，导致没有天然的列表结构可以排布。
- 移动端点击按钮没反应 —— 因为用的是 `<div onclick>` 而不是 `<button>`，键盘和读屏软件都访问不到它。
- 表单提交后浏览器不记住密码、输入法不弹邮箱键盘 —— 因为没用对 `<input type>` 和 `<label for>`。
- SEO 效果差、页面在无障碍检测里一片红 —— 因为标题层级从 `h1` 直接跳到 `h4`，图片全都没有 `alt`。
- 引入 Vue / React 之后组件拆得一团乱 —— 因为你不知道该把哪一块 HTML 划为一个组件的边界。

HTML 的难点不在标签数量，而在**语义**：同一个视觉效果可以用十种标签实现，但只有一种能同时被浏览器、搜索引擎、读屏软件、密码管理器、翻译插件正确理解。这个领域要教会你的就是这件事。

## 前置知识

**无。** 这是全站唯一没有任何前置依赖的领域，也是整条学习路线的第一步。

你需要的只有一个文本编辑器（推荐 VS Code）和一个现代浏览器（Chrome / Edge / Firefox）。不需要 Node.js，不需要任何构建工具——本领域的全部示例都可以保存成 `.html` 文件后双击在浏览器中打开。

## 章节目录

| 章节 | 内容 | 学完能做什么 |
| --- | --- | --- |
| [1. HTML 是什么](/html/what-is-html) | 标记语言的本质、文档树、浏览器的解析与容错机制、为什么 HTML 不是编程语言 | 看懂任何页面的结构，理解浏览器为什么"没报错但显示不对" |
| [2. 文档骨架](/html/document-structure) | `<!DOCTYPE>`、`<html lang>`、`<head>` 元数据、字符编码、viewport、语义化元标签 | 从零写出一个不会踩编码/缩放/SEO 坑的页面骨架 |
| [3. 文本语义](/html/text-semantics) | 标题层级、段落、列表、强调与引用、时间与代码、`<div>`/`<span>` 的正确用法 | 写出一篇文章类页面，读屏软件能正确朗读出结构 |
| [4. 链接与导航](/html/links) | `href` 与 URL 类型、相对路径解析规则、`rel` 系列、`target`、锚点、下载 | 正确处理站内/站外链接，避开 `rel="noopener"` 这类安全隐患 |
| [5. 图片与多媒体](/html/images-media) | `img` 与 `srcset`/`sizes`、`picture` 与 `source`、格式选择、懒加载、`figure`、`audio`/`video` | 让图片在不同屏幕上都不糊也不浪费流量 |
| [6. 表单](/html/forms) | 表单控件全景、`label` 关联、`name`/`value` 与提交数据形状、原生校验、`fieldset` | 写出浏览器和读屏软件都能正确处理的表单 |
| [7. 表格](/html/tables) | `table` 结构、`caption`、`thead`/`tbody`/`tfoot`、`colspan`/`rowspan`、`scope` | 知道什么数据该用表格、什么绝对不该用表格布局 |
| [8. 语义化布局](/html/layout-semantics) | `header`/`nav`/`main`/`section`/`article`/`aside`/`footer`、文档大纲、`section` vs `div` | 用正确的地标元素划分页面，为组件化打好边界 |
| [9. HTML 层面的无障碍](/html/accessibility) | `alt` 的四种情形、`label` 关联、键盘可达性、ARIA 的边界、何时不该用 ARIA | 通过基础的无障碍检查，不再需要用 ARIA 补救错误的 HTML |
| [10. 阶段项目](/html/project) | 从零构建一个语义化的「个人学习档案页」 | 把前 9 章串成一个完整的、可通过校验的页面 |

## 学习顺序建议

**严格按 1 → 10 的顺序学。** 第 3 章的文本语义是第 8 章布局语义的基础，第 6 章表单依赖第 3 章的 `label` 知识，第 9 章无障碍是前面所有章节的横向总结。

第 1 章看起来最"虚"（讲解析原理），但它是理解后面所有"为什么浏览器表现和我预期不一样"的钥匙，不要跳过。

## 学习方法

每章末尾都有练习，答案与解析默认折叠。请先自己写代码再展开对照。

**判断是否真的学会的标准**：合上答案，你能从零写出同样的结构，并且能解释每一个标签为什么选它而不是别的。如果做不到，回去重读那一章。

本领域的示例不需要任何工具链：新建一个 `test.html`，把代码粘进去，用浏览器打开即可。按 `F12` 打开开发者工具，在 **Elements（元素）** 面板里能看到浏览器实际构建出的文档树——这是本领域最重要的调试工具，第 1 章会详细讲。

## 阶段项目

**语义化个人学习档案页**：一个单页面，包含个人介绍、正在学习的领域清单、每个领域的进度表格、联系方式表单。要求：

- 全部使用语义化标签，不使用无意义的 `<div>` 包裹
- 标题层级严格递进，不跳级
- 通过 [W3C Markup Validation Service](https://validator.w3.org/) 校验，零错误
- 在浏览器禁用 CSS 的情况下，内容依然按正确顺序可读（这是检验语义化的硬标准）
- 用键盘能完整操作页面中的所有交互元素

详见[第 10 章](/html/project)。

## 官方文档与延伸阅读

本站所有内容均为中文原创讲解，以下官方资料用于查证与深入：

- [WHATWG HTML 标准（现行唯一权威规范）](https://html.spec.whatwg.org/multipage/) —— HTML 的活标准。注意 W3C 已于 2021 年停止维护 HTML 标准，转由 WHATWG 维护，网上很多"W3C HTML5 规范"的链接已过期。
- [MDN HTML 文档（中文）](https://developer.mozilla.org/zh-CN/docs/Web/HTML) —— 最实用的参考手册，每个元素都有示例和兼容性表。
- [MDN HTML 元素参考索引](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements) —— 按元素查属性的入口。
- [MDN · HTML 基础语法](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Core/Structuring_content/Basic_HTML_syntax) —— 如果你觉得本站节奏偏快，可以先看这个。
- [W3C Markup Validation Service](https://validator.w3.org/) —— 在线校验 HTML 是否合法，阶段项目必用。
- [WHATWG HTML 标准 · 语义化章节](https://html.spec.whatwg.org/multipage/semantics.html) —— 想知道"某个标签到底该在什么场景用"时的最终答案来源。

## 版本说明

本领域内容基于 **WHATWG HTML 现行标准**（Living Standard，无版本号）编写，核实时间为 2026 年 10 月。HTML 的既有特性极少被移除（向后兼容是硬约束），因此本领域内容的时效性风险远低于框架类内容。

需要注意的是**浏览器支持度**会变化。凡是涉及较新特性（如 `<dialog>` 的 `popover` 关联、`loading="lazy"` 的原生支持范围），文中会单独标注，请以 [MDN 对应页面的浏览器兼容性表](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements) 为准。
