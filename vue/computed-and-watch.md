# 计算属性与侦听器：派生值交给 computed，副作用交给 watch

三个故障看着无关，其实是同一个判断做错的三种表现。

**故障一**：搜索框输入 `vue` 三个字母，Network 面板里四条请求，最后渲染出来的是最早那条 `vu` 的结果。数据是对的，界面是错的，而且**只在网络慢的时候复现**。

**故障二**：模板里用双花括号插值直接调了 `totalOf(items)`。列表一千条。你给 `totalOf` 加一句 `console.log`，发现鼠标点一下按钮它被打印了七次——而你只重渲染了一次。

**故障三**：为了「筛选后的列表」，你额外存了 `filteredTodos`，然后在新增、删除、改状态、改筛选条件、改排序五处手动更新它。第三处漏了一个 `if`，界面和数据从此永久分叉，而你每次排查都是「数据明明是对的」。

这三个故障的共同根因：**你没有区分「派生值」和「副作用」**。派生值是别的状态在某一时刻的快照，它永远可以由源算出来，所以它**不该被存**；副作用是你对界言之外的东西（网络、磁盘、第三方库、埋点）做的一次动作，它有「已经做过没有」这个历史，所以它**必须被显式触发**。`computed` 是框架给前者的容器，`watch` 是给后者的容器。混用不会报错——这就是它难查的原因。

前置：[响应式原理](/vue/reactivity)（依赖收集与触发更新）、[模板语法与指令](/vue/template-syntax)（模板是状态的函数）。异步那一侧的取消与竞态，回指 [事件循环、Promise 与 async/await](/javascript/asynchronous)。

## computed 的缓存语义：和「直接写个函数」到底差在哪

官方对 `computed` 的定义里，全部差别都在一句话上（[计算属性](https://vuejs.org/guide/essentials/computed.html)，2026-10-17 核实）：

> computed properties are cached based on their reactive dependencies. A computed property will only re-evaluate when some of its reactive dependencies have changed.

以及对照句：

> In comparison, a method invocation will **always** run the function whenever a re-render happens.

把这两句拆开看，`computed` 相对「模板里直接调函数」有三层真实差别：

| 场景 | 模板里调函数 | `computed` |
| --- | --- | --- |
| 一次渲染里读 3 次 | 跑 3 次 | 跑 1 次 |
| 依赖没变、但组件因别的状态重渲染 | 再跑 1 次 | **直接返回上次结果，不跑** |
| 依赖变了 | 跑 1 次 | 跑 1 次 |
| 组件卸载后 | 无差别 | 无差别（都不跑） |
| 能否被别处复用、能否单独断言 | 勉强 | 天然可以（导出的 composable 里就是一个 ref） |

第三行才是重点，也是「缓存」的实际含义：**它省的不是重复计算本身，而是重渲染带来的无意义重算。** 组件的重渲染频率远高于你的直觉——任何被模板读过的状态一变就重渲染整棵子树。列表页上你切换一个展开箭头，`filteredAndSorted` 这种函数就会全量重跑一次。

用计数器观察差别（把这段放在 `<script setup>` 顶层，`count` 是一个 `ref`）：

```js
// 仅用于观察求值次数，真实代码里不要在 getter 里写计数
let getterRuns = 0

const isEven = computed(() => {
  getterRuns++
  return count.value % 2 === 0
})

const asMethod = () => {
  getterRuns++
  return count.value % 2 === 0
}

// 连续读三次，一次都没写
console.log(isEven.value, isEven.value, isEven.value)
// 预期结果是：true true true，getterRuns === 1

console.log(asMethod(), asMethod(), asMethod())
// 预期结果是：getterRuns 在这三行里 +3
```

预期结果的判读方式：`computed` 三次读取只算一次，因为依赖 `count` 没变；普通函数调用三次算三次。这个片段可以在 [Vue SFC Playground](https://play.vuejs.org/) 里三秒验证，不必建项目。

还有一个推论：**`computed` 是被读的时候才求值的。** 没有任何模板或代码读过它，getter 一次都不会执行。官方 API 页对它的表述是「返回一个响应式的 ref」，没有把「惰性」单独成句，我不做逐字断言；但结合上面那句缓存语义，「没人读就没必要算」是这套设计的必然结果——**这一点决定了后面「computed 里写副作用」为什么危险**。

## getter 必须是纯函数：不是风格要求，是缓存的前提

官方措辞是直接的禁令（同页 Best Practices）：

> don't mutate other state, make async requests, or mutate the DOM inside a computed getter!

为什么这是机制问题而不是代码品味问题：缓存的正确性依赖「同样的输入给出同样的输出，而且除了产出这个值什么都不做」。一旦 getter 有副作用，你会同时丢掉两道保障——**触发时机由框架决定**（读才跑、依赖变了才跑），以及**执行次数由框架决定**（一次或零次或多次，取决于渲染批次）。你的代码控制不了，于是副作用变成随机的。

三类反例，每类对应一个具体故障：

```js
// 反例一：在 getter 里写别的状态
const visibleTodos = computed(() => {
  const list = todos.value.filter(isVisible)
  count.value = list.length        // 错：这就是「在渲染期间改状态」
  return list
})
// 预期结果是：控制台出现递归更新的警告（Vue 对递归更新的保护），
// 因为 count 被模板读过，写它又会唤醒这条 getter。
// 正解：count 自己做成 computed(() => visibleTodos.value.length)
```

```js
// 反例二：在 getter 里发请求
const user = computed(() => fetch(`/api/users/${id.value}`).then((r) => r.json()))
// 双重错误：返回的是 Promise（界面拿不到数据），
// 而且请求是否发出取决于有没有人读这个 computed。
// 正解：watch(id, ...) 里发请求，把结果写进一个 ref。
```

```js
// 反例三：在 getter 里累加一个「已经上报过」的标记
const fullName = computed(() => {
  hasReported.value = true          // 错：副作用有历史，缓存把它抹平了
  return first.value + ' ' + last.value
})
// 依赖不变时这段代码不跑，标记永远停在 false；
// 依赖变了又可能跑在你完全没预期的时机。
// 正解：埋点放进 watch 或在事件处理函数里显式做。
```

对照结论：**「值」进 `computed`，「动作」进 `watch` 或事件处理函数。** 判断口诀：如果这段代码跑 0 次、1 次、3 次会导致不同结果，它就不属于 `computed`。

## computed 与模板内联表达式的边界

模板里能写表达式（第 3 章已界定），所以「什么时候抽成 computed」是个真实决策。判断依据不是行数，是这三条：**有没有多个依赖交织**、**是否需要复用或单独断言**、**是否需要缓存**。

| 留在模板里 | 抽成 computed |
| --- | --- |
| 单层属性访问、`a ? x : y`、字符串拼接、`items.length` | 过滤 + 排序 + 映射链 |
| 只用一次、依赖一个原始值 | 被两处以上使用（模板、别的 computed、watch） |
| 表达式与「谁在用」绑定（如某列的样式三元） | 需要单测（`expect(computed.value)`） |
| — | 需要给类型命名、需要 `oldValue` |

**别把 computed 当成「抽函数」的替代品。** 一个没有依赖、只在模板里用一次的格式化函数（`formatDate`），抽成 computed 反而更糟：它把纯函数变成了有状态的对象，模板里还得写成 `formattedDate`（自动解包），可读性下降、也拿不到缓存收益——因为它根本不需要缓存。

<Callout type="unverified" title="本章哪些结论是核实过的">

**已核实**（2026-10-17，vuejs.org）：computed 的缓存语义与「方法调用每次重渲染都执行」的对照、getter 必须纯且不得改状态/发请求/操作 DOM 的原文禁令、可写 computed 的 `get`/`set` 签名与「默认 getter-only，赋值会得到运行时警告」、getter 第二个参数取上一轮值（官方标注 3.4+）、computed 返回值是派生快照不应被修改、`watch` 与 `watchEffect` 的依赖追踪差别原文、`deep` 的遍历代价原文与「多个嵌套属性场景 watchEffect 可能比深度侦听更省」的建议、`watch` 源支持 ref / reactive 对象 / getter / 数组、`onCleanup` 是回调第三个参数、`once`（3.4+）、`deep` 可传数字表示最大遍历深度（3.5+）、`flush` 默认 `'pre'`、`watchPostEffect` 与 `watchSyncEffect` 是 `watchEffect` 的别名、`toValue` 标注 3.3+、`onWatcherCleanup`（3.5+）且必须在同步执行期调用。

**未核实/属于我的推断**：computed 的「惰性求值」表述（由缓存语义推出，非逐字原文）；「reactive 对象作为源时隐式深度侦听、新旧值同一引用」这条我未在核实的那一页读到原文，写法以 [侦听器](https://cn.vuejs.org/guide/essentials/watchers.html) 与 [响应式 API：进阶](https://cn.vuejs.org/api/reactivity-advanced.html) 当前版本为准；所有代码片段的运行结果均为**预期结果**，未在本机执行——Vue 组件需要构建工具与浏览器，验证路径见下一段。

</Callout>

**验证路径**（本章所有代码都在此环境判定预期）：`npm create vue@latest`，勾选 TypeScript 与 ESLint；把代码贴进 `src/components/Check.vue`，`npm run dev` 打开浏览器，`console.log` 与 Vue DevTools 的组件面板同时看。想更快就用 `https://play.vuejs.org/`。

## 可写计算属性：get / set 的真实用法

官方签名（[响应式 API：核心](https://cn.vuejs.org/api/reactivity-core.html#computed)）：传一个带 `get` 和 `set` 的对象，返回的是可写的 `Ref<T>`；传函数返回的是只读的。

```js
const firstName = ref('John')
const lastName = ref('Doe')

const fullName = computed({
  get: () => `${firstName.value} ${lastName.value}`,
  set: (value) => {
    const [f = '', l = ''] = String(value).trim().split(/\s+/)
    firstName.value = f
    lastName.value = l
  },
})

fullName.value = 'Ada Lovelace'
// 预期结果是：firstName === 'Ada'，lastName === 'Lovelace'
```

**它存在的唯一理由：把「可编辑的派生视图」接进 `v-model`。** 三个真实场景：

| 场景 | 为什么用可写 computed |
| --- | --- |
| 一个输入框写「姓名」，内部存 first/last 两个字段 | 模板只关心 `fullName`，写入时拆回源状态，两个字段仍是唯一事实来源 |
| 多选框绑定「全选」 | `get` 读 `selected.length === all.length`，`set` 批量写 `selected` |
| 表单里「半径」与「直径」、或 UI 单位与存储单位不同 | 一处换算，读写对称，避免两套状态互相追 |
| 把筛选条件桥接到路由 query | `get` 读 `route.query`，`set` 调 `router.replace`（第 8 章） |

第二条要注意：**`get` 依赖外部系统时，它不是响应式的**。`route.query` 是响应式的（Vue Router 把它做成 reactive 对象），`localStorage.getItem` 不是——后者必须靠 `watch` 或封装成 ref，见「决策清单」。

**不要用 `set` 做副作用。** 两个原因：`set` 只在**有人赋值**时跑，模板读它不会跑，于是副作用触发条件变成「用户有没有碰这个输入框」，不可审计；`set` 里如果又写了 `get` 依赖的状态，`set → 写源 → get 重算 → 有人再写` 就可能成环。要联动别的状态，把联动逻辑放进事件处理函数，或明确用 `watch`。

另外两条硬约束：`computed` 默认只读，对它赋值会得到运行时警告（官方原文：you will receive a runtime warning）；`set` 里不要出现「读自己的 get」之外的隐式假设——它拿到的是**新值**，不是差量。

## 派生状态还是存起来：一张判断表

「该存还是该算」是本章最实用的一张表。判据按顺序问：

| 问题 | 答「是」→ 算（computed） | 答「是」→ 存（ref / store） |
| --- | --- | --- |
| 这个值能否由现有状态**唯一确定**？ | 能，任何时刻重算结果一致 → 算 | 不能，含历史或用户自由输入 → 存 |
| 它是否需要「用户显式改过」这个语义？ | 不需要 → 算 | 需要（草稿、脏标记） → 存 |
| 算它是否需要外部输入（当前时间、随机数、后端返回）？ | 不需要 → 算 | 需要 → 存（外部结果本质是事件） |
| 计算代价是否大到必须做增量？ | 不，一次全算在几毫秒内 → 算 | 是（几十万行、需要分页游标） → 存，配合请求 |
| 是否需要跨页面存活？ | 不需要 → 算（放组件里） | 需要 → 存（放 store，第 9 章） |

**「唯一写入者」原则**：任何一个状态，你应当能指着代码说清它由谁写。派生值的正确写入者是「不写」——它由源和 getter 决定。存了派生值，你就凭空多了第二个写入者，故障三的五个更新点就是这么来的。

反面判据也很有用：**如果你正在写 `watch(a, () => { b.value = 由 a 算出的东西 })`，而 `b` 没有任何别的写入者，那么 `b` 应该是 `computed(() => 由 a 算出的东西)`。** 这是本站见过的最高频误用。

## 返回对象与数组的陷阱：引用每帧都在换

`computed` 返回对象/数组时有两类真实故障，都源于「每次重算是新对象」。

**故障 A：把新引用传给子组件，子组件必然跟着重渲染。**

```js
const cardProps = computed(() => ({ id: item.value.id, title: item.value.title }))
```

只要 `item` 里**任何**被 getter 读到的字段变化，`cardProps` 就产出新对象；子组件的 props 变了就得重渲染——即使 `id` 和 `title` 一模一样。反过来，如果你在 getter 里 `return { ...item.value, extra: 1 }`，那么任何一次 `item` 的深度改动都会传导下来，因为展开读取了全部键。

处理方式，按优先级：

1. **拆细**：不要造聚合对象，把每个字段做成独立 computed，子组件按字段接收。这让依赖边界等于 props 边界。
2. **返回原始值或稳定的浅结构**：能返回 `string`/`number` 就别返回对象。
3. **确实需要稳定引用**：用 `shallowRef` 自己控制替换时机，或对透传层用 `v-memo`／`memo` 做显式比较（见[渲染性能](/vue/rendering-performance)，第 10 章才该动它）。
4. **别在 computed 里原地改返回的对象**——官方定性很清楚：computed 的返回值是派生快照，「mutate a snapshot」没有意义，要改就改源。

**故障 B：`watch` 一个返回新对象的 computed，每次触发。**

```js
const filters = computed(() => ({ tag: tag.value, done: done.value }))
watch(filters, (v) => console.log('变了', v))
// 预期结果是：只要 getter 里任一依赖变化就打一条，这符合预期；
// 但如果你 watch 的是「在 getter 里每次都新建对象的那些没变的字段」，
// 同样会触发，因为你比较的是引用。
```

**这个坑更常见的入口是不写 getter 数组**：`watch([a, b], ...)` 的新旧值是两个新数组，永远不相等——这本身不影响触发（触发看元素），但如果你在回调里 `JSON.stringify(newVal)` 做比较，说明你其实想侦听某个派生的**值**，应该把它做成 computed 再侦听那个 computed。

## watch 与 watchEffect：显式依赖 vs 自动收集

官方对照（[侦听器](https://cn.vuejs.org/guide/essentials/watchers.html)）：

> `watch` only tracks the explicitly watched source. It won't track anything accessed inside the callback. In addition, the callback only triggers when the source has actually changed.

> `watchEffect` ... automatically tracks every reactive property accessed during its synchronous execution. This is more convenient and typically results in terser code, but makes its reactive dependencies less explicit.

**本站推荐默认写 `watch`**，理由是三条工程性的，不是审美：

1. **可审计**：回调会不会跑、因为什么跑，看第一行就知道。`watchEffect` 的依赖藏在函数体里，重构时改一个读取就把依赖换掉了，而且**不报错**。
2. **不误伤**：`watchEffect` 里读了一个 ref（哪怕只是 `console.log`），那个 ref 就成了依赖，回调重跑，副作用重复执行——埋点重复上报、图表重复实例化，都是这条路径。
3. **能拿到旧值**：`watch` 回调有 `(newVal, oldVal, onCleanup)`，`watchEffect` 只有上下文对象里的 `oldValue/newValue`，且只在多依赖场景有意义。

`watchEffect` 值得用的场景很少但真实存在：**依赖多且全部在回调里被使用**，典型是「按一组筛选条件重新拉数据」而且这些条件本来就只服务于这一个请求；以及「不需要旧值、只要一开始就跑一次」的初始化。这两种情况下 `watchEffect` 等价于 `watch(() => [a,b,c], ..., { immediate: true })` 但不用手写数组。

## watch 的四种源码写法

`watch(source, callback, options)` 的 source 官方支持四种（[响应式 API：核心](https://cn.vuejs.org/api/reactivity-core.html#watch)）：返回值的 getter、`ref`、`reactive` 对象、上面几者的数组。

| 源码写法 | 实际追踪 | 回调新旧值 | 必须注意 |
| --- | --- | --- | --- |
| `watch(count, cb)` | `count.value` 的赋值 | 有效 | 深层属性（`obj.value.x`）不会触发，除非 `deep` |
| `watch(() => state.a, cb)` | 表达式返回的值 | 有效 | **`reactive` 对象的属性必须用 getter**；写成 `watch(state.a, cb)` 传进去的是原始值，回调永不执行 |
| `watch(state, cb)` | 整个 reactive 对象 | **newVal 与 oldVal 是同一个引用**，旧值不可用 | 需要知道「具体改了哪个键」时，改用 getter 侦听那个键 |
| `watch([a, () => state.b], cb)` | 任一元素变化 | 两个**数组**，按下标取 | 数组是新构造的，别把数组本身传给别处 |

第四种最常见的错法是「想侦听数组里某一项的变化」：

```js
const list = ref([])
watch(list, (v) => renderChart(v))        // 只在整体替换时触发
watch(() => list.value.length, ...)      // 项数变化触发
watch(() => list.value.map((i) => i.id).join(','), ...)  // 「身份集合」变化触发，便宜
```

第三条那种「在 getter 里算出一个便宜的键」是替代 `deep` 的主力手段，下一节展开。

侦听器返回一个句柄，可以在别处停掉它：

```js
const stop = watch(source, cb)
// 需要时（例如切换成「暂停同步」）：
stop()
```

组件内创建的侦听器会在组件卸载时自动停止；**在组件外**（模块顶层、路由守卫里）创建的不会，必须自己 `stop()`，否则它一直活着并持有组件的引用——这是内存泄漏的常见来源之一。

## immediate、deep、once、flush：各自什么时候加

官方默认值（同页 `WatchOptions`）：`immediate: false`、`deep: false`、`once: false`（3.4+）、`flush: 'pre'`。

| 选项 | 语义 | 什么时候用 | 代价 / 风险 |
| --- | --- | --- | --- |
| `immediate: true` | 创建时立刻同步执行一次，首次 `oldValue` 为 `undefined` | 侦听器的活儿「初始也要做一次」：首次拉数据、初始化图表实例 | 回调可能在 props/状态就绪前跑；写回调时要能处理空值 |
| `deep: true` | 强制深度遍历源，深层改动也触发 | 侦听一个你无法拆小的外部对象（第三方返回的配置） | **对大对象是性能灾难**：每次检查要递归遍历全部嵌套属性 |
| `deep: <number>` | 3.5+ 支持，限制最大遍历深度 | 只关心前两层 | 版本相关，动手前核对当前版本 |
| `once: true` | 只跑一次，之后自动停止（3.4+） | 「首次变化只做一次」的埋点、一次性提示 | 早期版本没有这个选项，得用 `stop()` 手写 |
| `flush: 'pre'`（默认） | 组件更新**前**执行 | 绝大多数情况；改状态后跟着重渲染 | 此时 DOM 还没更新，**读不到新 DOM** |
| `flush: 'post'` | 组件更新**后**执行（DOM 已更新） | 侦听后要读 DOM（尺寸、滚动位置）、把变化推给第三方库 | 同一轮里可能多一次更新批次 |
| `flush: 'sync'` | 依赖一变立即同步执行 | 几乎没有正当场景（极少数需要同步失效的库） | 绕过批处理，大列表上直接卡；不要默认用 |

`deep` 的性能代价要给具体数字感：深度遍历的代价是「对象里的键总数」，一次触发遍历一次。一个 5000 条、每条 12 个字段的列表，加 `deep: true` 后每次任意改动都可能触发几万次属性访问，而这些访问本身又是在响应式代理上做的——比在普通对象上更贵。官方原文（同页 Caveats）：

> Deep watch requires traversing all nested properties in the watched object, and can be expensive when used on large data structures.

**大对象禁用 `deep` 的替代方案，按优先级：**

| 想达成什么 | 替代写法 |
| --- | --- |
| 只关心身份/条数 | `watch(() => list.value.length, cb)`；或 `() => list.value.map(x => x.id).join('\n')` |
| 只关心某几个字段 | 把这几个字段抽成 computed，侦听那个 computed |
| 关心「任意字段变了，但只需要知道变了」 | 用一个版本号：源替换时 `version.value++`，侦听 `version`（配合 `shallowRef` 见第 10 章） |
| 需要在多个嵌套属性上做副作用 | 官方明确建议：这种情况 `watchEffect` 可能比深度侦听更省，因为它只追踪回调里**实际读到**的属性 |
| 数据来自后端且量大 | 不要侦听数据本身，在请求完成的地方直接调那个副作用函数（把「事件」当事件处理） |

<Callout type="warn" title="deep 与不可比较的旧值">

`deep: true` 时你拿到的 `oldValue` 与 `newValue` 很可能是**同一个对象引用**（响应式对象被原地修改，Vue 不给你做深拷贝快照）。想靠「比较新旧」判断改了哪个字段，这条路是错的。要判断，就在回调外自己记下上一次的派生值（`let prev = ...`），或者侦听一个原始值。

</Callout>

## 清理与竞态：前一个请求晚到覆盖了后一个

回到故障一。`watch` 不会取消你上一次发起的事情，它只负责再叫你一次。竞态有两种修法，**都能用，建议同时用**：用 `AbortController` 真的掐断请求，用序号做「迟到结果丢弃」的最后防线（掐断不保证服务端不再处理，也不保证 promise 一定 reject）。

```ts
// 完整可用：SearchBox 的关键词 → 结果
import { ref, watch } from 'vue'

type Item = { id: number; title: string }

const keyword = ref('')
const results = ref<Item[]>([])
const loading = ref(false)

let requestSeq = 0            // 每次发起请求递增，用于识别「最新的那一次」

watch(keyword, async (kw) => {
  if (!kw.trim()) {
    results.value = []
    loading.value = false
    return
  }

  const mine = ++requestSeq
  const controller = new AbortController()
  loading.value = true

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(kw)}`, {
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { items: Item[] }

    if (mine !== requestSeq) return    // 关键：已有更新的请求，丢弃这份结果
    results.value = data.items
  } catch (err) {
    if (mine !== requestSeq) return
    if ((err as Error).name === 'AbortError') return   // 主动取消不算错误
    results.value = []
    console.error('搜索失败', err)
  } finally {
    if (mine === requestSeq) loading.value = false
  }
})
```

预期结果：快速输入 `v`、`vu`、`vue` 时，三条请求里只有最后一条的结果会写进 `results`；`loading` 只在真正最新的那次结束后归 `false`；被取消的请求不产生红色错误。验证路径是 DevTools 的 Network 面板（看 `q=vue` 是最后一条被消费的）+ 勾选 Slow 3G 让它必然竞态。

`finally` 里那句 `if (mine === requestSeq)` 是最容易漏的一行：不判的话，旧请求的 `finally` 会把新请求的 `loading` 提前关掉，界面显示「加载完成但列表是空的」。

第三种写法是让框架替你收尾——`onCleanup`。它是回调的**第三个参数**（`watchEffect` 是第一个参数），官方语义：这段清理会在下一次 effect 重跑**之前**被调用，正是用来清掉过期副作用的。

```js
watch(id, async (newId, oldId, onCleanup) => {
  const controller = new AbortController()
  onCleanup(() => controller.abort())   // 下次 id 变化前，或者组件卸载时执行

  try {
    const res = await fetch(`/api/items/${newId}`, { signal: controller.signal })
    data.value = await res.json()
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err)
  }
})
```

3.5+ 还提供了 `onWatcherCleanup()`，语义同上但不用把它一路当参数传（对 `watchEffect` 尤其顺手）。**注意官方约束：它必须在侦听器的同步执行期调用**——写在 `await` 之后注册不生效。这是本页核实到的明确限制：

> `onWatcherCleanup` must be called during the synchronous execution of the watcher.

所以最常见的错法是：

```js
watch(id, async (newId) => {
  const res = await fetch(...)          // 先 await
  onWatcherCleanup(() => res.body?.cancel())   // 错：注册时机已过
})
```

序号法与 `AbortController` 的组合之所以稳，是因为**它不依赖框架版本**，也不依赖 fetch 真的被中断。竞态的通用形态、微任务与宏任务的时序，回指 [事件循环、Promise 与 async/await](/javascript/asynchronous)；请求本身与跨标签页那部分回指 [fetch、同源策略与浏览器存储](/javascript/network-and-storage)。

## watchPostEffect、watchSyncEffect

官方定义是两行别名（同页 API）：`watchPostEffect(fn)` 等价于 `watchEffect(fn, { flush: 'post' })`，`watchSyncEffect(fn)` 等价于 `{ flush: 'sync' }`。

用途就一个正经场景：**副作用必须在 DOM 更新之后**。典型是「状态变了要重新量一个元素的高度」或「把内容推给一个自己管 DOM 的第三方库」。这时候写：

```js
import { watchPostEffect } from 'vue'

watchPostEffect(() => {
  // 预期结果是：此处 el 的 DOM 已反映本轮所有状态变化
  height.value = el.value?.getBoundingClientRect().height ?? 0
})
```

读到的 `el` 是模板引用，写法与时机见[第 7 章 生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject)。`watchSyncEffect` 我不给用例——它绕开批处理，在响应式写入的那一瞬同步执行，绝大多数需求用 `flush: 'post'` 就够了。

## 什么该用 computed、什么该用 watch：决策清单

**默认答案是 computed。** 只有落到下面这张表里的五类活儿，才用 `watch`——它们的共同点是**「和界言之外的系统同步」或「产生一条不可回放的动作」**。

| 场景 | 用什么 | 为什么 |
| --- | --- | --- |
| 展示文本、格式化、过滤、排序、聚合、校验错误信息 | `computed` | 纯派生，可重算，需要缓存 |
| ① 把内部状态同步进 URL query / hash | `watch` | 写的是外部系统（history），且是一次「动作」 |
| ② 把状态持久化进 `localStorage` / cookie | `watch` | 同上，而且是磁盘 IO；见第 6 章 `useLocalStorage` |
| ③ 埋点、日志上报 | `watch` | 有「已经上报过没有」的历史，绝不能靠渲染时机 |
| ④ 发请求 | `watch` | 有 IO、有取消、有竞态，必须显式管理生命周期 |
| ⑤ 第三方 DOM 库（图表、地图、富文本、虚拟滚动）的实例初始化与 setData | `watch`（配 `onMounted`） | 库实例是有状态对象，只能由你显式更新 |
| 把界面输入推给另一个**可编辑**字段 | 两者都不对，用可写 computed 或事件处理 | 「同步两份可写状态」本身是设计问题 |
| 根据 ID 拉详情并展示 | `watch(id, fetch)` 写进 `detail` ref；展示层再用 computed 加工 | 请求是动作，加工是派生 |

再补一条边界规则：`watch` 回调里**只做两件事之一**——把内部状态推给外部系统，或者把外部结果写回一个 ref。不要在 `watch` 回调里做「界面值怎么显示」的计算，那一定是 computed。

## 常见反模式

**一、在 watch 里改被侦听的东西，形成环。**

```js
const a = ref(1)
const b = ref(2)

watch(a, (v) => { b.value = v * 2 })
watch(b, (v) => { a.value = v / 2 })     // 错：b 变了又写回 a
```

预期结果是：控制台出现递归更新方向的警告（Vue 对「超出最大递归更新次数」有运行时保护，具体文案以你的版本控制台为准），界面可能表现为闪烁或卡住。修法有两种：**只留一个方向**（`b` 做成 `computed(() => a.value * 2)`），或者加幂等守卫（`if (b.value !== v * 2) b.value = v * 2`，且这通常说明你的模型该合并）。

**二、用 watch 替代 computed。** 见「判断表」末尾那条反面判据。它的害处不是「跑得多」，而是**多了一个写入者**，从此两份状态可能不一致。

**三、用 `deep` 侦听巨型对象。** 见上文替代方案表。

**四、把 computed 当 getter 缓存用来「避免重复调用函数」，却在里面读了一个非响应式的外部值。** 例如 `computed(() => JSON.parse(localStorage.getItem('k') ?? 'null'))`——`localStorage` 不是响应式的，依赖追踪不到它，这个 computed 可能永远不重算。这不是「写法丑」，这是**缓存语义被误用**：你以为缓存的是纯函数，其实里面藏着不可追踪的输入。正解是把外部值先做成 ref（第 6 章 `useLocalStorage`）。

**五、`immediate: true` + 回调里立刻访问还没准备好的东西。** 首次执行时 `oldValue` 是 `undefined`，而模板引用（`el.value`）在 `flush: 'pre'` 时还是 `null`。要么把 `flush` 设成 `'post'`，要么在回调里判空。

**六、侦听器写在组件外却从不 `stop()`。** 表现是页面切走后仍在打请求、仍在改已卸载组件的状态。

## 常见错误与排查

1. **现象：`watch` 一个 `reactive` 对象的属性，回调一次都不跑。** 原因：你写成了 `watch(state.count, cb)`，传进去的是**当时的原始值**，不是可追踪的源。怎么确认：在 cb 里打印，第一次改值就不打。怎么修：改成 `watch(() => state.count, cb)`。
2. **现象：列表里改一条数据，深度侦听触发了，但 `oldValue` 和 `newValue` 一模一样。** 原因：响应式对象被原地修改，Vue 不生成深拷贝快照。怎么确认：`console.log(oldValue === newValue)`。怎么修：侦听一个便宜的派生值（条数、id 拼接、版本号），或在回调外自己留一份上次的记录。
3. **现象：改了数据，用 `computed` 算出的东西没变。** 原因：getter 里的依赖丢了——通常是响应式断链（解构了 `reactive`、用了 `JSON.parse(JSON.stringify())`、把 `ref` 当普通对象传），或者你 `if` 短路掉了那次读取。怎么确认：[响应式原理](/vue/reactivity) 里那两问——「手里是不是那个代理」「视图读过这个属性没有」；再用 computed 的 `onTrack`/`onTrigger` 调试选项打印依赖。
4. **现象：一次点击，`console.log` 里 computed 的 getter 跑了两三次，怀疑缓存失效。** 原因：缓存只保证「依赖不变不重算」，**不保证「一轮渲染只算一次」**；依赖真变了就会重算，而且多个 computed 链式依赖各自都会算。怎么确认：在 getter 里打印 `count.value`，看它是不是两个不同值。怎么修：通常不用修；若确实在昂贵计算上重复，检查依赖里是否混进了「每帧新建的对象」。
5. **现象：搜索结果的列表和输入框里的关键词不匹配。** 原因：竞态，旧请求晚到。怎么确认：Network 面板看请求完成顺序，或 `console.log` 里给每条结果带上发起时的关键词。怎么修：上面的序号 + AbortController 模板。
6. **现象：在侦听器里读 DOM，量到的是旧尺寸。** 原因：默认 `flush: 'pre'` 在 DOM 更新前执行。怎么确认：`nextTick` 之后再看一次是否变正常。怎么修：`watch(..., { flush: 'post' })` 或 `watchPostEffect`。
7. **现象：埋点在 DevTools 里重复上报。** 原因：埋点写在 computed 里（时机由渲染决定），或者写在 `watchEffect` 里而回调中读了一个高频变化的 ref，把它当成了依赖。怎么确认：把 `watchEffect` 换成显式 `watch`，看是否不再重复。怎么修：埋点放进事件处理函数，或 `watch(源, ..., { once: true })`。
8. **现象：给 computed 赋值，控制台报只读警告。** 原因：`computed(fn)` 返回只读 ref。怎么修：换成 `computed({ get, set })`。
9. **现象：页面切走后仍在发请求。** 原因：侦听器在组件外创建，或者请求 promise 没人取消。怎么修：保存 `stop()` 句柄在 `onUnmounted` 调用；请求侧用 AbortController。

## 练习

<Exercise title="练习 1 · 预测求值次数" difficulty="基础">

`count` 是一个值为 `1` 的 `ref`，`other` 是另一个值为 `0` 的 `ref`，`ref` / `computed` 都从 `vue` 导入。下面是完整组件：

```vue
<script setup>
const count = ref(1)
const other = ref(0)

let runs = 0
const isEven = computed(() => {
  runs++
  return count.value % 2 === 0
})
const label = computed(() => (isEven.value ? '偶' : '奇'))
</script>

<template>
  <p>{{ isEven }}</p>
  <p>{{ label }}</p>
  <p>{{ other }}</p>
</template>
```

依次回答：① 首屏渲染后 `runs` 是多少？② 执行 `count.value = 3` 后，`runs` 变为多少？③ 执行 `other.value = 9` 后，`runs` 变不变？为什么？

<template #answer>

① **1**。`isEven` 被 `label` 读到一次（模板读 `label` 只触发 `label` 的 getter），`label` 自己也被模板读一次，但那都在同一条依赖链上，`isEven` 只求值一次。

② **2**。`count` 变了，`isEven` 的缓存失效；重渲染时 `label` 重算并读 `isEven`，触发一次求值。

③ **不变。** `other` 不在 `isEven` 的依赖里。这正是「缓存」和「模板里直接调函数」的分水岭：如果写成模板里的 `isEven()` 函数调用，`other` 变化引发的重渲染会让它再跑一次。

注意 ①② 的读数会受你的渲染批次影响，Playground 里以打印顺序为准；不变的是「无关状态变化时 getter 不重跑」这条。

</template>

</Exercise>

<Exercise title="练习 2 · 找出副作用" difficulty="基础">

下面这段有四处问题，请全部指出并改写正确：

```js
const keyword = ref('')
const results = ref([])
const loading = ref(false)

const searched = computed(async () => {
  loading.value = true
  const res = await fetch(`/api/search?q=${keyword.value}`)
  results.value = await res.json()
  return results.value
})
```

<template #answer>

四处：

1. **getter 是 async 函数** → `computed` 返回的是 Promise 对象，模板拿不到结果。computed 不支持异步（官方明确要求异步逻辑放进侦听器）。
2. **`loading.value = true` 是副作用**，写在 getter 里意味着「有人读才置为 true」，时机不可控。
3. **`results.value = ...` 写的是自己返回的那个源状态**：既派生又写入同一份数据，两个写入者。
4. **没有竞态处理**：慢的旧请求会覆盖新的结果。

改写：

```js
const keyword = ref('')
const results = ref([])
const loading = ref(false)
let seq = 0

watch(keyword, async (kw) => {
  const mine = ++seq
  loading.value = true
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(kw)}`)
    const data = await res.json()
    if (mine === seq) results.value = data
  } finally {
    if (mine === seq) loading.value = false
  }
})

// 派生部分才留在 computed：界面关心的是「现在有没有结果」
const isEmpty = computed(() => !loading.value && results.value.length === 0)
```

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造一次递归更新" difficulty="进阶">

写出「在 watch 里改被侦听的状态」的最小复现（本站正文给过 a/b 版本），然后：① 描述控制台与界面的现象；② 把它改成正确的实现，两种修法各写一种；③ 解释为什么 Vue 不能简单地「让它一直跑」——从依赖追踪与调度批次的角度给出你的判断。

<template #answer>

复现：

```js
const a = ref(1)
const b = ref(2)
watch(a, (v) => { b.value = v * 2 })
watch(b, (v) => { a.value = v / 2 })
a.value = 5            // 触发 b → 再触发 a → 循环
```

预期现象：控制台出现「超出最大递归更新次数」方向的警告（措辞随版本变化，以你的控制台为准），界面表现为闪烁或掉帧。

修法一（去掉一个方向）：`const b = computed(() => a.value * 2)`，两个 watch 都删。修法二（幂等守卫，但它说明模型该合并）：`watch(a, (v) => { if (b.value !== v * 2) b.value = v * 2 })`。

框架不能无限跑：一次写入唤醒所有依赖它的 effect，若这些 effect 又写回源头，更新队列永不收敛。Vue 因此设了递归上限并报警——**这个警告是设计缺陷的提示，不是需要压制的噪音**。看到它该问的是：这两份状态是不是本来是同一份？

</template>

</Exercise>

<Exercise title="练习 4 · 把 deep 拆掉" difficulty="进阶">

你写了 `watch(state, onChange, { deep: true })`，`state` 是 `reactive({ list: 五千条对象, page: 1, keyword: '' })`，`onChange` 只做一件事：把当前条数与页码写进 `localStorage`。请给出三种不用 `deep` 的写法，并说明各自会在什么情况下漏触发或多触发。

<template #answer>

写法一：分别侦听便宜的派生值。

```js
watch(
  () => [state.list.length, state.page],
  ([len, page]) => localStorage.setItem('meta', JSON.stringify({ len, page })),
)
```

漏：`list` 长度不变、但内容变了（本题不需要内容）。多：无。这是本题的正解。

写法二：内容指纹。`() => state.list.map((x) => x.id).join(',')`。漏：字段改了但 id 不变（本题无所谓）。多：指纹字符串本身每次新建，但触发比较的是字符串值，不会误触。代价：五千条 map + join，每次写入都要跑，仍比全深度遍历便宜得多。

写法三：版本号。在真正改动 `list` 的地方 `state.version++`，侦听 `() => state.version`。漏：**所有忘记递增的改动点**（又是「多写入者」问题）。多：无。这个方案性能最好，但它把责任从「框架递归」转移到了「你记得加」，只在性能确实成为瓶颈时用它（配合 `shallowRef`，见第 10 章）。

顺带：`localStorage.setItem` 这类「把内部状态推给外部系统」正是 `watch` 的正当场景；如果反过来要从 `localStorage` 读回来驱动界面，就必须先把外部值做成 ref，见[第 6 章 composables](/vue/composables) 的 `useLocalStorage`。

</template>

</Exercise>

<Exercise title="练习 5 · 用可写 computed 桥接路由 query" difficulty="挑战">

列表页要把筛选条件 `status`（`'all' | 'done' | 'todo'`）同步到 URL：刷新页面后筛选不丢，点浏览器后退键能回退筛选状态，同时界面仍然用一个普通 ref 驱动。请用可写 computed 实现（路由对象先按「有一个响应式的 `route.query` 和 `router.replace`」处理，第 8 章会正式讲），并解释为什么这里不该用 `watch` 双向同步。

<template #answer>

```ts
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const localStatus = ref<'all' | 'done' | 'todo'>('all')

const status = computed<'all' | 'done' | 'todo'>({
  get: () => {
    const q = String(route.query.status ?? '')
    return q === 'done' || q === 'todo' ? q : localStatus.value
  },
  set: (value) => {
    localStatus.value = value
    router.replace({ query: { ...route.query, status: value } })
  },
})
```

要点：`get` 的优先级设计——URL 是**事实来源**（后退、分享链接都以它为准），本地 ref 只在 query 缺省时兜底，避免「query 还没就绪时界面空白」。

为什么不用双向 `watch`：`watch(status, 写 query)` 与 `watch(() => route.query.status, 写 status)` 就是练习 3 那个环——写 query 会改 route，改 route 的侦听又写 status，status 的侦听再写 query。加幂等守卫能压住，但你写了两份同步代码。**可写 computed 把「读」和「写」放在同一处，接口只有一个名字，天然无环。**

预期结果的验证路径：`npm create vue@latest`（勾选 Vue Router），把组件放进列表页，操作顺序「点筛选 → 刷新 → 后退」，观察 URL 与界面始终一致。

</template>

</Exercise>

## 官方文档与延伸阅读

- [计算属性（指南，中文）](https://cn.vuejs.org/guide/essentials/computed.html)（[英文版](https://vuejs.org/guide/essentials/computed.html)）—— 用来核实本章第一节的**缓存语义原文**、「方法调用每次重渲染都执行」的对照、getter 必须纯的三条禁令（不改状态 / 不发异步 / 不改 DOM）、可写 computed 与「默认只读、赋值会得到运行时警告」。**第 4 章主参考。**
- [侦听器（指南，中文）](https://cn.vuejs.org/guide/essentials/watchers.html) —— 用来核实 `watch` 与 `watchEffect` 的依赖追踪差别原文、`onCleanup` / `onWatcherCleanup` 的用法与「必须同步调用」的限制、`immediate` / `deep` / `flush` 的语义、`deep` 的遍历代价原文与「多嵌套属性场景 watchEffect 可能更省」的建议。**第 4 章主参考。**
- [响应式 API：核心](https://cn.vuejs.org/api/reactivity-core.html) —— 用来核实 `computed` 的类型签名（只读返回 `Readonly<Ref<Readonly<T>>>`，可写返回 `Ref<T>`）、`watch` 支持的四种源类型、`WatchOptions` 里 `once`（标注 3.4+）、`deep` 可传数字（标注 3.5+）、`flush` 默认 `'pre'`，以及 `watchPostEffect` / `watchSyncEffect` 是别名。**版本号以本页当前内容为准。**
- [响应式 API：进阶](https://cn.vuejs.org/api/reactivity-advanced.html) —— 需要核实 `watchEffect` 的上下文对象（`oldValue` / `newValue`）、`unwatch` 句柄行为、以及第 2 章的 `shallowRef` 相关特性时读这里。
- [事件循环、Promise 与 async/await](/javascript/asynchronous) —— 竞态的通用时序在本站 JavaScript 领域讲，本章只做 Vue 侧的接线。
- [第 2 章 响应式原理](/vue/reactivity) —— 「改了没生效」的排查方法与本章第 3、8 节直接相连。
- [第 6 章 组合式 API 与 composables](/vue/composables) —— 把本章的 `useLocalStorage` / `useAsync` 写成可复用封装。

## 下一章

这一章的判据是「在一个组件内部，值该算还是该存、动作该由谁触发」。下一章把边界推到组件之间：**一个值该由父组件传下来，还是子组件自己拿；子组件的修改该怎么告诉父亲；一段不属于任何元素的界面片段该怎么传进去。** 这就是 [组件基础：props、emit 与插槽](/vue/components)。它同时会回答本章遗留的一个问题——可写计算属性那个「把 props 桥成本地可编辑值」的场景，正是组件上 `v-model` 的机制本身。
