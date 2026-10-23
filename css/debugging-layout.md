# 布局调试方法论：一条固定路径，而不是反复试数值

## 为什么必须有路径

「看着结果调」的循环是：元素不对 → 改个数值 → 变了但不对 → 再改 → 对了但另一处塌了 → 回滚 → 从头再来。代价不是时间，而是**你永远得不到可复用的结论**：改动成功了却不知道为何成功，下一个 bug 还是同一套流程。

固定路径把「猜」换成「排除」。布局成因只有六类：**结构、包含块、盒模型、格式化上下文、层叠来源、外部覆盖**。一次只查一类，每类对应 DevTools 的一个明确动作。排查结束时你手里应有「哪一类、第几步发现的」这个结论，而不只是「好了」。

```text
元素不对
├─ 视觉顺序乱 / 要靠负 margin 对齐 / 内容被莫名拆开
│   └─ ① 结构 → 先看 DOM 树，别先看 CSS
├─ 绝对定位跑到左上角 / 百分比宽度不是你以为的基准
│   └─ ② 包含块 → 逐层上溯 computed position
├─ 差几个像素 / padding 把子元素挤出去 / 高度是 0
│   └─ ③ 盒模型 → Computed 的盒模型图读数
├─ 子元素全跑出来 / margin 该并不并不 / 溢出却能滚
│   └─ ④ 格式化上下文 → 查自己与父级的 display、overflow
├─ 声明被划掉 / 顺序换了结果就换 / 分层了却讲不通
│   └─ ⑤ 层叠来源 → Styles 从上往下读 + @layer 顺序
└─ 本地好的线上一团糟 / 只有某个组件不对 / 框架在动
    └─ ⑥ 外部覆盖 → 看来源文件名、Sources 全局搜、无痕窗口
```

<Callout type="unverified" title="面板名称与入口未经核实">

本章涉及 Chrome DevTools 的 Styles、Computed、Layout、Layers、Sources 各面板的勾选项与按钮位置。本环境访问不了 developer.chrome.com，**这些操作描述未经核实**，名称对不上时用 `Ctrl+Shift+P` 命令菜单搜功能名，比翻菜单可靠。规范级结论（盒模型读数与 `getBoundingClientRect` / `clientWidth` 的关系、`@layer` 排序规则、`p` 遇到块级子元素会自动闭合）核对自 MDN，核实时间 **2026-10-17**。

</Callout>

## 第 1 步 · 先看结构，再看样式

在 Elements 面板展开 DOM 树，只问三件事：嵌套层级对不对、语义标签在不在、**同级顺序是不是视觉顺序**。CSS 排不出一个结构错误的页面：你在用 `position: absolute` 把内容搬回它本该在的位置、或用负 `margin` 抵消空白时，问题已经在 HTML 里了。

**从 DOM 反推布局问题**是这一步的核心：不看样式，只读树的形状，回答「这个结构天生会摆成什么样」。`main > section*3` 天生是三段上下堆叠，想让它们横排就得在最外层加一层 flex 或 grid——这是**加结构**，不是给三个 section 各写 `float`。当修一个现象需要在三处各写一条互不相干的声明，说明缺一层共同父级。

三个可以直接判定「该改 HTML」的信号：

- **`<p>` 里套了 `<div>`。** MDN 写明段落是块级元素，「若在 `</p>` 结束标签解析之前解析到另一个块级元素，它会自动关闭」——你写的父子关系不存在，浏览器把它重排成了兄弟，「代码里明明包着、DevTools 里却是平级」就是这条。参见 [HTML 文档结构](/html/)。
- **Tab 顺序与视觉顺序不一致。** 结构顺序错了，CSS 修得了位置也修不了可访问性，见[无障碍第 8 章](/html/accessibility)。
- **三个以上纯定位用的 `div`。** 每多一层无意义容器，百分比基准、`auto` 高度、margin 合并条件全变，排查时要逐层排。

## 第 2 步 · 确认包含块

`position: absolute` 跑到页面左上角，九成是**你以为的父元素不是它的包含块（containing block）**。别猜，逐层上溯：

```js
// 在 Elements 面板选中目标元素，然后在 Console 里：
let el = $0;
while (el && getComputedStyle(el).position === 'static') el = el.parentElement;
console.log(el ? el : '一路走到根，包含块是初始包含块');
```

预期结果：打印出的元素才是绝对定位真正相对着摆的祖先；如果是 `<body>`，说明中间没有祖先设过非 `static` 的 `position`。

`fixed` 的包含块默认是视口，但祖先的 `transform`、`filter`、`perspective`、`backdrop-filter` 或 `will-change: transform` 会让它变成那个祖先——典型的「样式没写错、结果却不对」，机制与案例 A 同源。把祖先链的 `transform` 逐层打出来看是否为 `none` 即可确认。百分比宽度的基准同理：**看父元素内容盒的宽度**（见[盒模型](/css/box-model)），`width: 50%` 得到意外像素值时先确认父盒的 content width。

## 第 3 步 · 读盒模型图

选中元素 → Computed 面板顶部的盒模型图，从外到内是 **margin → border → padding → content**；鼠标悬停某一层，只有那一层在页面上高亮，数值随之显示。

**必须在 Computed 里核对 `box-sizing`、`display`、`position` 三个值**，因为它们通常不由你写：`box-sizing` 来自全局 reset（`*, *::before, *::after`），`display` 被框架或工具类改成 `block` / `flex` / `contents`，`position` 被 reset 设成 `relative` 后绝对定位基准就跟着变。**在自己文件里搜不到不等于没人设过**——这三项是层叠的产物，只能在 Computed 看终值。

读数与脚本 API 的对应（`getBoundingClientRect()` 与 `clientWidth` 定义核对自 MDN，2026-10-17）：

| 你读到的 | 它是什么 |
| --- | --- |
| `getBoundingClientRect().width` | **border box**：内容 + padding + border-width，**不含 margin**。`border-box` 时等于你写的 `width`，`content-box` 时等于 `width + padding + border` |
| `el.clientWidth` | 内部宽度，**含 padding，不含 border、margin 与垂直滚动条** |
| 盒模型图最内层 | content box，即 `width` / `height` 作用的那层 |
| 视觉上的「留白」 | 可能是 margin，也可能是父级 padding 或 `gap`——悬停分层确认 |

两条推论：`getBoundingClientRect()` 返回**受 `transform` 影响后的实际渲染盒**，「`width: 100px` 却读出 120px」先查 `scale`；它又**相对视口**，滚动会改 `top` / `left`，比较两个元素时用 `right - left` 这类相对量。

## 第 4 步 · 确认格式化上下文

「容器高度塌陷」「margin 合并行为诡异」「溢出能滚但看不见滚动条」三类，答案都在格式化上下文（formatting context）。查法一句话：**把自己与父级的 `display`、`overflow` 打出来，判断各自在哪个上下文里。**

```js
const g = (el) => ['display', 'overflow', 'position', 'float']
  .map((p) => `${p}: ${getComputedStyle(el)[p]}`).join(' | ');
console.log('父:', g($0.parentElement), '\n子:', g($0));
```

判据：父级 `display: flex` 或 `grid` → 子元素 margin **不垂直合并**、`float` 与 `clear` 失效；`overflow` 非 `visible` 或 `display: flow-root` → 建立新的块级格式化上下文（BFC），浮动被包住、父子 margin 不再穿透。规则在[常规流与格式化上下文](/css/flow-and-bfc)。这一步最常被跳过，跳过的后果是给塌陷容器加 `height` 硬撑，换个视口再塌一次。

## 第 5 步 · 读层叠来源

Styles 面板从上往下**赢家在上**：最顶是行内样式与继承，中间是命中规则，被更高优先级压住的同属性声明显示为**划掉**（删除线）。三种「看起来生效其实没生效」的形态：

| 显示形态 | 含义 | 下一步 |
| --- | --- | --- |
| 声明带删除线 | 命中了，但被更高优先级覆盖 | 往上找赢家，读它的选择器与来源文件 |
| 整条规则灰色 | 规则存在，但媒体条件未激活 | 用设备工具条改视口，或检查断点 |
| 值出现在 `Inherited` 分组 | 不是命中来的，是继承来的 | 想覆盖就在这个元素上写显式声明 |

**被划掉只说明「有别人赢了」，不告诉你赢家是谁**，尤其当它来自别的文件。按顺序三个动作：① 点被划掉声明右侧的来源链接（文件与行号）；② Styles 顶部 **Filter** 输入属性名滤噪音；③ 都不管用就 Sources 全局搜类名，把命中规则抄下来数特异性——[选择器与特异性](/css/selectors)的审计一节就是这个流程。

还有层叠之外的一个变量：**「顺序」指样式表在文档中的加载顺序，不是源文件的书写顺序。** 构建合并、拆 chunk 后书写顺序可能被重排，这是「本地好的线上一团糟」的第一嫌疑。

## `@layer` 与 Layers 面板

分层之后靠特异性解释不了结果。排序规则（核对自 MDN，2026-10-17）：**先声明的层优先级最低、后声明的最高；层之间不比特异性和层内顺序；未分层样式始终压过分层样式；`!important` 方向反过来——分层 `!important` 压过未分层的，且分层 `!important` 之间先声明的层赢。**

于是「我写在最后一层的规则输给了看起来更弱的」，第一反应应该是：**对方没有分层**。开 Layers 面板看分层与层叠上下文分组（入口未核实），或在 Console 里读顶层 `@layer` 语句——**列出的顺序就是排序**：

```js
// 跨域样式表因 CORS 读不到 cssRules，try/catch 不能省
[...document.styleSheets].flatMap((s) => {
  try { return [...s.cssRules].map((r) => r.cssText.slice(0, 90)); } catch { return []; }
}).filter((t) => t.startsWith('@layer'));
```

## 第 6 步 · 确认有没有外部样式在动你的东西

组件库、UI 框架、CMS 注入、浏览器扩展的内容脚本都在这一步暴露。三个动作：看每条命中规则的**来源文件名**（全是 `app.xxxx.css` 才是你自己的，出现 `vendor` 或 `chrome-extension://` 就找到对手了）；Sources 面板 `Ctrl+Shift+F` 全局搜类名，看它在几个文件里定义；怀疑扩展就用无痕窗口重开。**只有你本机复现、同事正常**时，扩展与缓存排前两位。

## 布局检查器：Flexbox 与 Grid 各画什么

flex 与 grid 的结果由多条约束共同算出，靠目测反推不可行。**选中容器后，Styles 面板里 `display: flex` / `display: grid` 那一行会出现徽标，点它打开叠加层**；带 `flex` / `grid` 标记的子项也能逐个切换查看（入口名称未核实）。

| 检查器 | 画得出来的东西 | 用来回答 |
| --- | --- | --- |
| Flexbox | 主轴与交叉轴方向、基线、每个子项的实际尺寸盒、剩余空间与挤压方向、`gap` | 「为什么这一项被压窄了」「谁是被收缩的那一个」 |
| Grid | 行列轨道线与编号、每条轨道的计算像素、命名线与区域名、项目所占范围、`gap` | 「`1fr` 等于多少像素」「这条线为什么不在我以为的位置」 |

Grid 检查器还能直接点选轨道边界调尺寸（只在 DevTools 会话内有效，刷新即失）——**看轨道像素读数比在源码里算 `minmax` 快得多**，`auto-fit` / `auto-fill` 的差异也只有画出来才一眼可辨。Flexbox 检查器用来确认「收缩与拉伸发生在哪一项」，即[Flexbox](/css/flexbox)一章里 `flex-basis` 与 `min-width: auto` 的互动。

## 二分定位：从禁用整表开始

冲突不明时别逐条读代码，用禁用把搜索空间砍半：

```js
// 1) 一次关掉所有外链样式表
[...document.querySelectorAll('link[rel="stylesheet"]')].forEach((l) => (l.disabled = true));
// 2) 只关某一张
[...document.querySelectorAll('link[rel="stylesheet"]')]
  .find((l) => /vendor/.test(l.href)).disabled = true;
```

预期结果：第 1 步后页面退化成近乎无样式的文档流；**逐张打开**，每开一张看一次问题是否出现，出现的那张就是嫌疑表。之后改用 Styles 里规则左侧的复选框，规则多时**先关一半**再对半推进——这就是二分，N 条规则最坏 `log₂N` 次操作。纪律：**一次只关一类来源**（表 → 规则 → 行内样式）。

## 一次性探针：用 `outline`，不要用 `border`

看不出真实盒子边界时在 Console 下临时探针，不进代码库：

```js
document.querySelectorAll('body *').forEach((el) => {
  el.style.outline = '1px dashed rgba(255, 0, 0, .6)';   // 全量
});
$0.style.outline = '2px solid red';                      // 只看选中的容器
```

**为什么是 `outline`**：它画在边框外侧，**不参与布局、不占尺寸**。而 `border` 在 `content-box` 下让实际尺寸增加 2px，在 `border-box` 下侵占内容区——两种都改了你正在调试的对象。用 border 探针最常见的结局是「加了探针就不溢出了」或「凭空多一条滚动条」。同理别用 `padding` / `margin` 探边界。

<Callout type="warn" title="探针一旦提交就是代码债">

有人把 `* { outline: 1px solid red }` 留进了全局样式，整站在审计工具里报「对比度异常」。探针要么写在 Console（刷新即消失），要么用 Local Overrides 持久化；**不要**写进 `.css` 再指望自己记得删。

</Callout>

## 横向滚动条的定位套路

`body { overflow-x: hidden }` 是掩盖不是修复：内容仍然超宽，只是被裁掉，手机上表现为「右边字被切了」。定位分两步。

**第 1 步，确认谁在超宽。**

```js
const limit = document.documentElement.clientWidth;   // 可用宽度，不含滚动条
[...document.querySelectorAll('body *')]
  .filter((el) => getComputedStyle(el).display !== 'none')
  .map((el) => ({ el, r: el.getBoundingClientRect() }))
  .filter(({ r }) => r.right > limit || r.left < 0)
  .map(({ el, r }) => `${el.tagName}.${el.className} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
```

预期结果：打印出所有越界元素的标签、类名与读数。**层级最深的那个通常是根因**，外层越界往往只是被撑开的结果。读 `right` 而不是 `width`：`left: -100px` 的装饰元素同样制造滚动条。

**第 2 步，找成因。** 四类各有确认动作：`width: 100vw`（视口宽度**含滚动条**，比较 `clientWidth` 与 `window.innerWidth`，差值即滚动条宽）；固定像素宽的表格、图片、代码块（`w` 恰好等于某个整数）；负 `margin` 或 `right: -24px` 的装饰（越界但本身不可见）；长单词、长 URL 不换行（宽度等于内容宽度，试 `overflow-wrap: anywhere` 看是否消失）。

连带风险：`overflow-x: hidden` 加在 `html` 或 `body` 上会影响另一轴的判定（`visible` 在这种组合下按 `auto` 处理），凭空造出一个内部滚动容器，让 `position: sticky` 失效。

## 「改了没生效」的排查表

按顺序查，每步一条命令或一个面板动作。**顺序不要颠倒**：先证明「选择器命中了这个元素」再谈层叠——跳过第一行直接加 `!important`，最常见的结局是加了也没用，因为根本没有声明落在它身上。

| 嫌疑 | 怎么确认 | 修法 |
| --- | --- | --- |
| 选择器没命中，或命中的不是这个元素 | `document.querySelector('你的选择器')` 返回 `null` | 改选择器，或给元素加稳定的类名钩子，见[选择器](/css/selectors) |
| 特异性不够 | Styles 里声明被划掉 | 补档位或改结构，**不是**加 `!important` |
| `!important` 来自别处 | Sources 全局搜 `!important` | 用 `@layer` 重排，或换对方没占的属性 |
| 层叠层排序 | `@layer` 那段脚本 | 调整层的声明顺序 |
| 缓存旧 CSS 或 HMR 没推过来 | Network 看响应头（`304` / 强缓存）；终端无更新日志 | 硬刷新，确认产物文件名带内容 hash；仍无效就重启 dev server |
| 规则没进包 | 在产物 CSS 里搜类名；看 Coverage 面板 | 检查是否真被 `import`、路径大小写、分支被摇掉。Vite 侧见 [Vite 开发侧](/frontend-engineering/vite-dev) |
| 媒体条件未激活 | Styles 里整条规则是灰色 | 用设备工具条改视口 |

## 最小复现与可复现证据

动手改代码之前先做三件事：**无痕窗口**打开、关掉扩展、DevTools Settings 勾上 Disable cache——排除八成的「只有我这里有问题」。

**最小复现（reduced test case）本身就是最有效的调试**：它强迫你把「哪一部分导致问题」写成可验证的假设，多数时候砍到只剩必要结构，答案就出来了。削减顺序固定：

1. 复制一个 HTML，只留 `<link>` 与出问题的片段，删掉所有 JS 与无关区块。
2. 内容换掉：文字变 `xxx`、图片变空 `div`（怀疑长单词或表格造成的就别删这步）。
3. **删祖先、删兄弟**：一层层往上删，删掉某层问题消失，那层就是根因——立刻去读它的 Computed 值；兄弟越少，越容易看出是 `gap`、margin 合并还是绝对定位在起作用。
4. CSS 只留与现象相关的属性，过渡、阴影、装饰全删。
5. 换数据量：一个正常、十个出问题，往往指向 `flex-basis`、`min-width: auto` 或 margin 合并的临界条件。

压到 30 行以内还不行，**就要怀疑这不是 CSS 问题**，而是数据、构建或运行时注入。要把结论交给别人时四样一起给：Elements 与 Styles 同屏、带盒模型图的**截图**；四行**关键读数**（`getBoundingClientRect()`、`clientWidth`、`box-sizing`、`display`）；赢家规则的**选择器 + 文件:行号**；**最小复现文件**。「我在生产看到的」不是证据——生产是构建产物，样式表顺序与类名哈希都可能与本地不同。

## 三个完整案例

### 案例 A：弹窗加了 `z-index: 9999` 还是被压住

- **现象**：遮罩出现了，弹窗本体在页面内容之下。
- **排查**：①–⑤ 都正常（结构、包含块、盒模型、格式化上下文、`z-index: 9999` 未被划掉）；⑥ 逐层向上读祖先的 Computed——某个祖先上有 `transform: translateZ(0)`，是性能优化时代留下的 hack。
- **根因**：带 `transform` 的祖先创建了新的**层叠上下文（stacking context）**，`9999` 只在这个上下文内部比较，对外整体它只是一个层级很低的盒子。
- **修法**：三选一——弹窗 DOM 移到 `<body>` 直接子级；改用原生 `<dialog>` + `showModal()`（进顶层视口层，不受祖先层叠上下文影响）；或删掉那个 hack。规则见[定位与层叠上下文](/css/positioning-and-stacking)。**验证**：从元素到根逐层打印 `transform` / `filter` / `opacity`，确认不再有创建层叠上下文的属性。

### 案例 B：容器高度塌陷

- **现象**：`.media-card` 的背景只覆盖顶部一条，图文都在背景外。
- **排查**：① `figure` 里是 `float: left` 的 `img` 加一段文字，语义没问题；② 包含块正常；③ 盒模型图：**content 高度读数为 0**，padding 与 border 也都是 0；④ 父级 `overflow: visible`、`display: block` → 没有 BFC，浮动子元素不参与父盒高度计算。
- **根因**：浮动脱离常规流，容器算不出高度。**不是 margin 合并**——content 读数是 0 而不是「比预期小」，第 ③ 步就能把两者分开。
- **修法**：`.media-card { display: flow-root }`。它只为建立 BFC 存在，没有 `overflow: hidden` 的副作用（裁切内容、造出可滚动容器、误伤 `sticky`），也不需要伪元素撑。**验证**：content 高度等于子元素总高，`getBoundingClientRect().height` 从 0 变成实际像素值。

### 案例 C：375px 下出现横向滚动条

- **现象**：移动视口能左右拖约 15px，桌面视口没有。
- **排查**：跑第 1 步脚本，最内层越界元素是 `.hero { width: 100vw }`，`right = 390` 而 `limit = 375`。
- **根因**：`100vw` 是**含滚动条的视口宽度**，有垂直滚动条时它比可用宽度大 15px，必然超宽。
- **修法**：铺满就用 `width: 100%`；确实需要跨滚动条宽度时写 `inline-size: min(100vw, 100%)`，或用 `scrollbar-gutter: stable` 预留空间。**不要用 `body { overflow-x: hidden }`**，它只是把 15px 内容裁掉。**验证**：`console.log(window.innerWidth, document.documentElement.clientWidth)` 两数相等，且定位脚本返回空数组。

## 常见错误与排查：排查时的反模式

### 反模式：无脑加 `!important`

它把一次冲突变成永久债务：要压它得再写一个 `!important`，最后没人敢删。**判据**：加之前先回答「赢我的那条规则选择器是什么、特异性多少」，答不上来说明还没定位到冲突。顺序是补特异性 → 抢加载顺序 → 换属性 → 才轮到它。

### 反模式：`z-index: 9999`

同一层叠上下文里比较的是相对大小，9999 和 10 没有区别，只制造了新债务：下一个要压它的得写 10000。像案例 A 那样先确认祖先有没有创建上下文，再动 `z-index`；需要层级管理就用有限档位（`--z-header: 10`、`--z-modal: 100`），见[值与自定义属性](/css/units-and-custom-properties)。

### 反模式：反复调数值而不预测

`margin-top: -3px` 试到 `-8px` 才对齐——你赢了但不知道为什么，下次它又歪。**每改一个数值前先写下预测值和理由**，预测错的那一格才是本次排查的收获，同 [CSS 领域首页](/css/)学习方法里的「先预测再验证」。

### 反模式：一次改十处

同时调了 `padding`、`gap`、`flex-wrap` 和断点，页面好了，但你无法判断该保留哪一处。**一次只改一个可观察变量**，改完立刻记录，回滚才有意义。

### 反模式：`overflow-x: hidden` 掩盖超宽

症状消失、问题留着，还顺带造出一个内部滚动容器。先跑脚本找越界元素；探针同理用 `outline`，别用 `border`。

### 反模式：只信目测，不把 Computed 读数当成结论

「看起来差不多」不是结论——宽度、高度、`display`、`box-sizing`、`position` 这五个值在 Computed 里有唯一答案。而 Styles 面板里的勾选与编辑**只活在当前会话，刷新即失**，要么当场同步回源文件，要么用 Local Overrides 持久化。

## 练习

<Exercise title="练习 1 · 把盒模型图读数换成脚本读数" difficulty="基础">

某元素在 Computed 盒模型图里显示：content `300 × 120`、padding 上下 12 / 左右 20、border `1px`、margin 上下 16 / 左右 0。写出 `getBoundingClientRect()` 的 `width` 与 `height`、`el.clientWidth`、`el.offsetHeight`，并说明 `box-sizing` 取 `content-box` 与 `border-box` 时这些读数会不会变。

<template #answer>

- `getBoundingClientRect().width = 300 + 20×2 + 1×2 = 342`
- `getBoundingClientRect().height = 120 + 12×2 + 1×2 = 146`
- `el.clientWidth = 300 + 20×2 = 340`（含 padding，不含 border 与垂直滚动条）
- `el.offsetHeight = 146`（border box 高）

`box-sizing` **不改变上面任何一个读数**——盒模型图给出的 content 值已经把它的结果算进去了。它改变的是「你写的 `width: 300px`」落在哪一层：`content-box` 时 `width` 就是 content 的 300；`border-box` 时 `width` 是 border box，content 缩成 `300 - 40 - 2 = 258`。这也是必须看 Computed 而不是读源码 `width` 的原因。

</template>

</Exercise>

<Exercise title="练习 2 · 三种显示形态各对应哪一步" difficulty="基础">

Styles 面板里出现下面三种情况，各说明什么？你的**下一个动作**分别是什么？

1. 你写的 `color: #0a7` 带删除线，上方有一条 `color: #333`，来源是 `vendor.css`。
2. 一条 `.card { padding: 24px }` 整条是灰色的。
3. 你要找的属性不在命中规则区，而在 `Inherited` 分组里。

<template #answer>

1. **层叠来源冲突（第 5 步）**：被框架覆盖。读赢家选择器并数特异性，按「补特异性 → 抢顺序 → 换属性」处理；同档位时靠**加载顺序**而不是书写顺序。
2. **媒体条件未激活**：不是冲突，是压根没参与层叠。开设备工具条把视口改到断点内确认；长期如此该考虑容器查询（见[响应式设计](/css/responsive-design)）。
3. **值来自继承**：你从没在这个元素上写过它。要覆盖就在**这个元素本身**写显式声明，别去祖先身上加权重。

</template>

</Exercise>

<Exercise title="练习 3 · 写一段横向滚动条定位脚本" difficulty="进阶">

写出你自己的定位脚本：找出所有右边越出可用宽度的元素，输出「标签 + 类名 + 越界像素」并按越界程度降序。**要不要过滤 `display: none`？要不要过滤 `opacity: 0`？为什么这两条不一样？**

<template #answer>

```js
const limit = document.documentElement.clientWidth;
[...document.querySelectorAll('body *')]
  .filter((el) => getComputedStyle(el).display !== 'none')
  .map((el) => {
    const r = el.getBoundingClientRect();
    return { el, over: Math.round(r.right - limit), w: Math.round(r.width) };
  })
  .filter((x) => x.over > 0)
  .sort((a, b) => b.over - a.over)
  .forEach((x) => console.log(`${x.el.tagName}.${x.el.className} 超出 ${x.over}px  宽 ${x.w}`));
```

两条过滤逻辑完全不同：

- **`display: none` 必须过滤**：它不参与布局，`getBoundingClientRect()` 返回全 0，既污染输出也不可能是元凶。
- **`opacity: 0` 与 `visibility: hidden` 绝不能过滤**：它们**仍然占位、仍能撑出滚动条**，真凶常是一个停在屏幕外的隐藏抽屉。判断标准是**参与不参与布局**，不是看不看得见。

`over` 最大者未必是根因，**层级最深的那个才是**，外层是被它撑开的。对照成因表：`宽 390 / limit 375` 指向 `100vw`。

</template>

</Exercise>

<Exercise title="练习 4 · 故意制造一次探针毁掉布局" difficulty="挑战">

在下面的网格上把全局探针写成 `* { border: 1px dashed red }` 而不是 `* { outline: 1px dashed red }`。项目已有 `*, *::before, *::after { box-sizing: border-box }`。预测两种写法各自的后果，并解释为什么 border 版本在 `border-box` 下的现象比 `content-box` 时更危险。

```css
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.cell { width: 25%; padding: 12px; }
```

<template #answer>

**outline 版本**：布局逐像素不变，边界画在框外，可以安全观察——这是探针应有的行为。

**border 版本（`border-box` 下）**：`1fr` 轨道宽度不受影响（轨道由容器决定），但每个 `.cell` 的**内容区被吃掉 2px**，`padding: 12px` 的有效间距变成 11px。**盒子外框完全没变**，所以目视看不出探针在改布局，只觉得「换行位置不一样了，可我的规则没动」。

这就是它比 `content-box` 更隐蔽之处：`content-box` 时 border 加在盒子外侧，总宽变成 `25% + 2px`，四格相加超出容器，网格立刻塌或冒出横向滚动条——症状夸张但**因果清晰**，你会马上怀疑探针；`border-box` 时症状轻微、因果隐藏，你更可能带着探针继续改代码。

**结论**：探针必须是**不参与布局的属性**。可选 `outline`（首选）、`box-shadow: inset 0 0 0 1px red`（会盖住已有阴影）；不可选 `border`、`padding`、`margin`、`width`、`min-*`，以及 `transform`——它顺带创建层叠上下文和包含块，会凭空造出案例 A 那种故障。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN · `getBoundingClientRect()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect) —— 核实「`width` / `height` 含 padding 与 border-width、不含 margin」「矩形相对视口」，即第 3 步的读数表与两条推论。
- [MDN · `Element.clientWidth`](https://developer.mozilla.org/en-US/docs/Web/API/Element/clientWidth) —— 核实「含 padding，排除 border、margin 与垂直滚动条」，即横向滚动条脚本里的 `limit`。
- [MDN · `@layer`](https://developer.mozilla.org/en-US/docs/Web/CSS/@layer) —— 核实三条排序规则（后声明的层更高、未分层压过分层、`!important` 时反转），`@layer` 一节以此为准。
- [MDN · `<p>` 元素](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/p) —— 核实「结束标签前解析到另一个块级元素会自动关闭」，即第 1 步「代码里包着、DevTools 里却是平级」的依据。
- [MDN · 层叠（Cascade）](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascade/Cascade) 与 [特异性](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascade/Specificity) —— 第 5 步判读 Styles 面板的理论来源。
- [MDN · 掌握 margin 合并](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_box_model/Mastering_margin_collapsing) —— 案例 B 区分「塌陷」与「穿透合并」。
- [MDN · CSS 定位](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_positioning) 与 [层叠上下文](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_positioning/Understanding_z_index/The_stacking_context) —— 案例 A 的判据。
- [Chrome DevTools 文档入口](https://developer.chrome.com/docs/devtools/) —— Styles、Computed、Layout（盒模型图与 Flexbox/Grid 检查器）、Layers、Rendering、Sources 的权威说明。**本环境访问不到该域名，本章所有面板入口与按钮名称均未经核实**。
- 上一章：[过渡与动画](/css/transitions-and-animations) —— 可过渡属性与合成层，判断「卡顿是样式还是渲染」时要用它。

## 下一章

前 11 章讲「浏览器怎么算」，这一章讲「算错了怎么查」。下一章[阶段项目：响应式产品落地页](/css/project)把两者串成一次交付：导航、主视觉、特性卡片、价格表与表单，跨 320–1920px 可用。它的验收标准里有几条直接是本章内容——全站不用 `!important`、能逐条禁用样式表并说出每个区块由哪些规则负责、卡片用 `auto-fit` / `minmax` 自动增减列。需要回查概念时回到 [CSS 领域首页](/css/)。
