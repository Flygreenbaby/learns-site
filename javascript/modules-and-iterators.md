# ES 模块、动态导入与迭代器：为什么循环引用让导入值变成 undefined

同一个包，`import` 进来是 `undefined`，`require` 进来是一整个对象；两个文件互相引用，其中一边抛 `Cannot access 'x' before initialization`；本地双击 `index.html` 打开项目，控制台第一句就是 `Access to script at '...module.js' from origin 'null' has been blocked by CORS policy`；写 `for...of` 遍历一个普通对象报 `{} is not iterable`；给 AI 接口做流式渲染时 `await response.json()` 只能等全部结束。

这五件事看起来无关，其实分属两条机制：**模块系统规定代码怎么被加载与求值**，**迭代器协议规定「遍历」这件事怎么被标准化**。搞清前者，`import` / `require` 混用、循环依赖、tree-shaking 失效、代码分割的边界都不再是玄学；搞清后者，`for...of`、展开运算符、解构、生成器、`for await...of` 就共用一张图。

本章结论全部在 **Node v25.4.0** 上实跑过，报错文案逐字抄自终端输出。

## 模块要解决的问题，是加载顺序和名字冲突

在模块之前，网页 JS 只有一份共享的全局作用域。所有脚本按文档顺序同步执行，全部顶层 `var` 与 `function` 都挂在 `window` 上。于是：

- **两个库都想用 `util` 这个名字**，后加载的覆盖前一个，症状是「另一个库突然坏掉」。
- **加载顺序就是隐式依赖**：`utils.js` 必须在 `app.js` 之前，几十上百个脚本时没人维护得住。
- **依赖关系靠人记**：删掉一个文件时没人知道谁用了它，因为没有任何声明存在。
- **顶层变量全是活的**：任何脚本都能改你的内部状态，闭包成了唯一私有手段（[函数、作用域与闭包](/javascript/functions-and-scope)）。

历史解法是一步步长出来的：**IIFE 立即执行函数**用一个函数作用域包住文件，只往全局挂一个名字，这是最早也最有效的私有化手段，你在压缩库的第一行至今还能见到；**`AMD` / `RequireJS`** 把依赖写成声明并由加载器按序拉取；**UMD** 是一段同时兼容 CommonJS、AMD 与全局变量的包装，目的是让一个文件在三种环境里都能用——它的存在本身就是那段历史的证据。CommonJS 与 ES 模块则是两条当代路线：前者由 Node 落地、运行时解析、同步加载，后者进入语言标准、静态结构、异步加载，**同一套语法同时用于浏览器与 Node**。

## ES 模块与 CommonJS 的七处真实差异

| | ES 模块（ESM） | CommonJS（CJS） |
| --- | --- | --- |
| 语法 | `import` / `export` | `require()` / `module.exports` |
| 结构 | **静态**：导入导出必须出现在顶层，名字在求值前就确定 | **动态**：`require` 是普通函数调用，可以写在 `if` 里、可以拼路径 |
| 加载时机 | 导入**提升**：所有依赖先解析、求值，再执行本模块体 | 执行到 `require()` 那一行才加载 |
| 导出的是 | **绑定的实时视图**（live binding），不是值 | **值的拷贝**：`require` 那一刻 `module.exports` 的结果 |
| 同步性 | 依赖图异步加载，支持顶层 `await` | 同步返回，写不出顶层 `await` |
| 顶层 `this` | `undefined`（模块作用域是严格模式） | `module.exports` |
| 元信息 | `import.meta.url`、`import.meta.resolve` | `__filename`、`__dirname`、`require.main` |
| 缓存粒度 | 按解析后的 URL 缓存，模块图只求值一次 | 按解析后的绝对路径缓存 `require.cache` |

**静态结构不是风格偏好，它是 tree-shaking 的前提。**因为 `import { debounce } from './utils.js'` 在语法层面就能确定「只用了这一个名字」，打包器才能安全地把 `utils.js` 里其他没被引用的导出删掉。反过来说，`const name = pickName(); require('./utils')[name]` 这种写法没人能静态分析——**动态访问导出会让摇树失效**，你留下的整个文件都是死代码。

## 实跑：ESM 与 CJS 互操作在 Node v25.4.0 上的真实结果

`legacy.cjs`（CommonJS 侧）：

```js
'use strict';
const name = 'legacy-cjs';
function greet(who) { return `你好, ${who}（来自 ${name}）`; }
module.exports = { name, greet, created: 2026 };
module.exports.default = 'CJS 里的 default 属性只是一个普通属性';
```

`tiny-esm.mjs`（ESM 侧）：

```js
export const X = 42;
export default 'tiny-esm 的 default';
```

`interop.mjs` 逐个试探，实际输出如下。

<Callout type="verified" title="ESM / CJS 互操作与 require(esm)：Node v25.4.0 实跑结果">

**环境**：Windows 10 x64、Node v25.4.0，无第三方依赖，目录内 `package.json` 只有 `{"type":"module"}`，运行 `node interop.mjs`，核实于 2026-10-17。

```text
--- 1. ESM 导入 CJS ---
default  = object {"name":"legacy-cjs","created":2026,"default":"CJS 里的 defaul
具名 greet = function | 你好, ESM（来自 legacy-cjs）
具名 name  = legacy-cjs
--- 2. require() 一个同步 ESM ---
成功 -> [ 'X', '__esModule', 'default' ] | m.X = 42 | m.default = tiny-esm 的 default
--- 3. require() 一个含顶层 await 的 ESM ---
失败 -> ERR_REQUIRE_ASYNC_MODULE | require() cannot be used on an ESM graph with top-level await. Use import() instead. To see where the top-level await comes from, use --experimental-print-required-tla.
--- 4. ESM 里能不能用 require / module / exports ---
typeof require = function (自己造出来的 createRequire)
typeof module  = undefined
import.meta.url = file:///C:/Users/learner/AppData/Local/Temp/.../interop.mjs
顶层 this = undefined
--- 5. 同一份 ESM 被 import 与 require 混用，是否只求值一次 ---
[counting] 模块体被执行
两次 import 同一命名空间对象: true（同一对象）
a.getEvaluations() = 1 | c.getEvaluations() = 1
```

**由这段输出能确认的结论**：

1. **ESM 可以导入 CJS**，`default` 拿到的就是 `module.exports` 那个对象本身；而且 `import { greet, name }` 也成立——Node 用静态分析（`cjs-module-lexer`）识别 `module.exports = { ... }` 这种形状后**合成了具名导出**。这是 Node 的行为，**打包器和 tsconfig 的 `moduleResolution` 未必给出同样的结果**，`esModuleInterop` / `allowSyntheticDefaultImports` 的差异见 [模块与声明文件](/typescript/modules-and-declarations)。
2. **`require()` 一个不含顶层 `await` 的 ESM 在当前 Node 上能成功**，返回的就是那个模块命名空间对象（键为 `['X', '__esModule', 'default']`）。
3. **一旦 ESM 图里有顶层 `await`，`require` 它就直接失败**，错误码是 `ERR_REQUIRE_ASYNC_MODULE`，文案明确要求改用 `import()`。理由很直白：`require` 必须同步返回一个值，而异步求值的模块在同步语境里没有可用的导出。
4. **ESM 里没有 `module`（`typeof module` 是 `undefined`），也没有全局 `require`**——需要时用 `createRequire(import.meta.url)` 自己造一个。`import.meta.url` 是本模块的 `file://` URL，`__filename` 只是 CJS 的写法。
5. **同一份 ESM 只求值一次**：`counting.mjs` 的 `console.log` 只打印了一次，`import()` 两次与 `require()` 一次拿到的都是同一份状态（`getEvaluations()` 全为 1）。

</Callout>

在 CJS 侧写 `import.meta` 的报错也值得记一句，因为它发生在**解析阶段**而不是运行阶段，`try/catch` 包不住：

```text
SyntaxError: Cannot use 'import.meta' outside a module
```

`interop.mjs` 里那句 `require` 是这样来的，这也是混用两种系统时唯一正当的桥：

```js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);   // 得到一个以本文件为起点的 CJS 加载器
```

## import 与 export：所有语法形式

```js
// 导出
export const MAX = 10;
export function normalize(x) { return x.trim(); }
export class Task { }
export { a, b as alias };                        // 集中导出并重命名，as 只作用于导出名
export default function boot() { }               // 默认导出：一个模块最多一个
export * from './utils.js';                      // 聚合：转发全部具名导出（不含 default）
export * as fmt from './format.js';              // 命名空间对象
export { parse } from './parser.js';             // 转发单个
export { x as default } from './legacy.js';      // 把别人的具名导出改成本模块的 default

// 导入
import def from './mod.js';                       // 默认导出，名字随你起
import { a, b as c } from './mod.js';             // 具名，必须与导出时的名字一致
import * as ns from './mod.js';                   // 命名空间，取值用 ns.a
import './side-effects.js';                        // 只要副作用，不取绑定
import def, { a } from './mod.js';                // 默认 + 具名可同一条语句
```

`import def from` 与 `import { default: def } from` 完全等价——**default 只是一个名叫 `default` 的导出**。这个视角能解释最常见的错误：

```js
import express from 'express';      // 对：取 default
import { express } from 'express';  // 错：express 里没有叫 express 的具名导出
const _ = require('lodash');        // CJS：module.exports 整个对象就是它本身
```

具名导出和默认导出**混用要谨慎**：`export default { a, b }` 让导入方失去重命名与摇树能力，`import { a }` 直接是 `undefined`。选择标准：**一个模块对外提供一组相关能力 → 全部具名导出；提供单一主体（组件、类、插件入口）→ 默认导出。**本站的 Vue 单文件组件走默认导出，工具模块走具名导出，就是这个分工。

## 导入是实时视图，不是快照——以及循环引用会怎样暴露这件事

`import { counter } from './live-src.mjs'` 导入的是一个**绑定（binding）**，不是值的副本。`live-src.mjs`：

```js
export let counter = 0;
export function bump() { counter++; }
```

入口文件实跑输出：

```text
[入口] 第一次读 counter = 0
[入口] bump 两次后 counter = 2
[入口] 直接给导入绑定赋值 -> TypeError: Assignment to constant variable.
```

这三行就是 ESM 的完整语义：**值随导出方变化（live）**、**导入方不能改它（只读）**、**但导出方自己可以改**。CJS 做不到第一点：`const { counter } = require('./x')` 拿到的是那一刻的数，之后永远是 0；想读最新值只能再 `require` 一次或改读整个 `exports` 对象。

顺带一句命名空间对象的只读性质，实跑文案不同但结论一样：

```text
namespace 赋值 -> TypeError: Cannot add property X, object is not extensible
```

`ns.X = 1` 抛的是「对象不可扩展」，因为它不是普通对象，`ns` 是 sealed 的命名空间记录；`import()` 两次返回的是**同一个** namespace 对象（`a === b` 实测为 `true`）。

循环引用（A 引 B、B 引 A）之所以让人困惑，正是因为大家以为导入的是快照。**导入是提升的**：先解析整张依赖图，再按后序遍历求值。于是当 B 的模块体在 A 之前执行时，B 里读 A 的 `const` 会撞上暂时性死区（TDZ）。实跑两个文件：

```js
// cyc-a.mjs
import { bFn, bVal } from './cyc-b.mjs';
export const aVal = 'A 的值';
export function aFn() { return 'aFn 可用'; }
console.log('[a] 求值中 typeof bFn =', typeof bFn, '| 调用结果 =', (() => { try { return bFn() } catch (e) { return '抛错 ' + e.constructor.name + ': ' + e.message } })());
console.log('[a] 求值中 bVal =', (() => { try { return bVal } catch (e) { return '抛错 ' + e.constructor.name + ': ' + e.message } })());

// cyc-b.mjs
import { aFn, aVal } from './cyc-a.mjs';
export function bFn() { return 'bFn 可用'; }
export let bVal = 'B 的值';
console.log('[b] 求值中 aFn =', (() => { try { return aFn() } catch (e) { return '抛错 ' + e.constructor.name + ': ' + e.message } })());
console.log('[b] 求值中 aVal =', (() => { try { return aVal } catch (e) { return '抛错 ' + e.constructor.name + ': ' + e.message } })());
```

<Callout type="verified" title="循环引用与实时绑定：Node v25.4.0 实跑结果">

入口先 `import './cyc-a.mjs'`，`node cyc-entry.mjs` 的输出逐字如下：

```text
[b] 求值中 aFn = aFn 可用
[b] 求值中 aVal = 抛错 ReferenceError: Cannot access 'aVal' before initialization
[a] 求值中 typeof bFn = function | 调用结果 = bFn 可用
[a] 求值中 bVal = B 的值
[入口] 全部求值完成后：aVal = A 的值 | bVal = B 的值
[入口] aFn() = aFn 可用 | bFn() = bFn 可用
```

**这张输出表就是全部结论**：

| 观察 | 解释 |
| --- | --- |
| b 先于 a 求值 | 依赖图按后序遍历：a 依赖 b，所以 b 的模块体先执行 |
| b 里调用 `aFn()` **成功** | **函数声明被提升并在链接阶段就绪**，循环引用里照样可用 |
| b 里读 `aVal` **抛 ReferenceError** | `const` / `let` 绑定此刻仍在 TDZ，a 的模块体还没跑 |
| a 里读 `bVal` 正常拿到值 | b 已经求值完毕，绑定已初始化 |
| 全部求值完，两边都正常 | **循环引用在「只通过函数交换数据」时是可以工作的** |

所以症状记法是：**循环引用的报错点几乎总在「取值」那一侧，而不是「调用函数」那一侧**；而最阴的一种是值刚好是 `undefined` 却没抛错（比如导出的是 `var` 或已经存在但尚未赋值的对象属性），故障被推迟到页面深处。**解法按优先级**：① 把两边共用的东西提到第三个模块，让依赖图变成单向（最推荐）；② 让交换只通过函数发生，调用发生在求值之后；③ 把求值推后到函数内部（惰性求值）；④ 用动态 `await import()` 打断静态环。第 ① 条是唯一从根上解决的做法，其余都是绕。

</Callout>

**模块只求值一次**：同一 URL 的模块第二次导入不会重跑模块体（上面 `counting.mjs` 的日志只出现一次即为证明）。所以「在模块顶层 `new Date()` 或发起请求」会被所有导入方共享，这既是缓存也是隐式全局状态——**有状态的模块要显式导出工厂函数，而不是导出实例**（[原型与 class](/javascript/prototypes-and-classes) 里讨论过的同一取舍）。

## 浏览器里的 ESM：这就是项目必须起静态服务器的原因

浏览器只认 URL，不认裸模块说明符。三条硬条件：

```html
<!-- 1. 必须声明 type="module" -->
<script type="module" src="/main.js"></script>
```

| 条件 | 说明 |
| --- | --- |
| MIME 类型 | 模块脚本的响应 `Content-Type` 必须是 JS 类型（如 `text/javascript`）；服务器返回 `text/plain` 时控制台立刻报 `failed to load module because of MIME type`，这是用静态服务器而不是随手写的脚本时最常撞的墙 |
| `file://` | **加载失败**。模块一律按 CORS 规则取，`file://` 的源是 `null`，取兄弟文件等于跨源。本站[阶段项目](/javascript/project)要求起本地静态服务器，原因就在这条，不是「习惯」 |
| 裸名 | `import { x } from 'dayjs'` 在浏览器里不成立，必须写成 URL 或配 import map |

模块脚本自带三项与经典脚本不同的行为：**默认 defer**（不阻塞 HTML 解析，在文档解析完成后按发现顺序执行）、**作用域隔离**（顶层变量不进 `window`，[作用域](/javascript/functions-and-scope) 里那条「全局变量污染」的解药）、**严格模式**。于是 `var` 声明在模块里不再是全局，你在控制台里 `window.foo` 读不到模块里的东西——想给外部暴露就显式写 `window.foo = foo`。

动态 `import()` 是唯一能写成函数调用的加载方式：

```js
const unit = await import(`./locales/${lang}.js`);   // 路径可以是表达式
button.addEventListener('click', () => import('./heavy-editor.js'), { once: true });
```

它返回 `Promise<模块命名空间对象>`，**首次调用才去取、才求值，之后走缓存**（本章上面实测 `a === b` 为 true）。用途三条：按条件加载（只在用户打开富文本时才拉编辑器）、按路由分割（[Vue Router](/vue/router) 的路由懒加载就是它）、以及从外部配置决定的字符串路径加载插件。

它同时是**代码分割的入口**：打包器把每个动态导入点切成一个 chunk，首屏只下载当前需要的那几个。切分的收益与代价在 [Vite 构建侧](/frontend-engineering/vite-build) 讲——**同一个模块被动态与静态混合引用时，摇树分析失效**，这是「明明只在一处用却打进了首屏包」的常见成因。

裸名与依赖共享由 **import map** 处理，不需要构建工具：

```html
<script type="importmap">
{
  "imports": {
    "dayjs": "https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.esm.min.js",
    "./utils/": "/src/utils/"
  },
  "scopes": { "/src/admin/": { "chart": "/src/admin/chart.js" } }
}
</script>
<script type="module">import dayjs from 'dayjs';</script>
```

`imports` 做名字到 URL 的映射，`scopes` 让某个路径下的页面用另一套映射。**两条限制必须知道**：import map 必须在任何使用它的模块脚本**之前**声明并处理完，晚插入无效；文档里可以有多个 map 并由浏览器合并，但较旧的浏览器实现只允许一个且必须在加载任何模块前给出（核实于 MDN，见[官方页面](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap)）。用不用它是取舍：写了 import map 你就得自己管理 CDN 上的版本与完整性校验，用 [Vite 开发侧](/frontend-engineering/vite-dev) 的预构建则不需要它——Vite 自己把裸名解析成 URL，**这才是「本项目不需要 import map」的原因**。

## package.json 的 type 与 exports：一个概览

| 字段 | 管什么 |
| --- | --- |
| `"type"` | 决定 `.js` 被当成 ESM（`"module"`）还是 CJS（`"commonjs"`，默认）；`.mjs` 恒为 ESM、`.cjs` 恒为 CJS，与 `type` 无关 |
| `"main"` | 老的入口字段，只服务 CJS 消费者 |
| `"exports"` | 现代入口映射，支持条件导出与子路径限制 |
| `"sideEffects"` | 给打包器的摇树提示：`false` 表示未使用的导出可以安全删除，也可写文件 glob 保留引入样式的入口 |
| 顶层 `"module"` | 事实上的历史约定（早于 `exports`），多数打包器仍读它 |

`exports` 的条件导出是双格式包的标准写法：

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "default": "./dist/index.js"
    },
    "./package.json": "./package.json"
  }
}
```

四条要点：**条件顺序有意义**，`types` / `import` / `require` 写在 `default` 之前；**`exports` 一旦声明就封闭了子路径**，外部 `import 'pkg/src/internal.js'` 会失败，需要就在 `exports` 里显式开放（这正是很多包升级后「原本能引的文件引不到了」的原因）；`main` 依然要留着照顾老工具链；**`type` 影响的是后缀解释，不影响语法兼容**，别指望它让 CJS 代码变成 ESM。Node 与打包器对 `exports` 的解析细节不同，写库之前核对 [Node 官方文档的模块解析一节](https://nodejs.org/api/packages.html)；本站[包管理](/frontend-engineering/package-managers)讲怎么装、[模块与声明文件](/typescript/modules-and-declarations)讲 TS 的 `moduleResolution` 怎么选策略——**`bundler` 与 `nodenext` 下同一份 `exports` 的解析结果可以不同**，这是「VSCode 里不报错但运行不了」的常见原因。

## 迭代器协议：for...of 到底调了什么

可迭代（iterable）的定义只有一条：**对象上有 `[Symbol.iterator]()` 方法，调用它返回一个迭代器**。迭代器的定义也只有一条：**有 `next()` 方法，每次返回 `{ value, done }`**。

```js
const range = {
  from: 1, to: 5, step: 2,
  [Symbol.iterator]() {
    let current = this.from;
    const last = this.to, s = this.step;
    return {
      next() {
        if (current <= last) { const v = current; current += s; return { value: v, done: false }; }
        return { value: undefined, done: true };
      },
      return() { console.log('   [range] return() 被调用（提前 break 时）'); return { done: true }; },   // 提前退出时被调用
    };
  },
};
```

`for...of` 的执行过程是：调 `[Symbol.iterator]()` 拿迭代器 → 反复 `next()` → 每次先查 `done` → `value` 赋给循环变量 → `break` / `return` / `throw` 时调用迭代器上的 `return()`（用于释放资源）。`return()` 是可选方法，但**有副作用的迭代器必须实现它**，否则提前退出会留下未关闭的资源。

实跑输出，逐字如下：

<Callout type="verified" title="可迭代性与自定义迭代器：Node v25.4.0 实跑结果">

```text
Array [1,2]      可迭代: true
String "ab"      用 in 探测 -> TypeError: Cannot use 'in' operator to search for 'Symbol(Symbol.iterator)' in ab
String "ab"      用 typeof 探测 -> true
Map              可迭代: true
Set              可迭代: true
普通对象 {}       可迭代: false
函数 function     可迭代: false
--- 2. for...of 普通对象 ---
抛错 -> TypeError: {} is not iterable
--- 3. 自定义 range 迭代器 ---
   [...range] = [1,3,5]
   提前 break，实际取到 3
   [range] return() 被调用（提前 break 时）
   Array.from(range) = [1,3,5]
```

**两条值得单独记住的输出**：

1. **`Symbol.iterator in 'ab'` 直接抛 `TypeError`**——`in` 要求右侧是对象，原始值不行。**探测可迭代性的正确写法是 `typeof value[Symbol.iterator] === 'function'`**，它对原始值也安全（字符串上取到的是函数，如上表所示 `true`）。
2. **`for...of` 遍历普通对象抛的是 `TypeError: {} is not iterable`**，V8 还会把对象打印出来。这不是「循环写法不对」，是对象真的没有那个方法。

</Callout>

| 可迭代 | 不可迭代 |
| --- | --- |
| `Array`、`String`（逐码点，代理对算一个）、`Map`、`Set`、`TypedArray`、`arguments`、`NodeList` 等 DOM 集合、`Intl.Segmenter` 的结果、生成器对象 | **普通对象**、`Object`、`Number`/`Boolean`/`null`/`undefined`、WeakMap / WeakSet（无语义上的顺序） |

浏览器里 `NodeList` 可迭代而 `HTMLCollection` 不可迭代，这是 DOM 接口的历史遗留（[DOM 与事件](/javascript/dom-and-events)）——`document.querySelectorAll` 返回的是 `NodeList`，所以能 `for...of`；`element.children` 返回 `HTMLCollection`，不能。**遇到不确定的集合，先看 `Symbol.iterator` 在不在，再决定用 `for...of` 还是 `[...x]`。**

普通对象不可迭代，四种解法按侵入性排序：

```js
for (const k of Object.keys(obj)) ...           // 只要键
for (const [k, v] of Object.entries(obj)) ...   // 键值对，最常用（返回的是普通数组，走的是数组的迭代协议）
for (const k in obj) ...                        // for...in 遍历可枚举键，会走原型链：几乎总该配 obj.hasOwnProperty(k)
obj[Symbol.iterator] = Object.values(obj)[Symbol.iterator];   // 直接借用数组的迭代器，让对象本身可迭代
```

顺带一句 `Symbol` 本身（[对象与数组](/javascript/objects-and-arrays) 的扩展主题）：`Symbol.iterator` 这类**众所周知的符号（well-known symbols）**是语言给「协议」预留的挂钩点，同类还有 `Symbol.asyncIterator`、`Symbol.hasInstance`、`Symbol.toPrimitive`。理解这个思路，`Proxy` 拦截的也正是同一批内部方法（[Vue 响应式原理](/vue/reactivity) 的直接基础）。

解构、展开、`Array.from` 用的都是同一套协议——它们都调 `Symbol.iterator`，所以 `[...range]`、`Array.from(range)` 与 `for...of range` 结果必然一致（上表已实测）。顺带解释了那个老问题：`[...new Set(arr)]` 和 `[...obj]` 报错（`{}` 是迭代协议之外的语法）本质是**对象展开走的是另一条路（复制可枚举自有属性）**，与迭代器无关，两者别混谈。

## 生成器：函数是协程，yield 是双向通信

`function*` 定义的函数调用后**不执行函数体**，只返回一个生成器对象（它同时是迭代器，也是可迭代对象）。每次 `next()` 才推进到下一个 `yield`。

```js
function* echo() {
  const a = yield '第一步：产出 ready';
  console.log('   生成器内部收到 next(' + a + ')');
  const b = yield '第二步：把你给的 ' + a + ' 又传回去';
  console.log('   生成器内部收到 next(' + b + ')');
  return '结束，最后一棒收到 ' + b;
}
const g = echo();
console.log('   next() ->', JSON.stringify(g.next()));
console.log('   next(7) ->', JSON.stringify(g.next(7)));
console.log('   next("停") ->', JSON.stringify(g.next('停')));
```

实跑输出，`yield` 的双向语义一目了然——**`yield` 表达式向外产出一个值，同时接收下一次 `next(x)` 传进来的值**：

```text
   next() -> {"value":"第一步：产出 ready","done":false}
   生成器内部收到 next(7)
   next(7) -> {"value":"第二步：把你给的 7 又传回去","done":false}
   生成器内部收到 next("停")
   next("停") -> {"value":"结束，最后一棒收到 停","done":true}
   [...fib(10)] = [0,1,1,2,3,5,8]
```

**注意 `next()` 的传值有「一次延迟」**：第一个 `next()` 的参数被丢弃（那时生成器还没停在任何 `yield` 上），所以第一次调用不带参数；最后一次 `next()` 的返回值 `done: true`、`value` 是函数 `return` 的值。惰性也实测过：无限自然数生成器 `function* nat() { let i = 1; while (true) yield i++; }` 配合 `break` 只取 5 个，输出 `[1,2,3,4,5]`，循环没有变成死循环——**因为 `while (true)` 里的 `yield` 会让函数在每次产出时挂起**。

什么时候真的值得用：

| 场景 | 为什么合适 |
| --- | --- |
| 自定义迭代序列（分页游标、树/图遍历、按规则产数据） | 一次 `yield` 一个，不用先构造整个数组 |
| 数据管道（`map` / `filter` 式逐条处理） | 常数内存，可组合 |
| 状态机 / 协程式流程编排 | 暂停点由代码位置决定，读起来像同步代码 |
| 无限或超大序列 | 无法预先materialize，边产边消费 |
| 旧式异步方案（co / thunk） | 当年用生成器 + Promise 模拟 async/await；**今天直接用 `async`，别写这种代码** |

**判断标准是：你需要「一次产出一个、并且随时可以停」吗？**如果只是想少写几行，用数组方法和 `for...of` 更清楚；`async` 函数已经是更常用的那一半（[事件循环与 Promise](/javascript/asynchronous)），生成器现在最大的价值是作为**异步迭代器**的语法基础。

## 异步迭代：for await...of

异步迭代协议要求对象有 `[Symbol.asyncIterator]()`，返回的迭代器 `next()` 返回 `Promise<{ value, done }>`。`async function*` 直接把两者合起来：

```js
async function* pages() {
  for (let p = 1; p <= 3; p++) {
    await new Promise((r) => setTimeout(r, 30));
    yield `第 ${p} 页`;
  }
}
for await (const label of pages()) console.log('   收到:', label);
```

实跑输出（连同下面两处流式实测一起给在同一个标注里）：

```text
   收到: 第 1 页
   收到: 第 2 页
   收到: 第 3 页
```

**为什么必须 `for await` 而不是 `for...of`**：普通 `for...of` 会拿 `next()` 返回的 Promise 本身作为迭代值，你会得到三个 pending Promise；`for await` 在每轮之间等一次，取到解包后的值。同理，`[...asyncGen()]` 不会工作，`Array.from` 只走同步协议。

`ReadableStream` 的消费在 Node 里同样实跑过（`node:http` 起的临时服务器每 25 ms 推一块，共 3 块）：

<Callout type="verified" title="异步迭代与流式消费：Node v25.4.0 实跑结果">

同上面的环境与方法（`node async-iter.mjs`，2026-10-17）。三个输出块逐字如下：

```text
--- 1. for await...of 消费异步生成器 ---
   收到: 第 1 页
   收到: 第 2 页
   收到: 第 3 页
--- 2. 流式响应：response.body 的两种消费方式 ---
   分块到达节奏: [45ms 5B] [72ms 5B] [104ms 11B]
   getReader 循环拼出的正文 = 块1 块2 块3 结束
   response.text() 一次性读完 = 块1 块2 块3 结束
--- 3. for await 中的错误与提前退出 ---
   拿到 1
   捕获 -> 流断了
```

**确认的结论**：`for await` 确实逐轮等待（页 1/2/3 顺序到达）；Node 的 `response.body`（Web `ReadableStream`）既能 `for await` 也能 `getReader()` 循环，两者拼出的正文与 `text()` 完全一致；**分块是真正增量到达的**（第 5 行那三个时间戳分别约 45 / 72 / 104 ms，说明没有等整体结束，这正是逐字渲染的前提）；**异步生成器内部抛出的错误，必须在 `for await` 循环外面包 `try/catch` 才收得到**（第 3 项即为该结论的实测）。

</Callout>

<Callout type="unverified" title="浏览器里对 ReadableStream 用 for await 需要核实">

上面实测跑在 **Node v25.4.0**，Node 给 Web `ReadableStream` 加了异步迭代支持。**同一写法在浏览器里不保证可用**（浏览器侧对该支持的时间线晚于 Node，本环境没有可运行浏览器，无法验证）。跨环境安全的写法是显式的 reader 循环，它两端都能用：

```js
const reader = res.body.getReader();
const decoder = new TextDecoder();
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  ui.append(decoder.decode(value, { stream: true }));    // stream: true 才能正确拼接跨块的 UTF-8 多字节字符
}
```

`{ stream: true }` 不是可选项：少了它，跨块的多字节中文字会变成乱码——这类 bug 只在真实流式响应里出现，很难在本地 mock 中复现。**`for await` 的写法进浏览器前先核对，见[流式响应与前端渲染](/ai-apps/streaming)。**

</Callout>

异步迭代在真实项目里对应四件事：分页 API 的自动翻页、流式响应逐块渲染（LLM 输出的 token 流，见[流式响应](/ai-apps/streaming)）、消息队列消费（[Redis Stream](/message-queue-cloud/redis-stream)）、文件按行读取（`node:stream` + `readline`）。它与本章前面那条约束接得上：**Node 的 stream 早就可异步迭代，Web `ReadableStream` 则取决于运行环境**。

异步生成器还能做同步生成器做不到的事——**背压**：消费方 `await` 多久，生产方就等多久，不会因为产得太快把内存吃满。分页拉取写成异步生成器，调用方看起来就只是「一个 for 循环」。

## 实用小工具：把「遍历」写清楚

```js
// 1. 遍历对象：键值对最清楚，别再用 for...in + hasOwnProperty 的老写法
for (const [key, value] of Object.entries(config)) {
  if (value == null) continue;                     // null / undefined 一起挡掉
  el.dataset[key] = String(value);
}

// 2. 可复用的 range 迭代器：不占内存，for...of / 展开 / Array.from 都能用
function* range(from, to, step = 1) {
  for (let i = from; step > 0 ? i <= to : i >= to; i += step) yield i;
}
[...range(0, 10, 3)];                              // [0, 3, 6, 9]
[...range(3, 0, -1)];                              // [3, 2, 1, 0]

// 3. 惰性取前 N 个：无限序列也不怕，break 会触发迭代器的 return()
function* ids() { let i = 1; while (true) yield `task-${i++}`; }
const first5 = [];
for (const id of ids()) { first5.push(id); if (first5.length === 5) break; }
```

异步迭代这边只有一条要记的：**循环体外必须包 `try/catch` 才收得到生成器内部抛出的错**，`break` 则触发迭代器的异步 `return()`。实测：一个「产出 1 之后抛 `Error('流断了')`」的异步生成器，`for await` 外面捕获到的正是这条消息。

## 常见错误与排查

**1. `Cannot use 'import.meta' outside a module`。** 现象：写了 `import.meta.url` 就直接编译失败，`try/catch` 拦不住。原因：文件被当成 CJS 解析。确认：看文件后缀与最近 `package.json` 的 `type`。修法：改 `.mjs`，或把 `package.json` 设 `"type": "module"`（注意这会让该目录下所有 `.js` 变成 ESM，一次性影响整包）。

**2. `require()` 一个 ESM 报 `ERR_REQUIRE_ASYNC_MODULE`。** 现象：错误文案直接建议改用 `import()`。原因：目标 ESM 图里有顶层 `await`，同步的 `require` 拿不到已完成求值的模块。确认：`grep -rn "await" 那个模块`（本章实跑已复现这条文案）。修法：整条链改成异步；不得不用 `require` 的老代码里把顶层 `await` 挪进函数。

**3. `import { x } from 'some-cjs-package'` 拿到 undefined。** 现象：不抛错，值却是 `undefined`。原因：`default` 与具名混淆——`export default { x }` 的 `x` 不会变成具名导出，而 CJS 的具名导出依赖静态分析，某些形状（如动态赋值 `module.exports[key] = v`）分析不出来。确认：`import * as ns from 'pkg'; console.log(Object.keys(ns))`。修法：改用 `import pkg from 'pkg'` 再 `pkg.x`；TS 侧核对 `esModuleInterop`（[模块与声明文件](/typescript/modules-and-declarations)）。

**4. 循环引用里某个导入值是 `undefined`，或报 `Cannot access 'x' before initialization`。** 现象：报错点在「取值」那一侧而不是「调用函数」那一侧（本章已实测）。原因：模块求值顺序导致绑定还没初始化——`function` 声明提升可用，`const` / `let` 在 TDZ。确认：在两个模块体第一行各打一条 log，看谁先跑。修法：把共用逻辑抽到第三个模块打断环；或把求值改到函数调用时（惰性），或改用动态 `import()`。

**5. 双击 HTML 打开，模块全部加载失败。** 现象：`... from origin 'null' has been blocked by CORS policy`，或模块里的 `fetch` 报 `URL scheme must be http or https for CORS request`。原因：`file://` 下模块请求要过 CORS，而它的源是 `null`。确认：地址栏协议。修法：起本地静态服务器，别改代码去迁就 `file://`。

**6. `TypeError: {} is not iterable`。** 原因：普通对象没有 `Symbol.iterator`。确认：`typeof obj[Symbol.iterator]`。修法：`Object.entries(obj)`，或 `obj[Symbol.iterator] = Object.values(obj)[Symbol.iterator]` 借用数组迭代器。

**7. `Symbol.iterator in value` 报 `Cannot use 'in' operator`。** 原因：`in` 左侧必须是字符串键、右侧必须是对象；传字符串或数字就抛错（本章实测文案已抄录）。修法：改用 `typeof value[Symbol.iterator] === 'function'`。

**8. `for...of` 里 `break` 之后资源没释放。** 现象：文件句柄、订阅、定时器还在跑。原因：迭代器没实现 `return()`（本章示例里那个 `return()` 就是为这种情况准备的）。确认：在 `return()` 里打 log，看 `break` 时是否调用。修法：自定义迭代器实现 `return()`，或在 `finally` 里显式释放；异步场景给 `for await` 包 `try/finally`。

**9. tree-shaking 没生效，未使用的代码全打进产物。** 现象：只用了包里的一个函数，产物里却有整个包。原因之一：`import * as ns from 'pkg'` 后动态取键 `ns[key]`，静态结构失效；原因之二：包的 `package.json` 没有 `sideEffects`，工具不敢删；原因之三：模块顶层有副作用（`fetch`、埋点、注册全局），整个模块被判定必须执行。确认：产物分析（[Vite 构建侧](/frontend-engineering/vite-build)），搜那些函数的名字。修法：具名导入、少用命名空间动态取键、把副作用收进独立入口，库作者要如实标 `sideEffects`。

**10. 同一份代码本地能跑、CI 报 `require() of ES Module is not supported`。** 原因：本地 Node 与 CI 的 Node 大版本不同，`require(esm)` 的支持程度不一致；或 `package.json` 的 `type` 在两处解析结果不同（monorepo 里往上找到的不是同一份）。确认：本地与 CI 各跑一次 `node -p "process.version"` 并打印实际解析到的 `package.json` 路径。修法：统一 Node 大版本（[包管理](/frontend-engineering/package-managers)），并把模块类型显式写进 `package.json`。

## 练习

<Exercise title="练习 1 · 这段循环引用会抛错吗" difficulty="进阶">

入口文件先 `import './a.mjs'`。写出四个 `console.log` 的输出（能打印的写值，抛错的写错误类型）。

```js
// a.mjs
import { sayB, bVal } from './b.mjs';
export function sayA() { return 'A'; }
export const aVal = 'a';
console.log(1, typeof sayB, bVal);
console.log(2, (() => { try { return sayB() } catch (e) { return e.constructor.name } })());

// b.mjs
import { sayA, aVal } from './a.mjs';
export function sayB() { return 'B'; }
export const bVal = 'b';
console.log(3, (() => { try { return aVal } catch (e) { return e.constructor.name } })());
console.log(4, (() => { try { return sayA() } catch (e) { return e.constructor.name } })());
```

<template #answer>

顺序：入口 → a 的依赖先求值 → **b 的模块体先跑** → 再跑 a 的模块体。

| 输出 | 结果 | 为什么 |
| --- | --- | --- |
| 3 | `ReferenceError` | b 求值时 a 还没跑到 `export const aVal`，绑定在 TDZ |
| 4 | `'A'` | **函数声明提升**，`sayA` 在链接阶段就已就绪 |
| 1 | `function 'b'` | a 求值时 b 已经完成，`bVal` 已初始化 |
| 2 | `'B'` | 同上，函数可调 |

打印顺序是 `3、4、1、2`，不是文件里的书写顺序。**结论：循环引用在「只通过函数交换数据」时可以工作，一旦在求值阶段读对方的 `const` / `let` 就必炸。**修法是把共用状态提到第三个模块，或把读值推到函数调用之后。（本章上面那段实跑输出就是这个结论的证据，只有变量名不同。）

</template>

</Exercise>

<Exercise title="练习 2 · import 还是 require" difficulty="基础">

一个包只给了 `module.exports = { Client, parse }`，没有 ESM 版本。你的项目是 `"type": "module"`。

（1）哪种导入写法最稳？（2）如果必须 `require` 它怎么办？（3）此时 `typeof module` 是什么？

<template #answer>

（1）最稳是**默认导入整个 exports 对象再取值**：

```js
import pkg from 'legacy-pkg';
const { Client, parse } = pkg;
```

具名 `import { Client } from 'legacy-pkg'` 在 Node 里往往也能工作（静态分析会给 `module.exports = { ... }` 这种形状合成具名导出，本章实测为真），但它是**分析器的推测**而非语言保证：换个打包器、换种 `moduleResolution`、或者包作者改写成先声明对象再赋值的形状，具名导入就可能变成 `undefined`。要稳就先取默认再解构。

（2）用 `createRequire` 造一个 CJS 加载器：

```js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('legacy-pkg');       // 得到 module.exports 本身
```

（3）`typeof module` 是 `undefined`（实测）。ESM 里没有 `module`、没有 `exports`、没有全局 `require`、也没有 `__dirname`；需要路径时用 `import.meta.url`，需要 CJS 能力时用上面那个 `createRequire`。**别指望把 `typeof require` 当环境判断依据**——`createRequire` 之后它就是 `function` 了，这时候真正能区分的是 `typeof module === 'undefined'`。

</template>

</Exercise>

<Exercise title="练习 3 · 谁可以被 for...of" difficulty="基础">

下面六行各自的执行结果是什么？（值或错误类型）

```js
for (const c of 'ab') {}                        // 1
for (const x of { a: 1, b: 2 }) {}              // 2
for (const x of new Map()) {}                   // 3
const s = Symbol.iterator in 'ab';              // 4
const n = [...document.querySelectorAll('li')]; // 5
const m = [...element.children];                // 6
```

<template #answer>

| 行 | 结果 |
| --- | --- |
| 1 | 正常，逐字符两次（中文场景按**码点**切，`'𝐚'.length === 2` 但 `for...of` 只迭代一次） |
| 2 | **`TypeError: {} is not iterable`**（实测文案） |
| 3 | 正常，零次循环（空 Map 也是可迭代对象） |
| 4 | **抛 `TypeError`**：`in` 不能作用于原始值，实测文案 `Cannot use 'in' operator to search for 'Symbol(Symbol.iterator)' in ab` |
| 5 | 正常。`querySelectorAll` 返回 `NodeList`，它可迭代 |
| 6 | **别赌**。`element.children` 返回 `HTMLCollection`，而 MDN 的 `HTMLCollection` 页面只给了 `item()` 与 `namedItem()` 两个实例方法，**没有 `forEach`、没有 `Symbol.iterator`**（规范对 `NodeList` 明确给了迭代器，对 `HTMLCollection` 没有），页面里的建议就是「要遍历先 `Array.from` 拷一份」。所以在浏览器里写 `[...element.children]` 属于依赖实现细节，**稳妥写法是 `Array.from(element.children)`**——`Array.from` 走 `length` + 索引的类数组路径，两种集合都吃得下 |

两条结论合起来是这题的考点：**① 探测可迭代性用 `typeof v[Symbol.iterator] === 'function'`，不要用 `in`**（第 4 行会抛）；**② DOM 的两套集合接口待遇不同**：`querySelectorAll` 的 `NodeList` 有迭代器，`children` / `getElementsByClassName` 的 `HTMLCollection` 按 MDN 的说法没有。**拿不准就统一 `Array.from(...)`**，它对类数组永远有效，还顺手把实时集合拷成静态数组，避开了[DOM 与事件](/javascript/dom-and-events) 里「删一半」那个坑。

</template>

</Exercise>

<Exercise title="练习 4 · 写一个分页迭代器" difficulty="挑战">

实现 `paginate(fetchPage)`：输入 `(total, size) => Promise<Array>` 形态的函数，产出一个可迭代对象，`for...of` 时自动翻页，取完为止。要求：不预先构造全部页、能提前 `break`。

<template #answer>

`for...of` 不能 `await`，所以自动翻页必须写成**异步生成器 + `for await`**。先给同步版（数据已在内存），再给真实场景版：

```js
function* chunked(items, size) {                 // 同步：把数组切成页
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

async function* paginate(total, size, fetchPage) {   // 异步：每页现取
  for (let offset = 0; offset < total; offset += size) {
    const items = await fetchPage(offset / size);     // 每轮之间等待，这就是背压
    if (!items?.length) return;                       // 空页提前收尾
    yield* items;                                     // yield* 委托：把子迭代器逐个产出
  }
}

for await (const task of paginate(1000, 100, (page) => request(`/api/tasks?page=${page}`))) {
  if (task.title.includes('STOP')) break;             // 触发迭代器的异步 return()，剩余页不再请求
}
```

三个要点：**① `yield*` 是委托**，把子迭代器的产出原样透出，自己不会多包一层数组；**② 提前 `break` 会调用 `return()`**，异步生成器因此停止后续请求，省掉一整批接口调用；**③ 分页与状态**：这类「游标式遍历」在界面上对应无限滚动，用 `IntersectionObserver` 的哨兵元素触发下一页（[DOM 与事件](/javascript/dom-and-events) 示例二），两者配合才不重复请求。

**故意制造错误并解释**：把 `for await` 写成 `for...of`，循环不会报错，但你会拿到 `total / size` 个 pending Promise——`of` 每轮取的是 `next()` 的返回值本身，而异步迭代器的返回值是 Promise。`task.title` 于是是 `undefined`，抛 `Cannot read properties of undefined`。这个现象常被误诊成「接口返回结构不对」，实际是**协议用错了**：异步迭代必须 `for await`。

</template>

</Exercise>

<Exercise title="练习 5 · 故意让 tree-shaking 失效" difficulty="挑战">

一个自研工具包 `utils` 里有 40 个函数，调用方只用 `debounce`，但产物里 40 个都在。给出三种**不同层面**的成因，以及各自的确认方法。

<template #answer>

| 层面 | 成因 | 怎么确认 |
| --- | --- | --- |
| **导入写法** | 用了 `import * as U from './utils'` 后动态取键 `U[name]`，静态结构失效，工具无法判断用了哪个 | 全局搜 `import \* as`，看有没有 `ns[...]` 形式的访问 |
| **模块顶层有副作用** | `utils.js` 顶层执行了 `const cache = new Map()` 以外的东西（注册全局、`fetch`、读 `localStorage`），整模块被判定为必须求值，于是导出全留 | 打开模块文件，检查 `export` 之外是否有顶层语句；把可疑文件设 `sideEffects: true` 对比产物大小 |
| **包的元信息与导出形式** | `package.json` 没写 `sideEffects`，或用的是 `export default { a, b, c }`——对象属性不是可独立摇掉的绑定 | 打开包的 `package.json` 看字段；看入口是 `export default {}` 还是逐项 `export const` |

对应修法：改成具名导入 `import { debounce } from './utils'`；顶层副作用收进独立入口文件（例如 `register-polyfills.js`）并如实声明 `sideEffects`（引入样式的 `.css` 入口要在 glob 里显式保留，否则会被整段删掉，这是另一类「样式莫名其妙丢了」的成因）；把 `export default { ... }` 拆成逐项具名导出。

**验证方式**：构建产物分析（[Vite 构建侧](/frontend-engineering/vite-build)），在源码映射里搜其余 39 个函数的名字。搜不到才算真删掉——**只看产物体积不够**，压缩与缓存都会改变体积。注意「体积变大」也可能是 `exports` 字段没配对导致同时打进 CJS 与 ESM 两份，这与摇树是两回事，先区分再优化。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN `import()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import) —— 核实动态导入返回 Promise、按解析后的 URL 缓存（本章「两次 import 得到同一对象」结论的规范依据）。
- [MDN `import` 语句](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import) —— 核实 `import` 的提升语义、聚合导出与 `default` 只是名为 `default` 的导出（练习 2 依据）。
- [MDN `<script type="importmap">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap) —— 核实 `imports` / `scopes` 结构、「必须先于使用它的模块脚本声明」、以及旧实现只允许单个 map（import map 一节的依据）。
- [MDN `Symbol.iterator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/iterator) —— 核实迭代协议与「提前退出调用 `return()`」，以及 `HTMLCollection` / `NodeList` 的可迭代性差异（练习 3 第 6 行的核实入口）。
- [MDN `for await...of`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) —— 核实异步迭代协议与 `next()` 返回 Promise 的解包规则（练习 4 的错因依据）。
- [MDN `ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) —— 核实 Web 侧 `ReadableStream` 的接口形态（Node 与浏览器差异那条标注的依据）。
- [nodejs.org · Modules: ES modules](https://nodejs.org/api/esm.html) —— 核实 `type` 字段、`.mjs` / `.cjs`、`require(esm)` 的支持范围与 `ERR_REQUIRE_ASYNC_MODULE`（本章两组实测结论的官方来源，版本敏感，动手前对一次）。
- [nodejs.org · Packages](https://nodejs.org/api/packages.html) —— 核实 `exports` 条件顺序与子路径封闭规则。
- [javascript.info · Modules](https://javascript.info/modules) —— ESM 语法与循环依赖的对照读物，含更多练习。
- [javascript.info · Iterables](https://javascript.info/generator) —— 迭代器与生成器的原始讲解（本站领域首页建议只读 iterables 一节）。

## 下一章

本章讲的是代码怎么被加载、值怎么被交换、序列怎么被遍历；下一章 [错误处理与 DevTools 调试](/javascript/errors-and-debugging) 解决另一头的问题：这些东西坏掉时**怎么发现**。TDZ 的 `ReferenceError`、迭代协议用错导致的 `undefined` 属性访问、模块解析失败——它们都需要一套固定的排查路径（断点、Scope 面板、调用链、`console.assert` 与错误分类），而不是靠加打印碰运气。之后再读 [JS 层面的无障碍与性能](/javascript/accessibility-and-performance)，最后用[阶段项目](/javascript/project) 把这三章接起来：一个纯 JS 的待办清单，`<script type="module">` + 本地静态服务器、一次事件委托、`localStorage` 持久化加一个真实的 `fetch`。
