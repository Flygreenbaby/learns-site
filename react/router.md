# 路由对照：Outlet 忘了写、守卫不存在、数据在 effect 里才来

第一个故障来自迁移。你把 Vue Router 的路由表搬进 React，嵌套结构照抄：`/dashboard` 下面挂 `stats` 和 `settings` 两个子路由。URL 变了、组件函数执行了、`console.log` 也打了，**页面上什么都没有**。原因只有一行：Vue 的布局组件里你写了 `<router-view />`，React 的布局组件里你没写 `<Outlet />`——React Router 不会替你把子路由塞进去，父组件不渲染出口就等于子路由没有落地位置。

第二个故障是刷新闪烁。你想做「未登录不许进 `/admin`」，在 Vue 里是一个 `beforeEach` 全局守卫的事；React Router 没有这个钩子，你写了个 `<RequireAuth>` 包住路由 element，本地跑得挺好，上线后发现：已登录用户直接访问 `/admin` 时先白屏一下、偶尔闪现一帧未授权页；更糟的是鉴权请求在组件挂载后才发出，数据到达前 `<Outlet />` 已经渲染了子路由的 loader。**导航没有「取消」这个概念了——它已经发生了。**

第三个故障是详情页慢。Vue 版本里你在 `onMounted` 发请求，React 版本照搬 `useEffect`，看起来一样。但 React Router 的数据路由能在**路由匹配的那一刻**发起 loader 请求，与代码分块的下载并行；你在 effect 里请求，必须等「chunk 下完 → 组件渲染 → effect 执行」这条链走完才开始，多出一个完整的往返。同一个页面，数据到达时间差一个网络往返，还多出「effect 依赖数组写错导致重复请求」和 StrictMode 双调用这两个坑（见 [useEffect 与 watch 的对照](/react/use-effect)）。

第四个故障是类型。`useParams()` 拿到的 `id` 在 TypeScript 里是 `string | undefined`，你把它直接传进期望 `number` 的函数，编译不过；改成 `Number(params.id)` 之后 `NaN` 一路传到接口里，返回 500。Vue Router 的 `route.params` 同样是字符串（除非你配置参数转换），但很多人因为 `props: true` 加组件上声明了 `props: { id: Number }` 而自动转换，迁移到 React 时这层自动转换没了。

这一章按四个问题展开：**路由怎么声明、子路由从哪里渲染、数据什么时候加载、拦截导航怎么做。** 前置：[Vue Router](/vue/router)、[两套渲染模型](/react/two-rendering-models)、[props、回调与 children](/react/props-and-children)。

<Callout type="unverified" title="React Router 的版本形态请以官方文档当前版本为准">

React Router 是本文档体系里版本风险最高的依赖之一：它在 6.x 引入 data router（`createBrowserRouter` / `RouterProvider`），v7 又把产品定位拆成了**声明式（declarative）/ 数据（data）/ 框架（framework）**三种模式，同一份 API 在不同模式下的可用性不一样。本章不写具体版本号，也不逐条核实每个 API 的签名与新增项（核实尝试未成功）。**动手前请以 [React Router 官方文档](https://reactrouter.com/home) 当前内容为准，并先确认你项目装的是哪种模式。** 本章的重点是「对照与迁移判断」，这部分不受小版本变动影响。

</Callout>

## 两种声明方式，对应 Vue 的一种

React Router 允许你用两种方式写路由，而 Vue Router 只有一种（数组表）。这个差别不是风格问题，它决定了**哪些事情能在路由层做、哪些必须落到组件层**。

| 维度 | Vue Router | React Router：对象数组 | React Router：JSX 声明 |
| --- | --- | --- | --- |
| 写在哪 | 一个独立的 `routes` 数组 | 一个独立的 `routes` 数组 | 组件的 JSX 里（通常在 `App`） |
| 子组件挂法 | `component: () => import(...)`，工厂函数 | `element: <Foo />`，**元素**（不是组件引用） | `<Route path="/foo" element={<Foo />} />` |
| 出口 | 布局模板里 `<router-view />` | 布局组件里 `<Outlet />` | 同左 |
| 能否条件生成 | 能在 JS 里 `if` 拼数组 | 同左 | 能：JSX 里 `&&`、`.map` 都行 |
| 数据加载 API | 无内置（守卫里手写） | loader / action（数据模式） | loader / action 需要数据模式；纯声明式 `<Routes>` 里用不了 |
| 嵌套与 index 路由 | `children` + `redirect` | `children` + `index: true` | 嵌套 `<Route>` + `<index>` |
| 通配 404 | `/:pathMatch(.*)*` | `path: '*'` | `<Route path="*" element={<NotFound />} />` |
| 元信息 | `meta` + 全局守卫读取 | `handle` + 匹配链读取 | 同左 |

对象形式（数据模式，本站推荐用于新项目）：

```tsx
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <Home /> },
      {
        path: 'dashboard',
        element: <DashboardLayout />,
        children: [
          { index: true, element: <Navigate to="stats" replace /> },
          { path: 'stats', element: <Stats />, loader: loadStats },
          { path: 'settings', element: <Settings /> },
        ],
      },
      { path: 'task/:id', element: <TaskDetail />, loader: loadTask },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
```

等价的 Vue Router 写法（对照用）：

```ts
const routes = [
  {
    path: '/',
    component: RootLayout,
    children: [
      { path: '', component: Home },
      {
        path: 'dashboard',
        component: DashboardLayout,
        children: [
          { path: '', redirect: '/dashboard/stats' },
          { path: 'stats', component: Stats, beforeEnter: loadStatsGuard },
        ],
      },
      { path: 'task/:id', component: () => import('./TaskDetail.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', component: NotFound },
];
```

三处最容易抄错的地方，逐条说明：

1. **`element` 是元素，不是组件。** Vue 里 `component: Stats` 交的是组件；React Router 里 `element: <Stats />` 交的是已经创建好的 JSX 元素。写成 `component={Stats}` 或 `element: Stats` 都不对。因为交的是元素，父级路由重渲染时这个元素会被**重新创建**（它在路由配置里，而配置通常在模块顶层，所以一般稳定——但如果你在组件里内联 JSX 定义路由，就会每轮新元素，见[重渲染机制与性能](/react/re-render-performance)的 children 那一节）。
2. **index 路由 vs Vue 的空 path 子路由。** Vue 用 `path: ''` 表示「父路径命中时渲染我」，React Router 用 `index: true`。它还有个额外语义：index 路由不参与 URL 前缀匹配，父级 active 状态的计算更干净。
3. **`Navigate` 组件对应 Vue 的 `redirect`。** Vue 的重定向发生在路由表（导航前），React 的 `<Navigate>` 是一个渲染出来才生效的组件（导航后）——这是本章「守卫缺失」一节的缩影。

JSX 声明形式在什么情况下才值得用：路由结构需要**由运行时数据决定**（按用户权限动态生成一组子路由），或者你的应用只有三五个路由、不想引入数据模式。它的代价是丢掉 loader/action 这套数据能力，同时路由结构散进了组件树里，很难一眼看全。「在 Vue 里我用惯了路由表」的人，迁移时应该先选对象数组形式，别把 JSX 形式当「更 React 的写法」上来就用。

## 嵌套出口：Outlet 与 router-view 的三点不同

```tsx
function DashboardLayout() {
  const { id } = useParams();
  return (
    <div className="dashboard">
      <nav>
        <NavLink to="/dashboard/stats">统计</NavLink>
        <NavLink to="/dashboard/settings">设置</NavLink>
      </nav>
      <main>
        <Outlet />        {/* 没有这一行，子路由永远不显示 */}
      </main>
    </div>
  );
}
```

| 方面 | `<Outlet />` | `<router-view />` | 后果 |
| --- | --- | --- | --- |
| 是否需要显式书写 | 必须显式渲染 | 也需要（`<RouterView>`），但很多人以为它是自动的 | 两边都属于「忘了就白屏」，React 的报错更安静（什么都不渲染，无警告） |
| 子内容来源 | 当前匹配链的下一层路由的 `element` | 当前 `route` 的匹配记录组件 | React 出口只有一层「下一跳」；Vue 支持具名视图（`<RouterView name="sidebar">`）对应多个平行出口，React Router 没有等价的具名出口机制 |
| 是否携带 props | 不给。子路由数据通过 `useLoaderData` / `useParams` / `useSearchParams` 自取 | Vue 常用 `props: true` 把 params/query 自动注入为组件 props | React 里「路由参数当 props」这条要自己实现：`<Route path="/x" loader={...} element={<X />}>` + 组件内 hook |
| 传递上下文 | `context` prop（把额外值传给 outlet 渲染的组件） | 不用，直接读响应式路由 | React 需要在布局与子页之间共享值时可用它，但更常见的做法是 loader |
| 渲染时机 | `Outlet` 是布局组件的一部分：**布局组件重渲染，出口里的子组件也重新执行**（除非子组件 `memo` 且 props 稳定） | Vue 里子视图由路由驱动，父布局重渲染不会牵连子视图 | 这是第 7 章那条「向下传播渲染」在路由层的具体体现 |

具名视图那条值得多说一句，因为它常被问「Vue 的多 `<RouterView>` 怎么迁」。Vue 里可以：

```vue
<RouterView />
<RouterView name="aside" />
```

React Router 里没有对应概念。替代做法二选一：把侧栏也变成一个平级布局（父路由下并排两个出口不可行，所以通常用**两条独立路由 + 共享数据**），或者把侧栏内容做成布局组件里的普通 state/props（`<Outlet />` 只管主区域）。**别指望路由结构能同时驱动两个出口**，这是生态设计差异，不是你的写法问题。

## 数据加载：loader 把请求提前了一个往返

这是本章最有实用价值的对照，也是 Vue → React 迁移里唯一一处「React 明显做得更好」的地方（前提是 Vue 项目没用 Nuxt 之类的元框架）。

```tsx
// 数据模式：loader 与路由绑定，在导航过程中就执行
async function loadTask({ params, request }: { params: Record<string, string | undefined>; request: Request }) {
  const started = performance.now();
  const id = params.id;
  const res = await fetch(`/api/tasks/${encodeURIComponent(String(id))}`, { signal: request.signal });
  if (res.status === 404) throw new Response('Not Found', { status: 404 });
  if (!res.ok) throw new Error('加载失败');
  console.log('loader 耗时', performance.now() - started);
  return res.json();          // 返回值给组件用 useLoaderData 读
}

function TaskDetail() {
  const task = useLoaderData() as Task;      // 数据已经在手，首次渲染就有内容
  return <article><h1>{task.title}</h1></article>;
}
```

对照在 effect 里请求（Vue 里 `onMounted` + `await` 的同型写法）：

```tsx
function TaskDetail() {
  const { id } = useParams();
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setTask(null);
    fetch(`/api/tasks/${id}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setTask)
      .catch((e) => { if (e.name !== 'AbortError') setError(e); });
    return () => controller.abort();
  }, [id]);

  if (error) return <p>加载失败</p>;
  if (!task) return <p>加载中…</p>;
  return <article><h1>{task.title}</h1></article>;
}
```

两种形态的时间线对照（`/task/42`，chunk 下载约 80 ms、接口约 200 ms，数字仅为示意）：

| 阶段 | loader（数据模式） | effect 里请求 |
| --- | --- | --- |
| 0 ms | 用户点击 → 路由匹配 → **loader 发起请求**，同时懒加载 chunk 开始下载 | 用户点击 → 导航提交 |
| ~80 ms | chunk 就绪，组件渲染，等待中的 loader 尚未返回 | chunk 就绪 → 组件渲染「加载中…」 → **effect 才发请求** |
| ~280 ms | 数据到达，渲染内容 | 数据到达，渲染内容 |
| 总计 | 约 280 ms（请求与下载重叠） | 约 360 ms（请求串在下载之后） |

预期结果是**串行变并行，省掉一个往返**。这条收益在懒加载路由上才明显——如果组件是打包进主 bundle 的，两种写法差别只剩代码组织。

三个必须一起知道的代价：

1. **loader 里不能调用 Hook，也不在组件生命周期内。** 它是普通异步函数，读不到组件 state；`request` 提供当前 URL，`params` 提供路径参数，其他都得从 URL 或外部 store 拿。
2. **`useLoaderData` 的返回值默认是 `unknown` 类型**（配合路由模块的类型生成才是精确类型，见下一节）。上面那个 `as Task` 是偷懒写法，会在数据形状变化时静默骗过编译器。
3. **effect 版本才有的「组件卸载即取消」在 loader 里要靠 `request.signal` 传下去**，否则用户在 loader 完成前离开这一页，请求照样跑完。React Router 在导航被取消/替换时会中止对应 loader 的 `AbortController`（这属于数据模式能力，纯声明式没有）。

Vue 侧的正确对照位置：`vue-router` 没有 loader。要么在组件里 `onMounted` 请求（等价于 effect 版本），要么在 `beforeEnter` / 全局守卫里请求并把结果塞进 pinia store（**这才是等价物**，而且它比 loader 更粗糙：守卫里拿不到组件的取消语义，还得自己处理「守卫挂起期间 URL 未变」的加载态）。若你的 Vue 项目用的是 Nuxt，它的 `useAsyncData` / 路由级 `loader` 才是同一层的东西。

## 路由参数：都是 string，但 Vue 帮你转了一道

| 需求 | Vue Router | React Router | 需要注意 |
| --- | --- | --- | --- |
| 读路径参数 | `const route = useRoute(); route.params.id` | `useParams().id` | 两边都是 `string`（或 `string[]`，重复参数时） |
| 自动转成 props | `props: true` + 组件里 `defineProps({ id: Number })` 自动 `Number()` | 无 | React 里必须手写 `Number(...)` 并处理 `NaN` |
| 类型化 | 需要开启严格路由类型（`RouteRecordRaw` 泛型 + `RouteParamsBased`），配置成本较高 | 官方提供「类型安全的 route id / 路由模块类型生成」（框架模式下的 `typedRoutes` 一类能力） | **两边的开箱默认都是 `string`**；不要假设装好库就有精确类型 |
| 可选参数 | `/users/:id?` | `/users/:id?` | 语法相同，都变成 `string \| undefined` |
| 重复参数 | `/tags/:tag+` | 用 splat `*` 后自己 `split('/')` | React Router 没有 `+`/`?` 之外的多次匹配语法，splat 要手动切分 |
| 通配 | `/:pathMatch(.*)*`，`route.params.pathMatch` 是字符串 | `path="*"`，`useParams()['*']` | React 里键名就是 `'*'`，取值要方括号 |
| 查询串 | `route.query.q`（已解析成对象，值是 `string \| string[] \| null`） | `useSearchParams()` → `[URLSearchParams, setter]` | **React 返回的是 `URLSearchParams`，`get()` 结果可能为 `null`，需要收窄**；Vue 那边返回 `LocationQueryValue`（`string \| null`） |
| 路由 state | `history.state`，`router.push({ state })` | `useLocation().state`，`navigate(path, { state })` | 刷新后两边都在 `history.state` 里，但 React 的 `state` 泛型要靠你提供类型参数 |

诚实的结论：**路由参数类型化在这两个生态里都不是默认能力。** 你能立刻做对的是这三件事——

```tsx
function TaskDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return <NotFound />;                 // 非法 ID：这就是 404，不是 NaN 打到接口
  }
  // ...
}
```

第一，`useParams<{ id: string }>()` 手动给出泛型，至少 `id` 不是 `string | undefined`；第二，数值参数显式校验（`Number('abc')` 是 `NaN`，`Number('')` 是 `0`，`Number(' 12 ')` 是 `12`——这三个都在真实 URL 里出现过）；第三，loader 里就校验并 `throw new Response(..., { status: 404 })`，让错误边界接住，而不是把无效 ID 传进数据层。若你用的是框架模式，把 URL 校验交给 schema 解析（loader 里验证 + 抛 400/404）比在组件里防御更省事。

## 没有全局守卫：拦导航的四种替代做法

Vue Router 有三类守卫（全局、路由独享 `beforeEnter`、组件内 `onBeforeRouteLeave`），共同点是**它们能在导航完成之前把这次导航取消或改写**。React Router 没有这个钩子集合。它提供的是「导航前发生的事」的另一种拆法：

| 你想做的 | Vue 的做法 | React 的做法 | 语义差别（这是关键） |
| --- | --- | --- | --- |
| 未登录不进 `/admin` | 全局守卫读 `meta.requiresAuth` | ① loader 里判断并 `throw redirect('/login')`；② 布局路由里包 `<RequireAuth><Outlet /></RequireAuth>` | ① 数据模式独有：loader 是导航过程的一部分，重定向在内容落地前完成；② 是渲染期的，会先提交一次导航 |
| 权限不足回首页 | 守卫 `next('/403')` | loader/action 返回 `redirect('/403')`，或组件里 `<Navigate replace />` | `<Navigate>` 渲染后才跳，中间那一帧无法避免；`redirect` 在 loader 阶段生效 |
| 离开页面前确认「有未保存内容」 | `onBeforeRouteLeave` | 数据模式的 blocker API（导航被阻塞后再决定 proceed/reset）；退而求其次用 `beforeunload` 只管刷新关页 | **声明式路由没有 blocker**，这是 Vue 用户最容易发现「少东西」的一处 |
| 记录页面标题/埋点 | 全局 `afterEach` 读 `meta.title` | 读当前匹配链（`matches` / `useMatches`）拿每条路由的 `handle`，在 effect 里设 `document.title`；或交给标题库 | 没有钩子，只有「读匹配链 + 自己写 effect」 |
| 未登录时保存原始目标 URL | 守卫里 `next('/login?redirect=' + to.fullPath)` | `redirect` 时手动带 `?redirect=`，登录成功后 `navigate(redirect ?? '/')` | 逻辑一样，只是必须自己写，框架不给你 `to` |
| 路由变化时拉数据 | 守卫 / 组件内 `watch` route | loader，或 `useParams` 进 effect 依赖 | loader 更早、可取消；effect 更自由但会重复请求 |

守卫用组件表达是最常见的写法，也是最容易写错的：

```tsx
// 布局路由的做法：未登录时整个子树不渲染
function RequireAuth() {
  const user = useUser();               // Context 或 store，见第 6、9 章

  if (user.status === 'loading') return <PageSkeleton />;
  if (user.status === 'anonymous') {
    const location = useLocation();
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return <Outlet />;
}

// 路由表
{
  path: '/admin',
  element: <RequireAuth />,             // 这一层是布局路由
  children: [
    { index: true, element: <AdminHome /> },
    { path: 'users', element: <AdminUsers /> },
  ],
}
```

这个写法必须承认的三个局限，以及对应的处理：

1. **它不是「拦截」，是「渲染后跳转」。** URL 已经变成 `/admin` 了，再被替换成 `/login`。用户后退时的表现会不符合直觉，所以要 `replace`（不给历史里留一条 `/admin`）。
2. **鉴权状态必须在渲染期可得。** 如果 `useUser()` 在首次渲染是 loading，你就会有白屏帧——这就是第二节那个故障。数据模式的解法是在 `/admin` 这条路由上挂一个 `authLoader`：它在导航期间等鉴权结果，返回后再渲染布局；组件里的 loading 分支只是兜底。
3. **它挡不住「同布局下的兄弟路由」。** `RequireAuth` 只包住它 children 里的路由，别处访问 `/api` 数据仍然靠服务端鉴权。**客户端守卫从来不是安全边界，只是体验**。真正的边界是接口侧校验，这条在 Vue 里同样成立，只是 Vue 的全局守卫容易给人「我已经挡住了」的错觉。

## 路由级代码分割：两边都是动态 import，坑不同

```tsx
// React：lazy 必须配 Suspense 边界，且默认不支持在 lazy 组件的 effect 里等数据
const TaskDetail = lazy(() => import('./TaskDetail'));

<Suspense fallback={<Skeleton />}>
  <Routes>
    <Route path="/task/:id" element={<TaskDetail />} />
  </Routes>
</Suspense>
```

```ts
// Vue：路由表里直接写工厂函数，vue-router 自己处理加载态与失败重试
{ path: '/task/:id', component: () => import('./TaskDetail.vue') }
```

| 方面 | Vue Router | React Router + React.lazy |
| --- | --- | --- |
| 谁负责加载态 | 路由内部：组件解析完才导航提交 | 由你的 `<Suspense>` 边界决定，边界放的位置直接决定「切换页面时哪些部分被替换掉」 |
| 加载失败 | 工厂失败时导航可以带回错误；常见做法是自己 catch | `lazy` 的 Promise 失败会向上抛给错误边界（ErrorBoundary），**不会自动变成 404** |
| 与数据加载的关系 | 组件里再请求（除非用元框架） | 数据模式里 loader 与 chunk 下载并行；`lazy` + loader 时 loader 可以先跑，但**只有数据模式保证这点** |
| 缓存 | 组件解析结果被路由缓存 | `lazy` 内部缓存一次解析，重复导航不重复下载 |

值得单独记的一条：**`<Suspense>` 边界放在整页外面，页面切换时会把已渲染的布局也一起替换掉（骨架覆盖全屏）**；把边界下沉到只包 `<Outlet />`，布局保持、只有主区域显骨架，体验更接近 Vue 的行为。这是纯 React 结构问题，第 7 章的「边界放哪一层」判断在这里同样适用。

## 常见错误与排查

1. **URL 变了，页面空白，子组件函数确实执行了。** 现象：嵌套路由的父级渲染出来，子级内容不显示，DevTools 里能看到子组件被 mount 过一次但看不到东西。原因：父级组件没渲染 `<Outlet />`（Vue 里的 `<router-view />` 没了对应物）。怎么确认：在父组件里搜 `Outlet`；再确认父级路由真的被匹配（`useMatches()` / React DevTools 的组件树里是否出现子组件）。怎么修：在父组件合适位置加 `<Outlet />`；如果确实不想让子路由渲染，就应该把父级改成叶子路由而不是布局路由。
2. **刷新或直接访问时白屏一下，然后跳到登录页。** 现象：已登录用户也有那一帧白屏。原因：用 `<RequireAuth>` 组件做鉴权，而 `useUser()` 首帧是 loading；或者 Provider 在路由外面导致读取顺序问题。怎么确认：在 `RequireAuth` 里打印 `user.status`，看首帧是不是 `loading`。怎么修：给这条路由挂 loader，在导航阶段把鉴权结果拿到；或者至少让 loading 分支渲染骨架而不是 `null`。
3. **`navigate('/login?redirect=' + location.pathname)` 之后登录后回不去原页面。** 现象：登录后固定回首页。原因：`redirect` 参数没编码（路径里带查询串时会被截断），或者用了 `navigate(path)` 时把 `?redirect=` 丢了；也可能原 URL 是 hash/query 混合。怎么确认：登录后打印 `useSearchParams().get('redirect')` 的实际值。怎么修：`encodeURIComponent` 编码整段 `pathname + search`，登录后 `navigate(redirect ?? '/', { replace: true })`，并对 `redirect` 做同域校验（别拿它跳外部站，这是开放重定向）。
4. **`params.id` 直接拼进 fetch，出现 404 / 500 或路径注入。** 现象：`/task/../admin` 之类的 URL 让请求打到奇怪的路径。原因：`params.id` 是原始字符串，未经校验和编码。怎么确认：打印真实请求 URL。怎么修：`Number` + `Number.isInteger` 校验（不合法直接渲染 404 或在 loader 里 `throw new Response('Not Found', { status: 404 })`），拼 URL 用 `encodeURIComponent`，别用模板串裸拼。
5. **每次切换页面都重复请求同一个接口，控制台还出现「AbortError」。** 现象：进入列表页 → 进详情 → 回列表，每次列表都重新加载；StrictMode 下开发环境还多打一次。原因：数据请求写在 effect 里，依赖数组含对象/函数导致每轮重跑；或者没有把「服务端数据」和「客户端 state」分开。怎么确认：在 effect 首行打印依赖值，看是不是每次都新引用。怎么修：改用 loader，或把服务端数据交给缓存层（见[状态管理选型](/react/state-management)）；effect 版本必须用 `AbortController` 成对清理，并把请求参数收敛成原始值。
6. **导航后滚动位置不对：新页面停在上一页的滚动位置。** 现象：从长列表点进详情，详情顶部不出现而是停在中间。原因：React Router 不会自动滚到顶部（Vue Router 有 `scrollBehavior`）。怎么确认：看是否存在滚动恢复组件；比较两个框架的默认值。怎么修：数据模式用 `RouterProvider` 的 `scrollRestoration`（`true` 恢复、`'manual'` 自管）；纯声明式则自己写一个只渲染 `<Outlet />` 的滚动组件，用 `useLocation()` + `useMatches()` 判断「顶层路径是否变化」再决定滚顶还是恢复——**别用 `useEffect(() => scrollTo(0,0), [pathname])` 这种粗糙写法**，它会在查询串变化时也滚。
7. **`useSearchParams` setter 把已有查询串整个覆盖掉。** 现象：切了筛选页码之后 `?q=` 没了。原因：`setSearchParams({ page: 2 })` 是直接替换语义。怎么确认：对比调用前后完整 URL。怎么修：函数式更新 `setSearchParams((prev) => { prev.set('page', '2'); return prev; })`（传进去的是可变的 `URLSearchParams`，改它再返回），或者手动 `new URLSearchParams(location.search)` 起步。
8. **`<Navigate>` 写在条件里造成循环跳转。** 现象：控制台报最大调用栈/导航循环，页面在 `/admin` 和 `/login` 之间来回。原因：登录页在未登录 state 下又渲染了 `<Navigate to="/admin">`，或者 `RequireAuth` 判断条件写反（`status !== 'authenticated'` 之外还有一路都跳）。怎么确认：在两个跳转点各打一行日志，看是谁先跳。怎么修：每个位置只允许一个方向的跳转（登录页只在 `status === 'authenticated'` 时跳走），并用 `replace` 避免堆历史。

## 练习

<Exercise title="练习 1 · 把这段 Vue 路由表翻译成 React 数据模式" difficulty="基础">

```ts
const routes = [
  {
    path: '/users',
    component: UsersLayout,
    children: [
      { path: '', component: UserList },
      { path: ':id', component: UserDetail, props: true },
    ],
  },
  { path: '/:pathMatch(.*)*', component: NotFound },
];
```

写出等价的 React Router 对象路由，并把「params 当 props」这条补齐。

<template #answer>

```tsx
const router = createBrowserRouter([
  {
    path: '/users',
    element: <UsersLayout />,
    children: [
      { index: true, element: <UserList /> },
      { path: ':id', element: <UserDetail /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

function UserDetail() {
  // props: true 的等价物：自己读参数并显式收窄
  const { id } = useParams<{ id: string }>();
  if (!id) return <NotFound />;
  return <UserPanel userId={id} />;
}
```

要点三处：① `path: ''` → `{ index: true }`；② `/:pathMatch(.*)*` → `path: '*'`；③ **`props: true` 没有对应机制**，必须在组件里 `useParams()`。如果你希望保持「组件接收 props、不直接依赖路由」的可测试性，就在路由层做一层薄壳组件（`RouteUserDetail` 读参数再渲染纯展示组件），这样展示组件可以脱离路由单测——Vue 里 `props: true` 帮你做的是同一件事的简化版。

</template>

</Exercise>

<Exercise title="练习 2 · 守卫迁移的取舍" difficulty="进阶">

需求：`/report` 需要 `role === 'admin'`；不满足时跳 `/login` 并带上原地址；离开 `/edit` 前如果表单脏要确认。请分别说明这三条在 React Router 里该用哪种机制（loader / 组件 / blocker），并解释为什么不能全部塞进一个全局函数。

<template #answer>

1. **角色校验 → loader（数据模式优先）**。在 `/report` 上挂 `reportLoader`，读鉴权结果（从 store/cookie 拿），不满足就 `throw redirect('/login?redirect=' + encodeURIComponent(new URL(request.url).pathname + new URL(request.url).search))`；满足就返回页面数据。它发生在导航过程中，用户不会看到 `/report` 的内容闪一下。次选是布局路由包 `RequireRole`，代价是多一帧和无法取消导航。
2. **脏表单确认 → blocker**。这是唯一「必须在导航发生前拿决定」的需求，必须在导航链路上拦。数据模式提供 blocker 能力：阻塞后弹确认框，用户确认再 proceed，否则 reset。没有数据模式时你只能退化到：a) `beforeunload`（管不住站内导航）；b) 把「是否有未保存修改」提升到上层，用 `<Navigate>` 之外的方案（比如禁用离开入口）。**这一条在纯声明式路由里基本无法完整实现，是选数据模式的硬理由。**
3. **为什么不能全塞进一个全局函数**：React Router 的更新入口是「组件渲染 + loader/action 返回值」，不是一条可插队的导航管线。写一个 `checkAuth()` 在 `App` 里跑，它跑的时候提交已经发生或根本没机会阻止渲染；而且它拿不到「这次导航的目标 loader 上下文」，也拿不到「用户点了后退还是点了链接」这类信息。Vue 里全局守卫能一把梭，是因为 vue-router 确实实现了「解析 → 守卫 → 提交」这条管线，React 没这条管线。**架构不同，只能拆开写。** 另外提醒：客户端拦截都不是安全机制，接口侧必须自己校验角色。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释现象" difficulty="挑战">

同事迁移后的代码。症状三条：直接访问 `/task/7` 时页面空白（`console.log` 有打印）；`?page=2` 之后切换筛选，页码丢失；从列表进详情后返回，列表页停在页面底部且数据重新加载一次。指出问题所在并给修法。

```tsx
function App() {
  return (
    <Routes>
      <Route path="/" element={<RootLayout />}>
        <Route path="task/:id" element={<TaskDetail />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function RootLayout() {
  return <div className="shell"><Header /><Footer /></div>;
}

function TaskList({ keyword }: { keyword: string }) {
  const [sp, setSp] = useSearchParams();
  const filter = keyword;
  return (
    <>
      <input value={filter} onChange={(e) => setSp({ keyword: e.target.value })} />
      <Pager page={Number(sp.get('page'))} />
    </>
  );
}
```

<template #answer>

1. **`RootLayout` 里没有 `<Outlet />`。** 三个症状的第一个：`/task/7` 匹配到了子路由，`TaskDetail` 组件函数确实执行（所以有 `console.log`），但它的 JSX 从来没被渲染进页面，因为父布局只渲染了 Header/Footer。修法：`<div className="shell"><Header /><Outlet /><Footer /></div>`。
2. **`setSp({ keyword: ... })` 是整体替换。** `?page=2` 被丢掉就是这个原因。修法：`setSp((prev) => { prev.set('keyword', value); return prev; }, { replace: true })`——键入用 `replace` 避免每敲一个字加一条历史。顺带：把 URL 当输入框 state 的来源还同时带来「每次键入一次导航」，通常应该本地 state 编辑 + 防抖后同步 URL，或让 URL 只承载「可分享」的筛选（详见[第 10 章受控组件](/react/refs-and-forms)）。
3. **`Number(sp.get('page'))`：`sp.get` 返回 `string | null`，`Number(null)` 是 `0`。** 没有 `page` 参数时 `Pager` 收到第 0 页（预期是第 1 页），而且 `Number('abc')` 是 `NaN`。修法：`const page = Number(sp.get('page') ?? '1'); if (!Number.isInteger(page) || page < 1) { /* 归位到 1 或渲染 404 */ }`。
4. **返回列表时数据重新加载 + 停在底部**：两件事。滚动是因为声明式路由没有滚动恢复（Vue 靠 `scrollBehavior` 配置），需要自己写恢复；数据重新加载是因为列表数据请求在列表组件的 effect 里，组件卸载再挂载就重发。修法是分层：滚动交给滚动恢复组件（或数据模式的 `scrollRestoration`），数据交给带缓存的服务端状态层或 loader——**「保位置」和「不重复请求」不是同一个问题，别指望 `keep-alive` 一个方案同时解决**。Vue 项目如果用过 `<KeepAlive>` 会特别想找它的等价物，React Router 没有 `<KeepAlive>`，缓存语义在数据层做，不在组件层做。
5. **`filter` 是从 prop 复制来的、且没有回写 URL 的初始化路径**：`keyword` 从外部进来只当初始值的话，URL 与 state 会不一致。这类「一份数据两个来源」正是第 3 章说的 state 结构问题。

</template>

</Exercise>

<Exercise title="练习 4 · loader 还是 effect" difficulty="进阶">

四个场景：① 详情页首屏必需数据；② 页面上「点击后才展开」的评论区；③ 提交表单后刷新列表；④ 依赖当前 URL 查询串的搜索结果。各自选 loader / action / effect / 数据缓存层，并说理由。

<template #answer>

① **loader**。首屏必需，越早越好；loader 与 chunk 下载并行，还能在参数非法时直接 `throw new Response(..., { status: 404 })`，把 404 变成路由层职责。
② **effect 或事件回调**。它不是首屏依赖，放 loader 会让页面「必须等评论」才能显示；正确做法是展开时请求（点事件里发），或者用带缓存的数据层在需要时取。这一条正好对应「你可能不需要 effect」里「事件驱动 vs 同步驱动」的判据。
③ **action（数据模式）+ 数据失效**。提交属于「改服务端数据然后让视图更新」，action 天然表达这件事（处理完可以 `redirect` 到新地址，或返回结果由组件消费）。Vue 里对应做法是组件里 `await api.submit()` 再手动刷 store——注意 action 的额外好处是它和 loader 共用同一套并发/中止/提交语义。
④ **loader（或数据缓存层）**。搜索结果的权威来源是 URL，loader 读 `request.url` 就能拿到，刷新/前进后退都可复现；如果搜索频率高、要防抖和保留上一次结果，则交给数据缓存层 + 把关键词当 state，URL 只承载可分享部分。

判断标准一句话：**「首屏必需且能由 URL 完全决定」→ loader/action；「由用户动作触发」→ 事件回调；「跨页面复用且要缓存/失效」→ 数据层，别写进 effect 手动同步。**

</template>

</Exercise>

<Exercise title="练习 5 · 对照两边的默认行为差异" difficulty="基础">

列表：Vue Router 提供什么、React Router 提供什么、迁移时要补什么。至少给出四行。

<template #answer>

| 能力 | Vue Router | React Router | 迁移要补的 |
| --- | --- | --- | --- |
| 子视图出口 | `<RouterView>` | `<Outlet />` | 每个布局路由显式写出口 |
| 具名视图 / 多出口 | 支持 | 不支持 | 拆成两条路由或把侧栏降级为普通 props |
| 参数注入为 props | `props: true`（含类型转换） | 无 | 组件里 `useParams` + 手动校验转换 |
| 全局/独享守卫 | 完整一套 | 无 | loader 里 `redirect` + 布局组件 + blocker |
| 滚动行为 | `scrollBehavior` 配置 | 数据模式有滚动恢复，声明式无 | 自己写恢复组件，或用数据模式开关 |
| 数据加载 | 无内置（元框架才有） | loader / action | 这一项是 React 侧更强，迁移时可以**去掉** store 里手写的加载中状态 |
| 查询参数 | `route.query` 是普通对象 | `URLSearchParams`（值可为 `null`） | 收窄与默认值处理 |
| 懒加载 | 路由表里动态 import | `React.lazy` + `Suspense` | 决定 Suspense 边界放哪一层 |
| 路由模式 | `createWebHistory` / `createWebHashHistory` | 由 `createBrowserRouter` / `createHashRouter` 决定 | 部署侧的静态资源前缀与服务器回退规则要一起改（对照[部署到 VPS](/devops/deploy-to-vps)） |

值得背下来的两句：**Vue 的路由是「导航管线」，React 的路由是「渲染树 + 数据回调」**。所以 Vue 里习惯在导航层解决的事情（拦截、加载态、参数转换、滚动），在 React 里要分别落到 loader、Suspense/骨架、组件、滚动恢复组件四个位置。

</template>

</Exercise>

## 官方文档与延伸阅读

- [React Router 官方文档主入口](https://reactrouter.com/home) —— 核实：本项目安装的 React Router 处于哪种模式（声明式 / 数据 / 框架）、`createBrowserRouter` 与 `RouterProvider` 的当前签名、`<Outlet />` 与 `useLoaderData` 的用法、blocker 能力的可用条件、`scrollRestoration` 的取值。**本章的版本相关内容标为 unverified，正是因为未逐字核实这一组 API；动手前请以此页为唯一依据。**
- [React Router 库模式安装与路由文档](https://reactrouter.com/home) —— 用于核实「对象路由 vs JSX 声明路由」两种写法的适用边界（同一站点内，主入口可导航到 library / framework 两种起点）。
- [Vue Router 官方文档（中文）](https://router.vuejs.org/zh/) —— 核实 Vue 侧的四项对照依据：`RouterView` 与具名视图、`props` 配置（含参数类型转换）、`beforeEach` / `beforeEnter` / 组件内守卫三类钩子的执行时机、`scrollBehavior` 的默认与自定义。
- [React 官方文档 · lazy](https://react.dev/reference/react/lazy) 与 [Suspense](https://react.dev/reference/react/Suspense) —— 核实「lazy 的 Promise 失败向上传给错误边界」「Suspense 边界位置决定被替换的范围」，用于本章代码分割一节的三条对照结论。
- [你可能不需要 Effect](https://react.dev/learn/you-might-not-need-an-effect) —— 核实「由用户动作触发的逻辑应写在事件回调里」，用于练习 4 的第 ② 项判断。
- 站内相关：[Vue Router](/vue/router)、[两套渲染模型](/react/two-rendering-models)、[useEffect 与 watch 的对照](/react/use-effect)、[重渲染机制与性能](/react/re-render-performance)、[useRef 与受控组件](/react/refs-and-forms)、[状态管理选型](/react/state-management)、[Vite 构建侧：代码分割](/frontend-engineering/vite-build)。

## 下一章

路由解决的是「URL 决定渲染哪棵树」，但一棵树里的数据归属问题它管不了：`/admin` 需要角色，`/dashboard` 需要筛选条件，列表页和详情页需要同一份待办数据。**这一层在 Vue 生态里几乎没有决策可做——上 Pinia 就完了**，因为 Pinia 的 store 是响应式的，你读哪个属性就只有依赖那个属性的组件更新。React 生态在这里给了你一整套选择题：Context、Redux Toolkit、Zustand、Jotai、TanStack Query，每个都有人推荐，而且它们**不是同一层的东西**（Context 是依赖注入，store 是订阅源，Query 是服务端缓存）。下一章[状态管理选型](/react/state-management)把这条线拉直：先从「读一个值会不会让组件重渲染」这个唯一硬指标出发，把 Pinia 与 Redux/Zustand 的机制差别讲清，再给出本站的选型判断和「Context 为什么不能当状态管理库」的完整理由。
