# 数据访问层到底隔离了什么：N+1、分页与抽象泄露的现场

一个 20 条记录的列表接口，线上平均响应 3.8 秒，日志里翻出 41 条 SQL；同一天，另一个接口的 JSON 里带着 `internal_note`、`quota` 和别人的 `tenant_id`，因为它把 ORM 查出来的对象直接 `return` 给了框架。这两件事根因相同：**有人把「怎么拿数据」和「拿到数据之后干什么」揉在了一层**，于是数据库的形状决定了接口的形状，对象图决定了 SQL 的条数。

数据访问层（data access layer）不是「把 SQL 从路由里搬出来」这么轻的动作。它要回答三件可量化的事：**一层要隔离哪种变化**（换数据库、换 ORM、改表结构、改查询形状），**一次请求发多少条语句**，**分页在数据变动时还给不还给得出一致的结果**。这三件事都能在本机测出来，本章的所有数字都是这么来的。

前一章 [MySQL 差异对照](/database/mysql-differences) 处理「同一份 SQL 在不同引擎上行为不一致」，本章处理「同一份需求在代码里应该怎么分层」；两者会在你写列表接口时同时命中。

## 三种风格隔离的变化不是同一种

| 风格 | 代表 | 对象长什么样 | 真正被隔离的变化 | 没被隔离的东西 |
| --- | --- | --- | --- | --- |
| Active Record | Rails、Laravel Eloquent | 实例自带 `save()` / `destroy()` | 「表有哪些列」→ 属性访问，不用写映射代码 | 查询形状、事务边界、SQL 条数（懒加载长在对象上） |
| Data Mapper + Unit of Work | Doctrine、Hibernate | 纯数据对象，映射规则单独一份 | 表结构与对象结构解耦、一次请求内的变更集与写顺序 | 映射代码你自己写，领域对象仍可能只是数据袋子 |
| Repository | DDD 常见做法，常与前两者叠加 | 领域对象 + 一个 `findById` 门面 | 「这次查询怎么表达」：换 JOIN、换缓存、换索引、换引擎都关在实现里 | 返回的还是 ORM 实体的话，抽象照样从接口上漏出去 |

**判据只有一条：让被隔离的那类变化真的只影响这一层。** 常见的错位是拿 Repository 去隔离「表改名」，然后接口的响应体仍然是实体字段清单。本站[后端领域的分层架构](/backend/layered-architecture) 讲过路由 / service / repository 的分工，那里的结论在这里要收紧：**repository 只能返回你自己定义的行形状或领域对象，不能返回 ORM 实体本身**。

## 抽象泄露的四个现场，前两个最贵

**现场一：把 ORM 对象直接当 API 响应。** 实测这张表（`resource(id, title, owner_id, tenant_id, quota, role, internal_note, created_at)`）查出的行原样序列化后，响应字段是：

```text
id,title,owner_id,tenant_id,quota,role,internal_note,created_at
```

其中 `internal_note` 的值是 `内部备注1`。这就是「表结构就是接口契约」的代价：以后给表加一列，接口响应体**自动**多一个字段，前端跟着被改，而迁移文件里没有任何地方提醒过这件事。

**现场二：查询发在序列化的那一刻。** 给行对象挂一个惰性 getter（惰性加载的本质就在这里），计数器只在 getter 里加：

```text
取完列表后，SQL 条数 = 1        （作者一次都没查）
JSON.stringify(列表) 之后 = 21  （20 条查询发生在序列化这一刻）
Object.keys(list[0]) 之后   = 0 （只列字段名不会读值，一条都不发）
```

第三条尤其值得记住：**打印字段名、断言 key 存在都不会触发查询**，只有真正读值的那一行会。所以「我本地测的时候只有一条 SQL」和「框架序列化响应时发了 21 条」可以同时成立，而且只有后者出现在生产日志里。

**现场三：校验层反向依赖列名。** 入参校验对象直接复用实体的列清单，「列名」就成了对外契约，改列名要改校验、改前端、改文档三处。

**现场四：把业务规则写进 SQL 字符串里。** 例如把「只有 owner 或 admin 能改」写进 repository 的 `WHERE`；调优时重写那条 SQL，规则随之蒸发。授权判断该在 service 层（见 [授权与权限](/backend/authorization)），repository 只按已经收窄好的条件取行。

## N+1 的成因：一次行集合，一次对象图

SQL 返回的是**扁平的行集合**，接口要的是**嵌套的对象图**。把前者变成后者只有两种办法：一次取回带重复的扁平行、在内存里分组；或者先取主行、再按需为每个关联补查。第二种就是 N+1：1 条主查询，加上 N 行 × 每个关联 1 条。

它之所以顽固，是因为**惰性加载在单条记录上完全正确**：查一个资源、顺带读它的作者，1 + 1 条毫无问题；同一段代码进了列表循环，`N` 从 1 变成 20，条数就变成 41。写的时候没有错，用错的是调用它的场景。

## 三类解法与实测条数：1、2、3、21、41

下面这组数字全部来自本机 `node:sqlite`：200 条资源、5 个作者、20 个标签、601 条多对多关联（平均每资源 3.005 个标签），列表页固定 20 条，计数器只统计「通过封装函数发出的语句」。

| 方案 | 关联数 = 1（作者） | 关联数 = 2（作者 + 标签） | SQL 条数 | 取回行数 |
| --- | --- | --- | --- | --- |
| 只取主表 | — | — | **1** | 20 |
| 惰性加载（每行按需查） | 1 + 20 | 1 + 20 + 20 | **21 → 41** | 20 + 20(+20) |
| 批量 `IN` 二次查询 | 1 + 1 | 1 + 1 + 1 | **2 → 3** | 20 + 2（去重后） |
| JOIN 一次取回（先分页再连） | 1 | 1 | **1** | 20 → 61 扁平行 |
| DataLoader 式按批合并 | 1 + 1 | 1 + 1 + 1 | **2 → 3** | 同批量 IN |

<Callout type="verified" title="本章 SQL 条数、分页结果与执行计划均为本机实测">

Windows 10 + Node v25.4.0，内置 `node:sqlite`，`SELECT sqlite_version()` 返回 **3.51.1**，日期 2026-10-18。计数器是一个包在 `db.prepare()` 外面的自增变量，所有查询都经过它，所以条数是数出来的不是推算的。耗时用同进程重复执行取中位数，**内存库或单文件库、单连接、无并发进程**；换到 PostgreSQL 加连接池，绝对值会变，但「条数」和「执行计划形状」这两类结论不依赖本机。文末标出我只做了文档核实的部分。

</Callout>

三个方案各自的取舍，写进代码评审清单：

| 方案 | 优点 | 代价 | 什么时候别用 |
| --- | --- | --- | --- |
| JOIN 一次取回 | 1 条语句，数据库侧一次完成 | **行复制**：20 资源 × 3.05 标签 = 61 行，必须分组还原 | 多个一对多同时预加载时复制系数相乘，行数爆炸，退回批量 `IN` |
| 批量 `IN` | 条数固定（1 + 关联数），行数不复制，分页语义干净 | 要自己去重 key、自己拼回对象图；`IN` 列表长度有限 | 关联行本身很多时（每行几百条），一次拉回几十万行，得分片 |
| 按批合并（DataLoader 式） | 调用点仍是「按行取」，框架在同一批微任务里合并成一次 `IN` | 需要批处理边界（请求结束前 flush）；跨请求不合并 | 每行 key 几乎都不同时退化成一次 `IN`，不如直接写批量查询 |

**`LIMIT` 与 JOIN 的先后顺序是一个真会踩的坑。** 实测：`FROM resource JOIN resource_tag JOIN tag ... ORDER BY p.id LIMIT 20` 返回 20 行，只覆盖 **11 个资源**——`LIMIT` 数的是行不是资源。正确写法是先定分页再连接（本机 1 条语句、61 行、覆盖 20 个资源）：

```sql
WITH page AS (
  SELECT id, title, owner_id, created_at FROM resource
  WHERE tenant_id = ? AND deleted_at IS NULL
  ORDER BY created_at DESC, id DESC LIMIT 20
)
SELECT p.id, p.title, u.name AS author, t.name AS tag
FROM page p
  JOIN usr u ON u.id = p.owner_id
  LEFT JOIN resource_tag rt ON rt.resource_id = p.id
  LEFT JOIN tag t ON t.id = rt.tag_id
ORDER BY p.id, t.id;   -- 实测：1 条语句，61 行，20 个资源，复制系数 3.05
```

`LEFT JOIN` 是必须的：用 `JOIN` 会把「没有标签的资源」整条丢掉，于是 20 条一页只剩 18 条——分页与关联叠加时的经典缺行。

## 预加载还是惰性加载：按调用点决定，而不是按模型决定

| 维度 | 预加载（eager） | 惰性加载（lazy） |
| --- | --- | --- |
| 语句条数 | 1 或 1 + 关联数，请求开始就确定 | 取决于谁读了哪个属性，请求结束时才知道 |
| 列表接口 | 唯一安全选择 | 禁止（这就是 41 条的来源） |

三条规矩：**响应形状决定预加载清单**（响应里是计数的不要取成对象数组）；**惰性加载要么全关要么显式**（关掉的表现为「访问未加载属性直接抛错」，这比让它长在序列化阶段好）；**序列化之前完成所有取数**（在 handler 里映射成 DTO 再返回）。

至于「连接已归还之后才访问惰性属性」：本机 `close()` 后访问抛的是 `Error: database is not open`。连接池归还后的措辞因驱动而异，但形状一致——**报错发生在离查询很远的地方**。Prisma 没有惰性关系加载所以不存在这一类，TypeORM / Sequelize 会踩到。

## 分页三方案：OFFSET 的漂移是语义问题，深翻只是它的副作用

先看正确性。**同一份数据、同样翻 6 页**，OFFSET 与 keyset 都不重不漏；一旦翻页过程中有人在写：

| 场景（`ORDER BY created_at DESC, id DESC`，100 行起底，每页 20 行） | 取回行数 | 不同行数 | 重复 | 漏行 |
| --- | --- | --- | --- | --- |
| 无并发写 · OFFSET | 100 | 100 | 0 | 0 |
| 无并发写 · KEYSET | 100 | 100 | 0 | 0 |
| 第 1 页之后另一连接插入 5 条更新的行 · **OFFSET** | 105 | 100 | **5** | **5** |
| 同样插入 · **KEYSET** | 100 | 100 | **0** | 5（就是新插入的 5 条） |
| 每页之后删掉最旧的 3 行 · OFFSET | 88 | 88 | 0 | 0 |
| 每页之后删掉最旧的 3 行 · KEYSET | 88 | 88 | 0 | 0 |

「另一连接」是真的两个 `DatabaseSync` 打开同一个 `.db` 文件，不是模拟。重复的行具体是哪些，一眼就能看懂：

```text
第 1 页末尾 3 个 id = 18,19,20
第 2 页开头 3 个 id = 16,17,18   ← 16、17、18 已经在第 1 页出现过
```

反过来删数据也漏。删掉排序最靠前的 3 行（`id` 最大那三条）后，整个窗口上移：

```text
游标法第 2 页 = 80,79,78,77,…,61
OFFSET 第 2 页 = 77,76,75,…,58
两页之间被跳过的既有行 = 80,79,78   ← 用户永远看不到这三条
```

**结论：OFFSET 的语义是「跳过当前结果集的前 n 行」，而当前结果集正在变。** 只要列表可写，它必然重或必然漏：重复让用户以为数据有问题，漏行让用户以为数据丢了。KEYSET 的「漏」只发生在新写入的行上（它们本该在下次刷新出现），这是可接受的。

性能那一面（同机、`node:sqlite`）：

| 查询形状 | 无索引 | 有对应索引 |
| --- | --- | --- |
| `OFFSET 0` | 27.4 ms | 0.2 ms |
| `OFFSET 100000`（20 万行表） | 75.7 ms | 7.4 ms |
| `OFFSET 190000` | 122.5 ms | 14.3 ms |
| 游标取同一深度 | 13.4 ms | 0.6 ms |
| 执行计划（`OFFSET 100000`） | `SCAN doc` + `USE TEMP B-TREE FOR ORDER BY` | `SCAN doc USING INDEX idx_doc_sort` |

`OFFSET` 的代价是**线性**的：偏移从 2 万涨到 19 万，耗时 0.5 ms → 5.1 ms（有索引、只投影索引列的最干净情形）；排序形状不合索引时还要先付一次全量临时 B-树排序（75.7 ms 起）。这与[第 6 章 索引](/database/indexes) 里 `OFFSET` 119.4 ms vs 游标 2.6 ms 是同一件事。

## keyset 的三个工程细节：复合游标、排序方向、稳定排序键

**一、排序键必须唯一，否则一定漏行。** 我特意造了一张 100 行但只有 20 个不同 `created_at` 值的表，用「只用时间戳 + 严格小于」做游标：

```text
第 2 页 = 21,22,23,24,25,16,17,18,19,20,11,12,13,14,15,96,97,98,99,100
与第 1 页重复 = 0 条
两页没覆盖到的行 = 60 条     ← 并列值里被整段跳过的记录
```

不重复，但**漏了 60 条**。所以游标必须是「完整排序键」：`ORDER BY created_at DESC, id DESC` 就得把 `(created_at, id)` 都放进游标。`id` 作决胜键不是为了排序美观，是保证排序全序、结果可复现。

**二、复合游标的三种写法，执行计划差 200 倍。** 这是本章最意外的一个实测结果：

```text
写法 A：WHERE created_at < ?                        （单列，不含 id）
        计划 SEARCH doc USING INDEX idx_sort (created_at<?)      耗时 0.0 ms
写法 B：WHERE created_at < ? OR (created_at = ? AND id < ?)
        计划 SCAN doc USING INDEX idx_sort                        耗时 8.7 ms
写法 C：WHERE (created_at, id) < (?, ?)             （行值比较）
        计划 SEARCH doc USING INDEX idx_sort (created_at<?)      耗时 0.0 ms
```

**教科书上最常见的 `OR` 写法（B）是唯一退化成 `SCAN` 的那个**——`OR` 让优化器无法把条件收成一个区间，只能扫全部索引条目。SQLite 3.51.1 支持行值比较（row value constructor），写法 C 既语义正确又能走 `SEARCH`。若你的引擎不支持行值比较（这一条我只在 SQLite 上验证过），退路是 `created_at <= ?` 再在内存里剔掉游标行，或把游标编码成一个可比较的字符串。

**三、排序方向要写进游标契约。** `created_at < ?` 配 `DESC`，`created_at > ?` 配 `ASC`。游标应当由**服务端生成**（把 `(created_at, id, 排序签名)` 编进不透明 token），而不是让客户端传裸值——裸值一旦可被篡改，就是「越权往前翻」和「构造超大 `IN` 列表」的入口。

还有第三类分页要认账：**跳跃到第 N 页**只有 OFFSET 能做。实测 `COUNT(*)`（10 万行、带 `tenant_id` 与软删除过滤）**0.2 ms**，说明显示总条数不贵，贵的是给用户点第 500 页的能力；折中是「只给上一页/下一页」+ 顶部总数。

## 事务边界：放在 service，不放 repository

本机两组实测，同一个「A 扣钱、B 加钱」，差别只在事务开在哪一层。

```text
反例：repository 的 debit / credit 各自 BEGIN + COMMIT
  credit 抛 CHECK constraint failed: bal >= 0
  账户 = [{"id":1,"bal":90},{"id":2,"bal":50}]   流水条数 = 1
  → A 的 10 元已经扣走并已提交，B 一分没收到，账不平，且没人能回滚它

正例：service 层一个事务包住两步
  同样抛 CHECK constraint failed: bal >= 0
  账户 = [{"id":1,"bal":100},{"id":2,"bal":50}]   流水条数 = 0
  → 全部回到原地
```

判据：**事务边界 = 一个业务不变量必须同时成立的范围**。一次转账是一个不变量，所以它是一个事务；「取用户 + 取他的资源」不是写操作，不需要事务。repository 开事务是最常见的架构错误：它把边界的决定权交给了最不了解业务的人，而且当 service 调两个 repository 时，两个事务已经无法合并。

配套的四条实测细节：

- **`UPDATE` 影响 0 行不抛错。** `run()` 返回 `{changes: 0}`（更新一个不存在的账户），必须自己判；乐观锁就靠它：`UPDATE doc SET body=?, ver=ver+1 WHERE id=? AND ver=?`，匹配版本 `changes=1`，版本过期 `changes=0`（本机实测两个值）。
- **SQLite 不允许嵌套事务**：第二次 `BEGIN` 直接 `cannot start a transaction within a transaction`。所以 repository 不能假设自己在外层事务里，得由调用方把事务上下文传进去（`BEGIN IMMEDIATE` 是 service 层该用的形式）。事务里读自己的写看得见：改成 42 后同事务读到 42，`ROLLBACK` 后另一条读到 60。
- **事务不能包住慢操作。** 本机把 2 万条 `INSERT` 放进一个事务，持有写事务 **101.2 ms**，期间别的连接写不进去。别在事务里调外部 HTTP、生成缩略图、发订阅消息——那些该拆成后台作业（见 [文件上传、定时任务与后台作业](/backend/uploads-and-jobs)）。

## 连接与语句复用：三种「复用」是三件事

| 复用什么 | 语义 | 本机实测 |
| --- | --- | --- |
| 语句（prepared statement） | 同一条 SQL 文本只编译一次，换参数重复执行 | 2 万次点查：复用预编译 **26.3 ms**，每次重新 `prepare` **184.5 ms**（7 倍） |
| 连接 | 免掉 TCP / TLS / 认证 / `search_path` 的握手成本 | `node:sqlite` 是同步单连接，没有这层；见 [连接池与慢查询定位](/data-storage/connection-pool-and-slow-query) |
| 执行计划 / 缓冲池 | 服务端缓存计划、页面常驻内存 | 未在本机验证 |

绑定的语义也要认清楚：`node:sqlite` 的 `run()` 返回 `{changes, lastInsertRowid}`，`lastInsertRowid` 的 `typeof` 是 `number`（`setReadBigInts()` 才转 BigInt）。参数绑定挡住注入是实测出来的：

```text
字符串拼接   WHERE id = 1 OR 1=1   → 匹配 50000 行（全表）
参数绑定     传 "1 OR 1=1" 给同一条语句 → 0 行（无匹配）
```

`IN` 列表的长度不是无限的：本机实测把占位符开到 **32766** 个仍可准备语句，到 40000 仍通过——所以**别指望「一次 `IN` 装下全部」**是稳妥的工程判断，而具体上限属引擎与版本属性，跨引擎以服务端配置为准。批量方案按每 500～1000 个 key 分片比查上限可靠。

## 手写 SQL 与 ORM 共存：给手写留三条正门

共存不是「哪里慢就在哪里塞 SQL」，而是**给不同形状的查询规定入口**：

1. **视图（view）**：报表类、跨表的稳定读形状。实测把一段带 `GROUP BY` 的聚合建成视图后，`EXPLAIN QUERY PLAN SELECT * FROM v_top_author` 的计划是 `CO-ROUTINE v_top_author → SCAN r → SEARCH a USING INTEGER PRIMARY KEY (rowid=?) → USE TEMP B-TREE FOR GROUP BY → USE TEMP B-TREE FOR ORDER BY → SCAN v_top_author`。视图**不会**替你优化：两个临时 B-树照样在里面，外层 `WHERE` 也不一定下推。它的价值是把 SQL 的所有权收进迁移文件（见 [迁移与版本管理](/database/migrations)），让 ORM 侧把它当表查。
2. **CTE / 子查询**：分页 + 关联这种「先定窗口再连接」的形状（上面那段 `WITH page`）。ORM 的关系预加载表达不了「分页发生在连接之前」，这正是该手写的时候。
3. **逃生舱（驱动原生 API）**：`EXPLAIN`、`PRAGMA`、引擎专有语法。这些永远手写，且不该出现在 service 里。

判断标准：**同一条 SQL 会不会被第二个模块改坏。** ORM 生成的语句没人 review，手写 SQL 进了迁移文件或专门的查询模块就能 review、能版本化。反过来，把业务规则塞进手写 SQL 是把现场四的泄露从另一侧搬回来。

## 类型安全的边界：它能保证什么，保证不了什么

Prisma 与 Drizzle 都被宣传为「类型安全」，这句话有明确边界：Prisma 从 schema 生成客户端类型，Drizzle 的类型由表定义推导，而 **Drizzle 官方明确写着它不是 ORM、没有 ORM 那些特性**（因此没有惰性关系加载与身份映射）。本机没装任何一个（也不许装），下面只做文档核实。

<Callout type="unverified" title="Prisma / Drizzle：特性名级别的回忆，未运行也未逐条核对原文">

Windows + Node v25.4.0，`node_modules` 里没有 `prisma`、`@prisma/client`、`drizzle-orm`，本章没运行过任何一行 ORM 代码，本次联网逐条核对文档也没成功。所以下面只是**特性名级别**的记忆，不是文档原文引用，API 拼写、默认值、版本一律以官方文档当前版本为准。

- Prisma 用 `include` 在一次查询里带回关系，用 `select` 收窄字段（用于减少传输量）；关系过滤/排序另有 `where` / `orderBy` 嵌套参数。
- Prisma 文档把「先查 users、再在循环里查每篇 post」列为要避开的 N+1 形态，解法是关系查询与批量查询——与本章实测 21 → 2 是同一件事。
- Prisma 侧**没有惰性关系加载**：关系只在 `include` / `select` 里出现，未请求就是 `undefined`。于是现场二（序列化时发 SQL）在 Prisma 上不会发生；代价是忘写 `include` 只拿到 `undefined`，不会自动补查——这是更好的失败方式。
- Prisma 的事务 API 是 `db.transaction()`（文档当前写法；历史版本与不同 driver 封装里也写作 `$transaction`，动手前核对你的版本）。
- Drizzle 的关系查询通过 `relations` 定义 + 查询侧的 `with` 选项表达（官方叫 relational query builder），也提供 prepared statements、`sql` 片段与事务；它自述「不是 ORM」，没有 unit of work / identity map，所以「repository 返回 ORM 实体」这个问题在它那里自动消失，代价是对象图组装要你自己写。

</Callout>

类型保证得了与保证不了的，实测能分开：

| 保证得了（编译期） | 保证不了（要数据库或你自己兜住） |
| --- | --- |
| 列名写错、字段拼错、类型不匹配的赋值 | **值域**：`role` 只能是三种之一（SQLite 侧靠 `CHECK` 兜住，本机报错原文 `CHECK constraint failed: v > 0`） |
| 关系是否存在、可空性（`?` 与 `!`） | **外键是否真的生效**：`node:sqlite` 默认读到 1，但 SQLite 官方默认**关闭**且是连接级开关，忘开时插孤儿行不报错 |
| 查询返回行的静态形状 | **多对多返回的是行还是对象**、行复制系数、`LIMIT` 到底数的是行还是资源（实测 20 行只覆盖 11 个资源） |
| — | **条数与性能**：类型系统看不见 N+1，也看不见 `SCAN`。41 条语句的代码可以完全类型正确 |

第三列那两行是本章想让你带走的重点：**类型安全不覆盖 SQL 条数、执行计划与分页语义**，那些必须靠实测和 `EXPLAIN`。类型机制本身不在本章范围，本站数据存储领域另有两章：[Prisma 深入：关系查询与事务](/data-storage/prisma-deep-dive) 与 [原始 SQL、Drizzle 对照与类型安全边界](/data-storage/raw-sql-and-drizzle)。

## 常见错误与排查

1. **列表接口日志里 SQL 条数 = 1 + N × 关联数。** 现象：41 条几乎一样的 `SELECT ... WHERE id = ?`。原因：惰性加载进了循环。怎么确认：本机那种「包一层计数器」最直接；有查询日志就看参数不同的重复语句。怎么修：预加载清单按响应形状定；关不掉的惰性加载就在序列化前遍历一遍取完；跨表多个一对多退回批量 `IN`（实测 3 条）。

2. **报错发生在框架序列化阶段，堆栈里没有业务代码。** 现象：`database is not open` / 「连接已归还」。原因：现场二——查询发在取数之后。怎么确认：计数器在 `JSON.stringify` 前后各读一次（实测 1 → 21）。怎么修：取数全部发生在 handler 返回之前。

3. **用户投诉「同一条记录看到两次」或「那条不见了」。** 现象：OFFSET 分页 + 列表可写。原因：偏移量相对当前结果集，而结果集在变。怎么确认：第 1 页末 3 个 id 与第 2 页首 3 个 id 有交集（实测 16,17,18 重复）；删数据方向是两页之间跳过 80,79,78。怎么修：改 keyset 游标，游标带完整排序键；要「跳页」的产品形态另做取舍。

4. **游标分页明明写了条件却还是慢。** 现象：`WHERE a < ? OR (a = ? AND b < ?)` 计划是 `SCAN ... USING INDEX`。原因：`OR` 让优化器收不出区间。怎么确认：`EXPLAIN QUERY PLAN` 看 `SEARCH` 还是 `SCAN`（实测 8.7 ms vs 0.0 ms）。怎么修：换行值比较 `(a,b) < (?,?)`，或把游标编成单列可比较值。

5. **翻页漏了一大段数据，且没有重复。** 现象：游标只带 `created_at`，两页覆盖不到 60 条。原因：排序键不唯一，并列值被整段跳过。怎么确认：`SELECT COUNT(*), COUNT(DISTINCT created_at) FROM resource`（本机 100 行 / 20 个不同值）。怎么修：`ORDER BY` 补决胜列（通常是主键）并一起放进游标。

6. **转账事故：钱扣了没到账，日志里没有异常。** 现象：余额与流水条数不一致（实测 `bal=90 / bal=50`、流水 1 条）。原因：事务开在 repository，两步各自提交。怎么修：事务上移到 service；每步 `UPDATE` 判 `changes`；不变量单独写测试（参考[第 7 章 事务与并发](/database/transactions)）。

## 练习

<Exercise title="练习 1 · 预测四种写法的 SQL 条数" difficulty="基础">

列表页固定 20 条资源，每条要展示 1 个作者和若干标签。预测下面四种写法各发几条 SQL、取回几行，再照本章场景（200 资源 / 5 作者 / 20 标签 / 601 关联）在本机跑一遍对答案：

1. 查列表，循环里读 `row.author.name` 和 `row.tags.length`（惰性）
2. 查列表，再一次 `IN (去重后的 author_id)` 取作者，再一次 `IN (资源 id)` 取标签
3. 一条语句 `FROM resource JOIN author JOIN resource_tag JOIN tag ... LIMIT 20`
4. 一条语句，`WITH page AS (列表 LIMIT 20)` 之后再连三张表

哪一条会缺资源？哪一条行数最多？

<template #answer>

1 → **41 条**（1 + 20 + 20）。2 → **3 条**（列表 + 去重后的作者 `IN` + 标签 `IN`），作者只回 2 行。3 → 1 条，但返回 **20 行只覆盖 11 个资源**：`LIMIT` 数的是 JOIN 之后的行，多对多把行放大了，所以它缺资源。4 → 1 条，返回 **61 行、覆盖 20 个资源**，复制系数 3.05，需要在内存里按资源分组。

行数最多的是 3 和 4。条数与行数要分开看：本表只有 2 个作者可选，去重效果显著，所以 2 的作者 `IN` 只回 2 行；若每行作者都不同，第二次查询就会回 20 行——条数不变、行数上升，仍然是 1 + 1。

</template>

</Exercise>

<Exercise title="练习 2 · 把分页翻错，并解释漏掉的是谁" difficulty="进阶">

一张表 100 行，`created_at` 只有 20 个不同值（每值 5 行并列）。用 `ORDER BY created_at DESC LIMIT 20` 取第一页，取末行的 `created_at` 作游标，用 `WHERE created_at < 游标 ORDER BY created_at DESC LIMIT 20` 取第二页。

1. 第二页会不会与第一页重复？
2. 会不会漏行？漏多少？
3. 改成 `<=` 之后呢？
4. 给出正确的游标谓词（两种写法），并说明各自的执行计划风险。

<template #answer>

1 不重复（严格小于把游标那一行的值整段排除）。2 漏 **60 条**：并列值被当成一个整体跳过——同一 `created_at` 下第一页只取到 5 行中的部分，剩下的那些因为值不小于游标而永远进不了第二页。3 改 `<=` 变成**重复 5 条**（本机实测第 2 页 = `26,27,28,29,30,21,…`，与第 1 页重叠 5 条）。两个方向都不对，问题在排序键不唯一，不在比较符。

4 正确写法一：完整排序键 + `OR`：`WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC`。语义对，但本机计划退化成 `SCAN doc USING INDEX idx_sort`、8.7 ms —— `OR` 收不出区间。写法二：行值比较 `WHERE (created_at, id) < (?, ?)`，同机计划是 `SEARCH doc USING INDEX idx_sort (created_at<?)`、0.0 ms，且覆盖完整。**优先写行值比较；引擎不支持时再退回 `OR`，并逐条核对执行计划。**

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释报错" difficulty="挑战">

用 `node:sqlite` 造一个最小场景，把四类错误分别触发出来，写下你看到的**原文**：

1. repository 两步各自提交，第二步违反 `CHECK` → 观察账户与流水
2. 事务里嵌套 `BEGIN`
3. `UPDATE` 一个不存在的账户（不判 `changes`）
4. 连接 `close()` 之后再取数

<template #answer>

本机 Node v25.4.0 + `node:sqlite`（SQLite 3.51.1）的原文：

1. `CHECK constraint failed: bal >= 0`。此时 `acc` = `[{id:1,bal:90},{id:2,bal:50}]`、`ledger` 1 条 —— **已提交，无法回滚**。把事务上移到 service 层后，同样这句错，`acc` 回到 `[{1,100},{2,50}]`、`ledger` 0 条。
2. `cannot start a transaction within a transaction`。SQLite 没有嵌套事务，也没有 savepoint 级别的隐式合并（要自己写 `SAVEPOINT`）。
3. 不抛任何错，`run()` 返回 `{changes: 0}`。所以「更新失败」必须自己判：`if (r.changes !== 1) throw …`。乐观锁同理：`WHERE id=? AND ver=?` 匹配时 `changes=1`、版本过期时 `changes=0`（本机实测两个值）。
4. `Error: database is not open`。对应真实项目里「连接已归还给池之后访问惰性关系」——报错点在离查询很远的位置，这是最容易被误判成驱动 bug 的一类。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Prisma 文档 · Prisma Client](https://www.prisma.io/docs/orm/prisma-client) —— 核实 `include` / `select` 的用法、官方对「先查父、循环里查子」这一 N+1 形态的定性，以及当前事务 API 的拼写（本章引作 `db.transaction()`，历史版本常见 `$transaction`），对应「三类解法」「Prisma 无懒加载」「事务边界放在 service」三处。**具体 API 以该页当前版本为准。**
- [Prisma 文档 · Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate) —— 核实迁移文件与 `schema.prisma` 的关系，用于「把 SQL 的所有权收进迁移文件」与[第 8 章 迁移](/database/migrations)。
- [Drizzle ORM 概览](https://orm.drizzle.team/docs/overview) —— 核实 Drizzle 自述「不是 ORM」、没有关系惰性加载，以及关系查询、prepared statements、`sql` 片段与事务这几条入口，用于「类型安全边界」一节。
- [SQLite `EXPLAIN QUERY PLAN`](https://www.sqlite.org/lang_explain.html) —— 核实 `SEARCH` / `SCAN` / `USE TEMP B-TREE` 的官方定义，本章游标三种写法的计划判读全靠它。
- [SQLite 行值（row values）语法](https://www.sqlite.org/lang_expr.html) —— 核实 `(a, b) < (?, ?)` 这种比较的合法性与语义（本机 3.51.1 实测可用并走 `SEARCH`）。
- [SQLite 外键约束](https://www.sqlite.org/foreignkeys.html) —— 核实「外键开关是连接级、官方默认关闭」，用于提醒 `node:sqlite` 默认值与官方默认值的差异（本机读到 1）。
- [PostgreSQL `SELECT`](https://www.postgresql.org/docs/current/sql-select.html) —— 移植时核对 `LIMIT`/`OFFSET`、`FETCH FIRST` 与排序规则；**PG 侧行为本章未在本机验证**。
- 站内：[第 6 章 索引](/database/indexes)（`OFFSET` 的 `SCAN` 计划原文与深翻实测）、[第 5 章 数据建模](/database/data-modeling)（中间表与软删除谓词）、[第 7 章 事务](/database/transactions)、[后端 · 分层架构](/backend/layered-architecture)、[后端 · 统一错误处理](/backend/error-handling)。

## 下一章

这一章把数据库领域收口到「一个接口怎么写」：三种数据访问风格各自隔离什么、抽象泄露的两个贵现场（实体当响应、序列化触发查询，实测 1 → 21 条）、N+1 的三类解法与条数/行数代价（实测 1 / 2 / 3 / 21 / 41）、分页的漂移语义与 keyset 的三个工程细节（`OR` 写法 8.7 ms vs 行值 0.0 ms）、事务边界该开在哪一层。

下一章 [阶段项目：给多用户资源 API 换上真实数据层](/database/project) 是这些结论的动手场：建模与约束、迁移重放、索引前后对照、分页与 N+1 治理、备份恢复演练，并把升级 PostgreSQL 的路径留出来。全部步骤可在本机 `node:sqlite` 完成，需要真实数据库服务的那几步会明确标出。
