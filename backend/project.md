# 阶段项目：多用户资源管理 API——把前 14 章的约定收成一台能测、能拒、能优雅关掉的服务器

后端项目的交付状态通常是「接口都能返回 200」。这句话没有信息量：一个完全没有授权的后端，在所有合法请求上也返回 200。决定它能不能上线的是另外几个问题——把 URL 里的 id 改成别人的记录，它返回什么？密码库被脱走，攻击者多久能还原明文？`kill` 下去，那条正在写数据库的请求是跑完了还是被拦腰截断？错误响应里有没有把 `at /app/src/repo/user.ts:41` 一并送给客户端？

前 14 章各自答了一遍，但**分章验证的代价是每章只测自己那一格**：`auth-session.md` 测了 Cookie 属性，`authorization.md` 测了 403，`docker-and-shutdown.md` 测了排空时序，没有任何一章保证它们拼在同一个进程里还能同时成立。而拼装时最先坏掉的恰恰是接缝：CSRF 守卫读到了还没挂上的 `req.auth`，于是所有写操作都 403；`preHandler` 里抛出的校验错误被全局错误处理器改写成 500，前端拿不到字段名；优雅关闭先 `close()` 了监听再排空作业，那条 600 毫秒的任务被进程退出吃掉。

这一章就是把接缝焊死。交付物是一个**多用户书签管理 API**：注册登录、会话、角色、资源归属、校验、限流、幂等、结构化日志、健康检查、优雅关闭，一台进程、一条命令起、一条命令测。我把它拆成六个阶段，每个阶段配一个能判真假的检查动作——**不通过就停在原地修，不许带问题进下一阶段**。

<Callout type="verified" title="本机跑到了 41 项全绿，但只支持它真正覆盖的那些结论">

运行环境：Windows 10 x64 + **Node v25.4.0**，日期 2026-10-18。实现形态是**零依赖**的 `node:http` + `node:sqlite` + `node:crypto`，不装框架、不装数据库服务、不起 Docker。

`backend/.scratch/proj-check.mjs` 用 `spawn` 带 `ipc` 拉起 `backend/.scratch/proj-srv.mjs`（测试端口 3310，`DB_PATH=':memory:'`），跑完 41 条断言，打印结果原文落在 `backend/.scratch/proj.out`，最后一行是：**合计：41 通过 / 0 不符合预期**。

这 41 条能支持的，只有它逐条写下的那些判据（下一节给出清单与原文）。它**不能**支持的：Fastify 与 `@fastify/swagger` 的任何行为、Pino 的输出格式、Docker 构建与容器内信号传递、Nginx 配置、Linux 下的 `SIGTERM`。本机 `node_modules` 里没有这些包（`ls node_modules | grep -iE '^fastify|^pino'` 为空），本批也不安装依赖，因此凡涉及它们的段落一律写成「预期结果」并标 `unverified`——这与[第 4 章 Fastify 入门](/backend/fastify-basics)的环境声明是同一口径。

</Callout>

## 目标与范围：首页那七条验收标准，逐条落到阶段

[领域首页](/backend/)「阶段项目」一节给了七条验收标准。它们不能只写在首页上，得有一条命令能判真假。下表是本章的落实位置，「本机状态」列只说真话：

| # | 首页条款 | 交付阶段 | 判定动作 | 本机状态 |
| --- | --- | --- | --- | --- |
| A1 | 密码以哈希形式存储，登录态 httpOnly Cookie，能防 CSRF | ③ | 断言 `Set-Cookie` 含 `HttpOnly` 与 `SameSite=Strict`；带 Cookie 不带 CSRF 头的写操作必须 403 | 实测通过 |
| A2 | 未登录 401；登录后访问不属于自己的资源 403 | ④ | bob 读 / 改 / 删 alice 的资源，三条各判一次 | 实测通过 |
| A3 | 非法输入在入口被拦，返回 400 并给出可读错误 | ⑤ | 非法邮箱、弱密码、未知字段三类各一次，检查 `details[].field` | 实测通过 |
| A4 | 统一错误结构，未捕获异常不外泄堆栈 | ② | 断言错误体含 `requestId` 且与响应头一致、不含堆栈与文件路径 | 实测通过 |
| A5 | `@fastify/swagger` 可交互文档 | Fastify 变体 | 浏览器打开 `/docs` | **本机未装依赖，未验证** |
| A6 | 带 request id 的结构化日志 + 健康检查端点 | ①② | 抓 `warn` 级日志逐条含 `id`；`GET /health` 返回 200，就绪降级后返回 503 | 实测通过 |
| A7 | 多阶段 Dockerfile + SIGTERM 优雅关闭不丢请求 | ⑥（宿主进程部分） | 预排空期 `/api` 得 503、在途请求得 200、关监听后连接被拒、退出码 0 | 排空时序实测通过；**镜像构建未验证** |

A5 和 A7 的后半段是本章唯一两处「首页承诺了但我没在本机跑到」的地方，我不把它们写进 `verified`。要收口它们：A5 需要先允许自己在项目外建一个临时目录 `npm install fastify`，再照「Fastify 形态」一节改；A7 的后半段需要容器运行时，照[第 14 章](/backend/docker-and-shutdown)的验收清单自己跑。

## 不做什么（以及一处必须说清的口径差异）

- **不写前端。** 没有页面、没有 fetch 封装，全部用测试脚本与 `curl` 驱动。
- **不引入 ORM。** 直接 `node:sqlite` 的手写语句，才看得见执行计划与条数；ORM 对照在[数据库领域](/database/)展开。
- **不把内存数组当最终形态。** 仓储层只出行形状、不出实体，边界留给数据库阶段替换。
- **不做分布式。** 会话、限流桶、幂等表都在单进程内存或单文件库里；多实例下的问题属于[数据存储进阶](/data-storage/)，本章只在 `sessions` 表上留了能外移的余地。
- **不做 CI/CD、不做部署编排。** 那是[工程工具与部署](/devops/)三个已完成章节往后要走的事。
- **不重设计权限模型。** 角色只有 `user` / `admin` 两级，判定逻辑沿用[授权与权限](/backend/authorization)。

**必须说清的口径差异**：[数据库领域阶段项目](/database/project)第 5 行写着「本章把后端领域阶段项目那个多用户资源管理 API 从内存数组换成真实数据层」，第 7 行接着说「模型延续后端项目：`tenant / usr / resource / tag / resource_tag`」。本章实际交付的是 **`users / sessions / bookmarks` 三张表、以 `user_id` 表达归属**，没有租户、没有标签多对多、没有软删除——那句「模型延续」对不上本章，差异是我这一章造成的，不是它的。衔接办法：把数据库阶段的第一阶段改成「先做模型扩展」（`bookmarks` → `resource`，新增 `tenant`、`tag`、`resource_tag` 与软删除列），后续阶段照它原文走；它那句「后端项目的路由与校验规则保持原样」在本章是成立的，路由表与校验规则不用动。

## 目录结构与文件规划

41 项全绿那份骨架是**两个文件**，不是九个模块。这是有意的：先把机制测对，再拆结构，否则拆出来的是猜想的形状。

```text
backend-project/
├─ srv.mjs              # 阶段 ①–⑤：一台进程的全部（我那份 24 KB，单文件）
├─ check.mjs            # 断言脚本：spawn srv + fetch + 逐条判真假
└─ README.md            # 你怎么起、怎么测、哪些没测

拆成分层结构后的目标形态（阶段 ⑥ 交付，与第 5 章对齐）：
src/
├─ config.ts            # 全部 env 读取集中在这一个文件
├─ http/
│  ├─ server.ts         # 监听、keepAlive/requestTimeout、开始与停止
│  ├─ router.ts         # 方法 + 路径匹配、404 / 405 判定
│  └─ handler.ts        # 单次请求的九步链路（见下面那张表）
├─ auth/
│  ├─ password.ts       # scrypt 哈希与比对
│  ├─ session.ts        # 会话签发、校验、过期与删除
│  └─ guards.ts         # requireAuth / requireCsrf / requireRole
├─ validation/
│  ├─ register.ts       # 白名单字段 + 规则，返回 DTO
│  └─ bookmark.ts       # 全量与 partial 两种模式
├─ repo/
│  ├─ db.ts             # 连接、DDL、事务工具
│  └─ bookmark.ts       # 只出行形状，绝不出 HTTP 状态码
├─ service/             # 业务规则；抛 ApiError，不碰 req / res
├─ errors/ApiError.ts   # 状态码 + 稳定错误码 + details + requestId
├─ jobs/queue.ts        # 后台作业入队与排空
└─ logger.ts            # 结构化日志（level / msg / fields）
```

**为什么阶段 ①–⑤ 允许单文件**：此时唯一的风险是「机制错」，拆文件会让每条断言失败都要跨三个文件追。阶段 ⑥ 必须拆，因为那时要测的东西变成「换掉 repo 不影响 service」——不拆开就证明不了边界存在。完整论证在[分层架构与请求处理链路](/backend/layered-architecture)，本章只做落地检查。

## 数据层：三张表、两条索引，幂等交给数据库约束

阶段 ② 建表。注意 `PRAGMA foreign_keys = ON` 在 SQLite 里**默认是关的**，不写这一句，外键就是个装饰。

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  url             TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  idempotency_key TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_idem   ON bookmarks(user_id, idempotency_key);
CREATE INDEX         IF NOT EXISTS ix_bm_user ON bookmarks(user_id, created_at DESC);
```

三个决定值得单独说：

**幂等不是应用层的 if。** `ux_idem` 是 `(user_id, idempotency_key)` 的唯一索引，SQLite 保证「同一用户 + 同一 key 只可能有一行」。应用层先查后插的写法在并发下会漏，因为「查」和「插」之间有窗口。阶段 ⑤ 的实测正是靠这个约束兜住的：同一 `Idempotency-Key` 连发两次，得到 `same-id + replayed`，而 alice 的列表长度是 **2**（不是 3）。注意 `idempotency_key` 允许 NULL，SQLite 的唯一索引不约束 NULL 之间的关系，所以不带 key 的正常重复标题不会被误伤。

**归属查询必须有 `(user_id, created_at DESC)`。** 列表接口的形状永远是「取某个人的、按时间倒序、一页」。少了这条索引，`WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?` 会扫全表再排序。索引的原理与执行计划读法在[索引与执行计划](/database/indexes)，本章只负责让它存在。

**`ON DELETE CASCADE` 是有边界的方便。** 删用户会连带删掉他的会话与书签。在这个项目里可以（没有审计要求），但它是**语义决定而不是技术决定**，写进注释；一旦业务要求「注销后数据保留 90 天」，级删就成了 bug。

所有 SQL 收在一个 `stmt` 准备语句表和一层薄薄的 `repo` 上，`service` 与 `handler` 一律不出现 SQL 字符串——这是[第 5 章](/backend/layered-architecture)那条边界的机器可检查版本：在整个 `src/` 里搜 `SELECT`，命中只允许出现在 `repo/`。

## 需求清单：14 条，每条一个判定动作

「要安全」「要健壮」不是需求。下面每一条都能被脚本或一条命令判真假，右列就是我那份 `check.mjs` 里的实际断言名。

| # | 需求 | 判定动作（实测用例名） | 阶段 |
| --- | --- | --- | --- |
| R1 | 进程能用一条命令起来并报告自己的运行参数 | `GET /health` + 启动日志行 | ① |
| R2 | 注册返回 201 且响应体不含密码与哈希 | `POST /api/users 注册 alice` | ③ |
| R3 | 邮箱重复注册被拒 | `重复邮箱注册` → `409 E_CONFLICT` | ③ |
| R4 | 非法输入在进入业务逻辑前返回 400 且带字段名 | `非法邮箱 400 + details`、`弱密码 400 + details` | ⑤ |
| R5 | 客户端无法通过注册体注入 `id` 之类字段 | `注册塞 role/id（质量赋值）` → `details` 含 `field=id` | ⑤ |
| R6 | 登录失败一律同一句话，不泄露邮箱是否存在 | `密码错误` 与 `不存在邮箱同样 401` | ③ |
| R7 | 会话 Cookie 是 httpOnly + SameSite=Strict，CSRF Cookie 可读 | 三条 Cookie 属性断言 | ③ |
| R8 | 有会话但缺 CSRF 头的写操作被拒 | `有 Cookie 无 CSRF 头的写操作` → `403 E_CSRF` | ④ |
| R9 | 水平越权在三种方法上都被拒 | `bob 读 / 改 / 删 alice 资源` → `403 E_FORBIDDEN` | ④ |
| R10 | 列表接口不泄露他人数据 | `bob 列表看不到 alice 数据` → 命中数 `0` | ④ |
| R11 | 垂直越权被拒，且角色来自服务端会话而非请求 | `垂直越权：普通用户访问管理端` → `403 需要 admin 角色` | ④ |
| R12 | 同键重发不重复创建 | `同一 Idempotency-Key 两次只建一条` → `same-id + replayed` | ⑤ |
| R13 | 未知路径 404、已知路径换方法 405、超大体 413、坏 JSON 400、刷登录 429 | 五条边界断言 | ⑤ |
| R14 | 关闭时不丢在途请求，且退出码为 0 | 四条排空断言 + `优雅退出码 0` | ⑥ |

## 一次请求的九步链路

阶段 ① 定骨架时先把这条链路写死，后面每一章的能力都挂在固定的第几步上。这是本章最重要的一张表——**出了怪 bug，九成是某一步被插错了位置**。

| 步 | 动作 | 失败时的错误码 | 为什么在这个位置 |
| --- | --- | --- | --- |
| 1 | 生成或沿用 `x-request-id`，写回响应头，`inflight++` | — | 后面所有日志与错误体都要引用它，必须在最早处 |
| 2 | 判阶段：`phase !== 'running'` 且路径以 `/api/` 开头 → 503 | `E_SERVER_DRAINING` | 摘流要在解析请求体之前，否则关闭期还在读上传 |
| 3 | `OPTIONS` 预检直接 204 返回 | — | 预检不带 Cookie，绝不能进入鉴权分支 |
| 4 | 按「方法 + 路径正则」匹配路由；未命中 404，路径命中而方法不命中 405 | `E_NOT_FOUND` / `E_METHOD_NOT_ALLOWED` | 405 与 404 的区分要靠「有没有别的方法能命中同一路径」 |
| 5 | 从 Cookie 解析 `sid`，查会话、判过期、载用户 → `ctx.auth` | 无（未登录是 `null`，不报错） | 认证与授权分开：读操作可以只判归属，公开接口不能要求登录 |
| 6 | 非 GET 才读请求体，边读边计体积；超限拒绝；JSON 解析失败即 400 | `E_PAYLOAD_TOO_LARGE` / `E_VALIDATION` | 体积上限必须在 `JSON.parse` 之前生效，否则一条 50 MB 的 body 先把内存吃掉 |
| 7 | 校验并收窄成 DTO；写操作在此前要求 CSRF 头；角色检查在此 | `E_VALIDATION` / `E_CSRF` / `E_FORBIDDEN` | 校验属于入口，不属于业务；越权判断要拿到已收窄的归属条件 |
| 8 | 调 service → repo → 返回行形状，序列化 JSON | — | 只有这一步允许碰业务规则和数据 |
| 9 | `catch`：`ApiError` 原样出、其他一律 500 `E_INTERNAL`，出统一错误体；`finally` 里 `inflight--` | `E_INTERNAL` | 兜底必须包住全部前八步，`inflight--` 必须在 `finally`，否则关闭永远等不完 |

两处实测细节直接来自这张表：

**413 只拒绝、不 destroy。** 我最初在超限时写了 `req.destroy()`，客户端拿到的是连接中断而不是 413 响应体——destroy 把正在写响应的 socket 一起拆了。改成 `reject(ERR.tooLarge(...))` + `req.pause()`，让第 9 步把 413 正常写出去。实测用例 `超大请求体（上限 4096）` 得到 `413 E_PAYLOAD_TOO_LARGE`。

**405 与 404 的区分要靠路径再匹配一次。** `routes.some(r => r.p.test(path))`——路径能被别的方法命中才报 405。实测两条：`未知路径` → `404 E_NOT_FOUND`，`方法不允许` → `405 E_METHOD_NOT_ALLOWED`。

## 阶段 ① 骨架：配置、请求 ID、超时三件套

**做什么**：建一个能监听、能报健康、能打印自己参数的小进程。全部配置只从一个对象读，任何地方不许再出现 `process.env`。

```js
const env = process.env
const CFG = {
  PORT: Number(env.PORT || 3300),
  HOST: env.HOST || '127.0.0.1',
  GRACE_MS: Number(env.GRACE_MS || 5000),
  PRE_DRAIN_MS: Number(env.PRE_DRAIN_MS || 0),
  DB_PATH: env.DB_PATH || ':memory:',
  MAX_BODY_BYTES: Number(env.MAX_BODY_BYTES || 64 * 1024),
  RATE_WINDOW_MS: Number(env.RATE_WINDOW_MS || 60_000),
  RATE_MAX: Number(env.RATE_MAX || 5),
  SCRYPT: { N: 16384, r: 8, p: 1 },
  SESSION_TTL_MS: Number(env.SESSION_TTL_MS || 7 * 24 * 3600_000),
}
```

`Number()` 包一层不是形式主义：`env` 永远是字符串，`'0' || 3300` 会得到 `'0'` 而不是 0，`PRE_DRAIN_MS=0` 这类合法取值会被默认值吃掉（详见「常见翻车点 4」）。

超时三件套必须都设，缺一个就是半个 DoS 面：

```js
server.keepAliveTimeout = Number(env.KEEPALIVE_MS || 5000)
server.headersTimeout = server.keepAliveTimeout + 5000
server.requestTimeout = Number(env.REQUEST_TIMEOUT_MS || 30_000)
```

`headersTimeout` 必须**大于** `keepAliveTimeout`，否则服务端会先掐掉自己正在等待的空闲连接，客户端看到一个没有任何日志的 `ECONNRESET`。这三行与它们的关系见[最小 HTTP 服务器](/backend/minimal-http-server)与[第 14 章](/backend/docker-and-shutdown)。

启动日志把参数全部打出来，是为了让你远程也能确认「环境变量到底进来了没有」——这一行是我那次实测的第一条输出，原文：

```text
{"ts":"2026-10-18T03:30:56.730Z","level":"info","msg":"server.listen","port":3310,"pid":34416,"platform":"win32","node":"25.4.0","graceMs":5000,"maxBody":4096,"mode":"node:http + node:sqlite（阶段项目第 1 阶段形态）"}
```

`maxBody` 是 4096 而不是 65536，正是测试脚本通过 env 覆盖的结果；如果这条日志打印出 65536，说明你的 `env` 没传进子进程。**阶段产出**：`GET /health` 返回 200，响应里带 `phase` 与 `uptimeMs`；`node srv.mjs` 起得来，`Ctrl+C` 杀得掉。

## 阶段 ② 仓储层与错误模型：把 SQL 关在一个文件里

**做什么**：建表 + 准备语句 + `repo`；同时定义唯一的错误类型。错误模型必须在这个阶段出现，因为后面每个阶段都要往里加异常，晚了就得回头改所有 `throw`。

```js
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const ERR = {
  validation: (msg = '请求体校验失败', details) => new ApiError(400, 'E_VALIDATION', msg, details),
  unauth: (msg = '未登录或会话已失效') => new ApiError(401, 'E_UNAUTHENTICATED', msg),
  forbidden: (msg = '没有权限访问该资源') => new ApiError(403, 'E_FORBIDDEN', msg),
  csrf: () => new ApiError(403, 'E_CSRF', '缺少或错误的 x-csrf-token'),
  notFound: (msg = '资源不存在') => new ApiError(404, 'E_NOT_FOUND', msg),
  conflict: (msg = '资源冲突') => new ApiError(409, 'E_CONFLICT', msg),
  tooLarge: (msg = '请求体超过上限') => new ApiError(413, 'E_PAYLOAD_TOO_LARGE', msg),
  tooMany: (msg = '登录尝试过于频繁') => new ApiError(429, 'E_RATE_LIMITED', msg),
  internal: (msg = '服务器内部错误') => new ApiError(500, 'E_INTERNAL', msg),
  draining: () => new ApiError(503, 'E_SERVER_DRAINING', '服务器正在关闭，不接收新请求'),
}
```

`repo` 只出行形状；`service` 决定给客户端看什么；只有 `handler` 知道 `res`。三层各自的错误码：`repo` 抛原生驱动错误，`service` 只抛 `ApiError`，`handler` 把非 `ApiError` 统一降级为 500。这条纪律是「不外泄堆栈」的真正保障，而不是靠某个正则去洗错误信息。

出口只有一个，长这样（`payload` 的构造在链路第 9 步）：

```json
{
  "error": {
    "code": "E_VALIDATION",
    "message": "注册字段校验失败",
    "details": [{ "field": "email", "rule": "必须是合法邮箱且不超过 254 字符" }],
    "requestId": "513af403"
  }
}
```

四个约定：**稳定错误码**（`code`）给程序看，人类可读 `message` 给人看，`details` 可选且只在 400 出现，`requestId` 恒定存在并与响应头 `x-request-id` 一致。前端可以按 `code` 分支，你改文案不会破坏它。非 `ApiError` 的异常对外只写「服务器内部错误」，堆栈只进日志：实测 `错误体带 requestId 且与响应头一致` 与 `错误体不含堆栈/文件路径` 两条断言均为 `true`，`proj.out` 的 warn 段打印了 6 条 `request.rejected`，字段固定是 `id / method / path / status / code`。

**阶段产出**：一次非法注册返回上面那个结构；`grep -c "SELECT" src/` 只命中 `repo/`。

## 阶段 ③ 认证：scrypt 哈希、httpOnly Cookie、防枚举

**做什么**：注册、登录、登出三件事，以及一条容易被略过的要求——**登录失败不能告诉客户端「这个邮箱存在」**。

```js
function hashPassword(plain) {
  const salt = randomBytes(16)
  const { N, r, p } = CFG.SCRYPT
  const hash = scryptSync(plain, salt, 32, { N, r, p })
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

function verifyPassword(plain, stored) {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, N, r, p, saltB64, hashB64] = parts
  const salt = Buffer.from(saltB64, 'base64')
  const expect = Buffer.from(hashB64, 'base64')
  let actual
  try {
    actual = scryptSync(plain, salt, expect.length, { N: Number(N), r: Number(r), p: Number(p) })
  } catch {
    return false
  }
  return actual.length === expect.length && timingSafeEqual(actual, expect)
}
```

三个点都带着理由。**参数写进存储串**（`scrypt$N$r$p$salt$hash`）：将来上调参数时老用户的哈希仍然能验，迁移是渐进的；把参数硬编码在代码里，改一次参数就等于清空所有密码。**比对用 `timingSafeEqual`**：普通 `===` 在第一个不同字节就返回，理论上可用响应时间差逐字节猜哈希。**先判长度再比对**：`timingSafeEqual` 在两边长度不等时会抛异常，不先判长度就是个 500。

参数 `N=16384, r=8, p=1` 是本机为了测试脚本跑得快而取的强度，**别原样搬进生产**。当前推荐值请以 OWASP 的密码存储速查表为准（[Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)），它会随算力更新。

防枚举那一步值得单独看，因为它同时对付两种侧信道：

```js
const user = repo.findUserByEmail(email)
// 用户不存在也要跑一次哈希，避免用响应时间枚举账号
const ok = user
  ? verifyPassword(password, user.password_hash)
  : verifyPassword(password, hashPassword('decoy-password'))
if (!user || !ok) throw ERR.unauth('邮箱或密码错误')
```

不存在的邮箱也执行一次 scrypt，两种情况的时间形状就一致了；错误信息两种情况共用一句「邮箱或密码错误」。实测两条断言：`密码错误` → `401 E_UNAUTHENTICATED`，`不存在邮箱同样 401` → `401 E_UNAUTHENTICATED msg=邮箱或密码错误`。这是**同一条信息字符串**，不是两个长得像的信息。

会话签发与 Cookie：

```js
const session = {
  token: randomBytes(32).toString('base64url'),
  userId: user.id,
  csrf: randomBytes(24).toString('base64url'),
  createdAt: now(),
  expiresAt: now() + CFG.SESSION_TTL_MS,
}
ctx.resHeaders['set-cookie'] = [
  `sid=${res.session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(CFG.SESSION_TTL_MS / 1000)}`,
  `csrf=${res.session.csrf}; SameSite=Strict; Path=/; Max-Age=${Math.floor(CFG.SESSION_TTL_MS / 1000)}`,
]
```

`sid` 必须是 `HttpOnly`（脚本读不到，XSS 就拿不走），`csrf` 必须**不是** `HttpOnly`（前端脚本要读它并塞进请求头）。这不是矛盾，是双提交 Cookie 的定义：攻击者的页面能自动带上 Cookie，但读不到 Cookie 内容，也就伪造不出那个请求头。实测三条：`sid Cookie 带 HttpOnly` → `true`，`sid Cookie SameSite=Strict` → `true`，`csrf Cookie 不 HttpOnly` → `false`。登出走 `DELETE /api/sessions`，先 `requireCsrf` 再删，并把两个 Cookie 以 `Max-Age=0` 覆写掉。

`SESSION_TTL_MS` 默认 7 天。会话存数据库表而不是进程内存是有意的：重启服务不掉登录态，且这一张表就是将来外置到 Redis 的唯一改造点（缓存与过期那套在[数据存储进阶](/data-storage/)，本章不展开）。

**阶段产出**：注册 → 登录 → 带 Cookie 读列表，四步全通；把 `HttpOnly` 删掉，第 7 条断言立刻变红。

## 阶段 ④ 授权：水平越权与垂直越权必须被真的拒掉

**做什么**：三个守卫 + 每条归属查询都带 `user_id`。

```js
function requireAuth(ctx) {
  const a = ctx.auth
  if (!a) throw ERR.unauth()
  return a
}

function requireCsrf(ctx) {
  const a = requireAuth(ctx)
  const given = ctx.req.headers['x-csrf-token']
  if (!given || given !== a.session.csrf) throw ERR.csrf()
}

function requireRole(ctx, role) {
  const a = requireAuth(ctx)
  if (a.user.role !== role) throw ERR.forbidden(`需要 ${role} 角色`)
}
```

角色的唯一来源是 `ctx.auth.user.role`，而这个对象由服务端拿 Cookie 里的 `sid` 查表得到。**请求体、查询串、自定义头里出现的任何 `role` 一律不接受**——这是垂直越权的根防线，也是[第 8 章](/backend/authorization)那句「角色来自会话，不来自请求」的实现。

归属判定写在 service 里，且**读与写的严格程度不同**，这是本项目唯一一处刻意不对称：

```js
async getBookmark(userId, id, role) {
  const b = repo.findBookmark(id)
  if (!b) throw ERR.notFound('书签不存在')
  if (b.user_id !== userId && role !== 'admin') throw ERR.forbidden('这不是你的资源')
  return publicBookmark(b)
}

async deleteBookmark(userId, id) {
  const b = repo.findBookmark(id)
  if (!b) throw ERR.notFound('书签不存在')
  if (b.user_id !== userId) throw ERR.forbidden('这不是你的资源')
  const r = repo.removeBookmark(id, userId)
  if (!r.changes) throw ERR.notFound('书签不存在')
  enqueueJob('purge-cdn-cache', async () => { /* 600 ms 的清理动作 */ })
  return { ok: true, id }
}
```

`admin` 能读别人的书签（运营场景需要），但**不能删**：删除是不可逆写操作，越权删除的代价远大于越权读取，且「先读后删」在并发下不成立——所以删除走 `DELETE FROM bookmarks WHERE id = ? AND user_id = ?` 并把「归属」放进 SQL 条件，用 `r.changes` 判有没有真删到行。这一条比「先查再删」强：查和删之间被别人改了归属也不受影响。

实测越权四条全部为 `403 E_FORBIDDEN`：`bob 读 alice 资源`（错误信息里带资源 id `215e7298-cf4d-4e48-951e-c377f811b322`）、`bob 改 alice 资源`、`bob 删 alice 资源`、`垂直越权：普通用户访问管理端`（`msg=需要 admin 角色`）。列表侧一条：`bob 列表看不到 alice 数据` → `0`。**阶段产出**：这四条断言必须存在且为绿；把 `AND user_id = ?` 去掉再跑一遍，看它变红——这个「故意让它失败」的动作是本章唯一能证明断言真的在做事的方法。

## 阶段 ⑤ 入口防护：白名单校验、体积上限、限流、幂等

**做什么**：把非法输入全部拦在 service 之前。注册校验的写法最能体现「防质量赋值」的思路：

```js
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ALLOWED_REGISTER = new Set(['email', 'password', 'role'])

function validateRegister(body) {
  const errors = []
  for (const k of Object.keys(body)) {
    if (!ALLOWED_REGISTER.has(k)) errors.push({ field: k, rule: '不允许的字段（防质量赋值）' })
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email) || email.length > 254) errors.push({ field: 'email', rule: '必须是合法邮箱且不超过 254 字符' })
  if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 200) {
    errors.push({ field: 'password', rule: '长度需在 10..200 之间' })
  }
  if (body.role !== undefined && !['user', 'admin'].includes(body.role)) {
    errors.push({ field: 'role', rule: '只能是 user 或 admin' })
  }
  if (errors.length) throw ERR.validation('注册字段校验失败', errors)
  const wantsAdmin = body.role === 'admin'
  if (wantsAdmin && env.ALLOW_ADMIN_BOOTSTRAP !== '1') {
    throw ERR.forbidden('不允许通过注册接口创建管理员')
  }
  return { email, password: body.password, role: wantsAdmin ? 'admin' : 'user' }
}
```

**白名单而不是黑名单**：先对 `Object.keys(body)` 做减法，任何不在 `ALLOWED_REGISTER` 里的字段直接 400。如果反过来只校验已知字段，攻击者塞进来的 `id`、`password_hash`、`created_at` 就会悄悄落到 `INSERT` 里——这就是 mass assignment。实测用例 `注册塞 role/id（质量赋值）` 打印出 `details` 里 `fields=["id"]`：`role` 因为在白名单里而合法，`id` 被抓住，返回 400。

`role: 'admin'` 能生效，靠的是测试脚本显式设了 `ALLOW_ADMIN_BOOTSTRAP='1'`——第一个管理员总得有个来源，但那个来源必须是**部署时明确打开的开关**，而不是默认路径。实测两条都过：`注册 admin（引导开关）` → `201 role=admin`。诚实说一句：**开关关闭时应返回 403 的那条分支，我这 41 项里没有单列断言**，你补测试时请把它加上（参考答案要点 3 给了写法）。

幂等键与限流：

```js
if (idemKey) {
  const hit = repo.findByIdem(userId, idemKey)
  if (hit) return { bookmark: publicBookmark(hit), replayed: true }
}
try {
  repo.createBookmark(b)
} catch (e) {
  if (String(e.message).includes('UNIQUE')) {
    const hit = repo.findByIdem(userId, idemKey)
    if (hit) return { bookmark: publicBookmark(hit), replayed: true }
    throw ERR.conflict('同标题书签已存在')
  }
  throw e
}
```

顺序是「先查、再插、撞唯一索引就回读」。先查让正常重放不打到异常路径，索引保证查漏了也不会真造出两行。实测：`同一 Idempotency-Key 两次只建一条` → `same-id + replayed`，紧接着 `alice 列表含 2 条（幂等未重复）` → `2`。

限流按 `login:<ip>` 分桶，60 秒窗口、阈值由 `RATE_MAX` 给（测试脚本设 6）：

```text
OK   登录限流出现 429            期望 true                    实到 true 状态码=[401,429,429,429]
```

这条断言只判「窗口内确实出现过 429」，**不判精确的第 N 次**——同一个 IP 的桶在前面的 `密码错误`、`不存在邮箱`、`alice 登录`、`bob 登录` 里已经被吃掉若干配额。写限流测试必须把「同进程同 IP 的历史计数」算进去（详见「常见翻车点 3」）。

**阶段产出**：R4、R5、R12、R13 全绿。边界断言的实测原文四条：`未知路径` → `404 E_NOT_FOUND`、`方法不允许` → `405 E_METHOD_NOT_ALLOWED`、`超大请求体（上限 4096）` → `413 E_PAYLOAD_TOO_LARGE`、`残缺 JSON` → `400 E_VALIDATION msg=请求体不是合法 JSON`。

## 阶段 ⑥ 关闭与交付：预排空 503、在途跑完、退出码 0

**做什么**：把[第 14 章](/backend/docker-and-shutdown)测到的时序装进这个项目。**摘流和关监听是两个动作**，混成一个就是丢请求。

```js
function beginShutdown(why) {
  if (closing) return
  closing = true
  phase = 'draining'                      // 第 2 步开始对 /api 返回 503，端口仍监听
  log('info', 'shutdown.signal', { signal: why, inflight: requestsInFlight, preDrainMs: CFG.PRE_DRAIN_MS })
  const doClose = () => {
    server.close(async (err) => {         // 不再接受新连接；已有连接上的请求继续跑
      const drained = await drainJobs(Number(env.JOB_DRAIN_MS || 1000))
      log('info', 'jobs.drain', drained)
      db.close()
      log('info', 'process.exit', { code: 0, totalMs: now() - bootAt })
      process.exit(0)
    })
    const sweep = setInterval(() => server.closeIdleConnections(), Number(env.SWEEP_MS || 200))
    sweep.unref()
    setTimeout(() => {                    // 预算到了就强制
      server.closeAllConnections()
      process.exit(1)
    }, CFG.GRACE_MS)
  }
  if (CFG.PRE_DRAIN_MS > 0) setTimeout(doClose, CFG.PRE_DRAIN_MS)
  else doClose()
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => beginShutdown(sig))
process.on('message', (m) => m === 'shutdown' && beginShutdown('ipc'))
```

`PRE_DRAIN_MS=400` 这段时间端口还在监听、只回 503：负载均衡器有间隔探测，不给它这个窗口，它会在连接被拒之后才发现后端没了，期间继续转发。测试脚本在 Windows 上无法用 `SIGTERM`（Node 在 Windows 只支持 `SIGINT` / `SIGBREAK`），所以走 `ipc` 消息触发**同一个** `beginShutdown`；Linux 下由 `SIGTERM` 走这条路径，见[Linux 的进程与 systemd](/linux/processes-and-systemd)。

四条实测断言与 `srv` 侧日志原文：

```text
OK   pre-drain 期间新请求 /api（端口仍在监听）   期望 503 E_SERVER_DRAINING  实到 503 E_SERVER_DRAINING
OK   pre-drain 期间 /health                     期望 503 E_NOT_READY        实到 503 E_NOT_READY details=[{"phase":"draining","ready":false}]
OK   在途请求跑完不丢                            期望 200 NONE               实到 200 NONE 耗时=1202ms
OK   关监听之后新连接                            期望 FETCH_ECONNREFUSED     实到 FETCH_ECONNREFUSED
OK   优雅退出码 0                                期望 0                       实到 0 sig=null
```

```text
{"msg":"shutdown.signal","signal":"ipc","inflight":1,"preDrainMs":400}
{"msg":"drain.sweep","inflight":1}
{"msg":"drain.sweep","inflight":1}
{"msg":"drain.sweep","inflight":1}
{"msg":"drain.sweep","inflight":0}
{"msg":"server.close.callback","err":null,"inflight":0}
{"msg":"jobs.drain","drained":true,"waitedMs":0,"total":1}
{"msg":"database.closed"}
{"msg":"process.exit","code":0,"totalMs":2017}
```

把这两段对着读，能确认三件事：`inflight` 从 1 掉到 0 才触发 `close` 回调（那条 1202 ms 的请求确实跑完了，不是碰巧）；作业排空 `waitedMs:0` 是因为那 600 ms 的作业早就在等请求的 1202 ms 里跑完了——**排空预算要覆盖「最长在途请求 + 作业本身」的和**，不是各自的最大值；`totalMs:2017` 小于 `GRACE_MS=5000`，说明没走强制分支。

**阶段产出**：上面五条断言全绿；`GRACE_MS` 改成 300 再跑，你应该看到 `closeAllConnections` 与退出码 1。这个「故意改坏」的动作，是唯一能证明你的预算真的在起作用的方法。Docker 那段仍是 `unverified`：多阶段 Dockerfile 的写法照[第 14 章](/backend/docker-and-shutdown)抄，但本机没跑容器，镜像体积和 PID 1 信号行为我没法替你确认。

<Callout type="unverified" title="Fastify、Pino、Docker 三块都归在这里">

以下都在本机**未执行**：`npm install fastify`、`@fastify/swagger` 生成的 `/docs` 页面、Pino 的日志字段、`docker build` / `docker stop -t`、容器内谁是 PID 1、Linux 下真实 `SIGTERM`。下一节的 Fastify 对应写法是**按官方文档推演的预期结果**，与[第 4 章](/backend/fastify-basics)、[第 10 章](/backend/api-docs)、[第 12 章](/backend/logging-and-monitoring)同一口径。你把它跑通了，请以你的输出为准。

</Callout>

## Fastify 形态：本章机制怎么映射到框架

本章的骨架刻意不用框架，好让每个机制都裸露可测。真做项目时用 Fastify，因为校验、序列化、错误兜底它都提供了带类型的版本。映射关系如下（**本节全部未在本机验证**）：

| 本章的裸露实现 | Fastify 对应 | 挂在哪个阶段 |
| --- | --- | --- |
| 链路第 5、7 步的三个 `require*` | `preHandler` 钩子；认证放 `onRequest` | 封装成插件，作用域见下 |
| 手写 `validateRegister` | 路由 `schema.body` 的 JSON Schema | 与序列化共用一份 schema |
| `details[].field` 错误结构 | `setValidatorCompiler` / `schemaErrorFormatter` | 阶段 ② 的错误出口 |
| `handler` 里那个 `catch` | `setErrorHandler` | 阶段 ② |
| `res.setHeader('x-request-id', …)` | `genReqId` + `req.id` | 阶段 ① |
| 手写 `log()` | 内置 Pino：`req.log.info()` | 阶段 ① |
| `routes` 数组 | `app.get/post` 或 `@fastify/route` 自动注册 | 阶段 ① |
| `beginShutdown` 的三步 | `app.close()`（内部按 `closeTimeout` 收敛） | 阶段 ⑥ |
| A5 那条 Swagger | `@fastify/swagger` + `@fastify/swagger-ui`，`route` 里加 `schema` | 阶段 ⑤ 之后 |

作用域是这里唯一容易翻的坑：`requireAuth` 这类守卫要在**同一个插件实例**里 `decorate` 并在 `app.after()` 之后才使用，否则父作用域的装饰在子插件里可见、兄弟插件之间不可见——症状是某几个路由稳定 500 `app.x is not a function`。原理在[第 4 章的插件与作用域隔离](/backend/fastify-basics)。

预期形态（`ts`，注意它只是形状，没跑过）：

```ts
app.register(async function authScope(instance) {
  instance.addHook('onRequest', async (req) => {
    req.auth = await authenticate(req.cookies.sid)          // 未登录时为 null
  })
  instance.addHook('preHandler', async (req) => {
    if (req.method === 'GET' || req.routeOptions.url === '/api/users') return
    if (!req.auth) throw ERR.unauth()
    if (req.headers['x-csrf-token'] !== req.auth.session.csrf) throw ERR.csrf()
  })

  instance.post('/api/bookmarks', {
    schema: bookmarkCreateSchema,                            // 校验与序列化同一份
    config: { role: 'user' },
  }, async (req) => service.createBookmark(req.auth.user.id, req.body, req.headers['idempotency-key']))
})
```

`405` 在 Fastify 里由框架自身产生（默认返回 404 还是 405 取决于服务器选项，请以[官方 Server 参考](https://fastify.dev/docs/latest/Reference/Server/)当前说明为准，别照抄我这句话）。`@fastify/swagger` 的 OpenAPI 输出来自路由 `schema`，因此**校验规则与文档是同一份事实**，这正是首页 A5 那条想要的效果：文档不会和代码漂移（见[第 10 章](/backend/api-docs)）。

## 测试脚本的组织：41 条断言怎么写

零依赖项目配零依赖测试脚本，起法是关键：

```js
const child = spawn(process.execPath, [import.meta.dirname + '/proj-srv.mjs'], {
  env: {
    ...process.env,
    PORT: String(PORT),                 // 3310，避开开发端口
    MAX_BODY_BYTES: '4096',             // 压小才能测出 413
    RATE_MAX: '6',
    ALLOW_ADMIN_BOOTSTRAP: '1',
    JOB_MS: '600',
    JOB_DRAIN_MS: '2000',
    GRACE_MS: '5000',
    PRE_DRAIN_MS: '400',
    DB_PATH: ':memory:',                // 每轮全新，不留脏数据
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  windowsHide: true,
})
```

`stdio` 第四项 `'ipc'` 是 Windows 上触发关闭的唯一办法；`DB_PATH=':memory:'` 让整轮测试可重放；`MAX_BODY_BYTES='4096'` 说明了一件事——**边界值断言往往需要你主动把生产默认压小**，否则你得真发一条 64 KB 才能测到 413。

断言函数的写法有个我必须交代的缺陷：

```js
function check(name, expected, actual) {
  const ok = String(actual).startsWith(String(expected))
  info(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(42, ' ')} 期望 ${String(expected).padEnd(23)} 实到 ${String(actual)}`)
}
```

`startsWith` 让我可以在期望值后面附加说明（`'400 E_VALIDATION'` 匹配 `400 E_VALIDATION | field=email`），代价是**它比全等松**：实际值为 `400 E_VALIDATION_FAILED` 时也会算通过。这一版我接受这个代价，换取「一条断言同时判状态码、错误码和字段名」；收紧的改法见参考答案要点 3。

跑起来是 `node check.mjs`，输出就是我上面引的那 41 行加三行日志小结。整轮不到 2 秒（`totalMs:2017` 含关闭），这个数量级本身就是「零依赖」买到的东西。测试组织与 CI 里的跑法见[前端工程化的测试体系](/frontend-engineering/testing)。

## 验收清单

逐条打勾，任何一条打不上就停在对应阶段。**「代码里写了」不算，必须有那条断言或那次手工复现。**

- [ ] `node srv.mjs` 起得来，启动日志把 `port / pid / platform / node / graceMs / maxBody` 全部打出来
- [ ] `GET /health` 返回 200；调过就绪降级后返回 `503 E_NOT_READY`，`details` 含 `phase`
- [ ] 三个超时常量都设置了，且 `headersTimeout > keepAliveTimeout`
- [ ] 全项目搜 `SELECT`，命中只在 `repo/`；`service` 里搜 `req` / `res` 应为零
- [ ] 数据库里搜不到明文密码；存储串以 `scrypt$16384$8$1$` 开头
- [ ] `Set-Cookie` 里 `sid` 带 `HttpOnly`，`csrf` 不带；两个都有 `SameSite=Strict`
- [ ] 「密码错误」与「邮箱不存在」返回**完全相同**的状态码、错误码与 `message`
- [ ] 不带 `x-csrf-token` 的 POST / PATCH / DELETE 全部 403 `E_CSRF`
- [ ] bob 对 alice 资源的读、改、删三条都 403；bob 的列表里 alice 的数据条数为 0
- [ ] 非 admin 访问 `/api/admin/users` 返回 403 且 `message` 为「需要 admin 角色」
- [ ] 注册体塞 `id` → 400，`details` 里能看到 `field` 为 `id`
- [ ] `ALLOW_ADMIN_BOOTSTRAP` 未设时，用 `role: 'admin'` 注册返回 403（**我那份没测这条**）
- [ ] 同一 `Idempotency-Key` 两次请求返回同一个 `id`，列表不重复增长
- [ ] 未知路径 404、换方法 405、超体积 413、坏 JSON 400、刷登录 429 五条都能复现
- [ ] 每个错误响应体都有 `requestId`，且与响应头一致；错误体里搜不到 `at ` / 盘符 / 文件路径
- [ ] 每条 warn 级日志都带 `id` / `method` / `path` / `status` / `code`
- [ ] `PRE_DRAIN_MS > 0` 时，摘流期 `/api` 得 503 而进程仍监听；`/health` 得 503
- [ ] 在途长请求最终 200；关监听后新建连接被拒；正常关闭退出码 0
- [ ] 把 `GRACE_MS` 压小能跑出强制分支（`closeAllConnections` + 退出码 1）
- [ ] Fastify 变体：`/docs` 能打开且字段与 `schema` 一致（**需要你先装依赖，我未验证**）

## 常见翻车点

**1）CSRF 守卫在会话装载之前跑，所有写操作 403。** 现象：`requireCsrf` 抛 `E_UNAUTHENTICATED` 而不是 `E_CSRF`，或永远 403。原因：链路第 5 步（装载 `ctx.auth`）与第 7 步（守卫）被随手排序。确认：把 `x-csrf-token` 故意填错，得到 401 而不是 403 就说明 `ctx.auth` 那时还是 `null`。修法：守卫一律晚于认证，且 `requireCsrf` 内部自己先 `requireAuth`（阶段 ④ 那份就是这么写的）。

**2）413 用了 `req.destroy()`，客户端拿不到错误体。** 现象：测试脚本抛 `fetch failed`，服务端日志里请求没记完。原因：destroy 把承载响应的 socket 一起拆了。确认：断言改成「状态码 413 **且**响应体 JSON 可解析」，红的就是这条。修法：只 `reject` 不 destroy，超限时 `req.pause()` 停止累积。

**3）登录限流把自己的其他用例算进配额。** 现象：某个预期 401 的用例突然 429，像随机失败。原因：桶按 `login:<ip>` 分，同一轮所有登录共用一个桶。确认：打印每个登录用例的状态码序列——我那份印出 `[401,429,429,429]` 就是这么发现的。修法：阈值设到大于全部前置登录次数，或每用例换 key。**不要**为了测别的东西把限流关掉，那等于测了另一个程序。

**4）`Number(env.X || 默认)` 让 0 失效。** 现象：`PRE_DRAIN_MS=0` 和不设一样，摘流不生效。原因：`'0'` 是假值，被 `||` 换成默认。确认：看启动日志里的 `graceMs` / `preDrainMs` 是不是你给的那个数。修法：`Number(env.PRE_DRAIN_MS ?? 0)`。

**5）幂等只写在应用层，并发下造出两条。** 现象：串行重发没问题，两个并发同时打就多一行。原因：「先查后插」之间有窗口。确认：`Promise.all` 连发同键两次看 `count`。修法：靠 `ux_idem` 唯一索引，把 `catch` 里的 UNIQUE 分支当正常路径。

**6）删资源用「先查归属再删」。** 现象：压测时偶发删掉别人的行，或返回 200 但行数没变。原因：查与删之间归属可能被改，或 `WHERE id = ?` 忘了带 `user_id`。确认：把 `AND user_id = ?` 去掉再跑 R9——如果它不转红，说明你的测试根本没测到这条边界。修法：归属条件写进 SQL，用 `changes` 判有没有真删。

**7）关监听和摘流当成一件事。** 现象：部署时总有几个 502，日志里看不到 `inflight` 递减。原因：直接 `server.close()`，负载均衡器还在往这个端口发。确认：`PRE_DRAIN_MS=400`，在摘流窗口内手工发一条 `/api`，应得 `503 E_SERVER_DRAINING`。修法：两阶段——先置 `phase='draining'` 保持监听，再关监听。

**8）`inflight` 递减没进 `finally`。** 现象：关闭期永久卡住，直到 `GRACE_MS` 强制退出。原因：某条路径抛异常后计数没减。确认：在链路第 7 步随便抛一个非 `ApiError`，看 `inflight` 有没有回落到 0。修法：递减写在 `finally`。

**9）启动时 `PRAGMA foreign_keys` 没开。** 现象：能插入 `user_id` 指向不存在用户的书签。确认：手工插一条孤儿行。修法：连接建立后立刻执行该 PRAGMA，并写进启动自检——SQLite 默认关闭这条，很多人以为外键天然生效。

**10）Windows 上照抄 `kill -TERM`。** 现象：信号到不了进程，服务被硬杀。原因：Node 在 Windows 不支持 `SIGTERM`。确认：`process.on('SIGTERM', ...)` 里打一行日志，Windows 上按 Ctrl+C 看不到它。修法：Windows 用 `SIGINT` / `SIGBREAK`，测试里用 `ipc`（本章就是这么做的），Linux 才走 `SIGTERM`。别把这条当成「跨平台一致」。

## 参考答案要点

三个要点各配一段可执行动作。题干就是要点本身，答案折叠在下面。

<Exercise title="参考答案要点 1 · 让越权断言真正有效" difficulty="进阶">

「bob 读 alice 的资源返回 403」这条断言有一个致命弱点：它在实现根本没有任何授权检查时也可能显示为绿——如果你的 service 只按 `userId` 查询，那么 bob 拿 alice 的 id 去读会返回 404 而不是 403，两者都能被写成「请求被拒」。请给出一个改法，让这条断言无法被「碰巧」满足，并说明如何证明它现在真的会失败。

<template #answer>

三件事一起做。

第一，**分别断言 403 与 404，不许合并**。`bob 读 alice 资源` 期望值必须是 `403 E_FORBIDDEN`，另加一条 `任何人读不存在 id` 期望 `404 E_NOT_FOUND`。两者在实现里走完全不同的分支（归属不匹配 / 行不存在），合并成「被拒」就丢掉了信息。本章的 `getBookmark` 里 `if (!b) notFound` 排在归属判断之前，所以真实存在的 alice 资源一定走 403——实测原文印出了资源 id `215e7298-cf4d-4e48-951e-c377f811b322`，这就是「行确实存在、请求确实被授权层拒掉」的证据。

第二，**把断言名字里的对象写死**：用 `id=` 打印实际被查的 id，否则很容易测成「读一个自己的资源，恰好 404」这种假绿。

第三，**故意破坏一次再跑**：删掉 `getBookmark` 的归属判断 → 应转红；把 `ERR.forbidden` 改成 `ERR.notFound` → 应转红；把 `requireAuth` 去掉 → 401 断言也转红（说明两层互相独立）。**只有看到它变红，你才知道它之前在保护你。**

</template>

</Exercise>

<Exercise title="参考答案要点 2 · 排空预算该按什么算" difficulty="挑战">

`GRACE_MS=5000` 而实测关闭总共用了 2017 ms。给出计算方法：如果项目里最长在途请求是 1200 ms、后台作业最长 600 ms，`GRACE_MS` 该设多少，为什么不是 1200 或 600 的最大值。另外说明怎么用一个实验证明「作业没有因为进程退出而被吃掉」。

<template #answer>

预算是**串起来加**，不是取最大：`PRE_DRAIN_MS` + 最长在途请求 + 作业排空等待 + 收尾余量。按本章的量级：400 + 1200 + 600 + 余量 ≈ 2200 ms，实测 2017 ms 落在这个区间内，与日志形状一致。

之所以看着比 1200 + 600 = 1800 加前置等待还小：作业是在请求处理结束时才 `enqueueJob` 的（`deleteBookmark` 成功后入队 `purge-cdn-cache`），两者有先后而非并行。但**别把这一点当成设计**——只要有一个作业是长请求内部提前入队的，两者就重叠，取最大立刻漏掉。取「和」是唯一不需要分析依赖关系的安全写法。

证明作业没被吃掉，看日志形状：`{"msg":"jobs.drain","drained":true,"waitedMs":0,"total":1}` 出现在 `server.close.callback` 之后、`database.closed` 之前，且 `total` 是 1；`waitedMs:0` 说明排空时作业已经跑完（被长请求那 1202 ms 覆盖），不是「没等到就算了」。要构造真正的等待，把 `JOB_MS` 设为 1500 再关，`waitedMs` 应明显大于 0。然后做破坏实验：`GRACE_MS` 压到 300，应看到强制分支与退出码 1，此时 `jobs.drain` 要么缺失、要么 `drained:false`。**看到它真的丢掉作业，才证明排空那段代码不是摆设。** 另一个隐蔽错误是 `close` 回调里漏了 `await`：写成 `drainJobs().then(log)` 不等待，进程会在作业完成前退出，日志顺序里 `database.closed` 会夹在中间。

</template>

</Exercise>

<Exercise title="参考答案要点 3 · 收紧断言并补上未覆盖的分支" difficulty="基础">

本章的 `check()` 用 `startsWith`，因此 `400 E_VALIDATION_FAILED` 也会满足 `400 E_VALIDATION`。另外，`ALLOW_ADMIN_BOOTSTRAP` 未开启时注册 admin 应返回 403 这条分支，那 41 项里没有断言。请写出这两处的修补：一个更严的断言helper，加上一条覆盖该分支的新断言。

<template #answer>

helper 拆段全等，同时保留可读的实际值：

```js
function expectApi(res, status, code, extra = '') {
  const got = `${res.status} ${res.json?.error?.code ?? 'NONE'}`
  check(got === `${status} ${code}`, `${got.padEnd(28)} ${extra}`)
  return got
}

const ghostAdmin = await call('POST', '/api/users', {
  body: { email: 'sneaky@example.com', password: 'correct-horse-1', role: 'admin' },
})
expectApi(ghostAdmin, 403, 'E_FORBIDDEN')
```

新断言必须由**另一个子进程**跑，因为开关是启动时读的。两种做法：起一个不带 `ALLOW_ADMIN_BOOTSTRAP` 的服务实例专门测这条；或者把这条做成集成脚本的第二阶段——第一轮（开关开）跑完 41 项，`child.kill('SIGINT')` 关服，再以 `env` 去掉那个变量重启一次，只跑这一条。第二种更省事，也顺带验证了「同一份二进制在不同配置下行为不同」这个部署常识（配置读取的纪律见[环境变量与配置管理](/frontend-engineering/env-and-config)）。

同时把已有断言里最松的几条收紧：`错误体不含堆栈/文件路径` 目前只判一个布尔值，建议改成对响应体做一次显式匹配，逐个断言不含 `'at '`、不含盘符冒号、不含 `src/`；`登录限流出现 429` 改成断言完整状态码序列，否则它永远只验证「出现过 429」而不验证边界在第几次。

判断这类收紧是否值得：如果你的测试在实现被故意改坏之后仍然全绿，那这条断言就没在工作。上面 `ghostAdmin` 那条一旦补上，`validateRegister` 里那句 `throw ERR.forbidden('不允许通过注册接口创建管理员')` 才第一次被执行到——本章那 41 项里它一次都没跑到，这是这份骨架的真实盲区。

</template>

</Exercise>

## 官方文档与延伸阅读

本站正文为中文原创，以下官方资料用于核实本章的具体结论：

- [Node.js `http` 模块 API](https://nodejs.org/docs/latest/api/http.html) —— 核实 `server.close()` 只停止接受新连接、`closeIdleConnections()` 与 `closeAllConnections()` 的语义差别、三个超时常量的默认值与相互关系。「413 不能 destroy 请求」这条结论请以此页和你的复跑结果为准。
- [Node.js `sqlite` 模块 API](https://nodejs.org/api/sqlite.html) —— 核实 `DatabaseSync`、`prepare` 的用法，以及阶段 ② 那句「`PRAGMA foreign_keys` 默认关闭」。
- [Node.js `crypto` API](https://nodejs.org/docs/latest/api/crypto.html) —— 核实 `scryptSync` 的 `N` / `r` / `p` 参数与 `timingSafeEqual` 在长度不等时抛异常的行为。
- [Node.js `process` API](https://nodejs.org/docs/latest/api/process.html) —— 核实各平台支持的信号，这是常见翻车点 10 的依据，别凭 Linux 习惯读 `kill` 手册。
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) —— 核实本章刻意没写的东西：`N` / `r` / `p` 的**当前推荐取值**。
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) —— 核实令牌长度、过期与登出处理，对应阶段 ③。
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) —— 核对本章覆盖了哪几项（失效的对象级授权对应 R9 / R10），以及**没覆盖哪几项**。
- [Fastify 官方文档](https://fastify.dev/docs/latest/)，尤其 [Hooks](https://fastify.dev/docs/latest/Reference/Hooks/)、[Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)、[Errors](https://fastify.dev/docs/latest/Reference/Errors/)、[Server](https://fastify.dev/docs/latest/Reference/Server/) —— 映射表的依据；凡标「未在本机验证」的句子都以这几页当前版本为准。
- [fastify-swagger（GitHub）](https://github.com/fastify/fastify-swagger) —— 核实 A5：路由 `schema` 与 OpenAPI 输出的关系。
- [pino 官方文档](https://getpino.io/) —— 核实 `genReqId`、日志级别与序列化器。
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) —— 阶段 ⑥ 未验证部分的依据；多阶段与非 root 的写法在第 14 章已展开。
- 站内回指：[第 1 章](/backend/node-runtime)、[第 2 章](/backend/minimal-http-server)、[第 3 章](/backend/http-and-rest)、[第 4 章](/backend/fastify-basics)、[第 5 章](/backend/layered-architecture)、[第 6 章](/backend/error-handling)、[第 7 章](/backend/auth-session)、[第 8 章](/backend/authorization)、[第 9 章](/backend/jwt-and-oauth)、[第 10 章](/backend/api-docs)、[第 11 章](/backend/web-security)、[第 12 章](/backend/logging-and-monitoring)、[第 13 章](/backend/uploads-and-jobs)、[第 14 章](/backend/docker-and-shutdown)、[领域首页](/backend/)。

## 下一章

这一章把前 14 章各自单独验证过的能力收进同一个进程，收到了「41 项断言全绿、2017 毫秒关完一台有在途请求的服务」这种能复现的数字，并把边界留得很明确：归属查询都在 `repo`、会话在表里而不在进程里。它刻意没解决的是——**数据怎么活过进程重启、怎么被执行计划证明不是全表扫、怎么真的恢复回来**。

下一站是[数据库领域](/database/)：从[关系模型](/database/relational-model)、[SQLite 入门](/database/sqlite-first)到[数据建模](/database/data-modeling)、[索引与执行计划](/database/indexes)、[事务与并发](/database/transactions)、[迁移与版本管理](/database/migrations)，最后落到[数据库阶段项目](/database/project)。那一章假定你已有本章的路由与校验、只需换存储，但它假设的五表模型本章没有实现，衔接时按本章「口径差异」一节先补模型扩展。再往后，缓存与会话外置在[数据存储进阶](/data-storage/)，运行与故障定位在 [Linux](/linux/processes-and-systemd) 与[工程工具与部署](/devops/git-basics)，全站顺序见[学习路线图](/guide/roadmap)。
