# 阶段项目：把那个待办应用用 React 重写一遍，并交出对照复盘

这是[React 领域首页](/react/)「阶段项目」一节规定的那个项目，条款原文以该节为准。它的目标**不是**再做一个能用的待办——你在[纯 JavaScript](/javascript/project)、[TypeScript](/typescript/project)、[Vue](/vue/project) 三个阶段项目里已经做过三遍。第四遍的价值只有一个：**把前 11 章建立的每一条对照判断，放到同一个真实需求上打一次分。**

具体来说，这个项目会暴露三件只有「重写」才能暴露的事：

1. **你的对照是语法层的还是机制层的。** 如果 React 版只是把 `v-if` 换成三元、把 `v-for` 换成 `map`，代码能跑，但你没写清「为什么这里必须 `key={id}`」「为什么这个 `useEffect` 应该在事件处理器里」——首页那句判据就成立：**写不出对照关系的概念，就是你还没真正理解的概念。**
2. **你的数据层抽象到底框不框架无关。** Vue 版里那个 `getRepository()` 是唯一取用点，本项目要求 React 版**共用同一份数据接口与同一批纯函数**。做不到就说明当时抽层是形式而非结构。
3. **思维定式在哪里咬你。** 首页要求对照笔记里至少 3 处明确记录「我按 Vue 的方式写，结果错了」。这一条是本项目的验收硬门槛：凑不出来就别提交——它意味着你没在对比，只是在用 React 语法写 Vue。

<Callout type="unverified" title="本章代码未在本机运行验证">

写作环境是 VitePress 文档站，不是这个待办应用。本章所有 React / TypeScript 代码**都没有被创建、编译或运行过**，凡涉及运行结果处一律写「预期结果是…」，并在每个阶段给出可执行的验证动作（`npm run build`、`npm run type-check`、Vitest、React DevTools Profiler 的具体操作）。请把本章当施工图与验收单。

版本口径：React 18+ 函数组件与 Hooks、React Router 与状态管理库**只写名称不写版本号**，动手前先 `npm ls` 确认，并以各自官方文档当前版本为准。

</Callout>

## 目标与范围：逐条覆盖首页条款

首页给了技术要求 4 条、功能对等 3 条、对照笔记 7 项、验收标准 5 条。右列是你交付时要能指认的东西。

| 首页条款 | 落点 | 阶段 |
| --- | --- | --- |
| `npm create vite@latest` 选 React + TypeScript，保留 `StrictMode` | `src/main.tsx` 里 `<StrictMode>` 还在；`package.json` 有 `dev/build/lint/type-check/test` | ① |
| 路由用 React Router，状态方案自选并说明理由与 Vue 对应物 | `router/index.tsx` + README「技术决策」一节 | ①② |
| 全项目函数组件 + Hooks，零类组件写法 | `grep -rn "extends Component\|extends React.Component\|createClass" src` 为空（错误边界那一处例外，见翻车点 8） | ①–⑥ |
| TypeScript 严格模式，`any` 出现 0 次 | `tsconfig` 开 `strict` + `noUncheckedIndexedAccess`；ESLint `no-explicit-any: error` | ② |
| 列表页：状态筛选 + 关键词搜索，筛选状态与 URL 双向同步 | `pages/TodoListPage.tsx` + `hooks/useTodoQuery.ts` | ③ |
| 详情页：通过路由参数访问，ID 不存在显示 404 | `/todos/:id` + `pages/TodoDetailPage.tsx` + `*` 路由 | ④ |
| 与 Vue 版共用同一份数据接口（可替换的数据适配层） | `shared/` 目录（接口 + 纯函数）+ `services/` 实现 | ② |
| 对照笔记 7 项（状态 / 派生 / 副作用 / 通信 / key / 性能 / 行数） | `docs/COMPARISON.md`，本章「对照复盘表」一节是它的骨架 | ⑥ |
| Profiler 里没有明显无效重渲染：改一条待办不应让所有行重渲染 | Profiler 录屏或「已渲染次数」截图进 README | ⑤ |
| 能不看代码回答：某一次 state 更新会触发哪些组件重渲染 | README「重渲染地图」一节 | ⑤⑥ |

**明确不做**：不写后端、不部署、不做 SSR / React Server Components（[第 11 章](/react/react-only)已说明原因：版本敏感且超出对照法范围）、不引 UI 组件库、不加拖拽与撤销重做、不做真实鉴权。「登录」仍是假的：一个 `useReducer` 里的布尔值 + 一个 `login()`，用来练重定向，不是安全边界（真正的在[认证](/backend/auth-session)）。这条要写进 README。

## 需求清单：没做过 Vue 版也能直接开工

首页的前置是 Vue 领域，但本项目不得把它当成唯一路径：**下面这张表就是完整需求**，你可以据此独立实现 React 版，只是会失去「对照」这一半价值。要补回对照，任选其一：① 用 [Vue 阶段项目](/vue/project)的需求做一版 Vue（推荐，两天工作量）；② 拿你手上任一个 Vue 3 应用（列表 + 详情 + URL 同步即可）当对照物；③ 只写 React 版，但对照笔记改成「本站前 11 章的每条结论 ↔ 我的代码」，并在 README 里声明没做过 Vue 版。

| 编号 | 需求 | 可验证行为 |
| --- | --- | --- |
| R1 | 待办模型：`id`、`title`、`note`、`status`（`active` / `done` / `archived`）、`dueAt`（`YYYY-MM-DD` 或 `null`）、`tags[]`、`createdAt`、`updatedAt` | 类型定义在 `shared/model.ts`，两个框架共用 |
| R2 | 列表页显示全部待办，按 `filter` / `q` / `sort` / `page` 四个维度筛选；默认每页 50 条 | 空态、加载态、错误态三张画面都存在 |
| R3 | 四个筛选维度全部写进 URL query；刷新、粘贴分享链接、后退/前进都能恢复 | 访问 `/todos?filter=done&q=会议&sort=dueAt&page=2` 后四项完整 |
| R4 | 非法 URL 值回落到默认（不白屏、不报错） | `?filter=garbage` → 显示「全部」 |
| R5 | 搜索框逐键响应但**不进历史栈**；筛选/排序/翻页进历史栈 | 输入 5 个字后按后退，一步离开列表页 |
| R6 | 详情页按 `/todos/:id` 访问；不存在 → 显示 404 页面（不是空白、不是自己画一句文案） | 后退不回到一个不存在的资源 |
| R7 | 详情页可编辑标题、备注、截止日、标签；校验：标题非空且 ≤80 字、`dueAt` 合法、标签去空去重；错误提示挂字段旁且可被读屏找到 | 键盘可完整走一遍；`aria-describedby` 存在 |
| R8 | 设置页切换亮/暗主题，持久化到 `localStorage`，刷新保持；颜色靠 CSS 自定义属性，组件里不写 `theme === 'dark'` 分支 | 改 `--surface-1` 全站跟着变 |
| R9 | 一个受保护页面（`/archive`），未登录重定向到 `/login?redirect=/archive`，登录后回跳原页 | `/login` 自身不带保护标记 |
| R10 | 数据层是一个接口，实现可替换；业务代码里只有一个取用点 | 换成 `httpRepository` 时除 `services/` 外零改动 |
| R11 | 1000 条模拟数据下不卡死；README 写明方案、理由与前后数字 | Profiler 或 `performance.mark` 的数字 |
| R12 | 新增/编辑/删除/勾选全部乐观更新（界面不等网络），失败有回滚或提示 | 手动让 `localRepository` reject 一次，看行为 |

## 目录结构与文件规划

```text
todo-react/
├── index.html / vite.config.ts / tsconfig.app.json / eslint.config.js
├── src/
│   ├── main.tsx                   # StrictMode + RouterProvider + 全局样式 + 主题初值
│   ├── app/
│   │   ├── router.tsx             # ≤70 行：路由表、lazy、errorElement、受保护布局
│   │   └── AppRoot.tsx            # ≤40 行：AppHeader + <Outlet />
│   ├── shared/                    # ★ 框架无关，两个版本逐字共用
│   │   ├── model.ts               # 类型 + DEFAULT_QUERY + isFilter / isSortKey
│   │   ├── query.ts               # parseQuery / serializeQuery（纯函数）
│   │   ├── select.ts              # selectTodos（筛选 + 搜索 + 排序，纯函数）
│   │   └── validate.ts            # validateTodoDraft / normalizeDraft
│   ├── services/
│   │   ├── repository.ts          # TodoRepository 接口 + getRepository()
│   │   └── localRepository.ts     # localStorage + version 信封 + sleep(120)
│   ├── state/
│   │   ├── todosReducer.ts        # 纯 reducer，可脱离 React 单测
│   │   ├── TodosProvider.tsx      # useReducer + 稳定 actions，唯一写入者
│   │   ├── settings.tsx           # theme + 持久化 + document.documentElement
│   │   └── auth.tsx               # isLoggedIn + redirect 记录
│   ├── hooks/
│   │   ├── useTodoQuery.ts        # URL ↔ 筛选双向同步（核心难点）
│   │   ├── useTodos.ts            # 把 Context + 取数状态包成页面视角接口
│   │   ├── useAsync.ts            # loading / error / 竞态 / AbortSignal
│   │   └── useDebouncedCallback.ts
│   ├── components/
│   │   ├── AppHeader.tsx / TodoFilters.tsx / TodoList.tsx / TodoRow.tsx
│   │   └── TodoForm.tsx           # 新增与编辑复用（受控 + 三档校验时机）
│   ├── pages/
│   │   ├── TodoListPage.tsx / TodoDetailPage.tsx / SettingsPage.tsx
│   │   ├── ArchivePage.tsx / LoginPage.tsx / NotFoundPage.tsx
│   │   └── ErrorFallback.tsx      # 错误边界兜底 UI
│   └── styles/                    # base.css + tokens.css（[值、单位与自定义属性](/css/units-and-custom-properties)）
├── docs/COMPARISON.md             # ★ 对照笔记，本项目核心产出
└── src/__tests__/                 # shared 四个纯函数 + reducer + useTodoQuery
```

三条硬约束：**① `shared/` 里不允许 `import` 任何 `react` 或 `vue`**——这一条能被 `grep -rn "from 'react'" src/shared` 自动检查，也是 R10「框架无关抽象」的真正验收点；**② `components/` 里不允许出现 `useTodos()` / `getRepository()`**，行组件只吃 props（延续 Vue 版 `TodoItem` 的纪律，这样才可复用可单测）；**③ 单文件 ≤200 行**，超了必须拆。

## 六阶段实施

顺序不能换，每阶段只做一件事，末尾两行是硬要求。

### 阶段 ① 脚手架、路由与骨架

`npm create vite@latest todo-react -- --template react-ts`，装依赖后立刻把 `npm run dev` / `build` / `type-check` / `lint` 各跑一次，确认脚手架本身是绿的再动手（这条在 Vue 版阶段 ① 也出现过，原因一样：脚手架报错会污染你后面所有判断）。

同时做四件事：**保留 `main.tsx` 里的 `<StrictMode>`**（首页明确要求，理由见[第 11 章](/react/react-only)——它是你唯一的免费 bug 检测器）；`tsconfig.app.json` 打开 `strict` 与 `noUncheckedIndexedAccess`；ESLint 扁平配置把 `@typescript-eslint/no-explicit-any` 设 `error`，并确认 `eslint-plugin-react-hooks` 生效（`exhaustive-deps` 必须是 `error`，第 5 章那条死循环的唯一守门人）；路由表按 R3/R6/R9 建：`/` → 重定向 `/todos`、`/todos`、`/todos/:id`、`/settings`、`/archive`（带 `meta` 性质的自定义保护）、`/login`、`*` → `NotFoundPage`。页面组件全部 `React.lazy` + `<Suspense fallback>`，包在布局路由里。

守卫在 React Router 里没有 `beforeEach` 这个位置，本站的写法是一个「要求登录」的布局组件：读 `isLoggedIn`，不满足就渲染一个 `Navigate` 并把来路塞进 `state` 属性（内联对象用一层花括号包，写成 `state={ { from: location } }`）。**为什么不用守卫函数**：React Router 的导航守卫能力与 Vue Router 差别较大（版本敏感），用组件表达重定向更符合 React「UI 即状态」的模型，也更好测。细节以[React Router 与 Vue Router 对照](/react/router)与官方文档为准。

**可验证产出**：`/settings` 首次进入时 Network 面板**才**出现对应 chunk（证明代码分割生效）；`/todos/随便什么` 不 404（dev server 回退）；未登录访问 `/archive` 地址栏变成 `/login?redirect=/archive` 或等价形式。**自查（故意制造错误）**：把重定向写成「永远跳 `/login`」，看是否出现「登录后又回到登录页」的死循环——这就是 Vue 版翻车点 6 的 React 版本，现在见一次。

### 阶段 ② shared 纯函数 + 数据层 + reducer

先写 `shared/` 四个文件，**然后立刻去 Vue 项目里把它的 `types/model.ts`、`useTodoQuery` 里的解析/序列化、store 里的 `filtered` 换行删掉、改成 import 这两处共用的 `shared/`**。这一步做完，R10 与「抽象框架无关」两条同时被证明。

```ts
// shared/query.ts —— 纯函数，React 与 Vue 共用
import { DEFAULT_QUERY, isFilter, isSortKey, type TodoQuery } from "./model";

/** 外部输入（URL query / 表单）一律 unknown：每一项都要收窄，不许断言 */
function first(value: unknown): string | null {
  if (typeof value === "string") return value;
  const head = Array.isArray(value) ? value[0] : null;
  return typeof head === "string" ? head : null;
}

export function parseQuery(raw: Record<string, unknown>): TodoQuery {
  const page = Number(first(raw["page"]));
  return {
    filter: isFilter(first(raw["filter"])) ? (first(raw["filter"]) as TodoQuery["filter"]) : DEFAULT_QUERY.filter,
    q: first(raw["q"]) ?? "",
    sort: isSortKey(first(raw["sort"])) ? (first(raw["sort"]) as TodoQuery["sort"]) : DEFAULT_QUERY.sort,
    page: Number.isInteger(page) && page > 0 ? page : DEFAULT_QUERY.page,
  };
}

export function serializeQuery(query: TodoQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (query.filter !== DEFAULT_QUERY.filter) out["filter"] = query.filter;
  if (query.q !== DEFAULT_QUERY.q) out["q"] = query.q;
  if (query.sort !== DEFAULT_QUERY.sort) out["sort"] = query.sort;
  if (query.page !== DEFAULT_QUERY.page) out["page"] = String(query.page);
  return out;                       // 默认值不进 URL：/todos 与 /todos?filter=all 是同一个页面
}
```

`selectTodos` 照 Vue 版 `filtered` 逐字搬（判别联合、`localeCompare(..., "zh")`、`null` 排最后），`todosReducer` 的每个分支都是**返回新数组/新对象**（[不可变更新](/react/state)）：

```ts
// state/todosReducer.ts —— 纯函数，可脱离 React 单测
export function todosReducer(state: TodosState, action: TodosAction): TodosState {
  switch (action.type) {
    case "loaded":
      return { ...state, items: action.items, load: { kind: "ready" } };
    case "patched":
      return { ...state, items: state.items.map((t) => (t.id === action.id ? { ...t, ...action.patch, updatedAt: action.now } : t)) };
    case "statusChanged":
      return { ...state, items: state.items.map((t) => (t.id === action.id ? { ...t, status: action.status, updatedAt: action.now } : t)) };
    case "removed":
      return { ...state, items: state.items.filter((t) => t.id !== action.id) };
    // ❌ 错在写法上：state.items.push(action.item) 或 state.items[0].done = true 都不返回新对象
  }
}
```

**可验证产出**：`npm run test:unit` 里 `shared/query.test.ts`（非法值回落、默认值不序列化、数组型 query 取首项）与 `todosReducer.test.ts`（每个分支返回的引用 **!==** 原引用）全绿。**这一步是本项目的机制层证据**：用 `expect(next.items).not.toBe(state.items)` 直接断言不可变性，把「为什么 Vue 里能 `push`、React 里不能」写进 COMPARISON.md。自查：故意在 `patched` 分支里改成 `state.items[idx] = { ... }`（就地改数组），跑测试看哪条断言先红——它就是你以后 review 别人 PR 的抓手。

### 阶段 ③ 列表页与 URL 双向同步

本项目最难点，也是 React 与 Vue 差别最大的一处。Vue 版靠两个 `watch` + 一个 `applyingFromUrl` 闸门；React 版的正确形态是**把 URL 当成唯一真相，本地不留第二份 state**：

```tsx
// hooks/useTodoQuery.ts —— 方向只有一个：URL → 派生值；写回用 replace/push
import { useSearchParams } from "react-router-dom";
import { parseQuery, serializeQuery } from "@/shared/query";
import { DEFAULT_QUERY, type TodoQuery } from "@/shared/model";

export function useTodoQuery() {
  const [params, setParams] = useSearchParams();
  const query = parseQuery(Object.fromEntries(params));   // 每次渲染重算：这是纯函数，便宜

  function update(patch: Partial<TodoQuery>, mode: "push" | "replace" = "push") {
    const next: TodoQuery = "filter" in patch || "sort" in patch
      ? { ...DEFAULT_QUERY, ...query, ...patch, page: 1 }   // 结构变化 → 页码归 1
      : { ...query, ...patch };
    setParams(serializeQuery(next), { replace: mode === "replace" });
  }

  return { query, update };
}
```

四条设计判断都要能口头解释：**① 不写 `useState(query)` 再同步 URL**（那是 Vue 版双 watch 的起源，也是 React 里最容易死循环的写法）；② `parseQuery` 在渲染期重算而不是 `useMemo`——派生值直接算，第 5 章清单第 1 条；③ 搜索框**本地 state 逐键响应 + 防抖后 `replace` 写回 URL**，因为「每个字都进历史栈」是真实可用性 bug（R5）；④ `page` 在筛选/排序变化时重置为 1，否则会停在越界页码（与 Vue 版同一条理由）。

列表页取数与分页：

```tsx
export function TodoListPage() {
  const { items, load } = useTodos();               // store + 竞态处理
  const { query, update } = useTodoQuery();
  const rows = selectTodos(items, query);           // 纯函数，不 setState
  const PAGE_SIZE = 50;
  const start = (query.page - 1) * PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  return (
    <section aria-labelledby="list-heading">
      <h1 id="list-heading" tabIndex={-1}>待办</h1>
      <TodoFilters query={query} onChange={update} />
      <LoadStateView state={load} empty={<p>没有符合条件的项目。</p>}
        ready={() => (
          <TodoList todos={rows.slice(start, start + PAGE_SIZE)} onToggle={...} onOpen={...} />
        )} />
    </section>
  );
}
```

`LoadStateView` 内部对 `state.kind` 做四分支（判别联合的用处：少写一个分支 TS 过不去），这条延续 Vue 版模板里那条 `v-if` 链。

**可验证产出**：R3/R4/R5 三条逐条手测；React DevTools Profiler 录一次「连续输入 5 个字」，看 `TodoListPage` 是否每字渲染一次（是）以及 `TodoRow` 是否跟着全渲染（**不该**）。**自查**：把 `update` 里的 `setParams` 换成 `useEffect` 侦听本地 state 再写 URL，观察后退栈被塞满 + 偶发循环——这就是 Vue 直觉在这里失效的地方，记进 COMPARISON.md 第一条。

### 阶段 ④ 详情页、表单与错误边界

详情页要点（全部有前章依据）：`useParams()` 拿 `id`，**它的值必须先收窄再用**（`string | undefined`），别 `as string`；数据不在内存时按 id 拉一次，竞态交给 `useAsync`（`AbortController` + 代号比较，第 5 章与 [Vue 版参考答案第 5 段](/vue/project)是同一套逻辑，可直接搬到 `shared` 之外的框架适配层）；**取不到时导航到 404 而不是画一句文案**——`<Navigate to="/not-found" replace />`，让「未找到」只有一个入口。

表单按[第 10 章](/react/refs-and-forms)：受控为主，`<form noValidate onSubmit>` 里第一句 `event.preventDefault()`；校验用 `shared/validate.ts` 纯函数 + `touched` 状态（onBlur 才报错）；错误文本 `id` 与字段 `aria-describedby` 关联；提交成功后把焦点移回标题（`useRef` + `focus()`）；「取消编辑」用 `key` 重挂表单而不是逐项 `setX('')`。

错误边界：给详情页外面包一层边界（[第 11 章](/react/react-only)那个 class 组件），兜底 UI 用 `ErrorFallback`，重试按钮换 `key` 重挂。**这是全项目唯一允许出现的类组件**，README 里写明它为什么必须存在、以及它兜不住事件处理器里的错误。

**可验证产出**：访问不存在的 ID 显示 404 页且后退不回该 URL；未登录访问 `/archive` 被拦下、登录后回跳；编辑保存后列表里那一行文本更新、`updatedAt` 变化、URL 不变；点「取消编辑」后表单回到初始值且 touched 清空。**自查（故意制造错误）**：在 `TodoForm` 里把 `value={draft.title}` 的 `onChange` 删掉敲字（第 10 章故障二），再让 `draft` 首帧为 `undefined` 触发「非受控变受控」警告——两条报错文本抄进笔记。

### 阶段 ⑤ 组件拆分、引用稳定性与性能复核

先跑通再拆，拆的判据沿用[Vue 第 5–6 章](/vue/composables)那三问。React 版新增一条判据：**这个值如果每次渲染都是新引用，`memo` 就等于没写**（[第 7 章](/react/re-render-performance)）。

行组件的标准形态：

```tsx
export const TodoRow = memo(function TodoRow({ todo, onToggle, onOpen }: Props) {
  return (
    <li className="row">
      <input type="checkbox" checked={todo.status === "done"}
        aria-label={`完成「${todo.title}」`} onChange={(e) => onToggle(todo.id, e.target.checked)} />
      <button className="title" onClick={() => onOpen(todo.id)}>{todo.title}</button>
    </li>
  );
});

// 父组件里：稳定 onToggle（dispatch 引用不变，或 useCallback 包一层）+ 每行只传它自己那条 todo
const handleToggle = useCallback((id: string, checked: boolean) => {
  dispatch({ type: "statusChanged", id, status: checked ? "done" : "active", now: Date.now() });
}, []);
```

`TodoList` 里**不要**写 `onToggle={() => toggle(todo.id)}`——每行一个新函数，`memo` 立刻失效。这一条是 React 生态最经典的性能误用，也是本项目 Profiler 截图能不能过关的关键。

性能复核按[第 7 章](/react/re-render-performance)的「测量 → 定位 → 动手」：造 1000 条（`services/seed.ts` 一次性生成），默认分页 50 条；「查看全部」模式切到窗口化列表（固定行高、缓冲区、`useRef` 拿滚动容器 + `onScroll`）；用 Profiler 的「为什么渲染」列确认只有受影响行重渲染；`performance.mark` 夹住一次列表更新，把前后数字记进 README。**别第一步就上 `useCallback` 铺满全项目**——先把「state 放对位置 + 每行只依赖自己」这两件结构性的事做完。

**可验证产出**：Profiler 显示勾选一条待办时 `TodoRow` 渲染次数 = 1（其余行为 0）；1000 条滚动流畅；README 有一段带数字的性能说明；`grep -rn "useCallback" src` 的结果每一处你都能解释「它在防什么」。**自查**：把 `handleToggle` 改成行内箭头函数，Profiler 里渲染次数立刻变成 N——这是本项目最能说明「引用稳定性」的一次实验。

### 阶段 ⑥ 对照笔记与验收

写 `docs/COMPARISON.md`，用下面三张表当骨架，每项**必须附两边代码片段**。然后跑四条命令：`npm run lint` / `npm run test:unit` / `npm run type-check` / `npm run build`，全绿再交。

**可验证产出**：COMPARISON.md 完成、三张表填满、至少 3 条「我按 Vue 直觉写错了」的记录、README 有重渲染地图与性能数字。

## 对照复盘表：同一需求在两个框架里各自怎么落地

这是本项目的核心交付物（不是附属品）。表 A 是骨架，表 B 是必须填的错题本，表 C 是量化对比。

### 表 A · 逐需求落地对照

| 需求 | Vue 版落地 | React 版落地 | 谁多写了什么 | 不可照搬的原因 |
| --- | --- | --- | --- | --- |
| 集合状态 | `ref<Todo[]>`，就地 `push`/改字段也能驱动视图 | `useReducer` + 每个分支返回新数组 | React 多写 `{ ...state }` 与 `map/filter` | Vue 是可变 + 依赖追踪；React 是引用比较（[第 1 章](/react/two-rendering-models)） |
| 派生值（筛选结果） | `computed(() => filtered(query))`，自动缓存 | 渲染期直接 `selectTodos(items, query)` | Vue 多写一个 getter；React 多写「要不要 `useMemo`」的判断 | `useMemo` 不保证缓存，`computed` 保证（[第 7 章](/react/re-render-performance)） |
| 副作用（取数、监听、订阅） | `watch` + `onCleanup` / `onUnmounted` | `useEffect` + 返回 cleanup + 依赖数组 | React 多写依赖数组与 `AbortController` | effect 语义是「与外部系统同步」，不是侦听（[第 5 章](/react/use-effect)） |
| URL ↔ 筛选 | 两个 `watch` + `applyingFromUrl` 闸门 | `useSearchParams` 单向：URL 是真相，本地不留 state | Vue 多写闸门与深比较 | React 没有「侦听到某个值就自动跑」这一等物；双向同步会成渲染循环 |
| 子传父（勾选） | `emit("toggle", id)` | `onToggle={handleToggle}` 父级显式交下函数 | React 多写函数引用稳定化 | `emit` 走组件事件系统，父级不监听也没人收；回调缺失直接崩（[第 4 章](/react/props-and-children)） |
| 插槽 / 内容分发 | `<slot />`、具名与作用域插槽 | `children`、render props（[第 4 章](/react/props-and-children)） | — | 两边表达力接近，是少数可平移的部分 |
| 跨层共享 | `provide` / `inject` + `InjectionKey` | `createContext` + `useContext`，**value 必须稳定** | React 多写 `useMemo` 包住 value | Context 值变化会重渲染所有消费者（[第 6 章](/react/context)） |
| 表单双向绑定 | `v-model.trim.lazy`、`defineModel()` | `value` + `onChange` + 手写 `onBlur` 里 trim | React 多写修饰符的等价逻辑 | React 无 `v-model`（[第 10 章](/react/refs-and-forms)） |
| DOM 操作 / 焦点 | 模板引用、`useTemplateRef`（3.5+） | `useRef` + `ref` 属性 | — | 时机一致（提交后才有节点），但 React 不会通知你 |
| 列表身份 | `:key="todo.id"` | `key={todo.id}` | — | 语义一致；React 额外把换 `key` 当成重置 state 的正式手段 |
| 渲染粒度 | 只有读了该值的组件重渲染 | 组件函数重跑 + 整棵子树重跑（除非 `memo`） | React 多写 `memo` / `useCallback` / state 下移 | 这是两边性能结论不可互换的唯一原因（[第 7 章](/react/re-render-performance)） |
| 错误兜底 | `onErrorCaptured` / `app.config.errorHandler` | class 错误边界 + 换 `key` 重试 | React 多写一个类组件 | 对照法在这里失效（[第 11 章](/react/react-only)） |
| 主题 | `settings` store + `data-theme` + CSS 变量 | Context + `useEffect` 写 `documentElement` + 同一套 CSS 变量 | 两边等量 | 唯一真正可以逐字互抄的一节 |
| 代码分割 | `() => import(...)` | `React.lazy` + `Suspense` | React 多写 `Suspense` 边界 | 懒加载语义两边一致 |

### 表 B · 错题本：我按 Vue 的方式写，结果错了（至少 3 条）

每条必须写成四段：**当时的代码 → 症状 → Vue 里为什么不成立 → 正确 React 写法**。下面三条是本站读者的真实高频错题，可作为格式参照（**你必须写自己的，不能照抄**）：

1. `state.items.push(newTodo)` 后界面不动 → 原因：引用没变，React 比较用的是 `Object.is`；Vue 里 Proxy 追踪到了数组变更，所以同一行代码在 Vue 里是对的。正确写法：`{ ...state, items: [...state.items, newTodo] }` 或 reducer 分支返回新数组。
2. 用 `useEffect` 把 `props.todo` 复制进本地 `draft` → 症状：编辑完再进另一条，看到的还是上一条的草稿；Profiler 里多一轮渲染。原因：Vue 里 `props` 直接可读，需要「本地可改副本」时我们用 `ref(clone(props.todo))` + `watch` 同步，但那层同步在 React 里变成「渲染错的 → 再渲染对的」。正确写法：把 `id` 作为 `key` 交给表单组件（重挂即重置），或让 `draft` 的初值来自惰性 `useState(() => ...)`。
3. 给 `TodoRow` 传 `onToggle={() => toggle(todo.id)}` → 症状：勾一条，1000 行全渲染，`memo` 像假的。原因：Vue 的 `@toggle` 是事件名绑定，不存在「函数引用参与比较」这件事；React 的 `memo` 浅比较 props，新函数每帧都不同。正确写法：`onToggle` 接一个引用稳定的 `(id, checked) => void`，行内把 `todo.id` 作为参数传。

### 表 C · 量化对比（填完再交）

| 指标 | Vue 版 | React 版 | 差异成因（一句话） |
| --- | --- | --- | --- |
| `src/` 文件数 |  |  |  |
| `.vue` / `.tsx` 总行数 |  |  |  |
| 列表页单文件行数 |  |  |  |
| 自定义 Hook / composable 数 |  |  |  |
| `useMemo`+`useCallback`+`memo` 出现次数 | 0（不适用） |  | 这一项就是「手动记忆化」的税 |
| `any` / `as` 出现次数 |  |  | 断言在两边都只该出现在边界 |
| 测试文件数 / 用例数 |  |  | 纯 reducer 与 composable 谁更好测 |

## 技术决策清单（README 里每条都要有理由）

| 决策点 | 你必须能回答的问题 | 本站建议 |
| --- | --- | --- |
| 状态管理 | 待办集合放 `useReducer`+Context、Zustand 还是 Redux Toolkit？对应 Pinia 的哪一部分？ | 本项目体量：**`useReducer` + 分域 Context 足够**；想试库就用 Zustand（它的模型最接近 Pinia：一个 store + 若干 action），并在笔记里写「Redux Toolkit 的 slice 对应 Pinia 的 store，但 boilerplate 差异在哪」 |
| Context 的粒度 | `value` 是否每次渲染都新建对象？谁会被连带重渲染？ | 拆成「状态 Context」与「actions Context」两个 Provider（[第 6 章](/react/context)），actions 来自 `dispatch`，引用天然稳定 |
| 服务端数据 | 手写 `useEffect` 取数还是 TanStack Query？ | 本项目体量用 `useAsync` 手写即可，但要写清官方式列举的四个不足（服务端不跑、瀑布流、无缓存去重、竞态样板）；真实项目直接上 [TanStack Query](/react/state-management) |
| URL 同步 | `useSearchParams` 的行为在你的 Router 版本上是什么？后退栈怎么控制？ | 以[第 8 章](/react/router)与官方文档为准；`replace` 与 `push` 的选择必须能解释 |
| 表单校验 | 自己写还是 React Hook Form？ | 4 个字段的表单自己写（[第 10 章](/react/refs-and-forms)那 60 行）；字段多且逐键性能敏感才上库 |
| 样式 | CSS Modules / 全局 + 令牌 / 原子化？ | 全局 `tokens.css` + 语义类名，与 Vue 版共用同一套自定义属性，才能证明「主题切换与框架无关」 |
| 虚拟化 | 分页、`content-visibility` 还是窗口化？ | 默认分页 50 + 「全部」走窗口化；写清为什么不是 `v-memo` 的等价物 |

## 验收清单

- [ ] `npm run lint`、`npm run test:unit`、`npm run type-check`、`npm run build` **零错误零警告**。
- [ ] `src/main.tsx` 里 `<StrictMode>` 存在；开发环境 effect 双跑（setup/cleanup/setup）被你在笔记里解释成设计而不是 bug。
- [ ] 零类组件：`grep -rn "extends Component\|extends React.Component" src` **只命中错误边界那一处**，且 README 写明它为什么必须存在。
 [ ] 零 `any`：`grep -rnw any src` 只命中注释；`@ts-ignore` / `@ts-expect-error` 0 次；`as` 只出现在边界收窄（`route.params`、`FormData.get`）与 `as const`。
- [ ] `grep -rn "from \"react\"" src/shared` 为空 → 数据层与纯函数**框架无关**；同一份 `shared/` 被 Vue 版 import 后 Vue 版仍全绿（这条只有对照着做才能过关；若按替代路径 ③ 走，写一份 `shared/README.md` 说明它没有任何 React 依赖）。
- [ ] R3 刷新不丢筛选：`/todos?filter=active&q=会议&sort=dueAt&page=3` 四项完整恢复；非法值回落默认；后退能回到上一个筛选。
- [ ] R5：连续输入 5 个字后按一次后退即离开列表页（搜索走 `replace` 且防抖，筛选走 `push`）。
- [ ] 不存在的 ID 显示 404 页面（不是空白、不是控制台异常、不是自己画的文案）；通配路由生效。
- [ ] R7 表单校验：拔掉鼠标用键盘完成「新增 → 筛选 → 进详情 → 改标题 → 触发校验错误 → 修正 → 保存 → 返回 → 删除」；错误提示可被读屏定位（`aria-describedby` + `role="alert"`）。
- [ ] 修改任意一条待办，Profiler 显示只有那一行 `TodoRow` 重渲染（数字或截图进 README）。
- [ ] 1000 条不卡死，README 写明方案、理由与实测前后数字（`performance.mark` 或 Profiler 数值均可）。
- [ ] 主题切换只靠 CSS 自定义属性，组件里搜不到 `theme === "dark"` 分支；刷新后主题保持。
- [ ] `docs/COMPARISON.md` 表 A 全部填满、表 B ≥3 条、表 C 有数字；每一项都能指出两边代码位置。
- [ ] 你能不看代码回答首页那条验收：**「这个 React 项目里，哪一次 state 更新会触发哪些组件重渲染」**——README 里有一张重渲染地图（谁 state、谁子树、谁 memo）。
- [ ] 三个「按 Vue 直觉写错」的例子在 Git 历史里能找到（提交信息或笔记里的前后对比）。

## 常见翻车点

**1）就地修改 state，界面不动。** 现象：`dispatch` 里 `state.items.push(x)` 后返回同一个 `state`，界面没反应；但 DevTools 里数据确实变了。原因：React 用 `Object.is` 比较新旧引用，同一引用直接跳过重渲染（Vue 的 Proxy 追踪的是「属性变更」，不是「引用变更」）。怎么确认：在 reducer 里 `return next === state` 打点，或写一条 `expect(next.items).not.toBe(state.items)` 的单测看它红不红。怎么修：一律返回新对象/新数组；确认 `eslint` 与 `no-param-reassign` 没有被关闭。**这一条是本项目最容易犯、也最能证明你懂机制的一条。**

**2）用 `useEffect` 做「props 变了同步到 state」。** 现象：偶发显示上一条数据、每次改动多一轮渲染、StrictMode 下还闪两次。原因：把 Vue 的 `watch(props.todo, ...)` 直译过来。怎么确认：Profiler 里看到同一交互触发两次组件渲染；或在 effect 里 `console.log` 看它是否在错误之后才跑。怎么修：`key={id}` 重挂 + 惰性初始值（[第 5 章](/react/use-effect)清单第 6 条、表 B 第 2 条）。

**3）Context 的 `value` 是字面量对象，全树跟着重渲染。** 现象：什么都没改，只是父组件渲染了一次，所有消费者都重渲染。原因：下面这一行每次渲染都会新建一个对象字面量，而 Context 按引用比较，于是每个消费者都被判定为「值变了」。

```jsx
<TodosContext.Provider value={{ items, dispatch }}>
```

怎么确认：把 `value` 换成 `useMemo(() => ({ items, dispatch }), [items, dispatch])` 立刻恢复正常；或在 Profiler 里看渲染原因是「Context 变化」。怎么修：包 `useMemo`，或拆成「状态」与「actions」两个 Context（[第 6 章](/react/context)）。

**4）`memo` 传了每次新建的函数或对象，memo 完全失效。** 现象：加了 `memo` 但渲染次数没降。原因：行内 `onClick={() => ...}`、`style` 内联对象、`todos={rows.slice(...)}`（每帧新数组）。怎么确认：`console.log('render', todo.id)` 计数，或 Profiler 里逐行看。怎么修：把「切片」结果 `useMemo` 住、回调 `useCallback` 且参数化（`(id, checked) => void`）、派生值下沉进行组件（[第 7 章](/react/re-render-performance)）。**注意顺序**：先做结构（state 位置、每行只依赖自己），再谈记忆化。

**5）URL 同步写成双向，出现后退栈爆炸或渲染循环。** 现象：地址栏一秒被推好几条；或 `useEffect` 报 `Maximum update depth exceeded`。原因：本地 `useState(query)` + 一个侦听它的 effect 写 URL + 一个侦听 `searchParams` 的 effect 写本地——两边互相触发；而 `useSearchParams()` 返回的 `URLSearchParams` 每帧是新对象，放进依赖必然每帧重跑。怎么确认：把两个 effect 各加一行 log，看是否交替刷屏。怎么修：**只留一个方向**（URL → 派生值；用户操作 → 写 URL），本地不留 state；搜索框的逐键响应只放输入框自己的本地 state，防抖后 `replace`（阶段 ③）。

**6）`key` 用 index，或非受控输入框串位。** 现象：删一行后勾选跑到别的待办上，或行内输入框残留上一项文本。原因：`key={i}` 让 React 就地复用 DOM，只重写它管理的属性；行内如果是 `defaultValue`，值存在 DOM 里没人管（[第 10 章](/react/refs-and-forms)最后一条警告）。怎么确认：删中间一行看勾选跟不跟着数据走。怎么修：`key={todo.id}`，且 id 必须来自数据（`crypto.randomUUID()`），不要每次渲染生成；编辑面板不要同时既受控又非受控。

**7）只在挂载时取数，路由参数变了不重新取。** 现象：从 `/todos/1` 跳到 `/todos/2`，标题还是第 1 条；或卸载后异步回调还在写 state。原因：`useEffect(..., [])` 是 Vue 的 `onMounted` 直觉；React 里参数变化不触发「重新挂载」（同一路由组件复用实例）。怎么确认：在 effect 里 log `id`，看第二次进入是否不打印。怎么修：依赖 `[id]` + `AbortController` + 代号比较（`useAsync`）；或者给组件 `key={id}` 强制重挂（两种都要能解释，别混用）。

**8）为了消灭 StrictMode 的双跑而加了「只跑一次」保险丝。** 现象：开发环境一切正常，生产偶发监听器泄漏、图表实例重复、状态初始化缺失。原因：用 `const didInit = useRef(false)` 或全局布尔挡住第二次执行，等于把清理逻辑永久跳过。怎么确认：打开 StrictMode + 在 cleanup 里 log，看它是否从不与 setup 对应。怎么修：删保险丝，把 setup/cleanup 写成镜像；「只做一次」的语义交给惰性初始值或事件处理器（[第 11 章](/react/react-only)那张症状表）。顺带：**类错误边界是本站唯一的类组件豁免**，写进 README，别让人以为你退回了旧写法。

**9）`useParams()` / `useSearchParams()` 直接当可信字符串用。** 现象：`params.id` 为 `undefined` 时把 `undefined` 拼进请求 URL，或 `as string` 一路断言过关、上线炸。原因：URL 是外部输入（[TypeScript 阶段项目](/typescript/project)的「边界处校验」规矩）。怎么确认：手改地址栏 `/todos//`、`?page=abc` 看是否白屏。怎么修：`parseQuery` 里逐字段 `isFilter` / `isSortKey` / `Number.isInteger` 收窄，非法回落默认（阶段 ② 那段代码就是干这个的）。

## 参考答案要点

<Exercise title="参考答案要点 · 四处关键实现" difficulty="挑战">

下面是本项目最容易卡住的四处：actions 稳定的 Provider、搜索框的逐键响应 + 防抖写回、窗口化列表、竞态处理。**先自己写完再对照差异。**再次声明：本章代码未在本机运行，每段末尾给的是「预期结果与验证路径」。

<template #answer>

### 1）状态/actions 分离的 Provider（把 Context 的重渲染范围压到最小）

```tsx
const TodosStateContext = createContext<readonly Todo[] | null>(null);
const TodosActionsContext = createContext<TodosActions | null>(null);

export function TodosProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(todosReducer, { items: [], load: { kind: "idle" }, selected: [] });
  const repo = useRef(getRepository());                    // 只有一个取用点，且不随渲染变化

  const actions = useMemo<TodosActions>(() => ({
    load: async () => {
      dispatch({ type: "loadStart" });
      try { dispatch({ type: "loaded", items: await repo.current.list() }); }
      catch (error) { dispatch({ type: "loadError", message: describe(error) }); }
    },
    patch: (id, patch) => dispatch({ type: "patched", id, patch, now: Date.now() }),
    setStatus: (id, status) => dispatch({ type: "statusChanged", id, status, now: Date.now() }),
    remove: (id) => dispatch({ type: "removed", id }),
  }), []);                                                // dispatch 引用稳定 → 这个对象可以只建一次

  const items = useMemo(() => state.items, [state.items]);

  return (
    <TodosActionsContext.Provider value={actions}>
      <TodosStateContext.Provider value={items}>{children}</TodosStateContext.Provider>
    </TodosActionsContext.Provider>
  );
}

export function useTodosActions(): TodosActions {
  const ctx = useContext(TodosActionsContext);
  if (!ctx) throw new Error("useTodosActions 必须在 TodosProvider 内使用");
  return ctx;                       // 只需要动作的组件（行按钮）不会因为列表变化而重渲染
}
```

**预期结果与验证路径**：把 `AppHeader` 里读 `items.length` 的那一行改成读 `actions` 后，Profiler 里勾选待办时 `AppHeader` 仍重渲染（因为它确实依赖数量），而 `TodoFilters` 不再重渲染（它只读 actions）。**验证方式**：单测里用 `@testing-library/react` 渲染一个计数组件，断言 `render` 次数；这条比任何口头解释都硬。两个 Context 拆分的收益与代价见[第 6 章](/react/context)。

一处值得你改进：`patch` 是「先改内存再落盘」的乐观更新，落盘失败时界面已经变了。要么失败后 `load()` 回滚，要么让 repository 提供 `patch` 的成功回执再写。**README 里写下你选哪种、为什么**——这条判分点与 Vue 版完全一样。

### 2）搜索框：逐键响应、防抖写 URL、后退栈干净

```tsx
export function SearchInput({ query, update }: Props) {
  const [text, setText] = useState(query.q);            // 本地先行，逐键响应
  const flushRef = useRef<() => void>(() => {});

  const commit = useCallback((value: string) => update({ q: value }, "replace"), [update]);
  const debounced = useDebouncedCallback(commit, 200);
  flushRef.current = () => debounced.flush();

  useEffect(() => { setText(query.q); }, [query.q]);     // 后退/粘贴链接时跟随 URL

  return (
    <input type="search" value={text} aria-label="搜索待办"
      onChange={(e) => { setText(e.target.value); debounced(e.target.value); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); flushRef.current(); } }} />
  );
}
```

三个设计点：**① `useEffect(() => setText(query.q), [query.q])` 是「外部来源变化才覆盖本地」**，与表 B 第 2 条那种「把 props 复制进 state」的区别在于：这里的真相来源是 URL，而不是父组件随手传的 prop；写进笔记时要把这个区分说清楚，否则判为反模式。②`flushRef` 用 ref 存「最新提交函数」，是为了让 Enter 能立即落 URL 而不等防抖——**注意 `useRef` 的读写都在事件/effect 里，不在渲染期**（[第 10 章](/react/refs-and-forms)那条禁令）。③`update(..., "replace")` 保证 R5：搜索不进历史栈。

**预期结果与验证路径**：手测「输入 会议 → 立刻按回车 → 地址栏出现 `q=%E4%BC%9A%E8%AE%AE`」；单测里注入假 `update`，断言输入 5 个字符只调用 1 次（防抖窗口内）、按 Enter 后再调用 1 次且带 `replace`。**自查**：把 `commit` 的 `useCallback` 依赖 `update` 去掉、让 `update` 每帧新建，看防抖 Hook 是否每次重建（`[update]` 依赖导致定时器反复取消）——这是「引用稳定性」在业务代码里的具体形状。

### 3）窗口化列表：1000 条只渲染可见行

```tsx
const ROW_H = 48;
export function VirtualList({ todos, renderRow }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 20 });

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;                                  // 渲染期之后才碰 DOM
    const onScroll = () => {
      const start = Math.max(0, Math.floor(box.scrollTop / ROW_H) - 5);
      const count = Math.ceil(box.clientHeight / ROW_H) + 10;
      setRange((prev) => {
        const end = Math.min(todos.length, start + count);
        return prev.start === start && prev.end === end ? prev : { start, end };
      });
    };
    onScroll();
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, [todos.length]);

  const slice = todos.slice(range.start, range.end);
  return (
    <div ref={boxRef} className="viewport" style={{ height: "480px", overflow: "auto" }}>
      <div style={{ height: todos.length * ROW_H, position: "relative" }}>
        <ul style={{ transform: `translateY(${range.start * ROW_H}px)` }}>
          {slice.map((todo, i) => (
            <li key={todo.id} style={{ height: ROW_H }}>{renderRow(range.start + i, todo)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

要点：**行高必须固定**（否则 `scrollTop / ROW_H` 算出的索引与真实位置不符，滚动时会出现「空白 + 抖动」）；`setRange` 用函数式更新并在「区间没变」时返回同一个对象，否则每帧 `scroll` 事件都触发一轮渲染；`key={todo.id}` 在这里更是前提——滚出去的行被销毁，滚回来靠 id 才对得上。`boxRef.current` 只在 effect 里读，符合纯度要求。

**预期结果与验证路径**：1000 条时 DOM 里 `<li>` 数量稳定在 20–40 之间（`document.querySelectorAll(".viewport li").length` 在 Console 里查）；滚动到底部数字仍在范围附近；Profiler 里滚动渲染次数远小于 Vue 版全量渲染时的次数。README 的性能数字就填这两组。

### 4）`useAsync`：竞态、取消与卸载后不写状态

```tsx
export function useAsync<T>(runner: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ kind: "idle" });
  const latest = useRef(0);
  const runnerRef = useRef(runner);
  useEffect(() => { runnerRef.current = runner; }, [runner]);   // 不在渲染期写 ref 之外的地方？——这里写在 effect 里

  const run = useCallback(async () => {
    const controller = new AbortController();
    const token = ++latest.current;
    setState({ kind: "loading" });
    try {
      const data = await runnerRef.current(controller.signal);
      if (token !== latest.current) return;                      // 过期结果丢弃
      setState({ kind: "ready", data });
    } catch (error) {
      if (token !== latest.current) return;
      setState({ kind: "error", message: describe(error) });
    }
  }, []);

  useEffect(() => () => { latest.current += 1; }, []);           // 卸载后任何在途结果都不再写 state
  return { state, run };
}
```

三道闸门与 Vue 版一一对应：`AbortController` 挡「在途请求继续消耗」；**代号 `token !== latest` 挡「先发的请求后到」——这一步不能省，网络乱序时 abort 管不住已经 resolve 的 Promise 链**；卸载时 `latest.current += 1` 挡「组件已销毁仍写 state」（React 对「卸载后 setState」已不再警告，所以这个 bug 会静默存在，比 Vue 里更难发现）。

与 Vue 版的最大差别是 `runnerRef`：Vue 里 `useAsync(fn)` 的 `fn` 每次渲染都是新闭包，但 `watch` 读的是最新值；React 里如果把 `runner` 直接放进 `run` 的依赖，`run` 的引用每帧变化 → 调用方的 effect 每帧重跑 → 死循环。用 ref 存最新 runner 是标准解法（官方叫法见[将事件从 Effect 中分离](/react/use-effect)），代价是「这个 Hook 的正确性依赖一条 ref 约定」，必须在注释里写明。

**预期结果与验证路径**：详情页在 `/todos/1` 与 `/todos/2` 之间来回切换，标题不闪回旧值；Network 限速 Slow 3G 后被取消的请求状态显示 `canceled`；单测让假仓库按「第二次先返回、第一次后返回」的顺序 resolve，断言最终 `state.kind === "ready"` 且数据是第二次的。**这一条是本项目里唯一能证明你真的处理了竞态的动作，别跳过。**

</template>

</Exercise>

## 官方文档与延伸阅读

- [React 领域首页「阶段项目」一节](/react/) —— 本章条款来源：技术要求、功能对等、对照笔记 7 项、验收标准都以该节为准，本章只展开不改范围。
- [useRef 参考](https://react.dev/reference/react/useRef) —— 核实「不要在渲染期读写 ref」这条本项目到处用到的纪律（2026-10-17 核实）。
- [input 组件参考](https://react.dev/reference/react-dom/components/input) —— 核实受控/非受控二选一、`value` 不接受 `undefined`、复选框用 `checked`、官方性能建议（state 下移 / `useDeferredValue`），阶段 ④ 与翻车点 6 的依据。
- [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) 与 [State 如同快照](https://react.dev/learn/state-as-a-snapshot) —— 核实表 B 三条错题的官方说法（派生值不要 setState、props 复制进 state 是反模式、用 `key` 重置）。
- [Scaling up with Reducer and Context](https://react.dev/learn/scaling-up-with-reducer-and-context) —— 参考答案第 1 段（actions 与 state 分离、Provider 粒度）的官方蓝本。
- [Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state) —— 核实「换 key 即卸载重建、并重置其 state」，翻车点 2 与 6 的判据来源。
- [React Developer Tools · Profiler](https://react.dev/learn/react-developer-tools) —— 核实「为什么渲染」这一列的存在与读法，验收清单里两条 Profiler 判据依赖它。
- [React Router 官方文档](https://reactrouter.com/home) —— 核实 `useSearchParams`（`setSearchParams` 的 `replace` 选项）、`useParams` 返回类型、`React.lazy` 与布局路由、路由级错误元素（`errorElement`）在你所用版本里的名称。**本项目路由相关结论全部以该页当前版本为准**（第 8 章已声明这是生态里版本混乱最严重的一处）。
- [Redux 文档](https://redux.js.org/introduction/getting-started) 与 [Zustand 文档](https://zustand.docs.pmnd.rs/) —— 若走库路线，核实「slice ↔ Pinia store」的映射与 Zustand 的最小模型；本站推荐口径见[第 9 章](/react/state-management)。
- [TanStack Query](https://tanstack.com/query/latest) —— 真实项目的数据层路线；用来印证官方列出的手写 effect 取数四条不足。
- [Vite 官方文档（中文）](https://cn.vite.dev/guide/) 与 [create-vite](https://github.com/vitejs/vite/tree/main/packages/create-vite) —— 核实 `react-ts` 模板当前包含的 scripts 名称与 `type-check` 是否默认存在（模板会调整，别背命令）。
- [Vue 阶段项目](/vue/project) —— 对照物：数据层接口、`LoadState` 判别联合、URL 同步闸门、`useAsync` 三道闸门、翻车点 1/5/6/8 全部有 Vue 侧同源版本，写笔记时逐条比对。
- MDN：[`FormData`](https://developer.mozilla.org/zh-CN/docs/Web/API/FormData)、[`URLSearchParams`](https://developer.mozilla.org/zh-CN/docs/Web/API/URLSearchParams)、[`crypto.randomUUID`](https://developer.mozilla.org/zh-CN/docs/Web/API/Crypto/randomUUID)、[`HTMLElement.scrollTop`](https://developer.mozilla.org/zh-CN/docs/Web/API/Element/scrollTop) —— 核实阶段 ②④⑤ 用到的浏览器 API 语义，尤其「`randomUUID` 生成 id 的可用性」与「滚动几何的单位」。

## 下一章

这个项目把 React 前 11 章用全了：两套渲染模型（[第 1 章](/react/two-rendering-models)）决定为什么每个 `patch` 都要返回新引用，JSX（[第 2 章](/react/jsx)）决定 `map` + `key` 的写法，`useState` / `useReducer`（[第 3 章](/react/state)）决定 reducer 的纯度要求，props 与回调（[第 4 章](/react/props-and-children)）决定 `TodoRow` 的接口，`useEffect`（[第 5 章](/react/use-effect)）决定取数与竞态的写法，Context（[第 6 章](/react/context)）决定 Provider 粒度，重渲染与记忆化（[第 7 章](/react/re-render-performance)）决定阶段 ⑤ 的成败，Router（[第 8 章](/react/router)）决定 URL 同步，状态选型（[第 9 章](/react/state-management)）决定你的 README 里那三条理由，`useRef` 与受控组件（[第 10 章](/react/refs-and-forms)）决定表单与焦点，对照法的盲区（[第 11 章](/react/react-only)）决定 StrictMode 与错误边界这两处「不许绕过」。

前端这条线到这里告一段落，接下来进[前端工程化](/frontend-engineering/)领域。它的阶段项目[工程化体检](/frontend-engineering/project)正好接手你现在留下的东西：`package.json` 的 scripts、`dist/` 产物与体积、依赖树里的重复包、ESLint 与 TypeScript 配置、测试覆盖、以及你在 README 里记下的那组性能数字——现在你有两份实现（Vue 与 React），体检报告因此第一次有了「同类项目横向对比」的意义。再往后是[后端开发](/backend/)：把 `getRepository()` 从 `localRepository` 换成 `httpRepository`，接上 Fastify 与数据库，这一步的可行性完全取决于本章阶段 ② 那条「`src/shared/` 里没有 React」的约束有没有守住。
