# DOM 操作与事件系统：一个监听器管住整张列表，以及它什么时候会失效

列表加载后按钮点不动；新渲染的行永远等不到事件；滚一下页面就掉帧；离开再回来，同一个点击触发了两次请求。这四个现象的原因分别是：监听器绑到了会被替换的元素上、没理解事件流的方向、在主线程里交替读写布局、监听器泄漏。**它们同属一章知识：DOM 是对象树，事件是沿树传播的对象。**

框架时代之前这就是前端的全部工程内容；框架之后它变成了框架的 internals——你写 `@click` 或 `onClick` 时发生的事就是本章这些。理解它有两个直接收益：抽象漏了时你知道怎么补，以及你能判断哪种写法在这个场景更省。

## DOM 是解析产物，document 只是入口

[HTML 文档](/html/what-is-html)是字节序列，浏览器解析后得到的是对象树，即 DOM（Document Object Model）。它已经和源码不是一个东西：块级元素会自动闭合标签、属性名被小写化、注释也是节点、元素之间的换行会变成独立的文本节点。

| `nodeType` | 常量 | 是什么 |
| --- | --- | --- |
| 1 | `ELEMENT_NODE` | 元素，绝大多数 API 的主语 |
| 3 | `TEXT_NODE` | 一段文本，含元素之间的空白 |
| 8 | `COMMENT_NODE` | 注释 |
| 9 | `DOCUMENT_NODE` | `document` 本身，树根 |
| 11 | `DOCUMENT_FRAGMENT_NODE` | 一段还没挂上去的子树 |

`document` 是入口对象，实现了 `Document` 接口，本身也是 `Node`。`document.body` 永远是同一个对象，所有增删改都实时作用在同一棵树上——所以「查一次、缓存引用」通常划算，前提是你不会替换掉那个元素。

## 查询：先分清实时集合与快照

```js
const list = document.querySelector('#task-list');            // 第一个匹配，找不到是 null
const done = list.querySelectorAll('li[data-done="true"]');   // 全部匹配，静态 NodeList
const byId = document.getElementById('task-list');            // 只接受 ID，最快的一条路径
```

| API | 返回 | 实时 |
| --- | --- | --- |
| `querySelectorAll` | `NodeList` | **否**，调用那一刻的快照 |
| `children` | `HTMLCollection` | **是** |
| `childNodes` | `NodeList` | **是** |
| `getElementsByClassName` | `HTMLCollection` | **是** |

于是这个循环是错的：

```js
const nodes = box.childNodes;                     // 实时
for (let i = 0; i < nodes.length; i++) box.removeChild(nodes[i]);   // 删一个，后面的整体前移
```

删完只剩一半，而且**现象依赖节点数量，极难复现**。改成 `Array.from(box.children)` 或 `box.replaceChildren()`。

`children` 只含元素节点，`childNodes` 还含文本与注释节点——**源码里的换行缩进就是文本节点**，所以 `childNodes.length` 永远比 `children.length` 大，`firstChild` 与 `firstElementChild` 也常常不是同一个东西。还有个连带差别：`NodeList`（`childNodes`、`querySelectorAll`）有 `Symbol.iterator` 与 `forEach`，而 **`HTMLCollection`（`children`、`getElementsByClassName`）按 MDN 的说明既没有 `forEach` 也没有迭代器**，`[...el.children]` 与 `for...of el.children` 都属于依赖实现细节——统一用 `Array.from(el.children)` 最稳，详见[迭代器协议](/javascript/modules-and-iterators)。

选择器成本的可靠结论只有方向性的几条：`getElementById` 走索引；**范围越小越省**，`container.querySelector('li')` 不必遍历整棵树；属性选择器、`*`、`nth-child` 的解析与匹配成本高于 ID 和 class；真正贵的通常是**在循环里反复查询同一批元素**，把结果存进变量或建 `Map` 索引才是解法。

## 创建与插入：数据走 textContent，结构才走 HTML 字符串

```js
const li = document.createElement('li');
const span = document.createElement('span');
span.textContent = userInput;         // 用户输入永远不会被当标签解析
li.append(span);                      // append / prepend / before / after / replaceWith / remove
list.replaceChildren(frag);           // 一次清空 + 插入，替代「innerHTML = '' 再循环 append」
```

`textContent` 取全部文本（含隐藏元素）；`innerText` 考虑渲染结果，**读它会强制一次布局计算**，只在真要「用户看到的文字」时用。`replaceChildren(...nodes)` 是重建列表最省心的写法，旧节点连同其监听器一起销毁。

`insertAdjacentHTML` 本身合法，四个位置是 `beforebegin`（元素前）、`afterbegin`（内部首）、`beforeend`（内部末）、`afterend`（元素后）：

```js
li.insertAdjacentHTML('beforeend', '<span class="badge">3</span>');   // 模板里没有插值：可以
li.insertAdjacentHTML('beforeend', `<span>${userInput}</span>`);      // XSS 注入点
```

**一旦字符串里插进用户提供的文本，标签边界就能被突破**，`onerror`、`<script>` 都顺得进来，与 `innerHTML` 同一问题；服务器侧的对应防线见 [Web 安全](/backend/web-security)。规则：数据一律 `textContent`，模板里每个插值都必须已经转义或来自白名单，做不到就退回 `createElement`。

## 属性、类与样式：坑在 value 上

`setAttribute` 操作 HTML 属性（attribute），直接赋值操作反射属性（property），多数时候指向同一份状态，但这几个例外必须记住：

```js
a.setAttribute('href', '/tasks');
a.getAttribute('href');   // '/tasks'                            源码字面量
a.href;                   // 'http://localhost:8080/tasks'       解析后的绝对 URL

input.setAttribute('value', '初始');
input.value = '用户敲的';
input.getAttribute('value');   // '初始'      —— attribute 没动
form.reset();                  // 又回到 '初始' —— reset 恢复的是 attribute
```

**表单控件的「当前值」在 property 上，「默认值」在 attribute 上。**想用 `setAttribute('value', ...)` 改输入框内容，在用户输入过之后无效。`checked` 同理，对应默认值属性是 `defaultChecked`。

布尔属性写 `el.hidden = true`。`hidden` 与 `aria-hidden` 分工不同：`hidden` 让元素不渲染并移出无障碍树；`aria-hidden="true"` **只**把它从无障碍树移除，视觉上仍在。给还包含可聚焦元素的容器加 `aria-hidden`，会造成「能 Tab 进去但读屏说这里没东西」——见[无障碍](/html/accessibility)。要两者都隐藏就用 `hidden`。

`dataset` 映射 `data-*`：`data-my-id` → `dataset.myId`，写入时驼峰转回连字符，两种写法访问不到彼此；**值永远是字符串**，`Number(el.dataset.count)` 不会自动发生。

`classList` 五个方法够用很久：

```js
el.classList.add('is-done');
el.classList.remove('is-error');
el.classList.toggle('is-open');              // 返回切换后的布尔状态
el.classList.toggle('is-open', force);       // 第二参数强制该状态，幂等
el.classList.replace('btn-primary', 'btn-secondary');
el.classList.contains('is-open');
```

别写 `el.className += ' is-done'`：累加空格、无法去重、会覆盖别处改过的类名。

```js
el.style.backgroundColor = 'rebeccapurple';    // 只碰内联样式，驼峰属性名
el.style.setProperty('--accent', '#08f');      // 自定义属性必须走 setProperty
getComputedStyle(el).backgroundColor;           // 级联后的最终生效值
getComputedStyle(el, '::before').content;      // 第二参数读伪元素
```

`getComputedStyle` 读的是「已算好的值」：刚改完样式就立刻读，浏览器必须同步把样式重算和布局补完。这条会撞上下面「渲染时机」一节。

## 测量与滚动：坐标有几套，别混用

| 要什么 | 用什么 |
| --- | --- |
| 相对视口的位置（吸顶、可见性判断） | `getBoundingClientRect()` |
| 相对最近已定位祖先的偏移 | `offsetTop` / `offsetLeft`，参照物是 `offsetParent` |
| 内容总高 | `scrollHeight` |
| 可视区高 | `clientHeight` |
| 已滚距离 | `scrollTop` / `scrollY` |
| 相对文档的位置 | `rect.top + window.scrollY` |

`getBoundingClientRect()` 的 `top/left` 相对**视口**，随滚动变化；`width/height` 含 `padding` 与 `border`，且是 `transform` 生效后的视觉尺寸。祖先一旦从 `static` 变成定位元素，`offsetTop` 读数立刻改变——这是「同一段代码在弹窗里就不对」的典型原因。元素 `display: none` 时 `offsetParent` 是 `null`、所有 `offset*` 为 0，`getBoundingClientRect()` 返回全 0 矩形。

```js
window.scrollTo({ top: 0, behavior: 'smooth' });
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
```

`behavior: 'smooth'` 对部分前庭敏感用户不友好，`prefers-reduced-motion` 是必须配合的一项（动效侧的对应规则见[过渡与动画](/css/transitions-and-animations)）。`block: 'nearest'` 比默认的 `'start'` 温和：只在必须移动时才移动。

## 事件流三阶段与事件委托

点击 `ul > li > button` 里的按钮，事件先从 `window` **向下**经过每个祖先（捕获 capture），到达目标，再**向上**回到 `window`（冒泡 bubble）。同一元素、同一阶段按注册顺序执行；捕获与冒泡的先后由阶段决定，与注册顺序无关。

```js
wrap.addEventListener('click', h, { capture: true });   // 捕获阶段（先到）
wrap.addEventListener('click', h);                      // 冒泡阶段（后到）
```

冒泡意味着父元素能收到子元素的事件，于是把监听器绑在**不变的容器**上、靠 `event.target` 判断点的是谁——这就是委托（event delegation）。它同时解决三件事：新项自动可点、监听器数量恒定、清理只需一次。

```js
list.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn || !list.contains(btn)) return;
  const row = btn.closest('li');
  if (!row) return;
  handle(btn.dataset.action, row.dataset.id);
});
```

| 属性 | 值 |
| --- | --- |
| `event.target` | 实际被点的最深节点（可能是 `<span>`、`<svg>`） |
| `event.currentTarget` | 当前监听器绑定的元素，委托里恒等于容器（非箭头函数时也是 `this`） |
| `event.relatedTarget` | `mouseenter` / `focus` 这类进出事件的来处或去处 |

`closest()` 从**自身**开始向上找最近的匹配祖先，找不到返回 `null`，所以每一层结果都要判空。

委托失效的场景，每个都对应一类真实 bug：

| 场景 | 原因 | 怎么办 |
| --- | --- | --- |
| 聚焦高亮行 | `focus` / `blur` **不冒泡** | 改 `focusin` / `focusout`，或捕获阶段监听 |
| 悬停 tooltip | `mouseenter` / `mouseleave` 不冒泡 | 改 `mouseover` / `mouseout` + `relatedTarget`，或逐项绑 |
| 子元素调了 `stopPropagation()` | 事件到不了容器 | 检查内嵌组件；必要时捕获阶段监听 |
| 容器自身被替换重建 | 监听器随旧节点销毁 | 委托绑到更外层、不会被替换的容器 |
| 目标在 Shadow DOM 里 | `target` 被重定向成宿主 | 用 `event.composedPath()[0]` 取原始目标 |

## preventDefault、stopPropagation 与 passive

| 方法 | 挡住的是 | 典型用途 |
| --- | --- | --- |
| `event.preventDefault()` | **浏览器的默认动作** | 拦截链接交给前端路由、阻止原生提交 |
| `event.stopPropagation()` | **事件在树上的传播** | 弹窗内点击不触发遮罩关闭 |
| `event.stopImmediatePropagation()` | 传播 + 同元素后续监听器 | 少数需要独占的场景 |

两者互不影响：`stopPropagation` 不阻止跳转，`preventDefault` 不阻止冒泡。`preventDefault` 只在 `event.cancelable === true` 的事件上有效，且**必须在监听器同步执行期间调用**——放进 `setTimeout` 或 `await` 之后就是静默失败，这是「明明 preventDefault 了还是跳了」的头号原因。

**`{ passive: true }` 是向浏览器承诺「我不会调 `preventDefault`」**，于是浏览器不必等你的回调就能立刻开始滚动，直接改善触摸滚动的手感。承诺的反面是：passive 监听器里调用 `preventDefault()` **无效**，控制台给出警告。

`wheel`、`mousewheel`、`touchstart`、`touchmove` 在 `window`、`document`、`document.documentElement` 和 `body` 上默认就是 `passive: true`（其他事件与其他目标默认 `false`）。所以想在这些位置阻止默认滚动，必须**显式**写 `{ passive: false }`，指望默认值是无效的。更根本的做法是：滚动监听器里只记标志位，真正的计算放进 `requestAnimationFrame`。

对委托型框架（Vue 在根节点挂原生监听器）来说，`stopPropagation` 是高危操作——事件传不到根，框架就收不到，出现「数据变了视图不动」的怪现象。要阻止传播请用框架的修饰符，而不是在回调里手调。

## 自定义事件与监听器生命周期

```js
list.dispatchEvent(new CustomEvent('task:toggle', { detail: { id: 42 }, bubbles: true }));
document.addEventListener('task:toggle', (e) => console.log(e.detail.id));
```

`bubbles: true` 决定委托能否收到，`composed: true` 决定能否穿过 Shadow DOM 边界。自定义数据只能挂在 `detail` 上（`Event` 没有 `detail`）。它适合「发送方不知道谁在听」的解耦通知，但没有函数签名那样的约束，字段改名只会在运行时炸——这正是 [TypeScript](/typescript/) 能改善的地方。

监听器的清理比添加更重要。`AbortController` 是目前最省事的方案：

```js
const controller = new AbortController();
const { signal } = controller;
button.addEventListener('click', onClick, { signal });
window.addEventListener('resize', onResize, { signal });
// 卸载时：
controller.abort();          // 一批全部解除，不需要保留函数引用
```

`signal` 同样能用于 `fetch`（见[下一章](/javascript/network-and-storage)）。另一个高频坑：`addEventListener` 靠「类型 + 回调引用 + capture」三者相同才去重，**每次传一个新写的匿名函数就会绑上多个监听器**——「点一次执行两次」基本就是它。

## 三个 Observer 各解决什么

| Observer | 观察什么 | 场景 | 关键注意 |
| --- | --- | --- | --- |
| `IntersectionObserver` | 元素与视口（或指定 `root`）的相交状态变化 | 图片懒加载、无限滚动哨兵、曝光埋点、吸顶提示 | 回调异步、不逐帧；用 `isIntersecting` 判方向；`threshold` / `rootMargin` 决定触发时机；滚动容器不是视口时**必须显式传 `root`**；`display: none` 视为完全不交；加载完记得 `unobserve` |
| `ResizeObserver` | 元素盒子尺寸变化 | 图表重绘、canvas 适配 DPR、容器查询兜底（[响应式](/css/responsive-design)） | **别在回调里改被观察元素的尺寸**，会触发循环依赖警告甚至丢帧 |
| `MutationObserver` | 子树结构 / 属性变化 | 观察外部脚本注入的节点、内容变化后重跑高亮 | 回调是微任务、批量到达，**必须自己节流**；自己改 DOM 会触发自己的回调，需要标志位断环；`subtree: true` 的范围尽量小 |

三者都是「浏览器替你轮询」。懒加载、吸顶、无限滚动这三类需求优先用它们而不是在 `scroll` 里手算坐标；至于快多少，本站没有在本机浏览器实测，不给数字。

## 渲染时机：把读和写分开

浏览器每帧大致按 处理输入 → 执行 JS（含 `requestAnimationFrame`）→ 样式重算 → 布局 → 绘制 → 合成 的顺序走。**你在 JS 里读布局属性时，若本帧已有未处理的样式改动，浏览器必须立刻把样式与布局算完**才能给数——强制同步布局（forced synchronous layout）。完整链路见[浏览器渲染机制](/frontend-engineering/rendering-pipeline)。

```js
for (const el of items) {                                   // 坏：读写交替，每项一次同步布局
  el.style.height = el.getBoundingClientRect().height * 2 + 'px';
}
const hs = items.map((el) => el.getBoundingClientRect().height);   // 好：先全部读
items.forEach((el, i) => { el.style.height = hs[i] * 2 + 'px'; }); // 再全部写
```

会触发布局读取的：`offsetTop/Left/Width/Height`、`client*`、`scroll*`、`getBoundingClientRect()`、`getComputedStyle()`。

`requestAnimationFrame` 用于把多次改动合并到一帧：

```js
let pending = false;
const scheduleRender = () => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
};
```

`requestIdleCallback` 适合真不着急的工作（埋点上报、预取），但并非所有浏览器都实现，用前判断 `window.requestIdleCallback` 是否存在。

## 表单交互：浏览器已经做完一半

```js
const data = new FormData(form);       // 按 name 收集，含 file；可直接作为 fetch 的 body
data.get('title');
form.elements.title.value;             // 具名控件直接取，比 querySelector 稳
form.reportValidity();                 // 触发原生校验并显示浏览器气泡，返回是否通过
form.checkValidity();                  // 只判断，不显示提示
```

细节见[表单](/html/forms)。`input` 与 `change` 的差别不只是「实时 vs 失焦」：

| 事件 | 触发时机 |
| --- | --- |
| `input` | 值变化时实时触发（文本框每次按键、`textarea`、可编辑区域） |
| `change` | 提交前值确实变了才触发：文本框在**失焦**时，复选/单选/下拉/文件**选定即触发** |

搜索联想用 `input` + 防抖，校验用 `blur` / `change`，用反了就是「打字时疯狂报错」。

受控与非受控是框架给这两种老写法起的名字：

| 取向 | 纯 JS 的样子 | 代价 |
| --- | --- | --- |
| 非受控 | DOM 是数据源，提交时 `new FormData(form)` 读一次 | 要做实时联动就得自己加监听器，写着写着就滑向受控 |
| 受控 | JS 状态是唯一数据源，`input` 里写回状态，`render()` 同步 `el.value` | 每次按键走一遍 JS + 重渲染，长表单能感到卡顿 |

判断：**要实时校验、联动、或把值显示在别处 → 受控；只在提交时读一次 → 非受控。**框架侧的对应写法见 [React 的 useRef 与受控组件](/react/refs-and-forms)和 [Vue 的模板语法](/vue/template-syntax)。

## 性能与泄漏：三条纪律

**批量插入**用 `DocumentFragment` 或一次 `replaceChildren`：

```js
const frag = new DocumentFragment();
for (const task of tasks) frag.append(buildLi(task));
list.replaceChildren(frag);           // 一次 DOM 变更
```

关于 fragment 要诚实：**现代浏览器里「循环 append 直接进容器」通常也不会每次重排**，渲染在帧末统一做。`DocumentFragment` 的真实价值是语义——子树构建完整后才挂上，中途不会有半成品被读到。差距明显的场景是**循环里读写交替**，那时病因是强制同步布局，把循环改成一次 `replaceChildren` 才对症。

**读写分离**：一次读全部、算完、一次写全部。

**清理成对**：泄漏的常见形态是 `window` 上的监听器没解绑、`setInterval` 闭包持有已删元素、Observer 从不 `disconnect`。确认方法：DevTools Memory 面板做两次 heap snapshot 对比，用 Detached Elements 视图看脱离文档却仍被 JS 引用的节点。

## 示例一：事件委托的可展开列表

<Callout type="unverified" title="以下三个示例未在本机浏览器运行">

本任务环境没有可用浏览器。这三段代码的语法与 API 用法对照 MDN 核实过，但**没有实际运行，本站不声称它们测试通过**。验证方法见本节末尾。

</Callout>

```js
const list = document.querySelector('#task-list');

function buildRow(task) {
  const li = document.createElement('li');
  li.className = 'task';
  li.dataset.id = String(task.id);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.dataset.action = 'toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', `detail-${task.id}`);
  const title = document.createElement('span');
  title.textContent = task.title;              // 用户输入走 textContent
  toggle.append(title);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.action = 'remove';
  remove.textContent = '删除';

  const detail = document.createElement('p');
  detail.id = `detail-${task.id}`;
  detail.hidden = true;
  detail.textContent = task.note ?? '（无备注）';

  li.append(toggle, remove, detail);
  return li;
}

function render(tasks) {
  list.replaceChildren(...tasks.map(buildRow));   // 换行不动容器，委托监听器一直有效
}

list.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn || !list.contains(btn)) return;          // 目标不在本容器：不是我们的事件
  const row = btn.closest('li.task');
  if (!row) return;                                 // 每层 closest 都判空

  if (btn.dataset.action === 'toggle') {
    const detail = row.querySelector('.task__detail');
    detail.hidden = !detail.hidden;
    btn.setAttribute('aria-expanded', String(!detail.hidden));
  } else if (btn.dataset.action === 'remove') {
    row.remove();                                   // 删行不需要解绑任何东西
    if (!list.children.length) showEmptyState();
  }
});

function showEmptyState() {
  const p = document.createElement('p');
  p.textContent = '这里空空如也。';
  list.replaceChildren(p);
}

export { render };
```

**为什么一个监听器就够**：`list` 全程不被替换，`event.target` 可能是内部的 `<span>`，靠 `closest('button[data-action]')` 爬回按钮。**如果直接读 `event.target.dataset.action`，点在 span 上就是 `undefined`**——这是委托最常见的写法错误。

## 示例二：IntersectionObserver 图片懒加载

```js
const observer = new IntersectionObserver((entries, obs) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const img = entry.target;
    const src = img.getAttribute('data-src');           // 与 img.dataset.src 等价，写法更直白
    if (src) {
      img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
      img.addEventListener('error', () => img.classList.add('is-broken'), { once: true });
      img.src = src;
    }
    obs.unobserve(img);                                  // 加载过一次就停止观察
  }
}, {
  root: null,                     // null = 视口；滚动容器不是视口时必须显式传
  rootMargin: '200px 0px',        // 提前两屏开始加载
  threshold: 0,                   // 有一像素进入就触发
});

export function observeLazyImages(scope = document) {
  for (const img of scope.querySelectorAll('img[data-src]')) observer.observe(img);
}
export function disconnectLazy() { observer.disconnect(); }   // 组件卸载时必调
```

三个要点：不 `unobserve` 会重复触发；`root` 在自定义滚动容器下必须传；`disconnect` 要在卸载时调。**先考虑原生 `img loading="lazy"`**，`IntersectionObserver` 的价值在于需要自定义提前量、要处理背景图或非 `img` 元素、或进入视口时要触发别的逻辑（曝光、吸顶）。

## 示例三：键盘可操作的折叠面板

<Callout type="warn" title="手风琴的无障碍要求比视觉表现更难">

用 div 加点击监听做出来的折叠面板，键盘用户完全无法操作。免费的语义化方案是原生 [details 与 summary](/html/forms)，能用就用；必须手写的场景是：展开后要异步加载内容、或多面板状态需要持久化。下面这版支持 Enter、Space、方向键、Home、End。

</Callout>

```js
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

class Accordion {
  constructor(root) {
    this.root = root;
    this.controller = new AbortController();
    this.bind();
  }
  get buttons() { return [...this.root.querySelectorAll('.acc__button')]; }

  bind() {
    const { signal } = this.controller;
    this.root.addEventListener('click', (event) => {
      const btn = event.target.closest('.acc__button');
      if (btn && this.root.contains(btn)) this.toggle(btn);
    }, { signal });

    this.root.addEventListener('keydown', (event) => {
      const btn = event.target.closest('.acc__button');
      if (!btn) return;
      const bs = this.buttons, i = bs.indexOf(btn);
      const move = (n) => { event.preventDefault(); bs[n].focus(); };   // 阻止方向键滚页
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') move((i + 1) % bs.length);
      else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') move((i - 1 + bs.length) % bs.length);
      else if (event.key === 'Home') move(0);
      else if (event.key === 'End') move(bs.length - 1);
      // Enter 与 Space 由 button 原生触发 click。换成 div 就得自己补这两个键——
      // 这正是必须用 button 的理由。
    }, { signal });
  }

  toggle(button) {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;
    const willOpen = button.getAttribute('aria-expanded') === 'false';
    button.setAttribute('aria-expanded', String(willOpen));
    panel.hidden = !willOpen;                 // hidden 同时管视觉与无障碍树，不用 aria-hidden
    if (willOpen && !panel.dataset.loaded) this.loadPanel(panel);
    if (!reduce) panel.classList.add('acc__panel--anim');   // 动效见 CSS 过渡章节
  }

  async loadPanel(panel) {
    panel.dataset.loaded = 'loading';
    panel.textContent = '正在加载…';
    await new Promise((r) => setTimeout(r, 300));    // 占位：真实项目在这里 fetch
    panel.textContent = '内容已就绪。';
    panel.dataset.loaded = 'done';
  }

  destroy() { this.controller.abort(); }             // 一批监听器全解除
}
export { Accordion };
```

HTML 必须配得上这段 JS：

```html
<div class="acc">
  <h3><button class="acc__button" type="button" id="btn-1"
      aria-expanded="false" aria-controls="panel-1">配送范围</button></h3>
  <div class="acc__panel" id="panel-1" role="region" aria-labelledby="btn-1" hidden>内容</div>
</div>
```

自查：`aria-expanded` 与 `hidden` 必须始终一致（不一致会让读屏说「已展开」而内容找不到）；`aria-controls` 指向的 id 必须真实存在；标题层级不能省，读屏用户靠标题跳转；要记住折叠状态就存 `localStorage`，别塞进 DOM。**验证方式：拔掉鼠标，只用 Tab、Enter、方向键走一遍，再开系统读屏听一遍。**

三个示例的本地验证步骤：

```bash
# 1. 建 test.html，用 <script type="module"> 引入上面的 js 文件
# 2. 起本地静态服务器（不要直接 file:// 打开，模块与部分 API 会受限）
npx --yes serve -l 8080 .
# 3. 打开 http://localhost:8080/test.html，按 F12 进 Console
```

Console 里逐条确认：`document.querySelectorAll('#task-list li').length` 与数据条数一致；DevTools 控制台里 `getEventListeners(document.querySelector('#task-list')).click.length === 1`（该函数只在控制台可用）；点击后 `document.querySelectorAll('[aria-expanded="true"]').length` 随之变化；在 IntersectionObserver 回调里打断点，看 `entries` 是否分批到达、`unobserve` 后不再触发。

## 常见错误与排查

**1. 新渲染的列表项点不动，旧项正常。** 现象：点击无反应。原因：监听器绑在每个 `<li>` 上，而重建渲染销毁了旧节点。确认：Console 里 `getEventListeners(list)` 看容器有没有监听器；或临时把渲染改成只追加，追加项能点就确诊。修法：把监听器绑在不会被替换的容器上做委托。

**2. 点一次按钮，处理函数跑两次。** 原因：每次渲染都传一个新的匿名函数去 `addEventListener`，引用不同浏览器就不去重。确认：`getEventListeners(el).click.length > 1`。修法：传同一个函数引用，或用 `AbortController` 的 `signal` 在重绑前 `abort()`；一次性交互用 `{ once: true }`。

**3. `preventDefault()` 不生效，链接还是跳了。** 三种原因：调用被放进了 `await` / `setTimeout` 之后的异步位置；事件 `cancelable === false`；监听器是 passive（`wheel` / `touchmove` 在 window/document/body 上默认如此）。确认：调用前打印 `event.cancelable`，并检查注册时的 options。修法：把 `preventDefault()` 挪到回调最开头的同步位置；需要阻止默认滚动时显式 `{ passive: false }`。

**4. `event.target.dataset.id` 是 `undefined`。** 原因：点到了按钮内部的 `span` 或 `svg`，`target` 是最深元素。确认：`console.log(event.target.tagName)`。修法：先 `event.target.closest('[data-id]')` 再读 dataset，并对结果判空。

**5. 循环 removeChild 只删掉一半节点。** 原因：`childNodes` / `children` 是实时集合，删除后索引整体前移。确认：循环前记 `length`，结束后数剩余。修法：`replaceChildren()` 一次清空，或 `while (box.firstElementChild) box.firstElementChild.remove()`。

**6. 设了 `hidden = true` 元素还在；或可见内容被读屏跳过。** 原因：项目 CSS 里 `[hidden] { display: block }` 覆盖了 UA 样式；或者你其实用了 `aria-hidden="true"`，它只影响无障碍树不影响渲染。确认：Computed 面板看 `display`；Accessibility 面板看节点是否真的从树里消失。修法：补 `[hidden] { display: none !important; }`；「视觉与读屏都隐藏」用 `hidden`，只有「装饰内容对读屏静音」才用 `aria-hidden`（见[无障碍](/html/accessibility)）。

**7. 用 `setAttribute('value', x)` 想清空输入框，清不掉。** 原因：attribute 是默认值，property 才是当前值。确认：`input.getAttribute('value')` 与 `input.value` 读数不一致。修法：写 `input.value = ''`；要重置到初始值用 `form.reset()`。

**8. 滚动时很卡，Performance 面板里满屏紫色 Layout。** 原因：`scroll` 监听器里读 `getBoundingClientRect` / `offsetTop` 后紧接着写样式，触发强制同步布局。确认：录一次 Performance，看 `Event: scroll` 下是否嵌套 `Layout` 块，数量是否随元素数线性增长。修法：读写分离；或改用 `IntersectionObserver`；不需要阻止默认时加 `{ passive: true }`。

**9. `getComputedStyle` 与 `offsetWidth` 读到的宽度是 0。** 原因：元素或祖先是 `display: none`，不产生盒子。确认：`el.offsetParent === null`。修法：先可见再量，或用 `visibility: hidden` + 绝对定位的离屏量法；能交给 CSS 的尺寸别用 JS 算。

**10. 插值用户输入后，页面出现不该有的图片或链接。** 原因：`insertAdjacentHTML` / `innerHTML` 把数据当 HTML 解析——这是 XSS 注入点。确认：在本地 demo 里输入 `<img src=x onerror=console.log(1)>` 看是否执行（**不要在真实站点做这个实验**）。修法：数据一律 `textContent`；必须拼 HTML 时先做转义，服务器侧再加 CSP（[Web 安全](/backend/web-security)）。

**11. 组件卸载后定时器还在跑、内存持续上涨。** 原因：`window` 监听器、`setInterval`、Observer 都没清理。确认：两次 heap snapshot 对比，或 `getEventListeners(window)` 的条目数随路由切换单调递增。修法：副作用成对出现，统一用 `AbortController` + `clearInterval` + `disconnect()`。

## 练习

<Exercise title="练习 1 · target 与 currentTarget" difficulty="基础">

点击内部的 `b` 元素时，四条 `console.log` 分别输出什么？

```html
<ul id="list"><li data-id="1"><b>标题</b></li></ul>
```

```js
document.getElementById('list').addEventListener('click', (event) => {
  console.log(1, event.target.tagName);
  console.log(2, event.currentTarget.id);
  console.log(3, event.target.closest('li')?.dataset.id);
  console.log(4, event.target.dataset.id);
});
```

<template #answer>

| 序号 | 输出 | 为什么 |
| --- | --- | --- |
| 1 | `B` | `target` 是被点的**最深元素** |
| 2 | `list` | `currentTarget` 恒等于当前监听器绑定的元素 |
| 3 | `1` | `closest` 从 `b` 向上命中 `li[data-id="1"]` |
| 4 | `undefined` | `b` 上没有 `data-id` |

所以委托里**必须 `closest` 之后再读 dataset**。如果点在 `li` 的空白区域，第 1 条变成 `LI`、第 4 条变成 `1`：同一段代码两种结果，行为取决于用户点中哪个子元素——这正是委托 bug 难复现的原因。

</template>

</Exercise>

<Exercise title="练习 2 · 删掉一半节点的那个循环" difficulty="基础">

盒子里有 6 个 `li`（之间有换行缩进）。写出 A、B 两段各剩几个元素，并说明差异来源。

```js
// A
const live = box.childNodes;
for (let i = 0; i < live.length; i++) box.removeChild(live[i]);

// B
const arr = Array.from(box.children);
for (let i = 0; i < arr.length; i++) arr[i].remove();
```

<template #answer>

**B 剩 0 个**：`Array.from` 把实时集合拷成静态数组，删谁都不影响数组内容。

**A 剩的比 0 多且不确定**，两重原因叠加。第一重是实时集合：删掉 `live[0]` 后原 `live[1]` 变成 `live[0]`，循环每次实际跳过一半，若只有 6 个元素且**没有空白文本节点**，结果是剩 3 个。第二重是 `childNodes` 含文本节点：源码里 `li` 之间的换行缩进各产生一个 `TEXT_NODE`，`live.length` 可能是 12 而不是 6，被删掉的交替元素里一半是空白文本节点，**剩下的 `li` 数量取决于排版方式**。

**修法**：`box.replaceChildren()` 一次清空，或 `while (box.firstElementChild) box.firstElementChild.remove();`。判据是「集合是否实时」+「是否含非元素节点」，两条都要看。

</template>

</Exercise>

<Exercise title="练习 3 · 哪些交互能委托" difficulty="基础">

判断下面五项能否用「容器上的一个监听器」实现，不能的给出替代方案。

| 交互 | 能否委托 |
| --- | --- |
| 点击行内按钮删除 | ? |
| 输入框获得焦点时高亮整行 | ? |
| 鼠标移到某项上显示 tooltip | ? |
| 输入框每次按键实时统计字数 | ? |
| 滚轮在列表区域缩放 | ? |

<template #answer>

| 交互 | 结论 | 依据 / 替代 |
| --- | --- | --- |
| 点击删除 | **能** | `click` 冒泡 |
| 聚焦高亮 | **`focus` 不行** | `focus` / `blur` 不冒泡；换 `focusin` / `focusout`，或 `{ capture: true }` |
| 悬停 tooltip | **`mouseenter` 不行** | 不冒泡；换 `mouseover` / `mouseout` 并用 `relatedTarget` 判断是否真的离开，或逐项绑 |
| 实时字数 | **能** | `input` 冒泡（Vue 的根节点事件委托就建立在这一点上） |
| 滚轮缩放 | **能，但有代价** | `wheel` 冒泡；绑在 window/document/body 时默认 passive，要 `preventDefault` 必须显式 `{ passive: false }` |

口诀：**冒泡的事件才能委托；不冒泡的要么换冒泡的同族事件，要么用捕获，要么逐项绑。**

</template>

</Exercise>

<Exercise title="练习 4 · 故意制造一次强制同步布局" difficulty="进阶">

下面这段代码被确认有性能问题。指出病根、浏览器多做了什么、在 DevTools 里怎么**证明**，并给出改写。

```js
cards.forEach((card) => {
  const h = card.getBoundingClientRect().height;
  card.style.marginTop = `${20 - (h % 20)}px`;
});
```

<template #answer>

病根是**循环内读写交替**：读 `getBoundingClientRect()` 要求样式与布局是最新的；写 `marginTop` 立刻让布局失效；下一轮再读，浏览器只能同步把布局重算一遍。N 张卡片 → N 次同步布局，全部阻塞主线程。

**证明**：DevTools → Performance → Record，跑这段代码，停止。在 Main 轨道数 `Layout`（紫色）块：应当与卡片数量同阶，点开能看到触发的 JS 行号。把卡片从 50 改成 500 再录一次，紫色块同步暴增即确诊。

改写：读写分离，中间不读布局。

```js
const hs = cards.map((card) => card.getBoundingClientRect().height);   // 阶段 1：全部读
cards.forEach((card, i) => { card.style.marginTop = `${20 - (hs[i] % 20)}px`; });  // 阶段 2：全部写
```

修好后 Performance 里应当只出现一次 `Layout`。若这类改动要在滚动中反复发生，整块放进 `requestAnimationFrame`，一帧最多一次。

</template>

</Exercise>

<Exercise title="练习 5 · 把 passive 用反了" difficulty="挑战">

需求：手势区域在 `touchmove` 时阻止页面滚动、只更新元素位移。开发者为了性能写了：

```js
area.addEventListener('touchmove', (e) => {
  e.preventDefault();
  move(e.touches[0]);
}, { passive: true });
```

结果页面照滚、位移乱套。请解释（1）为什么拦截失败；（2）`passive: true` 在这里带来什么后果；（3）正确写法，以及能否「既 passive 又能阻止默认」。

<template #answer>

（1）`passive: true` 是对浏览器的承诺「我不会调用 `preventDefault`」。浏览器因此不等回调就开始滚动，你的 `preventDefault()` 被静默忽略（控制台出现警告），页面照滚。

（2）默认行为失控；且滚动已与 JS 解耦先行，回调里拿到的坐标与画面不同步，表现为位移抖动或滞后。

（3）必须显式声明为非 passive：

```js
area.addEventListener('touchmove', (e) => {
  e.preventDefault();            // 同步调用才有效
  move(e.touches[0]);
}, { passive: false });
```

**「既 passive 又能阻止默认」不存在**，两个选项语义互斥。想同时要滚动手感与手势拦截，只能换设计：用 CSS `touch-action: none` 把拦截交给合成器（不占用主线程），或保持 passive 并把计算挪进 `requestAnimationFrame`。另外：`touchstart` / `touchmove` 只在 window、document、documentElement、body 上默认 passive，普通元素默认仍是 `false`——**别指望默认值，显式写出来。**

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN `addEventListener` 的 options](https://developer.mozilla.org/zh-CN/docs/Web/API/EventTarget/addEventListener) —— 核实 `passive` 默认 `false`、`wheel`/`mousewheel`/`touchstart`/`touchmove` 在 window/document/documentElement/body 上默认 `passive: true`、passive 内调用 `preventDefault` 无效（核实于 2026-10-17，本章 passive 一节与练习 5 的依据）。
- [MDN `querySelectorAll`](https://developer.mozilla.org/zh-CN/docs/Web/API/Document/querySelectorAll) —— 核实返回静态 NodeList，与 `children` / `childNodes` 的实时性对照（练习 2 依据）。
- [MDN `insertAdjacentHTML`](https://developer.mozilla.org/zh-CN/docs/Web/API/Element/insertAdjacentHTML) —— 核实四个位置名与页面顶部的注入风险警告（示例一不用它拼用户数据的依据）。
- [MDN `getBoundingClientRect`](https://developer.mozilla.org/zh-CN/docs/Web/API/Element/getBoundingClientRect) —— 核实坐标相对视口、含 transform、`display: none` 时全 0（测量表与错误 9 依据）。
- [MDN `IntersectionObserver`](https://developer.mozilla.org/zh-CN/docs/Web/API/IntersectionObserver) —— 核实 `root` / `rootMargin` / `threshold` 语义与「不可见元素视为不相交」（示例二依据）。
- [MDN `requestAnimationFrame`](https://developer.mozilla.org/zh-CN/docs/Web/API/Window/requestAnimationFrame) —— 核实回调在样式重算与布局之前执行（读写分离一节依据）。
- [javascript.info · 事件委托](https://javascript.info/event-delegation) —— 委托一节的对照读物，含更多 `closest` 示例。
- [javascript.info · 浏览器默认行为](https://javascript.info/default-browser-action) —— `preventDefault` 与 `cancelable` 的补充。

## 下一章

DOM 与事件管的是页面内部；一旦要向服务器取数据，约束就换了整套：同源策略决定你**能不能读**响应，CORS 头是服务器给的放行凭证，而 token 存错地方会直接泄露给任何能执行脚本的代码。下一章 [fetch、同源策略与浏览器存储](/javascript/network-and-storage) 讲这些外部约束，并把本章的 `AbortController`、`FormData` 接到真实请求上。之后的[错误处理与 DevTools 调试](/javascript/errors-and-debugging) 会给你一套定位本章事件与布局问题的操作路径，[阶段项目](/javascript/project) 要求列表全部用一次委托实现。
