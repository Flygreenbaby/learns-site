# tsconfig 关键选项：每个开关防的是哪一种真实 bug

`npm run build` 退出码 0，线上炸在 `Cannot read properties of undefined`；编辑器满屏红，同事说「不影响构建啊」就合了。同一个原因：**流程里从没真正跑过一次类型检查器**。`tsconfig.json` 不是初始化抄来的文件，是你和 `tsc` 之间的合同，每条都对应一类漏掉的 bug。读法只有一种有效：**先看开关不开时放过了什么，再看它开了时报的那句原文。**

<Callout type="verified" title="本章实跑范围">

Node `v25.4.0`、`Version 5.9.3`、Windows 10 x64、2026-10-17。单项开关：`npx tsc --noEmit --target es2022 --module esnext --moduleResolution bundler [--strict] <文件>`；配置解析：`npx tsc --showConfig -p <目录>/tsconfig.json`；另有 `--target es2019 --lib es2019` 对照、`--module commonjs` 的 interop 对照，以及三份推荐配置副本的 `--showConfig` 与 `-p` 校验。下面每条报错都是本机原文（示例在 `.scratch/c1011/`，写完已删），照抄同名文件即可复现。没跑的集中在三处 unverified 框。

</Callout>

## 谁在读这份配置

| 读者 | 什么时候读 | 会拦住发布吗 |
| --- | --- | --- |
| 编辑器语言服务（VS Code 内置 tsserver） | 你打字时 | 不会，只是提示 |
| `tsc` / `tsc -p .` | 你或 CI 主动执行时 | 只有真的跑它才会 |
| Vite（`vite build`、VitePress） | dev 与 build 时 | **默认永远不** |

第三条要钉死：**Vite 对 TypeScript 只做转译（transpile only），不做类型检查**，类型错误不会让 `vite build` 失败。[Vite 文档 TypeScript 一节](https://vite.dev/guide/features)（2026-10-17 核实）当前写法是「Vite uses Oxc Transformer to transpile TypeScript」、明确「does NOT perform type checking」，建议「在 Vite 的 build 之外再跑 `tsc --noEmit`」。

<Callout type="unverified" title="转译器名字随版本变，结论不变">

「esbuild」来自更早的 Vite 文档（本站 VitePress 1.6.4 依赖较早主版本的 Vite），版本对应关系我没逐项确认。只需要一个结论：**转译器只做逐文件语法转换，类型检查永远是另一道工序**。

</Callout>

本站根 `package.json` 里真实存在 `type-check` 脚本：`vue-tsc --noEmit -p tsconfig.json`（会读单文件组件的 tsc）。它**不在 `build` 里**——谁忘了单独跑，类型检查就等于没做。

## 到底生效了什么：--showConfig 与 extends

`--showConfig` 打印解析结果并**补上你没写的推导默认值**。子配置只写 `extends`、`noEmit: false`、`outDir`、一条 `paths`（节选）：

```text
"target": "es2022", "module": "esnext", "moduleResolution": "bundler",
"strict": true, "noEmit": false, "skipLibCheck": true,
"noUncheckedIndexedAccess": true, "outDir": "./out",
"paths": { "@utils/*": ["../src/utils/*"] },
"allowSyntheticDefaultImports": true, "resolvePackageJsonExports": true,
"resolvePackageJsonImports": true, "resolveJsonModule": true, "useDefineForClassFields": true,
"noImplicitAny": true, "noImplicitThis": true, "strictNullChecks": true,
"strictFunctionTypes": true, "strictBindCallApply": true, "strictPropertyInitialization": true,
"strictBuiltinIteratorReturn": true, "alwaysStrict": true, "useUnknownInCatchVariables": true
"files": ["../src/main.ts", "../src/utils/math.ts"],
"include": ["../src/**/*.ts"],
"exclude": ["D:/work/learns/.scratch/c1011/pch/out"]
```

- **`strict` 展开成 9 个开关**（下面那张表就是这 9 个）。
- 你没写的 `allowSyntheticDefaultImports`、`resolveJsonModule`、`useDefineForClassFields` 被 `target`/`module` **推导打开**了：「我没配所以没开」是错觉。
- `esModuleInterop` **没出现**，它不由 `module: esnext` 推导（后面有它的实测）。
- 输出里没有 `lib`：它按 `target` 推导，即你的全局声明清单是隐式的。
- `outDir` 被自动加进 `exclude`，不用手写。

**`extends` 的相对路径按「声明它的那份文件」所在目录解析**：基础配置在上一层，里面写 `include: ["src/**/*.ts"]`，到子配置就成了 `../src/**/*.ts`。这是加 `extends` 后一片 `TS2307` 的头号原因。`@tsconfig/*` 共享基础包能用，但**要打开看里面写了什么**，别当黑盒。

## strict 不是一个开关，是九个

对照方式：「不开」= 完全不带 `--strict`，「开」= 带 `--strict`。

| 开关 | 不开时漏掉的真实 bug | 开了之后的报错原文 |
| --- | --- | --- |
| `strictNullChecks` | `user.name.length`，而 `name` 可选、实际 `undefined` | `TS18048: 'user.name' is possibly 'undefined'.` |
| `noImplicitAny` | `function fmt(x)` 的 `x` 悄悄是 `any`，整条链路失去保护 | `TS7006: Parameter 'x' implicitly has an 'any' type.` |
| `strictFunctionTypes` | 回调要求 `{a,b}`，传进的数组元素只有 `{a}`，函数里读 `input.b.length` 崩 | `TS2345: Argument of type '{ a: number; }[]' is not assignable to parameter of type '{ a: number; b: string; }[]'. Property 'b' is missing...` |
| `strictBindCallApply` | `greet.call({name: 42})`，`this.name.toUpperCase()` 在数字上炸 | `TS2345: Argument of type '{ name: number; }' is not assignable to parameter of type '{ name: string; }'.` |
| `strictPropertyInitialization` | 构造函数只赋 `host`，`port` 从未赋值却被当 `number` | `TS2564: Property 'port' has no initializer and is not definitely assigned in the constructor.` |
| `useUnknownInCatchVariables` | `catch (e) { e.message }`，而 `throw` 出来的是字符串 → 文案变 `undefined` | `TS18046: 'e' is of type 'unknown'.` |
| `noImplicitThis` | 独立调用的方法里 `this` 是 `undefined`，类型却是 `any` | `TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.` |
| `alwaysStrict` | 不参与类型检查：只在产物顶部加 `"use strict"`，并让低 `target` 下部分语法报错 | 未单独实测文案 |

两条源码（不带 `--strict` 时 0 报错）：`forEach(arr, squeeze)`——回调 `cb: (el: T) => void` 要求 `{a,b}`，数组元素只有 `{a}`，开 strict 后 `TS2345`；`class Config { host: string; port: number; constructor() { this.host = "127.0.0.1"; } }`——`port` 那行 `TS2564`，而 `new Config().port` 运行时是 `undefined`。

`strictFunctionTypes` 补一句：TS 对 `function`/方法声明的参数容忍双向协变（bivariance），这条开关只把**函数类型表达式**（`(el: T) => void`）拉回严格逆变——所以「想让参数变严就用函数类型表达式写签名」（第 5 章）。`useUnknownInCatchVariables` 的代价是每个 `catch` 要先收窄：正解不是关掉它，而是把 `unknown` 收口进一个错误格式化函数（[第 3 章 收窄](/typescript/unions-and-narrowing)与第 11 章校验器）。`strictBuiltinIteratorReturn` 管迭代器返回类型，谁在哪一版进家族以[发行说明](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html)为准。

## strict 之外还要手动开的四个

**`noUncheckedIndexedAccess`。** 默认 `arr[i]` 不含 `undefined`，而 JS 里越界返回 `undefined` 不抛错——这是明晃晃的谎。`const scores: number[] = [10, 20]; const top: number = scores[5];` 实测 `TS2322: Type 'number | undefined' is not assignable to type 'number'. Type 'undefined' is not assignable to type 'number'.` 代价：所有 `arr[i]`、`map[key]` 变 `| undefined`，索引 `for` 会烦——改 `for (const x of arr)`（不受这条开关影响）。首页阶段项目点名要开它，防的正是「列表第 0 项不一定存在」。

**`exactOptionalPropertyTypes`。** 默认 `title?: string` 允许 `{ title: undefined }`，「没填」和「填成空」无法区分——PATCH 请求体、表单提交、`{ ...defaults, ...input }` 覆盖默认值三类 bug 都在这。实测：

```text
exact-optional.ts(3,8): error TS2379: Argument of type '{ title: undefined; }' is not assignable to parameter of type 'Patch' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
  Types of property 'title' are incompatible. Type 'undefined' is not assignable to type 'string'.
```

开后 `Partial<T>`、映射类型与 spread 集中报错。**这是团队级决定**：新项目开，老项目中途开会有几十到几百处修改（怎么开见第 11 章）。它和第 4 章「可选属性滥用」是同一件事的两面。

**`noImplicitOverride`。** 子类同名成员被静默覆盖；基类改名或新增同名方法时，你以为的「新增」其实在覆盖父类且签名不兼容。实测 `TS4114: This member must have an 'override' modifier because it overrides a member in the base class 'Base'.` 成本几乎为零。

**`noUnusedLocals` / `noUnusedParameters`。** 不防运行时 bug，防重构残留：`TS6133: 'tmp' is declared but its value is never read.`（变量和未用参数各报一条）。`_` 前缀参数被豁免，是刻意留的逃生门。ESLint 的 `no-unused-vars` 也能做，两边都开会重复报——见[代码规范](/frontend-engineering/lint-and-format)。

## target 与 lib：一个是产物下限，一个是声明清单

`target` 决定产物用什么语法（`?.` 会不会降级），`lib` 决定编译器认识哪些**全局 API 声明**。同一份 `const o = { a: 1 }; export const has = Object.hasOwn(o, "a");`，实测：

```text
--target es2019 --lib es2019 ：error TS2550: Property 'hasOwn' does not exist on type 'ObjectConstructor'. Do you need to change your target library? Try changing the 'lib' compiler option to 'es2022' or later.
--target es2019 --lib es2022 ：0 报错
```

第一条是**声明缺失**，报错直接教你改 `lib`；第二条是危险组合——检查器承认 API 存在，而降级**只处理语法不 polyfill API**，老环境照样 `TypeError`。全局函数同理：`--target es2022 --lib es2022`（不含 `DOM`）编译 `export const t = setTimeout(() => {}, 1);` 得 `TS2304: Cannot find name 'setTimeout'.`

所以浏览器项目写 `"lib": ["ES2022", "DOM", "DOM.Iterable"]`；Node 脚本写 `["ES2022"]` 并用 `types: ["node"]` 拿 `process`、`setTimeout`（`@types/node` 装 `devDependencies`，见[第 9 章](/typescript/modules-and-declarations)）。两边混用的症状是 `setTimeout` 返回值类型对不上（DOM 下 `number`、Node 下 `NodeJS.Timeout`）——解法是别手写它，让推断做（第 7 章）。`target` 只按运行环境下限定（浏览器侧看 `build.target`，见[Vite 构建侧](/frontend-engineering/vite-build)）。

## module 与 moduleResolution：只列实测过的组合

| 组合 | 结果 | 来源 |
| --- | --- | --- |
| `esnext` + `bundler` | 正常，相对导入可省扩展名 | 本章全部示例 |
| `preserve` + `bundler` | 正常 | 第 9 章实测 |
| `commonjs` + `bundler` | `TS5095: Option 'bundler' can only be used when 'module' is set to 'preserve' or to 'es2015' or later.` | 第 9 章实测 |
| `esnext` + `nodenext` | `TS5110: Option 'module' must be set to 'NodeNext' when option 'moduleResolution' is set to 'NodeNext'.` | 第 9 章实测 |
| `module nodenext`（不写解析） | `TS2835`：相对导入必须写 `.js` | 第 9 章实测 |
| `esnext` + `node10` | 正常（`node10` 是旧 `node` 的新名字） | 第 9 章实测 |
| `commonjs`（不写解析） | 正常，本章 interop 对照组用的就是它 | 本章实测 |

记忆量只有三组：**浏览器 + 打包器 → `esnext`/`bundler`；Node ESM → `nodenext`/`nodenext`（相对导入写 `.js`）；老 CommonJS 工具链 → `commonjs` + 不写解析**。

<Callout type="unverified" title="模块解析没核实的部分">

给定 `target` 下这两个选项的**默认值**我没逐项确认（随版本调整过），本章只写显式传参的行为；`node16`/`bundler` 之外的其余配对、`exports` 条件匹配顺序也没跑。选组合请走官方[选择编译器选项指南](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)和 [tsconfig 参考](https://www.typescriptlang.org/tsconfig/#moduleResolution)，别抄教程的「推荐配置」。

</Callout>

## 为转译器让路的三条

**`noEmit`**：只检查不写文件，检查命令就是 `tsc --noEmit -p tsconfig.json`。为什么不用 `noEmitOnError` 让 `tsc` 管产物？因为**产物归打包器、检查归 tsc**，CI 才分得清哪步失败（第 1 章实测 `tsc` 报错照样输出 JS）。纯检查项目里 `rootDir` 根本不用写。

**`isolatedModules`**：不是检查，是承诺——「每个文件都能被单独转译」。实测边界比想象松：`import { Shape, radius } from "./vt-types"`（`Shape` 是类型）配 `--strict --isolatedModules` **0 报错**，同文件里 `export const enum Color` 配它也**没报错**。跨文件访问 `const enum` 与各打包器的内联行为我没测，所以别把「`const enum` 安全」当结论——涉及 `export const enum` 直接避开，用 `as const` 对象 + 联合字面量（第 7 章）。

**`verbatimModuleSyntax`**：最硬的一条，**语法必须与产物一致，类型导入必须写 `type`**。实测：

```text
vt-use.ts(1,10): error TS1484: 'Shape' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
```

它取代旧的 `importsNotUsedAsValues` + `preserveValueImports`。值得开的理由是第 9 章那个线上故障：`import type` 会被整条擦掉，把靠副作用注册全局的 `import "./polyfill"` 顺手加 `type`，运行时功能当场消失；反过来 `import { Foo }` 混着类型时，不同转译器对「这行要不要留」处理不一致。开了它，**源码里的 import 就是产物里的 import**。Vite 项目建议 `isolatedModules` + `verbatimModuleSyntax` 一起打开。

## skipLibCheck 与 allowJs

`skipLibCheck` 关掉检查器对 `.d.ts` **内部**的检查。把两个冲突声明塞进同一次编译（`interface Shared { port: number }` 与 `{ port: string }`）：

```text
--skipLibCheck false ：libbad/b.d.ts(2,3): error TS2717: Subsequent property declarations must have the same type.  Property 'port' must be of type 'number', but here has type 'string'.
--skipLibCheck true  ：0 报错
```

代价是它掩盖两类真实问题（两个 `@types` 包声明同名全局、包升级后与你的扩展冲突），收益是速度。**默认 `true`，遇到诡异的「类型定义自相矛盾」时临时关掉一次**再判断是不是自己的锅。

`allowJs` 决定 `.js` 能否进程序，`checkJs` 才决定它是否被检查。三条实测正好是迁移三阶段（第 11 章）：把 `.js` 列为输入而不加 `allowJs` 报 `TS6504: File '.../legacy-js.js' is a JavaScript file. Did you mean to enable the 'allowJs' option?`；`--allowJs --checkJs --strict` 报 `legacy-js.js(1,23): error TS7006: Parameter 'name' implicitly has an 'any' type.`；不写 `allowJs` 而由 `.ts` 导入同目录 `.js` 报 `TS7016: Could not find a declaration file for module './legacy-js'. '.../legacy-js.js' implicitly has an 'any' type.` 要点：**导入未加类型的 `.js` 不报 `TS2307`，而是整个模块变成 `any`**，且只有 `noImplicitAny` 开着才报（不带 `--strict` 时同样安静）。「`allowJs` 让旧代码可用」的真实含义是：可用 ≠ 有保护。

## 输入输出边界

`include`/`exclude`/`files` 决定哪些文件进程序，`rootDir`/`outDir` 决定产物摆哪。

- `files` 与 `include` 是**并集**；`exclude` 只从 `include` 里减，**减不掉 `files`**。实测一份同时写 `files: ["src/keep.ts","src/drop.ts"]`、`include: ["src/**/*.ts"]`、`exclude: ["src/drop.ts"]` 的配置，`--showConfig` 的 `files` 段仍是 `["./src/keep.ts", "./src/drop.ts"]`——`drop.ts` 照样进程序。
- 三者都不写时 `tsc` 拿走配置目录下全部可编译文件，这就是「为什么这个文件也被检查了」的常见答案。各种 `include` 写法在扩展名补全上的细节差异我没逐项实测。
- `rootDir` 是**目录结构映射的根**（`outDir` 下的落点由它算出）。`--rootDir rd/src --outDir rd/out` 编译一个 `import "../outside"` 的文件，实测：

```text
rd/src/a.ts(1,24): error TS6059: File 'D:/.../rd/outside.ts' is not under 'rootDir' 'D:/.../rd/src'. 'rootDir' is expected to contain all source files.
  The file is in the program because:
    Imported via "../outside" from file '.scratch/c1011/rd/src/a.ts'
    Root file specified for compilation
```

那两行分别说明它**是被 import 拉进来的**、以及**你还把它列成了根文件**：从 `include` 删掉它没用，只要有人 import 它照样进程序。

## paths 别名省了字，换来三份配置

同一个 `src/main.ts`（内容 `import { add } from "@utils/math"`）：

```text
npx tsc -p .scratch/c1011/pch/tsconfig.json（配了 paths） → 0 报错
npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler .scratch/c1011/src/main.ts
  → TS2307: Cannot find module '@utils/math' or its corresponding type declarations.
```

第二条证明 **`paths` 只活在 `tsconfig.json` 里**，绕过 `-p` 就失效。真实代价：① 打包器要再配一份 alias（Vite 的 `resolve.alias`、Vitest、独立脚本各一份），不同步就是「IDE 不红、构建失败」；② `tsc` 产出 JS 时**不会把 `@/x` 重写回相对路径**，产物里的 import 在 Node 里必然解析失败；③ reviewer 与一切跨项目工具都得先查映射表。想省前缀又不想双份配置，Node 侧有 `package.json` 的 `"imports"`（`#` 前缀，运行时与 TS 都认），规则见 [Node Packages 文档](https://nodejs.org/api/packages.html)；`tsc` 对它的覆盖范围我没在本机逐条验证。

## 三份推荐配置，每行注明防什么

`tsconfig.json` 允许注释（JSONC）。三份都是本站学习路径的最小集，别整段抄去当信仰。

纯脚本 / 学习用（`tsc` 直接产出并运行）：

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",                     // 产物下限，按运行环境定，不追最新
    "lib": ["ES2022"],                      // 只要 ES 全局，避免误用 DOM 的 fetch/setTimeout
    "module": "NodeNext",                   // 与 package.json "type" 一致
    "moduleResolution": "NodeNext",         // 必须与上一行同值（TS5110）
    "strict": true,                         // 展开的 9 个开关
    "noUncheckedIndexedAccess": true,       // arr[i] 越界是 undefined 却类型 T
    "noImplicitOverride": true,             // 子类静默覆盖基类
    "noUnusedLocals": true,                 // 重构残留变量
    "noUnusedParameters": true,             // 同上；_ 前缀豁免
    "noFallthroughCasesInSwitch": true,     // switch 漏 break 掉进下个 case
    "rootDir": "src",                       // src→dist 映射根（预防 TS6059）
    "outDir": "dist",                       // 产物落点，会自动进 exclude
    "sourceMap": true,                      // 报错栈能定位回 .ts
    "skipLibCheck": true,                   // 速度；诡异 .d.ts 冲突时临时关一次
    "forceConsistentCasingInFileNames": true // 大小写不敏感的盘 → Linux 上 TS2307
  },
  "include": ["src"]
}
```

Vite 前端（含本站这类 VitePress 项目，产物归 Vite）：

```jsonc
{
  "compilerOptions": {
    "target": "ESNext",                     // 降级交给构建工具
    "lib": ["ESNext", "DOM", "DOM.Iterable"], // 浏览器全局
    "module": "ESNext",                     // bundler 要求 es2015+，否则 TS5095
    "moduleResolution": "bundler",          // 尊重 exports，允许省扩展名
    "noEmit": true,                         // 只检查；因此不写 rootDir/outDir
    "isolatedModules": true,                // 承诺逐文件可转译
    "verbatimModuleSyntax": true,           // 类型导入必须写 type（TS1484）
    "strict": true,                         // 9 个开关
    "noUncheckedIndexedAccess": true,       // 列表第 0 项不一定存在
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "types": ["vite/client"]                // 拿 import.meta.env 声明
  },
  "include": ["src"]
}
```

Node 后端（`tsc` 出产物或直接 `node dist/main.js`；本站后端路线以[后端 Node 运行时一章](/backend/node-runtime)的实际配置为准）：与纯脚本那份同构，差别是 `lib` 只留 `["ES2022"]`、加 `types: ["node"]`（缺 `@types/node` 会报找不到类型定义）、`exactOptionalPropertyTypes` 显式写 `false`（后端 DTO 大量 `Partial`，收益低于成本）、用 `tsx`/`ts-node` 直跑时把 `rootDir`/`outDir`/`sourceMap` 换成 `noEmit: true`。

<Callout type="verified" title="三份配置校验到哪一步">

把这三份落成真实 `tsconfig.json` 跑过：`npx tsc --showConfig -p <目录>/tsconfig.json` **没有任何「未知选项」类报错**，说明每个选项名在 5.9.3 上都存在；Vite 前端与 Node 后端那两份对一个最小 `src/` 再跑 `npx tsc -p ...`，**0 报错**。校验副本里去掉了 `types` 和 `jsx` 两行（前者需要 `vite/client` 在场），这两行属于「按文档语义写、未参与本次校验」。

</Callout>

本站根那份 `tsconfig.json`（只读参考）走「Vite 前端」这一类，但 `verbatimModuleSyntax`、`noUncheckedIndexedAccess` 未开，`include` 精确列出要检查的文件而不是整棵目录树——站点只有少量 `.ts`；你的项目变大后应改回 `include: ["src"]`。

## 配置排错清单

**`TS2307 Cannot find module 'x' or its corresponding type declarations.`** 五种成因按命中概率：**① 文件真不在，或 `moduleResolution` 是 `nodenext`/`node16` 时相对导入没写 `.js`（那是 `TS2835`）；② 文件存在但不在程序里**（`include`/`exclude` 漏了，或 `-p` 指错配置）——确认手段是 `npx tsc --showConfig -p <配置>` 看 `files` 段；**③ 路径别名没生效**（上面 `@utils/math` 的实测对照）；④ 包有运行时入口但没类型，报的通常是 `TS7016`（解法见[第 9 章三条路](/typescript/modules-and-declarations)）；⑤ 包的 `exports` 缺 `types` 条件。

**默认导入报错 / `esModuleInterop`。** 同一个 `export = { version: "1.0" }` 的模块，两种写法各报一条（实测）：`import legacy from "./legacy-export"` 报 `TS1259: Module '".../legacy-export"' can only be default-imported using the 'esModuleInterop' flag`；`import * as legacy` 报 `TS2497: This module can only be referenced with ECMAScript imports/exports by turning on the 'esModuleInterop' flag and referencing its default export.` 加 `--esModuleInterop` 后第一条 0 报错。这条开关做两件事：让检查器接受 CommonJS 默认导入的形状，以及**产出代码时插入 interop 辅助函数**；只要「不报错」而不动产物的是 `allowSyntheticDefaultImports`。注意上面 `--showConfig` 里 `module: esnext` 已把 `allowSyntheticDefaultImports` 推导成 `true`，但用 `--module commonjs` 跑默认导入不加 `--esModuleInterop` 照样报 `TS1259`——这是「本地不红、CI 红」的一类成因。

**`File is not under 'rootDir'`（TS6059）。** 读第二段定位谁把它拉进程序 → 判断它该不该进程序 → 该进就把文件移进 `src`（最常见正解），或把 `rootDir` 提到共同父目录（代价：产物变 `dist/src/...`、入口路径跟着改），或纯检查场景直接 `noEmit: true` 并删掉 `rootDir`。

**类型莫名变成 `any`，四步：** ① 分清**隐式**与**显式**——`noImplicitAny`（含在 `strict`）只报 `TS7006`；实测一个把 `any` 写在返回值上的模块在 `--strict --noImplicitAny` 下 **0 报错**，调用它的两处（赋给 `number`、塞给 `string` 参数）同样安静。找显式 `any` 只能靠 `grep`/ESLint（第 11 章）。② 看是不是 `.js` 或无类型包（`TS7016`）。③ 看 `lib`/`types` 缺没缺声明，导致全局 API 掉到 `any`。④ 用 `--showConfig` 确认你改的**真的是被读的那份**。

**「改了 tsconfig 不生效」。** 语言服务和 `tsc` 是两个进程：`TypeScript: Restart TS Server`，看状态栏 TS 版本有没有被 workspace 覆盖，再用 `--showConfig` 对答案。

## 常见错误与排查

1. **现象：CI 全绿、线上 `Cannot read properties of undefined`。** 原因：`vite build` 不做类型检查，流水线里没有 `tsc --noEmit`。确认：手动跑一次，几乎一定有错。修：独立 CI 步骤 + `package.json` 里留 `type-check`。
2. **现象：写了 `strict: true`，`user.name.length` 还不报可能 `undefined`。** 原因：项目里有两份 tsconfig，编辑器读的不是你改的那份；或这文件在 `include` 之外根本没进程序。确认：`--showConfig` 看 `strict` 与 `files`。
3. **现象：加 `extends` 后一片 `TS2307`。** 原因：基础配置的 `include`/`paths` 按**基础文件所在目录**解析（实测 `../src/**/*.ts`）。修：子配置里重写 `include`/`paths`，或与源码同层。
4. **现象：开 `verbatimModuleSyntax` 后一堆 `TS1484`，第一反应是关掉。** 原因：类型一直用普通 `import` 带进来。修：逐个改 `import type { X }`；同时记反面——`import "./polyfill"` 这种副作用导入千万别加 `type`（第 9 章的线上故障）。
5. **现象：报错文件全在 `node_modules/@types/**`，自己代码一条没有。** 原因：`tsc` 把 `@types` 下所有包整体拉进程序，而你删掉了 `lib` 里的 `DOM`，这些包的地基没了。实测（`--target es2019 --lib es2019`，未开 `skipLibCheck`）：`node_modules/@types/web-bluetooth/index.d.ts(9,27): error TS2304: Cannot find name 'BufferSource'.`，同批上百条。修：`skipLibCheck: true`（这正是它存在的理由），或用 `types: [...]` 精确列出真需要的全局包。
6. **现象：`import legacy from "老包"` 报 `TS1259`，改成 `import * as` 又报 `TS2497`。** 原因：那个包是 `export =` 形状，你的 `module`/`esModuleInterop` 与运行时不一致。修：开 `esModuleInterop: true`；Node ESM 统一 `NodeNext` 两件套，别在同一项目混 `commonjs` 与 `esnext`。
7. **现象：`tsc --noEmit` 每次 3 分钟，有人建议从 CI 删掉。** 确认：临时关 `skipLibCheck` 看是否有 `.d.ts` 冲突反复触发重建；把 `include` 精确化后测时间差。修：拆一份只查源码的 `tsconfig.build.json`、把类型检查作为与构建并行的独立 job。**别**指望 CI 里的增量缓存。

## 练习

<Exercise title="练习 1 · 让一个静默的 bug 报出来" difficulty="基础">

这段不带 `--strict` 时 0 报错：

```ts
const cities: string[] = ["北京", "上海"];
const capital: string = cities[3];
export const shout = capital.toUpperCase();
```

（1）运行时 `shout` 会怎样？（2）开**哪一个**开关能让它报错？（3）写出报错原文（含错误号）。

<template #answer>

（1）`cities[3]` 是 `undefined`，`capital.toUpperCase()` 抛 `TypeError: Cannot read properties of undefined (reading 'toUpperCase')`，而且栈指向 `.toUpperCase()` 那行、不在数组访问处，排查时容易找错。

（2）`noUncheckedIndexedAccess`——它**不在** `strict` 展开的 9 个开关里，必须单独写。

（3）本章同构实测（`const scores: number[] = [10, 20]; const top: number = scores[5];` 配 `--strict --noUncheckedIndexedAccess`）：`TS2322: Type 'number | undefined' is not assignable to type 'number'. Type 'undefined' is not assignable to type 'number'.` 字符串版是同一形状的 `Type 'string | undefined' ...`。修法：`const capital = cities[3] ?? cities[0];` 或先判 `undefined`。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造 TS1484 并解释它" difficulty="进阶">

`types.ts`：`export type Shape = { kind: "circle" }; export const radius = 1;`；`use.ts`：`import { Shape, radius } from "./types";`，`Shape` 当类型用、`radius` 当值用。（1）分别跑 `--strict --isolatedModules` 与 `--strict --verbatimModuleSyntax` 看到什么？（2）这差异说明两条开关各管什么？（3）怎么修？

<template #answer>

（1）第一条 **0 报错**；第二条是实测原文 `error TS1484: 'Shape' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.`

（2）`isolatedModules` 只承诺「每个文件可单独转译」，不强制标出类型——上面这种既有类型又有值的 `import`，转译器怎么删都算猜。`verbatimModuleSyntax` 更硬：源码语法必须与产物一致，**纯类型导入必须显式写 `type`**。

（3）拆两行：`import type { Shape } from "./types";` + `import { radius } from "./types";`。反面提醒：副作用导入 `import "./polyfill"` 千万别加 `type`，加了那行在产物里就没了。

</template>

</Exercise>

<Exercise title="练习 3 · 读懂 TS6059 并给出三种修法" difficulty="进阶">

`src/a.ts` 里 `import { helper } from "../shared/helper"`。跑 `npx tsc --rootDir src --outDir dist --target es2022 --module esnext --moduleResolution bundler src/a.ts shared/helper.ts`。（1）`The file is in the program because:` 那两行各说明什么？（2）三种修法及适用场景。

<template #answer>

（1）实测两行是 `Imported via "../outside" from file '.../src/a.ts'` 和 `Root file specified for compilation`：前者说明它**被 import 拉进来**，后者说明**你它还被列成根文件**。合起来意味着：从 `include` 删掉它没用，只要有人 import 就照样进程序、照样违规。

（2）**① 移文件**（把 `shared/` 挪进 `src/`，最常见正解）；**② 抬高 `rootDir`** 到共同父目录，代价是产物变 `dist/src/...`、入口路径跟着改；**③ 纯检查场景设 `noEmit: true` 并删 `rootDir`**——不产产物时这约束本身没意义，前端项目正是这一类。

</template>

</Exercise>

<Exercise title="练习 4 · 给存量项目开 exactOptionalPropertyTypes" difficulty="挑战">

已开 `strict: true` 的中项目要加 `exactOptionalPropertyTypes`。（1）预计撞上哪两类集中报错？（2）能同时保留「可选」与「允许空值」语义的写法是什么？（3）为什么不要把所有可选字段统统加 `| undefined`？

<template #answer>

（1）**显式传 `undefined` 的调用点**（`update({ title: undefined })` → 实测 `TS2379`，报错里直接写了 `Consider adding 'undefined' to the types of the target's properties.`）；**`Partial<T>`/映射类型 + spread** 造出的对象，以及把 `JSON.parse` 结果直接当 `Partial<T>` 用的边界处。

（2）按意图分：「键可以不存在」写 `title?: string`；「存在但值可为 `undefined`」写 `title?: string | undefined`。后者允许传 `undefined`，于是「不填」与「填成空」重新变成两件事——代价是这个字段每个使用点都要判 `undefined`。

（3）那样这条开关就被掏空了：它防的正是 `{ ...defaults, ...input }` 里 `undefined` 覆盖默认值、以及 `"title" in patch` 与 `patch.title === undefined` 判断不一致。**要么只给业务上真允许空值的字段加 `| undefined`，要么干脆不开**。完整取舍见[真实项目中的取舍](/typescript/tradeoffs)。

</template>

</Exercise>

## 官方文档与延伸阅读

- [tsconfig 选项参考](https://www.typescriptlang.org/tsconfig/) —— 核实每个选项的**语义与默认值**，尤其 `strict` 家族清单与 `module`/`moduleResolution` 的合法取值（本章报错是实跑，默认值是查文档）。逐项页：[`strict`](https://www.typescriptlang.org/tsconfig/#strict)、[`noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess)、[`exactOptionalPropertyTypes`](https://www.typescriptlang.org/tsconfig/#exactOptionalPropertyTypes)、[`verbatimModuleSyntax`](https://www.typescriptlang.org/tsconfig/#verbatimModuleSyntax)、[`skipLibCheck`](https://www.typescriptlang.org/tsconfig/#skipLibCheck)、[`rootDir`](https://www.typescriptlang.org/tsconfig/#rootDir)、[`paths`](https://www.typescriptlang.org/tsconfig/#paths)、[`allowJs`](https://www.typescriptlang.org/tsconfig/#allowJs)。
- [选择编译器选项指南](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html) —— 核实「什么项目选哪一组 `module`/`moduleResolution`」；本章只列实测配对，其余靠它。
- [Vite 文档 TypeScript 一节](https://vite.dev/guide/features) —— 核实本章最关键的流程结论：**只转译、不类型检查，官方建议额外跑 `tsc --noEmit`**（2026-10-17 核实；转译器名称以该页当前说法为准）。
- [Vite 配置文档入口](https://vite.dev/config/) —— 核实 `resolve.alias` 的存在与形态，对应 `paths` 那条代价。
- [从 JavaScript 迁移到 TypeScript](https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html) —— 核实 `allowJs`/`checkJs` 在迁移流程中的位置（本章只给三条实测报错，步骤在第 11 章）。
- [Node Packages 文档](https://nodejs.org/api/packages.html) —— 核实 `exports`、`imports`（`#` 别名）与相对导入扩展名规则，对应那两处 unverified。
- [TypeScript 发行说明总览](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html) —— 核实某开关是哪一版进 `strict` 家族的；本章刻意不给开关标版本号。

## 下一章

这一章把 `tsconfig.json` 摊平成「每个开关 ↔ 一类真实 bug」。剩下的问题不在编译器身上：**`strict` 全开之后它管不到的地方**——显式写了 `any` 的边界（排错第 ① 步已经实测过它的沉默）、`as` 断言、`@ts-expect-error`、结构化类型带来的意外兼容、`null` 与 `undefined` 的团队约定，以及 JS 项目怎么分步迁、CI 里类型检查怎么跑。第 11 章[真实项目中的取舍](/typescript/tradeoffs)讲这套工程约束；第 12 章[阶段项目](/typescript/project)以本章那份 Vite 前端配置为起点，验收标准里要求你能解释每个选项在防什么。
