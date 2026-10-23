# 项目文件分类清单

本文件回答四件事：**每一类文件是干什么的**、**哪些必须保留**、**哪些不需要发布**、
**两种交付包各自应该装什么**。它是根目录 `README.md` 第四节「目录结构」的展开版，
与 [`docs/deployment.md`](deployment.md) 配套：那一份讲「怎么跑起来、怎么部署」，
本一份讲「哪些文件属于哪一种命运」。

> **本文件不构建成公开页面**（2026-10-22 发布前清理时确立）。`.vitepress/config.mts` 的
> `srcExclude` 现在除 `README.md`、`TASK-HANDOFF.md`、`scripts/**`、`**/_*.md` 外，
> 还逐文件列出了 `docs/deployment.md` 与 `docs/project-file-inventory.md`，
> 所以本文件与 deployment 同属**维护者文档**：随源码包保留，不进站点、不进搜索索引。
> 两者互相引用用的是**同目录相对链接**（href 写 `deployment.md` / `project-file-inventory.md`，
> 链接文字仍写全路径 `docs/…`），在源码里可点、在站点里不存在，符合预期。
> 早期版本两篇都按仓库根写法 `docs/xxx` 互链，从 `docs/` 目录解析会得到 `docs/docs/xxx`，
> 点不开；`scripts/check-links.cjs` 不检查相对链接所以一直没报——本轮逐条 `fs.existsSync` 核对后改正。
> 文中凡指向**未构建成页面**的文件（`README.md`、`TASK-HANDOFF.md`、`scripts/**`、
> 任何 `.scratch/` 路径）一律写成行内代码，不写成链接。
> 学习者需要的开机步骤写在公开页 `guide/how-to-use.md`，不依赖本文。

> **清点时间与方法**：2026-10-22（同日发布前清理后复核）。字节数用 `find -printf '%s'` 逐项累加，
> 文件存在性用 `fs.statSync` 实测；`.scratch` 引用关系用只读脚本
> `.scratch/scratch-census.cjs` 扫描全仓库（`node_modules/` 与 `.git` 除外）后
> **按引用所在目录解析相对路径**得出。隐私复扫用 `.scratch/final-rescan.cjs`
> （只输出类别、文件路径与命中次数，不回显被匹配的值）。
> 所有数字都是本次实测，不是估算。

---

## 1. 判定口径

下表的六个标记列含义固定：

| 列 | 含义 |
| --- | --- |
| 开发 | 缺了它，`npm run dev` 能否正常出本站页面 |
| 构建 | 缺了它，`npm run build` 能否产出完整站点 |
| 源码包 | 是否属于「完整源码包」——收件人要能改内容并自己构建 |
| 静态包 | 是否属于「纯静态部署包」——只需托管、不需要构建 |
| 公开 | 直接公开发布是否合适（含隐私与体积考量） |
| 可删 | 现在删除是否安全；「需确认」表示要先做文中指定的检查 |

标记用「是 / 否 / 需确认」三种。**「否」在开发列不等于可以删**——它只说明该文件不参与页面渲染。

本次实测的顶层体积基线（用于判断「进不进包」的代价）：

| 目录或文件 | 体积 | 说明 |
| --- | --- | --- |
| `node_modules/` | 122 MB | 依赖本体，永远不进任何交付包 |
| `.vitepress/dist/` | 67,203,366 B / 688 个文件 | 当前构建产物（2026-10-22 23:43 清理后重建），静态包的全部内容 |
| `.vitepress/cache/` | 2,883,776 B | 只有 `deps/` 一个子目录 |
| 各领域 `.scratch/`（10 个） | 9,317,653 B（325 个文件，口径见第 8 节） | 见第 8 节专项分类 |
| 根 `.scratch/` | 189,782 B（25 个文件，无子目录） | 全是排查、清点与隐私清理工具及其运行输出，见第 8 节 |
| `learns-site.zip` | 2,420,059 B | 2026-10-16 的历史产物，见第 9 节 |
| 全部课程 Markdown（218 个） | 见第 3 节 | 源码包主体 |

---

## 2. A 类：必须保留的源码与课程文件

删掉任何一项，站点就少一批页面。这一类是交付的核心资产。

| 路径 | 作用 | 开发 | 构建 | 源码包 | 静态包 | 公开 | 可删 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `index.md` | 首页，1,928 B，渲染领域卡片 | 是 | 是 | 是 | 否 | 是 | 否 |
| `html/` `css/` `javascript/` `typescript/` `vue/` `react/` `frontend-engineering/` `backend/` `database/` `data-storage/` `message-queue-cloud/` `linux/` `devops/` `computer-science/` `realtime/` `ai-apps/` `mobile/` | 17 个领域目录：201 个章正文 + 17 个领域首页 = 218 个 `.md`（`*.md` 逐目录计数实测） | 是 | 是 | 是 | 否 | 是 | 否 |
| 各领域 `_sidebar.ts`（17 个） | 该领域侧边栏条目，被 `config.mts` 按路径前缀拼装 | 是 | 是 | 是 | 否 | 是 | 否 |
| `.vitepress/config.mts` | 站点配置：导航、侧边栏、中文搜索分词、`cleanUrls: false`、`srcExclude`（10,632 B，2026-10-22 发布前清理时只加了 `srcExclude` 两条逐文件排除） | 是 | 是 | 是 | 否 | 是 | 否 |
| `.vitepress/domains.ts` | 17 个领域的唯一数据源（名称/分组/分期/状态），导航与首页由它派生（11,716 B） | 是 | 是 | 是 | 否 | 是 | 否 |
| `.vitepress/theme/index.ts` | 主题入口，注册 5 个全局组件（775 B） | 是 | 是 | 是 | 否 | 是 | 否 |
| `.vitepress/theme/style.css` | 全站样式覆盖（3,977 B） | 是 | 是 | 是 | 是\* | 是 | 否 |
| `.vitepress/theme/components/*.vue`（5 个） | `Callout` / `Exercise` / `RoadmapTable` / `StatusBadge` / `HomeDomains`；正文里用了这些标签，缺一个就构建失败 | 是 | 是 | 是 | 否 | 是 | 否 |
| `public/examples/html-archive/`（2 个文件，22,064 B） | HTML 阶段项目的参考实现，构建时原样拷进产物 | 是 | 是 | 是 | 是 | 需确认 | 否 |
| `guide/how-to-use.md` `guide/roadmap.md` | 使用说明与学习路线两个页面 | 是 | 是 | 是 | 否 | 是 | 否 |
| `docs/deployment.md`、`docs/project-file-inventory.md` | 部署说明与本清单，**已被 `srcExclude` 逐文件排除，不构建成页面** | 是 | **否** | 是 | 否 | 仅源码仓库，不进站点 | 否 |
| `_content-plan.md`（21,491 B）、`_author-brief.md`（7,639 B） | 章节规划与写作规范；被 `**/_*.md` 排除，不成为页面，但 `scripts/` 生成器读它。`_author-brief.md` 内有 1 处本机项目绝对路径（复扫命中，见第 10 节） | 否 | 否 | 是 | 否 | 需确认 | 否 |
| `scripts/`（7 个 `.cjs`） | 校验与生成脚本，见第 5 节 | 否 | 否 | 是 | 否 | 是 | 否 |

\* `style.css` 的**内容**以哈希文件的形式进入静态包（`dist/assets/*.css`），但收件人拿到的
静态包里没有 `.vitepress/` 目录——这一列指的是「交付包中是否需要单独保留它」。

**公开列的「需确认」是什么**：`_content-plan.md` 与 `_author-brief.md` 里含本站内部的
分期安排与章数口径，公开本身无害，但它们不属于课程内容，公开发布会稀释站点定位；
`_author-brief.md` 另有 1 处**本机项目目录的绝对路径**（写作盘符 + `Project` + 仓库名的形式）。
`public/examples/html-archive/` 是教学参考实现，公开无害；
`docs/` 两篇已从站点页面集合里排除，**只随源码仓库存在**，学习者不会在导航或站内搜索里看到它们。
**本轮未对这两个 `_*.md` 做任何改动**——「是否随源码公开」是产品决定，不是技术故障；
若要排除，最小动作是在 `.gitignore` 里再加两行，而不是删文件或改内容。

---

## 3. 课程 Markdown 的真实分布（逐目录实测）

`.md` 文件数含该目录下的 `index.md`；`_sidebar.ts` 不计入。

| 领域 | `.md` 数 | 领域 | `.md` 数 |
| --- | --- | --- | --- |
| html | 11 | database | 14 |
| css | 13 | data-storage | 15 |
| javascript | 13 | message-queue-cloud | 15 |
| typescript | 13 | linux | 11 |
| vue | 13 | devops | 11 |
| react | 13 | computer-science | 13 |
| frontend-engineering | 13 | realtime | 12 |
| backend | 16 | ai-apps | 12 |
| | | mobile | 10 |

17 个领域合计 218 个 `.md` = 201 个章正文 + 17 个领域首页。加上根 `index.md`、
`guide/` 2 个，构成构建页面集合 = **221 个页面**；`docs/` 两篇已被 `srcExclude` 排除，**不再计入**。
2026-10-22 清理后重新构建实测：`dist` 内 223 个 `.html` = 221 个页面 + `404.html` +
`examples/html-archive/index.html`，且 `dist/docs/` 目录不存在（实测 `ls` 报无此目录）；
本地 preview 下三个维护文档 URL 均返回 404，逐项记录写在 [`docs/deployment.md`](deployment.md)。

---

## 4. B 类：配置、依赖清单与锁文件

| 路径 | 作用 | 开发 | 构建 | 源码包 | 静态包 | 公开 | 可删 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `package.json`（446 B） | 声明 4 条脚本与 3 个 devDependencies；**无 `dependencies`、无 `engines`** | 是 | 是 | 是 | 否 | 是 | 否 |
| `package-lock.json`（92,654 B） | `lockfileVersion` 3，185 个 `packages` 条目，逐条带 `integrity`——收件人 `npm ci` 复现同一套版本的唯一依据 | 否 | 否 | **是（必须）** | 否 | 是 | 否 |
| `tsconfig.json`（706 B） | 只把 `config.mts`、`domains.ts`、`theme/**` 与 `*/_sidebar.ts` 纳入类型检查；课程 Markdown 不在范围内 | 否 | 否 | 是 | 否 | 是 | **否**——`npm run type-check` 的命令串显式写了 `-p tsconfig.json`，删掉它这条脚本直接失败 |
| `.gitignore`（767 B） | 版本控制忽略规则；**本仓库已是 Git 仓库（2026-10-23 更正，见第 9 节），该文件已生效**，按第 9 节补的 3 条发布边界规则正在起作用 | 否 | 否 | 是 | 否 | 是 | **否**——删了不影响开发与构建，但 `node_modules/`（122 MB）与 `dist/`（66 MB）立刻会进入提交范围 |

`npm ci` 与 `npm install` 的区别只在交付语境里成立：有锁文件时 `npm ci` 严格按锁安装，
`npm install` 可能把范围依赖（`typescript`、`vue-tsc` 都带 `^`）升到新版本。
本项目已知的一个真实不兼容就是升级造成的——TypeScript 升到 7.x 会让 `vue-tsc@3.3.13`
崩在 `ERR_PACKAGE_PATH_NOT_EXPORTED: './lib/tsc'`（详见 `README.md` 第三节）。
**所以锁文件属于「必须进源码包」，不是可选。**

---

## 5. C 类：可选的检查脚本、维护文档与开发辅助

这一类缺失不影响页面，但影响「改完之后还能不能自查」。

| 路径 | 作用 | 会不会写文件 | 源码包 | 可删 |
| --- | --- | --- | --- | --- |
| `scripts/check-file.cjs`（7,767 B） | 单篇结构校验：禁 frontmatter、单 H1、围栏语言白名单、插值起始符、组件标签空行、小节顺序、链接目标存在性、篇幅上下限 | 否，只读 | 是 | 需确认 |
| `scripts/check-links.cjs`（2,902 B） | 站内**绝对路径** Markdown 链接的死链检查，含 `_sidebar.ts`；盲区：看不见相对链接、不校验 `#锚点`，且它自带一份硬编码 `SRC_EXCLUDE = ['README.md','TASK-HANDOFF.md']`，**不知道** `config.mts` 里新增的两条 `docs/` 排除——所以它报的「241 page targets」**不能当公开页面数用**（本轮实际公开页 221，见第 3 节） | 否，只读 | 是 | 需确认 |
| `scripts/scan-braces.cjs`（1,244 B） | 全站扫描连续左花括号的插值起始符——这是会让构建崩掉的致命项 | 否，只读 | 是 | 需确认 |
| `scripts/status.cjs`（2,378 B） | 按 `_content-plan.md` 的规划表统计进度；只数表里的 187 行 | 否，只读 | 是 | 需确认 |
| `scripts/gen-sidebar.cjs`（3,280 B） | 从规划表 + 磁盘存在性重新生成 `领域/_sidebar.ts`；**幂等，只登记真实存在的文件** | **是** | 是 | 需确认 |
| `scripts/sync-index-links.cjs`（2,101 B） | 把规划表每一行变成首页链接 | **是** | 是 | 需确认 |
| `scripts/sync-meta.cjs`（3,964 B） | 同步领域首页 `<StatusBadge>` 与 `domains.ts` 的 `status`/`statusNote`，支持 `--dry` | **是** | 是 | 需确认 |
| `docs/deployment.md`、本文件 | 部署与交付的**维护者文档**，2026-10-22 起被 `srcExclude` 逐文件排除，**不再构建成站点页面**；文件本身保留 | — | 是 | 否 |
| `README.md`（37,477 B） | 项目说明；被 `srcExclude` 排除，**不会**成为站点页面 | — | 是 | 否 |
| `TASK-HANDOFF.md`（21,382 B，mtime 2026-10-17） | 上一轮写作交接记录，内容已大量过期；被 `srcExclude` 排除，2026-10-22 起**同时列入 `.gitignore`**（不删文件，只声明不进版本库） | — | 需确认 | 需确认 |

**C 类"可删 = 需确认"的统一检查**：这些脚本不参与构建，删掉不会让站点出错，
所以技术上"可删"。但删除前的必要检查是——**本站正在依赖它的三个事实是否还有别的来源**：
`check-links.cjs` 是本次「no dead internal links」结论的唯一可重复工具；
`scan-braces.cjs` 是唯一能在构建前发现插值致命项的工具；
`status.cjs` 与 `check-file.cjs` 是章进度与单篇结构的唯一口径。
`gen-sidebar.cjs` / `sync-index-links.cjs` / `sync-meta.cjs` 是**生成器**：
删了它们，17 个 `_sidebar.ts` 与首页链接就只能手工维护。
**因此本轮的结论是"保留"，而不是"可选"。**

三条必须写进操作规程的事实（本次逐一读过脚本源码）：

1. **`sync-index-links.cjs` 会链接规划表里的每一行，不检查章文件是否存在**。
   在未写完的领域上运行它，会凭空多出指向不存在页面的链接，进而让构建因死链中止。
   运行前必须先读它会改什么，运行后逐条核对差异。
2. **`sync-meta.cjs` 只在计算出的状态与现有状态不同时才改写**。
   `partial → partial` 的章数变化不会触发它，领域首页的 `note` 与 `domains.ts` 的
   `statusNote` 要手工同步；`--all` 会覆盖其他领域手工写的 `statusNote`。
3. **三个只读校验脚本的口径与 `_content-plan.md` 不一致**：规划写「普通章 12–20 KB」，
   `check-file.cjs` 实际按 11,000–32,000 B（理想 14,000–30,000）、项目章 15,000–60,000 B 判定。
   以脚本为准还是以规划为准是一个**待决问题**，本轮不改规范文件。

`check-file.cjs` 是**章**校验器，对任何领域 `index.md` 都会报「缺 `## 练习`」之类——
那是「不适用」，不是故障。

---

## 6. D 类：安装依赖生成的目录

| 路径 | 作用 | 开发 | 构建 | 源码包 | 静态包 | 公开 | 可删 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `node_modules/`（122 MB，顶层 69 个条目） | `vitepress` 1.6.4 / `typescript` 5.9.3 / `vue-tsc` 3.3.13 及其传递依赖（`vite` 5.4.21、`vue` 3.5.44、`minisearch` 7.2.0） | 是 | 是 | **否** | **否** | **否** | 是，删除前检查：`package-lock.json` 在，且收件环境能访问 npm registry；删后需 `npm ci` 才能再构建 |

要点只有两个：**它绝不能进交付包**（体积是产物的近两倍，且换机器架构可能不同）；
**它可以随时由 `package.json` + `package-lock.json` 重新生成**。
但「可以再生」不等于「现在就该删」——本机正在写作与验证时删掉它，
下一轮就没法跑构建。本轮不删除。

---

## 7. E 类：构建缓存与构建产物

| 路径 | 作用 | 开发 | 构建 | 源码包 | 静态包 | 公开 | 可删 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.vitepress/cache/`（2,883,776 B，仅 `deps/`） | Vite 的依赖预打包缓存 | 否（删了会自动重建，只是首次启动慢一点） | 否 | **否** | **否** | **否** | 是，删除前检查：无，它不含唯一数据 |
| `.vitepress/dist/`（67,203,366 B / 688 个文件） | **纯静态部署包的全部内容**：223 个 `.html` + 447 个 `.js` + 14 个 `.woff2` + 3 个 `.css` + `hashmap.json`（逐扩展名实测，2026-10-22 清理后重建） | 否 | 否（它是输出，不是输入） | 否 | **是** | 是（清理后复扫 0 命中） | 是，但**先看第 11 节判断它是不是新的** |

`dist/` 内部的构成对本次交付有两个直接影响：

- **体积大头是搜索索引**，不是页面。`dist/assets/chunks/@localSearchIndexroot.*.js`
  实测 18,301,503 B（占产物约 27%）。离线中文搜索靠它，删掉它站点照常打开但搜索失效。
  做「轻量静态包」时它属于必带项，别按「先压缩页面」的思路去砍。
  **但它同时也是隐私载体**：正文里的字符串会被切成 term 写进这张 MiniSearch 倒排表
  （实测 `documentCount: 3290`，字段 `title` / `headers` / `text`）。边界是：
  单个 term（如账户名）**会**原样出现，带分隔符的整串（如 `pwd -W`、`197609/learner`）
  会被切开、**不会**以整串出现。所以「产物干净」必须是**正文改完重建**的结果，
  不能靠在 `dist` 里改 HTML 达成。
- **产物里已经没有 `dist/docs/`**（实测 `ls` 报无此目录）：两篇维护文档不再构建成页面，
  因此它们**不再受构建期死链检查约束**，写错链接不会中止构建——这是本轮配置变更带来的
  一个真实行为差别，别再按「维护文档写了死链会崩构建」来推断。

`dist/` 里还有 `404.html`（35,400 B），由 `config.mts` 的 `notFound` 配置生成，属于正常产物。

---

## 8. `.scratch/` 专项分类（不得直接删除）

`.scratch/` 以点开头，**不参与构建**，也不会被搜索索引收录。
它在本站不是垃圾目录，而是「诚实性证据链」的一部分：多个章正文用行内代码写出
`.scratch/xxx.mjs` 这类路径，表示「这个结论是这段脚本跑出来的」。
所以删除任何 `.scratch` 文件都会让正文的证据引用失去落点。本次把它拆成六类（编号沿用上一轮的 8.1–8.5，
本轮复扫新增 8.6）：

| 子类 | 判定方法 | 实测数量 | 源码包 | 静态包 | 可删 |
| --- | --- | --- | --- | --- | --- |
| 8.1 被正文引用的证据脚本与输出 | `scratch-census.cjs` 解析相对路径后 `statSync` 命中 | 本轮复跑：cited token **133** 条，其中命中 **79** 条（本清单写下之前的早期跑法是 58 条命中，差值来自本文自己新增的目录级引用） | 需确认 | 否 | **否** |
| 8.2 **被正文引用但磁盘上已不存在** | 同上未命中 | **54 条**（本轮复跑仍为 54，与清理前一致） | — | — | 不适用（已不存在） |
| 8.3 磁盘上存在、但没有任何文件引用 | 325 个文件减去被命中集合 | 早期实测 39 个（全在 `devops/.scratch/`，88,980 B）；**本轮复跑该脚本得 0**，原因是本清单自己写了目录级 token（见下方口径说明） | 需确认 | 否 | 需确认 |
| 8.4 抓下来的外部资料快照 | 目录名 `docs/`、`rfc/` | 见下表 | 否 | 否 | 需确认（可重新抓取） |
| 8.5 一次性试验脚手架 | 目录名 `t12`/`t13`/`t15`/`w1`–`w4`/`envdemo`/`mr`/`proj`/`ds-ts`/`jar` | 见下表 | 否 | 否 | 需确认 |
| 8.6 含本机绝对路径的原始输出 | `final-rescan.cjs` 扫 `.scratch` 段 | **20 个文件、69 处命中** | 否（已 `.gitignore`） | 否 | **否**（改了证据就不可信） |

**8.3 的口径必须交代清楚**，否则这是两个互相矛盾的数：`scratch-census.cjs` 判「已引用」时，
若命中的 token 以 `/` 结尾（目录级引用，如 `devops/.scratch/`），会把该目录下**所有文件**标记为已引用。
本次为正文补写的这份清单自己在表格里写了这些目录级 token，所以现在跑脚本必然得 0——
**这是脚本度量的盲区，不是「39 个文件都有了出处」**。要恢复可判定，得让脚本只对**文件级** token 做前缀展开；
本轮不改脚本行为（它是一次性清点工具，结论已记录），只把两个数和原因都留在这里。

各领域 `.scratch` 实测（口径：`find -type f -not -path '*/node_modules/*'`）：

| 目录 | 文件数 | 字节 |
| --- | --- | --- |
| `computer-science/.scratch/` | 55 | 5,380,756 |
| `ai-apps/.scratch/` | 37 | 2,872,946 |
| `backend/.scratch/` | 37 | 309,370 |
| `linux/.scratch/` | 65 | 394,683 |
| `frontend-engineering/.scratch/` | 66 | 87,084 |
| `devops/.scratch/` | 44 | 126,845 |
| `data-storage/.scratch/` | 14 | 78,793 |
| `message-queue-cloud/.scratch/` | 2 | 34,515 |
| `realtime/.scratch/` | 5 | 32,661 |
| `database/.scratch/` | **0（空目录）** | 0 |
| **合计** | **325** | **9,317,653** |

（`frontend-engineering/.scratch/mr/` 下还有一个嵌套 `node_modules/` 内的文件，按上表口径**未计入**，
计入则该目录 67 个、总计 326 个。本轮之前的表用了 67/325 这一对不一致的数，现已按同一口径改正为 66/325。）

### 8.2 是本次最值得记的一条发现

正文引用了、但磁盘上找不到的 `.scratch` 路径共 **54 条**，集中成三个簇，**没有一条会导致构建失败**
（它们全是行内代码，不是链接），但它是**证据链的缺口**：

| 缺口 | 涉及章 | 情况 |
| --- | --- | --- |
| `typescript/` 领域**根本没有 `.scratch/` 目录** | `why-types.md`、`basic-types.md`、`unions-and-narrowing.md`、`objects-and-interfaces.md`、`functions.md`、`generics.md`、`tsconfig.md` 等 | 正文引用 `ts-ch1-*.ts` ~ `ts-ch6-*.ts`、`out2/out5/out8/out10/out11/`、`c1011/` 等约 40 条，全部不在磁盘上 |
| `backend/.scratch/` 缺 2 个 | `authorization.md`（`authz.mjs`）、`jwt-and-oauth.md`（`jwt.mjs`） | 该目录存在且有 37 个文件，只是这两个不在其中（另有 `errors.mjs` 被 `error-handling.md` 引用也缺失） |
| `database/.scratch/` 是**空目录** | `project.md` 引用 `cursor.cjs`、`projrun.cjs` | 磁盘上 0 个文件 |
| `data-storage/.scratch/` 缺 `sim1.mjs`、`sim2.mjs` | `why-this-layer.md`、`redis-persistence.md` | 该目录其余 12 个文件在 |
| 单点缺口 | `vue/reactivity.md`（`mini-reactive-published.mjs`）、`linux/nginx.md`（`w7`）、`devops/git-collaboration.md`（`remote`） | 各 1 条 |

处理方式有明确边界：**本轮不新建这些脚本去「补齐」证据**（那属于创建虚假证据），
**也不删改正文里的引用**（那属于篡改已交付内容）。正确动作是把缺口记进本清单，
让下一轮在真正重跑实验时一并补上，或由作者确认「这些证据文件当年就是一次性输出、已随清理消失」
并把正文措辞改为不点名文件。本报告把选择权留给审阅。

**清理动作对这一节的影响是零（两次测量相等的推论，非直接观测）**：替换真实身份与本机路径后复跑
`scratch-census.cjs`，MISS 仍为 **54** 条，与清理前相同。其中 4 条原本写作**本机项目目录的绝对形式**
（盘符 + `Project` + 仓库名，正斜杠与 MSYS 两种写法都有），现在写作 `/work/learns/...` 占位形式。
由于总数没变，这 4 条不可能发生「命中→失配」的转变（否则 MISS 会变成 55 或更多），
所以占位化没有新造出证据缺口；同样也没有让任何缺口消失。

### 8.5 里的两个额外注意

- `frontend-engineering/.scratch/envdemo/` 有 **8 个 `.env*` 文件**，含
  `DB_PASSWORD`、`VITE_UPLOAD_SIGN_KEY`、`DATABASE_URL` 这类键名。本次做**掩码形状检查**
  （只打印键名与值长度，不打印值）：所有值都不含 20 位以上高熵片段，多数带明显占位特征，
  `DATABASE_URL` 长度 50 属**待人工确认**项。这是教学演示目录，但**公开发布前值得逐个确认是假值**。
- `.gitignore` **自 2026-10-22 起已排除整个 `.scratch/`**（本轮新增规则，见第 9 节），
  所以这些演示凭据形状文件与含本机路径的输出文件都不再进入将来的提交范围；
  但**规则此刻仍不生效**——本仓库没有 `.git/`，它只是声明。真正的排除靠「不公开 `.scratch/`」这一交付决定。

根 `.scratch/` 本轮结束时是 **25 个文件、189,782 B、无子目录**。构成是：

| 子类 | 数量 | 说明 |
| --- | --- | --- |
| 只读排查/清点/复扫工具 | 14 | `audit.cjs`、`mdcheck.mjs`、`verify.cjs`、`anchor-audit.cjs`、`devprobe.cjs`、`exercise-lint.cjs`、`privacy-scan.cjs`、`privacy-classify.cjs`、`shapecheck.cjs`、`scratch-census.cjs`、`reconcile-count.cjs`、`env-shape.cjs`、`docs-link-check.cjs`、`final-rescan.cjs` |
| **会写文件的工具** | 2 | `fix-exercise-slot.cjs`（上一轮修组件插槽顺序，默认 dry-run、需 `--apply`）；`sanitize-identity.cjs`（本轮第 10 节的替换器，同样默认 dry-run，只有带 `--apply` 那一次真写了 14 个课程文件） |
| 正对照 | 1 | `_ctl.md`——给 `docs-link-check.cjs` 做正对照的三行测试文件，里面故意放一条死链，用来证明检查器真的会报错而不是永远返回 none |
| 运行输出留存 | 8 | `typecheck-out.txt`、`build-out.txt`、`preview-log.txt`、`served-git-basics.html`（123,213 B，本地 preview 抓下来的实际响应体）、`census-after.txt`、`rescan-out.txt`、`rescan-final.txt`、`rescan-final2.txt` |

按本轮「不删除任何文件」的限制，以上全部留在原处。**需要点名的一处**：根 `.scratch/` 里
带真实本机值的不是运行输出，而是**四个工具自己**——`privacy-scan.cjs`、`privacy-classify.cjs`、
`sanitize-identity.cjs`、`final-rescan.cjs` 把账户名、Git 姓名与绝对路径**作为搜索/替换模式写进了源码**
（`final-rescan.cjs` 用字符码组装以避免回显，但 `sanitize-identity.cjs` 的替换规则表是明文）。
八个运行输出文件（`typecheck-out.txt`、`build-out.txt`、`preview-log.txt`、`served-git-basics.html`、
`census-after.txt`、`rescan-out.txt`、`rescan-final.txt`、`rescan-final2.txt`）经逐文件实测**全部不含**这些值，因为它们只打印仓库相对路径。
这一组文件与 `.scratch/` 整体一起被排除在发布范围之外，所以不构成公开风险；
但它们是证据，**本轮不改写、不删除**。
这些工具对站点无影响（`.scratch` 不构建成页面），但记录了「这次是怎么查出来的」，**本轮保留**。

---

## 9. `.gitignore` 审查与本轮新增的三条规则

**原有 7 行一条未动**：`node_modules/`、`.vitepress/dist/`、`.vitepress/cache/`、`*.log`、
`.DS_Store`、`.idea/`、`.vscode/`。

> **2026-10-23 更正**：本仓库**已经是 Git 仓库**（远端
> `https://github.com/Flygreenbaby/learns-site`，默认分支 `main`），
> 所以 `.gitignore` **已经生效**，下表这 3 条规则正在真实地挡住提交。
> 本节以下文字写于仓库化之前，当时「实测无 `.git/`，这个文件此刻完全不产生作用」成立，
> 现已不成立。另：此后又追加了第 4 条 `.vitepress/dist.zip`（构建产物压缩包，见第 7 节
> 与 `docs/deployment.md` 第 7.3 节），本节标题里的「三条」指的是 2026-10-22 那一轮。

（先前版本把这段写成「6 行」，实际逐行数过是 7 条，本轮顺手改正。）

本轮按上面这个前提**只追加了 3 条**，每条带注释说明理由，文件从 81 B 变成 720 B：

| 新增规则 | 针对的问题 | 处理理由 |
| --- | --- | --- |
| `.scratch/` | 9.3 MB 证据文件、抓取的 RFC/文档快照、**4 个含真实本机值的工具源码**、演示 `.env` | 证据链留在本机，不进版本库；配合第 8 节，「不公开 `.scratch/`」而不是改写它 |
| `learns-site.zip` | 2,420,059 B、mtime 2026-10-16 的历史产物，内容早于当前源码 | 防止被误当交付物；判断过期包的方法在第 11 节 |
| `TASK-HANDOFF.md` | 21,382 B、mtime 2026-10-17 的单次任务交接记录，含本机路径且已大量过期 | 它已被 `srcExclude` 挡在站点之外，再从版本库排除，**文件本身不删**，属最小可审计处理 |

本轮**没有**为 `_author-brief.md` / `_content-plan.md` 加规则：它们已经因 `**/_*.md` 不成为页面，
`_author-brief.md` 里只有 1 处项目目录绝对路径，是否随源码公开留给审阅决定（见第 2 节末尾）。
补规则的做法是**新增行，不覆盖原行**，本轮遵循此则。

---

## 10. 公开发布前的隐私项（本轮已处理，并给出复扫结果）

**扫描方式**：`node .scratch/final-rescan.cjs`。它按四类范围逐一扫描——
课程与文档源文件（494 个）、`.vitepress/` 配置与主题（9 个）、构建产物（688 个）、
`.scratch/` 证据（347 个），对每条模式只输出**类别 + 文件路径 + 命中次数**，
被匹配的真实值用字符码组装、不回显，所以本文与运行日志里都不含原值。
阳性对照：同一份脚本对 `.scratch/` 段命中 **20 个文件 / 69 处**，证明模式确实能匹配到，
「课程源文件与产物 0 命中」不是空跑出来的结论。

**本轮处理的是什么**：一处真实身份簇——Windows 账户名、Git `user.name`、Git `user.email`、
项目目录绝对路径（三种书写形式）、Git 与 Node 的安装目录、家目录。
它们不只在任务点名的 4 个文件里，逐文件 grep 后确认涉及 **14 个课程文件**，
共 **41 处替换**（`.scratch/sanitize-identity.cjs --apply` 的运行输出）。
替换只动字符串本身，不动教学目的、代码逻辑与输出形状：
账户名 → `learner`，姓名 → `Learner`，邮箱 → `learner@example.com`，
项目目录前缀 → `D:\work\learns`（含 `/d/work/learns`、`/c/Users/learner` 等等价形式），
Git 安装目录 → `C:/Program Files/Git`，Node → `C:\Program Files\nodejs\node.exe`。
**uid/gid 数字 `197609` 故意保留**：它是 MSYS 生成的合成号、不是本机隐私，
而「属组显示成裸数字」正是 `linux/command-line.md` 那节的教学点。

| 文件 | 替换前字节 | 现在字节 | 现在含的占位串（次数） |
| --- | --- | --- | --- |
| `devops/git-basics.md` | 31,699 | 31,879 | `learner@example.com`=3、`C:/Users/learner`=2、`C:/Program Files/Git`=5、`Learner`=3 |
| `devops/git-collaboration.md` | 31,969 | 31,965 | `D:/work/learns`=2、`Learner`=1 |
| `javascript/modules-and-iterators.md` | 49,212 | 49,214 | `C:/Users/learner`=1 |
| `javascript/errors-and-debugging.md` | 38,711 | 38,784 | `C:\Program Files\nodejs\node.exe`=1 |
| `linux/command-line.md` | 35,025 | 35,167 | `/c/Users/learner`=1、`D:/work/learns`=1、`D:\work\learns`=1、`/d/work/learns`=2 |
| `linux/users-and-permissions.md` | 38,929 | 39,000 | `learner`=2（`uid=197609(learner)` 一类形式） |
| `backend/error-handling.md` | 25,373 | 25,364 | `D:/work/learns`=3 |
| `backend/node-runtime.md` | 47,431 | 47,422 | `D:/work/learns`=3 |
| `css/selectors.md` | 28,821 | 28,818 | `D:\work\learns`=1 |
| `typescript/tsconfig.md` | 34,453 | 34,450 | `D:/work/learns`=1 |
| `typescript/unions-and-narrowing.md` | 27,008 | 27,005 | `D:/work/learns`=1 |
| `typescript/why-types.md` | 21,712 | 21,709 | `D:/work/learns`=1 |
| `frontend-engineering/vite-build.md` | 20,486 | 20,492 | `C:/Program Files/Git`=1 |
| `html/links.md` | 22,652 | 22,649 | `file:///D:/work/docs/html`=1 |

（表里最后一列各模式**独立计数**，`learner` 的计数包含它出现在邮箱与路径子串里的位置，
所以这些数字不能相加。「替换前字节」是 `--apply` 那次运行记录的 `wc -c` 值，
「现在字节」是本轮 `wc -c` 实测；差值来自替换本身与 5 个文件里新增的来源说明句。）

另有 5 处**只加说明、不改内容**的补充：`devops/git-basics.md`、`javascript/errors-and-debugging.md`、
`linux/command-line.md`、`linux/users-and-permissions.md` 各加一句「示例里的用户名/目录是占位值，
字段形状与数字与真实输出一致」，公开页 `guide/how-to-use.md` 的「关于代码示例的验证状态」一节
加了一段全站声明。**学习者因此不会误以为示例被伪造过，这是替换动作的诚实性前提。**

复扫结论（本次实测）：

| 范围 | 结果 |
| --- | --- |
| 课程 + `docs/` + `README.md` + `scripts/` + `public/`（494 个文件） | 真实身份簇 **0 命中** |
| `.vitepress/config.mts` 与主题（9 个文件） | **0 命中** |
| 构建产物 `.vitepress/dist/`（688 个文件，含 18,301,503 B 搜索索引 chunk） | **0 命中** |
| `.scratch/`（347 个文件） | 20 个文件 69 处命中，**按边界不改写**，靠 `.gitignore` + 「不公开 `.scratch/`」处理 |
| 站点之外的两个维护文档 | `TASK-HANDOFF.md` 仍有 5 处项目路径（已 `.gitignore`，不删文件）；`_author-brief.md` 1 处（未处理，见下） |

**搜索索引那条边界必须说清楚**（上一版本本节把它写成「隐私值已被编进索引 chunk」，
那是**只在单 token 层面成立**的说法）：本地搜索 chunk 是 MiniSearch 倒排表，
实测 `documentCount: 3290`、字段为 `title` / `headers` / `text`，`text` 说明代码块文本也被索引，
`fakebin`、`197609`、`learner` 都作为独立 term 出现。索引存的是**切好的 term，不是原文**，
所以带分隔符的整串（邮箱、绝对路径）不会以整串形式进索引。
这条边界决定了复扫的可信范围：**单 token** 值扫整个 `dist/` 可靠；**整串**形式的路径与邮箱，
可靠的是页面 `.html` 与每页 `.js` chunk 这两类文件（本轮两类都扫了，且都是 0 命中）。

**仍需人工确认、本轮按「不确定就不改」保留原样的两项**：
① 私有网段 IP `10.244.3.17`（形如容器/CNI 默认地址）出现在 5 个章文件的实测报错原文与脱敏示例里；
② `backend/logging-and-monitoring.md` 第 108 行那条脱敏演示「之前」形态的连接串里
`app:` 后面那段自述为示例口令的片段。
两者都属课程自述的合成数据，但**无法由本机证据自证**，所以不判定为安全、也不改动。
`frontend-engineering/.scratch/envdemo/` 的 8 个 `.env*` 同理：形状检查未见高熵真实值，
`DATABASE_URL` 长度 50 属待确认项，且该目录已随 `.scratch/` 整体排除在发布范围之外。

---

## 11. 怎么判断 `dist/` 是不是新的（防止发过期包）

`learns-site.zip`（2,420,059 B，mtime 2026-10-16，**已于 2026-10-23 从磁盘移除**）和早先的 `dist/`
都**早于**后来写完的章节，不能当交付物。判断方法四条，本轮四条全部实际用过：

1. **比时间**：`dist/index.html` 的 mtime 必须**不早于**任何一章 `.md` 的 mtime。
   本轮实测 `dist/index.html` 为 2026-10-22 23:43:47（清理后重建），`find` 出比它新的 `.md` 只有
   `README.md` 与 `docs/deployment.md` 两份**不参与构建**的文件——所以这条判据现在必须加个例外：
   **被 `srcExclude` 排除的文件更新，不构成产物过期**。
   （**2026-10-23 更正**：本仓库已是 Git 仓库，「谁被改过」优先用 `git status` / `git diff` 判断，
   mtime 只作辅助；下面这句「mtime 是唯一可用依据」是仓库化之前的旧结论。）
2. **比数量**：`find dist -name '*.html' | wc -l` 应等于页面数 + 2（`404.html` 与 `public` 下的示例）。
   本轮 223 = **221** + 2，成立；上一版本记录的 224 = 222 + 2 也是当时真实状态。
   两处记录的差是 **1 页**，且 `.js` 数从 449 变 447（−2）——**这个 −1 / −2 组合是自洽的**：
   本轮实测 `dist/assets/` 里每个页面恰好产出 `<路由>.md.<hash>.js` 与同名 `.lean.js` 两个文件
   （221 + 221，再加 1 个 `app.<hash>.js` = 443，`chunks/` 另有 4 个 = 447），
   所以少 1 页必然少 2 个 `.js`。它也顺带证明：**上一版产物里只含 1 个 `docs/` 页面**
   （`deployment.html`），本文件在更早那次构建后从未被真正产出过。
   少了就是产物过期或构建中断（构建中断时是 0 个页面，不是少几个）。
3. **比内容**：抽一个**最后改过的章节**，确认它的 `.html` 在 `dist` 对应路径里存在且含新值。
   本轮做法是把 `devops/git-basics.html` 经本地 preview 抓成 `.scratch/served-git-basics.html`
   （123,213 B）再逐文件复扫——只看 `index.html` 不够，它可能一直是旧的。
4. **比目录**：`dist/docs/` 应当**不存在**。本轮实测 `ls` 报无此目录，
   这是「维护文档确实没进公开产物」的最快判据。

（另有一份四条判据写在 [`deployment.md`](deployment.md) 第 7.2 节，它的第 4 条是
「产物里 mtime 早于构建的文件只允许是 `public/` 的拷贝」——两份清单的第 4 条不同，
不是同一份的重复，核对时两条都要跑。）

---

## 12. 两种交付包的文件清单结论

本轮**只定清单与做清理，不打包**（不生成 ZIP、不复制文件、不覆盖任何部署目录）。

**完整源码包** = 第 2 节 A 类全部 + 第 4 节 B 类全部 + `scripts/`（7 个 `.cjs`）+ `public/`
+ `README.md` + `docs/` 两篇维护文档（**只在这里存在，不进站点**）+ `.gitignore`。
`.scratch/` 默认**不带**：它已被 `.gitignore` 排除，且第 10 节说明它含 69 处本机值；
若收件人明确要复核证据链，再单独打包给他，并把第 8.2 节的 54 条缺口一并说明。
`_content-plan.md` / `_author-brief.md` 带不带是产品决定（本轮没动）。
**排除**：`node_modules/`、`.vitepress/cache/`、`.vitepress/dist/`、`learns-site.zip`、`.scratch/`。
收件人动作：装 Node 22+ → `npm ci` → `npm run dev`。步骤与命令的
实测状态写在 [`docs/deployment.md`](deployment.md) 第 3、4 节。

**纯静态部署包** = `.vitepress/dist/` 整个目录，**一个文件都不能少**：223 个页面 HTML、
`assets/` 下全部哈希 JS/CSS/字体、`hashmap.json`、`examples/`（`public` 的拷贝）、
`404.html`。其中 `assets/chunks/@localSearchIndexroot.*.js`（18,301,503 B）决定站内搜索是否可用。
**排除**：源码包里的一切（`.md`、`.vitepress/`、`node_modules/`、`scripts/`、`docs/`）。
部署侧**不需要 Node、不需要 npm、不需要数据库**，这一条已由产物文件类型逐扩展名清点证实
（**447 js / 223 html / 14 woff2 / 3 css / 1 json = 688 个文件**，无其它类型；
上一版本记的 449 js / 224 html 是清理前产物的数，差值 −2 js / −1 html 的成因在第 11 节第 2 条已核对）。

两包共同的前提已经满足但**不可跳过**：发布前必须按第 10 节复扫一次，
静态包会把正文原样带上线，包括搜索索引——本轮的 0 命中结论只对**当前这份 `dist/`** 成立
（mtime 2026-10-22 23:43:47），任何人改了课程正文重新构建后都要重跑 `final-rescan.cjs`。
