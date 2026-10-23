# MySQL 差异对照：同一段 SQL，三处跑出三种答案

本地 SQLite 写得顺顺当当的一条报表 SQL——`SELECT status, id, COUNT(*) FROM o GROUP BY status`——原样搬上云上的 MySQL 8，被 `sql_mode=only_full_group_by` 一句打回（预期报错 1055，下面细讲）。emoji 评论呢：本机存 `😀😀😀` 实测 3 个字符 12 个字节、毫无怨言，MySQL 的 `utf8` 字符集最多 3 字节，同样的插入预期报 `Incorrect string value`（1366）。迁移脚本更险：SQLite 里 `CREATE TABLE` 塞进事务、回滚、表消失（本机实测），MySQL 的 DDL 隐式提交，报错那一刻前半段已经永久生效。最后还有生产反馈的 `Deadlock found when trying to get lock`（1213）：两个各自都合理的并发 INSERT 在 InnoDB 的间隙锁（gap lock）下互相等成死锁，而你单机 SQLite 的单写者模型压根没有这个东西。

本章的主线不是「MySQL 有什么」，而是**同一个操作在 SQLite、PostgreSQL、MySQL 三边各自得到什么答案或什么报错**。SQLite 那一列全部是本次在本机真跑的（环境见下面的实测声明）；PostgreSQL 与 MySQL 两列**本机都没有服务、一条都没执行过**，全部是文档口径的预期结果，标「未在本机验证」。往前衔接 [PostgreSQL 进阶特性](/database/postgres-features)（很多「PG 特性」其实是与 MySQL 的差异点）；[事务与并发](/database/transactions)、[索引与执行计划](/database/indexes)、[备份与恢复](/database/backup-and-restore) 三章里量过的数字会被直接引用，不重讲。

<Callout type="verified" title="本章 SQLite 侧实测环境与方法">

Windows + **Node v25.4.0 内置 `node:sqlite`**（`DatabaseSync`，`:memory:` 库，运行打印 ExperimentalWarning），`SELECT sqlite_version()` 原文 **3.51.1**，日期 2026-10-18。方法：把每条待对照的语句逐条执行，捕获返回值或异常对象上的 `errcode` 与 `message` 原样贴出；下文 `A3:` `G10:` 这类标记对应我脚本里的检查项编号，JSON 片段都是原始输出、未删字段（个别长字符串以长度表示）。PostgreSQL / MySQL 侧无服务，全章不出现「实测」字样。

</Callout>

## 存储引擎：MySQL 让你选引擎，SQLite 和 PG 不给你这个烦恼

MySQL 的表挂在不同存储引擎（storage engine）上，行为差异是本质性的（文档口径，未在本机验证）：

| | InnoDB | MyISAM |
| --- | --- | --- |
| 事务 | 支持（BEGIN/ROLLBACK 有效） | **不支持**，BEGIN 了也白 BEGIN |
| 锁粒度 | 行锁 + MVCC | 表锁，读也锁、写更锁 |
| 崩溃恢复 | redo log 重放 | 容易坏，`myisamchk` 修 |
| 外键 | 强制执行 | **语法接受、直接忽略** |
| 备份配合 | `mysqldump --single-transaction` 一致性快照 | 只能 `--lock-tables` |

第四行就是[备份与恢复](/database/backup-and-restore) 里那条混用事故的机制：对 MyISAM 表加 `--single-transaction` 拿到的是撕裂快照。老系统里 `ENGINE=MYISAM` 的表还在，读到要知道它的 SQL「看起来安全」并不等于安全。

索引的物理形状也是引擎决定的。InnoDB 的表本身按主键组织成一棵 B-树（聚簇索引），**二级索引的叶子存的不是行地址而是主键值**——命中后还要拿主键回表再查一次，所以 MySQL 强调「覆盖索引省掉回表」、强调主键要短；MyISAM 才是二级索引存行号的旧直觉。SQLite 这边本机实测过同族概念：`SELECT rowid FROM wr` 对 `WITHOUT ROWID` 表报错原文 `no such column: rowid`（WR3）；`SEARCH big USING COVERING INDEX big_s (s=?)`（BX6）就是「不回表」在 SQLite 里的样子——**「覆盖索引」「回表」在三边指同一件事，物理载体分别是主键值、rowid、堆元组 TID**。

## 字符集与排序规则：utf8 不是 UTF-8，大小写由引擎决定

MySQL 每个库/表/列都挂着字符集（charset，决定怎么存字节）与排序规则（collation，决定怎么比大小、怎么判相等）。历史包袱：**MySQL 的 `utf8` 是「最多 3 字节」的残缺实现**（现在文档里叫 `utf8mb3`，`utf8` 别名已废弃但默认值长期是它），4 字节字符（emoji、部分生僻汉字）存不进去；**新库统一 `utf8mb4`** 是共识（文档口径，未在本机验证）。SQLite 没有字符集概念——本机存 3 个 emoji：`{"s":"😀😀😀","chars":3,"bytes":12}`（J3，`length()` 数 UTF-8 字符、`length(CAST(s AS BLOB))` 数 12 字节），PG 的编码在建库时定一次（一般 UTF-8，文档口径）。三边行为：

| 操作 | SQLite（实测） | PostgreSQL（预期，未验证） | MySQL（预期，未验证） |
| --- | --- | --- | --- |
| 插入 4 字节 emoji | 成功，chars=3 | 成功（库编码 UTF-8 前提下） | `utf8` 列报 `Incorrect string value: '\xF0\x9F...'`（1366），`utf8mb4` 列成功 |
| `'Alice'` 与 `'alice'` 存进 UNIQUE 列 | **两行都进去**（D4/D5：`[{"name":"Alice"},{"name":"alice"}]`） | 默认区分大小写，两行都进去 | `_ci` 排序下第二行报 duplicate（1062），`_bin`/`_cs` 下两行都进去 |
| `'ABC' = 'abc'` | `0`（D1 eq_binary） | `false` | `_ci` 为 1、`_bin` 为 0 |
| `'ABC' LIKE 'abc'` | **`1`**（D1 like_ascii，LIKE 对 ASCII 恒不区分大小写） | `false`（LIKE 严格区分） | `_ci` 下 1；LIKE 跟随列排序规则 |

两个 SQLite 味的直觉要在这里掰断。第一，`=` 和 `LIKE` 在 SQLite 里是**两套大小写规则**（等值区分、LIKE 对 ASCII 恒不区分），MySQL 里两者都跟随排序规则——实测 D8 用 `COLLATE NOCASE` 让 UNIQUE 变宽后，第二条插入立刻报 `UNIQUE constraint failed: u2.name`（errcode=2067）；换成 `utf8mb4_0900_ai_ci` 的 MySQL 列会得到同一形状的 duplicate 冲突（措辞不同，未验证）。**「看起来一样就算重复」的业务唯一性，在 SQLite/PG 默认下靠 UNIQUE 兜不住，在 MySQL 默认排序下反而兜得住——迁移时这一对差异双向咬人。**第二，`utf8mb4` 下 InnoDB 单个索引键有长度上限（约 3072 字节，长列用前缀索引，超限报 1071，文档口径）；SQLite 实测无限制：`length(s)=3000` 的值照进索引且走覆盖索引命中（BX4/BX6）。

标识符是另一个维度。SQLite 里 `SELECT ID, STATUS FROM O`（全大写查小写定义的表 `o`）实测正常返回（H2）。MySQL 列名不敏感，但**库表名在 Linux 上默认区分大小写**（受 `lower_case_table_names` 控制），Windows 开发机 + Linux 生产 = 「本地好好的，线上 table doesn't exist」（文档口径）。PG 把未加引号的标识符折叠成小写。三套规则互不兼容，命名从第一天就全小写下划线。

## GROUP BY 裸列：只有 SQLite 不拦你

实测（C1–C3）：表 `o(id, status, total)` 四行数据，`paid` 组里有三行（id 1/2/3）。跑这条——

```sql
SELECT status, id, total, count(*) c FROM o GROUP BY status;
```

SQLite 原样返回：`[{"status":"new","id":4,"total":5,"c":1},{"status":"paid","id":1,"total":10,"c":3}]`。没有报错没有警告，`paid` 组的 `id`/`total` 是组内**某一行**的值（这次拿到第一行——SQLite 官方文档明确说这是未定义行为，别把「每次都一样」当保证）。MySQL 默认 `sql_mode` 含 `ONLY_FULL_GROUP_BY`，同一句预期报 1055（`Expression #2 of SELECT list is not in GROUP BY clause and contains nonaggregated column...`）；PG 预期报 `column "o.id" must appear in GROUP BY clause or be used in an aggregate function`（SQLSTATE 42803）——两边都未在本机验证。

修法三选一：要每组代表行就显式 `MAX(id)`/`ANY_VALUE(id)`（MySQL）或 `DISTINCT ON`/窗口（PG，见 [SQL 查询进阶](/database/sql-advanced) 的分组 Top-N 实测）；真想要「组内任一行」也要写出来——**裸列能跑，但它把正确性押在实现细节上**。这条差异危险在方向性：从 MySQL 搬回 SQLite 只是「不报错了」，值却可能一直在漂移。

## 类型亲和与隐式转换：'123abc' 住进 INTEGER 列

SQLite 的类型是「亲和性」（affinity）不是强类型，本机实测把这事钉死（表 `a(i INTEGER, t TEXT, v VARCHAR(5), n NUMERIC)`，A1–A5）：

```sql
INSERT INTO a VALUES('123','456','789','1.5'), ('123abc','x','hello-there-very-long-value-5000-chars','abc');
SELECT rowid, typeof(i) ti, i, typeof(v) tv, length(v) lv, typeof(n) tn, n FROM a;
```

返回：第 1 行 `{"ti":"integer","i":123,"tv":"text","lv":3,"tn":"real","n":1.5}`；第 2 行 `{"ti":"text","i":"123abc","tv":"text","lv":38,"tn":"text","n":"abc"}`。逐条读：`'123'` 长得像整数就转成整数；`'123abc'` 转不动就**以 TEXT 原样住进 INTEGER 列**；`VARCHAR(5)` 的「5」被无视，38 个字符照存；`NUMERIC` 列里 `'1.5'` 变实数、`'abc'` 变文本。比较时还有第二层转换：`WHERE i = '123'` 实测命中整数 123（A4），`i = '123abc'` 对 123 是 `0`（A5）。

同一批数据换另外两边（预期，未验证）：PG 在把 `'123abc'` 插进 integer 列时报 `invalid input syntax for type integer`（22P02），varchar(5) 超长报 value too long（22001）；MySQL 非严格模式静默截断并把 warning 塞进 `SHOW WARNINGS`，严格模式（`STRICT_TRANS_TABLES`）报 1366 / 1265。三边的「宽容度光谱」：**SQLite 最宽（亲和），MySQL 中间（看 sql_mode），PG 最严（强类型）**。

SQLite 也有变严的开关，本机实测（STRICT 表）：建表尾缀 `STRICT` 成功，`WITH (STRICT)` 在这台 3.51.1 上报 `near "(": syntax error`（S1/S3 对照）；之后 `INSERT INTO st VALUES('123abc','x')` 报 **errcode=3091 `cannot store TEXT value in INTEGER column st.i`**，而 `'123'` 仍被接受并转成整数 123（T3），浮点 `1.5` 拒、`3.0` 收（T5/T9/T10）。STRICT ≈ SQLite 世界里最接近 MySQL 严格模式的形态，但语义不等价（STRICT 管「类型住错列」，严格模式还管截断与越界）。

隐式转换另一个落点是索引：MySQL 里 join 两端排序规则不一致预期报 `Illegal mix of collations`，列与常量转换不匹配会让索引失效——[索引与执行计划](/database/indexes) 「索引失效清单」的 MySQL 加长版。顺带一个跨章小料：`'a' || 'b'` 实测返回 `"ab"`（P1），**MySQL 默认把 `||` 解析成逻辑或**（预期 0/1，除非 sql_mode 开 `PIPES_AS_CONCAT`）——拼 SQL 时最阴的一道语法糖。

## 自增、UPSERT 与 RETURNING：一条 INSERT 的三种方言

**拿新行主键。** SQLite 实测：`last_insert_rowid()` 连接级返回最近插入的 rowid（H1）；普通 `INTEGER PRIMARY KEY` 删掉最大 id 后再插会**复用**空出的号（AI5：删 id=2 后新行拿回 id=2），`AUTOINCREMENT` 则单调不回头（AI10：同场景新行是 id=3）；回滚是否退号见[事务与并发](/database/transactions)。MySQL 对应 `LAST_INSERT_ID()`（连接级、多行插入返回第一行、ODKU 下语义特殊——文档口径，未验证）；PG 的做法是直接 `RETURNING id`。

**插撞了怎么办。** 三边三种语法，SQLite 两种都能跑，实测对照（表 `up(k INTEGER PRIMARY KEY, v INTEGER, note TEXT DEFAULT 'orig')`，先插 `(1,1,'keepme')`）：

| 写法 | 实测/预期结果 |
| --- | --- |
| `INSERT ... ON CONFLICT(k) DO UPDATE SET v=excluded.v`（G3/G4） | `{"k":1,"v":2,"note":"keepme"}` —— 原地更新，没提的列保持原值 |
| `INSERT OR REPLACE INTO up(k,v) VALUES(1,4)`（G5/G6） | `{"k":1,"v":4,"note":"orig"}` —— **note 被重置**：REPLACE 的语义是先删后插 |
| `INSERT ... ON CONFLICT(k) DO NOTHING`（G7） | 不报错，`changes=0` |
| `ON CONFLICT(v)` 而 v 无唯一约束（G10） | `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint` |

PG 的 `ON CONFLICT` 与第一行**同源同形**（裁判必须是唯一索引/约束、`excluded` 指待插行、DO UPDATE 必须写 conflict_target——[PostgreSQL 进阶特性](/database/postgres-features) 已从官方文档核实），SQLite 的报错原文就是这套规范长出来的。MySQL 用第三种语法 `INSERT ... ON DUPLICATE KEY UPDATE v = VALUES(v)`：不用指名裁判，**任意唯一键撞上都算冲突**（代价是裁判不精确，多个唯一索引时行为难推理，文档口径、未验证）。把 `INSERT OR REPLACE` 无脑映射成 ODKU 是错的——REPLACE 的删后插会重置未提供的列、触发 DELETE 级联与触发器，上面 G6 的 `note:"orig"` 就是证据。

**RETURNING。** SQLite 实测三种都能带回数据：INSERT 得 `{"id":5,"status":"ret"}`，UPDATE 得 `{"id":5,"total":99}`，DELETE 得 `{"id":5}`（F1–F3）；PG 是这套语法的出处（官方文档已核实）。**MySQL 没有 RETURNING**（文档口径）：插入靠 `LAST_INSERT_ID()` 取号，更新/删除想拿到改后的值只能再 SELECT——两步之间就是并发窗口，这是 Prisma/Drizzle 在 MySQL 上少一批「原子取回」写法的根因，见[数据访问设计](/database/data-access-design)。另外 `UPDATE ... LIMIT 1` 实测报错 `near "LIMIT": syntax error`（I3，DELETE 同款 I4）：MySQL 允许、PG 不允许、SQLite 拒——三种答案，两边移植都要改。

## DDL 到底能不能回滚：SQLite 实测能，MySQL 根本不在事务里

这是本章对迁移脚本影响最大的一条。SQLite 实测（E1–E5）：

```js
// node:sqlite，逐句执行
db.exec('BEGIN');
db.exec('CREATE TABLE d1(x INTEGER)');
db.exec('INSERT INTO d1 VALUES(1)');
db.exec('ROLLBACK');
db.prepare('SELECT * FROM d1').all();
// 实测输出：ERROR [errcode=1] no such table: d1   ← DDL 被回滚得干干净净
```

PG 同为「DDL 在事务内可回滚」（`CREATE/ALTER TABLE` 都在事务保护里，回滚与锁行为是[迁移与版本管理](/database/migrations) 的主线；文档口径未执行）。**MySQL 的 DDL 隐式提交（implicit commit）**：`CREATE/ALTER/DROP TABLE` 执行前后各自强制提交当前事务——文档口径，未在本机验证。后果：MySQL 上「BEGIN; CREATE TABLE; INSERT; ROLLBACK」的迁移脚本，表已经在了，ROLLBACK 只回滚了 DML 段；「迁移失败自动回滚」在 MySQL 是伪命题，只能向前补偿。同一条混排语句的三种答案：SQLite 里是一个事务、PG 里是一个事务、MySQL 里是两个事务的分界线。

## 隔离级别默认值与间隙锁：三种并发，三种炸法

SQLite 的账在 [事务与并发](/database/transactions) 已经量完：单写者、`BEGIN IMMEDIATE` 撞锁 errcode=5、WAL 下拿旧快照再写 errcode=517——**它是「挡在门外」模型，冲突以 BUSY 面目出现**。

默认隔离级别（文档口径，均未在本机验证）：PG 默认 **READ COMMITTED**，MySQL/InnoDB 默认 **REPEATABLE READ**。同一份「事务里读两次、中间有人提交」的代码，PG 第二次读到新值，MySQL 读到旧快照——接上事务章的 PG 四级对照表。MySQL 的 RR 还多一件武器：**间隙锁（gap lock / next-key lock）**——范围查询或唯一性检查时把「值之间的缝隙」也锁住，防幻读的同时，让两个互不相干的并发 INSERT 在同一个间隙上互相等待，形成经典的 `Deadlock found when trying to get lock`（1213）。典型形态：`SELECT ... WHERE uk=? FOR UPDATE` 没查到、再 INSERT 的两组事务交错——MySQL 锁间隙导致死锁；PG 没有间隙锁，两条 INSERT 只在真撞唯一键时一方等另一方，随后拿 23505 duplicate key。**报错面目不同，正确姿势相同：整个事务重跑**——别在 catch 里只补那条 INSERT。

抢任务型读写（一张 job 表多人领单）：PG 与 MySQL 8 都有 `FOR UPDATE SKIP LOCKED`（文档口径），SQLite 没有行锁可跳——单写者模型下用 `BEGIN IMMEDIATE` 串行领单反而简单（锁行为已实测）。

## LIMIT 与深分页：语法三城志

实测（o 表 id=1..4）：`... ORDER BY id LIMIT 2 OFFSET 1` 与 `... ORDER BY id LIMIT 1,2` 返回**完全相同**的 `[{"id":2},{"id":3}]`（I1/I2）——SQLite 两种写法都接受，逗号形态即 `LIMIT 偏移, 行数`（MySQL 方言）。PG 官方 SELECT 文档的语法大纲只有 `LIMIT count` 与 `OFFSET start` 两个关键字分段（2026-10-18 已核实原文，无逗号形态——**PG 上 `LIMIT 1,2` 预期语法错**）；MySQL 两种都接受。深分页 `LIMIT 100000,20` 的代价三边同型（扫过去再扔掉），键集分页与 ORM 写法在[数据访问设计](/database/data-access-design) 收口，本章只钉语法。

## 时间戳列：MySQL 有 ON UPDATE，另两家没有

实测（K1–K5）：`created TEXT DEFAULT CURRENT_TIMESTAMP` 的行，`UPDATE ts SET v='second'` 之后再读，`created` 原封不动——`{"t":"text","created":"2026-10-18 03:08:24"}` 与更新前一字不差（typeof 是 **text**，SQLite 的「时间」就是字符串，比较靠格式纪律，[数据建模](/database/data-modeling) 提过）。SQLite 要自动维护更新时间只有 UPDATE 触发器一条路；PG 没有 `ON UPDATE` 语法、DEFAULT 只在插入时生效，触发器是标准答案（生成列也帮不上——上一章已核实「生成表达式只能用不可变函数」，`now()` 是易变的）；MySQL 独一份的 `ON UPDATE CURRENT_TIMESTAMP` 会自动刷新（文档口径，未验证），配合 `TIMESTAMP` 的 1970–2038 范围与 `DATETIME` 的更宽范围一起选。迁移提醒：MySQL 表搬去 PG 时 `ON UPDATE` 会静默消失，「更新时间不再变化」是移植后最晚被发现的一类 bug。

## 复制与 binlog：备份章那个 RPO/RTO 的地基在这

MySQL 的一切复制与时间点恢复都压在二进制日志（binary log）上：statement/row/mixed 三种事件格式，主从复制即从库重放 binlog；[备份与恢复](/database/backup-and-restore) 里 `mysqldump --source-data`（8.0.26 起取代 `--master-data`）记录的正是「这份 dump 对应 binlog 哪个位置」，从此才能做全量 + 增量重放的 PITR（文档口径，未在本机验证）。PG 的对应物是 WAL 归档 + 流复制/逻辑复制；SQLite 没有官方复制方案（实测过的 `database is locked` 全库互斥就是原因）。三边 RPO/RTO 摆到一张桌上：MySQL 靠 binlog 位置、PG 靠 WAL 归档点、SQLite 靠你多久做一次 `VACUUM INTO`。

## 一张总表：同一段 SQL 的三种答案

| 同一条语句/操作 | SQLite（本机实测） | PostgreSQL（文档预期） | MySQL（文档预期） |
| --- | --- | --- | --- |
| `INSERT '123abc'` 进 INTEGER 列 | 以 TEXT 存入，typeof=text | 报 invalid input syntax（22P02） | 非严格截断为 0/123+警告；严格模式 1366 |
| 超长字符串进 VARCHAR(5) | 照存（实测 lv=38） | 报 value too long（22001） | 非严格截断；严格模式 1406 |
| 裸非聚合列 + GROUP BY | 返回「组内某行」的值 | 42803 报错 | 1055 报错（默认 sql_mode） |
| UNIQUE 列收 'Alice'/'alice' | 两行都进（NOCASE 后第二条 2067 冲突） | 两行都进（默认区分大小写） | `_ci` 第二条 1062；`_bin` 都进 |
| `LIMIT 1,2` | 与 LIMIT 2 OFFSET 1 等价 | 语法错（无逗号形态） | 合法（MySQL 原生方言） |
| `UPDATE ... LIMIT 1` | 语法错（实测原文） | 不支持 | 支持 |
| 事务里 CREATE TABLE 后 ROLLBACK | 表消失（实测 no such table） | 表消失（事务性 DDL） | **表留下**：DDL 隐式提交 |
| `ON CONFLICT` 无裁判约束 | 实测原文 no match 报错 | 同语义报错（文档已核实） | 无此语法，用 ON DUPLICATE KEY |
| `INSERT OR REPLACE` 撞主键 | 删后插，未提供列回默认值（实测 note 重置） | 无此语法；用 UPSERT | ODKU 是原地 UPDATE，语义不同 |
| `RETURNING` | INSERT/UPDATE/DELETE 均可用（实测） | 出处，支持 | 不支持，用 LAST_INSERT_ID |
| `'a' \|\| 'b'` | `'ab'`（实测） | `'ab'` | 0/1（逻辑或），除非 PIPES_AS_CONCAT |
| 默认隔离级别 | 等效 SERIALIZABLE（单写者） | READ COMMITTED | REPEATABLE READ + 间隙锁 |
| emoji 😀 入库 | 成功（chars=3） | UTF-8 库成功 | utf8(mb3) 报 1366，utf8mb4 成功 |
| `PRAGMA foreign_keys` | node:sqlite 下实测为 1；引擎默认值是关（文档） | 无开关，恒执行 | InnoDB 恒执行，MyISAM 忽略 |

## 常见错误与排查

**1. `Incorrect string value: '\xF0\x9F...'`（1366）。** emoji 或生僻字写不进评论列、ASCII 正常：列是 `utf8`/utf8mb3（最多 3 字节），或连接层字符集与表不一致。`SHOW CREATE TABLE` 看 CHARACTER SET（预期输出，未验证）；同一条 INSERT 在本地 SQLite 必成功（实测 chars=3/bytes=12 可当探针）。修法：列与连接都改 `utf8mb4`，注意索引长度预算（见第 7 条）。

**2. `This is incompatible with sql_mode=only_full_group_by`（1055）。** SQLite/旧 MySQL 能跑的报表 SQL 在新 MySQL 报错：裸非聚合列，报错文本会点名哪一列不合规。修法：聚合掉（`MAX`/`ANY_VALUE`）或进 GROUP BY；搬回 SQLite 后「能跑」不代表对——值的选取本身未定义（实测 C3 那行输出就是证据）。

**3. 数据悄悄变短/变 0。** 库里 `'abc'` 变 `0`、超长串被切成 255 字符且全程无报错：非严格 sql_mode 静默截断。确认：语句后立刻 `SHOW WARNINGS`；SQLite 有同款参照系——STRICT 表实测原文 `cannot store TEXT value in INTEGER column st.i`（errcode=3091）。修法：上 `STRICT_TRANS_TABLES`，并把 sql_mode 当环境依赖写进验收清单。

**4. 并发 INSERT 死锁 1213，本地复现不了。** 仅生产高峰期偶发：RR + 间隙锁，先查后插的两个事务锁同一间隙互等（机制见上文，未在本机验证）。`SHOW ENGINE INNODB STATUS` 的 LATEST DETECTED DEADLOCK 段看现场（预期形态，未执行）；本地复现不了是正常的——SQLite 是单写者挡门（实测 errcode=5）。修法：先插后查（唯一键 + UPSERT 类语法）、缩短事务、或该表降 RC；捕获 1213 后**整个事务重跑**，与 PG 40001、SQLite 517 一致。

**5. 「本地好好的」表名找不到。** Windows 开发机正常、Linux 报 table doesn't exist：库表名在 Linux 默认大小写敏感，代码混用了两种拼法。修法：全小写命名 + 静态检查兜住；别指望 `lower_case_table_names=1` 掩盖问题（跨环境迁移还会引入新坑，文档口径）。

**6. 迁移脚本报错后「回滚」了，表却留下一半。** MySQL 上迁移失败，前面的 `CREATE TABLE` 已生效：DDL 隐式提交，事务对结构变更不设防（对照：SQLite 实测 ROLLBACK 连表一起消失）。修法：迁移工具按「不可回滚、向前修复」设计，每步保持可重入（`IF NOT EXISTS`、加列前查 information_schema），详见[迁移与版本管理](/database/migrations)。

**7. 长列建索引报 `Specified key is too long`（1071）。** utf8mb4 下 VARCHAR(512) 建索引失败：InnoDB 索引键上限约 3072 字节，512×4 超了。修法：前缀索引 `KEY(col(64))`（长度按区分度选，[索引与执行计划](/database/indexes) 的方法适用）或改存哈希列；SQLite 实测 3000 字符值照进索引无压力（BX4），别把这份无感带进 MySQL 的容量规划。

## 练习

<Exercise title="练习 1 · 预测六种语句在三边的命运" difficulty="基础">

给每条标注：SQLite / PG / MySQL 各自「能跑且正确」「能跑但结果有歧义」「报错」，报错的写预期错误号。全部以本章实测输出或文档口径为据：
① `SELECT status, id, COUNT(*) FROM o GROUP BY status;`
② `INSERT INTO a(i) VALUES('123abc');`（i INTEGER）
③ `UPDATE o SET total=0 LIMIT 1;`
④ `SELECT 'a' || 'b';`
⑤ `INSERT INTO up(k,v) VALUES(1,9) ON CONFLICT(k) DO UPDATE SET v=excluded.v;`（k 为主键）
⑥ `CREATE TABLE t2 ...;` 夹在 `BEGIN ... ROLLBACK` 中间。

<template #answer>

① SQLite 能跑但有歧义（实测 C3：返回组内任意行）；PG 报错 42803；MySQL 默认 1055。② SQLite 能跑但埋雷（实测 A3：存成 TEXT）；MySQL 非严格静默截断、严格 1366；PG 22P02。③ SQLite 语法错（实测原文 `near "LIMIT": syntax error`）；MySQL 能跑；PG 语法错。④ SQLite/PG 得 `'ab'`（SQLite 实测 P1）；MySQL 默认得 0（逻辑或）。⑤ SQLite 实测可（G3，note 列保持原值）；PG 是这套语法的出处；MySQL **报错**——没有 `ON CONFLICT` 方言，得改写 `ON DUPLICATE KEY UPDATE`。⑥ SQLite 表消失（实测 E5）；PG 表消失（事务性 DDL，文档）；MySQL 表留下——DDL 隐式提交。三边「全对」的那列只有你的记忆，对照本章表格自批。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造错误并读出四种报错原文" difficulty="进阶">

在 `node:sqlite` 的内存库里依次做四件事，把你**实际拿到**的 errcode 与 message 原文抄下来，再各写一句「这条在 MySQL/PG 上的对应物是什么」：
a) UNIQUE 列先插 `Alice` 再插 `alice`，然后对第二张 `COLLATE NOCASE` 表重复同样两插；
b) `ON CONFLICT` 指向一列没有任何唯一约束；
c) 建 `STRICT` 表后插一个文本值进 INTEGER 列；
d) `INSERT OR REPLACE` 覆盖一行没提供默认值列的数据。

<template #answer>

本章脚本的真实输出：a) 第一张表两条都成功（默认 BINARY 区分大小写），第二张表第二条 `errcode=2067, UNIQUE constraint failed: u2.name`；b) `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`；c) `errcode=3091, cannot store TEXT value in INTEGER column st.i`；d) 不报错——`{"k":1,"v":4,"note":"orig"}`，`note` 从 `keepme` 被重置回默认值（删后插语义）。MySQL 对应物：a) `_ci` 下第一条就 1062；b) 无同族报错，因为没有需要指名的裁判；c) 严格模式 1366；d) ODKU 原地更新**不会**重置 note——REPLACE 与 UPSERT 的本质分歧，迁移时最容易静默变义的一条。PG 对应物：a) 默认区分大小写、citext 扩展后同第二张；b) 已核实的同语义限制；c) 22P02；d) 无 REPLACE，DO UPDATE 只动你列出的列。

</template>

</Exercise>

<Exercise title="练习 3 · 把 REPLACE 思维换成 UPSERT 思维" difficulty="进阶">

一张 `inventory(sku TEXT PRIMARY KEY, qty INTEGER, warehouse TEXT DEFAULT 'A')`，业务是「入库：有则加数量、无则新插」。有人写了 `INSERT OR REPLACE INTO inventory(sku,qty) VALUES('x',5);`。指出这条在生产数据上的两种事故，改写成正确形态（SQLite 写法实测过同款语法；顺带写出 MySQL 8 的等价语句，标注未验证）。

<template #answer>

事故一：REPLACE 是删后插，未提供的 `warehouse` 被重置为默认值 `'A'`——货实际在 C 仓，记录回跳 A 仓（本章 G5/G6 实测的 note 列就是这个形状）。事故二：`inventory` 若被 `ON DELETE CASCADE` 的外键引用，删后插会把下游行连坐删掉；InnoDB 同样如此，SQLite 则要外键约束开着（实测 node:sqlite 默认 `PRAGMA foreign_keys=1`，FK3 原文 `FOREIGN KEY constraint failed` 可证它在管事）。正确写法：`INSERT INTO inventory(sku,qty) VALUES('x',5) ON CONFLICT(sku) DO UPDATE SET qty = inventory.qty + excluded.qty;`——旧值用表名限定（`inventory.qty`）、新值走 `excluded`，这是 PG 已核实的规则、SQLite 同源。MySQL 8 等价形态 `INSERT INTO inventory(sku,qty) VALUES('x',5) ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty);`（文档口径，未在本机验证）。

</template>

</Exercise>

<Exercise title="练习 4 · 设计一场 MySQL 间隙锁死锁并给出三处修法" difficulty="挑战">

表 `jobs(id BIGINT PRIMARY KEY AUTO_INCREMENT, uk VARCHAR(64) UNIQUE, status TINYINT)`，InnoDB、默认 RR。领单代码是「`SELECT id FROM jobs WHERE uk=? FOR UPDATE`，空则 `INSERT`」。两个并发请求用**同一个不存在的 uk**。解释预期死锁怎么形成（文档机制，未在本机验证），为什么这段代码搬回 SQLite 只会 BUSY 不会死锁，再给三种修法。

<template #answer>

机制：RR 下 `FOR UPDATE` 扫唯一索引不存在的键，InnoDB 不只检查记录，还锁住该键所在的**间隙**（gap lock）；两个事务同时持有同一间隙的共享意向，随后各自的 INSERT 都要在间隙上拿排他插入意向锁，互相等待——1213。SQLite 没有行锁也没有间隙概念：两个写事务在 `BEGIN IMMEDIATE` 层面就被挡掉，后到的拿实测过的 errcode=5 `database is locked`，冲突以「排队」而非「互等」呈现。三种修法：① 取消先查后插，直接 `INSERT`，捕 1062 后转 UPDATE（把判断交给唯一索引，冲突变成单点 duplicate 而不是锁序环）；② 领单改 `FOR UPDATE SKIP LOCKED`，不等、不锁间隙（8.0 支持，文档口径）；③ 该表会话级降 `READ COMMITTED`——没有间隙锁，配合行格式 binlog 是常见生产配置。三种都保留「捕获死锁即整事务重跑」的兜底。

</template>

</Exercise>

## 官方文档与延伸阅读

- [SQLite CREATE TABLE](https://www.sqlite.org/lang_createtable.html)、[STRICT 表](https://www.sqlite.org/strict.html) 与 [Datatypes](https://www.sqlite.org/datatype3.html) —— 亲和性与 STRICT 选项（本机 3.51.1 实测：尾缀 `STRICT` 可用、`WITH (STRICT)` 报语法错）；A3/P2 的实测行为与之对照。
- [SQLite 结果码](https://www.sqlite.org/rescode.html) 与 [外键](https://www.sqlite.org/foreignkeys.html) —— 实测拿到的 2067（UNIQUE）、787（FOREIGN KEY）、3091（DATATYPE 细分码）定义在此；引擎默认关外键、node:sqlite 运行时默认开（实测 `PRAGMA foreign_keys` 返回 1）。
- [PostgreSQL SELECT](https://www.postgresql.org/docs/current/sql-select.html) 与 [INSERT](https://www.postgresql.org/docs/current/sql-insert.html) —— LIMIT/OFFSET 无逗号语法、ON CONFLICT 裁判与 RETURNING，2026-10-18 已核实（未执行）。
- [MySQL sql_mode](https://dev.mysql.com/doc/refman/8.0/en/sql-mode.html)、[Unicode 字符集](https://dev.mysql.com/doc/refman/8.0/en/charset-unicode-sets.html) —— `ONLY_FULL_GROUP_BY`/`STRICT_TRANS_TABLES`/`PIPES_AS_CONCAT` 与 utf8mb3/utf8mb4、排序规则家族的出处。
- [InnoDB 锁](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking.html)、[隐式提交](https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html) 与 [AUTO_INCREMENT](https://dev.mysql.com/doc/refman/8.0/en/example-auto-increment.html) —— 间隙锁与死锁机制、DDL 不在事务里的清单、`LAST_INSERT_ID()` 各场景语义（均未在本机验证）。
- [Node.js node:sqlite](https://nodejs.org/api/sqlite.html) —— 本章全部实测所用 API（实验性模块）。

## 下一章

这一章用 SQLite 的实测输出做标尺，把 PostgreSQL 与 MySQL 的行为差量逐个钉住——类型宽容度、GROUP BY 裸列、DDL 事务性、UPSERT 三方言、间隙锁，每条都是「同一个操作，三种答案」。[数据访问设计](/database/data-access-design) 是这三章的收口：ORM 生成的 SQL 长什么样、N+1 为什么在 MySQL 上比 PG 更难发现（没有 RETURNING、批量取 id 靠 `LAST_INSERT_ID` 的假设）、分页在 `LIMIT 1,2` 与键集之间怎么选。往前依赖 [PostgreSQL 进阶特性](/database/postgres-features) 的特性清单与[事务与并发](/database/transactions) 的锁实测——没有那两份底子，本章只是一张背不下来的对照表。
