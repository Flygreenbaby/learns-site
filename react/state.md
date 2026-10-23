# useState / useReducer 与不可变更新：state 不是变量，是快照

你在 Vue 里写了几年这样的代码，一切顺利：

```vue
<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
function addThree() {
  count.value++
  count.value++
  count.value++
}
</script>

<template>
  <button @click="addThree">{{ count }}</button>
</template>
```

按同样思路写 React：

```tsx
function AddThree() {
  const [count, setCount] = useState(0)
  function addThree() {
    setCount(count + 1)
    setCount(count + 1)
    setCount(count + 1)
  }
  return <button onClick={addThree}>{count}</button>
}
```

点一次按钮显示 **1**，不是 3。你改成 `setCount(count + 3)`，显示 3 了——可需求其实变成了「三次各自带校验的更新」，凑数字的修法立刻崩塌。

差异不是 API 名字，是模型：**Vue 的 `ref` 是可以反复读写的盒子，React 的 `count` 是本次渲染里定死的值，而 `setCount` 不是赋值运算符，是「请求下一次渲染用这个值」。** 第 1 章那句「组件函数每次渲染都是一次全新调用」在这里第一次兑现成 bug。本章所有结论的核实时间统一为 2026-10-17。

## setter 的语义：不是改值，是安排新值并请求渲染

官方 [`useState` 参考页](https://react.dev/reference/react/useState) 写得很直白：**调用 set 函数不会改变已经在执行的那段代码里的当前 state**，例子就是 `setName('Robin')` 之后 `console.log(name)` 仍然打印旧值，「它只影响从下一次渲染开始 `useState` 返回什么」。合起来读，setter 的完整语义是三条：

1. 你**传入一个新值**（或一个能算出新值的函数）。
2. React **把它记下来**，放进这个组件的更新队列。
3. 新值与当前值判定不等价时，React **请求一次重新渲染**；判定等价则跳过这个组件及其子树。

对照 Vue：`count.value = 1` 是一次**写入**，Proxy 的 setter 拦截之后把依赖它的 effect 标记为脏。名字里都有 set，一边改数据，一边改 React 内部保存的状态并顺带请求渲染。第 3 条要特别记住：**「引用相同就不重渲染」是规则，不是可选优化**——`setTodos(todos)`（就地 `push` 之后再 set）语义上等于「什么都没发生」。

## 为什么三次 setCount(count + 1) 只加 1

初始渲染时 `count` 是 `0`，`addThree` 这个闭包捕获的 `count` 也被固定成 `0`：

```text
第一行 setCount(0 + 1) → 队列记下「下一次渲染 count = 1」
第二行 setCount(0 + 1) → 同上，覆盖前一项
第三行 setCount(0 + 1) → 同上
事件处理器结束 → 处理队列 → 用 1 重新渲染 → 新闭包捕获 count = 1
```

三行里的 `count` 来自同一个快照，所以是三次相同赋值的最后一笔生效。这不是 bug，也不是「异步问题」，是闭包的正常结果（[函数、作用域、闭包与 this](/javascript/functions-and-scope)）。[排队状态更新](https://react.dev/learn/queueing-a-series-of-state-updates) 给的修法是**传函数**：`setCount((c) => c + 1)` 三次，预期结果 3。官方原话是「传一个函数去基于队列里前一个状态计算下一个状态」——这里的 `c` 不是渲染快照，是队列里已经排到的那个值，所以能逐级累加。

**Vue 里不存在这个问题**，`count.value++` 读的就是当下值。这不是「React 更麻烦」，是两种模型各自的代价：Vue 用依赖追踪换「写起来像普通变量」，React 用不可变快照换「每次渲染的输入完全固定」，后者才让中断、丢弃、重算这些能力成立。

**什么时候必须用函数式更新？** 判据一句话：**新值依赖旧值时一律传函数。** 常见漏网场景：一个事件里连续多个更新、`setInterval` 里的累加、把 setter 传给别人调用。不依赖旧值（`setDraft('')`、`setFilter('done')`）时传字面量完全没问题。

## 更新是批处理的

官方原文：**React 会等事件处理器里所有代码跑完才处理 state 更新**，这个行为叫 batching（`useState` 参考页与排队状态更新页）。所以一个事件里连调三个不同 state 的 setter，预期结果是**一次**重新渲染——这也解释了「同一次事件里读不到刚写进去的值」。同一页补了一句：跨**多个有意触发的事件**（例如两次点击）不会合并，每次各渲染一次。

<Callout type="unverified" title="事件处理器之外（定时器、Promise 回调）的批处理行为本站不作结论">

网上大量教程说「在 `setTimeout` 或 `await` 之后调 setState 不会批处理、会渲染多次」，那描述的是 React 18 之前的行为，React 18 引入了统一的自动批处理。**本站没有从 react.dev 相关页面核实到这条结论的原文**（排队状态更新那一页只讨论事件处理器范围内的批处理，明确没涉及定时器），因此不写成事实。

自己验证只要三分钟：在同一个 `setTimeout` 回调里调用三个 setter，组件函数体顶部加一行 `console.log('render')`，数打印几次。这条不确定性不影响本章任何写法——「依赖旧值就传函数」「渲染保持纯」两条无论批不批处理都成立。

</Callout>

## 不可变更新规则

React 把 state 视为**只读**，要改只能替换（`useState` 参考页明确写了「state 视为只读，要替换而不是修改」）。

| 目标 | Vue 里的写法（在 React 里是 bug） | React 正确写法 |
| --- | --- | --- |
| 数组尾部加一项 | `list.push(x)` | `setList((old) => [...old, x])` |
| 数组删一项 | `list.splice(i, 1)` | `setList((old) => old.filter((_, j) => j !== i))` |
| 改某一项的字段 | `list[i].done = true` | `setList((old) => old.map((it) => (it.id === id ? { ...it, done: true } : it)))` |
| 对象改一个字段 | `form.name = 'x'` | `setForm((old) => ({ ...old, name: 'x' }))` |
| 嵌套两层 | `person.artwork.title = 'x'` | 一路展开到被改的那一层：`{ ...old, artwork: { ...old.artwork, title } }` |
| 数组排序 | `list.sort()`（就地改） | `setList([...old].sort(...))`——`sort` 会修改原数组，必须先浅拷贝 |

**为什么 `push` 不生效**：React 判断「有没有变化」的方式是把新值与旧值做 `Object.is` 比较。`push` 之后你传回的还是同一个数组，比较相等，React 判定无事发生。这条规则是**引用级**的，不是内容级的——React 不会 diff 你的数组内容来决定要不要渲染。更隐蔽的后果是**污染快照**：你改掉的是 React 内部持有的那份数据，于是出现「现在不渲染、将来某次别的更新触发渲染时这一项凭空冒出来」。

**Vue 的做法完全相反**：`reactive` / `ref` 用 `Proxy` 包住对象，写入被拦截、依赖被通知，连「换新对象」都不用做。这是 Vue 的便利，也是它的成本（深层代理开销、`toRaw` 的边界、该用 `shallowRef` 时没用的性能问题，见 [响应式原理](/vue/reactivity)）。

**React 为什么这样设计？** 一句话：**用一次廉价的引用比较，换「渲染输入不可变」这条全局保证。** 每次渲染都必须基于固定不变的输入，React 才能安全地推迟、中断、丢弃重算——并发特性、`memo`、时间切片都建在这上面。代价转移到你身上：每次更新都要构造新对象。而这个成本很低，展开运算符只复制最外层，未变的元素仍是同一个引用，这恰好让 `memo` 能跳过没变的行（第 7 章）。

<Callout type="warn" title="函数式更新里就地修改是重灾区">

`setList((old) => { old.push(x); return old })` 看起来「用了函数式更新所以很安全」，实际比直接 `push` 更糟——既没换引用，又改了 React 内部持有的状态。判据只有一个：**updater / reducer 返回的对象不能和它接收的是同一个引用。**（数组里未变化的那些项保持同引用是**应该**的，那叫结构共享。）

</Callout>

## state 放在哪一层

这条设计直觉 Vue 里也有，但 React 里更容易踩：没有轻量跨层手段，而且 Context 值一变**所有**消费者重渲染（[第 6 章](/react/context)）。**局部优先**：搜索关键词、弹窗开关、表单草稿都应该 `useState` 在用到它的组件里。

**上移的判据**（满足任一条才移）：两个**兄弟**都要读写它 → 移到最近共同父组件；一处写、另一处要立刻读到 → 同上；值要跨路由存活 → 应用层或外部 store；中间层只是把它传过去（穿过四层 props）→ 考虑 Context 或改用组件组合。

**别过早全局化。** 从 Vue 来的人有个坏习惯：因为 Pinia 太顺手，任何共享状态都往 store 塞。React 里全局状态代价更明显——Context 全体消费者重渲染，外部 store 要订阅机制。**判据是「有几处要读它」，不是「它跨不跨组件」**：一个 props 能传下去的值不要放 Context。

反向的坑是**该合并的被拆开**。官方举的例子是表单里 `title` 与 `author` 总是一起变化，就该合成一个 `form`（[选择 state 结构](https://react.dev/learn/choosing-the-state-structure)）。理由是：拆开后「两个字段必须同时更新」的正确性依赖批处理恰好成立；合成一个对象后一次 setter 就是原子变更，函数式更新里也能读到配对的旧值。

## useReducer：什么时候值得用

`useReducer(reducer, initialArg, init?)` 返回 `[state, dispatch]`（[`useReducer` 参考页](https://react.dev/reference/react/useReducer)）。它对应 Vue 生态里的什么？**不是「useReducer 对应 Pinia」，而是「把变更规则收进一处、组件只发意图」这个思路**——你在 [Pinia](/vue/pinia) 里写 `store.toggle(id)` 而不是 `store.todos[i].done = !store.todos[i].done`，是同一个直觉。

值得换的信号：**三个以上互相联动的字段**（多个 `useState` 会产生「这两个 setter 必须成对调用」的隐性约束）；**存在状态转移规则**（「saving 时禁止删除」「切换选中项要退出编辑态」这类规则该只有一处实现）；**更新要基于旧状态做多分支计算**（函数式更新写成三元套三元已经不可读）；**想把变更能力传给子组件但不暴露 setter**（`dispatch` 引用稳定，作为 prop 传下去比一堆 setter 干净）；**需要可记录、可序列化的变更**（action 是普通对象）。不值得的信号：一两个独立布尔值、纯文本草稿、只是嫌 `useState` 名字长。

**reducer 必须是纯函数。** 官方要求它 pure、接 state 与 action、返回下一个 state；不能修改 state、不能有副作用、不能用 `Math.random()` / `Date.now()` 这类不纯输入；而且 `StrictMode` 在开发环境会把 reducer 与初始化函数**各调用两次**来暴露不纯（同一个参考页核实）。所以「在 reducer 里生成 ID」会在开发环境得到两个不同 ID：正确做法是把 `id` 放进 action，由**事件**（不纯该发生的地方）生成后传进来。

### 判别联合 action：完整可用 TS 代码

action 天然适合判别联合（discriminated union），收窄规则见 [TypeScript 第 3 章 联合类型与收窄](/typescript/unions-and-narrowing)。

```tsx
import { useReducer } from 'react'

type Todo = { id: string; text: string; done: boolean }
type State = { todos: Todo[]; draft: string }
type Action =
  | { type: 'add'; id: string }
  | { type: 'setDraft'; value: string }
  | { type: 'toggle'; id: string }
  | { type: 'remove'; id: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      const text = state.draft.trim()
      if (!text) return state
      return {
        draft: '',
        todos: [...state.todos, { id: action.id, text, done: false }]
      }
    }
    case 'setDraft':
      return { ...state, draft: action.value }
    case 'toggle':
      return {
        ...state,
        todos: state.todos.map((t) =>
          t.id === action.id ? { ...t, done: !t.done } : t
        )
      }
    case 'remove':
      return { ...state, todos: state.todos.filter((t) => t.id !== action.id) }
    default:
      return state
  }
}

export default function TodoApp() {
  const [state, dispatch] = useReducer(reducer, { todos: [], draft: '' })

  return (
    <section>
      <input
        aria-label="新待办"
        value={state.draft}
        onChange={(e) => dispatch({ type: 'setDraft', value: e.target.value })}
      />
      <button onClick={() => dispatch({ type: 'add', id: crypto.randomUUID() })}>
        添加
      </button>
      <ul>
        {state.todos.map((t) => (
          <li key={t.id}>
            <button onClick={() => dispatch({ type: 'toggle', id: t.id })}>
              {t.text}
            </button>
            <button onClick={() => dispatch({ type: 'remove', id: t.id })}>删</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

四处值得停一下：**`case 'add'` 里读 `state.draft`**——reducer 拿到的一定是队列里最新的 state，不受快照影响，这是 `useReducer` 相对「多个 `useState` + 闭包」最实际的优势；**`return state`（不展开）**——引用没变，`Object.is` 判定相等，这个组件不重渲染，空输入不产生无意义渲染；**`crypto.randomUUID()` 写在事件里**，reducer 保持纯；**`case` 之后 TypeScript 才知道 `action.id` 存在**，将来漏写一个分支，`default` 里的 `action` 会被收窄成 `never`，可以借此让编译期报错。

## 惰性初始化：为什么不能直接传值

`useState` 可以传一个函数。官方语义：React 只在初始化组件时调用它，把返回值存为初始 state，**首次渲染之后这个参数被忽略**。它给的对照正是 `useState(createInitialTodos)`（只在初始化执行一次）与 `useState(createInitialTodos())`（每次渲染都执行）。

于是从 `localStorage` 取初始值必须写成惰性形式：

```tsx
const [todos, setTodos] = useState<Todo[]>(() => {
  const raw = localStorage.getItem('todos')
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Todo[]) : []
  } catch {
    return []
  }
})
```

直接传值有两个后果：**每次渲染都执行一遍 `getItem` + `JSON.parse`**（React 只是不用结果，你的代码已经跑了）；**脏数据让 `JSON.parse` 在渲染阶段抛错、整个组件白屏**，而这个错误本来只在初始化那一刻才有机会发生。前者是性能损失，后者是正确性问题。

补充两点：`StrictMode` 在开发环境会把这个初始化函数**调用两次**（[StrictMode 参考页](https://react.dev/reference/react/StrictMode) 列的双调用范围包括「传给 `useState` 的函数」）；函数是纯的就不影响逻辑，但你在里面顺手 `localStorage.setItem(...)` 就会看到写两次——**初始化函数同样不能带副作用**。`useReducer` 的第三个参数 `init` 是同一机制的另一形态。

## 更新之后想读 DOM：React 没有 nextTick

Vue 里你习惯 `await nextTick()` 再 `el.value?.focus()`。React 里 `setText('abc')` 之后立刻 `inputRef.current?.focus()`，**读到的是旧 DOM**（提交还没发生）；要量某个「更新后才有尺寸」的元素同样拿到旧快照。

对应机制是 **effect 在提交之后运行**：

```tsx
const inputRef = useRef<HTMLInputElement>(null)

useEffect(() => {
  inputRef.current?.focus()
}, [text])
```

`useRef` 在这里只是「跨渲染保存 DOM 节点、改它不触发渲染」，与 Vue 模板 ref 语义差别很大（[第 10 章](/react/refs-and-forms)）。依赖数组、清理时机、「这段逻辑该不该放进 effect」是 [第 5 章 useEffect 与 watch 的对照](/react/use-effect) 的内容——**这里只需记住：React 没有 `nextTick`，想读更新后的 DOM 就交给 effect。** 另有 `useLayoutEffect` 用于绘制前同步读布局，第 10 章处理。

## stale closure：三种真实故障

过期闭包不是 React 的特性，是闭包规则撞上「每次渲染都新建函数」。

**故障 1：事件监听器里的旧 state。**

```tsx
// 错
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'm') setPlaying(!playing)
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, []) // 依赖数组为空 → effect 只跑一次 → 闭包里的 playing 冻结在首次渲染值
```

症状：第一次按 `m` 能切换，之后每次切回同一个值。修法三选一：**A 把依赖补齐** `[playing]`（官方推荐，也是 exhaustive-deps 规则要查的）；**B 用函数式更新** `setPlaying((p) => !p)`，根本不读 `playing`；**C 把值镜像进一个 ref**。B 只在「新值纯粹由旧值推出」时可用；回调里还要发请求或读别的 state 就回到 A。

**故障 2：定时器里的旧 state。**

```tsx
// 错：每秒 tick，但 count 永远停在 1
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000)
  return () => clearInterval(id)
}, [])
```

因为每秒执行的都是 `setCount(0 + 1)`。修：`setCount((c) => c + 1)`——这个例子说明了函数式更新为什么存在：**把「读最新值」交回给队列，而不是交给闭包**。清理函数不能省，`StrictMode` 会额外跑一遍 setup + cleanup，漏掉清理你会直接看到速度翻倍（第 11 章）。

**故障 3：异步回调里读到旧 props。**

```tsx
async function save() {
  const before = props.title   // 快照 A
  await api.put(id, draft)
  logChange(before, props.title) // 仍是快照 A，不是最新值
}
```

症状：`await` 期间组件重渲染了几次（父组件传了新 title），但你读到的还是发起请求那一次的值；更糟的是组件可能已卸载，回调还在跑并试图更新它的 state。修法按情况：需要「发起时」的值就在函数开头显式存局部变量并只用它（`before` 本身没错，错的是和 `props.title` 混用）；需要最新值就别在回调里读 props，改成 `dispatch({ type: 'saved', at: Date.now() })` 让最新状态在 reducer 里被读到，或让父组件负责读（第 4 章）；可能已卸载就用清理函数或 `cancelled` 标志忽略旧结果（第 5 章竞态部分）。

**这一族故障在 Vue 里几乎不存在**，因为 `props.title` 每次都穿过代理取当前值。记成新规则：**React 里任何跨越时间的回调，读到的都是它被创建那一刻的值。**

## 对象/数组 state 与 useMemo 的依赖陷阱

`useMemo` 的依赖数组逐项用 `Object.is` 比较，所以引用稳定性直接决定它有没有效果：

```tsx
const options = { page: 1, size: 20 }        // 每次渲染新建 → 依赖它等于没缓存
const ids = todos.map((t) => t.id)           // 新数组，永远比较不等
const label = useMemo(() => makeLabel(user), [user]) // 只想用 user.id，却被整个引用变化触发
```

修法：常量提到组件外面（第 1 条本就不该写在函数体里）；依赖具体字段 `[user.id]`；需要稳定引用时让引用来自 state 或 reducer 的结果，而不是渲染期新建。

更要紧的一条：**`useMemo` 不是语义保证**。第 1 章核实过官方原话——它是性能优化，React 可能丢弃缓存值。所以「用 `useMemo` 保证某段代码只跑一次」是错误用法，那种需求属于事件处理或带清理的 effect。Vue 的 `computed` 是语义层保证，这条差异不能靠「换个 API 名」带过去。

最后一句：**多数情况不需要 `useMemo`。** 一次 `filter` / `map` 的开销远小于记忆化本身的成本与出错概率。判据是「你实测到这里是瓶颈」，不是「父组件重渲染时这段会重跑」。

## 状态形状：拆多个还是合一个

| 情形 | 建议形状 | 理由 |
| --- | --- | --- |
| 两个值互不相干（弹窗开关、草稿文本） | 各自 `useState` | 引用比较互不干扰 |
| 两个值**总是一起变**（`title` 与 `author`） | 合成一个对象 | 一次 setter 是原子变更，不依赖批处理恰好成立 |
| 一个值的新值依赖另一个值 | 合并，或用 `useReducer` | 分开的 setter 里读另一个 state 一定读到快照 |
| 一组结构相同的列表项 | 一个数组 state，元素不可变更新 | 每项一个 state 无法表达顺序、增删与 `key` 匹配 |
| 派生值（筛选结果、总数） | **不要存进 state** | 渲染期算即可；存副本等于两份真相要手动同步 |

「派生值不要存 state」在 React 里比 Vue 更硬：Vue 的 `computed` 让「存一份派生」看起来成本很低，于是鼓励了「props 变了就同步进 state」；React 里这么做要多写一个 effect，而 effect 是第 5 章整章的坑区。**同一个值存两份的地方越多，stale closure 能咬你的位置就越多。**

最后提醒一个 React 特有的重置手段：**换 `key` 会重建组件并丢掉它的全部 state**（`<Form key={userId} />` 切换用户即重置表单）。Vue 里 `key` 只影响 diff 与元素复用，没人把它当重置用；React 官方把「传不同 key 来重置 state」列为推荐手段（[保留与重置 State](https://react.dev/learn/preserving-and-resetting-state)）。它是**语义**而不是性能技巧，理解代价再用。

## 常见错误与排查

**1. 现象：`push` / 改属性之后界面不动，数据却变了。** 原因：传回同一个引用，`Object.is` 相等 → 跳过重渲染。确认：`console.log(next === prev)` 打 `true`；Profiler 里该组件没有渲染记录。修：一律换新容器；深层嵌套要一路展开到被改的那一层。

**2. 现象：同一事件里三次 `setX(x + 1)` 只加一次。** 原因：三次读的 `x` 都是本次快照，批处理让最后一笔生效。确认：三行之间 `console.log(x)` 输出相同。修：新值依赖旧值就传函数。

**3. 现象：`setTimeout` / `setInterval` 回调里 state 永远是初始值（定时器卡在 1）。** 原因：回调是某次渲染时创建的闭包。确认：把回调里的 state 打出来，与 DevTools 显示的当前值对比。修：函数式更新；或把依赖补进 effect 数组（代价是定时器重建）；确实需要「不触发渲染的最新值」时用 ref。

**4. 现象：`await` 之后读 state/props 拿到旧值。** 原因：跨越时间点的读取都是过期值。确认：`await` 前后各打印一次，两者不一致而界面是对的。修：需要的值发起前存局部变量；要最新值就改用 reducer 或交给父组件。

**5. 现象：`setForm(...)` 之后立刻 `console.log(form.name)` 还是旧值。** 原因：setter 只影响下一次渲染（官方 `useState` 页原话）。确认：这行日志永远打旧值，下一轮渲染的日志才是新的。修：不要「写完再读」，直接用你手上的新值；要在更新后做事就放进事件或 effect。

**6. 现象：一个交互要同时改两个 state，第二个还得参考第一个的结果，怎么写都不对。** 原因：分开调 setter 时两者都基于同一份快照，互相看不见。**这正是该换 `useReducer` 的信号**——两个 action 依次进队列，reducer 拿到的永远是队列里的最新 state。

**7. 现象：reducer 里写了 `Date.now()` 或发请求，开发环境 ID 重复、行为错乱。** 原因：reducer 必须纯，而 `StrictMode` 会把 reducer 和初始化函数各调两次。确认：同一次 `dispatch` 打印出两个不同 ID。修：不纯的值在事件里生成后放进 action；副作用移到事件或 effect。**别关掉 `StrictMode` 来「解决」它。**

**8. 现象：`useState(JSON.parse(localStorage.getItem('k')!))` 让页面每次输入都卡一下，或脏数据白屏。** 原因：表达式每次渲染都执行（React 只是丢弃结果），解析失败会在渲染阶段抛错。确认：旁边加日志，输入一个字打一次。修：惰性初始化 + `try` 兜底。

**9. 现象：加了 `useMemo` 后被包的组件照样每次重渲染。** 原因：混淆三层——`useMemo` 缓存值、`memo` 才阻止组件重渲染、`useCallback` 缓存函数；而 React 本就可以丢弃 `useMemo` 的缓存。确认：DevTools 勾选「高亮更新原因」逐项看 props 引用。修：见第 7 章，先确认这里到底需不需要记忆化。

## 练习

<Exercise title="练习 1 · 预测每一步的显示值" difficulty="基础">

初始 `count` 为 0。点击**一次**后显示几？再点一次显示几？如果把 `setCount(count + 2)` 换成 `setCount((c) => c + 2)`，两次结果又是什么？

```tsx
function Btn() {
  const [count, setCount] = useState(0)
  return (
    <button onClick={() => { setCount(count + 1); setCount(count + 2) }}>
      {count}
    </button>
  )
}
```

<template #answer>

一次点击后显示 **2**，第二次后 **4**。首次渲染 `count = 0`，两行是 `setCount(1)`、`setCount(2)`，批处理后队列留下最后一个值 2；第二次点击发生在 `count = 2` 那次渲染之后，两行变成 `setCount(3)`、`setCount(4)`。

换成函数式更新后：第一次 `c => c + 1` 得 1，再 `c => c + 2` 基于 1 得 **3**；第二次点击得 **6**。这就是「传函数 = 基于队列里前一个状态计算」与「传值 = 基于本次渲染快照计算」的区别。

</template>

</Exercise>

<Exercise title="练习 2 · 把这段 Vue 代码改写成 React 并指出行为差异" difficulty="进阶">

```vue
<script setup lang="ts">
import { computed, reactive } from 'vue'

const form = reactive({ title: '', tags: [] as string[] })
const tagCount = computed(() => form.tags.length)

function addTag(t: string) {
  if (!form.tags.includes(t)) form.tags.push(t)
}
function clearAll() {
  form.title = ''
  form.tags = []
}
</script>

<template>
  <p>{{ tagCount }} 个标签</p>
  <button @click="addTag('urgent')">加 urgent</button>
  <button @click="clearAll">清空</button>
</template>
```

改写成 `useReducer` 版本，并回答：（a）`addTag` 里的 `includes` 判断在 React 里为什么仍然安全？（b）`clearAll` 的两个字段为什么建议放进同一个 state？（c）`computed` 那一行改写后去哪了？

<template #answer>

```tsx
import { useReducer } from 'react'

type FormState = { title: string; tags: string[] }
type FormAction = { type: 'addTag'; value: string } | { type: 'clear' }

function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'addTag':
      return state.tags.includes(action.value)
        ? state
        : { ...state, tags: [...state.tags, action.value] }
    case 'clear':
      return { title: '', tags: [] }
  }
}

export default function TagForm() {
  const [form, dispatch] = useReducer(reducer, { title: '', tags: [] })
  return (
    <>
      <p>{form.tags.length} 个标签</p>
      <button onClick={() => dispatch({ type: 'addTag', value: 'urgent' })}>
        加 urgent
      </button>
      <button onClick={() => dispatch({ type: 'clear' })}>清空</button>
    </>
  )
}
```

（a）**安全**，因为 reducer 接收的 `state` 永远是队列里的最新值，不是渲染快照——快照问题只发生在「事件闭包里读 state 变量」那一侧。把带条件判断的更新收进 reducer 的价值就在这里：`dispatch` 之后不必担心读到过期值。

（b）`clear` 要**同时**置空两个字段。拆成两个 `useState` 就得连调两个 setter，正确性依赖「React 恰好批处理」；合成一个对象后一次变更是原子的，reducer 里天然看得到配对的两个字段。注意 `{ title: '', tags: [] }` 是**全新对象**，即便内容与之前相同，引用变了，所以会触发渲染（这里正是我们要的）。

（c）没有了。`form.tags.length` 直接写在插值里——React 没有 `computed`，渲染期读一个数字的成本可以忽略。**只有派生计算真的昂贵（上千项排序/聚合）才考虑 `useMemo`，而它不保证缓存。** 最错的做法是再开一个 `tagCount` state 然后想办法同步——那就是两份真相。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释现象" difficulty="进阶">

下面组件有三处与「快照 / 不可变」相关的错误，逐条指出并说明**症状分别是什么**（不要只说「不对」）。

```tsx
function Chat({ roomId }: { roomId: string }) {
  const [msgs, setMsgs] = useState<string[]>([])
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    const socket = connect(roomId)
    socket.onMessage((text) => {
      msgs.push(text)
      setMsgs(msgs)
      setUnread(unread + 1)
    })
    return () => socket.close()
  }, [])

  return <p>{unread} 条未读 / 共 {msgs.length} 条</p>
}
```

<template #answer>

1. **`msgs.push(text)` + `setMsgs(msgs)`**：同一个引用，`Object.is` 相等 → 不重渲染，`msgs.length` 永远显示 0。而且你改掉了 React 持有的那份数组，下次别的更新触发渲染时那条消息会「凭空冒出来」。修：`setMsgs((old) => [...old, text])`。
2. **`setUnread(unread + 1)`**：`unread` 被 effect 闭包冻结在首次渲染的 `0`，每条新消息执行的都还是 `setUnread(1)`——第一条正常，之后卡在 1，看起来像「收到消息但计数不动」。修：`setUnread((n) => n + 1)`。
3. **依赖数组写 `[]` 却读了 `roomId`**：换房间时 effect 不重建，socket 仍连在旧房间。这是同一条根因（本次渲染的 props 被冻结）的另一种表现。修：把 `roomId` 放进依赖数组，清理函数里关掉旧连接——完整规则在第 5 章。

排查经验：第 1、2 条会让 `unread` 与 `msgs.length` 完全脱节，只看 `console.log(text)` 会误判成「数据是对的，是渲染坏了」。**判断渲染有没有发生要用 React DevTools 的 Profiler，不要靠 `console.log`。**

</template>

</Exercise>

<Exercise title="练习 4 · 惰性初始化与 StrictMode 双调用" difficulty="基础">

两个写法都挂在 `StrictMode` 下的开发环境里，分别会发生什么？

```tsx
const [todos, setTodos] = useState(
  JSON.parse(localStorage.getItem('todos') ?? '[]')
)
const [notes, setNotes] = useState(() => {
  console.log('初始化')
  return loadNotesFromSomewhereExpensive()
})
```

<template #answer>

第一个：那个 `JSON.parse` **每次渲染都执行**（React 只是从第二次渲染起忽略返回值）；存的是脏数据时它会在渲染阶段抛错导致组件白屏——而这份读取本来只在初始化时发生一次就够。修：惰性初始化，并把解析包在 `try` 里给兜底值。

第二个：`初始化` 打印**两次**，因为 `StrictMode` 在开发环境故意把传给 `useState` 的初始化函数调用两遍来暴露不纯。这不是 bug：函数是纯的，两次返回值相同，React 用其中一次。**但如果初始化函数里有副作用**（写 `localStorage`、往外部数组 `push`、发请求），副作用就真的执行了两遍——那才是要修的错误。

一句话：惰性初始化解决「每次渲染都算」，`StrictMode` 双调用用来抓「初始化函数不纯」。

</template>

</Exercise>

## 官方文档与延伸阅读

以下均核实于 2026-10-17。

- [State 如同快照](https://react.dev/learn/state-as-a-snapshot) —— 核实「setter 只影响下一次渲染」「定时器/异步回调里读到的是安排那一刻的快照」。本章三处 stale closure 的原理来源。
- [排队状态更新](https://react.dev/learn/queueing-a-series-of-state-updates) —— 核实三次 `setCount(count + 1)` 只加 1 的成因、函数式更新的修法、批处理定义与「跨多个事件不合并」；该页没讲定时器批处理，所以那一处标了 `unverified`。
- [`useState` 参考](https://react.dev/reference/react/useState) —— 核实「调用 set 不改变已执行代码里的当前 state」「`Object.is` 相等则跳过重渲染」「state 视为只读，要替换」「初始化函数只在初始化时调用，首次渲染后该参数被忽略」。
- [`useReducer` 参考](https://react.dev/reference/react/useReducer) —— 核实签名 `useReducer(reducer, initialArg, init?)`、reducer 必须纯、`StrictMode` 下 reducer 与初始化函数被调用两次。
- [`StrictMode` 参考](https://react.dev/reference/react/StrictMode) —— 被双调用的清单（组件函数体、`useState` 初始化函数、setter、`useMemo` 计算函数、reducer）与每个 Effect 额外一遍 setup + cleanup，用来解释练习 4。
- [更新状态中的对象](https://react.dev/learn/updating-objects-in-state)、[更新状态中的数组](https://react.dev/learn/updating-arrays-in-state)、[选择 state 结构](https://react.dev/learn/choosing-the-state-structure)、[保留与重置 State](https://react.dev/learn/preserving-and-resetting-state) —— 不可变更新表、「一起变化的值应合并」与「换 key 重置 state」三条结论的官方出处。
- [将状态逻辑提取为 Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer) 与 [用 Reducer 和 Context 扩展](https://react.dev/learn/scaling-up-with-reducer-and-context) —— 「什么时候值得换 reducer」以及下一步「什么时候才该提到应用层」。
- 本站对照依据：[TypeScript 第 3 章 联合类型与收窄](/typescript/unions-and-narrowing)、[响应式原理](/vue/reactivity)、[计算属性与侦听器](/vue/computed-and-watch)、[Pinia](/vue/pinia)。

## 下一章

状态会写了，接下来要解决「值怎么跨过组件边界」。本章反复撞上「这个值在闭包里读不到最新」，其中一部分真正的出路是**别在子组件里读父组件的 state**——把需要的数据当 props 传进来，把变更意图用回调传出去。[第 4 章 props、回调与 children](/react/props-and-children) 讲 React 里为什么没有 `emit`、回调 props 与 Vue 的 `emit` 在哪几种情况下行为不同、`children` 与具名插槽的对应，以及「受控组件」这个 Vue 里几乎没有的概念（`v-model` 展开之后是什么）。顺带提醒：你已经见过「每次渲染新建函数」的代价，第 4 章会正式处理它带来的 prop 稳定性问题，把完整的引用稳定性讨论留给[第 7 章](/react/re-render-performance)。
