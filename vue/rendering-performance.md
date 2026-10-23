# 渲染性能：先量出瓶颈，再决定动谁

列表一千条时页面卡住，你搜到的第一条建议大概率是「加 `v-memo`」，加上之后更卡了。你把 `reactive` 换成 `shallowRef`，界面开始在部分操作后不更新——于是花一小时找回不更新，再花一小时把 `triggerRef` 补满全屏。两类返工的原因相同：**优化动作发生在定位之前**。你不知道慢在哪一次渲染、哪一个组件，每个手段都像赌博。

Vue 3 的渲染性能一大半来自编译器：模板在构建期被编译成带优化的 `render` 函数，静态内容被提升、动态部分被打了标记，diff 范围被压得很小。所以**很多 Vue 2 时代的神话在这里不成立**：不需要缓存技巧、不该为了少建几个 VNode 而放弃组件、更不该在没测之前先上虚拟滚动。本章的顺序也是这样排的：性能从哪里来 → 什么情况会重渲染 → 如何观察 → 几个工具的真实语义与代价 → 长列表 → 最后给一条硬规则：**测量 → 定位 → 动手**。

## Vue 3 的渲染性能从哪里来：编译时优化 + 虚拟 DOM

虚拟 DOM 不是性能方案，它是让「状态 → 视图」可以声明的编程模型；成本在比较，而比较的代价取决于**你能不能提前知道哪些地方不需要比较**。Vue 3 把这件事交给编译器——模板是静态可分析的 HTML，编译器能看见哪些节点永远不变、哪些属性是动态的。

| 编译时手段 | 减少了什么工作量 |
| --- | --- |
| 静态提升（hoist static） | 不依赖状态的节点与属性被移出渲染流程，重渲染时不再重建 |
| patch flag（修补标记） | 动态节点自带「哪里是动态的」标记，diff 只检查被标记的那一类，跳过无用比对 |
| block tree（块树） | `v-if` / `v-for` 引入的结构被打平成「块」，块内只维护一个动态节点列表，重排时只在这个列表里 diff，不递归整棵子树 |

**结论：组件重渲染的成本和它「动态部分的数量」成正比，而不是和模板总行数成正比。** 一个 300 行、只有 5 处插值的组件，比 20 行、每行都依赖状态的组件便宜得多。想让渲染变快，主要手段是**减少动态部分**，而不是给已有结构贴 `v-memo`。

<Callout type="unverified" title="机制细节以官方渲染机制文档为准">

上表是概念级描述。patch flag 有哪些取值、嵌套 `v-for` 的块边界、编译器对「稳定子节点」的判定规则，本章未逐条核实。请读官方[渲染机制](https://cn.vuejs.org/guide/extras/rendering-mechanism.html)（2026-10-17 核实该页含「编译器辅助的虚拟 DOM」一节），并在 [Vue SFC Playground](https://play.vuejs.org/) 看自己那段模板的编译输出，不要引用第三方文章里的 flag 数值表。

</Callout>

## 什么情况会触发一次重渲染

| 触发源 | 说明 / 最常见的浪费 |
| --- | --- |
| 自身响应式依赖变化 | 模板（含 `computed` 链）读过的 `ref` / `reactive` 属性被写入。浪费形态：一个 `ref` 同时驱动高频输入框与大列表 |
| props 变化 | 传入值在浅比较意义上变了。浪费形态：父级每次新建对象/数组字面量传下去 |
| 插槽内容变化 | 插槽默认属于父组件渲染作用域，父级重渲染时内容被重建，子组件通常随之更新。浪费形态：把高频状态塞进插槽 |
| 注入值变化 | `provide` 的响应式值更新，所有读取方更新。浪费形态：`provide` 一个「什么都往里塞」的大对象 |
| `forceUpdate()` | 直接标记实例更新。用它绕过响应式而不是修正依赖，属于设计问题 |
| `key` 变化 | 不是重渲染而是**销毁重建**，局部状态归零（[第 3 章](/vue/template-syntax)已警告「当刷新按钮用」） |
| 依赖的 `computed` 返回了新引用 | 内容变了引用没变会漏更新；引用变了内容没变会白渲染 |

反过来的那一半同样重要：**props 未变时子组件默认被跳过更新**（官方性能指南的 *Props Stability*，2026-10-17 核实），所以「拆小组件」的收益前提是**新组件的 props 只包含它真正依赖的数据**。拆一个接收整包 `state` 的子组件，它每次都更新，拆分就白做。

<Callout type="unverified" title="插槽与注入的细粒度更新判定">

「插槽内容变化必然导致子组件更新」在 Vue 3 里有编译器细分优化参与，具体判定条件本章未核实，结论以官方[插槽](https://cn.vuejs.org/guide/components/slots.html)与[依赖注入](https://cn.vuejs.org/guide/components/provide-inject.html)页面为准；请用下面三种手段在自己的项目里实测。

</Callout>

## 如何观察重渲染：三种手段与各自局限

**「我觉得它在渲染」不是证据。**

**手段一：setup 里加计数日志。** 最便宜的第一遍粗筛。

```vue
<script setup lang="ts">
import { getCurrentInstance, onBeforeUpdate, ref } from 'vue';

const renderCount = ref(0);
onBeforeUpdate(() => {
  renderCount.value += 1;
  console.log(`[render] ${String(getCurrentInstance()?.type?.name ?? '?')} 第 ${String(renderCount.value)} 次`);
});
</script>
```

预期结果：每次真正进入更新流程输出一行；静态卡片不刷屏。局限三条：计数本身是响应式写入（别把它渲染到界面上，否则计数触发更新）；它只告诉你「渲染了」不告诉你「因为哪个字段」；生产代码里必须删干净。

**手段二：`onRenderTracked` / `onRenderTriggered`。** 一对渲染调试钩子：前者在依赖被收集时回调，后者在某个依赖触发本次渲染时回调，事件对象带 `target` / `key` / `type`（`set` `add` `delete` `clear`）/ `newValue` / `oldValue`。

```vue
<script setup lang="ts">
import { onRenderTriggered } from 'vue';

onRenderTriggered((event) => console.warn('渲染被触发', event.key, event.type));
</script>
```

预期结果：改 `filter` 时输出 `key: "filter"`，鼠标移动导致更新时输出别的 key——这一步就是「哪次渲染由谁引起」的直接答案。局限（官方 API 页 2026-10-17 核实）：**仅开发模式生效、SSR 期间不调用**；会为每个渲染依赖增加回调，别同时挂几十个组件；`watch` 回调里的副作用与组件外 store 的变更不在报告范围。

**手段三：Vue DevTools 的 highlight updates。** 更新组件边框闪烁，价值在于把「渲染」和界面位置对应起来。局限：**只有视觉、没有原因**；依赖扩展（扩展与 Vue 版本不匹配会漏报甚至整个面板报错，这类「性能问题其实是工具问题」很常见）；频繁闪烁肉眼分不出；生产不可用。

选择顺序：**先用高亮定位「哪个区域」，再用计数确认「哪个组件」，最后用 `onRenderTriggered` 查明「哪个字段」。**

## v-memo：真实语义、适用条件与它更慢的原因

官方 API 页（2026-10-17 从英文版逐句核实）的定义很硬：

- 仅 3.2+；期望值 `any[]`，**长度固定**。缓存模板块（sub-tree），可用于元素和组件；若数组每个值和上次渲染都相同，**整棵子树的更新被跳过，连 VNode 创建都跳过**（直接复用上次的副本）。
- 空依赖数组 `v-memo="[]"` 功能上等价于 `v-once`。
- 官方定位原话：它是为性能关键场景提供的**微观优化，绝大多数情况不需要**；最常见的有用场景是 `length > 1000` 的大列表。
- 与 `v-for` 同用时**必须写在同一个元素上，写在 `v-for` 内部不生效**。
- 依赖数组里**不必**再写 `item.id`：Vue 从 `:key` 自动推断当前项。
- 也可用于组件，手动阻止某些边界情况下子组件的多余更新；**依赖数组写错会跳过本该发生的更新，责任在开发者**。

```vue
<template>
  <div v-for="item in list" :key="item.id" v-memo="[item.id === selected]">
    <p>ID: {{ item.id }} - selected: {{ String(item.id === selected) }}</p>
    <p>……更多子节点</p>
  </div>
</template>
```

这里读作「只有这一项的选中状态翻转时才更新它」，其余项复用上次 VNode、完全跳过 diff。**依赖数组比较的是内容不是引用**：写 `v-memo="[item]"` 等于每次新建数组、浅比又失败，缓存基本无效；写 `v-memo="[]"` 则这块永不更新，是隐藏 bug 的温床。

**为什么常常更慢**：比较不是免费的。每项都要构造数组并逐位比较，子树只有两三个节点时比较成本可能高于直接 diff；被 memo 的子树**持有上次 VNode 与闭包引用**，大列表里显著增加内存与 GC 压力。**所以 `v-memo` 是需要实测的手段，不是默认优化。**

<Callout type="warn" title="v-memo 与正确性的冲突">

依赖数组少写一项，被跳过的是整棵本该更新的子树，表现为「点了没反应」——比卡顿难查十倍。加它时同时留注释说明「这里为什么可以跳过」，并在验收清单加一项「勾选/取消第 N 项时界面正确」。

</Callout>

## shallowRef / markRaw：大对象不进 Proxy

深响应式的代价是：`reactive` 递归把访问到的嵌套对象转成 `Proxy`，每次属性读取都经过拦截。**当数据本身不需要驱动视图，这套追踪就是纯浪费。** 典型对象：图表配置（ECharts option，成千上万键）、地图数据（GeoJSON 多边形、瓦片配置）、第三方实例（ECharts / Mapbox / Three.js 场景 / 编辑器 / `WebSocket`）、后端一次性返回的大数组。

官方性能指南的对应小节标题是 *Reduce Reactivity Overhead for Large Immutable Structures*（2026-10-17 核实），推荐 `shallowRef()` / `shallowReactive()`，关键约束是**嵌套对象必须按不可变对待，更新要替换根引用**：

```ts
const shallowArray = shallowRef<Todo[]>([/* 一大坨深层对象 */]);
shallowArray.value.push(newObject);                          // 不会触发更新
shallowArray.value = [...shallowArray.value, newObject];     // 会触发更新
```

| 你写的 | 结果 | 正确做法 |
| --- | --- | --- |
| `state.value.count = 2`（`state` 是 `shallowRef`） | 界面不动 | `state.value = { ...state.value, count: 2 }` |
| 就地改深层、不想复制 | 界面不动 | 改完调用一次 `triggerRef(state)` |
| 第三方实例放进 `reactive` | 被 Proxy 包裹，实例内部 `this` 出错 | 放进 `shallowRef`（比 `markRaw` 更合适） |

`triggerRef` 的语义是「当作值变了」：依赖它的 `computed` 全部重算、组件全量重渲染，**不是精确补丁**。一个文件里出现第三个 `triggerRef` 说明数据结构选错了（[第 2 章](/vue/reactivity)同样警告过）。`markRaw(obj)` 把对象永久标记为永不转代理，官方给出**身份不一致**警告：它嵌进 reactive 后 `foo.nested === bar.nested` 可能是 `false`（官方示例输出正是 `false`）——所以它只用于「整个对象都不需要响应式」，别指望它在响应式树里保持引用相等。

## v-once、静态内容与「编译器已经做过的部分」

`v-once` 让元素及其子内容只渲染一次、之后视为静态。适用面比 `v-memo` 更窄：**内容真的永远不变**（协议文案、一次性注入的配置文本）。风险同源——被包住的结构里若混进动态依赖，之后的变化全部丢失且不报错。

现实判断：模板里大多数「看起来静态」的部分（列表项外壳、图标 SVG、说明文字）不依赖状态，编译器已经提升了，再加 `v-once` 收益接近 0。官方性能指南把 `v-once` 与 `v-memo` 一起列在 *Update Optimizations* 下（该页小节顺序 2026-10-17 核实为：Profiling Options → Page Load Optimizations → Update Optimizations（Props Stability / `v-once` / `v-memo` / Computed Stability）→ General Optimizations（Virtualize Large Lists / Reduce Reactivity Overhead… / Avoid Unnecessary Component Abstractions）），**这份清单里没有任何一条要求你写代码时就加它们。**

## 列表 key：性能问题常常先是正确性问题

回指[模板语法与指令](/vue/template-syntax)：不写 `key` 时 Vue 就地按索引复用元素，小列表上这是最优解；一旦会重排、头部插入或删除，索引不再等于身份，于是「输入内容串到另一行」「勾选跑到别的项」。

性能视角的补充：**稳定的业务 id 是虚拟滚动与 `v-memo` 能工作的前提**——`v-memo` 靠 `:key` 推断当前项，虚拟列表要把「可视区第一项」算准，两者都建立在「同一 id 对应同一项」上。「为了性能不写 key」是错的：省下的那点内存换来的是重排时整段 DOM 的文本与属性重写。

## 长列表：分页、无限滚动、虚拟滚动

官方说法是卡顿的直接原因**是浏览器要处理的 DOM 节点数量太大**（2026-10-17 核实），所以三条路都在做同一件事——让同时在 DOM 里的节点变少。

| 方案 | 适用 | 代价 |
| --- | --- | --- |
| 分页 | 数据在服务端；按条件查找；需要可分享的「第几页」URL | 失去连续浏览；每页一次请求 |
| 无限滚动 + `IntersectionObserver` | 总量可控（几百到几千）、无需随机跳页 | DOM 持续增长；滚动位置与恢复要自己管 |
| 虚拟滚动 | 上万条、需要滚动条可用、项高固定或可估算 | 状态不能存 DOM；动态高度复杂；键盘与读屏要额外做 |

**分页优先。** 数据来自后端时分页几乎总是更好的答案：同时缩减 SQL 扫描、网络体积和 DOM 节点，页码还能直接进 URL（正是[阶段项目](/vue/project)的硬要求）。另两条是「数据已经全在前端」时的补救。

### 无限滚动：最小可用实现

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const sentinel = ref<HTMLElement | null>(null);
const loading = ref(false);
const finished = ref(false);
const page = ref(1);
const items = ref<Todo[]>([]);
let observer: IntersectionObserver | null = null;

async function loadNextPage(): Promise<void> {
  if (loading.value || finished.value) return;      // 两道闸门，缺一个就爆发请求
  loading.value = true;
  try {
    const rows = await listTodos(page.value);
    if (rows.length === 0) finished.value = true;
    else { items.value.push(...rows); page.value += 1; }
  } finally { loading.value = false; }
}

onMounted(() => {
  const el = sentinel.value;
  if (!el) return;
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) void loadNextPage();
  }, { rootMargin: '200px' });
  observer.observe(el);
});

onBeforeUnmount(() => { observer?.disconnect(); observer = null; });
</script>

<template>
  <ul><li v-for="item in items" :key="item.id">{{ item.text }}</li></ul>
  <div ref="sentinel"></div>
  <p v-if="loading" role="status">加载中……</p>
  <p v-else-if="finished">没有更多了</p>
</template>
```

三处最容易漏：**必须在挂载后创建**（`sentinel` 在 `setup` 里是 `null`）、**必须 `disconnect()`**（回指[生命周期与依赖注入](/vue/lifecycle-and-inject)与 [JS 层面的无障碍与性能](/javascript/accessibility-and-performance)：切三个页面留三个回调，它们还在往已销毁的列表写数据）、**必须防重复触发**（哨兵一进视口就连回调多次）。`rootMargin: '200px'` 是提前量；`entries[0]` 在 `noUncheckedIndexedAccess` 下可能是 `undefined`（回指 [TypeScript 阶段项目](/typescript/project)），先判空。

### 虚拟滚动的原理与自己实现

三个量：总高度 `total = items.length × itemHeight` 撑住滚动条；起始索引 `start = Math.floor(scrollTop / itemHeight) − buffer`；渲染数量 `count = ceil(viewportHeight / itemHeight) + 2 × buffer`。渲染出的那段用 `transform: translateY(start × itemHeight)` 放到正确位置——**用 `transform` 而不是 `top`/`padding`，因为它不触发重排。**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(defineProps<{ items: Todo[]; itemHeight?: number; buffer?: number }>(), {
  itemHeight: 48, buffer: 5,
});
const viewport = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
let observer: ResizeObserver | null = null;
let frame = 0;

const start = computed(() => Math.max(0, Math.floor(scrollTop.value / props.itemHeight) - props.buffer));
const end = computed(() =>
  Math.min(props.items.length, start.value + Math.ceil(viewportHeight.value / props.itemHeight) + props.buffer * 2));
const visible = computed(() => props.items.slice(start.value, end.value));
const offsetY = computed(() => start.value * props.itemHeight);

function onScroll(): void {
  if (frame) return;                                  // 滚动频率高于渲染：rAF 合帧
  frame = requestAnimationFrame(() => {
    frame = 0;
    const el = viewport.value;
    if (el) { scrollTop.value = el.scrollTop; viewportHeight.value = el.clientHeight; }
  });
}

onMounted(() => {
  const el = viewport.value;
  if (!el) return;
  viewportHeight.value = el.clientHeight;
  observer = new ResizeObserver(() => { viewportHeight.value = el.clientHeight; });
  observer.observe(el);
});
onBeforeUnmount(() => { if (frame) cancelAnimationFrame(frame); frame = 0; observer?.disconnect(); observer = null; });
</script>

<template>
  <div ref="viewport" class="viewport" @scroll.passive="onScroll">
    <div :style="{ height: `${String(items.length * itemHeight)}px` }">
      <div :style="{ transform: `translateY(${String(offsetY)}px)` }">
        <div v-for="item in visible" :key="item.id" class="row">{{ item.title }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.viewport { height: 100%; overflow: auto; }
.row { height: 48px; display: flex; align-items: center; }
</style>
```

三个已知坑：**① 动态高度**——所有公式建立在常量高度上，「有备注的行更高」会算错位移、出现空白或重叠；解法是「估算 + `ResizeObserver` 实测回填 + 前缀和二分查找」，**这正是别自己写虚拟滚动的理由**。**② 滚动条抖动**——`clientHeight` 与 `total` 在快速滚动时短暂不一致，滚动条长度反复变化并连锁触发滚动事件；对策是 `@scroll.passive` + rAF 合帧 + 缓冲区不为 0。**③ 选中状态丢失**——滚出可视区的行被销毁，存在那一行的局部状态（勾选、展开、草稿）随之消失，所以**状态必须存在列表外部**（store 或父级 `Set`），并且 `key` 必须是 `item.id`。

**第三方库的定位**：官方 *Virtualize Large Lists* 小节（2026-10-17 核实）点名三个——[vue-virtual-scroller](https://github.com/Akryum/vue-virtual-scroller)、[vue-virtual-scroll-grid](https://github.com/rocwang/vue-virtual-scroll-grid)、[vueuc/VVirtualList](https://github.com/07akioni/vueuc)。它们对动态高度的支持程度、与当前 Vue 版本的兼容性、SSR 表现，本章未实测，**以各自仓库文档为准**；官方只负责告诉你「该虚拟化」。

## 组件级异步加载与 defineAsyncComponent

如果慢发生在**首次加载**而不是更新，瓶颈是 JS 体积与解析时间，前面所有手段都无关。`defineAsyncComponent`（2026-10-17 核实）接受返回 Promise 的 loader，或带 `loadingComponent` / `errorComponent` / `delay`（**默认 200ms**，低于它就显示加载态、避免闪烁）/ `timeout` / `suspensible` 的选项对象；配合 `import()` 生成独立 chunk，浏览器只在真正渲染时请求它。

```ts
const HeavyChart = defineAsyncComponent({
  loader: () => import('@/components/HeavyChart.vue'),
  loadingComponent: ChartSkeleton,
  delay: 200,
});
```

**别当银弹**：被异步化的组件晚一帧出现，`onMounted` 时机、`useTemplateRef` 拿到的节点都受影响；给「首屏就要显示」的内容套异步组件是负优化。选择标准：只有明显低于首屏优先级、且体积可观的区块（图表、富文本编辑器、导出预览）才异步化。路由级懒加载属于[第 8 章](/vue/router)，体积优化属于 [Vite 构建侧](/frontend-engineering/vite-build)。

## 三个日常写法：派生、侦听、抽象

**computed 缓存 vs 模板里调函数。** 回指[计算属性与侦听器](/vue/computed-and-watch)：`computed` 惰性求值 + 缓存，依赖不变直接返回上次结果；模板里的函数**每渲染一次重算一次**。判断口径：**函数体内做了遍历、排序、正则或日期格式化 → 提出来；只取字段或拼短字符串 → 留在模板里可读性更好。** 带参数的派生（`rowLabel(item)`）在 Vue 3 里通常不必焦虑——patch flag 会跳过内容没变的文本节点；但 `items.filter(...).length` 这类每帧重算的表达式仍然该进 `computed`。把计算下放到「只有它依赖那份数据才更新」的位置（子组件里的 `computed`），比在大组件里堆缓存更有效。

**`watch` 的 `deep` 代价。** 回指第 4 章：`deep: true` 会递归遍历整个对象图建立追踪，对大数组/大对象而言**恰好抵消了 `shallowRef` 想省掉的开销**。常见错误是「不确定会改哪层，所以无脑 `deep`」。替代优先级：① 侦听精确 getter（`() => form.value.items.length`）；② 侦听某个 id 而不是整个对象；③ 把副作用放进写入方（store 的 action）而不是让消费方偷偷侦听；④ 真的需要「整棵树变了就通知」时用 `shallowRef` + 替换根引用 + 侦听根值。

**组件抽象不是免费的。** 官方 *General Optimizations* 里有 *Avoid Unnecessary Component Abstractions*（2026-10-17 核实）：多余的层级增加实例化与 props 传递成本。判据不是行数而是**接口**：一个只把 props 原样往下传、自己既无状态也无逻辑的中间组件，删掉。

## 优化的正确顺序：测量 → 定位 → 动手

**1）测量：证明慢是真的、发生在哪一段时间。** DevTools 的 **Performance** 面板录制一段交互，看火焰图里 JavaScript 色块属于哪个函数，主线程阻塞超 50ms 的长任务会标红。代码侧插标记量化到你关心的那一段：

```ts
performance.mark('list-render-start');
await nextTick();
performance.mark('list-render-end');
performance.measure('list-render', 'list-render-start', 'list-render-end');
console.log(`本次更新耗时 ${String(performance.getEntriesByName('list-render').at(-1)?.duration.toFixed(1))} ms`);
```

预期结果：输出一行耗时，改动前后各测一次可比较。局限：`nextTick` 后 DOM 已提交但样式与布局可能还没完成，这只是脚本时间，最终判断看 Performance 里的实际帧间隔；`mark` 会持续累积条目，**测完删掉**。

**2）定位：哪个组件、哪一次渲染、哪个字段。** 手段一 → 手段三 → 手段二。这一步必须给出一个能一句话说完的结论，例如「勾选第 3 项时 1000 个行组件全部更新，触发源是 store 里 `selectedIds` 被整体替换」。

**3）动手：选一个与结论匹配的最小改动。** 上面那个例子对应「让每一项只依赖自己是否选中」，而不是「给每项加 `v-memo`」。改完回到第 1 步再测，把数字写进 commit message；**测不出差别就 revert**——留下的复杂度是真复杂度。

顺带一条与规模无关的泄漏：**事件监听与观察器不卸载会伪装成「渲染变慢」**。回指第 7 章——处理器必须是同一引用（匿名箭头函数删不掉）、`observe` 与 `disconnect` 成对、`requestAnimationFrame` 也要 `cancelAnimationFrame`；注册若发生在 `watch` 回调里，每次执行都要先拆旧的。表现是「越用越卡」：同一次滚动的回调次数随浏览次数线性增加。

## 什么时候这些优化都不需要

数字是经验阈值不是标准，以你自己的测量为准：

| 场景 | 需要的动作 |
| --- | --- |
| 待办、笔记类个人应用，几十到一两百条 | 什么都不用做。写好 `key`、别在模板里排序就够了 |
| 本地 500–2000 条，滚动略涩 | 先查 `deep` 侦听与模板函数调用，通常修掉就够，不用虚拟化 |
| 2000 条以上，或每项 DOM 复杂（图片、多行富文本） | 分页（数据在服务端）或虚拟滚动（数据在本地） |
| 大图表配置、GeoJSON、第三方实例进了状态 | 与规模无关：直接用 `shallowRef` / `markRaw`，本来就不该被 Proxy 追 |
| 首屏白屏久 | 与渲染无关，走体积与代码分割：[性能指标与 Core Web Vitals](/frontend-engineering/performance) |

**别为了 1ms 牺牲可读性。** 一个 200 行组件加满 `v-memo` 变成 260 行、依赖数组要长期维护、每次改动都得重测勾选逻辑，而它服务的列表只有 40 条——这类代码的真实成本是「半年后没人敢动」。本站[学习顺序建议](/vue/)把第 10 章放在最后学，就是这个原因：**先写出正确、清晰、能测的代码，再用数字决定要不要把它变复杂。**

## 常见错误与排查

**1）加了 `v-memo` 更卡。** 现象：帧率没改善甚至下降。原因：子树本来就小（构造与比较数组的开销大于直接 diff）+ 被缓存子树一直占内存。怎么确认：临时删掉 `v-memo`，用手段一的计数与 Performance 面板对比同一操作。怎么修：只在「每项内容大且只少数项变化」时保留；诉求是「别渲染这么多项」的话，答案是虚拟滚动。

**2）换成 `shallowRef` 后界面不更新。** 现象：DevTools 里数据明明变了，视图不动。原因：改的是 `.value` 内部深层属性，浅响应式不追踪。怎么确认：`console.log(state.value.a)` 值是对的（状态变了、视图不知道，第 2 章五步流程）；`isRef(state)` 为 `true`。怎么修：替换整个 `.value`，或改完调用一次 `triggerRef`；同文件出现第三次 `triggerRef` 时退回归普通 `ref` 并重新设计数据结构。

**3）勾选一项，整个列表闪一遍。** 原因：每行都依赖「整个选中集合」，一次写入惊动所有项。怎么确认：`onRenderTriggered` 看 `key`；或行组件 `onBeforeUpdate` 计数——输出行数接近列表长度就证实。怎么修：把「我是否被选中」下放到行（传 `selected: boolean`），或对行用 `v-memo="[item.id === selectedId]"`。

**4）页面越用越卡。** 原因：监听器/观察器泄漏或 `deep` 侦听巨型对象。怎么确认：Performance 里同一次输入的回调耗时随时间增加；在 `onBeforeUnmount` 打日志确认它真的执行过。怎么修：成对清理；`deep` 换成精确 getter。

**5）虚拟列表滚到中间出现空白或行重叠。** 原因：项高不固定但公式用了常量；或位移与 `key` 对应的项没对齐。怎么确认：把 `buffer` 调到 20，空白减少但不消失 → 高度估算问题。怎么修：给行设死高度 + `overflow: hidden`，或换支持动态高度的库。

**6）生产构建里「性能问题」消失（或反过来）。** 原因：开发模式有响应式调试信息、DevTools 桥接与额外代理；生产则被压缩与代码分割改变了加载顺序。怎么确认：两种模式各录一次 Performance。怎么修：以 `npm run build && npm run preview` 的数据为决策依据。

## 练习

<Exercise title="练习 1 · 用计数证明 v-for 的更新范围" difficulty="基础">

一个 500 项列表，每项渲染一个复选框，勾选状态存在父组件的 `Set<string>` 里。预测：勾选一项会让多少个组件进入更新流程？用手段一与手段三分别怎么验证？

<template #answer>

**预测：500 行都重新渲染。** 渲染 effect 依赖了 `selectedIds`，它一变整段模板重执行；patch flag 只省下不变部分的比对成本，但 500 项的 VNode 仍然全部创建。

步骤：① 把行抽成 `TodoRow.vue`，在它的 `onBeforeUpdate` 里输出 `props.id`，勾选第 7 项统计行数——接近 500 就证实预测。② 打开 highlight updates，整个列表区一起闪烁同样证实。③ 修正对比：传 `:selected="selectedIds.has(item.id)"` 让行组件只依赖自己那一个布尔值；改完重复 ①②，行数应降到 1–2。

关键结论：**优化是否生效由更新次数证明，不由「我加了 v-memo」证明。**

</template>

</Exercise>

<Exercise title="练习 2 · 让 shallowRef 不更新，再修好它" difficulty="进阶">

下面的代码界面不动。指出原因，给出两种修法（其中一种不用 `triggerRef`），并说明各自适用条件。

```vue
<script setup lang="ts">
import { shallowRef } from 'vue';

const option = shallowRef<{ series: Array<{ data: number[] }> }>({
  series: [{ data: [1, 2, 3] }],
});
function addPoint(): void { option.value.series[0].data.push(4); }
</script>
```

<template #answer>

**原因**：`shallowRef` 只把 `.value` 的读写做成响应式，内层是原样存放的普通对象，`push` 不经过任何拦截，没有 effect 被触发。

**修法一（替换根引用）**：

```ts
function addPoint(): void {
  const first = option.value.series[0];
  if (!first) return;
  option.value = { series: [{ ...first, data: [...first.data, 4] }] };
}
```

适用：配置对象不大、更新频率低、能接受「嵌套数据按不可变对待」——这也是官方对大型不可变结构推荐的写法。

**修法二（就地改 + 手动唤醒）**：`option.value.series[0].data.push(4); triggerRef(option);` 适用：数据很大不便复制，或对象本来就是第三方库持有的可变实例（ECharts 实例放进 `shallowRef`，改的是库内部状态，只能手动唤醒）。代价：`triggerRef` 是「当作值变了」，依赖它的 `computed` 全部重算，漏写一次就静默不更新。

两处细节：`option.value.series[0]` 在 `noUncheckedIndexedAccess` 下可能是 `undefined`，必须判空（修法一里的 `if (!first) return;`）；`addPoint` 直接改深层配置绕过了 store 的唯一写入者原则，真实项目里应由 action 负责。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造一次 v-memo 漏更新并解释" difficulty="挑战">

下面这段用了 `v-memo` 但依赖数组漏了一项。指出漏了什么、按第 2 章的五步定位流程如何确认是 `v-memo` 而不是响应式断链，并给出修法。

```vue
<template>
  <li v-for="item in items" :key="item.id" v-memo="[item.done]">
    <span>{{ item.title }}</span>
    <button @click="rename(item.id)">改名</button>
  </li>
</template>
```

<template #answer>

**漏的是 `item.title`**：子树里渲染了 `title`，依赖数组只写了 `done`。点「改名」后 `title` 变了、`done` 没变 → 数组每项与上次相同 → **整棵子树更新被跳过、连 VNode 都复用**，界面文字不变。数据侧确实正确：DevTools 里 `items[0].title` 已是新值。

定位过程：① 状态变了吗？DevTools 看 `items`，变了 → 不是断链。② 视图读过它吗？模板里有插值，读了。③ **是不是被复用或缓存挡住了？** 只删这一处 `v-memo`（别的都不动），界面立刻正确 → 锁定依赖数组不完整。④ 排除另一种伪装：若 `items` 在 `shallowRef` 里，删掉 `v-memo` 界面仍然不动——所以「一次只关一个开关」很关键，先删 `v-memo`，再查 `shallowRef`。

修法：把渲染读到的每个可变值都写进数组——`v-memo="[item.done, item.title]"`。但更值得做的是**承认这里不该用 `v-memo`**：子树只有两三个节点，比较数组的成本可能高于 diff，删掉它同时删掉一类 bug。

顺带：`rename(item.id)` 应 emit 给父级由 store 的 action 写入，而不是就地改 `v-for` 元素属性——后者一旦外层换成 `shallowRef` 就静默失效（练习 2）。

</template>

</Exercise>

## 官方文档与延伸阅读

- [渲染机制](https://cn.vuejs.org/guide/extras/rendering-mechanism.html) —— 核实三类编译时优化（编译器辅助的虚拟 DOM、patch flag、block tree）。2026-10-17 核实该页含这些小节。
- [性能建议](https://cn.vuejs.org/guide/best-practices/performance.html) —— 核实本章立场（先分析再行动）与小节结构；*Virtualize Large Lists* 点名的三个库、「上千 DOM 节点让浏览器变慢」、*Reduce Reactivity Overhead for Large Immutable Structures* 的不可变约束与 `push`/替换根引用示例，都出自这一页（2026-10-17 核实）。
- API 参考：[`v-memo`](https://cn.vuejs.org/api/built-in-directives.html#v-memo) 与 [`v-once`](https://cn.vuejs.org/api/built-in-directives.html#v-once) —— 本章 `v-memo` 全部条款（3.2+、固定长度依赖数组、跳过整棵子树与 VNode 创建、空数组等价 `v-once`、须与 `v-for` 同元素且不能在 `v-for` 内部、`length > 1000`、由 `:key` 推断 item id）2026-10-17 从英文版逐句核实。
- API 参考：[`shallowRef` / `triggerRef` / `markRaw`](https://cn.vuejs.org/api/reactivity-advanced.html) —— 核实「只有 `.value` 响应式」「替换 `.value` 或调用 `triggerRef`」「`markRaw` 的身份不一致（官方示例输出 `false`）」。
- API 参考：[`onRenderTracked` / `onRenderTriggered`](https://cn.vuejs.org/api/composition-api-lifecycle.html) —— 核实两者「仅开发模式、SSR 不调用」与事件对象字段（`effect` / `target` / `type` / `key` / `newValue` / `oldValue`）。
- [异步组件](https://cn.vuejs.org/guide/components/async.html) —— 核实 `defineAsyncComponent` 的选项与 `delay` 默认 200ms。
- [列表渲染](https://cn.vuejs.org/guide/essentials/list.html)、[插槽](https://cn.vuejs.org/guide/components/slots.html)、[计算属性与侦听器](https://cn.vuejs.org/guide/essentials/watchers.html) —— 分别核实 `key` 的就地复用策略（本章已标 unverified 的插槽归属与注入细则请看前者）、`computed` 缓存与 `deep` 的开销来源。
- MDN：[`IntersectionObserver`](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)、[`ResizeObserver`](https://developer.mozilla.org/en-US/docs/Web/API/Resize_Observer_API)、[`performance.mark`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceMark)、[Long Tasks API](https://developer.mozilla.org/en-US/docs/Web/API/Long_Tasks_API)、[Vue DevTools 仓库](https://github.com/vuejs/devtools)。

## 下一章

本章的立场是「性能来自结构，不来自贴标记」：静态提升、patch flag 与块树已经在替你省下大部分比对（定义以官方[渲染机制](https://cn.vuejs.org/guide/extras/rendering-mechanism.html)页为准），你能做的是让动态部分尽量小、把不该被追踪的大对象挡在 `Proxy` 之外、在真的上千条时减少 DOM 节点数，并且**每一步都用数字证明**。它回指了[响应式原理](/vue/reactivity)（`shallowRef` 的代价）、[计算属性与侦听器](/vue/computed-and-watch)（`computed` 缓存与 `deep` 开销）、[生命周期与依赖注入](/vue/lifecycle-and-inject)（成对清理）与[模板语法](/vue/template-syntax)（`key` 与就地复用）。

下一章[单文件组件与构建链](/vue/sfc-and-build)换一个视角：`.vue` 的三个块各做什么、`<script setup>` 编译完剩下什么、`scoped` 到底靠什么隔离样式、Vite 在开发与构建时分别如何处理这个文件。它解释本章几个前提的来处——「静态可分析」正是模板被编译器读懂的结果，而开发模式与生产构建的性能差异也和构建链直接相关。
