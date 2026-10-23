# 前端工程化 · 领域首页

<StatusBadge state="ready" note="12 章正文全部完成（第 12 章为阶段项目），可连续学习" />

## 这个领域解决什么问题

前端工程化不是一个「技术」，而是**一堆让代码能在别人机器上、在服务器上、在半年之后依然正确运行的约定和工具**。它最容易被人跳过，也最容易在跳过后以最恶心的方式还债。

具体的表现：

- **「在我机器上是好的。」** 同事拉下你的代码 `npm install` 之后跑不起来，因为你本地装的某个依赖版本和 `package.json` 里写的范围不一致。根因是你没有理解 `^` 的含义，也没有把锁文件提交进仓库。
- **`npm install` 之后项目突然崩了，而你什么都没改。** 因为 `package.json` 里写的是 `^1.2.3`，上游发了 `1.9.0` 带进了破坏性变更，你重装时被解析到了新版本。
- **`node_modules` 几百 MB，装一次要五分钟。** 每个项目各存一份完整的依赖树，而其中大部分内容是重复的。
- **改了一行代码，浏览器要等十秒才更新，有时候还得手动刷新。** 因为你不知道 Vite 的开发服务器和 HMR 是怎么工作的，也不知道为什么改某个文件会触发整页重载而不是热更新。
- **`npm run build` 之后首页白屏。** 部署到子路径下资源 404，因为 `base` 配置没设对；或者动态 `import()` 的分包在服务器上路径错了。
- **打包产物 2 MB，首屏加载要五秒。** 因为你把整个依赖树都打进了一个文件，没有做代码分割，图片也没压缩。
- **代码风格每天在 PR 里吵架**：单引号还是双引号、缩进两格还是四格、行尾分号。这些争论本可以在保存时自动结束。
- **ESLint 和 Prettier 互相打架**：ESLint 报「这里格式不对」，Prettier 一保存又改回去。因为你不知道两者的职责边界，把格式规则写进了 ESLint。
- **环境变量泄露。** 把数据库密码写进了 `VITE_` 前缀的变量里，然后它被打进了前端产物，任何人打开 DevTools 就能看到。
- **重构之后不敢上线，因为没有任何测试。** 或者写了一堆测试，但测的是「函数返回了我硬编码的那个值」，改一行实现就全红，最后大家学会直接删测试。
- **不知道页面为什么慢。** 只会说「优化一下」，但说不出瓶颈在关键渲染路径的哪一段，也不知道自己该看哪个指标。

这些问题的共同点是：**它们都不在你的业务代码里，而在业务代码周围的那一圈基础设施里。** 而这一圈一旦出问题，排查成本极高，因为你往往不知道该看哪里。

本领域要教的就是把这一圈讲清楚：依赖是怎么被解析和锁定的、代码是怎么从源文件变成浏览器能跑的产物的、浏览器拿到产物之后是怎么把它画到屏幕上的、以及你怎么验证这一切是对的。

## 关于本领域的学习方式：它是穿插进行的

**这一点必须放在最前面说，否则你会用错方法学它。**

前端工程化**不是学习路线里独立的一段时间**。你不会「先花两周学完工程化，再开始学 Vue」。它的正确学法是：

- 学 [HTML](/html/) 时你不需要任何工程化知识，一个 `.html` 文件双击打开就行。
- 学 [CSS](/css/) 时也不需要。
- 开始学 [JavaScript](/javascript/) 时，你会第一次遇到 ES Modules 和 `type="module"`，这是第 3 章的入口。
- 开始学 [TypeScript](/typescript/) 时，你需要建第一个真实项目，这时读**第 1、2 章**（包管理与锁文件）和**第 5 章**（ESLint 与 Prettier）。
- 开始学 [Vue 3](/vue/) 时，`npm create vue@latest` 会替你生成一份完整的工程配置，这时读**第 3、4 章**（Vite 开发与构建）和**第 10 章**（环境变量）。
- Vue 项目做出来、准备部署时，读**第 6、7、8 章**（浏览器渲染、HTTP 缓存、性能）和**第 11 章**（静态部署相关部分）。
- 项目有一定规模、开始担心改坏了没人发现时，读**第 9 章**（测试体系）。
- 当你同时维护前端和后端两个仓库、发现共享类型定义很痛苦时，读**第 11 章**（Monorepo）。

所以本领域的章节目录下面的「学习顺序建议」给的是**推荐的首次阅读顺序**，而不是「必须一口气学完」的顺序。每章开头会标注「建议在读完本站哪个领域之后再读」。

## 前置知识

**[HTML](/html/)、[CSS](/css/)、[TypeScript](/typescript/)。**

- **HTML** —— 第 6 章（浏览器渲染机制与关键渲染路径）讲的就是浏览器拿到 HTML 之后做了什么。你需要理解文档树、`<script>` 的位置与 `defer` / `async` 的区别、以及阻塞渲染的概念。这些内容在 HTML 第 1、2 章。
- **CSS** —— 关键渲染路径里 CSS 是渲染阻塞资源。你需要理解层叠与值计算的过程（CSS 第 1 章），才能理解浏览器为什么必须等 CSS 到位才能绘制。
- **TypeScript** —— 第 1、2 章讲 `package.json` 与依赖，需要一个真实的 TS 项目作为练习对象；第 5 章讲 ESLint 与 typescript-eslint 的配合，前提是你能读懂 TS 的报错。

**JavaScript 领域的 [Modules 章节](https://javascript.info/modules) 是硬前置。** ES Modules 是 Vite 开发服务器的整个基础——Vite 之所以能做到不打包就启动开发服务器，靠的就是浏览器原生支持 ESM。不理解 `import` / `export`，第 3 章读不下去。

不需要先学 Vue 或后端。但本领域的价值在你有一个真实项目之后才会显现——**不要在没有项目的情况下通读本领域**，那会变成背配置项。

## 章节目录

| 章节 | 内容 | 学完能做什么 |
| --- | --- | --- |
| [1. 包管理：npm 与 pnpm](/frontend-engineering/package-managers) | `package.json` 的字段含义、`dependencies` / `devDependencies` 的区别、`node_modules` 的结构与解析规则、npm 与 pnpm 的依赖布局差异、常用命令与 `scripts` | 从零建一个项目，能解释每个依赖为什么在 `dependencies` 而不是 `devDependencies` |
| [2. 语义化版本与锁文件](/frontend-engineering/semver-and-lockfile) | semver 的三段含义、`^` 与 `~` 与精确版本的区别、锁文件的作用与为什么必须提交、`npm install` 与 `npm ci` 的差异、依赖冲突怎么产生、如何排查「本地好的线上坏了」 | 让项目在任何人机器上、任何时间点安装出完全相同的依赖树 |
| [3. Vite 开发侧](/frontend-engineering/vite-dev) | 为什么 Vite 能不打包就启动、浏览器原生 ESM 与开发服务器的关系、依赖预构建做了什么、HMR 的原理与失效场景、模块图、源码转换 | 开发时遇到「改了没生效」能定位到原因，而不是无脑重启 |
| [4. Vite 构建侧](/frontend-engineering/vite-build) | 生产构建与开发模式的根本差异、打包与代码分割、入口与动态 `import()`、静态资源的处理与哈希命名、`base` 配置、产物体积分析与优化 | `npm run build` 出可部署的产物，并解释每个文件是怎么来的 |
| [5. 代码规范：ESLint 与 Prettier](/frontend-engineering/lint-and-format) | 两者的职责边界（质量 vs 格式）、ESLint 扁平配置、规则与插件、typescript-eslint 与 eslint-plugin-vue 的接入、编辑器集成与保存时格式化、如何用 CLI 一次性修复 | 让格式争论从代码评审里彻底消失，且 ESLint 只管真问题 |
| [6. 浏览器渲染机制与关键渲染路径](/frontend-engineering/rendering-pipeline) | 从字节到像素的全过程：解析 HTML 构建 DOM、解析 CSS 构建 CSSOM、合成渲染树、布局、绘制、合成；渲染阻塞资源；`defer` / `async` 的差异；重排与重绘 | 解释「为什么页面白屏了两秒」，并指出该动哪一类资源 |
| [7. HTTP 缓存与资源加载策略](/frontend-engineering/http-caching) | 强缓存与协商缓存、`Cache-Control` / `ETag` / `Last-Modified` / `304`、带哈希的文件名与长缓存的配合、`preload` / `preconnect` 等资源提示、懒加载、压缩传输 | 让二次访问几乎不产生请求，同时保证发版后用户拿到新代码 |
| [8. 性能优化与 Core Web Vitals](/frontend-engineering/performance) | 三个核心指标各自衡量什么、如何用 Performance API 在浏览器里测量、首屏与交互的瓶颈定位、优化手段的优先级排序、哪些「优化」其实无效 | 拿到一个慢页面能有章法地定位瓶颈，而不是凭感觉加懒加载 |
| [9. 测试体系：Vitest / Vue Test Utils / Playwright](/frontend-engineering/testing) | 测试金字塔与实际取舍、Vitest 与 Vite 共用配置、单元测试测什么不测什么、Vue Test Utils 挂载与断言、Playwright 端到端测试的定位器策略与稳定性、测试该覆盖到什么程度 | 建立一套改了代码敢上线的最低限度测试，且不会因为脆弱而被人删掉 |
| [10. 环境变量与配置管理](/frontend-engineering/env-and-config) | `.env` 文件的加载规则与优先级、Vite 的变量暴露机制与前缀约定、为什么前端环境变量不是秘密、多环境（开发/预发/生产）的组织方式、配置的集中管理 | 正确处理多环境配置，且不把任何密钥写进前端产物 |
| [11. Monorepo 与工作区](/frontend-engineering/monorepo) | 什么时候需要 Monorepo、workspace 协议与本地包链接、依赖提升与版本统一、任务编排与缓存的概念、Turborepo 与 pnpm workspace 的定位差异、代价与替代方案 | 判断自己的项目该不该上 Monorepo，而不是因为「大厂都这么做」 |
| [12. 阶段项目](/frontend-engineering/project) | 给 Vue 领域的阶段项目做一次完整的工程化体检与加固 | 把前 11 章落到一个真实项目上，产出可验证的结果 |

## 学习顺序建议

前面「关于本领域的学习方式」一节已经给出了穿插的时间点，这里补充**章节之间的内部依赖**：

- **第 1 → 2 章必须连着读。** 不理解 `node_modules` 的解析规则，就理解不了锁文件在锁什么；不理解 semver 的范围语义，就理解不了为什么会有「本地好的线上坏了」。
- **第 3 → 4 章必须连着读。** 开发模式与生产模式是两套完全不同的处理流程，很多人只理解前者，结果 `build` 之后出的问题完全无从下手。
- **第 5 章可以独立读**，但建议在第 1、2 章之后——因为配置 ESLint 本身就要装一堆依赖，你会立刻用到版本范围的知识。
- **第 6 → 7 → 8 章是一条链。** 第 6 章讲浏览器怎么把资源变成像素，第 7 章讲资源怎么被缓存和加载，第 8 章讲怎么衡量和优化前两章的结果。跳过第 6 章直接学第 8 章，性能优化会退化成「照着清单加属性」。
- **第 9 章（测试）建议在你已经有一个跑起来的 Vue 项目之后再读。** 在空项目里学测试没有意义，你需要有真实的、值得测的代码。
- **第 10 章很短，可以在第 4 章之后任意时间插入。**
- **第 11 章（Monorepo）放在最后，而且本站的第一期项目可能根本不需要它。** 单仓库 + 前后端分目录对个人项目通常足够。这一章会明确告诉你「什么时候不该上 Monorepo」。

**不能跳过的章节：第 2 章（锁文件）和第 10 章（环境变量）。** 前者决定你的项目能不能被别人（包括三个月后的你自己）复现，后者决定你会不会把密钥泄露到公网上。这两章的知识点少，但出问题的代价最高。

## 学习方法

- **一定要有一个真实项目作为练习对象。** 本领域的每一章都应该在你 [Vue 3 领域的阶段项目](/vue/)上动手验证。在空目录里读配置文档，读完就忘。
- **看产物，不要只看配置。** 第 4 章之后，每次 `npm run build` 都去 `dist/` 目录里翻一遍：有几个 JS 文件、各自多大、文件名里的哈希是什么、CSS 被抽出来了吗、图片去哪了。**理解产物的结构比背配置项有用得多。**
- **用 DevTools 的 Network 面板验证缓存。** 第 7 章的每一条结论都应该在 Network 面板里看到对应证据：状态码是 200 还是 304、`Cache-Control` 的实际值、哪些请求走了内存缓存。刷新按钮旁边那个「清空缓存并硬性重新加载」是本领域的常用工具。
- **用 Performance 面板录制一次真实的页面加载。** 第 6、8 章不要只读文字。录一段，看火焰图里 HTML 解析、CSS 计算、Layout、Paint 各占多少时间，看长任务（long task）出现在哪里。这个面板看熟之后，你对「性能」的理解会从玄学变成工程。
- **改配置之前先备份，改一次只改一项。** 工程化配置的相互作用非常复杂，一次改三项出了问题你不知道是哪项造成的。
- **遇到诡异问题，先删 `node_modules` 和锁文件重装，再排查。** 这不是解决问题，但能快速区分「配置错了」和「依赖树脏了」。真正解决要靠读第 1、2 章。
- **读工具的官方文档，不要读二手教程。** 工程化领域的工具版本迭代极快，一年前的博客文章里的配置很可能已经失效（尤其 ESLint 的配置格式变更过）。

## 阶段项目

**工程化体检**：对 [Vue 3 领域的阶段项目](/vue/)（多页面待办应用）做一次完整的加固。这个项目的产出不是一个新功能，而是一份「这个项目现在可以放心部署和继续开发」的证据。

依赖与版本（第 1、2 章）：

- `package.json` 中每个依赖的位置正确：只有运行时真正需要的在 `dependencies`，构建工具、测试框架、类型定义包在 `devDependencies`。
- 锁文件已提交。删掉 `node_modules` 后用 `npm ci`（或 pnpm 的等价命令）从零安装，项目能直接跑起来。
- 你能解释 `package.json` 里每一个 `^` 和 `~` 分别允许升级到哪个范围。

构建与部署（第 3、4 章）：

- `npm run build` 零错误零警告。
- 产物做了路由级代码分割：三个页面各自对应独立的 chunk，首屏不加载其他页面的代码。用 Network 面板验证。
- 所有静态资源文件名带内容哈希。
- `base` 配置正确，把 `dist/` 部署到子路径下也能正常访问。
- 记录产物总体积，并列出体积最大的三个依赖及你的处理决定（保留 / 替换 / 按需引入）。

规范（第 5 章）：

- ESLint 与 Prettier 都已配置且不打架，保存时自动格式化。
- 接入了 typescript-eslint 与 eslint-plugin-vue。
- `npm run lint` 在项目当前状态下零报错。

缓存与性能（第 6、7、8 章）：

- 用 Network 面板截图记录：首次访问的请求列表，与刷新之后的请求列表。二次访问应大量命中缓存。
- HTML 文档本身**不能**用长缓存（否则发版后用户拿不到新的资源引用），带哈希的资源文件应该用长缓存。你需要说明自己的缓存策略并验证它成立。
- 用 Performance 面板录制一次首屏加载，找出最长的一个长任务并说明它是什么。
- 用 Performance API 在代码里读出 LCP 和 CLS 的实际数值（不是靠感觉），记录下来。

测试（第 9 章）：

- 至少 8 个 Vitest 单元测试，覆盖 composables 里的纯逻辑（例如筛选、排序、日期计算），不测模板渲染细节。
- 至少 2 个 Vue Test Utils 组件测试，验证一个组件在给定 props 下的渲染结果和一次用户交互。
- 至少 3 个 Playwright 端到端测试：新增一条待办、筛选状态与 URL 同步、访问不存在的详情页看到 404。
- 所有测试能在 `npm run test` 一条命令下跑完并通过。

配置与安全（第 10 章）：

- 至少区分开发与生产两套环境变量，通过 `.env` 文件管理。
- 前端产物中不包含任何密钥、令牌或数据库连接信息。构建完成后用文本搜索在 `dist/` 里验证一次。
- `.env` 的本地覆盖文件已加入 `.gitignore`。

验收标准：

- 把整个仓库交给另一个人（或者你自己在另一台机器上），只按 README 的说明操作，能装起来、跑起来、构建出来、测试全绿。这是「工程化做对了」的唯一硬标准。
- 上面每一项都有可验证的证据（命令输出、Network 截图、Performance 记录），不是「我觉得配好了」。

## 官方文档与延伸阅读

本领域的工具版本迭代快，**请只读官方文档**。二手教程里的配置格式很可能已经过期。

**包管理与版本**

- [npm 官方文档 · package.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-json) —— 第 1 章核心参考，逐字段说明。
- [npm 官方文档 · package-lock.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json) 与 [npm-shrinkwrap.json](https://docs.npmjs.com/cli/v10/configuring-npm/npm-shrinkwrap-json) —— 第 2 章核心参考。
- [npm 官方文档 · 关于语义化版本](https://docs.npmjs.com/about-semantic-versioning) —— 第 2 章必读，讲清了版本范围的实际行为。
- [Semantic Versioning 规范（中文版）](https://semver.org/lang/zh-CN/) 与 [英文原版](https://semver.org/) —— semver 的权威定义。
- [npm 官方文档 · `npm install`](https://docs.npmjs.com/cli/v10/commands/npm-install)、[`npm ci`](https://docs.npmjs.com/cli/v10/commands/npm-ci)、[scripts](https://docs.npmjs.com/cli/v10/using-npm/scripts)、[文件夹结构](https://docs.npmjs.com/cli/v10/configuring-npm/folders) —— 第 1、2 章参考。
- [npm 包管理器入门（Node.js 官方）](https://nodejs.org/en/learn/getting-started/an-introduction-to-the-npm-package-manager) —— 如果你觉得 npm 官方文档太啰嗦，先看这个。
- [Node.js 官方文档 · Packages](https://nodejs.org/api/packages.html) 与 [Modules](https://nodejs.org/api/modules.html) —— 模块解析规则的权威说明，排查「找不到模块」时必看。
- [pnpm 官方文档（中文）](https://pnpm.io/zh/)、[安装](https://pnpm.io/zh/installation)、[`pnpm install`](https://pnpm.io/zh/cli/install)、[非扁平的 node_modules 结构](https://pnpm.io/zh/symlinked-node-modules-structure)、[工作区](https://pnpm.io/zh/workspaces)、[Catalogs](https://pnpm.io/zh/catalogs) —— 第 1、2、11 章核心参考。pnpm 的依赖布局与 npm 差异很大，那一篇「node_modules 结构」值得读两遍。

**Vite**

- [Vite 官方文档（中文）](https://cn.vite.dev/guide/) 与 [为什么选 Vite](https://cn.vite.dev/guide/#why-vite) —— 第 3、4 章的总入口。[英文版](https://vite.dev/guide/) 作为对照。
- [功能特性](https://cn.vite.dev/guide/features) —— 讲 NPM 依赖解析、TypeScript、静态资源、Glob 导入等，第 3、4 章核心参考。
- [依赖预构建](https://cn.vite.dev/guide/dep-pre-bundling) —— 第 3 章必读，解释「为什么第一次启动慢」。
- [HMR API](https://cn.vite.dev/guide/api-hmr) —— 第 3 章核心参考。
- [构建生产版本](https://cn.vite.dev/guide/build) —— 第 4 章核心参考，含公共基础路径与多页面应用。
- [静态资源处理](https://cn.vite.dev/guide/assets) —— 第 4 章核心参考。
- [共享选项](https://cn.vite.dev/config/shared-options) 与 [构建选项](https://cn.vite.dev/config/build-options) —— 配置项的完整参考。
- [环境变量与模式](https://cn.vite.dev/guide/env-and-mode) —— **第 10 章核心参考，必读**，讲清了哪些变量会被暴露到客户端。
- [性能](https://cn.vite.dev/guide/performance)、[使用插件](https://cn.vite.dev/guide/using-plugins)、[插件 API](https://cn.vite.dev/guide/api-plugin)、[与其他工具的比较](https://cn.vite.dev/guide/comparisons)、[静态部署](https://cn.vite.dev/guide/static-deploy)、[与后端集成](https://cn.vite.dev/guide/backend-integration)、[SSR](https://cn.vite.dev/guide/ssr)、[疑难解答](https://cn.vite.dev/guide/troubleshooting)、[迁移与变更说明](https://cn.vite.dev/changes/) —— 按需查阅。

**代码规范**

- [ESLint 官方文档 · 入门](https://eslint.org/docs/latest/use/getting-started) 与 [核心概念](https://eslint.org/docs/latest/use/core-concepts/) —— 第 5 章入口。
- [ESLint 配置总览](https://eslint.org/docs/latest/use/configure/)、[配置文件](https://eslint.org/docs/latest/use/configure/configuration-files)、[组合配置](https://eslint.org/docs/latest/use/configure/combine-configs) —— 第 5 章核心参考。ESLint 现在使用扁平配置（flat config），旧的 `.eslintrc` 格式已不再推荐。
- [ESLint 规则列表](https://eslint.org/docs/latest/rules/) —— 查具体规则的含义与选项。
- [typescript-eslint](https://typescript-eslint.io/) 与 [共享配置](https://typescript-eslint.io/users/configs/) —— 第 5 章必读，TS 项目接入 ESLint 的标准方式。
- [eslint-plugin-vue](https://eslint.vuejs.org/) —— Vue 项目的规则集。
- [Prettier 官方文档](https://prettier.io/docs/) 与 [配置选项](https://prettier.io/docs/options) —— 第 5 章核心参考。注意 Prettier 只管格式，不管代码质量。
- [ESLint Stylistic](https://eslint.style/) —— 把格式类规则从 ESLint 核心迁出后的维护项目，理解 ESLint 与 Prettier 分工时的背景材料。

**浏览器渲染与网络**

- [MDN · 浏览器如何工作](https://developer.mozilla.org/zh-CN/docs/Web/Performance/How_browsers_work) —— **第 6 章核心参考**，从 URL 到像素的全过程。
- [MDN · 关键渲染路径](https://developer.mozilla.org/zh-CN/docs/Web/Performance/Critical_rendering_path) —— 第 6 章核心参考。
- [MDN · Web 性能优化总览](https://developer.mozilla.org/zh-CN/docs/Web/Performance) —— 第 6、8 章的入口，下面挂着大量专题页。
- [MDN · `<script>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Element/script) —— `defer` 与 `async` 的权威说明。
- [MDN · 懒加载](https://developer.mozilla.org/zh-CN/docs/Web/Performance/Lazy_loading) —— 第 7、8 章参考。
- [MDN · HTTP 概述](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Overview) —— 第 7 章的前置。
- [MDN · HTTP 缓存](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Caching) 与 [HTTP 缓存（参考页）](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Caching) —— **第 7 章核心参考。**
- [MDN · `Cache-Control`](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Cache-Control)、[`ETag`](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/ETag)、[`Last-Modified`](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Last-Modified)、[`If-None-Match`](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/If-None-Match)、[`304 Not Modified`](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status/304)、[条件请求](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Conditional_requests) —— 第 7 章逐个查证用。
- [MDN · HTTP/1.1 的连接管理](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Connection_management_in_HTTP_1.x) 与 [压缩](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Compression) —— 第 7 章参考。
- [MDN · `rel="preload"`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Attributes/rel/preload) 与 [`rel="preconnect"`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Attributes/rel/preconnect) —— 资源提示，第 7 章参考。用之前先想清楚，用错了会拖慢首屏。
- [MDN · MIME 类型](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Basics_of_HTTP/MIME_types) —— 部署后资源加载失败时，先查服务器返回的 `Content-Type`。
- [MDN · Performance API](https://developer.mozilla.org/zh-CN/docs/Web/API/Performance_API)、[`PerformanceObserver`](https://developer.mozilla.org/zh-CN/docs/Web/API/PerformanceObserver)、[`Performance.now()`](https://developer.mozilla.org/zh-CN/docs/Web/API/Performance/now)、[`PerformanceNavigationTiming`](https://developer.mozilla.org/zh-CN/docs/Web/API/PerformanceNavigationTiming)、[`PerformanceResourceTiming`](https://developer.mozilla.org/zh-CN/docs/Web/API/PerformanceResourceTiming)、[`PerformancePaintTiming`](https://developer.mozilla.org/zh-CN/docs/Web/API/PerformancePaintTiming)、[`LargestContentfulPaint`](https://developer.mozilla.org/zh-CN/docs/Web/API/LargestContentfulPaint) —— **第 8 章核心参考**，在浏览器里测量性能指标的全部接口。
- [MDN · JavaScript 模块指南](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Modules) —— 第 3 章的前置，讲浏览器原生 ESM 的行为。

**测试**

- [Vitest 官方文档 · 为什么选 Vitest](https://vitest.dev/guide/why)、[入门](https://vitest.dev/guide/)、[功能特性](https://vitest.dev/guide/features)、[API 参考](https://vitest.dev/api/) —— 第 9 章核心参考。Vitest 与 Vite 共用配置和转换管线，这是它在本技术栈里的主要优势。
- [Vue Test Utils 官方文档](https://test-utils.vuejs.org/guide/)（[入口](https://test-utils.vuejs.org/)） —— 第 9 章核心参考，Vue 组件的单元测试。
- [Playwright 官方文档 · 入门](https://playwright.dev/docs/intro)、[定位器](https://playwright.dev/docs/locators)、[组件测试](https://playwright.dev/docs/test-components)、[Trace Viewer](https://playwright.dev/docs/trace-viewer-intro) —— 第 9 章核心参考。**定位器那一页是端到端测试稳定性的关键**，用错定位器策略会让测试天天随机失败。

**Monorepo**

- [pnpm 工作区](https://pnpm.io/zh/workspaces) 与 [Catalogs](https://pnpm.io/zh/catalogs) —— 第 11 章核心参考，个人项目最轻量的 Monorepo 方案。
- [Turborepo 文档](https://turbo.build/repo/docs) —— 第 11 章参考，任务编排与缓存。对个人项目通常过重，读它是为了理解「大型 Monorepo 在解决什么问题」。

## 版本说明

本领域内容的时效性风险是全站最高的，因为涉及的每一个工具都在快速迭代。核实时间为 2026 年 10 月。

按章节区分：

- **第 1、2 章（包管理与 semver）相对稳定。** semver 是规范，不会变；npm / pnpm 的核心概念（依赖类型、锁文件、模块解析）多年未变。但 npm CLI 的具体参数、pnpm 的默认行为会随主版本调整。
- **第 3、4 章（Vite）风险较高。** Vite 的主版本更替会调整默认配置、依赖预构建策略和构建行为，部分选项会重命名或移除。**动手前先看 [Vite 的迁移与变更说明](https://cn.vite.dev/changes/)**，确认你安装的版本与本站写作时的版本差异。
- **第 5 章（ESLint 与 Prettier）风险高。** ESLint 从 `.eslintrc` 系列格式切换到扁平配置（flat config）是一次不兼容的大变更，网上大量教程仍在用旧格式，照抄会直接报错。**判断一篇教程是否过期的最快方法：看它配置的文件名是 `eslint.config.js` 还是 `.eslintrc.*`。** Prettier 相对稳定。
- **第 6、7 章（浏览器渲染与 HTTP 缓存）风险低。** 关键渲染路径的模型多年未变，HTTP 缓存的语义由协议规定。变化的部分是协议版本（HTTP/2、HTTP/3 对连接管理和资源加载策略的影响），本站会标注哪些结论只在 HTTP/1.1 下成立。
- **第 8 章（性能与 Core Web Vitals）风险最高。** Core Web Vitals 是 Google 定义的一组以真实用户数据衡量页面体验的指标，**指标集合本身被替换过，阈值也会调整**。本站会讲「怎么在浏览器里用 Performance API 测出这些数值」，这部分依赖的是稳定的浏览器接口；但「多少算好」的判断标准请以你能访问到的 Google 官方当前定义为准，不要背本站写作时的数字。
- **第 9 章（测试）中等风险。** Vitest 与 Playwright 的 API 在主版本间有调整，Playwright 的定位器 API 尤其经历过演进。以官方文档当前版本为准。
- **第 10、11 章（环境变量与 Monorepo）中等风险。** 环境变量的加载规则跟随 Vite 版本；Monorepo 工具生态变化很快，本站只讲概念和取舍，具体工具配置请查各自文档。

**通用建议**：本领域的每一章都应该以「你当前实际安装的版本」为准来验证。凡是本站给出的配置片段，先在自己的项目里跑一遍确认有效，再写进仓库。
