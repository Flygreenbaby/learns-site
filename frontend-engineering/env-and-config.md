# 环境变量与配置管理：`VITE_` 前缀决定的是谁能看见它，不是它算不算秘密

预发环境包打开就是生产数据。原因通常不是地址配错了，而是 `--mode staging` 只改了 `MODE` 这一个字符串——代码里那句 `if (import.meta.env.PROD)` 依然走生产分支，因为 `PROD` 跟着 `NODE_ENV`，而 `vite build` 把 `NODE_ENV` 定为 `production`，跟你的 mode 叫什么无关。

第二类事故只在生产复现：`.env.production` 里少写一行，`import.meta.env.VITE_API_BASE` 在产物里变成 `undefined`，请求打到相对路径 `/api`。开发环境一切正常，因为 `.env` 有默认值兜着。构建退出码 0，测试全绿，没有任何一道工序拦住你。

第三类代价最高：有人把签名密钥写成 `VITE_UPLOAD_SIGN_KEY`，理由是「不加前缀读不到」。那串密钥**逐字明文**躺在产物里，`Ctrl+F` 就能搜到，而且已经进过 CDN 和别人的浏览器缓存，删文件收不回来。

第 9 章[测试体系](/frontend-engineering/testing) 拦的是「结果是错的」，本章管「同一份代码在另一个环境里不是同一份代码」。下面每条结论都是本机跑出来的。

<Callout type="verified" title="实测环境与方法">

Node `v25.4.0`、Windows 10 x64、2026-10-18，Vite `5.4.21`（本仓库 `node_modules/vite`，VitePress 1.6.4 的依赖，**没额外装包**）。两类动作：`import { loadEnv } from 'vite'` 直接读 `.env` 目录打印结果；`import { build } from 'vite'` 对最小项目（`index.html` + `src/main.js`）做真实生产构建，再读 `dist/assets/*.js` 原文并用 `includes()` 探字符串。`build({ mode })` 等价于 CLI `vite build --mode <mode>`。示例目录写完已删。

</Callout>

## 同一个源码位置，四种命运

被检查的 `src/main.js` 只有五行，`.env` 四行：`VITE_API_BASE=https://api.example.com`、`VITE_UPLOAD_SIGN_KEY=sk-live-FAKEKEY-8f2c`、`APP_PUBLIC_NAME=前缀外也可暴露`、`DB_PASSWORD=do-not-leak-this`。

```js
const a = import.meta.env.VITE_API_BASE
const key = import.meta.env.VITE_UPLOAD_SIGN_KEY
const name = import.meta.env.APP_PUBLIC_NAME
const pw = import.meta.env.DB_PASSWORD
const viaProcess = process.env.VITE_API_BASE
```

`mode: 'production'`、默认前缀构建后，产物原文（去掉 Vite 注入的 modulepreload 垫片）：

```js
const i = { BASE_URL: '/', DEV: !1, MODE: 'production', PROD: !0, SSR: !1,
  VITE_API_BASE: 'https://api.example.com',
  VITE_UPLOAD_SIGN_KEY: 'sk-live-FAKEKEY-8f2c' }
const c = 'https://api.example.com'      // a
const l = 'sk-live-FAKEKEY-8f2c'         // key —— 密钥已在明文产物里
const f = void 0                          // name：前缀不匹配
const u = void 0                          // pw：同上
const d = Object.keys(i)                  // 只有那 7 个键
```

| 源码写法 | 产物里变成 | 实测结论 |
| --- | --- | --- |
| `import.meta.env.VITE_x` | 字符串字面量 | **逐字进包**，`grep` 必中 |
| `import.meta.env.其它键` | `void 0` | 不是报错，是**静默 undefined**，只在运行期暴露 |
| `process.env.VITE_x` | 空对象取属性 | 产物里是 `var i={}` 再 `i.VITE_API_BASE` → `undefined`，客户端别走这条 |
| `Object.keys(import.meta.env)` | 已暴露键的数组 | 只有内置 5 键 + 命中前缀的键，未暴露的**毫无痕迹** |

机制核心就在最后一行：`import.meta.env` 在产物里是一个被**静态替换**出来的对象字面量，未暴露的变量根本没进入客户端构建上下文。这一个事实同时解释三件事：读不到为什么不报错（替换发生在编译期）、未使用分支为什么能被摇掉、以及**为什么前缀只能是「可见性开关」而不能是「加密开关」**——命中前缀的值就是公开字面量。

## `.env` 加载顺序：四层覆盖，逐键实测

官方文档给的顺序是 `.env` → `.env.local` → `.env.[mode]` → `.env.[mode].local`，后一层覆盖前一层。我用 6 个文件、一个只出现在部分层的键 `TAKEOVER` 把它验穿。

| 文件 | `VITE_API_BASE` | `VITE_APP_TITLE` | `TAKEOVER` | 其它键 |
| --- | --- | --- | --- | --- |
| `.env` | `https://api.shared.example.com` | `基础标题` | `来自-.env` | `DATABASE_URL=postgres://admin:SUPERSECRET@db.internal:5432/prod` |
| `.env.local` | — | `本地覆盖标题` | `来自-.env.local` | `ONLY_LOCAL=local-only` |
| `.env.production` | `https://api.prod.example.com` | — | `来自-.env.production` | — |
| `.env.production.local` | `https://api.prod.local-override.example.com` | — | — | — |
| `.env.development` | `http://localhost:5173/api` | — | — | — |
| `.env.staging` | `https://api.staging.example.com` | `预发` | — | — |

`loadEnv(mode, dir, '')`（空前缀＝不过滤）的实测返回值：

| mode | `VITE_API_BASE` | `VITE_APP_TITLE` | `TAKEOVER` | `ONLY_LOCAL` |
| --- | --- | --- | --- | --- |
| `production` | `…prod.local-override…`（第 4 层） | `本地覆盖标题`（第 2 层） | `来自-.env.production`（第 3 层） | `local-only` |
| `development` | `http://localhost:5173/api` | `本地覆盖标题` | `来自-.env.local` | `local-only` |
| `staging` | `https://api.staging.example.com` | `预发` | `来自-.env.local` | `local-only` |
| `no-such-mode` | `https://api.shared.example.com` | `本地覆盖标题` | `来自-.env.local` | `local-only` |

三条从表里读：

1. **`.env.local` 不属于任何 mode**，它在所有 mode 下都参与覆盖（`VITE_APP_TITLE`、`ONLY_LOCAL` 四行都在）。它的定位是「我本机上的私人覆盖」，不是「开发环境配置」。
2. **mode 文件赢过 `.local`，而 `.env.production.local` 又赢过 mode 文件**：`production` 行 `TAKEOVER` 取第三层，`VITE_API_BASE` 却被第四层改掉。想让本机覆盖压过生产，就得写第四层。
3. **mode 没有对应文件时静默降级**（`no-such-mode` 只加载第一、二层，不报错），且**覆盖是逐键的、不是整文件替换**——这就是「CI 上忘传 `--mode staging`」和「`.env.production` 只写两行却以为整份生效」两条事故的物理路径。

## 前缀之外的变量进不了客户端，但这保护不了你

`loadEnv(mode, dir)`（默认前缀 `VITE_`）实测只返回带前缀的键：上面那套文件里 `TAKEOVER`、`DATABASE_URL`、`ONLY_LOCAL` 一个都不出现；构建产物里 `grep "SUPERSECRET"`、`grep "db.internal"` 都是 `false`。前缀过滤在「不进客户端包」这一层确实有效。

它挡不住的是**你以为前缀等于加密**。四种真实入包姿势，按频率排：

1. **顺手加前缀。** 「读不到」比「不该读」更容易被误诊，于是 `DATABASE_URL` 改名 `VITE_DATABASE_URL`，缺陷当场关闭，密钥当场进包——本章那次构建里 `sk-live-FAKEKEY-8f2c` 就是这么进去的。
2. **把 `envPrefix` 配成空串。** 实测 `envPrefix: ['VITE_', 'APP_']` 之后 `APP_PUBLIC_NAME` 进了产物（`grep` 命中 `true`）；写 `''` 就是字面意思：**全部变量都暴露**。选项名与形态核对 [Vite 共享选项](https://vite.dev/config/shared-options)，但别当兜底配置清空。
3. **临时调试没删。** `.env.local` 里加了 `VITE_MOCK_TOKEN`，验证完忘了删，而它在 `.gitignore` 里看不见；换人构建时还在机器上。
4. **误以为「前端 SDK 的 key 天生公开」。** 地图、埋点这类 key 可以公开，但必须有配额、域名白名单和可吊销；三样都没有的一律属于服务端。

止血顺序不能换：先**吊销并轮换**（它已泄露，删文件不解决问题），再从代码与 `.env` 移除并重建，最后清 CDN 与构建缓存。**泄露的密钥不是待清理的数据，是待撤销的授权。**

## `MODE`、`NODE_ENV`、`PROD` 是三个不等价的开关

同一份代码，只改 mode 各构建一次，产物里 `import.meta.env` 被替换后的片段：

```text
build({ mode: 'production' })  →  mode:"production", prod:!0, dev:!1
build({ mode: 'staging' })     →  mode:"staging",    prod:!0, dev:!1
```

`MODE` 是你要的字符串，`PROD`/`DEV` 是 `NODE_ENV` 的派生值，而 `vite build` 的 `NODE_ENV` 恒为 `production`。后果很具体：`if (import.meta.env.PROD) enableAnalytics()` 在预发包里照样打开；`DEV` 为假，开发期告警也一起被关掉。

判据于是很干净：**「要不要压缩、要不要 sourcemap、要不要 tree-shake」这类构建行为归 `NODE_ENV`；「连哪个后端、开哪些特性」必须归你自己的 `VITE_` 变量。**

```ts
// src/config/env.ts —— 环境差异只从这一处读
const raw = import.meta.env.VITE_ENV_KIND          // 'dev' | 'preview' | 'prod'
const KNOWN = ['dev', 'preview', 'prod'] as const
if (!raw || !KNOWN.includes(raw as (typeof KNOWN)[number])) {
  throw new Error(`VITE_ENV_KIND 未设置或取值非法（收到 ${JSON.stringify(raw)}）`)
}
function req(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${name} 缺失：产物里会是 undefined`)
  return v
}
export const config = { envKind: raw as (typeof KNOWN)[number], apiBase: req(import.meta.env.VITE_API_BASE, 'VITE_API_BASE') }
```

`req` 那四行的意义是把「静默 `void 0`」换成「启动即抛错」——实测已证明未暴露的键不会有任何警告，你唯一能做的就是在读取处立即校验。收窄写法见[第 3 章 联合类型与收窄](/typescript/unions-and-narrowing)。

## 已存在的环境变量赢过 `.env` 文件

先把 `process.env.VITE_API_BASE = 'https://from-shell-env.example.com'` 设上，再跑 `mode: 'production'`，实测：

```text
loadEnv: {"VITE_API_BASE":"https://from-shell-env.example.com","VITE_UPLOAD_SIGN_KEY":"sk-live-..."}
产物:    { BASE_URL:"/", DEV:!1, MODE:"production", PROD:!0, SSR:!1,
          VITE_API_BASE:"https://from-shell-env.example.com", ... }
grep "from-shell-env" → true      grep "https://api.example.com" → false
```

`.env.production` 里那一行被**整行忽略，零提示**。CI 上极易触发：Actions 的 `env`/`secrets`、Docker `build-arg`、上游 workflow 的一个全局导出，都会盖掉你以为生效的文件。「本地对、CI 连错后端」的成因常常就是这条。确认：在 `vite.config.ts` 里 `loadEnv` 之后同时打印返回值和 `process.env` 同名项，看谁赢；再对产物 `grep` 一次。修：删掉流水线里无关注入，让 mode 文件成为唯一来源。

## 值的解析：四条规则 + 两个坑

同一次 `loadEnv('production', dir, '')` 实测：

| `.env` 里写的 | 读到的值 | 规则 |
| --- | --- | --- |
| `VITE_INTERP=拼接-${TAKEOVER}` | `拼接-来自-.env.production` | 支持 dotenv 式插值，用的是**合并后的最终值** |
| `VITE_ESCAPED=\${TAKEOVER}` | `${TAKEOVER}` | `$` 前加 `\` 转义 |
| `VITE_QUOTED="带空格的值"` | `带空格的值` | 成对引号被剥掉，只用来保住空格 |
| `VITE_COMMENT=值  # 后面的注释` | `值` | 行内 `#` 之后当注释吃掉——**含 `#` 的真实值必须加引号** |

最后一条解释了「轮换密钥后突然读不到」：新 key 里有 `#`，值被截成半截，而截断后的字符串仍非空，`req()` 也拦不住。另两个坑都出在同一个函数上：

- **`loadEnv(mode, dir, '')` 会把整个 `process.env` 混进返回值。** 空前缀那次输出里，除我的 9 个键，还带出 `PATH`、`APPDATA`、`COMPUTERNAME` 等几十个本机变量。在配置文件里用它喂 Node 侧配置时**显式列前缀**。
- **`loadEnv` 不写 `process.env`。** 实测调用完 `process.env.TAKEOVER`、`process.env.ONLY_LOCAL` 仍是 `undefined`。想在 Node 侧用 `.env` 的值必须自己赋值；`import.meta.env` 是客户端那份，两条通道不通。

## 配置放哪一层：判据是「改完要不要重新构建」

| 类别 | 例子 | 放哪 | 生效方式 | 是不是秘密 |
| --- | --- | --- | --- | --- |
| 构建时常量 | API 基址、埋点开关、特性开关 | `VITE_` 前缀的 `.env.[mode]` | **必须重新构建** | 不是，按公开对待 |
| 运行时配置 | 租户 ID、部署后可改的接口地址 | 同源 `config.json` 或 `index.html` 注入，启动时 `fetch` | 改文件即可 | 不是 |
| 服务端密钥 | 数据库连接、签名私钥、第三方 secret | 只在后端进程环境（[认证与 Session](/backend/auth-session) 的范围） | 重启服务 | **是**，绝不出现在前端产物 |
| 工具链配置 | `base`、`outDir`、别名、代理 | `vite.config.ts` + `tsconfig.json`（[tsconfig 关键选项](/typescript/tsconfig)） | 重新构建 | 不是，但跟着仓库走 |

「预发要连客户环境，但我不想为每个客户重建一次」正是运行时配置那一行的来源：静态产物 + 一份部署时可替换的 `config.json`，缓存语义单独安排（`no-store`，否则改了不生效），见[HTTP 缓存与资源加载策略](/frontend-engineering/http-caching)。`base`、`outDir` 归[Vite 构建侧](/frontend-engineering/vite-build)；`.env` 不参与 `import.meta.hot`，改它要重启 dev server，见[Vite 开发侧](/frontend-engineering/vite-dev)。

## 多环境文件组织

```text
.env                # 只放「所有环境都相同」的值；提交
.env.example        # 键清单 + 注释，值留空或假值；提交，是新人唯一能拿到的说明
.env.local          # 个人覆盖；gitignore，别写业务环境差异
.env.development    # 开发；提交
.env.staging        # 预发；提交
.env.production     # 生产；提交，只写确认公开的 VITE_ 键
```

三条纪律：`.gitignore` 里必须自己写 `.env.local` 与 `.env.*.local`（脚手架那份覆盖了，你新建的仓库要核对，第 12 章[阶段项目](/frontend-engineering/project) 把这条列成勾选项）；新增一个 `VITE_` 键要同时改 `.env.example` 与 `src/config/env.ts` 的校验，三处不同步就是这个键开始腐化的地方；部署环境（Docker / Nginx / 对象存储）那套变量是**另一个体系**（见[服务部署](/backend/docker-and-shutdown)与[部署到 VPS](/devops/deploy-to-vps)），前端唯一要知道的是 mode 名和少数 `VITE_` 键——混成一份清单必然出现「同名变量盖掉文件」，所以流水线里 `--mode` 要显式写出来（写法见 [CI/CD 与 GitHub Actions](/devops/ci-cd)）。

## 常见错误与排查

1. **现象：预发包连生产接口，`--mode staging` 明明传了。** 原因：判断用了 `import.meta.env.PROD`，而 `PROD` 跟 `NODE_ENV` 走、`build` 下恒真。确认：本章那条对照（`mode:"staging", prod:!0`），或在预发包里打印 `import.meta.env`。修：环境差异交给自定义 `VITE_ENV_KIND`，`PROD`/`DEV` 只用于构建行为。
2. **现象：构建成功，运行时接口地址是 `undefined`。** 原因：`.env.production` 缺该键，缺失或未暴露的键在产物里是 `void 0`，编译期完全静默。确认：在产物里搜那个预期字符串（`grep -o "VITE_API_BASE[^,}]*" dist/assets/*.js`）。修：读取处立即校验抛错，并把每个键补进 `.env.example`。
3. **现象：`grep -r "postgres://" dist/` 命中，怀疑泄露。** 原因：**先分辨误报**——文档站、教程正文、测试固件里天然含这类字样。确认：只搜本次构建里真实存在的那个具体值（`grep -rF "具体串" dist/`），别搜关键词；再核对键名有没有 `VITE_`。修：去掉前缀，前端根本不该拿到它；已发布的走「吊销 → 删除 → 清缓存」。
4. **现象：本地对、CI 用了错地址。** 原因：CI 已存在同名变量，赢过 `.env`（`from-shell-env` 那次实测）。确认：CI 日志同时打印 `loadEnv` 结果与 `process.env` 同名项。修：流水线删掉无关注入。
5. **现象：改了 `.env.production`，产物没变。** 原因：`.env.production.local` 优先级更高（实测第四层覆盖成功），你改的是第三层；或构建缓存/CDN 没清。确认：临时改一次键名看产物是否跟着变；`ls -a | grep env` 数有几层。
6. **现象：`loadEnv` 读到的键比你写的多几十个。** 原因：空前缀（`''`）把 `process.env` 整个纳入返回值。确认：看返回值里有没有 `PATH`、`COMPUTERNAME`。修：显式传前缀（`VITE_` 区分大小写，`VITE_api` 算另一个键）。

## 练习

<Exercise title="练习 1 · 复现四层覆盖" difficulty="基础">

用「加载顺序」那张表的 6 个文件搭一个临时目录，只跑 `loadEnv`（不构建），回答三问：（1）`loadEnv('production', dir)` 与 `loadEnv('production', dir, '')` 差在哪几个键？（2）删掉 `.env.production.local` 后 `VITE_API_BASE` 变成什么？（3）新增 `.env.staging.local` 写 `TAKEOVER=来自-.env.staging.local`，`staging` 模式下它的值是？

<template #answer>

（1）差 3 个：`TAKEOVER`、`DATABASE_URL`、`ONLY_LOCAL`。默认前缀 `VITE_` 过滤掉它们；传 `''` 不但带回这三个，还带回**整个 `process.env`**（实测包括 `PATH`、`COMPUTERNAME` 等几十个键）。

（2）`https://api.prod.example.com`——第四层消失后第三层接管。这正是 `.env.*.local` 危险的地方：任何人都能静默覆盖生产值。

（3）`来自-.env.staging.local`。四层顺序与 mode 名无关，`staging` 同样有第四层。复现时把 `loadEnv` 写进一个临时 `.mjs`（`import { loadEnv } from 'vite'` 后 `console.log`），别在命令行 `-e` 里传引号，Windows 下极易出错。

</template>

</Exercise>

<Exercise title="练习 2 · 故意把密钥送进产物，再把它搜出来" difficulty="进阶">

最小项目四步：（1）`.env.production` 写 `VITE_FAKE_TOKEN=canary-DO-NOT-SHIP-42`；（2）源码用 `import.meta.env.VITE_FAKE_TOKEN`；（3）`vite build`；（4）一条命令证明它进了产物。再加 `DB_PASSWORD=canary-DO-NOT-SHIP-42`（同值、无前缀）重跑第 4 步。两次结果为何不同？如果这个包已经发到 CDN，接下来三件事是什么？

<template #answer>

第 4 步：

```bash
grep -rF "canary-DO-NOT-SHIP-42" dist/ | wc -l
```

第一次命中（本章实测同形：`sk-live-FAKEKEY-8f2c` 在产物中出现，`includes()` 返回 `true`），第二次**搜不到**——不是被加密，是它**从来没进入客户端构建上下文**（`import.meta.env.DB_PASSWORD` 直接被替换成 `void 0`）。这个实验把「前缀」这条抽象规则变成一次肉眼可见的字面量差异。

已在 CDN 上的三件事，顺序不换：**① 吊销并轮换**（任何访问过该页面的人都可读）；**② 从 `.env` 与源码移除、去掉 `VITE_` 前缀、重新构建发布**；**③ 清缓存**（刷 CDN + 让旧入口 HTML 失效，否则用户还拿得到带密钥的旧 JS）。只做完②就宣布处理完毕是最常见的错误收尾。顺手查两处：`.gitignore` 有没有 `.env*` 兜底条目；仓库历史里提交过它没有——提交过的当作已泄露处理。

</template>

</Exercise>

<Exercise title="练习 3 · 解释这个静默失败：配置文件里读不到，组件里读得到" difficulty="基础">

同事在 `vite.config.ts` 里写 `const url = loadEnv(mode, process.cwd()).VITE_API_BASE`，打印是 `undefined`；而组件里 `import.meta.env.VITE_API_BASE` 正常。`.env` 里确实有这个名字的键。给出两个最可能原因与各自确认方法。

<template #answer>

**一、第二个参数不是 `.env` 所在目录。** 约定是项目根；一旦 `root` 被指到子目录（monorepo 里极常见，见[Monorepo 与工作区](/frontend-engineering/monorepo)），`process.cwd()` 与真实 `.env` 目录就不是同一个地方。确认：把 `loadEnv(mode, dir, 'VITE_')` 的键列表打出来，空数组即目录错。修：传与 `root` 一致的目录。

**二、默认前缀把它过滤了。** 不传第三参只返回 `VITE_` 前缀键；如果 `.env` 里其实写的是 `API_BASE_URL`，配置文件与组件**两边都读不到**，「组件里正常」多半是另一个键造成的错觉。确认：`loadEnv(mode, dir, '')` 看全量键名逐字比对（前缀区分大小写）。修：统一命名并在 config 模块做一次校验。

补一条：`loadEnv` 不会写 `process.env`（实测调用后 `process.env.ONLY_LOCAL` 仍是 `undefined`），所以「跑过 `loadEnv`，后面 `process.env.X` 就该有值」这个假设是错的。

</template>

</Exercise>

<Exercise title="练习 4 · 给这套规则设计一条 CI 防线" difficulty="挑战">

要求：构建之后自动拦住「带 `VITE_` 前缀的密钥进了产物」。写出检查逻辑的三层结构，并说明两类必然误报与怎么收窄。

<template #answer>

骨架是「**canary + 值形状 + 键名白名单**」三层。只搜关键词一定会红成一片（文档站产物里天然含 `password`、`postgres://`，排错第 3 条就是为此）：

1. **canary**：CI 故意注入一个假密钥的值，构建后精确搜索它（`grep -rF`）。作用是**证明检测通道是活的**——能抓到 canary 的检查才有资格说没抓到别的。这和第 9 章「测试要有能红的证据」同源。
2. **值形状**：匹配已知密钥的形态而不是业务词，例如 `sk-(live|test|proj)-[A-Za-z0-9]{16,}`、`AKIA[0-9A]{16}`、`-----BEGIN [A-Z ]*PRIVATE KEY-----`。
3. **键名白名单**：`loadEnv(mode, dir, 'VITE_')` 的键集合减去一份显式允许的清单，出现新键即失败。这一层最有价值——`VITE_` 前缀本身就该是一份**公开接口清单**，新增一个前缀键必须是一次有意识的决定。

两类误报与收窄：**测试固件与教程正文含样例串** → 排除样例目录，或改成「键名 + 出现次数阈值」；**压缩后的 base64 图片、内联字体里偶然凑出匹配片段** → 只在 `.js`/`.json`/`.html` 上匹配，跳过二进制，别对整棵 `dist` 无差别 `grep`。最后一条别漏：`sourcemap` 若一起发布，`.env` 的值会以原文出现在 `.map` 里，比 JS 更好读——**审计必须把 `dist/*.map` 一起搜**（那是[Vite 构建侧](/frontend-engineering/vite-build)的开关）。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Vite · 环境变量和模式](https://cn.vite.dev/guide/env-and-mode)（[英文](https://vite.dev/guide/env-and-mode)）—— 核实本章三块地基：四个 `.env` 文件的加载顺序、「只有 `VITE_` 前缀暴露给客户端」、`import.meta.env` 的内置键与静态替换。本章 2026-10-18 取过该页，结论与实测一致；措辞与新增选项以该页当前版本为准。
- [Vite 配置 · 共享选项](https://vite.dev/config/shared-options) —— 核实 `envPrefix` 与 `envDir` 的选项名与取值形态。我**真跑过** `envPrefix: ['VITE_', 'APP_']` 的构建，但没逐项读该页对这两个选项的完整语义说明。
- [Vite · 构建生产版本](https://cn.vite.dev/guide/build) —— 核实 `mode` 与 `NODE_ENV` 在 `build` 下的关系，即「`--mode staging` 仍得到 `PROD: true`」的出处。
- [Vite · 功能特性](https://cn.vite.dev/guide/features) —— `import.meta.env` 的类型来源是 `vite/client`（接 [tsconfig 的 `types`](/typescript/tsconfig)）；诡异行为先回 [疑难解答](https://cn.vite.dev/guide/troubleshooting) 按报错原文交叉验证。
- [Node.js 文档 · process 模块](https://nodejs.org/api/process.html) —— 核实 `process.env` 语义；本章实测过它在客户端产物里的下场。
- 站内回指：[测试体系](/frontend-engineering/testing)（「检查本身要能红」）、[包管理](/frontend-engineering/package-managers) 与 [锁文件](/frontend-engineering/semver-and-lockfile)（`.env` 管的是依赖之外的另一半不确定性）、[阶段项目：工程化体检](/frontend-engineering/project)（本章那几条 `grep` 就是体检清单里的必做项）。

## 下一章

这一章把 `.env` 的四层覆盖、`VITE_` 前缀的暴露机制、`MODE`/`NODE_ENV` 的分裂、「已有变量赢过文件」全部实测了一遍，判据收敛成两条：**改动要不要重新构建**，以及**谁有权看见这个值**。但前 11 章都默认一个前提——一个项目只有一份 `package.json`、一个 `node_modules`。当你把前端、后端和共享类型放进同一个仓库，这个前提就没了：依赖被提升到哪一层、本地包之间怎么链接、一条命令怎么按依赖顺序构建多个包，全是新问题。下一章 [Monorepo 与工作区](/frontend-engineering/monorepo) 会在本机真装一个离线 workspace，把「提升」和「幽灵依赖」跑出原文——那件事就发生在你刚刚用过的 `node_modules` 里，而它和第 2 章锁文件是同一个风险面：**你依赖的东西，不在你声明的地方**。
