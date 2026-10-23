# 分层架构：让「换掉数据库」只改一个文件

产品说「把内存存储换成 PostgreSQL」。你打开项目，发现 `INSERT` 散在十一个路由处理函数里，其中四个直接写 JSON 文件，还有两个在路由里 `import` 了一个全局 `db` 单例。你算了算要动的文件，决定重写。

第二个故障更常见：接口 500，日志里只有一句 `TypeError: Cannot read properties of undefined (reading 'id')`，四十帧调用栈全挤在同一个函数名里——因为那个函数同时做了解析、鉴权、校验、业务判断、拼 SQL 和序列化，你分不清是入参不对、数据不对，还是逻辑不对。

第三个最贵：注册要写两张表，HTTP 入口开了事务；两个月后加的「后台批量导入」脚本直接调同一段逻辑，忘了外面还得包事务。两周后库里出现一批「有账号没资料」的孤儿行，没人发现。

分层的价值不是让目录好看，而是**控制三件事的归属**：改动的爆炸半径、错误信息的可读性、一致性的责任位置。本章结论都在本机 Node v25.4.0 跑过。前置是[Fastify 入门](/backend/fastify-basics)与[用 node:http 手写最小服务器](/backend/minimal-http-server)——本章定的是「请求进来之后代码该排成什么样」。

## 三层各自只允许知道这些

| 层 | 常见名字 | 允许知道 | 绝不允许知道 | 出错时做什么 |
| --- | --- | --- | --- | --- |
| 接口层 | controller、route、handler | HTTP 方法、URL 参数、请求头、请求体形状、状态码、DTO | 业务规则、SQL、表结构、哈希算法 | 拦非法输入；把业务错误映射成状态码；把程序错误交给统一出口 |
| 业务层 | service、use case | 业务规则、不变量、**事务边界**、跨仓储编排、领域错误 | `req`/`res`、状态码、JSON 字段名、日志框架、框架类型 | 抛带 `code` 的领域错误；保证要么全成要么全不做 |
| 数据访问层 | repository、dao、store | 表结构、SQL、分页、索引、事务原语 | 业务含义、HTTP、会话与口令 | 抛驱动层原始错误（由 service 翻译） |

**判据：把「HTTP」三个字删掉，这段代码还成立吗？** 成立就该在 service 或 repository；不成立（要读 `request.headers`、要设 `statusCode`）就留在接口层。反过来一句同样管用：**把「PostgreSQL」换成「Redis」还要改的那段代码，就不该出现在 service 里。** 写完一个 service 方法看它的 `import`：出现 `node:http`、`fastify`、`pg`、`prisma` 或参数里有 `req`/`res`，分层就漏了。

一条常见误判要提前挡掉：「`age` 必须是整数」是外部契约，交给入口的 JSON Schema；而「同一邮箱不能重复注册」「余额不足不能下单」必须进 service，因为换个入口（CLI、队列、定时任务）也一样要成立。

## 一条请求的真实走法：缩进深度就是调用深度

存成 `chain.mjs`，直接 `node chain.mjs`（顶层 `await` 需要 ESM，模块判定见[Node.js 运行时](/backend/node-runtime)）：

```js
import http from 'node:http';
class AppError extends Error {                       // 领域错误：三层共用一个形状
  constructor(code, message, httpStatus) { super(message); Object.assign(this, { code, httpStatus }); }
}
class Repo {                                         // 数据访问层：只回答「有没有这一行」
  #m = new Map([['1', { id: '1', name: '张三', ownerId: 'u_1' }]]);
  async findById(id) { console.log('      [repository] SELECT resources WHERE id =', id); return this.#m.get(id) ?? null; }
  async save(r) { console.log('      [repository] INSERT resources', r.id); this.#m.set(r.id, r); }
}
class Service {                                      // 业务层：不认识 req / res
  constructor(repo, idGen) { Object.assign(this, { repo, idGen }); }
  async get(id) {
    console.log('    [service] ResourceService.get(', id, ')');
    const row = await this.repo.findById(id);
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', '资源不存在', 404);
    return row;
  }
  async create(d) {
    console.log('    [service] ResourceService.create(', JSON.stringify(d), ')');
    if (!d.name) throw new AppError('VALIDATION_REQUIRED', 'name 不能为空', 400);
    const row = { id: this.idGen.next(), name: d.name, ownerId: d.ownerId };
    await this.repo.save(row); return row;
  }
}
const toDTO = (r) => ({ id: r.id, name: r.name });   // 出参不带 ownerId
let n = 0;
const svc = new Service(new Repo(), { next: () => 'r_' + ++n });

const server = http.createServer(async (req, res) => {        // 接口层
  console.log('  [controller] ' + req.method, req.url, '| 请求头 cookie =', req.headers.cookie ?? '(无)');
  try {
    let out;
    if (req.url === '/resources/1') out = toDTO(await svc.get('1'));
    else if (req.url === '/resources/none') out = toDTO(await svc.get('none'));
    else out = toDTO(await svc.create({ ownerId: 'u_1' }));
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: out }));
  } catch (e) {
    console.log('  [controller] 出口拦截 code =', e.code, '→ HTTP', e.httpStatus);
    res.statusCode = e.httpStatus ?? 500;
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: e.code, message: e.message }));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));   // 临时端口，避免撞车
const port = server.address().port;
for (const p of ['/resources/1', '/resources/none', '/resources/bad']) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { headers: { cookie: 'sid=abc123' } });
  console.log('  <== 响应', res.status, await res.text(), '\n');
}
server.close();                                              // 关掉后事件循环自然结束，不要用 process.exit
```

实跑输出（终端原文）：

```text
  [controller] GET /resources/1 | 请求头 cookie = sid=abc123
    [service] ResourceService.get( 1 )
      [repository] SELECT resources WHERE id = 1
  <== 响应 200 {"data":{"id":"1","name":"张三"}}

  [controller] GET /resources/none | 请求头 cookie = sid=abc123
    [service] ResourceService.get( none )
      [repository] SELECT resources WHERE id = none
  [controller] 出口拦截 code = RESOURCE_NOT_FOUND → HTTP 404
  <== 响应 404 {"code":"RESOURCE_NOT_FOUND","message":"资源不存在"}

  [controller] GET /resources/bad | 请求头 cookie = sid=abc123
    [service] ResourceService.create( {"ownerId":"u_1"} )
  [controller] 出口拦截 code = VALIDATION_REQUIRED → HTTP 400
  <== 响应 400 {"code":"VALIDATION_REQUIRED","message":"name 不能为空"}
```

读三条：

1. **缩进就是调用深度**，一眼看出没有反向调用（repository 没调 service、service 没读 `req`）。而且 **repository 一行都没提 404**——它只回答「有没有这行」；把「查不到」翻译成「资源不存在」是 service 的决定，再翻译成 HTTP 404 是接口层的决定。**三次翻译、三个位置**，所以报错时你能立刻定位哪一层失职。
2. **`create` 的入参里没有 `req`**，是个普通对象，所以定时任务、CLI、队列消费者能原样复用。
3. **`toDTO()` 在接口层。** `ownerId` 在数据里存在但不该出去；`res.end(row)` 直接发 ORM 实体，等于把表结构公开给客户端。

<Callout type="verified" title="五组实验都在本机跑过">

Windows 10 x64 + Node v25.4.0，2026-10-18，命令 `node layers.mjs` 与 `node chain.mjs`（临时脚本已删，正文代码自包含可复现）。脏数据行数、串号结果都是终端原文。**本机没装 fastify**，涉及它的写法单独标注。

</Callout>

## controller 不该直接开事务：两种结果的实测对照

用内存仓储模拟「第二张表写入时抛错」：

```js
class UserRepo {
  #committed = new Map(); #tx = null;
  async insert(row) {
    if (this.failOn?.(row)) throw new Error('duplicate key value violates unique constraint "profiles_user_id_key"');
    const src = this.#tx ?? this.#committed;
    src.set(row.id, structuredClone(row)); return row.id;
  }
  async transaction(fn) {                        // 事务原语由仓储提供
    if (this.#tx) return fn();                   // 嵌套事务复用外层，不重开
    this.#tx = new Map(this.#committed);
    try { const r = await fn(); this.#committed = this.#tx; this.#tx = null; return r; }
    catch (e) { this.#tx = null; throw e; }      // 回滚 = 丢弃副本
  }
  dump() { return [...this.#committed.values()].map((r) => r.id); }
}
const failProfile = (row) => row.table === 'profiles';
async function registerNoTx(repo, id) {          // 反例：两个写操作裸着发出去
  await repo.insert({ id, table: 'users' });
  await repo.insert({ id: id + ':profile', table: 'profiles' });   // 这里抛
}
async function register(repo, id) {              // 正例：事务边界属于这个业务操作
  await repo.transaction(() => registerNoTx(repo, id));
}
```

终端原文：

```text
=== 实验一：同一个业务，包不包事务，落库结果不同 ===
  registerNoTx 抛错: duplicate key value violates unique constraint "profiles_user_id_key"
  落库内容: ["u_1"] => 孤儿行数 1 （用户建了、资料没有）
  register 抛错: duplicate key value violates unique constraint "profiles_user_id_key"
  落库内容: [] => 孤儿行数 0
```

这还只是同一种入口。真正的杀伤在于**把事务交给调用方**，于是「入口记不记得包事务」变成了一致性的前提。入口 A 是 HTTP 路由（包了事务），入口 B 是后加的脚本（没包）：

```text
=== 实验二：事务写在路由层，第二个入口忘包 → 同一业务两种结果 ===
  入口 A 抛错: connection terminated unexpectedly (SQLSTATE 08006) | 事务后落库: [] 行数 0
  入口 B 抛错: connection terminated unexpectedly (SQLSTATE 08006) | 事务后落库: ["u_2"] 行数 1
```

**两次跑的是同一段业务代码、抛的是同一句驱动错误**，落库一个 0 行、一个 1 行脏数据。所以：**事务边界是业务操作的属性，不是入口的属性**，必须写在 service 方法体内。两条附带规则：

- **别把事务包在 HTTP 钩子里**（`preHandler` 开、`onResponse` 提交）。看着方便，实际让连接被一整个响应周期占住，客户端慢你就持锁等；异步任务和队列消费根本没有这些钩子，一致性又变成看运气。
- **service 不要自己写 `BEGIN`/`COMMIT`**，要调仓储暴露的 `transaction()`。「怎么开始、怎么回滚、连接怎么归还」是数据访问细节（换数据库写法就变了，PostgreSQL 还要管 `SAVEPOINT`）；service 只决定「这一串要不要同生同死」。语义见[事务与并发](/database/transactions)。

## 依赖注入的最小可行做法：一个构造函数就够

不需要容器、装饰器或 `reflect-metadata`。**DI 的全部机制就是「别人给我，而不是我自己去拿」。**

```js
// 正例：构造函数收依赖。clock 也要注入，否则「三天后过期」这类逻辑测不了；
// 反例是在构造函数里自己 new（PgRepo(process.env.DATABASE_URL)），那样单测必须起数据库。
class UserService {
  constructor({ repo, idGen, clock }) { Object.assign(this, { repo, idGen, clock }); }
  async register(email) { await this.repo.transaction(async () => { /* 业务规则 + 两张表 */ }); }
}
// composition root：全项目唯一一处「谁用哪个实现」
export function buildContainer(env) {
  const repo = env.NODE_ENV === 'test' ? new MemoryUserRepo() : new PgUserRepo(env.DATABASE_URL);
  return { userService: new UserService({ repo, idGen: new UuidIdGen(), clock: { now: () => Date.now() } }),
           close: () => repo.close?.() };
}
```

**装配只发生在启动时的一个文件里**；在路由文件顶层写 `new UserService(new PgRepo())` 等于把装配点散落各处，收益当场归零。用假仓储调 service，不 import `node:http`、不起服务器、不连数据库：

```text
=== 实验三：构造函数/工厂注入，service 不起服务器就能测 ===
  register 返回: test_1
  假仓储收到的调用序列: ["transaction:begin","insert:test_1","insert:test_1:profile","transaction:commit"]
  getByEmail(ghost) 抛: USER_NOT_FOUND 404 | 调用序列: ["findByEmail:ghost@x.com"]
```

**`transaction:begin → insert → insert → transaction:commit` 这条序列本身就是断言对象**——你可以直接测「第二张表失败时必须出现 `transaction:rollback`」，而不用真的让数据库失败。这是分层 + DI 唯一真正值钱的产出：能写出快而不假的测试（体系见[测试体系](/devops/testing)）。

第一版我把假仓储的 `transaction` 漏了，实跑抛 `TypeError: repo.transaction is not a function`，栈只有一帧，很好定位。但这条错的价值是它暴露了**一个隐式契约**：service 要求仓储提供事务原语。把它写进 `interface Repository`（见[对象类型与接口](/typescript/objects-and-interfaces)），漏实现就变成编译期错误而不是运行期。

### Fastify 侧怎么接

<Callout type="unverified" title="以下 Fastify 说法未在本机运行">

本机没装 fastify。机制我用 WebFetch 在 2026-10-18 核对了[插件与作用域](https://fastify.dev/docs/latest/Reference/Plugins/)：`register` 创建新的封装上下文，插件里 `decorate` 加的东西**不影响祖先、只对后代可见**，且 `await app.register(...)` 才保证依赖注册完成。形状是：根插件里 `fastify.decorate('services', buildContainer(process.env))`，`await fastify.register(routes)`，再 `addHook('onClose', () => c.close())` 归还资源；`decorateRequest` 挂每请求上下文，这正是反例一的正解位置。落地前请实测。

</Callout>

## 分层分错了会长成什么样：三个实测反例

**反例一：把本次请求的状态写进 service 实例字段 = 并发串号。**

```js
class BadService {
  currentUserId = null;                                      // 单例，所有请求共享
  async act(userId, delayMs) {
    this.currentUserId = userId;
    await new Promise((r) => setTimeout(r, delayMs));         // 一让出事件循环，别人就进来
    return { actedAs: this.currentUserId };                   // 读回来的可能不是自己的
  }
}
const bad = new BadService();
await Promise.all([bad.act('user_A', 30), bad.act('user_B', 5)]);
```

实跑：

```text
=== 实验四：把「本次请求的状态」写进 service 实例字段 = 串号 ===
  反例: 请求 A 结束于 {"actedAs":"user_B"} 请求 B 结束于 {"actedAs":"user_B"}
  请求 A 本该以 user_A 操作，实际是 user_B (串号)
  正例: {"actedAs":"user_A"} {"actedAs":"user_B"}
```

这是[Node.js 运行时](/backend/node-runtime)那张对照表最后一行的后果：**同一进程内所有请求共享模块级与实例级可变状态**。service 做成单例是对的（它应该是无状态函数集），但「无状态」必须真的无状态——请求上下文靠参数或 `request` 对象传。这条也是越权漏洞的常见成因：字段被别的请求改掉后，A 就操作了 B 的数据。

**反例二：per-request 的连接放实例字段 = 事务落到错误的连接。** 同一段逻辑，唯一差别是连接靠参数传还是靠字段挂：

```text
=== 实验五：repository 需要 per-request 连接时，用参数传，不要塞实例字段 ===
  参数传递:  conn#1 = [A1,A2] | conn#2 = [B1]
  字段传递: conn#3 = [] | conn#4 = [B1,A1,A2]
```

后者里 `conn#3` 是空的、`conn#4` 混了三条，意味着**「提交 A 的事务时其实提交的是 B 的连接」**。这种 bug 单请求测试永远发现不了。规则：**每次调用需要独立资源（连接、事务、游标、AbortController），资源就是参数。**

**反例三：胖 controller**，症状可以直接量出来：一个 handler 超过 80 行（`wc -l routes/*.ts`）必然混着业务规则；handler 里搜到 `SELECT`/`UPDATE` 说明数据访问漏到接口层，换库要改所有路由；service 里搜到 `statusCode`/`reply.code(` 说明 HTTP 渗进业务层，队列与定时任务没法复用；报错栈只有 3 帧且同一文件名，说明分层没起作用。

## 目录结构：一个能长大的最小骨架

```text
src/
  index.ts          # 三件事：读配置、装配容器、起服务器
  config.ts         # 启动期 schema 校验（见 node-runtime 章）
  container.ts      # composition root：唯一一处装配
  http/             # server.ts  routes/*.ts  dto.ts  errors.ts
  domain/           # errors.ts  types.ts
  services/         # user-service.ts  auth-service.ts
  repositories/     # user-repository.ts（接口）+ .pg.ts + .memory.ts
tests/              # unit/（只 import service，注入假仓储）  integration/（真服务器 + 真库）
```

**「换数据库」在这个结构里的成本**：改 `container.ts` 一行 + 新增一个 `user-repository.pg.ts`，路由、服务、测试都不动——这就是开头那个「要改十一个文件」的反面。阶段项目要求前期用内存数据但必须走 repository 层，就是在为这次替换留边界（[多用户资源管理 API](/backend/project)）。`domain/` 的另一个作用是打断 service 之间的循环依赖。

## 常见错误与排查

**1. 一个 handler 从解析请求一路写到拼 SQL。** 现象：加个批量导入要复制整段逻辑；改字段名要动七个文件。确认：在 handler 里搜 `INSERT`/`SELECT`，命中即确诊。修：从最容易的一条切入，把那个「看起来是业务规则」的 `if` 搬进 service，让 handler 只剩「解析 → 调 service → 返回 DTO」；按接口逐个搬，别一次性重构。

**2. 事务开在路由里，异步任务跑出的数据和 HTTP 跑出的不一样。** 现象：批量导入后有孤儿行；两个入口抛同一句驱动错误却结果不同。确认：分别用 HTTP 与 `node -e` 脚本调同一个 service 方法，比对落库（实验二就是这么复现的）。修：`repo.transaction()` 写进 service 方法体，并把 `transaction` 加进仓储接口，让漏它的实现编译不过。

**3. repository 返回数据库行，接口层原样 `send` 出去。** 现象：响应里出现 `tenant_key`、`internal_notes`、`deleted_at`。确认：抓一份真实响应，字段名和表结构对一遍。修：出参统一过一层 `toXxxDTO()`；再给响应加 JSON Schema 序列化，让字段白名单变成显式契约（见[Fastify 入门](/backend/fastify-basics)）。

**4. `TypeError: repo.transaction is not a function`。** 现象：假仓储跑 service 就炸，真仓储正常。原因：契约散落在实现里、没写进接口。修：定义 `interface Repository` 覆盖 service 用到的全部方法；并让 service **总是**走 `transaction()`，这样任何路径上缺事务原语都会立刻暴露，而不是只在多写的路径上暴露。

**5. service 单例在 `this` 上挂请求状态，偶发跨用户串数据。** 现象：只有并发才错、压测才复现。确认：并发数打到 2、给不同 userId，看返回的身份字段（实验四）；或在字段写入处打时间戳看交错。修：状态用参数传，或挂到每请求唯一的 `request` 上。判据背下来：**一个字段如果会被两个并发请求写成不同值，它就不能是实例字段。**

## 练习

<Exercise title="练习 1 · 给这段代码分层" difficulty="基础">

拆成三层，写出每层签名，并指出哪两件事必须留在接口层、哪一行必须搬进 service。

```js
app.post('/users', async (req, reply) => {
  const { email, password } = req.body;
  if (users.some(u => u.email === email)) return reply.code(409).send({ error: '邮箱已被注册' });
  const hash = await scrypt(password);
  const user = { id: crypto.randomUUID(), email, hash, createdAt: Date.now() };
  users.push(user);
  reply.code(201).send({ id: user.id });
});
```

<template #answer>

`UserService.register({ email, password })` 依次做：`repo.findByEmail` 查重 → 抛 `AppError('EMAIL_ALREADY_REGISTERED', '邮箱已被注册', 409)` → `passwordHasher.hash(password)` → 用注入的 `idGen`/`clock` 组装 user → `repo.insert(user)`。路由只剩两行：`const u = await services.userService.register(req.body)`，再 `return reply.code(201).send({ id: u.id })`（入参交给 JSON Schema）。

必须留在接口层的两件事：**状态码映射**（`201`/`409`）和**出参形状** `{ id: user.id }`——`hash` 绝不能出现在响应里。必须搬进 service 的是 `users.some(...)`：「同一邮箱不能重复注册」是业务规则，从 CLI 注册也一样要成立。另外三处要改：`crypto.randomUUID()` 与 `Date.now()` 变成注入的 `idGen`/`clock`、模块级数组 `users` 变成 repository、那句不带盐也不走恒定时间比较的 `scrypt(password)` 在[认证：Session、Cookie 与密码哈希](/backend/auth-session)里处理。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造错误：让事务边界漏到入口" difficulty="进阶">

照本章写法实现一个只提供 `insert`、`findByEmail` 的内存假仓储（**不提供 `transaction`**），调用一个内部使用 `repo.transaction()` 的 `register()`。① 写出真实报错形态；② 说明为什么「缺方法」比「缺事务」安全得多；③ 给出让缺事务也立刻暴露的两层修复。

<template #answer>

① 实测原文：`TypeError: repo.transaction is not a function`，栈只有一帧（`at Object.register ... :87:12`），抛点就在缺方法那一行。

② 这是本题真正要理解的对比：缺方法 → 当场 `TypeError` → 第一次跑测试就发现，**fail fast 是好事**；而把事务写成「路由里包一层」的可选做法（实验二），代码**根本不会抛错**——它静默写出孤儿行，几周后才在数据报表里看见。一种坏法响亮、一种坏法无声，无声的才是生产事故的形态。

③ 修复两层：**(a)** 定义 `interface Repository { insert(); findByEmail(); transaction(fn); }`，假仓储少实现直接编译失败；**(b)** 让 service **总是**走 `repo.transaction(async () => { ... })`，哪怕只写一行，这样「没有事务原语」在任何路径上都立刻抛错。配套断言：注册失败后用 `dump()` 检查行数必须为 0（实验一那条 `[] => 孤儿行数 0` 就是这么测出来的）。

</template>

</Exercise>

<Exercise title="练习 3 · 用并发稳定复现串号" difficulty="挑战">

写一段最小脚本证明「在实例字段上暂存 userId」的 service 会串号，并且**每次跑都稳定复现**（不是偶尔）。再说明为什么单请求测试永远测不到它。

<template #answer>

实验四就是这段（反例一的代码可直接抄），关键是**把两次调用的 `await` 时长错开**，让短的先返回并覆盖字段：`Promise.all([bad.act('user_A', 30), bad.act('user_B', 5)])` 实测两个都返回 `{"actedAs":"user_B"}`。

**为什么稳定**：`Promise.all` 同步启动 A（写 `user_A`、注册 30ms 定时器）再启动 B（写 `user_B`、注册 5ms 定时器）。5ms 先到期，B 读到 `user_B` 返回；30ms 时 A 恢复，字段仍是 `user_B`。整条时序由定时器时长唯一确定，没有竞态的不确定性，所以每次都同一结果。也正因如此，**单请求测试永远测不到它**——一次只有一个调用时字段不会被别人改。

正解是让状态跟着调用栈走（`const ctx = { userId }`）、改成显式参数 `act({ actorId })`，或由框架挂在每请求唯一的 `request` 上。**要共享的东西（连接池、缓存、配置）才放实例字段；会被并发写出不同值的一律不能。** 养成习惯：每个 service 补一个「并发两个不同 actor」的用例。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Fastify 插件与作用域](https://fastify.dev/docs/latest/Reference/Plugins/) 与 [Fastify 服务端 API](https://fastify.dev/docs/latest/Reference/Server/) —— 前者核实 `register` 创建封装上下文、`decorate` 只对后代可见、`await app.register()` 才保证依赖注册完成；后者核实 `decorate`（应用级共享，放 service）与 `decorateRequest`（每请求一份，放请求上下文）的适用面。2026-10-18 读取。
- [Node.js 运行时](/backend/node-runtime) —— 同一进程内所有请求共享模块级与实例级可变状态的实测机制，本章反例一、反例二的成因就在这一条。
- [事务与并发](/database/transactions)与[数据访问设计：ORM、N+1 与分页](/database/data-access-design) —— 前者展开隔离级别与并发问题（本章只管「边界写在哪一行」），后者给出分页游标与 N+1 的实测方法。

## 下一章

骨架定了：三层各自知道什么、事务边界为什么必须在 service 方法体内（实测入口漏包留 1 行孤儿数据、包了是 0 行）、DI 在 Node 里就是一个构造函数、以及三种坏分层的实测后果。

接下来处理它跑起来一定会遇到的东西——异常。service 抛带 `code` 和 `httpStatus` 的领域错误，repository 抛驱动错误，而 handler 里那句 `res.statusCode = e.httpStatus ?? 500` 只是临时写法。[统一错误处理](/backend/error-handling) 把这三层收进同一个出口：错误怎么分类、错误码契约怎么定、为什么堆栈绝不能回给客户端（那一章实测了一段 413 字符、带内网 IP 与绝对路径的泄露响应体），以及未捕获异常打进正在处理的请求时客户端到底收到什么。
