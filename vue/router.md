# Vue Router：URL 是状态，history 模式要服务器配合

待办应用里有「列表」「详情」「设置」三块内容，你用 `v-if` 切换，靠一个 `currentView` 变量决定显示哪块。跑起来没问题，直到用户在详情页刷新浏览器——回到列表，参数全丢；点后退键界面纹丝不动；把链接发给同事，同事打开还是列表页。

三个症状对应同一件事：**你的界面状态没有和 URL 建立关系。** 地址栏是唯一能被复制、收藏、后退、刷新的状态载体，而 `currentView` 只活在内存里。Vue Router 托管的就是这层关系：URL → 组件（匹配、渲染），操作 → URL（导航、写查询参数），以及在「导航将要发生」这一刻插入的钩子——权限控制正是在那里做的。

代价要提前说清：**history 模式（`createWebHistory`）需要服务器配合。** 它产出的 URL 长得像真实路径（`/user/42`），但服务器上并不存在这个文件，直接访问就 404。本站配置里 `cleanUrls: false`（产物保留 `.html`、不依赖 rewrite），这条约束和 SPA 的 history 模式是同一道题的两个侧面，第四节展开。

## hash 与 history：差在「路径是否发给服务器」

| | `createWebHistory` | `createWebHashHistory` |
| --- | --- | --- |
| URL 形态 | `/user/42` | `/#/user/42` |
| 刷新时向服务器请求什么 | `/user/42`（不存在，需 rewrite 兜回 index.html） | `/` 或 `/index.html`（`#` 后内容**从不发出**） |
| 服务器要求 | 必须有 catch-all 回退 | 无 |
| 观感 / SEO / 与页内锚点共存 | 好 | 一般，且与 `#section` 抢位置 |

官方口径很直接：history 模式「必须配置后端路由重写，否则用户直接访问会看到 404 错误」；hash 模式因为 `#` 后内容不发给服务器，「不需要服务器做任何特殊处理」（核实时间 2026 年 10 月）。

## 安装与最小配置

`npm create vue@latest` 勾选 Router 最省事；已有项目 `npm install vue-router@4`。本站口径是 **Vue Router 4**（对应 Vue 3；Vue 2 用 3.x，写法差异很大，别照抄旧教程），具体小版本以 [router.vuejs.org](https://router.vuejs.org/) 当前版本为准。

```ts
// src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/about', name: 'about', component: () => import('../views/AboutView.vue') },
  ],
})

export default router
```

```ts
// src/main.ts
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(router)          // 必须先 use 再 mount
app.mount('#app')
```

```vue
<script setup lang="ts">
// App.vue
</script>

<template>
  <nav>
    <RouterLink to="/">首页</RouterLink>
    <RouterLink to="/about">关于</RouterLink>
  </nav>
  <RouterView />
</template>
```

`<RouterView>` 是渲染出口。`<RouterLink>` 渲染成真正的 `<a>`：能右键新标签打开、能复制地址、能被键盘 Tab 到——这是它比 `<button @click="push">` 重要的无障碍原因（见 [无障碍](/html/accessibility)）。它还负责给当前链接加类名与 `aria-current`：

| 属性 | 作用 |
| --- | --- |
| `active-class` | 该链接所属路由被匹配时追加的类（父路由匹配上就算 active） |
| `exact-active-class` | 路径完全相等时追加的类（做「高亮当前项」通常要的是这个） |
| `aria-current` 相关 prop | 输出 `aria-current`，默认值 `page`，读屏软件会播报「当前页」——纯 CSS 类名做不到这件事 |

<Callout type="unverified" title="RouterLink 默认类名我没能核实">

上表的两个 prop 名与 `aria-current` 默认值 `page` 来自官方 API 参考（已核实）。但**「不设置时默认追加的类名具体是什么」这条我没在本次核实的页面里拿到确认**——需要时渲染一个链接用 DevTools 看实际类名，别照抄记忆里的名字写 CSS。

</Callout>

## history 模式与静态部署：与本站 cleanUrls 约束同源

`createWebHistory` 下的 `/user/42` 需要服务器兜回 `index.html`。官方给的 nginx 写法：

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

Apache 用 `mod_rewrite`：`RewriteRule . index.html [L]`；IIS 用 URL Rewrite 模块；Vercel / Netlify 一类平台在配置文件里声明一条 SPA 重写规则（字段名以其文档为准，本章未逐个核实）。

**纯静态托管（只能上传文件的平台）没有 rewrite 能力**，社区通行的兜底是「`404.html` 回退页 + 脚本把路径搬进查询参数再跳 `index.html`」，它依赖平台把 404 状态也指向你的文件，且脚本要自己维护——**本任务未在部署环境实测**，落地前先 `curl -I https://site/user/42` 看返回的是谁的 404 页。

本站是 VitePress 文档站，`cleanUrls: false`：每个页面都有真实的 `xxx.html` 文件，链接也带后缀，因此**不需要任何 rewrite**，「刷新 / 直接访问 / 复制链接」在无配置的环境里都成立；代价是 URL 不够干净。所以：你部署本站时如果换成 SPA + history 模式，就必须自己补 rewrite，或退回 `createWebHashHistory()`。另外，应用放在子目录（`https://site/vue-demo/`）时 `createWebHistory(import.meta.env.BASE_URL)` 要传基础路径，且必须与 Vite 的 `base` 一致。

## 动态路由、嵌套路由与布局组件

```ts
const routes = [
  { path: '/user/:id', name: 'user', component: UserView, props: true },
  {
    path: '/dashboard',
    component: DashboardLayout,          // 内部再放一个 RouterView
    children: [
      { path: '', component: OverviewView },          // /dashboard
      { path: 'stats', component: StatsView },        // /dashboard/stats
    ],
  },
]
```

`/user/42` 时 `route.params.id === '42'`——**永远是字符串**，比较数字前先转。`props: true` 把参数作为 prop 传进组件，比在组件里读 `useRoute()` 更好测、依赖更明显（第 5 章）。参数默认非贪婪、不含 `/`：`:id` 匹配不到 `/user/a/b`，需要多段用 `:path*`（零或多）或 `:path+`（至少一）。

子路径**不要以 `/` 开头**（`/stats` 会变成绝对路径、脱离父级）。`path: ''` 是默认子路由，也可写 `{ path: '', redirect: { name: 'overview' } }`。布局复用的另外两种写法：`components: { default: A, sidebar: B }` 具名视图配 `<RouterView name="sidebar" />`；以及把跨所有页面共享的布局直接写在 `App.vue`。规则：**全应用共享放 App.vue，一组页面共享放父路由组件。**

## useRoute 是响应式对象，不能解构

```ts
const route = useRoute()
// const { params, query } = useRoute()   // 错：拿到的是快照，路由再变也不更新
```

`useRoute()` 返回当前路由的**响应式单例**，解构等于在第 2 章讲过的「解构丢响应式」上再踩一次。同类错误还有 `const id = route.params.id` 之后用它做逻辑（只在 setup 那一刻求值）。要「参数变了就重新请求」：`watch(() => route.params.id, ...)`，或 `<RouterView :key="route.fullPath" />` 强制重建组件，或用 `onBeforeRouteUpdate`。`useRouter()` 才是导航实例（`push` / `replace` / `back`），`route` 上没有导航方法。

## 查询参数与「URL 即状态」

`/todos?filter=done&q=会议` 里的 `query` 是最天然的筛选容器：刷新不丢、后退能撤销上一个筛选、链接可分享。正确方向只有一个——**URL 是唯一事实源，筛选值从 `route.query` 派生。**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const ALLOWED = ['all', 'active', 'done']

// query 值的类型是 string | string[] | null，一律先归一化再白名单校验
const filter = computed(() => {
  const raw = String(route.query.filter ?? 'all')
  return ALLOWED.includes(raw) ? raw : 'all'
})

async function setFilter(next: string) {
  if (next === filter.value) return                  // 关键：值相同就不写，防死循环
  await router.push({ query: { ...route.query, filter: next } })
}
</script>
```

三条必须遵守：① 别假设 URL 合法，用户能把它改成任何东西；② 写 query 用 `router.push`（能后退撤销）或 `replace`（不产生历史），别手改 `window.location.search`；③ **不要写「监听 query 再写 query」的双向同步**——写入触发路由变化、变化触发 watch、再写入，几乎必然死循环或产生重复历史项；「值相同就 return」只是最小防线，更稳的是从根上不建反向 watch，只留「用户操作 → push」这一条单向边。

URL 适合放：筛选、排序、页码、标签页索引、搜索词、展开的树节点 id。不适合放：大对象（长度限制、编码难看）、敏感信息（进浏览器历史、服务器访问日志、`Referer`）、逐字符变化的中间值（应防抖或只在提交时写）。

## 编程式导航与它返回的 Promise

```ts
await router.push('/user/42')
await router.push({ name: 'user', params: { id: '42' } })
await router.push({ path: '/todos', query: { filter: 'done' } })
await router.replace({ query: { ...route.query, page: '1' } })
router.back()            // 等价 go(-1)；无历史时无效也不报错
```

`push` / `replace` 返回 Promise，**导航失败时是 resolve 出一个 failure 对象而不是 reject**（重复导航 `duplicated`、被守卫中断 `aborted`、被后续导航覆盖 `cancelled`、无匹配记录等）：

```ts
const failure = await router.push('/admin')
if (failure) console.warn(String(failure))     // 导航没发生：被守卫拦了，或本来就在该页

try {
  await router.push({ name: 'not-exist' })     // 名字/参数不合法通常走异常
} catch (err) { console.error(err) }
```

`router.back()` 不能当「返回上一页」的唯一实现——从新标签打开的页面里，后退会回到外部站点；项目内跳转优先给明确目标。

## 导航守卫：三个层级与返回值三种写法

| 层级 | 写法 | 典型用途 |
| --- | --- | --- |
| 全局 | `router.beforeEach` / `beforeResolve` / `afterEach` | 登录态、权限、埋点、进度条 |
| 路由独享 | 记录里的 `beforeEnter(to, from)` | 只对某条路生效的规则 |
| 组件内 | `onBeforeRouteUpdate` / `onBeforeRouteLeave`（从 `vue-router` 导入，在 setup 中同步调用） | 表单未保存提示、同组件换参数时重发请求 |

一次导航的执行顺序（记住它能解释大部分「我的守卫怎么没跑」）：**离开页的 `onBeforeRouteLeave` / `onBeforeRouteUpdate` → 全局 `beforeEach` → 复用组件的 update 守卫 → 路由独享 `beforeEnter` → 懒加载组件解析（下载 chunk）→ 全局 `beforeResolve`（组件已就绪，比 beforeEach 晚）→ `afterEach`（导航已确认，不能取消）→ 组件挂载 / `onMounted`。**

返回值三种写法（`afterEach` 无返回值语义）：

```ts
router.beforeEach((to) => {
  if (!auth.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } }  // ① 重定向
  if (to.meta.requiresAuth && !auth.can(to.meta.role)) return false                 // ② 中断，留在原页
  // ③ 不返回或 return true = 放行
})
```

新一代写法直接用返回值，不再用 `next()` 回调；官方把 `next` 标为可省略/不推荐。同一个守卫里别混用 `return` 与 `next()`。守卫可以是 `async` 函数。

## 登录态守卫完整示例

```ts
// src/router/guards.ts
import type { Router } from 'vue-router'
import { useAuthStore } from '../stores/auth'

export function setupGuards(router: Router) {
  router.beforeEach((to) => {
    const auth = useAuthStore()

    // 防线 1：登录页自身不加 requiresAuth，已登录就直接离开
    if (to.name === 'login') return auth.isLoggedIn ? { name: 'home' } : true

    if (to.matched.some((r) => r.meta.requiresAuth)) {
      if (!auth.isLoggedIn) {
        return { name: 'login', query: { redirect: to.fullPath } }   // 回原页靠这个参数
      }
      if (to.meta.role && !auth.hasRole(to.meta.role)) return { name: 'forbidden' }
    }
    return true
  })
}
```

```ts
// 登录成功后
const raw = route.query.redirect
const safe = typeof raw === 'string' && /^\/(?!\/)/.test(raw) && !raw.startsWith('/login')
router.replace(safe ? raw : { name: 'home' })
```

三个必须写对的点：

- **避免无限重定向**：登录页若也带 `requiresAuth`，就会「未登录 → 跳 login → 又未登录 → 又跳 login」，浏览器报 `Detected an infinite redirection in a navigation guard`。修法是登录路由不设该 meta，或守卫里先排除 `to.name === 'login'`；已在目标页时不要再返回重定向。
- **`redirect` 参数要校验**：只接受以单个 `/` 开头的站内路径（`//evil.example` 与 `https://evil.example` 都要挡掉），否则就是开放重定向。
- **401 属于请求层，不属于守卫**：守卫拦的是「还没进页面就知道你没登录」；token 过期发生在请求返回 401 的那一刻，应在 fetch 封装里统一处理——清 store、跳登录并带上当前 `fullPath`，这条规则只写一处（见 [fetch、同源策略与浏览器存储](/javascript/network-and-storage)、[统一错误处理](/backend/error-handling)）。守卫里不要发请求探测登录态。

`beforeEach` 首次进入应用也会跑一次，此刻要能拿到 store，前提是 `app.use(createPinia())` 已在 `app.use(router)` 之前完成（第 9 章）。

**守卫里不要 `await` 太久。** 守卫挂起期间用户停在旧页面，看起来像「点了没反应」。规则：毫秒级的本地判断（登录态、权限）放守卫；列表/详情这类网络数据放组件的 `onMounted`（第 7 章），或在 `beforeResolve` 里预取并配骨架屏 + 超时兜底，保证导航不会因请求失败永久卡住。

## 懒加载与代码分割

```ts
{ path: '/report', component: () => import('../views/ReportView.vue') }
```

这条 `import()` 是原生动态导入（[ES 模块、动态导入与迭代器](/javascript/modules-and-iterators)），构建时 Vite/Rollup 以它为分割点，把该视图及其独有依赖切进单独 chunk，主包不为它买单；代价是进入该页时才下载，中间有空白——这就是「懒加载 + 加载态/`Suspense`」组合存在的原因。同目录批量懒加载可用 `import.meta.glob('../views/*.vue')`（默认懒的，`{ eager: true }` 变同步）。chunk 数量、体积与预加载归 [Vite 构建侧](/frontend-engineering/vite-build) 讲。

## scrollBehavior 与滚动恢复

```ts
scrollBehavior(to, from, savedPosition) {
  if (savedPosition) return savedPosition                       // 后退/前进：回原位
  if (to.hash) return { el: to.hash, top: 80, behavior: 'smooth' }
  if (to.meta.keepScroll) return false                          // 保持不动
  return { left: 0, top: 0 }
}
```

签名是 `scrollBehavior(to, from, savedPosition)`，返回位置对象（`{ left, top }`、`{ el, offset }`、`behavior: 'smooth'` 等 `ScrollToOptions`）、不返回/`false`（不滚）、或 Promise（延迟滚动，配合页面切换动画）。`savedPosition` **只在 popstate 导航（后退/前进）时存在**，这就是「原生后退体验」的实现原理（核实时间 2026 年 10 月）。坑：滚动发生在内层 `overflow: auto` 容器而不是 document 时它无效——`scrollBehavior` 只操作窗口；内层容器要自己存/取 `scrollTop`（第 7 章的 `onBeforeUpdate` 快照 + `onActivated` 恢复正是为此）。

## meta 字段与 RouteMeta 类型扩展

守卫里判断「这条路由需要什么」不要靠猜路径字符串，用 `meta`：

```ts
{ path: '/admin', component: AdminView, meta: { requiresAuth: true, role: 'admin' } }
```

`meta` 会被继承合并：`to.meta` 是匹配链上所有记录 meta 的合并结果，`to.matched[i].meta` 是每层原始值（判断「任意一层要求登录」用 `to.matched.some(r => r.meta.requiresAuth)`）。默认 `RouteMeta` 是空接口，任何字段都不存在，所以要扩展：

```ts
// src/router/meta.d.ts —— 必须是模块（含 import/export）才能做声明合并
import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    role?: 'admin' | 'editor'
    keepScroll?: boolean
  }
}
```

这就是 [模块与声明文件](/typescript/modules-and-declarations) 里的模块增强。两条要点：文件要有顶层 `import`/`export`，否则 `declare module` 会被当成环境模块声明、把原类型整个替换掉；要让它出现在 `tsconfig.json` 的 `include` 范围内。扩展后 `meta: { requiresAuths: true }` 这类拼错会被编译器抓到。

## 404 通配路由

```ts
const routes = [
  /* 业务路由 */
  { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
]
```

`path` 必须放最后；`(.*)*` 匹配零个或多个段（`(.*)+` 要求至少一段）。通配是优先级最低的匹配，但它**仍算匹配成功**，所以 `to.matched.length > 0` 判不出 404——要用 `to.name === 'not-found'`。「访问不存在的动态 ID」（`/todo/999`）不能靠通配解决，只能在数据层判定后渲染 404 组件（第 12 章项目的要求正是这条）。Vue Router 3 的 `{ path: '*' }` 在 v4 已不支持，写上去直接报错；网上大量旧教程还是 `*`。

## 路由与 Pinia、后端请求的分工

| 状态类型 | 放哪里 | 判据 |
| --- | --- | --- |
| 当前视图、路径参数、筛选、分页、排序 | URL（`params` / `query`） | 用户会刷新、后退、把链接发给别人 |
| 服务端数据的缓存与派生 | Pinia（第 9 章） | 跨页面复用、要 loading/error、有写入动作 |
| 局部 UI（展开、hover、表单草稿） | 组件内 `ref` | 离开组件就没意义 |
| 登录用户、权限 | Pinia + 持久化 | 守卫要在组件之外读 |

三条边界：**路由不存业务数据**（`params` 里放 id，不放整条记录）；**store 不读 URL**（否则与路由耦合、无法单独测；让组件把 `route.query` 作为参数传给 action）；**守卫只做本地判断，不发业务请求**。

## 常见错误与排查

1. **刷新子页面得到服务器 404**（不是你的 404 组件）。现象：站内点链接正常，直接粘贴 `/user/42` 或刷新就 404。原因：history 模式缺 rewrite。怎么确认：看返回的是平台默认 404 页还是你的应用，`curl -I` 看状态码。修法：`try_files $uri $uri/ /index.html;` 或平台重写规则；无 rewrite 能力时改 hash 模式。
2. **`[vue-router warn]: No match found for location with path "/xxx"`。** 原因：目标无对应记录（少斜杠、大小写不符、`name` 拼错、参数为空导致路径变成 `/user/`）。怎么确认：打印 `to.fullPath` 与 `routes` 表逐字对照；临时加通配路由看它接住了什么。修法：补记录，或用 `{ name }` 跳转并配 `router.getRoutes()` 自检。
3. **`params` 刷新后丢失。** 现象：`push({ name: 'user', params: { id: 42, tab: 'info' } })` 里 `tab` 页面内能读到、刷新就没。原因：**只有在 `path` 里声明过的段才会写进 URL**，未声明的 `params` 是内存态，不序列化、不可分享；且 `path` 与 `params` 不能混用，`push({ path: '/user/42', params: {...} })` 的 params 被直接忽略。修法：写进 path（`/user/:id/:tab?`）或改用 `query`。
4. **`/user/1` → `/user/2` 界面不更新。** 原因：解构 `useRoute()` 丢响应式，或同路由不同参数时组件被复用、`onMounted` 不重跑。修法：`computed(() => route.params.id)`、`:key="route.fullPath"`、或 `onBeforeRouteUpdate`。
5. **子路由渲染空白。** 原因：父组件里没写内层 `<RouterView>`，或子路径写成 `/stats` 成了绝对路径。怎么确认：打印 `route.matched.length`，为 1 说明没进到子记录。修法：补出口、去掉子路径开头斜杠。
6. **守卫不生效或永久卡住。** 三类原因：① 守卫写在组件里而非安装 router 之后；② `async` 守卫某分支忘了 `return`（不返回＝放行）；③ 守卫 `await` 了一个永不 resolve 的 Promise。修法：守卫集中一处注册、每个分支显式 `return`、异步分支加 `try/catch` 与超时。
7. **`Detected an infinite redirection in a navigation guard`。** 原因：登录页被 `requiresAuth` 覆盖，或已在目标页仍返回重定向；另一种是权限不足被跳回登录造成环。怎么确认：守卫首行打印 `to.name`，看是否在两个名字间来回。修法：登录页不加 meta、守卫里先放行 login、没权限跳 403。附带症状「URL 里出现 `?redirect=%2Flogin...` 套娃」是构造 redirect 时把已在登录页的 `fullPath` 也拼了进去，判断 `to.name !== 'login'` 再加。

## 练习

<Exercise title="练习 1 · 判断该放 params 还是 query" difficulty="基础">

待办应用的这些语义，逐项选择路径参数、查询参数还是组件状态：① 某条待办的详情页；② 只看未完成；③ 第 2 页；④ 当前展开的编辑框；⑤ 搜索关键词。

<template #answer>

① **路径参数** `/todo/:id`：资源身份，值得分享收藏，刷新必须还原。② **查询参数** `/todos?status=active`：视图筛选，可分享、后退能撤销。③ **查询参数** `?page=2`：同上，与筛选互相独立（写 query 时展开保留旧值）。④ **组件状态**：展开哪一行是纯局部交互，不该污染历史。⑤ **查询参数** `?q=会议`，但要**防抖或用 `replace` 写入**，否则每个字符一条历史记录。

判据：能被分享/后退撤销、用户认为「这是地址的一部分」的进 URL；一次性局部交互留在组件。

</template>

</Exercise>

<Exercise title="练习 2 · 修掉刷新 404" difficulty="进阶">

SPA 用 `createWebHistory()`，本地 dev 正常，部署到只能上传静态文件的平台后首页能开但 `/dashboard/stats` 刷新即 404。给两个方案与各自代价；再解释为什么本站 VitePress 用 `cleanUrls: false` 不遇到这个问题。

<template #answer>

**方案 A：切 hash。** `createWebHashHistory()`，URL 变 `/#/dashboard/stats`。代价：观感差、与页内锚点混用有歧义、服务器日志看不到路径（`#` 后不发出去）。好处：零配置。

**方案 B：保留 history 并补回退。** 能配的地方加 `try_files $uri $uri/ /index.html;` 或平台重写规则；完全不能配时只剩「404.html 回退页 + 脚本把路径搬进查询参数」这类折中，代价是多一次跳转、需要平台把 404 指向你的文件、脚本自己维护（本任务未实测，实施前在目标平台验证）。

**本站为什么不受影响**：`cleanUrls: false` 让每个页面都有真实的 `xxx.html`，链接也带后缀，刷新/直接访问请求到的路径在磁盘上存在，因此不需要 rewrite。同一个道理：**没有 rewrite 能力，就别让 URL 指向不存在的文件。**

</template>

</Exercise>

<Exercise title="练习 3 · 写一个带 redirect 的登录守卫" difficulty="挑战">

需求：未登录访问任意 `meta.requiresAuth` 路由时跳 `/login?redirect=<原始路径>`；登录后回原页；已登录访问 `/login` 直接回首页；不允许开放重定向。写出守卫并指出三道防线。

<template #answer>

```ts
router.beforeEach((to) => {
  const auth = useAuthStore()
  // 防线 1：登录页短路返回，杜绝自我重定向
  if (to.name === 'login') return auth.isLoggedIn ? { name: 'home' } : true

  const needAuth = to.matched.some((r) => r.meta.requiresAuth)
  if (needAuth && !auth.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } }
  // 防线 3：登录与权限分开，避免「没权限 → 跳登录 → 已登录 → 跳首页 → 没权限」的环
  if (needAuth && to.meta.role && !auth.hasRole(to.meta.role)) return { name: 'forbidden' }
  return true
})
```

```ts
function afterLogin() {
  const raw = useRoute().query.redirect
  // 防线 2：类型检查 + 必须以单个斜杠开头（挡掉 //evil 与 https://evil）+ 排除回登录页自身
  const safe = typeof raw === 'string' && /^\/(?!\/)/.test(raw) && !raw.startsWith('/login')
  router.replace(safe ? raw : { name: 'home' })
}
```

排查提示：跑这条链路时在守卫里打印 `to.name` 与 `to.fullPath`，任何「连续两次相同目标」都是循环前兆。代码未在本机运行，写法依据官方导航守卫指南（核实时间 2026 年 10 月）。

</template>

</Exercise>

<Exercise title="练习 4 · 故意制造一次 No match" difficulty="进阶">

`router.push({ name: 'user-detail', params: { id } })` 抛异常，而 `router.push('/user/' + id)` 在控制台打出 `No match found for location with path "/user/undefined"`。分别解释两条报错最可能的原因与快速确认方法。

<template #answer>

第一条：`name` 在路由表里不存在（实际叫 `user` 或拼写不同），或该记录要求 `:id` 而传入的 `id` 是 `undefined`——按名字解析时无法填充必填段，Vue Router 抛错而不是生成错地址。

第二条：路径里出现字面量 `undefined`，说明 `id` 本身就是 `undefined`（字段名取错、异步数据还没到）；`/user/undefined` 其实能匹配 `:id`，所以更常见的无匹配来自拼接出错，例如 `/user//42`、`/users/42`（复数拼错）、少了前导斜杠。

确认三步：① 打印 `id` 的类型与值；② `console.log(router.getRoutes().map(r => r.path))` 与实际 `fullPath` 逐字比对；③ 临时加 `/:pathMatch(.*)*` 的 404 组件并渲染 `route.fullPath`，就能看到代码实际请求了什么地址。预防：跳转前对必填参数做类型收窄，别用字符串拼接构造路径。

</template>

</Exercise>

## 官方文档与延伸阅读

- [HTML5 History 模式](https://router.vuejs.org/guide/essentials/history-mode.html) —— 核实「history 必须配服务端重写、直接访问 404」、nginx `try_files $uri $uri/ /index.html;`、hash 模式无需服务器特殊处理、子目录需传 base。
- [导航守卫](https://router.vuejs.org/guide/advanced/navigation-guards.html) —— 核实三层级守卫、完整解析顺序、`next` 可省略/不推荐、返回值三种写法。
- [滚动行为](https://router.vuejs.org/guide/advanced/scroll-behavior.html) —— 核实 `scrollBehavior(to, from, savedPosition)` 签名与三种返回形态、`savedPosition` 仅 popstate 可用。
- [编程式导航](https://router.vuejs.org/zh/guide/essentials/navigation.html) 与 [动态路由匹配](https://router.vuejs.org/guide/essentials/dynamic-matching.html) —— 核实 `push`/`replace` 返回 Promise 与失败类型、通配与参数语法（`:path*`、`(.*)*`）。
- [API 参考](https://router.vuejs.org/api/) 与 [官方指南首页（中文）](https://router.vuejs.org/zh/introduction.html) —— 核实 RouterLink 的 `active-class` / `exact-active-class` prop 与 `aria-current` 默认值 `page`，以及 Vue Router 4 的整体版本口径。
- 站内回指：[响应式原理](/vue/reactivity)（`useRoute()` 为何不能解构）、[组件基础](/vue/components)（`props: true`）、[生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject)（守卫里的数据请求应挪到 `onMounted`）、[Pinia](/vue/pinia)。跨领域：[ES 模块、动态导入与迭代器](/javascript/modules-and-iterators)、[Vite 构建侧](/frontend-engineering/vite-build)、[Nginx](/linux/nginx)、[部署到 VPS](/devops/deploy-to-vps)、[无障碍](/html/accessibility)、[后端开发](/backend/)。

## 下一章

路由解决「哪个 URL 显示哪个组件」，但它不适合存业务数据：把用户资料、列表缓存塞进 `query` 既难分享又受长度限制。第 9 章 [Pinia 状态管理](/vue/pinia) 接手剩下的问题：跨页面共享且需要在组件之外访问的状态放哪、setup store 怎么写、解构 store 为什么会丢响应式、以及登录态这种既要在守卫里读又要持久化的状态如何落地。

