# 表格：结构、表头关联与可访问性

表格是 HTML 里少数几个「结构写错就会静默降级」的元素族。它不像 `<p>` 里塞 `<div>` 那样有明显的视觉异常，也不像表单少个 `name` 那样立刻丢数据——一个表头没关联好的表格，在浏览器里看起来完全正常，只有用屏幕阅读器的人才知道它坏掉了。

这一章的目标不是记住 8 个标签名，而是理解三件事：

1. **表格有一套严格的解析规则**，写错标签顺序时解析器会替你「猜」，而猜的结果不一定符合你的意图；
2. **单元格与表头的关联关系是表格语义的全部**，`scope` 和 `headers` 这两个属性决定了辅助技术能否读懂你的表；
3. **表格是响应式布局里最难的一块**，你必须提前知道有哪几种方案、各自的代价是什么。

---

## 一、什么时候该用 `<table>`

判断标准只有一条：**这份数据是不是二维的、行列都有含义的？**

| 场景 | 该用什么 | 原因 |
| --- | --- | --- |
| 商品价格表、成绩单、参数对照表 | `<table>` | 天然的二维数据，行和列都有语义 |
| 日历、时间表 | `<table>` | 单元格位置本身就是信息（星期几 × 第几节） |
| 一列标签 + 一列值的「设置项」 | 视情况，可用 `<table>` 或 `<dl>` | 如果确实是两列数据，表格更合适；如果是「术语—解释」，`<dl>` 语义更准 |
| 页头 / 侧栏 / 正文的三栏布局 | `<div>` + CSS Grid 或 Flexbox | 布局不是数据，用表格会让屏幕阅读器宣告「表格，3 行 2 列」这种无意义信息 |
| 一组并排的商品卡片 | `<ul>` + CSS Grid | 卡片是列表项，不是表格单元格 |
| 用 `<br>` 模拟的行、用空格对齐的列 | 都不行 | W3C 无障碍教程明确点名这是错误做法 |

<Callout type="danger" title="表格布局不是「过时」，是「语义错误」">

很多老教程说「不要用表格布局，因为表格加载慢」。这个理由在今天是次要的。真正的理由是：屏幕阅读器读到 `<table>` 会先宣告「表格，共 N 行 M 列」，然后允许用户按单元格跳转。如果你的表格实际是个布局容器，这些宣告全是噪音，而用户按单元格导航时会跳到毫无关系的碎片上。

如果确实要维护一个历史遗留的表格布局，W3C 的建议是加上 `role="presentation"`，告诉辅助技术「这不是数据表格，别宣告结构」。但这是补救措施，不是推荐做法。

</Callout>

---

## 二、完整结构与内容模型

一个数据表格能包含的元素远不止 `tr` / `td`：

```html
<table>
  <caption>2026 年第一季度各区域销售额</caption>

  <colgroup>
    <col />
    <col span="2" />
  </colgroup>

  <thead>
    <tr>
      <th scope="col">区域</th>
      <th scope="col">销售额（万元）</th>
      <th scope="col">同比增长</th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <th scope="row">华东</th>
      <td>1,240</td>
      <td>+18%</td>
    </tr>
    <tr>
      <th scope="row">华南</th>
      <td>860</td>
      <td>+7%</td>
    </tr>
  </tbody>

  <tfoot>
    <tr>
      <th scope="row">合计</th>
      <td>2,100</td>
      <td>+13%</td>
    </tr>
  </tfoot>
</table>
```

各元素的职责：

| 元素 | 职责 | 是否必需 |
| --- | --- | --- |
| `<caption>` | 表格的**可见标题**，必须是 `<table>` 的第一个子元素 | 推荐，无障碍要求 |
| `<colgroup>` / `<col>` | 按**列**分组，用于给整列设置样式 | 可选 |
| `<thead>` | 表头行组，一个表格最多一个 | 推荐 |
| `<tbody>` | 数据行组，可以有多个（用于分段） | 可选，但解析器会隐式补上 |
| `<tfoot>` | 汇总行组，一个表格最多一个 | 可选 |
| `<tr>` | 行 | 必需 |
| `<th>` | 表头单元格 | 数据表必需 |
| `<td>` | 数据单元格 | 必需 |

### 2.1 `<tfoot>` 的位置：一个反直觉的规则

按视觉逻辑，`<tfoot>` 应该在最后，源码里也确实通常写在最后。但这里有个历史反转：

- **HTML 4** 要求 `<tfoot>` 写在 `<tbody>` **之前**（理由是：浏览器可以在下载完表体和表尾之前先渲染表尾，方便长表格）；
- **HTML5 之后（现行标准）** 要求 `<tfoot>` 出现在 `<caption>`、`<colgroup>`、`<thead>`、`<tbody>`、`<tr>` **之后**。

MDN 的 `<tfoot>` 页面明确记录了这次反转。如果你在读一份 2010 年前后的教程，它教的可能是旧规则。

<Callout type="info" title="为什么写对位置很重要">

解析器对表格内容有一套「in table」插入模式（第 1 章讲过）。位置不对的 `<tfoot>` 不会报错，但可能被挪到别处，或者直接触发 foster parenting 被挤出表格。这种错误在浏览器里看不出来，只有跑 W3C 校验器才发现。

</Callout>

### 2.2 解析器会替你补 `<tbody>` 和 `<colgroup>`

这一点直接来自规范的解析算法。在「in table」插入模式下：

- 遇到 `td`、`th`、`tr` 的开始标签 → **先插入一个没有属性的 `<tbody>`**，切换到「in table body」模式，再重新处理当前 token；
- 遇到 `col` 的开始标签 → **先插入一个没有属性的 `<colgroup>`**，切换到「in column group」模式，再重新处理。

所以这段源码：

```html
<table>
  <tr><td>1</td><td>2</td></tr>
</table>
```

实际生成的 DOM 是：

```html
<table>
  <tbody>
    <tr><td>1</td><td>2</td></tr>
  </tbody>
</table>
```

**自己验证**：把上面三行源码存成 `.html` 双击打开，F12 → Elements 面板，你会看到 `<tbody>` 确实存在，尽管你没写。

这带来两个非常实际的后果：

**后果一：CSS 子代选择器会失效。**

```css
/* 源码里没有 tbody，这条永远匹配不到 */
table > tr { background: #fff; }

/* 这条才对 */
table > tbody > tr { background: #fff; }
```

**后果二：在 Vue / React 的模板里手写 `<tr>` 会更麻烦。** 这两个框架的模板编译器不做 HTML 解析纠错（Vue 3 的模板编译器有自己的解析器，但组件树最终还是要落到真实 DOM 上）。把 `<tr>` 直接写在 `<table>` 下、或者在 `<table>` 里放自定义组件，可能得到和预期不同的结构。稳妥做法是**始终显式写出 `<tbody>`**。

### 2.3 表格里不能直接放别的元素

`<table>` 的直接子元素只能是上面表格中列出的那几个。写：

```html
<table>
  <div>说明文字</div>
  <tr><td>1</td></tr>
</table>
```

那个 `<div>` 会被 **foster parenting** 到 `<table>` 之前（第 1 章讲过这个机制，规范原文的注释就写着「Foster parenting happens when content is misnested in tables」）。DOM 结构变成：

```html
<div>说明文字</div>
<table>
  <tbody><tr><td>1</td></tr></tbody>
</table>
```

想给表格加说明文字，用 `<caption>`；想加脚注，放在表格外面。

---

## 三、`<th scope>`：表格语义的核心

这是整章最重要的一节。

### 3.1 没有 `scope` 会怎样

先看不写 `scope` 的版本：

```html
<table>
  <thead>
    <tr><th>姓名</th><th>语文</th><th>数学</th></tr>
  </thead>
  <tbody>
    <tr><td>张三</td><td>85</td><td>92</td></tr>
  </tbody>
</table>
```

在浏览器里看完全正常。但屏幕阅读器用户导航到 `85` 这个单元格时，需要知道两件事：这个 `85` 属于哪一行（张三）、属于哪一列（语文）。

规范里 `<th>` 的 `scope` 属性有一个 `auto` 状态，浏览器和辅助技术会**尝试推断**。对于这种「第一行全是列头、第一列全是数据」的规整简单表格，推断通常是对的。但推断是启发式的，一旦表格稍微复杂一点（第一列也是 `<th>`、有合并单元格、有多个 `<tbody>` 分段），推断就可能出错，而且**出错时不会有任何提示**——用户听到的是错误的表头，你收不到任何报错。

所以规则很简单：**只要是数据表格，就给每个 `<th>` 写 `scope`。** 这一个属性的成本几乎为零，收益是确定性的。

### 3.2 `scope` 的取值

规范定义了 5 个状态：`row`、`col`、`rowgroup`、`colgroup`、`auto`。

| 值 | 含义 | 什么时候用 |
| --- | --- | --- |
| `col` | 这个表头是**它所在列**的表头 | 写在 `<thead>` 里的横向表头 |
| `row` | 这个表头是**它所在行**的表头 | 写在每行第一格的纵向表头 |
| `colgroup` | 这个表头是它所属 `<colgroup>` 内所有列的表头 | 多级表头的上层，跨列 |
| `rowgroup` | 这个表头是它所属行组（`<thead>`/`<tbody>`/`<tfoot>`）内所有行的表头 | 多级表头的上层，跨行 |
| `auto` | 让浏览器推断（默认值） | **不要用**，除非是极简表格 |

最常见的模式是「双向表头」：

```html
<table>
  <caption>2026 年上半年课程完成情况</caption>
  <thead>
    <tr>
      <td></td>                <!-- 左上角空格，见下方说明 -->
      <th scope="col">计划章节</th>
      <th scope="col">已完成</th>
      <th scope="col">完成率</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">HTML</th>
      <td>11</td>
      <td>7</td>
      <td>64%</td>
    </tr>
    <tr>
      <th scope="row">CSS</th>
      <td>18</td>
      <td>3</td>
      <td>17%</td>
    </tr>
  </tbody>
</table>
```

<Callout type="warn" title="左上角那个空格用什么元素">

表头行的第一格如果本身不是表头（它是纵向表头列的起始位置），用 `<td>` 还是 `<th>`？

两种都有人用。区别在于：用 `<th scope="col">` 会让屏幕阅读器宣告一个内容为空的列头；用 `<td>` 则不会。更稳妥的写法是写 `<th scope="col">` 并填上有意义的文字（比如「课程」），因为空单元格对使用语音导航的人来说是个黑洞。如果确实没内容可填，用 `<td>`。

无论哪种，**不要留成 `<th>` 又不写 `scope`**——那正是推断出错的典型场景。

</Callout>

---

## 四、多级表头：`headers` / `id`

`scope` 只能表达「这个单元格属于这一行/这一列」。当表头有多层时，一个数据单元格可能同时属于两个列头，这时需要显式关联。

### 4.1 两级列头

```html
<table>
  <caption>2026 年各季度销售额（单位：万元）</caption>
  <thead>
    <tr>
      <th id="region" rowspan="2" scope="col">区域</th>
      <th id="h1" colspan="2" scope="colgroup">上半年</th>
      <th id="h2" colspan="2" scope="colgroup">下半年</th>
    </tr>
    <tr>
      <th id="q1" scope="col">Q1</th>
      <th id="q2" scope="col">Q2</th>
      <th id="q3" scope="col">Q3</th>
      <th id="q4" scope="col">Q4</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row" headers="region">华东</th>
      <td headers="h1 q1">1240</td>
      <td headers="h1 q2">1310</td>
      <td headers="h2 q3">1180</td>
      <td headers="h2 q4">1420</td>
    </tr>
  </tbody>
</table>
```

要点：

- 每个作为表头的 `<th>` 都要有唯一的 `id`；
- 数据单元格用 `headers` 属性列出**从外层到内层**所有相关表头的 `id`，用空格分隔；
- 顺序有意义：屏幕阅读器通常按你写的顺序朗读，所以先写「上半年」再写「Q1」，用户听到的是「上半年 Q1 1240」而不是反过来；
- 跨列的上级表头用 `scope="colgroup"`，跨行的用 `scope="rowgroup"`。

### 4.2 不规则表格

W3C 无障碍教程专门有一节讲「irregular tables」——比如某个单元格跨了 3 行，或者表格中间有分段小标题行。这类表格 `scope` 推断几乎必然失败，**必须**用 `headers` / `id` 显式标注。

### 4.3 更好的方案：拆表

W3C 的建议里有一条很容易被忽略：**复杂表格优先考虑拆分**。

一个有三级表头、跨行跨列的巨型表格，即便 `headers` 全标对了，屏幕阅读器用户听起来也是「2026 年 上半年 Q1 华东 1240」这样一长串。真正的解决办法往往不是把标注做得更精细，而是：

- 拆成两个表格，每个表格结构简单；
- 把「上半年 / 下半年」从表头层级变成两列数据；
- 把跨行的分类标题变成表格外的 `<h2>` + 各自的小表格。

<Callout type="info" title="这是一个设计问题，不是标注问题">

如果你发现自己在写第 5 个 `headers` 引用，停下来问一句：这份数据的呈现方式本身是不是有问题？扁平化的结构对所有人（包括视力正常的用户）都更好读。

</Callout>

---

## 五、合并单元格：表格模型的槽位算法

`colspan` 和 `rowspan` 是最容易写错、也最容易「看起来对但其实错位」的两个属性。理解它们需要先理解**表格模型**。

### 5.1 表格是一张网格，不是一串行

HTML 规范里的表格模型是一个二维网格（table model）。每个单元格占据网格中的一个或多个槽位（slot）。解析器按下述规则填充：

1. 逐行处理；
2. 在每一行内，从左往右找**第一个还没被占用的槽位**，把当前单元格放进去；
3. 如果单元格有 `colspan="N"`，它占据横向 N 个槽位；
4. 如果有 `rowspan="M"`，它同时占据下方 M-1 行中对应列的槽位——**这些槽位会被标记为已占用**。

关键点在第 4 条：**上一行的 `rowspan` 会「吃掉」下一行的格子位置。**

### 5.2 一个典型的错位 bug

需求：三行数据，第一列是分类，「前端」跨两行。

```html
<!-- 错误写法 -->
<table>
  <tr>
    <th rowspan="2">前端</th>
    <td>HTML</td>
  </tr>
  <tr>
    <td>CSS</td>
    <td>多余的一格</td>   <!-- 这里多写了 -->
  </tr>
</table>
```

第二行只该有 1 个格子（因为第一列的槽位被上一行的 `rowspan` 占了），你写了 2 个，结果表格多出一列，且这一列没有表头。视觉上是「多了一列空表头」，屏幕阅读器读到的则是完全错乱的结构。

正确写法：

```html
<table>
  <caption>课程分类</caption>
  <thead>
    <tr>
      <th scope="col">分类</th>
      <th scope="col">课程</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row" rowspan="2">前端</th>
      <td>HTML</td>
    </tr>
    <tr>
      <td>CSS</td>
    </tr>
  </tbody>
</table>
```

### 5.3 排查错位的方法

**方法一：数格子。** 在脑子里（或在注释里）画网格。每一行「显式格子数 + 从上方 rowspan 继承的格子数」必须等于总列数。

**方法二：用控制台验证。** 打开 F12 Console：

```js
// 打印表格的实际网格尺寸和每行单元格数
const t = document.querySelector('table')
const rows = [...t.querySelectorAll('tr')]
console.table(rows.map((tr, i) => ({
  行: i,
  单元格数: tr.children.length,
  内容: [...tr.children].map(c => `${c.tagName}:${c.textContent.trim()}`).join(' | ')
})))
```

<Callout type="unverified" title="这段代码未在本项目中实际运行">

以上脚本依据标准 DOM API（`querySelectorAll`、`Element.children`、`console.table`）编写，语法真实，但未在本课程环境里运行验证过。它的逻辑很简单，如果表格结构正常，每行的「单元格数」应当符合你的预期（含 rowspan 的行会少一些）。

</Callout>

**方法三：用 W3C 校验器。** [https://validator.w3.org/nu/](https://validator.w3.org/nu/) 能直接报出「表格行单元格数不一致」这类错误。这是阶段项目的验收标准之一。

### 5.4 `abbr`：给长表头一个短读法

表头文字很长时（比如「2026 年第一季度销售额同比增长率」），屏幕阅读器每读一个单元格都要念一遍全称，非常折磨人。`<th abbr="Q1 同比">` 可以给辅助技术提供一个短版本：

```html
<th scope="col" abbr="Q1 同比">2026 年第一季度销售额同比增长率</th>
```

`abbr` 只在 `<th>` 上有意义。视觉显示不变，只有辅助技术使用它。

---

## 六、`<caption>`：可见的表格标题

`<caption>` 必须是 `<table>` 的第一个子元素，内容会显示在表格上方（可以用 CSS `caption-side: bottom` 改到下方）。

它和 `<h2>` + `<table>` 的区别：

| 写法 | 屏幕阅读器行为 | 适用场景 |
| --- | --- | --- |
| `<caption>` | 进入表格时立即宣告标题，与表格绑定 | 表格自身需要一个标题 |
| `<h2>` 在表格上方 | 标题属于页面结构，进表格时不宣告 | 表格是某个章节的全部内容 |
| 两个都写 | 会有重复 | 不推荐 |

对于页面中一个独立的、可能被单独引用或截取的数据表格，**用 `<caption>`**。W3C 无障碍教程把「提供表格标题」列为基本要求。

### 6.1 `summary` 属性已经废弃

老教程里可能提到 `<table summary="这个表格展示了……">`。这个属性用于给屏幕阅读器提供一段不可见的表格说明。**它已从现行标准中移除**，不要再用。

如果需要给表格一段较长的、不适合放进 `<caption>` 的说明，用：

```html
<table aria-describedby="sales-note">
  <caption>2026 年第一季度各区域销售额</caption>
  <!-- ... -->
</table>
<p id="sales-note">数据口径：含税、不含退货，统计截止 2026-03-31。</p>
```

`aria-describedby` 的机制在第 6 章（表单）讲错误提示时已经出现过，这里是同一个用法：把一个可见元素的文本关联到另一个元素上，供辅助技术朗读。

---

## 七、`<colgroup>` / `<col>`：按列设置样式

CSS 选择器能选中「第 3 列的所有单元格」吗？不能——CSS 没有「父选择器」能反查，`td:nth-of-type(3)` 只能选中每行的第 3 个 `<td>`，一旦某行有 `colspan` 或者第一格是 `<th>`，索引就错位了。

`<col>` 就是为这个场景存在的：

```html
<table>
  <colgroup>
    <col class="col-name" />
    <col span="3" class="col-num" />
  </colgroup>
  <!-- ... -->
</table>
```

`span="3"` 表示这个 `<col>` 代表连续 3 列。`<col>` 是**空元素**（第 1 章列的 14 个 void element 之一），不能有子内容。

### 7.1 只有 4 个属性对 `<col>` 生效

这是一个非常反直觉的限制。MDN 明确写着「Only a limited number of CSS properties affect `<col>`」。生效的只有：

| 属性 | 行为 | 注意 |
| --- | --- | --- |
| `background` | 给该列所有单元格上背景色 | 绘制在行组（thead/tbody/tfoot）背景**之后**、表格背景**之前**。上层不透明就看不见 |
| `border` | 给该列单元格加边框 | **只在 `border-collapse: collapse` 时生效** |
| `width` | 设置列的最小宽度 | 行为类似 `min-width` |
| `visibility` | 只有 `collapse` 值有效，隐藏整列 | 其他值（如 `hidden`）无效 |

`text-align`、`color`、`font-size`、`padding` 这些写在 `<col>` 上**统统无效**——因为 `<col>` 不是单元格的父元素，CSS 继承链走不通。

要给整列设置对齐方式，还是得回到单元格：

```css
/* 数字列右对齐 */
td:nth-of-type(3),
td:nth-of-type(4) {
  text-align: right;
}
```

或者给单元格加 class（更稳，不受 colspan 影响）：

```html
<td class="num">1240</td>
```

```css
td.num, th.num { text-align: right; }
```

<Callout type="info" title="那 colgroup 还有什么用">

三件事：给整列上背景色（斑马纹之外的另一种强调，比如高亮「合计」列）、设置列宽、以及用 `visibility: collapse` 隐藏列。如果你不需要这三件事，可以不写 `<colgroup>`。

</Callout>

---

## 八、表格的默认样式

浏览器的 UA stylesheet（第 2 章提过这个概念）给表格元素设了一些默认值，它们经常和设计稿冲突：

| 元素 | 默认样式（典型值） | 常见的意外 |
| --- | --- | --- |
| `<table>` | `display: table; border-collapse: separate; border-spacing: 2px` | 单元格之间有 2px 缝隙 |
| `<th>` | `font-weight: bold; text-align: center` | **表头默认居中**，但设计稿通常要左对齐 |
| `<td>` | `text-align: left`（在 LTR 下） | — |
| `<caption>` | `text-align: center; caption-side: top` | 居中，通常要改 |

所以最常见的两条重置：

```css
table {
  border-collapse: collapse;   /* 合并边框，去掉 2px 缝隙 */
  width: 100%;
}

th {
  text-align: left;            /* 覆盖默认的居中 */
  font-weight: 600;
}
```

### 8.1 `border-collapse` 的两种模式

| 值 | 效果 | 附带影响 |
| --- | --- | --- |
| `separate`（默认） | 每个单元格有独立边框，格子之间有 `border-spacing` 的间距 | `<col>` 上的 `border` **无效** |
| `collapse` | 相邻边框合并成一条，取更「强」的那个（宽度、样式、颜色按规则竞争） | `<col>` 上的 `border` 生效；`border-spacing` 无效 |

`collapse` 模式下有个经典坑：**`position: sticky` 的表头在部分浏览器上不生效**，因为合并边框的实现方式让 `thead` 不再是独立的定位上下文。解决办法是给 `th` 而不是 `thead` 设 sticky：

```css
thead th {
  position: sticky;
  top: 0;
  background: var(--bg);   /* sticky 表头必须有背景，否则滚动时内容会透过来 */
}
```

<Callout type="unverified" title="sticky 表头的兼容性请自行核实">

`position: sticky` 在表格元素上的行为在不同浏览器和不同版本之间有过多次变化，且和 `border-collapse` 的取值相关。上面的写法是社区里流传最广的方案，但**本站未在真实浏览器中逐项验证过当前各版本的表现**。实现前请查 MDN 的 `position` 兼容性表格，并在你的目标浏览器里实测。

</Callout>

### 8.2 对齐：W3C 的明确建议

W3C 无障碍教程「Tips and Tricks」一节里给了一条具体建议：**文本左对齐，数字右对齐。**

原因是数字的位数不同。左对齐时：

```
1240
860
12000
```

你没法一眼比较大小，因为个位没对齐。右对齐后：

```
 1240
  860
12000
```

数量级立刻清晰。这不是审美偏好，是可读性和无障碍的双重要求。

```css
td.num { text-align: right; font-variant-numeric: tabular-nums; }
```

`font-variant-numeric: tabular-nums` 让所有数字等宽，多行数字才能真的对齐（默认的比例字体里 `1` 比 `0` 窄）。

<Callout type="warn" title="text-align: right 在阿拉伯语等 RTL 语言下是反的">

如果你的站点要支持从右到左的语言，用逻辑属性 `text-align: end` / `text-align: start`，或者 `inset-inline-end` 系列，而不是物理方向。本教程只讲中文站点，但知道这个区别能避免以后踩坑。

</Callout>

---

## 九、排序：HTML 没有原生能力

必须说清楚：**HTML 不提供表格排序。** 没有 `sortable` 属性，点击 `<th>` 不会有任何反应。排序必须用 JavaScript 实现。

HTML 在排序这件事上唯一提供的是**状态标记**：`aria-sort`。

```html
<th scope="col" aria-sort="ascending">
  <button type="button">销售额</button>
</th>
```

| `aria-sort` 值 | 含义 |
| --- | --- |
| `ascending` | 升序 |
| `descending` | 降序 |
| `none` | 可排序但当前未排序 |
| `other` | 其他排序方式 |

三个实践要点：

1. **表头里的排序控件要用 `<button>`**，不能让整个 `<th>` 可点击。第 4 章讲过链接和按钮的区别，这里同理：排序是个动作，不是导航。
2. **只有当前排序的那一列写 `aria-sort`**，其他列写 `none` 或不写。全部写 `ascending` 是无意义的。
3. **排序后要更新 `aria-sort`**，否则屏幕阅读器用户不知道顺序变了。更完善的做法是用 `aria-live` 区域播报「已按销售额升序排列」——这属于 ARIA 的进阶用法，在无障碍章节展开。

---

## 十、空数据状态

表格没有数据时，不要渲染一个只有表头的空框，也不要渲染成 `null`。用一行跨所有列的说明：

```html
<table>
  <caption>我的学习记录</caption>
  <thead>
    <tr>
      <th scope="col">领域</th>
      <th scope="col">开始时间</th>
      <th scope="col">完成度</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3" class="empty">
        还没有学习记录。<a href="/guide/roadmap.html">从学习路线开始</a>
      </td>
    </tr>
  </tbody>
</table>
```

要点：

- `colspan` 的值必须等于**实际列数**，写小了会错位，写大了会被截断（不会报错，但校验器会警告）；
- 空状态里最好给一个**下一步动作**（链接或按钮），而不是只写「暂无数据」；
- 这一行放在 `<tbody>` 里，不是 `<tfoot>`。

---

## 十一、响应式表格：三种方案

表格是响应式布局里最难处理的东西，因为它的宽度由内容决定，且不能自由换行。三种主流方案各有代价：

### 方案 A：横向滚动（最简单，最常用）

```html
<div class="table-wrap" tabindex="0" role="region" aria-label="2026 年各季度销售额，可横向滚动">
  <table>...</table>
</div>
```

```css
.table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;  /* iOS 惯性滚动，旧版本需要 */
}
```

**`tabindex="0"` 是必需的，不是可选的。** 一个 `overflow: auto` 的容器，如果内容没有可聚焦元素，键盘用户**无法滚动它**——滚轮和触摸可以，Tab 键不行。加上 `tabindex="0"` 让容器本身可获得焦点，方向键才能滚动。这是 WCAG 2.1 成功准则 2.1.1（Keyboard）的要求。

配 `role="region"` + `aria-label` 是为了让屏幕阅读器用户能感知「这里有一个可滚动区域」并知道它是什么。

**代价**：手机上要横滑才能看全，用户可能不知道右边还有内容。缓解办法是给容器加一个右侧渐隐遮罩提示可滚动，或者配合方案 C 隐藏次要列。

### 方案 B：卡片式堆叠（手机上最好读）

用 CSS 把每一行变成一个块，每个单元格前面用 `data-label` 显示它的列名：

```html
<table>
  <thead>
    <tr>
      <th scope="col">领域</th>
      <th scope="col">章节数</th>
      <th scope="col">完成度</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td data-label="领域">HTML</td>
      <td data-label="章节数">11</td>
      <td data-label="完成度">64%</td>
    </tr>
  </tbody>
</table>
```

```css
@media (max-width: 640px) {
  thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  table, tbody, tr, td { display: block; width: 100%; }
  tr { border: 1px solid #ddd; border-radius: 8px; margin-bottom: 12px; padding: 8px; }
  td::before { content: attr(data-label); font-weight: 600; margin-right: 8px; }
}
```

隐藏 `thead` 用的是标准的「视觉隐藏但对屏幕阅读器可见」技巧（`clip-path: inset(50%)` + 1px 尺寸），**不要用 `display: none`**——那会让屏幕阅读器也读不到列名，而列名信息已经转移到 `data-label` 上了，但表头行本身的结构语义会丢。

**代价**：`data-label` 是手写冗余，表头改了要同步改每一行。用模板引擎生成时可以自动化；纯手写 HTML 时这是个维护负担。而且行与行之间的**横向对比能力消失了**——你没法再一眼扫一列。所以这个方案适合「每行是独立实体」（订单列表、文章列表），不适合「需要纵向比较的数据」（统计报表）。

### 方案 C：按断点隐藏次要列

```css
@media (max-width: 640px) {
  .col-secondary { display: none; }
}
```

**代价**：信息直接丢失。必须确保隐藏的列真的是次要的，并且用户有办法看到完整数据（比如点进详情页）。

### 怎么选

| 情况 | 推荐方案 |
| --- | --- |
| 列数少（≤5），内容不长 | A：横向滚动 |
| 列数多，每行是独立实体（列表） | B：卡片堆叠 |
| 统计报表，需要纵向比较 | A，且**不要**用 B |
| 有明确的主次之分，次要列可牺牲 | A + C 组合 |

本站采用的就是方案 A（VitePress 默认的表格样式带横向滚动容器）。

---

## 十二、常见错误与排查

**症状 1：CSS 里写了 `table > tr`，样式不生效。**
原因：解析器隐式插入了 `<tbody>`。改成 `table > tbody > tr`，或者用后代选择器 `table tr`。验证方法：F12 → Elements 面板看实际 DOM。

**症状 2：单元格之间有 2px 的空隙，边框看起来是双层的。**
原因：`border-collapse` 默认是 `separate`。加上 `border-collapse: collapse`。

**症状 3：表格在手机上撑破了页面，出现整个页面的横向滚动条。**
原因：表格宽度由内容决定，`overflow` 默认 `visible`，长内容会把父容器撑开。解决：给表格外套一个 `overflow-x: auto` 的容器（方案 A），并给容器加 `tabindex="0"`。

**症状 4：屏幕阅读器读单元格时只念数值，不念表头。**
原因：用了 `<td>` 而不是 `<th>` 做表头，或者 `<th>` 没写 `scope` 且表格结构不规则导致推断失败。解决：所有表头用 `<th>` + 显式 `scope`；复杂表格用 `headers`/`id`。

**症状 5：`rowspan` 之后表格多出一列，最后一列没有表头。**
原因：被 rowspan 占用的槽位，在后续行里你又写了单元格。解决：数格子——每行「显式格子 + 继承格子 = 总列数」。用 W3C 校验器可以直接报出来。

**症状 6：`<col>` 上写的 `text-align` 完全没效果。**
原因：只有 `background`、`border`、`width`、`visibility` 四个属性对 `<col>` 生效，而且 `border` 还需要 `border-collapse: collapse`。解决：对齐方式写到单元格上。

**症状 7：写了 `<tfoot>` 在 `<thead>` 后面，校验器报错。**
原因：HTML5 要求 `<tfoot>` 在所有 `<tbody>`/`<tr>` 之后。你看的可能是 HTML4 时代的教程。

**症状 8：键盘用户无法滚动横向溢出的表格容器。**
原因：容器没有 `tabindex="0"`。解决：加上它，并配 `role="region"` + `aria-label`。

---

## 十三、练习

<Exercise title="练习 1：为一张成绩单补全语义" difficulty="基础">

下面这张表格在浏览器里显示正常，但存在 4 类语义问题。请重写它，并说明每处修改的理由。

```html
<table border="1">
  <tr>
    <td>姓名</td>
    <td>语文</td>
    <td>数学</td>
  </tr>
  <tr>
    <td>张三</td>
    <td>85</td>
    <td>92</td>
  </tr>
  <tr>
    <td>李四</td>
    <td>78</td>
    <td>88</td>
  </tr>
</table>
```

<template #answer>

重写后：

```html
<table>
  <caption>初三（2）班期末成绩</caption>
  <thead>
    <tr>
      <th scope="col">姓名</th>
      <th scope="col">语文</th>
      <th scope="col">数学</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">张三</th>
      <td class="num">85</td>
      <td class="num">92</td>
    </tr>
    <tr>
      <th scope="row">李四</th>
      <td class="num">78</td>
      <td class="num">88</td>
    </tr>
  </tbody>
</table>
```

```css
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ddd; padding: 8px 12px; }
th { text-align: left; font-weight: 600; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
```

4 类问题及理由：

**① `border="1"` 是废弃属性。** 规范明确把 `border` 列为 obsolete。视觉表现应该由 CSS 控制（`border-collapse: collapse` + `border: 1px solid`）。用属性控制样式会导致样式和结构耦合，也无法响应暗色模式。

**② 表头行用了 `<td>`，应该用 `<th scope="col">`。** 这是最严重的问题。用 `<td>` 时，屏幕阅读器完全不知道第一行是表头，用户导航到 `85` 时听到的只有「85」，没有任何上下文。改成 `<th scope="col">` 后，用户会听到「语文 85」。

**③ 姓名列也应该是表头。** 「张三」不是数据，它是这一行的标识。用 `<th scope="row">` 之后，屏幕阅读器用户按行导航时会听到「张三，语文 85，数学 92」。这一改动经常被忽略——很多人只把第一行当表头，忘了第一列也可以是。

**④ 缺少 `<caption>`、`<thead>`、`<tbody>`。** `<caption>` 让表格有可见标题（进入表格时宣告）；`<thead>`/`<tbody>` 让结构分组明确，也让 sticky 表头成为可能。虽然解析器会隐式补 `<tbody>`，但显式写出来是良好习惯，且 CSS 选择器会更可预测。

另外数字列加了 `text-align: right` + `font-variant-numeric: tabular-nums`，这是 W3C 的对齐建议：文本左对齐、数字右对齐，便于比较数量级。

</template>

</Exercise>

<Exercise title="练习 2：写出一个两级表头表格" difficulty="进阶">

需求：展示 3 个前端框架在「体积」「性能」「生态」三个维度下的评分，每个维度分「官方数据」和「社区测试」两列。共 7 列（1 列框架名 + 3×2 列数据）。

请写出完整的 `<table>` 结构，要求：所有表头关联正确，屏幕阅读器能读出「Vue 3 体积 官方数据 45」。

<template #answer>

```html
<table>
  <caption>三个前端框架的对比评分</caption>
  <thead>
    <tr>
      <th id="fw" rowspan="2" scope="col">框架</th>
      <th id="size" colspan="2" scope="colgroup">体积（KB，gzip）</th>
      <th id="perf" colspan="2" scope="colgroup">性能</th>
      <th id="eco" colspan="2" scope="colgroup">生态</th>
    </tr>
    <tr>
      <th id="size-o" scope="col">官方数据</th>
      <th id="size-c" scope="col">社区测试</th>
      <th id="perf-o" scope="col">官方数据</th>
      <th id="perf-c" scope="col">社区测试</th>
      <th id="eco-o" scope="col">官方数据</th>
      <th id="eco-c" scope="col">社区测试</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">Vue 3</th>
      <td headers="size size-o">45</td>
      <td headers="size size-c">47</td>
      <td headers="perf perf-o">A</td>
      <td headers="perf perf-c">A-</td>
      <td headers="eco eco-o">B+</td>
      <td headers="eco eco-c">B</td>
    </tr>
  </tbody>
</table>
```

关键点逐条说明：

**① 框架列用 `rowspan="2"` + `scope="col"`。** 它纵向跨了两行表头，所以第一行占位后，第二行只需要 6 个 `<th>`（不是 7 个）——框架列的槽位已经被 rowspan 占了。这是练习里最容易错的地方。

**② 三个维度用 `colspan="2"` + `scope="colgroup"`。** 它们是「跨多列的上级表头」，规范里对应的 scope 值就是 `colgroup`。写 `col` 也能被多数辅助技术接受，但 `colgroup` 语义更准确。

**③ 数据单元格的 `headers` 从外到内写。** `headers="size size-o"` 的顺序决定了朗读顺序：先「体积」再「官方数据」。如果写成 `headers="size-o size"`，用户会先听到「社区测试」再听到「体积」，逻辑倒过来了。

**④ 每个 `id` 必须唯一且和 `headers` 完全对应。** 拼错一个字母（比如 `size_o` vs `size-o`）不会有任何报错，表头关联会静默失效。这是 `headers`/`id` 方案的主要风险，也是为什么简单表格优先用 `scope`。

**⑤ 数据行的第一格用 `<th scope="row">`。** 框架名是行标识，不是数据。

**关于这个方案的诚实评价**：这张表有 7 列、2 级表头，`headers` 属性写了 6 遍。屏幕阅读器用户听到的是「Vue 3，体积 官方数据 45，体积 社区测试 47，性能 官方数据 A……」——非常冗长。

按第四章讲的原则，**更好的设计是把它拆成三张小表**（体积表、性能表、生态表），每张只有 3 列，用 `scope` 就够了，无需 `headers`/`id`，朗读也简洁得多。这道练习要求写两级表头，是为了让你掌握这个技术；实际项目里，看到自己要写第 5 个 `headers` 引用时，应该先质疑数据组织方式。

</template>

</Exercise>

<Exercise title="练习 3：给一张宽表做响应式方案选型" difficulty="挑战">

你有一张订单表，10 列：订单号、下单时间、客户名、客户邮箱、客户电话、收货地址、商品数、总金额、支付方式、状态。列总宽约 1600px，需要支持 375px 宽的手机。

请回答：

1. 你会选第十一章的哪种方案？说明理由，并说明为什么排除另外两种。
2. 如果选方案 A，写出容器 HTML 和必要的属性。
3. 如果选方案 B，哪些列适合保留、哪些适合隐藏或移到二级？给出你的划分和依据。

<template #answer>

**1. 选型：方案 A（横向滚动）为主，配合方案 C（隐藏次要列）减轻宽度压力。**

排除方案 B 的理由：订单表是**需要纵向比较**的数据。运营人员看这张表的典型动作是「扫一遍状态列，找出所有『待发货』」或「对比总金额」。卡片堆叠会彻底破坏这种能力——每行变成一个独立块，你没法一眼扫一列。第十一章的选型表里明确写了：统计报表类数据不要用方案 B。

单选方案 A 的问题：1600px 内容在 375px 屏幕上要横滑 4 次以上才能看完一行，体验很差，而且用户容易失去「我现在看的是哪一行」的定位。所以配合方案 C，把手机上真正不需要的列先藏掉，把宽度压到 800px 左右，横滑 2 次即可。

**2. 方案 A 的容器写法：**

```html
<div class="table-wrap" tabindex="0" role="region" aria-label="订单列表，可横向滚动查看全部 10 列">
  <table>
    <caption>订单列表（共 128 条）</caption>
    <!-- ... -->
  </table>
</div>
```

```css
.table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

/* 让第一列（订单号）在滚动时保持可见，解决「滑到右边不知道是哪一行」的问题 */
.table-wrap th[scope="row"],
.table-wrap td:first-child {
  position: sticky;
  left: 0;
  background: var(--vp-c-bg);
  z-index: 1;
}
```

三个必需属性：`tabindex="0"`（键盘可滚动，WCAG 2.1 SC 2.1.1）、`role="region"` + `aria-label`（让辅助技术用户知道这是个可滚动区域及其内容）。少任何一个都是无障碍缺陷。

`sticky` 首列是解决横向滚动最大痛点的手段。**这段 CSS 未经本站实际运行验证**——`position: sticky` 在表格单元格上的表现历史上多次变化，且与 `border-collapse` 取值相关，实现时需要在目标浏览器实测（见第八章的说明）。

**3. 如果必须用方案 B（比如产品明确要求手机上以卡片形式展示），列的划分：**

保留在卡片主体（用户扫一眼就要看到的）：

| 列 | 理由 |
| --- | --- |
| 订单号 | 唯一标识，必须可见，作为卡片标题 |
| 状态 | 用户最常筛选和查看的字段 |
| 总金额 | 核心业务数字 |
| 下单时间 | 排序依据 |

移到「展开详情」或点击进二级页面：

| 列 | 理由 |
| --- | --- |
| 客户名 | 手机上显示为卡片副标题即可，不需要独立一行 |
| 收货地址 | 长文本，在窄屏上会撑破布局，且查看频率低 |
| 商品数 | 次要，可与订单号一起放在副标题 |
| 支付方式 | 次要 |

**从卡片视图彻底移除，只在「完整版」入口（比如「在桌面端查看」或导出 CSV）提供：**

| 列 | 理由 |
| --- | --- |
| 客户邮箱 | 手机上既看不全也无法有效使用；有隐私暴露风险（公共场合） |
| 客户电话 | 同上。如果要保留，应该做成 `<a href="tel:...">` 可点击拨号，而不是纯文本 |

划分的依据不是「列重不重要」，而是**「用户在这个屏幕尺寸下的任务是什么」**。手机上查订单的任务通常是「确认某个订单的状态」或「找到最近的订单」，不是「批量对比 128 个订单的客户邮箱」。任务变了，需要的列就变了。

最后一点：无论选哪个方案，`<th scope>` 和 `<caption>` 都必须保留。方案 B 里把 `thead` 视觉隐藏（用 `clip-path` 而不是 `display: none`）时，表格的语义结构仍然是完整的。

</template>

</Exercise>

---

## 十四、官方文档与延伸阅读

以下链接均已核实可访问（核实时间：2026 年 10 月）。

**规范（现行标准由 WHATWG 维护）**

- [HTML Standard — Tables](https://html.spec.whatwg.org/multipage/tables.html)：表格模型、`scope` 的 5 个状态、`colspan`/`rowspan` 的槽位算法都在这里。`border` 属性被标记为 obsolete 也可在此查证。
- [HTML Standard — Parsing / The "in table" insertion mode](https://html.spec.whatwg.org/multipage/parsing.html)：隐式 `<tbody>`、隐式 `<colgroup>`、foster parenting 的规范原文。

**MDN（中文）**

- [`<table>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/table)
- [`<th>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/th)：`scope`、`headers`、`abbr` 的完整说明
- [`<caption>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/caption)
- [`<colgroup>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/colgroup)
- [`<thead>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/thead) · [`<tbody>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/tbody) · [`<tfoot>`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/tfoot)
- [`border-collapse`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/border-collapse)

**MDN（英文，含更精确的属性适用说明）**

- [`<col>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/col)：「Only a limited number of CSS properties affect `<col>`」这段是第七章的直接依据
- [`<tfoot>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/tfoot)：记录了 HTML4 → HTML5 的位置规则反转

**W3C 无障碍教程（Tables 专题，共 6 页）**

- [Tables Concepts](https://www.w3.org/WAI/tutorials/tables/)：总入口
- [Tables with One Header](https://www.w3.org/WAI/tutorials/tables/one-header/)：最简单的情况
- [Tables with Two Headers](https://www.w3.org/WAI/tutorials/tables/two-headers/)：`headers`/`id` 的完整示例
- [Tables with Irregular Headers](https://www.w3.org/WAI/tutorials/tables/irregular/)：跨行跨列的复杂情况
- [Caption & Summary](https://www.w3.org/WAI/tutorials/tables/caption-summary/)：标题与说明，含 `summary` 已废弃的说明
- [Tips and Tricks](https://www.w3.org/WAI/tutorials/tables/tips/)：对齐建议、拆分复杂表格、`role="presentation"`

**WCAG**

- [WCAG 2.2 — Info and Relationships (SC 1.3.1)](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships)：「通过程序可确定的信息、结构和关系」这条准则，是所有表头关联要求的规范来源
- [WCAG 2.2 全文](https://www.w3.org/TR/WCAG22/)

**校验工具**

- [W3C Markup Validation Service (Nu Html Checker)](https://validator.w3.org/nu/)：能检出表格结构错误、单元格数不一致、废弃属性

---

表格处理的是二维数据的展示。但真实页面远不止表格——页头、导航、侧栏、正文、页脚这些**区块级结构**，同样需要用正确的语义标签来表达。下一章讲[语义化布局与文档大纲](/html/layout-semantics)，包括 `<header>`/`<nav>`/`<main>`/`<article>`/`<section>`/`<aside>`/`<footer>` 各自的准确含义，以及 landmark 与文档大纲的关系。
