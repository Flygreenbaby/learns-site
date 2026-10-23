# 状态管理选型：读一个值会不会重渲染，是分清方案的第一条线

第一个故障来自把 Context 当全局 store。你把待办列表放进 Context，输入框每次键入都换一次 value，于是整棵子树——列表、图表、侧边栏、路由布局——每秒重渲染十几次。你在 Vue 里做过同样的事：`reactive` 对象挂在 `provide` 上，深处只有 `TaskCount` 读了 `todos.length`，别的组件一个都没醒。这是[第 6 章](/react/context)的结论，但真正的问题要到这一章才说得清：**Context 提供的是「依赖穿透」，它没有订阅粒度，所以它天生不是状态管理库。**

第二个故障来自照抄示例。你用 Zustand 写了一个 selector：`useStore((s) => ({ todos: s.todos, filter: s.filter }))`，页面开始无限重渲染，控制台出现与 `getSnapshot` 缓存相关的警告，甚至 `Maximum update depth exceeded`。原因和第一个故障同源但机制完全不同：这类 store 通过 `useSyncExternalStore` 订阅外部数据源，**每次渲染后它会比较「selector 这次返回的值」和「上次返回的值」，用 `Object.is`。** 对象字面量每次都是新引用（第 7 章已在 Node 里验证 `Object.is({}, {})` 为 `false`），于是永远不等 → 永远触发更新。Vue 里同样的写法 `storeToRefs` 解构出来毫无问题，因为 Vue 的粒度在属性上。

第三个故障是「改了没反应」。你从 Vue 迁移过来，习惯性写了 `state.todos.push(newTodo)`，Redux 的 reducer 里甚至没报错（Immer 风格的写法看起来允许你「修改」），界面就是不动，React DevTools 里那个组件一次都没重渲染。这一条在[第 3 章](/react/state)讲过机制，但它是选型问题的一部分：**Pinia 允许你直接改，Redux/Zustand 要求你交出新引用；这个差别会让两套代码的可维护性风险完全错位**——一边容易写出「追踪不到的修改」，一边容易写出「忘了展开的静默失效」。

第四个故障更隐蔽：你为了「统一管理」把接口返回的列表数据也塞进了全局 store，然后手写了 `loading` / `error` / `lastFetched` / 缓存失效四五个 state 字段，半年后代码里出现七种不同的「判断数据是否新鲜」写法，重复请求、竞态覆盖和「切页面时闪一下空态」全都来了。这不是状态管理库能解决的问题，**它是缓存问题**，服务端状态有另一套工具。

这一章给出的是判据而不是答案：先讲清「读一个值时到底谁更新」这条机制线，再逐项对照 Pinia / Redux Toolkit / Zustand，最后说服务端状态为什么要单独一层。前置：[Context 与 provide / inject](/react/context)、[重渲染机制与性能](/react/re-render-performance)、[Pinia 状态管理](/vue/pinia)、[useState / useReducer 与不可变更新](/react/state)。

## 唯一硬指标：读一个值会不会让组件重渲染

先把两边放在一起看，这张表是本章的骨架。

| 维度 | Pinia（Vue） | Redux Toolkit / Zustand（React） |
| --- | --- | --- |
| state 的存储形态 | 响应式对象（`reactive`，Proxy 拦截读写） | 普通不可变对象（模块里的一份纯 JS 值） |
| 组件怎么「订阅」 | 在渲染函数里**读属性**时被动记录依赖（谁读了哪个键） | 显式提供 **selector 函数**，每次渲染都执行一遍 |
| 更新触发比较的方式 | 属性值变化（`hasChanged`，基本类型按值） | selector 返回值用 `Object.is` 比较 |
| 读一个 `todos.length` 的影响 | 只有渲染期间读了 `todos` 且读了 `length` 的那个 effect/组件被唤醒 | selector 返回**原始值** `number` 时，只有数值真的变化才更新；返回**对象**时每轮都更新（因为引用变了） |
| 「解构」会不会丢响应性 | 会（`const { todos } = store` 拿到的是当时的值，不再追踪；需要 `storeToRefs`） | 不会（selector 的返回值就是这一轮的数据，解构无所谓）；但解构出的**派生对象**若来自新构造，就等价于「返回新对象」 |
| 修改数据的写法 | `store.todos.push(x)` 直接改，合法且推荐 | 必须交出新的引用（展开 / `useReducer` / reducer）；直接 `push` 会静默不更新 |
| 派生数据 | `getters`（`computed`，自动缓存、依赖精确、惰性求值） | `useMemo` 或 `createSelector`（**不保证缓存**，依赖数组要你手写对） |
| 是否需要记忆化才高效 | 一般不需要（依赖追踪本身就是最小更新） | 经常需要，且这是「你负责的」 |
| 组件外读写 | 需要先拿到 store 实例（`useXxxStore()`，通常要在 setup/app 上下文中） | 天然可以：`store.getState()` / `store.setState()`、`store.dispatch()` 在任意模块里可用 |
| 开发工具 | Vue Devtools 的 Pinia 面板（state 树、action 时间线） | Redux Devtools（action 列表、diff、时间旅行、dispatch 任意 action）；Zustand 也接同一个扩展 |

一句话总结这张表：**Vue 侧的更新粒度是「数据结构的属性」，由框架算；React 侧的更新粒度是「selector 返回值」，由你写。** 所以 React 的状态管理库好不好用，几乎等价于它的 selector API 让你多容易写出稳定的返回值。

## 为什么 React 侧必须走「订阅 + 快照」这条路

`useSyncExternalStore` 是这一切的地基，理解它就能理解所有 React 状态库的共同行为，也能理解为什么它们和 Context 不是一回事。

```tsx
// 手写一个最小外部 store，看清 store 库内部在做什么
type Listener = () => void;

function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,                                   // getSnapshot：必须返回同一个引用
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);               // 成对取消订阅
    },
    setState(next: T) {
      state = next;                                          // 交出新的引用
      listeners.forEach((l) => l());                         // 通知所有组件「来读新快照」
    },
  };
}

const todosStore = createStore<Task[]>([]);

function useTodos<T>(selector: (s: Task[]) => T): T {
  // 真实库里还会传第三个参数（getServerSnapshot）用于 SSR
  return useSyncExternalStore(todosStore.subscribe, () => selector(todosStore.getState()));
}
```

机制上有四个点值得钉牢：

1. **store 在组件树之外。** 它不是渲染期的产物，`setState` 也不是「重新渲染某个组件」——它只是「换掉模块里那份值 + 广播通知」。这就是为什么 React 的 store 库能在事件回调、WebSocket 处理函数、路由 loader 里直接读写，而 Vue 的 Pinia 需要先 `useXxxStore()` 拿到实例。
2. **`getSnapshot` 必须稳定。** 组件订阅之后，React 每次渲染都会调它拿快照并和上一次比；不等就重渲染。返回新构造的对象 → 永远不等 → 无限循环。上面第二节那个故障就是这条。
3. **粒度由 selector 决定，不由数据结构决定。** `useStore((s) => s.filter)` 只订阅了 `filter`；`s.filter` 是字符串，原始值比较，天然精确。`useStore((s) => s.todos[0])` 返回元素引用，配合不可变更新的「只换被改项引用」（第 7 章 Node 验证过 `item1 same ref : true`）也精确。`useStore((s) => ({ a: s.a, b: s.b }))` 不精确，必须换写法。
4. **通知是 O(订阅者数量)**，每个订阅组件都要跑自己的 selector。1000 个行组件各跑一次 selector 通常比重新渲染便宜得多，但别把它当免费。

对照 Vue：Pinia 的 `state` 是 `reactive` 的 Proxy，读属性时把「当前正在执行的渲染 effect」记进依赖表，写属性时反向唤醒登记表里的那些 effect。两条路没有优劣，只有约束不同——Vue 要求数据必须留在响应式对象里（**解构出去、传进 Web Worker、塞进 Map 都会丢追踪**，这就是 `storeToRefs` 存在的原因）；React 要求你必须交出新引用并保持快照稳定。你在 Vue 里养成的「随便解构」习惯，在 React 里对应的是「随便返回派生对象」，两边都是静默失效型 bug。

## Context 与 store 库的三条分界

领域首页和第 6 章给了适用清单，这里给出机制级的三条判据：

| 判据 | Context | Redux / Zustand |
| --- | --- | --- |
| 更新粒度 | Provider 的 value 整体，`Object.is` 比 value；不区分你读了哪个字段 | selector 任意粒度（前提是你返回稳定值） |
| 更新的发起位置 | **只能在渲染期**：必须有人重新渲染 Provider 并交出新的 value | 任何地方：`dispatch` / `setState`，不需要有组件在渲染 |
| 状态归属 | 属于那个 Provider 组件——卸载即消失，重挂即重置 | 属于模块，与组件生命周期解耦（要重置得显式重置） |
| 派生/缓存 | 无，需要自己 `useMemo` | `createSelector` / 中间件 / devtools 支持 |
| SSR 安全性 | 必须在每个请求的渲染入口新建 Provider 树 | 也必须每请求新建 store 实例（模块级单例在 SSR 会跨请求串数据） |

第二条是最容易被忽略但最能说明问题的：Context 的 value 是 JSX 属性，**「让 Context 变化」等价于「重渲染那个 Provider 组件」**。而真实业务里很多状态更新并不来自渲染（websocket 推消息、上传进度、路由 loader 返回的数据、第三方 SDK 回调）。这些更新在 Context 方案下你必须先 `setState` 到某个组件、再让它重渲染 Provider——绕一圈、还把渲染牵连进来。store 方案就是直接 `store.setState(...)`，React 只唤醒订阅者。

本站的分工结论（和第 6 章一致，这里补上理由）：环境类低频值（主题、语言、当前账号、设计令牌）→ Context；跨页面业务实体集合 + 频繁更新 → Zustand（小中型）或 Redux Toolkit（需要严格 action 审计的中大型）；服务端数据 → 数据缓存层；组件内部与父子之间 → state + props（别升全局）。

## Redux Toolkit 的 slice 对应 Pinia 的 store

先看形状对照，这是迁移时最有用的一张表：

| 概念 | Pinia | Redux Toolkit | 机制差异 |
| --- | --- | --- | --- |
| 定义一块状态 | `defineStore('todos', ...)` | `createSlice({ name, initialState, reducers })` | 都是「一块领域 + 它的操作」；RTK 的 `name` 就是 devtools 里的命名空间 |
| 数据 | `state: () => ({ list: [] })` | `initialState: { list: [] }` | Pinia 是响应式，RTK 是不可变 |
| 修改数据 | 直接在 action 里 `this.list.push(x)` | reducer 里 `state.list.push(x)`（**Immer 帮你转成不可变更新**） | RTK 允许「看起来像可变」的写法，但产物是新引用；Pinia 是真可变 |
| 异步 | action 里 `await api()`，自己管 loading/error | `createAsyncThunk` 派发 pending/fulfilled/rejected 三态，或直接用 RTK Query | RTK 把「异步三态」标准化了，代价是模板代码；Pinia 自由但容易写成七种花样 |
| 读数据 | `store.list`（属性访问即订阅） | `useSelector(selectTodos)`（显式订阅） | **本章最重要的一行** |
| 派生 | `getters: { doneCount: (s) => s.list.filter(...).length }` | `createSelector([selectA, selectB], (a, b) => ...)` | Pinia 的 getter 是 `computed`：自动追踪依赖、惰性、缓存。`createSelector` 只缓存「上一次输入」，且需要你自己维护输入 selector |
| 局部订阅 | 自动 | 必须每个组件写自己的 selector | React 侧的额外工作量，也是额外的控制权 |
| 重置 | `store.$reset()` | 让 slice 的 reducer 处理一个 `reset` action，或外层传 key | 两边都不难 |
| 持久化 | 插件（如 persistedstate） | 中间件（自己写或社区库） | 都可以；对照[第 6 章](/react/context)里 `useLocalStorage` 的写法，注意 storage 事件跨标签页同步 |
| 全局可用 | 需要 `useXxxStore()` | `store.dispatch` / `getState` 任意模块可用 | React 生态能把逻辑完全移出组件，代价是纪律 |

```ts
// RTK：一个 slice
import { createSlice, createAsyncThunk, createSelector } from '@reduxjs/toolkit';

export const fetchTodos = createAsyncThunk('todos/fetch', async () => {
  const res = await fetch('/api/todos');
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as Todo[];
});

const todosSlice = createSlice({
  name: 'todos',
  initialState: { items: [] as Todo[], filter: 'all' as Filter, status: 'idle' as Status },
  reducers: {
    addTodo(state, action: { payload: string; type: string }) {
      state.items.unshift({ id: crypto.randomUUID(), text: action.payload, done: false });
    },
    toggleTodo(state, action: { payload: string; type: string }) {
      const found = state.items.find((t) => t.id === action.payload);
      if (found) found.done = !found.done;         // Immer 负责生成新引用
    },
    setFilter(state, action: { payload: Filter; type: string }) {
      state.filter = action.payload;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchTodos.pending, (s) => { s.status = 'loading'; });
    b.addCase(fetchTodos.fulfilled, (s, a) => { s.status = 'ready'; s.items = a.payload; });
    b.addCase(fetchTodos.rejected, (s) => { s.status = 'error'; });
  },
});

export const { addTodo, toggleTodo, setFilter } = todosSlice.actions;

const selectItems = (s: RootState) => s.todos.items;
const selectFilter = (s: RootState) => s.todos.filter;

// 记忆化派生：输入 selector 结果不变就不重算，且返回的数组引用稳定
export const selectVisible = createSelector([selectItems, selectFilter], (items, filter) =>
  filter === 'all' ? items : items.filter((t) => (filter === 'done' ? t.done : !t.done)),
);
```

```ts
// Pinia：同一个 store
import { defineStore } from 'pinia';

export const useTodosStore = defineStore('todos', {
  state: () => ({ items: [] as Todo[], filter: 'all' as Filter, status: 'idle' as Status }),
  getters: {
    visible: (s) => (s.filter === 'all' ? s.items : s.items.filter((t) => (s.filter === 'done' ? t.done : !t.done))),
  },
  actions: {
    add(text: string) { this.items.unshift({ id: crypto.randomUUID(), text, done: false }); },
    toggle(id: string) { const f = this.items.find((t) => t.id === id); if (f) f.done = !f.done; },
    async load() {
      this.status = 'loading';
      try { this.items = await (await fetch('/api/todos')).json(); this.status = 'ready'; }
      catch { this.status = 'error'; }
    },
  },
});
```

组件里读取的差别就是本章的全部要点：

```tsx
// React：每个组件声明自己订阅什么
const items = useSelector(selectItems);      // items 引用变才更新
const filter = useSelector(selectFilter);    // 只有 filter 变化才更新（原始值）
```

```vue
<!-- Vue：读什么就订阅什么，不需要声明 -->
<p>{{ store.filter }}</p>        <!-- 只订阅 filter -->
<li v-for="t in store.visible">{{ t.text }}</li>   <!-- 订阅 items + filter -->
```

`selectVisible` 那一行为什么要写 `createSelector`：如果直接在 selector 里 `s.todos.items.filter(...)`，每次比较都会执行并返回**新数组** → `Object.is` 不等 → 组件每轮渲染都更新（第二个故障的 Redux 版本）。`createSelector` 缓存「输入相同 → 输出同一个引用」，这才是 React 侧 `computed` 的可用替身。**但它不保证一定缓存，也不惰性求值**（每次渲染都会跑 selector 判断输入是否变了）——语义上和 `computed` 仍有差距，这一点第 7 章已经讲过。

## Zustand 的极简模型，以及它和 Pinia 到底差在哪

```tsx
import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';

type TodosState = {
  items: Todo[];
  filter: Filter;
  add: (text: string) => void;
  toggle: (id: string) => void;
  setFilter: (f: Filter) => void;
};

const useTodos = create<TodosState>()(
  devtools(
    persist(
      (set) => ({
        items: [],
        filter: 'all',
        // 更新函数一律返回新对象片段：这是不可变纪律的唯一落点
        add: (text) => set((s) => ({ items: [{ id: crypto.randomUUID(), text, done: false }, ...s.items] })),
        toggle: (id) => set((s) => ({ items: s.items.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })),
        setFilter: (filter) => set({ filter }),
      }),
      { name: 'todos-storage' },
    ),
  ),
);

// 组件里：一次一个原始值，最省心的写法
const filter = useTodos((s) => s.filter);
const add = useTodos((s) => s.add);
const count = useTodos((s) => s.items.length);
```

| 方面 | Pinia | Zustand | Redux Toolkit |
| --- | --- | --- | --- |
| 心智负担 | 最低（就是响应式对象 + 方法） | 低（一个 hook + `set`） | 中高（action / thunk / store 装配 / selector 纪律） |
| 是否需要包裹 Provider | 不需要 | 不需要（模块级 hook） | **需要** `<Provider store={...}>` 包住使用它的子树 |
| 可变 vs 不可变 | 可变 | 不可变（可配 immer 中间件写「可变风格」） | 不可变（reducer 内部 Immer） |
| 组件外使用 | 拿实例后 | `useTodos.getState()` / `.setState()` 直接可用 | `store.dispatch` / `store.getState` |
| 派生值 | getters（computed） | 自己 `useMemo`，或在 selector 里选原始值 | `createSelector` |
| devtools | 有 | 有 `devtools` 中间件 | 最强（action 列表、diff、时间旅行、派发） |
| 多 store 组合 | store 之间互相调用很自然 | 可以在一个 store 里 `get()` 另一个，但容易形成循环依赖 | slice 天然是分区的，跨 slice 读取靠根 state selector |
| 适合 | —— | 中小应用、需要快速上线、迁移成本低 | 需要严格数据流审计、多人协作、复杂异步流程 |

Zustand 的选择器语义有一条必须知道的注意项：**它把「订阅粒度」完全交给你的 selector，而比较方式是默认的引用相等。** 因此「一个 selector 返回一个新建对象/数组」是需要避免的写法，社区给出的缓解手段是 shallow 比较工具与派生 selector 辅助函数（不同版本的导入位置与推荐写法不一样）。

<Callout type="unverified" title="Zustand 版本的 selector 兜底行为请以官方文档为准">

Zustand 在早期版本提供过「返回多个字段时用浅比较兜底」的选项，后续主版本调整过这一默认行为，并给出了 shallow / 派生 selector 一类工具函数来替代；**这些工具的确切名称、导入路径与是否仍需要手动指定比较函数，本章未逐字核实（抓取官方文档失败）**。请以 [Zustand 官方文档](https://zustand.docs.pmnd.rs/) 当前内容为准。

本站给出的规避方式是版本无关的：**一个 selector 只返回一个原始值或一个稳定引用**。需要多个字段就写多个 `useTodos((s) => s.a)`，这既不需要 shallow，也不依赖任何版本的兜底行为。

</Callout>

## 服务端状态不是全局状态：这是选型里最省事的一刀

「要不要上 Redux」的争论通常发生在把两类完全不同的数据混成一类之后。分开之后一半的问题自动消失：

| | 客户端状态 | 服务端状态 |
| --- | --- | --- |
| 例子 | 弹窗开合、表单草稿、当前筛选、侧栏折叠 | 待办列表、用户资料、搜索结果、下拉选项数据 |
| 权威来源 | 你的应用 | 服务器，你只有副本 |
| 会过期吗 | 不会 | 会（别人改了、别人新加了） |
| 需要缓存/失效/重试/去重吗 | 不需要 | **需要，这四项就是它的全部复杂度** |
| Vue 里常见处理 | 组件 state 或 Pinia | Pinia action 里手写 `loading`/`error`/`refetch` |
| React 里常见处理 | 组件 state / `useReducer` | **不要用 store 手搓**：用 TanStack Query 或 RTK Query；或让路由 loader 承担首屏（见[第 8 章](/react/router)） |
| 全局 store 的正确职责 | 跨组件共享的 UI 状态、鉴权身份、需要审计的操作历史 | 最多作为「一次性 hydration 快照」或跨页面共享的一份列表结果，其余交给缓存层 |

对照你写过的 Pinia action：`loading` / `error` / `status` 三个字段 + `try/catch/finally` + 「组件卸载了别 setState」的判断 + 「同一 key 并发只发一次」+ 「回到页面要不要重新拉」——这些正是 TanStack Query 用一个 `useQuery({ queryKey, queryFn })` 提供的能力，也是 StrictMode 双调用不会导致重复请求的原因（请求在缓存层，不在组件生命周期里）。这一层与框架无关，Vue 侧也可以用 TanStack Query，所以对照法在这里失效：**它是「React 生态更早就把这件事标准化了」，而不是「React 需要它而 Vue 不需要」。**

判断顺序（本站推荐）：

1. 这份数据是从接口来的吗？→ 是 → 交给服务端状态层（或在路由 loader 里取），**不要放进全局 store 手搓缓存**。
2. 它被几个组件读？只有 1 个 → 留在组件内；2–3 个且相邻 → 提到最近共同父，props 传（[第 4 章](/react/props-and-children)）。
3. 跨页面 + 变化很少（当前用户、租户、权限）→ Context 或一个小组合 store 都行。
4. 跨页面 + 频繁变化 + 多个不同粒度的消费者 → Zustand；需要 action 审计 / 团队要求统一数据流 / 复杂异步编排 → Redux Toolkit。

## 常见错误与排查

1. **selector 返回新建对象/数组，页面无限重渲染或报 `getSnapshot` 相关警告。** 现象：控制台大量重复渲染日志，最终 `Maximum update depth exceeded`。原因：`useStore((s) => ({ a: s.a, b: s.b }))` 每轮返回新引用，`Object.is` 永远不等（第 7 章 Node 已验证空对象不等）。怎么确认：把 selector 换成 `(s) => s.a`，症状立即消失即确诊。怎么修：拆成多个「返回原始值/稳定引用」的 selector；确实要一次取多个，用官方提供的 shallow 工具（导入路径按当前版本文档），或用 `createSelector` 把派生结果提到 store 外部缓存。
2. **在 reducer / `setState` 里直接修改 state，界面不动。** 现象：数据逻辑单测「看着是对的」，UI 一次都不刷新，也没有报错。原因：交出的还是同一个引用，React 的 `Object.is` 判定未变。怎么确认：在 `setState` 前后打印 `Object.is(prev, next)`；或在 devtools 里看状态树是否出现新对象。怎么修：数组用展开/`map`/`filter` 产出新数组，对象逐层展开；RTK 的 reducer 里可以写「修改」语法（Immer 生成新引用），但在 RTK 之外手写 reducer 就必须自己展开；`useReducer` 的 `dispatch` 只在**返回新对象**时才触发更新，返回同一个对象 React 会认为没变。
3. **用 Context 承载频繁变化的业务数据，输入卡顿 / 全站抖动。** 现象：Profiler 里更新原因是 Context，覆盖整棵树；给消费者包 `memo` 完全无效（官方明写 `memo` 挡不住 Context）。怎么确认：把该数据临时移到一个只渲染它的子组件里，抖动是否消失。怎么修：state 下沉到最近共同父；或换成有 selector 的 store；只有「低频 + 多分支」的值才留在 Context（第 6 章清单）。
4. **把服务端数据塞进 store 后手写 loading/error，出现重复请求与竞态覆盖。** 现象：切页面闪一下空态；快速输入时旧请求的结果覆盖了新请求；StrictMode 下开发环境请求发了两次。原因：请求生命周期被绑在组件生命周期上，而组件会反复挂载。怎么确认：Network 面板看同一 URL 在一次交互里请求了几次；在 effect 首行打印依赖值。怎么修：交给服务端状态层（缓存 + 失效 + 请求去重），或路由 loader；effect 版本必须带 `AbortController` 清理并按 key 判等再 `setState`。
5. **从 Vue 迁移带来的 `storeToRefs` 直觉：在 React 里解构 store 后再传给子组件，或反过来在 Pinia 里裸解构丢响应性。** 现象：Vue 侧解构后界面不再更新；React 侧「把整个 store 对象当 prop 传下去」导致子组件订阅过粗。原因：两边的失效方向相反。怎么确认：Vue 侧看解构后拿到的是 `Ref` 还是普通值；React 侧看子组件的 selector 是不是拿了整个 state。怎么修：Vue 侧用 `storeToRefs`（状态部分）+ 直接解构 action（action 是方法，不需要 ref）；React 侧**传原始值或传 id**（`<Row id={t.id} />` + 行内 selector），不要把整个 store 交给组件。
6. **store 定义在模块顶层、SSR 下跨请求串数据。** 现象：本地正常，服务端渲染时 A 用户看到 B 用户的列表。原因：模块级 store 是进程内单例，所有请求共享同一份可变状态。怎么确认：把渲染入口改成每请求新建，问题消失即确认。怎么修：每请求创建 store 实例（Redux 的 `configureStore` 每次调用一个；Zustand 提供 createStore/factory 模式），或用框架级方案；Context 同理——Provider 必须在渲染入口内新建。这条 Vue SSR 也一样存在（`app.provide` 而不是模块级单例），不是 React 独有的坑，但 store 库让「忘记」变得更容易。
7. **所有状态都往全局 store 里塞。** 现象：一个 `useForm` 的每个 keystroke 都触发全局更新，或 store 里有 60 个字段、没人知道谁在用。原因：把「共享」当成了默认，而正确的默认是「局部」。怎么确认：搜每个 state 字段的消费者数量。怎么修：派生值别存（能算出来的不要 setState，见[第 5 章](/react/use-effect)清单）；表单草稿留组件内；只有「多页面共享 + 需被外部更新」的才进 store。
8. **忘记给 React 的行组件做订阅边界，改一条数据整个列表 200 行重渲染。** 现象：Profiler 显示 200 个行组件都执行。原因：列表 state 只有一个 selector 选了整个数组，每行都从父级 props 拿到新元素。怎么确认：第 7 章的 Profiler 流程。怎么修：行组件 `memo` + 每行自己的 selector（`useTodos((s) => s.items.find(...))` 注意 `find` 返回的是稳定元素引用，配合不可变更新可用），或把行数据作为 prop 传下去并保持元素引用不变。

## 练习

<Exercise title="练习 1 · 判断每个 selector 会不会导致多余更新" difficulty="基础">

给定 store 形状 `{ items: Todo[], filter: 'all', add(t): void }`。下面四个 selector，哪些在 `filter` 从 `'all'` 变成 `'done'` 时会触发组件更新？在 `items` 数组被 `toggle` 重建（只换被改那一项引用）时呢？

```tsx
A: useTodos((s) => s.filter)
B: useTodos((s) => s.items)
C: useTodos((s) => s.items.length)
D: useTodos((s) => ({ items: s.items, filter: s.filter }))
```

<template #answer>

| 变化 | A | B | C | D |
| --- | --- | --- | --- | --- |
| `filter` 变 | **更新**（值真的变了，正确） | 不更新 | 不更新 | **更新**（新对象，必不等） |
| `toggle` 某一项 | 不更新 | **更新**（数组是新引用） | 不更新（长度是同一个 number） | **更新**（新对象） |

要点：D 是纯粹的错误写法——它订阅的是「一个每轮都新建的容器」，两次变化都触发更新，而组件其实只用到一半。改成两个 selector（A + B）就是正确粒度。C 是这里最漂亮的一个：`length` 是原始值，勾掉一项不会让它更新。注意 D 的行为**依赖具体版本的比较方式**，所以别赌；A/B/C 这类「只返回一个原始值或一个已有引用」的写法在任何版本都成立。

</template>

</Exercise>

<Exercise title="练习 2 · 把 Pinia store 改写成 Zustand 并指出语义陷阱" difficulty="进阶">

```ts
export const useCartStore = defineStore('cart', {
  state: () => ({ lines: [] as Line[], coupon: null as string | null }),
  getters: {
    total: (s) => s.lines.reduce((sum, l) => sum + l.price * l.qty, 0),
    count: (s) => s.lines.reduce((n, l) => n + l.qty, 0),
  },
  actions: {
    add(line: Line) { this.lines.push(line); },
    applyCoupon(code: string) { this.coupon = code; },
  },
});
```

写出 Zustand 版，并说明 `total` 这个 getter 在 React 侧的正确落点。

<template #answer>

```tsx
type CartState = { lines: Line[]; coupon: string | null; add: (l: Line) => void; applyCoupon: (c: string) => void };

const useCart = create<CartState>()((set) => ({
  lines: [],
  coupon: null,
  add: (line) => set((s) => ({ lines: [...s.lines, line] })),          // 不能 push 旧数组
  applyCoupon: (coupon) => set({ coupon }),
}));

// total 的正确落点 1：在组件里用 selector 选稳定输入 + useMemo
const lines = useCart((s) => s.lines);
const total = useMemo(() => lines.reduce((sum, l) => sum + l.price * l.qty, 0), [lines]);

// 落点 2：把纯函数放 store 外面，谁用谁调（可单测、不订阅）
export const cartTotal = (lines: Line[]) => lines.reduce((s, l) => s + l.price * l.qty, 0);
```

三个陷阱：① **`add` 里不能 `state.lines.push(line)` 后 `set({ lines: state.lines })`**——同一引用，不更新（Vue 里 `this.lines.push` 完全合法，这就是最容易带过来的坏习惯）。② **`total` 不能写成 `useCart((s) => s.lines.reduce(...))`**：它返回 number，比较有效，不会导致无限循环，但它在**每个订阅组件每次渲染时都重新算一遍**，且 `count`/`total` 各算各的。派生逻辑要么放组件里用 `useMemo`，要么放 store 外的纯函数，要么用记忆化 selector（RTK 的 `createSelector`；Zustand 需要自己缓存）。Pinia 的 getter 是 `computed`——**自动缓存、多个组件共用同一份结果、依赖不变就不重算**，React 侧没有这个免费层，这是两个生态在派生数据上最实际的体感差别。③ Pinia 的 action 可以通过 `this.$patch` 批量提交、`$subscribe` 订阅；Zustand 侧同理用 `subscribe`，但要清楚它订阅的是整个 store 而不是某个属性。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释报错" difficulty="挑战">

一位从 Vue 迁移的工程师写了下面的代码，症状三条：输入筛选关键词时整站抖；控制台出现与快照缓存相关的警告并有 `Maximum update depth exceeded`；`已完成` 数字偶尔不更新。逐条对应到原因并修。

```tsx
const useApp = create((set) => ({
  todos: [],
  keyword: '',
  setKeyword: (k) => set({ keyword: k }),
}));

function FilterPanel() {
  const snap = useApp((s) => ({ todos: s.todos, keyword: s.keyword }));
  const [local, setLocal] = useState(snap.keyword);
  const done = snap.todos.filter((t) => t.done).length;
  const [doneCount, setDoneCount] = useState(0);

  useEffect(() => { setDoneCount(snap.todos.filter((t) => t.done).length); }, [snap]);

  return <input value={local} onChange={(e) => { setLocal(e.target.value); snap.setKeyword?.(e.target.value); }} />;
}
```

<template #answer>

1. **`Maximum update depth exceeded` + 快照警告 → selector 返回新对象。** `useApp((s) => ({ todos, keyword }))` 每轮返回新的 `{}`，`Object.is` 永不相等 → 每次渲染都判定「订阅到了新快照」→ 再渲染。修法：`const todos = useApp((s) => s.todos); const keyword = useApp((s) => s.keyword);`（顺带，`snap.setKeyword` 根本不在 selector 返回值里，那行 `snap.setKeyword?.(...)` 永远什么都不做——静默失效，`?.` 把 bug 吃掉了，这是可选链的危险用法）。
2. **整站抖 → 把每次键入都变的 `keyword` 放进了全局 store，而消费者很多。** 即使修好 selector，`keyword` 一变所有订阅它的组件都更新，这本身没错；错在「搜索关键词」通常是单页面局部状态，且输入框已有本地 state（`local`），现在是一份数据两个来源。修法：URL/局部 state 承载关键词，store 只放需要跨页面的业务数据；确实要全局，就用防抖 + 只在结果面板订阅。
3. **`doneCount` 数字不更新 → 用 effect 把派生值同步进 state。** `done` 已经是当场算出来的，`setDoneCount` 又绕了一圈：`useEffect` 在提交后执行，多一次渲染；而它的依赖是 `snap`（每轮都变，靠这个「碰巧」更新），一旦你修好第 1 条让 `snap` 稳定，它反而不更新了——**两个 bug 互相掩盖**，这是这类代码最难查的地方。修法：删掉 `useEffect` 和 `doneCount`，直接用 `const done = todos.filter((t) => t.done).length`（需要缓存就 `useMemo`，依赖 `[todos]`）。
4. 补两条结构问题：`todos: []` 没有类型（在 TS 里会被推成 `never[]`，之后 `set` 进去任何项都报错）；`useApp` 命名带 `use` 前缀是合理的（它确实是 Hook），但 `create` 出来的 store 类型应显式声明，否则 selector 的 `s` 是 `any`，本章所有比较语义的约束都失去编译器保护。

这道题的核心教训：**React 的状态库不会替你发现「引用不稳定」，也不会替你发现「派生值被存成 state」。** 它只保证一件事：你返回什么，它就按引用比较什么。

</template>

</Exercise>

<Exercise title="练习 4 · 为一个真实项目选型" difficulty="进阶">

一个内部工具：登录 + 角色权限、一个 500 行的数据表格（可筛选、可排序、行内编辑）、三个详情页共享同一份列表数据、需要「谁在什么时候改了什么」的可追溯性、团队三人都是 Vue 背景。给出你的状态管理方案并说明每个决策对应本章哪条判据。

<template #answer>

参考方案（本站口径，重点是理由不是结论）：

- **列表/详情数据 → 服务端状态层（TanStack Query）而不是 store。** 判据：数据权威在服务器、会过期、需要缓存与失效——那四条表格里全归服务端状态。三个详情页共享同一份列表结果，正是 `queryKey` 缓存要解决的场景，写进 store 反而要自己实现去重和失效。行内编辑用 mutation + 精确失效 + 可选乐观更新。
- **表格 UI 状态（筛选/排序/列宽）→ 组件内 state + URL 同步。** 判据：消费者只有这一页；放全局会让每次键入触发 store 广播（第 6 章「变化频率 × 消费者数量」判据）。筛选条件写进查询串是为了可分享/可刷新复现（[第 8 章](/react/router)的 loader 正好能从 URL 读）。
- **鉴权身份与角色 → 一个小 store（Zustand）或 Context。** 变化极少（登录一次、登出一次），多分支消费 → Context 合格；但它需要在路由 loader 和请求拦截器里被读取（**组件外读写**），而 Context 的 value 只能在渲染期更新，这一条把天平推向 Zustand。
- **可追溯性 → Redux Toolkit。** 需求里「谁在什么时候改了什么」是 action 审计，正是 Redux Devtools 的时间旅行与 action 列表最强的部分；Zustand 也能记，但要自己实现日志。代价是模板代码与 selector 纪律，团队是 Vue 背景时要额外培训「不可变更新 + selector 粒度」这两条（本章第 2、5 条故障）。
- **组合建议：** 如果不做重审计需求，本站更推荐 Zustand + TanStack Query（心智负担最低，Pinia 迁过来最顺手）；只有「审计 + 复杂异步 + 多人协作」三项同时成立才上 Redux Toolkit。

同时要写清楚**不选**的：不用 Context 承载业务集合（第 1、3 条故障）、不把服务端数据塞进 store 手搓缓存（第 4 条故障）、不为了「统一管理」把表单 state 提升到全局（第 7 条故障）。

</template>

</Exercise>

<Exercise title="练习 5 · 对照三家 store 的重渲染范围" difficulty="基础">

同一个动作：`filter` 从 `'all'` 变成 `'done'`。三种实现里各有几个组件更新？① Pinia：组件 A 模板里只读 `store.filter`，组件 B 只读 `store.visible`（getter 依赖 `items` 和 `filter`）；② Context：value 是 `{ items, filter }` 的对象，A、B 都 `useContext`；③ Zustand：A 用 `useTodos((s) => s.filter)`，B 用 `useTodos(selectVisible)`，`selectVisible` 是记忆化 selector。

<template #answer>

① **A 更新；B 也更新**（`visible` 的输入依赖里有 `filter`，getter 重算，读它的组件唤醒）。但只有「真的读了这两处」的组件更新——没读 `filter` 也没读 `visible` 的组件完全不参与。
② **A 和 B 都更新，另外所有 `useContext` 该 Context 的第三个、第四个组件也全部更新**，不管它们读的是 `items` 还是 `filter` 还是别的字段——因为 value 整体是新对象，`Object.is` 不等，`memo` 挡不住。这就是 Context 不能当状态管理库的机制解释。
③ **A 更新（值真的变了）；B 只有在 `selectVisible` 的结果引用变化时才更新**——filter 变了通常意味着可见列表变了，所以 B 也更新，但如果 B 选的是 `(s) => s.items.length` 这类不受影响的原始值，它就不更新。**第三个只订阅 `items` 的组件在 ③ 里不更新，在 ② 里更新。**

结论一句话：②的更新范围 = 「Provider 的 value 变了，所有消费者」；①和③的更新范围 = 「谁的订阅结果真的变了」。Pinia 靠框架的依赖追踪算出这个集合，Zustand/Redux 靠你写的 selector 声明这个集合。**前者更省心，后者更明确且可测**（你能直接读代码说出「这个组件订阅什么」），这也是 React 生态里 selector 无处不在的原因。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Redux 官方文档 · 核心概念](https://redux.js.org/introduction/core-concepts)、[Redux Toolkit `createSlice`](https://redux.js.org/introduction/getting-started) —— 核实：action / reducer / store 三元结构与「state 必须不可变更新」这条纪律；`createSlice` 的 reducer 允许写「看起来可变」的语法（内部 Immer）；`useSelector` 的订阅与比较语义。**本章未逐字核实这些页的当前措辞，请以页面为准。**
- [React Redux 入门](https://react-redux.js.org/introduction/getting-started) —— 核实「`useSelector` 每次 store 更新都会执行 selector，返回值用引用比较，返回新对象会导致多余重渲染」，对应本章第 1 条故障与练习 1。
- [Zustand 官方文档](https://zustand.docs.pmnd.rs/) —— 核实：`create` 的形状、selector 订阅、中间件（`persist` / `devtools` / `immer`）、以及 shallow 比较工具在当前版本的确切名称与导入路径（**本章 selector 兜底行为一条标为 unverified，正是要以此页为据**；直接给深层 slug 的路径不可靠，请从主入口进入）。
- [TanStack Query](https://tanstack.com/query/latest) —— 核实服务端状态的六件事（缓存 key、请求去重、stale 判定、失效、重试、竞态处理），支撑「服务端状态不要塞进全局 store」一节。
- [`useSyncExternalStore` 参考](https://react.dev/reference/react/useSyncExternalStore) —— 核实「订阅外部数据源」的定位与 `getSnapshot` 的稳定性要求（含 SSR 下的第三个参数），这是本章机制拆解的依据。
- [`createContext` / `useContext` 参考](https://react.dev/reference/react/useContext) —— 已核实（第 7 章同批）：value 用 `Object.is` 比较、消费者全体重渲染、`memo` 不能阻挡。用于本章「Context 三条分界」。
- [用 Reducer 和 Context 进行扩展](https://react.dev/learn/scaling-up-with-reducer-and-context) —— 核实「Context + reducer 是官方认可的中等规模共享状态方案」，避免把本章「Context 不当 store」误读成「Context 不能放状态」。
- [Vue Pinia 官方文档（中文）](https://pinia.vuejs.org/zh/) —— 核实：state 是响应式对象、`getters` 基于 `computed`（缓存与惰性）、action 里可直接改 state、`storeToRefs` 存在的理由、`$patch` / `$subscribe` / `$reset`。主入口即可导航到这些章节，建议别用深层 slug。
- 站内相关：[Context 与 provide / inject](/react/context)、[重渲染机制与性能](/react/re-render-performance)、[useState / useReducer 与不可变更新](/react/state)、[useEffect 与 watch 的对照](/react/use-effect)、[React Router 与 Vue Router 对照](/react/router)、[Pinia 状态管理](/vue/pinia)、[组合式 API 与 composables](/vue/composables)、[计算属性与侦听器](/vue/computed-and-watch)。

## 下一章

到这里，React 的三个共享层已经对齐完毕：往下传用 props（[第 4 章](/react/props-and-children)），跨层级穿透用 Context（[第 6 章](/react/context)），集中管理 + 细粒度订阅用 store（本章）。三条线共同的遗留问题是——**它们全都假设「数据变了要重新渲染」。** 但有两类东西恰恰不希望触发渲染：输入框里正在编辑但还没提交的草稿、需要直接操作的 DOM 节点（聚焦、滚动、第三方组件挂载点），以及「这次交互我要知道，但我不想为此重渲染」的可变盒子。Vue 侧对应的是模板引用和 `v-model`（[第 7 章生命周期与模板引用](/vue/lifecycle-and-inject)、[第 5 章组件基础](/vue/components)），而 React 侧把它们拆成了 `useRef` 加一套「受控组件」写法，并且多出了一个 Vue 里没有的选择：**非受控表单**。下一章 [useRef 与受控组件](/react/refs-and-forms) 讲清 `useRef` 为什么不能当 `ref` 用、受控与非受控各在什么场景赢，以及 `v-model` 的双向语法在 React 里为什么要手写两行。
