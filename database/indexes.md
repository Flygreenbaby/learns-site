# 索引与执行计划：10 万行上 `SCAN` 与 `SEARCH` 的真实差距

「列表页第 500 页要 12 秒」的报障，十次里六次是同一句 `LIMIT 20 OFFSET 9980`；「加了索引没变快」的报障，八成是 `WHERE` 里对索引列套了函数、用了 `LIKE '%kw%'`，或者把 `OR` 接在一个没索引的列上。这两种失败都不报错，只在用户身上体现为等待。

为了不靠记忆讲这件事，我在本机建了一张 **100000 行**的商品表：`prod(id INTEGER PRIMARY KEY, name TEXT, sku TEXT, cat TEXT, status TEXT, price REAL, tenant INT, dept INT, deleted_at TEXT)`。`name`、`sku` 各 10 万个不同值；`cat` 6 个值（每值约 1.6 万行）、`status` 3 个值（`on` 96000、`off` 2000、`draft` 2000）、`tenant` 20 个值（各 5000 行）。下面所有数字都出自这张表。

<Callout type="verified" title="本章所有计划与耗时都在本机 10 万行表上实测">

Windows + Node v25.4.0 内置 `node:sqlite`，`SELECT sqlite_version()` 返回 **3.51.1**，日期 2026-10-18。数据由递归 CTE 灌入，页数取自 `PRAGMA page_count` / `dbstat`。每份计划是 `EXPLAIN QUERY PLAN` 原样输出（`[id] detail`）。耗时是同一进程内重复执行取中位数，单位毫秒；**内存库、单连接、无并发**，换到磁盘库或多进程绝对值会变，相对关系才是本章结论。文末点名我自己测废的两组数字。

</Callout>

## 先认动词：`SCAN` 与 `SEARCH` 是分水岭

同一句 `SELECT id, price FROM prod WHERE name = '商品1234-1234'`，加索引前后：

```text
未建索引：  [2] SCAN prod
建好之后：  [3] SEARCH prod USING INDEX idx_name (name=?)   -- CREATE INDEX 本身耗时 41.5 ms
```

| 计划里的词 | 含义 |
| --- | --- |
| `SCAN tbl` | 全表（或全索引）逐行判断 |
| `SEARCH tbl USING INDEX i (col=?)` | 走索引定位；**括号里是它真正用到的条件**，没写进去的条件等于没帮你筛 |
| `USING COVERING INDEX` | 需要的列全在索引里，不回表 |
| `USING INTEGER PRIMARY KEY (rowid=?)` | 按 rowid 直接定位，最快的一条路径 |
| `USE TEMP B-TREE FOR ORDER BY / GROUP BY / DISTINCT` | 索引救不了排序与去重，现场建临时 B-树 |
| `CORRELATED SCALAR SUBQUERY` / `LIST SUBQUERY` / `CO-ROUTINE` / `BLOOM FILTER` / `AUTOMATIC PARTIAL COVERING INDEX` | 相关子查询 / `IN` 的取值列表 / 窗口协程 / SQLite 现场建的临时结构，见[第 4 章](/database/sql-advanced) |

括号那段最容易读漏：`SEARCH ... USING INDEX idx_td (tenant=?)` 说明 `price` 条件根本没参与定位，只是取回行之后被过滤。点查差距（同一句各跑 2000 次）：无索引中位 **11316.3 ms**（单次约 5.7 ms），有 `idx_name` 中位 **3.9 ms**（单次约 0.002 ms），**约 2900 倍**——这还是内存库，磁盘上要再乘 I/O。

## B-Tree 索引里到底存了什么

`PRAGMA index_xinfo('idx_wide_oid')` 把索引列结构摊开：`{"seqno":0,"name":"oid"}`、`{"seqno":1,"name":null}`——第二列的 `null` 就是 rowid。三条推论都能量到：索引**有序**（`>`、`BETWEEN`、`ORDER BY` 能借它省排序）；叶子只带 `(键列…, rowid)`（要别的列必须回表）；`INTEGER PRIMARY KEY` 表本身按 rowid 组织，所以主键点查有专属计划词。

10 万行表 `m` 上 `idx_m_a(a)`、`idx_m_ab(a,b)` 的实测：

```text
SELECT id FROM m ORDER BY a LIMIT 5;                    -- 无索引：SCAN m + USE TEMP B-TREE FOR ORDER BY
SELECT id FROM m ORDER BY a LIMIT 5;                    -- 有索引：SCAN m USING COVERING INDEX idx_m_a（无 TEMP B-TREE）
SELECT id FROM m ORDER BY a DESC LIMIT 5;               -- 同一索引反向扫，仍然没有 TEMP B-TREE
SELECT a, COUNT(*) FROM m GROUP BY a;                   -- SCAN m USING COVERING INDEX idx_m_a（松散索引扫描）
SELECT b, a, COUNT(*) FROM m GROUP BY b, a;             -- 有 (a,b)：SCAN USING COVERING INDEX idx_m_ab
```

最后一条别读成「`GROUP BY` 顺序随便写」：索引用上了，但**输出顺序不保证按 `b, a`**，要顺序就写 `ORDER BY`。`prod` 上另一例更直白：`SELECT id FROM prod ORDER BY price LIMIT 5` 在建 `idx_price` 之前是 `SCAN prod USING COVERING INDEX idx_td` + `USE TEMP B-TREE FOR ORDER BY`——**`LIMIT 5` 也要先把 10 万行排完**；建完之后变成 `SCAN prod USING COVERING INDEX idx_price`，临时排序消失。

## 索引失效清单：每条都有计划原文

`prod` 上 `idx_name`、`idx_sku`、`idx_td(tenant,dept,price)` 都已存在：

```text
WHERE substr(name,1,2) = '商品'    [2] SCAN prod USING COVERING INDEX idx_name   ← 列上套函数
WHERE price * 2 > 100             [2] SCAN prod                                  ← 列上做算术
WHERE +sku = 'SKU000123'          [2] SCAN prod USING COVERING INDEX idx_sku     ← + 是优化屏障
WHERE name COLLATE NOCASE = 'X'   [2] SCAN prod USING COVERING INDEX idx_name    ← 排序规则不一致
WHERE name = 'x' OR cat = 'food'  [2] SCAN prod                                  ← OR 里有没索引的列
WHERE cat <> 'food'               [2] SCAN prod                                  ← 否定型条件筛不掉几行
WHERE cat IS NOT NULL             [3] SCAN prod
```

`SCAN ... USING COVERING INDEX` 最容易被误读成「走了索引」：**它仍然扫了全部条目**，只是扫索引而不是扫表（省了回表）。真省下扫描的是 `SEARCH`。表达式索引是「列上套函数」的正解：建 `idx_len ON prod(length(name))` 之后 `WHERE length(name) = 8` 从 `SCAN` 变成 `SEARCH prod USING COVERING INDEX idx_len (<expr>=?)`。

`LIKE` 单独一节，因为它最反直觉（`idx_sku` 已存在）：

```text
（默认设置）WHERE sku LIKE 'SKU0001%'   [2] SCAN prod          ← 前缀匹配没走索引
           WHERE sku LIKE '%0001%'     [2] SCAN prod          ← 中缀
           WHERE sku >= 'SKU0001' AND sku < 'SKU0002'
                                       [3] SEARCH prod USING INDEX idx_sku (sku>? AND sku<?)
PRAGMA case_sensitive_like = ON 之后
           WHERE sku LIKE 'SKU0001%'  [2] SEARCH prod USING COVERING INDEX idx_sku (sku>? AND sku<?)
           WHERE sku GLOB 'SKU0001*'  [2] SEARCH prod USING COVERING INDEX idx_sku (sku>? AND sku<?)
```

一句 SQL 就能证明原因：默认设置下 `WHERE sku LIKE 'sku0001%'` 命中 **100 行**，而库里全是大写 `SKU…`——SQLite 的 `LIKE` 默认大小写不敏感，于是 `'SKU%'` 无法安全转成 `[min,max)` 区间，优化器只能放弃。`GLOB` 天生区分大小写，所以前缀模式能转成范围。**「`LIKE '%x%'` 用不了索引」是对的，「前缀 `LIKE` 一定用得了索引」在这台机器上是错的。**

还有一个不算失效但更危险的：隐式类型转换。

```text
WHERE sku = 123        [2] SEARCH prod USING COVERING INDEX idx_sku (sku=?)   ← 索引照用
SELECT sku FROM prod WHERE sku = 123;                    → 0 行
SELECT sku, typeof(sku) FROM prod WHERE sku > 122 LIMIT 3; → SKU000001(text)、SKU000002(text)…
```

BINARY 排序规则先按类型分组：`INTEGER` 永远排在 `TEXT` 前面。所以 `sku = 123` 用索引精确定位到一个**空区间**，返回 0 行、不报错。**索引失效看得见（`SCAN`），类型写错看不见（空结果）**——排查空结果页先查谓词两侧的类型。

## 复合索引：只有最左前缀能用

`idx_td(tenant, dept, price)` 六种谓词组合的实测计划：

| 谓词 | 计划里出现的条件 | 读法 |
| --- | --- | --- |
| `tenant=7` | `SEARCH ... (tenant=?)` | 用第 1 列 |
| `tenant=7 AND dept=21` | `SEARCH ... (tenant=? AND dept=?)` | 用前 2 列 |
| `tenant=7 AND dept=21 AND price>100` | `SEARCH ... (tenant=? AND dept=? AND price>?)` | 三列全用；范围列必须在最后 |
| `tenant=7 AND price=100` | `SEARCH ... (tenant=?)` | **中间列缺席 → `price` 白写** |
| `dept=21` | `SCAN ... USING COVERING INDEX idx_td` | 跳过头列，只能全索引扫 |
| `tenant>5 AND dept=21` | `SEARCH ... (tenant>?)` | 第 1 列是范围，第 2 列用不上 |

`WHERE price=100 AND dept=21 AND tenant=7`（书写顺序反过来）实测得到 `SEARCH ... (tenant=? AND dept=? AND price=?)`——**索引看定义顺序，不看 SQL 里的书写顺序**。`ORDER BY` 也吃前缀：`WHERE tenant=7 ORDER BY price` 是 `SEARCH ... (tenant=?)` + `USE TEMP B-TREE FOR ORDER BY`；补上 `dept=21` 之后临时排序消失，`DESC` 也不需要反向着引。耗时对照（各 200 次取中位）：走 `idx_td` 的 `tenant=7 AND dept=21` 是 **1.8 ms**，无可用索引的 `dept=21` 是 **1248.1 ms**。

## 覆盖索引：少一次回表就是少一次随机访问

```text
SELECT tenant, dept, price FROM prod WHERE tenant=7 AND dept=21  → USING COVERING INDEX idx_td
SELECT tenant, dept, price, name FROM prod WHERE ...             → USING INDEX idx_td（name 不在索引里，回表）
SELECT id, price FROM prod WHERE ...                             → USING COVERING INDEX（rowid 就在叶子里）
SELECT * FROM prod WHERE ...                                     → USING INDEX
```

**`SELECT id` 也算覆盖**，这是「接口只返回 id 列表时别写 `SELECT *`」的量化依据。命中行数一多，回表就是主成本——用 `cat`（1.6 万行/值）实测：

```text
WHERE cat='food' 取全部 1.6 万行：走 idx_cat 407.9 ms   vs  +cat 强制不走索引 657.9 ms   （只有 1.6 倍）
WHERE cat='food' + LIMIT 20：    走 idx_cat   5.3 ms   vs  强制不走索引       319.6 ms   （60 倍）
```

**索引的收益和「你到底要多少行」强相关**：取全量时索引只快 1.6 倍（还要付回表），只取 20 行时快 60 倍。报表类全量聚合别指望索引，游标分页才吃得到它。

## 低基数列：单独建索引基本没用，组合起来才有

```text
WHERE status='off'（实测占 2%）   [2] SEARCH ... COVERING INDEX idx_status (status=?)
WHERE status='on' （实测占 96%）  [2] SEARCH ... COVERING INDEX idx_status (status=?)   ← 一样走索引
```

`WHERE status='off' AND name='x'` 只有 `idx_status` 时是 `SEARCH ... idx_status (status=?)`（拿 2000 行再逐行比 `name`）；补 `idx_status_name(status,name)` 之后变成 `SEARCH ... COVERING INDEX idx_status_name (status=? AND name=?)`。**低基数列的正确用法是当复合索引的首列（配合租户、状态、软删除这类过滤），不是单独建索引。**

`ANALYZE` 之后三条计划一字未变，原因写在 `sqlite_stat1` 里：

```text
idx_cat          "100000 16667"      idx_status      "100000 33334"
idx_status_name  "100000 33334 1"    idx_name        "100000 1"
idx_td           "100000 5000 334 1"
```

读法：第一个数是表行数，之后每个数对应索引的一个前缀列，含义是「该前缀的**平均**不同取值数」——`33334 = 100000/3`。这解释了实测现象：**`status='on'`（96%）与 `status='off'`（2%）在统计里是同一个数字**，`ANALYZE` 看不出倾斜，所以计划不会因为它而改变。要治倾斜得换思路（部分索引，或把高频值从索引谓词里去掉），别指望 `ANALYZE`。

## 部分索引与它的收益前提

```text
ALTER TABLE prod ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_active_sku ON prod(sku) WHERE deleted_at IS NULL;

WHERE sku LIKE 'SKU0001%' AND deleted_at IS NULL   → [3] SCAN prod USING INDEX idx_active_sku（用上了）
WHERE sku LIKE 'SKU0001%'                          → [2] SCAN prod USING COVERING INDEX idx_sku（用不上）
```

`PRAGMA index_list('prod')` 里这一行的 `partial` 是 1。**教训一条**：我是在所有行 `deleted_at` 都为 `NULL` 时建的这个索引，`dbstat` 显示 `idx_active_sku` 与 `idx_sku` 都是 1740 KB——谓词没滤掉任何行，部分索引一点没省。收益前提是「被排除的行真的占多数」。

## 写放大：索引不是免费的

同构表 `w0`（0 个二级索引）、`w1`（1 个）、`w4`（4 个）各插 10 万行、各重复 3 次：中位 **101.4 / 189.8 / 373.5 ms**（+87% / +268%）。空间（`PRAGMA dbstat`）：表本体 `prod` 6068 KB、`w0/w1/w4` 各 3344 KB，而 `idx_status_name` 2768 KB、`idx_name` 2464 KB、`idx_td` 之外四个二级索引各约 1.5 MB——**四个二级索引加起来（约 6.4 MB）比表本体（3.3 MB）还大**。建索引本身是一次全表排序：`idx_name` 41.5 ms、三列的 `idx_td` 70.2 ms（10 万行），生产上要照这个比例留时间窗。改数据侧我也量了两个数：`w4` 上更新索引列 `a` 一万行中位 11.3 ms、更新非索引列 `d` 一万行中位 13.8 ms——**这两组重复执行的样本不干净，我只敢说「同一量级」**，别读成「改索引列不贵」。`DELETE` 一万行的计时我做废了（后两次重复已无行可删，中位数落在 0.0 ms），所以本章不给删除放大的数字。

## 分页：`OFFSET` 的代价是「先扫过再丢掉」

```text
SELECT id, name FROM prod ORDER BY id LIMIT 20 OFFSET 50000;  → [7] SCAN prod
SELECT id, name FROM prod WHERE id > 50000 ORDER BY id LIMIT 20;
                                                             → [4] SEARCH prod USING INTEGER PRIMARY KEY (rowid>?)
各 200 次中位：119.4 ms  vs  2.6 ms                            （46 倍）
```

游标分页快在计划里那句 `rowid>?`：直接定位。深翻页的唯一解是**把上一页末行的排序键传进 `WHERE`**，而不是给 `OFFSET` 加索引。顺带记两个形状（`prod` 关联一张 5 千行的表）：

```text
WHERE tenant IN (SELECT tenant FROM w1 WHERE c < 10)
  → SCAN prod USING COVERING INDEX idx_td + CORRELATED LIST SUBQUERY 1 + SCAN w1
WHERE EXISTS (SELECT 1 FROM w1 x WHERE x.c = p.dept)
  → SCAN p USING COVERING INDEX idx_td + BLOOM FILTER ON x (c=?)
    + SEARCH x EXISTS USING AUTOMATIC PARTIAL COVERING INDEX (c=?)
```

自动索引不是能指望的东西：`SELECT * FROM wide WHERE oid = 100`（5 万行、无索引）计划里只有 `SCAN wide`，因为没有覆盖可言；建了 `idx_wide_oid` 才变成 `SEARCH ... USING INDEX (oid=?)`。

## 常见错误与排查

1. **加了索引没变快。** 现象：`WHERE date(created_at)=:d` 或 `LIKE '%kw%'` 依旧慢。原因：列被函数包住、模式不是前缀，或默认 `LIKE` 大小写不敏感导致前缀无法转区间。怎么确认：`EXPLAIN QUERY PLAN`——出现 `SCAN` 就是没用上，注意 `SCAN ... USING COVERING INDEX` 也算没用上。怎么修：改范围条件、建表达式索引（实测 `length(name)=8` 变 `SEARCH ... (<expr>=?)`）、上全文检索，或 `PRAGMA case_sensitive_like=ON`（要接受大小写敏感）。

2. **查询返回 0 行，数据明明在。** 原因：列是 TEXT、字面量是数字，BINARY 排序里整数永远小于文本。怎么确认：`SELECT typeof(col) ...` 再用 `WHERE col > 122 LIMIT 3` 看它实际匹配到什么。怎么修：字面量写成字符串；ORM/参数绑定层保证传字符串。「索引工作正常」不能排除这个错。

3. **复合索引只用到第一列。** 现象：计划是 `SEARCH ... idx_td (tenant=?)`，`price` 没进括号。原因：中间列缺席，或第一列写成范围。怎么修：按「等值列在前、范围/排序列在后」重排列顺序，或为另一种谓词组合单独建索引（`idx_status_name` 那一例）。

4. **低基数列单独建索引，写入变慢、查询没变快。** 现象：`status` 建了索引，`WHERE status='on'` 还是慢，插入从 101.4 涨到 189.8/373.5 ms。怎么确认：`SELECT status, COUNT(*), ROUND(100.0*COUNT(*)/(SELECT COUNT(*) FROM prod),1) FROM prod GROUP BY status`（实测 2 / 2 / 96）+ `SELECT * FROM sqlite_stat1`。怎么修：删单列索引，改复合索引首列或部分索引（`WHERE status='off'`）。

5. **第 500 页 12 秒。** 原因：`OFFSET` 要先生成再丢弃，省不掉排序。怎么确认：计划只有 `SCAN`，且耗时随偏移线性增长（实测 119.4 vs 2.6 ms）。怎么修：游标分页，或「先用覆盖索引取 id、再回表取整行」两段式；软删除表还要注意 `COUNT(*)` 含已删行导致页码对不上（见[第 5 章 数据建模](/database/data-modeling)）。

6. **索引把库撑爆 / 建索引卡住。** 怎么确认：`dbstat` 按 `name` 汇总 `pgsize`（本章给了数字）；`CREATE INDEX` 计时 41.5–70.2 ms / 10 万行。怎么修：合并复合索引、删掉从没出现在任何计划里的索引（主要查询逐条 `EXPLAIN QUERY PLAN` 过一遍）。

7. **看到 `SEARCH` 就认为快。** 原因：`SEARCH` 也可能是每行一次的回表风暴（`cat='food'` 取全量只快 1.6 倍）。怎么修：把「命中行数」和「取回行数」一起估——`WHERE` 的选择性与 `SELECT` 的列集合共同决定收益。

## 练习

<Exercise title="先预测计划，再验证" difficulty="基础">

`prod` 上有 `idx_name(name)`、`idx_td(tenant,dept,price)`。预测五句话的计划（`SCAN` 还是 `SEARCH`、括号里用到哪几列、有没有 `USE TEMP B-TREE`），再逐句跑 `EXPLAIN QUERY PLAN`：

1. `SELECT id FROM prod WHERE name = 'x'`
2. `SELECT id FROM prod WHERE dept = 21`
3. `SELECT id FROM prod WHERE tenant = 7 AND price = 100`
4. `SELECT tenant, dept FROM prod WHERE tenant = 7 AND dept = 21`
5. `SELECT tenant, dept, name FROM prod WHERE tenant = 7 AND dept = 21`

<template #answer>

1 `SEARCH ... idx_name (name=?)`。2 `SCAN prod USING COVERING INDEX idx_td`（跳过头列，只能全索引扫；实测这一形状 200 次要 1248.1 ms）。3 `SEARCH ... idx_td (tenant=?)`——中间列 `dept` 缺席，`price` 不进括号。4 `COVERING`（要的列都在索引里）。5 `USING INDEX`，因为 `name` 不在索引里要回表。3 与 5 分别是最左前缀与覆盖索引最容易混淆的地方。

</template>

</Exercise>

<Exercise title="把 LIKE 救回索引，并说明副作用" difficulty="进阶">

默认设置下 `SELECT id FROM prod WHERE sku LIKE 'SKU0001%'` 的计划是 `SCAN prod`。

1. 用两种不同办法让它变成 `SEARCH`。
2. 每种办法付出了什么？
3. 用一句 SQL 证明「默认 `LIKE` 大小写不敏感」。

<template #answer>

办法一：改写成范围 `sku >= 'SKU0001' AND sku < 'SKU0002'` → 实测 `SEARCH prod USING INDEX idx_sku (sku>? AND sku<?)`；代价是应用层要自己算前缀上界，且改不动别人写死的 SQL。办法二：`PRAGMA case_sensitive_like = ON` 后同一句 → 实测 `SEARCH prod USING COVERING INDEX idx_sku (sku>? AND sku<?)`；代价是**整个连接的 `LIKE` 都变成大小写敏感**（连接级设置，同连接其他查询一起变），移植时又是一处差异。第 3 问：`SELECT COUNT(*) FROM prod WHERE sku LIKE 'sku0001%'` 实测 100 行，而库里存的是大写 `SKU0001xx`，证明默认不敏感。另外 `GLOB 'SKU0001*'` 在默认设置下就能走索引（实测 `SEARCH ... COVERING INDEX`），因为 `GLOB` 本来就区分大小写。

</template>

</Exercise>

<Exercise title="故意造一个「有索引反而更慢」的场景" difficulty="挑战">

只保留 `idx_status`，比较 `WHERE status='on'`（占 96%）走索引与用 `+status` 屏蔽索引两种写法，各取全部行、各加 `LIMIT 20`。

1. 说出你预计的差别与理由。
2. 用本章同构列 `cat` 的实测数字校验你的预测。
3. 什么情况下你会删掉这个索引？

<template #answer>

关键变量是「取回多少行」与「要不要回表」。本章用 `cat`（单值约 1.6 万行）实测：取全部时走索引 407.9 ms、屏蔽索引 657.9 ms（只快 1.6 倍）；加 `LIMIT 20` 时 5.3 ms vs 319.6 ms（差 60 倍）。命中 96% 的行时，走索引等于「按 rowid 乱序回表九万多次」，比顺序全扫更差——但本机计划里它**仍然选了 `SEARCH ... idx_status`**，因为 `sqlite_stat1` 只存平均值（`100000 33334`），看不出倾斜。所以第 3 问：删掉这种高频值的单列索引，换成部分索引（`WHERE status='off'`）或复合索引首列，然后**逐条主要查询用 `EXPLAIN QUERY PLAN` 复核**，而不是凭「这是常用过滤列」保留它。

</template>

</Exercise>

## 官方文档与延伸阅读

- [SQLite 查询流程与索引使用](https://www.sqlite.org/optoverview.html) —— 核实 `SEARCH`/`SCAN` 的定义、最左前缀规则、覆盖索引与 `USE TEMP B-TREE` 各自的官方说法。
- [SQLite `CREATE INDEX`](https://www.sqlite.org/lang_createindex.html) —— 核实表达式索引与部分索引（`WHERE` 子句）的语法边界，对应本章 `idx_len`、`idx_active_sku`。
- [SQLite `ANALYZE` 与 `sqlite_stat1`](https://www.sqlite.org/lang_analyze.html) —— 核实 `stat` 字符串「第一个数是行数、之后是每个前缀列的平均不同值数」的读法，这是「ANALYZE 看不出倾斜」结论的定义依据。
- [SQLite PRAGMA](https://www.sqlite.org/pragma.html) —— 核实 `case_sensitive_like`、`dbstat`、`index_list`（含 `partial` 列）、`index_xinfo`、`page_count` 这几个本章开关。
- [SQLite 文档索引](https://www.sqlite.org/docs.html) —— 在其中找 `EXPLAIN QUERY PLAN` 一页核对本章计划用词；本机 EQP 不输出运行时行数与耗时。
- [PostgreSQL 索引章节](https://www.postgresql.org/docs/current/indexes.html) —— 官方按 11.3 Multicolumn Indexes、11.7 Indexes on Expressions、11.8 Partial Indexes、11.9 Index-Only Scans and Covering Indexes 分节，本章每个概念都能对上号；但 **PG 的具体行为未在本机验证**（尤其 `LIKE` 与排序规则对索引的影响、`EXPLAIN (ANALYZE)` 的真实行数）。
- [MySQL 8.0 `EXPLAIN`](https://dev.mysql.com/doc/refman/8.0/en/explain.html) —— 移植时核对该引擎的索引选择与统计信息，**未在本机验证**；本章 MySQL 侧一条结论都没下。

## 下一章

索引解决的是「读得快、写得贵」，但它独自解决不了一个问题：同一批行在被索引扫描的同时，别人正在改它。本章把最贵的一部分成本量化了（0/1/4 个索引下 101.4 / 189.8 / 373.5 ms 的插入放大、索引体积超过表本体），也量化了不合理的读法（`OFFSET` 119.4 ms vs 游标 2.6 ms）。接下来要回答的是**多条写语句之间怎么互不踩踏**：`BEGIN` 之后做了什么才算数、为什么两个「先读后写」的请求会互相覆盖、以及为什么[第 5 章](/database/data-modeling) 那些「先查要删什么再删」的流程必须包进事务。[第 7 章 事务与并发](/database/transactions) 从这些疑问开始。
