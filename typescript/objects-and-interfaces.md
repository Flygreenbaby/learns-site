# 对象类型与接口：给后端返回的 JSON 建一个不骗人的模型

你大概写过这样的接口模型：一个 `interface`，十几个字段，一半带 `?`，因为「不确定后端会不会返回」。然后代码里全是 `data.list?.[0]?.name ?? ""`，判空淹了业务逻辑；而真正会让你崩的那件事——后端把 `avatar_url` 从「不带这个键」改成「返回 `null`」——类型里一点痕迹都没有。对象类型的难点不是语法，而是**把「数据实际长什么样」翻译成类型**：翻译错的症状是编译期一片绿、线上 `undefined` 一片白。

本章结论本机实跑：TypeScript 5.9.3 + Node v25.4.0，2026-10-17，命令统一 `npx tsc --noEmit --strict --target es2022 --module esnext <文件>`，报错原样粘贴；没跑过的单独标明。

## `interface` 与 `type` 的真实差异只有三条

| 能力 | `interface` | `type` |
| --- | --- | --- |
| 描述对象形状 | ✔ | ✔ |
| 同名声明自动合并（declaration merging） | ✔ | ✘ 重名直接失败（`TS2300: Duplicate identifier 'Point'.`） |
| 表达联合、交叉、元组、字面量、条件类型 | ✘ | ✔ |
| 继承多个父类型 / 被 `implements` | ✔ `extends A, B` | ✔ 交叉 / ✔ |

**可扩展性。** 两份同名 `interface` 会合成一个类型：

```ts
interface Account { id: number }
interface Account { email: string }              // 合法，acct 同时要求两个字段
const acct: Account = { id: 1, email: "a@b.c" };
```

这让类型可以**增量补全**：给第三方库补字段（`interface Window { __INITIAL_STATE__?: string }`，见[模块与声明文件](/typescript/modules-and-declarations)）、把大模型按模块拆成几份声明。代价是它按名字合并、不看来源文件：全局作用域里两个文件各写一份 `interface Config`，会静悄悄合成一个类型，报错不会告诉你字段来自哪一份。

**联合与交叉只能用 `type`。** `interface` 说不了「A 或 B」，所以第 3 章的判别联合只能写成 `type Circle = { kind: "circle"; r: number }; type Square = { kind: "square"; a: number }; type Shape = Circle | Square;`。

**报错文案：实测没有差别。**

<Callout type="verified" title="命名 interface、命名 type、匿名对象类型的报错文案（5.9.3）">

```text
.scratch/ts-extra-objs.ts(5,7): error TS2741: Property 'name' is missing in type '{ id: number; }' but required in type 'ReqI2'.
.scratch/ts-extra-objs.ts(6,7): error TS2741: Property 'name' is missing in type '{ id: number; }' but required in type 'ReqT2'.
.scratch/ts-extra-objs.ts(7,7): error TS2741: Property 'name' is missing in type '{ id: number; }' but required in type '{ id: number; name: string; }'.
```

三行分别来自 `interface ReqI2`、`type ReqT2` 和一个匿名内联类型。命名类型（哪个关键字都一样）文案里就是那个**名字**，只有匿名类型才把结构整个展开。**「interface 报错更短」是过时说法，起作用的变量是有没有名字。**

</Callout>

<Callout type="unverified" title="性能差异：本站不背书">

「`interface` 有编译器缓存优化、复杂 `type` 别名更慢」流传很广，原则上有道理，但**本站没做过基准测试**，官方也没把它列为选型依据。真要提速，方向是减少深层条件类型套嵌，而不是把 `type` 全改成 `interface`；自己用 `tsc --diagnostics` 测。

</Callout>

**选择规则就一条：项目内部自己用的形状写 `type`；需要被别人（别的文件、别的包）补充或覆盖的公共契约写 `interface`。** 选错了不用重构——两者结构上完全等价，实测互相赋值零报错。

## 可选属性 `?` 的滥用后果

首页把「一大堆 `?`」列为典型失败模式，机制是：`type Patch = { name?: string }` 之后 `const nameStr: string = patch.name;` 实测报 `TS2322: Type 'string | undefined' is not assignable to type 'string'.`（第二行 `Type 'undefined' is not assignable to type 'string'.`）。

更微妙的是「缺字段」与「值就是 `undefined`」在默认配置下**分不开**：`strictPatch({ name: undefined })`（形参 `Patch`）实测零报错——`exactOptionalPropertyTypes` 不在 `strict` 里，第 10 章讲；反过来形参写成 `{ name: string | undefined }` 时传 `{}` 报 `TS2345 ... Property 'name' is missing in type '{}' but required in type '{ name: string | undefined; }'.`

`?` 用错的三条后果，按严重程度排：**① 判空污染**——每个读取点都要 `?? ""`，「业务上可缺」和「我懒得确认」长得一模一样；**② 丢掉判别联合**——状态写成 `state?: string`，第 3 章那套「不同状态带不同字段」全废；**③ 与契约脱钩**——`?` 的含义是「键会缺席」，后端永远返回但可能是 `null` 的字段应写 `string | null`。

纪律：**新写字段默认不加 `?`**，只有确认过接口文档或真实返回「这个键会缺席」才加。可选属性是证据，不是保险。

## 索引签名与 `Record`：什么时候允许任意键

`type Dict = { [k: string]: unknown }` 接受任意字符串键，`type Mixed = { total: number; [k: string]: unknown }` 是「具名字段 + 兜底键」。具名字段的类型必须**满足**索引签名，否则声明处就报错（实测 `TS2411: Property 'count' of type 'string' is not assignable to 'string' index type 'number'.`，代码是 `type BadIndex = { count: string; [k: string]: number }`）。

`Record<K, V>` 是索引签名的**精确版**：键是有限字面量联合时，它同时要求「每个键都在」和「不许有别的键」，两条都实测过：

```ts
type StatusCodes = Record<"ok" | "err", number>;
const missing: StatusCodes = { ok: 200 };                    // TS2741: Property 'err' is missing ...
const extra: StatusCodes = { ok: 200, err: 500, other: 1 };  // TS2353: ... 'other' does not exist in type 'StatusCodes'
```

这就是第 3 章「穷尽检查在类型层」那个 `Record<Role, X>` 手法的完整版：状态表用 `Record<所有状态, 处理函数>`，漏一个状态编译失败，比 `switch` 漏分支更早，取值只要一行 `stateLabel[u.state]`。

必须知道的限制：`typeof` 收窄出来的 `object` **不能**当字典读（第 3 章撞过同一条码）：

```text
.scratch/ts-ch4-objs.ts(57,7): error TS2322: Type 'object' is not assignable to type 'Dict'.
  Index signature for type 'string' is missing in type '{}'.
```

索引签名是**类型定义层**的声明，不能靠赋值方向绕过。从外部数据取值只有两条正路：`in` 逐层收窄，或在边界处校验后转成明确类型。

## `readonly` 与 `as const` 差在深度和字面量

```ts
type Row = { readonly id: number; label: string };
declare const row: Row;
row.id = 9;                    // TS2540: Cannot assign to 'id' because it is a read-only property.
row.label = "still writable";  // 合法：readonly 只锁你标注的那一层

declare const rows2: readonly Row[];
rows2.push({ id: 1, label: "a" });  // TS2339: Property 'push' does not exist on type 'readonly Row[]'.

const cfg = { api: { url: "https://x" }, retries: 3 } as const;
cfg.api.url = "y";                     // TS2540（实测）：as const 递归到底
const retriesLiteral: 3 = cfg.retries; // 合法：3 成了字面量类型
```

| 维度 | `readonly`（写在类型上） | `as const`（写在值上） |
| --- | --- | --- |
| 谁看得到 | 类型声明，所有持有该类型的地方 | 只有这个表达式的推断结果 |
| 深度 | 标注的那一层 | **递归到底**，含嵌套对象与数组元素 |
| 数组 | 要写 `readonly T[]` 才没有 `push` | 数组变只读元组 |
| 字面量类型 | 不影响（`number` 还是 `number`） | 影响（`3` 变成 `3`） |

`push` 那条文案值得注意：只读数组不是新类型，它就是**没有 `push`/`splice`** 的数组类型。`readonly` 是契约（我不改），`as const` 是定型（值被钉死，第 7 章用它做字面量收窄）。

## 多余属性检查：新鲜度、三种绕法与变量逃逸

`type User4 = { name: string; age: number };` 之下 `const e1: User4 = { name: "a", age: 1, admin: true };` 实测

```text
.scratch/ts-ch4-objs.ts(18,40): error TS2353: Object literal may only specify known properties, and 'admin' does not exist in type 'User4'.
```

规则一句话：**只有「新鲜」（fresh）的对象字面量**检查多余属性。它存在的理由很实在——抓拼错的字段名（`adimin`）、复制粘贴残留。字面量第一次落地之后，值就按结构兼容性走。

```ts
declare function send(u: User4): void;
send({ name: "a", age: 1, admin: true });              // ① 直接传：实测报错（同款 TS2353）
const passed = { name: "a", age: 1, admin: true };
send(passed);                                          // ② 先赋值再传：实测零报错
const typedPassed: User4 = { name: "a", age: 1, admin: true };  // ③ 加注解：又报错
send({ ...passed });                                   // ④ 展开：实测零报错
```

**②「变量先赋值再传」为什么逃逸**：`passed` 的类型是推断出的 `{ name: string; age: number; admin: boolean }`，一个**比 `User4` 更宽**的具名类型，走结构兼容性（宽到窄允许），检查早就不做了。这是最常见的静默丢字段路径：`admin` 传不进 `send` 的实现，类型系统一声不响。③ 说明它不是稳定绕法——下一个人补注解，报错就回来了；④ 展开出的字面量虽然新鲜，属性类型却来自 `passed`，同样放行（专门跑过，整段退出码 0）。

**正经绕法只有一种：改类型。** 参数声明成 `{ name: string; age: number; [k: string]: unknown }`，或在边界处只挑需要的字段转成内部模型（见实操）。`as User4` 也能消音，但那是告诉编译器别管，见[真实项目中的取舍](/typescript/tradeoffs)。

## 结构兼容性：宽到窄可以，窄到宽不行

第 1 章说 TS 是结构化类型系统，它在对象上的完整展开是：**目标类型的每个必需字段你都有、类型都对，就兼容；多出来的字段不管。**

```ts
declare function sendFull(u: { name: string; age: number; admin: boolean }): void;
const wide: { name: string; age: number; admin: boolean } = { name: "w", age: 3, admin: true };
send(wide);                                    // 实测零报错：宽 → 窄
const narrow: User4 = { name: "n", age: 4 };
sendFull(narrow);                              // 实测报错：窄 → 宽
```

```text
.scratch/ts-ch4-objs.ts(30,10): error TS2345: Argument of type 'User4' is not assignable to parameter of type '{ name: string; age: number; admin: boolean; }'.
  Property 'admin' is missing in type 'User4' but required in type '{ name: string; age: number; admin: boolean; }'.
```

三条推论：**① 约束写小更可用**——一个 `ApiUser` 能传给任何只要求 `{ id: string }` 的函数，别为「只用 id」再造类型；**② 名字完全不参与兼容**，想造名义化效果要显式加品牌字段（第 11 章）；**③ 兼容不等于安全**——宽对象进窄签名后多出的字段实现里拿不到，TS 不警告（正是②的成因）。

## 交叉不是「与」：同名字段合并，冲突变 never

`A & B` 读作「既是 A 又是 B」，语义是**字段叠加**，不是逻辑与。正当用法是把公共字段切成小块复用：`type Person4 = User4 & { createdAt: number } & { role: "admin" | "guest" };` 之下 `const p4: Person4 = { name: "p", age: 5, createdAt: 0, role: "admin" };` 实测通过。

陷阱在于同名字段类型冲突时，TS 不报「你交叉错了」，它把那个字段变成 `never`：

<Callout type="verified" title="交叉冲突静默产出 never：读不出也写不进">

```ts
type Both2 = { x: string } & { x: number };
declare const b2: Both2;
const xAsNever: never = b2.x;     // 实测零报错：b2.x 就是 never
const xAsString: string = b2.x;   // 实测零报错：never 可赋给任何类型
const impossible: Both2 = { x: "a" };   // 报错
```

```text
.scratch/ts-extra-objs.ts(14,30): error TS2322: Type 'string' is not assignable to type 'never'.
.scratch/ts-extra-objs.ts(15,30): error TS2322: Type 'number' is not assignable to type 'never'.
```

（写 `{ x: 1 }` 得到第二条，两行成对出现。）`Both2` 声明时零提示，但没有任何值能填进 `x`。症状是某字段凭空变 `never`、下游炸一串不相干报错。**排查办法：把交叉拆开逐个 `type` 试，冲突一露即知。** 别用交叉「覆盖」同名字段类型（要覆盖用 `Omit` + 新类型，第 8 章）；可选与非可选同名会合并成非可选（`{ a?: string } & { a: string }` 得 `a: string`），别把这种巧合当设计。

</Callout>

## `unknown`、`object`、`Record<string, unknown>` 是三件事

| 类型 | 能做什么 | 用途 | 实测限制 |
| --- | --- | --- | --- |
| `unknown` | 必须先收窄再碰 | 外部数据入口（`JSON.parse`、`localStorage`） | 任何值都能传（它是顶层类型） |
| `object` | 没有任何成员可用 | 几乎不该出现在业务代码里 | `TS2345: Argument of type 'number' is not assignable to parameter of type 'object'.` |
| `Record<string, unknown>` | 可按键读，值仍未知 | 键随机的字典：查询参数、埋点属性 | `typeof` 收窄的 `object` 不能赋给它（前面那条） |

想把任意 JSON 当字典读，就在类型上**把索引签名写出来**，并在边界处用校验器（第 3 章）把值放进来，而不是指望 `object` 自动获得索引签名。

## 嵌套、数组与「越界读不报错」

内层抽成命名类型（报错文案短）比就地嵌套好读：`type ListResp = { items: Todo9[]; page: number; total: number };`

一个盲区必须现在知道：默认 `strict` **不含** `noUncheckedIndexedAccess`，所以 `resp.items[0]` 的类型是 `Todo9`，不是 `Todo9 | undefined`——实测 `const firstTodo: Todo9 | undefined = todos9[0]` 与 `const first: number = arr10[0]` 都零报错（整段退出码 0）。空数组时它是运行时 `undefined`，**越界读是类型系统的盲区，判空要自己写**，或者开那个选项（代价见第 10 章）。同理，`readonly` 与 `?` 都只作用一层，嵌套对象里的字段照旧可改。

## `interface extends` 与 `class implements`

```ts
interface Named { name: string }
interface Person4b extends Named { age: number }
interface Staff extends Person4b { badge: string }
class Teacher implements Staff { name = "t"; age = 30; badge = "B1" }
const staffBad: Staff = { name: "s", age: 1 };   // TS2741: Property 'badge' is missing ...
```

`extends` 是形状叠加、可以多继承；`type StaffX = Person4b & { badge: string }` 等价（实测两者都能被 `implements` 用），但 `extends` 会在**声明处**就报两个父接口同名成员不兼容，比交叉更早暴露。`class implements` 是你向契约做的承诺：漏字段报错，**多余字段不检查**（类实例不是新鲜字面量）。本站路线以函数式与组合式为主，`implements` 主要出现在读第三方库类型或写适配器时。

## `keyof` 与 `typeof` 的组合：给第 8 章上膛

```ts
const apiPaths = { users: "/api/users", orders: "/api/orders" } as const;
type ApiKey = keyof typeof apiPaths;             // "users" | "orders"
declare function pathOf<K extends ApiKey>(k: K): (typeof apiPaths)[K];
const gotPath: string = pathOf("orders");        // 实测通过
const badKey: ApiKey = "user";                   // 报错
```

```text
.scratch/ts-ch4-objs.ts(82,7): error TS2820: Type '"user"' is not assignable to type '"users" | "orders"'. Did you mean '"users"'?
```

`keyof` 作用在**类型**上（`keyof User4` 得 `"name" | "age"`），`typeof` 作用在**值**上；连写 `keyof typeof 常量对象` 就是「这张表所有键的联合」——第 3 章 `(typeof ROLES)[number]` 是同一族。配上泛型还能让「取字段」自洽（第 6 章主角，先练手）：

```ts
function pickValue<K extends keyof User4>(k: K): User4[K] { return u4[k]; }   // declare const u4: User4
const vAge: number = pickValue("age");    // 实测通过
const vBad: number = pickValue("name");   // TS2322: Type 'string' is not assignable to type 'number'.
```

**`K extends keyof T` + `T[K]` 是第 6 章约束和第 8 章 `Pick`/`Record` 的接口处。**

## 实操：给一个分页用户接口建模

后端 `GET /api/users?page=1`，字段 `snake_case`，头像可能为空，账号三种状态：

```ts
type UserId = string;
type AccountState = "active" | "frozen" | "deleted";

interface ApiUser {
  id: UserId;
  nickname: string;
  email_verified: boolean;
  state: AccountState;         // 字面量联合：可当判别字段，可配 Record 穷尽表
  created_at: string;          // JSON 里就是字符串，写 Date 是骗自己
  avatar_url: string | null;   // 键恒在，值可空——不是 avatar_url?: string
}

interface UserPage { list: ApiUser[]; page: number; page_size: number; total: number }
```

`avatar_url` 用 `| null` 决定了页面写法是 `if (u.avatar_url === null)` 而不是真值判断（第 3 章实测：空串和 `null` 会被同一个 `if (x)` 混掉）；`created_at` 需要 `Date` 时在转换层 `new Date(u.created_at)`。

**命名风格取舍：本站选「两层模型 + 一个转换函数」。**

```ts
type WebUser = {
  id: UserId; nickname: string; emailVerified: boolean;
  state: AccountState; createdAt: string; avatarUrl: string | null;
};

function toWebUser(u: ApiUser): WebUser {
  return {
    id: u.id, nickname: u.nickname, emailVerified: u.email_verified,
    state: u.state, createdAt: u.created_at, avatarUrl: u.avatar_url,
  };
}
```

收益：组件只用 `camelCase`；后端改名只动一处；`ApiUser` 可以带不想暴露给组件的字段；转换层是天然**边界**，运行时校验器挂这里。代价是每个字段写两遍。字段稳定、来源可控时也可以让组件直接用 `snake_case`——**但别两边混用**。上面这段连同 `emptyPage: UserPage = { list: [], page: 1, page_size: 20, total: 0 }` 都实测通过（整段退出码 0）。

## 常见错误与排查

1. **交叉出 `never`**：字段既读不出也写不进，`Type 'string' is not assignable to type 'never'.`（实测）。拆开定位冲突，用 `Omit` 或完整重写。
2. **字段全写 `?`**：每个使用点判空。一定返回的写 `string | null`，确认会缺席才写 `?`。
3. **对象字面量多字段报 `TS2353`（实测）**：看第二行 `does not exist in type`。多写了就删（这是抓 bug），确实允许扩展就加索引签名或走转换层；`as` 只是消音。
4. **先赋值到变量再传参，字段静默丢失**：编译干净（实测 `send(passed)`、`send({...passed})` 零报错）、被调方拿不到值。参数类型写明可扩展，或调用处直接传字面量。
5. **窄类型传给宽签名报 `TS2345`（实测 `Property 'admin' is missing`）**：补字段，或把参数约束写小。
6. **`object` 当字典读，撞 `Index signature for type 'string' is missing`（实测）**：`in` 逐层收窄，或显式声明索引签名并配合边界校验。
7. **越界读到 `undefined` 不报错**：`resp.items[0].name` 运行时崩。`strict` 不含 `noUncheckedIndexedAccess`；显式判空或开该选项。
8. **`readonly` 以为锁住了整棵树**：只锁一层。值层面 `as const`，契约层面逐层 `readonly`，数组 `readonly T[]`。
9. **同名接口互相污染**：报错里出现你没写的必需字段。全局搜类型名确认声明份数；公共契约的合并集中一处并注释。

## 练习

<Exercise title="练习 1 · 把一堆可选字段改成诚实的模型" difficulty="基础">

这段在 `--strict` 下编译没问题，但每个使用点都要判空。按注释线索改准确，并说明每条依据：

```ts
interface OrderDetail {
  id?: string;
  status?: string;               // 只有 "pending" | "paid" | "closed"
  paidAt?: string | null;        // 未支付时后端返回 null
  remark?: string;               // 后端确实可能不带这个键
  items?: OrderItem[];           // 一定返回，可能是空数组
}
interface OrderItem { sku?: string; qty?: number }
```

<template #answer>

```ts
type OrderStatus = "pending" | "paid" | "closed";
interface OrderItem { sku: string; qty: number }
interface OrderDetail {
  id: string;
  status: OrderStatus;
  paidAt: string | null;
  remark?: string;
  items: OrderItem[];
}
```

依据：`id`/`items` 一定返回就去掉 `?`（空数组不等于缺键）；`status` 换字面量联合才能当判别字段并配 `Record<OrderStatus, string>` 做穷尽文案表；`paidAt` 是「键恒在、值可空」用 `| null`；`remark` 是唯一真会缺席的字段；`OrderItem` 两个字段「有 item 就一定有」，全去掉 `?`。

</template>

</Exercise>

<Exercise title="练习 2 · 用 Record 给状态表加穷尽检查" difficulty="进阶">

写一个把 `AccountState` 翻译成人话的表，要求新增状态忘了配文案就编译报错，写多余的键也报错。给出类型、一份失败写法，并预测报错码。

<template #answer>

```ts
const stateLabel: Record<AccountState, string> = {
  active: "正常", frozen: "已冻结", deleted: "已注销",
};
```

两种失败写法本章都实测过同构文案：漏键得到 `TS2741: Property 'frozen' is missing in type ... but required in type 'Record<AccountState, string>'.`；多写 `banned: "封禁"` 得到 `TS2353: Object literal may only specify known properties, and 'banned' does not exist in type 'Record<AccountState, string>'.`。比 `switch` 好在两点：定义处就检查（不用等有分支真跑），取值一行 `stateLabel[u.state]`。以后 `AccountState` 加第四个状态，每个没更新的表都会各自报一次——这是第 3 章 `never` 穷尽检查的类型层版本。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造报错：读懂凭空出现的 never" difficulty="进阶">

预测报错并解释 `never` 从哪来，然后给两种修法。禁止用 `as`。

```ts
type BaseEntity = { id: string; updatedAt: string };
type OrderRow = { id: number; total: number };
type Merged = BaseEntity & OrderRow;
declare const row: Merged;
const show: string = row.id;
```

<template #answer>

最后一行报错，指向 `id`：`error TS2322: Type 'never' is not assignable to type 'string'.`

原因：`BaseEntity.id: string` 与 `OrderRow.id: number` 同名不同型，交叉取交集，`string & number` 即 `never`。声明 `Merged` 时零提示，问题在使用处才爆——**看到「凭空出现的 never」就怀疑交叉的同名字段**（本章实测的镜像写法——往 `{ x: "a" }` 里写值——报的是同一条冲突的另一端）。

修法一（推荐）：显式写清合并结果 `type Merged = { id: number; updatedAt: string; total: number };`；修法二：`type Merged = Omit<BaseEntity, "id"> & OrderRow;`（`Omit` 第 8 章讲，这里先当现成工具用）。

</template>

</Exercise>

<Exercise title="练习 4 · 给一个真实分页响应建模" difficulty="挑战">

后端返回（`snake_case`；`next_cursor` 为 `null` 表示到底；`kind` 决定 `meta` 形状；查询参数任意键）。禁止 `any`、`as`。请给出：① 分页类型；② `items` 的判别联合；③ 查询参数字典类型；④ 一个安全取第一条 note 标题的函数。

```json
{
  "items": [
    { "id": "a1", "kind": "note", "title": "标题", "meta": { "word_count": 12 } },
    { "id": "b2", "kind": "image", "meta": { "width": 800, "height": 600 } }
  ],
  "next_cursor": null,
  "has_more": true
}
```

<template #answer>

```ts
type QueryParams = { [k: string]: string | number | boolean };
type NoteItem = { id: string; kind: "note"; title: string; meta: { word_count: number } };
type ImageItem = { id: string; kind: "image"; meta: { width: number; height: number } };
type FeedItem = NoteItem | ImageItem;

interface FeedPage { items: FeedItem[]; next_cursor: string | null; has_more: boolean }

function firstTitle(page: FeedPage): string | null {
  for (const it of page.items) {
    if (it.kind === "note") return it.title;
  }
  return null;
}
```

四个考察点：① `next_cursor: string | null`（键一定在）而不是 `?`；② `kind` 是判别字段、`meta` 随分支不同，写成 `meta?: ...` 就废了；③ 查询参数用索引签名，值类型收窄到实际会出现的原始类型（`Record<string, unknown>` 也合法但值全变未知）；④ `firstTitle` 必须先 `it.kind === "note"` 收窄才有 `it.title`；若改成 `page.items[0].title`，数组为空也不报错——就是本章「越界读盲区」那条。再往上就是把它接进 `fetchJson<T>` + 运行时校验器（第 3 章链路），第 6 章给这个函数加泛型参数，第 12 章项目里是同一个形状。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Object Types（Handbook 2）](https://www.typescriptlang.org/docs/handbook/2/objects.html) —— 核实本章骨架：[`unknown`](https://www.typescriptlang.org/docs/handbook/2/objects.html#the-unknown-type)、[索引签名](https://www.typescriptlang.org/docs/handbook/2/objects.html#index-signatures)、[`readonly`](https://www.typescriptlang.org/docs/handbook/2/objects.html#the-readonly-modifier) 三节与实测结论逐条对照。
- [Everyday Types 的 Interfaces 小节](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#interfaces) —— 核实官方对 `interface` 与 `type` 的倾向（「大多用 interface，需要联合就切 type」）：本章那条规则是工程约定，不是语言规定。[Declaration Merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html) —— 核实「`interface`/`class`/`namespace` 参与合并、`type` 别名不参与」，以及同名全局接口静默合并的风险表述。[`Record`](https://www.typescriptlang.org/docs/handbook/utility-types.html#recordkeys-type) —— 核对「漏键 `TS2741`、多键 `TS2353`」。
- [`exactOptionalPropertyTypes`](https://www.typescriptlang.org/tsconfig/#exactOptionalPropertyTypes)、[`noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess) —— 核实这两个选项**不在 `strict` 之内**，这是本章「`{ name: undefined }` 默认合法」「越界读不报错」两条实测结论的前提；第 10 章细讲。
- 版本提示：本章报错码（`TS2300`、`TS2322`、`TS2345`、`TS2353`、`TS2411`、`TS2540`、`TS2741`、`TS2820`）与文案来自本机 5.9.3，措辞会随版本变化，核对入口是[发行说明总览](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html)；「`interface` 性能更好」本站未实测，已标 unverified。

## 下一章

对象形状解决了「数据长什么样」，还差「能对数据做什么」。下一章 [函数类型](/typescript/functions) 讲签名：返回值标注省掉的两个方向的代价、可选参数与 `undefined` 在 arity 上的差异、回调「少写参数合法 / 参数类型逆变」这组双向规则、`this` 丢绑定为什么编译通过而运行时当场崩，以及类型安全的 `retry` 与事件总线。
