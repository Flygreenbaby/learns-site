# Vue 是什么与心智模型：界面是一个函数，你只负责状态

[JavaScript 阶段项目](/javascript/project) 里有一条硬规则：**禁止在事件回调里零散改 DOM**，所有变更走「事件 → 改 state 的函数 → `render()` → 重建视图」。它换来的东西很实在：画面完全由状态推导。但它有两个人工成本：**`render()` 不能漏调**（漏一次数据与界面就不一致），**粒度难定**（用户打一个字要不要重画一千行？只画变化那一项就得手写「谁依赖谁」的映射）。

Vue 做的事一句话说完：**把「调用 `render()`」自动化，并且只更新真正变化的节点。** 你仍然只声明「界面 = f(状态)」，但从状态到 DOM 那段路（依赖追踪、虚拟节点 diff、属性更新）交给框架。代价是中间多了一层看不见的东西，它会在两种时候来算账：「我明明改了数据界面为什么不动」（第 2 章）、「加了 `v-memo` 为什么更慢」（第 10 章）。

## 从手动 render 到响应式：职责交接表

| 你在纯 JS 项目里手写的 | Vue 里的对应物 | 干活的是谁 |
| --- | --- | --- |
| `state = { todos: [], filter: 'active' }` 普通对象 | `ref` / `reactive` 包起来的响应式数据 | `Proxy` 或 getter/setter 拦截读写 |
| `render()` 清空容器、按状态重建节点 | 模板里声明的结构 | 编译成 `render` 函数，运行时执行 |
| 回调里 `state.filter = 'done'; render()` | `@click="filter = 'done'"`，写完就结束 | 状态变更后自动重跑 `render` |
| 事件委托 + `closest("[data-action]")` | `v-for` 里每项 `@click="remove(todo.id)"` | 运行时统一处理 |
| 手工算「剩余几条」写进三个地方 | `computed` 派生值（第 4 章） | 依赖变化时重算，结果缓存 |

交接的是三件事里的第三件：**状态声明、视图声明、更新触发**。前两件换写法，第三件彻底不归你。但「谁改状态、什么时候改」仍然完全归你——框架不会阻止你在模板里改 props，也不替你判断「这个值该不该另存一份」。

## 渐进式框架：同一套运行时的三种接入姿势

「渐进式（progressive）」说的是**同一个包可以只承担一小部分职责**：

| 姿势 | 怎么写 | 放弃了什么 |
| --- | --- | --- |
| 已有页面里嵌一块交互 | script 标签引入完整版构建，再 `createApp({ data() {...}, template: '...' })` | 没有 SFC 与类型推断、模板写成字符串；要 `v-cloak` 处理未编译闪现（第 3 章） |
| 页面里一个区域组件化 | 无构建，或只用 Vite 打这一小块 | Router / Pinia 基本用不上 |
| 整个应用交给 Vue | `npm create vue@latest` + SFC + Vite | 需要理解构建链（第 11 章、[Vite 开发侧](/frontend-engineering/vite-dev)） |

**代价是「同一套概念在不同姿势下能力不同」**：无构建拿不到编译时优化与类型推断，上构建才能用 SFC、`<script setup>`、`defineProps` 泛型。本站走第三条，因为项目要长期演进（后续接 [后端](/backend/)、[部署](/devops/deploy-to-vps)）。判断标准：需要第二个组件、需要一份状态跨两块区域、需要 URL 与状态同步——任何一条成立就该上构建。

## 选项式与组合式：同一套运行时的两种组织方式

先拆掉最容易误解的一点：**它们不是两个版本、不是两套 API，也不存在性能优劣。** 组合式 API 是 Vue 3 提供的一组函数，选项式是同一批能力的对象字面量封装——Vue 3 里选项式的 `data` / `computed` / `watch` 底层调用的正是 `ref` / `computed` / `watch`。区别只有一处：**代码按什么分类**——选项式按选项类别分，组合式按功能分。

| 选项式 | 组合式（script setup 里） | 要知道的差异 |
| --- | --- | --- |
| `data() { return { count: 0 } }` | `const count = ref(0)` | 模板里都写 `count`；脚本里组合式要 `.value` |
| `methods: { add() {} }` | `function add() {}` | 组合式的函数没有 `this`，可以直接 export 出去测 |
| `computed: { left() {} }` | `const left = computed(() => {})` | 组合式拿到的是 computed 对象，脚本里仍要 `.value` |
| `watch: { filter(nv) {} }` | `watch(filter, (nv) => {})` | 嵌套属性写成 getter：`watch(() => form.a.b, ...)`；`watchEffect` 只有组合式有 |
| `created()` | `script setup` 的顶层代码 | 顶层代码的时机就早于 `mounted` |
| `mounted` / `beforeUnmount` | `onMounted` / `onBeforeUnmount` | 名称一一对应；钩子必须同步注册（第 7 章） |
| `props` / `$emit` 选项 | `defineProps` / `defineEmits`、`emit` | 组合式没有 `this.$emit`；`$refs` 对应 `useTemplateRef` |
| `mixins` | composable 函数（第 6 章） | mixins 命名冲突、来源不明，官方已不推荐 |
| `provide` / `inject` 选项 | `provide()` / `inject()` | 组合式可配 `InjectionKey` 拿完整类型 |
| filters（Vue 2） | 无对应 | Vue 3 已移除，改用 `computed` 或普通函数 |

**同一个组件，两种写法。** 需求：初始数据由父组件传入，输入框新增，只显示未完成。

```vue
<script>
export default {
  props: { initialTodos: { type: Array, default: () => [] } },
  data() {
    return { todos: [...this.initialTodos], newTitle: '', filter: 'active' };
  },
  computed: {
    visible() {
      return this.todos.filter((t) => (this.filter === 'all' ? true : !t.done));
    },
  },
  methods: {
    add() {
      this.todos.push({ id: crypto.randomUUID(), title: this.newTitle, done: false });
      this.newTitle = '';
    },
  },
};
</script>
```

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{ initialTodos: { title: string; done: boolean }[] }>();
const todos = ref([...props.initialTodos]);
const newTitle = ref('');
const filter = ref<'all' | 'active'>('active');

const visible = computed(() =>
  todos.value.filter((t) => (filter.value === 'all' ? true : !t.done))
);

function add() {
  todos.value.push({ id: crypto.randomUUID(), title: newTitle.value, done: false });
  newTitle.value = '';
}
</script>
```

<Callout type="info" title="读懂选项式仍是必要能力">

理由不是怀旧：一部分存量项目、很多库的 README 与高票答案还带 `data()` / `mixins`。你需要的是**翻译能力**，上表就是词典；而你写的每一行代码（含第 12 章项目）只用 `<script setup>`。

</Callout>

## 本站只用 script setup 的四条理由

`<script setup>` 不只是语法糖，它是编译时特性：编译器把整块脚本编译成组件的 `setup()` 返回对象，并做几件手写做不到的事。

1. **类型推断完整。** 顶层 `const n = ref(0)` 在模板里的类型是 `number`（编译器知道它解包了），`defineProps<T>()` 的泛型直接成为 props 类型（[TypeScript 第 7 章](/typescript/inference)在框架里的收益）。
2. **样板少。** 不用 `export default {}`、不用手工注册组件（import 即注册）、不用 `return` 暴露给模板；接口被压成 `defineProps` / `defineEmits` 两行。
3. **编译时优势。** 编译器看得见整个组件，才可能有静态提升、patch flag、`v-memo` 分析（第 10 章）。
4. **与官方生态方向一致。** Pinia、Vue Router 4 的推荐用法都是组合式，官方文档默认示例也是 `<script setup>`。

代价：**它是编译宏的宿主，行为不完全等于普通 JS。** `defineProps` / `defineEmits` / `defineModel` 这类宏只能在顶层调用、不需要从 `vue` import；有顶层 `await` 的组件会被编译成异步组件，必须包在 `<Suspense>` 里。

## 从零到浏览器看到页面

本站所有练习都用官方脚手架创建。**先划清已核实与未核实：`npm create vue@latest`、它支持的 `--typescript` / `--router` / `--with-tests` 这类旗标、「Vue 2 用 `npm create vue@legacy`」是我核实过的（来源见文末）；交互式询问的问题清单与措辞随版本变化，以你本机实际出现的为准。**

```bash
npm create vue@latest todo-app   # 1. 创建（可用旗标跳过交互）
cd todo-app && npm install       # 2. 装依赖
npm run dev                      # 3. 开发服务器
# 另开终端：npm run type-check（靠 vue-tsc）、npm run build、npm run preview
```

开关口径：TypeScript 开、Vue Router 开（第 8 章）、Pinia 开（第 9 章）、ESLint 开、单元测试按喜好（选就选 Vitest）；JSX 与 SSR 先不开。

<Callout type="unverified" title="脚手架交互细节以本机为准">

各问题的名称、顺序、默认勾选，以及「创建后是否自动执行 npm install」这类行为我没有逐项核实，以 `create-vue` 仓库说明与 [工具链文档](https://cn.vuejs.org/guide/scaling-up/tooling.html) 为准。想跳过交互可以直接给旗标：`npm create vue@latest todo-app -- --typescript --router --pinia --with-tests --eslint`（旗标名同样以仓库说明为准）。

</Callout>

创建后的关键文件：`index.html`（Vite 的入口）、`vite.config.ts`（`plugins: [vue()]` 在这里）、`src/main.ts`（`createApp(App).mount('#app')`，Router / Pinia 也在这装）、`src/App.vue`、`src/components/`。

验证路径：`npm run dev` 后终端打印本地地址。**预期结果**是出现 `Vite ready in ... ms` 与 `Local: http://localhost:5173/`（默认端口 5173，被占用会顺延到 5174、5175），打开应见到带 Vue logo 的默认页面；若报「找不到脚本 dev」，说明 `npm install` 没成功。

再建两个习惯：**装 Vue DevTools 浏览器扩展**（第 2 章起所有「响应式没生效」第一步都是打开它）；**改一处看热更新**：把 `App.vue` 模板里一句话改掉保存，浏览器应在不整页刷新的情况下更新文本。

## 单文件组件的三个块

`.vue` 是一个组件的全部三个维度，编译去向各不相同（细节留给第 11 章）：

| 块 | 职责 | 编译去向 | 一句话判断标准 |
| --- | --- | --- | --- |
| template | 结构：给定状态下界面长什么样 | 编译成 `render` 函数 | 出现多行 `if` 就该移走 |
| script setup | 状态与行为 | 编译成组件的 `setup()` | 接口（props / emit）和实现都在这 |
| style scoped | 样式，可加 `scoped` 或 `module` | 加属性做作用域隔离 | 只管自己组件的元素 |

```vue
<script setup lang="ts">
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
  <p>当前值：{{ count }}</p>
  <button @click="count++">加一</button>
</template>

<style scoped>
p {
  color: #42b883;
}
</style>
```

三个块之间是**单向**的：`script` 顶层变量暴露给 `template`；`style` 靠编译期加属性命中 `template` 的元素；`template` 不能给 `script` 传东西——值要通过事件回去（第 5 章）。

## 模板编译成 render 函数

`<template>` 不是运行时的字符串。开发或构建时它被 `@vue/compiler-*` 编译成一个返回虚拟节点树的函数，概念形状（不是编译器真实输出）：

```js
function render(_ctx) {
  return h('p', null, '当前值：' + _ctx.count);
}
```

于是更新链路闭合：**状态变化 → 读过它的组件重新执行 `render` → 新虚拟节点与上一次的 diff → 只把差异写成真实 DOM 操作。**

| 编译发生地 | 谁编译 | 后果 |
| --- | --- | --- |
| 构建时 / 开发时预编译（本站） | Vite + `@vitejs/plugin-vue` 处理 `.vue` 时编译 | 浏览器只收到 JS，产物不必带模板解析器 |
| 运行时编译（CDN 完整包） | 浏览器里的编译器在挂载时解析模板字符串 | 「改 HTML 就生效」，代价是更大体积与每次挂载都解析 |

这也回答「为什么需要构建工具」：**不是 Vue 需要构建，是 `.vue` 这种文件浏览器不认识。** 三个块要有人拆开、编译、拼回一个 JS 模块——这个「有人」就是 Vite 插件（第 11 章）。

## 生态里哪些是官方包

判断标准：npm 页面指向 `github.com/vuejs/*` 的是官方维护。

| 包 | 身份 | 定位 |
| --- | --- | --- |
| `vue` | 官方 | 核心运行时 + 编译器 |
| `vue-router`、`pinia` | 官方 | 官方路由（第 8 章）与官方推荐的状态管理（第 9 章，取代 Vuex） |
| `create-vue`、`@vitejs/plugin-vue`、`vue-tsc`、`@vue/test-utils` | 官方脚手架与工具链 | 建项目、让 Vite 认识 `.vue`、类型检查、组件测试 |
| Nuxt | Nuxt 团队维护；官方文档在 SSR 一节把它作为主要方案介绍 | 元框架：SSR、文件路由 |
| Element Plus / Vuetify / Naive UI、VueUse | 第三方 | UI 组件库、现成 composable 合集（先自己写过再引入，第 6 章） |

**一条实用判断：** 某个「Vue 插件」的文档里出现 `Vue.component()`、`new Vue()` 这类全局构造器写法，那是 Vue 2 时代的包，Vue 3 里用不了。

## 心智模型清单：四条能替你排除错误结论的规律

**1. 数据驱动视图，视图不是第二份数据。** 任何时候都不该有「同步界面」的代码。当你在写「先改 DOM 再改数据」，或维护一个与列表长度保持一致的计数器变量，就违反了这条——后者应该用 `computed` 现算。它排除的问题：「我要去哪里补一次 render」。**不存在补 render，只存在改状态。**

**2. 单向数据流：值向下流，事件向上冒。** 父用 props 传值，子用 `emit` 通知「该改了」，改的动作发生在父。props 是只读的。它排除的问题：「子组件能直接改父组件的数据吗」——不能，但可以请求。

**3. 组件是一个函数，不是一页面。** 组件 = 一次调用：输入 props，输出界面加事件。它没有身份，可被创建任意次，实例之间状态互不相干。所以「这个组件里存着用户数据」是错的说话方式——**是组件实例在一段时间里持有状态，实例销毁状态就没了**。这解释了为什么切路由后表单填的东西没了。

**4. 响应式是自动依赖追踪，不是轮询也不是全局广播。** 谁读了什么被记下，变化时只叫醒记在册的读者（第 2 章）。它排除两个错误想法：「每次改数据都重渲染整个应用」（不是）、「要加监听器才会更新」（不需要，读它就等于订阅）。**也正因为是读时登记，从没被读过的属性变化不会唤醒任何人。**

## 五个常见困惑，直接回答

**1. 为什么不能直接改 props？** 违反第 2 条：值的所有权在父。技术上 Vue 3 的 props 是只读代理，直接赋值在开发模式会告警（形如 `Set operation on key "title" failed: target is readonly`，文案以你的控制台为准）。逻辑上更严重：**即使改成功，父组件下次渲染也会覆盖回去**，你得到一个「偶尔生效」的 bug。按目的分流：要当初始值 → 复制进本地 `ref`；要能改并回传 → `emit` 或 `defineModel`（第 5 章）。

**2. 为什么 `.vue` 双击打不开？** `.vue` 不是浏览器认识的格式。双击时浏览器把纯文本当 HTML 渲染，你看到三个块的源码被当文字打印，`import`、`defineProps`、插值一个都不会执行。

**3. 为什么需要构建工具？** 三个块要有人拆开编译，`lang="ts"` 要转译，`scoped` 样式要加属性。不用构建的那条路只能退回运行时编译，能力停在最弱的一格。

**4. 模板里的 `this` 去哪了？** `<script setup>` 里根本没有 `this`：编译后的 `render` 直接引用 setup 作用域里的变量；选项式的模板里 `count` 隐含 `this.count`。所以两种写法间切换最常见的错是写出 `this.count.value`（没有 this）或在选项式里写 `count.value`（实例上自动解包，不需要）。

**5. Vue 2 资料还能不能用？** 概念层面大多能用；代码层面按这几条一票否决：`new Vue({...})`、`Vue.component()`、`Vue.prototype.$xx`、`mixins`、`filters`、`$set` / `$delete`、`$on` / `$off` 事件总线、子组件上用 `value` + `input` 手写 `v-model`、`beforeDestroy` / `destroyed`。打开文档先确认版本切换器选中 Vue 3——中文站 `cn.vuejs.org` 与 Vue 2 站 `v2.cn.vuejs.org` 是两个不同站点。

## 常见错误与排查

**1. 控制台 `ref is not defined`。** 现象：局部空白 + ReferenceError。原因：`<script setup>` 里从 `vue` import 的 API 不会自动出现。修法：补上 import。反过来，`defineProps` / `defineEmits` 这类**编译宏不需要也不应该从 `vue` import**（第 5 章）。

**2. 改 props 后界面偶发不动 + 只读告警。** 原因：违反单向数据流，父组件重渲染覆盖你的写入。修法：本地 `ref` 复制 / `emit` 请求 / `defineModel`。

**3. 双击 `index.html` 白屏。** 原因：绕过 Vite，浏览器收到未编译的模块与 `.vue`。确认：地址栏是 `file:///...`。修法：走 `npm run dev` 给的地址。

**4. 改了代码界面没变化。** 按序排查：① **地址栏端口是不是旧的**（Vite 端口被占会顺延 5173 → 5174，这条命中率最高）；② 终端有没有编译错误；③ 改的是不是 `public/` 下的静态文件（不参与编译，需刷新）；④ 文件名大小写（Windows 本地不敏感，Linux 构建才炸）。

**5. 照抄示例报 `Cannot read properties of undefined`，示例里有 mixins / filters。** 原因：那是 Vue 2 代码（搜到 `new Vue(` 即定案）。修法：`filters` 换 `computed` 或普通函数；`$set` 在 Vue 3 里根本不需要（第 2 章）。

**6. 用了顶层 await 之后组件什么都不显示。** 原因：`<script setup>` 里有顶层 `await` 会让编译器把组件标记为异步组件，必须包在 `<Suspense>` 的默认插槽里。确认：注释掉那行 `await`，立刻能渲染。

**7. ESLint 报 `vue/multi-word-component-names`。** 原因：默认规则要求组件名多词，避免与 HTML 元素冲突。修法：改名 `TodoItem.vue`，或在配置里关掉该规则——不要为此套一层无意义的 `Base` 前缀。

## 练习

<Exercise title="练习 1 · 把纯 JS 项目的职责逐条对到 Vue" difficulty="基础">

[JavaScript 阶段项目](/javascript/project) 里的一段真实形态代码：

```js
const state = { todos: [], filter: 'active' };

function visibleTodos() {
  return state.filter === 'active' ? state.todos.filter((t) => !t.done) : state.todos;
}

function render() {
  list.innerHTML = '';
  for (const t of visibleTodos()) list.append(makeLi(t));
  left.textContent = state.todos.filter((t) => !t.done).length;
}
```

回答：(1) 哪两件事在 Vue 里不再需要显式写？(2) `left` 那行应该变成什么？(3) 哪个函数对应 `computed`？

<template #answer>

(1) **`render()` 的调用**（改完状态不用手动重画）与 **DOM 查找 + 逐节点重建**（模板 + diff 取代）。注意 `render()` 本身没消失，它变成模板编译出的 `render` 函数，只是不再由你调用。(2) 变成派生值：`const left = computed(() => todos.value.filter((t) => !t.done).length)`，模板里一句插值引用它。(3) `visibleTodos()` 对应 `computed`——从别的状态推导、且被多处读取。「派生数据」用 `computed`、「状态变了要做一件事」才用 `watch`（第 4 章）。

</template>

</Exercise>

<Exercise title="练习 2 · 选项式翻译成 script setup" difficulty="进阶">

把下面的选项式组件改写成 `<script setup lang="ts">`，并列出每处对应关系。

```vue
<script>
export default {
  props: { step: { type: Number, default: 1 } },
  data() {
    return { value: 0, log: [] };
  },
  computed: {
    isBig() {
      return this.value >= 100;
    },
  },
  watch: {
    value(nv, ov) {
      this.log.push(`${ov} -> ${nv}`);
    },
  },
  methods: {
    bump() {
      this.value += this.step;
    },
  },
  mounted() {
    console.log('ready', this.value);
  },
};
</script>
```

<template #answer>

对照（逐条）：`props` 选项 → `defineProps` 泛型（有默认值时套 `withDefaults`，第 5 章）；`data()` → 顶层 `ref`；`computed.isBig` → `computed(() => ...)`；`watch` 选项 → `watch(source, handler)`；`methods.bump` → 普通函数；`mounted()` → `onMounted(...)`。**最容易翻车的是 `.value`：** 选项式 `this.value` 自动解包，组合式脚本里必须 `value.value`，而模板里又不要 `.value`。另外 `withDefaults` / `defineProps` 没出现在 import 里不是漏写：它们是编译宏（练习 3 第 2 小题验证这一点）。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释" difficulty="进阶">

在练习 2 的组件上分别制造这三处错误，预测现象与控制台输出，并解释原因：

1. 把 `value.value += props.step` 改成 `props.step += 1`。
2. 删掉顶部 `import { ref, computed, watch, onMounted } from 'vue'` 整行。
3. 模板里把对 `value` 的插值写成多一层 `.value` 的形式。

<template #answer>

**1. 对 props 赋值。** 预期：开发模式控制台出现只读告警（形如 `Set operation on key "step" failed: target is readonly`，文案以版本为准），赋值不生效；生产构建剥离告警，**静默失败**。这就是「我改了 prop 但界面不动、线上还不报错」的来源。

**2. 忘 import 全部 API。** 预期：Vite 编译阶段不报错（它不做类型检查），运行时 `setup` 执行时抛 `ReferenceError: ref is not defined`，组件挂载失败、局部空白。对比：`defineProps` 不 import 反而合法（要被编译器就地替换）——这个不对称正是本题要记住的东西。

**3. 模板里多写 `.value`。** 预期：**这块文本变成一片空白，控制台一句报错都没有。** 原因：模板对顶层 `ref` 自动解包，`value` 已是数字，再取 `.value` 得 `undefined`，插值把 `undefined` 渲染成空字符串。**「无报错的空白」是解包类问题的典型指纹**，看到它先查 `.value` 是不是写重了。

</template>

</Exercise>

<Exercise title="练习 4 · 用一句话回答三个架构问题" difficulty="挑战">

领域首页的验收标准最后一句是「你能指着代码说清楚：这份状态存在哪里、谁是它的唯一写入者、视图是怎么知道它变的」。以「筛选条件」为例写出答案；再说明这份状态要跨两个路由页面保留时怎么变，以及两种不该选的做法。

<template #answer>

**单页面内、只本组件用：** 存在列表组件的 `const filter = ref('all')`；唯一写入者是模板上的筛选按钮；视图知道是因为它的 `render` 读过 `filter`，依赖登记在册，写入触发重渲染（第 2 章）。

**要跨两个路由页面保留：** 不该再留在组件里——组件实例随路由切换销毁，状态会丢（心智模型第 3 条的直接应用）。三个方向按复杂度排：URL 查询参数（第 8 章）、Pinia store（第 9 章）、提升到共同的父组件。

**两种不该选的：** 用全局 `provide` 藏一个可变对象当共享状态（来源不清、难调试）；组件里存一份、store 里也存一份、两处各改一半（两份真相，必然不同步）。**「唯一写入者」这个词说不出来，状态布局就是错的。**

</template>

</Exercise>

## 官方文档与延伸阅读

每条注明用来核实本章哪个结论（核实时间 2026-10-17）。

- [Vue 3 文档中文主入口](https://cn.vuejs.org/guide/introduction.html) 与 [使用 Vue 的多种方式](https://cn.vuejs.org/guide/extras/ways-of-using-vue.html) —— 「Vue 是什么」的定位、三种接入姿势的场景与代价。
- [组合式 API 常见问题](https://cn.vuejs.org/guide/extras/composition-api-faq.html) —— 核实「两种 API 是同一套运行时的两种组织方式」「为什么推荐组合式」。
- [工具链 / 脚手架](https://cn.vuejs.org/guide/scaling-up/tooling.html) 与 [`create-vue` 仓库](https://github.com/vuejs/create-vue) —— 核实 `npm create vue@latest`、旗标、`@legacy` 用于 Vue 2、`type-check` 从哪来。**交互问答清单标了 unverified，动手前查这两处。**
- [单文件组件](https://cn.vuejs.org/guide/scaling-up/sfc.html) 与 [`<script setup>` API](https://cn.vuejs.org/api/sfc-script-setup.html) —— 三个块的职责边界、编译宏规则、「顶层 `await` 使组件成为异步组件、需 `<Suspense>`」（错误 6）、「宏不需要 import」（错误 1）。
- [渲染机制](https://cn.vuejs.org/guide/extras/rendering-mechanism.html)、[风格指南](https://cn.vuejs.org/style-guide/)、[Vue 2 文档站](https://v2.cn.vuejs.org/) —— 编译时 vs 运行时编译器、组件多词命名约定（错误 7）、确认搜到的是不是停维材料。

## 下一章

本章建立的是「界面是状态的函数、你只管状态」；下一句追问是：**状态怎么变成「会自动通知视图」的状态？** 第 2 章 [响应式原理](/vue/reactivity) 给答案：`Proxy` 真正上场——读属性等于登记依赖、写属性等于唤醒依赖，`ref` 为什么必须带 `.value`、`reactive` 为什么一解构就断。
