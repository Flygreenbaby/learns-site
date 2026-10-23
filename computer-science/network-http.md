# HTTP 的三代演进，其实只在解决一件事：别排队

「首屏慢」最常见的解释是「后端慢」。但本机 loopback 上做过一组对照实验，结论很不一样：在同一条 TCP 连接里连发两条请求（第一条服务端睡 300 ms，第二条只要 2 ms），**两个响应在 316 ms 一起到达**；把它们分到两条连接上，快的 **2 ms 就回来了**；换成 HTTP/2，一条连接上三条流，慢的 307 ms、两条快的各 **6 ms**。后端一行代码没改，快的东西因为「排在谁后面」而差了两个数量级。

这就是 HTTP 三代协议的全部动机：**HTTP/1.1 让一条连接能连续回答多个请求，但答案必须按顺序发；HTTP/2 把一条连接切成多条流，让应用层不再互相挡；HTTP/3 干脆把「一条连接」换掉，让丢包也不再互相挡**。本章把这三代、以及站在它们前面的 CDN 与缓存讲清楚，最后把五章知识串成一条从 URL 到首屏的链路。

<Callout type="verified">

**本机实测**（Node v25.4.0 / Windows，2026-10-21，脚本 `computer-science/.scratch/http-mux-probe.cjs`、`net-probe.cjs`）：loopback 上的 HTTP/1.1 管线化、串行、双连接三组计时，以及 HTTP/2 单连接三流计时；对 `nodejs.org` 与 `developer.mozilla.org` 分别用 HTTP/2 与 HTTP/1.1 各请求两次读到的响应头（`server`、`cache-control`、`age`、`x-cache`、`via`、`connection`）。

**按规范推演**：HTTP/1.1 的管线化规则、HTTP/2 与 HTTP/3 的帧与流语义、QUIC 的 0-RTT 风险（均引用已下载正文的原句）。**未在本机验证**：HTTP/3 与 QUIC（本机没有 QUIC 客户端，curl 也是无 HTTP2 特性的 Schannel 构建）、浏览器的每主机连接数上限、抓包级的帧字节数。

</Callout>

## HTTP/1.1：连接可以复用，答案必须排队

HTTP/1.0 一条连接只服务一个请求，做完就断；HTTP/1.1 的主要改进是**持久连接**（keep-alive）。规范给的前提很硬（[RFC 9112 第 9.3 节](https://www.rfc-editor.org/rfc/rfc9112.txt)，已核实）：「In order to remain persistent, all messages on a connection need to have a self-defined message length (i.e., one not defined by closure of the connection)」——**既然不能靠「连接断了」来表示结束，每条消息就必须自己说清楚有多长**（`Content-Length`，或分块传输）。同一节还规定：服务端读完请求体再发响应，代理不允许与 HTTP/1.0 客户端保持持久连接。

于是第一个常见误解有了准确答案：**「响应不知道什么时候结束」不是网络问题，是你的消息没有自报长度**。挂着的请求、永远转不完的加载，很多都是这一条。

规范也给了并发方案：管线化（pipelining，第 9.3.2 节）——客户端可以连发多条请求不必等响应，但服务端「**MUST send the corresponding responses in the same order that the requests were received**」。**必须按收到的顺序回答**，这就是队头阻塞的定义。本机把这条测出来了：

```text
本机 loopback 实测（服务端 /0 延迟 300 ms，/1 立即返回）

A. 同一条 TCP 连接里连发两条请求（管线化）
   resp-0 到达：距发起 316 ms      resp-1 到达：距发起 316 ms   → 快的被慢的挡住
B. 同一条连接串行（收到上一条才发下一条）
   /0 完成于 304 ms                /1 完成于 305 ms            → 总耗时是相加
C. 两条独立连接并发
   慢请求所在连接 313 ms           快请求所在连接 2 ms          → 互不阻塞
```

A 组那个「两个响应同一毫秒到达」是本章最该记住的一个证据：**不是快请求变慢了，是它只能等排在它前面的说完**。现实中这个形状很眼熟——首屏里某个接口慢，其它静态资源跟着一起不出来。

浏览器当年的解法就是 C 组：**同一个主机开有限条连接轮流用**（现代浏览器的每主机并发连接数是个位数，具体数字随实现变化，**本章未在本机验证**）。代价写在前两章里：多一条 TCP 就多发一次握手、慢启动要从头再来、TLS 要再握手一次。所以「域名分片」这类技巧是把成本从排队转成了连接开销，不是免费午餐。

## HTTP/2：把一条连接切成多条流

HTTP/2（[RFC 9113](https://www.rfc-editor.org/rfc/rfc9113.txt)，已核实，本文档 obsolete 掉 RFC 7540 与 8740）的做法是给这条字节流加一层**帧（frame）**：每个请求-响应对绑定一条**流（stream）**，帧里带流标识，于是同一条连接上多个交换可以交错传。规范的措辞是「Streams are largely independent of each other, so a blocked or stalled request or response does not prevent progress on other streams」。三个配套机制：帧头压缩、流级流控、优先级（这一版把 RFC 7540 的优先级方案标记为弃用）。

本机对照实验（同一个服务端、同一段 300 ms 延迟逻辑，只是客户端用 HTTP/2）：

```text
本机 loopback 实测：一条连接上的三条流

/0 → resp-0（状态 200），完成于发起后 307 ms
/1 → resp-1（状态 200），完成于发起后   6 ms
/1 → resp-1（状态 200），完成于发起后   6 ms
全程只有一条连接（服务端端口 2262）
```

**慢流没有挡住快流**——上一章 A 组里那个「一起 316 ms」在 HTTP/2 上变成「各回各的」。附带说明本机实验的一处不足：Node 25 里客户端流的 id 字段读不到（`stream.id` 为 `undefined`），所以这里的复用证据是「一条 socket + 快的 6 ms / 慢的 307 ms」，不是流号。

第二项收益是**头部压缩**。规范给的理由（已核实）：HTTP 字段「often repetitive and verbose, causing unnecessary network traffic as well as causing the initial TCP congestion window to quickly fill」，而压缩之后「allowing many requests to be compressed into one packet」。这解释了一个 F12 里的现象：**几百个小请求不一定慢**，因为它们共享同一条连接、头部被压缩、彼此不排队。至于省了多少字节，本机计量不到（Node 内部组帧），所以本章不给数字。

还有一件事必须如实留下——规范自己在同一章写了一句容易被忽略的话：「**Note, however, that TCP head-of-line blocking is not addressed by this protocol.**」HTTP/2 解决了应用层排队，没解决丢包。**TCP 只有一个序号**（上一章的结论），中间少一段，后面收到的字节也只能等补齐。所以在高丢包链路上，HTTP/2 可能比 HTTP/1.1 更抖——这是下一节的动机。

## HTTP/3：换掉 TCP 才是重点

HTTP/3（[RFC 9114](https://www.rfc-editor.org/rfc/rfc9114.txt)，已核实）不再跑在 TCP 上，而是跑在 QUIC 上（QUIC 规范是 [RFC 9000](https://www.rfc-editor.org/rfc/rfc9000.txt)， UDP 之上的可靠传输）。规范给的两条理由正好对应上一章的两个痛点：

- **每条请求-响应用一条独立的 QUIC 流**：「Each request-response pair consumes a single QUIC stream. Streams are independent of each other, so **one stream that is blocked or suffers packet loss does not prevent progress on other streams**.」TCP 的队头阻塞在这里被消掉——因为重传是按流管理的，不再是一个全局序号。
- **头部压缩换了实现**：因为 HPACK 依赖压缩段的**按序传输**，而 QUIC 不提供这个保证，所以 HTTP/3 用 QPACK，并「uses separate unidirectional streams to modify and track field table state」——表状态的更新与数据分开走一条单向流。

第三条动机是握手次数。上一章里 TLS 1.3 已经把握手压到 1-RTT，QUIC 把传输层与加密握手合并进同一个协议，于是首次连接更省；再往前一步是 0-RTT——但代价写得明明白白：「**0-RTT provides no protection against replay attacks**」。所以只有幂等请求才配搭早数据（非幂等请求用 0-RTT 重发，等于把一次下单变成两次）。

**怎么从 HTTP/2 走到 HTTP/3？** 靠协商，不是靠猜。常见路径是先通过 `Alt-Svc` 响应头告诉客户端「我在另一个端口上支持 h3」，客户端之后再去试（MDN 的 [Alt-Svc 头字段条目](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Alt-Svc) 已核实可访问，2026 年 10 月状态码 200）。**本机没有抓到 `alt-svc` 头，也没有 QUIC 客户端，所以这一段的完整流程本章不声称验证过**，只作为规范与动机陈述。

对读者真正可操作的是三条判据，而不是版本号：

1. **看协商结果，不看配置**。ALPN 是不是 `h2`（上一章实测本机 3 个域名全部 `h2`）、响应是不是走 HTTP/2 帧，都可在客户端读；服务端配置里写了 `http2 on` 不等于协商成功。
2. **丢包才是 h3 的主场**。同一条连接、少丢包的环境里，h2 与 h3 的差别主要在握手与按流重传；移动网络、跨洋链路上差别才明显（本机没有对应环境，未测）。
3. **h3 换的是传输层，不是语义**。方法、状态码、缓存头这些第三章起就有的语义三代相同——你的应用代码几乎不该因为版本而改。

## CDN 与缓存：同一份内容，三个不同的答案

对 `developer.mozilla.org` 连续请求两次，本机读到的头是这样的（两组值都直接来自响应）：

| 字段 | 第一次 | 第二次 | 说明 |
| --- | --- | --- | --- |
| `status` | 302 | 302 | 目标在跳，与缓存无关 |
| `server` | Google Frontend | Google Frontend | 应答者是托管方 |
| `cache-control` | max-age=3600,public | 同左 | **服务端要求**：可缓存 1 小时 |
| `age` | 3411 | 3412 | 对象已经在缓存里待了 3411 秒 |
| `x-cache` | "MISS, HIT" | 同左 | 经过两级缓存：一级未命中、二级命中 |
| `via` | 1.1 google, 1.1 varnish, 1.1 varnish | 同左 | 链条上有几个中间人在说话 |
| `connection` | 仅 HTTP/1.1 请求出现 `close` | — | 用 HTTP/2 请求时没有这个头 |

三个字段各自回答一个不同问题，排障时别混用：

- **`cache-control` 是「应该缓存多久」的指令**，由服务端发出。对照实测：`nodejs.org` 给的是 `public, max-age=0, must-revalidate`——**max-age=0 但必须回源验证**，也就是「可以存，但每次都要问一声有没有变」。
- **`age` 是「这份副本已经多旧」的实测值**，由中间人累加。本机两次请求之间 `age` 从 3411 变成 3412（1 秒），**这正是「命中缓存、没回源」的第一手证据**：如果第二次真的回源，`age` 会归零。
- **`x-cache` / `via` 是「谁在替你回答」**。`MISS, HIT` 说明请求经过了不止一层缓存。各家 CDN 的字段名与取值并不统一，所以这两个头只用于定位，不可当作跨服务商可比的指标。

顺带一条常被误读的版本证据：本机那次对照里，HTTP/1.1 请求带回了 `connection: close`，HTTP/2 请求没有——`close` 表示服务端打算回答完就断连（上一章的 FIN 由此而来）。**「服务端主动断连」不是异常，是它在头里明说过的决定**；反过来，如果客户端坚持复用而服务端不断言，就会出现「连接被闲置回收后请求失败」的竞态（这在连接池里更常见，见[连接池与慢查询](/data-storage/connection-pool-and-slow-query)）。

**那 CDN 到底为什么让站点变快？** 三条，都能在本章前两章找到机制：**距离近 → RTT 小**（上一张表里的 1 秒粒度、上一章的计时器都是按 RTT 结算的）；**命中缓存 → 不回源**（`age` 递增就是证据）；**边缘节点与你的浏览器之间连接可复用**（h2 之后还能多路复用）。反过来说 CDN 也会带来新问题：缓存了错误的版本、`MISS` 比例过高、缓存键里带着无关查询串导致命中率暴跌——排查顺序就是上面那三个字段。

## 把链路串起来：从输入 URL 到首屏

现在把五章的东西排成一条真实时间线。**下面这段是「按规范的形状推演」，不是本机耗时实测**（本机没有抓包与浏览器驱动环境）：

```text
一次 https://example.com/ 访问发生的七步

1. DNS：名字 → 地址（拿到剩余 TTL，AA/RA 判断谁在回答）           ← 第五章
2. TCP：三次握手；此后按字节编号，可靠由计时器保证               ← 第六章
3. TLS：1.3 通常 1-RTT；ALPN 在这里决定用 h2 还是 h1.1；证书链   ← 第六章
4. HTTP：请求发出；h1.1 排队、h2 分流、h3 连丢包都不互相挡       ← 本章
5. 中间人：CDN / 反向代理命中或回源（age、x-cache、via）          ← 本章
6. 服务端：路由、业务逻辑、数据库（另一领域，瓶颈常在这里）
7. 浏览器：拿到 HTML 才发现资源，回到第 1 步 N 次（这就是首屏）
```

第 7 步是很多人「后端优化完首屏没变化」的原因：**一次页面访问其实是几十次上述循环**，而每次循环的成本由最慢的那一段决定。所以判据要分段拿：DNS 有 TTL 与标志位，连接与握手有错误码形状与协商字段，缓存有三个响应头，服务端有日志与耗时指标，浏览器有 F12 的时间线。**「慢」从来不是一个数字，是一串数字里最大的那个**（怎么把耗时切成可归因的段落，见[日志与监控](/backend/logging-and-monitoring)）。

至于版本演进的正确理解：**三代协议改的都是「同一个连接上多个交换怎么安排」，没改「一个交换长什么样」**。方法、状态码、幂等、缓存语义从 HTTP/1.0 起一脉相承（本站[HTTP 与 REST](/backend/http-and-rest) 讲语义本身）。把版本当成语义差异，是排障时最容易走错的方向。

## 常见错误与排查

**1. 现象：站点已经开了 HTTP/2，首屏还是被一个大文件拖住。**

原因：HTTP/2 消掉的是应用层排队，规范明说 TCP 层队头阻塞没解决；单个大对象占满带宽时，其它流分不到窗口（上一章的「预算」）。

怎么确认：看 F12 时间线里其它请求是否卡在「等待」而不是「下载」；服务端侧看响应是否已经开始发。

怎么修：大文件走独立域名或 CDN、压缩与分片、非关键资源延迟加载；不要指望「升到 h2」解决带宽问题。

**2. 现象：静态资源换了新版本，用户还是看到旧的，强刷也不一定有用。**

原因：`max-age` 还没到、或者 CDN/代理仍在命中旧副本——这是上一节 `age` 那三个字段各自的层。

怎么确认：连问两次看 `age` 是否在涨（在涨说明命中缓存、没回源）；看 `x-cache`/`via` 判断经过几层。

怎么修：给文件名带内容指纹（哈希）并让 HTML 不被长期缓存，比让用户强刷可靠得多；确需立刻生效时用 CDN 的清除入口（各家不同，本站未在任一控制台验证）。

**3. 现象：`curl --http2` 报错或仍然给出 HTTP/1.1，就断言「服务端不支持 h2」。**

原因：客户端构建可能根本没有 HTTP/2。本机实测的 curl 8.17.0 是 Schannel 构建、**不带 HTTP2 特性**，它的结果不能代表服务端。

怎么确认：先看客户端支持哪些特性，再看 TLS 握手后的 ALPN（本机用 Node 读到 3 个域名全是 `h2`）。

怎么修：换一个带 HTTP/2 的客户端做判断；**任何「A 不行所以 B 不支持」的推理都要先证明 A 有能力测这件事**。

**4. 现象：同一域名下请求越多越慢，后面几个明显排队。**

原因：HTTP/1.1 下浏览器对同一主机的连接数有限，多出来的请求只能等空位（未在本机验证具体上限，属各实现的自选值）。

怎么确认：F12 网络面板里的「队列时间/阻塞」列——它是排队，不是传输。

怎么修：优先让站点真的走 h2/h3（一条连接多路复用），其次减少首屏请求数。历史上的「域名分片」是在给 h1 打补丁，今天通常反而多付握手成本。

**5. 现象：加了 CDN 之后偶尔更快、偶尔更慢，还多出一些 5xx。**

原因：命中时省了回源，未命中时多一跳；缓存键包含无关查询串会让命中率暴跌；回源超时与边缘重试会改变错误形状。

怎么确认：看 `x-cache`/`via` 的命中分布与 MISS 比例（字段名各家不同，只做同服务商前后对比），再对比回源耗时。

怎么修：明确缓存键（忽略哪些查询串）、给静态与接口分别设 TTL、对冷启动做预热；把「边缘错误」和「源站错误」分开上报。

## 练习

<Exercise title="抓同一个 URL 两次，把 age 与 cache-control 的区别写清楚" difficulty="基础">

用 Node（`http2` 或 `http` 客户端）或浏览器 F12，对同一个可缓存 URL 连续请求两次，记录：`cache-control`、`age`、`x-cache`/`via`（没有就写「无此字段」）、状态码，以及两次请求的时间差。

回答：`cache-control` 与 `age` 一个是规定、一个是实测，你怎么从这两个数判断「这次有没有回源」？如果第二次 `age` 归零，说明什么？

<template #answer>

本机形状（2026-10-21，`developer.mozilla.org`）：状态 302、`cache-control: max-age=3600,public`、`age` 第一次 3411、第二次 3412、`x-cache: "MISS, HIT"`、`via: 1.1 google, 1.1 varnish, 1.1 varnish`。

判断法：**`age` 随时间线性增长 → 命中缓存没回源**（本机两次相隔约 1 秒，`age` 正好 +1）；**`age` 归零或大幅变小 → 这一层刚刚回源**（或被清了）。`cache-control: max-age=3600` 只是「允许缓存 1 小时」的规定，实际留多久由每一层决定——这一点和上一章 DNS 的 TTL 完全同构：**规定的是上限，不是义务**。

对照组：`nodejs.org` 给的是 `public, max-age=0, must-revalidate`——允许存但每次必须回源验证。同一个字段值不同的站点，排障结论就完全不同，所以**不要拿别人的 TTL 当自己的判据**。

</template>

</Exercise>

<Exercise title="复现「快请求被慢请求挡住」，再用 HTTP/2 消掉它" difficulty="进阶">

在你自己机器上写两个服务：一条路由 sleep 300 ms，另一条立即返回。然后做三组实验（都用 `127.0.0.1`）：

1. 用一条原始 TCP 连接（`node:net`）一次 write 两条 HTTP/1.1 请求；
2. 开两条独立连接各发一条；
3. 用 `node:http2` 在同一条连接上开三条流（一条慢、两条快）。

记录每组的完成时间。回答：为什么第 1 组两个响应几乎同时到达？哪一组证明「服务端代码没变，只是排队方式变了」？

<template #answer>

本机实测：第 1 组 resp-0 与 resp-1 都在 316 ms 到达；第 2 组慢的 313 ms、快的 2 ms；第 3 组慢流 307 ms、两条快流各 6 ms（同一条连接，服务端端口 2262）。

第 1 组同时到达是因为规范要求响应按请求顺序发（RFC 9112 第 9.3.2 节）——**快的没有变慢，它只是不能先说**。第 3 组与第 1 组服务端逻辑相同、只有版本不同，就是「排队方式变了」的证明。

实验本身的两个坑：一是必须真的复用同一条连接（`node:http` 的默认 agent 是 `keep-alive=false`，你以为在排队，其实开了两条连接）；二是计时要在响应体完整出现的那一刻停，不是 `data` 第一次触发的时刻。

</template>

</Exercise>

<Exercise title="给一次真实访问写出分段排障表" difficulty="挑战">

挑一个你在用的站点（自己的最好），列出从输入 URL 到首屏可见的七段：DNS、TCP、TLS、HTTP 排队、CDN/代理、服务端、浏览器渲染。每段填三格：**判据是什么**、**在本机用什么能读到**、**这一段你测不到什么**。

最后回答：哪几段的数字你只能拿到「规定值」而不是「实际值」？这会让你的哪句排障结论必须打折？

<template #answer>

判据示例：DNS 看标志位与剩余 TTL（第五章的三条入口对照）；TCP 看错误码形状（`ECONNREFUSED` 快死 / 无应答慢死，第六章）；TLS 看协议、套件、ALPN、链深；HTTP 看排队与响应头三件套（`cache-control`/`age`/`via`）；服务端看日志里的处理耗时；浏览器看 F12 时间线。

读不到的部分要如实写下：本机没有抓包工具，所以 SYN 与 TLS 消息的实际顺序只能按规范推演；没有 QUIC 客户端，所以 h3 协商无法复现；F12 的「等待」列包含浏览器内部排队，具体上限是实现细节。**只能拿到规定值的两段是 TTL 与 `cache-control`**——它们都只说明「允许多久」，不说明「各层实际留了多久」。

因此这句话必须打折：**「我这边查过了，是正常的」**。它通常只证明了链路的某一段在某一个入口上正常。改成「解析与连接两段我拿到了这些字段，问题不在这里」，才是这五章给你的表达能力。

</template>

</Exercise>

## 官方文档与延伸阅读

- [RFC 9112（HTTP/1.1）](https://www.rfc-editor.org/rfc/rfc9112.txt) —— 核实持久连接要求每条消息自报长度、代理不得与 HTTP/1.0 客户端保持持久连接、管线化响应必须按请求顺序发送（第 9.3、9.3.2 节）。
- [RFC 9113（HTTP/2）](https://www.rfc-editor.org/rfc/rfc9113.txt) —— 核实 HTTP/1.0 单请求与 HTTP/1.1 管线化的局限、「TCP 队头阻塞不由本协议解决」、流彼此独立、头部压缩的收益，以及本文件 obsolete RFC 7540/8740。
- [RFC 9114（HTTP/3）](https://www.rfc-editor.org/rfc/rfc9114.txt) —— 核实每条请求-响应对应一条 QUIC 流、按流隔离丢包不互相阻塞、QPACK 取代 HPACK 的原因；[RFC 9000（QUIC）](https://www.rfc-editor.org/rfc/rfc9000.txt) —— 核实 0-RTT 不防重放。
- MDN（均于 2026 年 10 月核实可访问，状态码 200）：[HTTP 概览](https://developer.mozilla.org/zh-CN/docs/Web/HTTP)、[HTTP 缓存](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Caching)、[Age 头字段](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Age)、[Cache-Control 头字段](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Cache-Control)、[Alt-Svc 头字段](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Alt-Svc)。
- 站内相关：[网络：TCP、UDP 与 TLS](/computer-science/network-tcp-tls)（上一章）、[网络：分层模型与 DNS](/computer-science/network-dns)、[对象存储与 CDN](/data-storage/object-storage-and-cdn)、[HTTP 与 REST](/backend/http-and-rest)、[Nginx 反向代理](/realtime/nginx-proxy)。

## 下一章

本章把最上面那层讲完：HTTP/1.1 必须按序回答（本机实测「两个响应一起到」）、HTTP/2 用帧与流解掉应用层排队但留着 TCP 队头阻塞、HTTP/3 改的是传输层所以丢包也不再互相挡、CDN 与缓存的判据是 `cache-control` / `age` / `x-cache` 三个字段各问一件事。

网络线到此结束。第 8 章「操作系统：进程与线程」尚未上线，它会换一个问题：数据到达之后由谁处理、能同时处理多少——那才是并发与 IO 模型的地盘。想先读已上线的相邻内容，本站的两个入口是 [HTTP 与 REST](/backend/http-and-rest)（HTTP 语义本身）与[为什么 HTTP 不够用](/realtime/why-http-is-not-enough)（同一层往实时方向延伸）。
