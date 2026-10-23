# 模块与声明文件：让第三方库和没有类型的代码进入 TS 项目

`Cannot find module 'xxx' or its corresponding type declarations.` 挂了三天，包明明装在 `node_modules` 里、代码跑得好好的——最后原因落在 `tsconfig.json` 的一个 `moduleResolution` 值上，而这只是四种成因之一。更隐蔽的一种：`import "./polyfill"` 靠副作用给全局挂方法，有人把写法「规范化」成 `import type`，类型检查毫无变化，产物里那行导入却**整条消失**，线上功能当场失效。要理解这两件事，得先把「ES 模块」和「TS 的类型系统」分开看。

本章结论均为本机实跑：TypeScript 5.9.3 + Node v25.4.0，2026-10-17，命令形如 `npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler <文件>`，报错原样粘贴，临时文件已删除。

## ES 模块与类型擦除：`import type` 不产生运行时导入

TS 不定义自己的模块系统，用的就是 ES 模块，只是额外允许几种类别：`import type`、`export type`、`import X = require(...)`（仅 `commonjs` 输出下）。关键在**类型擦除（type erasure）**：类型层面的导入编译后一个字都不剩。源码：

```ts
import type { User } from "./ch9-types";
import { greet, version } from "./ch9-mod";
export function render(u: User): string { return greet(u.name) + version; }
```

`npx tsc --module esnext --target es2022 --strict --outDir <目录>` 的产物：

```js
import { greet, version } from "./ch9-mod";
export function render(u) {
    return greet(u.name) + version;
}
```

第一行**整条不存在**，`./ch9-types` 没进入编译后的模块图。所以任何「靠导入触发副作用」的代码绝不能写成 `import type`；反过来，把纯类型的那条边改成 `import type`，运行时的循环依赖就断了——这是它最常见的正当用法。

只含类型的文件编译成什么？实测 `export default interface Card { title: string }` 加 `export type Row = { id: number }` 的文件，产物只有一行 `export {};`——**空模块**。它仍是 ES 模块（有自己的作用域），但没有任何值。`export default interface` 本身合法（退出码 0），但它是纯类型，产物里没有 `export default`，所以 `import Card from "./card"`（漏写 `type`）运行时拿到 `undefined`。

## `isolatedModules` 与 `verbatimModuleSyntax`：为逐文件转译付出的语法代价

现代构建链（Vite / esbuild / SWC / Babel）**一个文件一个文件转译**，看不到全项目类型图，「类型可以被静默擦除」在这里有歧义：编译器不知道该不该保留一条导入。`isolatedModules` 让所有写法都能被安全逐文件转译。实测这个文件：

```ts
import { User, Id } from "./ch9-types";
export { Id as IdRe } from "./ch9-types";    // registry 是值，re-export 合法
```

```text
error TS1205: Re-exporting a type when 'isolatedModules' is enabled requires using 'export type'.
```

注意 `import { User }` 那行**不报错**（TS 知道能擦除），只有**再导出**必须写成 `export type { Id as IdRe } from "./ch9-types"`。`verbatimModuleSyntax` 更严：写下来的形式就是输出的形式，同一文件加上它，两行都报错：

```text
error TS1484: 'User' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
error TS1205: Re-exporting a type when 'verbatimModuleSyntax' is enabled requires using 'export type'.
```

分工：`isolatedModules` 管「这种写法能否安全逐文件转译」，`verbatimModuleSyntax` 管「导入形式必须与产物一致，类型的归类型」。后者把上一节那种 `default` 陷阱变成编译期错误，代价是每次导入类型都要显式写 `type`。

## `module` 与 `moduleResolution`：只列实测能核实的约束

一个管**产物用什么模块语法**，一个管**按什么规则找文件**。配对错了编译器直接拒绝。下表全部是 5.9.3 实跑：

| 命令里的组合 | 实测结果 |
| --- | --- |
| `--module esnext --moduleResolution bundler` | 退出码 0，相对导入可省扩展名 |
| `--module preserve --moduleResolution bundler` | 退出码 0 |
| `--module commonjs --moduleResolution bundler` | `error TS5095: Option 'bundler' can only be used when 'module' is set to 'preserve' or to 'es2015' or later.` |
| `--module esnext --moduleResolution nodenext` | `error TS5110: Option 'module' must be set to 'NodeNext' when option 'moduleResolution' is set to 'NodeNext'.` |
| `--module nodenext`（不带 `moduleResolution`） | `TS2835: Relative import paths need explicit file extensions in ECMAScript imports ... Did you mean './ch9-types.js'?` |
| `--module node16` | 同上 `TS2835` |
| `--module esnext --moduleResolution node10` | 退出码 0（`node10` 是旧 `node` 策略的新名字） |

**硬结论**只有三条：`bundler` 需要 `module` 是 `preserve` 或 `es2015+`；`moduleResolution: nodenext` 要求 `module` 同为 `nodenext`；`node16` / `nodenext` 下相对导入必须写 `.js`（写 `.js` 而不是 `.ts`，因为类型是给产物看的）。「什么项目选哪一组」请按[选择编译器选项指南](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)与 [tsconfig 参考](https://www.typescriptlang.org/tsconfig/#moduleResolution)核对当前版本说法。

<Callout type="unverified" title="本章没有核实的两件事">

一是**默认值**：我没有逐项确认给定 `target` 下 `module` / `moduleResolution` 的默认取值（它随版本调整过），本章只写显式传参时的行为。二是**未来版本**：网上流传「`bundler` 只能配 `esnext`」的说法，可能与某次放宽有关；我只在 5.9.3 上验证了 `TS5095` 的文案。改配置前以你本机 `npx tsc --version` 对应的官方文档为准。

</Callout>

## 包、`exports` 字段与类型从哪里来

裸导入 `import x from "pkg"` 能不能拿到类型，取决于 TS 按当前 `moduleResolution` 能不能找到**描述它的 `.d.ts`**。来源大致是：包自带的 `"types"` / `"typings"` 或 `index.d.ts` → `package.json` 的 `"exports"` 在对应条件下提供的类型 → `node_modules/@types/pkg` → 你自己写的声明文件。`exports` 是 Node 定义的字段，控制包对外暴露哪些子路径、不同条件下给哪个文件；TS 在 `bundler` / `node16` / `nodenext` 下会读它。最容易出错的形式是「`exports` 写了运行时入口，但 `types` 条件缺失或位置不对」。

<Callout type="unverified" title="exports 与 types 条件的完整规则请以官方为准">

我没有在本机构造一个带 `exports` 字段的真实包来验证条件匹配顺序（包括 `types` 条件是否必须写在最前、`import` / `require` 双条件包 TS 如何选），因此不给具体规则。可核实的来源：[Node.js Packages 文档（含 exports 字段）](https://nodejs.org/api/packages.html)、[TypeScript 手册 Modules 一节](https://www.typescriptlang.org/docs/handbook/2/modules.html)。本站能验证的是「找不到时报错长什么样、补上声明后报错会不会消失」，见下两节。

</Callout>

## `.d.ts` 到底做什么：描述运行时，不产生代码

`.d.ts` 是**类型说明书**：不参与编译产物、没有 JS 实现，只告诉 TS「运行时这个位置有什么」。这和类型擦除是一体两面（见[为什么要用 TypeScript](/typescript/why-types)）。TS 能反向生成它，`npx tsc --declaration --module esnext --target es2022 --outDir <目录>` 的实测产物：

```text
--- ch9-types.d.ts ---
export interface User {
    name: string;
}
export type Id = string;
export declare const registry: Record<string, User>;

--- ch9-mod.d.ts ---
export declare function greet(n: string): string;
export declare const version = 1;
```

对照源码 `export const version = 1`：产物写 `= 1` 而不是 `: number`——**声明文件忠实记录推断结果**（与上一章 `as const` 的实测一致）。工程后果：库导出一个 `as const` 的大对象，下游拿到极精确的字面量类型，任何改动都是 breaking change；对外要不要放宽是有意的决定。三种 `.d.ts`：`dist/index.d.ts`（`tsc --declaration` 生成，随包发布）、`node_modules/@types/*`（DefinitelyTyped 维护）、你项目里手写的（给全局脚本、老库、`window` 上的自定义字段补声明）。

## `declare` 关键字家族：四种声明与它们的边界

`declare` 的统一语义是「**这东西运行时已经存在，别生成代码，只管类型**」。

```ts
declare const __APP_VERSION__: string;      // 由构建工具注入的全局常量
declare function gtag(cmd: string, ...args: unknown[]): void;

declare module "legacy-lib" {               // 为一个找不到的包声明类型
  export function helper(n: number): string;
}

export {};                                   // 让本文件成为模块
declare global {                             // 给全局环境加字段
  interface Window { __APP__: string }
}

declare namespace Legacy {                   // 描述挂在全局上的命名空间对象
  interface Opts { k: string }
  const version: string;
}
```

三条硬性规则，都实测过。**1. `declare global` 只能写在模块里。** 同样的内容放在顶层没有任何 `import` / `export` 的文件里：

```text
error TS2669: Augmentations for the global scope can only be directly nested in external modules or ambient module declarations.
```

加上 `export {};` 后同一份内容退出码 0。所以 TS2669 几乎总是**忘了这个文件不是模块**——全局脚本本身处在全局环境里，直接写 `interface Window { ... }` 即可，`declare global` 在那种文件里多余且非法。

**2. `declare module "x"` 有两种语义，取决于所在文件。** 在全局脚本 / 非模块 `.d.ts` 里它是**声明一个原本不存在的模块**；在模块文件里（有 `import` / `export`）它变成**增强一个已存在的模块**，此时那个模块必须能被解析到。实测把 `declare module "ui-kit" { ... }` 写在含 `import` 的文件里：

```text
error TS2664: Invalid module name in augmentation, module 'ui-kit' cannot be found.
error TS2307: Cannot find module 'ui-kit' or its corresponding type declarations.
```

`TS2664` 是本章最值钱的知识点之一：**它明确告诉你「我把它当增强处理了，因为你的文件是模块」**。修法是把包声明移到非模块的 `.d.ts`，或者先安装该包再增强它。

**3. ambient 模块里必须写 `export`**，不写的成员对导入方不可见（`TS2305: Module '"x"' has no exported member 'y'` 一类）。顺带一条老库风格：源文件里写 `export = someValue`，实测 `--module esnext` 得两条错：

```text
error TS1203: Export assignment cannot be used when targeting ECMAScript modules. Consider using 'export default' or another module format instead.
error TS2309: An export assignment cannot be used in a module with other exported elements.
```

但把 `export = api` 写在 `declare module "legacy-lib" { ... }` **里面**合法（退出码 0）——那是 CJS 包的正确描述方式，别和源文件里的 `export =` 搞混。

## 给无类型的第三方库补声明：三条路

**路 1：先查有没有现成的 `@types/*`。** `npm i -D @types/lodash`；带作用域的 `@a/b` 对应 `@types/a__b`（[DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) 维护）。别自己写一百行。用到 Node 内置模块还得装 `@types/node`——反面实测：本机项目没装它，`import ... from "node:fs"` 直接报 `TS2307: Cannot find module 'node:fs' or its corresponding type declarations.`。看到 `node:fs` / `process` / `__dirname` 相关报错，第一反应是「缺 `@types/node`」。

**路 2：自己写一个 `.d.ts`。** 前后对照最有说服力。补之前报 `TS2307: Cannot find module 'some-lib-without-types' ...`；新建 `typings/some-lib-without-types.d.ts`（顶层不能有 `import` / `export`，否则变成增强）：

```ts
declare module "some-lib-without-types" {
  export function helper(n: number): string;
}
```

把这份 `.d.ts` 一起交给 tsc 再跑：`some-lib-without-types` 那条**消失了**，同文件里 `node:fs` 与 `./ch9-nope` 两条仍在——这就是「补声明确实解决问题」的证据。原则：**只声明你真的用到的那几个成员**，写错比不写更糟，因为它骗过了检查。

**路 3：`types/` 目录 + `typeRoots`。** 实测配置 `{"compilerOptions": {"typeRoots": ["./types"]}, "include": ["ch9-typeroots.ts"]}` 配合 `types/legacy-globals/index.d.ts`（内容 `declare function legacyGA(track: string): void;`），`npx tsc -p <配置>` **退出码 0**，业务代码里 `legacyGA("home")` 直接有类型。注意 `typeRoots` 一旦设置就**替换**默认值（不再自动加载 `node_modules/@types`），通常写成 `["./types", "node_modules/@types"]`；`./types` 生效这条我实测了，「替换默认值」没有单独构造反例，细节以 [tsconfig 参考](https://www.typescriptlang.org/tsconfig/#typeRoots)为准。

## 扩展已有类型：接口合并是正道

`interface` 是**可合并（declaration merging）**的：同名接口在不同位置声明会自动叠加。这是给现成类型加字段的官方机制，不需要 `as any`。给 `Window` 加字段（实测退出码 0，需 `--lib es2022,dom`）：

```ts
export {};   // 让本文件成为模块
declare global {
  interface Window { __APP__: string; __VERSION__?: string }
}
export const appName: string = window.__APP__;
```

`__VERSION__?` 是可选，读出来就是 `string | undefined`——别写成必填，除非注入逻辑保证它一定存在（可选性写错是「编译通过、运行时 `undefined`」的常见来源，见[类型推断与上下文类型](/typescript/inference)）。给本地模块加成员同样可行（实测退出码 0）：增强方写 `export {}; declare module "./ch9-mod" { export const extra: number; }`，使用方 `import { extra, greet } from "./ch9-mod"` 就能拿到。真实框架里最常见的是请求对象增强。

<Callout type="unverified" title="Express / Fastify 的请求增强代码模式未在本机验证">

本站没装 Express / Fastify，下面两段是通用写法示意，**我没有实跑**；合并点（Express 的 `Request` 接口、Fastify 的 `fastify` 模块）随大版本变过，动手前对照各自官方文档。

```ts
// Express：给 req.user 一个类型
declare global {
  namespace Express {
    interface Request { user?: { id: string; role: "admin" | "member" } }
  }
}

// Fastify：给 reply 挂一个自定义装饰器
declare module "fastify" {
  interface FastifyReply { renderView(page: string, data?: unknown): void }
}
```

共同点：**增强必须写在模块文件里（要有 `import` / `export {}`），且必须写在被增强的包已安装的前提下**。位置写错就会撞上 `TS2664`。

</Callout>

## 找不到类型定义时的处理顺序，与 `any` 泄漏警告

按顺序走，别跳步：**① 先读报错**——说明符以 `./` 开头的几乎总是路径或扩展名问题，跟类型无关，裸包名才是类型问题；**② 查 `@types/<包名>`**，有就装；**③ 看包有没有自带类型**——打开 `node_modules/<pkg>/package.json` 看 `"types"` / `"exports"`；**④ 确认解析策略配得对**——同一种包写法在 `bundler` 和 `node16` 下结论不同，见前面 `TS2835` / `TS5095` 那张表；**⑤ 最后才自己写 `.d.ts`**，只声明用到的部分，并确认它在 `include` 覆盖范围内。

三个会让「类型问题」变成「`any` 泄漏」的做法：**`allowJs: true` 把无类型 JS 拉进项目**——实测 `import { legacySum } from "./legacy.js"` 配 `--strict --allowJs` **退出码 0**，继续写 `legacySum(1, 2).trim().noThere` **同样零报错**：文件是「编译通过」了，保护一条也没进来；**`declare module "x" { const any: any; export default any }`**——形式上补了声明，实质上什么都没补，正确做法是 `export const x: unknown` 再在使用处收窄；**靠 `--noImplicitAny false` 消音**——它会连带取消隐式 `any` 参数、演化数组、递归返回类型一整类报错（上一章的对照实验已证明）。

## `skipLibCheck` 的取舍与声明文件的排查

`skipLibCheck: true` 跳过对 **`.d.ts` 内部**的类型检查（含 `node_modules` 里的）。给一个自身有错的声明文件（`export interface Cfg { host: string; port: Port }`，而 `Port` 引用了不存在的 `NotHere`），实测两种跑法：

```text
$ npx tsc -p <配置，skipLibCheck: false>
error TS2304: Cannot find name 'NotHere'.          （来自 ch9-broken.d.ts）
error TS2307: Cannot find module '@/nope' ...      （来自你的源码）

$ 同一命令加 --skipLibCheck
error TS2307: Cannot find module '@/nope' ...
```

**`TS2304`（声明文件内部的错）消失了，`TS2307`（你自己代码里的错）仍在。** 这澄清了一种过度恐惧：`skipLibCheck` 不掩盖你项目里的错误，只掩盖别人 `.d.ts` 里的。取舍：新版 TS 配旧包（各包内嵌 `@types/*` 互相冲突）时噪音来自 `.d.ts` 内部，开它是正解；反过来，**你正在自己写 `.d.ts`** 时临时关掉它，才能让自己的声明被检查出来。默认值以 [tsconfig 参考](https://www.typescriptlang.org/tsconfig/#skipLibCheck)为准。

`declare` 写错的症状是「类型有，但不对」，比没类型更危险。三步：① 用探针 `const probe: 0 = yourValue;` 看报错左边念出的类型（上一章的方法）；② 已知缺陷用 `@ts-expect-error` 而不是 `@ts-ignore`——前者会在声明修好后报 `TS2578` 主动提醒你摘掉；③ 怀疑增强没生效时，`TS2664` 说明目标模块没被解析到，`TS2339: Property 'x' does not exist on type 'Window'` 说明你的全局声明根本没进这次编译（在 `include` 之外，或被 `typeRoots` 覆盖掉了默认目录）。

## `paths` 别名与构建工具的双份配置

`paths` 只影响**类型检查阶段的路径解析**，不改写产物里的导入说明符。实测这份配置（注意没有 `baseUrl`）：

```json
{
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "paths": { "@utils": ["./src/util.ts"], "@/*": ["./src/*"] }
  }
}
```

`import { twice } from "@utils"` 与 `import { twice as t2 } from "@/util"` **都解析成功**（前者直接映射到文件，后者走前缀通配），`@/nope` 报 `TS2307`。**`paths` 不配 `baseUrl` 也能用**（映射按 tsconfig 所在目录解析，实测这份配置里就没有 `baseUrl`）。

<Callout type="warn" title="两份配置，两个世界">

Vite 类项目里别名要在**两个地方**各写一遍：`tsconfig.json` 的 `paths` 负责编辑器与 `vue-tsc` 类型检查，构建工具（`vite.config.ts` 的 `resolve.alias`）负责真实打包。两边不一致的典型症状是「`tsc` 说没有这个模块」或「TS 毫无抱怨但构建报 `Failed to resolve import`」。本站没装 Vite，别名两侧配置的对应关系**我没有实测**，写法以 [Vite 官方文档](https://vite.dev/guide/)和 [tsconfig 的 paths 一节](https://www.typescriptlang.org/tsconfig/#paths)为准；`paths` 不影响产物这条是实测的——它不会重写导入路径，要在运行时生效需要额外手段。

</Callout>

## 发布自己的库：`declaration` 这条线点到为止

要让下游拿到类型，至少得处理 `declaration: true`、`declarationMap`（让下游跳到源码而非产物）、`outDir` / `rootDir` 保证 `.d.ts` 与 `.js` 路径对称、`package.json` 的 `"types"` / `"exports"` 指向正确，以及 `isolatedModules` 约束下的导出写法。本章实测到的两条相关事实：`--declaration` 会把推断结果原样写进产物（`= 1` 而不是 `: number`）；纯类型模块的 JS 产物是 `export {};`。选项组合见[tsconfig 关键选项](/typescript/tsconfig)。

## 本站常见故障：`Cannot find module` 的四种真实成因

| 成因 | 典型报错 | 怎么修 |
| --- | --- | --- |
| 1. 相对路径本身错了（文件不存在、大小写不符、`node16` 下漏扩展名） | `TS2307: Cannot find module './ch9-nope' ...`；或 `TS2835 ... Did you mean './ch9-mod.js'?` | 说明符以 `./` 开头就是路径问题；修路径，`node16` / `nodenext` 下写 `.js` 后缀 |
| 2. 包没类型 / 缺 `@types/*`（含 `@types/node`） | `TS2307: Cannot find module 'node:fs' ...`（实测） | 装 `@types/*`；没有就写 `.d.ts`（路 2） |
| 3. 别名两侧配置不一致 | TS 侧 `TS2307: Cannot find module '@/nope' ...`（实测）；构建侧 `Failed to resolve import` | `paths` 与 `resolve.alias` 都配、指向同一目录 |
| 4. 解析策略与包的写法不匹配 | 同一个包在 `bundler` 下正常、`node10` 下报 `TS2307`；非法组合报 `TS5095` / `TS5110` | 按官方「选择编译器选项」指南选组合 |

**排查顺序就按这张表自上而下**：先分清「相对路径问题」还是「裸包名问题」（30 秒能砍掉一半可能），再查类型来源，再查别名一致性，最后才怀疑解析策略。别一上来就改 `moduleResolution`——那会把一个路径拼写错误伪装成配置问题，然后你会改出三个新问题。

## 常见错误与排查

1. **`TS2669`** → 在「不是模块」的文件里写了 `declare global`。修法：加 `export {};`，或去掉 `declare global`（全局脚本里直接写 `interface Window { ... }` 就有效）。
2. **`TS2664: Invalid module name in augmentation`** → 你把包声明写进了模块文件，TS 把它当「增强」，而那个包解析不到。修法：移到独立非模块 `.d.ts`；或先安装该包再增强。
3. **`TS1205` / `TS1484`** → 分别对应 `isolatedModules` 下的再导出、`verbatimModuleSyntax` 下的类型导入。修法：`export type { Card } from "./card"`；`import type { User } from "./types"`。
4. **`TS1203`（+ `TS2309`）** → `module: esnext` 的项目里源文件写了 `export =`。修法：改 `export default` / 具名导出；只有在 `declare module` 内部描述 CJS 包才该用 `export =`（实测合法）。
5. **补了 `.d.ts` 却不生效** → 三种可能：文件没被 `include` 覆盖、`typeRoots` 设置后不再自动加载 `node_modules/@types`、声明文件顶层有 `import` / `export` 让它从「声明新包」变成「增强」。确认方式：把该文件显式加进 `tsc` 命令行看报错是否消失（本章就是这样验证的）。
6. **`allowJs` 打开后「类型全通」但 bug 照旧，或 `skipLibCheck: true` 后自己写的 `.d.ts` 里的错也不报了** → 前者是隐式 `any` 泄漏（实测零报错），后者是 `skipLibCheck` 对所有声明文件生效（实测 `TS2304` 被吞）。修法：给关键边界函数补 `.d.ts` 或手写签名；写声明期间临时关掉 `skipLibCheck`。

## 练习

<Exercise title="练习 1 · 判断哪一行会留在产物里" difficulty="基础">

下面这个文件用 `npx tsc --module esnext --target es2022 --strict` 编译，产物 JS 里有几条 `import`？分别来自哪一行？

```ts
import type { User } from "./types";
import { greet } from "./mod";
import "./side-effect";
```

<template #answer>

两条：`import { greet } from "./mod";` 和 `import "./side-effect";`（副作用导入没有绑定，本来就必须保留）。第一行整条消失——本章用同结构文件实测过，产物里只剩值导入那条。要点：`import type` 是纯类型通道，不进入模块图，能用来切断运行时循环依赖；反过来，任何「靠导入触发副作用」的代码都不能用 `import type`。

</template>

</Exercise>

<Exercise title="练习 2 · 补一个真实缺类型的包" difficulty="进阶">

假设 `legacy-toast` 没有任何类型，你只用到 `toast.show(msg, { sticky: true })` 和 `toast.dismissAll()`。写出最小 `.d.ts`，说明它该放在哪、要满足什么条件才生效，并解释为什么不要写成 `const toast: any`。

<template #answer>

```ts
declare module "legacy-toast" {
  export function show(msg: string, opts?: { sticky?: boolean }): void;
  export function dismissAll(): void;
}
```

放在项目里一个**非模块**的 `.d.ts`（`typings/legacy-toast.d.ts` 或 `types/legacy-toast/index.d.ts`），并确认它在 `include` 覆盖范围内、或目录被 `typeRoots` 指向。生效的实测证据：补之前那条 `TS2307` 存在，把声明文件交给 `tsc` 后它消失。不要写 `const toast: any`——那等于用声明文件的形式掩盖一个 `any` 泄漏点，全链路失去检查；也别一次声明三十个成员，只声明真用到的，写错的部分比空缺更危险。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造报错并读懂它" difficulty="进阶">

在一个已有 `./ch9-mod` 的项目里，写一个含 `import { greet } from "./ch9-mod"` 的文件，再在这个文件里加上 `declare module "some-not-installed-lib" { export const x: number; }`。预测 `npx tsc --noEmit --strict` 会说什么，解释报错里的关键术语，并给出两种修法。

<template #answer>

实测报错：

```text
error TS2664: Invalid module name in augmentation, module 'some-not-installed-lib' cannot be found.
```

关键是 **augmentation（增强）**这个词：文件里有 `import` / `export`，它是一个**模块**，模块里的 `declare module "X"` 被解释为「给已存在的 X 增补类型」，而 X 解析不到，于是报错。两种修法：① 把声明搬到独立的 `.d.ts`，且该文件顶层没有任何 `import` / `export`（此时语义变成「声明一个外部模块」，实测可用）；② 若确实要增强真实存在的包，先把包（或它的 `@types`）装上。附带：同一段代码若缺 `export {}` 而写在脚本文件里，`declare global` 会报 `TS2669`——两条报错是同一根因（文件是模块还是脚本）的不同表现。

</template>

</Exercise>

<Exercise title="练习 4 · 选组合并说出它防什么" difficulty="挑战">

三种项目：A 纯 Vite 打包的浏览器应用、B 用 `node` 直接跑的 ESM 后端、C 要发布给别人的库。为每种写出 `module` 与 `moduleResolution` 的候选组合，并说明哪些组合会被编译器当场拒绝（用本章实测的报错号回答）、哪种写法会强制你改导入语句。

<template #answer>

有实测依据的拒绝：`--module commonjs --moduleResolution bundler` 报 `TS5095`；`--module esnext --moduleResolution nodenext` 报 `TS5110`。会强制改导入语句的是 `node16` / `nodenext`：相对导入必须带 `.js`，否则 `TS2835`。

常见选择：A 用 `module: esnext`（或 `preserve`）+ `moduleResolution: bundler`，允许省扩展名、能读 `exports`；B 用 `module: nodenext`（配 `moduleResolution: nodenext`），代价是全部相对导入加 `.js`；C 取决于产出形态，`exports` 与 `types` 写错会让下游报 `TS2307`。**哪个值是当前版本推荐的最优解请以[选择编译器选项指南](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)为准**，本章只保证「不兼容组合一定报错」。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Modules（Handbook）](https://www.typescriptlang.org/docs/handbook/2/modules.html) 与 [Type Declarations](https://www.typescriptlang.org/docs/handbook/2/type-declarations.html) —— 「文件是模块还是脚本」的判定（`TS2669` / `TS2664` 的根因）与 `declare` 家族的语义。
- [Declaration Files: Introduction](https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html)、[Consuming declaration files](https://www.typescriptlang.org/docs/handbook/declaration-files/consumption.html) 与 [Module declaration template](https://www.typescriptlang.org/docs/handbook/declaration-files/templates/module-d-ts.html) —— 补声明的官方范式与 TS 找类型的顺序（核实「ambient 模块必须写 `export`」）。
- [Choosing Compiler Options](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html) —— `module` / `moduleResolution` / `verbatimModuleSyntax` 的官方决策路径；本章只给实测约束。
- [tsconfig 参考](https://www.typescriptlang.org/tsconfig/) —— 逐项核实 [`isolatedModules`](https://www.typescriptlang.org/tsconfig/#isolatedModules)、[`skipLibCheck`](https://www.typescriptlang.org/tsconfig/#skipLibCheck)、[`typeRoots`](https://www.typescriptlang.org/tsconfig/#typeRoots)、[`paths`](https://www.typescriptlang.org/tsconfig/#paths) 的默认值与版本要求；[`moduleResolution: bundler` 的引入（TS 5.0 发行说明）](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)。
- [Node.js Packages（`exports` 字段）](https://nodejs.org/api/packages.html) 与 [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) —— 包导出条件的权威定义；查现成 `@types/*` 的地方。

## 下一章

本章让这些类型跨文件、跨包流动起来——包括最脏的一块：没有类型的第三方代码怎么接进来。下一章回到 `tsconfig.json` 本身：`strict` 家族里每个开关分别防哪种错误（本章已经见过 `noImplicitAny`、`isolatedModules`、`skipLibCheck` 这些名字）、`target` 与 `lib` 的分工，见[tsconfig 关键选项](/typescript/tsconfig)。
