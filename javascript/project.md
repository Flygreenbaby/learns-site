# 阶段项目：纯 JavaScript 待办清单

这是 JavaScript 领域的验收关卡：不引入框架、不引入构建工具，只用 `index.html` 加若干 `.js`，把一个待办应用做完整。它考的不是「能不能画出列表」，而是你能不能说清楚三件事：**状态存在哪里、谁触发更新、DOM 是怎么被重建的**。

技术约束与功能要求以[JavaScript 领域首页](/javascript/)的「阶段项目」一节为准，本章只是把它展开，不改变范围：

- 只用 `index.html` + `.js` 文件，`<script type="module">` 引入，用任意静态服务器打开（**不要用 `file://` 双击**，ES Modules 会因跨域限制失败）。
- 数据用 `localStorage` 持久化，刷新后不丢。
- 至少一次 `fetch` 拉初始数据，并正确处理加载失败。
- 新增、编辑、删除、标记完成、按状态筛选（全部 / 进行中 / 已完成）。
- 列表**一个事件委托**绑定，而不是每项一个 `addEventListener`。
- 有一个 `render()` 负责把状态重画到 DOM，**禁止在事件回调里零散改 DOM**。
- 全程不使用 `var`，不使用 `innerHTML` 拼接用户输入。

### 明确不做什么

不做路由、不做登录、不写测试、不引入任何库（包括 lodash 和 dayjs）、不用 Vite、不上 TypeScript——那些在后面三个领域。**也不要把界面做复杂**：一套 CSS、一个输入框、一个列表、三个筛选按钮就够了。这个项目唯一的目的，是让你亲手体会「手动同步状态与视图」有多累，从而理解 Vue 与 React 在解决什么。

## 目录结构：三个文件起步，四个够了

```text
todo-vanilla/
├─ index.html        结构 + <script type="module" src="./main.js">
├─ main.js           入口：装配事件、启动流程（bootstrap）
├─ state.js          状态、持久化、ID 生成；唯一能改 state 的地方
└─ render.js         render() 与它的子函数；只读 state，只写 DOM
└─ data/todos.json   fetch 的初始数据（本地文件即可）
```

划分只有一条理由：**改数据的地方**和**画 DOM 的地方**必须分开。`main.js` 里出现 `el.style.color`、或者 `render.js` 里出现 `state.todos.push()`，就是划分失败了。CSS 可以写在 `index.html` 的 `<style>` 里，本项目不评样式。

## 先设计状态形状，再写 DOM

新手顺序是反的：先写 HTML，再往元素上挂数据，于是「数据」散落在 DOM 里（读回来要靠 `dataset`、`classList` 猜），删除一项之后统计数字和界面就不一致了。正确顺序是**先定死状态的形状**，让 DOM 变成它的纯函数输出。

```js
// state.js —— 整个应用唯一的真相来源
export const state = {
  version: 1,                       // 持久化格式版本，迁移时要用
  todos: [],                        // Todo[]，见下
  filter: "all",                    // "all" | "active" | "done"
  query: "",                        // 可选：搜索关键词
  status: "loading",                // "loading" | "ready" | "error"
  error: null,                      // { code, message } | null
};

// 一条 Todo 的形状（此刻只是约定，进 TypeScript 后由编译器检查）
// { id: string, text: string, done: boolean, createdAt: number }
```

四个设计决定，每个都会在后面咬人：

1. **`id` 是字符串不是数字下标**。下标会随删除与筛选变化，用它做键必然错位。生成方式见参考答案。
2. **`filter` 是状态而不是「用户点了哪个按钮」**。渲染时从 `state.filter` 推导要显示哪些项，按钮只负责改 `state.filter` 再调 `render()`。
3. **`status` / `error` 也是状态**。加载态、错误态、空态是三种不同画面，忘了前两种就会出现「白屏 3 秒」和「失败后什么都不显示」。
4. **只有 `state.js` 里的函数可以改 `state`**。事件回调一律通过 `addTodo()` / `toggleTodo(id)` 这类函数改，不直接动数组。

架构就两句话：**事件 → 改 state 的函数 → `render()` → 从 state 重建视图**。任何一条绕过 `render()` 直接改 DOM 的「小优化」，都会在下次渲染时被覆盖回去，这类 bug 极难定位。

### 这和 Vue / React 是什么关系

你刚手写的东西有名字：**单向数据流 + 显式渲染函数**。框架做的事一样，只是把你手动的两段自动化了：

| 本项目（纯 JS） | Vue 3 | React |
| --- | --- | --- |
| 改完 state 手动调 `render()` | 响应式系统追踪依赖后自动重渲染，见 [Vue 是什么与心智模型](/vue/mental-model)、[响应式原理](/vue/reactivity) | 调用 `setState` 触发一次新的渲染，见 [useState / useReducer 与不可变更新](/react/state) |
| `render()` 里整表重建 DOM | 虚拟 DOM 做 diff，只改变化的节点 | 同样 diff，`key` 就是稳定 id 的用途 |
| `state` 一个普通对象 | `reactive()` / `ref()` 包起来的代理 | 不可变更新：`setTodos([...])` |
| 事件委托手写 | 模板里 `@click` 看起来像每项一个（实际由运行时处理） | `onClick` 同理 |

所以进入框架之前先手写一遍的价值非常具体：你知道了「渲染函数被完整跑一遍」的代价（列表一长就卡），也就懂了 Vue 的 `key`、React 的不可变更新各自在解决什么。**如果你在本项目里靠「在回调里直接改 DOM」绕过 `render()`，到框架里会立刻撞墙**——框架随时会重建那棵树。

## 六个实施阶段：每阶段都有可验证产出

顺序不能换，每阶段只做一件事。每阶段末尾的「自查」请在浏览器里真做，不要眼过。

### 阶段 ① 静态骨架与语义化 HTML（还没有逻辑）

写 `index.html`：`<main>`、新增表单（`<label>` + `<input>` + `<button type="submit">`）、筛选按钮组（三个 `button`，当前项 `aria-pressed="true"`）、`<ul id="list">`（先手写 2 条静态 `<li>`）、统计行、`aria-live` 容器。

**可验证产出**：禁用 JS（DevTools → Settings → `Disable JavaScript`）后，页面内容仍读得懂、Tab 能顺序走完所有控件、焦点清晰可见。
**自查**：`<label for>` 关联存在；空 `<ul>` 时不残留边框；无 `div onclick`。

### 阶段 ② 状态与渲染分离

`state.js` 定形状、塞两条硬编码数据；`render.js` 写 `render()`：清空 `#list` 并依据 `visibleTodos()` 重建 `<li>`。`main.js` 里只调一次 `render()`。

**可验证产出**：在 Console 里执行 `state.todos.push({...}); render()`，界面出现新的一行——**证明界面完全由状态决定**（这一条就是领域首页那句「你能指着代码说清楚状态在哪里、谁触发更新」的验收动作）。
**自查**：`render()` 里没有一处读 DOM 拿数据（`input.value` 只在事件回调里读一次，读完立刻进 state）。

### 阶段 ③ 增删改与表单，列表用事件委托

`form` 的 `submit`（`preventDefault()`）→ `addTodo()`；列表容器上一个 `click` 监听，用 `e.target.closest("[data-action]")` 判断是 `toggle` 还是 `remove`；编辑用「把文本放回输入框」这种最省事的实现，不必做行内富编辑。

**可验证产出**：连加 5 项、删中间 2 项、勾 1 项，界面与状态始终一致；DevTools 的 Event Listener 面板里，**列表容器上只有 1 个 click 监听器**。
**自查**：删除最后一项后空状态正常显示（不是留一块空白）；`e.target` 命中的是 SVG 图标时仍能找到 `[data-action]`（所以必须用 `closest`）。

### 阶段 ④ 筛选与统计

三个筛选按钮只写 `state.filter = …` 再 `render()`；统计（总数 / 剩余 / 已完成）从 `state.todos` 现算，绝不维护第二份计数器；当前筛选同步 `aria-pressed`，数量变化写进 `aria-live` 容器。

**可验证产出**：切到「已完成」时列表为空 → 空状态文案变成「没有已完成项」，且**读屏听到数量变化**。
**自查**：`filter` 派生的数组不会改到原数组（`filter`/`map` 返回新数组，`sort`/`reverse` 原地改，是经典事故源）。

### 阶段 ⑤ localStorage 持久化与版本兼容

`save()` 在每次状态变更后调用（写入整个 `{ version, todos, filter }`），`load()` 在启动时读并校验。校验包含三件事：JSON 能不能解析、`version` 对不对、每条记录的必备字段在不在。

**可验证产出**：刷新后数据与筛选状态都在；手动把 `localStorage` 里的那条记录改成半截 JSON（Application → Local Storage → 编辑）后刷新，**页面不白屏、不抛错**，回落到初始状态并给出提示。
**自查**：存进去的对象里没有 DOM 节点、没有循环引用（否则 `JSON.stringify` 抛 `Converting circular structure to JSON`，本机 Node 已实跑）；解析失败走的是 `catch`，报的原文是 `Expected property name or '}' in JSON at position 1 (line 1 column 2)` 这一族（见[错误处理与 DevTools 调试](/javascript/errors-and-debugging)）。

### 阶段 ⑥ fetch 初始数据 + 加载 / 失败 / 空态

启动流程变成：`load()` 读本地 → 本地为空则 `await` 拉初始数据 → 设 `state.status` → `render()`。三种画面都由 `state.status` + `state.todos.length` 推导。

**可验证产出**：Network 面板切 Offline 后刷新，页面显示明确的错误提示与「重试」按钮，**不是白屏**；正常时先看到加载态再看到列表。
**自查**：检查了 `res.ok`（4xx/5xx 不抛错但也不是合法数据）；`catch` 到的是分类后的错误码而不是 `String(e)`；`AbortSignal.timeout` 或手写超时存在，慢网络不会永远转圈。

## 无障碍自查清单

这一节是[JS 层面的无障碍与性能](/javascript/accessibility-and-performance)在项目里的落地版，全部用键盘完成。

- [ ] 只用 Tab / Shift+Tab / Enter / Space 能完成新增、勾选、编辑、删除、筛选全套操作。
- [ ] 删除与勾选按钮是 `<button>`，不是 `div`；图标按钮有可读名称（`aria-label` 或隐藏文本）。
- [ ] 焦点样式清晰可见，没有被 `outline: none` 抹掉。
- [ ] 数量变化通过 `aria-live="polite"` 播报（例：`已删除 1 项，剩余 5 项`），live region 常驻 DOM。
- [ ] 输入框有 `<label for>` 关联，`aria-describedby` 指向提示或错误文本。
- [ ] 删除一项后焦点不会掉回 `body`：把焦点交给「添加」输入框或列表标题（`tabindex="-1"` + `focus()`）。
- [ ] 整表重建不会打断输入法（输入框在重建范围之外）。
- [ ] 若加了动画，`prefers-reduced-motion` 下有降级。

## 性能自查

- [ ] 列表用**一个**事件委托，而不是每项一个监听器。
- [ ] 输入搜索（如果做了）有 150–250ms 防抖，且在关闭/重建时清掉待执行定时器。
- [ ] 渲染路径里没有交替读写几何属性（不要在 `render()` 循环里 `getBoundingClientRect`）。
- [ ] 没有把 `localStorage` 读写放进每项循环（`JSON.stringify` 整份一次即可）。

**关于「整表重建」的取舍，要说清楚**：本项目 `render()` 直接 `list.replaceChildren()` 重建整个 `<ul>`，20 条数据毫无问题，代码简单、绝不会出现状态与 DOM 不一致。数据涨到几百条时会掉帧（每帧重建几十个节点 + 焦点丢失），那时候有三条路：① 增量更新（按 `id` 复用 `<li>`，只改变化的那几个）；② 只重建 `textContent`/属性而不重建节点；③ 虚拟列表。**本项目要求你停在 ①之前**，但要能说出代价——框架的 diff 就是在替你做增量更新。

## 验收清单

对照[JavaScript 领域首页](/javascript/)的验收标准，逐条打勾：

- [ ] 通过 `http://` 打开，Console 无报错、无 warning（含严格模式）。
- [ ] 新增、编辑、删除、标记完成、三种筛选全部可用。
- [ ] 刷新后数据不丢；损坏的 `localStorage` 数据不会导致白屏。
- [ ] `fetch` 失败时页面不白屏，能看到明确错误提示与重试入口。
- [ ] 删除最后一项后 UI 正确显示空状态，不留空白区域。
- [ ] 列表只有一个事件委托监听器（Event Listener 面板核对）。
- [ ] 只有一个 `render()` 负责写 DOM；事件回调里没有零散 DOM 修改。
- [ ] 全程没有 `var`；没有用 `innerHTML` 拼接用户输入（用 `textContent` 或 `document.createTextNode`）。
- [ ] 指着代码能说出：状态在 `state.js` 的哪个对象里、谁调用 `render()`、DOM 怎么被重建。
- [ ] 键盘完整可操作，数量变化有播报。

最后一条不是可选项：**在输入框里输入 `<img src=x onerror=alert(1)>`，页面不应弹窗、不应把它当 HTML**。如果你在某处用了 `innerHTML + 模板字符串`，此刻就会现原形。

## 常见翻车点

**1）`file://` 双击打开，控制台报模块加载失败。** 现象：页面空白，Console 报跨域相关错误（浏览器对 `file://` 下的 ES Module 有安全限制）。原因：ES Modules 必须走 HTTP 同源规则。修：起一个静态服务器（见本章末尾的本地验证路径），地址栏是 `http://127.0.0.1:xxxx/` 才算对。

**2）`JSON.parse` 直接吃 `localStorage`，一次脏数据永久白屏。** 现象：刷新就报错，且**每次都报错**，因为坏数据还在本地，进的是死循环。原因：没包 `try/catch`、没校验形状。修：读取一律 `try { parse } catch { 回落默认值 }`，并在 Console 里用 `localStorage.removeItem("todos:v1")` 现场验证回落路径。实跑的报错原文是 `Expected property name or '}' in JSON at position 1 (line 1 column 2)` 这一族。

**3）用数组下标当 ID，删一项之后全乱。** 现象：勾第二个的框，第一项变成已完成；编辑时内容跑到别的行。原因：`filter` 之后的数组下标和原数组不一致，而你把下标写进了 `data-index`。修：`data-id` 用稳定 id，`toggleTodo(id)` 里 `find`；下标只用于渲染时的排序，绝不写入语义。

**4）重新渲染后事件失效 / 事件翻倍。** 现象：第一次点有效，重建后的行点不动；或者一次点击触发两次删除。原因：给每个 `<li>` 单独 `addEventListener`，重建时旧监听器随节点消失（失效），或者你在 `render()` 里又给容器加了一遍监听（翻倍）。修：**监听器只在启动时绑在容器上一次**，这是本项目要求事件委托的真实原因，见 [DOM 操作与事件系统](/javascript/dom-and-events)。

**5）把 DOM 节点或整个 `element` 存进 state，`JSON.stringify` 抛循环引用。** 现象：保存时报 `Converting circular structure to JSON`，附带两行 `--> starting at object with constructor 'Object'` / `--- property 'self' closes the circle`（本机 Node 实跑原文）。原因：state 里塞了 `li` 元素、组件实例或父引用，节点与其子节点互为引用。修：state 只放纯数据（字符串、数字、布尔、数组、普通对象）；要定位 DOM 就存 id。

**6）在回调里直接改 DOM，下一次渲染又变回去。** 现象：勾选后立刻变回未勾选；或者界面显示的和统计数字不一致。原因：绕过了 `render()`，状态没改而视图改了（或相反）。修：**回调只改状态**，视图唯一由 `render()` 产出；调试时在 `render()` 第一行加 `console.log("[todos:render]", state.todos.length)`，看它到底被调了几次。

**7）`state.todos = state.todos.filter(...)` 之后再也没恢复。** 现象：删一项之后，切回「全部」看不到别的项。原因：筛选和删除都用同一个数组，`filter` 的结果被赋回原状态，把「删除视图」变成了「删除数据」。修：`visibleTodos()` 是**派生函数**，返回新数组而不写回 state；删除只改 `state.todos` 一处。

**8）`fetch` 没检查 `res.ok`，404 也能「成功」。** 现象：数据是空的但不报错，控制台后面炸在 `res.json()` 的 `SyntaxError`（页面拿到的是 HTML 错误页）。原因：`fetch` 只在网络层失败时 reject，4xx/5xx 是正常完成的响应。修：`if (!res.ok) throw …`，且必须排在 `json()` 之前。

**9）脚本在 DOM 之前执行，`document.getElementById` 拿到 `null`。** 现象：`Cannot read properties of null (reading 'addEventListener')`。原因：`<script>` 写在 `<head>` 且没有 `type="module"`/`defer`（模块脚本本身是 deferred 的，但一旦你改用普通脚本或动态插入就中招）。修：始终 `<script type="module" src="main.js">`，见 [ES 模块、动态导入与迭代器](/javascript/modules-and-iterators)。

## 参考答案要点

<Exercise title="参考答案要点 · 关键实现" difficulty="进阶">

下面是本项目最没把握的六段的参考实现：状态机式渲染函数、ID 生成、事件委托、持久化读写、带超时与错误分类的 fetch 封装、无障碍播报。请**先自己写完再对照**，重点看差异而不是照抄。

<template #answer>

### 1）ID 生成（`state.js`）

```js
export function nextId() {
  // crypto.randomUUID 优先；不可用时退回「时间戳 + 随机段」，够本项目用
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function addTodo(text) {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  state.todos.unshift({                          // 新项排前面：unshift 而不是 push
    id: nextId(), text: trimmed, done: false, createdAt: Date.now(),
  });
  save(); render();                              // 改状态 → 存 → 重画，顺序固定
  return { ok: true };
}

export function toggleTodo(id) {
  const t = state.todos.find((x) => x.id === id);  // 只按 id 找，绝不用下标
  if (!t) return;
  t.done = !t.done;
  save(); render();
}

export function removeTodo(id) {
  const before = state.todos.length;
  state.todos = state.todos.filter((x) => x.id !== id);   // 新数组赋回，派生不写回原数组
  if (state.todos.length === before) return;
  save(); render(`已删除 1 项，剩余 ${state.todos.length} 项`);
}
```

### 2）状态机式的渲染函数（`render.js`）

单一入口，四个画面由 `state.status` + 数据长度推导；回调永远不直接碰 DOM。

```js
import { state, visibleTodos } from "./state.js";

const els = {};                                   // 只在 init 时查一次 DOM 引用
export function initElements() {
  for (const key of ["list", "empty", "loading", "error", "count", "live"]) {
    els[key] = document.getElementById(key);
  }
  els.filterGroup = document.getElementById("filters");
}

export function render(announceText) {
  els.list.replaceChildren();                     // 唯一的「清空」动作

  if (state.status === "loading") { show("loading"); return announce(announceText); }
  if (state.status === "error")    { show("error"); els.error.textContent = state.error?.message ?? "加载失败"; return announce(announceText); }

  const items = visibleTodos();                   // 派生，不改 state
  if (items.length === 0) { show("empty"); els.empty.textContent = emptyText(); return announce(announceText); }

  show("list");
  const frag = document.createDocumentFragment();
  for (const todo of items) frag.append(renderItem(todo));
  els.list.append(frag);                          // 一次性插入，减少重排次数

  els.count.textContent = `共 ${state.todos.length} 项，未完成 ${state.todos.filter((t) => !t.done).length} 项`;
  syncFilterButtons();                             // aria-pressed 由状态推导，不靠点击改样式
  announce(announceText);
}

function show(which) {
  for (const key of ["list", "empty", "loading", "error"]) els[key].hidden = key !== which;
}

function emptyText() {
  return state.filter === "done"    ? "还没有已完成的项。"
       : state.filter === "active"  ? "全部做完了。"
       : "列表是空的，先加一条试试。";              // 空状态要有针对性文案，不是「无数据」
}

function renderItem(todo) {
  const li = document.createElement("li");
  li.dataset.id = todo.id;                         // id 进 dataset，事件委托靠它定位

  const label = document.createElement("label");  // 复选框包在 label 里：点文字也能勾选
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = todo.done;
  box.dataset.action = "toggle";                   // 动作意图写在属性上，不写匿名 class
  label.append(box);

  const text = document.createElement("span");
  text.textContent = todo.text;                    // ← 全程 textContent，绝不 innerHTML

  const del = document.createElement("button");
  del.type = "button";
  del.dataset.action = "remove";
  del.textContent = "删除";
  const name = document.createElement("span");
  name.className = "sr-only";
  name.textContent = `「${todo.text}」`;            // 图标/同名按钮要有各自的可访问名称
  del.append(name);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.dataset.action = "edit";
  edit.textContent = "编辑";

  li.append(label, text, edit, del);
  return li;
}

function syncFilterButtons() {
  for (const btn of els.filterGroup.querySelectorAll("button")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.filter === state.filter));
  }
}
```

### 3）事件委托（`main.js`）

```js
els.list.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");   // closest：点图标也能命中，向上找
  if (!btn || !els.list.contains(btn)) return;      // 点在 li 空白处直接忽略
  const id = btn.closest("li").dataset.id;
  if (btn.dataset.action === "remove") removeTodo(id);
  else if (btn.dataset.action === "edit") startEdit(id, btn);
});

// change 事件在 checkbox 上比 click 更稳（键盘 Space 也走 change）
els.list.addEventListener("change", (e) => {
  const box = e.target.closest('input[type="checkbox"][data-action="toggle"]');
  if (!box) return;
  toggleTodo(box.closest("li").dataset.id);
});

els.filterGroup.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-filter]");
  if (!btn) return;
  state.filter = btn.dataset.filter;                // 只改状态
  render(`当前筛选：${btn.textContent}`);             // 只重画
});

document.getElementById("todo-form").addEventListener("submit", (e) => {
  e.preventDefault();                                // 不阻止就会整页刷新
  const input = document.getElementById("todo-input");
  const res = addTodo(input.value);
  if (res.ok) { input.value = ""; input.focus(); }   // 焦点留在输入框，连续录入不用重新找
  else announce("请输入内容");
});
```

### 4）带版本兼容的持久化（`state.js`）

```js
const KEY = "todos:v1";

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({      // 只存纯数据：version + 需要的字段
      version: state.version, todos: state.todos, filter: state.filter,
    }));
  } catch (e) {
    // Safari 隐私模式/配额满会抛；不能让它冒到调用方
    console.error("[todos:save] 写入失败", e);
  }
}

export function load() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    const todos = Array.isArray(data.todos) ? data.todos.map(normalizeTodo).filter(Boolean) : [];
    state.todos = todos;
    state.filter = ["all", "active", "done"].includes(data.filter) ? data.filter : "all";
    return true;
  } catch (e) {
    console.warn("[todos:load] 本地数据已损坏，回落初始状态", e.message);
    localStorage.removeItem(KEY);                   // 清掉坏数据，否则会每次刷新都报错
    return false;
  }
}

function normalizeTodo(item) {                       // 白名单式重建：脏字段一律丢掉
  if (!item || typeof item !== "object") return null;
  return {
    id: typeof item.id === "string" ? item.id : nextId(),
    text: typeof item.text === "string" ? item.text.slice(0, 500) : "",
    done: item.done === true,
    createdAt: Number(item.createdAt) || Date.now(),
  };
}

// 版本迁移：v1 → v2 在这里串起来，一次一步，别在 load 里就地改结构
const migrations = {
  // 1: (data) => ({ ...data, version: 2 }),
};
```

### 5）带超时与错误分类的 fetch 封装

```js
export class LoadError extends Error {
  constructor(code, message, cause) { super(message, { cause }); this.name = "LoadError"; this.code = code; }
}

export async function fetchInitialTodos(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (e) {
    // 网络层失败/超时：浏览器里常见文案是 Failed to fetch，Node 里是 TypeError: fetch failed
    throw new LoadError("NETWORK", "无法连接数据服务，请检查网络后重试", e);
  }
  if (res.status === 404) throw new LoadError("NOT_FOUND", "初始数据不存在（404）");
  if (!res.ok) throw new LoadError("HTTP", `服务返回异常（${res.status}）`);   // 必须在 json() 之前
  let data;
  try { data = await res.json(); }
  catch (e) { throw new LoadError("PARSE", "初始数据格式不正确", e); }
  if (!Array.isArray(data?.todos)) throw new LoadError("SHAPE", "初始数据缺少 todos 数组");
  return data.todos;
}

export async function bootstrap() {
  state.status = "loading"; render();
  if (load()) { state.status = "ready"; return render(); }        // 本地已有就不必再拉
  try {
    state.todos = (await fetchInitialTodos("./data/todos.json")).map(normalizeSafe);
    state.status = "ready"; save(); render();
  } catch (e) {
    state.status = "error";
    state.error = { code: e.code ?? "UNKNOWN", message: e.message };
    render();                                                      // 关键：失败也要渲染，否则白屏
    console.error("[todos:bootstrap]", e.code, e.cause?.message ?? "");
  }
}

document.getElementById("retry").addEventListener("click", bootstrap);   // 错误态要有出口
```

`NOT_FOUND` / `HTTP` / `PARSE` / `SHAPE` 分类的价值在于文案和出口不同：404 提示「没找到初始数据，先手动加一条」并允许继续用；`NETWORK` 给重试按钮；`PARSE`/`SHAPE` 提示数据坏了并清理本地。**如果全 catch 成一句「加载失败」，用户和你都无从判断**。

### 6）无障碍播报（可直接跑）

```js
const live = document.getElementById("live");      // 常驻 DOM 的 <p role="status" aria-live="polite">

export function announce(text) {
  if (!text) return;
  live.textContent = "";                            // 先清空：同样的文案不清空就不会再读一次
  requestAnimationFrame(() => { live.textContent = text; });
}
```

焦点不丢的那一步（删除后必须做，否则键盘焦点掉回 `body`）：

```js
function focusAfterRemove(removedLi) {
  const next = removedLi?.nextElementSibling ?? els.list.firstElementChild;
  const target = next?.querySelector("[data-action]") ?? document.getElementById("todo-input");
  target.focus({ preventScroll: false });           // 宁可多滚一下，也不要焦点消失
}
```

注意 `render()` 用 `replaceChildren()` 会把被删的那行一起带走，所以**删之前先记下 `removedLi`**（在 `removeTodo` 调用 `render()` 之前取 `document.querySelector('li[data-id="…"]')`），或者把这段逻辑放进 `render()` 之后靠 `state.lastRemovedId` 决定。

</template>

</Exercise>

<Callout type="unverified" title="本项目的代码未在本机浏览器运行验证">

本项目的代码全部在**浏览器**里运行（`document`、`localStorage`、`fetch` 到静态 JSON、模块脚本的加载规则），本站环境没有浏览器，因此**本章所有代码片段均未运行验证**，属于「按规范编写、由你运行」的参考实现。例外：`ID 生成`、`normalizeTodo`、`fetchInitialTodos` 的错误分类逻辑与本章引用的报错原文（`JSON.parse` 的 `Expected property name…`、`Converting circular structure to JSON`、`TypeError: fetch failed`）在 **Node v25.4.0** 实跑过，见[错误处理与 DevTools 调试](/javascript/errors-and-debugging)。`AbortSignal.timeout` 在本机 Node 存在（`typeof` 为 `function`），但浏览器中的超时/中断行为与抛出的 `AbortError` 文案未验证。

</Callout>

## 本地验证路径

`type="module"` 必须走 HTTP，所以你要一个静态服务器。任选一种，**本站未逐一验证这些第三方命令的参数**，具体行为以工具自身文档为准：

```bash
# ① 本站的开发服务器（把项目放进 public/ 之类的静态目录后即可访问）
npm run dev

# ② 用 Node 自带能力起一个最小服务器（需要自己写 handler，serve 更省事）
npx serve .

# ③ Python 自带的静态服务器
python -m http.server 8000
```

判断「起对了」的唯一标准：浏览器地址栏是 `http://127.0.0.1:xxxx/`，Network 面板能看到 `index.html`、`main.js`、`state.js`、`render.js`、`data/todos.json` 五个请求，`todos.json` 状态码 `200` 且 `content-type` 是 JSON。若某个 `.js` 是 404 或 MIME type 报错，那是服务器根目录选错了，不是代码问题。

跑通之后，**在 Console 里做三件事**（这一步比代码本身更有价值）：`state.todos.length` 看数据在不在；手动 `toggleTodo(state.todos[0].id); render()` 看视图是否跟着状态走；`localStorage.getItem("todos:v1")` 看存进去的是不是纯数据。这三条过了，说明你真的实现了「单一数据源 + 显式渲染」，而不是碰巧画对了。

## 做完之后：这个项目会在 TypeScript 领域被重写

[阶段项目：用 TypeScript 重写待办清单](/typescript/project) 会拿同一份功能重做一遍，重点从「架构对不对」换成「类型能不能替你把住那些约定」：本章靠口头约定的 `Todo` 形状会变成 `interface`，`state.filter` 的三个字符串会变成联合类型，`localStorage` 读回来的 `unknown` 必须收窄才能用，`LoadError` 的 `code` 会变成判别式并让 `switch` 分支检查穷尽性——这些正是 [联合类型与收窄](/typescript/unions-and-narrowing) 的收益来源。

因此现在别急着加功能。要做的是把三件事说清楚：状态在哪里（`state.js` 的那个对象）、谁触发更新（`state.js` 里的动作函数）、DOM 怎么重建（`render()` 从状态推导画面，`replaceChildren()` 一次插入）。说不清就回阶段 ②，别往下堆。

## 官方文档与延伸阅读

- [MDN · Window.localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) —— 核实配额与异常场景（隐私模式抛错）、值为字符串这两点。
- [MDN · fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) —— 核实「只有网络层失败才 reject、HTTP 错误状态要自己判」与 `AbortSignal` 用法。
- [MDN · JSON.parse](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse) —— 核实解析失败抛 `SyntaxError`，即翻车点 2 的行为。
- [MDN · Document.createElement 与 textContent](https://developer.mozilla.org/en-US/docs/Web/API/Document/createElement) —— 核实不注入 HTML 的构建方式；`replaceChildren` 见 [ParentNode.replaceChildren](https://developer.mozilla.org/en-US/docs/Web/API/ParentNode/replaceChildren)。
- [MDN · HTMLTemplateElement](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template) —— 想把行结构写在 HTML 里时用它，比字符串拼接安全。
- [javascript.info · Event delegation](https://javascript.info/event-delegation) —— 事件委托的最小实现与 `closest` 用法。
- [javascript.info · Error handling](https://javascript.info/error-handling) —— 本章错误分类与自定义错误类的原始讲解。
- [W3C ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/) —— 列表 + 状态切换 + 播报这一组交互的推荐键盘与属性组合，用于核对本章的无障碍自查清单。

## 下一章

本章把 JavaScript 领域的 11 章合成一个能跑的东西：[类型与值](/javascript/types-and-values)决定你存什么，[函数、作用域、闭包](/javascript/functions-and-scope)决定回调能不能拿到最新状态，[DOM 与事件](/javascript/dom-and-events)给出委托的机制，[网络与存储](/javascript/network-and-storage)提供 `fetch` 与 `localStorage`，[错误处理与 DevTools 调试](/javascript/errors-and-debugging)让你在坏数据出现时看得懂报错，[无障碍与性能](/javascript/accessibility-and-performance)负责验收清单里那几条键盘与播报。

下一章开始进入 [TypeScript 领域](/typescript/)，第一件事是 [为什么需要类型](/typescript/why-types)：你在本章用口头约定保住的「`Todo` 长什么样」「`filter` 只有三个值」「`state.error` 可能是 `null`」，TS 会把它变成编译期检查。判断自己是否准备好了，用[JavaScript 学习地图](/javascript/learning-map)里那张表；不确定就先用本章的 Console 三件事自测。
