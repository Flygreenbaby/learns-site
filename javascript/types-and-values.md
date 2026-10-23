# 类型、值与引用语义：变量里装的到底是值还是地址

`const user = {...form}` 之后你改 `user.address.city`，表单里的城市跟着变了。`if (value)` 把 `0` 和 `''` 当成空丢掉。`typeof null === "object"` 让你的分支永远走错。`[NaN].indexOf(NaN)` 是 `-1`，`includes` 却能找到。

这不是四个独立的坑，而是同一组规则的四个出口：**变量装的是值；对象类型的值是地址；比较与运算之前先做转换，而转换有确定算法**。规则装上，这些现象全能提前预测。

<Callout type="verified" title="本章表格的每一行都在本地运行过">

环境：Node v25.4.0、Windows 10 x64、2026-10-17，命令形如 `node -e "..."` 或 `node --input-type=module -e "..."`。表格与练习答案里的输出都是真实结果，不是推算。涉及浏览器或跨 realm 的说法单独标注。

</Callout>

## 7 种原始类型与 typeof 的真实返回表

原始类型（primitive）共 7 个：`undefined`、`boolean`、`number`、`bigint`、`string`、`symbol`，以及位置特殊的 `null`。`typeof` 的返回值集合比类型集合小：

| 输入 | `typeof` 返回 | 备注 |
| --- | --- | --- |
| `undefined` | `"undefined"` | 与未声明变量同结果 |
| `1`、`NaN`、`Infinity` | `"number"` | `NaN` 属于 number |
| `"a"` | `"string"` | — |
| `true` | `"boolean"` | — |
| `10n` | `"bigint"` | ES2020 起有此返回值 |
| `Symbol("s")` | `"symbol"` | — |
| `null` | **`"object"`** | 历史缺陷 |
| `{ name: "x" }` | `"object"` | — |
| `[1, 2]` | `"object"` | 判数组要用 `Array.isArray` |
| `new Date()`、`/re/`、`new Map()` | `"object"` | 内置对象一律 object |
| `function f() {}` | **`"function"`** | 函数不是原始类型却独占一个返回值 |
| `class C {}` | `"function"` | class 是函数的一种 |
| 从未声明的标识符 | `"undefined"` | 不抛错，`typeof` 唯一的容错设计 |
| `typeof x`（`let x` 在下一行） | **抛 ReferenceError** | 死区里 `typeof` 也不安全 |

`typeof null === "object"` 的来源已由 [MDN `typeof` 页](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof) 说明：最初实现里值 = 类型标签 + 数据，对象的标签是 `0`，`null` 是空指针 `0x00`，标签也是 `0`。依赖太广，永远改不掉。**你的规则**：`typeof v === "object"` 之后必须排掉 `null`——写成 `v !== null && typeof v === "object"`。

`typeof bigint` 不抛错，抛错的是运算与死区：

```js
1n + 1;              // TypeError: Cannot mix BigInt and other types
"a" + Symbol("a");   // TypeError: Cannot convert a Symbol value to a string
typeof inTdz; let inTdz;  // ReferenceError: Cannot access 'inTdz' before initialization
```

原始值没有方法，但 `"abc".toUpperCase()` 能跑：取属性时引擎临时把它「装箱」成包装对象（`String`/`Number`/`BigInt`/`Boolean`/`Symbol`），取完即丢。所以 `toFixed`、`padStart` 来自包装对象的原型，见 [Methods of primitives](https://javascript.info/primitives-methods)。

## 引用类型：变量持有的是引用，不是值

对象类型的「值」就是对象地址。赋值、传参、放进数组或对象，复制的都是这个地址，本体只有一份。

| 操作 | 复制了什么 | 实跑结论 |
| --- | --- | --- |
| `const b = a`（a 是对象） | 引用 | `b.n = 2` 后 `a.n` 变 `2`；`a === b` 为 `true` |
| `const b = a`（a 是原始值） | 值 | 完全独立 |
| 对象作实参传给函数 | 地址的副本 | 函数内改属性**影响外部**（`t.v` 变 9）；函数内给形参重新赋值**不影响外部**（`arr[0].v` 仍是 1） |
| `structuredClone(a)` | 整棵结构 | 与原件毫无共享 |

「我明明没改它怎么变了」全在第三行：**你改的是引用指向的内容，还是引用本身**。`function f(o){ o = {} }` 只把局部变量指向别处；`function g(o){ o.x = 1 }` 改的是所有人共享的那个对象。框架要求不可变更新也是这个原因：`state.list.push(x)` 之后引用没变，任何基于「引用是否改变」的判断都会失效。

## 浅拷贝与深拷贝：四种手段的边界

以 `const a = { n: 1, deep: { x: 1 }, list: [1, 2] }` 为原件：

| 手段 | 第一层 | 更深层 | 实跑边界 |
| --- | --- | --- | --- |
| `{...a}` / `Object.assign({}, a)` | 新对象 | **共享引用** | 改 `a.deep.x = 5`，展开拷贝里的也是 5；`Object.assign` 同理（变 7） |
| `a.slice()` / `a.splice(0)` | 新数组 | 元素是对象则共享 | 同上 |
| `JSON.parse(JSON.stringify(a))` | 新对象 | 真正独立 | 丢 `undefined`/函数/`Symbol`，`Date` 变字符串，`NaN`/`Infinity` 变 `null`，循环引用抛错（第 3 章） |
| `structuredClone(a)` | 新对象 | 真正独立 | 保留 `Map`/`Set`/`Date`/`RegExp`/`TypedArray` 的类型，支持循环引用；**遇到函数抛 `DOMException`（`DataCloneError`，code 25）**；`Symbol` 键被静默丢弃；`Object.create(null)` 的原型被还原成普通 `Object` |

三条容易记错：`structuredClone` **不保留你自己的原型链**（`Object.getPrototypeOf(clone)` 不再是 `null`，类实例退化成普通对象）；它切断身份但保留内部循环结构；它是 Web API 而非 ECMAScript 定义，浏览器与 Node 都有。

**浅拷贝够不够只有一个判断标准**：被共享那一层你会不会就地改它。只读就够；要改就得把那条路径补成深拷贝。

## 相等性：== 的转换规则、=== 与 Object.is

`==` 不是「值相等」，而是「**双方按规则转成同类后**是否相等」：`null` 只与 `undefined` 相等；对象先 `ToPrimitive`；字符串与数字比较时字符串转数字。

| 表达式 | 结果 | 为什么 |
| --- | --- | --- |
| `'0' == 0` | `true` | 字符串转数字 |
| `0 == false` / `'' == false` | `true` / `true` | 都转成 `0` |
| `[] == false` / `[] == 0` / `[] == ''` | `true` × 3 | `[]` → `""` → `0` |
| `[1] == 1` | `true` | `[1]` → `"1"` → `1` |
| `null == undefined` | `true` | 唯一一对 |
| `null == false` / `null == 0` | **`false` / `false`** | `null` 不参与数字转换 |
| `NaN == NaN` | `false` | 与任何值都不等，包括自己 |
| `Object.is(NaN, NaN)` | `true` | 专门处理 `NaN` |
| `0 === -0` / `Object.is(0, -0)` | `true` / `false` | 全等不区分零的符号 |
| `[NaN].includes(NaN)` / `indexOf(NaN)` | `true` / `-1` | `includes` 用 SameValueZero，`indexOf` 用 `===` |
| `10n == 10` / `10n == 10.0` / `10n === 10` | `true` / `true` / `false` | BigInt 可与 Number 比数学值，全等先看类型 |

**为什么禁用 `==`**：它的转换链经过 `ToPrimitive`，而 `ToPrimitive` 能被对象自己改写（下一节最后一表），`x == y` 因此不可预测。唯一安全例外是 `value != null`（只涉及那一对）。需要严格比较时用 `Object.is`——它对 `NaN` 与 `-0` 的判定不同于 `===`，日常只在写缓存 key、序列化比较时才会用到。

## 类型转换：显式与隐式，以及对象转原始值

隐式转换发生在四处：`+`（有字符串就拼）、`- * / %`（一律转数字）、`==` 与比较、条件判断（转布尔）。

| 写法 | 实跑结果 | 结论 |
| --- | --- | --- |
| `Number("")` / `Number("  ")` / `Number(null)` | `0` / `0` / `0` | 空串与 `null` 都是 0 |
| `Number(undefined)` / `Number({})` / `Number([1,2])` | `NaN` × 3 | 对象与多元素数组转不出数 |
| `Number([])` / `Number([1])` | `0` / `1` | 空数组是 0 |
| `Number("10a")` / `Number("1_000")` / `Number("10px")` | `NaN` × 3 | `Number` 要求整串合法；数字分隔符只在字面量有效 |
| `Number("1e3")` / `Number("0x10")` / `Number("Infinity")` | `1000` / `16` / `Infinity` | 科学计数、`0x` 前缀、`Infinity` 字面量都认 |
| `parseInt("10a")` / `parseInt("0x10")` / `parseInt("10",2)` | `10` / `16` / `2` | `parseInt` 遇非法字符就停 |
| `parseInt("07")` / `parseInt(null)` | `7` / `NaN` | 默认按 10 进制；非字符串先转字符串 |
| `+" 12 "` / `+"12px"` | `12` / `NaN` | 一元 `+` 等价 `Number` |
| `` `${ {a:1} }` `` / `String(10n)` | `"[object Object]"` / `"10"` | 模板字符串用 string hint |
| `BigInt(42.5)` / `Number(Symbol("x"))` | `RangeError` / `TypeError` | 会丢精度的小数禁止转 BigInt；Symbol 不可转数字 |
| `1 + "2" + 3` / `"5" - 3 - 1` | `"123"` / `1` | `+` 是唯一「也可能是拼接」的运算符 |
| `Number.isFinite("12")` / 全局 `isFinite("12")` | `false` / `true` | 全局版会先转数字，别混用 |

对象参与运算先执行 `ToPrimitive`，顺序固定：`Symbol.toPrimitive`（若定义则一切以它为准）→ hint 为 `number` 时先 `valueOf` 后 `toString` → hint 为 `string` 时先 `toString` 后 `valueOf`。实跑：

| 对象 | 表达式 | 结果 |
| --- | --- | --- |
| `{ toString: () => "T", valueOf: () => 42 }` | `obj + 0` / `String(obj)` / `obj == 42` | `42` / `"T"` / `true` |
| 自定义 `Symbol.toPrimitive`，number 返 `7`、string 返 `"S"`、default 返 `"def"` | `Number(p)` / `String(p)` / `p + ""` / `+p` / `p == 7` | `7` / `"S"` / `"def"` / `7` / **`false`** |
| `new Date(0)` | `d + 0` / `Number(d)` | `"...GMT+0800 (中国标准时间)0"`（字符串拼接） / `0` |
| `[1, 2]` | `[1,2] + ""` / `+[1,2]` | `"1,2"` / `NaN` |
| `Object.create(null)` | `+ ""` / `String(...)` | **`TypeError: Cannot convert object to primitive value`** |

两行值得单独记：`p == 7` 为 `false`，因为 `==` 给的 hint 是 `default`（拿到 `"def"` → `NaN`），`default` 与 `number` 不是一回事；`Object.create(null)` 与 `Object.groupBy` 的结果**没有 `toString`**，放进模板字符串会抛错而不是输出 `[object Object]`。

## null 与 undefined 的分工

| 项 | `undefined` | `null` |
| --- | --- | --- |
| 语义 | 还没有值（系统默认） | 有意为空（你显式写的） |
| 谁产生 | 未初始化的 `let`、缺省实参、无返回值的函数、读不存在的属性、`delete` 后读取 | 只能自己赋值；浏览器 API 习惯用它表示「没找到」（`getElementById`） |
| `typeof` | `"undefined"` | `"object"` |
| 转数字 / 转字符串 | `NaN` / `"undefined"` | `0` / `"null"` |
| 在 JSON 里 | 对象属性被丢弃，数组元素变 `null` | 保留为 `null` |

两者可以一起用 `?? ` 或 `!= null` 处理，但**别在同一份数据里混用**——「查不到」与「没返回」混着放，`if (v === null)` 就成了随机事件。

## 暂时性死区与 let/const 的未初始化访问

`var` 的声明提升并立即初始化为 `undefined`；`let`/`const` 的绑定同样提前建立，但**声明语句执行前不可访问**，这段区域叫暂时性死区（temporal dead zone, TDZ）。

| 代码 | 实跑结果 |
| --- | --- |
| `console.log(v); var v = 1;` | 打印 `undefined` |
| `console.log(x); let x = 1;` | `ReferenceError: Cannot access 'x' before initialization` |
| `typeof x; let x;` | 同样抛 `ReferenceError` |
| `const c;` | `SyntaxError: Missing initializer in const declaration`（解析期就失败） |

抛错不是刁难：TDZ 把「先用后声明」从静默拿到 `undefined` 变成立刻炸给你看。它与作用域、闭包的关系留在[第 4 章 函数、作用域、闭包与 this](/javascript/functions-and-scope)。

## 可选链与空值合并

| 表达式 | 实跑结果 | 关键点 |
| --- | --- | --- |
| `o.x?.b` | `undefined` | `?.` 遇 nullish 短路**整条链** |
| `o.x.b` | `TypeError: Cannot read properties of undefined (reading 'b')` | 对比就是这条报错 |
| `o.a.b?.()` | `undefined` | `?.()` 只在左侧可调用时才调用 |
| `o.x?.y()` | `undefined` | 后半段整块跳过，不会去调用 `y` |
| `null ?? 0` / `undefined ?? "u"` | `0` / `"u"` | 只判 nullish |
| `0 ?? 99` / `'' ?? "x"` / `false ?? 5` | `0` / `""` / `false` | 这就是 `??` 与 `\|\|` 的全部差别 |
| `0 \|\| "x"` / `'' \|\| "x"` | `"x"` / `"x"` | `\|\|` 走 falsy |
| `1 \|\| 2 ?? 3` | **`SyntaxError: Unexpected token '??'`** | `??` 不能与 `\|\|`/`&&` 无括号混写 |

两个反例：`count ?? 0` 救不了 `NaN`（它不是 nullish，要用 `Number.isFinite()`）；`a?.b.c` 只保护 `a`，`a.b` 为空照样抛，得写 `a?.b?.c`。

## 这些语义在 TypeScript 里怎么被表达

JS 的规则是运行时事实，TS 只是把它们写进类型系统（编译后仍靠这些语义生效）：

| JS 事实 | TS 里的表达 |
| --- | --- |
| 7 种原始类型 | `undefined`/`boolean`/`number`/`bigint`/`string`/`symbol`/`null` 七个类型名一一对应，`object` 是「非原始」的统称，见 [基础类型与类型注解](/typescript/basic-types) |
| `typeof` 返回字符串 | 它是最好的**类型守卫**：`if (typeof v === "string")` 之后分支里 `v` 被收窄，见 [联合类型与收窄](/typescript/unions-and-narrowing) |
| `typeof null === "object"` 不可靠 | TS 里判 null 用 `v === null`；`strictNullChecks` 把 `null`/`undefined` 变成必须处理的独立类型 |
| `undefined` 与「属性不存在」难分 | 可选属性 `address?: City` 的类型就是 `City \| undefined`，这是 `?.` 与 `??` 在 TS 代码里高频的原因 |
| 浅拷贝只挡顶层 | `Readonly<T>` 同样只挡顶层赋值，与 `Object.freeze` 的浅保护一一对应 |
| `1n + 1` 抛 TypeError | TS 直接禁止 BigInt 与 Number 混算，编译期报错 |
| `??`/`?.` 依赖运行时短路 | TS 检查的是「按类型不该为空」，运行时检查的是「按值确实为空」，两者都成立才安全 |

## 常见错误与排查

1. **以为 `{...obj}` 是深拷贝。** 现象：改副本内层，原件跟着变。原因：只拷第一层。怎么确认：`copy.inner === obj.inner`（实跑 `true`）。修法：那条路径单独 `structuredClone`；用 JSON 往返前先确认没有 `undefined`/函数/`Date` 依赖。
2. **用 `typeof` 判断对象或数组。** 现象：`null` 与数组都进了对象分支。怎么确认：同时打印 `typeof v`、`Array.isArray(v)`。修法：`v !== null && typeof v === "object"`；数组一律 `Array.isArray`（`instanceof Array` 在跨 realm/iframe 场景会失效——该结论来自 MDN，未在本机验证）。
3. **用 `==` 图省事。** 现象：`[] == false`、`[1] == 1` 为真，脏数据穿过校验。怎么确认：加一行 `console.log(typeof a, typeof b, a === b)`。修法：全改 `===`，只保留 `!= null` 例外，并开 ESLint `eqeqeq`。
4. **用 `indexOf` 判断元素是否存在，而元素可能是 NaN。** 现象：`[NaN].indexOf(NaN)` 得 `-1`。原因：`indexOf` 用 `===`。修法：`includes`（SameValueZero，实跑 `true`）或 `findIndex(x => Number.isNaN(x))`。
5. **`parseInt` 与 `Number` 混用导致半串通过。** 现象：`parseInt("10px")` 得 `10`，垃圾输入被接受。原因：`parseInt` 遇非法字符只是停下来。修法：校验用 `Number(str)` + `Number.isFinite()`；做进制转换时**永远写第二个参数**（`parseInt("0x10")` 是 16，`parseInt("10", 2)` 是 2）。
6. **把 TDZ 报错当成环境问题。** 现象：`Cannot access 'x' before initialization`，你怀疑循环依赖。怎么确认：报错含 `before initialization` 就是死区，与模块无关。修法：把使用点移到声明后；真正的模块初始化顺序问题见[第 9 章 ES 模块](/javascript/modules-and-iterators)。
7. **`count || 默认值` 吃掉 0 与空串。** 现象：数量 0、`enabled = false` 提交后被换成默认值。修法：给默认值用 `??`，只有「假值也想替换」才用 `||`。

## 练习

<Exercise title="练习 1 · 预测输出并解释（转换与 typeof）" difficulty="基础">

先写预测，再运行。

```js
const x = { v: 1 };
const y = { ...x };
x.v = 2;
console.log('1:', x.v, y.v, x === y);
console.log('2:', [typeof null, typeof undefined, typeof x].join('|'));
console.log('3:', [] == 0, [] === false, [1] == 1, NaN == NaN, Object.is(NaN, NaN));
console.log('4:', Number(''), Number(null), Number(undefined), Number([1, 2]), parseInt('0x1f'), parseInt('19a'));
console.log('5:', 1 + "2" + 3, "5" - 3 - 1, [] + 1, `${ { a: 1 } }`);
```

<template #answer>

实跑（Node v25.4.0）：

```text
1: 2 1 false
2: object|undefined|object
3: true false true false true
4: 0 0 NaN NaN 31 19
5: 123 1 1 [object Object]
```

1. `y` 只拷了第一层，`v` 是原始值所以独立。若 `x` 里是 `inner: {...}`，这一行就变成 `2 2 false`——内层共享。
2. `typeof null` 与对象的 `typeof` 都是 `"object"`，靠 `typeof` 区分不了。
3. `[] == 0`：`[]` → `""` → `0`。`[] === false`：`===` 不做转换。`[1] == 1`：`[1]` → `"1"` → `1`。
4. 空串与 `null` 转 `0`，`undefined` 与多元素数组转 `NaN`；`parseInt` 认 `0x` 前缀（31），遇非法字符截断（19）。
5. 第一个 `+` 右侧是字符串 → 全程拼接；`-` 一律转数字；`[] + 1` 里 `[]` 转成 `""`；模板字符串对对象走 string hint。

</template>

</Exercise>

<Exercise title="练习 2 · 预测输出并解释（传参语义）" difficulty="基础">

```js
function reassign(o) { o = { n: 10 }; }
function mutate(o) { o.n = 10; }
const a = { n: 1 };
reassign(a); console.log('1:', a.n);
mutate(a);   console.log('2:', a.n);

const arr = [1, 2, 3];
function f(list) { list.pop(); list.push('x'); }
f(arr); console.log('3:', JSON.stringify(arr));
const q = structuredClone(arr); q.push('deep');
console.log('4:', JSON.stringify(arr), JSON.stringify(q));
```

<template #answer>

```text
1: 1
2: 10
3: [1,2,"x"]
4: [1,2,"x"] [1,2,"x","deep"]
```

`1`：`reassign` 换掉的是**形参**这个局部变量的指向，调用方的引用没动。`2`：`mutate` 沿同一地址改属性，外部可见。`3`：数组也是引用，`pop`/`push` 就地修改——这就是「函数偷偷改了外面的数组」的机制。`4`：`structuredClone` 切断所有共享，之后 `q.push` 影响不到 `arr`。

通用排查动作：在函数入口打印 `outer === argument`，为 `true` 就说明你手里是同一个对象。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造四个报错" difficulty="进阶">

写出最小复现：两个 `TypeError` 来自值转换，一个来自无原型对象，再加一个**解析期**就失败的例子。给出验证命令与真实报错原文。

<template #answer>

```js
1n + 1;                       // TypeError: Cannot mix BigInt and other types, use explicit conversions
"a" + Symbol("a");            // TypeError: Cannot convert a Symbol value to a string
String(Object.create(null));  // TypeError: Cannot convert object to primitive value
const c;                      // SyntaxError: Missing initializer in const declaration
```

本站真实输出（节选）：

```text
String(Object.create(null)) => TypeError: Cannot convert object to primitive value
const no init               => SyntaxError: Missing initializer in const declaration
```

验证命令：`node -e "String(Object.create(null))"`（换表达式即可）。

前三条都发生在**值转换**阶段而不是取属性阶段，第三条最实用：`Object.create(null)` 与 `Object.groupBy` 的结果没有 `toString`，拼进字符串会抛错。`const c;` 是解析期错误，整段脚本一行都不执行，必须与运行时错误分开处理。

</template>

</Exercise>

<Exercise title="练习 4 · 写一个把用户输入转成数字的函数" difficulty="进阶">

需求：空串与全空格视为「没填」返回 `null`；`"10px"`、`"abc"`、`"1e3"`、`"  42 "`、`"1_000"`、`"0x10"` 要有明确且可解释的结果；`NaN`、`Infinity` 一律拒绝。写出函数并说明为什么不用 `parseInt`。

<template #answer>

```js
function toNumber(raw) {
  if (typeof raw !== "string") return null;   // 不依赖隐式转换
  const s = raw.trim();
  if (s === "") return null;                  // 没填
  const n = Number(s);                        // 要求整串合法
  return Number.isFinite(n) ? n : null;       // 拒绝 NaN 与 ±Infinity
}
```

实跑对照：

| 输入 | 返回 | 依据 |
| --- | --- | --- |
| `"10px"` / `"abc"` | `null` | `Number("10px")` 是 `NaN` |
| `"1e3"` | `1000` | 科学计数法合法 |
| `"  42 "` | `42` | 先 trim（`Number(" 42 ")` 本身也是 42） |
| `"1_000"` | `null` | 数字分隔符只在字面量里有效 |
| `"0x10"` | `16` | `Number` 认十六进制前缀 |
| `"Infinity"` | `null` | `Number("Infinity")` 是 `Infinity`，被 `Number.isFinite` 挡掉 |

不用 `parseInt` 的原因：它遇到非法字符只是**停下来**，`parseInt("10px")` 得 `10`，脏输入被静默接受，且前缀会改变进制。另外别用全局 `isFinite`——它会先把参数转成数字（实跑：`isFinite("12")` 为 `true`，而 `Number.isFinite("12")` 为 `false`）。

</template>

</Exercise>

<Exercise title="练习 5 · 这段为什么不等于 7" difficulty="挑战">

```js
const p = { [Symbol.toPrimitive](hint) {
  return hint === "number" ? 7 : hint === "string" ? "S" : "def";
} };
console.log(Number(p), String(p), p + "", +p, p == 7);
```

预测五个输出，并解释最后一个。

<template #answer>

实跑：`7 S def 7 false`。

- `Number(p)` hint 为 `"number"` → `7`；`String(p)` hint 为 `"string"` → `"S"`；`+p` 要求数字 → `7`。
- `p + ""` 的 hint 是 `"default"` → `"def"`。
- `p == 7` 为 **`false`**：`==` 在「对象 vs 数字」时给的也是 `default` hint，拿到 `"def"`，`Number("def")` 是 `NaN`，`NaN == 7` 为 `false`。

落点：`ToPrimitive` 的 hint 有三个值，`default` 不等于 `number`（`Date` 正是利用这点让 `date + 1` 变成字符串拼接）。自定义了 `Symbol.toPrimitive` 之后，`==`、`+`、模板字符串的结果全由你写的函数决定，静态类型也救不了你。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN `typeof`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof) —— **已核实**：`typeof null` 的类型标签解释、返回值集合、对未声明标识符安全而对 TDZ 抛错。复核第一张表。
- [MDN `structuredClone`](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone) —— **已核实**：支持循环引用、不可克隆值抛 `DataCloneError`、支持类型清单。复核拷贝表第四行（Symbol 键丢弃、null 原型还原是本站实跑结论）。
- [MDN 相等性比较](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Equality) 与 [`Object.is`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is) —— 复核 `==` 表与 `NaN`/`-0` 两行。
- [MDN `parseInt`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt) 与 [`Number`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/Number) —— 复核「宽松截断 vs 整串严格」与练习 4。
- [javascript.info: Data types](https://javascript.info/data-types)、[Type Conversions](https://javascript.info/type-conversions)、[Comparisons](https://javascript.info/comparison)、[Object to primitive conversion](https://javascript.info/object-toprimitive) —— 主线对应小节，hint 三值在 `object-toprimitive` 讲得最清楚。
- [ECMA-262 当前草案](https://tc39.es/ecma262/) —— `ToPrimitive` 与 SameValueZero 的规范定义。
- 衔接：[基础类型与类型注解](/typescript/basic-types)、[联合类型与收窄](/typescript/unions-and-narrowing)、[函数、作用域、闭包与 this](/javascript/functions-and-scope)。

## 下一章

类型与引用回答「变量里装的是什么」，下一章回答「容器怎么装」：[对象、数组与常用方法](/javascript/objects-and-arrays) 会讲 `for...in` 为什么会遍历到原型上的属性、`Object.freeze` 为什么是浅冻结、`Map` 什么时候比对象合适、`JSON.stringify` 悄悄丢了哪些字段、数组其实是对象（`length` 可写、`map` 会跳过空洞）、以及 `sort` 的比较函数怎么写才不出错。本章三条结论会在那里反复用到：浅拷贝共享内层引用、`ToPrimitive` 决定 `+` 与 `==` 的结果、`NaN` 与 `-0` 在比较语义里的特殊地位。
