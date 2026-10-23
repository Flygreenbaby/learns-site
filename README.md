# 全栈学习手册（learns）

面向**个人自学**的中文编程学习网站。VitePress 静态站点：无后端、无数据库、无用户系统、
无登录、不埋点、不记录学习进度。全部内容是仓库里的 Markdown 文件，构建后是一堆静态 HTML。

- 仓库：<https://github.com/Flygreenbaby/learns-site>（公开，默认分支 `main`）
- 许可：代码 MIT（[LICENSE](LICENSE)）+ 原创课程内容 CC BY 4.0（[CONTENT-LICENSE.md](CONTENT-LICENSE.md)），
  允许转载、修改、二次发布与商业使用，条件是署名、给出许可链接、说明修改情况（见第十四节）。
- 参与：报问题走 [Issues](https://github.com/Flygreenbaby/learns-site/issues)，
  改内容走 Fork + Pull Request，见 [CONTRIBUTING.md](CONTRIBUTING.md)（见第十五节）。

本文件说明「这个项目是什么、怎么在本地跑起来、怎么部署、边界在哪里」。
服务器部署（环境、构建、本机验证、局域网、Nginx、静态托管平台、更新与回滚）的完整步骤在
[`docs/deployment.md`](docs/deployment.md)；每一类文件的作用与命运（保留什么、不发布什么、
能不能删、打包时怎么取舍）在 [`docs/project-file-inventory.md`](docs/project-file-inventory.md)。

## 导读：我想做什么，该看哪一节

| 我想… | 看这里 |
| --- | --- |
| 了解这是什么、覆盖哪些领域 | 本文第一、二节 |
| 在本地跑起来（安装 / dev / build / preview） | 本文第五、六节 |
| **不想装 Node**，直接拿构建产物部署 | 本文第七节「取得构建产物」+ 第十六节 |
| 部署到 Linux VPS / Nginx / 免费静态托管平台 | [`docs/deployment.md`](docs/deployment.md) |
| 判断某个文件能不能删、两种交付包各装什么 | [`docs/project-file-inventory.md`](docs/project-file-inventory.md) |
| 报错、改内容、提 Issue / PR | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 能不能转载、能不能商用 | 本文第十四节 + [CONTENT-LICENSE.md](CONTENT-LICENSE.md) |
| 看 CI 怎么构建、怎么出版本 | 本文第十六节 |

> **命令状态标注口径**：本项目对「已验证」与「未验证」区分得很严，读命令时请注意三类标注——
>
> - **[已实测]**：在当前文件状态上真跑过，并写明结果（时间、退出码、产物数量）。
> - **[CI 已验证]**：由 GitHub Actions 在干净环境（ubuntu-latest + Node 22）里跑通，
>   证据是工作流运行记录本身，不是本机输出。
> - **[理论步骤 / 未实测]**：没有真跑过，或只在更早的文件状态上跑过。
>   **任何远程部署**（Nginx、VPS、Docker、静态托管平台）、**浏览器人工点击验收**、
>   **外部链接可达性**都属于这一类，不要当成已验证结果。
>
> 逐条命令的完整验证台账在 [`docs/deployment.md`](docs/deployment.md) 第 0 节与第 14 节。

---

## 一、用途与定位

- 解决什么问题：把「从零学到能上线、能运维、能长久维护」的路线拆成 17 个领域，
  每个领域给出学习顺序、要解决的真实问题、章节正文、练习与阶段项目。
- 给谁用：中文自学者。主要在本地或局域网阅读，也可以自行部署成网站；
  没有账号体系，不追踪任何学习行为。
- 不是什么：不是文档站点的聚合器，不做转载；外部规范与官方文档以链接形式引用。
- 同时也是一个公开仓库：欢迎通过 Issues 与 Pull Request 参与纠错和补充，
  贡献者**不需要**本仓库的写权限（见第十五节）。

## 二、课程范围与组织方式

组织单位是**领域（domain）**，一个领域一个顶层目录，URL 前缀即目录名（`/html/`、`/backend/`）。
下表按分组列出全部 17 个领域，链接直达仓库目录（站点内的对应入口是 `/<目录名>/`）：

**前端（7）**

| 领域 | 简称 | 一句话定位 |
| --- | --- | --- |
| [JavaScript](javascript/) | JavaScript | javascript.info 主线入口 + 中文知识地图、语言层易错点、DOM 与网络、阶段项目与 TypeScript 衔接 |
| [HTML](html/) | HTML | 文档结构、语义化标签、链接与多媒体、表单与校验、表格、文档大纲与 HTML 层面的无障碍 |
| [CSS](css/) | CSS | 层叠与选择器、盒模型、Flexbox 与 Grid 布局、响应式设计、动效，以及布局调试方法 |
| [TypeScript](typescript/) | TypeScript | 类型系统基础、联合与收窄、泛型、工具类型、类型推断与声明文件，以及真实项目中的取舍 |
| [Vue 3](vue/) | Vue 3 | 响应式原理、模板与组合式 API、组件设计与通信、Vue Router、Pinia 状态管理与渲染性能 |
| [React](react/) | React | 以「Vue → React 概念对照」的方式学习：JSX、Hooks、状态与副作用、重渲染机制、生态选型 |
| [前端工程化](frontend-engineering/) | 前端工程化 | npm 与依赖管理、Vite 与构建、代码规范、测试体系（Vitest / Playwright）、浏览器与网络机制、性能优化 |

**后端与数据（4）**

| 领域 | 简称 | 一句话定位 |
| --- | --- | --- |
| [后端开发（Node.js + Fastify）](backend/) | 后端开发 | Node.js 运行时、HTTP 与 REST 原理、Fastify、分层架构、认证授权、安全、日志与错误处理 |
| [数据库（SQL / PostgreSQL）](database/) | 数据库 | 关系模型、SQL 查询、数据建模、索引与执行计划、事务与隔离级别、迁移、备份恢复，PostgreSQL 主线 + MySQL 对照 |
| [数据存储进阶](data-storage/) | 数据存储进阶 | Redis 与缓存策略、缓存一致性与三大问题、分布式锁与限流、Prisma 与 Drizzle 对照、连接池与慢查询 |
| [消息队列与云服务](message-queue-cloud/) | 消息队列与云服务 | 异步解耦、RabbitMQ / Redis Stream / Kafka 对照、可靠投递与幂等、死信队列，以及对象存储、CDN、短信邮件与 Serverless |

**系统与工程（3）**

| 领域 | 简称 | 一句话定位 |
| --- | --- | --- |
| [Linux](linux/) | Linux | 命令行与文本处理、用户与权限、进程与 systemd、网络与防火墙、Shell 脚本、Nginx、服务器安全与故障定位 |
| [工程工具与部署](devops/) | 工程工具与部署 | Git 与 GitHub 协作、代码规范、CI/CD 与 GitHub Actions、Docker 与 Compose、VPS + Nginx + HTTPS 部署与回滚 |
| [计算机基础](computer-science/) | 计算机基础 | 数据结构与复杂度、常见算法思路、计算机网络（DNS / TCP / TLS / HTTP）、操作系统（进程线程 / IO 模型）、软件架构取舍 |

**专题方向（3）**

| 领域 | 简称 | 一句话定位 |
| --- | --- | --- |
| [实时通信](realtime/) | 实时通信 | WebSocket 协议与握手、SSE、心跳与断线重连、Nginx 代理配置、房间与广播、Node 侧实现对照 |
| [AI 应用开发](ai-apps/) | AI 应用开发 | LLM API 集成、Prompt 工程、流式响应与前端渲染、上下文与 token 成本、RAG 全链路、Function Calling 与 Agent 编排 |
| [移动端开发](mobile/) | 移动端开发 | 微信小程序（与 Vue 3 心智对照）、uni-app、跨端方案取舍、React Native 概览、移动端适配、真机调试与发布流程 |

站点其他入口：[首页](index.md)、[如何使用本站学习](guide/how-to-use.md)、
[完整学习路线](guide/roadmap.md)。

规模（**[已实测]** 2026-10-23 逐目录清点磁盘）：

| 项 | 数字 |
| --- | --- |
| 领域数 | 17（前端 7 / 后端与数据 4 / 系统与工程 3 / 专题方向 3），全部为 `ready` |
| 章节正文文件 | 201（不含各领域 `index.md` 与 `_sidebar.ts`） |
| 会被构建的页面总数 | **221** = 201 章正文 + 17 个领域首页 + 3 个其他页面（根 `index.md`、`guide/how-to-use.md`、`guide/roadmap.md`） |
| 构建产物 `.html` 数 | **223** = 221 页 + `404.html` + `public/examples/html-archive/index.html` |

每个领域的元数据（标题、简称、一句话定位、所属分期、所属分组、前置领域、建设状态、状态说明）
只有一个来源：`.vitepress/domains.ts`。顶部导航、首页领域卡片、学习路线总表、侧边栏前缀
都由它派生，所以改一处即可全站一致。

分期口径（`PHASE_LABEL`）：`1` = 第一期·能上线，`2` = 第二期·能运维，`3` = 第三期·能长久，
`0` = 已有资源入口（当前 17 个领域都已落到 1/2/3）。

一章的标准结构：正文小节 → `## 常见错误与排查` → `## 练习`（`<Exercise>` 组件，3–6 道，
带折叠答案）→ `## 官方文档与延伸阅读` → `## 下一章`。阶段项目章命名固定为 `project.md`。
写作规范见 [`_content-plan.md`](_content-plan.md) 第二节。

哪些文件不参与构建：`.vitepress/config.mts` 的 `srcExclude` 逐个列出
`README.md`、`TASK-HANDOFF.md`、`CONTRIBUTING.md`、`CONTENT-LICENSE.md`、`scripts/**`、
`**/_*.md`、`docs/deployment.md`、`docs/project-file-inventory.md`；以点开头的目录
（如 `.scratch/`）本来就不参与构建。

## 三、技术栈（以仓库真实文件为唯一依据）

| 组成 | 版本 | 证据 |
| --- | --- | --- |
| 站点框架 | VitePress `1.6.4`（精确锁定，无 `^`） | `package.json`；`node_modules/vitepress/package.json` 实读 |
| 构建器 | Vite `5.4.21`（传递依赖） | `node_modules/vite/package.json` 实读 |
| 视图层 | Vue `3.5.44`（传递依赖） | `node_modules/vue/package.json` 实读 |
| 站内搜索 | MiniSearch `7.2.0`（传递依赖，索引在构建时生成） | `node_modules/minisearch/package.json` 实读 |
| 类型检查 | TypeScript `5.9.3` + `vue-tsc 3.3.13` | `package.json`；`node_modules` 实读 |
| 运行时依赖 | **无**（只有 `devDependencies`） | `package.json` |

`package.json` 关键字段：`"name": "learns"`、`"private": true`、`"type": "module"`，
脚本只有四条（见第六、七节）。

<details>
<summary>为什么 TypeScript 锁在 5.x 而不是 7.x</summary>

`npm install -D typescript` 会装到 7.x。但 `vue-tsc@3.3.13` 需要
`require.resolve('typescript/lib/tsc')`，TS 7 的包不再导出这个子路径，`npm run type-check`
会直接崩：

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './lib/tsc' is not defined
by "exports" in node_modules\typescript\package.json
```

所以显式装 `typescript@5`（本机实读 `node_modules/typescript/package.json` = 5.9.3）。
这也是 [CONTRIBUTING.md](CONTRIBUTING.md) 要求贡献者用 `npm ci` 而不是 `npm install` 的原因：
后者会把带 `^` 的范围依赖升到不兼容版本。这段结论来自排障记录，本次未重跑安装验证。

</details>

## 四、目录结构

```
learns-site/
├─ .github/workflows/
│  └─ build.yml            # CI：npm ci + npm run build，上传 dist 与 dist.zip，v* 标签时发 Release
├─ .vitepress/
│  ├─ config.mts           # 站点配置：导航、侧边栏、中文搜索分词、本地化文案、srcExclude
│  ├─ domains.ts           # 17 个领域的唯一数据源（名称/路径/分组/分期/状态）
│  ├─ theme/
│  │  ├─ index.ts          # 主题入口，注册全局组件
│  │  ├─ style.css         # 全站样式覆盖
│  │  └─ components/       # Callout / Exercise / RoadmapTable / StatusBadge / HomeDomains
│  ├─ dist/                # 构建产物目录（gitignore，不进仓库）
│  ├─ dist.zip             # 构建产物压缩包（gitignore，不进仓库）
│  └─ cache/               # 构建缓存（gitignore，不进仓库）
├─ public/
│  └─ examples/html-archive/   # HTML 阶段项目的参考实现（纯 HTML + CSS）
├─ scripts/                # 四个只读校验脚本 + 三个生成脚本（见第十节）
├─ guide/                  # 使用说明与学习路线（是站点页面）
├─ docs/
│  ├─ deployment.md                # 部署与交付说明（本文件的展开版）
│  └─ project-file-inventory.md    # 每一类文件的作用、打包取舍与可删判定
│      # ↑ 两篇都在 srcExclude 里逐文件列出，只作维护者文档留在源码里，不构建成公开页面；
│      #   学习者需要的启动步骤写在 guide/how-to-use.md。因为它们不进构建，
│      #   相互引用一律写成相对链接（`docs/xxx.md`），不写站内绝对链接。
├─ html/ css/ javascript/ typescript/ vue/ react/ frontend-engineering/
├─ backend/ database/ data-storage/ message-queue-cloud/
├─ linux/ devops/ computer-science/ realtime/ ai-apps/ mobile/
├─ <领域>/_sidebar.ts       # 每领域一个侧边栏文件，由 config.mts 按路径前缀拼装
├─ index.md                # 站点首页
├─ README.md               # 本文件（srcExclude 排除，不会成为站点页面）
├─ CONTRIBUTING.md         # 贡献指南（srcExclude 排除；GitHub 会自动识别为仓库贡献入口）
├─ LICENSE                 # 代码许可：MIT（无 .md 后缀，本来就不参与构建）
├─ CONTENT-LICENSE.md      # 课程内容许可：CC BY 4.0（srcExclude 排除）
├─ .gitattributes          # 钉住 CI 工作流与 .sh 的行尾为 LF（heredoc 需要，见第十六节）
├─ .gitignore              # 提交范围声明，见第十节第 6 条
├─ _content-plan.md        # 章节规划与写作规范（治理文件，srcExclude 排除）
└─ _author-brief.md        # 写作简报（同上）
```

`TASK-HANDOFF.md`（2026-10-17 的单次任务交接记录，内容已大量过期）与各 `.scratch/` 目录
（写章时的证据脚本与其输出）都已被 `.gitignore` 排除，**不在仓库里**，只可能存在于某个人的
本地目录。`srcExclude` 里保留 `TASK-HANDOFF.md` 这一条，是为了兼容本地存在该文件的情况。

`.scratch/` 以点开头，既不会被构建成页面，也不会被提交。一个已知的内容缺口是：
正文里用行内代码点名的证据脚本，有一部分在磁盘上并不存在。这些不影响构建，
但它们是「证据链的缺口」。逐条清单、体积构成与 `.gitignore` 审查写在
[`docs/project-file-inventory.md`](docs/project-file-inventory.md) 第 8.2 节与第 9 节。
补齐它需要真重跑实验，不是改文档能解决的；本项目既不新建脚本冒充证据，也不删改正文引用。

新增一个领域需要动四处：`domains.ts` 加一条、建 `<领域>/_sidebar.ts`、在 `config.mts` 里
import 并挂进 `sidebarByDomain`、建 `<领域>/index.md`。

## 五、环境要求

| 判断依据 | 结论 | 证据 |
| --- | --- | --- |
| 本项目自身 | `package.json` **没有 `engines` 字段**，即项目不声明版本要求 | 实读 |
| 锁定的 Vite 5.4.21 | `engines.node` = `^18.0.0 \|\| >=20.0.0` | 实读 `node_modules/vite/package.json` |
| VitePress 官方「Getting Started」页 | 写明需要 **Node.js 22 或更高**（该页描述的是官方当前版本，非 1.6.4） | 2026-10-22 抓取 `https://vitepress.dev/guide/getting-started` |
| CI 实际使用 | **Node 22**，`npm ci` + `npm run build` 成功 | **[CI 已验证]** 工作流 `Build learning site`，2026-10-23 在 `main` 上运行成功 |
| 本机编写环境 | Node `v25.4.0` + npm `11.7.0`，四项检查全部通过 | **[已实测]** 2026-10-23，见第七节 |

**采用的口径**：装 Node 22 或更高（同时满足官方建议、锁定依赖下限与 CI 实际版本）。
Node 22 已在干净环境（ubuntu-latest）下被 CI 真实跑通；20.x 仍未试过。
`package-lock.json` 的 `lockfileVersion` 是 `3`，用 npm 9 及以上生成/读取最稳妥；
该格式与 npm 版本的对应关系未核实官方文档，仅作提示。

**克隆仓库后必须先装依赖**：`node_modules/` 被 `.gitignore` 排除，**不在仓库里**。
`git clone` 之后直接跑 `npm run dev` 会失败，请先执行第六节的 `npm ci`。

## 六、本地使用

以下命令都在**项目根目录**执行（PowerShell / CMD / Git Bash 均可）。

```powershell
npm ci             # [CI 已验证] 装依赖：严格按 package-lock.json 复现版本（推荐）
npm install        # 会把带 ^ 的范围依赖升级（typescript / vue-tsc），见第三节的已知不兼容，不推荐
npm run dev        # [已实测] 开发服务器，默认 http://localhost:5173/
npm run build      # [已实测] 构建静态站点，输出到 .vitepress/dist/
npm run preview    # [已实测] 用静态服务器托管 dist，默认 http://localhost:4173/
npm run type-check # [已实测] vue-tsc --noEmit -p tsconfig.json，检查 .ts / .vue
```

- 四条脚本的实际命令串见 `package.json` 的 `scripts` 字段。
- 默认端口有源码依据：Vite 的 `constants.js` 定义 `DEFAULT_DEV_PORT = 5173`、
  `DEFAULT_PREVIEW_PORT = 4173`。本项目未在任何配置里改端口。
- 停止服务：在运行它的那个终端窗口按 `Ctrl` + `C`。
- 阅读入口：`http://localhost:5173/`。改任意 `.md` 会热更新。
- `npm run type-check` 检查 `config.mts`、`domains.ts`、各 `_sidebar.ts` 与主题里的
  `.ts` / `.vue`，**不**检查课程 Markdown——`.md` 由构建期的 Markdown/Vue 编译环节负责。
- `.vitepress/config.mts` 里**没有 `server` 配置项**，端口与监听地址都走框架默认值。
  「默认只监听本机」是框架层的通用行为，未核实其源码默认值，因此这里只给保守做法：
  **不要**在日常阅读时加 `--host` 把开发服务器暴露到局域网——加了这个开关就一定能让
  同网段其他设备访问到源码，而已知漏洞只影响开发服务器（见第十一节第 5 条）。

提交前该跑哪些检查、判定标准是什么，见 [CONTRIBUTING.md](CONTRIBUTING.md) 第 4.3 节。

## 七、生产构建与产物目录

```powershell
npm run build      # [已实测] 2026-10-23 退出码 0，build complete in 79.80s
```

- 产物目录：`.vitepress/dist/`。依据（实读 VitePress 源码，非推测）：未配置 `outDir` 时
  取 `<仓库根>/.vitepress/dist`，`srcDir` 默认为仓库根。本项目 `config.mts` 里
  `outDir` 与 `srcDir` 均未设置。
- 如何自己确认输出路径：先看 `.vitepress/config.mts` 里有没有 `outDir`（当前没有），
  再在构建后确认 `.vitepress/dist/index.html` 存在。
- **[已实测] 2026-10-23 17:48–17:50 的构建结果**：退出码 0，`dist/index.html` 时间戳
  17:49:56，产物 **688 个文件、67,258,539 B**，按扩展名分布为
  447 个 `.js` + **223 个 `.html`** + 14 个 `.woff2` + 3 个 `.css` + 1 个 `.json`，
  没有其它类型。223 = 221 页 + `404.html` + `public/examples/html-archive/index.html`。
  其中 `assets/chunks/@localSearchIndexroot.*.js` 实测 18,301,438 B（约占产物 27%），
  是站内搜索的离线索引——离线中文索引在构建时打进产物，所以纯静态托管不联网也能搜中文。
  **稳定判据是「文件数 688 / `.html` 数 223 / 五类扩展名」，不是总字节数**：
  字节数会因内容哈希与 `lastUpdated` 时间戳在每次构建间小幅浮动
  （同日两次构建分别是 67,261,870 B 与 67,258,539 B，文件数与 `.html` 数完全一致）。
  构建会**清空**产物目录后重建，所以旧的遗留页面不会残留
  （「怎么判断 `dist/` 是不是新的」四条判据见
  [`docs/project-file-inventory.md`](docs/project-file-inventory.md) 第 11 节）。
- 构建时的死链检查：VitePress 会检查死链并在发现死链时抛错中止，本项目 `config.mts`
  未设 `ignoreDeadLinks`，即采用默认的严格模式。**本次构建 0 死链、退出码 0。**
- 构建日志里的 `Some chunks are larger than 500 kB after minification.` 来自 VitePress
  自带的客户端运行时，不是本站代码，纯静态本地站点可忽略。

### 取得构建产物：`dist.zip`

不想装 Node、不想自己构建的话，可以直接取现成的构建产物压缩包：

- **从 CI 取**（推荐）：打开
  [Actions 页面](https://github.com/Flygreenbaby/learns-site/actions)，
  进入一次成功的 `Build learning site` 运行，页面底部 Artifacts 区下载
  `learns-site-dist-zip`（压缩包 `dist.zip`）或 `learns-site-dist`（未压缩的 `dist/` 目录）。
  详见第十六节。
- **从 Release 取**：打了 `v*` 标签后，CI 会把 `dist.zip` 作为附件上传到对应的
  [GitHub Release](https://github.com/Flygreenbaby/learns-site/releases)。
- **自己构建**：`npm ci && npm run build`，产物在 `.vitepress/dist/`。

`dist.zip` 解压后得到一个 **`dist/` 目录**，把该目录整体当作站点根目录托管即可。
部署机上**不需要 Node.js**、不需要数据库、不需要后端服务或容器编排。

## 八、本地静态部署（为什么不能双击 HTML）

构建完成后，把 `.vitepress/dist/` 当作静态目录托管即可。三种本机起法：

```powershell
# 1) Python：在 dist 目录里执行，只监听本机           [理论步骤，本机未执行]
python -m http.server 8080 --bind 127.0.0.1

# 2) 任意「解压即用」的静态托管面板（Nginx / Caddy / 宝塔等），把站点根目录指过去

# 3) 装了依赖的机器上，用构建链自带的预览服务          [已实测]
npm run preview -- --port 8080
```

`npm run preview` 曾在 4173 上通过逐路由 200 断言（当时的路由集），发布前清理后又抽样复验过；
**当前路由集是 221 条，全量重扫本轮没做**。

**不能用 `file://` 双击打开 `index.html`。** 原因有两层：产物里的资源路径是**站点根绝对路径**
`/assets/...`，在 `file://` 下会解析到磁盘根；`app.*.js` 是 `<script type="module">`，
浏览器不允许从 `file://` 加载模块。所以哪怕只是「自己看一天」，也要在本机起一个 HTTP 服务
再访问 `http://127.0.0.1:<端口>/`。逐项对照表（`document.styleSheets.length`、
`<script src>` 解析结果、搜索面板行为）见
[`docs/deployment.md`](docs/deployment.md) 第 6 节。

服务器只需满足两点：把目录请求解析到该目录下的 `index.html`（`http.server`、
Nginx 的 `index index.html;`、各类面板都默认支持）；能正确返回 `.js` / `.css` / `.json` 的
MIME 类型。**不需要任何重写规则**（判据见第九节第 1 条）。

**这两点的验证范围要说清楚**：目录形式链接（如 `/vue/`）只在 `vitepress preview`
上实测返回 200；换到 Nginx、`python -m http.server`、机顶盒内置服务器或托管平台时
「目录能否解析到该目录的 `index.html`」与「MIME 是否正确」**都未验证**——
那是那台服务器的配置问题，不是本站产物的问题。

局域网阅读：托管后其他设备访问 `http://<托管机的局域网IP>:<端口>/`。
找 IP 用 `ipconfig`（Windows）或 `hostname -I`（Linux）。Windows 打不开通常是防火墙
没给该端口放行入站。**[理论步骤，未做跨设备实测]**；机顶盒一类设备上的最短路径与
三个常见拦路点写在 [`docs/deployment.md`](docs/deployment.md) 第 8.3 节。

## 九、服务器部署（Nginx）：结论先行

完整步骤（本机验证、局域网、Linux VPS + Nginx、免费静态托管通用流程、更新与回滚、
故障排查表）在 [`docs/deployment.md`](docs/deployment.md)；
两种交付包各装哪些文件在 [`docs/project-file-inventory.md`](docs/project-file-inventory.md)。
这里只放核实出的四个关键判定：

1. **不需要 `try_files` 回退。** 依据：`config.mts` 显式设置 `cleanUrls: false`，
   产物是真实的 `*.html` 文件、页面链接也带 `.html` 后缀，任何静态服务器按文件路径就能命中，
   不存在「路由由前端接管」的 SPA 回退需求。常见的 `try_files $uri $uri/ /index.html;`
   对本项目是多余的。
2. **默认部署在站点根。** 配置里**没有** `base` 字段（已确认），资源引用按站点根绝对路径生成。
   若要放进子目录（如 `/learns/`），需要把 `base` 设为 `'/learns/'` 后重新构建——
   **[理论步骤，未实测]**（改一处配置）。
3. **部署机上不需要 Node.js**，产物是纯静态文件；不需要数据库、后端服务或容器编排。
   Docker 只是可选打包方式，不是本项目的前提。证据是对产物做过逐扩展名清点：
   只有 `.js` / `.html` / `.woff2` / `.css` / `.json` 五类（见第七节），没有任何需要运行时的一侧。
   因此**不要**为了「部署一个静态站」去装开发依赖。
4. **构建是全有或全无的。** 真实遇到过：一个组件标签位置写反就让整个构建中止、
   产物目录里一个页面都不更新。所以「刷新页面 404」这类现象要先确认构建到底成没成功，
   再去看服务器——判别表在 [`docs/deployment.md`](docs/deployment.md) 第 8.2 节。

## 十、更新与维护

改内容的正常路径：**只有 Markdown**。

1. 写/改 `<领域>/<slug>.md`。规范见 [`_content-plan.md`](_content-plan.md) 第二节
   （组件用法、标题、练习数量、诚实性规则、内部链接规则、篇幅）。
2. 新章要在该领域的 `_sidebar.ts` 里加一条 `{ text, link }`；同时在该领域上一章的
   `## 下一章` 里接上链接。
3. 领域章数变化时改 `.vitepress/domains.ts` 的 `statusNote`，以及该领域首页
   `<StatusBadge note="...">`——这两处必须与磁盘一致。
4. 校验（全部是只读脚本，`node scripts/<name>.cjs` 形式调用）：

   | 脚本 | 作用 | 已知盲区 |
   | --- | --- | --- |
   | `check-file.cjs` | 单篇结构：禁 frontmatter、单 H1、围栏配对与语言白名单、连续左花括号插值符、组件标签前后空行、`difficulty`/`type` 枚举、小节顺序、链接目标存在性、篇幅上下限 | 不理解语义；篇幅阈值与 `_content-plan.md` §2.1 不一致（见第十一节第 6 条） |
   | `check-links.cjs` | 站内绝对链接（以斜杠开头的 Markdown 链接）的死链检查（含 `_sidebar.ts`）。**[已实测]** 2026-10-23 输出 `OK: no dead internal links. 243 page targets.` | **看不见相对链接**，也不校验 `#锚点`；它硬编码的排除表只有 `README.md` 与 `TASK-HANDOFF.md`，**不知道 `config.mts` 后来排除的 `docs/` 两篇与 `CONTRIBUTING.md`、`CONTENT-LICENSE.md`**，所以那 4 个文件仍被当作页面候选（`243` 就是这么来的）。若以后有正文链接指向 `/docs/…` 或 `/CONTRIBUTING`，这个脚本会说 OK 而 `npm run build` 会中止。**它说 OK 不等于全站无死链，最终以 `npm run build` 为准** |
   | `status.cjs` | 按 `_content-plan.md` §一的表统计进度 | 只数表里的 187 行，html 与 css 前 4 章不在表内 |
   | `scan-braces.cjs` | 全站扫描「连续左花括号」插值起始符（构建致命项）。**[已实测]** 2026-10-23 跑出 3 处，全部落在 `_author-brief.md` 与 `_content-plan.md` 里「讲解这条规则本身」的段落，而这两个文件被 `**/_*.md` 排除、不参与构建，对产物无影响 | 无 |
   | `gen-sidebar.cjs` / `sync-index-links.cjs` / `sync-meta.cjs` | 生成侧边栏、同步首页链接、同步元数据（**会写文件**） | 不是校验工具；改导航优先手工编辑，避免覆盖定制内容 |

5. 治理文件（`_content-plan.md`、`_author-brief.md`）与 `scripts/` 下的校验脚本是规范来源，
   改内容时不要顺手改它们。
6. **版本管理与提交范围**：本项目是 Git 仓库，远端
   <https://github.com/Flygreenbaby/learns-site>，默认分支 `main`。
   `.gitignore` **已生效**，排除 `node_modules/`、`.vitepress/dist/`、`.vitepress/cache/`、
   `.vitepress/dist.zip`、`.scratch/`、`TASK-HANDOFF.md`、`learns-site.zip`、`*.log`、
   `.DS_Store`、`.idea/`、`.vscode/`。判断「哪些文件被改过」用 `git status` / `git diff`，
   **不要**再靠文件修改时间推断。逐条判定见
   [`docs/project-file-inventory.md`](docs/project-file-inventory.md) 第 9 节。
   注意 `.gitignore` 只是「提交范围」的声明，真正决定公开发包内容的是打包清单
   （同一份清单在第 12 节）。

## 十一、常见问题

**1. `npm ci` / `npm install` 失败。** 本项目只需要 registry 可达；依赖面很小
（3 个 devDependencies）。优先用 `npm ci`。若 `npm run type-check` 报
`ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './lib/tsc'`，是 TypeScript 被装成了 7.x，
与 `vue-tsc@3.3.13` 不兼容，装回 `typescript@5` 即可（见第三节折叠块）。
其余安装报错没有样本，不做猜测。

**2. 端口被占用。** `dev` 默认 5173、`preview` 默认 4173。Vite 的 dev server 在端口被占时
会自动顺延，但 `preview` 不一定；显式指定即可：`npm run dev -- --port 5180`、
`npm run preview -- --port 8080`（**[理论步骤]，本机未用过显式端口**）。
Windows 上查谁占了端口：`netstat -ano | findstr :5173`。

**3. 刷新页面 404 / 白屏。** 本项目产物是 `*.html` 真实文件，正常静态托管下刷新不会 404。
如果 404，按这四条排查（每条都对应本仓库的真实配置）：
① 服务器有没有把 `/` 解析到 `index.html`；② 是不是把产物放进了子目录却没设置 `base`
（第九节第 2 条）；③ 是不是用 `file://` 打开的（第八节）；④ **构建到底成功了没有**——
构建是全有或全无的，中止时产物里一个页面都不会更新（第九节第 4 条）。
**不需要**配 `try_files`，配上也不解决这四条。完整判别表在
[`docs/deployment.md`](docs/deployment.md) 第 8.2 节。

**4. 构建时报 `N dead link(s) found.`。** VitePress 的死链检查是**默认严格**的
（`config.mts` 未设 `ignoreDeadLinks`），它会打印出问题的文件与链接。
处理顺序：先改正链接写法（首选）。只有在确实需要引用非页面资源时才考虑
`ignoreDeadLinks: true` 或字符串/正则数组放行特定链接——那会把死链检查关掉，
等于让以后新增的死链悄悄进不了构建日志，不建议长期用。
本项目**没有**使用 `ignoreDeadLinks`，全站死链检查始终开着，这是刻意的。

**5. `npm audit` 报 3 个漏洞（esbuild / vite / vitepress），`fixAvailable` 都是 `false`。**
VitePress 1.6.4 锁在 Vite 5.4.21，修复要到 Vite 6.4.3+，只能等上游。
这些漏洞影响的是**开发服务器**；交付物是静态文件，部署后不跑 Node 进程。
规避：dev server 只监听 localhost、不加 `--host`。
**[历史实测记录，2026-10-16，未重跑 `npm audit`]**

**6. 校验脚本说「太长」或「缺章节」，但章节其实是合格的。** 两套已知口径不一致：
`_content-plan.md` §2.1 写「普通章 12–20 KB、项目章 16–28 KB」，而 `check-file.cjs`
实际按另一套阈值判定；`html/` 与部分 `css/` 早期章节的小节用编号标题（如 `## 十二、练习`），
而脚本要求精确匹配 `## 练习`。内容存在，只是命名约定不同。
明细见 [`docs/project-file-inventory.md`](docs/project-file-inventory.md)；
**先决定以哪份口径为准**，再决定要不要改。

**7. CI 上构建失败，但本地能过。** 先看 Actions 日志里 `npm run build` 那一步的输出。
CI 用的是 Node 22 + `npm ci`（严格按锁文件），本地若是 `npm install` 装出来的
依赖树可能版本不同。第二常见原因是行尾：`.github/workflows/*.yml` 里的
`run` 脚本含 heredoc，必须以 LF 检出，仓库已用 `.gitattributes` 钉住（见第十六节）。

## 十二、项目边界（哪些是真、哪些是示例、哪些还得你自己验）

**内容的真实完成度**：**[已实测]** 逐文件清点，17 个领域全部为 `ready`，
201 个章节文件全部存在于磁盘且全部挂在侧边栏；`_content-plan.md` 规划的 187 章
标题与侧边栏文案逐字一致。`.vitepress/domains.ts` 的 17 条 `statusNote` 与各领域首页
`<StatusBadge>` 的章数与磁盘对得上。

**「已验证」的含义**：正文里的 `<Callout type="verified">` 只表示「这段机制在**本站编写环境**
（Windows + Node）跑过」，每个 verified 框都写明了覆盖范围与不覆盖范围；
`type="unverified"` 表示规范/文档级说明或产品侧内容，本机没条件验证。
统计（2026-10-23 清点）：144 个 verified、155 个 unverified。
涉及 Linux、Docker、数据库服务、消息队列、云服务、真机调试、发布审核的章节，
在本机做的是 **Node 层的机制模拟**，不是那些软件的真实运行——这是有意的、
且在章内标注的处理，**不等于「已经在真实环境验证过」**。

**仍然未实测、需要你自己验的部分**：

- **浏览器人工点击验收**：首屏 JS 水合、站内搜索框出中文结果、暗色模式切换、
  移动端布局、侧边栏折叠、阶段项目页面上的参考实现。已做过的只是 HTTP 200、
  产物存在、以及产物 DOM 层面的结构性核对（含练习页数量、练习卡片与答案体配平、
  0 个「暂未提供答案解析」占位）——**这些都不等于真实浏览器里点过**。
- **目录解析与 MIME 在非 `preview` 宿主上的行为**（Nginx、`http.server`、
  机顶盒内置服务器、托管平台）。
- **全部外部链接的可达性与内容对应性**：构建范围内页面里的
  `[文字](http…)` 形式链接共约 2,489 处、去重后约 1,275 个 URL、涉及 134 个主机
  （2026-10-22 脚本逐文件统计）。**这些链接一条都没有联网核实**，
  **不得因为「构建没报错」就认为链接有效**。
- **任何远程部署**：`docs/deployment.md` 第 10–11 节全文（`nginx -T`、`chmod -R a+rX`、
  `unzip`、`nginx -t && nginx -s reload`、Docker 构建与反代、`base: '/learns/'` 子目录部署、
  免费静态托管平台流程）。没有登录或部署到任何远程机器，也没有在任何云平台上验证过。
- **本机未跑过的命令**：`python -m http.server`、`netstat`、`ipconfig`。
- **正文点名的部分 `.scratch` 证据脚本在磁盘上不存在**（第四节末尾）。
- **真实环境目标**：Docker/Compose、Nginx、systemd、PostgreSQL/MySQL、Redis、
  RabbitMQ/Kafka、对象存储与 CDN、云平台、WebSocket 经 Nginx 代理、
  微信小程序真机与提审发布。这些要在有账号/有设备的真实环境里按章内验收标准自己过一遍。

有一条**已经不再是理论步骤**：干净环境的安装与构建。`npm ci` + `npm run build` 在
ubuntu-latest + Node 22 上已被 CI 成功执行（见第五、十六节）；本机 `node_modules/`
早已存在，所以本机的安装动作仍未执行。

隐私清理已完成：正文里的真实姓名、邮箱、本机账户名与本机绝对路径已替换为占位值，
构建产物对全部真实值 0 命中（含站内搜索索引那个大 chunk），并用同形命令对占位值做过
阳性对照。逐条记录与复扫结果见
[`docs/project-file-inventory.md`](docs/project-file-inventory.md) 第 10 节。
仍需人工确认的只剩私有网段 IP 与一处示例 DSN，按「不确定就不改」处理。

## 十三、内容原则

- 全部为中文原创讲解，英文关键术语保留原文。
- 不转载 javascript.info 或任何第三方教程正文；`javascript/` 的 12 章是中文补充正文
  （语言层易错点、DOM 与网络、阶段项目、TypeScript 衔接），并与 javascript.info 主线配套使用。
- 引用规范与官方文档时给可访问的官方链接，指向具体知识点。
- 讲「为什么」和「怎么排查」，不只给结论。
- 代码没实际跑过就明确标注「未经运行验证」，不声称测试通过。

## 十四、许可

本项目采用**双许可**，代码与内容分开授权：

| 授权对象 | 许可证 | 文本 |
| --- | --- | --- |
| 程序代码（站点配置、主题组件、`_sidebar.ts`、`scripts/`、CI 工作流、工程配置） | **MIT License** | [LICENSE](LICENSE) |
| 原创课程内容（17 个领域与 `guide/` 下的 Markdown 正文、练习与答案、教学示例 `public/examples/`） | **CC BY 4.0**（署名 4.0 国际版） | [CONTENT-LICENSE.md](CONTENT-LICENSE.md) |

CC BY 4.0 允许你**转载、修改、二次发布，以及商业使用**（包括放进收费课程），
无需另行取得授权，条件是三项：**适当署名**、**提供许可链接**、**说明修改情况**。
署名写法示例与常见疑问见 [CONTENT-LICENSE.md](CONTENT-LICENSE.md)。

**两份许可都不覆盖第三方依赖与不属于本项目的第三方材料**，它们保留各自的原有授权条件：

- `package.json` 里的开发依赖（VitePress、TypeScript、vue-tsc）及其传递依赖
  （Vite、Vue、MiniSearch 等）遵循各自上游许可证，`npm ci` 装出来的 `node_modules/`
  不属于本项目作品；
- 构建产物中由 VitePress 打包带入的运行时 JS/CSS 与 14 个 `inter-*.woff2` 字体文件
  （Inter 字体采用 SIL Open Font License 1.1）；
- 课程只以链接形式引用的外部规范、官方文档与第三方教程正文（如 javascript.info），
  版权均归各自权利人。

完整边界清单见 [CONTENT-LICENSE.md](CONTENT-LICENSE.md) 第三节。

## 十五、贡献与反馈

**你不需要本仓库的写权限**，也不需要被加为协作者。所有修改通过 Fork + Pull Request 提交。

- 报错、失效链接、内容有误、想加新主题 → 开
  [Issue](https://github.com/Flygreenbaby/learns-site/issues)，
  并给出具体文件路径、实际现象与依据（官方文档链接或可复现步骤）。
- 改错别字、修技术错误、更新失效链接、补原理说明、修死链 → **可以直接提 PR**。
- 新增领域、大规模重写、改 `config.mts` / `domains.ts` / `scripts/`、
  引入新依赖或改导航结构 → **请先开 Issue 讨论**。
- 提交前请跑这 4 条项目自带的检查：`npm run type-check`、`node scripts/check-links.cjs`、
  `node scripts/scan-braces.cjs`、`npm run build`。**`npm run build` 退出码 0 是唯一权威判据。**
  PR 提交后 CI 也会自动跑一遍构建。
- 内容必须准确：不得编造 API、命令输出、运行结果、测试数据或参考资料链接；
  引用来源必须真实可查；没跑过的代码要标注验证范围，**不要声称「已测试」**。
- 提交 PR 即表示你同意所提交的代码按 MIT、内容按 CC BY 4.0 发布。

完整流程（Fork、分支命名、`npm ci`、检查判定标准、PR 描述该写什么）见
[CONTRIBUTING.md](CONTRIBUTING.md)。

## 十六、持续集成与版本发布

CI 工作流是 [`.github/workflows/build.yml`](.github/workflows/build.yml)，名为
`Build learning site`。**它只构建与打包，不部署网站、不改 GitHub Pages 设置。**

**触发条件**：push 到 `main`、push `v*` 标签、向 `main` 发 Pull Request、手动 `workflow_dispatch`。

**`build` job**（权限 `contents: read`）：

| 步骤 | 动作 |
| --- | --- |
| 1 | `actions/checkout@v4` |
| 2 | `actions/setup-node@v4`，Node 22，`cache: npm` |
| 3 | `npm ci` |
| 4 | `npm run build` → 产物在 `.vitepress/dist/` |
| 5 | 上传 artifact `learns-site-dist`（未压缩的 `dist/` 目录，`if-no-files-found: error`，保留 30 天） |
| 6 | `zip -r dist.zip dist`，并断言压缩包非空且含 `dist/index.html` |
| 7 | 上传 artifact `learns-site-dist-zip`（即 `dist.zip`，保留 30 天） |

**`release` job**（仅在 `refs/tags/v*` 上运行，`needs: build`，权限提升为 `contents: write`）：
先用 `actions/checkout@v4` 检出仓库，再下载上一步的 `dist.zip` artifact，
用 runner 自带的 `gh` CLI 创建 GitHub Release 并把 `dist.zip` 作为附件上传；
若该标签的 Release 已存在，则用 `--clobber` 替换附件。
不重复构建、不引入第三方 Action（`actions/checkout@v4` 与 `build` job 用的是同一个）。

检出这一步是必需的：`gh` 要靠当前目录的 Git 仓库推断 owner/repo，工作目录里没有 `.git`
时就报 `failed to run git: fatal: not a git repository (or any of the parent directories): .git`。
它与下载 artifact 的**顺序也不能调换**——`checkout` 的 `clean` 输入默认为 `true`，
会在 fetch 前执行 `git clean -ffdx && git reset --hard HEAD`，把未跟踪的 `package/`
（也就是刚下载的 `dist.zip`）一并删掉。这条已在本地实测确认。

**验证状态（请如实看待）**：

- **[CI 已验证]** `build` job 的 checkout → Node 22 → `npm ci` → `npm run build` → 上传 artifact
  这条链路：2026-10-23 在 `main` 上运行**成功**（当时的工作流还没有第 6–7 步与 `release` job）。
- **[已实测，本机]** `dist.zip` 的内容与可用性：2026-10-23 17:50 用 Python `zipfile` 按同样的
  `dist/` 顶层结构重建，得到 **688 个文件条目、223 个 `.html`、17,285,593 B**；
  解压到干净目录后与 `.vitepress/dist/` **逐字节相同**（`diff -rq` 无差异），
  `dist/index.html` 存在。压缩包字节数同样会随构建小幅浮动，稳定判据是条目数与 `.html` 数。
  本机 Git Bash **没有 `zip` 命令**（只有 `unzip`），所以本地这份是用 Python 生成的；
  CI 上用的是 `zip -r`。两者产出的都是带 `dist/` 顶层目录的标准 ZIP，
  差别仅在于 `zip -r` 会额外写入目录条目（本机这份 688 个条目，CI 那份会是 711 个）。
- **[CI 已验证]** 新增的第 6–7 步（`Package dist.zip`、`Upload dist.zip artifact`）：
  随推送标签 `v0.1.0` 那次运行一起跑过并**成功**。依据有两条，都是可核对的：
  ① `release` job 的 `if` 里没有 `always()`，而 GitHub 的规则是「如果某作业失败或跳过，
  则所有需要它的作业都会被跳过」，所以 `release` 既然运行到了 `gh` 那一步，
  `needs: build` 必然已经成功；② 它的报错发生在最后一步，说明前面的 `Download dist.zip`
  没有失败，即 `learns-site-dist-zip` 这个 artifact 确实生成且可下载。
- **[CI 已失败 → 修复待验证]** `release` job：2026-10-23 在标签 `v0.1.0` 上**真实运行过并失败**
  （此前这里写的是「整个 `release` job 尚未在任何环境运行过」，已不成立）。失败在最后一步，
  报错为 `failed to run git: fatal: not a git repository (or any of the parent directories): .git`，
  原因是该 job 当时只下载 artifact、没有检出仓库，工作目录里没有 `.git`，`gh` 无从确定
  owner/repo。修复是在 `Download dist.zip` **之前**补一步 `actions/checkout@v4`；
  截至本文更新，这个修复还只是**未提交的工作区改动，尚未在 GitHub 上运行过**。
- **[已实测，本机]** `Write release notes` 与 `Create or update GitHub Release` 两步的脚本：
  按 YAML 字面块规则提取出来后，用 `bash -eo pipefail`（与 Actions 默认 shell 一致）真实执行过——
  heredoc 产出的 `release-notes.md` 为 35 行 / 1,431 B / CR=0，无缩进泄漏、代码围栏完整，
  `bash -n` 语法检查通过。另用一个记录 argv 的 stub `gh` 验证了两条分支的实参：Release 不存在时
  走 `gh release create <tag> package/dist.zip --title <tag> --notes-file release-notes.md`，
  已存在时走 `gh release upload <tag> package/dist.zip --clobber`；反向对照（把 stub 换成
  无条件退出 7）时脚本退出码为 7，失败不会被静默吞掉。
  **但真实 `gh` 的远端行为仍未验证**：本机没有 `gh`，也无法在本地执行 GitHub Actions，
  只能等含修复的标签真正跑一次才知道。

**行尾约定**：`run` 脚本里含 heredoc，若以 CRLF 检出，终止符会变成 `EOF\r` 而匹配不上，
导致 Release 说明写残。仓库已用 [`.gitattributes`](.gitattributes) 把
`.github/workflows/*.yml` 与 `*.sh` 钉为 `text eol=lf`，不受各人 `core.autocrlf` 影响
（本机 `core.autocrlf=true`，提交时本就会规范化为 LF，这条是显式兜底）。

### 发布第一个可用版本：`v0.1.1`

> **2026-10-23 更正**：本节原先的第 5 条写的是「修好 `release` job 后重跑该 job 即可」，
> 这句是**错的**。GitHub 官方文档写明：重新运行工作流或其中的作业，使用的是**与原始触发事件
> 相同的 `GITHUB_SHA`**；而每次工作流运行用的都是**该提交 SHA / Git 引用中的工作流版本**。
> 标签 `v0.1.0` 指向提交 `0264fcf`，那个提交里的 `build.yml` 仍是坏的（`release` job 没有
> checkout 步骤）。所以把修复推到 `main` 之后再去 Actions 页面点「Re-run failed jobs」，
> 跑的还是旧工作流，会以同一个错误再失败一次。已实测：
> `git show v0.1.0:.github/workflows/build.yml` 里只有 1 处 `actions/checkout@v4`
> （第 20 行，属于 `build` job），`release` job 里没有。

**当前状态**（均已核实）：上一轮的许可证 / README / 贡献指南 / CI 打包改动已提交为
`0264fcf docs: clarify licensing and prepare releases` 并推送，`main` 与 `origin/main` 同步；
`build` job（含新增的第 6–7 步）已随 `v0.1.0` 那次标签推送成功运行过；仓库里只有一个标签
`v0.1.0`（本地与远端都指向 `0264fcf`），[Releases 页面](https://github.com/Flygreenbaby/learns-site/releases)
**至今没有任何 Release**——那次失败发生在 `gh` 创建 Release 之前。
`v0.1.0` 这个标签本身不需要动，留着当失败记录即可，正式发布从 `v0.1.1` 开始。

**剩下的步骤**：

1. 把「`release` job 补 `actions/checkout@v4`」这个修复提交并推送到 `main`
   （截至本文更新，它还是未提交的工作区改动）。这次推送会触发一次 `main` 上的 `build` job；
   `release` job 因为 `if: startsWith(github.ref, 'refs/tags/v')` 不会运行。
2. 确认这次 `main` 构建成功。
3. 在**含修复的提交**上打新标签并推送：`git tag v0.1.1 && git push origin v0.1.1`。
   这会同时触发 `build` 与 `release` 两个 job。
4. 回到 [Releases 页面](https://github.com/Flygreenbaby/learns-site/releases) 确认
   `v0.1.1` 已创建、`dist.zip` 已作为附件上传、说明文字完整。
5. 若 `release` job 仍然失败，读日志里 `gh` 那一步的报错。修完之后**同样不能靠重跑旧 run**：
   按上面那条 SHA 规则，任何工作流改动都必须先落到标签所指的提交上才会生效——
   要么再打一个新标签（推荐），要么把标签强制移到含修复的提交（属于重写标签，需自行确认）。
   附件上传本身是幂等的：Release 已存在时脚本走 `--clobber` 分支，不会重复创建。

> 本轮**没有**执行任何提交、推送、打标签、创建 Release 或部署动作，
> 也没有修改 GitHub Pages 设置。
