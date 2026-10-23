# 备份与恢复：复制文件会丢数据，没演练过的备份等于没有备份

线上只有一个 `.db` 文件，你觉得备份太简单了：`copy app.db app.db.bak`，放进 cron，跑了一个月很稳。第一次真出事时你拿这个备份恢复，`integrity_check` 返回 `ok`，但业务表一张都不在 —— 报的是 `no such table`。检查通过、文件完整、数据没有，这三件事同时成立，是本章最阴的一个坑，而且是本机跑出来的。

另一半的故事发生在关系库上：备份任务在写入高峰被一个长事务挡住，`-wal` 一直不缩；或者 `pg_dump` 拷走了表数据却漏了序列当前值，恢复出来的应用一插入就撞主键。**备份是一个动作，恢复是一次工程**，差别在于你有没有把「恢复出来并且对得上账」这一步真的做过。

前置：[事务与并发](/database/transactions)（WAL、检查点、长事务）、[迁移与版本管理](/database/migrations)（改坏结构之后，备份是你唯一的后退路径）。本章 SQLite 部分全部在 `node:sqlite` 上真跑，PostgreSQL / MySQL 部分本机没有服务，一律标注未验证。

## 为什么直接复制 .db 不安全

一个 SQLite 数据库在磁盘上不只有一个文件。开了 WAL 之后是三个：

```text
app.db          主数据库文件
app.db-wal      预写日志：还没回写进主文件的页
app.db-shm      索引 WAL 的共享内存表，纯运行时产物
```

写事务提交时页先进 `-wal`，攒够了或没人读旧快照时才检查点回写主文件。于是「复制主文件」这件事的语义是：**你拷走的是一个可能落后于最后一次提交的镜像**。本机实测一个只插入过 1 行的 WAL 库：

```text
journal_mode = wal
主文件字节 = 4096   WAL 字节 = 12392
只拷主文件 -> 查询结果 = ERROR: no such table: t
只拷主文件 -> integrity_check = [{"integrity_check":"ok"}]
主文件+WAL -> 行数 = 1
```

连 `CREATE TABLE` 都还停在 WAL 里，主文件仍是空库的头，所以它「完好」且「什么都不是」。数据量上去之后差距更夸张：500 行自动提交的插入，主文件 4096 字节，`-wal` 涨到 2080632 字节 —— 备份拷走 4 KB，真身在 2 MB 那个文件里。

回滚日志模式（`journal_mode=delete`，默认）看着更安全，也不是没问题。实测在事务中途复制：

```text
journal_mode = delete
主文件字节= 8192   -journal 字节= 4616
只拷主文件(未提交中) -> 行数 = 2      （第 3 行在 journal 里，未被拷到，也没提交）
回滚后原库行数 = 2
```

未提交的行确实没进来 —— 这一点符合预期。但要注意复制的时机：如果复制发生在提交过程中（旧日志还没删），你拿到的是**页级撕裂**的镜像，某些页是新值、某些是旧值。文件系统复制不提供事务边界，SQLite 也不会在你 `copy` 时暂停写入。正确做法是让数据库自己产快照，见下一节。

## 让数据库自己出快照：三种正确做法

| 手段 | 是否要求停写 | 产物 | 本机状态 |
| --- | --- | --- | --- |
| `VACUUM INTO '路径'` | 不停写，只读事务级一致 | 单个 `.db`，已整理、无空洞 | 已实测 |
| 在线备份 API（`sqlite3_backup` / `node:sqlite` 的 `backup()`） | 不停写，逐页复制并处理锁 | 单个 `.db`，继承源库的 journal_mode | 已实测 |
| `.backup` / `.dump`（sqlite3 命令行） | 不停写（内部走备份 API） | `.backup` 出文件，`.dump` 出 SQL 文本 | **未在本机验证**（本机没装 sqlite3 CLI） |

`VACUUM INTO` 是日常最省心的：一条语句、一个文件、顺带把碎片整理掉。实测：

```text
源库字节 = 4096   wal 字节 = 2080632
VACUUM INTO 耗时 ms = 9
产物字节 = 16384  产物 -wal 存在? false
产物 journal_mode = delete
产物 行数= 500  integrity= ok
目标已存在 -> ERROR: output file already exists
```

三条要记住的结论：产物**只有一个文件**、`journal_mode` 变回 `delete`（备份自带 WAL 没意义，这是设计如此，不是丢了配置）、目标文件必须不存在，脚本里要先删或带时间戳命名，否则第二次备份直接报错退出。

在线备份 API 在 `node:sqlite` 里是顶层导出的 `backup()`，它**返回 Promise**：

```js
import { DatabaseSync, backup } from 'node:sqlite';
const src = new DatabaseSync('data/app.db');
await backup(src, 'backup/app-2026-10-18.db');   // 不 await 就是 0 字节
src.close();
```

实测这一步返回 `object (Promise)`，`await` 之后产物 16384 字节；它的 `journal_mode` 是 `wal` —— 与 `VACUUM INTO` 不同，备份 API 会保留源库设置。这是个真实差异，别假设两条路出来的库一模一样。把 `await` 去掉的坑很常见：函数立刻返回，复制还在后台进行，你的归档脚本已经把 0 字节文件传走了。

`.dump` 值得单独说一句：它导出的是 SQL 文本，恢复时重新执行，能跨版本、能人工审、能顺手改表名；代价是丢掉了 `PRAGMA` 设置、`-wal`、以及所有不是「表数据」的东西（比如你自己塞在文件旁边的附件）。**结构靠迁移、数据靠备份**，不要拿 `.dump` 当备份的主力。

<Callout type="verified" title="本章实测环境与方法">

Node v25.4.0（内置 `node:sqlite`，SQLite 3.51.1，实验性模块）+ Windows 本地磁盘，日期 2026-10-18。方法：用 `node:sqlite` 建库并开 WAL，保持连接不关闭，用 `fs.copyFileSync` 模拟「直接复制」，再用另一个只读连接打开复制品观察结果；`VACUUM INTO`、`backup()`、`PRAGMA wal_checkpoint(...)`、`PRAGMA integrity_check` 全部逐条执行并记录原始输出。文中所有 `text` / `js` 代码块里的数字都来自这些运行结果。sqlite3 命令行的 `.backup`、PostgreSQL 的 `pg_dump` / `pg_restore`、MySQL 的 `mysqldump` 本机没有可连接的实例，一律标注「未在本机验证」，其结论来自官方文档。

</Callout>

## 检查点：看得懂 -wal，才知道备份里有什么

WAL 不会自己变小，回写主文件的动作叫检查点（checkpoint）。默认阈值 `wal_autocheckpoint = 1000`（页，实测这个值）。手动触发用 `PRAGMA wal_checkpoint(模式)`，四个模式差在「挡住时是等着还是马上回来」：

| 模式 | 被读者挡住时的行为 |
| --- | --- |
| `PASSIVE` | 立刻返回，尽力而为，不报错（默认） |
| `FULL` | 等所有页回写完；有读者占着旧快照则返回 busy=1 |
| `RESTART` | 同 `FULL`，但会阻止新读者进入旧快照 |
| `TRUNCATE` | 回写完再把 `-wal` 文件截成 0 字节 |

返回的三个数是 `(busy, log, checkpointed)`，单位是 WAL 帧。本机实测：一个连接持有旧快照的读事务，另一连接写入并提交 1500 行之后：

```text
提交后 wal 字节 = 28872
passive  -> {"busy":0,"log":7,"checkpointed":0}
FULL     -> {"busy":1,"log":7,"checkpointed":0}
RESTART  -> {"busy":1,"log":7,"checkpointed":0}
TRUNCATE -> {"busy":1,"log":7,"checkpointed":0}
此时 wal 字节 = 28872
读者结束后 TRUNCATE -> {"busy":0,"log":0,"checkpointed":0}
此时 wal 字节 = 0
```

`log=7` 表示 WAL 里有 7 帧待回写，`checkpointed=0` 表示一帧都没回写进去 —— 被那个旧快照读者挡住了。注意 `passive` 的 `busy` 也是 0：它「成功返回」却什么都没做，这就是为什么监控里不能只看有没有报错，要看 `checkpointed` 有没有跟上 `log`。读者一提交，`TRUNCATE` 立刻把 WAL 清空。

备份脚本里的用法有两种，选一种写死别混：

```sql
-- 备份前：把 WAL 尽量回写主文件，让主文件本身尽量完整
PRAGMA wal_checkpoint(FULL);
-- 备份后：确认 -wal 是否还留着东西（留着说明有长事务在跑）
PRAGMA wal_checkpoint(TRUNCATE);
```

`FULL` 可能返回 busy=1 而不是失败，脚本得检查返回值，别把它当成功。最后一个连接关闭时，SQLite 会自动做一次检查点并删除 `-wal` 和 `-shm`（实测：`最后一个连接关闭后 -wal 存在? false  -shm 存在? false`）。**这条决定了「进程还活着时复制」和「停机后复制」是两件不同的事。**

## 备份出来之后先验证再归档

`PRAGMA integrity_check` 扫全库页结构与索引一致性，完好时返回单行 `ok`；`quick_check` 只查单页不查索引匹配（快得多，适合每次备份都跑），`foreign_key_check` 只列违反外键的行。故意把备份文件破坏掉，看它们各自怎么反应（这一步要在副本上做，别碰源库）：

```text
把文件截断到 4000 字节：
  ERROR code=ERR_SQLITE_ERROR errcode=11 msg=database disk image is malformed
把头部 16 字节改成非法魔术字：
  ERROR code=ERR_SQLITE_ERROR errcode=26 msg=file is not a database
```

`errcode 11` 是 `SQLITE_CORRUPT`、`errcode 26` 是 `SQLITE_NOTADB`。两种都要在你的脚本里区分处理：截断类往往来自复制时机不对（写一半时拷走），非法头往往来自拷错文件、压缩包解压失败或权限问题下拿到空文件。

一个能直接抄的备份流水线：

```js
import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';

const out = `backup/app-${new Date().toISOString().slice(0, 10)}.db`;
if (fs.existsSync(out)) fs.rmSync(out);        // 快照手段不容忍目标已存在

const src = new DatabaseSync('data/app.db');
src.exec('PRAGMA wal_checkpoint(FULL)');       // 返回值看 busy，不看有没有报错
await backup(src, out);                        // 少了 await 就是 0 字节

const chk = new DatabaseSync(out, { readOnly: true });
if (chk.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
  throw new Error('备份自检失败');
}
const orders = chk.prepare(
  'SELECT count(*) c, sum(id) s, min(id) mn, max(id) mx FROM orders',
).get();
chk.close(); src.close();
fs.writeFileSync(out + '.manifest', JSON.stringify({ orders }));
```

`manifest` 是关键一步：把行数、聚合校验和、主键边界写进备份旁边的小文件。恢复时你不需要记得「应该有多少行」，备份自己带着账本。滚动保留（日备 7 份、周备 4 份、月备 12 份）、异地副本、不可变存储（对象存储开版本锁或 WORM）都在这个脚本外面解决，本章不展开。

## 恢复演练：三步对账，别只测「能不能打开」

恢复成功判定只有三条，全过才算数：**能打开且结构对** → **数据对得上账** → **能扛住下一次迁移**。

第 1 步用 `integrity_check` 和 `PRAGMA table_info` 比对列名。第 2 步对账，本机从 WAL 库恢复 500 行的真实输出：

```text
期望(源)   = {"c":500,"s":125250,"mn":1,"mx":500}
实际(恢复) = {"c":500,"s":125250,"mn":1,"mx":500}
对账一致? true
恢复库 integrity = ok
```

`sum(id)` 是 1 到 500 的和 125250 —— 这一项能同时抓到丢行、重复导入和主键错位，比只比 `count(*)` 强得多。

第 3 步是大多数团队从没做过的那步：**把待发布的迁移在恢复出来的库上跑一遍**。迁移脚本对「空库」和「有历史包袱的库」表现不同，只有拿真实备份当试验田才能暴露差异。实测在一次恢复演练里试着加一列：

```text
加 NOT NULL 列 -> ERROR code=ERR_SQLITE_ERROR errcode=1 msg=Cannot add a NOT NULL column with default value NULL
回滚后表结构 = ["id","v"]
迁移失败后备份库仍可读写, 行数 = 500
```

结构没变、数据没少 —— 这就是「失败可回滚」的证据。演练场要建在恢复出来的副本上，永远别在生产库上做这种尝试。

## PostgreSQL 的逻辑备份与 PITR（未在本机验证）

下面这一段**本机没有 PostgreSQL 服务，一条都没执行过**，命令与预期输出取自官方文档（核实于 2026-10-18），落地前请在自己的实例上确认。

`pg_dump` 是单库逻辑备份，四种输出格式各有用处：

```bash
pg_dump -Fc -f app-2026-10-18.dump mydb     # custom，压缩、可并行恢复、可选表恢复
pg_dump -Ft -f app.tar mydb                 # tar，能用 tar -tf 直接看清单
pg_dump -Fp -f app.sql mydb                 # 纯文本，可读可改，恢复慢
pg_dump -Fd -j 4 -f appdir mydb             # 目录格式，配合 -j 并行 dump
```

预期输出（custom 格式，成功时几乎安静，只在结束时多一个文件）：

```text
$ pg_dump -Fc -f app.dump mydb
$ ls -l app.dump
-rw-r--r-- 1 pg pg 18446432 Oct 18 09:00 app.dump
```

恢复用 `pg_restore`（对应非文本格式），目标库为空时才干净：

```bash
createdb -T template0 appnew -O pg
pg_restore -d appnew --no-owner -j 4 app.dump
psql -d appnew -c 'select count(*) from orders'   # 预期 50000
```

三条来自文档的硬结论：`pg_dump` 不导出表空间映射和角色（成员关系），集群级对象要用 `pg_dumpall` 单独出一份角色；它跑在一个一致性快照上（内部 `BEGIN` + `SET TRANSACTION SNAPSHOT` 的思想），所以不会读到一半被写入打断，但它挡不住 vacuum 相关的膨胀；恢复前建议目标库是空的，重复恢复会撞已存在对象。

物理备份与 PITR（point-in-time recovery）是另一条路：先做一次基础备份（`pg_basebackup`），再把 WAL 持续归档到远端（`archive_mode=on` + `archive_command`），恢复时重放 WAL 到指定时刻，例如 `recovery_target_time = '2026-10-18 03:12:00+00'`。它能把「14:30 手滑 `DROP TABLE`」变成「恢复到 14:29」，逻辑备份做不到这点 —— 逻辑备份只回到昨天夜里。**RPO 由 WAL 归档决定，不由 `pg_dump` 频率决定**，这是本节最该带走的一句。

## MySQL 的 mysqldump 与 binlog（未在本机验证）

同样**未在本机执行**，依据官方文档：

```bash
mysqldump --single-transaction --routines --triggers --events \
          --set-gtid-purged=OFF mydb > app.sql          # InnoDB：一致性事务快照
mysqldump --lock-tables mydb > app.sql                  # MyISAM：只能锁表
```

三条要点。InnoDB 上加 `--single-transaction`（内部走 `START CONSISTENT SNAPSHOT`）可以不停写拿到一致快照，此时**不要**再叠 `--lock-tables`，两者同用会让快照和锁互相干扰。`--routines` / `--events` 默认不带，漏了恢复出来就少存储过程和定时任务。要做基于 binlog 的时间点恢复，用 `--master-data`（MySQL 8.0.26 起改名 `--source-data`）配合 `--flush-logs` 切一个新 binlog 作为起点，恢复时用 `mysqlbinlog` 把 dump 之后的事件重放上去。权限不足时的报错形态（文档描述，未实测）是 `mysqldump: Got error: 1045: Access denied for user ...`。

## RPO 和 RTO：先定数字，再谈方案

两个问题先量化再谈方案：**RPO** 是最多允许丢多少数据，**RTO** 是最多允许停多久。只靠每日 03:00 全量备份时，RPO 最坏接近 24 小时，RTO 是「下载 + 恢复 + 校验」的总和（本机无关，按经验几十分钟起），还不含发现故障和决策时间。改成每小时备份只压得动 RPO，压不动 RTO —— RTO 取决于数据量和恢复算法。要同时压两个，方向是 WAL 归档 + PITR（RPO 到分钟级）和只读副本 / 主从切换（RTO 到秒级），代价是运维复杂度，见[PostgreSQL 进阶特性](/database/postgres-features)。

SQLite 单文件想把 RPO 压到分钟级，可以走「`-wal` 持续同步到另一台机器 + 定期快照」，但这不是官方支持的复制方案，跨机器共享 WAL 是明确禁止的（本机只验证过同盘行为，跨机未验证）。真要分钟级 RPO 加秒级 RTO，答案是换带复制的关系库。

## 常见错误与排查

1. **备份能打开，恢复出来没有表**：WAL 没跟着走。先 `PRAGMA journal_mode` 确认，然后用 `backup()` 或 `VACUUM INTO` 重出快照，别再用文件复制。
2. **备份文件 0 字节**：`backup()` 返回 Promise 没 `await`，或复制目标已存在被上一步覆盖。
3. **备份体积每周变大，`-wal` 常驻几 MB**：有长事务或长读事务挡住检查点，`wal_checkpoint` 返回 `busy=1` 且 `checkpointed=0`。找出持有读事务的连接（[事务与并发](/database/transactions) 的长事务四笔账），别靠加大 `wal_autocheckpoint` 掩盖。
4. **恢复后应用报 `no such column`**：备份的 schema 落后于代码。恢复之后要跑迁移，别手改。
5. **`pg_dump` 恢复了但序列从 1 开始，插入撞主键**：序列当前值在 dump 里，但如果混用了自己写的 DDL 脚本或只恢复了部分表就会丢；用 `--exclude-table` 时把序列排除项也复核一遍。（未在本机验证，出自文档。）
6. **备份文件在 NAS / 网络盘上，偶发 `file is not a database`**：WAL 相关约束与网络文件系统不兼容；备份目标必须是本地 POSIX 磁盘。

## 练习

<Exercise title="练习一 亲手制造一次失败的备份" difficulty="进阶">

建一个开 WAL 的库，插入 200 行，**保持连接不关闭**。做两份复制：只拷主文件、主文件加 `-wal` 一起拷。再用新的只读连接分别打开，各跑一次 `SELECT count(*)` 和 `PRAGMA integrity_check`，把四行输出原样记下来。写出：哪一份可用，以及不可用的那份为什么仍然通过了完整性检查。
<template #answer>

你应当跑出与下面同构的四行（本章实测的是 1 行和 500 行的同一场景，把 200 换成你的行数即可）：

```text
只拷主文件      -> ERROR: no such table: t
只拷主文件      -> integrity_check = ok
主文件 + -wal   -> 行数 = 200
主文件 + -wal   -> integrity_check = ok
```

可用的是第二份。第一份通过检查，是因为主文件本身是一个**结构完整但内容陈旧**的合法数据库：WAL 模式下页级修改全在 `-wal` 里，主文件停在最后一次检查点，甚至停在 `CREATE TABLE` 之前。`integrity_check` 判断的是「这个文件内部自洽吗」，不是「这是不是最新数据」。备份验收因此必须包含数据对账。

复现要点：如果先 `close()` 再复制，最后一个连接关闭时 SQLite 会自动检查点并删掉 `-wal`，此时只拷主文件也能拿到全部数据 —— 你会误以为复制是安全的。连接必须保持打开，那才是真实的在线场景。

</template>

</Exercise>

<Exercise title="练习二 把备份脚本写成会自己承认失败" difficulty="进阶">

给本章流水线加三件事：目标文件名带时间戳；`wal_checkpoint(FULL)` 返回 busy 时写警告日志而不是静默；`integrity_check`、行数、`sum(id)` 同时打印和落盘。然后**故意制造两次失败**：让目标文件已存在一次；把产物用 `fs` 截断到 4000 字节再跑校验一次。记录两次报错原文。
<template #answer>

第一次失败来自快照手段不容忍目标存在，实测原文 `ERROR: output file already exists`。如果脚本用 `try/catch` 吞掉它再 `process.exit(0)`，cron 显示成功，第二天你才发现只有一份旧备份。

第二次失败：截断后跑 `integrity_check`，实测是**抛异常**而不是返回一行字符串 —— `errcode=11 database disk image is malformed`。所以校验必须写成「try 打开 + try 查询，任一失败即 exit 非零」，只判断返回值等不等于 `ok` 不够，损坏时你根本拿不到返回值。

busy 分支：`PRAGMA wal_checkpoint(FULL)` 不报错，返回值是唯一线索，看到 `busy: 1` 或 `checkpointed` 明显小于 `log` 就记警告。

</template>

</Exercise>

<Exercise title="练习三 恢复演练脚本，并解释为什么不能在生产上跑" difficulty="挑战">

写一个 `restore-drill`：取最新备份 → 复制到临时目录新建库 → 三步对账（结构、聚合校验和、迁移试跑）→ 输出通过或不通过并打印差异。要求它对「备份里没有 orders 表」「sum 对不上」「迁移报错」三种情况给出不同结论。
<template #answer>

```js
const expect = JSON.parse(fs.readFileSync(latest + '.manifest', 'utf8'));
const got = db.prepare('SELECT count(*) c, sum(id) s FROM orders').get();
const diff = (k) => expect.orders[k] !== got[k] ? { k, want: expect.orders[k], got: got[k] } : null;
const problems = ['c', 's'].map(diff).filter(Boolean);
if (problems.length) { console.error('对账不通过', problems); process.exit(1); }
```

三种结论要能区分：查询抛 `no such table: orders` 是**结构缺失**；`problems` 非空是**数据不一致**；迁移试跑抛 `errcode 1` / `errcode 19` 是**待发布脚本与历史数据不兼容**。

不能在生产上跑的原因有两条：演练要新建库并执行未验证的 DDL，中途失败虽能回滚，但你已经把「未验证变更」和「生产库」绑在一起，回滚逻辑有 bug 就是事故；更基础的是生产备份含真实个人数据，演练环境该有独立的数据处理流程。

</template>

</Exercise>

## 官方文档与延伸阅读

- [SQLite Backup / Restore](https://www.sqlite.org/backup.html) —— `VACUUM INTO` 与在线备份 API 的官方说明，核实「复制进行中允许并发写入」「备份 API 逐页拷贝并处理锁」；本机 `VACUUM INTO` 9 ms / 16384 字节、`backup()` 返回 Promise 的结果与之一致。
- [SQLite WAL 框架](https://www.sqlite.org/wal.html) —— 核实检查点四模式、`wal_autocheckpoint` 默认 1000 页、最后连接关闭时自动检查点并删除 `-wal`/`-shm`、WAL 不可放网络文件系统（最后一条未在本机验证）。本机实测：有旧快照读者时 `FULL` / `RESTART` / `TRUNCATE` 返回 `busy=1`、`checkpointed=0`。
- [SQLite PRAGMA 清单](https://www.sqlite.org/pragma.html) 与 [结果码](https://www.sqlite.org/rescode.html) —— 三种检查 PRAGMA 的语义差别；实测拿到的 `SQLITE_CORRUPT`(11) `database disk image is malformed` 与 `SQLITE_NOTADB`(26) `file is not a database` 的官方定义在此。
- [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html) / [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html) / [连续归档与 PITR](https://www.postgresql.org/docs/current/continuous-archiving.html) —— 四种 `-F` 格式、并行 `-j`、不导出角色与表空间、`pg_dumpall` 补角色、`recovery_target_time`；核实于 2026-10-18，**本机无 PostgreSQL，未执行**。
- [mysqldump 文档](https://dev.mysql.com/doc/refman/8.0/en/mysqldump.html) —— `--single-transaction`、`--routines` / `--events` 默认不包含、`--source-data` 自 8.0.26 取代 `--master-data`；核实于 2026-10-18，**本机无 MySQL，未执行**。
- [Node.js node:sqlite](https://nodejs.org/api/sqlite.html) —— 本章实测所用 API，含顶层 `backup()`（实验性模块）。

## 下一章

备份管的是「数据没了怎么回来」，[PostgreSQL 进阶特性](/database/postgres-features) 管的是「单机长到一定程度之后数据库能帮你做什么」—— 复制、`LISTEN/NOTIFY`、JSONB、全文索引与扩展。你在这章测过的 RPO / RTO 两个数字，正是决定要不要往那一步走的依据：只读副本把 RTO 压到秒级、归档把 RPO 压到分钟级，而这两件事单文件 SQLite 都给不了。往前依赖[事务与并发](/database/transactions) 里 WAL 与检查点的机制解释。
