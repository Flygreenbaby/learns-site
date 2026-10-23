# 为什么需要类型：错误什么时候暴露，编译后类型去了哪里

一段代码本地跑得好好的，上线后页面某块区域变成空白。查下去发现后端字段叫 `created_at`，前端读的是 `createdAt`——JavaScript 不为这件事报错，它只安静地给你一个 `undefined`，你把它拼进模板，用户看到空白格。这类故障的共同点是：**错误发生在写代码那一刻，暴露却在几小时后的运行时**。

类型系统只做一件事——把暴露时间提前到你敲下最后一个字符。所以学 TS 的两个极端误区是：把类型当语法糖背下来，标注写得满满当当、运行时该崩的一样崩；或者反过来，觉得类型反正会被擦掉，写不写无所谓。这一章讲清三条机制：**检查发生在什么时候**、**类型编译后去哪了**、**兼容规则看名字还是看形状**。理解这三条，后面十章的每个语法你都能自己推出该不该写。主线先放在这里：**类型通过 ≠ 逻辑正确。**

本章结论全部本机实跑：TypeScript **5.9.3**（`npx tsc --version` → `Version 5.9.3`）+ Node v25.4.0，日期 2026-10-17。引用的报错都是原样粘贴（含路径与行列号），没跑过的一律标 `unverified`。

## 五个只能等到运行时才暴露的错误

**场景 1：字段名拼错**（最高频）与**场景 2：函数有时返回 `null`，调用方漏判空**。下面就是本机跑的那份文件（注释行也计入行号）：

```ts
// case 1: 后端字段名与前端读取名不一致
interface OrderDto {
  id: number;
  created_at: string;
  amount: number;
}

function renderOrder(order: OrderDto) {
  return order.createdAt;
}

// case 2: 函数有时返回 null，调用方漏判
function findUser(id: number): { name: string } | null {
  return id > 0 ? { name: "张三" } : null;
}

function greet(id: number) {
  const u = findUser(id);
  return "你好，" + u.name;
}
```

<Callout type="verified" title="场景 1 与 2 的报错文案是本机实跑结果">

```text
$ npx tsc --noEmit --strict --target es2022 --module esnext .scratch/ts-ch1-errors.ts
.scratch/ts-ch1-errors.ts(9,16): error TS2551: Property 'createdAt' does not exist on type 'OrderDto'. Did you mean 'created_at'?
.scratch/ts-ch1-errors.ts(19,18): error TS18047: 'u' is possibly 'null'.
（退出码 2）
```

`TS2551` 是「疑似拼错」的专用码（普通「属性不存在」才是 `TS2339`）。读报错的顺序：**第一行看位置与类型名，缩进的行看哪个成员不兼容**——这项能力比记十个语法点值钱。

</Callout>

**场景 3：两个参数同为 `string`，顺序写反**（`rename("新名字", "旧名字")`）；**场景 4：数组下标越界**（`tags[0].toUpperCase()`，空数组时崩）。这两段就在同一个文件的后半部分，而上面那次运行只有两行输出——**「没报错」本身也是实测结果**。

**场景 5：用 `as` 骗过编译器**，编译零错误、运行时崩：

```ts
const cfg = { retries: 3 } as { retries: number; timeout: number };
console.log("超时毫秒：", cfg.timeout.toFixed(2));
```

<Callout type="verified" title="场景 5：tsc 零错误，Node 里照样崩">

`npx tsc --noEmit --strict --target es2022 --module esnext .scratch/ts-ch1-as.ts` → **退出码 0，一行错误都没有**；编译成 JS 后 Node v25.4.0 执行：

```text
TypeError: Cannot read properties of undefined (reading 'toFixed')
    at file:///D:/work/learns/.scratch/out2/ts-ch1-as.js:2:34
```

`as` 不是检查，是**命令编译器闭嘴**——这就是「类型通过 ≠ 逻辑正确」最直接的证据。

</Callout>

前两类错误提前到编辑器，后三类不会。**TS 的能力边界就在这条线上**，[真实项目中的取舍](/typescript/tradeoffs) 整章在讲它。

## 检查发生在什么时候：编辑器、命令行、构建是三件事

类型检查器是独立运行的程序：读源码和 `.d.ts`，输出错误列表，不参与执行——代码跑起来时它早就下班了。同一次检查在三处发生，混为一谈就会出现「IDE 明明标红了，构建却过了」。

| 谁在检查 | 何时 | 会不会挡住发布 |
| --- | --- | --- |
| 编辑器语言服务（VS Code 内置 tsserver） | 你打字时 | 不会，只是提示 |
| `tsc` / `tsc --noEmit` | 你或 CI 主动执行 | 取决于有没有跑它 |
| 打包器（Vite、webpack、esbuild） | dev / build 时 | **默认不做类型检查** |

<Callout type="verified" title="tsc 报错时仍会输出 JS，两种忽略注释行为不同">

```text
$ npx tsc --strict --outDir .scratch/out11 --target es2022 --module esnext .scratch/ts-ch1-ignore.ts
.scratch/ts-ch1-ignore.ts(6,3): error TS2578: Unused '@ts-expect-error' directive.
（退出码 2，但 .scratch/out11/ts-ch1-ignore.js 照样生成）
```

那份文件里 `@ts-ignore` 压住了 `const y: number = x;` 的真实错误——把注释去掉单独跑，输出是 `.scratch/ts-ch1-ignore2.ts(2,9): error TS2322: Type 'string' is not assignable to type 'number'.`。`@ts-expect-error` 只在下一行确实有错时才安静，错消失后它自己反过来报 `TS2578`。**要压就用后者**；本站练习两个都禁用。另外默认 `tsc` 是「报错但照产」：拦住产物要开 `noEmitOnError`（见 [tsconfig 关键选项](/typescript/tsconfig)），CI 里更常见的做法是单独跑 `tsc --noEmit`，用退出码决定成败（见 [测试体系](/devops/testing)）。

</Callout>

## 类型擦除：编译后的 JS 里类型全部消失

TS 是 JavaScript 的超集，实现方式是在编译阶段把类型标注**全部删掉**，产物是纯 JS——这叫类型擦除（type erasure）。下面是本机跑的真实输入与产物（原样）：

```ts
interface User { id: number; name: string }
type Role = "admin" | "guest";
function describe<T>(value: T, label: string): string {
  return label + ": " + String(value);
}
const u = { id: 1, name: "阿丽" } satisfies User;
const role: Role = "admin";
console.log(describe<User>(u, role));
```

```js
function describe(value, label) {
    return label + ": " + String(value);
}
const u = { id: 1, name: "阿丽" };
const role = "admin";
console.log(describe(u, role));
```

`interface`、`type`、`<User>`、`satisfies`、所有 `: string`——**一个字符都没留下**。三条推论：运行时没有任何类型信息可查（想知道一个 `unknown` 是什么只能用 `typeof` / `Array.isArray` / `in`，这正是[联合类型与收窄](/typescript/unions-and-narrowing)存在的理由）；接口与类型别名不产生任何代码；**后端 JSON 和你的类型定义之间没有任何约束关系**，兑现假设只能自己写校验。

**例外：少数语法确实生成运行时代码。** 同一份产物里，`enum Status` 变成了：

```js
var Status;
(function (Status) {
    Status["Open"] = "open";
    Status["Done"] = "done";
})(Status || (Status = {}));
```

| 语法 | 擦除后 | 运行时代码 |
| --- | --- | --- |
| `interface` / `type` / 泛型参数 / 标注 / `satisfies` / `declare` / `import type` | 完全消失 | 无 |
| `enum` | **保留** | 对象 + IIFE，真值，进包体积 |
| 参数属性 `constructor(private readonly baseUrl: string)` | **保留语义** | 字段声明 + `this.baseUrl = baseUrl` |
| `readonly` 修饰符 | 消失 | 无——它不阻止运行时写入，真要冻结用 `Object.freeze` |

## 结构化类型：兼容看形状，不看名字

TS 判断「A 能不能当 B 用」的规则是**结构化类型（structural typing）**：只看成员形状，**完全不看名字**。Java / C# 用**名义化类型（nominal typing）**——名字不同就是不兼容，必须显式转换或实现同一接口。这是「为什么这都能通过编译」的头号来源。本机实跑（`--strict`）：

```ts
type PointA = { x: number; y: number };
interface PointB { x: number; y: number }

const a: PointA = { x: 1, y: 2 };
const b: PointB = a;   // 通过：名字不同，形状相同
const a2: PointA = b;  // 通过：反方向也通过

interface Named extends PointB { label: string }
const n: Named = { x: 1, y: 2, label: "ok" };
const p: PointA = n;   // 通过：多一个属性照样兼容
```

这几行赋值**零错误**（同一份文件里唯一报错的是下面 `brand` 那段）。帮你的地方：写适配器与测试替身不必 `implements` 任何东西，形状对得上就能把自写的假对象传进去。害你的地方：**形状相同、语义不同的类型自由互串**——`User` 和 `Company` 都是 `{ id: number; name: string }` 时，把用户 ID 传给要公司 ID 的函数，编译器一声不吭。第 4 章[对象类型与接口](/typescript/objects-and-interfaces) 会把这个规则用到极致。

社区通行的缓解办法是 **brand 技巧**（用一个不存在的字段把类型标记成唯一，从而在效果上模拟名义化）。**这是社区做法，不是官方手册里的语言特性**，可读性有代价：

```ts
// brand 简化写法（字符串字段）
type UserId = string & { readonly __brand: "UserId" };
type OrderId = string & { readonly __brand: "OrderId" };
declare function parseUserId(raw: string): UserId;
declare function sendOrder(id: OrderId): void;
const uid = parseUserId("u_1");
sendOrder(uid);
```

<Callout type="verified" title="brand 技巧的报错文案（实跑）">

```text
$ npx tsc --noEmit --strict --target es2022 --module esnext .scratch/ts-ch1-brand.ts
.scratch/ts-ch1-brand.ts(7,11): error TS2345: Argument of type 'UserId' is not assignable to parameter of type 'OrderId'.
  Type 'UserId' is not assignable to type '{ readonly __brand: "OrderId"; }'.
    Types of property '__brand' are incompatible.
      Type '"UserId"' is not assignable to type '"OrderId"'.
.scratch/ts-ch1-brand.ts(10,7): error TS2322: Type 'UserId' is not assignable to type 'never'.
（退出码 2）
```

第二条来自我在同一份文件里追加的 `const reveal: never = uid;`——它证明 `uid` 的类型确实是 `UserId` 这个**具名交叉类型**，不是普通 `string`。`brand` 只活在类型层，编译后被擦除，运行时零开销；代价是构造 `UserId` 必须经过工厂函数。用 `unique symbol` 作键的加强版我也跑过（`.scratch/ts-ch1-struct.ts(31,11)`），报错文案同形。

</Callout>

## 类型能抓到和抓不到的

| 抓得到 | 抓不到 |
| --- | --- |
| 属性名拼错、漏判 `null` / `undefined` | **同为 `string` 的参数被写反**、数组越界 |
| 参数个数不符、对象缺字段、返回类型不符 | `as`、`any`、`@ts-ignore` 覆盖的位置 |
| 改名漏改的调用点、分支漏处理 | **外部数据**（JSON、表单、`localStorage`）与一切逻辑错误 |

两个容易被高估的点。**`any` 泄漏**：一个值一旦是 `any`，它流经的每个位置都不再检查，而 TS 不给任何提示。**数组越界不是「做不到」，是默认没人管**：同一份文件本机对照实跑，默认 `--strict` 退出码 0；加上开关立刻报 `.scratch/ts-ch1-index.ts(5,10): error TS18048: 't' is possibly 'undefined'.`（命令只差 `--noUncheckedIndexedAccess`）。

## TS 项目怎么跑起来：三段最小路径

按要解决的问题选，别一上来配工程：**Playground**（<https://www.typescriptlang.org/play/>）零安装、右侧直接看编译后的 JS，是观察擦除最快的办法，本站第 1 到 8 章的练习都不用 `npm install`；**`tsc`** 是需要跨文件引用、`.d.ts`、CI 检查时的最小形态；**打包器**负责把 `.ts` 变成浏览器能执行的模块图，**类型检查仍然是上一步的工作**。本站路线是 Vite：开发见 [Vite 开发侧](/frontend-engineering/vite-dev)，产物见 [Vite 构建侧](/frontend-engineering/vite-build)。

<Callout type="unverified" title="Vite 不检查类型这一条我没在本机跑">

「`vite dev` / `vite build` 只做转译、不做类型检查，所以必须额外跑 `tsc --noEmit`」是社区普遍说法。**我没有在这台机器上建 Vite 项目跑过一次带类型错误的构建**，故标未核实。到第 9、10 章建项目时自己验证一次：故意留一个类型错误，跑 `npm run build`，看它是否失败。

</Callout>

## 值得上 TS 的项目：判断清单

| 条件 | 倾向 |
| --- | --- |
| 维护超过半年、要交接，或多人协作、接口字段是主要摩擦源 | 上 |
| 数据形状复杂，或需要 IDE 补全与安全的改名 | 上 |
| 小于 500 行的一次性脚本、纯演示；或运行环境不装 Node | 可不上 |
| 团队没人愿学收窄与推断，准备全靠 `any` | 先学再上 |

**反直觉但重要：** 收益不是线性的。`strict` 关掉的 TS 项目收益接近零——你多写了标注、多配了工具，却把最有价值的一半（判空、隐式 `any`）让掉了。本站所有例子都在 `--strict` 下跑。

## 常见错误与排查

1. **把 TS 当「带类型的 JavaScript 语法」。** 现象：满屏 `const count: number = 0`、`any` 满天飞，结论是「TS 没用」。原因：价值来自形状描述与推断，不来自标注密度。确认：项目里搜 `any`，超过个位数基本就是这个毛病。修：删掉局部标注让 TS 推断，只在函数签名和公共类型上写（第 2 章给实跑对照）。
2. **以为运行时还会替你检查。** 现象：本地「TS 没报错」，线上 `TypeError: Cannot read properties of undefined`。原因：类型擦除，产物里没类型。确认：打开编译后的 `.js` 看那一行。修：外部数据边界做运行时校验（下一章末尾有校验器骨架）。
3. **用 `@ts-ignore` 当解法。** 现象：报错被一行行压掉，半年后同一处崩。原因：它无条件吞错误，且不会在问题消失时提醒你（本章实测 `@ts-expect-error` 会报 `TS2578`）。确认：全局搜 `@ts-ignore`。修：先读报错的缩进结构找不兼容成员；实在要压用 `@ts-expect-error` 并写注释说明原因。
4. **用 `as` 让报错消失。** 现象：编译干净、运行时崩（本章场景 5 的实跑）。确认：搜 ` as `，逐个看上方有没有运行时校验。修：改收窄或改类型定义。
5. **只跑 IDE 不跑命令行检查就发布。** 现象：编辑器标红被忽略、CI 绿。原因：语言服务从不阻断任何东西；`strict` 没开时它连判空都不提示。确认：本地跑一次 `tsc --noEmit` 对比 IDE 提示数，再跑 `npx tsc --showConfig` 看 `strict` 展开结果。修：把 `tsc --noEmit` 做成脚本进 CI（[测试体系](/devops/testing)）。

## 练习

<Exercise title="练习 1 · 预测编译后的 JS 里还剩什么" difficulty="基础">

编译后（`target: es2022`、`module: esnext`）的 JS 里，哪些**还有对应代码**，哪些**完全消失**？先写预测，再去 Playground 右侧对照。

```ts
interface User { id: number; name: string }
type Role = "admin" | "guest";
const role: Role = "admin";
const u: User = { id: 1, name: "阿丽" };
enum Level { Low, High }
declare const magic: number;
function pick<T>(list: T[]): T { return list[0]; }
console.log(role, pick<User[]>([u]), Level.Low, typeof magic);
```

<template #answer>

消失：`interface User`、`type Role`、`: Role` / `: User` / `<T>` / `<User[]>`、`declare const magic`（它只是告诉检查器「有个全局值」，本身不产出代码）。

保留：`const role = "admin"` 与 `const u = {...}`；`function pick(list) {...}`（函数在，泛型参数没了）；**`enum Level`**——生成 `var Level; (function (Level) { Level[Level["Low"]=0]="Low"; ... })(Level || (Level = {}))`，数字枚举还带反向映射，**这是会进包体积的真 JS**（本章 `enum Status` 的产物实测同形）。`typeof magic` 会执行，`magic` 不是真实全局值时得到 `undefined`。

最容易预测错的是 `enum`（以为消失，其实保留）和 `declare`（以为生成代码，其实完全不生成）。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造错误并读懂它" difficulty="基础">

把场景 1 的 `createdAt` 改成 `CreatAt`（大写 C）。① 预测错误码是 `TS2551` 还是 `TS2339`；② 预测是否给 `Did you mean`；③ 本机跑一次对照预测。

<template #answer>

① 预期 `TS2551`（普通「属性不存在」才是 `TS2339`）——TS 找到足够相似的成员时才给这个码。② 预期会给建议，但**文案未必就是 `created_at`**：我实跑的原始案例是 `createdAt` → 建议 `created_at`，`CreatAt` 这一条**我没跑过**，请以你本地输出为准。③ 复现命令：`npx tsc --noEmit --strict 文件名.ts`。

</template>

</Exercise>

<Exercise title="练习 3 · 结构化类型的代价与 brand 修法" difficulty="进阶">

两个类型形状完全一样，传错也编译通过：`type UserId = { value: number }`、`type CouponId = { value: number }`，`declare function getCoupon(id: CouponId): string`，把 `UserId` 传进去不报错。① 说清为什么；② 用 brand 改造使其报错；③ 你的版本在产物里多了什么运行时代码？

<template #answer>

① 结构化类型只看成员形状，两个 `{ value: number }` 形状相同、名字无关，所以双向可赋（本章实跑验证）。

② 把 brand 交叉进对象：

```ts
type UserId = { value: number; readonly __brand: "UserId" };
type CouponId = { value: number; readonly __brand: "CouponId" };
const u: UserId = { value: 7, __brand: "UserId" };
getCoupon(u); // error TS2345
```

报错形态与本章实跑的字符串 brand 版本同构，缩进部分指出 `__brand` 两个取值不兼容。

③ **零运行时代码**——`__brand` 是类型层成员，编译后被擦除，运行时那个对象仍是 `{ value: 7 }`。真实项目里 brand 由工厂函数构造，别让人手写它。

</template>

</Exercise>

<Exercise title="练习 4 · 这三个项目该不该上 TS" difficulty="挑战">

A：一人写的落地页，3 个 HTML + 200 行 JS，上线后不再改。B：内部后台，5 人协作，接口 30 个，字段常年改名，线上事故多是「页面某块空白」。C：npm 上的 JS 库，40k 行存量代码，作者愿意接受 TS，但用户里大量是纯 JS 项目。

<template #answer>

- **A：不上。** 判断清单三条都不满足（生命周期短、单人、形状简单），换不回成本。
- **B：上，而且必须 `strict`。** 「字段改名」+「页面某块空白」正是场景 1 与 2 的形态。落地：新文件先 TS，`tsc --noEmit` 进 CI，别一次性全改。
- **C：先只做类型声明，不改实现。** 40k 行直接迁移风险高；常见路径是保留 JS 实现、提供 `.d.ts`（第 9 章 [模块与声明文件](/typescript/modules-and-declarations)）。

**「上 TS」有两种含义：改实现 vs 提供类型信息。** 混为一谈是很多迁移项目失败的原因；共同依据是收益来自**未来的错误**，不是来自「TS 更现代」。

</template>

</Exercise>

## 官方文档与延伸阅读

- [The TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) —— 核实「TS 是 JavaScript 超集、类型检查发生在编译期」，以及「严格模式说明」对 `strict` 的定义（对照本章本机 `--showConfig` 展开清单）。
- [The Basics](https://www.typescriptlang.org/docs/handbook/2/basic-types.html) —— 核实 `unknown` / `any` / `never` 的定位（对照实测的 `TS18047` 与场景 5 的运行时崩溃）。
- [Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) 的 [字面量类型](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types) 与 [`null` / `undefined`](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#null-and-undefined) —— 核实场景 2 的官方表述。
- [Object Types](https://www.typescriptlang.org/docs/handbook/2/objects.html) 的 [`readonly`](https://www.typescriptlang.org/docs/handbook/2/objects.html#the-readonly-modifier) —— 核实「`readonly` 只是编译期约束」（对照本章擦除产物）。
- [tsconfig 参考](https://www.typescriptlang.org/tsconfig/) 的 [`strict`](https://www.typescriptlang.org/tsconfig/#strict)、[`noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess)、[`noEmitOnError`](https://www.typescriptlang.org/tsconfig/#noEmitOnError) —— 核实越界对照实验与「报错仍出产物」涉及的配置项名与默认值。
- [TypeScript Playground](https://www.typescriptlang.org/play/) 与 [发行说明总览](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html) —— 前者是练习 1 的验证环境，后者是 `enum` / `satisfies` 等版本相关行为的唯一可靠来源。`brand` 技巧是**社区做法**，官方手册无对应章节，故不给官方链接。

## 下一章

本章立了三条地基：检查只在编译期、类型会被擦除、兼容看形状不看名字，并给出主线——**类型通过 ≠ 逻辑正确**。下一章把这些落到最小可用的语法上：原始类型与运行时 `typeof` 的对应、`strictNullChecks` 关掉后丢掉多少检查（同一份文件对照实跑）、`unknown` / `any` / `never` / `void` 四个规则各不相同的类型、元组与字面量类型、`satisfies`，以及最实际的一问：**什么时候该写注解、什么时候该闭嘴让推断做**。学完 [基础类型与类型注解](/typescript/basic-types)，你就能给一个真实 JS 文件加上不多不少的类型。
