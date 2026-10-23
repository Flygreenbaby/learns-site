# SQLite 入门：一个文件就是整个数据库，动态类型会骗过你

你在[手写最小服务器](/backend/minimal-http-server) 里用内存 Map 存过数据，进程一重启就全没了；换成 `data.json` 之后，并发写互相覆盖、半截文件解析失败。想换成真正的数据库，又怕装 PostgreSQL、配端口、管用户——于是 SQLite 是这个阶段唯一正确的答案：**没有服务进程、没有连接串、没有权限体系，一个 `.db` 文件就是整个数据库**，而且 Node 22 起内置 `node:sqlite`，连装包都省了。

但 SQLite 有两种「不按常理出牌」会真咬人。第一种：类型系统是**动态类型 + 亲和性（affinity）**，你在 `TEXT` 列插整数、在 `BOOLEAN` 列插 `'true'`，它都不拦你，等查询结果对不上再回头查就晚了。第二种：给参数绑一个 JavaScript `Date`，**不报错、不提示，直接存成 NULL**——这是本机实测结果，也是我认为最阴的坑：

```text
INSERT INTO t (v) VALUES (?)   绑定 new Date('2026-01-02T03:04:05.000Z')
  run() 返回 {"lastInsertRowid":1,"changes":1}   -- 看起来成功了
SELECT v, typeof(v) FROM t
  {"v":null,"t":"null"}                          -- 实际存进去的是 NULL
```

这一章把地基打实：`node:sqlite` 的真实 API 面、pragma 为什么必须收进一个入口、亲和性逐列实测、批量写入的 15789 ms 与 11 ms 差在哪、报错文本长什么样。

<Callout type="verified" title="本章每条输出都在本机跑过">

Windows 10 x64 + Node v25.4.0，`node:sqlite` 的 `DatabaseSync`，底层 `SELECT sqlite_version()` = **3.51.1**，日期 2026-10-18。临时脚本共执行约两百条 SQL 与绑定操作，正文的 `THROWS` 与返回 JSON 均为原样粘贴。`node:sqlite` 仍是实验特性：加载时 stderr 打印 `ExperimentalWarning: SQLite is an experimental feature and might change at any time`（这是本机真实输出的一行，不是文档摘录），**API 名、构造选项、默认值都可能随 Node 版本变化**，换版本请重跑本章脚本。时间数字是同一次运行的墙上时钟读数，只用于比较量级，不是基准测试结论。

</Callout>

## 一个文件就是整个数据库

`new DatabaseSync(path)` 第一次调用会创建这个文件。本机实测最小库的物理事实：

```text
PRAGMA page_size        {"page_size":4096}
PRAGMA encoding         {"encoding":"UTF-8"}
PRAGMA journal_mode     {"journal_mode":"delete"}   -- 文件库默认；:memory: 返回 memory
文件体积（建 1 张表 + 3 行数据后）  8192 字节（两个 4 KB 页）
文件头 16 字节          "SQLite format 3\0"
```

表结构本身也是数据：`SELECT type, name, tbl_name FROM sqlite_master WHERE type='table'` 每行的 `sql` 列存着原始 `CREATE TABLE` 语句。这条事实后面到处在用——第 8 章[迁移与版本管理](/database/migrations) 的版本号可以放在 `PRAGMA user_version`（实测默认 0，写 `= 7` 后读回 `{"user_version":7}`），而 `sqlite_master` 就是「当前结构长什么样」的唯一真相。

该用与不该用的官方口径见 [sqlite.org/whentouse](https://www.sqlite.org/whentouse.html)：适合本地开发与应用内数据、单元测试里的真数据库、CLI 与桌面应用存储、手机端、只读分析数据集、ORM 与迁移的练习场；不适合多机共写同一库（没有服务器，网络盘上的锁不可靠）、细粒度用户权限、高并发写 + JSONB 这类服务端需求。前四章用 SQLite 练语义，之后回到 PostgreSQL 主线，这是[数据库领域首页](/database/)定的顺序。

## node:sqlite 的 API 面：实测清单

用 `Object.getOwnPropertyNames` 沿原型链收集，本机 `DatabaseSync` 上有 `prepare`、`exec`、`close`、`isOpen`、`isTransaction`、`function`、`aggregate`、`setAuthorizer`、`location`、`enableDefensive`、`enableLoadExtension` 等；`StatementSync` 上有 `run`、`get`、`all`、`iterate`、`columns`、`sourceSQL`、`expandedSQL`、`setReadBigInts`、`setAllowBareNamedParameters`、`setAllowUnknownNamedParameters`、`setReturnArrays`。日常只需要四条：

```js
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');

db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');   // 多语句 DDL，返回 undefined
const ins = db.prepare('INSERT INTO t (name) VALUES (?)');       // 预编译，可重复绑定
console.log(ins.run('阿栗'));                                    // { lastInsertRowid: 1, changes: 1 }
console.log(db.prepare('SELECT id, name FROM t WHERE id = ?').get(1)); // { id: 1, name: '阿栗' }
```

返回形状的实测细节，每一条都会在你没预料到时咬人：

| 调用 | 本机返回 |
| --- | --- |
| `get()` 命中 0 行 | **`undefined`**（不是 `null`、不是 `{}`）——`row.name` 直接 `TypeError` |
| `all()` 命中 0 行 | `[]` |
| `run()` | `{ lastInsertRowid, changes }`，两者是数字；rowid 过大时见下面 bigint |
| `iterate()` | 惰性逐行；提前 `break` 要调 `it.return()` |
| `columns()` | `[{"column":"id","database":"main","name":"id","table":"t","type":"INTEGER"}]` |
| `exec()` 返回值 | `undefined`，想知道影响几行只能自己查 |

绑定三种写法都能用：`?` 位置参数、`$name` / `:name` / `@name` 命名参数（传对象，默认允许裸键名，即 `$a` 可用 `{ a: 1 }`）。三条边界：多传没用的键 → `THROWS [ERR_INVALID_STATE] Unknown named parameter 'c'`；少传某个键 → **不报错，绑成 NULL**；位置参数少传 → 同样补 `NULL`。**「少传参数静默变 NULL」和 `Date` 那条是同一个病：这个驱动倾向于不报错。**

不能绑的 JS 值（全部实测）：

```text
.run(true)       THROWS [ERR_INVALID_ARG_TYPE] Provided value cannot be bound to SQLite parameter 1.
.run(undefined)  THROWS [ERR_INVALID_ARG_TYPE] 同上
.run(NaN)        成功，存进去是 NULL
.run(new Date(...))  成功，存进去是 NULL
.run(123n)       成功，bigint 可用
.run(new Uint8Array([1,2,250]))  成功，typeof(b) = "blob"，读回仍是 Uint8Array
```

结论背下来：**布尔写 `1` / `0`；日期写字符串（`toISOString()` 实测得到 `text`）或让数据库用 `datetime('now')` 生成；`NaN` 和 `Date` 会被静默降为 `NULL`。** 整数还有精度线：`9007199254740991` 往返正常，`9007199254740993` 按默认方式读 → `THROWS [ERR_OUT_OF_RANGE] Value is too large to be represented as a JavaScript number: 9007199254740993`，`setReadBigInts(true)` 后同一行返回 `9007199254740993n`。**id 可能超过 2^53 就从一开始用 bigint 读。**

## pragma 只认连接：把配置收进一个工厂函数

上一章实测 `PRAGMA foreign_keys` 是**每个连接**都要设一次的开关，不是库的属性。把该设的东西收进唯一入口：

```js
function openDb(file = 'app.db') {
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = OFF');   // 演示：后写的 exec 会覆盖构造选项
  return db;
}
```

最后一行是故意加的——本机实测：构造选项传 `true` 之后再执行 `PRAGMA foreign_keys = OFF`，读回来就是 0。**pragma 是后来者覆盖，谁都能改**，所以工厂函数返回前要把终态读回来断言一次：

```js
if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('FK 未开启');
```

本机默认值（文件库）：`synchronous` = 2（FULL）、`journal_mode` = `delete`、`busy_timeout` = 0、`cache_size` = -2000（负数是 KB）、`page_size` = 4096。含义与调法以 [SQLite PRAGMA 文档](https://www.sqlite.org/pragma.html) 为准，别照抄网上的「三连优化」。

WAL 实测：文件库上 `PRAGMA journal_mode = WAL` 返回 `{"journal_mode":"wal"}`，连接打开期间目录里出现 `app.db`、`app.db-shm`、`app.db-wal`；`close()` 后只剩 `app.db`（回写检查点后副文件被清掉）。**判断 WAL 是否真开着只能读 `PRAGMA journal_mode`，不能靠「我看到 -wal 文件」——关掉的连接不会留它们。** 收益是读不阻塞写，代价是必须用本地文件系统、不能跨网络盘。持久性也验证了：写三行 → `close()` → 重新 `open` 同一文件，行与结构都在。

## 亲和性逐列实测：TEXT 列里到底存了什么

同一个数字 `1`，声明不同会存成不同的东西。本机给每列插入 `1, 2.5, 'x', NULL, 1e3, '123', '12.0', '12.5', TRUE, x'41'` 这类值，用 `typeof()` 读回：

| 列声明 | 亲和性 | 插 `'123'` | 插 `'12.0'` | 插 `'12.5'` | 插 `1e3` | 插 `x'41'` |
| --- | --- | --- | --- | --- | --- | --- |
| `a TEXT` | TEXT | `text` `'123'` | `text` | `text` | `text` `'1000.0'` | **`blob`**（不转） |
| `a`（无类型） | 无 | `text` | `text` | `text` | `real` 1000.0 | `blob` |
| `a INT` | INTEGER | `integer` 123 | **`integer` 12** | `real` 12.5 | `integer` 1000 | `blob` |
| `a NUMERIC` | NUMERIC | `integer` 123 | `integer` 12 | `real` 12.5 | `integer` 1000 | `blob` |
| `a BOOLEAN` | NUMERIC | 同 NUMERIC | — | — | — | 插 `'true'` → **`text`** |

四条要记住：

1. **`BOOLEAN` 不是布尔类型**，SQLite 没有布尔。实测一列里同时有 `integer 1`、`integer 0`、`text 'true'`、`text 'yes'`、`null`。要真/假两值就自己写死 `CHECK (flag IN (0,1))`。
2. **`VARCHAR(20)` 不截断**（实测插 49 个字符，`length(a)` 就是 49），**`DECIMAL(10,2)` 不保精度**（`1.005` 存成 `real`）。括号里的长度和精度全是摆设；MySQL / PostgreSQL 会按它们报错或四舍五入，跨库时这是最常见的翻译错误。
3. **`'12.0'` 进 INTEGER 亲和列变成整数 12**——规则是「能无损转就转」，`'12.5'` 转整数会丢信息所以保持 `real`。于是 `WHERE a = 12` 会命中那条来自 `'12.0'` 的值，而 `ORDER BY a` 的语义不再是字符串序。
4. **BLOB 是唯一不被亲和性搬运的**。想强制转换只能显式 `CAST`：实测 `CAST('12abc' AS INTEGER)` = 12、`CAST('12.9' AS INTEGER)` = 12（截断，不是四舍五入）、`CAST('abc' AS INTEGER)` = 0。

亲和性还会**改造你的 WHERE**：`a TEXT` 列里 `'1'` 有两行（一行来自整数 `1`、一行来自 `TRUE`），`SELECT COUNT(*) FROM af_text WHERE a = 1` → **2**；`WHERE a = '1'` 同样 2；`WHERE a > 0` → 7 行，因为它把所有能转成数字的文本都拉进来了。不能比较时按存储类排序，本机实测次序 `NULL < INTEGER/REAL < TEXT < BLOB`：

```text
SELECT v, typeof(v) FROM (SELECT NULL UNION SELECT 1 UNION SELECT 2.0 UNION SELECT 'A' UNION SELECT x'42') ORDER BY v
  [{"v":null},{"v":1,"t":"integer"},{"v":2,"t":"real"},{"v":"A","t":"text"},{"v":{"0":66},"t":"blob"}]
```

由此两条规矩：**号码、身份证、手机号这类「看着像数字的字符串」列一律 `TEXT`**，否则它会参与数值比较与排序；**金额用整数最小单位（分）存 `INTEGER`**，实测 `0.1 + 0.2` = `0.30000000000000004`、`ROUND(1.005, 2)` = 1、`ROUND(2.675, 2)` = 2.67。注意 `CAST(0.1+0.2 AS TEXT)` 显示 `'0.3'`（SQLite 按 15 位有效数字格式化），**比较没被骗、显示骗了你**。

## 事务：15789 毫秒与 11 毫秒的差别在哪

同一个文件库、同一个预编译 `INSERT`、2000 行，本机一次运行的读数：

| 写法 | 墙上耗时 | 事后行数 |
| --- | --- | --- |
| 循环里裸 `insert.run()`（每条一个隐式事务） | **15789.1 ms** | 2000 |
| 全部包在 `BEGIN` … `COMMIT` | **11.0 ms** | 2000 |
| `BEGIN IMMEDIATE` … `COMMIT` | 11.2 ms | 2000 |
| `BEGIN` … `ROLLBACK` | 4.6 ms | 0 |
| 裸循环 + `PRAGMA synchronous = OFF` | 2885.0 ms | 2000 |

**差一千四百多倍**，原因不是「SQLite 慢」而是 fsync：默认 `journal_mode = delete` + `synchronous = 2`，每条 autocommit 语句都要把日志落盘并 `fsync` 一次，一次几十毫秒；包成一个事务就只 `fsync` 一次。`synchronous = OFF` 省下大头但仍有开销，而且断电丢数据——**这不是可选的优化项**。`BEGIN IMMEDIATE` 在这个量级上和 `BEGIN` 没区别，它的价值在多进程并发写（[事务与并发](/database/transactions) 展开）。

事务状态也实测了：`db.isTransaction` 是布尔属性（`false` → `BEGIN` → `true` → `ROLLBACK` → `false`）；事务里再 `BEGIN` → `THROWS: cannot start a transaction within a transaction`；没有事务时 `COMMIT` → `THROWS: cannot commit - no transaction is active`。**别用 try/catch 猜自己是否在事务里，读 `isTransaction`。** `ROLLBACK` 那行 0 是本章第二个关键事实：**未提交的写入对外完全不可见**，第 9 章备份会依赖这条原子性。

## 报错文本长什么样，以及建库脚本不是原子的

| 场景 | 本机原话 |
| --- | --- |
| `SELEC 1` | `near "SELEC": syntax error`（`ERR_SQLITE_ERROR`） |
| 查不存在的表 | `no such table: nope` |
| 查不存在的列 | `no such column: zz` |
| 绑定参数多于占位符 | `column index out of range` |
| 用双引号写字符串 | `no such column: "双引号" - should this be a string literal in single-quotes?` |
| 表已存在 | `table ok1 already exists` |
| `exec('')` / `prepare('')` | 都不报错，后者返回一个 `StatementSync` 对象 |

双引号那条单独记：SQLite 里 `"ident"` 是标识符，字符串必须单引号；新版 SQLite 主动加了这句提示，看到它就去改引号，别去查「为什么表里没有这个列」。

更阴的是 `exec()` 的多语句行为。本机实测：

```text
db.exec("CREATE TABLE ok1 (a); CREATE TABLE ok1 (a); CREATE TABLE ok2 (a)")
  THROWS: table ok1 already exists
再查 sqlite_master：  [{"name":"ok1"}]   -- ok2 没被创建，但 ok1 留下了
```

**`exec()` 逐条执行整批语句，中途失败就停下，但已执行成功的不会自动撤销。** 建库脚本、迁移脚本必须自己包事务（`BEGIN` → 全部语句 → `COMMIT`，出错 `ROLLBACK`），否则你会得到半套结构——第 8 章[迁移与版本管理](/database/migrations) 直接相关。官方 `sqlite3` 命令行和 VS Code 的 SQLite 浏览插件能肉眼看表，但别用它们代替 `PRAGMA` 与 `sqlite_master`；**本机只装了 Node 的驱动，sqlite3 CLI 未在本机运行**，子命令可用性以官方 CLI 文档为准。

## 从 JSON 文件迁到 SQLite：一个能跑的最小闭环

```js
const records = [                       // 原本躺在 data.json 里的数组
  { name: '阿栗', city: '北京', joinedAt: '2026-03-01' },
  { name: 'Bob',  city: null,   joinedAt: '2026-03-04' },
  { name: '陈晨', city: '上海', joinedAt: '2026-02-11' },
];
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE learners (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, joined_at TEXT NOT NULL,
  CHECK (length(name) > 0));`);
const ins = db.prepare('INSERT INTO learners (name, city, joined_at) VALUES (?, ?, ?)');
db.exec('BEGIN');                       // 一批写入包成一个事务
try {
  for (const r of records) ins.run(r.name, r.city ?? null, r.joinedAt);
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }
console.log(db.prepare('SELECT COUNT(*) n, COUNT(city) with_city FROM learners').get());
```

本机输出 `{ n: 3, with_city: 2 }`——`COUNT(col)` 只数非 NULL（下一章展开）。真正的麻烦不在这段代码，而在「原来 JSON 里同名字段有的是字符串、有的是数字、有的干脆没有」：亲和性会把看着像数字的文本转掉，所以**清洗必须在插入前做完**，别指望列声明类型替你兜住。

## 常见错误与排查

**1. 时间字段读出来是 `null`。** 原因：把 JS `Date` 直接绑进参数，驱动静默存成 NULL（实测）。确认：`SELECT typeof(col), col FROM t LIMIT 5`。修法：绑 `toISOString()`，在 DAO 层集中做；给列加 `NOT NULL`，让静默失败变成显式报错。

**2. 一次导入几十万行卡死。** 原因：循环里裸 `run()`，每条一次 fsync（实测 2000 行 15.8 秒）。确认：`db.isTransaction` 为 `false` 且没有 `BEGIN`。修法：包一个事务（同批 2000 行 11 ms），大批量分批提交以免回滚段膨胀。

**3. 结果集类型意外，比较/排序不对劲。** 原因：亲和性把 `'12.0'` 转成 12、`TRUE` 转成 `'1'`。确认：`SELECT typeof(col), COUNT(*) FROM t GROUP BY 1`，一跑就见光。修法：需要精确语义的列显式 `CAST`，号码类列声明 `TEXT`，金额用整数分。

**4. `Cannot read properties of undefined (reading 'name')`。** 原因：`get()` 未命中返回 `undefined`（实测）。确认：换 `all()` 看数组长度。修法：`const row = stmt.get(id) ?? null`、`row?.name`，并给「查不到」明确业务含义（404 而不是崩溃）。

**5. 外键该拦的没拦住，或换个连接全乱了。** 原因：pragma 每连接生效且后来者覆盖（实测构造选项 `true` 之后一句 `PRAGMA foreign_keys = OFF` 就关掉）。确认：紧接着读回 `PRAGMA foreign_keys`。修法：工厂函数 + 返回前断言。

**6. 迁移失败后库里只剩半套结构。** 原因：`exec()` 不原子（实测 `ok1` 留下、`ok2` 未创建）。确认：`SELECT name FROM sqlite_master` 对一遍预期清单。修法：整批包事务，或每条 DDL 单独做成可重放的迁移版本。

## 练习

<Exercise title="练习 1 · 预测这一列里存着什么" difficulty="基础">

写出 `SELECT v, typeof(v) FROM probe ORDER BY rowid` 的输出：

```sql
CREATE TABLE probe (v INT);
INSERT INTO probe VALUES ('100'), ('12.0'), ('12.5'), ('abc'), (1e3), (TRUE), (x'41'), (NULL);
```

<template #answer>

```text
100 | integer
12  | integer    -- '12.0' 转整数无损，所以转
12.5| real       -- 转整数会丢信息，保持 real
abc | text       -- 转不动，照原样存
1000| integer    -- 1e3 是实数 1000.0，无损转整数
1   | integer    -- TRUE 关键字就是整数 1
A   | blob       -- BLOB 不被亲和性搬运
NULL| null
```

判据一句话：**能无损转就转，转不动原样存，BLOB 永远不转。** 自检：`SELECT typeof(v), COUNT(*) FROM probe GROUP BY 1` 应给出 6 种类型；只要出现多于一种，说明这列的语义已经在漂移。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造四种报错并解释" difficulty="进阶">

下面四段各写错了一处。给出 `node:sqlite` 抛出的 `code` 与 `message`，并说明怎么改。

```js
db.prepare('INSERT INTO t (name) VALUES (?)').run(true);
db.prepare('INSERT INTO t (id, name) VALUES ($id, $name)').run({ id: 1, name: 'a', extra: 2 });
db.exec('INSERT INTO t (name) VALUES ("王二")');
db.prepare('SELECT * FROM nope').all();
```

<template #answer>

| 写法 | 实测抛出的错误 | 修法 |
| --- | --- | --- |
| 绑 `true` | `ERR_INVALID_ARG_TYPE`：`Provided value cannot be bound to SQLite parameter 1.` | 写 `1` / `0`，或在 DAO 层 `flag ? 1 : 0`；要约束就配 `CHECK (flag IN (0,1))` |
| 多传一个没用的键 | `ERR_INVALID_STATE`：`Unknown named parameter 'extra'` | 只传 SQL 里出现的键（放宽 API 在本机方法清单里存在，但默认拒绝，别改默认） |
| 双引号字符串 | `ERR_SQLITE_ERROR`：`no such column: "王二" - should this be a string literal in single-quotes?` | 字符串一律单引号；含单引号就写两个单引号转义 |
| 查不存在的表 | `ERR_SQLITE_ERROR`：`no such table: nope` | `SELECT name FROM sqlite_master` 看真实表名，确认迁移是否跑过 |

区分两类：**绑定期错误**（前两条，SQL 根本没送到 SQLite，`code` 是 Node 的 `ERR_INVALID_ARG_TYPE` / `ERR_INVALID_STATE`）与 **SQLite 自身错误**（后两条，`code` 是 `ERR_SQLITE_ERROR`、message 是 SQLite 原话）。看 `e.code` 就能立刻判断问题在驱动还是 SQL。

</template>

</Exercise>

<Exercise title="练习 3 · 写一个不会腐化的连接工厂" difficulty="挑战">

要求：打开 `app.db`，(a) 外键必须开启并断言；(b) 用 WAL；(c) `busy_timeout = 5000`；(d) `PRAGMA user_version` 小于 1 时建表并把版本设为 1；(e) 结构变更包在事务里，出错回滚且不留下半套结构。并说明为什么不能靠「目录里有没有 `.db-wal`」判断 WAL。

<template #answer>

```js
const { DatabaseSync } = require('node:sqlite');

export function openDb(file = 'app.db') {
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA busy_timeout = 5000');
  if (db.prepare('PRAGMA journal_mode = WAL').get().journal_mode !== 'wal') throw new Error('WAL 未能开启');
  if (db.prepare('PRAGMA user_version').get().user_version < 1) {
    db.exec('BEGIN');
    try {
      db.exec(`CREATE TABLE learners (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, joined_at TEXT NOT NULL
      );`);
      db.exec('PRAGMA user_version = 1');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('FK 未开启');
  return db;
}
```

要点四条：

1. **每一项配置都用「读回来」验证**，而不是假设写过就生效——`journal_mode`、`foreign_keys` 都是可查询的 pragma，返回值才是事实。
2. `user_version` 存在库头里，能随事务提交或回滚（本章实测），所以放在 `BEGIN` / `COMMIT` 之间是对的：结构变更失败时版本号不会先跑到 1。第 8 章会把它换成正式迁移表。
3. **WAL 判据**：`close()` 后 SQLite 做最后一次检查点并删掉 `-wal` / `-shm`（本章实测打开时三个文件、关闭后只剩 `app.db`）。「没看到 -wal」既可能是没开 WAL，也可能只是没有活动连接——唯一可靠判据是 `PRAGMA journal_mode` 的返回值。
4. `:memory:` 上 `PRAGMA journal_mode = WAL` 无效（返回 `memory`），别在单测里断言 WAL。

</template>

</Exercise>

## 官方文档与延伸阅读

- [SQLite 文档索引](https://www.sqlite.org/docs.html)、[SQL 语法总入口](https://www.sqlite.org/lang.html) —— 任何语法细节的起点。
- [SQLite 适用场景](https://www.sqlite.org/whentouse.html) —— 本章「一个文件就是整个数据库」一节口径来源。
- [SQLite 数据类型版本 3](https://www.sqlite.org/datatype3.html) —— 核实亲和性归类规则、`BOOLEAN` / `VARCHAR(n)` / `DECIMAL` 只是建议、BLOB 不参与转换、存储类排序次序；逐条对照本章实测表。
- [SQLite `PRAGMA`](https://www.sqlite.org/pragma.html) —— 核实 `journal_mode`、`synchronous`、`busy_timeout`、`cache_size`、`user_version`、`foreign_keys` 的默认值与作用域。
- [SQLite 事务](https://www.sqlite.org/lang_transaction.html) —— 核实 `DEFERRED` / `IMMEDIATE` / `EXCLUSIVE` 差别、事务内 DDL 可回滚。
- [Node.js `node:sqlite` API](https://nodejs.org/api/sqlite.html) —— 应核实构造选项与可绑定类型清单；**本次取回该页失败（`fetch failed`），本章相关结论只有本机实测支撑**，换 Node 版本必须重跑脚本。
- [PostgreSQL 数据类型入口](https://www.postgresql.org/docs/current/datatype.html) —— **未在本机验证**：需核实的是 `VARCHAR(n)` 超长报错、`DECIMAL` 定点精度、`BOOLEAN` 是真布尔，与本章 SQLite 实测对照着读。
- 站内衔接：[关系模型与基础概念](/database/relational-model)、[SQL 查询基础](/database/sql-basics)、[事务与并发](/database/transactions)、[迁移与版本管理](/database/migrations)、[备份与恢复](/database/backup-and-restore)。

## 下一章

环境和问题都摆到桌面上了：一个文件就是数据库，`node:sqlite` 的返回形状与绑定限制（`Date` 静默变 NULL、`get()` 返回 `undefined`）、pragma 只认连接、亲和性逐列实测、2000 行 15789 ms 与 11 ms 的事务差别。下一章 [SQL 查询基础](/database/sql-basics) 写查询本身：`WHERE` 的三值逻辑为什么让你的 `<>` 漏掉整批行、`COUNT(*)` 与 `COUNT(col)` 为什么给出两个数、`GROUP BY` 之后 select 列里那个「裸列」到底是什么值、`LIKE` 的下划线怎么转义、`ON` 与 `WHERE` 写错位置怎么把 LEFT JOIN 变成 INNER JOIN——全部用同一套表实测。
