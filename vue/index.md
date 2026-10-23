# Vue 3 · 领域首页

<StatusBadge state="ready" note="12 章正文全部完成（第 12 章为阶段项目），可连续学习" />

## 这个领域解决什么问题

手写 DOM 同步的代码写多了，你会遇到一个无法通过「更努力」解决的问题：**状态和视图是两份需要人工保持一致的东西。** JavaScript 领域末尾那个待办清单项目就是刻意让你体会这一点的——你有一个 `render()` 函数，每次状态变化都要手动调它，漏调一次界面就和数据不一致。

具体的痛点表现：

- 新增一条数据，忘了调 `render()`，界面上看不到，但 `console.log` 数据是对的。
- 一个输入框的值要同步到三个地方：列表、计数器、按钮的禁用状态。改一处逻辑要动三个函数。
- 用户输入过滤词，你要么每次输入都全量重渲染整个列表（卡顿），要么精细地只更新变化的那一项（代码量爆炸）。
- 多个页面共享一份登录状态，只能靠全局变量加事件广播，或者把状态一路当 props 传七层下去。
- 页面切换时整个文档重载，白屏一下，滚动位置丢失，已经填了一半的表单没了。

Vue 解决的核心问题是**「让视图自动跟随状态变化」**。你只声明「状态长什么样时界面长什么样」，框架负责中间的 diff 和 DOM 更新。这不是语法糖，是一种编程模型的切换：从命令式（怎么改 DOM）变成声明式（界面是什么状态的函数）。

但框架带来一组新的、更隐蔽的坑，这才是本领域要重点讲的：

- **响应式丢失。** 把 `ref` 解构出来，或者把 `reactive` 对象赋值给一个普通变量，响应式链路就断了——因为 `ref` 是靠 `.value` 的 getter/setter 追踪依赖的，解构之后拿到的是原始值。这是 Vue 3 最高频的 bug。
- **`ref` 还是 `reactive`？** 选错了后面全是麻烦。`reactive` 不能整体替换（替换后新对象不再是响应式的），`ref` 在模板里自动解包但在 JS 里要写 `.value`，规则不一致导致心智负担。
- **`watch` 和 `watchEffect` 的区别搞不清**，`immediate` / `deep` 该不该加、加了会不会引发性能问题，全靠猜。
- **`computed` 里写了副作用。** computed 应该是纯函数，在里面发请求或改状态，会导致无法预测的重复执行。
- **组件拆分粒度失控。** 要么一个组件八百行，要么拆成二十个组件、props 传七层，`provide` / `inject` 用成了全局变量。
- **生命周期钩子写在异步回调之后**，`onMounted` 不生效——因为组合式 API 的生命周期注册依赖「当前正在执行的组件实例」这个上下文，异步之后上下文已经丢失。
- **`v-for` 用了索引作 `key`**，列表中间插入一项，所有输入框的内容全部错位。
- **该用 Pinia 的时候用了全局 `provide`，该拆 store 的时候一个 store 塞了全部状态。**
- **列表上千条时页面卡死**，因为不知道虚拟滚动，也不知道 `shallowRef` 和 `v-memo` 在什么场景下有用。
- **选项式 API 和组合式 API 的教程混着看**，代码风格精神分裂。网上大量 Vue 教程仍是 Vue 2 时代的写法，照抄过来会发现和文档对不上。

## 关于选项式 API 与组合式 API

这是必须一开始就说清楚的事，否则你会在两套互不兼容的写法之间反复横跳。

- **选项式 API（Options API）** 是 Vue 2 的主要写法：一个组件是一个对象，数据放 `data()`、方法放 `methods`、计算属性放 `computed`、生命周期放 `mounted` 等钩子里。它按「选项类别」组织代码。
- **组合式 API（Composition API）** 是 Vue 3 引入的写法：用 `ref` / `reactive` / `computed` / `watch` / `onMounted` 这些函数在 `setup()` 里组织逻辑。它按「功能」组织代码，可以把一个功能相关的所有逻辑抽成一个 composable 函数复用。
- **`<script setup>`** 是组合式 API 的编译时语法糖：不需要写 `setup()` 函数、不需要 `return`，顶层的变量和函数自动暴露给模板，导入的组件自动注册。

**本站只用「组合式 API + `<script setup>` + TypeScript」。** 理由：

1. 本项目是新建项目，没有历史包袱，不需要兼容 Vue 2 代码。
2. 组合式 API 与 TypeScript 的类型推断配合明显更好，选项式 API 里 `this` 的类型推断在复杂场景下会失效。
3. 逻辑复用：选项式 API 时代靠 mixins，mixins 有命名冲突和来源不明的问题；组合式 API 用普通函数（composable）解决，来源清晰、类型完整。
4. 官方文档和 Vue 生态（Pinia、Vue Router 4）都以组合式 API 为一等公民。

**但你仍然需要能读懂选项式 API。** 网上大部分 Vue 2 教程、很多存量项目、以及一部分 Vue 3 项目的旧组件仍是选项式写法。本领域会在第 1 章给出两者的对照关系，让你能读懂旧代码，但所有练习和项目都只写组合式 API。

## 前置知识

**[HTML](/html/)、[CSS](/css/)、[TypeScript](/typescript/)。** 三者都是硬前置，缺一不可。

- **HTML** —— Vue 模板本质上是带指令的 HTML。你需要知道 `v-if` 和 `v-show` 渲染出的 DOM 有什么不同、动态绑定的 `:id` / `:for` 对无障碍意味着什么、组件的根元素会如何影响外层的语义结构。组件边界怎么划，直接取决于你对 HTML 第 8 章（语义化布局）的理解。
- **CSS** —— Vue 单文件组件有 `<style scoped>`，它的作用域机制是通过给元素加属性实现的，理解这一点需要 CSS 第 2 章的选择器与特异性知识。组件化之后，「一个组件在自己的容器里布局」需要容器查询而不是媒体查询（CSS 第 9 章）。
- **TypeScript** —— 这是最强的前置。Vue 3 的组合式 API 与 TS 深度绑定：`ref` 的类型推断、`defineProps` 的泛型写法、`computed` 的返回类型、Pinia store 的类型安全，全部依赖 TS 第 6 章（泛型）和第 7 章（类型推断）。不先学 TS 直接学 Vue，你会一直在跟红色的波浪线搏斗，而这些波浪线其实和 Vue 无关。

另外强烈建议先完成 [JavaScript](/javascript/) 领域里的 `proxy` 一章。Vue 3 的响应式系统直接建立在 `Proxy` 之上，第 2 章会讲它的实现原理，读过 `proxy` 会让你少一半困惑。

## 章节目录

| 章节 | 内容 | 学完能做什么 |
| --- | --- | --- |
| [1. Vue 是什么与心智模型](/vue/mental-model) | 声明式 UI 与「界面 = f(状态)」、渐进式框架的含义、选项式 API 与组合式 API 的对照、本站为什么只用 `<script setup>`、创建第一个 Vue + TS 项目 | 建立正确的心智模型，能读懂任意 Vue 代码而不被写法差异迷惑 |
| [2. 响应式原理：`ref` / `reactive` 与 Proxy](/vue/reactivity) | `Proxy` 如何拦截读写、依赖收集与触发更新的机制、`ref` 与 `reactive` 的实现差异与取舍、自动解包规则、响应式丢失的各种情形、`toRef` / `toRefs` / `shallowRef` / `markRaw` | 遇到「改了数据界面没变」时能立刻定位到是哪一步断链，而不是靠试 |
| [3. 模板语法与指令](/vue/template-syntax) | 插值、`v-bind` 与简写、`v-on` 与事件修饰符、`v-if` / `v-else` / `v-show` 的区别、`v-for` 与 `key` 的正确用法、`v-model` 与表单绑定、动态属性、模板表达式的边界 | 把任意设计稿的静态 HTML 转成一个数据驱动的 Vue 模板 |
| [4. 计算属性与侦听器](/vue/computed-and-watch) | `computed` 的缓存机制与「必须是纯函数」的原因、可写计算属性、`watch` 与 `watchEffect` 的区别与选择、`immediate` / `deep` / `once`、侦听器的清理与竞态处理 | 分清「派生数据」和「副作用」，不再用 `watch` 去做本该用 `computed` 的事 |
| [5. 组件基础：props、emit 与插槽](/vue/components) | 组件注册、`defineProps` 的泛型与运行时两种写法、单向数据流与 `v-model` 在组件上的用法、`defineEmits`、属性透传（fallthrough attributes）、插槽与具名/作用域插槽、`defineExpose` | 设计一个能复用的组件，接口清晰、不依赖父组件的内部实现 |
| [6. 组合式 API、composables 与组件设计模式](/vue/composables) | `setup` 的执行时机、把逻辑抽成 composable 的判断标准、composable 的命名与返回值约定、常见反模式（composable 里藏全局状态、参数过多）、容器组件与展示组件的分工 | 把重复的异步请求、表单校验、权限判断抽成可测试的 composable |
| [7. 生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject) | 各生命周期钩子的时机与常见误用、为什么钩子必须同步注册、`useTemplateRef` 与直接操作 DOM 的边界、`provide` / `inject` 与 `InjectionKey` 的类型安全写法、何时该用它替代 props 透传 | 在正确的时机做正确的事，避免跨层级传 props 传七层 |
| [8. Vue Router](/vue/router) | 路由的基本配置与历史记录模式、`RouterLink` / `RouterView`、动态路由与嵌套路由、编程式导航、导航守卫与权限控制、路由懒加载与代码分割、滚动行为 | 搭出一个多页面应用，含登录态守卫与按需加载 |
| [9. Pinia 状态管理](/vue/pinia) | 为什么需要独立的 store、定义 store 的两种方式、state / getters / actions 的职责划分、store 之间的依赖、在组件外使用 store、持久化与 SSR 注意事项、TypeScript 下的类型推断 | 把跨页面共享的状态从组件里搬出来，且不丢类型安全 |
| [10. 渲染性能：`v-memo`、`shallowRef` 与长列表](/vue/rendering-performance) | 虚拟 DOM 与编译时优化的关系、patch flag 与静态提升的作用、`v-memo` 的适用场景、`shallowRef` / `markRaw` 用于大对象、长列表的虚拟滚动方案、组件懒加载、常见的性能陷阱 | 定位并修复一个真实的卡顿问题，而不是盲目加 `v-memo` |
| [11. 单文件组件与构建链](/vue/sfc-and-build) | SFC 三个块的职责、`<style scoped>` 的作用域实现与穿透、CSS Modules 的选择、`defineModel` 等编译宏、Vite 在开发与构建时对 SFC 做了什么、目录组织约定 | 理解 `.vue` 文件从源码到产物的全过程，为[前端工程化](/frontend-engineering/)做好衔接 |
| [12. 阶段项目](/vue/project) | 用 Vue 3 + TypeScript + Vue Router + Pinia 构建一个多页面的待办应用 | 把前 11 章串成一个结构完整、类型安全、可继续扩展的前端应用 |

## 学习顺序建议

**严格按 1 → 12 的顺序学。第 2 章不能跳。**

第 2 章（响应式原理）是整个领域的分水岭。跳过它去学模板语法，你会在「为什么改了数据界面没更新」这类问题上反复卡住，而且每次的解决方式都是碰运气。理解了 `Proxy` 拦截 + 依赖收集这套机制之后，`ref` 要写 `.value`、解构会丢响应式、`reactive` 不能整体替换，这些规则都不再需要背——它们是同一个机制的必然结果。

第 3、4 章（模板与计算属性/侦听器）必须连着学。`computed` 与 `watch` 的选择是 Vue 里最重要的日常判断，而且第 4 章依赖第 3 章建立的「模板是状态的函数」这个认识。

第 5、6、7 章是组件化三部曲，顺序不能换：先理解单个组件的接口（props / emit / slot），再理解如何抽取复用逻辑（composable），最后理解跨层级协作（生命周期 / 模板引用 / provide-inject）。第 6 章的 composable 抽取，需要你先在第 5 章见过足够多「不该拆」的组件。

第 8、9 章（Router 与 Pinia）放在组件之后，因为它们解决的是「多个组件之间」的问题。反过来先学 Pinia，你会把所有状态都塞进 store，包括本该留在组件里的局部状态。

第 10 章性能必须最后学。**过早优化是 Vue 新手最常见的错误**——在还没写出正确代码之前加 `v-memo`、用 `shallowRef`、上虚拟滚动，只会让代码更难读且往往无效。先跑通，再用 DevTools 找到真实瓶颈。

第 11 章（SFC 与构建）是为了衔接到[前端工程化](/frontend-engineering/)领域，也是第 12 章项目的直接准备。

## 学习方法

- **用官方脚手架建项目：`npm create vue@latest`。** 它是 Vue 官方维护的脚手架，交互式询问 TypeScript、Vue Router、Pinia、ESLint、Vitest 等选项。本领域的所有练习都用它创建的项目，不要手工配置。
- **不要看 Vue 2 的教程。** 如果你在网上找资料，先确认页面顶部有版本切换器并且选中的是 Vue 3。看到 `Vue.component(...)`、`new Vue({...})`、`mixins`、`filters`、`$set` 这类写法，那是 Vue 2，直接关掉。
- **每学一个 API，先在 [Vue SFC Playground](https://play.vuejs.org/) 上试。** 它是官方的在线单文件组件环境，支持 TypeScript 与组合式 API，不需要建项目。等概念清楚了再落到本地项目里。
- **装 Vue DevTools 浏览器扩展。** 它能看到组件树、每个组件的 props / state、Pinia store 的实时状态与变更历史、以及路由信息。第 2 章之后，任何「响应式没生效」的问题都应该先在 DevTools 里确认状态到底变了没有。
- **练习的正确形式：先写死数据，再抽成状态，再抽成组件。** 比如做一个待办列表，第一步先写纯 HTML + 写死的三条数据，第二步把数据变成 `ref`，第三步把「一条待办」抽成子组件。这个顺序能逼你想清楚组件边界在哪。
- **每个组件写完之后，回答三个问题**：它的 props 里有哪一个是其实可以从别处拿到的？它 emit 的事件里有没有本该自己处理的？它的状态里有没有其实是别的状态的派生值（该用 `computed`）？
- **报错先看浏览器控制台，再看编辑器。** Vue 的运行时警告信息质量很高，会直接告诉你哪个组件、哪个 prop 出了问题。

## 阶段项目

**多页面待办应用**：把 JavaScript 领域末尾的待办清单，重写成一个真正的单页应用。这是进入[后端开发](/backend/)领域之前的验收关卡，之后这个项目会持续扩展——接上 Fastify 后端、加上数据库、部署到 VPS。

技术要求：

- 用 `npm create vue@latest` 创建，开启 TypeScript、Vue Router、Pinia、ESLint、Vitest。
- 全项目使用组合式 API + `<script setup>`，不出现任何选项式 API 写法。
- 全项目 `any` 出现次数为 0（延续 TypeScript 领域的约束）。

页面结构：

- 列表页：展示待办，支持按状态筛选和按关键词搜索，URL 与筛选状态双向同步（刷新页面筛选条件不丢）。
- 详情页：单条待办的完整信息，通过动态路由参数访问，访问不存在的 ID 时显示 404 页面。
- 设置页：主题切换（亮/暗），设置持久化到 `localStorage`。
- 一个需要「登录」才能访问的页面，用路由守卫拦住未登录访问并重定向。

架构要求：

- 至少三个组件、至少两个 composable（例如 `useTodos` 负责数据获取与缓存、`useLocalStorage` 负责持久化）。
- Pinia 中至少一个 store 管理待办数据，一个管理用户/设置。组件之间不通过多层 props 透传共享状态。
- 数据层用一个可替换的适配函数隔离：现在读 `localStorage`，之后能无痛换成 `fetch` 调后端。这一条是第一期后续所有工作的基础。
- 长列表场景下（模拟 1000 条数据）页面不卡死，说明你采取的方案及理由。

验收标准：

- `npm run build` 零错误零警告，`npm run type-check` 通过。
- 打开 Vue DevTools，组件树层次清晰，没有单个超过 200 行的组件。
- 修改任意一条待办，只有受影响的部分重新渲染（用 DevTools 的 highlight updates 或性能面板确认）。
- 刷新任意页面，URL 对应的状态完整恢复。
- 你能指着代码说清楚：这份状态存在哪里、谁是它的唯一写入者、视图是怎么知道它变了的。

## 官方文档与延伸阅读

Vue 的官方文档有完整的中文版，且与英文版同步更新。**优先读中文版**，遇到术语含糊时对照英文版。

- [Vue 3 官方文档（中文）](https://cn.vuejs.org/guide/introduction.html) —— 主入口。[英文版](https://vuejs.org/guide/introduction.html) 作为对照。
- [Vue 是什么](https://cn.vuejs.org/guide/introduction.html#what-is-vue) 与 [使用 Vue 的多种方式](https://cn.vuejs.org/guide/extras/ways-of-using-vue.html) —— 第 1 章核心参考。
- [组合式 API 常见问题](https://cn.vuejs.org/guide/extras/composition-api-faq.html) —— **本站为什么选组合式 API 的官方说明，第 1 章必读。**
- [创建应用](https://cn.vuejs.org/guide/essentials/application.html) 与 [组件基础](https://cn.vuejs.org/guide/essentials/component-basics.html) —— 第 1、5 章核心参考。
- [响应式基础](https://cn.vuejs.org/guide/essentials/reactivity-fundamentals.html)（[英文版](https://vuejs.org/guide/essentials/reactivity-fundamentals.html)）与 [响应式深入](https://cn.vuejs.org/guide/extras/reactivity-in-depth.html) —— **第 2 章核心参考，后者讲 Proxy 实现细节，必读。**
- [模板语法](https://cn.vuejs.org/guide/essentials/template-syntax.html)、[Class 与 Style 绑定](https://cn.vuejs.org/guide/essentials/class-and-style.html)、[条件渲染](https://cn.vuejs.org/guide/essentials/conditional.html)、[列表渲染](https://cn.vuejs.org/guide/essentials/list.html)、[事件处理](https://cn.vuejs.org/guide/essentials/event-handling.html)、[表单输入绑定](https://cn.vuejs.org/guide/essentials/forms.html) —— 第 3 章核心参考。
- [计算属性](https://cn.vuejs.org/guide/essentials/computed.html) 与 [侦听器](https://cn.vuejs.org/guide/essentials/watchers.html) —— 第 4 章核心参考。
- [注册组件](https://cn.vuejs.org/guide/components/registration.html)、[Props](https://cn.vuejs.org/guide/components/props.html)、[组件事件](https://cn.vuejs.org/guide/components/events.html)、[透传 Attributes](https://cn.vuejs.org/guide/components/attrs.html)、[插槽](https://cn.vuejs.org/guide/components/slots.html)、[异步组件](https://cn.vuejs.org/guide/components/async.html) —— 第 5 章核心参考。
- [组合式函数（composables）](https://cn.vuejs.org/guide/reusability/composables.html)、[自定义指令](https://cn.vuejs.org/guide/reusability/custom-directives.html)、[插件](https://cn.vuejs.org/guide/reusability/plugins.html) —— 第 6 章核心参考。
- [生命周期](https://cn.vuejs.org/guide/essentials/lifecycle.html)、[模板引用](https://cn.vuejs.org/guide/essentials/template-refs.html)、[依赖注入](https://cn.vuejs.org/guide/components/provide-inject.html) —— 第 7 章核心参考。
- [渲染机制](https://cn.vuejs.org/guide/extras/rendering-mechanism.html) 与 [虚拟 DOM 与编译器辅助的虚拟 DOM](https://cn.vuejs.org/guide/extras/rendering-mechanism.html#virtual-dom-vs-compiler-assisted-virtual-dom) —— 第 10 章核心参考，讲清了 Vue 3 的编译时优化。
- [性能优化](https://cn.vuejs.org/guide/best-practices/performance.html) 与 [虚拟化列表](https://cn.vuejs.org/guide/best-practices/performance.html#virtualized-lists) —— 第 10 章核心参考。
- [单文件组件](https://cn.vuejs.org/guide/scaling-up/sfc.html)、[工具链](https://cn.vuejs.org/guide/scaling-up/tooling.html)、[路由](https://cn.vuejs.org/guide/scaling-up/routing.html)、[状态管理](https://cn.vuejs.org/guide/scaling-up/state-management.html)、[测试](https://cn.vuejs.org/guide/scaling-up/testing.html)、[服务端渲染](https://cn.vuejs.org/guide/scaling-up/ssr.html) —— 第 11 章核心参考。
- [Vue 与 TypeScript 总览](https://cn.vuejs.org/guide/typescript/overview.html) 与 [组合式 API 中使用 TypeScript](https://cn.vuejs.org/guide/typescript/composition-api.html) —— 本领域的 TypeScript 前置直接对应这里。
- [Vue 风格指南](https://cn.vuejs.org/style-guide/) —— 组件命名、props 写法等约定，第 5、6 章配合阅读。
- API 参考：[响应式核心](https://cn.vuejs.org/api/reactivity-core.html)（含 [`ref`](https://cn.vuejs.org/api/reactivity-core.html#ref)）、[响应式进阶](https://cn.vuejs.org/api/reactivity-advanced.html)（含 [`shallowRef`](https://cn.vuejs.org/api/reactivity-advanced.html#shallowref)）、[响应式工具函数](https://cn.vuejs.org/api/reactivity-utilities.html)、[内置指令](https://cn.vuejs.org/api/built-in-directives.html)（含 [`v-memo`](https://cn.vuejs.org/api/built-in-directives.html#v-memo)）、[`<script setup>`](https://cn.vuejs.org/api/sfc-script-setup.html)、[SFC 语法规范](https://cn.vuejs.org/api/sfc-spec.html)、[通用 API](https://cn.vuejs.org/api/general.html)、[组合式 API：setup](https://cn.vuejs.org/api/composition-api-setup.html)、[组合式 API：生命周期](https://cn.vuejs.org/api/composition-api-lifecycle.html)、[组合式 API：依赖注入](https://cn.vuejs.org/api/composition-api-dependency-injection.html)、[组合式 API：辅助函数](https://cn.vuejs.org/api/composition-api-helpers.html)（含 [`useTemplateRef`](https://cn.vuejs.org/api/composition-api-helpers.html#usetemplateref)）。
- [Vue Router 官方文档（中文）](https://router.vuejs.org/zh/introduction.html)、[指南](https://router.vuejs.org/zh/guide/)、[导航](https://router.vuejs.org/zh/guide/essentials/navigation.html) —— 第 8 章核心参考。
- [Pinia 官方文档（中文）](https://pinia.vuejs.org/zh/introduction.html) 与 [核心概念](https://pinia.vuejs.org/zh/core-concepts/) —— 第 9 章核心参考。
- [Web Components 与 Vue](https://cn.vuejs.org/guide/extras/web-components.html) —— 了解 Vue 组件与原生 Web Components 的关系，选读。
- [无障碍](https://cn.vuejs.org/guide/best-practices/accessibility.html) 与 [安全](https://cn.vuejs.org/guide/best-practices/security.html) —— 配合 [HTML 第 9 章](/html/) 阅读。
- [核心团队](https://cn.vuejs.org/about/team.html) —— 想知道某个决策为什么这样做时，可以从这里找到 RFC 与讨论的入口。

## 版本说明

本领域内容基于 **Vue 3.x** 编写，配套 **Vue Router 4.x** 与 **Pinia 2.x**（或其后继主版本），核实时间为 2026 年 10 月。

时效性风险按章节区分：

- **第 2 章（响应式原理）稳定。** Vue 3 的响应式基于 `Proxy`，这套机制自 3.0 发布以来没有本质变化。
- **第 3–5 章（模板、计算属性、组件基础）稳定**，但编译宏（compiler macros）在持续增加。例如 `defineModel` 一类较新的宏是后续版本加入的，早期教程里会用 `props` + `emit` 手写等价逻辑。遇到宏相关的写法差异时，以 [SFC 语法规范](https://cn.vuejs.org/api/sfc-spec.html) 与 [Vue 版本发布说明](https://cn.vuejs.org/about/releases.html) 为准。
- **第 6、7 章（composables 与生命周期）中等风险。** 组合式 API 的推荐写法在演进，官方对「什么该抽成 composable」的建议也在细化。以 [组合式 API 常见问题](https://cn.vuejs.org/guide/extras/composition-api-faq.html) 为准。
- **第 10 章（渲染性能）风险最高。** Vue 的编译时优化一直在推进，某些今天需要手动优化的场景未来可能由编译器自动处理。文中涉及性能的建议会标注适用版本。
- **第 8、9 章（Router 与 Pinia）跟随各自库的主版本。** 这两个库的 API 在小版本间基本稳定，但安装方式、TypeScript 支持、SSR 相关的用法会调整。动手前对照官方文档的当前版本。
- **本站不涉及 Vue 2。** Vue 2 已于 2023 年底结束官方维护，网上大量 Vue 2 教程仍然排在搜索结果前列，请注意甄别。凡是你看到的写法在本领域文档里找不到对应，先怀疑它是 Vue 2 的。
