# 包管理：package.json 的每个字段、node_modules 的解析规则与 npm 与 pnpm 的布局差异

同事拉下你的项目，`npm install` 之后 `npm run dev` 报 `vite: command not found`；你 `import` 了一个从没装过的包，本地跑得通、CI 上 `Cannot find module`；重装依赖时磁盘报 `ENOSPC`。同一个根因：**你没把「依赖被装到哪里、又是怎么被找到的」想清楚。** `package.json` 是你与同事、构建工具、发布流程、半年后的你自己之间的合同，`node_modules` 的形状由一套确定的解析算法决定。

<Callout type="verified" title="本章实跑范围">

环境：Windows 10 x64、Node `v25.4.0`、npm `11.7.0`，日期 2026-10-17。实跑并采到原文的**只读**命令：`node --version`、`npm --version`、`npm ls --depth=0`、`ls node_modules/.bin`、`node node_modules/vite/bin/vite.js --help`，加上直接读取根 `package.json` 与 `package-lock.json`。本机**没有 pnpm 与 corepack**（`pnpm --version` 返回 `command not found`），所以 pnpm 的差异只给结论方向与官方链接、不写数字，统一标 unverified。本章没有执行安装、卸载、`npm ci`、`npm update`——站点自身的 `node_modules` 与锁文件动不得。

</Callout>

## 先看本站的真实数据：三行依赖，185 个包

根 `package.json` 的真实内容（本机原文节选）：

```json
{
  "name": "learns",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vitepress dev", "build": "vitepress build", "preview": "vitepress preview", "type-check": "vue-tsc --noEmit -p tsconfig.json" },
  "devDependencies": { "typescript": "^5.9.3", "vitepress": "1.6.4", "vue-tsc": "^3.3.13" }
}
```

`npm ls --depth=0` 的原文只有三行：`typescript@5.9.3`、`vitepress@1.6.4`、`vue-tsc@3.3.13`。**你只写了 3 个依赖**，但 `package-lock.json` 的 `packages` 里有 **185 个条目**，`node_modules` 顶层有 84 个目录（不含 `.bin`）：`vite@5.4.21`、`rollup@4.64.7`、`esbuild@0.21.5` 全在里面，都被标 `"dev": true`——它们是 `vitepress` 的传递依赖。

## package.json 逐字段：每个字段防哪一种事故

| 字段 | 作用 | 写错或漏写的后果 |
| --- | --- | --- |
| `name` | registry 上的唯一标识 | 含空格或大写时发布报 400 |
| `version` | 本包版本，必须合法 semver | 缺它时 `npm pack`/`publish` 失败；忘递增会把旧内容挂到新包名下 |
| `private` | `true` 时 npm **拒绝**发布 | 应用仓库没设，误 `publish` 把内部代码推到公网 |
| `type` | `.js` 默认语义：`module` 或 `commonjs` | 同时影响 Node 解析、TS 的 `moduleResolution` 与打包器 |
| `main` | CommonJS 时代的老入口 | 现代包只写它已不够，应写 `exports` |
| `exports` | 条件化入口映射 | **写了就关闭所有未列出的子路径** |
| `scripts` | 命令入口 | 见「scripts 的组织与跨平台的坑」 |
| `dependencies` | 运行时必需 | 少写一个，用户装完你的库直接崩 |
| `devDependencies` | 只在开发/构建期需要 | 放多了下游安装变慢；放少了 CI 找不到命令 |
| `peerDependencies` | 「我不装，但你必须提供且版本要对」 | 装了两份 React / Vue 的报错都来自这里 |
| `optionalDependencies` | 装失败也不影响安装成功 | 平台专属二进制包 |
| `overrides` | 强制改掉传递依赖的版本 | npm 写法；yarn/pnpm 叫 `resolutions` |
| `engines` | 声明要求的 Node 范围 | **默认只警告不阻止**，需配 `engine-strict` |
| `packageManager` | 该用哪个包管理器及版本 | 工具混用，两份锁文件互相打架 |

本机 `node_modules/vite/package.json` 原文是 `"engines": { "node": "^18.0.0 || >=20.0.0" }`——它是**给工具看的声明，不是强制协议**。

## exports 与 type：同时影响 Node、TS 和打包器

`exports` 是**白名单**：包里一旦出现它，Node 只允许你从列出的路径导入，其它子路径一律 `ERR_PACKAGE_PATH_NOT_EXPORTED`。本站 README 记录的故障原文：

```text
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './lib/tsc' is not defined
by "exports" in node_modules\typescript\package.json
```

TypeScript 7 不再导出 `./lib/tsc`，而 `vue-tsc@3.3.13` 内部要 `require.resolve` 它，于是直接崩——这就是本站把 `typescript` 锁在 5.x 的原因。**一个包 `exports` 的变化能变成下游另一个工具的运行时报错**，所以「包名没变、只是升了个版本」也可能完全跑不起来。

本机读到的 `exports` 键：`vite@5.4.21` 有 `.`、`./client`、`./runtime`、`./dist/client/*`、`./types/*`；`vitepress@1.6.4` 有 `./client`、`./theme`、`./theme-without-fonts`。`type` 决定 `.js` 按 ESM 还是 CommonJS 解释：本站是 `"type": "module"`，源码里写 `require()` 会失败、得改成 `.cjs`。`exports` 的条件键（`import`/`require`/`types`/`default`）决定不同环境各拿到哪个文件——Vite 开发模式直接按 ESM 提供服务，只有 `require` 分支的 CJS-only 包正是第 3 章「依赖预构建」存在的原因；对 TypeScript，`type` 与 `exports` 一起决定 `moduleResolution: bundler` 或 `nodenext` 能不能找到类型，规则见[模块与声明文件](/typescript/modules-and-declarations)。

## dependencies 与 devDependencies 的真实区别：谁会安装它

差别**不是**「运行用的放 dependencies、开发用的放 devDependencies」这种背法，真正的机制取决于**你发布的包是什么**：对**应用**（不发布），`npm install` 两类都会装，放错只影响体积、CI 耗时与语义；对**库**，消费者**只装 `dependencies`**，`devDependencies` 被完全忽略——构建期用的东西进了 `dependencies` 就是让用户多装一堆，运行期真 `require` 的进了 `devDependencies` 就是让用户装完直接崩。

判断表，每一项都问「删掉它，用户在我这里装完之后跑 `node` 会不会炸」：

| 依赖 | 放哪里 | 理由 |
| --- | --- | --- |
| `express`、`vue`、`axios`、`lodash` | `dependencies` | 生产代码 `import` 了它，运行时必须存在 |
| `vite`、`webpack`、`eslint`、`vitest`、`@types/*`、`sass` | `devDependencies` | 只在构建/开发/CI 里执行，类型靠 TS 擦除，产物里不再需要 |
| 写插件时的宿主框架（`react`/`vue`） | `peerDependencies` | 不想装第二份，要和宿主共用同一实例 |
| 平台专属二进制（`@esbuild/win32-x64`） | 由包自己声明 `optionalDependencies` | 见下面实测 |

**本站实测**：`package-lock.json` 里有 **50 个条目被标 `optional`**（样本 `@esbuild/aix-ppc64`、`@esbuild/android-arm`），`esbuild@0.21.5` 的 `optionalDependencies` 有 **23 项**，它的 `scripts` 里确实有 `postinstall`。这些是「按当前 CPU 和操作系统挑一个装」的原生二进制：Linux 服务器不会在 Windows 上下载 `win32-x64`，反之亦然——锁文件记录全部平台组合、只安装匹配的那个，这就是「锁文件锁的是整棵树」。诚实补充：本站锁文件里**没有任何包名出现超过一个版本**，所以下一节的「重复安装」来自解析算法本身，不是本站观测。

## node_modules 的结构与解析算法：逐级向上查找

[Node 官方 Modules](https://nodejs.org/api/modules.html) 里那条多年未变的规则：从当前文件所在目录开始找 `<目录>/node_modules/<包名>`，找不到就往上一层再找，一直到文件系统根，任何一层命中就停。

```text
D:\proj\src\utils\parse.js  import "vite"
  1. D:\proj\src\utils\node_modules\vite   不存在
  2. D:\proj\src\node_modules\vite         不存在
  3. D:\proj\node_modules\vite             命中，停止向上
```

npm 在这个算法之上做了**扁平化（hoisting）**：尽量把传递依赖提到顶层，只有版本冲突时才嵌套。三个后果全部来自这一处。**重复安装**：`a` 要 `helper@^1.0.0`、`b` 要 `helper@^2.0.0`，顶层只能放一个，另一个必须嵌进 `node_modules/b/node_modules/helper`，于是磁盘上两份、运行时是两个不同模块实例。对 React/Vue 这类「全局单例语义」的库这是致命错误——两份运行时各自维护 hooks 状态或响应式系统，报错形如 `Invalid hook call`；用 `npm ls <包名>` 数有几份，再用 `overrides`/`resolutions` 钉成一个。**幽灵依赖**：你从没写 `left-pad`，却因为某个直接依赖把它提升到顶层而解析成功；上游换个小版本、少装一个包、或你换了包管理器，这行 `import` 立刻变成 `Cannot find module`。**唯一正确做法：代码里 `import` 了什么，`package.json` 里就必须显式写什么。** **`npm dedupe`**：把因安装顺序被塞进嵌套目录的副本重新提上去，**只重排已有布局**，不改版本范围。

## npm 与 pnpm：布局差异，以及安装速度的差别从哪来

| 维度 | npm（默认扁平化） | pnpm（内容寻址 + 符号链接） |
| --- | --- | --- |
| 文件在哪 | 每个项目各自一份真实副本 | 全局 store 存唯一副本，项目里是硬链接 |
| 顶层 `node_modules` | 提升后的整棵树，顺手就能 import 未声明的包 | 只有**显式声明**的直接依赖，其余在虚拟目录 `.pnpm` 里 |
| 磁盘 / 速度 | 每项目独立复制，每次写完整棵树 | 同一版本全局只存一份，命中 store 时主要是建链接，通常显著更快 |
| 代价 | 无 | store 与项目须同一文件系统，跨盘退化成复制 |

pnpm 能默认阻止幽灵依赖：顶层只放你声明的直接依赖，其余住在 `.pnpm` 里用符号链接串起来，「逐级向上查找」在顶层找不到那个没声明的包，解析当场失败。代价是**依赖了提升却自己没声明**的老代码会直接崩在 `Cannot find module`——迁移后的第一批报错基本都是这个，那不是 pnpm 坏了，是它把一直存在的错误暴露出来。

<Callout type="unverified" title="上表右列没有在本机复现">

本机没有 pnpm，所以磁盘占用倍数、安装速度差值这类量化结论本章一个都没写。核实方向请读 [非扁平的 node_modules 结构](https://pnpm.io/zh/symlinked-node-modules-structure)与 [pnpm 中文首页](https://pnpm.io/zh/)，并在自己的项目里用一份干净副本实测。

</Callout>

## node_modules/.bin 与 npx 的实际行为

带 `bin` 字段的包，其入口会被链接/复制到 `node_modules/.bin/`。本机 `ls node_modules/.bin` 原文（节选）：`esbuild`、`esbuild.cmd`、`esbuild.ps1`、`rollup`、`tsc`、`tsserver`、`vite`……**每个命令有三个文件**：无后缀（POSIX shell）、`.cmd`（cmd.exe）、`.ps1`（PowerShell）。由此三条结论：`tsc`、`rollup`、`esbuild` 明明是传递依赖却出现在顶层，这本身就是扁平化的证据；`npm run <script>` 会**把 `node_modules/.bin` 临时加进 PATH**，所以脚本里写 `vitepress dev` 用的是本地版本，全局装不装都不影响 `npm run dev`；直接在终端敲它取决于你的 PATH——这就是「脚本里能跑、终端里 command not found」的根源。

`npx` 先在当前项目的 `node_modules/.bin` 里找，找不到就去 registry 拉包到临时缓存执行、用完不留依赖：`npx create-vite@latest` 的语义是「用最新版跑一次」而不是「安装它」。本章实跑：`node node_modules/vite/bin/vite.js --help` 第一行 `vite/5.4.21`，列出 `build`/`optimize`/`preview` 与 `--force`、`--host`、`--port`、`--strictPort`——我故意绕过 `.bin` 直接指向 `bin` 字段那个文件，这正是 `.bin` 里那个 shim 的作用，第 3 章讲 `--force` 时用到这条输出。

## 常用命令：npm 与 pnpm 对照

| 目的 | npm | pnpm |
| --- | --- | --- |
| 安装/补齐依赖（无参数时也会按范围升级、可能改锁文件） | `npm install` | `pnpm install` |
| 装一个包并记录（`-D`/`-P`/`-O` 决定放哪个字段） | `npm i x` | `pnpm add x` |
| 严格照锁文件装（CI 唯一正确选择） | `npm ci` | `pnpm install --frozen-lockfile` |
| 卸载 / 升级（同时改两个文件，`--latest` 突破范围） | `npm uninstall x` / `npm update` | `pnpm remove x` / `pnpm update` |
| 重排布局去重（只改放置位置，不改版本范围） | `npm dedupe` | `pnpm dedupe` |
| 为什么装了它（排查幽灵依赖的主力） | `npm ls x` / `npm explain x` | `pnpm why x` |
| 有哪些新版本（退出码非 0） | `npm outdated` | `pnpm outdated` |
| 本地包联调（绕过锁文件，见排查第 5 条） | `npm link` | `pnpm link` |

`npm ls` 遇到未满足依赖时会**以非 0 退出码**结束并打印 `UNMET DEPENDENCY`，在 CI 里直接 `&&` 串联会让流水线红——这是预期行为，不是命令坏了。

## scripts 的组织与跨平台的坑

`pre`/`post` 自动钩子是 npm 的特性：存在 `predev` 时 `npm run dev` 会先跑 `predev`，`pretest`、`prepublishOnly`、`prepare` 同理。**要当风险读，别当便利用**：钩子在脚本名里是隐式的，别人看不出 `npm run build` 实际跑了三件事，中间任意一步失败都会中断；更可读的写法是把顺序写进 `&&`，或用 `npm-run-all`/`concurrently`。

真实故障集中在跨平台：Windows 没有 `rm`、没有 `mv`，分隔符是 `\`，盘符冒号还会破坏 `PATH`。于是 `"clean": "rm -rf node_modules/.vite && vitepress build"` 在 macOS 好用、在 Windows 直接失败。两条正确思路：**删目录用 `rimraf`**（由 Node 实现，三平台一致，别用 cmd 专属的 `del /s /q`）；**设环境变量用 `cross-env`**（直接写 `NODE_ENV=production …` 在 cmd/PowerShell 里报 `'NODE_ENV' 不是内部或外部命令`）。组织原则：脚本名当动词用，把工具链写在脚本里而不是 CI 的 YAML 里，这样本地能一模一样复现 CI 的失败。

## 锁文件、engines 与 packageManager：本章只给入口

`package-lock.json`（本机读到 `lockfileVersion: 3`）与 `pnpm-lock.yaml` 解决同一个问题：`^5.9.3` 是**范围**，锁文件是**结果**——它把整棵树解析成精确版本加 `integrity` 校验，于是「按范围装」变成「按清单装」。为什么必须提交、`install` 与 `ci` 的严格差别，全在第 2 章 [语义化版本与锁文件](/frontend-engineering/semver-and-lockfile)。Node 版本与包管理器版本是两层约定：`nvm`/`fnm`/Volta 读 `.nvmrc` 决定 Node 版本，不影响包管理器；`engines.node` 是声明、默认不强制；`packageManager`（如 `pnpm@9.0.0`）配合 Corepack 决定用哪个包管理器——本机 `corepack` 不在 PATH 里，所以这段不来自实测。

## 本站为什么统一用 npm，以及迁移到 pnpm 的成本

本站示例全按 npm 写：npm 随 Node 一起装、零配置、绝大多数报错的搜索结果都是 npm 语境。换 pnpm 要先接受四件事：删掉 `package-lock.json` 重新生成（**同一仓库两份锁文件并存是明确的错误状态**）；幽灵依赖当场炸出来，只能个个补声明或临时 `node-linker=hoisted`（后者等于放弃 pnpm 的主要好处）；带 `postinstall` 的原生包可能被默认沙箱跳过构建；CI 要改缓存目录与安装命令。**只有一个锁文件的应用类仓库用 npm 完全没问题**，monorepo 才是 pnpm 的主场（第 11 章）。

## 常见错误与排查

1. **`command not found` / `'vite' 不是内部或外部命令`** —— 命令不在 `node_modules/.bin` 里，即这个包没装或没被声明为依赖。确认：`ls node_modules/.bin`（Windows 用 `dir node_modules\.bin`）、`npm ls <包名>`。修：`npm i -D <包名>`，然后**在 npm script 里调用它**。
2. **本地能 `import` 的包，CI 上 `Cannot find module`** —— 幽灵依赖。确认：`npm ls <包名>` 显示它被提升、而你 `package.json` 里没写。修：显式声明。
3. **`npm install` 报 `ETARGET`（形如 `Not found - <pkg>@^9.0.0`）** —— 你写的范围在 registry 上不存在（版本号打错、包被撤下、私服没同步）。确认：`npm view <pkg> versions --json` 列真实版本，配镜像源时先 `npm config get registry`。
4. **`ENOSPC`** —— 磁盘或 inode 不足，也可能是文件监视器上限（`df -h`、`df -i` 确认；inotify 上限则调大 `fs.inotify.max_user_watches`，Linux 参数，本机未验证）。Windows 上的另一类表现是长路径超过 260 字符导致成片 `ENOENT`（报错路径带 `node_modules\...\node_modules\...`）：启用「Win32 长路径」支持、把项目放浅层目录，或改用 pnpm（嵌套深度天然小）。
5. **怀疑 `node_modules` 坏了** —— **正确处理顺序**，别一上来就 `rm -rf node_modules`（顺手删掉缓存与 `.bin`，还会把「配置错」误诊成「依赖坏」）：① `npm cache verify`；② `npm ci`（严格按锁文件重装，它自己会清 `node_modules`）；③ 仍不对才手动删 `node_modules` 重装；④ 最后才是连锁文件一起删——这步**丢掉可复现性**，只在你要主动升级依赖时做，做完必须提交新锁文件。`npm link` 长期挂着是同类隐患：它绕开版本与锁文件约束，别人机器上路径不存在就报错；更稳的是 workspace（第 11 章 [Monorepo 与工作区](/frontend-engineering/monorepo)）或 `npm pack` 生成 tgz 本地安装。
6. **`npm ci` 报 `... package.json and package-lock.json are in sync`** —— 锁文件与 `package.json` 不一致（手改过、合并冲突解错、别人用了别的工具）。**不要**改用 `npm install` 绕过：本地跑 `npm install` 让两者同步、检查 diff 后一起提交，CI 继续用 `npm ci`。
7. **重装后构建行为变了，或锁文件一次改了几千行** —— 扁平化依赖安装顺序，重装可能得到**另一份同样合法但形状不同**的树。对比 `npm ls --all` 或锁文件 diff，先看 `package.json` 的范围有没有被改；diff 审不过来就拆成单独一次提交。

## 练习

<Exercise title="练习 1 · 用只读命令查出提升结果" difficulty="基础">

在你自己的项目里（**只用只读命令，不安装不卸载**）回答：① `npm ls --depth=0` 的顶层列表里，有哪些包**没有**出现在你 `package.json` 里？② `node_modules/.bin` 里同一个命令有几个文件，说明什么？③ 打开 `node_modules/vite/package.json`，抄下 `engines.node` 与 `exports` 的键，和本机 `node --version` 对照。

<template #answer>

① `--depth=0` 只打印直接依赖，**不该**出现额外条目；若打印出你没写的包，通常是你确实在 `package.json` 里写了它（或它报了 `UNMET DEPENDENCY`）。要看提升出来的传递依赖用 `npm ls --all` 或 `npm explain <包名>`。② 无后缀 + `.cmd` + `.ps1` 三个文件（本站原文 `esbuild`/`esbuild.cmd`/`esbuild.ps1`），说明 `.bin` 是**为不同 shell 各备一份 shim** 的目录，「命令能不能跑」取决于哪个 shell 在解析 PATH。③ 本机 `vite@5.4.21` 的 `engines.node` 是 `^18.0.0 || >=20.0.0`，Node `v25.4.0` 落在 `>=20.0.0` 分支里。**关键结论**：`./dist/client/*` 这种通配子路径说明该包允许下游直接引它的构建产物——不是所有包都这么大方，这解释了为什么有些包你 `import 'pkg/dist/foo.js'` 会报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

</template>

</Exercise>

<Exercise title="练习 2 · dependencies 与 devDependencies 换位实验" difficulty="进阶">

本站是**应用**不是库，把 `vitepress` 从 `devDependencies` 挪到 `dependencies` 之后 `npm run dev` 照样能跑。为什么这条改动「本地看不出问题」却依然该批评？写清：① 对应用与对库的差别；② 至少两个会让它真造成伤害的场景；③ 一条只读命令用来验证你的 `dependencies` 里没有构建工具。

<template #answer>

① 对应用：`npm install` 同时安装两类依赖，功能无差别，坏的只是语义。对库：消费者只装 `dependencies`，放错就是运行期崩溃或多装一堆工具。② 会真造成伤害的场景：这个包后来被拆成库发布，构建工具全被下游装了；CI 用 `npm install --omit=dev` 做生产安装提速，该在 dev 的工具跑不到、该在 `dependencies` 的被裁掉；安全扫描按 `dependencies` 判定「生产暴露面」，位置放错让审计结论失真。③ `npm ls --depth=0 --omit=dev`（或 `--prod`）只打印生产依赖，看里面有没有 `vite`/`eslint`/`typescript`。本站用它应当是**空树**，因为三条依赖全是 dev；没有生产依赖时它可能以非 0 退出码结束，属正常。

</template>

</Exercise>

<Exercise title="练习 3 · 读 npm ls 输出，判断该用 dedupe 还是 overrides" difficulty="挑战">

假设某个 Vue 项目里 `npm ls vue` 打印（示意，非本机数据）：

```text
my-app@1.0.0
├─┬ some-ui-kit@2.1.0
│ └── vue@3.4.21 deduped
├── vue@3.5.13
└─┬ legacy-chart@1.0.0
  └── vue@3.2.45
```

① 磁盘上有几份 Vue？② 该先试 `npm dedupe` 还是 `overrides`？③ 如果 `legacy-chart` 写的是 `vue@^3.2.0`，`dedupe` 能不能把它变成 `3.5.13`？

<template #answer>

① 三个版本共存、真实副本两份：顶层 `3.5.13` 一份，`legacy-chart` 里嵌套的 `3.2.45` 一份；`deduped` 表示 `some-ui-kit` 的版本已与树里别处共用文件。② 先跑 `npm dedupe`（只重排布局、不改版本，安全），无效再上 `overrides`。③ **能**，因为 `^3.2.0` 包含 `3.5.13`；但如果是 `3.2.x` 精确锁定或 `~3.2.0`，`dedupe` 无权跨范围升级，只有 `overrides` 能强改——那属于「无视依赖声明」，必须去看 `legacy-chart` 的 changelog 确认它能不能吃 3.5。强改后常见结果是「装上了但运行时报错」：**安装成功不等于兼容**。

</template>

</Exercise>

<Exercise title="练习 4 · 把 scripts 改成三平台可跑" difficulty="基础">

下面这段（示意）在 Windows 的 cmd 里跑不了，指出问题（不止一处）并给出修正版：

```json
{ "scripts": { "rebuild": "rm -rf .vite && NODE_ENV=production vite build && echo done > C:\out.txt" } }
```

<template #answer>

三处问题：① `rm -rf` 在 Windows 不存在 → 换 `rimraf .vite`；② `NODE_ENV=production vite build` 是 POSIX shell 语法，cmd/PowerShell 会把 `NODE_ENV=production` 当命令解析 → 换 `cross-env`；③ `C:\out.txt` 的反斜杠被当转义、硬编码盘符不可移植 → 用相对路径或工具的 `--outDir`。修正版 `"rebuild": "rimraf .vite && cross-env NODE_ENV=production vite build"`。跨平台脚本的思路是「把平台相关操作交给 Node 实现的包」，而不是学三套 shell 语法。

</template>

</Exercise>

## 官方文档与延伸阅读

- [npm · package.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-json) —— 核实逐字段表每一条，特别是 `exports`、`engines`、`overrides`、`optionalDependencies`；[npm install](https://docs.npmjs.com/cli/v10/commands/npm-install) 与 [npm ci](https://docs.npmjs.com/cli/v10/commands/npm-ci) 核实两者严格度差别与 `--omit`、`engine-strict` 开关。
- [npm · scripts](https://docs.npmjs.com/cli/v10/using-npm/scripts) 与 [folders](https://docs.npmjs.com/cli/v10/configuring-npm/folders) —— 核实 `pre`/`post` 钩子与「`npm run` 会把 `node_modules/.bin` 加进 PATH」。
- [Node.js · Modules](https://nodejs.org/api/modules.html) 与 [Packages](https://nodejs.org/api/packages.html) —— 逐级向上查找与 `exports` 条件映射的权威定义。
- [pnpm 中文文档](https://pnpm.io/zh/) 与 [非扁平的 node_modules 结构](https://pnpm.io/zh/symlinked-node-modules-structure) —— 核实布局差异与 Corepack/`packageManager` 启用方式；本章 pnpm 数字全部标了 unverified。另有 [rimraf](https://www.npmjs.com/package/rimraf)、[cross-env](https://www.npmjs.com/package/cross-env)。

## 下一章

本章讲「空间」：依赖装在哪儿、怎么被找到、`package.json` 每个字段承诺了什么。下一章讲「时间」：同一个范围在不同时刻会被解析成不同版本，于是「昨天能装今天装不出来」，而锁文件是唯一解药。[语义化版本与锁文件](/frontend-engineering/semver-and-lockfile) 给出 `^`/`~`/`>=`/`*` 的解析对照表、peer 冲突的三种解法与「本地好的线上坏了」的排查路径——**没有本章的解析算法，你无法理解锁文件在锁什么**。
