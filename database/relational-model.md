# 关系模型：表只是投影，约束才是数据的法律

`data.json` 存学习记录的项目是怎么崩掉的，几乎每家都一样：启动时 `readFileSync` + `JSON.parse` 整个文件，写入时 `JSON.stringify` 整个对象再 `writeFileSync` 盖回去。第一天很好用。然后某次请求正在写，另一个请求早已读到同一份旧内容，两次落盘互相覆盖——不是丢一条记录，是丢中间所有记录。再然后你想统计「这门课多少人报名」，只能把整份 JSON 解析一遍；想改一个课程标题，得在所有报名记录里做文本替换，漏一处就永远留着旧标题。最后一次断电，文件写到一半，`JSON.parse` 报 `Unexpected end of JSON input`，你连「哪些记录还在」都说不清。[用 node:http 手写最小服务器](/backend/minimal-http-server) 里内存 Map 的局限，是同一个问题的内存版。

换成数据库之后最常见的失败，不是 SQL 不会写，而是**把表理解成「一个带列名的 JSON 数组」**。这种理解会引导你做三件事：把课程标题复制进每条报名记录、拿邮箱当主键、给外键写一句 `REFERENCES` 就以为数据库在替你检查引用。这三件事都会出错，而且都错得很安静。

<Callout type="verified" title="本章 SQL 全部在本机跑过">

Windows 10 x64 + Node v25.4.0 内置 `node:sqlite`，`SELECT sqlite_version()` 返回 **3.51.1**，日期 2026-10-18。`new DatabaseSync(':memory:')` 建库，共执行一百余条 DDL / DML / 查询，正文里每条 `THROWS:` 后的报错文本与每个结果集都是原样粘贴。`node:sqlite` 是实验特性，加载时 stderr 打印原话 `ExperimentalWarning: SQLite is an experimental feature and might change at any time`；构造选项名与默认值可能随 Node 版本变动，换版本请重跑。

</Callout>

## 关系是集合：四条能实测的后果

Codd 的关系（relation）是若干属性（attribute，列）的域（domain，允许取值集合）上的元组（tuple，行）**集合**。四条后果，每条都能测：

| 后果 | 实测 |
| --- | --- |
| 没有重复元组 | `UNION` 把同一份 `SELECT city ...` 的两份拷贝合成一份；改 `UNION ALL` 立刻两份都在 |
| 没有内在顺序 | 不写 `ORDER BY` 返回存储顺序；`ORDER BY name` 得 UTF-8 字节序：`Bob`、`Eve`、`dora`、`小富`、`阿栗`、`陈晨` |
| 属性靠名字识别 | `SELECT name, city` 与 `SELECT city, name` 是同一个关系换投影顺序 |
| 属性名不能重复 | `CREATE TABLE dup (a INTEGER, a TEXT)` → `THROWS: duplicate column name: a` |

第一条最容易误解：**「重复元组」指值完全相同的元组，不是同一个业务对象出现两次。** 这张没主键的表，三行在本机合法存在：

```text
CREATE TABLE raw (name TEXT, city TEXT);
INSERT INTO raw VALUES ('陈晨','上海'),('陈晨','上海'),('陈晨','上海');
SELECT name, city, COUNT(*) n FROM raw GROUP BY name, city;
  [{"name":"陈晨","city":"上海","n":3}]     -- 逻辑上只是「一行 × 3」
```

**逻辑上无法区分这三行**：你写不出任何只删第 2 行的 `DELETE`，因为能定位它的条件对三行同时成立。这就是主键存在的全部理由——给元组一个逻辑身份。

## 域在 SQLite 里降级成了建议

SQL 标准用数据类型表达域，SQLite 用**类型亲和性（type affinity）**：声明的类型只是建议，存得下就转、转不动就照原样存（逐列实测见[第 2 章 SQLite 入门](/database/sqlite-first)）。本章的直觉是：**真正守域的是 `CHECK`，不是列的声明类型。**

```text
INSERT INTO enrollments (user_id, course_id, score) VALUES (2, 11, 101);
  THROWS: CHECK constraint failed: score BETWEEN 0 AND 100
```

报错给的是**表达式本身**而不是列名，表级 `CHECK` 同理（`CHECK constraint failed: off >= 0 AND off <= 100`）——读迁移日志、把错误回显给用户时这是唯一线索。另一条边界：`CHECK (a IN (SELECT id FROM users))` → `THROWS: subqueries prohibited in CHECK constraints`。想让取值集合可扩展，就把它做成一张表 + 外键，让外键去当那个域。

## 主键：唯一、最小，并且与业务无关

```text
INSERT INTO users (id, ...) VALUES (1, ...)                     -- id 已存在
  THROWS: UNIQUE constraint failed: users.id
INSERT INTO users (name, email) VALUES ('x', 'bob@example.com')  -- email 上有 UNIQUE
  THROWS: UNIQUE constraint failed: users.email
INSERT INTO enrollments (user_id, course_id) VALUES (1, 10)      -- 复合主键已存在
  THROWS: UNIQUE constraint failed: enrollments.user_id, enrollments.course_id
```

**主键违约报的是 `UNIQUE` 而不是 `PRIMARY KEY`**，两者走同一条代码路径；复合键列出全部列名，是唯一可靠线索。「主键一定非空」这条公理在 SQLite 上要你亲手补全：

| 声明 | 插 NULL 主键 | 实测 |
| --- | --- | --- |
| `id INTEGER PRIMARY KEY` | 允许 | 它是 `rowid` 别名，自动补值且 `rowid = id` |
| `a TEXT PRIMARY KEY`（普通 rowid 表） | **允许** | 两张 NULL 主键行同时存在——历史包袱 |
| `a TEXT PRIMARY KEY NOT NULL` | 拒绝 | `THROWS: NOT NULL constraint failed: pk_nn.a` |
| `a TEXT PRIMARY KEY) WITHOUT ROWID` | 拒绝 | `THROWS: NOT NULL constraint failed: pk_wr.a` |

主键列要么用 `INTEGER PRIMARY KEY`，要么自己补 `NOT NULL`。别只看 `PRAGMA table_info` 的 `notnull`：实测连 `INTEGER PRIMARY KEY` 那一列它也报 0。

自增键会不会复用刚删掉的编号，决定它能不能当外部单号：

```text
id INTEGER PRIMARY KEY               -- 插 1,2,3 → 删 3 → 再插，id 又是 3（复用）
id INTEGER PRIMARY KEY AUTOINCREMENT -- 同样操作 → id = 4，sqlite_sequence.seq = 4
```

普通 `INTEGER PRIMARY KEY` 取「当前最大 rowid + 1」，**会复用**刚删掉的最大值；`AUTOINCREMENT` 靠 `sqlite_sequence` 保证单调。纯内部关联键用前者，要印进 URL、对账单的编号用后者。还有一条：**别拿业务字段当主键**——用 `email` 当主键，改邮箱就要级联更新所有引用它的子表，执法开着时 SQLite 直接拒绝（见下节）。代理键（surrogate key）的全部价值就在于它永远不变。

## 外键：`REFERENCES` 只是声明，执法是另一个开关

本章最重要的实测结论，也是「数据里怎么会有指向不存在用户的记录」的根因：**SQLite 的引用完整性默认不检查**，要每个连接执行 `PRAGMA foreign_keys = ON`。`node:sqlite` 补了构造选项 `enableForeignKeyConstraints`，本机实测它**默认为 `true`**：

```js
const { DatabaseSync } = require('node:sqlite');
new DatabaseSync(':memory:').prepare('PRAGMA foreign_keys').get();
// { foreign_keys: 1 }  ← node:sqlite 默认已开
new DatabaseSync(':memory:', { enableForeignKeyConstraints: false })
  .prepare('PRAGMA foreign_keys').get();
// { foreign_keys: 0 }  ← 这才是 SQLite 自身的默认行为
```

把执法关掉，看系统如何静默腐坏（`enrollments.user_id` 明明声明了 `REFERENCES users(id)`）：

```text
INSERT INTO enrollments VALUES (42, 10);   -- 成功，一句报错都没有
PRAGMA foreign_key_check;
  [{"table":"enrollments","rowid":1,"parent":"users","fkid":0}]
```

有了这行空洞，`SELECT COUNT(*) FROM enrollments` 与 `... JOIN users u ON u.id = e.user_id` 从此不一致——**后台显示 5 人报名、导出名单只有 4 人**就是这个机制。执法关闭时声明仍在（`PRAGMA foreign_key_list` 查得到），只是没人执行。打开之后各类写入的行为：

```text
INSERT INTO enrollments VALUES (999, 10);  THROWS: FOREIGN KEY constraint failed
DELETE FROM courses WHERE id = 10;         THROWS: FOREIGN KEY constraint failed  -- 还有子行
UPDATE users SET id = 100 WHERE id = 1;    THROWS: FOREIGN KEY constraint failed  -- 子行指向它
UPDATE users SET city = '杭州' WHERE id = 1;  (成功)                              -- 非键列
SELECT COUNT(*) n FROM courses;            -- 2，被拒的语句没留下半截状态
```

三条规则同样是实测的：

1. **开关是每连接的属性，不是库的属性。** 带空洞的文件库重开一次：pragma 回到默认值，`user_id = 777` 那行**仍在**，`foreign_key_check` 仍列出它。执法不追溯历史数据，所以顺序永远是：体检 → 清洗 → 打开 → 在代码里只写一处。
2. **引用目标必须是主键或 `UNIQUE` 列，但建表时不报错。** `CREATE TABLE child (c INTEGER REFERENCES parent(name))`（`name` 无唯一约束）执行**成功**，直到写入才炸：`THROWS: foreign key mismatch - "child" referencing "parent"`。指向 `UNIQUE` 列则正常且成员检查真生效。
3. **复合外键按位置配对，写反了没人拦。** `FOREIGN KEY (c, m) REFERENCES pm (module_no, course_id)`（父表主键顺序是 `course_id, module_no`）建表一声不响；写 `(10, 1)` → `FOREIGN KEY constraint failed`，写 `(1, 10)` → 成功。错位的外键比没有外键更危险，因为它看起来是对的。

删父行时的行为由 `ON DELETE` 决定，六张子表分别声明：

| 子表声明 | 结果 | 事后子行 |
| --- | --- | --- |
| `REFERENCES parent(id)`（默认 NO ACTION） | `FOREIGN KEY constraint failed` | 不动 |
| `ON DELETE RESTRICT` | `FOREIGN KEY constraint failed` | 不动 |
| `ON DELETE CASCADE` | 成功 | 一起被删 |
| `ON DELETE SET NULL` | 成功 | `p` 变 `null` |
| `ON DELETE SET DEFAULT`（默认值 0，父表无 0） | `FOREIGN KEY constraint failed` | `p` 仍是 5 |
| `ON DELETE SET NULL` 且子列 `NOT NULL` | `NOT NULL constraint failed: hard.p` | 整条语句回滚 |

**CASCADE 是一句话毁掉一批数据的那句话。** 课时跟着课程删合理；流水跟着订单级联删除等于抹掉审计痕迹。规则：只用在「子行离开父行就没有意义」的结构上，其余保持默认。需要「先插子后插父」的导入走 `DEFERRABLE INITIALLY DEFERRED`：本机实测事务内插孤儿行成功、`COMMIT` 时抛 `FOREIGN KEY constraint failed`、`ROLLBACK` 后什么都没留下。最后埋伏笔：`PRAGMA index_list(lesson)`（lesson 上有外键）返回 `[]`——**外键不会自动给子表建索引**，删父行前要扫全表找子行，第 6 章[索引与执行计划](/database/indexes) 量化这一条。

## 其余约束：错误文本与两条反直觉

| 违反 | SQLite 原话 |
| --- | --- |
| `NOT NULL` | `NOT NULL constraint failed: users.name` |
| 写生成列 | `cannot UPDATE generated column "s"` |
| 列级 `CHECK` 漏括号 | `near "off": syntax error` |
| 表里只有生成列 | `must have at least one non-generated column` |
| 生成表达式引用不存在的列 | `no such column: missing_col` |
| 非常量默认值不加括号 | `near "(": syntax error` |

**`UNIQUE` 允许多个 NULL。** `INSERT INTO kv (k, v) VALUES (NULL,'a'),(NULL,'b'),(NULL,'c')`（`k` 上有 `UNIQUE`）三行全部成功；换成重复的非 NULL 值才报 `UNIQUE constraint failed`。因为两个 NULL 比较结果是 NULL、不构成「相等」（三值逻辑见[第 3 章 SQL 查询基础](/database/sql-basics)）。推论：参与复合唯一约束的列都要 `NOT NULL`，否则约束形同虚设。

**派生值交给数据库守，比应用层「三处都记得同步」可靠。** `CREATE TABLE g4 (id INTEGER, s INTEGER GENERATED ALWAYS AS (id * 2) STORED)` 实测插 `id = 7` 得 `{"id":7,"s":14}`，写 `s` 被拒；`AS (id / 0)` 得 `null` 而不报错。`DEFAULT` 记得加括号：`DEFAULT (datetime('now'))` 可以，`DEFAULT datetime('now')` 语法错误。另注意 `INSERT OR REPLACE` 是「删旧行 + 插新行」，没出现在语句里的列一律回落到默认值（实测 `{"id":2,"name":"Bob"}` → `{"id":2,"name":"Bob2","city":null}`）；更新请用 `UPDATE` 或 `INSERT ... ON CONFLICT (...) DO UPDATE`（实测可用）。

## 范式的第一印象：一次改名，三行陈旧数据

范式不用背定义，跑一遍就懂。本机建两套等价数据：规范侧标题只存一份，反范式侧每条报名记录复制一份 `course_title`，然后**只改一处**：

```sql
UPDATE course SET title = 'SQL 查询基础（第二版）' WHERE id = 10;
```

```text
-- 规范侧：JOIN 出来的每一条自动是新标题
[{"student":"Bob","title":"SQL 查询基础（第二版）"}, {"student":"阿栗",...}, {"student":"陈晨",...}]
-- 反范式侧：三行还是旧标题，still_fresh = 0
[{"student":"Bob", "course_title":"SQL 查询基础",     "still_fresh":0},
 {"student":"阿栗", "course_title":"SQL 查询基础",     "still_fresh":0},
 {"student":"陈晨", "course_title":"SQL 查询基础",     "still_fresh":0}]
SELECT COUNT(*) rows_to_patch FROM enroll_denorm WHERE course_id = 10;   -- 3
```

**同一次改名，规范侧写 1 行，反范式侧要写 3 行。** 这就是更新异常（update anomaly）：冗余把一次操作放大成 N 次，漏掉一次数据就开始说谎，而没有任何约束能发现它——每行单独看都自洽。删除异常更狠：反范式表里删掉某人最后一门课的记录，那门课的标题就从库里彻底消失，好像它没开过。

直觉版定义：**1NF** 每个属性是标量，别把 `tags` 存成 `"a,b,c"`（`GROUP_CONCAT` 拼出来的是**输出格式**，不是存储结构）；**2NF / 3NF** 非主属性要完全依赖主键、不能依赖另一个非主属性——复合主键 `(user_id, course_id)` 上再存 `course_title` 就是传递依赖。反范式不是错误，是**用一致性风险换读取性能**的显式交易，做这笔交易要自带纪律：同一个事务写入、有一条能重算的口径、永远不是唯一真相源。第 5 章[数据建模](/database/data-modeling) 正式讲什么时候值得。

## 从需求到 DDL：30 秒直觉

「用户可以报多门课，一门课有多个学员；报名要有成绩；课程分章，章下有课时。」名词给出实体 `users` / `courses` / `enrollments` / `modules` / `lessons`；「多个」→ 多对多 → 中间表；**关系上的属性（成绩、报名时间）属于中间表，不属于任何一端**；「章下有课时」→ 一对多 → `lessons.module_id` 外键。

```sql
CREATE TABLE users (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,                        -- 候选键：唯一，但会变
  CHECK (length(trim(name)) > 0)
);
CREATE TABLE courses (
  id       INTEGER PRIMARY KEY,
  title    TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE enrollments (                           -- 中间表持有关系自身的属性
  user_id   INTEGER NOT NULL REFERENCES users(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  score     INTEGER CHECK (score BETWEEN 0 AND 100),
  PRIMARY KEY (user_id, course_id)
);
```

这段本机真跑通过：`PRAGMA foreign_key_list(enrollments)` 返回两条引用（指向 `courses` 与 `users`），`on_update` / `on_delete` 均为 `NO ACTION`、`match` 为 `NONE`。对照关系模型读它：`id` 是被选中的主键，`email`、`title` 是候选键，复合主键给出逻辑身份，`REFERENCES` 是参照完整性、`CHECK` 是用户定义完整性、`NOT NULL` 补实体完整性。**四类约束在模型里各有一个名字，在 SQLite 里各有一个坑。**

## 常见错误与排查

**1. 报表人数和名单对不上。** 现象：`COUNT(*)` 是 5，明细 4 行。原因：外键执法未开，子表有指向不存在父行的记录。确认：`PRAGMA foreign_keys` 读当前连接的值；`PRAGMA foreign_key_check` 给出 `{"table":...,"rowid":...,"parent":...,"fkid":...}`。修法：按 `rowid` 清掉孤儿行，再把 pragma 写进建连接的唯一入口。

**2. 换台机器、换个连接，同一条 SQL 就报 `FOREIGN KEY constraint failed`。** 原因：开关是每连接的，历史脏行只在「碰到」相关行时才检查。确认：在同一段代码里立刻把 pragma 读回来，别信「配置文件写过」。修法：连接工厂统一设置 + 启动期断言（下一章给实现）。

**3. 删用户报 `FOREIGN KEY constraint failed`，但没说哪张表。** 原因：这条消息确实不含表名。确认：`SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%references users%'`，再对候选表 `PRAGMA foreign_key_list(<表>)` 反查。修法：明确每类子数据的去留（该级联的加 `ON DELETE CASCADE`，该留痕的改软删除），别为了消除报错随手加 CASCADE。

**4. 表里有两行完全一样的记录，程序行为诡异。** 现象：一次 `UPDATE` 改了两行。原因：建表没主键，逻辑上没有元组身份（本章 `raw` 表实测）。确认：`PRAGMA table_info` 的 `pk` 全是 0；`SELECT <全部列>, COUNT(*) FROM t GROUP BY 1,2 HAVING COUNT(*) > 1`。修法：补代理键，或给业务唯一码加 `UNIQUE` + `NOT NULL`，存量重复先合并再加约束。

**5. 改了名，列表页是新标题、详情页是旧标题。** 原因：标题多处冗余，一次 `UPDATE` 只覆盖一处。确认：用本章的 `still_fresh` 体检（`列 <> (SELECT title FROM ...)`），或全文搜建表语句里多余的 `title` 列。修法：删冗余统一走 JOIN；确实要冗余就同事务写入 + 一条能重算的口径。

## 练习

<Exercise title="练习 1 · 亲手造一个外键空洞并收拾掉它" difficulty="基础">

写出每一步的结果（成功 / 报错文本 / 返回的 JSON），并回答：打开开关之后，A 步那条孤儿记录会消失吗？

```js
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE enrollments (user_id INTEGER NOT NULL REFERENCES users(id),
                          course_id INTEGER NOT NULL, PRIMARY KEY (user_id, course_id));
INSERT INTO users VALUES (1, '阿栗');`);
db.exec('INSERT INTO enrollments VALUES (42, 10)');                       // A
console.log(db.prepare('PRAGMA foreign_key_check').all());                // B
db.exec('PRAGMA foreign_keys = ON');
console.log(db.prepare('SELECT COUNT(*) n FROM enrollments').get());      // C
db.exec('INSERT INTO enrollments VALUES (43, 10)');                       // D
db.exec('DELETE FROM users WHERE id = 1');                                // E
db.exec('INSERT INTO enrollments VALUES (1, 20)');                        // F
```

<template #answer>

| 步 | 本机实测 |
| --- | --- |
| A | 不报错。执法关闭时 `REFERENCES` 只是声明 |
| B | `[{"table":"enrollments","rowid":1,"parent":"users","fkid":0}]`，`fkid` 是 `foreign_key_list` 里的序号 |
| C | `{"n":1}`——空洞行还在，`COUNT(*)` 与 JOIN 从此不一致 |
| D | `THROWS: FOREIGN KEY constraint failed`，pragma 翻上去立刻生效 |
| E | **成功**。此刻已无子行引用 `id = 1`（表里只有 42 这个不存在的外键值） |
| F | `THROWS: FOREIGN KEY constraint failed`——父行刚在 E 步被删 |

**不会消失。** 实测过两次：pragma 从 OFF 翻到 ON 只影响此后每条语句的检查，历史脏行不受追溯，`foreign_key_check` 会一直列出它。E 步还说明一件事：外键只保证「有子行时不能删父行」，**不保证**「删了父行后旧子行的含义仍成立」——E 之后那行指向一个已不存在的用户，因为它是开关打开前塞进来的。

</template>

</Exercise>

<Exercise title="练习 2 · 故意写坏约束并解释报错" difficulty="进阶">

逐条给出 SQLite 的原始报错文本，并区分「建表时就报错」与「写入时才报错」：

```sql
CREATE TABLE t1 (a INTEGER, a TEXT);
CREATE TABLE t2 (off INTEGER, CHECK off >= 0);
CREATE TABLE t4 (id TEXT PRIMARY KEY);
INSERT INTO t4 VALUES (NULL);
CREATE TABLE t5 (c INTEGER REFERENCES t6(name));   -- t6.name 没有任何唯一约束
INSERT INTO t5 VALUES ('anything');
CREATE TABLE t7 (id INTEGER, s INTEGER GENERATED ALWAYS AS (missing_col * 2) STORED);
```

<template #answer>

| 语句 | 实测结果 | 时机 |
| --- | --- | --- |
| `t1` 两列同名 | `duplicate column name: a` | 建表时 |
| `CHECK off >= 0` 不带括号 | `near "off": syntax error`；列级要写 `off INTEGER CHECK (off >= 0)` | 建表时 |
| `t4` 插 NULL 主键 | **不报错**——`TEXT PRIMARY KEY` 在 rowid 表上不自动带 `NOT NULL` | 不报错，数据已经烂了 |
| `t5` 引用非唯一列 | 建表**成功**，写入才报 `foreign key mismatch - "t5" referencing "t6"` | 写入时 |
| `t7` 引用不存在的列 | `no such column: missing_col` | 建表时 |

规律：**SQLite 的约束校验时机不一致。** 语法、同名列、生成列表达式在 CREATE 阶段查；外键目标是否合法、复合外键列序、主键可空性要等写入才暴露，其中 `TEXT PRIMARY KEY` 那条根本不暴露。所以「CREATE 全部成功」不等于建表正确——**必须灌一批数据、故意违反几处约束、看该拦的有没有被拦住**。这正是第 8 章[迁移与版本管理](/database/migrations) 要把建表脚本变成可重放、可验证的东西的原因。

</template>

</Exercise>

<Exercise title="练习 3 · 判断冗余该不该留" difficulty="挑战">

三处冗余各自要不要保留？给出依据和一个能验证的决定。

- A：订单明细表存 `unit_price`（下单那一刻的商品单价）。
- B：订单明细表存 `product_title`（商品标题的副本）。
- C：课程表存 `enrollment_count`（报名人数，每次报名 +1）。

<template #answer>

| 处 | 结论 | 依据 |
| --- | --- | --- |
| A | **必须留**，它不是冗余而是历史事实 | 商品价会改，「当时多少钱」不随商品表变化；语义上与 `product.price` 是两回事，所以要独立命名 |
| B | **不该留**，它就是本章实测的更新异常本体 | 标题改了要同步 N 行，且没有约束能发现不一致。列表页要显示标题就 JOIN；JOIN 顶不住的量级该上缓存层，而不是把陈旧副本写进主库 |
| C | **可留，但要有唯一写入口 + 能重算的口径** | 派生值，真相永远是 `COUNT(*)`。要么同事务自增，要么用视图 / 生成列；留了就要能对账 `SELECT id, enrollment_count, (SELECT COUNT(*) ...) AS real FROM ...` |

判断标准只有一句：**这一格是「事实」还是「另一个事实的推论」？** 事实的快照（A）留；可重算的推论（C）留了必须带对账；对别的行的重复（B）不留——它既不是事实也不是推论，只是漂移的隐患。

</template>

</Exercise>

## 官方文档与延伸阅读

- [SQLite 外键文档](https://www.sqlite.org/foreignkeys.html) —— 核实「引用完整性默认关闭、每连接 `PRAGMA foreign_keys` 打开」、`ON DELETE` / `ON UPDATE` 动作语义、`DEFERRABLE`。对应本章外键一节。
- [SQLite `PRAGMA` 语句](https://www.sqlite.org/pragma.html) —— 核实 `foreign_key_check`、`foreign_key_list`、`index_list`、`table_info` 的返回列与默认值。
- [SQLite `CREATE TABLE` 文档](https://www.sqlite.org/lang_createtable.html) —— 核实主键不自动带 `NOT NULL`、`WITHOUT ROWID`、生成列、`CHECK` 禁止子查询。
- [SQLite 数据类型与亲和性](https://www.sqlite.org/datatype3.html) —— 核实「声明类型只是亲和性建议」，逐列实测在下一章。
- [Node.js `node:sqlite` API](https://nodejs.org/api/sqlite.html) —— 应核实构造选项与实验状态；**本次取回失败（`fetch failed`），`enableForeignKeyConstraints` 默认为真只有本机实测支撑**（默认连接返回 1、显式传 `false` 返回 0），换 Node 版本必须重跑。
- [PostgreSQL `SELECT` 文档](https://www.postgresql.org/docs/current/sql-select.html) —— **已核实（2026-10-18）**：`GROUP BY` 存在时 select 列表只能出现分组列、聚合、或**函数依赖于分组列**的列（分组列含主键时）；`ORDER BY` 默认 `ASC → NULLS LAST`、`DESC → NULLS FIRST`，与本章 SQLite 实测方向相反。
- [MySQL 文档入口](https://dev.mysql.com/doc/) —— 需核实 `ONLY_FULL_GROUP_BY` 默认值、`AUTO_INCREMENT` 复用策略、默认排序规则的大小写敏感性。**本章未取回、未在本机验证**。

## 下一章

这一章讲的是「数据应该长什么样、谁替你把住门」：关系是集合不是数组，主键给元组身份，`REFERENCES` 与 `CHECK` 是可以执行的约束——而 SQLite 的执法开关默认关着（`node:sqlite` 替你开了），这是本章最重要的实测。下一章 [SQLite 入门](/database/sqlite-first) 把这扇门推开：零配置建一个文件库、用 `node:sqlite` 读写、把动态类型与亲和性逐列跑成对照表，并给出一个把所有 pragma 收在唯一入口的连接工厂函数。
