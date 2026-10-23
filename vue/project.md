# 阶段项目：多页面待办应用

这是[Vue 领域首页](/vue/)「阶段项目」一节规定的那个应用，条款原文以该节为准。它的定位不是「做一个能用的待办」——你在[纯 JavaScript 待办清单](/javascript/project)做过一次、在 [TypeScript 重写](/typescript/project)又做过一次。这次的目标是**把它做成结构完整、类型安全、可持续扩展的单页应用**，并作为进入[后端开发](/backend/)领域之前的验收关卡：之后它会接上 Fastify 后端、落进数据库、部署到 VPS，而这三步能不能不回头改业务代码，取决于你现在有没有把数据层隔离干净、把状态的唯一写入者定下来。**这个项目会被 `/backend/` 与 `/devops/` 继续扩展，本章每一次「抽一层」都是为那两次扩展付的定金。**

<Callout type="unverified" title="本章代码未在本机运行验证">

写作环境是 VitePress 文档站，不是这个待办应用，**本章所有 Vue / TypeScript 代码都没有被创建、编译或运行过**。凡涉及运行结果处一律写「预期结果是…」，并在每个阶段给出可执行验证动作（`npm run build`、`npm run type-check`、DevTools 里的具体操作）。请把本章当施工图与验收单，不要当「跑过的参考实现」。版本口径：Vue 3 + `<script setup>`、Vue Router 4、Pinia（版本号以官方文档当前版本为准，动手前核对 [create-vue](https://github.com/vuejs/create-vue)）。

</Callout>

## 目标与范围：逐条覆盖首页条款

首页给了技术要求 3 条、页面结构 4 条、架构要求 5 条、验收标准 5 条。右列就是你交付时要能指认的东西。

| 首页条款 | 落点 | 阶段 |
| --- | --- | --- |
| `npm create vue@latest`，开 TS / Router / Pinia / ESLint / Vitest | `package.json` 的 `scripts` 里五个命令都在且都跑过 | ① |
| 全项目组合式 + `<script setup>`，零选项式 | `grep -rn "export default {" src --include=*.vue` 为空 | ①–⑥ |
| 全项目 `any` 出现 0 次 | ESLint 把 `no-explicit-any` 设为 `error`；`@ts-ignore` 0 次 | ② |
| 列表页：状态筛选 + 关键词搜索，URL 与筛选双向同步（刷新不丢） | `views/TodoListView.vue` + `composables/useTodoQuery.ts` | ③ |
| 详情页：动态路由参数访问，不存在的 ID 显示 404 | `/todos/:id` + `views/TodoDetailView.vue` + catch-all 路由 | ④ |
| 设置页：主题亮/暗，持久化 `localStorage` | `views/SettingsView.vue` + `stores/settings.ts` + `composables/useLocalStorage.ts` | ②④ |
| 需登录页面，守卫拦截并重定向 | `views/ArchiveView.vue`（`meta.requiresAuth`）+ `router.beforeEach` | ①④ |
| 至少三个组件、至少两个 composable | 组件 5 个（`TodoItem` / `TodoList` / `TodoFilters` / `TodoForm` / `AppHeader`）、composable 4 个 | ⑤ |
| Pinia：一个 store 管待办、一个管用户/设置；不靠多层 props 透传 | `stores/todos.ts` / `settings.ts` / `auth.ts` | ② |
| 数据层用可替换的适配函数隔离 | `services/repository.ts` 定义接口，`localRepository` 实现 | ② |
| 模拟 1000 条不卡死，说明方案与理由 | 默认分页 50 条 + 「全部」模式走窗口化列表（[渲染性能](/vue/rendering-performance)的实现） | ⑥ |

**明确不做**：不写后端、不部署、不做 SSR、不引 UI 组件库、不加拖拽与撤销重做、不做真实多用户鉴权。「登录」是**假的**：`auth` store 里一个布尔值 + 一个可写的 `login()`，用来练守卫与重定向，不是安全边界（真正的鉴权在 [认证：Session、Cookie 与密码哈希](/backend/auth-session)）。这条要写进 README，别让人以为你实现了鉴权。

## 目录结构与文件规划

沿用[单文件组件与构建链](/vue/sfc-and-build)的约定。每个文件后的上限是硬约束——**超过 200 行必须拆**（首页验收明确写了「没有单个超过 200 行的组件」）。

```text
todo-spa/
├── index.html / vite.config.ts / tsconfig.app.json / eslint.config.ts / env.d.ts
├── src/
│   ├── main.ts                    # 挂 router 与 pinia，引全局样式，主题初值
│   ├── App.vue                    # ≤40 行：AppHeader + <RouterView />
│   ├── assets/base.css            # 不 scoped：reset + 主题自定义属性 + 关键帧
│   ├── router/index.ts            # ≤70 行：路由表、懒加载、requiresAuth 守卫、scrollBehavior
│   ├── types/model.ts             # ≤60 行：Todo 判别联合、Query、入参、LoadState
│   ├── services/
│   │   ├── repository.ts          # ≤25 行：TodoRepository 接口 + 唯一取用点
│   │   ├── localRepository.ts     # ≤70 行：localStorage 实现 + 版本信封 + 模拟延迟
│   │   └── validate.ts            # ≤60 行：unknown → Todo 的形状校验（沿用 TS 项目）
│   ├── stores/
│   │   ├── todos.ts               # ≤110 行：唯一写入者
│   │   ├── settings.ts            # ≤50 行：theme + 持久化
│   │   └── auth.ts                # ≤35 行：isLoggedIn + redirect 记录
│   ├── composables/
│   │   ├── useLocalStorage.ts     # 读写 + JSON 错误兜底
│   │   ├── useAsync.ts            # loading / error / 竞态 / AbortSignal
│   │   ├── useTodoQuery.ts        # URL ↔ 筛选双向同步
│   │   ├── useTodos.ts            # 把 store + useAsync 包成页面视角接口
│   │   └── useTodoForm.ts         # 表单状态与校验规则
│   ├── components/
│   │   ├── AppHeader.vue / TodoFilters.vue / TodoList.vue
│   │   ├── TodoItem.vue           # 只收 todo + selected，emit 事件，禁止 import store
│   │   └── TodoForm.vue           # 新增与编辑复用
│   └── views/
│       ├── TodoListView.vue / TodoDetailView.vue / SettingsView.vue
│       ├── ArchiveView.vue / LoginView.vue / NotFoundView.vue
└── tests/                          # Vitest：model / localRepository / useTodoQuery
```

`src/utils/` 只放确实无 Vue 依赖的纯函数（`formatDate`、`newId`）；一个「工具」一旦需要 `ref` 或路由，就该被重命名成 composable。

## 数据与状态设计

### 模型与状态：延续 TypeScript 项目的判别联合

`status` 用字面量、必填、`readonly`，状态迁移靠换对象而不是改字段（[联合类型与收窄](/typescript/unions-and-narrowing)、[工具类型](/typescript/utility-types)）：

```ts
// src/types/model.ts
export type TodoStatus = 'active' | 'done' | 'archived';

export interface Todo {
  readonly id: string;
  title: string;
  note: string;
  status: TodoStatus;
  dueAt: string | null;          // 'YYYY-MM-DD'，null 表示无截止日
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export type Filter = 'all' | TodoStatus;
export type SortKey = 'createdAt' | 'dueAt' | 'title';
export interface TodoQuery {
  readonly filter: Filter;
  readonly q: string;
  readonly sort: SortKey;
  readonly page: number;
}
export type TodoCreateInput = Pick<Todo, 'title'> & Partial<Pick<Todo, 'note' | 'dueAt' | 'tags'>>;
export type TodoUpdateInput = Partial<Omit<Todo, 'id' | 'status' | 'createdAt' | 'updatedAt'>>;

export type LoadState<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly data: T };

export const DEFAULT_QUERY: TodoQuery = { filter: 'all', q: '', sort: 'createdAt', page: 1 };

export function isFilter(value: unknown): value is Filter {
  return value === 'all' || value === 'active' || value === 'done' || value === 'archived';
}
export function isSortKey(value: unknown): value is SortKey {
  return value === 'createdAt' || value === 'dueAt' || value === 'title';
}
```

`isFilter` / `isSortKey` 不是装饰：**`route.query` 的每一项类型是 `string | string[] | null`，是用户可编辑的外部输入**，必须先收窄再用，不能 `as Filter`——这就是你在 [TypeScript 阶段项目](/typescript/project)里立的「边界处校验」规矩。

**视图状态也用判别联合**（`LoadState`）：加载 / 出错 / 空 / 有数据四种画面写成一个联合，渲染层 `switch` 或 `v-if` 链按 `kind` 分支，少写一个分支类型上过不去。「白屏 3 秒」和「出错了但界面什么都没显示」这两类 bug 在写法上就出不来。

### store 的形状：每个 store 只有一个写入面

| store | state | getters | actions | 谁能写 |
| --- | --- | --- | --- | --- |
| `todos` | `items: Todo[]`、`state: LoadState<Todo[]>`、`selectedIds: Set<string>` | `byId`、`stats`；`filtered(query)` 作为方法 | `load` / `add` / `patch` / `setStatus` / `remove` / `toggleSelection` | 组件只调 action，绝不 `items.push(...)` |
| `settings` | `theme: 'light' \| 'dark' \| 'auto'` | `resolvedTheme` | `setTheme` | 只有 `SettingsView` 与 `AppHeader` |
| `auth` | `isLoggedIn: boolean`、`redirectAfterLogin: string \| null` | — | `login` / `logout` / `rememberRedirect` | 守卫读、`LoginView` 写 |

三条决定要能说出理由：**① `items` 用 `ref<Todo[]>`（深响应式）而不是 `shallowRef`**——待办项需要就地更新驱动视图，默认页只渲染 50 条，量级不需要浅化；只有走「全部」模式时才把只读快照交给窗口化列表。**② `selectedIds` 用 `Set` 且整体替换**，不把「选中」写进每条 todo（否则 UI 选择状态会被误存进 `localStorage`）。**③ 主题状态进 `settings`，但颜色值本身写进 `document.documentElement` 的 data 属性 + CSS 自定义属性**——组件里只写 `var(--surface-1)`，**分支出现在 CSS 里一次，而不是每个组件里 N 次**（[值、单位与自定义属性](/css/units-and-custom-properties)）。

### 两种持久化路径：接口只有一个

```ts
// src/services/repository.ts
import type { Todo, TodoCreateInput, TodoUpdateInput } from '@/types/model';
import { localRepository } from './localRepository';

export interface TodoRepository {
  list(): Promise<Todo[]>;
  create(input: TodoCreateInput): Promise<Todo>;
  update(id: string, patch: TodoUpdateInput): Promise<Todo>;
  remove(id: string): Promise<void>;
}

/** 全项目唯一取用仓库的地方：store 从这里拿，组件永远不碰它 */
export function getRepository(): TodoRepository {
  return localRepository;   // 换成 httpRepository 时只改这一行
}
```

`localRepository` 现在做的事：读 `localStorage` → `JSON.parse` → 交给 `validate.ts` 校验（`unknown` → `Todo[]`）→ 形状不合时**清掉坏数据并抛可读错误**；写入时带 `{ version: 1, todos }` 信封，方便将来迁移；每个方法都 `await sleep(120)` 模拟网络延迟——**这不是自虐，是为了让你在纯前端阶段就被迫处理 loading 与竞态**，否则接后端时你要同时调两件事。

之后 `httpRepository` 实现同一接口：`fetch` + `AbortSignal` + 统一错误（[fetch、同源策略与浏览器存储](/javascript/network-and-storage)、[Fastify 入门](/backend/fastify-basics)）。首页把这条写成「第一期后续所有工作的基础」，理由就在这：**接后端时改动只发生在 `services/`，store、composable、组件、测试都不动。** 做不到就是分层失败。

## 六个实施阶段

顺序不能换，每阶段只做一件事，末尾两行是硬要求。

### 阶段 ① 脚手架与路由骨架

`npm create vue@latest todo-spa`，按首页勾选：TypeScript、Vue Router、Pinia、ESLint with Vue rules、Vitest Unit testing（**不选** SSR）。装完立刻把 `npm run dev` / `build` / `type-check` / `lint` 各跑一次，确认脚手架本身是绿的再动手。

建路由：`/` → 重定向 `/todos`；`/todos`（`name: 'todo-list'`）；`/todos/:id`（`todo-detail`）；`/settings`；`/archive`（`meta: { requiresAuth: true }`）；`/:pathMatch(.*)*` → `NotFoundView`。页面组件全部 `() => import('@/views/XxxView.vue')`（[Vue Router](/vue/router)），`scrollBehavior` 让后退恢复位置、前进滚到顶。`App.vue` 只留 `AppHeader` + `<RouterView />`。同时打开 `noUncheckedIndexedAccess`，ESLint 扁平配置里把 `@typescript-eslint/no-explicit-any` 设为 `error`（「零 `any`」要靠它兜住，别只靠自觉）。

**可验证产出**：切到 `/settings` 时 Network 面板**才**出现 `SettingsView-xxx.js`；刷新 `/todos/1` 不 404（dev server 自带回退）。**自查**：把守卫里的重定向目标写成 `to.fullPath` 自身，观察无限重定向——翻车点 6 现在就见一次。

### 阶段 ② store 与类型

写 `types/model.ts`（上面一整块）、`services/` 三个文件、`stores/` 三个文件。`todos` store 用 setup store 写法（`ref` + `computed` + 函数），`items` 的类型由 `ref<Todo[]>` 决定，不需要任何断言（回指[类型推断](/typescript/inference)）。`validate.ts` 的报错要带「实际是什么」（`typeName(value)`），否则排查时只能靠猜。

**可验证产出**：Console 里 `useTodosStore().load()` 后，DevTools 的 Pinia 面板出现 `items` 与变更历史。**自查**：把 store 的 state 直接解构（`const { items } = useTodosStore()`），确认界面失去响应、而 DevTools 里值仍在变——这就是翻车点 1，改完用 `storeToRefs` 再看一次。

### 阶段 ③ 列表页与 URL 同步

本项目最难点。规则定死：**URL 是筛选状态的真相来源之一，页面状态从 URL 初始化，任何筛选变更写回 URL。** 三条同时成立：

1. **初次进入**从 `route.query` 解析出 `TodoQuery`：每个字段走 `isFilter` / `isSortKey` / `Number.isInteger` 收窄，非法值回落到 `DEFAULT_QUERY`（不报错、不白屏）。
2. **用户操作**（点筛选、输入搜索、翻页）写回 URL；筛选或排序变化时 `page` 重置为 1（否则会停在一个不存在的页码）。
3. **前进/后退、粘贴分享链接、手改地址栏** → 页面跟随 `route.query` 重新解析（`watch` 路由 query，且只在列表路由生效）。

`q` 用 `router.replace` + 防抖（约 200ms），`filter` / `sort` / `page` 用 `router.push` 不防抖。理由要写进注释：**搜索每敲一个字都往历史栈塞一条，用户得按几十次后退才能离开这个页面；而筛选切换是值得后退的语义差别。** 两个方向的 watch 会互相触发，必须有一个「正在从 URL 应用」的闸门（参考答案第 2 段）。

**可验证产出**：`/todos?filter=done&q=%E4%BC%9A%E8%AE%AE&sort=dueAt&page=2` 刷新后四项全部恢复；手改 `filter=garbage` → 回落「全部」且不报错；后退回到上一个筛选。**自查**：输入到一半刷新，URL 是否漏了最后几个字（防抖未 flush），并决定这是否可接受——参考答案里 `update()` 会先清掉待执行的定时器。

### 阶段 ④ 详情页、编辑与表单校验

`/todos/:id` 用 `byId` 取；**取不到时不要自己画一句「未找到」文案**，而是 `router.replace({ name: 'not-found' })`——首页要的是「显示 404 页面」，而且后退不该回到一个不存在的资源。404 只能有一个入口，否则模板与逻辑各有一份「未找到」就是两个真相。

表单：`TodoForm.vue` 同时服务新增与编辑，靠 `props.todo`（可空）决定初值；校验集中在 `composables/useTodoForm.ts`（标题非空且 ≤80 字、`dueAt` 合法日期、`tags` 去空去重）。错误提示挂在字段旁（`aria-describedby` + `role="alert"`，[HTML 领域](/html/)）。

补齐鉴权：`LoginView` 调 `auth.login()` 后按 URL 上的 `redirect` 回跳；守卫拦截未登录访问 `meta.requiresAuth` 并重定向到 `/login?redirect=…`。**`/login` 自身绝不带 `requiresAuth`**。

**可验证产出**：访问 `/todos/不存在` 显示 404 页；未登录访问 `/archive` → `/login?redirect=/archive`，登录后自动回到 `/archive`；编辑保存后列表里那条文本更新、`updatedAt` 变化、URL 不变。**自查**：在 `TodoForm` 里试着直接改 props（翻车点 2），看控制台警告与父级渲染把它抹回去的那一刻。

### 阶段 ⑤ 组件拆分与 composable 抽取

先写「一个大组件版本」再拆，顺序不能反——拆的判据来自[第 5–6 章](/vue/composables)那三个问题（哪个 props 其实能从别处拿到、哪个事件本该自己处理、哪个状态其实是派生值）。

本项目的结论：`TodoFilters` 收 `query`、emit `update:query`（用 `defineModel` 更短，但名字要两侧字面一致，翻车点 3）；`TodoList` 只管「拿数组 + 状态分支」；**`TodoItem` 不 import store**，它的数据全部来自 props（`todo` + `selected`），这样才可复用与单测；`useLocalStorage` / `useAsync` / `useTodoQuery` / `useTodos` 四个 composable 都过了「有状态 + 可复用」这条线，而 `formatDate` 不该在里面。

**可验证产出**：`TodoListView.vue` 降到 120 行以内、`switch` 与筛选逻辑都不在模板层；`grep -rn localStorage src` 只命中 `services/localRepository.ts` 与 `composables/useLocalStorage.ts`。**自查**：把某个 composable 的返回值在组件里解构成普通变量，界面立刻失去响应——用这个动作亲眼确认「composable 必须返回 `Ref`」这条约定。

### 阶段 ⑥ 无障碍与性能复核

**无障碍：先把鼠标拔掉做完全部操作。** 要点：筛选控件用 `<button aria-pressed>` 或真正的 tablist 语义，不要 `div @click`；搜索框有 `<label>`（可视觉隐藏）；每行的复选框 `aria-label` 带上标题文本；路由切换后焦点移到新页面主标题（`tabindex="-1"` + `focus()`）；删除有确认或撤销路径；主题切换按钮 `aria-pressed`，且状态不只靠颜色传达。配合 [JS 层面的无障碍与性能](/javascript/accessibility-and-performance)。

**性能：按[第 10 章](/vue/rendering-performance)的「测量 → 定位 → 动手」执行。** 造 1000 条数据（`services/seed.ts` 一个一次性生成函数，或 Console 里循环 `add()`）。**默认策略是分页，一次只渲染 50 行；「查看全部」模式切到窗口化列表**（固定行高 48px、缓冲区 5 行）。首页要求「说明你采取的方案及理由」，README 那一段的模板是：**数据量上限 → 所选方案 → 为什么不是另一条 → 实测前后对比数字**。

测量动作：勾选第 3 项时用 `onBeforeUpdate` 计数或 DevTools 高亮，确认只有受影响项更新；Performance 面板录一次「连续输入搜索词 3 秒」，看有没有 >50ms 的长任务；`performance.mark` 夹住一次列表更新，把前后数字记进 README。**别在这一步加 `v-memo`**——先确认「每项只依赖自己是否选中」这个结构性修法有没有做完。

**可验证产出**：1000 条下滚动流畅、勾选不卡；键盘完成「新增 → 筛选 → 进详情 → 改标题 → 返回 → 删除」全链路；README 有一段带数字的性能说明。**自查**：把 `:key` 改成 `index`，勾选与删除立刻串位（翻车点 5），改回来并在 README 记一句为什么不能用 index。

## 验收清单

- [ ] `npm run lint`、`npm run test:unit`、`npm run type-check`、`npm run build` 四条命令**零错误零警告**（首页验收第 1 条）。
- [ ] `grep -rn "export default {" src --include=*.vue` 为空；搜不到 `data()` / `methods:` / `mixins` → 零选项式写法。
- [ ] **零 `any`**：`grep -rnw any src` 只命中注释；`@ts-ignore` / `@ts-expect-error` 0 次；`as ` 只出现在边界与 `as const`。
- [ ] **URL 刷新不丢筛选**：`/todos?filter=active&q=会议&sort=dueAt&page=3` 刷新后四项完整恢复；非法值回落默认；后退能回到上一个筛选。
- [ ] **键盘可完整操作**：拔掉鼠标完成新增、筛选、搜索、进详情、编辑、删除、主题切换、登录拦截与回跳；路由切换后焦点可感知地移动。
- [ ] 不存在的 ID 显示 404 页面（不是空白、不是控制台异常）；catch-all 路由生效。
- [ ] `/archive` 未登录被拦下并重定向到 `/login?redirect=/archive`，登录后回跳原页；`/login` 不带 `requiresAuth`。
- [ ] 组件 ≥ 3、composable ≥ 2（本项目实际 4 个），且 `src/components/` 里没有任何组件 import store。
- [ ] 每个 `views/*.vue` 与 `components/*.vue` ≤ 200 行（`wc -l` 自查）；DevTools 组件树层次与目录一致。
- [ ] 数据层只有一个取用点：`grep -rn "localStorage" src` 命中 ≤ 2 个文件；把 `getRepository()` 换成 `httpRepository` 后，除 `services/` 外无文件需要改动。
- [ ] 修改任意一条待办，只有受影响部分重新渲染（`onBeforeUpdate` 计数或 highlight updates 的证据附在 README）。
- [ ] 1000 条模拟数据不卡死，README 写明方案、理由与实测前后数字。
- [ ] 主题切换只靠 CSS 自定义属性，组件里没有 `theme === 'dark'` 分支；刷新后主题保持。
- [ ] 你能指着代码回答三问（首页最后一条，也是最容易挂的一条）：**这份状态存在哪里、谁是它的唯一写入者、视图是怎么知道它变了的。**

## 常见翻车点

**1）解构 store 丢了响应性。** 现象：`const { items } = useTodosStore()` 之后 `add()` 界面不动，但 DevTools 里 store 的值确实变了。原因：解构拿到的是当时的值快照，`ref` 的 getter 链路断了（[响应式原理](/vue/reactivity)断链清单第 1 条）。怎么确认：`isRef(items)` 为 `false`；操作后 `items.length` 不变。怎么修：**状态用 `storeToRefs(store)` 解构，动作直接从 store 上调**——`const { items, state } = storeToRefs(todosStore); const { add } = todosStore;`。`storeToRefs` 也带上 getters，但**函数不能经它拿**，这是新手最常见的第二次困惑。

**2）把 props 当本地状态改。** 现象：控制台 «Avoid mutating a prop directly»，或界面短暂对了、下一次父级渲染又抹回去。原因：props 是单向数据流的下行值，就地改破坏了父级所有权（[组件基础](/vue/components)）。怎么确认：`git diff` 里搜 `props.` 后跟 `=`。怎么修：① 编辑**副本**（`const draft = ref(clone(props.todo))`），提交时 emit；② 需要双向就用 `defineModel` 或 `v-model:字段`；③ 该数据本就该由 store 持有（主题、登录态），那就搬进 store。

**3）`v-model` 名字对不上。** 现象：父写 `v-model:title="form.title"`，子组件 `defineModel<string>()` 无参 → 双向都不跟、而且**不报错**。原因：无参 `defineModel` 绑的是 `modelValue`，具名双向绑定两侧必须字面一致。同族故障还有 Vue 2 习惯（`:value` + `@input`，或以为组件上的 `v-model` 等价于 `value` prop）。怎么确认：DevTools 里看子组件 props 到底有没有 `title`。怎么修：`defineModel<string>('title')`，并确认 `vue` ≥ 3.4（版本线见[单文件组件与构建链](/vue/sfc-and-build)）。

**4）`deep` 侦听巨型对象导致卡顿。** 现象：状态一多整体变慢，火焰图里大片时间在遍历而不是渲染。原因：`watch(() => store.$state, …, { deep: true })` 或给 1000 条数组加 `deep`，每次写入都要遍历整个对象图，把[响应式原理](/vue/reactivity)想省的开销又加回来。怎么确认：去掉 `deep` 立刻变快（或不再触发，说明依赖写错了）。怎么修：侦听精确 getter（`() => store.items.length`）、侦听某个 id、**把持久化写进 action 末尾而不是让消费方偷偷侦听**（本项目最合理的一条）。`immediate` / 清理 / 竞态见[计算属性与侦听器](/vue/computed-and-watch)。

**5）用 `index` 当 key，勾选串位。** 现象：中间删除一项后，第 N 项的勾选跑到别的待办上；切换筛选后复选框状态错乱。原因：`:key="i"` 让 Vue 按位置就地复用 DOM 与实例，`Set` 里的身份与界面行不再一一对应。怎么确认：删一项后看勾选是否跟着数据走（正确）还是留在位置（错误）。怎么修：`:key="todo.id"`，且 **id 必须是业务身份**——不要每次渲染 `Math.random()`，也不要用标题当 key（可重复）。这条在窗口化列表里更是前提：滚出去的行被销毁后，只有 id 能把状态对回来。

**6）路由守卫无限重定向。** 现象：浏览器报 `Detected an infinite redirection in a navigation guard`，或地址栏在 `/login` 与 `/archive` 之间抖。原因三选一：① `/login` 自己带了 `requiresAuth`；② 重定向目标写成 `to.fullPath` 自身；③ 对「已登录访问 `/login`」无条件再跳 `/login`。怎么确认：守卫第一行 `console.log(to.fullPath)`，看两条路径交替。怎么修：只让受保护路由带 `meta.requiresAuth`，重定向到 `{ name: 'login', query: { redirect: to.fullPath } }`，其余一律 `return true`。

**7）「scoped 不生效」其实是父级覆盖。** 现象：子组件根元素的边框/内距诡异变了；DevTools 里两条规则同时命中，靠后的赢。原因：这是 `scoped` 的**设计行为**——子组件根节点同时带父与自己的 `data-v`，父级规则可以合法命中它；再叠上特异度（`.page .card` 强于 `.card`）就出现「我明明 scoped 了」。怎么确认：看已匹配规则各自带的 `[data-v-...]`；注释掉父级那条，界面是否恢复。怎么修：**把「外部尺寸」显式化**——给子组件传 `size` prop 或让它读父级设的 CSS 自定义属性（`--card-gap`），而不是靠父级选择器打它的根节点；真要覆盖深层节点才用 `:deep()`，且必须包在自己的块作用域里。

**8）`onMounted` 里请求竞态。** 现象：详情页从 A 快速切到 B，标题先显示 B 又变回 A；列表连续改筛选时旧请求后到覆盖了新结果；组件已卸载后回调还在写状态。原因：`onMounted` 只保证「发起」，不保证「按发起顺序返回」。怎么确认：在回调里 `console.log(id)` 观察顺序倒置；Network 面板看两个请求谁后完成。怎么修：① **侦听 `id` 而不是只在 `onMounted` 拉一次**（`watch(() => route.params.id, run, { immediate: true })`）；② 代号比较（只接受最后一次发起的结果）；③ `AbortSignal` + 卸载时 `abort()`。三者收进 `useAsync`（参考答案第 5 段）。另外记住[生命周期](/vue/lifecycle-and-inject)那条：**钩子必须在 setup 顶层同步注册**，`await` 之后再注册 `onUnmounted` 会静默失效，于是清理逻辑永远不执行。

**9）持久化把 UI 状态也存了。** 现象：下次打开有一半项目是选中态。原因：把整个 store `$state` 无脑序列化。怎么修：只存业务数据与真正的用户设置，存之前加 `version` 信封，持久化调用只在 action 末尾一处。

**10）Pinia 在组件外使用。** 现象：在 `services/` 或守卫里调 store 报「getActivePinia() was called but there was no active Pinia」。原因：`createPinia()` 还没 `app.use()` 就取 store（模块顶层那句 `const store = useXStore()` 是最常见形态）。怎么修：改成函数内取用。这条属于 [Pinia](/vue/pinia) 的「在组件外使用 store」。

## 参考答案要点

<Exercise title="参考答案要点 · 关键实现" difficulty="挑战">

下面是本项目五处最容易卡住的关键实现：`todos` store、URL 同步的 composable、列表页与详情页模板、路由守卫、`useAsync` 的竞态处理。**请先自己写完再对照差异**——写在你项目里时文件名与细节会不同。再次声明：本章代码未在本机运行，每段末尾给的是「预期结果与验证路径」。

<template #answer>

### 1）`stores/todos.ts`（setup store，唯一写入者）

```ts
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { LoadState, Todo, TodoCreateInput, TodoQuery, TodoStatus, TodoUpdateInput } from '@/types/model';
import { getRepository } from '@/services/repository';

export const useTodosStore = defineStore('todos', () => {
  const items = ref<Todo[]>([]);
  const state = ref<LoadState<Todo[]>>({ kind: 'idle' });
  const selectedIds = ref<Set<string>>(new Set());

  const byId = computed(() => new Map(items.value.map((todo) => [todo.id, todo])));
  const stats = computed(() => ({
    total: items.value.length,
    active: items.value.filter((t) => t.status === 'active').length,
    done: items.value.filter((t) => t.status === 'done').length,
  }));

  function filtered(query: Pick<TodoQuery, 'filter' | 'q' | 'sort'>): Todo[] {
    const needle = query.q.trim().toLowerCase();
    const rows = items.value.filter((todo) => {
      const hitStatus = query.filter === 'all' || todo.status === query.filter;
      const hitText =
        needle === '' ||
        todo.title.toLowerCase().includes(needle) ||
        todo.note.toLowerCase().includes(needle) ||
        todo.tags.some((tag) => tag.toLowerCase().includes(needle));
      return hitStatus && hitText;
    });
    const direction = query.sort === 'title' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (query.sort === 'title') return direction * a.title.localeCompare(b.title, 'zh');
      const left = a[query.sort];
      const right = b[query.sort];
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return direction * (left > right ? 1 : left < right ? -1 : 0);
    });
  }

  async function load(): Promise<void> {
    state.value = { kind: 'loading' };
    try {
      const rows = await getRepository().list();
      items.value = rows;
      state.value = { kind: 'ready', data: rows };
    } catch (error) {
      state.value = { kind: 'error', message: describe(error) };
    }
  }

  async function add(input: TodoCreateInput): Promise<Todo> {
    const created = await getRepository().create(input);
    items.value = [...items.value, created];
    return created;
  }

  async function patch(id: string, input: TodoUpdateInput): Promise<void> {
    items.value = items.value.map((todo) => (todo.id === id ? { ...todo, ...input } : todo));
    await getRepository().update(id, input);          // 先改内存再落盘：界面不等网络
  }

  async function setStatus(id: string, status: TodoStatus): Promise<void> {
    const target = byId.value.get(id);
    if (!target || target.status === status) return;
    // status 被 TodoUpdateInput 排除，所以状态迁移只有这一条路（延续 TS 项目的约束）
    items.value = items.value.map((todo) =>
      todo.id === id ? { ...todo, status, updatedAt: Date.now() } : todo);
    await getRepository().update(id, {});
  }

  async function remove(id: string): Promise<void> {
    items.value = items.value.filter((todo) => todo.id !== id);
    toggleSelection(id, false);
    await getRepository().remove(id);
  }

  function toggleSelection(id: string, on = !selectedIds.value.has(id)): void {
    const next = new Set(selectedIds.value);   // Set 就地改不会触发视图更新
    if (on) next.add(id); else next.delete(id);
    selectedIds.value = next;
  }

  return { items, state, selectedIds, byId, stats, filtered, load, add, patch, setStatus, remove, toggleSelection };
});

function describe(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误';
}
```

**预期结果**：DevTools 的 Pinia 面板能看到三次变更（`state` → `items` → `state`）；`load()` 期间 `state.kind === 'loading'`。**验证路径**：Vitest 里 `setActivePinia(createPinia())` 起 store，用 `vi.mock` 把 `getRepository` 换成可编程的假仓库，断言「仓库 reject 时 `state.kind === 'error'` 且 `message` 可读」「`setStatus` 相同状态时不发请求」。

**首页最后一条验收的三个答案**：状态在 `items`（`ref<Todo[]>`）；唯一写入者是 `add` / `patch` / `setStatus` / `remove` 四个 action；视图靠 `ref` 的依赖收集知道它变了——组件模板读过 `todosStore.items`，写 `items.value` 就触发渲染 effect（[响应式原理](/vue/reactivity)）。

一处值得你改进：`setStatus` / `remove` 里「先改内存再落盘」带来乐观更新，但落盘失败时界面已经变了。要么加回滚（失败时重新 `load()`），要么给仓库加 `setStatus(id, status)` 让落盘先行。**README 里写下你选了哪种以及为什么**，这比代码本身更能证明你懂分层。

### 2）`composables/useTodoQuery.ts`（URL ↔ 筛选双向同步）

```ts
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DEFAULT_QUERY, isFilter, isSortKey, type TodoQuery } from '@/types/model';

/** route.query 每一项都可能是 string | string[] | null：全部当外部输入处理 */
function first(value: unknown): string | null {
  if (typeof value === 'string') return value;
  const head = Array.isArray(value) ? value[0] : null;
  return typeof head === 'string' ? head : null;
}

function parse(raw: Record<string, unknown>): TodoQuery {
  const filter = first(raw['filter']);
  const sort = first(raw['sort']);
  const page = Number(first(raw['page']));
  return {
    filter: isFilter(filter) ? filter : DEFAULT_QUERY.filter,
    q: first(raw['q']) ?? '',
    sort: isSortKey(sort) ? sort : DEFAULT_QUERY.sort,
    page: Number.isInteger(page) && page > 0 ? page : DEFAULT_QUERY.page,
  };
}

function serialize(query: TodoQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (query.filter !== DEFAULT_QUERY.filter) out['filter'] = query.filter;
  if (query.q !== DEFAULT_QUERY.q) out['q'] = query.q;
  if (query.sort !== DEFAULT_QUERY.sort) out['sort'] = query.sort;
  if (query.page !== DEFAULT_QUERY.page) out['page'] = String(query.page);
  return out;                       // 默认值不进 URL：地址栏保持干净
}

export function useTodoQuery() {
  const route = useRoute();
  const router = useRouter();
  const local = ref<TodoQuery>(parse(route.query));
  let applyingFromUrl = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const same = (a: TodoQuery, b: TodoQuery): boolean => JSON.stringify(a) === JSON.stringify(b);

  // URL → 本地（后退、粘贴分享链接、手改地址栏）
  watch(() => route.query, (raw) => {
    if (route.name !== 'todo-list') return;
    const next = parse(raw);
    if (same(next, local.value)) return;
    applyingFromUrl = true;
    local.value = next;
    queueMicrotask(() => { applyingFromUrl = false; });
  });

  // 本地 → URL
  watch(local, (next, prev) => {
    if (applyingFromUrl) return;
    const searching = next.q !== prev.q;
    const structural = next.filter !== prev.filter || next.sort !== prev.sort;
    const target = { name: 'todo-list' as const, query: serialize(structural ? { ...next, page: 1 } : next) };
    if (timer) { clearTimeout(timer); timer = null; }
    if (searching) timer = setTimeout(() => { timer = null; void router.replace(target); }, 200);
    else void router.push(target);            // 筛选与翻页值得进历史栈
  }, { deep: true });

  function update(patch: Partial<TodoQuery>): void {
    if (timer) { clearTimeout(timer); timer = null; }   // 提交前 flush，防丢字
    local.value = { ...local.value, ...patch };
  }

  return { query: computed(() => local.value), update };
}
```

四个设计点：**①`applyingFromUrl` 是防「URL→本地→URL」死循环的唯一手段**，两个方向的 watch 必然互相触发；`queueMicrotask` 是因为这一轮两个 watch 在同一批 effect 里跑完。②**筛选或排序变化时把 `page` 重置为 1**，否则会停在越界页码上。③`deep: true` 只加在这个 4 字段小对象上，成本可忽略——这和翻车点 4 那个「deep 侦听 1000 条」是两件事，你要能分开说清。④ 默认值不写进 URL，`/todos` 与 `/todos?filter=all&q=&page=1` 才是同一个页面（否则后退栈会被等价 URL 塞满）。

**预期结果与验证路径**：单测三个用例——非法 `filter=garbage` 解析成 `'all'`；`update({ filter: 'done' })` 走 `push`；`update({ q: 'a' })` 连打两次只产生一次 `replace`。手动验证就是阶段 ③ 那条可验证产出。

### 3）列表页与详情页的关键模板

```vue
<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useTodosStore } from '@/stores/todos';
import { useTodoQuery } from '@/composables/useTodoQuery';
import TodoFilters from '@/components/TodoFilters.vue';
import TodoList from '@/components/TodoList.vue';

const todosStore = useTodosStore();
const { state, selectedIds } = storeToRefs(todosStore);   // 状态：storeToRefs
const { toggleSelection, filtered } = todosStore;         // 动作：直接取

const { query, update } = useTodoQuery();
const rows = computed(() => filtered(query.value));
const PAGE_SIZE = 50;
const paged = computed(() => {
  const start = (query.value.page - 1) * PAGE_SIZE;
  return rows.value.slice(start, start + PAGE_SIZE);
});
const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)));
</script>

<template>
  <section class="page" aria-labelledby="list-heading">
    <h1 id="list-heading" tabindex="-1">待办</h1>
    <TodoFilters :query="query" @update:query="update($event)" />

    <p v-if="state.kind === 'loading'" role="status">正在读取待办……</p>
    <p v-else-if="state.kind === 'error'" role="alert">{{ state.message }}</p>
    <p v-else-if="rows.length === 0" class="empty">没有符合条件的项目。</p>
    <TodoList
      v-else
      :todos="paged"
      :selected-ids="selectedIds"
      @toggle="toggleSelection($event)"
    />

    <nav v-if="pageCount > 1" aria-label="分页">
      <button
        v-for="page in pageCount"
        :key="page"
        :aria-current="page === query.page ? 'page' : undefined"
        @click="update({ page })"
      >
        {{ page }}
      </button>
    </nav>
  </section>
</template>
```

`state.kind` 的四条分支写成**一条 `v-if` 链**而不是四个互不相干的 `v-if`：判别联合在这里的作用和 TS 项目里的 `render(view)` 一样——`state.message` 只能在 `error` 分支被访问，少写分支类型上过不去。`TodoList` 内部每行 `:key="todo.id"`、`:selected="selectedIds.has(todo.id)"`（第 10 章那条「每项只依赖自己是否选中」）。

```vue
<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useTodosStore } from '@/stores/todos';
import { useAsync } from '@/composables/useAsync';
import TodoForm from '@/components/TodoForm.vue';

const route = useRoute();
const router = useRouter();
const todosStore = useTodosStore();
const { byId } = storeToRefs(todosStore);

const id = computed<string>(() => {
  const raw = Array.isArray(route.params['id']) ? route.params['id'][0] : route.params['id'];
  return typeof raw === 'string' ? raw : '';
});
const local = computed(() => byId.value.get(id.value));

// 刷新直接进详情页时列表还没加载：按 id 拉一次，竞态交给 useAsync
const { state: remote, run } = useAsync((signal) => todosStore.loadById(id.value, signal));
watch(id, (value) => { if (value) void run(); }, { immediate: true });

const missing = computed(() => local.value === undefined && remote.value.kind === 'ready');
watch(missing, (gone) => { if (gone) void router.replace({ name: 'not-found' }); }, { immediate: true });
</script>

<template>
  <section class="page" aria-labelledby="detail-heading">
    <p v-if="remote.kind === 'loading'" role="status">正在读取……</p>
    <p v-else-if="remote.kind === 'error'" role="alert">{{ remote.message }}</p>
    <template v-else-if="local">
      <h1 id="detail-heading" tabindex="-1">{{ local.title }}</h1>
      <dl>
        <dt>状态</dt><dd>{{ local.status }}</dd>
        <dt>截止</dt><dd>{{ local.dueAt ?? '无' }}</dd>
        <dt>更新</dt><dd>{{ formatTimestamp(local.updatedAt) }}</dd>
      </dl>
      <TodoForm :todo="local" @submit="todosStore.patch(local.id, $event)" />
    </template>
  </section>
</template>
```

`route.params['id']` 的类型是 `string | string[] | null`，先收窄再用而不是 `as string`。**404 的处理是替换路由而不是画一段文案**——后退不该回到一个不存在的资源，且「未找到」必须只有一个入口（`watch(missing)` 是唯一的那个）。注意这里需要 store 提供一个 `loadById(id, signal)`（把 `getRepository` 换成按 id 取；纯本地阶段可以先 `load()` 后判空——**两种都要能解释，别混着用**）。

### 4）路由守卫

```ts
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: { name: 'todo-list' } },
  { path: '/todos', name: 'todo-list', component: () => import('@/views/TodoListView.vue') },
  { path: '/todos/:id', name: 'todo-detail', component: () => import('@/views/TodoDetailView.vue') },
  { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
  {
    path: '/archive', name: 'archive',
    component: () => import('@/views/ArchiveView.vue'),
    meta: { requiresAuth: true },
  },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

router.beforeEach((to) => {
  const auth = useAuthStore();            // 守卫在运行时执行，此时 pinia 已安装
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } };   // login 不在这一分支里
  }
  return true;                            // 其余一律放行，绝不返回 to 自身
});
```

`login` 路由**没有** `meta.requiresAuth`，这是翻车点 6 的根治处。`LoginView` 成功后 `router.replace(route.query['redirect'] ?? { name: 'todo-list' })`——**回跳用 `replace`**，否则用户后退会退回登录页；`redirect` 的值要先按 `string` 收窄再用（它是外部输入）。`scrollBehavior` 返回 `saved ?? { top: 0 }` 让后退恢复位置、前进回到顶部，这是[首页验收「刷新任意页面，URL 对应的状态完整恢复」](/vue/)里最容易被忘的一半。

### 5）`useAsync`：把竞态、取消与清理收进一个 composable

```ts
import { onScopeDispose, ref } from 'vue';
import type { LoadState } from '@/types/model';

export type AsyncRunner<T> = (signal: AbortSignal) => Promise<T>;

export function useAsync<T>(runner: AsyncRunner<T>) {
  const state = ref<LoadState<T>>({ kind: 'idle' });
  let latest = 0;                        // 代号：只接受最后一次发起的结果
  let controller: AbortController | null = null;

  async function run(): Promise<T | undefined> {
    controller?.abort();                 // 取消上一次在途请求
    const token = ++latest;
    controller = new AbortController();
    const signal = controller.signal;
    state.value = { kind: 'loading' };
    try {
      const data = await runner(signal);
      if (token !== latest || signal.aborted) return undefined;   // 过期结果直接丢弃
      state.value = { kind: 'ready', data };
      return data;
    } catch (error) {
      if (token !== latest) return undefined;
      state.value = {
        kind: 'error',
        message: error instanceof Error ? error.message : '发生未知错误',
      };
      return undefined;
    }
  }

  onScopeDispose(() => {                 // 组件卸载时既取消、也停止写状态
    latest += 1;
    controller?.abort();
    controller = null;
  });

  return { state, run };
}
```

三道闸门各挡一种竞态：`AbortController` 挡「在途请求继续消耗、回调还在跑」；`token !== latest` 挡「先发的请求后到」——**网络乱序时 abort 挡不住已经 resolve 的 Promise 链，所以代号这一步不能省**；`onScopeDispose` 挡「组件已销毁但回调仍写状态」。用 `onScopeDispose` 而不是 `onUnmounted`，是为了让这个 composable 也能在 store 里用（[组合式函数](/vue/composables)的清理约定）。返回值是 `Ref`，所以调用方必须 `storeToRefs` 风格的解构或直接 `state.value`（翻车点 1 在这里同样成立）。

**预期结果与验证路径**：详情页在 `/todos/1` 与 `/todos/2` 之间来回，标题不会闪回旧值；DevTools Network 限速到 Slow 3G 后快速切换，被取消的请求状态显示 `canceled`。单测：让假仓库按「第二次先返回、第一次后返回」的顺序 resolve，断言最终 `state.kind === 'ready'` 且 `state.data` 是第二次的数据。**这一步是本项目里唯一能证明「你真的处理了竞态」的动作，别跳过。**

</template>

</Exercise>

## 官方文档与延伸阅读

- [Vue 领域首页的「阶段项目」一节](/vue/) —— 本章条款来源；技术要求、页面结构、架构要求、验收标准以该节为准，本章只展开不改范围。
- [create-vue](https://github.com/vuejs/create-vue) 与 [工具链](https://cn.vuejs.org/guide/scaling-up/tooling.html) —— 核实脚手架当前提供的特性开关名称（TypeScript / Vue Router / Pinia / ESLint / Vitest），勾选名称随版本变化。
- [SFC `<script setup>` API](https://cn.vuejs.org/api/sfc-script-setup.html) —— 核实 `defineModel`（3.4+）、`defineOptions` / `defineSlots`（3.3+）与 `generic`（需 `lang="ts"`）的版本线（2026-10-17 核实）。
- [导航守卫](https://router.vuejs.org/zh/guide/advances/navigation-guards.html) 与 [Vue Router 指南](https://router.vuejs.org/zh/guide/) —— 核实 `beforeEach` 的返回式写法（返回 Location 即重定向）、`scrollBehavior`、以及无限重定向的官方警告。
- [Pinia 核心概念](https://pinia.vuejs.org/zh/core-concepts/) 与 [在组件外使用 store](https://pinia.vuejs.org/zh/core-concepts/outside-component-usage.html) —— 核实 `storeToRefs` 只带 state 与 getters（不含 actions），以及「`app.use(pinia)` 之前调用 `useStore()`」的报错形态（翻车点 10）。
- [性能建议](https://cn.vuejs.org/guide/best-practices/performance.html) 与 [渲染机制](https://cn.vuejs.org/guide/extras/rendering-mechanism.html) —— 阶段 ⑥ 的方案依据（虚拟化、大型不可变结构、props 稳定性）。
- [无障碍](https://cn.vuejs.org/guide/best-practices/accessibility.html)、[SFC CSS 特性](https://cn.vuejs.org/api/sfc-css-features.html) —— 阶段 ⑥ 的清单与主题切换的 scoped 边界。
- MDN：[`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)、[`performance.mark`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceMark)、[Long Tasks API](https://developer.mozilla.org/en-US/docs/Web/API/Long_Tasks_API)、[WAI-ARIA `aria-pressed` / `role="alert"`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA)。

## 下一章

这个项目把[Vue 前 11 章](/vue/)用全了：响应式与断链（[第 2 章](/vue/reactivity)）决定 store 怎么暴露状态，`key` 与就地复用（[第 3 章](/vue/template-syntax)）决定勾选会不会串位，`computed` 与 `watch` 的分工（[第 4 章](/vue/computed-and-watch)）决定持久化写在 action 还是藏在侦听器里，组件接口与 composable 抽取（[第 5–7 章](/vue/components)）决定 `TodoItem` 能不能被单测，Router 与 Pinia（[第 8–9 章](/vue/router)）决定守卫与 URL 同步，性能与构建链（[第 10–11 章](/vue/rendering-performance)）决定阶段 ⑥ 的复核方式。

下一步进[前端工程化](/frontend-engineering/)领域：它的阶段项目[工程化体检](/frontend-engineering/project)会给这个待办应用做依赖审计、构建产物分析、代码分割与体积预算、测试覆盖补齐和性能加固——你现在留下的 `dist/` 产物、`package.json` 的 scripts 与那份带数字的 README，正是它的输入。之后这个项目还会被 [后端开发](/backend/) 接上 Fastify（只改 `services/`）、被 [数据库](/database/) 落进真实数据层、被 [部署上线](/devops/deploy-to-vps) 推到 VPS——而本章唯一那条硬性架构要求「数据层用可替换的适配函数隔离」，就是为了让这三步都不用回头改界面。
