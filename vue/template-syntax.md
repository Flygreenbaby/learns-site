# 模板语法与指令：模板里只写表达式，其余交给状态

模板这一层制造两类迷惑性故障。第一类编译期就炸：在插值的双花括号里写 `if` 或一行赋值，得到 `[vite:vue] Error parsing JavaScript expression`；把 `v-if` 和 `v-for` 写在同一元素上，得到 `property "todo" is not defined on instance`。第二类静默得多：列表顺序一变，**用户在第一个输入框里打的字跑到第三行去了**，而你的数据一直是对的。

根子是同一件事：**模板不是 HTML 也不是 JS，它是一段被编译器接受的「表达式宿主」。** 理解它的边界——能写什么、编译成什么、每条指令对应 DOM 上的哪一次调用——你就能把任何静态设计稿改写成数据驱动模板。前置：[HTML 表单](/html/forms)、[DOM 操作与事件系统](/javascript/dom-and-events)、[响应式原理](/vue/reactivity)。

## 插值与「表达式，不是语句」

文本插值（interpolation）把表达式的求值结果作为纯文本插入，**默认转义**，这正是它安全的原因：

```vue
<template>
  <p>{{ name }}</p>
  <p>{{ name.toUpperCase() }}</p>
  <p>{{ items.length + 1 }}</p>
  <p>{{ ok ? '完成' : '进行中' }}</p>
  <p>{{ `共 ${items.length} 条` }}</p>
</template>
```

（`name`、`items`、`ok` 是 `<script setup>` 里的三个 `ref`。）边界是「能不能变成一个值」：三元、逻辑与算术运算、函数调用、模板字符串、可选链都可以；**声明语句、控制流语句、多语句序列不行**（下表每一行都是插值双花括号里的内容）：

| 写法 | 结果 | 为什么 |
| --- | --- | --- |
| `const n = items.length` | 编译错误 | 声明语句，不产出值 |
| `if (ok) '是'` | 编译错误 | 控制流语句；改写成三元 `ok ? '是' : ''` |
| `total += 1` | 编译错误或静默副作用（**别试**） | 赋值放进事件处理或 `computed`；渲染结构用 `v-for`，别把 `map` 结果插进文本 |

要输出可信的原始 HTML 用 `v-html`（见安全一节）。

<Callout type="unverified" title="本章逐字核实与未核实的分界">

**已逐字核实**（2026-10-17，逐条对应见文末）：`v-if` 与 `v-for` 的优先级、无 `key` 时的 in-place patch 策略、`key` 必须是原始值、`v-if` / `v-show` 的代价差异、`v-for` 支持可迭代对象、表单绑定与修饰符语义、`v-cloak` 只在无构建场景需要。**未逐字核实**：「插值只允许表达式」这句官方措辞；上表「编译错误 / 静默副作用」的分类是我按编译模型给的判断，报错文案以你的工具链为准。

</Callout>

## v-bind：把属性变成状态的函数

`v-bind` 让属性值来自 JS 表达式，简写 `:`。**静态与动态的区别是第一条要刻进脑子的**：`value="1"` 时属性是字符串 `"1"`，与任何状态无关；`value="count"` 时你得到长度为 5 的字符串 `"count"`——模板层最高频的低级错误，而且**它不报错**。

动态参数名（方括号里放表达式）与对象展开：`<input :[attr]="value" v-bind="extra">`，其中 `v-bind="extra"` 把对象整个摊开成属性，常用于一次透传父组件传来的 attributes（`$attrs`，第 5 章）。class / style 支持对象与数组语法（`:class="{ active: isActive }"`，规则见 [Class 与 Style 绑定](https://cn.vuejs.org/guide/essentials/class-and-style.html)）；布尔属性写 `:disabled="isBusy"`，传 `false` / `null` / `undefined` 时属性被移除，别写字符串 `'false'`。

## v-on 与事件修饰符：每个修饰符对应一次 DOM 调用

`v-on` 简写 `@`，可以写方法引用（`@click="submit"`）、内联语句（`@click="count++"`）或显式取事件对象（`@click="submit($event)"`）。修饰符（modifier）是编译器在生成的监听器外面再套一层判断或调用，这张表把它和你在 [DOM 操作与事件系统](/javascript/dom-and-events) 里手写的东西对上：

| 修饰符 | 对应的手写动作 | 什么时候真需要 |
| --- | --- | --- |
| `.stop` | `event.stopPropagation()` | 嵌套按钮：列表项里的删除按钮不要触发整行点击 |
| `.prevent` | `event.preventDefault()` | `@submit.prevent`、拦截 `a` 交给前端路由 |
| `.capture` | 注册时 `addEventListener(..., { capture: true })` | 官方原文：以捕获模式添加监听器 |
| `.self` | 判断 `event.target === 当前元素` | 官方原文：只当事件来源于元素自身时触发。遮罩关闭 |
| `.once` | 只触发一次后自动解绑 | 一次性引导、只上报一次的埋点 |
| `.passive` | 注册时 `{ passive: true }` | `touchstart` / `wheel` / `scroll` 提升滚动响应。**副作用：passive 监听器里 `preventDefault()` 无效** |
| `.keyup.enter`、`.ctrl.exact`、`.left` | 判断 `event.key`、修饰键组合、`event.button` | 按键别名另有 `.tab`、`.delete`、`.space` 等；`.exact` 表示「只有这几个修饰键」，否则 `ctrl+shift+click` 也满足 `.ctrl` |

**Vue 替你委托了事件。** 你在 `v-for` 里给每项写 `@click`，不会生成一千个 `addEventListener`——与纯 JS 项目里手写的「列表一个事件委托」等价（见 [阶段项目](/javascript/project)）。直接推论：**在组件里随便调 `stopPropagation()` 是高危操作**，事件传不到框架挂监听的位置，就会出现「数据变了视图不动」的怪现象。要阻止传播请用 `.stop`。

上面的 `@click` 是**原生 DOM 事件**；子组件向父组件发消息是另一套：`defineEmits` 声明事件名、`emit('save', payload)` 触发、父组件 `@save="..."` 接收。它不经过 DOM，因此与 `.stop` / `.self` 语义不同。完整讲解在[第 5 章 组件基础](/vue/components)。

## v-if 与 v-show：DOM 里到底有没有这个节点

两条不同路径，官方[条件渲染](https://cn.vuejs.org/guide/essentials/conditional.html)给了明确对比（2026-10-17 核实）：

| 维度 | `v-if` | `v-show` |
| --- | --- | --- |
| 条件为假时 DOM 里有节点吗 | **没有**，元素被物理移除；条件块里的事件监听器与子组件在切换时被**销毁与重建**（官方原文保证这点） | **有**，只切换 `display`；监听器与子组件一直存在 |
| 代价 | 初始为假时不渲染（惰性），但每次切换要创建 / 销毁，代价高 | 无论初值都渲染，切换只改样式，代价低 |
| 官方选择建议 | 条件在运行时不太会变 | 需要非常频繁地切换 |

`v-if` / `v-else-if` / `v-else` 成链，`<template v-else>` 可把多个元素归进一个分支（`v-show` **不支持 `template` 元素**，官方明确）。`v-else` 必须紧跟 `v-if` 分支，中间只能夹注释与空白，否则编译器认不出这层关系，你会得到「`v-else` used on element without corresponding `v-if`」一类警告。

**一个容易忽略的后果：** `v-if` 销毁组件实例，实例里的局部状态一起没了（第 1 章心智模型第 3 条）。用 `v-if` 折叠一个表单，展开时用户填的就没了；想「不丢状态」就用 `v-show`。

## v-if 与 v-for 不能写在同一个元素上

官方[列表渲染](https://cn.vuejs.org/guide/essentials/list.html)对这条写得非常具体（2026-10-17 核实）：

> 当它们存在于同一个节点上时，`v-if` 的优先级高于 `v-for`，这意味着 `v-if` 的条件将**无法访问 `v-for` 作用域中的变量**。

文档给的错误示例本身就注明会抛错（大意：`property "todo" is not defined on instance`）：

```vue
<!-- 错误：v-if 先求值，此时 todo 还不存在 -->
<li v-for="todo in todos" v-if="!todo.isComplete">{{ todo.title }}</li>
```

**这与 Vue 2 相反**（Vue 2 里 `v-for` 优先），照抄旧教程必炸。官方给的修法是「把 `v-for` 移到外层 `template`，也更显式」：

```vue
<template v-for="todo in todos" :key="todo.id">
  <li v-if="!todo.isComplete">{{ todo.title }}</li>
</template>
```

第三种、也是**「按条件过滤列表」的正解**：用 `computed` 提前筛好数组，模板里只遍历结果。

## v-for 的四种遍历

| 遍历目标 | 写法 | 要点 |
| --- | --- | --- |
| 数组 | `v-for="(item, i) in items"` | 第二项是索引；只用索引写成 `(item)` 或 `(_, i)` |
| 对象 | `v-for="(value, key, index) in obj"` | 官方明确顺序以 `Object.values(obj)` 为准，不要依赖键的插入顺序 |
| 整数范围 | `v-for="n in 10"` | **从 1 开始**到 n，不是 0..9 |
| 可迭代对象 | `v-for="item of set"` | 官方 API 原文：支持实现迭代器协议的值，含原生 `Map` 与 `Set`；`of` 可替代 `in` |

遍历 `Map` 时解构要写成 `v-for="([k, v]) in map"`，外层括号必须有，否则 `k, v` 被当两个参数。

## key：它标识身份，不表示顺序

官方原文（[列表渲染](https://cn.vuejs.org/guide/essentials/list.html)，2026-10-17 核实）说明了不写 `key` 时算法在干什么：

> Vue 更新 `v-for` 渲染的列表时，默认使用「**in-place patch**（就地打补丁）」策略。如果数据项顺序变了，它不会移动 DOM 元素去匹配新的顺序，而是**就地更新每个位置上的元素**，让它反映该索引处应该渲染的内容。

紧接着是关键那句：

> 这种默认模式效率更高，但**仅当列表的渲染输出不依赖子组件状态或临时 DOM 状态（例如表单输入的值）时才适用**。

**串值故障就是这么来的。** 复现（练习 1 让你亲手做一次）：

```vue
<script setup lang="ts">
import { ref } from 'vue';

const rows = ref([
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Grace' },
]);
</script>

<template>
  <button @click="rows.reverse()">倒序</button>
  <ul>
    <li v-for="(row, i) in rows" :key="i">
      {{ row.name }} <input :placeholder="row.name">
    </li>
  </ul>
</template>
```

在第二个输入框里打字，然后点「倒序」：**文字留在第二个框里，但它现在挨着的是另一行名字。** 因为 `key` 是索引，Vue 认定「位置 1 还是那个位置」，于是复用了 DOM 节点与输入框里未被绑定管辖的临时状态（`input.value` 是浏览器状态，不在你的数据里）。换成 `:key="row.id"`，节点随身份移动。

规则只有四条：**`key` 必须是原始值**（官方原文：期望字符串或数字，**不要用对象当 key**）；**同一列表内唯一**（重复会触发「Duplicate keys detected」警告与不确定复用）；与 `template` 组合使用时**把 `key` 放在 `<template>` 上**（官方要求）；官方允许不写 `key` 的例外只有「遍历出的 DOM 很简单、不含组件与有状态的 DOM 元素」。**index 危险的原因**：只要列表会重排、头部插入或删除，索引就不等于身份。

**反过来用 `key` 强制重建实例**也很实用：`<TodoEditor :key="editingId ?? 'new'" :id="editingId" />`。`key` 变了就是**新实例**——局部 `ref` 归零，`onUnmounted` 与 `onMounted` 各走一遍。用它「重置表单」很干净；用它当「刷新」的万能按钮则是把重建代价藏进交互里（第 7 章、第 10 章）。

## v-model：表单绑定的真实语义

`v-model` 是 `:value` + `@input`（或对应事件）的编译糖。官方[表单输入绑定](https://cn.vuejs.org/guide/essentials/forms.html)给的等价展开是：绑定 `value` 属性，并在 `input` 事件里把 `event.target.value` 写回状态。

```vue
<script setup lang="ts">
import { ref } from 'vue';

const name = ref('');
const agree = ref(false);
const plan = ref('basic');
const tags = ref<string[]>([]);
const picked = ref<number | string>('');
const count = ref<number | string>('');
</script>

<template>
  <label for="name">姓名</label>
  <input id="name" v-model.trim="name">

  <label><input type="checkbox" v-model="agree"> 我同意条款</label>
  <label><input type="radio" value="basic" v-model="plan"> 基础</label>
  <label><input type="checkbox" value="urgent" v-model="tags"> 紧急</label>

  <select v-model="picked">
    <option disabled value="">请选择</option>
    <option :value="1">一年</option>
  </select>

  <input v-model.number="count" type="text" placeholder="数字">
</template>
```

按控件分类的语义（均核实自官方表单章节）：

| 控件 | 绑到什么 | 注意 |
| --- | --- | --- |
| `input[type=text]` / `textarea` | `value` 属性 + `input` 事件 | **`textarea` 里的插值不生效**，官方明确只能用 `v-model` |
| 单个 checkbox | 布尔值 | 绑非布尔值用 Vue 特有属性 `true-value` / `false-value`（只与 `v-model` 配合，不影响 HTML 层 `value`） |
| 一组 checkbox 共用一个 `v-model` | 数组或 `Set`：始终装当前勾选项的 `value` | 初值必须是数组，否则勾选时报错 |
| radio | 选中项的 `value` | 同组 radio 共用一个状态 |
| `select` / `select[multiple]` | 单个值 / 所有选中项的数组 | 想「未选择」就加 `<option disabled value="">`；非字符串值用 `:value` 绑（官方例子 `:value="{ number: 123 }"`） |
| 初始 `value` / `checked` / `selected` 属性 | **被忽略** | 官方原文：`v-model` 始终把当前绑定的 JS 状态当作唯一真相 |

三个修饰符：`.lazy` 改为在 `change` 后同步；`.number` 用 `parseFloat` 转数字，**转不动就保留原字符串**，`type="number"` 时自动应用；`.trim` 去首尾空白。**中文用户必须知道的一条（官方明说）：IME 组合输入期间 `v-model` 不更新**——拼音还没上屏时状态是旧的。

无障碍衔接：`label` 的 `for` 与控件 `id` 必须相等（[HTML 表单](/html/forms)：点标签等于点控件、读屏会朗读 label、自动填充靠它认字段）；动态列表里 `id` 不能写死，用 `:id` 与 `:for` 绑同一个值，或把 `input` 直接嵌进 `label`。

## v-html 与 XSS

`v-html` 把字符串当 HTML 塞进去，绕过插值的默认转义，原理与 `innerHTML` 完全相同。任何来自用户输入、评论、URL 参数、后端富文本字段的值走这条路，等于把 XSS 入口打开。顺序：**先用插值 / `v-text`；要富文本就先净化（成熟的白名单净化器），或由后端净化后返回。** 官方[安全](https://cn.vuejs.org/guide/best-practices/security.html)一节把「永远不要用它渲染不可信内容」列为直接结论。`v-if="isTrusted"` 挡不住攻击，因为判断权在攻击者手上。

## v-once / v-pre / v-cloak

`v-once`：元素及子内容（含里面的 `v-for`）只渲染一次，之后被当静态内容跳过更新——用在真正不变的块省掉无谓 diff；**别用它「冻结一个本该跟随状态的数据」**。`v-pre`：跳过当前元素及所有子节点的编译，原样保留，用来展示双花括号模板语法本身。`v-cloak`：属性保留到组件挂载完成，配合 `[v-cloak] { display: none }` 隐藏未编译模板——**官方明确只在无构建步骤的场景需要**（CDN 引入、模板写在 DOM 里），用 Vite + SFC 时没有意义。

## template 元素的三种身份

裸的 `<template>` 不渲染任何节点（HTML 的内容模板机制，Vue 借用它做「不可见的分组包装」）。三个用途：**① 给 `v-if` / `v-else` 分组**，避免为套容器多出一个影响布局的 `div`；**② 给 `v-for` 分组**，此时 `key` 要放在 `template` 上；**③ 作为插槽宿主**（`<template #default>`，第 5 章）。反过来，「渲染结果里不含 `template` 标签」意味着：把 CSS 选择器或 `data-*` 锚点写在 `template` 层，它们不会出现在 DOM 上。

## 模板表达式保持简单，复杂度挪进 computed

长表达式的三个代价：**读不动、报错只给一行编译上下文、编译器无法复用中间结果**。判断标准可以机械执行：表达式超过一个 `? :` 或含两次以上函数调用、同一表达式出现在两处、需要「遍历再过滤再取长度」——这三种都该是一个具名 `computed`（有缓存，第 4 章讲纯度要求）；需要语句、循环、`try` 时模板根本写不出来。

## nextTick：改完数据立刻读 DOM 读到的是旧值

第 2 章排查流程第 5 步说的就是这个。赋值后 DOM **不是**同步更新的（更新被排队、批处理），紧接着读节点会拿到旧画面：

```vue
<script setup lang="ts">
import { nextTick, ref, useTemplateRef } from 'vue';

const message = ref('旧的');
const text = useTemplateRef('text');

async function show() {
  message.value = '你好';
  console.log(text.value?.textContent); // 预期：旧值
  await nextTick();
  console.log(text.value?.textContent); // 预期：新值
}
</script>

<template>
  <p ref="text">{{ message }}</p>
  <button @click="show">改一次并读两次</button>
</template>
```

**预期结果**（本章代码需要构建工具与浏览器，我没有运行）：第一行打印更新前的文本，`await nextTick()` 之后打印新文本。验证路径：用脚手架建一个临时项目，把这段放进 `App.vue`，`npm run dev` 后打开控制台点按钮对比两行输出。

`nextTick` 的用途只有两类：**「DOM 更新后再做的事」**（聚焦、测量 `getBoundingClientRect`、滚动到某项、初始化第三方图表）与**「给 `v-if` 刚出现的元素拿引用」**。它不是「强制刷新」开关，也不是修断链的药。

## 常见错误与排查

**1. `value="count"` 少了冒号。** 输入框显示字符串 `count`，或状态变了界面不动。确认：控制台里看 DOM 上 `value` 的字面值。修法：`:value="count"`，用 `v-model` 更好。

**2. `v-if` 与 `v-for` 同元素报错。** 现象：`property "todo" is not defined on instance`。原因：Vue 3 里 `v-if` 优先级高于 `v-for`（已核实）。修法：`v-for` 移到外层 `template`；过滤场景改用 `computed`。

**3. 列表重排后输入框内容串到别的行。** 数据对、界面错位。原因：`key` 用了索引触发就地复用，而输入框的 `value` 是浏览器临时状态。确认：把 `:key="i"` 换成 `:key="item.id"`，故障立刻消失——**这就是定位方法**。修法：稳定唯一 ID，新增时用 `crypto.randomUUID()`。

**4. `v-show` 加在 `template` 上不生效。** 原因：官方明确 `v-show` 不支持 `template` 元素。修法：改用 `v-if` 分组，或把 `v-show` 挪到具体元素上。

**5. 数字输入框拿到字符串。** 绑的值是 `'42'`，`===` 比较失败。原因：DOM 里的值都是字符串，`.number` 只在 `parseFloat` 成功时转数字。修法：显式 `.number` 并在使用处收窄类型。

**6. 拼音输入过程中「字数统计」不动，上屏后一次跳完。** 原因：`v-model` 在 IME 组合期间不更新（官方明确）。修法：需要实时就用 `@input` + `:value` 自己写，或接受「上屏才更新」。

**7. 用了 `.passive` 之后阻止不了默认滚动。** 现象：控制台警告「Unable to preventDefault inside passive event listener」。原因：`.passive` 就是承诺不调 `preventDefault`（已核实）。修法：去掉 `.passive`。同类问题：`@click="handle"` 改成 `@click="handle()"` 后事件对象丢失——前者自动把事件作为唯一实参传入，后者要显式 `handle($event)`。

## 练习

<Exercise title="练习 1 · 亲手复现一次串值故障" difficulty="基础">

把本文 key 一节那段代码（`:key="i"` 版本）在本地项目里跑一遍：在第二个输入框打字、点「倒序」。写出你看到的现象，解释为什么数据里从来没有这些文字；再说明换成 `:key="row.id"` 后为什么就好了。

<template #answer>

预期现象：文字留在**第二个**框里，但那一行挨着的名字变了。两件事叠在一起：一是 Vue 在 `key` 等于索引时采用就地打补丁策略（官方原文已核实）；二是**输入框当前的 `value` 是浏览器持有的临时状态**，只有被 `v-model` 绑定时才和 JS 状态同步。例子里输入框只绑了 `placeholder`，用户敲的内容压根不在 `rows` 里，所以「数据从头到尾没错」，错的是 DOM 节点与数据项的对应关系。换成 `:key="row.id"` 后每个节点有了身份标签，重排时 Vue 移动节点而不是就地改写。

**顺手做一次改造：** 在数据里补 `note` 字段，再给输入框加 `v-model="row.note"`，内容就不再依赖节点身份了——因为状态进了数据。两个修法分别对应「让视图跟随身份」与「让状态归数据」。

</template>

</Exercise>

<Exercise title="练习 2 · 修饰符对号入座" difficulty="基础">

四个需求各写一行模板（用修饰符解决，不写进处理函数）：① 弹窗内的点击不应触发遮罩关闭；② 只有点到遮罩自己时才关闭；③ 表单不要真的提交；④ 只在第一次点击时上报埋点。再回答：① 和 ② 的区别在事件流的哪个环节上。

<template #answer>

```vue
<div class="mask" @click.self="close">
  <div class="panel" @click.stop>
    <form @submit.prevent="save">
      <button @click.once="report">确认</button>
    </form>
  </div>
</div>
```

`@click.self` = 只有 `event.target` 就是这个 `div` 本身时才执行；`@click.stop` = `event.stopPropagation()`，阻止事件继续冒泡到遮罩。区别在环节上：`.stop` 干预**传播**（事件不再往祖先走），`.self` 干预**过滤**（事件照常传播，只是这个监听器判断该不该响应）。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释" difficulty="进阶">

在下面这个模板里逐条制造三处错误，预测各属于编译期还是运行期、报什么，并给修法：

```vue
<template>
  <p>{{ const n = items.length }}</p>
  <li v-for="item in items" v-if="item.show">{{ item.text }}</li>
  <input value="items.length">
</template>
```

<template #answer>

**第 1 行：编译期。** 双花括号里是声明语句，Vue 解析表达式失败，Vite 报 `[vite:vue] Error parsing JavaScript expression`。修法：只写 `items.length`，需要中间变量就放进 `computed`。

**第 2 行：运行期，而且能编译通过。** `v-if` 优先级高于 `v-for`，条件里读不到 `item`，抛错大意是「property item is not defined on instance」。这是**最危险的一类**：编辑器不标红、构建不报错，只在渲染时炸。修法：`<template v-for>` 包一层，或把过滤挪进 `computed`。

**第 3 行：什么都不报。** `value="items.length"` 绑的是 12 个字符的字符串，浏览器显示字面文本。修法：`:value="items.length"`。「不报错的界面」比报错更难查，所以本文把静态 / 动态差别放在 `v-bind` 第一句。

</template>

</Exercise>

<Exercise title="练习 4 · 把一个静态表单改造成受控组件" difficulty="进阶">

把 [HTML 表单](/html/forms) 里那种纯 HTML 注册表单（邮箱、密码、通知方式复选框组、类型 `select`、提交按钮）改写成用 `v-model` 的模板，要求：受控输入、复选框组绑到一个数组、`label` 关联正确、提交阻止默认行为并做校验。

<template #answer>

写法：`<form @submit.prevent="register">` 包住全部控件；邮箱与密码各绑一个 `ref` 并保留 `id` / `for` / `name` / `autocomplete`；两个通知方式复选框写成 `<input type="checkbox" value="mail" v-model="channels">` 共用 `const channels = ref<string[]>(['mail'])`；`select` 绑 `kind`；校验做成 `const valid = computed(() => email.value.includes('@') && pw.value.length >= 8)`，错误提示用 `<p v-if="submitted && !valid">`。

三个要点：**① 复选框组的状态初值必须是数组**，否则点第一下就报错；**② `v-model` 不接管原生表单语义**，让密码管理器认字段靠的还是 `name` + `autocomplete` + `label`；**③ 校验用 `computed`**，别在模板里把同一个判断写两遍各算一次。

</template>

</Exercise>

## 官方文档与延伸阅读

标注每条用来核实本章哪个结论（核实时间 2026-10-17）。

- [列表渲染](https://cn.vuejs.org/guide/essentials/list.html) —— **key 与优先级两节的全部结论来源**：`v-if` 优先级高于 `v-for` 及错误示例、无 key 时的 in-place patch 策略与「仅当不依赖临时 DOM 状态（如表单输入值）时才适用」、key 必须是字符串或数字且不要用对象、`<template v-for>` 上放 key、对象遍历顺序基于 `Object.values()`、范围从 1 到 n。
- [条件渲染](https://cn.vuejs.org/guide/essentials/conditional.html) —— `v-if` 切换时销毁重建监听与子组件、惰性、切换代价高；`v-show` 只切 `display`、始终渲染、不支持 `template`；两者选择建议。
- [表单输入绑定](https://cn.vuejs.org/guide/essentials/forms.html) —— 各控件绑定语义、`true-value` / `false-value`、`:value` 绑非字符串、`select multiple` 绑数组、忽略初始 `value` / `checked` / `selected`、`textarea` 插值无效、IME 组合期间不更新、三个修饰符行为。
- [内置指令 API](https://cn.vuejs.org/api/built-in-directives.html) 与 [模板语法](https://cn.vuejs.org/guide/essentials/template-syntax.html) —— `v-for` 支持可迭代对象（含 `Map` / `Set`）、`v-on` 修饰符清单与官方定义原文（`.passive`、`.capture`、`.self`）、`v-once` / `v-pre` / `v-cloak` 的措辞；插值与表达式边界的措辞（本章标了未逐字核实）。
- [安全](https://cn.vuejs.org/guide/best-practices/security.html) 与 [通用 API：nextTick](https://cn.vuejs.org/api/general.html) —— `v-html` 与不可信内容的官方结论；更新排队与「DOM 更新后再读」的语义（本章示例需浏览器验证，未在本机运行）。

## 下一章

模板解决了「给定状态怎么画」。下一个问题是 `computed(() => list.filter(...).length)` 什么时候重算、「值变了做一件事」什么时候不该用 `computed`、`watch` 的 `immediate` / `deep` 为什么会带来竞态。第 4 章 [计算属性与侦听器](/vue/computed-and-watch) 处理这条分界线——它会直接用到本章「模板只写表达式、复杂度挪进 `computed`」这条纪律。
