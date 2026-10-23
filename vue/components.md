# 组件基础：props 向下、事件向上、插槽往里

组件边界上的四类故障，每一个都常见到你会以为是框架在故意为难你。

**一类**：子组件里写了 `props.count++`，界面动了一下又弹回原值，控制台一行 `Set operation on key "count" failed: target is readonly`。**二类**：父组件给子组件加了个 `class="mt-4"`，外边距没出来——因为子组件是多根节点，属性无处可去。**三类**：插槽内容永远显示默认文案，你检查了半小时拼写，原因是子组件里写的是 `<slot name="header">`，父组件给的是 `#head`——**插槽名不匹配是静默失败，不报错**。**四类**：一个 `<TaskForm>` 收十四个 props，其中六个只在提交时用到，改一个字段要同时动父、子、和第三个通过它中转的中间层。

前三类是「机制没搞清」，第四类是「接口没设计」。它们共用一条底层规则：**组件是一个函数，输入是 props 和插槽，输出是渲染结果和事件；这条数据流只能单向。** 把这条规则装进脑子，四类的修法都能自己推出来。

前置：[模板语法与指令](/vue/template-syntax)（`v-bind` / `v-on` 的简写与表达式边界）、[响应式原理](/vue/reactivity)、[计算属性与侦听器](/vue/computed-and-watch)（可写计算属性，本章 `v-model` 的机制就是它）。类型部分依赖 [TypeScript 泛型](/typescript/generics)。

## 组件注册：`<script setup>` 已经把这件事做掉了

组件文件是 `FooBar.vue`（单文件组件，Single File Component，简称 SFC）。三种让模板能用上它的方式：

| 方式 | 写法 | 什么时候用 | 代价 |
| --- | --- | --- | --- |
| `<script setup>` 自动注册 | `import FooBar from './FooBar.vue'`，模板里直接 `<FooBar />` | **默认方式，本站全用它** | 无。导入即注册，未使用的导入会被编译器剔除 |
| 显式局部变量 | 非 `<script setup>` 时写 `export default { components: { FooBar } }` | 存量选项式组件 | 得手写 `components`，且 `this` 类型推断弱 |
| 全局注册 | `app.component('FooBar', FooBar)` | 极少量基础组件（图标、按钮）确实想「模板里直接写不 import」；或 `<component :is="'FooBar'" />` 用字符串动态组件 | **拿不到 tree-shaking**（全量进包）、类型丢失、代码里看不出这个标签是谁，重构时全局搜索 |

**全局注册是新手最爱用、也最该警惕的一条**，动机通常是「少写一行 import」，代价是所有人打开这个组件都要去别的文件找标签对应什么。真正的动态字符串场景，用 `defineAsyncComponent` 或 `import()` 更合适。

组件的 `name` 选项在 `<script setup>` 里通过编译宏 `defineOptions` 声明（官方标注 **3.3+**），有三处实际用途：**递归组件**（模板里引用自己）必须有它、`keep-alive` 的 `include` / `exclude` 按它匹配、报错栈与 Vue DevTools 的组件树按它显示。**没有 `defineOptions` 时编译器会用文件名推断 `name`**（这条我未在核实的那页读到原文，见下方标注），所以文件名与 `name` 不一致时，DevTools 里看到的和代码里叫的不是一回事。

```vue
<script setup>
import { computed } from 'vue'
import TodoItem from './TodoItem.vue'

defineOptions({ name: 'TodoList', inheritAttrs: false })

const props = defineProps({ items: { type: Array, default: () => [] } })
const empty = computed(() => props.items.length === 0)
</script>

<template>
  <ul class="todo-list">
    <li v-if="empty" class="empty">暂无待办</li>
    <TodoItem v-for="t in props.items" :key="t.id" :todo="t" />
  </ul>
</template>
```

### 文件名与命名约定

| 对象 | 约定 | 理由 |
| --- | --- | --- |
| SFC 文件 | PascalCase，`UserAvatar.vue`，一个文件一个组件 | 与组件 `name` 对齐；文件名即组件名 |
| 模板里的标签 | PascalCase：`<UserAvatar />` | 与 HTML 自定义元素（全小写、必须带连字符）区分开；IDE 能跳转定义 |
| 全局注册的组件 | kebab-case（如原生 `<my-widget>` 那种） | 只有这一种场景用小写连字符 |
| 多词命名 | 必须多词（`TodoItem` 而非 `Item`） | 避免与未来的 HTML 元素名冲突，Vue 风格指南把这条列为必需规则 |
| 目录 | 组件私有子组件放同级子目录（`TodoList/components/TodoItem.vue`） | 一眼看出「这个组件除了这里没人用」 |

<Callout type="unverified" title="本章核实到的与没核实到的">

**已核实**（2026-10-17，vuejs.org）：`defineModel` 官方标注「Only available in 3.4+」，且支持 `get`/`set` 转换与修饰符解构；`defineOptions`、`defineSlots` 标注「Only supported in 3.3+」；`defineProps` 与 `defineEmits` 的选项会被**提升到模块作用域**，因此不能引用 setup 内的局部变量，引用即编译错误；类型声明与运行时声明**不能同时使用**，同时使用编译错误；类型声明下去掉 `?` 即为必填；编译器会为类型声明自动生成运行时声明（开发模式含校验，生产模式退化为数组形式）；`withDefaults` 会移除已给默认值的属性的可选标记，可变默认值必须包在函数里；3.5+ 可用「响应式 props 解构」的原生默认值写法替代 `withDefaults`；`v-slot` 的简写是 `#`，等价关系如官方例句；无 `name` 的 `<slot>` 隐式名为 `default`；单一默认插槽可把 `v-slot` 直接写在组件标签上，而**混用具名插槽与默认作用域插槽时，默认插槽必须用显式 `template`，否则编译错误**（官方原文给了一个「won't compile」的反例）；`$slots` 配合 `v-if` 可做「插槽存在才渲染容器」。

**未核实**：`<script setup>` 组件缺 `name` 时由文件名推断这一条；类型化 `defineEmits` 的「元组签名」写法是哪一版开始支持的；布尔 prop 缺席即 `false` 的具体转换规则细节；已声明的 `emits` 不会出现在 `$attrs`；多根组件不显式绑定 attrs 时的警告文案；插槽内容变化导致子组件重渲染的具体调度细节。以上都以 [Props](https://cn.vuejs.org/guide/components/props.html)、[透传 Attributes](https://cn.vuejs.org/guide/components/attrs.html)、[组件事件](https://cn.vuejs.org/guide/components/events.html) 当前版本为准。**所有代码片段的运行结果都是「预期结果」，本章未在本机执行**——Vue 组件需要构建工具与浏览器，验证路径：`npm create vue@latest`（勾选 TypeScript），或用 `https://play.vuejs.org/`。

</Callout>

## defineProps 两种写法：本站为什么固定用类型声明

同一个组件的两种写法，摆在一起看差别最直接：

```vue
<script setup lang="ts">
// 写法 A：基于类型的声明（需要 lang="ts"）
interface Props {
  title: string
  level?: number
  tags?: string[]
}
const props = defineProps<Props>()
</script>
```

```vue
<script setup>
// 写法 B：运行时声明
defineProps({
  title: { type: String, required: true },
  level: { type: Number, default: 1 },
  tags: { type: Array, default: () => [] },
})
</script>
```

| 维度 | 类型声明 A | 运行时声明 B |
| --- | --- | --- |
| `props.title` 的 TS 类型 | `string`，零额外工作 | `any`/需要 `PropType` 手动标注 |
| 必填判定 | 没有 `?` 就必填 | 显式 `required: true` |
| 默认值 | 3.4 及以下用 `withDefaults`；3.5+ 可用解构默认值 | 直接写 `default` |
| 运行时校验 | 编译器**自动**生成等价运行时声明（开发模式带类型检查） | 手写，就是它本身 |
| `validator` 自定义校验 | 类型写法不支持 | 支持 |
| 纯 JS 项目 | 不可用（要 `lang="ts"`） | 唯一选择 |
| 复杂类型（交叉、工具类型、`Record`） | 类型推导有时给不出可运行的 `type`，编译器会放宽校验 | 表达力受限于构造函数 |

**本站用 A**，三个理由：**类型是唯一事实来源**（同一份信息写两遍必然漂移）；**IDE 与模板的类型检查只在 A 下真正起作用**——父组件少传一个必填 prop、传错类型，编辑器直接标红，B 只能在运行时靠控制台警告发现；**`PropType` 那套写法在 Vue 3.3 之后基本是历史包袱**。

需要 B 的三种情况：项目没有 TypeScript；确实需要 `validator`；prop 是「一个联合类型的对象」这类运行时校验比编译期更可靠的东西。

### 默认值：withDefaults 与 3.5 的解构写法

```ts
// 3.4 及以下的标准写法
const props = withDefaults(defineProps<Props>(), {
  level: 1,
  tags: () => [],        // 对象/数组这类可变默认值必须包成函数
})
// props.level 的类型是 number（可选标记被移除）
```

```ts
// 3.5+ 的响应式 props 解构：可以直接写默认值
const { title, level = 1, tags = [] } = defineProps<Props>()
```

`withDefaults` 只用来给默认值，**不能用来表达「必填」**——必填由类型上的 `?` 决定。

3.5 那条解构写法有版本风险，两条必须知道：**低于 3.5 时解构会丢响应式**（拿到的是解构那一刻的值，父组件再传新的不会更新），这正是本站第 2 章「解构即断链」的又一处体现；3.5 起框架为它做了特殊处理。**在跨版本组件库里，最稳的做法仍然是不解构、统一通过 `props.x` 读**——多写七个字符，换掉一类「升级 Vue 后行为变了」的故障。

### 两条硬约束

`defineProps` / `defineEmits` 是**编译宏**，不是普通函数（不需要 import）。约束来自官方原文：

> The options passed to `defineProps` and `defineEmits` will be hoisted out of setup into module scope. Therefore, the options cannot reference local variables declared in setup scope. Doing so will result in a compile error.

推论三条：**只能在 `<script setup>` 顶层调用**（不能在 `if`、函数、循环里）；**默认值不能引用 setup 里的局部变量**，包括 import 进来的常量？——import 属于模块作用域，可以引用；函数体内声明的常量不行；**两种声明方式不能混用**（同时传泛型和选项对象直接编译错误）。

## 单向数据流：为什么子组件不能改 props

机制上：props 是父组件渲染函数产出的一份快照。子组件里写 `props.count = 5`，改的是这份快照本身；**父组件下一次重渲染会把它重新算出来并覆盖**，于是你看到「动一下就弹回」。框架给只读保护，是为了让这种静默失效变成明确报错。

设计上的理由更重要：**如果子组件能改 props，数据的流向就不可读了。** 一个 prop 有两个写入者（父亲传、儿子改），你再也无法指着父组件说「这个值现在是多少」。第 4 章那条「唯一写入者」原则在这里同样成立。

三种正确做法：

| 需求 | 做法 | 代码要点 |
| --- | --- | --- |
| 子组件的动作应该改变父组件的状态 | **emit 事件**，让父亲改 | `const emit = defineEmits<{ delete: [id: number] }>()`；模板里 `@click="emit('delete', todo.id)"` |
| 子组件需要一个「可编辑的草稿」，只在确认时提交 | **本地副本** | `const draft = ref(props.initial)`；配一个「外部值变了才重置」的同步策略（见下） |
| 子组件本身就是一个输入控件 | **`v-model`** | 组件上 `v-model` 展开成 prop + 事件；或直接 `defineModel()` |

本地副本最难的半步是「父组件后来换了初值，副本要不要跟着换」。两种答案，必须自己选一个：

```ts
// 方案一：只在 props 被换成不同来源时重置（常见于「编辑另一条记录」）
watch(
  () => props.todoId,
  () => { draft.value = props.initial },
)

// 方案二：用 key 强制重建组件（最省事，也最容易想明白）
// 父组件：<EditPanel :key="editingId" :initial="row.note" @save="onSave" />
```

方案二值得偏爱：**`key` 变化时 Vue 销毁旧实例、创建新实例**，所有局部状态回到初始值，你一行同步代码都不用写。代价是丢掉滚动位置、聚焦、未提交的编辑（而这往往正是你想要的语义）。

**唯一「技术上允许但绝不该做」的例外**：prop 是对象时，子组件深改它的属性**不会**被只读保护拦下（保护只在第一层）。这是最危险的一类 bug：本地界面看起来正常，但父组件那份数据被悄悄改了，共享它的兄弟组件跟着变。修法是把整个新对象 emit 出去。

## defineEmits：类型写法与事件名

```ts
// 类型写法：事件名与各参数的名字、类型都写进签名
const emit = defineEmits<{
  change: [value: string]
  delete: [id: number, silent?: boolean]
}>()

emit('change', 'done')      // 参数类型受检
emit('chagne', 'done')      // 预期结果：TS 报错（事件名不在声明里）
```

运行时写法是 `defineEmits(['change', 'delete'])`（数组）或带校验的对象。**两种不能混用**（同 `defineProps`，编译错误）。

四条关于事件名的实务结论：

1. **声明 `emits` 不只是文档作用**：它把事件从透传属性里剔除，避免「父亲在本组件上写的 `onChange` 和你内部根元素的原生 `change` 混在一起被触发两次」。这类重复触发是 attrs 与 emits 交互最常见的诡异 bug，具体规则以官方[透传 Attributes](https://cn.vuejs.org/guide/components/attrs.html) 为准。
2. **模板监听器写成 kebab-case**：`@change`、`@update:model-value`。Vue 在运行时做大小写归一，但你写 `@updateModelValue` 会让同项目的其他人以为是原生事件。
3. **事件负载尽量传「发生了什么」的最小事实**，不要在事件里传「父亲该怎么改」。子组件不该知道父亲的字段名。
4. **需要「谁触发谁定义」的反向检查**：如果一个事件只有一个父亲在听、且语义是父亲的业务规则，那说明这段逻辑不该在子里——把子组件退回成展示组件。

## 组件上的 v-model

`v-model` 在组件上的约定是**一对名字**：

```vue
<!-- 父组件这一行 -->
<MyInput v-model="keyword" />

<!-- 等价于（展开后） -->
<MyInput :model-value="keyword" @update:model-value="keyword = $event" />
```

子组件必须做两件事：声明接收 `modelValue`，在输入时发 `update:modelValue`。手写版本：

```vue
<script setup lang="ts">
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <input :value="props.modelValue" @input="emit('update:modelValue', $event.target.value)" />
</template>
```

**自定义参数名**让一个组件同时接多个双向字段：

```vue
<!-- 父：两个字段各自独立双向绑定 -->
<ArticleEditor v-model:title="form.title" v-model:body="form.body" />

<!-- 子：prop 名是 title / body，事件名是 update:title / update:body -->
<script setup lang="ts">
const props = defineProps<{ title: string; body: string }>()
const emit = defineEmits<{ 'update:title': [string]; 'update:body': [string] }>()
</script>
```

**修饰符**通过 `modelModifiers` 传进来：`v-model.trim` 让子组件收到 `{ trim: true }`。布尔修饰符（`.trim`、`.number`、`.lazy`）在原生 `input` 上有内建处理；自定义修饰符必须在声明里列出才会被透传。

### defineModel：3.4+ 之后的一行版本

`defineModel` 官方标注为 **3.4+ 才可用**（[`<script setup>` API](https://cn.vuejs.org/api/sfc-script-setup.html#definemodel)）。它把上面那对 prop + emit 收成一行：

```vue
<script setup lang="ts">
const model = defineModel<string>()
// 等价于：接收 modelValue prop + 声明 update:modelValue 事件
// model 是一个可写的 ref，模板里 v-model="model" 直接用
</script>

<template>
  <input v-model="model" />
</template>
```

常用形态（选项与转换函数见官方页，均已核实存在）：

```ts
// 具名 model：prop 名 title，事件名 update:title
const title = defineModel<string>('title', { required: true })

// 需要值转换（.trim 修饰符的例子：官方给的正是这个写法）
const [modelValue, modifiers] = defineModel({
  set(value) {
    return modifiers.trim ? String(value).trim() : value
  },
})

// local：本地副本语义，写入先更新内部值、再回写父组件
const count = defineModel<number>({ local: true })
```

**取舍**：`defineModel` 写起来最短，但它隐藏了「prop 名 + 事件名」这两个约定；在需要给组件写文档、或需要同时接收别的 props 的场合，手写版本更透明。**本站的口径**：3.4+ 项目里输入类控件用 `defineModel`，业务组件的数据入口用显式 props + emit（理由：业务组件的 prop 集合大，一致性比省一行重要）。老项目（低于 3.4）里看到「props + emit 手写 v-model」不是过时代码，是同一件事。

## 属性透传（fallthrough attributes）

父组件在子组件标签上写的、**没有被子组件声明为 prop 或 emit** 的属性，统称透传属性（fallthrough attributes）。默认行为是**加到子组件的根元素上**。

| 属性 | 默认行为 | 你要知道的边界 |
| --- | --- | --- |
| `class` / `style` | **合并**到根元素（不是覆盖） | Vue 对这两者有特殊处理：`class="a"` + 子组件根上 `class="b"` → `"a b"`，顺序是「子在前父在后」这一点请实测确认 |
| `id`、`data-*`、`aria-*`、`role` | 直接落到根元素 | 无冲突处理：子组件根上已有同名属性时以父组件传的为准 |
| `@click`（原生事件监听器） | 变成根元素的 `onClick`，落到根元素 | 这也是「点了子组件任意位置都触发」的由来；无障碍上要小心 |
| `v-model` | **不透传**（它被展开成 prop + 事件，两者都已声明） | 组件自己没声明 `modelValue` 时你会得到未知 prop 警告 |
| 已声明的 prop / 已声明的 emit | 不出现在 `$attrs` | 见上面 `defineEmits` 那条 |

三种需要 `inheritAttrs: false` 的场景：

```vue
<script setup lang="ts">
defineOptions({ inheritAttrs: false })
const props = defineProps<{ label: string }>()
</script>

<template>
  <!-- 把父组件的 id / data-* / class 精确放到 input 上，而不是包裹 div 上 -->
  <label>
    {{ props.label }}
    <input v-bind="$attrs" />
  </label>
</template>
```

| 场景 | 为什么必须关掉自动透传 |
| --- | --- |
| 包装原生元素（input、img、按钮 + 外层 tooltip） | 父组件传的 `class` / `disabled` / `id` 应该作用于内层控件，不是外层容器；表单可达性（label 关联的 `id`）依赖这一点 |
| **多根节点组件** | 框架无法猜该给哪个根，需要显式 `v-bind="$attrs"`（预期结果是控制台给出一条无法自动绑定的警告，文案以版本为准） |
| 想把属性分给两个不同元素 | 在模板里手动摊开，或 `const attrs = useAttrs()` 在 setup 里按 `data-` 前缀分拣 |

`$attrs` 是模板里的写法；setup 里等价的是 `useAttrs()`。注意一个坑：`class` 与 `style` 一旦关掉自动透传，`$attrs.class` 拿到的是**原始值**，你要自己处理合并（社区惯例是引入 `useMergeProps` 类工具或手动接一个 `containerClass` prop——**本站不推荐自造合并逻辑**，直接把组件设计成单根更省事）。

## 插槽：三种形态

插槽（slot）解决一件事：**父组件把一段模板交给子组件决定放在哪里、什么时候渲染、以及附带什么数据。**

```vue
<!-- Card.vue -->
<template>
  <section class="card">
    <header v-if="$slots.header"><slot name="header" /></header>
    <div class="card-body"><slot /></div>
    <slot name="footer" />
  </section>
</template>
```

```vue
<!-- 用法 -->
<Card>
  <template #header>
    <h3>{{ todo.title }}</h3>
  </template>

  正文：<p>{{ todo.note }}</p>

  <template #footer>
    <button @click="save">保存</button>
  </template>
</Card>
```

| 形态 | 声明 | 使用 | 关键规则 |
| --- | --- | --- | --- |
| 默认插槽 | `<slot />`（隐式名 `default`） | 组件标签下的裸内容 | 混用具名插槽时，默认内容必须包进 `<template #default>`，**否则编译错误** |
| 具名插槽 | `<slot name="header" />` | `<template #header>` | 名字拼错静默失效（官方建议用 `$slots` + `v-if` 决定是否渲染容器） |
| 作用域插槽 | `<slot :row="r" :index="i" />` | `<template #default="{ row, index }">` | 子组件向父组件传数据，方向是**反的** |

`#` 是 `v-slot` 的简写，官方原话：「Think of it as 'render this template fragment in the child component's header slot'」。单一默认作用域插槽可以简写成组件标签上的 `v-slot="props"`；一旦同时存在具名插槽，默认插槽必须用显式 `<template>`（上面核实过的那条编译错误）。

**作用域插槽最该记住的一条**：插槽内容**在父组件的作用域里编译**。所以 `<template #header>` 里的 `todo.title` 取的是**父组件**的 `todo`，不是子组件的同名变量；子组件想影响它，只能通过 `<slot :xxx="...">` 传出去。这条规则解释了为什么插槽里的 `@click` 调到的是父组件的方法——很多「明明在子组件模板里写的，怎么调用的是父亲的函数」的困惑，答案就在这里。

### 一个真实的作用域插槽组件

设计动机：表格的「数据 + 列布局」是可复用的，「每格怎么显示」是业务的。把前者做成容器组件、后者留给调用方，就是作用域插槽的正当用途。

```vue
<!-- DataTable.vue：只认数据结构，不认识任何业务字段 -->
<script setup lang="ts" generic="T extends Record<string, unknown>">
interface Column {
  key: keyof T & string
  label: string
  align?: 'left' | 'right'
}
const props = defineProps<{ rows: T[]; columns: Column[] }>()
const emit = defineEmits<{ sort: [key: string] }>()
</script>

<template>
  <table class="data-table">
    <thead>
      <tr>
        <th v-for="c in props.columns" :key="c.key" :style="{ textAlign: c.align ?? 'left' }">
          <button type="button" @click="emit('sort', c.key)">{{ c.label }}</button>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(row, i) in props.rows" :key="i">
        <td v-for="c in props.columns" :key="c.key">
          <!-- 关键：把整行和列 key 交给父组件渲染 -->
          <slot :name="c.key" :row="row" :index="i">
            {{ row[c.key] }}
          </slot>
        </td>
      </tr>
    </tbody>
  </table>
</template>
```

```vue
<!-- 调用方：只有 status 列需要业务渲染 -->
<DataTable :rows="todos" :columns="cols" @sort="onSort">
  <template #status="{ row }">
    <Badge :tone="row.done ? 'ok' : 'warn'">
      {{ row.done ? '已完成' : '进行中' }}
    </Badge>
  </template>

  <template #title="{ row, index }">
    <a :href="`/todos/${row.id}`">{{ index + 1 }}. {{ row.title }}</a>
  </template>
</DataTable>
```

`<slot :name="c.key">` 用的是**动态插槽名**——列定义驱动插槽出口，这是作用域插槽最有威力的用法，也是它区别于「props 传一个 render 函数」的地方：模板仍然是模板，类型仍然由 `defineSlots` 约束。

```ts
// 给插槽出口加上类型（官方标注 3.3+）
defineSlots<{
  default?: (props: { row: T; index: number }) => void
  status?: (props: { row: T }) => void
}>()
```

插槽的代价：**插槽内容变化时子组件必须重渲染**（它没有能力把父组件的片段单独 diff 出来）。列表上千行时这条会放大成真实性能问题——解法在[渲染性能](/vue/rendering-performance)，第 10 章才谈。

## defineExpose：`<script setup>` 默认是封闭的

`<script setup>` 组件编译后 `expose` 是空的：**父组件用 `ref` 拿到的实例上，看不到子组件的任何内部变量**。这是设计，不是缺陷——它把「组件内部」真正关起来了。

```vue
<!-- 子 -->
<script setup>
const internal = ref(0)
defineExpose({ focus: () => inputRef.value?.focus(), reset: () => { internal.value = 0 } })
</script>

<!-- 父 -->
<script setup>
const child = ref(null)          // 需要 ref 指向子组件标签
onMounted(() => child.value?.focus())
</script>

<template>
  <MyInput ref="child" />
</template>
```

`defineExpose` 里只放**行为**（focus、scrollTo、open、validate），不要放状态。暴露一整个 `store` 或原始 `ref` 等于把内部状态变成父亲的自由变量。模板引用与 `useTemplateRef` 的正确用法在第 7 章展开：[生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject)。

## 组件设计原则

这一节是本章最容易被跳过、也最容易在三个月后回来补的部分。以下每一条都对应一种真实的重构成本。

**一、组件的接口有三个面：props（输入）、emits（上报）、slots（界面注入）。** 设计一个组件先写这张表，再写模板。三面都空的组件不需要存在（它是标记）；三面超过十项的组件需要拆开。

**二、不依赖父组件内部。** 判据：把组件复制到另一个项目，只改 import 路径就能跑。反面信号有三种：子组件 import 了路由或 store 并直接读它们（那它就不是展示组件）、子组件按父亲的字段名构造事件负载、prop 名字叫 `parentData`。

**三、单一职责，按「变更原因」拆而不是按视觉块拆。** 一个组件只有一个改动理由。「头部 + 列表 + 筛选条 + 分页」这四块各有各的改动原因，所以它们是四个组件；但如果只有列表项的渲染规则在变，把筛选条拆出去只是多了一层 props 中转。

**四、prop 数量的阈值。** 经验线：**超过 6 个 props 就自问一句「这里面是不是有一组总是一起变」**——是的话收成一个对象 prop（`filters: { status, keyword, page }`）；有四个以上 prop 只在某个动作里用到，说明职责串味了。**超过 10 个基本等于「这个组件不知道该怎么拆」。**

**五、God 组件的识别信号**（出现两个就该拆）：`setup` 里超过 60 行且分成五段互不相干的逻辑；一个 `ref` 被 20 处 `if` 读写；模板里出现「这块只在 `type === 'a'` 时显示」的三段以上分支；组件名里有 `All` / `Manager` / `Wrapper` / `Common`；你想给它写注释时只能说「这个是那个页面」。

**六、容器组件与展示组件的分工。** 容器负责拿数据、持有状态、决定「现在显示哪条」；展示负责把值画出来、把动作 emit 上去。**判断标准是数据所有权，不是代码行数。** 展示组件不该发请求，容器组件不该写一长段样式。这条纪律同时给了你测试切口：展示组件测渲染，容器测数据流。

**七、事件与 props 的选择：谁触发谁定义。** 值的来源在父亲，就用 prop；动作的发起者在儿子，就用 emit。想不清的时候问一句：**「这个信息是父亲本来就有的，还是儿子运行中才知道的？」** 前者传下去（prop），后者报上来（emit）。两个答案都不是的时候，说明这份状态应该往上一层，或者应该进 store（第 9 章）。

**八、可复用组件与业务组件分层。** 目录建议：

```text
src/components/
  ui/           # 不认识业务：Button、Badge、DataTable、Modal
  business/     # 认识领域概念：TodoItem、AssigneePicker
  views/        # 页面级容器：TodoListView、SettingsView
  composables/  # 无界面逻辑：见第 6 章
```

分层带来的收益是可检查的：**`ui/` 里出现 `fetch('/api/todos')` 就是违规**，一眼能看出来。`ui/` 组件必须能被搬到别的项目而不用改一行。

## 常见错误与排查

1. **现象：`props.count++` 后界面弹回，控制台 `target is readonly`。** 原因：违反单向数据流。怎么确认：看报错里的组件名与键名。怎么修：`emit('change', count+1)` 让父亲改；确实需要草稿语义就复制成局部 `ref`。
2. **现象：父组件传 `class="mt-4"` 到子组件没效果。** 原因：子组件是多根节点（或包了两层 wrapper 而 `inheritAttrs: false`）。怎么确认：Vue DevTools 里选中该组件实例，看 `attrs` 对象——有值却没渲染到 DOM，就是没绑。怎么修：给根元素加 `v-bind="$attrs"`，或把组件收敛成单根。
3. **现象：插槽里永远显示默认内容。** 原因：插槽名不匹配（`#head` 对 `name="header"`），拼错不报错。怎么确认：`console.log(Object.keys($slots))`（在子组件模板里）。怎么修：用 `$slots.header` + `v-if` 让「没有这个插槽时」的分支显式存在，而不是依赖默认内容兜住拼错。
4. **现象：作用域插槽里访问不到子组件的变量。** 原因：插槽内容在父作用域编译，这是设计。怎么确认：那个变量在父组件里是否存在。怎么修：子组件通过 `<slot :x="内部值">` 传出来，父组件用解构接。
5. **现象：加了 `@change` 之后回调触发两次。** 原因：子组件内部根元素有原生 `change`，事件既被透传监听器接住、又被子组件 emit 出来接住。怎么确认：看两次的负载是否一个是原生 `Event` 一个是自定义值。怎么修：在子组件的 `defineEmits` 里声明 `change`，把原生事件从 attrs 里剔除。
6. **现象：`defineProps` 报「找不到名称」或默认值里的常量不生效。** 原因：把局部变量/`import` 之外的表达式放进了会被提升到模块作用域的选项里；或者在 `if` 分支里调用宏。怎么确认：报错文案会指出提升问题。怎么修：把常量提到 `<script setup>` 顶层，或改用不带默认值的声明 + 局部 `computed` 兜底。
7. **现象：父组件用 `ref` 拿到子组件实例，`child.value.someMethod()` 是 `undefined`。** 原因：`<script setup>` 默认不暴露内部。怎么确认：打印 `child.value` 看键。怎么修：子组件 `defineExpose({ someMethod })`。**如果方法语义是「改状态」，先想清楚是不是应该换成 emit。**
8. **现象：解构 props 之后值不再更新。** 原因：低于 3.5 时 props 解构丢响应式。怎么确认：父组件重新传值，子组件不动。怎么修：统一读 `props.x`；确实要用解构默认值，先核对项目 Vue 版本。
9. **现象：`v-model:title` 在子组件拿不到值。** 原因：子组件声明的是 `title` 而不是配套事件 `update:title`，或参数名拼成了 `v-model:tile`。怎么确认：DevTools 里看子组件收到的 props 与 emits 列表。怎么修：用 `defineModel('title')`，或把 prop 与事件名一对一对齐。
10. **现象：多词组件名 `<Item>` 与原生元素冲突 / 模板里出现未知元素警告。** 原因：单名且与 HTML 元素重名。怎么修：改成 `TodoItem` 这类多词名。

## 练习

<Exercise title="练习 1 · 判断 props 还是 emits" difficulty="基础">

下面是 `<RoleSelect>` 收到的六项接口，请逐项判定「prop / emit / slot」哪种最合适，并说明理由：

1. `roles: string[]`（选项列表，父亲从接口拿）
2. `selected: string`（当前选中值，父亲持有）
3. `size: 'sm' | 'lg'`（外观）
4. 用户点了某一项这个事实
5. `labelFor: string`（关联 label 的 id）
6. 每个选项前想放一个自定义图标（由调用方决定长什么样）

<template #answer>

| 项 | 结论 | 理由 |
| --- | --- | --- |
| 1 `roles` | prop | 数据来源在父亲，子组件只读 |
| 2 `selected` | prop + emit（或直接 `v-model` / `defineModel`） | 值属于父亲，改动由儿子发起 → 一对双向绑定 |
| 3 `size` | prop | 静态外观参数 |
| 4 点击事实 | emit | 「谁触发谁定义」；负载只带选中值，不带「父亲该怎么改」 |
| 5 `labelFor` | **透传属性，不做 prop** | 它是给内部 input 的原生属性；用 `v-bind="$attrs"` 落到控件上，配合 `inheritAttrs: false`。做成 prop 反而多一层映射 |
| 6 图标 | slot（作用域插槽，`#option="{ role }"`） | 「由调用方决定长什么样」是插槽的定义性场景；换成 `renderOption` 函数 prop 也能做，但丢掉模板与类型 |

</template>

</Exercise>

<Exercise title="练习 2 · 把双向同步改成 v-model" difficulty="基础">

某组件里有这段代码，它同时接收 `value` prop 和 `onChange` 回调。请指出三处问题，并用 3.4+ 的写法重写：

```vue
<script setup>
const props = defineProps(['value', 'onChange'])
function handleClick(e) {
  props.onChange(e.target.value)
  props.value = e.target.value       // 想让界面立刻更新
}
</script>
```

<template #answer>

三处问题：① `props.value = ...` 直接改 props，运行时只读失败并弹回；② `defineProps` 数组写法没有类型，`props.onChange` 是否函数无从检查；③ **`onChange` 不该做成 prop**——函数 prop 会作为监听器透传，语义与事件混淆，且它和 `value` 一起构成「手写 v-model」，命名与约定不对齐。

重写（`defineModel`）：

```vue
<script setup lang="ts">
const model = defineModel<string>({ required: true })
</script>

<template>
  <input v-model="model" />
</template>
```

父组件：`<MyInput v-model="keyword" />`。

如果必须兼容 3.3 及以下：

```vue
<script setup lang="ts">
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()
</script>

<template>
  <input :value="props.modelValue" @input="emit('update:modelValue', $event.target.value)" />
</template>
```

</template>

</Exercise>

<Exercise title="练习 3 · 制造一次透传事故并解释" difficulty="进阶">

在一个多根节点的 `<SearchBox>` 上写 `<SearchBox id="q" class="w-full" @click="log" />`，且组件内部没有 `v-bind="$attrs"`。① 预测现象（控制台与 DOM）；② 解释 `@click` 为什么可能触发多次；③ 给出修法，要求 `id` 落在内部的 `input` 上、`class` 落在外层容器上。

<template #answer>

① 预期结果：Vue 无法把 attrs 自动绑到多个根节点上，控制台出现「无法自动绑定 attrs」方向的警告，页面上的 `id` / `class` 都不生效。`@click` 的表现取决于组件是否为单根——若退化为单根（比如多根被一个 `template` 分支收成一段），监听器会挂在那个根元素上。

② 重复触发的来源是**两个方向的事件同名汇合**：父组件写的 `@click` 作为原生监听器落到根元素，同时若子组件内部又 `emit('click')` 且没在 `defineEmits` 里声明 `click`，父亲那一个监听器会同时接住原生事件和自定义事件。声明了 `emits` 之后，透传层会把它剔除，只剩一条通路。

③ 修法：`defineOptions({ inheritAttrs: false })`，然后用 `useAttrs()` 手动分拣：

```ts
import { useAttrs, computed } from 'vue'
const attrs = useAttrs()
const containerClass = computed(() => attrs.class ?? '')
const { class: _c, ...toInput } = attrs as Record<string, unknown>
```

```vue
<template>
  <div :class="containerClass">
    <input v-bind="toInput" />
  </div>
</template>
```

`class` 单独取出来绑到容器、其余（含 `id`）绑到 `input`。这也是「包装原生控件」这类组件为什么必须显式处理 attrs 的根本原因。

</template>

</Exercise>

<Exercise title="练习 4 · 用作用域插槽拆掉一个十 prop 组件" difficulty="挑战">

`<TodoRow>` 的 props 有：`id`、`title`、`note`、`done`、`priority`、`assigneeName`、`assigneeAvatar`、`dueLabel`、`showCheckbox`、`onDelete`（函数）、`onOpenNote`（函数）。请说明你会怎么拆：哪些合并、哪些变成 slot、哪些变成 emit，并写出拆分后 `<TodoRow>` 的最终接口。

<template #answer>

判断过程：

- `id` 只用于 key 和事件负载，不用于渲染 → 不必进 props，让父亲在模板闭包里带上它。
- `note`、`dueLabel`、`priority` 的渲染规则各自独立变化 → 三个默认/具名插槽，父亲决定怎么显示。
- `assigneeName` + `assigneeAvatar` 总是一起变 → 合成一个 `assignee` 对象 prop。
- `showCheckbox` 是「这段 UI 要不要存在」→ 换成 `v-if` 由父亲控制，或用插槽是否存在来判断（`$slots` 那条）。
- `onDelete` / `onOpenNote` 是函数 prop → 换成 `defineEmits` 的 `delete` / `openNote` 事件。

拆后接口（三面各 2–3 项）：

```vue
<script setup lang="ts">
defineProps<{ title: string; done: boolean; assignee?: { name: string; avatar?: string } }>()
defineEmits<{ toggle: [done: boolean]; delete: [] }>()
defineSlots<{
  default?: (props: { done: boolean }) => void
  extra?: () => void
}>()
</script>
```

调用方用 `#extra` 放备注与到期标签，父亲在自己的模板里读 `todo.note`。

顺带一句：`<TodoRow>` 里出现 `assigneeAvatar` 的加载失败处理、或日期格式化，那就该抽成 composable 而不是继续加 prop——这正是[第 6 章](/vue/composables)要解决的事。

</template>

</Exercise>

## 官方文档与延伸阅读

- [组件基础](https://cn.vuejs.org/guide/components/registration.html)（注册组件）与 [组件深钻总览](https://cn.vuejs.org/guide/essentials/component-basics.html) —— 核实本章第一节：局部/全局注册的差别与动态字符串组件的场景。
- [Props](https://cn.vuejs.org/guide/components/props.html) —— 用来核实本章**未核实项**：布尔 prop 缺席即 `false` 的转换规则、kebab-case 与 camelCase 的对应、类型声明自动生成运行时声明的说明。**第 5 章主参考。**
- [`<script setup>` API](https://cn.vuejs.org/api/sfc-script-setup.html) —— 本章版本结论的来源：`defineModel` 标注 3.4+、`defineOptions` 与 `defineSlots` 标注 3.3+、`defineProps` 选项提升到模块作用域所以不能引用局部变量、类型声明与运行时声明不能混用、`withDefaults` 与 3.5 响应式 props 解构的关系。
- [组件事件](https://cn.vuejs.org/guide/components/events.html) —— 核实 `defineEmits` 的类型写法、事件与原生监听器的合并规则。
- [v-model 与组件](https://cn.vuejs.org/guide/components/v-model.html) —— 核实 `modelValue` / `update:modelValue` 约定、自定义参数名、修饰符与 `defineModel` 的完整选项列表。**本章 `v-model` 一节必读。**
- [透传 Attributes](https://cn.vuejs.org/guide/components/attrs.html) —— 核实 `class`/`style` 合并、`inheritAttrs: false` 的官方用例、已声明 emits 被剔除的行为。
- [插槽](https://cn.vuejs.org/guide/components/slots.html) —— 核实 `#` 简写语义、隐式 `default` 名、混用具名与默认作用域插槽时的编译错误、`$slots` + `v-if`。
- [`defineExpose` 与封闭性](https://cn.vuejs.org/api/sfc-script-setup.html#defineexpose) —— 核实「`<script setup>` 组件默认不暴露内部绑定」。
- [Vue 风格指南](https://cn.vuejs.org/style-guide/) —— 组件命名多词规则、单职责与「每文件一个组件」的出处；本站的prop 阈值是我给的经验线，风格指南不给数字。
- [第 4 章 计算属性与侦听器](/vue/computed-and-watch) —— 可写计算属性与本地副本那条「props 同步策略」的机制出处。
- [第 7 章 生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject) —— `ref` 拿子组件、`defineExpose` 的正确时机，以及 `provide` / `inject` 什么时候替代多层 props。

## 下一章

这一章把「一个组件的接口」定完了：输入 prop、上报 emit、注入 slot、透传 attrs。但你会立刻遇到另一类东西——**它没有界面，却有一组状态和自己的清理动作**：一个请求的 `loading` / `error` / 取消、一份要写进 `localStorage` 的设置、一套表单字段与校验规则。把它塞进组件的 `setup` 里，God 组件就是这么长出来的。下一章讲把它抽出去的方法：[组合式 API、composables 与组件设计](/vue/composables)。
