# 单文件组件与构建链：一个 .vue 文件从源码到产物

四类故障你一定遇到过其中至少两类。**①** `<style scoped>` 里写 `.card p { margin: 0 }`，页面上毫无反应——那段文字来自子组件，选择器多出来的 `[data-v-xxx]` 它没有。**②** 你按直觉把 props schema 提成一个常量再传给 `defineProps`，构建报「argument must be a literal」。**③** 改了 `<script setup>` 里一行代码，填了一半的表单没了；改 `<template>` 里的文字却状态全在。**④** `npm run build` 之后你在 `dist/assets` 里搜不到自己写的类名——它被哈希了。

共同点是：**`.vue` 不是浏览器能执行的东西，它必须先被编译器改写。** 谁改写、改成什么、改写发生在开发时还是构建时，决定了你的样式作用域、状态保留行为、类型检查时机和最终产物形态。这一章把这些机制讲清楚——不是让你去配置构建工具（那是[前端工程化](/frontend-engineering/)的事），而是让你**看到某个行为时知道它来自哪一层**，从而不写「玄学规避」。涉及插件内部实现（虚拟模块 id 的确切形态、HMR payload 结构）与编译器输出细节的部分本章未逐行核实，会明确标出并给实测路径。

## 三个块的职责：为什么这样切

| 块 | 职责 | 为什么不能合并进另外两块 |
| --- | --- | --- |
| `<template>` | 声明「状态长什么样时界面长什么样」，只能写编译器认识的 HTML + 指令 + 表达式 | 它必须**静态可分析**：正因它是 HTML 而不是任意 JS，编译器才能做静态提升与 patch flag（[渲染性能](/vue/rendering-performance)） |
| `<script setup>` | 声明状态、派生与行为；顶层绑定自动暴露给模板 | 逻辑要能被发现、被测试、被抽成 composable；塞进 template 就没法单独测 |
| `<style>` | 组件的视觉表达，可选 `scoped` / `module` / `lang` | 需要独立的 CSS 链路（PostCSS、预处理器、作用域哈希），与 JS 编译是两条路 |

这和[第 1 章的「单文件组件的三个块」](/vue/mental-model)是同一件事的两端：那章讲「为什么这样组织代码」，本章讲「这样组织之后编译发生了什么」。顺带回答一个高频困惑：**`.vue` 里没有 `export default`，不代表它不是模块**——`<script setup>` 编译后就导出一个组件选项对象，`import MyComp from './MyComp.vue'` 拿到的正是它。

<Callout type="unverified" title="块的数量与组合规则请查语法规范">

一个 `.vue` 里能有几个 `<style>`、`<script>` 与 `<script setup>` 能否共存、混用时哪些代码留在模块作用域（只执行一次的那部分）——规则逐条写在官方 [SFC 语法规范](https://cn.vuejs.org/api/sfc-spec.html) 里，本章未核实，不要靠第三方文章记规则。

</Callout>

## `<script setup>` 的编译产物大致是什么

`<script setup>` 是**编译时语法糖**。概念级的产物三步：

1. 顶层声明的变量、函数与 `import` 进来的值被收集成组件 `setup` 的返回值（由编译器生成），模板里对它们的引用被替换成对这些绑定的访问。官方原话（2026-10-17 核实）：「任何在 `<script setup>` 声明的顶层的绑定（包括变量、函数声明，以及 import 导入的内容）都能在模板中直接使用」。
2. `<template>` 被编译成 `render` 函数——就是带 patch flag 与静态提升的那份优化输出。
3. `defineProps` / `defineEmits` / `defineModel` 等宏**被编译掉**，不会出现在运行时；其参数被提取成组件选项对象上的 `props` / `emits` 字段。官方对前两者的表述（2026-10-17 核实）：「都是只能在 `<script setup>` 中使用的编译器宏。它们不需要导入，且会随着 `<script setup>` 的处理过程一同被编译掉」。

**本章刻意不给「编译后长这样」的具体代码**：生成代码的形状随版本变化（内联 render 的开关、中间变量名都可能调整），编造一段让你背只会误导。想知道自己那段代码的真实产物，路径是确定的：**在 [Vue SFC Playground](https://play.vuejs.org/) 右侧「输出」面板看生成文件**，或本地 `npm run build` 后在 `dist/assets/*.js` 里搜你的变量名。用这条路径核对，比任何教程可靠。

## 编译宏的共同点：它们不是函数，所以有约束

`defineProps`、`defineEmits`、`defineExpose`、`defineOptions`、`defineSlots`、`defineModel` 的共同点：**都不是从 `vue` 导入的函数，是编译器处理 `<script setup>` 时识别并消费的语法。** 同页列出的 `useSlots` 与 `useAttrs` 是例外——它们是运行时 API，需要 `import { useSlots } from 'vue'`（这一区分以官方 [`<script setup>` API 页](https://cn.vuejs.org/api/sfc-script-setup.html) 为准，2026-10-17 核实该页把两者与宏并列）。

| 宏 | 用途 | 版本（官方页标注，2026-10-17 核实） |
| --- | --- | --- |
| `defineProps` / `defineEmits` | 声明 props 与事件，支持运行时对象写法与纯类型写法 | `<script setup>` 起即有 |
| `defineExpose` | 显式暴露实例成员给父级模板引用（默认不暴露） | `<script setup>` 起即有 |
| `defineOptions` | 在 `<script setup>` 里声明组件选项（`name`、`inheritAttrs` 等），不用另开 `<script>` | **3.3+** |
| `defineSlots` | 给插槽名与插槽 props 提供类型提示 | **3.3+** |
| `defineModel` | 声明父子双向绑定的 prop，两侧都免写 `props` + `emit` 样板 | **3.4+** |

版本线很实际：`defineModel` 在 3.3 及更早不可用，网上大量教程仍写「`props.modelValue` + `emit('update:modelValue')` 手写双向绑定」——那种写法今天依然有效，只是啰嗦。**如果 `defineModel` 在你的项目里报错，先看 `package.json` 里 `vue` 与 `@vitejs/plugin-vue` 的版本，而不是改代码。**

**为什么必须有编译器参与**：宏的输出是「组件选项对象上的静态字段」，而 `props` / `emits` 必须在**组件实例化之前**确定（运行时 props 校验、生成响应式 `props` 代理、给 IDE 提供类型都依赖它）。如果 `defineProps` 是真函数，它只能在 `setup` 执行时才会被调用，太晚；而类型写法 `defineProps<{ text: string }>()` 里的泛型参数在运行时根本不存在，只能靠编译期读类型。**「编译宏」是把类型层的信息搬进运行时选项的唯一通道。**

代价是三条约束：**① 参数必须是字面量**（`defineProps(schema)` 报错；类型位置可以引用同文件的类型声明与 `import type` 的类型，但不能是动态生成的值）；**② 不能被条件调用**（写在 `if` / `for` 里编译器看不见分支）；**③ 不能被 `import`**（`import { defineProps } from 'vue'` 失败，`.vue` 之外的纯 `.ts` 文件也调不到）。

## lang="ts" 与 generic：组件级泛型

**`lang="ts"` 只做语法解析，不做类型检查。** 这是本章最重要的工程事实：Vite / `@vitejs/plugin-vue` 把 TS 语法转译掉（抹掉类型），**不校验**。类型检查靠 `vue-tsc`（能读进 SFC）或编辑器的 Vue 语言服务。所以[阶段项目](/vue/project)的验收里 `npm run type-check` 与 `npm run build` 是两条独立命令——这和 [TypeScript 阶段项目](/typescript/project)里「`npx tsc -p .` 必须进 CI，Vite 本身不做类型检查」是同一个坑在 Vue 侧的复现。

拿到 TS 之后的类型能力集中在几处：`defineProps<{...}>()`、`defineEmits<{ change: [id: number] }>()`、`ref(todos)` 的元素类型推断（回指[类型推断](/typescript/inference)）、store 的返回类型。泛型写法与运行时写法**不能混在同一个 `defineProps` 调用里**；选了泛型就用 `withDefaults` 给默认值。

**组件级泛型**用 `generic` 属性：

```vue
<script setup lang="ts" generic="T">
const props = defineProps<{
  items: T[];
  rowKey: (item: T) => string;
}>();

const picked = defineModel<T>();
</script>

<template>
  <ul>
    <li v-for="item in props.items" :key="props.rowKey(item)" @click="picked = item">
      <slot :item="item"></slot>
    </li>
  </ul>
</template>
```

四条要点：① `generic` 写在 `<script>` 标签上，**必须同时有 `lang="ts"`**（官方 2026-10-17 核实：「可以使用 `<script>` 标签上的 `generic` 属性声明泛型类型参数」，示例均带 `lang="ts"`；该特性 3.3 起提供，动手前核对该页版本线）。② `T` 在整个文件的类型位置可用：`defineProps`、`defineEmits`、`defineModel`、`defineSlots` 与你自己写的类型别名。③ 多参数与约束照 TS 写：`generic="T, U extends string"`。④ **代价是可读性与调试**：报错里出现 `T`、作用域插槽的推导链变长、单测要具体化泛型实参。判据：只有当你真在写「与内容类型无关的容器」（通用列表、选择器、表格）时才用；给单一业务类型的组件套泛型是纯负债。

## `<style scoped>` 的实现机制：属性选择器，不是 Shadow DOM

官方 API 页（2026-10-17 核实）的实现描述很具体：**通过 PostCSS 转换**，`.example { color: red }` 编译成 `.example[data-v-f3f3eg9] { color: red }`，同时给组件渲染的每个元素注入 `data-v-f3f3eg9` 属性。**同一组件的所有实例共享同一个哈希**（来自文件路径与内容），所以它是「组件类型级隔离」，不是实例级隔离。

三条边界都是同一规则的推论：

**① 子组件的根节点会同时被父组件的 scoped 样式命中。** 官方原话（2026-10-17 核实）：「子组件的根节点会同时被父组件的作用域样式和子组件的作用域样式影响」。这不是 bug，是有意让父组件能决定子组件的外边距与尺寸。**但它也是「我明明 scoped 了为什么还是被外面改了」的头号原因**：父级 `.card { border: ... }` 会打到子组件根元素，胜负看特异度。**② 编译期注入的属性不会出现在运行时生成的 DOM 上**——`v-html` 的内容、`innerHTML` 写的字符串、第三方库自己塞进你容器的节点都不带 `data-v`。**③ 插槽内容属于父组件作用域**：插槽里的节点写在父级模板里，带父级的 `data-v`，**子组件的 scoped 选不中它们**。

| 伪类 | 官方语义（2026-10-17 核实） | 什么时候用 |
| --- | --- | --- |
| `:deep()` | scoped 里的选择器想做更「深度」的选择、影响子组件 | 选不中 `v-html` 内容、要覆盖第三方组件内部类名、要命中子组件根之后的多层结构 |
| `:slotted()` | 明确地把插槽内容作为选择器目标 | 容器组件给传入的插槽内容设默认样式 |
| `:global()` | 让其中一条规则应用到全局，省得另开 `<style>` | 被 JS 挂到 `body` 的元素、动画关键帧等确实必须全局的少数规则 |

**「而不是全靠穿透」这条纪律**：`:deep()` 一多，`scoped` 就失去意义了——你只是把全局样式拆成看起来局部、实际上照样打架的碎片，还额外抬高了特异度。合理配比是：组件自己的结构用普通选择器；子组件的外部尺寸靠根节点那条有意留的口子；**只有跨越了编译期边界（`v-html` / 第三方 DOM / 插槽内容）才用伪类**。判据：如果你写 `:deep()` 是为了覆盖**你自己写的另一个组件**，那应该改成给它传 props 或暴露 CSS 自定义属性。

```vue
<style scoped>
.card { padding: 12px; background: var(--surface-1); }
:slotted(img) { border-radius: 8px; }
.article :deep(p) { line-height: 1.7; }
</style>
```

最后一行是本节与[值、单位与自定义属性](/css/units-and-custom-properties)的衔接点：**CSS 自定义属性走继承，`var()` 由浏览器在运行时解析，编译期的属性选择器对它没有任何影响。** 所以主题切换（亮/暗）必须靠自定义属性 + 挂在全局祖先（`html` / `body`）上的类或 data 属性，**而不是每个组件自己 scoped 一份颜色**。这是[阶段项目](/vue/project)设置页能只有一个 `setTheme()` 写入点的技术前提——组件里只写 `var(--surface-1)`，主题值由站点级样式表提供。

## 全局样式、CSS Modules 与样式组织

**不用 scoped 的场景是真实的**：reset、排版、主题变量、`@keyframes` 本来就该全局，通常放 `src/assets/main.css` 之类并在 `main.ts` 里 `import './assets/main.css'`。把这些也 scoped 一遍，等于给每处都加一层「为什么我的 reset 没生效」。多个 `<style>` 块可以共存，常见分工是：一个不带 `scoped` 的块专放令牌与关键帧，其余块 `scoped`。

`<style module>` 被编译为 CSS Modules，生成的类名通过 **`$style` 对象**暴露给组件，且类名会被哈希化以避免冲突（官方 2026-10-17 核实）。模板里写 `:class="$style.card"`。

| 维度 | `scoped` | `<style module>` |
| --- | --- | --- |
| 隔离机制 | 属性选择器 + 普通类名 | 类名本身被哈希，经 `$style` 取 |
| 书写感受 | 和平时写 CSS 一样，后代选择器自由 | 每个类名都要过 `$style`，不能自由写深层嵌套 |
| 覆盖第三方组件 | 直接写它的类名，配 `:deep()` | 第三方类名不在 `$style` 里，写法变扭 |
| 测试与自动化定位 | 类名可预期 | 类名每次构建可能变，得改用 `data-testid` 或语义选择器 |
| 适合初学者 | **是**：改动小、心智负担低 | 否：它的收益（几乎不可能撞名）不在你当前痛点上 |

**结论：本项目与绝大多数 Vue 项目用 `scoped`；`<style module>` 留给「跨团队共享的设计系统包、类名撞车已经真实发生」的场景。** 两者可以在同一文件各开一块，但别在同一份样式里混两套选择哲学。

`@import` 由构建工具处理并内联进产物（不会留成运行时请求），路径靠别名解析（`@/styles/tokens.css` 需要 `resolve.alias`，create-vue 默认已把 `@` 指向 `src`）。组织上只做三层：**令牌 + 全局排版 + 组件内样式**；不要按「button.scss / card.scss」建一套平行于组件体系的样式目录——那会让样式的唯一写入者变成两处，和[组合式函数](/vue/composables)里「不要藏全局状态」是同一条纪律。预处理器（`lang="scss"` / `sass` / `less`）**不是内置能力**，要额外安装依赖（如 `sass`），缺依赖时报「Preprocessor dependency not found」——这类报错的根因永远是缺包，不是语法写错。

## Vite 对 .vue 做了什么

**开发时（`npm run dev`）。** Vite 用浏览器原生 ESM 做按需编译：请求哪个模块就编译哪个，冷启动与项目规模几乎无关。`.vue` 不是浏览器能解析的模块，于是 **`@vitejs/plugin-vue` 把单个 SFC 拆成多个「虚拟模块」分别响应**：模板、脚本、每个样式块各占一个可请求的模块 id（靠 query 参数区分类型与索引）。这就是 Network 面板里那些带 `?vue` 后缀的奇怪请求的来源，也是 HMR 能精确到「只换模板、不重跑 setup」的原因。

**HMR 的状态保留。** 你能直接感知的结果：**改 `<template>` 的结构或文字、改 `<style>`，组件实例不销毁，页面状态（输入框内容、已展开面板、`ref` 的值）保留；改动涉及 `<script setup>` 的逻辑（尤其状态声明与选项字段）时，组件通常被重建，局部状态归零。** 需要在改脚本时也保留状态的能力是存在的（社区称 reactive HMR，需要显式开启插件选项），默认关闭。

<Callout type="unverified" title="HMR 规则请自己测一遍再记">

上面这条保留/重置的分界是「通常行为」，具体边界（哪些 `<script setup>` 改动被判定为只影响渲染函数、哪些强制整页重载）本章未逐条核实，也不属于官方文档承诺的稳定契约。实测路径很短：给组件加 `<input v-model="draft">` 并在 `setup` 里放一句 `console.log('setup 执行')`，输入文字后分别（a）改模板一句文案、（b）改 style 一个颜色、（c）在 `<script setup>` 里新增一个 `const x = ref(1)`，每步看输入框内容是否还在、日志是否重跑。**这次实测同时解释了三件事**：本章的保留规则、[第 3 章](/vue/template-syntax)「用 `key` 强制重建实例」、以及为什么把不希望被重置丢掉的数据提升进 [store](/vue/pinia) 是正确的架构决定。

</Callout>

**构建时（`npm run build`）。** 同样的拆分与编译发生一次，然后交给 Rollup：依赖图解析、tree-shaking、代码分割（`import()` 与路由懒加载在这里变成独立 chunk）、资源加哈希与文件名指纹。**产物在 `dist/`：一个 `index.html` + `assets/` 下的 JS / CSS / 图片。** 「`dist` 里搜不到你写的类名」是正常的——CSS 被抽成独立文件、类名带哈希（`scoped` 的 `data-v` 属性名保留，类名不保留）。chunk 怎么切、体积怎么压，见 [Vite 开发侧：原生 ESM、预构建与 HMR](/frontend-engineering/vite-dev) 与 [Vite 构建侧：打包、代码分割与产物分析](/frontend-engineering/vite-build)，本章不重复配置项。

## 目录组织约定：一个真实项目树

约定不是风格偏好，它回答「新同事找一个状态要走几个地方」。下面是 create-vue 生成后再加两层的常见形态（`.vue` 用 PascalCase，`.ts` 用 camelCase）：

```text
todo-app/
├── index.html                  # Vite 的 HTML 入口
├── vite.config.ts              # 插件注册与别名
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── eslint.config.ts            # 扁平配置（ESLint 9）
├── env.d.ts                    # SFC 类型垫片
├── package.json                # dev / build / preview / type-check / test:unit / lint
├── src/
│   ├── main.ts                 # 创建应用、挂 router 与 pinia、引全局样式
│   ├── App.vue                 # 只有布局骨架与 <RouterView />
│   ├── assets/base.css         # 全局（不 scoped）：reset + 主题自定义属性
│   ├── components/             # 可复用零件：TodoItem.vue / TodoList.vue / AppHeader.vue
│   ├── composables/            # 无 UI 的复用逻辑：useTodos / useLocalStorage / useTodoQuery
│   ├── views/                  # 一个路由对应一个页面：TodoListView.vue / SettingsView.vue
│   ├── stores/                 # Pinia：todos.ts / settings.ts / auth.ts
│   ├── router/index.ts         # 路由表（组件用动态 import 懒加载）、守卫、scrollBehavior
│   ├── services/               # 数据层适配：todoRepository.ts（现在 localStorage，之后 fetch）
│   ├── types/model.ts          # Todo 判别联合、入参类型、DTO
│   └── utils/                  # 纯函数：日期格式化、id 生成
└── public/                     # 原样拷进 dist 的文件（favicon.ico）
```

四条划分标准比目录名重要：**① `views/` 放页面、`components/` 放零件**，判据是「被路由表直接引用」；页面组件不该被别处 import，要复用就下沉。**② `composables/` 只放逻辑、不写样式；`services/` 只放与外部世界打交道的代码**（`fetch`、`localStorage`、第三方 SDK），不发响应式；状态归 `stores/`。这三个目录混用的项目，最后没人知道一个 bug 该在哪层修。**③ `types/model.ts` 是全项目唯一「Todo 长什么样」的答案**（延续 [TypeScript 阶段项目](/typescript/project)「不许重复定义字段」的纪律）。**④ `public/` 与 `src/assets/` 的区别**：前者原样输出、路径写死、不加指纹；后者参与构建图，被 `import` 才生效。favicon 放 `public/`，列表里动态渲染的图放 `src/assets/`。

**组件命名**：文件与组件名用 PascalCase、**多单词**（`TodoItem.vue` 而不是 `Item.vue`）——多单词是为了在模板里和原生元素一眼区分，官方[风格指南](https://cn.vuejs.org/style-guide/)有此规则。`views/` 的名字跟着路由走（`TodoListView`），路由 `name` 与组件名一致，DevTools 可读性与 `<KeepAlive :include>` 都依赖这点。**跨目录引用一律用别名（`@/components/TodoItem.vue`），不用 `../../`**——相对路径在移动文件时必炸，而别名由 `vite.config.ts` 与 `tsconfig` 各配一次（create-vue 已配好）。

## 静态托管约束：产物是 .html，路由是 history

**① 本站（VitePress 文档站）的 `cleanUrls: false`。** 它决定**输出产物带 `.html` 后缀**（`vue/sfc-and-build.html`），因此站内链接写法、服务器文件路径与 sitemap 三者必须一致，死链检查也要按 `.html` 目标比对。这解释了本站为什么要求「链接写 `/css/flexbox` 不带后缀」而产物里却有后缀——那是渲染层与站点配置共同的结果。

**② 你的 Vue 应用在 history 模式下必须配 rewrite。** 这是 SPA 的经典故障：**直接访问 `/todos/12` 或刷新它得到 404**，因为服务器上不存在这个文件——路径是前端路由解析的，服务器只会去找 `/todos/12` 这个资源。修法是把「找不到文件」的请求全部回退到 `index.html`：

```nginx
server {
  listen 80;
  root /var/www/todo-app/dist;
  index index.html;

  location /assets/ {            # 带指纹，可长缓存
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  location / {                   # 找不到文件就交给 SPA
    try_files $uri $uri/ /index.html;
  }
}
```

<Callout type="warn" title="这段 nginx 配置未在本机验证">

写作环境是 Windows，没有 nginx 服务，上面的片段**未执行验证**，依据是 [nginx 官方文档](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files) 的 `try_files` 语义与 SPA 的产物形态。验证路径：`npm run build` 后用 `npm run preview`（Vite 的预览服务器自带 SPA 回退）访问任意不存在的路径应返回 `index.html`，再由前端路由显示 404 页；真实环境按 [从零接管一台 VPS](/devops/deploy-to-vps) 与 [Nginx](/linux/nginx) 的配置实跑一次。**只在 `npm run dev` 里测过就交付，是这个坑的标准成因**——dev server 自带回退，会掩盖问题。

</Callout>

**③ 不想配 rewrite 就用 hash 模式**：`createWebHashHistory()` 把路由塞进 `#/todos/12`，`#` 后面不参与 HTTP 请求，任何静态服务器都不用配回退——代价是 URL 难看、锚点语义被占用。**默认仍选 history**，把 rewrite 当作部署的一部分。

## 组件自动导入插件：为什么不推荐给初学者

`unplugin-vue-components` 自动注册 `components/` 下的组件（模板里写 `<TodoItem>` 不用 import），`unplugin-auto-import` 连 `ref` / `computed` / `useRouter` 都自动导入，靠生成 `components.d.ts` / `auto-imports.d.ts` 给 IDE 补类型。它们确实省 keystroke，但对现阶段是**净负债**：

1. **来源不可见，机制也就不透明。** 你刚在本章建立的「import 进来的组件自动注册」这条规则，被另一条隐式规则覆盖；两套隐式机制并存时，「这个组件哪来的」变成要查配置才能回答的问题。
2. **CI 与本地不一致。** 类型声明文件由插件在 dev/build 时生成、需要进版本库；忘提交或顺序不对，`npm run type-check` 在别人机器上报「找不到组件」，你这里一切正常——这类问题最难归因。
3. **同名与目录扫描规则会静默覆盖**，`dirs` / 排除规则又是一层要维护的知识。
4. **它优化的东西你还没付过成本。** 少写几行 import 对初学者收益接近 0，而显式 `import` 的副产品很值钱：从文件顶部就能读出这个组件依赖了什么，代码审查与重构时靠它。

**结论：本站项目一律手写 `import`。** 什么时候值得上：组件数量到几百、跨团队复用，或已经在用 Nuxt（那里自动导入是框架默认）；到时候也要把 `components.d.ts` 纳入提交与检查。

## 常见错误与排查

**1）`<style scoped>` 写了没生效。** 原因四选一：① 目标是子组件内部节点（→ `:deep()`）；② 是插槽内容（→ `:slotted()`）；③ 是 `v-html` 或第三方库生成的 DOM（→ `:deep()`）；④ 被父级 scoped 打到子组件根节点的那条规则按特异度压过。怎么确认：DevTools 里看已匹配规则的选择器是否带 `[data-v-...]`、有没有被划掉。怎么修：先按上面那张分工表判断该用哪个伪类，最后才考虑提高特异度，**不要**去父组件删 `scoped`。

**2）`defineProps` 报「argument must be literal」或「Cannot find name」。** 前者：传了变量、或在分支里调用（宏要静态分析）。后者：文件不是 `<script setup>`（写成了 `<script>` + `export default` 的选项式），或你试图 `import { defineProps } from 'vue'`。怎么确认：看第一行标签是不是 `<script setup lang="ts">`。怎么修：schema 写成内联字面量或纯类型泛型参数；宏不要导入。

**3）`defineModel` 报错或行为像只读。** 原因：`vue` 低于 3.4；或父组件写的是 `:model-value` + 手动监听；或父子 `v-model` 名字对不上（无参 `defineModel` 绑 `modelValue`，具名要两侧字面一致）。怎么确认：`npm ls vue` 看版本；DevTools 里看子组件的 props 到底有没有那个名字。怎么修：升级，或改回手写 `props` + `emit`（等价、有效、啰嗦）。名字对不上时**不报错，只是静默不同步**，这是它最难查的形态。

**4）改了代码浏览器不更新，或状态莫名丢失。** 前者：HMR 失败后需要整页重载而你停在旧标签；或 `npm run preview` 停的是旧 `dist`。后者：你改的正好是 `<script setup>` 里的状态声明，组件被重建。怎么确认：Console 里有没有 `[vite] hot updated: /src/xxx.vue`。怎么修：硬刷新排除缓存；把不希望被重置丢掉的数据提升进 store。

**5）`npm run build` 通过但 `npm run type-check` 一堆错。** 不是矛盾，是分工（Vite 只转译）。怎么修：`type-check`（`vue-tsc --build`）进提交前检查与 CI。反向情况：`type-check` 报「找不到模块 `./App.vue`」→ 缺 SFC 类型垫片（`env.d.ts`）或编辑器没用 Vue（Volar）语言模式、与旧的 Vetur 冲突。

**6）直接访问某个路由 404 / 刷新就没了。** 服务器缺 `try_files` 回退（见静态托管一节）。dev 模式不会重现，**必须在 `dist` 上验**。

**7）子组件样式到处打架。** 现象：一处改动让远端组件变形。原因：`:global()` 与不带 scoped 的块本来就是全局的，再靠 `!important` 硬压会连锁升级。怎么确认：DevTools 搜类名看它出现在几个组件里。怎么修：全局样式集中在一个不 scoped 的块，组件内一律 scoped；`!important` 只允许出现在「覆盖第三方组件库内部样式且已尽力提高特异度」这一种情况，并在注释写明是哪一层。

## 练习

<Exercise title="练习 1 · 读编译产物，回答三个问题" difficulty="基础">

在 [Vue SFC Playground](https://play.vuejs.org/) 贴一个只有 `<script setup>` 与 `<template>` 的组件：一个 `count` ref、一个按钮、一句插值。回答：① 顶层的 `count` 与 `increment` 出现在生成代码的什么位置？② 模板有没有变成一个函数？③ 换成普通 `<script>` + `export default { setup() { return { count } } }`，差异是什么？

<template #answer>

这条练习的价值在于你亲手确认「编译产物随版本变化」，所以**不要背结论，只建立三条判断**。

① 顶层绑定出现在 `setup()` 的返回值里（或与新式产物等价的绑定对象中），模板里对 `count` 的引用变成对它的访问。这就是官方「顶层绑定可直接在模板使用」那句话的实现形态：**不是运行时反射，是编译器在生成时建立的映射。**

② 是。模板被编译成一个渲染函数（在 playground 里可能内联在组件对象上，也可能是独立输出，形态取决于版本与选项）。顺带能看见静态节点被提到函数外面——那就是[渲染性能](/vue/rendering-performance)讲的静态提升，不必相信任何人的描述，自己在输出里找那些被提取出去的节点。

③ 手写 `setup()` + `return` 时编译器不再帮你收集绑定：**忘 return 的变量在模板里就是 undefined**（Vue 会给出「Property X was accessed during render but is not defined」警告）。`<script setup>` 的全部便利就是消除这一类 bug，所以它才叫语法糖。另一差别：`export default {}` 是运行时真实存在的对象，宏在这种写法里没有意义——props 直接写成选项字段。

延伸自查：贴一个 import 子组件的例子，看它如何出现在产物里。**这解释了一个常见故障：忘记 `import` 子组件时，模板里的 `<TodoItem>` 被当自定义元素并产生「Failed to resolve component」警告。**

</template>

</Exercise>

<Exercise title="练习 2 · 给五个样式需求选对作用域手段" difficulty="进阶">

分别选「普通 scoped 选择器」「`:deep()`」「`:slotted()`」「`:global()`」「不带 scoped 的全局块」，各写一句理由：
(a) 把 `v-html` 渲染的富文本里的 `p` 设为 `line-height: 1.7`；(b) 定义全站共享的主题色自定义属性；(c) 容器组件希望父级传进默认插槽的 `img` 都圆角；(d) 覆盖第三方日期选择器内部 `.dp-day.selected` 的背景；(e) 给被 JS 挂到 `document.body` 的弹窗写一条动画类。

<template #answer>

(a) **`:deep()`**：`v-html` 生成的节点在编译期不存在、不带 `data-v`。写法 `.article :deep(p)`——保留 `.article` 这层自己的作用域，只把 `p` 交给深选择器。

(b) **不带 `scoped` 的全局块**（`src/assets/base.css`，在 `main.ts` 引入）：自定义属性靠继承生效，主题切换需要 `html`/`body` 上一个全局写入点，scoped 对它毫无意义也不该有意义（回指[值、单位与自定义属性](/css/units-and-custom-properties)）。

(c) **`:slotted(img)`**：插槽内容属于父组件作用域，子组件普通 scoped 选不到，这是官方给的唯一入口；注意它只能选插槽里的元素，选不到内容里的深层后代。

(d) **`:deep()`**：第三方 DOM 是运行时塞进你容器的，编译期看不见。同时**先包一层自己的块作用域**（`.booking-form :deep(.dp-day.selected)`），把覆盖范围限制在这个组件，别让它变成全局规则。

(e) **`:global()` 或全局块**：元素不在本组件 DOM 树里，属性选择器不可能命中。两处以上就放全局块；`@keyframes` 也建议放全局，避免动画名被 scoped 处理后与 JS 里写的名字对不上。

**判断顺序记一条**：先看「目标节点是谁生成的」（本组件模板 / 插槽内容 / 运行时生成 / 第三方库 / 组件外），再选机制。顺序反了就会出现「明明加了规则但不生效」，然后一路 `!important`。

</template>

</Exercise>

<Exercise title="练习 3 · 故意让编译宏报错并解释" difficulty="挑战">

写一段把 props schema 提到外部常量再传给 `defineProps` 的代码，预测构建时的行为；给出两种合法修法，并说明为什么编译器不能支持外部变量。

<template #answer>

制造方式：

```vue
<script setup lang="ts">
const schema = { text: { type: String, required: true } };
const props = defineProps(schema);   // 报错
</script>
```

**预期行为（请在自己项目里跑一次确认，本章未在本地构建验证）**：编译器抛出针对 `defineProps` 的参数错误，大意是「参数必须是字面量对象或类型引用」。它是**编译期**错误，不是运行时警告——`npm run build` 与 dev server 的覆盖层都会显示这条错误，浏览器里连组件都不会出现。

为什么不支持外部变量：宏的输出是「组件选项对象上静态可见的 `props` 字段」，这份信息必须在编译期被提取，用于三件事：给模板的 props 访问生成正确代码、给 IDE 提供 props 类型、生成运行时校验。如果参数是变量，编译器就得在没有 JS 运行时的情况下求值它——静态求值跨文件变量等于把编译器变成半台 JS 引擎，且无法处理分支、函数调用、异步来源。所以官方直接禁止，而不是「有限支持」。

修法一（同文件内联泛型 + 默认值）：

```vue
<script setup lang="ts">
const props = withDefaults(
  defineProps<{ text: string; size?: 'sm' | 'lg' }>(),
  { size: 'sm' },
);
</script>
```

修法二（把类型抽到 `types/`，仍然合法）：

```vue
<script setup lang="ts">
import type { TodoItemProps } from '@/types/props';

const props = defineProps<TodoItemProps>();
</script>
```

`import type` 是纯类型引用，编译器读得到；**导入的普通值不行**。真需要跨组件共用校验规则时，回到运行时写法在各组件里写内联字面量，别指望 `defineProps(makeSchema())`。最后一条纪律：泛型写法与运行时写法不能混在同一个调用里，需要默认值就靠 `withDefaults`。

</template>

</Exercise>

## 官方文档与延伸阅读

- [SFC 语法规范](https://cn.vuejs.org/api/sfc-spec.html) —— 核实块的数量与组合规则、各块的 `lang` / `src` 属性（本章已标 unverified 的那条）。
- [SFC `<script setup>`](https://cn.vuejs.org/api/sfc-script-setup.html) —— 本章宏表的版本线全部依据：`defineOptions` 与 `defineSlots` 为 3.3+、`defineModel` 为 3.4+、`generic` 需 `lang="ts"`，以及「宏不需要导入、会被编译掉」与「顶层绑定可直接在模板使用」的原话（2026-10-17 核实）。
- [SFC CSS 特性](https://cn.vuejs.org/api/sfc-css-features.html) —— `scoped` 一节的全部依据：PostCSS 转出的 `[data-v-f3f3eg9]`、「子组件根节点同时受父与子作用域样式影响」、`:deep()` / `:slotted()` / `:global()`、`<style module>` 与 `$style` 及类名哈希化（2026-10-17 核实）。
- [工具链与脚手架](https://cn.vuejs.org/guide/scaling-up/tooling.html) —— create-vue 的能力清单与「Vite 是官方推荐构建工具」。注意该页**不承诺**本章讨论的 HMR 状态保留规则。
- [Vue 与 TypeScript 总览](https://cn.vuejs.org/guide/typescript/overview.html) —— `lang="ts"`、泛型声明、`vue-tsc` 的定位与类型垫片。
- [Vue 风格指南](https://cn.vuejs.org/style-guide/) —— 组件名多单词、PascalCase、`views` 与 `components` 的职责划分。
- [Vite 插件 API](https://vite.dev/guide/api-plugin.html) 与 [Vite 构建生产版本](https://vite.dev/guide/build) —— 核实「虚拟模块」「按需编译」「Rollup 打包」这些描述；深入配置归 [Vite 开发侧](/frontend-engineering/vite-dev) 与 [Vite 构建侧](/frontend-engineering/vite-build)。
- [create-vue 仓库](https://github.com/vuejs/create-vue)、[nginx `try_files` 文档](https://nginx.org/en/docs/http/ngx_http_core_module.html)。

## 下一章

本章把 `.vue` 从源码追到产物：三个块的职责与静态可分析性、`<script setup>` 的编译宏为何必须是字面量、`scoped` 的属性选择器机制与它的三条边界、Vite 开发期拆分与构建期打包、目录约定与托管约束。它解释了[渲染性能](/vue/rendering-performance)那句「静态可分析是一切优化前提」的来处，也为[工程化体检](/frontend-engineering/project)准备了问题清单——你现在已经知道 `build` 通过不代表类型没问题、`dist` 上的行为必须真在 `dist` 上验。

[第 12 章是 Vue 领域的阶段项目《多页面待办应用》](/vue/project)：把前 11 章装进一个结构完整的应用。它是进入[后端领域](/backend/)之前的验收关卡——数据层用可替换的适配函数隔离出来，正是本章 `src/services/` 那一条；URL 与筛选同步、路由守卫、store 的唯一写入者、1000 条不卡死，每一章都在那里有对应的验收项。
