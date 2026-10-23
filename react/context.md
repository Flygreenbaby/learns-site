# Context 与 provide / inject：它解决的是穿透，不是状态管理

三种故障，都因为把 Context 当成了「全局状态容器」。第一种：你把待办列表放进 Context，然后每次输入一个字符，整棵页面树（包括三百行的列表、图表、侧边栏）全部重渲染，输入延迟 200 ms。第二种：某个组件里 `useContext(ThemeContext)` 拿到 `undefined`，`theme.color` 直接崩，而 Provider 明明写在 `App` 上——因为它包在 `<BrowserRouter>` 外面、而报错的组件在另一个子树里。第三种：你给 Provider 写了 `value={ { user, login } }`（内联对象字面量），于是所有消费者在 Provider 所在组件每次渲染时都更新一次，哪怕 `user` 一个字都没变。

根子是一条机制：**Context 的值变化会让「读取它的所有组件」重新渲染，从 Provider 往下，无一例外。** Vue 的 `provide` / `inject` 没有这条硬性质（它的更新粒度取决于你注入的是 ref 还是普通值，以及谁读了哪个属性），所以按 Vue 直觉选场景，在 React 里就会越界。

Context 真正的定位是「**跳过中间层传递依赖**」：主题、语言、当前登录用户、设计令牌、路由库内部的当前路径。这一章把 API 逐项对照、把那条重渲染性质讲透、给出拆两个 Context 的正解，并把 `useLocalStorage` 在两家各写一遍作为 composable 与自定义 Hook 的对照样本。前置：[props、回调与 children](/react/props-and-children)、[生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject)、[useEffect 与 watch 的对照](/react/use-effect)。

## 最小可用实现与逐项对照

React 三件套：`createContext` 造对象、Provider 提供值、`useContext` 读取。

```tsx
import { createContext, useContext } from 'react';

type Theme = 'light' | 'dark';

// 默认值写成 null，才能区分「没有 Provider」与「Provider 给了个假值」
const ThemeContext = createContext<Theme | null>(null);

export function useTheme(): Theme {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme 必须在 ThemeProvider 内部使用');
  }
  return value;
}

export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ThemeContext value={theme}>{children}</ThemeContext>;
}

function Toolbar() {
  const theme = useTheme();      // 'dark'
  return <div className={`toolbar toolbar-${theme}`}>...</div>;
}
```

Vue 3 的等价三件套：

```ts
// provider.ts —— 契约放在独立模块，key 只导出一次
import type { InjectionKey } from 'vue';
export type Theme = 'light' | 'dark';
export const ThemeKey: InjectionKey<Theme> = Symbol('theme');
```

```vue
<!-- App.vue：提供 -->
<script setup lang="ts">
import { provide } from 'vue';
import { ThemeKey, type Theme } from './provider';
provide(ThemeKey, 'dark' as Theme);
</script>
```

```vue
<!-- Toolbar.vue：读取 -->
<script setup lang="ts">
import { inject } from 'vue';
import { ThemeKey } from './provider';
const theme = inject(ThemeKey, 'light');   // 第二个参数是默认值
</script>
```

| 维度 | React Context | Vue provide / inject |
| --- | --- | --- |
| 声明「注入契约」 | `createContext<T>(默认值)` 返回一个对象，同时当 Provider 和 Consumer 用 | `Symbol` + `InjectionKey<T>`（类型只存在于编译期） |
| 提供 | 在树里渲染 `<Context.Provider value={v}>`（官方现在的示例写成 `<Context value={v}>`） | 祖先组件调用 `provide(key, value)` |
| 读取 | `useContext(ctx)`，只能在函数组件/自定义 Hook 里 | `inject(key, 默认值, { treatAsDefault })`，setup 里调用 |
| 找不到提供方 | 返回 `createContext` 的默认值（默认是 `undefined` 时你就拿到 `undefined`） | 返回 `inject` 的第二个参数；都没有时在开发环境 `console.warn` |
| 值变化时谁更新 | 所有 `useContext` 该 Context 的组件重渲染（`Object.is` 比较新旧值） | 注入方拿到的引用不会「自动重跑」：注入 ref/reactive 才有响应性，且更新粒度是「谁读了哪个属性」 |
| 覆盖 | 子树里再放一个 Provider 就形成局部值（这是特性，用于多账号嵌套） | 同名 key 在中间层再 `provide` 同样形成局部覆盖 |
| 类型安全 | 从 `createContext<T>` 一路推下来，天然强类型 | 依赖 `InjectionKey`，key 泄漏到模块外才能保持类型；用字符串 key 会退化成 `unknown` |
| 可否条件调用 | 不能：Hooks 规则 | 可以（`provide` 不是 Hook），但一般也不这么设计 |
| 调试可见性 | React DevTools 能显示 Provider 与读它的组件 | Vue devtools 有 provide/inject 面板 |

「找不到提供方返回默认值」这一条有官方原话：如果父树里找不到该 Context 的 Provider，`useContext()` 返回的值就等于你创建时指定的 default value。这就是**默认值要写 `null` 而不是随便造一个假主题**的原因——否则「忘包 Provider」会伪装成「Provider 给了默认主题」，你花半天查的是一个装配问题。把抛错收敛到自定义 Hook 里（上面 `useTheme`），报错信息就能直接指向组件名。

<Callout type="unverified" title="Provider 写法的新旧与版本">

官方文档现在的示例把 Context 对象直接当 Provider 使用（`<ThemeContext value="dark">`），本站示例跟它一致；同时 `<ThemeContext.Provider value=...>` 这种写法在存量项目里占绝大多数，React DevTools 与既有教程也都用它。**两者在各主流版本的具体支持范围与旧写法的移除计划，本章未逐字核实**（React 19 升级指南里没提这条变更）。请以 [createContext 参考](https://react.dev/reference/react/createContext) 与该升级指南的当前内容为准；团队里统一一种写法，别混。

</Callout>

## 值一变，所有消费者一起更新

这是本章唯一必须刻进脑子的机制。官方 caveats 原文：**React 会自动重渲染所有使用了该 Context 的子组件，起点是那个收到了不同 `value` 的 Provider；前值与后值用 `Object.is` 比较。**

三条直接推论：

1. **`memo` 救不了你。** 官方另一句 caveats：即使用了 `memo`，组件用到的 Context 变化时它仍会重渲染——memo 只管父组件传下来的 props。所以「给每个消费者包 `memo`」不是 Context 的性能方案。
2. **消费者不区分读了哪个字段。** `useContext(configContext)` 拿到整个对象，Provider 换新引用（哪怕内容一样，只要 `Object.is` 不等）时，每个调用点都会重渲染。这与 Vue 完全不同：Vue 里注入一个 `reactive` 对象，只有模板里真正读过的那个属性变化才会唤醒对应组件（依赖收集按「对象 + 键」，见[响应式原理](/vue/reactivity)）。
3. **Provider 所在组件的重渲染本身就是触发源。** 只要 `value` 是内联字面量，Provider 组件每次渲染都会交出一个新对象 → 所有消费者每次都更新。这就是第三种故障的成因。

由此得到 Context 的定位判断：**它适合「很少变化、多消费者、跨层级」的值**。反过来说，把频繁变化的业务数据放进 Context，等于给整棵子树装了一个广播器。

## 「Provider 的 children 用 prop 传入」到底能省什么

社区流传一条「缓解手段」：把 children 用 prop 传进 Provider 所在的子树，可以让 Provider 重渲染时不牵连子树。**它的真实语义比流传的版本窄，本站按官方文档拆开说。**

| 做法 | 真实效果 | 依据 |
| --- | --- | --- |
| `<Layout><Panel /></Layout>`，Panel 是 children（由上层组件创建） | **上层组件不重渲染时**，`Layout` 自己 state 变化不会重渲染 Panel 子树 | `memo` 参考页原话：包裹型组件接受 JSX 作为 children，包装组件更新自身 state 时 React 知道 children 不需要重渲染 |
| 用 `useMemo` 稳定 `value` 对象 | Provider 组件重渲染但 Context 值语义未变时，避免消费者被无谓更新 | `useContext` 页「Optimizing re-renders when passing objects and functions」一段，示例正是 `useCallback` 包 `login`、`useMemo` 包 `{ currentUser, login }` |
| 把 children 传成一个变量（`const content = <Panel />; <Provider value={v}>{content}</Provider>`） | 只有当 children 是在**不重渲染的组件**里创建时才有效；如果 Provider 组件自己创建 children，它照样重建 | 由上一行的机制推出 |
| 给消费者加 `memo` | **对 Context 变化无效**，官方明写 | `memo` caveats |

**诚实的结论：children-as-prop 不是 Context 的优化手段，而是「减少中间层转发」的组件设计手段。** Context 官方教程给的正是这个用法：当某个中间层组件只是把 props 往下转发、自己并不使用它们时，把消费组件作为 `children` 渲染进去，减少「state 变化的组件」与「真正需要它的组件」之间的距离。**当 Context 值真的变了，消费者该更新的还是要更新，没有任何 prop 传法能绕过它。** 想绕过，只有拆 Context（下一节）或者换 store 库。

## 正解：拆成「状态 Context」与「dispatch Context」

场景：待办应用，`TaskList` 要读列表，`AddButton` 只想派发新增动作。合成一个 Context 时，按钮会随列表任何变化重渲染。分开之后，`dispatch` 引用稳定，动作型消费者基本不更新。

```tsx
import { createContext, useContext, useReducer, useMemo, type ReactNode } from 'react';

type Todo = { id: string; text: string; done: boolean };

type State = { todos: Todo[] };

type Action =
  | { type: 'add'; text: string }
  | { type: 'toggle'; id: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add':
      return {
        ...state,
        todos: [{ id: crypto.randomUUID(), text: action.text, done: false }, ...state.todos],
      };
    case 'toggle':
      return {
        ...state,
        todos: state.todos.map((t) => (t.id === action.id ? { ...t, done: !t.done } : t)),
      };
  }
}

const TasksStateContext = createContext<State | null>(null);
const TasksDispatchContext = createContext<React.Dispatch<Action> | null>(null);

export function TasksProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { todos: [] });

  // 只有 state 变化时才换 value；dispatch 交给另一个 Context，引用不需要 memo
  const stateValue = state;

  return (
    <TasksStateContext value={stateValue}>
      <TasksDispatchContext value={dispatch}>
        {children}
      </TasksDispatchContext>
    </TasksStateContext>
  );
}

function useTasks(): State {
  const ctx = useContext(TasksStateContext);
  if (!ctx) throw new Error('useTasks 必须在 TasksProvider 内部使用');
  return ctx;
}

function useTasksDispatch(): React.Dispatch<Action> {
  const ctx = useContext(TasksDispatchContext);
  if (!ctx) throw new Error('useTasksDispatch 必须在 TasksProvider 内部使用');
  return ctx;
}

export function AddButton() {
  const dispatch = useTasksDispatch();      // 不随列表变化重渲染
  return <button onClick={() => dispatch({ type: 'add', text: '新任务' })}>新增</button>;
}

export function TaskCount() {
  const { todos } = useTasks();             // 列表变化时更新
  return <span>{todos.length}</span>;
}
```

这套拆法正是官方「用 Reducer 和 Context 进行扩展」一页给出的结构：`TasksContext` 与 `TasksDispatchContext` 两个 Provider 嵌套，深层组件各自读自己那一份，避免 prop drilling。而 `dispatch` 可以不担心引用变化——`useReducer` 参考页的 caveats 有原话：**`dispatch` 函数具有稳定的标识（stable identity），因此经常能看到它被从 Effect 依赖里省略，写进去也不会导致 Effect 触发。**

需要更细的更新粒度时（「只有第一项变了，其它行不要重渲染」），Context 就不再是合适的工具了，那是选择器（selector）的活：[Zustand / Redux](/react/state-management) 内部用 `useSyncExternalStore` 实现订阅 + 选择器，只在该选择结果变化时唤醒组件。把 Context 硬做成选择器模式（`useContextSelector` 一类第三方方案）能做，但那是把库的机制复制到你的业务代码里，本站不推荐。

## 用 useMemo 包住 value：省的是引用，不是更新

```tsx
function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const login = useCallback((credentials: Credentials) => {
    void storeCredentials(credentials).then(setUser);
  }, []);

  const value = useMemo(() => ({ user, login }), [user, login]);

  return <AuthContext value={value}>{children}</AuthContext>;
}
```

这段就是官方示例的形状（`useCallback` 包函数、`useMemo` 包对象、依赖列出真实用到的值）。它省掉的是「Provider 所在组件因为无关 state 重渲染时，新造出一个内容相同的 value 对象」。

必须同时说清它的边界：

- `useMemo` 是**性能优化，不是语义保证**——官方允许 React 在必要时丢弃缓存并重算，所以不能靠它保证「引用一定不变」。
- 它**不能**阻止 value 真的变化时消费者的更新。该更新的还是要更新。
- 它引入了新的失效风险：依赖数组漏写 `user`，Context 里的值就会停在旧的那一份，形成又一个 stale closure（见 [useEffect](/react/use-effect) 里同一类问题）。`exhaustive-deps` 对 `useMemo` 同样生效，别压。
- 加了 `useMemo` 之后仍然没有解决的，是「所有消费者一起更新」这件事本身。要做的是拆 Context。

## 适用清单与不适用清单

| 适合 Context | 为什么适合 |
| --- | --- |
| 主题 / 深色模式 | 变化极少（可能一次会话只变一次），多个不相关分支都要读 |
| 语言 / 区域 / 设计令牌 | 同上，官方把 theming 列为第一个例子 |
| 当前登录用户、当前账号 | 官方明确列为适用场景，并示范用嵌套 Provider 表示「以另一个账号身份发表评论」 |
| 路由库内部「当前路径」 | 官方说明多数路由方案内部用 Context 持有当前路由，让每个链接知道自己是否 active |
| 与 `useReducer` 搭配的、位置较高且被许多远处组件修改的复杂状态 | 官方认可的做法，配合上一节的拆分模式 |
| 跨层级的对话框 / 抽屉控制器（全局 open/close） | 一个稳定的 dispatch，消费者不会因此频繁更新 |

| 不适合 Context | 为什么不适合 | 该用什么 |
| --- | --- | --- |
| 频繁变化的业务数据（列表内容、搜索结果、倒计时） | 值一变，所有消费者更新；无属性粒度 | 提升到需要它的最深共同父组件；或用带选择器的 store |
| 表单字段值 | 每次键入都换 value，整片消费者重渲染；且表单天然是局部的 | state 放在持有该字段的组件里，见[useRef 与受控组件](/react/refs-and-forms) |
| 列表项的单项数据 | 一项变化牵连全列表 | 直接 props 传下去（第 4 章），配合 `memo` 与稳定回调 |
| 只有一个消费者的深层数据 | 白担 Context 的广播代价 | 继续传 prop；官方原话就是「需要往下传几层，并不意味着你该把它放进 Context」 |
| 组件之间的调用（父改子） | Context 不是事件总线 | 语义回调 props；不要用 Context 传 setter |
| 服务端渲染时的每请求单例状态 | 模块级 Provider/Context 若放错位置会跨请求串数据 | 每请求一棵 Provider 树，或用框架方案 |

最后一行只需要知道有这件事：本站示例是纯客户端项目。若你以后要在 SSR / 元框架里用 Context，Provider 必须在每次请求的渲染入口里新建，任何挂在模块顶层的可变对象都可能跨请求共享。

## 与 Redux / Zustand 的分工

一句话：**Context 解决「穿透」，store 库解决「集中管理 + 细粒度订阅」。** Context 自带重渲染广播、没有开发者工具的时间旅行、没有跨页面持久化方案、也没有选择器；store 库（Zustand 的极简模型、Redux Toolkit 的 slice）内部用 `useSyncExternalStore` 订阅，只唤醒依赖变化结果的那几个组件。

本站的选择：全局共享的是**环境类低频值** → Context；全局共享的是**业务实体集合且被频繁修改** → Zustand（小型）或 Redux Toolkit（需要严格 action/reducer 约束的中大型）；**服务端数据** → TanStack Query 一类，不要用 Context 手搓缓存。完整选型与 Pinia 对照在[状态管理选型](/react/state-management)。

## 自定义 Hook 对应 composable：useLocalStorage 两边各写一遍

composable（Vue）与自定义 Hook（React）解决同一件事：把「状态 + 相关逻辑」打包成可复用函数。但两条硬约束不同：**Hook 每次渲染都会重新执行，且必须遵守调用顺序；composable 只在 setup 里执行一次，返回的是持续存在的响应式引用。**

Vue 版（详解在[组合式 API 与 composables](/vue/composables)）：

```ts
import { ref, watch, type Ref } from 'vue';

export function useLocalStorage<T>(key: string, initial: T): Ref<T> {
  const raw = localStorage.getItem(key);
  const data = ref<T>(raw !== null ? (JSON.parse(raw) as T) : initial);

  // 写入放在 watch 里：值变了才落盘，且只在 setup 建立一次订阅
  watch(data, (value) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { deep: true });

  return data;
}

// 使用
const todos = useLocalStorage<Todo[]>('todos', []);
todos.value.push(newTodo);   // 响应式，界面自己跟上
```

React 版：

```tsx
import { useCallback, useState } from 'react';

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;   // JSON 坏了或隐私模式禁用存储：降级为初始值，不要让整棵树崩
  }
}

export function useLocalStorage<T>(key: string, initial: T) {
  // 惰性初始值：只在真正的首次挂载读一次存储，不要用 useEffect 去 setState
  const [value, setValue] = useState<T>(() => readStored(key, initial));

  // 写入与 setState 绑在同一个动作里，而不是靠 effect 同步
  const setAndPersist = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        /* 存储配额满：忽略，界面仍然工作 */
      }
      return resolved;
    });
  }, [key]);

  return [value, setAndPersist] as const;
}

// 使用
const [todos, setTodos] = useLocalStorage<Todo[]>('todos', []);
setTodos((prev) => [newTodo, ...prev]);
```

两边差异集中在三处，也是本章最实用的对照：

| 点 | Vue | React | 为什么必须这么写 |
| --- | --- | --- | --- |
| 函数引用稳定性 | 返回的是 ref，`todos.value = x` 不需要任何「稳定」考虑 | 必须 `useCallback` 包住返回的 setter，否则调用方 `useEffect` 依赖它会每轮重跑、`memo` 子组件永远失效 | React 里函数是值，每次渲染新建；这是 composable 与 Hook 最大的体感差异 |
| 持久化时机 | `watch`（响应式依赖自动追踪） | 写进 setter，**不放 effect** | 用 `useEffect` 每次渲染都 `setItem` 是白烧；用 effect 做「state 与存储同步」还引入写回顺序问题。第 5 章的判断清单第 2 条正是这个 |
| 首次读取 | setup 里读一次即可 | `useState(() => ...)` 惰性初始值 | effect 里 `setState(load())` 会先渲染一次空态；`key` 变化时惰性初始值也不会重跑，需要重建就给上层组件传 `key` |

补一条常见需求：跨标签页同步（`storage` 事件）。那是「与外部系统同步」，**该用 effect**，而且要成对清理：

```tsx
useEffect(() => {
  const controller = new AbortController();
  window.addEventListener('storage', (e) => {
    if (e.key === key && e.newValue !== null) {
      setValue(JSON.parse(e.newValue) as T);
    }
  }, { signal: controller.signal });
  return () => controller.abort();
}, [key]);
```

注意 `storage` 事件**不会**在写入它的那个标签页里触发，所以这条 effect 只解决「别的标签页改了我要跟上」，与本地写入互不冲突。

## 定位性能：为什么这个组件重渲染了

顺序是：装 React Developer Tools → 打开 Profiler 面板 → 录一次交互 → 选中那个「不该更新」的组件 → 看它的 **why did this render**（Reason for re-render / 「钩子相关」列，取决于扩展版本）。

| Profiler 给出的原因 | 对应 Context 场景 | 处理 |
| --- | --- | --- |
| Context / hooks 相关（消费者更新） | Provider 的 value 换新引用，而它语义没变 | `useMemo` 包 value；检查依赖数组 |
| Provider re-render | Context 值真的变了（业务数据） | 拆状态/dispatch Context；或把该数据移出 Context |
| 父组件重渲染（props 变化） | 与 Context 无关，是第 4 章的 children 引用问题 | `memo` + 稳定 props |
| state 更新 | 组件自身 state | 检查是不是派生值被存成了 state（第 5 章清单第 1 条） |

**没有 Profiler 就别优化 Context。** 凭猜测定位是 React 性能工作里最常见的浪费，这也是领域首页学习方法一节要求常开 Profiler 的原因。深入的重渲染机制、`useMemo` / `useCallback` 的成本收益与 React Compiler 的影响都在[重渲染机制与性能](/react/re-render-performance)。

## 多个 Provider 的可读性组织

树顶叠四层 Provider 会形成「回调地狱式缩进」。做法是把它们收进一个组件，业务代码只看得到 `<AppProviders>`：

```tsx
import { ThemeProvider } from './ThemeContext';
import { AuthProvider } from './AuthContext';
import { TasksProvider } from './TasksContext';
import { LocaleProvider } from './LocaleContext';
import type { ReactNode } from 'react';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <AuthProvider>
          <TasksProvider>{children}</TasksProvider>
        </AuthProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}

// main.tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
```

三条规则：**顺序按「变化频率从低到高」排**（主题在最外、业务数据在最内，内层重渲染不会被外层牵连）；**Provider 必须在会被条件渲染的子树之外**（下面第 5 条故障就是这点）；**不要在 `AppProviders` 里放任何 state**——它一旦有 state，它自己就会成为整棵树的更新源头。需要更克制的写法时，React 也允许把 Provider 抽到自定义组件里（`<AppProviders>` 本身就是一种），别追求「一个万能 Provider」。

## 常见错误与排查

1. **`useContext` 返回 `null` / `undefined`，组件崩在下一行。** 现象：`Cannot read properties of null (reading 'color')`。原因：Provider 忘包、包在别的子树里（常见于包在 `<BrowserRouter>` 外而组件在 `<Routes>` 内、或 Portal 之外）、或 Provider 与 Consumer 用了**两个不同的 `createContext` 结果**（各自文件里各造了一次）。怎么确认：在组件里打印 `useContext(X)`；核对 Provider 与读取处 `import` 的是同一个模块导出的同一个对象。怎么修：把 `createContext` 收敛到唯一模块导出，Provider 包住使用它的**最近共同祖先**，并把抛错写在自定义 Hook 里让报错带组件名。
2. **value 每次渲染都是新对象，所有消费者跟着抖。** 现象：什么都没改，输入卡顿、动画重放。原因：`value={ { user, login } }` 这种内联对象字面量。怎么确认：Profiler 里看到消费者更新原因是 Context；在 Provider 组件加 `console.log('provider render')` 与消费者日志对照。怎么修：`useMemo` 包 value、`useCallback` 包函数；如果 value 本来就包含频繁变化的业务数据，拆 Context（状态/dispatch），而不是继续加 memo。
3. **把 dispatch 与 state 放在同一个 Context 里，动作型组件无谓重渲染。** 现象：一个只有「新增按钮」的组件每次列表变化都渲染。怎么确认：给该组件加 `console.log`，改一条列表看它是否打印。怎么修：拆两个 Context（本章的模式），`dispatch` 单独提供。
4. **在 class 组件里调用 Hook。** 现象：`Invalid hook call` 或 `Hooks can only be called inside the body of a function component`。原因：`useContext` 是 Hook，class 里只能用静态上下文（本站不涉及）。怎么确认：看组件是 `class` 还是函数。怎么修：改成函数组件；确实不能改的历史 class，用 `<Context.Consumer>` 包裹渲染，或在上层用函数组件桥接。
5. **Provider 放在被条件渲染的子树里，切换时状态整个丢掉。** 现象：展开/收起一个面板，里面的表单值、列表滚动位置全没了。原因：`{open && <TasksProvider>...</TasksProvider>}`——Provider 卸载时它持有的 state 一起卸载。怎么确认：把条件挪到 Provider 内部（`<TasksProvider>{open && <Panel/>}</TasksProvider>`）看问题是否消失。怎么修：把 Provider 提到条件之外，让被包裹的子树卸载而 Provider 留在原地。
6. **给 Context 传了个「setter」当事件总线。** 现象：任何组件都能改任何 state，数据流无法审计。原因：把 `setTodos` 放进了 Context 来替代回调。怎么确认：全局搜 `useXxx().set` 的调用点。怎么修：Context 只提供 **action/dispatch**（语义化的动作），不提供裸 setter；单点父子通信用 prop 回调（第 4 章）。
7. **`useContext` 读到的值在异步回调里过期。** 现象：定时器/事件监听里读到的还是旧主题。原因：Context 值和 props 一样是渲染快照，effect/回调捕获的是当时那份。怎么确认：对照[props 快照](/react/props-and-children)那节的同型例子。怎么修：把该值列进依赖，或改用 dispatch 形式避免读旧值。
8. **以为 `memo` 能挡住 Context 更新。** 现象：加了 `memo` 依旧全树渲染。原因：官方 caveats 明说 memo 只作用于父传下来的 props，Context 变化照样重渲染消费者。怎么修：见上面第 2、3 条。

## 练习

<Exercise title="练习 1 · 把这段 Vue 写法翻译成 React 并说明行为差异" difficulty="基础">

Vue 侧：

```vue
<!-- 上层组件 -->
<script setup>
import { reactive, provide } from 'vue';
const state = reactive({ theme: 'light', locale: 'zh-CN' });
const toggleTheme = () => { state.theme = state.theme === 'light' ? 'dark' : 'light'; };
provide('app-state', state);
provide('app-actions', { toggleTheme });
</script>
```

```vue
<!-- 深处某个组件 -->
<script setup>
import { inject } from 'vue';
const state = inject('app-state');
const { toggleTheme } = inject('app-actions');
</script>
```

翻成 React（要求保留「状态」与「动作」分开的意图），并说明：`toggleTheme` 变化时两边消费者的更新范围差异。

<template #answer>

```tsx
const AppStateContext = createContext<AppState | null>(null);
const AppActionsContext = createContext<AppActions | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const locale = 'zh-CN';

  const state = useMemo(() => ({ theme, locale }), [theme, locale]);
  const actions = useMemo<AppActions>(() => ({
    toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
  }), []);

  return (
    <AppStateContext value={state}>
      <AppActionsContext value={actions}>{children}</AppActionsContext>
    </AppStateContext>
  );
}
```

行为差异：Vue 里注入 `reactive` 对象的组件，只有它**实际读过的那个属性**变化时才会更新——只读 `locale` 的组件不会因 `theme` 变化重渲染。React 里 `state` 是一个整体 value，`theme` 一变，`useContext(AppStateContext)` 的每一个调用点都重渲染，不区分读了哪个字段。所以 React 侧要按「一起变化的数据 + 同一批消费者」来划 Context 边界；如果 `locale` 与 `theme` 的消费群体完全不同，就再拆成两个 Context，或者干脆把 `locale` 交给专门的 `LocaleContext`（低频、几乎不变，正是 Context 的教科书场景）。`actions` 用 `useMemo`（依赖为空）保持引用稳定，让只读动作的组件基本不更新——这与 `dispatch` 单独成 Context 是同一个思路。

</template>

</Exercise>

<Exercise title="练习 2 · 找出不该用 Context 的地方" difficulty="进阶">

下面四项需求，哪些应该用 Context？哪些应该用 props 或别的手段？说明理由。① 深色模式开关值，导航栏、主题按钮、页面主体都要读；② 当前搜索关键词，输入框与结果列表共享；③ 待办列表数据，200 项，随时增删；④ 全局错误提示的显示与关闭。

<template #answer>

① **Context**（低频、跨分支、环境类）。② **不要用 Context**：输入框每次键入都变，Context 会让每个消费者重渲染。把 state 提到输入框与结果列表的最近共同父组件，结果列表作为 children 传进去——官方教程给出的正是「用 children 抽出中间层组件」这个解法。③ **默认不用 Context**：变化频繁 + 无属性粒度。要么数据就属于那个页面（提到页面组件、props 传下去 + `memo` 行组件），要么用带选择器的 store（第 9 章）。官方也提到「与 useReducer 搭配的远处复杂状态」是适用场景，所以这不是绝对禁止，判据是**变化频率 × 消费者数量**。④ **Context 可以**，但要提供的是 action（`showError(msg)`）而不是「错误数组」——或者用一个专门的 toast 库/`createPortal` 方案；注意 ④ 与 ③ 的区别：动作稳定，状态易变。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释现象" difficulty="挑战">

```tsx
const UserContext = createContext<User | undefined>(undefined);

function SessionProvider() {
  const [children, user] = useUserLoader();
  return <UserContext value={{ user, children }} />;
}

export function useUser() {
  return useContext(UserContext)!.user;
}
```

组件树是 `<SessionProvider><Profile /></SessionProvider>`，`Profile` 里 `const user = useUser()` 后访问 `user.name`。指出这段的全部问题（至少三处）。

<template #answer>

1. **没渲染 children。** `<UserContext value={...} />` 是自闭合标签，`Profile` 根本不在 Provider 子树里 → `useContext` 返回默认值 `undefined` → `useContext(...)!` 的非空断言把类型问题按下去了，运行时抛 `Cannot read properties of undefined`。修法：`return <UserContext value={user}>{children}</UserContext>`。
2. **value 形状错了 + 每次渲染新对象。** Context 的 value 是 `user`，不是「user 加 children」；children 不该塞进 value。而且内联对象字面量每次渲染都是新引用，所有消费者每次都被更新（官方 caveats：`Object.is` 不等就往下广播）。修法：value 只放需要共享的数据，必要时 `useMemo`。
3. **默认值用 `undefined` + 非空断言。** 「找不到 Provider」和「用户未登录」两种情况被压成同一个 `undefined`，`!` 又把报错推到运行期。修法：`createContext<User | null>(null)`，并在 `useUser` 里显式检查、必要时区分「无 Provider（抛错）」与「未登录（返回 null）」。
4. **命名不一致的次要问题**：`useUserLoader()` 返回 `[children, user]` 这种顺序颠倒的元组是可读性事故，元组解构的顺序就是它的文档。

</template>

</Exercise>

<Exercise title="练习 4 · 拆 Context" difficulty="进阶">

一个 `TodosProvider` 同时提供 `{ todos, addTodo, removeTodo }`。Profiler 显示：只有「新增按钮」的组件在每次列表变化时都重渲染。写出改造方案并解释为什么它有效——`addTodo` 依然是每次渲染新建的函数，消费者为什么不再更新？

<template #answer>

两个 Context：`TodosStateContext`（value 是 `todos`）与 `TodosActionsContext`（value 是 `addTodo` / `removeTodo`，用 `useMemo` 或改用 `useReducer` 的 `dispatch` 保持引用稳定）。

按钮只读 actions：当 `todos` 变化时，actions 的 value 引用没变，`Object.is` 相等 → 不触发消费者更新。如果 actions 里包含 `setTodos` 派生的函数，必须 `useMemo`/`useCallback` 包住，否则 actions 本身每轮换新引用，拆 Context 白拆。最稳的做法是彻底改用 `useReducer`：`dispatch` 有稳定标识（官方原话），可以放进空依赖数组的 effect 而不引起重跑，也因此适合放进 Context。

反过来提醒一句：这不是「让该更新的组件不更新」。如果按钮确实需要知道 `todos.length` 才能禁用，它就必须是状态消费者，更新是正确行为；此时能做的是把这个组件做小。

</template>

</Exercise>

<Exercise title="练习 5 · 定位一次异常重渲染" difficulty="挑战">

你发现切换主题时，一个只读 `AuthContext`（内容是当前用户）的组件也重渲染了。给出排查路径与至少两个可能原因。

<template #answer>

路径：Profiler 录制 → 选中该组件 → 看更新原因。**(a) 原因是「父组件重渲染」而非 Context**：主题 Provider 通常在最外层，它的 value 变化会让它下面的**整棵 JSX 树重新执行**——外层组件重渲染时，中间所有没有 `memo` 的组件都会重渲染，与它们读哪个 Context 无关。这是 React 与 Vue 最直观的差别（Vue 靠响应式依赖追踪，只有真正读到的组件更新）。修法：给该组件加 `memo`，并保证它收到的 props 引用稳定；或者把主题值下沉到需要它的子树。**(b) 两个 Provider 在同一组件里**：主题 state 与用户 state 都放在同一个组件（例如 `AppProviders` 自己持有 state），任何一次 setState 会让两处 value 都重建，Auth 消费者因此更新。修法：各自独立 Provider 组件、各自持有自己的 state，`AppProviders` 只负责嵌套不做状态容器；value 用 `useMemo`。**(c) 次要**：`AuthContext` 的 value 是内联对象，本来每轮都变。区分这三种情况要靠 Profiler 的更新原因字段，而不是靠猜。

</template>

</Exercise>

## 官方文档与延伸阅读

- [`useContext` 参考](https://react.dev/reference/react/useContext) —— 核实：无 Provider 时返回 `createContext` 的默认值；「React 会自动重渲染所有使用该 Context 的子组件，起点是收到不同 value 的 Provider，前后值用 `Object.is` 比较」；「`memo` 不能阻止消费者拿到新的 Context 值」；`useCallback` + `useMemo` 优化对象与函数型 value 的官方示例。
- [使用 Context 深层传递数据](https://react.dev/learn/passing-data-deeply-with-context) —— 核实适用场景清单（主题、当前账号/多账号嵌套、路由内部持有当前路径、与 reducer 搭配的复杂共享状态）、「需要传几层不等于该用 Context」、以及「把中间层抽出来、用 children 渲染消费组件」的建议。
- [用 Reducer 和 Context 进行扩展](https://react.dev/learn/scaling-up-with-reducer-and-context) —— 本章「状态 Context + dispatch Context」代码结构的原始出处。
- [`createContext` 参考](https://react.dev/reference/react/createContext) —— 核实 Provider 写法的新旧与默认值语义（对应本章 unverified 说明）。
- [`useReducer` 参考](https://react.dev/reference/react/useReducer) —— 核实「`dispatch` 函数具有稳定的标识，因此常被从 Effect 依赖中省略」。
- [`useSyncExternalStore` 参考](https://react.dev/reference/react/useSyncExternalStore) —— 核实「订阅外部数据源」的定位，用于理解 store 库与 Context 的分工。
- [使用自定义 Hook 复用逻辑](https://react.dev/learn/reusing-logic-with-custom-hooks) —— 核实「Hook 每次渲染都重新执行」「effect 应留在 Hook 内部并由依赖数组决定重跑」这一组结论。
- [React 开发者工具](https://react.dev/learn/react-developer-tools) —— Profiler 与「为什么渲染」信息的来源。
- [Vue 依赖注入](https://cn.vuejs.org/guide/components/provide-inject.html)、[组合式函数 composables](https://cn.vuejs.org/guide/reusability/composables.html) —— Vue 侧对照依据：`InjectionKey`、`inject` 默认值与告警、composable 的一次性执行语义。核实时间 2026-10-17。
- 站内相关：[生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject)、[组合式 API 与 composables](/vue/composables)、[状态管理选型](/react/state-management)。

## 下一章

到这里，React 的三个「跨组件」手段你已经有了完整对照：往下传用 props（值、函数、JSX 都是 prop，见[props、回调与 children](/react/props-and-children)），与外部系统同步用 effect（见 [useEffect 与 watch 的对照](/react/use-effect)），跳过中间层共享依赖用 Context。但它们也各自留下了同一个未回答的问题——**为什么这个组件又渲染了一次？** 在 Vue 里这个问题通常不成其为问题，因为依赖追踪替你把更新范围算好了；在 React 里，更新范围由「谁重跑了函数」决定，而引用稳定性由你负责。下一章[重渲染机制与性能](/react/re-render-performance)正面回答这件事：三种触发源（自身 state、父组件重渲染、Context 变化）分别对应什么解法，`memo` / `useMemo` / `useCallback` 各自在解决哪一个问题、代价是什么，以及 React Compiler 时代这套手动记忆化的必要性还剩多少。
