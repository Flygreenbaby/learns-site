# 生命周期、模板引用与依赖注入：什么时候能碰 DOM，什么时候该用 inject

两个故障在 Vue 项目里出现频率高得不像话，而且控制台几乎都是安静的。第一个：图表第一次显示得好好的，路由切走再切回来，内存一路涨——`onMounted` 里 `echarts.init(el)` 调了，就是没写销毁。第二个：一个 composable 里先 `await` 接口再注册 `onMounted`，监听永远绑不上，没有报错，只是钩子从不执行——因为**钩子必须同步注册**，`await` 之后组件实例上下文已经丢了。

这一章讲三件事：**钩子的时机与失效条件**、**模板引用与直接操作 DOM 的边界**、**`provide` / `inject` 的正确使用范围**。共同底色是：Vue 接管了「状态到视图」这一段，你要在框架留出的几个精确缺口里做框架不做的事——测量、聚焦、接第三方库、跨层级协作——并且做完之后负责还原。

## 生命周期钩子：组件时机与浏览器时机是两条轴

`onMounted` 不等于「页面加载完了」，它只说明**这个组件**的子树插进了 DOM。数据返回、图片解码、路由切换后的第二次挂载，都发生在它之后或之外。

| 钩子 | 触发时机 | 这一刻能做什么 | 频率 |
| --- | --- | --- | --- |
| `<script setup>` 顶层代码 | 对应 `beforeCreate` + `created` | 声明状态、注册侦听器、发请求 | 最高，别在这读 DOM |
| `onBeforeMount` | 首次 render 前，根节点未入文档 | 基本只有时序调试价值 | 低 |
| `onMounted` | 组件树插入父容器之后 | 读写 DOM、初始化第三方库、启动观察器 | 高 |
| `onBeforeUpdate` | 状态变化后、DOM 更新前 | 趁旧 DOM 还在抓快照（滚动位置） | 中 |
| `onUpdated` | DOM 更新之后 | 依赖新布局的二次测量 | **接近零** |
| `onBeforeUnmount` / `onUnmounted` | 清理开始前 / 子组件已销毁、侦听器已停 | 主动收尾 / 释放实例、解绑全局监听、取消请求 | 高 |
| `onErrorCaptured` | 后代组件抛错向上传播时 | 返回 `false` 阻断上抛，显示兜底 UI | 中 |
| `onRenderTracked` / `onRenderTriggered` | 渲染 effect 收集/被触发依赖 | 开发期定位「谁导致这次重渲染」 | 仅调试 |
| `onActivated` / `onDeactivated` | `KeepAlive` 组件进出缓存 | 恢复/暂停轮询与观察器 | 中 |

`onServerPrefetch` 只在 SSR 用，客户端不调用，本站不涉及。**实际用得最多的只有 `onMounted` 与 `onUnmounted`**，其余的价值是读懂旧代码 + 特定测量场景的精确抓手。

## 钩子必须同步注册：await 之后就失效

`onMounted(fn)` 靠一个「当前正在 setup 的实例」的内部变量定位目标，这个变量只在 `setup()` **同步执行期间**有值。一旦 `await`，控制权交回事件循环（见 [事件循环、Promise 与 async/await](/javascript/asynchronous)），恢复执行时上下文已被下一个组件的 setup 覆盖或置空。

```js
// 错误：钩子静默失效
export async function useChart(elRef, url) {
  const data = await fetchData(url)   // 上下文在这里丢失
  onMounted(() => { /* 预期挂载后初始化，实际永不执行 */ })
  return { data }
}
```

修法只有一条主线：**钩子先同步注册，异步写在钩子回调内部。**

```js
// 正确
export function useChart(elRef, url) {
  const data = ref(null)
  let chart = null

  onMounted(async () => {
    data.value = await fetchData(url)
    chart = initChart(elRef.value, data.value)
  })
  onUnmounted(() => chart?.dispose())

  return { data }
}
```

`provide` / `inject` 的同步规则完全同源（官方表述：`inject()` 应在 `setup()` 中同步调用）。另有一条易混：在 `<script setup>` **顶层**直接 `await` 是合法的——它把组件编译成异步组件、要求父级用 `Suspense` 包裹，此时框架重新接管了 setup 上下文，`onMounted` 仍可用。这与「在普通函数里 await 之后再注册钩子」不是一回事。

## onMounted 里能做什么、不能做什么

能做：读写自己子树内的 DOM（聚焦、滚动、测量）、初始化第三方实例、绑定 window/document 监听、启动定时器。

要纠正一个流传很广的说法：**同一棵同步渲染的树里，子组件的 `mounted` 先于父组件触发**，父组件 `onMounted` 时同步子组件已经挂好。「子组件未必 ready」只在 `v-if` 延迟出现、异步组件/路由懒加载（模块还在下载）、`<Suspense>` 内的异步子树这三种情况下成立；`Teleport` 内容时机一致，只是位置不同。

**不该放 mounted 的是本质为派生数据的活儿。** 典型症状：`onMounted(() => { emptyHint.value = items.value.length === 0 ? '还没有内容' : '' })`——只算一次，`items` 后续变化提示就不动了，而且切断了「视图 = 状态的函数」这条线。换成 `computed`（第 4 章）。同类误用还有「mounted 里遍历 DOM 数行数写入 ref」。

## onUpdated 几乎总是设计问题

问题是**你不知道这次更新因谁而起**，而在里面写状态又会再触发一轮更新——自己造循环（控制台报 `Maximum recursive updates exceeded`）。真实场景：聊天窗口想「消息更新后滚到底」，写成 `onUpdated` 的后果是用户正往上翻历史时，任何无关状态（计时器、头像加载完）触发更新都把视图猛拽回底部。

替代方案按优先级：① `watch` 数据源 + `nextTick`，只有消息真变了才滚，还能比较新旧长度判断「用户是否在底部」；② 把滚动位置本身变成状态，让数据驱动视图；③ 确实需要在更新后测量时才用 `onUpdated`，且保证回调不写任何响应式状态。`onBeforeMount` 同理——首次 render 前能做的准备，`<script setup>` 顶层都能做，而且更清楚。

## 第三方库：初始化与销毁必须成对

只要某个库创建了「Vue 管不到的资源」，你就欠它一次释放。不成对的后果按类型分：内存（实例、canvas 没断）、事件（document 监听叠加，一次点击触发 N 次回调）、竞态（组件已卸载，回调还在写状态）。

| 库/资源 | 初始化 | 释放 |
| --- | --- | --- |
| ECharts / 图表 | `onMounted`（需要真实宽高） | `chart.dispose()` + `ResizeObserver.disconnect()` |
| 富文本/代码编辑器 | `onMounted`，容器已存在 | 其销毁 API，移除其 document 级监听 |
| IntersectionObserver / ResizeObserver | `onMounted` | `disconnect()` |
| `addEventListener('resize')`、`setInterval` | `onMounted` | `removeEventListener`（同一个函数引用）、`clearInterval` |
| fetch / WebSocket | `onMounted` 或首次交互 | `AbortController.abort()` / `close()` + 取消重连定时器 |

```vue
<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef, useTemplateRef } from 'vue'
import * as echarts from 'echarts'

const chartEl = useTemplateRef<HTMLDivElement>('chart')
let chart: echarts.ECharts | null = null
let observer: ResizeObserver | null = null

onMounted(() => {
  const el = chartEl.value
  if (!el) return
  chart = echarts.init(el)
  chart.setOption({ xAxis: { type: 'category', data: ['一', '二'] }, yAxis: {}, series: [] })
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(el)
})

onUnmounted(() => {
  observer?.disconnect()      // 先断观察器，再销毁实例
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="chart" class="chart" />
</template>
```

把这套成对逻辑封进 composable（`chart` 用 `shallowRef`，大对象别深层代理，见第 10 章），调用方就永远不会漏清理——这正是第 6 章说的抽取点。本章所有代码片段依据官方文档编写，**未在本机运行验证**（写作环境没有可运行的 Vue 项目；核实时间 2026 年 10 月），落地前请在 `npm create vue@latest` 项目里跑一遍并用 Vue DevTools 确认卸载时的清理生效。

## useTemplateRef 与字符串模板引用

`ref` 属性的作用是「给这个元素/组件实例起一个可寻址的名字」。`<script setup>` 下接到脚本侧：

```vue
<script setup lang="ts">
import { useTemplateRef, onMounted } from 'vue'

// 变量名可与模板里的 ref 值不同，靠参数关联
const input = useTemplateRef<HTMLInputElement>('username')
onMounted(() => input.value?.focus())
</script>

<template>
  <input ref="username" />
</template>
```

签名是 `useTemplateRef<T>(key: string): Readonly<ShallowRef<T | null>>`，参数必须是**字符串**且与模板 `ref` 的值完全一致；能力是 key 不必等于变量名、可传动态 key、不受变量重命名影响。版本口径：**`useTemplateRef` 是 Vue 3.5 新增**（官方 API 文档与模板引用指南，核实时间 2026 年 10 月）；3.5 之前用「同名 `ref` 变量 + 模板写 `ref="同名"`」靠编译期匹配绑定（`const username = ref(null)`）。

<Callout type="unverified" title="你项目里 Vue 的具体小版本我没查">

「同名 ref 变量自动绑定」与「`useTemplateRef` 需 3.5+」两条来自官方文档，但**本任务没读你的 `package.json`**。动手前先 `npm ls vue` 确认；低于 3.5 时 `useTemplateRef` 未导出会直接报错，改用同名 `ref` 方案。

</Callout>

另外三条硬事实：所谓「字符串引用被移除」指的是选项式 `this.$refs` 那套约定与新写法的差异，**模板里的 `ref="list"` 一直是字符串**，照常可用；`v-for` 内的 `ref` 收集成**数组**（挂载后填充），函数式 `:ref` 每次更新被调用、Vue 3 不保证数组顺序；组件上的 ref 拿到的是实例，而 `<script setup>` 组件**默认私有**，父组件取不到任何东西，除非子组件 `defineExpose({ focus })`（第 5 章）。

## 直接操作 DOM 的边界

一句话判据：**Vue 能表达的，别用 DOM 表达；Vue 表达不了的，才用 ref。**

| 必须用 ref 的场景 | 为什么模板表达不了 |
| --- | --- |
| 编程式聚焦 | 聚焦是浏览器行为不是数据，`autofocus` 只在首次渲染生效 |
| 读取滚动位置 | 滚动位置由用户交互改变，Vue 不追踪 |
| 尺寸/位置测量 | `offsetWidth`、`getBoundingClientRect` 属于布局信息 |
| canvas / WebGL / 视频控制 | 绘图上下文与播放 API 完全在 Vue 之外（见 [DOM 操作与事件系统](/javascript/dom-and-events)） |

其余全部回到数据：`v-if`/`v-show`、`:class`、插值、`:disabled`、`computed`。手动改 `innerHTML` 或覆盖已绑定的属性，会在下一次 diff 时被无声刷掉，这类 bug 极难定位。若为第三方库必须让容器内出现 Vue 之外的节点，就把该容器标为「框架外区域」：Vue 只控制容器存在与否（`v-if`），不写它内部内容。

## nextTick 与 DOM 更新时机

第 2 章讲过状态变化不会同步刷新 DOM，更新被合并后放进微任务队列，所以「改完状态立刻读 DOM」读到的是旧布局。

```vue
<script setup lang="ts">
const listEl = useTemplateRef<HTMLUListElement>('list')

async function send(text: string) {
  messages.value.push({ id: Date.now(), text })
  await nextTick()                       // DOM 已更新
  const el = listEl.value
  if (el) el.scrollTop = el.scrollHeight
}
</script>

<template>
  <ul ref="list">
    <li v-for="m in messages" :key="m.id">{{ m.text }}</li>
  </ul>
</template>
```

时机链条值得记下来：**改状态 → 更新任务入微任务队列 → `nextTick` 回调（DOM 已更新）→ 浏览器布局与绘制（`requestAnimationFrame` 在下一帧）**。要读尺寸或做动画，`nextTick` 之后常还要再等一帧；只滚动/聚焦则足够。适用面上它比 `watch` 窄：本质是「某个数据变了做一次」的事就用 `watch` + `nextTick`，别在每个改动处手写。

## provide / inject：替代的是 props 透传，不是数据流

`provide(key, value)` 在祖先注册一个后代可查到的值，`inject(key)` 沿父链向上找最近的提供者。它只解决一个问题：**中间组件不需要这些 props，却被迫一层层转发。**

| 典型场景 | 提供什么 | 为什么不该用 props |
| --- | --- | --- |
| 主题/语言/尺寸等环境配置 | 一个 `Ref`（或只读值 + 切换函数） | 每个按钮都要读主题，props 会污染所有中间组件接口 |
| 深层组件树的局部协作 | 表单容器向任意深度字段注册校验、收集错误 | 嵌套层级由用户配置决定，无法预定义 props 链 |
| 插件式上下文 | `app.provide(key, api)` 暴露 SDK/实例 | 插件跨路由跨页面注入，不属于任何父子关系 |

**不要用 `provide` 透传业务数据。** 值语义上是「这条记录」「这次编辑的内容」时，它的正确位置是 props 或 store。用 `provide` 把七层透传藏起来，坏处会被放大：接收组件的接口上看不见这个依赖，无法独立复用、难以 mock 测试、删掉提供者时得到的是运行时警告而不是编译错误；某个组件只有在「被特定父组件渲染」时才能工作，它就不是通用组件了。该用的判据（前两条同时成立）：① 中间层不需要这个值也不参与写入；② 语义上是「环境/上下文」而非「这条数据」；③ 提供者与消费者有稳定层级关系——两个互不相干的页面共享，属于 Pinia。

## InjectionKey 的类型安全写法

字符串 key 两端各写一遍，拼错得到 `undefined`，不同库还会撞名。`InjectionKey<T>` 把值的类型绑在 key 上：

```ts
// src/symbols/theme.ts —— 单一事实源
import type { InjectionKey, Ref } from 'vue'

export const themeKey: InjectionKey<Ref<string>> = Symbol('theme')
export const setThemeKey: InjectionKey<(mode: 'light' | 'dark') => void> = Symbol('theme-set')
```

```vue
<script setup lang="ts">
// 提供者
import { ref, provide, readonly } from 'vue'
import { themeKey, setThemeKey } from '../symbols/theme'

const mode = ref<'light' | 'dark'>('light')
provide(themeKey, readonly(mode))
provide(setThemeKey, (next: 'light' | 'dark') => { mode.value = next })
</script>
```

```ts
// 消费方（任意后代组件）
import { inject } from 'vue'
import { themeKey, setThemeKey } from '@/symbols/theme'

const mode = inject(themeKey, null)      // 推断为 Readonly<Ref<string>> | null
const setTheme = inject(setThemeKey, null)
```

`Symbol('theme')` 里的字符串只是调试描述，**不参与相等性判断**：两个文件各写一次 `Symbol('theme')` 得到两个不同 key，注入必然失败——key 必须从同一个模块导出给两端 import。泛型看不出来可回看 [泛型](/typescript/generics)。

`readonly()` 模式的价值：消费方写 `mode.value = 'x'` 会在开发期得到警告，这是「单向数据流 + 动作上抛」的轻量版；官方推荐的组合是**状态与改变它的函数一起提供**，让变更逻辑与数据留在提供者里。注意 `readonly()` 是**浅只读**，嵌套属性仍可写——要真不可变就扁平化结构，或只暴露动作。

## inject 的默认值与「找不到就抛错」

`inject(key)` 找不到提供者时返回 `undefined` 并发运行时警告；`inject(key, 默认值)` 兜底；默认值构造昂贵时用工厂形式 `inject(key, () => new ExpensiveClass(), true)`，只在真需要时才执行。取舍按依赖强度：**组件可独立使用**（第三方/可复用）就给默认值（且必须是新对象/新原始值，别共享可变默认值）；**组件是该体系的私有零件**、没提供者就是接错线，就显式抛错（`if (!ctx) throw new Error('FormField 必须在 FormProvider 内部使用')`）。抛错把结构错误变成开发期的响亮失败，而不是渲染出一个空白字段让用户来报 bug。TS 下 `inject(key)!` 的非空断言只是骗过编译器，运行时照样 `undefined`；更稳的是 `inject(key, null)` + 判空，让类型 `T | null` 强制你处理。

## 依赖注入与 Pinia 的分工

一句判据：**`provide` 是「组件树的局部上下文」，Pinia 是「应用级的状态」。**

| 维度 | provide / inject | Pinia（第 9 章） |
| --- | --- | --- |
| 可见范围 | 提供者以下的子树 | 全应用，含组件之外（守卫、请求封装） |
| 依赖在组件接口上是否可见 | 不可见（隐式） | 可见（显式 import 一个 store） |
| DevTools | 只有组件树上的 provider 记录 | store 面板、action 时间线、热更新保留状态 |
| 卸载回收 | 是，随提供者销毁 | 否，store 生命周期随 app |
| 典型用途 | 主题、表单上下文、插件注入 SDK | 用户/权限、服务端数据缓存、跨页面共享 |

`app.provide(key, value)` 效果近似全局单例——这正是该谨慎的原因：你手工造了一个没有变更追踪、卸载不回收的 store。等需要持久化、需要组件外访问，就说明该换 Pinia。

## Suspense、Teleport、KeepAlive

**`Suspense`**：默认插槽放异步子组件（其 setup 顶层可 `await`），`#fallback` 放骨架屏，把「整页白屏等接口」变成有层次的加载态。适合路由级/大区块，不适合给每个小组件包一层（fallback 闪烁比 loading 更难读）。官方把它标为**实验性特性**，小版本不保证 API 稳定（核实时间 2026 年 10 月），别写进核心抽象。

**`Teleport`**：`<Teleport to="body" :disabled="!isDesktop">` 把子树渲染到 DOM 另一处。弹窗挂 `body` 的原因是 CSS——祖先的 `overflow: hidden` 会裁剪，`transform`/`filter` 会改变定位基准，`z-index` 只在同一层叠上下文内比较，这正是「z-index 加了 9999 还被盖住」的根因（机制见 [定位与层叠上下文](/css/positioning-and-stacking)）。`Teleport` 只改 DOM 位置，**不改组件树**：props、inject、事件冒泡、生命周期仍按组件层级运作，所以弹窗里的按钮照样能 `inject` 主题。

**`KeepAlive`**：缓存被切掉的组件实例，配合 `include` / `exclude` / `max`。坑必须提前知道——**被缓存的组件不会再次触发 `onMounted`**，第二次进入页面时请求不重发，看起来「状态是旧的」。所以首次初始化留在 `onMounted`，「每次进入都要刷新」移到 `onActivated`，「暂停轮询/观察器/动画」用 `onDeactivated`；实例被 `max` 淘汰时仍会触发 `onUnmounted`，第三方实例的释放照旧。`include` 匹配组件名，`<script setup>` 下名字由文件名推导，需要显式 `defineOptions({ name: 'ListView' })` 才稳。另外它缓存实例与状态，**不缓存滚动位置**——滚动恢复仍要在 `onDeactivated` 存、`onActivated` 取。

## 常见错误与排查

1. **钩子写了却不执行。** 现象：`onMounted` 回调从未跑，控制台可能有一次 `... no active component instance` 警告。原因：注册发生在 `await` 之后，或在组件之外的普通函数里调用。怎么确认：钩子第一行打日志，检查注册点是否在 setup 的同步调用链上。修法：异步包进钩子回调。
2. **一次点击回调跑 N 次。** 原因：`addEventListener` 在 mounted 注册、`onUnmounted` 没解绑，或第三方实例没 `dispose`，切页面越多次叠加越多。怎么确认：DevTools → Memory → Detached DOM trees；或在注册处数次数。修法：成对释放，解绑时用同一个函数引用。
3. **`Maximum recursive updates exceeded`。** 原因：`onUpdated` 里写回了响应式数据，更新触发更新。怎么确认：把回调整体注释，故障消失即定位完成。修法：改用 `watch` 精确监听源，派生值写成 `computed`。
4. **模板引用恒为 `null`。** 三种原因：`useTemplateRef` 的字符串与模板 `ref` 值不一致；元素在 `v-if` 分支里、钩子执行时尚未渲染；用了 `:ref="setRef"` 函数式却没处理数组顺序。怎么确认：`onMounted` 打印引用值，区分「名字没对上」和「时机没到」。修法：名字对齐；异步出现的元素用 `watch(elRef, ...)`——模板引用的值变化本身是响应式的。
5. **父组件调不到子组件方法。** 现象：`child.value` 有值但自定义方法是 `undefined`。原因：`<script setup>` 组件默认私有。修法：子组件 `defineExpose({ focus, reset })`（第 5 章）。
6. **`inject` 得到 `undefined`，界面上某块空白且无报错。** 原因：提供者不在祖先链上（组件被单独渲染、弹窗另建一棵树），或两端各写了一次 `Symbol('theme')`。怎么确认：两端分别打印 `String(key)`——描述相同而引用不同就是这错。修法：key 单一来源；能独立使用就给默认值，否则显式抛错。同类问题：`readonly()` 只包顶层，嵌套属性仍可写，要不可变就只提供动作或扁平化结构。
7. **`KeepAlive` 后接口不重发。** 现象：第二次进入列表页没有请求。原因：请求留在 `onMounted`，缓存实例不会重挂载。修法：移到 `onActivated`，或对该路由不缓存（`exclude`）。

## 练习

<Exercise title="练习 1 · 找出失效的钩子" difficulty="基础">

下面这个 composable 想让列表加载完自动滚到顶部，有三处问题，请指出并给修正版。

```js
import { onMounted } from 'vue'

export async function useAutoScrollTop(elRef, fetchList) {
  const list = await fetchList()
  onMounted(() => { elRef.value.scrollTop = 0 })
  return { list }
}
```

<template #answer>

① **钩子在 `await` 之后注册**：拿不到组件实例，回调永不执行（只留一次「应在 setup 内同步调用」的警告）。② **`list` 是普通数组**：模板拿到的是快照，应把 `const list = ref([])` 声明在顶层、异步回来后赋值。③ **挂载时列表还没渲染**：数据异步到达，`onMounted` 那一刻 DOM 是空的，滚动目标还不存在。

```js
import { onMounted, ref, watch, nextTick } from 'vue'

export function useAutoScrollTop(elRef, fetchList) {
  const list = ref([])
  onMounted(async () => { list.value = await fetchList() })
  watch(list, async () => { await nextTick(); if (elRef.value) elRef.value.scrollTop = 0 })
  return { list }
}
```

要点：钩子同步注册、异步放进回调；「数据变了做一次 DOM 操作」用 `watch` + `nextTick`，不用 `onUpdated`。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造一次注入失效" difficulty="进阶">

两个文件分别写了下面两行，子组件里 `console.log(inject(ThemeKey, null))` 输出 `null`。解释原因并给最小修法。

```ts
// provider 侧
export const ThemeKey: InjectionKey<Ref<string>> = Symbol('theme')
// consumer 侧
export const ThemeKey: InjectionKey<Ref<string>> = Symbol('theme')
```

<template #answer>

`Symbol('theme')` 每次求值都产生**唯一** symbol，描述字符串不参与相等判断。两端各造一个，等于用 A 提供、用 B 查找，父链上没有 B，于是走默认值 `null`（不传默认值时是一条注入失败的运行时警告）。

修法：key 定义放进一个模块（`src/symbols/theme.ts`）只导出一次，两端 `import` 同一个 `ThemeKey`。附带收益是类型随 key 走，`inject(ThemeKey)` 直接推断出 `Readonly<Ref<string>> | undefined`。

</template>

</Exercise>

<Exercise title="练习 3 · 该用 ref 还是该用数据" difficulty="基础">

判断五个需求哪些必须用模板引用：① 弹窗打开后聚焦第一个输入框；② 表格显示「共 N 条」；③ 记录用户把右侧面板拖到多宽（用于持久化布局）；④ 输入超长时显示错误提示；⑤ 图表随容器尺寸重绘。

<template #answer>

① **必须 ref**（聚焦是浏览器方法）：`watch(open, v => v && inputRef.value?.focus())`。② **用数据**：`computed(() => items.value.length)`，mounted 里读 DOM 数行数不会重算。③ **用 ref 读、存进状态**：拖拽时读 `getBoundingClientRect()` 得宽度，写进 `ref` 并用 `:style` 绑定，持久化存数值而不是 DOM。④ **用数据**：`computed` 校验 + `:class`，别 `el.classList.add('error')`。⑤ **必须 ref**：真实元素交给 `ResizeObserver`，卸载时 `disconnect()`。

规律：ref 只用于「读布局」和「调用非 Vue 的浏览器 API」，读到的结果一律回到状态。

</template>

</Exercise>

<Exercise title="练习 4 · 写一个可清理的观察器" difficulty="挑战">

实现 `useInView(elRef)`，返回 `isVisible`：元素进入视口时置 `true`。要求钩子同步注册、卸载不泄漏、元素初始不存在（在 `v-if` 里）也能开始观察。

<template #answer>

```js
export function useInView(elRef) {
  const isVisible = ref(false)
  let observer = null
  const stop = () => { observer?.disconnect(); observer = null }

  function start(el) {
    stop()
    if (!el) return
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { isVisible.value = true; observer?.unobserve(e.target) }
    })
    observer.observe(el)
  }

  onMounted(() => start(elRef.value))
  watch(elRef, start)                  // 元素可能还没渲染：模板引用的值变化是响应式的
  onUnmounted(stop)

  return { isVisible }
}
```

检查点：① 钩子都在 `await` 之前；② `observe` 与 `disconnect` 成对；③ `watch(elRef, ...)` 覆盖异步出现的元素；④ 回调里写状态合法（组件仍活着），生产代码建议再加一个「已卸载就不再写」的标志位。

</template>

</Exercise>

## 官方文档与延伸阅读

- [生命周期钩子 API](https://vuejs.org/api/composition-api-lifecycle.html)（[中文](https://cn.vuejs.org/api/composition-api-lifecycle.html)）与 [生命周期简介](https://vuejs.org/guide/essentials/lifecycle.html) —— 核实钩子清单与各钩子时机，以及「必须在 setup 期间同步注册」这条规则。
- [模板引用](https://vuejs.org/guide/essentials/template-refs.html) —— 核实本章版本口径（`useTemplateRef` 需 Vue 3.5+）、签名 `useTemplateRef<T>(key: string): Readonly<ShallowRef<T | null>>`、`v-for` 引用为数组、`<script setup>` 组件默认私有需 `defineExpose`。
- [依赖注入](https://vuejs.org/guide/components/provide-inject.html) 与 [API：InjectionKey](https://vuejs.org/api/composition-api-dependency-injection.html) —— 核实 `inject` 默认值与工厂第三参、`readonly()` 提供模式、`app.provide` 与「变更留在提供者」的建议。
- [内置组件](https://vuejs.org/api/built-in-components.html) —— 核实 `KeepAlive` 的 `include` / `exclude` / `max` 与 `onActivated` / `onDeactivated`、`Teleport` 的 `to` / `disabled`、Suspense 的实验性标注。
- 站内回指：[响应式原理](/vue/reactivity)（更新排队与解包）、[计算属性与侦听器](/vue/computed-and-watch)（`watch` + `nextTick` 取代 `onUpdated`）、[组件基础](/vue/components)（`defineExpose`）、[composables](/vue/composables)、[Pinia](/vue/pinia)。跨领域：[事件循环、Promise 与 async/await](/javascript/asynchronous)、[DOM 操作与事件系统](/javascript/dom-and-events)、[定位与层叠上下文](/css/positioning-and-stacking)、[无障碍](/html/accessibility)（弹窗与焦点管理）。

## 下一章

这一章处理「一棵组件树内部」的时机与边界；一旦需要多页面、让 URL 与页面结构挂钩，就要引入路由。第 8 章 [Vue Router](/vue/router) 讲 history 模式对服务器 rewrite 的硬性依赖（这条约束与本站 `cleanUrls: false` 的静态部署方式同源）、导航守卫的三层结构与登录态控制、以及 URL 作为状态载体的正确用法。第 9 章 [Pinia](/vue/pinia) 接手本章留下的问题：共享状态需要跨页面、需要在组件之外访问时，`provide` 不该继续顶岗。

