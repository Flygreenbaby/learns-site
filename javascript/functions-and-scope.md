# 函数、作用域、闭包与 this：三种写法从来不是同义词

`setTimeout(this.tick, 1000)`，一秒钟后控制台报 `Cannot read properties of undefined (reading 'seconds')`；给输入框绑了防抖，切换页面后旧定时器还在跑，因为「上一个定时器」被闭包攥着不放；面试背了「var 有提升」，结果线上出现一个谁都想不到的 `undefined`。

这四类故障的共同点是：**代码看起来没错，是你对函数这几个语言层面的假设错了**。你默认「函数就是函数」，但函数声明、函数表达式、箭头函数在 `prototype`、`new`、`arguments`、`this` 四个维度上是能力不同的三种东西；你默认「`this` 是对象自己」，但 `this` 是**调用方式**决定的，跟写在哪一行无关；你默认「函数记住了当时的值」，它记住的其实是变量的**引用**。

这一章把这四件事一次讲透，关键片段全部在本机 Node v25.4.0 跑过，贴的是真实输出。前置是[类型、值与引用语义](/javascript/types-and-values)（尤其是「赋值拷的是引用」）和[对象、数组与常用方法](/javascript/objects-and-arrays)。

## 三种函数写法的能力差异：一张对照表

不是风格差异，是能力差异。

| 能力 | 函数声明 `function f(){}` | 函数表达式 `const f = function(){}` | 箭头函数 `(x) => x` |
| --- | --- | --- | --- |
| `prototype` 属性 | 有 | 有 | **没有** |
| 能否 `new` | 能 | 能 | **不能，抛 TypeError** |
| 自己的 `arguments` | 有 | 有 | **没有**，指向外层非箭头函数 |
| `this` 来源 | 调用方式决定 | 调用方式决定 | **定义时的词法作用域**，`call/apply/bind` 改不动 |
| `new.target` | 有 | 有 | 没有 |
| 提升 | 整个函数体提升 | 只有变量名提升 | 同左（是 `const` 绑定） |
| 作为对象方法 | 合适 | 合适 | **不合适**（`this` 不指向对象） |

<Callout type="verified" title="下表结论在本机 Node v25.4.0 实跑">

核实于 2026 年 10 月 17 日，Windows 10 x64，命令 `node -`（脚本从标准输入读入）。真实输出：

```text
prototype 有无: object object undefined
new arrow: TypeError: arrow is not a constructor
普通函数 arguments: object / len=2
箭头函数 arguments(顶层无外层函数时): undefined
箭头继承外层 arguments: 来自外层
```

`typeof arrow.prototype` 是 `undefined`，而 `"prototype" in arrowFn` 为 `false`——不是「有个空对象」，是属性根本不存在。这与 [MDN Arrow functions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions) 的说明一致：箭头函数「不能用作构造器，用 `new` 调用会抛 `TypeError`，也没有 `prototype` 属性」。

</Callout>

顺带一个容易忽略的点：**具名函数表达式**（写成 `const f = function named() {}` 的那种）里的 `named` 只在函数内部可见，外部 `typeof named` 是 `undefined`。这是递归写法的合法手段之一，也解释了为什么 `f.name` 有时不等于变量名。

## 换行 return 与 ASI：返回值凭空消失

这一段是**真实跑过的**，也是新手最常见的「代码没问题但返回 undefined」来源：

```js
function half() {
  return
  1 + 2;
}
console.log(half()); // undefined
```

Node v25.4.0 输出：

```text
ASI 换行 return: undefined
加括号后: 3
```

原因叫 ASI（automatic semicolon insertion，自动分号插入）：`return` 后紧跟换行，引擎在换行处补了分号，于是函数返回 `undefined`，`1 + 2;` 变成一行永远执行不到的死代码。返回值是多行对象字面量时同理（`return {` 换行写属性是安全的，因为 `{` 后不是可断句的位置；但 `return` 直接换行就不行）。**修法不是记住规则，是让 `return` 后面不接换行**，多行返回值一律用括号包起来。

<Callout type="warn" title="别指望 lint 全救你">

ASI 只在「换行处正好能构成完整语句」时插入分号，规则细节一大串（能构成语句、下一行以 `(`/`[`/`+`/`-`/`/` 开头不插……）。与其背规则，不如开 ESLint 的 `semi` 与 `no-unreachable`，把 `return` 换行这种写法在提交前就拦下，见[代码规范：ESLint 与 Prettier](/frontend-engineering/lint-and-format)。

</Callout>

## 参数：默认值什么时候求值，length 为什么骗你

**默认值是每次调用时求值的表达式，不是定义时的常量。** 实跑证据：

```js
let calls = 0;
const inc = () => ++calls;
function withDefault(v = inc()) { return v; }
withDefault();            // 求值
withDefault();            // 求值
withDefault(undefined);   // 省略与 undefined 等价，仍然求值
withDefault(0);           // 传了 0，不求值
console.log(calls);       // 3
```

真实输出 `默认参数被求值次数: 3`。推论：**默认值里不要放有副作用的东西**（`fetch`、`Date.now()`、`new ID()`），你以为只算一次，其实每次调用都算；想要「一次性的默认值」就在函数外面定义常量再引用。

默认值还能看到**同级的形参和作用域里的变量**，但形参有自己的一层作用域：

```js
function selfRef(y = laterVar) { return y; }
let laterVar = '外层 let 可见';
console.log(selfRef());        // 外层 let 可见
console.log(selfRef2());       // 见下方报错
function selfRef2(y = laterLet) { return y; }
let laterLet = 1;
```

第二次调用抛的是 TDZ 报错，不是「找不到变量」：

```text
默认参数引用后声明的变量: ReferenceError: Cannot access 'laterVar' before initialization
默认参数取到外层变量: 外层 let 可见
```

解构与剩余参数：

```js
function cfg({ mode = 'default', retries = 2 } = {}, ...rest) {
  return [mode, retries, rest.length];
}
cfg();                      // ['default', 2, 0]
cfg({ mode: 'fast' }, 1, 2); // ['fast', 2, 2]
```

`cfg()` 能跑是因为给了 `= {}` 兜底。**去掉这个兜底就炸**，实跑报错原文：

```text
必填解构缺失: TypeError: Cannot destructure property 'a' of 'undefined' as it is undefined.
```

`length` 属性只统计「第一个有默认值的形参之前」的个数，剩余参数不计：

```text
length 对比: 2 1 3        // ((a,b)=>0).length === 2
剩余参数不计入 length: 1   // function f(a, ...rest){}.length === 1
```

这条不是 trivia：`middleware`、`promisify`、`jest.fn()` 这类靠 `fn.length` 判断「这是不是 `(err, data) => …` 双参回调」的代码，你一写默认值就会被误判。**框架里用 `length` 分支判断回调形状时，别在有默认值的函数上注册**。

## 词法作用域：可见性由「在哪里定义」决定

作用域链在你**写下函数的位置**就确定了，运行时调用谁都不会改变它。这就是「词法（lexical）」的意思——按源码文本结构定，不按调用栈定。

```js
const outer = '定义处的外层';
function inner() { return outer; }   // 作用域链在这一刻钉死
const obj = { outer: '调用处的对象', inner };
console.log(obj.inner());            // 定义处的外层
```

把上面这条和 `this` 放一起看，就能解释一大半「回调里读到了不该读到的东西」：自由变量走**词法链**，`this` 走**调用方式**，两套机制完全独立。函数被当回调传出去时，它捕获的外部变量还是原来那批，但 `this` 换了。

`arguments` 是「非箭头外层函数」的隐式对象， sloppy 模式下它和形参**联动**，严格模式下不联动。实跑：

```text
strict 结果: 1 | sloppy 结果: 99
```

（写法是 `function(a){ arguments[0] = 99; return a; }`，严格模式下加 `new` 前缀 `'use strict'` 的那份返回 1。）依赖这种联动是错的，用剩余参数 `...args` 代替 `arguments`，见[ES 模块、动态导入与迭代器](/javascript/modules-and-iterators)里模块默认严格模式的影响。

## 提升与 TDZ：三种声明的差别，附报错原文

| 声明 | 提升表现 | 提前访问的结果（Node v25.4.0 原文） |
| --- | --- | --- |
| `function f(){}` | 名字和函数体都提升 | 直接可调用 |
| `var v` | 名字提升，初始化为 `undefined` | 读到 `undefined`，**不报错** |
| `let x` / `const y` | 名字提升但在 TDZ 中 | `ReferenceError: Cannot access 'x' before initialization` |
| `class C {}` | 同 `let`，在 TDZ 中 | `ReferenceError: Cannot access 'C' before initialization` |

实跑的两行关键输出：

```text
提升: undefined function        // var 读到 undefined，函数声明已可用
类声明 TDZ: ReferenceError: Cannot access 'Cls' before initialization
```

TDZ（temporal dead zone，暂时性死区）不是「变量不存在」，而是「绑定已创建但尚未初始化」，所以引擎能报出比 `is not defined` 更精确的错。**记住这两种报错的措辞差别，它是最快的定位线索**：看到 `Cannot access ... before initialization` → 声明在下面，是提升问题；看到 `xxx is not defined` → 压根没声明，多半是拼错、模块没导入、或 `this` 丢了。

`var` 的「读到 undefined 不报错」是它在生产里最贵的性质：拼错变量名、写在块里但实际函数级可见，全都静默通过。这就是[阶段项目](/javascript/project)要求「全程不用 `var`」的原因。

## 块级作用域与循环里的 let：三个 setTimeout 全打印 3

经典错误代码，**实跑输出为 `3,3,3`**：

```js
const r1 = [];
for (var i = 0; i < 3; i++) {
  setTimeout(() => r1.push(i), 0);
}
```

原因不是「`setTimeout` 延迟了所以 `i` 变了」这么简单，是**三层事实叠加**：`var` 是函数作用域，`i` 只有**一个**；回调捕获的是这个变量的引用而不是快照；等回调跑起来时循环早已结束，`i === 3`。

```text
三个 setTimeout: 3,3,3 | 0,1,2
```

右边那组是把 `var` 换成 `let` 的结果——`let` 在 `for` 的头部**每轮新建一个绑定**并把上一轮的值拷进去，这是语言规定的特例，不是「块级作用域」的自然推论（`for` 块体内 `let` 只是一次声明）。三种修法按优先级：

```js
for (let i = 0; i < 3; i++) setTimeout(() => push(i), 0);   // 1. 换 let
for (var i = 0; i < 3; i++) ((j) => setTimeout(() => push(j), 0))(i);  // 2. IIFE 传值
for (var i = 0; i < 3; i++) setTimeout(push, 0, i);          // 3. 定时器额外参数（浏览器与 Node 都支持）
```

`var` 的函数作用域还带来另一个后果，实跑：

```text
var 循环结束后 i 还在吗: number
let 循环结束后: undefined
```

循环变量在循环外还活着，就会被后面的代码误用或覆盖。块级作用域的另一半价值在 `if/else` 里声明函数：严格模式下块内函数声明不泄漏到块外，sloppy 模式下行为历史上不一致——**别在块里写函数声明**，改成 `const f = function () {}`。

## 闭包：函数捕获的是变量的引用，不是值

一句话模型：**函数创建时把作用域链钉住，只要函数还活着，那条链上的变量就不会被回收。** 于是闭包读到的一直是**当前值**，不是创建时的快照：

```js
let big = { id: '第一次的数据' };
const getId = () => big.id;
big = { id: '换了个对象' };
console.log(getId());   // 换了个对象
```

实跑输出 `闭包读到的最新值: 换了个对象`。这条模型能直接解释：`let` 循环为什么能修好 `setTimeout`（每轮一个绑定，被各自的闭包分别攥着）、框架的 `setup()` 里 `ref` 为什么「改了值回调就看到新值」（见 [Vue 响应式原理](/vue/reactivity)）。

三个必会写法：

```js
// 1. 计数器：状态藏在闭包里，外部无法直接改
const makeCounter = () => {
  let n = 0;
  return { inc: () => ++n, get: () => n, reset: () => { n = 0; } };
};

// 2. 防抖：timer 是闭包变量，多次调用共享同一个
function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

// 3. 私有状态（模块级）
let requestSeq = 0;
export const nextSeq = () => ++requestSeq;   // 外部改不了 requestSeq
```

`debounce` 里那句 `fn.apply(this, args)` 不是装饰：返回的包装函数被当对象方法调用时，`this` 得透传下去。写成箭头函数就丢。

**内存驻留的真实场景。** 闭包让一个大对象活着，这件事在浏览器里最常见的形态是「 detached DOM（已脱离文档的节点）被闭包引用」：你在渲染函数里给某行的事件回调闭包了整份 `rows` 数组，删掉这一行后 DOM 移除了、回调还挂在别处，于是整份数据回收不掉。

<Callout type="unverified" title="内存驻留的具体数值未在本机验证">

上面「闭包持有整个数组就不回收」的**机制**是语言层面确定的，`Map` 存引用这一半我在 Node 里验证过（`keep.set('k2', chunk)` 后 `keep.get('k2')` 就是整个数组对象）；但「浏览器里因此多出多少 MB、GC 多久回收」我没有在你的环境里跑过 DevTools 的 Memory 面板，**不给出数字**。排查方法照旧：Memory → Heap snapshot 对比两次快照，在 `Detached` 过滤器里找节点，顺着 Retainers 链看是哪个闭包/Map 持有它。

</Callout>

能落地的规避手段就三条：**别把整份列表闭包进单行的回调**（只捕获 id，回调里再查）；**组件卸载时把定时器与监听器清掉**（见 [生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject) 与 [useEffect 与 watch 的对照](/react/use-effect)）；**长生命周期容器用 `WeakMap`/`WeakRef`**（键是对象时不阻止回收）。

## this 的四条绑定规则与优先级

按「谁最终决定 `this`」排列，优先级从高到低：

| 规则 | 触发写法 | `this` 是 | 优先级 |
| --- | --- | --- | --- |
| `new` 绑定 | `new F()` | 新建的对象 | 最高（连 `bind` 都能压过） |
| 显式绑定 | `f.call(o)` / `f.apply(o, args)` / `f.bind(o)` | 指定的 `o` | 中；`bind` once 后不可再改 |
| 隐式绑定 | `o.f()` | 点号左边那个 `o` | 低；只要 `o.f` 被取出传入回调就退化成默认绑定 |
| 默认绑定 | `f()` | 严格模式 `undefined`；sloppy 模式全局对象 | 最低 |

实跑输出：

```text
隐式绑定: 隐式-objA
显式 call: 显式-call
bind 后再 call 无效: bind固定
bind 链式第二次无效: B1
new bind后的构造器: new绑定 | instanceof Ctor: true
```

三条要点：

1. **`bind` 只认第一次。** `f.bind(A).bind(B)` 的 `this` 是 `A`（输出里的 `B1`），后续的 `bind`、`call`、`apply` 全部无效。所以「给已经 `bind` 过的函数再传一个接收者」是纯粹的自我安慰。
2. **`new` 能压过 `bind`。** `new F.bind(someObj)()` 造出的实例 `this` 是新对象，不是 `someObj`，而且 `instanceof F` 仍为 `true`。规范是这么定的，别指望它符合直觉。
3. **隐式绑定只在「直接 `obj.f()`」时生效。** `const f = obj.f; f()` 或 `[obj.f][0]()`（后者其实还是隐式绑定）里，只要中间断了点号链，`this` 就丢。

丢失的后果比报错更糟的是**静默写坏全局**，sloppy 模式实跑：

```js
const timer = { seconds: 0, tick() { this.seconds++; } };
const f = timer.tick;
f();                      // 不报错
console.log(globalThis.seconds);  // NaN
```

```text
sloppy 直接调用后 globalThis.seconds = NaN (静默写坏全局)
```

`this` 是 `globalThis`，`globalThis.seconds` 是 `undefined`，`undefined++` 得 `NaN`，于是你的状态既没更新也没报错。**类里的方法是严格模式**，同样场景直接抛错，实跑：

```text
class 方法当回调: TypeError: Cannot read properties of undefined (reading 'n')
```

## 箭头函数没有 this：两个翻车案例

箭头函数没有 `this` 绑定，它的 `this` 就是**定义时所在作用域的 `this`**。这在「回调想继承外层方法接收者」时是救星，在「回调想拿到调用者」时是灾难。

**案例一：把箭头函数当对象方法。**

```js
const obj = {
  name: '对象自己的 name',
  arrow: () => this?.name,
  normal() { return this.name; },
};
```

Node v25.4.0（CommonJS，顶层 `this` 是 `globalThis`）实跑：

```text
箭头当对象方法: undefined | 普通方法: 对象自己的 name
箭头 .call 换 this 无效: undefined
```

在 ES 模块里更干脆，顶层 `this === undefined`（我实跑过：`ESM 顶层 this = undefined`），于是 `this.name` 抛 `Cannot read properties of undefined`。**结论：对象方法和 class 方法一律用简写方法语法 `m(){}`**，箭头只用于「就是要继承外层 `this`」的回调。

**案例二：在 `addEventListener` 回调里用 `this`。**

```js
class Widget {
  constructor(el) { this.el = el; el.addEventListener('click', () => this.onClick()); }
  onClick() { /* 正确：箭头继承了构造器里的 this（= 实例） */ }
}
```

这个写法是对的。翻车的是反过来——把处理器提到 class 外面复用，或者用普通函数：

```js
el.addEventListener('click', this.onClick);       // 错：脱离实例，this 变 undefined
el.addEventListener('click', function () { this.onClick(); });  // 错：this 是触发事件的 DOM 节点
```

第二条尤其阴：DOM 规范规定监听器的 `this`（等价于 `currentTarget`）是注册它的元素，非箭头普通函数拿到的是元素，**不报错但语义完全不同**。三种修法见「方法丢了 `this`」一节，本质是同一套。

<Callout type="unverified" title="addEventListener 里 this 指向 DOM 元素未在本机实跑">

浏览器事件回调的 `this === currentTarget` 是 [DOM 规范](https://dom.spec.whatwg.org/)与 [MDN EventTarget.addEventListener](https://developer.mozilla.org/zh-CN/docs/Web/API/EventTarget/addEventListener) 的规定，我没有在本任务的浏览器里跑过，故只作规范引用，不称实测。第 7 章 [DOM 操作与事件系统](/javascript/dom-and-events) 会在浏览器里核。

</Callout>

## bind 的柯里化与它做不到的事

`bind` 除了固定 `this`，还能预置参数（柯里化的一个方向）：

```js
const add = (a, b, c) => a + b + c;
const add5 = add.bind(null, 5);      // 只填第一个参数
console.log(add5(3, 1));             // 9
const log = console.log.bind(console, '[app]');
```

三个限制：占位符没有语言级支持（想跳过第一个参数只能自己写包装函数或用箭头默认参数）；**`bind` 出来的函数没有 `prototype`**，`new` 它时 `this` 走新对象而绑定目标被忽略（上面实跑已验证）；每次 `bind` 都产生新函数，**在 render/循环里 `bind` 会让「依赖函数引用相等」的缓存与 diff 失效**，React 里这条直接对应一次多余的子树重渲染，见[重渲染机制与性能](/react/re-render-performance)。

## IIFE 与模块：私有状态的两种时代

```js
const store = (() => {
  let count = 0;                          // 只有 IIFE 内部可见
  return { inc: () => ++count };
})();
```

IIFE（immediately-invoked function expression，立即调用函数表达式）当年的两个功能，现在各有替代品：**私有状态**由 ES 模块的顶层作用域天然提供（模块内未 `export` 的变量外面拿不到，见上面的 `requestSeq` 例子）；**避免全局污染**由模块解决，`var` 时代「两个脚本撞同名变量」的问题在 ESM 下不存在。所以现在写 IIFE 只剩两个合理场景：**给某个 `const` 做一次性的复杂初始化**，和**在不能改成模块的存量脚本里造一个私有作用域**。上面那段 IIFE 的实跑输出：

```text
IIFE 私有计数: 1 2 3
```

模块默认严格模式、`this` 为 `undefined`、有 TDZ 与循环依赖等差异，都在[ES 模块、动态导入与迭代器](/javascript/modules-and-iterators)展开。

## 函数是一等公民：三种实用模式

函数能当参数传、能当返回值给、能存进变量和数组，这叫一等公民（first-class）。落到日常代码里是三种模式：

**回调（控制反转）**。`array.map(f)`、`addEventListener('click', f)`、`fs.readFile(path, cb)` 都是「你把行为交给我，我在合适的时机调用」。要防的是回调里的 `this`（上一节）与回调被调用多次（去重/幂等）。

**高阶函数（HOF）**：接收或返回函数的函数。`once` 与 `memoize` 是必会的两个，实跑：

```js
const once = (fn) => {
  let called = false, value;
  return (...args) => { if (!called) { called = true; value = fn(...args); } return value; };
};
const memoize = (fn, toKey = (...a) => JSON.stringify(a)) => {
  const cache = new Map();
  return (...args) => {
    const k = toKey(args);
    if (!cache.has(k)) cache.set(k, fn(...args));
    return cache.get(k);
  };
};
```

```text
once 内部执行次数: 1
memoize fib(20): 6765 递归内部计数(未 memo 的内层调用): 21891
```

第二行是**我故意留的坑**：`memoize(function f(n){ ... f(n-1) + f(n-2) ... })` 里递归调用的是**原始函数 `f`**，不是缓存后的包装函数，所以 `fib(20)` 内部还是跑了 21891 次——`memoize` 只缓存了最外层那一次调用。21891 恰好是 `2 × fib(20) + 1`，即完全没被优化的指数级调用数。正确写法是递归时引用外层那个绑定到包装函数的名字，改对后同一题的实测计数是 21 次，见练习 2。**「包了 memoize 就快了」必须实测调用次数**，别靠感觉。

**纯函数与幂等**。同样的入参得同样的结果、不改外部状态。好处是可缓存、可并行、可安全重放。幂等（idempotent）是它在副作用方向的对应物：同一操作做一次和做十次结果相同——前端「提交按钮防重复」与后端接口的幂等键是同一件事的两端，见[统一错误处理](/backend/error-handling)与[可靠投递：确认、重投与幂等](/message-queue-cloud/reliable-delivery)。写纯函数最实际的一条约束：**不要改入参对象**，需要新状态就返回新对象（`{ ...old, done: true }`），这也是[useState / useReducer 与不可变更新](/react/state)的前提。

## 尾调用：规范里有，指望它不行

规范定义了「尾位置（tail position）」：`return f(x)` 这种调用结果直接返回、当前帧不必保留的形式。理想下尾递归能用常数栈空间。

本机能验证的部分（Node v25.4.0）：

```text
尾递归 10 万层: RangeError: Maximum call stack size exceeded
普通递归 1 万层: Maximum call stack size exceeded
两者都在多深爆栈: 尾递归形式约 8000–16000 层量级即溢出，与普通递归同一量级
```

即：**在这台 Node 上，写成尾递归形式并没有让栈深度变浅**。

<Callout type="unverified" title="其他引擎的尾调用支持情况本站不断言">

「V8/SpiderMonkey/JavaScriptCore 是否实现了完整尾调用优化（Proper Tail Calls）」这类结论涉及具体引擎与版本，我没有从官方渠道逐条核实，只在本机 Node v25.4.0 观察到尾递归形式仍会 `RangeError`。**所以别把尾调用当性能或健壮性手段**：需要深度遍历就显式改写成 `while` + 数组栈（见[数据结构（一）：线性结构](/computer-science/data-structures-linear)），或设深度上限提前抛错。动手前如需确认引擎行为，就自己写 10 万层递归跑一次。

</Callout>

## 常见错误与排查

**1. 回调里 `this` 是 `undefined`。** 现象：`TypeError: Cannot read properties of undefined (reading 'xxx')`，堆栈指向你的方法。原因：方法被从对象上摘下来当回调传（`el.addEventListener('click', this.onClick)`、`setTimeout(this.tick, 0)`）。确认：在函数第一行 `console.log(this)`，或看调用处有没有点号。修法三选一：`this.onClick.bind(this)`、箭头包装 `() => this.onClick()`、或把方法定义成 class 字段箭头函数（`onClick = () => {}`，每个实例一份）。

**2. 三个 `setTimeout` 全打印 3。** 现象：异步回调里的循环变量全是最后一个值。原因：`var` 只有一个函数级绑定 + 闭包捕获引用。确认：DevTools Scope 面板里看闭包变量，或把 `var` 改 `let` 立刻正常。修法：`for (let i = ...)`；需要「快照」就在闭包外加一层传值。

**3. 函数返回 `undefined` 而代码看着没错。** 原因：`return` 与表达式之间有换行，被 ASI 截断；或忘了 `return`（`arr.forEach(x => { ... })` 里没有返回就永远拿到 `undefined`）；或 `return` 在 `if` 里漏了另一分支。确认：把 `return` 后的表达式拆出来单独打印。修法：`return (` 包住多行表达式；所有分支都有显式返回值。

**4. `Cannot access 'x' before initialization`。** 现象：报错指向一个明明声明了的 `let/const/class`。原因：访问发生在 TDZ 内——声明在下方，或回调提前执行（比如函数在参数求值阶段就被调用）。确认：报错原文是 `before initialization` 就是 TDZ，不是拼写问题；`x is not defined` 才是不存在。修法：把声明提到使用之前；模块层的循环导入也会导致这个，见[ES 模块、动态导入与迭代器](/javascript/modules-and-iterators)。

**5. 默认值里放了副作用。** 现象：`Date.now()` 作为默认参数导致每次调用时间都变；或默认值里 `fetch` 被反复触发。原因：默认值每次调用都重新求值。确认：给默认值表达式挂个计数器打印（本章 `inc()` 例子输出 3 就是这个手法）。修法：把一次性计算提到函数外，或显式判空 `if (v === undefined) v = DEFAULT`。

**6. 用箭头函数当 class/对象方法，`.call(obj)` 换不了 `this`。** 现象：复用工具函数时接收者「传不进去」，读到外层变量或 `undefined`。原因：箭头函数没有 `this` 绑定，`call/apply/bind` 对它无效（实跑 `箭头 .call 换 this 无效: undefined`）。确认：`typeof fn.prototype` 是 `undefined` 就说明它是箭头函数。修法：需要动态接收者就写成普通函数；需要固定上下文就别用 `call`。

**7. 闭包把整个列表/DOM 节点攥住了。** 现象：页面越用越慢，删除数据后内存不回落。原因：事件回调闭包了大对象，或模块级 `Map` 只增不减。确认：Heap snapshot 对比 + Retainers 链。修法：只捕获 id、卸载时 `removeEventListener`/`clearTimeout`、缓存容器换 `WeakMap`。

**8. 包装函数丢了 `this` 与 `length`。** 现象：加了 `once`/`debounce` 后，靠 `fn.length` 判断回调形状的框架中间件不认它。原因：包装函数形参是 `...args`，`length` 变 0；用箭头写法还丢了 `this`。确认：`console.log(wrapper.length, wrapper.name)`。修法：包装函数用 `function (...args) { return fn.apply(this, args); }`，必要时 `Object.defineProperty(wrapper, 'length', { value: fn.length })`。

## 练习

<Exercise title="练习 1 · 预测输出" difficulty="基础">

写出下面每行在浏览器（经典脚本，非模块）与在 ES 模块里分别打印什么，并指出哪个最依赖 `this` 绑定规则。

```js
const o = {
  v: 'own',
  m1() { return this?.v; },
  m2: () => this?.v,
};
console.log(o.m1());
console.log(o.m2());
const { m1 } = o;
console.log(m1());
console.log(o.m1.call({ v: 'call 覆盖' }));
const bound = o.m1.bind({ v: 'bind 固定' });
console.log(bound.call({ v: '再覆盖' }));
```

<template #answer>

`o.m1()` → `own`（隐式绑定）。`o.m2()` → 经典脚本里是 `window.v`，`undefined`（箭头继承顶层 `this`，即全局对象，而全局对象上没有 `v`；注意 `window.name` 是 `''`，别把两者混了）；在 ES 模块里顶层 `this` 是 `undefined`，靠 `?.` 才不抛错，结果同样 `undefined`。

`m1()` → sloppy 模式（经典脚本）是 `undefined`，因为 `this` 退化成全局对象而全局没有 `v`；严格模式/模块里 `this` 是 `undefined`，**`this.v` 会抛 TypeError**（所以答案里 `this?.v` 的写法才安全）。这就是「方法摘下来就丢接收者」。

`o.m1.call({v:'call 覆盖'})` → `call 覆盖`（显式绑定压过隐式）。
`bound.call({v:'再覆盖'})` → `bind 固定`（**`bind` 一旦调用就永久固定，后续 `call` 无效**，与本章实跑的 `bind 后再 call 无效: bind固定` 同理）。

顺序结论：`new` > `bind`/`call` > 隐式 > 默认；箭头不参与这场竞争。

</template>

</Exercise>

<Exercise title="练习 2 · 用闭包实现 once 与 memoize" difficulty="进阶">

实现两个高阶函数：`once(fn)` 保证 `fn` 最多执行一次并把首次返回值永久复用；`memoize(fn)` 按参数缓存返回值。要求：① 被 `memoize` 的递归函数要真的省掉重复计算（本章正文那个 `fib` 例子是错的，改对）；② 支持自定义 key（默认把参数序列化）；③ 给出「缓存了多少次实际计算」的可观测手段。

<template #answer>

```js
function once(fn) {
  let called = false, value;
  return function (...args) {
    if (!called) { called = true; value = fn.apply(this, args); }
    return value;
  };
}

function memoize(fn, toKey = (...a) => JSON.stringify(a)) {
  const cache = new Map();
  return (...args) => {
    const k = toKey(args);
    if (!cache.has(k)) cache.set(k, fn(...args));
    return cache.get(k);
  };
}
```

递归要省计算，**内部必须调用包装后的函数**，而不是原始自己：

```js
let computed = 0;
const fib = memoize((n) => {
  computed++;
  return n < 2 ? n : fib(n - 1) + fib(n - 2);   // 这里引用的是包装后的 fib
});

fib(20);
console.log(computed);   // 21
```

两个版本我在 Node v25.4.0 里都跑过，输出对照：正确写法 `fib(20) = 6765 | 真正计算次数: 21`（每个不同的 `n` 只算一次），而正文里那个「递归调原始函数」的错误写法是 `计算次数: 21891`。差异全在递归时引用的是哪个名字——包装函数在外层被 `const fib` 绑定，闭包拿到的是它，所以递归穿过缓存；`memoize(function f(n){ f(n-1) ... })` 里的 `f` 是函数表达式自己那层名字，绕开了缓存。

观测手段就一句：在计算体里放计数器或 `console.count()`。**没有计数就别说自己 memoize 成功了**。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释报错" difficulty="基础">

下面代码有三个独立 bug，分别说出报错原文（或静默后果）与修法。允许你在 Node 或浏览器控制台实跑对照。

```js
class Ticker {
  seconds = 0;
  start() { setInterval(this.tick, 250); }
  tick() { this.seconds++; return this.seconds; }
}
function make() {
  return
  { ok: true };
}
const t = new Ticker();
t.start();
console.log(make().ok);
```

<template #answer>

**Bug 1：`setInterval(this.tick, 250)` 丢了接收者。** class 体是严格模式，回调里 `this` 是 `undefined`，抛 `TypeError: Cannot set properties of undefined (setting 'seconds')`。修法：`setInterval(() => this.tick(), 250)` 或 `setInterval(this.tick.bind(this), 250)`，或把 `tick` 写成 class 字段箭头函数。

**Bug 2：`make()` 返回 `undefined`。** `return` 后换行被 ASI 截断，于是 `make().ok` 抛 `TypeError: Cannot read properties of undefined (reading 'ok')`。修法：`return ({ ok: true })` 或 `return` 紧跟 `{`。

**Bug 3（隐蔽）：`start()` 里的定时器无法停止，且 `t.start()` 调两次就有两条计时器。** 不是语法错，是生命周期泄漏：interval id 没保存。修法：保存 id 并提供 `stop()`，`clearInterval(this.id)`；组件里卸载时必须清（呼应本章「闭包导致内存驻留」与[生命周期](/vue/lifecycle-and-inject)）。

</template>

</Exercise>

<Exercise title="练习 4 · 说出每次调用的 this" difficulty="进阶">

给下面每个调用写出 `this` 的值（Node CommonJS 与 ES 模块两种环境各说一遍），并解释第 4 行为什么和第 3 行不同。

```js
function who() { return this; }
const host = { who, who2: () => this };
1) host.who();
2) who();
3) (host.who)();
4) (0, host.who)();
5) new who();
6) host.who2();
```

<template #answer>

1) `host`（隐式）。2) CommonJS sloppy 下 `globalThis`；模块/严格模式下 `undefined`。3) `host`——**括号不破坏点号链**，`(host.who)()` 等价 `host.who()`。4) `globalThis`/`undefined`——逗号表达式是「先算左边、取右边值」的普通表达式，接收者关系在取引用那一步就断了，这是「把方法从对象上摘下来」的最隐蔽形式，实际出现在 `(0, obj.method)()` 这种「故意丢 this」的库代码里（比如为避免 `this` 绑定泄漏）。5) 新建的对象，且 `who` 的 `prototype` 存在所以 `new` 合法；`new who2` 会抛 `TypeError: host.who2 is not a constructor`。6) 是**定义处**的 `this`（CommonJS 顶层 → `globalThis`，模块 → `undefined`），永远不是 `host`——这正是「箭头函数不能当对象方法」的实跑结论（本章输出 `箭头当对象方法: undefined`）。

</template>

</Exercise>

<Exercise title="练习 5 · 用闭包修一个竞态 bug" difficulty="挑战">

`requestSeq` 版方案：输入框每次 `input` 都发一次搜索请求，你想「只让最后一次请求的结果上屏」。下面代码为什么在慢响应回来时会覆盖新结果？用闭包 + 序号修掉它。

```js
let results = [];
input.addEventListener('input', async () => {
  const data = await search(input.value);
  results = data;            // 谁先回来谁说了算
  render();
});
```

<template #answer>

因为多个异步回调**共享同一个 `results` 变量且没有先后保证**：输入 `a` → 请求 A 发出；输入 `ab` → 请求 B 发出。如果 A 的响应后到，它会把自己的结果写回 `results`，把 B 的更新覆盖掉。

闭包 + 序号修法（每次 `input` 事件都创建一个自己的 `seq`，回调比较它是否是最新）：

```js
let latestSeq = 0;
input.addEventListener('input', async () => {
  const seq = ++latestSeq;           // 每个回调闭包攥着自己的 seq
  const data = await search(input.value);
  if (seq !== latestSeq) return;     // 已被更新的请求作废，直接丢弃结果
  results = data;
  render();
});
```

这里能明显看到「闭包捕获的是变量、每个回调的 `seq` 是独立绑定」——如果用 `var latestSeq` 且在内层再声明 `var seq`，全部回调会共享同一个 `seq`，判断立刻失效。更彻底的做法是发请求前 `abort` 掉上一个（`AbortController`），见[事件循环、Promise 与 async/await](/javascript/asynchronous)与 [fetch、同源策略与浏览器存储](/javascript/network-and-storage)；框架里这类「依赖变化 → 取消上一次」的模式对应 [computed 与 watch](/vue/computed-and-watch) 和 [useEffect 的清理函数](/react/use-effect)。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN 箭头函数](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Functions/Arrow_functions) —— 核实本章「箭头函数没有 `prototype`、不能 `new`、`this` 按词法确定、`call/apply/bind` 无效、不适合当对象方法」五条结论的权威出处。
- [MDN `this`](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Operators/this) —— 核实四条绑定规则与优先级，特别是「`new` 时 `bind` 的接收者被忽略」。
- [MDN 闭包](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Closures) —— 核实「闭包持有的是变量绑定而非快照」以及回收条件（该页定义：闭包是「函数与其周围状态的引用的组合」）。
- [MDN `let` 的 TDZ 与 for 循环每轮新绑定](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/let) —— 核实「三个 setTimeout 打印 3」的修复为什么在语言层面成立。
- [javascript.info · Advanced working with functions](https://javascript.info/advanced-functions) —— 本章对应的主教材，`closure`、`arrow-function-syntax`、`old-style-function-argument-features` 三节练习题建议全做（本站不重复它的题目与正文）。
- [ECMA-262 · Tail Position Calls](https://tc39.es/ecma262/) —— 想确认尾调用的规范定义时以此为准；引擎是否实现请在你的环境实测（本章只声明本机 Node v25.4.0 的观测）。

## 下一章

这一章讲的是「函数与它所处的作用域」，`this` 与闭包都是它的两个侧面；而 `new`、`prototype`、类方法这些「函数怎么造对象、对象怎么找方法」的问题还留着。[原型链、class 与封装](/javascript/prototypes-and-classes) 正面回答：属性沿链向上查到哪为止、`new` 到底做了四件什么事（我会用手写 `Object.create` 版实现给你看）、`class` 是语法糖但和 `function` 构造器有哪几处**真差别**，以及为什么 `class` 方法当回调时 `this` 一定丢。
