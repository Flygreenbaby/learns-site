# 组合式 API 与 composables：把有生命周期的逻辑抽成一个函数

四个故障，都出自「抽函数」这个看起来毫无风险的动作。

**一**：三个组件各写了一份 `localStorage` 读写。改一个字段名要搜三遍；其中一份忘了给 `JSON.parse` 加 `try`，用户在另一个标签页存进一份坏数据，回来之后整个页面白屏——栈顶是 `SyntaxError: Unexpected token`，看代码完全想不到问题出在浏览器存储里。

**二**：你写了 `useAuth()`，把状态定义在文件最外层：`const state = reactive({ user: null })`，然后 `return state`。本地跑得好好的，直到有两个地方同时用它——**它们共享同一份对象**。A 页面退出登录，B 页面的头像跟着变成未登录。这不是 bug，是单例，只是你没打算要单例。

**三**：`useTodos()` 返回三十个字段。模板里全靠自动补全，没人说得清哪个可写、哪个改了没效果；半年后你想改其中一份状态的名字，得先在四个文件里确认谁在解构它。

**四**：`useChart()` 里直接 `document.getElementById('chart')`，拿到 `null`。因为 `setup` 执行时组件还没挂载，DOM 根本不存在。

这四件事的根源是同一个认识缺口：**composable 不是一个新概念，它就是一个普通函数，唯一的魔力来自「它在组件 `setup` 的同步执行期间被调用」**。响应的追踪、卸载时自动清理、每个实例一份状态——全部来自这个调用时机。把时机搞错（故障四）、把作用域搞错（故障二）、把接口搞乱（故障三）、把边界搞漏（故障一），就得到上面四种现象。

前置：[响应式原理](/vue/reactivity)（`ref` / `reactive` 的追踪点）、[计算属性与侦听器](/vue/computed-and-watch)（`watch` 的清理与竞态，本章 `useAsync` 直接建在上面）、[组件基础](/vue/components)（一个逻辑块该进组件还是进 composable）。

## setup 的执行时机：决定一切的那张表

`setup` 在**组件实例创建时**执行，**每个实例一次**，位置在选项式生命周期的 `beforeCreate` 之后、`created` 之前；`<script setup>` 里的顶层代码会被编译器搬进 `setup` 函数体。所以「这段代码写在哪」直接决定它执行几次、谁共享：

| 代码位置 | 执行次数 | 谁共享 | 典型误用 |
| --- | --- | --- | --- |
| 模块顶层（`<script>` 里 setup 之外、`.ts` 文件顶层） | **整个应用生命周期一次** | 所有导入这个模块的地方 | 把组件状态写在这里 → 故障二 |
| `setup` 顶层 / `<script setup>` 顶层 | 每个实例一次 | 该实例独占 | 需要「每个组件一份」的东西应写在这里 |
| 组件卸载后异步回调里 | 不确定，可能永不 | — | 注册生命周期钩子、调用 `onCleanup` 都晚了 |
| `watch` 回调里 | 依赖变化时 | 取决于它写的哪个状态 | 在里面派生界面值 → 第 4 章反模式二 |

这条表也解释了「为什么 `composable` 里可以调 `onMounted`」：`onMounted` 靠的是**当前正在执行的组件实例**这个隐式上下文，而 `setup` 同步执行期间上下文是存在的。于是 composable 里的 `watch`、`onMounted`、`onUnmounted` 会被自动挂到这个实例上，卸载时框架替你把侦听器停掉——你不需要写清理代码，也不需要传实例。

反过来，**一旦 `setup` 里出现 `await`，函数返回时上下文已经丢了**：

```ts
// 反例：在 setup 里先 await 再注册钩子
const row = await loadRow(id)          // 这里让出了执行权
onMounted(() => console.log('永远不会执行'))   // 预期结果：控制台一条警告（钩子注册失败）
```

官方对 `async setup` 的口径是：它只在配合 `<Suspense>` 的组件里有意义，且**异步边界之后的生命周期钩子注册会失效**（这条我按官方[组合式 API：setup](https://cn.vuejs.org/api/composition-api-setup.html)的说明给出的结论，动手前核对当前版本，本章未逐字核实）。可执行的规则很简单：**composable 必须是同步函数，返回响应式容器；异步的事情放进它内部的 `watch` 或 `onMounted` 里。** 一个 `await` 都不能出现在 composable 的顶层——它返回 `Promise` 而不是 `{ data, loading }`，调用方就没法在 setup 顶层解构它。

顺带回答一个高频疑问：**为什么 composable 不能返回一个 promise 让外面 `await`？** 因为响应式追踪发生在「读」的那一刻，一个还没 resolve 的 Promise 对象没有任何可读的属性，视图无从订阅。

## 组合式的动机：按关注点组织，而不是按选项类别

选项式 API 把代码按**类别**分家：数据进 `data`、派生进 `computed`、动作进 `methods`、副作用进 `watch`。于是一个「关键词搜索」功能被切成四块，分布在文件四个位置：

```js
// 选项式：同一件功能散在四处（示意，不是本站写法）
export default {
  data: () => ({ keyword: '', results: [], loading: false }),
  computed: {
    isEmpty() { return !this.loading && this.results.length === 0 },
  },
  watch: {
    keyword() { this.search() },
  },
  methods: {
    async search() { /* 请求、竞态、错误处理 */ },
  },
}
```

三段搜索相关代码之间插着二十行分页逻辑，你要在四段之间来回跳才能读完「关键词变了会发生什么」。**组合式把它收成一处**：状态、派生、副作用、动作写在同一个函数里，调用它只需要一行。

上一代 Vue 2 的复用手段是 mixins，它有三个说不清的毛病：**来源不明**（模板里一个 `this.someValue` 来自哪个 mixin？）、**命名冲突**（两个 mixin 都有 `loading`，后者静默覆盖）、**隐式耦合**（mixin 依赖宿主组件的某个字段，注释没写就炸）。composable 是显式函数调用：参数在签名里、返回值有名字、类型完整、可以单独 import 单测。**「显式」这两个字是组合式 API 全部收益的来源。**

代价也要说清楚：组合式把结构控制权交给你，于是**同一个项目里可以出现十种组织方式**。这就是本章后半部分（命名、返回值、参数约定）必须存在的理由——不是审美统一，是让第四个接手的人不用重新学习你的习惯。

## 什么该抽成 composable：三条判据

同时满足三条才抽。缺一条，就留在组件里。

| 条件 | 不满足时的正确做法 |
| --- | --- |
| **有状态**（它持有 `ref` / `reactive`，不是纯算一个值） | 写成普通函数导出。`formatDate`、`toYuan` 这类**不需要 `use` 前缀** |
| **有生命周期或副作用**（要注册 `watch` / `onMounted` / 事件监听 / 定时器 / 存储 IO） | 用 `computed` 就够了；派生值不该有「清理」概念 |
| **会被两处以上使用**（或单处但组件已经大到需要呼吸） | 留在组件里，别为「将来可能复用」预先抽（这条预测的准确率非常低） |

三条都不满足却被抽出来的产物，就是第 2 章末尾那个「三面都空的组件」的函数版：一层间接、没有信息、每次调试都要跳进去看一次。

**三条全满足但值得犹豫**的一类：它只服务于一个组件，且状态与该组件的渲染强绑定（例如「这个输入框的 IME 组合状态」）。这时更合适的写法是留在 `<script setup>` 里，只用注释把它标成一个功能块——组合式的好处本来就是「一个文件里按关注点分区」，不必每个区都成为一个文件。

## 命名与位置约定

| 约定 | 写法 | 理由 |
| --- | --- | --- |
| 前缀 `use` | `useLocalStorage`、`useAsyncState` | 一眼看出「这不是普通函数，它在 setup 里跑、可能注册钩子、有自己的状态」；社区共识，`vueuse` 全站如此 |
| 文件名 = 导出名 | `useLocalStorage.ts` 导出 `useLocalStorage` | 搜索可达；一个文件一个 composable |
| 目录 | `src/composables/`（或 `src/components/../composables`，与业务组件同层） | 与 `components/` 并列，表示「无界面的逻辑」 |
| 解构后的名字 | `const { data: settings } = useLocalStorage(...)` | 消费处不再带 `use`，读起来是「值」不是「工厂」 |
| 不要 | `useTodosStore`、`useEverything`、`useUtils` | 名字里出现 Store 说明它该是 Pinia（第 9 章）；出现 Everything/Utils 说明它没有边界 |

## 返回值约定：三种选择与它们的后果

这是 composable 设计里唯一真正需要争论的决定。三种可选形态：

**一、全部返回 ref（最宽松）**

```ts
function useCounter(step = 1) {
  const count = ref(0)
  const double = computed(() => count.value * 2)
  const reset = () => { count.value = 0 }
  return { count, double, reset }
}
```

后果：调用方能写 `count.value = 99`，也能写 `double.value = 5`（后者在运行时是只读的，静默失败或给警告）。**内部状态与派生值对外呈现为同一种东西，读代码的人分不清谁可写。** 适合内部工具、原型、只有一个调用方的场景。

**二、状态只读 + 动作可调用（本站推荐）**

```ts
import { readonly, type DeepReadonly } from 'vue'

function useCounter(step = 1) {
  const count = ref(0)
  const double = computed(() => count.value * 2)
  const increment = () => { count.value += step }
  const reset = () => { count.value = 0 }

  return {
    count: readonly(count) as DeepReadonly<Ref<number>>,
    double,                       // computed 本身返回只读 ref
    increment,
    reset,
  }
}
```

后果：外部只能通过动作改状态，`useCounter` 内部保有**唯一写入者**（第 4 章那条原则的函数版）。可测试性最好——测断言「调 `increment` 后 `count` 是 2」，而不是「往 `count` 里塞了个值之后界面怎样」。

一条必须知道的限制：**`readonly` 是浅的**，`readonly({ a: { b: 1 } })` 里 `a.b` 仍可写（官方对 `readonly` 的说明里，深层是惰性转换的，但把返回值当类型约束时不要指望它拦住三层赋值）。要严格就用 `toReadonly`（深只读转换）或干脆只暴露原始值与动作。

**三、返回普通对象（禁止）**

```ts
function useCounter() {
  const count = ref(0)
  return { count: count.value }    // 错：交出的是那一刻的数字
}
```

这是[响应式原理](/vue/reactivity)里断链的标准形状：交出的是原始值，没有 `.value` 可拦截，视图从此不再更新，而且**不报错**。同理，`return { ...state }`（展开一个 reactive）也是断链。

**选择规则**（按调用方数量决定，别一刀切）：只有一个私有调用方 → 形态一；被两处以上用 → 形态二；纯输入、无内部写入 → 只返回 computed（不给 setter，也不返回源 ref）。

最后一项：**不要返回一百个字段。** 判据很实用——如果调用方每次解构都只拿其中三五个，说明这个 composable 是两个功能黏在一起，拆它。返回集合应当是**一个功能**的完整表面，通常 3–7 个键；超过 10 个先怀疑职责。

## 参数约定：传 Ref、传 getter、传普通值

同一份需求（composable 需要「跟随外部一个值变化」），三种参数写法，语义完全不同：

```ts
// ① 传 Ref：调用方必须交出 ref 本身
function useTitleA(title: Ref<string>) {
  watchEffect(() => { document.title = title.value })
}
useTitleA(pageTitle)               // 调用方一定要有一个 ref，不能传字符串

// ② 传 getter：最灵活，值从哪来都行
function useTitleB(getTitle: () => string) {
  watchEffect(() => { document.title = getTitle() })
}
useTitleB(() => store.user.name)   // 甚至可以从 reactive、computed、函数里来

// ③ 传普通值：一次性快照，之后不再跟随
function useTitleC(title: string) {
  document.title = title           // 只在调用那一刻生效
}
useTitleC('首页')                   // 之后外部改了，标题不动
```

**③ 是最高频的错误**：调用方以为自己在传「一个会变的值」，实际传出去的是「当时的值」。它不报错，只是不再响应，看起来像 bug 但更像「框架不可靠」。

现代写法是用官方提供的归一化工具，一个签名同时接受三者：

```ts
import { toValue, watch, type MaybeRefOrGetter } from 'vue'

function useDebouncedValue<T>(source: MaybeRefOrGetter<T>, delay = 300) {
  const debounced = ref<T>()
  watch(
    () => toValue(source),        // toValue：把 ref / getter / 普通值统一取值
    (v) => { /* ... */ },
    { immediate: true },
  )
  return readonly(debounced)
}

useDebouncedValue(keyword)                // ref 直接传
useDebouncedValue(() => filters.tag)      // reactive 属性用 getter
useDebouncedValue('固定值')                 // 普通值，永不变化
```

<Callout type="unverified" title="版本口径：这两个工具能不能用">

**已核实**（2026-10-17，[响应式 API：工具函数](https://vuejs.org/api/reactivity-utilities.html)）：`toValue()` 官方标注 **「Only supported in 3.3+」**，描述为「Normalizes values / refs / getters to values」。

**未核实**：`MaybeRefOrGetter` 这个类型名在我核实到的那一页没有独立条目（它作为示例代码里的 import 出现），所以本章**不给它的最小可用版本号**。动手前请在你的 `node_modules/vue/dist/*.d.ts` 里搜一遍这两个名字，或在 [Vue SFC Playground](https://play.vuejs.org/)（它跟随 Vue 当前主版本）里试编译。低于 3.3 的项目里，手写归一化：`const v = isRef(x) ? x.value : (typeof x === 'function' ? x() : x)`。

</Callout>

三种参数写法的取舍：

| 写法 | 优点 | 缺点 | 用在 |
| --- | --- | --- | --- |
| `Ref<T>` | 类型直白，双向可写（调用方能改） | 强制调用方持有 ref；传 reactive 属性会报错 | 需要「双向」的字段（如 `useAsync` 的 params） |
| `() => T` / getter | 只读、来源自由、不与调用方的状态形态耦合 | 写法啰嗦；`toValue` 之外的 getter 每次比较都可能给新对象 | 只需读、需要稳定接口 |
| `T`（普通值） | 最简单 | **不跟随变化**，容易被误用 | 配置项：确定整个生命周期不变的（key、delay、初始值） |

**一条实践纪律**：把「一次性配置」和「持续跟随的响应」在签名里分开——`{ key: string, delay: number }` 是配置，`source: MaybeRefOrGetter<T>` 是响应式输入。混在一个对象里、全部标成普通类型，是故障「它明明变了为什么没反应」的温床。

## 完整实现一：useLocalStorage

覆盖四个真实问题：读不到（键不存在）、读坏了（`JSON.parse` 抛错）、写不进（配额满、隐私模式）、别的标签页改了（跨标签页同步）。

```ts
// src/composables/useLocalStorage.ts
import { ref, watch, onScopeDispose, type Ref } from 'vue'

interface UseLocalStorageReturn<T> {
  data: Ref<T>
  error: Ref<string | null>
  write: (next: T) => void
  clear: () => void
}

function readRaw<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback        // SSR / 构建期没有 window
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch (err) {
    console.warn(`useLocalStorage: "${key}" 里的内容不是合法 JSON，已回退到初始值`, err)
    window.localStorage.removeItem(key)                       // 坏数据留在里面只会反复炸
    return fallback
  }
}

export function useLocalStorage<T>(key: string, initial: T): UseLocalStorageReturn<T> {
  const data = ref(readRaw(key, initial)) as Ref<T>
  const error = ref<string | null>(null)

  // 来自 storage 事件的写入不再回写，避免两个标签页互相回声
  let applyingRemote = false

  watch(
    data,
    (value) => {
      if (applyingRemote || typeof window === 'undefined') return
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
        error.value = null
      } catch (err) {
        // 配额超限 / 隐私模式 / 循环引用都走这里
        error.value = err instanceof Error ? err.message : String(err)
      }
    },
    { deep: true },     // T 是对象时必须 deep；T 是原始类型时这行可去掉，白省一次遍历
  )

  const write = (next: T) => { data.value = next }
  const clear = () => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key)
    data.value = initial
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== key) return
    applyingRemote = true
    data.value = event.newValue === null ? initial : (safeParse(event.newValue, initial) as T)
    // 本轮 watch 回调结束后解除抑制
    setTimeout(() => { applyingRemote = false }, 0)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
    onScopeDispose(() => window.removeEventListener('storage', onStorage))
  }

  return { data, error, write, clear }
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
```

预期结果，逐条对应：首次调用（键不存在）→ `data` 是 `initial`，`localStorage` 里还没有这个键（**写入只发生在变化时**，想要落地就显式 `write(initial)`）；手动塞坏 JSON 再进页面 → 控制台一条 warn、键被清掉、界面用初始值不白屏；另一个标签页改同一个键 → 本标签页 `data` 更新且**不会**把值再写回去（`storage` 事件只在**其他**标签页触发，这是浏览器行为）；写一个巨型对象超配额 → `error.value` 有内容、界面不炸。

三个设计决定值得说清：**① `onScopeDispose` 而不是 `onUnmounted`**——前者在任意 effect scope 里都能用（包括不在组件里调用的场景），组件卸载时它同样会被触发；**② `error` 返回出去而不是 `throw`**——一个在 setup 顶层跑的函数抛错会让整个组件挂载失败；**③ 这个 composable 的状态是**每调用一次一份**，两个组件各调 `useLocalStorage('theme', 'dark')` 不会自动同步（它们读同一份磁盘数据，但内存里是两个 ref）。跨组件共享状态不是它的职责——那是 store（第 9 章）。

## 完整实现二：useAsync

把第 4 章那套竞态处理封成可复用的东西：`loading` / `error` / `data`、显式 `execute`、自动跟随依赖、卸载即取消。

```ts
// src/composables/useAsync.ts
import { ref, shallowRef, watch, onScopeDispose, type Ref, type WatchSource } from 'vue'

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error'

export function useAsync<T>(
  fetcher: (signal: AbortSignal, ...args: unknown[]) => Promise<T>,
  deps: WatchSource[] = [],
  options: { immediate?: boolean } = {},
) {
  const { immediate = true } = options

  const data = shallowRef<T | undefined>(undefined)   // 大对象不需要深层代理，见第 10 章
  const error = ref<string | null>(null)
  const status = ref<AsyncStatus>('idle')
  const loading = computed(() => status.value === 'loading')

  let seq = 0
  let controller: AbortController | null = null

  const run = async (...args: unknown[]) => {
    controller?.abort()                 // 取消上一个还没完成的
    const mine = ++seq
    const local = new AbortController()
    controller = local

    status.value = 'loading'
    error.value = null
    try {
      const result = await fetcher(local.signal, ...args)
      if (mine !== seq) return          // 迟到的结果丢弃
      data.value = result
      status.value = 'success'
    } catch (err) {
      if (mine !== seq) return
      if ((err as Error)?.name === 'AbortError') return
      error.value = err instanceof Error ? err.message : String(err)
      status.value = 'error'
    }
  }

  const stop = deps.length
    ? watch(deps, () => { void run(...deps.map((d) => (typeof d === 'function' ? d() : d))) }, {
        immediate,
      })
    : null

  onScopeDispose(() => {
    seq++                // 让所有在途结果失效
    controller?.abort()
    if (typeof stop === 'function') stop()
  })

  return { data, error, status, loading, execute: run, cancel: () => { seq++; controller?.abort() } }
}
```

用法（列表页按筛选条件拉数据）：

```ts
const { data: rows, error, status, execute } = useAsync<Item[]>(
  (signal) => fetch(`/api/items?${query.value}`, { signal }).then((r) => r.json()),
  [() => query.value, () => page.value],
)
```

界面侧的分支写法（这才是它存在的意义）：`status === 'idle'` 不渲染、`loading` 显示骨架、`error` 显示重试按钮并调 `execute()`、`success` 渲染 `rows`。**四种状态缺一个就是缺陷**——最常见的漏法是只写了 `v-if="data"`，于是「加载中」和「结果为空」共用同一张空白屏。

一个必须知道的限制：`deps` 为空时 `execute` 是唯一入口，`immediate` 也无从生效（没有 `watch` 可给它）。而 `deps` 非空时，**每次依赖变化都会 abort 上一个**——这正是你要的语义，但如果有「不能取消」的请求（提交表单），别用这个 composable 自动跟随，改成显式 `execute()`。

## 完整实现三：useForm 的最小校验

范围控制到最小可用：值、规则、 touched、错误、`canSubmit`、提交状态机。**不含**异步校验、字段级 schema、动态数组字段——那三类是「够用了再扩」的方向，不是起点。

```ts
// src/composables/useForm.ts
import { computed, reactive, ref, readonly } from 'vue'

type Rule<V> = (value: V, values: Record<string, unknown>) => string | null

export function useForm<V extends Record<string, unknown>>(
  initial: V,
  rules: Partial<Record<keyof V, Rule<unknown>>> = {},
) {
  const values = reactive({ ...initial }) as V
  const touched = reactive<Record<string, boolean>>({})
  const submitted = ref(false)
  const submitting = ref(false)

  // 每个字段的当前错误：纯派生，全部 computed，不存在 errors 的写入者
  const fieldErrors = computed<Partial<Record<keyof V, string>>>(() => {
    const out: Partial<Record<keyof V, string>> = {}
    for (const key of Object.keys(rules) as (keyof V)[]) {
      const message = rules[key]?.(values[key], values)
      if (message) out[key] = message
    }
    return out
  })

  // 界面上该不该显示：用户碰过这个字段，或者整个表单提交过一次
  const visibleErrors = computed(() => {
    const out: Partial<Record<keyof V, string>> = {}
    for (const [key, message] of Object.entries(fieldErrors.value)) {
      if (touched[key] || submitted.value) out[key as keyof V] = message as string
    }
    return out
  })

  const isValid = computed(() => Object.keys(fieldErrors.value).length === 0)
  const isDirty = computed(() => Object.keys(values).some((k) => values[k] !== initial[k]))

  const set = (key: keyof V, value: unknown) => {
    values[key] = value
    touched[key as string] = true
  }
  const blur = (key: keyof V) => { touched[key as string] = true }
  const reset = () => {
    Object.assign(values, initial)
    for (const k of Object.keys(touched)) delete touched[k]
    submitted.value = false
  }

  const onSubmit = async (action: (values: V) => Promise<void>) => {
    submitted.value = true
    if (!isValid.value || submitting.value) return
    submitting.value = true
    try {
      await action({ ...values })
    } finally {
      submitting.value = false
    }
  }

  return {
    values: readonly(values),
    touched,
    visibleErrors,
    isValid,
    isDirty,
    submitting,
    set,
    blur,
    reset,
    onSubmit,
  }
}
```

```vue
<!-- 调用方（TypeScript + 模板） -->
<script setup lang="ts">
import { useForm } from '@/composables/useForm'

const { values, visibleErrors, isValid, submitting, set, blur, onSubmit } = useForm(
  { title: '', email: '' },
  {
    title: (v) => (String(v ?? '').trim().length < 2 ? '标题至少两个字符' : null),
    email: (v) => (/^[^@\s]+@[^@\s]+$/.test(String(v ?? '')) ? null : '邮箱格式不对'),
  },
)

const save = () => onSubmit(async (data) => { /* 提交 data */ })
</script>

<template>
  <form @submit.prevent="save">
    <input
      :value="values.title"
      :aria-invalid="Boolean(visibleErrors.title)"
      @input="set('title', $event.target.value)"
      @blur="blur('title')"
    />
    <p v-if="visibleErrors.title" class="error">{{ visibleErrors.title }}</p>

    <button type="submit" :disabled="submitting">保存</button>
  </form>
</template>
```

这份实现里最该抄走的三个判断：**① 错误信息是 `computed`，没有 `errors` 这个写入者**（第 4 章判断表的直接应用——它 100% 由 `values` 决定）；**② 「什么时候显示错误」是独立一层**（`visibleErrors`），把「校验规则」与「交互时机」分开，否则用户每打一个字都被红字打断；**③ `submitting` 做重入保护**（`if (submitting.value) return`），慢网络下双击提交是最常见的重复写入来源。

## 常见反模式

**一、模块级单例状态，多实例串数据。** 故障二的完整复现：

```ts
// 错：状态在函数外面
import { reactive } from 'vue'
const state = reactive({ items: [], loading: false })     // 模块顶层 = 全应用一份
export function useTodos() {
  return { ...state, add: (t: string) => state.items.push(t) }
}
```

复现路径：两个组件各调 `useTodos()`，在 A 里 `add('x')`，B 里的 `items` 同时多一条；B 卸载后 A 里还留着它的痕迹。

修法就是把状态搬进函数：

```ts
export function useTodos() {
  const items = ref<Todo[]>([])        // 每次调用各得一份
  const loading = ref(false)
  const add = (t: string) => items.value.push({ id: crypto.randomUUID(), title: t })
  return { items: readonly(items), loading: readonly(loading), add }
}
```

**什么时候确实要单例？** 要的就是「全局一份」时——比如一个应用级 toast 队列。但那种东西的正确名字不是 composable，是 **store**：用 Pinia 写（[第 9 章 Pinia 状态管理](/vue/pinia)），它有 devtools 支持、SSR 安全的实例隔离、以及明确的生命周期语义。手写模块级单例做全局状态，你会在 SSR 场景拿到「两个请求共享同一份用户数据」这种安全事故。

**二、参数超过三个。** `useTable(rows, columns, page, size, sort, filters, onSelect)` —— 调用顺序谁记得住。改成 `useTable(rows, options)`，`options` 里区分响应式输入与普通配置。**顺带处理可选性**：三个以上参数意味着至少两个应该有默认值，而默认值在位置参数上只能靠传 `undefined` 表达。

**三、返回一百个字段。** 见「返回值约定」末尾那条判据。补一个客观信号：如果调用方出现了 `const { a, b, c, d, e, f } = useX()` 而 `useX` 里有 20 个键，剩下 14 个是死代码或别的功能。

**四、在 composable 里直接操作 DOM。** `document.querySelector`、给元素加监听、读 `getBoundingClientRect`——`setup` 时 DOM 不存在，而且**模板重渲染后你拿到的元素可能是新的**。正确姿势两条：模板引用（第 7 章）+ `onMounted` 里初始化，或者 `watch(..., { flush: 'post' })` / `watchPostEffect` 里读（第 4 章）。第三方 DOM 库（图表、富文本）的实例生命周期属于「有状态的外部对象」，`create` 放 `onMounted`、`dispose` 放 `onBeforeUnmount`/`onScopeDispose`、数据更新放 `watch` + `flush: 'post'`。

**五、把 composable 当 store 用。** 判据一句话：**这个状态需要在两个互不知晓的组件之间共享，或者需要跨路由存活吗？** 是 → store；只在一条父子链上 → props/emit；跨多层但不共享逻辑 → `provide` / `inject`（第 7 章）。用 composable 做全局状态的典型症状是：为了让两个组件共享，你把它偷偷改成了模块级单例（反模式一），然后开始遇到 SSR 与测试污染。

**六、composable 里发请求但不取消。** 没有 `AbortController`、没有 `onScopeDispose`，页面切走后 promise 仍往已卸载组件的 ref 上写值。`useAsync` 那份实现把这件事收了口，别绕开它写第三个版本。

**七、`useX` 返回一个函数而不是状态。** `const search = useSearch()` 然后 `search('kw')` —— 那它是函数，去掉 `use` 前缀。`use` 前缀的含义是「这里有一份需要你（框架）管理的状态或副作用」。命名约定失效的那一刻，读代码的人就失去了判断依据。

## vueuse 这类库：定位与引入成本

[`@vueuse/core`](https://vueuse.org/) 是一批社区维护的 composable：`useLocalStorage`、`useDebounceFn`、`useIntersectionObserver`、`useFetch`、`onClickOutside`、`useTemplateRef` 相关工具，覆盖面很广。**定位是「别人写好的 composable」，不是运行时框架**——它不改你的架构，只替换你自己写的那部分。

引入成本，四条真实的：

| 顾虑 | 说明 | 判断 |
| --- | --- | --- |
| 包体积 | 库本身是 ESM 且支持 tree-shaking，代价主要是**间接依赖**带来的体积 | 引入前后各跑一次 `npm run build` 对比产物大小，别看官网标称 |
| SSR | 部分函数依赖 `window` / `document`，需要确认它在服务端返回什么 | 逐条查它自己的文档，别默认「和 Vue 一起 SSR 就安全」 |
| 版本耦合 | 它跟随 Vue 主版本发布；Vue 升级时它是需要同步检查的依赖之一 | 与本站第 11 章构建链一起看 |
| 调试与可读性 | 栈里多一层库内部实现；团队里有人熟有人不熟时，同一件事会出现两种写法 | **团队约定优先**：要么规定「存储、媒体查询、剪贴板一律用它」，要么规定「只用自写」 |

本站的实用建议：**浏览器能力类（IntersectionObserver、媒体查询、剪贴板、全屏）用现成的；业务语义类（表单校验规则、权限判断、和自家 API 打交道的请求封装）自己写。** 后者的规则会变，你要的是能改它，而不是给它写 patch。本章那三个实现就是「自己写」的样板——它们都在教一件事：**边界处理比主流程长**。库的版本特性、函数清单与 SSR 支持度请以 `https://vueuse.org/` 当前文档为准（本章未逐条核实它的任何函数行为）。

## 与 React 自定义 Hook 的一句对照

两者解决的是同一个问题（把有状态的逻辑抽成函数、按关注点组织），但**Vue 的 composable 只执行一次（在 setup 里），之后靠依赖追踪自动更新；React 的自定义 Hook 在每次渲染时都会重新执行**，所以它要求你把依赖数组写全、用 `useMemo` / `useCallback` 手动维持稳定引用。这个差别是理解两种框架性能心智的分水岭，详见[两套渲染模型](/react/two-rendering-models)。

## 单元测试思路

composable 的价值有一半在这里：它是纯函数 + 响应式容器，**不需要挂载组件就能测**。

```ts
import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue', () => {
  it('依赖变化后延迟输出最新值', async () => {
    vi.useFakeTimers()
    const source = ref('a')
    const debounced = useDebouncedValue(source, 300)

    source.value = 'ab'
    await nextTick()                 // watch 的 pre flush 在下一个微任务
    vi.advanceTimersByTime(300)
    expect(debounced.value).toBe('ab')
    vi.useRealTimers()
  })
})
```

三个要点：**① `await nextTick()`**——侦听器默认 `flush: 'pre'`，同步断言看不到更新；**② 测的是「状态转换」**（给它什么输入、推进时间/等待 promise、断言输出），不是测渲染；**③ 需要组件上下文的 composable**（用了 `onMounted` / `inject` / 模板引用）才用 `@vue/test-utils` 挂一个测试壳。完整分层（单测 / 组件测试 / 端到端）与命令在[测试体系](/frontend-engineering/testing)。

## 常见错误与排查

1. **现象：两个组件同时用一个 composable，状态互相串。** 原因：状态定义在模块顶层。怎么确认：在函数第一行打印 `Math.random()` 生成的 id，两个组件里的 id 相同 → 共享的（其实该看的是「状态在不在函数里」）。怎么修：状态移进函数；确实要全局共享就换 store。
2. **现象：调用 composable 后界面完全不更新，也不报错。** 原因：返回了普通对象或 `.value`，响应式断链；或参数用了普通值类型，调用方传进来的变化跟不进来。怎么确认：`console.log(isRef(x))`；或在 setup 里直接 `watch` 那个返回值看回调跑不跑。怎么修：返回 `ref` / `computed`；参数改成 `Ref` 或 getter。
3. **现象：composable 里的 `onMounted` 没生效。** 原因：它在 `await` 之后被调用，组件实例上下文已经丢了；或者它是在 `setTimeout` / promise 回调里调用的。怎么确认：把 `onMounted` 移到 composable 第一行试试。怎么修：composable 保持同步；异步动作放进它内部的 `watch` 或 `onMounted` 回调里。
4. **现象：`useLocalStorage` 报 `JSON.parse` 错误或页面白屏。** 原因：存储里是坏数据（版本变更后字段结构不同、手动改过、别的标签页写了不兼容格式）。怎么确认：Application → Local Storage 直接看那条值。怎么修：`readRaw` 里 `try/catch` + 回退 + 清键，别把解析异常抛到 setup 之外。
5. **现象：切换页面后控制台报「往已卸载组件写值」或出现幽灵请求。** 原因：请求没取消、`watch` 建在组件外。怎么确认：Network 面板看请求是否在离开页面后完成；`onScopeDispose` 里加一条日志确认它跑了。怎么修：AbortController + 在途序号（`useAsync` 那两条），组件外的侦听器保存 `stop()`。
6. **现象：`readonly` 返回的状态仍被调用方改掉了。** 原因：`readonly` 只挡第一层。怎么确认：三层嵌套属性试着赋值，不报错。怎么修：只返回原始值或 computed；需要深只读用 `toReadonly`；根本上是**把写入收敛成动作函数**，而不是靠只读代理拦。
7. **现象：`data.value` 类型是 `undefined`，但接口明明返回了数组。** 原因：`useAsync` 用了 `shallowRef`，深层不可观察——这不是错，但你若指望改 `data.value[0].done` 触发更新就不会生效。怎么修：整体替换（`data.value = newArray`），或改回 `ref`（代价是大对象全量代理，见第 10 章）。
8. **现象：`watch(deps, ...)` 在 `useAsync` 里从不触发。** 原因：`deps` 里传的是 `reactive` 对象的属性值（原始值快照）。怎么确认：`typeof deps[0] === 'function'` 应为 true。怎么修：写成 getter 数组 `[() => filters.tag]`。
9. **现象：`immediate: true` 时首帧报错（`Cannot read properties of null`）。** 原因：立即执行的回调里读了还没准备好的东西（模板引用、路由参数）。怎么修：回调里判空，或把 `immediate` 交给 `onMounted` 里第一次 `execute()`。

## 练习

<Exercise title="练习 1 · 判断该不该抽" difficulty="基础">

以下五段逻辑，逐项判定「抽 composable / 留在组件里 / 写成普通函数」，并说出你用的判据：

1. 把 `Date` 格式化成 `YYYY-MM-DD`，四个组件里各用一次。
2. 一个「按 300ms 合并关键词输入再发请求」的逻辑，只在搜索页用，含 `watch` 和定时器。
3. 判断当前用户是否有 `admin` 角色，从已加载的用户对象里读一个数组。
4. 一个图表实例的创建、更新与销毁，两个页面用。
5. 把表单初始值存成 `ref` 并写一个 `reset()`，只在这一个组件用。

<template #answer>

| 项 | 结论 | 判据 |
| --- | --- | --- |
| 1 | **普通函数**（`formatDate`） | 无状态、无生命周期。三条判据一条都不满足 |
| 2 | **留在组件里，作为 setup 中一个带注释的功能块** | 有状态有副作用，但**只有一处使用**。抽出去是「预测复用」，收益为零、间接层 +1。若第三个页面出现再抽 |
| 3 | **普通函数**，或 store 的 getter | 无状态、无副作用（只读已加载数据）。它不该叫 `usePermission` |
| 4 | **抽 composable**（`useChart`） | 三条全中：有实例状态、有创建/销毁生命周期、两处使用 |
| 5 | **留在组件里** | 有状态但无副作用、无复用。`useForm` 这种通用规则才值得抽；单纯初始值 + reset 不值得 |

第 2 项是最值得争论的：我给的判据是「两处以上」，你可以主张「竞态逻辑该复用」——那也成立，但请把抽象后的接口写出来再决定（如果它需要六个参数才能通用，说明它在说谎）。

</template>

</Exercise>

<Exercise title="练习 2 · 找出共享状态的复现代码" difficulty="基础">

下面这段代码在两个页面各调用一次。① 写出你在浏览器里看到的现象；② 修它，保持「每页面一份草稿」；③ 如果你改成模块级单例，会多出什么新问题？

```ts
import { ref } from 'vue'
const draft = ref('')
export function useDraft(key: string) {
  const save = () => localStorage.setItem(key, draft.value)
  return { draft, save }
}
```

<template #answer>

① 预期现象：A 页面输入一半，切到 B 页面，B 的草稿框里是 A 的内容；A 点保存会把 B 正在写的文本存到 A 的键下。原因：`draft` 在模块顶层，全站一份。

② 修法（每调用一次一份，并按 key 恢复初值）：

```ts
export function useDraft(key: string) {
  const read = () => {
    try { return localStorage.getItem(key) ?? '' } catch { return '' }
  }
  const draft = ref(read())
  const save = () => { try { localStorage.setItem(key, draft.value) } catch (e) { console.warn(e) } }
  const load = () => { draft.value = read() }
  return { draft, save, load }
}
```

关键：`draft` 在函数体内创建；键由参数决定，读写各自独立。

③ 改成单例（如果目的确实是全站一份）会带来的新问题：**SSR 下两个请求共享同一份用户数据**；测试之间互相污染（上一个用例的 `draft` 残留在下一个用例里，除非你在 `beforeEach` 手动清）；页面卸载后草稿仍在，用户重新进入看到「上次的东西」，这往往不是想要的语义。这三条正是「全局状态该进 store」的理由。

</template>

</Exercise>

<Exercise title="练习 3 · 给 useAsync 加一次故意制造的错误" difficulty="进阶">

把正文的 `useAsync` 复制进你的项目，然后做三件事：① 删掉 `if (mine !== seq) return` 这一行，构造一个能稳定复现的验证方法（提示：`setTimeout` 让第二次请求先返回）；② 说明你会怎么测这条「竞态守卫」；③ 若把 `watch` 的 `flush` 改成 `'sync'`，行为有什么变化，为什么不该这么做。

<template #answer>

① 复现方法：把 `fetcher` 换成一个可控延迟的假实现，第一次延迟 800ms、第二次延迟 100ms，然后在 200ms 内把依赖改一次。预期结果：**删掉守卫后** `data` 最终是第一次（旧关键词）的结果，而界面上的关键词是第二次——这就是第 4 章故障一。用 `play.vuejs.org` 或 `npm run dev` 加一句 `console.log('写入', mine, seq)` 观察谁覆盖了谁。

② 测法：单测里用 `vi.useFakeTimers()`，让两个 promise 以「新的先 resolve、旧的后 resolve」的顺序完成，推进定时器后断言 `data.value` 是新结果、`status.value === 'success'`；再加一条断言旧请求的 promise 不会改变 `data`（即 `abort` 后 catch 分支被跳过）。这类测试的价值正好在于它能覆盖「网络慢」这条你无法手点出来的路径。

③ `flush: 'sync'` 让回调在依赖被写入的那一瞬同步执行，绕开批处理：同一帧内连续改两个依赖（如 `query` 与 `page`）会发**两次**请求而不是合并成一次，而且 `loading` 抖动可见。列表页里两个筛选条件总是一起变，这正是 `pre` 批处理要解决的场景——把 `sync` 用在这里，等于亲手关掉框架的优化。**默认值是对的，除非有明确的同步失效需求（几乎没有）。**

</template>

</Exercise>

<Exercise title="练习 4 · 设计一份接口" difficulty="挑战">

给「一个需要跟随路由参数变化、拉取详情、支持手动重试、并且把已读状态写回 `localStorage`」的功能设计 composable 接口：写出函数签名（含泛型、参数类型、返回类型的键名），并回答三个问题：① 为什么「跟随路由参数」应该由调用方而不是 composable 内部完成？② `localStorage` 那部分该不该并进这个 composable？③ 哪些返回值该只读、哪些该是动作？

<template #answer>

```ts
function useDetail<T>(
  load: (id: string, signal: AbortSignal) => Promise<T>,
  getId: () => string,                       // getter：不与路由耦合
  options?: { readKey?: string; immediate?: boolean },
): {
  data: DeepReadonly<Ref<T | undefined>>
  error: DeepReadonly<Ref<string | null>>
  status: DeepReadonly<Ref<AsyncStatus>>
  loading: Readonly<Ref<boolean>>
  retry: () => void
  markRead: () => void                       // 显式动作，不自动
}
```

① **依赖注入方向决定可测性与可复用性。** composable 内部 `useRoute()` 会把 Vue Router 变成它的硬依赖：单测要 mock 路由、别的调用场景（详情嵌在弹层里、id 来自 props）就用不了。传 getter 之后，「id 从哪来」是调用方的事——这与第 5 章「不依赖父组件内部」是同一条原则在函数层的版本。

② **不该并进来。** 「拉详情」和「记已读」是两件有生命周期但互不相干的事：前者要取消与竞态，后者是外部系统写入。把它们塞进一个返回十几个键的 composable 里，就是反模式三。**`useLocalStorage` 单独一个，调用处用一行 `watch(status, s => s === 'success' && markRead())` 把它们接线**——接线代码写在页面里是好事，它表达了这个页面的业务规则。

③ `data` / `error` / `status` / `loading` 只读（它们是请求的结果，唯一写入者在 composable 内）；`retry` / `markRead` 是动作；**不返回内部 `ref` 本体**。如果调用方需要把 `data` 继续传给别处做派生，让它 `computed(() => data.value?.items ?? [])`——派生留在消费方，因为不同页面的加工方式不同。

</template>

</Exercise>

## 官方文档与延伸阅读

- [组合式函数（composables）](https://cn.vuejs.org/guide/reusability/composables.html) —— 本章主参考。用来核实官方的 `use` 命名约定、「返回值应包含响应式状态」的示例形态、以及 composable 与组件上下文（`onMounted` / `inject`）关系的那段说明。
- [`<script setup>` API](https://cn.vuejs.org/api/sfc-script-setup.html) —— 核实「顶层代码被编译进 `setup`」「导入即注册」，以及 `defineModel`（3.4+）、`defineOptions` / `defineSlots`（3.3+）的版本标注。
- [组合式 API：setup](https://cn.vuejs.org/api/composition-api-setup.html) —— 用来核实 `setup` 的执行时机与参数、**`async setup` 与 `<Suspense>` 的关联和限制**（本章这一条我标为未逐字核实，读这里确认）。
- [响应式 API：核心](https://cn.vuejs.org/api/reactivity-core.html) 与 [进阶](https://cn.vuejs.org/api/reactivity-advanced.html) —— 核实 `readonly` / `toReadonly` 的深浅差异、`watch` 的 `flush` 默认值与 `stop` 句柄、`shallowRef` 的行为（第 7 条错误与 `useAsync` 的实现依据）。
- [响应式 API：工具函数](https://cn.vuejs.org/api/reactivity-utilities.html) —— 本章「参数约定」一节的依据：`toValue` 标注 3.3+；`MaybeRefOrGetter` 的最小版本未核实，读这里确认。
- [Composition API 常见问题](https://cn.vuejs.org/guide/extras/composition-api-faq.html) —— **官方对「mixins 的三个问题」与「为什么组合式更适合 TypeScript」的原始论述**，本章「组合式的动机」一节对应它。
- [VueUse 文档站](https://vueuse.org/) —— 逐个函数确认是否存在、SSR 行为与依赖体积；本章未核实它的任何具体函数。
- [测试体系：Vitest、Vue Test Utils 与 Playwright](/frontend-engineering/testing) —— composable 单测、组件挂载测试与端到端的分层。
- [第 9 章 Pinia 状态管理](/vue/pinia) —— 什么时候「有状态的函数」应该升级成 store，以及为什么手写模块级单例不适合共享状态。
- [两套渲染模型：Vue 与 React 的根本差异](/react/two-rendering-models) —— composable 与自定义 Hook 在「执行几次」上的本质区别。

## 下一章

本章把「逻辑怎么抽」讲完了，但抽出来的东西里必然有几件事要问框架：**什么时候能碰 DOM？跨多层组件怎么拿到同一份状态而不写七层 props？** 这两个问题的答案分别是生命周期钩子（含「为什么钩子必须同步注册」这条本章已经预告过的规则）与 `provide` / `inject`。下一章：[生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject)。
