# PostgreSQL 进阶特性：JSONB 不是垃圾桶，膨胀与死元组没人替你盯着

产品把动态表单塞进 JSONB 列，查询写 `WHERE extra->>'city' = '杭州'`：百万行时 4 秒，`EXPLAIN` 里永远是一行 Seq Scan。给 `extra` 建过的 GIN 索引帮不上忙——`->>` 这种「取标量再比较」不在默认操作符类的职责里，索引白建。

第二种故障来自一次升级。PostgreSQL 11 上写 `WITH recent AS (大表聚合)` 再拿它做 JOIN，是当「优化栅栏」（optimization fence）用的：强制先算完再关联，计划稳定。迁到 12 后同一句话变慢了——**12 起 CTE 默认不再自动物化**，优化器把它折叠进了外层查询。

第三种看不见：半年没人 UPDATE 的表，主键点查从 1 ms 变 80 ms，体积从 200 MB 涨到 800 MB，行数没变——MVCC 下 UPDATE/DELETE 留下的死元组（dead tuple）被长事务或复制槽钉住，VACUUM 清不掉。第四种更直白：RLS「为了测试先关掉」忘了开，租户隔离只剩应用层那句 WHERE；`LISTEN/NOTIFY` 当队列用，断线窗口里的通知永久丢失。

[备份与恢复](/database/backup-and-restore) 那章算的是「数据没了怎么回来」，本章算的是「服务端数据库在 SQL 之外还能替你做什么、以及每样特性的代价」。声明在先：**本机没有 PostgreSQL 服务，本章所有 PG 命令与输出都没有执行过，一律是依据官方文档的预期结果**（文档核实于 2026-10-18，官方 current 此时为 18 版）；「实测」只指 `node:sqlite` 的 SQLite 对照。前置：[事务与并发](/database/transactions)（MVCC 与长事务）、[索引与执行计划](/database/indexes)、[SQL 查询进阶](/database/sql-advanced)（CTE）、[数据建模](/database/data-modeling)（软删除）。

## 先摆正层级：实例、数据库、schema 是三件事，跨库 JOIN 不存在

PostgreSQL 的对象层级和 MySQL 的直觉不一样，也和 SQLite「一个文件就是一切」完全不同：

| 层级 | 是什么 | 关键约束 |
| --- | --- | --- |
| 实例 / 集群（instance/cluster） | 一个数据目录 + 一个 postmaster 进程 | 监听一个端口（默认 5432），`postgresql.conf`、`pg_hba.conf` 在实例级 |
| 数据库（database） | 实例内互相隔离的命名空间 | **不能跨数据库 JOIN**；连接字符串就选定了一个库 |
| schema | 数据库内的命名空间，默认有 `public` | 表、类型、函数都属于某个 schema |
| 表空间（tablespace） | 数据在磁盘上的存放位置 | 实例级对象，把不同库/表落到不同挂载盘 |
| 角色（role） | 用户与权限 | **属于整个实例不属于某个库**——`pg_dump` 不导出角色（上一章那个坑的机制） |

与 MySQL 最容易混的两点：MySQL 的 `USE db` 在 PG 里做不到——PG 靠 `search_path` 在**单个库内**切命名空间；PG 的 `GRANT` 对象比 MySQL 细（库、schema、表、列、函数各一级）。`search_path` 的经典事故：两个 schema 里各有一张 `orders`，连接后没设 `SET search_path`，查询命中了 `public.orders`，改的代码在另一张表上。确认方法：

```sql
SHOW search_path;                          -- 预期: "$user", public
SELECT current_database(), current_schema; -- 我到底在哪个库、哪个命名空间下解析名字
SELECT schemaname, tablename FROM pg_tables WHERE tablename = 'orders';
```

<Callout type="unverified" title="本节全部预期输出，本机未执行">

本章 PG 的 SQL 都来自文档描述，本机无服务可跑。落地验证：按[数据库领域导读](/database/)起一个实例（Docker 或原生安装），逐条重跑对照预期；不一致时以你版本的文档页为准。

</Callout>

跨库查询要靠扩展：`postgres_fdw` 把远端库的表映射成本地外部表，或 `dblink` 函数式调用——都是权宜。数据要长期一起查，就该放进同一个库的不同 schema，这同时回答建模时「要不要按业务域拆库」的问题。

## JSONB：存结构化 payload，但索引要按查询形状选

`json` 与 `jsonb` 是同一份 JSON 的两种存法（[官方类型页](https://www.postgresql.org/docs/current/datatype-json.html)，未在本机验证）：

| 维度 | json（文本原样） | jsonb（二进制分解） |
| --- | --- | --- |
| 键顺序、重复键、空白 | 原样保留 | 不保留顺序、丢重复键（后值胜）、去空白 |
| 写入 | 快（不解析加工） | 略慢（要解析成二进制） |
| 读与索引 | 每次重新解析 | 直接按路径取，支持 GIN/表达式索引 |

常用三个操作符：`->` 取子对象（返回 json）、`->>` 取成 text、`@>` 判包含（`extra @> '{"city":"杭州"}'`）。GIN 只服务 `@>`/`?` 包含族，`->>` 标量比较必须用表达式索引。三类索引：

```sql
-- ① 表达式索引：精确匹配某个键，等价于给虚拟列建 B-树
CREATE INDEX idx_orders_city ON orders ((extra->>'city'));
-- ② GIN：吃「包含/键存在」类查询，一个索引覆盖很多键
CREATE INDEX idx_extra_gin ON orders USING GIN (extra);            -- 默认 ops，支持 ? 系列
CREATE INDEX idx_extra_path ON orders USING GIN (extra jsonb_path_ops);  -- 只支持 @>，更小更快
-- ③ 生成列 + 普通索引：高频热键的归宿，见下一节
```

①的双括号是硬性语法，`ON orders (extra->>'city')` 报语法错。另一个高频坑是**索引表达式与查询表达式要形状一致**——改写时多一层 cast、换个大小写就不一定命中，上线前 `EXPLAIN` 确认（预期，未执行）。

**JSONB 适合**：结构多变、整取整存的 payload（第三方回调原文、表单模板答案）。**不适合**：JOIN 连接键、要聚合的数值（`->>` 出来是 text，聚合前还要 cast）、需要外键/唯一约束的业务字段。判断线一句话：**这个字段将来会不会出现在 JOIN 的 ON 或某个约束里？会，它就是列，不是 JSONB 里的键。**把它当万能垃圾桶，是[关系模型](/database/relational-model) 章讲的约束一个都借不到。

## 生成列：派生值这件事，数据库也能在场

生成列（generated column）把「由其他列算出来」的值固化进表定义，官方文档核实到的限制（[ddl-generated-columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html)，2026-10-18，**本机未执行**）：

```sql
CREATE TABLE orders (
  extra jsonb,
  city  text GENERATED ALWAYS AS (extra->>'city') STORED
);
CREATE INDEX ON orders (city);   -- 生成列可正常建索引、可进 UNIQUE
```

文档明确的边界：**只能用不可变（immutable）函数、只能引用同一行的列、禁子查询、不能引用另一个生成列、不能做分区键**；`UPDATE` 与 `INSERT` 直接给生成列赋值都会被拒。

STORED 与 VIRTUAL：官方文档页同时描述两种（stored 写入时计算占存储，virtual 读取时计算、且不得用自定义类型），但没明说你的版本里 VIRTUAL 是否真能建——历史上长期只实现 STORED。**默认写 `STORED`；想用 `VIRTUAL` 先在测试库试一条，以你版本文档为准。**

与替代方案对照：表达式索引只加速查询、表里无此列每次 `SELECT` 重算；触发器能做跨行派生但难审计、迁移时容易漏（见[迁移与版本管理](/database/migrations)）；应用层算列值把一致性交给每个写入方。JSONB 热键升格生成列，就是「垃圾桶里捡出正式字段」的标准动作。SQLite 侧同族语法本机实测 STORED/VIRTUAL 都可用、禁直写：

<Callout type="verified" title="SQLite 生成列实测（Node v25.4.0 + node:sqlite，3.51.1，2026-10-18）">

`CREATE TABLE g(a INTEGER, b INTEGER GENERATED ALWAYS AS (a * 2) STORED, c INTEGER GENERATED ALWAYS AS (a + 1) VIRTUAL)` 建表成功；插入 `a=5` 后查询返回 `{"a":5,"b":10,"tb":"integer","c":6,"tc":"integer"}`——VIRTUAL 列读取时算出来了。改写它被拒：`cannot UPDATE generated column "b"`、`cannot INSERT into generated column "b"`（errcode=1）。SQLite 的语法接受 `VIRTUAL`，**不代表** PG 也接受，两边不要互套。

</Callout>

## UPSERT 与 RETURNING：三条语句压成一条

`INSERT ... ON CONFLICT` 是 PostgreSQL 发明的语法（SQLite 的形态同源），[官方 INSERT 文档](https://www.postgresql.org/docs/current/sql-insert.html)核实到的要点（2026-10-18，未在本机执行）：

```sql
INSERT INTO counters(key, n) VALUES ('page:home', 1)
ON CONFLICT (key) DO UPDATE
  SET n = counters.n + 1
RETURNING key, n;
```

文档给出的硬规则，逐条都是报错来源：

1. **裁判（官方称 arbiter index）必须是唯一索引或唯一约束**，三种写法：列清单、列清单 + `WHERE` 索引谓词（部分唯一索引必须用它指明）、`ON CONSTRAINT 约束名`；只有非 deferrable 的才作数，**EXCLUDE 排他约束不支持 DO UPDATE**。
2. `DO UPDATE` 必须写 conflict_target，`DO NOTHING` 才能省。
3. `DO UPDATE` 里旧行用表名/别名引用，待插入的那行是特殊表 **`excluded`**。
4. `DO UPDATE ... WHERE` 只决定更新哪些行，**所有冲突行都会被锁**（文档原文：all rows will be locked when the ON CONFLICT DO UPDATE action is taken）。
5. **一条命令里一个现存行只能被碰一次**：输入自带重复裁判键触发基数违例（预期含 `ON CONFLICT DO UPDATE command cannot affect row a second time`），批量导入先去重。
6. DO UPDATE 改分区键会让行「搬家」的，当前不支持（文档明确）。

`RETURNING` 让 INSERT/UPDATE/DELETE 直接带回受影响的列，语法同 SELECT 输出列表；current（18 版）文档页还支持 `NEW.*`/`OLD.*` 限定新旧值（纯插入时 OLD 为 NULL），旧版只有裸列名——移植前核对版本文档。SQLite 实测三种语句都能用：`{"id":5,"status":"ret"}`、`{"id":5,"total":99}`、`{"id":5}`；裁判键无约束时报 `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`，PG 同语义。

与乐观锁分工：[事务与并发](/database/transactions) 的 `UPDATE ... WHERE version = ?` 管「按版本改」，UPSERT 管「没有就插、有就按规则改」；UPSERT 没有「我读到的旧值必须没变」这个语义。

## CTE：v12 拆了优化栅栏，你可以再装回去

官方 SELECT 文档核实到的原文（[sql-select](https://www.postgresql.org/docs/current/sql-select.html)，未在本机执行）：

> By default, a side-effect-free WITH query is folded into the primary query if it is used exactly once in the primary query's FROM clause... PostgreSQL versions before v12 never did such folding, so queries written for older versions might rely on WITH to act as an optimization fence.

拆开讲：**12 之前非递归且无副作用的 CTE 一律先算完存住**，老手拿 `WITH` 当栅栏阻止优化器做坏决策；**12 之后「仅被引用一次且无副作用」的默认折叠**，可与外层联合优化（谓词下推、换连接顺序），引用多次仍物化一次。控制：`AS MATERIALIZED` 装回栅栏，`AS NOT MATERIALIZED` 强制内联（代价是可能算多遍）；递归与带 DML 的 CTE 不受提示影响。

开头那个升级事故就是它：为旧版本调出的计划在 v12+ 失效。确认：两边各跑 `EXPLAIN (ANALYZE, BUFFERS)` 对比计划形状，给需要栅栏的 CTE 补 `MATERIALIZED`。语法脚注：PG 的 CTE 里可以写 `INSERT/UPDATE/DELETE`（配合 RETURNING 做「删一批并统计」的原子流水），SQLite 拒绝，实测原文 `near "INSERT": syntax error`（[SQL 查询进阶](/database/sql-advanced)）。

## 部分索引与 INCLUDE：把索引建小，把覆盖扫描建出来

两个正交的工具，官方[索引文档](https://www.postgresql.org/docs/current/indexes.html)（未在本机验证）：

```sql
-- 部分索引（partial index）：只索引满足谓词的行
CREATE INDEX idx_orders_open ON orders (created_at) WHERE status = 'open';
-- 部分唯一索引：软删除/撤销场景的标配
CREATE UNIQUE INDEX uq_active_tenant ON memberships (tenant_id, user_id)
  WHERE revoked_at IS NULL;
-- 覆盖索引：INCLUDE 列不进 B-树键，挂在叶子（约 v11 起支持，以文档为准）
CREATE INDEX idx_orders_cover ON orders (status) INCLUDE (total, created_at);
```

要点：索引只覆盖满足谓词的行，成本随「热数据」走；**查询谓词必须蕴含索引谓词**才命中（`status='open'` 行，`status <> 'closed'` 蕴含不了）；[数据建模](/database/data-modeling) 的 `deleted_at` 软删除模式里，这是把「只查活行」写进物理层的手段。

INCLUDE 服务于 index-only scan：所需列全在索引里就不回堆；但它依赖**可见性映射（visibility map）**——页标记 all-visible 才敢不回堆查可见性，页里有死元组就退化成回堆随机 I/O。于是本章前后串成一条线：**VACUUM 的质量直接决定覆盖索引的收益**。SQLite 没这套，实测覆盖索引所见即所得：`SELECT count(*) FROM big WHERE s = hex(zeroblob(1500))` 的计划原文 `SEARCH big USING COVERING INDEX big_s (s=?)`，不碰主表。

## 全文检索与 pg_trgm：先回答中文怎么办

原生全文检索的核心类型是 `tsvector`（分词+词干化后的文档）与 `tsquery`（查询表达式），配 GIN 索引：

```sql
ALTER TABLE articles ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED;
CREATE INDEX idx_fts ON articles USING GIN (fts);
SELECT title FROM articles,
  websearch_to_tsquery('english', 'postgres -mysql "jsonb") q
WHERE fts @@ q LIMIT 10;
```

`websearch_to_tsquery` 容忍普通人写的查询串（引号短语、减号排除）。**但 `english`/`simple` 按空格标点切词，中文整句是一个巨型 token**——内置解析器不为中文分词，官方路线是接第三方扩展（zhparser、pg_jieba），不进 contrib、装不装看你部署方式（**未在本机验证**）。

`pg_trgm`（contrib）做三字符切分（trigram）相似度：一个用途是模糊/纠错匹配（`similarity('john','jonh')` 接近 1），一个是**给中缀 `LIKE '%州%'`、`ILIKE` 提速**——B-树帮不了的查询走 `gin_trgm_ops`：

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_shop_name_trgm ON shops USING GIN (name gin_trgm_ops);
SELECT name FROM shops WHERE name ILIKE '%咖啡%';  -- 预期走 trigram GIN
SELECT name FROM shops WHERE name % '星巴克';      -- % 相似度操作符
```

中文在 trigram 下按字符三元组工作，能用不是分词。决策：内部搜索、百万行级 → 内置够用；要中文分词质量、高亮、分面聚合 → 专业搜索引擎的活，选型思路见[领域建模](/computer-science/domain-modeling)。

## LISTEN / NOTIFY：可靠三个字，一个都没有

机制（[sql_notify](https://www.postgresql.org/docs/current/sql-notify.html) 口径，未在本机验证）：`NOTIFY channel, payload` 随当前事务提交一起生效，**事务回滚则通知不发**；只有此刻在线的会话收到，不排队、不补发、不确认；payload 有大小上限（文档约 8 KB 量级，以你版本为准）。

这三条决定它只能当「唤醒信号」不能当「消息队列」：正确用法是缓存失效广播、任务唤醒（通知只敲门，任务列表落表，收到去查——**数据在表里就不怕丢**）。把业务事件塞 payload，断线窗口的消息就蒸发了。不丢不重的语义归消息队列：[消息队列核心概念](/message-queue-cloud/mq-concepts) 与 [可靠投递](/message-queue-cloud/reliable-delivery)；Node `pg` 监听 `notification` 事件，形状以驱动文档为准（未验证）。

## 序列与标识列：号为什么会跳，谁在管你的主键

`serial` 是旧写法（本质=建一个序列+设 DEFAULT nextval），现行标准写法是标识列（identity column）：

```sql
CREATE TABLE orders (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,   -- 允许显式插值（导入用）
  ref text
);
CREATE TABLE seq_demo (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY);
INSERT INTO seq_demo VALUES (999);   -- 预期被拒：ALWAYS 不允许手填，除非 OVERRIDING SYSTEM VALUE
```

三条行为差异（文档口径，未验证）：**序列值不参与事务回滚**——插入失败、回滚，号照样消耗，PG 主键天生有洞，别拿「ID 连续」当业务事实；这与 SQLite 正相反，[事务与并发](/database/transactions) 实测 SQLite 的 AUTOINCREMENT 号**跟着回滚**（回滚后再插入仍是 1）。第二，`BY DEFAULT` 与 `ALWAYS` 的差别就在能否手填——带原 ID 迁移用前者或 `OVERRIDING SYSTEM VALUE`。第三，导入后序列不自动对齐，必须 `SELECT setval(pg_get_serial_sequence('orders','id'), (SELECT max(id) FROM orders))`，否则恢复出来的库一插入就撞主键——[备份与恢复](/database/backup-and-restore) 常见错误第 5 条的机制。

## 死元组、VACUUM 与 autovacuum：表不写也会肿

机制链条（[MVCC](https://www.postgresql.org/docs/current/mvcc.html) 与 [routine-vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)，未验证）：UPDATE 写新版本元组、DELETE 只打标记，旧版本不再被任何事务快照需要后成为死元组，由 VACUUM 回收（**空间还给表内复用、不还操作系统**，文件不缩小——与 SQLite 实测的「删后不缩、VACUUM 才缩」结论同型，机制无关）。autovacuum 按「变化行数占表大小的比例 + 固定余量」触发，默认参数以文档为准。

观测与膨胀的四种成因：

```sql
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;
SELECT pid, backend_xmin, xact_start, state, query
FROM pg_stat_activity WHERE xact_start IS NOT NULL ORDER BY xact_start;
```

四类元凶：① 长事务/idle in transaction 钉住 xmin（`backend_xmin` 非空就是它）；② 废弃复制槽同样钉住、顺带涨 WAL；③ 高频小更新 autovacuum 追不上，单独调该表阈值或改聚合写法；④ 索引膨胀让「行数没变、查询变慢」。`VACUUM` 不阻塞读写；`VACUUM FULL` 重写整表拿独占地，大表慎用（在线重写走 pg_repack 类扩展，未验证）。兜底红线：事务 ID 是 32 位，逼近回卷（wraparound）会强制激进 vacuum、再不管拒写保命——**长期无人清理的生产库，最坏结局不是慢，是停写**。

## 连接模型与观测：一条连接一个进程，慢查询要有名字

PG 每条连接 fork 一个后端进程，都带内存与调度成本；SQLite 是进程内库、[事务与并发](/database/transactions) 实测过它的锁是全库粒度，两边的「池」不是一个概念。上百直连上 pgbouncer，但 transaction pooling 下**会话状态会串**：`LISTEN` 收不到、`SET` 类参数不可靠、老驱动与服务端预编译语句冲突（新版 pgbouncer 已处理，看版本）。

观测两件套（[pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html)，未验证）：**进 `postgresql.conf` 的 `shared_preload_libraries` 并重启实例**，再每库 `CREATE EXTENSION`；查它按查询指纹聚合的耗时（总耗时大户往往是 `calls` 高的那条，不一定 `mean_exec_time` 最高）。单条 SQL 用 `EXPLAIN (ANALYZE, BUFFERS)`：真实执行统计 + `shared hit`（缓存页）/`read`（走盘页），预期形状：

```text
Hash Join  (actual time=1.2..8.4 rows=95 loops=1)
  Buffers: shared hit=213 read=40
  ->  Seq Scan on orders ...
```

读法与索引章一致：先看扫描节点行数估没估歪，再用 BUFFERS 分「算得多」还是「读得散」；系统化定位见[连接池与慢查询定位](/data-storage/connection-pool-and-slow-query)。

## RLS：把租户隔离下沉到数据库，但要配得对

行级安全（Row Level Security）在表上按策略过滤每一行（[ddl-rowsecurity](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)，未在本机验证）：

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_tenant ON documents
  USING (tenant_id = current_setting('app.tenant_id')::bigint)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::bigint);
```

四条记牢：① **开了 RLS 没挂策略，非豁免角色什么都查不到**（默认拒绝）——「列表页全空」是配置事故不是 bug；② 超级用户和**表 owner 默认绕过策略**，用建表账号跑应用等于没开，要 `FORCE ROW LEVEL SECURITY`；③ 策略按角色挂（`TO app_user`），别拿 admin 验证隔离；④ 参数走 `SET app.tenant_id` 会话级 GUC——**与 pgbouncer transaction pooling 是危险组合**：连接复用会把上一个租户的参数留给下一个请求，要么 session pooling，要么事务内 `SET LOCAL`。[授权与权限](/backend/authorization) 是主力，RLS 是兜底防线。

## 扩展生态：contrib 白捡，其余看你部署方式

`CREATE EXTENSION` 是库级操作：同实例两个库各装一遍。contrib 够日常：`pg_trgm`、`pg_stat_statements`、`citext`（大小写不敏感文本）、`btree_gin`、`postgres_fdw`；第三方大头是 **PostGIS**（地理类型与空间索引，依赖 GEOS 等系统库，未验证）和 **pgvector**（向量类型 + 近邻索引，RAG 的存储底座，见 [RAG：从文档到向量库](/ai-apps/rag-retrieval)）。能不能装由部署方式决定：云托管有白名单、apt 要另装 `-contrib`、容器自建随意——选型时把「需要哪些扩展、目标环境能不能装」列进去。另有一类要进 `shared_preload_libraries`（重启生效），与 `CREATE EXTENSION` 的轻量不是一回事。

## 常见错误与排查

**1. `->>` 查询全表扫，GIN 索引「无效」。** 建了 GIN 仍 Seq Scan：GIN 只服务 `@>`/`?` 族，标量比较不属于它。确认：`EXPLAIN` 看命中节点，改写成 `extra @> '{"city":"杭州"}'` 看是否变 Bitmap Index Scan（预期，未执行）。修法：等值热键建表达式索引或升格生成列。

**2. 升级到 12+ 后老 SQL 变慢。** SQL 一字未改 P99 翻倍：单次引用的 CTE 从物化变折叠，计划结构换了。新旧环境各跑 `EXPLAIN (ANALYZE, BUFFERS)` 对比。修法：需要栅栏的 CTE 显式 `MATERIALIZED`，别依赖「WITH 一定先算完」的旧直觉。

**3. `ON CONFLICT` 报 no unique or exclusion constraint matching。** 裁判子句炸掉：给的列组合没有唯一索引/约束，或部分唯一索引的谓词没在 `ON CONFLICT ... WHERE` 里重复。`\d 表名`（预期 psql 输出）核对。修法：补唯一约束或改写 conflict_target；批量导入先去重，否则触发「一个现存行不能被碰两次」的基数错误。

**4. 表持续膨胀、`n_dead_tup` 高、autovacuum 像没干活。** 行数不变文件疯涨，手动 VACUUM 也不见小：某长事务/废弃复制槽钉住了 xmin（上面第二条监控 SQL 抓）。应用侧找「开着事务调外部接口」的代码，机制账在[事务与并发](/database/transactions) 的「长事务的四笔账」。修掉长事务膨胀自然回落；计数器类高频表单独调 autovacuum 参数。

**5. 开了 RLS 列表页空了，或越权没被测出来。** 空表多为 `current_setting('app.tenant_id')` 没设或策略角色没覆盖连接账号；「隔离生效」的验证也可能是假象——**表 owner/超级用户默认绕过 RLS**。换受限角色跑同一条查询确认；用 FORCE + 非 owner 角色验收，连接池复用场景检查 `SET LOCAL` 的事务边界。

**6. 断线重连后「消息丢了」。** 客户端重启期间的事件再也收不到：通知只发给当时在线的会话，无队列无历史（双 psql 会话可验证，预期实验未执行）。修法：通知只当门铃，载荷落表；要队列语义上[消息队列](/message-queue-cloud/mq-concepts)。

## 练习

<Exercise title="练习 1 · 给 JSONB 热键选存储方案" difficulty="基础">

订单表 `orders(id, status, extra jsonb)`，一百万行。两个新需求：a) 列表页高频 `WHERE extra->>'channel' = 'app'`；b) 运营偶尔要 `extra @> '{"coupon":{"type":"fixed","value":500}}'` 的包含查询。各建什么索引（写 DDL）？哪个键该升格成生成列、为什么？

<template #answer>

a) 表达式索引 `CREATE INDEX ON orders ((extra->>'channel'))`——等值标量比较 GIN 帮不上；若 `channel` 成为核心维度还要参与聚合或约束，升格为 `GENERATED ALWAYS AS (extra->>'channel') STORED` 生成列再建普通索引。b) `CREATE INDEX ON orders USING GIN (extra jsonb_path_ops)`，专吃 `@>`，比默认操作符类小且快（文档口径，未在本机验证）。判断线：**每天出现在 WHERE 的键进索引，长期有业务语义的键进列，偶尔整段取的留 JSONB。**

</template>

</Exercise>

<Exercise title="练习 2 · 预测升级后的计划" difficulty="进阶">

下面这条 SQL 在 11 上稳定，升到 12+ 后外层突然走了大表的坏计划：

```sql
WITH top_users AS (
  SELECT user_id, sum(amount) s FROM pays GROUP BY user_id ORDER BY s DESC LIMIT 100
)
SELECT u.name, t.s FROM top_users t JOIN users u ON u.id = t.user_id;
```

按官方文档解释 12+ 的默认行为为什么变了，写出改动最小的一行修复。追问：CTE 被外层引用两次时，默认行为是什么？

<template #answer>

12+ 默认把「无副作用且仅被引用一次」的 CTE 折叠进主查询，`ORDER BY ... LIMIT` 不再保证先物化 100 行再 JOIN，优化器可能把 join 关系推下去换计划。修复：`WITH top_users AS MATERIALIZED (...)` 恢复栅栏。文档同时说被引用多次默认仍物化（折叠只适用于 exactly once）——「引用一次出问题、引用两次反而没事」正是这类升级事故的指纹。依据官方 SELECT 页原文（已核实引用），计划差异本身未在本机验证。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造 UPSERT 报错" difficulty="进阶">

SQLite 本机可以直接跑，PG 上是同款语义（未在本机验证）。建表与插入：

```sql
CREATE TABLE t(k INTEGER PRIMARY KEY, v INTEGER);
INSERT INTO t VALUES (1, 10);
INSERT INTO t(v) VALUES (99) ON CONFLICT (v) DO UPDATE SET v = excluded.v;
```

第三条语句会得到什么？再说明：`ON CONFLICT (k) DO NOTHING` 撞冲突与 `DO UPDATE` 未触发时，本机 `changes` 各是多少；最后解释 DO NOTHING「不报错」为什么反而危险。

<template #answer>

本机实测（Node v25.4.0 + node:sqlite 3.51.1）：`ON CONFLICT (v) DO UPDATE` 在 v 上没有任何唯一约束时报 **errcode=1，原文 `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`**。PG 的预期是同语义报错（no unique or exclusion constraint matching the ON CONFLICT specification），没跑过就不装跑过。实测：DO NOTHING 撞冲突被跳过时 `changes=0`，DO UPDATE 未触发冲突走正常插入时 `changes=1`。最后一条是工程判断：`DO NOTHING` 把「撞了唯一键」静默吞掉，导入脚本以为全成功实际少了一批，对账时行数对不上；要么 `RETURNING` 数真插了几行，要么对 `changes` 做断言。

</template>

</Exercise>

<Exercise title="练习 4 · 设计一个不丢事件的唤醒方案" difficulty="挑战">

需求：库存变更后，三个应用实例的本地缓存要失效，「晚 1 秒失效可接受，漏失效不可接受」。有人提议直接 NOTIFY 携带 sku_id。指出失效模式，给出「通知 + 表」的组合设计，说明版本号放哪、断线重连后怎么补。

<template #answer>

纯 NOTIFY 的失效模式：目标会话当时不在线、payload 超限、进程崩溃错过信号——无历史无确认，错过就是永久不一致。设计：① 同一事务里更新库存并 bump 一行 `sku_versions`（RETURNING 拿新版本，UPSERT 写法见本章）；② 提交后 `NOTIFY stock, 'wake'`，payload 不承载正确性；③ 实例收到信号就拉「版本大于本地记录」的变更；④ 启动/重连先全量对一次版本表，之后增量；⑤ 定时兜底轮询把丢通知的上界从永久压到轮询间隔。信号丢失只影响延迟不影响最终一致——这才叫可迟不可漏。

</template>

</Exercise>

## 官方文档与延伸阅读

- [PostgreSQL SELECT 文档](https://www.postgresql.org/docs/current/sql-select.html) —— WebFetch 核实：CTE 折叠默认与 v12 变化、MATERIALIZED/NOT MATERIALIZED、LIMIT/OFFSET 无逗号语法（摘于 2026-10-18，未在本机执行）。
- [PostgreSQL INSERT 文档](https://www.postgresql.org/docs/current/sql-insert.html) —— WebFetch 核实：ON CONFLICT 裁判规则、excluded 表、DO UPDATE 必须带 conflict_target、锁全部冲突行、同行二次修改报错、RETURNING 表述。
- [生成列文档](https://www.postgresql.org/docs/current/ddl-generated-columns.html) —— WebFetch 核实：immutable 限制、禁子查询、不引用另一生成列；VIRTUAL 可用性以你版本文档为准。
- [JSON 类型](https://www.postgresql.org/docs/current/datatype-json.html) 与 [CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html) —— json vs jsonb、GIN、部分/INCLUDE 索引出处；未在本机验证。
- [全文检索](https://www.postgresql.org/docs/current/fulltext.html) 与 [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) —— tsvector 中文分词限制、三元组索引。
- [NOTIFY/LISTEN](https://www.postgresql.org/docs/current/sql-notify.html)、[标识列](https://www.postgresql.org/docs/current/ddl-identity.html)、[MVCC](https://www.postgresql.org/docs/current/mvcc.html) 与 [VACUUM 运维](https://www.postgresql.org/docs/current/routine-vacuuming.html)、[pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html)、[行级安全](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) —— 在线投递语义、序列不回滚、死元组与回卷保护、预加载要求、owner 默认绕过 RLS。

## 下一章

这一章每个特性都带着「预期结果」四个字——本机没有 PG 服务，诚实的写法只能到这里。[MySQL 差异对照](/database/mysql-differences) 走另一条路：同一个操作在 SQLite、PostgreSQL、MySQL 三边各是什么结果，SQLite 那一列全部用 `node:sqlite` 真跑取输出——类型亲和怎么静默吞下 `'123abc'`、DDL 能不能回滚、裸非聚合列为什么在 SQLite 不报错，答案都在真实输出里；PG/MySQL 两列继续标注未在本机验证。往前依赖[备份与恢复](/database/backup-and-restore) 的 RPO/RTO 语境与[事务与并发](/database/transactions) 的锁机制；再往后，[数据访问设计](/database/data-access-design) 会把这些数据库侧的账并进应用侧的 ORM 与分页决策里。
