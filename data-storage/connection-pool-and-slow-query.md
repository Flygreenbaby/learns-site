# 连接池与慢查询定位：一条连接占 40 毫秒时，池大小就是你的吞吐上限

第一现场：所有接口一起变慢。不是某个接口，是全部——连 `/health` 都要 2 秒。监控里数据库的 CPU 是 8%，慢查询日志一条没有。真正的答案在应用侧：**连接池里 10 条连接全部被借走且没归还**，第 11 个请求正在排队。它表现为「数据库慢」，其实是「数据库被排队」。

第二现场：一个新加的报表接口，把 200 毫秒的数据库查询和 3 秒的第三方 HTTP 调用写在同一个事务里。上线后本地一切正常，生产上每隔几分钟出现一次全体超时。原因是那条连接被占住 3.2 秒：10 条连接的池，理论吞吐上限就是 10 ÷ 3.2 ≈ 3 请求/秒。这不是猜测，本章 P2 用真定时器量过「占用时长 ÷ 池大小 = 等待时间」这条曲线。

第三现场：测试库 300 行，查询 1ms；生产库 480 万行，12 秒。你以为是索引问题，加完索引 p50 从 12 秒变 8 秒，p99 反而更差。真相是那条查询要扫 480 万行**再排序**，加索引只解决了过滤，排序还是全量。执行计划没读过的人看不出来。

第四现场最贵：`log_min_duration_statement = 0`。有人为了让慢查询「都记下来」把它设成 0，于是每条 SQL 的文本和耗时都进日志，高并发实例上磁盘 I/O 直接压过了查询本身。PostgreSQL 官方文档对这一类开关有一句话："Like all statement-logging options, this option can add significant overhead."（2026-10-19 从官方运行期配置页抓取核实）

<Callout type="verified" title="本章实测覆盖什么、不覆盖什么">

**已实测**：环境 Windows + Node v25.4.0，真库 `node:sqlite`，真定时器（不是虚拟时钟），脚本 `data-storage/.scratch/ds-pool.mjs`。跑出来的东西包括：每请求建连接的开销、池大小与排队等待（8 并发 × 40ms 占用 × 三种池大小）、连接泄漏导致的取连接超时、预编译语句复用的收益、10 万行表上三种执行计划原文与耗时、应用侧 200 次采样的 p50/p95/最大值、WAL 模式下一库两连接的读写并发行为。

**未实测**：任何 PostgreSQL 服务端行为。本机没有 PostgreSQL、没有连接池中间件（PgBouncer 等）、没有云数据库。所有 `pg_stat_statements`、`auto_explain`、`EXPLAIN ANALYZE` 的输出形状都标为预期。

**已核原文**：`log_min_duration_statement` / `log_min_duration_sample` / `log_statement` 三个参数的默认值与语义，2026-10-19 抓取 PostgreSQL 官方运行期配置页逐条确认，见「服务端日志」一节。

</Callout>

## 连接是昂贵的对象：先量一次「省的是什么」

```text
=== P1 建一次连接 vs 每个请求建一次：真实耗时 ===
   200 次「开连接+1 条查询+关连接」= 119ms；同一条连接上跑 200 次查询 = 34ms
```

这条实测是 SQLite（本地文件、没有网络），所以 119ms ÷ 200 ≈ **0.6ms/次** 已经是「建连接」的真实成本下限。换成 TCP 上的 PostgreSQL，一次连接要建立 TCP 三次握手、走 `pg_hba` 认证、可能叠 TLS 握手、由 postmaster fork 出一个后端进程（或线程）、加载会话默认配置；如果服务端前面还有 PgBouncer 之类的池中间件，还要多一跳。**数量级从 0.6 毫秒变成几毫秒到几十毫秒**，而且这几十毫秒是纯排队时间，不产生任何吞吐。

「贵」还体现在**状态**上：一条连接不是无状态的 socket，它带着事务状态（有没有 `BEGIN`）、会话级配置（`search_path`、隔离级别、临时表）、服务端 prepared statement 缓存、以及 advisory lock 的持有关系。**这就是为什么连接不能随便关掉**：一条正在事务里的连接被强制归还，语义要么被隐式回滚、要么泄漏成僵尸事务，两种都很糟。池的正确做法是归还前显式 `ROLLBACK` / 重置会话状态。

## 池不是加速装置，是排队装置

这条最容易理解错。8 个并发请求同时到达，每个借连接占 40ms，三种池大小的实测：

```text
=== P2 池大小与排队：8 个并发请求、每个占用 40ms ===
   poolMax=1：等待 p95=322ms 最长=322ms 全部完成耗时=369ms
   poolMax=2：等待 p95=140ms 最长=140ms 全部完成耗时=188ms
   poolMax=8：等待 p95=0ms  最长=0ms  全部完成耗时=47ms
```

三个读数：

1. **等待时间 ≈ (并发数 ÷ 池大小 − 1) × 单次占用时长**。poolMax=2 时最后一批要排 3 轮，`3 × 40 = 120ms`，实测 140ms，多出来的是调度与计时误差。poolMax=1 时是 7 轮 = 280ms，实测 322ms。公式能预测到量级，剩下的差额来自真实调度——这是好事，说明这条曲线可以当成容量规划的下限估计。
2. **池打满时的表现是变慢，不是报错。** 从 47ms 到 188ms 到 369ms，系统「正常工作」着，只是越来越慢，直到某个超时阈值被越过才突然开始 500。**这就是「所有接口一起变慢」的来源**，也是为什么它看起来像数据库故障。
3. **poolMax=8 全部完成只用 47ms，而单条占用是 40ms** —— 说明池够大时并发请求几乎完全并行。于是得到一个反直觉的结论：**池大小不该按「并发数」设，要按「占用时长」设**。

把这三条合起来就是那一条算式（本章把它当成容量规划的最小可用版本）：

```text
单个实例需要的连接数 ≈ 该实例的 QPS × 每个请求占用连接的平均秒数
所有实例的连接数总和 + 运维与迁移脚本用的连接 < 数据库的 max_connections
```

两个真实反例：

- **实例数翻倍，池没动，数据库被打爆**：10 个实例 × 每条池 20 = 200 条连接需求，而 PostgreSQL 默认 `max_connections` 是 100 量级（具体默认值以你实例的配置为准，`SHOW max_connections;`），滚动发布时新旧实例并存，峰值更高。判据永远写成「实例数 × 池上限」的乘积，不要只看单个服务的配置。
- **池越大越好，是错的**：数据库侧每条连接对应一个后端进程/线程和它自己的工作内存，连接数超过 CPU 核数之后并发执行会互相抢核、锁冲突上升，吞吐不升反降。**超出的并发应该排在应用侧的池里（便宜），不该排在数据库的锁上（昂贵）。**

## 三个超时分别管三件事，必须分开设

P3 里那条报错值得逐字看：

```text
=== P3 泄漏：占住不还的连接，表现为排队而不是报错 ===
   前 2 个请求拿到连接 id=1,0（等待 0/0ms），并且都没有归还 —— 这就是一次泄漏
   第 3 个请求：Timed out acquiring a connection after 127ms (pool=2, leaked=1) —— 泄漏的连接没有归还，第 3 个只能排队到超时（本段实测 127ms）
```

这是**借不到连接**的超时。另外两个是：**语句执行**的超时（数据库侧，PostgreSQL 的 `statement_timeout`、SQLite 上你只能自己包一层取消）与**事务整体**的超时（第 10 章里 Prisma v8 明确说没有 `timeout` 选项，意味着这一层要么由数据库侧参数兜、要么由你自己的 Promise 竞速兜）。

三者的正确关系是**由外到内递减**：请求总预算 > 事务超时 > 语句超时 > 借连接超时。反过来设就会出现「借连接比查询还久」这种荒谬形状：查询已经超时了，池还在慢慢给。经验值：借连接超时应该**很短**（几十到一两百毫秒，见 P3 的 127ms），因为它失败意味着「立刻拒绝比排队更诚实」——排队到 5 秒后成功，用户早就走了，而你刚刚用这条连接把一个健康请求拖成了第 11 个受害者。

`busy_timeout` 是第四个容易混进来的东西，它不是任何一层的超时，是**数据库内部等锁**：

```text
=== P6 两个连接在同一库上：读读并发 vs 写写互斥（busy_timeout 的真实等待）===
   A 持写锁时 B 读：立即成功，读到 200 行，耗时 8ms（WAL 读写不互斥）
   A 持写锁时 B 想写：失败：database is locked，耗时 397ms（busy_timeout=300 会先等满）
   A 提交后 B 再试：成功，耗时 0ms
```

第 2 行注意：`busy_timeout=300`，实测等了 **397ms** 才失败。等满 300ms 是内核行为，多出来的 97ms 是驱动与语言层的开销。**这说明「等锁」和「超时」是两个不同的时钟**，你在应用侧设 300ms 超时，实际墙钟时间会大于 300ms。把它当成排队时间的一个具体证据，别当成精确控制。

## 泄漏的表现是排队，不是报错

第一现场里 10 条连接全被借走，但没有任何地方写着「泄漏」。抓它只有一个办法：**把池的内数暴露出来**。

```ts
// 结构示意：三个指标，缺一不可
let checkedOut = 0;          // 当前借出数（gauge）
let waitMsTotal = 0;         // 累计等待毫秒（counter）
let leakedStacks: string[] = [];  // 超过阈值时长未归还的借用栈

async function withConn<T>(fn: (c: Conn) => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const c = await pool.acquire();          // 借不到就在这里排队
  checkedOut++;
  const stack = new Error().stack ?? '';   // 借用时抓栈，成本不低：只在采样或 debug 开关下开
  const timer = setTimeout(() => leakedStacks.push(stack), 5_000);
  try {
    return await fn(c);
  } finally {
    clearTimeout(timer);
    checkedOut--;
    waitMsTotal += Date.now() - t0;
    pool.release(c);                        // finally 里归还：这一行就是「泄漏」与「不泄漏」的全部差别
  }
}
```

判据看这三个：`checkedOut` 是否**长期贴着 poolMax**（而不是随流量起伏）、等待时间是否随时间单调上升、以及有没有 `acquire` 成功但从未 `release` 的差值。最常见的四种泄漏形状：

1. 没有 `finally`（或 `try` 里提前 `return` / 抛错路径没归还）；
2. 在循环里逐条借连接、最后一次性归还，中间任何一次抛错就漏掉全部；
3. 事务没提交也没回滚就丢掉了连接——**这条最坏**，因为它在数据库端留下一个持锁的空闲事务，别的写全部排队（P6 第 2 行就是它的形状）；
4. ORM 的「每个 query 自动开事务」形态：你以为只调了一次，实际借了两次连接，嵌套调用时直接自锁死。第 4 条是本章最后要提醒的**池内嵌套**：池大小 1 时，一个「借了连接又在内部再借一条」的调用会**永久等待自己**——这不是理论，把 P2 的 poolMax 设成 1、在 `fn` 里再 `await pool.acquire()` 就能复现，它不会报错，只会一直挂着。

## 慢查询定位：先数条数，再找哪条慢，最后读计划

顺序不能反。10 万行真库上跑同一条查询，三种计划的原文与实测耗时：

```text
=== P5 慢查询定位：10 万行上「没有索引」与「有索引」的计划原文和耗时 ===
   无索引计划：["SCAN t"]
   无索引耗时：5ms，结果={"c":3}
   建 idx_u 后计划：["SEARCH t USING INDEX idx_u (u=?)"]
   建索引后耗时：2ms，结果={"c":3}
   复合 (u,v) 后计划：["SEARCH t USING COVERING INDEX idx_uv (u=?)"]
   覆盖索引耗时：0ms，结果={"c":3}
   索引没帮上忙的写法（列上套函数）计划：["SCAN t USING COVERING INDEX idx_u"]
   写错方向（前导通配）计划：["SCAN t"]
   200 次「无索引 v LIKE」采样的应用侧耗时：中位=6ms p95=7ms 最长=9ms（计划=["SCAN t"]）
   同样 200 次「走 idx_u 的 SEEK」：中位=0ms p95=1ms 最长=1ms
```

`SCAN` 与 `SEARCH` 这条分水岭、复合索引的最左前缀、覆盖索引「少一次回表」的收益，[数据库领域第 6 章](/database/indexes)已经用几十万行详细讲过，本章不复述。这里只讲**定位流程**和两个新增读数：

- **第 7、8 行是两个「你加了索引但它没生效」的原文证据。** 在列上套函数（`WHERE u + 0 = ?`）时计划写着 `SCAN ... USING COVERING INDEX`——它扫的是索引，仍然是全量扫描，只是数据源换了；`LIKE '%42'` 前导通配无法用有序索引做区间查找，计划直接回到 `SCAN t`。看到「加了索引没变化」，先回去看计划动词，别看有没有索引名字。
- **最后两行是分位数对比。** 全表扫的那条：中位 6ms、p95 7ms、最长 9ms；走索引 seek 的那条：中位 0ms、p95 1ms、最长 1ms。

PostgreSQL 上的对应物是 `EXPLAIN (ANALYZE, BUFFERS)`，它多给你三样 SQLite 计划里没有的东西：**实际行数与估算行数的差**（统计信息过期最直接的信号）、**每个节点的耗时**（嵌套循环里那一层才是问题）、**缓冲区命中/未命中**（判断是不是 I/O 受限）。这套输出我本机没有环境，形状请自己跑一次核实。

## 应用侧统计：平均数会骗你，分位数不会

P5 最后两行的差别值得单独一节，因为它决定了你**能不能发现问题**。

```ts
// 可直接抄：把查询耗时收进环形缓冲，按分位数汇报
const buf: number[] = [];
function record(ms: number) { buf.push(ms); if (buf.length > 2000) buf.shift(); }
function quantile(p: number) {
  const s = [...buf].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}
// 每 15 秒汇报：p50 / p95 / p99 / max，而不是 mean
console.log({ p50: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99), max: Math.max(...buf) });
```

三个理由：

1. **数据库耗时分布是长尾的**，一次锁等待能贡献几千毫秒，把平均值抬成一坨看不出形状的数。P5 里全表扫那条最长 9ms、中位 6ms，差异不大是因为样本单一；真实系统里 p50 与 p99 差 100 倍稀松平常。
2. **p95 才是用户投诉的来源**。你的接口 SLA 应该按分位数写，不是按均值。
3. **排队时间要单独测**。上面的 `record` 应该记两次：`acquire` 等待时长与查询执行时长。P2 的实测说明这两件事的曲线完全不同形状——池够大时查询耗时不变而等待归零；只看总时长你会误判成「数据库变慢了」。

**判据句式**：p95 涨了、数据库 CPU 没涨、慢查询日志没有新条目 → 看 `acquire` 等待；三样都涨 → 看执行计划；只有 p99 涨、p50 不动 → 锁等待或冷缓存。

## 服务端日志与聚合：三条参数，逐字核实过

PostgreSQL 侧最常被误用的三个参数，2026-10-19 从官方运行期配置页抓到的原文（引述保留英文原句以免走样）：

| 参数 | 官方原文要点 | 默认值 |
| --- | --- | --- |
| `log_min_duration_statement` | "Causes the duration of each completed statement to be logged if the statement ran for at least the specified amount of time." / "Setting this to zero prints all statement durations. `-1` (the default) disables logging statement durations." | `-1` |
| `log_min_duration_sample` | "Allows sampling the duration of completed statements ... only for a subset of the executed statements, with sample rate controlled by `log_statement_sample_rate`." 且它被上一项覆盖："This overrides log_min_duration_sample, meaning that queries with duration exceeding this setting are not subject to sampling and are always logged." | `-1` |
| `log_statement` | "Controls which SQL statements are logged. Valid values are `none` (off), `ddl`, `mod`, and `all`" | `none` |

从这三条能直接推出四个实操结论：

- **单位是毫秒，不带单位时按毫秒解释**（"If this value is specified without units, it is taken as milliseconds"）。写成 `'1s'` 也对，写成 `1000` 就是 1000 毫秒。
- **别设 0**。第四现场的原因就在这句原文里：0 = 打印**每条**已完成语句的耗时。生产上一般从 `250ms`～`1000ms` 起步，配合采样参数 `log_min_duration_sample` + `log_statement_sample_rate`（官方描述里它就是为「只要一部分」设计的）。
- **慢查询日志只给语句文本和耗时，不给执行计划、不给绑定参数**，也没有累计统计。它是「日志快照」不是「聚合器」——想按语句形态聚合，那是 `pg_stat_statements` 的活。
- **`log_min_error_statement` 默认 `error`**（同页核实），意味着报错的语句本来就会进日志。**排「为什么报 500」不用改任何参数，先翻日志。**

<Callout type="unverified" title="pg_stat_statements 与 auto_explain：本章没有跑过">

`pg_stat_statements` 需要在 `shared_preload_libraries` 里加载、需要建扩展、还需要重启才生效；它按 `queryid` 聚合归一化后的语句（`SELECT ... WHERE id = 1` 与 `id = 2` 合并成一条）。`auto_explain` 能对超过阈值的语句自动打出执行计划。这两者的**具体输出列名、默认阈值、是否需要重启**我一律没有本机证据，请以官方页当前版本为准，跑一次 `SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;` 自己看。

</Callout>

## SQLite / WAL 与池的特殊关系

单机应用（本地工具、边缘运行时、小程序后端原型）常用 SQLite，它的池规则完全不同，P6 已经给出全部依据：

- **读读并发、读写不互斥**（WAL 模式下 B 在 A 持写锁时读，8ms 拿到结果）。所以池的主要价值不是并发读，而是**省掉重复打开文件与语句准备**。
- **写写完全互斥**：整个库同一时刻只有一个写事务，`BEGIN IMMEDIATE` 撞车时 `busy_timeout` 先等满再报错（实测等满 300ms、失败于 397ms）。**加大池不会提高写入吞吐**——100 条连接在写侧仍然是一条队列。要提写入吞吐，只有：合并写入、异步批量、或者换数据库。
- 长事务在 SQLite 上比在 PG 上更致命，因为它挡住的是**整库的写**。第 10 章那种「事务里等外部 HTTP」在这里的表现就是全站写超时。

## 预编译语句复用：池为什么不该太频繁地销毁连接

```text
=== P4 预编译语句复用：5 万行表上 20000 次查找 ===
   只 prepare 不执行：125ms｜每次 prepare+执行：4340ms｜复用同一条 prepared 执行：3318ms（命中 20000/20000）
```

20000 次里，「每次新建 prepared」比「复用一条」多花 **1022ms**，平均每次约 51µs；而 20000 次纯 `prepare` 只花 125ms（约 6µs/次）。这组数说明两件事：

1. **准备语句本身很便宜，贵的是「每次准备 + 每次执行」这条完整路径**（解析、规划、对象分配、缓存查找）。真实数据库上还要把解析结果发到服务端，pg 类驱动的 prepared statement 缓存收益比本机 SQLite 大得多。
2. 所以**池把连接销毁得太快会顺带毁掉语句缓存**。如果你的池设了很短的 idle 回收时间，会看到「数据库 CPU 里有稳定的解析负载」这种形状。反过来说：池过大也不只是数据库进程数的负担，还会把每条连接的语句缓存 × 连接数变成内存占用。

## 常见错误与排查

**1. 所有接口一起变慢，数据库指标却正常。** 原因：池打满，请求排在应用侧。确认：`checkedOut` 是否长期等于 poolMax；acquire 等待时间是否在涨（P2/P3 的形状）。修：先缩短占用时长（事务里不放外部调用），再按 QPS × 占用秒数重算池大小；不要一上来调大 `max_connections`。

**2. 超时错误文案分不清是哪种超时。** 原因：借连接、语句执行、事务三层超时混设。确认：把三层各自的阈值与报错文案写进运维文档，P3 那条 `Timed out acquiring a connection after 127ms` 就是**池**的错，不是数据库的错。修：由外到内递减设阈值，借连接超时设短。

**3. 归还放在成功路径而不是 `finally`。** 现象：错误率上升后池逐渐耗尽，正常运行时看不出来。确认：把 `checkedOut` 打出来并压测错误路径（让下游 500）。修：`try/finally` 归还；有事务时归还前显式 `ROLLBACK`。

**4. 池大小 1 上的嵌套借取。** 现象：请求永久挂起，不报错、不超时（如果没设 acquire 超时）。确认：P2 把 poolMax 设 1、在回调里再 `acquire()` 就能复现。修：嵌套调用一律往下传同一条连接（第 10 章的 `tx` 传参是同一件事），或干脆禁止在持有连接时再借。

**5. `log_min_duration_statement = 0`。** 现象：日志暴涨、磁盘 I/O 打满、查询更慢。确认：官方原文——0 打印所有已完成语句耗时；文档同时警告这类开关 "can add significant overhead"。修：设阈值（250ms 起）或改用采样两件套；需要全量时按会话 `SET` 而不是全局改。

**6. 加了索引但计划没变。** 现象：p50 略降、p99 没动甚至更差。确认：读计划动词，本章实测到两种「索引在场却仍 SCAN」的原文（列上套函数 / 前导通配）。修：把条件写成能走区间查找的形状（函数移到常量侧、前缀匹配），或按查询建合适的复合/覆盖索引（[数据库第 6 章](/database/indexes)）。

**7. 用平均值监控数据库耗时。** 现象：均值一直很好看，投诉不断。确认：把同一份样本按 p50/p95/p99 重算，与均值并排看。修：SLA 与告警改成分位数，并且 acquire 等待与执行耗时两条曲线分开。

## 练习

<Exercise title="练习 1 · 用 P2 反推容量" difficulty="进阶">

P2 里 8 个并发、每个占用 40ms：poolMax=1 全部完成 369ms，poolMax=2 是 188ms，poolMax=8 是 47ms。回答：(1) 为什么 poolMax=2 不是 369 ÷ 2？(2) 若线上每请求占用连接 25ms、单实例 QPS 120，这一个实例至少要几条连接？(3) 4 个实例各设 poolMax=20，数据库 `max_connections=100`，滚动发布时会发生什么？

<template #answer>

(1) 8 个请求不是同时开跑的：poolMax=1 是 8 × 40 = 320ms 加调度开销（实测 369ms）；poolMax=2 只有一批的一半人真正并行，理论 4 × 40 = 160ms，实测 188ms。差值就是真实调度与计时开销，别指望公式精确，它给的是下限。(2) `120 × 0.025 = 3`，稳态 3 条够用；但要留出突发与 GC/重试余量，实际常配到 2–3 倍，也就是 6–10 条——**先算稳态再决定余量，不要从「别人都设 20」抄数字**。(3) 发布期新旧实例并存，连接需求是 `(4 + 4) × 20 = 80` 逼近 100，再叠运维脚本与迁移工具的连接就会撞到 `max_connections`；表现是「只在发布窗口出现的取连接超时」。修：把总预算写成 `实例数 × poolMax < max_connections − 预留`，并且发布策略用滚动而非同时扩容。

</template>

</Exercise>

<Exercise title="练习 2 · 亲手把池漏死" difficulty="挑战">

在本地用 `node:sqlite`（或你手上任意数据库）复刻 P3 的形状：实现一个 poolMax=2 的池，写 3 个任务，前两个借了不归还，第三个正常借。回答：(1) 第三个任务出现什么现象，报错原文是什么？(2) 把归还写进 `finally` 之后现象如何变化？(3) 如果你的池没有 acquire 超时，第 3 个任务会怎样？

<template #answer>

(1) 第三个任务先排队，然后超时——本章实测原文是 `Timed out acquiring a connection after 127ms (pool=2, leaked=1)`（阈值设 120ms）。注意数据库本身毫无异常：没有任何错误来自 SQL 执行。(2) 归还进 `finally` 后三个任务都能完成，等待时间回到 P2 那条曲线（poolMax=2、8 并发时 p95 约 140ms 这个量级）。这一步的价值在于让你看到「泄漏」与「慢」在指标上是同一件事的两个阶段。(3) **永久挂起**，没有任何错误——这正是第一现场里最坏的一种：请求不失败，只是不返回，上游的超时与重试会把 1 个泄漏放大成 N 个排队请求。所以 acquire 必须有超时，且默认值要短。

</template>

</Exercise>

<Exercise title="练习 3 · 读懂两条计划" difficulty="基础">

P5 里「列上套函数」那条计划是 `["SCAN t USING COVERING INDEX idx_u"]`，「前导通配」那条是 `["SCAN t"]`。回答：(1) 两条都慢，但慢的机制有什么不同？(2) 各自怎么改写才能变成 `SEARCH`？(3) 为什么第一条比第二条「更省一点」？

<template #answer>

(1) 两条都是全量扫描。第一条扫描的对象是 `idx_u`（只含 `u` 列 + rowid），比扫整张表**数据量小**，但仍然是逐行判断 `u + 0 = ?`，因为函数破坏了「按 `u` 有序」这个可用性质；第二条扫的是表本身，`LIKE '%42'` 前导通配没有区间可言，只能逐行匹配。(2) 第一条把函数移到常量侧：`WHERE u = ? - 0`，或者干脆 `WHERE u = ?`（真实项目里通常是「日期列被函数包住」，改法是给出时间区间 `>= ? AND < ?`）。第二条没法通过改写谓词变成 seek——`%` 在开头就不可用有序索引；可行解是前缀匹配 `LIKE '42%'`、另建表达式/函数索引，或用全文检索。(3) 因为覆盖索引的宽度远小于表宽，扫它 I/O 更少——这条正好说明 **`SCAN ... USING INDEX` 里的 `USING INDEX` 不是好消息**，看到它先确认动词是 `SEARCH` 还是 `SCAN`。

</template>

</Exercise>

## 官方文档与延伸阅读

- [PostgreSQL 文档 · 19.2. Reporting and Logging (runtime-config-logging)](https://www.postgresql.org/docs/current/runtime-config-logging.html) —— 本章三处原文引述的直接来源：`log_min_duration_statement` 的默认 `-1` 与「zero prints all statement durations」、`log_min_duration_sample` 被它覆盖的那句、`log_statement` 默认 `none`、以及 "this option can add significant overhead" 的开销警告。
- [PostgreSQL 文档 · pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html) —— 核实「按 queryid 聚合、需要 `shared_preload_libraries` 加载」这一类事实，用于本章标为 unverified 的那段。
- [PostgreSQL 文档 · EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html) —— 核实 `ANALYZE` / `BUFFERS` / `TIMING` 选项各自打开什么，对应「PostgreSQL 上多给你的三样」。
- [PostgreSQL 文档 · auto_explain](https://www.postgresql.org/docs/current/auto-explain.html) —— 如果要用它，阈值参数与开销都得以该页为准（本章未验证）。
- [SQLite · WAL 模式](https://www.sqlite.org/wal.html) —— 核实「读写并发、写写串行」的机制描述，对应 P6 的实测形状。
- [SQLite · PRAGMA 清单](https://www.sqlite.org/pragma.html) —— 核实 `busy_timeout`、`journal_mode` 的作用域（连接级）与默认值，别把驱动默认当 SQLite 默认。
- [Node.js · node:sqlite API](https://nodejs.org/api/sqlite.html) —— 本章所有实测用的 `DatabaseSync` / `prepare` / `run` / `get` 与 `StatementSync` 的选项出处。
- 站内：[索引与执行计划](/database/indexes)（`SCAN`/`SEARCH` 与索引设计的完整谱系）、[事务与并发](/database/transactions)（`SQLITE_BUSY` 的四种成因）、[Prisma 深入：关系查询与事务](/data-storage/prisma-deep-dive)（事务持有时长与连接占用的因果）、[原始 SQL、Drizzle 对照与类型安全的边界](/data-storage/raw-sql-and-drizzle)、[缓存模式](/data-storage/caching-patterns)（当读侧压力来自重复查询而不是慢查询时）。

## 下一章

这一章把「数据库慢」拆成了三种完全不同的等待：应用侧借连接的排队（P2/P3 的实测曲线）、单条语句的执行（P5 的计划原文与 6ms vs 0ms 分位对比）、以及数据库内部等锁（P6 等满 397ms）。三者都调优完之后还剩一大类压力根本不经过数据库——静态资源、用户上传的文件、被反复请求的同一个大 JSON。把它们从应用服务器上卸下去是另一套机制，也有另一套故障形状：缓存命中率的错觉、刷新不生效、鉴权 URL 泄漏。下一章：[对象存储与 CDN](/data-storage/object-storage-and-cdn)。
