# fetch、同源策略与浏览器存储：请求为什么被拦，token 该放哪

浏览器里报了 `CORS policy` 错误，你打开 Network 面板却发现那个请求**返回的是 200，数据就在响应体里**；接口返回 404，你的 `then` 却照常执行，最后崩在页面深处一句 `Cannot read properties of undefined`；登录态存在 `localStorage` 里，某天发现有人用一段注入脚本把它读走了。这三种现象对应三个不同的机制：同源策略拦的是**读取**不是发送、`fetch` 不会把 HTTP 错误变成 rejected、以及把凭证放在了可被脚本读取的地方。

前端只管「怎么把请求发对、把结果读对、把该放的放在该放的地方」。这一章把这三件事的边界讲清楚，其中请求封装部分的代码是**在 Node v25.4.0 上真跑过的**，报错文案直接抄自输出。

## 同源策略到底限制什么

同源（same-origin）判定只看三件事：**协议、主机名、端口**。三者全等才算同源，其他都算跨源。

| 页面所在源 | 请求的目标 | 同源？ |
| --- | --- | --- |
| `https://app.example.com` | `https://app.example.com/api/tasks` | 是 |
| `https://app.example.com` | `http://app.example.com/api/tasks` | **否**（协议不同） |
| `https://app.example.com` | `https://api.example.com/tasks` | **否**（主机名不同，子域也算不同） |
| `https://app.example.com` | `https://app.example.com:8443/api` | **否**（端口不同） |

关键认知是这三条：

- **它限制的是「脚本能否读取跨源响应的内容」**，不限制请求被发出去。带 `mode: 'no-cors'` 的请求确实会到达服务器并执行，只是响应对你不可读（拿到的是不透明的 opaque response）。**「跨域问题」不是发不出去，是读不回来。**
- **它不限制资源加载**：`img`、`script`、`link`、`video` 可以跨源加载，这是 CDN 能工作的前提。代价是这些请求不走你站点的 cookie 语义，需要凭据时用 `crossorigin` 与 `credentials` 属性显式声明。
- **它由浏览器强制执行**。服务器发出的响应本身没有任何「被拒绝」的痕迹——拒绝发生在浏览器收到响应、检查访问控制头之后。所以非浏览器的调用方（curl、Node 服务、移动端原生层）根本不受这套规则约束。

## 简单请求、预检，以及 Origin 头

浏览器把跨源请求分两类，判断标准是**方法 + 手动设置的头 + Content-Type** 三项都落在白名单内才算「简单请求」，可以直接发；任何一项越界，就先发一个 `OPTIONS` 的**预检（preflight）**去问服务器允不允许。

| 条件 | 简单请求的边界（以下之外的都会触发预检） |
| --- | --- |
| 方法 | `GET`、`HEAD`、`POST` |
| 手动设置的头 | 只有 `Accept`、`Accept-Language`、`Content-Language`、`Range`、`Content-Type` |
| `Content-Type` 的取值 | 只有 `application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain` |

对照到日常代码，这几条是最常见的触发源：

```js
fetch('/api/tasks', { method: 'DELETE' });                    // 触发预检：方法越界
fetch(url, { headers: { Authorization: `Bearer ${token}` } }); // 触发预检：自定义头
fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); // 触发预检：JSON 不在白名单
fetch(url, { method: 'POST', body: new FormData(form) });     // 简单请求
```

**带 `Authorization` 头的接口一定会走预检。**这不是缺陷，预检结果可以被 `Access-Control-Max-Age` 缓存，同一 URL 的后续请求不必重复问。预检被服务器挡下时，你在 Network 面板看到的是一个红色的 `OPTIONS` 请求，而不是真正的那个业务请求——排查时先看 `OPTIONS` 的响应头。

服务器侧决定放行的头：

| 响应头 | 作用 |
| --- | --- |
| `Access-Control-Allow-Origin` | 允许哪个源读响应，写具体源或 `*` |
| `Access-Control-Allow-Methods` | 预检应答里允许的方法 |
| `Access-Control-Allow-Headers` | 预检应答里允许的头 |
| `Access-Control-Allow-Credentials` | 是否允许携带凭据，值必须是 `true` |
| `Access-Control-Expose-Headers` | 允许 JS 读取的非简单响应头 |
| `Access-Control-Max-Age` | 预检结果缓存时长（秒） |

请求侧浏览器会带上 `Origin`，任何访问控制请求都带。

关于 cookie 与凭据，三条必须一起成立，缺一条就失败：

```js
fetch('https://api.example.com/me', { credentials: 'include' });   // 前端：显式带凭据
// 服务器：Access-Control-Allow-Credentials: true
// 服务器：Access-Control-Allow-Origin 必须是具体源，写 * 会被浏览器判为无效
```

`fetch` 的 `credentials` 默认值是 `same-origin`——同源请求带 cookie，跨源不带。所以「跨域请求带不上登录 cookie」九成是这两处之一没对齐，而不是前端代码写错。

<Callout type="warn" title="CORS 是服务器的职责，前端绕不过">

浏览器不允许你用任何前端手段绕过同源检查。开发期的正道是让请求变成**同源**：Vite 的 dev server proxy 把 `/api` 转发到后端（见 [Vite 开发侧](/frontend-engineering/vite-dev)），生产期让前端与 API 同域（Nginx 反代，见 [Nginx](/linux/nginx)），或者用对象存储/CDN 的资源共享。除此之外，「用 JSONP」「用某个公共代理站转发」这类方案要么只支持 GET、要么把数据交给第三方，都是安全债。真正的修复只有一处：[后端把访问控制头配对](/backend/fastify-basics)，原理见 [Web 安全](/backend/web-security)。

</Callout>

## fetch：响应对象、身体与那一堆选项

`fetch(url, init)` 返回 `Promise<Response>`。**它只在请求「完全发不出去」时才 reject**——DNS 失败、网络断开、被 CORS 拦下、被 `signal` 取消，这四类才是 rejection。

```js
const res = await fetch('/api/tasks/999');    // 服务器返回 404：res 正常拿到，不 reject
res.ok;                                       // false —— 状态码 200–299 才是 true
res.status; res.statusText; res.url; res.redirected; res.type;   // 'cors' | 'basic' | 'opaque' …
res.headers.get('content-type');
```

**这是本章第一大坑**：`await fetch(...)` 成功不代表接口成功，必须自己检查 `res.ok` 或 `res.status`。忘了这一步，`await res.json()` 会返回那个 404 的 JSON 错误体，或者 HTML 页面，然后在下游某处炸出一个完全看不出来源的 `undefined` 报错。

响应体（body）是**一次性流**，只能读一次，读完再读直接抛错：

```js
const text = await res.text();     // Body 是流，选一个方法读
await res.json();                  // text 的 JSON.parse 便捷版
await res.blob();                  // 二进制/文件
await res.arrayBuffer();           // 需要手动解码时
await res.formData();              // multipart 表单
const bytes = await res.bytes();   // Uint8Array
```

<Callout type="info" title="先落成文本，再决定怎么解析">

需要打日志、需要给错误消息带上原始响应体时，务必 `const text = await res.text()` 存下来，再用 `JSON.parse(text)` 或 `res.ok` 分支。**这样 body 只被读一次**，`HttpError` 也能带上原始内容方便排查——下一节那个封装就是这么写的。

</Callout>

`RequestInit` 的选项里，日常会用到的：

| 选项 | 说明与注意 |
| --- | --- |
| `method` | 默认 `GET`；`HEAD`/`POST` 是简单方法 |
| `headers` | 普通对象或 `Headers`；手动设置非白名单头会触发预检 |
| `body` | `string`、`FormData`、`Blob`、`ArrayBuffer`、`URLSearchParams`、`ReadableStream`；**GET/HEAD 不能带 body** |
| `credentials` | `same-origin`（默认）/ `include` / `omit` |
| `mode` | `cors`（默认）/ `no-cors`（响应不可读）/ `same-origin`（跨源直接报错） |
| `cache` | `default`、`no-store`、`reload`、`force-cache`、`only-if-cached`、`no-cache`；要「每次最新」用 `no-store`，尊重服务器缓存头用默认 |
| `redirect` | `follow`（默认）/ `manual`（自己处理，`type` 是 `opaqueredirect`）/ `error` |
| `signal` | `AbortController` 的 `signal`，用于超时与取消 |
| `keepalive` | 页面卸载后继续发送，有大小上限，用途见下面的 `sendBeacon` |

超时与取消都靠 `signal`，`fetch` 没有 `timeout` 选项：

```js
const { signal } = new AbortController();
setTimeout(() => controller.abort(new Error('用户取消')), 10000);

const res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
```

`AbortSignal.timeout(8000)` 到点自动 abort，中断原因是 `TimeoutError`；`AbortSignal.any([...])` 把多个信号合成一个，任一触发即中断，`reason` 取最先触发的那个。这两个方法在浏览器里属于较新的特性（`AbortSignal.any` 是 2024 年才实现，见[MDN 对应页](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static)），目标浏览器较老时改回手写 `AbortController` + `setTimeout`。

取消的实际价值不止超时：**搜索框每个按键发一次请求，必须在发下一个之前取消上一个**，否则响应回来的顺序和输入的顺序不一致，用户看到的结果是旧关键词的。这是「重复提交」最常见的形态，比连点按钮更隐蔽。

## 错误要分四层，每层的判断方式不同

```js
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res, text);        // ② HTTP 层：必须自己抛
  return JSON.parse(text);                               // ③ 解析层
} catch (err) {
  // ① 网络层：TypeError ④ 中断层：AbortError / TimeoutError
}
```

| 层 | 怎么判断 | 本机实际报错文案（Node v25.4.0） | 能不能重试 |
| --- | --- | --- | --- |
| 网络层 | `err instanceof TypeError` | `TypeError: fetch failed`，`err.cause.code === 'ECONNREFUSED'` | **可以**，指数退避 |
| HTTP 层 | `!res.ok`，或 `res.status` | 自己造的 `HttpError`，带 `status` | 看状态码：408/425/429/5xx 可重试，400/401/403/404 不重试 |
| 解析层 | `err instanceof SyntaxError` | `SyntaxError: Expected double-quoted property name in JSON at position 10 (line 1 column 11)` | **不要**，重试只会再拿到同一份坏数据 |
| 中断层 | `err.name === 'AbortError' / 'TimeoutError'` | `AbortError: This operation was aborted` / `TimeoutError: The operation was aborted due to timeout` | 超时是「没收到」：**只有幂等请求才能重试** |

中断层里还要再分一层：**是用户主动取消还是超时**。判断方法不是看错误名，而是看你自己传进去的 reason——`AbortSignal.timeout()` 给的 reason 是 `TimeoutError`，`controller.abort(new Error(...))` 给的是你那个对象，外部信号已 abort 时直接当作用户取消处理。

`err.cause` 是排查网络层的关键：`fetch failed` 本身没有信息量，真正的原因在 `cause` 里（`ECONNREFUSED`、`ECONNRESET`、`ENOTFOUND`、证书错误）。浏览器里 `cause` 的可读性不如 Node，此时先看 Network 面板那一行的状态列：显示 `(failed)` 且 Status 为 0，就是这一层。

重试的三条纪律：**① 只重试幂等操作**（`GET` 安全，`POST` 下单不安全——除非服务器支持幂等键）；**② 退避要带抖动**，`delay * 2 ** attempt + Math.random() * 100`，避免所有客户端同步重试把服务器打得更死；**③ 尊重 `Retry-After`**，429 响应头里服务器已经告诉你该等多久。

## 为什么不再首选 XMLHttpRequest

XHR 能做的事 `fetch` 基本都能做，反过来不成立。两者的历史分工：

| 需求 | XHR 时代 | 现在 |
| --- | --- | --- |
| 上传 / 下载进度 | `xhr.upload.onprogress` / `xhr.onprogress` | `fetch` 无上传进度事件：用 `ReadableStream` 包 body 自己计数，或保留这一小段 XHR；下载进度用 `response.body.getReader()` 边读边累计（见[流式响应](/ai-apps/streaming)） |
| 取消与超时 | `xhr.abort()` / `xhr.timeout` | `AbortController` + `AbortSignal.timeout()`，语义更清楚 |
| 跨源 | `XDomainRequest`（IE）、JSONP | CORS |
| 事件风格与流式读取 | `readystatechange` + 一堆回调，做不到分块消费 | `Promise` / `async`，能进 `try/catch`，`ReadableStream` 支持分块 |

`fetch` 的代价是：默认没有进度、默认 `credentials: 'same-origin'`（很多人以为「跨域带不上 cookie」是服务器问题，其实第一处在这个默认值上）、HTTP 错误不 reject。**这三条恰好是它常被误解的原因**，而不是回到 XHR 的理由。

## POST 的三种编码，与后端怎么接

`Content-Type` 决定请求体被怎么序列化，也决定服务器要用什么方式解析。

| 编码 | 前端写法 | 请求体长什么样 | 服务器侧 |
| --- | --- | --- | --- |
| `application/json` | `JSON.stringify(data)`，**手动设头** | `{"name":"写正文"}` | Fastify 原生支持；多数框架需 JSON 解析器 |
| `application/x-www-form-urlencoded` | `new URLSearchParams(data)`，或 `FormData`（无文件时浏览器自动用这个） | `name=%E5%86%99%E6%AD%A3%E6%96%87&tag=urgent` | 需要表单解析中间件（Fastify 要 `@fastify/formbody`） |
| `multipart/form-data` | `new FormData(form)`，**绝对不要手动设 Content-Type** | 带 boundary 的分段体 | 需要 multipart 插件，有文件大小限制 |

第三条是高频错误：`FormData` 作为 body 时**不能**手写 `Content-Type: multipart/form-data`——boundary 是浏览器生成的，你设了头就覆盖了它，服务器解析不出字段，收到的是一份「空 body」。正确做法是**让 fetch 自己决定**：

```js
const form = document.querySelector('#task-form');
await fetch('/api/tasks', { method: 'POST', body: new FormData(form) });      // 编码自动是 multipart 或 urlencoded
await fetch('/api/search', { method: 'POST', body: new URLSearchParams({ q }) });
await fetch('/api/tasks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title }),
});
```

[表单](/html/forms)的 HTML 属性 `enctype` 只作用于原生提交（也就是不推荐的做法，原因见 [DOM 与事件](/javascript/dom-and-events)的表单一节），前端接管提交后编码完全由上面的 body 类型决定。后端侧的对应解析在 [Fastify 入门](/backend/fastify-basics)讲。

## 下载文件、sendBeacon

从接口拿二进制并存成文件：

```js
const res = await fetch('/api/export', { signal: AbortSignal.timeout(30000) });
if (!res.ok) throw new HttpError(res, await res.text());
const blob = await res.blob();

const href = URL.createObjectURL(blob);           // 生成 blob: 协议的同源临时 URL
const a = document.createElement('a');
a.href = href;
a.download = 'tasks.csv';                          // 文件名；跨源资源会忽略这个属性
a.click();
setTimeout(() => URL.revokeObjectURL(href), 1000); // 立即 revoke 有概率赶在下载真正开始之前
```

文件名应当由服务器的 `Content-Disposition` 给出，不要在前端拼字符串——用户可控的文件名里带换行或引号会污染响应头。**Blob URL 必须 revoke**（延后一点再撤，给浏览器留出开始下载的时间），否则这份引用要等到页面卸载才释放，这是最典型的一类「没有泄漏代码但内存一直涨」。

`navigator.sendBeacon(url, data)` 用于「页面即将不可见时把数据发出去」：异步、非阻塞、POST、页面卸载后仍能送达，返回 `true` **只表示已加入队列，不表示服务器收到了**。浏览器对单次 beacon 的数据量有上限，塞大对象属于误用。

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    navigator.sendBeacon('/api/analytics', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  }
});
```

它并没有被废弃：MDN 上它仍是 widely available 的正式 API（核实于 2026-10-17），页面里给的建议是——需要非 POST 方法、需要自定义请求头、或需要读响应时，改用 `fetch` 配 `keepalive: true`。

## 轮询、SSE、WebSocket：三档选择

| 方案 | 方向 | 延迟 | 服务器成本 | 适用 |
| --- | --- | --- | --- | --- |
| 短轮询 | 客户端定时拉 | 取决于间隔 | 每次都要握手 + 带请求头，浪费明显 | 变化慢、允许延迟的数据 |
| 长轮询 | 服务器挂住请求直到有变化 | 中 | 连接被长期占用 | 老环境兜底 |
| SSE | 服务器 → 客户端单向推流 | 低 | 一条 HTTP 连接，走普通 HTTP 语义 | 通知流、进度、LLM 逐 token 输出 |
| WebSocket | 双向 | 最低 | 协议升级后的长连接，需要额外基础设施 | 聊天、协作光标、游戏 |

**先把轮询间隔和「数据多久变一次」对齐，再考虑要不要升级到推送。**真要升级时，SSE 的入门成本远低于 WebSocket：它就是 HTTP，鉴权、日志、Nginx 配置全是熟路。细节见[为什么请求-响应不够](/realtime/why-http-is-not-enough)、[SSE](/realtime/sse) 与 [WebSocket 协议](/realtime/websocket-protocol)。

## 存储：四种地方，边界各不相同

| | `localStorage` | `sessionStorage` | `IndexedDB` | `cookie` |
| --- | --- | --- | --- | --- |
| 调用方式 | **同步**，阻塞主线程 | 同步 | **异步**（Promise 风格） | 读写 `document.cookie` 字符串 |
| 能存什么 | 字符串，自己 `JSON.stringify` | 字符串 | 结构化克隆：对象、数组、`Blob`、`File`、`Date` | 字符串，且要 URL 编码 |
| 生命周期 | 除非主动清，否则一直留着（清站点数据会没） | 标签页关闭即清 | 除非主动清 | 由 `Max-Age` / `Expires` 决定 |
| 作用域 | 按源隔离 | 按源 + **单个标签页** | 按源 | 按域 / 路径，**同源的所有子域可共享** |
| 容量 | 各浏览器不统一（见下方标注） | 同上 | 可到几百 MB 级，取决于剩余磁盘 | 约 4 KB 级，超出直接截断 |
| 会不会随请求自动发给服务器 | 不会 | 不会 | 不会 | **每次都会**（受 `Domain`/`Path` 约束） |
| 前端能否读服务端设置的值 | 不适用 | 不适用 | 不适用 | `httpOnly` 的读不到 |

<Callout type="unverified" title="localStorage 的容量上限属于不同浏览器不统一">

常见说法是「约 5 MB」，但这个数字**由浏览器实现自行决定**，本站没有在本机浏览器里测过配额上限，因此不给结论。可靠的做法只有两条：**把 `setItem` 包在 `try/catch` 里，准备好处理 `QuotaExceededError`**；以及只存小体积的可恢复状态，别把整个列表数据塞进去。想核实当前浏览器的行为，在 Console 里循环写入直到抛错，用抛出前的字节数估算——这是你唯一能相信的数字，因为它是你那台机器上的那个浏览器。

</Callout>

`sessionStorage` 的「标签页级」语义常被误解：它是**每个顶层浏览上下文一份**。同标签页刷新仍在、关掉就没；从一个页面 `window.open` 或 `target=_blank` 打开的同源新标签页会**复制一份副本**（此后各走各的），而用户自己新开标签页输入地址则是全新的空间。**「不希望两个标签页互相干扰的草稿」用它最合适；「跨标签页同步状态」用它一定失败**，那种需求走 `localStorage` + `storage` 事件。

`cookie` 是唯一会被**自动附加到请求上**的前端存储，也因此是唯一必须由服务器控制的存储。属性 `HttpOnly`（前端读不到）、`Secure`（仅 HTTPS）、`SameSite`、`Path`、`Domain`、`Max-Age` 全都属于服务器响应头 `Set-Cookie` 的内容，前端只能写「自己这一份非 httpOnly 的 cookie」。**`SameSite` 的默认取值由各浏览器自行选定**（近年多次收紧跨站行为），别在代码里依赖默认值，跨站场景一律显式写出。**单个 cookie 的大小上限属于实现细节**：规范只要求支持到几千字节量级，浏览器普遍按约 4 KB 处理，超出会被静默截断——**以你要支持的浏览器为准，别把配置塞进 cookie**。**存 token 时为什么不该用 `localStorage`**：

| | `localStorage` 存 token | `httpOnly` cookie 存 token |
| --- | --- | --- |
| XSS 发生后 | **脚本可以直接读走**，一次注入等于凭证泄露（见 [DOM 与事件](/javascript/dom-and-events)里 `insertAdjacentHTML` 那一节） | 脚本读不到，拿不到凭证本体 |
| CSRF | 天然免疫（不会自动带上） | **必须防**：`SameSite` + CSRF token |
| 携带方式 | 自己在每个请求的 `Authorization` 头里拼 | 浏览器自动带 |
| 跨源 | 不受同源策略约束，但预检必须放行 `Authorization` | 需要 `credentials: 'include'` + `Allow-Credentials` |
| 移动端/第三方 API | 方便 | 不方便 |

结论：**会话凭证优先交给 `httpOnly` cookie，由后端设置**，具体分工在 [认证：Session、Cookie 与密码哈希](/backend/auth-session)。前端存储里放 access token 属于妥协方案，只有在能确信 XSS 已被防住时才用，且必须配短有效期与刷新机制。

`IndexedDB` 是唯一「异步 + 结构化 + 可索引」的前端存储，适合离线草稿、大对象缓存、需要按字段查询的数据集。最小封装（**未在本机浏览器运行**，逻辑与 IndexedDB 规范逐条对照过）：

```js
// idb.js —— 单表、按键读写的最小封装（未在本机浏览器运行）
const openDb = (name, version, onUpgrade) => new Promise((resolve, reject) => {
  const req = indexedDB.open(name, version);
  req.onerror = () => reject(req.error);
  req.onupgradeneeded = () => onUpgrade(req.result);
  req.onsuccess = () => resolve(req.result);
});
const ask = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

export async function makeKv(name) {
  const db = await openDb(name, 1, (d) => {
    if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');   // key 由调用方给，值任意结构化克隆
  });
  return {
    get: (key) => ask(db.transaction('kv').objectStore('kv').get(key)),   // 不存在时得到 undefined
    set(key, value) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = () => resolve();          // 完成信号在事务上，不在 put 的 request 上
        tx.onabort = () => reject(tx.error);
      });
    },
    close: () => db.close(),
  };
}
```

三个必须注意的点：**① 写入完成的信号在 `transaction.oncomplete`，不在 `request.onsuccess`**，只监听 request 会在事务实际提交前就以为成功；**② 不要在 `onupgradeneeded` 之外建 store**，版本号和建表逻辑要一起演进；**③ `indexedDB.open` 在无用户交互的 iframe 里可能被浏览器策略拒绝**，隐私模式下也可能抛错——所以**任何存储调用都要包 `try/catch` 并准备内存兜底**，这条对 `localStorage` 同样成立。

**Cache Storage 与 SSR 场景的取舍**：`caches.open()` 属于 Service Worker 的世界，本站路线不引入 SW，需要离线时再回查。真正普遍的问题是：**服务端渲染（SSR）时根本没有这些 API**。`window`、`document`、`localStorage` 在服务端不存在，代码一碰就 `ReferenceError`，报错出现在服务端日志而不是浏览器。所以持久化状态要交给能同时跑在两端的方案——[Pinia 的状态管理](/vue/pinia)配插件，插件内部先判断运行环境再落盘；或者干脆把初始状态由服务器注进 HTML。**「哪些状态该放 URL、哪些该放 store、哪些才值得落 localStorage」这条判断线，比任何 API 用法都重要**：可分享/可收藏的一律进 URL。

敏感数据的原则只有一句：**前端任何形式的存储都不受信任。**前端代码里出现的密钥、数据库连接串、第三方 API secret 都会被任何人读到——打包、混淆、拆分文件都不构成保护，运行时能取到就能导出。API key 只应该存在于服务器环境变量里，浏览器侧只拿到由后端代理签发的短期凭据。这一点在 [环境变量与配置管理](/frontend-engineering/env-and-config)展开，OWASP 移动与前端存储相关条目也在 [Web 安全](/backend/web-security)里。

## 网络状态：navigator.onLine 只是粗略提示

```js
window.addEventListener('online', refresh);      // 网络恢复后重新拉数据
window.addEventListener('offline', () => queue.flushLater());
if (!navigator.onLine) showOfflineHint();
```

`navigator.onLine` 表示「浏览器认为自己有网络连接」，它连不上目标服务器也照样返回 `true`，某些环境下断网了仍是 `true`。所以它**只能用来做提示**，不能用来决定是否发请求——真实结论只有发一次请求才知道，然后在错误分类里落到「网络层」。**离线模式的正确实现是乐观 UI：先改本地状态、把请求进队列、失败时保留状态并提示，而不是靠一个布尔量提前拦截。**

## 封装：一个可以直接抄的请求模块

下面这段约 60 行，覆盖超时、重试、错误分类、加载态与防重复提交。**它在 Node v25.4.0 上真跑过**，验证过程见本节末尾。

```js
// http.js —— 带超时、重试、错误分类与防重复提交的请求模块
export class HttpError extends Error {
  constructor(response, text) {
    super(`HTTP ${response.status}`);
    this.name = 'HttpError';
    this.status = response.status;
    this.text = text;
  }
}

const inFlight = new Map();                                    // dedupeKey -> Promise
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function request(url, options = {}) {
  const {
    method = 'GET', headers = {}, body, json,                  // json：便捷入参，自动序列化
    timeout = 8000, retry = 2, retryDelay = 400,
    dedupe = method === 'GET', signal,                         // signal：调用方的取消信号
  } = options;

  const key = dedupe ? `${method} ${url}` : null;
  if (key && inFlight.has(key)) return inFlight.get(key);       // 防重复提交：复用同一 in-flight

  const init = { method, headers: { Accept: 'application/json', ...headers } };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers['Content-Type'] ??= 'application/json';
  } else if (body !== undefined) init.body = body;

  const run = (async () => {
    let last;
    for (let attempt = 0; attempt <= retry; attempt++) {
      const signals = [AbortSignal.timeout(timeout)];
      if (signal) signals.push(signal);
      try {
        const res = await fetch(url, { ...init, signal: AbortSignal.any(signals) });
        const text = await res.text();                          // body 只读一次，先落成文本
        if (!res.ok) throw new HttpError(res, text);            // HTTP 层错误
        return text ? JSON.parse(text) : null;                  // 解析层错误 → SyntaxError
      } catch (err) {
        last = classify(err, signal);
        if (last.fatal) throw last.raw;                         // 取消 / 4xx / 格式错：不重试
        if (attempt < retry) await wait(retryDelay * 2 ** attempt);   // 指数退避
      }
    }
    throw last.raw;
  })();

  if (key) {
    inFlight.set(key, run);
    run.catch(() => {}).finally(() => inFlight.delete(key));   // 无论成败都清登记
  }
  return run;
}

function classify(err, outerSignal) {
  if (outerSignal?.aborted) return { raw: err, fatal: true, kind: 'aborted' };
  if (err.name === 'TimeoutError') return { raw: err, fatal: false, kind: 'timeout' };
  if (err instanceof HttpError) return { raw: err, fatal: !RETRYABLE_STATUS.has(err.status), kind: 'http' };
  if (err instanceof TypeError) return { raw: err, fatal: false, kind: 'network' };
  return { raw: err, fatal: true, kind: 'parse' };             // JSON.parse 抛的是 SyntaxError
}
```

每段职责：

| 片段 | 为什么这么写 |
| --- | --- |
| `HttpError` + 先 `res.text()` 再判断 | `fetch` 不会把 HTTP 错误变成 rejection，必须自己抛；先落成文本保证 body 只读一次，错误分支还能带上原始内容 |
| `AbortSignal.timeout` + `AbortSignal.any` | `fetch` 没有 timeout 选项，而调用方仍需能主动取消，两个信号合成一个 |
| `classify` | 把四类错误映射成「可否重试」：重试解析错误毫无意义，重试 404 是在打服务器 |
| `outerSignal?.aborted` 优先判断 | 区分用户取消与超时——取消不该被当成一次失败去重试 |
| `retryDelay * 2 ** attempt` | 固定间隔会造成同步重试风暴；上线时再加随机抖动 |
| `inFlight` + `dedupe = method === 'GET'` | 同一 GET 并发只发一次，直接治好连点；幂等假设：写操作请显式传 `retry: 0` 并接受不去重 |

**加载态怎么接**：模块本身不管 UI，因为它无法知道有几个组件在共享同一个请求。加一层引用计数的包装：

```js
let busy = 0;
const listeners = new Set();
export async function requestWithLoading(url, options) {
  busy++; listeners.forEach((fn) => fn(true));
  try { return await request(url, options); }
  finally { if (--busy === 0) listeners.forEach((fn) => fn(false)); }
}
```

在 [DOM 与事件](/javascript/dom-and-events)里，订阅者就是 `button.disabled = busy` 加一个 `aria-busy`；在 [Pinia](/vue/pinia) 或 [React 的 state](/react/state) 里它是 store 上的一个 `loading` 字段。**UI 的加载态与请求的取消必须配对**：组件卸载时 `abort`，否则回调会往已经不存在的节点上写数据。

<Callout type="verified" title="本节的请求模块已在 Node v25.4.0 上实跑">

**环境**：Windows 10 x64、Node v25.4.0（`process.version === 'v25.4.0'`，全局 `fetch` / `AbortController` / `AbortSignal.any` / `AbortSignal.timeout` 均可用，无需任何依赖）、核实时间 2026-10-17。

**方法**：用 `node:http` 起一个临时服务器（`server.listen(0, '127.0.0.1')`，端口由系统分配），提供 `/ok`（200 JSON）、`/slow`（3000ms 后才响应）、`/notfound`（404 + 文本体）、`/badjson`（200 但 JSON 被截断）、`/flaky`（首次 503、第二次 200）五个端点；测试脚本逐个调用上面的 `request()`（第 4 项例外，它直接用 `fetch` 演示「身体读两次」），并在第 6 项处**关闭服务器**以制造真实网络错误。

**实际输出（逐字抄自终端）**：

```text
node v25.4.0 | listen http://127.0.0.1:14255
1 ok      -> { hi: 1, method: 'GET' }
2 404     -> HttpError | HTTP 404 | status= 404 | text= no such task
3 timeout -> TimeoutError | The operation was aborted due to timeout | instanceof DOMException: true
4 body x2 -> TypeError | Body is unusable: Body has already been read
5 parse   -> SyntaxError | Expected double-quoted property name in JSON at position 10 (line 1 column 11)
6 network -> TypeError | fetch failed | cause: ECONNREFUSED
7 abort   -> AbortError | This operation was aborted
8 dedupe  -> 服务器命中次数 = 1 | 同一 Promise: true
9 retry   -> { recovered: true } | 耗时 114 ms
10 post   -> { hi: 1, method: 'POST' }
```

**由此确认的结论**：`fetch` 对 404 不 reject（第 2 项的错误是我们自己抛的 `HttpError`）；body 第二次读抛 `TypeError: Body is unusable: Body has already been read`（第 4 项）；`AbortSignal.timeout()` 产生的是 `TimeoutError` 且它是 `DOMException` 的实例（第 3 项）；用户 `abort()` 产生 `AbortError`（第 7 项）；网络错误的真实文案是 `fetch failed` 且原因在 `err.cause.code`（第 6 项）；`JSON.parse` 失败抛 `SyntaxError`（第 5 项）；两次并发同 URL 的 GET 在服务器侧只产生一次命中且返回同一个 Promise（第 8 项）；指数退避下 503 → 200 的恢复耗时 114 ms（第 9 项，`retryDelay: 100`）。

**未验证部分**：这段代码在真实浏览器里的行为（尤其是 CORS 拦截路径、`credentials` 与 cookie 的实际发送）没有验证——本环境没有可用浏览器。`AbortSignal.any` 在目标浏览器上的可用性需要你自己核对，Node 侧确认可用。

</Callout>

复现方法（本地任意目录，不需要装包）：

```bash
# 目录里放一个 package.json：{"type":"module"}，模块存成 http.js，测试脚本存成 run.mjs
node run.mjs                 # 看到上面那十行输出
npx --yes serve -l 8080 .    # 再用浏览器验证同一份模块（<script type="module"> 引入）
```

浏览器侧要额外确认三件事：跨源时 Network 面板里有没有那条 `OPTIONS`、`credentials: 'include'` 之后请求头里是否出现了 `Cookie`、以及 CORS 被拦时 `performance.getEntriesByName(url)[0].responseStatus` 是否仍是 200（这个字段只有 Chrome 系提供，它最迷惑人：状态是 200，JS 却读不到）。

## 常见错误与排查

**1. 报 CORS 错误，但 Network 面板里响应是 200、数据也看得到。** 原因：服务器返回了内容，但响应头缺少或写错了 `Access-Control-Allow-Origin`，浏览器拒绝把内容交给 JS；DevTools 看到的是真实响应，所以「明明成功」。**先确认**：把那一行的 Request Headers 里的 `Origin` 和 Response Headers 里的访问控制头都抄下来——**如果 Request Headers 里没有 `Origin`，那根本不是 CORS 问题**，多半是别的东西。再确认 `Access-Control-Allow-Origin` 是否与 `Origin` 精确匹配（多写一个 `/`、少写端口、写 `*` 却带了凭据，都算不匹配）。**修**：改服务器配置，或本地走 dev proxy 让请求同源。

**2. `fetch` 之后直接 `.json()`，页面崩在一句 `undefined is not an object`。** 原因：接口返回 404/500，`fetch` 不 reject，`res.json()` 解析出错误体或 HTML，下游取值才炸。**确认**：在调用处打 `res.status`，或临时 `console.log(await res.clone().text())`（**用 `clone()`**，否则 body 被吃掉）。**修**：`if (!res.ok) throw new HttpError(res, text)`，把判断放在解析之前。

**3. `Failed to execute 'json' on 'Response': body stream already read`（或本机文案 `Body is unusable: Body has already been read`）。** 原因：同一个 Response 读了两次 body。**确认**：看是否有「先记录日志读一次、再解析一次」的代码。**修**：读一次存成文本再解析；需要多处读时用 `res.clone()`（clone 必须在读取之前）。

**4. 跨源请求带不上 cookie，服务器说未登录。** 原因三选一：没传 `credentials: 'include'`、服务器没给 `Access-Control-Allow-Credentials: true`、服务器 `Allow-Origin` 写了 `*`。**确认**：Network 里看请求有没有 `Cookie:` 头，再看 `OPTIONS` 与真实响应两个头是否都齐。**修**：前后端各改一处，且 `Allow-Origin` 必须是具体源。

**5. 请求挂了 30 秒不返回，页面一直转圈。** 原因：`fetch` 没有内置超时，服务器不回就一直等。**确认**：`AbortSignal.timeout()` 是否存在、有没有真的传进 `signal`。**修**：任何面向用户的路径都必须带超时；`AbortSignal.any([userSignal, timeoutSignal])` 能把用户取消和超时合并。

**6. 连点两次提交，服务器收到两条记录。** 原因：按钮没 `disabled`、请求没去重、也没取消。**确认**：Network 里出现两个同名请求，第二个是第一个还在 pending 时发出的。**修**：`dedupe` 键（本节的 `inFlight`），或组件层「发出后置忙、`finally` 里释放」。**注意：去重只应对幂等请求默认开启**，对 POST 自动去重会把用户合法的两次相同操作合并成一次（见本节代码里的 `dedupe = method === 'GET'`）。

**7. 把 token 放进 `localStorage`，被注入脚本读走。** 原因：`localStorage` 对同源任何脚本可读，包括 XSS 注入进来的那一段。**确认**：Console 里直接敲 `localStorage` 能看到全部键值——这就是攻击者能做的。**修**：会话凭证改用 `httpOnly` cookie（[认证](/backend/auth-session)），前端只保留非敏感的 UI 状态；同时补 CSP 与 XSS 修复（[Web 安全](/backend/web-security)）。

**8. `JSON.parse(localStorage.getItem('tasks'))` 首次刷新就抛错。** 原因：key 不存在时返回 `null`，`JSON.parse(null)` 得到 `null`，随后 `.map` 就炸；写入时又忘了序列化，读回来是字符串。**确认**：`typeof localStorage.getItem('tasks')`。**修**：`try { return JSON.parse(raw ?? '[]') } catch { return [] }`，读缓存永远要有「数据坏了就回落到默认值」的分支，并且要让损坏的 key 可被清掉（见[错误处理与 DevTools 调试](/javascript/errors-and-debugging)）。

**9. 写入时报 `QuotaExceededError`，或整个页面卡一下。** 原因：把整个列表加图片 base64 塞进了同步的 `localStorage`（大 value 的序列化 + 同步写会占主线程）。**确认**：看单条 value 的长度。**修**：大对象与二进制走 `IndexedDB`，`localStorage` 只放小个体积的可恢复状态，所有写入包 `try/catch`；一次性写多条时合并成一次 `setItem`。

**10. `new URLSearchParams(data)` 把嵌套对象变成 `[object Object]`。** 原因：urlencoded 编码只有扁平的键值对。**确认**：请求预览里看 payload 字段。**修**：嵌套数据用 JSON 编码，或显式拍平（`a.b=1`），并与后端的解析方式对齐（[Fastify](/backend/fastify-basics)）。

**11. 下载文件后浏览器内存一直涨。** 原因：`URL.createObjectURL` 的 blob URL 从不 `revokeObjectURL`。**确认**：Performance/Memory 面板里 Blob 条目堆积。**修**：触发下载后 `revokeObjectURL(href)`；SPA 里可用 `setTimeout` 延后一点再撤，避免下载尚未开始就被回收。

**12. `navigator.onLine` 是 `true`，但所有请求都失败。** 原因：`onLine` 只表示「浏览器认为有网络连接」，Wi-Fi 连着但出不去、或目标服务挂了，它都感知不到。**确认**：`fetch('/api/health')` 的失败分类落在网络层。**修**：把 `onLine` 降级为提示用途，真实判断靠请求结果 + 错误分类 + 重试策略。

## 练习

<Exercise title="练习 1 · 这一段会 reject 吗" difficulty="基础">

服务器返回 500，响应体是 `{"error":"boom"}`。下面三个表达式的结果分别是什么？

```js
const res = await fetch('/api/tasks');            // ①
const isOk = res.ok;                              // ②
const data = await res.json();                    // ③
```

如果把 ③ 改成 `await res.json(); await res.json();`，第二次会怎样？

<template #answer>

① **正常 resolve**。只有网络层失败、CORS 拦截、被取消才 reject；500 是「成功拿到了一个错误响应」。
② `false`。`res.ok` 是「状态码在 200–299」的布尔快捷属性，`res.status === 500`。
③ 正常返回 `{ error: 'boom' }`。所以代码会**带着一个错误对象继续往下跑**，直到某个 `data.map` 之类的调用炸掉——这就是「崩在离真因很远的位置」的标准成因。

第二次 `json()`：抛错。实跑文案（Node v25.4.0）是 `TypeError: Body is unusable: Body has already been read`；MDN 上另有文案 `Response.body is already used or is already being read`。**结论**：`fetch` 之后第一件事是 `const text = await res.text()`，之后再分支处理。

</template>

</Exercise>

<Exercise title="练习 2 · 判断会不会触发预检" difficulty="基础">

下面四个 `fetch` 各自会不会先发 `OPTIONS`？说明触发的是哪一条规则。

```js
fetch('https://api.other.com/list');                                             // A
fetch('https://api.other.com/list', { headers: { 'X-Tenant': 'acme' } });        // B
fetch('https://api.other.com/list', { method: 'POST', body: new FormData(form) });// C
fetch('https://api.other.com/list', { method: 'POST', body: JSON.stringify(x),
        headers: { 'Content-Type': 'application/json' } });                       // D
```

<template #answer>

| | 预检 | 触发条件 |
| --- | --- | --- |
| A | **不会** | `GET` + 没设头，简单请求 |
| B | **会** | 自定义头 `X-Tenant` 不在白名单 |
| C | 不会 | `POST` + `multipart/form-data`（FormData 无文件时是 urlencoded），两者都在白名单——前提是**你没有手动加别的头** |
| D | **会** | `Content-Type: application/json` 不在三个白名单取值里 |

两个实操推论：**① C 里如果你手贱加了 `Content-Type: multipart/form-data`，boundary 会被覆盖，服务器解析不出字段**（body 交给 fetch 自动生成头）。**② 一旦带 `Authorization`，无论什么方法都会预检**，所以「给每个请求都拼一个 Bearer 头」的写法等于每个接口两次请求，这是预检缓存（`Access-Control-Max-Age`）存在的意义。

</template>

</Exercise>

<Exercise title="练习 3 · 超时为什么没生效" difficulty="进阶">

开发者想给请求加 3 秒超时，写成这样，结果服务器挂住时依然等了几十秒：

```js
const controller = new AbortController();
setTimeout(() => controller.abort(), 3000);
const res = await fetch(url);                 // 注意这里
const data = await res.json();
```

请指出问题、给出两种正确写法，并说明 abort 之后 `catch` 里拿到的错误是什么。

<template #answer>

问题在 `fetch(url)` **没有传 `signal`**。控制器被 abort 了，但没有任何请求在监听它，等待继续。

写法一（手动控制器，可同时用于用户取消）：

```js
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 3000);
try {
  const res = await fetch(url, { signal: controller.signal });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res, text);
  return JSON.parse(text);
} finally { clearTimeout(timer); }            // 不 clear 会留一个待执行的定时器
```

写法二（更短，Node 与新版浏览器可用）：

```js
const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
```

错误形态：**abort 的 reason 决定错误名**。`AbortSignal.timeout()` 给的是 `TimeoutError`（实跑文案 `The operation was aborted due to timeout`）；`controller.abort()` 不带参数时给的是 `AbortError`（实跑文案 `This operation was aborted`）。两者都是 `DOMException` 实例，`err instanceof Error` 也成立。**用错误名区分「超时」和「用户主动取消」——用户取消不应该进重试队列，这一点在本节的 `classify` 里就是靠先检查外部信号来实现的。**

</template>

</Exercise>

<Exercise title="练习 4 · 故意制造一次存储读取崩溃" difficulty="进阶">

上线一次改版后，部分用户打开页面就白屏，控制台报 `Uncaught SyntaxError: Unexpected token o in JSON at position 1`。代码里这一行是嫌疑：

```js
const tasks = JSON.parse(localStorage.getItem('tasks') ?? '[]');
```

请解释为什么会出现这个报错、`?? '[]'` 为什么救不了它，并写出稳健版本。

<template #answer>

`Unexpected token o` 是 `JSON.parse` 收到一个**已经是数组或对象的值**时的典型文案——它先调用 `String()`，得到 `"[object Object]"`，第一个 token 就是 `o`。

来源：改版前某处写的是 `localStorage.setItem('tasks', tasks)`（**忘了 stringify**），`Storage.setItem` 把值强制字符串化，存进去的就是字面量 `[object Object]`。这个字符串非空，所以 `?? '[]'` 不生效，`JSON.parse` 直接撞上。

稳健版本要做到三件事：**读的时候兜住、写的时候保证序列化、坏数据要能自愈**。

```js
const KEY = 'tasks';
function loadTasks() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];        // 结构不符合预期就当没有
  } catch (err) {
    localStorage.removeItem(KEY);                       // 清掉坏数据，避免每次刷新都白屏
    return [];
  }
}
function saveTasks(tasks) {
  try { localStorage.setItem(KEY, JSON.stringify(tasks)); }
  catch (err) { /* QuotaExceededError：降级为只存筛选条件，并把 err 上报 */ }
}
```

**通用规则**：任何「反序列化外部/缓存数据」的位置都要 `try/catch` + 回落默认值；`?? ` 只挡 `null`/`undefined`，挡不住内容错误（见[类型与值](/javascript/types-and-values)）。

</template>

</Exercise>

<Exercise title="练习 5 · 挑存储位置" difficulty="挑战">

给下面六项数据各挑一个位置（`URL` 查询串 / `localStorage` / `sessionStorage` / `IndexedDB` / `httpOnly cookie` / 内存 store），各写一句理由。

| 数据 |
| --- |
| 1. 列表当前的筛选条件与页码 |
| 2. 用户选择的界面主题（亮/暗） |
| 3. 登录后的一次性会话凭证 |
| 4. 一个十几万行的离线数据集，需要按字段查询 |
| 5. 多步表单走到第 3 步的草稿 |
| 6. 第三方服务的 API secret |

<template #answer>

| 数据 | 位置 | 理由 |
| --- | --- | --- |
| 1 筛选与页码 | **URL 查询串** | 要能被分享、收藏、前进后退；[Vue Router](/vue/router) 与 [React Router](/react/router) 都把这类状态放 URL。放 localStorage 会让「刷新后筛选消失」变成 bug |
| 2 主题 | `localStorage` | 小体积、跨标签页共享、且需要在首屏渲染前读到以避免闪烁（这类读取要写在 head 里的内联脚本中，渲染前执行）；[自定义属性与主题切换](/css/units-and-custom-properties)是它的落地方式 |
| 3 会话凭证 | **`httpOnly` cookie** | 前端存储一律可被同源脚本读取，XSS 直接等于凭证泄露；由后端 `Set-Cookie` 设置（[认证](/backend/auth-session)） |
| 4 大数据集 | `IndexedDB` | 异步、结构化克隆、能建索引按字段查；同步 API 装不下这种量 |
| 5 多步草稿 | `sessionStorage` | 语义正好：**标签页级**，关掉就清，两个标签页填两张单不互相覆盖。需要跨标签同步才考虑 IndexedDB / localStorage |
| 6 API secret | **不放前端任何存储** | 打包出来的代码里没有任何东西是秘密；放服务器环境变量，前端只拿后端代理签发的短期凭据（[环境变量与配置](/frontend-engineering/env-and-config)） |

再加一条通判：**「刷新后应该看到同样的画面」不等于「应该存 localStorage」**——能被 URL 表达的状态永远优先用 URL。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN CORS（跨源资源共享）](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) —— 核实简单请求的方法/白名单头/三种 `Content-Type`、预检触发条件、访问控制响应头清单，以及「带凭据时 `Allow-Origin` 不能是 `*`」（本章同源策略一节的依据）。
- [MDN `fetch`](https://developer.mozilla.org/en-US/docs/Web/API/fetch) —— 核实 `credentials` 默认 `same-origin`、只有网络错误才 reject、`RequestInit` 各选项（错误分类与练习 3 的依据）。
- [MDN `Body/json`](https://developer.mozilla.org/en-US/docs/Web/API/Body/json) —— 核实 body 是一次性流（错误 3 与练习 1 的依据）。
- [MDN `AbortSignal: any()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static) —— 核实合并信号、`reason` 取最先触发者、以及浏览器可用时间线（封装里超时与取消并用的依据）。
- [MDN `Navigator/sendBeacon`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon) —— 核实返回布尔只表示入队、仅 POST、需要控制请求时用 `fetch` + `keepalive`（`sendBeacon` 一节的依据）。
- [MDN `Window: online/offline 事件`](https://developer.mozilla.org/en-US/docs/Web/API/Window/online_event) —— 核实 `onLine` 的语义限制，即「只能作粗略提示」。
- [MDN `Storage`](https://developer.mozilla.org/en-US/docs/Web/API/Storage) —— 核实 `localStorage` / `sessionStorage` 的同步性质与按源隔离；**页面明确写容量由实现决定**，本站因此不给具体数字。
- [MDN `IndexedDB`](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) —— 核实事务提交信号在 `transaction.oncomplete`、以及结构化克隆支持的类型（最小封装片段的依据）。
- [javascript.info · Fetch API](https://javascript.info/fetch-api) —— `fetch` 选项与错误处理的对照读物。
- [nodejs.org · fetch API](https://nodejs.org/en/docs/guides/fetch/) —— 核实 `fetch` 在 Node 全局可用的版本起点（本机 v25.4.0 已实跑）。

## 下一章

请求与存储之外还有一层看不见的规则：代码是**怎么被加载进运行时的**。为什么 `import` 必须写在文件顶部、为什么 `require` 一个 ESM 有时能有时抛错、循环引用为什么让某个导入值变成 `undefined`、以及本站那个纯 JS 项目为什么必须用本地静态服务器打开——这些都出自 ES 模块的静态结构与求值顺序。下一章 [ES 模块、动态导入与迭代器](/javascript/modules-and-iterators) 把这套规则讲透，并把本章的 `AbortSignal` 与流式响应接到迭代器协议上。
