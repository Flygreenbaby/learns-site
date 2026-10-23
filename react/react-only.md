# 对照法的盲区：渲染纯度、并发、错误边界与 key 这些 React 独有的东西

四个真实事故，全都发生在「按 Vue 的直觉写 React」的人身上。

**事故一：埋点翻了一倍，于是有人把 StrictMode 关了。** `useEffect(() => { track('page_view'); }, [])` 在开发环境每次都打两次。有人第一反应是「这 React 有 bug」，直接在入口删掉 `<StrictMode>`。两个月后上线，页面里挂着十几个重复的 `resize` 监听器，滚动掉帧——因为那条 cleanup 从来没被写过，而唯一会强制你写它的检测器被自己关掉了。

**事故二：一个空值让整个后台白屏。** 某个详情页读 `todo.tags.join(', ')`，接口少了 `tags` 字段，抛出 `TypeError`。控制台只有一行堆栈，界面上什么都没了——整棵应用被连根拔掉。Vue 里你还有 `onErrorCaptured` 和 `app.config.errorHandler` 可以兜；React 里的答案是**错误边界（error boundary）**，而它到今天仍然要求你写一个类组件。

**事故三：同一屏出现同一个 store 的两个版本。** 一个订阅了外部状态的组件在输入时被并发更新打断，页头显示「在线」、页脚显示「离线」。用 `useEffect` + `useState` 手写订阅的组件在快速输入时最容易撞到这个（tearing，撕裂）。React 专门提供一个 `useSyncExternalStore` 来解决它，而 Vue 的响应式模型里**根本不存在这个问题**——因为所有组件在同一轮渲染里读的是同一份可变数据。

**事故四：换 key 之后所有状态都没了。** 有人为了让某个面板「重新渲染」，把它的 `key` 从 `panel.id` 改成了自增计数器。界面确实刷了，但里面填了一半的表单、滚动位置、正在播的动画全没了。因为 React 的 `key` 不只是 diff 提示，它是**身份**：key 变 = 卸载重建。

这四件事的共同点是：它们都不是「Vue 的某个东西换了名字」。前 10 章的对照法在这里失效，所以本章单独收口。前置：[两套渲染模型](/react/two-rendering-models)、[useState 与不可变更新](/react/state)、[useEffect 与 watch 的对照](/react/use-effect)、[重渲染机制与性能](/react/re-render-performance)。

<Callout type="info" title="本章的核实口径与风险分级">

本章只在 2026-10-17 成功核实了两件事：`useRef` 参考页里「组件必须是纯函数、不要在渲染期读写 ref、并发与服务端相关特性会因此失效」这段要求（[useRef](https://react.dev/reference/react/useRef)），以及[领域首页](/react/)已列出的官方页面清单。

**StrictMode 的双调用完整清单、错误边界是否有 Hook 形态、React 各版本冻结 props/state 的具体行为、服务端组件的 API 名称，本章未逐条核实。** 涉及这些地方的写法都统一为「以官方文档当前版本为准」并给出链接，不写具体版本号，也不给可复制的生产模式。领域首页的版本说明把 RSC 一节标为本领域时效性风险最高，这个判断本章全盘继承。

</Callout>

## 渲染函数必须是纯的：这条要求的来源与后果

React 的要求是：**组件函数在给定相同 props、state、context 的情况下必须返回相同的 JSX，并且不产生任何副作用。**官方把它叫作「组件必须是纯函数」，并在 `useRef` 参考页明确点出违反它的后果——行为不可预测，且与并发渲染、服务端渲染相关的能力不兼容。

「副作用」在这里的范围比你想的宽：

| 渲染期的这段代码 | 纯吗 | 为什么 |
| --- | --- | --- |
| `const total = items.filter(i => i.done).length` | 纯 | 只读入参、只算不写 |
| `historyRef.current.push(value)` | **不纯** | 写了跨渲染的盒子（第 10 章那条禁令） |
| `setCount(count + 1)`（在函数体里直接调） | **不纯** | 渲染触发渲染 → 无限循环（`Maximum update depth exceeded`） |
| `const id = Math.random()` / `Date.now()` | **不纯** | 同样输入两次调用得到两个结果 |
| `const el = document.createElement(...)` | **不纯** | 碰了 React 之外的世界 |
| `window.localStorage.setItem(...)` | **不纯** | 同上；而且一次渲染可能被丢弃，写出去撤不回 |
| `const uid = useId()` | 纯 | 这是 React 为「渲染期需要一个稳定唯一值」专门给的替代品 |

Vue 为什么相对宽松：`setup` 每个实例**只执行一次**，你在里面写 `const start = Date.now()` 得到的是一次性的初始化，之后每帧复用它；真正的渲染函数由编译器从模板生成，你不手写、也很少碰到。React 的组件函数**就是**渲染函数，它被调用几次由调度器决定，不由你决定。

同一段代码的两种命运：

```tsx
// React：每帧重算，「随机头像」会在任何一次父级渲染时换一张
function Avatar({ name }: { name: string }) {
  const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
  return <span style={{ background: palette }}>{name}</span>;
}
```

```vue
<!-- Vue：setup 一次，palette 固定 -->
<script setup lang="ts">
const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
</script>
```

| 需求 | React 的地道写法 | Vue 写法 |
| --- | --- | --- |
| 组件生命周期内取一次随机/时间 | `useState(() => pick())` 惰性初始值 | `setup` 里一个普通变量 |
| 渲染期需要唯一 ID（label 与 input 关联） | `useId()` | 模板里 `:id` 自己拼，或 `useId`（3.5+） |
| 需要「上一次的值」 | 放进 state/reducer，或 effect 里维护 ref | `watch` 的 `oldValue` |
| 渲染时同步外部世界 | 一律搬到 `useEffect`（并写 cleanup） | `onMounted` / `watch` |

**排障用法**：出现「界面偶发不对，但刷新就好了」「开发环境数字翻倍」「水合（hydration）报错」这三类症状时，第一优先怀疑渲染期副作用，而不是状态更新。

## StrictMode：开发环境双跑是设计，不是 bug

开启 `<StrictMode>` 后，React 在开发环境会**故意多调用一次**你的组件函数（以及其他有状态的初始化路径），并且在挂载阶段做一轮 `setup → cleanup → setup`。官方的判据非常好用：

> 用户应当无法区分「生产环境跑一次」与「开发环境多跑一轮」。

也就是说，双跑不是 bug 的来源，它是**你缺少清理与不纯的直接显示器**。

| 你看到的现象 | 真实原因 | 正确修法 | 错误修法 |
| --- | --- | --- | --- |
| `page_view` 埋点打两次 | effect 里没有可撤销的语义，被双跑暴露 | 埋点属于事件/挂载的一次性动作 → 用惰性初始化、模块级单例或数据层；能撤销的才放 effect | 加 `const didInit = useRef(false)` 当保险丝 |
| 请求发两次 | 同上 | 用 `AbortController` 在 cleanup 里 `abort()`（第 5 章） | 关掉 StrictMode |
| 「组件挂载了两次」日志 | 双执行的正常结果 | 让 setup 与 cleanup 镜像对称 | 用 `key`  tricks 阻止重挂 |
| 监听器越加越多 | effect 有依赖却只在卸载时移除 | `addEventListener(..., { signal })` + cleanup `abort()` | 用 `useRef` 计数强行只加一次 |
| 第三方图表实例创建两个、界面上只剩一个 | `new` 在渲染期，而 cleanup 里没有 `destroy` | 实例存 `useRef`，创建/销毁成对放 effect | 给库加全局单例 |

关于「双跑到底覆盖了哪些代码」，官方在 [StrictMode 参考](https://react.dev/reference/react/StrictMode)里有一份清单（组件函数、state 初始化函数、`useMemo` / `useCallback` 的计算函数、effect 的 setup/cleanup 等）。**清单条目会随版本增删，动手前核对那一页**，别背本站的列表。较新版本的 React 在开发环境下还会尝试冻结 props、state 与 Hook 的返回值，以便把「就地修改」立刻变成错误——这正是[useState 与不可变更新](/react/state)里那条「不要直接改 state 对象」的强制版本；**这条能力出现在哪个版本、以什么方式提示，本章未核实**。

<Callout type="unverified" title="不要为了消除双跑而改动业务代码">

上面「冻结」「双调用清单」两处属于版本敏感结论，本次未成功抓取到官方页面正文（抓取被限流）。请把这一小节当作「知道有这些机制、并且别去对抗它」的提醒；任何依赖「effect 只跑一次」的实现都是错的，无论版本。

</Callout>

## 并发渲染：一次更新可以被中断、丢弃与重放

第 7 章从性能角度讲过 `useTransition` / `useDeferredValue`；这里要讲的是它对**代码写法**的要求，因为 Vue 里没有对应概念。

一句话机制：React 可以把一次渲染拆成多段，中间让出主线程去做更紧急的事；被中断的那次渲染**可能被完全丢弃并稍后重放**。因此：

| 你写的东西 | 在一次被丢弃的渲染里会怎样 | 结论 |
| --- | --- | --- |
| 计算 JSX、filter/sort 数组 | 白算一次，无副作用 | 安全 |
| 修改 `ref.current` | 改了，撤不回 | 不安全（第 10 章禁令的根本原因） |
| 调 `setState` | 又排一次更新，可能循环 | 不安全 |
| 发请求 / 打埋点 / 写 `localStorage` | **已经发出去了** | 不安全，必须放到事件处理器或 effect |
| `Math.random()` / `Date.now()` | 重放后得到不同结果 | 不安全 |

对照 Vue：Vue 的更新是「一次性算完再打 DOM」，不存在「同一帧渲染被丢弃」这种调度形态（它有批处理与 `nextTick`，但语义是合并而非中断重放）。所以你在 Vue 里养成的「渲染时顺手同步点外部数据」的习惯，在 React 里从「不优雅」升级为「会出 bug」。

实践判据只有一条：**这段代码如果被执行两次或零次，世界会不会不一样？** 会 → 它不属于渲染期。

## useSyncExternalStore：把外部 store 订阅成一致的值

前面那个「页头在线、页脚离线」的事故有标准解法。`useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?)` 三个参数：

| 参数 | 要求 | 写错的后果 |
| --- | --- | --- |
| `subscribe(callback)` | 注册监听，**返回一个取消订阅函数**；`callback` 被调用时 React 会重新取快照 | 返回 `undefined`/返回 subscribe 本身 → 订阅泄漏或收不到更新 |
| `getSnapshot()` | 对同一个外部状态必须返回**同一个值/同一个引用**；每次渲染都被调用 | 每次新建对象 → React 认为状态一直在变 → 无限重渲染，控制台给出「快照应被缓存」类警告 |
| `getServerSnapshot()` | 可选，服务端渲染时用的快照 | 服务端渲染场景不传 → 直接报错要求补 |

```tsx
function useOnline(): boolean {
  return useSyncExternalStore(
    (callback) => {
      window.addEventListener('online', callback);
      window.addEventListener('offline', callback);
      return () => {
        window.removeEventListener('online', callback);
        window.removeEventListener('offline', callback);
      };
    },
    () => navigator.onLine,
    () => true,            // 服务端不知道用户网络状态，给一个稳定初值
  );
}
```

如果要订阅的是对象（比如外部 store 的 `getState()`），必须让快照本身可缓存——常见做法是订阅整个 store 然后返回 `store.getState()`（同一状态返回同一引用，因为库内部不复制），或自己加一层 memoized selector。**不要在 `getSnapshot` 里写 `() => ({ ...store.getState() })`**，展开就是每次新引用。

为什么 `useEffect` + `useState` 手写订阅不够：那条路径是「渲染 → 提交 → effect 里订阅 → 数据变了 → setState → 再渲染」，中间存在窗口；在并发渲染里，React 可能在订阅生效前后取到不同版本，于是**同一屏不同组件读到两个值**（tearing）。`useSyncExternalStore` 让 React 知道「这个值来自外部且可能被并发打断」，从而在渲染时做一致性检查并在必要时同步重新渲染。

Vue 对照，值得单独记：

| 维度 | Vue + Pinia / Vuex | React + 外部 store |
| --- | --- | --- |
| 数据存在哪 | 响应式对象，全应用同一份可变数据 | 通常是不可变快照 + 订阅通知 |
| 谁保证一致 | 依赖追踪 + 同一轮 flush，天然一致 | 需要 `useSyncExternalStore` 显式保证 |
| 需要写适配层吗 | 不需要 | Redux / Zustand 这类库内部已经用了它，你只管 `useSelector` / hook |
| 自己封装库时 | `ref` + `onCleanup` 就够 | 必须走这个 Hook |

所以：**自己订阅第三方状态库、浏览器 API、`localStorage` 跨标签页同步时用 `useSyncExternalStore`；不要用 `useEffect` 手写；也不要把 `useEffect` 版重构「顺便」换掉**——[useEffect 与 watch 的对照](/react/use-effect)里已经说过，它不是「更好用的 effect」。库的选型见[状态管理选型](/react/state-management)。

## Error Boundary：目前还得写类组件

错误边界是「包裹一段子树，捕获其中渲染期抛出的错误，显示兜底 UI」的组件。它的关键事实：

| 事实 | 说明 |
| --- | --- |
| 只能由**类组件**声明 | 需要 `static getDerivedStateFromError()`（把错误映射成兜底 state）与 `componentDidCatch()`（上报日志）两个钩子之一 |
| 捕获范围有限 | 只捕获**渲染、生命周期、构造器**里的错误；不捕获事件处理器、异步回调（`setTimeout`、Promise）、服务端渲染、以及被边界自己抛出的错误 |
| 一旦进入错误态就不会自动恢复 | 要自己提供「重试」，标准做法是给被包裹的子树换一个 `key` 让它重挂 |
| 函数组件方案是库 | 社区普遍用 `react-error-boundary` 这类封装；本站不推荐具体库，只说结论：**别自己重复造轮子，造之前先读官方那页** |
| 版本敏感 | React 是否已提供官方的函数式错误处理能力，本章未核实；以 [Component 参考里的 error boundaries 一节](https://react.dev/reference/react/Component)当前说法为准 |

本站唯一允许你写类的地方：

```tsx
class TodoBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };                      // 渲染前把兜底 UI 决定下来
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportToSentry(error, info.componentStack);   // 上报，不做 UI
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert">
          <p>这个面板出错了。</p>
          <button onClick={() => this.setState({ failed: false })}>重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// 用法：边界只包住会出事的那一小块
<TodoBoundary>
  <TodoDetail id={id} key={id} />
</TodoBoundary>
```

「重试」按钮那句 `setState({ failed: false })` 常常不够：子树抛错多半是数据本身坏，重试还是抛。真正能救的是 `key` 换值（重新挂载，配合 store 里重新拉数据）或路由级回退。

对照 Vue：

| 需求 | Vue | React |
| --- | --- | --- |
| 兜住子组件渲染错误 | `onErrorCaptured`（组合式钩子，返回 false 阻止继续上抛） | 类组件边界，函数组件靠库 |
| 全局兜底 | `app.config.errorHandler` | 没有官方等价物；实践是根边界 + 顶层 `window.onerror` / `unhandledrejection` |
| 捕获事件处理器里的错误 | 同样捕获不到（都归浏览器/`errorHandler`） | 一样：写在 `try/catch` 或 handler 层 |
| 与路由的错误页 | `router.onError` / 路由 `errorComponent` | React Router 有对应能力，见[React Router 与 Vue Router 对照](/react/router) |

结论直给：**React 的错误边界是它 API 表面上一处真实缺口**，网上「React 更现代」的说法在这一条上不成立。你要做的不是抱怨，而是：在项目里放两三个边界（路由级 + 危险面板级），并把「事件处理器里的错误要自己 catch」写进团队约定。

## key 的语义差别：React 里它是身份，不是提示

第 7 章已经从协调角度讲过 index key 的错位事故，这里只讲**语义**差别，因为这几条决定了你能不能看懂真实 React 项目里的写法。

| 维度 | React | Vue 3 |
| --- | --- | --- |
| 写在哪 | 元素/组件的 `key` prop；Fragment 也能带 key（`Fragment` 是少数能带 key 的包装，见 [JSX 与模板的对照](/react/jsx)） | 元素/组件/`<template v-for>` 上的 `:key` |
| 子组件能读到吗 | **不能**，`key` 是保留 prop，`props.key` 为 `undefined` | 同样不进 props |
| 作用域 | 同一层兄弟之间唯一即可，不必全局唯一 | 同 |
| 换 key 的后果 | **卸载并重建**该子树：state 归零、effect cleanup、DOM 节点重建、焦点丢失 | 该节点被重建（同一方向，但 Vue 项目里极少这样用） |
| 「用它重置状态」 | **官方推荐的正式手段**：切换用户时给评论框 `key={userId}`，比 `useEffect(() => setComment(""), [userId])` 好（第 5 章清单第 6 条） | 也认这一招，但更常见的是直接改响应式值或换 `v-if` |
| 用 index 的风险 | 就地复用 DOM，非受控输入残留上一项内容、动画重放、`memo` 失效 | 同族故障，勾选串位（[阶段项目翻车点](/vue/project)里那条） |
| 异步/并发下的要求 | key 必须稳定可预测（同一条数据在任何一次渲染里给出同一个 key），否则 Suspense/并发场景可能误当新元素 | 无此额外要求 |
| 服务端渲染/水合 | key 不一致会直接导致水合错位 | 同族问题 |

第三条最容易忘：**同一个列表里 key 冲突不会报错，只会行为诡异**（React 可能渲染不出来或复用错节点）。而「key 用标题文本」这种写法，在标题可重复时就是同一条 bug。生成 id 的做法在纯前端阶段用 `crypto.randomUUID()`（[Web API](/javascript/network-and-storage)）。

一段能体现差别的代码：

```tsx
// 官方推荐：切用户 = 换身份 = 评论框自动清空，没有 effect
<Comments key={userId} />
```

Vue 里的等价直觉是「`comments.value = ''`」，因为清空数据更便宜；而在 React 里手写清空要么多一轮渲染、要么漏字段。**这就是「心智模型转换」的具体形态**：React 想的是「这块 UI 是谁」，Vue 想的是「这份数据现在是什么」。

## Hooks 的规则为什么存在：调用顺序就是存储位置

规则只有两条（官方表述）：只在最顶层调用 Hook，不在循环、条件、提前 return 之后调用；只在 React 函数里调用。

第二条是命名约定问题，第一条是**实现机制问题**：React 按调用顺序把每个 Hook 的状态串在这条组件实例的记录上。所以：

```tsx
// ❌ 顺序不稳定：第 2 帧少调一次，slot 2 的 state 被当成 slot 3 用
function Bad({ advanced }: { advanced: boolean }) {
  const [a, setA] = useState(0);
  if (advanced) { const [b, setB] = useState(0); /* ... */ }
  const [c, setC] = useState(0);
}

// ✅ 条件放进 Hook 内部
function Good({ advanced }: { advanced: boolean }) {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  useSomeEffect(advanced);          // 让 Hook 自己 early return，而不是不叫它
}
```

Vue 的组合式 API 完全没有这条限制，因为 `setup` 只执行一次、每个 `ref()` 都是独立闭包，跟「第几个」无关。但 Vue 有另一条同类约束：生命周期钩子必须在 `setup` 顶层**同步**注册，`await` 之后再注册会静默失效（[生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject)）。两条规则保护的其实是同一件事——**框架记录你意图的那个序列不能被你的控制流打乱**。

| 维度 | Vue 组合式 | React Hooks |
| --- | --- | --- |
| 能否条件调用 | 能 | 不能（报错文本含 Hooks called in different order 一类措辞） |
| 状态存在哪 | 闭包里的响应式对象 | 组件实例上按顺序排列的记录 |
| 每帧重新执行 setup 吗 | 不，setup 一次 | 组件函数每帧重跑 |
| 值在回调里会不会过期 | 响应式，读 `.value` 总是最新 | **会**（stale closure，[state 如同快照](/react/state)） |
| 怎么跨渲染存可变值 | 普通 `let` | `useRef` |
| lint 保护 | 无对应必需规则 | `react-hooks` 插件近乎必需（`exhaustive-deps` 见第 5 章） |

## Portal 与 Teleport：DOM 位置跟着 portal 走，React 树位置不变

`createPortal(children, container)` 把内容渲染到 DOM 树的别处（通常是 `document.body` 下你自己的一个挂载点），但**它在 React 树里仍然是原来的子组件**。由此得到两条语义，都是排障关键：

| 语义 | 结论 |
| --- | --- |
| 事件冒泡 | 按 **React 树**冒泡，不按 DOM 树。portal 里的 `click` 会冒到包裹它的父组件 handler，即使 DOM 上它们毫无关系 |
| 错误边界 | portal 内容抛出的渲染错误**仍被它的 React 祖先边界捕获** |
| Context | 照常能读到祖先 Provider 的值（这正是它比「在 body 里手挂一个组件」强的地方） |
| 样式/CSS 继承与层叠 | 按 **DOM 树**：CSS 继承、层叠上下文、`overflow: hidden` 裁切都看真实位置（这是它被用来解决弹层被裁问题的原因，见[定位与层叠上下文](/css/positioning-and-stacking)） |
| 服务端渲染 | `document` 不存在，portal 的容器要判空或在 effect 里取 |

```tsx
function Modal({ children, onClose }: Props) {
  const host = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    host.current = document.getElementById('modal-host') ?? document.body;
    setMounted(true);
  }, []);

  useEffect(() => {                              // Escape 关闭：外部系统同步
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!mounted || !host.current) return null;
  return createPortal(<div className="modal">{children}</div>, host.current);
}
```

对照 Vue 的 `<Teleport to="#modal-host">`：用途一致（把内容传到别处、逃离父级裁切），Vue 里通常不需要 JS 就能写。两条差异要注意：**Vue 的 Teleport 内容同样沿组件树传播事件与错误**（两边这条一致，容易猜错），而 Vue 的 `<Teleport :disabled>` 可以就地渲染、React 需要自己判环境。焦点管理、`aria-modal`、背景滚动锁这些两边都不管，得自己写（[无障碍](/javascript/accessibility-and-performance)、[表单](/html/forms)）。

## Suspense、lazy 与懒加载：概念对得上，能力不对等

React 侧：`const Detail = lazy(() => import("./TodoDetail"))`，外面包 `<Suspense fallback={<Skeleton />}>`。`lazy` 的工厂返回一个 Promise，React 在等待期间渲染 `fallback`；**Suspense 的边界语义是「这段 UI 还没准备好」，它可以被嵌套、可以有多个同时挂起**。

| 需求 | React | Vue 3 |
| --- | --- | --- |
| 路由级代码分割 | `React Router` 的数据/懒加载能力（见[对照章](/react/router)） | 路由表里 `() => import(...)`，天然异步 |
| 组件级懒加载 + 加载态 | `lazy` + `Suspense` | `defineAsyncComponent({ loader, loadingComponent, timeout })` |
| 等待的不只是 chunk（数据） | `Suspense` 设计目标是通用的，配合框架/请求库才实用；**手写「在渲染里抛 Promise」不是本站推荐模式** | Vue 的 `<Suspense>` 存在但长期标注为实验性、限制较多（版本敏感，本站不核实） |
| 兜底 UI 的粒度 | 由你把 `<Suspense>` 放在哪一层决定 | 由 `loadingComponent` 决定 |

本站口径：**把 `Suspense` 用在小处**（路由出口、图片占位、懒加载面板），不要指望它替代 loading/error 三态；服务端数据获取走框架或请求库（[useEffect 与 watch 的对照](/react/use-effect)里「effect 里取数据的局限」一节已经把理由列全）。

## 服务端组件：知道边界在哪就够了，本站不教写法

这条线必须单独说，因为**对照法在这里彻底失效**——Vue 生态里没有与之对应的东西（Nuxt 提供 SSR 与 hydration，但没有「组件在服务端渲染成可序列化描述」这一层）。

只需要建立三个区分：

| 概念 | 在服务端做什么 | 产物 | 与客户端组件的关系 |
| --- | --- | --- | --- |
| SSR（服务端渲染） | 把组件跑成 HTML 首屏 | HTML 字符串/流 | 客户端随后 hydration，两边都有 |
| 流式渲染 | 分块把 HTML 推出去，配合 Suspense 边界 | 多个 chunk | React 与 Vue 都有类似能力，细节不展开 |
| React Server Components（RSC） | 组件在**构建/请求时**于服务端执行，可直连数据源，不进客户端 bundle | 序列化的组件树（不是 HTML） | 客户端组件用 `'use client'` 划出边界，服务端组件渲染它们 |

`'use client'` 这个标记的真实含义，是本章唯一值得写下来的可操作结论：**它划的是「从这里往下可以用 state、effect、事件处理器和浏览器 API」的范围**。因此：

- 带 `useEffect` / `onClick` / `useRef` 的组件必须在客户端边界之内；
- 服务端组件传给客户端组件的 props 必须可序列化——**函数、class 实例、DOM 节点传不过去**（要传交互就得把 children 传下去）；
- 一个第三方库如果在导入时就碰 `window`，它只能出现在客户端组件里，很多老库的兼容问题就是这么来的。

<Callout type="unverified" title="这一段刻意不给代码">

RSC 与配套的数据获取、表单动作（form actions）等能力的**具体 API 名称、可用性、构建工具支持度**在 2026 年仍在演进，领域首页把它列为本领域时效性风险最高的一节，本章全盘继承：**不写可复制模式、不写版本号、不写文件命名约定**。要读，只读官方 [Server Components 参考](https://react.dev/reference/rsc/server-components) 当前版本，并留意页面顶部的状态标注。读一个真实项目时，你只需要能认出「这是边界声明」，不需要会设计它。

</Callout>

对你的实际影响：如果这份工作只是维护一个纯客户端 React 应用（本站第 1–10 章覆盖的范围），RSC 可以先不学；如果是接手 Next/Remix 这类带服务端渲染的项目，上面三个区分能防止你把「服务端组件里不能用 Hook」当成 bug 去改。

## 常见错误与排查

1. **埋点/effect 跑两次，把 StrictMode 关掉。** 现象：开发环境所有 effect 都双跑，团队抱怨后入口删了 `<StrictMode>`。原因：不是 React 有问题，是 effect 缺 cleanup。怎么确认：临时把 StrictMode 打开，看是否 setup/cleanup/setup 三段齐全（`console.log` 两端各加一行）。怎么修：补对称清理，优先 `AbortController` 的 `signal`；确实只做一次的动作移出 effect。
2. **`getSnapshot should be cached` 类警告 + 无限重渲染。** 现象：接了个外部 store 之后页面卡死，React 报「Maximum update depth」或快照相关警告。原因：`useSyncExternalStore` 的 `getSnapshot` 每次返回新对象（`{ ...state }`、`state.map(...)`）。怎么确认：把快照换成一个稳定原始值（如 `store.version` 或 `selector` 结果）看是否立刻正常。怎么修：让库自己提供稳定引用，或在 store 层缓存派生结果；不要靠 `useMemo`「稳定」它——渲染期读的东西本来就不该出现在这里。
3. **一个子组件抛错，整页白屏。** 现象：控制台有堆栈，界面上什么都不剩。原因：没有任何错误边界；React 的错误策略是「边界以下全部卸载」。怎么确认：临时在根上包一个边界类组件，界面变成兜底文案就是它。怎么修：路由级 + 危险面板级各放一个边界；事件处理器里的错误另行 `try/catch`（边界不捕获，见上表）。
4. **portal 里的点击触发了父级 handler，或反过来「DOM 上明明嵌套却在 React 里没冒泡」。** 现象：modal 里点按钮，父级列表行的 `onClick` 也跑了一次；或你在 `document` 上加的监听漏掉了 portal 内容。原因：事件冒泡按 React 树、CSS 与裁切按 DOM 树。怎么确认：在两级 handler 里打印 `e.currentTarget` 与 `e.target`。怎么修：portal 边界处显式 `e.stopPropagation()`（注意它挡不住原生 `document` 监听），或把交互改成 Context/回调，而不是靠冒泡。
5. **改 key 之后表单和滚动位置全丢。** 现象：给面板 `key={counter++}` 后，一切「刷新」都变成「重置」。原因：key 是身份，换 key 就是卸载重建（DOM 节点新建，focus 与滚动都在新节点上）。怎么确认：把 key 改回数据 id，症状消失。怎么修：只在「确实要重置 state」时换 key，而且用**数据身份**（`userId`、`draftId`）当值，不用自增计数。
6. **在条件分支里调用 Hook。** 现象：报 Hooks 相关的顺序错误，或者切 tab 后 state 莫名错位。原因：违反调用顺序规则。怎么确认：搜索文件里 `if (` / `.map(` 内部是否出现 `use`。怎么修：条件放进自定义 Hook 内部；或把这块 UI 拆成一个独立组件——**组件级早退是合法的，Hook 级早退不合法**。
7. **把 `useSyncExternalStore` 当通用订阅 Hook 用。** 现象：WebSocket、图表实例、`addEventListener` 全塞进去，代码看不懂。原因：它只解决「外部 store 的一致性快照」这一件事。怎么确认：问自己「我是在订阅一个有当前值的数据源，还是在同步进出一个有生命周期的系统」。怎么修：后者回到 `useEffect` + cleanup（[useEffect 与 watch 的对照](/react/use-effect)）。
8. **在「服务端组件」里加 `useState` 调了半天。** 现象：报客户端/Hook 相关的构建期错误，或行为在本地与部署环境不一致。原因：越过了 `'use client'` 边界。怎么确认：看文件顶部有没有那句声明；把它加到真正需要交互的最小组件上。怎么修：**边界尽量下推到叶子组件**，父级保持服务端、把 children 传下去。具体报错文案与规则以官方 RSC 页面为准，本站未核实。

## 练习

<Exercise title="练习 1 · 找出这段组件里的四处渲染期副作用" difficulty="基础">

```tsx
function Dashboard({ todos }: { todos: Todo[] }) {
  const seenRef = useRef<Set<string>>(new Set());
  todos.forEach((todo) => seenRef.current.add(todo.id));

  if (seenRef.current.size > 10) setLimit(true);

  const stamp = Date.now();
  document.title = `待办 ${todos.length} · ${stamp}`;

  return <p>{todos.length}</p>;
}
```

逐条指出为什么不行，并给出改法。

<template #answer>

1. **渲染期写 ref**（`seenRef.current.add`）：违反纯度，且一次渲染可能被并发丢弃，`Set` 会累积脏数据。改法：放进 `useEffect`，或者干脆派生 `const ids = todos.map(t => t.id)`——需要「历史累计」的话把它做成 state 的一部分。
2. **渲染期直接 setState**（`setLimit(true)`）：条件为真就无限循环（`Maximum update depth exceeded`）。改法：这是「派生值」，不该是 state——`const tooMany = seen.size > 10` 直接算；确实是用户动作造成的就在 handler 里 set。
3. **渲染期读 `Date.now()`**：不纯，重放得到不同结果，服务端渲染与水合必然不匹配。改法：需要时间戳就放进 state（惰性初始化一次）或来自 props/store。
4. **渲染期写 DOM**（`document.title`）：外部系统副作用。改法：`useEffect(() => { document.title = ...; }, [todos.length])`；`stamp` 别进依赖，否则每帧改一次。

第 3 与第 4 条在 Vue 里几乎不会出问题，因为这段代码本来就得写在 `setup` 或 `watchEffect` 里——**这正是对照法失效的一处**。

</template>

</Exercise>

<Exercise title="练习 2 · 判断谁会被重放，并设计清理" difficulty="进阶">

StrictMode 开发环境下，下面这个 effect 一共执行了几次 `setup` / `cleanup`？如果把 `signal` 那行删掉，会不会留下两个监听器？

```tsx
useEffect(() => {
  const controller = new AbortController();
  window.addEventListener('resize', onResize, { signal: controller.signal });
  chartRef.current = new Chart(elRef.current, options);
  return () => {
    controller.abort();
    chartRef.current?.destroy();
  };
}, [options]);
```

<template #answer>

挂载阶段 StrictMode 会做 `setup → cleanup → setup`，因此**两次 setup、两次 cleanup（第一次 setup 之后紧接着一次 cleanup）**；卸载时再执行最后一次 cleanup。依赖 `options` 变化时，React 先用旧 closure 跑 cleanup，再跑新 setup——这也是两次成对。

删掉 `{ signal: controller.signal }` 的后果：`addEventListener` 没配对 `removeEventListener`（`onResize` 是每次渲染新建的函数引用，即使写在 cleanup 里也未必摘得掉），于是每轮 setup 加一个监听器，页面挂上 N 个 handler。`Chart` 因为没有 `destroy`（假设它也漏了）会留下孤儿 canvas。

判据背下来：**「无法区分跑一次与跑两轮」**。测试方法：在 setup 与 cleanup 各加一行 `console.log`，看是否交替成对；把 StrictMode 临时打开/关闭对比，能确认「双跑」与「泄漏」是两回事——泄漏在关掉的 StrictMode 里照样发生，只是慢一些。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并读报错" difficulty="进阶">

做四件事，各写出你看到的报错类型与成因（文案以你的版本为准，重点是判断依据）：

甲：给 `useSyncExternalStore` 传 `() => ({ ...store.getState() })` 作为第二个参数。
乙：`subscribe` 里忘了 `return` 取消订阅函数，改成 `return undefined`。
丙：在最外层根组件去掉 `<StrictMode>`，然后在 effect 里不加清理地 `addEventListener`，反复切换有依赖的 tab 十次。
丁：在一个 class 错误边界里把 `getDerivedStateFromError` 删掉只留 `componentDidCatch`，然后让子组件在渲染期抛错。

<template #answer>

甲：控制台出现「快照 / `getSnapshot` 应返回缓存值」类警告，并伴随无限重渲染（React 每帧比较快照，浅比较永不相等）。**这是最典型的一条**：外部 store 的快照必须是稳定引用。修法：返回 `store.getState()` 本身，或让 selector 在 store 层缓存。

乙：`subscribe` 的返回值被 React 当作「取消订阅函数」。返回 `undefined` 时不会立刻崩，但依赖变化时旧订阅不会解除——你会观察到同一个值被通知两次、埋点翻倍、内存里监听器堆积；某些版本会在控制台给出「期望返回函数」的警告。修法：`return () => { ... }`，且要摘掉与注册时**完全相同**的参数（同一函数引用 + 同一 options，这也是推荐 `signal` 的原因）。

丙：页面挂上约 10 个（或 N 个）`resize` handler，一次窗口缩放触发十次回调。**关掉 StrictMode 后这个 bug 依然存在**——它不是双跑造成的，只是被双跑更容易发现。这就是「不要用关 StrictMode 来消症状」的实证。修法：`useEffect` 里成对注册/注销，或用 `{ signal }` + `controller.abort()`。

丁：错误仍然被捕获、仍然会上报（`componentDidCatch` 跑），**但界面不会显示兜底 UI，而是整棵树被卸载（白屏）**。原因：决定「渲染什么」的是 `getDerivedStateFromError`（它把错误映射成 state），`componentDidCatch` 只负责副作用。两个钩子各管一半，缺一个就少一半能力。

</template>

</Exercise>

<Exercise title="练习 4 · 把 index key 换成 id，并解释被重置的东西" difficulty="基础">

一个可编辑列表用 `key={index}`，每行是受控输入框，state 放在父级数组里。删掉第 2 行后，界面上哪些东西「错了」？把 key 换成 `todo.id` 后，为什么父级一次 setState 就足够？

<template #answer>

受控列表在删行后**文本内容一般是对的**（因为值来自 state 数组，React 重写它管理的属性），错的是「不经过 React 的那些东西」：输入框的**光标位置/焦点**、正在进行的 IME 组合、CSS 入场动画（`key` 不变就不会重放，`key` 变了会全部重放）、行组件内部的 `useState`（如「是否展开」「草稿是否 touched」）、以及 `memo` 的比较结果（index 变了 → 所有行的 props 判定都变了 → 全部重渲染）。如果行内有非受控输入框，值直接串位（第 10 章那条）。

换成 `todo.id` 后，React 能把「这一行的身份」和 DOM 节点正确对应：只有消失的那一行被卸载，插入位置之后的行只更新数据，焦点与内部 state 留在原处。父级一次 `setTodos(next)` 就够，因为协调靠 key 做位置无关的匹配；不需要 `flushSync` 或额外渲染。

延伸：这条与 Vue 的 `:key="todo.id"` 完全同解（[阶段项目](/vue/project) 的翻车点 5），是**对照法有效**的例子；差别只在 React 会把「换 key」当作正式的重置手段。

</template>

</Exercise>

<Exercise title="练习 5 · 给一个真实应用设计错误边界与恢复路径" difficulty="挑战">

后台应用有三个区域：左侧导航、中间待办列表、右侧详情面板。要求：详情面板崩了不影响列表；列表崩了显示错误页并可重试；错误要上报。写出边界层次、每层的兜底 UI 与恢复动作，并说明哪些错误你的边界**兜不住**、改在哪里。

<template #answer>

层次建议：

| 层 | 包住什么 | 兜底 UI | 恢复动作 |
| --- | --- | --- | --- |
| 根边界 | 整个 App | 「应用出错，请刷新」+ 上报 | 只有 `window.location.reload()`；这层不该被经常触发 |
| 路由级 | `Outlet` | 错误页（带返回按钮） | React Router 的错误元素能力（见[第 8 章](/react/router)）或 `key` 重挂 + 重新取数 |
| 面板级 | `TodoDetail` | 面板内「加载失败 · 重试」 | 换 `key={id + attempt}` 重挂 + store 里 `refetch(id)` |
| 导航 | **不放边界** | — | 它坏了整页都没法用，边界只会掩盖问题 |

要点：**边界进入错误态后不会自动重试**，所以恢复必须自己给；`setState({ failed: false })` 只重置边界、不重置子树的 props，最常见的有效手段是「换 key + 重新拉数据」这一对。

兜不住的四类，各有去处：① **事件处理器里的错误**（点击保存时抛的）→ 在 handler 里 `try/catch` + 展示 toast，这是 React 明确的规则；② **异步回调/Promise reject**（`fetch` 后 `.then` 里抛）→ 数据层 catch，写进 `LoadState` 的 `error` 分支（[TypeScript 阶段项目](/typescript/project)那套判别联合）；③ **`setTimeout` / 第三方库回调**→ 同上，或库自己的 onError；④ **服务端渲染阶段的错误** → 属于框架层，不归边界。

最后一条常被扣分：上报（`componentDidCatch`）不要放 UI 逻辑，也不要在里面 `setState`；它是「副作用位」，等价于 Vue 里 `onErrorCaptured` 的返回 false 之前那句 log。

</template>

</Exercise>

## 官方文档与延伸阅读

- [useRef 参考](https://react.dev/reference/react/useRef) —— 本章唯一成功核实的一条：组件必须是纯函数、不要在渲染期读写 ref、违反会与并发与服务端相关特性不兼容（2026-10-17 核实）。
- [StrictMode 参考](https://react.dev/reference/react/StrictMode) —— 双调用与 setup→cleanup→setup 的**权威清单**在这里。本章刻意没有把清单写全，请以该页当前内容为准（本次抓取失败）。
- [useSyncExternalStore 参考](https://react.dev/reference/react/useSyncExternalStore) —— 核实三个参数、`subscribe` 必须返回取消函数、`getSnapshot` 必须返回稳定引用、`getServerSnapshot` 在服务端渲染时的必要性，以及「撕裂（tearing）」的官方定义。
- [Component 参考 · error boundaries 一节](https://react.dev/reference/react/Component) —— 核实「边界只能由类组件声明」「`getDerivedStateFromError` 与 `componentDidCatch` 分工」「不捕获事件处理器/SSR/异步错误」这三条本章最硬的结论。
- [将 UI 理解为一棵树](https://react.dev/learn/understanding-your-ui-as-a-tree) 与 [渲染列表的 key](https://react.dev/learn/rendering-lists) —— 核实 `key` 是身份、换 key 即重挂并重置 state、Fragment 可带 key。
- [保留与重置 State](https://react.dev/learn/preserving-and-resetting-state) —— 核实「用 key 重置 state」是官方推荐手段而非技巧（练习 4 的依据）。
- [Portal 参考](https://react.dev/reference/react-dom/createPortal) —— 核实「事件与错误按 React 树传播、CSS 按 DOM 树」这一组语义（本章未逐字抓取，读原文再落进项目规范）。
- [Suspense](https://react.dev/reference/react/Suspense) 与 [lazy](https://react.dev/reference/react/lazy) —— 核实懒加载工厂签名与 fallback 边界语义；两者都在[领域首页](/react/)的参考清单里。
- [Server Components 参考](https://react.dev/reference/rsc/server-components) —— 本章刻意只做到「概念区分」，具体能力/命名/限制请只信这一页的当前版本。
- [React Compiler](https://react.dev/learn/react-compiler) —— 并发时代之后另一个改变写法的东西，与第 7 章的手动记忆化一起读。
- [useId](https://react.dev/reference/react/useId) —— 核实「渲染期需要唯一 ID」的官方答案，替代 `Math.random()`。
- Vue 侧对照：[组合式 API 与 composables](/vue/composables)、[生命周期与模板引用](/vue/lifecycle-and-inject)、[渲染性能](/vue/rendering-performance)、[阶段项目翻车点](/vue/project)。

## 下一章

到这里，对照法能覆盖的部分（第 1–10 章）与它盖不住的部分（本章）都齐了。剩下的唯一检验方式是**真的写一遍**：同一个应用、两个框架、同一份需求，让你在第 1 到 11 章里建立的每一条判断都被代码打一次分。

第 12 章[阶段项目：双框架对照重写](/react/project)就是这个检验：把[Vue 领域的多页面待办应用](/vue/project)用 React + TypeScript 重写（列表页 + 详情页 + URL 同步 + 404 + 表单校验），并交付一张「同一需求在两个框架里各自怎么落地」的对照复盘表。项目不要求你先完成 Vue 那一版——需求与数据层接口会在本章正文里重述一遍，但**如果你没做过 Vue 版，你会少掉一半收获**：对照笔记写不出来的那一格，就是你还没真正理解的那个概念（领域首页学习顺序一节的最后一条）。
