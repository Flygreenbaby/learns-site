# 迁移与版本管理：改表要能被重放，而不是靠现场手搓

新同事 clone 仓库、`migrate` 一把、启动 —— 报 `no such column: bio`。你翻了半小时才发现本地库是自己三年前手工 `ALTER` 出来的，仓库里那条迁移根本没人跑过。同一周，测试环境起不来，因为有人**改了一个已经应用过的迁移文件**：本地库是旧结构，测试库重放的是新内容，两边结构悄悄分叉了。

生产上的版本更吓人。有人把一段 MySQL 语法的迁移直接喂给 SQLite：

```text
输入： ALTER TABLE t ADD COLUMN b TEXT AFTER a;
实测结果（PRAGMA table_info）： 列 b 的声明类型变成了 "text after a"
sqlite_master 里存下的 DDL： CREATE TABLE t(a text, b text after a)
```

**SQLite 没报错。** 它把 `TEXT AFTER a` 当成一个多词类型名收下了（SQLite 允许 `UNSIGNED BIG INT` 这类写法）。跨方言复制粘贴的 SQL 就这样静默通过了语法检查，等到半年后某次查询依赖这个列的类型才炸。这是本章要解决的第一类问题：**迁移必须来自可验证的流程，而不是「我记得怎么改的」**。

前置：[数据建模](/database/data-modeling)（表结构与命名约定）、[事务与并发](/database/transactions)（迁移是数据库上最危险的事务）。本章所有 SQLite 结论都在本机跑过：`node:sqlite` + SQLite 3.51.1，Node v25.4.0，2026-10-18。Prisma / Drizzle 的命令行部分**本机没有装包，未验证**，标注清楚。

## 版本化的 schema 到底版本化了什么

三样东西，缺一个就不叫迁移：

| 对象 | 载体 | 丢了会怎样 |
| --- | --- | --- |
| 目标结构 | 迁移文件序列（每个文件一段 SQL） | 新环境起不来，只能靠导dump |
| 变更历史 | 数据库里的 `schema_migrations` 表 | 不知道哪些跑过，每次都得全跑或全凭记忆 |
| 数据变换 | 迁移里的 `UPDATE` / 回填步骤 | 结构改了、旧数据不合法，`NOT NULL` 一建就失败 |

记账表最小实现（实测可跑）：

```sql
CREATE TABLE schema_migrations (
  version    TEXT PRIMARY KEY,               -- 0001、20261018_01 之类，排序键
  name       TEXT NOT NULL,                  -- 文件名，报错时看得懂是谁
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  sql_sha    TEXT NOT NULL                   -- 内容哈希，用来抓「改历史」
);
```

字段可以更少，但 `version` + 内容哈希这两条别省：前者保证顺序可重放，后者保证历史不可篡改。Prisma 用的是自己的 `_prisma_migrations` 表、Drizzle 也有自己的记账表，字段名与迁移锁机制请以 [Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate) 与 [Drizzle 文档](https://orm.drizzle.team/docs/overview) 当前版本为准（**本机未安装，未验证**）。

## 最小迁移器：40 行，在 node:sqlite 上真跑

```js
const fs = require('node:fs'), path = require('node:path');
const sha = (s) => require('node:crypto').createHash('sha256').update(s).digest('hex').slice(0, 16);
const db = new DatabaseSync('app.db');

db.exec(`create table if not exists schema_migrations(version TEXT PRIMARY KEY,
  name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')), sql_sha TEXT NOT NULL)`);
const applied = () => new Map(db.prepare('select version, sql_sha from schema_migrations').all()
                              .map((r) => [r.version, r.sql_sha]));
const pending = () => fs.readdirSync('migrations')
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .map((f) => ({ version: f.split('_')[0], file: f, sql: fs.readFileSync(path.join('migrations', f), 'utf8') }))
  .sort((a, b) => a.version.localeCompare(b.version));

const done = applied();
for (const m of pending()) {
  if (done.has(m.version)) {
    if (done.get(m.version) !== sha(m.sql)) throw new Error(`迁移 ${m.file} 被改过：已记录 ${done.get(m.version)}，当前 ${sha(m.sql)}`);
    console.log(`跳过 ${m.file}`);
    continue;
  }
  db.exec('begin immediate');                 // 一条迁移 = 一个事务，且提前抢写锁
  try {
    db.exec(m.sql);                            // 一个文件里多条语句也可以
    db.prepare('insert into schema_migrations(version,name,sql_sha) values(?,?,?)').run(m.version, m.file, sha(m.sql));
    db.exec('commit');
    console.log(`应用 ${m.file}`);
  } catch (e) {
    db.exec('rollback');                       // 半截结构绝不留在库里
    throw new Error(`迁移 ${m.file} 失败：${e.message}`);
  }
}
```

实测行为（三条都得跑通才叫迁移器）：

```text
① 空库从零重放：应用 0001 用时 12ms / 应用 0002 用时 9ms，对象清单出现 users、idx_users_handle、idx_users_created
② 再跑一次：跳过 0001 / 跳过 0002 / 跳过 0003，schema_migrations 记录数不变   ← 幂等
③ 0003 第二条故意写坏（主键冲突）：
   失败: "UNIQUE constraint failed: users.id"
   行数 之前=2 之后=2；索引存在吗=[]        ← 同文件里前一条已成功的 CREATE INDEX 也被撤销
   schema_migrations: []                    ← 没跑成功就不许记账
```

③ 就是「一条迁移一个事务」的全部价值：**结构变更要么整体生效，要么整体不存在**。如果迁移文件不带事务，你会得到一个「索引建了、表没建」的库，下一条迁移必然崩，而且没人知道该从哪修。

还有④：把已应用过的 0001 文件末尾加一行注释再跑 —— 实测记录的哈希 `5524faa25032930e` 与当前文件 `6e52a1c84d2b7a42` 不一致，迁移器直接抛错；把文件还原后又一致。**这就是 CI 里必须有的那道闸门**：改历史迁移文件的人以为「只是顺手补个索引」，但生产库早已跑过老版本，重放结果会和生产分叉。

## up 与 down：以及什么时候别写 down

每个 up 配一个 down 是理想（本机实测这条 down 能跑通）：

```sql
-- 0002_add_bio.down.sql
DROP INDEX idx_users_created;
ALTER TABLE users DROP COLUMN bio;
```

但要清楚 down 的真实语义：**它回滚结构，不回滚数据。** `ADD COLUMN bio TEXT` 之后跑了回填，`DROP COLUMN bio` 会把回填出来的值全丢掉。于是：凡是丢数据的 down 就别假装能回滚，写 `-- 不可逆：无 down` 并让 down 在 CI 里明确失败，比给一个错误的 down 安全；**生产回滚首选「回滚代码」而不是「回滚 schema」**（新代码兼容旧结构，版本发布回退即可，数据库不动），这条在[发布与回滚](/devops/release-and-rollback)里从部署侧讲，两侧要用同一套约定。SQLite 的 `DROP COLUMN` 需 3.35+、`RENAME COLUMN` 需 3.25+（本机 3.51.1 两条都跑通），老版本上这两句直接语法错误 —— **动手前核对 [SQLite ALTER TABLE 文档](https://www.sqlite.org/lang_altertable.html)。**

## 命名、顺序，与「漏掉的那一条」

递增序号（`0001_`）顺序一目了然但两人会撞号；时间戳（`20261018_0930_`）几乎不撞但看不出业务顺序；两者混用（`0007_20261018_add_rating`）最稳但名字长。选哪种都行，**排序键必须就是文件名的第一段**（上面迁移器用 `f.split('_')[0]` + `localeCompare`）。三条纪律：

1. **不要插队。** 已经应用到环境里的版本号之后不能再补一个更小的号；要补就开新号，并在描述里写明「这是 0003 漏的那一条」。
2. **撞号要当成构建失败。** 迁移器应该检查「已记录的 version 在文件里找不到」和「文件里两个相同 version」，两种都直接退出 —— 后者尤其阴险：排序稳定，第二个会被当成「已应用」而静默跳过。
3. **迁移只加不改。** 需要修上一个迁移，做法是新加一条把它往下推，而不是编辑老文件（哈希校验会替你拦住）。

## 自动 diff 生成的产物为什么危险

`prisma migrate diff`、Drizzle 的 generate、各种 schema-diff 工具都能生成迁移，但产物有四类实测风险。

**① 跨方言静默通过。** 开头那条 `AFTER a` 就是证据：`PRAGMA table_info` 里类型变成 `text after a`，`sqlite_master` 的 DDL 也原样存下来。语法过关 ≠ 语义正确。

**② 只看表，漏掉别的对象。** 实测一张表 `t` 在 `sqlite_master` 里的关联对象是 `table:t`、`trigger:trg_t`、`index:idx_t_a`，另有 `view:v_t`。diff 若只比 `CREATE TABLE` 列表，**触发器和视图整个漏掉**，新环境起来后行为不同且没有任何报错。视图、触发器、生成列、行安全策略（PG 的 RLS）、权限都要进 diff 范围。

**③ 删除类语句不替你处理依赖。** 实测：有视图 `v_t` 依赖时 `DROP TABLE t` **照样成功**，之后查视图才报 `no such table: main.t` —— 坏对象是潜伏的。（PostgreSQL 会直接拒绝并要求 `CASCADE`；未在本机验证，以官方文档为准。）

**④ 改名会被理解成「删一列 + 加一列」。** 这是 diff 工具最贵的错误：新列意味着**丢数据**。实测正确姿势是显式 `RENAME COLUMN`，且要警惕约束跟着旧列走：

```text
四步走完 PRAGMA table_info： ["id null", "title_old NOT NULL", "title null"]
```

把 `title` 改名成 `title_old`、再把 `slug` 改名成 `title` 之后，**`NOT NULL` 留在旧列 `title_old` 上，新列 `title` 是可空的** —— 约束跟着列物理走，不会随名字迁移。diff 工具生成的 `DROP + ADD` 也一定会丢掉这个约束。

## 不可逆迁移的拆法：加列 → 回填 → 切换 → 清理

先看 SQLite 的 ALTER 能力边界，全部是本机跑出来的原文：

| 想要的操作 | SQLite 支持吗 | 实测结果 |
| --- | --- | --- |
| `ADD COLUMN`（可空，或 `NOT NULL DEFAULT 常量`） | 支持 | 20 万行的表上用时 **9 ms / 8 ms**，与行数无关（只改元数据） |
| `ADD COLUMN ... NOT NULL`（不给默认） | 不支持 | `Cannot add a NOT NULL column with default value NULL` |
| `ADD COLUMN ... DEFAULT (表达式)` | 不支持 | `default value of column [slug] is not constant` |
| `ALTER COLUMN` 改类型/改约束 | **没有这个语法** | `near "alter": syntax error` |
| `RENAME COLUMN` / `DROP COLUMN` | 支持（3.25+ / 3.35+） | 实测跑通，但约束留在旧列（见上） |
| 改类型 | 只能重建表 | 见下面外键实测 |

「加列 → 回填 → 切换 → 清理」这条链路，实测代价分布是这样的（20 万行、库文件 5 857 280 字节）：

```text
ADD COLUMN（可空）           9 ms     ← 元数据操作，永远安全
全表 UPDATE 回填             171 ms   ← 真正要拆批的就是这一步
全表 CREATE INDEX            125 ms
分批回填（10 批 × 2 万行）    245 ms   ← 总时长变长，但每个事务短得多
```

**分批不是为了更快，实测反而更慢（245 ms vs 171 ms）**：它的意义是把一次长锁切成 10 段短锁，中间别人能写进去、能备份、能检查点。生产上表大 100 倍时，一次全表回填 = 一个长事务 + 巨大的回滚日志（[事务与并发](/database/transactions) 实测 `-wal` 能涨到 11.8 MB），这才是拆批的理由。回填要保证**幂等**（`where slug is null` 或按主键区间游标推进），失败重跑不重复处理。

改类型必须重建表，本机实测的两个坑必须知道：

```text
事务内执行 pragma foreign_keys=0      → 读回来还是 {"foreign_keys":1}（空操作！）
foreign_keys=1 时 drop table parent   → "FOREIGN KEY constraint failed" errcode=787
正确顺序：建 parent_new 并灌数据 → 事务外 pragma foreign_keys=0 → 事务内 drop + rename → commit → 事务外再打开
收尾检查：child 外键仍指向 parent ✔；child 的 idx_child_pid 还在 ✔；
         parent 自己的 idx_parent_code 没了 ✘（DROP TABLE 带走它的全部索引）
         pragma foreign_key_check → [] ；pragma integrity_check → "ok"
```

三句话：**`PRAGMA foreign_keys` 只能在事务外改**；**重建表要手工重建该表的索引、触发器、视图和权限**；**收尾必须跑 `foreign_key_check` + `integrity_check`**。另外实测 node:sqlite 新建连接时 `foreign_keys` 就是 1，而 SQLite 默认是关的 —— 换驱动时外键到底有没有生效，先 `pragma foreign_keys` 读一次，别猜。

`ALTER TABLE RENAME` 有个善意行为：实测把 `users` 改名成 `accounts` 后，另一张表 `posts` 的 DDL 自动变成 `references "accounts"(id)`，视图也还能查。别把这份方便当成保险 —— 它只改写数据库里能解析到的引用，代码里的 SQL、ORM 查询串、外部报表不会跟着变。

## 迁移与部署的顺序

标准解法是 **expand / contract（先扩后收）**，一次需求拆两次以上发布：

| 阶段 | 数据库动作 | 代码动作 | 为什么安全 |
| --- | --- | --- | --- |
| 1 扩展 | `ADD COLUMN rating TEXT`（可空） | 不发 | 老代码不认识新列，照跑 |
| 2 双写 | 无 | 新代码同时写 `handle` 与 `rating`，读旧列 | 新旧列都有值，随时能退回老代码 |
| 3 回填 + 切换 | 分批 `UPDATE`，建校验 | 新代码改读新列 | 读切换失败可立刻回滚代码 |
| 4 收缩 | `DROP COLUMN`/`RENAME` 收尾 | 已确认没人依赖旧列 | 至少隔一次发布再做 |

四条硬规矩。**迁移先于代码上线且只跑一次**：多实例同时 `migrate` 会抢锁，SQLite 上靠 `BEGIN IMMEDIATE` + BUSY 重试（实测后到者立刻拿到 errcode 5），或干脆交给 CI 里的一次性 Job；PostgreSQL 常见做法是咨询锁 `pg_advisory_lock`（本机无 PG，未验证）。**同一版本里不要既改列名又删旧列**：中间态必须能被老代码消费，否则发布失败就没有退路。**新增 `NOT NULL` 一律先可空 + 常量默认值**，回填完再加约束（实测直接 `NOT NULL` 无默认值报 `Cannot add a NOT NULL column with default value NULL`，带常量的能过）。**迁移失败要干净退出**：迁移器抛错即部署中断（`process.exitCode = 1`），别让应用带着半套结构接流量，优雅关闭顺序见[服务部署：Docker、优雅关闭与配置](/backend/docker-and-shutdown)。

## 多环境一致性

新环境走「从 0001 全量重放」（实测空库 21 ms 建好），老环境走增量，**两条都要在 CI 里跑** —— 只跑增量会一直掩盖「重放不起来」这个致命问题。CI 的最小闭环是：起临时库 → `migrate` → `pragma integrity_check`（实测 `"ok"`）→ 跑冒烟查询，这一步比任何代码评审都更能拦住那条 diff 生成的怪迁移。另外三条约定：**seed 与迁移分开**（迁移只放结构和与结构绑定的数据变换，测试数据走 seed，否则新环境带上假用户）；**配置只给连接串不给结构**，环境差异走环境变量，见[环境变量与配置管理](/frontend-engineering/env-and-config)；**别在库里手搓**，发现 `schema_migrations` 少一条而结构已存在（有人手工 `ALTER` 过）时，修法是新写一条幂等迁移把结构对齐，补记录是埋雷。

## 常见错误与排查

**1. 结构一半生效：索引有了、表没了。** 手工执行过一段多语句 SQL，没包事务。确认：拿 `sqlite_master` 和迁移文件逐条对。修法：失败那条回滚后重放，迁移器必须一条一个事务（实测③）。

**2. 本地能跑、生产报 `near "alter": syntax error`。** 照着 MySQL 教程写的 `MODIFY` / `ALTER COLUMN`，SQLite 没这套语法，PG 写法又不同。修法：改类型走重建表，或用 `RENAME COLUMN` + 新列，关键字对着 [SQLite ALTER 文档](https://www.sqlite.org/lang_altertable.html) 查。

**3. diff 生成的迁移把改名变成删列加列。** 现象是新环境这列全 `NULL` —— 工具不认识你的意图。确认：生成的 SQL 里有没有 `DROP COLUMN` + 同名 `ADD COLUMN`。修法：手写成 `RENAME COLUMN`，并显式重建约束与索引（实测约束会留在旧列）。

**4. 生产上 `CREATE INDEX` 卡住写入十几分钟。** 建索引要扫全表并持写锁，SQLite 单写者，期间别的写全在等或拿 BUSY。确认：迁移前后各取一次时间戳（实测 20 万行 125 ms，量级随数据线性增长）。修法：索引放流量低谷、或拆进分批迁移；PostgreSQL 用 `CREATE INDEX CONCURRENTLY`（本机无 PG，未验证）。

**5. 应用启动时自动 `migrate`。** 多实例同时起，一个成功、其余报 `database is locked`，或两边交替改结构。修法：迁移做成独立的一次性步骤（部署前单独命令或 CI Job，见 [CI/CD 与 GitHub Actions](/devops/ci-cd)），应用启动只**校验**版本号，不执行迁移。

## 练习

<Exercise title="练习 1 · 从零重放一个三表结构" difficulty="基础">

用本章的迁移器思路，在临时目录里写 3 条迁移：建 `users`、建 `orders`（带 `user_id` 外键）、给 `orders(created_at)` 建索引。要求：① 在全新空库一次跑通；② 连跑两次第二次零动作；③ 打印 `sqlite_master` 的对象清单证明结构完整。写出你的验证命令与预期输出。

<template #answer>

关键点三条：文件名的第一段必须是可排序版本号（`0001_`/`0002_`/`0003_`）；建带外键那张表之前，被引用的表必须已在更早的迁移里建好（**顺序错了就是 `FOREIGN KEY constraint failed` 或 `no such table: users`**）；迁移器要有 `create table if not exists schema_migrations`。验证方式（本章实测同款）：

```bash
node migrate.cjs            # 应用 0001 / 0002 / 0003
node migrate.cjs            # 跳过 0001 / 跳过 0002 / 跳过 0003
```

再对着库跑 `select type,name from sqlite_master where name not like 'sqlite_%'`，应看到 2 张表 + 2 个索引 + `schema_migrations`；`pragma foreign_key_check` 返回空即外键可用。注意 node:sqlite 新建连接 `foreign_keys=1`（实测），但**每个连接都要显式设置**，换别的驱动才照样生效（外键开关是连接级、不是库级）。

</template>

</Exercise>

<Exercise title="练习 2 · 故意让迁移失败一半，并证明库里没留残骸" difficulty="进阶">

写一条迁移，第一条语句 `CREATE INDEX idx_users_bio ON users(bio)`，第二条故意造成主键冲突。跑完后必须用查询证明：**索引不存在、行数没变、`schema_migrations` 里没有这条记录**。贴出你看到的报错原文，然后解释为什么「按顺序手工执行这两句」会得到完全不同的结果。

<template #answer>

本章实测原文：

```text
失败: "UNIQUE constraint failed: users.id"
行数 之前=2 之后=2；索引存在吗=[]
schema_migrations: []
```

手工顺序执行时，第一句已经单独提交，失败后你会留下一个建在旧语义上的 `idx_users_bio`；下一条迁移再 `CREATE INDEX` 会撞 `index idx_users_bio already exists`，于是有人改用 `CREATE INDEX IF NOT EXISTS` 把问题永久埋下去 —— **结构开始和环境悄悄分叉**，这是最难查的一类线上故障（因为迁移器报告「成功」）。

顺带两个值得亲手验证的行为：把 `insert into schema_migrations` 放在 `commit` **之后**，失败时会留下一个「记了版本号但结构没生效」的库，比没记更糟；把 `rollback` 漏在 `catch` 里，连接会一直占着写锁，后续所有迁移报 `database is locked`（errcode 5，见[事务与并发](/database/transactions)）。

</template>

</Exercise>

<Exercise title="练习 3 · 把一个 NOT NULL 列安全地改名" difficulty="挑战">

线上表 `posts(id, title TEXT NOT NULL)` 有 500 万行，`title` 要改名成 `headline`，且不能出现「读不到标题」的窗口，也不能丢数据。写出完整的迁移序列（每步一条迁移文件，标注可回滚点），并说明为什么本章实测里「改名后 `NOT NULL` 留在旧列」这件事会决定你的写法。

<template #answer>

分四条迁移 + 两次发布：

```sql
-- 0010（扩展，可回滚）
ALTER TABLE posts ADD COLUMN headline TEXT;            -- 实测 9ms 级，与行数无关
-- 0011（回填，幂等、分批，单独跑而不塞进长事务）
UPDATE posts SET headline = title WHERE id BETWEEN ? AND ? AND headline IS NULL;
-- 0012（对齐约束：新列补 NOT NULL 只能靠重建表，见本章外键那一段）
-- 0013（收缩，隔一次发布再做）
ALTER TABLE posts DROP COLUMN title;
```

代码侧：先双写 `title` + `headline`（发布 A），确认回填完成且校验通过后切读到 `headline`（发布 B），最后才做 0013。可回滚点在 A、B 两处，都在代码层，不在 schema 层。

**为什么要额外一条 0012**：本章实测 `RENAME COLUMN` 之后约束跟着物理列走 —— `title_old` 仍是 `NOT NULL`，新顶上的 `title` 变成可空；改名不会把约束搬过去，加列更不会。SQLite 不能 `ALTER COLUMN` 加约束（实测 `near "alter": syntax error`），所以给新列补 `NOT NULL` 只剩重建表，或用 `CHECK (headline IS NOT NULL)` + 触发器兜住。生产上更稳的做法是**根本不补**：新列保持可空、代码写入前校验，等旧列彻底退役后再择机重建。最后一句容易忘：`DROP COLUMN` 会把该列上的索引一起带走（与实测 `DROP TABLE` 连带删索引同族），0013 之后要重新核对 `sqlite_master` 的索引清单。

</template>

</Exercise>

## 官方文档与延伸阅读

- [SQLite ALTER TABLE 文档](https://www.sqlite.org/lang_altertable.html) —— 核实本章表格：`ADD COLUMN` 的限制、改类型必须重建表、以及官方那套多步流程；本章三条报错原文与之相符。
- [SQLite lang_createindex](https://www.sqlite.org/lang_createindex.html) 与 [pragma 清单](https://www.sqlite.org/pragma.html) —— 核实 `foreign_keys` 是连接级开关、`foreign_key_check`/`integrity_check` 的用法（实测值：node:sqlite 新建连接 `foreign_keys=1`）。
- [SQLite lang_transaction](https://www.sqlite.org/lang_transaction.html) —— 迁移器为什么用 `BEGIN IMMEDIATE`。
- [Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate) —— `migrate dev` / `migrate deploy` / `migrate diff` / `migrate reset` 的职责与 `_prisma_migrations` 记账；**本机未安装，命令与字段以官方文档当前版本为准**。
- [Drizzle 文档](https://orm.drizzle.team/docs/overview) —— 对照方案；注意它的「直接推结构」类命令会绕过版本化历史，用它之前先确认团队流程。
- [PostgreSQL 文档主入口](https://www.postgresql.org/docs/current/index.html) —— `CREATE INDEX CONCURRENTLY`、`DROP ... CASCADE`、咨询锁这三处 PG 差异的权威依据（本章均未在本机验证）。

## 下一章

迁移保证结构可重放，[备份与恢复](/database/backup-and-restore) 保证数据可回退 —— 两者会在同一刻交汇：你在生产执行 0012 那条重建表的迁移之前，必须先有一个**验证过能恢复**的备份。下一章会把 SQLite 单文件复制为什么不安全（实测：WAL 下拷走的 `.db` 里连表都没有，而 `integrity_check` 照样报 `ok`）、`VACUUM INTO` 与在线备份 API 的正确用法、以及 `pg_dump` / `pg_restore` / PITR 的分工全部讲清；往回看，[数据建模](/database/data-modeling) 决定了你有多少迁移要改数据而不只是改结构。
