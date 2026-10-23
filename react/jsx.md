# JSX 与模板的对照：把结构写成 JavaScript 表达式

你按第 1 章把 Vue 待办组件的模板往 React 里搬，第一版长这样：

```tsx
// 这一段编译不过
function Todos({ todos }: { todos: Todo[] }) {
  return (
    <ul>
      if (todos.length === 0) {
        return <li>没有待办</li>
      }
      <li v-for="todo in todos" :key="todo.id">{todo.text}</li>
      <button onClick={remove()}>删除</button>
    </ul>
  )
}
```

三处红：`if` 语句不能出现在花括号之外；`v-for` 在 JSX 里不是任何合法语法；`onClick={remove()}` 会**立刻执行** `remove()` 并把返回值当 handler。三个错误指向同一件事——**JSX 不是模板语言，它是 JavaScript 表达式的一种写法。** 模板里那些「指令 + 固定语法位」，在 JSX 里统统还原成普通的 JS 表达式与属性。

## JSX 编译成什么

`<Greeting name="Taylor" />` 在 JavaScript 里根本不是合法语句，构建工具必须先把整段 JSX 转换掉。官方 [createElement 参考页](https://react.dev/reference/react/createElement) 给的对应关系是（核实时间 2026-10-17）：

| JSX 写法 | 转换后的调用 |
| --- | --- |
| `<Greeting name="Taylor" />` | `createElement(Greeting, { name: 'Taylor' })` |
| `<h1 className="greeting">Hello</h1>` | `createElement('h1', { className: 'greeting' }, 'Hello')` |

`createElement(type, config, ...children)` 返回的是**描述界面的普通对象**（`type`、`props`，加上顶层的 `key` 与 `ref`），不是 DOM 节点。这里有个与第 1 章 `key` 讨论呼应的细节：**`key` 和 `ref` 是返回对象上的顶层属性，不进 `props`**——子组件永远读不到自己的 `key`，需要 ID 就另外传 prop。

转换发生过两代：

```text
// 经典运行时：每个含 JSX 的文件都必须先 import React
const node = React.createElement('p', null, 'hi')

// 自动运行时：不需要引入 React，
// 由构建工具从 react 的 jsx-runtime 模块引入体积更小的 jsx / jsxs 函数
const node = jsx('p', { children: 'hi' })
```

**用哪一代由构建配置决定，不是由 React 版本决定**，也不该靠手写 `import React`。判断自己项目用的是哪种看两处：`tsconfig.json` 里 `jsx` 选项的取值，以及构建插件（Vite 场景是 React 插件）的配置。这两个字段分别归 [TypeScript tsconfig 文档](https://www.typescriptlang.org/tsconfig) 与 [Vite 文档](https://cn.vite.dev/guide/) 管，本站的 React 配置见 [前端工程化 Vite 章](/frontend-engineering/vite-dev)。

<Callout type="unverified" title="自动运行时的模块名与默认值我没有核实成功">

本次核实中 `react.dev/reference/react/jsx-runtime` 与旧版 React 站点的 JSX 转换博客都返回 404，没拿到官方专页，所以「`react/jsx-runtime` 导出 `jsx` / `jsxs`」这组具体名字只作为**常见叫法**给出，不当作可引用结论。

自己验证只要一分钟：跑一次生产构建，在产物 JS 里搜 `jsx-runtime`；或读你项目 `tsconfig.json` 的 `jsx` 字段——`react-jsx` / `react-jsxdev` 一类取值是自动运行时，`react` 是经典运行时。**本章其余 JSX 语法结论与此无关**：两种运行时下写 JSX 的方式完全一致。

</Callout>

## 表达式即插值

Vue 模板给你一堆语法位：双花括号插值、`v-bind:`、`v-on:`、`v-if` / `v-for`。JSX 只有一条规则：**花括号里是一个 JavaScript 表达式，它被求值，结果被渲染。** 能放什么完全由 JS 的表达式规则决定。

| 想做的事 | 能放进花括号 | 替代写法 |
| --- | --- | --- |
| 三元判断、函数调用、计算、模板字符串 | 能 | `` {`${todos.length} 项待办`} `` |
| 数组映射 | 能 | `{todos.map((t) => <li key={t.id}>{t.text}</li>)}` |
| 逻辑与短路 | 能 | `{todos.length > 0 && <ul />}` |
| `if` / `for` / `while` **语句** | **不能** | 换成表达式；或提到 `return` 之前用 JS 算好再插入；或提前 `return` |
| `return`、变量声明 | 不能 | 在函数体里声明，花括号里只引用它 |
| 注释 | 不能直接写行注释 | 见下文「JSX 里写注释」 |

「把语句变成表达式」的两种常用手法：

```tsx
// 手法 1：先算，再插值
function Panel({ todos, filter }: { todos: Todo[]; filter: string }) {
  let body
  if (todos.length === 0) body = <p>没有内容</p>
  else if (filter === 'done') body = <ul>{todos.map(renderRow)}</ul>
  else body = <p>加载中</p>
  return <section>{body}</section>
}

// 手法 2：提前 return
function Row({ todo }: { todo: Todo }) {
  if (!todo.visible) return null
  return <li>{todo.text}</li>
}
```

对照模板：`v-if` / `v-else-if` / `v-else` 三兄弟对应「三元链」或「`if` 提前 return」。`v-show`（渲染但隐藏）在 JSX 里没有对应指令，只能自己写 `style` 或 `className`——不是「React 不支持」，是一行属性的事。

## 属性名差异表

官方 [用 JSX 书写标记语言](https://react.dev/learn/writing-markup-with-jsx) 说得很直接：`class` 是保留字所以写 `className`；**大多数属性驼峰化**（该页举例 `strokeWidth` 对应 `stroke-width`）；**例外是 `aria-*` 与 `data-*`，保持短横线原样**（核实时间 2026-10-17）。

| HTML / Vue 模板 | JSX | 原因 |
| --- | --- | --- |
| `class` | `className` | JS 保留字 |
| `for` | `htmlFor` | JS 保留字 |
| `tabindex` / `readonly` / `autofocus` | `tabIndex` / `readOnly` / `autoFocus` | 驼峰化 |
| `maxlength` / `stroke-width` | `maxLength` / `strokeWidth` | 驼峰化（SVG 同样处理） |
| `aria-label` / `data-id` | **原样不动** | 例外 |
| `:disabled="isBusy"` | `disabled={isBusy}` | 绑值就是写表达式，不需要前缀 |
| `v-model` | `value` + `onChange` | 没有语法糖，第 10 章 |

`aria-*` 保持原样要单独强调：**它是无障碍语义的载体，写成驼峰等于属性没生效**——`ariaLabel` 不会替你翻译，屏幕阅读器读不到标签，而 React 通常不报错，它只做透传。验收只有一条：在 DevTools 的 Elements 面板确认最终 DOM 上的属性名与 [HTML 无障碍](/html/accessibility) 的标准写法逐字一致。

## 事件对照 `v-on`

| Vue | React | 说明 |
| --- | --- | --- |
| `@click="handle"` | `onClick={handle}` | 事件名是 DOM 事件名驼峰化 |
| `@click="remove(todo.id)"` | `onClick={() => remove(todo.id)}` | 必须自己包闭包，**每次渲染新建一个函数** |
| `@click="handle()"` | `onClick={handle}` | 模板里的调用形式由编译器包装；JSX 里写 `handle()` 就是**立即执行** |
| `@click.prevent` / `@click.stop` | `onClick={(e) => { e.preventDefault(); ... }}` / `e.stopPropagation()` | 修饰符没有，手写 |
| `@click.self` | `onClick={(e) => { if (e.target === e.currentTarget) ... }}` | 两行判断 |
| `@click.once` | 自己加标志位，或用 state 控制禁用 | 没有对应物 |
| `@keyup.enter` | `onKeyDown={(e) => { if (e.key === 'Enter') ... }}` | 走 `KeyboardEvent.key`，与 Vue 修饰符命名不完全一一对应 |
| `@click.capture` | `onClickCapture` | React 提供 capture 阶段变体 |

<Callout type="warn" title="花括号里写调用等于渲染时就执行">

```tsx
<button onClick={remove(todo.id)}>删除</button>        // 错
<button onClick={() => remove(todo.id)}>删除</button>   // 对
```

第一行的花括号是表达式，React 在**渲染阶段**就求值了：`remove(todo.id)` 当场执行，返回值（多半是 `undefined`）被当 handler 传进去。症状是「页面一打开就删了一项」，或直接报「更新发生在 state 更新期间」。第二行传入的是**函数本身**，等浏览器真的派发 click 才调用。同理 `onClick={todo.done ? remove : undefined}` 合法（值是函数），`onClick={log('点击')}` 不合法（值是返回值）。要传参又要点才执行，永远包一层箭头函数。

</Callout>

## 必须有单一根，以及 Fragment

组件函数只能**返回一个值**，两个并列 JSX 元素不是表达式（`<h1>标题</h1>` 紧跟 `<p>正文</p>` 会直接报语法错误）。三条出路（官方 [writing-markup-with-jsx](https://react.dev/learn/writing-markup-with-jsx) 与 [Fragment 参考](https://react.dev/reference/react/Fragment)，核实时间 2026-10-17）：

1. **包一层真实元素。** 代价是多一层 DOM，会影响 CSS（直接子元素选择器）与语义。Vue 3 已允许多根，所以这条限制对迁移的人格外刺眼。
2. **Fragment 简写 `<>...</>`。** 官方描述它「对生成的 DOM 没有任何影响，就好像没有分组一样」——只在 React 的树里分组，不留痕。
3. **需要 `key` 时必须显式写。** 官方 Caveat 原文：**想给 Fragment 传 `key` 就不能用简写语法，必须从 `react` 显式导入 `Fragment`**：

```tsx
import { Fragment } from 'react'

function Blog({ posts }: { posts: Post[] }) {
  return (
    <>
      {posts.map((post) => (
        <Fragment key={post.id}>
          <h2>{post.title}</h2>
          <p>{post.excerpt}</p>
        </Fragment>
      ))}
    </>
  )
}
```

对照 Vue：模板里 `<template v-for>` 包多元素、Vue 3 的多根组件，在 React 里都落到 Fragment。**一句话记住：JSX 要求单根，Fragment 是无痕的单根，`map` 出来的 Fragment 必须带 `key`。**

## 条件渲染三种写法与那个「0」

[条件渲染](https://react.dev/learn/conditional-rendering) 给三种手段：`if` + 提前 return、三元、`&&` 短路（核实时间 2026-10-17）。React 把 `false` / `null` / `undefined` 当树里的「洞」，什么都不渲染。

第三种有官方明确警告的坑，小标题原文是 **Don't put numbers on the left side of `&&`**：JS 会把左边转成布尔来测试条件，但**整个表达式的值是左边的原值**，而 `0` 会被渲染出来。

```tsx
<p>{messageCount && <span>有新消息</span>}</p>       // count 为 0 时页面上出现一个「0」
<p>{messageCount > 0 && <span>有新消息</span>}</p>    // 对：左边是布尔
<p>{messageCount === 0 ? null : <span>有新消息</span>}</p>  // 对：三元，最不容易错
```

它经典就经典在：`0` 只在空列表/零消息时出现，测试往往只覆盖「有数据」那一侧。同一族问题：`{isVisible}` 会把布尔 `true` 打进页面；`{name && <p>{name}</p>}` 在 `name` 为 `''` 时返回空字符串。**类型混合的条件一律用三元。**

## 列表渲染：`map` + `key`

```tsx
<ul>
  {todos.map((todo) => (
    <li key={todo.id}>{todo.text}</li>
  ))}
</ul>
```

规则与 `v-for` + `:key` 一样：写在 `map()` 里的元素必须有 `key`，同批兄弟间唯一，用业务稳定 ID，**不要用索引**（第 1 章已从 [渲染列表](https://react.dev/learn/rendering-lists) 核实）。

补充两点。其一，两边协调算法不同：React 按 key 匹配同层子元素，Vue 的 diff 有自己的策略（见 [Vue 模板语法](/vue/template-syntax) 与 [渲染性能](/vue/rendering-performance)）——**算法不同，结论相同**：索引随插入/删除/排序漂移，key 与内容的对应一变，框架就把 state 和 DOM 复用到错误的行上。其二，`map` 出来的元素如果包在 `Fragment` 里，**`key` 要给 Fragment**，给组内第一个子元素不管用；而 `key` 永远不进 props，别拿它当业务 ID 传数据。

## 内联样式

Vue 的 `:style` 很宽容，绑字符串或对象都行；React 的 `style` **只接受一个对象**，键用驼峰，值用字符串或数字：

```tsx
<div style={{ color: accentColor, fontSize: 14 }}>A</div>
<div style={{ backgroundColor: '#fff' }}>短横线键在这里无效</div>
<div style={{ '--accent': '#0a7' }}>自定义属性是例外，写成字符串键</div>
```

三个易混点：**外层花括号是 JSX 插值、内层是对象字面量的花括号**，按「插值里放一个对象」来读，不是什么特殊语法；`background-color` 必须写 `backgroundColor`，但 CSS 自定义属性反过来要保持 `--accent` 字符串键（与 Vue 思路一致，见 [CSS 值与自定义属性](/css/units-and-custom-properties)）；**别把内联样式当样式方案**——静态样式回 CSS 文件 + `className`，内联只用于运行时才知道的值（进度条宽度、拖拽坐标）。

## `dangerouslySetInnerHTML` 与 `v-html`

Vue 里写 `v-html="richText"`；React 没有「把字符串当 HTML 解析」的常规属性，所有插值默认当文本转义（这一点两边一样安全）。要显式打开只能：

```tsx
<div dangerouslySetInnerHTML={{ __html: richText }} />
```

名字里带 `dangerously` 是故意的：**它绕过转义，风险与 `v-html` 完全等同。** 只有来源可信（你自己的 Markdown 管线且过滤过）才能用；渲染用户输入的字符串就是 XSS，参见 [Web 安全](/backend/web-security)。属性名用双下划线前缀，本身就是「这是逃生舱口、不是常规 API」的信号。

## 组件引用必须大写开头

JSX 标签名首字母大小写**不是风格问题，是语义开关**（`createElement` 参考页写明了对应关系：大写 → 传函数给 type，小写 → 传字符串）：

```tsx
<Home />     // type 是 Home 这个函数 → React 调用它，这是一个组件
<home />     // type 是字符串 'home' → 输出一个未知的自定义标签，不会渲染你的组件
```

后果是页面空白，控制台报「The tag `<home>` is unrecognized in this browser」——注意这行来自 **DOM 层**，浏览器真的收到了一个叫 `home` 的未知标签。三条约定：组件标识符用 PascalCase；import 进来时也保持大写；`<Foo.Bar />` 这种点语法合法，整段表达式的值被当 type，所以命名空间导入后可以写 `<Icons.ArrowRight />`。Vue 的 `<script setup>` 由模板编译器去作用域查名字，大小写没那么致命——**这是「Vue 里能跑、React 里静默失效」的典型一条**。

## JSX 里写注释

JSX 区域处于表达式上下文，注释不是表达式，必须包进花括号放在表达式位置：

```tsx
return (
  <ul>
    {/* 这一行解释为什么要 key */}
    {todos.map((t) => (
      <li key={t.id}>{/* 文本节点里也能放 */}{t.text}</li>
    ))}
  </ul>
)
```

JSX **之外**（函数体普通 JS 位置）用常规行注释与块注释。在标签之间写行注释会把那串字符当文本渲染到页面上——这是会跑到用户眼前的错误；多行一律用块注释，因为行注释会把换行后的标签一起吃掉。

## 把 Vue 模板机械改写成 JSX 的七个步骤

按顺序做，不确定就回头查上面的表：

1. **删指令前缀。** `v-bind:x` → `x`，`v-on:x` → `onX`（驼峰），`v-model` → `value` + `onChange`，`v-show` → `style` / `className`。
2. **属性名换成 JS 侧拼写。** 查差异表：`class`→`className`、`for`→`htmlFor`、其余驼峰化，`aria-*` / `data-*` 不动。
3. **`v-for` 移到 JSX 外面。** 「带 `v-for` 的元素」改写成「`数组.map(项 => 那个元素)`」，`:key` 变成元素上的 `key={...}`。
4. **`v-if` / `v-else` 变表达式。** 优先三元；超过两层就提到 `return` 前用 `if` 算变量；组件级「不满足就整个不渲染」用提前 `return null`。
5. **插值改成单花括号表达式。**
6. **检查根。** 并列根元素包 Fragment；`map` 出来的 Fragment 补 `key`。
7. **补类型。** props 用 `type` / `interface` 声明并从参数解构，把模板里隐式的 prop 名变成显式 TS 字段（[TypeScript 函数类型](/typescript/functions)）——这是 JSX 相对模板的实际收益之一。

### 三段改写样例

第一段，基础绑定与事件：

```vue
<template>
  <button :disabled="loading" @click.stop="save">
    {{ loading ? '保存中' : '保存' }}
  </button>
</template>
```

```tsx
<button
  disabled={loading}
  onClick={(e) => {
    e.stopPropagation()
    save()
  }}
>
  {loading ? '保存中' : '保存'}
</button>
```

第二段，条件与列表混用：

```vue
<template>
  <ul v-if="items.length">
    <li v-for="(item, i) in items" :key="item.id" :class="{ done: item.done }">
      {{ i + 1 }}. {{ item.name }}
    </li>
  </ul>
  <p v-else>暂无数据</p>
</template>
```

```tsx
{items.length > 0 ? (
  <ul>
    {items.map((item, i) => (
      <li key={item.id} className={item.done ? 'done' : undefined}>
        {i + 1}. {item.name}
      </li>
    ))}
  </ul>
) : (
  <p>暂无数据</p>
)}
```

两个细节：`v-if` / `v-else` 变成**一整个三元表达式**；`:class="{ done: item.done }"` 这种对象语法在 React 里**没有对应**，要么三元拼字符串，要么用 `clsx` 这类库（属生态选型，不是 React 特性）。另外 `i` 出现在界面上但没被当 `key`——序号可以显示，不能当身份标识。

第三段，`v-model` 与具名插槽：

```vue
<template>
  <Modal title="编辑">
    <template #footer>
      <button @click="close">关闭</button>
    </template>
    <input v-model="form.name" />
  </Modal>
</template>
```

```tsx
<Modal title="编辑" footer={<button onClick={close}>关闭</button>}>
  <input
    value={form.name}
    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
  />
</Modal>
```

插槽的两条出路都在这里：**简单场景把插槽降级成一个「节点类型的 prop」**（`footer?: ReactNode`），**默认插槽就是 `children`**。完整对照在 [第 4 章 props、回调与 children](/react/props-and-children)；`v-model` 展开成受控输入见 [第 10 章](/react/refs-and-forms)。

## JSX 与模板的取舍

| 维度 | Vue 模板 | JSX |
| --- | --- | --- |
| 与 JS 的距离 | 隔一层编译器，有固定语法位 | 就是 JS 表达式 |
| 表达能力 | 指令覆盖常见场景，超出要靠 `v-bind` 对象展开等技巧 | 有 JS 全部能力，但**没有任何护栏**——漏 `key`、`&&` 左边放数字、`onClick` 里调用都不报错 |
| 可读性 | 结构一眼可见 | 嵌套深或多行表达式容易失控，常见做法是把子结构提成组件而不是继续缩进 |
| 类型检查 | 模板内表达式的检查依赖工具链 | 属性名、children 类型、回调签名都能被 TS 直接查，报错定位到具体属性 |
| 编译期优化 | 静态提升、补丁标记，能编译成更聪明的代码 | 只做语法展开，靠运行时策略 |

**取舍的实质是「护栏 vs 表达力」。** 模板给你一组被编译器检查的构造，超出时得绕；JSX 给你全部 JS，代价是**所有在 Vue 里编译器会提醒你的错误，现在要靠运行时或 lint 抓**——所以 React 项目里 `react/jsx-key`、`react/jsx-no-useless-fragment`、`react-hooks/exhaustive-deps` 这几条规则不是可选的（[ESLint 与 Prettier](/frontend-engineering/lint-and-format)）。JSX 的真实收益在 TypeScript 一侧：属性拼错、漏传必填 prop、给 `onClick` 传了返回非函数的表达式，都能在编译期报出来，这也是本站示例全用 TSX 的原因（[为什么需要类型](/typescript/why-types)）。

## 常见错误与排查

**1. 现象：`onClick={fn()}`，渲染时 handler 就跑了一次，或报「更新发生在渲染过程中」。** 原因：花括号是表达式，`fn()` 在渲染阶段被求值，传进去的是返回值。确认：改成不带括号的形式，异常立刻消失。修：传函数本身，需要参数就 `() => fn(arg)`。

**2. 现象：`{count && <p>有新消息</p>}` 在 `count === 0` 时页面上多一个「0」。** 原因：`&&` 返回左边的值本身，`0` 不是布尔，React 会输出它。确认：手动把 `count` 设成 0 复现。修：左边改成布尔，或用三元（官方专门警告过）。

**3. 现象：`if` / `for` 写在花括号里，构建报语法错误。** 原因：插值只接受表达式。确认：报错指向那个花括号，通常是 Unexpected token。修：改三元 / 提到 `return` 前算好 / 用 `map` 代替 `for`。

**4. 现象：返回两个并列根元素，报 adjacent JSX elements must be wrapped。** 原因：函数只能返回一个表达式。修：优先 `<>...</>`；**这段结构若是被 `map` 出来的，简写不支持 `key`，必须显式导入 `Fragment` 并写带 key 的形式**。

**5. 现象：`class="btn"` 不生效，控制台警告 Invalid DOM property `class`。** 原因：JSX 用 `className`。同族：`for`→`htmlFor`、`tabindex`→`tabIndex`。**反方向也要防**：`aria-label` 写成驼峰不报错，但无障碍静默失效——去 DevTools 看最终 DOM 的属性名。

**6. 现象：小写标签的组件渲染空白，浏览器报 unrecognized in this browser。** 原因：小写被当字符串宿主元素，React 根本不调你的函数。确认：报错里的标签名不是标准 HTML 标签；改 PascalCase 后正常。修：组件标识符与 import 名都首字母大写。

**7. 现象：`map` 忘写 `key`，控制台反复警告，输入框内容还会串行。** 原因：没有 key 时 React 退回用索引，插入/删除后身份漂移。确认：改掉某行输入内容，在列表头部插一项，看内容是否跟着索引跑。修：`key={item.id}`，Vue 里同一修法。

**8. 现象：`style="color: red"` 不生效。** 原因：React 的 `style` 只接受对象，字符串会被拒并警告；对象里写短横线键同样无效。修：改成驼峰键的对象；静态样式回 CSS 文件。

**9. 现象：标签之间的注释出现在页面上。** 原因：JSX 区域内注释文本被当文本节点。修：改成花括号包裹的块注释。

## 练习

<Exercise title="练习 1 · 找出这段 JSX 的四处问题" difficulty="基础">

```tsx
function UserList({ users, onSelect }) {
  return (
    <div class="list">
      <label for="pick">选择</label>
      {users.map((u, i) => (
        <p key={i} onClick={onSelect(u.id)}>
          // 高亮当前用户
          {u.name}
        </p>
      ))}
      {users.length && <span>共 {users.length} 人</span>}
    </div>
  )
}
```

列出四处会真的出问题或埋雷的地方并说明原因。

<template #answer>

1. `class` 应为 `className`，`for` 应为 `htmlFor`（两个都是 JS 保留字）。
2. `key={i}` 用索引当身份：`users` 一旦插入、删除或排序，React 会把段落和它的本地状态错配到别人身上。改 `key={u.id}`。
3. `onClick={onSelect(u.id)}` 在**渲染阶段就调用**了 `onSelect`，传进去的是返回值。改 `onClick={() => onSelect(u.id)}`。
4. `{users.length && ...}`：`length` 为 0 时表达式值是 `0`，页面渲染出一个「0」。改 `users.length > 0 && ...` 或三元。

加分两处：标签之间的行注释会被当文本渲染，要改成花括号包裹的块注释；`users` 与 `onSelect` 没有类型注解，在 TSX 里报隐式 `any`。

</template>

</Exercise>

<Exercise title="练习 2 · 把这段 Vue 模板改写成 React JSX" difficulty="进阶">

```vue
<template>
  <form @submit.prevent="submit">
    <label for="task">任务</label>
    <input id="task" v-model.trim="text" />
    <p v-if="error" class="err">{{ error }}</p>
    <button :disabled="!text">提交</button>
  </form>
</template>
```

改写它，并回答：（a）`v-if` 与 `v-else` 的语义有没有变化？（b）`v-model.trim` 你打算怎么实现？

<template #answer>

```tsx
function TaskForm({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const value = text.trim()
        if (!value) {
          setError('不能为空')
          return
        }
        setError(null)
        onSubmit(value)
        setText('')
      }}
    >
      <label htmlFor="task">任务</label>
      <input id="task" value={text} onChange={(e) => setText(e.target.value)} />
      {error ? <p className="err">{error}</p> : null}
      <button disabled={!text.trim()}>提交</button>
    </form>
  )
}
```

（a）**语义没变，责任变了。** `v-if` 的分支在条件切换时创建/销毁元素，JSX 三元完全一样（区别于 `v-show`）。变的是：Vue 编译器替你保证条件是布尔，JSX 里写成 `{error && <p>...}` 时，`error` 是空字符串会返回空字符串（视觉上什么都没有，但 DOM 里多一个文本节点），是 `null` 时才真的不渲染。**字符串类条件一律用三元。**

（b）`.trim` 修饰符消失了，要么在 `onChange` 里就裁剪（副作用：用户打不进中间的空格），要么像上面这样原样存、在需要的位置（提交、禁用判断）分别 `trim()`。这类「修饰符消失后，转换时机由你自己决定」的情况，是 JSX 相比模板少掉的一层约定，也是 review 时该盯的点。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释报错" difficulty="进阶">

下面的组件在控制台报 `Each child in a list should have a unique "key" prop`，而 Fragment 简写那版没法加 `key`。说明怎么修，以及为什么 `key` 不能只放在里面的 `dt` 上。

```tsx
function Glossary({ terms }: { terms: Term[] }) {
  return (
    <dl>
      {terms.map((t) => (
        <>
          <dt>{t.name}</dt>
          <dd>{t.body}</dd>
        </>
      ))}
    </dl>
  )
}
```

<template #answer>

简写 `<>...</>` **不接受任何属性，包括 `key`**——这是官方 Fragment 参考页的 Caveat。修法：

```tsx
import { Fragment } from 'react'

function Glossary({ terms }: { terms: Term[] }) {
  return (
    <dl>
      {terms.map((t) => (
        <Fragment key={t.id}>
          <dt>{t.name}</dt>
          <dd>{t.body}</dd>
        </Fragment>
      ))}
    </dl>
  )
}
```

为什么不能只给 `<dt>` 加 key：每次迭代返回的是**一个 Fragment 元素**（一对 `dt` + `dd`），React 要标识的是「这一组」，不是组里第一个节点。只给 `dt` 加，`dd` 仍是无 key 的兄弟，插入或删除词条时释义项会和别的词条错配——这正是官方所说「key 告诉 React 每个组件对应数组里的哪一项，以便后续匹配」。

再补一条：`key` 不进 props（`createElement` 把它放在返回对象顶层），所以别指望组件内部用 `key` 当业务 ID。

</template>

</Exercise>

<Exercise title="练习 4 · 判断哪些写法能编译" difficulty="挑战">

假设 `n = 0`、`name = ''`、`flag = false`、`items = []`。逐个回答「能编译吗」，能的说明渲染结果。

```tsx
{flag ? 'A' : 'B'}
{n && <p>x</p>}
{if (flag) return 'A'}
{items.length > 0 && <ul />}
{const x = 1}
{name && <p>{name}</p>}
```

<template #answer>

1. **能**，渲染 `B`。
2. **能**，渲染 `0`——本章那个经典 bug：`&&` 返回左原值，`0` 不是布尔，React 会输出它。
3. **不能**，`if` 是语句不是表达式。
4. **能**，什么都不渲染（左边是布尔 `false`）。
5. **不能**，变量声明是语句。
6. **能**，返回空字符串：视觉上没有内容，但 DOM 里多一个空文本节点。

规律一句话：**能放的只有表达式，语句一律不行；短路运算符返回的是值而不是布尔，所以数字和字符串会漏到界面上。** 因此第 6 类「条件是字符串/数字」的写法最好一律改三元。

</template>

</Exercise>

## 官方文档与延伸阅读

核实时间统一为 2026-10-17。

- [用 JSX 书写标记语言](https://react.dev/learn/writing-markup-with-jsx) —— 核实 `class`→`className` 的原因、大多数属性驼峰化而 `aria-*` / `data-*` 例外、必须单一根与 Fragment 简写不影响 DOM、标签必须闭合。
- [`createElement` 参考](https://react.dev/reference/react/createElement) —— 核实「JSX 编译成 `createElement`」「`key` 与 `ref` 是返回对象顶层属性、不进 `props`」「大写传函数、小写传字符串」，以及元素是描述对象而非 DOM。
- [条件渲染](https://react.dev/learn/conditional-rendering) —— 核实三种写法与「不要把数字放在 `&&` 左边」的原文警告和两种修法。
- [Fragment 参考](https://react.dev/reference/react/Fragment) —— 核实「传 `key` 就不能用简写，必须显式导入 `Fragment`」与 `map` 里给 Fragment 加 key 的官方示例，以及「Fragment 对生成的 DOM 没有影响」。
- [渲染列表](https://react.dev/learn/rendering-lists) —— 核实 `key` 三条规则与「不要临时生成 key」。
- [你的第一个组件](https://react.dev/learn/your-first-component)、[导入与导出组件](https://react.dev/learn/importing-and-exporting-components) —— 「大写开头」规则的上下文。
- [Vite 文档](https://cn.vite.dev/guide/) 与 [TypeScript tsconfig 参考](https://www.typescriptlang.org/tsconfig) —— 查 JSX 转换由哪个配置决定；本站未核实默认取值，动手前读你自己项目的 `tsconfig.json`。
- [HTML 无障碍](/html/accessibility) —— `aria-*` 与 `label` 关联的标准语义；React 只透传属性名，不解释语义。

## 下一章

结构会写了，下一件躲不掉的是**状态**。第 1 章已经预告过症状：React 里 `todos.push(x)` 界面不动。[第 3 章 useState / useReducer 与不可变更新](/react/state) 把这条规则讲到底——state 为什么是快照、setter 为什么是「请求渲染」而不是「赋值」、对象和数组为什么必须整体替换、`useReducer` 什么时候值得用，以及 stale closure 在事件监听器、定时器、异步回调里的三种真实故障。本章解决「怎么把界面写出来」，第 3 章解决「怎么写才能让界面真的变」。
