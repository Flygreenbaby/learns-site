# Redis Stream：你已经在跑的 Redis 里，藏着一个带消费组的队列

你在[数据存储进阶](/data-storage/)里已经装好并跑起了 Redis：缓存、会话、限流、去重。于是「轻量级队列」看起来理所当然——加个 List，生产端 `LPUSH`，消费端 `BRPOP`，十分钟写完。它确实能跑，而且跑得挺顺，直到某个 worker 在拿到消息之后崩溃。那一刻那条消息的下落是：**已经**从 Redis 里消失了（`BRPOP` 是取出即删除），同时**只**存在于那个进程的内存里，而进程没了。你损失的不只是一条消息，而是**「你知道自己损失了几条」这件事本身**——Redis 里没有任何地方记录过「曾投递给 consumer-2 一条消息，尚未处理完」。List 有一个补救写法（`RPOPLPUSH` 的可靠队列，把「处理中」的消息同时放进第二个 key），但那意味着你维护两个 key、自己搬运、自己判断哪条属于哪个已经死掉的消费者——本质上是在手写下面三节里 Redis 已经内建的东西。

第二个方向相反的坑：你改用 Stream + 消费者组，跑通了，`XREADGROUP` 拿到消息、处理、一切正常——只有 `XACK` 那一行忘写了。三天后内存涨到 `maxmemory`，驱逐策略开始动手，被赶出去的不只是那批没人认领的消息，还有你的会话缓存：用户莫名被登出，根因却是队列代码里一行缺失的确认。原因很直白：**待处理列表（PEL）不是运行状态，是存在 Redis 里的数据**，它只增不减就是一颗内存炸弹，引爆时先炸的是别人（你的缓存）。

第三个坑更隐蔽，因为它在正常运行的每一天里都没有症状。你为了「消息至少留 7 天方便回放」，在 `XADD` 上写了 `MAXLEN ~ 100000`；促销那天流量翻了两倍，同样的 100000 条只对应 20 小时——**你的保留策略从 7 天悄悄变成了 20 小时**，等你要查「上周三那批重复扣库存」时条目已经不存在了，而且修剪不会报错。这三个坑对应本章三条主线：**投递与归属**、**确认与待处理**、**保留与修剪**。

<Callout type="unverified" title="本章哪些是核实过的，哪些必须你自己核对">

已核实（来源：[Redis 官方文档 · Streams](https://redis.io/docs/latest/develop/data-types/streams/)，核实时间 2026-10-20）：条目 ID 由 `<毫秒时间>-<序号>` 两段组成；时钟回拨时取上一条的时间以保证 ID 单调递增；序号用于同一毫秒内的多条消息；同一消费者组内每个消费者只拿到不同的那部分消息；`XREADGROUP` 用 `>` 读取尚未投递的新消息；`XACK` 表示「已由某消费者处理」并从待处理列表移除；带范围的 `XPENDING` 会给出空闲时间（idle time）与投递次数（delivery count）；`XCLAIM` 复杂度 O(log N)，`XAUTOCLAIM` 在 COUNT 较小时为 O(1)，官方把它标注为「简化的消费者故障恢复」实用模式；`XADD` 的 `MAXLEN` 用于自动限制长度；`XTRIM MAXLEN ~` 是近似修剪。

**未核实或本页未提及，动手前请逐条核对命令页**：`XTRIM` 的 `MINID` 形式（按最小 ID 修剪，用来表达「保留到某个时间点」）在我核实的这页没有出现；`XGROUP CREATE` 的 last-delivered-id 参数接受 `$` 的确切语义在该页是放在 `XREAD` 语境下说明的；Redis Streams 的持久化与复制行为只在该页目录里出现了一个小节标题（"Persistence, replication and message safety"），正文未读，所以下面涉及「Stream 会不会随 RDB/AOF 落盘」的话我只描述机制、不下结论；任何具体客户端库（node-redis、ioredis 等）的方法名与参数形式本章一律不锁定。

以及最重要的一条：**本章没有任何一节是本机实测。**我的环境是 Windows，没有运行 Redis 服务，也没有跑 Stream 命令。下面所有命令序列是「按官方语义构造的示例」，预期输出是我根据文档推出的，不是截自真实终端。请按[学习方法](/message-queue-cloud/)里的建议，用 Docker 起一个 Redis 之后自己跑一遍——Stream 的很多结论（尤其 PEL 的具体输出格式）只有亲眼看到才会记住。

</Callout>

## 数据模型：一个 key 就是一条只追加的日志

Stream 的抽象只有一个：**一个 key 对应一条日志（log），日志里是若干条按 ID 严格递增排列的条目，每个条目是若干 field/value 对**。你可以把它理解成「一个 key 下面挂了一串有序的 hash」。写入叫 `XADD`：

```bash
# redis-cli 示例（未在本机执行）
XADD jobs * type email user_id 42 to "a@example.com"
# 预期返回自动生成的条目 ID，形如：1760000000123-0
```

这里唯一需要你认真对待的东西是**那个 ID**。它不是自增整数，而是 `<毫秒时间戳>-<序号>`：前半段是写入时刻的毫秒，后半段解决「同一毫秒内写了好几条」。文档明确的两条规则是：序号位是 64 位宽，所以实际不会因同毫秒条目太多而耗尽；如果系统时钟回拨（当前毫秒数小于上一条条目），Redis **直接沿用上一条的时间**，从而保证 ID 依然单调递增。这个设计给你三样东西：

- **ID 可当游标。**`XRANGE jobs 1760000000123-0 +` 就是「从这条往后的全部」，补拉断点不用另建索引表。
- **ID 可当幂等键。**不必为消息生成 UUID，条目 ID 全局唯一且单调，直接喂给[第 3 章](/message-queue-cloud/reliable-delivery)的去重表。
- **ID 可读。**看到 `1760000000123-0` 就能算出这条消息躺了多久，纯自增 ID 做不到这件事。

显式指定 ID 也可以，但规则是**必须严格大于当前最后一条**，否则报错。这个「必须严格大于」是新手最常见的第一次报错来源：想「往回填一条历史消息」是行不通的。

和 List 的对照，是把本章和「为什么不自己搭队列」一次讲清：

| 维度 | List（`LPUSH` + `BRPOP`） | Stream（`XADD` + `XREADGROUP`） |
| --- | --- | --- |
| 取出后条目还在吗 | 不在，**取出即删除** | 在。条目不随消费删除（见下面「保留与修剪」） |
| 谁在消费，进度记在哪 | 无从记录，取走就算你的了 | 记在消费者组的 last-delivered 位置 + 每个消费者的 PEL |
| 投递给别人没处理完，进程挂了 | 消息一起消失，且不留痕迹 | 条目仍在，PEL 里仍记着「未确认」，可被别的消费者认领 |
| 多个团队各要一份完整消息流 | 做不到，一条只能被取走一次 | 多个消费者组，各组独立进度，各读全量 |
| 按时间范围查历史 | 不支持 | `XRANGE` / `XREVRANGE` 按 ID（即时间）查 |
| 长度查询 | `LLEN` | `XLEN`，O(1)——但 `XLEN` **不是**积压量，见「常见错误」倒数第 1 条 |

## 消费者组：一条流、N 个消费者、一份待处理列表

Stream 本体只是日志。**队列语义全部来自消费者组（consumer group）**。组记录三件事：这条流读到哪了（last-delivered ID）、消息发给了哪个消费者、哪些消息发了但还没确认（PEL）。

```bash
XGROUP CREATE jobs workers $          # 建组，从流末尾开始（$ 的确切语义请核对 XGROUP 命令页）
XGROUP CREATE jobs workers 0          # 建组，从流开头开始（能读到已有条目）
XREADGROUP GROUP workers w1 COUNT 10 BLOCK 5000 STREAMS jobs >
XACK jobs workers 1760000000123-0
```

这就是完整的工作队列循环：`XREADGROUP` 一次最多拿 10 条、没新消息就阻塞 5 秒、`>` 表示「只给我还没投递给本组过的消息」，处理完用 `XACK` 报告「这条我做完了，从 PEL 删掉」。同一个组里再启动 `w2`、`w3`，它们与 `w1` **拿到的是互不相同的消息**（文档的说法是每个消费者只拿到不同的那一部分）——这就是竞争消费，也是它替你省掉 `RPOPLPUSH` 手工搬运的地方。

这里出现了 RabbitMQ 与 Redis Stream 最根本的架构差别，它决定你的限速方式：

| | RabbitMQ | Redis Stream |
| --- | --- | --- |
| 谁驱动数据流动 | broker **推送**给已注册的消费者 | 消费者**拉取**（`XREADGROUP` 是一次请求） |
| 限速靠什么 | `basic.qos` / prefetch 值 | `COUNT`（每批几条）+ 你自己的处理循环 |
| 未确认消息放在哪 | channel 上（连接的属性） | 组的 PEL 里（**服务端的数据**） |
| 消费者挂了 | 未确认消息回到队列，等下次推送 | 未确认消息**留在 PEL**，等别人来认领 |

最后一行是关键：RabbitMQ 的「谁拿着这条消息」记在 TCP 连接上，连接断就自动归还；**Stream 记在数据结构里，连接断了什么都不会自动发生**。这是「Redis 队列消息卡住不动」的根因——不是丢了，是没有任何人负责把它拿回来。下一节就是拿回来的办法。

另外，「多个消费者组」让 Stream 顺手具备了[第 2 章](/message-queue-cloud/mq-concepts)说的发布订阅形态：`workers` 组和 `audit` 组各自维护进度、各自读到全量。一个结构同时覆盖任务队列和事件流，这是它在小项目里显得「够用」的真实原因。

## 卡住的消息：XPENDING 与 XAUTOCLAIM，以及「至少一次」的代价

消费者组的 PEL 是这张表上最有价值也最容易被忽视的东西。未确认的消息不会消失，它带着「投给了谁」「空闲多久」「投递过几次」三个属性一直躺在那里：

```bash
XPENDING jobs workers                    # 摘要：总数、最老/最新 ID、每个消费者各多少未确认
XPENDING jobs workers - + 10             # 明细：每条的 ID、消费者、idle 毫秒、投递次数
XCLAIM jobs workers w2 60000 1760000000123-0     # 把这条从 w1 手里转到 w2，前提它是空闲超过 60 秒
XAUTOCLAIM jobs workers w2 60000 0 COUNT 20       # 从游标 0 起扫 PEL，把空闲超 60 秒的都认领给 w2，返回新游标
```

`XPENDING` 的明细视图直接给出 **idle time 和 delivery count**（已核实）。这两件事在[第 4 章](/message-queue-cloud/dlq-delay-order)里是你自己设计的：毒丸消息的重试计数、「多久没动算卡住」。Stream 里它们是现成字段，所以「重试 N 次之后扔进死信」的实现不是 broker 侧配置，而是**你的 worker 读 `XPENDING`，发现某条 delivery count 超限就把它 `XADD` 到 dead 流、再 `XACK` 掉原条目**。Stream 提供原料，策略仍然是你的代码。

`XCLAIM` 要显式列出待认领的 ID，O(log N)；`XAUTOCLAIM` 按「空闲阈值 + 起始游标」自己扫，官方标为故障恢复的实用模式，COUNT 较小时接近 O(1)（两者均已核实）。常规做法是每个 worker 除消费循环外再跑一个定时任务调 `XAUTOCLAIM`，把超时未确认的消息认领过来重做；多实例时这个任务要防并发（[分布式锁](/data-storage/distributed-lock)在这里派上用场），否则几个 worker 同时认领同一批。

必须点破的两个代价：

**其一，漏掉 `XACK` 不是「少一次确认」，而是内存只增不减。**PEL 是数据，每条未确认消息都占内存且永不过期——开头那个「三天后 session 被驱逐」就是这么来的：没有报错、没有告警，只有 `XPENDING` 的总数一路向上。自测方法：在无故障状态下隔一段时间跑两次 `XPENDING <stream> <group>`，持续增长即确诊（该方法未实测，但只依赖已核实的「`XACK` 从 PEL 移除」语义）。

**其二，重认领的窗口里，同一条消息可能同时被两个消费者持有。**`w1` 处理慢但没死，超过 `min-idle-time` 后 `w2` 把它认领过去，于是两边都在给同一个用户发欢迎邮件。这不是 bug，这就是**「至少一次投递」的定义本身**：允许重新认领，就必须接受重复处理。所以[第 5 章](/message-queue-cloud/delivery-semantics)的结论原样适用——`XAUTOCLAIM` 让你拿到 at-least-once，而「重复不产生错误副作用」永远是消费端幂等的责任，跟中间件无关。幂等键就用条目 ID 或业务自然键（[第 3 章](/message-queue-cloud/reliable-delivery)的粒度原则不变）。

最后一句诚实校准：**「Stream 默认不保证 at-least-once」这句话我没在核实的那页上找到原话**，所以按推论处理——「组 + `XACK` + 重新认领」三件套齐全，才构成一个至少一次的工作队列；只 `XREAD`（不带组）或只 `XREADGROUP` 不 `XACK`，都不是。确切措辞请自行核对 XACK 与 XAUTOCLAIM 命令页。

## 保留与修剪：消费完不删除，但这不是 Kafka

前面反复提到「条目不会随消费消失」。这是 Stream 与 List/RabbitMQ 传统队列最大的观念差别：**确认（`XACK`）处理的是「投递归属」，不是「数据生命周期」**。所以这些能力是免费的：回放（`XRANGE` 取历史）、新加一个消费者组从头读（`XGROUP CREATE` 时用 `0`）、事后排查（消息原文就在流里，不用在消费前打日志）。

代价是它会长大，你必须显式修剪。已核实的工具是两条：`XADD ... MAXLEN n` 在写入时顺带修剪，官方描述为「自动淘汰旧条目以维持恒定内存占用」；`XTRIM MAXLEN n` 显式修剪，`XTRIM MAXLEN ~ n` 是**近似修剪**、更省性能——近似意味着修剪后 `XLEN` 可能明显大于 n，第一次用它的人常把这个当成 bug。

我核实的那页**没有提到 `MINID`**，但按 ID 修剪才是表达「保留 7 天」的正确形式（ID 前段就是毫秒时间戳，把 7 天前的点算成 ID 去修剪，语义精确；用条数则会被流量绑架，就是开头那个坑）。落地前请核对 `XTRIM` 命令页确认 `MINID` 的可用性与版本要求，别照搬本站写法。

至于「这算不算 Kafka 的替代品」，答案在两条硬边界上：

1. **全部在内存里。**Redis 是内存数据库，持久化与复制是另一层话题（本章不核实 Streams 在 RDB/AOF 下的具体表述）；但**能被高效消费与修剪的数据必须驻留 RAM**。用 `maxmemory` 能算出你的流最多占多少，那就是保留上限——而且这个池子是跟缓存、会话共用的。Kafka 的前提是数据在磁盘上，日志可以到几百 GB。
2. **一个 key 就是一条流，不能水平切分。**你不能把一个逻辑流拆成多个分区摆到多台上，只能按业务维度分 key（`jobs:orders`、`jobs:emails`），于是分区该做的事全回到你手里，跨 key 的进度查询与运维成倍复杂。Redis Cluster 下多 key 操作的约束我未核实，上了 Cluster 请先核对官方关于跨 slot 的说明。

## 它适合什么：把「我已经有一个 Redis」当成决定性理由

选型章（[第 9 章](/message-queue-cloud/choosing)）会从八个维度系统比较，这里只讲 Stream 的定位逻辑。它的全部说服力来自一件事：**你已经在跑 Redis，而且它就在你的关键路径上。**

值得选它的场景：

- 消息量级在「Redis 内存装得下、且装下之后不影响缓存命中率」的范围内。这条要算：条目大小 × 保留条数 + 各组 PEL 的未确认条目，再对照你的缓存预算。
- 需要的是任务队列 + 少量回放，不需要复杂路由。典型是[第 1 章](/message-queue-cloud/why-async)那个「注册后发邮件」：一个流、一个组、几个 worker、一个 `XAUTOCLAIM` 定时任务、一个 dead 流。
- 你需要**天然限速**。拉取模型 + `COUNT` 意味着「worker 处理不过来就少拿」，削峰是结构自带的，不像 push 模型要靠 prefetch 调参。
- 你只有一台 VPS，运维预算是「不想再多一个组件」。多一个 RabbitMQ 就多一个要升级、备份、看日志、配告警的进程；Stream 复用了你已经配好的一切。

不该选它的场景，请一条条诚实对照：

- 消息本身可能超过几十 KB（报表、附件、序列化后的长对象）——你在用内存队列装文件。
- 需要按多种条件把一条消息路由给不同的队列：[第 6 章](/message-queue-cloud/rabbitmq)的交换机世界在这里没有对应物，只能靠多 key + 应用代码分发。在 Stream 里你设计的始终是「一条日志和谁读到哪」，**分发规则无处声明，只能写进代码——规则一变要发版的是代码，不是配置**。
- 需要 broker 侧的自动重投语义（连接断开即归还）。Stream 里「归还」不会自动发生，得有人显式认领；worker 短命或没人跑认领任务，消息就一直卡着。
- 保留窗口要到天/周级、或吞吐需要持续高写入、或消费者多到一台 Redis 撑不住。这三条同时是 Kafka 的入场理由（[第 8 章](/message-queue-cloud/kafka)）。
- 你的 Redis 已经因为缓存压力时不时触发驱逐——再加一个只增不减的日志，等于把队列和数据集放上同一架过载的飞机。

## 常见错误与排查

**1. 消费循环里没有 `XACK`。** 现象：功能一切正常，但内存曲线一路上升，某天时缓存大面积失效、用户被登出。原因：PEL 是数据不是状态，未确认条目永存。怎么确认：无故障状态下连续两次取 `XPENDING jobs workers`，持续增长即确诊。怎么修：成功路径补 `XACK`，失败路径**也**要处理（重认领交给别人，或搬 dead 流后确认原条目），不能「catch 里打个日志就完事」。

**2. 只用 `XREAD` 当工作队列。** 现象：同一个任务被执行了 N 遍，N 等于消费者数量。原因：`XREAD` 是读日志，不是领任务，它不维护归属也不做互斥。怎么确认：`XINFO GROUPS jobs` 里没有组，或 `XPENDING jobs workers` 报 group 不存在。怎么修：竞争消费必须 `XGROUP CREATE` + `XREADGROUP` + `XACK`，三者是一个整体。

**3. `XAUTOCLAIM` 的 `min-idle-time` 小于正常处理时长。** 现象：邮件发两遍、库存扣两次，日志里同一条 ID 被两个 worker 处理。原因：慢不是死，但认领不区分这两种情况。怎么确认：拿 `min-idle-time` 与处理时长的 P99 对比，前者 ≤ 后者即设计错。怎么修：阈值取处理时长上限的数倍，并**承认这是 at-least-once**、去补消费端幂等（[第 3 章](/message-queue-cloud/reliable-delivery)）。只调小阈值换「故障恢复更快」而不做幂等，是把正确性问题换成响应时间问题。

**4. 建组时用了 `0`，上线即重放全量。** 现象：新 worker 一启动，几百万条老消息涌进来，用户收到几年前的通知。原因：`XGROUP CREATE` 的起始位置决定新组是否读历史，`0` 就是从第一条开始。怎么确认：`XINFO GROUPS` 看该组的 last-delivered ID 是不是 `0-0` 起步。怎么修：只要从现在开始处理就选末尾（该参数确切写法请核对 XGROUP 命令页）；确实要回放，就让它成为独立于正常消费组的组，并在代码里限速。

**5. 把 `XLEN` 当积压指标。** 现象：`XLEN` 很小你以为没事，实际几十个消费者全闲着；或者反过来。原因：条目不随消费删除，`XLEN` 是日志规模，不是未处理数量。怎么确认：真正的积压是 `XPENDING` 的未确认数（已投递未处理）加上「组的 last-delivered 与流末 ID 的差」（还没投递的），而且**每个组各有一份 pending**。怎么修：这两项分开监控，做内存预算时把组数乘进去。传统队列那个「queue length 就是积压」的直觉在这里失效。

## 练习

<Exercise title="一组两消费者：写出每一步谁拿到了什么、PEL 里剩什么" difficulty="基础">

按官方语义阅读下面这段命令序列（不要执行，先手推），回答四个问题：(a) `w1` 和 `w2` 各拿到哪些条目 ID；(b) 第 4 步之后 PEL 里有几条、分别归属谁；(c) `audit` 组用 `0` 建组后能读到几条；(d) 第 5 步之后 `XPENDING jobs workers` 的数字变成多少。

```bash
XADD jobs * n 1                 # 记返回 ID 为 100-0
XADD jobs * n 2                 # 101-0
XADD jobs * n 3                 # 102-0
XGROUP CREATE jobs workers 0
XREADGROUP GROUP workers w1 COUNT 2 STREAMS jobs >
XREADGROUP GROUP workers w2 COUNT 2 STREAMS jobs >
XACK jobs workers 100-0
XGROUP CREATE audit 0            # 意图：另建一个审计组
XREADGROUP GROUP audit a1 COUNT 5 STREAMS jobs >
```

<template #answer>

(a) `w1` 拿到 `100-0`、`101-0`；`w2` 拿到 `102-0`（组内互斥：`COUNT 2` 到只剩一条时 `w2` 只拿到一条）。(b) PEL 有 3 条未确认，`w1` 两条、`w2` 一条，`XPENDING jobs workers` 报 3。(c) `audit` 能读到 **全部 3 条**——组的进度是**每组的属性**，不是每条消息的属性，这正是「一个流同时当任务队列和事件流」的实现方式。(d) `workers` 组剩 2 条；但 `audit` 另有 3 条未确认，**流上未确认总数是 5**。做内存预算要把组数乘进去，这正是上面常见错误第 5 条的根源。

另有一处写法错误：`XGROUP CREATE audit 0` 少了 stream 参数（应为 `XGROUP CREATE jobs audit 0`）。「key 在前、组在后」是 Stream 命令最容易敲错的顺序。

</template>

</Exercise>

<Exercise title="故意写坏三处：说出症状、确认手段和判据" difficulty="进阶">

下面三个 worker 片段各自都「能跑」，但都会在你上线之后出事。分别说明：出问题时用户或运维会看到什么现象、你用哪条只读命令确认根因、以及修复后的验收判据（判据必须是能观测的数字，不能是「我加了一行代码」）。

```js
// A：只处理成功路径
async function workerA() {
  while (true) {
    const [batch] = await redis.xreadGroup('workers', 'w1', { COUNT: 10, BLOCK: 5000 }, { key: 'jobs', ID: '>' })
    for (const { ID, message } of batch) {
      await sendEmail(message.n)          // 抛错时整条链路终止，且从不 XACK
    }
  }
}

// B：把条数当保留时间
await redis.xadd('jobs', '*', 'n', payload)   // 每次都带 MAXLEN ~ 100000

// C：用 XREAD 当队列，起 4 个进程
const [b] = await redis.xRead({ COUNT: 10, BLOCK: 5000 }, { key: 'jobs', ID: '>' })
```

（方法名与参数形式**以你所用客户端库的文档为准**，这里只表达调用顺序与语义；上面写法未在本机执行。）

<template #answer>

**A：漏 `XACK` + 无错误处理。** 现象：内存线性缓涨，某天缓存大面积淘汰、用户莫名掉线；同时总有人去认领未确认条目，邮件发多遍。确认：`XPENDING jobs workers` 单调增长，`XINFO GROUPS jobs` 的 `pending` 只升不降。修复判据：稳定负载跑 30 分钟，pending 在峰值后**能回落到接近 0**（要的是趋势，不是严格 0），且 `INFO memory` 的 `evicted_keys` 不再增长。修法不是只在成功路径补一行：失败要么重投、要么搬 dead 流后确认原条目，绝不能裸抛。

**B：策略错配。** 现象：回放窗口忽长忽短，低峰几天、高峰几小时，出事那天「消息没了」。确认：用 `XRANGE jobs - + COUNT 1` 取最老条目的毫秒段算出**实际保留时长**，在不同负载时段各测一次；这个时长是变量就确诊。修复判据：最老条目距今在任何负载下都落在承诺窗口内（如 7 天 ± 数小时），且你说得出这条承诺靠按 ID 修剪还是条数上界兑现。

**C：把日志当队列。** 现象：4 个进程各处理同一批消息，每任务执行约 4 次。确认：`XINFO GROUPS jobs` 里根本没有 `workers` 组；`XLEN` 不变而副作用次数随进程数线性增长（正是[第 5 章](/message-queue-cloud/delivery-semantics)的执行计数与副作用计数分离）。修复判据：各消费者拿到的 ID 集合交集为空，且 `delivery count` 之和等于总条目数。

三个案例的共性：Redis 不替你把「队列语义」补齐。组、确认、修剪、认领少做任何一件，系统照样跑，只是换一种方式坏——而且先坏的是你的缓存或别人的消息。

</template>

</Exercise>

<Exercise title="在一台 Redis 上设计：注册邮件 + 3 次重试 + 死信 + 可回放，并给出三条会失效的硬边界" difficulty="挑战">

约束：单实例 Redis（既做缓存又跑队列），2 个 worker 进程，日注册量 2 万，峰值 3 倍；发信服务偶发超时；要求同一条注册**不会发两封邮件**；卡住/反复失败的消息能被找到；上线后需要能回放最近 7 天的注册事件给一个新接入的数据组。请给出：需要几个 stream、几个组、每条命令的角色；重试计数从哪来；死信怎么进；7 天回放怎么兑现；处理时间阈值取多少及理由。最后写出这个设计**会在什么条件下不再成立**的三条硬边界——写成「数字 + 症状」，不要写「规模变大了就换 Kafka」。

<template #answer>

**结构**：`reg:emails`（工作流）、`reg:emails:dead`（死信）、可选 `reg:events`（不可变的注册事实流，专门给数据组回放）。两组：`workers`（消费并确认）；`emails-replay`（数据组，建组位置决定它是否读历史——想读全量就用 `0`，这是回放能力的真正来源）。

**正常链路**：生产者写业务库的同时用 outbox 落一条 `XADD reg:events`（[第 3 章](/message-queue-cloud/reliable-delivery)），再由一个组把它转成 `reg:emails` 任务。worker 循环 `XREADGROUP GROUP workers <consumer> COUNT 5 BLOCK 5000 STREAMS reg:emails >` → 发信 → 成功 `XACK`；超时则**复制一条带 `attempt n+1` 的新条目、再 `XACK` 原条目**（计数落在你手里、可解释，也才能做出[第 4 章](/message-queue-cloud/dlq-delay-order)要的退避）；`attempt >= 3` 搬进 `reg:emails:dead` 并告警。也可以完全靠 PEL 重试——`XPENDING` 的 delivery count 就是现成计数（已核实），代价是节奏只能由 `min-idle-time` 决定、无法退避。**两种做法都必须有幂等键**（条目 ID 或用户 ID）写进去重表（复用 [session-rate-limit-idempotency](/data-storage/session-rate-limit-idempotency)），否则认领窗口内一定发两封。

**故障恢复**：每个 worker 附带一个 30 秒的 `XAUTOCLAIM reg:emails workers <self> 120000 0 COUNT 20` 定时任务。`min-idle-time` 取 120 秒的理由：发信超时上限假设 30 秒加本地重试，处理时长 P99 远小于它；阈值必须显著大于 P99，否则就是常见错误第 3 条。多实例时这个任务要加锁（[分布式锁](/data-storage/distributed-lock)），否则同一批消息被多个方向抢。

**7 天保留**：只有 `reg:events` 需要 7 天窗口，按 ID 修剪（7 天前的毫秒时间戳拼 `-0` 作 `MINID` 界；该形式本章未核实，先查 `XTRIM` 命令页）。`reg:emails` 是工作流，常态应接近空，`MAXLEN` 或按空闲修剪都行——把工作流与事件流拆成两个 key，保留策略才可能各就各位，这正是练习 2 里 B 的正面版本。

**内存预算（必须写出数字）**：2 万/日 × 峰值 3 倍 = 6 万条事件/日；假设每条含结构开销展开约 500 B（请用 `XLEN` × 采样大小实测），约 30 MB/日 → 7 天约 210 MB，再加各组 PEL 未确认与 `dead` 流。这个数字能不能塞进 `maxmemory` 的剩余预算，是设计成立与否的第一道判断，而不是上线后再看。

**三条硬边界（数字 + 症状）**：

1. **RAM 边界**：日志占掉可用内存的两三成时，`evicted_keys` 上升、命中率下滑、用户掉线——驱逐先于修剪动手，「保留 7 天」自动作废。解法是把事件流搬出去（对象存储/业务库），Stream 只留工作流。
2. **单 key 边界**：写入全落一个 key，峰值持续超过数千条/秒（本章未压测，请以实测为准）时，`BLOCK` 超时、`XPENDING` 常态不为 0、`XADD` 变慢。Redis 命令单线程执行，这不是调参问题；解法是按业务维度分 key，或换 Kafka 的分区模型（[第 8 章](/message-queue-cloud/kafka)）。
3. **认领语义边界**：出现「绝对不能重复」的副作用（扣款、发码）时，幂等表也救不了重复成本（幂等只保证副作用一次，不保证不重复执行——[第 5 章](/message-queue-cloud/delivery-semantics)）。要换的是结构而不是参数：不可重复的副作用放进有事务保证的业务库，队列只做「尝试」和「通知」。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Redis 官方文档 · Streams 概览](https://redis.io/docs/latest/develop/data-types/streams/) —— **本批已核实**：条目 ID 的两段格式与时钟回拨规则、同毫秒序号、组内消息互斥分发、`XREADGROUP` 的 `>`、`XACK` 与 PEL 的关系、`XPENDING` 明细含 idle time 与 delivery count、`XCLAIM` O(log N) 与 `XAUTOCLAIM` O(1)（COUNT 较小）及其作为故障恢复模式、`XADD MAXLEN` 自动限长、`XTRIM MAXLEN ~` 近似修剪。核实时间 2026-10-20。
- [Redis 命令参考](https://redis.io/docs/latest/commands/) —— 用于核对本站**未确认**的三处：`XTRIM` 的 `MINID` 形式、`XGROUP CREATE` 起始位置参数（含 `$` 的确切语义）、Streams 在 RDB/AOF 与复制下的行为。本章涉及这三处的句子只描述机制，不给版本或参数断言。
- 站内衔接：[核心概念](/message-queue-cloud/mq-concepts)（竞争消费与发布订阅、队列与日志——Stream 同时是这两者）；[可靠投递](/message-queue-cloud/reliable-delivery)（幂等键粒度，这里直接用条目 ID）；[死信、延迟与顺序性](/message-queue-cloud/dlq-delay-order)（Stream 给 delivery count 原料，策略仍在你代码里）；[投递语义](/message-queue-cloud/delivery-semantics)（重新认领 ⇒ at-least-once ⇒ 必须幂等）；[RabbitMQ](/message-queue-cloud/rabbitmq)（push + prefetch 对照拉取 + COUNT）；[Kafka](/message-queue-cloud/kafka)（内存日志与磁盘日志的边界）；[选型对照](/message-queue-cloud/choosing)。
- 三条硬边界的 precondition 在[数据存储进阶](/data-storage/)已有正文，本章只做队列视角的映射：[Redis 数据结构](/data-storage/redis-data-structures)、[Redis 持久化](/data-storage/redis-persistence)、[过期与驱逐](/data-storage/expiry-and-eviction)、[分布式锁](/data-storage/distributed-lock)（多实例下避免互相抢占）、[会话、限流与幂等](/data-storage/session-rate-limit-idempotency)（幂等键落地处）。
- [Docker Compose](/devops/docker-compose) —— 把「应用 + worker + Redis」编排在一起；Redis 已在跑的话不需要新起容器。

## 下一章

Redis Stream 的边界是**内存**和**单 key**：数据必须驻留 RAM，一个逻辑流不能切开。Kafka 恰恰把这两条反过来——日志在磁盘上、一个主题切成多个分区分布在不同 broker 上，代价是运维复杂度，以及一套不同的消费进度模型（偏移量而不是条目 ID）。读完 [Kafka：高吞吐日志流](/message-queue-cloud/kafka)就能进入[选型对照](/message-queue-cloud/choosing)：那里不比功能清单，而是按业务语义、投递与确认、顺序、吞吐、积压恢复、保留、运维复杂度和成本八个维度做决定。
