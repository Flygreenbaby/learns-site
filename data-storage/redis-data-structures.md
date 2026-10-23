# Redis 基础：选错结构，同一个需求会贵十倍、还顺手阻塞主线程

三份代码在做同一件事——缓存用户资料。第一份把它序列化成 JSON 塞进一个 String，改头像时先 `GET` 整个对象、在应用里改一个字段、再 `SET` 回去；上线后偶尔出现「头像新了、昵称旧了」，因为两个并发请求互相覆盖了整个对象。第二份用 Hash（`HSET user:1 avatar ...`），覆盖没了，但监控里发现有 key 挂了 800 个字段，一次 `HGETALL` 返回 300KB，带宽被这一个 key 打满。第三份用 Hash 且把大字段挪出去了，看起来最正确——直到有人在业务高峰敲了一次 `KEYS user:*` 想统计数量，**整个实例停了几百毫秒，所有接口同时超时**。

三个故障都在同一个实例上，都不是「Redis 慢」，而是**用法与数据结构不匹配**。上一章用四笔算术说明了我们为什么需要这一层（见[数据存储进阶要解决什么](/data-storage/why-this-layer)），这一章把那些算术落到具体命令上：**同一个业务问题该用哪个结构、复杂度是多少、什么时候会退化、哪条命令会把单线程的 Redis 卡住**。

## 五种基本类型是五种解决模式，不是五个容器

先把「类型」理解成「模式」，选择会容易很多。
| 类型 | 它解决的抽象问题 | 定位命令 | 典型退化点 |
| --- | --- | --- | --- |
| String | 一个不可分割的值：计数器、序列化对象、锁 token、二进制块 | `SET` `GET` `GETRANGE` `SETRANGE` `INCRBY` `APPEND` | 值太大（几百 KB）→ 单次读写就是一次网络阻塞；整体覆盖导致并发丢更新 |
| Hash | 「一个对象的若干字段」，允许只改一部分 | `HSET` `HGET` `HINCRBY` `HLEN` `HSCAN` | 字段数无上限地长 → `HGETALL` 变成大 key；字段值放二进制 → 内存失控 |
| List | 有顺序的双端队列 / 最新 N 条 | `LPUSH` `RPUSH` `LPOP` `RPOP` `LRANGE` `LTRIM` `BLPOP` | 用 `LINDEX` / `LSET` 访问中间位置（两端 O(1)、中间 O(N)）；只塞不删 → 无限长 |
| Set | 去重 + 集合运算 | `SADD` `SREM` `SISMEMBER` `SMEMBERS` `SINTER` `SUNION` `SDIFF` | 需要顺序时仍把成员全取回应用里排序；拿 `SMEMBERS` 一次取十万成员 |
| Sorted Set | 按分数排序 + 排名 + 范围取 | `ZADD` `ZSCORE` `ZRANK` `ZREVRANGE` `ZRANGEBYSCORE` `ZPOPMAX` | 大量元素共享同一分数 → 顺序退化为字典序且范围扫描量激增 |

复杂度口径：Redis 每个命令页都标了 `Complexity`，本章数字按「底层结构 + 官方标注」给出，**动手前以[官方命令页](https://redis.io/docs/latest/commands/)你所用版本的标注为准**。

<Callout type="unverified" title="本章所有 redis-cli 交互都是预期结果，不是实测">

本机（Windows + Node v25.4.0）**没有 Redis 服务、也没有 redis-cli**，本章不声称执行过任何一条 Redis 命令。所有 `redis-cli>` 代码块都是「预期结果」：写法与返回格式参照官方文档，默认值与语义参照文末列出的官方页面。要复现，按领域首页的环境说明用 Docker 或 WSL2 起实例，再逐条对照。

</Callout>

## 业务问题 → 结构 → 命令序列 → 什么时候换掉它

下面九组是本领域最高频的映射。

### 1. 对象详情缓存且要局部更新 → Hash

```text
HSET user:1024 name 张三 view_cnt 0 last_visit 1729180800   → 预期 (integer) 3
HINCRBY user:1024 view_cnt 1                               → 预期 (integer) 1
HGET user:1024 view_cnt                                    → 预期 "1"
HDEL user:1024 last_visit                                  → 预期 (integer) 1
```

**为什么不是 String**：`HINCRBY` 是服务端原子的局部更新，String 方案是「读—改—写」三步，并发下必丢更新（上一章练习 3 就是这个）。**为什么不是 4 个独立 key**：官方内存优化文档建议「能使用 Hash 就用 Hash」——小 Hash 用 listpack 编码，几个字段只占很少内存，而 4 个 String key 要付 4 份 key 对象、4 份哈希表桶和 4 份过期元数据。**什么时候换掉**：字段里出现大值（富文本、图片 base64）就把大值挪去对象存储；字段数无上限增长（每天一条记录塞同一个 Hash）就按时间拆 key。

### 2. 计数与限流 → String + INCR

```text
INCR page:view:1024                      → 预期 (integer) 1
INCRBY rate:user:1024:api 1              → 预期 (integer) 1
SET nx_key token NX EX 30                → 预期 1（NX：不存在才写，这是锁的地基）
GETSET counter ""                        → 预期 "37"（取值并清零，一次往返完成）
```

**为什么不是 `GET`+`SET`**：单命令原子，**不需要锁**（本章最重要的一句话）。**什么时候换掉**：需要滑动时间窗时改存 Sorted Set 事件时间戳；大量并发写同一 key 时它已经是热 key，见下文。

### 3. 排行榜 / Top N → Sorted Set

```text
ZADD rank:game 1200 alice 1500 bob 900 carol        → 预期 (integer) 3
ZREVRANGE rank:game 0 9 WITHSCORES                  → 预期 分数从大到小的 (member, score) 对
ZREVRANK rank:game alice                            → 预期 (integer) 1
ZRANGEBYSCORE rank:game 1000 +inf LIMIT 0 5         → 预期 分数不低于 1000 的前 5 个
ZINCRBY rank:game 50 alice                          → 预期 "1250"
```

复杂度：`ZADD` 平均 O(log N)，`ZREVRANGE` 是 O(log N + M)（M 为返回成员数），`ZREVRANK` O(log N)。**为什么不是 List**：List 的顺序来自插入，分数变了就得整个重排；ZSET 让「按分数排序」成为结构本身的性质。**什么时候换掉**：需要「同分按时间先后」时把时间戳编进分数（官方 ZSet 文档就推荐这个技巧：`score = 主分数 * 2^32 + (2^32 - timestamp)`），或改成分片榜单 + 定期合并。

### 4. 去重、交并差（共同好友、标签命中）→ Set

```text
SADD tag:post:88 vue redis sql            → 预期 (integer) 3
SISMEMBER tag:post:88 redis               → 预期 (integer) 1
SINTER follow:alice follow:bob            → 预期 两人都关注的人（交集）
SADD like:post:88 uid:1024                → 预期 (integer) 1；重复加返回 (integer) 0
```

**为什么不是 List**：`SISMEMBER` 在 Set 是 O(1)、在 List 是 O(N)，而且 Set 天然去重——`SADD` 重复成员返回 0，这个返回值就是一次「你之前点过赞」的判断，见[幂等](/data-storage/session-rate-limit-idempotency)。**为什么不用 ZSET 代替**：Set 的成员无分数、内存更省，能用 Set 就别用 ZSET。**什么时候换掉**：要「按时间顺序 + 去重」就用 ZSET（成员 id、分数时间戳）。

### 5. 最新 N 条 / 简单任务队列 → List

```text
LPUSH feed:user:1024 item:9001 item:9002   → 预期 (integer) 2
LTRIM feed:user:1024 0 99                  → 预期 OK（只保留最新 100 条，防无限增长）
LRANGE feed:user:1024 0 19                 → 预期 前 20 个成员
BRPOP queue:mail 5                         → 预期 弹出尾部元素，5 秒内无元素则返回 nil
```

**为什么不是 Stream**：只要「最新 N 条 + 单消费者弹出」时 List 更简单；一旦需要**多消费者组、每条消息独立 id、ack 与 pending 重投**，List 就装不下了，见第 9 组。**什么时候换掉**：列表长到几万条就该分页/分片；用 `LINDEX` 遍历整个列表是 O(N²) 的经典错误（要批量就 `LRANGE` 一次取）。

### 6. 签到、活跃标记、按 id 存一位 → Bitmap（String 的位视图）

```text
SETBIT sign:2026-10-17:uid1024 0 1   → 预期 (integer) 0（返回旧值）
BITCOUNT sign:2026-10-17             → 预期 当天签到人数
BITOP AND both a b                   → 预期 结果长度（字节数）
```

用「用户 id 作为位偏移」的写法，官方内存优化文档给的量级很直观：**1 亿用户的这类信息只需 12MB 内存**（1 亿条独立 key 是绝对装不下的）。**退化点**：偏移稀疏时位图被撑到最大偏移对应的长度——用 `user:999999999` 做偏移就意味着 125MB 的 String，所以「按天 + 全局偏移」的用法必须建立在 **id 连续递增** 上，稀疏 id 要改「按 id 分桶 + 桶内偏移」。

### 7. 基数统计（UV、每日独立访客数）→ HyperLogLog

```text
PFADD uv:2026-10-17 uid1 uid2 uid3   → 预期 (integer) 1（内部状态有变化时为 1）
PFCOUNT uv:2026-10-17                → 预期 3
PFMERGE uv:week uv:2026-10-11 ...    → 预期 OK
```

定位很清楚：**只回答「有多少个不同元素」，不能回答「某元素在不在」，也不能列出成员**。价值在于内存不随基数增长——固定一小段开销就能统计到十亿级元素，误差在百分位量级（**具体字节数与标准误差以[官方 HLL 文档](https://redis.io/docs/latest/develop/data-types/probabilistic/hyperloglogs/)为准，本章未核实**）。**替代判断**：要「精确去重计数」回到 `SADD` + `SCARD`，别用 HLL 做财务口径；要成员存在性用 Set。报表口径要写进需求，别到最后一天才发现两套统计对不上。

### 8. 附近的人 / 地理围栏 → Geo（底层就是 Sorted Set）

```text
GEOADD shop 116.40 39.90 门店A 121.47 31.23 门店B   → 预期 (integer) 2
GEORADIUS shop 116.41 39.91 5 km WITHCOORD          → 预期 5km 内的门店
GEOPOS shop 门店A                                   → 预期 经纬度对
```

它把「经纬度 → 一个分数」编码进 ZSET，所以范围查询复用 ZSET 的对数复杂度。**退化点**：`GEORADIUS` 返回集无上限时依然是一次大 key 读取，务必配 `COUNT`；数据没有地理属性时不要为了「去重」用 Geo。

### 9. 事件流、多消费组、ack → Stream

```text
XADD orders * uid 1024 amount 39.9          → 预期 形如 1729180800123-0 的条目 id
XREAD GROUP 组1 CONSUMERS 工人1 COUNT 10 STREAMS orders >   → 预期 未投递过的条目
XACK orders 组1 1729180800123-0             → 预期 (integer) 1
XPENDING orders 组1                         → 预期 已投递未 ack 的统计
```

Stream 是「Redis 里的轻量消息队列」：条目有稳定 id、有消费组、有 pending 与 ack、能 `XCLAIM` 接管死掉消费者的消息。**什么时候不够用**：需要「大量 topic、顺序性保证、持久化回溯、复杂路由」时该上真正的消息队列（见[Redis Stream：轻量级队列](/message-queue-cloud/redis-stream)与[三者选型对照](/message-queue-cloud/choosing)）。**容量规划注意**：Stream 的条目不会自己消失，要靠 `XTRIM` / `MAXLEN`。

## 编码转换：同一类型背后有两套实现

Redis 对小集合用紧凑的线性结构，超过阈值自动换成通用结构。**这一步对用户不可见，但决定内存与延迟**。官方内存优化文档写明：Hash、List、仅含整数的 Set、Sorted Set 在小于给定元素数与元素大小上限时使用特殊编码，**可省下最多 10 倍内存（平均约 5 倍）**；超过配置上限时「Redis 会自动转换为普通编码」。

| 类型 | 小编码 | 大编码 | 官方列出的阈值配置项与默认值（Redis 7.0） |
| --- | --- | --- | --- |
| Hash | listpack | hashtable | `hash-max-listpack-entries 512`、`hash-max-listpack-value 64` |
| Sorted Set | listpack | skiplist + hashtable | `zset-max-listpack-entries 128`、`zset-max-listpack-value 64` |
| Set（纯整数） | intset | hashtable | `set-max-intset-entries 512` |
| Set（非整数，7.2+） | listpack | hashtable | `set-max-listpack-entries 128`、`set-max-listpack-value 64` |
| List | listpack | quicklist | list 的 listpack 阈值项同名存在，**默认值请用 `CONFIG GET *listpack*` 在你自己的实例上读**（官方内存优化页的默认值清单里未列全，本章未核实） |

对照要点：Redis 6.2 及更早同名配置项是 `hash-max-ziplist-entries 512` / `zset-max-ziplist-entries 128` / `set-max-intset-entries 512`，7.0 起 ziplist 被 listpack 替换（配置项也改名），7.2 起 Set 也能用 listpack。**这些数字来自官方内存优化文档的默认值清单，是核实过的；但阈值会随版本调整，动手前 `CONFIG GET` 一遍。**

怎么确认某个 key 现在是什么编码：

```text
OBJECT ENCODING user:1024   → 预期 "listpack" 或 "hashtable"
MEMORY USAGE user:1024      → 预期 该 key 的大致字节数
```

三个直接影响写法的事实：

1. **转换是 CPU/内存的交换，不是纯收益**。listpack 是线性数组，结构内查找是 O(N)（字段少时靠 CPU cache 友好反超哈希表，官方文档正是这么解释的）；元素上千后 `HGET` 的常数就不好看了。这是「小 Hash 极省内存、巨型 Hash 既是 CPU 问题又是大 key 问题」的根因。
2. **转换通常不会因为元素变少而自动退回小编码**：官方只描述「溢出上限时转换为普通编码」。真要重建成紧凑编码，做法是重写一个新 key。**这条属版本相关行为，以你实例的 `OBJECT ENCODING` 实测为准（本章未核实）。**
3. **字段级不能过期**：文档明确小编码下字段没有独立过期时间，这是设计层面的限制——TTL 只作用于**整个 key**。所以「每个字段一个倒计时」的模型必须拆成多个 key。

调阈值前先测 key 大小分布（`--bigkeys` 或离线采样）。**默认值几乎从不是问题，问题都在少数越界的 key 上。**

## 大 key 与热 key：两个不同的病，两套不同的检查

| 维度 | 大 key | 热 key |
| --- | --- | --- |
| 定义 | 单个 key 的 value 体积或成员数过大（经验阈值：String 值 > 10KB、集合成员 > 5000，**这是工程经验值不是官方规定**） | 单个 key 承担远超平均的访问量 |
| 伤害 | 一次命令阻塞主线程、网络被打满、过期删除卡顿、迁移/复制不均 | 单个分片 CPU/带宽先到极限，集群也救不了 |
| 症状 | p99 与流量不相关地抖动、`blocked_clients` 抬升 | QPS 曲线上某一刻某个 key 独占大部分流量 |
| 识别 | `redis-cli --bigkeys`（SCAN 采样式扫描）、`MEMORY USAGE`、离线 RDB 分析 | `INFO commandstats` 看不出具体 key；`redis-cli --hotkeys` 需要实例用 LFU 淘汰策略才能给出候选 |
| 处理 | 拆分成多个 key（分桶）、压缩、大值改存对象存储、用 `UNLINK` 异步删除 | 本地二级缓存、把单 key 拆成 N 个子 key 再聚合、读写分离到副本 |

上一章的 CMS 模拟在这里落地：热点识别**只需要不低估**，所以 64KB 的近似统计足够找出 top-N，而精确计数容器会随 key 基数无限增长（本次模拟里涨到 856 个 key）。注意 `--bigkeys` 是 SCAN 采样，**可能漏掉刚出现的大 key**；大 key 的删除也是单独一课：`DEL` 一个几百万元成员的 key 时释放内存也在主线程，要改 `UNLINK`（**lazyfree 的默认行为与版本相关，以你版本的命令文档为准，本章未核实**）。

## SCAN 为什么不阻塞，KEYS 会

```text
SCAN 0 MATCH user:* COUNT 100   → 预期 两个元素：下一个游标 + 本批 key 列表
DBSIZE                          → 预期 key 总数（O(1)，统计不需要遍历）
```

`KEYS pattern` 一次性遍历整个顶层字典并把全部匹配项攒进回复——**O(N) 的阻塞**，N 是 key 总数而不是匹配数。Redis 的命令执行是单线程的（版本口径以官方文档为准），所以它在 500 万 key 的实例上会让所有客户端排队，就是开头那个「所有接口同时超时」。

`SCAN` 用游标把遍历切成很多小步：每次只走一小段桶，返回「下一个游标 + 这一批结果」，游标回到 0 表示结束。代价换来的是**语义上的宽松保证**：

| 保证 | 具体含义 |
| --- | --- |
| 一定看到「全程存在」的 key | 一个 key 若在整个迭代期间一直存在，一定会被返回至少一次 |
| 可能看到迭代中途被删的 key | 它在扫描到对应桶之前都存在即可 |
| **不保证**看到迭代中途新建的 key | 可能出现，也可能不出现 |

正确用法：游标循环到 0、每批 `COUNT` 几十到几百、服务端只做 `MATCH` 筛选，真正的重活（逐个 `MEMORY USAGE`、`TTL`）分散到多轮。**统计数量一律用 `DBSIZE`**；集群下要逐主节点执行。

## pipeline 与 MULTI/EXEC：一个是网络批量，一个是原子执行，都不回滚

这是本章最容易被写错的一节。

| 你要解决什么 | 用什么 | 为什么 |
| --- | --- | --- |
| 减少往返（10 条命令 10 个 RTT） | pipeline | 只省网络，服务端仍逐条执行，**中间可能插入别的客户端命令** |
| 一组命令不被别的客户端插在中间执行 | `MULTI`/`EXEC` | 官方保证：事务内命令串行执行，别的客户端请求**绝不会**在 EXEC 执行过程中被服务 |
| 条件判断 + 原子（读旧值决定写什么） | Lua 脚本 | 脚本本身是事务性的，能边判断边写；官方文档说多数事务能做的手段脚本更简单更快 |
| 出错要撤销前面已执行的命令 | **Redis 没有这个能力** | 见下 |

官方事务页的原话是：`Redis does not support rollbacks of transactions since supporting rollbacks would have a significant impact on the simplicity and performance of Redis.`（Redis 不支持事务回滚，因为回滚会显著影响简单性与性能。）错误要分两种时刻看：

1. **入队时就报错**（命令名不存在、参数个数错、或 `maxmemory` 已达上限这类致命状况）。自 Redis 2.6.5，服务端在累积命令阶段检测到错误后会**拒绝执行整个事务**，`EXEC` 返回错误并丢弃事务。所以「语法错误 → 全事务不执行」是对的。
2. **`EXEC` 执行时才报错**（对 String 值执行 list 操作这类运行时类型错误）。官方明确：**其他命令照样执行**，不会因为一条失败而停止。官方给出的原始协议示例（telnet 直连，可直接读作返回结构）：

```text
MULTI
+OK
SET a abc
+QUEUED
LPOP a
+QUEUED
EXEC
*2
+OK
-WRONGTYPE Operation against a key holding the wrong kind of value
```

`SET a abc` 入队时语法合法，所以队列检查放过它；`EXEC` 时 `LPOP a` 撞上类型错误，而 `a` 已被写成 `abc` 这个事实**不会被撤销**。**这就是「Redis 事务不支持回滚」的全部含义**：把「有回滚的关系型事务」的心智模型搬到这里，就是生产事故。

`WATCH` 提供的是**乐观锁（check-and-set）**，不是回滚：

```text
WATCH stock:1        → OK（从此刻起监视）
GET stock:1          → "10"
MULTI
DECR stock:1
EXEC                 → 预期：若期间 stock:1 被改动，返回 nil（事务被放弃，一条命令都没执行）
```

三个容易踩的细节：**(a)** 官方说明 `WATCH` 的触发包括 **Redis 自己的过期与淘汰**——key 因 TTL 到点被清掉也算「被修改」，所以带 TTL 的 key 上做 CAS 会莫名重试；**(b)** `EXEC` 之后无论成功还是放弃都会 `UNWATCH` 全部 key；**(c)** 事务内的命令不会触发 `WATCH` 条件（它们只是入队）。

pipeline 的边界要单独说：**入队时不做语法拒绝、执行时逐条返回**。放一条参数个数错的命令，你会在一堆回复里拿到一个 error 元素，其余命令照做——这跟 `MULTI` 的「入队检查 + 整体放弃」是两套行为。别假设 pipeline 有任何原子性。

## TTL 与内存：key 级过期，加上淘汰才是完整的生命周期

```text
SET k v EX 60        → OK（60 秒后过期）
SET k v KEEPTTL      → OK（换值但保留原来的过期时间——写回缓存时几乎总要它）
EXPIRE k 30          → 预期 1（成功设置）；对不存在的 key → 0
TTL k                → 预期剩余秒数；-1 = 永不过期，-2 = key 不存在
```

与内存相关的三条机制（细节在[第 4 章](/data-storage/expiry-and-eviction)，这里给结论）：

- **过期不即时回收**：Redis 混合「主动抽样删除 + 惰性删除」，所以过期后 `used_memory` 不会立刻掉——**别用 RSS 判断 TTL 有没有生效**。
- **内存到 `maxmemory` 才谈淘汰**：默认策略在文档里被描述为「较老版本中不是 `noeviction`」，**动手前 `CONFIG GET maxmemory-policy` 读实例真实值**——缓存实例与存会话的实例该配不同策略（前者可 `allkeys-lru`，后者要 `noeviction`，否则登录态被随机淘汰）。
- **TTL 打散**：上一章那张表是硬数据——同一批 5 万个 key 无抖动地在 60 秒过期，回源峰值等于全部读流量（20000 qps）；加 ±30 秒抖动后降到 418。**代码里写 `EX 60` 之前，先想这行会在整点造成什么。**

## 排障三件套：INFO、MEMORY USAGE、SLOWLOG

| 命令 | 你要看的那几行 | 它告诉你什么 |
| --- | --- | --- |
| `INFO` | `used_memory_human`、`used_memory_rss`、`mem_fragmentation_ratio` | 逻辑用量 vs 实际占用；碎片率高说明删多写少，考虑重启/迁移 |
| `INFO` | `evicted_keys`、`expired_keys` | 有淘汰发生 = 有数据被策略删过，业务必须能解释；一直为 0 而内存吃满则要查 TTL 漏设 |
| `INFO` | `instantaneous_ops_per_sec`、`keyspace_hits/misses` | 命中率、当前流量水位（配合上一章的四笔算术） |
| `INFO` | `rdb_last_bgsave_status`、`aof_last_write_status`、`latest_fork_usec` | 持久化健康度；fork 耗时直接预示大实例的卡顿（第 3 章展开） |
| `INFO commandstats` | `cmdstat_keys`、`cmdstat_hgetall` | 哪类命令在被滥用；出现 `keys` 就是事故候选 |
| `MEMORY USAGE key` | 一个数 | 单个 key 的字节数（近似，可带 `SAMPLES`），排查大 key 的最小成本动作 |
| `SLOWLOG GET 10` | 每条记录含耗时、命令与时间戳 | **只记录命令自身执行时间，不含网络与队列等待**；`slowlog-max-len` 决定能留几条 |

`SLOWLOG` 的阈值单位是微秒（**默认值请以 `CONFIG GET slowlog-log-slower-than` 为准，本章未核实**）。它的盲区：一条 `KEYS` 只出现一次，但那一次可能真的阻塞了 800ms——**慢日志给你「哪条命令慢」，不给「谁被它拖累」**。

## 常见错误与排查

**1. 用 `KEYS *` 在生产实例上查东西，接口集体超时。** 现象：某一刻所有请求排队，CPU 一个核 100%，之后自己好了。原因：O(全部 key 数) 的阻塞遍历。确认：`INFO commandstats` 里有没有 `cmdstat_keys`，慢日志有没有那条。修法：`SCAN` 游标循环 + `DBSIZE` 统计；生产用 `rename-command` 关掉 `KEYS`。

**2. `GET` 后 `SET` 的读改写造成偶发丢更新。** 现象：字段值随机旧回去，单线程重跑一切正常。原因：不是原子操作，两个并发请求互相覆盖。修法：改用原生命令（`HSET` 局部字段 / `INCRBY` / `HINCRBY`），或用 Lua 把判断写进脚本；**别指望 `MULTI/EXEC` 帮你「回滚」**。

**3. 一个大 Hash 装下所有用户的所有字段。** 现象：`HGETALL` 一次返回几百 KB，p99 毛刺，`MEMORY USAGE` 显示单 key 数十 MB。原因：把 Hash 当表用（`HSET user:1 log:2026-10-01 ...` 无限加字段）。确认：`OBJECT ENCODING` 是 `hashtable`、`HLEN` 上千。修法：按时间/分桶拆 key，大值挪去对象存储，读取改用 `HMGET`/`HSCAN`。

**4. 以为 pipeline 有原子性。** 现象：批量写了一半失败，剩下的仍然生效，缓存里出现半新半旧的一组 key。原因：pipeline 只省往返，服务端逐条执行，中途可能被别的客户端插入，失败也不回滚。修法：需要「不被插入」用 `MULTI/EXEC`；需要「条件 + 原子」用 Lua；「失败就别应用」的语义只能**在业务层加版本号或幂等键**，见[缓存一致性](/data-storage/cache-consistency)与[幂等](/data-storage/session-rate-limit-idempotency)。

**5. 拿 `MEMORY USAGE` 当精确账单。** 现象：所有 key 加起来与 `used_memory` 差好几倍，怀疑内存泄漏。原因：它是单 key 的近似（含采样，不含全局元数据、分配器开销与复制缓冲区）。确认：`MEMORY STATS` 看 `overhead.*` 与 `dataset` 分类。修法：容量规划按「数据集 + 输出缓冲 + 复制缓冲 + 峰值余量」估，别拿单 key 求和。

## 练习

<Exercise title="练习 1 · 给七个需求选结构" difficulty="基础">

为每个需求写出结构与核心命令（2–3 条），并各配一句「为什么不是别的结构」：① 微博「点赞数 + 我是否点过」；② 大促商品详情页缓存（要局部改价格字段）；③ 每天有多少独立访客；④ 用户最近浏览的 50 个商品；⑤ 全量用户的「今日是否签到」。

<template #answer>

① **Hash**：`HINCRBY post:88 like_cnt 1` + `HSET like:post:88 uid:1024 1`，「是否点过」用 `HEXISTS`（`SADD` 返回 0 即重复）。不能用 String 存 JSON：读改写丢更新。
② **Hash**：`HSET item:88 price 99 stock 3` + 只读需要的 `HMGET`。不用 String 是整体覆盖 + 大 value；不用多个独立 key 是因为小 Hash 的 listpack 编码省数倍内存。
③ **HyperLogLog**：`PFADD` + `PFCOUNT`。Set 也能做但内存随基数线性涨；HLL 内存固定，代价是有误差、不能列成员。
④ **List**：`LPUSH` + `LTRIM key 0 49` + `LRANGE key 0 9` 分页。要「按访问时间重排」就换 ZSET（分数=时间戳），因为 List 的顺序只来自插入。
⑤ **Bitmap**：`SETBIT sign:2026-10-17 <偏移> 1` + `BITCOUNT`。1 亿用户 12MB（官方量级），独立 key 方案差几个数量级；id 稀疏时要分桶。另两问的附带答案：3 公里内门店用 **Geo** + `GEORADIUS ... COUNT n`；「订单超时自动关闭」用 **ZSET**（分数=到期时间戳，`ZRANGEBYSCORE key 0 <now>` 轮询后 `ZREM`），List 做不到按到期时间取。

</template>

</Exercise>

<Exercise title="练习 2 · 判断编码与阈值" difficulty="进阶">

某 Hash 有 400 个字段，每个字段值是 200 字节的 JSON 片段。Redis 7.0 默认配置下它的编码是什么？如果把它换成 60 个字段、每字段 1KB 呢？第三个 key 是 600 字段的纯整数 Hash 呢？

<template #answer>

依据官方默认值：`hash-max-listpack-entries 512`、`hash-max-listpack-value 64`。

- 400 字段 / 200B 值：**字段数没越界，但单值 200B > 64B → 转成 hashtable**。这是最容易踩的一条：很多人只盯着元素个数。
- 60 字段 / 1KB 值：同样因为值超 64B → **hashtable**，而且它还是个小 value 大 key 候选。
- 600 字段纯整数 Hash：Hash 不看值类型只看值长度，600 > 512 → **hashtable**。（`set-max-intset-entries 512` 是 **Set** 的规则，别串到 Hash 上——这是本题的第二个陷阱。）

验证方式：`OBJECT ENCODING key`、`MEMORY USAGE key`、`CONFIG GET "*listpack*"` 先读实例真实阈值。**（本机无 Redis，上述结论来自官方文档的默认值清单，未在实例上验证。）**

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误：以为 MULTI 会回滚" difficulty="挑战">

下面是「扣库存 + 加销量」的并发保护代码，Redis 7.0 默认配置。上线后发现库存偶尔被扣成负数，而且当中间那条命令报错时，前面已经生效的写并没有撤销。逐条解释：`MULTI/EXEC` 到底保证了什么、没保证什么，以及这份代码应该怎么改。

```text
MULTI
DECRBY stock:88 1
LPUSH sales:88 order:42
INCRBY stock:88 abc      ← 预期报错：increment 参数不是合法数字
EXEC
```

再回答第二个问题：把 `DECRBY` 换成 `GET stock:88` + 判断 + `SET stock:88 新值` 后，为什么两个客户端能同时把库存从 1 扣到 0 再扣到 -1？

<template #answer>

**关于回滚**：`INCRBY stock:88 abc` 语法合法（参数个数与类型都对），入队阶段不会被拒，它在 `EXEC` 执行时才失败。官方规则：`EXEC` 之后的错误不特殊处理，**队列里其余命令照样执行**，原话是 Redis 不支持回滚。所以最终状态是「库存已减、销量已加」，都是真的生效了——**代码把「事务」当「要么全成要么全不做」用了**，这就是第一个 bug。

**关于扣成负数**：`DECRBY` 只保证原子递减，不会拒绝越界。`GET`+判断+`SET` 更糟：那是三步，两个客户端可以都读到 1 再各自减成 -1。`MULTI/EXEC` 也救不了——它保证**执行阶段不被插入**，不保证业务条件成立。

**正确写法（按代价排序）**：

1. **Lua 脚本**把「判断 + 写」放进一个原子执行单元，库存不足直接返回失败（官方说法：脚本是事务性的，多数事务场景用脚本更简单更快）。
2. 单命令能表达的用单命令：`HINCRBY`/`INCRBY`、`SET key val NX EX`。
3. 需要严格正确性的库存/余额：**回到数据库用行锁与条件更新**（`UPDATE ... SET stock = stock - 1 WHERE id = 88 AND stock > 0`，看[事务与并发](/database/transactions)），Redis 只做前置快速判断。
4. 乐观锁路线 `WATCH` → 读 → `MULTI` → 写 → `EXEC`，返回 nil 就重试；但**过期与淘汰也会触发 WATCH**，重试率会高于预期。
</template>

</Exercise>

## 官方文档与延伸阅读

- [Redis 数据类型总览](https://redis.io/docs/latest/develop/data-types/) —— 选结构的总依据：各类型语义、ZSET「同分二级排序」技巧、HLL 定位。
- [Redis 内存优化](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/) —— 核实编码一节的全部数字：「小聚合类型最多省 10 倍、平均 5 倍内存」「超过上限自动转普通编码」、6.2 / 7.0 / 7.2 三档阈值默认值、位图 1 亿用户 12MB、「Hash 字段不能有独立过期时间」。
- [Redis 事务](https://redis.io/docs/latest/develop/using-commands/transactions/) —— 「不支持回滚」的原话、2.6.5 起入队错误拒绝整个事务、`EXEC` 后错误不中断其余命令（含官方 telnet 示例）、`WATCH` 的 CAS 与「过期/淘汰也算修改」。练习 3 的答案完全来自这一页。
- [Redis 命令参考索引](https://redis.io/docs/latest/commands/) —— 每条命令页的 `Complexity` 与选项（`SCAN` 的 `COUNT` 是建议值、`UNLINK` 的异步回收），本章所有「预期结果」的校验入口。
- [数据访问设计](/database/data-access-design) —— 对照读物：数据库侧的读放大与 Redis 侧的结构选型是同一枚硬币的两面。

## 下一章

这一章把 Redis 的能力拆成「需求 → 结构 → 命令 → 退化点」四步：五种类型各解决哪类抽象问题，位图/HLL/Geo/Stream 在什么规模下才有价值；listpack/intset 编码与阈值怎么把内存拉开 5 到 10 倍；`SCAN` 用游标换掉 `KEYS` 的 O(N) 阻塞；以及最重要的边界——**pipeline 只省网络、`MULTI/EXEC` 只保证执行不被插入、Redis 永远不会回滚**。[第 3 章 Redis 持久化：RDB 与 AOF](/data-storage/redis-persistence) 接着回答本章刻意没碰的一问：这些结构在进程重启后从哪来——反复出现的 `latest_fork_usec`、AOF 的一次 `write(2)`、被硬杀时的半个事务，都会在那里变成主角。
