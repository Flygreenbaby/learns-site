# 窗口函数与 CTE 的真实边界：默认帧、并列值与那个不报错的 WHERE

两份报表对不上账：华北那天两笔 2000 的单子，一份里累计列显示同一个数，另一份里是分开累加的。两边都没写错，差别只在一个人写了 `SUM(amount) OVER (ORDER BY amount)`，另一个人多写了 `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`。第三类事故最安静：`WHERE id NOT IN (SELECT cust_id FROM orders)` 返回 0 行，页面一片空白、没有任何报错，因为子查询里有一个 `NULL`，三值逻辑把每行都判成「不确定」。这些不是「SQL 熟练度」问题，是**能实测、能背下来、能在 review 里拦住**的知识。

<Callout type="verified" title="本章结论全部在本机 SQL 上跑过">

Windows + Node v25.4.0 内置 `node:sqlite`，`SELECT sqlite_version()` 返回 **3.51.1**，日期 2026-10-18。数据：9 行 `sales`、10 行 `emp`、6 行 `m`、10 万行 `logs2` / `big2` / `t10k`。每个 `THROWS:` 原文、每个数字、每份计划都是实际输出；PostgreSQL / MySQL 对照本机没有服务，**一条都没执行过**，单独标注。

</Callout>

## 先确认版本，再谈「SQLite 支不支持」

窗口函数 3.25（2018）进入 SQLite，递归 CTE 3.8.3 起，`GROUPS` 帧与 `EXCLUDE` 3.28 起。版本靠 `SELECT sqlite_version();` 实读，**下面每条都是本机跑出来的**：

- 全支持：六种排名/分布函数；`LAG(col,offset,default)` 三参数；`FIRST_VALUE`/`LAST_VALUE`/`NTH_VALUE`；`ROWS`、`RANGE`（带偏移量）、`GROUPS` **三种帧**；`EXCLUDE CURRENT ROW`/`TIES`/`GROUP`/`NO OTHERS` **四种**（同一列分别给 800 / 4 / `null` / 8）；`WINDOW w AS (...)` 命名窗口；`FILTER`，包括嵌在 `OVER` 里的 `SUM(v) FILTER (WHERE v>3) OVER (PARTITION BY g)`。
- CTE 侧：`WITH`、多 CTE 链式引用、`VALUES` 行内表、`MATERIALIZED` / `NOT MATERIALIZED` 提示都能跑（两种写法各返回 3 行，但本机没有任何输出能证明它真的物化，本章不宣称其效果）。
- **省略 `RECURSIVE` 的自引用 CTE 照样跑成功**：`WITH r(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM r WHERE x<3)` → `1,2,3`。
- 不支持：`QUALIFY`、`SELECT DISTINCT ON (...)`、CTE 里写 `INSERT`/`UPDATE`/`DELETE`，报错依次是 `near "ROW_NUMBER": syntax error`、`near "ON": syntax error`、`near "INSERT": syntax error`。递归深度上限则**没有**（见下文递归一节）。

## 排名三兄弟只在并列值上有差别

`sales` 里华北有 7、8 两笔 2000。`PARTITION BY region ORDER BY amount DESC` 下实测这三行：`ROW_NUMBER` 是 1/2/3、`RANK` 是 1/1/3、`DENSE_RANK` 是 1/1/2；华东（1500/1200/900，无并列）三个函数都是 1/2/3。**`ROW_NUMBER` 永远连续（它替你打破并列，但破的是不稳定顺序）；`RANK` 跳号；`DENSE_RANK` 不跳号。** 写「前 2 名」用 `RANK` 会返回 3 行，用 `ROW_NUMBER` 会随机丢掉一笔并列的单子——**`ORDER BY` 里必须补唯一列（`amount DESC, id`）才谈得上可复现**。

## 默认帧是 RANGE 而不是 ROWS

华南三行 800、800、1000，同一条 SQL 里四种帧的真实输出：

```text
SELECT id, amount,
  SUM(amount) OVER (PARTITION BY region ORDER BY amount)                    c1, -- 默认帧
  SUM(amount) OVER (PARTITION BY region ORDER BY amount
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)       c2,
  SUM(amount) OVER (PARTITION BY region ORDER BY amount
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 FOLLOWING)       c3,
  SUM(amount) OVER (PARTITION BY region ORDER BY amount
                    RANGE BETWEEN 200 PRECEDING AND CURRENT ROW)            c4
FROM sales WHERE region='华南' ORDER BY amount, id;

  id=4  800   c1=1600 c2= 800 c3=1600 c4=1600
  id=5  800   c1=1600 c2=1600 c3=2600 c4=1600
  id=6 1000   c1=2600 c2=2600 c3=2600 c4=1800
```

默认帧（c1）把两笔 800 当成一个对等组，**两行都给 1600**，等价于 `RANGE UNBOUNDED PRECEDING`；c2 才是逐行累加；c4 说明 `RANGE` 的偏移量按 `ORDER BY` 的**值**加减，1000 那行把两笔 800 都框进来所以是 1800。**只要 `ORDER BY` 的键可能重复（日期、金额、时间戳都可能），累计与移动平均就必须显式写 `ROWS`。** 这个 bug 不报错、不变慢，只让两个部门的报表数字不同。

## LAG 的 NULL 会传染整个表达式

一份能直接抄的「环比 + 累计 + 当期占比」模板，实测输出：

```text
SELECT ym, region, amt,
  LAG(amt) OVER (PARTITION BY region ORDER BY ym) prev_m,
  ROUND(100.0*(amt - LAG(amt) OVER (PARTITION BY region ORDER BY ym))
        / NULLIF(LAG(amt) OVER (PARTITION BY region ORDER BY ym),0), 1) mom_pct,
  SUM(amt) OVER (PARTITION BY region ORDER BY ym ROWS UNBOUNDED PRECEDING) ytd,
  ROUND(100.0*amt / SUM(amt) OVER (PARTITION BY ym), 1) share
FROM m ORDER BY region, ym;

  2026-01 华东 100  prev=null  mom_pct=null  ytd=100  share=55.6
  2026-02 华东 150  prev=100   mom_pct=50.0  ytd=250  share=65.2
  2026-03 华北 200  prev=80    mom_pct=150.0 ytd=360  share=62.5
```

首行 `mom_pct` 是 `null`，因为 `NULL` 参与算术永远是 `NULL`。两个修法：`LAG(amt,1,0)` 给默认值（实测首行返回 0，但「上月 0」会引出除零，必须配 `NULLIF`），或应用层渲染成 `—`。`share` 用 `PARTITION BY ym` 且不带 `ORDER BY`，帧就是整月，这是当期占比的标准写法。

## WHERE 里写窗口函数：SQLite 报得不一致

```text
SELECT id FROM sales WHERE ROW_NUMBER() OVER (ORDER BY amount) = 1;
  THROWS: misuse of window function ROW_NUMBER()
SELECT region FROM sales GROUP BY region HAVING COUNT(*) OVER () > 1;
  THROWS: misuse of window function COUNT()
SELECT ROW_NUMBER() OVER (ORDER BY id) rn FROM s GROUP BY rn;
  THROWS: misuse of aliased window function rn
```

但这一条**不报错**，返回全部 9 行：`SELECT id FROM sales WHERE SUM(amount) OVER () > 0;`。SQLite 对「`WHERE` 里出现窗口函数」的拦截只覆盖一部分形状。**别把它当可用写法**：它的求值时机和你直觉里的任何一种都不是一回事，PostgreSQL / MySQL 都拒绝窗口函数出现在 `WHERE`（见文末对照，未在本机验证），移植必炸。正确姿势是 CTE 里算窗口、外层过滤：

```text
WITH ranked AS (SELECT id, region, rep, amount,
    ROW_NUMBER() OVER (PARTITION BY region ORDER BY amount DESC, id) rn FROM sales)
SELECT region, rep, amount FROM ranked WHERE rn <= 2 ORDER BY region, rn;
  -- 6 行：华东 1500/1200、华北 2000/2000、华南 1000/800
```

`GROUP BY` 之后在聚合上开窗是合法的，注意双重 `SUM`：`SUM(SUM(amount)) OVER ()` 每行都是 10500。

## CTE：给报表分层，别再套五层括号

```text
WITH region_sum AS (SELECT region, SUM(amount) s FROM sales GROUP BY region)
SELECT region, s, ROUND(100.0*s/(SELECT SUM(s) FROM region_sum),1) pct
FROM region_sum ORDER BY s DESC;      -- 华北 4300 41% / 华东 3600 34.3% / 华南 2600 24.8%
```

配置类小表用 `WITH rates(day, rate) AS (VALUES ...)` 行内表就够，实测加权 900→990。后面的 CTE 看得到前面的，反过来不行（`WITH a AS (SELECT * FROM b), b AS (SELECT 1 x)` 报 `no such table: b`）。两条边界：CTE 里只能是 `SELECT`，别照抄 PostgreSQL 的「用 CTE 删数据再统计」；**CTE 名可以遮蔽真实表**——`WITH sales AS (SELECT 999 id) SELECT id FROM sales` 得到 999。

## 递归 CTE：形状三种，风险一个

层级展开（`emp` 10 行，种子必须是根节点）：

```text
WITH RECURSIVE t(id,name,lvl,path) AS (
  SELECT id, name, 0, name FROM emp WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.name, t.lvl+1, t.path || ' > ' || e.name
  FROM emp e JOIN t ON e.manager_id = t.id)
SELECT printf('%s%s (lvl=%d)', substr(' ',1,lvl*2), name, lvl) FROM t ORDER BY path;
  -- CEO(0) → 市场总监/销售总监(1) → 投放/设计/组长(2) → 外包/售前/客服(3)
```

另外两种形状：算子树人数用「祖先 × 后代」对——种子 `SELECT id, id FROM emp`，递归步 `SELECT a.root, e.id FROM anc a JOIN emp e ON e.manager_id=a.id`，实测 `COUNT(*)-1` 得 CEO 9 人、销售总监 4、华东组长 3；造序列/日历用 `date(d,'+1 day')`（实测 2026-02-01…02-05）或 `LIMIT` 停（`... FROM r LIMIT 3` → `1,2,3`）。**`date(d, '+' || x || ' day')` 是陷阱**：实测拿到 01-31、02-02、02-05、02-09，每步按本行的 `x` 补天数。

四条实测细节：递归列类型由**种子第一行**决定，`CAST(NULL AS TEXT)` 要写在种子里；递归步放前面报 `THROWS: circular reference: r`；递归里 `UNION` 也接受，但它会去重，值重复的树**静默少行**；**SQLite 没有递归深度上限**（MySQL 的 `cte_max_recursion_depth` 文档默认 1000）。判环写法是把已访问 id 拼进 path 再 `instr`：

```text
WITH RECURSIVE t(id,lvl,path) AS (
  SELECT id, 0, ','||id||',' FROM emp WHERE name='外包'
  UNION ALL
  SELECT e.manager_id, t.lvl+1, t.path||e.manager_id||',' FROM emp e JOIN t ON e.id=t.id
  WHERE e.manager_id IS NOT NULL AND instr(t.path, ','||e.manager_id||',')=0 AND t.lvl<20)
SELECT * FROM t ORDER BY lvl;      -- 7 行，一路走到 CEO
```

同一张表人为造二元环（让两个节点互指）之后，全树递归只返回 2 行——**环里的分支被静默丢弃，既不报错也不死循环**。

## EXISTS、IN 与 NOT IN：三值逻辑吞掉一整页

`cust` 5 行、`orders` 里 3 个非空 `cust_id`（1/2/3）加 2 个 `NULL`，同一个需求五种写法（实测行数）：

```text
WHERE id IN (SELECT cust_id FROM orders)                       -- 3 行
WHERE id NOT IN (SELECT cust_id FROM orders)                   -- 0 行  ← 空白页
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.cust_id=c.id) -- 2 行：4、5  ← 正确
... LEFT JOIN orders o ON o.cust_id=c.id WHERE o.id IS NULL GROUP BY c.id   -- 2 行 ← 正确
WHERE id NOT IN (SELECT cust_id FROM orders WHERE cust_id IS NOT NULL)      -- 2 行 ← 也能修
```

三值逻辑当表达式就能验：`SELECT (3 NOT IN (1,2,NULL)), (1 NOT IN (1,2,NULL)), (NULL NOT IN (1,2));` → `null`、`0`、`null`。**子查询列可空时，`NOT IN` 一律换成 `NOT EXISTS`。** 计划对照（10 万行对 5 千行，被关联列无索引）：

```text
EXISTS 版： SCAN b → BLOOM FILTER ON l (v=?) → SEARCH l EXISTS USING AUTOMATIC PARTIAL COVERING INDEX (v=?)
IN    版： SCAN b → LIST SUBQUERY 1 → SCAN logs → CREATE BLOOM FILTER
```

`AUTOMATIC PARTIAL COVERING INDEX` 是现场建的临时索引，只在相关子查询这种形状出现。EXISTS 版三次耗时 43.7 / 41.6 / 40.0 ms——**别读成「EXISTS 比 IN 快」**，那只是没索引时的量级，高低要按你自己的数据与计划判断。

## UNION ALL、Top-N、去重：三组数字

`UNION` 的输出列名只认第一个分支；列数不等报 `THROWS: SELECTs to the left and right of UNION do not have the same number of result columns`；`ORDER BY v`（分支内的原始列名）在本机**没报错**，别依赖，写输出别名。去重成本能量化：`logs2` 10 万行、两半各 5 万、`v` 只有 2.5 万个不同值且两半完全重叠——`UNION` 出 50000 行、`UNION ALL` 出 100000 行，`UNION` 的计划多一行 `USE TEMP B-TREE FOR DISTINCT`，各 20 次取中位 **462.2 / 1128.2 ms**，而人为让两半不相交时 `UNION` 只要 **464.6 ms**。**代价不是「行数变少」，是一次全量临时 B-树去重。**（第一轮采样两半各只命中 3 行，计时 8.1 / 7.8 / 8.2 ms 毫无差异——那次对照无效，写性能结论前先确认采样命中了差异。）

分组 Top-N（1 万行、20 个分组、各取前 3，**两种写法都返回 60 行**）：窗口版 **15.6 ms**（`CO-ROUTINE` + `SCAN` + `USE TEMP B-TREE FOR ORDER BY`），相关子查询自计数版 **355.8 ms**（`SCAN a` + `CORRELATED SCALAR SUBQUERY` + `SCAN b`），补 `(tenant,amt)` 索引仍要 236.7 ms。**窗口不是「永远比 JOIN 快」**：它省的是「每个分组重算一次」，分组基数大又已有覆盖索引时 JOIN 能反超（10 万行时 179.8 vs 40.1 ms），三种写法的行集差集实测 `diff_rows=0`。

去重保留一行的正确顺序是**先算出要删的 id 再删**。`leads` 8 行（`a@x.com` 三条 01-01/01-02/01-03、`c@x.com` 两条、`d@x.com` 两条同一时刻）：

```text
SELECT DISTINCT a.id FROM leads a JOIN leads b ON a.email=b.email
  AND (a.created_at < b.created_at OR (a.created_at=b.created_at AND a.id < b.id));  -- 5 行：1,2,5,7,8
DELETE FROM leads WHERE id IN (上面这句);   -- changes=5，剩 3,4,6,8
```

忘了 `DISTINCT` 时删除结果仍正确，但用它估「影响行数」会虚高、和 `changes` 对不上；`ORDER BY` 不带唯一列时「保留最新」在时间并列的行上是随机的。

## PostgreSQL / MySQL 对照（未在本机验证）

<Callout type="unverified" title="这一节的语法结论来自官方文档，本机没有服务，一条都没执行过">

摘自 postgresql.org（current）与 dev.mysql.com（8.0）手册，抓取日期 2026-10-18，只用于「移植时知道往哪查」。

</Callout>

| 主题 | SQLite 3.51.1（实测） | PostgreSQL（文档，未执行） | MySQL 8.0（文档，未执行） |
| --- | --- | --- | --- |
| CTE 里写 DML | `near "INSERT": syntax error` | 允许：子查询可为 “`SELECT`, `TABLE`, `VALUES`, `INSERT`, `UPDATE`, `DELETE`, or `MERGE` statement” | 不允许：CTE 是 “a named temporary result set” |
| `RECURSIVE` / 递归深度 | 可省略且照样跑；无上限 | 需要 `RECURSIVE`；无该变量 | “The `RECURSIVE` keyword must be included…”，漏写典型报 `ERROR 1146`；“`cte_max_recursion_depth` has a value of 1000” |
| 窗口函数允许的位置 | 不一致（`WHERE ROW_NUMBER()` 报错，`WHERE SUM() OVER ()` 放行） | `WINDOW` 服务于 “window functions appearing in the query's `SELECT` list or `ORDER BY` clause” | “permitted only in the select list and `ORDER BY` clause”，开窗在 `WHERE`/`GROUP BY`/`HAVING` 之后 |
| 每组保留一行 / `MATERIALIZED` | 窗口 + CTE 过滤；语法接受、效果未知 | 有 `DISTINCT ON (expr)` 与 `MATERIALIZED` | 两者均未见 |

## 常见错误与排查

1. **累计列在并列值那天不动了 / 两个部门数字不一样。** 原因：默认帧是 `RANGE UNBOUNDED PRECEDING`，同日行属同一对等组。确认：并排跑 `ROWS` 版看两列是否分叉（实测 1600/1600 vs 800/1600）。修：累计与移动平均显式写 `ROWS`，`ORDER BY` 末尾补唯一列。同理 `LAST_VALUE` 恒等于当前行，要组内最大值用 `MAX(x) OVER (PARTITION BY ...)`。
2. **报表首行环比空白，导出 CSV 变 `NaN`；或「未下单客户」页一片空白。** 两者都是 `NULL`：前者是 `LAG` 首行返回 `NULL` 传染整个表达式，用 `LAG(x,1,0)` + `NULLIF(...,0)` 或应用层显示 `—`；后者是子查询含 `NULL` 使 `NOT IN` 每行判成「不确定」，先用 `SELECT COUNT(*) FROM (子查询) WHERE col IS NULL` 确认，再换 `NOT EXISTS` / `LEFT JOIN ... IS NULL` / 补 `IS NOT NULL`。
3. **接口挂死或内存涨爆，是递归 CTE。** 原因：数据有环或递归步没停止条件，而 SQLite 没有深度护栏。确认：临时加 `WHERE lvl < 3` 看行数是否被截断（实测 `MAX(lvl)=3`、10 行）；再造一个互指对，看全树递归是否静默少返回（实测 4 行变 2 行）。修：判环和硬深度上限**两个都写**。

## 练习

<Exercise title="默认帧与 ROWS 帧的分叉点" difficulty="基础">

华南三行为 `(4,800)`、`(5,800)`、`(6,1000)`。不运行，先写出四个表达式的结果再验证：省略帧的 `SUM(amount) OVER (PARTITION BY region ORDER BY amount)`、`ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`、`ROWS BETWEEN UNBOUNDED PRECEDING AND 1 FOLLOWING`、`RANGE BETWEEN 200 PRECEDING AND CURRENT ROW`。

<template #answer>

1600/1600/2600、800/1600/2600、1600/2600/2600、1600/1600/1800（本机实测）。要点：默认帧把并列的 800 当一个组，两行都是 1600；`ROWS` 才逐行累加；`1 FOLLOWING` 让帧往后多吞一行；`RANGE ... 200 PRECEDING` 按 `ORDER BY` 的**值**取窗口，1000 那行框进两笔 800，所以是 1800。

</template>

</Exercise>

<Exercise title="故意让递归 CTE 出问题，再救回来" difficulty="挑战">

建 `node(id INTEGER PRIMARY KEY, parent_id INTEGER)`，插 `(1,NULL)`、`(2,1)`、`(3,2)`、`(4,3)`，再执行 `UPDATE node SET parent_id = 4 WHERE id = 1;` 造出 1→2→3→4→1 的环。写一个不带深度限制、种子为 `parent_id IS NULL` 的全树递归 CTE：它返回几行？加 `WHERE lvl < 20` 再跑呢？真正的死循环风险在哪、怎么验证？

<template #answer>

两种写法都是 **0 行**：环造出来之后已经没有根节点，递归连种子都拿不到。这是最容易误判之处——「很快返回」不代表递归安全，只代表它没开始。真正的死循环是不带停止条件的自增长序列，本机实测 `WITH RECURSIVE d(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM d)` 始终不返回、不报错，只能手动终止。可用做法是换种子（从 `id=1` 沿 `parent_id` 上溯）+ path 判环 + 硬深度上限。

</template>

</Exercise>

<Exercise title="把一条 QUALIFY 报表改成 SQLite 能跑的版本" difficulty="进阶">

1. 写出 `SELECT id, rep, amount FROM sales QUALIFY ROW_NUMBER() OVER (PARTITION BY rep ORDER BY amount DESC) = 1;` 的报错原文。
2. 改成本机可运行的 CTE 版本，并说明为什么 `ORDER BY` 里要补 `id`。
3. 再写一个不用窗口函数的自计数版本，用计划说明形状差别。

<template #answer>

第 1 步：`THROWS: near "ROW_NUMBER": syntax error`（实测）。第 2 步：

```text
WITH r AS (SELECT id, rep, amount,
    ROW_NUMBER() OVER (PARTITION BY rep ORDER BY amount DESC, id) rn FROM sales)
SELECT id, rep, amount FROM r WHERE rn = 1;
```

补 `id` 是因为并列金额下不带唯一键的 `ROW_NUMBER` 选出的行不确定（`sales` 里华北两笔 2000 就是这种情形）。第 3 步：`SELECT a.id FROM sales a WHERE (SELECT COUNT(*) FROM sales b WHERE b.rep=a.rep AND (b.amount>a.amount OR (b.amount=a.amount AND b.id<a.id))) = 0;`。计划差别：窗口版 `CO-ROUTINE` + `SCAN` + `USE TEMP B-TREE FOR ORDER BY`，自计数版 `SCAN a` + `CORRELATED SCALAR SUBQUERY` + `SCAN b`；1 万行同样 60 行结果实测 15.6 ms vs 355.8 ms。

</template>

</Exercise>

## 官方文档与延伸阅读

- [SQLite 窗口函数](https://www.sqlite.org/windowfunctions.html) —— 「默认帧是 `RANGE UNBOUNDED PRECEDING`」「`GROUPS` 帧与 `EXCLUDE` 四种写法」「可用窗口函数清单」。
- [SQLite `WITH` 子句与递归 CTE](https://www.sqlite.org/lang_with.html) —— 「递归列类型取种子行」「`MATERIALIZED` 的官方说法」「CTE 里允许哪些语句」。
- [SQLite `SELECT` 语法](https://www.sqlite.org/lang_select.html) —— `FILTER`、`WINDOW` 命名窗口、`VALUES` 行内表。
- [SQLite 文档索引](https://www.sqlite.org/docs.html) —— 在其中找 `EXPLAIN QUERY PLAN` 一页，核对 `CO-ROUTINE`、`LIST SUBQUERY`、`AUTOMATIC PARTIAL COVERING INDEX`、`USE TEMP B-TREE FOR DISTINCT`（索引细节见[第 6 章 索引与执行计划](/database/indexes)）。
- [PostgreSQL `SELECT`](https://www.postgresql.org/docs/current/sql-select.html) —— 对照表里 CTE 可含 DML、`MATERIALIZED`、`DISTINCT ON` 的说法来源，**未在本机执行**。
- [MySQL 8.0 `WITH`](https://dev.mysql.com/doc/refman/8.0/en/with.html) 与 [窗口函数用法](https://dev.mysql.com/doc/refman/8.0/en/window-functions-usage.html) —— `RECURSIVE` 必须写、`cte_max_recursion_depth` 默认 1000，**未在本机执行**。

## 下一章

[第 3 章 SQL 查询基础](/database/sql-basics) 的 `GROUP BY` 与 `JOIN` 到这里第一次显出短板——排名、累计、同比这类「组内还要看彼此」的需求，用基础 SQL 只能退化成慢二十倍的自计数子查询。查询能跑对之后，下一个问题是**表本身该怎么设计**：外键拦不拦得住你、软删除在哪里漏、什么时候该故意违反范式。[第 5 章 数据建模](/database/data-modeling) 用同样的方式逐条建出来跑一遍。
