# 函数类型：签名怎么表达，报错就怎么解释

函数是 TS 里唯一「类型与值两套规则」的结构：可赋值性按几条反直觉的方向判定——回调少写参数合法、多写不合法；期望 `() => void` 的位置可以塞任何返回值，反过来不行；只 `throw` 的函数不写返回类型时推断结果是 `void` 而不是 `never`。方向搞错有两类事故：**该报错的没报错**（`this` 丢绑定，编译干净、运行时 `TypeError`），**能通过的写成错的**（给回调强行加窄参数类型，换来一串 `TS2322`）。

结论全部本机实跑：TypeScript 5.9.3 + Node v25.4.0，日期 2026-10-17，命令统一 `npx tsc --noEmit --strict --target es2022 --module esnext <文件>`；没跑过的标明。

## 函数类型表达式与箭头：两套语法，一套规则

`=>` 在类型里是**类型符号**，不是箭头函数：

```ts
type Compare = (a: number, b: number) => number;
type Handler = (event: { id: string }) => void;
type Async = (id: string) => Promise<Handler>;    // 返回类型本身是函数类型
```

值世界三种写法只差在 `this`：`const c1: Compare = function (a, b) { return a - b; };`（有自己的 `this`）、`const c2: Compare = (a, b) => a - b;`（箭头，没有自己的 `this`）、`function c3(a: number, b: number): number { return a - b; }`。

**箭头函数一旦赋给某个函数类型，参数就不必写类型**——TS 从标注方向反推（上下文类型，第 7 章主体）：`[1, 2, 3].map((n) => n * 2)` 里 `n` 是 `number`，没人给它注解。反过来，独立存在的箭头函数没有推断来源，参数隐式 `any`，`--strict` 下报 `TS7006: Parameter 'n' implicitly has an 'any' type.`。手感一句话：**给回调加标注就省掉参数类型；不加标注就得自己写全。**

## 返回值标注：省掉的代价有两个方向

```ts
function parseFlag(raw: string) {           // 推断成 boolean | null：太宽
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}
const flagA: boolean = parseFlag("1");

type ShapeB = { kind: "circle"; r: number } | { kind: "square"; a: number };
function areaInferred(s: ShapeB) {          // 推断成 3 | 4：太窄
  switch (s.kind) {
    case "circle": return 3;
    case "square": return 4;
  }
}
const revealC: never = areaInferred({ kind: "circle", r: 1 });
```

```text
.scratch/ts-ch5-fns.ts(7,7): error TS2322: Type 'boolean | null' is not assignable to type 'boolean'.
.scratch/ts-extra-fns.ts(28,7): error TS2322: Type '3 | 4' is not assignable to type 'never'.
```

两条分别是 `flagA` 和 `revealC` 的报错。第一条说明 `boolean | null` 本身没错，但作为对外 API 它是个未兑现的承诺，调用方被迫处理 `null`。第二条说明返回类型是 `3 | 4` 而不是 `number`——今天能编译，明天把 `return 4` 改成 `return 5`，所有把这个结果当 `3 | 4` 用的下游全炸。

**这就是「导出的 API 必须写返回值」的三条理由**：**① 签名是契约，实现不是**——写了 `: number`，实现怎么重构都不破坏调用方；不写，返回类型是实现的副产品，随重构漂移。**② 跨模块时可读性归零**——悬停提示里那串 `{ value: Promise<string> } | undefined` 没人读得下去，显式返回类型就是文档。**③ 推断只在同一编译单元里免费**——类型一旦进入产物，一处实现改动引发的变化会分散在你根本没碰的文件里报错。判断线只有一条：**这个函数有没有跨文件被调用。**

一条实测补充：判别字段写全的 `switch` 不配 `default` 也能过「必须有返回值」检查（`function areaNoDefault(s: ShapeB): number` 只有两个 `case`，零报错——控制流分析认定末尾不可达）。但新增一个 `kind` 时它立刻变成「返回值可能是 undefined」一族问题，穷尽检查仍要主动配（第 3 章 `assertNever`）。

## 参数规则：可选、默认、剩余，以及 `undefined` 与 `?` 的差别

两条语法硬规矩实测：`function wrongOrder(a?: number, b: number)` 报 `TS1016: A required parameter cannot follow an optional parameter.`；`function badRest(...xs: number[], y: number)` 报 `TS1014: A rest parameter must be last in a parameter list.`（均带 `.scratch/ts-ch5-fns.ts(33,33)` / `(34,18)` 位置）。

可选参数与「类型是 `| undefined`」在能传什么上一样，在**能不能不传**上不一样：

```ts
function greet(name?: string, word = "hi"): string { return word + "," + (name ?? "you"); }
greet();                    // 合法
greet(undefined, "hello");  // 合法：可选参数位置可以显式传 undefined
function greetReq(name: string | undefined): string { return name ?? "x"; }
greetReq();                 // TS2554: Expected 1 arguments, but got 0.（实测）
```

即 `?` 管 arity（个数），`| undefined` 管可空性。想强制调用方表态就写 `name: T | undefined`；想允许省略就写 `name?: T`，代价是调用点少一个证据。默认参数 `word = "hi"` 两者兼具：可省，且显式传 `undefined` 会触发默认值。

剩余参数用数组或元组：`declare function pair5(label: string, ...rest: [number, string]): void;` 之下 `pair5("a", 1)` 实测报 `TS2554: Expected 3 arguments, but got 2.`——元组型剩余参数能表达「必须成对」，`number[]` 不能。第 6 章的 `<T extends readonly unknown[]>` 是它的泛型形式。

`?` 出现在**函数类型**上还有一层最易踩的性质：`type FnOpt = (a?: string) => void;` 之下把 `const needArg: (a: string) => void = (a) => { console.log(a.length); };` 赋给 `FnOpt` 实测报 `TS2322: Type '(a: string) => void' is not assignable to type 'FnOpt'.` 加两行缩进：`Types of parameters 'a' and 'a' are incompatible.` / `Type 'string | undefined' is not assignable to type 'string'.`；反向（`(a?: string) => ...` 填 `(a: string) => void`）实测通过。

方向要背下来：**「必选参数」的实现不能顶替「可选参数」的类型**（按 `FnOpt` 调用可能一个都不给，`a.length` 就在 `undefined` 上炸）；反向合法。这与第 4 章「宽到窄可以、窄到宽不行」是同族规则。

## 返回值可赋值性的三条规则（`void` 与 `never`）

第 2 章说 `void` 只出现在返回位置，这里给精确版本，全部实测：

```ts
type MakesNumber = () => number;
type MakesVoid = () => void;
const okAnyReturn: MakesVoid = () => 42;                  // ① 通过
[1, 2].forEach((n) => n * 2);                             // ① 通过（最有迷惑性）
const badVoid: MakesNumber = () => { return; };           // ② 报错
function neverFn(msg: string): never { throw new Error(msg); }
const neverToNumber: (msg: string) => number = neverFn;   // ③ 通过
const neverAsNumber: () => number = neverFn;              // ④ 报错，但不是因为 never
```

② 的文案是 `TS2322: Type '() => void' is not assignable to type 'MakesNumber'.` 加一行 `Type 'void' is not assignable to type 'number'.`；④ 的文案是 `TS2322: Type '(msg: string) => never' is not assignable to type '() => number'.` 加一行 `Target signature provides too few arguments. Expected 1 or more, but got 0.`

**① 目标返回类型是 `void` 时，源返回什么都不管。** 这条为回调而设计，副作用是**类型系统拦不住「这个回调本该返回值」**：`array.every((x) => { x.ok })` 漏了 `return`，编译干净、逻辑永远假。防线是 ESLint 的 `array-callback-return`（[代码规范](/frontend-engineering/lint-and-format)），属于第 1 章「TS 抓不到什么」清单的又一条。**② `void` 返回的函数不能顶替期望有返回值的函数**——「void 函数可以赋给任何函数类型」是把方向记反了。**③ `never` 返回的函数可以顶替任何返回类型**（`never` 是底类型，第 3 章）。**④ 但参数个数是独立的一道关**：④ 那条返回类型那关过了、栽在 arity——读报错时别被「看着像返回值问题」的文案骗走。

## 参数个数与方向：回调为什么能少写参数

一句话：**实现可以比类型少写参数（多余的用不上），不能多写（多出来的没人给）。** `type TwoArgs = (n: number, i: number) => string;` 之下 `const fewer: TwoArgs = (n) => String(n);` 实测通过，`const more: TwoArgs = (n, i, extra: string) => "" + n + i + extra;` 实测报两条：

```text
.scratch/ts-ch5-fns.ts(43,7): error TS2322: Type '(n: any, i: any, extra: string) => string' is not assignable to type 'TwoArgs'.
  Target signature provides too few arguments. Expected 3 or more, but got 2.
.scratch/ts-ch5-fns.ts(43,24): error TS7006: Parameter 'n' implicitly has an 'any' type.
```

第二条是连锁：可赋值性失败后**上下文类型不再供给参数**，`n`、`i` 于是隐式 `any`。看到「多余参数报错 + 紧跟 TS7006」，问题在前者，别去给 `n` 补注解。这就是 `map((n) => ...)`、`filter(() => true)`、`forEach((_, i) => ...)` 全都合法的原因。

参数**类型**的方向与返回值相反（逆变，contravariance），记法：**返回值看「实现给得够不够」，参数看「实现吃不吃得下」。** 检查来自 `strict` 里的 `strictFunctionTypes`。

```ts
declare const el: HTMLElement;
el.addEventListener("click", (e) => { console.log(e.clientX); });      // e: MouseEvent，通过
el.addEventListener("click", (e: Event) => { console.log(e.type); });  // 通过：宽参数顶替窄参数
const wideHandler: (e: Event) => void = (e: MouseEvent) => { console.log(e.clientX); };  // 报错
```

```text
.scratch/ts-ch5-fns.ts(89,7): error TS2322: Type '(e: MouseEvent) => void' is not assignable to type '(e: Event) => void'.
  Types of parameters 'e' and 'e' are incompatible.
    Type 'Event' is missing the following properties from type 'MouseEvent': altKey, button, buttons, clientX, and 23 more.
```

<Callout type="unverified" title="方法语法与函数属性语法的宽松度差别：本站未实测">

常见说法是接口里写成方法 `run(n: number): string` 的参数按**双变（bivariant）**处理（历史兼容），写成属性 `run: (n: number) => string` 才受 `strictFunctionTypes` 约束。差异确实存在，但本站没跑过对照，不保证在你的版本上表现一致；要用它就自己构造一对 `A` 赋给 `B`、`B` 赋给 `A` 各试一次。

</Callout>

## 重载：写法、顺序，以及为什么优先联合与泛型

语法是**多写签名、只写一个实现**，实现签名不参与对外检查：

```ts
function fmt(v: number): string;
function fmt(v: string): string;
function fmt(v: number | string): string { return String(v); }
fmt(true);
```

```text
.scratch/ts-ch5-fns.ts(74,24): error TS2769: No overload matches this call.
  Overload 1 of 2, '(v: number): string', gave the following error.
    Argument of type 'boolean' is not assignable to parameter of type 'number'.
  Overload 2 of 2, '(v: string): string', gave the following error.
    Argument of type 'boolean' is not assignable to parameter of type 'string'.
```

重载没有「最可能的那个」，所以 TS 逐个说明失败原因；每条都指向同一个位置时，是类型不在候选集里（补重载或改联合）。

**顺序即优先级，第一个能匹配的用。** 宽签名写前面会永久挡住窄的：`function pickTwo(v: unknown): string;` 写在 `function pickTwo(v: number): number;` 前面时，`const wrongOrderRet: number = pickTwo(1);` 实测报 `TS2322: Type 'string' is not assignable to type 'number'.`——这条报错看着像「返回值写错」，实际原因是顺序。**写重载永远把窄的放前面。**

为什么不推荐重载作首选：多数重载想表达「输入类型决定输出类型」，那是泛型 + 条件类型（第 6、8 章）的职责。三种表达「数字或字符串都转成字符串」：重载要每加一种输入加一行签名；`function echo(v: number | string): string` 用联合参数 + 内部 `typeof` 收窄（**默认选它**：签名只有一份不会顺序错，报错能定位到具体字段而不是「2 个重载都不匹配」）；只有当**输出类型由输入类型决定**时才写 `<T extends number | string>(v: T): T`。**还该用重载的只剩两类**：arity 不同的 API（`get()` 全量 / `get(key)` 单值，联合表达不了「没传参」）；给第三方库补声明（第 9 章）。

## `this` 参数与 `noImplicitThis`

`this` 在类型里是**一个假名字的首位参数**，用来声明「这个函数要求什么样的 this」：

```ts
function getId(this: { id: string }) { return this.id; }
const obj5 = { id: "o1", getId };
const lost = obj5.getId;
lost();     // TS2684: The 'this' context of type 'void' is not assignable to method's 'this' of type '{ id: string; }'.（实测）
```

没有 `this` 注解时由 `noImplicitThis`（`strict` 的一部分）报警：`function looseThis() { return this.id; }` 实测 `.scratch/ts-extra-fns.ts(35,31): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.`

<Callout type="verified" title="编译通过、运行时崩：从对象字面量摘出方法（tsc 5.9.3 + Node v25.4.0，2026-10-17）">

```ts
const widget = { id: "w1", show() { return this.id; } };
const detached = widget.show;
detached();      // 实测：tsc 对这一行零提示
```

`npx tsc --noEmit --strict --target es2022 --module esnext` 整段无任何报错。用 Node 跑同一段：

```text
$ node .scratch/run-detached.ts
detached() 抛错 -> TypeError: Cannot read properties of undefined (reading 'id')
call 回来 -> w1
```

① 从**对象字面量**摘出的方法，其 `this` 不进入检查范围，TS 放行；② 运行时 `this` 是 `undefined`，当场崩；③ 修法是绑回去（实测 `detached.call(widget)` 拿到 `w1`）或改箭头函数。**只有写了 `this` 参数注解，TS 才在编译期拦住这件事**（那条 `TS2684`）。这与 [javascript.info 的闭包与 this](/javascript/functions-and-scope) 是同一件事，类型擦除后 `this` 规则一点没变。

</Callout>

## `bind` / `call` / `apply` 的类型

`declare function annotate(n: number, unit: string): string;` 之下 `const boundUnit = annotate.bind(null, 1);` 的真实类型，用 `const revealBind: never = boundUnit;` 揭露，实测文案是 `.scratch/ts-extra-fns.ts(32,7): error TS2322: Type '(unit: string) => string' is not assignable to type 'never'.`

**`bind` 会把已绑定的参数从签名里移除**，所以 `boundUnit("px")` 合法，而 `annotate.bind(null, "px")` 报 `TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`。`call` 直接给返回值，`apply` 按数组**逐位**核对——`annotate.apply(null, ["ms", 3])` 实测两个位置各报一条：

```text
.scratch/ts-ch5-fns.ts(66,52): error TS2322: Type 'string' is not assignable to type 'number'.
.scratch/ts-ch5-fns.ts(66,58): error TS2322: Type 'number' is not assignable to type 'string'.
```

实践含义：给 `apply` 传 `unknown[]` 会失败，可变参数场景优先写展开调用 `annotate(...args)`。

## `: never` 与断言函数

`throw` 型工具函数（`assert`、`fail`、`unreachable`）**必须手写 `: never`**：`function throwsOnly(msg: string) { throw new Error(msg); }` 之后 `const revealA: never = throwsOnly("a");` 实测 `.scratch/ts-extra-fns.ts(3,7): error TS2322: Type 'void' is not assignable to type 'never'.`

**只 `throw` 的函数不写返回类型，推断结果是 `void`。** 后果在控制流：`void` 不参与「之后代码不可达」的推导，也不会让外层函数返回类型收敛——第 3 章 `assertNever(x)` 要求签名是 `never`，就是这个原因。断言函数同理，签名写 `asserts`（`declare function assertOk(v: unknown): asserts v`，返回值只能是 `void`/`never`，不能是 `boolean`），调用点之后的收窄行为第 3 章已实测。

## 异步函数：`Promise<T>` 从哪来

```ts
async function one9() { return 1; }                          // Promise<number>
async function wrapped9() { return Promise.resolve("s"); }   // Promise<string>
async function nested9(p: Promise<string>) { return { value: p }; }   // 嵌套不拍平
async function noReturn9(): Promise<void> {}                 // 通过
async function wrongAnn9(): Promise<string> { return 1; }    // 报错
```

```text
.scratch/ts-ch5-fns.ts(101,7): error TS2322: Type 'Promise<number>' is not assignable to type 'never'.
.scratch/ts-ch5-fns.ts(102,7): error TS2322: Type 'Promise<string>' is not assignable to type 'never'.
.scratch/ts-ch5-fns.ts(95,7): error TS2322: Type 'Promise<{ value: Promise<string>; }>' is not assignable to type 'never'.
.scratch/ts-ch5-fns.ts(97,47): error TS2322: Type 'number' is not assignable to type 'string'.
```

前三条文案分别是 `one9`、`wrapped9`、`nested9` 的真实返回类型，由此得四条规则：`async` 的返回类型永远是 `Promise<...>`；**`return` 一个 Promise 会被拍平**（`await` 语义，所以第二条是 `Promise<string>`）；**拍平只在顶层发生**，Promise 藏在对象或数组里时它还在里面（第三条现场），解法是 `return { value: await p }` 或调用侧 `Promise.all`；把 Promise 当值用实测报 `Type 'Promise<number>' is not assignable to type 'number'.`

标注的专属坑：**`async` 函数要标就标 `Promise<void>`，不能标 `void`**——前者是「返回一个没有值的 Promise」，后者是「不返回」，调用方 `await` 的语义完全不同。这是第 2 章「`void` 不该出现在别的位置」里唯一会写错它的地方。

## 函数作为命名空间，以及装饰器为什么不讲

`function configure(prefix: string): string` 之后写 `namespace configure { export let version = "1.0"; }`，实测 `configure.version` 与 `configure("http://")` 同时合法——函数与命名空间可以合并。但**这是老代码形态**：ES 模块可用之后，「一个函数带一堆附属类型」的正道是命名导出（`export { configure }` + `export type ConfigureOptions`）。`namespace` 编译后产出真实对象，与 ES 模块语义混用容易出现「类型找得到、值运行时不存在」的怪事——读第三方 `.d.ts`（第 9 章）时认得它即可，自己别写。**装饰器本章不展开**：路线是函数式与组合式（第 1 章定调）；实验性语法与 TC39 标准语法两套并存，行为取决于 tsconfig 选项（第 10 章讲 `experimentalDecorators`）；Vue 与 Pinia 不需要它。

## 实操一：类型安全的 `retry`

需求：包一个可能失败的异步任务，重试 N 次、指数退避，**返回值类型跟着任务走**。

```ts
declare function wait(ms: number): Promise<void>;

async function retry<T>(attempts: number, delayMs: number, task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await task();
    } catch (e) {
      lastError = e;
      await wait(delayMs * (i + 1));
    }
  }
  throw lastError;
}
```

四个签名决定各对应本章一条规则：

- `task: () => Promise<T>`。写成 `() => void` 就丢掉返回类型（规则①让任何实现都满足它，你拿不到值）；写成 `Promise<T>` 才能透传，并**顺手挡住同步任务**——`retry(3, 100, () => 5)` 实测 `.scratch/ts-ch5-fns.ts(119,21): error TS2322: Type 'number' is not assignable to type 'Promise<unknown>'.`，报错指向箭头函数返回值那一列。要支持同步任务就加一个泛型或加重载，**别放宽成 `unknown`**。
- `catch (e)` 的 `e` 是 `unknown`（`useUnknownInCatchVariables` 属于 `strict`），所以 `lastError: unknown`，重新 `throw` 不影响签名。
- 调用方类型精确实测，一个实参都不用写：`declare function fetchUser(id: string): Promise<{ id: string; name: string }>;` 之下 `const retriedUser = retry(2, 50, () => fetchUser("u1"))` 的类型是 `Promise<{ id: string; name: string }>`。这是第 6 章「推断优先」的预演。
- 一个诚实边界：这样会重试**所有**异常，包括「参数传错」这种必然失败。真实项目要加 `shouldRetry: (e: unknown) => boolean`，那是策略不是类型问题，见[真实项目中的取舍](/typescript/tradeoffs)。

## 实操二：事件总线

需求：事件名与 payload 形状一一对应，拼错事件名或字段名当场报错。

```ts
type Events = {
  click: { x: number; y: number };
  key: { code: string; shift: boolean };
};
type Listener<K extends keyof Events> = (payload: Events[K]) => void;

declare function on<K extends keyof Events>(name: K, cb: Listener<K>): () => void;
declare function emit<K extends keyof Events>(name: K, payload: Events[K]): void;

on("click", (p) => { console.log(p.x); });   // 通过：p 由 cb 的签名推来
on("click", (p) => { console.log(p.code); });
on("nope", () => {});
```

```text
.scratch/ts-ch5-fns.ts(84,36): error TS2339: Property 'code' does not exist on type '{ x: number; y: number; }'.
.scratch/ts-ch5-fns.ts(85,4): error TS2345: Argument of type '"nope"' is not assignable to parameter of type 'keyof Events8'.
```

`Events` 用 `type` 而不是 `interface`，因为要拿它的 `keyof` 当键表（第 4 章那条规则在此生效）。`(p) => ...` 里 `p` **没写类型**——这就是本章想让你练成的手感：**规则写在类型上，实现里什么都别重复写。**

真实现只要一个映射类型当存储（映射类型第 8 章正式讲）：

```ts
type Store = { [K in keyof Events]: Array<Listener<K>> };

function createBus() {
  const store: Store = { click: [], key: [] };
  function on<K extends keyof Events>(name: K, cb: Listener<K>): () => void {
    store[name].push(cb);
    return () => {
      const at = store[name].indexOf(cb);
      if (at >= 0) store[name].splice(at, 1);
    };
  }
  function emit<K extends keyof Events>(name: K, payload: Events[K]): void {
    for (const l of store[name]) l(payload);
  }
  return { on, emit };
}
```

<Callout type="verified" title="这段实现零断言通过，但只有一条写法能通过（5.9.3）">

上面这段 `npx tsc --noEmit --strict --target es2022 --module esnext` **退出码 0，全程没有 `as`**。而我先写的版本把解绑实现成 `store[name] = store[name].filter((l) => l !== cb);`，得到一条层层缩进的报错（摘录）：

```text
error TS2322: Type 'Listener<K>[]' is not assignable to type 'Store[K]'.
  ...Type '"key"' is not assignable to type 'K'.
    '"key"' is assignable to the constraint of type 'K', but 'K' could be instantiated with a different subtype of constraint 'keyof Ev'.
```

区别在于：**往 `store[name]` 里 `push` 一个 `Listener<K>` 安全，把新数组整体赋回 `store[name]` 不安全**——TS 无法证明泛型槽位能被某个具体 `K` 的结果填。遇到 `could be instantiated with a different subtype` 这句（第 6 章还会撞见），改成就地修改（`push`/`splice`）而不是重新赋值，比加断言好。

</Callout>

自定义总线只该用于应用内消息；DOM 层的事件表 `addEventListener` 已经自带（前面 `HTMLElement` 的实测就是它的效果），别和 DOM 事件混用（[DOM 操作与事件系统](/javascript/dom-and-events)）。

## 常见错误与排查

1. **回调多写参数，`TS2322` 外加一串 `TS7006`**（`Target signature provides too few arguments.`，实测）。可赋值性失败导致上下文类型停止供给；删掉用不上的参数，而不是给它们补类型。
2. **把「`void` 函数可以顶替任何函数」当规则**：`Type 'void' is not assignable to type 'number'.`（实测）。真相是反方向成立。
3. **可选参数写成 `| undefined` 后调用点必须传参**：`TS2554`（实测）。`?` 管个数、`| undefined` 管可空。
4. **必选参数的实现去填可选参数的类型**：`Types of parameters 'a' and 'a' are incompatible.`（实测）。实现改 `a?: string`，或把类型里的参数标成必选。
5. **`this` 丢绑定编译通过**：TS 零提示，运行时 `TypeError: Cannot read properties of undefined`（实测）。箭头函数捕获或 `.call`/`.bind` 绑回；想让 TS 帮查就写 `this: 形状`。
6. **重载顺序写反**：传了 `number` 而返回类型是 `string`（实测）。窄到宽排序，或改联合参数 + 收窄。
7. **`throw` 型函数忘写 `: never`**：`Type 'void' is not assignable to type 'never'.`（实测）、`assertNever` 不生效。
8. **嵌套 Promise 不拍平**：`Promise<{ value: Promise<string> }>`（实测）。`await` 后再放进对象，或调用侧 `Promise.all`。`async` 函数标成 `void` 同理要改成 `Promise<void>`。

## 练习

<Exercise title="练习 1 · 判断这四行能不能过编译" difficulty="基础">

逐行判断并说明依据本章哪条规则：

```ts
type Filter = (s: string, index: number, arr: readonly string[]) => boolean;
const f1: Filter = (s) => s.length > 0;
const f2: Filter = (s, i, arr, extra: string) => s.length > i + arr.length + extra.length;
const f3: Filter = (s: string) => true;
type Maker = () => number;
const m1: Maker = () => { console.log("no return"); };
```

<template #answer>

- `f1` **通过**：实现比类型少写参数（实测同构写法零报错）。
- `f2` **报错**：`Target signature provides too few arguments. Expected 4 or more, but got 3.`，并紧跟 `s`、`i`、`arr` 三条 `TS7006`（实测的连锁形态）。
- `f3` **通过**：与 `f1` 只差在**有没有写参数类型**——写了不错，只是冗余。
- `m1` **报错**：`Type 'void' is not assignable to type 'number'.`（实测）。**这是本题的陷阱**：规则①是「目标为 `void` 时收任何返回」，不是「实现可以不给返回」。真正「漏 `return` 也编译通过」的是目标本来就是 `void` 的回调（`.every()`、`.forEach()`），那才需要 lint 补漏。

</template>

</Exercise>

<Exercise title="练习 2 · 三个需求各写一个签名" difficulty="基础">

① `formatPrice`：金额必传，货币可不传（默认人民币）。② `setNote`：内容必须显式传，允许 `null` 表示清空。③ `log`：接受任意个数字。各配一行合法调用与一行非法调用，并说明非法那行的报错码。

<template #answer>

```ts
function formatPrice(cents: number, currency: "CNY" | "USD" = "CNY"): string {
  return currency === "CNY" ? (cents / 100).toFixed(2) + "元" : "$" + (cents / 100).toFixed(2);
}
formatPrice(1200);
formatPrice(1200, "EUR");   // TS2345：字面量不在联合里

function setNote(content: string | null): void { console.log(content); }
setNote(null);
setNote();                  // TS2554: Expected 1 arguments, but got 0.（实测同款）

declare function log(...nums: number[]): void;
log(1, 2, 3);
log(1, "2");                // TS2345：string 进不了 number[]
```

取舍在 ②：`content?: string | null` 才能省略，但那就允许「忘记表态」，清空语义丢失；`string | null` 强制显式写 `null`。③ 若要固定成对，写元组型剩余参数 `(...nums: [number, number])`。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造报错：读懂重载文案与 bind 的 arity" difficulty="进阶">

① 造一次调用，让报错同时出现两条 `gave the following error`，解释 TS 为什么列两个。② 你的代码报 `Expected 1 arguments, but got 2`，而你以为 `bind` 之后还要传两个参数——写出正确版本并说明依据。

<template #answer>

① 最小复现就是本章 `fmt(true)`，原文已在重载一节完整粘贴：两条 `gave the following error` 分别对应两个签名的失败原因——重载没有「最可能的那个」，TS 不知道你想用哪个签名，只能逐个说明。

② 你把已 `bind` 的结果按原签名调用了：`const bound = annotate.bind(null, 1);` 之下 `bound(2, "px")` 报 `TS2554: Expected 1 arguments, but got 2.`，正确写法是 `bound("px")`。依据是本章实测那条：`bind` 之后的类型是 `(unit: string) => string`，**已绑定参数从签名移除**。若报的是 `Expected 2 arguments`，那不是在 `bind`，而是 `apply`/展开调用，或者函数写了 `this` 参数注解把首位算进了 arity。

</template>

</Exercise>

<Exercise title="练习 4 · 联合、重载、泛型哪种表达得动" difficulty="挑战">

需求：`pickFields(obj, keys)`，传 `["name"]` 时结果类型只含 `name`。先用「联合 + 收窄」的思路试，说明它为什么做不到；再写出泛型签名，并指出返回类型靠什么语法表达。禁止 `any`、`as`。

<template #answer>

联合思路 `declare function pickFields(obj: User, keys: ("name" | "age")[]): Partial<User>;` 编译通过，但返回类型是 `Partial<User>`——传 `["name"]` 之后 `age` 仍是 `age?: number`，还得判空。**联合只约束输入取值范围，表达不了「输入决定输出形状」**；重载同样不行（要为每种键组合写一行）。

泛型版 `declare function pickFields2<T, K extends keyof T>(obj: T, keys: K[]): { [P in K]: T[P] };` 有两个要素：`K extends keyof T` 让键只能是真实存在的键（拼错会得到本章实测的 `TS2345 ... not assignable to parameter of type 'keyof Events8'` 同族报错，第 6 章正式讲）；`{ [P in K]: T[P] }` 是**映射类型**，才是「输出形状由输入键集合决定」的表达（本章 `Store` 用的就是它）。内置 `Pick<T, K>` 是现成版本，第 8 章逐字讲。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Functions（Handbook 2）](https://www.typescriptlang.org/docs/handbook/2/functions.html) —— 本章骨架来源，逐节核实：[函数类型表达式](https://www.typescriptlang.org/docs/handbook/2/functions.html#function-type-expressions)、[可选参数与默认值](https://www.typescriptlang.org/docs/handbook/2/functions.html#optional-parameters-and-defaults)、[重载](https://www.typescriptlang.org/docs/handbook/2/functions.html#overloads)、[`void` 返回的特殊性](https://www.typescriptlang.org/docs/handbook/2/functions.html#void)（对照规则①②③）与[断言函数](https://www.typescriptlang.org/docs/handbook/2/functions.html#assertion-functions)。[Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) 用来核实官方「不要主动给回调参数加类型」。
- [`noImplicitThis`](https://www.typescriptlang.org/tsconfig/#noImplicitThis) 与 [`strictFunctionTypes`](https://www.typescriptlang.org/tsconfig/#strictFunctionTypes) —— 核实 `TS2683`/`TS2684` 对应的开关，以及「函数类型参数逆变、方法声明双变」这条本站标为 unverified 的规则。
- [MDN `Function.prototype.bind`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind) —— 核实运行时行为（部分应用、`this` 永久绑定），与实测的「已绑定参数从签名移除」对照；[ESLint `array-callback-return`](https://eslint.org/docs/latest/rules/array-callback-return) —— 核实「目标 `void` 不检查返回值」造成的漏 `return` 与其唯一防线。
- 版本提示：`bind` 的部分应用类型、`TS2683`/`TS2684`/`TS2769`/`TS1014`/`TS1016` 文案、throw-only 函数推断成 `void` 均来自本机 5.9.3；推断细节会随版本变化，核对入口是[发行说明总览](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html)。

## 下一章

函数签名解决「一个操作要什么、给什么」，但真实工具函数（本章的 `retry`、总线的 `on`）都不该把自己绑死在具体类型上——它们靠一个 `<T>` 同时服务所有类型。下一章 [泛型](/typescript/generics) 从一份「复制粘贴五遍」的坏例子开始。
