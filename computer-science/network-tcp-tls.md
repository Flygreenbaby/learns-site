# 连接不是一扇门，而是一套计时器和一份名单

「网站打不开」至少有三种形状，而它们在传输层是三件不同的事。本机 loopback 实测把前两种钉死了：连一个刚关掉监听的端口，得到 `ECONNREFUSED`，**耗时 2 ms**；连 `192.0.2.1:80`（TEST-NET，路由上没人应答的文档专用地址），得到「既没建立也没被拒绝」，**耗时 6007 ms**。前者是对端回了 RST，后者是你的 SYN 在重传。同一个「打不开」，一个是快死、一个是慢死，病因完全不同。

第三种形状发生在更上面一层：连接明明建立了，浏览器还是拒绝——因为证书链断了一环。本章把这条链路剩下的三段拆开：**连接与状态机**（握手为什么是三次、挥手为什么是四次）、**可靠传输**（确认、重传计时器、窗口这笔预算）、**身份与加密**（TLS 握手要几次往返、证书到底在跟谁的名单比）。每段给判据，不给感觉。

<Callout type="verified">

**本机实测**（Node v25.4.0 / Windows，2026-10-21，脚本与输出留在 `computer-science/.scratch/`）：`tcp-udp-probe.cjs` 在 127.0.0.1 上做的分帧、失败形状、半关闭、背压、Nagle 五组实验；`net-probe.cjs` 对 3 个真实域名做 4 次握手读到的 TLS 协商结果与证书链深度；`dns-wire.cjs` 读出的完整证书链与各环有效期；`netstat` 的连接状态计数。

**按规范推演**（引用原文，未在本机抓包）：三次握手的包序与序号、TIME-WAIT 的时长、重传超时的指数退避、TLS 1.2/1.3 的消息流。**边界**：本机没有抓包工具（未安装 Wireshark/dumpcap），所以「谁先发哪个包」只能引用规范文本；也没有 QUIC/HTTP-3 客户端。这些位置本章一律标注，不写成实测。

</Callout>

## 握手要解决的不是「建立」，是「丢弃旧包」

直觉里三次握手是为了「双方都知道对方在」。**规范给的理由更硬**（[RFC 9293](https://www.rfc-editor.org/rfc/rfc9293.txt)，本站已下载正文）：

> The principal reason for the three-way handshake is to prevent old duplicate connection initiations from causing confusion.

网络里会有迟到的包。你十分钟前发出的那个 SYN 可能现在才到——如果对端只看「有人发 SYN 就同意建立」，它会凭空为你开一条你早已不要的半连接，并占着资源。**第三个包的意义是：客户端把服务端那个随机初始序号（ISN）确认回去，等于证明「我现在还活着，这个连接确实是我要的」**。所以三次不是仪式，是两次「你对了吗」的交换：服务端确认客户端的 SYN，客户端确认服务端的 SYN。

```text
RFC 9293 的连接建立示例（序号取自规范原文，本机未抓包，属按规范推演）

2.  SYN-SENT    --> <SEQ=100><CTL=SYN>               --> SYN-RECEIVED
3.  ESTABLISHED <-- <SEQ=300><ACK=101><CTL=SYN,ACK>  <-- SYN-RECEIVED
4.  ESTABLISHED --> <SEQ=101><ACK=301><CTL=ACK>      --> ESTABLISHED
```

读这段只要抓一个规律：**ACK 的值永远是「我期望收到的下一个字节序号」，而且 SYN 自己也占一个序号**——所以 100 之后要确认 101，尽管这三次握手一个业务字节都没传。「序号从哪来」不重要（ISN 是随机的），重要的是**序号与确认的这条对应规则**；下一章 HTTP 的字节数、`Content-Length` 与 `Range` 全部建立在这套「按字节编号」的语义上。

规范紧接着给了第二件套：处理旧包的**RST**。收到不该收到的 SYN，非同步状态下的 TCP 直接回一个复位段。这就是本机那个 2 ms 的 `ECONNREFUSED`——127.0.0.1 上那个刚关闭的端口还有协议栈在跑，它看到没人监听的端口，替你把门关上并回 RST。**「立刻失败」几乎总是 RST；「转到天荒地老」几乎总是没人应答**。这条判据把上一章练习 3 里那个问题答完了：DNS 返回的地址没错，错的是那个地址上没人接这个端口。

挥手要四次的原因完全不同：**FIN 是单向的**。TCP 的一条连接有两个方向，每个方向要各自关闭，而关一个方向需要「我关完了」+「我知道了」两段对话。这不是推演，本机可以直接看到：

```text
本机 loopback 实测：客户端 end() 之后仍然收到了数据（2026-10-21）

1. 客户端 connect               2. 客户端 end()（FIN 发出）
3. 服务端收到数据 "请求"          4. 服务端收到 end（对端不再写）
6. 客户端仍收到 "晚到的应答"      7. 客户端收到 end
（8. 双方 close）
```

**第 6 行是重点**：客户端已经发了 FIN，服务端的回复照样进得来。半关闭（half-close）是 TCP 的正常能力，所以「我这侧不写了」不等于「这条连接不能用了」。真实后果：一个客户端如果习惯性 `end()` 之后就不再读，就会丢掉服务端最后的那段应答——很多「响应偶尔截断」其实是这么来的，跟网络无关。

主动关闭那一侧还要在 TIME-WAIT 停留：**MUST linger in the TIME-WAIT state for a time 2xMSL**（MUST-13），而规范明说 **the MSL is taken to be 2 minutes. This is an engineering choice**——时长是实现选择，各家可以不同。本机 `netstat -an -p tcp` 的快照（同一时刻）：`ESTABLISHED 72`、`LISTENING 26`、`TIME_WAIT 17`、`SYN_SENT 3`、`CLOSE_WAIT 3`、`FIN_WAIT_2 1`。本机看到的 TIME-WAIT 是十几条量级，属正常。规范还留了一个后门（MAY-2）：TIME-WAIT 里**可以**直接接受新的 SYN 重开连接，条件是新连接的初始序号必须大于上一条连接用过的最大序号。这条存在的意义是：实现可以在「等待」与「重开」之间做取舍，所以你在真实机器上看到的 TIME-WAIT 行为不止一种——**判据不是「TIME_WAIT 多」，而是「临时端口是否被耗尽、新连接是否因此失败」**（本机快照是 `TIME_WAIT 17 / ESTABLISHED 72`，无症状）。

## 可靠传输：确认、一个会翻倍的计时器、以及窗口这笔预算

TCP 的「可靠」由三件事凑出来：**序号**（每个字节都编号）、**累积确认**（ACK 到 N 意味着 N 之前的都到了）、**超时重传**。真正决定你体感的是第二件里的计时器规则（[RFC 6298](https://www.rfc-editor.org/rfc/rfc6298.txt)，已核实）：

- **(2.1)** 还没测出 RTT 之前，`RTO ← 1 second`（旧版本取 3 秒，本文档把它降到 1 秒）。
- **(2.4)** 算出的 RTO 小于 1 秒要向上取到 1 秒；**(2.5)** 可以设上限，但**至少 60 秒**。
- **(5.5)** 每次重传：**The host MUST set RTO ← RTO * 2 ("back off the timer")**。
- RTT 采样有一条 MUST：**Karn's algorithm**——不能拿重传过的段来测 RTT，因为无法确定那个 ACK 是回给第一次发送还是第 n 次的。

按这几条推演一次（**本节这段算术是规范推演，不是本机实测**）：从 1 秒起连续丢包就是 1 → 2 → 4 → 8 → 16 → 32 秒，六次重传就累计到一分钟级。这解释了那个「转圈很久才失败」的形状：**慢死的时间不是网络带宽，是指数退避的计时器**。至于「到底重传几次才放弃」，规范没有规定，是各实现的自选动作。

这里必须澄清本机那个 6007 ms：**它是探针自己设的 6 秒超时**（`socket.setTimeout(6000)`），不是 TCP 在 6 秒后放弃。真实情况下 TCP 还会继续退避重传很久。这个区分很重要——**你在应用里设的超时，是你替用户做的决定，不是协议的结论**（超时怎么设、设在哪一层，见[日志与监控](/backend/logging-and-monitoring)）。

第三个概念是窗口，它是**预算不是速度**。规范给的公式（RFC 9293，已核实）：可用窗口 `U = SND.UNA + SND.WND - SND.NXT`，也就是「对端此刻允许我在等待确认期间占用的字节数，减去已经发出还没被确认的部分」。接收方随时可以把这个数调小——它按自己还剩多少缓冲来报价。所以「TCP 慢」很多时候不是链路慢，而是**接收端报价的窗口小**：应用读得慢、解析得慢、落盘得慢，都会把窗口压下来，链路的容量根本没用满。

Node 里这件事有一条完全可本机实测的对应物——**背压**：

```text
本机 loopback 实测（服务端 pause() 不再读，客户端连写 64 KiB）

write() 返回 true 5 次，false 377 次
观测到的最大 writableLength = 24707072 字节（约 23.6 MiB）
'drain' 事件触发次数 = 0（因为一直没停下来等它）
```

三行读出一个结论：**`write()` 返回 `false` 不是错误，是「内核缓冲已经堆到这个数，请停一下」**。忽略它不会报错，只会把内存堆起来：382 次写里 377 次 false，缓冲涨到 23.6 MiB，而对端一个字节都没消费；`drain` 一次没触发，正说明「只要你不暂停，它就没有恢复可写的时机」。正确姿势是收到 false 就停手、等 `drain`，这是所有「批量导出把进程 OOM 了」的第一现场。

最后一个常被当成「网络玄学」的开关是 **Nagle 算法**（它把小段写攒起来凑成一个包，代价是小包延迟）。本机对照实验**没有测出差别**：`setNoDelay(true)` 与 `setNoDelay(false)` 两种设置下服务端都收到 5 段、每段 10 字节（`[10,10,10,10,10]`）——**loopback 的往返时间接近 0，Nagle 等不出代价**。这条实验的价值在于它如实记录了一次「测不出来」：不能据此断言 `TCP_NODELAY` 无用，它真正出现的场景是公网高 RTT 下频繁小写（本章未在外网验证）。**测不出的实验要写成测不出**，这比编一个「符合预期」的结论有用。

## TCP 还是 UDP：真正的问题是分帧

选型常被说成「要可靠就 TCP，要快就 UDP」。**本机实验能给出更准确的版本：两者给的东西不一样，麻烦也不一样。**

```text
本机 loopback 实测：连发 3 次「PING」

TCP：客户端 write 三次，对端只触发 1 个 data 事件，内容 = "PINGPINGPING"
UDP：客户端 send 三个报文，对端触发 3 个 message 事件 = ["PING","PING","PING"]
```

TCP 给你的是**一条按序、不丢（在你设置的超时之内）的字节管道，但它不保留你的写边界**——三次写合成一次交付，就是证据。UDP 给你的是**报文边界**，代价是「不保证送达、不保证不重、不保证有序」。规范的措辞（[RFC 768](https://www.rfc-editor.org/rfc/rfc768.txt)，已核实）：

> The protocol is transaction oriented, and delivery and duplicate protection are not guaranteed. Applications requiring ordered reliable delivery of streams of data should use the Transmission Control Protocol (TCP).

于是两条各自要补的课很具体：

1. **走 TCP 就必须自己定义消息边界。** 上一段那个 `"PINGPINGPING"` 到了应用手里，你必须知道这是三条还是半条加一条——所以要么长度前缀，要么分隔符，要么用「收到几个字节就算结束」的规则。这不是 Node 的怪癖，是协议的语义：HTTP/1.1 的持久连接之所以强制每条消息自报长度，正是同一个要求（第七章引用了这条原文）。
2. **走 UDP 就必须自己造可靠性。** 序号、确认、超时重传、拥塞控制、分片，全部搬到应用层。DNS 是最小成本的示范：16 位事务 ID 配对、超时后重发（上一章本机实测里就有一次 5 秒无应答）。QUIC 是重成本示范：它在 UDP 之上把序号、确认、流控、加密整套重建，并顺手解决了下面这条——

**TCP 还有一件 UDP 能解决的事：一条流的失败会拖住整条连接。** 这就是队头阻塞，也是第七章 HTTP/3 换用 UDP 的唯一动机。本章先把形状留下：字节流只有一个序号，中间少了一段，后面的字节即使全到了也只能等着补——**这是 TCP 语义的必然结果，不是实现不够好**。

至于选择判据，实操里更靠得住的是「**你的失败形状能不能接受**」：一条会话消息丢了必须补回来，那就别指望裸 UDP；每秒十个状态包、丢一个也无所谓且重传反而更糟（过期数据），那就别用一条会退避重传的 TCP 承载。完整的取舍与真实代码在实时通信领域展开（[协议选型](/realtime/choosing)、[WebSocket 协议](/realtime/websocket-protocol)）。

## TLS 握手：从两次往返到一次往返

TLS 负责两件事：**把后续流量加密**，以及**证明对面那个域名确实是它**。第一段流程是两次往返，第二段是三次消息。TLS 1.2 的完整形状（[RFC 5246 Figure 1](https://www.rfc-editor.org/rfc/rfc5246.txt)，已核实，未在本机抓包）：

```text
RFC 5246 的完整握手消息流（规范原文，非抓包）

ClientHello                  -------->
                              <--------  ServerHello / Certificate* / ServerKeyExchange*
                                         / CertificateRequest* / ServerHelloDone
Certificate* / ClientKeyExchange / CertificateVerify*
[ChangeCipherSpec] / Finished -------->
                              <--------  [ChangeCipherSpec] / Finished
Application Data             <------->  Application Data
```

规范在这里有一条注释：**ChangeCipherSpec 不是握手消息**，它是独立的协议内容类型，理由是「To help avoid pipeline stalls」。TLS 1.2 的代价是**两次往返**才传第一个业务字节。

TLS 1.3 把它压成一次（[RFC 8446](https://www.rfc-editor.org/rfc/rfc8446.txt)，已核实）：客户端在第一个 `ClientHello` 里就带上密钥 share，服务端一次回齐 `ServerHello` + 证书 + 握手完成，于是「1-RTT」。两个例外要记住，因为它们都会在你的服务上出现：

- **参数不匹配要多一次往返。** 客户端推荐的 group 服务端都不支持时，服务端回 `HelloRetryRequest`，客户端必须重新发一次 `ClientHello`（Figure 2，规范原话「the client needs to restart the handshake with an appropriate key_share extension」）。规范还补了一句关键细节：**握手记录（transcript）会把这一轮初始交换算进去，不会因新的 ClientHello 而重置**。
- **0-RTT：省掉往返，但换来两条限制。** 规范的措辞是「A zero round-trip time (0-RTT) mode was added, saving a round trip」，同时明确「**This data is not forward secret**」，而承载它的 QUIC 规范直说「**0-RTT provides no protection against replay attacks**」。翻译成人话：0-RTT 里发的第一条请求可能被重放，所以只有幂等操作才配搭它。

本机在 3 个真实域名上做的 4 次握手读到的协商结果（`tls.connect` 完成后可读字段）：

| 目标 | 协议版本 | 协商套件 | ALPN | 链深 | 叶子证书签发者 O |
| --- | --- | --- | --- | --- | --- |
| nodejs.org | TLSv1.3 | TLS_AES_256_GCM_SHA384 | h2 | 3 | GlobalSign nv-sa |
| nodejs.org（强制 TLSv1.2） | TLSv1.2 | ECDHE-ECDSA-AES128-GCM-SHA256 | h2 | 3 | GlobalSign nv-sa |
| developer.mozilla.org | TLSv1.3 | TLS_AES_128_GCM_SHA256 | h2 | 4 | Internet Security Research Group |
| github.com | TLSv1.3 | TLS_AES_128_GCM_SHA256 | h2 | 4 | The USERTRUST Network |

三条可读的事实：**版本和套件是双方交集的结果**，同一台 nodejs.org 在强制 TLSv1.2 后给出的是另一套命名（`ECDHE-` 前缀），说明它同时支持两代；**`authorized: true` 意味着验证在握手阶段已经完成**（本机 4 次全是 true，没有 `authError`）；**ALPN 是 `h2`**——TLS 握手结束前就顺手谈定了应用层用 HTTP/2，这条给第七章让路。

## 证书信任链：你在跟本机那份名单比

「HTTPS 受信任」不是「这张证书看着像我们家的」，而是一次**链条验证**：从叶子证书出发，逐环检查「下一级确实由上一级签发」，一路走到一个**本机已经认识**的根。规范的措辞（RFC 8446 附录 C.2，已核实）：

> certificates should always be verified to ensure proper signing by a trusted certificate authority (CA). The selection and addition of trust anchors should be done very carefully.

那份「本机已经认识」的名单是可数的：这台机器上 `tls.rootCertificates.length` **实测 148 条**（Node 自带的根证书包；浏览器和操作系统各自另有名单，本章未在本机比对它们的差异）。下面这条链是从应答字节里读出来的实测结果：

```text
本机实测 developer.mozilla.org 的证书链（dns-wire.cjs / tls.connect，2026-10-21）

#0 CN=developer.mozilla.org      ← 由 CN=YR2 签发   有效期 2026-09-23 → 2026-12-22（90 天）
#1 CN=YR2                        ← 由 ISRG Root YR 签发  2025-09-03 → 2028-09-02
#2 ISRG Root YR                  ← 由 ISRG Root X1 签发  2026-05-13 → 2032-09-02（交叉签名）
#3 ISRG Root X1                  ← 自签（信任锚，落在这里）  2015-06-04 → 2035-06-04
```

四个字段值得逐个说清排障含义：

- **叶子只有 90 天**（实测窗口就是 90 天）。这不是缺陷，是这类 CA 的策略：短期证书把「续期」变成自动化任务而不是运维事故。**证书报错绝大多数是续期流程坏了**（部署与续期做法见[部署到 VPS](/devops/deploy-to-vps)、[服务器安全加固](/linux/server-security)）。
- **链深 3 与 4 都正常**（实测：nodejs.org 是 3，developer.mozilla.org 与 github.com 是 4）。层级多少取决于 CA 的中间证书策略，不表示谁的配置更松散。
- **第 2 环是交叉签名**（一个新根由一个老根签发，好让尚未更新名单的客户端也能验通），所以同一台服务器可以同时给出两条不同的链。
- **服务端要把中间证书一起发**。链深是握手时可读的：本机 `getPeerCertificate(true)` 能逐环打印 `subject` 与 `issuer`；如果 issuer 指向一个链里没有的名字，验证就断了——这就是 `unable to verify the first certificate` 最典型的样子（只装叶子、没装 fullchain）。

还有一件握手期就发生、但常被忽略的事：**服务端怎么知道该给你哪张证书？** 一个 IP 上托管几十个域名（上一章实测过），全靠客户端在 `ClientHello` 里明文带上名字——SNI（[RFC 6066](https://www.rfc-editor.org/rfc/rfc6066.txt)，已核实）：「It is RECOMMENDED that clients include an extension of type "server_name" in the client hello whenever they locate a server by a supported name type」，服务端「MAY use the information ... to guide its selection of an appropriate certificate」。同一节还有一条硬规定：**Literal IPv4 and IPv6 addresses are not permitted in "HostName"**——所以用 IP 直连访问 HTTPS 时，SNI 无从谈起，证书几乎必然对不上名字。

这条正好解释一类真实故障：**用 IP 访问报错、用域名正常；或域名证书正确、某个子域名却拿到另一张证书**（主站与子域走不同的 `server_name` 选择结果）。

## 常见错误与排查

**1. 现象：报错只有「请求失败」，无法判断是网络还是服务。**

原因：不同段的失败形状被合并成一句话了。本机实测它们完全不同形状：RST → 立刻 `ECONNREFUSED`（2 ms）；无应答 → 一直重传（探针设的 6 秒到点才报错）。

怎么确认：按段取数——`dns.lookup` 拿没拿到地址（上一章）→ 错误码是 `ECONNREFUSED` 还是 `ETIMEDOUT` → TLS 是否有 `authError` → 应用层有没有状态码。四段各自有独立判据。

怎么修：把四段的耗时与错误分别上报，别用一条「网络错误」概括（做法见[日志与监控](/backend/logging-and-monitoring)）。

**2. 现象：证书换了，一部分客户端仍报错，另一部分正常。**

原因：链不完整（只发叶子没发中间证书），或最后一环落不到该客户端的名单里；交叉签名意味着不同客户端可能走两条不同的链。

怎么确认：把链逐环打印出来，检查每个 `issuer` 是否等于下一环的 `subject`，以及最末环是否自签。实测这条链的链深是 3 与 4，可以直接对照。

怎么修：服务端配置里使用完整链文件（fullchain），并确认新根已进入目标客户端名单。**不要靠「关掉证书校验」来消除报错**——那等于把本章最后一节全部作废。

**3. 现象：重启服务后端口占用，或 `netstat` 里一堆 `TIME_WAIT`。**

原因：主动关闭连接的一方 MUST 在 TIME_WAIT 停留 2×MSL；MSL 取多少是实现选择。

怎么确认：先看角色——这台机器是主动关的还是被动关的；再看有没有真实症状（临时端口耗尽、新连接建立失败）。本机快照里 `TIME_WAIT 17 / ESTABLISHED 72`，没有症状。

怎么修：优先复用连接（客户端短连接改成 keep-alive，见[连接池与慢查询](/data-storage/connection-pool-and-slow-query)）；把「谁来主动关闭」这件事安排到合适的一侧。数量本身不是故障，不要为了消数字去调小内核参数。

**4. 现象：批量写数据时内存持续上涨、进程被 OOM kill，但对端没有任何报错。**

原因：忽略了 `socket.write()` 返回的 `false`。实测在 382 次写里 377 次返回 false、缓冲涨到 23.6 MiB，全部「成功」。

怎么确认：打印 `writableLength` 与 `write()` 返回值；再确认对端是不是根本没在读（本机实验里服务端 `pause()`）。

怎么修：返回 false 就暂停、等 `drain` 再继续；或改用流式管道，让背压自动传导到数据源。

**5. 现象：小请求莫名慢了 40 ms 一个，抓不到网络问题。**

原因：可能是 Nagle 与小包合并；也可能是重传退避（1 秒起步、每次翻倍）。本机 loopback 上两种 `setNoDelay` 设置看不出差别，所以这条要按真实链路判断。

怎么确认：先看数量级——几十毫秒级像链路 RTT 与合并策略；一秒以上、且成 2 的幂次出现，几乎一定是重传计时器（那是丢包，不是慢）。

怎么修：前者按应用写法调整（攒够再写或显式关 Nagle）；后者是链路/中间设备问题，调超时只会掩盖它（Linux 侧的排查见[网络诊断与防火墙](/linux/networking)）。

## 练习

<Exercise title="复现三种失败形状，并说清 6 秒是谁定的" difficulty="基础">

在你自己的机器上（不必出公网）做三件事，原样记录错误码与耗时：

1. 起一个 TCP 服务端，拿到端口后立刻 `close()`，然后去连那个端口；
2. 连 `192.0.2.1:80`，并给 socket 设 6 秒超时；
3. 连一个真实域名的 443（TLS 完成后打印 `authorized` 与 `authError`）。

回答：1 和 2 的失败形状为什么差三个数量级？第 2 步那个「6 秒」是 TCP 的决定还是你的决定？第 3 步 `authorized=true` 证明了什么、没证明什么？

<template #answer>

本机形状（2026-10-21）：1 → `ECONNREFUSED`，2 ms；2 → 6 秒内既没建立也没被拒绝，探针读数 6007 ms；3 → TLS 握手完成、`authorized=true`、`authError=null`。

1 快是因为对端协议栈还在，它替你回 RST；2 慢是因为没人应答，你的 SYN 只能按计时器重发（RFC 6298：初始 1 秒，之后 `RTO ← RTO * 2`）。**那个 6 秒是你设的超时**，不是 TCP 放弃的时间——把它改成 30 秒你会看到它继续重传。这就是「超时是产品决定」的意思：你的用户愿意等多久，跟协议无关。

3 的 `authorized=true` 只证明**链验证通过了**（签名链条 + 名字 + 有效期，落到本机 148 条名单里的某个根），**不证明**这个站点可信、内容正确或应用层返回了对的东西——那是第七章的事。

</template>

</Exercise>

<Exercise title="读出一个站点此刻的协商结果与剩余证书天数" difficulty="进阶">

用 `node:tls` 的 `connect`，对至少 3 个不同厂商托管的域名打印：`getProtocol()`、`getCipher()`、`alpnProtocol`、`authorized`、以及从 `getPeerCertificate(true)` 得到的链深与叶子 `valid_to`。然后把协议下界强制设成 TLSv1.2，再跑一遍同样的域名。

回答：强制降版本后，哪些字段变了、哪些没变？`valid_to` 距今还剩几天，这个数够不够你判断「多久之后会出事故」？

<template #answer>

本机实测：默认下三个域名（共 4 次握手，nodejs.org 连了两次）全部 `TLSv1.3`，强制 TLSv1.2 后 nodejs.org 变成 `TLSv1.2` + `ECDHE-ECDSA-AES128-GCM-SHA256`（原来是 `TLS_AES_256_GCM_SHA384`），**但 `alpnProtocol` 仍是 `h2`、`authorized` 仍是 `true`、链深仍是 3**。

变的只有「版本与套件」这一维；ALPN、身份验证、链结构都不受影响。这个对照的价值就是让你能分开三件事：加密算法、应用层协议、身份。

叶子的实测有效期是 90 天（`2026-09-23 → 2026-12-22`）。光看天数不够——**关键是有没有自动续期**。有自动续期时 90 天是安全裕度；手动续期时 90 天是倒计时事故。所以这个数应该进你的日历而不是留在证书里：续期任务的验证方法是「真的换过一次并 reload 成功」，不是「脚本存在」。

</template>

</Exercise>

<Exercise title="把「一条消息」分别用 TCP 和 UDP 实现，然后证明 UDP 版少了什么" difficulty="挑战">

写两个最小服务：客户端发送 3 条形如 `HELLO:<n>:<随机长度文本>` 的消息。

- TCP 版：服务端要把它们切成 3 条——自己加边界（长度前缀或换行）。
- UDP 版：服务端天然收到 3 个报文，但请你对同一条消息发送两次，观察服务端收到几条。

回答：TCP 版你付了什么代价？UDP 版在「重复」和「丢失」两件事上分别是什么表现？如果这台服务要在公网跑，你还必须补哪三件机制？

<template #answer>

TCP 版必须自己分帧——本章实测已经把原因钉死了：3 次 `write` 只给对端 1 个事件（`"PINGPINGPING"`）。你付的代价是**协议设计的责任**：长度前缀、分隔符或固定长度，三者总得选一个，还要定义半条消息怎么处理。这就是所有文本协议有 `Content-Length` 或换行结束符的原因。

UDP 版：3 个报文天然收到 3 次；同一条发两次，服务端就是 2 次——**没有去重**，因为规范明说「delivery and duplicate protection are not guaranteed」。它也不会告诉你丢了：没收到就是没收到，没有报错。

公网跑必须补的三件：**序号（或消息 ID）+ 去重**、**超时重传**、**拥塞控制或速率上限**。补齐之后你会发现自己正在手写一个 TCP。这正是 QUIC 的来历：在 UDP 上重建这些机制，换来「流与流之间不互相阻塞」与「握手与传输层合并」的收益（第七章展开；本机没有 QUIC 客户端，本章不做实测断言）。

</template>

</Exercise>

## 官方文档与延伸阅读

- [RFC 9293（TCP）](https://www.rfc-editor.org/rfc/rfc9293.txt) —— 核实三次握手的首要理由（丢弃旧重复连接发起）、握手序号示例、RST 的作用、TIME-WAIT 的 2×MSL 与「MSL 取 2 分钟是工程选择」、可用窗口公式 `U = SND.UNA + SND.WND - SND.NXT`。
- [RFC 6298（TCP 重传计时器）](https://www.rfc-editor.org/rfc/rfc6298.txt) —— 核实初始 RTO 为 1 秒、下限 1 秒、上限至少 60 秒、`(5.5) RTO ← RTO * 2` 与 Karn 算法的 MUST。
- [RFC 8446（TLS 1.3）](https://www.rfc-editor.org/rfc/rfc8446.txt) 与 [RFC 5246（TLS 1.2）](https://www.rfc-editor.org/rfc/rfc5246.txt) —— 核实两代握手的消息流（各自的 Figure）、`HelloRetryRequest` 需要客户端重新开始握手、0-RTT「不具前向保密」、证书必须由受信 CA 签名并谨慎选择信任锚、服务端证书选择规则中提到 `server_name` 扩展。
- [RFC 6066（SNI）](https://www.rfc-editor.org/rfc/rfc6066.txt) —— 核实「按名字定位服务器时建议携带 server_name」与「IP 字面量不允许作为 HostName」；[RFC 768（UDP）](https://www.rfc-editor.org/rfc/rfc768.txt) —— 核实「不保证送达与去重，需要有序可靠流的应用应使用 TCP」。
- [MDN · TLS 术语条目](https://developer.mozilla.org/zh-CN/docs/Glossary/TLS) —— 读者速查入口（2026 年 10 月核实可访问，状态码 200）。
- 站内相关：[网络：分层模型与 DNS](/computer-science/network-dns)（上一章，本章接手它交出的 IP）、[网络诊断与防火墙](/linux/networking)、[协议选型](/realtime/choosing)。以上 RFC 链接都是本站 2026 年 10 月直接下载正文后引用的原句，不是二手转述。

## 下一章

本章把链路中间三段变成可指认的对象：握手与挥手的次数各有理由（旧包、单向 FIN）、重传由一个会翻倍的计时器决定（而放弃时间由你决定）、TCP 不保留写边界（所以协议必须自己分帧）、TLS 从两次往返压到一次、证书验证是在跟本机那份 148 条名单比链条。

下一章是[网络：HTTP 演进与 CDN](/computer-science/network-http)。你已经有地址、有连接、有加密身份，剩下的是最上面那层怎么把请求排队、怎么复用连接、以及为什么加了 CDN 会变快。
