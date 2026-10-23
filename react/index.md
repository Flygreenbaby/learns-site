# React · 领域首页

<StatusBadge state="ready" note="12 章正文全部完成（第 12 章为阶段项目），可连续学习" />

## 这个领域解决什么问题

本领域的定位和[学习路线](/guide/roadmap)第三期的其他领域不同：**它不是「从零学第二套框架」，而是「用你已经掌握的 Vue 3 作为参照系，学 React」。**

这个选择基于投入产出比的判断。你已经学完 [Vue 3](/vue/)，那么：

- 组件化、props 单向数据流、声明式渲染、路由、状态管理这些**概念你全都有了**。React 里对应的东西只是换了名字和实现机制。
- 从零学 React 的时间成本，绝大部分会花在重复理解这些已有概念上，而不是花在 React 真正独特的部分。
- 用对照法学，你能把注意力集中在**两个框架真正分歧的地方**——而这些分歧恰好是 React 新手最容易踩坑的地方。

**但对照法有明确的局限，必须先说清楚：**

1. **它会让你带着 Vue 的思维定式。** Vue 的响应式是「可变状态 + 自动依赖追踪」：你改 `count.value`，视图自己更新。React 是「不可变状态 + 显式触发重渲染」：你必须调用 `setCount(newValue)`，并且**永远不要直接修改 state 对象**。用 Vue 的习惯写 React，最典型的症状是「状态改了但界面没变」——因为你直接 `state.list.push(x)` 修改了对象，React 看到的还是同一个引用，不会重渲染。这个坑在 Vue 里根本不存在，对照法反而会让你更容易掉进去。
2. **React 的一些模式没有 Vue 对应物，必须单独理解。** 例如：state 是「渲染那一刻的快照」（每次渲染拿到的 state 值是固定的，`setTimeout` 回调里读到的是旧值）；`useEffect` 的依赖数组与清理时机；`StrictMode` 在开发环境下会故意把渲染和 effect 执行两遍；不可变更新要求你手写展开运算符或者用 `immer` 之类的库。这些都不是「Vue 的某个东西换了个名字」。
3. **心智模型的转换比 API 的转换难。** 学完本领域，你能写出正确的 React 代码；但要写出**地道的** React 代码，需要一段时间适应「每次渲染都是一次全新的函数调用」这个前提。本站会明确标出哪些地方需要这种转换，但转换本身只能靠写。
4. **生态选型没有唯一答案。** Vue 生态里路由用 Vue Router、状态用 Pinia，几乎是默认选择。React 生态碎片化得多：路由有 React Router 等多种方案，状态管理有 Redux Toolkit、Zustand、Jotai 等，数据获取有 TanStack Query 等。本站会给出推荐和理由，但你需要知道这是「本站的选择」而不是「标准答案」。

所以本领域要解决的问题是：**让你在读一个 React 项目、或者需要维护一个 React 代码库时，能在合理时间内看懂并改对，同时清楚地知道自己哪些判断是从 Vue 迁移过来的、需要额外验证。**

具体的、只在 React 里会出现的坑：

- `useEffect` 写成了「Vue 的 `watch`」，把本该在事件回调里做的逻辑放进 effect，导致重复执行和竞态。
- 依赖数组漏了一项，effect 里读到的是闭包捕获的旧值（stale closure）。
- 在渲染过程中直接 `setState`，造成无限重渲染循环。
- 给 `memo` 组件传了一个每次渲染都新建的对象或函数，memo 完全失效。
- 列表的 `key` 用了数组索引，中间插入一项之后所有输入框内容错位——这个坑 Vue 里也有，但 React 的协调机制让它表现得更明显。
- Context 的 value 是一个每次渲染都新建的对象字面量，所有消费者跟着一起重渲染。

## 前置知识

**[Vue 3](/vue/)。**

这是本领域唯一但硬性的前置。原因不是「React 需要 Vue 的知识」，而是本领域的组织方式完全建立在「你已经有一套完整的前端框架心智模型」之上。第 1 章就会直接开始对比两个框架的渲染模型，如果你没有 Vue 3 的基础，这一章读起来会像天书。

具体来说，你需要在 Vue 领域掌握：

- 响应式原理（`ref` / `reactive` / Proxy / 依赖收集）—— 对应 React 的重渲染机制，是第 1、7 章的基础。
- 组合式 API 与 composables —— 对应 React 的自定义 Hooks，是第 5、6 章的基础。
- 组件的 props / emit / 插槽 —— 对应 React 的 props / 回调函数 / `children`，是第 4 章的基础。
- `provide` / `inject` —— 对应 React 的 Context，是第 6 章的基础。
- Vue Router 与 Pinia —— 对应 React Router 与 Redux / Zustand，是第 8、9 章的基础。
- 渲染性能（`v-memo` / `shallowRef`）—— 对应 `memo` / `useMemo`，是第 7 章的基础。

此外 [HTML](/html/)、[CSS](/css/)、[TypeScript](/typescript/) 通过 Vue 领域间接成为前置。TypeScript 尤其重要——本领域的示例代码全部用 TSX 编写，因为现代 React 项目基本不存在纯 JS 的。

## 章节目录

| 章节 | 内容 | 学完能做什么 |
| --- | --- | --- |
| [1. 为什么用对照法：两套渲染模型](/react/two-rendering-models) | 可变状态 + 依赖追踪（Vue）vs 不可变状态 + 显式重渲染（React）、组件函数的执行时机、渲染 → 提交 → 副作用的三阶段、对照法的有效边界与失效场景 | 建立正确的心智模型，知道哪些 Vue 直觉可以直接搬过来、哪些必须推翻 |
| [2. JSX vs 模板](/react/jsx) | JSX 的本质与编译结果、表达式即插值、`className` 与 `htmlFor`、必须有单一根元素与 Fragment、条件渲染用 `&&` 与三元而非指令、列表用 `map` 而非 `v-for`、JSX 里不能写语句的限制 | 把任意 Vue 模板改写成等价的 JSX，并说清两者的表达能力差异 |
| [3. `useState` / `useReducer` vs `ref` / `reactive`](/react/state) | state 是渲染那一刻的快照、setter 触发重渲染而非修改值、更新是异步批处理的、不可变更新规则（对象与数组）、函数式更新、`useReducer` 对应 Pinia action 的思路 | 写出不依赖「改了就生效」直觉的状态更新代码，避开 stale closure |
| [4. props 与回调 vs props 与 emit](/react/props-and-children) | 单向数据流的一致性、React 没有 emit：子组件通过父组件传下来的函数回调、`children` 与具名插槽的对应关系、作用域插槽对应 render props、受控组件与 `v-model` 的差异 | 设计一个 React 组件的接口，不写出「子组件改父组件状态」的反模式 |
| [5. `useEffect` vs `watch` / `watchEffect`](/react/use-effect) | effect 在提交之后运行、依赖数组的三种形态、清理函数的时机、为什么 effect 不是「侦听器」、事件处理与 effect 的分工、「你可能不需要 effect」的判断标准、竞态与取消 | 分清什么该写进 effect、什么该写在事件回调里，避开 React 最大的坑区 |
| [6. Context vs `provide` / `inject`](/react/context) | `createContext` 与 Provider、`useContext` 对应 `inject`、Context 值变化会重渲染所有消费者、为什么不能拿它当全局状态管理、自定义 Hooks 对应 composables | 在正确的场景用 Context，在错误的场景不用它 |
| [7. 重渲染机制与性能](/react/re-render-performance) | 什么情况触发重渲染（自身 state 变化 / 父组件重渲染 / Context 变化）、Vue 的自动依赖追踪 vs React 的手动 memo、`memo` / `useMemo` / `useCallback` 各自的用途与代价、引用稳定性、`useTransition` 与 `useDeferredValue`、React Compiler 带来的变化 | 定位一次真实的性能问题，并判断该加 memo 还是该改状态结构 |
| [8. React Router vs Vue Router](/react/router) | 路由声明方式、`useNavigate` 对应 `useRouter().push`、`useParams` 对应 `route.params`、嵌套路由与布局、数据加载方式（loader 与在 effect 里请求的差异）、路由级代码分割、守卫的对应实现 | 把一个 Vue Router 应用的路由结构迁移到 React Router |
| [9. 状态管理：Redux / Zustand vs Pinia](/react/state-management) | 为什么 React 生态碎片化、集中式 store 与 Context 的区别、Redux Toolkit 的 slice 对应 Pinia 的 store、Zustand 的极简模型、服务端状态与客户端状态的区分（TanStack Query 的位置）、选型建议 | 为一个 React 项目做出有理由的状态管理选型，而不是默认上 Redux |
| [10. `useRef` 与受控组件 vs 模板引用与 `v-model`](/react/refs-and-forms) | ref 作为「不触发重渲染的可变盒子」、DOM 节点访问、`useRef` 保存跨渲染的可变值与它的风险、受控与非受控组件、表单处理与 `v-model` 的差异 | 正确地操作 DOM 与处理表单，不把 `useRef` 当 `ref` 用 |
| [11. 对照法的盲区：React 特有的东西](/react/react-only) | `StrictMode` 为什么在开发环境双调用、`key` 与协调算法、Hooks 的规则（不能写在条件与循环里）及其与组合式 API 的差异、错误边界（Vue 里对应 `onErrorCaptured`）、Portal、`Suspense` 与懒加载、React Server Components 概览与它的适用边界 | 读懂一个真实 React 项目里那些「Vue 里没有对应物」的代码 |
| [12. 阶段项目](/react/project) | 把 Vue 阶段项目的一个页面用 React + TypeScript 重写，并写出两份实现的对照笔记 | 用真实代码验证你的对照理解，暴露思维定式 |

## 学习顺序建议

**严格按 1 → 12 的顺序学。第 1、3、5 章是三个关键节点，不能跳。**

第 1 章（两套渲染模型）是整个领域的地基。它不教任何 API，但它决定了你后面读每一章时会不会用错直觉。**如果你只读一章，读这一章。**

第 3 章（`useState`）是第一个真正会咬人的地方。「state 是快照」和「不可变更新」这两条规则，在 Vue 里完全没有对应物。跳过这一章直接写代码，你会花几天时间调试「为什么改了 state 界面不动」。

第 5 章（`useEffect`）是第二个，也是最危险的一个。`useEffect` 表面上像 Vue 的 `watch`，实际上是完全不同的东西——它表达的是「与外部系统同步」，不是「侦听数据变化」。用 `watch` 的思维写 `useEffect`，会产生大量本该写在事件回调里的逻辑，进而引发重复请求、竞态和无限循环。React 官方文档专门有一章讲「你可能不需要 effect」，本站会把这一章的判断标准整理成清单。

第 7 章（重渲染与性能）必须在第 3、5 章之后。原因是 React 的性能问题和 Vue 的性能问题根源不同：Vue 的性能问题通常是响应式追踪的范围太大（该用 `shallowRef` 的地方没用），React 的性能问题通常是**引用不稳定**（每次渲染新建对象/函数）和**状态放得太高**（本该局部的状态提到了公共父组件）。不懂第 3 章的重渲染规则，就没法理解引用稳定性为什么重要。

第 2、4、6、8、9、10 章是相对独立的对照章节，理论上可以按需查阅。但建议按顺序读一遍，因为它们各自都包含一个「Vue 直觉在这里会失效」的提醒。

第 11 章必须放在最后。它是「对照法失效的地方」的清单，需要你先建立完整的对照关系，才能理解哪些东西没有对应物。

第 12 章的项目要求你写出对照笔记——这不是形式主义。写不出对照关系的概念，就是你还没真正理解的概念。

## 学习方法

- **用 Vite 创建项目：`npm create vite@latest`，选择 React + TypeScript 模板。** 本站的技术栈已经确定用 Vite，React 和 Vue 在 Vite 下的开发体验高度一致，这样你能把注意力集中在框架差异上而不是工具链上。
- **每学一个对照点，就在两个项目里各写一遍。** 保持一个 Vue 项目和一个 React 项目并排打开，同一个功能各实现一次。这是本领域唯一有效的练习方式——只写 React，你会不自觉地把它当成「另一种 Vue」。
- **写代码前先预测重渲染的范围。** 每次改动 state 之前，先在心里列出「哪些组件会重渲染」，然后用 React DevTools 的 Profiler 验证。预测错了就是最大的收获。这和 [CSS](/css/) 领域「先预测再验证」的方法是同一套。
- **装 React Developer Tools 浏览器扩展。** Profiler 面板能记录每次渲染、显示每个组件的渲染耗时和「为什么渲染」（props 变化 / state 变化 / 父组件重渲染）。第 7 章之后这个面板必须常开。
- **保持开发环境的 `StrictMode` 开启，不要因为它「重复执行」而关掉。** 双调用是它故意的设计，目的是暴露不纯的渲染函数和缺少清理函数的 effect。关掉它等于关掉一个免费的 bug 检测器。
- **读 React 官方文档的 Learn 部分，不要读旧的教程。** React 18 之前的类组件写法（`class X extends Component`、`this.setState`、生命周期方法）在存量项目里还很多，但新代码不应该这么写。本领域全部使用函数组件 + Hooks。
- **每章结束后，回答一个问题：这个 React 概念，我在 Vue 里对应的做法为什么会「更简单」或「更麻烦」？** 这不是为了评判哪个框架好，而是为了逼你理解两个框架各自的设计约束。

## 阶段项目

**双框架对照重写**：把 [Vue 3 领域的阶段项目](/vue/)（多页面待办应用）中的**列表页 + 详情页**用 React + TypeScript 重写一遍，并写出对照笔记。

技术要求：

- 用 `npm create vite@latest` 创建 React + TypeScript 项目，保留 `StrictMode`。
- 路由用 React Router，状态管理方案由你自己选定，但必须在笔记里说明选择理由以及它对应 Vue 生态里的哪个库。
- 全项目函数组件 + Hooks，不出现任何类组件写法。
- TypeScript 严格模式，`any` 出现次数为 0。

功能对等：

- 列表页支持按状态筛选与关键词搜索，筛选状态与 URL 双向同步。
- 详情页通过路由参数访问，ID 不存在时显示 404。
- 与 Vue 版本共用同一份数据接口（延续 Vue 项目里那个可替换的数据适配层），验证你的抽象是框架无关的。

对照笔记（这是本项目的核心产出，不是附属品）：

一份 Markdown 文档，逐项记录以下内容，每项都必须给出两边各自的代码片段：

- 状态定义：`useState` / `useReducer` vs `ref` / `reactive`，各自多写了什么、少写了什么。
- 派生数据：`useMemo` vs `computed`，缓存机制的差异（`useMemo` 不保证一定缓存）。
- 副作用：`useEffect` vs `watch` / `watchEffect`，你在哪个地方因为套用 Vue 直觉而写错了，怎么改的。
- 子组件通信：回调 props vs `emit`。
- 列表渲染：`key` 的处理是否一致。
- 性能：两边分别遇到了什么卡顿，各自的解决方式是什么，为什么不能互相照搬。
- 代码行数与文件数的粗略对比，以及你对差异成因的解释。

验收标准：

- 两个版本的功能行为一致（同样的筛选、同样的 URL 同步、同样的 404 处理）。
- React 版本在 Profiler 里没有明显的无效重渲染：修改一条待办，不应该导致整个列表的所有行组件重渲染。
- 全项目不使用 `as any` 绕过类型检查。
- 对照笔记里至少有 3 处明确记录了「我原本按 Vue 的方式写，结果错了，正确的 React 做法是什么」。如果一处都没有，说明你没有真正在对比，只是在用 React 的语法写 Vue。
- 你能不看代码回答：这个 React 项目里，哪一次 state 更新会触发哪些组件重渲染。

## 官方文档与延伸阅读

React 官方文档有完整的简体中文版本（`zh-hans.react.dev`），内容与英文版同步。**优先读中文版**，术语含糊时对照英文版。

注意：`react.dev` 是 React 18 之后的官方文档站点，以函数组件和 Hooks 为主线。旧的 `reactjs.org` 已重定向，网上大量 React 16/17 时代的教程使用类组件写法，请注意甄别。

- [React 官方文档 · 快速入门（中文）](https://zh-hans.react.dev/learn)（[英文版](https://react.dev/learn)） —— 主入口。
- [React 中的思考方式](https://zh-hans.react.dev/learn/thinking-in-react)（[英文版](https://react.dev/learn/thinking-in-react)） —— **第 1 章必读**，官方给出的 React 设计思维，和 Vue 的思路差异最大的地方就在这里。
- [用 JSX 书写标记语言](https://react.dev/learn/writing-markup-with-jsx)、[你的第一个组件](https://react.dev/learn/your-first-component)、[导入与导出组件](https://react.dev/learn/importing-and-exporting-components) —— 第 2 章核心参考。
- [将 Props 传递给组件](https://react.dev/learn/passing-props-to-a-component)、[State：组件的记忆](https://react.dev/learn/state-a-components-memory)、[响应事件](https://react.dev/learn/responding-to-events) —— 第 3、4 章核心参考。
- [渲染与提交](https://react.dev/learn/render-and-commit)、[State 如同快照](https://react.dev/learn/state-as-a-snapshot)、[排队状态更新](https://react.dev/learn/queueing-a-series-of-state-updates)、[更新状态中的对象](https://react.dev/learn/updating-objects-in-state)、[更新状态中的数组](https://react.dev/learn/updating-arrays-in-state) —— **第 3 章核心参考，快照那一页必须读两遍。**
- [使用 Effect 同步](https://react.dev/learn/synchronizing-with-effects)、[你可能不需要 Effect](https://react.dev/learn/you-might-not-need-an-effect)、[响应式 Effect 的生命周期](https://react.dev/learn/lifecycle-of-reactive-effects)、[将事件从 Effect 中分离](https://react.dev/learn/separating-events-from-effects)、[移除 Effect 依赖](https://react.dev/learn/removing-effect-dependencies) —— **第 5 章核心参考，这一组页面是本领域最重要的外部材料。**
- [将状态逻辑提取为 Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer)、[在组件间共享状态](https://react.dev/learn/sharing-state-between-components)、[选择 State 结构](https://react.dev/learn/choosing-the-state-structure)、[保留与重置 State](https://react.dev/learn/preserving-and-resetting-state)、[用 Reducer 和 Context 进行扩展](https://react.dev/learn/scaling-up-with-reducer-and-context) —— 第 3、6、9 章核心参考。
- [使用自定义 Hook 复用逻辑](https://react.dev/learn/reusing-logic-with-custom-hooks) —— 第 6 章核心参考，对应 Vue 的 composables。
- [使用 Context 深层传递数据](https://react.dev/learn/passing-data-deeply-with-context) —— 第 6 章核心参考，对应 `provide` / `inject`。
- [使用 Ref 引用值](https://react.dev/learn/referencing-values-with-refs)、[使用 Ref 操作 DOM](https://react.dev/learn/manipulating-the-dom-with-refs) —— 第 10 章核心参考。
- [将 UI 理解为一棵树](https://react.dev/learn/understanding-your-ui-as-a-tree) —— 第 7、11 章核心参考，讲协调（reconciliation）与 `key` 的作用。
- [逃逸机制（Escape Hatches）](https://react.dev/learn/escape-hatches) —— 第 10、11 章参考，讲什么时候需要跳出 React 的模型。
- [React 开发者工具](https://react.dev/learn/react-developer-tools) —— 学习方法一节要求的工具。
- Hooks API 参考：[`useState`](https://zh-hans.react.dev/reference/react/useState)、[`useEffect`](https://react.dev/reference/react/useEffect)、[`useMemo`](https://react.dev/reference/react/useMemo)、[`useCallback`](https://react.dev/reference/react/useCallback)、[`useRef`](https://react.dev/reference/react/useRef)、[`useContext`](https://react.dev/reference/react/useContext)、[`useReducer`](https://react.dev/reference/react/useReducer)、[`useLayoutEffect`](https://react.dev/reference/react/useLayoutEffect)、[`useTransition`](https://react.dev/reference/react/useTransition)、[`useDeferredValue`](https://react.dev/reference/react/useDeferredValue)、[`useId`](https://react.dev/reference/react/useId)、[`useImperativeHandle`](https://react.dev/reference/react/useImperativeHandle)、[`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)。
- 组件与 API 参考：[`memo`](https://react.dev/reference/react/memo)、[`createContext`](https://react.dev/reference/react/createContext)、[`Fragment`](https://react.dev/reference/react/Fragment)、[`Suspense`](https://react.dev/reference/react/Suspense)、[`lazy`](https://react.dev/reference/react/lazy)、[`StrictMode`](https://react.dev/reference/react/StrictMode)、[`Profiler`](https://react.dev/reference/react/Profiler)、[`forwardRef`](https://react.dev/reference/react/forwardRef)、[`cloneElement`](https://react.dev/reference/react/cloneElement)、[`Children`](https://react.dev/reference/react/Children)、[`createElement`](https://react.dev/reference/react/createElement)、[Hooks 总览](https://react.dev/reference/react/hooks)、[`createRoot`](https://react.dev/reference/react-dom/client/createRoot)。
- [React Compiler](https://react.dev/learn/react-compiler) —— 第 7 章涉及，自动记忆化。属于较新的能力，读之前先看页面顶部标注的可用状态。
- [React Server Components](https://react.dev/reference/rsc/server-components) —— 第 11 章概览部分。仍在演进，本站只做概念性介绍，不作为主线内容。
- [在已有项目中添加 React](https://react.dev/learn/add-react-to-an-existing-project)、[描述 UI](https://react.dev/learn/describing-the-ui)、[添加交互](https://react.dev/learn/adding-interactivity)、[管理 State](https://react.dev/learn/managing-state) —— Learn 部分的三条主线，可按需查阅。
- [React Router 官方文档](https://reactrouter.com/home)、[框架模式路由](https://reactrouter.com/start/framework/routing)、[库模式安装](https://reactrouter.com/start/library/installation) —— 第 8 章核心参考。
- [Redux 官方文档 · 入门](https://redux.js.org/introduction/getting-started)、[核心概念](https://redux.js.org/introduction/core-concepts)、[React Redux 入门](https://react-redux.js.org/introduction/getting-started) —— 第 9 章核心参考。实际项目请使用 Redux Toolkit（Redux 官方推荐的写法）。
- [Zustand 官方文档](https://zustand.docs.pmnd.rs/) —— 第 9 章核心参考，轻量方案。
- [TanStack Query](https://tanstack.com/query/latest) —— 第 9 章涉及，服务端状态管理，与 Pinia 里手写异步 action 的做法是不同的思路。
- [Vue 3 官方文档（中文）](https://cn.vuejs.org/guide/introduction.html) —— 本领域的对照基准，全程需要并排打开。
- [Vue 渲染机制](https://cn.vuejs.org/guide/extras/rendering-mechanism.html) 与 [响应式深入](https://cn.vuejs.org/guide/extras/reactivity-in-depth.html) —— 第 1、7 章做对比时的 Vue 侧依据。
- [Vite 官方文档（中文）](https://cn.vite.dev/guide/) —— 建站工具，第 12 章项目使用。

## 版本说明

本领域内容基于 **React 18 / 19 世代**（函数组件 + Hooks，官方文档 `react.dev`）编写，配套 **React Router 6 及之后版本**，核实时间为 2026 年 10 月。

时效性风险按章节区分：

- **第 2–6、10 章（JSX、Hooks 基础、Context）稳定。** Hooks 模型自 React 16.8 引入以来没有本质变化，`useState` / `useEffect` / `useRef` / `useContext` 的语义是稳定的。
- **第 7 章（重渲染与性能）中等风险。** React Compiler 的目标是自动完成大部分记忆化工作，如果它在你的项目里启用，`useMemo` / `useCallback` / `memo` 的必要性会显著下降。本站会同时讲「手动记忆化」和「编译器时代的变化」，但两者的比重会随 React Compiler 的普及程度调整。
- **第 8 章（路由）风险较高。** React Router 在主版本之间经历过较大的 API 与定位调整（从纯路由库到带数据加载能力的框架），网上教程的版本混乱程度是 React 生态里最严重的。动手前先确认你安装的版本，并以 [官方文档](https://reactrouter.com/home) 的当前版本为准。
- **第 9 章（状态管理）风险较高。** 生态选型在持续变化：Redux 官方已明确推荐 Redux Toolkit 而非原始 Redux，轻量方案（Zustand 等）的使用比例在上升。本章给出的是「本站的选型与理由」，不是生态现状的完整描述。
- **第 11 章的 React Server Components 部分风险最高。** RSC 及其配套的构建/部署方式仍在演进，具体用法和可用能力变化很快。本章只做概念性介绍，不给出可复制的代码模式。
- **本站不涉及类组件。** `class X extends React.Component`、`this.setState`、`componentDidMount` 一类写法在存量项目里仍然常见，需要维护旧代码时请查 React 的[旧版文档站点](https://legacy.reactjs.org/docs/hooks-intro.html)（该站点保留了 React 18 之前的历史内容）。
