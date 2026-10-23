# CSS 如何生效：来源、层叠、继承与值的计算

## 先看一段「每条规则都没写错」的样式

把下面这段完整存成 `test.html` 用浏览器打开，然后在 Console 里执行 `getComputedStyle(document.querySelector('#c p')).color`。先预测，再验证。

```html
<style>
  #a { color: green;  color: orange; }

  *  { color: purple; }
  #b { color: brown; }

  #c          { color: navy; }
  :where(#c)  { color: teal; }
</style>

<p id="a">A</p>
<p id="b" style="color: red">B</p>
<div id="c"><p>C 里的段落</p></div>
```

常见预测是：A 绿色（先写的规则先适用）、B 棕色（id 比行内强？还是行内比 id 强？）、C 青色或藏青（`#c` 都写了颜色了，子段落要么拿 `:where` 的 teal，要么继承 navy）。

**浏览器实测结果，三个全错：**

| 元素 | 常见预测 | 实测值 | 真正生效的声明 |
| --- | --- | --- | --- |
| `<p id="a">` | `green` | `rgb(255, 165, 0)` = orange | 同一声明块里后写的那条 |
| `<p id="b">` | `brown` | `rgb(255, 0, 0)` = red | 行内 `style` 属性 |
| `#c` 里的 `<p>` | `teal` / `navy` | `rgb(128, 0, 128)` = **purple** | `* { color: purple }` |
| `<div id="c">` 本身 | `teal` | `rgb(0, 0, 128)` = navy | `#c`（`:where()` 特异性为 0，输了） |

第三个最耐人寻味：`<p>` 上你一条针对性的规则都没写，为什么不是继承父元素的 navy，而是被一条 `*` 抢走了？因为**继承不参与层叠比较，它只在「该元素身上没有任何声明」时兜底**，而 `*` 虽然特异性是 `0,0,0`，它终究是这条 `<p>` 自己身上的声明。

预测失败的共同原因只有一个：把「比选择器谁更强」当成了 CSS 生效判断的全部。实际上「哪条声明赢」是一套固定阶段的排序过程（层叠），「元素没有声明时怎么办」是另一套规则（继承），「值最终变成多少像素」又是第三套（值计算）。这三层混在一起，就产生了最难查的两类问题——「明明写了却不生效」和「根本没写却生效了」。

这一章把三层分开讲清楚。本章每条断言都附实测结果，实测环境统一如下。

<Callout type="verified" title="本章实测环境">

- 浏览器：Qoder 内置浏览器，UA 报告 `Chrome/150.0.7871.114` + `Electron/43.1.1`（Chromium 内核），Windows 10 x64。
- 屏幕 `devicePixelRatio = 1.25`，测试页视口宽度 638px。
- 核实时间：2026 年 10 月 16 日。方法：把用例写成静态 HTML 页面，用 `getComputedStyle()` 读浏览器最终算出的值。
- **局限**：只测了这一个内核。凡「所有浏览器行为一致」的说法来自规范而非实测，会在对应位置标注。像素出现 `4.8px`、`23.2px` 这类小数是 DPR 1.25 下的设备像素取整，不是 CSS 规则本身，遇到会单独说明。

</Callout>

## 声明从哪里来：四个来源与六档优先级

浏览器给一个元素算样式时，输入的声明来自四个地方，其中三个是「来源（origin）」：

1. **用户代理来源（UA origin）**：浏览器自带的默认样式表。`<h1>` 天生又大又粗、`<ul>` 天生左侧 40px 内边距、`<p>` 天生上下 1em 外边距，都出自这里。
2. **用户来源（user origin）**：用户装的扩展、油猴脚本、浏览器设置里的「最小字号」「自定义样式表」。
3. **作者来源（author origin）**：**你写的 CSS**。外链样式表、`<style>`、`@import` 进来的、框架注入的，全都算这一档。
4. **行内样式（`style` 属性）**：属于作者来源，但位置特殊，见下文。

每个来源再分「普通」和 `!important` 两档，合起来就是必须记住的六档，**从最低到最高**：

| 优先级 | 档位 |
| --- | --- |
| 最低 | ① UA 普通声明 |
| ↑ | ② 用户普通声明 |
| ↑ | ③ 作者普通声明（你写的绝大多数 CSS） |
| ↑ | ④ 作者 `!important` 声明 |
| ↑ | ⑤ 用户 `!important` 声明 |
| 最高 | ⑥ UA `!important` 声明 |

要点是 **`!important` 会让来源顺序反转**：普通声明里作者赢过用户，都加了 `!important` 后用户赢过作者。这样设计不是为了让你覆盖别人，而是为了让辅助技术用户能覆盖设计者的意图——比如用扩展强制放大全站字号时，需要压得过站点写的 `font-size`。

**行内样式的位置**：在作者来源内，高于样式表里任何选择器的普通声明；但样式表里的 `!important` 又高于普通行内声明。实测三组：

```css
#t_imp_inline2 { color: rgb(200, 0, 0); }             /* 普通，特异性 (1,0,0) */
#t_imp_inline  { color: rgb(70, 70, 70) !important; }
@layer base    { #c6 { color: rgb(77, 77, 77) !important; } }
```

```html
<p id="t_imp_inline2" style="color: rgb(200, 0, 0)">行内普通 vs #id 普通 → 行内赢</p>
<p id="t_imp_inline"  style="color: rgb(200, 0, 0)">样式表 !important vs 行内普通 → !important 赢，实测 rgb(70, 70, 70)</p>
<p id="c6" style="color: rgb(100, 100, 100) !important">行内 !important vs 层内 !important → 行内赢，实测 rgb(100, 100, 100)</p>
```

所以作者来源内部的天花板是「行内 + `!important`」。真需要它的时候，通常说明前面某个环节已经失控了。

<Callout type="warn" title="UA / 用户档压不过">

用户在浏览器设置里的强制样式和扩展注入的样式，用普通作者 CSS 打不赢。典型症状：某页面在你机器上字号莫名变大、颜色被改，在别人机器上正常。排查方向不是你的 CSS——**先开无痕窗口（默认禁用扩展）复现一次**。

</Callout>

## 层叠的五个排序阶段

六档只是**第一个**维度。规范（CSS Cascade Level 5）规定的完整比较顺序是五个阶段：

1. **来源与重要性**（origin & importance）——上面那张六档表。
2. **样式上下文**（context）——只在影子 DOM / `@scope` 里起作用：内层上下文的声明高于外层。
3. **层叠层**（cascade layers）——`@layer` 的顺序，以及「未分层」的特殊位置。
4. **特异性**（specificity）——[第 2 章](/css/selectors)专讲。
5. **出现顺序**（order of appearance）——前四个维度全平时，写在后面的赢。

**逐阶段比较，一旦分出胜负立即停止，后面的维度根本不看。** 这一条解释了最常见的一类困惑：

```css
/* 作者普通声明，特异性 (1,0,0) */
#main .sidebar .widget .title { color: brown; }

/* 作者 !important 声明，特异性 (0,1,0) */
.alert { color: red !important; }
```

第 1 阶段就结束战斗：`.alert` 在第④档，另一条在第③档。**特异性 (1,0,0) 连出场的机会都没有**，最终是红色。实测：`#t_imp_low { color: rgb(144,144,144) }` 对上 `.imp-low { color: rgb(155,155,155) !important }`，结果是 `rgb(155, 155, 155)`。

所以「`!important` 是最高优先级」这句流行说法的准确版本是：**它把声明从第③档抬到第④档，从而越过了第 3、4、5 阶段。**

## 层叠层：用声明顺序替代特异性战争

`@layer` 解决的痛点很具体：大型项目里你控制不了第三方 CSS 什么时候被注入，特异性战争于是退化成「谁写得晚」。

```css
/* 第 1 步：单独一行声明层的顺序（此时不写任何规则） */
@layer reset, base, components, utilities;

@layer reset {
  *, *::before, *::after { box-sizing: border-box; margin: 0; }
}
@layer base {
  h1 { font-size: 2rem; }
}
@layer components {
  .card-title { font-size: 1.25rem; color: #444; }
}
@layer utilities {
  .big { font-size: 2.5rem; }   /* 最后一层最高，不需要 !important 就能压过组件样式 */
}
```

三条实测规则：

| 情形 | 实测 | 结论 |
| --- | --- | --- |
| 分层 vs 分层（普通声明）：`@layer base` 里 1,2,3；`@layer components` 里 7,8,9，同一元素 | 得到 `components` 层的值 | **普通声明：后声明的层赢** |
| 分层 vs 未分层（普通）：`@layer base2{#t_unlayered{color:21,21,21}}` + 其后未分层 `color:22,22,22` | `rgb(22, 22, 22)` | **未分层的普通声明高于所有层** |
| 两边都 `!important`：`@layer base3{#t_unlayered_imp{color:33,33,33 !important}}` + 未分层 `color:44,44,44 !important` | `rgb(33, 33, 33)` | **`!important` 时层序反转：层内赢过未分层，早层赢过后层** |
| 分层 `!important` vs 行内 `!important` | 行内赢（见上一节 `#c6`） | 行内仍是作者来源天花板 |

第三条最容易记反，值得单独背一句：**普通声明「后层 + 未分层」最强，`!important` 全部反过来**。理解方式是把未分层当成「最后一层」——普通时最后一层最强，`!important` 时最强变最弱。

<Callout type="info" title="为什么这值得单独学">

`@layer` 给了一个不依赖特异性的调节手段。只要第三方库自己没用 `!important`，你写一条未分层的声明就能覆盖它，不必把选择器写得又长又脏。这正是第 2 章「特异性越低越好」能够成立的前提。

</Callout>

## 继承：没有声明时的第二条路

子元素身上没有声明时，值不是「空」，而是走两条路之一：**继承父元素的值**，或者用**初始值（initial value）**。规范逐个属性定义了归属，规律是：

- **继承的**：文字相关几乎全继承——`color`、`font-*`、`line-height`、`letter-spacing`、`text-align`、`visibility`、`cursor`、`quotes`、`direction`、`list-style-*`。
- **不继承的**：几何与绘制相关基本都不继承——`margin`、`padding`、`border`、`width`、`height`、`display`、`position`、`background-*`、`overflow`、`z-index`、`box-shadow`。

具体某个属性查 MDN 页面右侧的 "Inherited" 一行。不用背清单，记这句：**继承的是可读性上下文，不继承的是几何与绘制。**

继承有两个反直觉之处，开篇那个例子已经踩中了第一个。

**第一，继承永远输给元素身上的任何声明，哪怕那条声明是 `*`。** 实测：

```css
#c9     { color: rgb(18, 18, 18); }
#c9 > * { color: rgb(19, 19, 19); }   /* 特异性 (1,0,0)，但作用在子元素自己身上 */
```

`#c9` 里的 `<p>` 实测得到 `rgb(19, 19, 19)`。另一组更极端的：`* { color: rgb(122,122,122) }` 对上父元素 `#t_inherit_parent { color: rgb(166,166,166) }`，子 `<p>` 实测是 `rgb(122, 122, 122)`——**特异性 0 的通配符击败了一个 id 的继承值**。

后果很实际：`* { color: ... }`、`* { font-size: ... }` 这类「全局重置」如果连继承属性一起清，会把整站文字颜色搅乱，而且因为继承链被切断，你后面在父容器上改 `color` 完全看不到效果。安全的全局重置只动不继承的属性（`* { box-sizing: border-box; margin: 0 }`）。

**第二，继承发生在「计算值阶段」，不是抄父元素最终的像素值。** 同一件事用两种写法，结果完全不同（实测）：

```css
/* 写法 A：无单位数字 */
#t_em_parent { font-size: 20px; line-height: 1.5; }
#t_em_child  { font-size: 2em; }
/* 实测 #t_em_child：font-size 40px，line-height 60px */

/* 写法 B：带单位 */
#t_lh_px_parent { font-size: 20px; line-height: 30px; }
#t_lh_child     { font-size: 40px; }
/* 实测 #t_lh_child：font-size 40px，line-height 30px */
```

写法 A 继承下来的是 **1.5 这个倍数**，每个元素用自己的字号重新乘（40 × 1.5 = 60）；写法 B 继承下来的是 **30px 这个定值**，字号涨到 40px 也不跟着变，于是 40px 的字挤在 30px 的行里。这就是「行高用无单位数字，别用 px」的实证理由。`em` 和百分比写法同理——它们在计算阶段就用**自己的**字号结算成定值了，同样失去倍数行为。

`em` 的解析基准实测（同一组用例，父 20px）：

```css
#t_em_parent { font-size: 20px; }
#t_em_child  { font-size: 2em; padding-top: 1em; margin-left: 1em; }
```

| 属性 | 写法 | 实测 | 基准 |
| --- | --- | --- | --- |
| `font-size` | `2em` | 40px | **父元素**字号（20 × 2） |
| `padding-top` | `1em` | 40px | **自己**的字号（40 × 1） |
| `margin-left` | `1em` | 40px | **自己**的字号（40 × 1） |

`em` 只在定义 `font-size` 时以父为准，用在别的属性上以自身计算出的字号为准。所以 `font-size: 2em; padding: 1em` 的内边距是 40px 而不是 20px——第一次算错几乎都在这里。想避免连锁缩放就用 `rem`（以根元素字号为基准）。

### 四个 CSS 宽关键字：inherit、initial、unset、revert

它们不是值，是「换个来源取值」的指令：

```css
.card {
  border-top-width: inherit;   /* 强制继承——即使这个属性本身不继承 */
  color: initial;              /* 回到规范初始值，并且不继承 */
  background: unset;           /* 可继承属性→等同 inherit；不可继承属性→等同 initial */
  font-size: revert;           /* 回退到 UA 样式表的值（注意：不是初始值） */
}
```

实测选了 `border-top-width`——它是**非继承属性**，正好能把三个关键字区分开：

```css
#bp0      { border-top-style: solid; border-top-width: 7px; }   /* 父 */
#b_unset  { border-top-style: solid; border-top-width: unset; }
#b_initial{ border-top-style: solid; border-top-width: initial; }
#b_inherit{ border-top-style: solid; border-top-width: inherit; }
```

| 元素 | 写法 | 规范值 | `getComputedStyle` 实测 |
| --- | --- | --- | --- |
| 父 | `7px` | 7px | `6.4px` |
| 子 | `unset` | `medium`（= 3px） | `2.4px` |
| 子 | `initial` | `medium`（= 3px） | `2.4px` |
| 子 | `inherit` | 父的 7px | `6.4px` |

结论：非继承属性上 `unset` ≡ `initial`（都得到 `medium`）；`inherit` 拿到父元素的值——**`inherit` 能让本来不继承的属性继承**，这是它唯一但很有用的存在意义。

至于为什么实测全是 `6.4` / `2.4` 而不是 `7` / `3`：这台显示器 DPR = 1.25，边框宽度要落在整数个设备像素上。`7px × 1.25 = 8.75` 取整为 8 设备像素（`8 ÷ 1.25 = 6.4`），`3px × 1.25 = 3.75` 取整为 3（`3 ÷ 1.25 = 2.4`）。**读实测数字前先确认有没有取整**，否则你会拿「6.4」去反推 CSS 规则，越推越错。

`revert` / `revert-layer` 的精确行为本站**未实测**（要构造出 UA 层和用户层才好测），以 [MDN 值的处理](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Value_processing) 和 [CSS Cascade Level 5](https://drafts.csswg.org/css-cascade-5/) 为准。日常真正常用的只有 `inherit` 和 `unset`。

## 值的一生：specified → computed → used → actual

1. **specified value（指定值）**：你写的那个 token。语法不合法 → 整条声明在**解析阶段**就被丢掉，连层叠都进不去（「拼错属性名既不报错也不生效」的原因）。`inherit` 这类关键字也算指定值。
2. **computed value（计算值）**：做三件事——解析继承、把关键字换成具体值、把「此阶段能确定的绝对长度」算出来。注意 `width: 50%` 的计算值**仍是 50%**（百分比要等布局），而 `font-size: 2em` 的计算值已经是绝对长度。
3. **used value（使用值）**：布局阶段把百分比解析成像素、按可用空间分配，得到真正用于绘制的值。
4. **actual value（实际值）**：绘制阶段再做设备像素取整，就是屏幕像素网格上的最终结果。

**关键坑：`getComputedStyle()` 返回的不总是计算值。** 对 `width`、`height`、`margin-*`、`padding-*` 这类属性它返回 **used value**（实测：`width: 50%` 在 400px 容器里给出 `200px`；`margin-top: 10%` 给出 `40px`）。`line-height` 用无单位数字时给的也是乘好的像素值。别把 `getComputedStyle` 的输出当「计算值」去背规范定义。

百分比的解析基准按属性不同，实测（容器 `width: 400px; height: 100px`，子元素默认 `content-box`）：

| 声明 | 实测 | 基准 |
| --- | --- | --- |
| `width: 50%` | 200px | 包含块**内容宽度** 400px |
| `padding-left: 10%` | 40px | 包含块宽度 400px |
| `margin-top: 10%` | **40px** | **也是宽度 400px，不是高度 100px** |

垂直方向的 `margin` / `padding` 百分比参照**宽度**解析，是 CSS 里最反直觉的规则之一（规范术语是包含块的 **inline size**，横向书写模式下即宽度）。现实后果：想用 `padding: 10%` 做「等比内边距」时，它只跟宽度联动，跟高度无关。

同理，`height: 50%` 需要父元素有**确定高度**才能解析。实测：

```css
#fa  { }                 /* 高度由内容决定 */
#fc  { height: 50%; }    /* 实测 23.2px —— 就是内容自己撑出来的高度，百分比被当成 auto */
#fb  { height: 200px; }
#fc2 { height: 50%; }    /* 实测 100px，解析成功 */
```

「父高度 auto → 子百分比高度失效」不用背，它是 used value 阶段拿不到确定包含块尺寸的必然结果。解决办法见[第 3 章](/css/box-model)与 Flexbox / Grid 章节。

## 常见错误与排查

### 症状：写了样式完全不生效

按这个顺序查，每一步都能否证一个原因：

1. **选择器根本没匹配上。** DevTools 选中元素，看 Styles 面板里有没有你的规则。一条都没有 → 是匹配问题不是优先级问题。Console 验证：`document.querySelectorAll('你的选择器').length`。
2. **声明在解析阶段被丢弃。** 规则出现了，但属性名找不到或显示异常 → 拼错属性名、值不合法、用了当前浏览器不支持的语法。
3. **规则在，但被划了删除线。** → 层叠输了。找到赢家那条规则，看它来自哪个文件、哪个选择器、是否在某个 `@layer` 里。
4. **以上都正常，视觉却不对。** → 你改的属性根本不决定这个视觉。常见误配：`vertical-align`（只对表格单元格和行内盒生效）、`text-align`（管不了 flex 项，要用 `justify-content`）、`margin: auto`（在 flex 容器里含义不同，见第 5 章）。
5. **只在自己机器上不对。** → 先查扩展与浏览器设置（无痕窗口复现），再查该浏览器版本是否支持这个属性。

### 症状：加了 `!important` 反而越来越乱

`!important` 只是把声明抬到第④档。一旦用它压过普通声明，下次冲突就只能靠行内 `!important`，再之后就只剩改 DOM 结构——这是条单行道，越往后越没法收拾。

修复方向是把「优先级问题」换成「结构问题」：用 `@layer` 给样式排序（记住 `!important` 时层序反转），或者收窄选择器的匹配范围（见第 2 章）。

### 症状：一条 `*` 规则引发全站文字变色

`*` 特异性为 0，但它是元素自身的声明，会击败所有继承值（本章实测）。修全局重置时只动不继承的属性；`color`、`font-size` 这类要设在 `body` 或 `:root` 上，让继承链保持完整。

### 症状：字号改了，行高和间距没跟着变

查 `line-height` 用的是无单位数字还是 `px`（本章实测过继承差异）。间距则查是不是 `em`——`em` 以自身字号为基准，父级字号一改就连锁缩放；不想连锁就用 `rem`。

## 练习

<Exercise title="练习 1 · 预测层叠结果" difficulty="基础">

不查浏览器，写出下面三个 `<p>` 的最终颜色，并说明各是在哪个阶段定胜负的：

```html
<style>
  @layer reset, ui;

  #msg  { color: brown; }
  .note { color: green !important; }

  @layer ui { p { color: navy; } }
  p.third   { color: teal; }        /* 未分层 */
</style>

<p id="msg" class="note third">一</p>
<p class="third">二</p>
<p>三</p>
```

<template #answer>

- **第一个：绿色。** 四条规则同时命中。第 1 阶段（来源与重要性）就结束：`.note` 是作者 `!important`（④档），另外三条都是作者普通（③档）。**这一步跟特异性无关**——`.note` 的 (0,1,0) 明明低于 `#msg` 的 (1,0,0)，但比较根本没走到第 4 阶段。
- **第二个：青色。** 候选只剩 `p.third`（未分层普通）和 `@layer ui` 里的 `p`。第 3 阶段：未分层的普通声明高于所有层 → teal（本章实测过的同一形状）。
- **第三个：藏青。** `p.third` 匹配不上（元素没有 `third` 类），`#msg`、`.note` 也匹配不上，只剩 `@layer ui` 的 `p`。

**自查重点**：三个答案分别落在「阶段 1 定胜负」「阶段 3 定胜负」「只有一个候选」。如果三个你都是靠比特异性答对的，那第一个必然答错——说明还在把层叠当特异性单用。

</template>

</Exercise>

<Exercise title="练习 2 · 算出实际尺寸" difficulty="进阶">

```css
.wrap { width: 500px; }
.item { width: 40%; padding: 10%; margin-top: 5%; border: 4px solid; font-size: 20px; }
```

`.item` 是 `.wrap` 的直接子元素，两者都是默认 `box-sizing: content-box`。问：

1. `margin-top` 是多少像素？依据是什么？
2. 左右内边距各多少？内容宽度多少？
3. 元素实际占用的总宽度（含边框）是多少？把 `width` 改成 `90%` 会怎样？

<template #answer>

1. **25px。** 基准是包含块 `.wrap` 的**宽度** 500px（不是高度），500 × 5% = 25px——本章实测过的规则，垂直百分比 margin 参照 inline size。
2. **左右内边距各 50px**（500 × 10%），**内容宽度 200px**（500 × 40%）。
3. 总占宽 = 内容 200 + 内边距 100 + 边框 8 = **308px**，不溢出（`content-box` 下 `width` 只指内容盒）。
   把 `width` 改成 `90%`：内容 450 + 100 + 8 = **558px，比包含块宽 58px，溢出**。

**这题真正的收获在第 3 问**：`content-box` 的溢出风险来自「padding 和 border 被算在 `width` 之外」，你以为宽度是 450，浏览器要的是 558。改成 `box-sizing: border-box` 后 `width: 90%` = 总占宽 450（内容区缩为 450 − 100 − 8 = 342），不再溢出，代价是内容区比你以为的小。取舍细节见[第 3 章](/css/box-model)。

另外注意：`font-size: 20px` 在这里不影响上面任何一条长度——百分比长度参照包含块宽度而非自身字号。若把 `padding` 写成 `10em`，就变成 200px（20 × 10）。

</template>

</Exercise>

<Exercise title="练习 3 · 用 getComputedStyle 证实或推翻你的假设" difficulty="挑战">

打开任意一个真实网站，找一个「看起来间距不对」的元素，完成：

1. 读出它的 `margin-top`、`padding-top`、`height`、`font-size`。
2. 判断这些值分别处在值链路的哪一站（计算值还是使用值），依据是什么。
3. 找到赢家声明来自哪个文件 / 哪一层，说明它为什么赢。

<template #answer>

这题没有标准答案，验收标准是**每条结论背后都有一份读出来的数据**，而不是「我觉得应该是这样」。

参考做法：

1. Console 执行：
   ```js
   const el = document.querySelector('你选的 selector');
   const cs = getComputedStyle(el);
   ['marginTop','paddingTop','height','fontSize'].forEach(p => console.log(p, cs[p]));
   ```
   返回的是像素值 → 说明该属性已解析到可直接用于布局的程度。对 `height` / `margin` / `padding`，`getComputedStyle` 给的是**使用值**（百分比已算完）。
2. 先读 `window.devicePixelRatio`。不是整数（本站实测环境 1.25）时，出现 `6.4px`、`23.2px` 这类值优先按取整处理，别急着找 CSS 解释——本章 `border-top-width` 那组就是这么踩的。
3. 找赢家：DevTools → 选中元素 → **Computed** 面板（不是 Styles）。Computed 显示的是最终值和它的来源，不受删除线折叠干扰；Styles 面板只列出参与比较的声明。排查层叠结果时前者更可靠。
4. 若样式来自第三方库，注意它可能已经在某个 `@layer` 里而你没分层——按本章实测表，**未分层的普通声明高于所有层**。这往往是「随手一行就能覆盖组件库样式」的真正原因，和特异性无关。

**诚实要求**：某一步读不出来（值来自影子 DOM、被扩展注入的样式搅乱等），就在结论里写「未核实」，不要补一个听起来合理的原因。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN · 层叠（Cascade）](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Cascade) —— 「六档优先级」与「排序阶段」的权威来源，含 `!important` 反转来源顺序的说明。
- [CSS Cascade Level 5（W3C 草案）](https://drafts.csswg.org/css-cascade-5/) —— 层叠排序算法的完整定义，含 `@layer`、`revert-layer`、宽关键字。本章所有排序结论的出处。
- [CSS Cascade Level 4](https://drafts.csswg.org/css-cascade-4/) —— Level 5 尚未定稿时的稳定版本，内容基本一致。
- [MDN · `@layer`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/@layer) —— 分层写法、「未分层 vs 分层」「`!important` 时层序反转」的说明。
- [MDN · 继承（Inheritance）](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Inheritance) —— 属性是否继承的查询入口。
- [MDN · 值的处理（Value processing）](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Value_processing) —— specified / computed / used 三站的规范定义。
- [MDN · Computed value](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Computed_value) 与 [MDN · Used value](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Used_value) —— 解释「为什么 `getComputedStyle` 给我像素而不是百分比」。
- [MDN · `inherit`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/inherit) / [`initial`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/initial) / [`unset`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/unset) —— 三个关键字的行为矩阵。
- [MDN · `window.getComputedStyle()`](https://developer.mozilla.org/zh-CN/docs/Web/API/Window/getComputedStyle) —— 本章实测所用的 API，注意它「返回值可能是使用值」的说明。
- [CSS Values and Units Level 4](https://drafts.csswg.org/css-values-4/) —— 长度单位、百分比解析基准、`calc()` 的定义来源。
- [MDN · CSS 长度单位 `length`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/length) —— `em` / `rem` / `ex` / `vh` 各自参照什么。

## 下一章

层叠第 4 阶段是特异性，也是最容易被滥用的一个维度。[第 2 章：选择器与特异性](/css/selectors)讲怎么算、怎么在不依赖 `!important` 的前提下保证自己的规则能赢，以及为什么「特异性低」反而是好设计。
