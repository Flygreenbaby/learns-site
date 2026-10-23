# 阶段项目：用 TypeScript 重写待办清单

你在[纯 JavaScript 待办清单](/javascript/project)里靠口头约定保住了三件事：`Todo` 长什么样、`filter` 只有三个取值、`state.error` 可能是 `null`。这次重做同一个应用，把约定交给编译器。重写**不**给你运行时检查：类型编译后全部擦除。它只给你两件事——写错字段名立刻报错，以及**新增状态分支时编译器逼你补全所有 `switch`**：三态（进行中 / 已完成 / 已过期）用判别联合表达后，「加了状态忘了改渲染」这类 bug 死在编译阶段。技术约束、功能扩展与验收标准以[TypeScript 领域首页](/typescript/)的「阶段项目」一节为准，本章只展开不改范围。

## 目标与范围：只做类型化重写，不新增功能

功能只做首页指定的三处扩展：标签 + 截止日期与三态、泛型 `fetchJson<T>`、三类派生类型。路由、登录、撤销重做、拖拽、测试框架一律不加；不引入 Vue / React，也不引入 zod 之类校验库，校验器手写以练 `unknown` 收窄。`tsc` 负责检查，Vite 只做开发服务器与打包；界面与文件粒度保持 JS 版。新增一条划分标准：**把 `unknown` 变成 `Todo` 的代码只能待在 `validate.ts`**。

## 迁移顺序：五步，每步都能停下来

别新建空 TS 项目从零重写：那会让你同时改架构和改类型，出错无法归因。

**① `allowJs` 过渡——不改任何文件，先让编译器看进 `.js`。** `compilerOptions` 只加 `{ "allowJs": true, "checkJs": true, "noEmit": true }`。`npx tsc -p .` 在我模拟的 JS 文件上实测抓到与严格模式无关的真 bug：`src/state.js(12,24): error TS2339: Property 'toUpperCase' does not exist on type 'number'.` 关 `checkJs` 再跑，输出立刻为空——**`allowJs` 让 TS 读 `.js`，真正干活的是 `checkJs`**。产出：一份确定是 bug 的清单。回退：删 `tsconfig.json`，项目零改动。卡点：忘开 `noEmit`，`tsc` 把 `.js` 编进 `dist/`，同一份代码打包两遍。

**② 逐文件改扩展名，从依赖最少的 `model` / `state` 开始。** `git mv state.js state.ts`，`import` 去后缀，一文件一提交。产出：`src` 下不再有 `.js`。回退：单文件改回 `.js`。卡点：运行时宽容集中爆发——`getElementById` 给 `HTMLElement | null`、`catch (e)` 是 `unknown`、类字段没初始化；先别加类型，留到第 ③ 步。

**③ 打开 `strict`。** 产出：strict 家族报错清零。回退：它可拆成 `noImplicitAny`、`strictNullChecks` 等子开关，卡住就先只开这两项。卡点：实测 `error TS2564: Property 'host' has no initializer and is not definitely assigned in the constructor.` 正确修法是在构造函数里无条件赋值或把字段声明成可选，`host!: string` 等于把决定权交给运气。

**④ 单独打开 `noUncheckedIndexedAccess`，独立一次提交。** 它改所有下标访问的语义，混进第 ③ 步你会以为错误来自 strict。产出：`xs[0]` 从 `Todo` 变成 `Todo | undefined`。回退：`git revert` 这一个提交。卡点是实测最反直觉的一条：**元素类型是隐式 `any` 时这个开关完全不起作用**——追加 `--strict --noUncheckedIndexedAccess` 只新增 `error TS7006: Parameter 'todo' implicitly has an 'any' type.`，而 `todo.tags[0].toUpperCase()` 依旧一声不响。

**⑤ 清 `any`。** 三个来源逐个堵住：`JSON.parse`、`res.json()`、`Array.isArray` 收窄出的 `any[]`，手法都是立刻标注 `const data: unknown = JSON.parse(raw);`、`const list: unknown[] = value;`。产出：`grep -rn -w 'any' src` 只剩注释。回退：纯加法，单文件 `git checkout`。卡点：把越界的三种修法（翻车点 1）当成断言问题。

## 数据模型：三态用判别联合，衍生类型只做派生

「三种状态携带的字段不同」要用判别联合（discriminated union）表达，不是三个布尔字段，也不是 `status: string` 加一堆可选属性。

```ts
// model.ts
export type TodoStatus = "active" | "done" | "expired";

export interface TodoBase {
  readonly id: string;
  readonly status: TodoStatus;
  text: string;
  tags: string[];
  createdAt: number;
  dueAt: number | null;
}

export interface ActiveTodo extends TodoBase { readonly status: "active" }
export interface DoneTodo extends TodoBase {
  readonly status: "done"; doneAt: number; completionNote: string;
}
export interface ExpiredTodo extends TodoBase {
  readonly status: "expired"; expiredAt: number; reason: "due" | "manual";
}

export type Todo = ActiveTodo | DoneTodo | ExpiredTodo;
export type Filter = "all" | TodoStatus;

export type TodoCreateInput =
  Omit<TodoBase, "id" | "status" | "createdAt" | "dueAt"> &
  Partial<Pick<TodoBase, "dueAt">> & { id?: string; createdAt?: number };
export type TodoUpdateInput = { readonly id: string } & Partial<Omit<TodoBase, "id" | "status">>;
export type TodoListItem = Pick<Todo, "id" | "text" | "status" | "dueAt" | "tags"> &
  { readonly statusText: string };
export type StoredPayload = { version: number; todos: Todo[]; filter: Filter };
```

`status` 用字面量而非 `string`，它同时充当判别式 tag 与 `Pick` 的对象；`status` 是 `readonly`，所以状态迁移只能换对象——实测 `error TS2540: Cannot assign to 'status' because it is a read-only property.`，它防住的正是「写了 `done` 却没写 `doneAt`」这种半截状态；变体独有字段必填（不是 `doneAt?: number`），否则「已完成但没有完成时间」在类型上合法。三类衍生类型全由 `Omit` / `Partial` / `Pick` 派生，其中 `TodoUpdateInput` 排除 `status`，「更新不能改状态」因此是编译约束而不是口头约定。

**不许重复定义字段是这一条理由，不是风格偏好**：主模型把 `text` 改名 `title` 时，手写的 `text: string` 不会报错，创建入参继续接受旧字段名——这类不一致 grep 不到、`tsc` 也不报；派生写法则立刻报错。

## 五个实施阶段

顺序不能换，每阶段只做一件事，自查请在终端里真跑。

### 阶段 ① 编译链与 tsconfig

定稿配置（本章参考实现用的就是这一份）：

```json
{ "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true, "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true, "noUnusedParameters": true,
    "isolatedModules": true, "skipLibCheck": true, "noEmit": true },
  "include": ["src"] }
```

开关的防错点在「迁移顺序」与「常见翻车点」两节里逐个对应，你必须能一口气说完；默认值以 [tsconfig 参考](https://www.typescriptlang.org/tsconfig) 为准。

**可验证产出**：`npx tsc -p .` 无输出；`package.json` 有 `"type-check": "tsc --noEmit -p ."` 且进 CI——Vite 本身不做类型检查。**自查**：把 `lib` 里的 `"DOM"` 删掉再跑，报错应明显上升。

### 阶段 ② 数据模型与派生类型

代码就是上一节那一整块，再加 `assertNever` 与工厂函数（参考答案第 1 段）。**可验证产出**：临时给 `TodoCreateInput` 手补一个 `text: string`（不用 `Omit`），再把 `TodoBase.text` 改名 `title`，看编译器放不放过你。**自查**：`grep -n 'status' src/model.ts` 每处取值都是三个字面量之一。

### 阶段 ③ 状态与渲染的类型化

视图状态也是判别联合，四种画面各带自己的字段：`ViewState = { kind: "loading" } | { kind: "error"; error: FetchError } | { kind: "empty"; filter: Filter } | { kind: "ready"; rows: TodoListItem[]; filter: Filter; total: number; remaining: number }`。

`render(view: ViewState): void` 里 `switch (view.kind)`，在 `loading` 分支访问 `view.rows` 直接报错——JS 版「白屏 3 秒」这类问题从此写不出来。事件回调不能是隐式 `any`（实测 `TS7006`），用泛型接进 DOM 事件表：`function on<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void): void`；委托链每一跳都要收窄，写法见参考答案第 3 段。

**可验证产出**：Console 执行 `store.add({ text: "试一下", tags: [] })` 出现新行；把 `dueAt: 123` 改成 `dueAt: "123"`，编辑器报错。**自查**：`render()` 没有一处读 DOM 取数据，`store.ts` 搜不到 `document`。

### 阶段 ④ `fetchJson<T>` 与运行时校验

代码见下一节与参考答案第 2 段。**可验证产出**：把 `data/todos.json` 某条的 `createdAt` 改成字符串，页面显示「字段不符合约定」而不是白屏；改成半截 JSON 显示「无法解析为 JSON」；DevTools 改坏 `localStorage` 后刷新，页面提示并清空，再刷新恢复正常。**自查**：`grep -n 'as ' src/http.ts` 只剩边界那一处，`validate.ts` 搜不到 `as`。

### 阶段 ⑤ 穷尽检查与破坏性验证

四个检查点必须都在：`statusLabel`（状态 → 文案）、`matchesFilter`（筛选 → 比较）、`userMessage`（错误 kind → 提示）、`render`（`view.kind`）。**可验证产出**：下一节两次破坏各得一条你能解释的编译错误。**自查**：撤销改动后 `npx tsc -p .` 重新无输出，`git diff` 为空。

## fetchJson 的实现：泛型管编译期，校验器管运行时

```ts
// http.ts
export type FetchErrorKind = "network" | "timeout" | "http" | "parse" | "shape";

export class FetchError extends Error {
  readonly kind: FetchErrorKind;
  readonly status: number | null;
  constructor(kind: FetchErrorKind, message: string, init?: { status?: number }) {
    super(message); this.name = "FetchError"; this.kind = kind;
    this.status = init?.status ?? null;
  }
}
export function isFetchError(value: unknown): value is FetchError { return value instanceof FetchError }

const TIMEOUT_MS = 8000;

/** 与 T 无关的那一段：只能确认「请求成功、拿到的是合法 JSON」 */
async function fetchRawJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const timeout = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new FetchError(timeout ? "timeout" : "network", timeout ? `请求超过 ${TIMEOUT_MS}ms` : `无法连接 ${url}`);
  }
  if (!res.ok) throw new FetchError("http", `服务返回 ${String(res.status)}`, { status: res.status });
  let parsed: unknown;
  try { parsed = JSON.parse(await res.text()); }   // JSON.parse 返回 any：立刻落到 unknown
  catch { throw new FetchError("parse", `${url} 的内容不是合法 JSON`); }
  return parsed;
}

/** 首页要求的签名。能用，但它校验不了形状 */
export async function fetchJson<T>(url: string): Promise<T> {
  const data = await fetchRawJson(url);
  return data as T;    // 唯一的边界断言：T 在运行时不存在，无从证明 data 是 T
}

export type Validator<T> = (value: unknown) => T;

/** 消费外部数据一律走这个：零断言，形状不合抛 kind 为 shape 的错误 */
export async function fetchValidatedJson<T>(url: string, validate: Validator<T>): Promise<T> {
  return validate(await fetchRawJson(url));
}
```

`kind` 是判别式，消费方式就是 `switch`：`userMessage(error: FetchError)` 对 `network` / `timeout` / `http` / `parse` / `shape` 各出一条可行动的文案（404 单列），末尾 `default: return assertNever(error.kind)`——新增一种 `kind` 而不补分支，编译立刻失败。

**为什么泛型参数救不了你**：`fetchJson<Todo[]>(url)` 编译之后就是 `fetchJson(url)`，`<Todo[]>` 一个字都不剩——这就是[类型擦除](/typescript/why-types)的具体含义。函数体内没有任何关于 `T` 的信息可用，所以 `data as T` 是纯断言：不生成代码、不生成检查，只生成一份编译期的谎言。谎言只在调用点生效（`rows.length` 会报错），但服务器返回 `{ "todios": [] }` 时 TS 一声不响，直到运行时 `rows.map` 炸掉。

于是项目里有一条硬规矩：`fetchJson<T>` 只用于已确认端点契约、且 `T` 是原始值或自己构造的数据；**所有外部数据走 `fetchValidatedJson` + 校验器**（`todoValidator` 见参考答案第 2 段）。校验器输入 `unknown`、输出窄类型，先查公共字段再按状态补必填字段——那个 `switch` 同时是运行时检查和一次穷尽检查。`localStorage` 是同一个边界，套路见翻车点 2：**不清掉坏数据，每次刷新都重演同一个错误**。

## 用 never 做穷尽检查，并真的破坏两次

```ts
export function assertNever(value: never): never {
  throw new Error(`switch 未覆盖的分支：${String(value)}`);
}

export function statusLabel(todo: Todo): string {
  switch (todo.status) {
    case "active":  return todo.dueAt === null ? "进行中" : `进行中 · 截止 ${formatDate(todo.dueAt)}`;
    case "done":    return `已完成 · ${formatDate(todo.doneAt)}`;
    case "expired": return todo.reason === "due" ? `已过期 · 到期日 ${formatDate(todo.expiredAt)}` : "已过期 · 手动标记";
    default:        return assertNever(todo);
  }
}
```

三个 `case` 都在时 `todo` 走到 `default` 已收窄成 `never`，调用合法；少任何一个 `case`，`default` 里还剩一个具体类型，编译立刻失败。两次破坏分别证明「断言不产生检查」与「穷尽检查真的会叫」。

<Callout type="verified" title="本机 TypeScript 5.9.3 的编译与破坏性验证结果">

环境：Windows 10 x64 + Node v25.4.0；`npx tsc --version` 输出 `Version 5.9.3`；配置含 `strict`、`noUncheckedIndexedAccess`、`noEmit`。

- 完整参考实现（6 个源文件）：**无任何输出，exit code 0**。
- 破坏 ①（调用点泛型实参从 `Todo[]` 改成对象类型，再按数组取 `length`）：`error TS2339: Property 'length' does not exist on type '{ todos: Todo[]; }'.`
- 破坏 ②（删掉 `case "expired"`，`default` 保留 `assertNever(todo)`）：`error TS2345: Argument of type 'ExpiredTodo' is not assignable to parameter of type 'never'.`
- 对照（同样少一个分支，但 `default` 写成 `return "未知状态"`）：该函数**没有任何报错**，同文件用 `assertNever` 的那个照旧报 `TS2345: Argument of type '{ status: Status; }' is not assignable to parameter of type 'never'.`——「兜底 default 会吃掉穷尽检查」的实测证据。
- 另实测：`filter(Boolean)` 保留 `null`（`TS2322`）而 `filter((value) => value !== null)` 无报错；`items.length > 0` 之后再写 `items[0].text` 仍报 `TS2532`；`grep -rn -w 'any' src` 命中 3 行且全在注释里，`grep -rn 'as ' src` 命中 2 行，`@ts-ignore` 命中 0。

</Callout>

## 验收清单

- [ ] `npx tsc -p .` 无输出、无 warning；`npm run type-check` 已进 CI 或提交前钩子。
- [ ] `strict` 与 `noUncheckedIndexedAccess` 都在，且你能说出每个开关在防哪类错误。
- [ ] `any` 次数为 0、抑制为 0、`as` 只在边界：`grep -rn --include='*.ts' -w 'any' src | wc -l` 只命中注释，`grep -rn --include='*.ts' 'as ' src` 只命中 `return data as T;` 与 `as const`，`grep -rn --include='*.ts' -e '@ts-ignore' -e '@ts-expect-error' src` 为空。
- [ ] 破坏 ①：改错某个 `fetchJson<T>` 调用的泛型实参，只改实参就复现 `TS2339`。
- [ ] 破坏 ②：删掉三态 `switch` 任一分支，报错含 `is not assignable to parameter of type 'never'`。
- [ ] 三态字段各就各位，三类衍生类型全由 `Pick`/`Omit`/`Partial` 派生，`grep` 不到重复字段。
- [ ] 损坏的 `localStorage` 与形状不合的接口数据都走 `catch`：提示可行动、能重试、不白屏、坏数据被清掉。
- [ ] 事件回调无隐式 `any`；`store.ts` 无 `document`、`render.ts` 无 `localStorage`；功能与 JS 版一致（新增、编辑、删除、标记完成、筛选、刷新不丢数据），全程 `textContent` 不拼 `innerHTML`。

## 常见翻车点

**1）开 `noUncheckedIndexedAccess` 后满屏 `Object is possibly 'undefined'`（实测 `TS2532`）。** 三种修法：**① 取进局部变量再判空**——`const head = todos[0]; if (head === undefined) return null; return head.text;`，编译器只追踪局部变量，实测 `if (items.length > 0) return items[0].text;` 依旧报错；**② 不用下标**——`for (const todo of todos)`、`find`、`map.get()` 本就返回联合类型；**③ 把「可能没有」写进签名**——辅助函数返回 `Todo | null`。禁止第四种 `todos[0]!` 与 `as Todo`。

**2）外部数据不校验就进状态。** `JSON.parse` 返回 `any`，`JSON.parse(raw).todos.map(...)` 一路绿灯；三个月前存的旧字段被当成合法 `Todo[]`，统计全错。修：`const parsed: unknown = JSON.parse(raw)` 再交给校验器，校验器内含 `version` 检查。

**3）事件回调写成隐式 `any`。** `const onClick = (event) => {...}` 报 `TS7006`，而 `addEventListener` 里直接传的箭头函数**不报**——后者有上下文推断（[类型推断](/typescript/inference)）兜着。修法是阶段 ③ 的 `on<K extends keyof HTMLElementEventMap>`。

**4）`filter(Boolean)` 不收窄类型。** 实测 `error TS2322: Type '(string | null)[]' is not assignable to type 'string[]'.`——过滤完还是 `(string | null)[]`。把条件写出来：`list.filter((value) => value !== null)`，同一份文件里这行编译通过。

**5）判别联合漏了 tag。** 写成 `{ status?: TodoStatus; doneAt?: number }` 或 `status: string`，`switch` 就永远进不了 `never` 检查（剩余类型是整个联合体），每个字段还得判空。根因：**tag 必须必填且是字面量类型**。

**6）穷尽检查被 `default` 吃掉。** 对照实测：`default: return "未知状态"` 时少分支完全不报错，`assertNever` 的参数改成 `unknown` 同样失效。

**7）类字段初始化顺序与 `target` 有关。** Node v25.4.0 实跑等价结构，输出依次是 `Base 构造函数里看到 this.label = base`、`super() 返回后 this.label = store`、`字段声明顺序导致 this.computed = "undefined"`：字段按**声明顺序**初始化，前面的 initializer 读后面的字段只会拿到 `undefined`，子类同名字段还要等 `super()` 之后才覆盖，而 `target` 影响 `useDefineForClassFields` 语义。

**8）`catch (e)` 当 `any` 用，或把断言当转换用。** 实测 `error TS18046: 'e' is of type 'unknown'.`：别 `String(e)` 一把梭，也别 `e.message`；修法是 `isFetchError(e)` + `switch (e.kind)`。至于 `value as Todo`：**断言之后如果没有任何检查代码，那段代码在运行时和 JS 一样裸**。

## 参考答案要点

<Exercise title="参考答案要点 · 关键实现" difficulty="挑战">

正文已给出三态联合、派生类型、`http.ts`、`assertNever` 与 `statusLabel`。下面补工厂与状态迁移、校验器、渲染装配三段，均取自 `verified` 那节编译通过的实现；请先自己写完再对照差异。

<template #answer>

### 1）工厂与状态迁移：改状态只能新建对象

```ts
export function createTodo(input: TodoCreateInput): ActiveTodo {
  return { text: input.text, tags: [...input.tags], dueAt: input.dueAt ?? null,
    id: input.id ?? nextId(), createdAt: input.createdAt ?? Date.now(), status: "active" };
}
export function expireTodo(todo: ActiveTodo, reason: ExpiredTodo["reason"]): ExpiredTodo {
  return { ...todo, status: "expired", expiredAt: Date.now(), reason };
}
```

`matchesFilter(todo, filter)` 与 `statusLabel` 同构：`switch (filter)` 覆盖四个取值后 `default: return assertNever(filter)`。`toListItem(todo)` 返回 `Pick` 的五个字段加 `statusText: statusLabel(todo)`，`tags` 用 `[...todo.tags]` 复制。

`createTodo` 返回类型写死 `ActiveTodo`：少一个字段、或 `status` 写成 `"done"`，编译都过不去（`nextId()` 优先 `globalThis.crypto.randomUUID`，`typeName` 与 `formatDate` 是各自文件的纯工具函数）。`store` 侧同构：`complete(id, note)` 照 `expireTodo` 换对象，`patch(input: TodoUpdateInput)` 从不碰 `status`——约束由 `Omit` 写死而不靠注释；它 `findIndex` 后先 `const current = this.todos[index]; if (current === undefined) return;`（翻车点 1 修法 ①）。`computeView()` 先 `filter(matchesFilter).map(toListItem)`，再决定给 `empty` 还是 `ready`；`commit()` 顺序固定：重算 `view` → 存本地 → 通知订阅者。

### 2）校验器（validate.ts）

```ts
export const todoValidator: Validator<Todo> = (value) => {
  if (!isPlainRecord(value)) throw new FetchError("shape", `待办项应为对象，实际是 ${typeName(value)}`);
  const shared = { id: requireString(value, "id"), text: requireString(value, "text"),
    tags: requireTags(value, "tags"), createdAt: requireNumber(value, "createdAt"),
    dueAt: optionalNumber(value, "dueAt") };
  switch (readStatus(value)) {
    case "active":  return { ...shared, status: "active" };
    case "done":    return { ...shared, status: "done", doneAt: requireNumber(value, "doneAt"),
      completionNote: requireString(value, "completionNote") };
    case "expired": return { ...shared, status: "expired", expiredAt: requireNumber(value, "expiredAt"),
      reason: requireReason(value) };
  }
};
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

`typeName(value)` 把 `null` / `array` / `typeof` 折成可读字符串，报错才说得出「实际是什么」。`requireTags(rec, "tags")` 判数组后立刻 `const list: unknown[] = value;`——`Array.isArray` 给的是 `any[]`，少了这步脏字段就以 `any` 的身份进状态；`requireString` / `requireNumber` / `optionalNumber` / `requireReason` 同构：取字段 → `typeof` 检查 → 不合抛 `shape`。`readStatus` 用三次 `===` 而不是 `string[]` 的 `includes`——后者不收窄，会逼你写 `value as TodoStatus`。本地存储校验器先 `isPlainRecord`，再要求 `version === 2`（否则抛「本地存储版本不受支持，需要迁移」），最后逐条走 `todoValidator`。

### 3）渲染装配

`render(view: ViewState)` 按 `view.kind` 分支：`loading` 只清列表并把计数置空，`error` 分支才能拿到 `view.error` 填错误框，`empty` 走 `emptyText(view.filter)`，`ready` 遍历 `view.rows` 拼 `DocumentFragment` 一次性 append，末尾 `default: return assertNever(view)`。取节点用一个泛型助手 `function mustFind<T extends Element>(selector: string): T`——内部 `document.querySelector<T>(selector)` 判 `null` 就抛错，整条渲染链不需要一次 `as`。`buildRow` 里 `li.dataset["id"] = id` 只存 id 不存下标，全程 `createElement` + `textContent`；事件仍是一个委托，`event.target` 先 `instanceof Element`，再从 `closest("[data-action]")` 读 `dataset["action"]`（`string | undefined`）分派。

</template>

</Exercise>

<Callout type="unverified" title="只验证了编译，浏览器行为仍由你验证">

已验证的都是**编译期**事实：`typescript@5.9.3` 下的通过 / 报错输出，以及一段 JS 等价结构在 Node v25.4.0 的字段顺序运行结果。未验证：页面实际渲染、事件委托在浏览器里的命中行为、`AbortSignal.timeout` 抛出的 `DOMException` 名称、`localStorage` 配额异常的报错——这些必须由你跑。迁移第 ① 步那条错误来自我构造的 `.js` 模拟文件，不是你的 JS 版项目。

</Callout>

## 官方文档与延伸阅读

- [tsconfig 参考](https://www.typescriptlang.org/tsconfig) —— 核实 `strict` 含哪些开关、`noUncheckedIndexedAccess` 的语义、`moduleResolution: bundler` 的适用条件；默认值会变。
- [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) 与 [Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html) —— 核实判别联合、exhaustiveness checking 与 `Pick` / `Omit` / `Partial` 定义；[Playground](https://www.typescriptlang.org/play/) 的 JavaScript 输出能直接看到 `fetchJson<T>` 编译后只剩 `fetchJson(url)`。
- MDN：[JSON.parse](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse) 抛 `SyntaxError`、[fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) 只有网络层失败才 reject、[AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)、[dataset](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/dataset)。

## 下一章

本章把[TypeScript 前 11 章](/typescript/)用全了：`unknown` 收窄与判别联合负责边界（[联合类型与收窄](/typescript/unions-and-narrowing)），`Pick`/`Omit`/`Partial` 负责派生（[工具类型](/typescript/utility-types)），泛型负责 `fetchJson<T>` 与 `on<K>`（[泛型](/typescript/generics)）。下一步进 [Vue 3 领域](/vue/)：[组合式 API 与 composables](/vue/composables) 里 `ref<Todo[]>` 不需要 `as`，因为 `ref` 是泛型函数、靠[类型推断](/typescript/inference)从初始值拿到元素类型；`defineProps<{ text: string; dueAt?: number }>()` 用的正是本章的字面量类型与可选属性（[props、emit 与插槽](/vue/components)）；[Pinia](/vue/pinia) 的 `state()` 能自动推断成 store 类型，靠的是「派生而不是重复定义」这条纪律。在本章靠 `as` 让编译通过的人，到 Vue 会在 `defineProps` 自动生成的类型上再撞一次墙。
