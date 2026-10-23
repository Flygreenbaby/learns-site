# 基础类型与类型注解：四个特殊类型、字面量推断与何时该写标注

`let name: string = null;` 这行在很多项目里活了很多年。它不出错，直到某天这个值被传进 `name.trim()`，页面在某个特定用户身上崩掉。原因不是「你忘了写类型」——你写了——而是**一项开关被关掉了**，于是 `null` 可以塞进任何类型。

写标注不难，难的是两件事：**知道每个类型给了你什么保证**（`unknown` 和 `any` 差一个字，一个强迫你证明、一个直接放弃），以及**知道什么时候根本不该写**（`const count: number = 0` 是噪音，还会在重构时和真实推断打架）。

本章结论全部本机实跑：TypeScript 5.9.3 + Node v25.4.0，日期 2026-10-17。命令统一是 `npx tsc --noEmit --strict --target es2022 --module esnext <文件>`（关掉某个开关时会在命令里写出来），引用的报错原样粘贴。

## 原始类型与 `typeof` 的对应

JavaScript 有 7 个**原始类型（primitive）**，加上函数与对象。这段探针我在 Node v25.4.0 里真跑过：

```js
const p = [typeof 1, typeof "a", typeof true, typeof undefined, typeof null,
  typeof {}, typeof [], typeof (() => 0), typeof 10n, typeof Symbol()];
console.log(p.join(" | "));
// number | string | boolean | undefined | object | object | object | function | bigint | symbol
```

**三个坑全在里面**：`typeof null` 是 `"object"`、`typeof []` 是 `"object"`、`typeof` 永不返回 `"null"` 也永不返回 `"array"`。记住它，下一章 `typeof` 守卫为什么要额外判 `null` 就一目了然。

| 值 | TS 类型 | 运行时 `typeof` | 注意 |
| --- | --- | --- | --- |
| `"a"` | `string` | `"string"` | 别写 `String`（那是包装对象的接口名） |
| `1` / `NaN` / `Infinity` | `number` | `"number"` | `NaN` 也是 `number` |
| `10n` | `bigint` | `"bigint"` | 不能与 `number` 混算 |
| `true` | `boolean` | `"boolean"` | 没有 truthy 类型 |
| `undefined` | `undefined` | `"undefined"` | 省略返回值时函数也是它 |
| `Symbol()` | `symbol` | `"symbol"` | 只有 `unique symbol` 能当属性键 |
| `null` | `null` | **`"object"`** | 运行时谎报 |
| `() => {}` | 函数类型 | `"function"` | 给不出参数与返回信息 |
| `{}` / `[]` | 对象类型 / `T[]` | `"object"` | 数组和 `null` 都归到 `object` |

小写 vs 大写：`string` / `number` / `boolean` / `symbol` / `bigint` 是你该用的；`String` / `Number` / `Boolean` / `Object` / `Function` / `Array` 是内置接口名，用作标注会带来一堆兼容性问题。**永远不要写大写开头那几个。**

## `strictNullChecks`：这个开关决定你 80% 的日常体验

`strict` 打开时 `null` / `undefined` 是独立类型，不能塞给别的类型；关掉时它们是「万能值」，所有类型都接受。同一份文件我把两种配置都跑了：

```ts
let userName: string = null;
let age: number = undefined;

function label(x: string | null) {
  return x.length;
}

function findUser(id: number) {
  return id > 0 ? { name: "阿丽" } : null;
}

const u = findUser(0);
console.log(userName, age, label(null), u.name);
```

<Callout type="verified" title="同一个文件，两种配置，退出码从 2 变成 0">

```text
$ npx tsc --noEmit --strict --target es2022 --module esnext .scratch/ts-ch2-strict.ts
.scratch/ts-ch2-strict.ts(1,5): error TS2322: Type 'null' is not assignable to type 'string'.
.scratch/ts-ch2-strict.ts(2,5): error TS2322: Type 'undefined' is not assignable to type 'number'.
.scratch/ts-ch2-strict.ts(5,10): error TS18047: 'x' is possibly 'null'.
.scratch/ts-ch2-strict.ts(13,41): error TS18047: 'u' is possibly 'null'.
（退出码 2）

$ npx tsc --noEmit --strict --strictNullChecks false --target es2022 --module esnext .scratch/ts-ch2-strict.ts
（无任何输出，退出码 0）
```

**四行真实存在的判空缺失，关掉开关后编译器一个都不报。** 「TS 没帮我抓到 bug」的抱怨里，很大一部分其实是「没开 `strictNullChecks`」。

</Callout>

`strict` 到底开了什么，本机 `npx tsc --strict --showConfig` 的展开是：`noImplicitAny`、`noImplicitThis`、`strictNullChecks`、`strictFunctionTypes`、`strictBindCallApply`、`strictPropertyInitialization`、`strictBuiltinIteratorReturn`、`alwaysStrict`、`useUnknownInCatchVariables`（另有由 `target` 推出的 `useDefineForClassFields`）。逐个防什么错误见 [tsconfig 关键选项](/typescript/tsconfig)。

## `unknown`、`any`、`never`、`void`：四个规则各不相同

**`any`** 关掉的是**该值流经的所有检查**：能赋给任何类型、能取任何属性、能当函数调，且 TS 不给提示。它是唯一「写下去就追不回来」的类型——第 1 章说过，`any` 的数量和能抓到的 bug 数量成反比。日常只该出现在迁移临时标注和外部数据边界（且边界处立刻收窄），详见[真实项目中的取舍](/typescript/tradeoffs)。

**`unknown`** 的规则只有一条：**先收窄，再用**。

```ts
function useUnknown(x: unknown) {
  return x + 1; // error TS18046: 'x' is of type 'unknown'.
}
function useUnknownOk(x: unknown) {
  if (typeof x === "string") return x.toUpperCase(); // 零报错
  return String(x);
}
```

两条都实测了。`unknown` 的正确出处是**外部数据**：`JSON.parse` 的返回、`postMessage` 的 `event.data`、`fetch` 未定型的结果——它们的真实类型就是「不知道」。`catch (e)` 里的 `e` 在 `strict` 下同样是 `unknown`（`useUnknownInCatchVariables` 的效果），这点我专门跑过：`.scratch/ts-ch2-catch.ts(5,12): error TS18046: 'e' is of type 'unknown'.`，正解是 `if (e instanceof Error)`（也跑过，零报错），见[错误处理与 DevTools 调试](/javascript/errors-and-debugging)。

**`never`** 表示「不可能有值」，三个用途：

```ts
let n: never = "a"; // error TS2322: Type '"a"' is not assignable to type 'never'.
function alwaysThrows(code: number): never {
  throw new Error("code " + code);
}
function kind(x: string | number) {
  if (typeof x === "string") return "s";
  if (typeof x === "number") return "n";
  const reveal: never = x; // 零报错：x 在这里真的是 never
  return reveal;
}
```

只有第 1 行报错，`reveal` 那行**不报错**——这就是**穷尽检查**的原理：分支排除完剩下的类型是 `never`，而没有任何值能赋给 `never`，所以**漏一个分支就报错**。我把 `typeof x === "number"` 那行删掉重跑，果然得到 `.scratch/ts-ch2-ex.ts(25,9): error TS2322: Type 'number' is not assignable to type 'never'.`。`never` 作返回类型还意味着调用点之后的代码 TS 知道不会执行。下一章把它配 `switch` 展开。

**`void`** 反直觉的是**方向**，不是宽松：

```ts
declare function logIt(msg: string): void;

// 方向 1：源函数返回 void，目标要求返回 number
const f1: (m: string) => number = logIt;
// 方向 2：目标返回类型是 void，源返回什么都行
const f2: (m: string) => void = (m) => m.length;
const f3: () => void = () => 42;
// void 值本身不能当数据用
const f4: number = logIt("x");
// Promise<void> 不享受这层宽松
const f5: Promise<void> = Promise.resolve(1);
```

<Callout type="verified" title="void 的不对称方向与 forEach 黑洞都是实跑结果">

```text
.scratch/ts-ch2-void.ts(4,7): error TS2322: Type '(msg: string) => void' is not assignable to type '(m: string) => number'.
  Type 'void' is not assignable to type 'number'.
.scratch/ts-ch2-void.ts(9,7): error TS2322: Type 'void' is not assignable to type 'number'.
.scratch/ts-ch2-void.ts(11,7): error TS2322: Type 'Promise<number>' is not assignable to type 'Promise<void>'.
  Type 'number' is not assignable to type 'void'.
```

`f2` / `f3` 两行零报错（整个文件退出码 2，只有上面这三条）。**返回类型写成 `void` 的函数类型是「返回值黑洞」**：任何带返回值的函数都能赋给它，返回值被静默丢弃；反方向是错的，`void` 值本身也不能当数据（同批实验里 `let v: void = 1;` 报 `TS2322: Type 'number' is not assignable to type 'void'.`），`Promise<void>` 更不享受这层宽松。

这个规则有个众所周知的受害者：`forEach` 的回调签名就是 `(...) => void`，往里塞 `async` 回调编译器一句都不说。这段我真跑了编译和运行：

```ts
const files = ["a", "b", "c"];
async function uploadOne(f: string) {
  await new Promise((r) => setTimeout(r, 20));
  console.log("上传完成", f);
}
console.log("1 开始");
files.forEach(async (f) => {
  await uploadOne(f);
});
console.log("2 forEach 之后的这一行");
```

```text
$ npx tsc --noEmit --strict --target es2022 --module esnext .scratch/ts-ch2-foreach.ts
（无任何输出，退出码 0）

$ node .scratch/out8/ts-ch2-foreach.js
1 开始
2 forEach 之后的这一行
上传完成 a
上传完成 b
上传完成 c
```

同一份脚本改成 `for...of` + `await` 的版本，三个上传跑完才打印最后一行。**要并发等齐用 `await Promise.all(list.map(...))`，要串行用 `for...of`**；`forEach` + `async` 永远是错的。

</Callout>

## 数组与元组

`T[]` 与 `Array<T>` 是同一个类型，任选一种、全项目一致。真正要记的是这些差别（全部实测，报错原样）：

```ts
const ro: readonly number[] = [1, 2, 3];
ro.push(4);
// error TS2339: Property 'push' does not exist on type 'readonly number[]'.

type Pair = [string, number];
const p1: Pair = ["a"];
// error TS2322: Type '[string]' is not assignable to type 'Pair'.
//   Source has 1 element(s) but target requires 2.
const p2: Pair = ["a", 1, true];
//   Source has 3 element(s) but target allows only 2.

type Head = [string, ...number[]]; // 变长元组
const h1: Head = ["sum"];          // 通过：可变部分长度可以为 0
const nums: number[] = h1.slice(1);
// error TS2322: Type '(string | number)[]' is not assignable to type 'number[]'.
```

最后一条单独记：**元组做数组方法会退化成普通数组**。`slice` 的签名不知道从第几位切，返回元素类型的联合；`map` / `filter` / `concat` 同理。所以元组只适合「定长、位置有意义」的数据（多返回值、坐标、`[key, value]`），一开始要做大面积数组运算就用对象或数组。

`readonly` 阻止所有变更方法，但**不影响运行时**：`as const` 的对象编译后还是普通数组，谁都能改，真要冻结用 `Object.freeze`（回看[第 1 章 类型擦除](/typescript/why-types)）。

## 字面量类型：TS 最省力的武器

字面量类型把「值」当类型用——`"admin"` 比 `string` 小，只有一个值属于它。威力全在**推断差异**上。我用「赋给 `never`」把推断结果逼进报错文案（下一章还会反复用这招）：

```ts
let a = "admin";
const b = "admin";
const revealA: never = a; // error TS2322: Type 'string' is not assignable to type 'never'.
const revealB: never = b; // error TS2322: Type '"admin"' is not assignable to type 'never'.

const cfg = { mode: "fast", size: 2 } as const;
const revealCfg: never = cfg;
// error TS2322: Type '{ readonly mode: "fast"; readonly size: 2; }' is not assignable to type 'never'.
```

结论：**`let` 给宽类型 `string`，`const` 给字面量类型 `"admin"`**；`as const` 一次做两件事——每个属性变字面量类型 + 变 `readonly`。原因很简单：还能变的 TS 按「可变」定型，不会再变的按当前值定型。想「既精确又允许修改」只能显式写联合：`let role: Role = "admin"`。

配合联合类型就是免费的枚举替代：`type Role = "admin" | "editor" | "guest"`，传 `"GUEST"` 直接报错。**字面量联合 vs `enum`：** `enum` 生成真运行时代码（第 1 章实测的 IIFE），字面量联合零成本、能被 `keyof` / `Record` 派生、和 JSON 字符串天然对齐；`enum` 的价值在于运行时是真实对象，可以遍历、可以反查名字。**默认选字面量联合**，需要运行时可枚举再考虑 `enum`。`as const` 的更多行为归[类型推断与上下文类型](/typescript/inference)。

## `satisfies`：既要检查结构，又要保留推断

`satisfies` 是较新的运算符（本机 5.9.3 实测可用；引入版本请对照官方[发行说明](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html)）。它解决注解的老毛病——**类型注解会把推断抹平**：

```ts
type Sass = Record<string, number>;

declare function anyKey<T>(o: T): keyof T;

// 写法一：类型注解
const s1: Sass = { sm: 1, md: 2 };
const revealS1: never = anyKey(s1);

// 写法二：satisfies
const s2 = { sm: 1, md: 2 } satisfies Sass;
const revealS2: never = anyKey(s2);
const mdWidth: number = s2.md;

// satisfies 照样检查值类型
const s3 = { sm: "1" } satisfies Sass;

// 边界：satisfies 不会把数组变成字面量元组
const ROLES = ["admin", "guest"] satisfies readonly string[];
const revealRoles: never = ROLES;
```

<Callout type="verified" title="satisfies 与注解的推断差别（完整输出）">

```text
.scratch/ts-ch2-satisfies.ts(7,7): error TS2322: Type 'string' is not assignable to type 'never'.
.scratch/ts-ch2-satisfies.ts(11,7): error TS2322: Type '"sm" | "md"' is not assignable to type 'never'.
  Type '"sm"' is not assignable to type 'never'.
.scratch/ts-ch2-satisfies.ts(15,14): error TS2322: Type 'string' is not assignable to type 'number'.
.scratch/ts-ch2-satisfies.ts(19,7): error TS2322: Type 'string[]' is not assignable to type 'never'.
（退出码 2；`const mdWidth: number = s2.md;` 那行没有报错，satisfies 版的属性类型照样是 number）
```

**注解版 `keyof typeof s1` 只剩 `string`**（索引签名把具体键抹平了），**`satisfies` 版保留 `"sm" | "md"`**，第 3 条又说明它照样检查值类型——这就是「检查结构的同时保留字面量推断」。日常用途：配置表、主题表、路由表。最后一条是那个边界：`satisfies` 不会自动字面量化，要配 `as const`。

</Callout>

## 何时写注解，何时让推断做

这条决定你的代码是「TS 帮你」还是「你帮 TS」。同一个文件跑两个版本：

```ts
// A：不写参数注解
function useListA(items) {
  return items.map((it) => it.titlee); // 拼错的属性名
}
// B：只给参数写注解
function useListB(items: { id: number; title: string }[]) {
  return items.map((it) => it.titlee);
}
```

```text
$ npx tsc --noEmit --strict --target es2022 --module esnext .scratch/ts-ch2-contrast.ts
.scratch/ts-ch2-contrast.ts(2,19): error TS7006: Parameter 'items' implicitly has an 'any' type.
.scratch/ts-ch2-contrast.ts(3,21): error TS7006: Parameter 'it' implicitly has an 'any' type.
.scratch/ts-ch2-contrast.ts(7,31): error TS2551: Property 'titlee' does not exist on type '{ id: number; title: string; }'. Did you mean 'title'?

$ npx tsc --noEmit --strict --noImplicitAny false --target es2022 --module esnext .scratch/ts-ch2-contrast.ts
.scratch/ts-ch2-contrast.ts(7,31): error TS2551: Property 'titlee' does not exist on type '{ id: number; title: string; }'. Did you mean 'title'?
```

两个实测结论：**注解的价值不在「参数要有类型」，而在「它把类型传进函数体」**——B 里我只写参数，回调 `it` 的类型是推断来的，`titlee` 才被抓到；**A 那种函数在关掉 `noImplicitAny` 后完全静默**，整条链都是 `any`，而你以为自己在 TS 项目里是安全的。这就是「加了 TS 但零收益」的具体形态。

| 位置 | 写不写 | 原因 |
| --- | --- | --- |
| 导出函数的参数与返回类型 | **必须写** | 对外承诺，也是函数体推断的输入 |
| 公共类型（业务模型、接口返回） | 必须写，起别名 | 复用 + 可读 |
| 局部 `const` / `let` | 不写 | 推断比手写准，不会过期 |
| 回调参数 | 不写 | 上下文类型会传进来 |
| 要「检查结构 + 保留推断」的对象 | 用 `satisfies` | 见上一节 |

别名规则：**被复用或代表业务概念的形状就起别名，只用一次且字段少就内联。** `interface` 与 `type` 的差别到[对象类型与接口](/typescript/objects-and-interfaces) 再说（本站默认 `type`）。

## 给一个 JS 文件加类型：三步顺序

不要从头到尾一行行加，那是最慢且最容易中途放弃的顺序。

1. **先补函数签名**：每个导出函数的参数类型 + 返回类型。这一步把 `any` 变成真类型，函数体立刻开始报错——那些报错就是你的待办清单。
2. **再补边界数据**：`fetch`、`JSON.parse`、`localStorage`、表单值、事件对象。这些位置**先写成 `unknown`**，配运行时校验（下一章给骨架），别一上来就 `as`。
3. **最后消除隐式 any**：`noImplicitAny`（`strict` 已含）逐条处理 `TS7006`。我拿一段裸 JS 试的时候，同一份文件里 `TS7006` 一次冒了两条（两个参数各一条），形如 `error TS7006: Parameter 's' implicitly has an 'any' type.`。

第 1 步做完，第 3 步通常只剩零碎。渐进迁移策略见[真实项目中的取舍](/typescript/tradeoffs)，官方流程见 [Migrating from JavaScript](https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html)。

## 常见错误与排查

1. **`strict`（或只 `strictNullChecks`）没开就写 TS。** 现象：满屏 `&&` 判空但从不报缺失；线上偶发 `Cannot read properties of undefined`。确认：`npx tsc --showConfig` 看 `strictNullChecks: true`，或跑本章那份四行报错的对照。修：开 `strict`，一次性处理新增报错。
2. **把 `any` 当「稍后再补」。** 现象：报错消失了、属性访问全都「能编译」。确认：hover 看是不是 `any`；全局搜 `any` 计数。修：改成 `unknown` 并收窄，或补参数签名（本章 A/B 对照实测）。
3. **`unknown` 不收窄直接用。** 现象：`TS18046`（实测，`catch` 里的 `e` 同理）。确认：报错的对象来自哪个边界。修：`typeof` / `in` / `Array.isArray` / 判别字段，或交给显式校验函数——**不要用 `as` 压掉这一行**。
4. **以为 `void` 返回值会被检查。** 现象：`forEach(async ...)` 里 `await` 不起作用（本章实测：tsc 零错误 + Node 顺序错乱）。确认：搜 `.forEach(` 后跟 `async`。修：`for...of` + `await` 或 `Promise.all(list.map(...))`。
5. **元组做数组运算后类型退化。** 现象：`tuple.slice(1)` 变成 `(A | B)[]`，赋值报 `TS2322`（实测）。修：改用对象分字段，或解构后显式给剩余部分定类型。
6. **给 `let` 变量指望保留字面量类型。** 现象：`let role = "admin"` 之后赋 `"root"` 也通过。确认：hover 类型是 `string`（实测文案就是 `string`）。修：`let role: Role = "admin"`，或改 `const` + `as const`。
7. **`satisfies` 与注解混不清。** 现象：`keyof typeof x` 变成 `string`、补全丢失、配置表不能穷尽。确认：本章 `revealS1` / `revealS2` 对照自己跑一遍。修：需要「检查 + 保留」就换 `satisfies`；别忘 `as const` 才给字面量数组。

## 练习

<Exercise title="练习 1 · 预测四个变量的推断类型" difficulty="基础">

先预测每个的类型，再用「赋给 `never`」本机验证（禁用 `any`、`as`、`@ts-ignore`，`as const` 除外——它不是断言而是常量声明）：

```ts
let a = "admin";                     // 1
const b = "admin";                   // 2
const c = { mode: "fast" };          // 3
const d = { mode: "fast" } as const; // 4
```

<template #answer>

1 `string`（`let` 可变 → 宽类型，实测）；2 `"admin"`（`const` 定型，实测）；3 `{ mode: string }`；4 `{ readonly mode: "fast" }`（实测完整文案）。

**判断口诀：还能不能变。** 能变的给宽类型，不能变的给精确类型；「既精确又要修改」只能显式写联合类型。

</template>

</Exercise>

<Exercise title="练习 2 · 故意让 void 咬你一口" difficulty="进阶">

`tsc --strict --noEmit` 报几个错？运行时打印顺序是什么？

```ts
const ids = [1, 2, 3];
async function send(id: number) {
  await new Promise((r) => setTimeout(r, 10));
  console.log("sent", id);
}
ids.forEach(async (id) => {
  await send(id);
});
console.log("全部发完");
```

<template #answer>

**0 个错。** `forEach` 回调类型是 `(...) => void`，返回值黑洞吞掉 `async` 回调的 Promise（本章同形代码实测：退出码 0）。运行时先打印「全部发完」，之后才是三个 `sent`。

串行：`for (const id of ids) { await send(id); }`；并发等齐：`await Promise.all(ids.map(send))`。顺带：把 `Promise<number>` 赋给 `Promise<void>` 是真报错的（实测），黑洞只在函数返回类型这一层。

</template>

</Exercise>

<Exercise title="练习 3 · 用 unknown 修好一段读缓存的代码" difficulty="进阶">

改写下面这段，让它在数据形状不对时返回 `null` 且编译通过。禁止 `any`、`as`、`@ts-ignore`。

```ts
type Prefs = { theme: "light" | "dark"; fontSize: number };
function loadPrefs(): Prefs | null {
  const parsed = JSON.parse(localStorage.getItem("prefs") ?? "{}");
  return parsed;
}
```

<template #answer>

`JSON.parse` 返回 `any`，直接 `return` 就是把没验证过的对象当承诺交出去。逐项检查、不用断言（这份答案我在本机 `--strict` 跑过，零报错）：

```ts
function isPrefs(v: unknown): v is Prefs {
  if (typeof v !== "object" || v === null) return false;
  if (!("theme" in v) || (v.theme !== "light" && v.theme !== "dark")) return false;
  return "fontSize" in v && typeof v.fontSize === "number";
}

function loadPrefs(): Prefs | null {
  const raw = localStorage.getItem("prefs");
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isPrefs(parsed) ? parsed : null;
}
```

三个要点：`let parsed: unknown` 拦住 `any` 外流；`typeof v !== "object" || v === null` 两步都要（`typeof null === "object"`，本章探针实测）；属性存在性用 `in`——把 `object` 直接赋给 `Record<string, unknown>` 会撞 `TS2322`（下一章实测），`in` 收窄后才能取值。

</template>

</Exercise>

<Exercise title="练习 4 · satisfies 还是注解" difficulty="基础">

预测 `keyof typeof` 的结果，并说明哪个场景必须用 `satisfies`：

```ts
type Breakpoints = Record<string, number>;
const bp1: Breakpoints = { sm: 576, md: 768 };
const bp2 = { sm: 576, md: 768 } satisfies Breakpoints;
const roles = ["admin", "guest"] satisfies readonly string[];
```

<template #answer>

`keyof typeof bp1` 是 `string`（实测），所以 `bp1.lg` 这种不存在的键**检查不到**；`keyof typeof bp2` 是 `"sm" | "md"`（实测），`bp2.md` 仍是 `number` 且值类型照样被检查。`roles` 的类型是 `string[]`（实测）——`satisfies` 不会自动字面量化，要 `as const` 配合。

规则：**只想约束类型 → 注解；既要约束结构又要保留精确推断（配置表、主题表、路由表）→ `satisfies`。**

</template>

</Exercise>

<Exercise title="练习 5 · 给一段 JS 加类型并解释新报错" difficulty="挑战">

按三步流程给下面这个 JS 函数加类型，只允许标注签名和公共类型。然后回答：补完签名后**新出现的报错**是哪来的，为什么是好事。

```js
export function summarize(items, key) {
  return items.filter((it) => it.active).map((it) => it[key]).reduce((a, v) => a + v, 0);
}
```

<template #answer>

```ts
type Item = { active: boolean; name: string; count: number };

export function summarize(items: Item[], key: "count"): number {
  return items.filter((it) => it.active).map((it) => it[key]).reduce((a, v) => a + v, 0);
}
```

如果照字面把签名写成 `key: keyof Item`，会多出一条实测到的报错：`.scratch/ts-ch2-ex.ts(33,80): error TS2365: Operator '+' cannot be applied to types 'string | number | boolean' and 'string | number | boolean'.`——因为 `Item[keyof Item]` 是 `boolean | string | number`，`+` 对联合不合法。TS 在这里逼你把「只有数值字段能求和」写进类型（限定 `key: "count"`，或用[工具类型](/typescript/utility-types)把数值字段筛出来，正式写法见[泛型](/typescript/generics)）。另一条是签名缺失时 `it` 的隐式 `any`（本章实测：`--noImplicitAny false` 时整条链一个错都不报，拼错的属性名也放过去）。

**「新出现的报错」= 类型系统刚拿到信息、开始工作。** 迁移的正确指标不是「报错为零」，而是「报错都落在真正危险的边界上」。如果所有报错都被抹平而不是被理解，说明 `any` 又泄漏回来了。

</template>

</Exercise>

## 官方文档与延伸阅读

- [The Basics](https://www.typescriptlang.org/docs/handbook/2/basic-types.html) —— 核实 `unknown` / `any` / `never` 的官方定位与 `strict` 说明（对照本章实测的 `TS18046`、`TS2322`）。
- [Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) 的 [字面量类型](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types) 与 [`null` / `undefined`](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#null-and-undefined) —— 核实「`let` 宽类型 / `const` 字面量类型」与 `strictNullChecks` 的表述。
- [Object Types](https://www.typescriptlang.org/docs/handbook/2/objects.html) 的 [索引签名](https://www.typescriptlang.org/docs/handbook/2/objects.html#index-signatures) 与 [`readonly`](https://www.typescriptlang.org/docs/handbook/2/objects.html#the-readonly-modifier) —— 核实 `Record<string, number>` 为什么把 `keyof` 抹成 `string`、`readonly` 只是编译期约束。
- [Functions](https://www.typescriptlang.org/docs/handbook/2/functions.html) —— 核实 `void` 作为返回类型的特殊规则（本章实测的不对称方向）。
- [tsconfig 参考](https://www.typescriptlang.org/tsconfig/)：[`strict`](https://www.typescriptlang.org/tsconfig/#strict)、[`strictNullChecks`](https://www.typescriptlang.org/tsconfig/#strictNullChecks)、[`noImplicitAny`](https://www.typescriptlang.org/tsconfig/#noImplicitAny) —— 核实这些开关的默认值与相互关系。
- [Migrating from JavaScript](https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html) —— 本章三步流程的官方对应。
- [MDN `typeof` 运算符](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof) —— 核实探针表（`typeof null === "object"`、数组也是 `"object"`）。
- 说明：`satisfies` 的**引入版本我没有核对官方发行说明**，本章只保证本机 5.9.3 实跑可用，版本相关特性请查 [发行说明总览](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html)。

## 下一章

本章给了「单个值是什么类型」的全部基本件，并立了规矩：`unknown` 必须先证明再用、`any` 是放弃检查、注解只写在签名上。但真实数据几乎从不给你单一形状——接口可能成功可能失败、表单字段可能没填、配置可能是数组可能是对象。第 3 章 [联合类型与收窄](/typescript/unions-and-narrowing) 处理这个：**在同一个变量的几种可能形状之间，让 TS 在每个分支里知道是哪一种**。
