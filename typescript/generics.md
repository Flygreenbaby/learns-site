# 泛型：用一个类型参数换掉五份复制粘贴

首页列的失败模式里有一条：「泛型写不出来，于是复制粘贴五份几乎一样的函数，只为了参数类型不同。」这是泛型唯一的存在理由，也是学它唯一的正确入口——先感受那份重复有多恶心，再看一个 `<T>` 怎么收掉它。但泛型也是 TS 里最容易**用过头**的特性：给只有一个类型的场景套泛型、泛型套泛型读到第七层、用泛型包装 `any` 然后以为自己在做类型安全。本章两头都讲：怎么写对，以及什么时候别写。

结论全部本机实跑：TypeScript 5.9.3 + Node v25.4.0，日期 2026-10-17，命令 `npx tsc --noEmit --strict --target es2022 --module esnext <文件>`；框架那节用的是本地 `node_modules` 里的 vue 3.5.44，其余没跑过的标明。

<Callout type="verified" title="本章实跑范围">

本章全部报错文案来自本机三次 `tsc` 批量运行（`.scratch/ts-ch6-gen.ts`、`ts-extra-gen.ts`、`ts-extra-gen2.ts`）与一次针对 `node_modules/vue` 的独立运行（`.scratch/ts-ch6-vue.ts`），版本号 `typescript@5.9.3`，日期 2026-10-17。文件路径与行列号写在每条文案前面，可以自行复现：把示例存成同路径文件，跑同一条命令即可。Vue / Pinia / Fastify 那节里，只有 `Ref` 的报错是编译过的，接口用法的描述属于「按公开类型推断的用法说明」，未经运行时验证。

</Callout>

## 复制粘贴五遍的真实样子

```ts
function firstNum(xs: number[]) { return xs[0]; }
function firstStr(xs: string[]) { return xs[0]; }
function firstBool(xs: boolean[]) { return xs[0]; }
function firstUser(xs: { id: string }[]) { return xs[0]; }
function firstTodo(xs: { title: string; done: boolean }[]) { return xs[0]; }
```

五份函数体完全相同，只有参数类型不同。更糟的是它不可组合：明天要 `firstOrder`、`firstRole`，你继续粘。而且**它没法表达你真正想要的关系**——「返回值的元素类型和入参一致」，你只是每次重新抄了一遍这个关系。

一份泛型收掉：`function firstOne<T>(xs: T[]): T { return xs[0]; }`。调用侧五种类型全部适用，且返回类型跟着走（实测 `const f1: number = firstOne([1, 2, 3])` 与 `const f2: string = firstOne(["a"])` 零报错，而 `const f3: number = firstOne<string>(["a"])` 报）：

```text
.scratch/ts-ch6-gen.ts(7,7): error TS2322: Type 'string' is not assignable to type 'number'.
```

`T` 叫**类型参数（type parameter）**，`firstOne` 是**泛型函数**。读法：`<T>` 是形参列表里的形参，只不过它接的是类型；调用时 TS 会**自动**填它——这就是下一节。

## 类型参数是编译期的形参，运行时不存在

第 1 章的类型擦除在泛型上最直白：`T` 编译后什么都不剩，你不能拿它当值用。`function useTypeAsValue<T>(): void { const c = T; console.log(c); }` 与 `function makeEmpty<T>(): T { return {}; }` 实测各得一条：

```text
.scratch/ts-ch6-gen.ts(102,48): error TS2693: 'T' only refers to a type, but is being used as a value here.
.scratch/ts-ch6-gen.ts(103,30): error TS2322: Type '{}' is not assignable to type 'T'.
  'T' could be instantiated with an arbitrary type which could be unrelated to '{}'.
```

`TS2693` 拦住的正是新手最常见的三个念头：`if (T === String)` 想按类型分支、`new T()` 想造实例、`typeof x === T` 想做运行时校验。**都不存在**。想让泛型参与运行时判断，就得把「类型信息」当显式参数传进去（本章 `fetchJson<T>` 的做法就是它的正解）。

`could be instantiated with an arbitrary type` 这句是泛型里最重要的报错语言，会反复出现（第 5 章事件总线那节见过一次）。含义是：**调用方决定 `T` 是什么，实现方没有权利假设它是任何东西**，所以你只能从参数里拿值、或者用约束（下一节）拿到成员访问权。

## 推断优先：能不写类型实参就不写

`firstOne([1, 2, 3])` 没人写 `firstOne<number>`。TS 从实参反推 `T`（类型推断 inference，第 7 章主体），日常代码里 **99% 的泛型调用都不用写实参**，因为显式实参会**关掉推断**——上面那条 `TS2322` 就是这么来的。只有三种情况该写实参：

1. **没有推断来源**：不接参数的函数。实测的回落行为值得记——`declare function emptyList<T>(): T[];` 之后 `const revealEmpty: never = emptyList()` 得到 `TS2322: Type 'unknown[]' is not assignable to type 'never'.` 没有候选时 `T` 回落成 `unknown[]`（不是 `never[]`，也不是你想要的类型），所以这类调用**要么写实参 `emptyList<string>()`，要么给变量加注解**。
2. **你比调用现场知道得多**：接口返回是 `UserDto`，但实参只有 URL。
3. **想收窄推断结果**：推断给了联合，你只要其中一支。

反过来，**给每个调用都写实参是过度标注**：改了函数签名，二十个显式实参要跟着改。

## 约束 `extends`：用途是访问成员，不是限制身份

不写约束时 `T` 是不可知的任何东西，所以想碰成员就报错：`function nameOf<T>(x: T) { return x.name; }` 实测 `.scratch/ts-ch6-gen.ts(15,38): error TS2339: Property 'name' does not exist on type 'T'.` 约束就是「给 `T` 一条最低保证」，写法和用途实测：

```ts
function lenOf<T extends { length: number }>(a: T, b: T): T { return a.length >= b.length ? a : b; }
const longerTuple: string = lenOf("abc", "ab");   // 通过，返回类型还是 string 而不是 { length: number }

interface HasId6 { id: string }
declare function save<T extends HasId6>(x: T): T;
const saved = save({ id: "u1", nickname: "n" });
const savedExtra: string = saved.nickname;        // 通过：多出来的字段还在

declare function loose(x: HasId6): HasId6;
const lostExtra = loose({ id: "u1", nickname: "n" });
```

```text
.scratch/ts-ch6-gen.ts(28,37): error TS2353: Object literal may only specify known properties, and 'nickname' does not exist in type 'HasId6'.
.scratch/ts-ch6-gen.ts(29,37): error TS2339: Property 'nickname' does not exist on type 'HasId6'.
```

**这是本章最重要的一条认知**：`T extends HasId6` 不是「只允许传 HasId6」，而是「**允许传任何带 `id: string` 的东西，并且我把它的完整类型留住**」。上面 `loose` 既触发了第 4 章的多余属性检查，又把返回类型砸成 `HasId6`；泛型版本两条都没有——**这就是所有「保留输入形状」的 API（`save`、`pick`、`defineStore`、`ref`）都用泛型的原因**。约束不成立时报错落在实参位置：`function scale<T extends number>(x: T) { return x.toFixed(2); }` 之后 `scale("a")` 实测 `TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`

**`keyof T` 约束**是日常最高频的一种，它让「键与值类型」保持联动（第 4 章末节已练过形状）：

```ts
function prop<T, K extends keyof T>(o: T, k: K): T[K] { return o[k]; }
const pv: number = prop({ a: 1, b: "s" }, "a");     // 通过
const pb: string = prop({ a: 1, b: "s" }, "b");     // 通过
prop({ a: 1 }, "z");                                // 报错
```

```text
.scratch/ts-ch6-gen.ts(37,33): error TS2345: Argument of type '"z"' is not assignable to parameter of type '"a"'.
```

看文案最后一项：参数类型显示的是 `'a'`（第二个实参位置由 `K` 决定，而 `K` 只能从 `T` 的键里取）。拼错键、传了别的对象的键，都栽在这一行。

**默认类型参数**（`T = 某个类型`）与函数默认值同构，实测两个方向都工作：`declare function tagOf<T extends string = "unknown">(t?: T): T;` 之下 `const tagDefault: "unknown" = tagOf();` 与 `const tagGiven: "hot" = tagOf("hot");` 都零报错。用途很窄但真实：给可选回调、给「不传就是浏览器环境」这类环境参数留默认。别把它当类型文档——写默认值不会让调用方少看签名。

## 多个类型参数之间的关系：`pick` 的签名与实现体

`<T, K extends keyof T>` 这对组合是工具类型 `Pick` 的骨架，也是**「后一个类型参数引用前一个」**这个机制的最小样子：

```ts
declare function pickWorks<T, K extends keyof T>(o: T, keys: K[]): Pick<T, K>;
const picked = pickWorks({ a: 1, b: "s" }, ["a"]);   // Pick<{a,b}, "a"> —— 只有 a
pickWorks({ a: 1, b: "s" }, ["a", "c"]);             // 报错
```

```text
.scratch/ts-ch6-gen.ts(48,58): error TS2322: Type '"c"' is not assignable to type '"a" | "b"'.
```

报错落在数组元素位置：`K` 被 `keys: K[]` 和 `keyof T` 两处夹住，`"c"` 不属于 `keyof T`，整个数组推断失败。**这就是「关系」在类型层发挥作用的现场**：输入之间的一致性由类型参数链条保证，不需要运行时判断。

然后是诚实的一半——**这个函数的实现体写不干净**。实测 `function pickReal<T, K extends keyof T>(o: T, keys: K[]): Pick<T, K> { const out: Partial<T> = {}; for (const k of keys) out[k] = o[k]; return out; }` 中间那行赋值通过，`return out` 报 `TS2322: Type 'Partial<T>' is not assignable to type 'Pick<T, K>'.`；把返回类型换成 `{ [P in K]: T[P] }` 再改用 `Record<string, unknown>` 累积，报的是同族的 `TS2322: Type 'Record<string, unknown>' is not assignable to type '{ [P in K]: T[P]; }'.`（两条位置分别是 `.scratch/ts-ch6-gen.ts(46,3)` 与 `(41,3)`）。

泛型的**签名容易、写回难**（同第 5 章总线那条 `could be instantiated with a different subtype`）：`out` 里所有键都在，但 TS 无法证明「只有 `K` 那几个键」，`Partial<T>` 到 `Pick<T, K>` 差一个精度，只能靠断言收口。所以真实项目里 `pick` 是**类型层**用 `Pick`、实现层写循环 + 一次断言（第 8 章正式讲断言的边界与代价）。**别看到内置工具类型一行就以为它好写——那是库作者替你吃下的成本。**

最后一个细节：多个实参推同一个 `T` 时不会自动变联合（实测）。`declare function merge<T>(a: T, b: T): T;` 之下 `merge(1, "a")` 报 `TS2345: Argument of type '"a"' is not assignable to parameter of type '1'.`——`T` 由第一个实参定成 `1`。想让参数类型各自独立就写 `<A, B>`；想要联合就显式 `merge<number | string>(1, "a")`。**「一个类型参数出现在多处 = 这几处必须是同一个类型」，这条正是泛型有用的原因，也是它报错的原因。**

## 泛型类型、泛型接口、泛型类

```ts
interface Store<T> { get(k: string): T | undefined; set(k: string, v: T): void }
type Handler<T> = (item: T) => void;
class Box<T> {
  constructor(readonly value: T) {}
  map<U>(f: (v: T) => U): Box<U> { return new Box(f(this.value)); }
}
declare const userStore: Store<{ name: string }>;
const storedName = userStore.get("u1")?.name;    // 通过：get 返回 { name } | undefined
```

`Store<T>`、`Handler<T>`、`Box<T>` 只是把 `T` 当占位符，实例化时才填。注意泛型类里**方法可以自带新的类型参数**（`map<U>`），而类级别的 `T` 必须在 `new` 时就定死——这一点直接决定了它在真实项目里少用。

**类泛型用得少的三个原因**（本站观察，不是语言限制）：① 类型参数绑定在实例上，粒度过粗，一个类里不同方法想服务不同类型就得再加参数；② 泛型只在类型层存在（`TS2693` 那条），「按类型分支」「造默认值」类泛型一样帮不上；③ 本站路线（组合式、函数式）里承担通用性的是函数与类型别名——`fetchJson<T>`、`ref<T>`、`createBus` 全是函数泛型，第 12 章项目里你不需要写一个泛型类。读 NestJS 或老式 class 代码时会碰到它，认得就够了。

## 泛型与数组、`ReadonlyArray`、变长元组

`T[]` 和 `Array<T>` 完全等价，选一个统一即可。有实质差别的是**只读**：`declare function collect<T>(xs: readonly T[]): T[];` 之下 `collect(roArr)`（`roArr: ReadonlyArray<number>`）与 `collect([1, 2])` 都通过——**写库/写工具函数时参数用 `readonly T[]`**，它对调用方更宽容（可变、只读都能传），又禁止你在实现里改调用方的数组。反过来 `const backToMutable: number[] = roArr;` 实测撞上那道墙：

```text
.scratch/ts-ch6-gen.ts(77,7): error TS4104: The type 'readonly number[]' is 'readonly' and cannot be assigned to the mutable type 'number[]'.
```

元组也能泛型化，这叫**变长元组参数（variadic tuple types）**，签名形如 `declare function concat7<A extends readonly unknown[], B extends readonly unknown[]>(a: A, b: B): [...A, ...B];` 和 `declare function prependId<T extends readonly unknown[]>(...args: T): [number, ...T];`。同一个 `concat7` 调用两次，结果完全不同（实测）：

```ts
const precise = concat7([1, 2] as const, ["a"] as const);
const revealPrecise: never = precise;    // 报错，文案给出真实类型
const widened = concat7([1, 2], ["a"]);
const revealWidened: never = widened;    // 报错，文案给出真实类型
```

```text
.scratch/ts-ch6-gen.ts(15,7): error TS2322: Type '[1, 2, "a"]' is not assignable to type 'never'.
.scratch/ts-ch6-gen.ts(17,7): error TS2322: Type '(string | number)[]' is not assignable to type 'never'.
```

加 `as const` 拿到精确元组 `[1, 2, "a"]`，不加就退化成 `(string | number)[]`——因为 `[1, 2]` 推断成 `number[]`，`A` 就只是 `number[]`。这不是泛型的坑，是第 2 章字面量推断与第 7 章 `as const` 的连锁。

<Callout type="verified" title="这两条文案逐字来自本机 tsc 5.9.3">

上面 `ts-ch6-gen.ts(15,7)` 与 `(17,7)` 出自同一个文件的两个相邻代码块：第 15 行那个变量带 `as const`，第 17 行那个没有，两边都刻意标注成 `never`，让编译器把真实类型吐出来（第 3 章用过的「类型显影」技巧）。运行环境与命令同本章开头，日期 2026-10-17。

</Callout>

## `infer` 的最小引入

`infer` 只在一处出现：条件类型的 `extends` 右侧，作用是**「我不预先命名它，让匹配过程告诉我」**：

```ts
type Unwrap<T> = T extends Promise<infer U> ? U : T;
declare const revealed: Unwrap<Promise<{ a: number }>>;
const revealWrong: never = revealed;             // 报错，文案给出真实类型
const revealRight: { a: number } = revealed;     // 通过

type FirstOf<T extends readonly unknown[]> = T extends [infer F, ...unknown[]] ? F : never;
declare const firstIsString: FirstOf<[string, number]>;
const notNumber: number = firstIsString;         // 报错
```

```text
.scratch/ts-ch6-gen.ts(94,7): error TS2322: Type '{ a: number; }' is not assignable to type 'never'.
.scratch/ts-ch6-gen.ts(99,7): error TS2322: Type 'string' is not assignable to type 'number'.
```

两条实测文案就是「`infer` 抽到了什么」的直接读数：`Unwrap` 抽到 `{ a: number }`，`FirstOf` 抽到 `string`。本章只要求记住这个最小用法——`infer` 是**从类型里取值**的手柄。它的真正价值在第 8 章：`ReturnType<T>`、`Awaited<T>`、参数提取全是 `infer` + 条件类型。

## `unknown` 与泛型的取舍

两者都表达「现在还不知道类型」，但性质相反：`unknown` 是**诚实地不知道**（要先收窄才能用，第 3 章），泛型是**由调用方决定**（类型在调用点被钉死）。混用的代价实测过：`declare function unsafeBox<T>(v: unknown): T;` 之下 `const sneaky: number = unsafeBox("i am a string");` **零报错**。

**这一行是泛型最危险的用法**：`T` 由接收端的注解决定，值却原样透传，`sneaky` 运行时是字符串——类型是个纯粹的谎言。任何形如「进去 `unknown`，出来 `T`，中间没有校验」的 API 都在生产类型谎言（第 11 章把它列为重点审查对象）。

正确的形态有两种。**其一，泛型只在「调用方能告诉我们类型」时用**：`declare function parseJson(raw: string): unknown;` 之后 `parseJson<number>("1")` 实测 `TS2558: Expected 0 type arguments, but got 1.`——这个函数没声明泛型参数，TS 直接拒绝你传实参，**这是设计者替你守住边界**：`JSON.parse` 的结果不可能是你嘴说的类型。

**其二，把「调用方知道的类型」和「运行时能验证的证据」同时收进签名**，这就是阶段项目里 `fetchJson<T>` 该长的样子：

```ts
type OrderDto = { no: number };
function isOrderDto(v: unknown): v is OrderDto {
  return typeof v === "object" && v !== null && "no" in v && typeof v.no === "number";
}
declare function fetchJson<T>(url: string, validate: (v: unknown) => v is T): Promise<T>;

const ok = fetchJson("/api/order", isOrderDto);   // 实测通过：T = OrderDto
declare function isUserDto(v: unknown): v is { id: string; name: string };
const bad = fetchJson<OrderDto>("/api/order", isUserDto);   // 报错
```

```text
.scratch/ts-extra-gen.ts(9,66): error TS2345: Argument of type '(v: unknown) => v is OrderDto6' is not assignable to parameter of type '(v: unknown) => v is UserDto6'.
  Type predicate 'v is OrderDto6' is not assignable to 'v is UserDto6'.
    Type 'OrderDto6' is missing the following properties from type 'UserDto6': id, name
```

**校验器与泛型参数被绑成同一个 `T`**，所以「类型说 A、校验器验 B」骗不过编译。这条设计正是第 3 章「`unknown` → 运行时校验 → 收窄」链路的函数化版本。

顺带一条实测发现：`fetchJson("/a", (v) => typeof v === "object")` 这种**返回 boolean 的箭头函数竟然能通过**，而且 `T` 被填成了 `object | null`（`.scratch/ts-extra-gen.ts(11,7): error TS2322: Type 'Promise<object | null>' is not assignable to type 'never'.`）。原因是 TS 会把这种回调**推断成类型谓词**（inferred type predicates，`typeof v === "object"` 里的收窄被吸收进签名）。

<Callout type="unverified" title="推断类型谓词的引入版本">

「inferred type predicates 自 TS 5.5 引入」是社区常见说法，本站只验证了 5.9.3 的行为，没有跨版本对照。要判断你的项目能不能依赖它，先在[发行说明](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html)核对，或到 [Playground](https://www.typescriptlang.org/play/) 切版本跑一遍。

</Callout>

## 什么时候不该用泛型

1. **只有一个类型时不要写泛型。** `function pointless<T extends { id: string }>(x: T): T` 和 `function simple(x: { id: string }): { id: string }` 都合法，但后者一眼读得懂。泛型唯一的收益是「保留调用方给的更精确类型」（`save`/`loose` 那组对照说明收益真实存在），所以判据不是「有没有多写一个 `<T>`」而是「**调用方会不会传比约束更宽的类型，而你希望原样返回**」。不会，就别写。
2. **约束链写到人看不懂。** `declare function deep<A, B extends A, C extends B, D extends C>(x: D): A` 实测合法，**但没人能维护它**。经验线：一个签名里超过 3 个类型参数，或某个参数只出现一次，就重新设计——把参数对象化、把关系挪到类型别名里、或者接受重复。
3. **想「把 `any` 换成泛型」结果只是换了个写法。** 反例就是 `unsafeBox<T>(v: unknown): T`：`T` 没有约束、也不从任何输入推断，只是把 `any` 伪装成好看的样子。把 `any` 换成泛型成功的标志是：**报错变多了**（约束开始挡住非法调用）。
4. **需要运行时判断形状时用 `unknown` + 校验，不是泛型。** `TS2693` 已经证明类型参数不是值。

## 函数与框架里的泛型：Vue、Pinia、Fastify

泛型在框架里出现的频率远高于你自己的代码，认得这些形状比会写更实用。**Vue 3 组合式 API**（本机 `node_modules` 里的 vue 3.5.44，实测）：

```ts
import { ref, type Ref } from "vue";
type User6 = { id: number; name: string };
const u = ref<User6 | null>(null);
const bad: Ref<User6> = u;                    // 报错
const nameLen: number = u.value?.name.length; // 报错
```

```text
.scratch/ts-ch6-vue.ts(4,7): error TS2322: Type 'Ref<{ id: number; name: string; } | null, User6 | { id: number; name: string; } | null>' is not assignable to type 'Ref<User6, User6>'.
  Type '{ id: number; name: string; } | null' is not assignable to type 'User6'.
    Type 'null' is not assignable to type 'User6'.
.scratch/ts-ch6-vue.ts(5,7): error TS2322: Type 'number | undefined' is not assignable to type 'number'.
```

三条收获：① `ref<T>` 是「**类型由调用方给**」的教科书案例，不写实参时它从初值推断（`ref({ id: 1, name: "a" })` 直接给你精确类型）；② 可空状态必须自己写进 `T`（`ref<User | null>(null)`），框架不会替你想；③ 本机这版 `Ref` 有**两个类型参数**（`Ref<值, 写入类型>`），报错文案里那两个参数不是笔误——读第三方库泛型报错时，先承认「它的类型参数可能比你写的多」，别急着加 `as` 消音。

**Pinia** 的 `defineStore` 走同一条路：状态对象的类型由你写的初始值推断，`getters` 与 `actions` 的 `this` 都从那里派生——你不需要为它写泛型实参，但要看懂「getter 返回类型 = 你 return 的类型」这条链（第 7 章推断、[Pinia](/vue/pinia) 各自展开）。**Fastify** 是服务端泛型的典型：路由 `schema`、`reply` 的发送类型、请求装饰器都靠泛型参数把「这个路由返回什么」传给插件与测试工具（[Fastify 入门](/backend/fastify-basics)）。这些库的泛型参数**数量常比你预期多**（带默认值的、给内部推断用的），读它们的类型时优先看官方文档的参数说明而不是猜。**本站未安装 fastify 与 pinia 的依赖，这两段属于结构性描述，未经编译验证。**

## 常见错误与排查

1. **不写约束就用成员**：`TS2339: Property 'x' does not exist on type 'T'.`（实测）。加 `T extends { x: ... }` 或 `keyof T` 那类约束；确实什么都不能假设时，`T` 只用来**传递**类型。
2. **拿 `T` 当运行时值**：`TS2693: 'T' only refers to a type`（实测）。把类型信息做成显式参数（校验函数、构造器、`Map` 表）。
3. **实现体里造 `T` 值或整体写回**：`Type '{}' is not assignable to type 'T'. 'T' could be instantiated with an arbitrary type ...`（实测，同族还有 `Partial<T>` 不能赋给 `Pick<T, K>`）。从参数取值；写回确实需要精度时限定一处断言并注释原因（第 11 章）。
4. **一个 `T` 出现在多处就期待联合**：`TS2345: Argument of type '"a"' is not assignable to parameter of type '1'.`（实测）。`T` 由第一个推断点定住；拆成 `<A, B>` 或显式 `merge<number | string>(...)`。
5. **显式类型实参关掉推断**：`firstOne<string>(["a"])` 报 `TS2322`（实测）。先删实参让推断工作；只在无推断来源（实测回落 `unknown[]`）或需要收窄时才写。
6. **变长元组忘了 `as const`**：期望 `[1, 2, "a"]` 实际拿到 `(string | number)[]`（实测两条文案对照）。
7. **无约束、无推断来源的泛型 = 类型谎言**：`unsafeBox("字符串")` 编译通过、运行时是字符串（实测零报错）。看这个 `T` 是否从任何**输入**或**校验器**推出来；推不出来就改成 `unknown` + 校验，或让两者绑成同一个 `T`（`fetchJson<T>` 那对签名）。

## 练习

<Exercise title="练习 1 · 把两份复制粘贴收敛成一个泛型" difficulty="基础">

```ts
function byIdNum(xs: { id: number }[], id: number) { return xs.find((x) => x.id === id); }
function byIdStr(xs: { id: string }[], id: string) { return xs.find((x) => x.id === id); }
```

① 合并成一份泛型；② 说明为什么返回类型是 `T | undefined`；③ 给两个调用点，一个通过一个报错，并说明报错码。

<template #answer>

```ts
function byId<T extends { id: string | number }>(xs: T[], id: T["id"]): T | undefined {
  return xs.find((x) => x.id === id);
}

type Usr = { id: string; name: string };
const u: Usr | undefined = byId([{ id: "a", name: "n" }], "a");   // 通过，且保留 name
byId([{ id: 1, name: "n" }], "a");   // 报错：TS2345 Argument of type 'string' is not assignable to parameter of type 'number'
```

上面两行与报错文案本机实测（同本章命令）。约束 `{ id: string | number }` 是给 `x.id` 一个可访问性（`TS2339` 那条就是这么躲开的）；`T["id"]` 是索引访问类型，让第二个参数的类型**跟着第一个实参走**，这是「多个参数之间的关系」最小形态。返回 `T | undefined` 不是泛型决定的，是 `Array.prototype.find` 本身的签名——**泛型不会改变成员自身的可空性**。通过的写法保留 `name`，换成非泛型 `xs: { id: string }[]` 就会把它抹掉——本章 `save`/`loose` 那组对照的复用。

</template>

</Exercise>

<Exercise title="练习 2 · 读懂 `keyof` 约束的报错" difficulty="基础">

用本章的 `prop<T, K extends keyof T>` 解释两次调用各自的报错文案：`prop({ a: 1, b: "s" }, "c")` 与 `prop({ a: 1 }, "b")`。第二个调用为什么报的还是 `'b'` 而不是别的？

<template #answer>

两次报错形状相同、内容不同（第一条与本章实测的 `prop({ a: 1 }, "z")` 同族）：

```text
error TS2345: Argument of type '"c"' is not assignable to parameter of type '"a" | "b"'.
error TS2345: Argument of type '"b"' is not assignable to parameter of type '"a"'.
```

第一条里 `T` 从第一个实参推成 `{ a: number; b: string }`，于是 `K` 的许可集是 `"a" | "b"`，`"c"` 不在里面。第二条里 `T` 是 `{ a: number }`，许可集只剩 `"a"`——所以报错里显示的正是**那个对象的键集**，它不是笔误，而是 `K extends keyof T` 生效的证据。

读泛型报错的通用方法：**看报错里出现的具体字面量集合，反推 TS 把 `T`/`K` 填成了什么**。想直接确认就用本章反复用的揭露手法 `const reveal: never = 值;`，文案会把类型原样吐出来（实测多次有效）。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造报错：让实现体出卖签名" difficulty="进阶">

下面这份 `first` 是本领域常见的「想当然」写法。预测 `--strict` 下的报错，解释 `T` 在这里为什么不能是「随便什么」，并给两种修法（不许用 `as`）。

```ts
function first<T>(xs: T[]): T {
  if (xs.length === 0) return [];
  return xs[0];
}
```

<template #answer>

报错在 `return [];`：

```text
error TS2322: Type 'never[]' is not assignable to type 'T'.
  'T' could be instantiated with an arbitrary type which could be unrelated to 'never[]'.
```

（本章实测用的是 `{}`，文案后半句逐字相同；空数组这里推断成 `never[]`，属于同一族报错。）原因：`T` 由**调用方**决定，可能是 `number`，而 `[]` 不是 `number`——正是第 3 条排查说的「实现体里造 `T` 值」。

修法一，把可空性写进签名，诚实地承认可能没有：`function first<T>(xs: T[]): T | undefined { return xs[0]; }`（它仍依赖默认配置下不检查越界读，见第 4 章那条；开 `noUncheckedIndexedAccess` 后这个实现才类型自洽，第 10 章）。修法二，把「空」变成显式失败，返回类型不需要联合：`function firstOr<T>(xs: T[], fallback: T): T { return xs.length === 0 ? fallback : xs[0]; }`。第二种更常用：**用参数换取「不需要造假 `T`」**，这是泛型实现体的标准解法。

</template>

</Exercise>

<Exercise title="练习 4 · 让 `fetchJson` 在没校验器时只给 `unknown`" difficulty="挑战">

本章的 `fetchJson<T>(url, validate)` 每个调用都要传校验器。请改造签名，让：① 不传校验器时返回 `unknown`（而不是 `T`）；② 传校验器时返回精确类型。禁止 `any`、禁止 `as`。

<template #answer>

```ts
declare function fetchJson(url: string): Promise<unknown>;
declare function fetchJson<T>(url: string, validate: (v: unknown) => v is T): Promise<T>;
```

这是**重载**（第 5 章）而非泛型技巧：窄签名放前面，`unknown` 那条兜住无校验器的调用。效果：`const safe = fetchJson("/api/order", isOrderDto)` 是 `Promise<OrderDto>`，`const raw = fetchJson("/api/order")` 是 `Promise<unknown>`，两行实测零报错，返回类型由第二个参数是否存在决定。`raw` 在 `await` 之后必须走第 3 章那套收窄才能碰任何成员——**这正是「不校验就只给你 unknown」的效果**。

要点：① 「不校验就给 `unknown`」把责任交回调用方，比 `T = any` 诚实一百倍——`T = Record<string, unknown>` 这类默认值也只是把谎言规范化。② 把校验器做成必传参数（即本章签名）是最好的设计：没有校验器就编译不过。③ 阶段项目要求的 `fetchJson<T>(url): Promise<T>` 内部做运行时结构校验，是这个思路的完整版——校验器藏在函数内部（第 3 章 `isUser` 那一族），签名只留 `T`，代价是「校验器与 `T` 的绑定」要靠实现手工保证，`as` 会在这一处出现（第 11 章讨论它的边界）。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Generics（Handbook 2）](https://www.typescriptlang.org/docs/handbook/2/generics.html) —— 核实本章主线：[泛型类型](https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-types)、[泛型函数](https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-function-declarations)、[泛型接口](https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-interface-declarations) 与 [泛型约束](https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-constraints)（对照本章 `T extends { length: number }`、`K extends keyof T` 两组实测）。[Creating Types from Generics](https://www.typescriptlang.org/docs/handbook/2/creating-types-from-generics.html) —— 核实索引访问类型 `T["id"]`、`T[K]` 与第 3 章 `(typeof ROLES)[number]` 的定位关系。
- [Conditionals 与 `infer`](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html) —— 核实本章 `Unwrap`/`FirstOf` 的语法边界（`infer` 只能出现在 `extends` 右侧），第 8 章主材料。[Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html) —— 核实 `Pick` / `Partial` / `Record` 都是本章 `<T, K extends keyof T>` 签名的内置版；`pickReal` 那条 `TS2322` 说明内置版替你吃掉了什么。变长元组 `[...A, ...B]` 的语法来源见[发行说明总览](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html)，本章只保证 5.9.3 行为（实测）。
- [Vue 3 `ref`](https://vuejs.org/api/reactivity-core.html#ref) —— 核实本章实测的 `ref<User | null>(null)` 用法与 `Ref` 的两个类型参数（本机 vue 3.5.44）；[Pinia 核心 API](https://pinia.vuejs.org/api/) 与 [Fastify 类型文档](https://fastify.dev/docs/latest/Reference/TypeScript/) 用来核对本节末段的结构性描述（未安装依赖，未做编译验证）。
- 版本提示：本章报错码（`TS2322`、`TS2339`、`TS2345`、`TS2353`、`TS2558`、`TS2693`、`TS4104`）与 `unknown[]` 回落、`as const` 元组精度都来自本机 5.9.3 输出；类型谓词推断的引入版本已标 unverified。

## 下一章

泛型让你**用类型写函数**，而本章反复用到一件事：TS 会在调用点自己把 `T`、`K` 填好，填的结果经常比你预期的更宽或更窄（`emptyList()` 回落成 `unknown[]`、`[1, 2]` 退化不成元组、`areaInferred` 给了 `3 | 4`）。下一章 [类型推断与上下文类型](/typescript/inference) 专门讲这套自动机制。
