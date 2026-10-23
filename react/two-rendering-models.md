# 两套渲染模型：Vue 通知依赖，React 重跑函数

你在 [Vue 阶段项目](/vue/project) 里写过 `todos.value.push(newTodo)`，界面立刻多一行。把同样的写法搬进 React：`todos.push(newTodo)`。数组确实多了一项，`console.log` 打印出正确长度，**界面纹丝不动**。

这不是你漏写了什么 API，是两个框架对「状态到界面」这段路的做法根本不同：

| | Vue 3 | React（函数组件 + Hooks） |
| --- | --- | --- |
| 你声明的状态 | **可变的响应式盒子**（`Proxy` 包住对象/数组） | 一个**值**，渲染那一刻的快照 |
| 怎么改 | 赋值、`push`、`splice` 都行 | 只能调 setter，传入新值 |
| 谁被通知更新 | 依赖收集算出「哪些组件读过这块数据」 | 没人被通知——**这个组件函数整个重新执行一遍** |
| 你的逻辑跑几次 | setup 只跑一次，render 按依赖重跑 | 每次 state 变化，整个函数体重跑 |
| DOM 层面靠什么 | 虚拟节点 diff + 编译期静态提升 | 虚拟节点 diff |

最后一行容易被误解，先把话说准：**两边在 DOM 层面都靠虚拟节点 diff**，Vue 并不是「只改那一个文本节点」的魔法。真正的差异在 diff **之前**：Vue 的响应式知道「这条数据被谁读过」，只让相关组件重跑 render；React 完全不知道依赖关系，策略是「你调了 setter，这个组件就得重新算，子组件默认跟着算」。

**这是本领域的地基。** `useState` 的快照语义、`useEffect` 的依赖数组、`memo` 与引用稳定性、Context 让消费者全体重渲染，全都是这一条推导出来的结果。

## 同一个待办列表：两边完整代码

功能一致：添加、勾选完成、删除、按状态筛选、显示剩余项数。

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'

type Todo = { id: number; text: string; done: boolean }

const todos = ref<Todo[]>([])
const draft = ref('')
const filter = ref<'all' | 'active'>('all')

function add() {
  const text = draft.value.trim()
  if (!text) return
  todos.value.push({ id: Date.now(), text, done: false })
  draft.value = ''
}

function toggle(todo: Todo) {
  todo.done = !todo.done
}

function remove(id: number) {
  const i = todos.value.findIndex((t) => t.id === id)
  if (i !== -1) todos.value.splice(i, 1)
}

const visible = computed(() =>
  filter.value === 'all' ? todos.value : todos.value.filter((t) => !t.done)
)
const remaining = computed(() => todos.value.filter((t) => !t.done).length)
</script>

<template>
  <section class="todos">
    <input v-model="draft" placeholder="要做什么" />
    <button @click="add">添加</button>

    <ul>
      <li v-for="todo in visible" :key="todo.id">
        <label>
          <input type="checkbox" :checked="todo.done" @change="toggle(todo)" />
          {{ todo.text }}
        </label>
        <button @click="remove(todo.id)">删除</button>
      </li>
    </ul>

    <p>还剩 {{ remaining }} 项</p>
  </section>
</template>
```

```tsx
import { useState } from 'react'

type Todo = { id: number; text: string; done: boolean }

export default function Todos() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState<'all' | 'active'>('all')

  function add() {
    const text = draft.trim()
    if (!text) return
    setTodos((old) => [...old, { id: Date.now(), text, done: false }])
    setDraft('')
  }

  function toggle(id: number) {
    setTodos((old) =>
      old.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    )
  }

  function remove(id: number) {
    setTodos((old) => old.filter((t) => t.id !== id))
  }

  const visible = filter === 'all' ? todos : todos.filter((t) => !t.done)
  const remaining = todos.filter((t) => !t.done).length

  return (
    <section className="todos">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="要做什么"
      />
      <button onClick={add}>添加</button>

      <ul>
        {visible.map((todo) => (
          <li key={todo.id}>
            <label>
              <input
                type="checkbox"
                checked={todo.done}
                onChange={() => toggle(todo.id)}
              />
              {todo.text}
            </label>
            <button onClick={() => remove(todo.id)}>删除</button>
          </li>
        ))}
      </ul>

      <p>还剩 {remaining} 项</p>
    </section>
  )
}
```

### 逐行标注差异

| 位置 | Vue | React | 差异的性质 |
| --- | --- | --- | --- |
| 状态声明 | `ref<Todo[]>([])` | `useState<Todo[]>([])` | 左边拿到响应式代理，右边拿到**本次渲染的值** + 一个调度函数。名字像，语义不同。 |
| 添加一项 | `todos.value.push(x)` | `setTodos(old => [...old, x])` | **全表最重要的一行。** 左边改内容器框架自己知道；右边必须换掉容器，引用没变就等于「没变化」。 |
| 勾选完成 | `todo.done = !todo.done` | `map` + `{ ...t, done: !t.done }` | Vue 的 `ref` 深层代理，改属性就触发更新；React 的对象只读，改属性是在破坏快照。 |
| 派生数据 | `computed(() => ...)` | 函数体里一行普通表达式 | Vue 有缓存且精确通知订阅者；React 的表达式**每次渲染都重算**，要缓存得换 `useMemo`，而它不保证缓存。 |
| 输入绑定 | `v-model="draft"` | `value` + `onChange` | 一行语法糖 vs 明确的「读 state + 写 state」（受控组件，第 10 章）。 |
| 列表 / 事件参数 | `v-for` + `:key`、`@change="toggle(todo)"` | `map` + `key=`、`onChange={() => toggle(todo.id)}` | 指令变成 JS；模板里由编译器包装的闭包，在 React 里你手写，**每次渲染新建一个函数**（第 7 章）。`key` 的语义两边一致。 |
| 代码的位置 | `<script setup>` 里 | 组件函数里 | **setup 只执行一次，React 的函数体每次渲染执行一次。** 全表所有差异都能追溯到这一行。 |

## 组件函数的执行时机：所有 React 坑的根源

Vue 的 `setup`（或选项式的 `data`）**只在组件实例创建时执行一次**：里面的 `computed(...)`、普通变量和函数都只创建一次，之后按依赖重算、被长期持有。React 函数组件没有「实例创建」这个概念，它就是一个普通函数：

```tsx
function Counter() {
  const [count, setCount] = useState(0)
  const doubled = count * 2
  console.log('渲染了，count =', count)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

点一次按钮，`Counter` **整个函数从头到尾重新执行**：`useState` 再调一次（返回 React 内部存的当前值而不是初始值 `0`），`doubled` 重算，箭头函数重新创建，`console.log` 再打印。**两次渲染是两次完全独立的调用**，除了 React 按调用顺序保存的那份状态，两者不共享任何东西。

直接后果：**函数里任何变量都是这一次渲染的快照**，闭包捕获的是它被创建那一版的值。这就是 [函数、作用域、闭包与 this](/javascript/functions-and-scope) 讲的闭包规则在 React 里第一次大规模咬人。

```tsx
function Counter() {
  const [count, setCount] = useState(0)

  function handleClick() {
    setCount(count + 1)
    setTimeout(() => {
      alert(count)
    }, 3000)
  }

  return <button onClick={handleClick}>{count}</button>
}
```

预期结果：3 秒后 `alert` 弹出 **0**，而界面显示 1。因为这次渲染里 `count` 被固定为 `0`，`setTimeout` 的回调闭包捕获的就是这个 `0`。这不是异步时序问题，是闭包问题。依据是官方的 [State 如同快照](https://react.dev/learn/state-as-a-snapshot)（核实时间 2026-10-17）。

**Vue 里你几乎遇不到这个坑**——`count.value` 每次读取都穿过 Proxy 拿到当前值，而不是读一个渲染快照。这是本领域第一条「必须推翻」的直觉。

## 渲染 → 提交 → 副作用：三阶段

[渲染与提交](https://react.dev/learn/render-and-commit) 把一次更新分成三步（核实时间 2026-10-17）：

| 阶段 | 干什么 | 能碰 DOM 吗 |
| --- | --- | --- |
| 触发 Triggering | 初始挂载调 `root.render()`；更新时调 setter | 否 |
| 渲染 Rendering | **调用你的组件函数**，递归算出节点树并与上次比较得出改动清单。官方强调这是纯计算 | 否 |
| 提交 Committing | 按清单修改真实 DOM；官方原话「React 只在两次渲染有差异时才改 DOM 节点」 | 是 |
| 副作用 Effects | 提交之后执行 `useEffect`；该页另指出浏览器随后重绘 | 是 |

Vue 侧对应：改响应式数据 → 更新任务进队列（微任务 flush）→ 依赖它的组件 render effect 重跑 → diff → 打补丁 → `nextTick` 里读到新 DOM。两边都是「先算再改再同步」，**区别只在触发条件**：Vue 是「依赖变了的那些组件」，React 是「你调了 setter 的那个组件（默认连带子组件）」。

<Callout type="unverified" title="并发渲染的细节本站不展开">

「渲染可以被中断、丢弃后重算」「某些更新优先级更低」这类说法，我没有从官方页面逐条核实（上面那一页只给了线性的三步流程），因此不作为结论给出；读者请自行读 [react.dev 的 learn 主线](https://react.dev/learn)，第 7 章讨论 `useTransition` 与 `useDeferredValue` 时会重新核实。这里只需要一句：**渲染 ≠ 提交，组件函数跑了一次不代表界面上一定看到那一次的结果。**

</Callout>

## 哪些 Vue 直觉可以直搬

- **单向数据流。** 父传子、子通过回调通知父，方向完全一致。React 没有 `emit`，但纪律是同一条（[第 4 章](/react/props-and-children)）。
- **组件拆分。** 「一个组件干一件事」的标准通用；React 里拆分还能缩小 `memo` 可控的重渲染范围（第 7 章）。
- **props 只读。** Vue 改 props 会告警，React 改 props **不会**——它就是普通对象，没有运行时守卫。规则一样，只是没人替你查。
- **`key` 的必要性。** [渲染列表](https://react.dev/learn/rendering-lists) 明确写着「直接写在 `map()` 里的 JSX 元素一定要有 key」，结论与 Vue 相同：**索引当 key 是坑**（官方原话 index as a key often leads to subtle and confusing bugs），也不要临时生成 key。同样，**`key` 不作为 prop 传进组件**，需要 ID 就另传一个 prop。

## 哪些直觉必须推翻

1. **`v-if` / `v-for` 不是指令。** 条件渲染是三元、`&&` 或提前 `return`；列表是 `map`。能用全部 JS，代价是模板那套「结构化提示」消失（[第 2 章](/react/jsx)）。
2. **`computed` ≠ `useMemo`。** 官方 [useMemo 参考页](https://react.dev/reference/react/useMemo) 的原话是「它是性能优化而非语义保证，React 可能丢弃缓存值」，并列出会丢弃的场景（开发环境下编辑该组件的文件、组件在首次挂载期间 suspend），还预告未来会更多。所以**不能靠 `useMemo` 保证「只算一次」**；Vue 的 `computed` 是语义层保证。
3. **`watch` ≠ `useEffect`。** `watch` 是「数据变了跑段逻辑」，`useEffect` 表达的是「与外部系统同步」，有依赖数组、有清理、语义是「每次渲染后都可能重跑」。用 `watch` 思维写 effect 是本领域最贵的错，[第 5 章](/react/use-effect) 整章处理。
4. **模板 ref ≠ `useRef`。** Vue 的模板 ref 主要用来拿实例并调用它；React 的 `useRef` 首先是一个**跨渲染存活、改它不触发渲染的可变盒子**，而且不要在一次渲染过程中读写 `ref.current`（[第 10 章](/react/refs-and-forms)）。
5. **「改了就更新」完全不成立。** React 用 `Object.is` 比较新旧值：**判定为同一个值时直接跳过这个组件及其子树的重渲染**（[useState 参考页](https://react.dev/reference/react/useState)，核实时间 2026-10-17）。你 `push` 后传回同一个数组，等于什么都没发生。第 3 章整章讲这条规则。

## 对照法的失效场景

**`StrictMode` 的双调用在 Vue 里没有对应物。** [StrictMode 参考页](https://react.dev/reference/react/StrictMode) 列出开发环境被故意调用两次的东西：组件函数体（只顶层逻辑，事件处理器内的代码不算）、传给 `useState` 的函数、setter、`useMemo` 的计算函数、`useReducer` 的 reducer；另外**每个 Effect 与每个 callback ref 额外跑一遍 setup + cleanup**。Vue 没有「把 setup 跑两遍帮你找 bug」这种机制，别把它理解成 bug 或性能损耗，也别为了控制台干净就关掉它（第 11 章展开）。

**Server Components 在 Vue 生态里没有对应概念。** 「组件在服务器渲染、不进客户端 bundle、不能拥有 state」这一整套不是换了名字的 Vue 特性，本站只做概念性介绍，见 [第 11 章](/react/react-only)。**Hooks 的规则同理**：组合式 API 可以写在 `if` 里、循环里，React 的 Hook **必须写在组件函数顶层**，因为 React 靠调用顺序识别「第几个 state 属于哪个变量」。

**性能优化方向相反。** Vue 的性能问题通常是追踪范围太大（该用 `shallowRef` 没用），React 的是引用不稳定与状态放得太高。**一边要「少追踪」，一边要「多稳定」**，不能照搬（对照 [Vue 渲染性能](/vue/rendering-performance)）。

## 生态碎片化与选型意识

Vue 生态几乎单选，React 不是：

| 问题 | Vue 生态默认 | React 生态常见选项 | 本站立场 |
| --- | --- | --- | --- |
| 构建 | Vite | Vite、Next、Rsbuild、webpack 存量 | 用 Vite，与 Vue 侧一致，见 [Vite 开发侧](/frontend-engineering/vite-dev) |
| 路由 | Vue Router | React Router、TanStack Router 等 | 讲 React Router，结论以官方文档当前版本为准（[第 8 章](/react/router)） |
| 客户端状态 | Pinia | Redux Toolkit、Zustand、Jotai、Context | 先局部 state，确实需要再选库（[第 9 章](/react/state-management)） |
| 服务端状态 | 手写 composable | TanStack Query 等 | 第 9 章讲「服务端状态要单独看待」 |

这张表的用途不是让你逐个试，而是提醒：**「React 项目怎么写」没有唯一答案，你看到的教程都可能只代表作者的选型。** 遇到「这库为什么这么用」的疑问，先分辨它属于生态选型还是 React 本身的规定——前者可以换，后者不能违反。
## 版本口径

本领域全部使用**函数组件 + Hooks，不讲类组件**（`this.setState`、`componentDidMount` 一类请查旧版文档站点）。**React 具体版本号本站不写死**：我核实时 [react.dev/versions](https://react.dev/versions) 列出的最新稳定版是 19.3（v19.3.0，2026-09-09），这个数字只说明「官方文档现在讲的是哪一版」，动手前自己核对。本章结论建立在 Hooks 模型上，其语义自引入以来稳定。

<Callout type="warn" title="本章 React 代码没有在本机运行过">

本站 React 示例是为对照讲解写的，我没有在本任务里创建 React 项目执行它们，因此**任何地方都不声称「已运行验证」**；所有行为结论都来自官方文档（核实时间 2026-10-17）。你按 [学习方法](/react/) 用 `npm create vite@latest` 建一个 React + TypeScript 项目，把上面两段待办代码各跑一遍，在 `add()` 里加日志，亲眼看函数体反复执行——比读十遍都有效。

</Callout>

## 常见错误与排查

**1. 现象：`push` 后数组变长了，界面不变。** 原因：引用没变，`Object.is` 相等，React 跳过重渲染。确认：`console.log(next === prev)` 打 `true`，Profiler 里该组件没有渲染记录。修：换成新容器——`[...old, x]`、`old.map(...)`、`old.filter(...)`。

**2. 现象：`setCount(count + 1)` 连调三次只加 1。** 原因：三次里的 `count` 都是本次快照，批处理让最后一笔生效。确认：中间 `console.log(count)` 三次输出相同。修：函数式更新 `setCount(c => c + 1)`——[官方页面](https://react.dev/learn/queueing-a-series-of-state-updates) 直接给的修法。

**3. 现象：`alert` 或埋点里的 state 是旧值，界面是对的。** 原因：闭包捕获渲染快照。确认：与 React DevTools 显示的当前 state 对比。修：能用函数式更新就用；需要「不触发渲染的最新值」时考虑 ref（第 10 章）。

**4. 现象：渲染函数里直接调 setter，白屏并报 Maximum update depth exceeded。** 原因：渲染 → 更新 → 渲染 的死循环。确认：Profiler 里渲染次数暴涨。修：更新只能由事件或 effect 触发；如果本意是「数据变了就同步一份 state」，先读第 5 章的「你可能不需要 effect」清单——多数情况应改成派生表达式。

**5. 现象：控制台出现「Cannot update a component while rendering a different component」。** 原因：在 A 组件渲染期间调了 B 组件的 setter（警告文案会点名两个组件）。修：挪进事件回调或 effect；跨组件状态上移到共同父组件或用 Context（[第 6 章](/react/context)）。

**6. 现象：加了 `useMemo`，被包的组件还是每次都重渲染。** 原因：概念混层——`useMemo` 缓存**值的计算**，`memo` 才阻止组件重渲染，`useCallback` 缓存函数，而 `memo` 又会被每次新建的对象/字面量废掉。确认：DevTools 勾选「高亮更新原因」看 props 引用。修：见第 7 章引用稳定性。

**7. 现象：列表中间插入一项后各行输入框内容错位。** 原因：`key` 用了索引，插入后索引与内容不再对应，React 把 state 和 DOM 复用到错误的行。确认：换成稳定 ID 后错位消失。修：`key={item.id}`——Vue 里同一修法，这条直觉直搬。

**8. 现象：`StrictMode` 下请求发两次、计数加两遍，以为 React 有 bug。** 原因：开发环境故意多跑一遍 setup + cleanup。确认：仅诊断时临时去掉 `<StrictMode>` 包裹（不要提交），重复消失。修：给 effect 写清理、请求加取消或忽略旧结果的判断（第 5 章、第 11 章各讲一半）。

## 练习

<Exercise title="练习 1 · 数一数函数被调了几次" difficulty="基础">

初始渲染一次后，用户点击按钮一次。`Log` 被调用几次？每次 `n` 是什么？`console.log` 输出几行？

```tsx
function Log() {
  const [n, setN] = useState(0)
  console.log('Log 执行，n =', n)
  return <button onClick={() => setN(n + 1)}>{n}</button>
}
```

<template #answer>

**2 次**：初始渲染（`n = 0`）与 `setN(1)` 之后的重渲染（`n = 1`），`console.log` 相应输出两行。

如果外层挂着 `StrictMode`，开发环境在首次挂载会把组件函数体**调用两遍**（官方把它列在双调用范围内），你会看到三行输出、`n = 0` 出现两次。这是刻意的 bug 检测，不等于渲染了三次界面。

关键点：**「函数被调用」不等于「DOM 被改」**。渲染阶段只算节点树，提交阶段才动 DOM。

</template>

</Exercise>

<Exercise title="练习 2 · 把这段 Vue 代码改写成 React 并指出行为差异" difficulty="进阶">

```vue
<script setup lang="ts">
import { computed, reactive } from 'vue'

const rows = reactive([
  { id: 1, text: '写周报', done: false },
  { id: 2, text: '修 bug', done: true }
])

const doneCount = computed(() => rows.filter((r) => r.done).length)

function toggle(id: number) {
  const row = rows.find((r) => r.id === id)
  if (row) row.done = !row.done
}
</script>

<template>
  <p>{{ doneCount }} 项已完成</p>
  <ul>
    <li v-for="r in rows" :key="r.id">
      <button @click="toggle(r.id)">{{ r.text }}</button>
    </li>
  </ul>
</template>
```

改写它，并回答：（a）改完之后 `doneCount` 的计算时机和 Vue 的 `computed` 有什么不同？（b）`toggle` 为什么在 Vue 里生效、照搬进 React 不生效？

<template #answer>

```tsx
import { useState } from 'react'

type Row = { id: number; text: string; done: boolean }

export default function Rows() {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, text: '写周报', done: false },
    { id: 2, text: '修 bug', done: true }
  ])

  function toggle(id: number) {
    setRows((old) => old.map((r) => (r.id === id ? { ...r, done: !r.done } : r)))
  }

  const doneCount = rows.filter((r) => r.done).length

  return (
    <>
      <p>{doneCount} 项已完成</p>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <button onClick={() => toggle(r.id)}>{r.text}</button>
          </li>
        ))}
      </ul>
    </>
  )
}
```

（a）Vue 的 `computed` 建立了依赖关系**并有缓存**：`rows` 没变时读它不重算。React 版本里 `const doneCount = rows.filter(...)` 是函数体里一行普通代码，**每次渲染必然重算**。想缓存要 `useMemo`，而它不保证缓存；这里只有一行 `filter`，加 `useMemo` 属于过度优化。另外注意我用了 Fragment 包住两个顶层元素——JSX 要求单一根（第 2 章）。

（b）Vue 里 `row.done = !row.done` 生效，因为 `reactive` 把数组和元素对象都包成了 `Proxy`，属性写入被依赖追踪捕获。原样搬进 React 时**界面不更新**：数组引用没变、那个元素对象的引用也没变，`Object.is` 判定相等，React 跳过重渲染；而且你永久破坏了这份快照，之后每次渲染读到的都是被你偷偷改掉的对象。React 的修法是用 `map` 重建数组，并给变化的那一项**重建一个新对象**——只换数组不换元素对象同样不够，因为 `memo` 过的子组件比的正是元素引用。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释现象" difficulty="进阶">

`list` 是数组 state，`items` 是对象 state。逐段预测界面会不会变，并说明依据。

```tsx
list.push({ id: 3 })
setList(list)

setList((old) => {
  old.push({ id: 3 })
  return old
})

items.ready = true
setItems(items)
```

<template #answer>

三段都**不会**正确更新界面。

1. `push` 后 `setList(list)`：传入同一个引用，`Object.is` 相等 → 跳过重渲染。而且你已经就地污染了快照，之后某次别的更新触发渲染时，这一项会「莫名冒出来」。
2. 函数式更新里 `old.push(...)` 再 `return old`：仍然返回同一个引用，等于没换容器，同时改掉了 React 内部持有的状态。**这是重灾区**——「用了函数式更新所以很安全」的错觉最害人。正确写法 `setList(old => [...old, { id: 3 }])`。
3. 先改 `items.ready` 再 `setItems(items)`：传的是被改过的旧引用，判定相等不重渲染。正确写法 `setItems(old => ({ ...old, ready: true }))`。

依据都是同一条：React 用引用比较决定是否重新渲染，所以**「换一个新容器」是你的义务，不是可选优化**。（`items` 这种多字段联动的状态更适合 `useReducer`，第 3 章讲。）

</template>

</Exercise>

<Exercise title="练习 4 · 判断哪些直觉能搬过来" difficulty="基础">

逐条回答「能搬 / 不能搬」并各给一句理由：

1. 状态放在用到它的最低层组件。
2. 深层嵌套对象的属性变化能自动触发更新。
3. 「改完数据在 `nextTick` 里读 DOM」这个习惯。
4. `key` 用来稳定列表项的身份。
5. 派生值不该复制一份存进 state。
6. 在组件里改 props 让父组件更新。

<template #answer>

1. **能搬。** 位置判断的标准两边一致，第 3 章按 React 写法具体化。
2. **不能搬。** React 没有任何深层追踪，必须一路重建：`setPerson({ ...person, artwork: { ...person.artwork, title } })`。
3. **不能搬。** React 没有 `nextTick`，要在 DOM 更新后做事的正确工具是 `useEffect`（提交之后运行），第 5 章、第 10 章分别讲。
4. **能搬。** 官方对 `key` 与「索引当 key」的告诫和 Vue 一致；`key` 同样不进 props。
5. **能搬，而且更重要。** React 里没有缓存机制替你兜底，存一份副本就是两份真相要手动同步；「该用 computed」这个动作改成「直接写表达式，确有必要再 `useMemo`」。
6. **能搬（换机制）。** React 没有 `emit`，但「子组件调用父组件传下来的回调」是同一个单向数据流纪律，绝不允许子组件直接改父组件 state。

</template>

</Exercise>

## 官方文档与延伸阅读

标注每条用来核实本章哪个结论，方便你复核而不是只信我。核实时间统一为 2026-10-17。

- [State 如同快照](https://react.dev/learn/state-as-a-snapshot) —— 核实「闭包里的 state 是渲染那一刻的值」「setter 只影响下一次渲染」。本章「执行时机」整节依据它（中文版：<https://zh-hans.react.dev/learn/state-as-a-snapshot>）。
- [排队状态更新](https://react.dev/learn/queueing-a-series-of-state-updates) —— 核实「三次 `setCount(count + 1)` 只加 1」的成因、「传函数」的修法，以及批处理定义与「跨多个事件不合并」。
- [渲染与提交](https://react.dev/learn/render-and-commit) —— 核实三阶段划分、「渲染阶段不碰 DOM」「只在两次渲染有差异时才改 DOM 节点」。并发细节该页未展开，因此本章标了 `unverified`。
- [`useState` 参考](https://react.dev/reference/react/useState) —— 核实「`Object.is` 相等时跳过重渲染」「state 视为只读，要替换而非修改」。[`useMemo` 参考](https://react.dev/reference/react/useMemo) —— 核实「性能优化而非语义保证，React 可以丢弃缓存值」，这是推翻 `computed` 直觉的直接依据。
- [`StrictMode` 参考](https://react.dev/reference/react/StrictMode) —— 核实被双调用的清单，以及每个 Effect、每个 callback ref 在开发环境额外一遍 setup + cleanup。
- [渲染列表](https://react.dev/learn/rendering-lists) —— 核实 `key` 三条规则，用来与 [Vue 模板语法](/vue/template-syntax) 对照。[React 版本页](https://react.dev/versions) —— 最新稳定版的来源，本站不写死版本号。
- [Vue 心智模型](/vue/mental-model) 与 [响应式深入](https://cn.vuejs.org/guide/extras/reactivity-in-depth.html) —— Vue 侧「可变 + 自动追踪」的原始描述，本章每条差异都以此为准绳；再对照官方 [Thinking in React](https://zh-hans.react.dev/learn/thinking-in-react)。

## 下一章

方向定了：React 里没有「改了就生效」，只有「重跑一个函数」。但「用 JS 描述界面」还剩另一半——**你怎么把结构写出来**。Vue 给模板和指令，React 给 JSX，而 JSX 的规则（必须单一根、花括号里只能放表达式不能放语句、`className` 与 `htmlFor` 这套属性名、`onClick={fn()}` 这个必踩错误）看着眼熟却处处和模板不同。下一章 [JSX 与模板的对照](/react/jsx) 把这些差异整理成可查的转换表，并给你把任意 Vue 模板机械改写成 JSX 的步骤；再往后 [第 3 章 useState 与不可变更新](/react/state) 才正式处理本章末尾那个「`push` 不生效」的完整规则。
