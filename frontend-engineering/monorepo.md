# Monorepo 与工作区：先看清提升和幽灵依赖，再决定要不要上

`npm install` 之后首页白屏，控制台写着 `Cannot read properties of undefined (reading 'map')`。你依赖的东西一个都没变，变的是它在 `node_modules` 里的**位置**。本章那个实验里，一个没有声明 `tiny-util` 的包照样把它 `require` 进来了，而且拿到的是 **2.0.0**，同时它依赖的那个库内部用的是 **1.0.0**——同一个进程里两份同名包，两份状态。

这就是 workspace 最容易被忽略的一面：`workspaces` 字段解决的是「本地包之间怎么互相引用」，而它顺带做的那件事是**把依赖摊平到上一层**。摊平带来安装快、体积省、`node_modules` 只有一份，代价是你的代码从此可以引用它没有声明的东西。第 1 章[包管理与依赖解析](/frontend-engineering/package-managers) 讲的是单个项目里这套规则，第 2 章[语义化版本与锁文件](/frontend-engineering/semver-and-lockfile) 讲的是范围与锁定；本章把两者放到多包场景下，那里每一个规则都会放大。

先说结论：**本站这类项目不该上 Monorepo**。本仓库根目录只有一个 `package.json`，里面没有 `workspaces` 字段，17 个领域目录只是 Markdown 的分组，不是包。这条判断怎么来的、什么情况下会反过来，是本章的主线。

## 什么时候该上，什么时候别上

| 信号 | 单仓库分目录 | 上 Monorepo | 拆多个仓库 |
| --- | --- | --- | --- |
| 部署单元数量 | 一个（静态站点、单体应用） | 多个可独立发布的包 | 多个，且团队边界清晰 |
| 共享代码的改动频率 | 低，或复制一份可接受 | **高**：类型定义、请求封装、UI 基元天天两边改 | 低，愿意为此付发布成本 |
| 谁负责发版 | 只有你 | 只有你也能撑，但要有版本纪律 | 各自团队 |
| 你能接受的构建时长 | 任意 | 需要缓存/增量时才值得 | 天然隔离 |
| 出现过的事故 | 「前端忘了同步后端类型」 | 尚未出现 | 「一个改动要开三个 PR」 |

**判据只有一条：共享代码是否已经让「同步」成为一项固定工作。** 如果答案是「还没有」，那么 workspace 带来的收益是零，而它的成本（幽灵依赖、发布顺序、CI 编排、工具选型）立刻开始计费。「大厂都这么摆」不是理由——这也是本章把「什么时候别上」放在最前面的原因。

## 实测：一个完全离线的 workspace 装出来是什么样

本机 `npm 11.7.0`、Node `v25.4.0`、Windows 10 x64、2026-10-18。为了让实验不依赖网络，所有外部依赖都用本地 `file:` 协议，**没有下载任何包**（`npm install --offline`，输出 `added 6 packages in 5s`）。

```text
mr/
  package.json                 name=mono-root, private=true, workspaces=["packages/*"]
  vendor/tiny-util/            自己写的包，name=tiny-util, version=1.0.0
  vendor/tiny-util-v2/         同名，version=2.0.0
  packages/shared/package.json name=@demo/shared, dependencies={ tiny-util: "file:../../vendor/tiny-util" }
  packages/app-a/package.json  name=@demo/app-a,  dependencies={ "@demo/shared": "1.0.0" }
  packages/app-b/package.json  name=@demo/app-b,  dependencies={ tiny-util: "file:../../vendor/tiny-util-v2" }
  packages/app-c/package.json  name=@demo/app-c,  没有 scripts、没有 dependencies
```

安装后的目录：

```text
$ ls node_modules
@demo  tiny-util

$ ls -la node_modules/@demo
lrwxrwxrwx ... app-a   -> /…/mr/packages/app-a
lrwxrwxrwx ... app-b   -> /…/mr/packages/app-b
lrwxrwxrwx ... app-c   -> /…/mr/packages/app-c
lrwxrwxrwx ... shared  -> /…/mr/packages/shared
```

四个 workspace 包在根 `node_modules` 下全是**指向各自源码目录的符号链接**——包括谁都不依赖的 `app-c`。这就是「本地包互相引用」的实现方式：没有拷贝、没有发布，改 `packages/shared/index.js` 立刻被 `app-a` 看到。

<Callout type="verified" title="本章 npm 侧结论的实测范围">

全部来自上面这一个离线 fixture。命令：`npm install --offline`、`ls -la node_modules/@demo`、`node -e "require('./node_modules/tiny-util/package.json').version"`、`node packages/app-a/index.js`、`npm ls --all`、`npm run build --workspaces --if-present`、`npm run build --workspaces --include-workspace-root --if-present`、`npm run build -w @demo/shared`、`npm query ".workspace"`、以及读 `package-lock.json` 的 `packages` 键。**pnpm 一次都没跑过**——本机 `pnpm -v` 报「no pnpm」，涉及 pnpm 的句子全部标注为文档核实或未核实。示例目录写完已删。

</Callout>

## 提升（hoisting）：根上那个位置只容得下一份

`app-b` 要 `tiny-util@2.0.0`，`shared` 要 `tiny-util@1.0.0`。安装结束后：

```text
$ node -e "console.log(require('./node_modules/tiny-util/package.json').version)"
2.0.0
$ ls packages/*/node_modules
tiny-util                 # 只有 packages/shared 下面有一份嵌套的
```

`npm ls --all` 的原文把这层结构画得很清楚：

```text
mono-root@1.0.0 D:\…\mr
├─┬ @demo/app-a@1.0.0 -> .\packages\app-a
│ └── @demo/shared@1.0.0 deduped -> .\packages\shared
├─┬ @demo/app-b@1.0.0 -> .\packages\app-b
│ └── tiny-util@2.0.0 -> .\vendor\tiny-util-v2
├── @demo/app-c@1.0.0 -> .\packages\app-c
└─┬ @demo/shared@1.0.0 -> .\packages\shared
  └── tiny-util@1.0.0 -> .\vendor\tiny-util
```

规则：**能提升到根 `node_modules` 就提升，版本冲突时只有一方占住根位，另一方退回自己目录下的嵌套副本**。谁占住根位由安装算法决定，不由你决定。`package-lock.json` 的 `packages` 段实测同时存在两个键——`node_modules/tiny-util`（根，2.0.0）与 `packages/shared/node_modules/tiny-util`（1.0.0），这份锁文件把结果钉死了，换机器不会变，但**「谁在根上」这件事本身依然不是你能声明的**。

提升的收益是安装时间与磁盘；代价是把「某个包在根上有没有、是哪一版」变成了一个由全树共同决定的隐式状态。这也是第 2 章强调锁文件必须提交的多包版本：包数一多，锁文件成了唯一能解释 `node_modules` 布局的东西。

## 幽灵依赖：没声明也 require 得到

`packages/app-a/index.js` 三行：`require('@demo/shared')`、`require('tiny-util')`、打印 `require.resolve('tiny-util')`。`app-a` 的 `package.json` 里**根本没有 `tiny-util`**。实测输出：

```json
{"shared":"shared 用了 tiny-util@1.0.0",
 "ghostResolvedFrom":"D:\\…\\mr\\vendor\\tiny-util-v2\\index.js",
 "ghostName":"tiny-util@2.0.0"}
```

三件事被这一行 JSON 同时证实：

1. **未声明的包能被引用成功**——Node 的模块解析是沿目录树逐级向上找 `node_modules`（权威描述见 [Node.js · Modules 的加载算法](https://nodejs.org/api/modules.html)），`packages/app-a` 往上两级就是根，那里躺着被提升的 `tiny-util`。
2. **它拿到的版本由提升结果决定，而不是由你决定**：根上是 `2.0.0`，而 `shared` 内部用的是 `1.0.0`。**同一个包名、同一进程、两份实例**，两份各自的模块级状态。
3. 这个 bug 不体现在 `package.json` 里。`app-a` 的声明看起来完全正确，`npm ls` 也不会告诉你「有代码引用了没声明的东西」。

真实伤害有三种：**① 上游把某个包从直接依赖挪成内部依赖（或删掉）时你的代码当场找不到模块**；**② 两份实例导致 instanceof 判断失效、单例被复制、Vue/React 出现「多个副本」的 notoriously 难查报错**；**③ CI 与本地不一致**——安装顺序或 semver 范围稍有差异，根上那一格换了人，幽灵就现形。

`npm` 与 `yarn`（默认）会提升，所以这三类问题都可能发生；`pnpm` 默认**不提升**，`node_modules` 里只有你显式声明过的包（真实包体放在内容寻址store，靠软链组织），幽灵依赖当场变成 `Cannot find module`。这是 pnpm 常被引用的卖点，方向上确实如此；但它在本机没跑过，具体默认值以 [pnpm 的非扁平 node_modules 结构](https://pnpm.io/zh/symlinked-node-modules-structure) 当前描述为准。真需要提升时它有 `node-linker=hoisted`、`shamefully-hoist`、`hoist-pattern` 这些开关名——**本章没有核实这些选项的当前拼写与默认值**，动手前查该页。

## 本地包之间怎么链接：npm 看版本范围，pnpm 看协议

上面 `app-a` 用 `"@demo/shared": "1.0.0"` 就链接成功了，实测 `npm ls` 显示 `@demo/shared@1.0.0 -> .\packages\shared`（`deduped` 那一行是同一条链的第二次出现）。npm 的规则朴素：**范围内有匹配的本地包就用符号链接，否则去 registry 拿**。这带来一个安静的风险——如果 `packages/shared` 的 `version` 字段被改成 `2.0.0`，`app-a` 里的 `"1.0.0"` 就不再命中本地包，npm 会去**下载同名线上包**，构建照样成功，只是链接断了。本地包名一旦和 npm 上已有包重名，这个坑随时踩到，所以 workspace 里的私有包要么用 `@你的scope`，要么全部 `private: true`。

pnpm 用显式协议解决这件事：依赖写成 `workspace:*`、`workspace:^`、`workspace:~`，**只允许链接本地包，本地没有就直接失败**，绝不偷偷去 registry。官方文档还写明发布时协议会被改写：`"foo": "workspace:*"` 在发布瞬间变成 `"foo": "1.5.0"`（[pnpm 工作区](https://pnpm.io/zh/workspaces) 核实到的原文）。npm 侧没有等价语法，`file:`/`link:` 只算勉强可用，别当成 workspace 协议用。

## 任务编排：npm 按字母序串行，不看依赖图

根目录跑 `npm run build --workspaces --if-present`，实测输出只有三段，顺序是**包名的字典序**：

```text
> @demo/app-a@1.0.0 build   →  [app-a] build
> @demo/app-b@1.0.0 build   →  [app-b] build
> @demo/shared@1.0.0 build  →  [shared] build
```

三条结论，都是这次真跑出来的：

- **`--if-present` 让没有 `build` 脚本的包静默跳过**（`app-c` 一条都没打印）。没有它，npm 会因缺脚本而报错——这是给整仓跑统一命令时唯一现实的写法。
- **`shared` 排在最后，尽管 `app-a` 依赖它。** npm 不做依赖拓扑排序。如果 `shared` 的 `build` 是「产出 `dist/` 供 `app-a` 消费」，这一条命令就会让 `app-a` 消费到上一次的旧产物：**构建成功，结果是旧的**。这是 workspace 编排最阴的一个默认值。
- **串行执行**，没有并行、没有缓存。加 `--include-workspace-root` 后根脚本最先跑：`mono-root → app-a → app-b → shared`。

定向执行靠 `-w`：`npm run build -w @demo/shared` 实测只跑 shared 一段。要按影响面跑（只重建受影响及其下游的包）需要别的东西：`npm query ".workspace"` 实测能列出四个包的名字与位置（`@demo/app-a@1.0.0 packages/app-a` 等），这是写自定义脚本的地基；但**「根据依赖图排序」这件事 npm 自己不做**。

真正提供拓扑编排 + 任务缓存的是 [Turborepo](https://turbo.build/repo/docs) 与 Nx 这一层：它们读 workspace 的依赖图，按拓扑序调度，并把每次任务的输入哈希→输出缓存起来，第二次没变化就跳过。**这两家的任何具体配置本章都没在本机跑过**，读它们是为了理解「大型 Monorepo 在解决什么问题」；对个人项目，这类工具通常是净负担——缓存失效逻辑本身就成了新的排查面。

## pnpm workspace：配置文件在根，glob 决定成员

`pnpm` 的成员定义不在 `package.json` 而在 `pnpm-workspace.yaml`，官方文档明确「工作区必须在根目录有 `pnpm-workspace.yaml`」，`packages` 字段用 glob 列举（`packages/*` 这种写法）：

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

与 npm 的三个差异（第一条来自文档核实，后两条属于常见写法、**本章未核实**）：一是文件位置不同，所以「pnpm 没认我的子包」第一步查的是根目录有没有这个 yaml；二是排除成员用带 `!` 的负向 glob；三是 glob 匹配的是**目录**，目录里没有 `package.json` 会被忽略而不是报错，容易配出「看着收了其实没收」的工作区。

<Callout type="unverified" title="pnpm 侧全部未在本机运行">

本机没有 `pnpm`（`pnpm -v` 失败），上面只核实了两件事：根目录必须有 `pnpm-workspace.yaml`、`workspace:` 协议在发布时会把 `workspace:*` 改写成真实版本，另外文档写明 `linkWorkspacePackages` 默认为 `false`（可设 `true` 或 `deep`，控制「范围内恰好有本地包时是否自动链接」）。**`-r`/`--filter` 的语法、catalogs、`node-linker`、`shamefully-hoist` 本章一律没核实**，照文档抄之前先打开 [pnpm 工作区](https://pnpm.io/zh/workspaces)、[Catalogs](https://pnpm.io/zh/catalogs) 与 [非扁平 node_modules 结构](https://pnpm.io/zh/symlinked-node-modules-structure) 三页对齐当前写法。

</Callout>

## 版本管理：三种姿势与各自的代价

| 方案 | 怎么做 | 适合 | 代价 |
| --- | --- | --- | --- |
| 全仓一个版本号 | 只给仓库打 tag，包版本要么不写要么全一样 | 一个人维护、不对外发布 | 无法只发其中一个包 |
| 每包独立版本 | 各包自己的 `version`，谁改动谁升版，发布前生成变更集 | 包要发布到 npm 或被外部消费 | 需要变更日志与发布纪律（社区做法是 changesets 一类工具，本章未验证） |
| 版本集中声明 | 公共依赖版本收到一处，多包引用同一份 | 依赖多、怕版本漂移 | 需要包管理器支持（pnpm 的 catalogs 属这一类，**语法本章未核实**）；npm 侧只能靠约定与 lint |

对号入座：**本站用的是第一种**（单一 `package.json`，`vitepress` 精确锁到 `1.6.4`，见 [semver 与锁文件](/frontend-engineering/semver-and-lockfile)）。将来若把 `.vitepress/theme` 拆成 `packages/ui`、把 Markdown 脚本拆成 `packages/tools`，第二种才有意义；而「前端 + 后端共享一份类型定义」这个最常见的动机，上第二种或第三种之前都要先回答：你真的需要独立发布它们吗？

## 三条替代方案，先试这三条

| 方案 | 怎么落 | 什么时候仍然不够 |
| --- | --- | --- |
| 单仓库分目录（**首选**） | 一个 `package.json`，`src/` 按功能分目录，相对路径或别名引用 | 需要独立发布，或不同目录的依赖树冲突严重 |
| git submodule | 把共享库作为独立仓库挂进来 | 边界很硬，但协作摩擦大，个人项目基本只剩痛苦 |
| 发内部 npm 包 | 私有 registry（或 verdaccio）发布，消费方按 semver 安装 | 每次改共享代码都要发版，反馈环从秒变分钟 |

本站前端部分（`.vitepress/theme`、`scripts/*.cjs`、17 个内容目录）就是第一行的实例：没有 workspace，也不需要——共享代码的同步是「改一个文件」而不是「同步两个仓库」。

## 常见错误与排查

1. **现象：`Cannot find module 'x'`，但 `x` 确实在 `node_modules` 里。** 原因：幽灵依赖被清理了——某天它不再被提升到根，因为另一个包的版本范围变了。确认：`node -e "console.log(require.resolve('x'))"` 看它从哪来；`npm ls x --all` 看有几份。修：在用到它的包里**显式声明**，然后重装。别靠 `--force` 把它请回来。
2. **现象：`instanceof` 全部为假、store 状态莫名丢失、Vue 报「onInit hook 找不到」这类副本症状。** 原因：同一个包两份实例（实测根上 `2.0.0`、嵌套 `1.0.0` 就是这种局面）。确认：`npm ls <包名>` 出现 `UNMET DEPENDENCY` 或多行不同版本即命中。修：统一版本范围让安装去重；去不掉就把它提到共享包里，别让两个叶子包各自持有。
3. **现象：改了 `packages/shared` 的构建产物，`app-a` 拿到的还是旧的。** 原因：`--workspaces` 按字典序串行，`shared` 排在消费者之后（实测）。确认：看命令输出的顺序，而不是有没有报错。修：拆两步 `npm run build -w @demo/shared && npm run build -w @demo/app-a`，或换按拓扑序编排的工具。
4. **现象：本地包没链接上，npm 下载了一个同名线上包。** 原因：`version` 与消费者写的范围不匹配（npm 按 semver 范围决定要不要用本地包，实测 `"@demo/shared": "1.0.0"` 命中才链接）。确认：`npm ls @scope/包名` 看有没有 `-> .\packages\…` 那条链接。修：范围写对；私有包一律 `private: true` 并用 scoped 名字，pnpm 项目改用 `workspace:` 协议。
5. **现象：`npm run test --workspaces` 在一棵没有 `test` 脚本的包上报错，整条流水线红。** 原因：缺脚本时 npm 报错。确认：单独 `npm run test -w 那个包`。修：一律加 `--if-present`（实测正是这个行为差异），或者补齐每个包的脚本骨架。
6. **现象：同一份代码，pnpm 项目里 `require` 自己没装的包立刻 `Cannot find module`，同事的 npm 里能跑。** 原因：pnpm 默认不提升、npm 默认提升，两个安装器对同一份代码给出不同结论。确认：把同一份代码在两个安装器下各跑一次。修：声明出来，别开 `shamefully-hoist` 把差异盖掉；一个仓库只认一个安装器，并把它写进 `packageManager` 字段与 README。
7. **现象：`node_modules` 里冒出一堆你没装过的包。** 原因：workspace 内某个包声明了它们，被提升到根，你才「看得见」。确认：`npm ls --all` 的树（本章实测那份原文就是标准答案的样子）。修：这是提升的正常结果，需要治理的是幽灵依赖，而不是手删目录。

## 练习

<Exercise title="练习 1 · 复现幽灵依赖" difficulty="进阶">

按本章 fixture 的目录结构搭一个最小 workspace（两个包 + 一个 `file:` 小依赖），让 `app-a` 只依赖 `@demo/shared`，然后在 `app-a` 的代码里直接 `require` 那个只有 `shared` 声明的包。（1）能跑起来吗？（2）打印 `require.resolve` 看它从哪来；（3）把根 `node_modules` 里那个包删掉再跑一次，说明你刚证明了什么。

<template #answer>

（1）**能跑起来**——实测输出 `ghostName` 是 `tiny-util@2.0.0`，而 `shared` 内部用的是 `1.0.0`。npm 把它提升到了根，Node 沿目录向上找到了不属于 `app-a` 声明的东西。

（2）实测 `ghostResolvedFrom` 指向 `mr\vendor\tiny-util-v2\index.js`：解析结果穿过了 `packages/app-a/`、`packages/`，停在根的 `node_modules` 软链上。**注意它解析到的是 app-b 的那个版本**，不是 `shared` 用的那个——幽灵依赖的版本由提升决定。

（3）删掉后 `Cannot find module 'tiny-util'`。这一步证明了关键一点：**这条 `require` 在源码里看起来完全合法，它的可行性由 `node_modules` 的布局决定**，而那个布局是别的包的依赖声明的副产物。修复不是把目录放回去，而是在 `app-a/package.json` 里显式声明，然后重装。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造一次多实例并解释症状" difficulty="挑战">

在 fixture 里把 `shared` 与 `app-b` 对 `tiny-util` 的范围改成互不兼容的两版（本章用的就是 1.0.0 与 2.0.0），给 `tiny-util` 加一行模块级状态：`exports.count = (exports.count || 0) + 1`。在 `app-a` 里先 `require('@demo/shared')` 触发内部使用，再直接 `require('tiny-util')` 读它的 `count`。（1）你会看到什么？（2）这个结构对应真实项目里哪两类事故？（3）怎么把它压成一份？

<template #answer>

（1）两份不同的 `count`：`shared` 内部那份在自增，`app-a` 直接读到的那份（根上的 2.0.0）计数不动。因为它们是**两个模块实例**，各有各的 `module.exports` 对象——实测那份 `npm ls` 树里就有两条 `tiny-util`（`-> .\vendor\tiny-util-v2` 与 `-> .\vendor\tiny-util`）。

（2）对应两类：**共享单例被复制**（配置、logger、store、事件总线各有一份，注册在 A 上的监听器收不到 B 的事件）；**`instanceof` 与私有字段判断失效**（跨份的类不是同一个构造函数，`x instanceof Foo` 恒假）。UI 库最出名的变体是「一个页面里装了两个 Vue/React 副本」。

（3）三条路：把两边范围收到一个可去重的区间（让安装只留一份）；把这个依赖从叶子包提到 `shared`，由 `shared` 统一对外暴露；或者干脆不让 `app-a` 碰它（消除幽灵依赖，正是练习 1 的结论）。判断标准：`npm ls tiny-util` 只输出一行才算完。

</template>

</Exercise>

<Exercise title="练习 3 · 判断该不该上 workspace" difficulty="基础">

四个场景各自选「单仓库分目录 / Monorepo / 多仓库」，并给一句理由：（a）个人项目，一个 VitePress 站点加十几套 Markdown 内容；（b）前端 + Fastify 后端，共享一套 40 个接口的 TS 类型；（c）你维护一个 UI 组件库，被三个自己的项目用；（d）一个实验性包，只在一个项目里用，可能三个月后删掉。

<template #answer>

**（a）单仓库分目录。** 内容目录不是包，没有独立构建、没有共享运行时代码，本站就是这个形状（一个 `package.json`，无 `workspaces`）。

**（b）Monorepo 收益最大，但先试更便宜的招。** 「同步类型」正是判据里那个固定工作。低成本起步：把类型放进 `packages/api-types`，前端 `import` 相对路径 + TS 的 `paths` 别名（见 [tsconfig 的 paths 代价](/typescript/tsconfig)），**先不建 workspace**；当类型开始需要被后端单独构建、或要防止前端 import 后端源码时，再上 workspace。上完之后共享类型的唯一真相源是一份，前后端各自从它生成，见[后端 API 文档](/backend/api-docs)那条路线。

**（c）Monorepo，或者发内部包。** 三个消费者 + 持续演进 = 独立版本有意义。如果组件库只在你的机器上被自己用，workspace 更省事（不用发版）；一旦有别人安装它，内部包的语义优势就压过便利性。

**（d）单仓库分目录。** 「可能三个月后删掉」意味着任何编排、版本、发布投入都会变成沉没成本。先放进 `src/experimental/`，真要长期共存再拆。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Node.js · Modules（模块解析算法）](https://nodejs.org/api/modules.html) —— 核实「逐级向上找 `node_modules`」这条，幽灵依赖的机制根因；本章 `require.resolve` 的实测结果就是它的直接体现。
- [npm 文档 · workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces) —— 该页是前端渲染的，**本章 WebFetch 取不到正文**，因此 npm 侧结论全部来自本机 `npm 11.7.0` 实测；页面措辞（尤其 `--if-present`、`--include-workspace-root` 的说明）请自行打开核对。
- [pnpm · 工作区](https://pnpm.io/zh/workspaces) —— 核实「根目录必须有 `pnpm-workspace.yaml`」、「`workspace:` 协议」、发布时 `workspace:*` 被改写为真实版本、`linkWorkspacePackages` 默认 `false` 四项。
- [pnpm · 非扁平的 node_modules 结构](https://pnpm.io/zh/symlinked-node-modules-structure) —— 核实「pnpm 默认不提升」这个方向的机制；`node-linker`、`shamefully-hoist` 等选项名与默认值请以该页当前内容为准。
- [pnpm · Catalogs](https://pnpm.io/zh/catalogs) —— 「版本集中声明」那一行的官方出处；本章**没有核实**其语法。
- [Turborepo 文档](https://turbo.build/repo/docs) —— 核实「任务编排 + 缓存」这一层的定位，即 npm `--workspaces` 串行无拓扑序所缺的那块；具体配置本章未运行。
- 站内回指：[包管理：npm 与 pnpm](/frontend-engineering/package-managers)（单个项目的解析规则）、[语义化版本与锁文件](/frontend-engineering/semver-and-lockfile)（范围怎么去重、锁文件为什么必须提交）、[环境变量与配置管理](/frontend-engineering/env-and-config)（多包时 `.env` 目录与 `loadEnv` 第二个参数的坑）、[阶段项目：工程化体检](/frontend-engineering/project)（本章最后一条判断——「该不该上」——正是体检清单里的一项）。

## 下一章

这一章把一个 workspace 拆开装了：符号链接怎么建、提升把谁放上根位、幽灵依赖为什么「看起来合法」，以及 `--workspaces` 的字典序串行会让谁消费到旧产物——每一条都是本机跑出来的原文，只有 pnpm 与编排工具那两层留在文档里。判据始终是同一个：**共享代码有没有让「同步」变成固定工作**。到这一步，前 11 章的工具、规则与判据都齐了，缺的只是把它们一次性压到一个真实项目上：谁在负责安装、产物里有没有不该出现的东西、二次访问命中了多少缓存、测试能不能拦住重构。下一章 [阶段项目：工程化体检](/frontend-engineering/project) 就是这套东西的验收——产出一份能勾选、能复跑、能交给别人照着操作的证据，而不是「我觉得配好了」。
