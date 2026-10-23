# 重渲染机制与性能：为什么会渲染的组件比你以为的多

第一个故障：一个 200 行的待办列表，用户在顶部搜索框里每敲一个字符，整个页面卡 150–250 ms。你去看代码，逻辑清清楚楚：搜索关键词是一个 `useState`，列表项组件长得也不复杂。你在 Vue 里做过几乎一样的页面，同样的结构一点都不卡——因为 Vue 只会唤醒真正读了那个关键词的组件。

第二个故障：为了解决上面的卡顿，你给每个列表项组件包了 `memo`。卡一点没缓解，反而多出一堆「依赖数组漏写」的 bug。原因是列表项的 props 里有一个 `onToggle` 回调，它是父组件每次渲染新建的函数；`memo` 用 `Object.is` 一比就不等，等于没包。**`memo` 不是「关掉重渲染的开关」，它是一次引用比较。**

第三个故障：搜索框旁边有个倒计时组件每秒更新一次，你把倒计时提到了共同父组件里，于是每秒都有整棵子树重新执行；你改用 Context 承载倒计时，结果所有读这个 Context 的组件每秒更新一次。这两个都是「状态放错了位置」，不是「渲染太慢」。

React 与 Vue 在性能上的根本分歧就一句话：**Vue 的更新范围由依赖追踪算好，React 的更新范围由「哪个组件函数被重新调用」决定，而后者的默认答案比你的直觉更宽。** 这一章把触发源、三个记忆化 API 各自的职责与代价、`key` 与协调的关系、Concurrent 相关的延后更新，以及定位流程讲清。前置：[两套渲染模型](/react/two-rendering-models)、[useState / useReducer 与不可变更新](/react/state)、[Context 与 provide / inject](/react/context)、[Vue 渲染性能](/vue/rendering-performance)。

## 三种触发源：先把「谁会重渲染」列出来

| 触发源 | React 的行为 | Vue 3 的行为 | 首选解法 |
| --- | --- | --- | --- |
| 组件自身 state 变化 | 该组件函数重新执行；**默认它渲染出来的所有子组件也重新执行** | 只有模板/计算里真正读过那个 ref 的组件更新 | 把 state 下沉到最小范围；`memo` 只在确证有效时用 |
| 父组件重渲染 | 子组件跟着重新执行（即使 props 完全没变） | 子组件不受牵连（组件是渲染函数，父的 effect 依赖只到它自己用到的属性） | `memo` + 稳定 props；或用 `children` prop 把子树交给上层创建 |
| Context 的 value 变化 | 所有 `useContext` 该 Context 的组件重渲染，`memo` 挡不住 | 取决于注入的是 ref 还是普通值；reactive 对象按「对象 + 键」唤醒 | 拆 Context；或改用带选择器的 store |
| 路由变化 | 内部用 Context 持有当前路由，读它的组件更新 | 只有真正读了 `route.xxx` 的组件更新 | 只在需要当前路由的组件里订阅 |

有一行需要单独强调：**React 的默认行为是「向下传播渲染」，这不是优化失败，这是它的工作方式。** React 官方 `memo` 参考页写得很直接——用了 `memo` 之后，「只要任意一个 prop 与上一次不满足浅比较，组件就重新渲染」（原文：your component re-renders whenever any prop is not *shallowly equal* to what it was previously）。反过来说，不用 `memo` 时，props 变不变根本不影响判断：子组件函数照样执行。

反过来，什么情况下**不会**重渲染：

- 你调用 `setCount(同一个值)`，`Object.is` 判等，React 通常会提前退出（bail out）。但这不等于「该组件函数一次都不执行」——官方语义是可能会再渲染一轮才决定不继续往下，**别把「传相同值」当作阻止子树渲染的手段**。
- 父组件重渲染，但子树是通过 `children` prop 从**不重渲染的上层**传进来的：那段 JSX 元素引用没变，React 可以直接复用。`memo` 参考页对此有原话（包装组件更新自身 state 时，React 知道 children 不需要重渲染）。
- 组件被 `memo` 包住且每个 prop 都浅相等。

<Callout type="verified" title="本章用到的引用比较事实已在 Node 中运行">

2026-10-17，本机 Node v25.4.0，`node -e` 运行结果：

```text
array same ref   : false        // 展开后 map 出新数组
item1 same ref   : true         // 未被修改的项引用不变
item2 same ref   : false        // 被 map 里重新构造的那一项
Object.is({}, {}) : false
Object.is(3, 3)   : true
Object.is(NaN,NaN): true   0 === -0: true   Object.is(0,-0): false
```

三条结论直接支撑本章：① 不可变更新「只换被改的那一项的引用」是成立的，这就是行级 `memo` 有效的机制基础；② 空对象字面量每次都不相等，所以内联对象做 props 会让 `memo` 完全失效；③ `Object.is` 与 `===` 在 `NaN` 和 `+0/-0` 上不同，极端情况下你会看到「值没变却重渲染」或反之，`setCount(-0)` 之后 `count` 是 `0` 这类细节来自这个差异。

</Callout>

## React 为什么不顺便把依赖追踪做掉

对照法在这里必须给出「为什么会设计成不同」，否则你会一直觉得 React 少做了一个功能。

Vue 的模板不是 JavaScript。编译器看得见「这个组件读了 `state.user.name`」，运行时用 Proxy 记录「哪个组件读了哪个属性」，于是更新范围可以精确到属性（见[响应式原理](/vue/reactivity)）。React 的组件就是一个函数，渲染期你完全可以 `if`、`.map`、可选链、把值传给别的函数、在闭包里读三个 props——**没有任何静态边界能让运行时知道「这个函数读了什么」**，因此 React 无法在同样的位置做同样的事。它选的另一条路是：把数据当不可变值，把渲染当纯函数，「重跑一次函数」的代价足够低，于是默认全部重跑，再把「要不要跳过」的决定权交给开发者（`memo`）或编译器（React Compiler）。

由此推出两条实用结论：

1. **React 的性能问题主要不是「渲染慢」，而是「渲染得多」。** 单个组件函数执行通常很快，代价随树规模累积。
2. **所以修复顺序永远是：先改状态结构与组件边界，再考虑记忆化。** 状态放低一层，比给十层组件包 `memo` 有效得多，也不用维护十个依赖数组。

| 症状 | 根因位置 | 正确修法 | 不该做的 |
| --- | --- | --- | --- |
| 输入框卡，列表全红（DevTools 高亮） | 搜索 state 在页面根组件 | state 下移到输入框＋列表的共同父；列表行组件 `memo` | 给全树包 `memo` |
| 每秒更新一次的倒计时牵连整页 | 倒计时 state 位置太高 | 把倒计时做成一个只渲染时间的组件 | `useMemo` 包整页 JSX |
| 加了 `memo` 完全不生效 | props 里有内联对象/函数 | `useCallback` 包函数、`useMemo` 包对象；或把该 props 拆成原始值 | 自定义浅比较函数硬压 |
| Context 一变全体抖 | value 粒度太粗 | 拆两个 Context（状态/动作），或换 store | 给消费者包 `memo`（官方明写无效） |
| 记忆化加了一堆，首屏更慢、bundle 更大 | 在廉价计算上花比较成本 | 删掉只为了「可能有用」的 `useMemo` | —— |

## memo、useCallback、useMemo：分别在防什么

这三个 API 名字像一家人，职责完全不同。把它们当成「性能三件套一起加」是新手最常见的做法，也是最常见的负收益来源。

| API | 包住的东西 | 防的是哪一次浪费 | 失效条件 | 固定代价 |
| --- | --- | --- | --- | --- |
| `memo` | 组件（返回新的组件） | 父组件重渲染时，子组件函数被重新执行 | 任意一个 prop 与上次 `Object.is` 不等（含每次新建的函数、对象、数组、内联 JSX） | 每次父渲染都要浅比较所有 props |
| `useCallback` | 函数引用 | 因为函数每轮换引用而导致的：`memo` 子组件失效、effect 每轮重跑 | 依赖数组任一项变化；依赖数组漏写 → 闭包读到旧值 | 一个数组 + 每轮比较 |
| `useMemo` | 计算结果的引用 | 渲染期重复的昂贵计算；派生对象/数组每轮换新引用 | 同上；**且不保证一定命中缓存**（官方允许 React 丢弃并重算） | 依赖比较本身 |

关键差别在 Vue 里对照最清楚：

```tsx
import { memo, useCallback, useMemo } from 'react';

type Task = { id: string; text: string; done: boolean };

const TaskRow = memo(function TaskRow({
  task,
  onToggle,
}: {
  task: Task;
  onToggle: (id: string) => void;
}) {
  return (
    <li>
      <input type="checkbox" checked={task.done} onChange={() => onToggle(task.id)} />
      {task.text}
    </li>
  );
});

function TaskList({ tasks }: { tasks: Task[]; onToggleDone: (id: string) => void }) {
  // useCallback：保住函数引用，否则 TaskRow 的 memo 每轮都白做
  const handleToggle = useCallback((id: string) => {
    onToggleDone(id);
  }, [onToggleDone]);

  // useMemo：只在 doneCount 的输入真的变了才重算，同时保证返回的是同一个原始值
  const doneCount = useMemo(() => tasks.filter((t) => t.done).length, [tasks]);

  return (
    <section>
      <p>已完成 {doneCount}</p>
      <ul>
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} onToggle={handleToggle} />
        ))}
      </ul>
    </section>
  );
}
```

等价的 Vue 3 写法不需要这三步中的任何一步：

```vue
<script setup>
import { computed } from 'vue';
const props = defineProps({ tasks: Array, onToggleDone: Function });
const doneCount = computed(() => props.tasks.filter((t) => t.done).length);
</script>

<template>
  <p>已完成 {{ doneCount }}</p>
  <ul>
    <TaskRow v-for="t in tasks" :key="t.id" :task="t" :on-toggle="props.onToggleDone" />
  </ul>
</template>
```

Vue 侧 `computed` 有依赖追踪、惰性求值、结果缓存三重保证；React 侧 `useMemo` 只有「按依赖数组重算」，缓存还是不保证。**这是两个 API 最容易混的地方**：把 `useMemo` 理解成「React 的 computed」会让你漏掉它对正确性没有任何贡献这一点——它纯粹是性能手段（见[计算属性与侦听器](/vue/computed-and-watch)）。

### 什么时候这三个是负收益

明确列出来，因为这正是「加了 memo 反而更慢」的成因：

- **子组件渲染本身很便宜。** `memo` 的浅比较要在每次父渲染时执行，props 越多越贵；树小、渲染快时，比较开销可能高于直接渲染。判据只能靠 Profiler 测出来的时间。
- **props 里含内联对象/函数而你不打算稳定它们。** 此时 `memo` 是纯粹的负担：白比较一次，还是渲染。
- **`useMemo` 包住一个廉价表达式。** `useMemo(() => a + b, [a, b])` 的依赖数组比较比加法贵，还多占内存。
- **依赖数组写漏。** 这不只是性能问题，是 stale closure 导致的正确性 bug（同类问题在 [useEffect](/react/use-effect) 里讲过）。`useMemo` / `useCallback` 享受和 effect 一样的 `exhaustive-deps` 规则，别为了少写依赖而压 lint。
- **把 `useMemo` 当语义保证。** 官方允许 React 丢弃记忆化结果（尤其在内存压力下）。若你的正确性依赖「这个引用一定不变」，那需要的是别的机制（例如把值放进 `useRef` 或者重新设计状态），不是 `useMemo`。
- **为了「所有组件都加 memo」而加。** 只有确实出现在 Profiler 里、且确实被无关更新牵连的组件值得包。

## key 与列表协调：它管的是身份，不是渲染次数

`key` 常被归进性能章节，但它的第一职责是**正确性**：告诉 React 哪些元素在两次渲染之间是同一个东西。

React 对数组子元素的协调规则是：拿 `key` 匹配上一次同一层的元素；`key` 相同就复用对应的 DOM 节点和该组件实例的全部 state；`key` 变了就认为是新元素，卸载旧的、挂载新的（DOM 全新创建、组件 state 归零）。Vue 的 `v-for` + `:key` 是同一套思路，但 React 里表现得更明显，因为组件 state 完全挂在函数调用的身份上（见[useState / useReducer](/react/state) 的「保留与重置 state」）。

| key 策略 | 中间插入一项时的预期结果 | 说明 |
| --- | --- | --- |
| 稳定唯一 id（`task.id`） | 只有新增项挂载；其余行的组件实例与 DOM 复用，行内 state 保持 | 正确做法 |
| 数组索引（`index`） | 从插入点开始，每一项的 key 都指向了不同内容：DOM 属性被就地改写，**非受控输入框里残留上一项的文本**、CSS 入场动画重放、`memo` 全部失效 | 故障制造器 |
| 用 `Math.random()` 或每项渲染时生成 | 每次父渲染所有 key 都变 → 整列表卸载重挂，输入失焦、滚动位置跳动 | 比索引更糟 |
| 不写 key | 行为等同索引，并在控制台给出警告 | 别依赖 |

索引 key 为什么偏偏让输入框出错？因为那一项的 `key` 不变，React 就复用了那个 DOM 节点，只更新了受 React 管理的属性。如果输入框是非受控的（`defaultValue`），它的实际值存在 DOM 里，React 不写它，于是「第 3 行的输入框」现在代表「第 2 条数据」——内容错位。这类问题在 Vue 里同样存在，但 Vue 项目里更常见的是 `v-model` 绑定到数组项属性上，React 里非受控写法更多，所以踩到的概率更高（对照见[useRef 与受控组件](/react/refs-and-forms)）。

**关于「渲染次数」，`key` 只影响一处：** 稳定 id 的不可变列表更新（map 出数组，只重建被改的那一项）能让未变项的 props 引用保持不变，于是行级 `memo` 有东西可比——上面 Node 运行的 `item1 same ref : true` 就是这个链条的一环。如果你用索引 key，即便包了 `memo` 也救不了错位问题。

## 延后更新：把「不紧急」这件事交给调度器

搜索框卡顿的第二类解法不是记忆化，而是**改变更新的紧急程度**：用户敲键盘是紧急更新，列表重新过滤可以延后。React 提供了两个方向一致、用法不同的 Hook：

```tsx
import { useDeferredValue, useState } from 'react';

export function SearchPage({ tasks }: { tasks: Task[] }) {
  const [keyword, setKeyword] = useState('');
  // deferred 是 keyword 的一份「允许落后」的副本
  const deferredKeyword = useDeferredValue(keyword);

  const filtered = tasks.filter((t) => t.text.includes(deferredKeyword));

  return (
    <>
      <input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        style={{ opacity: deferredKeyword === keyword ? 1 : 0.6 }}
      />
      <p>{filtered.length} 条结果</p>
      <ul>{filtered.map((t) => <TaskRow key={t.id} task={t} onToggle={noop} />)}</ul>
    </>
  );
}
```

另一个是 `useTransition`，典型形状是 `const [isPending, startTransition] = useTransition()`，把要延后的 `setState` 包进 `startTransition` 调用里，并用 `isPending` 驱动 UI 上的过渡态（例如「搜索中…」）。两者的取舍：

| 手段 | 你需要改什么 | 适合 |
| --- | --- | --- |
| `useDeferredValue` | 只在消费处换变量，输入 state 不动 | 值来自别人（props / 上层 state），你无法在源头包 transition |
| `startTransition` | 在**触发更新的地方**包一层 | 你自己发起这次更新，且想在同一处拿到 pending 状态 |

<Callout type="unverified" title="延后更新的 API 细节请以参考页当前版本为准">

本节按 React 18 引入时的稳定语义给出 `useDeferredValue` / `useTransition` 的用途区分。**本章没有逐字核实它们在当前版本的完整签名与行为**（尤其是否支持把异步函数直接作为 transition 作用域传入、`isPending` 覆盖范围在后续版本里的扩展），核实尝试未成功。写代码前请对照 [`useTransition` 参考](https://react.dev/reference/react/useTransition) 与 [`useDeferredValue` 参考](https://react.dev/reference/react/useDeferredValue) 当前内容。

还要知道一条边界：这两个 API **不会让渲染变快**，它们只是把更新的优先级降低、允许你中途放弃或延后。列表本身还是渲染了那么多东西。真正的收益来自「输入不再等待列表渲染」，即交互延迟下降，而不是总工作量减少。

</Callout>

## React Compiler 之后，手动记忆化还剩多少

`memo` 参考页现在明确写着：React Compiler 会自动为所有组件施加等价于 `memo` 的优化，启用编译器后通常不再需要手写 `React.memo`，可以从组件上移除。

本站的态度是三条：

1. **手动记忆化的知识仍然必须学。** 存量项目绝大多数没启用编译器；而且编译器的失效条件恰恰是「引用不稳定」「依赖不纯」——不懂本章机制的人，写出的代码编译器也优化不了。
2. **不要在新项目里无条件加 `memo`/`useMemo`/`useCallback`。** 先测，只有 Profiler 显示被无关更新牵连的组件才处理。
3. **编译器状态属于时效性风险最高的部分**，它是否可用于生产、默认开启与否、与哪些写法冲突，都在演进。本站不给结论，只给判据：**你在做「记忆化」决策时依据的是测量结果，而不是框架传闻。** 具体可用状态请看 [React Compiler](https://react.dev/learn/react-compiler) 页面顶部标注。

## 定位流程：没有 Profiler 就别优化

固定路径，五步，不要跳：

1. 装 React Developer Tools，打开 **Profiler** 面板，勾选「Record why each component rendered」（不同扩展版本措辞略有差别）。
2. 点录制，做一次交互（比如敲一个字符），停止。
3. 火焰图按渲染耗时排序，先找**耗时最高的那几个组件**，再问它**该不该出现**。
4. 选中可疑组件，看更新原因（props 变化 / state 变化 / Context / 父组件重渲染 / Hook）。
5. 按原因分派修法：

| Profiler 显示的原因 | 含义 | 对应修法 | 回指 |
| --- | --- | --- | --- |
| Did not re-render（虚线/未出现在火焰图） | `memo` 生效了 | 无需处理 | —— |
| Props（某个 prop 变了） | 父组件传下来的引用变了 | 检查父组件的派生对象；把 props 拆成原始值 | 第 4 章 |
| Hooks / state | 组件自身 state | 派生值别存成 state；state 下沉 | [第 3 章](/react/state)、[第 5 章](/react/use-effect) |
| Context | Provider 的 value 变化 | 拆 Context；或换带选择器的 store | [第 6 章](/react/context)、[第 9 章](/react/state-management) |
| Parent rendered（无 props 变化） | 向下传播渲染，没有 `memo` | 给该组件加 `memo` + 稳定它的 props | 本节 |

一个替代手段是 DevTools 的「高亮更新」开关（在组件更新时给对应 DOM 描绿边）。它在「说不清到底哪一块在抖」时非常有效——肉眼看边界比看火焰图快。浏览器性能面板里的 JavaScript 采样能进一步告诉你「渲染之后卡在哪儿」，那部分属于[浏览器渲染机制](/frontend-engineering/rendering-pipeline)和[性能指标](/frontend-engineering/performance)的范围。

## 常见错误与排查

1. **给 `memo` 组件传了内联函数或内联对象，memo 完全无效。** 现象：加了 `memo`，Profiler 里该组件照样每轮出现，更新原因是 Props。原因：`onClick` 传的是箭头函数、`meta` 传的是内联对象字面量，每次渲染都新建，`Object.is` 必然不等。怎么确认：在子组件里 `console.log(prev, next)` 或直接把该 prop 打印成 `id`，看引用是否变化；Node 里 `Object.is({}, {})` 为 `false` 已验证。怎么修：函数用 `useCallback`（并把真实依赖写全），对象拆成原始 props 或用 `useMemo`；如果父组件本身不该渲染，问题在更上层。
2. **`useMemo` 依赖数组漏写，界面显示旧数据。** 现象：数据变了但派生结果不动，或者点了两下才刷新。原因：`useMemo(() => arr.filter(f), [])` 之类，计算里读了 `arr` 却没列进依赖，缓存里存的是第一次的结果。怎么确认：把表达式里所有外部变量列出来和依赖数组逐项比对；或临时去掉 `useMemo` 看是否正常。怎么修：补依赖，或直接删掉 `useMemo`（派生值本就不该缓存成语义保证）；根治办法是「派生数据从 state 现算，不要存」。
3. **列表 key 用数组索引，插入/删除后内容错位。** 现象：勾掉第 2 项，第 3 项的勾选跑到第 2 项上；或者输入框里的文字跑到了别的行。原因：key 位置一挪，「同一个 key」指向了不同数据，React 就地改 DOM 属性而复用节点，非受控输入的值和组件实例 state 留在原地。怎么确认：把 key 换成稳定 id 看问题是否消失；或给行组件加 `console.log(task.id)` 对照 key。怎么修：用后端/`crypto.randomUUID()` 生成的稳定 id；纯展示、永不重排、不含内部状态的列表才勉强可以接受索引。
4. **倒计时/滚动位置/鼠标位置这类高频 state 放在共同父组件，整页每秒重渲染。** 现象：DevTools 描边整片绿；性能面板里 scripting 时间随秒数线性增长。原因：向下传播渲染。怎么确认：Profiler 火焰图看这一轮渲染覆盖了哪些子树，更新原因都是「父渲染」。怎么修：**把高频 state 关进一个只渲染那一小块数字的组件**（组件做小，是最有效且零成本的手段），而不是给整页包 `memo`。
5. **以为 `memo` 能挡住 Context 变化。** 现象：主题/用户信息一变，所有包了 `memo` 的消费者仍然重渲染。原因：官方 caveats 明写「即使组件被记忆化，它使用的 Context 变化时仍会重渲染，记忆化只针对父组件传下来的 props」。怎么确认：把 `useContext` 调用临时移出该组件，看是否还更新。怎么修：拆 Context（状态/动作分离），或者换用带选择器的 store 只订阅需要的那个字段。
6. **`useMemo` 包的是数组 `map` 出来的新 JSX，试图「缓存整棵子树」。** 现象：内存涨、依赖数组写不清，收益测不出来。原因：JSX 元素本身就是普通对象，缓存它等于缓存一次对象创建；而且这段 JSX 里闭包捕获了大量旧 props，引用一稳定就产生 stale closure。怎么确认：把这段 JSX 拆成独立组件，在组件里打印它实际依赖的 props。怎么修：**要么把它做成组件并用 `children` 从上层层层传入（不重渲染的上层创建 → React 直接复用），要么把要缓存的东西做小。** 「children 是别人创建的 JSX」是 React 里最被低估的一条优化，比 `useMemo` 包 JSX 稳。
7. **StrictMode 下日志翻倍，误以为渲染了两次是 bug。** 现象：`console.log` 每次交互打两行。原因：开发环境的 StrictMode 会故意双调用组件函数，用来暴露不纯的渲染逻辑，生产构建不会。怎么确认：`main.tsx` 里是否包了 `<StrictMode>`；构建产物里是否只打一次。怎么修：别关 StrictMode，把渲染期里的副作用（发请求、改外部对象）挪到 effect 或事件回调（见[第 5 章](/react/use-effect)与 [React 特有清单](/react/react-only)）。
8. **靠「减 re-render 次数」优化，结果首屏变慢。** 现象：记忆化加满后 TTI 反而变差。原因：每个 `useMemo`/`useCallback`/`memo` 都有依赖比较和额外闭包内存成本，廉价计算上纯亏。怎么确认：删掉一半记忆化再录一次 Profiler 对比。怎么修：只保留能证明收益的那些，其余删除。

## 练习

<Exercise title="练习 1 · 预测这一轮有哪些组件重跑" difficulty="基础">

组件结构如下（省略样式）。`Panel` 有自身 state `count`，`BigList` 是 `memo` 过的组件，props 是 `items`（来自父级模块常量）和 `onPick`（`useCallback`，依赖为空）。

```tsx
const ITEMS = Array.from({ length: 200 }, (_, i) => ({ id: String(i), label: '行 ' + i }));

const BigList = memo(function BigList({ items, onPick }) {
  return <ul>{items.map((it) => <li key={it.id} onClick={() => onPick(it.id)}>{it.label}</li>)}</ul>;
});

function Panel() {
  const [count, setCount] = useState(0);
  const onPick = useCallback((id) => console.log(id), []);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>{count}</button>
      <BigList items={ITEMS} onPick={onPick} />
    </div>
  );
}
```

点按钮时，`Panel`、`BigList`、200 个 `li` 各自的 React 行为是什么？如果把 `BigList` 上的 `memo` 去掉，`li` 组件实例的 state 会不会丢？

<template #answer>

- `Panel` 函数重新执行（自身 state 变化）。
- `BigList` **不重新执行**：`items` 是模块常量的同一引用，`onPick` 因为 `useCallback` 空依赖而引用稳定，`memo` 的 `Object.is` 浅比较每个 prop 都相等。
- 200 个 `li` 是 `BigList` 渲染出来的 JSX，`BigList` 不执行就不会产生新的元素，DOM 不动。
- 去掉 `memo` 后 `BigList` 会重新执行并产出 200 个 `li` 元素，但 `key` 稳定（`it.id`），React 复用原有的 DOM 节点和组件实例，**`li` 内部的 state 不会丢**；代价只是函数重新执行与虚拟 DOM 比较，不是重建。这一点很重要：「重渲染」和「重新挂载」是两件事，只有 key 变化（或位置/类型变化）才导致重新挂载。

追问：`useCallback` 在这里是不是必需的？如果 `ITEMS` 换成 `useMemo` 生成的数组而 `onPick` 不加 `useCallback`，`memo` 还剩多少作用？——答案是只剩一半：任一 prop 引用不稳定，`memo` 就整轮失效。

</template>

</Exercise>

<Exercise title="练习 2 · React 与 Vue 的重渲染范围对照" difficulty="进阶">

同样结构：父组件持有一个 `count`，子组件展示一个与 `count` 无关的静态内容。请分别写出 React（无 `memo`）和 Vue 3 两边「点一次按钮」之后被执行/更新的组件，并说明为什么 Vue 侧不需要 `memo` 也有这个行为。

<template #answer>

React：`Parent` 函数执行 → 渲染出新的 `Child` 元素（props 引用通常也重新创建）→ `Child` 函数也执行 → 产出同样 DOM，虚拟 DOM 比较后发现无属性变化，不动真实 DOM。**执行了两次函数，改动零个 DOM 节点。**

Vue：`Parent` 的渲染 effect 因为读了 `count` 被唤醒，重新执行 `Parent` 的 render 函数；`Child` 是子组件，其更新由**自己的**渲染 effect 决定，而它没有依赖 `count`，因此不执行（子组件实例的 props 未变化时不会触发子树渲染）。

为什么 Vue 不需要 `memo`：Vue 的依赖收集以组件实例为单位记录「这个渲染 effect 读了哪些响应式属性」（`Child` 的 render 函数虽然也是函数调用，但它由编译器 + Proxy 建立了 effect → 属性的边）。React 没有这层边，父组件的函数调用范围就是它的整棵 JSX 子树，所以「跳过子组件」在 React 里必须是显式的（`memo` + 稳定 props，或 children 由不重渲染的上层创建）。

**但代价是双向的**：Vue 为了拿到这层精度付出了 Proxy 拦截、编译期约束（模板里的读取才可追踪，脚本里解构掉响应式属性就丢依赖）和 `shallowRef` 之类的显式逃生口（见[Vue 渲染性能](/vue/rendering-performance)）。React 把这套精度移到了开发者/编译器手里，代价是默认行为更粗。所以两边的性能修法不可照搬：React 侧「状态放太高」是头号病因，Vue 侧「响应式包裹范围过大」是头号病因。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释现象" difficulty="挑战">

下面这段代码运行后：输入卡顿没有改善、React DevTools 报「每次交互渲染 300 次」、且第 5 行输入框里的文字会跑到第 4 行。指出全部问题（至少四处）并给出修法。

```tsx
function Rows({ items, query }) {
  const filtered = items.filter((i) => i.text.includes(query));
  return (
    <ul>
      {filtered.map((item, idx) => (
        <Row key={idx} item={item} style={{ padding: 4 }} onEdit={() => save(item.id, idx)} extra={{ q: query }} />
      ))}
    </ul>
  );
}

const Row = memo(function Row({ item, onEdit, extra }) {
  const [draft, setDraft] = useState(item.text);
  return <li><input value={draft} onChange={(e) => setDraft(e.target.value)} /></li>;
});
```

<template #answer>

1. **`key={idx}`**：过滤后数组内容变了，索引即身份 → 输入框里的 `draft` 属于「第 5 个位置」而不是「这一条数据」，插入/过滤导致内容整体错位。这是「文字跑到上一行」的直接原因。修法：`key={item.id}`。
2. **`onEdit` 与 `extra` 是内联函数/内联对象**：每次渲染新建，`memo` 浅比较必然不等 → 300 行每轮全部重新执行，DevTools 显示大量渲染。修法：删掉不需要的 props；确实要传函数就在父级用 `useCallback`，并且**行组件里应该用 `item.id` 派生，而不是接收闭包了 idx 的函数**。这里 `save(item.id, idx)` 把索引编进回调，与第 1 条是同一个错误的两个面。
3. **`Row` 里的 `useState(item.text)`**：把 props 复制进 state 是反模式——之后 `item.text` 变化不会同步进 `draft`，界面显示旧值，只有卸载重挂才刷新（这正是 key 用索引时它「看起来会刷新」的原因：一直在重挂）。修法：直接用 `item.text` 渲染；确实需要可编辑草稿时，或者受控提到父级，或者给输入框一个基于数据的 `key` 让它在数据换人时重置。
4. **`filtered` 在每次渲染重算，但没有必要包 `useMemo`**：`items.filter` 在 300 项上极便宜，`useMemo` 的依赖比较＋内存成本可能更贵。真正该做的是把 `query` 这个高频 state 挪出「整页共同父」或用 `useDeferredValue` 延后过滤。
5. **`style` prop 传给组件没有意义**：`style` 是保留给 DOM 的，这里传进 `Row` 后 `Row` 也没往下转发，纯属多余的一项 props（还多一次比较）。
6. **`Row` 未使用 `extra`**：说明它在扩展 props 时被遗忘了——`memo` 项目里的多余 props 是隐性成本，删。

修完的顺序也值得记：**先修 key 与 props 形状（正确性 + 引用稳定性），再考虑要不要延后更新，最后才考虑加记忆化。**

</template>

</Exercise>

<Exercise title="练习 4 · 判断该加 memo 还是该改状态结构" difficulty="进阶">

三个场景，各自给出「先做哪一步」：① 一个只有 20 条数据的表格，搜索时不卡，但 DevTools 里整片绿。② 1500 条虚拟滚动列表，每行有内部展开状态，滚动时掉帧，Profiler 显示每帧渲染 40+ 行组件。③ 页面顶部有一个「未读消息数」每秒轮询更新，导致整个侧边栏（十几个菜单组件）每秒重渲染一次。

<template #answer>

① **什么都不做。** 20 行的渲染成本远低于 `memo` 的比较成本，而且「整片绿」不是症状，只是现象。测不出来就不要治——这条纪律能挡住大部分无效优化。
② **先确认行组件是否因为 props 引用不稳而每帧重渲染**（虚拟列表通常在滚动时新建行数据对象）。修 props 形状（传 id + 从 store 取行、或缓存行对象）优先于行级 `memo`；行有内部展开 state 时，还要检查展开状态是否被存在行组件里——虚拟滚动会回收行组件，展开状态应该提升到外部数据源，否则回收后状态丢。加 `memo` 是第二步。
③ **改状态结构。** 未读数属于「高频、单一消费者」的数据，应关进只渲染这个数字的组件（`<UnreadBadge />` 自己发起轮询或订阅 store），侧边栏菜单不读它。这是第 6 章「一个消费者不值得广播」的同一判据；如果未读数被多个远处组件同时读，就换带选择器的 store，而不是 Context（[状态管理选型](/react/state-management)）。

共同点：三个答案里只有 ② 可能真的需要 `memo`。**「先改边界，再谈记忆化」不是口号，它决定了你会不会维护一堆没有收益的依赖数组。**

</template>

</Exercise>

<Exercise title="练习 5 · 用 children 阻断向下传播" difficulty="挑战">

`Page` 持有 `searchText` state，内部渲染 `<Sidebar />`（与搜索完全无关）和 `<ResultList searchText={...} />`。请把 `Sidebar` 的渲染移出 `Page` 的函数体，并解释：为什么这样 `Page` 重渲染时 `Sidebar` 不再重新执行？这个手法和 `memo` 的区别在哪？

<template #answer>

```tsx
function Page({ sidebar, searchText }: { sidebar: ReactNode; searchText: string }) {
  const [keyword, setKeyword] = useState(searchText);
  return (
    <div className="layout">
      {sidebar}
      <ResultList keyword={keyword} onKeywordChange={setKeyword} />
    </div>
  );
}

// 由上层（不因为输入而重渲染的组件）创建这段 JSX
<AppLayout sidebar={<Sidebar />} />
```

机制：`sidebar` 是**在上层组件渲染时创建的 JSX 元素对象**。`Page` 因为自身 state 重执行时，它拿到的 `sidebar` prop 还是同一个元素引用，React 比较新旧元素发现引用相同（元素是同一个对象），就跳过这段子树的重新渲染——`memo` 参考页对「包装组件更新自身 state 时，React 知道 children 不需要重渲染」说的正是这件事。

与 `memo` 的区别：`memo` 是**每次父渲染都要浅比较全部 props**，并且要求所有 props 引用稳定，才能跳过；children 手法不需要比较，也不会因某个不稳定 prop 而整体失效，但它要求「那段 JSX 由不重渲染的组件创建」——如果创建点本身每轮都执行，元素就是新对象，照样重新渲染（这也是第 6 章里那条「children-as-prop 不是 Context 优化手段」的原因）。实际项目里两者常配合：布局壳组件用 children 承接页面内容，页面内部再对昂贵列表用 `memo`。

</template>

</Exercise>

## 官方文档与延伸阅读

- [`memo` 参考](https://react.dev/reference/react/memo) —— **本章 2026-10-17 逐字核实**：默认用 `Object.is` 逐 prop 浅比较；「`Object.is(3, 3)` 为真但 `Object.is({}, {})` 为假」；「即使组件被记忆化，它使用的 Context 变化时仍会重渲染」；「props 在渲染期创建的对象或函数，`memo` 完全无效」；自定义 `arePropsEqual` 必须比较包括函数在内的每个 prop，否则会 stale closure；children-as-JSX 的复用说明；以及 React Compiler 自动施加等价 `memo`、启用后可移除手写 `memo` 的说明。
- [`useMemo` 参考](https://react.dev/reference/react/useMemo)、[`useCallback` 参考](https://react.dev/reference/react/useCallback) —— 用于核实「只应把它们当优化手段，React 允许丢弃缓存并重算」这条语义边界（本章据此说明 `useMemo` 不提供正确性保证）。**这两页本章未逐字核实，动手前请自己对照。**
- [`useTransition` 参考](https://react.dev/reference/react/useTransition)、[`useDeferredValue` 参考](https://react.dev/reference/react/useDeferredValue) —— 核实延后更新的签名与 `isPending` 语义（本章标为 unverified，核实尝试未成功）。
- [理解你的 UI 是一棵树](https://react.dev/learn/understanding-your-ui-as-a-tree) —— 核实协调（reconciliation）与 `key` 的职责：key 决定元素身份与 state 的保留/重置，对应本章「重渲染 ≠ 重新挂载」的区分。
- [State 如同快照](https://react.dev/learn/state-as-a-snapshot)、[更新状态中的数组](https://react.dev/learn/updating-arrays-in-state) —— 第 3 章已详述，本章的「不可变更新只换被改项引用」这条链条的前置依据。
- [React 开发者工具](https://react.dev/learn/react-developer-tools) —— Profiler 面板与「为什么渲染」信息的来源，本章定位流程第 1 步。
- [React Compiler](https://react.dev/learn/react-compiler) —— 核实编译器时代的可用状态（以页面顶部标注为准，本章不给结论）。
- [Vue 渲染机制（中文）](https://cn.vuejs.org/guide/extras/rendering-mechanism.html) 与 [响应式深入（中文）](https://cn.vuejs.org/guide/extras/reactivity-in-depth.html) —— Vue 侧对照依据：以组件为单位的依赖收集、编译器与运行时的分工，用来支撑「为什么 Vue 不需要 `memo`」那张表。
- 站内相关：[两套渲染模型](/react/two-rendering-models)、[useState / useReducer 与不可变更新](/react/state)、[props、回调与 children](/react/props-and-children)、[useEffect 与 watch 的对照](/react/use-effect)、[Context 与 provide / inject](/react/context)、[Vue 渲染性能](/vue/rendering-performance)、[计算属性与侦听器](/vue/computed-and-watch)。

## 下一章

前面 7 章把「一个 React 组件怎么算出来」讲完了，但你的应用不是一棵树，是**一堆由 URL 决定该渲染哪棵树**的页面。[Vue Router](/vue/router) 里你已经习惯了一件事：路由表和守卫是框架管的——`beforeEach` 能在导航真正发生之前拦下来，`route.params` 是响应式的，数据加载要么写在组件生命周期钩子里、要么交给上层元框架。React Router 的形态完全不同：路由既可以用对象数组声明，也可以直接在 JSX 里写；数据加载是路由库的一等能力（loader / action），而**全局守卫这种东西不存在**，你得把它改写成「重定向 + 组件结构」。下一章 [React Router 与 Vue Router 对照](/react/router)逐项对照这四种形态、`Outlet` 与 `<router-view>` 的差别、loader 与「在 effect 里请求」的时间线差异，以及路由参数的类型化为什么在两边都不是免费的。
