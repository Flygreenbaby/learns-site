# Vite 构建侧：dev 里不存在的那些问题，为什么全在 build 之后才爆

`npm run dev` 跑得好好的，`npm run build` 之后把 `dist/` 传上服务器却白屏，控制台一行 `Failed to fetch dynamically imported module: https://example.com/assets/Detail-Bqf8kN2p.js`——回 dev 里**完全复现不了**。换一种死法：本地打开 `dist/index.html` 是好的，部署到 `https://site.com/docs/` 子路径下样式全丢、图片全 404；或者首屏只等一个 1.8 MB 的 JS。

同一个来源：**构建是另一个程序**。开发时浏览器按请求逐个模块要东西，Vite 只负责「把这一份文件转成 JS」；构建时没有 HTTP 请求驱动，它必须一次解析整张模块图、把几百个模块拼成少数几个 chunk、抽出 CSS、复制并改名图片、最后把标签写进 HTML。打包、tree-shaking（消除未引用代码）、代码分割（用不到的代码推迟到用时再下）、内容哈希命名、`base` 前缀全是这一侧独有的动作。所以本章不背配置项，只学**读产物**。

<Callout type="verified" title="本章实跑范围：一个临时探针项目">

环境 Windows 10 x64、Node `v25.4.0`、本站 `node_modules` 里的 **vite 5.4.21**（`node -p "require('./node_modules/vite/package.json').version"` 的输出），日期 2026-10-18。我在 `frontend-engineering/.scratch/` 下临时建了个不含业务代码的探针项目（`index.html` + 四个 JS 模块 + 一份 CSS + 一个 95 字节 SVG + 一个 12 KB SVG + `public/robot.txt` + 一个**没人引用**的 `big2.svg`），用 `node ../../../node_modules/vite/bin/vite.js build` 跑了四次：默认、`--base`、`--sourcemap hidden`、`manualChunks`。本章的产物清单、文件名、体积数字、注入标签都是这四次跑出来的原文，实验目录收工前已删除。

**未在本机执行**：本站的 `vitepress build`（任务明令禁止）、`vite dev`、`vite preview`、任何写入 `.vitepress/` 或 `node_modules/` 的操作；`build.emptyOutDir`、`build.watch`、`build.lib` 未验证，只引用文档与类型定义里的声明。官方文档当前版本已改用 Rolldown 管线，与实装的 5.4.21（Rollup + esbuild）在压缩器与默认 `target` 上不同，见 [迁移与变更说明](https://cn.vite.dev/changes/)。

</Callout>

## 开发模式与生产构建的分工

| 维度 | `vite dev`（第 3 章） | `vite build`（本章） |
| --- | --- | --- |
| 谁驱动模块解析 | 浏览器：`import` 读到什么就发什么请求 | 打包器：从入口一次算完整张图 |
| TypeScript | 逐文件转译，**不检查类型** | 同样逐文件转译，**同样不检查类型** |
| HMR / 依赖预构建 | 有 HMR，失效沿 accept 边界冒泡；依赖预构建到缓存目录 | 都不存在：`import.meta.hot` 是 `undefined`，依赖与源码同等对待 |
| CSS 与静态资源 | 运行时注入 `style` 元素；按原路径 serve | 抽出 `.css` 并加 `link`；复制、哈希改名、按体积决定内联 |
| 环境变量 | 启动时读 `.env` | **构建时内联**进产物，改了必须重新构建 |

两行要单独强调。**TypeScript 两边都吃亏**：本站 `package.json` 里 `"build": "vitepress build"`、`"type-check": "vue-tsc --noEmit -p tsconfig.json"`——`build` 里没有类型检查，所以「构建退出码 0」从来不是「类型是对的」的证据。**环境变量决定部署形状**：`import.meta.env.VITE_*` 是构建期写死进 JS 的常量，要分环境就各构建一份（[环境变量与配置管理](/frontend-engineering/env-and-config)）。

## 第 6 步会在你的 HTML 里动手

流程是六步：定入口（默认根 `index.html`，多页面要显式列 `rollupOptions.input`）→ 逐个模块转换（与第 3 章同一套）→ 沿 `import` 走图生成 chunk（**动态 `import()` 是唯一的「在这里断开」标记**）→ 压缩 → 资源落地改名 → **把入口 chunk 与入口 CSS 的标签注入 `head`**。

最后一步的实测很具体：我源码里写的是 `<div id="app">loading</div>` 加一行 `<script type="module" src="/src/main.js">`，而 `dist/index.html` 的实际内容是（原文）：

```html
<head><meta charset="utf-8"><title>build probe</title>  <script type="module" crossorigin src="/assets/index-C6u2MJf9.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-gjcgwyLx.css">
</head>
<body>
<div id="app">loading</div>
</body>
```

三个能直接用的结论：**你写的 `/src/main.js` 已经不存在**，换成了带哈希的 chunk 路径；**script 被挪进 head** 并多出一个 `link rel=stylesheet`；**两个标签都带 `crossorigin`**，资源以 CORS 模式请求——它既是 DevTools 能读到跨域脚本错误的前提，也是「同一文件被下载两次」这类事故的入口（第 7 章）。

## 代码分割：动态 import() 是唯一你需要的语法

```js
// src/main.js（节选）：一个静态 import、一个动态 import
import { fmt } from "./shared.js";
document.getElementById("app").textContent = fmt();
window.onclick = () => import("./late.js").then((m) => m.default());
```

默认构建的报告（**原文输出**）：

```text
vite v5.4.21 building for production...
✓ 9 modules transformed.
dist/index.html                  0.30 kB │ gzip: 0.22 kB
dist/assets/big-BxiDkYkY.svg    12.12 kB │ gzip: 1.07 kB
dist/assets/index-gjcgwyLx.css   0.07 kB │ gzip: 0.09 kB
dist/assets/late-BsFw_cJB.js     0.09 kB │ gzip: 0.11 kB
dist/assets/index-C6u2MJf9.js    2.12 kB │ gzip: 1.14 kB
✓ built in 218ms
```

异步 chunk 的全部内容只有一行：

```js
import{f as t}from"./index-C6u2MJf9.js";function e(){return t()+"-late"}export{e as default};
```

这行回答了三个高频疑问。**`shared.js` 没有被复制两份**：它被折进入口 chunk（导出名压成 `f`），异步 chunk 反向引用入口——**共享模块归谁由 chunk 图决定，不是你决定**，这就是「加了懒加载首屏反而更大」的机制。**哈希是文件名的一部分**而不是查询串，内容改一个字符就换名。**`import()` 在产物里被包了一层**（实测 `y(()=>import("./late-Cn28i8V0.js"),[])`），这层就是 Vite 的 preload helper，负责在加载 chunk 前补上依赖的 `link rel=modulepreload` 与 CSS——它也是异步 chunk 在生产里会被缓存策略、CDN 传播、以及「用户挂着旧页面时你发了新版」影响的原因；官方文档提到 preload helper 失败时在 `window` 派发 `vite:preloadError`，可监听后做「提示刷新」兜底，本章没在真实部署里复现过。

框架里边界不用你自己想：路由级懒加载写的就是同一条语法（`component: () => import('@/pages/Detail.vue')`），阶段项目那条「三个页面各自对应独立 chunk、首屏不加载其他页面代码」的验收标准，判据也在产物里——`dist/assets/` 出现三个以页面命名的 JS，Network 首屏只请求入口 + 当前路由那一个。

**非要单独切 vendor**：我给 `main.js` 加了 `import { reactive } from 'vue'`，再写 `build.rollupOptions.output.manualChunks` 为 `{ vendor: ['vue'] }`，报告多出一行 `dist/assets/vendor-DaOaY34K.js  9.19 kB │ gzip: 3.56 kB`，模块数 9 → 14，**分包生效了**，chunk 名就是 `manualChunks` 的 key。收益只有一条：业务代码天天改、框架几个月不改，分开后改业务不会让 vendor 换名；代价是首屏多一个请求、chunk 间引用关系变复杂、手工策略容易和框架插件打架。**默认不配对多数个人项目是对的。**

## 静态资源的三种命运：内联、带哈希落地、原样复制

| 你写的 | 产物里变成（全部实测） | 依据 |
| --- | --- | --- |
| `src/small.svg`（95 B，JS 里 import） | 不落文件，**内联成 `data:` URI**（入口 JS 里 grep 到 `data:image/svg`） | `build.assetsInlineLimit`，5.4.21 类型定义 `@default 4096` |
| `src/big.svg`（12 KB，JS 与 CSS 都引用） | `dist/assets/big-BxiDkYkY.svg`，CSS 里改写成 `url(/assets/big-BxiDkYkY.svg)` | 超过阈值 → 落地 + 内容哈希 |
| `public/robot.txt` | `dist/robot.txt`，**名字一字不改、不带哈希** | `build.copyPublicDir` 默认 `true`，`public/` 只做复制 |
| `src/big2.svg`（没人引用） | **产物里没有这个文件** | 只有被 import 到的资源才进构建图 |

三条推论：**`public/` 是逃生舱不是资源目录**——里面的东西按字面路径引用、天生没哈希，因此**不具备长缓存资格**。**内联不免费**——省一次请求，但 base64 让体积涨约 33% 且**折进 JS**，大背景图被误内联就是「入口 JS 突然胖了」的来源之一。**没被引用的资源不进产物**——所以「图片在 `src/` 里线上却 404」基本是路径拼错，而**构建不会报错**。哈希改名在实测里直接可见：改一次配置 `index-C6u2MJf9.js` 就变成 `index-GSufLcYh.js`，它是第 7 章整套缓存策略的地基。

## base：子路径部署唯一的那个开关

产物里的引用是**绝对路径**，默认以站点根为起点，所以挂到 `/docs/` 下就全 404。开关只有一个：配置里写 `base: '/my-app/'`，实测 `head` 变成

```html
<script type="module" crossorigin src="/my-app/assets/index-Duh_yANT.js"></script>
<link rel="stylesheet" crossorigin href="/my-app/assets/index-Cc_A1da0.css">
```

`base` 同时影响 `import.meta.env.BASE_URL`（官方文档写明）。**它只改产物里的前缀，不改服务器**：服务器真挂在 `/docs/` 下 `base` 就必须写 `/docs/`；反过来服务器在根而 `base` 写了前缀，一样 404。

<Callout type="verified" title="Windows 命令行传 base 会被路径转换吃掉">

实测踩到：Git Bash 里跑 `vite build --base=/my-app/`，终端先打 `(!) "base" option should start with a slash.`，产物里的引用路径变成 `C:/Program Files/Git/my-app/assets/...`。**不是 Vite 的 bug**，是 MSYS 这类 POSIX 兼容层把「以 `/` 开头的参数」当本机绝对路径做了转换。确认方法：命令行传参与配置文件各写一次，比对 `dist/index.html`。修法：**`base` 写进配置文件**（`MSYS_NO_PATHCONV=1` 是 Git Bash 常见开关，我未逐一验证不同版本行为）。CI 的 Linux shell 没这现象——「本地坏、CI 好」的反向形状要认得出来。

</Callout>

## 产物体积分析：先读出数字，再决定优化什么

报告默认带 gzip 数字（`build.reportCompressedSize` 在 5.4.21 里 `@default true`）；跑 `--sourcemap hidden` 时多出一列，原文是 `dist/assets/late-BsFw_cJB.js  0.09 kB │ gzip: 0.11 kB │ map: 0.26 kB`，且实测 `.map` 存在、产物 JS 里 grep `sourceMappingURL` **命中 0 次**——浏览器不会自动下载它，但 map 本身仍不得公开可访问（默认 `sourcemap` 是 `false`）。不装第三方插件时的判断表：

| 数字特征 | 结论 | 动作与代价 |
| --- | --- | --- |
| 只有一个大 chunk，gzip 后就很大 | 没做代码分割，整棵依赖树进首屏 | 路由级 `import()`；代价是首次进其他路由多一次请求 |
| 入口里混着只在某页用的大依赖 | 分割边界不对，共享代码被归进入口 | 先清 import 链，再动态导入，最后才动 `manualChunks` |
| 某个依赖远超预期 | 全量引入（日期、图标、图表库） | 按需引入或换轻量替代 |
| 报告打 `(!) Some chunks are larger than 500 kB` | 报警器，`chunkSizeWarningLimit` 5.4.21 `@default 500`（kB） | 调高阈值让它闭嘴是最没用的修法；**它也不是性能预算** |

**把 gzip 数字记进 CI 日志并与上一次对比**，是唯一能发现体积回归的手段。`target` 在表之外影响体积：5.4.21 默认是特殊值 `'modules'`（类型定义原文：面向原生支持动态 es module import 的浏览器，附 [caniuse](https://caniuse.com/es6-module-dynamic-import)），官方文档当前版本默认 `'baseline-widely-available'`。**默认值随主版本变，别背数字**；`target` 越低语法降级越多、体积越大，压缩器名字同样会变（5.4.21 默认 `'esbuild'`，当前文档默认 `'oxc'`）。本章片段按实装的 5.4.21 写。

## 部署产物：服务器还要做对三件事

（本机无 Nginx 环境，以下**未在本机验证**，只给判据）**HTML 不能带长缓存**——它里面的文件名是唯一指向新版本的指针，哈希资源反而要往长了缓存（第 7 章）；**history fallback**——history 模式的 SPA 里 `/todos/12` 磁盘上不存在，服务器要重写成 `index.html`，表现是「点进去正常、刷新就 404」（[Vue Router](/vue/router)、[Nginx](/linux/nginx)）；**`Content-Type` 要对**——JS 被返回 `text/plain` 时浏览器拒绝执行模块。这三件事在 dev server 里**永远不会暴露**，第 9 章 [测试体系](/frontend-engineering/testing) 会回到这里。

## 常见错误与排查

1. **白屏 + `Failed to fetch dynamically imported module: /assets/xxx.js`** —— 异步 chunk 请求失败：滚动发布把新旧产物混掉、`base` 与实际路径不符、路径 404/403、CDN 还缓存着指向旧文件名的 HTML。确认：Network 看这条请求的状态码**和响应内容**。修：旧 chunk 保留一段时间、核对 `base`、HTML 改为不缓存。
2. **子路径部署样式图片 404、JS 却在** —— `base` 没设或方向反了。确认：`dist/index.html` 的前缀 vs 地址栏前缀。修：`base` 写进配置文件（Windows 传参见上面那个 Callout），并确认服务器确实在那个前缀下。**别指望本地双击 `dist/index.html` 来验证**——`file://` 下模块脚本本来就被拒（第 3 章那条边界在产物侧同样成立），那只会多加一条无关报错。
3. **JS 请求 200，控制台却说 `Refused to execute script because its MIME type ... is not executable`** —— history fallback 太宽，把缺失的 JS 重写成了 `index.html`。确认：看那个响应的**内容**而不只是状态码。修：fallback 只作用于非静态资源路径，`/assets/**` 命中不了就直接 404。
4. **`npm run build` 退出码 0，线上却出类型相关的错** —— 构建只转译（本站 `build` 脚本里没有 `vue-tsc --noEmit`，那是配置原文）。确认：单独跑一次类型检查。修：`"check": "npm run type-check && npm run build"` 交给 CI，见 [tsconfig 关键选项](/typescript/tsconfig)。
5. **dev 正常、build 报 `Rollup failed to resolve import`** —— 那个包只有 CJS 入口或 `exports` 没给构建条件（dev 侧预构建帮你转成 ESM，构建侧没有这一步）。修：显式指到 ESM 入口或换版本；这是第 1、2 章那个依赖问题在构建侧的回声。另有一条容易忽略的：`dist/` 攒残留文件，是因为只有 `outDir` 在项目根之内才自动清空（5.4.21 类型定义原文 `@default true when outDir is a sub directory of project root`）——**本站未验证任何清理脚本，删错目录比不清更危险**。

## 练习

<Exercise title="练习 1 · 读一次真实构建的产物清单" difficulty="基础">

在自己项目跑一次 `npm run build`（只看输出，不改配置）：① `dist/assets/` 下几个 `.js`、几个 `.css`？② 最大的那个叫什么，原始与 gzip 各多少？③ `dist/` 里有没有**不带哈希**的文件名，它们来自哪里？④ 抄下 `dist/index.html` 的 `head`，指出哪一个是第 6 章说的阻塞型资源。

<template #answer>

① 数字随项目变，但形状必须能解释：入口 JS 至少一个，其余每个 `import()` 边界一个；入口路由的 CSS 是独立文件，异步 chunk 的 CSS 被内联进它自己的 JS（依据是 5.4.21 类型定义对 `cssCodeSplit` 的原文注释）。② 最大 chunk 的名字应该能看出它是入口（默认名 `index`）还是你切的 vendor，gzip 那个数就是记进 CI 的基线。③ 不带哈希的几乎都来自 `public/`——它们因此**不具备长缓存资格**。④ `<link rel="stylesheet">` 阻塞渲染；`<script type="module">` 因 `type="module"` 天生 defer，不阻塞 HTML 解析，却挡住依赖它的执行。第 6 章把这两件事拆开讲。

</template>

</Exercise>

<Exercise title="练习 2 · 三种 base 与三种部署位置" difficulty="进阶">

产物是 `dist/index.html` + `dist/assets/*`。组合：A 服务器根目录 + `base: '/'`；B 服务器 `/docs/` 子目录 + `base: '/'`；C 服务器 `/docs/` + `base: '/docs/'`。先预测每种结果，再动手验证，说出你预测错在哪。

<template #answer>

A 正常。B **白屏**：HTML 写的是 `/assets/xxx.js`，浏览器请求服务器根，文件实际在 `/docs/assets/`。若你还配了宽泛的 history fallback，Network 里那个 JS 请求会**状态码 200、内容却是 HTML**，控制台是 `Refused to execute script because its MIME type ... is not executable`——这条比 404 更难认，**先认它**。C 正常。确认三步：① `dist/index.html` 的路径前缀；② 地址栏实际前缀；③ Network 里那个 JS 的**响应内容**而不只是状态码。第三步最常被跳过。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造一次构建期资源消失" difficulty="挑战">

做两个改动并解释结果：① 把一张 20 KB PNG 的引用从 `import` 改成字符串拼接（`'/img/' + name + '.png'`）；② 把 `build.assetsInlineLimit` 设为 `0` 再构建。① 产物有什么变化、线上会怎样？② 哪些文件的命运被改变，体积上怎么判断？

<template #answer>

① 拼出来的字符串不在模块图里，构建器不知道它存在，**产物里没有那张 PNG**（与实测中 `big2.svg` 没进 `dist/` 同一个原因）。线上是 404，而**构建不报错**——这类问题的特征恰恰是构建期毫无动静。修法：让路径可被静态分析，显式 import，或 `import.meta.glob` / `new URL(path, import.meta.url)`。② `assetsInlineLimit: 0` 关掉内联，原本折进 JS/CSS 的小资源全变成 `dist/assets/` 下带哈希的独立文件；判据是 JS 与 CSS 体积略降、**请求数上升**。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Vite 构建生产版本](https://cn.vite.dev/guide/build) —— 核实本章三件事：`base` 与 `import.meta.env.BASE_URL` 的关系、多页面要写 `rollupOptions.input`、异步 chunk 加载失败对应 `vite:preloadError`。
- [Vite 构建选项](https://cn.vite.dev/config/build-options) —— 核对 `assetsInlineLimit`/`cssCodeSplit`/`minify`/`target`/`sourcemap`/`chunkSizeWarningLimit` 的**当前默认值**。本章两套口径：本站实装 5.4.21（取自 `node_modules/vite/dist/node/index.d.ts` 的 JSDoc 原文）与官方文档当前版本（`minify` 默认 `'oxc'`、`target` 默认 `'baseline-widely-available'`、`rollupOptions` 已是 `rolldownOptions` 别名）。
- [静态资源处理](https://cn.vite.dev/guide/assets)、[共享选项](https://cn.vite.dev/config/shared-options) 与 [功能特性](https://cn.vite.dev/guide/features) —— 核实 `public/` 的复制规则、内联阈值、`import.meta.glob` 与 `new URL`，以及「TS 只转译不检查类型」在构建侧同样成立。改构建配置前先看 [迁移与变更说明](https://cn.vite.dev/changes/)。
- 站内衔接：[Vite 开发侧](/frontend-engineering/vite-dev)（预构建与转译结论）、[浏览器渲染机制与关键渲染路径](/frontend-engineering/rendering-pipeline)（`head` 里那两个标签为什么决定白屏时长）、[HTTP 缓存与资源加载策略](/frontend-engineering/http-caching)（内容哈希与长缓存）、[性能指标与 Core Web Vitals](/frontend-engineering/performance)（入口体积压在哪段指标上）、[测试体系](/frontend-engineering/testing)（端到端为什么必须跑在产物上）。

## 下一章

本章讲完「构建之后」：打包器一次算完整张图、动态 `import()` 是唯一必要的分割语法、资源按体积决定内联还是带哈希落地、`base` 是子路径部署唯一开关、体积结论必须来自构建报告的 gzip 数字。下一章换一类问题：[代码规范：ESLint 与 Prettier](/frontend-engineering/lint-and-format) —— 构建保证产物跑得出来，ESLint 保证半年后别人改这套配置时不写错。
