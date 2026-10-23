# HTML 层面的无障碍

前面九章零散提到过很多次「屏幕阅读器会怎样」「键盘用户会怎样」。这一章把这些内容系统化，并且回答一个更根本的问题：**HTML 在无障碍这件事上到底替你做了什么。**

答案比大多数人以为的多得多。这也是本章最重要的一条原则：

<Callout type="verified" title="ARIA 第一规则">

W3C 的 ARIA 作者实践指南里有一条被称为「第一规则」（First Rule of ARIA）的原则，大意是：

> **如果有原生 HTML 元素或属性能实现你要的语义和行为，就用它，不要用 ARIA。**

原因很实际：一个原生 `<button>` 免费给你带来角色、焦点、键盘激活、可读名称四件事；一个 `<div role="button" tabindex="0">` 只给你带来角色，剩下三件你全得自己用 JavaScript 实现，而且**很容易实现得不完整**。

ARIA 的键盘实践文档写得更直接：「Unlike native HTML form elements, browsers do not provide keyboard support for graphical user interface (GUI) components that are made accessible with ARIA.」——浏览器**不会**为用 ARIA 描述的组件提供任何键盘支持，全部要你自己写。

所以：这一章教你怎么把 HTML 用对，而不是教你 ARIA。ARIA 只在原生 HTML 表达不了的时候（自定义控件、动态状态）才登场，而且是最后手段。

</Callout>

---

## 一、WCAG 2.2：标准的四个原则

网页无障碍的事实标准是 **WCAG（Web Content Accessibility Guidelines）**，由 W3C 的 Accessibility Guidelines Working Group 维护。当前版本是 **WCAG 2.2**（2023 年 10 月成为 W3C Recommendation）。

WCAG 用 **POUR** 四原则组织所有要求：

| 原则 | 英文 | 含义 | 典型成功准则 |
| --- | --- | --- | --- |
| **可感知** | Perceivable | 用户能感知到内容（不能对某一感官完全不可见） | 1.1.1 非文本内容、1.4.3 对比度、1.4.4 文本缩放 |
| **可操作** | Operable | 用户能操作界面（不能只有鼠标能点） | 2.1.1 键盘、2.4.1 绕过区块、2.4.7 焦点可见 |
| **可理解** | Understandable | 内容和操作可被理解 | 3.1.1 页面语言、3.3.1 错误识别、3.3.2 标签或说明 |
| **健壮** | Robust | 内容能被各种用户代理（含辅助技术）可靠解析 | 4.1.2 名称、角色、值 |

每条要求叫一个「成功准则」（Success Criterion，SC），分三个等级：**A**（最低，必须满足）、**AA**（绝大多数法规和商业要求的实际标准）、**AAA**（最高，通常不作为强制要求，因为有些内容无法完全满足）。

对个人项目，**目标定在 AA** 是合理的。

### 1.1 WCAG 2.2 相对 2.1 的变化

这一点值得单独说，因为很多教程还停留在 2.0/2.1。从 WCAG 2.2 规范的目录可以直接读到：

**新增的成功准则（2.2 才有）：**

| 编号 | 名称 | 等级 | 和你相关的部分 |
| --- | --- | --- | --- |
| 2.4.11 | Focus Not Obscured (Minimum) | AA | 焦点元素不能被完全遮住 |
| 2.4.12 | Focus Not Obscured (Enhanced) | AAA | 焦点元素不能被任何部分遮住 |
| 2.4.13 | Focus Appearance | AAA | 焦点指示器的大小和对比度要求 |
| 2.5.7 | Dragging Movements | AA | 拖拽操作必须有非拖拽的替代方式 |
| 2.5.8 | Target Size (Minimum) | AA | 可点击目标至少 24×24 CSS 像素 |
| 3.2.6 | Consistent Help | A | 帮助入口在各页面位置一致 |
| 3.3.7 | Redundant Entry | A | 同一流程中不要求重复输入已填信息 |
| 3.3.8 | Accessible Authentication (Minimum) | AA | 登录不能依赖认知功能测试（如记忆、拼图） |
| 3.3.9 | Accessible Authentication (Enhanced) | AAA | 同上，更严格 |

**移除的成功准则：**

> WCAG 2.2 has removed one success criterion, **4.1.1 Parsing**.

这是一个有意思的变化。4.1.1 要求「元素有完整的开始和结束标签、正确嵌套、无重复属性、ID 唯一」——本质上就是「HTML 要能通过校验」。**它被移除了**，理由是这条准则在实际执行中问题太多（浏览器的容错解析使得「标签不闭合」和「用户实际遇到的问题」之间没有可靠关联），而且 HTML 规范本身已经不再要求严格的 XML 式良构性（第 1 章讲过）。

<Callout type="info" title="这不代表「HTML 写错也没关系」">

4.1.1 被移除，只是说它不再是一条独立的 WCAG 成功准则。HTML 结构错误依然会通过 **4.1.2 名称、角色、值**（要求元素的角色、名称、状态能被程序确定）间接影响无障碍——比如你用 `<td>` 当表头，屏幕阅读器就拿不到表头信息，这就违反了 4.1.2。

而且校验器仍然是你**发现自己写错了**的最有效工具（第 7 章讲表格时的槽位错位、第 8 章讲 `<main>` 的祖先限制，都是校验器能直接报出来的）。所以阶段项目的验收标准里仍然保留「W3C 校验器零错误」。

</Callout>

---

## 二、原生 HTML 免费给你的五件事

这是理解全章的基础。当你写 `<button>提交</button>` 时，浏览器替你做了：

| # | 能力 | 具体表现 | 换成 `<div>` 后你需要自己做什么 |
| --- | --- | --- | --- |
| 1 | **角色（role）** | 辅助技术宣告「按钮」 | `role="button"`（这个还算简单） |
| 2 | **可聚焦（focusable）** | 出现在 Tab 序列中 | `tabindex="0"` |
| 3 | **键盘激活** | `Space` 和 `Enter` 都能触发 | 监听 `keydown`，分别处理两个键，还要处理 `Space` 的 `preventDefault()`（否则页面滚动） |
| 4 | **可读名称** | 从内部文本自动计算 | 文本存在时自动；但如果名称来自图标或 CSS `content`，需要 `aria-label` |
| 5 | **状态与样式钩子** | `:hover`、`:active`、`:focus`、`:disabled`、`:focus-visible` 全部可用；`disabled` 属性还自动移出 Tab 序列 | 自己维护 class，自己处理禁用态的焦点问题 |

同样的表适用于 `<a href>`、`<input>`、`<label>`、`<th scope>`、`<nav>`、`<main>` 等所有原生元素。

### 2.1 `<a>` 和 `<button>` 的键盘差异

第 4 章讲过「链接还是按钮」的语义判断，这里补上**键盘行为**的差异，这是选择时的第二个决定性因素：

| 元素 | `Enter` | `Space` |
| --- | --- | --- |
| `<a href>` | 激活（跳转） | **滚动页面**（不激活链接） |
| `<button>` | 激活 | 激活（按下时触发，松开时执行 click） |

所以当你用 `<div role="button">` 自制按钮时，如果只监听了 `Enter`，习惯用 `Space` 的用户会发现按钮「坏了」。这是自制控件最常见的缺陷之一。

<Callout type="warn" title="focus-visible 与 focus 伪类的区别">

现代浏览器支持 `:focus-visible`，它只在「焦点应当被视觉指示」时匹配（键盘导航时匹配，鼠标点击后通常不匹配）。

`:focus` 则在任何获得焦点时都匹配。

用 `:focus-visible` 可以让你在鼠标操作时不显示难看的焦点框，同时保留键盘操作时的焦点框——**这是唯一可以接受地「去掉焦点框」的方式**。

```css
/* 错误：直接去掉所有焦点样式 */
a:focus { outline: none; }

/* 正确：只在键盘焦点时强化，鼠标焦点时保持浏览器默认或弱化 */
a:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
```

MDN 的 [`:focus-visible`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/:focus-visible) 页面有各浏览器的支持情况，实现前请核实——这个伪类的支持是近几年才补齐的。

</Callout>

---

## 三、键盘可操作性

WCAG 2.1.1（Keyboard，等级 A）要求：所有功能都能通过键盘操作完成，不需要特定的按键时序。2.1.2（No Keyboard Trap）要求：焦点不能被卡住。

### 3.1 `tabindex` 的三个取值

| 值 | 效果 | 什么时候用 |
| --- | --- | --- |
| **不写** | 原生可交互元素（`a[href]`、`button`、`input`、`select`、`textarea`、`summary`）默认在 Tab 序列中，顺序 = DOM 顺序 | 绝大多数情况 |
| `tabindex="0"` | 让**非交互元素**加入 Tab 序列，位置由 DOM 顺序决定 | 自制可交互元素；可滚动容器（第 7 章表格横向滚动就是这么用的） |
| `tabindex="-1"` | **移出** Tab 序列，但仍可通过 `element.focus()` 程序化聚焦 | `<main>` 的跳转目标；模态框容器；需要程序化移动焦点的元素 |
| `tabindex="1"` 及以上 | 强制排到 Tab 序列最前面 | **不要用** |

关于正值，W3C 的 ARIA 作者实践指南写得很明确：正值会强制指定 Tab 顺序，而「Authors are strongly advised NOT to use these values」（强烈建议作者不要使用这些值）。

原因是：Tab 顺序应该跟随 DOM 顺序，而 DOM 顺序应该跟随视觉顺序。一旦你写了 `tabindex="1"`，你就在维护**两套顺序**，任何一次 DOM 重构都会让它们失配。用户按 Tab 会跳到页面另一个角落，完全无法预测。这直接违反 WCAG 2.4.3（Focus Order，要求焦点顺序保持含义和可操作性）。

<Callout type="danger" title="关于焦点顺序的常见错误">

用 CSS（`flex-direction: row-reverse`、`order`、绝对定位、Grid 的 `grid-area`）改变视觉顺序，但**不改变 DOM 顺序**，会导致 Tab 顺序和视觉顺序不一致。

比如「上一页 / 下一页」按钮组，用 `flex-direction: row-reverse` 让它们视觉上变成「下一页 上一页」，Tab 时却还是先「上一页」。

正确做法：**DOM 顺序就是视觉顺序**，需要调整视觉时用 Grid 的显式定位或改 HTML 顺序，而不是靠 `order` 反转。

WCAG 1.3.2（Meaningful Sequence）和 2.4.3（Focus Order）都管这件事。自查方法：只看 HTML 源码，把内容按顺序读一遍，如果读不通，顺序就是错的（第 3 章讲 `<div>` 时提过这个「禁用 CSS 测试」，同样适用于顺序）。

</Callout>

### 3.2 焦点指示器不能去掉

WCAG 2.4.7（Focus Visible，等级 AA）要求：任何键盘可操作的界面，焦点指示器必须可见。

```css
/* 这是无障碍缺陷。很多「美化教程」会这么教，是错的 */
*:focus { outline: none; }
button:focus { outline: 0; }
```

W3C 的建议是「Authors are advised to rely on the default focus indicators provided by browsers」——依赖浏览器默认的焦点指示器。默认样式不美观是设计问题，不是「去掉它」的理由。

如果一定要自定义，必须**替换而不是移除**：

```css
/* 先移除默认的，再提供自己的 —— 必须成对出现 */
button:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(62, 99, 221, 0.5);
}

/* 或者更好：保留 outline，只是改颜色 */
button:focus-visible {
  outline: 3px solid #3e63dd;
  outline-offset: 2px;
}
```

**自查方法**：把页面所有 CSS 关掉（或用「禁用样式」的浏览器扩展），按 Tab，看焦点框还在不在。或者更直接：**把鼠标放到一边，只用 Tab 键把整个页面走一遍**。这是成本最低、收益最高的无障碍测试，任何人都能做，不需要任何工具。

### 3.3 焦点陷阱（模态框）

一个对话框打开时，焦点应该被限制在对话框内部（Tab 循环不出对话框），关闭时应该返回到打开它的元素。这叫焦点陷阱（focus trap）。

**好消息：HTML 原生提供了这个能力。** `<dialog>` 元素配合 `showModal()` 方法，浏览器会自动处理：

```html
<dialog id="confirm-dialog" aria-labelledby="dlg-title">
  <h2 id="dlg-title">确认删除</h2>
  <p>这个操作无法撤销。</p>
  <form method="dialog">
    <button type="button" value="cancel">取消</button>
    <button type="submit" value="confirm">删除</button>
  </form>
</dialog>
```

```js
const dlg = document.getElementById('confirm-dialog')
dlg.showModal()          // 打开：自动聚焦、自动焦点陷阱、自动 Esc 关闭、自动 inert 背景
// dlg.close('confirm')  // 关闭：可通过 dlg.returnValue 拿到 close() 的参数
```

`showModal()` 免费提供的行为：焦点自动移入对话框、Tab 循环被限制在内部、背景内容对辅助技术不可见、按 `Esc` 触发 `cancel` 事件。这些如果自己用 `<div>` + JS 实现，至少要写几十行且容易出错。

<Callout type="info" title="dialog 元素的浏览器支持请核实">

`<dialog>` 元素和 `showModal()` 方法在近几年才在所有主流浏览器中完整支持（包括 `::backdrop` 伪元素、非模态 `show()` 与模态 `showModal()` 的区别、`returnValue`、`::backdrop` 的样式控制等细节）。MDN 的 [`<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog) 页面有完整的兼容性表格，实施前请核实你的目标浏览器。

**如果 `<dialog>` 不可用**，W3C 的 ARIA 作者实践指南提供了 [Dialog (Modal) 模式](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)的完整实现要求：`role="dialog"`、`aria-modal="true"`、`aria-labelledby` 指向标题、手动实现焦点陷阱和 Esc 关闭。这是「原生 HTML 做不到时才用 ARIA」的典型例子。

</Callout>

---

## 四、名称、角色、值（WCAG 4.1.2）

SC 4.1.2（Name, Role, Value，等级 A）要求：所有用户界面组件的**名称**和**角色**能被程序确定，**状态**能被程序确定，且状态变化能通知到用户代理。

这是最抽象但最根本的一条。拆开看：

| 概念 | 是什么 | HTML 怎么提供 |
| --- | --- | --- |
| **角色** | 这个东西是什么 | 元素本身（`<button>` → button role，`<nav>` → navigation role） |
| **名称** | 它叫什么 | 可访问名称计算（见下） |
| **值** | 它当前的内容/选择 | 原生控件自动提供（`<input>` 的 value、`<select>` 的选中项） |
| **状态** | 展开/折叠、按下/未按下、当前页、禁用、必填、无效 | `disabled`、`aria-expanded`、`aria-pressed`、`aria-current`、`aria-invalid`、`aria-required` |

### 4.1 可访问名称从哪来

「可访问名称」（accessible name）是屏幕阅读器念出来的那个名字。它的计算有一套明确的优先级规则（来自 Accessible Name and Description Computation 规范）。对常见元素，实践顺序是：

**`<button>`、`<a>`、`<h1>`–`<h6>`、`<option>`：**

1. `aria-labelledby` 引用的元素文本（最高优先）
2. `aria-label` 的值
3. 元素内部的文本内容
4. `title` 属性（最不推荐）

**`<input>`、`<select>`、`<textarea>`：**

1. `aria-labelledby`
2. `<label for>` 关联的标签文本（**这是标准做法**）
3. `aria-label`
4. 包裹它的 `<label>` 的文本
5. `title`
6. `placeholder`（**最不可靠**，第 6 章讲过为什么不推荐）

```html
<!-- 好：名称来自 label -->
<label for="email">电子邮箱</label>
<input id="email" type="email" name="email" required />

<!-- 可以：图标按钮没有可见文本，必须给 aria-label -->
<button type="button" aria-label="关闭对话框">
  <svg aria-hidden="true" width="16" height="16"><use href="#icon-close" /></svg>
</button>

<!-- 坏：屏幕阅读器只会念「按钮」 -->
<button type="button">
  <svg width="16" height="16"><use href="#icon-close" /></svg>
</button>
```

注意上面图标按钮里 SVG 的 `aria-hidden="true"`。这是必要的：SVG 内部的 `<title>`、`<desc>` 或者装饰性路径会干扰名称计算。第 5 章讲 SVG 内联时提过这个技巧。

<Callout type="warn" title="aria-label 会覆盖可见文本，可能造成不一致">

```html
<!-- 危险：屏幕阅读器念「提交表单」，视力正常的人看到「确定」 -->
<button aria-label="提交表单">确定</button>
```

WCAG 2.5.3（Label in Name，等级 A）要求：**可访问名称必须包含可见的标签文本**。原因是语音控制用户会说「点击 确定」，如果程序名是「提交表单」，指令就不生效。

所以：有可见文本时，**不要写 `aria-label`**。要让屏幕阅读器念得更清楚，用 `aria-labelledby` 组合多个元素，或者干脆把可见文本写好。

只有元素**完全没有可见文本**（纯图标按钮）时，才用 `aria-label`。

</Callout>

---

## 五、可感知：对比度、颜色、缩放

### 5.1 文本对比度（SC 1.4.3）

WCAG 2.2 的最低要求（等级 AA）：

| 文本 | 对比度要求 |
| --- | --- |
| 普通文本 | **≥ 4.5:1** |
| 大号文本（≥18pt / 24px，或 ≥14pt / 18.66px 且加粗） | **≥ 3:1** |
| 纯装饰性文本、禁用控件、日志中的 incidental 文本 | 无要求 |

AAA 等级要求更严：普通文本 7:1，大号文本 4.5:1。

**非文本对比度（SC 1.4.11，AA）**：界面组件的视觉信息（输入框边框、按钮边框）和图形对象，对比度 **≥ 3:1**。这一条经常被忽略——浅灰色的输入框边框（比如 `#e5e7eb` on `#ffffff`，对比度约 1.3:1）虽然好看，但对低视力用户来说根本看不见输入框在哪。

**怎么检查**：WebAIM 的 [Contrast Checker](https://webaim.org/articles/contrast/) 可以在线算两个颜色的对比度，还会告诉你 AA / AAA 是否通过。浏览器 DevTools 也能查（Chrome / Edge / Firefox 的颜色选择器都内置对比度计算）。

<Callout type="warn" title="暗色模式不是「反色」那么简单">

本站支持暗色模式。暗色模式下对比度**必须重新检查**，不能沿用亮色模式的配色。

一个常见错误：亮色模式下用 `#666` 的次要文本（在白底上对比度 5.7:1，通过 AA），暗色模式直接沿用 `#666`（在 `#1a1a1a` 底上对比度约 2.9:1，**不通过**）。

VitePress 用 CSS 变量（`--vp-c-text-2` 等）管理这套映射，切换主题时变量值整体替换。你写自定义样式时，**永远用变量而不是硬编码颜色**，这是暗色模式对比度合格的前提。CSS 领域的「设计令牌」一章会展开这一点。

</Callout>

### 5.2 不能只靠颜色传达信息（SC 1.4.1）

经典反例：

```html
<!-- 错误：只靠颜色区分 -->
<p><span class="error">密码不正确</span></p>
<p><span class="success">保存成功</span></p>
```

红绿色盲（最常见的色觉障碍类型）无法区分红色和绿色。这条准则要求：**颜色不能作为唯一的视觉手段**来传达信息、指示动作、要求响应或区分元素。

修正：

```html
<!-- 正确：颜色 + 图标 + 文本 -->
<p class="msg msg-error">
  <svg aria-hidden="true" class="icon"><use href="#icon-error" /></svg>
  <strong>错误：</strong>密码不正确
</p>
<p class="msg msg-success">
  <svg aria-hidden="true" class="icon"><use href="#icon-check" /></svg>
  <strong>成功：</strong>已保存
</p>
```

同样的问题出现在：

- **表格里的涨/跌**：只用红绿区分 → 加上 `▲`/`▼` 或 `+`/`-`（第 7 章的销售额表格里，「同比增长」列就写了 `+18%`，符号本身就是冗余信息）
- **必填字段**：只用红色星号 → 星号 + `aria-required="true"` 或 `required` 属性 + 文字说明「带 * 的为必填项」
- **图表**：只用颜色区分数据系列 → 加上不同的线型/图案，或直接标注
- **当前导航项**：只用高亮色 → 加 `aria-current="page"`（第 8 章讲过）

### 5.3 文本缩放与回流

**SC 1.4.4（Resize Text，AA）**：文本必须能被放大到 **200%** 而不丢失内容或功能。

这意味着**不要把所有尺寸都写死成 `px`**。用相对单位：

```css
html { font-size: 100%; }        /* 尊重用户的浏览器字号设置 */
body { font-size: 1rem; }        /* 16px 基准，随用户设置缩放 */
p { line-height: 1.75; }         /* 无单位，相对于自身字号 */
h2 { font-size: 1.5rem; }
.card { padding: 1rem 1.5rem; }
```

本站的 `style.css` 里，正文相关尺寸用的都是 `rem`，这是刻意的。

第 2 章讲 `<meta name="viewport">` 时说过：**不要写 `user-scalable=no` 或 `maximum-scale=1`**。那会阻止用户缩放，直接违反 1.4.4。WCAG 2.2 把这条讲得更明确，而且 iOS Safari 10 以后本来就会忽略 `user-scalable=no`。

**SC 1.4.10（Reflow，AA，WCAG 2.1 新增）**：在 **320 CSS 像素**宽度下，内容必须能正常显示，不需要二维滚动（即不能同时横向和纵向滚动）。

320px 是 iPhone SE 一类的窄屏宽度。这条准则的实际含义是：**你的响应式布局必须在 320px 下工作**，不能只测 375px。第 7 章讲响应式表格时的方案选择，判断标准就是这条。

例外：需要二维布局的内容（如地图、数据表格、需要保持行列关系的图表）可以不满足，但要提供替代访问方式。

**自查方法**：DevTools → 设备模拟 → 宽度设 320px，看有没有横向滚动条、有没有内容被截断。

---

## 六、表单无障碍

第 6 章已经讲了大部分（`<label>` 关联、`placeholder` 不能替代 `label`、`fieldset`/`legend`、`autocomplete`、`inputmode`）。这里补充错误提示的部分。

### 6.1 错误提示的三条准则

| SC | 等级 | 要求 |
| --- | --- | --- |
| 3.3.1 Error Identification | A | 检测到输入错误时，**用文本**指出出错的项目和错误原因 |
| 3.3.2 Labels or Instructions | A | 需要用户输入时，提供标签或说明 |
| 3.3.3 Error Suggestion | AA | 如果知道怎么修正，**提供修正建议** |

「用文本」是关键：**不能只把输入框边框变红**。色觉障碍用户看不到，屏幕阅读器用户更收不到任何信息。

第 6 章给过这个结构：

```html
<p>
  <label for="email">电子邮箱 <span aria-hidden="true">*</span></label>
  <input
    id="email"
    type="email"
    name="email"
    required
    aria-required="true"
    aria-describedby="email-hint email-error"
    aria-invalid="true"
  />
  <span id="email-hint" class="hint">我们不会分享你的邮箱</span>
  <span id="email-error" class="error" role="alert">
    邮箱格式不正确。请检查是否缺少 @ 或域名，例如 name@example.com
  </span>
</p>
```

三个属性的分工：

| 属性 | 作用 | 什么时候设置 |
| --- | --- | --- |
| `aria-describedby` | 关联说明文本和错误文本，聚焦输入框时会被读出 | 一直存在（指向 hint；error 元素可以动态创建或切换 `hidden`） |
| `aria-invalid="true"` | 标记当前值无效 | 检测到错误时设置，**修正后必须清除**（设回 `"false"` 或移除属性） |
| `role="alert"` | 让错误信息**立即**被屏幕阅读器打断播报 | 动态显示错误时 |

<Callout type="danger" title="aria-invalid 忘记清除是最常见的 bug">

和第 6 章讲 `setCustomValidity` 的陷阱完全同构：你在检测到错误时设了 `aria-invalid="true"`，用户改正后你**忘了**改回来。结果是屏幕阅读器一直宣告「无效」，用户会以为自己的修正没生效，反复尝试。

**规则**：设置和清除必须成对出现在代码里。搜索你的代码库，每一个 `aria-invalid = 'true'` 都应该能找到对应的清除逻辑。

</Callout>

`role="alert"` 是 `aria-live="assertive"` + `aria-atomic="true"` 的快捷写法，它会让屏幕阅读器**立即打断当前播报**来念这条消息。错误提示适合用它；一般的状态更新（「已保存」）用 `aria-live="polite"` 更合适，不打断用户。

### 6.2 登录与认知负担（SC 3.3.8）

WCAG 2.2 新增的 3.3.8（Accessible Authentication，AA）禁止登录流程依赖**认知功能测试**，除非有替代方式。具体包括：

- 记忆任意字符串（所以不能要求用户记住验证码）
- 复制粘贴之外的转录（所以图形验证码不合规，除非提供音频替代）
- 解谜（滑块拼图、「点击所有包含红绿灯的图片」）
- 计算（「请输入 3 + 5 的结果」）

允许的方式：粘贴（paste）、密码管理器的自动填充、WebAuthn / 通行密钥（passkey）、以及**正确使用 `autocomplete` 的原生密码字段**。

这解释了第 6 章为什么强调 `autocomplete="username"` / `autocomplete="current-password"`：**它不只是便利性优化，是 WCAG 2.2 AA 的合规要求之一**。密码管理器能自动填充，用户就不需要记忆和转录。

<Callout type="info" title="对个人学习站点的实际含义">

本站没有登录功能（无账号、无后端），所以这条准则当前用不上。但如果你以后给自己的项目加登录功能，这是必须知道的约束——而且 `autocomplete` 那套写法从第一天就该写对，比事后补救容易得多。

</Callout>

---

## 七、状态与动态内容

这是纯 HTML 表达不了、必须用 ARIA 的领域——**因为 HTML 没有「已展开」「已按下」这类原生状态属性**（少数例外如 `<details open>`）。

| ARIA 属性 | 用途 | 配对的 HTML | 本站哪里用了 |
| --- | --- | --- | --- |
| `aria-expanded="true/false"` | 折叠面板、下拉菜单、树节点的展开状态 | `<button>` + `aria-controls` | 练习组件（Exercise.vue） |
| `aria-pressed="true/false"` | 切换按钮（toggle）的按下状态 | `<button>` | 本站当前未使用；你自己项目里的收藏、静音、主题开关用它 |
| `aria-current="page/step/true"` | 当前项（导航、分页、步骤条） | `<a>` 或 `<li>` | 章节导航 |
| `aria-sort="ascending/none"` | 表格列的排序状态 | `<th>` | 第 7 章讲过 |
| `aria-live="polite/assertive"` | 动态内容变化的播报 | 任意容器 | 错误提示用 `role="alert"` |
| `aria-hidden="true"` | 对辅助技术隐藏（装饰性图标、重复信息） | 任意元素 | 图标 SVG、`○`/`✓` 符号 |
| `aria-controls` | 声明这个控件操作哪个元素 | `<button>` | 折叠面板 |

### 7.1 本站练习组件的实现

本站每章末尾的练习题用了一个可折叠的答案组件。它的无障碍实现（`.vitepress/theme/components/Exercise.vue`）是这样的：

```html
<button
  type="button"
  :aria-expanded="expanded"
  :aria-controls="panelId"
  @click="expanded = !expanded"
>
  <span aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span>
  查看答案解析
</button>

<div :id="panelId" v-show="expanded" role="region" :aria-label="title + ' 的答案解析'">
  <slot name="answer" />
</div>
```

要点：

- **用原生 `<button>`**，不是 `<div @click>`。免费获得角色、焦点、`Space`/`Enter` 双键激活（第二章的表格）
- **`aria-expanded` 绑定到真实状态**，不是写死。屏幕阅读器会念「查看答案解析，已折叠，按钮」/「已展开，按钮」
- **`▾`/`▸` 符号加 `aria-hidden="true"`**。这些字符对屏幕阅读器毫无意义（会念成「下三角」或直接跳过），而展开状态已经由 `aria-expanded` 表达了，重复播报只会增加噪音
- **`aria-controls` 指向面板**，让用户知道这个按钮操作的是哪块内容
- **用 `v-show` 而不是 `v-if`**。`v-if` 会把元素从 DOM 里移除，`aria-controls` 就指向了一个不存在的 ID；`v-show` 只是设 `display: none`，ID 关联仍然有效（虽然 `display: none` 的内容本身不会被读到，这正是折叠的效果）

<Callout type="info" title="为什么不用 details 与 summary 元素">

HTML 原生的 `<details>` + `<summary>` 元素能做到同样的折叠效果，而且**完全免费**——浏览器自动处理展开状态、键盘操作、屏幕阅读器宣告（`<summary>` 的角色是 `button`，`<details>` 的展开状态通过 `open` 属性暴露）。

按 ARIA 第一规则，**应该优先用 `<details>`**。本站的练习组件之所以用 `<button>` + Vue 状态，是因为需要额外的功能：难度标签、统一的样式钩子、以及未来可能的「一次展开本章全部答案」批量控制。这些 `<details>` 做不到（每个 `<details>` 是独立的，没有原生的分组控制机制）。

本站的 `style.css` 里保留了 `details` 的样式，作为「原生方案」的备选实现——如果你在纯 HTML 环境（比如阶段项目）里需要折叠答案，直接用 `<details>`。

</Callout>

### 7.2 `aria-hidden` 的正确用法

`aria-hidden="true"` 让元素对辅助技术不可见，但**视觉上仍然显示**。适用于：

- 装饰性图标（`<svg aria-hidden="true">`）
- 视觉分隔符（`·`、`|`、`—`）
- 已经被其他方式表达的信息（比如图标 + `aria-label` 同时存在时，图标本身要隐藏）
- `○` / `✓` 这类符号（用文本或 `aria-pressed` 表达状态）

<Callout type="danger" title="绝对不能对可聚焦元素用 aria-hidden">

```html
<!-- 严重错误 -->
<div aria-hidden="true">
  <button type="button">点我</button>
</div>
```

这个按钮**仍然可以被 Tab 聚焦**，但屏幕阅读器**不会宣告任何东西**。用户按 Tab 会感觉「焦点跳到某个地方了，但不知道是什么」，按键也不会有反馈。

这是可检测的无障碍缺陷，axe-core 有专门的规则（`aria-hidden-focus`）。

**规则**：`aria-hidden="true"` 的元素内部**不能包含任何可聚焦元素**。如果确实要隐藏一整块含交互元素的内容，同时加 `inert` 属性（较新，需查 MDN 兼容性）或者把内部元素都设为 `tabindex="-1"` / `disabled`。

</Callout>

---

## 八、触摸目标尺寸（SC 2.5.8）

WCAG 2.2 新增的 2.5.8（Target Size Minimum，AA）要求：**可点击目标的尺寸至少 24×24 CSS 像素**。

（更严格的 2.5.5 Target Size Enhanced 是 AAA，要求 44×44。）

这条对移动端很重要。手指的精度远低于鼠标指针，密集排列的小链接会导致误触。

```css
/* 图标按钮太小 */
.icon-btn { width: 16px; height: 16px; }

/* 修正方式一：真的做大 */
.icon-btn { width: 24px; height: 24px; }

/* 修正方式二：视觉不变，但扩大可点击区域（padding） */
.icon-btn {
  width: 16px;
  height: 16px;
  padding: 8px;               /* 总可点击区域 32×32 */
  background-clip: content-box;
}

/* 修正方式三：用 ::before 撑出点击区域（不影响布局） */
.icon-btn { position: relative; }
.icon-btn::before {
  content: '';
  position: absolute;
  inset: -8px;                /* 上下左右各扩 8px */
}
```

**例外**：如果目标之间有足够间距（相邻目标的边缘间距使得 24px 圆内不会同时命中两个目标），或者目标是内联在句子中的链接，可以不满足。行内链接是最常见的例外——「点击[这里](#)了解详情」里的链接高度只有行高，但它前后都是文字，误触不会造成意外操作。

---

## 九、语言

第 2 章详细讲过 `<html lang>`，这里只回顾与无障碍相关的两条准则：

| SC | 等级 | 要求 |
| --- | --- | --- |
| 3.1.1 Language of Page | A | 页面的默认语言可被程序确定（`<html lang="zh-CN">`） |
| 3.1.2 Language of Parts | AA | 页面中**语言不同的片段**可被程序确定 |

3.1.2 是容易被忽略的一条。中文页面里出现英文术语是常态（本教程每章都有大量 TypeScript、Fastify、`aria-labelledby` 这类词），严格来说这些片段应该标注：

```html
<p>这个属性叫 <span lang="en">accessible name</span>，中文一般译为「可访问名称」。</p>
```

<Callout type="info" title="实践中的取舍">

3.1.2 的严格应用会让技术文档变得非常啰嗦——一段话里有 5 个英文术语就要写 5 个 `<span lang="en">`。

W3C 的 Understanding 文档对此有说明：短的外语片段（如专有名词、已融入日常用法的词）通常不需要标注，判断标准是「屏幕阅读器用错误的语音引擎读出来，用户是否还能理解」。`HTML`、`CSS`、`API` 这类缩写，中英发音差异不影响理解，可以不标；一整个英文句子或段落则应该标。

本站的做法：**代码块用 ` ```ts ` 这样的语言标注**（VitePress 会给 `<code>` 加上 `language-ts` 类），**行内术语不逐个加 `lang`**，但**整段的英文引文会加**。这是一个有意识的权衡，不是疏忽。

`<code>` 元素本身不需要 `lang` 属性——代码块的语言由 `class="language-xx"` 表达，且大多数屏幕阅读器对代码块有专门的朗读模式。

</Callout>

---

## 十、自查清单与工具

按「成本从低到高、收益从高到低」排序。**前四项不需要任何工具，任何人今天就能做。**

### 10.1 只用键盘走一遍（5 分钟）

把鼠标推开，只用键盘操作你的页面：

- [ ] `Tab` 能到达所有可交互元素吗？有没有跳不到的？
- [ ] 每次 `Tab` 都能看到焦点在哪吗？（看不见 = 违反 2.4.7）
- [ ] `Tab` 顺序和视觉顺序一致吗？（不一致 = 违反 2.4.3 / 1.3.2）
- [ ] 所有按钮都能用 `Enter` **和** `Space` 触发吗？
- [ ] 所有链接都能用 `Enter` 触发吗？
- [ ] 有没有焦点卡住出不来的地方？（= 违反 2.1.2）
- [ ] 第一个 `Tab` 是不是跳转链接？（不是 = 违反 2.4.1，第 8 章）

### 10.2 缩放到 200%（2 分钟）

`Ctrl` + `+` 按 4 次（或浏览器菜单里设 200%）：

- [ ] 文本变大了吗？（没变大 = 可能用了 `px` 或图片文字，违反 1.4.4）
- [ ] 有内容被截断或重叠吗？
- [ ] 出现了横向滚动条吗？

然后把设备模拟宽度设成 **320px**：

- [ ] 需要同时横向和纵向滚动吗？（需要 = 违反 1.4.10 Reflow）

### 10.3 禁用 CSS 看结构（3 分钟）

用浏览器扩展禁用样式，或者直接在 DevTools 里给 `<style>`/`<link>` 加 `disabled`：

- [ ] 内容顺序还读得通吗？（读不通 = DOM 顺序有问题，违反 1.3.2）
- [ ] 标题层级严格递进吗？（跳级或全是 h1 = 违反 2.4.6 / 1.3.1，第 3 章）
- [ ] 表格还有表头吗？（没有 = 用了 `<td>` 当表头，第 7 章）
- [ ] 图片的位置显示 `alt` 文本，能看懂吗？（看不懂 = `alt` 写得不好，第 5 章）

### 10.4 检查颜色对比（5 分钟）

DevTools 的颜色选择器通常内置对比度计算。或者用 [WebAIM Contrast Checker](https://webaim.org/articles/contrast/)：

- [ ] 正文文本对比度 ≥ 4.5:1？
- [ ] 大号文本 ≥ 3:1？
- [ ] 输入框边框、按钮边框 ≥ 3:1？（违反 = SC 1.4.11）
- [ ] 亮色和暗色模式**都**检查了吗？
- [ ] 有没有只靠颜色传达的信息？（有 = 违反 1.4.1）

### 10.5 自动化工具（10 分钟）

| 工具 | 形式 | 特点 |
| --- | --- | --- |
| **Lighthouse** | Chrome / Edge DevTools 内置（Audits / Lighthouse 面板） | 最快，无需安装。给出 0–100 的无障碍分数和具体问题清单 |
| **axe DevTools** | 浏览器扩展（Deque 出品） | 规则最详尽，误报少，每条问题都有解释和修复指引 |
| **axe-core** | npm 库（`https://github.com/dequelabs/axe-core`） | 上面两个工具的引擎。可以在 Vitest / Playwright 里跑自动化无障碍测试（第二期前端工程化领域会讲） |
| **WAVE** | 浏览器扩展（WebAIM 出品） | 在页面上直接可视化标注问题，适合快速定位 |

<Callout type="danger" title="自动化工具的覆盖率有限，不要把它当作合格证明">

这是必须说清楚的一点，因为很多团队把「Lighthouse 100 分」当作无障碍达标的标志。

自动化工具只能检测**程序可判定**的问题：缺少 `alt`、缺少 `label`、对比度不足、`aria-hidden` 用在可聚焦元素上、空的按钮等等。

它们**检测不了**：

- 焦点顺序是否符合逻辑（能检测到「有没有焦点样式」，检测不到「顺序对不对」）
- `alt` 文本写得**是否准确**（能检测到「有没有」，检测不到「对不对」）
- 链接文字是否有意义（「点击这里」在结构上完全合法）
- 语义标签是否用在了正确的地方（`<aside>` 装了本该是 `<nav>` 的内容，工具不会报错）
- 复杂交互（拖拽、自定义下拉、模态框）的键盘行为是否完整
- 屏幕阅读器实际的朗读顺序和体验

**本站没有找到可核实的官方数字来说明自动化工具的确切覆盖率**（业界常引用的「约 30%」这一数字来源不一，本站不做断言）。但可以确定的是：**上面 10.1–10.4 的手工检查覆盖了自动化工具覆盖不了的最重要部分，且成本极低。**

正确的顺序是：先做手工检查（10.1–10.4），再跑自动化工具补漏。反过来做会给你虚假的安全感。

</Callout>

### 10.6 用屏幕阅读器实际听一遍（30 分钟，可选但极有价值）

这是唯一能真正验证「用户体验」的方法。

| 平台 | 屏幕阅读器 | 获取方式 |
| --- | --- | --- |
| Windows | **NVDA** | 免费开源，[nvaccess.org](https://www.nvaccess.org/) 下载 |
| Windows | Narrator | 系统内置，`Win` + `Ctrl` + `Enter` 启动 |
| macOS / iOS | **VoiceOver** | 系统内置，`Cmd` + `F5` 启动 |
| Android | TalkBack | 系统内置，在无障碍设置里开启 |
| Linux | Orca | 大多数发行版可安装 |

你在 Windows 上，**推荐 NVDA**（免费、社区资料最多）。第一次用会很不习惯，建议：

1. 先读 NVDA 的用户指南，学会「浏览模式」和「焦点模式」的区别，以及 `Insert` + `空格` 切换、`Insert` + `F7` 打开元素列表、`D` 键按 landmark 跳转；
2. 打开本站任意一章，用 `H` 键按标题跳转、`K` 键按链接跳转、`T` 键按表格跳转，感受一下第 4/7/8 章讲的那些语义标签到底带来了什么；
3. 用 `Tab` 走一遍练习题的「查看答案解析」按钮，听 `aria-expanded` 是怎么被念出来的。

<Callout type="info" title="这一步的价值">

你在读完第 8 章之后可能觉得「landmark 有什么用，不就是多写几个标签」。用 NVDA 按 `D` 键在 landmark 之间跳转一次，你会立刻明白——**在一个长页面上，这是唯一可行的导航方式**。

同理，第 7 章那张「没有 `scope` 的表格」，用 NVDA 打开表格导航（`Ctrl` + `Alt` + 方向键在单元格间移动）听一次，你会听到它念「85」而没有任何上下文。这种体验是文字描述无法替代的。

</Callout>

---

## 十一、常见错误与排查

**症状 1：Lighthouse 报「Buttons do not have an accessible name」。**
原因：按钮里只有图标（SVG 或字体图标），没有文本。解决：加 `aria-label="关闭"`，并给装饰性 SVG 加 `aria-hidden="true"`。

**症状 2：按 Tab 走页面，某一步焦点「消失」了。**
原因：焦点跳到了一个视觉上不可见的元素（比如第 8 章讲的跳转链接用了错误的隐藏方式，或者一个 `opacity: 0` 的控件）。解决：F12 Console 执行 `document.activeElement` 看焦点在哪。

**症状 3：`aria-hidden="true"` 的容器里有按钮，axe 报 `aria-hidden-focus`。**
原因：第七章的 danger Callout 讲过。解决：要么去掉 `aria-hidden`，要么把内部的可聚焦元素移出容器。

**症状 4：屏幕阅读器把导航里的 5 个 `<nav>` 都念成「导航」。**
原因：多个 `<nav>` 没有命名（第 8 章）。解决：加 `aria-label`。

**症状 5：模态框打开后，按 Tab 焦点跑到背后的页面上去了。**
原因：没有实现焦点陷阱。解决：改用原生 `<dialog>` + `showModal()`（第三章），或用 ARIA APG 的 Dialog 模式实现。

**症状 6：`aria-invalid="true"` 设了之后，用户改正输入，屏幕阅读器还在念「无效」。**
原因：忘记清除。解决：见第六章的 danger Callout——设置和清除必须成对。

**症状 7：手机上按钮点不准，经常误触旁边的链接。**
原因：目标尺寸小于 24×24 CSS 像素（SC 2.5.8）。解决：第八章的三种扩大点击区域的方法。

**症状 8：暗色模式下正文次要文字看不清。**
原因：亮色模式的灰色直接搬到了暗色模式，对比度不足。解决：用 CSS 变量分别定义两套颜色，并对两套都跑对比度检查（第五章）。

**症状 9：W3C 校验器报「Attribute `aria-xxx` not allowed on element `yyy`」。**
原因：某些 ARIA 属性在某些元素上是非法的（比如 `aria-label` 不能用在 `<div>` 上没有 role 的情况，或不能用在 `<caption>`、`<dd>`、`<dt>`、`<figcaption>`、`<figure>`、`<iframe>`、`<legend>` 等元素上——具体规则见 ARIA in HTML）。解决：查 [ARIA in HTML](https://www.w3.org/TR/html-aria/) 规范里该元素允许的 ARIA 属性列表。

**症状 10：写了 `role="button"` 的 `<div>`，键盘按 Enter 没反应。**
原因：ARIA 第一规则的现实后果——浏览器不为 ARIA 组件提供键盘支持。解决：改回原生 `<button>`（首选），或者自己监听 `keydown` 处理 `Enter` 和 `Space`。

---

## 十二、练习

<Exercise title="练习 1：修复一个自制控件" difficulty="基础">

下面的代码实现了一个「显示/隐藏密码」的切换按钮和一个折叠面板，存在 6 处无障碍问题。请全部找出来并修正。

```html
<div class="field">
  <label>密码</label>
  <input type="password" name="pwd" />
  <div class="eye-icon" onclick="togglePwd()">👁</div>
</div>

<div class="panel">
  <div class="panel-head" onclick="togglePanel()" style="cursor:pointer">
    高级设置 <span id="arrow">▸</span>
  </div>
  <div class="panel-body" id="panel" style="display:none">
    <p>这里是高级选项……</p>
  </div>
</div>
```

<template #answer>

修正后：

```html
<div class="field">
  <label for="pwd">密码</label>
  <input id="pwd" type="password" name="pwd" aria-describedby="pwd-hint" />
  <button
    type="button"
    class="eye-btn"
    aria-pressed="false"
    aria-label="显示密码"
    onclick="togglePwd(this)"
  >
    <svg aria-hidden="true" width="16" height="16"><use href="#icon-eye" /></svg>
  </button>
  <span id="pwd-hint" class="hint">至少 8 位，包含字母和数字</span>
</div>

<div class="panel">
  <h3>
    <button
      type="button"
      class="panel-head"
      aria-expanded="false"
      aria-controls="panel-body"
      onclick="togglePanel(this)"
    >
      高级设置
      <span aria-hidden="true" class="arrow">▸</span>
    </button>
  </h3>
  <div class="panel-body" id="panel-body" hidden>
    <p>这里是高级选项……</p>
  </div>
</div>
```

6 处问题及理由：

**① `<label>` 没有关联到 `<input>`（违反 SC 1.3.1、3.3.2、4.1.2）。**
原代码的 `<label>密码</label>` 没有 `for`，`<input>` 也没有 `id`，两者在程序上没有关联。屏幕阅读器聚焦到输入框时，**不会念出「密码」**，用户不知道这个框要填什么。这是表单无障碍最基础也最常被违反的一条。第 6 章讲过两种关联方式（`for`/`id` 或包裹）。

**② `<div class="eye-icon" onclick>` 不是按钮（违反 SC 2.1.1、4.1.2）。**
这一个 `<div>` 同时缺失了第二章表格里的全部 5 项能力：没有角色（屏幕阅读器念不出「按钮」）、不可聚焦（键盘用户完全无法使用）、没有键盘激活、没有可访问名称（`👁` 这个 emoji 会被念成「眼睛」或干脆跳过，取决于屏幕阅读器）、没有状态。

修正为原生 `<button type="button">`。注意 `type="button"` 是必需的——第 6 章的 danger Callout 讲过 `<button>` 默认 `type="submit"`，如果这个控件在 `<form>` 里，点它会意外提交表单。

**③ 图标按钮没有 `aria-label`，emoji 当图标（违反 SC 4.1.2、2.5.3）。**
`👁` 作为可见内容是脆弱的：不同平台渲染不同、屏幕阅读器朗读不一致、无法用 CSS 换色（暗色模式下可能看不见）。改用 SVG 图标 + `aria-hidden="true"`（避免图标干扰名称计算）+ 按钮上的 `aria-label="显示密码"`。

这里符合 2.5.3（Label in Name）：如果按钮有可见文本，`aria-label` 必须包含它；纯图标按钮没有可见文本，`aria-label` 是唯一选择。

**④ 切换按钮没有表达状态（违反 SC 4.1.2）。**
「显示/隐藏密码」是个 toggle。用户按下后需要知道当前是「显示中」还是「隐藏中」。原代码可能靠改变图标表达，但**状态变化对辅助技术不可见**。加 `aria-pressed="false"`，切换时 JS 更新它。屏幕阅读器会念「显示密码，已按下，切换按钮」。

同时 JS 里应该更新 `aria-label`（「显示密码」↔「隐藏密码」），因为按钮的作用变了。

**⑤ `<div class="panel-head" onclick>` 不是可交互元素（违反 SC 2.1.1）。**
和 ② 同类问题。折叠面板的触发器必须是按钮。而且它是个**标题**（「高级设置」是这一节的标题），所以正确的嵌套是 `<h3><button>…</button></h3>`——按钮在标题里，而不是标题在按钮里。这样文档大纲（第 3 章、第 8 章）保持完整，同时按钮可聚焦可激活。

**⑥ 折叠状态没有暴露（违反 SC 4.1.2）。**
原代码用 `style="display:none"` 控制面板显隐，但触发器上没有任何状态标记。屏幕阅读器用户听到的是「高级设置」（一个 div，什么角色都没有），完全不知道这是可以展开的。

加 `aria-expanded="false"`（JS 切换时更新）和 `aria-controls="panel-body"`。`▸` 箭头加 `aria-hidden="true"`，因为展开状态已由 `aria-expanded` 表达。

**附带修正的两点：**

- **`style="display:none"` 改为 `hidden` 属性。** 内联样式是行为与结构耦合；`hidden` 是语义属性，且 JS 操作更清晰（`el.hidden = !el.hidden`）。注意 `hidden` 可以被 CSS `display: flex` 覆盖（这是已知陷阱），需要时用 `[hidden] { display: none !important; }` 兜底。
- **`style="cursor:pointer"` 删掉。** 原生 `<button>` 自带指针光标；而且「靠 `cursor` 表示可点击」本身就是不可靠的提示（键盘用户看不到光标）。
- **加了 `aria-describedby="pwd-hint"` 和一段输入提示**（SC 3.3.2 要求提供标签**或说明**，密码字段的格式要求属于必需的说明）。

**还有一个练习没要求但值得知道的点**：如果这个折叠面板在纯 HTML 环境下（不需要 JS 批量控制），最正确的实现是 `<details>` + `<summary>`，见第七章的 Callout。上面的 `<button>` + `aria-expanded` 方案是「需要 JS 控制时」的标准做法，也是 W3C ARIA APG 的 [Disclosure 模式](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)。

</template>

</Exercise>

<Exercise title="练习 2：为一个页面做无障碍审计" difficulty="进阶">

对本站（或你自己的任意页面）执行第十章 10.1–10.4 的四项手工检查，填写下面的审计表。每项写出「通过 / 不通过 / 部分通过」，不通过的要写具体位置和修复方案。

| 检查项 | 对应 SC | 结果 | 问题与修复 |
| --- | --- | --- | --- |
| Tab 能到达所有可交互元素 | 2.1.1 | | |
| 焦点始终可见 | 2.4.7 | | |
| Tab 顺序 = 视觉顺序 | 2.4.3 / 1.3.2 | | |
| 第一个 Tab 是跳转链接 | 2.4.1 | | |
| 200% 缩放无内容丢失 | 1.4.4 | | |
| 320px 宽度无需二维滚动 | 1.4.10 | | |
| 正文对比度 ≥ 4.5:1 | 1.4.3 | | |
| 非文本对比度 ≥ 3:1 | 1.4.11 | | |
| 无「仅靠颜色」传达的信息 | 1.4.1 | | |
| 标题层级严格递进 | 1.3.1 / 2.4.6 | | |
| 所有图片有恰当 alt | 1.1.1 | | |
| 所有表单控件有关联 label | 1.3.1 / 3.3.2 | | |

<template #answer>

这道题的目的是让你**建立一套可复用的审计流程**，所以答案给的是本站（VitePress 默认主题 + 本站自定义）的实际审计结论，以及每类问题的通用判断方法。你在自己项目上执行时，套用同样的方法。

**本站审计结论（基于 VitePress 1.6.4 默认主题与本站的自定义样式，核实时间 2026 年 10 月）：**

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| Tab 能到达所有可交互元素 | 通过 | 侧栏、导航、搜索、暗色模式切换、练习折叠按钮全部可 Tab 到达 |
| 焦点始终可见 | 通过 | 使用浏览器默认焦点样式，本站 `style.css` 未覆盖 `outline` |
| Tab 顺序 = 视觉顺序 | 通过 | VitePress 布局的 DOM 顺序与视觉顺序一致；本站未使用 `order` 或 `row-reverse` |
| 第一个 Tab 是跳转链接 | 通过 | VitePress 默认主题内置 "Skip to content" 链接，是第一个焦点 |
| 200% 缩放无内容丢失 | 通过 | 正文尺寸使用 `rem`（见本站 `.vitepress/theme/style.css`） |
| 320px 宽度无需二维滚动 | **部分通过** | 大部分页面通过；**宽表格页面**（如第 7 章的响应式方案对比表、第 8 章的 landmark 表）在 320px 下需要横向滚动。这符合 SC 1.4.10 的例外条款（数据表格属于「需要二维布局的内容」），但表格容器需要 `tabindex="0"` 才能让键盘用户滚动——**这一点本站尚未逐项核实** |
| 正文对比度 ≥ 4.5:1 | 通过（VitePress 默认配色） | 本站未修改文本颜色变量 |
| 非文本对比度 ≥ 3:1 | **待核实** | 代码块边框、表格分隔线、侧栏激活指示条的对比度本站未逐个测量 |
| 无「仅靠颜色」传达的信息 | **部分通过** | `Exercise` 折叠按钮用 `▸`/`▾` 符号 + 文字（「查看答案与解析」/「收起答案与解析」）双通道表达，通过；`StatusBadge` 用**彩色圆点 + 文字标签**，通过；但**侧栏当前页高亮仅靠颜色和背景**，未加 `aria-current="page"` ——这是一个真实缺陷 |
| 标题层级严格递进 | 通过 | 各章 `# 章标题` → `## 节` → `### 小节`；VitePress 的 frontmatter title 不产生额外 h1 |
| 所有图片有恰当 alt | 通过 | 本站内容以代码块和表格为主，图片极少；装饰性 SVG 使用 `aria-hidden` |
| 所有表单控件有关联 label | 不适用 | 本站无用户输入表单（搜索框由 VitePress 提供，其 label 由主题负责） |

<Callout type="unverified" title="以上审计结论的验证程度">

这份审计中，「通过」的结论基于对本站源码（`.vitepress/theme/style.css`、各组件 `.vue` 文件）的检查和对 VitePress 默认主题行为的了解，**未使用真实屏幕阅读器逐项验证**，也**未在真实浏览器中执行 320px / 200% 缩放的完整走查**。

标记为「待核实」和「部分通过」的项目是诚实的不确定项。按第十章 10.5 的说明，自动化工具和源码检查都无法替代手工走查——你在自己的浏览器里跑一遍 10.1–10.4，得到的结论比这份表格更可靠。

</Callout>

**发现的具体缺陷与修复方案：**

**缺陷 1：侧栏当前页缺少 `aria-current="page"`。**
- 位置：VitePress 默认主题的 `VPSidebarItem.vue`
- 问题：当前页在视觉上靠背景色和文字颜色高亮，但 DOM 上没有 `aria-current`。屏幕阅读器用户无法知道自己在哪一章（违反 SC 4.1.2 的「状态可被程序确定」）
- 修复：这是主题层的问题，需要覆盖 `VPSidebarItem` 组件。对个人学习站点，成本收益比不高——**记录为已知问题，暂不修复**，因为章节导航还有「上一篇 / 下一篇」和面包屑作为替代定位手段（SC 2.4.8 Location 提供了多种定位方式）
- 这个判断很重要：**无障碍改进要排优先级**，不是所有问题都要立刻修

**缺陷 2：可横向滚动的表格容器可能缺少 `tabindex="0"`。**
- 位置：VitePress 默认主题给 `<table>` 外层包的 `.vp-doc div[class*='language-']` 类似容器（具体类名需核实）
- 问题：第 7 章讲过，`overflow-x: auto` 的容器如果没有可聚焦元素，键盘用户无法滚动
- 修复：在 `style.css` 里无法解决（这是 DOM 结构问题），需要自定义 Markdown 渲染或在主题层处理。**列为待核实项**

**通用判断方法（你在自己项目上审计时用）：**

**「仅靠颜色」的排查方法**：把页面转成灰度（DevTools → Rendering → Emulate vision deficiencies，或用 CSS `filter: grayscale(1)` 临时加到 `html` 上）。如果灰度下**任何信息丢失了**，就违反 1.4.1。

**标题层级的排查方法**（第 3 章、第 8 章都给过）：

```js
[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
  .map(h => `${h.tagName} ${h.textContent.trim()}`)
  .join('\n')
```

看输出有没有跳级（h2 → h4）、有没有多个 h1、有没有全是同级标题。

**焦点顺序的排查方法**：不要只按 Tab。在 Console 里执行：

```js
// 列出页面上所有可聚焦元素，顺序即 Tab 顺序（近似）
const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
console.table([...document.querySelectorAll(focusable)].map((el, i) => ({
  序: i + 1,
  标签: el.tagName.toLowerCase(),
  名称: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || '(无名称)',
  可见: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
})))
```

重点看「名称」列有没有 `(无名称)`，以及「可见」列有没有 `false`（不可见但可聚焦 = 焦点会「消失」）。

**对比度的排查方法**：DevTools 选中元素 → Styles 面板 → 点颜色值 → 弹出的颜色选择器底部显示对比度，并标注 AA / AAA 是否通过。逐个检查正文、次要文本、链接、边框。

</template>

</Exercise>

<Exercise title="练习 3：为阶段项目设计无障碍验收标准" difficulty="挑战">

第 10 章的阶段项目是「语义化个人学习档案页」。请为它设计一份**可执行的无障碍验收标准**，要求：

1. 至少 12 条，每条必须可判定（是/否），不能写「要有良好的可访问性」这种无法验证的话；
2. 每条标注对应的 WCAG 2.2 成功准则编号和等级；
3. 每条写明**验证方法**（用什么工具、做什么操作、看什么结果）；
4. 按优先级排序，并说明你的排序依据。

<template #answer>

这份验收标准的设计原则：**每条都能被一个不懂无障碍的人执行并得到确定结论**。这是「可执行」的含义——不依赖专业判断。

| # | 验收项 | WCAG 2.2 SC | 等级 | 验证方法 |
| --- | --- | --- | --- | --- |
| 1 | 页面有且仅有 1 个 `<h1>`，标题层级无跳级（h2 后不能直接 h4） | 1.3.1 / 2.4.6 | A / AA | Console 执行第 8 章的标题层级脚本，输出粘贴到验收记录里人工核对 |
| 2 | `<body>` 直接子元素包含恰好 1 个 `<header>`、1 个 `<main>`、1 个 `<footer>` | 1.3.1 / 4.1.2 | A | 查看 HTML 源码，数元素个数；或 Console 执行 `document.querySelectorAll('body > header, body > main, body > footer').length` 应为 3 |
| 3 | `<main>` 有 `id` 且 `tabindex="-1"`，`<body>` 第一个子元素是指向该 id 的跳转链接 | 2.4.1 | A | 按 `Tab` 键 1 次，焦点应落在「跳到主要内容」链接上且**可见**；点击后焦点应在 `<main>`（Console 查 `document.activeElement.id`） |
| 4 | 所有 `<nav>` 都有 `aria-label` 或 `aria-labelledby`，且页面上任意两个 `<nav>` 的名称不同 | 4.1.2 | A | Console 执行 `[...document.querySelectorAll('nav')].map(n => n.getAttribute('aria-label') \|\| '(未命名)')`，输出不应有 `(未命名)` 或重复值 |
| 5 | 所有 `<img>` 都有 `alt` 属性；装饰性图片的 `alt` 为空字符串 `""`（不是缺失） | 1.1.1 | A | Console 执行 `[...document.images].filter(i => !i.hasAttribute('alt'))`，结果应为空数组 |
| 6 | 所有表单控件都有程序可确定的名称（`<label for>` 关联、包裹式 label、或 `aria-label`） | 1.3.1 / 3.3.2 / 4.1.2 | A | Lighthouse 无障碍审计中「Form elements do not have associated labels」项应为 0 条；再人工抽查每个控件 |
| 7 | 键盘可到达页面上**所有**可交互元素，且每一步焦点都可见 | 2.1.1 / 2.4.7 | A / AA | 完全不用鼠标，从页面顶部按 `Tab` 走到最后一个可交互元素，记录按键次数；全程焦点框必须始终可见（截图 3 处作为证据） |
| 8 | Tab 顺序与视觉顺序一致（从上到下、从左到右） | 2.4.3 / 1.3.2 | A | 在第 7 项的走查中，记录焦点顺序，与页面视觉布局对照。若使用了 `order`、`row-reverse`、绝对定位或 Grid 显式定位，必须逐个确认 |
| 9 | 没有任何元素的焦点会被卡住（按 Tab 总能离开当前区域） | 2.1.2 | A | 在第 7 项走查中特别关注折叠区域、模态框、`<details>`；从页面顶部 Tab 到底部，再 `Shift+Tab` 回顶部，全程不应卡住 |
| 10 | 正文文本与背景对比度 ≥ 4.5:1；大号文本（≥24px 或 ≥18.66px 加粗）≥ 3:1 | 1.4.3 | AA | DevTools 逐个选中正文、次要文本、链接、标题，颜色选择器底部读取对比度值，截图记录。**亮色和暗色模式各做一遍** |
| 11 | 界面组件的视觉边界（输入框边框、按钮边框、焦点指示器）对比度 ≥ 3:1 | 1.4.11 | AA | DevTools 选中边框颜色，与相邻背景色在 WebAIM Contrast Checker 中计算 |
| 12 | 页面中不存在「仅靠颜色传达」的信息 | 1.4.1 | A | DevTools → Rendering → Emulate vision deficiencies → 选「Achromatopsia」（全色盲）。灰度截图与彩色截图对比，信息不应有任何丢失 |
| 13 | 浏览器缩放 200% 时无内容丢失、无功能丧失 | 1.4.4 | AA | `Ctrl` + `+` 按 4 次达到 200%，检查所有文本是否变大、有无截断或重叠、有无横向滚动条 |
| 14 | 视口宽度 320px 时不需要二维滚动（数据表格除外，且表格容器可键盘滚动） | 1.4.10 | AA | DevTools 设备模拟宽度设 320px；截图整个页面。若存在横向滚动容器，验证其有 `tabindex="0"`（Console 查 `el.getAttribute('tabindex')`） |
| 15 | 未设置 `user-scalable=no`，未设置 `maximum-scale` < 2 | 1.4.4 | AA | 查看 `<meta name="viewport">` 源码，确认不含这两个声明 |
| 16 | `<html>` 有 `lang` 属性，值为合法的 BCP 47 标签（中文简体为 `zh-CN`） | 3.1.1 | A | 查看源码；Console 执行 `document.documentElement.lang` 应输出 `zh-CN` |
| 17 | 所有可点击目标尺寸 ≥ 24×24 CSS 像素，或满足间距例外 | 2.5.8 | AA | DevTools 选中每个链接/按钮，读取 Computed 面板的宽高；对图标类小目标用第八章的方法扩大点击区域后复测 |
| 18 | 所有 `<table>` 的表头使用 `<th>` 且带 `scope`（简单表）或 `headers`/`id`（复杂表） | 1.3.1 | A | 查看源码；用 NVDA 的表格导航（`Ctrl`+`Alt`+方向键）实际听 3 个单元格，确认念出了表头 |
| 19 | 所有 `aria-hidden="true"` 的元素内部不含可聚焦元素 | 4.1.2 | A | Console 执行 `document.querySelectorAll('[aria-hidden="true"] a[href], [aria-hidden="true"] button, [aria-hidden="true"] [tabindex]:not([tabindex="-1"])')`，结果应为空 |
| 20 | W3C 校验器（Nu Html Checker）零错误 | 4.1.2（间接） | — | 把文件上传到 https://validator.w3.org/nu/ ，错误数应为 0 |
| 21 | Lighthouse 无障碍分数 ≥ 95，且无「高影响」问题 | 综合 | — | DevTools → Lighthouse → 勾选 Accessibility → 生成报告，截图 |
| 22 | 用 NVDA（或 VoiceOver）完整听一遍页面，能理解全部内容和结构 | 综合 | — | 用 `H` 键遍历标题、`K` 键遍历链接、`D` 键遍历 landmark，各记录一次输出；再从头到尾连续听一遍，记录任何「听不懂在说什么」的位置 |

**排序依据：**

我按「**用户影响面 × 修复成本**」排序，而不是按 WCAG 编号。

**第一梯队（1–9 项，必须最先满足）：结构与键盘。**
理由：这一梯队的问题会**完全阻断**某类用户。没有 `<main>` 和跳转链接，键盘用户在长页面上实际无法使用；没有正确的 `<h1>` 和层级，屏幕阅读器用户的标题跳转（最常用的导航方式）失效；表单没有 label，用户不知道要填什么。这些是「能用 / 不能用」的分界，不是「好用 / 不好用」。而且它们的修复成本极低——只是把标签名写对。

**第二梯队（10–17 项）：视觉可感知。**
理由：影响低视力、色觉障碍、移动端用户，范围很广，但通常不是完全阻断（用户可能通过其他方式获取信息，比如放大截图、找人代读）。修复成本中等——需要调整配色和布局，可能涉及设计返工。

**第三梯队（18–19 项）：语义细节。**
理由：影响特定场景（表格阅读、复杂组件）。修复成本低但需要逐个检查，容易遗漏。

**第四梯队（20–22 项）：工具验证。**
理由：**这三项应该最后做，不是最先做。** 这是排序里最重要的判断。

理由在第十章的 danger Callout 里讲过：自动化工具（20、21 项）只能检测程序可判定的问题，把 Lighthouse 分数当作目标会导致「刷分」——修掉所有工具能报的问题，但焦点顺序依然混乱、`alt` 文本依然是「图片」。

第 22 项（真实屏幕阅读器走查）是**唯一能验证「用户实际体验」的方法**，也是唯一能发现前面 21 项都通过、但整体依然难用的手段。它排在最后，是因为它需要学习成本（NVDA 的快捷键体系）且耗时最长；但它**不能被省略**。

**一个反直觉的推论**：如果你的时间只够做一半，应该做 1–9 项 + 第 22 项，跳过 20、21 项。工具跑分是给别人看的证明，前 9 项和第 22 项是给用户用的东西。

**关于「验收标准」这件事本身**：这 22 条不是本站独创的，它们直接来自 WCAG 2.2 的成功准则文本。真正的价值在于**每条都配了可执行的验证方法**——「符合 WCAG AA」是一句无法验收的话，「Console 执行这段脚本，输出应为空数组」才是。你在自己的项目里做验收标准时，重点不是列准则，而是**为每条准则设计一个傻瓜式的检查步骤**。

</template>

</Exercise>

---

## 十三、官方文档与延伸阅读

以下链接均已核实可访问（核实时间：2026 年 10 月）。

**标准与规范**

- [WCAG 2.2 全文（W3C Recommendation）](https://www.w3.org/TR/WCAG22/)：所有成功准则的规范文本。第一章的新增/移除清单直接来自这份文档的目录
- [Understanding WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/) 系列，每条准则一页。本章引用过的：
  - [1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color)
  - [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)
  - [1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text)
  - [1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow)
  - [1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)
  - [2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard)
  - [2.4.1 Bypass Blocks](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks)
  - [2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible)
  - [2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance-minimum)
  - [2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
  - [3.1.1 Language of Page](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page)
  - [3.3.1 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification)
  - [3.3.3 Error Suggestion](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion)
  - [4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value)
- [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/)：ARIA 角色和属性的规范
- [ARIA in HTML](https://www.w3.org/TR/html-aria/)：每个 HTML 元素允许哪些 ARIA 属性（第十一章症状 9 的查证依据）
- [HTML AAM 1.0](https://www.w3.org/TR/html-aam-1.0/)：HTML 元素到 ARIA 角色的映射表（第 8 章那张表的来源）

**W3C ARIA 作者实践指南（APG）——最实用的 ARIA 资料**

- [APG 首页](https://www.w3.org/WAI/ARIA/apg/)
- [键盘交互实践](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)：**ARIA 第一规则和 `tabindex` 正值警告的出处**（第二章、第三章引用过）
- [所有设计模式](https://www.w3.org/WAI/ARIA/apg/patterns/)：每种自定义控件的完整实现要求
- [Dialog (Modal) 模式](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [Disclosure 模式](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)：折叠面板（练习 1 的参考实现）

**W3C 教程与评估**

- [WAI Tutorials 总入口](https://www.w3.org/WAI/tutorials/)
- [Images Tutorial](https://www.w3.org/WAI/tutorials/images/)：`alt` 文本的完整决策树（第 5 章的依据）
- [Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/)：第 7 章的依据
- [Preliminary Review（快速自查）](https://www.w3.org/WAI/test-evaluate/preliminary/)：W3C 官方的手工自查流程，与第十章 10.1–10.4 互补

**MDN**

- [`tabindex`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/tabindex)
- [`:focus-visible`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/:focus-visible)
- [`<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog)
- [ARIA 角色参考（中文）](https://developer.mozilla.org/zh-CN/docs/Web/Accessibility/ARIA/Reference/Roles)

**工具与其他**

- [Accessibility Developer Guide](https://www.accessibility-developer-guide.com/)：由瑞士 Access for All 基金会维护，实践导向，含大量屏幕阅读器实操说明
- [WebAIM: Keyboard Accessibility](https://webaim.org/techniques/keyboard/)
- [WebAIM: Contrast and Color](https://webaim.org/articles/contrast/)（含在线对比度计算器）
- [axe-core（自动化引擎）](https://github.com/dequelabs/axe-core)
- [NVDA 屏幕阅读器](https://www.nvaccess.org/)：Windows 上的免费开源屏幕阅读器
- [W3C Markup Validation Service](https://validator.w3.org/nu/)

---

HTML 的 9 章知识部分到这里全部结束。你已经掌握了：文档如何被解析（第 1 章）、文档骨架与元数据（第 2 章）、文本语义与文档大纲（第 3 章）、链接与 URL（第 4 章）、图片与多媒体（第 5 章）、表单与原生校验（第 6 章）、表格与表头关联（第 7 章）、页面结构与 landmark（第 8 章）、以及无障碍（本章）。

下一章是[阶段项目：语义化个人学习档案页](/html/project)。它会把这 9 章的全部内容用在**一个真实的、你要自己写出来的页面**上，并给出明确的验收标准。做完它，HTML 领域才算真正完成。
