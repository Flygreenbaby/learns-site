# 给多用户资源 API 换上真实数据层：一路做到能恢复、能翻页、能数出 SQL 条数

内存版 API 跑得好好的，接上数据库后第一份「交付」是这样的：迁移文件只在作者自己机器上执行过，同事拉下来跑到第 3 个脚本就炸；列表页 20 条数据发 41 条 SQL；用户翻到第 3 页说「同一条记录看到两次」；运维问「这备份能恢复吗」，没人答得上来。四件事没有一件源于 SQL 语法不熟——是**数据层缺一整套工程件**：约束、迁移、索引、访问层边界、分页契约、事务范围、备份演练。

本章把 [后端领域阶段项目](/backend/project) 那个多用户资源管理 API 从内存数组换成真实数据层。读法是硬的：先读需求清单，按阶段做，每个阶段做完立刻执行它给的检查动作，不通过就停在原地修，不许带问题进下一阶段。给的不是成品仓库，是**能抄进项目的关键实现 + 我本机跑出来的输出原文**。

模型延续后端项目：`tenant / usr / resource / tag / resource_tag`，租户隔离、多对多标签、软删除、列表分页、删除资源这种多步写操作。环境仍然本机零安装：Node v25.4.0 的内置 `node:sqlite`，不装 ORM、不装数据库服务。需要真实数据库服务的那几步单独标出并给本地替代。

<Callout type="verified" title="阶段 1 到 8 的实现跑在本机，阶段 9 的服务端命令没跑">

Windows 10 + Node v25.4.0，内置 `node:sqlite`，`SELECT sqlite_version()` 返回 **3.51.1**，日期 2026-10-18。形如 `3.2 列表查询 · 建索引后` 的行是 `database/.scratch/projrun.cjs` 打印的原文（编号与阶段对应），游标与翻页完整性来自 `database/.scratch/cursor.cjs`。耗时都是同进程重复执行取中位数、单连接、无并发进程，**只用于横向比较，不是产能指标**。

没在本机跑的：PostgreSQL 与 MySQL 的任何命令、Docker、`pg_dump` / `pg_restore`、云备份策略。那些段落写成「命令 + 预期输出 + 怎么验证」并标 `unverified`。Prisma / Drizzle 一行都没运行（本机没装，也不许装）。

</Callout>

## 项目目标与范围

交付物四样：一套可重放的迁移文件、一个只出行形状不出口实体的数据访问层、一套把 SQL 条数与分页语义写进断言的测试、一份**真的恢复过一次**的备份演练记录。

不做什么：

- **不写业务功能**，只换存储；后端项目的路由与校验规则保持原样。
- **不引入 ORM。** 手写 SQL + `node:sqlite` 才数得出条数、看得见计划；ORM 对照只在阶段 9。
- **不追求绝对性能。** 内存库与单文件库的毫秒数换到真实服务就失真，本章只认「同一份数据、同一条查询、加索引前后的计划差异」这类可比结论。
- **不做分库分表、读写分离、复制、连接池**，那是[数据存储进阶](/data-storage/)的内容；本章只把路径留干净：所有 SQL 走一个入口文件，将来换驱动只改那一处。
- **不重设计权限模型。** 租户归属沿用 `tenant_id`，越权判断留在 service（见[授权与权限](/backend/authorization)），本章只把「按已收窄的条件取行」做实。

需要真实服务的三步与本地替代：用户与权限（`CREATE ROLE` / `GRANT`）→ 本机以「连接串只给一个库的读写权限」为假设，完整性靠 DDL 约束承担；`pg_dump` 逻辑备份 → 本机用 `VACUUM INTO` 物理快照 + `integrity_check`（阶段 8 真跑）；复制与 PITR → 只讲概念与文件级对应物（`journal_mode`、连续快照），不声称演练过。

## 需求清单

「要能翻页」「要快」不是需求。下面每条都能用一个脚本或一条命令判真假。

| # | 需求 | 判定动作 | 阶段 |
| --- | --- | --- | --- |
| R1 | 五张表齐备，字段与约束符合[数据建模](/database/data-modeling) 约定 | `sqlite_master` 可见 5 表 + 3 索引 | 1 |
| R2 | 非法数据**由数据库拒绝**，不靠应用层 if | 五种违规插入各得一条约束报错原文 | 1 |
| R3 | 同租户资源名唯一，跨租户可重名 | `UNIQUE (tenant_id, name)` 冲突报错 | 1 |
| R4 | 删资源自动清中间表 | 删除后 `resource_tag` 计数 0 | 1 |
| R5 | 迁移纳入版本管理，有版本表 | `_migrations` 记录已应用文件名 | 2 |
| R6 | 空库一次重放，结构与逐步迁移一致 | 两份 `sqlite_master` 的 SQL 签名相同 | 2 |
| R7 | 重复执行迁移幂等 | 第二次 `done` 空、`skipped` 全量 | 2 |
| R8 | 单个迁移失败不留半成品 | 失败库里只剩 `_migrations` | 2 |
| R9 | 列表查询走索引，有前后对照 | 两条 `EXPLAIN QUERY PLAN` 原文 | 3 |
| R10 | 列表页一条 SQL 取回资源 + 作者 + 标签 | 计数器读数 = 1 | 4 |
| R11 | 响应字段是白名单，不是列清单 | DTO 4 字段 vs 表 8 列 | 4 |
| R12 | 游标不可被客户端伪造 | 篡改 token 被拒并有报错原文 | 5 |
| R13 | 翻页期间有写入也不重不漏 | 插 5 条后：重复 0、漏 0 | 5 |
| R14 | 条数放大被制度化拦住 | 每请求条数进断言 | 6 |
| R15 | 多步写操作出错整体回滚 | 三张表回到原地 | 7 |
| R16 | 种子脚本一键灌入指定规模 | 规模计数可复核 | 3 |
| R17 | 有备份且真的恢复验证过 | `integrity_check` = ok、内容符合快照时点 | 8 |
| R18 | 升级 PG 的语法风险清单 | 方言探针逐条标 OK / FAIL | 9 |

## 目录结构

```text
resource-api-data/
├─ db/
│  ├─ migrations/0001_tenant.sql   # 租户 + 用户（role、quota 的 CHECK）
│  ├─ migrations/0002_resource.sql # 资源 + UNIQUE(tenant_id,name) + 软删除列
│  ├─ migrations/0003_tags.sql     # tag + 中间表 + idx_rt_tag
│  ├─ migrations/0004_list_index.sql  # 列表页部分索引，单独一份
│  ├─ migrate.cjs  seed.cjs  app.db   # 数据文件进 .gitignore
├─ src/
│  ├─ db.cjs                # 唯一连接入口：打开、PRAGMA、语句计数器
│  ├─ repo/rows.cjs         # 行形状与过滤条件片段（含 deleted_at IS NULL）
│  ├─ repo/resource-repo.cjs# 只返回行/DTO，没有实体保存方法
│  ├─ service/tx.cjs        # withTransaction：BEGIN IMMEDIATE / ROLLBACK
│  ├─ service/resource-service.cjs  # 业务规则、事务边界、租户收窄
│  ├─ service/cursor.cjs    # 游标签发与校验
│  └─ http/routes.cjs       # 入参校验 + 调 service + 序列化 DTO
├─ scripts/backup.cjs restore.cjs verify.cjs
└─ tests/data-layer.test.cjs
```

三条规矩后面每个阶段都靠它成立：**`http` 看不见 SQL、`repo` 看不见业务规则**（上一版项目把「只有 owner 能改」写进 `WHERE`，调优时重写 SQL 就把规则蒸发了，见[数据访问设计](/database/data-access-design) 现场四）；**所有语句都从 `db.cjs` 的封装函数发出**，否则「条数」这个指标失真；**迁移文件只进不改**，要改就加新脚本——版本表按文件名判重，改老文件不会让存量库重跑，只会造成空库重放与存量库两种结构不一致。

## 阶段 1 · 建模与约束：把「不可能」写进 DDL

对应 R1–R4。一个文件先写完结构（阶段 2 再拆成迁移）。

```sql
CREATE TABLE tenant (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE usr (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenant(id),
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  quota INTEGER NOT NULL DEFAULT 100 CHECK (quota BETWEEN 0 AND 1000));

CREATE TABLE resource (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenant(id),
  owner_id INTEGER NOT NULL REFERENCES usr(id),
  name TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','deleting')),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, name));

CREATE TABLE tag (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenant(id),
  name TEXT NOT NULL,
  UNIQUE (tenant_id, name));

CREATE TABLE resource_tag (
  resource_id INTEGER NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, tag_id));
```

灌一条合法数据，再逐条违反约束，抄下报错原文（3.51.1，`PRAGMA foreign_keys=ON`）：

| 动作 | 实测报错原文 |
| --- | --- |
| 插入 `tenant_id=99` 的孤儿用户 | `FOREIGN KEY constraint failed` |
| `role='superuser'` | `CHECK constraint failed: role IN ('owner','admin','member')` |
| `quota=5000` | `CHECK constraint failed: quota BETWEEN 0 AND 1000` |
| 重复邮箱 | `UNIQUE constraint failed: usr.email` |
| 邮箱给 `NULL` | `NOT NULL constraint failed: usr.email` |
| 同租户插入同名资源 | `UNIQUE constraint failed: resource.tenant_id, resource.name` |

`CHECK` 的报错会把约束表达式原样带出来，所以约束要写成能给运维解释的形式。实测 `DELETE FROM resource` 之后 `resource_tag` 计数 = `0`，`PRAGMA foreign_key_check` 返回 `[]`，CASCADE 真的清干净。反过来，**中间表漏写 `REFERENCES` 是静默事故**：本机造了 `rt_bad(resource_id, tag_id, PRIMARY KEY(resource_id,tag_id))`，插入 `(999999, 888888)` 两个不存在的 id → **插入成功，`foreign_key_check` 查出 0 条违规**。库不知道那是外键，自然无从检查；这类脏数据要等某天 JOIN 才现形，症状还是「少了几条」。

外键开关必须写进代码：`node:sqlite` 新建连接实测读到 `{"foreign_keys":1}`，而 [SQLite 外键文档](https://www.sqlite.org/foreignkeys.html) 的官方默认是**关闭**，且是**连接级**设置。默认值随驱动而异，不能假设：

```js
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.DB_FILE ?? 'db/app.db');
db.exec('PRAGMA foreign_keys=ON');
db.exec('PRAGMA busy_timeout=2000');
```

**检查动作**：`verify.cjs` 的阶段 1 打印对象清单（实测 5 张表 + `idx_res_list` / `idx_rt_tag` / `idx_usr_tenant`）与上面六条报错原文，少一条就回头补约束。

## 阶段 2 · 迁移器：空库重放、幂等、失败不留半套

对应 R5–R8。不需要框架，核心三件事：**版本表、按文件名排序、每个脚本一个事务**。

```js
// db/migrate.cjs
const fs = require('fs'); const path = require('path');
const DIR = path.join(__dirname, 'migrations');
function migrate(dbFile) {
  const db = new (require('node:sqlite').DatabaseSync)(dbFile);
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const has = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name));
  const done = [], skipped = [];
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.sql')).sort()) {
    if (has.has(f)) { skipped.push(f); continue; }
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql); db.prepare('INSERT INTO _migrations(name) VALUES (?)').run(f);
      db.exec('COMMIT'); done.push(f);
    } catch (e) { db.exec('ROLLBACK'); throw new Error(f + ' 失败：' + e.message); }
  }
  db.close(); return { done, skipped };
}
```

四个脚本（`0001_tenant.sql`、`0002_resource.sql`、`0003_tags.sql`、`0004_list_index.sql`）实测：

```text
2.1 首次迁移        {"done":["0001_tenant.sql","0002_resource.sql","0003_tags.sql","0004_list_index.sql"],"skipped":[]}
2.2 重跑同一库       {"done":[],"skipped":["0001_tenant.sql","0002_resource.sql","0003_tags.sql","0004_list_index.sql"]}
2.3 空库一次重放      {"done":["0001_tenant.sql","0002_resource.sql","0003_tags.sql","0004_list_index.sql"],"skipped":[]}
2.4 两库结构签名一致 true 对象数 8
2.5 失败迁移后库内对象 [{"name":"_migrations"}]
2.6 _migrations 已记录的版本 ["0001_tenant.sql","0002_resource.sql","0003_tags.sql","0004_list_index.sql"]
```

`2.2` 是幂等（R7）；`2.4` 的签名是把两份库 `sqlite_master.sql` 压掉空白后拼接比对，**这条才是 R6 的判据**，比「看起来一样」可靠，对象数 8 = 5 表 + 3 索引；`2.5` 是我故意塞了个坏脚本（同名表建两次）的结果——脚本里第一条 `CREATE TABLE` 和 `INSERT` 都执行过，但整体回滚，库里只剩版本表，且 `2.6` 没记下失败版本，重跑会再试一次，R8 达成。

`CREATE INDEX` 单独一份（`0004`），因为它在大表上是长任务（阶段 3 实测 10 万行 **59.8 ms**，真实服务上是分钟级）：混在建表脚本里既不能单独重放索引也不能单独回滚。数据回填类脚本永远单独一份。破坏性迁移（本机探针 `ALTER TABLE resource DROP COLUMN status` 能跑）要先在带数据的副本库试：它会连带删掉引用该列的索引和视图。

**检查动作**：删 `app.db` → 跑一次 `done` 四条 → 再跑 `done` 空 → 两份库签名比对 `true`。

## 阶段 3 · 索引与执行计划：前后都要拿计划说话

对应 R9、R16。种子实测规模：

```text
3.0 规模 {"res":100000,"rt":300000,"alive":95000}
```

10 万资源（每 20 条软删 1 条）、200 个标签、30 万条关联（每资源最多 3 个标签，主键去重后 30 万）。列表查询形状决定索引列序：**过滤列 `tenant_id` 打头，排序列跟在后面，再加软删除谓词**。

```sql
CREATE INDEX idx_res_list ON resource (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
```

同一条查询前后各跑一次计划，再各取 20 次执行的中位耗时：

| 状态 | 实测计划原文 | 中位耗时 |
| --- | --- | --- |
| 建索引前 | `SEARCH resource USING INDEX sqlite_autoindex_resource_1 (tenant_id=?)` + `USE TEMP B-TREE FOR ORDER BY` | **11.18 ms** |
| 建索引后 | `SEARCH resource USING INDEX idx_res_list (tenant_id=? AND created_at<?)` | **0.05 ms** |

差 **220 倍**，且两件事同时变了：临时 B-树排序消失（`ORDER BY` 直接吃索引顺序），`WHERE` 从单列等值变成两列区间。建索引本身 10 万行 **59.8 ms**。前一条计划里的 `sqlite_autoindex_resource_1` 是 `UNIQUE (tenant_id, name)` 自带的自动索引——**够用一次 `tenant_id=?`，不够用排序**，这正是「我表上有索引啊怎么还慢」的答案。

另外四组实测，同样是交付要写进验收记录的：

| # | 场景 | 实测计划 | 中位耗时 |
| --- | --- | --- | --- |
| 3.3 | 忘写 `deleted_at IS NULL` | 退回 `sqlite_autoindex_resource_1 (tenant_id=?)` + `USE TEMP B-TREE FOR ORDER BY` | 与建索引前同量级 |
| 3.4 | `LIMIT 20 OFFSET 90000` | `SEARCH ... USING INDEX idx_res_list (tenant_id=?)` | 1.1 ms |
| 3.5 / 3.6 | `name LIKE '%文件1234%'` 加不加 `idx_res_name` | 两次计划都仍是 `idx_res_list` | 8.8 → 9.4 ms（**没变快**） |
| 3.7 | 改前缀范围 `name >= ? AND name < ?` | `sqlite_autoindex_resource_1 (tenant_id=? AND name>? AND name<?)` + `USE TEMP B-TREE` | — |
| 3.8 / 3.9 | 按标签反查，加不加 `idx_rt_tag(tag_id,resource_id)` | 两次计划都是 `SEARCH r USING INDEX idx_res_list` + `SEARCH rt USING COVERING INDEX sqlite_autoindex_resource_tag_1` | 0.4 → 0.7 ms |

三条机制解释：

1. **部分索引只在谓词完整时被选中。** 少写 `deleted_at IS NULL`，优化器不能拿它保证结果完整，只能退回去排序。所以总数查询与列表查询必须共用 `rows.cjs` 里导出的同一段条件表达式。
2. **中缀 `LIKE` 用不了 B-Tree 索引。** 计划一字未变、耗时反升，代价白占体积（上一轮 6 万关联的统计里 `idx_res_name` 单占 **1928 KB**）。真要搜关键字，方向是[全文检索](/database/postgres-features)（PG 侧 `tsvector` / `pg_trgm`），或把 3.7 的前缀范围当产品妥协。
3. **加了索引不等于计划会听。** 3.8 与 3.9 完全相同：优化器选了「从资源侧按 `created_at` 顺序扫、够 20 条就停」，`idx_rt_tag` 被中间表主键自带的覆盖索引比下去。**判据只有 `EXPLAIN QUERY PLAN`，不是「我加了索引」**——这也是要算体积账的理由：

```text
3.10 体积 (KB) resource 5912 / sqlite_autoindex_resource_tag_1 4672 / idx_rt_tag 4104 /
     resource_tag 3832 / idx_res_list 3568 / sqlite_autoindex_resource_1 2296
3.11 ANALYZE 后 idx_rt_tag → "300000 1500 1"，idx_res_list → "95000 31667 1 1"
```

这张表里**索引占的空间已超过表本身**。`"300000 1500 1"` 读作「30 万条、第一前缀平均 1500 行重复、第二前缀平均 1 行」——`(tag_id)` 前缀平均选中 1500 个资源，选择性差；`idx_res_list` 的 `"95000 31667 1 1"` 里 31667 是 `tenant_id` 的分组平均，后面两个 `1 1` 说明 `created_at`、`id` 两级前缀已唯一到行，**这就是「这个索引为什么能免排序」的量化答案**。`ANALYZE` 不是可选项，没有它优化器只能猜。

**检查动作**：3.1/3.2、3.3–3.9、3.10/3.11 的输出存进 `docs/verify-stage3.txt`；「至少演示一次加索引前后」这一条验收项就是这份文件。

## 阶段 4 · 数据访问层：repo 出行形状，DTO 出字段白名单

对应 R10、R11。先给计数器——没有它，后面所有条数断言都是空的：

```js
// src/db.cjs
let statementCount = 0;
const cache = new Map();
function sql(text) {
  statementCount++;                        // 每次取语句都计数，含缓存命中
  if (!cache.has(text)) cache.set(text, db.prepare(text));
  return cache.get(text);
}
const resetCounter = () => { statementCount = 0; };
const count = () => statementCount;
```

列表页「资源 + 作者 + 标签」的正确写法是**先定分页窗口再连接**，一条语句：

```sql
WITH page AS (
  SELECT id, name, owner_id, created_at FROM resource
  WHERE tenant_id = :tenant AND deleted_at IS NULL AND (created_at, id) < (:c, :i)
  ORDER BY created_at DESC, id DESC LIMIT 20
)
SELECT p.id AS rid, p.name, p.created_at, u.id AS uid, u.email AS owner_email,
       t.id AS tid, t.name AS tag_name
FROM page p
  JOIN usr u ON u.id = p.owner_id
  LEFT JOIN resource_tag rt ON rt.resource_id = p.id
  LEFT JOIN tag t ON t.id = rt.tag_id
ORDER BY p.created_at DESC, p.id DESC, t.name;
```

四种写法在同一份数据上的实测（每页 20 条，`4.x` 是脚本原文标签）：

```text
4.0 只取列表 1 条
4.1 每行取作者和标签 41 条
4.2 每行只取作者 20 条
4.3 批量 IN 取作者 2 条，去重后 19 个 owner
4.4 批量 IN 取作者和标签 2 条，标签关联行 60
4.5 CTE 先分页再 JOIN 1 条，扁平行 60 覆盖资源 20
4.6 LIMIT 写在 JOIN 之后 1 条，返回 20 行覆盖 7 个资源（缺行）
```

`4.5` 的 60 行摊到 20 个资源上是**复制系数 3.0**，必须在内存里按 `rid` 分组还原；`4.6` 只覆盖 7 个资源——`LIMIT` 数的是 JOIN 之后的行，多对多把它放大了，于是「一页 20 条」实际只有 7 条资源，**症状是每页条数忽多忽少，没人会怀疑到 SQL 形状**。本项目两个都实现：列表页用 CTE（1 条最省），导出用批量 `IN`（条数换行数，不复制行）。

`repo` 只返回行形状，序列化前收敛成 DTO，`http` 层 `send` 的永远是 DTO 数组。实测这组对照：

```text
3.1 行原样序列化字段 id,tenant_id,owner_id,name,size,internal_note,quota,created_at
3.2 DTO 字段 id,name,size,created_at | 泄露字段数 4
3.3 对照 PRAGMA table_info ["id","tenant_id","owner_id","name","size","internal_note","quota","created_at"]
```

**`3.1` 与 `3.3` 完全相同就是事故本身**：响应字段 = 列清单，`internal_note`、`quota` 和别人的 `tenant_id` 都发出去了。白名单收在这儿：

```js
// src/repo/rows.cjs
const toResourceDto = (row) => ({
  id: row.rid, name: row.name, size: row.size, createdAt: row.created_at,
  owner: row.owner_email ? { id: row.uid, email: row.owner_email } : null,
  tags: row.tag_name ? [row.tag_name] : [],
});
```

顺手把「序列化触发取数」也数一遍（惰性属性的本质就是 getter）：`3.4 JSON.stringify 触发查询次数 getter 计数 0 → stringify 后 1 → Object.keys 后 1`。**`Object.keys` 不触发、`JSON.stringify` 触发**，这决定了排查方式：本地打印字段名看不见问题，框架序列化时才炸出 N 条 SQL。

**检查动作**：`verify.cjs` 跑一次列表接口断言 `count() === 1`；响应 JSON 键集合与 `PRAGMA table_info` 列名做差，白名单外的字段数必须为 0。

## 阶段 5 · 分页：游标由服务端签发，客户端只带回不透明串

对应 R12、R13。游标里放**完整排序键**（`created_at` + `id`）并带排序方向；`OR` 写法会把计划打成 `SCAN`，行值比较 `(created_at, id) < (?, ?)` 才收得成一个区间（阶段 3 计划原文里的 `created_at<?` 就是这么来的）。

```js
// src/service/cursor.cjs
const crypto = require('node:crypto');
const SECRET = process.env.CURSOR_SECRET;                 // 32 字节，别写进仓库
const sign = (o) => {
  const body = Buffer.from(JSON.stringify(o)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url').slice(0, 22);
};
const verify = (tok) => {
  const [body, mac] = String(tok).split('.');
  if (!body || !mac) throw new Error('游标格式非法');
  const want = crypto.createHmac('sha256', SECRET).update(body).digest('base64url').slice(0, 22);
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) {
    throw new Error('游标签名不匹配');
  }
  return JSON.parse(Buffer.from(body, 'base64url').toString());   // { c, i, k }
};
```

本机实测（密钥是仓库外示例串）：

```text
1.1 token 长度 93 B 前缀 eyJjIjoiMjAyNi0xMC0xOFQxMTowMDowMC…
1.2 正常解出 {"c":"2026-10-18T11:00:00.000Z","i":4213,"k":"desc"}
1.3 拒绝 → 游标签名不匹配 | 输入末位改一个字符的 token
1.3 拒绝 → 游标格式非法 | 输入 "notatoken"
1.3 拒绝 → 游标格式非法 | 输入只有 body 没有 mac
1.3 拒绝 → 游标签名不匹配 | 输入把 c 改成 "9" 后沿用旧 mac
1.4 换密钥后旧 token other-secret 校验结果 = false
```

两条不同报错（格式非法 / 签名不匹配）在日志里能区分「客户端截断了 token」和「有人在伪造」。93 B 放 query string 没问题，但**别当业务字段回写进响应体**。`1.4` 既是安全措施也是风险：滚动密钥会让用户手里的「下一页」全部失效，实践上保留 1～2 个旧密钥做宽限期。

翻页期间有人写入，R13 的实测（100 行、每页 20、翻 5 页；重复 = 取回条数 − 去重条数）：

| 场景 | OFFSET | KEYSET |
| --- | --- | --- |
| 数据静止 | 取回 100，重复 0，漏 0 | 取回 100，重复 0，漏 0 |
| 第 1 页后插入 5 条更新的行 | 取回 100，**重复 5**，**既有行漏 5** | 取回 100，重复 0，漏 0（本轮取到新行 0） |
| 第 1 页后删排序末尾 3 条（最旧） | 取回 97，重复 0，跳过 0 | 取回 97，重复 0，跳过 0 |

第三行「两种都一样」是**方向问题**：删的是排序末尾的行，窗口没前移，谁都不漏；把删除挪到最前排（`id` 最小的三条），OFFSET 就会跳过 3 条既有行（该形态在[数据访问设计](/database/data-access-design) 里实测过，原文「两页之间被跳过的既有行 = 80,79,78」）。所以结论不是「keyset 只在插入时好」，而是**只要列表可写，偏移量的语义就不可靠**。

总数给不给？本机 10 万行、带 `tenant_id` 与软删除过滤的 `COUNT(*)` 中位 **0.2 ms**，显示总条数不贵；贵的是「点第 500 页」这个能力，只有 OFFSET 能做。折中：给总数 + 只放上一页/下一页，要跳页就限制在前后 N 页。

**检查动作**：模拟「第 1 页后插 5 条」断言重复 0、既有行漏 0；篡改 token 必须 400，且响应体不含 SQL 片段（错误映射见[统一错误处理](/backend/error-handling)）。

## 阶段 6 · 把 SQL 条数变成回归指标

对应 R14。阶段 4 证明数得出来，这一阶段让它制度化——否则三个月后 N+1 会换个形式回来（多一个关联字段、少一次预加载）。

```js
// tests/data-layer.test.cjs（本机可跑，无框架）
const assert = require('node:assert');
for (const [name, run, budget] of [
  ['列表页 20 条含作者与标签', () => svc.listPage(1, 20, null), 2],
  ['详情页含作者与标签', () => svc.detail(1, 42), 3],
  ['导出（按 500 一片批量 IN）', () => svc.exportBatch(1, 500), 8],
]) {
  resetCounter(); const rows = run();
  assert.ok(count() <= budget, name + ' 发了 ' + count() + ' 条，预算 ' + budget);
  assert.ok(rows.length > 0, name + ' 空结果');
}
```

预算别拍脑袋：**主查询 1 条 + 响应里每个关联 1 条**。列表硬顶 2、详情 3、导出按分片数放宽。超了就查三件事：循环里按需查询（那条 41）、关联清单比响应形状宽（取了没人用的标签对象）、分页发生在 JOIN 之后（只覆盖 7 个资源那条）。

响应形状 → 清单，本项目落成三行（写进 `docs/preload.md`，评审对着看）：

| 接口 | 响应里的关联 | 取法 | 实测条数 |
| --- | --- | --- | --- |
| `GET /resources?cursor=` | `owner` + `tags` | CTE 一条取回全部 | 1 |
| `GET /resources/:id` | `owner` + `tags` | 主查询 + 作者 + 标签 | 3 |
| 列表只要计数 | `tagCount` | 列表 1 + `GROUP BY resource_id` 聚合 1 | 2 |

第三行的取舍值得单独讲：响应里是 `tagCount` 就别把标签对象整个拉回来——聚合 20 行 vs JOIN 出 60 行，**「响应形状决定清单」的实际作用就是拦住这种顺手多取**。

连接归还之后才访问惰性关系那类事故（上一版项目的 `database is not open`），SQLite 单连接不会出现，换 PG + 连接池才有那个形态，见[连接池与慢查询定位](/data-storage/connection-pool-and-slow-query)；本章不声称演练过。

**检查动作**：测试跑绿；预算值写进 README，改响应字段必须同时改预算（评审看这处 diff）。

## 阶段 7 · 事务：删除资源这条多步路径

对应 R15。删一个资源在这套模型里是三步：校验存在与归属 → 释放租户配额 → 删行（靠 CASCADE 清中间表）。业务规则与事务边界都在 service：

```js
// src/service/resource-service.cjs
function hardDelete(tenantId, resourceId, releaseBytes) {
  db.exec('BEGIN IMMEDIATE');              // 写事务：开局抢写锁，避免锁升级死锁
  try {
    const row = sql('SELECT id FROM resource WHERE id=? AND tenant_id=? AND deleted_at IS NULL')
      .get(resourceId, tenantId);
    if (!row) throw new Error('资源不存在或不属于该租户，拒绝执行');
    const r = sql('UPDATE quota_used SET used = used - ? WHERE tenant_id = ?').run(releaseBytes, tenantId);
    if (r.changes !== 1) throw new Error('配额行缺失，changes=' + r.changes);
    sql('DELETE FROM resource WHERE id=?').run(resourceId);
    db.exec('COMMIT');
    return 'committed';
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
```

四种情形实测（`5.x` 原文）：

```text
5.1 多步删除失败 → CHECK constraint failed: used >= 0
    回滚后 resource [{"id":1},{"id":2}] quota {"used":100} 中间表行数 3
5.2 正常删除 → committed [{"id":1}] quota {"used":90} CASCADE 后中间表 [{"resource_id":1,"tag_id":10},{"resource_id":1,"tag_id":11}]
5.3 重复删除（幂等） 拒绝执行：资源不存在或已删除，拒绝执行
5.4 CHECK 挡住负数用量 CHECK constraint failed: used >= 0，used 仍为 90
```

`5.1` 是释放超额（1e9 > 已用 100）触发 `CHECK`，**三步一起退回**；`5.2` 正常路径里 CASCADE 清掉被删资源的关联；`5.3` 是幂等保护，重复删除走「查不到就抛」，配额不会被释放两次；`5.4` 说明兜底别只放在事务里——事务外的裸 `UPDATE` 一样被 `CHECK` 拦住，**完整性是库的责任，不是代码评审的责任**。

并发改名的乐观锁也落在这里：

```sql
UPDATE resource SET name = :n, ver = ver + 1 WHERE id = :id AND ver = :ver;
```

本机实测：`ver` 匹配 `changes = 1`，版本过期 `changes = 0`；**`UPDATE` 影响 0 行不抛错**，所以 `if (r.changes !== 1) throw …` 是必须的。顺带实测两条 SQLite 专有约束：`repo` 里再开一次事务直接 `cannot start a transaction within a transaction`（没有嵌套事务），事务里读自己的写看得见（改成 42 后同事务读到 42，`ROLLBACK` 后另一条读到原值）。原理在[事务与并发](/database/transactions)。

**检查动作**：失败删除后断言三张表逐字段与调用前相同；连续两次成功删除，第二次必须抛错且配额只释放一次。

## 阶段 8 · 备份与恢复演练：没恢复过的备份不算交付

对应 R17。本机用物理快照，一条语句：

```js
// scripts/backup.cjs
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
db.exec(`VACUUM INTO '${path.join(BACKUP_DIR, 'app-' + stamp + '.db').replace(/\\/g, '/')}'`);
```

实测（`6.x` 原文）：

```text
6.0 journal_mode 默认 {"journal_mode":"delete"}
6.1 备份一次 ok 文件大小 45056 B
6.2 同名再备份 → output file already exists
6.3 从 backup-001 恢复：资源清单 [{"id":1,"name":"keep.pdf"}]
6.4 完整性 {"integrity_check":"ok"} 外键检查 []
6.5 backup-002 恢复后含 lost.pdf？ true
```

`VACUUM INTO` 重排出一个紧凑独立的新文件（本机 45056 B，碎片被清掉），不是「正在用的库的拷贝」。**同名目标直接报错**（`6.2`）——这是保护：它逼你用时间戳命名 + 保留策略，而不是把旧快照悄悄覆盖（别改成「先删再备份」，那样一份好快照会被半次失败替掉）。`6.3` 是这张单子的重点：备份之后写入的 `lost.pdf` **不在** backup-001 里；`6.5` 反向确认它在 backup-002 里。这两条断言加起来才叫恢复演练——**不是文件存在，而是把文件打开、查内容、比对预期时点**。另外实测 `journal_mode` 默认是 `delete`（不是 WAL），备份期间写入会被串行化；内存库也能 `VACUUM INTO`（本机成功），但那种库进程退出就没数据，备份只对文件库有意义。

恢复脚本固定三件事：复制到新路径（绝不覆盖原库）、`PRAGMA integrity_check`、`PRAGMA foreign_key_check`。缺第三条，一个部分写入的库能骗过你——结构看着齐，孤儿引用一堆。

需要真实服务的版本（**以下命令未在本机验证**）：

```bash
pg_dump -Fc mydb > mydb-$(date +%F-%H%M).dump
pg_restore -d newdb mydb-xxxx.dump
pg_restore -d mydb --clean --if-exists mydb-xxxx.dump
psql -d postgres -c "CREATE DATABASE newdb TEMPLATE template0"
```

<Callout type="unverified" title="pg_dump / pg_restore 这段是文档级核实，不是执行记录">

本机没有 PostgreSQL 服务。文档核实到四条：`plain` 才是默认格式、`custom` 需显式 `-Fc` 且默认压缩；`--if-exists` 只在配了 `--clean` 时有效；恢复到真正空的库要从 `template0` 复制，否则 `template1` 里的本地加装会造成重复定义；导出按 pre-data / data / post-data 三段有序输出，索引与约束属 post-data。你跑通后把实际输出补进 `docs/restore-drill.md`，预期 `pg_restore` 无 `ERROR` 行、`psql -c "SELECT COUNT(*) FROM resource"` 与备份时点数一致。

</Callout>

**检查动作（R17）**：演练记录五列——备份时间、快照时点、恢复目标库、`integrity_check` 原文、`foreign_key_check` 原文。SQLite 那份本机已跑通（`6.x`），PG 那份留给你，标「未演练」不算交付。

## 阶段 9 · 把升级 PostgreSQL 的路径留干净

对应 R18。这一阶段不要求装服务，要求现在就把方言差异写清楚。本机用 `node:sqlite` 做「SQLite 是否接受」的探针（**只能证明 SQLite 侧，不能证明 PG 侧**）：

```text
7 RETURNING OK            7 行值比较 OK            7 ILIKE FAIL | near "'a'": syntax error
7 SERIAL 关键字 OK         7 TIMESTAMPTZ OK         7 BOOLEAN 类型 OK
7 FOR UPDATE FAIL         7 information_schema FAIL | no such table: information_schema.tables
7 ARRAY_AGG FAIL          7 FILTER 聚合 OK         7 窗口函数 OK
7 表达式索引 OK            7 部分索引 OK            7 UPSERT OK
7 DROP COLUMN OK           7 ALTER COLUMN TYPE FAIL | near "ALTER": syntax error
7 LIMIT ALL FAIL          7 datetime(now) 默认值 OK  7 CURRENT_TIMESTAMP 默认值 OK
```

四个结论：

1. **「接受」不等于「按你的意思接受」。** `SERIAL`、`TIMESTAMPTZ`、`BOOLEAN` 在 SQLite 里只是被当成未知类型名收下（类型亲和性见[MySQL 差异对照](/database/mysql-differences)）：`CREATE TABLE q (f BOOLEAN, n NUMERIC, t TEXT, i INT, b BLOB)` 的 `PRAGMA table_info` 原样回显声明名，而 `id VARCHAR2(64) NOT NULL NOSENSE` 报错位置是多余的 `NOSENSE`——**`VARCHAR2(64)` 根本没被拒绝**。方言探针要按语义核对，不能只看有没有报错。
2. **`FOR UPDATE`、`ILIKE`、`ARRAY_AGG`、`information_schema`、`ALTER COLUMN TYPE`、`LIMIT ALL` 在 SQLite 侧不存在。** 今天靠 `PRAGMA` / `sqlite_master` 查元数据的代码，PG 侧要换成 `information_schema` / `pg_catalog`（见[PostgreSQL 进阶特性](/database/postgres-features)）。本项目把这类调用限制在 `scripts/`，`src/` 里一处都不许出现。
3. **两边都有的核心子集**：CTE、窗口函数、`RETURNING`、UPSERT `ON CONFLICT DO UPDATE`、部分索引、表达式索引、`FILTER` 聚合、行值比较。本章实现只依赖这一子集加一个元数据探针，迁移面很小。
4. **迁移文件要一份 PG 版本。** 差异集中在：`INTEGER PRIMARY KEY` 自增 → `BIGINT GENERATED ALWAYS AS IDENTITY`、`TEXT NOT NULL DEFAULT (datetime('now'))` → `TIMESTAMPTZ NOT NULL DEFAULT now()`、`CHECK (role IN ...)` → 枚举域或保留 `CHECK`、`PRAGMA foreign_keys` → 默认开启无需开关。目录按 `db/migrations/sqlite/` 与 `db/migrations/pg/` 同名对齐，用阶段 2 的签名比对思路做跨引擎一致性检查。

<Callout type="unverified" title="ORM 与托管数据库只做了文档级对照">

本章没装 Prisma 也没装 Drizzle，`node_modules` 里不存在这两个包，且本次联网核对官方文档的三次请求均未成功——下面这些名字是特性名级别的回忆，不是文档原文，动手前以官方文档当前版本为准。走 Prisma 路线时 `schema.prisma` 承担阶段 1 的约束声明、`prisma migrate dev` 承担阶段 2；关系取数用 `include` / `select`（无惰性加载，忘写就是 `undefined`），事务 API 常见写法是 `db.transaction()`（历史版本与不同封装也见过 `$transaction`）。机制对照与逐条核实放在[Prisma 深入：关系查询与事务](/data-storage/prisma-deep-dive) 与[原始 SQL、Drizzle 对照与类型安全边界](/data-storage/raw-sql-and-drizzle)。托管服务（RDS / Cloud SQL / Supabase）的备份、参数组、告警都需要真实账号，本地替代就是阶段 8 的快照演练加 `pg_dump` 到文件。

</Callout>

**检查动作**：上面 18 行探针原文一字不改存进 `docs/dialect-checklist.md`，每条补一列「本项目哪里用到 / 迁移时要改哪里」。

## 验收清单

判定动作见「需求清单」表，这里只列不可省的证据。任何一条不过就停在当前阶段。

- [ ] R1 `sqlite_master`：5 表 + `idx_res_list` / `idx_rt_tag` / `idx_usr_tenant`
- [ ] R2 六条约束报错的**原文**抄进验收记录（不是截图）
- [ ] R3 同租户重名被拒、跨租户重名允许
- [ ] R4 删资源后 `resource_tag` = 0、`foreign_key_check` = `[]`；中间表每列都有 `REFERENCES`（做过 `rt_bad` 静默反例）
- [ ] 每个连接建立后显式 `PRAGMA foreign_keys=ON`
- [ ] R5–R8 `_migrations` 有记录；删库重放成功；二次执行 `done` 为空；两份库签名一致；坏脚本回滚后只剩版本表；索引与回填各自独立成文件
- [ ] R9 计划原文两条：前含 `USE TEMP B-TREE FOR ORDER BY`、后含 `idx_res_list (tenant_id=? AND created_at<?)`
- [ ] 总数查询与列表查询共用同一段过滤条件（含 `deleted_at IS NULL`）
- [ ] 每个索引都验过「加了之后计划确实变了」，没变的要么删要么写明保留理由；`ANALYZE` 跑过且 `sqlite_stat1` 数字入档
- [ ] R10 列表接口 `count() === 1` 有断言；`LIMIT` 在 JOIN 之前且断言「一页 20 条返回 20 个资源」
- [ ] R11 响应字段与列名的差集不含 `internal_note` / `quota` / `tenant_id`；`repo` 无 `save()` 式方法；所有语句经封装函数发出
- [ ] R12 篡改、截断、无签名三类输入各得一条明确错误并 400；游标密钥轮换的宽限期写进运维说明
- [ ] R13 「第 1 页后插 5 条」模拟：重复 0、既有行漏 0
- [ ] R14 每个接口的条数预算进测试并跑绿；`docs/preload.md` 与响应字段一一对应
- [ ] R15 失败删除后三张表逐字段回到原地；每个 `UPDATE` 判了 `changes`；`repo` 层没有 `BEGIN`；事务内无外部 HTTP / 文件生成
- [ ] R16 种子脚本幂等，规模计数与文档一致（100000 / 300000 / 95000）
- [ ] R17 至少两份带时间戳快照；恢复内容符合快照时点（含反向断言）；`integrity_check` 与 `foreign_key_check` 原文入记录；保留策略写在 `docs/`
- [ ] R18 探针原文入 `docs/dialect-checklist.md`；`src/` 里无 `PRAGMA` / `sqlite_master`；迁移按引擎分目录且同名可对齐
- [ ] PG 侧命令若未演练，文档里明确标「未演练」

## 常见翻车点

1. **迁移在同事机器上报「对象已存在」。** 现象：`table tag already exists`。原因：有人改了已应用的脚本，或手工脚本混进迁移目录。怎么确认：比对各机器 `_migrations` 内容（本机 `2.6`），别比文件时间戳。怎么修：老脚本冻结、新增 `0006_xxx.sql`；开发库直接重建（阶段 2 的删库重放就是为此存在）。

2. **加了索引接口没变快。** 现象：耗时与计划一起「没动」。原因：`WHERE` 写法让索引用不上（中缀 `LIKE`、对索引列做函数、漏掉部分索引谓词），或优化器根本没选它。怎么确认：`EXPLAIN QUERY PLAN` 看 `SEARCH ... USING INDEX` 还是 `SCAN`（本机 `3.5/3.6` 加 `idx_res_name` 后计划未变、8.8 → 9.4 ms，`3.8/3.9` 加 `idx_rt_tag` 后计划也未变）。怎么修：改查询形状（前缀范围、补谓词）、删无效索引（`3.10` 的体积账就是依据），必要时 `ANALYZE` 后重看。

3. **列表每页条数忽多忽少。** 现象：`limit=20` 有时返回 7 条。原因：`LIMIT` 写在 JOIN 之后，多对多把行数放大、`LIMIT` 数的是行。怎么确认：`COUNT(DISTINCT rid)` 对比返回行数（本机 20 行只覆盖 7 个资源）。怎么修：`WITH page` 先定窗口再连接，或退回批量 `IN`。

4. **响应体里多出你没定义的字段。** 现象：小程序崩了，因为多了 `internal_note`。原因：`repo` 返回行对象、`http` 直接 `send`。怎么确认：`Object.keys(响应)` 与 `PRAGMA table_info('表')` 逐字对齐就是证据（本机 `3.1` vs `3.3`）。怎么修：DTO 白名单，再加一条「列清单变化时测试必须红」的断言。

5. **41 条 SQL 只出现在生产日志里。** 现象：本地看只有一条。原因：查询发在序列化那一刻，打印字段名不触发。怎么确认：`JSON.stringify` 前后各读一次计数器（本机单 getter 是 `0 → 1`，列表场景 `1 → 21`）。怎么修：取数在 handler 返回前完成；条数预算进测试。

6. **用户说「上一条记录不见了」，或翻页漏了一整段却不重复。** 前者现象是 OFFSET 分页 + 列表可写（本机模拟：重复 5 / 既有行漏 5），后者是游标只带 `created_at`（并列值被整段跳过，那一形态实测漏 60 条）。怎么确认：`SELECT COUNT(*), COUNT(DISTINCT created_at)`；对比相邻两页的 id 集合。怎么修：改游标分页，`ORDER BY` 补决胜列（通常是主键）并一起放进游标；改完核对计划没退化成 `SCAN`（`OR` 写法就会退化）。

7. **配额扣了、资源没删。** 现象：两步各自提交，日志无异常。原因：事务开在 `repo`。怎么确认：失败后逐表比对状态（本机正例是三张表全退回）。怎么修：`BEGIN IMMEDIATE` 上移到 service，每步判 `changes`；`repo` 里再开事务会直接 `cannot start a transaction within a transaction`。

8. **备份文件在，恢复不出正确时点。** 现象：`integrity_check` 报页面损坏，或恢复了才发现少三天数据。原因：只备份没演练，把「文件在」当「能恢复」。怎么确认：打开快照查内容（本机 `6.3` / `6.5` 正反两条）。怎么修：备份 + 恢复 + 校验三个入口，备份任务后自动恢复到临时库跑一次断言。

9. **`PRAGMA foreign_keys` 在某环境没生效，脏数据静默入库。** 现象：孤儿引用查不出来。原因：外键是连接级开关、官方默认关闭，而本机 `node:sqlite` 读到 1——默认值随封装而异。怎么确认：连接建立后读一次 `PRAGMA foreign_keys`，再查 `foreign_key_check`。怎么修：初始化里显式 `ON`，并把「漏写 `REFERENCES` 时插越权引用会静默成功」（本机 `1.7`：0 条违规）写进团队约定。

## 参考答案要点

<Exercise title="阶段 4、5 的参考答案要点：为什么是 1 条而不是 41 条" difficulty="基础">

参考答案要点（不是题目）：把 `4.0`–`4.6` 与三种方案（CTE 一次取回 / 批量 `IN` / 每行按需）对齐，说明本项目为什么列表页选 CTE、导出选批量 `IN`；再解释「20 行只覆盖 7 个资源」的机制，并给出一条能放进测试的断言形式。

<template #answer>

条数：按需 = 列表 1 + 20 行 × 2 关联 = **41**（`4.1`）；批量 `IN` = **3**（列表 + 作者 + 标签），若作者与标签各按 key 批量取则 `4.4` 实测 **2**（去重后 19 个 owner，说明 20 行只省下 1 次点查——`IN` 的价值在**条数固定**，不在行数少）；CTE = **1**（`4.5`，60 行 ÷ 20 资源 = 复制系数 3.0）。

选型看两件事：**行数复制**和**分页语义**。CTE 最省，但多个一对多同时预加载时复制系数相乘（作者 × 标签 × 评论），行数爆炸，这时退回批量 `IN`——导出就是这种场景。

`4.6` 的机制：`LIMIT` 作用在 JOIN 之后的行集合上，每资源约 3 行，20 行自然只剩 7 个资源。断言写资源数不写行数：`assert.equal(new Set(rows.map((r) => r.rid)).size, 20)`——这一句就能让 `LIMIT` 位置写错的代码在 CI 里红掉。

</template>

</Exercise>

<Exercise title="故意把数据层做坏：四类故障与它们的报错原文" difficulty="挑战">

参考答案要点（不是题目）：依次制造四种坏并抄下原文——① 删掉中间表的 `REFERENCES` 后插入不存在的 `tag_id`；② 用 `LIMIT` 写在 JOIN 之后的写法调列表接口；③ 用末位改过一个字符的游标请求下一页；④ 在 `repo` 里对同一连接连开两次事务，并让 `UPDATE` 命中 0 行。

<template #answer>

① 插入 `(999999, 888888)` **成功**，`foreign_key_check` 返回 `[]`（`1.7`：0 条违规被查出）。四种里最贵：当场零症状，将来 JOIN 少行才现形，没人怀疑约束。对照：保留 `REFERENCES` 时同样插法报 `FOREIGN KEY constraint failed`（`1.3`）。

② 返回 20 行只覆盖 **7 个资源**（`4.6`），症状是每页条数忽多忽少。修法是 `WITH page` 先定窗口，改完 1 条语句取回 60 行覆盖 20 个资源（`4.5`）。

③ `游标签名不匹配`（`1.3`）。如果你的实现是「客户端传裸 `created_at`」，这一步不会报错——它会**成功翻到一个不存在或不属于该租户的时间窗**，然后把别的行按排序返回。「游标必须由服务端签发」的全部理由就在这条差异里。

④ 第二次 `BEGIN` 报 `cannot start a transaction within a transaction`；`UPDATE` 命中 0 行**不抛错**，`run()` 返回 `changes: 0`。所以第四种的症状是「静默什么都不做」，必须自己判 `changes`（乐观锁同理，版本过期时 `changes = 0`）。

共同结构：数据库层不报错的（①④）最难查，SQL 形状错的（②）看数据能查出来，安全边界让给客户端的（③）只在事故后现形。

</template>

</Exercise>

<Exercise title="把恢复演练做完整：设计一次能证明快照时点的验证" difficulty="进阶">

参考答案要点（不是题目）：给出 `backup.cjs` / `restore.cjs` / `verify.cjs` 的责任分工，并说明为什么「文件存在 + 能打开」不算恢复成功。要求至少包含一条反向断言。

<template #answer>

本机跑通用的五步（对应 `6.1`–`6.5` 的原文）：

1. 备份：`VACUUM INTO` 到带时间戳的新文件（同名报错是保护，别写成先删再备份），同时把「快照时点的最大 `id` 与时间戳」写进 manifest。
2. 恢复：复制到临时新路径，绝不覆盖 `app.db`。
3. 结构断言：`integrity_check` 必须 `ok`、`foreign_key_check` 必须 `[]`。
4. 正向断言：manifest 里的行在恢复库里查得到。
5. **反向断言**：备份之后写入的那条（本机 `lost.pdf`）在 backup-001 里查不到（`6.3`），在 backup-002 里查得到（`6.5`）。

没有第 5 步，「恢复成功」这句话没有内容——文件能打开、结构完整，都证明不了这个快照属于你以为的那个时刻。真实事故形态是备份任务把上一份覆盖掉，你恢复出来的是三天前的库，而日志里一条报错都没有。PG 侧同理：`pg_restore -d newdb` 之后比对 manifest 的 `MAX(id)` 与行数（命令见阶段 8，标注未在本机验证）。

</template>

</Exercise>

## 官方文档与延伸阅读

站内回读，按阶段对应：[数据建模](/database/data-modeling) 与[关系模型](/database/relational-model)（阶段 1）、[SQLite 入门](/database/sqlite-first)（`PRAGMA` 与 `node:sqlite` 边界）、[SQL 查询基础](/database/sql-basics) 与[SQL 查询进阶](/database/sql-advanced)（CTE、窗口函数）、[索引与执行计划](/database/indexes)（阶段 3）、[迁移与版本管理](/database/migrations)（阶段 2）、[事务与并发](/database/transactions)（阶段 7）、[备份与恢复](/database/backup-and-restore)（阶段 8）、[PostgreSQL 进阶特性](/database/postgres-features) 与[MySQL 差异对照](/database/mysql-differences)（阶段 9）、[数据访问设计](/database/data-access-design)（阶段 4–6 的原理）、首页 [数据库](/database/)。后端侧：[阶段项目：多用户资源管理 API](/backend/project)、[分层架构](/backend/layered-architecture)、[Fastify 入门](/backend/fastify-basics)、[统一错误处理](/backend/error-handling)、[授权与权限](/backend/authorization)、[API 文档](/backend/api-docs)、[文件上传、定时任务与后台作业](/backend/uploads-and-jobs)、[服务部署](/backend/docker-and-shutdown)。

官方资料，每条写明核实本章哪个结论：

- [SQLite `VACUUM`（含 `VACUUM INTO`）](https://www.sqlite.org/lang_vacuum.html) —— 阶段 8 快照产物语义与目标文件要求；**「同名报错」以本机 `output file already exists` 原文为准**，官方表述请对这一页核对。
- [SQLite 外键约束](https://www.sqlite.org/foreignkeys.html) —— 核实「外键开关是连接级、官方默认关闭」，对应阶段 1「别假设驱动替你开了」。
- [SQLite `PRAGMA` 一览](https://www.sqlite.org/pragma.html) —— 核实 `foreign_keys`、`busy_timeout`、`journal_mode`、`integrity_check`、`foreign_key_check`、`table_info` 的返回形状。
- [SQLite `EXPLAIN QUERY PLAN`](https://www.sqlite.org/lang_explain.html) 与 [`ANALYZE` / `sqlite_stat1`](https://www.sqlite.org/lang_analyze.html) —— 阶段 3 计划原文里 `SEARCH` / `SCAN` / `USE TEMP B-TREE` / `COVERING INDEX` 的定义，以及 `"300000 1500 1"` 的读法。
- [Node.js `node:sqlite` API](https://nodejs.org/api/sqlite.html) —— 核实 `DatabaseSync`、`prepare`、`run()` 的 `{ changes, lastInsertRowid }`；它仍属实验特性，API 可能变，动手前对这一页确认。
- [PostgreSQL `pg_dump`](https://www.postgresql.org/docs/current/app-pgdump.html) 与 [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html) —— 阶段 8 那四条文档级核实。**本章未在本机验证。**
- [PostgreSQL `CREATE INDEX`](https://www.postgresql.org/docs/current/sql-createindex.html) —— 移植阶段 3 时核对部分索引与 `CONCURRENTLY`；本机 59.8 ms 那条不适用于服务实例。
- [Prisma 文档首页](https://www.prisma.io/docs) 与 [Drizzle 概览](https://orm.drizzle.team/docs/overview) —— 阶段 9 那条 `unverified` 说明的出处，本章未运行任何 ORM。

## 下一章

这一章把数据库领域的规矩收进一份能验收的交付物：约束在库里（六条报错原文）、迁移能重放（签名一致、失败不留半套）、索引拿计划说话（11.18 ms → 0.05 ms 那对原文）、访问层只出行形状（1 条 vs 41 条）、游标由服务端签发（重复 5 / 漏 5 的对照）、事务开在 service（三张表整体退回）、备份真的恢复过一次（正反两条断言），并用 18 行探针把升级 PostgreSQL 的路径标干净。做完你应该能对任何一句「接口慢」反问三个数字：几条 SQL、什么计划、游标还是偏移量。

下一站是[数据存储进阶](/data-storage/)：数据层落地之后，瓶颈从「查得慢」变成「查得太多次」。那里从 [为什么要加这一层](/data-storage/why-this-layer) 与 [Redis 数据结构](/data-storage/redis-data-structures) 开始，讲缓存模式与一致性、穿透击穿雪崩、分布式会话与限流、分布式锁，再到 [Prisma 深入](/data-storage/prisma-deep-dive)、[原始 SQL 与 Drizzle 对照](/data-storage/raw-sql-and-drizzle)、[连接池与慢查询定位](/data-storage/connection-pool-and-slow-query)。它的阶段项目正好接在本章后面：你在这里数出来的 SQL 条数，在那里变成缓存命中率。
