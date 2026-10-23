# 授权与权限：登录了不等于有权，越权才是最常见的后端事故

安全评审问「这个接口怎么防止 A 公司看 B 公司的文档」，你回答「挂了 `requireAuth` 中间件」。真实泄露现场都长这样：日志里是一条最普通的 `GET /api/docs/d-9182`，token 合法、角色合法，唯一的问题是这条 doc 属于另一个租户。`requireAuth` 只回答**你是谁**，这句话问的是**这条数据能不能给你**。没有攻击、没有扫描器报警，只是每个单条查询都少了一个 `WHERE tenant_id = ?`。

第二个现场：前端很负责，`viewer` 看不到删除按钮，测试也过了。第二天有人用 Postman 发 `DELETE /api/docs/d-2`，把同事的私有草稿删了，返回 200。按钮的显隐是一个 `if`，它不在服务器的信任边界内。

第三个现场是长期腐化：最初 `admin` / `editor` / `viewer` 够用，半年后需求变成「只能看本区域订单」「改金额要二级审批」，`roles` 表长出 `data_scope`、`can_export` 列，`admin` 到底能干什么没人说得清——**这是 RBAC 的模型边界被撞到，不是实现不好**。

这一章把四件事分开：**能力判定**（这个动作允许吗）、**数据范围判定**（这条记录在你范围内吗）、**租户隔离**、**判定点的位置**。前置：[认证：Session、Cookie 与密码哈希](/backend/auth-session)（本章假设已有可信的 `req.user`）、[分层架构与请求处理链路](/backend/layered-architecture)。本章所有状态码与条数都在本机 Node v25.4.0 跑出来了。

## 认证与授权是两次判定：401、403、404 各说一件事

| 判定 | 回答的问题 | 失败状态码 | 实现位置 |
| --- | --- | --- | --- |
| 认证 | 你是谁 | **401** | 全局 `preHandler` |
| 能力授权（垂直） | 这个动作允许你做吗 | **403** | 路由入口的声明式检查 |
| 数据授权（水平 / 行级） | 这条记录属于你的范围吗 | **403**，跨租户建议 **404** | repository 的查询条件里 |

**401 意味着「换成有效凭证就能成功」**，把它用在「你不是所有者」上，前端会当登录过期去弹登录框，用户重登还是 401，死循环；**403 意味着「凭证有效但重试无用」**；404 是**有意的信息隐藏**。顺序必须是认证 → 能力 → 数据范围，反过来会出现「未登录者通过 403 得知这条 id 存在」。

## RBAC 的模型：五张表与三层判定链

```sql
CREATE TABLE role (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE permission (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL);   -- 'doc:read'
CREATE TABLE user_role (user_id TEXT, role_id TEXT, PRIMARY KEY (user_id, role_id));
CREATE TABLE role_permission (role_id TEXT, permission_id TEXT, PRIMARY KEY (role_id, permission_id));
-- 判定四元组：主体、动作、资源、上下文（tenantId / ownerId / regionId 都归入「上下文」）
```

权限码统一 `资源:动作` 命名，多角色取并集展开成扁平字符串集合，然后是一条短路判定链：

```js
const permsOf = (u) => [...new Set(u.roles.flatMap((r) => rolePerms[r] ?? []))];
const has = (perms, need) => perms.includes(need) || perms.includes('doc:*') && need.startsWith('doc:');

function authorize(user, need, doc) {
  if (!has(permsOf(user), need)) return { code: 403, why: `角色 ${user.roles} 没有 ${need}` };
  if (doc.tenantId !== user.tenantId) return { code: 404, why: '跨租户：按不存在处理，不泄露存在性' };
  if (need === 'doc:delete' && doc.ownerId !== user.id) return { code: 403, why: '不是所有者，editor 也删不了' };
  if (need === 'doc:read' && doc.visibility === 'private' && doc.ownerId !== user.id && user.roles[0] !== 'admin')
    return { code: 403, why: '私有且不是所有者' };
  return { code: 200, why: '放行' };
}
```

`alice` 是 `t-acme` 的 `editor`、`bob` 同租户 `viewer`、`carol` 是 `t-globex` 的 `admin`，五份资源。这个函数在本机跑出的判定表（Node v25.4.0，2026-10-18）：

```text
u-alice doc:read   d-1 -> 200  放行
u-alice doc:read   d-2 -> 403  私有且不是所有者
u-alice doc:delete d-2 -> 403  不是所有者，editor 也删不了
u-bob doc:delete d-3 -> 403  角色 viewer 没有 doc:delete
u-alice doc:read   d-4 -> 404  跨租户：按不存在处理，不泄露存在性
u-alice user:manage d-1 -> 403  角色 editor 没有 user:manage
u-carol doc:delete d-4 -> 200  放行
u-carol doc:read   d-1 -> 404  跨租户：按不存在处理，不泄露存在性
```

alice 有 `doc:delete` 却删不掉别人的（**有权限码不等于能改别人的东西**）；bob 有 `doc:read` 却读不到私有文档（**同租户不等于可见**）；carol 是 `admin` 但在别的租户只能拿 404（**角色再高不跨租户**）。

## 水平越权与垂直越权：攻击面清单

水平越权（IDOR，OWASP API Security 里称 BOLA）的本质是 **id 可枚举 + 判定缺失**：

| 攻击面 | 怎么做 | 防护 |
| --- | --- | --- |
| 单条读 / 改 / 删 | `id` 从 1 开始 +1 | 每个接口都要数据范围判定，**不能只给写操作加** |
| 列表接口 | 单条加了判定，`?author=u-dave` 全量返回 | 客户端参数只能收窄条件，不能放宽 |
| 批量接口 | `POST /docs/batch-delete` 传 500 个 id | 逐项判定并返回逐项结果，别整体放行 |
| 子资源 | `/users/u-a/docs/d-2` 只校验外层 user | 以最内层资源归属为准；路径与 body 的 id 不一致直接 400 |
| 导出 / 报表 | `POST /export` 绕过列表判定 | 导出复用列表的同一个过滤函数 |
| 软删除记录 | 已删资源仍被 `find` 命中 | 可见性条件与授权条件写在同一处 |

垂直越权是**用低权限身份做高权限动作**，三条门路：

**一，权限判断的输入来自客户端。** handler 写成 `const roles = req.body?.roles ?? req.user.roles`，实跑：

```text
正常请求               : 200 已删除
客户端伪传 roles=admin : 200 已删除
严格版（忽略 body 里的 role）: 403
```

第二行就是沦陷现场。**主体身份只能来自会话或服务端签发的凭证**；`X-Role`、`X-Tenant-Id` 这类约定头要么由网关注入并在入口剥离外部同名头，要么带签名。

**二，过度赋值（mass assignment）。** `PATCH /me` 写 `Object.assign(user, req.body)`，攻击者多塞一个 `"roles":["admin"]`，因为没被拒绝所以落库。修法是白名单 DTO，更好是**多余字段直接 400**——交给 schema 的 `additionalProperties: false`（实测见 [API 文档](/backend/api-docs)）。

**三，通配符与继承。** 给 `admin` 配 `doc:*`，之后新增 `doc:export` 它**自动获得**，没人审批过；继承链成环（`a→b→a`）会让展开函数死循环。规则：通配符下的新动作要对高权限角色单独评审，继承必须是 DAG。

顺带一个取舍：403 等于告诉攻击者「这条 id 真实存在，只是不归你」，配合可枚举 id 能把全量主键跑出来，所以**跨租户一律 404**，把「不存在」与「不归你」合成不可区分的答案；代价是排障变难，因此对外 404、对内日志记真实原因（响应结构见[统一错误处理](/backend/error-handling)）。

## RBAC 崩掉的地方：数据行级权限

`角色 → 权限码` 只能表达**动作能力**，而真实规则一半以上是**关于数据本身的谓词**：

| 需求 | RBAC 能表达吗 | 正确建模 |
| --- | --- | --- |
| 只能删自己的文档 | **不能** | 所有权谓词 |
| 只能看本区域订单 | **不能** | 数据范围（subject + resource 属性） |
| 金额过万要二级审批 | **不能** | 策略对象 / 审批流 |
| 手机号只对客服主管可见 | **不能** | 序列化层字段裁剪 |

一旦开始给 `role` 加 `data_scope`、`region` 列，你其实已在手写 ABAC，只是没有模型和工具。**收口做法是把「范围」做成显式可组合的东西，而不是散在各处的 `if`**：

```js
const scopeFor = (user) => {
  const base = { tenantId: user.tenantId };                       // 硬边界，任何角色不例外
  if (user.roles.includes('admin')) return base;
  if (user.roles.includes('intern')) return { ...base, ownerId: user.id };
  return { ...base, regionId: user.regionId };
};
```

**这个函数返回查询条件，不是布尔**：列表用它 `WHERE`，单条取回后用同一份条件做匹配。两处共用一份逻辑，否则必然漂移。字段裁剪交给响应 schema 白名单，别靠「service 返回整个对象、controller 里 `delete` 几个 key」（见 [Fastify 入门](/backend/fastify-basics)）。

## 多租户隔离：把条件写死在数据访问层

| 强度 | 做法 | 失败模式 | 成本 |
| --- | --- | --- | --- |
| 共享表 + `tenant_id` | 每表带租户列，查询强制加条件 | **一条 SQL 忘了带**（最常见，实测见下） | 低，靠机制不靠自觉 |
| 同库独立 schema | 连接时切 `search_path` | 迁移脚本漏跑某个 schema | 中 |
| 独立库 / 实例 | 每租户一套 | 连接池爆炸、大租户迁移停机 | 高，一般只给大客户 |

共享表路线上「忘带条件」必须被机制消灭：把 repository 实例与租户绑定，而不是每个方法多接一个参数。

```js
function ownerScopedRepo(user) {
  return {
    async find(id) { return docs.find((d) => d.id === id && d.tenantId === user.tenantId) ?? null; },
    async list() { return docs.filter((d) => d.tenantId === user.tenantId); },
  };
}
```

实跑：`repo.find("d-4")`（别家租户的 id）返回 `null`，`carol.repo.find("d-2")` 同样 `null`。**服务层拿不到别人的行，任何业务分支都不可能改到它**——这比在 30 个 `if` 里都记得写 `tenantId` 可靠。列表漏条件的后果用「只按 visibility 过滤」的版本跑了：

```text
漏掉 tenant 条件的 list 返回条数 : 3 → ["我的季度计划","团队公告","别家公司公开的活动页"]
带 tenant 条件的 list 返回条数   : 2 → ["我的季度计划","团队公告"]
carol(globex) 走漏版            : ["t-acme/团队公告","t-globex/别家公司的文档",…]
```

**这种泄露在功能测试里看不出来**：条数看着正常、字段正常，只有交叉验证能发现。ORM（Prisma / Drizzle）**没有「装上就自动隔离」的银弹**，能力以各自官方文档为准，本站未实测；数据库层方案见 [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rls.html)，本机无 PostgreSQL、未验证，且它有超级用户绕过、连接池复用会话变量导致串租户等真实陷阱。

最后一类被忽略的调用方是**定时任务与队列 worker**：没有 HTTP 请求就没有 `req.user`，`tenantId` 常是 `undefined`，条件退化成「不加条件」，一个夜间导出能把全租户扫一遍。修法是任务参数显式带租户，仓储层对空上下文直接抛错。

## 判定点放在哪一层，以及前端隐藏按钮不是权限

| 层 | 该做什么 | 失效模式 |
| --- | --- | --- |
| 中间件 / `preHandler` | 认证、粗粒度门槛 | 写成万能守卫后，所有人都以为「有中间件就安全」 |
| 路由入口（声明式） | **能力判定**：路由声明需要 `doc:delete`，由统一检查器执行 | handler 里各写 `if (role !== 'admin')`，漏一个破一个 |
| service | 业务规则型判定（审批、状态机） | 判定依赖调用方传对参数，漏传就绕过 |
| repository | **数据可见性**：租户与范围条件收口 | 忘带条件即全量泄露；带上就自动保护所有上层 |

分工结论：**能力判定尽量往上放**（越早拒绝越省资源），**可见性判定尽量往下放**（越靠近数据越不可能被绕过）。声明式写法的好处是**可枚举、可审计**——一条 `grep` 能列出所有路由及其权限需求，CI 里能断言「每条非 GET 路由都声明了权限」，散落 `if` 做不到。

```ts
app.delete('/docs/:id', {
  preHandler: [app.requireAuth, app.requirePermission('doc:delete')],
  handler: async (req) => { /* 这里的 repo 已经是 ownerScopedRepo(req.user) */ },
});
```

前端那一侧，bob 是 `viewer`，页面渲染删除按钮的文档集合实测是 `[]`，前端完全正确；直接发 `DELETE /docs/d-3` 得到 `403 角色 viewer 没有 doc:delete`。**这个 403 是后端给的，不是那个 `if` 给的**。前端做权限只有一个正当理由：别让用户点必然失败的按钮。两条约束：**权限码来自后端签发**（如 `/me` 返回 `permissions`），不是前端自己拼；**后端判定与前端展示规则相互独立**。浏览器里的 JS 全是可改的，**共享权限码常量可以，共享判定函数不行**——后者必然要读数据库里的资源。

<Callout type="verified" title="本章的状态码、条数与角色判定来自本机一次运行">

**环境**：Windows 10 x64、Node v25.4.0，2026-10-18。方法：用户 / 角色 / 权限码 / 资源放进内存数组（4 用户、3 角色、5 资源），用 `authorize()` 逐条打印；另构造「只查登录」`buggyRead`、「漏租户条件」`repoListLeaky`、客户端伪传 `roles` 的 `naiveHandler` 三组对照。临时脚本 `backend/.scratch/authz.mjs` 收工前已删除，正文贴的是可复现的函数原文。

**确认的结论**：只查登录的版本对 `d-2`（同事私有草稿）和 `d-4`（别家公司文档）都返回 200 并带出标题，换成三层判定后分别是 403 与 404；列表漏租户条件时 alice 从 2 条变 3 条；body 里伪传 `roles: ["admin"]` 让 `naiveHandler` 返回「200 已删除」。

**未验证部分**：没跑真实 HTTP 服务与浏览器（状态码是函数返回值，不是框架发出的）；数据库 RLS、ORM 全局作用域、跨租户压测均未在本机验证。

</Callout>

## 常见错误与排查

**1. 只挂认证中间件，没有资源级判定。** 现象：改 URL 里的 id 就能看别人数据，报告写「BOLA / IDOR，高危」。确认：`grep -c "req.user" src/routes/*.ts`，看有多少 handler 压根没引用当前用户。修：能力判定挂路由元数据，可见性收口到 repository。

**2. 只给列表加了过滤，单条接口忘了。** 现象：列表看不到，把 id 粘到详情 URL 就能看到。确认：分别用列表与 `/:id` 取同一份数据，比较可见集合。修：两者共用同一个 `scopeFor(user)` 条件对象，禁止各写一份 SQL。

**3. 用 401 返回「你不是所有者」。** 现象：前端拦截器见 401 就跳登录页，登录后又弹回来。确认：看响应体是认证失败还是授权失败。修：认证 401、授权 403、跨租户 404，语义以 [MDN HTTP 状态码](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status) 为准。

**4. `PATCH /me` 用 `Object.assign`，被塞进 `roles`。** 现象：某用户突然变 `admin` 且无操作日志。确认：给 body 多传一个未声明字段，看它是否落库。修：DTO 白名单 + `additionalProperties: false`。

**5. `UPDATE` 不带租户条件。** 现象：接口 200，别的租户记录被改了。原因：SELECT 漏条件是泄露，UPDATE / DELETE 漏条件是**数据破坏**，而没条件就没有「未命中」信号。确认：看影响行数是否恒为 1。修：条件带租户并断言 `rows === 0` 抛 NotFound（练习 3）。

**6. 判定加了括号，非 doc 权限全灭。** 现象：有人把 `a || b && c` 「为了可读性」改写成 `(a || b) && c`，之后 `user:manage` 谁都拿不到，而只覆盖 doc 的单测全绿。确认：打印展开后的权限码集合。修：判定函数单一职责，单测覆盖非 `doc:` 前缀的码。

**7. 权限码塞进长期 JWT，改权限不生效。** 现象：某人降级后仍能删数据，直到令牌自然过期。确认：改完权限立刻用旧 token 请求一次。修：令牌只放身份，权限每次查库或查短 TTL 缓存；必须放令牌就要有撤销机制，见 [JWT 与 OAuth](/backend/jwt-and-oauth)。

**8. worker 没有租户上下文，或内部调用靠约定头传身份。** 现象：夜间报表是全租户混合数据，或抛 `Cannot read properties of undefined (reading 'tenantId')`；把 `X-Tenant-Id` 改掉就读到别人数据。修：任务参数显式带 `tenantId`、仓储层对空上下文抛错；服务间走 mTLS / 签名。
## 练习

<Exercise title="练习 1 · 把判定顺序排对并给出状态码" difficulty="基础">

一条 `GET /api/docs/d-77` 携带过期 token，`d-77` 属于另一个租户。四步该怎么排？最终返回什么状态码、为什么？

```text
A. 检查 doc:read 能力   B. 认证 token   C. 取 d-77 比较 tenantId   D. 检查是否软删除
```

<template #answer>

**B → A → C/D 合并为一次可见性判定**，返回 **401**。B 必须最先：token 过期时主体都不成立，继续判断会把资源归属泄露给未认证调用方。401 意味着「换有效凭证再试」，客户端应走重新登录而不是提示无权限。

若 token 有效而 `d-77` 属于别的租户 → **404**，且响应体与「id 真的不存在」逐字节相同；若同租户但不是你的私有文档 → **403**。顺序排错的典型症状：先查能力再认证，未登录者能通过 403 与 404 的差异枚举出哪些 id 存在。

</template>

</Exercise>

<Exercise title="练习 2 · 找出这段 handler 里的三个越权" difficulty="基础">

```js
app.get('/api/orders/:id', { preHandler: [app.requireAuth] }, async (req) => {
  const order = await orderRepo.findById(req.params.id);
  if (!order) return reply.notFound();
  if (req.user.roles.includes('admin')) return order;
  if (order.userId !== req.user.id) throw app.httpErrors.forbidden();
  return order;
});
```

列出三个问题，并说明每个的攻击方式。

<template #answer>

**① `reply` 未定义。** handler 签名没接 `reply`，调用它抛 `ReferenceError`，客户端拿 500 而不是 404。修：参数写 `(req, reply)`，或直接 `throw` 交给统一错误处理器。

**② 没有租户条件，`admin` 分支跨租户生效。** globex 的管理员能读 acme 的订单，因为判定只看角色不看归属——对应实测里 `u-carol doc:read d-1 → 404` 那一层。修：`findById` 内部就带 `tenantId`，租户边界**先于**角色分支。

**③ 判定写在 handler 里、角色名硬编码。** 列表接口与它是两份代码，改一处忘一处；角色改名即失效。修：能力判定（`order:read`）挂路由元数据，归属与租户收口到 repository。

补一点：`order.userId !== req.user.id` 对「客服查看用户订单」是错的，那属于数据范围需求，应由 `scopeFor(user)` 表达而不是所有者相等。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误：一条不带条件的 UPDATE" difficulty="进阶">

```js
app.patch('/orders/:id', { preHandler: [app.requireAuth] }, async (req) => {
  await db.exec('UPDATE orders SET status = $1 WHERE id = $2', [req.body.status, req.params.id]);
  return { ok: true };
});
```

① 说明攻击链与它在日志里的表现；② 为什么这类 bug 比泄露型更难发现；③ 给出修复版本，说明「影响行数」起什么作用。

<template #answer>

**① 攻击链**：任何登录用户把 `id` 换成别人的订单号——SQL 里没有归属或租户条件，数据库照改，接口返回 `{ ok: true }`，**HTTP 层 200，业务层已完成越权写入**。日志表现是「一条极其正常的 PATCH + 200」，认证、错误率、慢查询指标全部正常，只有客户投诉「我的订单状态被人改回去了」才会暴露；审计字段没记 `updated_by` 的话，连是谁改的都不知道。

**② 为什么比泄露型难发现**：读越权的证据是「多返回了数据」，写越权的证据是「一次成功」，不产生异常信号。更糟的是 `UPDATE ... WHERE id=$1` 没命中任何行也返回「成功，影响 0 行」，驱动不当它是错误——**没有归属条件就失去了唯一的自检手段**。

**③ 修复**：

```js
const rows = await db.exec(
  'UPDATE orders SET status = $1, updated_by = $3 WHERE id = $2 AND tenant_id = $4 AND deleted_at IS NULL',
  [status, id, ctx.userId, ctx.tenantId],
);
if (rows === 0) throw new NotFoundError();   // 条件没命中 = 不可见，与「不存在」同码
```

影响行数是**唯一的服务端自检**：带上 `tenant_id` 后跨租户请求命中 0 行，于是抛错返回 404（与存在性隐藏策略一致），同时 `updated_by` 让事故可回溯。条件要从 `ctx` 统一构造，不要在每条 SQL 里手写。

</template>

</Exercise>

<Exercise title="练习 4 · 把「可见集合」写成 CI 断言" difficulty="挑战">

为「文档属于租户 + 属于所有者 + 有 public/private 可见性」的资源设计越权测试矩阵：给出主体、动作、资源三个维度与期望状态码规律，并解释「列表与单条的可见集合必须相等」这条断言为什么值钱。

<template #answer>

**维度**：主体 4 类（同租户所有者 / 同租户同角色非所有者 / 同租户 admin / 跨租户任意角色）；动作 5 个（单条 `GET`、`LIST`、`POST`、`PATCH`、`DELETE`）；资源 4 份（自己私有、别人私有、别人公开、别租户）。参数化成 4 角色 × 4 资源，内存 repository 就够，秒级跑完——本章实测那张判定表就是它的一个切片。

**期望值记三条不变式**：① 能力不满足 → **403**，与资源无关；② 跨租户 → **404**，响应体与「id 不存在」完全相同；③ 同租户但不在范围内 → 读写都 **403**。创建动作例外：不针对已有资源，只需能力判定 + 服务端强制 `tenantId = user.tenantId`，**永不接受客户端传来的 tenantId**。

```js
const listed = (await repo.list(user)).map((d) => d.id).sort();
for (const id of allDocIds) {
  const r = await readAs(user, id);
  assert((r.status === 200) === listed.includes(id));
}
```

值钱有三个理由：**① 它是自动生成的**，不需要有人记得给新接口写越权用例——列表的 `WHERE` 就是「授权策略的真相」，单条接口与它不一致，要么多给（越权）要么少给（功能 bug）；**② 它双向覆盖了第 2 条错误**（只给单条加判定）和它的反面；**③ 它天然把租户、所有权、可见性、软删除四个条件一起卷进来**。契约测试在实现层的另一种写法见 [API 文档](/backend/api-docs)。

</template>

</Exercise>

## 官方文档与延伸阅读

- [OWASP Top 10](https://owasp.org/www-project-top-ten/) —— 核实「越权访问（Broken Access Control）」在现行清单中的条目，本章「只做认证不做授权」属于最主流风险类别的依据。
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) —— 核实访问控制通则：**默认拒绝、拒绝优先于允许、判定必须在服务端、白名单优于黑名单**。
- [MDN HTTP 响应状态码](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status) —— 核实 401 / 403 / 404 定义差异，即「401 意味着换凭证就能成功」「跨租户用 404 隐藏存在性」的依据。
- [PostgreSQL 行级安全策略](https://www.postgresql.org/docs/current/ddl-rls.html) —— 多租户「数据库层强制」的官方入口；**本章未在本机实测**。
- [Fastify 钩子文档](https://fastify.dev/docs/latest/Reference/Hooks/) —— 核实 `preHandler` 的执行时机，确认「能力判定挂路由入口」早于 handler。
- 站内：[认证](/backend/auth-session)（可信 `req.user` 从哪来）、[统一错误处理](/backend/error-handling)（403 / 404 响应体）、[分层架构](/backend/layered-architecture)（判定位置的载体）、[JWT 与 OAuth](/backend/jwt-and-oauth)、[Web 安全](/backend/web-security)、[阶段项目](/backend/project)（验收标准里「访问不属于自己的资源返回 403」就是本章）。

## 下一章

结论压成两句：**「你是谁」与「这条能不能给你」是两次判定，缺一不可**；**能力判定尽量上移到路由入口，可见性判定尽量下移到数据访问层**。而支撑判定的凭证本身也有坑——无状态令牌一签发就撤不掉，`alg: none` 与 RS/HS 混淆能让伪造令牌通过校验，第三方登录的授权码在浏览器里会被截。下一章 [JWT 与 OAuth](/backend/jwt-and-oauth) 把令牌拆成三段 base64url，逐条实跑签名篡改后的真实报错，并给出 `localStorage` 与 `HttpOnly` Cookie 的取舍。
