# 类型推断与上下文类型：让 TypeScript 自己算，并知道它什么时候算错

```ts
const count: number = 0;              // 冗余：不写也是 number
const user = JSON.parse(raw);         // 危险：user 是 any，一路不检查
const shape = { kind: "a" } as Shape; // 压坏：字面量推断被断言覆盖
```

第一行是噪音；第二行不是「没写类型」，而是**写了一个在任何位置都不会报错的 `any`**；第三行把 TS 已算出的字面量类型换成更宽的名义类型，判别联合的收窄从根上失效。TS 的日常主力是**推断（type inference）**，不是标注：要知道 TS 默认算出什么、哪些情形会算出 `any` 或过宽类型、怎么用最小代价掰回来。

本章结论均为本机实跑（TypeScript 5.9.3 + Node v25.4.0，2026-10-17），报错原样粘贴。基础命令 `npx tsc --noEmit --strict --target es2022 --module esnext --lib es2022,dom <文件>`；另用 `--declaration --emitDeclarationOnly --moduleResolution bundler` 把推断结果写进 `.d.ts`，用 `--noImplicitAny false` 做对照。还有一个反复使用的技巧：`const probe: 0 = x;` 逼编译器在报错里念出 `x` 的真实类型——**不报错就说明它是 `never`**。

## 初字面量与放宽：`const` 与 `let` 完全不同

对 `export let w1 = "hello"`、`export const w2 = "hello"`、`export const w7 = [1, "x"]`、`export const w8 = { name: "Tom", age: 12 }` 跑声明产物命令：

```text
export declare let w1: string;
export declare const w2 = "hello";
export declare const w7: (string | number)[];
export declare const w8: { name: string; age: number; };
```

规律一句：**`const` 保持字面量类型，`let` / `var` / 参数放宽到基元类型**——可变的东西以后能被赋别的值，`let greeting = "hi"` 必须让 `greeting = "yo"` 合法。想钉住字面量：`as const`，或显式联合 `let dir: "up" | "down" = "up"`。

**联合类型在初始化表达式里形成**；`const r = { ok: true, data: null }` 实测得 `{ ok: boolean; data: null }`——`ok` 被放宽、`data` 没有，两者不对称。

## `let x = null`：不是万能变量，但你依然别这么写

两种相反的说法（「得到 `null`，赋字符串该报错」/「自动扩展的隐式 `any`」），实测结论是**都部分对，取决于 `noImplicitAny`**：`let x1 = null; x1 = "a"; x1 = 1;` 两次赋值都不报错，但把 `x1` 读出来赋给 `string` 得 `TS2322: Type 'number' is not assignable to type 'string'.`——读到的是**最后一次赋值的结果**。写上注解（哪怕就是 `null`）扩展立刻消失：`let x2: null = null; x2 = "a";` 报 `TS2322: Type '"a"' is not assignable to type 'null'.`；函数内局部是第三种形态，`let y = null; y = "a";` 之后探针报 `Type 'string' is not assignable to type '0'`。

对照实验最关键：**同一个 `let u1 = null; u1 = "a";`，`--strict` 下不报错，`--strict --noImplicitAny false` 下报 `Type '"a"' is not assignable to type 'null'`。** 这种「演化中的类型（evolving / auto type）」是 `noImplicitAny` 的补偿机制：跨作用域或导出边界就失效、类型取决于赋值顺序而非意图。正确写法只有一种——**把可选性写进类型**：`let currentUserId: string | null = null;`。

空数组同理：`let arr1 = []` 被导出或在 push 前读取时报 `TS7034: Variable 'arr1' implicitly has type 'any[]' ...` 与 `TS7005: Variable 'arr1' implicitly has an 'any[]' type.`；而 `const evolving = []; evolving.push(1);` 再读 `evolving[0]` 在 `--strict` 下零报错。**别依赖这个差异**，一开始就写 `const rows: Row[] = []`。

<Callout type="verified" title="关掉 noImplicitAny 后空数组变成 never 数组">

对照命令（TypeScript 5.9.3，`npx tsc --noEmit --strict --noImplicitAny false ...`，2026-10-17）下 `const evolving = []; evolving.push(1);` 报错：

```text
error TS2345: Argument of type '1' is not assignable to parameter of type 'never'.
```

演化机制被关掉后 `[]` 的元素类型是空联合 `never`——**演化数组是 `noImplicitAny` 的行为，不是语言的基础规则**。

</Callout>

## `as const` 与 `readonly`：断言到底改了什么

`as const` 不是「变成常量」，是**阻止放宽 + 把容器标记为只读**。实测：

```text
export declare const w9: { readonly name: "Tom"; readonly age: 12; };    // 对象加 as const
export declare const w10: readonly ["start", "stop"];                    // 数组加 as const
```

三个变化同时发生：属性加 `readonly`、值换成字面量类型、数组换成只读元组（长度和顺序进类型）。常见用处：判别联合的 `kind`、路由表、i18n 文案表。

<Callout type="warn" title="as const 只作用在它所在的表达式上">

`as const` 不穿透函数边界：若 `makeRows()` 返回 `number[]`，`makeRows() as const` 只加一层 `readonly`，元素仍是 `number`。想让字面量进来，推断必须从字面量表达式本身开始，或给函数返回类型写「元组 + 字面量类型」。`readonly` 还是**浅**的，`Object.freeze` 只声明为 `Readonly<T>`——类型层面的只读不等于运行时冻结。

</Callout>

## `satisfies`：既校验又保留推断

`as` 只检查「能不能赋过去」，不查多余属性，还覆盖推断结果。`satisfies` 是：**用右边的类型校验左边表达式，但左边保持 TS 自己算出的类型。**

```ts
interface Pet { name: string; legs?: number }
export const p1 = { name: "Kitty", legs: 4 } satisfies Pet;
export const p2 = { name: "Kitty", legs: 4 } as Pet;
export const p3 = { name: "Kitty", eat() { return 1 } } satisfies Pet;
```

```text
export declare const p1: { name: string; legs: number; };
export declare const p2: Pet;
error TS2353: Object literal may only specify known properties, and 'eat' does not exist in type 'Pet'.
```

`p1` 保留了 `legs: number`（**必填的 `number`，不是 `legs?: number | undefined`**），`p1.legs.toFixed()` 直接合法；`p2` 被断言成 `Pet` 后 `legs` 变回可选，用前必须判空——「断言压坏推断」最日常的形态。`p3` 说明 **`satisfies` 确实做多余属性检查**（实测，与常见说法相反）。选择规则：要「符合形状但保留精确类型」用 `satisfies`，要「钉住字面量」用 `as const`（可叠加），`as` 很少真需要。`as` 的「压坏」还有一种日常形态：判别联合 `Shape = { kind: "a"; n: number } | { kind: "b"; s: string }`，`const sh1 = { kind: "a", n: 1 } as Shape` 把 `kind` 放宽成 `"a" | "b"`，之后 `s.n` 报 `TS2339`，嵌套第二行「Property 'n' does not exist on type `{ kind: "b"; s: string; }`」点明报错来自**没被排除**的成员——意思是「你还没收窄」；`as unknown as T` 则是**零检查**（实测越权调用一个报错都没有），TS 只在重叠不足时拒绝直接 `as`（`TS2352`），见到「绕两跳」就该回头改类型定义。

叠加 `{ home: "/", about: "/about" } as const satisfies Record<string, string>` 实测让 `routes.home` 是 `"/"`；`satisfies` 还逐个成员检查——对 `Record<string, () => string>` 写 `count: (n: number) => String(n)` 得 `TS2322: Type '(n: number) => string' is not assignable to type '() => string'. Target signature provides too few arguments.`

## 上下文类型：回调参数为什么不写类型

`[1,2,3].map(n => n * 2)` 里 `n` 没写类型却是 `number`，这叫**上下文类型**：TS 从「函数被放到哪个期望的函数类型上」反推参数类型，方向**从外到内**。实测（`--lib es2022,dom`）：`["a","bb"].forEach((s, i) => ...)` 给 `s: string`、`i: number`；`[1,2].reduce((acc, n) => ...)` 给 `n: number`（`acc` 由初始值决定）；`new Map<string, number>().forEach((v, k) => ...)` 给 `v: number`、`k: string`。而 **`click` 在 TS 5.9.3 的 DOM 类型里是 `PointerEvent` 而不是 `MouseEvent`**（`keydown` 是 `KeyboardEvent`），`addEventListener("click", (e) => ...)` 里 `e.pointerType` 可以直接用。上下文类型两种情况下消失：承载它的函数没有类型（从 `any` 上取出的 `map`，回调参数隐式 `any`，报 TS7006）；或者你写的注解与上下文不兼容——此时 TS 直接拒绝而不是静默覆盖：`[1, 2, 3].map((n: string) => n)` 得 `TS2345: Argument of type '(n: string) => string' is not assignable to parameter of type '(value: number, index: number, array: number[]) => string'.`，报错里那行完整签名就是上下文类型的全貌。准则：**回调参数一律不写类型**；需要写时，通常是上游那个函数的类型本身写坏了。

## 控制流分析：类型在分支里被改窄

推断跟着执行路径走，叫**控制流分析**；下表每格都是分支里用探针逼出来的真实类型：

| 起始类型 | 判断 | 分支内类型（实测） |
| --- | --- | --- |
| `string \| number \| null` | `typeof x === "string"` / else | `string` / `number \| null` |
| `string \| number` | `if (x)` / else | `string \| number` / `string \| number` |
| `string \| null \| undefined` | `x == null` / else | `null \| undefined` / `string` |
| `{a:number} \| {b:string}` | `"a" in x` / else | `{ a: number; }` / `{ b: string; }` |
| 判别联合三成员 | `switch (e.t)` 各 case | 各自的完整成员类型 |

**最反直觉的是真值判断：`if (x)` 对 `string | number` 两个分支都不收窄**（`0` 和 `""` 都是假值，无法确定地删成员）；真值收窄只在能排除 `null` / `undefined` / `false` 这类**独立类型**时生效。`== null`（两个等号）一次排除 `null` 和 `undefined`，`=== null` 会留下 `undefined`。`switch` 对判别联合最实用：命中 `case` 后整个对象换成对应成员，`default` 拿到 `never`（穷尽检查的落点，见[联合类型与类型收窄](/typescript/unions-and-narrowing)）；坑是只处理部分 `case` 且无返回注解时，返回类型会含 `undefined`。

<Callout type="warn" title="收窄只在同一作用域且变量不可重新赋值时可靠">

控制流分析对 `let` 变量在闭包里的读取会失效：`let flag = false;` 配上 `function set() { flag = true }` 与 `function read() { if (flag) { /* 这里 flag 不一定是 true */ } }`，TS 无法推断闭包被调用的时机。回调里要收窄就用 `const`、参数，或在使用处再判一次——这是「明明判过了为什么还报错」的第一大原因。

</Callout>

## 推断失败的五种典型情形与各自修法

前三种编译器直接报错，后两种更危险——**它算出了 `any` 或过宽类型，而且不报错**。

| # | 情形 | 实测报错 / 现象 | 修法 |
| --- | --- | --- | --- |
| 1 | 参数没类型 | `TS7006: Parameter 'x' implicitly has an 'any' type.` | 补注解；该支持多种值就改泛型（[泛型](/typescript/generics)） |
| 2 | 递归函数缺返回注解 | `TS7023: 'fact' implicitly has return type 'any' ...`（在自身返回表达式里被引用） | 写 `function fact(n: number): number` |
| 3 | 对象字面量自引用 | `TS7022: 'lazy' implicitly has type 'any' ... in its own initializer.` + `TS2448: Block-scoped variable 'lazy' used before its declaration.` | 先 `interface Node { self: Node }`，再 `const lazy: Node = { self: lazy }` |
| 4 | `JSON.parse` | **不报错**：返回 `any`，`data.a.b.c.d` 一路畅通 | `unknown` 接住 + 运行时校验 |
| 5 | `localStorage` | 读出 `string \| null`，直接用得 `TS18047: 'parsed' is possibly 'null'.` | 判空 + `unknown` + 校验函数 |

情形 4：`const data = JSON.parse('{"a":{"b":1}}')` 之后 `data.a.b.c.d` 不报错，`const badCall: number = data.a.b.toUpperCase()` **也不报错**——全程 `any`，连「把 `string` 结果赋给 `number`」都不拦。修法：让 `unknown` 站在门口，用返回类型谓词把关：

```ts
function isConfig(v: unknown): v is { host: string; port: number } {
  return typeof v === "object" && v !== null
    && typeof (v as Record<string, unknown>)["host"] === "string";
}
const parsed: unknown = JSON.parse(raw);
if (isConfig(parsed)) parsed.host.toUpperCase();   // 到这里才有真保护
```

空对象同一类：`const obj1 = {}; obj1.anything = 1` 得 `TS2339: Property 'anything' does not exist on type '{}'.`，修法是把意图写进类型：`const byId: Record<string, Row> = {}`。

## `@ts-expect-error` 与 `@ts-ignore`

两者都能压掉下一行的报错，差别在**问题消失时**：`@ts-ignore` 永远沉默，那行不再需要压制你也永远不知道，压制本身变成技术债；`@ts-expect-error` 要求下一行**必须**有报错，否则反过来提醒你 `error TS2578: Unused '@ts-expect-error' directive.`。所以**必须压制时用 `@ts-expect-error`，永远不要用 `@ts-ignore`**。规范三条：只压**一行**、压最小的表达式；注释写清「在等什么」；不能用它掩盖自己写错的类型定义——`TS2322` / `TS2345` 描述的是**运行时会发生的错**，压制只是把崩溃推迟到线上。

## 返回值与泛型实参：推断需要你搭手的两处

返回类型也实测可推断（`export declare function f1(x: string, y: number): { x: string; y: number }`）。取舍：**递归函数必须写**（TS7023）；**对外 API 建议写**——返回类型是承诺，不写则一次内部重构就可能改变公共类型；**异步写 `Promise<T>`**（`Promise<User>` 而不是 `User`）；单表达式箭头与局部 helper **不写**；只有副作用的过程**不写 `: void`**。经验：**标注的价值与它的暴露范围成正比**（见[为什么要用 TypeScript](/typescript/why-types)）。

泛型实参同理。对 `declare function ident<T>(x: T): T` 跑 `ident("abc")`、`ident<string>("abc")`、`ident(["a"])`，实测产物依次是 `export declare const g2 = "abc";`、`export declare const g3: string;`、`export declare const g4: string[];`——`T` 无约束时字面量不放宽（很多人以为会）。三种需要显式传或特殊手段的情形：**类型参数只出现在返回位置**（`identity([])` 落到 `never[]`，必须写 `identity<string[]>([])`）；**推断结果太宽**（`["start","stop"]` 推成 `string[]`，调用处 `as const`，或让函数用 `const` 类型参数（TS 5.0+），实测 `run(["start","stop"])` 直接得 `readonly ["start", "stop"]`）；**多个实参竞争同一个 `T`**（TS 取并集式公共上界，`NoInfer<T>`（TS 5.4+）可排除一个——`assign2<T>(value: T, fallback: NoInfer<T>)` 里 `assign2("a", "b")` 报 `TS2345: Argument of type '"b"' is not assignable to parameter of type '"a"'.`）。铁律：**要保留字面量，就让字面量直接出现在参数位置**——`pick({ a: 1, b: "x" }, ["a"])` 实测推得 `K = "a"`，先把数组赋给变量再传就变成 `string[]` 并报 TS2345。

## `noImplicitAny`：一条开关撑起半壁推断质量

它只做一件事：**TS 算不出类型时禁止默默给 `any`，改成报错。** 对照实验：TS7006、TS7023、TS7022、TS7034 + TS7005 在关掉 `noImplicitAny` 后**全部消失**；`strict: true` 已包含它（见 [tsconfig 关键选项](/typescript/tsconfig)）。传染性也实测过：`function leaky(x: any) { return x.notThere.deeper }` 一路合法，`export const leakyOut = leaky({})` 同样是 `any`——**一个 `any` 参数就足以让整条导出链失去保护**。

## 常见错误与排查

1. **`TS7006` 参数隐式 `any`** → 参数没有任何类型来源（回调挂在无类型库函数上）。修法：补注解；该接受多种值就改泛型；来自 `any` 属性（`obj.map`）先修 `obj`。
2. **`TS7023` / `TS7022` implicitly has type `'any'`** → 递归函数缺返回类型，或对象字面量在自己的初始化里被引用。修法：函数写返回注解；对象先声明 `interface` 再 `const x: Node = ...`。
3. **明明写了字面量，类型却是 `string`** → `let` / 参数会放宽，数组字面量放宽成 `(string | number)[]`。修法：`as const`、显式联合，或让被调方用 `const` 类型参数。
4. **`as` 之后所有类型保护都失效** → 断言把判别字段放宽成联合（实测 `sh1` 后 `s.n` 报 TS2339）。修法：改 `satisfies`，或保留字面量再赋给目标类型。
5. **`JSON.parse` 一路无报错，或 `TS18047: possibly 'null'`** → 前者拿到 `any`，后者是 `getItem` 返回 `string | null`。修法：判空 + `unknown` 接住 + `v is T` 把关，别用 `as string` 骗过去。
6. **`if (x)` 之后类型没变窄** → 真值判断不排除 `0` / `""`（实测两分支都保持 `string | number`）；闭包里判过 `let` 仍报 possibly undefined，是收窄不跨越回调。修法：`typeof` / 判别字段 / `== null`，或先 `const local = maybe` 再判。

## 练习

<Exercise title="练习 1 · 让编译器念出收窄后的类型" difficulty="进阶">

先预测下面函数 `if (x)` 分支把 `x` 收窄成什么，再给每个分支加一条 `const probe: 0 = x;`，从 `npx tsc --noEmit --strict <文件>` 的报错里核对：

```ts
export function f(x: string | number | null) {
  if (x) { return x }
  return x;
}
```

<template #answer>

两个分支都报 `TS2322: Type 'string | number | null' is not assignable to type '0'.`——`if (x)` **完全没有收窄**：`0` 和 `""` 都是假值，无法确定地删成员。要收窄得写 `typeof x === "string"`、`x !== null` 或 `x == null`。

</template>

</Exercise>

<Exercise title="练习 2 · as 与 satisfies 的差别" difficulty="基础">

同一个 `Pet`（`legs?: number`），分别用 `as Pet` 和 `satisfies Pet` 写两遍，都调用 `x.legs.toFixed(2)`：哪个报错？再给 `satisfies` 那个加一个接口里没有的字段，会看到什么？

<template #answer>

`as Pet` 报错（`legs` 可能为 `undefined`）：断言把类型替换成 `Pet`，`legs` 回到可选。`satisfies Pet` 不报错，实测 `{ name: string; legs: number; }`，保留必填。加未知字段时 `satisfies` 报 `TS2353: Object literal may only specify known properties`，`as` 完全不拦。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造报错并读懂它" difficulty="进阶">

把下面这段存成文件跑 `npx tsc --noEmit --strict --target es2022 --module esnext <文件>`，得到三条互相独立的报错。逐条解释并各给一种修法：

```ts
export function walk(node) {
  return node.children.flatMap((c) => walk(c));
}
export const lazy = { self: lazy };
export const arr = [];
arr.push(1);
export const first: string = arr[0];
```

<template #answer>

- `TS7006: Parameter 'node' implicitly has an 'any' type.`——参数无类型来源；递归还会连带触发 `TS7023`。修法：`interface Node { children: Node[] }`，写 `function walk(node: Node): Node[]`。
- `TS7022: 'lazy' implicitly has type 'any' ... in its own initializer.` + `TS2448: Block-scoped variable 'lazy' used before its declaration.`——初始化里引用了自己。修法：`interface Node2 { self: Node2 }`，再 `export const lazy: Node2 = { self: lazy }`。
- 空数组的演化机制让 `arr[0]` 变成最后 push 的 `number`，于是 `TS2322: Type 'number' is not assignable to type 'string'`。修法：`const arr: number[] = []` 明确元素类型，让报错指向「意图（string）与数据（number）不一致」这个真正的问题。

</template>

</Exercise>

<Exercise title="练习 4 · 把 any 泄漏堵住" difficulty="挑战">

下面这段在 `--strict` 下**零报错**，但运行时几乎一定崩。指出 `any` 从哪里进来、有几处，并按「不允许 `any` 和非空断言」改写：

```ts
export function loadCfg(key: string) {
  const raw = localStorage.getItem(key);
  const data = JSON.parse(raw!);
  return data.server.host.toUpperCase();
}
```

<template #answer>

两处泄漏：`raw!`（key 不存在时是 `null`，`JSON.parse(null)` 不抛错而返回 `null`，下一行 `.server` 崩）和 `JSON.parse` 返回的 `any`（`data.server.host.toUpperCase()` 全程零检查）。改写：判空后把结果放进 `unknown`，用 `v is Cfg` 谓词逐层把关（`typeof v === "object" && v !== null`、`typeof server["host"] === "string"`），返回 `Cfg | null`。边界校验一次；真实项目会用 schema 库（zod / valibot）生成把关，`raw!` 属于[类型取舍](/typescript/tradeoffs)里要严格管控的手段。

</template>

</Exercise>

## 官方文档与延伸阅读

- [The Basics](https://www.typescriptlang.org/docs/handbook/2/basic-types.html)、[Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) 与 [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) —— 「初字面量 vs 放宽」、`as const` 与控制流分析（`typeof` / `in` / 真值 / `== null` / 判别联合 / `assert` 函数）的官方表述。
- [TS 4.9 satisfies](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html)、[TS 5.0 const 类型参数](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)、[TS 3.9 @ts-expect-error](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-9.html) —— 三个特性的引入版本与设计动机。
- [noImplicitAny](https://www.typescriptlang.org/tsconfig/#noImplicitAny) 与 [Choosing Compiler Options](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html) —— 开关归属与 `--target` / `--module` / `--lib` 组合的官方依据；`lib.dom` 事件类型随版本变动，动手前以官方为准。

## 下一章

下一章把本章机制合起来用：**内置工具类型不是语法魔法，它们就是泛型 + 条件类型 + 映射类型三段拼图的成品**，见[工具类型、条件类型与映射类型](/typescript/utility-types)（泛型本身的机制见[泛型](/typescript/generics)）。
