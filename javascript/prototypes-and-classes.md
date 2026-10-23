# 原型链、class 与封装：属性查得到查不到、方法为什么丢了 this

`class` 里的方法被当回调传出去，运行时报 `TypeError: Cannot read properties of undefined (reading 'n')`；`for...in` 遍历一个对象，突然多出几个你从没写过的键；把用户输入的 JSON 直接 `hasOwnProperty` 判断，结果对方传了个 `"__proto__"` 键，你的服务器差点被打穿；`Object.create(null)` 做出来的字典对象，调 `.hasOwnProperty()` 直接 `is not a function`。

这四个现象是同一套机制的四个断面：**对象自己不带那些属性，是它的原型链上有**；**沿链查找、写入、枚举各有各的规则**；**`class` 只是把这套规则换了个入口，但有几处行为是真的不一样**。这一章把链讲清楚，再讲封装在 JS 里到底有几种真实强度。

需要[函数、作用域、闭包与 this](/javascript/functions-and-scope) 里的 `this` 四条绑定规则作前置（本章大量报错就是它引起的），以及[对象、数组与常用方法](/javascript/objects-and-arrays) 里属性访问的基本写法。

## 三个名字先分清：`__proto__`、`prototype`、`getPrototypeOf`

它们指向的东西层次不同，混用是「原型说不清」的第一步。

| 名字 | 挂在谁身上 | 是什么 | 怎么用 |
| --- | --- | --- | --- |
| `[[Prototype]]`（内部槽） | 所有对象 | 这个对象**向上查找到哪** | 只能通过 `Object.getPrototypeOf` / `Object.setPrototypeOf` / `Object.create` / `extends` 操作 |
| `prototype`（属性） | **函数**（声明、表达式、class） | 将来 `new` 出来的实例的原型 | `Object.create(Fn.prototype)`、构造器用它接链 |
| `__proto__` | `Object.prototype` 上的一个**访问器属性** | `[[Prototype]]` 的历史读写入口 | 只用于读调试，别写进业务代码 |
| `constructor` | 原型对象上 | 指回函数的反向引用 | 可被覆盖，不可信；判断类型别靠它 |

箭头函数没有 `prototype`（[上一章](/javascript/functions-and-scope)已实跑：`typeof arrow.prototype` 为 `undefined`），所以它既不能被 `new`，也接不进原型链。

`__proto__` 的三个问题：它是访问器不是数据属性（读写都会走 `[[Prototype]]` 逻辑）；赋值非对象值会被**静默忽略**（`obj.__proto__ = 42` 不报错也不生效）；它的行为在历史上有过差异，标准里是 Web 兼容附录规定的。所以规则很简单：**读用 `Object.getPrototypeOf`，改原型用 `Object.create` 在创建时定好**。

`inst.prototype` 是 `undefined`——实例身上没有 `prototype` 属性，只有 `[[Prototype]]`。这是最常见的口误。

## 查找过程：沿链向上，到哪为止

实跑一条链（Node v25.4.0，脚本从标准输入读入，2026-10-17）：

```text
链逐级: Parent -> true -> true -> null
__proto__ === getPrototypeOf: true | inst.prototype: undefined
实例链: Cl -> Cl -> Object.prototype -> null
数组链: Array -> Array -> Object.prototype -> null
函数链: Function -> Function -> Object.prototype -> null
```

读法：`new Parent()` 的实例 → `Parent.prototype` → `Object.prototype` → `null`。**链顶是 `null`**，这也是查找的终止条件：查到 `null` 还没找到就返回 `undefined`（读）或什么都不做（写）。

三个由「查找规则」直接推出的行为，都验证过：

```js
const base = { greeting: 'base' };
const mid = Object.create(base);  mid.greeting = 'mid';   // 在 mid 上创建同名属性
const leaf = Object.create(mid);
leaf.greeting;                    // 'mid' —— 命中最近的影子
delete mid.greeting;
leaf.greeting;                    // 'base' —— 影子消失，露出下层
```

```text
leaf 取到: mid | 删影子后: base
```

1. **写入永远在对象自己身上写，不会沿链找 setter 之外的位置去改。** 给 `leaf.foo = 1` 不会修改 `base.foo`，而是在 `leaf` 上新建属性「挡住」它——这叫 shadowing（影子属性），`Object.create(proto)` 之后改属性是安全做法的根据。
2. **原型上的 getter 会让「赋值」变成静默失败。** 实跑（sloppy 模式）：`c.kind = '实例自己赋值'` 后 `c.kind` 仍是 `父`，一句错都不报。严格模式（ESM）里才抛：

```text
严格模式改只读访问器: TypeError: Cannot set property kind of #<P> which has only a getter
```

3. **Symbol 键也走原型链。** 实跑 `Symbol 键是否走原型链: 1 | in 对 Symbol: true`。所以 `Symbol.toStringTag`、`Symbol.iterator` 这些「行为开关」是靠原型链分发的，给实例挂 `[Symbol.iterator]` 就是在链上做影子。

## Function.prototype 在链上的特殊位置

它同时是「一个函数」和「所有函数的原型」，是原型体系里唯一自指的位置。实跑：

```text
Function.prototype 的 proto 是 Object.prototype: true
Function 的 proto 是 Function.prototype: true
普通函数的 proto: true | typeof Function.prototype: function
Object 的 proto 是 Function.prototype: true
```

连起来看：所有普通函数 → `Function.prototype` → `Object.prototype` → `null`；而 `Function` 和 `Object` 这些**内置构造器自己**也是函数，所以它们的 `[[Prototype]]` 是 `Function.prototype`。`typeof Function.prototype` 是 `function`（它本身是个「空函数形状」的对象，`call`/`apply`/`bind` 就从这里来），`Object.getPrototypeOf(Function.prototype)` 是 `Object.prototype`，不是它自己——链没有环。

实用价值只有一条：`Function.prototype.bind`、`.call`、`.apply`、`.toString` 都定义在 `Function.prototype` 上，所以「为什么函数能直接 `.bind()`」的答案是**函数不是对象之外的东西，它是 `Function.prototype` 的下游**。

## 自有属性还是继承来的：`hasOwn`、`hasOwnProperty`、`in`

| 判断 | 看原型链吗 | 常见坑 |
| --- | --- | --- |
| `k in obj` | 看 | `'toString' in {}` 为 `true`，用它判断「有没有这个字段」会误判 |
| `obj.hasOwnProperty(k)` | 不看 | 对象可能是 `Object.create(null)`，方法不存在；或键名被用户数据覆盖 |
| `Object.hasOwn(obj, k)` | 不看 | 需要较新引擎，老环境要兜底 |

实跑对照：

```text
ki: hasOwn p = true | in p = true | in method = true | hasOwn method = false
in toString = true | hasOwn toString = false
Object.create(null): null | typeof nullProto.hasOwnProperty: undefined
null 上取 hasOwnProperty: TypeError: Object.create(...).hasOwnProperty is not a function
```

`in` 的真正用途是判断「这个对象**能用**这个属性吗」（含继承），比如特性检测 `' geolocation' in navigator`；判断「数据里有没有这个键」用 `Object.hasOwn`。

**用 `hasOwnProperty` 直接点出来是安全漏洞面**：如果 `obj` 是 `JSON.parse(不可信输入)`，攻击者给 `__proto__` 赋值能改链；如果它自己带了个 `hasOwnProperty` 字段，你的调用会当函数用而抛错。所以两种安全写法二选一：

```js
Object.hasOwn(obj, key);                              // 首选
Object.prototype.hasOwnProperty.call(obj, key);       // 兜底，永远这样调用
```

遍历自身键用 `Object.keys` / `Object.entries` / `for...of Object.keys()`，别用 `for...in`（后者会把原型链上**可枚举**的键一起带出来）。`class` 的方法不可枚举（下面一节实跑），但用 `Fn.prototype.m = function(){}` 挂上去的方法可枚举——同一个类里两种方式，行为就不同，这是 `for...in`「突然多出键」的根源：

```text
for-in 枚举到: m | 总数: 1
for-in 枚举 class 方法? false | 手动加到原型上才可枚举: [ 'exposed' ]
```

## 构造函数与 `new` 的四步：手写一遍

`new F(args)` 做四件事：

1. 创建一个新对象，它的 `[[Prototype]]` 设为 `F.prototype`；
2. 以这个新对象为 `this` 调用 `F`（传入参数）；
3. 如果 `F` 的返回值是对象或函数，**用它作为 `new` 的结果**；
4. 否则返回步骤 1 的新对象。

实现与验证（Node v25.4.0 实跑）：

```js
function myNew(Ctor, ...args) {
  const obj = Object.create(Ctor.prototype);          // 1 + 2 的前半
  const result = Ctor.apply(obj, args);               // 2
  return (result !== null && (typeof result === 'object' || typeof result === 'function'))
    ? result                                          // 3
    : obj;                                            // 4
}
function Person(name) { this.name = name; }
Person.prototype.greet = function () { return `hi ${this.name}`; };
```

```text
手写 new: hi 阿明 | instanceof Person: true | proto 相同: true
构造器返回对象时 new 用它: 原生 false 手写 false
构造器返回原始值被忽略: 1 1
```

第二行是关键：`function ReturnsOther(){ this.a = 1; return {}; }` 里 `this.a = 1` **完全白做**——`new` 的返回值是那个空对象，`hasOwn(结果, 'a')` 为 `false`（原生 `new` 和手写版结果一致）。第三行是 `return 42` 被忽略，仍返回实例。推论：**构造器里不要 `return`**（除非你有意做单例/工厂，那种场景更该显式写个工厂函数）。

`new.target` 能区分「被 `new` 还是被直接调用」，实跑：

```text
new.target: 普通调用 / [object Object]
```

（写法是 `function F(){ return new.target === undefined ? '普通调用' : new F() }`——第二种返回的是对象，避免重复 `new` 的老式兼容技巧就是这么写的。现代做法是让必须 `new` 的东西直接做成 `class`。）

## `class` 是语法糖，但这几处是真的不一样

`class` 补的是构造函数写法的五个短板，全部实跑：

```text
class 方法描述符: {"enumerable":false,"writable":true,"configurable":true}
class constructor 可枚举: false
Object.keys(Bar.prototype): []
function 原型方法可枚举: true
class 不加 new: TypeError: Class constructor Bar cannot be invoked without 'new'
类声明 TDZ: ReferenceError: Cannot access 'Cls' before initialization
派生类不调 super: ReferenceError: Must call super constructor in derived class before accessing 'this' or returning from derived constructor
super 调两次: ReferenceError: Super constructor may only be called once
```

| 差别 | 后果 |
| --- | --- |
| 方法不可枚举 | `for...in`、`Object.keys` 看不到；`JSON.stringify` 场景无影响，但「用 for-in 复制方法」的老代码会静默漏掉 |
| 必须 `new` 调用 | 忘了 `new` 立刻抛 `TypeError`，而不是像构造函数那样把属性写满全局对象（[上一章](/javascript/functions-and-scope)的 `NaN` 事故） |
| 类声明在 TDZ 中 | 定义前使用报 `Cannot access ... before initialization`，与 `let` 同款；「先 import 后 class」的循环依赖会以这个形式炸 |
| 类体默认严格模式 | 方法里的 `this` 丢失会**抛错而不是静默写坏全局** |
| `constructor` 不可枚举、方法改动不影响实例 | 元数据更干净 |

还有一条常被当成「语法糖」而漏掉的：**`class` 的方法不在实例自己身上**。`Reflect.ownKeys(v)` 对实例返回空数组，方法在 `V.prototype` 上：

```text
class 原型 ownKeys: constructor,reveal | 实例 ownKeys:（空）
```

这就是「所有实例共享同一份方法、`this` 靠调用时决定」的物理原因，也是下一节 `this` 丢失的根源。

## `extends` 与 `super`：两条链，一次 `super()`

`extends` 同时接两条链，实跑：

```text
extends 双链: true true
class 静态方法可继承: A2.s
静态方法里的 this 是子类: S2
```

- **实例链**：`Sub.prototype` → `Super.prototype` → …，管方法查找；
- **构造器链**：`Sub` → `Super`（**类的静态成员沿这条链继承**，所以 `Sub.staticMethod()` 能落到 `Super` 上，且静态方法里的 `this` 是调用它的子类，`new this()` 会造出子类实例——模板方法模式的 JS 版就靠它）。

派生类构造器里的 `super()` 不是形式：`this` 在调用父类构造器之前**根本不存在**，所以 `super()` 之前访问 `this` 或提前 `return` 都抛 `ReferenceError`（上面两条报错原文就是这两种情况）。`super` 的语义还分两套：构造器里 `super()` 是「用父类构造器造 `this`」；方法里 `super.m()` 是「从**父类原型**开始查 `m`」，且 `this` 仍是当前实例（不是父类对象，很多人以为 `super.m()` 里的 `this` 变了）。

`extends` 一个未定义的名字是运行时 `ReferenceError`（实跑 `ReferenceError: NotDefined is not defined`），而 `super()` 出现在**没有 `extends` 的类里是语法错误**（`SyntaxError: 'super' keyword unexpected here`）——后者编译期就拦下，不会拖到运行。

## `#private` 字段：真正的私有，和它做不到的

先对比三种「私有」强度：

| 手段 | 外部能否读到 | 报错时机 | 说明 |
| --- | --- | --- | --- |
| `_name` 约定 | 能 | 不报错 | 纯靠自觉，`class` 之外唯一选项 |
| `WeakMap` 存状态 | 不能（拿不到 key 就取不到） | 不报错 | 需要模块级 `WeakMap`，跨实例共享，稍麻烦 |
| `#field` | **不能** | **写出来就是 SyntaxError** | 语言级私有 |

`#` 的真实强度由实跑证据决定：

```text
私有字段读取: inner | 静态私有计数: 1
class 原型 ownKeys: constructor,reveal | 实例 ownKeys:（空）
外部访问私有字段: SyntaxError: Private field '#secret' must be declared in an enclosing class
借 reveal 到别的对象: TypeError: Cannot read private member #secret from an object whose class did not declare it
```

第一行是 `Vault.prototype.reveal.call({})` 的失败：私有字段的访问权绑定在「**声明它的那个类**」上，不是绑定在方法上，所以借方法偷看别家对象会被挡。第三行更狠：`v.#secret` 写在类外面连**编译都过不去**，不是运行时才炸——`Reflect.ownKeys` 也列不出它，`JSON.stringify`、`Object.assign`、`structuredClone` 一律看不见。

做不到的是三件事：`#private` **不是 TS 的 `private`**（后者编译后消失，属性照样在对象上、运行时能读，见[TypeScript 对象类型与接口](/typescript/objects-and-interfaces)）；`#` 字段**每次构造都要初始化，性能比赋在 `this` 上略高开销**（是否显著取决于引擎，不在这里断言）；`static #count` 是类级共享，别当成「实例计数器」用（上面输出 `静态私有计数: 1` 是 `new` 一次的结果）。

另外，只有 getter 的静态访问器赋值：**严格模式（ESM）抛 `TypeError: Cannot set property count of class Vault { … } which has only a getter`**（V8 把整个类源码拼进了报错信息里），sloppy 模式下静默忽略、值不变（实跑两版对照：`sloppy 赋值后 V2.c = 1 （静默忽略）`）。

## 方法丢了 `this`：一个报错，三种修法

现象（class 方法放进数组当回调），实跑：

```text
class 方法当回调: TypeError: Cannot read properties of undefined (reading 'n')
bind 修法: 1
class 字段箭头绑定: 1,1,2 | a.n = 2
```

类方法在 `prototype` 上、不在实例上（上一节），一旦被摘下来单独调用，`this` 就是 `undefined`（类体严格模式）。三种修法各有代价：

```js
class Panel {
  count = 0;
  inc() { return ++this.count; }
  incBound = () => ++this.count;     // 修法 3：class 字段箭头函数
}
el.addEventListener('click', () => panel.inc());        // 修法 1：箭头包装（每次新函数）
el.addEventListener('click', panel.inc.bind(panel));    // 修法 2：bind（每次也新函数，除非提前绑好）
el.addEventListener('click', panel.incBound);           // 修法 3：字段箭头（每个实例一份，无需再 bind）
```

**`addEventListener` 的第三个坑**：如果你 `bind` 之后还想 `removeEventListener`，必须持有同一个函数引用，否则移除失败——`removeEventListener(el.click, panel.inc.bind(panel))` 里那个 `bind` 产生的新函数跟注册时的不是同一个，事件永远在。把 `this.handler = panel.inc.bind(panel)` 存起来再用它注册与移除。

框架里的对应物：Vue 的 `setup()` 里方法被解构传出、React 的 `<button onClick={obj.method}>`，本质都是「摘下来调用」，所以两边都有各自的修法约定，见[组合式 API、composables 与组件设计](/vue/composables)与[useRef 与受控组件](/react/refs-and-forms)。

## 组合优于继承：mixin 的三个坑

深继承的代价不是理论：三层继承的构造链要手写才能看清（实跑 `三层继承 trace: L1>L2>L3`），而中间层一旦调整初始化顺序，三层全要重审。**能用组合解决就别加一层类**。

JS 的组合有三种做法，各有已验证的坑：

**坑 1：`Object.assign` 复制会「求值」访问器。** 实跑：

```text
assign 后 formatted 还在吗: undefined（getter 没了，变成一个快照值）| emit: 复制成了普通函数
```

`Object.assign(target, Logger)` 里 `get formatted()` 被以 `Logger` 为接收者求值一次，`target` 拿到的是字符串而不是 getter；方法是复制过去的函数但**没有绑定**，之后 `this` 跟着新调用者。想要「保留原型语义」的组合应该用 `Object.create`：

```text
Object.create 组合: [log] composed | emit from Object
```

（第二行值得停一下：`composed.emit()` 里我读的是 `this.constructor.name`，结果 `Object.create(Logger)` 的原型链上没有带名字的构造器，所以是 `Object`。**靠 `constructor` 判类型是不可靠的**，用 `instanceof` 或显式标记。）

**坑 2：展开式 mixin 的名字冲突静默覆盖。** 实跑 `展开式 mixin 冲突结果: B（A 的实现被静默覆盖）`。`{ ...A, ...B }` 没有「多个 mixin 同名方法怎么办」的机制，最后一个赢，且**没有任何警告**。这是 mixin 相对继承最危险的地方：继承至少给你一条明确的链，mixin 给的是隐式优先级排序。

**坑 3：class mixin 工厂能工作，但要记得它同时接了两条链。** 实跑：

```js
const Timestamped = (Base) => class extends Base {
  constructor(...args) { super(...args); this.ts = 'created'; }
};
class Job { constructor() { this.name = 'job'; } }
const TimestampedJob = Timestamped(Job);
```

```text
class mixin: {"name":"job","ts":"created"} | instanceof Job: true
```

混入顺序影响 `instanceof` 与 `super` 调用次序，多层 mixin 时链变长——**mixin 数量超过两个，就该改成「显式持有依赖对象」的函数式组合**（把能力做成参数注入，而不是做成基类）。这与[分层架构与请求处理链路](/backend/layered-architecture)里「依赖显式传入、别靠继承拿上下文」是同一个原则。

## 鸭子类型与结构化类型：从 JS 到 TS 的那一步

JS 里「像就行」是运行时事实：`composed.emit()` 不关心接收者是哪个类，只关心它有没有这个属性；`JSON.stringify` 不看类型只看属性。这就是 duck typing（鸭子类型）。

TypeScript 把这个直觉变成了编译期规则：**结构化类型（structural typing）**——两个类型只要成员形状兼容就可以互相赋值，不需要声明继承关系。所以上一节的 `Object.create` 组合、mixin、`{ x: 1 }` 传给 `interface HasX { x: number }`，在 TS 里都是同一件事：**看形状，不看出身**。差别是 TS 会在编译期把「形状不够」拦住（并有多余属性检查），而 JS 让你运行到那一行才知道。

对照细节见[TypeScript 对象类型与接口](/typescript/objects-and-interfaces)（接口与结构化兼容）与[为什么需要类型](/typescript/why-types)（结构类型 vs 名义类型）。本章能给出的直接预演：`instanceof` 是 JS 里唯一接近「名义类型」的手段，而 TS 收窄联合类型时最常用的 `if (x instanceof Foo)` 就是包在它外面——见[联合类型与收窄](/typescript/unions-and-narrowing)。

## 多态与 `instanceof`：链判断，以及能改写它的钩子

`instanceof` 的算法不是「看对象身上写了什么」，而是**沿右操作数的 `prototype` 在左操作数的原型链上找同一个对象**。所以 `Object.create` 和 `setPrototypeOf` 能直接改变结果，实跑：

```text
Object.create(Person.prototype) instanceof Person: true
setPrototypeOf 后: true | greet 结果: hi undefined
原始值 instanceof: 1 instanceof Number => false | Object.create(Number.prototype) instanceof Number => true
null instanceof Object: false | undefined instanceof Object: false
```

四个必须知道的结论：

1. **`instanceof` 检查的是链，不是「是不是 new 出来的」。** 手写 `myNew` 造的实例、`Object.create(Fn.prototype)` 造的对象，全都 `instanceof Fn` 为 `true`。
2. **原始值永远不 `instanceof` 它的包装类型**（`1 instanceof Number` 是 `false`），这是历史遗留的「包装对象」设计；判断原始类型用 `typeof`。
3. **`null`/`undefined` 对任何 `instanceof` 都是 `false`**，不抛错，适合做守卫的默认分支。
4. **跨 realm 会失效**：iframe、`worker_threads`、`vm` 里创建的 `Array` 对主线程的 `Array` 不 `instanceof`（各自的 `Array.prototype` 不是同一个对象）。所以库代码里判断数组用 `Array.isArray`，它检查内部槽而不是比链。

`Symbol.hasInstance` 能把上面 4 条从「坑」变成「可控」，实跑：

```text
自定义 hasInstance: {__isCustom:true} => true | [1] => false | [] instanceof Array => true | /re/ instanceof RegExp => true | function instanceof Function => true
Symbol.hasInstance 可覆盖: true
```

多态的实现路径因此有三种，选法有明确依据：

| 手段 | 适合 | 不适合 |
| --- | --- | --- |
| 原型链覆盖（子类同名方法） | 语义上确属「是一种」，且需要 `super` 复用 | 需要跨类拼装能力时 |
| 鸭子类型（传入函数/对象） | 行为可组合、便于测试；`Array.map` 只关心回调签名 | 需要运行时校验形状时 |
| `Symbol.hasInstance` | 框架做「看起来像某类」的定制判断 | 业务代码里滥用会让 `instanceof` 不可信 |

## `Object.setPrototypeOf` 与「动态改原型」的性能警告

`Object.create(proto)` 在**创建时**指定原型，是安全的；`Object.setPrototypeOf(obj, proto)` 是**创建后**改链，会打断引擎为该对象形状（hidden class / map）做的内联缓存优化，之后的属性访问可能退化成慢路径。引擎还有 `__proto__` 赋值这条同样危险的入口。

<Callout type="unverified" title="性能影响幅度未在本机基准测过">

「改原型会让后续访问变慢」是引擎实现层面的通行说法，**具体影响多少、在 V8 当前版本里是否已被优化，请以你自己在目标引擎上的基准为准**，本站不给倍率数字（我没有在本任务里跑 microbenchmark，也没核实 V8 内部策略的当前状态）。可落地的规则不需要数字支撑：需要「继承关系」就在创建时用 `Object.create` 定好；需要「换一套行为」就**新建对象**或改用组合，别对已经热起来的对象调 `setPrototypeOf`。`Reflect.setPrototypeOf` 语义与它一致，只是返回布尔值，同样别进热路径。

</Callout>

真实用途只有两类：polyfill 时代给宿主对象补方法（现在用 `class`/`Object.assign` 或 `Symbol` 更好），以及代理/mock 框架动态换实现。业务代码里出现它，通常说明该用组合。

## 常见错误与排查

**1. `class` 方法当回调：`Cannot read properties of undefined (reading 'xxx')`。** 原因：方法在 `prototype` 上，摘下来调用时 `this` 为 `undefined`（类体严格模式）。确认：报错里读的属性正是你方法里第一个访问的字段；把 `console.log(this)` 加到方法第一行输出 `undefined`。修法：箭头包装 / 提前 `bind` 存引用 / 改成 class 字段箭头函数（见「三种修法」）。

**2. `obj.hasOwnProperty is not a function`。** 原因：对象来自 `Object.create(null)` 或用户 JSON 里覆盖了这个键。确认：报错原文是 `is not a function`，且 `Object.getPrototypeOf(obj)` 是 `null`。修法：改用 `Object.hasOwn(obj, k)` 或 `Object.prototype.hasOwnProperty.call(obj, k)`。

**3. `for...in` 遍历出莫名多的键。** 原因：原型链上有**可枚举**属性（`Fn.prototype.m = ...` 挂的、或第三方库往 `Object.prototype` 上加的）。确认：`Object.keys(obj).length` 与 `for...in` 计数不一致，或打印 `Object.getPrototypeOf(obj)`。修法：改用 `Object.keys`/`entries`；必须用 `for...in` 时加 `if (Object.hasOwn(obj, k))`。

**4. 子类构造器忘写 `super()`。** 报错原文已核：`ReferenceError: Must call super constructor in derived class before accessing 'this' or returning from derived constructor`。原因：派生类的 `this` 要由父类构造器创建。修法：`extends` 的类里构造器第一件事就是 `super(...)`（且只能调一次，第二次报 `Super constructor may only be called once`）。

**5. `class X extends Y` 时 `Y` 未定义。** 现象：`ReferenceError: Y is not defined`，且报错指向 `class` 那一行而不是使用处。原因：类声明在 TDZ 中，`extends` 表达式在**定义时**就求值（实跑确认），而循环导入的模块里父类可能还没初始化。确认：把 `class` 挪到文件顶部仍报错 → 是父类来源问题；只有下面代码用到才报错 → 是拼写。修法：拆出依赖方向，或改用组合注入。

**6. `instanceof` 判断为 `false` 但类型明明是对的。** 原因：跨 realm（iframe/worker/`vm`）、或对象被 `structuredClone`/JSON 往返后重建、或用了自定义 `Symbol.hasInstance`。确认：`obj.constructor.name` 与 `Object.prototype.toString.call(obj)`（后者更可靠，`[object Array]`）是否匹配。修法：数组用 `Array.isArray`，日期用 `!Number.isNaN(d.getTime())` 或 `Object.prototype.toString`，需要跨 realm 就显式打标记字段或用品牌 Symbol。

**7. 给原型上的 getter 同名属性赋值，值「不生效也不报错」。** 实跑：sloppy 模式下 `c.kind = 'x'` 后仍是 `父`。确认：`Reflect.getOwnPropertyDescriptor(Object.getPrototypeOf(c), 'kind').get` 存在；换到模块/严格模式就抛 `TypeError: Cannot set property kind ... which has only a getter`。修法：改成 `Object.defineProperty` 明确定义 setter，或换个属性名。

**8. 混入（mixin）里两个来源同名方法，只有一个生效。** 现象：某个能力「装了但没反应」。确认：`{ ...A, ...B }` 与 `Object.assign` 的顺序，后写的赢；`console.log(obj.greet.toString())` 看函数体是谁的。修法：显式包装并保留调用（`greet: () => A.greet() + B.greet()`），或用装饰顺序明确的组合，别依赖展开顺序。

## 练习

<Exercise title="练习 1 · 手写 new 并解释报错" difficulty="进阶">

不用 `new`，用 `Object.create` 加函数调用做出等价物，要求：① 支持任意参数；② 正确处理构造器返回对象的情况；③ 让结果 `instanceof` 构造器为 `true`。然后回答：构造器里 `return null` 和 `return {}` 的结果为什么不同？

<template #answer>

```js
function myNew(Ctor, ...args) {
  const obj = Object.create(Ctor.prototype);
  const result = Reflect.apply(Ctor, obj, args);
  return result !== null && (typeof result === 'object' || typeof result === 'function')
    ? result
    : obj;
}
```

`return {}` 走第 3 步：结果就是那个空对象，`this.a = 1` 的效果留在没人引用的 `obj` 上被回收，所以 `Object.hasOwn(new X(), 'a') === false`（实跑输出 `构造器返回对象时 new 用它: 原生 false 手写 false`）。

`return null` **不**走第 3 步：判定条件要求「是对象**且非 null**」，`typeof null === 'object'` 是历史错误，所以要显式排除 `null`；不排除时你的手写版会返回 `null`，与原生 `new` 行为不一致——这是本题最常见的写法 bug。返回原始值（`42`）同样被忽略，实例照常返回（实跑 `构造器返回原始值被忽略: 1 1`）。

</template>

</Exercise>

<Exercise title="练习 2 · 预测查找结果" difficulty="基础">

写出四行输出的值，并指出第 3 行为什么不是 `undefined`。

```js
const a = { x: 1, getX() { return this.x; } };
const b = Object.create(a); b.y = 2;
const c = Object.create(b); c.x = 3;
console.log(c.x);
console.log(c.y);
console.log(c.getX());
console.log(a.getX.call(c));
```

<template #answer>

`c.x` → `3`（自己的影子赢）。`c.y` → `2`（沿链到 `b` 命中）。`c.getX()` → `3`——**方法在 `a` 上被找到，但调用接收者是 `c`**，`this` 是 `c`，于是读 `c.x`；这条正好把「属性沿链查」和 `this` 由调用方式定两件事连起来。最后一行 → `3`（`call` 显式把接收者设成 `c`，与 `c.getX()` 等价，证明 `getX` 只有一份、`this` 是每次调用现算的）。

顺带验证：`Object.hasOwn(c, 'getX')` 为 `false` 而 `'getX' in c` 为 `true`——本章表格里两行的直接应用。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释报错" difficulty="基础">

下面代码有三处独立问题，分别说出报错原文或静默后果，并修掉它们。

```js
class Store {
  items = [];
  addItem(v) { this.items.push(v); }
}
const store = new Store();
[1, 2, 3].forEach(store.addItem);
const raw = JSON.parse('{"hasOwnProperty":"yes"}');
console.log(raw.hasOwnProperty('hasOwnProperty'));
class Bad extends Undefined { }
```

<template #answer>

**第一处：`forEach(store.addItem)` 丢了接收者。** `forEach` 只传 `(value, index, array)`，不带接收者，类方法里的 `this` 为 `undefined`，抛 `TypeError: Cannot read properties of undefined (reading 'items')`（与本章 class 回调报错同一族，只是属性名不同）。修法：`forEach((v) => store.addItem(v))`。顺带一个逻辑错：`addItem(v)` 会把 `index` 忽略掉所以还算对，但如果签名是 `(v, extra)` 就会被 `index` 污染——**别把方法直接传给带多参数的迭代器**。

**第二处：`raw.hasOwnProperty` 是字符串。** 抛 `TypeError: raw.hasOwnProperty is not a function`。修法：`Object.hasOwn(raw, 'hasOwnProperty')`，或 `Object.prototype.hasOwnProperty.call(raw, 'hasOwnProperty')`。这就是「用户数据能覆盖你的方法」的最小可复现例子。

**第三处：`class Bad extends Undefined {}`。** 类定义语句本身就抛 `ReferenceError: Undefined is not defined`（`extends` 的表达式在定义时求值，实跑确认），不是等到实例化才炸。修法：检查父类来源与导入顺序；真要延迟绑定时改用组合而不是 `setPrototypeOf`。

</template>

</Exercise>

<Exercise title="练习 4 · 用 WeakMap 实现一种真私有" difficulty="挑战">

在不能用 `#` 的场景（需要被 `Object.assign` 合并、或要保持旧环境兼容）里，用模块级 `WeakMap` 给 class 做私有状态：外部读不到，实例被回收后状态也能回收。写出来并说明它比 `#field` 弱在哪里。

<template #answer>

```js
const state = new WeakMap();          // 模块内，外部拿不到这个 WeakMap

export class Session {
  constructor(id) { state.set(this, { id, tokens: [] }); }
  get id() { return state.get(this).id; }
  addToken(t) { state.get(this).tokens.push(t); }
}
```

要点：状态存在闭包捕获的 `WeakMap` 里，键是实例；`WeakMap` 的键是弱引用，实例没别处引用时条目能被回收（这是它相对普通 `Map` 的全部优势，也是[上一章](/javascript/functions-and-scope)「内存驻留」的解药之一）。

比 `#field` 弱在三处：① **同模块内的其他函数也能读这个 `WeakMap`**，私有范围是「模块」而不是「类」；② `state.get(this)` 若传入的对象不是本类实例会拿到 `undefined`，访问 `.id` 直接抛错，而 `#` 版本会精确报 `Cannot read private member ... whose class did not declare it`；③ 子类拿不到父类的 `WeakMap`（得把 `WeakMap` 导出或再包一层访问器），`#` 字段配合 `protected`-风格的访问器更直观。

</template>

</Exercise>

<Exercise title="练习 5 · 判断该继承还是该组合" difficulty="进阶">

给下面三个场景各选「继承 / mixin 组合 / 显式注入依赖」，并说明理由。① 图形类体系：`Shape` → `Circle`、`Rect`，都实现 `area()`。② 一个组件既要「可拖拽」又要「可撤销」，两个能力互不相干。③ 服务类需要日志器、时钟、随机源三样外部能力，测试时要全部替换。

<template #answer>

① **继承**（`class Circle extends Shape`）。这是真的「是一种」，且 `area()` 的多态靠子类覆盖即可；`Shape` 里给 `abstract` 式的默认实现抛错（JS 没有抽象类，惯例是构造器里检查 `new.target === Shape` 就 `throw`）。

② **mixin 组合**，但**两个能力不能同名方法**（本章坑 2：`{ ...A, ...B }` 冲突静默覆盖）。做法是 `const Draggable = (Base) => class extends Base { ... }`，用 `Undoable(Draggable(Component))`，每个 mixin 只加不重叠的方法与字段。能力再多两个以上就该拆成「显式持有」的独立对象。

③ **显式注入依赖**（构造器参数或工厂）：`new OrderService({ logger, clock, random })`。测试时替换的成本是传一个对象，而不是造一个假的父类链。这也和[后端分层架构](/backend/layered-architecture)里「上层不依赖下层实现，只依赖传入的接口」一致；在 TS 里这些「接口的形状」就是结构化类型在起作用，见[TypeScript 对象类型与接口](/typescript/objects-and-interfaces)。

判据一句话：**「是一种」且需要 `super` 复用 → 继承；「有一种能力」且能力可独立 → mixin；「需要外部配合且要替换」 → 注入。**

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN 继承与原型链](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Inheritance_and_the_prototype_chain) —— 核实本章「查找顺序、写入只写自身、getter 导致赋值静默失败、`in` 与 `hasOwnProperty` 的差别」。
- [MDN `Object.getPrototypeOf`](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Object/getPrototypeOf) —— 核实 `__proto__` 与 `getPrototypeOf` 的关系及「实例没有 `prototype` 属性」。
- [MDN `class`](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Classes) —— 核实「方法不可枚举、必须 `new`、类声明在 TDZ、`super()` 前不能用 `this`、静态成员继承、`Symbol.hasInstance`」。
- [MDN 私有类字段](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Classes/Private_class_fields) —— 核实「类外访问是 `SyntaxError` 而非运行时错误」与 `Reflect.ownKeys` 不可见。
- [MDN `new` 运算符](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Operators/new) —— 对照本章手写 `myNew` 的四步分解与「构造器返回值规则」。
- [javascript.info · Prototypes, inheritance](https://javascript.info/prototypes) 与 [Classes](https://javascript.info/classes) —— 主教材对应章节，本站只重组视角不复制正文；`prototype-inheritance` 与 `native-prototypes` 两节的练习建议做。
- [MDN `Object.setPrototypeOf`](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Object/setPrototypeOf) —— 该页对「性能问题」有明确警告，动手前对照一次；倍率仍以你自己的基准为准。

## 下一章

原型链解决「属性和方法怎么找到」，`class` 解决「怎么造对象与封装」，两者都是**同步**语言内的机制：调用栈里每一步都能算出结果。真正让 JS 的行为变得不可预测的是另一件事——`setTimeout` 的回调什么时候跑、`await` 之后要排哪个队、并发的三个请求谁先回来。[事件循环、Promise 与 async/await](/javascript/asynchronous) 讲的就是这套「什么时候执行」的模型：微任务与宏任务的顺序（我会把混合代码的**真实输出顺序**贴出来）、`Promise.all` 一个失败为什么不该让其余全崩、串行 `await` 与并行的耗时差（实跑是 923ms 对 307ms），以及竞态怎么修。
