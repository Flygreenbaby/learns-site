# 工程化体检：把「我觉得配好了」换成能勾选、能复跑的证据

这一章不写新功能。产出是一份**证据**：别人（或三个月后的你）照着 README 敲三条命令，能装起来、跑起来、构建出来、测试全绿；产物里没有不该出现的东西；页面慢的时候你说得出慢在哪一段。前面 11 章的每一条结论，都在这章变成一次可复跑的判决。

体检和「配好」的区别在于**判决方式**。`npm run build` 退出码 0 不代表产物正确——本章会看到本站真实存在的一个组合：`build` 脚本里没有类型检查步骤。二次访问没有白屏不代表缓存生效——可能只是你在 DevTools 勾了「停用缓存」的反面忘了取消。所以每个结论都要绑一条命令和一段输出，写进报告里。

被检查的对象**就用本站的前端部分**：根目录 `package.json`、`.vitepress/config.mts`、`tsconfig.json`、`.gitignore`、`.vitepress/theme`、`scripts/*.cjs`、17 个领域目录。它足够真实（有依赖、有构建、有产物、有正在犯的错），又完全离线可做。你也可以换成自己的 Vue 项目（[多页面待办应用](/vue/project)），阶段和判据一模一样。

<Callout type="verified" title="本章引用了哪些本站事实">

2026-10-18 在本机（Windows 10 x64、Node `v25.4.0`、npm `11.7.0`、无 `pnpm`）只读确认过：根 `package.json` 的 scripts 是 `dev`/`build`/`preview`/`type-check`（`build` 就是 `vitepress build`，**没有串 `type-check`**）；`devDependencies` 三项 `typescript ^5.9.3`、`vitepress 1.6.4`（精确版本）、`vue-tsc ^3.3.13`，**没有 `dependencies` 字段**；`.gitignore` 七行（`node_modules/`、`.vitepress/dist/`、`.vitepress/cache/`、`*.log`、`.DS_Store`、`.idea/`、`.vscode/`），**没有任何 `.env` 条目**；仓库根**不存在** `.env*` 文件；`.vitepress/dist/` 存在但残缺——只有 2 个文件、在 `examples/` 下，没有 `index.html` 也没有 `assets/`；`git rev-parse` 报 `fatal: not a git repository`；`node_modules/vite` 是 `5.4.21`，只作为 VitePress 的依赖存在。**我没有跑过 `npm run build`、`npm run dev`、`npm run type-check`**（简报禁止），涉及这三条命令的期望输出都写「预期结果是…」，由你在自己机器上验。

</Callout>

## 项目目标与范围

目标四件事，缺一不可：

1. 建一份**体检档案**：`audit/` 下的基线记录、发现清单、复跑脚本。
2. 每条发现按「**能拦住事故 / 只是不好**」分级，给出修复动作与优先级。
3. 修完高优先级项，且**每项修复都有前后两次命令输出**作对照。
4. 在 README 写清「三步复现」，让另一个人不问你就能重建这个项目。

明确不做什么：

- **不重构架构、不换框架、不改业务代码。** 「该拆包」属于建议，不属于交付。
- **不做真实上线。** 涉及 CDN、Nginx、对象存储、DNS 的一律标为「需要真实环境」，并给本地替代验证（阶段 5、6 各一条）。
- **不引入重型工具。** Turborepo、Nx、pnpm 迁移都不在本章范围；`workspace` 取舍见 [Monorepo 与工作区](/frontend-engineering/monorepo)，其中有一条判据：本站不该上。

## 需求清单：12 条可判决项

| 编号 | 需求 | 判决命令 / 动作 | 通过判据 |
| --- | --- | --- | --- |
| R1 | 依赖分层正确 | `npm ls --depth=0` | 运行时/构建期分处两字段，逐个说得出原因 |
| R2 | 安装可复现 | 删 `node_modules` 后 `npm ci` | 退出码 0，锁文件已提交 |
| R3 | 版本范围可解释 | 读 `package.json` 的范围符号 | 每个 `^`/`~`/精确值说得出能升到哪 |
| R4 | 构建干净 | 项目自己的 build | 零 error，warning 逐条有原因 |
| R5 | 产物被理解 | 列 `dist/` 最大三项 | 每个文件说得出来源与大小 |
| R6 | 分包生效 | 首屏 Network 过滤 JS | 非首屏路由的 chunk 不在首次加载里 |
| R7 | 缓存策略正确 | 首次与刷新各录一次 | HTML 走协商缓存，哈希资源走强缓存 |
| R8 | 性能有数字 | Performance 面板 + API | LCP/CLS 有实测值，最长长任务被指认 |
| R9 | 最低测试防线 | 项目的 test 命令 | 三层各有用例，一条命令跑完 |
| R10 | 环境配置分层 | 构建后 `grep` 产物 | 两套 mode 生效，产物里**搜不到任何密钥值** |
| R11 | 静态检查真在跑 | 故意留一个类型错误 | `build` 之外存在会红的检查步骤 |
| R12 | 交付可复现 | 别人照 README 做 | 装、跑、构建、测试四步全成，无需口头补充 |

R12 是本领域的**唯一硬标准**（见[领域首页](/frontend-engineering/)的验收段落），其余 11 条都是它的支撑。

## 体检工作区目录结构

```text
audit/
  README.md           # 结论摘要，一页内读完
  baseline.txt        # 阶段 0：被检查对象快照（命令输出原文，带日期）
  findings.tsv        # 发现清单：编号 严重度 现象 证据 修复 状态
  verify-secrets.mjs  # 阶段 3：构建后产物密钥扫描（可复跑）
  report-2026-10.md   # 最终报告：每条发现绑定一条命令与一段输出
  shots/              # 阶段 5、6 的 Network / Performance 截图
```

`findings.tsv` 六列，它决定这份交付是「报告」还是「牢骚」：**没有证据的条目不许进修复**。严重度三档：`blocker`（导致事故或无法复现）、`major`（放大未来成本）、`minor`（不好但不致命）。

## 分阶段实施

### 阶段 0：固定被检查对象，建立基线

动作：记录当前工具与依赖事实，**先不装、不删、不改任何东西**。

```bash
node -v && npm -v
npm ls --depth=0 > audit/baseline.txt
date >> audit/baseline.txt && du -sh node_modules dist .vitepress/dist >> audit/baseline.txt 2>/dev/null
ls -a | grep -E '^\.env' || echo "无 .env 文件" >> audit/baseline.txt
```

产出：`audit/baseline.txt`，判据是至少能看到五项：Node/npm 版本、顶层依赖清单、`.env` 有无、产物目录体积。本站基线里 `npm ls --depth=0` 只列三项 devDependencies，产物目录残缺。**这一步不许「顺手修」**：基线一旦被污染，后面的对照全部作废。

### 阶段 1：安装复现性（R1–R3）

动作：确认锁文件在场 → 删 `node_modules` → 用 `npm ci`（pnpm 项目用 `pnpm install --frozen-lockfile`）从零重建 → 起一次 dev server 冒烟。

```bash
ls package-lock.json pnpm-lock.yaml 2>/dev/null
rm -rf node_modules && npm ci --no-audit --no-fund
```

预期结果：`npm ci` 退出码 0，末尾一行 `added N packages`，且 **N 与锁文件 `packages` 段的条目数量级一致**；`npm run dev` 起服无报错。若它报 `npm ci can only install packages when your package.json and package-lock.json are in sync`，这就是本阶段最大的发现：提交上去的锁文件和 `package.json` 已经不一致，任何人重装都会拿到另一棵树（成因见[语义化版本与锁文件](/frontend-engineering/semver-and-lockfile)）。

产出：`added N packages` 原文，加上 R1 的逐依赖说明——为什么 `vitepress` 在 `devDependencies` 而不是 `dependencies`：静态站的「运行时」是浏览器，产物里没有它的 require（本站正是这种形状，`dependencies` 字段干脆不存在）。

### 阶段 2：构建与产物（R4–R6）

动作：跑一次完整构建，然后**进产物目录里翻**，而不是只看退出码。

```bash
npm run build 2>&1 | tail -30
find dist -type f -printf '%s %p\n' | sort -rn | head -6      # 最大六个
find dist -type f ! -name '*.html' ! -name '*.map' | grep -cvE '\.[A-Za-z0-9_-]{8}\.[a-z]+$'
```

判据三条：① 构建零 error，warning 逐条写进 `findings.tsv` 并标原因；② 最大的六个文件你能命名来源（入口 chunk / 依赖 chunk / 页面 chunk / CSS / 字体）；③ 第二条命令的**非哈希文件数应为 0**（HTML 与 sourcemap 除外）——不为 0 说明有资源没被哈希，那么[HTTP 缓存](/frontend-engineering/http-caching)的长缓存策略对它是危险的。

产出：`dist/` 的文件数、总字节、最大三项清单，加一次子路径验证：临时把 `base` 改成 `/sub/` 重新构建，用 `npm run preview`（VitePress 是 `vitepress preview`）访问，**预期结果是**资源请求全部带 `/sub/` 前缀且没有 404。验完改回去，两次输出都存进报告——这是 [Vite 构建侧](/frontend-engineering/vite-build) 里「子路径白屏」的正式结案动作。

R6 只能在浏览器里下判决：首屏 Network 过滤 JS，**预期结果是**其他路由的 chunk 不在列表里、点进去才出现；若首次就全量下载，说明动态 `import()` 没写成路由级，回到第 4 章。

### 阶段 3：环境配置与密钥（R10）

这一阶段用**反证法**：不是「搜不到就说明干净」，而是先证明你的搜索能搜到。本站事实是仓库里没有 `.env` 文件、`.gitignore` 里没有任何 `.env` 条目，两条都记为发现。

```bash
# 1) 造一把假密钥，走完整流程，验证「检测通道是活的」
#    在被检查项目的 .env.production 里加：VITE_CANARY_SECRET=canary-DO-NOT-SHIP-42
#    在某处源码真的读一次：import.meta.env.VITE_CANARY_SECRET
npm run build
grep -rF "canary-DO-NOT-SHIP-42" dist/ && echo "能抓到：扫描有效"
# 2) 改名去掉前缀，重建，这次必须搜不到
#    VITE_CANARY_SECRET -> CANARY_SECRET，同时把源码里的读取改掉
npm run build && ! grep -rF "canary-DO-NOT-SHIP-42" dist/ && echo "已隔离"
# 3) 收尾：把 canary 与相关源码删除，重新构建一次，确认产物里没有它
```

产出：两次 `grep` 的原文（一次命中、一次不命中）——这就是[环境变量与配置管理](/frontend-engineering/env-and-config) 那张「四种命运」表在你项目里的复现。再补两条：把 mode 分层的实际值打出来（`.env.development` 与 `.env.production` 至少一个键不同），并确认 **`dist/*.map` 也在搜索范围内**（发布 sourcemap 时 `.env` 原文会出现在 `.map` 里）。这段的固化版本是 `verify-secrets.mjs`（要点见参考答案一）。

### 阶段 4：静态检查有没有真的在跑（R11）

本站是一个现成的教材：`build` 脚本 = `vitepress build`，`type-check` = `vue-tsc --noEmit -p tsconfig.json`，两者**没有串起来**。Vite 对 TypeScript 只做转译（见[tsconfig 关键选项](/typescript/tsconfig)），所以「构建成功」永远不包含「类型检查通过」。

```bash
# 故意制造一个类型错误，确认检查命令会红
printf 'export const n: number = "x"\n' > src/_type-canary.ts
npm run type-check   # 预期结果：TS2322 一条，退出码非 0
npm run build        # 预期结果：仍然成功 —— 这就是发现本身
rm src/_type-canary.ts
```

产出：两条命令的输出对照写进 `findings.tsv`，严重度 `blocker`，修复动作是**把检查并入交付路径**（本地用「build 之前必跑 type-check 与 lint」的组合脚本，流水线里作为独立步骤并行）。同时核对 lint：`npm run lint` 不存在、或跑起来 200 条错，都是独立条目（[代码规范](/frontend-engineering/lint-and-format)）。顺带把 `engines.node` 与 `packageManager` 写进 `package.json`，并说明本机 Node（v25.4.0）与 CI 用 LTS 时可能出现的差异（[包管理](/frontend-engineering/package-managers)）。

### 阶段 5：缓存与加载证据（R7–R8）

本阶段判决权在浏览器，命令只能造证据。起 `npm run preview`，四步动作，每步一张截图存 `audit/shots/`：

1. 首次访问（**先确认 DevTools 的「停用缓存」没勾上**，勾了这次测量就作废）→ 记请求数与总传输量。
2. 普通刷新 → **预期结果是**带哈希的 JS/CSS 大量命中 `(memory cache)` 或干脆不发请求，HTML 走 304 或短 max-age。
3. 改一次内容、重新构建后再刷新 → **预期结果是**入口 HTML 变化、旧哈希资源不再被引用——这才是「发版后用户拿不拿得到新代码」的判决。
4. `curl -I` 看响应头（本机验不了，见下面的框）。

<Callout type="unverified" title="服务端响应头这一条本机验不了">

缓存头由部署方的服务器决定，本机 `vitepress preview` 不是生产服务器，所以第 4 步属「需要真实环境」项。本地替代验证：确认 `dist/index.html` 引用的资源都带哈希（哈希名与长缓存是同一枚硬币的两面），并把「HTML 必须 no-cache」写进部署清单，上线核对。Nginx 写法归[部署到 VPS](/devops/deploy-to-vps) 与 [Nginx](/linux/nginx)。

</Callout>

R8 的证据：Performance 面板录一次首屏，指出最长的长任务属于哪一段（脚本、样式计算、布局、绘制），再用 `PerformanceObserver` 读实际数字——`observe({ type: 'largest-contentful-element', buffered: true })`，回调里打印 `e.name`、`e.startTime`、`e.value`；CLS 换 `type: 'layout-shift'` 累加。**预期结果是**打出 LCP 的名字与毫秒数。**阈值判级以 Google 当前定义为准，别背任何教程（包括本站第 8 章）里的数字**——指标集合本身被替换过，见[性能指标与 Core Web Vitals](/frontend-engineering/performance)。产出：两个数字 + 一次归因（这个数字被哪处改动动过，要有前后对照）。

### 阶段 6：最低测试防线（R9）

本站的「测试」已经是这个形状的非典型样本：`scripts/check-file.cjs` 做的是内容文件的结构性检查（围栏成对、组件标签配平、站内链接是否存在、篇幅区间），跑法是 `node scripts/check-file.cjs <文件>`——**检查对象是项目本身，而不是业务函数**。

Vue 项目的验收数量（沿用[领域首页](/frontend-engineering/)的阶段项目段落）：至少 8 个 Vitest 单元测试（只测 composables 里的纯逻辑：筛选、排序、日期计算）、至少 2 个 Vue Test Utils 组件测试（给定 props 的渲染 + 一次交互）、至少 3 个 Playwright 端到端（新增一条待办、筛选状态与 URL 同步、访问不存在的详情页看到 404），全部收在 `npm run test` 一条命令下。判据不是「全绿」，而是**每条都能被你真的改坏一次而变红**。

产出：一次「红」的原文粘到报告里。拦不住任何改动的测试直接删——第 9 章写过那套快照测试的结局，别让体检报告变成它的墓碑。

### 阶段 7：交付包与三步复现（R12）

动作：写 README 的「本地开发」段落，只允许三条命令（装、跑、验），然后**做一次真实扮演**：新开一个终端目录、或用另一台机器、或把仓库复制一份到 `D:\tmp\clone`，只按 README 操作。

产出：`audit/report-2026-10.md`（模板见参考答案三）+ 一次复现的完整命令历史。**这一阶段唯一的失败方式是「你需要解释一下才能跑通」**——凡是必须口头补充的步骤，都是还没做完的项。

## 验收清单

逐条勾选，每条前面就是你在终端里真敲的那条命令；打不出对应输出的不许勾。

- [ ] `npm ls --depth=0` → 每一项说得出它在哪、为什么在那
- [ ] `rm -rf node_modules && npm ci` → 退出码 0，原文已存档
- [ ] `package.json` → `engines.node` 与 `packageManager` 跟实际使用一致
- [ ] `npm run build` → 零 error，warning 全进 `findings.tsv` 并有原因
- [ ] 产物最大三项 → 点名来源与处理决定（保留 / 替换 / 按需引入）
- [ ] 阶段 2 第二条 `find` 命令 → 输出 `0`（无未哈希资源）
- [ ] `base` 改 `/sub/` 重建 + preview → 无 404，路径全带前缀
- [ ] 首屏 Network → **没有**其他路由的 chunk
- [ ] canary 反证两步 → 加前缀命中、去前缀不命中；`node audit/verify-secrets.mjs dist` 退出码 0 且 `.map` 在扫描范围内
- [ ] `.gitignore` → 含 `.env.local` 与 `.env.*.local`（本站当前**没有**）
- [ ] `npm run type-check` → 被留出的类型错误弄红而 `build` 仍成功；修复后两者都在交付路径
- [ ] `npm run lint` → 存在且当前零报错
- [ ] 首次 / 刷新 / 重建后刷新 → 三张 Network 截图存 `audit/shots/`
- [ ] LCP、CLS 有实测数字，最长长任务指认到具体代码
- [ ] `npm run test` → 三层达标，且至少一条用例被「改坏实现」证明过能红
- [ ] `audit/findings.tsv` → 每条发现都有证据列
- [ ] 只看 README 三条命令 → 在别的目录或别的机器完成装、跑、构建、测试
- [ ] `audit/report-2026-10.md` → 每条结论指向一条命令及其原文输出

## 常见翻车点

| 现象 | 原因 | 怎么确认 | 怎么修 |
| --- | --- | --- | --- |
| 「构建和 lint 都过了，所以没问题」 | 构建器只转译（本站 `build` 没串 type-check），lint 只管质量不管格式，编辑器也可能没接 | 造一个 `export const n: number = "x"` 跑一次 build；手动改坏缩进，看保存时是否被改回 | 把检查并入交付路径（CI 独立步骤或 build 前置）；Prettier 管格式、ESLint 关掉格式类规则（边界见第 5 章） |
| `npm ci` 报 lock 与 package.json 不同步，或重装后行为变了 | 改了 `package.json` 没重装、手改过范围，或范围太宽（`^` 跨 minor）且锁文件没提交 | 报错原文列出的差异项；两次 `npm ls --depth=0` 做 diff | `npm install` 重新生成锁文件并提交，收紧关键依赖范围，再 `npm ci` 复验 |
| 二次访问全靠「停用缓存」没关 | 测量姿势错了，证据无效 | Network 面板顶部那条勾选框 | 每次录制前确认，截图里让勾选状态可见 |
| 产物里搜不到密钥就宣布干净 | 搜索通道本身是坏的（路径错、把模式当关键词、跳过 `.map`） | canary 反证：先让它必须命中 | 任何扫描都先做一次能命中的对照 |

没有证据列的条目从 `findings.tsv` 里删掉，别留着当心情——那是「体检报告」退化成「抱怨清单」的唯一路径。

## 参考答案要点

<Exercise title="参考答案要点 · 可复跑的产物密钥扫描脚本" difficulty="进阶">

把阶段 3 的 canary 反证固化成一条命令：给定产物目录与一份已知值清单，输出命中项并让构建失败；要求能扫 `.map`，且能自证扫描通道是活的。

<template #answer>

本站是 ESM 项目（`package.json` 里 `"type": "module"`），脚本用 `.mjs` 直接 `node` 跑，不装额外依赖：

```js
// audit/verify-secrets.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] || 'dist'
const known = (process.env.SECRET_VALUES || '').split('\n').filter(Boolean)
const SHAPES = [/sk-(live|test|proj)-[A-Za-z0-9]{16,}/, /AKIA[0-9A]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/]

const walk = (d, out = []) => {
  for (const e of readdirSync(d, { withFileTypes: true }))
    e.isDirectory() ? walk(join(d, e.name), out) : out.push(join(d, e.name))
  return out
}

const files = walk(dir).filter((f) => /\.(js|mjs|css|html|json|map)$/.test(f))
const hits = []
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  for (const v of known) if (v && text.includes(v)) hits.push(['canary', f, v])
  for (const re of SHAPES) { const m = text.match(re); if (m) hits.push(['shape', f, m[0].slice(0, 24)]) }
}
if (!known.length) { console.error('SECRET_VALUES 为空：本次扫描无法自证有效'); process.exit(2) }
for (const h of hits) console.error(h.join(' | '))
console.log(`扫描 ${files.length} 个文件，命中 ${hits.length}`)
process.exit(hits.length ? 1 : 0)
```

三个设计决定都对应本章前面的结论：`walk` 的过滤列表**必须含 `.map`**（sourcemap 里的 `.env` 原文比 JS 更好读）；`SECRET_VALUES` 为空时**退出码 2** 而不是 0——没有已知值的扫描等于没扫，「扫不到」不能当证据，这正是 canary 反证的固化；只打印匹配的前 24 个字符，免得扫描日志本身成为新的泄露点。跑法是 `node audit/verify-secrets.mjs dist`，非 0 退出码即失败；给 `SECRET_VALUES` 赋值在 PowerShell 与 Git Bash 里语法不同（本章未逐一验证），跨平台做法是写进 npm script 或放进 dotenv。局限也要写进报告：形状匹配会漏掉「不像密钥的密钥」，也不判断「这个值本来是否就该公开」，所以它只是第二层——第一层仍是第 10 章那条**键名白名单**。

</template>

</Exercise>

<Exercise title="参考答案要点 · 本站前端体检的示范结论" difficulty="基础">

拿本站前端部分当被检查对象，按 R1–R12 给出 `findings.tsv` 的前几行（只用本章框里已确认的事实，不许编造你没跑过的输出）。

<template #answer>

证据列只写本章实测过或明确标注为预期的东西，严重度按「会不会导致事故」而不是「看着难受」排：

```text
编号  严重度   现象                  证据                                        修复                       状态
F1    major    .gitignore 无 .env    原文 7 行、无 .env* 条目                    追加 .env.local 等         待修
F2    major    build 不串 type-check scripts 两项并存、互不引用                  交付路径加独立检查步骤     待修
F3    blocker  本机这份不是 git 仓库 git rev-parse 报 not a git repository       在有 git 的环境重跑 R2     受阻
F4    blocker  产物目录不可用        根目录无 dist；.vitepress/dist 只有 examples/ 下 2 个文件，无 index.html 与 assets/  跑一次 build 后重做阶段 2  受阻
F5    minor    无 .env、未做 mode 分层 ls -a 无匹配                             按第 10 章清单建 6 个文件  待修
F6    minor    无 lint/test 脚本     scripts 四项中无 lint/test                  按 R9/R11 补齐             待修
```

三点值得注意。**F3 与 F4 是「受阻」而不是「通过」**：R2「锁文件已提交」在没有版本库的机器上根本没法判，R5–R8 依赖一次成功构建，而本机产物残缺、简报又禁止我跑站点 build——诚实的写法是说明需要什么条件才能判，而不是猜结论。**F1 是 major 而不是 blocker**：当前仓库确实没有 `.env`，风险要等第一个 `.env.local` 出现才兑现——报告要写清前提。**F2 与 [第 10 章 tsconfig 一节](/typescript/tsconfig)的观察一致**（`type-check` 存在但不在 `build` 里），两处记录同一事实，互相印证。R1 的答案顺带给出：`dependencies` 字段不存在、三项全在 `devDependencies`，对静态站点生成器是**正确**的——浏览器执行的是 `dist/` 里的产物，`vitepress`/`vue-tsc`/`typescript` 都不出现在运行时；依据不是「它们都用来构建」这种直觉，而是第 1 章那条：**产物里会不会 require 它**。

</template>

</Exercise>

<Exercise title="参考答案要点 · 体检报告与三步复现的骨架" difficulty="进阶">

给出 `audit/report-2026-10.md` 的骨架和 README 的「三步复现」段落，标准是别人不问你就跑得起来。

<template #answer>

报告的每一节都是同一个格式：**结论一句 → 命令一行 → 输出原文 → 判据**，缺任何一项就退回 `findings.tsv` 当待办；README 的段落顺序就是它的依赖顺序，任何一步失败都指向明确阶段。骨架：

```text
# audit/report-2026-10.md
## 结论（一页）
- 可复现：是 / 否（证据：阶段 1 的 npm ci 原文）
- 产物无秘密：是 / 否（证据：canary 两次对照）
- 静态检查在跑：是 / 否（证据：type-canary 那次红）
- 最低测试防线成立：是 / 否（证据：一条被改坏实现弄红的原文）
- 阻塞项：<必须什么条件才能判定，谁负责，怎么验>
## 每条发现的记录格式
现象 / 复现命令 / 原文输出 / 判据 / 修复动作 / 修复后输出 / 严重度

# README 的「本地开发」段
前置：Node <你要的版本>，用 npm
1. npm ci        # 不通过 → 锁文件与 package.json 不同步，见报告 F 系列
2. npm run dev   # 白屏先看 Console 第一条报错
3. npm run build # 之后必须再跑 type-check，二者不互相包含
验证：npm run test
```

三条硬要求：**前置条件写死而不是「建议」**（只写「Node 18+」，遇到要 20+ 才装得上的依赖时失败得更难查；本站 `package.json` 就没有 `engines` 字段）；**点破「build 不含类型检查」**（一句话能省掉一整次「CI 全绿、线上炸」）；**每步注明「不通过时看哪条发现」**，让 README 成为报告的索引而不是又一份会过期的说明。最后一步是**销毁自己的特权**：把项目复制到新目录、关掉所有开着的终端和 IDE，只按 README 走——凡是「我脑子里还有一步没说」的情况都是一条 blocker，这就是 R12 的全部含义。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Vite · 构建生产版本](https://cn.vite.dev/guide/build) 与 [静态部署](https://cn.vite.dev/guide/static-deploy) —— 前者核实 `base`（公共基础路径）与多页面入口，阶段 2 的子路径判决以它为准；后者给阶段 5、7 的部署方清单。
- [Vite · 环境变量和模式](https://cn.vite.dev/guide/env-and-mode) —— 阶段 3 的 `.env` 分层与 `VITE_` 前缀规则出处（本站第 10 章已逐条实测）。
- [npm · `npm ci`](https://docs.npmjs.com/cli/v10/commands/npm-ci) 与 [package.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-json) —— 阶段 1 两条判决的出处。这类页面是前端渲染的，本章**没能用 WebFetch 取到正文**，结论来自本机 `npm 11.7.0` 的实际行为，措辞请自行打开核对。
- [MDN · PerformanceObserver](https://developer.mozilla.org/zh-CN/docs/Web/API/PerformanceObserver) —— 阶段 5 那段观察代码的接口形态（`buffered: true`、`getEntries()`）以它为准；[VitePress](https://vitepress.dev/) 首页可核实 `vitepress preview` 与产物目录名 `.vitepress/dist`。
- [Vitest 指南](https://vitest.dev/guide/)、[Vue Test Utils](https://test-utils.vuejs.org/guide/)、[Playwright 定位器](https://playwright.dev/docs/locators) —— 阶段 6 三层测试的官方入口，最后一条决定端到端能不能长期活下来。
- 站内回指：[阶段项目：多页面待办应用](/vue/project)（本章的被检查对象）、[测试体系](/frontend-engineering/testing)（「改坏一次才算数」的原始论述）、[环境变量与配置管理](/frontend-engineering/env-and-config)（R10 的机制）、[Monorepo 与工作区](/frontend-engineering/monorepo)（R1 的「该不该拆包」）、[领域首页](/frontend-engineering/)（验收标准的来源）。

## 下一章

前端工程化这条线到此走完：11 章的每一条结论都被本章压成一份能勾选的证据。做体检时你多半撞到过这三堵墙——**产物里有什么不由你决定、请求头由别人发出、服务器那边还得有东西在跑**——这三件都不在前端。下一站是[后端开发](/backend/)：从 [Node.js 运行时](/backend/node-runtime) 开始，用 `node:http` 手写一个最小服务器，你会看到前端那些请求的另一侧是谁在处理，本章的 canary 扫描也会变成一个真正的服务端密钥管理问题（[认证：Session、Cookie 与密码哈希](/backend/auth-session)）。再往后是[数据库](/database/)：等你的 API 真的要把数据写下来，第 1、2 章那些「可复现」的道理会以你没预料到的方式再来一遍。
