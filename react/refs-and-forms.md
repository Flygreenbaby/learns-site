# useRef 与受控组件：为什么 React 每敲一个字都要重新渲染

四个真实故障，都发生在「一个输入框」上。

**故障一：中文输入到一半，候选词框自己消失了。** 搜索框是受控的，`onChange` 里 `setKeyword(e.target.value)`，另外顺手做了 `trim`。用拼音打「会议」，刚敲下 `hui`，输入框的值被 React 回写成别的东西，输入法的组合（composition）状态被打断，候选词整排没了。改成不做 `trim` 就好了一半，另一半要靠 `onCompositionStart` / `onCompositionEnd`。

**故障二：输入框变成只读的，一个字都打不进去。** 有人说「受控组件每次键入都重渲染，太浪费」，于是把 `const [name, setName] = useState('')` 换成 `const nameRef = useRef('')`，然后写 `value={nameRef.current}`。页面看起来是个输入框，实际敲不进任何东西——因为 React 会把 `value` 强制回成你传的那个值，而你传的那个值永远不会自己变。官方文档的措辞很直接：**如果你传 `value` 而不传 `onChange`，将无法在输入框里输入内容**（见下方核实口径）。

**故障三：编辑页偶发报「组件从非受控变成了受控」。** 数据从接口来，首帧 `draft` 还是 `undefined`，于是渲染出 `value={undefined}`；接口回来后渲染出 `value="会议记录"`。React 明确禁止这种切换——**`value` 不能先是 `undefined` 后变成字符串**，官方给的修法是把 state 初始化成空字符串。把这段逻辑搬到 React 之前，你大概已经在 Vue 里用 `v-model="form.title"` 躲过了这一课，因为 Vue 不存在「受控/非受控」这个二元状态。

**故障四：`v-model.trim.lazy` 在 React 里没有对应物。** Vue 里一行搞定的「失焦才同步、顺手去空格、数字自动转型」，到 React 只能自己写；而随手写在 `onChange` 里的 `trim` 会带来一个新 bug——用户打「买 牛奶」时中间那个空格永远打不出来。

这一章把四件事说清：`useRef` 到底是什么盒子、受控组件为什么是 React 的默认形态（而不是一个可选优化）、`v-model` 那一整套语法糖在 React 里怎么一块块补回来、以及表单校验为什么要自己搭或引库。前置：[useState 与不可变更新](/react/state)、[props、回调与 children](/react/props-and-children)、[重渲染机制与性能](/react/re-render-performance)；Vue 侧对照见[v-model 与表单输入](/vue/template-syntax)和[组件双向绑定 `defineModel`](/vue/components)。

<Callout type="info" title="本章的核实口径">

`useRef` 的签名与语义（返回带 `current` 的普通对象、`initialValue` 只在首次渲染生效、每次渲染返回同一个对象实例、改 `current` 不触发渲染、「不要在渲染期读写 ref」、不要在自定义组件上直接挂 ref 而要子组件接收 `ref` prop、昂贵初始化用 `if (ref.current === null)` 惰性赋值）在 2026-10-17 对照 [useRef 参考](https://react.dev/reference/react/useRef) 核实。

受控/非受控这一半对照 [input 组件参考](https://react.dev/reference/react-dom/components/input) 核实：`value`（受控）与 `defaultValue`（非受控）二选一且**一个输入框终身只能选一种**、`onChange` 在用户每次修改时立即触发（等价于原生 `input` 事件，逐键触发）、`value` without `onChange` 会让输入框无法输入、复选框用 `checked` / `defaultChecked` 且要读 `e.target.checked`、`value` 传 `undefined` 后再传字符串会报错（应初始化为空串）、官方建议的性能优化是**把输入 state 移到独立组件**或用 `useDeferredValue`、`required` / `pattern` / `min` / `max` / `readOnly` 这些约束属性照常生效。

本站环境是文档站，React 代码无法运行，本章所有示例都是静态推演，**不声称实测**；涉及输入法、版本差异的地方单独标注。

</Callout>

## useRef 的真实身份：一个跨渲染的同一个对象

先把签名钉死：

```tsx
const ref = useRef(initialValue);   // 返回 { current: initialValue }
```

它返回的是**一个普通 JavaScript 对象**，React 不参与它的读写。三条保证与三条非保证：

| 关于 useRef | 结论 |
| --- | --- |
| 每次渲染拿到的还是不是同一个对象 | **是**，官方明确「在后续每次渲染时都返回同一个对象实例」 |
| `initialValue` 每次渲染都会传吗 | 参数每次都被求值，但**只有首次渲染用它**；后续渲染的实参被忽略（副作用：`useRef(new VideoPlayer())` 每帧都真的 `new` 一遍，只是结果被丢掉） |
| 改 `ref.current` 会触发渲染吗 | **不会**。React 不知道也不关心 |
| 组件重渲染后 `ref.current` 会重置吗 | 不会，只要组件实例没被卸载（卸载后这个盒子也没了） |
| 组件用 `key` 换了身份后会怎样 | 整个组件实例卸载重建，ref 回到 `initialValue` |
| 兄弟组件能共享这个盒子吗 | 不能。它是**每个组件实例私有**的，跨组件共享得靠 Context 或 store（[Context](/react/context)） |

对照 Vue：这三条保证里，只有「DOM 引用」那一半和 Vue 的模板引用（template ref）对得上；「跨渲染保存可变值」这一半在 Vue 里**根本不需要 API**——因为 `setup` 只执行一次，闭包里的 `let` 天然跨渲染存活。这就是第 1 章那条根本差异（[两套渲染模型](/react/two-rendering-models)）在表单场景里第一次咬人。

## 用途一：拿 DOM 节点

React 的写法是「创建一个盒子，把它作为 `ref` 属性挂到 JSX 上，React 在挂载后把 DOM 节点塞进 `current`，卸载时塞回 `null`」：

```tsx
function SearchBox() {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <input ref={inputRef} type="search" placeholder="搜索待办" />
      <button onClick={() => inputRef.current?.focus()}>聚焦</button>
    </div>
  );
}
```

`inputRef.current?.focus()` 那个问号不能省：`current` 的类型是 `HTMLInputElement | null`，卸载后就是 `null`。这是 TypeScript 帮你把「DOM 还没挂上就调用」这一整类 bug 变成编译错误，比 Vue 里 `username.value?.focus()` 需要你自己记住「模板引用在 `onMounted` 之前是 null」要显式一些。

| 需求 | Vue 3 | React |
| --- | --- | --- |
| 拿到某个 DOM 元素 | 模板写 `ref="username"`，`useTemplateRef<HTMLInputElement>('username')`（Vue 3.5+；更早版本靠同名 `ref` 变量自动绑定） | `const ref = useRef(null)` + `<input ref={ref} />` |
| 值的类型 | 只读的浅响应式引用（`Readonly<ShallowRef<T | null>>`） | 可变的普通对象 `{ current: T | null }` |
| 元素在 `v-if` 分支里刚出现 | 模板引用本身是响应式的，`watch(elRef, …)` 能等到 | 不会通知你；只能靠 effect 依赖变化后再读，或给子组件回调 |
| `v-for` / `map` 里的一组元素 | 模板引用是数组（顺序不保证与数据一致） | 需要给每行一个 ref（常见做法：回调 ref 写进一个 `Map`，或干脆把行做成组件、各行自己持有 ref） |
| 拿组件实例的方法 | `defineExpose({ focus })` + 父级调用 | 子组件接收 `ref` prop 往下透传，或用 `useImperativeHandle`（见下一节） |

Vue 侧那套「模板引用恒为 null」「`v-for` 引用顺序不保证」的坑，在[生命周期、模板引用与依赖注入](/vue/lifecycle-and-inject)里已经列过；React 这边对应的坑是「`current` 在首次渲染时是 null」，两个框架都必须**等提交之后**才有真节点，区别只是 Vue 用响应式通知你、React 不通知。

## 用途二：跨渲染但不触发重渲染的容器

第二个用途才是 React 特有的东西。官方给的典型场景是计时器 id：

```tsx
function Stopwatch() {
  const intervalRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  function start() {
    if (intervalRef.current !== null) return;        // 防止重复开启
    const startedAt = Date.now();
    intervalRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
  }

  function stop() {
    if (intervalRef.current === null) return;
    window.clearInterval(intervalRef.current);
    intervalRef.current = null;                       // 盒子清空，但界面不用重渲染
  }

  return (
    <div>
      <span>{elapsed}s</span>
      <button onClick={start}>开始</button>
      <button onClick={stop}>停止</button>
    </div>
  );
}
```

`elapsed` 用 state（要显示），`intervalRef` 用 ref（不显示、只需要跨渲染存活）。把这条判据背下来：**值出现在界面上 → state；值只被逻辑读写 → ref；值既被逻辑读写又要触发重算 → 还是 state，用别的手段控制渲染范围（[重渲染机制与性能](/react/re-render-performance)）。**

同一份需求在 Vue 里是零 API 的：

```vue
<script setup lang="ts">
import { ref } from 'vue';

const elapsed = ref(0);
let intervalId: number | null = null;   // setup 只跑一次，普通变量天然跨渲染
</script>
```

这个对照表值得反复看：

| 需求 | Vue 写法 | React 写法 | 差异成因 |
| --- | --- | --- | --- |
| 跨渲染的可变值 | `setup` 里一个 `let` | `useRef` | 组件函数每帧重跑 vs `setup` 一次性 |
| 改了值要让界面跟上 | `ref()` 包起来，自动追踪 | 只能 `useState` | 依赖追踪 vs 显式重渲染 |
| 改了值但不让界面跟上 | 非响应式 `let` | `useRef` | 同上 |
| 记「上一次的值」 | `watch` 的 `oldValue` 参数 | 自己 `const prevRef = useRef(v)`，渲染后期或 effect 里写回 | 侦听器是一等公民 vs 没有 |

最后一行的诱惑很大：**把 props 复制进 ref 然后在 effect 里读**，用来「绕过」依赖检查。这是错的，[useEffect 与 watch 的对照](/react/use-effect)那条「隐式依赖比过期值更难查」说的就是它。

## 渲染期不读不写 ref：这是纯度要求，不是洁癖

官方在 `useRef` 页把这条写得很硬：**不要在渲染过程中读写 `ref.current`**，组件应当是纯函数；违反它会让行为不可预测，并且与新特性（并发渲染、服务端渲染相关能力）不兼容。

```tsx
// ❌ 渲染期写：这一帧被双调用、被打断、被重放时结果就变了
function Bad({ value }: { value: number }) {
  const historyRef = useRef<number[]>([]);
  historyRef.current.push(value);          // 副作用混进渲染
  return <p>{value}</p>;
}

// ✅ 放到事件处理器或 effect 里
function Good({ value }: { value: number }) {
  const historyRef = useRef<number[]>([]);
  useEffect(() => { historyRef.current.push(value); }, [value]);
  return <p>{value}</p>;
}
```

为什么 Vue 里没这一课：Vue 的 `setup` 只跑一次，你在里面写的语句本来就不是「渲染」；Vue 真正的渲染函数由编译器生成，你极少手写。React 的组件函数**就是**渲染函数，跑几遍、什么时候跑、跑完丢不丢结果，都由调度器决定，不是你决定。

唯一的例外是官方自己给的惰性初始化写法：

```tsx
const playerRef = useRef<VideoPlayer | null>(null);
if (playerRef.current === null) playerRef.current = new VideoPlayer();
```

这不违反纯度（只在「还没有」时赋值，重复执行得到同一个结果），但省掉了每次渲染 `new` 一遍的浪费——这是把 `useRef(new VideoPlayer())` 的隐藏开销修掉的标准做法。

还有一个「看起来必须渲染期读 ref」的场景：**根据当前 props 显示一个计数**。正确解法不是读 ref，而是重新设计状态——要么它进 state，要么它就是派生值直接算。渲染期读 `ref.current` 会让「同一个 props 渲染两次得到不同 UI」，而这正是并发渲染与服务端渲染/水合最不能容忍的事（第 11 章会把这个要求推到全局）。

## 把 DOM 句柄交给父组件：ref 作为 prop 与 useImperativeHandle

React 的默认规则：**你不能把 ref 直接挂到自定义组件上拿到它的 DOM**（挂上去拿到的是 null 或报错），必须由子组件主动接收并往下透传：

```tsx
type MyInputProps = { value: string; onChange: (next: string) => void; ref?: Ref<HTMLInputElement> };

function MyInput({ value, onChange, ref }: MyInputProps) {
  return <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} />;
}

// 父组件
const inputRef = useRef<HTMLInputElement>(null);
<MyInput ref={inputRef} value={text} onChange={setText} />;
```

对照 Vue：Vue 的 `<script setup>` 组件**默认是私有的**，父级拿到的是 null，必须显式 `defineExpose({ focus })` 才暴露。两边方向刚好相反但结论一样：**暴露什么由子组件决定**（[组件基础](/vue/components)那条「`defineExpose` 里只放行为不放状态」在 React 里同样成立，对应写法是 `useImperativeHandle`：

```tsx
const MyDialog = forwardRef<DialogHandle, Props>(function MyDialog(props, ref) {
  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
    validate: () => currentErrors(),
  }), [/* 依赖 */]);
  // ...
});
```

<Callout type="warn" title="两种写法都活着，别猜版本">

「函数组件的 `ref` 直接作为 prop 接收」是较新版本 React 才有的形态，早期写法是必须包一层 `forwardRef`。你在存量项目里会同时看到两种。**动手前先看你的 React 版本与 [useRef 参考页](https://react.dev/reference/react/useRef) 当前的说法**，本站不给稳定版本号结论。判据很简单：如果 `<MyInput ref={r} />` 报 `Function components cannot be given refs`，说明这个项目还需要 `forwardRef`。

</Callout>

**更多时候你不需要把句柄交给父组件。** 受控组件本身就是更好的「接口」：父组件持有值，就不需要问子组件「你现在是什么」；需要「聚焦」这种动作时，再考虑 ref。这是 React 官方在 `useImperativeHandle` 页反复强调的取舍，和 Vue 社区里「能用 props 就别用 `$refs`」是同一句话。

## 受控组件为什么是默认形态：每个键入都是一次渲染

最小受控写法只有三行有效代码：

```tsx
function NameField() {
  const [name, setName] = useState('');
  return <input value={name} onChange={(e) => setName(e.target.value)} />;
}
```

机制是：React 把 `value` 当成「这个输入框应该显示什么」的唯一真相，用户敲一个字符，浏览器先改 DOM，`onChange` 立即触发（官方描述：fires immediately when the input's value is changed by the user，逐键触发），你的 state 更新，React 重新渲染并用 `value` **强制回写**。于是「输入一个字符」= 一次组件重跑。

这就是它成为默认形态的原因：**输入框的值和组件状态是同一份数据**，任何「界面显示了 A、state 里是 B」的可能都被这个回写循环消灭了。顺带你能免费拿到四件事：

| 你想要的 | 受控写法给你什么 | Vue 里的等价物 |
| --- | --- | --- |
| 即时校验、按钮禁用 | 渲染期直接读 `name` 算 | `computed` |
| 输入格式化（大写、金额千分位） | `onChange` 里转换后 setState | `v-model` + 自定义指令 / `watch` |
| 联动（选了「其他」才显示备注框） | 条件渲染，天然同步 | `v-if` + 同一个响应式值 |
| 程序化改值（一键清空、填充示例） | `setName('')` 界面立刻跟上 | 直接改 `ref` 值 |

关键对照，很多人学错重心：**Vue 的 `v-model` 在原生输入框上也是每次 `input` 事件都更新数据**（它绑的就是 `input`，不是 `change`）。所以「每个键入都改状态」不是 React 独有的开销。真正的差异在**渲染粒度**：

| 动作 | Vue（`v-model` 绑在 `TodoItem` 的输入框上） | React（受控 `input`） |
| --- | --- | --- |
| 敲一个字 | `input` 事件 → 写 `todo.text` → **只有读了这个值的组件**重渲染 | `onChange` → setState → **该组件函数重跑，并且整棵子组件跟着重跑**（除非 `memo` / state 下移） |
| 谁来阻止多余的渲染 | 依赖追踪自动做 | 你自己做：state 放低、`memo`、`useDeferredValue` |

所以「受控组件慢」这个说法是错的，准确说法是：**把输入框的 state 放在了太高的位置**。官方给的两条优化正是这个意思——把输入相关的 state 移进独立的小组件，或者用 `useDeferredValue` 让依赖它的重活延后渲染（对照实验见[重渲染机制与性能](/react/re-render-performance)）。

```tsx
// ✅ 输入框自己拥有一帧一帧的 state，页面级的重活延后
function SearchPage() {
  const [keyword, setKeyword] = useState('');
  const deferred = useDeferredValue(keyword);
  const results = useMemo(() => heavyFilter(allRows, deferred), [deferred]);
  return (
    <div>
      <input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      <ResultList rows={results} />
    </div>
  );
}
```

## v-model 的语法糖怎么补：修饰符与 defineModel 对照

Vue 侧把这一堆东西叫 `v-model` 的参数与修饰符，React 侧一个都没有。逐项翻译：

| Vue | 语义 | React 里的正确写法 | 别这么写 |
| --- | --- | --- | --- |
| `v-model="text"` | `modelValue` + `update:modelValue` / 原生元素上绑 `input` | `value={text}` + `onChange={(e) => setText(e.target.value)}` | `defaultValue` 配 `value`（混用直接报错） |
| `v-model.trim` | 失焦时去首尾空格 | 在 `onBlur` 里 `setName(v.trim())`；或提交前统一 `trim` | 在 `onChange` 里 `trim`：用户打「买 牛奶」时空格会消失，且光标可能跳 |
| `v-model.number` | 尝试 `Number()` 转型，失败保留原值 | `type="number"` + `Number(e.target.value)`，**并且自己处理空串**：`e.target.value === '' ? null : Number(...)` | 直接 `Number('')` → `0`，一个空输入框变成「金额为 0」 |
| `v-model.lazy` | 改绑 `change`（失焦才更新） | 本地 state + `onBlur` 才上报；或 `onChange` 只写本地、失焦提交 | 只在 `onSubmit` 读 DOM：你就失去了即时校验（那是非受控，见下一节） |
| `v-model` 上的 `.delay` / 防抖（Vue 3.4+ 的 defineModel 选项支持 `debounce`） | 延迟同步 | 自己写防抖：本地 state 立即更新、`useDeferredValue` 或 `setTimeout` 后上报 | 用 `onChange` 直接上报 + `useMemo` 试图不重渲染，防抖逻辑散落各处 |
| `defineModel<string>()` | 一行拿到可读写的双向绑定值 | `value` + `onChange` 两个 props 的**约定**；或自定义 Hook | 子组件偷偷 `useState(props.value)` 再各自演化（[useEffect 清单](/react/use-effect)第 2 条反模式） |
| `defineModel('title')` 具名双向 | prop 名与事件名成对 | `title` + `onTitleChange` 成对，两侧字面必须一致 | `title` + `onChange`（第 11 章的「名字对不上且不报错」Vue 同款） |
| `v-model` 绑复选框 | 布尔/数组 | `checked={done}` + 读 `e.target.checked` | 读 `e.target.value`（官方专门点名这条） |

`defineModel` 那一行的 React 等价物长这样——它不是框架能力，是你们团队要遵守的命名约定：

```tsx
type TitleFieldProps = {
  title: string;                       // 对应 prop: title
  onTitleChange: (next: string) => void;  // 对应 emit('update:title', next)
};

function TitleField({ title, onTitleChange }: TitleFieldProps) {
  const [local, setLocal] = useState(title);   // 本地先行：逐键响应
  useEffect(() => setLocal(title), [title]);   // 父级换了草稿才同步（可再讨论，见下）

  return (
    <input
      value={local}
      onChange={(e) => { setLocal(e.target.value); onTitleChange(e.target.value); }}
      onBlur={(e) => { const v = e.target.value.trim(); setLocal(v); if (v !== title) onTitleChange(v); }}
    />
  );
}
```

**父级直接把 state 交下来时，本地副本通常是不必要的**——`value={title} onChange={e => onTitleChange(e.target.value)}` 就够了，那个 `useEffect` 同步是多余的一次渲染往返（判断标准回指[你可能不需要 effect](/react/use-effect)）。留着它的唯一正当理由是：父级更新是异步/防抖的，而输入框必须逐键响应。这种「既要受控又要非受控」的中间形态，标准解法是一个小 Hook：

```tsx
function useControlled<T>(controlled: T | undefined, initial: T) {
  const [inner, setInner] = useState<T>(initial);
  const value = controlled === undefined ? inner : controlled;
  const setValue = (next: T) => { setInner(next); };
  if (controlled !== undefined) { /* 受控时以父级为准 */ }
  return [value, setValue, controlled !== undefined] as const;
}
```

这就是 React 生态里组件库通用的 `value` / `defaultValue` 二选一接口（[props、回调与 children](/react/props-and-children) 的复合组件一节提到过设计动机）；`useRef` 在这里的用途是「记录渲染间隔里 prop 有没有从有到无」，注意它依旧属于「不驱动 UI 的值」。

## 非受控 + ref：故意不用 state 的四种场景

非受控就是「让浏览器自己管这个输入框」：`defaultValue` 给初值，读值时通过 ref 或提交事件拿。官方立场是二选一且**不能中途切换**。

```tsx
function CreateTodoForm({ onCreate }: { onCreate: (input: TodoCreateInput) => void }) {
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();                      // 不写这一句：页面刷新，你什么都没了
    const data = new FormData(event.currentTarget);
    onCreate({
      title: String(data.get('title') ?? '').trim(),
      dueAt: String(data.get('dueAt') ?? '') || null,
    });
    event.currentTarget.reset();                 // 或者 formRef.current?.reset()
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <label htmlFor="title">标题</label>
      <input id="title" name="title" defaultValue="" required />
      <input id="dueAt" name="dueAt" type="date" />
      <button type="submit">新增</button>
    </form>
  );
}
```

`FormData` 是浏览器 API（[DOM 操作与事件系统](/javascript/dom-and-events)），字段靠 `name` 归集，所以 `name` 属性不能省。这套写法适合的场景很具体：

| 场景 | 为什么非受控更好 | Vue 里的习惯 |
| --- | --- | --- |
| 一次性提交、中途不需要反馈给界面（注册表单、搜索后跳转） | 不需要每键重渲染，代码也短 | `ref` 绑一个对象，提交时用 `formRef.value` |
| `<input type="file">` | 它的 `value` 是只读的，脚本不能赋文件进去（安全限制），只能读 `files` 或走 `FormData` | 同样只能非受控，`e.target.files` |
| 集成第三方控件（富文本、日期选择器、地图、图表） | 那个库自己维护一份 DOM/内部状态，React 每键回写 `value` 会和它打架 | 一样的处理：挂 ref，`onMounted` 里 `new` 实例，卸载时 `destroy`（[生命周期](/vue/lifecycle-and-inject)） |
| 超长列表里每行都有一个可编辑输入框（上千行） | 每键 setState 会让整表重跑；把值留在 DOM 里、批量提交时一次性读，能省掉大量渲染 | 通常还是 `v-model` 绑数组项（Vue 的细粒度追踪让它扛得住） |

**代价要写清楚**：非受控意味着 React 不知道当前值，于是即时校验、按钮禁用、格式化、跨字段联动都得靠额外 state 补回来——补到一定程度你就重写了受控组件。本站的口径：**默认受控；只有在上面四种场景里才选非受控。**

一个必须知道的组合风险：**列表的 `key` 用数组索引 + 行内输入框是非受控**，删一行之后 DOM 节点就地复用，输入框里残留的是上一项的内容。这是[重渲染机制与性能](/react/re-render-performance)那节讲过的错位事故，成因在「非受控的值存在 DOM 里，而 React 只重写它管理的属性」。

## 表单校验：React 什么都不给，你得选三档时机

Vue 生态里有 `vuelidate` / `vee-validate`，也有 `v-model` 直接把值和「是否摸过这个字段」的语义分开；React 官方只给你受控数据流，**校验被明确留给业务代码或第三方库**。这不是缺陷，是它「只渲染 UI」的定位。于是你要自己决定什么时候报错给用户：

| 时机 | 实现 | 体验 | 适用 |
| --- | --- | --- | --- |
| `onChange` 即时 | 每次键入都跑校验，直接显示错误 | 用户刚打第一个字母就告诉他「邮箱格式不对」，讨厌 | 长度上限、实时计数器、格式提示（不打断输入） |
| `onBlur` 后再显示 | 维护 `touched` 集合，只有摸过的字段才显示错误 | 主流折中 | 绝大多数表单 |
| `onSubmit` 才校验 | 提交时一次性算，错误全部冒出来 | 长表单滚下去才发现错 | 字段很少的表单、搜索框 |

规则和状态分开写，是这个章节唯一值得抄的东西：

```ts
// validators.ts —— 纯函数，不依赖 React，可单测
export type Draft = { title: string; dueAt: string; tags: string };
export const MAX_TITLE = 80;

export function validateTodoDraft(draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = draft.title.trim();
  if (title === '') errors['title'] = '标题不能为空';
  else if (title.length > MAX_TITLE) errors['title'] = `标题最长 ${MAX_TITLE} 字，当前 ${title.length} 字`;
  if (draft.dueAt !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(draft.dueAt)) errors['dueAt'] = '截止日期格式应为 YYYY-MM-DD';
  const tags = draft.tags.split(',').map((s) => s.trim()).filter(Boolean);
  if (new Set(tags).size !== tags.length) errors['tags'] = '标签有重复';
  return errors;
}

export function normalizeDraft(draft: Draft): TodoCreateInput {
  return {
    title: draft.title.trim(),
    dueAt: draft.dueAt === '' ? null : draft.dueAt,
    tags: [...new Set(draft.tags.split(',').map((s) => s.trim()).filter(Boolean))],
  };
}
```

预期行为（静态推演，未在本环境运行）：输入 `{ title: '  会议  ', dueAt: '2026-10-17', tags: '工作, 工作' }` 时 `errors` 为空对象、`normalizeDraft` 给出 `{ title: '会议', dueAt: '2026-10-17', tags: ['工作'] }`；`{ title: '   ' }` 得到 `{ title: '标题不能为空' }`（**注意**：先 `trim` 再判空，否则空格被当成有效标题）；`dueAt: '17/10/2026'` 命中格式错误；重复标签命中 `tags`。

<Callout type="unverified" title="校验输出是推演结果">

上面这段是纯 TS 函数，理论上可脱离 React 运行，但**本次写作环境的命令执行被限制，未实际跑过**。请按「预期行为」自行写一条 Vitest/Jest 用例验证，尤其是「全空格标题」和「空日期字符串 → `null`」这两条边界。

</Callout>

配套的字段状态 Hook（touched + 三档时机）：

```tsx
export function useField(initial: string, validate: (value: string) => string | undefined) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const error = validate(value);                     // 渲染期直接算，不是 effect
  return {
    value,
    error: touched ? error : undefined,              // 摸过才显示
    props: {
      value,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value),
      onBlur: () => setTouched(true),
      'aria-invalid': Boolean(touched && error),
      'aria-describedby': touched && error ? `${id}-error` : undefined,
    },
  };
}
```

三条注意：**① `error` 是派生值，渲染期算，别写 `useEffect` + `useState`（第 5 章清单第 1 条）；② `aria-invalid` / `aria-describedby` 是校验的可访问性下限，配合[HTML 表单](/html/forms)与[无障碍](/javascript/accessibility-and-performance)；③ 布尔值给 `aria-invalid` 时 React 会渲染成字符串 `"true"`/`"false"`，这是允许的取值，别画蛇添足写 `"error"`。**

什么时候上库：字段多到几十个且每个都要独立重渲染控制时，`React Hook Form` 的核心卖点恰好是「非受控 + ref 注册」，它快就是因为不逐键 setState——理解了上面这一节，你才知道它在替你省什么。规则本身要能复用（前后端共享）时，配 `Zod` 这类 schema 库，类型直接从 schema 推出来（[联合类型与收窄](/typescript/unions-and-narrowing)那套「边界处校验」在 React 里同样成立）。

最后：`required` / `pattern` / `min` / `max` 这些原生约束属性在 React 里照常生效（官方 input 参考列了它们），浏览器会自己拦下提交并弹原生提示。想自绘错误就显式 `<form noValidate>`——**这不是关掉校验，是把校验时机交回给你**。`HTMLFormElement.reportValidity()` / `checkValidity()` 可以手动触发原生校验，用于「不提交但先体检」。

## 提交、重置与 preventDefault

| 动作 | 写法 | 忘写的后果 |
| --- | --- | --- |
| 阻止真提交 | `event.preventDefault()` 在 `onSubmit` 第一行 | 页面整刷，所有 state 归零，接口调用看起来「偶发失败」 |
| 清空表单 | `event.currentTarget.reset()` | 手动的每个 `setX('')`，漏一个就是脏表单 |
| 重置受控 state | 给表单容器一个 `key`，换 key 即卸载重建（[state 是快照](/react/state)） | 用 `useEffect` 侦听 props 再逐项 setState，多一轮错误渲染 |
| 提交按钮禁用 | `disabled={Object.keys(errors).length > 0}` | 用户点一次报错一次 |
| 回车提交 | 表单里必须有 `type="submit"` 的按钮 | 「按回车没反应」——这是 HTML 行为，不是 React 的（[表单](/html/forms)） |

`key` 那一行是本章和第 5 章的接缝：Vue 里你写 `:key="draftId"` 也是同一招，两边语义一致——**身份变了就重挂，state 自然回到初始值**。

## 常见错误与排查

1. **用 `useRef` 存要显示的数据，界面不动。** 现象：`ref.current++` 后数字还是旧的，React DevTools 里能看到 `current` 确实在变。原因：改 ref 不触发渲染（官方保证），Vue 的 `ref()` 反而**一定**会触发。怎么确认：在 ref 赋值后加 `console.log`，值对了但 UI 不跟；`useReducer` 里塞一个 `setTick` 强制渲染一次，如果立刻跟上，就是它。怎么修：显示的数据一律 `useState`，ref 只留给「逻辑要、界面不要」的值。
2. **`value` 传了没传 `onChange`，输入框打不进字。** 现象：能聚焦、能粘贴，内容一动不动，开发控制台给出警告。原因：React 强制回写 `value`，而你没更新任何 state（官方原文：传 `value` 而不传 `onChange` 将无法输入）。怎么确认：搜 JSX 里 `value=` 是否成对出现 `onChange=`。怎么修：补 `onChange`；确实只想显示不可编辑文本就用 `readOnly`（官方也提到 `readOnly` 可配合受控 `value` 而不报错）。
3. **`value={draft?.title}` 在加载完成后报「从非受控变成受控」。** 现象：控制台警告（措辞大致是 changing an uncontrolled input to be controlled），文案以你的版本为准。原因：首帧 `value` 是 `undefined`，之后是字符串——`value` 不能是 `null`/`undefined`（官方明确要求初始化为空串）。怎么确认：把 `console.log(value === undefined)` 放进组件，看是否先 true 后 false。怎么修：`value={draft?.title ?? ''}`，并让 state 初始值就是 `''`；或数据未就绪时干脆不渲染表单（`LoadState` 分支）。
4. **复选框勾不上或状态永远 false。** 现象：点了没反应，或者所有行一起变。原因：复选框用 `checked` / `defaultChecked`，读值要读 `e.target.checked`；沿用 `value` / `e.target.value` 就拿到 `"on"`。怎么确认：`console.log(e.target.value, e.target.checked)`。怎么修：`checked={todo.done}` + `onChange={(e) => toggle(todo.id, e.target.checked)}`。
5. **中文/日文输入被打断，或空格打不出来。** 现象：拼音候选框消失、双词之间的空格丢失。原因：受控 `value` 在每次 `input` 事件后回写，如果你在 `onChange` 里做了 `trim`、大写转换、正则过滤，就会与输入法的组合过程冲突。怎么确认：只用英文输入是否也复现；过滤掉转换逻辑是否消失。怎么修：**格式化延后到 `onBlur` 或提交时**；需要处理组合期就用 `onCompositionStart` / `onCompositionEnd` 在组合期间暂停回写。这一条与 React 版本、浏览器实现都有关系，**本站未做版本核实**，先在小 demo 里复现再决定方案。
6. **敲一个字整个页面卡。** 现象：输入时掉帧，React DevTools Profiler 显示根组件以下全部重跑。原因：不是「受控组件天然慢」，而是输入 state 放在了共同父组件、且子树没有 `memo`。怎么确认：Profiler 的「为什么渲染」列；或把 `useState` 挪进一个小组件看是否立刻不卡。怎么修：state 下移、重活用 `useDeferredValue`、必要时 `memo`（顺序来自官方建议，细节见[重渲染机制与性能](/react/re-render-performance)）。
7. **每次渲染都 `new` 一个昂贵对象。** 现象：`useRef(new VideoPlayer())` 的构造日志刷屏。原因：`useRef` 的实参每次渲染都会被求值，只有首次的结果被保留。怎么确认：在构造函数里 `console.log`。怎么修：`useRef(null)` + `if (ref.current === null)` 惰性赋值（官方给的写法）。
8. **在渲染期读写 ref，行为偶发且只在 StrictMode 或生产/服务端出岔。** 现象：本地一次正常，开发环境下数字翻倍；或水合（hydration）报错。原因：组件必须是纯函数，渲染期读写 ref 破坏这一点（官方明确）。怎么确认：把读写移到 `onClick` / effect 里，症状消失。怎么修：值要显示就进 state；是外部系统就 effect + 清理；是历史值就在 effect 里维护。
9. **`onSubmit` 忘写 `preventDefault`，state 全丢。** 现象：点提交后页面闪白、URL 变成 `?title=xxx`、控制台里之前打的 log 全没了。原因：走了浏览器原生表单提交。怎么确认：看地址栏有没有 query。怎么修：`event.preventDefault()` 提到第一行；用非受控 + `FormData` 时同样要写。

## 练习

<Exercise title="练习 1 · 把 v-model.trim.lazy 翻成 React 并说明空格问题" difficulty="基础">

Vue 组件里有这么一行：

```vue
<input v-model.trim.lazy="draft.title" />
```

写出等价的 React 受控写法，并回答：如果你在 `onChange` 里直接 `e.target.value.trim()`，用户会遇到什么具体现象？为什么 Vue 不会？

<template #answer>

```tsx
<input
  value={draft.title}
  onChange={(e) => patchDraft({ title: e.target.value })}
  onBlur={(e) => patchDraft({ title: e.target.value.trim() })}
/>
```

Vue 不出现问题的原因：`.trim` 的语义是**在 `change`（失焦）时才把值写回**并顺手 trim，组合期与打字过程中数据层跟着的是原始值；而 React 的 `onChange` 是逐键的（官方：fires immediately on every keystroke），你放在 `onChange` 里的 `trim` 会在每次键入后立刻把 `value` 回写成去掉空格的字符串——用户敲「买」+ 空格 + 「牛奶」时，空格在写回前就被吃掉了，永远打不出双词。同理，`toUpperCase()` 之类的格式化也不该写在 `onChange` 里。

要点结论：**格式转换属于「提交前」或「失焦时」，不属于「每次键入」。**

</template>

</Exercise>

<Exercise title="练习 2 · 判断 state 还是 ref" difficulty="基础">

下面五处需求，分别该用 `useState`、`useRef` 还是「既不是」？写出理由。

1. 显示「已输入字数」的计数器文本。
2. 保存 `setInterval` 返回的 id，好在卸载时清掉。
3. 记住上一次 `props.count` 的值，用来判断是涨了还是跌了并在界面上画箭头。
4. 输入框的 DOM 节点，点「清空」按钮时聚焦它。
5. 一个第三方图表实例，只在挂载时 `new`，卸载时 `destroy`，数据变化时调 `chart.update(data)`。

<template #answer>

1. **`useState`**：要显示，必须触发渲染。
2. **`useRef`**：只有逻辑读写，界面不关心；这正是官方 Stopwatch 例子。
3. **`useRef` + 派生渲染**要小心：判断涨跌的结果**要显示**，所以最终渲染依赖的是算出来的箭头方向；「上一次的值」本身放 ref，但**写回 ref 不能发生在渲染期**（官方禁止）。可执行写法：在 `useEffect(() => { prevRef.current = props.count; }, [props.count])` 里更新，在渲染期只读它——注意「渲染期读 ref」本身仍然违反纯度要求，因此**更好的答案是把它放进 state**（`const [prev, setPrev] = useState(count)` 风格）或干脆用 `useReducer`，让「上一次值」成为状态的一部分（[useState / useReducer](/react/state)）。这道题的价值在于：它没有完美答案，任何「渲染期读 ref」的实现都要被质疑。
4. **`useRef`**：DOM 引用，标准用途。
5. **`useRef` + effect**：实例存 ref，`new` 放在 `useEffect`（或惰性初始化那条），`destroy` 放 cleanup，数据变化用另一个依赖 `data` 的 effect 调 `chart.update`。第三方实例是典型的「外部系统」，与[useEffect 与 watch 的对照](/react/use-effect)那张表同一行。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并读报错" difficulty="进阶">

在一个已有 React + TS 项目里做四件事，分别记录控制台第一句报错文本，并说明成因：

甲：把 `<input value={text} />` 的 `onChange` 删掉，敲字。
乙：把 state 初始值 `useState('')` 改成 `useState<string | undefined>(undefined)`，然后渲染 `value={text}`。
丙：把同一个输入框从 `defaultValue="a"` 改成 `value={text}` 且 text 初始为 `'a'`，运行一次后**在渲染中动态切换**这两个属性。
丁：给一个自定义组件 `<MyInput ref={inputRef} />`，而 `MyInput` 既没有 `forwardRef` 也不接收 `ref` prop。

<template #answer>

甲：输入框完全打不进东西，开发控制台给出警告——大意是「你给 input 提供了 `value` 但没有 `onChange`，它将无法被修改；如果要不可编辑请用 `readOnly`」。成因就是官方那条「React 强制回写 `value`」。

乙：首次渲染时 `value` 是 `undefined`，React 认为这是**非受控**输入框；一旦接口回来或用户操作让它变成字符串，React 抛警告/错误，措辞大致是「组件从非受控变为受控，不允许切换」。修法是 `value={text ?? ''}` 并把 state 初始化为空串（官方明确建议初始化为 `''`）。

丙：非受控与受控之间**不能中途切换**——官方写的是「一个输入框在其生命周期里只能是一种」。运行时切换会得到与乙同族的行为：值被 React 接管或不再接管，出现「输入的内容忽然被抹掉」这种最难查的现象。选一种并贯彻到底；确实要支持两种形态，用 `value` / `defaultValue` 二选一的接口 + `useControlled` 那种 Hook，在**挂载前**决定，别在渲染中改。

丁：控制台报 `Function components cannot be given refs`（老版本 React 的措辞；新版里函数组件可直接接收 `ref` prop，那就变成拿到 `null` 或 TS 报错）。修法是子组件把 `ref` 收下并往下透传，或用 `forwardRef` + `useImperativeHandle`（[props、回调与 children](/react/props-and-children)）。

**判分标准不是报错文本一字不差**，而是你能不能说出「React 为什么认为这是错的」。文案会随版本变化，本站未逐一核实。

</template>

</Exercise>

<Exercise title="练习 4 · 非受控重写：把每键重渲染改成零次" difficulty="进阶">

有一个 2000 行的待办表，每行第一个单元格是 `<input>`，当前实现是每行受控（一个父组件持有 `Record<string, string>`，`onChange` 里 `{ ...prev, [id]: next }`）。敲一个字要 40ms 以上。

请：① 说明为什么慢（不许回答「React 慢」）；② 用非受控 + `FormData` 或 ref 改写，给出提交时一次性读值的代码；③ 说明这样改之后你失去了哪些能力，怎么补。

<template #answer>

**① 慢的成因**（两条都要答到）：受控意味着每次键入都 `setRows`，而 `rows` 挂在**共同父组件**上 → 父组件重跑 → 2000 行子组件全部重跑（没有 `memo` 时子组件一定会重跑，这是渲染模型而非性能问题，见[两套渲染模型](/react/two-rendering-models)、[重渲染机制与性能](/react/re-render-performance)）；同时 `{ ...prev }` 每次都新建一个 2000 键对象，`rows[id]` 变化会让**所有**行的 props 判定为「变过」。和「React 慢」无关的对照：Vue 里同样的 `v-model` 绑到数组项上，只有读了那一项的组件重渲染。

**② 非受控改写**：

```tsx
function TodoGrid({ todos, onCommit }: Props) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} onSubmit={(e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      const patch = todos
        .map((todo) => ({ id: todo.id, title: String(data.get(`title:${todo.id}`) ?? '') }))
        .filter((row, index) => row.title !== todos[index].title);   // 只提交改动过的
      if (patch.length > 0) onCommit(patch);
    }}>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <input name={`title:${todo.id}`} defaultValue={todo.title} />
          </li>
        ))}
      </ul>
      <button type="submit">保存</button>
    </form>
  );
}
```

键值仍然必须是 `todo.id`（`key={index}` + 非受控 = 残留上一项内容，[重渲染机制与性能](/react/re-render-performance) 那节的事故）。

**③ 失去的能力与补法**：失去即时校验（「标题不能为空」要等到提交）→ 用 `required` 让浏览器拦、或给单个输入框挂 `onBlur` 只更新那一行的 touched state；失去「按钮禁用/改动计数」这类全局联动 → 只在真正需要的行上用受控，或提交时再算；失去程序化重置 → `form.reset()` 会把值回到 `defaultValue`，注意 `defaultValue` 本身变了也不生效（非受控只认挂载时的初值），要换 `key` 重挂；搜索/过滤仍需要即时值 → 只把搜索框做成受控，表体保持非受控。

</template>

</Exercise>

<Exercise title="练习 5 · 把校验规则写成可测的纯函数并接上三档时机" difficulty="挑战">

用本章 `useField` 的思路做一个 `useForm`：接受 `values` 初始值与 `validators`（纯函数映射），支持「摸过才报错」「提交时全量校验并聚焦第一个出错字段」「`reset` 回到初始值且清空 touched」。写出接口签名和关键实现，并说明哪两处最容易写错。

<template #answer>

```tsx
type Errors<T> = Partial<Record<keyof T, string>>;

export function useForm<T extends Record<string, string>>(
  initial: T,
  validators: Partial<Record<keyof T, (value: T[keyof T], all: T) => string | undefined>>,
) {
  const [values, setValues] = useState<T>(initial);
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const fieldRefs = useRef(new Map<keyof T, HTMLInputElement | null>());

  function validateAll(next: T): Errors<T> {
    const out: Errors<T> = {};
    for (const key of Object.keys(validators) as Array<keyof T>) {
      const run = validators[key];
      const message = run?.(next[key], next);
      if (message) out[key] = message;
    }
    return out;
  }

  const errors = validateAll(values);                     // 派生值：渲染期算，不用 effect

  function bind(key: keyof T) {
    const show = Boolean(touched[key] || submitted);
    return {
      value: values[key],
      ref: (el: HTMLInputElement | null) => fieldRefs.current.set(key, el),
      onChange: (e: ChangeEvent<HTMLInputElement>) => setValues((p) => ({ ...p, [key]: e.target.value })),
      onBlur: () => setTouched((p) => ({ ...p, [key]: true })),
      'aria-invalid': show && Boolean(errors[key]),
    };
  }

  function submit(onValid: (values: T) => void): FormEventHandler {
    return (event) => {
      event.preventDefault();
      setSubmitted(true);
      const firstBad = (Object.keys(errors) as Array<keyof T>).find((k) => errors[k]);
      if (firstBad) { fieldRefs.current.get(firstBad)?.focus(); return; }
      onValid(values);
    };
  }

  return { values, errors, bind, submit, reset: () => { setValues(initial); setTouched({}); setSubmitted(false); } };
}
```

**最容易写错的两处**：

1. **把 `errors` 写成 `useState` + `useEffect`。** 校验是纯派生值，`const errors = validateAll(values)` 直接算即可；写成 effect 会多一轮渲染，并且出现「错误提示晚一拍」的撕裂（[你可能不需要 effect](/react/use-effect)）。只有校验确实昂贵时才包 `useMemo(() => validateAll(values), [values, validators])`——记住 `useMemo` 不保证缓存，它只是优化。
2. **在 `submit` 里用刚 `setSubmitted(true)` 之后的 state 判断。** `values` / `errors` 是**这一帧的快照**，setState 不会让它当场变（[state 如同快照](/react/state)）；`validateAll(values)` 用的是闭包里的当前 `values`，所以顺序无所谓，但如果你写成「先 setState 再读 `submitted`」就会读到旧值。同类错误：`fieldRefs` 用 `Map` 存，如果每次渲染重建 Map（写成 `const m = new Map()`）就永远拿不到节点——必须放 `useRef`，这是「跨渲染但不触发重渲染」的教科书用法。

第三个常见翻车：`reset()` 后非受控字段不会跟着回。因为 `defaultValue` 只在挂载时生效，表单里混进非受控输入框时要么用 `form.reset()`（浏览器会把值恢复到它记住的初值），要么给表单容器换 `key` 强制重挂。

</template>

</Exercise>

## 官方文档与延伸阅读

- [useRef 参考](https://react.dev/reference/react/useRef) —— 本章「同一个对象实例、`initialValue` 只首次生效、改 `current` 不触发渲染、不要在渲染期读写 ref、自定义组件要自己接收 `ref` prop、昂贵对象用 `if (ref.current === null)` 惰性初始化」这些结论的直接来源（2026-10-17 核实）。
- [input 组件参考](https://react.dev/reference/react-dom/components/input) —— 核实「`value` 无 `onChange` 就打不进字」「`value` 不能是 `undefined`，应初始化为空串」「`defaultValue` 与 `value` 二选一并终身不变」「复选框用 `checked` 且读 `e.target.checked`」「`onChange` 逐键触发」「优化建议是 state 下移或 `useDeferredValue`」「`required` / `pattern` / `readOnly` 语义」。
- [使用 Ref 引用值](https://react.dev/learn/referencing-values-with-refs) 与 [使用 Ref 操作 DOM](https://react.dev/learn/manipulating-the-dom-with-refs) —— 核实两个用途的官方分节与 Stopwatch / focus 示例（领域首页第 10 章指定参考）。
- [useDeferredValue](https://react.dev/reference/react/useDeferredValue) / [useTransition](https://react.dev/reference/react/useTransition) —— 核实「延后重活但输入框保持逐键响应」这一模式的官方形态。
- [useImperativeHandle](https://react.dev/reference/react/useImperativeHandle) 与 [forwardRef](https://react.dev/reference/react/forwardRef) —— 核实「把子组件句柄交给父级」的官方推荐边界（尽量少用、只暴露必要方法）与两种版本写法差异。
- [createRef / 更多 DOM 相关参考](https://react.dev/reference/react/hooks) —— Hooks 总览页，用来确认本章用到的 Hook 都在官方清单里、没有自创 API。
- MDN：[`FormData`](https://developer.mozilla.org/zh-CN/docs/Web/API/FormData)、[`HTMLFormElement`](https://developer.mozilla.org/zh-CN/docs/Web/API/HTMLFormElement)（`reset()` / `reportValidity()` / `checkValidity()`）、[`input` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/input)、[`compositionstart` / `compositionend` 事件](https://developer.mozilla.org/zh-CN/docs/Web/API/HTMLInputElement) —— 核实「`type="file"` 的 `value` 只读」「`name` 是 `FormData` 的归集依据」「原生校验与提交行为由浏览器决定，与框架无关」。
- [React Hook Form](https://react-hook-form.com/) 与 [Zod](https://zod.dev/) —— 上库路线的两个代表：前者核心是「注册 ref、跳过逐键渲染」，后者提供 schema 与类型推导。**本站不比较优劣**，只用来确认「非受控 + ref」在真实库里的价值主张。
- Vue 侧对照：[v-model 与表单](/vue/template-syntax)、[`defineModel` 与组件双向绑定](/vue/components)、[模板引用与 `useTemplateRef`](/vue/lifecycle-and-inject)。

## 下一章

这一章收的是「表单与 DOM」这条支线：受控是 React 的默认形态，因为 `value` 会被强制回写；`useRef` 只负责跨渲染的可变盒子与 DOM 节点，而且不能在渲染期读写。但你可能已经注意到，本章至少有四处要写「这一条与并发/StrictMode/版本有关」——渲染期纯度、ref 读写时机、双执行下 effect 的行为、`useDeferredValue` 的延后语义。它们不属于「Vue 换个名字」的对照范围。

第 11 章[对照法的盲区：React 特有的东西](/react/react-only)就是来收这些的：为什么 React 要求渲染函数是纯的、StrictMode 到底双跑了什么、并发特性与 `useSyncExternalStore` 解决的是不是同一个问题、错误边界为什么到现在还得写类组件、`key` 在两个框架里的语义差别、以及服务端组件这条线走到哪里就超出了对照法的能力。读完它，你对 React 的判断就不再依赖「Vue 里这是怎么做的」。
