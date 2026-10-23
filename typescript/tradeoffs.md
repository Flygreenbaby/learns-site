# 真实项目中的取舍：哪些妥协是有意识的，哪些是在拆报警器

`strict` 全开之后，最贵的不是类型语法，而是**边界上的判断**。两种真实失败姿势：一路 `any` + `as` 把编译推到 0 报错、线上炸在 `undefined` 而 CI 全绿；或者第一天开 `strict` 被三百条报错吓退，把它改回 `false`，从此类型系统只作用于一两个新文件。前者是自欺，后者是把报警器当噪音拆掉。

这条线怎么画：**每个妥协都要可追溯（写明为什么）、可撤销（有条件就能删掉）、可度量（计数只降不升）。**

<Callout type="verified" title="本章实跑清单">

环境 Node `v25.4.0`、`Version 5.9.3`、2026-10-17，命令 `npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler <文件>`。跑过并贴出结果的文件：`any-contagion.ts`、`any-in-export.ts`、`as-misuse.ts`、`as-overlap.ts`、`unknown-needs-narrowing.ts`、`brand-plain.ts`、`brand.ts`、`satisfies-vs-as.ts`、`palette.ts`、`expect-error-unused.ts`、`validator.ts`（最后这个在 `--strict --noUncheckedIndexedAccess` 下 0 报错）。临时目录已删除。没跑的内容集中在两处 unverified 提示框：运行时校验库的 API 名、按子开关逐个回退 `strict` 的写法。

</Callout>

## `any` 有三种来源，只有一种能被编译器抓

| 来源 | 症状 | 编译器会不会提醒 |
| --- | --- | --- |
| 显式写的 `any` | `const data: any = JSON.parse(s)` | **永远不会** |
| 隐式 `any`（缺注解） | `function fmt(x) { ... }` | 会：`TS7006: Parameter 'x' implicitly has an 'any' type.` |
| 从依赖漏进来 | 导入无类型 `.js` 或缺 `@types` 的包 | 只在 `noImplicitAny` 开着时报 `TS7016: Could not find a declaration file for module './legacy-js'. ... implicitly has an 'any' type.` |

传染性是真正的代价：`any` 双向流通（任何类型能赋给它、它能赋给任何类型），属性访问、调用、下标全部免检。实测这段跑 `--strict`，**只有一行报错，而且那行跟 `any` 无关**——是我自己把 `toFixed()`（返回 `string`）赋给了 `number`：

```ts
declare const payload: any;
export const total: number = payload.items.count;   // 0 报错
export function shout(s: string): string { return s.toUpperCase(); }
shout(payload);                                     // 0 报错：any 塞进任何签名
const pair: [number, string] = payload;             // 0 报错
export const first: number = pair[0].toFixed();     // TS2322（我自己的错）
```

第二个实测更能说明问题：一个把 `any` 写在**返回值**上的函数（`function load(url: string) { const data: any = JSON.parse(url); return data.result; }`），在 `--strict --noImplicitAny` 下 **0 报错**，而它的两个调用点（一处赋给 `number`、一处塞给 `string` 参数）同样安静。所以工程上最重要的一条硬规矩是：**`any` 出现在函数签名上比出现在函数体里危险一个数量级**——体内的 `any` 只脏一个函数，签名上的 `any` 脏所有调用方，且编译器一声不响。

## `any` 的可接受边界与工程约束写法

三个条件同时满足才算「有意识的妥协」：**只在边界**（`JSON.parse`、无类型库、日志格式化这类编译器原理上不可能知道的位置）、**不外泄**（对外签名是 `unknown` 或具体类型，出口前被校验/收窄）、**可追溯**（现场一行原因 + 一个能删掉它的条件）。

```ts
// 反例：any 上了签名，两个调用点全盲
export function load(raw: string) {
  const data: any = JSON.parse(raw);
  return data.result;                      // 返回类型 any
}
// 正例：承诺对外是 unknown，调用方必须收窄或走校验器
export function load(raw: string): unknown {
  return JSON.parse(raw).result;
}
```

三层拦法，缺一层就失控：**① `grep` 基线**——CI 统计 `: any`、`as any`、`any[]` 次数并写进 job summary，规矩只有一条「只降不升」，这是唯一不需要说服任何人就能落地的度量；**② lint**——`@typescript-eslint` 的 `no-explicit-any` 加一族 `no-unsafe-*`（专门报「在 `any` 上取值/调用」），因为上一段实测已经证明 `tsc` 对显式 `any` 永远沉默，这层必须由 lint 提供（规则名与默认级别以你装的版本文档为准，本章没装 eslint）；**③ 评审约定**——`any` 出现在导出签名或 `.d.ts` 上必须解释，出现在函数体内允许合并。

唯一禁止的是「为了让某行不报错而写 `any`」。该问的是这一行的数据从哪来、能不能在源头标成 `unknown`。

## `unknown` 的正确用法：一个能直接抄走的边界校验器

`unknown` 的规则：什么都能装进来，但只能赋给 `unknown`/`any`，用之前必须收窄。实测对它直接取属性：`TS18046: 'v' is of type 'unknown'.`

它的准确价值不是「比 `any` 安全一点」，而是**强制你把运行时检查和类型承诺写成同一件事**。下面这份实现实测在 `--strict --noUncheckedIndexedAccess` 下 0 报错：

```ts
export type User = { id: number; name: string; tags: string[] };

export class ValidationError extends Error {
  constructor(public readonly path: string, reason: string) {
    super(path + ": " + reason);
    this.name = "ValidationError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function need(o: Record<string, unknown>, key: string): unknown {
  const v = o[key];
  if (v === undefined) throw new ValidationError(key, "字段缺失");
  return v;
}
function needString(o: Record<string, unknown>, key: string): string {
  const v = need(o, key);
  if (typeof v !== "string") throw new ValidationError(key, "期望 string，实际 " + typeof v);
  return v;
}
function needNumber(o: Record<string, unknown>, key: string): number {
  const v = need(o, key);
  if (typeof v !== "number" || Number.isNaN(v)) throw new ValidationError(key, "期望 number");
  return v;
}
function needStringArray(o: Record<string, unknown>, key: string): string[] {
  const v = need(o, key);
  if (!Array.isArray(v)) throw new ValidationError(key, "期望 array");
  return v.map((item, i) => {
    if (typeof item !== "string") throw new ValidationError(key + "[" + i + "]", "期望 string 元素");
    return item;
  });
}

export function parseUser(v: unknown): User {
  if (!isRecord(v)) throw new ValidationError("body", "期望 JSON 对象");
  return { id: needNumber(v, "id"), name: needString(v, "name"), tags: needStringArray(v, "tags") };
}
```

四个设计各自都是取舍：**入参一律 `unknown`**（不是 `any`、不是 `object`），`isRecord` 是唯一入口守卫；**每个 `need*` 返回具体类型**，检查与承诺在同一个函数里，调用方不需要再断言一次；**失败抛异常而不是返回布尔**，且错误带 `path`——布尔版（`isValid(v): boolean`）配合 `asserts` 也能写（第 3 章），但线上没有「哪个字段、为什么」；**`noUncheckedIndexedAccess` 开着也不报错**，因为 `Record<string, unknown>` 上 `o[key]` 是 `unknown`，`undefined` 被吸收，`need` 里那次判断是真实的运行时检查、不是哄编译器。

对照 `as` 一把梭（实测 `--strict` **0 报错**）：

```ts
type User = { name: string; email: string };
const raw = JSON.parse('{"name":"a"}') as User;
export const e: string = raw.email.toUpperCase();   // 编译过，运行时 TypeError
```

同一个 bug，校验器在边界抛 `ValidationError: email: 字段缺失`（栈里有字段名），断言版在业务深处抛 `Cannot read properties of undefined (reading 'toUpperCase')`。**这就是排查成本的差距。**

## `as` 的三种正当用途与三种滥用

`as` 的语义是「用我说的类型替换你推断的类型」：不是转换、不做校验、不产生运行时代码（第 1 章的类型擦除）。

正当：**① `as const`**——它不撒谎，只是要求别把字面量放宽，产物一致（第 7 章实测）；**② 检查已经发生、但编译器证明不了的地方**——`Object.keys(obj) as Array<keyof typeof obj>`、判过 `null` 之后的 `document.getElementById("app") as HTMLCanvasElement`；判据是**运行时那一步真的存在**；**③ 边界校验器内部的造值**（见下面 brand 一节），断言旁边就是一次真检查。

滥用：**① 外部数据直接断言**（上面实测 0 报错、运行时炸）；**② 用断言消音**（`x as any`、`x as never` 压掉 `TS2322`，错消失、缺陷留下）；**③ `as unknown as X` 双跳**。第三条值得钉死，因为 `as` 唯一的防呆会被官方报错文案亲手教唆绕过——实测 `"hello" as number` 报：

```text
error TS2352: Conversion of type 'string' to type 'number' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
```

而 `"hello" as unknown as number` **0 报错**。所以 `TS2352` 不是保护，是一条多打八个字符就能跨过的减速带；写下 `as unknown as` 之后，那行的类型承诺没有任何依据，和 `@ts-ignore` 同档。

## `satisfies` 才是你想要的那个断言

如果写 `as` 的目的是「检查这个值符合某个类型」，正确工具是 `satisfies`。同一段错误数据，实测两种报错（源码分别是 `as Routes` 与 `satisfies Routes`，数据是 `{ home: "/", missing: 404 }`，`type Routes = Record<string, string>`）：

```text
satisfies-vs-as.ts(2,18): error TS2352: Conversion of type '{ home: string; missing: number; }' to type 'Routes' may be a mistake ... Property 'missing' is incompatible with index signature. Type 'number' is not comparable to type 'string'.
satisfies-vs-as.ts(3,32): error TS2322: Type 'number' is not assignable to type 'string'.
```

断言那条粗、还提示你「故意的话转 `unknown`」；`satisfies` 那条**短、直接指在属性上**。第二个差别更关键——`as` 会替换类型、丢掉每个键各自的推断。实测：

```ts
type Palette = Record<string, string | number[]>;
const viaAs = { red: [255, 0, 0], green: "#00ff00" } as Palette;
const viaSat = { red: [255, 0, 0], green: "#00ff00" } satisfies Palette;
export const a1 = viaAs.green.toUpperCase();   // TS2339: 联合上的方法没了
export const a2 = viaSat.green.toUpperCase();  // 通过：green 仍是 string
export const a3 = viaSat.red.map((n) => n + 1); // 通过：red 仍是 number[]
```

一条判断式：写 `as` 之前问自己要的是「检查」还是「改写」。九成是检查 → `satisfies`；剩下那一成是编译器推不出来 → `as` + 现场一行原因。

## `@ts-expect-error` 的使用规范

第 1 章实测过两者差别：`@ts-ignore` 把「错已经消失」一起吞掉，`@ts-expect-error` 在没有错时反报 `TS2578: Unused '@ts-expect-error' directive.`（本章又跑了一次，同一条）。所以**只用后者**，四条规矩：

```ts
// @ts-expect-error 第三方库 lib-x@2.3 的 sendMessage 重载缺失，运行时确实接受 (to, text)；
// 升级该库后请删除本行并确认不再报错。
lib.sendMessage(to, text);
```

**① 必须带原因文字**（紧跟指令、写清撤销条件），裸指令在评审里等于没注释；**② 只压紧邻的下一行**，多行问题要拆点或改类型定义；**③ 必须可撤销**，原因里带版本/条件/issue 链接，`TS2578` 是免费的垃圾回收信号，别用 `@ts-ignore` 把它关掉；**④ 禁止用来绕自己的建模问题**——错因是「联合没判别字段」「可选属性该拆成两种」时，压住只是把债留给下一个人。`@ts-nocheck` / `@ts-check` 只出现在迁移过渡期的 `.js` 里（见下面第 2-3 步）。

## 结构化类型的意外兼容，与 brand

TS 看形状不看名字（第 1、4 章）。日常症状是**两个语义完全不同的同形状类型可以互换**，实测这段 0 报错：

```ts
type UserId = string;
type Email = string;
declare function sendTo(e: Email): void;
declare const uid: UserId;
sendTo(uid);   // 通过：把用户 ID 当收件地址发出去
```

这就是首页列的「两个都是 `string`，参数顺序写反，编译期毫无察觉」。brand（品牌类型）的做法是加一个**运行时不存在的伪字段**，让形状不再相同，实测报错：

```text
brand.ts(5,8): error TS2345: Argument of type 'UserId' is not assignable to parameter of type 'Email'.
  Type 'UserId' is not assignable to type '{ readonly __brand: "Email"; }'.
    Types of property '__brand' are incompatible.
      Type '"UserId"' is not assignable to type '"Email"'.
```

代价要记账：brand 值只能用 `as` 造（`const toUserId = (s: string): UserId => s as UserId;`），或者由一个真做校验的函数造（`parseEmail(s: string): Email | null`，合法才断言）。正确用法是**在边界造一次，之后全项目只流转 brand 类型**——那一次断言集中、可评审、有运行时检查背书，比散在二十个调用点上的 `as` 好得多。

判据只有一条：**这个字符串传错了会不会造成不可逆后果**（发信、扣款、写库）。会，上 brand；不会，就靠命名和对象参数（`sendTo({ email })` 比 `sendTo(email)` 更难传错）。给每个业务 `string` 都加 brand 的成本会迅速超过收益：`Partial<Form>`、序列化、测试假数据都要多一层造值。

另两类意外兼容不是技巧问题而是配置/建模问题：函数参数的双向协变（第 10 章那条 `TS2345` 就是调严之后才报的）、`class` 只有含 `private`/`protected` 时才带一点名义性。

## `null` 还是 `undefined`：团队约定，不是语法问题

| 语义 | 写法 | 典型来源 |
| --- | --- | --- |
| 这个键不存在 | `title?: string`（配 `exactOptionalPropertyTypes`） | PATCH 请求体、可选配置 |
| 键存在但值为空 | `title: string | null` | 数据库列、JSON 的 `null` |
| 还没算出来 | `title: string | undefined` | `Map.get`、`find`、数组越界（第 10 章那条开关） |

三条要写进团队文档的约定：**① JSON 和数据库边界统一用 `null`，不用缺键**——`JSON.parse` 产出的是 `null`，而 `{ ...a, ...b }` 里的 `undefined` 会覆盖有效值（`TS2379` 防的就是这个，第 10 章实测）。混用两种「没有」是线上 `undefined` 的头号来源。**② `??` 与 `||` 分清**：`count || 10` 会把 `0` 和 `""` 变成 `10`；`?.` 只负责短路、把结果变 `undefined`，**不是收窄**（第 3 章）。**③ 别引入 `Option`/`Maybe` 库逃避判断**：一个 `type Maybe<T> = T | null` 别名带来的可读性提升就够，单子风格让所有调用点都要 `.map/.andThen`，收益付不起这个成本。

命名同样影响类型的有效性：`isXxx`/`hasXxx` 给布尔、`xxxAt` 给时间戳、`xxxId` 给 ID。字段名和后端差一个驼峰（`createdAt` vs `created_at`）是编译器抓不到的，只有边界映射层能抓——这正是校验器该在的位置。

## 类型文件怎么摆

| 放哪 | 适用 | 反面信号 |
| --- | --- | --- |
| 使用它的模块里 | 单文件辅助类型 | 为「统一」把每个类型塞进 `types/`，改一个函数跨三个文件 |
| `src/types/<领域>.ts` | 跨模块数据模型、判别联合、DTO | `types/index.ts` 膨胀到几百行且互相引用 |
| 边界层（`api/`、`schemas/`） | 外部数据的校验器 + 它的类型 | 类型在 `types/`、校验在 `api/`，改字段各改一半 |
| 全局 `.d.ts` | 只有环境扩展需要（第 9 章） | 业务类型写成全局 `declare`，命名冲突且无法 tree-shake |

三条规则：**DTO 类型跟数据来源放，不跟使用它的组件放**（挨着那个请求函数，用 `Pick`/`Omit` 从主模型派生，第 8 章，别手抄字段）；**什么时候导出**——它是导出函数签名的一部分（否则报 using private name 一类错）、或调用方要构造这个值；**什么时候不导出**——纯内部中间类型，少导出就少契约；**重导出类型要写 `export type`**（`isolatedModules` 下是硬要求，`verbatimModuleSyntax` 会更早提醒，见第 9、10 章实测的 `TS1484`）。前后端共享类型应该是一个小包而不是「前端复制一份」，见 [Monorepo 与工作区](/frontend-engineering/monorepo)；走 OpenAPI 生成类型是另一条路线，见 [API 文档](/backend/api-docs)。

## 运行时校验库的定位：主线是「类型从 schema 推导」

上面那个手写校验器能干活，但有两处重复：**类型定义写一遍、检查逻辑再写一遍**，字段一改两边都动，改漏一边还不会报错（两边彼此独立）。校验库解决的就这一条：**schema 是唯一来源，类型从 schema 推导**，于是运行时检查与编译期类型在结构上不可能不一致。

```ts
// 概念形态，不是可运行代码：schema 写一次，类型由它推导
const UserSchema = /* 某个库的对象 schema，声明 id/name/tags */;
export type User = /* 从 UserSchema 推导类型的工具类型或函数 */;
export function parseUser(v: unknown): User { /* 运行时校验 + 返回值类型同源 */ }
```

值得引入：外部数据种类多（多个接口 + MQ 消息 + `localStorage` + AI 返回）、需要结构化失败信息、团队接受一个依赖。不值得：只有两三个边界点、字段稳定、手写版不到五十行（手写的好处是零依赖、错误信息完全可控）。**无论用哪个，架构不变**：校验发生在边界，校验函数返回具体类型，业务代码里永远拿不到 `unknown`/`any`。

各库的 API 名与方法（`parse`/`safeParse`/`assert` 这类）、版本与行为差异本章一律不写具体名字：这块变动频繁，而本站没装任何校验库、没跑过，写出来就是不可核实的二手信息——动手前查它自己的官方文档。同类边界还有 AI 返回的 JSON（[结构化输出](/ai-apps/structured-output)）与后端「一份 schema 同时用于校验和接口文档」（[Fastify 的 Schema 一节](/backend/fastify-basics)）。

## 渐进式迁移一个 JS 项目：分步、每步可验证、每步能回退

标准失败姿势是某天有人把整个 `src` 改名成 `.ts` 并开 `strict`，报错三百条，两周后不了了之。可行路径是把类型检查当成一条**只增不减的覆盖率曲线**：

| 步 | 动作 | 可验证产出 | 怎么回退 |
| --- | --- | --- | --- |
| 0 | 确认测试能跑、CI 有绿灯 | 一条「基线通过」记录 | 不改代码 |
| 1 | 装 `typescript` 到 `devDependencies` + 加 `tsconfig.json`（`noEmit: true`、`allowJs: true`、`checkJs: false`、`include` 只列一个目录） | `npx tsc --noEmit` 退出码 0（此时还没检查任何 JS）；产物与运行时零变化 | 删配置 + 卸包，1 分钟 |
| 2 | 挑 1-3 个高价值文件加 `// @ts-check`（或开 `checkJs`） | 一份错误清单（条数、集中在哪）；实测 `--checkJs` 会对 JS 参数报 `TS7006: Parameter 'name' implicitly has an 'any' type.` | 关掉，报错归零 |
| 3 | 给它们补 JSDoc 类型（`@param`/`@returns`/`@typedef`）直到 0 错 | 「带类型的文件数」从 0 变 N；不改扩展名、不改构建 | `git revert` 单文件 |
| 4 | 把这 N 个文件改名 `.js` → `.ts`，`strict` 仍 `false` | `--showConfig` 的 `files` 里有它们；0 报错 | 改回扩展名 |
| 5 | 只开 `noImplicitAny` 一项 | `TS7006` 计数（新增 + 存量）修到 0 | 关这一项，单开关回退 |
| 6 | 开 `strict: true` | `--showConfig` 里 9 个子开关全 `true`；错误按子开关归类 | 逐项关掉挡路的（见下） |
| 7 | 开 `noUncheckedIndexedAccess`，同时给每个外部入口配一个 parse 函数 | 边界文件清单：每个入口有且只有一个 parse | 关这一项 |
| 8 | 把 `npx tsc --noEmit -p tsconfig.json` 加进 CI，设为**必需检查** | CI 里一个独立绿色步骤；此后 `any` 计数只降不升 | 从 CI 移除（不该发生） |
| 9 | 每新增目录就扩 `include`，旧目录逐个 `strict` 化 | 覆盖率曲线（被检查文件数 / 总数）单调上升 | 缩 `include` |

<Callout type="unverified" title="两处没验证的操作细节">

一是**按子开关逐个回退 `strict`** 的命令行写法：本章所有对照都是靠「不带 `--strict`」与「带 `--strict`」跑的，我没验证 `--noStrictNullChecks` 这类反写在 CLI 上能不能用；在配置文件里逐项写 `false` 是常规做法，但请以你自己一次 `--showConfig` 的输出为准。二是**自动迁移工具**（官方 `ts-migrate` 那一类）的现状与效果我没安装跑过，所以不推荐任何工具；第 3、4 步手工做，一天几十文件的节奏比一把梭的 codemod 更容易活下来。

</Callout>

顺序里唯一硬依赖：**第 8 步必须在第 6 步之后**。把 `tsc --noEmit` 进 CI 的那天，就是它必须能过的那天——否则所有人学到的第一课是「这条红线可以 ignore」。这是流程设计问题，不是类型问题。

## CI 里类型检查怎么跑

本站根 `package.json` 里真实存在的脚本（只读参考）是 `"type-check": "vue-tsc --noEmit -p tsconfig.json"`。三条要点：**① 独立步骤，不塞进构建**——构建（Vite）只转译（第 10 章实测过官方说法），失败信息才分得清是产物坏了还是类型坏了，GitHub Actions 里写成两个并列 step，见 [CI/CD 与 GitHub Actions](/devops/ci-cd)；**② 靠退出码判定**——第 1 章实测 `tsc` 报错时照样输出 JS，所以纯检查项目必须 `noEmit: true`，CI 只看退出码，本地想看完整报错加 `--noErrorTruncation`；**③ 含 `.vue` 用 `vue-tsc`**，普通 TS 用 `tsc`。`incremental` + `noEmit` 的组合行为我没验证，也不建议在 CI 里指望增量缓存（缓存文件不在两次流水线之间传递）。

lint 与类型检查不可互替：ESLint 抓风格与**显式** `any`，`tsc` 抓类型不一致（本章第一节就是证据）。测试与 CI 分层见[测试体系](/devops/testing)。

## 什么时候不值得上 TypeScript

成本主要三样：类型建模的时间、报错带来的迭代摩擦、无类型依赖造成的 `any` 泄漏。

| 场景 | 建议 | 理由 |
| --- | --- | --- |
| 一次性脚本、当天跑完的数据处理 | 不上 | 代码寿命比配置时间短 |
| 明确要扔的原型 / 界面 demo | 不上 | 原型的价值在改得快 |
| 三人仓库、三百行、无对外接口 | 可选 | 收益来自重构，这种项目不重构 |
| 只想给现有 `.js` 一点保护 | `checkJs` + JSDoc | 第 2-3 步实测它能报隐式 `any`，零迁移成本拿六成收益 |
| 长期维护、多人、有 API 边界 | 上，且第一天开 `strict` | 中途开比第一天开贵得多 |
| 频繁重构、字段改名、类型跨端共享 | 上 | 「改个函数名漏了三处」只有类型系统兜得住 |
| 大量无类型/半类型动态库，没人补声明 | 谨慎 | `TS7016` 那类泄漏会让 `any` 遍布签名，形同虚设 |
| 团队没共识、CI 跑不了 `tsc --noEmit` | 先别上 | 没有流程保障的 TS 会退化成一堆能被 `as` 绕过的注释 |

一句话判断式：**问「这些错误会不会再次发生」，别问「类型是不是好习惯」。** bug 集中在业务分支、并发时序、缓存击穿时（那些开关一个都拦不住），TS 边际收益低；集中在字段名、可空性、参数传错、跨模块签名时，是它的主场。

## 常见错误与排查

1. **现象：这一行明明有问题，`tsc` 一声不响。** 原因：值是 `any`（显式写的，或从某个导出签名漏进来的）。确认：悬停看类型 + `grep -n ": any\|as any" src/`。修：把源头签名改成 `unknown` + 边界校验，**别在这一行加断言**。
2. **现象：加了 `as User`，运行时才在别的文件炸。** 原因：断言不校验（实测 0 报错）。确认：临时换成 `satisfies User`，立刻报出具体属性（`TS2322`，见上面实测）。修：边界改成返回具体类型的 parse 函数，调用点不再出现断言。
3. **现象：两个 `string` 参数被传反，编译通过。** 原因：结构化类型 + 同形状字符串（实测 `brand-plain.ts` 0 报错）。修：不可逆操作上 brand，或改成对象参数。
4. **现象：加了 `@ts-expect-error` 这行不报了，别处冒出新 bug。** 原因：真正问题在建模（判别字段缺失、可选属性该拆）。确认：删掉指令读完整报错的后半段——TS 会告诉你是哪个属性不兼容。修：改类型定义。
5. **现象：`TS2578: Unused '@ts-expect-error' directive.`** 原因：这个错真被修好了。这不是要压的错，**删掉它**，免费的垃圾回收。
6. **现象：开 `exactOptionalPropertyTypes` 后 `Partial<T>` 相关集中爆错。** 原因：`Partial` 表达「可缺键」，你到处传 `undefined` 表示「不填」（`TS2379`）。修：只给语义真允许空值的字段加 `| undefined`；批量加等于把这条开关掏空（第 10 章练习 5 有论证）。
7. **现象：CI 里类型检查 3 分钟，有人提议删掉。** 确认：临时关 `skipLibCheck` 看是否有 `.d.ts` 冲突反复触发；精确化 `include` 后测时间差。修：拆 `tsconfig.build.json` 只查源码、把检查作为与构建并行的独立 job，别删。
8. **现象：迁移到第 6 步报错太多，有人提议先关 `strict`。** 修：按子开关分类清账、分批合入，第 8 步可以延后但第 6 步不能跳过；真要留活口就缩小 `include`（第 9 步），而不是放宽开关。

## 练习

<Exercise title="练习 1 · 故意制造一条 any 泄漏并证明它无声" difficulty="基础">

写 `function readConfig(raw: string): any`，内部 `return JSON.parse(raw).settings;`。在另一个文件里：把返回值赋给 `number`、把它传给一个接受 `string` 的函数、访问不存在的 `cfg.deeply.missing.now`。

（1）跑 `--strict` 看到几条错？（2）这三行分别什么时候暴露？（3）不外泄 `any` 的最短写法？

<template #answer>

（1）**0 条**。本章跑过完全同构的例子（`any-in-export.ts`：返回值 `any`，一处赋给 `number`、一处塞给 `string` 参数），`--strict --noImplicitAny` 下 0 报错——编译器对显式 `any` 永远沉默，这正是本章存在的理由。

（2）全部只在运行时暴露：赋给 `number` 那行要到「用到这个值」才算错；传给 `string` 参数那行大概率走进一次 `.toUpperCase()` 才炸；`cfg.deeply.missing.now` 按访问深度在不同数据下炸，而栈最深处往往不是真正错的那行。

（3）`function readConfig(raw: string): unknown { return JSON.parse(raw).settings; }`，调用点必须收窄或走本章校验器；写 `Record<string, unknown>` 也行，但对嵌套字段没有额外保护。

</template>

</Exercise>

<Exercise title="练习 2 · 把 as 换成 satisfies，读懂新报错" difficulty="基础">

```ts
type Routes = Record<string, string>;
const routes = { home: "/", missing: 404, login: "/login" } as Routes;
```

（1）这里为什么已经报错（写错误号）？（2）换成 `satisfies Routes` 后报错怎么变？（3）两种写法下 `routes` 的推断类型分别是什么？

<template #answer>

（1）`TS2352`——`missing: 404` 让对象与 `Routes` 没有足够重叠。注意这正是断言唯一的防呆，而且报错文案顺手教你用 `as unknown as Routes` 绕过它（本章实测双跳 0 报错）。

（2）变成 `TS2322: Type 'number' is not assignable to type 'string'.`，位置直接指在 `missing: 404` 上（实测 `satisfies-vs-as.ts(3,32)`）。更短、更准，且没有「先转 unknown」的邀请。

（3）`satisfies` 版本保留逐键类型（`{ home: string; missing: number; login: string }` 修正后同理），所以 `routes.hoe`（拼错）会报；`as Routes` 版本把整个对象改写成 `Record<string, string>`，任何键都是 `string`，拼错键名也照样通过——差别见 `palette.ts` 实测的 `TS2339`。

</template>

</Exercise>

<Exercise title="练习 3 · 写一个 brand 版 Email，并解释那一次 as" difficulty="进阶">

实现 `parseEmail(s: string): Email | null`：内部做真实判断，合法才返回 `Email`。（1）函数体里为什么必须出现一次 `as`？这次和 `JSON.parse(s) as User` 有什么本质区别？（2）把 `Username` 传给 `sendEmail(e: Email)` 会报什么（写关键行）？（3）给这个设计算成本账。

<template #answer>

（1）因为 `string` 不能赋给 `string & { readonly __brand: "Email" }`，而运行时也没有任何东西能造出那个伪字段（它压根不存在），只能断言：

```ts
type Email = string & { readonly __brand: "Email" };
export function parseEmail(s: string): Email | null {
  return s.includes("@") ? (s as Email) : null;
}
```

区别在于**这次断言旁边就有一次真实检查**，且全项目只发生在一处；`JSON.parse(s) as User` 没有任何检查、发生在每个调用点。集中、有背书的断言可审计，散落的不可。

（2）`TS2345`，关键行是本章实测的第三层：`Types of property '__brand' are incompatible. Type '"Username"' is not assignable to type '"Email"'.` 读起来别扭，但信息量正是「你拿错了 ID 类型」。

（3）成本：每个 brand 值要一个 parse 函数（并写测试）、测试假数据要么调 parse 要么写 `as`、表单类型混合 brand 与 raw `string` 变啰嗦、序列化后 brand 消失（`JSON.stringify` 出来还是 `string`，反序列化必须重新 parse）。收益只有一个：把「传错同类字符串」从不可见变成编译期可见。**只有不可逆操作值得付。**

</template>

</Exercise>

<Exercise title="练习 4 · 给存量项目设计迁移节奏" difficulty="挑战">

4 万行 `.js`、无测试、npm script 只有 `start`，要求「下季度上 TS」。（1）为什么不能第一步就把 `tsc --noEmit` 加进 CI？（2）第 1 步的 `allowJs: true` + `checkJs: false` 到底带来了什么？（3）两个月后只覆盖 15%，算失败吗？

<template #answer>

（1）一条永远过不去的红线会被所有人学会忽略，连后面真要拦的一起废掉；而且第 10 章那条结论会叠加——构建本来就不做类型检查，你缺的不是「一个报错很多的步骤」，而是「一个能过并逐渐变严的步骤」。先把覆盖率推到能过（或把 `include` 限制在能过的部分），再设为必需。

（2）三个具体产出：一套能跑的编译配置（`target`/`lib`/`module` 从此可讨论）、`--showConfig` 给出的「到底生效了什么」、以及**一条 0 报错的红线基线**（`checkJs: false` 时 `.js` 进程序但不被检查）。运行时零变化，删两个文件就能回退。

（3）不算失败，只要满足三条：新代码 100% 在检查范围内、CI 那一步是绿的、`any` 计数从第一个月起只降不升。迁移的本质是**存量债务冻结 + 增量受控**；15% 覆盖率配上这三条，远好过「开了 `strict` 又关掉」——后者就是本章开头那种失败。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Everyday Types 的 Type Assertions 一节](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions) —— 核实本章对 `as` 的表述：断言不检查、不转换，只重写推断方向。
- [`unknown` 的官方说明](https://www.typescriptlang.org/docs/handbook/2/functions.html#unknown) 与 [对象类型里的 unknown 一节](https://www.typescriptlang.org/docs/handbook/2/objects.html#the-unknown-type) —— 核实「`unknown` 只能赋给 `unknown`/`any`、必须先收窄」这条规则（`TS18046` 是实测，规则表述以这两页为准）。
- [`satisfies` 的发行说明](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html) —— 核实它的设计意图「检查但不覆盖推断」，对应本章 `palette.ts` 的实测差异。
- [从 JavaScript 迁移到 TypeScript](https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html) 与 [tsconfig 的 allowJs 一节](https://www.typescriptlang.org/tsconfig/#allowJs) —— 核实九步表的官方顺序（`allowJs` → JSDoc/`@ts-check` → 逐文件改名 → 收紧 `strict`）；`--checkJs` 报 `TS7006` 是本章实测。
- [Vite 文档的 TypeScript 一节](https://vite.dev/guide/features) —— 核实「CI 里类型检查怎么跑」那条前提：Vite 只转译、官方要求额外跑 `tsc --noEmit`。
- [TypeScript ESLint 规则文档](https://typescript-eslint.io/rules/) —— 核实 `no-explicit-any` 与 `no-unsafe-*` 这一族规则的存在与作用（本章没装 eslint，规则名与默认级别以该页为准）。
- [结构化输出](/ai-apps/structured-output) —— 站内衔接：模型返回的 JSON 就是本章说的「外部数据边界」，同一套「schema 单一来源 + 边界校验」。

## 下一章

第 10 章[tsconfig 关键选项](/typescript/tsconfig)摊开了编译器那份合同，本章补上它管不到的另一半：`any` 的三种来源与沉默的传染、`unknown` 与校验器、`as` 的边界、`satisfies`、brand、`null` 约定、类型摆放、迁移节奏与 CI。到这里 1-11 章的工具齐了。第 12 章[阶段项目](/typescript/project)要把它们用在一件具体的事上：把 JavaScript 领域那个纯 JS 待办清单重写成 TS——`strict` 加 `noUncheckedIndexedAccess` 全开、零 `any` 泄漏、每个外部入口都经过一个 parse 函数，并且要**故意写坏两处**（泛型实参、`switch` 分支）证明类型真的在起作用。那份项目里你要做的第一个决定就是「边界在哪里」，而这正是本章的全部内容。
