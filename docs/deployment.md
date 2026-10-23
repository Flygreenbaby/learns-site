# 部署与交付说明（learns 静态站点）

本文件是根目录 `README.md` 第六至九节的展开版，回答六个问题：
**在自己的机器上怎么跑起来**、**怎么判断是构建坏了还是访问坏了**、
**交付给别人的两种包分别装什么**、**怎么在 Windows 本机验证产物**、
**怎么放到局域网设备 / Linux VPS / 免费静态托管上**、
**改完内容之后怎么重新验证、更新、回滚**。

配套阅读：交付物的逐类文件命运写在 [`docs/project-file-inventory.md`](project-file-inventory.md)
（哪一类必须保留、哪一类不必发布、哪些可删、`.scratch/` 与 `.gitignore` 怎么处理）。

> **本文件不构建成公开页面**。2026-10-22 发布前清理时，`.vitepress/config.mts` 的 `srcExclude`
> 在原有四条（`README.md`、`TASK-HANDOFF.md`、`scripts/**`、`**/_*.md`）之后**逐文件**追加了
> `docs/deployment.md` 与 `docs/project-file-inventory.md`。两篇维护者文档因此只留在源码里，
> 学习者看到的站点页面数因此是 **221**（上一版本文档按「两篇都发布」推算的 223 页作废）。
> 实测：产物 223 个 `.html` = 221 页 + `404.html` + `public` 拷贝的示例页；`dist/docs/` 目录不存在。
> 排除是逐文件写的而不是 `'docs/**'`，故意的：以后往 `docs/` 里加文件时，
> 它会不会被公开必须在 `config.mts` 里显式改一行决定，不会因目录约定而悄悄发布。
> 文中凡指向未构建成页面的文件（`README.md`、`.scratch/`、任意 `.md` 源文件、`scripts/` 下的脚本）
> 一律写成行内代码而不是链接。**两篇维护文档相互引用用相对链接**（本文指向
> `project-file-inventory.md`，对方指向 `deployment.md`，链接文字仍写全路径 `docs/…`），
> 因为在 `docs/` 目录里写 `docs/xxx` 会被按相对路径解析成 `docs/docs/xxx`，
> 而对不在构建里的文件而言，站内绝对链接又必然不可达——两种写法都点不开。
> `scripts/check-links.cjs` 有两处盲区，别把它的输出当全判据：它**看不见相对链接**，
> 上面这类错误它抓不到（本轮是逐条 `fs.existsSync` 核对的）；它的排除表是硬编码的，
> **仍把这两篇当页面候选**，所以它输出的 `241 page targets` 不是站点页面数。
> 真判据是 `npm run build` 的退出码与产物计数。

## 0. 命令状态标注口径

本文件用三种标记，每条命令都带其一：

- **[已实测]** —— 2026-10-22 在**本项目当前文件状态**上真跑过，写明结果。
- **[历史实测]** —— 更早的会话（2026-10-16）在同一台机器上跑过，但当时产物不含后来写完的章节，本次未重做。
- **[理论步骤]** —— 命令本身是通用正确做法，本次**没有在这台机器或这些目标上执行**。

**2026-10-22 实测结论（覆盖了上一版文档里"构建有已知中止点"的说法）**：
下表最后一列为**发布前清理之后重跑的结果**（23:41–23:43），它是当前文件的真实状态。

| 动作 | 清理前（22:19–22:26 那一轮） | 清理后（本轮，23:41–23:43） |
| --- | --- | --- |
| `npm run build` | 退出码 0，224 个 `.html` | **退出码 0**，120.60 s，**223 个 `.html`**（221 页 + `404.html` + `public` 示例页），688 个文件、67,203,366 B |
| `npm run type-check` | 无输出，即零类型错误 | **退出码 0**，输出只有 npm 自己的 2 行命令回显（64 B），零类型错误 |
| `npm run dev` | 起在 `5173`，222 条**无扩展名**路由逐一请求全部 200 | 本轮未起 dev（清理只影响 `srcExclude` 与正文文字，路由集从 222 缩到 221） |
| `npm run preview` | 起在 `4173`，222 条构建路由的两种形式全部 200 | 起在 `4178`，**抽 12 条**：5 个被改章页 + `guide/how-to-use` + 首页两种写法 + `404.html` 共 9 条 200；`docs/` 两篇的 `.html` 与无扩展名形式共 3 条 **404**。服务已停，`netstat` 复查 4178/4173/5173 均 0 个 LISTENING |
| `node scripts/check-links.cjs` | `OK: no dead internal links. 240 page targets.` | `OK: no dead internal links. 241 page targets.`（脚本把两篇维护文档仍算候选，见文件头那条注意） |
| 逐页编译复刻（`.scratch/mdcheck.mjs`，只读工具） | 222 页全部编译通过，0 失败 | **223 页 0 失败**（221 个发布页 + 2 篇不发布的维护文档，后者也仍然可编译） |
| 产物 DOM 层面核对 | 200 个含练习页、694 个练习卡片、694 个答案体、0 个占位 | **同一口径重跑，结果不变**：对清理后的 223 个 `.html` 逐文件数 `<section class="exercise is-` 与 `class="exercise__answer"`，得 200 / 694 / 694 / 0 |
| 产物隐私扫描 | 未做 | 六个真实值（本机账户名、姓名、邮箱域名，以及三类本机路径前缀片段）在**整个 `dist/` 里 0 命中**，含 18,301,503 B 的站内搜索索引 chunk；同形命令对占位值命中 4/17/5 个文件（阳性对照，证明这条扫描不是空跑） |
| 站内搜索、暗色模式、移动端布局 | **未做浏览器人工点击验收**——HTTP 200、产物存在、插槽渲染正确，都不等于真实浏览器里逐页点过 | 同前，本轮也没做 |

上一版本文档的第 0 节断言「`npm run build` 当前有 1 个已知的构建中止点」，
并给出两种修法。那条断言已被上述事实推翻：中止点来自
`data-storage/raw-sql-and-drizzle.md` 里一个指向 `.scratch` 目录的链接，
已按「改成行内代码」的方式修掉（同批还修了另外 3 处同类链接），
**没有**使用 `ignoreDeadLinks`，全站死链检查仍然开着。

**仍然没有实测过的**：任何安装动作（`npm install` / `npm ci`，本机依赖早已存在）、
任何远程部署（Nginx、VPS、Docker、免费静态托管）、局域网设备上的真实浏览器打开。
本文件不为这些动作作成功背书。

---

## 1. 环境要求

| 依据 | 结论 | 状态 |
| --- | --- | --- |
| 本项目 `package.json` | **没有 `engines` 字段**，项目自身不声明版本要求 | [已实测] 本次读过全文 |
| 锁定的 Vite 5.4.21 | `engines.node` 要求 Node 18.x，或 20.0.0 及以上 | [已实测] 读 `node_modules/vite/package.json` |
| VitePress 官方「Getting Started」 | 当前官方版本写明需要 **Node.js 22 或更高**（描述的是官方当前版本，不是本站锁定的 1.6.4） | [理论步骤] 2026-10-22 抓取，未在此环境交叉验证 |
| 本站编写环境实际使用的版本 | Node **v25.4.0** + npm **11.7.0**，构建、类型检查、dev、preview 全部在此跑通 | [已实测] |

**采用的口径**：装 **Node 22 或更高**。它同时满足官方建议与锁定依赖的下限；
但请注意，**被证明能完整跑通本项目的是 25.4.0**，22.x 未在本机试过。

只有 `devDependencies`、没有运行时依赖，也没有数据库、没有后端进程。
`package-lock.json` 的 `lockfileVersion` 是 3（用 npm 9+ 生成/读取最稳妥）。

**如果只是阅读已经构建好的站点，不需要 Node、不需要 npm。** 见第 6、7 节。

## 2. 从零开始：安装依赖并跑起来

以下都在**项目根目录**执行。PowerShell、CMD、Git Bash 均可（本项目所有路径按 Windows 写法举例）。

```powershell
# [理论步骤] 本机依赖已存在，这一步本次没有执行过
npm ci          # 有 package-lock.json 时优先用它：严格按锁文件装，可复现同一套版本
# 或
npm install     # 会按 package.json 的范围记号升级（typescript / vue-tsc 都带 ^）

npm run dev     # [已实测] 开发服务器，默认 http://localhost:5173/
npm run build   # [已实测] 生产构建，输出 .vitepress/dist/
npm run preview # [已实测] 用构建链自带的静态服务器托管 dist，默认 http://localhost:4173/
```

四条脚本的真实命令串来自 `package.json`：`vitepress dev` / `vitepress build` /
`vitepress preview` / `vue-tsc --noEmit -p tsconfig.json`。默认端口有源码依据：
`node_modules/vite/dist/node/constants.js` 第 107–108 行定义
`DEFAULT_DEV_PORT = 5173`、`DEFAULT_PREVIEW_PORT = 4173`；
`.vitepress/config.mts` 里没有 `server` 配置项，所以端口与监听地址都走框架默认值。

**为什么优先 `npm ci`**：本项目已知一个由"升级"造成的真实故障——`typescript` 装成 7.x 后，
`vue-tsc@3.3.13` 会崩在 `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './lib/tsc'`。
锁文件把版本钉在 5.9.3，`npm ci` 才保证拿到它。详见 `README.md` 第三节。

## 3. 开发服务器（写作时用）

```powershell
npm run dev
```

- 浏览器打开 `http://localhost:5173/`，改任意 `.md` 会热更新。
- 停止：在运行它的那个终端按 `Ctrl` + `C`。
- 端口被占：Vite 的 dev server 会自动顺延，`preview` 不一定。显式指定即可：
  `npm run dev -- --port 5180`、`npm run preview -- --port 8080`。
  Windows 上查谁占了端口：`netstat -ano | findstr :5173`。[理论步骤，命令通用，本次未执行]
- **不要用 `--host` 把开发服务器暴露到局域网。** 已知漏洞只影响 dev server，
  且它会把源码而非产物交出去。给局域网阅读请走第 8 节的静态托管。

dev 与 build 有一个差别会影响排查判断。[已实测] 本次在 dev（5173）上访问
`/examples/html-archive/` 这种「磁盘上有目录、但它不是被构建的页面」的形式 URL 时，
命中的是 VitePress 的单页应用回退：返回的是站点外壳，再由前端路由渲染成「页面不存在」。
**HTTP 状态码是 200，看状态码看不出来，只有看响应正文才能发现拿到的是外壳而不是那个页面。**
构建后由静态服务器把目录解析到该目录下的 `index.html`，才是正常行为。
所以：在 dev 里发现某个目录链接「打开是 404 页面」，不能直接当作产物坏了；
而"dev 全路由 200"也不能当作"构建产物全对"的证据——本次两条结论是分开记录、分开陈述的。

另一条同样重要：**目录形式链接（如 `/vue/`）本次只在 `vitepress preview` 上实测返回 200**。
换到别的静态宿主（Nginx、机顶盒内置服务器、免费托管平台）时，
"目录请求能否解析到该目录下的 `index.html`" **未验证**，取决于那台服务器的配置（第 10、11 节）。

## 4. 类型检查与其余校验脚本

```powershell
npm run type-check                     # [已实测] 2026-10-22 无输出 = 零错误
node scripts/check-file.cjs <某个章.md> # 单篇结构与篇幅校验（只读）
node scripts/check-links.cjs           # [已实测] 站内绝对链接死链检查
node scripts/scan-braces.cjs           # 扫描会让构建崩掉的连续左花括号插值符（只读）
node scripts/status.cjs                # 按规划表统计进度（只读）
```

`tsconfig.json` 的 `include` 只有 `.vitepress/config.mts`、`.vitepress/domains.ts`、
`.vitepress/theme/**` 的 `.ts`/`.vue`、以及各领域 `_sidebar.ts`——
**课程 Markdown 不在类型检查范围内**，它由构建期的 Markdown/Vue 编译检查。

两个必须知道的坑：

- `check-file.cjs` 是**章**校验器，对任何领域 `index.md` 都会报"缺 `## 练习`"之类，属**不适用**，不是故障。
  它的篇幅阈值（普通章 11,000–32,000 B、项目章 15,000–60,000 B）与 `_content-plan.md` 写的
  「12–20 KB / 16–28 KB」不一致，两套口径谁为准仍是待决问题。
- `check-links.cjs` **只认以斜杠开头的绝对站内链接**，看不见相对链接，也不校验 `#锚点`。
  它说 OK 不等于全站无死链；真正的死链判定以 `npm run build` 为准（[已实测] 二者本次结论一致）。

## 5. 生产构建

```powershell
npm run build     # [已实测] 退出码 0
```

- 产物目录 `.vitepress/dist/`。依据（读源码，非推测）：
  `node_modules/vitepress/dist/node/chunk-D3CUZ4fa.js` 第 17413 行
  `resolve = (root, file) => path.resolve(root, '.vitepress', file)`、
  第 17434 行未配置 `outDir` 时取 `resolve(root, "dist")`、
  第 17429 行 `srcDir` 默认仓库根。本项目 `config.mts` 未设 `outDir` 与 `srcDir`。
- 构建会做**死链检查**并在发现死链时抛错中止（`throw new Error('N dead link(s) found.')`，
  同一文件 45027 行附近）。本项目未设 `ignoreDeadLinks`，即默认严格模式。
  [已实测] 本次构建 0 死链；上一版文档记录的那条已修。
- 构建是**全有或全无**：第一个编译错误就中止整个过程，产物目录里一个页面都不会更新。
  这条是本次排障中真实遇到的（当时 8 个章文件把 `<template #answer>` 写在 `</Exercise>` 之后，
  报 `[vite:vue] Cannot read properties of undefined (reading 'type')`，全站 0 页产出）。
- 可能出现 `Some chunks are larger than 500 kB after minification.`：来自 VitePress 自带
  客户端运行时与站内搜索索引，不是本站代码，本地站点可忽略。

## 6. 静态站点部署原理（先想清楚再动手）

本站是**多页静态 HTML**，不是由前端接管路由的 SPA。四条判定：

| 判定 | 依据 | 结论 |
| --- | --- | --- |
| 页面 URL 形态 | `config.mts` 显式 `cleanUrls: false` | 每个页面都是真实的 `xxx.html`，链接也带 `.html` |
| 是否需要 `try_files` / rewrite | 上一条 + 无 history 路由 | **不需要**。`try_files $uri $uri/ /index.html;` 对本项目是多余配置 |
| 目录请求（如 `/html/`） | 产物里同时存在 `html/index.html` | 服务器需把目录解析到该目录下的 `index.html`（Nginx 默认 `index index.html;` 即可） |
| 是否需要 Node / 数据库 / 后端 | 产物只有 HTML/CSS/JS/字体/JSON | **不需要**；部署机上不必装 Node |
| 资源路径 | 产物内是站点根绝对路径 `/assets/...` | 必须托管在"站点根"，或改 `base` 后重新构建再放子目录 |

**为什么不能双击 `index.html` 用 `file://` 打开。** [历史实测] 2026-10-16，Chromium 150，
当时的产物：

| 检查项 | `file://` | 静态服务器托管 |
| --- | --- | --- |
| `document.styleSheets.length` | **0**，一张样式都没加载 | 正常 |
| `<script src>` 解析结果 | `file:///D:/assets/app.*.js`，跑到磁盘根 | `/assets/app.*.js` |
| 点开搜索按钮 | **搜索面板不出现** | 正常，中文可搜 |
| 正文文字 | 能看（预渲染 HTML） | 能看 |

原因两层：资源用站点根绝对路径，在 `file://` 下解析到磁盘根；
`app.*.js` 是 `<script type="module">`，浏览器不允许从 `file://` 加载模块。
所以哪怕"只想自己看一天"，也要在本机起一个 HTTP 服务再访问 `http://127.0.0.1:<端口>/`。
（这一组结论本次**未重做**，但成因由配置事实支撑，属可靠结论。）

## 7. 两种交付形态

### 7.1 形态 A：完整源码包（收件人要能改内容并自己构建）

**装什么**：17 个领域目录（218 个 `.md`）、各领域 `_sidebar.ts`、`index.md`、`guide/`、
`docs/`（两篇维护者文档：**在源码包里，但已被 `srcExclude` 挡在公开站点之外**）、
`public/`、`.vitepress/` 下的 `config.mts` + `domains.ts` + `theme/`、
`package.json`、**`package-lock.json`（必须带）**、`tsconfig.json`、`scripts/`、
`README.md`、`_content-plan.md`、`_author-brief.md`、`.gitignore`。
默认**不带** `.scratch/`：它现在同时在 `.gitignore` 里，且 326 个文件里有实测原始输出（含本机路径），
而课程正文点名的证据脚本本来就有 54 条不在磁盘上（清单见
[`docs/project-file-inventory.md`](project-file-inventory.md) 第 8 节）。
只有收件人明确要复核实验时才单独给他。

**不装什么**：`node_modules/`（122 MB）、`.vitepress/cache/`、`.vitepress/dist/`、`learns-site.zip`。

**收件人五步**：

```powershell
# 1. 装 Node 22 或更高（见第 1 节；被证明可用的是 25.4.0）
node -v; npm -v
# 2. 在项目根装依赖            [理论步骤，本次未执行]
npm ci
# 3. 本地阅读                  [已实测]
npm run dev        ->  http://localhost:5173/
# 4. 自检（可选但推荐）        [已实测]
npm run type-check
node scripts/check-links.cjs
# 5. 出产物并在本机验证        [已实测]
npm run build
npm run preview    ->  http://localhost:4173/
```

### 7.2 形态 B：纯静态部署包（只需托管）

**装什么**：`.vitepress/dist/` **整个目录，一个文件都不能少**。发布前清理后（2026-10-22 23:43）
实测构成：223 个 `.html` + 447 个 `.js` + 14 个 `.woff2` + 3 个 `.css` + `hashmap.json`，
共 688 个文件、67,203,366 B。其中 `assets/chunks/@localSearchIndexroot.*.js` 实测 18,301,503 B
（约占产物 27%），**它决定站内搜索能否用**——离线中文索引在构建时打进产物，
所以纯静态托管不联网也能搜中文。`examples/` 是 `public/` 的原样拷贝，别丢。
（同日清理前那次构建是 224 html / 449 js / 67,357,141 B，差额就是被移出构建的那篇维护文档
与它的 `.js` + `.lean.js`。）

**部署侧不需要 Node.js、不需要 npm、不需要依赖、不需要数据库。** 这是由产物文件类型
清点证实的结论，不是推测——因此**不要**为了"部署一个静态站"而去装开发依赖。

**怎么确认产物不是过期的**（这一步比打包本身重要）：

1. 比时间：`dist/index.html` 的 mtime 必须**不早于**任何一章 `.md` 的 mtime。
   本仓库**不是 Git 仓库**，mtime 是唯一可用依据。
   本轮实测：`dist/index.html` 为 23:43:47，最新的章文件是 `linux/users-and-permissions.md`
   （23:34:05）与 `guide/how-to-use.md`（23:34:48），都早于构建 ✓。
   两条**只在不发布范围里**的文件（`docs/` 两篇、`README.md`）写在构建之后，
   不影响产物——它们本来就不进构建，所以本轮改文档之后**不需要**再构建一次。
   这条已用 `find . -newer .vitepress/dist/index.html`（排除 `node_modules/`、`.vitepress/`、
   任意 `.scratch/`）逐文件核对：结果只有 `docs/deployment.md`、`docs/project-file-inventory.md`、
   `README.md` 三个，**没有任何一章 `.md` 比产物新**——这才是"当前产物对应当前课程内容"的直接证据。
2. 比数量：`find .vitepress/dist -name '*.html' | wc -l` 应等于页面数 + 2。
   本轮 223 = 221 + 2。[已实测]
3. 比内容：抽**最后写完的那一章**，确认它的 `.html` 在 `dist` 对应路径存在。只看首页不够。
   本轮实测：`linux/users-and-permissions.html`、`linux/command-line.html` 都在且 mtime 为 23:43:49，
   页面上直接 `curl` 取回的内容里占位值命中 3/2/5 次、真实值 0 次。
4. 比时间戳的例外（本轮新增判据）：产物里 mtime 早于构建的文件**只允许**是 `public/` 的拷贝。
   本轮实测只有 `examples/html-archive/index.html` 与 `style.css` 两个，且与 `public/` 源文件
   `cmp` 逐字节相同——是拷贝时间戳，不是过期内容。

仓库里现存的 `learns-site.zip`（2,420,059 B，mtime 2026-10-16）与 10-16/10-17 的旧 `dist/`
**都不含后来写完的章节**，不能作为交付物；本轮**不生成 ZIP**，也不复制/删除它们。

## 8. Windows 本机验证与局域网阅读

### 8.1 本机验证构建产物

最省事的一条，也是本次用过的一条：

```powershell
npm run preview    # [已实测] 上一轮 4173、本轮 4178，都返回"Built site served"
```

想换端口：`npm run preview -- --port 8080`。**本轮已实测**：`npm run preview -- --host 127.0.0.1 --port 4178`
起服务后 `--host` **没有把监听面收窄**，`netstat` 显示它仍听在 `0.0.0.0:4178` 与 `[::]:4178`——
所以本机验证时不要以为加了 `--host` 就只对本机开放，验完立刻停进程并用 `netstat` 复查（本轮停完后
4178/4173/5173 三个端口的 LISTENING 数为 0）。

**不启动常驻服务**时，也可以用 Node 现场发一次请求（上一轮验证用的就是这个形态）：
在项目根新建一个 `.cjs` 脚本，用 `http.get` 遍历路由清单、断言状态码 200，
跑完就退出，不留后台进程。[已实测：上一轮以这种方式确认 222 条路由在 dev 与 preview 上都返回 200；
本轮改用 `curl` 抽 12 条断言（9 条 200 + 3 条 404），没有重做全量扫描]

验证至少覆盖这五项，缺一不可：

| 检查 | 怎么看 | 本次状态 |
| --- | --- | --- |
| 首页能开 | 浏览器访问 `/` | [已实测] HTTP 200 |
| 任意一章能开 | 从侧边栏点进去，URL 带 `.html` | [已实测] 上一轮 222 条路由逐一 200；本轮当前路由集 221 条，只抽了 6 个页面 + 首页复验 200，**全量重扫未做** |
| 维护文档不出现在公开站点 | `curl /docs/deployment.html` 应为 404 | [已实测] 本轮 `.html` 形式与无扩展名形式共 3 条全 404，`dist/docs/` 目录不存在 |
| 刷新不 404 | 在章节页按 F5 | [已实测] 产物是真实 `.html` 文件，成立 |
| 站内搜索出中文结果 | 点搜索框输入中文 | **未做人工验收**（索引已在产物里，机制成立；交互未测） |
| 样式与暗色模式 | 切换深色 | **未做人工验收** |

### 8.2 怎么区分"构建失败"和"页面访问失败"

这一步走错会白修半天。判据：

| 现象 | 属于哪一类 | 先看哪里 |
| --- | --- | --- |
| `npm run build` 抛错、退出码非 0 | **构建失败** | 看报错点名的文件与行；`dead link(s) found` → 链接问题；`[vite:vue] ... reading 'type'` → 组件标签/插槽位置问题 |
| 构建成功，但 `dist` 里没有你要的那页 | 构建失败的一种（全有或全无：有错误时是 0 页；个别页缺通常是该 `.md` 被 `srcExclude` 排除，或以 `.`/`_` 开头） | 对照 `config.mts` 的 `srcExclude`；查文件名与目录。**注意现在有一类"故意缺"**：`docs/deployment.md` 与 `docs/project-file-inventory.md` 被排除是发布边界，不是故障——课程页面里没有任何一条链接指向它们（本轮逐文件核过：只有 `README.md` 和这两篇自己相互引用） |
| 构建成功、产物在，本机 `preview` 打不开某一页 | **访问失败**（路径解析） | 该 `.html` 是否真在产物里；服务器有没有把目录解析到 `index.html` |
| 页面全打开、样式全无、搜索按钮无反应 | **不是路径问题**，是用 `file://` 打开了 | 第 6 节那张表 |
| 页面能开、样式在、但一堆资源 404 | **部署位置与 `base` 不匹配** | 第 10.3 节 |
| 页面能开、内容对，但某个页内链接 404 | **页内链接或锚点问题** | 链接是否写成绝对站内路径；锚点是否在目标页真实存在 |

**只有构建通过，才值得去查服务器。**

### 8.3 局域网其他设备阅读（含机顶盒最短路径）

产物已在 `.vitepress/dist/`，接下来要的是一个静态 HTTP 服务。**三选一，都不需要 Node：**

```bash
# A. Python（若本机已装 Python）——只监听本机
cd .vitepress/dist && python -m http.server 8080 --bind 127.0.0.1   # [理论步骤，本次未执行]

# B. 任意"解压即用"的静态托管面板（宝塔 / Nginx / Caddy 等），把站点根指到 dist

# C. 装了依赖的机器上，用构建链自带的预览服务（需要 Node）
npm run preview -- --port 8080     # [已实测该命令本身可用；未做局域网跨设备验证]
```

给局域网其他设备用时：把 `--bind 127.0.0.1` 换成 `0.0.0.0`（或去掉 `--bind`），
用 `ipconfig`（Windows）查本机局域网地址，设备访问 `http://<本机局域网IP>:8080/`。

**机顶盒上的最短路径**（本次**未在真实机顶盒上验证过**，属理论步骤）：
机顶盒与电脑连**同一个 Wi-Fi/路由器**，用方案 A 或 B 把 `dist` 以 `0.0.0.0` 起服务，
机顶盒浏览器里输入 `http://<电脑局域网IP>:8080/`。三个常见拦路点：
① Windows 防火墙没放行该端口的**入站**规则（专用网络也要放行）；
② 路由器开了**AP 隔离 / 客户端隔离**，设备之间不能互访；
③ 机顶盒浏览器内核过旧，能加载但 CSS/JS 特性不支持——此时表现为"有文字没样式"，
   与 `file://` 的症状相似但成因不同，要用"资源是否真的返回 200"来区分。
**关掉电脑上的 `npm run dev`，不要用 `--host` 暴露开发服务器来给机顶盒看。**

## 9. 本机 / 单机自用的边界

只想自己看：`npm run build` 一次，然后 `npm run preview`，或把 `dist` 交给一个常驻静态服务。
**不要**把 `.vitepress/dist/` 里的文件当成"源码"去改——它是输出，重新构建就没了。

## 10. 放到 Linux VPS（Nginx）

本节**全部为理论步骤，本次未在任何服务器上执行**（本次未部署、未登录任何远程机器）。
它给的是原理和必要动作，不是"照做必成"的操作记录。

### 10.1 先搞清这台机器上 Nginx 的真实站点根

不要照抄网上的 `/var/www/html`：

```bash
nginx -T 2>/dev/null | grep -E '^\s*(root|server_name)\s' | head   # [理论步骤]
ps -o user= -C nginx | sort -u      # worker 跑在哪个用户下          [理论步骤]
```

### 10.2 放文件与权限

```bash
mkdir -p /var/www/html/learns
# 把形态 B（dist 里的内容）传上来后解压到该目录
chmod -R a+rX /var/www/html/learns        # [理论步骤]
```

`a+rX` 的含义：给所有人读位，且只给目录（或已有执行位的文件）加执行位——
目录缺执行位时 Nginx 进不去，会报 403/404。传输方式（`scp` / `rsync` / 上传压缩包再 `unzip`）
由你的机器决定，本站不依赖其中任何一种。

### 10.3 站点根部署的配置

```nginx
server {
    listen 80;
    server_name <你的域名或_IP>;

    root  /var/www/html/learns;    # 换成你放产物的目录
    index index.html;

    # 不需要 try_files：产物是真实 .html 文件，按路径就能命中

    location ~* \.(js|css|json|svg|png|jpg|jpeg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }
}
```

改配置后 `nginx -t && nginx -s reload`；**只替换静态文件不需要 reload**。

### 10.4 子目录部署（例如 `http://内网IP/learns/`）

本项目 `config.mts` **没有设置 `base`**，产物里的资源按站点根绝对路径生成。放子目录时二选一：

- **做法 1（推荐）**：在 `config.mts` 里加 `base: '/learns/'` 后**重新构建**，
  产物内 `/assets/...`、`/html/xxx.html` 都变成 `/learns/...`。这是 VitePress 官方给出的
  子目录部署标准做法，只改一处配置。[理论步骤，本次未实测]
- 做法 2（不推荐）：用 `location /learns/ { alias ...; }` 硬凑。`alias` 与绝对资源路径组合
  极易出错，且改了 `base` 不重构建的话资源仍然指向站点根 → 一堆 404。

**改了 `base` 就必须重新构建**，否则产物里的路径前缀和服务器上的位置不一致。

### 10.5 容器方式（可选，不是前提）

```dockerfile
FROM nginx:stable-alpine
COPY .vitepress/dist/ /usr/share/nginx/html/
```

```bash
docker run -d --restart unless-stopped -p 127.0.0.1:8080:80 <镜像名>
```

再由宿主机已有的 Nginx 反代到 `127.0.0.1:8080`，TLS 只在宿主那层处理。
**本项目从未构建过该镜像**，属通用写法示意。

### 10.6 外网暴露的建议

优先走内网穿透（Tailscale / ZeroTier 一类）而不是把 80/443 直接开到公网。
本项目没有登录、没有用户系统、没有后端接口，公开的内容就是课程文本本身——
静态包会把正文原样带上线，**所以正文里的隐私就是站点上的隐私**。
第 12 节那批隐私项**已在 2026-10-22 处理完并重新构建验证**（见该节末尾的本轮结论）。

## 11. 免费静态托管平台（通用流程）

**本次未在任何平台部署过，且没有指定平台**——所以这里只写与平台无关的流程，
不写任何具体平台的控制台步骤。

本站**满足纯静态托管的前提**：无后端、无运行时、无重写规则、无环境变量。
因此通用流程是：

1. 本地 `npm run build` 拿到形态 B。
2. 选一个支持"静态站点 / 对象存储托管"的平台，新建站点，把**构建输出目录**指定为
   `.vitepress/dist`（若平台要求"根目录"，就是 `dist` 里的内容作为根）。
3. **入口文档**设为 `index.html`；确认平台会把 `/html/` 这类目录请求解析到该目录的 `index.html`
   （多数平台叫 "subdirectory index"/"directory listing" 设置，名称各异）。
4. **不要**配置 SPA 重写（把 404 改写成 `/index.html`）——本站不需要，配上会掩盖真实死链。
5. 站点根部署：`base` 保持不设（本项目当前就没设）。若平台给你的站点放在子路径下，
   必须回到第 10.4 节改 `base` 并重新构建。
6. HTTPS 由平台提供；本站产物不含任何需要后端的跳转逻辑。

**平台特异的**只有这几项：构建命令与输出目录怎么填、是否需要先把仓库推到它的 Git 上、
自定义域名与证书怎么绑、缓存失效（clear cache）在哪里点、以及免费额度对**产物体积**的限制
——本次实测 `dist` 为 66 MB、其中搜索索引 18.3 MB，若平台单文件上限低于 18 MB，
**这个索引文件会传不上去**，表现为站内搜索失效而其它页面正常。这一条**未在任何平台实测**，
但它是可以从产物尺寸直接推出的风险。

**不要因为某个平台"部署向导"里写了 Node/框架，就去装开发依赖**——交付物是静态文件。

## 12. 更新、备份与回滚

日常更新（内容改了，重建产物）：

1. 改 Markdown。规范见 `_content-plan.md` 第二节；新章要在该领域 `_sidebar.ts` 加一条，
   并在上一章的 `## 下一章` 接上链接。
2. 跑只读校验（第 4 节四条命令）。**这一步比构建便宜，先跑它。**
3. `npm run build`。[已实测可成功；一旦报错就按第 8.2 节定位，别去动服务器]
4. **备份旧目录再覆盖**：`mv learns learns.bak && cp -a <新dist> learns`。[理论步骤]
5. 把新 `dist/` 覆盖到目标目录。纯静态文件替换**不需要** `nginx -s reload`。
6. 回滚 = 把备份换回去。因为产物是纯文件，回滚没有依赖、没有数据库迁移、没有进程重启。
7. 验证四条：入口页能开、任意一章能开、刷新不 404、资源没有 404。
   浏览器里的交互项（搜索、暗色、移动端）本次仍未做人工验收。

**公开前的隐私处理**（2026-10-22 分两步做完：先只清点，再按清点结果替换）：
少量章正文带着编写环境的真实账户名/邮箱/绝对路径，涉及 14 个章文件——除了最初点名的
`devops/git-basics.md`、`javascript/modules-and-iterators.md`、`linux/command-line.md`、
`linux/users-and-permissions.md`，同一批字符串还在
`devops/git-collaboration.md`（正文里直接写了作者名）、`javascript/errors-and-debugging.md`、
`backend/error-handling.md`、`backend/node-runtime.md`、`css/selectors.md`、
`typescript/` 三章、`frontend-engineering/vite-build.md`、`html/links.md` 里出现过。
共 **41 处替换**，只替换字符串本身：账户名 → `learner`，邮箱 → `learner@example.com`，
姓名 → `Learner`，项目目录前缀 → `D:\work\learns`，Git/Node 安装目录 → 通用形式。
逐文件路径、风险类型与替换前后对照写在
[`docs/project-file-inventory.md`](project-file-inventory.md) 第 10 节。
**正确顺序是：改正文 → 重新构建 → 才谈部署**，而不是手工去改 `dist` 里的 HTML——本轮就是这么走的。

本轮实测的两条补充结论：
① 重新构建后，`dist/` 全目录对六个真实值 **0 命中**，阳性对照（占位值命中 4/17/5 个文件，
其中 `learner` 在搜索索引 chunk 里作为一个 term 存在）证明这条 grep 不是空跑；
② 上一版本节说「隐私值被编进站内搜索索引 chunk」这句**在单 token 层面成立，但要说清边界**：
本地搜索索引 chunk 是 MiniSearch 的倒排表（实测 `documentCount: 3290`，字段为
`title` / `headers` / `text`，`text` 说明**代码块里的文本也被索引**，
`fakebin`、`197609`、`learner` 都作为 term 出现）。索引存的是**切好的 term**，不是原文——
所以带分隔符的整串（`learner@example.com`、`D:\work\learns`）不会以整串形式进索引，
会被切成 `learner`/`example`/`com`、`d`/`work`/`learns`。
这条边界界定了本节扫描的可信范围：对**单 token** 的真实值（账户名、姓名）grep 整个 `dist/` 可靠；
对**整串形式**的路径与邮箱，可靠的是页面 `.html` 与每页 `.js` chunk 那两类文件（本轮两类都扫了）。

`.scratch/` 下的证据输出文件同样带本机路径，但**不改写证据文件**——
改了证据就不可信；做法是不公开 `.scratch/`（2026-10-22 已写进 `.gitignore`）。
**仍需人工确认的两项**（本轮按"不确定就不改"保留原样）：
`backend/error-handling.md` 与 `backend/logging-and-monitoring.md` 里反复出现的
`10.244.3.17`（私有网段，形如容器/CNI 默认地址，出现在实测报错原文与脱敏示例里），
以及 `logging-and-monitoring.md` 示例日志中的 DSN 用户名片段。
它们不指向可识别的个人，但无法自证不是真实内网地址，公开前值得你确认一眼。

## 13. 部署相关常见问题

| 现象 | 先查这里 | 判据 |
| --- | --- | --- |
| 打开是纯文字、没样式 | 是不是用了 `file://` | 第 6 节那张表 [历史实测] |
| 样式在但一堆资源 404 | 站点根与 `base` 是否匹配 | 产物里资源是 `/assets/...`；放进子目录却没设 `base` 就全 404（第 10.4 节） |
| 刷新某页 404 | 该 `.html` 是否真在产物里；`root` 是否指对 | 本站不需要 `try_files`，加它也不解决"文件本来就不在" |
| 403 Forbidden | 目录缺执行位或属主不可读 | `chmod -R a+rX`（第 10.2 节，未实测） |
| 更新了但看到的还是旧内容 | 入口 `index.html` 被缓存 | 给 `= /index.html` 加 `no-cache`（第 10.3 节，未实测） |
| `npm run build` 抛 `dead link(s) found` | 看报错点名的文件与链接 | 改正链接写法；**不要**用 `ignoreDeadLinks: true` 关掉全站检查（第 5 节） |
| 构建抛 `[vite:vue] Cannot read properties of undefined (reading 'type')` | `<template #answer>` 是否被写在 `</Exercise>` **之后** | 正确顺序：题干 → `<template #answer>` 答案 → `</Exercise>`；本站已按此修复，别再写反 |
| 站内搜索框搜不到中文 | 是否纯静态托管（索引随构建进产物） | 索引在 `assets/chunks/@localSearchIndex*`，离线可用；分词是非重叠二元组，**对错别字无容错** [历史实测] |
| 搜索整块失效但其它页面正常 | 搜索索引 chunk 是否上传成功 / 是否超过平台上限 | 第 11 节体积风险（未在任何平台实测） |
| 目录链接在 dev 打不开 | dev 的 SPA 兜底与构建产物行为不同 | 第 3 节；以 `npm run build` + `preview` 为准 |
| 首页/导航里缺一个领域 | `.vitepress/domains.ts` 是否加了条目、`_sidebar.ts` 是否挂进 `config.mts` | 新增领域要动四处，见 `README.md` 第四节 |

## 14. 本文件的核实状态一览

| 结论 | 状态 | 依据 |
| --- | --- | --- |
| `npm run build` 成功、`npm run type-check` 零错误 | **[已实测]** 2026-10-22 发布前清理后重跑 | 退出码 0（120.60 s）；type-check 无诊断输出；产物 223 个 `.html`（清理前那轮是 224） |
| dev 5173（222 条无扩展名路由）/ preview 4173（222 条构建路由，目录两种形式都测）**全部 HTTP 200** | **[已实测]** 清理前那轮（同日 22:19–22:26）；**清理后未重跑全量**，本轮只抽 12 条 | 逐路由状态码断言，非 200 计数为 0；本轮抽查记录在第 0 节表 |
| 产物 DOM 层面：694 个练习卡片内 694 个答案体、0 个占位 | **[已实测]** 本次 | 逐文件统计构建产物正文 |
| 目录形式链接（`/vue/`）在其它静态宿主上能否解析 | **未验证** | 本次只在 `vitepress preview` 上测得 200（第 3 节） |
| 上一版本文档的"1 个已知构建中止点" | **已过期并修正** | 该死链已改为行内代码，构建通过；未使用 `ignoreDeadLinks` |
| 产物是纯静态、部署机不需要 Node | 已由配置 + 产物类型逐扩展名清点证实 | 447 js / 223 html / 14 woff2 / 3 css / 1 json = 688 个文件，无其它类型 |
| 不需要 `try_files` 回退 | 已由配置证实（`cleanUrls: false`） | `.vitepress/config.mts` |
| 站内搜索索引 18.3 MB、约占产物 27% | **[已实测]** 清理后重建的产物逐文件测得 | `dist/assets/chunks/@localSearchIndexroot.CEYQLijG.js` = 18,301,503 B（清理前那次构建是 18,342,196 B） |
| 未设 `base`，子目录部署需改 `base` 后重建 | 配置事实 + 官方标准做法；**[理论步骤]** | `config.mts` 中无 `base` 字段 |
| `npm ci` / `npm install` 在全新机器上的表现 | **[理论步骤]**，本次未执行任何安装 | 本机依赖早已存在 |
| `file://` 不可用、搜索离线索引位置、分词容错行为 | **[历史实测]** 2026-10-16 当时的产物，本次未重做 | `README.md` 第十二节的边界说明 |
| Nginx 配置片段、Docker 镜像、权限与更新命令 | **[理论步骤]**，本次未在任何服务器执行 | 第 10、12 节通篇标注 |
| 免费静态托管平台流程 | **[理论步骤]**，未在任何平台部署、未指定平台 | 第 11 节 |
| 机顶盒 / 局域网跨设备访问 | **未实测** | 第 8.3 节三个拦路点为通用排查项 |
| 浏览器人工验收（导航、搜索、暗色、移动端、示例页） | **未做** | 本次未做人工交互验收 |
| 隐私项清点 | 已完成，**只报告未修改** | 第 12 节 + 文件清单第 10 节 |
