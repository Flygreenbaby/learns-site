# 联合类型与收窄：让 TS 在每个分支里知道是哪一种

`string | number` 不是「一种既像字符串又像数字的新类型」，它的意思是：**这个值在任一时刻是其中某一种，编译器不知道是哪一种**。所以联合类型上你只能用「每一种都有的成员」，想用某一种特有的成员，必须先给编译器一个证据，把它**收窄（narrowing）**到那一种。这是 TS 日常使用频率最高的技能，也是本站唯一被允许用来替代 `as` 的手段。

本章结论全部本机实跑：TypeScript 5.9.3 + Node v25.4.0，日期 2026-10-17，命令统一 `npx tsc --noEmit --strict --target es2022 --module esnext <文件>`，报错原样粘贴（含路径与行列号）。

## 为什么直接取成员会报错

```ts
function len(x: string | number) {
  return x.length;
}
```

```text
.scratch/ts-ch3-narrow.ts(3,12): error TS2339: Property 'length' does not exist on type 'string | number'.
  Property 'length' does not exist on type 'number'.
（退出码 2）
```

第二行缩进是读联合报错的关键：**它在告诉你哪个分支不满足**。联合的可用成员是各分支的**交集**，`number` 没有 `length`，所以整体不可用。三条出路：收窄（本章主体）、把操作交给每种都有的一致性写法、改类型定义（把联合拆早一点）。

## 收窄手段全景

| 手段 | 依据 | 注意 |
| --- | --- | --- |
| `typeof x === "..."` | 运行时 `typeof` | `null` 也是 `"object"`，数组也是 `"object"` |
| `"k" in x` | 属性存在性 | 需 `x` 是对象类型；判别字段可用 |
| `x instanceof C` | 原型链 | 擦除后仍在，但依赖真实构造函数 |
| `x.tag === "ready"` 判别联合 | 字面量字段 | 首选方案，配 `never` 穷尽 |
| `switch` + `never` | 穷尽检查 | 漏分支报错，见实测 |
| 真值收窄 `if (x)` | 真假 | `0`、`""`、`NaN` 会被误排除 |
| `Array.isArray(x)` | 运行时 | `unknown` 会收窄成 `any[]`，见实测 |
| `x is Foo` 类型谓词 | **你说了算** | 函数体写错也零报错，见实测 |
| `asserts x is Foo` | 你说了算 + 调用后生效 | 断言函数返回值是 `void` |
| `?.` / `??` | 空值 | 不是收窄，是绕过取值 |

下面每一条都是独立跑过的。

## `typeof` 守卫与它不处理的 `null`

```ts
type Doc = { title: string } | string | null;

function readDoc(d: Doc) {
  if (typeof d === "object") {
    const reveal: never = d; // 揭示收窄后的类型
    return d.title;
  }
  return d;
}
```

```text
.scratch/ts-ch3-narrow.ts(10,11): error TS2322: Type '{ title: string; } | null' is not assignable to type 'never'.
  Type 'null' is not assignable to type 'never'.
.scratch/ts-ch3-narrow.ts(11,12): error TS18047: 'd' is possibly 'null'.
```

**`typeof d === "object"` 之后 `null` 还在。** 第 2 章的运行时探针早就预告了这件事（`typeof null === "object"`）。标准写法是两步：`if (typeof d === "object" && d !== null)`。第 1 个分支只用于「揭露类型」的 `reveal` 那行是我一贯的手法：`never` 不接受任何值，所以报错文案里就写着编译器此刻认为它是什么。

## `in`、`instanceof`、`Array.isArray`

```ts
type A = { kindA: string };
type B = { kindB: number };
function byIn(v: A | B) {
  if ("kindA" in v) return v.kindA.toUpperCase();
  return v.kindB.toFixed(0);
}

function fmt(v: Date | string) {
  if (v instanceof Date) return v.getFullYear();
  return Date.parse(v);
}

function count(v: string[] | string) {
  if (Array.isArray(v)) return v.length;
  return v.split(",").length;
}
```

三个函数在 `--strict` 下**零报错**（两份文件退出码 0）。`Array.isArray` 有一个容易忽略的副作用——对 `unknown` 用时它收窄出来的是 `any[]`：

```ts
function arrReveal(v: unknown) {
  if (Array.isArray(v)) {
    const reveal: never = v;
    return reveal;
  }
  return 0;
}
```

```text
.scratch/ts-ch3-extra.ts(4,11): error TS2322: Type 'any[]' is not assignable to type 'never'.
```

元素类型是 `any`，于是数组里每个元素都失去保护（第 1 章的 `any` 泄漏）。正解是收窄完立刻逐项校验：`v.every((t: unknown) => typeof t === "string")`（这个写法我在下一章的校验器里跑过，零报错）。

## 判别联合与 `never` 穷尽检查

给每个分支加一个字面量「判别字段（discriminant）」，是处理「多种形状」最稳的办法：

```ts
type LoadState<T> =
  | { tag: "idle" }
  | { tag: "loading"; startedAt: number }
  | { tag: "error"; message: string; retriable: boolean }
  | { tag: "ready"; data: T };

function render(s: LoadState<string[]>): string {
  switch (s.tag) {
    case "idle":
      return "未开始";
    case "loading":
      return "加载中 " + s.startedAt;
    case "error":
      return s.retriable ? "可重试：" + s.message : "失败：" + s.message;
    case "ready":
      return s.data.join(",");
    default:
      return assertNever(s);
  }
}

function assertNever(x: never): never {
  throw new Error("未处理的分支: " + JSON.stringify(x));
}
```

整份文件退出码 0，`default` 里 `s` 确实是 `never`。真正的价值在**以后有人加一个状态时**：把 `case "ready"` 整段删掉重跑——

```text
.scratch/ts-ch3-missing.ts(17,26): error TS2345: Argument of type '{ tag: "ready"; data: string[]; }' is not assignable to parameter of type 'never'.
（退出码 2）
```

**这就是穷尽检查在替你上班**：新增分支忘了处理，编译直接失败，而不是线上少一块 UI。字段名用 `tag`、`kind`、`type` 都行，全项目统一一个即可；判别字段必须是**字面量类型**（第 2 章的 `"ready"` 而非 `string`），写成 `string` 就完全失效。

## 真值收窄：`0`、空字符串、`NaN` 会被误伤

`if (x)` 收窄掉的是「falsy」，而 `0` 和 `""` 是合法业务值：

```ts
function buildPayload(form: { age: number; nick: string }) {
  const out: Record<string, unknown> = {};
  if (form.age) out.age = form.age;
  if (form.nick) out.nick = form.nick;
  return out;
}
console.log("age=0, nick='' 的提交内容：", JSON.stringify(buildPayload({ age: 0, nick: "" })));
console.log("0 && '有数据' =>", 0 && "有数据");
console.log("NaN || '兜底' =>", NaN || "兜底");
```

Node v25.4.0 实测输出：

```text
age=0, nick='' 的提交内容： {}
0 && '有数据' => 0
NaN || '兜底' => 兜底
```

用户年龄真是 0 时字段被整个丢掉，而 TS 一句不说——**类型通过 ≠ 逻辑正确**（第 1 章主线）。判空要写清楚判的是什么：`if (form.age !== undefined)`、`if (form.nick !== "")`，数字兜底用 `Number.isNaN` / `Number.isFinite`。

## 自定义类型谓词：写了 `x is Foo` 就是你说了算

```ts
type Cat = { meow: () => string };
type Dog = { bark: () => string };

function isCat(x: Cat | Dog): x is Cat {
  return "bark" in x; // 逻辑写反了
}

function makeSound(x: Cat | Dog) {
  if (isCat(x)) return x.meow();
  return x.bark();
}

const cat: Cat = { meow: () => "喵" };
console.log("猫:", makeSound(cat));
```

<Callout type="verified" title="谓词写反：tsc 零错误，Node 当场崩">

`npx tsc --noEmit --strict --target es2022 --module esnext .scratch/ts-ch3-extra2.ts` → **退出码 0**。`node` 执行：

```text
TypeError: x.bark is not a function
    at makeSound (file:///D:/work/learns/.scratch/out10/ts-ch3-extra2.js:13:14)
```

把实现改成 `return "meow" in x;` 之后，编译仍然零错误——**编译器只检查「声明的形状」，从不检查谓词函数体的逻辑是否真的能证明它**。
</Callout>

所以谓词是**你自己签发的证书**：签名越有说服力，越需要人工与测试兜底。三条规矩：谓词参数是 `unknown` 或联合、函数体只做「运行时能证实」的判断（`typeof` / `in` / `Array.isArray` / 字面量比较）、给谓词配一组正反用例跑一次。改成 `"meow" in x` 的正确版本我也跑了，退出码 0。

## `asserts` 断言函数：把收窄前置到调用点

```ts
function assertString(v: unknown): asserts v is string {
  if (typeof v !== "string") throw new Error("不是字符串");
}

function useAssert(v: unknown) {
  assertString(v);
  return v.trim(); // 零报错：调用之后 v 已经是 string
}

function useAssertBad(v: unknown) {
  assertString(v);
  const reveal: never = v; // 断言后应为 string，这行必须报错
  return reveal;
}
```

```text
.scratch/ts-ch3-discriminate.ts(46,9): error TS2322: Type 'string' is not assignable to type 'never'.
（该文件只有这一条报错——第 42 行 `v.trim()` 是零错误的，证明断言确实生效了）
```

`asserts v is string` 与 `v is string` 的区别在使用方式：谓词返回布尔、用在 `if` 里；断言函数返回 `void`、调用完当前作用域就收窄，`if (!cond) throw` 的写法天然适合它。同一份文件里我还验证了断言函数与闭包无关的收窄规则（下一节）。

## `as` 与收窄的区别

`as` 是**你告诉编译器答案**，收窄是**你证明给编译器看**。区别在第 1 章场景 5 的实跑里：`as` 版本编译零错误、Node 里 `TypeError: Cannot read properties of undefined`；本章的判别联合版本，字段错了改不了、分支漏了编译不过。什么时候允许 `as`（边界处配合校验、单一位置收口）见[真实项目中的取舍](/typescript/tradeoffs)；本站练习里 `as` 与 `@ts-ignore` 一并禁用。

## `Result<T, E>`：把失败也做成一个分支

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

function parsePort(raw: unknown): Result<number, string> {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return { ok: false, error: "端口必须是整数" };
  }
  return { ok: true, value: raw };
}

function sloppy(r: Result<number, string>) {
  return r.value; // 忘了判 ok
}
```

```text
.scratch/ts-ch3-result.ts(18,12): error TS2339: Property 'value' does not exist on type 'Result<number, string>'.
  Property 'value' does not exist on type '{ ok: false; error: string; }'.
（退出码 2）
```

`ok` 是判别字段，所以必须先判再取值——**「忘记处理失败」从线上事故变成编译错误**。这是判别联合最有价值的用法，错误对象的形状、与 `throw` 的取舍、以及 `Result` 与 `try/catch` 的边界见[错误处理与 DevTools 调试](/javascript/errors-and-debugging)（后端侧的写法见 [后端错误处理](/backend/error-handling)）。

## 控制流分析的边界：闭包里收窄会丢

先说一个反直觉的实测结果：**只要变量不会再被赋值，闭包里的收窄是保住的。** `if (name !== undefined) { const later = () => name.toUpperCase(); }` 这种写法（`name` 是未被重新赋值的参数）在 5.9.3 下退出码 0。会丢的是这两种：

```ts
// A：let 变量判空之后又被重新赋值
function reassign(name?: string) {
  let v = name;
  if (v !== undefined) {
    const later = () => v.toUpperCase();
    v = "重置";
    return later();
  }
  return "";
}

// B：对象属性的收窄在回调里丢失
type Holder = { fn?: () => string };
function callHeld(h: Holder) {
  if (h.fn) {
    return [1, 2].map((n) => h.fn().length + n);
  }
  return [];
}
```

```text
.scratch/ts-ch3-closure2.ts(5,25): error TS18048: 'v' is possibly 'undefined'.
.scratch/ts-ch3-closure2.ts(16,30): error TS2722: Cannot invoke an object which is possibly 'undefined'.
（退出码 2）
```

原因：收窄是「按位置（位置 = 变量 + 程序点）」的假设，而闭包延后执行、期间变量可能被改；对象属性同理（回调之间别人能改 `h.fn`）。**修法统一是快照到常量**：`const fn = h.fn; if (fn) { ... map(() => fn().length) }`——这个版本我跑过，零报错。局部变量判空后立刻 `const` 也是同一个道理。

## `?.` 与 `??`：取值语法，不是收窄

```ts
type Addr = { city?: string };
type Usr = { address?: Addr };
function cityOf(u: Usr | null) {
  return u?.address?.city ?? "未知"; // 零报错
}
```

`?.` 短路 `null`/`undefined`（`0`、`""` 照常通过），`??` 只在**左侧可空**时才取右侧。所以拿它当真值判断的替代品会出错，而滥用也会被编译器抓：写 `const dItem = 0 ?? "兜底";` 得到

```text
.scratch/ts-ch3-extra.ts(25,15): error TS2869: Right operand of ?? is unreachable because the left operand is never nullish.
```

实测的运行时差异（Node v25.4.0）：`null ?? '兜底' => 兜底`，而 `NaN || '兜底' => 兜底`、`0 && '有数据' => 0`（上一节）。要「空字符串也兜底」就不能只靠 `??`。

## 把联合写成数组常量：单一事实来源

`type Role = "admin" | "editor" | "guest"` 手写的联合，字段名重复、加一个值要改三处。让数组当唯一来源：

```ts
const ROLES = ["admin", "editor", "guest"] as const;
type Role = (typeof ROLES)[number];

function viaIncludes(s: string) {
  return ROLES.includes(s); // 期望报错
}

const LABELS: Record<Role, string> = {
  admin: "管理员",
  guest: "访客",
};
```

```text
.scratch/ts-ch3-result.ts(31,25): error TS2345: Argument of type 'string' is not assignable to parameter of type '"admin" | "editor" | "guest"'.
.scratch/ts-ch3-result.ts(35,7): error TS2741: Property 'editor' is missing in type '{ admin: string; guest: string; }' but required in type 'Record<"admin" | "editor" | "guest", string>'.
（退出码 2）
```

两条报错正是这个写法的价值：`includes` 不接受宽 `string`（所以别用它当类型守卫，要守卫就写谓词 `function checkRole(s: string): s is Role`，本章实测可用），`Record<Role, X>` 把「漏一个角色」变成 `TS2741`——**穷尽检查的另一半在类型层**，跟 `switch` 的 `never` 是一对。少了 `as const` 整件事都不成立（第 2 章实测：`["admin","guest"] satisfies readonly string[]` 的类型是 `string[]`）。

## `unknown` → 运行时校验 → 收窄：完整链路

外部数据的标准处理链路，也是本站唯一推荐的「边界处定型」做法：

```ts
type User = { id: number; name: string; tags: string[] };

function isUser(v: unknown): v is User {
  if (typeof v !== "object" || v === null) return false;
  if (!("id" in v) || typeof v.id !== "number") return false;
  if (!("name" in v) || typeof v.name !== "string") return false;
  if (!("tags" in v) || !Array.isArray(v.tags)) return false;
  return v.tags.every((t: unknown) => typeof t === "string");
}

function render(raw: unknown): string {
  if (!isUser(raw)) throw new Error("数据不符合 User 结构: " + JSON.stringify(raw));
  return raw.name.toUpperCase() + " " + raw.tags.join("/");
}
```

<Callout type="verified" title="校验器骨架：编译零错误，六种输入的真实结果">

```text
$ npx tsc --noEmit --strict --target es2022 --module esnext .scratch/ts-ch3-validator.ts
（无任何输出，退出码 0）

$ node .scratch/out5/ts-ch3-validator.js
正常: 丽 a/b
id 是字符串: false
缺 tags: false
数组: false
null: false
抛错: 数据不符合 User 结构: {"id":1}
```

两个细节必须这样写。第一，`typeof v !== "object" || v === null` 两步都要（本章第一节实测过 `typeof null === "object"`）。第二，属性存在性只能用 `in`：我一开始写 `const o: Record<string, unknown> = v;` 然后逐条查 `o.id`，撞到的是这条报错——

```text
.scratch/ts-ch3-result.ts(45,9): error TS2322: Type 'object' is not assignable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type '{}'.
```

**`typeof` 收窄出来的 `object` 不带索引签名**，所以「拿 object 当字典读」这条路编译就不通，只能 `in` 收窄（或给类型定义显式写索引签名，见第 4 章）。这套校验器与取舍的边界（性能、重复字段、要不要上校验库）在[真实项目中的取舍](/typescript/tradeoffs)展开。
</Callout>

## 常见错误与排查

1. **对联合直接取成员。** 现象：`TS2339: Property 'x' does not exist on type 'A | B'.`（实测）。原因：联合可用成员是交集。修：收窄，或把公共字段提到各分支都有。
2. **`typeof x === "object"` 就当成对象用。** 现象：`TS18047: 'x' is possibly 'null'.`（实测）。修：补 `x !== null`。
3. **判别字段写成 `string`。** 现象：`switch` 不再收窄、漏分支不报错。原因：只有字面量类型能当判别字段。修：`tag: "ready"` 这种字面量，或 `as const` 派生。
4. **用真值判断代替判空。** 现象：`age=0` 的用户提交时字段消失（实测输出 `{}`）。修：显式 `!== undefined` / `!== null` / `!== ""`。
5. **类型谓词的函数体不成立。** 现象：编译零错误、运行时 `TypeError: x.bark is not a function`（实测）。确认：给谓词写正反用例各跑一次。修：`in` / `typeof` 的判定要覆盖所有分支。
6. **指望闭包记住收窄。** 现象：`TS18048` / `TS2722`（实测）。修：快照到 `const`（本章实测零报错），或把可空调用改成显式守卫。
7. **`Array.isArray` 之后当元素是定型过的。** 现象：`unknown` 收窄成 `any[]`（实测），元素全是 `any`。修：立刻 `every` 逐项校验或走上面的校验器。
8. **用 `as` 代替收窄。** 现象：编译干净、运行时崩（第 1 章实测）。修：判别联合 + `never` 穷尽，边界处写校验器。

## 练习

<Exercise title="练习 1 · 用判别联合重写下拉状态" difficulty="进阶">

下面这段用三个布尔 + 一个可空数组表示「下拉框状态」，请把 `loading` 与 `error` 同时为真这种不可能的状态从类型里删掉，改用判别联合，并让 `render` 用 `switch` 处理：

```ts
type Dropdown = {
  loading: boolean;
  error: string | null;
  items: string[] | null;
};

function render(d: Dropdown): string {
  if (d.loading) return "加载中";
  if (d.error) return "错误：" + d.error;
  return (d.items ?? []).join(",");
}
```

<template #answer>

```ts
type Dropdown =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "ready"; items: string[] };

function render(d: Dropdown): string {
  switch (d.tag) {
    case "idle":
      return "请选择";
    case "loading":
      return "加载中";
    case "error":
      return "错误：" + d.message;
    case "ready":
      return d.items.join(",");
  }
}
```

三个收益：`loading` 与 `error` 同时为真**在类型里就表达不出来**；`ready` 分支的 `items` 是 `string[]` 而不是 `string[] | null`，`join` 不用判空（原写法 `(d.items ?? [])` 就是在补偿类型没表达清楚）；`render` 的返回类型由 `switch` 穷尽保证——判别字段写全时这个 `switch` 每个分支都有返回值，函数不需要 `default` 也不会报「缺少返回」。这正是本章 `LoadState` 实测的同构写法。

</template>

</Exercise>

<Exercise title="练习 2 · 给上一题加穷尽检查" difficulty="进阶">

给练习 1 加一种新状态 `{ tag: "retrying"; attempt: number }`，先只改类型不改 `switch`，然后跑一次 `tsc --strict --noEmit`。写下你预期的报错，再对照本章实测文案。

<template #answer>

预期与本章实测同构：把已处理的 `case` 删掉时报的是

```text
error TS2345: Argument of type '{ tag: "ready"; data: string[]; }' is not assignable to parameter of type 'never'.
```

也就是说，只有当你**已经配了 `default: return assertNever(d)`** 时才会得到这条清晰的报错。如果 `switch` 没有 `default` 而函数又声明了返回类型，你拿到的是「返回值可能是 `undefined`」一族报错（具体文案取决于 `strictNullChecks`，我没逐条跑，请本机验证）。**结论：穷尽检查要主动配——`default` 里调 `assertNever` 是本站的标准写法**，它把「新增状态忘了处理」变成编译失败。补上 `case "retrying": return "重试中（第 " + d.attempt + " 次）";` 后报错消失。

</template>

</Exercise>

<Exercise title="练习 3 · 揪出被真值收窄藏起来的 bug" difficulty="基础">

`--strict` 下零报错，但有一个业务 bug。说出它是什么，并改写。

```ts
type Form = { age: number; nick: string; agree: boolean };

function toQuery(f: Form): string {
  const parts: string[] = [];
  if (f.age) parts.push("age=" + f.age);
  if (f.nick) parts.push("nick=" + f.nick);
  if (f.agree) parts.push("agree=1");
  return parts.join("&");
}
```

<template #answer>

`age` 为 `0` 时字段整个消失（本章实测：`buildPayload({ age: 0, nick: "" })` 打印 `{}`）——`0` 是合法年龄，`if (f.age)` 把它当「没有」。`nick` 为空串同理（要不要提交空昵称是业务决定，但至少要有意识地写）。改法：数字与字符串用「有没有值」的显式判断，只有布尔量可以走真值：

```ts
function toQuery(f: Form): string {
  const parts: string[] = ["age=" + f.age, "nick=" + f.nick];
  if (f.agree) parts.push("agree=1");
  return parts.join("&");
}
```

若字段是可选的（`age?: number`），写 `if (f.age !== undefined)`。这题的重点：**类型通过 ≠ 逻辑正确**，收窄只保证形状，不保证你的判断符合业务。

</template>

</Exercise>

<Exercise title="练习 4 · 写一个能过编译、也能过测试的谓词" difficulty="挑战">

为 `type Money = { cents: number; currency: "CNY" | "USD" }` 写一个 `isMoney(v: unknown): v is Money`，然后自己构造四个反例（至少一个 `null`、一个数组、一个 `cents` 是字符串的、一个 `currency` 是 `"EUR"` 的）验证它返回 `false`。禁止 `any`、`as`、`@ts-ignore`。

<template #answer>

```ts
type Money = { cents: number; currency: "CNY" | "USD" };

function isMoney(v: unknown): v is Money {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  if (!("cents" in v) || typeof v.cents !== "number") return false;
  if (!("currency" in v)) return false;
  return v.currency === "CNY" || v.currency === "USD";
}
```

四个反例都得是 `false`：`null`（第一步拦掉）、`[]`（`typeof [] === "object"`，必须显式 `Array.isArray`，本章实测 `typeof` 探针里就有这一条）、`{ cents: "12", currency: "CNY" }`（`typeof v.cents` 拦住）、`{ cents: 12, currency: "EUR" }`（字面量比较拦住）。两个易错点：一是漏 `Array.isArray`，数组会被当对象放过；二是最后一步写成 `typeof v.currency === "string"`——那样 `"EUR"` 也会通过，**谓词的强度取决于你写到多细**。因为编译器不检查函数体（本章实测的 `isCat` 反例），这类谓词必须靠反例测试兜住。生产环境里字段一多就该上校验库，边界与代价见[真实项目中的取舍](/typescript/tradeoffs)。

</template>

</Exercise>

<Exercise title="练习 5 · 故意破坏：让闭包吃掉你的收窄" difficulty="基础">

下面代码在本机是零报错还是报错？把 `if (fn)` 改成 `if (h.fn)` 之后呢？解释差别。

```ts
type Holder = { fn?: () => string };

function callHeld(h: Holder) {
  const fn = h.fn;
  if (fn) {
    return [1, 2].map((n) => fn().length + n);
  }
  return [];
}
```

<template #answer>

现在这份**零报错**（本章实测：把 `const fn = h.fn` 这行删掉的版本才有报错）。改成直接用 `h.fn` 后，回调里得到本章实测的那条：

```text
error TS2722: Cannot invoke an object which is possibly 'undefined'.
```

原因：`if (h.fn)` 的收窄只对「这个属性、这个程序点」成立，回调是稍后才执行，中间谁都可能有往 `h` 上写 `fn: undefined`；而 `const fn` 是不可变的局部量，收窄不会丢。同类陷阱是 `let` 变量在闭包前又被重新赋值，实测报错是 `TS18048: 'v' is possibly 'undefined'.`。**遇到这两条码，先想「快照到 const」，再想加断言。**

</template>

</Exercise>

## 官方文档与延伸阅读

- [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) —— 逐节核实 [`typeof` 守卫](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#the-typeof-type-guard)、[`instanceof` 收窄](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#the-instanceof-operator)、[`in` 收窄](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#the-in-operator-narrowing)、[判别联合](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)、[类型谓词](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#type-predicates)、[`assert` 函数](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#assert-function) 与 [控制流分析](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#control-flow-analysis)（对照本章实测的 `TS2339`、`TS2345`、`TS18048`、`TS2722`）。
- [Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) 的 [联合类型](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types) —— 核实「联合只能取交集成员」的官方表述。
- [Functions](https://www.typescriptlang.org/docs/handbook/2/functions.html) —— 核实返回 `never` / `void` 与断言函数的签名写法。
- [Creating Types from Generics](https://www.typescriptlang.org/docs/handbook/2/creating-types-from-generics.html) —— 核实 `(typeof ROLES)[number]` 这类索引访问类型的官方定位。
- [MDN `Array.isArray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/isArray) 与 [MDN 空值合并运算符](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing) —— 核实本章实测的运行时行为（数组是 `object`、`??` 只对 `null`/`undefined` 生效）。
- 版本提示：本章用到的报错码（`TS18047`、`TS18048`、`TS2722`、`TS2869`）与断言函数语法都来自本机 5.9.3 的输出；TS 的错误码与文案会随版本变化，核对时以 [发行说明总览](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html) 为准。类型谓词「编译器不检查函数体」这条属于本章实跑结论，官方页面若有出入请留言纠正。

## 下一章

到这里，「一个值可能是几种形状」这件事已经不用 `as` 了：形状靠判别联合表达、分支靠 `never` 穷尽、外部数据靠运行时校验器收窄。下一章 [对象类型与接口](/typescript/objects-and-interfaces) 回到最常见的场景——**给后端返回的 JSON 建模型**：`interface` 与 `type` 怎么选、可选属性和索引签名、交叉类型、结构兼容性（第 1 章那条规则的完整展开），以及那个所有人都撞过的「多余属性检查」。
