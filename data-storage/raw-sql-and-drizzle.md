# 原始 SQL、Drizzle 对照与类型安全的边界：编译器拦得住列名，拦不住「不报错也不排序」

第一段代码上线三年没出过事。它写着 `SELECT * FROM orders`，然后把结果直接喂给一个类型是 `Order` 的变量。第四年有人把 `amount` 改名成 `amount_cents`，接口没报错，页面显示一片空白，钱没了。类型检查通过，测试通过，因为那份类型是人手写的 `as Order`。

第二段代码是我自己写的，用来演示「ORM 到底有没有用」。我想让排序列可配置，于是写成 `ORDER BY ?` 把列名当参数传进去。**它不报错，也不排序**——数据库把你传的 `'title'` 当成一个常量字符串，于是每一行的排序键都相同，结果退化成「按存储顺序返回」。前端看到的是「排序功能时好时坏」，日志里一个错误都没有。

第三段更常见：团队从 Prisma 迁到 Drizzle，或者反过来，理由通常是「类型安全」。迁完之后同一句 SQL 该慢还是慢，该 N+1 还是 N+1，只是报错从运行期挪到了编译期——而运行期那半边的坑一个都没少。

这一章就是把这条边界画清楚：**类型层能保证什么、保证不了什么，绕开 ORM 写原始 SQL 的正门有哪三条，以及那三条正门各自要配什么纪律才不至于变成第 2 段那种事故。**

<Callout type="verified" title="本章的两组实测：tsc 真跑 + node:sqlite 真库">

环境：Windows + Node v25.4.0。两组证据都是本机真跑：

一、**类型层**用站点已有的 TypeScript 5.9.3（`node_modules/typescript/bin/tsc`），对三个文件跑 `--strict`。文件在 `data-storage/.scratch/ds-ts/`：`caught.ts`、`raw.ts` 里放了 5 处故意的错，`slips.ts` 里放了 4 处「错了但类型看不见」的写法。真实结果是 **5 条报错、全部来自前两个文件；`slips.ts` 零报错**。本章引用的每一条 tsc 消息都是原样粘贴，没有转述。

二、**运行期**用 `node:sqlite` 真库，脚本 `data-storage/.scratch/ds-sqlraw.mjs`：注入、标识符位绑定、列改名、TEXT 列里的数字、NULL 语义、LIKE 的大小写折叠、超大整数、驱动交回的对象形状。报错文本与返回行数都照抄。

本机**没有安装 `prisma` / `@prisma/client` / `drizzle-orm` / `pg`**，本章没有运行过任何一行 ORM 代码。凡是涉及这两个库的 API 名、写法、类型工具的部分，一律标为预期形态，动手前以官方文档当前版本复核。

</Callout>

## 类型层拦得住的五件事：tsc 的报错原文

先给它应得的功劳。下面 5 条是 `tsc --strict` 真报出来的，逐字照抄：

```text
data-storage/.scratch/ds-ts/caught.ts(5,12): error TS2551: Property 'tital' does not exist on type 'Post'. Did you mean 'title'?
data-storage/.scratch/ds-ts/caught.ts(10,10): error TS18047: 'p.body' is possibly 'null'.
data-storage/.scratch/ds-ts/caught.ts(14,44): error TS2561: Object literal may only specify known properties, but 'autherId' does not exist in type '{ authorId?: number | undefined; title?: string | undefined; }'. Did you mean to write 'authorId'?
data-storage/.scratch/ds-ts/caught.ts(18,40): error TS2739: Type 'Post[]' is missing the following properties from type 'Post': id, title, body, authorId
data-storage/.scratch/ds-ts/raw.ts(5,10): error TS18046: 'rawRow.n' is of type 'unknown'.
```

这五条各自对应一类真实事故，值得分开看它拦住的到底是什么：

| 报错 | 拦住的东西 | 为什么值得 |
| --- | --- | --- |
| TS2551 | 列名 / 字段名拼错 | 改列名时全部调用点同时飘红，这是重构的唯一保险 |
| TS18047 | 把可空列当非空用 | 数据库里的 `NULL` 和 TS 里的 `undefined` 不是一回事，可空性必须显式处理 |
| TS2561 | 查询参数字面量里的字段名拼错 | 「ORM 的参数对象也受类型保护」这条最常见的宣传点，实测成立 |
| TS2739 | 把一对多关系当一对一用 | 形状错在编译期就暴露，而不是渲染时 `[object Object]` |
| TS18046 | 未类型化的行不做窄化就用 | 逼你在边界处写 `Number(...)` 或映射函数，把「猜类型」变成显式动作 |

最后一条特别值得说：它拦的不是「你用错了」，而是「你不许不声明就用」。`Record<string, unknown>` 是原始 SQL 结果最诚实的类型，TS 强制你在这里做一次转换——**转换点就是数据的审计点**。

## 类型层一声不响放过去的四种写法

同一个 `tsc` 命令，`slips.ts` 里那 4 处写法**一条报错都没有**。这才是「类型安全」这句话的真实边界。

```ts
// S1 双重断言：把未类型的行强行说成 Post
function s1(row: Record<string, unknown>) {
  const p = row as unknown as Post;
  const title: string = p.title;
  return title.toUpperCase();
}

// S2 手写泛型：调用者声称返回 { n: number }，SQL 实际返回的是字符串
const s2 = queryRaw<{ n: number }>('SELECT v AS n FROM kv').map((r) => r.n + 1);

// S3 SQL 字符串里的标识符：类型系统看不见字符串内容
const orderCol = 'tital';
const s3 = queryRaw<Post>('SELECT * FROM posts ORDER BY ' + orderCol);

// S4 排序键联合与行类型各写各的：union 里有 'createdAt'，Post 里根本没有这一列
const s4key: PostOrderBy = 'createdAt';
```

四条在运行期各自的真实后果，都在真库上量出来了：

```text
=== T3 列改名之后：类型层没报错，运行期才炸（对应 S1）===
改名前 row= {"id":10,"title":"zeta"}
改列名 + 忘了 AS：读到的 title= undefined
补上 AS 之后= {"id":10,"title":"zeta"}

=== T4 TEXT 列里的数字：v + 1 得到的是字符串（对应 S2）===
typeof v= "string"
v + 1 = "71"
Number(v) + 1 = 8
SQL 侧 CAST= 8

=== T5 SQL 字符串里的拼写错误：报错来自数据库，不来自编译器（对应 S3）===
ORDER BY tital 报错= "no such column: tital | errcode=1"
SELECT titel 报错= "no such column: titel"
参数多了报错= "column index out of range"
```

S1 的教训是**断言就是关掉检查**：`as unknown as T` 让编译器闭嘴，运行期 `title` 是 `undefined`，`undefined.toUpperCase()` 抛 TypeError——或者更糟，它不抛，只是永远拿到 `undefined`（第一段代码的空白页面就是这个形状）。S2 的教训是**泛型参数是你对数据库的承诺，不是数据库的声明**：`v` 是 TEXT 列，`'7' + 1` 得到字符串 `"71"`，前端把 71 条订单显示成 `"71"` 还好，把 `"7" + "1"` 当数字求和就是钱算错。S4 的教训是**类型层自己会漂移**：`PostOrderBy` 那个联合是人手写的，它和行类型没有任何机制绑定，加了列忘了改 union（或反过来）编译器全程沉默。

还有一类根本不在类型管辖范围内，本章第 10 章已经用真库证过：类型系统看不见 SQL 条数（N+1）、看不见执行计划（`SCAN`）、看不见 `LIMIT` 数的是行还是资源。**41 条语句的代码可以完全类型正确。**

## 注入的真相：能绑的是值，不能绑的是标识符

「用参数化查询防注入」这句话每个人都背，但它有一个不告诉你的前提：**参数位只能放值**。先给实测：

```text
=== T1 拼接 vs 参数绑定：同一份恶意输入的真实后果 ===
拼接（返回行数）= 3
绑定（返回行数）= 0
数字位拼接= [10,11,12]
标识符位绑定= [{"title":"zeta"},{"title":"beta"}]

=== T2 ORDER BY 绑不上：参数只会变成常量，白名单才管用 ===
ORDER BY ? 的实际顺序= ["zeta","beta"]
白名单拼标识符的顺序= ["beta","zeta"]
库里真实顺序= ["zeta","beta","Gamma"]
```

四行信息量很大：

1. `"' OR '1'='1"` 拼进字符串位，条件恒真，库里 **3 行全出来**；同一个输入走绑定，**0 行**——它老老实实当字符串比较。这是参数化真正做的事：改变的是**语法角色**，不是转义。
2. **数字位拼接是同一扇门**。`WHERE id = 1 OR 1=1` 不需要任何引号就能绕过条件，而很多人只在「字符串参数」上做转义。
3. `ORDER BY ?` 绑列名：**不报错**，返回 `["zeta","beta"]`——就是插入顺序，`["beta","zeta"]` 才是排过序的。第 2 段代码的事故原文就在这里。
4. 所以标识符只能白名单拼接。白名单的正确写法是**校验后拼**，不是转义后拼：

```ts
// 可运行：把可排序列收成一份显式映射，未命中就抛错，绝不进 SQL 字符串
const SORTABLE: Record<string, string> = { title: 'p.title', id: 'p.id', createdAt: 'p.created_at' };

function orderSql(key: string): string {
  const col = SORTABLE[key];
  if (!col) throw new Error(`unsupported sort key: ${key}`);
  return `ORDER BY ${col}`;
}
```

映射表比正则校验（`/^[a-z_]+$/`）更可靠，因为它同时解决了「列名与前端字段的翻译」，而正则只挡住注入、挡不住 `no such column`。

<Callout type="warn" title="ORM 的参数对象不是 SQL 字符串：它有自己的注入面">

用 ORM 不等于免疫。三个真实入口：`$queryRaw` / `sql` 片段里手拼字符串（本章的 T1/T2 全部适用）、`orderBy` 里传数组时字段来源未校验、以及 `where` 里的操作符对象直接被 `JSON.parse` 自用户输入（`{ "password": { "ne": null } }` 这类形状会把条件从「等于」变成「不等于」）。**判据：任何从请求体来的对象，不要原样当查询参数展开。**

</Callout>

## 原始 SQL 的正门只有三条

绕开 ORM 是对的，但要绕得有名目。三条正门，每条都有「ORM 那条路走不通」的具体理由：

**正门一：数据库才有的表达能力。** 窗口函数、CTE、`LATERAL`、`RETURNING`、全文检索、地理类型、`jsonb` 聚合。这类需求硬用 ORM 拼，结果通常是 N 次查询在内存里手工 join——你重新实现了一个更差的执行器。本站[数据库第 4 章 窗口函数与 CTE](/database/sql-advanced) 讲的正是这一类。

**正门二：批量写。** 一条 `INSERT ... ON CONFLICT` 或 `UPDATE ... WHERE` 完成上千行的幂等写入。第 10 章的 R4 已经证过冲突更新能带守卫条件，这是「用一条语句完成并发裁决」的标准位置。ORM 的逐行 `update` 在这里是 1000 次往返。

**正门三：报表与聚合。** 一张按天分组的统计表，正确的形状就是一条带 `GROUP BY` 的查询；用 ORM 做等价物要先把明细全取回内存。

三条之外的「我就是懒得学 ORM 的 API」，不叫正门，叫债。

## 原始 SQL 交回来的行：驱动层的六个坑

这三节是本章最该抄进 code review checklist 的部分，全部有实测数字。

```text
=== T6 NULL 的三种语义陷阱（都在真库上数出来）===
总行数= 3
v IS NULL 的行= [11,12]
v <> '7' 返回的行（NULL 行不在里面）= []
COUNT(v) 只数非 NULL= 1
SUM 一个全 NULL 列= null
LIKE 大小写：ASCII beta/BETA= "1 带重音 Ä/ä=0"
CASE 比较中文= 1

=== T7 驱动交回来的对象本身 ===
row= {"id":10,"title":"zeta","missing":null}
原型是 null？= true
hasOwnProperty missing= true
JSON.stringify= "{\"id\":10,\"title\":\"zeta\",\"missing\":null}"
超过安全整数的列直接读= "抛错: Value is too large to be represented as a JavaScript number: 9007199254740993 | code=ERR_OUT_OF_RANGE"
语句级 setReadBigInts(true) 后= {"type":"bigint","value":"9007199254740993"}
把它当字符串读出来= "9007199254740993"
JSON.stringify 一个大整数= "{\"n\":9007199254740992}"
```

**坑一：`<>` 不等于「不是」。** 表里 3 行，2 行的 `v` 是 NULL，`WHERE v <> '7'` 返回 **0 行**（不是 2 行）。SQL 的三值逻辑里 `NULL <> '7'` 是 `unknown`，`WHERE` 只留 `true`。要「不等于或为空」得写 `WHERE v <> '7' OR v IS NULL`。ORM 里的 `not` 过滤器同样落在 `<>` 上（预期，未在本机验证），所以「过滤掉状态为 draft 的订单」这类需求，凡是 `status` 可为空就必须显式加 `OR IS NULL`——这是一个能安静吃掉数据的坑。

**坑二：`COUNT(*)` 与 `COUNT(col)` 差的是 NULL 行。** 实测 `总行数=3`、`COUNT(v)=1`。做「已填写率」统计时这两个数正好是分子和分母；反过来，你以为统计的是行数、实际统计的是非空数，报表就差 3 倍。

**坑三：聚合遇空集给 `null` 不是 0。** `SUM` 全 NULL 时实测是 `null`，`JSON.stringify` 出去是 `null`，前端 `sum + 1` 变字符串拼接或者 NaN。`COALESCE(SUM(x), 0)` 是这类代码的标配。

**坑四：LIKE 只对 ASCII 折叠大小写。** `'beta' LIKE 'BETA'` 是 1，但 `'Ä' LIKE 'ä'` 是 **0**。中文本身没大小写所以 `'阿力' = '阿力'` 恒真，但带变音符的姓名、日文片假名全角半角这类数据会命中不了。所以「搜索不区分大小写」在 SQLite 上的正确做法是 `COLLATE NOCASE`（它同样只管 ASCII，官方文档写明）或者把搜索键单独存一列小写归一化值；PostgreSQL 上是 `ILIKE` 或 `citext`（未在本机验证，以官方文档为准）。**「用户搜不到自己刚输入的词」是数据问题，不是缓存问题。**

**坑五：int64 主键会直接抛，或者悄悄丢精度。** 实测 `9007199254740993` 在 `node:sqlite` 上读出来是 `RangeError [ERR_OUT_OF_RANGE]`；`setReadBigInts(true)` 之后拿到 `bigint`。而如果你把它当 number 走完全程，`JSON.stringify` 输出的实测是 `{"n":9007199254740992}`——最后一位被改了。雪花 id、Unix 纳秒、金额用「分」存的大整数都会撞上。**规则：id 与金额在边界处二选一——`bigint` 或字符串，不要 `number`。**

**坑六：驱动交回的行没有原型。** `Object.getPrototypeOf(row) === null` 实测为 `true`，同时 `SELECT NULL AS missing` 给的是 `{missing: null}`（键存在、值为 null）。两个后果：行对象没有 `toString`/`hasOwnProperty` 等原型方法（要判键存在得用 `Object.hasOwn`），以及 **`null` 与「字段不存在」是两件事**——`SELECT *` 时字段存在且为 null，改列名后字段不存在、读出来是 `undefined`。用 `?? null` 归一化能同时把两种情况压平，但会掩盖改名事故，所以更该做的是下一条：**别用 `SELECT *`**。

## 把原始 SQL 变成可维护的代码：四条纪律

一、**列白名单，永远不写 `SELECT *`。** 理由已经实测过：改名不报错，只是给你 `undefined`。白名单还有一个副作用——它让「接口返回字段」变成一次显式的评审动作。

二、**每条原始 SQL 有归属。** 收进 `queries/` 目录或 model 文件里，一条一个具名导出（`export const dailySalesByChannel = sql`...），带上「为什么不能用 ORM 写」的一句话注释。散落在 service 里的字符串拼接是第 2 段代码的温床。

三、**参数与标识符分离。** 所有值走绑定；所有标识符走 `SORTABLE` 这类映射表。写一条测试：给 `orderSql()` 传 `'title; DROP TABLE users'`，期望它抛错。这条测试比任何转义库都值钱。

四、**给每条 raw query 配一个形状断言。** 最省事的版本：启动或 CI 里对每条 raw query 跑一次 `LIMIT 0`，把返回列名与代码里那份类型字段列表比对。列改名会在这里变成一条明确报错，而不是页面上的空白：

```ts
// 结构示意：把「列漂移」在 CI 里抓出来（本机未接 CI，逻辑可跑但这条不是本章实测项）
const expectCols = ['id', 'title'];
const probe = await db.prepare('SELECT id, title FROM posts LIMIT 0').all();
const got = Object.keys(probe[0] ?? expectCols.reduce((a: any, c) => ({ ...a, [c]: null }), {}));
if (got.join() !== expectCols.join()) throw new Error(`column drift: ${got.join()} != ${expectCols.join()}`);
```

## Drizzle 对照：两种类型来源，形状差别在哪

先纠一处本站自己的口径。[数据库第 12 章](/database/data-access-design)里写过「Drizzle 官方明确写着它不是 ORM、没有 ORM 那些特性」。按 2026-10-19 能检索到的官方页面，这个说法已经过时：产品名现在就叫 **Drizzle ORM**，关系查询页面上写着的是另一句话——

> Drizzle ORM is designed to be a thin typed layer on top of SQL.
> Relational queries are meant to provide you with a great developer experience for querying nested relational data from an SQL database, avoiding multiple joins and complex data mappings.

（这段是从搜索结果的官方页面片段里拿到的原文，我**没有**用网页抓取工具逐字核对整页，措辞与完整性请在页面上复核。）

两家真正差别在**类型的来源**，这决定了它们各自会在哪里漂移：

| 维度 | Prisma 一系 | Drizzle 一系 |
| --- | --- | --- |
| 类型从哪来 | 从 schema 文件**代码生成**一个 client | 类型从表定义**直接推导**，没有生成步骤 |
| 生成/推导漏了会怎样 | 忘跑 generate → 类型是旧的，运行期照跑 | 表定义即唯一事实，没有「旧的生成物」这种东西 |
| 关系查询写法 | `include` / `select` 的嵌套参数 | `relations` 定义 + 查询侧 `with`（官方称 relational queries） |
| 想写复杂 SQL | `$queryRaw` / `$queryRawUnsafe`（预期，未验证拼写） | `db.select()...` 构造器 + `sql` 片段，构造器就是 SQL 形状 |
| 「不是 ORM」的负担 | 生成物体积、schema DSL 学习成本 | 你自己承担对象图组装与迁移管理工具链（drizzle-kit，预期） |

写法形状上的对照（**两段都是预期形态，本机没装任何一个，都不许当实测引用**）：

```ts
// Prisma 侧形态
const posts = await db.post.findMany({
  where: { author: { name: { contains: 'ali' } } },
  select: { title: true, author: { select: { name: true } } },
});

// Drizzle 侧形态：查询本身就是 SQL 的形状，join 由你写
const posts = await db
  .select({ title: posts.title, authorName: users.name })
  .from(posts)
  .innerJoin(users, eq(posts.authorId, users.id))
  .where(ilike(users.name, '%ali%'));
```

差别不在「谁更安全」，在**抽象层次放在哪一层**。Prisma 把关系加载的 SQL 形状藏在里面，你只能靠第 10 章那套方法（数语句、看列数）反推；Drizzle 让你直接看见形状，于是 `LIMIT` 数错行、扇出重复这些坑变成你自己的责任。两者对「类型系统看不见执行计划」这件事**都没有任何豁免**——这一句是本章唯一可以不加限定地讲的结论。

推导类型工具的名字（`$inferSelect` / `inferSelectModel` 这类）我同样标为**预期、未在本机验证**：这类 API 名在不同版本里变过，动手前查你装的版本的类型推导页面。

## 常见错误与排查

**1. `ORDER BY` 用了参数绑定。** 现象：不报错、不排序、"排序偶尔失效"。确认：把绑定列名那条与手写 `ORDER BY title` 那条各跑一次比顺序（本章 T2 实测是 `["zeta","beta"]` vs `["beta","zeta"]`）。修：标识符白名单映射后拼接，值仍然绑定。

**2. `SELECT *` + 列改名。** 现象：某个字段永远是 `undefined` 或空，接口 200。确认：打印 `Object.keys(row)` 与代码期望的字段列表比对（坑六）。修：列白名单 + 一条 `LIMIT 0` 的形状断言。

**3. 用 `<>` / `not` 过滤可空列。** 现象：数据莫名少了一批，而且是「本该包含 NULL 的那批」。确认：`SELECT COUNT(*)` 与 `WHERE v <> 'x'` 的行数差（实测 3 行里 0 行返回）。修：显式 `OR v IS NULL`，或者把「未填写」表达成哨兵值而不是 NULL。

**4. 金额或 id 用 number 存。** 现象：最后几位对不上，或读时 `RangeError`。确认：拿一个真实雪花 id 走一遍读→`JSON.stringify`（实测 9007199254740993 → `...992`）。修：`bigint` / 字符串，序列化前显式转换；接口契约里写明它是字符串。

**5. 搜索大小写「不敏感」只对英文成立。** 现象：带变音符或全角的关键词搜不到。确认：`'Ä' LIKE 'ä'` 实测 0。修：入库时另存归一化搜索键（小写 + NFKC），或按库选择正确折叠方案（PostgreSQL 用 `ILIKE`/`citext`，未在本机验证）。

**6. `as` / 泛型当类型来源。** 现象：编译全绿、运行期 `undefined.toUpperCase` 或字符串加法。确认：全局搜 `as unknown as` 与 `queryRaw<` ——每一处都是你自己签的字，需要一条运行时窄化背书。修：边界处写显式映射函数（`raw.ts` 里那个 `narrowed()` 形状），把 `unknown` 转成行类型。

**7. 把 ORM 参数对象直接展开自请求体。** 现象：登录接口能被 `{ "ne": null }` 这类操作符形状绕过。确认：给接口传一个嵌套对象而不是字符串，看它是否改变了 SQL 语义。修：入参用 schema 校验（zod 之类，或直接白名单挑字段），只把标量放进查询参数。

## 练习

<Exercise title="练习 1 · 亲手做出「不报错也不排序」" difficulty="挑战">

在你本机任意一个 SQLite 库里（`node:sqlite` 就能起手）写两条查询：第一条 `SELECT title FROM posts WHERE user_id = ? ORDER BY ?`，把列名字符串当第二个参数绑进去；第二条把列名白名单校验后直接拼进 SQL。同一份数据，比较两者的返回顺序，并回答：(1) 第一条为什么不报错？(2) 什么样的输入能让第二条同时具备注入风险？(3) 你怎么在 CI 里让第 (2) 问那种输入永远进不去？

<template #answer>

(1) 参数位在语法上是**表达式**位置，不是标识符位置。`ORDER BY 'title'` 是合法表达式，每行都求值为同一个常量字符串，所以排序键相同、数据库按扫描顺序返回——本章 T2 实测：绑定版 `["zeta","beta"]`（就是插入顺序），白名单版 `["beta","zeta"]`。(2) 如果你的白名单退化成「只校验正则 `^[A-Za-z_]+$` 就拼进去」，注入确实进不来，但 `no such column` 进得来（T5 实测原文 `no such column: tital`）；真正危险的是「转义后拼接」而不是「校验后拼接」——凡是你开始给标识符加引号转义，就说明这条路已经偏了。(3) CI 里加一条表驱动测试：`SORTABLE` 映射的键集合 = 前端可传的排序字段枚举，两边取 diff；再对 `orderSql()` 打一批非法输入（含 `'title; DROP TABLE users'`、`'tital'`、`''`、`null`）断言全部抛错。这条测试同时挡住注入和列名漂移。

</template>

</Exercise>

<Exercise title="练习 2 · 数一数类型层到底拦了多少" difficulty="进阶">

把本章 `caught.ts` 的 5 条 tsc 报错与 `slips.ts` 的 4 条零报错并排列成一张表，为每一行填上「它在真实项目里的事故表现」和「兜住它的手段」。要求至少有一行的手段是「数据库自己兜」而不是「你多写代码」。

<template #answer>

拦住的 5 行：TS2551 列名拼错 → 重构无保险（手段：生成类型 + 改名飘红）；TS18047 可空列当非空 → `undefined.length` 崩溃（手段：`strictNullChecks`）；TS2561 参数字段名拼错 → 过滤条件静默失效、返回全量数据（手段：字面量多余属性检查）；TS2739 关系形状错 → 前端 `[object Object]`（手段：推导嵌套返回类型）；TS18046 未窄化的 `unknown` → 隐式字符串拼接（手段：强制边界转换）。放过的 4 行：S1 `as unknown as` → 列改名后 `undefined`（兜法：列白名单 + `LIMIT 0` 形状断言）；S2 手写泛型 → `'7' + 1 = "71"`（**兜法：库里把列声明成 INTEGER**，别在 JS 里补 `Number()`——这就是「数据库自己兜」那一行，SQLite 的亲和性会存成数字，实测 `typeof v` 才可信）；S3 SQL 字符串里的拼写 → `no such column` 抛在运行期（兜法：raw query 集中归属 + 单测覆盖每条 SQL 至少执行一次）；S4 union 与行类型漂移 → 排序字段时有时无（兜法：由行类型反向生成 union，`Object.keys` 派生而不是手写）。最后一列写下来你会发现一个规律：**类型层拦的是「你写的代码」，拦不住的是「你写的字符串」和「库里实际存了什么」。**

</template>

</Exercise>

<Exercise title="练习 3 · 该不该绕过 ORM" difficulty="基础">

四个需求，各判断「ORM 正路 / 原始 SQL 正门哪一条 / 都不该」，并给一句理由：(a) 按渠道统计最近 30 天每日销售额，需要 `ROW_NUMBER()` 排名；(b) 把 8000 行 CSV 幂等导入；(c) 根据用户点击的表头字段排序一个列表；(d) 更新库存：`stock = stock - n` 且不能超卖。

<template #answer>

(a) 正门一（数据库表达能力）：窗口函数 + CTE 硬用 ORM 拼会变成把明细全取回内存。(b) 正门二（批量写）：一条 `INSERT ... ON CONFLICT`，第 10 章 R4 证过冲突处理能带守卫，`changes` 还能当幂等凭据。(c) **两条都不该**——这是标识符问题不是抽象层次问题：ORM 的 `orderBy` 也要白名单，raw 也要白名单，先把枚举定下来再选写法。(d) 正门二/条件更新的极简形态：`UPDATE ... SET stock = stock - n WHERE id = ? AND stock >= n`，看 `changes` 判成败；这是[第 9 章](/data-storage/distributed-lock)「能用条件更新就别用外置锁」的落点，与 ORM 无关——ORM 里也能写这个相对更新，重点是别先读后写。

</template>

</Exercise>

## 官方文档与延伸阅读

- [TypeScript · 严格编译选项](https://www.typescriptlang.org/tsconfig) —— 核实 `strictNullChecks`（本章 TS18047 的来源）与 `strict` 家族各自开启哪些检查；本章 5 条报错是在 `--strict` 下产生的，去掉 strict 结果会不同，动手前先确认你的 tsconfig。
- [Drizzle ORM · Relational queries / Drizzle Queries](https://orm.drizzle.team/docs/rqb-v2) —— 核实「thin typed layer on top of SQL」这句话、`relations` + `with` 的当前写法与适用版本提示，对应「Drizzle 对照」一节的两段预期代码。
- [Drizzle ORM 仓库](https://github.com/drizzle-team/drizzle-orm) —— 类型推导工具名（`$inferSelect` 一类）在不同版本里变过，以该仓库与你安装版本的 README 为准。
- [Prisma 文档 · Prisma Client](https://www.prisma.io/docs/orm/prisma-client) —— 从这里进 raw queries / `include` / `select` 的当前页面，用于核实本章标为预期的 Prisma 写法与 `$queryRaw` 系列拼写。
- [SQLite 官方文档 · LIKE 与表达式](https://www.sqlite.org/lang_expr.html) —— 核实 `LIKE` 默认只对 ASCII 做大小写折叠、`COLLATE NOCASE` 的实际覆盖范围，对应坑四的实测 `'Ä' LIKE 'ä' = 0`。
- [SQLite 官方文档 · 外键](https://www.sqlite.org/foreignkeys.html) —— 核实「外键约束是连接级开关、默认关闭」，与本章 R3（第 10 章）里 `node:sqlite` 读到 1 的实测对照，说明为什么不能拿别的驱动的默认值当你的默认值。
- [PostgreSQL 文档](https://www.postgresql.org/docs/current/) —— 主入口，本章只用到 `ILIKE` / `citext` 与三值逻辑这类结论，标为未在本机验证，按需从该入口查当前页。
- 站内：[数据访问设计：N+1、分页与抽象泄露](/database/data-access-design)（本章是它的「类型机制本身」续篇）、[SQL 查询进阶：窗口函数与 CTE](/database/sql-advanced)、[迁移与版本管理](/database/migrations)、[Prisma 深入：关系查询与事务](/data-storage/prisma-deep-dive)。

## 下一章

这一章把「类型安全」这句话拆成了可验证的两半：tsc 真拦下的 5 类错和真放过的 4 类写法，加上原始 SQL 交回来的行里那六个坑。有一条结论贯穿始终——**编译器管得住你写的代码，管不住你写的字符串，也管不住库里实际存了什么**。所以最后剩下的那类问题只能靠时间和观测来抓：一条查询慢在数据库里，一次等待慢在连接池排队上，而这两件事在代码里长得一模一样。下一章就是这套定位流程：[连接池与慢查询定位](/data-storage/connection-pool-and-slow-query)，那边有池大小的排队实测、泄漏的表现形状，以及执行计划原文怎么读。
