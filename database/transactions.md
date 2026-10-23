# 事务与并发：SQLite 只给你 SERIALIZABLE，丢失更新却照样发生

两个请求同时给同一个账户退款，各自读到余额 1000，各自写回 900，最后余额 900 —— 你退了两笔钱，只扣了一次账。代码里每一步都没报错，`UPDATE` 的 `changes` 都是 1。

另一种故障是接口偶发 500，日志一行 `database is locked`；本地复现不出来，一压测就出现。还有更隐蔽的：后台导出任务开着事务跑了 40 分钟，回来发现 `-wal` 涨到 11.8 MB 差点打满磁盘，而备份脚本拷走的 `.db` 主文件里**连表都不存在**。

这些故障背后是同一组问题：**事务到底保证什么、并发时谁挡谁、隔离级别在两种数据库里分别是什么语义**。本章每条结论都在本机跑过：`node:sqlite` + SQLite 3.51.1，用两三个独立连接打真实锁冲突，包括跨进程抢锁。前置：[索引与执行计划](/database/indexes)（锁等待常混在慢查询里）、[SQLite 入门](/database/sqlite-first)。

## ACID 在 SQLite 里就是四块具体代码

| 字母 | 靠什么实现 | 你怎么观察 |
| --- | --- | --- |
| 原子性 Atomicity | 回滚日志或 WAL：旧页先落盘，提交才写主文件；出错靠 `ROLLBACK` 或热日志复原 | 未提交时多出 `xxx.db-journal`（实测 2000 行未提交 = 8720 字节） |
| 一致性 Consistency | `NOT NULL` / `UNIQUE` / `CHECK` / 外键 + 你写的业务不变式 | `UNIQUE constraint failed` 把整条语句打掉 |
| 隔离性 Isolation | 文件级共享/预留/独占锁，或 WAL 的快照 + 单写者 | `database is locked`，errcode 5 |
| 持久性 Durability | `COMMIT` 时的 fsync（实测 `synchronous` 默认 2 = FULL） | 调成 0/1 就是拿风险换性能 |

**SQLite 不提供行锁，它锁整个数据库文件，且任何时刻只有一个连接能写。** 这条决定了后面所有现象。PostgreSQL / MySQL 是行级锁 + MVCC，冲突面小得多，但冲突种类更多。

## 三个 BEGIN 的差别：双连接实测

`BEGIN` 默认是 `DEFERRED`：锁不在 `BEGIN` 时申请，而在第一条碰数据的语句时才申请。

| 形态 | 何时拿锁 | 别人正在写时 | 适用 |
| --- | --- | --- | --- |
| `BEGIN`（DEFERRED） | 首次读→读锁，首次写→写锁 | 只读语句**能成功**（读旧值）；你想写 → 立刻 BUSY | 纯批量只读 |
| `BEGIN IMMEDIATE` | `BEGIN` 那一刻要写锁 | `BEGIN` 立刻失败，errcode 5 | 读改写的所有场景 |
| `BEGIN EXCLUSIVE` | `BEGIN` 时独占，别人连读都不给 | `BEGIN` 立刻失败 | 独占维护、批量导入 |

实测：A `begin immediate` + `update`（持有 RESERVED）时，B 的 `begin immediate` 与 `begin exclusive` 都在 **0 ms** 内抛 errcode 5 `database is locked`；但 B 的 `begin` + `select` **成功**并读到旧值 100（A 未提交的 200 看不见），A 提交后 B 再读才变成 200。第三行是关键：**只写不读的事务和只读不写的事务可以并存**，读者拿旧值，既不阻塞也不脏读。`BEGIN EXCLUSIVE` 时连只读 `BEGIN` 都被挡（实测约 24 ms 后失败）。**默认该用 `BEGIN IMMEDIATE`**，用 DEFERRED 做「先查后改」是本章第一个大坑。

## 回滚的真实边界

```sql
BEGIN;
UPDATE acc SET bal = bal - 700 WHERE id = 1;
INSERT INTO acc(id, bal) VALUES (3, 700);
ROLLBACK;
```

```text
事务内自己看到: [{"id":1,"bal":300},{"id":2,"bal":1000},{"id":3,"bal":700}]
rollback 后:   [{"id":1,"bal":1000},{"id":2,"bal":1000}]
```

四条边界，每条都跑过：

1. **语句报错不等于事务结束。** 主键冲突之后 `ROLLBACK TO savepoint`、`ROLLBACK` 都能正常执行 —— 事务一直活着。所以 `catch` 里忘了 `rollback`，这个连接会**一直占着写锁**，别人全在等：这就是「偶发 database is locked，过一会儿又好了」的常见来源。
2. **`SAVEPOINT` 支持嵌套和局部回滚。** 实测插入 4 行后 `ROLLBACK TO sp1` 只撤销 sp1 之后的那一行，前三行照样提交。
3. **SQLite 的自增计数器跟着事务回滚。** 实测 `AUTOINCREMENT` 表事务内拿到 rowid 1，回滚后再插入仍是 1，`sqlite_sequence` 也停在 1。PostgreSQL 的 `serial` / `identity` 序列**不**这样（序列值不参与事务回滚，号会跳掉）—— 这条本机没有 PG 服务，未验证，请以 [PostgreSQL 文档](https://www.postgresql.org/docs/current/index.html) 里 sequence functions 一节为准。别把两边直觉互套。
4. 事务语句本身也会报错，原文值得记：`cannot start a transaction within a transaction`（ORM 把 `transaction()` 套 `transaction()`）、`cannot commit - no transaction is active` / `cannot rollback - no transaction is active`（连接池里拿到别人没收拾干净的连接）。

## 丢失更新：事务没开的那种最常见

真正的丢失更新往往不是「隔离级别不够」，而是**读和写不在同一个事务里**。实测交错（余额 1000，两人各退 100）：应用先各读一次 `select v from k where id=1`（两次都读到 1000，都发生在任何写之前），再各执行 `update k set v=? where id=1`，把 `1000-100` 写回去：

```text
A 读到 1000，B 读到 1000
最终 v = 900，正确答案应为 800 → A 的 100 被覆盖   （全程零报错，changes 都是 1）
```

把读写圈进事务，同一个交错立刻撞墙：

```text
A 在 begin immediate 里读到 1000
B: begin immediate -> errcode=5 "database is locked"   ← 冲突提前暴露
A commit 后 v = 900；B 重试（读到 900）后 v = 800      ← 两笔都生效
```

三种正确写法，实测都跑过：

| 写法 | SQL 形态 | 实测结果 |
| --- | --- | --- |
| 读改写压进一条语句 | `update k set v = v - ? where id = 1` | 并发两次扣款 → 800，正确 |
| 乐观锁（版本/期望值） | `update ... set v = v - ? where id = 1 and v = ?` | 期望值不符时 `changes = 0`（实测），据此重试；相符时 `changes = 1` |
| 悲观锁 | `BEGIN IMMEDIATE` 包住读改写 + BUSY 重试 | 后到者挡在 `BEGIN`，重试后结果正确 |

生产形态是给表加 `version integer`，每次更新都 `version = version + 1` 并在 `WHERE` 里带上你读到的 version —— 它比 `SELECT FOR UPDATE` 通用（SQLite 没这语法），也直接适用于 [PostgreSQL 进阶特性](/database/postgres-features) 与 MySQL。

## 脏读、不可重复读、幻读：两种数据库的语义对照

SQLite 侧实测：

```text
脏读       A 事务内 update 到 777（未提交）；B 独立连接读到 100 → 读不到未提交
           A commit 后 B 再读 = 777
不可重复读 WAL：A: BEGIN; select → 100；B: update 999 并 commit；A 再 select → 仍是 100
```

即：**不开事务时像「语句级读已提交」**（每条语句一个快照），**一开事务就是快照隔离**，同一事务内重复读结果一致。WAL 下拿过快照再去写会得到 errcode **517**（`SQLITE_BUSY_SNAPSHOT`，消息仍是 `database is locked`）—— SQLite 版的「序列化失败」，只能整个事务重来。

PostgreSQL 四个级别（官方文档核实于 2026-10-18，**未在本机执行**）：

| 级别 | 脏读 | 不可重复读 | 幻读 | 序列化异常 |
| --- | --- | --- | --- | --- |
| READ UNCOMMITTED | 标准允许，**PG 不实现** | 可能 | 可能 | 可能 |
| READ COMMITTED（PG 默认） | 不可能 | 可能 | 可能 | 可能 |
| REPEATABLE READ | 不可能 | 不可能 | 标准允许，**PG 不允许** | 可能 |
| SERIALIZABLE | 不可能 | 不可能 | 不可能 | 不可能 |

三条要记住：**PG 的 READ UNCOMMITTED 行为等同 READ COMMITTED**（内部只有三种实现）；**PG 的 REPEATABLE READ 就是快照隔离，比标准更强，连幻读都堵住**；**SERIALIZABLE 用 SSI 追加检测，冲突回滚并抛 SQLSTATE 40001**，两句报错原文是 `could not serialize access due to concurrent update`（RR 里改到别人已改动的行）和 `could not serialize access due to read/write dependencies among transactions`（SSI 检测到依赖环）。官方明确要求：收到这类错误必须回滚并**重跑整个事务**，不能只补那条语句 —— SQLite 的 517 同理。

**SQLite 只支持 SERIALIZABLE 语义**，代价是并发度低（单写者）。「本地好好的、PG 上同一事务两次查同一行结果不同」不是 PG 更差，而是你没开事务。反过来 PG 的 REPEATABLE READ 允许「写偏斜（write skew）」，只有 SERIALIZABLE 会拦；SQLite 因为单写者 + 517 顺手把这类也堵掉了。

## SQLITE_BUSY 与 database is locked：四种成因四种修法

先记一条默认值：**`PRAGMA busy_timeout` 默认是 0**（实测），冲突时你立刻拿到异常而不是等一会儿。

| 成因 | 实测现象 | 修法 |
| --- | --- | --- |
| ① 两个写事务并存 | 后到者**第一条语句就失败**，errcode 5，等待 0 ms（busy handler 对这种冲突不生效） | `BEGIN IMMEDIATE` 提前失败 + 退避重试；或上 WAL 缩小冲突面 |
| ② 提交被老实读者挡住 | A 已持 RESERVED，`COMMIT` 需要 EXCLUSIVE，被 B 的读锁挡住 → 等满 `busy_timeout=300` 才失败（实测 379–399 ms）；此刻第三方连接**连读都失败** | 别开着只读事务不放；写侧把超时设长 |
| ③ WAL 快照冲突 | errcode **517**，消息同样是 `database is locked` | 整个事务重跑，别只补一条语句 |
| ④ 跨进程抢锁 | 子进程持写锁 900 ms，父进程 `busy_timeout=3000` → **等 1003 ms 后写入成功** | 这才是 `busy_timeout` 的正确用途：等短临界区 |

第②条是回滚日志模式独有、也最多人搜的故障：**你的写事务被一个「只是查询很慢」的读事务卡住了**。WAL 下不会发生。

退避重试实测（另一进程持锁 500 ms，`busy_timeout=0`）：

```text
重试次数 7，退避序列 [10,20,40,80,160,200] ms，总耗时 539 ms → 成功，两笔插入都在
```

```js
async function withBusyRetry(fn, { retries = 8, base = 10, cap = 250 } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      // 只对锁冲突重试；语法错、约束错重试一万次也不会成功
      if (e.errcode !== 5 && e.errcode !== 517) throw e;
      if (i >= retries) throw e;
      const wait = Math.min(cap, base * 2 ** i) * (0.5 + Math.random());
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
```

三个不要：不要对非锁错误重试（`errcode=1555` 约束、`errcode=1` 语法）；不要在已 `BEGIN` 的事务里只补一条语句（517 必须整个事务重来）；不要用巨大的 busy_timeout 掩盖长事务（第②类会变成全站超时）。

<Callout type="verified" title="本章实测环境与方法">

Windows 10 x64 + **Node v25.4.0 + `node:sqlite`**（`DatabaseSync`，运行时会打印 `ExperimentalWarning`），SQLite **3.51.1**（`select sqlite_version()` 原文），核实日期 2026-10-18。并发方法是**同一进程内开多个 `DatabaseSync` 连接指向同一个 `.db`**，每个连接是独立文件句柄、独立持锁，锁冲突行为与多进程一致；第④类我另用 `child_process` 起了真·第二进程验证（结论一致）。耗时数字是这台机器这一次的观察，**不是 SQLite 的承诺值**；errcode、报错原文、锁相容关系是可复现的确定性结论。`node:sqlite` 仍是实验性模块，API 以 [Node.js sqlite 文档](https://nodejs.org/api/sqlite.html) 当前版本为准。

</Callout>

## WAL 还是回滚日志：一张实测对照

`PRAGMA journal_mode` 默认值是 `delete`（实测：新建文件库就是这个值）。切 WAL 后变成三个文件，实测大小依次是 `c.db:8192 + shm:32768 + wal:0`（刚切完）→ `wal:4152`（提交一笔小事务后）→ `wal:0`（`wal_checkpoint(TRUNCATE)` 之后）。

| 维度 | 回滚日志（delete） | WAL |
| --- | --- | --- |
| 读写互斥 | 读会挡提交的写（第②类故障） | **读不挡写、写不挡读**（实测：A 开只读事务时 B 照样 update + commit） |
| 写并发 | 一个写者 | 仍是一个写者（第二个 `BEGIN IMMEDIATE` 立刻 BUSY） |
| 切换代价 | — | **别的连接开着事务时切不过去**：实测 errcode 5 `database is locked` |
| 多进程 / 网络盘 | 可以 | 依赖共享内存文件，不能放 NFS（官方要求，未在本机验证） |

检查点不是免费的。`PRAGMA wal_checkpoint(mode)` 返回三列（busy / log / checkpointed），实测在有老实读者钉住快照时：

```text
写 4000 行后: db:4096 shm:32768 wal:931152 | 钉住的读者看到 行数=0
wal_checkpoint(passive)  -> busy:0  log:226 checkpointed:2   ← 只推进 2 页就放弃
wal_checkpoint(full)     -> busy:1  log:226 checkpointed:2
wal_checkpoint(truncate) -> busy:1  log:226 checkpointed:2   ← 没截断，wal 仍 931152
读者事务结束后 truncate  -> busy:0  log:0   checkpointed:0   ← wal:0，主文件长到 45056
```

`busy:1` 表示「这次检查点没做完」，**它不报错**。自动检查点阈值实测 `wal_autocheckpoint = 1000` 页。还有：**最后一个连接正常关闭时 SQLite 会自动检查点并删掉 `-wal`/`-shm`**（实测关连接后只剩 `c.db:16384`）—— 这条在备份时既是救星也是陷阱，见[备份与恢复](/database/backup-and-restore)。

## 长事务的四笔账

| 代价 | 实测数字 |
| --- | --- |
| 每次提交都 fsync | 1000 行逐条自动提交 **7960–8417 ms** vs 一个事务包 1000 次 **13 ms**（delete 模式，约 612 倍） |
| WAL 缓解但不消除 | 同 1000 行：WAL 下自动提交 **2353–2359 ms**，一个事务 **6–10 ms** |
| 回滚日志膨胀 | 2000 行未提交时 `-journal` = **8720 字节**（旧值全写在里面） |
| WAL 被读者钉住 | 一个只读事务钉住快照，另一连接逐条提交 3000 行 → `-wal` 涨到 **12 421 832 字节（约 11.8 MB）**，主文件只有 8192 |
| 空间不还操作系统 | 删掉 2000 行后主文件仍 **28672 字节**；`VACUUM` 之后回到 **8192 字节** |

推论：**事务要短，但提交次数要少。**「事务里塞一个 HTTP 调用」同时踩中第 1、3、4 条 —— 外部服务一慢，读锁/快照就长期钉住，全站在等。正确形态是把外部调用挪到事务外，定时任务加超时并强制回滚。连接池与并发全景见[连接池与慢查询定位](/data-storage/connection-pool-and-slow-query)。

## 常见错误与排查

**1. 「database is locked」偶发，一会儿又好了。** 现象：写接口 500，日志一行 locked。原因：上表四类之一，最常见是②或你根本没设 `busy_timeout`（默认 0）。确认：打印 `e.errcode`，5 = 普通 BUSY，517 = WAL 快照冲突；再查有没有长任务（导出、备份、`VACUUM`）。修法：`PRAGMA busy_timeout=1000` + 指数退避；只读事务用完立刻结束；写多读多就上 WAL。

**2. 余额对不上但零报错。** 现象：两人各扣 100，账上只少 100。原因：读写分属两个事务（实测 `最终 v = 900`）。确认：日志打出「读到的值」与「写回的值」，两次读相同即坐实。修法：单语句 `v = v - ?`，或 `version` 乐观锁看 `changes`，或事务包住。

**3. `catch` 里只 `console.log` 不 `ROLLBACK`。** 现象：某次异常之后整库写不进去，直到重启。原因：语句报错不会替你结束事务（实测主键冲突后事务仍活着）。修法：`try { begin; …; commit } catch { rollback; throw }`，用包装函数保证成对；服务层写法见[统一错误处理](/backend/error-handling)。

**4. 以为 WAL 会自动把 `-wal` 收掉。** 现象：`-wal` 几百 MB，磁盘告警。原因：检查点被长读事务挡住，`wal_checkpoint` 只回 `busy:1` 不报错（实测）。修法：跑一次 `pragma wal_checkpoint(truncate)` 看三个返回值，揪出长事务；同类膨胀在[Redis 持久化](/data-storage/redis-persistence)有对照。

**5. 在事务里改 PRAGMA，静默无效。** 现象：明明 `pragma foreign_keys=0` 了，`DROP TABLE` 还被外键挡。原因：`PRAGMA foreign_keys` 在事务内是空操作 —— 实测事务内执行完再读值纹丝不动，事务外执行才变 0。修法：放在 `BEGIN` 之前。（别混淆：实测 `PRAGMA busy_timeout` 在事务内是生效的，0 → 123。）

## 练习

<Exercise title="练习 1 · 预测并发结果" difficulty="基础">

初始 `v = 1000`。两个连接 A、B 各自先执行第 1 步（都执行完），再各自执行第 2 步。最终 `v` 是多少？本章哪次实测跟它一模一样？如果把第 2 步换成 `UPDATE k SET v = 900 WHERE id = 1;` 呢？

```sql
-- 第 1 步
SELECT v FROM k WHERE id = 1;
-- 第 2 步
UPDATE k SET v = v - 100 WHERE id = 1;
```

<template #answer>

第一种写法是 **800**。读写虽分两句，但第 2 步是**数据库内部的读改写**，`v - 100` 用的是语句执行时刻的值，第 1 步读到的 1000 只是躺在应用变量里没被用上。对照实测：把第 2 步写成 `v = ?`（值来自应用）跑两次，结果就是 900 —— 也就是「A 的 100 被覆盖」。**写成 `v = v - ?` 并发就是对的；写成常量或应用值，正确性就交给时序。**

第二种（`SET v = 900`）两次都成功，最终 900，本该是 800 —— 这就是本章的丢失更新，而且 `changes` 一直是 1，看不见任何异常。这也是 ORM「先 find 再 save 整个对象」比「increment 表达式」危险的原因。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造 database is locked 并读出 errcode" difficulty="进阶">

用 `node:sqlite` 开两个连接指向同一个文件库，制造下面三种失败，各贴出你看到的 `e.errcode`、`e.errstr` 和等待时间，并说明三者修法为什么不同：

1. A `BEGIN IMMEDIATE` 不结束，B 也 `BEGIN IMMEDIATE`；
2. A `BEGIN` 后只做 `SELECT` 不结束，B 试图执行 `PRAGMA journal_mode = wal`；
3. WAL 模式下 A `BEGIN` + `SELECT`，B 改同一行并提交，A 接着 `UPDATE`。

<template #answer>

本章跑出来的原文：

```text
① B: begin immediate   FAIL 用时 0ms   errcode=5   errstr="database is locked"
② 切 WAL               FAIL            errcode=5   errstr="database is locked"
③ A: update（拿过快照） FAIL 用时 1ms   errcode=517 errstr="database is locked"
```

① 单写者冲突，`busy_timeout` 不会让你等（busy handler 不介入 RESERVED 冲突），只能**重试**，或把写请求排队。② 是你自己造成的：A 的只读事务挡住了模式切换；修法是「改全局 PRAGMA 前确保没有别的事务」，实操就是启动时设一次、或用 `BEGIN EXCLUSIVE` 独占做维护。③ 快照过期，**补语句没用**（A 的快照已定），必须 `ROLLBACK` 整个事务从头再来 —— 这就是「幂等 + 从头重跑」的由来。另外 `errcode` 是扩展码（517 = 5 加上 2 移位），别写 `if (e.message.includes('locked'))` 就重试，会把 ③ 当 ① 处理成「只补一条语句」。

</template>

</Exercise>

<Exercise title="练习 3 · 给转账加乐观锁" difficulty="挑战">

表 `acc(id, bal, version)`。用 `UPDATE ... WHERE id=? AND version=?` 实现「从 1 号账户转 100 到 2 号」，要求任何一步失败都能安全重试，且不会出现负余额。写出 SQL 和判断逻辑，并解释为什么余额非负不能只靠应用层的 `if`。

<template #answer>

```sql
BEGIN IMMEDIATE;
SELECT id, bal, version FROM acc WHERE id IN (1, 2);
-- 应用校验余额足够后：
UPDATE acc SET bal = bal - 100, version = version + 1 WHERE id = 1 AND version = ?;
UPDATE acc SET bal = bal + 100, version = version + 1 WHERE id = 2 AND version = ?;
COMMIT;
```

两条关键：**每条 `UPDATE` 都要检查 `changes === 1`**，为 0 说明有人抢先改过，立刻 `ROLLBACK` 并重跑整个事务（实测期望值不符时 `changes = 0`，这是唯一的探测手段）；**余额非负靠 `CHECK (bal >= 0)` 约束或 `WHERE bal >= 100` 兜底**，因为应用读到的值在写回那一刻可能已经不成立 —— 本章实测的 `最终 v = 900` 就是这么来的。

用 `BEGIN IMMEDIATE` 而不是裸 `BEGIN`，让并发事务在第一条语句撞上 errcode 5。服务层的组织方式见[分层架构与请求处理链路](/backend/layered-architecture)，幂等键思路见[分布式会话、限流与幂等](/data-storage/session-rate-limit-idempotency)。

</template>

</Exercise>

## 官方文档与延伸阅读

- [SQLite lang_transaction](https://www.sqlite.org/lang_transaction.html) —— 核实三种 BEGIN 的加锁时机、只支持 SERIALIZABLE、读改写应用 IMMEDIATE（我跑出的 errcode 5 / 517 与之一致）。
- [SQLite WAL 文档](https://www.sqlite.org/wal.html) —— 核实「读写不互相阻塞」「最后连接关闭时自动检查点并删除 `-wal`/`-shm`」「WAL 不能放网络文件系统」（最后一条未在本机验证）。
- [SQLite 结果码](https://www.sqlite.org/rescode.html) 与 [PRAGMA 清单](https://www.sqlite.org/pragma.html) —— 判读 `SQLITE_BUSY`(5) / `SQLITE_BUSY_SNAPSHOT`(517)，核对各默认值；实测：`journal_mode=delete`、`busy_timeout=0`、`synchronous=2`、`wal_autocheckpoint=1000`。
- [PostgreSQL 事务隔离级别](https://www.postgresql.org/docs/current/transaction-iso.html) —— PG 表格与两句报错原文的出处，核实于 2026-10-18（**本机无 PG 服务，未执行**）。
- [Node.js node:sqlite](https://nodejs.org/api/sqlite.html) 与 [SQLite 适用场景](https://www.sqlite.org/whentouse.html) —— 前者是本章实测所用 API（实验性模块），后者是「什么时候该换 PostgreSQL」的官方依据。

## 下一章

本章管「运行时的并发正确性」，[迁移与版本管理](/database/migrations) 管「结构变更时的正确性」，底层功夫同一套：事务边界、锁粒度、什么时候必须 `BEGIN IMMEDIATE`、为什么不能一上来 `DROP`+`CREATE`。下一章会在 `node:sqlite` 上真跑一个最小迁移器（失败回滚、幂等重放、校验和漂移检测），并把「加列 → 回填 → 改名 → 清理」四步走和 SQLite 各条 `ALTER` 限制的报错原文量出来；往前依赖[数据建模](/database/data-modeling) 定好的表结构与命名约定。
