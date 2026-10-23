# useEffect 不是 watch：它只负责在提交之后与外部系统同步

三种现象，同一个病因。第一种：用户在详情页点了「加入购物车」，通知弹了两次，刷新页面又弹一次。第二种：控制台刷出 `Maximum update depth exceeded`，页面卡死。第三种：切换搜索关键词时偶发地显示**上一次**的结果，你查后端日志发现两个请求都回来了，只是顺序不对。

它们的共同点是：把 `useEffect` 当成了「侦听器」。Vue 里 `watch` 的语义是「某个响应式数据变了就跑这段代码」，于是迁移过来的人自然会写「props 变了就跑 effect」——而 React 的 effect 表达的是另一件事：**在这次渲染被画到屏幕上之后，把某个外部系统同步成当前 UI 的状态**。语义不同，写错的后果也不同：`watch` 写错通常只是多跑几次，`useEffect` 写错会同时造成重复执行、竞态、无限循环和状态撕裂。

这一章把这条边界划清楚：effect 什么时候运行、为什么事件不属于 effect、依赖数组的三种形态各自承诺了什么、清理函数到底在什么时候跑，以及一份「你可能不需要 effect」的逐条清单。前置：[两套渲染模型](/react/two-rendering-models)、[useState 与不可变更新](/react/state)、[计算属性与侦听器](/vue/computed-and-watch)。

<Callout type="info" title="本章的核实口径">

本章关于运行时机、依赖比较算法、清理时机、异步函数返回值、StrictMode 双执行、`useLayoutEffect` 与浏览器重绘的关系、「你可能不需要 Effect」的每一条判断，都在 2026-10-17 对照 [react.dev](https://react.dev/reference/react/useEffect) 与 [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) 核实过，文末逐条列出对应关系。React 代码无法在本站环境运行，因此所有示例均为静态推演，不声称实测。

</Callout>

## 先把两个 API 的定位钉死

| 维度 | Vue `watch` / `watchEffect` | React `useEffect` |
| --- | --- | --- |
| 一句话语义 | 侦听响应式依赖，变了就执行回调 | 渲染提交后，与外部系统同步 |
| 依赖从哪来 | 自动追踪（`watch` 显式指定源，`watchEffect` 自动收集读取过的响应式值） | **手工列出**，不列就可能是过期值 |
| 首次执行 | 默认不立即执行（`immediate: true` 才跑）；`watchEffect` 立即执行 | 挂载后必定执行一次 |
| 运行时机 | 微任务批次里，DOM 更新前后不保证 | 默认在浏览器绘制之后（官方：一般让浏览器先绘制再跑） |
| 跳过执行 | 依赖没变就不跑 | 依赖数组逐项 `Object.is` 比较，全等则跳过 |
| 清理 | `onCleanup(fn)` / `watch` 返回 stop；组件卸载自动停 | 必须返回函数；React 只在你返回时用它 |
| 事件语义 | 与事件无关，用户交互通常写 handler | 官方明确：effect 里你已经不知道用户做了什么，交互逻辑写 handler |
| 常见误用 | 用 `watch` 做本可以在 handler 里做的事 | 完全相同，但代价更大 |

最后一行值得停下来。这不是 React 独有的毛病：**在 Vue 里我们也反对用 `watch` 实现 `computed` 或事件处理器能表达的东西**（见[计算属性与侦听器](/vue/computed-and-watch)——能用计算属性表达的派生值不要写 `watch`，用户交互触发的动作不要写 `watch`）。到了 React 这边，同一条判断标准变得更重要，因为 effect 的每次执行都会额外带来一次渲染往返，漏写依赖还会静默读到过期值。区别只是：**Vue 里错用 `watch` 通常还能跑对，React 里错用 `useEffect` 会崩。**

## 三阶段：渲染、提交、副作用

官方在「你可能不需要 Effect」里给了完整的时序描述，把它背下来：更新 state 后，React 先调用你的组件函数计算「屏幕上应该有什么」，然后把变更提交（commit）到 DOM，**然后**才运行你的 effect。如果这个 effect 又立刻更新 state，整个流程从头再来一遍。

这条时序解释了三件日常怪事：

1. **effect 里读不到「为什么」。** 交互触发的更新和外部数据触发的更新，走到 effect 这一步长得一模一样。官方的措辞是：到 effect 运行时，你已经不知道用户做了什么（比如点的是哪个按钮）；因此用户事件应当在对应的事件处理器里处理。也有一句更实用的判据：**如果这段逻辑是因为「用户看到了这个组件」而需要运行，放 effect；如果是因为「用户做了某个动作」，放 handler。**
2. **effect 里 setState 会多烧一轮渲染。** 用 effect 把 props 复制进 state，等价于「先渲染一次错的，再渲染一次对的」，用户可能看到闪烁，性能也白丢。
3. **effect 默认在绘制之后跑。** 这对大多数同步工作是好事（不阻塞界面），但当你需要在绘制前测量布局并立刻改正位置时，它会让用户看到元素跳动——这是 `useLayoutEffect` 存在的唯一理由，本章后面讲。

关于时序还有两个官方细节：如果这次更新由交互引起，React **可能**在浏览器绘制之前就运行 effect，好让事件系统观察到结果；effect 不是「和渲染同时」发生的，它是一次独立的后续工作。

## effect 存在的唯一理由：同步外部系统

官方定义很硬：effect 是 React 范式的一个逃生舱（escape hatch），它让你「走出 React」，把组件与某个外部系统同步——非 React 的 widget、网络、浏览器 DOM。换句话说：**React 世界内部的事情（数据变换、状态共享、用户交互响应）都不该是 effect 的活。**

| 该用 effect | 对应的外部系统 | Vue 里的习惯做法 |
| --- | --- | --- |
| `addEventListener` / `removeEventListener` | 浏览器事件系统 | `onMounted` + `onUnmounted` |
| `setInterval` / `setTimeout` 轮询 | 计时器 | 同上 |
| WebSocket、EventSource、`subscribe` | 推送与第三方 store | 同上，或 composable |
| `fetch` / 第三方 SDK 初始化（图表、地图、编辑器） | 网络与库实例 | `watch` + 库实例持有 |
| 把值同步到 `localStorage`（跨标签页场景） | 存储 | handler 里写更常见 |
| 焦点管理、`scrollIntoView` | DOM 几何 | `onMounted` + `nextTick` |

一个完整、对称的例子：

```tsx
useEffect(() => {
  const controller = new AbortController();

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
  document.addEventListener('keydown', onKeydown, { signal: controller.signal });

  return () => controller.abort();   // 清理：一次性摘掉所有通过该 signal 注册的监听器
}, [onClose]);
```

`{ signal: controller.signal }` 是这里的关键写法：注册时交给 `AbortController`，清理时 `abort()` 一次就把监听器摘干净，不会漏。这个技巧同样适用于 `addEventListener` 之外的一批现代 API（`ResizeObserver` 需要手动 disconnect，见下）。

## 依赖数组的三种形态：语义完全不同

| 写法 | 官方语义 | 什么时候真该用 |
| --- | --- | --- |
| `useEffect(fn)`（**不传**第二个参数） | 每次 commit 之后都执行，不管依赖有没有变 | 极罕。你几乎总是要么列依赖要么 `[]` |
| `useEffect(fn, [a, b])` | 挂载后执行一次；此后每次 commit 时逐项比较，**任一项不等**则先跑清理再跑 setup | 绝大多数情况 |
| `useEffect(fn, [])` | 只在挂载后执行一次（开发环境 StrictMode 会额外一次），props/state 变化不会重跑 | 只在「真的只与外部系统同步一次、不读任何响应式值」时用 |

比较算法是 `Object.is`，逐项、浅层。这带来两条必然后果：

- 依赖数组里**不能漏**任何在 setup 里用到的「响应式值」——props、state，以及在组件函数体里声明的变量和函数。它们每次渲染都可能换新引用，漏写就是读旧值。
- 依赖数组里的引用类型必然每次都不同，于是每次渲染都重跑；如果重跑里又 setState，就是无限循环。

死循环原型与三种修法：

```tsx
// ❌ 死循环：每次渲染新建一个对象，Object.is 永不相等
useEffect(() => {
  setFilter({ status: 'open', page: 1 });
}, [{ status: 'open', page: 1 }]);

// ❌ 同类：把函数放进依赖，而函数每次渲染都是新引用
function Search({ query }: Props) {
  const doSearch = () => fetchResults(query);
  useEffect(() => { doSearch(); }, [doSearch]);  // 每次渲染都跑
}
```

| 修法 | 怎么写 | 代价 |
| --- | --- | --- |
| 拆成原始值 | 依赖写 `[status, page]`，对象在 effect 内部构造 | 最直接，优先选这个 |
| 稳定引用 | `const doSearch = useCallback(() => {...}, [query])` 或对象用 `useMemo` | 依赖数组仍然要写全；`useMemo` 不保证一定缓存 |
| 把函数移进 effect 内部 | 在 setup 里定义再调用，不列进依赖 | 函数只能用一次，无法给 handler 复用 |

第三条最有价值，因为「effect 里调用的函数」常常根本不属于组件接口。本站的建议顺序就是表里的顺序：**拆原始值 → 函数内移 → 最后才 useCallback/useMemo**。

## 清理函数的真实时机：不是「卸载时」而已

这是 Vue 迁移者最容易误解的一条。官方规则是：**每次因为依赖变化而重新执行 setup 之前，React 会先用旧值运行清理函数；组件卸载时，再运行最后一次清理。** 加上 StrictMode，开发环境挂载时还会多一轮 setup → cleanup → setup。

| 时刻 | setup | cleanup |
| --- | --- | --- |
| 挂载 | 执行 | — |
| 依赖变化后的 commit | 用新值执行 | **先用旧值执行** |
| 卸载 | — | 执行一次 |
| 开发环境 StrictMode 挂载 | 执行 → （立即 cleanup → 再 setup） | 见 StrictMode 一节 |

所以「我在 `onUnmounted` 里移除监听」这种思路在 React 里是不够的：如果你的 effect 有依赖，每次重跑都会**再加一个监听器**，而卸载时才移除——结果页面上挂着十几个 handler。必须成对登记的资源：

| 资源 | setup 里 | cleanup 里 |
| --- | --- | --- |
| DOM/window 监听 | `addEventListener` | `removeEventListener`（**同一个函数引用**，参数一致） |
| 定时器 | `setInterval` / 长 `setTimeout` | `clearInterval` / `clearTimeout` |
| 订阅（WebSocket、EventEmitter、外部 store） | `subscribe` / `new WebSocket` | `unsubscribe` / `ws.close()` |
| 观察器 | `new ResizeObserver(...).observe(el)` | `observer.unobserve(el)` / `disconnect()` |
| 请求 | `fetch(..., { signal })` | `controller.abort()` |
| 第三方库实例 | `new Chart(el, opts)` | `chart.destroy()` |

对照 Vue：`onUnmounted` 只在卸载时跑，等价于 React cleanup 的「最后一行」；`watch` 的 `onCleanup` 参数与 React cleanup 语义一致——都在下一次回调前跑。所以 Vue 里 `watch` 写对了的人，到 React 只需要把 `onCleanup(cb)` 换成 `return () => cb()`。

## 你可能不需要 Effect：逐条清单

下面每一条都是官方「You Might Not Need an Effect」明确点名的反模式，配 Vue 侧对应做法。

**1. 派生数据：直接算，不要 setState。**

```tsx
// ❌ 多一次渲染，还可能撕裂
const [fullName, setFullName] = useState('');
useEffect(() => { setFullName(`${first} ${last}`); }, [first, last]);

// ✅ 渲染期直接计算
const fullName = `${first} ${last}`;

// ✅ 计算昂贵时才用 useMemo（它缓存，不改变语义）
const sorted = useMemo(() => heavySort(rows), [rows]);
```

Vue 对应物是 `computed`。React 没有「自动缓存的派生值」这个概念：`const x = a + b` 每次渲染重算，绝大多数情况下这比 memo 更划算。`useMemo` 官方定位是性能优化，且**不保证一定缓存**（未来可能重新计算或丢弃）。

**2. 共享状态：提升到共同父组件或 store，不要「子组件侦听 props 再 setState」。**

```tsx
// ❌ 子组件侦听 props 复制进本地 state
useEffect(() => { setList(props.items); }, [props.items]);

// ✅ 直接用 props.items；需要跨分支共享就把 state 提到共同父组件
```

官方对「在子组件里取数据再往上交」的建议是反过来的：把取数逻辑放到需要数据的最近共同父组件，把结果作为 prop 传下去——保持自上而下的数据流。

**3. 通知父组件：在同一个事件处理器里改两边，不要用 effect 桥接。**

```tsx
// ❌ 本地 state 变了之后用 effect 通知父组件
useEffect(() => { onChange(value); }, [value]);

// ✅ 事件处理器里同时更新两边，天然被批处理成一次渲染
function handleChange(next: string) {
  setValue(next);
  onChange(next);
}
```

Vue 里对应的直觉是「`emit` 就在改值的那一句旁边调用」，完全一致。

**4. 用户事件：写在 handler 里。** 加购物车后弹通知，官方给的反例就是「用 `useEffect` 侦听 `product.isInCart`」——那样一来，页面刷新时组件挂载也会跑一次 effect，通知被重复弹出。正确写法是把 `showNotification` 放在 `buyProduct()` 里。

**5. 只做一次的初始化：用惰性初始值，不要用空依赖 effect。**

```tsx
// ❌ 先渲染一次空态，再 setState 填上
const [rows, setRows] = useState<Item[]>([]);
useEffect(() => { setRows(loadFromStorage()); }, []);

// ✅ 首次渲染就是对的
const [rows, setRows] = useState<Item[]>(() => loadFromStorage());
```

Vue 侧同理：`const rows = ref(loadFromStorage())` 就够了。**注意区分**：如果 `loadFromStorage` 是异步的（网络），那才需要 effect 或请求库，属于「同步外部系统」。

**6. prop 变化时重置全部 state：用 `key`。** 官方例子：切换用户要清空评论，别写 `useEffect(() => setComment(''), [userId])`，而是给组件传 `key={userId}` 让它卸载重建（见 [props、回调与 children](/react/props-and-children)）。Vue 里同一条建议也成立。

**7. prop 变化时调整部分 state：优先在渲染期算出来。**

```tsx
// ❌ 用 effect 修正选中项
useEffect(() => { setSelected(null); }, [items]);

// ✅ 让选中项成为派生值，根本没有需要修正的 state
const selection = items.find((item) => item.id === selectedId) ?? null;

// ✅ 确实要保留其它 state、只重置一项：在渲染期比较前值（官方认可的特例写法）
```

**8. 链式 effect 级联渲染。** 一个 effect setState，触发另一个 effect，再 setState……官方把这种「计算链」要求在事件处理器里一次算完。Vue 里多个 `watch` 互相触发同样是坏味道。

**9. 深层比较依赖。** 如果你需要「内容一样就不重跑」，说明状态形状有问题（不该把整个对象丢进依赖），改传原始值或提升比较点，而不是给依赖数组做深比较。

**判断流程**（本站整理，非官方原文）：这段代码运行是因为用户看到了什么，还是因为用户做了什么？做了 → handler。看到 → 它需要「同步」一个 React 之外的东西吗？需要 → effect，且必须对称清理。不需要 → 它是不是别的数据算出来的？是 → 渲染期计算/`useMemo`。都不是 → 它只跑一次吗？只跑一次 → 惰性初始值或 `[]` effect（后者仍要能解释「外部系统是什么」）。

## stale closure：漏依赖是 bug 的温床，别压 ESLint 规则

```tsx
// ❌ 依赖漏了 query：读到的是首次渲染时那个空的 query
function Results({ query }: { query: string }) {
  const [data, setData] = useState<Item[] | null>(null);
  useEffect(() => {
    setData(null);
    fetch(`/api/search?q=${query}`).then((r) => r.json()).then(setData);
  }, []);                    // eslint-disable-line react-hooks/exhaustive-deps
  // ...
}
```

这个 bug 的形态在 Vue 里几乎不会出现，因为 `watch(query, ...)` 的源是显式的、回调里读 `props.query` 走代理。React 里闭包捕获的是**这次调用的参数**，所以 effect 用到的每一个响应式值都必须出现在依赖数组里——这是官方要求，也是 `eslint-plugin-react-hooks` 的 `exhaustive-deps` 规则存在的原因。

正确姿势：**打开 `exhaustive-deps`，永远不要用 `// eslint-disable-next-line` 关掉它。** 规则报错时有三条正路：补齐依赖；把不稳定的值拆成原始值或移进 effect；确实「只想按某个键同步、其它值读最新的」时，把逻辑改成事件处理器或用官方给出的 Effect Events（`useEffectEvent`，读最新值而不成为依赖；这是较新的能力，用前核对官方 API 参考当前状态）。用空依赖「让它只跑一次」是拿正确性换安静。

补充一条与 stale closure 同源的现象：`setCount(count + 1)` 连点三次只加 1，因为三次读的是同一个闭包里的 `count`；应写成 `setCount((c) => c + 1)`。这是[第 3 章](/react/state)的内容，effect 里同样常见。

## 竞态与取消：请求 A 晚于 B 到达

输入 `rea` 时发了 `react`、`red` 两个请求，若 `react` 后回来，界面会显示错误的结果。两种官方认可的手段：`ignore` 标志与 `AbortController`。

```tsx
// 手段一：ignore 标志（官方「你可能不需要 Effect」里的写法）
useEffect(() => {
  let ignore = false;
  async function startFetching() {
    setBio(null);
    const result = await fetchBio(person);
    if (!ignore) setBio(result);        // 组件已卸载或依赖已变，丢弃这次结果
  }
  startFetching();
  return () => { ignore = true; };
}, [person]);

// 手段二：AbortController（真正取消请求，省带宽、避免过期响应写 state）
useEffect(() => {
  if (!query) return;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setResults(json.results))
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
  }, 300);

  return () => {
    clearTimeout(timer);
    controller.abort();      // 同时干掉「还没发出」和「已发出未回来」两种情况
  };
}, [query]);
```

三个细节：`async` 函数要**声明在 effect 内部再调用**；`.catch` 里要放过 `AbortError`（取消不是失败）；`ignore` 只防「写 state」，不省网络流量，两者不冲突可同时用。Promise 与 `AbortSignal` 的机制在[事件循环、Promise 与 async/await](/javascript/asynchronous)和[fetch、同源策略与浏览器存储](/javascript/network-and-storage)里已经讲透。

## StrictMode：开发环境双执行是设计，不是 bug

官方描述得很清楚：开启 StrictMode 后，React 在首次真实 setup 之前会**额外执行一轮 setup → cleanup → setup**，目的是「压力测试」——验证你的清理逻辑是否精确镜像了 setup：setup 做了什么，cleanup 就要撤销什么。判据是：用户应当无法区分「生产环境跑一次 setup」与「开发环境 setup → cleanup → setup」。

由此得到本章最重要的操作结论：

- **不要靠 effect 计数。**「effect 跑了一次所以只做初始化」「用 effect 累加一个只有卸载才该减的计数器」这类写法，在 StrictMode 下必然出错。真正的「只做一次」语义应该由惰性初始值、事件处理器或模块级单例承担。
- **不要为了消除双执行而关掉 StrictMode。** 关掉它等于关掉免费的 bug 检测器（领域首页学习方法一节也这么说）。
- 看到「组件挂载了两次」「请求发了两次」「监听器加了两遍」时，先问「清理写了吗」，而不是「怎么让它只跑一次」。

`StrictMode` 在 React 18 起还带来 `useRef` 相关的额外检查与自动批处理等行为，第 11 章集中讲它。

## 一句带过：useSyncExternalStore

如果你的「外部系统」本身就是一个会通知你变化的 store（第三方状态库、浏览器 API 如 `navigator.onLine`），正确的订阅 API 是 `useSyncExternalStore`——它专门用于订阅外部数据源并保证与 React 渲染的一致性，避免 tearing。它不是「更好用的 useEffect」，别拿它当通用订阅 Hook。详见官方 [`useSyncExternalStore` 参考](https://react.dev/reference/react/useSyncExternalStore)，本站在[状态管理选型](/react/state-management)一章会说明 Redux/Zustand 这类库内部正是在用它。

## effect 里取数据的局限：为什么该用请求库

官方在 `useEffect` 参考页列了手写 fetch 的问题：**effect 在服务端不运行**（首屏 HTML 里只有 loading 态，hydration 后才补数据）、**瀑布流**（子组件串行取数）、**没有缓存与去重**（同一查询重复请求）、**竞态样板**（要自己写 ignore）。推荐顺序是：全栈框架（Next.js、Remix 这类）自带的数据加载 → 客户端缓存库（TanStack Query、useSWR）→ 框架的数据加载能力（如 React Router 的 loader）。

本站的口径：小 demo 用 `useEffect` 取数没问题，只要写清 loading / error / 取消三态；真实列表页与详情页请直接用服务端框架或 [请求库](/react/state-management)，别把 effect 当数据层。

## useLayoutEffect 与浏览器闪烁

`useLayoutEffect` 是「在浏览器重绘屏幕之前触发」的那一版 effect：它在所有 DOM 变更之后同步执行，其中调度的 state 更新会在**重绘之前**完成。官方给的典型场景是 tooltip 定位：先用默认位置渲染，测量 `getBoundingClientRect()`，再根据可用空间决定放在上方还是下方——用 `useEffect` 会让浏览器先把错误位置画出来，用户看到一次跳动；用 `useLayoutEffect` 则只画最终位置。

代价也是官方明写的：`useLayoutEffect` 里的代码和它调度的 state 更新会**阻塞浏览器重绘**，用得过多会让应用变慢，官方原话是「可能的话优先使用 `useEffect`」。判断标准只有一个：**用户会不会看见中间状态？** 会 → `useLayoutEffect`；不会 → `useEffect`。

## 依赖数组里的 ref 特例

`ref.current` 不是响应式值：改它不触发渲染，React 也不「侦听」它。所以规则是——**在 effect 里读 `ref.current` 不需要把它列进依赖数组**，列了也没有侦听效果（`exhaustive-deps` 对此有专门豁免）。

但要区分两种需求：

| 需求 | 写法 |
| --- | --- |
| 读「最新」的那个 DOM 节点/值，不需要因为变化重跑 | `useEffect(() => { measure(ref.current); }, [])` —— 官方示例（如 ResizeObserver）里确实把 `ref.current` 作为依赖列出，语义是「节点换了要重新 observe」 |
| 订阅的值想要最新但不成为依赖 | 事件处理器 / Effect Events（`useEffectEvent`），而不是把 state 塞进一个 ref 再在 effect 里读 |
| 在 effect 里用 ref 存可变值 | 允许，但要写清「它不影响渲染」，否则你只是在手写一个绕过 React 模型的暗道 |

**不要**用「把 props 复制进 ref，然后在 effect 里读 ref」来绕过依赖检查——那是把 stale closure 换成了不可追踪的隐式依赖，比原 bug 更难查。

## 把逻辑抽成自定义 Hook 时，effect 归谁

自定义 Hook 是**在调用它的组件里**建立 effect 的：每个调用组件都有一份独立的 setup/cleanup。这带来两条设计规则：

```tsx
function useOnline(onHint: (offline: boolean) => void): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const controller = new AbortController();
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update, { signal: controller.signal });
    window.addEventListener('offline', update, { signal: controller.signal });
    onHint(!navigator.onLine);            // 这个回调必须稳定，否则每次渲染都重订阅
    return () => controller.abort();
  }, [onHint]);

  return online;
}
```

1. **依赖数组要包含 Hook 参数里所有响应式值**（上面 `onHint` 进了依赖）。因此 Hook 的文档必须要求调用方用 `useCallback` 传稳定函数，或者你在 Hook 内部把它放进 ref / Effect Event。
2. **副作用留在 Hook 里，数据变换留在外面。** Hook 只做「订阅 + 状态」，别在 Hook 里顺手 `setState` 派生值；调用方要派生就自己算。
3. **Hook 的名字要暴露它有没有 effect。** 一个不产生副作用的 Hook 叫 `useXxx`，调用方会以为它只是计算；有 effect 的 Hook 一旦在循环里被调用，就是 N 份监听器。

## 常见错误与排查

1. **`Maximum update depth exceeded`。** 现象：控制台刷屏后页面卡死。原因：effect 里 setState，而 setState 触发重渲染、重渲染又让依赖数组里的引用型值变化。怎么确认：在 effect 首行 `console.log('effect')`，看它是否无限打印；把依赖数组逐项 `console.log` 找出每次都变的那一项。怎么修：拆成原始值、把函数内移到 effect 里、或干脆把这段逻辑挪进事件处理器。
2. **effect 读到旧值（stale closure）。** 现象：首次进入正常，切换数据后结果不更新或停留在旧数据。原因：依赖漏写、或把 `exhaustive-deps` 压掉了。怎么确认：`npx eslint --rule 'react-hooks/exhaustive-deps: error'` 重新跑一遍；或在 effect 里打印依赖与真实使用的值是否一致。怎么修：补依赖；确实只按某个键同步就把它做成 key 或参数。
3. **监听器越加越多。** 现象：一次操作触发了 N 次 handler，内存里 `getEventListeners(window)` 一大串。原因：`addEventListener` 没有配对的 `removeEventListener`，或者 cleanup 只在卸载时想到、而 effect 有依赖会重跑。怎么确认：在 cleanup 里 `console.log('cleanup')`，看它是否与 setup 一一对应。怎么修：cleanup 写成 setup 的镜像，优先用 `AbortController` 的 `signal` 注册。
4. **在 effect 里做派生 state。** 现象：每次改动多一次渲染、偶发显示上一帧内容。原因：把 `computed` 该做的事写成了 `useEffect` + `useState`。怎么确认：问「这个值能不能从别的值算出来」，能就是。怎么修：渲染期直接算，昂贵才 `useMemo`。
5. **`useEffect(async () => {...})` 报 warning。** 现象：控制台提示 effect 的返回值必须是一个函数或 `undefined`（roughly: destroy must be a function）。原因：`async` 函数返回 Promise，React 把它当成清理函数。怎么确认：看 effect 的箭头函数是不是 `async`。怎么修：在 effect 内部定义 async 函数再调用，或 `.then` 链式写。
6. **把 effect 写进条件/循环里。** 现象：`React Hooks are called in a different order` 或渲染次数变化后 effect 全部错位重跑。原因：Hooks 的规则（不能条件调用），Vue 的组合式 API 没有这条限制，所以这是对照法的盲区之一。怎么修：条件放进 effect **内部**（`if (!enabled) return;`），而不是把 `useEffect` 本身包在 if 里。
7. **StrictMode 下「请求发两次 / 组件挂载两次」当成 bug 去修。** 原因：这是官方设计的双执行。怎么确认：把 `StrictMode` 注释掉一次，行为不变就是它。怎么修：补对称清理，不要加 `didInit` ref 之类的「只跑一次」保险丝。
8. **effect 用来「侦听 props 变化后 emit 事件」。** 现象：父组件被子组件的通知多渲染一次，偶发数据来回覆盖。原因：这是 Vue 里 `watch(props.x, v => emit(...))` 的直译。怎么修：把通知放进改变那个值的事件处理器里。
9. **无限循环但依赖数组看起来没变。** 现象：只有某个特定操作后卡死。原因：依赖里放了组件内定义的函数（每次都新引用），或放了 `props.style` 这类每次渲染新建的对象。怎么确认：把依赖逐项放进 `useMemo`/`useCallback` 试着稳定，或临时打印 `Object.is(prev, next)` 的思路（可在 React DevTools Profiler 里辅助）。怎么修：见上一节三种修法。

## 练习

<Exercise title="练习 1 · 把这段 Vue 写法翻译成 React 并说明行为差异" difficulty="进阶">

Vue 组件里是这样写的：

```vue
<script setup>
import { ref, watch } from 'vue';
const props = defineProps({ keyword: String });
const emit = defineEmits(['results']);
const results = ref([]);

watch(
  () => props.keyword,
  async (kw) => {
    const res = await fetch(`/api/search?q=${kw}`);
    results.value = await res.json();
    emit('results', results.value);
  },
  { immediate: true },
);
</script>
```

翻成 React 的 `useEffect` 版本，并说明三个行为差异：取消、重复请求、`immediate`。

<template #answer>

```tsx
function SearchResults({ keyword, onResults }: { keyword: string; onResults: (rows: Row[]) => void }) {
  const [results, setResults] = useState<Row[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/search?q=${encodeURIComponent(keyword)}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((rows) => {
        setResults(rows);
        onResults(rows);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error(err);
      });
    return () => controller.abort();
  }, [keyword, onResults]);

  return <List rows={results} />;
}
```

差异：**(1) 取消。** Vue 里 `watch` 的旧回调不会被中断，两个请求都跑完，后写谁赢看运气；React 里 cleanup 在每次重跑前触发，`abort()` 真的能取消上一个请求，且 `.catch` 要放过 `AbortError`。**(2) 依赖来源。** Vue 自动追踪 `props.keyword`，你不用声明；React 必须显式列出 `keyword` **和** `onResults`——`onResults` 若每次渲染新建，effect 会跟着重跑，所以调用方要么 `useCallback` 稳定它，要么把通知改到事件处理器里，或者把 keyword 提升为共同 state 后在这层取数。**(3) immediate。** `watch` 默认不立即执行，要显式 `{ immediate: true }`；React 的 effect 挂载后必然执行一次，所以不需要 immediate，但要处理「keyword 为空时不该请求」的空值守卫。

</template>

</Exercise>

<Exercise title="练习 2 · 判断哪些该写进 effect" difficulty="基础">

给下面五段逻辑归类：事件处理器、渲染期计算、effect（说明同步的外部系统是什么）。① 点击「加入购物车」后弹出提示；② 把 `firstName` 与 `lastName` 拼成 `fullName`；③ 组件挂载时把音量滑杆初始化到系统值（`AudioContext` 提供的当前音量）；④ 切换用户后清空评论输入框；⑤ 每次 `query` 变化后向 `/api/search` 请求。

<template #answer>

① handler：由用户动作触发。② 渲染期直接算，昂贵才 `useMemo`。③ effect，同步的外部系统是浏览器的音频 API；若只需一次可用惰性初始值读同步 API，`AudioContext` 是异步的就用 effect 并写清理（`close()`）。④ 不用 effect，用 `key={userId}` 让组件重建。⑤ effect，同步的外部系统是网络；注意它同时需要取消与 loading/error 三态，真实项目里更应交给请求库。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释报错与现象" difficulty="挑战">

```tsx
useEffect(async () => {
  const r = await fetch(`/api/user/${id}`);
  setPrevId(id);
  setUser(await r.json());
}, [id, { retry: 3 }]);
```

指出这段里全部问题（至少四处），并说明各自的报错文案或可观察现象。

<template #answer>

1. **`useEffect` 直接接 async 函数**：async 返回 Promise，React 要求返回值是清理函数或 `undefined`，开发环境会给出「Effect callbacks are synchronous to return a cleanup function... don't return anything」一类警告，且 Promise 里的 rejection 不会被当作 cleanup 处理。修法：effect 内定义 async 函数再调用。
2. **依赖数组里放了字面量对象 `{ retry: 3 }`**：每次渲染都是新引用，`Object.is` 永不相等 → effect 每次渲染都重跑 → 每次 `setUser` 又触发渲染 → 无限循环，控制台报 `Maximum update depth exceeded`。修法：把常量提到组件外，或写成原始值 `retry`。
3. **用 effect 维护 `prevId`（「侦听前值」）**：`setPrevId` 又是一次多余渲染，而且这类逻辑属于派生计算。修法：如果只是想「id 变了就重新请求」，依赖里已经有 `id`，`prevId` 完全没必要存在。
4. **没有 loading、错误与取消**：请求乱序时旧结果覆盖新结果（竞态），组件卸载后仍在写 state（React 18 起不再报 warning，只是这次写入毫无意义，别把它当错误去修）。修法：`AbortController` + 一个 `setLoading` 状态，`.catch` 里放过 `AbortError`。
5. **`setUser` 之前没有 `setUser(null)`**：切换用户时旧数据停留在屏幕上直到新数据到达。这是产品决策，不是 bug，但要显式写出来。

</template>

</Exercise>

<Exercise title="练习 4 · 清理函数时序推演" difficulty="进阶">

组件如下（`query` 由父组件频繁更新），开发环境开着 StrictMode。请按顺序写出 `setup` / `cleanup` 的打印序列，并解释为什么第一次挂载就有 4 行。

```tsx
useEffect(() => {
  console.log('setup', query);
  const controller = new AbortController();
  fetch(`/api?q=${query}`, { signal: controller.signal });
  return () => {
    console.log('cleanup', query);
    controller.abort();
  };
}, [query]);
```

<template #answer>

挂载时（query 初始为 `a`）：`setup a` → `cleanup a` → `setup a`（StrictMode 的额外一轮 setup → cleanup → setup）。第三次是真实的那次，前两次被立刻清理，第一个请求被 abort。之后父组件把 `query` 改成 `b`：`cleanup a` → `setup b`（先用旧值跑清理，再用新值跑 setup）。卸载：`cleanup b`。

共 4 行「setup」字样出现于挂载首帧的只有 3 次 setup 相关打印（setup、cleanup、setup），若把 cleanup 也算上就是 4 行。原因是官方设计：开发环境多执行一轮用来压力测试清理逻辑是否与 setup 对称。如果你的效果在双执行下出现异常（比如计数翻倍、请求留下两个未取消的连接），说明清理不完整，而不是 StrictMode 有问题。

</template>

</Exercise>

<Exercise title="练习 5 · 修一个依赖数组" difficulty="基础">

```tsx
function Timer({ isActive, duration }: Props) {
  const [left, setLeft] = useState(duration);
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [isActive]);
  return <span>{left}</span>;
}
```

这段有两个问题：一个会被 `exhaustive-deps` 报出，一个是产品行为。分别是什么？怎么改？

<template #answer>

`exhaustive-deps` 会要求把 `duration` 加进依赖（effect 里读了它？——没有，它只在 `useState(duration)` 里用到，所以这里规则不报；真正会报的是若你为了让 `duration` 变化时重新开始计时而写了 `setLeft(duration)` 在 effect 内）。更实际的两个问题：**(1)** `duration` 之后改变不会重设计时器，倒计时值仍是旧的。修法是给组件传 `key={duration}`（外部由调用方加），或者用「结束时间戳」这一派生值而不是逐秒递减：`const end = useRef(Date.now() + duration * 1000)`，effect 里只订阅一个 `setInterval` 更新 `left = Math.max(0, end - Date.now())`，依赖放 `isActive`。**(2)** 归零后 interval 仍在跑，白烧 CPU：`if (left === 0) clearInterval(t)`，或在 effect 条件里加 `if (!isActive || left === 0) return;` 并把 `left === 0` 作为依赖之一。这个例子也说明：**能用「时间戳 + 派生计算」替代「每帧累加 state」的，都该替代**——这正是 effect 与派生数据的分界。

</template>

</Exercise>

## 官方文档与延伸阅读

- [`useEffect` 参考](https://react.dev/reference/react/useEffect) —— 核实本章的运行时机（一般先绘制后跑、交互引起的可能提前）、依赖数组三种形态、`Object.is` 比较、cleanup 的两次时机、`async` 函数不能直接作为 effect、StrictMode 额外一轮、手写 fetch 的四点局限与推荐替代。
- [你可能不需要 Effect](https://react.dev/learn/you-might-not-need-an-effect) —— 「判断清单」9 条的原始出处，含 `key={userId}` 替代重置 state、ignore 标志写法、「effect 是逃生舱、用于同步外部系统」定义。
- [使用 Effect 同步](https://react.dev/learn/synchronizing-with-effects)、[响应式 Effect 的生命周期](https://react.dev/learn/lifecycle-of-reactive-effects) —— 核实 setup → cleanup → setup 的阶段划分与「不要用 effect 计数」的推论。
- [将事件从 Effect 中分离](https://react.dev/learn/separating-events-from-effects)、[移除 Effect 依赖](https://react.dev/learn/removing-effect-dependencies) —— 核实 Effect Events（`useEffectEvent`）与「读最新值但不成为依赖」的正路；用前确认该 API 在你安装版本里的状态。
- [渲染与提交](https://react.dev/learn/render-and-commit) —— 核实 commit 与 effect 的先后关系（本章第二节）。
- [`useLayoutEffect` 参考](https://react.dev/reference/react/useLayoutEffect) —— 核实「重绘之前触发」与「可能伤害性能、优先用 useEffect」。
- [`useSyncExternalStore` 参考](https://react.dev/reference/react/useSyncExternalStore) —— 核实它的定位（订阅外部数据源）。
- [`useState` 参考](https://react.dev/reference/react/useState) —— 核实惰性初始值 `useState(() => ...)` 与函数式更新。
- [React 官方中文 Effect 事件章节（同页面对照）](https://zh-hans.react.dev/learn) —— 术语对照用；核实时间 2026-10-17。
- Vue 侧对照依据：[计算属性与侦听器](https://cn.vuejs.org/guide/essentials/computed.html)、[生命周期钩子](https://cn.vuejs.org/guide/essentials/lifecycle.html)（`onCleanup` 与 `onUnmounted` 的差别）与本站[计算属性与侦听器](/vue/computed-and-watch)。

## 下一章

这一章把「effect 不是 watch」讲完了：它只在提交之后运行，只该用于与外部系统同步，依赖数组是手工契约，清理必须与 setup 对称。剩下的问题是——**如果需要同步的「外部系统」其实就是 React 自己管理的共享数据，而它离你的组件隔着好几层怎么办？** 这既不是 prop 一层层转发（第 4 章你已经见过它的代价），也不是 effect。答案是 Context：它对应 Vue 的 `provide` / `inject`，但有一个 Vue 里没有的硬性质——**值一变，所有消费者一起更新**。下一章 [Context 与 provide / inject 的对照](/react/context)会讲清这条性质的边界：什么场景用它、什么场景必须绕开它、以及怎么用它配 `useReducer` 写出可维护的共享状态。
