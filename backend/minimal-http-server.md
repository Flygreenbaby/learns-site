# 用 node:http 手写最小服务器：框架替你做的六件事，现在自己做一遍

你的接口在本地跑得好好的，`curl` 一下却拿回半截 JSON；日志什么都没打，进程自己没了，最后一行是 `Error [ERR_STREAM_WRITE_AFTER_END]: write after end`；容器滚动更新时总有几个请求变成 `ECONNRESET`。三个故障的共同点是：你把「发响应」当成一个动作，而它其实是**两条流的状态机**——`req` 是可读流、`res` 是可写流，每个 API 都有「什么时候才允许调」。框架把这些规则藏起来了，于是很多人从没读过它们，一旦框架行为不符合预期就完全看不懂报错。

这一章零依赖，只用 `node:http` 写一个能路由、能读体、能返回 JSON、能发静态文件、能优雅关闭的服务器，**每条输出都是本机实跑的原文**（包括我自己写测试脚本时真踩的两个坑：`Content-Length` 按字符数写、handler 抛错打崩进程）。前置：[Node.js 运行时：模块、事件循环与流](/backend/node-runtime)——流与背压的结论在那一章已经实测过，这里直接引用。

## req 与 res 是两条流：Node 替你写了哪些响应头

```js
import http from 'node:http';

http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('你好\n');
}).listen(3000);
```

裸 socket 发 `GET / HTTP/1.1`，本机收到的**原始字节**（`\r\n` 按 JSON 转义显示）：

```text
"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nDate: Sun, 18 Oct 2026 01:38:01 GMT\r\nConnection: close\r\n\r\n你好\n"
```

你只写了三样，实际发出五行头：

| 响应头 | 谁写的 | 实测依据 |
| --- | --- | --- |
| `Date` | **Node 自动**（`res.sendDate = false` 可关） | 上面那行你没写 |
| `Content-Type` | 你写的，**不写就没有** | 另一个 handler 只 `res.end('x'.repeat(3000))`，响应头里没有它 |
| `Content-Length` | 只 `end()` 一次时 Node 按**字节**算 | `你好\n` → `Content-Length: 7`（3+3+1） |
| `Transfer-Encoding: chunked` | `write()` 过之后改用分块 | 两次 write 的原始 body：`3\r\naaa\r\n3\r\nbbb\r\n0\r\n\r\n` |
| `Connection` / `Keep-Alive` | 按请求版本决定 | HTTP/1.1 → `keep-alive` + `Keep-Alive: timeout=5`；HTTP/1.0 → `close` |

两个后果：**`Content-Length` 与 `Transfer-Encoding` 不会同时出现**；`Keep-Alive: timeout=5` 是 `server.keepAliveTimeout`（默认 5000ms）对外的通告，它在章末的优雅关闭里还会再出现。

<Callout type="verified" title="本章输出均来自本机实跑">

环境：Windows 10 x64 + **Node v25.4.0** + **curl 8.17.0**，2026-10-18。三种验证方式：`node:net` 裸 socket 手写请求看原始字节、ESM 里的全局 `fetch`（undici）、命令行 `curl -si`。贴的是终端原文；端口号和 `Date` 每次运行会变，**结构与字节数可复现，时间戳不可**。

</Callout>

## 路由分发：一张表加一个匹配函数，没有魔法

`node:http` 只有一个入口回调，所有 URL、所有方法都打到这里。

```js
const routes = [
  { method: 'GET',   pattern: '/api/health',    handler: (req, res) => sendJson(res, 200, { ok: true }) },
  { method: 'GET',   pattern: '/api/users',     handler: listUsers },
  { method: 'POST',  pattern: '/api/users',     handler: createUser },
  { method: 'GET',   pattern: '/api/users/:id', handler: getUser },
  { method: 'PATCH', pattern: '/api/users/:id', handler: patchUser },
];

function matchRoute(method, pathname) {          // 逐段比较，:xxx 是参数段
  let pathHit = false;
  for (const r of routes) {
    const seg = r.pattern.split('/'), got = pathname.split('/'), params = {};
    if (seg.length !== got.length) continue;
    let ok = true;
    for (let i = 0; i < seg.length; i++) {
      if (seg[i].startsWith(':')) params[seg[i].slice(1)] = decodeURIComponent(got[i]);
      else if (seg[i] !== got[i]) { ok = false; break; }
    }
    if (!ok) continue;
    pathHit = true;
    if (r.method === method) return { route: r, params };
  }
  return pathHit ? { methodNotAllowed: true } : null;   // 路径命中、方法不中 → 405
}

const app = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const m = matchRoute(req.method, pathname);
  if (!m) return sendJson(res, 404, { error: 'not found', path: pathname });
  if (m.methodNotAllowed) {
    res.setHeader('Allow', routes.filter((r) => r.pattern === pathname).map((r) => r.method).join(', '));
    return sendJson(res, 405, { error: 'method not allowed' });
  }
  req.params = m.params;
  try { await m.route.handler(req, res); }
  catch (e) { res.headersSent ? res.destroy() : sendJson(res, 500, { error: e.message }); }
});
```

`fetch` 逐条打出来的真实结果：

```text
GET    /api/health                            200  {"ok":true}
GET    /api/users?page=2&q=a%20b&tag=x&tag=y  200  {"pathname":"/api/users","page":"2","q":"a b","multi":["x","y"],"missing":null}
GET    /api/users/42                          200  {"id":"42"}
GET    /api/users/abc%20def                   200  {"id":"abc def"}
DELETE /api/users/42                          405  Allow: GET, PATCH   {"error":"method not allowed"}
GET    /nope                                  404  {"error":"not found","path":"/nope"}
```

`Allow` 头**不会自己出现**，上面那行是我补了 `setHeader` 之后的结果；新手最常见的缺口就是 405 只给状态码、对端不知道怎么修。

`req.url` **只含 path + query，不含 origin**，所以 `new URL(req.url)` 直接抛 `ERR_INVALID_URL`，必须给 base。拿到 `searchParams` 之后：`get('page')` 是 `'2'`、`getAll('tag')` 是 `['x','y']`（同名多值只能 `getAll`）、`get('nope')` 是 `null` 而不是 `undefined`。上面实测那行给出两个结论：`q=a%20b` 到这里是 `a b`（**query 由 URLSearchParams 自动解码**）；但路径参数不同——`/api/users/abc%20def` 里仍是 `abc%20def`，我在匹配函数里显式 `decodeURIComponent` 才得到 `abc def`。**漏了这步，你会拿 `abc%20def` 去查库然后 404**，中文文件名、带空格的用户名全靠它。

裸 socket 还测出几条解析器事实，它们决定「路由明明写了却收不到请求」这类怪事：

| 发出的首行 | 实测行为 |
| --- | --- |
| `get / HTTP/1.1`（小写方法） | **`400 Bad Request`**，handler 没被调用——解析器只认大写 |
| `FOOBAR / HTTP/1.1` | 同样 `400`（`HPE_INVALID_METHOD`） |
| `PROPFIND / HTTP/1.1` | **进了 handler**，`req.method === 'PROPFIND'`。语法合法的任意方法都照收 |
| `GET /a//b HTTP/1.1` | `req.url` 原样 `/a//b`，Node 不归一化路径（但 `new URL()` 会折叠 `.`/`..` 段） |
| `OPTIONS * HTTP/1.1` | `req.url === '*'`，`new URL('*', base)` 解析成 `/` |

## 请求体是可读流，不是一个值

```js
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const fail = (message, statusCode, cause) => {
      const e = new Error(message); e.statusCode = statusCode; e.cause = cause;
      reject(e);
      req.resume();                    // 排空剩余字节，否则连接挂着不放
    };
    req.on('data', (c) => {
      size += c.length;                // 累计判断必须在 push 之前，否则允许
      if (size > limit) return fail('request body too large', 413);   // CL:999999999 撑满内存
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(undefined);   // 用 {} 就分不出「没带 body」和「空对象」
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (err) { fail('invalid JSON body', 400, err); }
    });
    req.on('error', reject);
  });
}
```

注意 `Buffer.concat` 之后**统一** `toString('utf8')`：chunk 边界不认字符边界，逐块 `toString` 会把跨块的中文切开（`string_decoder` 是另一条路）。同一台服务器用 curl 打的真实响应：

```text
POST /api/users  --data '{"name":"张三"}'   201 Created | Location: /api/users/1 | Content-Length: 30
POST /api/users  --data '{bad'             400 Bad Request | {"error":"invalid JSON body"}
POST /api/users  --data '{}'               400 Bad Request | {"error":"name 必填"}
POST /api/users  （100KB body，limit 64KB） 413 {"error":"request body too large"}
```

**我踩的第一个真坑：`Content-Length` 是字节数。** 写测试脚本时我手写了 `Content-Length: 16` 配 `{"title":"标题"}`——字符数 16，字节数 18（每个汉字 3 字节）。服务端只收到 16 字节，`JSON.parse` 当场炸：`SyntaxError: Unterminated string in JSON at position 12`。

反方向一样成立：服务端谎报长度，客户端就只读那么多。本机把同一份 `{"msg":"你好世界"}` 用两种长度发出，`fetch` 侧看到：

```text
/good  CL=22 收到字节=22 text="{\"msg\":\"你好世界\"}"   JSON.parse 成功
/bad   CL=14 收到字节=14 text="{\"msg\":\"你好"        JSON.parse= SyntaxError: Unterminated string in JSON at position 10
```

结论只有一句：**用 `Buffer.byteLength(payload)`**，或者一次 `end(payload)` 让 Node 自己填（它填的就是字节数）。中文站点迟早撞这一关。

## 写响应：六个实测结论

统一出口，本章后面所有例子都用它：

```js
function sendJson(res, status, obj) {
  const payload = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(payload);
}
```

| 结论 | 本机实测原文 |
| --- | --- |
| 头只能在发出去之前改；`res.headersSent` 是唯一判据 | `ERR_HTTP_HEADERS_SENT \| Cannot set headers after they are sent to the client`；`end` 之后再 `write` → `ERR_STREAM_WRITE_AFTER_END \| write after end` |
| **重复 `res.end()` 会把进程带走**：第二次不抛同步异常，而是异步 emit 一个没人接的 `error` | `node:events:486 throw er; // Unhandled 'error' event` → `at ServerResponse.end (node:_http_outgoing:1042:15)` |
| **204 的 body 被吞** | 写 `204` 再 `end('{"a":1}')`，客户端拿到 `HTTP/1.1 204 No Content`，**没有 `Content-Length`、body 为空**；同一段代码换 `205` 就保留 `Content-Length: 5`。「204 里返回 id」物理上行不通 |
| 头的值是 latin1 语义，**不能带中文**；`Set-Cookie` 只能靠数组 | 塞入含全角逗号的中文值后进程崩：`TypeError [ERR_INVALID_CHAR]: Invalid character in header content ["X-Note"]`。连调两次 `setHeader('Set-Cookie', …)` 是**覆盖**（实测只剩 `b=2`），传数组才发两行；同名请求头反过来会合并：发两个 `X-Multi` 读到 `"a, b"` |
| `JSON.stringify` 不是无损的 | 实测：`undefined` 被丢、`NaN`/`Infinity` → `null`、`Date` → ISO 串、`Map`/`Set` → `{}`、`Buffer` → 字节数组对象、`toJSON` 优先；`BigInt` 与循环引用直接抛 `TypeError`。这些异常**类型检查抓不到**——TS 允许 `{n: number}` 而值是 `NaN` |

兜底策略见[统一错误处理](/backend/error-handling)。

## 静态文件：用流，守卫写在 decode 之后

```js
const ROOT = path.resolve('public');
async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {              // 方法守卫
    res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); return res.end();
  }
  const abs = path.resolve(ROOT, '.' + decodeURIComponent(pathname));    // 先 decode
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {                // 再比前缀
    res.statusCode = 403; return res.end('forbidden');
  }
  const st = await fs.promises.stat(abs).catch(() => null);
  if (!st || !st.isFile()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Content-Length', String(st.size));
  if (req.method === 'HEAD') return res.end();               // 只回头，不灌 body
  await pipeline(fs.createReadStream(abs), res);             // pipeline 负责背压与错误清理
}
```

裸 socket 实测：

```text
GET  /index.html                        200 | Content-Type: text/html; charset=utf-8 | Content-Length: 12 | body 12 字节
HEAD /index.html                        200 | 同上 Content-Length: 12                | body 0 字节
POST /index.html                        405 | Allow: GET, HEAD                       | body 0 字节
GET  /nope.css                          404 | Content-Length: 9 ("not found")
GET  /../index.md                       404   ← 明文 .. 段被 URL 解析器折叠掉了
GET  /%2e%2e%2f%2e%2e%2fpackage.json    403   ← 编码形态逃过折叠，被守卫拦下
GET  /sub                               404   ← 目录不列目录
```

**最后两行是本章最该记住的**：`../` 走不到你这里（curl 与 `new URL()` 都会折叠），`%2e%2e%2f` 原样送到你手上、**decode 之后才变成真正的 `../`**。守卫顺序因此固定是 decode → resolve → 比前缀，`path.normalize` 单独用不够（它不告诉你有没有跑出 ROOT）。另外，上面所有响应里**都没有 `Last-Modified` 或 `ETag`**——Node 一律不加，缓存要自己做，见下一章。

## handler 抛异常，整台服务器陪你一起死

子进程跑「handler 直接 throw」，父进程观察到退出码 1，stderr 原文：

```text
Error: 业务同步抛错
    at Server.<anonymous> (crash-test.mjs:3:27)
    at parserOnIncoming (node:_http_server:1213:12)
--- 子进程退出码= 1
```

`async` handler 里没人 catch 的 `throw` 同样致命，退出码也是 1。挂上 `process.on('uncaughtException', …)` 再跑，打印 `兜住了: 业务同步抛错`、进程仍存活——但**那个请求的响应根本没发出去**，客户端拿到连接重置：`uncaughtException` 只保进程，救不回请求，也不修状态不一致。正确形状是本章路由里那段 `try/catch` + `headersSent` 判断。

另一类错误在协议层，压根没有 `req`/`res` 对象。官方文档写明默认行为是「关闭 socket 并回 `400 Bad Request`；若是 `HPE_HEADER_OVERFLOW` 则回 `431`」。本机对照：

| 场景 | 实测响应 |
| --- | --- |
| 默认服务器，20KB 请求头 | `431 Request Header Fields Too Large` |
| **注册了** `server.on('clientError')` 且自己写 400 | `400 Bad Request`——默认的 431 被你吃掉了 |
| `server.maxHeaderSize = 1024`，2KB 头 / 500B 头 | `431` / `200` 正常进 handler |

第二行是真会踩的：为了「统一错误响应」注册 `clientError`、顺手全写 400，监控里就分不出「请求太大」和「格式错误」。要写就按 `err.code` 分支。

## 优雅关闭：三个 API 的差别是实测出来的

```js
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT', 'SIGBREAK']) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => console.log('存量连接已结束'));
    server.closeIdleConnections();                                  // 空闲长连接直接砍
    setTimeout(() => server.closeAllConnections(), 5000).unref();    // 兜底：在途的也砍
  });
}
```

`/slow` 是 1500ms 才响应的 handler，本机实测：

| 操作 | 实测结果 |
| --- | --- |
| 只 `close()`，有**在途请求** | 请求跑完：`{"ms":1517,"body":"slow-done"}`，一个字节没丢 |
| `close()` + 立刻 `closeAllConnections()` | 在途被砍：`{"ms":205,"body":"(空)"}` |
| 有空闲 keep-alive 连接时 `close()` | 回调 **1ms 就触发**，`listening` 变 `false`，`address()` 变 `null` |
| 复用那个空闲连接再发请求 | 等 1510ms 拿到 `NO-RESPONSE`（连接还开着，但没人服务） |
| `closeIdleConnections()` 返回值 | `undefined`（别按「返回关闭数量」写代码） |
| 空闲连接多久被服务端单方面关闭 | `keepAliveTimeout=5000` → **6010ms**；`=1000` → **2006ms** |

**第四行是关键：`close()` 之后老连接不一定立刻消失，但一定不再服务**，客户端按 keep-alive 复用就会干等到超时——这就是灰度发布时偶发超时的来源。官方文档写明自 **Node v19.0.0** 起 `close()` 会「先关闭空闲连接再返回」，与第三行吻合，所以上面这个三连是稳妥写法；`close()` 的回调还能用来验证「不再接受新连接」（实测新建 TCP 得 `ECONNREFUSED`）。**兜底超时那 5000ms 的长短，直接决定你最坏牺牲多少在途请求。** 最后一行多出的约 1 秒我在本机没能定位到具体开关，只当观察值用。另外这几个默认值是我在新建 server 对象上直接读出来的：`keepAliveTimeout=5000`、`headersTimeout=60000`、`requestTimeout=300000`、`maxRequestsPerSocket=0`、`maxHeaderSize` 未设置（走 16KB 默认）。

<Callout type="warn" title="Windows 上 SIGTERM 这段跑不通，我实测了">

用 `child_process` 起子进程再 `child.kill('SIGTERM')`：

```text
[子] 监听 34571
结果: exit code=null signal=SIGTERM
端口是否已释放: CONN-ERR ECONNREFUSED
（子进程里注册的 process.on('SIGTERM') 一行都没打印）
```

改成 `SIGINT` 一模一样。机制见 [Node 的 `process` 文档](https://nodejs.org/docs/latest/api/process.html)：信号是 POSIX 概念，Windows 上除终端产生的 `SIGINT`/`SIGBREAK` 外不可靠，`kill()` 走的是无条件结束进程。**也就是说上面那段优雅关闭代码在 Windows 上永远不执行，而在 Linux 容器里它是必需的**——这解释了「本地开发时优雅关闭从来没生效，一上生产就暴露」。想在 Windows 测到 handler，只能在控制台按 `Ctrl+C`。

</Callout>

本章每段手写代码在 Fastify 里的对应位置，下一章开头有一张完整对照表。

## 常见错误与排查

**1. 响应只有一半，`JSON.parse` 报 `Unterminated string`。** 原因：手写的 `Content-Length` 用了字符数（实测 `byteLength=22 / length=14`）。确认：`curl -si` 比响应头里的长度与实际字节数。修法：`Buffer.byteLength`，或一次 `end()` 让 Node 填。

**2. `Cannot set headers after they are sent to the client`。** 现象：客户端有时有响应有时没有。原因：某分支已经 `write`/`end` 之后又 `setHeader`，典型是「先写一半再校验失败」。确认：报错行前打印 `res.headersSent`。修法：校验前移到第一次写出之前；catch 里先判 `headersSent`，已发出就 `res.destroy()`。

**3. 进程无声退出，stderr 是 `ERR_STREAM_WRITE_AFTER_END` / `Unhandled 'error' event`。** 原因：重复 `res.end()`（异步 emit，见结论表），或 handler 抛异常没人接（实测退出码 1）。确认：`node --trace-uncaught` 重跑，看是不是同一 handler 走了两条出口。修法：出口收敛成一个 `return sendJson(...)`，`end` 前判 `res.writableEnded`。

**4. 部署时零星 504。** 现象：滚动更新期间偶发失败，重启完成就正常。原因：`close()` 后空闲 keep-alive 连接还在地址上但不再服务（实测 `NO-RESPONSE` 等 1.5 秒）。确认：`curl -v` 看 `Connection: keep-alive`；把 `keepAliveTimeout` 调到 1 秒复现。修法：`close()` 后立刻 `closeIdleConnections()`，保留兜底 `closeAllConnections()`，并让服务端 `keepAliveTimeout` 小于上游代理的 idle timeout。

**5. 加了 `clientError` 之后 431 全变 400。** 原因：回调里手写的响应覆盖了默认行为（实测对照表）。确认：临时注释掉监听器再发 20KB 头，看是否回到 431。修法：按 `err.code === 'HPE_HEADER_OVERFLOW'` 回 431，其余回 400。

## 练习

<Exercise title="练习 1 · 预测原始响应字节" difficulty="基础">

裸 socket 发 `GET / HTTP/1.1`（带 `Connection: keep-alive`），写出下面 handler 的响应头与 body 原始形态。

```js
http.createServer((req, res) => { res.write('ab'); res.end('c'); });
```

<template #answer>

不会出现 `Content-Length`，改用 `Transfer-Encoding: chunked`，body 是分块帧：

```text
2\r\nab\r\n1\r\nc\r\n0\r\n\r\n
```

依据本章实测的同型结果（两次 write 得到 `3\r\naaa\r\n3\r\nbbb\r\n0\r\n\r\n`；`Content-Length: 3000` 只在一次 `end()` 写完时出现）。其余头：`Date`（Node 自动）、`Connection: keep-alive` + `Keep-Alive: timeout=5`。**没有 `Content-Type`**——实测过不写就没有，浏览器靠嗅探决定怎么显示，这正是「接口返回的 JSON 被当文件下载」的成因。

</template>

</Exercise>

<Exercise title="练习 2 · 找出三段 body 读取里各自的 bug" difficulty="进阶">

分别说明「现象 + 原因 + 怎么确认 + 怎么修」：

```js
// A
req.on('data', (c) => { chunks.push(c); if (over(c)) { res.statusCode = 413; res.end(); } });
req.on('end', () => doSomething(Buffer.concat(chunks)));
// B
req.on('data', (c) => { text += c.toString('utf8'); });
// C
const body = JSON.parse((await collect(req)).toString('utf8'));   // 外层没有任何 catch
```

<template #answer>

**A**：`res.end()` 之后**没人排空剩余请求体**，同一 keep-alive 连接上后半截字节会被当成下一个请求解析；而且 `end` 回调照样触发，业务逻辑再跑一次 → 重复响应（就是实测那个打崩进程的 `ERR_STREAM_WRITE_AFTER_END`）。确认：`curl -v` 连打两次看第二次是否乱码。修法：超限时 reject 之后 `req.resume()`，并给 handler 一个「已响应」闸门。

**B**：跨 chunk 的多字节字符被切开（中文 3 字节）。确认：调小 `highWaterMark`、发长中文 body，看 `text` 里是否出现替换字符。修法：先攒 `Buffer`，`end` 时统一 `toString('utf8')`，或用 `string_decoder`。

**C**：非法 JSON 时 `JSON.parse` 抛在 async handler 里没人 catch → 实测**进程退出码 1**，客户端拿到连接重置而不是 400。确认：`curl -d '{bad' ...` 后看进程还在不在（本章就跑了这条复现）。修法：try/catch 包住解析，返回 400，底层信息放 `cause` 不回给客户端。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误：让静态目录穿越成功" difficulty="挑战">

本章 `serveStatic` 只有两行负责安全。改掉其中一行就能让 `/%2e%2e%2f%2e%2e%2fsecret.txt` 读到 ROOT 外的文件。指出是哪行、为什么，并给出第三种更危险的写法。

<template #answer>

**是第二行的前缀比较。** 第一行的 `decodeURIComponent` 是攻击链的一环：不 decode 时 `%2e%2e%2f` 只是文件名字符，`resolve` 结果仍在 ROOT 内（本章实测的另一种写法就把它当普通文件名，返回 404 而不是文件内容）；**一旦 decode，它变成真正的 `../`**，此时唯一拦住越界的就是 `abs.startsWith(ROOT + path.sep)`。换成 `path.normalize(ROOT + '/' + rel)` 就破了：normalize 把 `..` 折叠掉并**照样**返回 ROOT 外面的绝对路径，却不告诉你有没有越界。第三种更危险的写法是**先比较再 decode**——比较用编码串（看起来安全），后面 `stat` 用解码后的路径。

确认方法就是本章那两条 curl：`--path-as-is` 分别发明文 `../` 和编码 `%2e%2e%2f`，看状态码（实测：明文被折叠 → 404；编码被守卫拦下 → 403）。正确顺序固定三条：**decode → resolve → 比前缀**，比较要带上 `path.sep`（否则 `/public-evil` 也能通过 `startsWith('/public')`），再加 `st.isFile()` 兜住目录与设备文件。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Node.js `http` 模块 API](https://nodejs.org/docs/latest/api/http.html) —— 用它核实三条：`clientError` 默认「回 400，`HPE_HEADER_OVERFLOW` 回 431」（与我的对照实测一致）、`server.close()` 自 **v19.0.0** 起「先关空闲连接再返回」、`checkContinue`「未监听时服务端自行按需回 `100 Continue`」。**注意**：该页未列出 `keepAliveTimeout` 等默认数字，那几个值是本机在 server 对象上读的。
- [Node.js `process` 文档](https://nodejs.org/docs/latest/api/process.html) 与 [Node.js stream API](https://nodejs.org/docs/latest/api/stream.html) —— 前者核实信号的跨平台可用性，支撑「Windows 上 SIGTERM handler 不执行」；后者核实 `pipeline` 与 `pipe` 的错误传播差别、背压语义（另见[第 1 章](/backend/node-runtime)实测）。
- [Node.js `url` 文档](https://nodejs.org/docs/latest/api/url.html) 与 [MDN `Content-Length`](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Content-Length) —— 前者核实 `req.url` 只含 path + query、`URLSearchParams` 的解码与 `getAll`；后者核实它是**字节**数，本章两个截落实测都对着这条。

## 下一章

这一章把「一个请求进来要自己写的所有代码」摊开走了一遍：流与背压变成了 `readJsonBody` 的三行，`res` 的可写性变成了 `ERR_STREAM_WRITE_AFTER_END`，`sendJson` 里那个 `Buffer.byteLength` 决定中文响应会不会被截成半截 JSON。[HTTP 与 REST 原理](/backend/http-and-rest)不换实现、换视角：同样用 `node:http`，注意力放到**约定**上——方法语义与幂等、状态码怎么选、`ETag`/`Cache-Control` 的条件请求、超时错配。本章那些「405 要不要带 `Allow`」「204 能不能有 body」「`%2e%2e%2f` 该回 403 还是 404」的判断标准会从那里长出来，再进 [Fastify 入门](/backend/fastify-basics) 就不会把框架的写法误当成 HTTP 的规则。
