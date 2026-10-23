# SQL 查询基础：`<>` 会漏掉 NULL，`COUNT(*)` 与 `COUNT(col)` 是两个数

运营要「北京以外的用户」，你写 `WHERE city <> '北京'`，返回 2 人；她追问「另外两个没填城市的人呢」——被三值逻辑吃掉了，而且**不报错**。第二条投诉来自看板：「学习记录 8 条」和「有成绩 6 人」并排显示，没人意识到 `COUNT(*)` 与 `COUNT(score)` 量的不是同一件事。第三条：`LEFT JOIN` 之后写的 `WHERE e.score IS NULL` 会让你「没选课的人」莫名少两个。

本章四张表是全书练习用的数据集，故意留下 NULL（`city`、`score`、`minutes`、`price`）和一对多关系：

```sql
CREATE TABLE learners (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, joined_at TEXT NOT NULL);
CREATE TABLE courses (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, level TEXT NOT NULL, price INTEGER);
CREATE TABLE enrollments (
  learner_id INTEGER NOT NULL, course_id INTEGER NOT NULL, score INTEGER, minutes INTEGER,
  PRIMARY KEY (learner_id, course_id));
CREATE TABLE logs (
  learner_id INTEGER NOT NULL, course_id INTEGER NOT NULL, seq INTEGER NOT NULL, seconds INTEGER NOT NULL,
  PRIMARY KEY (learner_id, course_id, seq));
INSERT INTO learners VALUES
 (1,'阿栗','北京','2026-03-01'),(2,'Bob',NULL,'2026-03-04'),(3,'陈晨','上海','2026-02-11'),
 (4,'dora','Guangzhou','2026-05-20'),(5,'Eve','北京','2026-06-02'),(6,'小富',NULL,'2026-07-19');
INSERT INTO courses VALUES
 (10,'SQL 查询基础','入门',0),(11,'索引与执行计划','进阶',199),
 (12,'事务与并发','进阶',299),(13,'窗口函数速成','高级',NULL);
INSERT INTO enrollments VALUES
 (1,10,88,120),(1,11,NULL,200),(2,10,60,NULL),(3,10,95,80),
 (3,11,72,150),(4,12,40,60),(5,10,NULL,30),(2,12,55,90);
INSERT INTO logs VALUES
 (1,10,1,600),(1,10,2,400),(1,11,1,900),(3,10,1,300),(3,10,2,300),(3,10,3,300),(2,12,1,50);
```

`enrollments` 8 行里 2 行 `score` 为 NULL，`learners` 6 行里 2 行 `city` 为 NULL，`小富`（id 6）一条选课都没有——这三个细节撑起本章所有陷阱。

<Callout type="verified" title="本章每条输出都在本机跑过">

Windows 10 x64 + Node v25.4.0，`node:sqlite` 的 `DatabaseSync`（`:memory:`），底层 `SELECT sqlite_version()` 实测返回 `{"v":"3.51.1"}`，日期 2026-10-18。先执行上面那份建表脚本，再逐条运行正文每个查询，代码块里的 JSON 是 `db.prepare(sql).all()` 的本机输出（个别长行只省略列名，值与行序未改动；注释是我加的解释）。加载模块时 stderr 打印 `ExperimentalWarning: SQLite is an experimental feature and might change at any time`。涉及 PostgreSQL / MySQL 的对比**全部未在本机验证**，正文逐条标明。

</Callout>

## 三值逻辑：`<>` 少了一半，`NOT IN` 一个都不剩

同一份数据，六种写法：

| 条件写法 | 本机返回 | 结论 |
| --- | --- | --- |
| `WHERE city <> '北京'` | `[{n:2}]` | 只有上海、Guangzhou |
| `WHERE city <> '北京' OR city IS NULL` | `[{n:4}]` | 运营真正要的数 |
| `WHERE NOT (city = '北京')` | `[{n:2}]` | `NOT` 救不了 NULL |
| `WHERE city IS '北京'` | 阿栗、Eve | `IS` 是 NULL 安全的等值 |
| `WHERE city IN ('北京', NULL)` | 阿栗、Eve | `IN` 里的 NULL 无害 |
| `WHERE city NOT IN ('北京', NULL)` | `[{n:0}]` | **整批消失** |

比较运算遇到 NULL 的返回值：`SELECT (1 = NULL) eq, (1 <> NULL) ne, (1 > NULL) gt, NULL = NULL eqnn` → `[{eq:null,ne:null,gt:null,eqnn:null}]`。`WHERE` 只保留 TRUE 的行，UNKNOWN 与 FALSE 一起丢掉；`NULL` 是「未知」，与它比较永远 UNKNOWN，所以两行没城市的既不成立也不失败。「考虑 NULL 的不等」本机可用：`SELECT 1 IS DISTINCT FROM NULL AS a, 1 IS DISTINCT FROM 1 AS b` → `[{a:1,b:0}]`。

`NOT IN` 最狠：`city NOT IN ('北京', NULL)` 展开成 `NOT (city = '北京' OR city = NULL)`，北京两行 FALSE、其余四行 UNKNOWN，**没有一行 TRUE**。三种等价改写实测都给出 4：`OR city IS NULL`、`COALESCE(city,'') <> '北京'`、`NOT EXISTS`。子查询版同理：`id NOT IN (SELECT learner_id FROM enrollments)` 给出 `[{n:1}]` 只因该列 `NOT NULL`；列可空时结果就是 0，得写 `WHERE learner_id IS NOT NULL`（实测同样 1）或 `NOT EXISTS`。

NULL 顺着表达式传染，各函数还不一致：

```text
SELECT name || '(' || city || ')' AS label FROM learners ORDER BY id LIMIT 3
  [{"label":"阿栗(北京)"},{"label":null},{"label":"陈晨(上海)"}]   -- Bob 那行整列变 NULL
SELECT concat('a', NULL, 'b') AS c                                 [{"c":"ab"}]  -- concat() 跳过 NULL
SELECT 'x' LIKE NULL AS a, NULL LIKE '%' AS b                      [{"a":null,"b":null}]
SELECT EXISTS (SELECT 1 WHERE 0) AS e, NOT EXISTS (SELECT 1 WHERE 0) AS n  [{"e":0,"n":1}]
```

`CASE` 的简单形态用等值比较，**永远匹配不上 NULL**：`SELECT learner_id, CASE score WHEN NULL THEN 'null never matches' WHEN 88 THEN 'eighty eight' ELSE 'other' END c FROM enrollments WHERE learner_id IN (1,5)` → `[{"learner_id":1,"c":"eighty eight"},{"learner_id":1,"c":"other"},{"learner_id":5,"c":"other"}]`，两个 NULL 都落进 `ELSE`；判 NULL 只能用搜索形态 `CASE WHEN score IS NULL THEN ...`。补 NULL：`COALESCE(city,'未知')` / `IFNULL(city,'未知')` 给替换值，`NULLIF(city,'北京')` 把北京变 NULL、其余原样。

## `COUNT(*)`、`COUNT(col)`、`COUNT(DISTINCT col)` 是三个不同的数

```text
SELECT COUNT(*) star, COUNT(score) sc, COUNT(DISTINCT learner_id) dl, COUNT(1) one, COUNT(42) literal
  FROM enrollments                     [{"star":8,"sc":6,"dl":5,"one":8,"literal":8}]
SELECT COUNT(DISTINCT city) dc, COUNT(city) cc FROM learners       [{"dc":3,"cc":4}]
```

`COUNT(*)` 数行，`COUNT(表达式)` 数**非 NULL** 值，所以 8 行里 6 个成绩。`COUNT(42)` 也是 8（常量对每行都非 NULL）——`COUNT(1)` 不是性能开关，它们同一个数。

聚合函数普遍忽略 NULL，于是「平均值」有两种分母：

```text
SELECT SUM(minutes) sm, AVG(minutes) av, COUNT(minutes) cm, COUNT(*) call, SUM(minutes)*1.0/COUNT(*) manual
  FROM enrollments
  [{"sm":730,"av":104.28571428571429,"cm":7,"call":8,"manual":91.25}]
```

`AVG` 除以 7（有分钟数的行），手写 `SUM/COUNT(*)` 得 91.25——**「人均学习时长」差 13 分钟就是这么来的**。`price` 那条 NULL 同理：`SELECT SUM(price) s, AVG(price) a, COUNT(price) c, MIN(price) mn, MAX(price) mx FROM courses` → `[{s:498,a:166,c:3,mn:0,mx:299}]`，`AVG` 是 498/3。空集上聚合不统一：

```text
SELECT SUM(score) s, AVG(score) a, MIN(score) mn, MAX(score) mx, COUNT(score) c FROM enrollments WHERE 0
  [{"s":null,"a":null,"mn":null,"mx":null,"c":0}]
SELECT COUNT(*) n, MAX(score) mx FROM enrollments WHERE learner_id = 99      [{"n":0,"mx":null}]
SELECT course_id, COUNT(*) n FROM (SELECT 1 AS course_id WHERE 0) GROUP BY course_id   (0 rows)
```

无 `GROUP BY` 时聚合**总返回一行**（全 NULL 或 0），有 `GROUP BY` 时没分组就没行。金额类求和写 `COALESCE(SUM(score),0)`（实测 `[{s:0}]`），否则前端拿到 `null`。

## `GROUP BY` 之后，select 里那个「裸列」是哪一行的值

SQLite 允许 select 列出现既没聚合也没分组的列：

```text
SELECT learner_id, course_id, minutes FROM enrollments GROUP BY learner_id
  [{"learner_id":1,"course_id":10,"minutes":120},{"learner_id":2,"course_id":10,"minutes":null},
   {"learner_id":3,"course_id":10,"minutes":80},{"learner_id":4,"course_id":12,"minutes":60},
   {"learner_id":5,"course_id":10,"minutes":30}]
```

每个 learner 只出一行，但 `course_id`/`minutes` 是**组里某一行的值**：再跑一次本机结果完全相同（每组第一行），这不代表有保证语义。`MIN(minutes)` 更诡异，裸列**跟着最小值那一行**走（实测 learner 2 给 `mn:90, course_id:12`）。所以**凡没进 `GROUP BY` 的列都必须有明确聚合**，换库会报错或给另一个值（PG / MySQL 更严格，**未在本机验证**）。

分组键很宽：别名 `GROUP BY length(name) AS len`、序号 `GROUP BY 1`、原表达式三种都能跑；NULL 自成一组（`SELECT city, COUNT(*) n FROM learners GROUP BY city` → `[{city:null,n:2},{city:"北京",n:2},...]`），`HAVING city IS NULL` 单独捞出它（1 行）。时机差别一条报错说清：

```text
SELECT course_id, COUNT(*) n FROM enrollments WHERE COUNT(*) > 2 GROUP BY course_id
  ERROR: misuse of aggregate: COUNT()
```

`WHERE` 在分组**之前**逐行过滤，看不见聚合；`HAVING` 在之后过滤组（实测 `>= 2` 给 3 组、`> 2` 只剩 `[{course_id:10,n:4}]`；不配 `GROUP BY` 也能用，`HAVING COUNT(*) > 5` → `[{n:8}]`）。`GROUP_CONCAT` 拼组内值，顺序是插入顺序不是排序顺序（实测 `"10,11"`、`"10,12"`）；`GROUP_CONCAT(score,'|')` 遇全 NULL 的组返回 `null` 而非空串。

## JOIN：`ON` 与 `WHERE` 写错位置，LEFT JOIN 就退化成 INNER JOIN

外连接三种在 SQLite 都支持（`LEFT` / `RIGHT` / `FULL OUTER`，实测都正常返回）。差别在过滤条件放哪：

```text
SELECT l.name, e.course_id FROM learners l LEFT JOIN enrollments e ON e.learner_id = l.id
  WHERE e.score IS NULL ORDER BY l.name
  [{"name":"阿栗","course_id":11},{"name":"Eve","course_id":10},{"name":"小富","course_id":null}]
-- 同一条件挪进 ON：... ON e.learner_id = l.id AND e.score IS NULL   → 6 行
  [{"阿栗",11},{"Bob",null},{"陈晨",null},{"dora",null},{"Eve",10},{"小富",null}]
```

第一条只有 3 行：`WHERE` 在**补 NULL 之后**才过滤，Bob 的两门课都有分数、不满足条件，Bob 整个消失——**你以为在查外连接，实际执行的是内连接 + 条件**。两个 `COUNT` 并排就能看穿：

```text
SELECT l.name, COUNT(*) rows_, COUNT(e.course_id) enrolled FROM learners l
  LEFT JOIN enrollments e ON e.learner_id = l.id GROUP BY l.id, l.name ORDER BY l.id
  [...,{"name":"小富","rows_":1,"enrolled":0}]
```

`COUNT(*)` 把补出来的那行算 1，`COUNT(e.course_id)` 才是 0，报表里两列同时写就不骗人。反连接两种写法都只给 `[{name:"小富"}]`：`LEFT JOIN ... WHERE e.course_id IS NULL`，和 `WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.learner_id = l.id)`。

`CROSS JOIN` 是笛卡尔积：6 × 4 → `[{n:24}]`。`NATURAL JOIN` 按同名列自动连，而本机 `enrollments`（`course_id`）与 `courses`（`id`）**没有同名列**，于是退化成笛卡尔积：`SELECT COUNT(*) n FROM enrollments NATURAL JOIN courses` → **32**，显式 `ON c.id = e.course_id` → **8**；写成 `USING (id)` 则当场报错 `cannot join using column id - column not present in both tables`。**`NATURAL JOIN` 生产环境一律禁用**——一条 `RENAME COLUMN` 就能悄悄改变结果集。

两个一对多同时 JOIN 会放大数值，这是最贵的一类 bug：

```text
SELECT l.id, COUNT(e.course_id) en, COUNT(s.seq) lg, SUM(e.minutes) mins
  FROM learners l LEFT JOIN enrollments e ON e.learner_id = l.id
                  LEFT JOIN logs s ON s.learner_id = l.id
  WHERE l.id IN (1,3) GROUP BY l.id
  [{"id":1,"en":6,"lg":6,"mins":960},{"id":3,"en":6,"lg":6,"mins":690}]
```

阿栗真值 320（120+200）成了 **960**（每条选课被 3 条日志复制），陈晨 230 成了 690。把明细先聚合成一行再连，实测 `mins` 回到真值 `[{"id":1,"mins":320,"sec":3800},{"id":3,"mins":230,"sec":1800}]`——**但 `sec` 又错了**（阿栗日志总和 1900 被 2 条选课放大成 3800）。规矩：**每个被连接的关系都必须是一行一键**，否则分两次查询、在应用层合并。按 `(learner_id, course_id)` 双键连明细则正确（实测阿栗 1000 与 900）。三表链路 `courses LEFT JOIN enrollments LEFT JOIN learners` 计数给出 `[{SQL 查询基础,4},{索引与执行计划,2},{事务与并发,2},{窗口函数速成,0}]`，0 那行正是「没人选也要出现在报表里」的价值。另一个读取陷阱：`SELECT a.name, b.name FROM learners a JOIN learners b ...` 两列同名时 `all()` 的对象里后一列**覆盖**前一列（本机同城配对只读出 `{"name":"Eve"}`）——那是你没写别名。

## 子查询与集合运算的边界

相关子查询放进 select 列可代替一次 JOIN（实测各人选课数 `2,2,2,1,1,0`）；`WHERE id IN (SELECT learner_id FROM enrollments WHERE score > 80)` → 阿栗、陈晨；`WHERE EXISTS (... AND e.score IS NULL)` → 阿栗、Eve。派生表 **SQLite 不强要别名**：`SELECT * FROM (SELECT 1 AS x)` → `[{x:1}]`（PG 要求，**未在本机验证**）。标量子查询返回多行时 SQLite 不报错：`SELECT (SELECT learner_id FROM enrollments) AS s` → `[{s:1}]`，静默取第一行；PG 会报错（**未验证报错文本**），跨库前补 `LIMIT 1`（实测同样 `[{s:1}]`）。子查询空结果时标量是 NULL：`SELECT (SELECT score FROM enrollments WHERE learner_id = 99) AS s` → `[{s:null}]`，配 `COALESCE(...,-1)` 才拿到 `-1`。

```text
SELECT city FROM learners WHERE city IS NOT NULL UNION SELECT '上海' ORDER BY city
  [{"city":"Guangzhou"},{"city":"上海"},{"city":"北京"}]                 -- 去重
```

`UNION ALL` 保留重复（实测多出的 `'上海'` 原样出现两次）。交集与差集各一行：`course_id = 10` 的学员 `INTERSECT` `course_id = 12` 的学员 → `[{"learner_id":2}]`（Bob 两门都选）；`SELECT id FROM learners EXCEPT SELECT learner_id FROM enrollments` → `[{"id":6}]`（小富）。列数不等是最快的失败：`SELECT city FROM learners UNION SELECT city, id FROM learners` → `ERROR: SELECTs to the left and right of UNION do not have the same number of result columns`。`UNION` 之后 `ORDER BY` 只能用**左分支**的列名/别名（`SELECT name AS a ... UNION SELECT name ... ORDER BY a` 实测可用）。`SELECT DISTINCT city FROM learners ORDER BY name` 在 SQLite 里能跑（本机 4 行），PG 会拒绝——**未在本机验证**。

## LIKE、GLOB、大小写：三套规则，别混用

```text
SELECT name FROM learners WHERE name LIKE 'b_b'              [{"name":"Bob"}]   -- ASCII 折叠
SELECT name FROM learners WHERE name GLOB 'b_b'              (0 rows)           -- GLOB 区分大小写
SELECT name FROM learners WHERE name COLLATE NOCASE = 'bob'   [{"name":"Bob"}]
SELECT 'é' LIKE 'É' AS accented, 'e' LIKE 'E' AS ascii         [{"accented":0,"ascii":1}]
```

`LIKE` 默认只对 ASCII 折叠大小写，**带音标的字母不折叠**，中文本来无大小写；`=` 则完全区分（实测 `name = 'alice'` → `[{n:0}]`）。要连 `LIKE` 也改成区分：`PRAGMA case_sensitive_like = 1`（连接级），实测开启后 `LIKE 'D%'` → 0 行、`LIKE 'd%'` → dora，复位后 `LIKE 'B%'` 仍是 Bob。裸读 `prepare('PRAGMA case_sensitive_like').get()` 返回 `undefined`（没有结果行），别拿它当判据。通配符转义：

```text
SELECT t FROM (SELECT 'a_b' AS t UNION SELECT 'axb') WHERE t LIKE 'a\_b' ESCAPE '\'   [{"t":"a_b"}]
SELECT t FROM (SELECT 'a_b' AS t UNION SELECT 'axb') WHERE t LIKE 'a\_b'              (0 rows)
```

没有 `ESCAPE` 时反斜杠是普通字符，谁也匹配不上。方括号在 `LIKE` 里不是通配符（`LIKE 'a[bc]c'` → 0 行），在 `GLOB` 里才是（→ abc）；`GLOB` 还区分大小写、用 `*`/`?` 而非 `%`/`_`。排序按字节：`ORDER BY name` → Bob、Eve、dora、小富、阿栗、陈晨，`COLLATE NOCASE` → Bob、dora、Eve、小富、阿栗、陈晨。

## 排序、分页与数字的隐形规则

`ORDER BY city ASC` 时 NULL 排最前（实测 Bob、小富开头）。默认是 **ASC 时 NULLS FIRST、DESC 时 NULLS LAST**，`NULLS LAST` / `NULLS FIRST` 本机可用；序号 `ORDER BY 2 DESC` 与别名 `ORDER BY len` 都能用。分页的坑在「不写 ORDER BY」，连翻两页实测：

```text
-- 不带 ORDER BY：第 1 页 3 行 / 第 2 页 3 行
[{"learner_id":1,"score":88},{"learner_id":1,"score":null},{"learner_id":2,"score":60}]
[{"learner_id":3,"score":95},{"learner_id":3,"score":72},{"learner_id":4,"score":40}]
-- 换成 ORDER BY learner_id, course_id 后，第 2 页变成
[{"learner_id":2,"course_id":12,"score":55},{"learner_id":3,"course_id":10,"score":95},
 {"learner_id":3,"course_id":11,"score":72}]
```

`(2,55)` 在第一种分页里**不在前两页**（落到第 3 页），加 `ORDER BY` 才回到第 2 页。没有 `ORDER BY` 时行序由查询计划决定，建索引、`VACUUM`、换版本都可能重排，`OFFSET` 因此漏行或重复。翻页定死：先 `ORDER BY` 唯一键组合，再键集分页——`WHERE (learner_id, course_id) > (3, 10) ORDER BY learner_id, course_id LIMIT 2` 实测返回 `(3,11)`、`(4,12)`，行值比较语法可用（`SELECT (1,2) = (1,2) AS a, (1,2) > (1,1) AS b` → `[{a:1,b:1}]`）。

数字与文本（全部实测）：`'9' > '10'` → 1 而 `9 > 10` → 0（文本列按字符比，见上一章亲和性）；`7/2` → 3、`7.0/2` → 3.5、`1/0` → **NULL**（`typeof(1/0)` = `null`，不报错）；`length('中文')` → 2 而 `length(CAST('中文' AS BLOB))` → 6；ISO 日期文本可直接比较排序（`'2026-03-04' > '2026-03-01'` → 1，`julianday` 相减 → 93）；标识符撞保留字加双引号：`SELECT "order" FROM (SELECT 1 AS "order")` → `[{order:1}]`。

## 常见错误与排查

**1. 列表少了「没填字段」的那批人。** `<>` / `NOT IN` / `NOT LIKE` 遇 NULL（实测 2 对 4；`NOT IN (..., NULL)` → 0）。先单跑 `SELECT COUNT(*) FROM t WHERE col IS NULL`，非 0 就有行在被静默丢弃。修法：`OR col IS NULL`、`IS NOT` / `IS DISTINCT FROM`，或 `NOT IN` 子查询里先滤掉 NULL。

**2. 报表两个数对不上。** `COUNT(*)` 与 `COUNT(col)` 混用（实测 8 对 6）。修法：同一条 SQL 并排写两者，命名区分 `total_rows` / `graded_rows`，算百分比把分母写进注释。

**3. LEFT JOIN 之后行数不对。** 右表条件写在 `WHERE`（实测 3 行 vs 挪进 `ON` 的 6 行）。排查：把 `WHERE` 里右表列暂时去掉看行数。修法：右表条件下沉 `ON`，查「没有匹配」用 `IS NULL` 反连接或 `NOT EXISTS`。

**4. 求和突然变成两三倍。** 多个一对多同时 JOIN 放大行（实测 320 → 960）。排查：`COUNT(*)` 与 `COUNT(DISTINCT 主键)` 并排跑。修法：每个被连接的关系先聚合成一行一键。

**5. 模糊搜索漏字符或多命中。** `%`/`_` 没转义、大小写只折叠 ASCII、`GLOB` 规则不同。排查：`SELECT 'a_b' LIKE 'a\_b'` 这类一行断言。修法：关键字里的 `%` `_` `\` 一律 `ESCAPE`，并配合[索引](/database/indexes) 的前缀匹配写法。

**6. 翻页翻出重复行。** `LIMIT/OFFSET` 前没有确定排序键（实测第 2 页内容随写法改变）。修法：`ORDER BY` 唯一键 + 键集分页，`OFFSET` 只用于后台小表浏览。

## 练习

<Exercise title="练习 1 · 预测六个 WHERE" difficulty="基础">

用本章那四张表，先写下每条的预测（行数或 JSON），再逐条跑一遍对答案。

```sql
SELECT COUNT(*) n FROM learners WHERE city <> '上海';
SELECT COUNT(*) n FROM learners WHERE city NOT LIKE '上海';
SELECT COUNT(*) n FROM courses WHERE price > 100;
SELECT COUNT(*) n FROM courses WHERE price NOT BETWEEN 100 AND 200;
SELECT COUNT(*) n FROM enrollments WHERE minutes < 100;
SELECT name FROM learners WHERE name LIKE '%栗' OR name IS NULL;
```

<template #answer>

`[{n:3}]`、`[{n:3}]`、`[{n:2}]`、`[{n:2}]`、`[{n:4}]`、`[{"name":"阿栗"}]`（六个数本机都跑过）。易错三处：`city <> '上海'` 只算 3（两行 NULL 被丢，别写 6）；`city NOT LIKE '上海'` 同样是 3，**`LIKE` / `NOT LIKE` 也服从三值逻辑**（实测 `'x' LIKE NULL` 返回 NULL）；`price NOT BETWEEN 100 AND 200` 给 2，`price IS NULL` 的高级课被丢掉。所以「不是上海的人」要写 `WHERE city <> '上海' OR city IS NULL`（实测 5）；`COALESCE(price,0) NOT BETWEEN 100 AND 200` 才捞得回高级课（实测 3 行）。最后一条的 `OR` 只作用于 `name IS NULL`，而该列是 `NOT NULL`，分支永远不成立。

</template>

</Exercise>

<Exercise title="练习 2 · 把 LEFT JOIN 的三行改成六行" difficulty="进阶">

下面查询本机结果是 3 行（阿栗 11、Eve 10、小富 null），但产品要「每个学员都出现，并标出他还没出成绩的那门课」。给出改写后的 SQL 与实际行数，并说明原写法为什么不对。

```sql
SELECT l.name, e.course_id FROM learners l
  LEFT JOIN enrollments e ON e.learner_id = l.id
 WHERE e.score IS NULL
 ORDER BY l.name;
```

<template #answer>

条件挪进 `ON`，实测 6 行：

```sql
SELECT l.name, e.course_id, e.score FROM learners l
  LEFT JOIN enrollments e ON e.learner_id = l.id AND e.score IS NULL
 ORDER BY l.id;
-- [{阿栗,11,null},{Bob,null,null},{陈晨,null,null},{dora,null,null},{Eve,10,null},{小富,null,null}]
```

原写法里 `WHERE` 在补齐 NULL **之后**执行：Bob 的两门课都有分（60、55），不满足条件就整行消失，外连接退化成内连接。挪进 `ON` 后条件只决定「右表哪些行可匹配」，匹配不上时左表仍保留并补 NULL。既要未出成绩的课又要选课总数时，用三个计数并排：实测 Bob 是 `rows_:2, enrolled:2, pending:0`，小富是 `rows_:1, enrolled:0, pending:1`。判据一句话：**右表条件属于 `ON`，左表条件属于 `WHERE`。**

</template>

</Exercise>

<Exercise title="练习 3 · 故意写坏四条 SQL 并解释" difficulty="挑战">

这四条都在本机跑过。前两条给出 SQLite 原话，后两条**不报错但结果错**——分别说明错在哪。

```sql
SELECT course_id, COUNT(*) n FROM enrollments WHERE COUNT(*) > 2 GROUP BY course_id;
SELECT learner_id, course_id, score FROM enrollments JOIN learners USING (id);
SELECT t FROM (SELECT 'a_b' AS t UNION SELECT 'axb') WHERE t LIKE 'a\_b';
SELECT l.id, SUM(e.minutes) FROM learners l
  LEFT JOIN enrollments e ON e.learner_id = l.id
  LEFT JOIN logs s ON s.learner_id = l.id GROUP BY l.id;
```

<template #answer>

1. `ERROR: misuse of aggregate: COUNT()`。`WHERE` 在分组之前逐行执行，那里没有聚合函数。改成 `... GROUP BY course_id HAVING COUNT(*) > 2`（实测只剩 `[{course_id:10,n:4}]`；`>= 2` 给 3 组）。
2. `ERROR: cannot join using column id - column not present in both tables`。`USING` 要求两表**列名相同**：`enrollments` 只有 `learner_id`，`learners` 只有 `id`。正确写法 `JOIN learners l ON l.id = e.learner_id`；`USING (learner_id, course_id)` 这种两边同名的才可用（实测能返回明细）。
3. 不报错，返回 0 行。没有 `ESCAPE '\'`，反斜杠是普通字符，`a_b` 与 `axb` 都不含字面反斜杠；写 `LIKE 'a\_b' ESCAPE '\'` 实测给 `[{"t":"a_b"}]`。拿 `'SQL 100% 掌握'` 与 `'SQL 完全掌握'` 测过：`t LIKE '%100\%%' ESCAPE '\'` 命中 1 行，去掉 `ESCAPE` 后「搜 100%」变成「搜含 100 的一切」。
4. 不报错，但 `SUM(e.minutes)` 被日志表放大（实测阿栗 960、真值 320）。明细先聚合成一行再连，`mins` 回到 320 / 230，可同一查询的 `sec` 变成 3800 / 1800（真值 1900 与 900，被 2 条选课各放大一次）——**每个被连接的关系都必须是一行一键**，否则分两次查询、在应用层合并。

</template>

</Exercise>

## 官方文档与延伸阅读

- [SQLite `SELECT` 语法](https://www.sqlite.org/lang_select.html) —— 子句顺序、三种外连接、`NATURAL JOIN` 与 `USING` 定义、`compound SELECT` 取左分支列名。
- [SQLite 表达式与 `WHERE` 子句](https://www.sqlite.org/lang_expr.html) —— `IS`、`IS DISTINCT FROM`、`LIKE ... ESCAPE`、`IN` 与 NULL 的三值语义（本章每个 `[{n:...}]` 都可对照）。
- [SQLite 聚合函数](https://www.sqlite.org/lang_aggfunc.html) —— `COUNT(*)` 与 `COUNT(X)` 的差别、`AVG`/`SUM`/`MIN`/`MAX` 忽略 NULL、`GROUP_CONCAT` 默认分隔符。
- [SQLite `PRAGMA`](https://www.sqlite.org/pragma.html) 与 [日期时间函数](https://www.sqlite.org/lang_datefunc.html) —— `case_sensitive_like` 的作用域；ISO 文本比较、`julianday`、`strftime` 的边界。
- [PostgreSQL `SELECT` 参考](https://www.postgresql.org/docs/current/sql-select.html) —— **未在本机验证**：需核实 PG 对裸非聚合列直接报错、`FROM` 子查询必须带别名、标量子查询多行报错、`DISTINCT` 的 `ORDER BY` 列必须在输出列里。
- [MySQL `SELECT` 参考](https://dev.mysql.com/doc/refman/8.0/en/select.html) —— **未在本机验证，本次也未取回该页**：`ONLY_FULL_GROUP_BY` 默认开关与 `LIMIT ... OFFSET` 差异请自行核对。
- 站内衔接：[SQLite 入门](/database/sqlite-first)（类型与绑定）、[SQL 进阶](/database/sql-advanced)（窗口函数、CTE）、[索引与执行计划](/database/indexes)、[事务与并发](/database/transactions)、[PostgreSQL 特性](/database/postgres-features)。

## 下一章

三值逻辑、`COUNT(*)` 与 `COUNT(col)` 的 8/6、`AVG` 的两种分母、GROUP BY 裸列、`ON` 与 `WHERE` 的位置差（3 行 vs 6 行）、双一对多 JOIN 的 320 → 960 放大、`LIKE` 转义与 ASCII-only 折叠、键集分页——这些是查询的地板。下一章 [SQL 进阶](/database/sql-advanced) 加三样：`WITH` 递归 CTE 把「先聚合再连接」变成可读的一层、窗口函数在**不塌行**的前提下给排名与累计（正好绕开本章的放大陷阱）、以及 upsert 与批量写入的真实写法。
