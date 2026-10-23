# 对象、数组与常用方法：数据容器的语义与你会反复写错的那些方法

`[10, 9, 100].sort()` 得到 `[10, 100, 9]`。`{...user}` 之后改 `user.address.city`，`user` 也变了。`for...in` 遍历数组时拿到的是字符串下标，还多出一个 `extra`。`JSON.stringify` 存进 `localStorage` 的对象读回来少了三个字段。`shift` 循环掏空 20 万个元素耗时 4 秒，换成 `pop` 只要 3 毫秒。

这些都不是「API 记不熟」，而是同一层事实的不同表现：**JS 的对象是属性字典，数组是带特殊 `length` 的对象，而所有便利方法都建立在这两套语义上**。

<Callout type="verified" title="本章所有输出都是本机运行结果">

环境：Node v25.4.0、Windows 10 x64、2026-10-17。表格里标注结果的地方都是真实输出，包括特性探测（`typeof Array.prototype.group`）与 `shift`/`pop` 的耗时对比。耗时数字只反映这台机器与这一次运行，量级可信、精确值不可复现。

</Callout>

## 对象字面量：点、方括号、计算属性名与简写

| 写法 | 何时用 | 实跑要点 |
| --- | --- | --- |
| `o.city` | 键名是合法标识符且写死 | `o.key` 找不到值为 `undefined`（不是报错） |
| `o[key]`、`o["first name"]`、`o[0]` | 键名来自变量、含空格、是数字 | `const key = "city"; o[key]` 得 `"Beijing"`——方括号里的东西会被**求值** |
| `{ ["k" + n]: "computed", [key]: "Beijing" }` | 计算属性名 | 得到真实键 `k1`、`city`（`Object.keys` 可见） |
| `{ x, y: 10, short() {...} }` | 简写：变量名即键名、方法简写 | `{x, ...o}` 里 `x` 的值就是变量 `x` 的 `7` |

三条只有跑过才记得住的细节：

- **展开会求值 getter**。`const o = { x: 7, get double() { return this.x * 2 } }`，`{...o}` 得到的是数据属性 `double: 14`（实跑），响应性、脏检查之类的逻辑在这一刻全部丢失。`JSON.stringify(o)` 同样是 `{"x":7,"double":14}`。
- **Symbol 键是隐形的**。`Reflect.ownKeys(o)` 能看到 `Symbol(id)`，但 `Object.keys`、展开、`JSON.stringify` 都把它过滤掉（三者实跑结果一致：符号键消失）。
- 数字键会被转成字符串：`keyed[1] = "one"` 紧接着 `keyed["1"] = "ONE"`，两个赋值落在同一个键上（实跑得 `ONE`），键列表里只有一个 `"1"`；对象作键会被 `toString` 成 `"[object Object]"`——所有对象键互相覆盖。这正是「用对象当字典要谨慎」的直接后果。

## 属性枚举与 for...in 的三个坑

`for...in` 遍历的是**所有可枚举属性，包括原型链上的**（enumerable）。实跑：一个 `Object.create(proto)` 的对象，自身有 `z`、`a`，原型上有 `inherited`，非枚举的 `hidden`，`for...in` 给出：

```text
for...in  => 1, 2, z, a, b, ro, inherited
Object.keys => 1, 2, z, a, b, ro        （只有自身可枚举）
own 名字（含非枚举）=> 1, 2, z, a, b, hidden, ro
```

三个坑与对应写法：

| 坑 | 现象 | 正确做法 |
| --- | --- | --- |
| 原型链属性混进来 | 你只加了 5 个键，却遍历出 7 个 | 循环体里 `if (!Object.hasOwn(obj, k)) continue`；老写法 `Object.prototype.hasOwnProperty.call(obj, k)`（键名可能就叫 `hasOwnProperty`，直接点调用会被覆盖） |
| 键永远是字符串 | 遍历数组得到 `"0"`、`"1"`（实跑 `typeof` 为 `string`），于是 `i + 1` 变成 `"01"` | 遍历数组用 `for...of`、`forEach` 或索引 `for` |
| 数组的自定义属性也被遍历 | 给数组挂了 `arr.extra`，`for...in` 多出 `extra`（实跑：`0,1,2,extra`） | 别给数组挂属性 |

`in` 与 `Object.hasOwn` 的区别也要记住：`'toString' in {}` 为 `true`（沿原型链找），`Object.hasOwn({}, 'toString')` 为 `false`。

键顺序不是随机的：**整数样式的键按数值升序排在前面，其余按插入顺序**（实跑 `Object.keys({b:1,2:1,a:1,10:1,1:1})` 得 `["1","2","10","b","a"]`）。别依赖这个顺序做业务逻辑——要有序就用 `Map`。

`Object.keys/values/entries` 三者是同一份数据的三种形状，配合 `Object.fromEntries` 可以完成「对象 ↔ 键值对数组」的双向转换（实跑：`Object.fromEntries(new Map([["a",1],["b",2]]))` → `{a:1,b:2}`；重复键后者覆盖前者）。

## 属性描述符：三个标志位，以及 freeze 是浅冻结

每个属性背后是一个描述符（descriptor）：数据属性有 `value` / `writable` / `enumerable` / `configurable`，访问器属性有 `get` / `set`。手写 `{ x: 1 }` 的三个标志全为 `true`（实跑），数组的 `length` 是 `writable: true, enumerable: false, configurable: false`（所以它不出现在 `Object.keys` 里，实跑）。`Object.defineProperty` 是唯一能改这些标志的入口，细节见 javascript.info 的 [Property flags and descriptors](https://javascript.info/property-descriptors)——本站路线只要求你知道它们存在、能读懂 `Object.freeze` 的效果。

`Object.freeze(obj)` 做的事就是把所有自身属性的 `writable`、`configurable` 关掉，**且只作用于第一层**（浅冻结）：

```js
const nested = { info: { tag: "a" }, list: [1, 2] };
const frozen = Object.freeze(nested);   // 返回同一个对象引用（实跑 frozen === nested 为 true）
frozen.info.tag = "changed";            // 成功：内层没被冻结
frozen.list.push(3);                    // 成功：得到 [1,2,3]
frozen.newProp = 1;                     // 非严格模式静默失败（实跑 newProp 是 undefined）
```

严格模式（ES Module、`class`、`"use strict"`）下给冻结对象赋值抛 `TypeError: Cannot assign to read only property 'a'`（实跑）。要「真的不可改」得递归冻结，或者用 TypeScript 的 `as const` 加运行时 `structuredClone` 出干净副本。

## Map、Set、WeakMap：什么时候不该用对象

| 维度 | 普通对象 | `Map` | `Set` |
| --- | --- | --- | --- |
| 键类型 | 只能 string/symbol | 任意值，包括对象、`NaN` | 任意值 |
| `NaN` 作键/成员 | 当作 `"NaN"` 字符串 | **可以**：`m.get(NaN)` 命中（SameValueZero，实跑） | 去重生效：`new Set([NaN, NaN])` 只剩一个（实跑 size 相关） |
| 两个内容相同的对象 | 覆盖同一个键 | **不同键**：`set({v:1},"a")` 与 `set({v:1},"b")` 得 size 2（实跑） | 同理不会去重 |
| 顺序 | 整数键优先，其余插入序 | 严格按插入顺序 | 按插入顺序 |
| 长度 | `Object.keys(x).length` | `.size`（O(1)） | `.size` |
| 原型污染风险 | 有：键可能撞上 `toString`、`__proto__` | 无（无原型字典语义） | 无 |
| 迭代 | 不可 `for...of`（实跑抛 `TypeError: ... is not iterable`） | `[...map]` 得键值对数组 | `[...set]` 得成员数组 |

选 `Map` 的三个信号：**键不是字符串**、**需要顺序保证**、**键名可能撞原型**。用 `Object` 的信号：这个结构最终要 `JSON.stringify`，或者它是「固定形状的记录」而不是「字典」。

`WeakMap` 的键是弱引用（对象可被 GC），因此**没有 `size`、没有 `keys()`、没有 `forEach`**（实跑：`wm.size` 为 `undefined`，后两者为 `"undefined"` 类型），也正因为如此它适合「给某个外部对象挂私有状态」——Vue 3 的响应式对象与原始对象之间的映射、以及各种「不想造成内存泄漏的缓存」都是它。`WeakSet` 同理。

## JSON 与序列化边界

`JSON.stringify` 不是「把对象存起来」，它只认 JSON 的六种值。实跑：

```js
JSON.stringify({ a: 1, b: undefined, c() {}, d: Symbol("s"), now: new Date(0) })
// => {"a":1,"now":"1970-01-01T00:00:00.000Z"}
JSON.stringify([1, undefined, function () {}, NaN, , 2])
// => [1,null,null,null,null,2]        （数组里 undefined / 函数 / NaN 全变 null）
JSON.stringify({ m: new Map([["k", 1]]), s: new Set([1, 2]), re: /ab/g })
// => {"m":{},"s":{},"re":{}}          （不报错，静默变空对象！）
JSON.stringify({ b: 10n })   // TypeError: Do not know how to serialize a BigInt
const circ = {}; circ.self = circ;
JSON.stringify(circ)         // TypeError: Converting circular structure to JSON
JSON.stringify({ n: Infinity })  // {"n":null}
```

| 被丢/被改变 | 表现 |
| --- | --- |
| `undefined`、函数、`Symbol` | 对象属性直接消失；数组元素变 `null` |
| `Date` | 变 ISO 字符串（`toJSON` 钩子），读回来是 string 不是 Date |
| `Map`/`Set`/`RegExp` | 变成 `{}`，**不报错**——最难查的一种 |
| 类实例 | 只剩数据字段，方法与 `instanceof` 全丢（实跑 `typeof back.say` 为 `undefined`） |
| 循环引用 | 抛 `TypeError` |
| `BigInt`、`Infinity`、`-Infinity` | 分别抛错 / 变 `null` |
| 稀疏数组的空洞 | 变 `null` |

`JSON.parse` 侧的两个坑（实跑）：`JSON.parse(undefined)` 抛 `SyntaxError: "undefined" is not valid JSON`——这就是 `JSON.parse(localStorage.getItem(k))` 在键不存在时炸掉的真实原因；单引号不是合法 JSON，报 `SyntaxError: Expected property name or '}' in JSON at position 0`。

想控制输出就实现 `toJSON()`（实跑：`{ date: new Date(0), toJSON(){ return { only: "me", d: this.date.getTime() } } }` → `{"only":"me","d":0}`），或用 `JSON.stringify(value, replacer)` / `JSON.parse(text, reviver)` 的第二个参数。深拷贝优先用 `structuredClone`（[第 2 章](/javascript/types-and-values) 已列出它的边界），JSON 往返只用于真的要走网络或存储。

## 数组其实是对象

| 事实 | 实跑证据 |
| --- | --- |
| `typeof []` 是 `"object"`，判数组只能 `Array.isArray` | 两者结果分别为 `"object"` / `true` |
| `length` 可写 | `const b=[1,2,3]; b.length=5` → 长度 5，但 `3 in b` 为 `false`（**空洞不是元素**）；`t.length=0` 直接清空 |
| `length` 不可枚举 | `Object.keys([9,8])` 得 `"0,1"`，`Object.getOwnPropertyNames` 才多出 `length` |
| 索引外的键就是普通属性 | `arr.extra="x"` 后 `for...in` 得到 `0,1,2,extra`；`arr[-1]="a"` 不改变 `length`（仍是 0）；`arr["1"]=9` 被当索引，`length` 变 2 |
| `delete arr[1]` 留空洞 | `length` 不变（3），`1 in a` 变 `false`；要真删用 `splice`（`[1,2,3].splice(1,1)` → `[1,3]`，`length` 2） |

稀疏数组（hole）是这一节最容易出事的地方：

```js
const sp = [1, , 3];   // length 3，下标 1 是空洞（不是 undefined）
```

| 方法 | 对空洞的行为（实跑） |
| --- | --- |
| `for...in` | 跳过：得到 `0,2` |
| `map` / `forEach` | 跳过回调：`sp.map(x => x*2)` → `[2, , 6]`；`forEach` 只调用 2 次 |
| `reduce`（带初值） | 跳过：`0+1+3` 得 `4` |
| `some` / `every` | 跳过（`sp.some(x => x === undefined)` 是 `false`） |
| `includes(undefined)` | **不跳过**：得 `true` |
| `Array.from` / 展开 / `flat` | 空洞读成 `undefined`；`JSON.stringify` 打成 `null` |

所以 `[...Array(3)]` 得到三个 `undefined`（可用），而 `Array(3).map(...)` 什么都不做（`Array(3)` 全是空洞）。构造「每个元素互不相同」的对象数组要用 `Array.from({ length: 2 }, () => ({}))`，用 `Array(2).fill({})` 会得到两个**同一个**对象（实跑：改 `a[0].v` 后两项都变）。

## 高频方法分组

### 变换：map / filter / reduce

`reduce` 的争议不在能力而在可读性：累加器在两个分支（有/无初值）下含义不同，空数组无初值会抛 `TypeError: Reduce of empty array with no initial value`（实跑），而且它天然诱导你**往累加器里塞可变对象**，把纯函数链变成一堆副作用。

**别用 `reduce` 的场景**：求和/求积之外的任何有分支的逻辑、需要边过滤边转换的流水线（拆成 `filter` + `map` 更好读）、初值会被就地修改的对象图。**该用的场景**：把数组折成非数组（分组、计数、字符串拼接、`Promise` 串行链）。用之前把初值写全，别省那一个 `{}` / `0`。

`map`/`filter` 返回新数组、长度规则固定（`filter` 只保留回调返回真值的元素）；三者回调签名都是 `(元素, 下标, 整个数组)`，**第二个参数是坑源**：`["1","2","3"].map(Number)` 安全，`["1","2","3"].map(parseInt)` 会得到 `[1, NaN, NaN]`，因为 `parseInt` 的第二参数是进制。

### 查找：find / findIndex / includes / indexOf / at

| 方法 | 返回 | 缺失时 | 实跑要点 |
| --- | --- | --- | --- |
| `find(fn)` | 第一个满足条件的**元素** | `undefined` | 别链式访问：`a.find(...).id` 会抛，要写 `?.` |
| `findIndex(fn)` | 下标 | `-1` | 与 `-1` 比较要显式写 `!== -1`（`~i` 那种技巧别留在业务代码里） |
| `includes(v)` | 布尔 | `false` | SameValueZero：`[NaN].includes(NaN)` 为 `true` |
| `indexOf(v)` | 下标 | `-1` | 用 `===`：`[NaN].indexOf(NaN)` 为 `-1` |
| `at(i)` | 元素或 `undefined` | `undefined` | 支持负数：`[1,2,3].at(-1)` 得 `3`，`at(5)` 得 `undefined` |
| `findLast` / `findLastIndex` | 从尾部找 | `undefined` / `-1` | 本机可用（`typeof Array.prototype.findLast` 为 `"function"`），属于 ES2023 |

### 结构：flat / flatMap / slice / splice / concat / push / pop / shift / unshift

| 方法 | 是否就地修改 | 实跑结论 |
| --- | --- | --- |
| `flat(depth)` | 否，返回新数组 | 默认深度 1：`[1,[2,[3,[4]]]].flat()` → `[1,2,[3,[4]]]`；`flat(Infinity)` 全展开并**去掉空洞** |
| `flatMap(fn)` | 否 | `[1,2].flatMap(x=>[x,x*10])` → `[1,10,2,20]`；深度固定 1，`flatMap(x=>[[x]])` 得到 `[[1],[2]]` 而不是 `[1,2]` |
| `slice(a,b)` | 否（拷贝） | `a.slice() === a` 为 `false` |
| `splice(i, del, ...add)` | **是** | 返回**被删掉的元素**：`[1,2,3,4].splice(1,2)` 得 `[2,3]`，原数组变 `[1,4]` |
| `concat(...)` | 否 | 只展开一层：`[1].concat([2,3],[4,[5]])` → `[1,2,3,4,[5]]`；元素是对象时仍是浅拷贝 |
| `push` / `unshift` | 是 | **返回新长度而不是新数组**：`[].push(1,2)` 得 `2`；`[3].unshift(1,2)` 得 `[1,2,3]` 长度 3 |
| `pop` / `shift` | 是 | 空数组上返回 `undefined`；`shift` 每次要把所有下标前移，代价见下 |
| `reverse` | **是** | `a.reverse() === a` 为 `true`——「反转后拷贝」要写 `[...a].reverse()` 或 `toReversed()` |

`shift` 是 O(n)：本站实跑把 20 万元素逐个掏空，`shift` 用 **4022 ms**，`pop` 用 **3.4 ms**（同一台机器、同一数组长度，只差「从哪头取」）。队列场景的三种解法：留一个 `head` 下标不真删、用两个数组（读栈/写栈）摊平、或换 `Deque` 结构。背后的机制（连续内存的下标重排、链表为什么反而不适合 JS）在 [数据结构（一）：线性结构](/computer-science/data-structures-linear)。

### 排序与比较

| 事实 | 实跑 |
| --- | --- |
| 默认按字符串的 UTF-16 序比较 | `[10,9,100].sort()` → `[10,100,9]`；`["10","9","1"].sort()` → `["1","10","9"]` |
| `sort` 就地修改并返回同一个引用 | `x.sort() === x` 为 `true` |
| 比较函数必须返回**数字** | 返回布尔会乱：`[3,1,2,5,4].sort((a,b)=>a>b)` → `[3,1,2,5,4]`（原样，因为 `true`→1、`false`→0 不构成一致序） |
| 返回 `NaN` 视为相等 | `[3,1,2].sort(()=>NaN)` → `[3,1,2]` |
| 稳定性自 ES2019 起是规范要求 | 同键保持输入序：6 条记录按 `g` 排序得 `BDFACE`（本机 V8 已验证） |
| 想要不改原件 | `toSorted()`（本机可用，ES2023）或 `[...arr].sort()` |

比较函数的正确写法：数字相减 `a.n - b.n`；字符串用 `a.name.localeCompare(b.name)`（`<`/`>` 比较的是 UTF-16 码元，中文、带重音拉丁字母都会排错；实跑 `localeCompare(b, "zh")` 得到符合拼音的顺序）；多字段用短路链：`(rank[a.status] - rank[b.status]) || (b.ts - a.ts)`。`undefined` 与空洞会被挪到末尾，不参与比较（[MDN `sort`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort) 已核实该条与稳定性、就地修改、默认字符串序）。

### 迭代协议、for...of、Array.from / Array.of

`for...of` 消费的是 `Symbol.iterator`：数组、字符串、`Map`、`Set`、类型化数组可迭代；**普通对象不行**（实跑抛 `TypeError: ... is not iterable`），所以 `for (const x of { a: 1 })` 是错的，要 `Object.entries(obj)` 再遍历。遍历字符串按码点而非码元：`for (const c of "中文a")` 得到 `中`、`文`、`a`（表情符号 `"...".length` 会大于实际字符数，长度问题见 javascript.info 的 [Unicode](https://javascript.info/unicode)）。

| 入口 | 用途 | 实跑 |
| --- | --- | --- |
| `Array.from(iterable 或 类数组, mapFn)` | 把 `Set`、`Map`、`NodeList`、`{length, 0:...}` 变数组，可带映射 | `Array.from(new Set([1,2,2]))` → `[1,2]`；`Array.from({length:3,0:"x"}, (v,i)=>v ?? i)` → `["x",1,2]` |
| `Array.of(...)` | 避开 `Array(7)` 的歧义 | `Array.of(7)` → `[7]`，而 `Array(7)` → 长度 7 的全空洞 |
| `[...x]` | 同样走迭代器 | 空洞被读成 `undefined` |

### 较新 API：本机探测结果

`typeof` 探测（Node v25.4.0，`typeof Array.prototype.group` 等）：

| API | 本机 | 备注 |
| --- | --- | --- |
| `Object.groupBy(arr, fn)` | **可用**（函数） | 返回**无原型**对象（实跑 `Object.getPrototypeOf(结果) === null` 为 `true`），键一定是自身属性，`Object.hasOwn` 检查安全。要 Map 形状就 `new Map(Object.entries(结果))` |
| `Array.prototype.group` / `groupToMap` | **不可用**（`undefined`） | 早期曾以数组方法形态实现，因 Web 兼容问题改成静态方法（[MDN `Object.groupBy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy) 已核实该说明）。别写 `arr.group(...)` |
| `toSorted` / `toReversed` / `toSpliced` / `findLast` | 可用 | ES2023；老浏览器没有，上线前查 [Can I use](https://caniuse.com/) |
| `Object.hasOwn` | 可用 | ES2022，优先于 `hasOwnProperty.call` |
| `structuredClone` | 可用 | 属于 Web API 不是 ECMAScript |
| `Array.prototype.flat` / `flatMap` | 可用 | ES2019 |

本站不写「某版本起支持」的具体年份断言时，一律以你实际运行环境的探测结果为准；跨版本部署前先跑一行 `typeof`。

## 解构与常用模式

```js
const { x, y: renamed = 5, ...rest } = obj;          // 重命名 + 默认值 + 剩余属性
const [first, , third = 10, ...others] = list;       // 跳过一项、给第三项默认值
let a = 1, b = 2; [a, b] = [b, a];                   // 交换变量（借助新数组，实跑得到 2,1）
const merged = { ...defaults, ...overrides };        // 浅合并：同名键后者胜出（内层对象被整体替换）
const { deep: { val } = {} } = obj;                  // 中间层可能为空时必须补默认值
```

两个必踩的坑（都实跑过）：

- **默认值只在 `undefined` 时生效**，`{ q = 0 }` 从 `{ q: null }` 解构出来还是 `null`；`0`、`""`、`false` 都不会触发默认值。
- **嵌套解构不会自动兜底中间层**：`const { deep: { val: renamed = "def" } } = {}` 抛 `TypeError: Cannot read properties of undefined (reading 'val')`，默认值写在 `val` 上没用——要写在外层：`const { deep: { val } = {} } = {}`（实跑得到 `"def"`）。

数组的解构可以取属性：`const { length: len } = [1,2,3]` 得 `3`。剩余属性语法（`...rest`）在对象上也有效（实跑得到 `{y:2,z:3}`）。

## 常用数据处理任务对照

以下每条都用同一份数据跑过（订单：`amy/paid/30/ts3`、`bob/pending/12/ts1`、`amy/paid/5/ts2`、`cara/refund/8/ts5`、`bob/paid/7/ts4`）：

| 任务 | 写法 | 实跑结果 |
| --- | --- | --- |
| 按键分组 | `Object.groupBy(orders, o => o.user)` | `amy:1+3 \| bob:2+5 \| cara:4` |
| 分组求和 | `orders.reduce((m,o)=>{ m[o.user]=(m[o.user] ?? 0)+o.amount; return m }, {})` | `{"amy":35,"bob":19,"cara":8}` |
| 去重（基本值） | `[...new Set(nums)]` | `[1,2,3,NaN,"1"]`（`NaN` 只留一个，`1` 与 `"1"` 都算不同成员） |
| 按字段去重 | `arr.filter((o,i,a)=>a.findIndex(x=>x.id===o.id)===i)` | 保留首次出现；`O(n²)`，量大改用 `reduce` + `Map`（实跑同样得到 `1,2`） |
| 求和 | `arr.reduce((s,o)=>s+o.amount, 0)` | `62` |
| 多字段排序 | `list.slice().sort((a,b)=>(rank[a.status]-rank[b.status]) \|\| (b.ts-a.ts))` | id 顺序 `5,1,3,2,4`：paid 组内按 `ts` 降序得 `5 1 3`，再 pending 的 2、refund 的 4 |
| 字符串字段排序 | `.sort((a,b)=>a.user.localeCompare(b.user))` | `amy,amy,bob,bob,cara` |
| 嵌套展开 | `orders.flatMap(o => o.tags)` | `["js","ts","css"]` |
| 挑字段重命名 | `arr.map(({ id, amount }) => ({ id, amount }))` | `[{"id":3,"amount":5},{"id":5,"amount":7},{"id":1,"amount":30}]` |
| 组数与每组数量 | `const g = Object.groupBy(list, o => o.user)`，组数用 `Object.keys(g).length`，每组用 `g[key].length` | 实跑得 3 个组，`amy` 组长度 2（`g.length` 是 `undefined`，分组结果不是数组） |

`slice()` 与扩展运算符都能拿到副本再排序——**直接 `sort()` 会改动原数组**，这是 React/Vue 里「我没 setState 它也变了」的头号来源。

## 常见错误与排查

1. **用 `for...in` 遍历数组。** 现象：下标变成字符串，`i + 1` 得到 `"01"`；原型或自定义属性被一起遍历出来。怎么确认：`for (const i in arr) console.log(typeof i)`（实跑 `string`）。修法：数组一律 `for...of` / `forEach` / 索引 `for`；只有「遍历对象的键」才用 `for...in` 且配 `Object.hasOwn`。
2. **以为 `Object.freeze` 或 `Readonly<T>` 挡住了内层修改。** 现象：冻结后仍能改 `obj.info.tag`。原因：浅冻结。怎么确认：`Object.isFrozen(obj.info)`。修法：递归冻结，或者接受「只挡一层」的语义并明确写进注释。
3. **`JSON.stringify` 存状态，读回来结构变了。** 现象：`Set` 变成 `{}`、`Date` 变字符串、`undefined` 字段消失、含循环引用的对象直接抛错。怎么确认：把 `JSON.stringify(原对象)` 打出来对比字段数量（实跑：`{"a":1,"now":"1970-...Z"}`）。修法：写显式的 `toJSON`/序列化层，或在内存里用 `structuredClone`；`Map`/`Set` 必须先转数组（`[...set]`）。
4. **`JSON.parse(localStorage.getItem(k))` 在键不存在时炸掉。** 现象：`SyntaxError: "undefined" is not valid JSON`。修法：`const raw = localStorage.getItem(k); const data = raw ? JSON.parse(raw) : 默认值`。这条报错信息足够特殊，见到就是这个问题。
5. **比较函数写成 `a > b` 或 `return a.name - b.name`。** 现象：排序结果「看着差不多但偶尔乱」，或者全是 `NaN` 时完全不排。原因：前者返回布尔（`true`/`false` 被当成 1/0，不构成一致序，实跑数组原样不动），后者对字符串做减法得 `NaN`（被当成相等）。修法：数字相减、字符串 `localeCompare`、对象字段先取属性再比。
6. **在响应式/不可变场景里用就地方法。** 现象：`state.list.push(x)` 或 `arr.sort()` 之后视图不更新、或别处的数组跟着变。原因：引用没变，基于比较的判断全部失效。修法：返回新数组（`[...arr, x]`、`toSorted`），并记住 `reverse`/`splice`/`sort`/`fill` 都是就地修改。
7. **`reduce` 不带初值，或累加器是共享对象。** 现象：空数组抛 `TypeError: Reduce of empty array with no initial value`；结果里的对象与输入对象是同一个引用。修法：永远写初值；需要在累加器里存结构时用 `{...}` 建新对象，或改完立刻 `structuredClone`。
8. **用对象当 `Map` 用。** 现象：`keyed[1]` 与 `keyed["1"]` 互相覆盖，`obj[{id:1}]` 变成 `"[object Object]"` 一个键，键名撞上 `toString`/`__proto__`。怎么确认：打印 `Object.keys(obj)` 看数量。修法：键是对象/数字/`NaN` 就换 `Map`，见下一节选型。

## 练习

<Exercise title="练习 1 · 预测输出：空洞、length 与迭代" difficulty="基础">

```js
const sp = [1, , 3];
console.log('1:', sp.length, JSON.stringify(sp), 1 in sp, sp.includes(undefined));
console.log('2:', sp.map(x => x * 2).length, Array.from(sp).length, [...sp].length);
const b = [1, 2, 3]; b.length = 5;
console.log('3:', b.length, 4 in b, JSON.stringify(b));
const arr = [10, 20, 30]; arr.extra = "x";
const keys = []; for (const i in arr) keys.push(i);
console.log('4:', keys.join(','), arr.length);
```

<template #answer>

实跑（Node v25.4.0）：

```text
1: 3 [1,null,3] false true
2: 3 3 3
3: 5 false [1,2,3,null,null]
4: 0,1,2,extra 3
```

- `1`：`length` 是 3 但下标 1 是**空洞**（`1 in sp` 为 `false`）；`includes(undefined)` 却不跳过空洞，返回 `true`。`JSON.stringify` 把空洞打成 `null`，所以打印看起来像有元素。
- `2`：`map` 跳过空洞但仍返回长度 3 的数组（结果里那一项仍是空洞）；`Array.from` 与展开会把空洞读成真实的 `undefined`，长度也是 3。
- `3`：`length` 可写，扩到 5 后新增的位置不是元素（`4 in b` 为 `false`）。
- `4`：`for...in` 遍历数组拿到的是字符串下标，并且把自定义属性 `extra` 也算进去，`length` 不受它影响。

</template>

</Exercise>

<Exercise title="练习 2 · reduce 分组并求和" difficulty="基础">

用 `reduce` 把 `orders` 按 `user` 分组，再算每组的 `amount` 总和；给出 `Object.groupBy` 版本的差异。数据：`[{u:"amy",a:30},{u:"bob",a:12},{u:"amy",a:5},{u:"cara",a:8},{u:"bob",a:7}]`。

<template #answer>

```js
const sum = orders.reduce((m, o) => {
  m[o.u] = (m[o.u] ?? 0) + o.a;
  return m;
}, {});                       // => {"amy":35,"bob":19,"cara":8}

const groups = orders.reduce((m, o) => {
  (m[o.u] ??= []).push({ a: o.a });
  return m;
}, {});                       // 分组保留明细：amy 两条、bob 两条、cara 一条
```

本站实跑求和结果：`{"amy":35,"bob":19,"cara":8}`（`??=` 是 ES2021 的逻辑空赋值，等价于 `if (!(k in m)) m[k] = 0`）。

`Object.groupBy(orders, o => o.u)` 的区别有三点：返回的对象**没有原型**（实跑 `Object.getPrototypeOf(结果) === null` 为 `true`，因此 `g.toString` 是 `undefined` 而不是函数）；它只分组不聚合，求和仍要再走一遍；初值不用你自己维护，误改共享对象的风险更低。**分组用 `groupBy`，聚合用 `reduce`**，是这一节最好记的结论。

</template>

</Exercise>

<Exercise title="练习 3 · 三种去重，并解释它们不等价" difficulty="进阶">

`const nums = [1, 2, 2, 3, 3, NaN, NaN, "1"]` 与 `const rows = [{id:1},{id:1},{id:2}]`。分别用 `Set`、`filter + findIndex`、`reduce + Map` 去重，写出结果并说明为什么 `new Set(rows)` 去不掉重复的 `{id:1}`。

<template #answer>

```js
[...new Set(nums)]     // => [1, 2, 3, NaN, "1"]
rows.filter((o, i, a) => a.findIndex(x => x.id === o.id) === i)   // => [{id:1},{id:2}]，保留首次出现
[...rows.reduce((m, o) => m.set(o.id, o), new Map()).values()]     // => 同样得到 id 1,2
```

实跑结论：`Set` 用 SameValueZero，所以 `NaN` 只留一个，但 `1` 与 `"1"` 是不同成员（结果里两个都在）。

`new Set(rows)` 得到 size 3：集合比较的是**引用**，`{id:1}` 与 `{id:1}` 是两个不同对象（这正是[第 2 章](/javascript/types-and-values) 引用语义的直接后果）。按字段去重必须显式提供键：`findIndex`、`Map` 键、或先 `map` 出键再建 `Set`。

性能上：`filter + findIndex` 是 O(n²)，一万条就明显；`reduce + Map` 是 O(n)，且能顺带决定「保留首次还是最后一次」（把 `m.set(o.id, o)` 换成 `if (!m.has(o.id)) m.set(o.id, o)` 就是保留首次）。数据量大或按键去重，一律走 `Map`。

</template>

</Exercise>

<Exercise title="练习 4 · 多字段排序：状态优先，时间倒序" difficulty="进阶">

状态优先级 `paid < pending < refund`，同状态内按 `ts` 从新到旧。给出比较函数，并解释为什么 `sort((a,b)=>a.status.localeCompare(b.status) || b.ts - a.ts)` 在业务上通常是错的。数据同前面的 `orders`（`rank = {paid:0, pending:1, refund:2}`）。

<template #answer>

```js
const rank = { paid: 0, pending: 1, refund: 2 };
const sorted = orders.slice().sort((a, b) => (rank[a.status] - rank[b.status]) || (b.ts - a.ts));
```

实跑顺序（id/状态/ts）：`5/paid/4`、`1/paid/3`、`3/paid/2`、`2/pending/1`、`4/refund/5`。

`||` 是关键：第一个字段相等（返回 `0`，falsy）时才继续比第二个字段；写成 `a.status.localeCompare(b.status) || b.ts - a.ts` 会按**字典序**排状态，得到 `paid < pending < refund` 恰好成立是巧合，一旦业务加一个 `"partially_paid"` 或把状态改成中文，顺序立刻错——**枚举顺序要显式表达成映射表，不能借字符串序**。

另外三点：`slice()`（或 `toSorted()`）防止改动原数组；`b.ts - a.ts` 是降序，反过来是升序；同键元素的相对顺序由排序稳定性保证（ES2019 起是规范要求，本机已验证得到 `BDFACE`）。

</template>

</Exercise>

<Exercise title="练习 5 · 故意制造三个报错" difficulty="挑战">

写出三个最小复现并给出真实报错：(1) `reduce` 相关的运行时错误；(2) `JSON.stringify` 因数据结构失败；(3) 把对象放进 `for...of`。

<template #answer>

```js
[].reduce((a, b) => a + b);
// TypeError: Reduce of empty array with no initial value

const circ = { name: "root" }; circ.self = circ;
JSON.stringify(circ);
// TypeError: Converting circular structure to JSON --> starting at object with constructor 'Object'

JSON.stringify({ v: 10n });
// TypeError: Do not know how to serialize a BigInt

for (const x of { a: 1 }) {}
// TypeError: {(intermediate value)} is not iterable
```

验证方式：`node -e "for (const x of {a:1}) {}"`。

排查线索全在报错文本里：`Reduce of empty array with no initial value` 说明数组为空且你省了初值（修法：补 `0`/`{}`/`[]`）；`Converting circular structure` 说明数据里有回指（Vue/React 的状态、带 parent 指针的树常犯），要浅层序列化或先剥离引用；`is not iterable` 说明你在拿对象当数组遍历，改 `Object.entries()`；`Do not know how to serialize a BigInt` 只能自定义 replacer 把 BigInt 转字符串，读回来再 `BigInt(s)` 还原。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN `Array.prototype.sort`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort) —— **已核实**：ES2019 起稳定性是规范要求、就地修改并返回同一引用、默认按字符串 UTF-16 序、`undefined` 与空洞挪到末尾、比较函数返回 `NaN` 视为相等。用来复核「排序与比较」整节。
- [MDN `Object.groupBy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy) —— **已核实**：因 Web 兼容问题从 `Array.prototype.group` 移到静态方法、当前广泛可用。用来复核「较新 API」表前两行。
- [MDN `Object.freeze`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze) 与 [`Object.defineProperty`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty) —— 核实浅冻结语义与三个标志位（本章的冻结行为同时有本机实跑）。
- [MDN `Map`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) / [`Set`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set) / [`WeakMap`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap) —— 核实 SameValueZero 键判定与 `WeakMap` 无 `size`/`keys`/`forEach`（本章这三点均实跑）。
- [MDN `JSON.parse`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse) / [`JSON.stringify`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify) —— 核实丢弃规则、`toJSON`、`replacer`/`reviver`。
- [javascript.info: Array methods](https://javascript.info/array-methods)、[Map and Set](https://javascript.info/map-set)、[Object keys, values](https://javascript.info/keys-values-entries)、[Destructuring](https://javascript.info/destructuring-assignment)、[JSON methods](https://javascript.info/json) —— 主线教材对应小节，方法清单比本站更全。
- [Can I use](https://caniuse.com/) —— 部署前核实 `toSorted`/`groupBy` 在你的目标浏览器上是否可用。
- 衔接：[数据结构（一）：线性结构](/computer-science/data-structures-linear)（`shift` 为什么是 O(n)）、[基础类型与类型注解](/typescript/basic-types)、[原型链、class 与封装](/javascript/prototypes-and-classes)。

## 下一章

本章处理「数据在容器里怎么放、怎么取」，下一章处理「行为与名字从哪来」：[函数、作用域、闭包与 this](/javascript/functions-and-scope)。你会在那里见到本章几处结论的根源——`map` 的回调为什么能记住外部变量（闭包与词法环境）、`this` 为什么在 `arr.forEach(function(){})` 里变 `undefined`、`var` 提升与暂时性死区的关系、以及箭头函数为什么不能当对象方法。回看本章时注意两件事已经和它有关：浅拷贝共享引用（第 2 章的引用语义）、就地修改与不可变更新的取舍（`sort`/`push`/`reverse` 那一组）。
