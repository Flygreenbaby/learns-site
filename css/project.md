# 响应式落地页：验收标准先于样式，能自查的才算做完

导航吸住了，展开的菜单面板却被主视觉压住一角；卡片墙在 768px 正好三列，拖到 780px 变两列还多出一条横向滚动；深色模式切完剩一半浅底浅字。三个现象都不是「属性记错」，而是**约束系统被填进了互相矛盾的输入**。

本章的读法是硬的：先读验收标准，再按六个阶段做，每阶段做完立刻执行检查动作，不通过就停在原地修，不许带问题进下一阶段。本章不给成品，给可以直接抄进项目的 HTML 骨架、`:root` 令牌块和几段关键实现。

<Callout type="unverified" title="本章代码未在本机浏览器运行验证">

本任务没有浏览器环境，文中所有 HTML、CSS、JS 片段**都没在真实浏览器里渲染过**，也没跑过布局探针。它们是按规范语法与已核实的规范语义写成的可用代码，但「可用」不等于「已验证」；涉及具体数值处一律写「预期结果是…」，判定权交给你的浏览器。

先搭一个刷新就能看到结果的环境（命令本章未在本机执行，可用性自行确认）：**路线 A** 是 `landing/index.html + style.css + main.js`，直接双击 html，因为不用模块脚本，`file://` 下 CSS 照常生效；**路线 B** 起本地静态服务器 `cd landing && npx --yes serve --listen 3000`，预期终端打印 `Local: http://localhost:3000`，地址栏可改、Network 行为更接近真实部署。

逐宽度验证路径（后面所有「检查动作」都依赖它）：

1. Chrome/Edge 打开页面，`F12` → 设备工具栏图标（`Ctrl+Shift+M`）进响应式模式。
2. 宽度依次**手输** 320 / 375 / 768 / 1280 / 1920，每档截图存 `shots/`。别让浏览器自选尺寸，「差不多对」会骗过你。
3. 每档查横向溢出，Console 粘贴执行，预期输出 `no overflow`：

```js
const over = [...document.querySelectorAll('*')].filter(
  (el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1
);
console.log(over.length ? over : 'no overflow');
```

4. 交叉确认：`document.documentElement.scrollWidth` 应当**不大于** `clientWidth`，更大就是真能横向滚。
5. `Ctrl+-` 缩到 200%（或系统字号拉满）重跑第 3 步。这一档验收标准没写，但最常翻车。

</Callout>

## 项目目标与范围

为本站第一期里程碑产品做一个**静态落地页**：吸顶导航、主视觉、3–4 个特性卡片、三档价格表格、注册表单、页脚。产出三个文件：`index.html`、`style.css`、`main.js`（只服务汉堡菜单，允许为零）。图片用纯 CSS 图形或占位图，**不评设计还原度**。

明确不做什么：

- **不引入构建工具与框架**（Vite、Tailwind、Sass、Vue、React 都不用）。样式必须被浏览器直接解析，「禁 `!important`」「全部值走自定义属性」才没法靠预处理生成的类名绕过。工程化配置留给 `/frontend-engineering/` 的阶段项目。
- **不写后端。** 表单只做到原生校验 + `required`，`action="#"`，不接接口。
- **不做滚动动画、视差、轮播。** 动效只允许「状态变化时一次过渡」，那是[过渡与动画](/css/transitions-and-animations)的范围。
- **不引第三方样式库**，连 `normalize.css` 都不要：重置那 20 行自己写、自己知道在管什么。
- **不兼容旧浏览器，但也不裸用高风险特性。** `:user-invalid`、`backdrop-filter`、`overflow: clip`、容器查询都属较新能力，必须有兜底或降级后仍可验收，动手前逐个在 [Can I use](https://caniuse.com/) 核对。

## 先把 HTML 结构定下来

先写结构再写样式不是好习惯，是**唯一可行顺序**：选择器的复杂度是结构质量的直接函数，结构语义对，样式表能短一半；结构是一堆无意义 `div`，你会拿大量选择器和 `!important` 去对抗自己写坏的结构。注释标了对应的 HTML 章节。

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="utf-8">
  <!-- viewport 见 HTML 第 2 章：不写 user-scalable=no，不漏 initial-scale -->
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ProductName · 把学习计划变成可执行清单</title>
  <link rel="stylesheet" href="style.css">
</head>
<body id="top">
  <!-- 跳转链接必须是第一个 Tab 焦点：HTML 第 4、9 章 -->
  <a class="skip-link" href="#main">跳到主内容</a>
  <header class="site-header">
    <a class="brand" href="#top">ProductName</a>
    <nav class="site-nav" id="site-nav" aria-label="主导航">
      <ul class="nav-list">
        <li><a href="#features">功能</a></li><li><a href="#pricing">价格</a></li><li><a href="#signup">注册</a></li>
      </ul>
    </nav>
    <!-- 窄屏才出现。用原生 button 才自带键盘支持：HTML 第 9 章 -->
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
      <span class="sr-only">菜单</span><span class="nav-toggle-icon" aria-hidden="true"></span>
    </button>
  </header>
  <main id="main">
    <!-- HTML 第 3、8 章：整页只有一个 h1，标题层级不跳级 -->
    <section class="hero" aria-labelledby="hero-title">
      <h1 id="hero-title">把学到的东西，变成能勾选的清单</h1>
      <p class="hero-lede">从 CSS 层叠到部署上线，一条连续路径。</p>
      <p class="hero-actions"><a class="btn btn-primary" href="#signup">免费开始</a>
        <a class="btn btn-ghost" href="#features">看看有什么</a></p>
    </section>
    <section id="features" aria-labelledby="features-title">
      <h2 id="features-title">你能用它做什么</h2>
      <!-- CSS 会移除列表标记，所以显式补回语义：HTML 第 8 章 -->
      <ul class="card-grid" role="list">
        <li><article class="card"><h3>按顺序学</h3><p>12 章严格递进。</p></article></li>
        <li><article class="card"><h3>每章能验证</h3><p>代码带预期结果。</p></article></li>
        <li><article class="card"><h3>跨端一致</h3><p>手机与桌面同一套内容。</p></article></li>
      </ul>
    </section>
    <section id="pricing" aria-labelledby="pricing-title">
      <h2 id="pricing-title">价格</h2>
      <!-- 确实是表格数据所以用 table：HTML 第 7 章 -->
      <div class="table-wrap" role="region" aria-label="价格方案表格，可横向滚动" tabindex="0">
        <table class="price-table">
          <caption>三档方案，均含 14 天试用</caption>
          <thead><tr><th scope="col">方案</th><th scope="col">价格</th><th scope="col">包含内容</th></tr></thead>
          <tbody>
            <tr><th scope="row">自学</th><td>0 元</td><td>全部正文与练习</td></tr>
            <tr><th scope="row">陪跑</th><td>199 元</td><td>作业批改与答疑</td></tr>
            <tr><th scope="row">团队</th><td>按席位</td><td>进度看板</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <section id="signup" aria-labelledby="signup-title">
      <h2 id="signup-title">注册</h2>
      <!-- label 用 for 显式关联：HTML 第 6 章 -->
      <form class="signup" action="#" method="post">
        <fieldset><legend>账号信息</legend>
          <p class="field"><label for="email">邮箱</label> <input id="email" name="email" type="email" autocomplete="email" required></p>
          <p class="field"><label for="password">密码</label> <input id="password" name="password" type="password" autocomplete="new-password" minlength="10" required> <small class="hint">至少 10 个字符</small></p>
        </fieldset>
        <fieldset><legend>偏好</legend>
          <p class="field field-check"><input id="toc" name="toc" type="checkbox" required> <label for="toc">我已阅读并接受服务条款</label></p>
        </fieldset>
        <button class="btn btn-primary" type="submit">创建账号</button>
      </form>
    </section>
  </main>
  <footer class="site-footer">
    <nav aria-label="页脚导航"><ul class="footer-list"><li><a href="#features">功能</a></li><li><a href="#top">回到顶部</a></li></ul></nav>
    <p class="copyright">版权所有 2026 ProductName。</p>
  </footer>
  <script src="main.js"></script>
</body>
</html>
```

三处选择的依据：

- 每个 `section` 用 `aria-labelledby` 指向自己的 `h2`，读屏软件才报得出分区名（[语义化布局](/html/layout-semantics)）。
- `ul > li > article` 显式写 `role="list"`：卡片容器必然上 `list-style: none`，而 Safari + VoiceOver 在标记被移除后不再把 `ul` 当列表（[HTML 层面的无障碍](/html/accessibility)）。这是本项目唯一一处「用 ARIA 补语义」而不是「用 ARIA 救坏结构」。
- 价格用 `table + caption + th[scope]`（[表格](/html/tables)），判据是**行列各自是一个维度、交叉格才完整**；表单一次写全 `for`、`name`、`autocomplete`、`required`、`minlength`（[表单](/html/forms)），CSS 侧于是只需处理「聚焦反馈」与「校验状态」。

<Callout type="warn" title="骨架里有两处刻意的取舍">

其一，导航按钮用原生 `button` 加十余行 JS，而不是 checkbox 纯 CSS 方案：后者能零 JS 且键盘可用，但维护不了 `aria-expanded`，读屏用户听不到「当前是否已展开」。两条路线本章都允许，代价写在参考答案要点。其二，`main.js` 放在 `body` 末尾且不加 `defer`；挪进 `head` 就必须加 `defer`，否则脚本执行时按钮还不存在。

</Callout>

## 设计令牌：先把 :root 写满，再写第一条业务样式

「切一个根变量就整体换主题」只有在写组件样式**之前**定好令牌才可能达成。先写样式再回头抽变量一定会漏，而漏掉的那个值就是深色模式下没变暗的那一半。令牌分四层：原始色板 → 语义色 → 尺寸阶梯 → 组件引用；组件里**只允许出现语义名**，禁止直接引用 `--brand-500`。

```css
:root {
  color-scheme: light dark;          /* 表单控件、滚动条、默认背景跟随主题 */

  /* 原始色板：整个项目里唯一允许出现具体色值的地方 */
  --brand-300: #93a4ff;  --brand-500: #4a5bd6;  --brand-700: #2c3899;
  --neutral-0: #fff;  --neutral-50: #f6f7fb;  --neutral-200: #dfe3ee;
  --neutral-600: #5b6478;  --neutral-900: #14161d;  --danger-500: #c2273b;

  /* 语义色：组件只认这一层 */
  --bg: var(--neutral-50);   --surface: var(--neutral-0);
  --fg: var(--neutral-900);  --fg-muted: var(--neutral-600);
  --border: var(--neutral-200);
  --accent: var(--brand-500);  --accent-hover: var(--brand-700);
  --accent-contrast: var(--neutral-0);
  --focus-ring: var(--brand-700);  --error: var(--danger-500);

  /* 排版：根字号交给浏览器默认，全站用 rem；行宽用 ch */
  --text-sm: 0.875rem;  --text-base: 1rem;
  --text-lg: clamp(1.0625rem, 1rem + 0.35vw, 1.25rem);
  --text-xl: clamp(1.3rem, 1.1rem + 0.9vw, 1.75rem);
  --text-hero: clamp(1.875rem, 1.3rem + 2.6vw, 3.25rem);
  --leading-tight: 1.2;  --leading-body: 1.65;  --measure: 68ch;

  /* 间距：4px 基数的阶梯管组件内，流式值管分区间 */
  --space-1: 0.25rem;  --space-2: 0.5rem;  --space-3: 0.75rem;  --space-4: 1rem;
  --space-5: 1.5rem;   --space-6: 2rem;    --space-7: 3rem;
  --space-section: clamp(3rem, 2rem + 5vw, 6rem);

  /* 圆角、边框、阴影 */
  --radius-sm: 4px;  --radius-md: 10px;  --radius-lg: 18px;  --radius-pill: 9999px;
  --border-1: 1px solid var(--border);
  --shadow-sm: 0 1px 2px rgb(20 22 29 / 0.08);
  --shadow-md: 0 6px 24px -8px rgb(20 22 29 / 0.22);

  /* 布局尺寸 */
  --gutter: clamp(1rem, 4vw, 2.5rem);  --content-max: 72rem;
  --nav-h: 3.5rem;  --card-min: 17rem;

  /* 层级与动效：z-index 与 duration 只从这两组取值 */
  --z-nav: 20;  --z-sheet: 40;  --z-toast: 60;
  --dur-1: 120ms;  --dur-2: 220ms;  --ease-out: cubic-bezier(0.2, 0.8, 0.3, 1);
}

/* 深色主题：原始色板不动，只重写语义名 */
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0e1015;  --surface: #171a21;
  --fg: #e9ebf2;  --fg-muted: #a2aabd;  --border: #2a2f3a;
  --accent: var(--brand-300);  --accent-hover: #b6c2ff;  --accent-contrast: #0e1015;
  --focus-ring: #b6c2ff;
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.5);
  --shadow-md: 0 8px 28px -10px rgb(0 0 0 / 0.7);
}

/* 未手工指定主题时跟随系统。内容与上一块完全一致，重复是刻意的：
   变量集必须成对出现，漏一个就是「只暗了一半」。这一段要你亲手复制。 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { }
}
```

三个决定的理由：`[data-theme="dark"]` 与 `:root:not([data-theme])` **靠选择器互斥**，永不同时命中同一元素，所以不存在需要 `!important` 压顺序的时刻（[选择器与特异性](/css/selectors)）；`--text-hero` 上下界都用 `rem`，MDN 建议字号的「最大值应是不小于最小值两倍的相对长度单位」，上界写 `px` 会在 200% 缩放时被钉死；`--space-section` 不进 `--space-1..7` 阶梯——分区节奏跟视口相关、跟组件无关，混进离散阶梯会让 320px 下每个分区白送 `3rem` 空隙。

## 六个阶段

### 阶段 1：全局重置与盒模型

产出约 20 行：`*, *::before, *::after { box-sizing: border-box }`、元素级 `margin: 0; padding: 0`、`img { max-width: 100%; display: block }`、`html { -webkit-text-size-adjust: 100% }`、`body` 的字体与 `line-height: var(--leading-body)` / `background: var(--bg)` / `color: var(--fg)`、全局 `overflow-wrap: anywhere`。

**不要写 `html { font-size: 62.5% }` 这个老写法**：根字号被钉成 `10px` 后，用户「系统字号调最大」的偏好会被固定比例吸收，全站 `rem` 还得按 10 进制心算。

检查动作：Computed 里 `box-sizing` 为 `border-box`，Layout 盒模型图中 padding 落在宽度之内；`getComputedStyle(document.documentElement).fontSize` 预期 `16px`，**不能是 `10px`**。

### 阶段 2：布局骨架

```css
body {
  min-height: 100svh;                 /* 不用 100vh：地址栏展开时底部会被裁，见响应式设计 */
  display: grid; grid-template-rows: auto 1fr auto;   /* header / main / footer */
}
.site-header, main > section, .site-footer {
  inline-size: 100%; max-inline-size: var(--content-max);
  margin-inline: auto; padding-inline: var(--gutter);
}
main > section { padding-block: var(--space-section); }
.hero-lede, .card p, .hint { max-inline-size: var(--measure); }
```

检查动作：内容不足一屏时页脚贴在视口底部（`1fr` 把 `main` 那行拉长）；1920px 连续拖到 320px，左右留边**连续变化**而不是某处突然跳档；1920px 下正文被 `--content-max` 居中、行长不超 `--measure`。

### 阶段 3：导航

产出：吸顶导航 + 窄屏折叠 + 层级定死。折叠阈值写 `@media (max-width: 47.9375em)` 而不是 `767px`：`em` 断点跟随用户字号移动，字号调大后导航应当**更早**折叠而不是挤成一团。header 用 `--z-nav`、展开面板用 `--z-sheet`，面板必须是 header 的后代并与它在同一层叠上下文——为「加速」在 header 上写 `transform: translateZ(0)` 会让它自创层叠上下文、把面板关在里面（状态样式见参考答案要点）。

检查动作四条全过才算完：① 滚动时导航保持可见，不动就按序查 `top` 是否非 `auto`、祖先链有没有 `overflow` 非 `visible`、header 父级高度是否足够；② 320px 只用键盘，Tab 顺序应为「跳转链接 → 站名 → 菜单按钮 → 面板三个链接」，焦点顺序与视觉顺序不符就是 `order` 或 `row-reverse` 用错了地方；③ `Esc` 收起面板且焦点回到按钮；④ 收起时连按 10 次 Tab **一次都不该落进面板**。

### 阶段 4：主视觉与卡片墙

```css
.card-grid {
  display: grid; list-style: none; padding: 0; gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(min(var(--card-min), 100%), 1fr));
}
.card {
  min-width: 0; overflow-wrap: anywhere;
  background: var(--surface); border: var(--border-1);
  border-radius: var(--radius-lg); padding: var(--space-5); box-shadow: var(--shadow-sm);
}
.hero h1 { font-size: var(--text-hero); line-height: var(--leading-tight); max-width: 24ch; }
.hero-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.btn { display: inline-flex; align-items: center; min-block-size: 2.75rem;
  padding-inline: var(--space-5); border-radius: var(--radius-pill); }
.btn-primary { background: var(--accent); color: var(--accent-contrast); }
.btn-primary:hover { background: var(--accent-hover); }
```

`min(var(--card-min), 100%)` 是本章最容易写错的一处：`minmax()` 第一参数是**轨道硬下限**，容器比它窄时不让步、直接溢出。`17rem` 按 16px 是 `272px`，320px 扣掉两侧 `--gutter`（各 `1rem`）只剩 `288px`，裸写 `minmax(17rem, 1fr)` 必然出现横向滚动；`min(…, 100%)` 把下限变成「绝对值与容器宽度取小」，窄屏自动退化单列铺满。`auto-fit` 而非 `auto-fill` 的理由见下一条验收标准与核实清单。

检查动作：320→1920 连续拖，预期列数约 1 → 2 → 3，**全程没有媒体查询参与**（Layout → Grid 覆盖层画轨道线核对）；`.card-grid` 附近搜 `@media` 命中 0；换成 60 字符无空格英文串后 320px 仍不溢出（裸 `1fr` 隐含 `min-content` 下限，见 [Grid](/css/grid)）。

### 阶段 5：价格表格与表单

表格**不要**为了响应式把 `display` 改成 `grid` 或拆成卡片，那会摧毁第 7 章建立的行列关联；正解是保留表格语义、让它在可滚动容器里保持最小宽度：

```css
.table-wrap { overflow-x: auto; overscroll-behavior-x: contain; }
.price-table { border-collapse: collapse; inline-size: 100%; min-inline-size: 34rem; }
.price-table th, .price-table td { padding: var(--space-3) var(--space-4); text-align: start; }
.price-table thead th { border-block-end: 2px solid var(--fg); }
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.field input { border: var(--border-1); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); }
/* 空的 required 字段一进页面就命中 :invalid，错误态必须收窄 */
.field input:user-invalid { border-color: var(--error); }
.field input:invalid:not(:placeholder-shown) { border-color: var(--error); }
```

`min-inline-size: 34rem` 大于 320px，所以窄屏下**是容器在滚而不是页面在滚**：滚动被限制在容器内，`documentElement.scrollWidth` 仍等于 `clientWidth`，这才是「无横向滚动条」的正确达成方式。骨架给 `.table-wrap` 加 `tabindex="0"` + `role="region"`，是因为可滚动但不可聚焦的区域键盘用户进不去。聚焦三条硬规矩：`:focus-visible` 必须有可见轮廓、不能只靠 `border-color` 变化（对比度不足）、禁止 `outline: none` 而无同层替代。

检查动作：只用键盘走一遍注册，`Tab` 进邮箱框时焦点清晰；空内容 `Tab` 到提交按钮回车，预期浏览器弹原生校验提示且**只有真正有问题的字段变红**；`.table-wrap` 的 `scrollWidth` 在 320px 下预期大于其 `clientWidth`，而全局探针仍输出 `no overflow`。

### 阶段 6：主题与动效收尾

产出：主题切换按钮（复用阶段 3「JS 只改一个属性」的模式）、把 `--dur-*` 接进所有过渡、减弱动效分支。减弱动效不要用常见的 `animation-duration: .01ms !important` 通配写法，它违反第 6 条验收；正解是令牌化的直接回报——所有时长都来自 `--dur-1/--dur-2`，所以只改根上这一处：

```css
@media (prefers-reduced-motion: reduce) {
  :root { --dur-1: 1ms; --dur-2: 1ms; --ease-out: linear; }
}
```

同特异性的 `:root` 规则写在文件后面就按顺序覆盖前面那条（[CSS 如何生效](/css/how-it-works)：顺序是层叠的排序维度之一），不需要 `!important`。代价是组件里硬编码的 `0.3s` 不受它控制——所以这条检查同时也是令牌完整性的检查。

检查动作：Windows 设置 → 辅助功能 → 视觉效果关掉「动画效果」（macOS 开「减弱动态效果」）后刷新，预期 hover 与展开在肉眼层面瞬间完成；再用 DevTools → Rendering → Emulate `prefers-reduced-motion` 交叉确认，两者表现应当一致。切到深色后**逐个 `Tab`**：能聚焦的元素是配色破口最集中的地方。

## 六条验收标准：怎么做到，怎么自查

逐条对应 [CSS 首页](/css/)的阶段项目验收标准。**每条都要能自己复现出通过与不通过两种状态**，否则只算「看起来对」。

| 验收标准 | 怎么做到 | 怎么自查 |
| --- | --- | --- |
| 320 / 375 / 768 / 1280 / 1920 五档布局正确、无横向滚动 | `border-box` 让 padding 不吃宽度；`--gutter` 用 `clamp()`；所有可能比容器宽的轨道与元素都带 `min(…, 100%)` 或 `max-width: 100%` | 探针跑五档全部 `no overflow`，且 `scrollWidth === clientWidth`；200% 缩放再跑一次。**别用 `body { overflow-x: hidden }`**，它藏起症状而溢出还在、内容仍被切 |
| 卡片墙用 Grid，宽屏自动加列且不靠媒体查询 | `repeat(auto-fit, minmax(min(17rem, 100%), 1fr))` 一行，列数是容器宽度的函数而不是断点表的函数；`auto-fit` 会把空的重复轨道折叠（MDN：「视为单一固定尺寸 `0px`，两侧 gutter 一并折叠」），`auto-fill` 则保留 | `.card-grid` 内 `@media` 命中 0；连续拖宽度看列数平滑跳变；Elements 面板里删到只剩一张卡，它应铺满整行而非占一轨留三个空洞（这就是折叠的证据） |
| 窄屏汉堡菜单可键盘完整操作 | 原生 `button` + `aria-expanded` + `visibility: hidden` 收起 + `Esc` 关闭并归还焦点 + 回宽屏清掉展开态；状态由属性驱动样式，JS 不写内联 `style.display` | 不碰鼠标完成「展开 → 进入注册 → 关闭 → Tab 到主内容」；收起时 Tab 十次不落进面板 |
| 语义化表单，`label` 正确关联，聚焦有清晰反馈 | `label[for]` + `fieldset/legend` + `:focus-visible` 轮廓 + 只用 `:user-invalid` 上红色 | `document.querySelectorAll('label:not([for])').length` 为 0；遍历控件找不出「没有对应 `label[for]`」的项；每处 `outline: none` 都能在同一条规则指出替代物；Emulation → Vision Deficiencies 选一种色觉缺陷后焦点环仍靠形状/偏移可辨 |
| 颜色、字号、间距全部走自定义属性，切一个根变量整体换主题 | 组件只引用语义名；深色分支把 `--bg / --surface / --fg / --fg-muted / --border / --accent / --accent-contrast / --focus-ring / --shadow-*` **成对覆盖**（漏一个就是一处破口）；连 `duration` 也进令牌 | 三个「一键破坏」：`--bg` 改 `rebeccapurple` → 背景必须变紫；`--space-4` 改 `0` → 卡片内边距与列表间距一起塌；`--text-base` 改 `1.25rem` → 文字一起变大且不溢出。再搜 `#` 开头色值与两位以上 `px`，命中行应当**全部落在 `:root` 与主题覆盖块** |
| 全站禁 `!important` | 要压过别的规则按序用三件武器：选择器写得更具体（`main .card` 而不是 `.card`）、调整源码顺序、用 `@layer` 分层（层间优先级由声明顺序决定，与特异性无关） | 搜 `!important` 命中 0。它也不能用来修第 5 条的漏项：`.card { background: #171a21 !important }` 只是把「令牌集不完整」伪装成已修好，下一个用 `--surface` 的组件照样白，而且它是层叠排序里最高的一档，会连带压住用户自己的高对比样式表 |

### 交付前快速勾选

- [ ] 五档宽度截图存 `shots/`，横向溢出探针全部 `no overflow`
- [ ] 200% 缩放与系统最大字号下同样无横向滚动
- [ ] 卡片墙附近 0 条媒体查询，列数随宽度连续变化
- [ ] 纯键盘完成一次注册流程；面板收起时 Tab 不落进隐藏链接
- [ ] 所有控件都有对应 `label[for]`；`outline: none` 出现 0 次（或每次都有替代）
- [ ] 三个「一键破坏」令牌测试全部生效
- [ ] `!important` 出现 0 次
- [ ] DevTools 逐条禁用样式表，能指出每个视觉区块由哪些规则负责
- [ ] 深色主题无浅底浅字残留；`prefers-reduced-motion` 开启后动效消失
- [ ] HTML 过 W3C Nu 校验（`validator.w3.org/nu/`）0 错误

## 常见翻车点与排查

| 现象 | 原因 | 怎么确认 | 怎么修 |
| --- | --- | --- | --- |
| 320px 有横向滚动但看不出谁溢出 | `minmax(17rem, 1fr)` 轨道硬下限比容器宽；或写了 `100vw`（桌面下它把滚动条宽度也算进去） | 探针列出元素；看 Computed `width` 是否大于 `clientWidth` | 下限改 `min(17rem, 100%)`；`100vw` 换成 `100%` 或干脆不写宽度 |
| 卡片放 3 张就挤爆而不换行 | 卡里有不换行长词或长 URL，裸 `1fr` 隐含 `min-content` 下限把轨道撑大 | Layout → Grid 覆盖层看第一列宽度远超 `17rem` | 文字 `overflow-wrap: anywhere`；`.card { min-width: 0 }` |
| 导航不吸顶 | 没写 `top`；或祖先有 `overflow: hidden/auto/scroll`（sticky 贴合**最近带滚动机制的祖先**而非页面）；或父高不足 | Console 沿 `parentElement` 往上打印 `getComputedStyle(el).overflow` | 补 `top: 0`；「为裁圆角加的 `overflow: hidden`」换成 `overflow: clip`（不建立滚动容器，较新特性需核对） |
| `z-index: 999` 的面板被 hero 文字压住 | 祖先有 `transform`/`filter`/`backdrop-filter`/`opacity` 小于 1，自创层叠上下文把面板关在里面；`z-index` 只在同上下文内比较 | 逐个悬停祖先，看 DevTools 是否标注 stacking context | 面板移出该祖先或挂到 `body`；用 `isolation: isolate` 界定边界；去掉那句 `translateZ(0)` |
| 键盘走不通：Tab 跳过按钮，或收起后仍能 Tab 进菜单 | checkbox 方案写了 `display: none`（连带不可聚焦）；隐藏面板只做了 `opacity: 0` | 只按 Tab，观察 `:focus` 高亮落点 | checkbox 改「视觉隐藏但保留可聚焦」+ `:focus-visible` 给 label 画轮廓；收起一律 `visibility: hidden` |
| 一进页面所有必填框都红 | 用了 `:invalid`，空的 `required` 字段当下就命中 | 不聚焦不输入，数红框 | 改 `:user-invalid`，兜底 `:invalid:not(:placeholder-shown)`；`placeholder` 不能当 label |
| 深色模式只暗了一半 | 组件写了字面量色值；或中间层重新声明同名语义变量（自定义属性只继承不合并，整棵子树被旧值锁死） | 改 `--surface` 看哪块不动；Computed 里看该元素变量继承链上最近的声明者 | 字面量收回令牌层；删掉中间层的重复声明（[值、单位与自定义属性](/css/units-and-custom-properties)） |
| 切了主题但输入框、滚动条还是亮的 | 没设 `color-scheme`，浏览器仍按浅色绘制原生控件——这一处**变量覆盖不到** | 看下拉框箭头与复选框底色 | `:root` 设 `color-scheme: light dark`，深色分支设 `dark` |
| `clamp()` 不跟视口变化 | MDN：`clamp(MIN, VAL, MAX)` 解析为 `max(MIN, min(VAL, MAX))`，中间项在设计区间内恒取不到时结果恒等于某个界；或上界用 `px` 卡死缩放 | 拖窗口看字号是否只在某一端「跳一下」 | 重算中间项斜率让它在区间内真的生效；上下界都用 `rem` |

<Callout type="verified" title="本章四处规范语义已对 MDN 核实">

核实时间 2026 年 10 月 17 日，用 WebFetch 取原文：

- [`repeat()`](https://developer.mozilla.org/en-US/docs/Web/CSS/repeat)：`auto-fit`「行为同 `auto-fill`，但在放置网格项目后任何空的重复轨道被折叠」，折叠后「视为单一固定尺寸 `0px`，两侧 gutter 一并折叠」。
- [`clamp()`](https://developer.mozilla.org/en-US/docs/Web/CSS/clamp)：`clamp(MIN, VAL, MAX)` 解析为 `max(MIN, min(VAL, MAX))`；各参数单位可不同；用于字号时「最大值应是不小于最小值两倍的相对长度单位」。
- [`position`](https://developer.mozilla.org/en-US/docs/Web/CSS/position)：sticky「按 inset 相对**最近的滚动祖先**与包含块偏移」；「该值总是创建一个新的层叠上下文」；「该轴两个 inset 都为 `auto` 时表现为 `relative`」。
- [使用 CSS 自定义属性](https://developer.mozilla.org/zh-CN/docs/Web/CSS/Using_CSS_custom_properties)：自定义属性「总是继承父元素的值」，选择器决定作用域、可在子树覆盖；`var()` 第二参数是回退值，「第一个逗号到函数结尾都算作回退值」。

这四条是**文档层面**的核实，不是浏览器行为验证。各特性的支持时间与实现差异本章一律未核实（`auto-fit` 折叠、`:user-invalid`、`backdrop-filter`、`overflow: clip`、容器查询都可能有差异），动手前按特性名在 [Can I use](https://caniuse.com/) 确认目标浏览器。

</Callout>

## 练习

<Exercise title="练习 1 · 把卡片墙改坏并预测现象" difficulty="进阶">

以 `grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr))` 为基准，预测三处改动在 320px 与 1280px 下的结果，然后真的改一次核对：

| 改动 | 320px | 1280px |
| --- | --- | --- |
| A：去掉 `min(…, 100%)`，写成 `minmax(17rem, 1fr)` | ? | ? |
| B：`auto-fit` 改成 `auto-fill` | ? | ? |
| C：`17rem` 改成 `60rem` | ? | ? |

哪一项会在「只剩一张卡片」时右侧留空白轨道？哪一项属于「宽屏看不出问题、上线才发现」？

<template #answer>

**A**：`17rem` 是 `272px`，320px 扣掉两侧 `--gutter` 只剩 `288px`；轨道硬下限不让步 → 溢出、出现横向滚动条。1280px 下 A 与原版一致（约 5 列），所以它属于「宽屏看不出问题、上线才发现」，只能靠 320px 档验出。

**B**：两档的列数与位置**完全相同**。差别只在项目不足以填满已计算轨道时：`auto-fill` 保留空轨道，`auto-fit` 折叠成 `0px`（含两侧 gutter）。删到只剩一张卡，B 下它只占一轨宽、右边留空，原版拉伸铺满整行——「留空白轨道」的答案是 **B**。

**C**：`60rem` 是 `960px`。320px 下 `min(60rem, 100%)` 仍取 `100%`，**不溢出**（这正是 `min()` 的价值），单列铺满；1280px 下 `960px + gutter` 只容 1 列，三列小卡退化成通栏大卡。结论：`--card-min` 就是列数旋钮，改它比加媒体查询有用。

核对方式：选中 `.card-grid` → Layout 面板勾选 Grid 覆盖层，轨道线与被折叠的间距会画在页面上。

</template>

</Exercise>

## 参考答案要点

下面三段是本章最容易写错、也最值得抄的部分。**均为按规范语义手写的可用代码，未在本机浏览器运行。**

<Exercise title="参考答案要点 · 汉堡导航的两条路线与键盘可达性" difficulty="进阶">

给出导航面板的收起/展开样式，以及驱动它的极简 JS 与零 JS 的 checkbox 方案，说明键盘可达性各靠哪几行保证。

<template #answer>

面板收起必须落到 `visibility: hidden`（不可聚焦、不可 Tab）。只写 `opacity: 0` 或用 `translate` 移出视口都是错的：内容视觉上没了，键盘焦点还在，对键盘用户是「幽灵焦点」。

```css
.nav-toggle { display: none; }              /* 宽屏：按钮不出现，也完全不进 Tab 序 */

@media (max-width: 47.9375em) {
  .nav-toggle {
    display: inline-grid; place-items: center;
    inline-size: 2.75rem; block-size: 2.75rem;
    border: var(--border-1); border-radius: var(--radius-md);
    background: var(--surface); color: var(--fg);
  }
  .site-nav {
    position: absolute;
    inset-block-start: var(--nav-h); inset-inline: var(--gutter); padding: var(--space-3);
    background: var(--surface); border: var(--border-1);
    border-radius: var(--radius-md); box-shadow: var(--shadow-md);
    visibility: hidden; opacity: 0; translate: 0 -0.5rem;
    transition: opacity var(--dur-2) var(--ease-out),
      translate var(--dur-2) var(--ease-out),
      visibility 0s linear var(--dur-2);    /* 关闭时延后翻成 hidden */
  }
  .site-header[data-nav="open"] .site-nav {
    visibility: visible; opacity: 1; translate: 0 0;
    transition-delay: 0s;                   /* 展开时 visibility 立刻生效 */
  }
}
```

`visibility 0s linear var(--dur-2)` 是「既有关闭动画、关闭后又不可 Tab」能同时成立的关键：`visibility` 是离散值属性，时长给 `0s`、延迟给 `--dur-2`，它在淡出**完成后**才变 `hidden`；展开态把 `transition-delay` 归零，`visible` 立即生效。展开与宽度无关，所以这段不需要第二个断点。

**推荐路线（原生 button + 十余行 JS）**：可用性由「原生 `button` 自带 Enter/Space 激活」免费提供，脚本只维护语义状态。

```js
const header = document.querySelector('.site-header');
const toggle = header.querySelector('.nav-toggle');
const mqNarrow = window.matchMedia('(max-width: 47.9375em)');

function setNavOpen(open) {
  toggle.setAttribute('aria-expanded', String(open));
  header.dataset.nav = open ? 'open' : 'closed';
}

toggle.addEventListener('click', () =>
  setNavOpen(toggle.getAttribute('aria-expanded') !== 'true'));

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !mqNarrow.matches) return;
  if (toggle.getAttribute('aria-expanded') !== 'true') return;
  setNavOpen(false);
  toggle.focus();                        // 归还焦点给按钮，而不是丢给 body
});

// 窄到宽时清掉展开态，否则 data-nav 残留，下次回窄屏会莫名是开的
mqNarrow.addEventListener('change', () => setNavOpen(false));
```

`aria-expanded` 必须脚本同步（CSS 维护不了它），否则读屏用户听不到展开状态；`header.dataset.nav` 让样式表独占表现、脚本只改语义状态，避免内联 `style.display` 与媒体查询抢所有权；`Esc` 里那两个早退保证只在窄屏且已展开时介入——宽屏没有可关闭的东西，抢 `Esc` 会破坏浏览器原生行为。

**零 JS 路线**：按钮换成「视觉隐藏但可聚焦」的 checkbox + label，用 `:checked` 驱动同一条展开规则。

```css
/* 关键：checkbox 不能 display:none，那样它会从 Tab 序消失，键盘彻底走不通 */
.nav-toggle-cb {
  position: absolute; inline-size: 1px; block-size: 1px;
  margin: -1px; padding: 0; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}
.nav-toggle-cb:focus-visible + .nav-toggle-label {
  outline: 2px solid var(--focus-ring); outline-offset: 2px;
}
.nav-toggle-cb:checked ~ .site-nav { visibility: visible; opacity: 1; translate: 0 0; }
```

结构上 checkbox 与 label 必须在 `.site-header` 内且**排在 `.site-nav` 之前**（`~` 只向后匹配）。焦点其实落在隐形 checkbox 上，视觉反馈必须转移到 label（那个看得见的按钮）上。它做不到的是 `aria-expanded`，这正是本章更推荐 JS 路线的原因。两条路线都要求 `.sr-only` 用 `clip-path: inset(50%)` 而不是 `display: none`（[HTML 层面的无障碍](/html/accessibility)）。

</template>

</Exercise>

<Exercise title="参考答案要点 · 吸顶导航与层叠上下文处理" difficulty="进阶">

写出吸顶导航规则，并解释两处陷阱：祖先的 `overflow`、「加速提示」类属性带来的层叠上下文。

<template #answer>

```css
.site-header {
  position: sticky;
  inset-block-start: 0;              /* 必须非 auto，否则该轴表现为 relative */
  z-index: var(--z-nav);
  block-size: var(--nav-h);
  display: flex; align-items: center; gap: var(--space-4);
  background: var(--surface); border-block-end: var(--border-1);
}
/* 锚点跳转时，被吸顶导航遮住的标题让出导航高度 */
:root { scroll-padding-block-start: calc(var(--nav-h) + var(--space-2)); }
```

`scroll-padding-block-start` 写在 `:root`（滚动容器是根）而不是给每个 `section` 加 `scroll-margin-top`：后者只对直接锚点目标生效，一旦 `id` 挂在 `section` 上而 `h2` 是其子元素就漏。

陷阱一，**祖先的 `overflow`**。MDN 说 sticky 相对「最近的滚动祖先」偏移，而 `overflow: hidden` 同样算有滚动机制。于是那个「为了给 header 裁圆角而加的 `overflow: hidden`」会让 header 以为自己在跟一个不会滚的容器对齐，表现为完全不吸顶。排查：沿 `parentElement` 往上打印 `overflow`，预期第一个非 `visible` 的祖先就是元凶。

陷阱二，**`z-index` 打不过一个没写 `z-index` 的元素**。`transform`、`filter`、`backdrop-filter`、`opacity` 小于 1、`contain: paint`、`isolation: isolate` 都创建层叠上下文，而 `position: sticky` 本身**总是**创建一个新的。于是 header 里的面板哪怕写 `z-index: 40`，对外也只等于 header 的 `--z-nav`（20）。想让它压过主视觉，要么去掉那句 `translateZ(0)`（`will-change: transform` 同样创建层叠上下文，换不动它），要么把面板移出 header、挂到 `body`。毛玻璃导航用的 `backdrop-filter` 同理：按滤镜规范它还会成为后代绝对定位元素的包含块，「挂在 header 里的视口固定弹窗」会被困住——你那一版浏览器的实际行为请自行核对。层级于是有了一条有效规矩：**只有直接参与竞争的兄弟元素才配 `z-index`**，其余靠 DOM 顺序（[定位与层叠上下文](/css/positioning-and-stacking)）。

</template>

</Exercise>

<Exercise title="参考答案要点 · 卡片墙、clamp 排版与主题切换" difficulty="基础">

说明 `--card-min` 与字号令牌怎么配合，并写出主题切换的 JS 与它成立的条件。

<template #answer>

卡片墙与排版都由令牌驱动，组件里没有任何字面量：

```css
.card-grid { grid-template-columns: repeat(auto-fit, minmax(min(var(--card-min), 100%), 1fr)); }
.card { padding: var(--space-5); }                          /* 组件内用阶梯 */
section { padding-block: var(--space-section); }             /* 分区间用流式值 */
h1 { font-size: var(--text-hero); }                          /* clamp(1.875rem, 1.3rem + 2.6vw, 3.25rem) */
p { font-size: var(--text-base); max-inline-size: var(--measure); }
```

`--card-min` 是列数旋钮：调大整体减少列数，调小增加，不需要动任何媒体查询；上下界都是 `rem` 的 `clamp()` 让字号同时满足「跟视口增长」和「跟随用户字号偏好」；`max-inline-size: var(--measure)` 保证宽屏下 `--text-hero` 变大时行宽不一起失控。

```js
const themeBtn = document.querySelector('.theme-toggle');
themeBtn.addEventListener('click', () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); }
  catch { /* 隐私模式下读写会抛，忽略即可 */ }
});
```

脚本只改 `data-theme`，样式表靠 `:root[data-theme="dark"]` 命中，两侧零冲突；`localStorage` 包 `try` 是因为部分环境读写直接抛异常，不包会让整个脚本挂掉、主题与导航一起失效。首屏会闪一下（先渲染 light 再由脚本改属性）；要消除得在 `head` 放一段内联脚本先读存储再写属性，那是阻塞脚本，本章接受这次闪烁并把它留作构建期能力。

一键换肤成立的条件就是「组件不绕过语义层引用字面量」：`--bg` 改紫则背景必须变紫，`--space-4` 归零则间距一起塌，`--text-base` 改 `1.25rem` 则文字变大且不溢出。任何一处「改了没反应」都是同一个 bug——藏了硬编码值，或有个中间层重复声明同名变量把子树锁死（[值、单位与自定义属性](/css/units-and-custom-properties)）。同理，动效时长进了令牌，`prefers-reduced-motion` 才不需要 `!important`。

</template>

</Exercise>

## 官方文档与延伸阅读

按阶段回查，「核实什么」写的是本章你**不该凭记忆相信**的那件事。

- 阶段 1、2：[MDN `box-sizing`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/box-sizing) —— 核实 `border-box` 下 `width` 包含哪几个盒；[MDN Grid 基本概念](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_grid_layout/Basic_concepts_of_grid_layout) —— 核实 `auto` 与 `1fr` 作行轨道尺寸时取值来源不同；[MDN `length`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/length) —— 核实 `svh`/`lvh`/`dvh` 定义（`100svh` 的依据）。机制侧见[盒模型与 margin 合并](/css/box-model)。
- 阶段 3：[MDN `position`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/position)、[层叠上下文](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_positioning/Understanding_z_index/The_stacking_context)、[`isolation`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/isolation) —— 核实「sticky 相对最近滚动祖先」「sticky 总是创建层叠上下文」「哪些属性创建层叠上下文」；[MDN 使用 CSS 过渡](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_transitions/Using_CSS_transitions) —— 核实 `visibility` 这类离散属性的过渡与延迟。
- 阶段 4：[MDN `repeat()`](https://developer.mozilla.org/en-US/docs/Web/CSS/repeat)、[MDN `minmax()`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/minmax)、[自动放置](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_grid_layout/Auto-placement_in_grid_layout) —— 核实 `auto-fit` 折叠空轨道、`minmax` 第一参数是轨道下限；[MDN `clamp()`](https://developer.mozilla.org/en-US/docs/Web/CSS/clamp)、[`min()`](https://developer.mozilla.org/en-US/docs/Web/CSS/min) —— 核实取值公式与混单位表达式。
- 阶段 5、6：[MDN 表单学习区](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Core/Forms) 与 [HTML 元素参考](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements) —— 核实 `required`/`minlength`/`autocomplete` 取值语义（`:user-invalid` 的支持度**本章未核实**），语义侧回读[表单](/html/forms)与[表格](/html/tables)；[MDN 使用 CSS 自定义属性](https://developer.mozilla.org/zh-CN/docs/Web/CSS/Using_CSS_custom_properties) 与 [`var()`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/var) —— 核实继承与子树覆盖、回退值「第一个逗号之后全算回退」；[`prefers-color-scheme`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/@media/prefers-color-scheme)、[`prefers-reduced-motion`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/@media/prefers-reduced-motion) —— 核实条件名；[MDN `@layer`](https://developer.mozilla.org/zh-CN/docs/Web/CSS/@layer) —— 核实层间优先级由声明顺序决定（第 6 条验收的替代方案）。
- 查询、校验与排查：[MDN 使用媒体查询](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_media_queries/Using_media_queries) —— 核实 `em` 断点相对 `px` 的差异；[容器查询](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_containment/Container_queries) —— 「卡片放进侧边栏也要正确」需要的是它而不是媒体查询；[W3C Nu Html Checker](https://validator.w3.org/nu/) —— 交付前跑一遍，目标 0 错误；排查动作见[布局调试方法论](/css/debugging-layout)。[Every Layout](https://every-layout.dev/) 可作布局模式参考，读完本章再看不迟。

## 下一章

这一章把前 11 章的约束收进一个能逐条验收的页面：机制你都有了，缺口变成**这些约束在真实工程里如何被组织、检查与加速**——样式表怎么拆与打包、图片怎么压与懒加载、Lighthouse 那几个指标怎么算出来。下一站是[前端工程化](/frontend-engineering/)：从包管理与锁文件，到 Vite 的开发侧与构建侧，到关键渲染路径与 Core Web Vitals，最后一个阶段项目是给一个真实工程做体检。做本章时你多半已经体会到「300 行 CSS 还撑得住，1500 行就找不着规则」，那正是它要解决的问题。

再往后是 [JavaScript](/javascript/)。本章刻意把 `main.js` 压在十几行、只让它改一个 `data-nav`，你就该感到不满足：汉堡按钮的 `aria-expanded` 只能由脚本同步、主题偏好怎么在首屏之前写入而不闪烁、表单校验为何不该只靠 CSS 伪类——这三件都是 CSS 做不到的。JavaScript 领域从[学习地图](/javascript/learning-map)与类型值开始，一路到 DOM 与事件系统，正好接住这些缺口。
