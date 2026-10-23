# 数据建模：外键拦得住什么，软删除漏掉什么

三个真实故障：注销后订单列表少了三单——外键写了 `ON DELETE CASCADE`，而软删除与物理删除共用一个接口；外键只写了 `REFERENCES`，没人管连接级开关，两万行孤儿记录安静地存进去；注册报 `UNIQUE constraint failed: users.email`，那个邮箱属于一个「已经删掉」的用户。它们都不是语法问题，而是**建模期没决定的四件事**：关系靠什么强度维护、层级怎么存、删除是什么语义、哪些值允许存在。这一章逐条建表、跑一遍、贴报错原文。

<Callout type="verified" title="本章 DDL 与约束行为全部在本机跑过">

Windows + Node v25.4.0 内置 `node:sqlite`，`SELECT sqlite_version()` 返回 **3.51.1**，日期 2026-10-18。每个 `THROWS:` 原文、每个 `changes=N`、每份计划都是实际输出。**环境差异**：`new DatabaseSync()` 默认**开启**外键强制（`PRAGMA foreign_keys` 返回 1），与 SQLite 命令行/C 接口默认关闭的常识相反，传 `enableForeignKeyConstraints: false` 才得到 0；`node:sqlite` 仍是实验特性。

</Callout>

## 外键的强制力来自连接，不来自表结构

`book.author_id REFERENCES author(id)` 建好后插一条悬空引用：

```text
INSERT INTO book(author_id, title) VALUES (999, '幽灵书');
  THROWS: FOREIGN KEY constraint failed
```

同一句在 `enableForeignKeyConstraints:false` 的连接里 `OK changes=1`，之后再没有人报错——只能靠 `PRAGMA foreign_key_check`（输出形状 `{"table":"b","rowid":1,"parent":"a","fkid":0}`）或反连接 `LEFT JOIN ... WHERE 父.id IS NULL` 捞孤儿。三条边界全部实测：开关是**连接级**，同一个库文件两个连接一个拦一个不拦；事务里改 PRAGMA 是空操作，`BEGIN; PRAGMA foreign_keys=OFF;` 后插悬空行仍报错；打开开关不追溯脏数据。外键还拦两件常被忽略的事：子行存在时 `DELETE FROM author WHERE id=1` 报错，改父表主键 `UPDATE author SET id=8 WHERE id=7` 报同样的错。

## `ON DELETE` 四种动作的可见差别

```text
post (uid REFERENCES usr(id) ON DELETE CASCADE)  删 usr=1 → 他的 2 篇一起消失
sess (uid REFERENCES usr(id) ON DELETE SET NULL) 删 usr=2 → uid 变 null，token 行还在
fav  (uid REFERENCES usr(id) ON DELETE RESTRICT) 删 usr=3 → THROWS: FOREIGN KEY constraint failed
```

不写动作就是 `NO ACTION`，本机行为等同 `RESTRICT`。动作定义别靠记忆，读得回来：`pragma_foreign_key_list('post')` 给出 `{"table":"usr","from":"uid","to":"id","on_update":"NO ACTION","on_delete":"CASCADE","match":"NONE"}`——**`on_update` 是独立一列**，只写了 `ON DELETE` 的行更新父键照样被拦。互相引用的两行必须靠延迟约束：非延迟表第一条 `INSERT INTO pairA VALUES (1,2)` 就报 `FOREIGN KEY constraint failed`；改成 `DEFERRABLE INITIALLY DEFERRED` 后同一事务里两条都成功（读回 `(1,2)` 与 `(2,1)`），但**提交时仍补检查**——插入 `(5,99)` 后 `COMMIT` 报错。

## 多对多：中间表的复合主键只挡得住一个方向

```text
CREATE TABLE enroll(
  student_id INTEGER NOT NULL REFERENCES stu(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id, course_id));
```

实测四种后果：插 `(1,1),(1,2),(2,1)` 得 `changes=3`；再插 `(1,1)` → `THROWS: UNIQUE constraint failed: enroll.student_id, enroll.course_id`；插学生 99 或课程 99 → `THROWS: FOREIGN KEY constraint failed`（两侧都拦）；`DELETE FROM stu WHERE id=1` 把中间表里他的两行一起清掉。**「不能重复选课」和「两个学生可选同一门课」是同一条复合主键给的**，别拆成两个 `UNIQUE`。方向性要用计划验证：`WHERE student_id=2` 是 `SEARCH enroll USING INDEX sqlite_autoindex_enroll_1 (student_id=?)`，`WHERE course_id=1` 却是 `SCAN enroll`——反查用不了最左前缀，补上 `CREATE INDEX idx_enroll_course ON enroll(course_id)` 才变回 `SEARCH ... (course_id=?)`。「查某班花名册」是刚需，所以中间表通常要**两个方向的索引**（原理见[第 6 章 索引与执行计划](/database/indexes)）。人数统计必须 `LEFT JOIN` 且 `COUNT(e.student_id)`：实测 `SQL 1 人 / CSS 0 人`，用 `COUNT(*)` 的话没人选的课会算成 1。

## 自引用与层级：三种存法，代价各在不同地方

邻接表 + `CHECK` 拦得住自环，拦不住环：

```text
CREATE TABLE cat(id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  parent_id INTEGER REFERENCES cat(id), CHECK (parent_id IS NULL OR parent_id <> id));
INSERT INTO cat VALUES (5,'怪圈',5);
  THROWS: CHECK constraint failed: parent_id IS NULL OR parent_id <> id
UPDATE cat SET parent_id = 4 WHERE id = 2;   -- OK changes=1  ← 2 与 4 互指，没人拦
DELETE FROM cat WHERE id = 4;                -- THROWS: FOREIGN KEY constraint failed ← 「叶子」也删不掉
```

4 本来是叶子，但 2 指着它之后它就不是了——**环让「深度」这个概念失效**。同一张表跑全树递归，正常 4 行返回 4 行，造环后只返回 2 行（能连到根的分支），环里两行被静默丢弃：这就是「防环必须写在应用层或递归查询里」的实测依据（判环写法见[第 4 章 窗口函数与 CTE](/database/sql-advanced)）。另两种存法也建了表：

```text
-- 物化路径：path 存 '/1/2/4/'，查全部后代是一句前缀 LIKE
SELECT id,name FROM cat2 WHERE path LIKE (SELECT path||'%' FROM cat2 WHERE id=1);  -- 4 行，含自己
UPDATE cat2 SET path = '/9/2/' || substr(path,4) WHERE path LIKE '/1/2/%';         -- 移动子树 changes=2
-- 闭包表 closure(anc,desc,depth)：每个节点到它所有祖先一条边
SELECT c.anc,k.name,c.depth FROM closure c JOIN cat2 k ON k.id=c.anc WHERE c.desc=4 ORDER BY c.depth;
  -- 4 折叠屏(0) → 2 手机(1) → 1 数码(2)
```

代价各在不同处：邻接表移动子树改 1 行但查子树要递归；物化路径查子树一句 `LIKE`，移动却要改 N 行；闭包表两个方向都是等值查询，代价是 4 个节点存 8 条边、移动子树要删旧边建新边并包进事务。**选哪种取决于读多还是写多**：类目树读多选物化路径或闭包表，频繁改父级就退回邻接表。命名上，自引用的父列就叫 `parent_id`，闭包表的方向列必须明确（`anc`/`desc`）。

## 代理键与自然键：三行建表语句的差别

三张表放在一起对照：`sur(id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, city TEXT)`、`surai(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, city TEXT)`、`nat(code TEXT PRIMARY KEY, city TEXT)`。

实测三件事：`INTEGER PRIMARY KEY` 就是 `rowid` 别名（`SELECT id, rowid, id = rowid FROM sur` → `same=1`）；删掉最大 id 后，无 AUTOINCREMENT 的表**会复用**（插 `GZ` 得 `id=2`），AUTOINCREMENT 单调不复用（同样插入得 `id=3`，`sqlite_sequence` 里 `seq=3` 记着水位）；自然键重复报 `THROWS: UNIQUE constraint failed: nat.code`。

**`ON DELETE CASCADE` 配会变的自然键是最坏组合**：编码一改就得动所有引用行；代理键的代价只是一列整数和一次 `UNIQUE` 检查，所以默认选代理键、业务编码留作 `UNIQUE` 列。另有一条属于 Node 层而非 SQL 层的坑：`INSERT INTO sur(id,code,city) VALUES (9007199254740993,'BIG','x')` 能成功，但随后 `SELECT id FROM sur WHERE code='BIG'` 报 `THROWS: Value is too large to be represented as a JavaScript number: 9007199254740993`（默认 `readBigInts: false`）。让 id 交给数据库自增，别把外部大整数当主键写进去。

## 约束的报错原文与 CHECK 的边界

报错文本带的是**列名或表达式原文**：`NOT NULL constraint failed: t6.a`、`CHECK constraint failed: b BETWEEN 1 AND 10`，主键重复也走 UNIQUE 路径报 `UNIQUE constraint failed: t6.id`，`CHECK (a IN (SELECT id FROM users))` 建表就报 `subqueries prohibited in CHECK constraints`。取值能不能用非常数函数兜底？两种答案都反直觉：`CHECK (v > datetime('now'))` 建表 OK，但插任何值（哪怕 `'2999-01-01'`）都报 `THROWS: non-deterministic use of datetime() in a CHECK constraint`，报错发生在插入时而不是建表时；`CHECK (x > random())` 建表和插入都不拦，连跑三次全部成功，**约束变成抛硬币**。`ALTER TABLE` 的边界顺带记下：只有**常量**默认值能加列（`DEFAULT (datetime('now'))` 报 `Cannot add a column with non-constant default`，`ADD COLUMN c TEXT NOT NULL` 不带默认值报 `Cannot add a NOT NULL column with default value NULL`），且不能删约束——想把老 `UNIQUE` 换成部分唯一索引就得重建表。

## 软删除：`deleted_at` 只是数据，不是语义

普通 `UNIQUE` 与软删除的第一次冲突：

```text
UPDATE users SET deleted_at='2026-02-01' WHERE id=1;
INSERT INTO users(email,name) VALUES ('a@x.com','甲2');
  THROWS: UNIQUE constraint failed: users.email    ← 邮箱还被「已删」的行占着
```

正解是部分唯一索引，但**表级语法在本机不存在**：`CREATE TABLE ... UNIQUE(email) WHERE deleted_at IS NULL` 报 `THROWS: near "WHERE": syntax error`，能用的只有 `CREATE UNIQUE INDEX ux_email_active ON users4(email) WHERE deleted_at IS NULL;`。之后实测：软删旧行后再注册同邮箱 `OK changes=1`；两个都活跃时插同一个邮箱 → `UNIQUE constraint failed: users4.email`；**恢复旧账户**（`SET deleted_at=NULL`）→ 又撞 `UNIQUE`，恢复路径必须设计冲突处理。

外键不看 `deleted_at`，于是物理删父行照样被拦住：`DELETE FROM users WHERE id=1` 报 `FOREIGN KEY constraint failed`，把子行 `UPDATE notes SET deleted_at='2026-02-02' WHERE uid=1`（`changes=2`）「软删」之后再删父行，**仍然报同一个错**。

口径漂移同样实测过：同一时刻 `COUNT(*) FROM notes` = 3、`WHERE deleted_at IS NULL` = 1；`LIMIT 2 OFFSET 1` 的偏移量含已删行；子表条件写在 `WHERE` 会让 `LEFT JOIN` 退化成 `INNER JOIN`（[第 3 章 SQL 查询基础](/database/sql-basics) 讲过）。归档任务另有一处静默失败：`DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < '2026-01-31'` 得到 `changes=0`——那两行的 `deleted_at` 是 `2026-02-02`，条件永远不成立，**清理任务连续三个月返回 0 也不会报错**，必须打日志。

`INSERT OR REPLACE` 内部是 DELETE + INSERT：实测一次「只改邮箱」的 REPLACE 把 `ON DELETE CASCADE` 的子表行**全带走**（`SELECT * FROM post` → 0 行），换成 `ON CONFLICT(id) DO UPDATE` 的 UPSERT 才保住。

## 范式与有意的反范式：改价那一下最诚实

规范化三表（订单 `o3`、明细 `item3`、商品 `p3`），订单头用冗余列 `total` 存总额：

```text
SELECT o.id, o.total, (SELECT SUM(i.qty*p.price) FROM item3 i JOIN p3 p ON p.id=i.pid
                       WHERE i.oid=o.id) recomputed FROM o3 o;
  -- 改价前：697 / 697   UPDATE p3 SET price=199 WHERE id=1 之后：697 / 497  ← 历史订单被悄悄改了
```

这就是更新异常：**冗余列不冻结，价格一动历史就漂移**。正解是把成交价抄进**明细行**而不是订单头——实测明细里 `price` 为 `NULL` 的两行跟着现价漂（`line_total` 398、99），冻结过的那一行永远是 88。宽表（商品名、价格、分类抄进每一行）的收益与代价各量过一遍，两边都 5 万行、`cat='C3'`：

| 场景 | 规范化三表 | 宽表 |
| --- | --- | --- |
| 取 20 行明细（7 次取中位） | 5.24 ms（`SCAN i` + 两次 `SEARCH ... USING INTEGER PRIMARY KEY`） | 0.03 ms（`SEARCH wide USING INDEX idx_wide_cat`） |
| `COUNT(*)` | 3.51 ms | 0.11 ms |
| 改一个分类的商品名要写几行 | 1 行 | `changes=4250` |
| 该分类下有几个不同商品 | 17（逐个改名要 17 次） | 同一个名字被抄 4250 遍 |

**读快两个数量级，写放大几百倍——报表/搜索侧值得反范式，交易侧不值得。** 自检也能查：名字决定价格就必须一对一，`SELECT product_name, COUNT(DISTINCT product_price) FROM wide GROUP BY 1;` 一旦给出 2 就是同名不同价（手动造一行 199 后，实测分组为 `199/1 行` 与 `299/50000 行`）。

## 时间戳、状态机与枚举：默认值和 CHECK 才管事

同一条 `INSERT`（不带显式值）里几种默认值的真实输出：`a TEXT DEFAULT CURRENT_TIMESTAMP` → `'2026-01-18 01:49:33'`（typeof=text，UTC）；`c INTEGER DEFAULT (unixepoch())` → `1792288173`（typeof=integer）；`d TEXT DEFAULT (datetime('now','localtime'))` → `'2026-01-18 09:49:33'`，**与 a 差 8 小时**。`TIMESTAMP` 类型名只是把列亲和性标成 NUMERIC，存进去仍是 TEXT；同一列混存 TEXT 时间与 INTEGER epoch 也真实发生过，`datetime(v,'unixepoch')` 只对后者出数、前者给 `null`——**要么全用 TEXT 的 UTC 串，要么全用 INTEGER epoch**。MySQL 的 `ON UPDATE CURRENT_TIMESTAMP` 在 SQLite 里不存在（`THROWS: near "ON": syntax error`），只能用 `AFTER UPDATE` 触发器补，两个实测陷阱：秒级 `CURRENT_TIMESTAMP` 分辨不出连续两次更新，要靠 `%f`（实测 `2026-01-18 01:49:33.196`）；触发器里再 UPDATE 同一张表时 `PRAGMA recursive_triggers` 默认 0 只跑一层，打开成 1 后报 `THROWS: too many levels of trigger recursion`——守卫写在触发器里，别改全局开关。

状态字段用 `CHECK` 兜取值、用流转表兜迁移：

```text
INSERT INTO ord VALUES (1,'已支付');
  THROWS: CHECK constraint failed: status IN ('draft','paid','shipped','cancelled')
UPDATE ord SET status='shipped' WHERE id=1
  AND EXISTS (SELECT 1 FROM trans WHERE from_status='draft' AND to_status='shipped');
  -- OK changes=0    ← 非法迁移不报错，只是什么都没做；查回来仍是 draft
```

`changes=0` 是最危险的一种失败：接口 200，库里什么都没改，**判断成功的依据是 `changes` 而不是「没抛异常」**。枚举值会扩展时做成查找表 + 外键：`INSERT INTO ord2 VALUES (2,'refund')` 报 `FOREIGN KEY constraint failed`，往查找表加一行就放行——比 `CHECK` 活得久。

## 常见错误与排查

1. **统计里冒出孤儿行，或外键「没生效」。** 原因：这个连接没开外键强制（node:sqlite 默认开、CLI/C 默认关），或在事务里才改 PRAGMA。确认：`PRAGMA foreign_keys` 是不是 1，`PRAGMA foreign_key_check` 给出 `table/rowid/parent/fkid`。修：连接建立时就设，已有脏数据自己清理。
2. **删不掉父行，或删完子表空了。** 原因：`RESTRICT`/`CASCADE` 与业务预期不符。确认：`pragma_foreign_key_list('表')` 读回 `on_delete` 与 `on_update`。修：交易类关系用 RESTRICT + 应用层归档，真「拥有」关系才用 CASCADE。
3. **注册报 `UNIQUE constraint failed: users.email`，但那个用户「已经删了」。** 确认：`SELECT id,email,deleted_at FROM users WHERE email=?` 是否撞在非空 `deleted_at` 的行上。修：重建表去掉列级 `UNIQUE`，改用部分唯一索引，并给恢复账户设计冲突处理。
4. **非法状态迁移返回成功，或 `updated_at` 永远等于 `created_at`。** 原因：`UPDATE ... AND EXISTS(流转表)` 落空是 `changes=0`；秒级时间戳精度不够。修：`changes=0` 抛业务错误，时间戳带 `%f`，触发器加 `WHERE` 守卫（`recursive_triggers=1` 时同表触发器会报 `too many levels of trigger recursion`）。

## 练习

<Exercise title="用报错文本反推缺了哪条约束" difficulty="基础">

三条 INSERT，先写出报错原文，再指出是哪个约束造成的：

1. `INSERT INTO book(author_id,title) VALUES (999,'x')`，`author_id REFERENCES author(id)`，连接默认外键开启。
2. `INSERT INTO enroll(student_id,course_id) VALUES (1,1)`，`PRIMARY KEY(student_id,course_id)`，`(1,1)` 已存在。
3. `INSERT INTO cat VALUES (5,'怪圈',5)`，表上有 `CHECK (parent_id IS NULL OR parent_id <> id)`。

<template #answer>

1. `FOREIGN KEY constraint failed`——同一条在 `enableForeignKeyConstraints:false` 的连接里会成功，所以「没报错」不等于「约束存在」。2. `UNIQUE constraint failed: enroll.student_id, enroll.course_id`——复合主键走 UNIQUE 路径，报错列出全部参与列，这是判断「哪个键拦住了我」的唯一线索。3. `CHECK constraint failed: parent_id IS NULL OR parent_id <> id`——`CHECK` 给的是**表达式原文**而不是列名。

</template>

</Exercise>

<Exercise title="故意造一个环，看递归查询怎么骗你" difficulty="挑战">

按本章 `cat` 表插 4 行组成两层正常树，然后执行 `UPDATE cat SET parent_id = 4 WHERE id = 2;`。说出这条 UPDATE 的结果；跑全树递归 CTE，说明返回几行、为什么；再写一句能在提交前发现二元环的检测查询。

<template #answer>

`OK changes=1`——`CHECK` 只禁自环，跨节点的环 SQLite 不管。递归实测只返回 2 行：环里的 2、4 连不到根，被静默丢弃，不报错也不死循环，报表会「少一块且没人知道」。检测：`SELECT a.id, b.id FROM cat a JOIN cat b ON a.parent_id = b.id AND b.parent_id = a.id;`——非空即存在二元环；环必须在写入路径上拦，不能指望约束。

</template>

</Exercise>

<Exercise title="该不该反范式：用数字决定" difficulty="进阶">

沿用本章 5 万行对照：宽表取 20 行 0.03 ms、`COUNT(*)` 0.11 ms，规范化三表 5.24 ms 与 3.51 ms；宽表改一个分类的商品名要写 4250 行，规范化侧改 1 行、但该分类下有 17 个不同商品。商品「名称」该不该抄进订单明细？「成交价」呢？给出一条能反驳你自己结论的查询。

<template #answer>

名称不该：它是会变的展示字段，换来 0.03 ms 的代价是 4250 行同步，漂移后历史单据会「当年买的是 A、现在显示 B」。成交价必须抄：实测改价后 `total=697` 而重算 `497`，这是财务级错误——冻结的是**值**不是引用。反驳用这句：`SELECT product_name, COUNT(DISTINCT product_price) FROM wide GROUP BY 1 HAVING COUNT(DISTINCT product_price) > 1;`——任何非空结果说明冗余列已经开始互相矛盾。

</template>

</Exercise>

## 官方文档与延伸阅读

- [SQLite `CREATE TABLE`](https://www.sqlite.org/lang_createtable.html) —— `ON DELETE/UPDATE` 四种动作、`DEFERRABLE`、连接级外键开关。
- [SQLite PRAGMA 索引页](https://www.sqlite.org/pragma.html) —— `foreign_keys`、`foreign_key_check`、`recursive_triggers` 的默认值与作用域。
- [SQLite 部分索引](https://www.sqlite.org/partialindex.html) —— 为什么只有 `CREATE UNIQUE INDEX ... WHERE`，没有表级 `UNIQUE ... WHERE`。
- [SQLite `ALTER TABLE` 的限制](https://www.sqlite.org/lang_altertable.html) —— 只能加带常量默认值的列，不能删约束。
- [SQLite 日期时间函数](https://www.sqlite.org/lang_datefunc.html) —— `CURRENT_TIMESTAMP` 输出 UTC、`'localtime'`、`%f`。
- [Node.js `node:sqlite`](https://nodejs.org/api/sqlite.html) —— `enableForeignKeyConstraints` 与 `readBigInts`。
- [PostgreSQL 约束总览](https://www.postgresql.org/docs/current/ddc-constraints.html) 与 [MySQL 外键](https://dev.mysql.com/doc/refman/8.0/en/foreign-keys.html) —— **本章对这两家未做任何执行验证，也未据其下结论**。

## 下一章

本章反复出现「补一个索引，计划从 `SCAN` 变成 `SEARCH`」。[第 6 章 索引与执行计划](/database/indexes) 会在一张 10 万行的表上把耗时差跑出来，逐条验证最左前缀、覆盖索引、`LIKE` 前缀与写放大。
