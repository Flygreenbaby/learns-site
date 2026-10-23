# Vite 开发侧：为什么不用打包就能启动，以及改了为什么有时候不生效

按 `npm run dev`，终端 300 毫秒就打印 `Local: http://localhost:5173/`；改一行 CSS 立刻更新，改另一个文件整页刷新、填了一半的表单被清空，改第三个文件**什么都没发生**。最贵的那个现象是 `npm run build` 退出码 0、上线、白屏——你后来才知道 Vite 在开发和构建时**都只转译、不检查类型**，而 `tsc --noEmit` 从来没在任何流程里真正跑过。这些现象背后是同一套机制：开发服务器按请求逐个模块干活，预构建决定 npm 包以什么形态喂给浏览器，HMR 决定改动沿哪条路径传播。

<Callout type="verified" title="本章实跑范围与原文输出">

环境：Windows 10 x64、Node `v25.4.0`、npm `11.7.0`，日期 2026-10-17。实跑的**只读**命令：`node node_modules/vite/bin/vite.js --help` → 第一行 **`vite/5.4.21`**，子命令 `[root]`（启动 dev server）、`build`、**`optimize`**（pre-bundle dependencies）、`preview`，选项含 `--force`（原文注释：force the optimizer to ignore the cache and re-bundle）、`--host`、`--port`、`--strictPort`、`-c, --config <file>`、`-m, --mode <mode>`、`-d, --debug [feat]`。`ls .vitepress/cache` 的真实结果只有一个条目：**`deps_temp_1c1d6a3f`**，**没有 `deps` 目录**（`deps_temp_*` 是预构建被中断留下的中间目录）。

**未在本机执行**：`vitepress dev`、`vitepress build`、任何会写入 `.vitepress/cache`、`.vitepress/dist` 或 `node_modules/.vite` 的命令；`--host`、`server.proxy`、HMR 的实际网络行为只给配置与预期结果。机制描述以 [Vite 官方文档](https://vite.dev/guide/) 当前版本为准。顺带一个只读手段：`optimize [root]` 子命令**只做预构建、不起服务器**，适合单独观察预构建产物而不掺入服务器与 HMR 的变量（`vite optimize --force` 会写缓存，属变更操作，本站没有执行过）。

</Callout>

## 为什么能不打包就启动：把「解析依赖图」推给浏览器

打包式 dev server 的流程是**先解析并打包整张模块图，再启动 HTTP 服务**：应用有 2000 个模块，启动时间就正比于这 2000 个模块。Vite 的开发模式换了立足点：**浏览器原生支持 ES Modules**，`<script type="module">` 里的 `import` 会被浏览器自己解析、自己发请求、自己求值。于是服务器不需要预先知道整张图，只需要：① 返回 `index.html` 并把入口脚本改写成浏览器能解析的绝对 URL；② 收到某个模块的请求时**只转换这一个文件**（TS/JSX → JS、SCSS → CSS、Vue SFC → JS）；③ 把结果里的 import specifier 改写成可请求的 URL，浏览器读到后自然会来要下一个模块。模块图因此**边加载边形成**，冷启动成本与「第一屏真正需要的模块数」有关而非项目总大小——这是 Vite 启动快的全部秘密，也是代价的来源：冷启动基本恒定，但首个页面是**瀑布式**的（每个模块一次请求，几乎必须靠 HTTP/2 多路复用压平）；dev 与 prod 是**两套完全不同的流程**（第 4 章）；而未预构建的 CJS 依赖**不能直接喂给浏览器**，必须预构建——这是下一节的主题。

顺带一条实测边界：README 记录把 `dist/index.html` 用 `file://` 双击打开，模块脚本加载失败、搜索面板打不开——浏览器不允许从 `file://` 加载 ES module。**不打包靠的是浏览器实现 ESM，而浏览器实现 ESM 靠的是 HTTP 同源语义**；没有 HTTP 服务器，这套机制整个不成立。

## 从 npm create vite 到页面跑起来的六件事

```bash
npm create vite@latest my-app
cd my-app && npm install && npm run dev
```

1. **解析配置**：读 `vite.config.ts`（找不到则试其他后缀）。配置本身是 TS、需先转成可执行 JS——**Vite 用自己的机制编译你的配置**，这就是配置里能 `import` 插件包的原因。
2. **装配插件**：本章先记两类——把源码变成 JS 的**框架插件**（`@vitejs/plugin-vue` 等，它同时负责 HMR 的 accept 边界），和把 npm 依赖变成合法 ESM 的 **dep optimizer**。
3. **确定根目录与入口**。
4. **依赖预构建**（`optimizeDeps`）：扫描入口 HTML 与源码里的裸 import，把不是浏览器 ESM 的东西打包成 ESM。**首次要真打包，所以第一次启动慢、之后走缓存**——那句 `optimizing dependencies` 就出自这里。
5. **启动 HTTP 服务器 + WebSocket 通道**：WS 用来推送「哪些模块失效了、该怎么响应」，默认端口 5173（README 原文）。
6. **浏览器逐个请求模块、服务器按需转换返回**：第一屏期间若又发现新的未预构建依赖，触发下文 `Optimizing new dependencies`。

## 依赖预构建做了什么，为什么必须有这一步

预构建做三件事，每件都对应一个必须做的理由：**把 CommonJS / UMD 转成 ESM**（浏览器的 ESM 实现无法解析 `require` 和 `module.exports`，不转换就返回一份语法非法的 JS）；**把几百个碎文件合并成一个**（一个 UI 库可能有上千个模块，逐个请求会让首屏变成上千次 HTTP 往返）；**缓存到 `node_modules/.vite/deps`**（这些产物只在依赖版本变化时才需重算，走缓存后启动才是「秒开」）。

**缓存失效条件**（这就是「为什么有时启动又慢了一次」的答案）：锁文件里依赖版本变了、配置里影响预构建的字段变了（`optimizeDeps` 相关项、`mode`）、`NODE_ENV` 变了、或缓存目录被删。Vite 用一份 `_metadata.json` 记录这些指纹做一致性检查，指纹不匹配就重建；`--force` 的作用就是**无视缓存重新打包**（实测 `--help` 原文正是这样描述它的）。需要微调时，把预期外发现的依赖写进 `optimizeDeps.include`，把已经是合法 ESM 且不想被合并的包写进 `optimizeDeps.exclude`。

<Callout type="warn" title="Optimizing new dependencies 导致整页重载：成因与避免">

**成因**：预构建基于启动时的**静态扫描**。当浏览器在运行中请求了一个扫描时没预料到的依赖——典型是把包名拼进变量再动态 `import()`，或依赖只出现在某条运行时分支里——服务器只能当场补做预构建；补做后同一依赖的 URL 变了（文件名/查询串带缓存标记），已加载旧 URL 的模块全部作废，**Vite 只能整页重载**。于是你看到「点开某个页面，闪一下，回到顶部，表单清空」。避免手段按性价比排序：① 把这类依赖显式列进 `optimizeDeps.include`，让它在启动时就被预构建（这条配置存在的首要理由）；② 别把包名或路径拼进变量交给 `import`，改用显式路径表或 `import.meta.glob`。

</Callout>

## HMR 的原理：失效沿 ESM 边界向上冒泡，直到遇到 accept

一次文件变更的链路：① 文件监听器捕获变更，服务器在**模块图**里把这个模块标成失效；② 通过 WebSocket 向浏览器推送失效列表；③ 浏览器从失效模块开始**沿 import 关系向上冒泡**，寻找声明了「我能接受这个更新」的模块：

```js
// 手动接受热更新的最小腿架（示意，非本站代码）
export function render() { /* ... */ }

if (import.meta.hot) {
  import.meta.hot.accept((mod) => mod.render())
  import.meta.hot.dispose(() => { /* 清理副作用：定时器、事件监听 */ })
}
```

④ **找到 accept 边界** → 执行 dispose、替换模块导出、调用 accept 回调，组件实例不销毁所以状态留着；⑤ **冒泡到根都没人 accept** → 整页重载（`full-reload`）；⑥ 失效模块是 CSS 时，Vite 直接替换样式表内容，不走 accept、也不需要 reload。框架插件把第 ④ 步做厚：Vue 插件给每个 `.vue` 的渲染函数注入 accept 能力，替换时**复用已有组件实例的 state**；React 插件配合 Fast Refresh 靠 hook 顺序把 state 留在实例上。**结论：状态能不能保住，取决于「失效链上有没有一个会保留状态的 accept」，而不是取决于「你有没有刷新浏览器」。**

注意 `import.meta.hot` **只在开发服务器里存在**，生产构建里是 `undefined`：任何手写热更新的代码都必须先判断它有没有值，否则 `npm run build` 之后的产物一执行到这行就抛错——这正是「本地一切正常，上线才崩」的典型形状之一。原则：**能用框架自带的 HMR 就别手写 accept**，手写只在这两类场景合理：模块自己需要清理副作用，或你确实要在不重载页面的前提下换掉一份数据（如练习 3 的文案字典）。

常见失效场景：

| 现象 | 原因 | 怎么修 |
| --- | --- | --- |
| 终端打印 `page reload` 而非 `hmr update` | 没有任何模块 accept 这个变更（纯 JS/TS 模块，或改了入口链上的模块） | 在合适的父边界 accept；或接受这类文件必须整页重载（路由表、i18n 字典本来就是） |
| 热更新「做了但界面没变」 | accept 回调里没重新渲染，或组件纯 props 驱动而父级没重渲染 | 交给框架插件，别手写 accept；或把回调补完整 |
| **表单状态每次改动都丢** | 状态写在模块顶层变量里，整页重载就重新初始化 | 状态移进组件实例（setup 里的 `ref`/`reactive`），或用有 HMR 处理的状态层（[Pinia](/vue/pinia)） |
| 改了被引用的模块，引用方不更新 | 循环依赖，或 import specifier 让服务器解析到另一个 URL，或解析到两份实例 | 拆循环依赖；`vite --debug` 看模块解析；多实例见第 1 章与 `resolve.dedupe` |
| WS 反复断开、客户端一直重连 | 反向代理切断或没转发 upgrade | 代理必须支持 upgrade 转发；或显式配 `server.hmr` 相关项（选项名以官方文档为准） |

## 源码转换只做转译：这是本站最容易踩的工程坑

Vite 在 dev 与 build 里对 TS/TSX/JSX 的处理是**逐文件转译（transpile only）**：删类型注解、把 JSX 变函数调用，**不做类型检查，也不做跨文件推断**。所以这条等式不成立：

```text
npm run build 退出码 0   ≠   类型是对的
```

本站的真实证据（本机 `package.json` 原文）：`"dev": "vitepress dev"`、`"build": "vitepress build"`、`"type-check": "vue-tsc --noEmit -p tsconfig.json"`——`build` 里**没有**类型检查，`type-check` 是独立一条，谁忘了单独跑它类型检查就等于没做。正确做法是把两步串起来（`"check": "npm run type-check && npm run build"`）并让 CI 跑这一条。`tsc --noEmit` 为什么必须在构建之外单独跑、`skipLibCheck`/`strict` 各防什么，见 [tsconfig 关键选项](/typescript/tsconfig)；类型在模块与 `exports` 层面怎么被找到，见 [模块与声明文件](/typescript/modules-and-declarations)。

<Callout type="unverified" title="转译器名字会随版本变，结论不会">

本站 `package-lock.json` 里真实的转换相关依赖是 `esbuild@0.21.5` 与 `rollup@4.64.7`（Vite 5 的组合）。较新的 Vite 大版本引入了 oxc 相关的转换路径，具体版本对应关系我没有逐项核对，以官方文档为准。**只需要一个结论：转译器只做逐文件语法转换，类型检查永远是另一道工序，必须由你在流程里显式跑。**

</Callout>

## alias、resolve.dedupe 与「为什么这里有两份一样的包」

```ts
// vite.config.ts（示意）
export default {
  resolve: {
    alias: { '@': '/src' },
    dedupe: ['vue', 'pinia', 'vue-router'],
  },
}
```

`resolve.alias` 解决**书写与解析**（`@/utils/foo` 不用一堆 `../../..`），但**关键约束**是：alias 只作用于 Vite 的解析，TypeScript 不知道它存在——你必须同时在 `tsconfig.json` 里写 `paths`，否则编辑器可能不报错、构建也过，但 `tsc --noEmit` 一片 `TS2307 Cannot find module '@/utils/foo'`。`resolve.dedupe` 解决**多份实例**：当同一包名能从不同路径解析到不同文件时（pnpm 严格布局、monorepo 提升、嵌套副本），它让 Vite 解析时优先复用同一份。这是第 1 章「重复安装导致两份运行时」在**开发服务器层面**的补丁——它不修 `node_modules` 的物理布局、也不修锁文件，真要收敛版本用 `overrides`。

## server.proxy：本地联调后端

```ts
// vite.config.ts（示意）
export default {
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,      // 把请求头 Host 改成 target，很多后端会检查这个
        ws: true,                // 转发 WebSocket 升级（实时接口必须开）
      },
      '/uploads': { target: 'http://127.0.0.1:3000', rewrite: (p) => p.replace(/^\/uploads/, '') },
    },
  },
}
```

三个必须理解的点：① **代理只影响 dev server**——`build` 出的静态产物里 `/api` 依然相对当前站点根，线上要么同源部署（由 Nginx 反代 `/api`，见 [Linux · Nginx](/linux/nginx)），要么把 baseURL 交给环境变量（第 10 章），「本地能调后端、上线 404」基本都是忘了这一条；② **`changeOrigin` 与 `ws` 是两个层次的问题**——前者只改请求头，后者决定是否转发 WebSocket 升级，`ws: true` 没配的表现是「请求看起来发出去了，但连接永远连不上」（服务端部分见 [/backend/](/backend/)）；③ **别用代理绕 CORS**——代理的意义是让浏览器只面对同一个源，生产环境该由后端把允许的来源写清楚。

## 环境变量：只暴露带 VITE_ 前缀的那些

```ts
const apiUrl = import.meta.env.VITE_API_URL   // 会被打进产物
const secret = process.env.DATABASE_URL        // 浏览器里永远拿不到，也不该想拿
```

Vite 把 `.env` 里**以 `VITE_` 开头**的变量注入 `import.meta.env`，其余不暴露给客户端；这些值是在**构建时内联**进产物的，改了必须重新构建。所以「前端环境变量」不是秘密存储，只是构建期常量注入。完整规则（哪些文件按什么优先级加载、mode 与 `--mode` 怎么配合、内置的 `BASE_URL`/`MODE`/`PROD`/`DEV`）在第 10 章 [环境变量与配置管理](/frontend-engineering/env-and-config) 单独讲，那里也会讲「把密钥写进 `VITE_` 然后打进 `dist/`」这类事故的验证方法。

## 排查「改了没生效」：按层顺序走，不要一上来就 --force

| 层 | 症状特征 | 只读确认手段 | 处理 |
| --- | --- | --- | --- |
| ① 浏览器缓存 | 终端明明打出 `hmr update`，界面就是不变 | DevTools Network 勾 `Disable cache`，看那个 JS/CSS 是不是 `from disk cache` | 硬性重新加载。**先排这一层，成本最低** |
| ② 连的不是这个进程 | 你改 A 目录、屏幕上是 B 的效果；或有两个 dev server | `netstat -ano \| findstr :5173`（Windows）/ `lsof -i :5173`；看终端标题里的 root 路径 | 杀掉旧进程再启，`--strictPort` 防静默换端口 |
| ③ 模块图/缓存层 | 冷启动才出现 `Optimizing dependencies`；某些改动 reload、某些没反应 | `--debug` 看解析与 HMR 事件；`npm ls <包名>` 看是否两份实例；确认 alias 与 `tsconfig paths` 成对 | 删缓存目录后重启；确认无误再上 `--force` |
| ④ 文件根本没被看住 | 终端**完全无输出**，硬刷新也拿不到新内容 | 文件在 `node_modules`/缓存/被 `server.watch.ignored` 排除的目录里？编辑器写的是软链接或另一份路径？WSL 跨边界？ | 移出忽略清单或修工作目录 |

顺序要点：**③ 的删缓存永远排在 ①② 之后**。缓存不是第一嫌疑人，进程和浏览器才是；先 `--force` 会让你失去「这次改动到底有没有触发 HMR 事件」这条最重要的观察机会。

## 本站（VitePress 站点）作为对照实验台

- 配置在 `.vitepress/config.mts`，`vitepress dev` 与 `vitepress build` **读同一份配置**——「dev 与 build 是两套流程，但配置是一份」，第 4 章逐项拆开。
- 现场残留 `deps_temp_1c1d6a3f` 而无 `deps`；预构建缓存落在 `.vitepress/cache` 而非默认 `node_modules/.vite`，说明缓存目录可配置、「删缓存」这步要找对路径；`npm run dev` 默认 5173、`npm run preview` 默认 4173；`type-check` 是独立脚本、不在 `build` 里——最后这条是「转译不检查」的直接证据。

这些路径（`.vitepress/config.mts`、`package.json`、缓存目录）**只读**：看配置、看版本号、看 `deps_temp_*` 现场都行，但不要改这些文件，也不要为了复现某个现象删缓存或跑 `--force`——这个仓库的 `node_modules` 与锁文件是站点自身能构建的前提。想做破坏性实验，请另开一个 `npm create vite@latest` 出来的空项目。

## 常见错误与排查

1. **`[vite] Internal server error: Failed to resolve import "xxx"`** —— 包名没装（或没声明，即第 1 章幽灵依赖）、alias 路径写错、或大小写不一致（Windows 不敏感、Linux 敏感）。确认：`npm ls xxx`、`vite --debug` 看它按什么路径解析。修：补声明或改路径，别用 alias 盖住问题。
2. **终端出现 `Optimizing new dependencies` + 页面 reload，表单内容被清掉** —— 运行中新发现未预构建的依赖，重新预构建后 URL 变了。修：把那类依赖写进 `optimizeDeps.include`；检查有没有把包名拼进变量的动态 `import()`。
3. **改了 `.ts` 里的类型错误，dev 毫无反应，`build` 也照样成功** —— 转译器不检查类型（本章核心那条）。修：在流程里显式跑 `tsc --noEmit`（本站是 `vue-tsc --noEmit -p tsconfig.json`），接进 CI 与提交前检查，见 [tsconfig 关键选项](/typescript/tsconfig)。
4. **改 `vite.config.ts` 不生效** —— 配置文件不在热更新范围内，某些字段只在启动时读一次。确认：终端有没有打印 `server restart`。修：重启 dev server；影响预构建的字段改完还要处理缓存（必要时 `--force`）。
5. **`npm run preview` 打开是空白或样式全丢** —— `base` 不匹配，或把 `dist` 放在子路径下访问（README 专门写了子路径部署要改 `base`）。确认：Network 里资源请求路径是 `/assets/...` 还是 404。修：核对 `base`（第 4 章展开）。**这不是 HMR 问题，别在 dev 侧找原因。**
6. **每次启动都重新预构建，缓存像没生效** —— 缓存目录被删（脚本每次 `rimraf node_modules`）、依赖版本每装必变（`^` 撞上上游新 MINOR，见第 2 章）、或 `mode`/`NODE_ENV` 每次不同。修：用锁文件钉住版本，别在开发脚本里顺手删整棵 `node_modules`。
7. **同一页面两个 Vue/React 实例，`Invalid hook call` 或 inject 拿到 undefined** —— 解析到两份包（嵌套副本、pnpm 严格布局、monorepo 提升）。确认：`npm ls vue` 出现两个不同路径/版本。修：`resolve.dedupe` 治开发服务器、`overrides` 治依赖树，两个都要（第 1 章）。

## 练习

<Exercise title="练习 1 · 用只读命令确认你连的是哪个 Vite 与哪些选项" difficulty="基础">

在自己项目里跑（**只读，不启动服务器、不写缓存**）：

```bash
node node_modules/vite/bin/vite.js --help
node -p "require('./node_modules/vite/package.json').version"
npm ls vite
```

回答：① 本机这份 Vite 的版本？② `--help` 里有没有 `optimize` 子命令、`--force` 的原文注释怎么写？③ `npm ls vite` 说明它是直接依赖还是传递依赖？

<template #answer>

本章在本站的实测结果：① **`vite/5.4.21`**（`--help` 首行，第二条命令也确认 5.4.21）。② 有 `optimize [root]  pre-bundle dependencies`；`--force` 的原文注释是 **`force the optimizer to ignore the cache and re-bundle`**——这句话把 `--force` 限定在**优化器缓存**，它不是「什么都不缓存地重启」，所以「改了源码不生效」时它未必是对的工具（源码那层走文件监听与模块图，见排查表 ③④ 层）。③ 本站的 vite 不是根包 `learns` 的直接依赖，它由 `vitepress@1.6.4` 带进来、锁文件里标 `dev: true`、路径是被提升后的顶层 `node_modules/vite`——所以在站点里改 `vite` 版本**没有意义且危险**，真正决定它的是 VitePress 的依赖范围。

</template>

</Exercise>

<Exercise title="练习 2 · 故意让类型错误穿过构建" difficulty="进阶">

在**自己的**一个 Vite 项目里（不是本站仓库）临时写一段必然的类型错误（例如把 `string` 赋给 `number`），依次跑 `npm run dev`、`npm run build`、`npx tsc --noEmit`。① 三条命令各自什么结果？② 这个差异说明 Vite 的什么架构事实？③ 给出两种把检查真正接进流程的做法并说明各自代价。

<template #answer>

① `dev` 与 `build` **都不报类型错误**（正常产出），只有 `tsc --noEmit` 报错。② 转换与检查是两个进程的职责：Vite 的 TS 处理是**逐文件转译**（删类型、改语法），拿不到跨文件类型信息，也没有 `tsconfig` 的 `strict` 语义，所以「构建成功」从来不是「类型正确」的证据。③ 做法一：串起来（`"build": "tsc --noEmit && vite build"`），代价是本地构建变慢，但 CI 与本地一致；做法二：CI 单独一步跑类型检查，代价是**必须确保这一步不可跳过**。补充：开发终端常驻 `tsc --noEmit --watch`，代价是多一份 CPU/内存，但反馈最快。

</template>

</Exercise>

<Exercise title="练习 3 · 定位一次整页重载" difficulty="挑战">

你在一个 Vue 项目里改 `src/i18n/zh.json`，页面整页重载、筛选状态丢失，终端打印 `page reload`。请写出四步定位（每步一条只读命令或一个观察点）与对应修法。

<template #answer>

① **确认失效链顶端是谁**：用 `vite --debug hmr` 启动（实测 `--help` 里 `-d, --debug [feat]` 存在），看打印的是 `hmr update` 还是 `page reload` 以及那个路径——这一步区分「有人 accept 但没起作用」与「根本没人 accept」。② **看这个文件被谁 import**：`zh.json` 通常被 i18n 初始化模块 import，而那个模块被入口 `main.ts` import；入口在冒泡终点、没人能 accept 它，所以必然 full-reload。修法：把 accept 边界**下移**到 i18n 模块自己（在 `import.meta.hot.accept` 里调用类似 `i18n.global.setLocaleMessage` 的接口，换文案而不销毁实例）。③ **检查 JSON 的导入形态**：Vite 对 `.json` 有专门导入规则，不同写法会改变模块标识、从而可能每次都触发 full-reload；具体哪几种查询串成立**请以官方 features 页 JSON 一节为准，别按记忆猜**（本章没实测过这条）。④ **区分文案热更新与页面结构热更新**：路由表、菜单结构、构建期常量 full-reload 是**正确的**，不该为它们强造 accept；真正该救的是「组件内部的编辑中状态」，所以最后一步是设计层面的：把筛选状态同步到 URL（[Vue Router](/vue/router)）或状态层（[Pinia](/vue/pinia)），reload 之后自然恢复。

</template>

</Exercise>

<Exercise title="练习 4 · 读懂 deps 目录并解释它为什么存在" difficulty="进阶">

① 在自己项目里找到预构建缓存目录（普通 Vite 项目 `node_modules/.vite/deps`，本站 `.vitepress/cache`），列出里面的文件。② 为什么里面会出现一个「巨大的单文件」对应你装了 900 个碎文件的库？③ 为什么文件名带哈希或带 `?v=` 查询串？④ 本站 `.vitepress/cache` 里只有 `deps_temp_1c1d6a3f` 而没有 `deps`，解释这个现场。

<template #answer>

① 典型内容是每个被预构建的依赖一个 `.js`、对应 `.map`、以及 `_metadata.json`（记录 browserHash、失效条件、发现的新依赖等）；**观察是只读的，不要改也不要删**。② 浏览器对每个模块发一次请求，900 个碎文件就是 900 次往返，首屏时间被请求数而非体积主导；合并成一个文件把往返数压到 1。③ 名字里带版本/hash 是为了**让缓存失效可控**：依赖版本或配置指纹变化时产物路径就变；反过来也意味着「路径变了 → 已加载的旧 URL 全部作废 → 必须整页重载」，这正是 `Optimizing new dependencies` 那段的机制根源。④ `deps_temp_*` 是预构建过程中的**临时目录**，正常完成后改名成 `deps`；只有临时目录、没有 `deps`，说明有一次预构建**没有正常收尾**（进程被中断、并发启动抢同一目录、磁盘或权限问题）。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Vite 官方文档 · 为什么选 Vite](https://cn.vite.dev/guide/#why-vite) —— 核实「原生 ESM 开发服务器」这条主线，即本章「不打包为什么能启动」。
- [Vite 官方文档 · 依赖预构建](https://cn.vite.dev/guide/dep-pre-bundling) —— **核实预构建三条理由与缓存目录/失效条件**，这是「第一次启动慢」与 `Optimizing new dependencies` 的权威解释。
- [Vite 官方文档 · HMR API](https://cn.vite.dev/guide/api-hmr) —— 核实 `import.meta.hot.accept`/`dispose` 的确切语义与冒泡规则（本章骨架示例以这页为准）。
- [Vite 官方文档 · 功能特性](https://cn.vite.dev/guide/features) —— 核实 TS 只做转译不做类型检查、JSON 的导入形态、`import.meta.env` 与 `VITE_` 前缀。
- [服务端选项](https://cn.vite.dev/config/server-options) 与 [共享选项](https://cn.vite.dev/config/shared-options) —— 核实 `server.proxy`（`changeOrigin`/`ws`/`rewrite`）、`server.watch.ignored`、`server.hmr` 的选项名与默认值，以及 `resolve.alias`、`resolve.dedupe`、`optimizeDeps.include/exclude` 的确切字段名。
- [环境变量与模式](https://cn.vite.dev/guide/env-and-mode) 与 [疑难解答](https://cn.vite.dev/guide/troubleshooting) —— 前者核实 `import.meta.env` 内置字段（完整加载优先级留到第 10 章），后者按错误原文分节，本章每条报错都应回这页交叉验证。另有 [MDN · JavaScript 模块指南](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Modules) 核实浏览器原生 ESM 与 `file://` 限制。

## 下一章

本章讲**开发模式**：浏览器原生 ESM 撑起不打包的启动、预构建把 npm 依赖变成合法模块、HMR 沿 ESM 边界把失效冒泡到 accept。下一章换成另一半世界：[Vite 构建侧：打包、代码分割与产物分析](/frontend-engineering/vite-build) —— 那时没有按需请求、没有 WS 通道、预构建产物也不再相关，取而代之是打包与 tree-shaking、分包、带哈希的文件名与 `base`，以及「为什么 dev 正常、build 之后白屏」。dev 与 build 是两套流程却共用一份配置，这正是几乎所有「构建后才发现」类问题的来源。
