# props、回调与 children：React 没有 emit，插槽只是普通 prop

四类故障都出自同一处空白。第一类：你把父组件的 `setTodos` 原封不动传给了子组件，子组件直接调它改父状态——代码能跑，三个月后没人知道这条数据是谁改的。第二类：你想复刻 Vue 的具名插槽，于是一口气加了 `showHeader`、`showFooter`、`headerTitle`、`footerButton` 四个布尔与字符串 prop，封装组件的接口开始腐烂。第三类：切换用户之后，编辑表单里还留着上一个用户填的内容。第四类：调用方给按钮传了 `className="mt-4"`，样式没出来，因为它被组件内部的 `className` 覆盖掉了。

根子是同一件事：**React 的组件接口只有一种货币，就是 props。** 值、DOM 事件、回调函数、已经创建好的 JSX 元素、函数本身，全都是 prop。Vue 给你的 `emit`、具名插槽、作用域插槽是**三套专门机制**（有自己的声明宏、编译器支持和模板语法）；React 不给专门机制，只给你「任何 JavaScript 值都能当 prop」这条通用规则。自由度高，代价是没有编译期检查、也没有默认行为来兜住你的疏忽。

这一章把这条规则用到四个场景上：向上通信、内容分发、样式透传、组件重挂载。前置：[props 与 emit、插槽](/vue/components)、[JSX 与模板的对照](/react/jsx)、[useState 与不可变更新](/react/state)。

## 单向数据流是共识，分歧只在「消息怎么送上去」

两家完全一致的部分：props 只读，父到子单向传递；子组件不拥有它显示的数据。React 官方对 props 的措辞是 immutable（不可变），并且明确写了「不要试图去改 props」——输入变化时你要 `setState`，而不是写 `props.x = ...`。

不一致的部分只有一个：**React 没有 emit。** 子组件能做的只有一件事——调用父组件作为 prop 传下来的函数。逐行对照：

| 目的 | Vue 3 | React |
| --- | --- | --- |
| 声明「我会往外发什么」 | `defineEmits<{ todoAdd: [text: string] }>()` | 在 `interface Props` 里写 `onTodoAdd: (text: string) => void` |
| 触发 | `emit('todoAdd', text)` | `props.onTodoAdd(text)` |
| 父组件接收 | `@todo-add="handleAdd"` | `onTodoAdd={handleAdd}` |
| 事件名风格 | DOM 模板大小写不敏感，推荐 kebab-case | 必须 camelCase，惯用 `onXxx` 前缀 |
| 可选不传 | 不传就没人听，静默 | 不传就 `undefined`，调用时**运行期 TypeError** |
| 同一个名字传两个处理函数 | 多个监听器都会被调用 | 后写的覆盖先写的（一个 prop 只有一个值） |
| 原生 DOM 事件 | `@click` 直接监听原生事件 | `onClick={...}` 就是原生事件（React 自己做事件委托） |
| 类型检查 | `defineProps` + 运行时 props 校验 | TypeScript 接口；`propTypes` 已不用于新代码 |

「可选不传」这一行是差异最大的一处。Vue 里漏写 `defineEmits` 声明会直接告警，React 里漏传回调只在**用户点下去那一刻**崩：

```tsx
function TodoInput({ onTodoAdd }: { onTodoAdd?: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onTodoAdd?.(text.trim());   // 可选链：没传就什么都不发生
        setText('');
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} />
    </form>
  );
}
```

用 `onTodoAdd?.(x)` 还是必填，是一个接口决策：**必填**（`onTodoAdd: (text: string) => void`，不加 `?`）表示「这个组件没有父组件的配合就不成立」，编译期就逼调用方传；**可选**表示「不传时降级为纯展示」。别用空函数默认值 `onTodoAdd = () => {}` 来同时满足两者——那是把接口缺陷静默吞掉。

## props 是渲染那一刻的快照：stale closure 从哪来

这是第一个「Vue 直觉失效」的地方。看这段代码，它在两家里的行为不同：

```tsx
// React：3 秒后打印的是「发起那一刻」的 userId
function Profile({ userId }: { userId: string }) {
  function saveLater() {
    setTimeout(() => {
      console.log(userId); // 闭包捕获的是本次渲染的参数值
    }, 3000);
  }
  return <button onClick={saveLater}>稍后保存</button>;
}
```

按钮点下去之后，父组件把 `userId` 从 `'u1'` 换成 `'u2'`，`Profile` 会用新的 props 重新执行一次函数。但那个已经排好的 `setTimeout` 回调属于**上一次函数调用的作用域**，它读到的永远是 `'u1'`。原因在第 1、3 章反复强调的那句话：组件函数每次渲染都是一次全新的调用，props 是这一次调用的**参数**，参数不会被后来的渲染改掉。

Vue 里同样的写法读到的却是最新值：

```vue
<script setup lang="ts">
const props = defineProps<{ userId: string }>();
function saveLater() {
  setTimeout(() => {
    console.log(props.userId); // 读代理属性：拿到读取那一刻的最新值
  }, 3000);
}
</script>
```

差异来源是数据结构不同：Vue 的组件实例是持续的，`props` 是一个 Proxy（shallowReactive），`props.userId` 是一次**属性读取**，代理只保证「读到时的值是当前值」；React 的 props 是**函数形参**，读它不再经过任何代理，读的是那个词法作用域里的常量。Vue 侧的机制细节以[响应式深入](https://cn.vuejs.org/guide/extras/reactivity-in-depth.html)与[组件 props 文档](https://cn.vuejs.org/guide/essentials/component-basics.html)为准。

推论：在 React 里，只要一段代码会跨越渲染（定时器、事件监听、异步回调、Promise 之后），它读到的 props 就可能是过期的。修法不是想办法「读到最新 props」，而是把它变成依赖项明确的东西——放进 effect 依赖（见 [useEffect](/react/use-effect)），或者把需要的值当参数传进回调。

## 类型与默认值：interface Props 加解构默认值

本站全部用 TSX。React 侧的接口声明就是普通 TypeScript 接口，外加一个 `children`：

```tsx
import type { ReactNode } from 'react';

type Density = 'compact' | 'comfortable';

interface Props {
  todos: Todo[];
  onToggle: (id: string) => void;
  emptyText?: string;
  density?: Density;
  children?: ReactNode;      // 有默认插槽时才写；没有就别写，让误传变成编译错误
}

function TodoList({
  todos,
  onToggle,
  emptyText = '暂无待办',
  density = 'compact',
  children,
}: Props) {
  // ...
}
```

对照 Vue 3 的等价声明：

```vue
<script setup lang="ts">
import type { VueNode } from './types';
interface Props {
  todos: Todo[];
  density?: 'compact' | 'comfortable';
  emptyText?: string;
}
const props = withDefaults(defineProps<Props>(), {
  emptyText: '暂无待办',
  density: 'compact',
});
const emit = defineEmits<{ toggle: [id: string] }>();
</script>
```

| 维度 | React | Vue 3 |
| --- | --- | --- |
| 类型来源 | 手写 `interface Props`，靠 TS 结构化匹配 | `defineProps` 宏 + 类型实参，同时生成运行时声明 |
| 运行时校验 | 无（`propTypes` 已退出新代码） | 有，开发环境会告警 |
| 默认值写法 | 解构默认值 | `withDefaults` |
| 默认值生效条件 | 仅 `undefined`（传 `null`、`0`、`''` **不生效**，官方明确写了这一点） | 仅 `undefined`；布尔 prop 缺省为 `false` |
| 未知 prop | 进 `...rest` 或留在 props 上，无警告 | 落进 `$attrs`，无警告 |

默认值的三种写法与取舍：

| 写法 | 例子 | 什么时候用 |
| --- | --- | --- |
| 解构默认值（推荐） | `function Avatar({ size = 100 }: Props)` | 绝大多数情况。官方教程现在只讲这一种 |
| 渲染体内 `??` | `const label = emptyText ?? '暂无待办'` | 需要区分 `null` 与 `undefined`（例如 `null` 表示「故意不显示」） |
| `Component.defaultProps` | `TodoList.defaultProps = { density: 'compact' }` | 别用。React 19 已把函数组件的 `defaultProps` 移除（升级指南原文：removing `defaultProps` from function components in place of ES6 default parameters），类组件仍支持 |

`children` 类型该写什么：`ReactNode` 最宽松（字符串、数字、元素、数组、片段、`null` 都能进），`ReactElement` 只允许「已经创建好的元素」（不接受 `'纯文本'`），`JSX.Element` 是 `ReactElement` 的别名。布局组件用 `ReactNode`；只接受元素的槽位（比如 `icon`）用 `ReactElement`，能让误传字符串在编译期被拦下。

## children 就是默认插槽，具名插槽是多个 prop

嵌套 JSX 的内容会自动进 `children` 这个 prop，这一条与 Vue 的默认插槽（`<slot />`）几乎同构：

| Vue | React | 备注 |
| --- | --- | --- |
| `<slot />` | `{children}` | 位置由你决定，可放多次 |
| `<slot name="header" />` | `{header}`（`header?: ReactNode`） | React 无 slot 名概念，prop 名就是槽位名 |
| `<Card><h2>标题</h2></Card>` | `<Card header={<h2>标题</h2>}>...</Card>` | 传元素，不是传标签 |
| `#header="{ title }"`（作用域插槽） | `renderHeader={(title) => ...}`（render prop） | 见下一节 |
| `<template #fallback>` / `v-if` 判空 | `header ?? <DefaultHeader />` | 默认内容用空值合并，一行搞定 |
| `<slot>` 不存在时父组件内容被丢弃 | 你不解构 `{children}`，它就静静躺着不渲染 | 忘了渲染是 React 常见的「内容凭空消失」bug |

```tsx
interface CardProps {
  title?: string;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

function Card({ title, header, footer, children }: CardProps) {
  return (
    <section className="card">
      <div className="card-head">
        {header ?? <h3>{title ?? '未命名'}</h3>}   {/* 默认内容 */}
      </div>
      <div className="card-body">{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

// 调用
<Card header={<h3>收件箱</h3>} footer={<Pagination page={page} onChange={setPage} />}>
  <MessageList messages={messages} />
</Card>
```

**为什么 React 不需要专门的插槽语法？** 因为 JSX 元素本身就是值。`<Pagination page={page} onChange={setPage} />` 这个表达式求出的对象可以赋给变量、放进数组、当参数传——自然也能当 prop 传。Vue 必须有 `v-slot` 是因为模板不是 JavaScript，父组件里的元素无法「在父作用域求值后交给子组件」，编译器得专门造一套语法来做这件事。React 里这段 JSX 是在**父组件的函数体内**求值的，天然带父作用域，所以不需要额外机制。

代价同样明显：**没有编译期检查**。Vue 里写错插槽名（`#headre`）至少能在组件的 `useSlots()` 或告警里发现；React 里 prop 名拼错，`header` 变 `undefined`，`?? <DefaultHeader />` 静默兜住，你只看到「自定义标题没生效」，排查方向还错了。另一个代价是**响应性丢失**：Vue 的作用域插槽更新由父组件驱动，React 传下去的是**已求值的元素**，父组件不重新渲染，那块内容就不会刷新——这在把外部数据塞进固定 prop 时容易误判。

## 作用域插槽的对应物：把函数当 prop 传

Vue 里「子组件把数据交回父组件决定怎么渲染」是作用域插槽，React 里叫 render prop（或回调渲染），本质是传一个函数。完整可用的例子：

```tsx
import type { ReactNode } from 'react';

interface ItemListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;   // 作用域插槽的对应物
  renderEmpty?: () => ReactNode;
  onPick?: (id: T['id']) => void;
}

function ItemList<T extends { id: string }>({
  items,
  renderItem,
  renderEmpty,
  onPick,
}: ItemListProps<T>) {
  if (items.length === 0) {
    return <p className="empty">{renderEmpty?.() ?? '没有可显示的内容'}</p>;
  }
  return (
    <ul className="list">
      {items.map((item, i) => (
        <li key={item.id} onClick={() => onPick?.(item.id)}>
          {renderItem(item, i)}
        </li>
      ))}
    </ul>
  );
}

// 调用：等价于 Vue 的 <template #default="{ item, index }">
<ItemList
  items={todos}
  renderItem={(item, index) => (
    <span>
      {index + 1}. {item.text}
      {item.done ? <Tag tone="green">完成</Tag> : null}
    </span>
  )}
/>
```

`children` 也能放函数（`<ItemList>{(item) => <Row item={item} />}</ItemList>`），效果与 `renderItem` 相同。本站建议：**只有一个槽位时用函数 children 无妨，有两个以上槽位时一律改用具名 prop**——多个函数 children 的可读性极差，而且你失去了 prop 名带来的自文档化能力。

为什么没有专门语法，理由与具名插槽同一句：函数是 prop 的一种，而 prop 可以是任何值。但要注意行为差异：render prop 每次渲染都会创建**新的函数引用**，如果这个列表组件被 `memo` 包过，那个 prop 永远不相等，`memo` 直接失效（深入留给 [重渲染机制与性能](/react/re-render-performance)）。

## 父组件重渲染时，children 会不会重建

这是最容易写错的一节，先把结论摆出来，再交代哪些是官方原话。

**结论：** 谁在函数体里写下这段 JSX，这段 JSX 的元素对象就随谁的渲染而重建。

| 写法 | 元素在谁的渲染里创建 | 该组件自己 state 更新时 |
| --- | --- | --- |
| `<Layout>{content}</Layout>`，`content` 来自 `Layout` 内部 state | 子组件自己 | 重建，子树照常重新渲染 |
| `<Layout><Panel /></Layout>`，写在父组件里 | 父组件 | `Layout` 自己的 state 变化时，`children` 引用不变，Panel 子树不用重渲染 |
| 同上，但**父组件**自己重渲染 | 父组件 | `children` 是新建的元素对象，Panel 会被重新渲染（除非 Panel 自身 `memo`） |

第二行的机制有官方原话支撑，`memo` 参考页在讲「什么时候不需要 memo」时写道：当一个组件在视觉上包裹其他组件时，让它接受 JSX 作为 children，这样「当包装组件更新自己的 state 时，React 知道它的 children 不需要重新渲染」。第三行是同一句话的反面，也是「把 children 当银弹」的人最常见的误解：**children 保的是「上层没重渲染」这一侧，不是下层自己的 state**。

[用 Context 深层传递数据](https://react.dev/learn/passing-data-deeply-with-context)那页给的是同一条规则的另一种用法：中间层组件如果只负责把 props 往下转发、自己不用，就把中间层抽出来、让消费组件作为 `children` 渲染进去，减少「state 变化的组件」与「真正需要更新的组件」之间的层数。

Vue 侧的对照概念：插槽内容在**父组件的渲染作用域**里编译（官方插槽文档明确这一点），因此父组件重渲染时插槽内容也随之更新；子组件内部状态变化不会重渲染插槽内容。两套模型在这一点上结论一致，但 React 是靠「元素对象引用」实现，Vue 是靠「渲染 effect 的归属」实现。

<Callout type="unverified" title="本节的核实边界">

**已核实**（2026-10-17，react.dev）：`memo` 用 `Object.is` 逐个浅比较 props；「包裹型组件应接受 JSX 作为 children，包装组件更新自身 state 时 React 知道 children 不需要重渲染」这句原文；Context 变化时 `memo` 挡不住消费者更新；`passing-data-deeply-with-context` 里「用 children 抽出中间层」的建议。**未逐字核实**：「children 元素引用不变 → React 直接跳过整棵子树（bailout）」这一实现层的因果链，以及上表第三行的具体调度行为。请在自己的项目里用 React DevTools Profiler 的「why did this render」实测，以官方文档与实测为准。Vue 侧插槽更新的触发归属同理，请以[官方插槽文档](https://cn.vuejs.org/guide/essentials/slot.html)为准。

</Callout>

## className 与 style：没有自动透传这回事

Vue 有 fallthrough attributes：父组件传下来的 `class`、`style`、未在 props 里声明的属性，默认自动合并到子组件的**根元素**上，`class` 是拼接而不是覆盖。React **完全没有这套默认行为**，你必须自己写：

```tsx
import { clsx } from 'clsx';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
}

function Button({ variant = 'primary', className, style, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}                                  // 先展开外部属性
      className={clsx('btn', `btn-${variant}`, className)}   // 再显式合并 class
      style={{ fontWeight: 600, ...style }}                   // style 手动合并，外部优先
    >
      {children}
    </button>
  );
}
```

三个必须记住的点：

1. **顺序决定谁赢。** `{...rest}` 写在 `className` 之前，`className` 这个显式属性才会覆盖 rest 里的同名值；反过来写，你内部的 `btn btn-primary` 会被外部值整个替换掉，组件样式全崩。Vue 里 class 合并由框架负责，React 里合并是你写的那个模板字符串。
2. **字符串拼接要防 `undefined`。** `` `${className} ${internal}` `` 在 `className` 缺省时得到 `"undefined btn"`，虽然浏览器会忽略非法类名，但属性值脏了、自动化测试的类名断言也会挂。要么给解构默认值 `className = ''`，要么用 `clsx` / `tailwind-merge`（后者还能解决 Tailwind 同类冲突工具类的覆盖方向问题）。
3. **`extends React.ButtonHTMLAttributes<HTMLButtonElement>` 是「透传」的类型基础**，它让调用方能传 `type`、`aria-*`、`data-*`、`onClick` 而 TS 不报错。Vue 里这件事由 `$attrs` 免费提供。

`style` 是对象而不是字符串（`style={ { marginTop: 16 } }`，外层是 JSX 插值、内层是对象字面量，键名用驼峰），这一条属于 JSX 基础，见 [JSX 与模板的对照](/react/jsx)。需要把 DOM 节点交出去（`ref` 透传）时要 `forwardRef`，那是第 10 章的内容。

## 受控组件：一对 prop 代替 v-model

`v-model` 是语法糖（`:model-value` + `@update:model-value`）。React 没有语法糖，约定是**一对 prop**：`value` 加 `onChange`，值由父组件持有，子组件只负责上报。

```tsx
function Rating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      min={1}
      max={5}
      value={value}                    // 不给 value 就是「非受控」，行为完全不同
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
```

受控 / 非受控的取舍、和 `v-model` 修饰符（`.lazy`、`.trim`、`.number`）的对应在[useRef 与受控组件](/react/refs-and-forms)里展开，这里只标注：`value` 传了却不传 `onChange`，React 会在开发环境警告「输入框被锁定」，因为它知道用户永远改不动这个值。

## 组件设计原则：共通部分与 React 特有的组合风格

共通的部分和框架无关，两条对照下来完全一致：接口要清晰（组件外部不该需要知道内部结构）、不依赖父组件内部（别指望 `parent.$el` / 别指望父组件的 class 名）、prop 数量是坏味道（**本站阈值：单个组件的 props 超过 6–7 个，或者出现 `showXxx` / `xxxTitle` / `xxxButton` 这类「用 prop 模拟插槽」的布尔与字符串组合，就该拆组件或改用 children**）、容器组件与展示组件分离（容器管数据与回调，展示管结构）。

React 特有的两种风格值得单独学，因为它们在 Vue 里没有直接对应物。

**其一：用 children 做布局组件。** `<PageLayout sidebar={...}>{content}</PageLayout>` 这类写法把「结构」交给调用方决定，封装组件只提供 CSS 骨架。Vue 也能这么干，但要靠 `v-slot` 声明；React 里它是最自然的默认写法，所以「组件接收 children」几乎成了一种语言层面的礼貌。

**其二：复合组件（compound components）。** 用一个共享 Context 把一组必须配合使用的组件连起来，`Tabs.List`、`Tabs.Item`、`Tabs.Panel` 各自渲染自己那一小块，父子关系通过 Context 而不是通过 props 链传递。下面是一个可直接使用的实现：

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react';

interface TabsState {
  value: string;
  select: (v: string) => void;
}

const TabsContext = createContext<TabsState | null>(null);

function useTabs(who: string): TabsState {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`${who} 必须写在 <Tabs> 内部`);
  return ctx;
}

function useUncontrolledValue(propValue: string | undefined, defaultValue: string) {
  const [inner, setInner] = useState(defaultValue);
  return [propValue ?? inner, setInner] as const;
}

interface TabsProps {
  value?: string;                    // 传了就是受控，不传用 defaultValue 自管
  defaultValue?: string;
  onChange?: (v: string) => void;
  children: ReactNode;
}

function TabsRoot({ value, defaultValue = '', onChange, children }: TabsProps) {
  const [inner, setInner] = useUncontrolledValue(value, defaultValue);
  const current = value ?? inner;

  function select(next: string) {
    setInner(next);
    onChange?.(next);
  }

  return (
    <TabsContext.Provider value={{ value: current, select }}>
      <div className="tabs">{children}</div>
    </TabsContext.Provider>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <div className="tabs-list" role="tablist">
      {children}
    </div>
  );
}

interface ItemProps {
  value: string;
  children: ReactNode;
}

function Item({ value, children }: ItemProps) {
  const { value: current, select } = useTabs('Tabs.Item');
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? 'tab tab-active' : 'tab'}
      onClick={() => select(value)}
    >
      {children}
    </button>
  );
}

function Panel({ value, children }: ItemProps) {
  const { value: current } = useTabs('Tabs.Panel');
  if (current !== value) return null;
  return <div className="tab-panel" role="tabpanel">{children}</div>;
}

export const Tabs = Object.assign(TabsRoot, { List, Item, Panel });
```

```tsx
<Tabs defaultValue="list">
  <Tabs.List>
    <Tabs.Item value="list">列表</Tabs.Item>
    <Tabs.Item value="stats">统计</Tabs.Item>
  </Tabs.List>
  <Tabs.Panel value="list"><TodoList todos={todos} onToggle={toggle} /></Tabs.Panel>
  <Tabs.Panel value="stats"><Stats rows={rows} /></Tabs.Panel>
</Tabs>
```

读这段代码要抓三件事：**`Object.assign` 把子组件挂到根组件的属性上**（`Tabs.List` 是普通静态属性；TypeScript 里更严谨的写法是给根组件加命名空间或显式接口，上面这种写法在 TSX 里可直接使用）；**面板与标签的父子关系不靠层级 prop 传，而靠 Context**——这正是 [Context](/react/context) 一章要正式讲的模式；**`value` / `defaultValue` 二选一是复合组件最常见的接口设计**，让同一组件既能受控也能自管。

## key 强制重挂载：重置状态的正确手段

需求：切换查看的用户变了，编辑表单要清空。Vue 里你会用 `key` 或 `v-if` 让组件销毁重建；React 里 `key` 是同一招，而且官方在「你可能不需要 Effect」里明确把它列为**替代 effect 重置状态**的做法（原文示例就是给 `<Profile>` 传 `key={userId}`，别写 `useEffect(() => setComment(''), [userId])`）。

```tsx
// React：key 变化 = 卸载旧实例 + 挂载新实例，内部 state 自然归零
<CommentForm key={userId} userId={userId} onSubmit={submit} />
```

```vue
<!-- Vue：同一位置 key 变化会复用实例并只更新 props；要重建通常靠切位置或 v-if -->
<CommentForm v-if="userId" :user-id="userId" @submit="submit" />
<CommentForm :key="userId" :user-id="userId" @submit="submit" />
```

两边的差别在「触发重建的条件」：Vue 只有在**同一位置**的 key 变化时才复用，而它的组件实例复用策略与 React 的协调算法并不完全相同；React 里 key 变化一定销毁该子树的状态。别把这招用滥——key 变化会丢焦点、丢滚动位置、丢正在进行的动画，把 `key` 绑在一个每秒都变的值上等于每帧重新挂载整棵表单。React 官方给的另一个手段是给组件传 `resetKey` 之类的 prop、并在渲染期比较前后值来重置 state（`if (prevUserId !== userId) setDraft('')` 这种「渲染期间更新 state」的写法是文档认可的特例），但本站的实践排序是：**能用 key 解决就用 key，实在不想丢全部状态才在渲染期调整。**

## memo 的入口：props 引用不变才有意义

一句话预告，深入在第 7 章：`memo` 用 `Object.is` 逐个浅比较 props，因此**传下去的函数与对象必须是引用稳定的**才有意义。`onTodoAdd={() => {}}` 和 `items={[...]}` 这种写在 JSX 里的字面量每次渲染都是新对象，`memo` 会被完全绕过。同一件事的另一面：`memo` 也挡不住 Context 变化引起的消费者更新——官方 caveats 里写得很直白。

## 常见反模式与判据

| 反模式 | 为什么坏 | 怎么改 |
| --- | --- | --- |
| 把 `setTodos` 直接传下去让子组件改父状态 | 写入点散落在整个树里，无法审计；子组件与父组件的 state 形状耦合 | 传**语义回调**：`onTodoAdd={(text) => addTodo(text)}`，父组件内部怎么改由父决定 |
| 把整个 store / 巨型对象当 prop 往下传 | 任意字段变化都让所有下游 `memo` 失效；组件接口失去自文档化 | 拆细：只传组件真正读的那几个字段；跨层级用选择器或 [Zustand/Redux](/react/state-management) |
| props drilling（一层层转发同一个 prop） | 中间层被无关 prop 污染，改一个字段要动四个文件 | **判据见下** |
| 用一堆布尔/字符串 prop 模拟插槽 | 接口随需求线性膨胀，样式仍不可控 | 改成 `header={<...>}` / `footer={<...>}` 传元素 |
| 子组件里 `props.list.push(x)` | 直接改父数据；React 看不到引用变化，不重渲染 | 不可变更新，见 [useState 与不可变更新](/react/state) |
| 用 `useEffect` 把 props 复制进本地 state | 多一次渲染、状态可能不同步 | 直接用 props；真要重置就用 `key` |

props drilling 的判据（与第 6 章衔接）：

| 情况 | 该不该上 Context |
| --- | --- |
| 主题、语言、当前登录用户、设计令牌，穿过 2 层以上给多个叶子用 | 该 |
| 只有一个消费者，中间只有一层转发 | 不该，继续传 prop，数据流显式更好读 |
| 频繁变化的业务数据（列表内容、表单字段） | 不该，Context 变化会更新所有消费者（见 [Context](/react/context)） |
| 回调只是「子改父」的通道 | 不该，这是 prop 的本职工作 |

## 常见错误与排查

1. **`props.onTodoAdd is not a function`。** 现象：点按钮崩。原因：调用方漏传，或 prop 名大小写写错（`onTodoadd` 与 `onTodoAdd`）。怎么确认：在子组件第一行 `console.log(Object.keys(props))`，或直接看 TS 报错——如果类型里加了 `?`，编译期不会拦你。怎么修：把必填 prop 的 `?` 去掉，让编译期报错；确实可选时用 `onTodoAdd?.()`。
2. **切换数据后组件里的旧内容还在（表单残留、滚动位置错乱）。** 原因：位置相同、类型相同 → React 复用实例，内部 state 不重置。怎么确认：在组件里 `console.log('mount')` 加 effect 清理，看它是否只挂载过一次。怎么修：给该元素加会随数据变化的 `key`。
3. **`Type '...' is not assignable to property 'children'`／`Property 'children' does not exist on type 'IntrinsicAttributes'`。** 原因：`Props` 接口里没声明 `children`。怎么确认：看报错是不是指向嵌套写法。怎么修：加 `children?: ReactNode`；如果你**故意**不希望这个组件接收 children（比如 `icon`），那就保留报错，改用别的 prop 传内容。
4. **外部传的 className 不生效／组件样式被覆盖。** 原因：内部 `className` 直接写死，或 `{...rest}` 展开顺序不对。怎么确认：浏览器 devtools 看元素上实际的 class。怎么修：`clsx` 合并，显式属性放在展开之后。
5. **默认值在传 `null` 时不生效。** 现象：`emptyText = '暂无待办'`，父组件传 `emptyText={null}`，结果渲染出 `null` 的空白。原因：解构默认值只对 `undefined` 生效（官方明确这一点）。怎么确认：`console.log(emptyText)` 是 `null` 不是 `undefined`。怎么修：约定「不传 = 默认，`null` = 显式不显示」并写成 `emptyText === undefined ? DEFAULT : emptyText`，或统一只传 `undefined`。
6. **`memo` 加了完全没用。** 现象：性能没变化。原因：每次渲染都新建函数/对象当 prop。怎么确认：React DevTools Profiler 看该组件是否仍被标记为渲染。怎么修：`useCallback` / `useMemo` 稳定引用，或改传原始值；深入见[重渲染机制与性能](/react/re-render-performance)。
7. **列表插入一行后，每行的输入内容错位到别的行。** 原因：`key` 用了数组索引。怎么确认：只在中间删一项，看内容是否跟着错位。怎么修：用稳定的业务 ID 作 key；这是协调（reconciliation）问题，见第 11 章。
8. **把 Vue 的 emit 语法带过来。** 现象：写了 `props.emit('save')` 或 `@save={fn}`。原因：React 没有事件总线式 emit。怎么修：`onSave={fn}`，`fn` 是父组件的普通函数。

## 练习

<Exercise title="练习 1 · 把这段 Vue 写法翻译成 React 并说明行为差异" difficulty="基础">

把下面的 Vue 组件改写成 React（TSX），然后回答两点：向上通信的机制差异是什么？如果父组件给 `TodoItem` 传了 `class="row-current"`，两边的结果分别是什么？

```vue
<script setup>
defineProps({ done: Boolean, text: String });
defineEmits(['toggle', 'remove']);
</script>

<template>
  <li class="row">
    <input type="checkbox" :checked="done" @change="$emit('toggle')" />
    <span>{{ text }}</span>
    <button @click="$emit('remove')">删除</button>
  </li>
</template>
```

<template #answer>

```tsx
interface Props {
  done: boolean;
  text: string;
  onToggle: () => void;
  onRemove: () => void;
}

export function TodoItem({ done, text, onToggle, onRemove }: Props) {
  return (
    <li className="row">
      <input type="checkbox" checked={done} onChange={onToggle} />
      <span>{text}</span>
      <button type="button" onClick={onRemove}>删除</button>
    </li>
  );
}
```

行为差异：Vue 的 `$emit` 走组件自己的事件系统，父组件不监听就没人收，子组件不需要知道接收方是谁；React 必须**由父组件显式把函数交下来**，`onToggle` 缺失时子组件调用会直接崩，所以接口里要不要加 `?` 是一个必须做出的决定。另外注意 `:checked` 对应 `checked`（不是 `defaultChecked`，那是非受控写法）。

class 那一问：Vue 的 fallthrough attributes 会把 `row-current` **自动合并**到根元素 `li` 上，得到 `class="row row-current"`；React 里没有自动合并，这个 `className` 会落在 `props` 上而被组件忽略，除非组件自己解构 `className` 并合并。这也是为什么组件库里到处是 `clsx`。

</template>

</Exercise>

<Exercise title="练习 2 · 具名插槽与作用域插槽的等价改写" difficulty="进阶">

Vue 侧模板是这样用的：`<Modal><template #title>确认删除</template><template #body="{ close }"><button @click="close">取消</button></template></Modal>`。写出 React 的等价 `Modal` 组件与调用代码，并说明调用方传的 `close` 在 React 里从哪来。

<template #answer>

```tsx
import type { ReactNode } from 'react';

interface ModalProps {
  title?: ReactNode;
  body: (ctx: { close: () => void }) => ReactNode;   // 作用域插槽 → render prop
  onClose: () => void;
}

function Modal({ title, body, onClose }: ModalProps) {
  return (
    <div className="modal" role="dialog">
      <header className="modal-title">{title ?? '提示'}</header>
      <div className="modal-body">{body({ close: onClose })}</div>
      <footer className="modal-foot">
        <button type="button" onClick={onClose}>关闭</button>
      </footer>
    </div>
  );
}

<Modal title={<h2>确认删除</h2>} body={({ close }) => <button onClick={close}>取消</button>} onClose={closeModal} />
```

`title` 对应具名插槽：调用方写下的 JSX 元素在**调用方的渲染函数**里求值，直接作为 prop 传入。`close` 不是插槽作用域对象，而是 `Modal` 在调用 `body(...)` 时**作为参数交出去**的普通值——这就是作用域插槽在 React 里的全部实现原理：子组件调用父组件给它的函数，并把上下文当参数传。副作用是 `body` 每次渲染都是新函数引用，配合 `memo` 时要留意。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释报错" difficulty="挑战">

下面代码在 TypeScript + React 19 下会出什么问题？逐条说明报错或异常行为，给出修法。

```tsx
interface Props { items: string[]; onPick(id: string): void; count?: number }
Props.defaultProps = { count: 0 };

function Box({ items, onPick, children }: Props) {
  return (
    <div className={children}>
      {items.map((id, i) => <button key={i} onClick={() => onPick(id)}>{id}</button>)}
    </div>
  );
}
```

<template #answer>

四处。

1. `Props.defaultProps`：`Props` 是 interface（类型），不是值。运行时不存在这个对象，TS 直接报「Props 仅指类型」一类错误。就算写成 `Box.defaultProps`，React 19 也已经从函数组件移除了 `defaultProps`，`count` 依然是 `undefined`。修法：`count = 0` 解构默认值。
2. `children` 不在 `Props` 里却使用了 → TS 报属性不存在。修法：接口加 `children?: ReactNode`。
3. 更隐蔽的行为 bug：`className={children}` 把渲染内容当成类名字符串塞进 class 属性，得到 `className="[object Object]"` 之类的垃圾值，且 div 里根本没有渲染 children，内容凭空消失。修法：`className={clsx('box', className)}`，body 里放 `{children}`。
4. `key={i}` 用索引：中间删一项时所有后续项错位复用（内容错位，若有输入框则状态跟着跑）。修法：用业务 ID 作 key。

</template>

</Exercise>

<Exercise title="练习 4 · 预测 children 的重渲染" difficulty="挑战">

`Shell` 内部有一个 `useState` 的计数器，点击按钮会 `setCount`。调用方写成 `<Shell><Heavy /></Shell>`。第一次点击按钮时，`Heavy` 的函数体会执行吗？如果调用方自己因为某个 state 变化而重渲染呢？

<template #answer>

第一次点击：不会。`Heavy` 这个元素是在调用方的函数体里创建的，`Shell` 自己的 state 更新只重跑 `Shell`，`props.children` 引用的仍是同一个元素对象，React 不需要重渲染那棵子树（`memo` 参考页对这个用法给了原话）。

第二种情况：调用方重渲染 → 它的函数体重新执行 → `<Heavy />` 这个元素对象是**新创建**的，`Shell` 收到新的 `children`，于是 `Heavy` 也会重新渲染；此时只有给 `Heavy` 包 `memo`（且它的 props 引用稳定）才能跳过。

一句话记住：**children 保护的是「创建它的那一层没有重渲染」，不是「它被放在了 children 里」。** 具体调度行为请在你的项目里用 Profiler 实测确认，见上文 unverified 说明。

</template>

</Exercise>

<Exercise title="练习 5 · 接口设计取舍" difficulty="进阶">

你要写一个 `DataTable` 组件，需求：可自定义空状态、可自定义每行的操作区、表头由数据推导、支持行点击。列出你会暴露的 props（含类型），并说明哪几项如果写成布尔 prop 会变成反模式。

<template #answer>

```tsx
interface DataTableProps<T extends { id: string }> {
  rows: T[];
  columns: Column<T>[];                 // 表头由数据推导 → 交给调用方描述，不硬编码
  empty?: ReactNode;                    // 空状态：传元素，不给布尔 showEmpty
  renderActions?: (row: T) => ReactNode; // 行操作区：render prop，不用 slot
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
}
```

如果改成 `showEmpty` / `showActions` / `actionsLabel` / `emptyText`，就是在用 prop 模拟插槽：每加一个显示需求就要改组件源码，调用方永远只能得到你预设的那一种空状态。判据是「调用方需要的**结构**自由还是**文案**自由」——需要结构自由就用 `ReactNode` / render prop，只有文案自由（如 `emptyText`）时字符串 prop 可接受。另外注意 `onRowClick` 与行内操作按钮要处理事件冒泡（在操作区里 `e.stopPropagation()`），否则点删除会同时触发行点击。

</template>

</Exercise>

## 官方文档与延伸阅读

- [将 Props 传递给组件](https://react.dev/learn/passing-props-to-a-component) —— 核实本章三件事：props 是 immutable / read-only snapshots；默认值的官方写法是解构默认值；「nested JSX 会进 `children` 这个 prop」。
- [你可能不需要 Effect](https://react.dev/learn/you-might-not-need-an-effect) —— 核实「prop 变化时重置状态应改用 `key`」这一条，以及不要在 effect 里通知父组件。
- [`memo` 参考](https://react.dev/reference/react/memo) —— 核实 `Object.is` 浅比较、「包裹型组件应接受 JSX 作为 children」这句话、以及 memo 挡不住 Context 变化。
- [使用 Context 深层传递数据](https://react.dev/learn/passing-data-deeply-with-context) —— 核实「用 children 抽出中间层组件」的建议与「别因为要传几层就用 Context」。
- [React 19 升级指南](https://react.dev/blog/2024/04/25/react-19-upgrade-guide) —— 核实函数组件的 `defaultProps` 已移除、字符串 ref 已移除。
- [在 JSX 中书写标记](https://react.dev/learn/writing-markup-with-jsx)、[响应事件](https://react.dev/learn/responding-to-events) —— 核实 `className`、`style` 对象写法与事件名差异。
- [Vue 组件基础](https://cn.vuejs.org/guide/essentials/component-basics.html)、[插槽](https://cn.vuejs.org/guide/essentials/slot.html)、[响应式深入](https://cn.vuejs.org/guide/extras/reactivity-in-depth.html) —— Vue 侧对照依据：props 代理、插槽渲染作用域、fallthrough attributes。核实时间 2026-10-17。

## 下一章

这一章把「组件之间的接口」讲完了：值往下传、函数往下传、JSX 往下传，React 没有 emit 也没有 slot。但它没有回答一个更难的问题——**组件与外部世界（DOM、订阅、网络、第三方库）之间怎么接**。Vue 里你多半用 `watch` 或 `watchEffect` 来做这件事，而在 React 里对应的那个 API 叫 `useEffect`，它和 `watch` 只是名字长得像：它不是「侦听数据变化」，而是「在渲染提交之后与外部系统同步」。把 `watch` 的直觉套到 `useEffect` 上，就是 React 新手最贵的一个坑，会产生重复请求、竞态和无限循环。下一章 [useEffect 与 watch 的对照](/react/use-effect)专门拆这件事；在那之前，如果你还没建立「渲染 → 提交 → 副作用」的三阶段模型，先回去读[两套渲染模型](/react/two-rendering-models)。
