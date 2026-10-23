# Prisma 深入：把 `include` 当成一份 SQL 计划来读，把事务回调当成一段会被重跑的代码来写

列表接口在线上是 800ms，本地 30ms。你在本地复现不出来，直到把日志里翻出来的语句条了个数：**41 条 SELECT**——1 条查用户，40 条查每个用户的帖子。这不是 Prisma 的 bug，这是 `include` 与「循环里再查一次」两种写法长得很像、代价差一百倍的现场。

第二个现场反过来：你为了「只查一次」把关系全 `include` 上，接口从 800ms 变成 2s。原因是你要的只是帖子标题，Prisma 忠实地把每张表的**所有列**都取了回来，还带上了嵌套三层的对象图。列表页只需要 20 条摘要，你传了 4MB JSON。

第三个现场在事务里。业务代码是这样写的：`db.transaction(async (tx) => { 写库; await 调用外部支付接口; 再写库 })`。外部接口一抖，事务持有时间从 5ms 变成 5s，连接池里的连接被占干，其他请求全部排队。报错文本你甚至看不懂：`Transaction not opened or expired`。

第四个现场最隐蔽：事务回调里有一行写成 `await db.order.create(...)` 而不是 `await tx.order.create(...)`。代码照常运行，测试也过——因为那行**跑在事务之外**。回滚的时候它不回滚。

<Callout type="verified" title="本章实测了什么、没实测什么">

环境：Windows + Node v25.4.0，真库用 `node:sqlite`（脚本 `data-storage/.scratch/ds-prisma-rel.mjs`，日期 2026-10-19）。**本机没有安装 `prisma` 或 `@prisma/client`，本章没有运行过一行 Prisma 代码**，也没有连过 PostgreSQL。

所以本章的实测只覆盖一件事：Prisma 那些 API 所包装的**数据库语义**——关系查询的语句条数与 JOIN 扇出、外键与嵌套写入的顺序、`ON CONFLICT` 的实际行为、两个真连接句柄互相抢锁时的报错原文、事务回滚管不住哪些东西。这些是 R1–R6 的真输出。

Prisma 侧的 API 名、默认值、版本差异一律标为「以官方文档当前版本为准」，其中关键几句是 2026-10-19 从官方事务页面抓取的原文引述，见「事务」一节。

</Callout>

## 关系查询的三条路：Prisma 选的是一条父查询加一条批量子查询

同一个需求「取用户 1 的帖子以及每篇的标签」，在 SQL 层只有三种形状。三种都在真库上跑过，语句条数、返回行数、拼出来的对象图一起打了出来：

```text
=== R1 三种关系加载形状：语句条数 / 返回行数 / 拼出来的对象图 ===
{
 "n_plus_1":  { "stmts": 3, "rows": 7, "out": ["第一篇:sql/cache/orm", "第二篇:sql/cache"] },
 "batched":   { "stmts": 2, "rows": 7, "out": ["第一篇:sql/cache/orm", "第二篇:sql/cache"] },
 "join_one":  { "stmts": 1, "rows": 5, "out": ["第一篇→sql", "第一篇→cache", "第一篇→orm", "第二篇→sql", "第二篇→cache"] }
}
JOIN 那条：5 行里只有 2 个 post，父字段重复 3 次
```

读这张表要读出三层意思：

| 形状 | 语句数 | 网络往返 | 行的形状 | 谁在拼对象图 |
| --- | --- | --- | --- | --- |
| 循环里逐条查（N+1） | 1 + N | 1 + N 次 | 干净的父行 + 子行 | 你的代码 |
| 一条父查询 + 一条 `IN` 批量 | 2 | 2 次 | 父行 + 带父 id 的子行 | 客户端库（或你） |
| 一条 JOIN 全带回 | 1 | 1 次 | **行被乘过**，父字段重复 | 客户端库（或你） |

**Prisma 的关系查询走的是中间那条**：一条父查询、一条按外键批量取子记录的查询。这不是实现偷懒，是因为 JOIN 那条路有两个真代价。第一个是上面实测到的扇出：5 行只对应 2 个 post，父字段重复了 3 次；帖子有 20 个标签就是 20 倍重复，正文这种大字段被重复传输 20 次。第二个是分页语义被破坏：

```text
=== R2 多对多 JOIN 的计数陷阱：COUNT(*) 数的是行还是资源 ===
{"join_rows":6,"distinct_posts":3,"posts_total":3}
```

`LIMIT 2` 加在 JOIN 后面，数的是**行**，不是资源。你想取 2 篇帖子，JOIN 之后可能只剩 0.7 篇完整帖子。这就是为什么关系数据库的分页不能在带扇出的 JOIN 上做——[数据库领域第 12 章](/database/data-access-design)把这一点实测成「20 行只覆盖 11 个资源」。

于是 Prisma 用两条语句换来干净的形状：父行不受子记录数量影响，`take`/`skip` 数的就是资源数。代价是**多对多的过滤条件不能指望一条 JOIN 搞定**，得靠关系过滤器（见下一节）。

顺带一个真库上的替代形状，写原生 SQL 时能一行解决扇出：

```sql
SELECT p.title, GROUP_CONCAT(t.label) AS labels
FROM posts p
JOIN post_tags pt ON pt.post_id = p.id
JOIN tags t ON t.id = pt.tag_id
GROUP BY p.id;
```

实测返回 3 行，每行一个帖子，标签拼成一个字符串：`第一篇 → "sql,cache,orm"`。行数等于资源数，扇出被 `GROUP BY` 收掉了。PostgreSQL 里的对应写法是 `string_agg(t.label, ',')`（未在本机验证，语法以官方文档为准）。

## `include` 与 `select`：把「带回什么」写明白

这一节开始是 Prisma API 层。本机没装，写法与选项**以官方文档当前版本为准**，下面的代码块是「你项目里大概长这样」的形态，不是本章跑过的东西。

```ts
// 预期形态，未在本机运行
// (a) 只想要摘要：收窄到三个字段，不带关系
const list = await db.post.findMany({
  where: { authorId: 1 },
  select: { id: true, title: true, createdAt: true },
  take: 20,
});

// (b) 要关系，但关系里也要收窄 + 只要计数
const detail = await db.user.findUnique({
  where: { id: 1 },
  select: {
    name: true,
    posts: { select: { title: true }, take: 5, orderBy: { createdAt: 'desc' } },
    _count: { select: { posts: true } },
  },
});

// (c) 全量 include：把整棵树搬回来，别用在列表页
const heavy = await db.user.findUnique({ where: { id: 1 }, include: { posts: true } });
```

三条的差别不是「方便程度」，是**传输字节数与列裁剪**。判据很简单，把它当成 SQL 计划来读：

- `select` 决定 `SELECT` 后面跟哪些列，也决定服务端要不要拼那个对象图。
- `include: true` 等于「这张表所有列」——你无法在里面裁剪，只能换成嵌套 `select`。
- 关系里的 `take` / `where` / `orderBy` 是**子查询上的限制**，它不影响父查询的行数（这条与 R2 的扇出是同一件事的两面：正因为不靠 JOIN，父行数才不受影响）。
- 需要「只要有关联记录的父记录」时，`include` 里的过滤不够，要用顶层 `where` 上的关系过滤器（`some` / `every` / `none`）。理由回到 R1：过滤发生在哪条语句上，决定了它筛的是父还是子。

<Callout type="unverified" title="这三处要在你自己的项目里核实，别照抄本章">

一、`include` / `select` / `_count` / `omit` 在你的 Prisma 版本里各自支持哪些嵌套参数；二、PrismaClient 构造函数的 `log: ['query']` 之类日志开关的当前拼法；三、`findMany` 的关系过滤是否支持你需要的谓词。

**核实方法（这三条都能在本机完成）**：装好依赖后跑一次 `npx prisma generate`，然后打开查询日志，用 `(a)` 与 `(c)` 各打一次同一个接口，数日志里的语句条数和返回列数。本章没有这些环境，所以只给你验证路径，不给结论。

</Callout>

## 嵌套写入：一次请求写三张表，顺序和外键是数据库说了算

创建用户同时创建他的帖子，Prisma 提供嵌套 `create` 与 `connect` 两种写法（形态预期，未在本机运行）：

```ts
// 预期形态：嵌套 create，同一个事务里先父后子
const created = await db.user.create({
  data: {
    name: '阿力',
    posts: { create: [{ title: '第一篇' }, { title: '第二篇' }] },
  },
});

// 另一种：把已存在的帖子连过来，不新建
await db.user.update({ where: { id: 1 }, data: { posts: { connect: [{ id: 10 }] } } });
```

真正兜住「不许写出孤儿行」的不是 ORM，是库里的外键约束。这一步我在真库上量过：

```text
=== R3 外键：嵌套写入「先父后子」的顺序问题与孤儿行 ===
node:sqlite 新建连接读到的 PRAGMA foreign_keys = {"foreign_keys":1}
FK=OFF 时插入 user_id=999 的帖子：changes=1（不报错，库里留下孤儿行）
孤儿行=[{"id":99,"user_id":999}]
FK=ON 时同一条插入的报错原文：FOREIGN KEY constraint failed
```

三个结论要分开拿：

1. **约束在库里，类型层看不见。** 表定义里没写 `REFERENCES` 时，`PRAGMA foreign_keys = ON` 也拦不住——本机的第一次尝试就是因为建表没声明外键，开关形同虚设。迁移里漏掉 `references`，ORM 层的 `required` 关系再怎么写都白搭（这跟[第 8 章 迁移](/database/migrations)是同一类漏洞）。
2. **这个开关是连接级的**，SQLite 官方默认关闭，而 `node:sqlite` 给自己的连接默认开到 1。换句话说：**别拿别的驱动的默认值当你的默认值**。PostgreSQL 侧的外键是 always-on，没有这个开关（未在本机验证，以官方文档为准）。
3. **报错原文长这样**：`FOREIGN KEY constraint failed`。看到它，方向不是「ORM 写错了」，而是「嵌套写入的父子顺序被打乱了，或者你传了一个不存在的 id」。

多对多的中间表写入同理：先确保两端都提交，再插中间表。顺序写反在 FK 打开时就是那句报错。

## `upsert` 与 `skipDuplicates` 落到 SQL 上是两条原语

`upsert` 听起来像「有则更新、无则插入」的业务动作，实际是数据库的一条冲突处理语句。真库上这两条都跑过：

```text
=== R4 upsert / skipDuplicates 底下的两条 SQL 原语 ===
INSERT OR IGNORE 撞已有主键：changes=0 库里 a={"v":1}
ON CONFLICT DO UPDATE 带 v<新值 守卫，用更小的 0 覆盖：changes=0 库里 a={"v":1}
同一条用更大的 5：changes=1 库里 a={"v":5}
```

值得带走的是中间那行：**冲突更新可以带守卫条件**。`ON CONFLICT(k) DO UPDATE SET v=excluded.v WHERE kv.v < excluded.v` 让「更小的值覆盖不了更大的值」——这和[第 9 章](/data-storage/distributed-lock)里挡住过期写的 `WHERE last_token < ?` 是**同一个模式**：把并发裁决下推到一条语句里，靠受影响行数（`changes`）判断自己赢没赢，而不是先读后写。

`createMany({ skipDuplicates: true })` 在 SQL 层对应的就是第一行的「撞了就跳过、`changes` 变小」形态（Prisma 侧的具体映射未在本机验证）。用它做批量导入时，**别把返回值当「插入条数」的日志口径**，先看你的驱动返回的是行数还是影响行数。

## 事务：v8 只剩 `db.transaction(async (tx) => …)`，旧的 `$transaction` 不在了

这是本章最需要「按版本核对」的一节。2026-10-19 抓取的 Prisma 官方事务页面里有几句原文值得逐字记住：

> Prisma ORM 8 has no `$transaction`, so both of the Prisma ORM 7 forms become `db.transaction(async (tx) => ...)`. The interactive form maps one for one: rename the method and query through `tx`.

> There are no `isolationLevel`, `timeout`, or `maxWait` options.

> Prisma ORM does not retry write conflicts for you, so write the retry yourself around the `db.transaction(...)` call.

三条分别对应三类事故：**照抄旧教程**（`$transaction([...])` 的数组形式在新版本里没有对应物了）、**以为能设隔离级别**（选项不存在，隔离级别回到数据库自己的配置）、**以为库会替你重试**（不会，重试循环得你自己写）。本站[数据库领域第 12 章](/database/data-access-design)写的时候用的还是「`db.transaction()`（文档当前写法；历史版本里也写作 `$transaction`）」这个口径，现在官方已经把话说明白了。

（这些引述来自抓取工具返回的页面文本，我没有逐字比对源码；动手前以该页当前版本复核。抓取日期 2026-10-19。）

## 「不会替你重试」是什么意思：两个真连接抢锁的报错原文

ORM 不重试，那写冲突到底长什么样？我没法在没有 Prisma 的情况下给你 Prisma 的报错，但我能在真库上把**那个需要被重试的瞬间**演出来——同一个数据库文件，开两个真连接句柄：

```text
=== R5 交互式事务的重试形状：文件库 + 两个真连接句柄 ===
A 持写锁未提交，B 立刻 BEGIN IMMEDIATE（busy_timeout=0）报错原文：database is locked
B 带 busy_timeout=60 重试：仍失败(database is locked) 耗时 114ms（A 的锁还没放，所以等满就报错）
A 回滚后 B 再试：成功；库里行数=0
WAL 下 A 读到快照(0 行)→B 提交 1 行→A 再写的报错原文：database is locked | errcode=517 errstr=database is locked code=ERR_SQLITE_ERROR
整段重试第 1 次成功，库里=[{"id":7,"v":70},{"id":8,"v":80}]
```

`errcode=517` 是关键的那个数字：它是 SQLite 的 `SQLITE_BUSY_SNAPSHOT`——**你事务开始时拿到的读快照已经被别人的提交推进了，你的写不能建立在这个过期快照上**。这正是「序列化失败」的形状，也是 PostgreSQL 文档里那句「applications using these levels must be prepared to retry transactions that fail due to serialization errors」说的同一件事（SQLSTATE `40001`，原文见延伸阅读）。

于是重试代码的正确形状是这样的——注意重试的单位是**整段回调**，不是最后那条失败的语句：

```ts
// 结构示意：数据库层的重试（Prisma 侧拼写按你的版本核对，本章未运行）
async function withRetry<T>(fn: (tx: Tx) => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await db.transaction(async (tx) => fn(tx));   // 每次都从新的快照重来
    } catch (e) {
      last = e;
      if (!isConflict(e)) throw e;                          // 只重冲突，别把业务错误也重试
      await sleep(2 ** i * 20 + Math.random() * 20);        // 指数退避 + 抖动
    }
  }
  throw last;
}
```

`isConflict` 要按错误码写，不能按 `message.includes('locked')` 写。SQLite 侧是 `5`（普通 BUSY）与 `517`（BUSY_SNAPSHOT）两个码（本机实测到的是 517 这一支；`busy_timeout=0` 时那条也是 `database is locked` 文本，我没有逐条区分它的 errcode——想确认就在 catch 里打印 `e.errcode`），PostgreSQL 侧是 SQLSTATE `40001`。

还有一个必须区分的东西：**`busy_timeout` 的等待不是重试**。R5 第二行显示，`busy_timeout=60` 让 B 结结实实等了 114ms 然后照样失败。等待只是把冲突推迟，冲突本身没有被解决；等满之后的那次失败仍然需要重试循环来兜。

## 回调里只做数据库的事：官方列的两个错误，我都能在真库上复现

那个页面里有两个小节的标题就是事故清单：**Side effects inside the callback** 和 **Querying through db instead of tx**。第二个不需要实验就能理解——`db` 上的调用不在事务上下文里，回滚不带走它。第一个的代价我先量出来：

```text
=== R6 「回调可能被重跑」+ 非事务副作用 = 重复的缓存失效 / 重复的日志 ===
回调执行次数=2 库里余额={"bal":70}（只扣了一次） 但缓存失效动作发了 2 次
```

（这段的失败那一轮是我在脚本里**强制回滚**模拟的，真实系统里它由 `SQLITE_BUSY` / `40001` 触发；数据库侧的 BEGIN/UPDATE/ROLLBACK 都是真库执行，只有「第一次失败」这个事件是模拟的。）

把它和上一节连起来读，就得到本章最实用的一条规则：**事务回调必须可重入**。因为一旦你按官方建议自己写了重试循环，回调就会执行多次，而回滚只回滚数据库。回调体里这几类东西都是副作用，都会翻倍：

- 缓存失效、消息队列投递、埋点与日志计数；
- 「读一个自增值再写回去」这类不是相对更新而是绝对赋值的写法；
- 外部 HTTP（支付、发信）——它不仅翻倍，还会把事务持有时间拖成秒级，进而把连接池拖死，那是下一章的正题。

安全的放法：回调体内只做数据库读写，把「提交成功后才做的事」收集到一个数组里，等 `db.transaction(...)` 返回之后再执行。

```ts
// 结构示意：提交之后才发生的副作用
const afterCommit: Array<() => void> = [];
await db.transaction(async (tx) => {
  await tx.account.update({ where: { id: 'x' }, data: { bal: { decrement: 30 } } }); // 相对更新
  afterCommit.push(() => invalidate('acc:x'));
});
afterCommit.forEach((f) => f());   // 重试时前面的会被丢弃：只有最后一次事务的提交会走到这里
```

`data: { bal: { decrement: 30 } }` 这种**相对更新**写法也值得单独说一句：它把读-改-写下推成一条 `UPDATE ... SET bal = bal - 30`，从根上避免了[丢失更新](/database/transactions)——不用事务也不会丢，不需要锁，也不怕回调重跑。能写成相对更新的地方就别先读后写。

## 把「接口慢」归因到具体一条语句

顺序固定下来，不要一上来就改代码：

```text
接口 800ms
  ├─ 1. 数语句条数：日志里同一个请求有几条 SELECT？
  │      1 条父 + N 条子 → 就是 R1 的 n_plus_1，改成一次关系查询
  ├─ 2. 看每条的返回列数与行数：是不是 include 把整棵树搬回来了？
  │      列多行少 → 换 select 收窄；行多列少 → 看是不是扇出（R2）
  ├─ 3. 单条语句慢：把它的 SQL 抄出来跑执行计划
  │      SCAN → 索引问题，去 /database/indexes；索引有了还慢 → 去本章第 12 章
  ├─ 4. 每条都不慢但总时长长：网络往返次数 × 延迟，或连接在排队 → /data-storage/connection-pool-and-slow-query
  └─ 5. 事务持有时长：日志里 BEGIN 与 COMMIT 之间的间隔，中间夹了外部调用就是它
```

第 5 条最常被漏掉。连接池的排队时间表现为「所有接口一起变慢」，而罪魁祸首是那一个在事务里等外部的接口。

## 常见错误与排查

**1. 事务回调里用了 `db` 而不是 `tx`。** 现象：测试里事务成功、报错时数据却留下了；`tx` 与 `db` 混着用，代码还能编译（两者接口形状一样）。确认：全局搜回调体里的 `db.`，一个都不该有。修：回调参数往下传，helper 函数的签名收 `tx`，不要让它自己去拿客户端单例。

**2. 在事务里等外部服务。** 现象：偶发的整体变慢、连接池告警、`Transaction not opened or expired` 一类超时错。确认：把 BEGIN 与 COMMIT 的时间戳差值打出来（本机测过 SQLite 侧的等待形态：`busy_timeout=60` 会真等满 114ms 才报错，R5 第 2 行）。修：外部调用挪到事务外；必须做就先落一条「待处理」记录，事务提交后由队列驱动。

**3. 指望 ORM 重试写冲突。** 现象：并发下偶发 `database is locked` / `serialization failure`，业务侧直接 500。确认：官方原文写着 `Prisma ORM does not retry write conflicts for you`；本机实测到冲突码是 517。修：自己写重试循环（整段回调重跑），并且只重试冲突类错误码。

**4. 回调不可重入。** 现象：加了重试之后缓存失效做两次、消息发两条、计数翻倍。确认：在回调第一行加一个计数器，压测并发看它是否 > 1；R6 就是这个形状（库里一次、副作用两次）。修：回调体内零副作用，副作用收集到数组在提交后执行；能用相对更新就别先读后写。

**5. 复制旧版本的事务写法。** 现象：`$transaction` 在 v8 里找不到、或者数组形式带 `isolationLevel` 的选项报错。确认：`npx prisma -v` 看版本，官方页面有 "Coming from Prisma ORM 7" 一节专门讲迁移。修：统一成 `db.transaction(async (tx) => ...)`，隔离级别回到数据库配置（`timeout`/`maxWait` 这类选项在新版本不存在，别指望用它们调超时）。

**6. `include: true` 用在列表页。** 现象：接口 JSON 体积异常大、数据库 `SELECT` 列数远超前端所需。确认：数一次响应的字段数与页面实际用到的字段数。修：列表页一律 `select` 白名单；详情才用关系；只要个数的用计数而不是把子记录全取回来。

**7. 表定义里没有真外键。** 现象：`upsert` / 嵌套写入报 `FOREIGN KEY constraint failed`，或者更糟——**不报错但留下孤儿行**。确认：R3 的对照，`PRAGMA foreign_keys` 读到 1 也没用，因为建表时没写 `REFERENCES`。修：把外键写进迁移（[第 8 章 迁移](/database/migrations)），别只在 ORM schema 里声明关系。

## 练习

<Exercise title="练习 1 · 复算 R1 与 R2 的两张表" difficulty="基础">

R1 里 `n_plus_1` 是 3 条语句、7 行；`join_one` 是 1 条语句、5 行。回答：(1) 7 行是怎么由「2 篇帖子 + 5 个标签关联」组成的？(2) 如果用户 1 有 30 篇帖子、每篇 3 个标签，三种形状各是多少条语句、多少行？(3) 为什么 R2 里 `join_rows=6` 但 `distinct_posts=3`？

<template #answer>

(1) 2 条父行 + 5 条子行（第一篇 3 个标签 + 第二篇 2 个标签）= 7。(2) N+1 = 1 + 30 = 31 条语句，行数 30 + 90 = 120；批量 = 2 条语句，行数同样是 120（父 30 + 子 90）；JOIN = 1 条语句但 90 行，父字段重复 90 − 30 = 60 次。注意批量与 N+1 的**行数相同、语句数差 15 倍**——省的是往返，不是数据量。(3) 每篇帖子有几个标签就在 JOIN 结果里出现几行，`COUNT(*)` 数的是行；要数资源得 `COUNT(DISTINCT p.id)`（R2 实测这两个数分别是 6 和 3，`posts_total` 也是 3，说明 DISTINCT 那条才是「帖子数」）。

</template>

</Exercise>

<Exercise title="练习 2 · 故意写出一个不回滚的写" difficulty="挑战">

在你自己的项目里（装了 Prisma 的环境，本章没有）构造这样一段代码：事务回调里**一行**用 `tx`、另一行用 `db`，然后让 `tx` 那行故意违反约束触发回滚。回答：(1) 库里两张表分别是什么状态？(2) 报错原文里能看到约束名吗？(3) 为什么类型检查不会帮你发现 `db` 与 `tx` 的区别？

<template #answer>

(1) 用 `tx` 的那张表没有变化（回滚生效），用 `db` 的那张表**留下了写入**——它跑在事务之外。这就是官方 "Querying through db instead of tx" 那条错误的现场。(2) 约束违例的报错会带约束名或字段列表，形如 PostgreSQL 的 `violates foreign key constraint "posts_user_id_fkey"`；SQLite 侧我在真库上读到的是 `FOREIGN KEY constraint failed`（R3 原文，不带约束名）。把报错原文贴进 issue，别只写「保存失败」。(3) 因为 `tx` 与 `db` 暴露的模型代理接口形状一致，`PrismaClient` 与 `TransactionClient` 类型互相兼容到「你能用错」的程度——只有约束名和「回滚后数据还在」这两个运行时事实会告诉你。**判据**：回调体内 grep `db.` 应该零命中。

</template>

</Exercise>

<Exercise title="练习 3 · 给重试循环定边界" difficulty="进阶">

你按本章写了重试循环，`tries = 3`。已知：单次事务的数据库操作耗时 8ms，外部 HTTP 已从回调里挪走，冲突概率在压测下约 20%。回答：(1) 最坏情况下这一个请求占用连接多久（只算数据库时间）？(2) 退避为什么必须带抖动，不带抖动会怎样？(3) 哪些错误绝对不该进重试分支，给出两条。

<template #answer>

(1) 3 次尝试 × 8ms = 24ms 的数据库工作时间，但**每次尝试都要先从池里借一条连接**，所以它对池的压力是三份占用时间；再叠加 `busy_timeout` 这类等待（本机实测 60ms 的 timeout 真等了 114ms），最坏情况的墙钟时间可以远大于 24ms——这正是 R5 第二行想让你看到的「等待不等于解决」。(2) 3 次同步重试会让同一批冲突请求在完全相同的时刻再撞一次，形成重试风暴；`2 ** i * 20 + Math.random() * 20` 把重试时刻打散（和[第 8 章](/data-storage/session-rate-limit-idempotency)限流后的退避抖动是同一个理由）。(3) 不该重试的：唯一约束冲突这类**业务性**失败（重试一万次还是冲突）、外键缺失导致的孤儿写入（数据本身就是错的）、连接不可用/认证失败这类环境错误。判据是错误码而不是文本，SQLite 侧只针对 5 / 517 这一类 BUSY 家族，PostgreSQL 侧针对 SQLSTATE `40001`（以及文档提示需要额外小心区分的那几个码）。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Prisma 文档 · Transactions and batch queries](https://www.prisma.io/docs/orm/prisma-client/queries/transactions) —— 本章三句原文引述（v8 没有 `$transaction`、没有 `isolationLevel`/`timeout`/`maxWait` 选项、不替你重试写冲突）以及 "Side effects inside the callback" / "Querying through db instead of tx" 两个常见错误小节都出自这一页，抓取日期 2026-10-19。**它核实的是「事务 API 的形状与重试责任归属」，不是任何性能数字。**
- [Prisma 文档 · 关系查询入口（Prisma Client Queries）](https://www.prisma.io/docs/orm/prisma-client) —— 从这里进 `include` / `select` / 关系过滤器的当前写法，用于核实「`include` 与 `select`」一节里被标为预期的代码形态。
- [Prisma 仓库（github.com/prisma/prisma）](https://github.com/prisma/prisma) —— 想确认某个版本到底有没有 `$transaction`，看该 tag 下的文档与 changelog，比看博客可靠。
- [PostgreSQL 文档 · 13.5 Serialization Failure Handling](https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html) —— 核实「使用这些隔离级别的应用必须准备好重试因序列化错误失败的事务」以及错误码恒为 SQLSTATE `40001`，对应「整段回调重试」一节。
- [node:sqlite 文档（Node.js API）](https://nodejs.org/api/sqlite.html) —— 核实本章实测用的 `DatabaseSync`、`prepare`/`get`/`run` 与错误对象上的 `errcode` 字段，R5 的 517 就是这么读出来的。
- 站内：[数据访问设计：N+1、分页与抽象泄露](/database/data-access-design)（本章把它的「条数」话题下推到 Prisma 的具体 API）、[事务与并发](/database/transactions)（丢失更新与 `SQLITE_BUSY` 的完整谱系）、[索引与执行计划](/database/indexes)、[分布式锁及其陷阱](/data-storage/distributed-lock)（`ON CONFLICT ... WHERE` 与 fencing token 同源）、[连接池与慢查询定位](/data-storage/connection-pool-and-slow-query)（事务持有时长如何压垮池）。

## 下一章

本章把 Prisma 的三件事讲成了数据库语义：关系查询为什么是「一条父 + 一条批量」而不是「一条大 JOIN」（R1/R2 的扇出与计数）、外键与嵌套写入的顺序谁来兜（R3 的 `FOREIGN KEY constraint failed`）、事务回调为什么必须可重入（R5 的 errcode 517 加 R6 的两次副作用）。但 ORM 只覆盖你能被它表达的那部分需求：窗口函数、`LATERAL`、执行计划层面的写法、以及「我就是知道更好的 SQL」的时刻，你得绕开它——而绕开它的那一刻，前面几节里所有类型层的保护都会同时消失。下一章正面讲这条边界：[原始 SQL、Drizzle 对照与类型安全的边界](/data-storage/raw-sql-and-drizzle)，那里有 tsc 真实拦下来的 5 条报错，也有它一声不响放过去的 4 种写法。
