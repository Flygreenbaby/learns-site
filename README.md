# 全栈学习手册（learns）

面向**个人本地自学**的中文编程学习网站。VitePress 静态站点：无后端、无数据库、无用户系统、
无登录、不埋点、不记录学习进度。全部内容是仓库里的 Markdown 文件，构建后是一堆静态 HTML。

本文件说明「这个项目是什么、怎么在本地跑起来、怎么部署、边界在哪里」。
服务器部署（环境、构建、本机验证、局域网、Nginx、静态托管平台、更新与回滚）的完整步骤在
[`docs/deployment.md`](docs/deployment.md)；每一类文件的作用与命运（保留什么、不发布什么、
能不能删、打包时怎么取舍）在 [`docs/project-file-inventory.md`](docs/project-file-inventory.md)。

> **本文件的命令状态标注规则（2026-10-22 更新）**：本项目有三类结论，务必分开读——
>
> - **本次已实测**：2026-10-22 在**当前文件状态**上真跑过并写明结果。最后一次跑是在
>   **公开发布前清理之后**（正文隐私替换 + 两篇维护文档移出构建），结果：
>   `npm run build`（退出码 0，120.60 s，产出 221 页 / 223 个 `.html`）、
>   `npm run type-check`（退出码 0，无诊断输出＝零类型错误）、
>   `node scripts/check-links.cjs`（`OK: no dead internal links. 241 page targets.`
>   ——这个 241 是脚本自己的页面候选集，**不等于公开页面数**：它硬编码的排除表里没有
>   `docs/` 两篇，所以仍把它们当页面；构建侧的真判据是 `npm run build` 退出码 0 且产物 223 个 `.html`）、
>   `node scripts/scan-braces.cjs`（3 处命中全在被排除的 `_*` 治理文件里）、
>   `node .scratch/mdcheck.mjs`（逐页编译复刻，223 页 0 失败）、
>   `npm run preview`（4178，抽 12 条 URL 断言：5 个被改过的章页 + `guide/how-to-use`
>   + 首页两种写法 + `404.html` 共 9 条 200，
>   `docs/` 两篇的 `.html` 与无扩展名形式共 3 条为 404，服务已停、端口已释放）。
>   上一轮（同日 22:19–22:26）还做过 dev 5173 与 preview 4173 的**逐路由全量 200 扫描**（222 条），
>   本轮没有重做全量，只做了上面的抽样断言。
>   本轮同时修复了两类会让构建中止的缺陷（组件插槽位置、指向 `.scratch` 的死链）。
> - **历史实测**：更早会话（2026-10-16）在同一台机器上做过的实验，当时产物**不含**后来写完的
>   章节，本次未重做。包括 `file://` 打开的对照表、站内搜索的离线索引位置、搜索分词容错行为、
>   `npm audit` 的三条漏洞记录。标注它当时的产物范围。
> - **理论步骤 / 未实测**：**任何安装动作**（`npm install` / `npm ci`，本机依赖早已存在，
>   本次没装过）、**任何远程部署**（Nginx、VPS、Docker、免费静态托管、机顶盒跨设备访问）、
>   **浏览器人工点击验收**（搜索框、暗色模式、移动端布局、首屏水合）。
>   这些一律写成「理论步骤」，不要当成已验证结果。

---

## 一、用途与定位

- 解决什么问题：把「从零学到能上线、能运维、能长久维护」的路线拆成 17 个领域，
  每个领域给出学习顺序、要解决的真实问题、章节正文、练习与阶段项目。
- 给谁用：自学者本人，主要在本地或局域网阅读；不是公开课程平台，没有账号体系。
- 不是什么：不是文档站点的聚合器，不做转载；外部规范与官方文档以链接形式引用。

## 二、课程范围与组织方式

组织单位是**领域（domain）**，一个领域一个顶层目录，URL 前缀即目录名（`/html/`、`/backend/`）。

| 项 | 实测数字（2026-10-22，逐目录清点磁盘） |
| --- | --- |
| 领域数 | 17（前端 7 / 后端与数据 4 / 系统与工程 3 / 专题方向 3） |
| 章节正文文件 | 201（= `_content-plan.md` 规划的 187 章 + 规划表成立前已写完的 14 章：html 10、css 前 4） |
| 领域首页 | 17 个 `<领域>/index.md` |
| 站点其他页面 | 根 `index.md`、`guide/how-to-use.md`、`guide/roadmap.md`（3 个）。`docs/` 下两篇是维护者文档，2026-10-22 起已被 `srcExclude` 排除，**不再是站点页面** |
| 会被构建的页面总数 | **221**（= 201 章正文 + 17 领域首页 + 3 个其他页面）。按 `.vitepress/config.mts` 的 `srcExclude` 排除 `README.md`、`TASK-HANDOFF.md`、`scripts/**`、`**/_*.md`、`docs/deployment.md`、`docs/project-file-inventory.md`，并以点开头的目录如 `.scratch/` 本来就不参与构建。**已实测**：2026-10-22 23:41–23:43 的 `npm run build`（退出码 0，120.60 s）产出 `dist` 内 **223 个 `.html`** = 221 页 + `404.html` + `public/examples/html-archive/index.html`；`dist/docs/` 目录不存在，`.vitepress/dist/docs/deployment.html`（上一轮构建遗留）随本次清空重建消失 |

每个领域的元数据（标题、简称、一句话定位、所属分期、所属分组、前置领域、建设状态、状态说明）
只有一个来源：`.vitepress/domains.ts`。顶部导航、首页领域卡片、学习路线总表、侧边栏前缀
都由它派生，所以改一处即可全站一致。

分期口径（`PHASE_LABEL`）：`1` = 第一期·能上线，`2` = 第二期·能运维，`3` = 第三期·能长久，
`0` = 已有资源入口（当前 17 个领域都已落到 1/2/3，没有 `phase: 0` 的领域）。

一章的标准结构：正文小节 → `## 常见错误与排查` → `## 练习`（`<Exercise>` 组件，3–6 道，
带折叠答案）→ `## 官方文档与延伸阅读` → `## 下一章`。阶段项目章命名固定为 `project.md`。

内容是否"能连续学习"由 `.vitepress/domains.ts` 的 `status` 字段与每个领域首页的
`<StatusBadge>` 表达，当前 17/17 为 `ready`，且 17 条 `statusNote` 里的章数与磁盘逐一对齐
（本次已核对，见「十二、项目边界」）。

## 三、技术栈（以仓库真实文件为唯一依据）

| 组成 | 版本 | 证据 |
| --- | --- | --- |
| 站点框架 | VitePress `1.6.4`（精确锁定，无 `^`） | `package.json` devDependencies；`node_modules/vitepress/package.json` 实读 `1.6.4` |
| 构建器 | Vite `5.4.21`（VitePress 的传递依赖） | `package-lock.json` 与 `node_modules/vite/package.json` 实读 |
| 视图层 | Vue `3.5.44`（传递依赖） | `package-lock.json` 的 `node_modules/vue` 条目 |
| 站内搜索 | MiniSearch `7.2.0`（传递依赖，索引在构建时生成） | `node_modules/minisearch/package.json` 实读 |
| 类型检查 | TypeScript `5.9.3` + `vue-tsc ^3.3.13` | `package.json`；`node_modules/typescript/package.json` 实读 |
| 运行时依赖 | **无**（只有 `devDependencies`） | `package.json` |

`package.json` 关键字段：`"name": "learns"`、`"private": true`、`"type": "module"`，
脚本只有四条（见第六、七节）。`learns-site.zip` 不是交付流程的一部分，见第十二节。

<details>
<summary>为什么 TypeScript 锁在 5.x 而不是 7.x</summary>

`npm install -D typescript` 会装到 7.x（原生编译器版本）。但 `vue-tsc@3.3.13` 需要
`require.resolve('typescript/lib/tsc')`，TS 7 的包不再导出这个子路径，`npm run type-check`
会直接崩：

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './lib/tsc' is not defined
by "exports" in node_modules\typescript\package.json
```

所以显式装 `typescript@5`（本次实读 `node_modules/typescript/package.json` = 5.9.3）。
这段结论来自上一轮排障记录，本次未重跑安装验证。

</details>

## 四、目录结构

```
learns/
├─ .vitepress/
│  ├─ config.mts          # 站点配置：导航、侧边栏、中文搜索分词、本地化文案、srcExclude
│  ├─ domains.ts          # 17 个领域的唯一数据源（名称/路径/分组/分期/状态）
│  ├─ theme/
│  │  ├─ index.ts         # 主题入口，注册全局组件
│  │  ├─ style.css        # 全站样式覆盖
│  │  └─ components/      # Callout / Exercise / RoadmapTable / StatusBadge / HomeDomains
│  └─ dist/               # 构建产物目录（由 VitePress 默认规则决定，见第七节）
├─ public/
│  └─ examples/html-archive/   # HTML 阶段项目的参考实现（纯 HTML + CSS）
├─ scripts/               # 四个只读校验脚本 + 三个生成脚本（见第十节）
├─ guide/                 # 使用说明与学习路线
├─ docs/
│  ├─ deployment.md                # 部署与交付说明（本文件的展开版）
│  └─ project-file-inventory.md    # 每一类文件的作用、打包取舍与可删判定
│      # ↑ 两篇都在 srcExclude 里逐文件列出，**只作维护者文档留在源码里，不构建成公开页面**；
│      #   学习者需要的启动步骤写在 guide/how-to-use.md。因为它们不进构建，
│      #   相互引用一律写成相对链接（`docs/xxx.md`），不写站内绝对链接。
├─ html/ css/ javascript/ typescript/ vue/ react/ frontend-engineering/
├─ backend/ database/ data-storage/ message-queue-cloud/
├─ linux/ devops/ computer-science/ realtime/ ai-apps/ mobile/
├─ <领域>/_sidebar.ts      # 每领域一个侧边栏文件，由 config.mts 按路径前缀拼装
├─ index.md               # 首页
├─ README.md              # 本文件（被 srcExclude 排除，不会成为站点页面）
├─ _content-plan.md       # 章节规划与写作规范（治理文件，srcExclude 排除）
├─ _author-brief.md       # 写作简报（同上）
└─ TASK-HANDOFF.md        # 2026-10-17 的交接记录，内容已大量过期（srcExclude 排除）
```

各 `<领域>/.scratch/` 目录是写章时的证据脚本与其输出，**以点开头的目录不会被构建成页面**，
所以它们在站点上不可达。2026-10-22 之前有 4 处正文用**链接**形式指向它们，其中 1 处会把整站构建
中止掉；现已全部改成行内代码（见第十一节第 5 条）。本次逐条清点还发现另一类问题：
**正文用行内代码点名的证据脚本，有 54 条在磁盘上并不存在**（`typescript/` 整个领域没有
`.scratch/` 目录，`database/.scratch/` 是空的，`backend/` 缺 3 个，其余是零散单点）。
这些不影响构建，但它们是"证据链的缺口"。逐条清单、体积构成与 `.gitignore` 审查都写在
`docs/project-file-inventory.md`（维护者文档，已排除在公开页面之外）。

新增一个领域需要动四处：`domains.ts` 加一条、建 `<领域>/_sidebar.ts`、在 `config.mts` 里
import 并挂进 `sidebarByDomain`、建 `<领域>/index.md`。

## 五、环境要求（已核实的部分与口径冲突）

| 判断依据 | 结论 | 证据 |
| --- | --- | --- |
| 本项目自身 | `package.json` **没有 `engines` 字段**，即项目不声明版本要求 | 本次实读 |
| 锁定的 Vite 5.4.21 | `engines.node` = `^18.0.0 \|\| >=20.0.0` | 本次实读 `node_modules/vite/package.json` |
| VitePress 官方「Getting Started」页 | 写明需要 **Node.js 22 或更高**（该页描述的是官方当前版本，非 1.6.4） | 2026-10-22 抓取 `https://vitepress.dev/guide/getting-started` |
| 本站编写环境 | Node `v25.4.0` + npm `11.7.0` | 本次 `node -v` / `npm -v` 输出 |

**采用的口径**：装 Node 22 或更高（同时满足官方建议与锁定依赖的下限）。
但要说清验证边界：**被证明能完整跑通本项目（构建 + 类型检查 + dev + preview）的是
本机这套 Node v25.4.0 + npm 11.7.0**，22.x 与 20.x 本次都没试过。
`package-lock.json` 的 `lockfileVersion` 是 `3`，用 npm 9 及以上生成/读取最稳妥；
本次未核实该格式与 npm 版本对应关系的官方文档，仅作提示。
仓库里已有 `node_modules/`（含 vitepress 1.6.4），所以复制整个项目目录后可以直接进入第六节，
但换机器时仍应重装依赖（**`npm ci` / `npm install` 本次未执行，属理论步骤**）。

## 六、本地使用

以下命令都在**项目根目录**执行（PowerShell / CMD / Git Bash 均可）。
状态：**第 2–4 条本次已实测**（`npm run dev` / `build` / `preview`，结果见第七节与
`docs/deployment.md` 第 0 节）；**第 1 条 `npm install` 本次未执行**（本机依赖早已存在），
属理论步骤。

```powershell
npm ci             # 装依赖：有 package-lock.json 时优先用它，严格按锁文件复现版本 [理论步骤，本次未执行]
npm install        # 同上，但会把带 ^ 的范围依赖升级（typescript / vue-tsc），见第三节的已知不兼容 [理论步骤，本次未执行]
npm run dev        # [已实测] 开发服务器，默认 http://localhost:5173/
npm run build      # [已实测] 构建静态站点（退出码 0），输出到 .vitepress/dist/
npm run preview    # [已实测] 用静态服务器托管 dist，默认 http://localhost:4173/
```

- `dev` / `build` / `preview` 三个脚本的实际命令串分别是 `vitepress dev` / `vitepress build` /
  `vitepress preview`（证据：`package.json` 的 `scripts` 字段）。
- 默认端口有源码依据：`node_modules/vite/dist/node/constants.js` 第 107–108 行定义
  `DEFAULT_DEV_PORT = 5173`、`DEFAULT_PREVIEW_PORT = 4173`。本项目未在任何配置里改端口。
- 停止服务：在运行它的那个终端窗口按 `Ctrl` + `C`。
- 阅读入口：`http://localhost:5173/`。改任意 `.md` 会热更新。
- 本项目 `.vitepress/config.mts` 里**没有出现 `server` 配置项**（全文检索无 `server:`），
  所以端口与监听地址都走框架默认值。「默认只监听本机」是框架层的通用行为，本次没有去
  核实其源码默认值，因此这里只给保守做法：**不要**在日常阅读时加 `--host`
  把开发服务器暴露到局域网——加了这个开关就一定能让同网段其他设备访问到源码，
  而已知漏洞只影响开发服务器（见第十一节第 9 条）。
- 另有一条 `npm run type-check`（`vue-tsc --noEmit -p tsconfig.json`），检查
  `config.mts`、`domains.ts`、各 `_sidebar.ts` 与主题里的 `.ts` / `.vue`。
  **[已实测] 2026-10-22 无任何输出，即零类型错误。**
  它**不**检查课程 Markdown——`.md` 由构建期的 Markdown/Vue 编译环节负责。

## 七、生产构建与产物目录

```powershell
npm run build      # [已实测] 2026-10-22 退出码 0，产出完整站点
```

- 产物目录：`.vitepress/dist/`。依据（本次实读源码，非推测）：
  `node_modules/vitepress/dist/node/chunk-D3CUZ4fa.js` 第 17413 行定义
  `resolve = (root, file) => path.resolve(root, '.vitepress', file)`，第 17434 行
  `outDir = userConfig.outDir ? … : resolve(root, "dist")`——即未配置时就是
  `<仓库根>/.vitepress/dist`；第 17429 行 `srcDir = resolve(root, userConfig.srcDir || ".")`
  说明源目录就是仓库根。本项目 `.vitepress/config.mts` 里 `outDir` 与 `srcDir` 均未设置。
- 如何自己确认输出路径：先读 `.vitepress/config.mts` 里有没有 `outDir`（当前没有），
  再在构建后列目录看 `.vitepress/dist/index.html` 是否存在。本次已这样做过：
  产物确认在 `.vitepress/dist/`，`index.html` 存在。
- **当前磁盘状态（2026-10-22 23:43 实测）**：`.vitepress/dist/` 是**发布前清理之后重新构建的产物**，
  `dist/index.html` 的 mtime 为 2026-10-22 23:43:47，内含 223 个 `.html`
  （221 页 + `404.html` + `public` 原样拷进去的示例页）、447 个 `.js`、
  14 个 `.woff2`、3 个 `.css`、`hashmap.json`，共 688 个文件、67,203,366 B；
  其中 `assets/chunks/@localSearchIndexroot.*.js` 达 18,301,503 B，是站内搜索的离线索引。
  上一次构建（22:26）遗留的 `dist/docs/deployment.html` 在本次构建后**不存在**（构建会清空产物目录，
  实测 `ls .vitepress/dist/docs` 报 No such file or directory），产物里比 23:41 更早的文件只有
  `public/examples/html-archive/` 那 2 个，且与 `public/` 源文件 `cmp` 逐字节相同——
  它们是拷贝时间戳，不是过期内容。仓库根的 `learns-site.zip`（mtime 2026-10-16，2,420,059 B）
  早于后续全部工作，**不能**当交付物，现已进入 `.gitignore`。判据写在 `docs/deployment.md` 第 7.2 节：
  比时间、比数量、比内容三条，任一条不过就重新构建。
- 构建时的死链检查：VitePress 会检查死链并在发现死链时抛错中止
  （源码 `node_modules/vitepress/dist/node/chunk-D3CUZ4fa.js`，判定与记录在 36692–36707 行，
  `throw new Error('N dead link(s) found.')` 在 45027 行），本项目 `config.mts` 未设
  `ignoreDeadLinks`，即采用默认的严格模式。**本次实际构建的结果是 0 死链、退出码 0**——
  上一版本文档记录的「1 条会触发中止的死链」已按「改成行内代码」修掉，检查开关仍然开着。

## 八、本地静态部署（为什么不能双击 HTML）

构建完成后，把 `.vitepress/dist/` 当作静态目录托管即可。三种本机起法
（第 3 条**已实测**：`npm run preview` 起在 4173 通过 222 条路由断言（当时的路由集）；
发布前清理后又在 4178 抽 12 条复验——5 个被改过的章页（`linux/command-line`、
`linux/users-and-permissions`、`devops/git-basics`、`typescript/tsconfig`、`html/links`）
加 `guide/how-to-use`、首页两种写法、`404.html`，共 9 条 200；
`docs/` 两篇的 `.html` 形式与无扩展名形式共 3 条 404。**当前路由集是 221 条**，
全量重扫本轮没做。第 1、2 条不需要 Node，属**理论步骤，本次未执行**）：

```powershell
# 1) Python：在 dist 目录里执行，只监听本机
python -m http.server 8080 --bind 127.0.0.1

# 2) 任意「解压即用」的静态托管面板（Nginx / Caddy / 宝塔等），把站点根目录指过去

# 3) 装了源码的机器上，用构建链自带的预览服务
npm run preview -- --port 8080
```

**不能用 `file://` 双击打开 `index.html`。** 下表是上一轮在当时的构建产物上做的实测结论
（2026-10-16，Chromium 150；本次未重做）：

| 检查项 | `file://` 打开 | 静态服务器托管 |
| --- | --- | --- |
| `document.styleSheets.length` | **0**（CSS 一张都没加载） | 正常 |
| `<script src>` 解析结果 | `file:///D:/assets/app.*.js`（跑到磁盘根去了） | `/assets/app.*.js` |
| 点开搜索按钮 | **搜索面板不出现** | 正常，中文可搜 |
| 正文文字 | 能看（预渲染 HTML） | 能看 |

原因有两层：产物里的资源路径是**站点根绝对路径** `/assets/...`，在 `file://` 下会解析到磁盘根；
`app.*.js` 是 `<script type="module">`，浏览器不允许从 `file://` 加载模块。
所以哪怕只是"自己看一天"，也要在本机起一个 HTTP 服务再访问 `http://127.0.0.1:<端口>/`。

服务器只需满足两点：把目录请求解析到该目录下的 `index.html`（`http.server`、
Nginx 的 `index index.html;`、各类面板都默认支持）；能正确返回 `.js` / `.css` / `.json` 的
MIME 类型。**不需要任何重写规则**——判定依据见下一段。
**这两点的验证范围要说清楚**：目录形式链接（如 `/vue/`）本次只在 `vitepress preview`
上实测返回 200；换到 Nginx、`python -m http.server`、机顶盒内置服务器或托管平台时
「目录能否解析到该目录的 `index.html`」与「MIME 是否正确」**都未验证**——
那是那台服务器的配置问题，不是本站产物的问题。

局域网阅读：托管后其他设备访问 `http://<托管机的局域网IP>:<端口>/`。
找 IP 用 `ipconfig`（Windows）或 `hostname -I`（Linux）。Windows 打不开通常是防火墙
没给该端口放行入站。**这一段本次未做跨设备实测**，属理论步骤；
机顶盒一类设备上的最短路径与三个常见拦路点写在 `docs/deployment.md` 第 8.3 节。

## 九、服务器部署（Nginx）：结论先行

完整步骤（本机验证、局域网、Linux VPS + Nginx、免费静态托管通用流程、更新与回滚、
故障排查表）在 [`docs/deployment.md`](docs/deployment.md)；
两种交付包各装哪些文件在 [`docs/project-file-inventory.md`](docs/project-file-inventory.md)。
这里只放核实出的三个关键判定：

1. **不需要 `try_files` 回退。** 依据：`config.mts` 显式设置 `cleanUrls: false`，
   产物是真实的 `*.html` 文件、页面链接也带 `.html` 后缀，任何静态服务器按文件路径就能命中，
   不存在"路由由前端接管"的 SPA 回退需求。常见的 `try_files $uri $uri/ /index.html;`
   对本项目是多余的。
2. **默认部署在站点根。** 配置里**没有** `base` 字段（本次已确认），资源引用按站点根绝对路径生成。
   若要放进子目录（如 `/learns/`），需要把 `base` 设为 `'/learns/'` 后重新构建——
   这条**未实测**，属推断（改一处配置）。
3. **部署机上不需要 Node.js**，产物是纯静态文件；不需要数据库、后端服务或容器编排。
   Docker 只是可选打包方式，不是本项目的前提。
   证据是对产物做过逐扩展名清点：发布前清理后的构建为 447 个 `.js` + 223 个 `.html` +
   14 个 `.woff2` + 3 个 `.css` + 1 个 `.json`（共 688 个文件），没有其它类型，
   也就没有任何需要运行时的一侧。同日更早那次构建（清理前）是 449 js / 224 html，
   差额正好是当时唯一进过产物的那篇维护文档 `docs/deployment.html` 与它的
   `.js` + `.lean.js` 两个页面 chunk（`docs/project-file-inventory.md` 写在那次构建之后，
   从未进过产物），本次移出后两者都不再产出。
   因此**不要**为了"部署一个静态站"去装开发依赖。
4. **构建是全有或全无的。** 本次真实遇到过：一个组件标签位置写反就让整个构建中止、
   产物目录里一个页面都不更新。所以「刷新页面 404」这类现象要先确认构建到底成没成功，
   再去看服务器——判别表在 `docs/deployment.md` 第 8.2 节。

## 十、更新与维护

改内容的正常路径：**只有 Markdown**。

1. 写/改 `<领域>/<slug>.md`。规范见 `_content-plan.md` 第二节（组件用法、标题、练习数量、
   诚实性规则、内部链接规则、篇幅）。
2. 新章要在该领域的 `_sidebar.ts` 里加一条 `{ text, link }`；同时在该领域上一章的
   `## 下一章` 里接上链接。
3. 领域章数变化时改 `.vitepress/domains.ts` 的 `statusNote`，以及该领域首页
   `<StatusBadge note="...">`——这两处必须与磁盘一致。
4. 校验（全部是只读脚本，`node scripts/<name>.cjs ...` 形式调用）：

   | 脚本 | 作用 | 已知盲区 |
   | --- | --- | --- |
   | `check-file.cjs` | 单篇结构：禁 frontmatter、单 H1、围栏配对与语言白名单、连续左花括号插值符、组件标签前后空行、`difficulty`/`type` 枚举、小节顺序、链接目标存在性、篇幅上下限 | 不理解语义；篇幅阈值与 `_content-plan.md` §2.1 不一致（见第十一节第 6 条） |
   | `check-links.cjs` | 站内绝对链接（以斜杠开头的 Markdown 链接）的死链检查（含 `_sidebar.ts`）。[已实测] 2026-10-22 发布前清理后输出 `OK: no dead internal links. 241 page targets.` | **看不见相对链接**（如指向 `.scratch` 的），也不校验 `#锚点`；它硬编码的排除表只有 `README.md` 与 `TASK-HANDOFF.md`，**不知道 `config.mts` 新排除的 `docs/` 两篇**，所以仍把它们当作页面候选——若以后有正文链接指向 `/docs/…`，这个脚本会说 OK 而 `npm run build` 会中止。它说 OK 不等于全站无死链，最终以 `npm run build` 为准 |
   | `status.cjs` | 按 `_content-plan.md` §一的表统计进度 | 只数表里的 187 行，html 与 css 前 4 章不在表内 |
   | `scan-braces.cjs` | 全站扫描「连续左花括号」插值起始符（构建致命项；本表上一行为避免该符号，改用文字描述）。[已实测] 2026-10-22 跑出 3 处，**全部落在 `_author-brief.md` 与 `_content-plan.md` 里"讲解这条规则本身"的段落**，而这两个文件被 `**/_*.md` 排除、不参与构建，所以对产物无影响 | 无 |
   | `gen-sidebar.cjs` / `sync-index-links.cjs` / `sync-meta.cjs` | 生成侧边栏、同步首页链接、同步元数据（**会写文件**） | 不是校验工具；改导航优先手工编辑，避免覆盖定制内容 |

5. 治理文件（`_content-plan.md`、`_author-brief.md`）与 `scripts/` 下的校验脚本是规范来源，
   改内容时不要顺手改它们。
6. 本项目**不是 Git 仓库**（无 `.git/`），没有提交历史可用；判断"哪些文件被改过"只能靠
   文件修改时间——这也意味着 `.gitignore` **此刻完全不生效**，它只决定
   "将来 `git init` 之后什么会被提交"。本次审出它**不排除** `.scratch/`、`learns-site.zip`
   与 `TASK-HANDOFF.md`，而 `.scratch/` 里有含本机账户名的输出文件和演示用 `.env*` 文件。
   **2026-10-22 发布前清理已处理**：这三条以注释形式追加在原 6 行之后，**原有规则一行未改**。
   逐条判定写在 `docs/project-file-inventory.md` 第 9 节。
   要纳入版本管理需自行 `git init`（本次未做）。注意 `.gitignore` 只是"提交范围"的声明，
   真正决定公开发包内容的是打包清单（同一份清单在第 12 节）。

## 十一、常见问题

**1. `npm install` 失败。** 本项目只需要 registry 可达；依赖面很小（3 个 devDependencies）。
若 `npm run type-check` 报 `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './lib/tsc'`，
是 TypeScript 被装成了 7.x，与 `vue-tsc@3.3.13` 不兼容，装回 `typescript@5` 即可（见第三节折叠块）。
其余安装报错本次没有样本，不做猜测。

**2. 端口被占用。** `dev` 默认 5173、`preview` 默认 4173。Vite 的 dev server 在端口被占时
会自动顺延，但 `preview` 不一定；显式指定即可：`npm run dev -- --port 5180`、
`npm run preview -- --port 8080`（理论步骤，本次未用过显式端口）。Windows 上查谁占了端口：
`netstat -ano | findstr :5173`。

**3. 刷新页面 404 / 白屏。** 本项目产物是 `*.html` 真实文件，正常静态托管下刷新不会 404。
如果 404，按这三条排查（每条都对应本仓库的真实配置）：
① 服务器有没有把 `/` 解析到 `index.html`；② 是不是把产物放进了子目录却没设置 `base`（第九节第 2 条）；
③ 是不是用 `file://` 打开的（第八节）；④ **构建到底成功了没有**——构建是全有或全无的，
中止时产物里一个页面都不会更新（第九节第 4 条）。
**不需要**配 `try_files`，配上也不解决这四条。
「构建失败」与「页面访问失败」的完整判别表在 `docs/deployment.md` 第 8.2 节。

**4. 构建时报 `N dead link(s) found.`。** VitePress 的死链检查是**默认严格**的
（`config.mts` 未设 `ignoreDeadLinks`）。它会打印出出问题的文件与链接。
处理顺序：先改正链接写法（首选），只有在确实需要引用非页面资源时，
才用 `ignoreDeadLinks: true` 或字符串/正则数组放行特定链接——后者会把死链检查关掉，
不建议长期用。（本次静态复刻该检查发现的 1 条见下一条目。）

**5. 正文里的 `.scratch` 链接在站上打不开。（已修复，2026-10-22）** 原问题位置：
`data-storage/connection-pool-and-slow-query.md:13`、`data-storage/prisma-deep-dive.md:13`、
`data-storage/raw-sql-and-drizzle.md:15` 与 `:17`——它们是相对链接，指向点目录里的证据脚本，
这类文件不会被构建成页面，所以线上必然不可达；其中 `raw-sql-and-drizzle.md:15` 因为链接
末尾是 `/`、无扩展名会被当作页面候选，**会让 `npm run build` 直接抛错中止**。
**处理方式（已采用第一种修法）**：四处链接全部改成行内代码，只保留路径文字，
不再写成链接；`computer-science/complexity.md:15` 的"链接文字与目标不符"同批改掉；
`html/document-structure.md:74` 的锚点指向修正为目标页真实存在的标题 id。
**没有**使用 `ignoreDeadLinks`，全站死链检查仍然开着——这是刻意的，
关掉它等于让以后新增的死链悄悄进不了构建日志。
同批还修了 8 个章文件里 24 处写在 `</Exercise>` **之后**的 `<template #answer>`
（那才是让全站 0 页产出的真凶），修法纯为标签归位、字节数不变、不动一个字的正文。
现在 `.scratch` 在正文里全部以行内代码出现，读者仍不可达，但构建不再中止。
另一类问题**仍未解决且本轮不擅自处理**：正文用行内代码点名的证据脚本有 **54 条在磁盘上不存在**
（详见第四节末尾与 `docs/project-file-inventory.md` 第 8.2 节）——补齐它需要真重跑实验，
不是文档改字能解决的。

**6. 校验脚本说"太长"，但章节是合格的。** 已知两套口径不一致：`_content-plan.md` §2.1 写
「普通章 12–20 KB、项目章 16–28 KB」，而 `check-file.cjs` 实际按 11,000–32,000 B
（理想 14,000–30,000）与项目章 15,000–60,000 B 判定。按后者，当前 42 章超限
（最极端 `html/accessibility.md` 67,310 B）。这些文件多早于校验脚本定稿（脚本 mtime 2026-10-18 11:00，
超限章多为 10-16/10-17），属历史遗留而非新写内容。**先决定以哪份为准**，再决定要不要压。

**7. `html/` 与部分 `css/` 章节被 `check-file.cjs` 判为"缺章节"。** 这些早期章节的小节用编号标题
（`## 十二、练习`），而脚本要求精确匹配 `## 练习`。内容存在，只是命名约定不同；
另有 9 处代码围栏没写语言标注、`html/forms.md` 只有 2 道练习。
属于规范落地前留下的差异，不是内容缺失。

**8. 构建出现 `Some chunks are larger than 500 kB after minification.`** 来自 VitePress 自带的
客户端运行时，不是本站代码。纯静态本地站点可忽略。

**9. `npm audit` 报 3 个漏洞（esbuild / vite / vitepress），`fixAvailable` 都是 `false`。**
依据上一轮记录：VitePress 1.6.4 锁在 Vite 5.4.21，修复要到 Vite 6.4.3+，只能等上游。
这些漏洞影响的是**开发服务器**；交付物是静态文件，部署后不跑 Node 进程。
规避：dev server 只监听 localhost、不加 `--host`。**本次未重跑 `npm audit`，该表内容属历史实测记录。**

## 十二、项目边界（哪些是真、哪些是示例、哪些还得你自己验）

**内容的真实完成度**（本次逐文件清点，非采信脚本计数）：17 个领域全部为 `ready`，
201 个章节文件全部存在于磁盘且全部挂在侧边栏；`_content-plan.md` 规划的 187 章
标题与侧边栏文案逐字一致。`.vitepress/domains.ts` 的 17 条 `statusNote` 与各领域首页
`<StatusBadge>` 的章数与磁盘对得上。

**"已验证"的含义**：正文里的 `<Callout type="verified">` 只表示"这段机制在**本站编写环境**
（Windows + Node v25.4.0）跑过"，每个 verified 框都写明了覆盖范围与不覆盖范围；
`type="unverified"` 表示规范/文档级说明或产品侧内容，本机没条件验证。
统计：142 个 verified、153 个 unverified（本次清点）。涉及 Linux、Docker、数据库服务、
消息队列、云服务、真机调试、发布审核的章节，在本机做的是**Node 层的机制模拟**，
不是那些软件的真实运行——这是有意的、且在章内标注的处理，不等于"已经在真实环境验证过"。

**文档本身的未验部分（2026-10-22 更新）**：本文件第七、八、九节与 `docs/deployment.md`
第 0–9 节里的 `npm run build` / `type-check` / `dev` / `preview`、四条 `scripts/` 只读校验、
产物逐扩展名清点、逐页编译复刻、dev 与 preview 上的逐路由 200 断言，**都是本次在当前文件
状态上真跑过的**，结果写明在 `docs/deployment.md` 第 0 节那张表。
**发布前清理之后又重跑了一次**（`type-check` 退出码 0、`npm run build` 退出码 0 / 120.60 s、
`check-links.cjs` 0 死链、`mdcheck.mjs` 223 页 0 失败、产物隐私扫描 0 命中），
但这一轮的 preview 只抽了 **12 条 URL** 做状态码断言（含两篇维护文档应为 404），
没有重做上一轮那种逐路由全量 200 扫描。
仍然**未实测**的是：**任何安装动作**（`npm install` / `npm ci`，本机依赖早已存在）、
`python -m http.server`、`netstat`、`ipconfig`、以及 `docs/deployment.md` 第 10–11 节
全文（`nginx -T`、`chmod -R a+rX`、`unzip`、`nginx -t && nginx -s reload`、Docker 构建与反代、
`base: '/learns/'` 子目录部署、免费静态托管平台流程）——那些是**理论操作步骤**，
本次没有登录或部署到任何远程机器，也没有在任何云平台上验证过。
第八节的 `file://` 对照表、站内搜索行为、`localStorage` 内容、`public/examples/` 在 dev 与
静态托管下的差异，以及第十一节第 9 条的漏洞表，都是**上一轮在当时的产物上做的实测**，
本次没有重做，且当时的构建产物不含后来写完的章节。

**尚未验收的部分**（本轮不做，需另开一轮）：

- **浏览器人工点击验收**：首屏 JS 水合、站内搜索框出中文结果、暗色模式切换、
  移动端布局、侧边栏折叠、阶段项目页面上的参考实现。本次只做到 HTTP 200、
  构建产物存在、以及产物 DOM 层面的结构性核对（200 个含练习页 / 694 个练习卡片 /
  694 个答案体 / 0 个「暂未提供答案解析」占位）——**这些都不等于真实浏览器里点过**。
- **目录解析与 MIME 在非 preview 宿主上的行为**：`/vue/` 这类目录链接本次只在
  `vitepress preview` 上实测 200；Nginx、`http.server`、机顶盒内置服务器、托管平台上**未验证**。
- **一次干净环境的安装**：`npm ci` 在全新机器上能否成功、版本能否复现，未测。
- **全部外部链接的可达性与内容对应性**——本次清点口径：只数构建范围内页面里的
  `[文字](http…)` 形式链接，共 **2,489 处、去重后 1,275 个 URL、涉及 134 个主机**（脚本逐文件
  统计，2026-10-22）；页面访问修复那一轮报告里写的是 2,490 条，两处相差 1，属不同时刻重算的
  口径差，未逐条对齐。**这些链接一条都没有联网核实**，
  **不得因为"没报错"就认为链接有效**。
- **正文点名的 `.scratch` 证据脚本有 54 条在磁盘上不存在**（第十一节第 5 条末尾）。
  补齐要真重跑实验；本轮既不新建脚本冒充证据，也不删改正文引用。
- 真实环境目标：Docker/Compose、Nginx、systemd、PostgreSQL/MySQL、Redis、RabbitMQ/Kafka、
  对象存储与 CDN、云平台、WebSocket 经 Nginx 代理、微信小程序真机与提审发布。
  这些都要你在有账号/有设备的真实环境里按章内验收标准自己过一遍；
- `learns-site.zip`（10-16）仍是历史产物，不可作为交付物，现已写进 `.gitignore`。
  `.vitepress/dist/` **是**发布前清理之后（2026-10-22 23:41–23:43）重新构建的产物，
  221 页全部产出、`dist/docs/` 已随清空消失，按 `docs/deployment.md` 第 7.2 节那四条判据都过
  （第 1 条已用 `find -newer` 逐文件核对：没有任何一章 `.md` 比产物新）。
- 隐私清理：**已完成（2026-10-22）**。`devops/git-basics.md`、`devops/git-collaboration.md`、
  `javascript/modules-and-iterators.md`、`javascript/errors-and-debugging.md`、
  `linux/command-line.md`、`linux/users-and-permissions.md`、`backend/error-handling.md`、
  `backend/node-runtime.md`、`css/selectors.md`、`typescript/` 三章、
  `frontend-engineering/vite-build.md`、`html/links.md` 共 14 个章文件里的真实姓名、邮箱、
  本机账户名与本机绝对路径已替换为占位值（41 处，逐条记录在
  `docs/project-file-inventory.md` 第 10 节），随后重新构建。构建产物对全部六个真实值
  **0 命中**（含 18 MB 的站内搜索索引 chunk），并用同形命令对占位值做阳性对照（命中 4/17/5 个文件）。
  仍需人工确认的只剩私有网段 IP（`10.244.3.17` 等，出现在 5 个章文件里）与
  `backend/logging-and-monitoring.md` 的示例 DSN——本轮按"不确定就不改"处理。

## 十三、内容原则

- 全部为中文原创讲解，英文关键术语保留原文。
- 不转载 javascript.info 或任何第三方教程正文；`javascript/` 的 12 章是中文补充正文
  （语言层易错点、DOM 与网络、阶段项目、TypeScript 衔接），并与 javascript.info 主线配套使用。
- 引用规范与官方文档时给可访问的官方链接，指向具体知识点。
- 讲"为什么"和"怎么排查"，不只给结论。
- 代码没实际跑过就明确标注"未经运行验证"，不声称测试通过。
