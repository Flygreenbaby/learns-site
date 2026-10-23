# HTTP 与 REST 原理：语义、状态码与缓存，为什么你的接口没人会用

一个「查询文章」的接口，改标题发 `POST /updateArticle`，删除发 `POST /deleteArticle?id=3`。三个月后：列表被 CDN 缓存成空壳（一律 POST，谁都不缓存）、点两下多两条修改记录（POST 不幂等）、前端接不到「失败」的明确信号（成功失败都回 `200` + `{code: 1}`）。第二个故障更常见：你在接口上写 `Cache-Control: max-age=31536000`，用户改完昵称刷新还是旧的——你只发了过期时间，没发校验器（`ETag`），客户端在有效期内**根本不会问你**。第三个最贵：接口在网关后面偶发 `502`，Node 日志一条错误都没有，原因是网关空闲超时 60 秒而服务端 `keepAliveTimeout` 更长，先闭嘴的是对端。

共性是：**HTTP 的语义是契约，不是风格**。方法决定缓存与幂等，状态码决定客户端下一步做什么，头部决定中间设备怎么处理这个响应。[第 1 章](/backend/node-runtime)的运行时和[上一章](/backend/minimal-http-server)手写的服务器只决定「能不能收到请求」，本章继续在 `node:http` 上把这些契约落到可验证的字节上。

## 方法语义：安全、幂等、可缓存是三件不同的事

规范用三个正交属性描述方法，实现里必须一起考虑：

| 属性 | 含义 | 违反的实际后果 |
| --- | --- | --- |
| 安全（safe） | 不应当改变服务器状态 | 浏览器预取、爬虫、网关重试会随意重放 GET；把「下载并计数」写在 GET 里 = 数据被自动改 |
| 幂等（idempotent） | N 次与 1 次对状态的**影响**相同 | 超时后客户端不敢重试；重试就重复扣款 |
| 可缓存（cacheable） | 响应能否被存下来复用 | GET 不可缓存 = 白付带宽；POST 被缓存 = 上一个用户的响应给了下一个用户 |

| 方法 | 安全 | 幂等 | 可缓存 | 语义 |
| --- | --- | --- | --- | --- |
| `GET` / `HEAD` | 是 | 是 | 是 | 读表示层资源；`HEAD` 的 `Content-Length` 应与 GET 一致 |
| `OPTIONS` | 是 | 是 | 否 | 查询通信选项（CORS 预检走它） |
| `POST` | 否 | **否** | 仅当带 `Location` | 提交处理 / 创建子资源 |
| `PUT` | 否 | 是 | 否 | **整体替换** |
| `PATCH` | 否 | **否**（规范不保证） | 否 | 局部修改 |
| `DELETE` | 否 | 是 | 否 | 删除 |

`node:http` 对此**一无所知**：上一章实测小写 `get` 被解析器拒成 `400`、`PROPFIND` 照样进 handler。**语义完全靠你实现**——你可以写一个会改数据的 GET，没人拦你。

### 实测：PUT 是替换，PATCH 是合并

```text
PUT   /articles/p1  body {"title":"P"}   201 Created | Location: /articles/p1
PUT   /articles/p1  同 body 再来一次      200 OK       ← 第二次不再创建，状态码变化就是「创建 vs 更新」的信号
PATCH /articles/p1  body {"body":"正文"} 200 OK | {"id":"p1","title":"P","body":"正文"}
PUT   /articles/p1  body {"title":"P2"}  200 OK | {"id":"p1","title":"P2"}  ← body 字段没了：整体替换
DELETE /articles/p1 第一次                204 No Content（无 body，无 Content-Length）
DELETE /articles/p1 第二次                404 Not Found | {"error":"already gone"}
```

`{"views":+1}` 这类 PATCH 重放两次就多加两次，**别把它当幂等**；真要幂等就换 `PUT` 到客户端生成的 id，或用 `Idempotency-Key`（见下文实测）。「DELETE 幂等」指**状态相同**（资源不存在），不是响应码相同：给 `204` 还是 `404` 要写进文档，客户端的重试逻辑两种都当成功。

## 状态码：客户端拿到它之后该做什么

选状态码的唯一标准是「它规定的客户端下一步」。以下每条都是本机实测的真实响应行。

```text
201 Created | Location: /articles/a3 | {"id":"a3","title":"标题一","body":null}
204 No Content | Date: ... | Connection: close           ← 没有 Content-Length，没有 body
205 Reset Content | Content-Length: 5                    ← body 照样发出去（与 204 不同）
206 Partial Content | Content-Range: bytes 0-8/23 | Accept-Ranges: bytes | Content-Length: 9

GET /articles/p1 | If-None-Match: "db409fdf3e16fea7"
  HTTP/1.1 304 Not Modified | ETag: "db409fdf3e16fea7"   ← 没有 body、Content-Type、Content-Length
```

`201` 不带 `Location` 就是失职，客户端只能再 GET 一次列表去找自己刚建的东西。`204` 是删除、无内容 PATCH 的正确选择，但**别指望它带 body**——上一章实测 Node 会直接丢掉 `res.end('{"a":1}')`。前端拦截器写 `if (status === 200) 取 data` 时，`204` 会走「无数据」分支，这是要和前端说清楚的约定。`304` 必须把 `ETag` 带回来（客户端要更新自己那份校验器），其余表示层头部都不该出现。`202` 用在异步任务：已接受但没做完，响应给任务资源的 `Location` 让客户端轮询，落地见[后台作业](/backend/uploads-and-jobs)与[为什么需要异步解耦](/message-queue-cloud/why-async)。

| 我想表达 | 用 | 关键约束 |
| --- | --- | --- |
| 请求体语法/字段不合法 | `400` | 别把所有异常都塞进 400 |
| 语义正确但内容处理不了 | `422` | 与 400 的分界：能不能解析 |
| 没登录 / 凭证无效 | `401` | 带 `WWW-Authenticate` |
| 登录了但没权限 | `403` | 见[授权与权限](/backend/authorization) |
| 资源不存在 | `404` | 越权访问别人的资源时**也常返回它**，避免泄露存在性 |
| 方法不对 | `405` | **必须带 `Allow`** |
| 前置条件失败（乐观锁） | `412` | 配 `If-Match` |
| 冲突（重名、幂等键重用） | `409` | 推荐码 |
| 限流 | `429` | **必须带 `Retry-After`** |
| 下游不可用 | `502`/`503`/`504` | `503` 配 `Retry-After` 让客户端与探针退避 |

`405` 的 `Allow` 谁来填？**你**。上一章实测我补了 `setHeader` 才有；`400`/`404`/`412`/`416`/`429`/`431` 在本机的原文分别是：

```text
400 Bad Request | {"error":"invalid JSON body"}
405 Method Not Allowed | Allow: GET, POST | {"error":"bad method"}
412 Precondition Failed | {"error":"precondition failed","server_etag":"\"db409fdf3e16fea7\"","your_if_match":"\"stale\""}
416 Range Not Satisfiable | Content-Range: bytes */23
429 Too Many Requests | Retry-After: 2 | {"error":"slow down"}
431 Request Header Fields Too Large（默认服务器，20KB 请求头）
```

实测 `OPTIONS /articles` 也落进了 405 分支并带回 `Allow: GET, POST`——这暴露一个真实缺口：跨域预检要的是 `200` 加 `Access-Control-Allow-*`，`405` 会被浏览器判为预检失败，前端只看到一句 `CORS request did not succeed`。CORS 需要专门实现（[Web 安全](/backend/web-security)），不能指望通用 405 兜住。

## 条件请求：ETag 让并发编辑与缓存同时成立

| 头 | 用在哪 | 语义 | 失败时的状态码（实测） |
| --- | --- | --- | --- |
| `If-None-Match` | 读 | 「和我的 ETag 相同就别发 body 了」 | 相同 → `304` |
| `If-Match` | 写（PUT/PATCH/DELETE） | 「只有和我看到的版本一致才允许改」 | 不同 → `412` |

前者省带宽，后者解决**丢失更新**：两人同时编辑同一篇文章，后保存的会静默覆盖前一个人的改动。实测 `412` 的响应体里带了 `server_etag`，客户端拿到就能「重新拉取 → 合并 → 再提交」。ETag 用内容的哈希：

```js
import crypto from 'node:crypto';
const etagOf = (obj) => '"' + crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16) + '"';
```

三个坑：**(a) 弱校验器 `W/"..."` 不能用于 `If-Match`**；**(b) 生成 ETag 的那次序列化必须与发出去的 body 一致**（字段顺序变化会导致永远不命中）；**(c) 实测 `If-None-Match` 打在不存在的资源上返回 `404` 而不是 `304`**——这是对的，别为了省一次查询回 304。

## 缓存：只设 max-age 等于没设

响应侧真正要写的就三行，`Cache-Control` 优先于一切老式头部：

```text
Cache-Control: private, max-age=30, must-revalidate
Vary: Accept-Encoding, Authorization
ETag: "db409fdf3e16fea7"
```

| 指令 | 含义 | 什么时候用 |
| --- | --- | --- |
| `public` / `private` | 能否被**共享缓存**（CDN、代理）存 | 带用户身份的响应必须 `private` |
| `max-age=N` | 新鲜期，期内**不发请求** | 列表/详情几秒的容忍度 |
| `no-cache` | 可以存，但每次必须先校验（配 ETag → `304`） | 想省 body 又想实时 |
| `no-store` | 不许存副本 | 含密码、token、个人信息的响应 |
| `must-revalidate` | 过期后不许擅自续用 | 权限相关数据 |
| `s-maxage=N` | 只给共享缓存看的过期时间 | 与 `max-age` 分两层控制 |

`private` 的漏用是真实事故源：带 `Authorization` 的接口被 CDN 缓存，用户 A 的数据发给用户 B（练习 3 整道都在做这个）。`Vary: Accept-Encoding` 是必须的——gzip 与 br 的 body 不同而 ETag 相同，不 Vary 就会把 br 的 body 发给只支持 gzip 的客户端；身份参与判定时再补 `Vary: Authorization`。这条与 [HTTP 缓存](/frontend-engineering/http-caching) 里客户端侧的判定完全对应。

**`Last-Modified` 与 `ETag` 谁优先？** `ETag`。`If-Modified-Since` 粒度只到秒，同秒内的两次修改会被误判为「没变」；上一章实测静态响应里 `node:http` 什么缓存头都不给你，这反而是好事——要就自己写。集合/分页响应建议 `private, no-store`，因为 ETag 对「分页 × 筛选」的键空间没意义（实测服务器只给了 `Cache-Control: private, max-age=30` + `ETag`，所以那行是我后来改的结论）。

## URL 设计与版本化

规则按「违反的代价」排序：

| 规则 | 反例 | 为什么 |
| --- | --- | --- |
| 名词、复数、层级表达从属 | `/getUserInfo`、`/api/do-order` | 动词交给方法，路径只负责定位资源 |
| 从属关系用路径 | `/orders?userId=5` | `/users/5/orders` 才能天然做子资源权限校验 |
| 筛选用 query | `/orders?status=paid&page=2` | 分页排序参数不是资源身份，别塞进路径 |
| **不要把秘密放进 URL** | `?token=...`、`?mobile=138...` | URL 进访问日志、`Referer`、浏览器历史、CDN 日志 |
| 路径参数要显式解码 | `/users/abc%20def` | 上一章实测：`searchParams` 自动解码，路径参数**不会** |
| 批量与长任务要有专门资源 | 循环调 100 次 POST | `POST /orders:batchCreate`，或 `202` + 任务资源 |

状态机转移用 `POST /orders/9/cancel` 比 `PATCH {"status":"cancelled"}` 好：前者能表达「已发货就不能取消」，后者诱使你开放任意字段写入（越权改状态的经典入口）。**路径归一化没人帮你做**：上一章实测 `/a//b` 原样到达 handler，而 `curl` 会先折叠 `../`；要么显式声明「双斜杠与尾斜杠都 404」，要么自己归一化后 `301` 到规范形式（后者对 SEO 与缓存键更重要）。

| 版本化方案 | 例子 | 优点 | 代价 |
| --- | --- | --- | --- |
| 路径前缀 | `/v1/articles` | 网关/CDN 好路由，肉眼可见 | 「版本」进了资源标识，同一资源两个 URI |
| query | `?api-version=1` | 可给默认值，缓存键可控 | 容易被复制、漏写 |
| 请求头 | `Accept-Version: 1` | URI 干净，语义最正确 | **不可缓存、地址栏不可调试**、中间设备可能吃掉 |

**绝大多数团队该用路径前缀**。选哪种都要守同一条纪律：**同一 URI 上永不破坏兼容**（加字段可以，删字段/改类型/改状态码语义不行）；**弃用要有信号**——`Deprecation` / `Sunset` 响应头加文档，别只在 changelog 里写一句。「响应里多一个字段算兼容」的前提是文档要求客户端忽略未知字段，这是要明说的约定，不是默认能力。

## 幂等键：把「客户端不敢重试」变成工程问题

实测（同一资源服务器，`Idempotency-Key: K1` 连发两次 POST）：

```text
POST /articles  Idempotency-Key: K1   201 | Location: /articles/a3
POST /articles  Idempotency-Key: K1   201 | X-Idempotent-Replay: true | {"id":"a3",...}  ← 同一个 id，没有新建
GET  /articles                        200 | {"count":3,"ids":["a1","a2","a3"]}           ← 只多了一条
```

```js
const key = req.headers['idempotency-key'];
if (key && store.has(key)) return replay(store.get(key));   // 直接回放原状态码与 body
const result = await createOrder(body);
if (key) store.set(key, result, { ttl: 24 * 3600 });        // 记录结果，别只记「进行中」
```

| 问题 | 处理 |
| --- | --- |
| 客户端不给 key | 服务端不能替它编；写进文档并校验必填，否则重试风暴照样发生 |
| 处理到一半崩了 | 「进行中」记录设短 TTL，或用「锁 + 重试返回 `409`」，别把 `500` 缓存一整天 |
| key 存哪 | 单机内存重启即失效（上面实测用的就是 `Map`）；多实例必须进 Redis，见[分布式会话、限流与幂等](/data-storage/session-rate-limit-idempotency) |
| 与 `PUT` 的分工 | 客户端能生成 id 时优先 `PUT /orders/{client-uuid}`，天然幂等，不需要额外头 |

## 超时链条：keep-alive 上谁先闭嘴

`node:http` 的默认值（本机从 server 对象直接读出，Node v25.4.0）：

| 参数 | 默认 | 管什么 |
| --- | --- | --- |
| `keepAliveTimeout` | **5000** | 请求之间，空闲 keep-alive 连接保留多久 |
| `headersTimeout` | **60000** | 收完整个请求头的最长时间 |
| `requestTimeout` | **300000** | 整条请求（含 body）的最长时间 |
| `maxRequestsPerSocket` | 0（不限） | 单连接最多服务多少个请求 |
| `maxHeaderSize` | 未设置时取内置 16 KiB | 请求头上限，超过 → `431` |

同机实测的连接层行为：

```text
响应头（HTTP/1.1 请求）：Connection: keep-alive | Keep-Alive: timeout=5
keepAliveTimeout=5000：空闲 6010ms 被服务端关闭
keepAliveTimeout=1000：空闲 2006ms 被服务端关闭
maxRequestsPerSocket=2：同一连接连发 4 个请求 → 连接被服务端提前关闭
Expect: 100-continue（未注册 checkContinue 监听器）→ 原始响应首行 HTTP/1.1 100 Continue
```

注意后两行的时机比配置值晚约 1 秒（本机观察值，不是承诺值），而且**服务端单方面断开时不给任何 HTTP 响应**，客户端只会看到连接关闭或下一个请求直接失败。这就是开头那个「偶发 502」的机制：

```text
网关空闲超时 T_gw，服务端 keepAliveTimeout T_srv
T_srv > T_gw → 网关判定连接空闲并关掉，服务端还以为它活着
            → 服务端把新请求写进已关闭的 socket → RST → 网关报 502/504
            → 服务端日志一条错误都没有（它根本没收到那个请求）
正确做法：T_srv 明显小于 T_gw，并让网关只复用「确定还活着」的连接
```

<Callout type="unverified" title="网关侧数值未在本机验证">

Nginx `upstream` 空闲回收、各云厂商负载均衡的 idle timeout 具体默认值，本章**没有实测**（本机无代理环境）。核对入口：[Nginx keepalive_timeout 指令](https://nginx.org/en/docs/http/ngx_http_core_module.html#keepalive_timeout) 与你所在云厂商的负载均衡文档。实验设计：把服务端 `keepAliveTimeout` 分别设为大于和小于代理空闲超时，同一连接连打两个请求、中间静置 65 秒，看 `curl -v` 里出现 `Connection reset by peer` 的是哪一侧。这条要在真实代理环境做，别在生产试。

</Callout>

还有一条同名头实测：发两个 `X-Multi`，`req.headers['x-multi']` 读到的是合并后的 `"a, b"`——所以 `req.headers.cookie` 可能有两个来源，解析要按 `,` 或 `;` 分开。

## 常见错误与排查

**1. 成功失败都回 `200`，前端只能猜。** 现象：`{code: 1, msg: '失败'}` 满天飞，监控里错误率永远是 0，重试逻辑不敢开。原因：把状态码当业务码。确认：`curl -i` 看错误响应的状态行。修法：状态码表达**传输层结果**（400/401/404/409/429/500），业务原因放 body 的错误结构里，见[统一错误处理](/backend/error-handling)。

**2. `POST /delete?id=1`，然后抱怨「接口不稳定」。** 现象：偶发重复删除、重复下单；缓存策略完全失效。原因：POST 不幂等也不缓存。确认：同一请求重放两次，看服务器状态是否变化（本章就做了 PUT 与 POST 的对照）。修法：删除改 `DELETE /articles/{id}`，创建改 `POST` + `Idempotency-Key` 或客户端生成 id 的 `PUT`。

**3. `405` 忘了 `Allow`，`429` 忘了 `Retry-After`。** 现象：客户端不知道该发什么方法、该等多久，只能盲重试打爆服务。确认：`curl -i -X DELETE ...` 看响应头。修法：405 一定带 Allow、429 与 503 一定带 Retry-After（本章实测的两个原文就是这两行）。

**4. 只发 `Cache-Control: max-age=3600` 就上线。** 现象：内容改完客户看不到、无法灰度回滚、`304` 一个都没出现。原因：没有 `ETag` 就没有条件请求，客户端在有效期内根本不请求。确认：抓包看第二次请求是否带 `If-None-Match`、有没有 `304`（本章两条都有实测原文）。修法：`ETag` 与 `Cache-Control` 一起发；带身份的响应加 `private` 与 `Vary: Authorization`；含敏感数据用 `no-store`。

**5. 偶发 502/504，服务端日志干净。** 现象：流量低谷期反而出现失败率抖动。原因：`keepAliveTimeout` 大于上游空闲超时。确认：在网关侧看错误是否总发生在「静置一段时间后的第一个请求」，再对照本章默认值 5000ms。修法：服务端 keep-alive 明显短于上游，同时确认 `headersTimeout` 大于 `keepAliveTimeout`（默认 60000 与 5000 是安全的）。

**6. CORS 预检失败，报错只有一句 `no 'Access-Control-Allow-Origin' header`。** 现象：简单请求能通，带自定义头或 PUT/PATCH 就挂。原因：`OPTIONS` 落进 405 分支（实测就是这个行为）。确认：`curl -i -X OPTIONS -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: PUT" ...` 看是不是 405。修法：专门处理 OPTIONS，且**预检响应不能要求携带凭证**，见[Web 安全](/backend/web-security)。

## 练习

<Exercise title="练习 1 · 状态码与响应头配对" difficulty="基础">

给五个场景写出「状态码 + 必须出现的响应头」，并说明客户端下一步做什么：① 创建成功；② `DELETE` 成功但没内容；③ 客户端带了 `If-Match` 但版本已变；④ 触发限流；⑤ 请求体是 `{"a":` 这种半截 JSON。

<template #answer>

① **`201` + `Location: /articles/a3`**，body 是新资源；客户端把 `Location` 当规范地址（本章实测就是这个组合）。
② **`204`**，**没有** `Content-Length`、没有 body（上一章实测 Node 会丢弃误写的 body）。客户端应把「无 body」当成功，别在拦截器里只判 `status === 200`。
③ **`412 Precondition Failed`**，body 里给 `server_etag`（实测就这么返回）。客户端应重新 GET 拉最新、合并、再带新 ETag 提交——这是不覆盖别人改动的唯一可靠路径。
④ **`429` + `Retry-After: 2`**（实测原文）。客户端按秒退避，且**不能**把这次重试算成新的用户意图（幂等键复用同一个）。
⑤ **`400 Bad Request`** + 可读错误（实测 `{"error":"invalid JSON body"}`）。这与 `431` 不同：431 由解析器产生，压根不会进你的 handler（上一章实测）。

</template>

</Exercise>

<Exercise title="练习 2 · 为一个笔记资源设计 REST 接口" difficulty="进阶">

需求：用户拥有多篇笔记；支持列表（分页 + 关键词）、创建、按 id 读取、重命名、移动到其他笔记本、批量删除。写出方法 + 路径 + 关键响应，并指出哪些接口要 `private`、哪些需要 `Idempotency-Key`、哪一处最容易越权。

<template #answer>

| 操作 | 请求 | 成功响应 |
| --- | --- | --- |
| 列表 | `GET /users/me/notes?page=2&q=%E6%A0%87%E9%A2%98` | `200`，`Cache-Control: private, no-store` |
| 读 | `GET /users/me/notes/{id}` | `200`，带 `ETag` |
| 创建 | `POST /users/me/notes` + `Idempotency-Key` | `201` + `Location` |
| 重命名 | `PATCH /users/me/notes/{id}`，带 `If-Match` | `200` + 新 `ETag`；版本冲突 `412` |
| 移动 | `POST /users/me/notes/{id}:move`（或 `PATCH` 只允许 `notebookId` 白名单字段） | `200`；目标无权限 `403` 或 `404` |
| 批量删除 | `POST /users/me/notes:batchDelete`，body 是 id 数组 | `200` + 逐条结果，或约定全成功时 `204` |

要点：**列表用 `private, no-store`**（分页 + 关键词的 ETag 键空间没意义，且是私有数据）；**创建要 `Idempotency-Key`**（弱网重试最容易重复建笔记）；**移动与批量删除是越权高发点**——必须逐条校验「这条笔记属于我」，否则一条请求就能改别人的数据，这是[授权与权限](/backend/authorization)里水平越权的原型。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误：把缓存开在鉴权接口上" difficulty="挑战">

有人给下面这个响应加了 `Cache-Control: public, max-age=300`，30 秒内第二个用户的请求打到了同一台 CDN 节点。解释会看到什么、为什么，并给出三个必须同时具备的正确配置。

```text
GET /api/me
HTTP/1.1 200 OK
Cache-Control: public, max-age=300
ETag: "b7f3..."

{"name":"张三","email":"z@example.com"}
```

<template #answer>

**现象**：用户 B 登录后直接命中缓存，拿到的 `name` 是「张三」——B 在自己会话里看到了 A 的个人信息，还可能顺手以这个身份发写操作。根因：`public` 授权共享缓存按 **URL** 存副本，而 `/api/me` 对所有用户是同一个 URL，副本里躺的是别人的响应体（本章「只发 max-age 不发校验器」故障的加强版）。

三个必须同时具备的配置：

```text
Cache-Control: private, no-store
Vary: Cookie, Authorization
```

**① `private` 或直接 `no-store`**：禁止共享缓存存副本；含身份数据建议 `no-store`，因为「存下来但每次回源校验」仍然意味着副本里是别人的数据。**② 身份不能靠 URL 区分**：响应随 `Cookie`/`Authorization` 变化时 `Vary` 必须列出它们；更彻底的做法是把身份放进路径（`/users/123/profile`），让缓存键天然不同。**③ 校验器指向正确的资源版本**：`ETag` 用响应内容哈希（本章就是 sha1 前 16 位），不要用 `Last-Modified`（秒级粒度，同秒改动会被判「没变」）。

**线上怎么确认**：用两个账号的凭证打同一个 URL，看第二次是否出现 `304` 或 `x-cache: HIT`；再 `curl -H "Authorization: Bearer B" -i` 看响应里是不是 A 的数据。前半段本地就能做，共享缓存那一层需要真实代理环境，**未在本机验证**。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN HTTP 方法概览](https://developer.mozilla.org/zh-CN/docs/Web/HTTP) —— 核实「安全 / 幂等 / 可缓存」三个属性的定义、`PUT` 的替换语义与 `PATCH` 不保证幂等（本章方法表和 PUT/PATCH 实测对照的依据）。
- [MDN 状态码索引](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status) —— 核实每个状态码规定的客户端行为：`405` 必须带 `Allow`、`429` 应带 `Retry-After`、`204` 不含 body（实测 Node 丢 body 正是这条的体现）。
- [MDN `Cache-Control`](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Cache-Control) 与 [MDN `ETag`](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/ETag) —— 核实 `public`/`private`/`no-cache`/`no-store`/`must-revalidate` 的含义与强弱校验器对 `If-Match` 的规则（练习 3 答案的依据）。
- [Node.js `http` 模块 API](https://nodejs.org/docs/latest/api/http.html) —— 核实 `checkContinue` 的默认行为与 `clientError` 的 400/431 分支；**该页不列超时默认值的具体数字**，所以本章那些数字标成本机 v25.4.0 实读而非文档规定。
- [MDN 连接管理与 keep-alive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Connection_management_in_HTTP_1.x) —— 连接复用与超时错配的背景，用来对照那张「谁先闭嘴」的链条图。

## 下一章

这一章把契约逐条落到实测响应上：方法语义解释了为什么 `POST /delete` 会诱发重复删除，状态码解释了 `204` 为什么必须无 body，`ETag`/`If-Match` 解释了并发编辑与缓存如何同时成立，超时链条解释了那个日志干净的偶发 502。[Fastify 入门：路由、插件与 Schema](/backend/fastify-basics) 接着问**这些契约怎么不靠自觉执行**：路由替你表达方法语义，`schema` 在门口把非法请求拦成 `400`（本章的 400 是手写的），序列化器保证响应里不出现你不想暴露的字段，插件封装边界决定鉴权在哪一层生效。每当框架的行为不符合你的预期，答案都在本章与[手写最小服务器](/backend/minimal-http-server)的字节里。
