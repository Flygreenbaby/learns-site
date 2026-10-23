# 数据库（SQL / PostgreSQL）

<StatusBadge state="ready" note="13 章正文全部完成（第 13 章为阶段项目），可连续学习" />

## 这个领域解决什么问题

后端可以用内存存数据，但进程一重启就全没了；多个请求同时改一条数据，稍不注意就会互相覆盖。要让产品「数据不丢、并发不乱、查得够快、坏了能恢复」，你必须真正理解数据库——而不是把 SQL 当成 ORM 背后那层看不懂的黑盒。

具体的坑无处不在：

- 列表页翻到第 500 页时慢得要死 —— 因为你用了大偏移量的 `OFFSET` 分页，数据库要先扫过前面几万行再扔掉。
- 一个页面发出上百条 SQL —— 因为 ORM 的懒加载造成了 N+1 查询，而你根本不知道它偷偷发了多少条。
- 加了索引却没变快，甚至更慢 —— 因为索引建错了列，或者你的 `WHERE` 写法让索引用不上（对索引列做函数运算、隐式类型转换等都会导致索引失效）。
- 两个人同时给同一个账户扣款，余额算错了 —— 因为你没理解事务隔离级别，踩了「不可重复读」或「丢失更新」。
- 数据库崩了，你发现根本没有备份，或者备份从来没测试过能不能恢复 —— **没演练过恢复的备份等于没有备份。**
- 改了表结构直接在生产上执行，结果锁表几分钟、服务全挂 —— 因为你没有迁移和版本管理的概念。

这个领域要教会你的核心是：**关系模型、SQL、索引、事务这四件事的原理**。它们不随框架过时，是你能带着走一辈子的能力。ORM（Prisma / Drizzle）是提效工具，但它替代不了 SQL——恰恰相反，只有先懂 SQL 和数据库原理，你才看得懂 ORM 生成的查询为什么慢、什么时候该绕过它手写。

## 前置知识

**无强制前置。** SQL 是一门相对独立的语言，不依赖前面的任何编程领域即可开始学。

不过本站的学习路线**刻意把数据库放在[后端开发](/backend/)之后**（见[学习路线](/guide/roadmap)）。原因是：如果你先用 Fastify 写出返回内存数据的 API、理解了「数据访问层」要解决什么问题，再引入数据库，你会清楚地看到每张表、每条 SQL 是为了填补哪个具体的空白。反过来一上来只学 SQL 语法，很容易停在「会写 SELECT」的层面，不知道它在真实系统里扮演什么角色。所以：本领域没有硬性前置，但**建议先过一遍后端领域再来**。

## 章节目录

| 章节 | 内容 | 学完能做什么 |
| --- | --- | --- |
| [1. 关系模型与基础概念](/database/relational-model) | 表、行、列、主键、外键、约束；范式与反范式的取舍 | 理解关系数据库为什么这样组织数据，看懂表之间的关系 |
| [2. SQLite 入门](/database/sqlite-first) | 为什么 SQLite 适合理解原理和本地开发、它与服务型数据库的区别 | 零配置跑起一个数据库，把注意力放在 SQL 本身而不是运维上 |
| [3. SQL 查询基础](/database/sql-basics) | SELECT / WHERE / ORDER BY、JOIN 的各种类型、子查询、聚合与 GROUP BY | 能从多张表里查出你要的数据，看懂别人的 SQL |
| [4. SQL 查询进阶](/database/sql-advanced) | 窗口函数、CTE（WITH 子句）、复杂报表查询 | 写出排名、累计、同比这类用基础 SQL 很难表达的查询 |
| [5. 数据建模](/database/data-modeling) | 实体关系、一对多与多对多（中间表）、枚举与状态、软删除、时间戳、命名约定 | 为一个真实需求设计出结构清晰、可扩展的表 |
| [6. 索引](/database/indexes) | B-Tree 原理、复合索引、覆盖索引、索引失效的常见情形、用 EXPLAIN 看执行计划 | 判断一条慢查询慢在哪，建对索引让它真正变快 |
| [7. 事务与并发](/database/transactions) | ACID、四种隔离级别、脏读/不可重复读/幻读、锁与死锁、乐观锁 | 保证多步写操作要么全成功要么全回滚，并发下不出错 |
| [8. 迁移与版本管理](/database/migrations) | Prisma Migrate、迁移文件的作用、回滚、生产环境的安全迁移流程 | 让表结构的变更可追踪、可重放，改生产库不再心惊胆战 |
| [9. 备份与恢复](/database/backup-and-restore) | pg_dump 逻辑备份、物理备份与 PITR 概念、定时备份、恢复演练 | 建立一套「敢用」的备份策略，并真的把数据恢复出来验证过 |
| [10. PostgreSQL 进阶](/database/postgres-features) | JSONB、数组、全文检索、约束、扩展机制、用户与权限 | 用对 PostgreSQL 的特性，不把 JSONB 当万能垃圾桶 |
| [11. MySQL 差异对照](/database/mysql-differences) | PostgreSQL 与 MySQL 在类型、语法、行为上的主要差异 | 读得懂 MySQL 项目，迁移时知道哪些地方会踩坑 |
| [12. 数据访问设计](/database/data-access-design) | ORM 的能力边界、N+1 问题、分页策略（offset vs 游标）、批量操作 | 设计出既用 ORM 提效、又不在性能上翻车的数据访问层 |

## 学习顺序建议

**按 1 → 12 顺序学。前四章（模型、SQLite、SQL 基础与进阶）是整个领域的地基，不能跳。**

第 2 章用 SQLite 入门是有意为之：它零配置、无需安装服务，让你把全部精力放在 SQL 语义上，而不是被数据库的连接、权限、端口这些运维细节打断。等 SQL 手感建立起来，再切到第 5 章之后的 PostgreSQL 主线。

第 6 章（索引）和第 7 章（事务）是**从「会写 SQL」到「懂数据库」的分水岭**，也是最容易被跳过、日后最痛的两章。第 8 章迁移依赖第 5 章建模，第 9 章备份依赖你对 PostgreSQL 的基本操作。第 11 章 MySQL 对照和第 10 章进阶属于「拓宽视野」，可以在掌握主线后再看。第 12 章数据访问设计是收口——它把 SQL 知识和[后端领域](/backend/)的 ORM 实践连起来，务必在动手写过一些查询之后再学。

**再次强调：ORM 不能替代 SQL。** 第 12 章会讲 ORM 的边界，但前提是你已经能看懂它生成的每一条 SQL。

## 学习方法

**SQL 是练出来的，不是看出来的。** 每一章都建一张真实的表、灌入一批数据、亲手跑查询并观察结果。判断学会的标准：给你一个需求，你能不看示例直接写出正确的 SQL，并能解释执行计划。

**本地环境准备（Windows）：**

- **SQLite（第 2～4 章用）**：到 [sqlite.org](https://www.sqlite.org/docs.html) 下载 Windows 预编译命令行工具，解压后得到一个可执行文件，直接对着一个 `.db` 文件就能练 SQL，零安装。VS Code 也有 SQLite 浏览插件可以看表和数据。
- **PostgreSQL（第 5 章起的主线）**，两种方式任选：
  - **Docker（推荐，最干净）**：装好 Docker Desktop for Windows 后，用容器跑 PostgreSQL，用完即删，不污染系统。这与本项目后续的容器化部署路线一致，可参考 [Docker Compose 文档](https://docs.docker.com/compose/)。
  - **原生安装**：从 postgresql.org 的 Windows 下载页获取安装程序（由 EnterpriseDB 提供），一路下一步即可，安装时会让你设置超级用户密码并默认监听 5432 端口。
- **客户端工具**：安装 PostgreSQL 时通常会带上 `psql`（命令行）和 pgAdmin（图形界面）。也可以用 DBeaver 这类通用数据库客户端，或 VS Code 的数据库插件。练手阶段推荐 `psql`，它让你更贴近 SQL 本身。
- **ORM**：Prisma 作为主线（`npm install prisma` 及其客户端），Drizzle 作对照。但**前四章请先纯手写 SQL**，不要一开始就躲在 ORM 后面。

## 阶段项目

**为一个真实应用设计并落地完整的数据层**：延续[后端领域](/backend/)阶段项目的多用户资源管理 API，把它从内存数据切换成 PostgreSQL 持久化（或独立设计一个如博客、电商的库）。验收标准：

- 有一份 Prisma Schema（或等价的建表迁移），正确建模用户、资源，以及至少一个多对多关系（用中间表）。
- 迁移文件纳入版本管理，能在一个**全新的空数据库**上从零重放出完整结构。
- 关键查询列建有合适的索引，并用 `EXPLAIN` 证明这些查询确实用到了索引；至少演示一次「加索引前 vs 加索引后」的对比。
- 至少一处多步写操作用事务包裹，并演示出错时能整体回滚。
- 有一个数据种子（seed）脚本，能一键灌入测试数据。
- 用 `pg_dump` 备份数据库，再把它恢复到一个全新实例，**并写下这次恢复演练的步骤和结果**——备份不算完成，恢复成功才算。

## 官方文档与延伸阅读

本站所有内容均为中文原创讲解，以下官方资料用于查证与深入：

- [PostgreSQL 官方文档（current）](https://www.postgresql.org/docs/current/index.html) —— 主线数据库的权威手册。
- [PostgreSQL 教程章节](https://www.postgresql.org/docs/current/tutorial.html) —— 官方入门，适合第一次接触。
- [SELECT 语句文档](https://www.postgresql.org/docs/current/sql-select.html) —— 第 3、4 章查询语法的最终依据。
- [索引文档](https://www.postgresql.org/docs/current/indexes.html) 与 [CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html)、[EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html) —— 第 6 章索引与执行计划。
- [事务隔离级别](https://www.postgresql.org/docs/current/transaction-iso.html) 与 [显式加锁](https://www.postgresql.org/docs/current/explicit-locking.html) —— 第 7 章事务与并发的核心。
- [JSON 类型（JSONB）](https://www.postgresql.org/docs/current/datatype-json.html) —— 第 10 章进阶特性。
- [pg_dump 文档](https://www.postgresql.org/docs/current/app-pgdump.html) —— 第 9 章逻辑备份的工具依据。
- [SQLite 官方文档](https://www.sqlite.org/docs.html) —— 第 2 章入门；另见 [SQLite 适用场景](https://www.sqlite.org/whentouse.html) 与 [SQL 语法](https://www.sqlite.org/lang.html)。
- [Prisma 文档](https://www.prisma.io/docs) —— 主线 ORM；重点看 [Schema](https://www.prisma.io/docs/orm/prisma-schema)、[Client](https://www.prisma.io/docs/orm/prisma-client) 与 [Migrate](https://www.prisma.io/docs/orm/prisma-migrate)（第 8 章迁移）。
- [Drizzle ORM 文档](https://orm.drizzle.team/docs/overview) —— 作为 Prisma 的对照。
- [MySQL 官方文档](https://dev.mysql.com/doc/) —— 第 11 章差异对照时查阅。

## 版本说明

本领域内容以 **PostgreSQL 官方文档 `current` 版本** 为准编写，核实时间为 2026 年 10 月。PostgreSQL 每年发布一个大版本，`current` 始终指向最新稳定版；SQL 标准和核心概念（关系模型、事务、索引原理）非常稳定，跨版本变化很小。Prisma 与 Drizzle 的具体 API 请以 [Prisma 文档](https://www.prisma.io/docs) 和 [Drizzle 文档](https://orm.drizzle.team/docs/overview) 的最新稳定版为准，本站不锁定其小版本号。

容易过时、需重点核对的部分：

- **ORM 的 API 与 Schema 写法**：Prisma、Drizzle 迭代较快，配置项和查询方法可能随版本变化，第 8、12 章涉及的示例请以官方最新文档核对。
- **PostgreSQL 新特性**：新版本会引入新的类型、函数和索引方法，第 10 章的进阶特性请以你实际运行的版本文档为准。
- **客户端与安装方式**：数据库客户端工具（pgAdmin、DBeaver 等）的界面和功能更新频繁，正文只讲通用操作，不锁定某个具体版本的外观。
