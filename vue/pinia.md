# Pinia：把跨页面的状态搬出组件，且不丢类型安全

你在列表页把某条待办标记为完成，跳到统计页想确认「完成数」变了——数字还是旧的。原因是两个页面各自请求、各持一份数组：你在 A 页改的是 A 的副本。再加两个需求，问题就变成结构性的：登录状态要在**路由守卫**里读（守卫不在任何组件里，props 和 `inject` 都够不着）；主题要在设置页改、在导航栏显示、在图表组件里取色。用第 7 章的 `provide` 做，你得到的是一份没有变更历史、没有 DevTools、要在 `main.ts` 手工装配的「手工 store」；用全局变量加事件总线，你得到的是 TS 推不出类型、卸载不回收、测试没法 mock 的全局可变状态。

**Pinia 承担的就是这个角色：应用级、可组合、有工具链支持的状态容器。** 它不是「把所有状态都塞进去」的许可，恰恰相反，它要求你先想清楚哪些状态**不属于任何组件**。本章主线是 setup store（组合式写法），因为它和你已经熟悉的 `ref` / `computed` / 函数是同一套心智。

## 三类状态先分开

「状态」这个词在项目里至少混了三种东西，混在一起是所有状态 bug 的源头：

| 类别 | 例子 | 唯一事实源 | 生命周期 | 该放哪 |
| --- | --- | --- | --- | --- |
| 服务端数据 | 待办列表、用户资料、分页缓存 | 后端 | 请求到 → 缓存 → 失效 | store（带 loading/error） |
| UI 状态 | 弹窗开关、当前 Tab、表单草稿 | 组件 | 随组件销毁 | 组件内 `ref` |
| 会话状态 | 登录用户、token、主题、权限 | 本地 + 后端校验 | 跨页面，常需持久化 | store（+ 持久化） |

判断顺序：**先问「离开这个组件还需要它吗」**。不需要 → 留在组件（这是最常见的正确答案，也是新手最少做的那个）。需要，而且要能被组件之外的代码（守卫、请求封装）读到 → store。需要，但只在同一棵子树里被几层后代用 → `provide` / `inject`。

`provide` 的三条局限值得写明：① 作用域止于提供者以下的子树，两个互不相干的页面共享不了；② 变更逻辑得自己组织，没有任何「谁在什么时候改了什么」的记录；③ 组件之外的代码拿不到它。

和 Vue 2 时代的关系一句带过：**Pinia 取代了 Vuex 的定位**——它是官方现推荐库，去掉 mutations、不需要嵌套模块、类型推断完整、支持组合式写法。读旧项目时把 `mutations` 理解为「只能同步的 action」即可，本站不涉及 Vuex 代码。

## 安装与定义 store 的两种方式

```bash
npm install pinia        # 官方脚手架 npm create vue@latest 勾选 Pinia 即可
```

```ts
// src/main.ts —— 顺序：先 Pinia，后 router，最后 mount
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
```

### setup store（本站主线）

像写 `<script setup>` 一样写 store：`ref` 是 state，`computed` 是 getter，普通函数是 action。

```ts
// src/stores/todos.ts
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

interface TodoItem { id: string; title: string; done: boolean }

export const useTodoStore = defineStore('todos', () => {
  const items = ref<TodoItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const doneCount = computed(() => items.value.reduce((n, t) => n + (t.done ? 1 : 0), 0))
  const activeCount = computed(() => items.value.length - doneCount.value)

  async function fetchAll() {
    loading.value = true
    error.value = null
    try {
      const res = await fetch('/api/todos')
      if (!res.ok) throw new Error(String(res.status))
      items.value = (await res.json()) as TodoItem[]
    } catch (err) {
      error.value = err instanceof Error ? err.message : '请求失败'
    } finally {
      loading.value = false
    }
  }

  async function toggle(id: string) {
    const target = items.value.find((t) => t.id === id)
    if (!target) return
    target.done = !target.done                   // 乐观更新
    try {
      await updateOnServer(id, target.done)
    } catch (err) {
      target.done = !target.done                 // 失败回滚
      error.value = '更新失败，已回滚'
      throw err
    }
  }

  function $reset() {                            // setup store 得自己写
    items.value = []
    loading.value = false
    error.value = null
  }

  return { items, loading, error, doneCount, activeCount, fetchAll, toggle, $reset }
})
```

**`return` 是最容易漏的一步**：setup store 只暴露返回对象里的成员，忘记 return 的 `ref` 在组件里是 `undefined`，而且没有任何警告指向「你没 return」。这是它相对 option store 唯一多出来的心智负担。

### option store

```ts
export const useCounterStore = defineStore('counter', {
  state: () => ({ count: 0, history: [] as number[] }),
  getters: {
    double: (s) => s.count * 2,
    lastEntry(s): number | undefined { return s.history.at(-1) },
  },
  actions: {
    increment() { this.count++; this.history.push(this.count) },
  },
})
```

| 差异点 | setup store | option store |
| --- | --- | --- |
| `$reset` | **没有，需自己实现并 return** | 内置 |
| 引用别的 store | 在函数体内调用 `useXStore()`，闭包使用 | 必须在 action/getter 里取（`this` 上不能用箭头函数） |
| TypeScript | 天然推断，几乎不用标注 | getter 用 `this` 时需显式返回类型 |
| 私有成员 | 不 return 即可隐藏 | 无法隐藏 |
| 与 `<script setup>` 心智一致度 | 高 | 低 |

### 第一个参数：store id

`defineStore('todos', ...)` 里的 `'todos'` 是**全局唯一 id**，三处依赖它：DevTools 里显示的名字；HMR 时匹配并替换同名 store；SSR 时用它把服务端状态装进 payload（本站纯客户端 SPA 用不上第三条）。命名习惯是短名词（`todos`、`auth`、`settings`），函数名 `useTodoStore`。两个 store 用同一个 id 会互相覆盖，症状是「状态串了」。

## state 必须是函数，$reset 分两种

`state` 是**返回初始值的函数**而非对象字面量：函数每次新建一份数据，避免多实例（SSR 下每个请求一份 store）共享同一对象引用。setup store 里的 `ref` 每次调用工厂函数也会新建，天然满足。

`$reset` 的行为差异是本章最容易写错的一条。官方口径（核实时间 2026 年 10 月）：**option store 自动带 `$reset`（用 state 函数重新求值恢复初值）；setup store 默认没有，需要你自己实现**——官方示例就是「写一个把各 ref 赋回初值的函数并 return」，上面的 `todos.ts` 就是这么写的。手写版本的坑是漏字段（「重置不干净」），以及这种无效写法：

```ts
function $reset() {
  Object.assign({}, initialState())     // 错：赋给了临时对象，原来的 ref 没动
}
```

正确做法是逐个 `.value` 赋值，或保留一份 `const DEFAULTS = { items: [], filter: 'all' }` 常量，在 `$reset` 里 `items.value = DEFAULTS.items` 这样逐字段写。

## getters 是 computed：懒、缓存、只读

setup store 里 getter 就是 `computed`，option store 的 `getters` 同语义。三条性质直接来自第 2/4 章：**缓存**（只有依赖变化才重算）、**懒执行**（没人读就一次都不算，所以「getter 里发请求」不只是不优雅，而是执行时机不可预测）、**只读**（`store.doneCount = 5` 开发期报错）。

getter 之间可互相引用：option store 里用 `this`（**箭头函数拿不到 `this`**，且需显式返回类型）；setup store 里直接读另一个 `computed` 的 `.value`。**不要在 getter 里做需要参数的事**：`computed` 不接受参数，`visibleTodos(filter)` 这种应做成「返回函数的函数」，或在组件/action 里过滤——把参数化派生硬塞进 computed 会缓存失效或读到脏值。写 getter 还是写组件里的 `computed`，判据是**被两个以上组件用到的派生值进 store**（否则同一规则被重复实现，改一处漏一处），只有一个组件用的留在组件。

## actions：副作用与请求的唯一归宿

action 可以 `async`、可以自由改 state，它是「一次有业务含义的操作」的单位。为什么改状态要走 action，而不是在组件里 `store.items.push(...)`：

| 直接改 state | 走 action |
| --- | --- |
| 变更散落在 N 个组件，乐观更新/回滚/埋点各处重复实现 | 一处实现，组件只表达意图 |
| DevTools 里只看到「值变了」，不知谁改的 | 每次 action 是一条带名字的时间线记录 |
| 逻辑无法脱离组件测试 | `store.toggle(id)` 直接测 |
| 校验容易被绕过 | 校验天然守在写入口 |

这不是框架强制（Vue 不禁止你直接改），而是**可维护性约束**。判据：有业务含义的变更（增删改、切换、提交）进 action；纯粹的控件绑定（`v-model="store.filter"`）可以直连。团队想收紧，可以只暴露 `readonly(state)` + actions，代价是 `v-model` 要写 setter。option store 的 `this` 坑：action 必须是普通函数，写成箭头函数拿不到 `this`。

## store 之间的依赖与循环引用

```ts
// 正确：在函数体内才 use 别的 store（延迟求值，天然破环）
export const useStatsStore = defineStore('stats', () => {
  const summary = computed(() => {
    const todos = useTodoStore()
    return { total: todos.items.length, done: todos.doneCount }
  })
  return { summary }
})
```

```ts
// 危险：模块顶层调用
export const useAuthStore = defineStore('auth', () => {
  const token = ref(useSettingsStore().token)   // 求值时机可能没有活跃 Pinia
})
```

原因两条：`useSettingsStore()` 需要一个**活动的 Pinia 实例**，模块顶层代码在 import 阶段执行，那时 `app.use(createPinia())` 可能还没跑；而且两个 store 互相顶层 import 时，ES 模块的循环引用会让其中一方的导出还是 `undefined`，报 `useTodoStore is not a function`。修法优先级：① 把依赖调用推进函数体；② 抽第三个 store/composable 承载共享逻辑（`A ← C → B`）；③ 通过参数传递而不是互相拿。`computed` 里的跨 store 引用是响应式的（拿到的是同一个实例），但别把它的属性解构出来存进闭包。

## 在组件外使用 store

规则只有一条：**必须在 `app.use(createPinia())` 之后调用 `useXxxStore()`。**

```ts
// 正确：守卫函数体内取
router.beforeEach((to) => {
  const auth = useAuthStore()
  return auth.isLoggedIn || to.name === 'login' ? true : { name: 'login' }
})

// 错误：模块顶层
const auth = useAuthStore()   // Pinia 还没装 → 抛 no active pinia
```

同类场景（fetch 封装里读 token、WebSocket 回调写状态、插件 `install()`）做法一致：把 `useXxxStore()` 放进**每次调用时才执行**的函数里。单元测试里要显式激活：`setActivePinia(createPinia())` 之后 `useXxxStore()` 才可用。

## TypeScript：推断、解包与 storeToRefs

- **state 自动被推断**：`ref<TodoItem[]>([])` 的类型直接进 store；option store 的 `state: () => ({ count: 0 })` 同理。前提是 `tsconfig.json` 开了 `strict`（[tsconfig 关键选项](/typescript/tsconfig)）。
- **`ref` 在 store 上自动解包**：`store.items` 的类型是 `TodoItem[]` 而不是 `Ref<TodoItem[]>`——Pinia 用 `reactive` 包了一层 store，`reactive` 会解包内部 `ref`（第 2 章的规则）。所以写 `store.items.length`，**别写 `store.items.value`**（这是 setup store 迁移时最常犯的错）。
- **解构会丢响应式，必须用 `storeToRefs`**：

```ts
import { storeToRefs } from 'pinia'

const store = useTodoStore()
// const { items, filter } = store             // 错：拿到的是快照，之后界面不再更新
const { items, filter } = storeToRefs(store)   // 对：拿到 Ref，模板里照常解包
const { fetchAll, toggle } = store             // action 不需要转换
```

`storeToRefs` 只转换 state 与 getters，不含 action。它与第 2 章的 `reactive` 解构、第 8 章的 `useRoute()` 解构是同一类故障：**从响应式对象上取值的那一刻退化成普通值**。模板里能直接写 `store.items` 也正因如此——`store` 本身是响应式的。

`mapStores` / `mapState` 是选项式时代的语法糖（在 `computed` 选项里 `...mapStores(useTodoStore)` 让 `this.todo` 指向 store），本站全用 `<script setup>`，不需要，读到旧代码认得即可。

## 持久化：插件与手写两条路

生态里最常用的是第三方插件 `pinia-plugin-persistedstate`：在 `main.ts` 里 `pinia.use(插件)`，store 上加一个持久化选项，可指定 `paths`（只持久化部分字段）与所用 storage。声明式、省事，代价是多一个依赖。

<Callout type="unverified" title="持久化插件的配置字段我没核实">

本章只确认「Pinia 有 `pinia.use(plugin)` 插件机制」这一条官方 API。第三方持久化插件的**选项字段名、是否支持 setup store、与 Pinia 主版本的兼容矩阵都未核实**（本站也不装它），落地前请读该插件自己的 README；下面这条手写路线是无需外部依赖的可控实现。

</Callout>

```ts
// 手写 watch：五分钟可控实现
const KEY = 'settings.v1'

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<Theme>(localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light')

  watch(theme, (next) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch (err) {
      console.warn('未能保存设置', err)   // Safari 无痕、配额满都会抛
    }
  })

  return { theme }
})
```

手写五条注意：① **读一次写多次**，读放初始化，别在 watch 里读；② key 带版本号，结构变化时能迁移；③ 永远校验反序列化结果（`JSON.parse` 出来的可能是任何东西）；④ 别持久化 `loading` / `error` 这类瞬态；⑤ 敏感信息不进 `localStorage`（同源脚本可读，见 [fetch、同源策略与浏览器存储](/javascript/network-and-storage)）。

SSR 只点到为止（本站是纯静态 SPA，碰不到）：服务端没有 `window` / `localStorage`，读写必须放进客户端生命周期，state 工厂要能在服务端安全求值。完整口径见 Pinia 官方 SSR 一节。

## subscribe、DevTools 与调试

```ts
const unsubscribe = store.$subscribe((mutation, state) => {
  // mutation.type: 'direct' | 'patch object' | 'function'；mutation.storeId: 'todos'
  console.log(mutation.type, state.items.length)
}, { flush: 'post' })                     // detached: true 则组件卸载后仍监听

const stop = store.$onAction(({ name, after, onError }) => {
  after(() => console.log(`${name} 完成`))
  onError((err) => console.error(`${name} 失败`, err))
})
```

在 setup 里注册时 Pinia 会随组件销毁自动解绑，这点比手写 `watch(store.items, ...)` 更省心。Vue DevTools 6+ 有 Pinia 面板：看每个 store 的 state/getters、按 action 回放时间线（点开某次 action 看它前后的 diff）、直接改 state 做试验。与第 7 章「卸载即回收」对照的一条重要差别：**store 里的东西不会随组件卸载消失**。所以「界面空白但 store 有值」「store 有值但组件不更新（读的是解构快照）」这类问题，先在 DevTools 确认 state 到底变了没有，再怀疑渲染层。

## 状态设计：待办的三份数据放哪

列表与统计进 store（上面的 `todos.ts` 已给出 `items` + `doneCount` / `activeCount` 的完整实现，action 里做乐观更新与回滚，`$reset` 逐字段清），筛选不进——它属于 URL：

| 数据 | 放哪里 | 理由 |
| --- | --- | --- |
| `todos` 列表 | store 的 `items` | 列表页、统计、详情页都要用；需要缓存与统一写入者 |
| `loading` / `error` | store | 与请求绑定的状态，属于服务端数据层的一部分 |
| 完成/未完成统计 | store 的 `computed` | 两个以上页面读同一份规则，且需要缓存语义 |
| 筛选条件 | **URL 的 `query`**（第 8 章），组件里 `computed` 从 `route.query` 派生 | 筛选要能刷新恢复、后退撤销、分享；放 store 反而会让「换个页面再回来」丢筛选，或让多个列表互相覆盖 |
| 新增输入框草稿 | 组件 `ref` | 离开组件就没意义 |

把筛选从 store 改成 URL 的具体收益：`/todos?status=active` 可分享、后退能撤销、两个列表页实例互不干扰。

## 常见错误与排查

1. **解构 store 后界面不更新。** 现象：DevTools 里数据明明变了，模板不动。原因：`const { items } = store` 拿到的是解构瞬间的快照，响应式链断了。怎么确认：模板里临时改回 `store.items`，界面立刻正常就是它。修法：`storeToRefs(store)`。
2. **`getActivePinia() was called but there was no active Pinia`。** 原因：在 `app.use(createPinia())` 之前调了 `useXxxStore()`（模块顶层求值、守卫外提前拿、测试里没 `setActivePinia`）。怎么确认：看堆栈第一帧是不是某个 `.ts` 文件的顶层。修法：调用挪进函数体；测试里 `setActivePinia(createPinia())`。
3. **两个组件各持一份数据、统计对不上。** 现象：A 改了 B 不变，B 刷新出旧值。原因：状态其实在各自组件里（两份 `ref` + 两次请求），或两个 store 用了同一个 id 造成覆盖。怎么确认：DevTools 的 Pinia 面板里确认是否只有一个 store、值是否唯一。修法：共享数据搬进 store，请求去重（`loading` 标志或 composable 里缓存 promise）。
4. **setup store 的属性在组件里全是 `undefined`。** 原因：没 `return`（或返回时用了别的变量名）。怎么确认：`console.log(Object.keys(store))`。修法：要暴露的都 return；不想暴露的**故意不 return**（这就是 setup store 的私有成员机制）。
5. **`store.items.value` 报 `Property 'value' does not exist`。** 原因：把 store 上已解包的状态当 `Ref` 用。怎么确认：`console.log(store.items)` 直接是数组即已解包。修法：去掉 `.value`；需要 `Ref` 形式传给 composable 时用 `storeToRefs`。
6. **setup store 调 `store.$reset()` 报不是函数。** 原因：**setup store 没有内置 `$reset`**（option store 才有）。怎么确认：`typeof store.$reset`。修法：自己实现并 return（逐字段赋回初值，别写 `Object.assign({}, ...)` 那种无效赋值），或改用 option store。
7. **接口被反复请求 / 循环 import 报错 / 持久化后读到旧结构崩溃。** 第一类：getter 里写了副作用，或组件每次渲染都 `store.items.map(...)` 绕过 getter——副作用只放 action 与 `watch`，多处复用的派生值写成 store 的 `computed`。第二类：`useTodoStore is not a function`，两个 store 互相顶层 import、模块求值时对方导出还是 `undefined`——把 `useXStore()` 移进函数体。第三类：字段改名而存储里还是旧版本 JSON——带版本号的 key + 迁移函数 + 校验后回落默认值。

## 练习

<Exercise title="练习 1 · 判断哪些状态该进 store" difficulty="基础">

后台项目里有这些状态，逐项判断放组件、store 还是 URL：① 当前用户与权限列表；② 表格每行的选中项；③ 表格的分页与排序；④ 列表接口返回的数据；⑤ 侧边栏是否折叠；⑥ 表单正在输入的字段值。

<template #answer>

① **store（会话状态）**：守卫、请求封装、多个页面都要读，必须能在组件外访问。② **组件**：选中是本页交互，离开就该清空；进 store 会让两个表格实例共享选择。③ **URL query**：`?page=2&sort=createdAt&order=desc`，可分享、后退能撤销（第 8 章）。④ **store**：跨页面复用 + 需要 loading/error + 需要统一写入者。⑤ **组件**（若要跨刷新保留则进 settings store 并持久化）。⑥ **组件**：草稿是局部 UI 状态，提交成功后由 action 更新 store。

通用检验：**这份状态需要被「不是它祖先」的代码读到，才进 store。**

</template>

</Exercise>

<Exercise title="练习 2 · 修一个 setup store" difficulty="进阶">

下面代码有三类问题（运行时报错、类型不对、界面不更新），找出来并给修正版。

```ts
export const useCartStore = defineStore('cart', () => {
  const items = ref([])
  const count = computed(() => items.length)
  function add(product) { items.value.push(product) }
})
```

```vue
<script setup>
const { items, count, add } = useCartStore()
</script>
```

<template #answer>

① **没有 `return`**：setup store 必须把成员返回出来，否则 store 是空对象，解构出的 `add` 是 `undefined`，调用即抛 `not a function`。② **`items.length` 少了 `.value`**：store 内部不会自动解包（解包只发生在 store 对象与模板上），应写 `items.value.length`；同时 `ref([])` 无标注会被推成 `Ref<never[]>`，`push(product)` 报类型错，应写 `ref<Product[]>([])`。③ **组件里直接解构丢响应式**：`items` / `count` 要走 `storeToRefs`，`add` 可直接从 store 取。

```ts
export const useCartStore = defineStore('cart', () => {
  const items = ref<Product[]>([])
  const count = computed(() => items.value.length)
  function add(product: Product) { items.value.push(product) }
  return { items, count, add }
})
```

```ts
const cart = useCartStore()
const { items, count } = storeToRefs(cart)
const { add } = cart        // action 不需要转换
```

模板里写 `count`（自动解包），脚本里写 `count.value`。

</template>

</Exercise>

<Exercise title="练习 3 · 让一个 store 依赖另一个" difficulty="挑战">

`useOrderStore` 提交时要读 `useAuthStore` 的 token、并向 `useToastStore` 写提示。写出避免循环引用与 `no active pinia` 的实现，并说明为什么不能把 `useAuthStore()` 写在文件顶层。

<template #answer>

```ts
export const useOrderStore = defineStore('orders', () => {
  const submitting = ref(false)

  async function submit(payload: OrderPayload) {
    const auth = useAuthStore()            // 延迟到调用时
    const toast = useToastStore()
    submitting.value = true
    try {
      await api.create(payload, auth.token)
      toast.show('已提交')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        auth.logout()                      // 会话过期：统一在 action 里处理
        toast.show('登录已过期，请重新登录')
      } else { toast.show('提交失败') }
      throw err
    } finally { submitting.value = false }
  }

  return { submitting, submit }
})
```

顶层写 `const auth = useAuthStore()` 危险在于：它需要活跃 Pinia 实例，而模块顶层代码在 **import 阶段**执行——若 `main.ts` 在 `app.use(createPinia())` 之前间接 import 了这个文件（`import router from './router'` 常会带出一串 store），那一刻还没有活跃实例，直接抛 `getActivePinia() ... no active Pinia`；即使侥幸不抛，两个 store 互相顶层引用时循环 import 会让一方导出还是 `undefined`。放进函数体后求值推迟到真正调用（此时应用必然已装配完），环也被自然打断。

另一要点：**错误处理放 action**（401 的统一动作是业务规则，不该散在每个组件的 catch 里）。代码未在本机运行，写法依据 Pinia 官方文档（核实时间 2026 年 10 月）。

</template>

</Exercise>

<Exercise title="练习 4 · 故意制造一份数据不一致" difficulty="进阶">

同事在两个组件里各写了一份 `const list = ref<TodoItem[]>([])` 加各自的 `fetchAll()`，并把「完成数」分别写在两个组件的 `computed` 里。上线后用户报「统计页和列表页数字对不上」。说明根因，给三种修法与各自代价。

<template #answer>

根因：**同一份事实有两个写入者和两份副本**。两份列表在不同时刻请求（服务端已变）、被不同组件各自修改（A 页乐观更新 B 页不知道）、派生统计各自算——「对不上」是必然结果。这是第 1 章「状态与视图是两份需要人工保持一致的东西」的升级版：现在**状态本身有 N 份**。

1. **搬进 store（最正确）**：`items` 与 `doneCount` 归 `useTodoStore`，两页读同一实例，`fetchAll` 去重。代价：要区分哪些是共享状态，并给请求加缓存/失效策略。
2. **提升到共同祖先 + props/emit**：列表与统计同父时由父持有一份并下发。代价：一旦跨路由就失效，父组件容易变胖。
3. **模块顶层的单例 composable**：`ref` 定义在模块顶层由 `useTodos()` 复用。代价：这是「手工 store」——无 DevTools 面板、无 action 时间线、测试之间串状态、不随应用卸载。业务数据一律用第 1 种。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Pinia 官方文档（中文）](https://pinia.vuejs.org/zh/introduction.html) —— 主入口，核实 Pinia 是官方推荐状态库、安装与 `app.use(createPinia())` 顺序。
- [Core Concepts: State](https://pinia.vuejs.org/core-concepts/state.html) —— **核实本章两条关键口径**：state 必须是返回初始值的函数；option store 自动支持 `$reset`，setup store 需自己实现（官方示例即「写函数把 ref 赋回初值并 return」）。
- [Getters](https://pinia.vuejs.org/core-concepts/getters.html) 与 [Actions](https://pinia.vuejs.org/core-concepts/actions.html) —— 核实 getter 基于 `computed`（缓存、只读）、action 可 `async` 并能自由改 state。
- [Core Concepts 总览](https://pinia.vuejs.org/core-concepts/) —— 核实「store 是被 `reactive` 包起来的对象，不能随意解构，要用 `storeToRefs`」与「必须在安装 Pinia 之后使用」。
- [TypeScript](https://pinia.vuejs.org/guides/typescript.html)、[SSR](https://pinia.vuejs.org/guides/ssr.html)、[API 参考](https://pinia.vuejs.org/api/index.html) —— 核实 `strict` 与推断质量、SSR 与持久化注意事项、`$subscribe`（`flush` / `detached`）与 `$onAction`（`after` / `onError`）参数。第三方持久化插件的配置字段不在官方文档内，以该插件 README 为准（本章未核实）。
- 站内回指：[响应式原理](/vue/reactivity)（解包与解构丢响应式的机制根源）、[计算属性与侦听器](/vue/computed-and-watch)（缓存语义、`watch` 做持久化）、[composables](/vue/composables)、[生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject)（`provide` 的三条局限）、[Vue Router](/vue/router)（守卫里读 store 的前提、筛选放 URL）。跨领域：[泛型](/typescript/generics)、[tsconfig 关键选项](/typescript/tsconfig)、[fetch、同源策略与浏览器存储](/javascript/network-and-storage)、[统一错误处理](/backend/error-handling)。

## 下一章

第 8 章把「哪个 URL 显示哪个组件」交给路由，第 9 章把「跨页面共享什么」交给 store，一个多页面应用的结构到这里已经完整。剩下的问题都是性能与工程化：一千条数据时列表卡死、大对象被深层代理拖慢、组件频繁重渲染。第 10 章 [渲染性能：v-memo、shallowRef 与长列表](/vue/rendering-performance) 从「谁依赖谁、谁重画」出发，讲怎么用 DevTools 找到真实瓶颈，再决定要不要上 `shallowRef`、`markRaw`、`v-memo` 与虚拟滚动——顺序不能颠倒，过早优化是这个阶段最常见的错误。

