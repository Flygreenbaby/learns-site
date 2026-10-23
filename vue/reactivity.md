# 响应式原理：Proxy 拦截读写，解构为什么一断就全断

**「改了数据界面没变」在 Vue 里几乎不是随机的。** 它是同一组机制的必然出口：状态被换成代理对象，而代理只在你**通过它读写属性**时生效。任何一步让你手里拿的不再是那个代理，或者让视图从没读过那个属性，更新就静默消失。所以排查方向不是「再试一种改法」，而是「链条哪一段不在代理上」。

文档里列成「注意事项」的每一条——`ref` 为什么必须有 `.value`、`reactive` 为什么不能整体替换、解构为什么断、`shallowRef` 改了内层为什么不动——都是同一件事的投影：**框架要在读的时候记下「谁在读」，在写的时候叫醒「记在册的读者」；而这个动作只能发生在对象属性或 `.value` 这两种可被拦截的位置上。** 前置：[JavaScript 学习地图](/javascript/learning-map) 里的 `Proxy` 一节，以及[类型、值与引用语义](/javascript/types-and-values)：**赋值复制的是引用，不是内容**。

## 机制的第一条边界：只能拦截对象属性

官方对响应式原理的说明里，这句话是全部规则的源头（[响应式深入](https://cn.vuejs.org/guide/extras/reactivity-in-depth.html)）：JS 里**没有办法追踪局部变量的读写**，能拦截的只有对象属性的访问与赋值。于是 `Proxy`（以及 `ref` 内部的 getter/setter）是唯一入口。

```js
const raw = { count: 0 };

const state = new Proxy(raw, {
  get(obj, key, receiver) {
    console.log('读到了', String(key)); // 视图「读」= 登记依赖
    return Reflect.get(obj, key, receiver);
  },
  set(obj, key, value, receiver) {
    console.log('写了', String(key), '=', value); // 写 = 唤醒读者
    return Reflect.set(obj, key, value, receiver);
  },
});

state.count = 1; // 打印「写了 count = 1」
raw.count = 2; // 什么都不打印：绕过了代理
```

`raw.count = 2` 静默无效这一行就是本章全部故障的原型。**第一个问题永远是「手里是不是那个代理」，第二个是「视图读过这个属性没有」。**

接上引用语义：`const copy = state` 之后 `copy` 与 `state` 指向**同一个代理**，写 `copy.count` 照样被拦截——所以「把响应式对象赋给一个普通变量」本身**不是**断链。断链发生在把**属性**取出来、或用展开 / `JSON.parse(JSON.stringify())` 造出**新对象**时：那时你手里是原始值或原始对象，代理不在场。

## effect、track、trigger：三个角色

这里是**概念级**描述；数据结构、调度批次、去重方式我不做断言，以官方[响应式深入](https://cn.vuejs.org/guide/extras/reactivity-in-depth.html)为准。

| 角色 | 干什么 | 在应用里的对应物 |
| --- | --- | --- |
| effect（副作用） | 一段「读了响应式数据、因此可能得重跑」的代码 | 组件的 `render`、`computed` 的 getter、`watch` 回调 |
| track（收集） | effect 执行期间，把「当前 effect」记到「这个对象的这个键」名下 | 你什么都不用写，模板里读一次就算订阅 |
| trigger（触发） | 写属性时把记在该键名下的 effect 重新调度执行 | 一次赋值 → 组件重渲染 / 派生值重算 |

两条能直接用来 debug 的推论：**① 没读过就等于没订阅**——`if (flag) { 读 a }` 里 `flag` 为假时，`a` 的变化不会唤醒这段 effect。**② 读的动作本身就是订阅**，你永远不写「监听 count」，模板里出现 `count` 就已登记。另外**代理的粒度是「对象 + 键」**：`state.list` 与 `state.list[0]` 位于两个不同代理，这解释了 `shallowRef` 为什么只认 `.value`。

## ref 与 reactive：差别只在拦截点

`reactive()` 把对象本身变成代理，拦截点是**属性**；`ref()` 把值包进一个带 `.value` 的对象，拦截点是**容器对象的 `.value` 属性**（官方明确：`Proxy` 用于 reactive，getter/setter 用于 ref）。`ref` 存在的首要理由是 `reactive` 拦不了原始类型，而界面状态里绝大多数是字符串、数字、布尔值。`.value` 不是仪式，它**就是把一次读写搬到可被拦截的属性上**。

| 维度 | `ref` | `reactive` |
| --- | --- | --- |
| 能装原始类型吗 | 能 | 不能，只接受对象 / 数组 / Map / Set |
| 脚本里 / 模板里 | `count.value` / `count`（自动解包） | `state.count` / `state.count` |
| 整体替换 | `list.value = [...]` 合法且触发 | **`state = reactive({...})` 断链**：连接绑在最初那个代理上 |
| 解构 / 取属性到局部变量 | 拿到容器（仍可用 `.value` 跟随） | 断链（拿到的是那一刻的值） |
| 深层转换 | 装对象时内层值会经过响应式处理（`shallowRef` 例外） | 深层属性被访问时才逐层生成代理（惰性） |
| 身份 | `ref(x) !== x` | `reactive(raw) !== raw`，`toRaw` 才拿回原对象 |

**本站口径：默认用 `ref`（对象状态也用 `ref`）**——整体替换合法、`.value` 是个显眼的提醒；`reactive` 留给「一组确实需要连体读写的对象状态」，同一组件里不要混用。这是可维护性判断，不是官方规定；官方立场是 `ref()` 为组合式 API 里声明状态的推荐方式，`reactive` 的三条限制由文档明列。

## 自动解包规则：一张表结束所有猜测

解包（unwrap）指框架替你把 `ref` 换成内层值。它**只发生在有确定拦截点的地方**，比「模板里不用写 `.value`」精细得多：

| 位置 | 是否自动解包 | 踩坑现象 |
| --- | --- | --- |
| 模板中，顶层 `ref`（`<script setup>` 顶层变量或 `setup()` 返回对象的顶层属性） | **是** | 多写一层 `.value` 得到空文本，且无任何报错 |
| 模板中，普通对象里的 `ref`（`const o = { id: ref(1) }`） | **单独插值到最终值时按解包处理；参与运算不解包** | 官方例子：单独插值 `o.id` 显示 `1`，写成 `o.id + 1` 显示 `[object Object]1` |
| `reactive` 对象的属性 | **是**，读写直接作用到内层 ref | 忘记属性是 ref 时，`state.count = 1` 其实改的是 `count.value` |
| `reactive` 数组 / `Map` / `Set` 的元素 | **否**，必须 `.value` | 渲染出 `[object Object]` |
| `shallowReactive` 属性、普通对象与 class 实例的属性、脚本里的独立变量 | **否** | TS 会拦类型；JS 下得到 `[object Object]` 拼接或静默不更新 |

一句话：**解包只发生在框架管得到的位置——模板的顶层变量、`reactive` 的属性。**

## 响应式断链清单：定位方法比规则重要

| # | 断链写法（断在哪） | 30 秒确认与修法 |
| --- | --- | --- |
| 1 | `const { count } = state`：解构 reactive 拿到的是那一刻的值 | 打印 `typeof count`；改 `state.count` 后它不动。修：`toRef` / `toRefs` |
| 2 | `const n = state.count` 之后当状态用：赋值复制的是那一刻的值 | 同上 |
| 3 | `{ ...state }`、`JSON.parse(JSON.stringify(state))`：拷出来是全新普通对象 | `isReactive(copy)` 为 `false`。修：拷贝只用于提交快照 |
| 4 | 整体重新赋值 `state = reactive({...})`：连接绑在最初那个代理上 | 比较改前改后的 `state === oldProxy`。修：逐属性赋值，或改用 `ref` |
| 5 | 函数参数传解包后的值 `useX(state.count)`：形参接到快照，写回不同步 | 在函数里改形参，外面读来源。修：**参数只收 ref 或 getter** |
| 6 | `toRaw(state)` 之后写入：官方明确绕过代理的写入不触发 | 搜 `toRaw`，看返回值后面有没有赋值。修：只用于读 |
| 7 | `shallowRef` 改内层 `s.value.a = 1`：它只把 `.value` 做成响应式 | 官方例文：`state.value.count = 2` 不触发、整体替换触发。修：整体替换或 `triggerRef(s)` |
| 8 | 条件里漏 `.value`：`computed(() => count > 100)` 比较的是容器对象，且**没读内层值**所以永不重算 | TS 直接报类型错；JS 下 `console.log(count)` 打印出 ref 对象 |
| 9 | ref 塞进普通对象 `{ count: ref(0) }` 再在模板里做运算：普通对象不是拦截点 | 渲染出 `[object Object]`。修：用 `reactive` 包，或顶层就放 ref |
| 10 | 视图从没读过它（分支为假、computed 未渲染、组件未挂载）：读时登记，没读就没有订阅 | 临时插一句对该值的插值，立刻正确就是这条。**现象与断链相同，但不是断链** |

<Callout type="warn" title="第 4 条要区分赋的是变量还是属性">

`const plain = state`（把 reactive 对象赋给普通变量）**不断链**：复制的是代理的引用，`plain.count = 1` 照样触发。断链的是 `const { count } = state`（复制属性值）与 `state = reactive({...})`（换掉变量指向的新代理）。判断方法只有一个：**问自己手里的东西是不是当初框架给你的那个代理**（`isReactive()` 能替你确认）。

</Callout>

## toRef 与 toRefs：把断掉的链接接回去

`toRef(source, key)` 返回一个**指向 `source[key]` 的 ref**——不复制值，每次读都走代理的属性访问，因此跟随源对象变化；`toRefs(obj)` 对每个键做一遍。

```ts
import { reactive, toRef, toRefs } from 'vue';

const state = reactive({ name: 'Ada', age: 36 });
const { name } = toRefs(state); // 仍是 ref
name.value = 'Grace';
console.log(state.name); // 'Grace' —— 与源保持同步
const single = toRef(state, 'age'); // 只要一个键时比 toRefs 省
```

最常见的用途是 **props 传给 composable**：`props` 是响应式对象，但 `useFeature(props.title)` 传的是值，父组件一改就断；正确写法是 `useFeature(toRef(props, 'title'))` 或传 getter `useFeature(() => props.title)`（第 5、6 章固化这个约定）。两条限制：`toRef(props, 'k')` 得到的 ref **写回时仍然撞上 props 只读**；`toRef(值)` 这种把任意值包成 ref 的重载是较晚加入的形式，版本支持以 API 文档为准。

## readonly：把「谁可以写」变成运行时检查

`readonly()` 返回只读代理，写操作在开发模式被告警而不是生效（预期文案形如 `Set operation on key "count" failed: target is readonly`，具体字符串以版本为准）。它的用途不是安全，而是**把「这份状态只归 X 模块写」变成可执行的检查**：

```ts
import { reactive, readonly } from 'vue';

const internal = reactive({ theme: 'dark' });
export const themeState = readonly(internal); // 组件只能读
export function setTheme(t: string) {
  internal.theme = t; // 唯一写入者在这里
}
```

这正是第 9 章 Pinia 的原型：暴露只读 state + 唯一写入函数。相邻事实（已核实）：`shallowReadonly()` 只把**顶层**属性设为只读且**不解包 ref**；官方警告不要把 shallow readonly 对象嵌进深层 reactive 对象。

## 提前退出深追踪：shallowRef、triggerRef、markRaw、toRaw

**性能用途与正确时机在第 10 章**，本章只给「它们是什么」和「什么现象说明有人误用了**过早优化**」——**过早用 `shallowRef` 是把性能问题换成静默不更新**。

| API | 效果 | 典型误用现象 |
| --- | --- | --- |
| `shallowRef(v)` | 只有 `.value` 的读写是响应式的，内层原样存放 | 改 `s.value.a` 界面不动 |
| `triggerRef(s)` | 手动唤醒依赖 `s` 的 effect（配合就地深层修改） | 满屏 `triggerRef` = 你在跟框架较劲，该改数据结构 |
| `shallowReactive(o)` | 只有顶层属性响应式；**属性里的 ref 也不解包** | 读 `state.someRef` 拿到容器对象 |
| `markRaw(o)` | 永久标记该对象**不会**被转成代理（嵌在 reactive 里也生效） | 官方警告会带来**身份不一致**（`foo.nested !== bar.nested`） |
| `toRaw(proxy)` | 取回原始对象 | 「读」没问题，「写」等于断链第 6 条；别长期持有返回的引用 |

## 观察响应式变化的入口

「值变了要做一件事」用 `watchEffect`（立刻执行一次并自动收集读到的依赖）或 `watch`（指定来源、拿到新旧值、可选 `immediate` / `deep` / 清理）。两者的**选择标准、依赖收集时机、竞态与清理**是[计算属性与侦听器](/vue/computed-and-watch)的主题。本章只需记住：它们本身就是 effect，同样遵守「读时登记」，因此**同样会被断链影响**。

## 改了数据界面没变：五步定位流程

按顺序走，不要跳。前两步区分「状态没变」和「视图不知道」，这一步分错后面全白费。

1. **确认状态真的变了。** 赋值后打印 `console.log(count.value)`，或用 Vue DevTools 选中组件看 State。没变 → 你写的对象不是你以为的那个（第 2 步），或赋值根本没执行（回调没触发、提前 `return`）；变了 → 跳第 3 步。
2. **确认手里的是代理。** 打印 `isReactive(x)` / `isRef(x)`，回溯变量来源：解构过？展开复制过？`toRaw` 拿出过？是 `props` 里的？形参接的快照？对照清单 1-7 排除。
3. **确认视图读过它。** 在模板里临时插一句对该值的插值：界面立刻正确，说明原处从未读它（分支为假、`computed` 没被渲染、短路在前）。
4. **确认更新没被复用或缓存挡住。** 三个挡路石：`v-for` 用 `index` 当 `key` 造成就地复用（第 3 章）；`v-once` / `v-memo` 让这块被当静态；`computed` 返回**同一个对象引用**（内容变了引用没变）。一次只关一个来试。
5. **确认你看的是不是下一个 tick。** DOM 不在赋值那一刻更新：`count.value++` 之后立刻读某个 DOM 节点的文本，读到旧值是**正常**的，包进 `await nextTick()` 再读才变（第 3 章末尾有验证路径）。

**描述问题的最小格式：**「我改了 X（变了 / 没变），X 是 ref / reactive 属性 / 普通变量，模板里读它的表达式是……，列表 key 是……」。按这个格式说，答案通常自己就出来了。

## 手写一个迷你 reactive：四十行祛魅

这段代码在本机跑过（见下方标注）。它不是 Vue 的实现，但**所有断链情形都能在这四十行里指出断在哪一行。**

```js
let activeEffect = null;
const targetMap = new Map(); // 原始对象 -> 键 -> 依赖它的 effect 集合

function track(target, key) {
  if (!activeEffect) return; // 不在任何 effect 里读 = 不登记
  let depsMap = targetMap.get(target);
  if (!depsMap) targetMap.set(target, (depsMap = new Map()));
  let dep = depsMap.get(key);
  if (!dep) depsMap.set(key, (dep = new Set()));
  dep.add(activeEffect);
}

function trigger(target, key) {
  const dep = targetMap.get(target)?.get(key);
  if (dep) for (const fn of [...dep]) fn();
}

function reactive(target) {
  return new Proxy(target, {
    get(obj, key, receiver) {
      const res = Reflect.get(obj, key, receiver);
      track(obj, key); // 读 = 订阅
      return res;
    },
    set(obj, key, value, receiver) {
      const had = Object.prototype.hasOwnProperty.call(obj, key);
      const old = obj[key];
      const ok = Reflect.set(obj, key, value, receiver);
      if (!had || old !== value) trigger(obj, key); // 写 = 唤醒；同值不唤醒
      return ok;
    },
  });
}

function effect(fn) {
  const run = () => {
    activeEffect = run; // 这段时间里的读取都归我
    try { fn(); } finally { activeEffect = null; }
  };
  run();
  return run;
}
```

测试脚本（接在上面之后）：

```js
const state = reactive({ count: 0, label: '待办' });
let renders = 0;
effect(() => {
  renders++;
  console.log(`  render ${renders}: count=${state.count} label=${state.label}`);
});

console.log('A 初次执行');
state.count++;
console.log('B 自增后 renders =', renders);
state.count = 5;
console.log('C 赋值 5 后 renders =', renders);
state.count = 5;
console.log('D 重复赋同一个值后 renders =', renders);

state.who = 'me';
console.log('E 新增属性后 renders =', renders, '读取 =', state.who);

const { count } = state;
console.log('G 解构得到的类型 =', typeof count, '值 =', count);
state.count = 99;
console.log('H 解构变量 =', count, '/ state.count =', state.count, '/ renders =', renders);

const nested = reactive({ inner: { n: 1 } });
let innerRenders = 0;
effect(() => { innerRenders++; nested.inner.n; });
nested.inner.n = 2;
console.log('I 嵌套对象本实现是否触发 =', innerRenders === 2);
```

<Callout type="verified" title="本节代码在 Node 实跑过">

环境：Windows 10 x64 + Node v25.4.0，日期 2026-10-17，文件 `.scratch/mini-reactive-published.mjs`（内容就是上面两段），命令 `node mini-reactive-published.mjs`。真实终端输出，逐字未改：

```text
  render 1: count=0 label=待办
A 初次执行
  render 2: count=1 label=待办
B 自增后 renders = 2
  render 3: count=5 label=待办
C 赋值 5 后 renders = 3
D 重复赋同一个值后 renders = 3
E 新增属性后 renders = 3 读取 = me
G 解构得到的类型 = number 值 = 5
  render 4: count=99 label=待办
H 解构变量 = 5 / state.count = 99 / renders = 4
I 嵌套对象本实现是否触发 = false
```

</Callout>

四行输出正好是本章的目录：

| 输出 | 结论 | Vue 的真实情况 |
| --- | --- | --- |
| `D ... renders = 3` | 同值写入不唤醒读者 | 官方把这类行为描述为相同值赋值不触发更新，判定细节以文档为准 |
| `E ... renders = 3` | **本实现漏了新增属性**：那次 effect 从没读过 `who` | 真实 Vue 额外追踪「键的存在性 / 遍历」，所以 `push`、新增属性能触发 |
| `H 解构变量 = 5` | **断链第 1 条的物证**：解构拿到的是 `number`；`renders` 变 4 是 effect 重跑，不是那个变量跟随 | 修法 `toRef` / `toRefs` |
| `I ... = false` | 本实现不做深层转换，`nested.inner` 是普通对象 | 真实 `reactive` 惰性生成内层代理；`shallowRef` 恰好等于本实现——这就是断链第 7 条 |

**本实现刻意没做两件事：** 依赖清理（分支变化后旧依赖仍留在 Set 里被无谓唤醒）和更新排队（trigger 同步重跑）。真实 Vue 会移除旧依赖、把更新排进调度器。

## 常见错误与排查

**1. 解构 reactive 后改了源，界面无动。** `console.log(state.count)` 变了、`count` 不动。确认：`isRef(count)` 为 `false`。修法：`toRefs()` 解构，或用 `ref` 分别声明。

**2. shallowRef 改内层属性界面不动。** 内存里数据对了，视图停在旧值。确认：看赋值是 `.value.x =` 还是 `.value =`。修法：整体替换 `s.value = { ...s.value, x: 1 }`；确实要就地改深层时用 `triggerRef(s)`。

**3. 比较时忘了 `.value`，条件永远成立。** `computed` 结果恒定。原因：拿容器对象比较，而且没读内层值，所以它永不重算。确认：TS 项目直接报类型错；JS 项目 `console.log(count)` 打印出带 ref 标记的对象。

**4. 深层拷贝把状态变成普通对象。** 确认：`isReactive(backup)`。修法：拷贝只用于快照与提交。

**5. composable 参数传了值，内部改了外面不跟随。** 确认：在函数里打印收到的是 `Ref` 还是原始值。修法：**约定参数只收 `Ref` 或 getter**，并用 `readonly()` 表明不写（第 6 章写成接口规范）。

**6. 数组里的 ref 没写 `.value`，列表项显示 `[object Object]`。** 原因：`reactive` 数组 / 原生集合的元素**不解包**（规则表第 4 行）。修法：模板里写 `item.value`，或别把 ref 塞进数组。

**7. 整体替换 reactive 后一切失效。** 第一次正常，之后每次替换都无反应。确认：替换前后 `isReactive(x)` 都为真但 `x === oldProxy` 为假。修法：改用 `ref` 的对象值形式（`s.value = newObj`），或逐属性赋值。

## 练习

<Exercise title="练习 1 · 用本实现的规则预测 renders" difficulty="基础">

上面那个迷你实现（不含 `deleteProperty`），初始 effect 读过 `count` 与 `label` 两个键。依次执行：

```js
state.label = '待办'; // 与初始值相同
state.label = '进行中';
state.who = 'me';
state.who = 'you';
state.count = state.count + 1;
```

写出每步后 `renders` 的值并说明理由。

<template #answer>

第 1 步不变（`hasOwnProperty` 为真且 `old === value`，同值不触发）；第 2 步 +1（`label` 名下有依赖）；第 3、4 步都不变——**新增的 `who` 从没被读过，没有依赖可唤醒**，这正是实测里 `E` 行的现象；第 5 步 +1（`count` 被读过且值确实变了）。

结论：本实现对「键的存在性」追踪不足，真实 Vue 会额外拦截 `has` / `ownKeys` 并用内部哨兵键覆盖「遍历整个对象/数组」的依赖，所以 `push` 与新属性能触发——这类实现细节请查官方[响应式深入](https://cn.vuejs.org/guide/extras/reactivity-in-depth.html)，别背我的说法。应用层只需记住：**视图要么读过那个具体属性，要么确实遍历过那个容器。**

</template>

</Exercise>

<Exercise title="练习 2 · 找出断链点" difficulty="进阶">

下面这段有**两处**响应式断链，找出来并给修法（不改数据结构，只改写法）。

```ts
import { reactive, computed } from 'vue';

const state = reactive({ keyword: '', list: [] as string[] });
const { keyword } = state;

const showList = computed(() =>
  keyword === '' ? state.list : state.list.filter((x) => x.includes(keyword))
);

function search(kw: string) {
  state.keyword = kw;
}
```

<template #answer>

**断链 1：** `const { keyword } = state` 拿到的是初始字符串，此后 `state.keyword` 与它无关，搜索永远不生效（清单第 1 条）。修法：`const keyword = toRef(state, 'keyword')`，`computed` 里改用 `keyword.value`。

**断链 2（连带后果）：** 因为 `computed` 里读的是死值 `keyword`，**effect 只登记了 `state.list`，没登记 `state.keyword`**——「没读等于没订阅」。修好第 1 条后两个问题一起消失。

补充一个常被误判的点：`state.list = [...]`（整体替换数组属性）**是**合法的，因为改的是代理上的 `list` 键；断链的是 `state = reactive({...})`。区分这两个是本章的核心检测点。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释" difficulty="进阶">

在真实组件里把 `computed` 写成少一个 `.value`：

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';

const count = ref(0);
const isBig = computed(() => count > 100);
</script>

<template>
  <p>{{ isBig }}</p>
  <button @click="count++">加一</button>
</template>
```

预测界面现象，解释「为什么它连一次都不重算」，再说明删掉 `lang="ts"` 之后行为怎么变。

<template #answer>

`count > 100` 比较的是 **ref 容器对象**与数字：对象先转成原始值再比较，结果恒为 `false`，界面永远显示 `false`。更关键的是第二层：**回调里没有读 `.value`，所以这个 computed 没有登记任何依赖**——「读时登记」在这里表现为「它根本不会被唤醒」。于是点按钮时 `count` 变了，`isBig` 却连重算一次都不会。现象是「永远 false 且毫无反应」，而不是「偶尔不准」。

在 `lang="ts"` 下 `vue-tsc` / IDE 会直接报错，大意是 `Ref<number>` 不能与 `number` 比较——**这正是本站把 TypeScript 列为硬前置的原因之一：它能在你按下运行前拦住这一整类断链**（见 [TypeScript 第 2 章 基础类型](/typescript/basic-types)）。删掉 `lang="ts"`，报错消失，只剩一个静默的界面 bug，要走「五步定位流程」第 2 步才能找到。

</template>

</Exercise>

<Exercise title="练习 4 · 给 composable 定接口" difficulty="挑战">

要写一个 `usePagination`，它需要知道「当前关键词」与「每页条数」，并在它们变化时把页码归零。这两个值存在父组件的 `reactive` 表单里。给出三种参数写法（传值 / 传 reactive 子对象 / 传 ref），判断哪种会断，并写出你选的那种。

<template #answer>

- **传值** `usePagination(form.keyword, form.size)`：断。函数收到字符串与数字，之后表单变化与它无关，`watch` 也监听不到（监听一个普通变量等于监听一个不会变的值）。
- **传 reactive 子对象**：能跟随，但把整个表单的可写权限交给了 composable，接口意图不清；一旦内部解构了它，立刻退回第一种断法。
- **传 ref / getter**（推荐）：`usePagination(toRef(form, 'keyword'), toRef(form, 'size'))`，或更保守的 `usePagination(() => form.keyword, () => form.size)`。实现就是 `const page = ref(1); watch([keyword, size], () => { page.value = 1; }); return { page }`，形参类型写成 `Ref<string>` / `Ref<number>`。

要点：**参数收 ref，返回也交 ref**（第 6 章的 composable 接口约定）。传 `readonly(toRef(form, 'keyword'))` 还能额外表达「我不写你的状态」——`readonly` 的用法在这里落地。

</template>

</Exercise>

## 官方文档与延伸阅读

标注每条用来核实本章哪个结论（核实时间 2026-10-17）。

- [响应式深入](https://cn.vuejs.org/guide/extras/reactivity-in-depth.html) —— 机制描述的出处：「JS 无法追踪局部变量、只能拦截对象属性」「`Proxy` 用于 reactive、getter/setter 用于 ref」「解构或赋值给局部变量后不再触发 get/set 陷阱」「reactive 返回的代理与原对象 `===` 不相等」「shallowRef 只在 `.value` 上响应式」。
- [响应式基础](https://cn.vuejs.org/guide/essentials/reactivity-fundamentals.html) —— `ref` vs `reactive` 三条限制与**自动解包规则**每一行（模板顶层解包、`reactive` 属性解包、数组与 `Map` **不**解包，官方用 `o.id` 与 `o.id + 1` 举例）。
- [响应式进阶 API](https://cn.vuejs.org/api/reactivity-advanced.html) —— `shallowRef`（官方例文 `state.value.count = 2` 不触发）、`triggerRef`、`shallowReadonly`（只锁顶层、不解包 ref）、`toRaw`、`markRaw`（身份不一致警告）。
- [响应式核心 API](https://cn.vuejs.org/api/reactivity-core.html) 与 [工具函数](https://cn.vuejs.org/api/reactivity-utilities.html) —— `toRef` / `toRefs` / `readonly` 的签名与重载，以及「30 秒确认」用到的 `isRef` / `isReactive` / `isProxy`。
- [计算属性](https://cn.vuejs.org/guide/essentials/computed.html) 与 [侦听器](https://cn.vuejs.org/guide/essentials/watchers.html) —— 本章只给入口，`watch` / `watchEffect` 的时机与清理在第 4 章。

## 下一章

这一章解释了「状态为什么会自动通知视图」，视图那一侧还一个字没写：模板里能放什么、指令各管什么、`key` 为什么能让列表不串。下一章 [模板语法与指令](/vue/template-syntax) 处理链路的另一半——插值的表达式边界、`v-bind` 与 `v-on` 的修饰符对应 DOM 上的哪个调用、`v-if` 与 `v-show` 的真实区别、`v-for` 的 `key` 与它引发的表单串值故障。
