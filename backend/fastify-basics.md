# Fastify 入门：路由、插件与 Schema，先搞清封装边界封了什么

`request.query.page` 打印出来是字符串 `"2"`，你把它拼进 `LIMIT` 后面，数据库收到 `'2'`；某天你给列表接口加了 `status` 字段，前端拿不到——响应 Schema 里没写它，被序列化器丢掉了；最诡异的是登录接口：你在根实例上 `addHook('preHandler', auth)`，结果连 `/login` 也被自己的鉴权拦死，改成在插件里注册，某个插件生效、另一个不生效。

这三类现象分属 Fastify 的三条主线：**Schema（校验与序列化各自能改什么）**、**生命周期（钩子在哪个点跑、往哪个方向继承）**、**封装（`register` 造出的新作用域能看见什么）**。它们都不报编译错误，也不写在文档首页。前置三章都要在手边：[Node.js 运行时](/backend/node-runtime)解释这些 API 为什么是异步的、流为什么不能当值用；[用 node:http 手写最小服务器](/backend/minimal-http-server)——本章每处「框架替你做了什么」都对应那一章实测过的行为；[HTTP 与 REST 原理](/backend/http-and-rest)——方法语义、状态码、`Allow` 与缓存不是 Fastify 定的。本站后端代码用 TypeScript，泛型写法见 [TypeScript 第 6 章 泛型](/typescript/generics)。

<Callout type="unverified" title="本章没有跑过一行 Fastify 代码，这是事实而非疏漏">

开工前我在本机确认过依赖情况（这条 `ls` 是真跑的）：

```bash
$ ls node_modules | grep -i -E '^fastify|^@fastify'
（无任何输出，退出码 1）
```

`node_modules` 里**没有 fastify**，而本项目禁止我安装任何依赖（`npm install` 会污染共享项目的锁文件，影响其他人）。所以本章的规则是：**所有代码与输出一律是「按官方文档推演的预期结果」，不写「实测」二字**。文档口径来自 2026-10-18 抓取的 fastify.dev 文档站（页面标注的稳定版本 5.12.7），版本号请你自己再核一次。

复现成本很低：`npm i fastify`，代码存成 `.mjs`，`node index.mjs`，另开终端 `curl -si http://127.0.0.1:3000/...`。**读本章最好的方式是边跑边对照我给的预期**；凡与你本机输出不一致，以你本机为准并把差异记下来——主版本升级最容易改的就是默认值。

</Callout>

## 一个能跑的骨架：三处和 node:http 不一样的地方

```js
import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/api/health', async () => ({ ok: true }));

app.route({
  method: 'POST',
  url: '/api/users',
  schema: { /* 见下文 */ },
  handler: async (request, reply) => {
    reply.code(201).header('location', '/api/users/1');
    return { id: 1, name: request.body.name };
  },
});

await app.listen({ port: 3000, host: '0.0.0.0' });
```

| 手写版本 | Fastify 里你只需要 | 注意 |
| --- | --- | --- |
| `createServer((req, res) => …)` | `Fastify(options)` + 逐条注册路由 | handler 参数是 `(request, reply)`，`request` **不是** `IncomingMessage`；原始对象在 `request.raw` / `reply.raw` |
| `matchRoute` 逐段比 + `new URL` | `app.get('/api/users/:id', …)`、`request.params` / `request.query` | 路由是「方法 + 路径」的组合键，参数与 query 已解析好 |
| `readJsonBody` + 限长 + catch | `request.body` | 解析与限长归 content-type parser，默认 `bodyLimit: 1048576` |
| `sendJson` + `Buffer.byteLength` | `return 对象` 或 `reply.send(对象)` | 长度由框架算，中文截断那类坑不会再出现 |
| handler 外层 `try/catch` | `setErrorHandler` | 默认错误处理器兜住异常，不会像手写那样把进程带走 |

三条最容易记反的规则，都来自官方文档。**`async` handler 的返回值就是响应体**，但同时用了 `return` 和 `reply.send()` 时文档原话是「the first one takes precedence, the second is discarded, and a warn log is emitted」——**先到者生效、后者丢弃并打一条 warn**，不是「谁写完算谁」。handler 只能给一处：文档明确「把 handler 同时写在 options 里和作为快捷方法的第三个参数会抛 duplicate handler 错误」。流式响应（手写章的 `pipeline`）仍然是把可读流交给 `reply.type(...).send(stream)`。

日志默认是关的：不传 `logger` 一行都没有；`logger: true` 才有下面这行，且默认还会为每个请求再打一行（`disableRequestLogging` 默认 `false`）。预期 stdout：

```text
{"level":30,"time":...,"pid":...,"hostname":"...","msg":"Server listening at http://127.0.0.1:3000"}
```

字段名与顺序以你本机为准；`requestIdLogLabel` 默认 `reqId`，所以每条请求日志都带一个请求 ID——这是第 12 章做链路追踪的抓手，见[日志与监控](/backend/logging-and-monitoring)。

## 路由：默认值决定了你的 URL 长什么样

```js
app.get('/api/users/:id', async (request) => ({ id: request.params.id }));
app.get('/files/*', async (request) => ({ rest: request.params['*'] }));
```

`GET /api/users/42` 预期 `{"id":"42"}`——**`params.id` 是字符串**，要 `Number()` 或交给 Schema 的 `coerceTypes`；通配段的键是 `'*'`，`/files/a/b.txt` 预期得到 `'a/b.txt'`。几个从文档核实到的默认值，直接决定「URL 差一点就 404」这类怪事：

| 选项 | 默认 | 后果 |
| --- | --- | --- |
| `caseSensitive` | `true` | `/API/Users` 与 `/api/users` 是两个 URL |
| `ignoreTrailingSlash` | `false` | `/api/users/` **不等于** `/api/users`，多一个斜杠就落到 not-found |
| `exposeHeadRoutes` | `true` | 注册 `GET` 时自动生成 `HEAD`，不用自己写「只回头不灌 body」 |
| `bodyLimit` | `1048576` | 超过预期 413；上传接口要单独放大，见[文件上传与后台作业](/backend/uploads-and-jobs) |

未命中的路由走 not-found handler，文档里出现的默认响应体形如：

```text
{"message":"Route GET:/not-found not found","error":"Not Found","statusCode":404}
```

`message` 的字符串形态（方法 + 冒号 + 路径）是从文档示例抄的，另两个字段我没逐字核对。而**「路径存在但方法不匹配」该回 405 还是 404，我在文档里没找到明确承诺**——第 3 章讲过 405 必须带 `Allow`，那是 HTTP 的义务不是框架的。所以别猜：`curl -si -X DELETE http://127.0.0.1:3000/api/users/1` 看是 404 还是 405，再决定要不要在 not-found handler 里补 `Allow`（`setNotFoundHandler` 按作用域封装，可以单独设）。

## Schema 一次做两件事：进来校验，出去序列化

```js
app.get('/api/users', {
  schema: {
    querystring: {
      type: 'object',
      required: ['page'],
      properties: {
        page: { type: 'integer', minimum: 1, default: 1 },
        tag:  { type: 'array', items: { type: 'string' }, maxItems: 3 },
      },
      additionalProperties: false,
    },
    response: { 200: { type: 'object', properties: {
      page: { type: 'integer' },
      items: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' } } } },
    } } },
  },
  handler: async (request) => {
    console.log(typeof request.query.page);      // 预期: number
    return { page: request.query.page, items: [{ id: 1 }], leaked: '看不见' };
  },
});
```

校验的键名固定四个：`body`、`querystring`、`params`、`headers`；序列化用 `response`，它的键是**状态码**。

<Callout type="info" title="AJV 的四个默认值，本章所有意外都从这里长出来">

文档给出的默认校验器配置是 `{coerceTypes: 'array', useDefaults: true, removeAdditional: true, allErrors: false}`，逐条翻译成你会遇到的现象：

- `coerceTypes: 'array'`：`?page=2` 的 `"2"` 被转成 `2`，handler 里拿到 `number`；`?tag=x&tag=y` 这类重复键要在 `type: 'array'` 下才被当数组。**转换是隐式的，`typeof` 打印出来才看得见。**
- `useDefaults: true`：`page` 不传时按 `default` 填，于是 `required` 与 `default` 同时写会让 `required` 失去意义。
- `removeAdditional: true`：`additionalProperties: false` 之外，多余字段是**被静默删除**而不是报错。你以为拦住了脏字段，其实它悄悄改了 payload。
- `allErrors: false`：失败只报**第一条**错误，前端按 message 做表单提示时只能一次修一个字段；要全量就在 `Fastify({ ajv: { customOptions: { allErrors: true } } })` 里打开。

</Callout>

校验失败直接回 `400`，文档给出的失败响应体形如（`message` 就是 AJV 那句原始输出）：

```text
{"statusCode":400,"error":"Bad Request","message":"body should have required property 'name'"}
```

这对手写版的 `400 {"error":"name 必填"}`——**文案不同，状态码一致**，因为状态码是 HTTP 约定，文案是实现选择。另一条更容易被忽略的文档结论：**请求体校验只在 `Content-Type` 为 `application/json` 时进行**，客户端用 `text/plain` 发同一份 JSON，`body` 的 schema 根本不参与判断。预期复现：

```bash
curl -s -X POST http://127.0.0.1:3000/api/users -H 'content-type: application/json' --data '{"title":"x"}'  # 预期 400：缺 name
curl -s -X POST http://127.0.0.1:3000/api/users --data '{"title":"x"}'                                      # 预期 4xx：内容类型不支持，被 parser 拦
```

两条都失败但**原因不同**，别看状态码相同就当成同一件事；真要「所有 POST 都必须走 JSON 校验」得自己收口 content-type。

响应侧的收益：**性能**（`response` 交给 fast-json-stringify 预编译，不是每次反射式 `JSON.stringify`）与**不泄漏**——上面那个 `leaked` 字段预期不出现，预期输出 `{"page":1,"items":[{"id":1}]}`。这补上了手写章实测的 `JSON.stringify` 漏洞（`undefined` 被丢、`NaN` 变 `null`、`BigInt` 抛 `TypeError`），也顺手挡掉整行返回时的 `password_hash`。两个边界要记住：**别把 response schema 当脱敏机制**（字段级权限归[授权与权限](/backend/authorization)，schema 只保证「声明过的字段才出去」）；**每个会真实返回的状态码都要写 schema**，只写 `200` 时错误响应走默认序列化，`error`/`message`/`statusCode` 原样出去。验证方式：`curl -s ... | jq 'keys'` 对比加 schema 前后的键集合。

TypeScript 下 Schema 还兼任类型来源：`RouteShorthandOptions<..., { Querystring: { page: number } }>` 这类泛型能让 `request.query.page` 推断成 `number`，不写泛型时编译器帮不了你——跟[类型收窄](/typescript/unions-and-narrowing)一个道理，**类型是给人看的约束，运行时校验才是给攻击者的门槛**。同一份 schema 也是第 10 章 `@fastify/swagger` 生成 OpenAPI 的来源，见 [API 文档](/backend/api-docs)。

## 插件与封装：register 造新作用域，方向只有一条

```js
app.register(async function usersApi(instance, opts) {
  instance.decorate('repo', makeRepo(opts.kind));      // 只在 usersApi 内部可见
  instance.addHook('preHandler', requireAuth);         // 只影响本作用域及其子孙
  instance.get('/:id', async (request) => ({ id: request.params.id, kind: instance.repo.kind }));
}, { prefix: '/api/users', kind: 'pg' });

console.log(app.repo);                                 // 预期: undefined —— 父看不见子
```

封装（encapsulation）的规则可以压成三行，本章后面的例子全部由此推出：

| 问题 | 文档口径 | 你踩到时的现象 |
| --- | --- | --- |
| 装饰器/钩子往哪个方向可见 | **父的 `decorate` 与 hook 子能继承；子注册的父和其他兄弟插件看不见** | `fastify.db` 是 `undefined`，但在插件里能用 |
| `register` 做了什么 | **每次 `register` 默认创建一个新作用域（new context）** | 两个插件里同名 `decorate` 互不干扰，你以为共享成功了 |
| `fastify-plugin`（`fp`）改了什么 | **让插件不再创建新上下文，装饰落到父实例** | 官方插件几乎都套 `fp`，因为 `@fastify/helmet` 装饰出来的东西全局要能用 |

取舍很清楚：**要「一个共享实例」的东西套 `fp`，要「各管各的」的东西别套**。数据库连接池是最典型的翻车现场——不套 `fp` 的插件注册两次就起两个池；套了 `fp` 反而会在第二次注册时因装饰名冲突直接报错，更早暴露问题。

时机也有讲究：`register` 是**懒执行**的，插件在 `app.ready()`（或 `await app.listen()`）时才真正跑，所以「先 `register` 再取装饰器」很可能拿到空。相关默认值：`pluginTimeout` 默认 `10000` 毫秒——**插件里 `await` 一个连不上的数据库，10 秒后启动报插件超时**，先查连接串和网络。`prefix` 逐层拼接：外层 `/api` + 内层 `/users` + 路由 `/:id` → `/api/users/:id`，这是「路由明明写了却 404」的头号原因。

## 生命周期：钩子的顺序与作用域是同一件事

```text
onRequest → preParsing → preValidation → preHandler → handler
                                 ↑ 校验失败在此分叉 → onError → 错误响应
      handler 产出对象 → preSerialization → onSend → onResponse      （另有 onTimeout）
```

| 钩子 | 能拿到什么 | 典型用途 | 别拿来干什么 |
| --- | --- | --- | --- |
| `onRequest` | 只有 `request.raw`，**body 未解析** | 限流、计数、IP 黑名单 | 别在这里读 `request.body` |
| `preParsing` / `preValidation` | 原始 payload 流 / 已解析但未校验的 body | gzip 解码、替换 payload、结构转换 | 别在这里做业务校验 |
| `preHandler` | 已校验的 `body`/`query`/`params` | **鉴权、权限、租户上下文** | 别写业务逻辑，那是 handler 的事 |
| `preSerialization` / `onSend` | 序列化前的对象 / 最终 body 与头 | 包装响应、改写头 | 流式响应不走前者；后者别改状态码语义 |
| `onResponse` / `onTimeout` | 已发出的响应统计 / 超时事件 | 打点、访问日志、回 408 | 这里再 `reply.send` 已无意义 |
| `onError` / `setErrorHandler` | 错误对象 | 把内部错误映射成状态码与文案 | 别把底层异常原文回给客户端 |

应用级钩子是 `onReady`、`onListen`、`onRoute`、`onRegister`、`preClose`、`onClose`（资源初始化与释放、路由审计；关池放 `onClose`，配合第 14 章优雅关闭）。写钩子有两种风格，混用会静默失效：**`async` 钩子直接 return（要中断就 `throw`）**，或**非 async 用 `done(err, payload)`，错误是第一个参数**。

回到开头那个故障：`preHandler` 注册在根实例上，`/login` 也会被拦——**钩子向子孙继承，而根是所有作用域的父亲**。两种解法：

```js
// A：把受保护的路由收进一个带 hook 的子作用域（默认拒绝，成块）
app.register(async (instance) => {
  instance.addHook('preHandler', requireAuth);
  instance.get('/api/orders', listOrders);
});

// B：钩子内部按路由标记早退——父钩子照样跑，只是自己放过这一条
app.addHook('preHandler', async (request) => {
  if (isPublicRoute(request)) return;      // 判据可以是路由 config 标记或 URL 白名单
  await requireAuth(request);
});
```

A 是更安全的那一侧（新增路由自动被保护），代价是 URL 要和 `prefix` 对齐；B 的代价是那段判断会长成没人敢改的 `if`。**至于「给路由写 `preHandler: []` 能不能清掉父作用域注册的钩子」，我在文档里没找到明确说法，也没实跑，不要照抄**——按封装继承的方向推断父钩子仍会执行，判据请以你本机两条 `console.log` 的顺序为准。**这也是下一章分层架构的入口**：钩子决定哪些横切关注点挂在哪一层。

## 常见错误与排查

**1. `fastify.db` 是 `undefined`，但插件里能用。** 原因：封装方向只有一条（父看不见子），或读取时机太早（插件懒执行，`ready()` 之后才有装饰器）。确认：在两处分别打印 `instance.hasDecorator('db')`。修法：全局资源套 `fastify-plugin`；局部资源只在子作用域里用，别跨实例取。

**2. 加了 Schema 却什么都没校验。** 原因有二：body 校验只在 `Content-Type: application/json` 时进行；`removeAdditional: true` 把多余字段静默删掉而不是报错。确认：`curl -v` 看请求头有没有 content-type；在 handler 里打印 `Object.keys(request.body)` 与原始 payload 对比。修法：统一收口内容类型；确实要拒绝未知字段就把 `additionalProperties: false` 与自定义 AJV 配置配合起来，改完重新验证而不是假设生效。

**3. `?page=2` 变成 `2`，SQL 报错才发现类型来自隐式转换。** 原因：`coerceTypes` 默认开着。确认：`console.log(typeof request.query.page)`，或注释掉 `schema.querystring` 再看变化。修法：把边界写进 Schema（`integer` + `minimum` + `maximum`）并在泛型里声明类型；**永远不要把 query 值直接拼进 SQL**，参数化查询见[数据建模](/database/data-modeling)。

**4. 启动报插件超时。** 现象：`listen` 挂十几秒后失败。原因：插件里有没被正确 `await` 的初始化，或数据库/Redis 连不上，超过 `pluginTimeout`（默认 10000ms）。确认：在插件首行 `instance.log.info('进入插件')`，看日志是否停在插件内部；把连接串指向必然失败的端口复现。修法：外部依赖加超时与重试，本地先用 repository 桩（第 5 章）让启动不阻塞。

**5. 全局 `onRequest`/`preHandler` 把公开接口也拦了。** 现象：`/login` 返回 401，日志显示 hook 执行了。原因：钩子向子孙继承，注册在根上就是全拦。确认：在 `onRoute` 里打印每条路由的 `url`，看它落在哪个作用域。修法：作用域切分（解法 A）或钩子内部早退（解法 B）；把鉴权做成可组合的装饰器比裸 hook 好管，见[认证](/backend/auth-session)。

## 练习

<Exercise title="练习 1 · 预测校验后的 request.query" difficulty="基础">

沿用本章 `/api/users` 的 `querystring` schema（`coerceTypes: 'array'`、`useDefaults: true`、`removeAdditional: true`、`allErrors: false`、`additionalProperties: false`、`page` 有 `default: 1` 且 `required`）。分别写出四个请求下 `request.query` 的内容与状态码。

```text
A  GET /api/users
B  GET /api/users?page=3&sort=desc
C  GET /api/users?page=abc
D  GET /api/users?page=0
```

<template #answer>

**A** → 预期 `200`，`query = { page: 1 }`：`useDefaults` 补上默认值，`typeof page` 是 `number`。

**B** → 预期 `200`，`query = { page: 3 }`：`sort` 不在 `properties` 里且 `additionalProperties: false`，被 `removeAdditional` **静默删除**，不报错。这是最容易被误解的一条——你以为拒绝了脏参数，其实只是丢了它。

**C** → 预期 `400`，message 由 AJV 生成、形如「page must be integer」这类句子（**具体文案按版本可能不同，别按字符串匹配写代码，判 400 即可**）：`"abc"` 无法 coerce 成整数。

**D** → 预期 `400`：coerce 成 `0` 之后违反 `minimum: 1`。**先转换再校验约束**，所以 `page=0` 是范围错误而不是类型错误，两种 message 不同。

四条一起验：`curl -s -o /dev/null -w "%{http_code}\n"` 逐个打状态码，再在 handler 里 `request.log.info(request.query)`。

</template>

</Exercise>

<Exercise title="练习 2 · 把 /login 从全局鉴权里救出来" difficulty="进阶">

根实例上注册了 `preHandler: requireAuth`，`/login`、`/healthz` 必须公开，其余 `/api/*` 全部要鉴权。给出两种改法，并说明各自的维护成本。

<template #answer>

**改法一（作用域切分，推荐）**：把需要鉴权的路由集中 `register` 进一个子作用域，在其中 `addHook('preHandler', requireAuth)`，公开路由留在根上。优点是横切关注点集中、新增路由默认继承鉴权；代价是 URL 要和 `prefix` 对齐，路由搬迁时容易把 `/api/orders` 变成 `/private/api/orders`——**正是本章「路径写了却 404」的来源**，改完必须逐条 `curl`。

**改法二（钩子内部早退）**：在 `requireAuth` 里按路由标记（`request.url` 白名单，或路由 `config` 上的 `public` 标记）先 return。优点是不动目录结构；缺点是这段判断会长成没人敢改的 `if`，而且新加公开路由时**默认是拦住的**，容易忘。本站正文对「路由级 `preHandler: []` 能否清掉继承的钩子」持保留态度（没核实、没实跑），别把它当改法二的实现。

两种都要留一条验证：不带 token 打 `/login` 预期不是 401，不带 token 打 `/api/orders` 预期 `401`。用 `onRoute` 把最终注册的路由清单打出来比肉眼核对目录可靠。第 6 章[统一错误处理](/backend/error-handling)会把鉴权抛出的错误统一成状态码，别在各处写自己的 `reply.code(401).send(...)`。
</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误：解释 db 为 undefined 与连接池翻倍" difficulty="挑战">

下面两段代码：第一段在根上打印 `app.db`；第二段去掉 `fp` 包裹并注册两次，结果进程里出现两个连接池。分别解释原因，并说明「保留共享但阻止重复注册」怎么写。

```js
import fp from 'fastify-plugin';
const dbPlugin = fp(async (instance) => {
  instance.decorate('db', await makePool());
}, { name: 'db' });

app.register(dbPlugin);
console.log(app.db);                     // 现象一：undefined 还是 pool？

app.register(async (instance) => {       // 现象二：不套 fp
  instance.decorate('db', await makePool());
});
app.register(function routes(instance) { instance.get('/x', (r) => r.server.db); });
```

<template #answer>

**现象一**：套了 `fp` 的插件**不创建新上下文**，装饰落在注册它的那个实例上，所以最终 `app.db` 有值——但读取时机是关键：插件懒执行，`decorate` 发生在 `ready()`（即 `await app.listen()`）时，**在 `register` 之后同步打印，预期仍是 `undefined`**。这不是 bug，是顺序：要拿装饰器就在插件内部，或在 `onReady` / `listen` 之后。

**现象二**：不套 `fp` 时 `register` 创建新作用域，池装饰在第一个子实例上，而 `routes` 是**另一个**子作用域，看不到前者 → 取 `instance.db` 得到 `undefined`。更糟的是同一份不套 `fp` 的插件注册两次就建两个池 → **连接数按作用域数量翻倍**，而日志不会告诉你为什么数据库连接打满。

**正确形状**：`fp` 保证装饰落到根，`{ name: 'db' }` 配合 `fastify-plugin` 的重入保护让重复注册只生效一次，池的释放挂 `onClose`。判据两条：`ready()` 之后 `app.hasDecorator('db')` 为 `true`，且 `makePool()` 的构造日志只出现一次。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Fastify 路由](https://fastify.dev/docs/latest/Reference/Routes/) —— 核实：`return` 与 `reply.send()` 同时出现时「先到者生效、后者丢弃并打 warn」；handler 同时写在 options 与快捷方法第三参数会抛 duplicate handler；not-found 默认响应体里 `Route GET:/not-found not found` 的形态；`setNotFoundHandler` 是封装的。
- [Fastify 插件与作用域](https://fastify.dev/docs/latest/Reference/Plugins/) —— 核实「`register` 创建新作用域」「`fastify-plugin` 不再创建新上下文」，本章封装表与练习 3 的依据。
- [Fastify 钩子](https://fastify.dev/docs/latest/Reference/Hooks/) —— 核实钩子清单与顺序、子作用域继承父钩子而父看不到子、`done` 的第一个参数是错误。
- [校验与序列化](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) —— 核实 AJV 默认 `{coerceTypes: 'array', useDefaults: true, removeAdditional: true, allErrors: false}`、`response` 按状态码组织、失败时的 `400` 响应体示例、body 校验只在 `Content-Type: application/json` 时进行、序列化用 fast-json-stringify。
- [Server 选项](https://fastify.dev/docs/latest/Reference/Server/) 与 [错误码](https://fastify.dev/docs/latest/Reference/Errors/) —— 前者核实 `bodyLimit: 1048576`、`pluginTimeout: 10000`、`exposeHeadRoutes: true`、`caseSensitive: true`、`ignoreTrailingSlash: false`、`disableRequestLogging: false`、`return503OnClosing: true`、`requestIdLogLabel: 'reqId'`；后者查具体错误码。与服务端主动断长连接相关的选项默认值我没逐字核实，动手前对着这一页确认，见[服务部署](/backend/docker-and-shutdown)。

## 下一章

这一章画清了三条线：**Schema 同时管进出两个方向**（`coerceTypes` 与 `removeAdditional` 会改你的 payload，`response` 会删你的字段）、**钩子只向子孙继承**（所以全局鉴权拦掉登录是必然结果）、**`register` 默认造新作用域**（`fastify-plugin` 是唯一的共享通道，也是连接池翻车的开关）。框架之外的事仍归 HTTP：状态码、`Allow`、204 不能有 body、`keepAliveTimeout` 与上游代理错配，这些都留在[HTTP 与 REST 原理](/backend/http-and-rest)里，而框架替你省下的那些代码全部来自[手写最小服务器](/backend/minimal-http-server)的实测。带着这些边界进[分层架构与请求处理链路](/backend/layered-architecture)：本章回答「一条路由怎么跑」，下一章回答「controller、service、repository 各自该拿到什么、`decorate` 出来的依赖注入到哪一层」——Fastify 的封装方向恰好就是分层能落地的机制。
