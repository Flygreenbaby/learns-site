# 语义化版本与锁文件：^ 允许装到哪个范围，锁文件锁的为什么是整棵树

你什么都没改，`npm install` 之后项目崩了——这句话在工程化里几乎等价于「你不懂 `^`」。你 3 月 14 日提交了一个能跑的仓库，同事 3 月 20 日拉下来装出一棵不同的依赖树；你 `package.json` 里只写了三个依赖，仓库里却有 **185 个包**（本站 `package-lock.json` 的真实条目数），其中 182 个的变化不需要你改一行代码。CI 上 `npm ci` 报两个文件不同步，你为了「先跑起来」改成 `npm install`，流水线绿了，从此构建不可复现，故障会在两周后的某个凌晨以「线上白屏」的形式还债。这三件事是同一件事的三个面：**semver 范围是「许可」，锁文件是「事实」，安装命令决定工具执行哪一个。**

<Callout type="verified" title="本章实跑范围与原文输出">

环境：Windows 10 x64、Node `v25.4.0`、npm `11.7.0`、日期 2026-10-17。全部为**只读**命令，没有执行任何安装、卸载、`npm ci`、`npm update`、`npm audit fix`。用 `npm view "vite@<range>" version` 实测「声明范围 → 可解析版本数」，得到的数字全部写进下面「范围语法对照表」的**本机验证**列（`^5.0.0` 67 个、`~5.0.0` 14 个、`^0.9.0` 2 个、`~0.9.0` 2 个、精确 `5.0.0` 1 个、`>=5.0.0 <5.3.0` 38 个、`1.0.0-beta.1` 1 个）。另实跑 `npm view vite versions --json`（760 行版本字符串）与 `npm outdated`（原文见下文），读取 `package-lock.json` 得到 `lockfileVersion: 3`、185 个 `packages` 条目、50 个标 `optional`、**0 个包名出现超过一个版本**。**未在本机验证**：本机 `pnpm: command not found`、`corepack: command not found`，故 `pnpm-lock.yaml` 细节、pnpm 升级参数、Corepack 行为全按官方文档表述。

</Callout>

## 三段号各自承诺什么：兼容性判断的是「接口」不是「行为」

| 递增 | 官方定义 | 对你（调用方）的承诺 |
| --- | --- | --- |
| MAJOR | 破坏性变更 | 「不改代码也能跑」的前提不成立了 |
| MINOR | 向后兼容的新增能力 | 旧代码继续可用，只是多了新 API |
| PATCH | 向后兼容的缺陷修复 | 行为不变，某些错误结果变对 |

一个包只删掉一个导出符号、只把一个可选参数变必填、甚至只**改了承诺的边界行为**，都算 breaking、都该升 MAJOR；反过来改三万行内部实现而接口不变，只是 PATCH 或 MINOR。常见 breaking 形态：删除/重命名导出、改参数顺序、去掉返回字段、错误类型变了、CJS-only 改成纯 ESM（`require` 直接崩）、`engines.node` 收窄、**默认行为变了而旧行为要显式 opt-in**（没人报错但结果是错的，最难发现的一类）、peer 要求升级。加新可选参数、加新导出、内部重构、修 bug 都不算。

**关键的诚实声明**：semver 是**约定**，不是**强制**，发布者升错版本号是常事而 npm 不会检查。所以「`^` 允许 MINOR 自动升」的风险不是理论上的——这是你 `npm install` 之后崩掉的头号原因，也是必须提交锁文件的核心理由。本站把 `vitepress` 写成精确版本 `1.6.4` 就是这种不信任的直接体现。

## 0 主版本特例：这里的 MINOR 等于 MAJOR

**主版本为 0 时整个包被声明为「不稳定」，MINOR 递增就可以是破坏性的**。于是 `^1.2.3` → `>=1.2.3 <2.0.0`（正常），`^0.2.3` → `>=0.2.3 <0.3.0`（MINOR 变就出界），`^0.0.3` → `>=0.0.3 <0.0.4`（连 PATCH 都锁死）。对照记忆：`^` 在 MAJOR 非 0 时锁主版本，MAJOR 为 0 时锁次版本，`0.0.x` 时锁修订号。**本机验证**：`^0.9.0` 返回 2 个版本、`~0.9.0` 同样 2 个——若按非 0 规则解释，`^0.9.0` 应能解析出整个 0.10、0.11 系列，实测只有 2 个，**证明 npm 确实按 0.x 特例把范围收窄到同一 MINOR**（对比 `^5.0.0` 的 67 个）。影响面比想象大：大量构建工具、CLI、库长期停在 0.x，你写 `^0.x` 时以为在「允许小版本自动升」，实际在锁死一个版本。

## 范围语法对照表：你写的字符决定机器能选什么

| 声明 | 允许解析到的范围 | 一句话理解 | 本机验证 |
| --- | --- | --- | --- |
| `5.0.0` | 恰好 `5.0.0` | 完全锁死 | ✅ 1 个 |
| `^5.0.0` | `>=5.0.0 <6.0.0` | 允许非破坏升级 | ✅ 67 个 |
| `~5.0.0` | `>=5.0.0 <5.1.0` | 只允许 PATCH 级 | ✅ 14 个 |
| `^0.9.0` | `>=0.9.0 <0.10.0` | 0 主版本特例：锁 MINOR | ✅ 2 个 |
| `>=5.0.0 <5.3.0` | 显式交集 | 手工构造的过渡窗口 | ✅ 38 个 |
| `*` / `x` / 空 | 任意版本 | **不要这么写**：新 MAJOR 直接进来 | 未跑 |
| `latest`（dist-tag） | 标签指向的版本 | 标签可被**事后改指向**，是个会移动的靶子 | 未跑 |
| `1.2.3-alpha.1` | 精确到预发布 | 预发布不在常规范围里 | ✅ 1 个 |

同一个包，写法不同，「安全」的含义就不同：`^` 把安全性完全押在发布者的 semver 判断上，`~` 把押注缩到 PATCH，精确版本把押注收回自己手里（代价是永远收不到自动的安全修复），`*` 是把项目交出去。本站的真实推论：`typescript` 写 `^5.9.3`，`npm outdated` 显示 Current 5.9.3 / Wanted 5.9.3 / Latest **7.0.2**——`^` 把自动升级挡在 `<6.0.0`，那个 7.0.2 永远不会「自己」进来。这个「挡住」正是本站需要的：`vue-tsc@3.3.13` 需要 `require.resolve('typescript/lib/tsc')`，TS 7 不再导出该子路径，装上就 `ERR_PACKAGE_PATH_NOT_EXPORTED`。**范围语法在这里救了一次场。**

## npm install 与 npm ci：不是快慢区别，是执行依据的区别

| 维度 | `npm install`（无参数） | `npm ci` |
| --- | --- | --- |
| 依据什么解析 | `package.json` 的范围 + 现有锁文件 | **只**按锁文件，且不写锁文件 |
| 是否先删 `node_modules` | 不会，增量补齐 | 会，先清空再装（ci = clean install） |
| 两者不一致时 | 顺手改掉锁文件，问题被掩盖 | **直接报错退出** |
| `prepare` 生命周期脚本 | 会跑 | 不跑（官方列出的差异之一） |
| 该在哪用 | 本地开发、你**主动**想升级时 | CI、Docker、任何「要复现」的场合 |

**CI 必须用 `npm ci`**，原因不是更快，而是两条：严格按锁文件安装、绝不写锁文件；对不一致状态**硬失败**——硬失败正是你要的信号：仓库里的声明与事实对不上，把它换成 `npm install` 等于把这个信号永久关掉。顶层 `lockfileVersion` 本站读到 **3**，**不要手改锁文件**，包括这个版本号。pnpm 上没有叫 `ci` 的命令，等价做法是 `pnpm install --frozen-lockfile`，语义同样是「锁文件是唯一事实、不一致就失败、绝不写锁文件」（本机未装 pnpm，参数名动手前查 [pnpm CLI 文档](https://pnpm.io/zh/cli/install)）。

## 锁文件在锁什么：整棵依赖树

**`package.json` 锁的是你直接依赖的范围；锁文件锁的是整棵树解析出的精确结果。** 本站的数字关系是 3 个直接依赖 → 185 个 `packages` 条目，每个都带精确版本、`resolved` 地址与 `integrity` 哈希；其中 **50 个标 `optional`**（`@esbuild/aix-ppc64` 这类平台二进制）全部记录在案、装的时候按当前 CPU/OS 只挑一个。三个现象由它直接解释：

1. **不提交锁文件**：你 14 号装时 `^5.0.0` 解析到 5.0.9，20 号同事装时同一范围解析到 5.4.21，中间那些包各自独立漂移——你们跑的**不是同一套代码**，却没有任何一处 diff 显示这件事。「昨天能装今天装出不同版本」不是 bug，是没锁文件的必然结果。
2. **提交之后仍要懂 `^`**：锁文件只在你**重装时**起作用，一旦有人触发重新解析，`^` 允许的空间立刻生效、锁文件被更新——锁的是复现，不是围栏。
3. **`npm ci` 为什么报不一致**：它严格比对 `package.json` 的每个范围与锁文件里的每个版本，任何缺口都是错误。**这是设计，不是麻烦。**

本站同名多版本数为 **0**（本机统计），想观察「同一包多版本共存」请在临时目录里拿依赖树复杂的真实项目跑 `npm ls <包名>`，别拿本站当例子。**谁必须提交锁文件**：所有应用与站点（含纯静态站）。发布的**库**也提交（让自己 CI 可复现），但 npm 安装一个包时会**忽略**被安装包的锁文件——它只对「仓库的根」生效；想让下游也被你的树锁住那叫 `npm-shrinkwrap.json`，通常只有 CLI 之类该用（[官方文档](https://docs.npmjs.com/cli/v10/configuring-npm/npm-shrinkwrap-json)）。

## 冲突怎么产生，peerDependencies 冲突的三种解法

冲突只有一条路径：**树里两个节点对同一个包提出互不重叠的范围要求**（A 要 `helper@^1`、B 要 `helper@^2`）。npm 的默认解法是**嵌套安装**（见第 1 章解析算法）：对纯函数库没问题，对「必须全局单例」的库（React、Vue、Pinia、路由）就是致命错误——两份实例各自维护内部状态，报错形如 `Invalid hook call` 或「inject 拿到 undefined」。`peerDependencies` 是另一种冲突：被依赖的包**自己不装**，而是声明「你（宿主）必须提供，且版本要落在范围里」；npm 7 之后会自动安装 peer，于是范围不匹配变成**硬失败**（`ERESOLVE`），npm 7 之前不自动装也不硬拦，表现为「装了但运行时炸」。

三种解法按优先级：**① 对齐版本**（把宿主升到/降到那个包要求的范围，或换一个支持新 peer 的版本）是绝大多数情况的唯一正解；**② `overrides` 强制**（如 `"overrides": { "some-lib": { "peer-pkg": "$react" } }`，`$react` 引用根依赖版本）只在你确认那个包其实能工作、只是声明过窄时使用，这是**你在承担兼容性责任**；**③ 换依赖**是上游长期不更新时的止损。

`--legacy-peer-deps` 为什么是饮鸩止渴：它把 npm 恢复到 npm 6 的行为——**不自动装 peer、不校验 peer 范围**。安装立刻通过，但依赖树变成「按声明验证过、按实际运行没验证过」的状态；peer 范围本来就是「我在这个区间之外没测试过」的诚实声明，关掉校验等于对上游说「你说什么都行」。当临时手段（赶发版、同时提 issue 催上游）可以，写进 `.npmrc` 当永久方案就是拿生产下注。反方向还有 `--strict-peer-deps`。

`overrides`（npm）/`resolutions`（yarn）另一个主要用途是**修传递依赖里的安全漏洞**。三件套必须一起做：提交信息写清「为什么这个 override 是安全的」；加 TODO 关联上游 issue；每次大版本升级后**重新检查它是否还需要**——过期没删的 override 会在某个时刻变成一句无法解释的话。

## npm audit 的真实作用与局限：本站就是最好的例子

`npm audit` 是**拿你锁文件里的版本，去比对官方公告库的受影响范围**。它能发现「已知漏洞 + 你在用受影响版本」（很有价值，尤其是一个你从没听说过却存在远程代码执行的传递依赖）；发现不了新写法的问题、逻辑漏洞、你代码里的问题、未公开的漏洞、私服镜像的版本差异。它的建议不等于你的结论：`fixAvailable` 只表示「公告库里存在一个不在受影响范围内的版本」，**不检查那个版本会不会破坏你的代码**。

<Callout type="verified" title="本站的 audit 事实（结论引自仓库 README，我没有在本机重跑 audit）">

README「已知问题」记录的原文事实：`npm audit` 报 **3 个漏洞，均无可用修复**——`esbuild`（moderate，受影响 `<=0.24.2`，[GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)）、`vite`（high，受影响 `<=6.4.2`，[GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)）、`vitepress`（moderate，经由 `vite` 传递）。三者 `fixAvailable` 都是 `false`，因为 VitePress 1.6.4 锁在 Vite 5.4.21 上、修复要到 Vite 6.4.3 之后，只能等 VitePress 升级。本机读到的 `esbuild` 实际安装版本是 **0.21.5**，确实落在受影响范围内——**这条我能独立验证，结果与 README 一致**。

这个例子教的正是「不要迷信 audit」：**报 high 不等于你有风险，不等于你能修，更不等于该改锁文件。** 本站的判断写在 README 里：这几个漏洞只影响开发服务器，而交付物是 `dist/` 里的纯静态文件、部署后不跑 Node 进程，因此不受影响；规避措施是 dev server 只监听 localhost、不加 `--host`。正确处置是：**读受影响版本 → 确认它出现在哪棵子树 → 判断那个版本区间在你这里是不是攻击面 → 决定接受 / 加 override / 等升级**，而不是把「有漏洞」直接等价成「必须修」。

</Callout>

`npm audit fix` 会改 `package.json` 范围与锁文件，加 `--force` 时**允许装超出你声明范围的高版本**（可能跨 MAJOR）；在 CI 或发布前跑它是典型的「制造不可解释的依赖树」。想只读地看建议就用 `npm audit --json`，结构里有 `fixAvailable` 与受影响路径。

## npm outdated 怎么读：本站原文

```text
Package     Current  Wanted  Latest  Location                 Depended by
typescript    5.9.3   5.9.3   7.0.2  node_modules/typescript  learns
```

`Current` 是实际安装版本；`Wanted` 是**在你声明范围内**能升到的最高版本，与 Current 相等就代表范围内已到底；`Latest` 是 `latest` 标签指向的版本、常常跨 MAJOR，所以 **Latest 数字大不代表你落后**；`Location` 出现 `node_modules/xxx/node_modules/yyy` 就意味着有重复安装。这份输出本身是一条结论：`vitepress` 与 `vue-tsc` 没出现在表里（`vitepress` 写精确 `1.6.4`，Wanted 恒等于 Current）。`npm outdated` 的**退出码非 0**，shell 里直接 `&& npm outdated` 会截断流程。

命令对照：`npm update`（范围内升，写锁文件）、`npm update <pkg>`（只升指定包，但会重排整棵树）、`npm install pkg@1.2.3`（**改 `package.json` 范围**并更新锁文件，常把范围重写成新的 `^1.2.3`）、`npm install pkg@latest`（推到新 MAJOR，需人工确认 breaking）；pnpm 对应 `pnpm update` / `pnpm add pkg@version`。`npm update` 最易踩的副作用是它会**连带刷新整棵树的最新合规版本**，「我只想升一下 X」经常变成 diff 上千行；想可控就用 `npm install <pkg>@<明确版本>` 显式表达意图。

## 依赖升级的正确节奏：一次一个

一次只升一个**语义单元**（直接依赖 + 配套的插件/类型包/peer 是一组：升 Vite 就得同时看 `@vitejs/plugin-vue`、`vitest`、`vue-tsc`）；先读 changelog 的 Breaking changes，找不到这一节的包就把它的 MINOR 当 MAJOR 对待；在**独立分支**上改，`package.json` + 锁文件 + 配置改动放在同一个提交里；依次跑类型检查 → lint → 测试 → 构建 → 本地起服务点主要页面（本站 `type-check` 是 `vue-tsc --noEmit -p tsconfig.json`，第 3 章讲清 `build` 里为什么没有类型检查，所以这步不能省）；出问题先分清「依赖坏了」还是「我们用错了」，把上一个能跑版本的 `npm ls <包名>` 与新版本并排对比；提交信息不要写 `chore: bump deps`，要写「升 vue-tsc 到 3.3.13，因此 typescript 保持在 5.x（TS 7 不导出 `typescript/lib/tsc`）」。

## Node 版本、engines、.nvmrc 与 packageManager

| 机制 | 谁读它 | 强制力 |
| --- | --- | --- |
| `engines.node` | npm / 工具与 CI 的镜像选择 | 默认**只警告**；`.npmrc` 开 `engine-strict=true` 才拦 |
| `.nvmrc` / `.node-version` | nvm / fnm / Volta / asdf | 由版本管理工具切换，不影响包管理器 |
| `packageManager`（形如 `pnpm@9.15.0`） | Corepack | 决定用哪个包管理器的**精确版本**，避免生成两份锁文件 |

本站读到的真实值：`node_modules/vite/package.json` 的 `"node": "^18.0.0 || >=20.0.0"`，本机 Node `v25.4.0` 落在 `>=20` 分支里满足；README 同时给出建议「Node 20 或更新的 LTS」并注明该结论核实自那个文件——「声明」与「实际验证」分开写。**一个仓库只允许一份锁文件**，这是纪律不是偏好：`package-lock.json` 与 `pnpm-lock.yaml` 并存意味着两个人各自用一棵树、冲突永远解不完。

## 排查「本地好的线上坏了」：按顺序走，不要跳

| 差异 | 怎么确认（只读） | 修法 |
| --- | --- | --- |
| 没提交锁文件，或被 `.gitignore` 排除 | `git ls-files \| grep -i lock` 有无输出 | 立刻提交，线上改用 `npm ci` |
| 线上用 `npm install` 重装（触发重新解析） | 比对两边锁文件 diff；看 CI 安装命令 | CI 一律 `npm ci` / `pnpm install --frozen-lockfile` |
| 两者不同步 | `npm ci` 是否直接失败；`npm ls` 有无 `UNMET DEPENDENCY` | 本地 `npm install` 一致后一起提交 |
| Node 或包管理器版本不同 | 两边 `node --version`、`npm --version`；有无两份锁文件 | 对齐版本，用 `packageManager` 钉住，删多余锁文件 |
| `optionalDependencies` 按平台解析不同 | 比对两边 `npm ls <包>`；容器 `uname -m` 与本地架构 | 显式装对应平台包，或改用与架构无关的实现 |
| 有重复版本而我只升了顶层那份 | `npm ls <包名>` 看几处；`npm explain <包>` | `overrides` 收敛 |
| 环境变量 / 构建模式 / `base` 不同 | 比对 `NODE_ENV`、模式、`base`（第 10 章、第 4 章） | 把「线上怎么跑」也写进仓库（脚本 + Dockerfile） |

实用原则：**先证伪「依赖树不同」，再开始读代码**——清缓存 + `npm ci` + 比对锁文件这三步能在几分钟内把环境差异和代码差异分开，跳过它们去读代码通常浪费半天。发布自己的包时顺带记住：`files` 字段是**白名单**，列你**要**发布的东西（`dist`、`README.md`、`LICENSE`）比列不要的更可靠，发布前用 `npm pack --dry-run` 看清单。

## 常见错误与排查

1. **CI 上 `npm ci can only install packages when your package.json and package-lock.json are in sync`** —— 两者不一致（手改过、merge 解错、别人用了别的包管理器）。确认：本地跑 `npm ci`，报错通常点名是哪个包的哪个版本不在锁文件里。修：本地 `npm install` 同步、审 diff、**一起提交**；不要在 CI 里改用 `npm install` 绕过，那只是关掉报警。
2. **重装依赖后产物变了 / 页面崩了，而 diff 里没有任何代码改动** —— 大概率是 `^` 范围内上游发了新 MINOR 且带 breaking。确认：`git diff package-lock.json` 看版本漂移。修：把那个包降到旧版（精确或 `~`）+ 提 issue + 在提交信息里记下。
3. **`ETARGET` / `Not found - some-pkg@^9.0.0`** —— 范围在 registry（或你配的镜像）里不存在。确认：`npm view some-pkg versions --json`，`npm config get registry` 确认问的是哪个源。修：改成实际存在的范围，或让私服同步。
4. **`ERESOLVE unable to resolve dependency tree`** —— peer 范围互斥。确认：报错里 `While resolving: ... Found: x@1.y.z` 与 `node_modules/x` 的路径链就是冲突链。修：按三种解法（对齐 → `overrides` → 换包），`--legacy-peer-deps` 只当临时手段且要留 issue。
5. **锁文件出现几千行 diff，评审无从下手** —— 一次宽范围 `npm update` 重排了整棵树。修：拆成一次只动一个语义单元的提交；必要时 `git checkout -- package-lock.json` 丢掉这次重装（**变更操作**，别在别人工作树里顺手执行）。
6. **同一个包在 `npm ls` 里两个版本，且 React/Vue 报单例类错误** —— 范围重叠导致两份真实副本、两套模块状态。确认：`npm ls react` 看几处不同版本、`npm explain react` 查谁引入。修：`overrides`（npm）/`resolutions`（yarn）压成一个版本，压完必须重跑测试。
7. **`npm audit fix` 之后项目跑不起来，没人知道改了什么** —— 它可能改范围并跨版本更新，`--force` 甚至跨 MAJOR。确认：审 `git diff package.json package-lock.json`。修：回滚，再按本章的 audit 处置流程逐条判断（本站那 3 个漏洞就是「正确做法是不动并写下理由」的例子）。

## 练习

<Exercise title="练习 1 · 用只读命令实测三个范围各自能装什么" difficulty="基础">

在自己的终端里跑（**只读，不改任何东西**）：`npm view "vite@^5.0.0" version`、`npm view "vite@~5.0.0" version`、`npm view "vite@^0.9.0" version`。抄下条数与首末版本，回答：`~5.0.0` 为什么比 `^5.0.0` 少这么多？`^0.9.0` 证明了 0.x 的什么规则？`npm view vite versions --json` 一共列出多少个版本，而 `^5.0.0` 只解析出 67 个——这个比例说明什么？

<template #answer>

本章本机实测：`^5.0.0` → 67 个（5.0.0 … 5.4.21）；`~5.0.0` → 14 个（5.0.0 … 5.0.13）；`^0.9.0` → 2 个（0.9.0、0.9.1）。`~` 把上限收到 `<5.1.0` 只剩 5.0.x，`^` 的上限是 `<6.0.0` 于是整个 5.x 的正式发布都能被解析；Vite 一共发过 760 个版本，`^5.0.0` 只取到 67 个——**一个 `^` 字符把候选空间限到约 8.8%，同时留了 67 个可能漂移的位置**。`^0.9.0` 只有 2 个（按非 0 规则本应跨到整个 0.x），证明 **MAJOR 为 0 时 `^` 收窄到同一 MINOR**。数字之外的结论：`^` 不是「安全」，它是「把 67 次版本判断权交给上游」；要真稳就得让**锁文件**替你选那一个版本。

</template>

</Exercise>

<Exercise title="练习 2 · 用 outdated 的三列解释本站为什么锁 typescript" difficulty="进阶">

本章给出的本站原文是 `typescript Current 5.9.3 Wanted 5.9.3 Latest 7.0.2`，`package.json` 里写的是 `^5.9.3`。① 为什么 Wanted 不等于 Latest？② 如果把 `^5.9.3` 改成 `*`，`npm install` 之后 `npm run type-check` 会发生什么，报错原文的关键片段是什么？③ 这条报错的根因属于第 1 章讲过的哪个字段？

<template #answer>

① `Wanted` 是「在你声明范围内能升到的最高版本」，`^5.9.3` 上界 `<6.0.0` 而 5.x 里已无更高发布，所以 Wanted 就是 Current；`Latest` 是 `latest` 标签值（7.0.2），跨了 MAJOR，**不属于你声明的范围，永远不会被自动装进来**。② 改成 `*` 后重装拿到 7.0.2，而 `vue-tsc@3.3.13` 需要 `require.resolve('typescript/lib/tsc')`，TS 7 不再导出这个子路径，于是 `npm run type-check` 直接崩，关键片段是 `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './lib/tsc' is not defined by "exports"`（这段在仓库 README 里有记录）。③ 根因是 **`exports` 字段**——它是白名单，写了就等于关闭没列出的子路径。一个包的 `exports` 变化，跨一层变成另一个包的运行时崩溃，而 `package.json` 里连一行 diff 都没有。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造一个 npm ci 报错并修对它" difficulty="挑战">

在一份**自己项目的干净副本**（不要在站点仓库里做）手工编辑 `package.json`，把某个 devDependencies 改成 registry 上不存在的大版本（例如 `^99.0.0`），依次跑 `npm ci` 和 `npm install`。① `npm ci` 为什么必须失败？② `npm install` 会怎么处理同样这份文件，为什么这个处理在 CI 里危险？③ 正确的修复动作是什么？④ 什么情况下该用 `npm install pkg@具体版本` 而不是 `npm update pkg`？

<template #answer>

① `npm ci` 装之前做一致性校验：`package.json` 的每个范围都要能在锁文件里找到满足它的条目；`^99.0.0` 没有对应项 → 不一致 → 硬失败，这正是它被设计出来要做的事。② `npm install` 不会这么干脆：它会**去解析**（然后 `ETARGET`；如果你写的是一个真实存在的错版本，它**直接接受并改写锁文件**），也就是顺手把「你不该有的依赖树」写进仓库；把它写进 CI 等于每次不一致都自动放行。③ 让 `package.json` 回到与锁文件一致的状态（改回原范围，或本地跑一次 `npm install` 使两者同步、审 diff、一起提交），CI 继续用 `npm ci`。④ 当你**知道**要升到哪个版本时用 `npm install pkg@1.2.3`（意图明确、diff 可审）；`npm update pkg` 会顺带重排整棵树的合规版本，diff 常常上千行、无法评审。

</template>

</Exercise>

<Exercise title="练习 4 · 判断这个 audit 结论要不要修" difficulty="进阶">

假设 `npm audit --json` 告诉你某 `moderate` 漏洞影响 `foo@<=1.2.0`，你装的是 `1.1.0`，`fixAvailable: false`，而 `foo` 是**构建期**依赖（一个 Markdown 插件），你的产物是纯静态 HTML。参照本站 README 那三个漏洞的处置方式，写出你的四步判断，并给出提交信息应该写什么。

<template #answer>

四步：① **它在哪棵子树**——`npm ls foo` 确认只有 dev 路径引入、不在 `dependencies`；② **在我这里是不是攻击面**——该漏洞需要运行时接收恶意输入，而 `foo` 只处理仓库自己写的 `.md`，产物是静态 HTML、部署后不跑 Node 进程；③ **可修性**——`fixAvailable: false` 说明没有可用修复版本，硬修只能 `overrides` 跨到未测试版本；④ **决定与记录**——接受风险并设置复查触发条件。提交信息例如：「audit: 接受 foo@1.1.0 的 moderate 风险（GHSA-xxxx）。它只在构建期处理本仓库自有的 md，产物为纯静态文件，生产环境不运行 Node；`fixAvailable=false`，等上游发布 1.2.1 后随依赖升级一并处理。触发复查：foo 出现在 `dependencies`、或改为处理用户输入。」**这句话的价值大于那次安装**——半年后没人记得当时为什么没修，而没有理由的「没修」在审计眼里等同于疏忽。

</template>

</Exercise>

## 官方文档与延伸阅读

- [npm · 关于语义化版本](https://docs.npmjs.com/about-semantic-versioning) —— 核实「声明范围 → 可解析范围」那张表，尤其 `^`/`~` 的上界与 0.x 行为；**动手前用本章的 `npm view` 命令自己复现一次**。
- [Semantic Versioning 规范（中文版）](https://semver.org/lang/zh-CN/) —— 核实三段号定义、0 主版本条款、预发布排序规则。
- [npm · package-lock.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json) —— 核实 `lockfileVersion`（本机读到 3）、`packages` 结构与 `optional`/`os`/`cpu` 字段，即「锁文件锁整棵树」的出处。
- [npm ci](https://docs.npmjs.com/cli/v10/commands/npm-ci)、[npm install](https://docs.npmjs.com/cli/v10/commands/npm-install) 与 [npm audit](https://docs.npmjs.com/cli/v10/commands/npm-audit) —— 核实 `ci` 不跑 `prepare`、一致性校验的措辞，以及 `fixAvailable`、`--force` 的确切语义。
- [GitHub Advisory Database](https://github.com/advisories) —— 本章两个公告编号（GHSA-67mh-4wv8-2f99、GHSA-4w7w-66w2-5vf9）的原始出处，用来核实受影响版本区间。
- [pnpm 中文文档](https://pnpm.io/zh/) 与 [pnpm install](https://pnpm.io/zh/cli/install) —— 核实 `--frozen-lockfile` 与 `pnpm-lock.yaml` 结构；本章所有 pnpm 细节都未在本机验证。

## 下一章

第 1 章讲依赖的**空间**（装在哪、怎么被解析到），本章讲依赖的**时间**（同一范围在不同时刻解析出不同版本，锁文件是唯一固化手段）。下一章进入代码的时空：[Vite 开发侧：原生 ESM、预构建与 HMR](/frontend-engineering/vite-dev) 讲 Vite 为什么能在不打包的前提下启动、预构建在替你做什么、HMR 为什么会失效，以及一个本章已预支的结论——**本站的 `build` 脚本里没有类型检查**，所以 `npm run build` 退出码 0 不代表类型是对的，这一点在 [tsconfig 关键选项](/typescript/tsconfig) 里被称作本站最容易踩的工程坑。
