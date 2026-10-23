# 移动端适配不是把布局缩小，是换掉六个默认前提

第一个故障最出名：**底部那根小黑条把「提交」按钮吃掉了一半。**设计稿上一切正常，桌面浏览器里一切正常，iPhone 真机上主按钮只能点到上半部分。没有人写错 CSS——是那个按钮贴在视口底边，而设备的底边不属于你。

第二个故障最难复现：**点输入框，键盘弹起来，页面抖了一下，「确定」按钮跑到屏幕外。**同一个页面在不同设备上表现不一样，有的把页面顶高，有的只是遮住。这不是 bug，是**「键盘弹出到底改了什么」这件事有三个合法答案，而你没指定要哪一个**。

第三个故障最容易被误诊：**首屏用 `height: 100vh` 铺满，结果底部的内容永远看不见，滚动也滚不出来。**开发者以为 `100vh` 等于「一屏」，它在移动浏览器上的定义其实是「浏览器工具栏收起时的那一屏」——于是你多出来的一截刚好被地址栏吃掉。

三个故障有一个共同结构：**桌面端的三个默认前提在手机上不成立**——「视口就是你看到的那块」「CSS 像素与物理像素是稳定比例」「指针有 hover 且不会遮挡任何东西」。这一章把六个前提逐个换掉：视口元标签、安全区、CSS 像素与物理像素、触摸与鼠标事件、软键盘、动态视口单位。

**这是本领域性价比最高的一章**，理由在[第一章](/mobile/choosing-route)已经给过：它不需要账号、不需要审核、不需要新框架，改的是你现在这个 Web 产品，收益当天就能在真机上看到。

<Callout type="verified">

**本章的诚实性分两层，请务必分开对待**：

- **已按官方文档核实（2026 年 10 月，本批抓取对照）**：视口元标签的关键字集合与各自取值范围（`width`/`height`/`initial-scale`/`minimum-scale`/`maximum-scale`/`user-scalable`/`viewport-fit`/`interactive-widget`）、`width=device-width` 是官方推荐写法、`interactive-widget` 三个取值分别改变哪个视口、`viewport-fit=cover` 的语义与「应配合安全区变量使用」的官方建议、`env()` 四个安全区变量及其第二参数回退写法与大小写敏感、`vh` 与大视口单位等价以及小视口/动态视口单位的定义与代价、`touch-action: manipulation` 通过关闭双击缩放从而免除 click 事件延迟、Touch Events 非 Baseline 且官方推荐用 Pointer Events 同时支持触摸与鼠标、在 `touchstart` 上调用 `preventDefault` 会抑制对应的鼠标事件。
- **未在本机验证，必须用你自己的设备验**：任何具体机型上的安全区数值、键盘实际高度、缩放与双击行为在各家浏览器上的实际表现、亚像素边框在不同设备像素比下是否真的渲染成半像素、动态视口单位在你需要支持的浏览器上是否可用。**本章 0 次真机、0 次浏览器兼容性表逐格核对。** 需要支持度时查 MDN 页面的兼容性表或 [caniuse.com](https://caniuse.com/)，然后用真机确认一次——两件事都不能省。
- **不复述具体数字的部分**：最小可点击尺寸的标准值、各机型屏幕参数、浏览器版本门槛。这些要么会变，要么依赖你的用户构成，写死反而误导。

</Callout>

## 你的 CSS 只看得到三个视口中的一个

手机上「视口」不是一块，是三块，这个区分是本章后面四个问题的共同根：

| 视口 | 它是什么 | 谁在用 |
| --- | --- | --- |
| 布局视口（layout viewport） | CSS 布局参考的那块宽度，`width` 和 `initial-scale` 就是在定它 | 你的媒体查询、`%`、`vw`、`vh` |
| 视觉视口（visual viewport） | 用户此刻真正看见的那块，捏合缩放和工具栏收起都会改变它 | 用户眼睛；`interactive-widget=resizes-visual` 时键盘只改这块 |
| 初始包含块（initial containing block） | 根元素定位所参照的矩形，与布局视口通常同尺寸但概念不同 | 规范里定位与包含块的推导 |

桌面端这两个视口几乎总是重合，所以从没见过这个区分。手机上它们会分开：**用户双指放大时，布局没变，视觉视口变了**；键盘弹出时（默认行为下）也一样，布局视口不动，视觉视口被压小。理解了这一句，第二个故障和第三个故障就从「玄学」变成「你在等一个你从来没指定的东西变化」。

`viewport` 元标签做的事只有一件：**声明布局视口**。所以它影响媒体查询与视口单位，不影响用户能不能缩放（那是 `user-scalable`/`maximum-scale` 的事，而且现在浏览器常常忽略它们）。

## 元标签的每一项在改什么，以及哪一项不该动

官方推荐的最小写法就这一行：

```html
<meta name="viewport" content="width=device-width" />
```

```text
关键字          语义（按官方定义）                        什么时候真的要动它
width           布局视口的最小像素宽度；1–10000 或 device-width   device-width 之外几乎不该用具体数值
height          同上，高度方向                          极少
initial-scale   设备尺寸与视口尺寸的比例，0.0–10.0       内容溢出导致被自动缩小时补 =1
minimum-scale   最小缩放，0.0–10.0                     不该动（浏览器设置可能忽略）
maximum-scale   最大缩放，0.0–10.0，须 ≥ minimum-scale  不该动（理由见下）
user-scalable   是否允许缩放，yes/no，默认 yes           不该动
viewport-fit    auto / contain / cover                  要用安全区变量时改成 cover
interactive-widget  resizes-visual / resizes-content / overlays-content  要改变键盘对布局的影响时
```

三件事值得单独说：

**`initial-scale=1` 是可省的。**官方明确说省略它是常见做法、通常没必要写；只有当内容溢出导致浏览器把页面自动缩得更小、而你希望开局就是 100% 缩放时才补上。

**禁缩放是无障碍问题，不是风格问题。**官方在这一页直接给了警告：`user-scalable=no` 或压低 `maximum-scale` 会让低视力用户无法放大阅读，而 WCAG 要求至少 2 倍缩放能力、最佳实践是放到 5 倍。**把缩放关掉本质上是把「我的布局在小屏上会破」这件事的成本转嫁给视力最差的用户。**布局破了就修布局——绝大多数「关掉缩放才不难看」的场景，真正的原因是某个元素有写死的宽度或者 `white-space: nowrap`。

**`viewport-fit=cover` 与安全区是一对。**`cover` 让布局视口铺满整个屏幕（包括刘海与圆角区域），代价是内容可能伸到不可见区域，官方在这里直接建议配合安全区内嵌变量使用——也就是下一节。不写 `cover` 时，多数设备的四个 inset 会是 0，因为浏览器已经把内容限制在「安全」的矩形里了：这时你在真机上看不到遮挡，也看不到 `env()` 有任何效果，**这是最常见的「适配代码写了但没作用」的原因**。

## 安全区：你贴边的东西全部要重算

安全区（safe area）是不被刘海、圆角、指示条、浮动工具栏遮挡的那块矩形。四个变量：`env(safe-area-inset-top / right / bottom / left)`。官方定义里有一条关键的行为说明：**视口是矩形且没有东西占据时它们是 0，否则是正的像素值**——这意味着你的代码必须对「0」也成立。

正确的用法是**把 inset 加到已有的内边距上**，而不是替换它：

```css
footer {
  position: sticky;
  bottom: 0;
  padding: 1em 1em calc(1em + env(safe-area-inset-bottom, 0px));
}
```

第二个参数是回退值（官方推荐写法，变量不被支持或无效时使用），这里写 `0px`，意思是「不支持就什么也不加」，这样一行代码同时兼容三种情况：有遮挡、无遮挡、浏览器不认识这个变量。**注意变量名大小写敏感**，写成大写形式的名字不会生效——官方页面上就专门用这个错例演示回退。

三条纪律：

**贴边的可交互元素才需要安全区，装饰不需要。**背景色应该铺满（这正是 `cover` 的用处），按钮不应该贴边。判据是「用户的手指有没有可能被挡」。

**左右同理。**横屏时刘海会出现在某一侧，`safe-area-inset-left/right` 随之非零；只处理 bottom 的适配在半数场景里不够。

**老系统上的 `constant()` 写法本站不给你结论。**它属于较早期 iOS Safari 的行为，是否需要取决于你要支持的设备有多旧——**按官方文档当前说明和你自己的真机清单决定**，不要在没验过的设备上凭教程复制一行历史写法。

## CSS 像素不等于物理像素，但「1px 边框」问题也不是你想的那样

设备像素比（device pixel ratio，DPR）说的是一个 CSS 像素对应几个物理像素。换算关系本身很简单，写死在规范里：

```text
设计稿 750 宽，目标设备 375 CSS 像素、DPR 3
1 CSS 像素 = 3 物理像素
一条 border: 1px 的元素 → 占 1 CSS 像素 → 在屏幕上占 3 个物理点
你想要的「视觉上最细的一条线」→ 需要 1 物理点 → 等于 1/3 CSS 像素
```

这解释了为什么在高分屏上 `1px` 边框看起来「粗」：**它不是算错了，而是它的物理厚度确实比你眼睛期待的厚**。常见处理思路有三种，各有代价：

```css
/* 思路一：直接写小于 1px 的边框——是否被渲染为更细的线，取决于设备与浏览器 */
.hairline-a { border-bottom: 0.5px solid #ccc; }

/* 思路二：用 transform 缩放的伪元素，视觉上稳定，但要多占一个定位上下文 */
.hairline-b { position: relative; }
.hairline-b::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: #ccc;
  transform: scaleY(0.5);
  transform-origin: bottom;
}

/* 思路三：把线交给 SVG（viewBox 缩放天然带亚像素），代价是每处都要一段标记 */
```

**本站不告诉你哪种「一定有效」**：亚像素能不能真的画出来，受 DPR、浏览器取整规则、缩放层级影响，只能在目标设备上验。能给你的是判据：**如果一条分隔线在真机上看起来是灰的而不是黑的、粗细不一致，那是取整问题；如果它消失了，那是被父级的 `overflow`/缩放或者 `transform` 上下文吃掉了。** 还有一句实话：**大部分界面根本不需要亚像素边框**——先确认这是否是真实用户会注意到的问题，再决定要不要为它付一份定位复杂度。

## 触摸不等于鼠标，而且不是替代关系

触摸设备上的事件序列通常是：手指落下 →（若判定不是滚动手势）→ 合成 `mouseover`/`mousemove` → `mousedown` → `mouseup` → `click`。这条链解释了三类现象：

**hover 样式会在触摸「粘住」。**因为触摸时合成了一次 `mouseover`，`(:hover)` 规则被触发后再也没有 `mouseout`。修法不是删除 hover，而是让它只在真正有指针悬停的设备上生效，用媒体查询做特性检测（与 [@supports 的思路](/css/how-it-works)同一套渐进增强方法）：

```css
@media (hover: hover) and (pointer: fine) {
  .btn:hover { background: #e8e8e8; }
}
```

**click 有延迟是历史，不是现在必然。**官方对 `touch-action` 的说明里写清了机制：`manipulation` 是 `pan-x pan-y pinch-zoom` 的别名，它关掉双击缩放这类非标准手势，而**关掉双击缩放就不再需要为「等待双击」而延迟生成 click 事件**。所以今天的正确做法是把这个决定写成 CSS，而不是去找那个早就不存在的「300ms」：

```css
.tap-fast { touch-action: manipulation; }
```

另外两条官方语义要记住：`touch-action` **不继承**，并且浏览器在手势开始时会把被触摸元素与其祖先的取值做交集（直到第一个能实现该手势的滚动容器）——所以它通常写在需要自定义手势的顶层元素上，写在一堆后代上是浪费。`touch-action: none` 是给自绘拖拽/地图这类场景用的，滥用它会连带取消正常的滚动，这是「页面在某处滑不动」的经典原因。

**要不要用 Touch Events？**官方立场很明确：Touch Events **不是 Baseline**（在部分主流浏览器上不工作），要同时支持触摸与鼠标应该用 Pointer Events。这不影响你今天写的业务代码（大多数按钮直接用 `click`），但影响你写自定义手势的选型。用 Pointer Events 的骨架：

```js
const pad = document.querySelector('#pad');
let drawing = false;

pad.addEventListener('pointerdown', (e) => {
  drawing = true;
  pad.setPointerCapture(e.pointerId); // 手指移出元素也继续收到事件
});
pad.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  // e.clientX / e.clientY 相对视口；e.pointerType 区分 mouse / touch / pen
});
pad.addEventListener('pointerup', () => { drawing = false; });
```

如果你确实要用 Touch Events，官方有一条关于 `preventDefault` 的提醒很实用：在 `touchstart`（或一系列触摸事件里的第一个 `touchmove`）上调用 `preventDefault`，会抑制后续鼠标事件的触发，于是链接一类交互会失效；因此常见做法是**只在 `touchmove` 上阻止默认行为**，让鼠标事件还能发生。同理，滚动与缩放被阻止以后，用户「划不动页面」不是 bug，是你要求的。

多指要按「一组触点」处理：一个 `TouchEvent` 携带活动触点集合，`changedTouches` 是这次状态发生变化的那批——把它当成「一个鼠标位置」来写是触摸代码里最常见的结构性错误。

## 软键盘：先决定它改变哪个视口

回到第二个故障。默认行为下（`interactive-widget` 的初始值是 `resizes-visual`），键盘只压缩**视觉视口**，布局视口不动——所以你的元素还在原来的布局位置上，只是被遮住了，页面看起来「抖了一下」其实是用户被推着滚了。三种取值对应三种结果：

```text
resizes-visual   只改视觉视口（默认）→ 布局不动，元素可能被遮
resizes-content  布局视口一起变小 → 依赖百分比与视口单位的高度会重排
overlays-content 两个视口都不改 → 键盘纯粹盖在上面，遮挡必须你自己处理
```

**先明确要哪一种，再写对策**，这是这一节唯一的新增成本。可选对策按侵入性从小到大：

**用 `scrollIntoView` 把焦点元素带进可见区。**在输入获得焦点后调用，不改变布局、不需要知道键盘多高，是最便宜的解法。

**把主操作按钮不要放在最底部。**表单的「确定」放在输入区上方或做成吸顶，遮挡问题从根上消失。这看起来是设计妥协，其实是这一类故障唯一在所有设备上稳定的解法。

**`interactive-widget=resizes-content`。**让布局视口跟着缩，于是 `100%` 高度容器自然变矮、内部滚动区域跟着调整——代价是每次键盘弹出都会触发一轮重排，动画与固定定位都要跟着重新算，并且它在旧浏览器上可能不被识别（不认识的关键字会被忽略，回到默认行为，所以你的布局必须在两种行为下都不出错）。

**别去猜键盘高度。**不要写「键盘大约 300px，弹起时底部留 300px」这类逻辑——不同输入法、横竖屏、是否带候选栏都会变，而且你的代码在不同取值上得靠猜。要么让视口变化替你处理，要么把主按钮移出键盘区。

## `100vh` 不是「一屏」，要选的是哪一个「屏」

官方对单位的定义解决了这个坑：**当前 `vh`（和 `vw`）等价于大视口单位 `lvh`**，也就是按「浏览器界面收起时的最大视口」算。所以一个 `height: 100vh` 的面板在工具栏展开时会比可见区域高一截，底部内容被压住——第三个故障的完整解释就这一句。

三个候选，按官方给的取舍：

```css
.cover {
  height: 100vh;   /* 老写法：等价于 100lvh，最大视口，可能超出可见区 */
  height: 100svh;  /* 最小视口：官方评价为「一般更安全」，但工具栏收起时会留白 */
  height: 100dvh;  /* 动态视口：始终贴合当前可见高度 */
}
```

`dvh` 的那句警告要一起记住：**动态视口单位会在用户滚动过程中让内容跟着改变尺寸，可能带来体验下降与性能开销。**所以它适合「必须刚好铺满」的场景（全屏弹层、取景器），不适合长页面的普通分节——那里 `svh` 或直接让内容自然撑高更好。

写法上有两层保护：先写一个不带单位的兜底（或 `100vh`），再覆盖新单位，不认识新单位的浏览器会忽略那一行——这正是[层叠与回退](/css/how-it-works)的常规技巧，不需要特性检测也能安全。真要显式检测，用 `@supports` 包一层即可（见[MDN @supports](https://developer.mozilla.org/en-US/docs/Web/CSS/@supports)，本站领域首页已列）。

还有一条常被追问的：**「那 `document.documentElement.clientHeight` 呢？」**它给你的是当前布局视口的高度，不是用户此刻可见的高度；可见区域要用视觉视口的接口去读，而它在不同浏览器上的更新时机与缩放语义不一致。**本站不给具体数值结论——这一项必须在目标真机上打印一次并对照截图。**

## 验证顺序：桌面模拟能测什么，不能测什么

适配工作的顺序错了会白测很多遍。本站给的顺序是先便宜后昂贵：

**第一步，桌面设备模拟能覆盖的**：媒体查询是否命中、布局是否横向溢出、文字是否被截断、`env()` 的语法是否被接受（开发者工具可以模拟安全区 inset）。**改完先在这里过一遍，因为这一轮免费。**

**第二步，真机必测清单（这些模拟器给不出答案）**：底部指示条与顶部的刘海遮挡、键盘弹出后的实际遮挡与恢复、触摸目标单手能否点中、双指缩放后布局是否仍可操作、地址栏收起/展开时首屏有没有跳动、滚动列表在惯性滚动结束后的状态。**至少两台：一台大屏 iPhone 和一台 Android。**这一步需要真实设备，本站无法代验。

**第三步，把「只有真机能发现的问题」写成可复现的条件**：机型、系统、浏览器、步骤、截图。没有这一层，你的修复只是「我手上这台好了」。

一份可以贴在项目里的自查项（不要求一次全绿，要求每一项你都知道答案来自模拟还是真机）：

- [ ] `width=device-width` 在，且没有为了掩盖溢出而关闭缩放
- [ ] 需要铺满的地方写了 `viewport-fit=cover`，且贴边元素加了 `env(...)` 回退
- [ ] hover 样式被 `@media (hover: hover)` 包住
- [ ] 需要快速响应点击的区域有 `touch-action: manipulation`，且没有大面积 `touch-action: none`
- [ ] 表单主按钮不因键盘弹出被遮（三种对策选了一种并能说出为什么）
- [ ] 全屏高度写的是 `svh` 或 `dvh`（并有回退），且知道为什么选它
- [ ] 亚像素边框（如果有）在真机上验过，或者决定不用
- [ ] 两台真机上各走过一遍核心流程，问题清单里有机型信息

## 常见错误与排查

**一、`env()` 写了但没有任何效果。**现象：底部留白没变化。原因：没写 `viewport-fit=cover`，或设备本身没有占据区域（此时 inset 合法地为 0）。怎么确认：把值直接打出来（`padding-left: calc(10px + env(safe-area-inset-bottom))` 临时改成一个可见的颜色块高度），并确认元标签内容。怎么修：加 `cover`，同时保证 inset 为 0 时布局也正确——**永远写第二个参数做回退**。

**二、关掉缩放来「修」布局。**现象：`user-scalable=no` 之后桌面看起来整齐了。原因：某个元素有写死宽度或不可换行文本，导致内容宽于视口，浏览器于是整体缩小。怎么确认：允许缩放后手动放大，看有没有横向滚动条或截断文本。怎么修：找到溢出源（常见：`width: 1200px` 的容器、长串不换行的 URL、表格）并改成弹性布局与 `overflow-wrap`；**别把无障碍成本当成布局债的还款方式**。

**三、`100vh` 的弹层底部按钮点不到。**现象：滚动到底也看不见最后一个控件。原因：`vh` 等价于大视口单位，而实际可见区更小。怎么确认：滚动时观察地址栏是否会收起，收起后按钮是否露出。怎么修：改用 `dvh`（并接受滚动中尺寸会变）或 `svh`（并接受留白），或者让弹层内部自己滚动而不是整页顶高。

**四、点一下按钮，样式停在 hover 上。**现象：手指离开后按钮保持高亮。原因：触摸时合成了 `mouseover`，没有对应 `mouseout`。怎么确认：把 hover 规则注释掉看是否还出现。怎么修：把 hover 放进 `@media (hover: hover) and (pointer: fine)`；把「按下态」改用 `:active` 或自己维护状态类。

**五、页面某处滑不动。**现象：列表划不动，或整页横向抖动。原因：在容器上写了 `touch-action: none`，或者在自己的 `touchmove` 处理器里 `preventDefault`。怎么确认：临时移除该样式/调用，看滚动是否恢复。怎么修：只在真正需要自定义手势的元素上禁用，其它地方用 `manipulation`；注意 `touch-action` 不继承但会与祖先取值求交集，问题常常出在**祖先**上。

**六、`touchstart` 里阻止默认行为，链接和按钮失效。**现象：某些点击没有响应，`click` 完全不来。原因：`preventDefault` 抑制了后续鼠标事件与 click。怎么确认：在 `click` 里打印一次，看是否根本不触发。怎么修：把默认行为阻止移到 `touchmove`，或者干脆改用 Pointer Events。

**七、键盘一弹起，整页重排、动画跳一下。**现象：聚焦输入框时页面元素位置明显变动。原因：你用了 `resizes-content`（布局视口跟着缩），而固定定位元素/视口单位高度都依赖它。怎么确认：临时改回默认行为，看跳动是否消失。怎么修：接受重排就把依赖高度做动画的部分改成 `transform`，或者放弃 `resizes-content` 改用 `scrollIntoView`。

**八、亚像素边框在某些设备上粗细不一致或看不见。**原因：DPR 与浏览器取整；`transform` 缩放层级改变了实际线宽。怎么确认：同一页面在两台 DPR 不同的设备上截图对比。怎么修：接受「不同设备上略有差异」，或者改用 1 CSS 像素的浅色边框——**视觉上的一致性往往比物理厚度更重要**。

## 练习

<Exercise title="给一个已有页面补齐六项适配并写下每项的证据来源" difficulty="基础">

拿你现在任意一个页面（本站或你自己的项目），按本章清单补齐六项：视口元标签、安全区内边距、hover 特性检测、`touch-action`、全屏高度单位、键盘遮挡对策。每一项后面注明：**你的判断依据来自桌面模拟、官方文档，还是真机**。真机没有的项写「未验证，待设备」。

<template #answer>

重点不在改对六处，而在**每一项你能不能指出证据**。典型合格答案长这样：视口与安全区写法来自 MDN（本批核实的那两项），实际 inset 数值「未验证，待设备」；hover 包裹是桌面模拟就能验的（改完在触摸模拟下点一次看是否残留高亮）；`dvh` 的选择来自官方单位定义，而「滚动时是否有跳动」是只有真机才能给出的结论。

写「全部验证通过」但没有任何设备信息的答案是无效答案。这一题的产出应当同时是你后续修复的工单：哪一项在没有设备之前根本不能声称做完。

</template>

</Exercise>

<Exercise title="故意制造一次只在某台机器上出现的遮挡并解释为什么它挑设备" difficulty="进阶">

把一个固定定位在视口底部的工具条，改成没有任何安全区补偿、并且父容器使用 `height: 100vh`。在桌面模拟器（不带刘海）与一台带底部指示条的真机上分别操作同一个流程。写出：两处各自看到什么、为什么模拟器给不出这个 bug、以及这个遮挡在什么条件下会自行消失（提示：想想工具栏收起与 `vh` 的等价关系）。

<template #answer>

桌面模拟器里工具条正常可见，因为模拟器默认不给你非零的 inset，也没有真实设备的底部手势区；真机上工具条下半部分落在指示条区域，且因为父容器用的是大视口单位（`vh` 等价 `lvh`），布局本身比可见区高，多出来的一截正是被吃掉的那截。

「自行消失」的条件有两个：**用户滚动让地址栏收起后，可见区接近大视口**，遮挡明显减轻；或者把工具条内容上移（加内边距），使它落在安全区之内。

这题真正要得出的是那条纪律：**模拟器能验「语法对不对」，验不了「数值对不对」。** `env()` 有没有生效是前者，`env()` 到底给了多少像素是后者。

</template>

</Exercise>

<Exercise title="把一段自绘手势代码改成 Pointer Events 并指出你阻止了什么默认行为" difficulty="挑战">

下面这段是常见的触摸手写实现。把它改写为 Pointer Events 版本，并在答案里列出：改写后哪些默认行为仍然保留、你新获得了什么能力（至少三项），以及如果你继续在 `pointerdown` 里调用 `preventDefault`，会得到什么后果。

```js
el.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  start(t.clientX, t.clientY);
});
el.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  move(t.clientX, t.clientY);
});
el.addEventListener('touchend', () => end());
```

<template #answer>

改写要点：监听 `pointerdown`/`pointermove`/`pointerup`/`pointercancel`，在 `pointerdown` 里调用 `setPointerCapture(e.pointerId)`，用 `e.pointerType` 区分鼠标/触摸/笔。新获得的能力至少有三项：**同一套代码同时处理鼠标与触摸**（官方推荐它的原因）、**指针捕获**（手指/光标移出元素仍能继续收到事件，不必监听全局）、**多指针可用**（`pointerId` 让双指缩放/双手书写可以按指针分开记账）。

保留的默认行为取决于你是否阻止：如果 `pointerdown` 里 `preventDefault()`，滚动、双击缩放、以及合成点击都可能被取消，链接类交互失效——这与本章第六条错误是同一个病因。正确组合通常是：**CSS 上用 `touch-action: none` 声明「这个元素我自己处理手势」，JS 里不做全面阻止**，或者只阻止 `pointermove` 阶段的默认滚动。这样做的额外好处是声明式、可读、且不会因为忘记阻止而在别的浏览器分支里出问题。

`pointercancel` 不能省：系统手势（比如边缘返回、来电接管）会取消指针序列，不处理它的画板会留下「永远按下」的状态。

</template>

</Exercise>

## 官方文档与延伸阅读

本批实际抓取并对照过的页面（支撑本章的取值范围、行为定义与推荐写法）：

- [MDN · viewport meta](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport) —— 关键字取值范围、`width=device-width` 的推荐写法、`viewport-fit=cover` 与安全区的配套建议、关闭缩放的无障碍警告、`interactive-widget` 三个取值。
- [MDN · env()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env) —— 四个 `safe-area-inset-*` 的定义、「矩形视口时为 0」、第二参数回退写法、名称大小写敏感、页脚内边距示例。
- [MDN · length](https://developer.mozilla.org/en-US/docs/Web/CSS/length) —— `vh` 等价于 `lvh`、`svh`「一般更安全但可能留白」、`dvh` 随浏览器界面动态变化及其重排代价。
- [MDN · touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action) —— `manipulation` 的定义与「免除 click 延迟」的机制、不继承、与祖先取值求交集的规则。
- [MDN · Touch events](https://developer.mozilla.org/en-US/docs/Web/API/Touch_events) —— 事件序列、`changedTouches`、非 Baseline、推荐 Pointer Events、`preventDefault` 抑制鼠标事件的提醒。

需要你自己查支持度与真机表现的：

- [MDN · Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) —— 手势代码的现行主线接口。
- [MDN · CSS @supports](https://developer.mozilla.org/en-US/docs/Web/CSS/@supports) —— 渐进增强的显式特性检测。
- [caniuse.com](https://caniuse.com/) —— 视口单位与 `env()` 的支持度，**结论必须与真机对照**。
- [W3C · WCAG 2.1 全文](https://www.w3.org/TR/WCAG21/) —— 触控目标尺寸与缩放能力的要求原文；本章刻意不复述具体像素值，标准里查得到且以它为准。
- 站内回指：[响应式布局与断点](/css/responsive-design)、[盒模型与尺寸](/css/box-model)、[定位与层叠](/css/positioning-and-stacking)、[单位与自定义属性](/css/units-and-custom-properties)、[表单标记](/html/forms)、[DOM 与事件](/javascript/dom-and-events)。

## 下一章

这一章处理的都是**标准层**问题：答案可以在文档里查到，改完之后收益立刻出现在你现有的 Web 产品上。下一章开始进入平台层，判断方式要换一套——[微信小程序：心智对照（一）](/mobile/miniprogram-model)讲的是小程序的框架机制：逻辑层不运行在浏览器里，因此 `window`、`document` 不可用；数据要靠 `setData` 显式发给视图层，而不是像 Vue 那样被自动追踪；样式单位用 `rpx`，它以页面总宽度的 1/750 为基准（375px 宽时 1rpx 相当于 0.5px）；属性选择器与带参数的伪类伪元素不生效。这些差别不是「平台偏好」，而是**双线程架构的直接后果**，把它们一条条对照着你已经熟悉的 Vue 3 心智模型来看，比背 API 快得多。本章那条「模拟器能验语法、验不了数值」的纪律，到了小程序一章会升级成更重要的一句：**模拟器连语法都不能全验，真机才是终审。**
