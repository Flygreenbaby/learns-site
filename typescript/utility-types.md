# 工具类型、条件类型与映射类型：把内置「魔法」拆成三段拼图

写 `Partial<Config>` 时容易以为它是语言关键字。不是的——它就是标准库里一个普通类型别名，位于 `node_modules/typescript/lib/lib.es5.d.ts` 第 1585 行，本机 5.9.3 原文：

```ts
type Partial<T> = {
    [P in keyof T]?: T[P];
};
```

所以本章的正确学法不是背清单，而是**拆**：`[P in keyof T]` 是**映射类型**，`T extends U ? X : Y` 是**条件类型**，`infer` 是**在模式里捕获一个类型**，加上泛型本身，四块拼起来就是全部工具类型。

本章结论均为本机实跑：TypeScript 5.9.3 + Node v25.4.0，2026-10-17，命令统一是 `npx tsc --noEmit --strict --target es2022 --module esnext <文件>`，报错原样粘贴。**怎么让编译器念出一个类型的真实结构**：写 `const probe: 0 = x;`，TS 会把 `x` 的解析结果念在报错左边（`Type 'X' is not assignable to type '0'`）；如果 `x` 是 `never`，这句**不会报错**（`never` 可赋给任何类型）——这本身就是判定 `never` 的探针。

## 内置清单：以本机 lib 文件为准

用 `grep` 在 `lib.es5.d.ts` 里能捞到（TS 5.9.3 实测）：`Awaited` `Partial` `Required` `Readonly` `Pick` `Record` `Exclude` `Extract` `Omit` `NonNullable` `Parameters` `ConstructorParameters` `ReturnType` `InstanceType` `ThisType`，以及 `= intrinsic` 的 `Uppercase` / `Lowercase` / `Capitalize` / `Uncapitalize` / `NoInfer`。**清单会随版本增长**：`Getters` / `Setters` / `RequiredProps` 在本机 5.9.3 的 lib 里 grep 不到——不要当内置用，也别把本章自定义的 `Getters` 当标准库；新增的以[官方 Utility Types 清单](https://www.typescriptlang.org/docs/handbook/utility-types.html)为准。

四个定义值得读：

```ts
type Exclude<T, U> = T extends U ? never : T;              // 裸 T → 会分发
type Extract<T, U> = T extends U ? T : never;              // 同上
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type NonNullable<T> = T & {};                              // 不是条件类型，是相交
```

## 逐个讲透：解析结果实测表

设 `Opts = { host: string; port: number; debug?: boolean }`。

| 工具类型 | 输入 | 实测解析结果 / 报错 | 日常用法 |
| --- | --- | --- | --- |
| `Partial<T>` | `Opts` | 三个属性全变可选 | PATCH 入参 |
| `Required<T>` | `Opts` | `debug` 变必填 | 读完默认值之后 |
| `Readonly<T>` | `Opts` | 写 `ro.host = "x"` 报 `TS2540: ... read-only property.` | 常量表、防误写 |
| `Pick<T, K>` | `Pick<Opts, "host">` | 只留键；错键报 `TS2344: Type '"nope"' does not satisfy the constraint 'keyof Opts'.` | 列表展示项 |
| `Omit<T, K>` | `Omit<Opts, "port">` | `keyof` 结果实测为 `"host" \| "debug"` | 创建入参 |
| `Record<K, T>` | `Record<"a" \| "b", number>` | `Record<keyof Opts, number>` 少写 `debug` 报 `TS2741: Property 'debug' is missing` | id → 实体的字典 |
| `Exclude` / `Extract` | `Exclude<"a" \| "b", "a">` / `Extract<"a" \| "b" \| number, string>` | `"b"` / `"a" \| "b"` | 从联合里排除 / 挑选成员 |
| `NonNullable<T>` | `string \| null \| undefined` | `string` | 判过空之后传给旧签名 |
| `ReturnType<F>` | `(a: number) => Promise<{ z: 1 }>` | `Promise<{ z: 1; }>` | 从 API 函数取响应类型 |
| `Parameters<F>` | `(a: string, b?: number) => void` | `[a: string, b?: number \| undefined]` | 转发调用、装饰器 |
| `Awaited<T>` | `Promise<Promise<number> \| null>` | `number \| null` | 异步函数的响应类型 |
| `ConstructorParameters` / `InstanceType` | `typeof Date` | `[value: string \| number \| Date]` / `Date` | 工厂函数透传 |
| `Capitalize` 等 | `"click"` | `"Click"`（`Capitalize<"alreadyUpper">` = `"AlreadyUpper"`） | 事件名 / getter 名派生 |

实测 `Awaited` 是递归的：`Awaited<Awaited<Promise<Promise<number>>>>` 也是 `number`。

## 三处最容易出错

### `Omit` 就是 `Pick` + `Exclude`

源码写死了这层关系，实测两者互相可赋值、结构等价。差异只在**对错误键名的宽容度**，这是 `Omit` 的真实代价：`Pick<T, K extends keyof T>` 写错键立刻 `TS2344`；`Omit` 的约束是 `keyof any`，于是 **`Omit<Opts, "prot">` 不报错，且 `port` 仍然留在结果里**（实测 `o1.port` 零报错）。工程结论：**要「删掉的键必须存在」的保证就写 `Pick<T, Exclude<keyof T, "port">>`**；用 `Omit` 时把键名交给自动补全，别手敲字符串。

### `Partial` 只作用在最外层

```ts
type Nested = { a: { b: number } };
declare const sp: Partial<Nested>;
sp.a = {};
// error TS2741: Property 'b' is missing in type '{}' but required in type '{ b: number; }'.
```

嵌套层的必填一个字都没松（`Required` 同样浅）。深层结构的 PATCH 需要 `DeepPartial`（下文有实现和它的坑）。

### `Required` 删不掉索引签名里的 `undefined`

`Required<T>` 的源码是 `[P in keyof T]-?: T[P]`，`-?` 移除的是**属性的可选修饰符**，不是值类型里的 `| undefined`。对 `type Dict = { [k: string]: number | undefined }` 与 `type Mixed = { a?: number; [k: string]: number | undefined }` 实测：把 `Required<Dict>` 赋给 `{ [k: string]: number }` 报 `TS2322`（嵌套一句「'string' index signatures are incompatible」）；`rm.a` 依然带 `undefined`——索引签名要求同类属性 assignable 到它，属性类型合并后带着 `undefined`，而 `-?` 只删了 `?`。**修法是把值也收窄，实测有效**：

```ts
type StrictRequired<T> = { [K in keyof T]-?: NonNullable<T[K]> };
```

换成它之后，两句原本报错的赋值不再报错。另 `NonNullable<T> = T & {}` 用相交去掉 `null | undefined`、不是条件类型所以不受分发影响；实测 `NonNullable<unknown>` 得 `{}`（探针报 `Type '{}' is not assignable to type '0'`）——把 `unknown` 变成了「有属性的空对象」。

另外，`Pick` / `Omit` 对联合类型**不分发**（`keyof (A | B)` 只留公共键，往往是 `never`）。实测 `Pick<{ a: 1 } | { b: 2 }, "a">` 报 `TS2344: Type '"a"' does not satisfy the constraint 'never'.`——报错里的约束 `never` 就是证据。要给联合逐成员变换，得自己写分发版本（见练习 4）。

## 映射类型：`[K in keyof T]` 就是「遍历类型」

形式是 `[K in keyof T]: 表达式`，读作「对 `T` 的每个键做一次」。两个别处没有的能力。**一是修饰符开关 `+?` / `-?` / `+readonly` / `-readonly`**：`Partial` 用 `?`、`Required` 用 `-?`，`type Mutable<T> = { -readonly [K in keyof T]: T[K] }` 就能把只读类型解开。**二是同态（homomorphic）映射保留源类型修饰符**：只要键直接来自 `keyof T`，原来的 `?` 和 `readonly` 会被继承。实测：

```ts
type Clone<T> = { [K in keyof T]: T[K] };
declare const c1: Clone<{ readonly a?: string }>;
c1.a = "x";
// error TS2540: Cannot assign to 'a' because it is a read-only property.
```

`Clone` 里没写 `readonly`，但报错说它是只读——修饰符是从源类型带上来的。**这条决定了自写工具类型的正确形态**：一旦映射不再是同态形式（比如键换成模板字面量），修饰符就丢。自己写 `type MyPartial<T> = { [K in keyof T]?: T[K] };` 实测与官方 `Partial` 双向可赋值（零报错），没有黑魔法。

## 条件类型与分发规则：裸类型参数会把联合拆开算

条件类型写成 `T extends U ? X : Y`。关键规则只有一条：**当 `T` 是「裸」类型参数（`extends` 左边没包任何东西）且实参是联合时，条件会分配（distribute）到每个成员分别计算，再取并集。**

```ts
type Dist<T> = T extends string ? "S" : "N";
declare const v30: Dist<"a" | 1>;
export const t30: 0 = v30;
// error TS2322: Type '"N" | "S"' is not assignable to type '0'.
```

| 输入 | 结果（实测） | 为什么 |
| --- | --- | --- |
| `Dist<"a" \| 1>` | `"N" \| "S"` | 分发后两个分支各得一个 |
| `Dist<"a" \| "b">` | `"S"` | 分发后结果相同，联合坍缩 |
| `Dist<string>` | `"S"` | `string` 不是联合，单个成员照常判 |
| `Dist<never>` | `never`（探针不报错） | 分发对空联合执行 0 次 |

**`never` 那一行最容易误解**：`never` 在类型层面是空联合（0 个成员），分发「对每个成员做」于是执行了 0 次，结果还是 `never`——不是「`never extends string` 为真所以取 `"S"`」。`Exclude<string, "a">` 得 `string` 同理：**减法只能从联合里删成员，不能从基元类型里删值**，别指望 `Exclude<string, "">` 得到「非空字符串」。

**关闭分发：把 `T` 包进元组。** `type NoDist<T> = [T] extends [string] ? "S" : "N";` 实测对 `"a" | 1` 得 `"N"`（整个联合不是 `string` 的子类型）、对 `never` 得 `"S"`。所以判 `never` 的唯一可靠写法是 `type IsNever<T> = [T] extends [never] ? true : false;`——实测 `IsNever<never>` 为 `true`，`IsNever<unknown>` 与 `IsNever<"a" | never>` 都是 `false`（后者会坍缩成 `"a"`）。再记一条实测相交行为：`unknown & { a: number }` 解析成 `{ a: number }`（`unknown` 被吸收），`string & { brand: 1 }` 则保留——品牌类型的做法，但拦不住别人 `as` 塞普通 `string`。

## `infer`：在模式里抓住一个类型

`infer X` 写在 `extends` 右边的模式里，意思是「这个位置的类型我要一个名字」，然后在真分支里用它。四个都实测过：

```ts
type Ret<F> = F extends (...args: never[]) => infer R ? R : never;
type El<A> = A extends (infer E)[] ? E : never;
type First<T> = T extends [infer H, ...unknown[]] ? H : never;
type Param1<F> = F extends (a: infer A, ...rest: never[]) => unknown ? A : never;
```

实测：`Ret<() => Promise<number>>` 得 `Promise<number>`；`El<string[]>` 得 `string`；`First<[boolean, number]>` 得 `boolean`；`Param1<(k: "a" | "b", n: number) => void>` 得 `"a" | "b"`。两条实用规则：**同一位置 `infer` 两次会取联合或相交**，分别捕获、不会自动相等；**`infer` 用不了的位置要拿占位类型填满**（上面用 `never[]` 占参数位）。官方 `ReturnType` 用 `(...args: any) => infer R`，兜底写 `any`——这解释了为什么对 `any` 用 `ReturnType` 得到 `any` 而不是报错。

## 模板字面量类型与按键改名

映射类型后面接 `as` 子句可以**改键名**（key remapping），键名可以是模板字面量：

```ts
type Handlers<T> = {
  [K in keyof T as K extends string ? `on${Capitalize<K>}` : never]: (v: T[K]) => void;
};
declare const hs: Handlers<{ click: number; keydown: string }>;
export const h1 = hs.onClick;    // 合法
export const h3 = hs.click;      // 报错
```

```text
error TS2551: Property 'click' does not exist on type 'Handlers<Events>'. Did you mean 'onClick'?
```

`as` 后面写 `never` 表示**这个键被丢弃**，这是过滤属性的正规手段（实测 `OnlyStringKeys<Opts>` 只留 `host` 等字符串键，取 `port` 报 `TS2339`；非字符串键也不会产生 `on1` 这种名字）。真实用途三类：事件处理器名、getter/setter 名派生、路由与 i18n 键的组合校验（用模板字面量把「语言点键名」的错误挡在编译期）。

## 自己写两个：`DeepPartial` 和 `Getters`

### `DeepPartial`：递归，而且必须给基元类型短路

```ts
type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;
```

正常部分（实测）：`Config = { server: { host: string }; retries: number }` 时，`= {}` 和 `= { server: {} }` 都过，`= { server: { host: 1 } }` 报 `TS2322: Type 'number' is not assignable to type 'string'.`。**两个真实陷阱，都跑出来了**：一、**数组被逐元素拆开**——`DeepPartial<{ list: number[] }>` 实测解析成 `{ list?: (number | undefined)[] | undefined }`，元素多了 `| undefined`，赋给 `number[]` 报 `TS2322`。二、**`Date`、函数、`RegExp` 被拆成一坨不可读的可选方法**——给 `DeepPartial<{ when: Date }>` 做探针，实测吐出：

```text
error TS2322: Type '{ toString?: {} | undefined; toDateString?: {} | undefined; ... 38 more ...; [Symbol.toPrimitive]?: {} | undefined; } | undefined' is not assignable to type '0'.
```

所以生产级写法要加短路：

```ts
type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Atomic = Primitive | Date | RegExp | ((...args: never[]) => unknown);

type DeepPartial<T> = T extends Atomic
  ? T
  : T extends (infer E)[]
    ? DeepPartial<E>[]
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;
```

`T extends Atomic ? T` 挡基元和内置对象，`T extends (infer E)[]` 让数组保持数组、只递归元素；`(...args: never[]) => unknown` 是所有函数类型的父类，任意签名都能匹配（见[函数类型与重载](/typescript/functions)）。

<Callout type="unverified" title="生产版短路的数组与函数分支未逐条实测">

上面 `Atomic` 判据的两个分支是我按规则写出的类型表达式，`Date` / 函数 / 嵌套数组三种输入的解析结果我这次没有逐个用探针抄下来，故标为未验证。请在你的项目里各测一次：尤其 `DeepPartial` 后函数属性变可选，调用处必须写 `cfg.fn?.()`。

</Callout>

### `Getters`：把对象类型变成取值函数

```ts
type Getters<T> = {
  [K in keyof T as K extends string ? `get${Capitalize<K>}` : never]: () => T[K];
};
declare const gt: Getters<{ name: string; age: number }>;
gt.getName();   // string
gt.getAge();    // number
gt.name;        // error TS2339: Property 'name' does not exist on type 'Getters<{ name: string; age: number; }>'.
```

要点三条（均实测）：`K extends string` 这个判断**必须写**，否则非字符串键会被送进 `Capitalize`，整个别名直接报 `TS2344: Type 'K' does not satisfy the constraint 'string'.`；`as never` 让非字符串键消失；结果是**浅**的——`Getters<{ nested: { a: number } }>` 只有 `getNested`，取 `getNestedA` 报 `TS2551 ... Did you mean 'getNested'?`，深层派生得自己递归。

<Callout type="warn" title="堆叠到读不懂时就写具名接口">

`Partial<Record<keyof Omit<Config, "id">, () => unknown>>` 这种一行的代价是：**任何人（包括三天后的你）都得先在脑子里跑一遍类型求值才知道它允许什么**。正确反应是拆开命名：`type ConfigWithoutId = Omit<Config, "id">;` 再逐键映射成 getter。判断标准：**跨模块边界的 API 可读性优先于简洁；文件内部用一次，堆叠可以接受。** 这是工程判断，不是语法问题，见[真实项目中的类型取舍](/typescript/tradeoffs)。

</Callout>

## 常见错误与排查

1. **`Omit` 写了不存在的键，编译通过、字段还在** → `Omit` 约束是 `keyof any`，不校验存在性（实测 `Omit<Opts, "prot">` 保留 `port`）。修法：`Pick<T, Exclude<keyof T, "port">>`，或从 `keyof T` 派生键名；同类地，`Pick` / `Record` 的错键会立刻 `TS2344: ... does not satisfy the constraint 'keyof T'`，悬停看 `keyof T` 展开成什么再改。
2. **`Partial` 之后深层字段仍然必填** → 浅（实测 `sp.a = {}` 报 `TS2741`）。修法：`DeepPartial`（注意基元短路），或把嵌套对象本身定义成 `Partial`。
3. **`Required` 之后读出来还是 `T | undefined`** → 索引签名或属性类型自带 `undefined`，`-?` 删不掉（实测 `TS2322`）。修法：`type StrictRequired<T> = { [K in keyof T]-?: NonNullable<T[K]> }`（实测有效）。
4. **`Exclude<string, "a">` 返回 `string`，以为类型写坏了** → `string` 不是联合，分发不发生，减法无从删起。修法：把值集合显式建成字面量联合再 `Exclude`；「非空字符串」这类约束只能靠运行时校验。
5. **`T extends never ? A : B` 永远得不到 `A`** → `never` 是空联合，分发直接产出 `never`。修法：`[T] extends [never]`（实测 `true`）。
6. **自定义工具类型丢了 `readonly` / `?`** → 键被 `as` 子句改名，或映射不是同态形式。修法：保留 `{ [K in keyof T]: ... }` 形式，需要时显式写 `+?` / `+readonly`；另外 `ReturnType<typeof someFn>` 得到 `any` 不是工具类型的问题，是[模块与声明文件](/typescript/modules-and-declarations)的声明缺失，补声明或包一层有类型的 wrapper。

## 练习

<Exercise title="练习 1 · 预测四行条件的结果" difficulty="进阶">

先写下预测，再用探针 `const probe: 0 = x` 核对：

```ts
type Dist<T> = T extends string ? "S" : "N";
type NoDist<T> = [T] extends [string] ? "S" : "N";
declare const v1: Dist<"a" | 1>;
declare const v2: Dist<never>;
declare const v3: NoDist<"a" | 1>;
declare const v4: NoDist<never>;
```

<template #answer>

实测：`v1` = `"N" | "S"`；`v2` = `never`（探针**不报错**，因为 `never` 可赋给任何类型）；`v3` = `"N"`；`v4` = `"S"`。分发把联合拆成逐成员计算，`never` 作为空联合拆出 0 个成员所以整体是 `never`；用 `[T]` 包住后 `never` 变普通类型参与判断，`[never] extends [string]` 为真于是拿到 `"S"`。这就是 `IsNever<T>` 的实现依据。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造报错并读懂它" difficulty="进阶">

写这段并运行 `npx tsc --noEmit --strict --target es2022 --module esnext <文件>`，逐条解释报错（以及「为什么没报错」）：

```ts
type Opts = { host: string; port: number; debug?: boolean };
type Getters<T> = {
  [K in keyof T as K extends string ? `get${Capitalize<K>}` : never]: () => T[K];
};
declare const g: Getters<Opts>;
export const a = g.getDebug();
export const b = g.getHost;
export const c: string = g.getPort();
export const d: Omit<Opts, "prot"> = { host: "", port: 1, debug: true };
```

<template #answer>

- `a`：合法，`getDebug` 返回 `boolean | undefined`（`debug` 可选，`T[K]` 保留 `| undefined`）；`b` 也合法，`getHost` 是 `() => string`。
- `c`：报错 `TS2322: Type 'number' is not assignable to type 'string'`——`getPort()` 返回 `number`。这是 `Getters` 的正常保护。
- `d`：**不报错，而且 `port` 仍然存在**。`Omit` 的第二个类型参数约束是 `keyof any`，拼错的 `"prot"` 什么也没删——本章最值钱的一条实测结论；换成 `Pick<Opts, Exclude<keyof Opts, "prot">>` 就会在 `"prot"` 上报 `TS2344`。

</template>

</Exercise>

<Exercise title="练习 3 · 给 PATCH 接口派生类型" difficulty="基础">

有一个 `Todo` 模型（`id` / `title` / `done` / `createdAt` / `ownerId`）：创建入参不含 `id` 和 `createdAt`；更新入参全部可选但不能改 `ownerId`；列表项只要 `id` / `title` / `done`。用 `Omit` / `Partial` / `Pick` 各写一行，并说明哪一行有拼写风险。

<template #answer>

```ts
type Todo = { id: string; title: string; done: boolean; createdAt: number; ownerId: string };

type CreateInput = Omit<Todo, "id" | "createdAt">;
type UpdateInput = Partial<Omit<Todo, "ownerId">>;
type ListItem = Pick<Todo, "id" | "title" | "done">;
```

拼写风险在 `Omit` 那两行：它不校验键是否存在。想要底层保证就写 `Partial<Pick<Todo, Exclude<keyof Todo, "ownerId">>>`。另外 `UpdateInput` 是**浅**可选——`Partial` 不会递归。`ListItem` 用 `Pick` 而不是 `Omit`，因为这里是白名单语义，读起来更贴近业务。

</template>

</Exercise>

<Exercise title="练习 4 · 自己实现一个会分发的 Omit" difficulty="挑战">

内置 `Omit` 对联合不分发（`Pick<{a:1}|{b:2}, "a">` 报 `TS2344: ... constraint 'never'`）。写一个 `DistributiveOmit<T, K>` 让它对联合逐成员处理，并用探针验证 `DistributiveOmit<{ a: 1; x: number } | { b: 2; x: number }, "x">` 仍是两个成员的联合。

<template #answer>

```ts
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type R = DistributiveOmit<{ a: 1; x: number } | { b: 2; x: number }, "x">;
declare const r: R;
const probe: 0 = r;   // 报错里应念出 { a: 1; } | { b: 2; }
```

关键是 `T extends unknown ? ... : never`：`extends unknown` 恒真，但 `T` 处于裸参数位置，于是触发分发，对每个成员单独 `Omit` 再合成联合。预期报错念出 `{ a: 1; } | { b: 2; }`（这一侧我没有在 5.9.3 上用探针抄下来，只跑过「内置 `Omit`/`Pick` 对联合报 `TS2344 ... constraint 'never'`」那一半，请自行确认）。注意 `K extends PropertyKey` 仍不校验键存在性——分发解决的是联合，不是拼写。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html) —— 官方内置清单与逐个示例，新增的以此为准。
- [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html) 与 [Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html) —— 分发规则（naked type parameter）、`[T] extends [U]`、`in` / 修饰符开关 / `as` 键改名的官方说明。
- [Template Literal Types](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html) —— `` `on${Capitalize<K>}` `` 这类写法的语法与限制；特性引入版本见 [TS 2.8：infer](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-8.html) 与 [TS 4.1：模板字面量与键重映射](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-1.html)。
- 本机源码 `node_modules/typescript/lib/lib.es5.d.ts`（实测 `Awaited` 第 1570 行、`Partial` 1585、`Omit` 1630、`NonNullable` 1635、`ReturnType` 1650 附近）—— 最权威的「它到底怎么实现」，直接打开读比看二手博客快。

## 下一章

工具类型拆到底就是泛型、映射类型和条件类型，本章也看清了它们对联合、索引签名、拼写错误的真实行为——全在类型层面。下一章换战场：**类型怎么跨文件、跨包流动**——`import type` 编译后剩什么、`.d.ts` 描述什么、无类型的库怎么补、`Cannot find module` 的四种成因，见[模块与声明文件](/typescript/modules-and-declarations)。
