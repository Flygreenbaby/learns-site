# 测试体系：先把「什么算坏」写成能重复执行的判据

第 3 章把约定交给了机器执行——lint 管风格、`commit-msg` 钩子管信息格式。但**它们判断不了「这段代码是不是坏了」**：提交信息完全合规的应用照样能把分页算错。给出「坏」这个判据，靠的是能重复执行、退出码能被机器读到的测试。本章主张只有一句：**测试的产物不是「跑过一遍」，而是「可重复执行的失败判据」**——同一份代码在你机器上红，就得在 CI 上红、在别人机器上也红，并且红的时候说得出哪条行为不对——这三件事对应下面的退出码契约、flaky、失败定位三节，全部在本机实测复现过。工具选哪个是第二步：Vue 组件怎么挂载、端到端选择器怎么挑，[前端测试体系](/frontend-engineering/testing) 已经讲透；本章讲**策略与工程约束**。被测例子沿用主线那篇博客：slug 生成、分页计算、日发帖配额、文件型仓库。

<Callout type="verified" title="本章实测环境">

Windows 10 + Git Bash（bash 5.2.37）+ Node.js `v25.4.0`，核实时间 2026-10-20。**没有安装任何依赖**：用的全是 Node 内置的 `node:test`、`node:assert`、`node:fs`，跑的是真实测试进程与真实磁盘读写。实测八块：单元测试与失败输出、按名字单跑、覆盖率表与「全绿但变异存活」、覆盖率达门槛时的退出码、`t.mock.timers` 冻结 `Date`、文件型集成测试（临时目录自建自删）、顺序耦合与并发共享状态的复现、固定种子数据。脚本与逐字输出在 `devops/.scratch/t12*`，总运行器是 `devops/.scratch/t12-run-all.sh`。

</Callout>

<Callout type="unverified" title="Vitest、Playwright 与 CI 上的测试都没有运行过">

本机没有 `vitest`、没有 `playwright`、没有任何测试相关的 `node_modules`，本章**一条也没跑过**，也没为此安装任何东西。Vitest 只引用官方文档当前版本的逐字片段（页面标注 v5.0.5，核实 2026-10-20），配置与命令请你在装好它们的环境里核对；Playwright 本批抓取文档页没有成功，所以本章**对它的文档没有任何逐字引用**，只给出站内前端章的指引。GitHub Actions 上的真实表现、并行分片、缓存行为同样未实测。还有一类必须区分：本机只验证了「CLI 认识这个选项」（退出码 0），正文都单独写明——**选项被接受不等于行为符合文档**。

</Callout>

## 测试唯一的产物是失败判据：先认退出码

官方对本机这套工具的定位很清楚（nodejs.org `node:test` 模块文档，核实 2026-10-20，页面标注 Node v26.12.0）：「The `node:test` module facilitates the creation of JavaScript tests.」「Stability: 2 - Stable」，以及决定 CI 能不能信它的那句：「If any tests fail, the process exit code is set to `1`.」

本机 v25.4.0 实测这条契约（逐字摘录）：

```text
全绿的套件 rc=0
slug v2 rc=0
slug v1（只改实现，不改测试）rc=1
```

**第三行是本章的起点**：测试文件一个字没动，只把实现换成有缺陷的版本，套件就红、进程就返回 1。这就是「判据」——它不依赖你盯日志，机器读退出码就够了。第 5 章的必需状态检查、第 9 章的发布闸门，最下面那块砖都是它。

顺手实测了一个一定会踩的坑：**目录参数在这台机器上不可用**。

```text
node --test .                => Could not find '.'                     rc=1
node --test <绝对路径的目录>  => ✖ …\t12 (114.8577ms) 'test failed'      rc=1（pass 0 / fail 1）
node --test（无参数，在包根） => 发现并跑完全部 *.test.mjs，tests 6 pass 6 rc=0
node --test a.test.mjs b.test.mjs => 显式列两个文件，tests 3 pass 3 rc=0
```

所以本章的命令只用两种形式：**在包根目录无参数跑**，或者**显式列出测试文件**。`node --test .` 不是「跑当前目录」，实测是报找不到。

## 三层各拦什么：分界线画在「这段依赖归谁」

| 层 | 你替谁负责 | 失败在告诉你 | 抓不住 |
| --- | --- | --- | --- |
| 单元 | 纯函数与模块内逻辑，依赖都在进程内 | 「这条规则算错了」，精确到输入输出 | 拼装起来的错、真实 IO、并发时序 |
| 集成 | 你的代码 + 不属于你但**能装真的**东西（文件系统、数据库、HTTP 边界） | 「单独都对，接起来就坏」 | 浏览器与部署环境里的事 |
| 端到端 | 整套跑起来的产品 | 「用户现在用不了」 | 边界值（太贵、定位太慢） |

分层的判据不是「测多少」，是**这段代码的正确性由谁负责**：你负责的用单元测试穷举边界；别人实现但你能装个真的跑一遍（临时目录、测试库）就别 fake；装不起真的（浏览器、第三方 API、生产 Nginx）才升端到端。哑铃形还是金字塔形**没有权威口径**，本站按通行用法描述。本章补一条工程约束：**中间层不能空**——只有单元 + 端到端时，端到端一红你分不清是逻辑坏了还是拼装坏了，而这正是第 9 章那三种失败形态要替你区分的东西。

## 零依赖起步：内置 node:test 全流程（实测）

不装任何东西就能开始。被测代码先写一个真实存在的缺陷形态：

```js
// lib-slug-v1.mjs —— 非 ASCII 标题会被全部吃掉
export function makeSlug(title, { max = 40 } = {}) {
  const s = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, max).replace(/-+$/, '');
}
```

测试用 `describe` / `test`，断言用 `node:assert/strict`：

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeSlug } from './lib-slug.mjs';

describe('makeSlug', () => {
  test('英文标题转小写连字符', () => {
    assert.equal(makeSlug('Hello World'), 'hello-world');
  });
  test('首尾空白与连续空白折叠', () => {
    assert.equal(makeSlug('  Docker   Compose  '), 'docker-compose');
  });
  test('按 max 截断且不留尾随连字符', () => {
    const s = makeSlug('a very long title that will surely be cut at forty characters', { max: 40 });
    assert.ok(s.length <= 40, `长度 ${s.length} 超过 max=40`);
    assert.ok(!s.endsWith('-'), `尾部残留连字符: ${s}`);
  });
  test('非 ASCII 标题不许退化成空串', () => {
    const s = makeSlug('中文标题');
    assert.ok(s.length > 0, '空 slug 会让所有中文文章抢同一个 URL');
  });
});
```

`node --test --test-reporter=spec slug.test.mjs` 的实测输出（截断；绝对路径按本站惯例脱敏）：

```text
✖ 非 ASCII 标题不许退化成空串 (1.231ms)
ℹ tests 4   ℹ pass 3   ℹ fail 1   ℹ duration_ms 106.2748

test at slug.test.mjs:20:3
✖ 非 ASCII 标题不许退化成空串 (1.231ms)
  AssertionError [ERR_ASSERTION]: 空 slug 会让所有中文文章抢同一个 URL
      at TestContext.<anonymous> (file:///…/t12/slug.test.mjs:22:12)
    generatedMessage: false,
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
rc=1
```

一次红灯里有四处信息：`test at 文件:行` 给出测试体位置；`AssertionError` 后面跟的是**你自己写的那句**（`generatedMessage: false` 是证据——它不是框架造的）；`actual` / `expected` 给差值；栈里第一帧**不是** `node:internal/…` 的那行才是你的代码。把实现换成 v2（空串时退化成 `post-<哈希>-<长度>`）后，同一套测试 `tests 4 pass 4 fail 0 rc=0`。

报告器与单跑（本机实测 + 官方选项表）：文档列出的 reporter 含 `spec` / `dot` / `tap` / `lcov`，本机实跑过前两个——给人读用 `spec`，CI 日志最省行数用 `dot`（两条通过就打两个点，rc=0）。v26 文档称 `spec` 是默认报告器，**本机 v25.4.0 的默认值未核实**。单跑一条用 `--test-name-pattern`（官方 CLI 选项表里有它）——flaky 那一节要拿它做诊断。

## 测试替身分四层：mock 掉什么就等于没测什么

| 替身 | 你在替换什么 | 代价 |
| --- | --- | --- |
| fake | 换一个**行为真的**的假实现（内存仓库、可控时钟） | 你要维护它，它可能和真货不一致 |
| stub | 把返回值写死 | 只验「拿到这个值之后」的逻辑 |
| spy | 记录调用次数与参数 | 断言交互很容易，断言结果容易写漏 |
| mock | 框架接管方法本身 | **依赖的真实行为一行都没跑**，签名改了它也不报错 |

第一选择永远是**注入**：把 clock、repo 变成参数，测试传假对象进去，不需要任何框架。下面这个被测函数恰好相反——它自己读 `global Date`：

```js
// lib-quota.mjs —— 没有 clock 注入点，直接读 global Date
export function remainingToday(articles, limit) {
  const day = new Date().toISOString().slice(0, 10);
  const used = articles.filter((a) => (a.publishedAt || '').slice(0, 10) === day).length;
  return limit - used;
}
```

这种代码只能靠运行时替换全局对象来测。官方（`node:test` · Mocking / MockTimers）：「The benefit of mocking via the test context is that the test runner will automatically restore all mocked functionality once the test finishes.」「The mock timers API also allows the mocking of the `Date` object.」本机实测（`t.mock.timers.enable({ apis: ['Date'], now })` 配 `setTime` 与 `tick`）：

```text
▶ remainingToday 与冻结时钟
  ✔ 冻结在 10-20 中午：已发 2 篇，剩 1 (2.7839ms)
  ✔ 同一份数据跨过 UTC 午夜，答案从 1 翻成 3 (0.3382ms)
  ✔ 断言里写死 Date.now() 的差值，会随时钟漂移 (1.1846ms)
ℹ pass 3   ℹ fail 0        rc=0
```

**注意第二条测的是「不冻结时钟会怎样」**：同一份 `ARTICLES`，`setTime` 跨过 UTC 午夜，答案从 `1` 变成 `3`。断言里只要藏着当前时间，23:59 的 CI 和第二天中午的 CI 跑的是两个程序。纪律：能注入就注入；注入不了的用 `t.mock.timers`，它会自动恢复。

能力实测（**存在性核实，不是行为核实**）：`node:test` 导出含 `mock`、`skip`、`todo`、`only`、`snapshot` 与 `before` / `after` / `beforeEach` / `afterEach` 四组钩子；`t.mock.timers` 是 object，`t.mock.fn` / `t.mock.method` / `t.assert.snapshot` 都是 function。`t.mock.method` 与 `t.mock.fn` 的交互断言语义本章**没有实测**，用法以官方文档为准；跨进程的替身不在这套 mock 的作用范围内（按官方描述推得，未实测）。

## 覆盖率是缺口清单，不是质量分数

这是本章最值钱的一组实测。被测实现放两个版本，差别只在最后一行：

```js
// lib-page-a.mjs（正确）    return Math.ceil(total / size);
// lib-page-b.mjs（变异体）  return Math.floor(total / size) + 1;
```

两者前面都有 `if (size <= 0) throw new RangeError(...)` 与 `if (total <= 0) return 0;`。弱测试只有三条断言：`totalPages(10, 3) === 4`、`totalPages(0, 3) === 0`、`totalPages(10, 0)` 抛 `RangeError`。跑 `--test-reporter=spec --experimental-test-coverage`，A 与 B 的实测结果**完全相同**：

```text
ℹ tests 3   ℹ pass 3   ℹ fail 0   rc=0        ← A（正确实现）
ℹ lib-page.mjs | 100.00 |   100.00 |  100.00 |

ℹ tests 3   ℹ pass 3   ℹ fail 0   rc=0        ← B（算错的实现）
ℹ lib-page.mjs | 100.00 |   100.00 |  100.00 |
```

**行 100%、分支 100%、函数 100%，全绿；而 B 在 `total=3, size=3` 时回答 2 页、`total=9, size=3` 时回答 4 页。** 覆盖率只统计「这行有没有被执行」，它不知道你有没有断言结果。补一组表驱动的边界断言（`[total, size, want]` 六行 + 两个抛错），B 立刻被杀掉，实测：

```text
✖ totalPages(3, 3) === 1   AssertionError: 2 !== 1   actual: 2  expected: 1
✖ totalPages(9, 3) === 3   AssertionError: 4 !== 3   actual: 4  expected: 3
ℹ tests 8   ℹ pass 6   ℹ fail 2               rc=1
```

同一组断言跑 A：`tests 8 pass 8 fail 0 rc=0`。

覆盖率的正确用法是**找没跑到的地方**。另一个函数有三条分支，只断言第一条，实测表直接给出行号：

```text
ℹ lib-branch.mjs |  66.67 |    66.67 |  100.00 | 4-5      rc=0
```

`4-5` 就是「这两行从来没被执行过」。官方：「When Node.js is started with the `--experimental-test-coverage` command-line flag, code coverage is collected and statistics are reported once all tests have completed.」门槛还能当闸门（官方：「Require a minimum percent of covered lines. If code coverage does not reach the threshold specified, the process will exit with code `1`.」），本机实测：

```text
node --test --experimental-test-coverage --test-coverage-lines=80 branch.test.mjs
  ✔ 已发布的文章状态是 published
  ℹ Error: 66.67% line coverage does not meet threshold of 80%.
  rc=1                        ← 测试全绿，闸门照样拦住

--test-coverage-lines=95   → 在 100% 的套件上 rc=0
--test-coverage-lines=101  → 同一套件 rc=1（门槛确实在判定，不是装饰）
```

三条结论：门槛设在**你当下守住的数字**上、只准上调；别一上来设 100%；**全绿 + 覆盖率满分 ≠ 没 bug**——要判质量，靠边界断言和变异思维：改一个常数、把 `>=` 写成 `>`，你的测试还绿吗？

## 测试数据：可重复、自带前置、自己清理

**可重复。** 复现失败的前提是拿回同一份数据。实测：固定种子（mulberry32，seed 20261020）生成 200 行，两个独立进程给出同样的和与哈希；`Math.random()` 两次都不同：

```text
mode=seed n=200 sum=90353 hash=10295b0dd044ab37
mode=seed n=200 sum=90353 hash=10295b0dd044ab37
mode=random n=200 sum=102527 hash=8f181c75682d24c2
mode=random n=200 sum=91300 hash=3bf3e540a2a07976
```

失败输出里请带上**种子值**，别只贴随机结果。

**自带前置。** 每条测试自己造数据（`beforeEach` 重建）；后面 flaky 一节要拿它做诊断工具——能单跑的测试才算隔离干净。

**自己清理。** 集成测试要落盘就落临时目录，`mkdtemp` 建、`after` 删。实测：

```text
#INTEGRATION_TMP=<本机 TEMP>\t12-repo-eOxdfU
✔ 写入后读回完全一致（真实磁盘往返） (16.8153ms)
✔ 保存后目录里没有 .tmp 残留 (1.4525ms)
✔ 重复保存幂等：同一 id 只留一个文件 (5.4395ms)
✔ 读不存在的 id 抛 ENOENT（这是单元测试伪造不出来的失败形态） (1.7461ms)
#CLEANED=<同上路径>
ℹ tests 4   ℹ pass 4   ℹ fail 0        rc=0
本机 TEMP 残留：0 个
```

三条纪律：**不共享可写状态**（同一份 fixture 被两条测试改，第二条的结果取决于谁先跑）；**不连生产实例、不用真实账号**（写操作没有闸门挡着）；**每条测试能单跑**（用 `--test-name-pattern` 挑一条跑，红了就说明耦合）。数据库侧的可重复做法（每次建库跑迁移、事务内回滚、用还原副本测）在 [迁移与版本管理](/database/migrations) 与 [备份与恢复](/database/backup-and-restore)；本章本机没有数据库，没测。

## 集成测试：真实 IO 这一段不能 fake

上面那四条就是真实的集成测试：写、改名、读回、列目录。三点值得单说。

**慢是正常。** 实测「写入后读回」16.8ms，同文件其他三条 1–5ms。别因为集成测试慢就 fake 回单元测试——**那只是把一个该测的东西删掉了**。

**失败形态只有真机能给。** 「读不存在的 id」断言的是错误码：

```js
await assert.rejects(() => load(dir, 'nope'), (err) => {
  assert.equal(err.code, 'ENOENT');
  return true;
});
```

内存 fake 不会给你 `ENOENT`，它给你 `undefined` 或者干脆返回空对象——你的错误处理分支永远没被执行过。同理「目录里没有 `.tmp` 残留」那条（`readdir` 之后断言）测的是 `rename` 的原子替换纪律，和第 8、9 章「中途崩了会不会留下半截文件」是同一件事。

**文件级并行。** 官方：「The maximum number of child processes running at any time is controlled by the `--test-concurrency` flag.」——每个测试文件是独立子进程，**跨文件不共享内存状态**；也正因为并行，落盘路径必须各自唯一（`mkdtemp`，不是写死的 `./tmp`）。

## 失败定位与 flaky 的三种来源：逐种实测复现

flaky（同一份代码时而红时而绿）不是运气问题，**三种成因都能稳定复现**，本章逐种跑给你看。

**① 顺序耦合。** 模块级状态 + 两条测试隐式约定先后：

```js
const db = { drafts: [] };
test('保存草稿后可入队', () => {
  db.drafts.push({ id: 'a' });
  assert.equal(db.drafts.length, 1);
});
test('入队取走最早的一条', () => {
  const first = db.drafts.shift();
  assert.equal(first?.id, 'a'); // 单独跑这条：first 是 undefined
});
```

实测：整份文件跑 `tests 2 pass 2 rc=0`；`--test-name-pattern='入队取走最早的一条'` 只跑后一条 → `AssertionError: undefined !== 'a'`、`rc=1`。**「本地绿、CI 红」常常就是它**：并行、失败重排、只跑改动文件都会改变顺序（v26 文档另提到测试顺序随机化，**本机 v25.4.0 未核实对应选项是否存在**）。修法实测有效：`beforeEach` 里重建状态、每条测试自带前置数据，同样的单跑得到 `pass 1 fail 0 rc=0`。

**② 并发共享状态。** 同一份代码，只差 suite 的 `concurrency` 选项：

```js
function makeCounter() {
  const c = { n: 0 };
  const bump = async () => {
    const cur = c.n;          // 读
    await Promise.resolve();  // 让出事件循环（真实代码里是任何一次 await）
    c.n = cur + 1;            // 改 + 写
  };
  return { c, bump };
}
describe('并发 4：读-改-写踩坏共享计数', { concurrency: 4 }, () => { /* 8 条 bump + 1 条断言 */ });
describe('并发 1（串行）：同样的代码结果正确', { concurrency: 1 }, () => { /* 同上 */ });
```

实测：并发 4 那组 `✖ 8 次 bump 之后应当等于 8  AssertionError: 2 !== 8`；并发 1 那组 9 条全绿；整份文件 `tests 18 pass 17 fail 1 rc=1`。**丢更新不是概率极小的事**，`await` 之后的每一次「读—改—写」都在赌没人插队。修法：要么串行，要么把状态变成每条测试私有，要么把读改写收进一个不跨 `await` 的同步段。

**③ 时钟与随机。** 前面两组实测（跨 UTC 午夜答案翻转、`Math.random()` 两次哈希不同）就是它。

**处置**：红灯按四步定位——整份再跑、单跑这一条、串行跑、把时钟与随机固定住跑，四种结果各指向不同成因。修不好就**显式 skip 并写下原因**（导出里有 `skip` 与 `todo`），**不要靠重跑掩盖**：框架级 retries 属于 Playwright / Vitest，本章未安装未测。

## 值得测什么：三因子判据、TDD 的适用面、测试怎么变负债

值得投入的量 ≈ **出错代价 × 分支复杂度 × 改动频率**。三项都低的别测，三项都高的重点测。

这篇博客里排前面几名的：slug 唯一性与非 ASCII 退化（撞 URL 是数据事故）、分页与排序边界（`ceil` / `floor` 差一，上面已实测）、配额与限流的跨日边界、鉴权后每个出口的 401/403 形状（定义在 [后端错误处理与日志](/backend/error-handling)）、上传文件的类型与体积边界（真实 IO，属集成）、迁移后的读写兼容（矩阵在第 9 章，要你在自己的测试库里验）。

不值得测：纯 getter/setter、只做转发的 wrapper、SDK 内部行为、第三方库自己的正确性、样式与像素。

**TDD 划不划算，看「判据能不能先写出来」**：边界明确、失败形态可描述的适合先写测试；接口形状还在探索时先写测试，你会同时改两份东西。**负债形态要认得出**：断言私有实现（改内部结构就红）、断言过细的快照（改文案就红，而改文案本来就是预期）、mock 链长到测试里没有一个真实对象、把「测试全绿」当验收标准——**全绿只说明判据没被违反，不说明判据覆盖了你关心的行为**（覆盖率那节的变异体就是证据）。

## 接进项目：目录、脚本与 CI 命令契约

目录上先把层分开，命令才分得开：`src/lib/slug.mjs` 是被测实现，`test/unit/*.test.mjs` 放纯逻辑（毫秒级），`test/integration/*.test.mjs` 放真实临时目录（自建自删），`e2e/*.spec.ts` 放 Playwright（写法见前端测试章）。脚本随之切成三条：

```json
{
  "scripts": {
    "test": "node --test",
    "test:unit": "node --test test/unit/slug.test.mjs",
    "test:ci": "node --test --test-reporter=spec --experimental-test-coverage --test-coverage-lines=80"
  }
}
```

`test:ci` 是本机实测过的组合：spec 报告（人能读）+ 覆盖率（缺口可见）+ 门槛（66.67% 那次 rc=1）。CI 只需要这一条命令的**退出码**，第 5 章把它变成必需状态检查，第 9 章再决定它能不能挡住发布。

换到 Vitest 时别指望本章的命令能直接搬：它「reads your vite.config.* by default」，不看文件跑一次用 `vitest run`（官方指南逐字，见文末清单）。本章没装它，**API 差异、覆盖率 provider 与安装方式、报告器参数一概以那页当前版本为准**，这里不给未核实的配置。Playwright 同理：本机没有浏览器也没有安装，用法与选择器纪律在 [前端测试体系](/frontend-engineering/testing)，本章不涉及。

## 常见错误与排查

**1. 现象：本地全绿，CI 上同一条测试时而红时而绿。** 原因按实测概率排：顺序耦合（依赖上一条留下的状态）、并发共享状态、真实时钟、未播种子。确认：按前面 flaky 那节的四步各跑一遍（前三步本机复现过：`undefined !== 'a'`、`2 !== 8`、跨午夜 `1`→`3`）。修法：`beforeEach` 重建状态、每条测试自带前置、状态不跨 `await` 共享、数据带种子。**别用 retries 掩盖**。

**2. 现象：覆盖率 100%，线上还是有 bug。** 原因：覆盖率只统计执行，不统计断言——实测两个实现（`Math.ceil` 与 `Math.floor + 1`）在同一套弱测试下都是 `100.00 / 100.00 / 100.00` 全绿。确认：手动改一个常数或一个比较符再跑，测试还绿就说明断言太弱（变异检验，本机实跑出 `2 !== 1` / `4 !== 3`）。修法：补边界值（`0`、恰好整除、`size=1`、非法入参），表驱动写。

**3. 现象：测试通过，真实依赖坏了却没被发现。** 原因：把被测依赖整个 mock 掉了——替身越强，测到的真实行为越少。确认：把 fake 换成真的跑一次，看有没有新失败（本机的 `ENOENT` 与 `.tmp` 残留两条只在真实文件系统上存在）。修法：优先注入而不是接管全局；mock 只用于「装不起真的」那一层，并在测试名里写清哪一段是假的。

**4. 现象：所有测试都绿，流水线却是红的。** 原因：覆盖率门槛拦住了（实测 `ℹ Error: 66.67% line coverage does not meet threshold of 80%.` 且 rc=1）。这不是 bug，是设计；从没打算用它就去掉 `--test-coverage-lines`。反向更要防：**门槛设 100% 逼人写没断言的测试凑数**——第 2 项那种变异体正是这样活下来的。

**5. 现象：集成测试单跑没问题，一起跑互相污染或留一地垃圾。** 原因：共享写死目录（`./tmp`）+ 没清理 + 文件级并行。确认：`find "$TEMP" -maxdepth 1 -name 't12-repo-*' | wc -l`（本机实测 0 个）。修法：`mkdtemp` 唯一目录、`after` 里递归删除、断言里检查残留。

## 练习

<Exercise title="覆盖率满分为什么还能漏掉 bug" difficulty="基础">

某函数 `discount(price, level)` 有三条分支：`level` 为 `vip` 打八折、`svip` 打七折、否则原价。现有测试只断言了 `discount(100, 'vip') === 80` 与「未知等级返回 100」。回答：(1) 三个覆盖率百分比大概是什么，为什么？(2) 把七折写成六折，这套测试会红吗？(3) 补哪两条断言最划算？

<template #answer>

(1) 行与分支都**不是** 100%：`svip` 那一支从来没被执行过——就像本章实测那张表里的 `lib-branch.mjs |  66.67 |    66.67 |  100.00 | 4-5`，`uncovered lines` 会直接给行号；函数覆盖却是 100%，因为函数被调用过。

(2) 不会红。那条分支根本没跑，改成什么都不知道。这就是本章变异实验的同一件事：A 与 B 两个实现在弱测试下都是 `100.00 / 100.00 / 100.00` 且 `rc=0`，补上边界断言后 B 才被 `2 !== 1`、`4 !== 3` 杀掉。

(3) 一条覆盖未测分支：`assert.equal(discount(100, 'svip'), 70)`；一条覆盖边界与优先级：未知等级、空串、大小写各一条，或表驱动 `[price, level, want]` 一次列全。**先让覆盖率表里的未覆盖行号变成空，再问断言够不够狠**。

</template>

</Exercise>

<Exercise title="判断这条测试为什么只在 CI 上红" difficulty="基础">

模块级 `let draftCount = 0`：测试 A 里 `draftCount++` 后断言等于 1，测试 B 里 `draftCount--` 后断言等于 0。同事只在 CI 看到 B 红，本地整跑一直绿。给出最可能的原因，以及本机用来定罪的两种跑法。

<template #answer>

顺序耦合：B 的结果取决于 A 有没有先跑，而 CI 上并行、只跑改动文件、失败重排都会改变顺序。本章同款结构实测过——整份文件 `tests 2 pass 2 rc=0`，`--test-name-pattern` 只跑后一条 → `AssertionError: undefined !== 'a'`、`rc=1`；另一种定罪跑法是把两条放进 `{ concurrency: N }` 的 suite（本机的并发实验就是这样跑出 `2 !== 8`）。修法：`beforeEach` 重建状态、每条测试自带前置（实测单跑立刻 `pass 1 fail 0 rc=0`）。

</template>

</Exercise>

<Exercise title="把这段集成测试改成可重复、可并行" difficulty="进阶">

现在的写法：所有测试都往 `./tmp` 写，`test` 脚本里先 `rm -rf ./tmp` 再跑，断言用 `Date.now()` 生成的 id，跑完不清理。指出会坏在哪几处，并写出改法与每条改动能拿到的证据。

<template #answer>

三处，按严重度排（判据来自本章实测的 `repo.test.mjs`）：

1. **写死目录 + 并行 = 互相踩**。官方语义是每个测试文件一个子进程，上限由 `--test-concurrency` 控制，它们同时往 `./tmp` 写，读回的对象可能是别人写的。改法：`fs.mkdtemp(join(tmpdir(), 'repo-'))` 给每个文件唯一目录——本机四条测试就是这么写的，实测打印 `#INTEGRATION_TMP=<本机 TEMP>\t12-repo-eOxdfU`。
2. **`rm -rf` 放在脚本里 = 失败时留垃圾，还污染开发目录**（`./tmp` 会被 `git status`、打包、镜像构建上下文捡走）。改法：临时目录放系统 TEMP，`after` 里递归删除；本机跑完的残留数是 0（`本机 TEMP 残留：0 个`）。
3. **`Date.now()` 当 id = 同毫秒撞车，且不可复现**。改法：固定 id（本机用 `p-1`），或用种子生成并把种子打进失败输出（实测：同一 seed 两次都是 `sum=90353 hash=10295b0dd044ab37`，`Math.random()` 两次都不同）。再补三条只可能来自真实文件系统的断言：重复 `save` 幂等、读不存在的 id 断言 `err.code === 'ENOENT'`、`save` 后 `readdir` 断言没有 `.tmp` 残留。

</template>

</Exercise>

<Exercise title="为一篇博客设计三层最小集并把它变成闸门" difficulty="挑战">

给主线那篇博客（前后端 + 数据库 + 第 8 章那套部署）设计单元 / 集成 / 端到端各三条的最小测试集，写出 CI 里要跑的那一条命令与覆盖率门槛，并说明：这些测试各自能不能作为第 9 章的发布闸门，以及哪些必须等到有真数据库或真浏览器才能落地。

<template #answer>

判据用「出错代价 × 分支复杂度 × 改动频率」，不从「应该有什么」出发。

| 层 | 三条 | 为什么值得 | 能否当发布闸门 |
| --- | --- | --- | --- |
| 单元 | slug 非 ASCII 与截断、分页与排序边界、日配额的跨日边界 | 进程内毫秒级跑完，都是差一错误的温床 | **能**（实测同类套件 rc 稳定为 0 或 1） |
| 集成 | 文章写入读回 + 幂等 + 残留检查、上传文件的类型与体积边界、迁移后旧版读写兼容 | 依赖能装真的；`ENOENT`、`.tmp` 这类形态只有真机能给 | 前两条**能**；第三条要真数据库 |
| 端到端 | 注册→发文→列表出现、未登录访问受保护页被送走、配额用尽时的提示 | 「挂了产品就不存在」的三条主流程 | 装得起浏览器就能，但耗时长，第一期只通知不阻断 |

命令沿用本机实测组合：`node --test --test-reporter=spec --experimental-test-coverage --test-coverage-lines=80`（换 Vitest 要按它的文档改，`vitest run` 才是不看文件的一次性执行）。门槛设 80 的理由：实测 66.67% 那次它把全绿的套件拦成 `rc=1`，而**设 100% 会逼人写没断言的测试凑数**——正是那个变异体能活下来的机制。闸门顺序建议「单元 + 集成 → 阻断，端到端 → 观察一周再阻断」：本机只能测到前两者，端到端要 Playwright 与浏览器（未安装未跑）。必须等环境才落地的：迁移兼容矩阵（真库）与端到端全套（浏览器 + 构建产物 + 真实服务器）。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Node.js · Test runner（`node:test` 模块文档）](https://nodejs.org/docs/latest/api/test.html) —— 「Stability: 2 - Stable」、失败时退出码 1、`--experimental-test-coverage` 与覆盖率门槛、`--test-name-pattern` / `--test-only` / `--test-concurrency`、reporter 列表、Mocking 与 MockTimers（含 `Date`）。核实 2026-10-20，页面标注 Node v26.12.0；本机运行环境是 v25.4.0，**随机化那一节对应的选项未在本机核实**。
- [Vitest 指南](https://vitest.dev/) —— 「powered by Vite」「reads your vite.config.\* by default」「`vitest run`」三处逐字片段（完整句已核实），页面标注 v5.0.5。**本章未安装、未运行**，API 与覆盖率配置以该页当前版本为准。
- [Playwright 文档](https://playwright.dev/docs/intro) —— 端到端工具的官方站。**本批抓取该页没有成功，本章对它没有任何逐字引用**；本机没有浏览器也没有安装，用法与选择器纪律见站内前端章。
- 站内：[上一章：代码规范与提交约定](/devops/code-standards)、[前端测试体系](/frontend-engineering/testing)、[后端错误处理与日志](/backend/error-handling)、[迁移与版本管理](/database/migrations)、[备份与恢复](/database/backup-and-restore)、[发布与回滚](/devops/release-and-rollback)、[阶段项目：完整部署上线](/devops/project)、[下一章：CI/CD 与 GitHub Actions](/devops/ci-cd)。

## 下一章

测试写出来了，谁去跑、什么时候跑、红了拦不拦，才是它产生价值的地方——本章所有实测最终汇成一句话：**退出码 0 或 1，机器读得懂**。第 5 章把这条命令交给 GitHub Actions：workflow 语法、job 与 step、触发条件、依赖缓存、secrets 不进仓库，以及怎么把「lint + 测试 + 构建 + 部署」串成推代码就自动跑完的流水线 → [CI/CD 与 GitHub Actions](/devops/ci-cd)。有了 CI，第 9 章的发布闸门才有依据。
