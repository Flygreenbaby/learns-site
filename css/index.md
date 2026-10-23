# CSS · 领域首页

<StatusBadge state="ready" note="12 章正文全部完成（第 12 章为阶段项目），可连续学习" />

## 这个领域解决什么问题

CSS 的普遍学法是「背属性」：记住 `display: flex` 能横排，记住 `position: absolute` 能脱离文档流，然后靠改数值试错，直到看起来对为止。这种学法在做一个静态页面时勉强够用，一旦页面复杂起来就会全线崩溃。

崩溃的具体表现：

- 一个弹窗加了 `z-index: 9999` 还是被压在下面。因为 `z-index` 只在同一个层叠上下文（stacking context）内比较，而父元素上的 `transform` 或 `opacity` 已经悄悄创建了一个新的层叠上下文，把它关在里面了。
- 给容器加了 `padding`，子元素的百分比宽度就超出了。因为 `box-sizing` 的默认值是 `content-box`，你算的是内容盒，浏览器算的是内容盒加内边距。
- 两个上下相邻的块，`margin-bottom: 20px` 和 `margin-top: 20px` 之间只有 20px 而不是 40px。这是 margin 合并（margin collapsing），而且它只在特定条件下发生——flex 容器和 grid 容器的直接子元素之间就不会合并。
- 明明写了 `overflow: hidden`，滚动条还是出现了，或者反过来，一个本该能滚动的区域滚不动。
- `position: absolute` 的元素跑到了页面左上角，因为你以为的「父元素」并没有 `position: relative`。
- 媒体查询写了 `max-width: 768px`，但一个被塞进侧边栏的卡片组件在宽屏下也是窄的——它需要的是容器查询（container query），而不是视口查询。
- 改了一个全局样式，另一个八竿子打不着的页面塌了。因为你不知道层叠（cascade）的优先级顺序，只能用 `!important` 硬压，然后下一轮冲突需要两个 `!important`。
- 动画一卡一卡的，因为你动画的是 `width` 和 `top`，这两个属性会触发重排（reflow）；而 `transform` 和 `opacity` 通常不会。

这些问题的共同点是：**它们都不是「属性记错了」，而是「不理解 CSS 的计算过程」**。CSS 不是一门按顺序执行的命令式语言，它是一组声明式约束，浏览器拿到所有声明之后要跑一整套算法：解析 → 层叠 → 继承 → 值计算 → 布局 → 绘制。你写的每一行 CSS 只是这套算法的输入之一。

所以本领域的重点是**层叠与布局算法**，不是属性手册。属性可以查 MDN，但「为什么浏览器算出这个结果」查不到——那需要你把整套计算流程装进脑子里。

还有一点必须说清楚：CSS 的效果高度依赖 HTML 结构。结构语义化做得好，样式能短一半；结构是一堆无意义的 `<div>`，你会用大量 CSS hack 去对抗自己写坏的结构。

## 前置知识

**[HTML](/html/)。**

具体来说，你需要能：

- 看懂任意页面的文档树，知道块级元素与行内元素的区别（HTML 第 1、3 章）。
- 正确使用 `header` / `nav` / `main` / `section` / `article` / `aside` / `footer` 划分页面（HTML 第 8 章）。
- 写出结构正确的表单和表格（HTML 第 6、7 章）——CSS 对 `<table>` 和表单控件有一整套特殊规则。
- 知道 HTML 第 9 章讲的无障碍要求。这一条会直接影响你写 CSS 的方式：用 `display: none` 隐藏内容和用视觉隐藏但保留可访问性，是两件完全不同的事。

如果你跳过了 HTML 直接学 CSS，最典型的症状是：布局怎么调都不对，然后你会归因于「CSS 好难」，而真正的原因是你没有可以排布的结构。

## 章节目录

| 章节 | 内容 | 学完能做什么 |
| --- | --- | --- |
| [1. CSS 如何生效](/css/how-it-works) | 样式表的来源、解析、层叠的六个排序维度、继承机制与可继承属性、值的计算过程（specified → computed → used） | 给定一段冲突的 CSS，能准确说出最终生效的是哪一条以及为什么 |
| [2. 选择器与特异性](/css/selectors) | 各类选择器的匹配代价、特异性（specificity）的计算、`!important` 的真实位置、作用域化选择器的写法 | 不再依赖 `!important`，能设计出低特异性但足够精确的选择器 |
| [3. 盒模型与 margin 合并](/css/box-model) | `content-box` 与 `border-box`、四种盒子的组成、margin 合并的触发条件与阻止方式、百分比与 `auto` 的解析规则 | 能精确预测任何元素的实际尺寸，不再靠「加个 padding 试试」 |
| [4. 常规流与格式化上下文](/css/flow-and-bfc) | 块级与行内格式化上下文、BFC 的建立方式与作用、`float` 的历史遗留问题、`clear` | 理解「为什么这个容器高度塌陷了」并能用正确的方式修 |
| [5. Flexbox](/css/flexbox) | 主轴与交叉轴、`flex` 简写的三个分量、`align-items` / `justify-content` / `align-self` 的分工、`flex-basis` 与 `width` 的优先级 | 用 Flexbox 做一维布局，能解释每一项为什么被拉伸或压缩到那个宽度 |
| [6. Grid](/css/grid) | 轨道定义、`fr` 单位、`minmax` 与 `repeat`、显式与隐式网格、自动放置算法、`grid-template-areas` | 用 Grid 做二维布局，包括「响应式卡片墙」这类不需要媒体查询的方案 |
| [7. 定位与层叠上下文](/css/positioning-and-stacking) | `static` / `relative` / `absolute` / `fixed` / `sticky` 的包含块规则、层叠上下文的创建条件与排序规则、`isolation` | 能独立做出弹窗、下拉菜单、吸顶导航，并解释 `z-index` 为什么没生效 |
| [8. 值、单位与自定义属性](/css/units-and-custom-properties) | 长度单位的区别与适用场景、`clamp()` / `calc()`、颜色表示法、自定义属性（CSS 变量）的继承与覆盖、`var()` 的回退值 | 建立一套用变量组织的设计令牌（design token），实现主题切换 |
| [9. 响应式设计](/css/responsive-design) | 视口与 `rem` 基准、媒体查询的写法与断点选择策略、容器查询、`prefers-color-scheme` 等偏好类查询 | 一个组件放进任何宽度的容器都能正确显示，而不只是「手机和桌面两套」 |
| [10. 过渡与动画](/css/transitions-and-animations) | `transition` 的四要素与可过渡属性、`@keyframes` 与 `animation`、合成层与重排/重绘的代价、`prefers-reduced-motion` | 写出流畅且不打扰用户的动效，能指出哪些属性动画会导致掉帧 |
| [11. 布局调试方法论](/css/debugging-layout) | DevTools 的 Computed 面板、盒模型图、Flexbox/Grid 检查器、逐层禁用规则定位冲突、从 DOM 反推布局问题 | 遇到「不对但不知道为什么」的布局，有固定的排查路径而不是反复试错 |
| [12. 阶段项目](/css/project) | 从零实现一个响应式的产品落地页 | 把前 11 章串成一个完整的、跨设备可用的页面 |

## 学习顺序建议

**严格按 1 → 12 的顺序学，前三章不能跳。**

第 1、2 章讲的是层叠，这是 CSS 唯一无法靠经验绕过的基础。很多人会觉得「原理很虚，我想直接学 Flexbox」——结果是半年后还在用 `!important` 和自己的样式表打架。

第 3 章盒模型必须在第 5、6 章之前，因为 Flexbox 的 `flex-basis` 和 Grid 的轨道尺寸最终都要落到盒模型上计算。不理解 `border-box`，你会一直算错宽度。

第 4 章常规流看起来过时（现在很少用 `float` 布局了），但它是理解「为什么 flex 容器里的 margin 不合并」的前提，而且 BFC 在清理浮动和处理溢出时仍然经常用到。这一章可以读得快，但不能不读。

第 7 章定位与层叠上下文，建议在做第 12 章项目之前反复回看——层叠上下文是全站被问得最多的 CSS 问题。

第 11 章调试方法论放在最后，是因为它需要你先知道「正常的计算过程是什么样」，才能识别出异常。但实际练习中，从第 3 章开始就应该有意识地使用 DevTools。

## 学习方法

- **DevTools 的 Computed 面板是你最重要的工具。** 选中任意元素，切到 Computed，你会看到浏览器最终算出的每一个属性值，以及它是由哪条规则、经过什么层叠过程得到的。学 CSS 期间保持这个面板常开。
- **每写一条声明，先预测结果，再看结果。** 预测错了就是收获最大的一次。不要跳过预测这一步——「看着结果调」和「预测然后验证」是两种完全不同的学习方式，前者不会让你进步。
- **用布局检查器而不是猜。** Chrome 和 Firefox 的 DevTools 都有专门的 Flexbox / Grid 检查器，能把轨道线、间距、对齐关系直接画在页面上。Grid 布局不看这个几乎无法调试。
- **练习用真实的页面，不要用彩色方块。** 打开任意一个你常用的网站，用 DevTools 看它的布局是怎么搭的：外层是 flex 还是 grid、断点设在哪里、哪些值用了变量。这比做十道选择题有用。
- **写 CSS 之前先写 HTML。** 每次开始一个新布局，先在纸上或编辑器里把结构树画出来，确认语义正确，再开始写样式。反过来做的话，你会花三倍时间修自己制造的问题。
- **不要收藏一堆「CSS 技巧」文章。** 技巧是层叠与布局算法在特定输入下的产物。理解了算法，技巧能自己推出来；只背技巧，输入稍变就失效。

## 阶段项目

**响应式产品落地页**：为本站的第一期里程碑产品做一个静态落地页，包含顶部导航、主视觉区、三到四个功能特性卡片、一个价格表格、一个注册表单和页脚。

验收标准：

- 在 320px、375px、768px、1280px、1920px 五个宽度下都布局正确，无横向滚动条。
- 特性卡片区域使用 Grid 实现，在宽屏下自动增加列数而**不依赖媒体查询**（用 `auto-fit` / `minmax` 一类的方案），窄屏下自动堆叠。
- 顶部导航在窄屏下折叠为汉堡菜单，交互用纯 CSS 或极少量原生 JS 实现，键盘可以完整操作。
- 注册表单使用语义化 HTML，`label` 与控件正确关联，聚焦状态有清晰的视觉反馈，不使用 `outline: none` 而不给替代方案。
- 颜色、字号、间距全部通过自定义属性定义，切换一个根变量就能整体换主题。
- 全站不使用 `!important`。如果某个地方确实需要，写注释说明为什么不能用别的方式解决。
- 用 DevTools 逐条禁用样式表，能指出每个视觉区块由哪些规则负责。

## 官方文档与延伸阅读

- [MDN CSS 文档（中文）](https://developer.mozilla.org/zh-CN/docs/Web/CSS) —— 主入口，所有属性和概念的权威参考。
- [MDN CSS 参考索引](https://developer.mozilla.org/zh-CN/docs/Web/CSS/Reference) —— 按属性名查询的入口。
- [MDN 层叠（Cascade）](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Cascade) —— 第 1 章的核心参考，讲清了层叠排序的各个维度。
- [MDN 特异性（Specificity）](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Specificity) —— 第 2 章核心参考。
- [MDN 继承（Inheritance）](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Inheritance) —— 哪些属性可继承的完整说明。
- [MDN 值的处理过程（Value processing）](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Value_processing) —— specified / computed / used value 的定义，配合 [Computed value](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Computed_value) 与 [Used value](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Used_value) 阅读。
- [MDN 层叠层（@layer）](https://developer.mozilla.org/zh-CN/docs/Web/CSS/@layer) —— 较新的层叠控制手段，大型项目里用来管理样式来源优先级。
- [MDN CSS 盒模型](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_box_model) 与 [盒模型介绍](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_box_model/Introduction_to_the_CSS_box_model) —— 第 3 章核心参考。
- [MDN 掌握 margin 合并](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_box_model/Mastering_margin_collapsing) —— 讲清了合并发生与不发生的全部条件。
- [MDN `box-sizing`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/box-sizing) —— 每个项目都该设置的那一行。
- [MDN 常规流布局](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_flow_layout) 与 [块级格式化上下文](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_display/Block_formatting_context) —— 第 4 章核心参考。
- [MDN Flexbox 布局](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_flexible_box_layout)、[Flexbox 基本概念](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_flexible_box_layout/Basic_concepts_of_flexbox)、[Flex 项目对齐](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_flexible_box_layout/Aligning_items_in_a_flex_container) —— 第 5 章核心参考。
- [MDN Grid 布局](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_grid_layout)、[Grid 基本概念](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_grid_layout/Basic_concepts_of_grid_layout)、[基于线的放置](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_grid_layout/Grid_layout_using_line-based_placement)、[自动放置](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_grid_layout/Auto-placement_in_grid_layout)、[Grid 与其他布局方式的关系](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_grid_layout/Relationship_of_grid_layout_with_other_layout_methods) —— 第 6 章核心参考。
- [Flexbox Froggy](https://flexboxfroggy.com/#zh-cn) 与 [Grid Garden](https://cssgridgarden.com/) —— 两个交互小游戏，用来练手感。不能替代读文档，但作为章节之间的调剂很有效。
- [MDN CSS 定位](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_positioning)、[`position` 属性](https://developer.mozilla.org/zh-CN/docs/Web/CSS/position)、[理解 z-index](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_positioning/Understanding_z_index)、[层叠上下文](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_positioning/Understanding_z_index/The_stacking_context)、[`isolation`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/isolation) —— 第 7 章核心参考，层叠上下文那一篇建议读两遍。
- [MDN CSS 值与单位](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_values_and_units)、[`length`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/length)、[`length-percentage`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/length-percentage)、[`calc()`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/calc)、[`clamp()`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/clamp) —— 第 8 章核心参考。
- [MDN 使用 CSS 自定义属性](https://developer.mozilla.org/zh-CN/docs/Web/CSS/Using_CSS_custom_properties) 与 [`var()`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/var) —— 第 8 章的变量部分。
- [MDN CSS 媒体查询](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_media_queries)、[使用媒体查询](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_media_queries/Using_media_queries)、[`@media`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/@media)、[容器查询](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_containment/Container_queries)、[`prefers-color-scheme`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/@media/prefers-color-scheme)、[`@supports`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/@supports) —— 第 9 章核心参考。
- [MDN CSS 过渡](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_transitions)、[使用 CSS 过渡](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_transitions/Using_CSS_transitions)、[`transition`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/transition) —— 第 10 章核心参考。
- [MDN CSS 动画](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_animations)、[使用 CSS 动画](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_animations/Using_CSS_animations)、[`animation`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/animation)、[`prefers-reduced-motion`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/@media/prefers-reduced-motion) —— 第 10 章核心参考。
- [MDN 样式基础（学习区）](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Core/Styling_basics) —— 如果你觉得本站节奏偏快，可以先过一遍这个入门教程。
- [Every Layout](https://every-layout.dev/) —— 一组可复用的布局模式，重点在于它解释「为什么这样写」，适合读完第 5、6 章之后看。
- [CSS Flexible Box Layout 规范草案](https://drafts.csswg.org/css-flexbox/) 与 [CSS Grid Layout 规范草案](https://drafts.csswg.org/css-grid/) —— 浏览器行为的最终裁决来源。日常不需要读，出现「MDN 说的和浏览器做的不一致」时来查。

## 版本说明

本领域内容基于 **CSS 现行标准（各模块的 Working Draft / Candidate Recommendation）** 编写，核实时间为 2026 年 10 月。CSS 没有单一版本号，它被拆分成多个独立演进的模块。

时效性风险按章节区分：

- **第 1–4 章（层叠、选择器、盒模型、常规流）几乎不会变。** 这些是 CSS 的基础模型，向后兼容是硬约束，浏览器不会移除已经广泛使用的行为。margin 合并这类「反直觉但已成规范」的规则也不会改。
- **第 5–7 章（Flexbox、Grid、定位）核心算法稳定**，但会有新增能力（例如对齐相关属性的补充）。以 MDN 对应页面的浏览器兼容性表为准。
- **第 8–10 章（自定义属性、容器查询、动画）是变化最快的部分。** 容器查询属于较新特性，不同浏览器的支持时间不一致；`clamp()`、`:has()` 一类的新选择器和函数的可用性也在变化。涉及这些内容时，动手前先用 [Can I use](https://caniuse.com/) 确认你的目标浏览器。
- 本站不会讲已经过时的布局方式作为主要手段。`float` 布局、`table` 布局只在第 4 章作为「理解常规流」的背景出现，不会教你用它们做页面结构。
