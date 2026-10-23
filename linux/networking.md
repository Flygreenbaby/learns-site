# 明明在监听，就是连不上：监听地址、两种失败耗时与防火墙的分层排查

产品部署到服务器上之后，最耗时间的不是写接口，而是「连不上」这四个字。而「连不上」至少有三种完全不同的意思：`Connection refused` 是包走到了那台机器、内核明确告诉你这个端口没人接；`Connection timed out` 是包发出去毫无回音，你可能连机器都没走到；`Could not resolve host` 则根本没走到网络层，名字转数字就失败了。三者要查的东西毫不相干——第一种看监听地址与进程状态，第二种看路由、防火墙、安全组，第三种看解析器和 hosts 文件。分不清它们，就会拿着防火墙的命令去查一个 DNS 问题。

还有一个更隐蔽的：服务确实起来了，`ss` 上确实有监听，本地 `curl 127.0.0.1:3000` 也通，但从外面就是连不上。原因往往不是防火墙，而是**监听地址**——进程只绑了回环，别的来源地址本来就不该连上。反过来，Node 17 之后 `localhost` 默认先解析到 IPv6 的 `::1`，如果你的服务只监听了 IPv4 回环，就会出现「服务在本机、本机连不上自己」这种荒谬现象。这一章实测到的正是它。

<Callout type="verified" title="本章实测环境">

Windows 10 x64 + Git Bash + Node v25.4.0（只用 `node:net` / `node:dns` / `node:http` 内置模块，零依赖）+ curl 8.17.0 (x86_64-w64-mingw32)，日期 2026-10-19 至 10-20。所有监听都是脚本进程内的临时监听，端口 45971 / 45983 / 45999，跑完即关闭并核实端口已释放。文中出现的本机网卡地址一律写成 `192.168.1.*`（末段已掩码）。

</Callout>

<Callout type="unverified" title="Windows 栈的行为不能推断 Linux">

本章所有「实测」结果都来自这台 Windows，验证的是 **TCP/IP 语义和排查思路**，不是 Linux 的具体实现。`ip`、`ss`、`nft`、`resolvectl`、`tcpdump` 本机没有，正文给的是命令、预期输出形态和判读方法，**未在本机执行**。另外，本机连本机网卡地址不经过入站过滤，所以「防火墙拦入站」的场景在本机无法复现。耗时数字只用来区分「立即拒绝」和「等到超时」两类，不要当成性能结论。

</Callout>

## 三种连不上的样子：耗时就是判据

用 `node:net` 对同一个端口做连接探测，客户端设 1.5 秒主动断开，实测三种失败长这样：

```text
① 回环上没人监听的端口     ：{"ok":false,"code":"ECONNREFUSED/syscall=connect","ms":1}
② 有路由但没人应答 192.0.2.1：{"ok":false,"code":"TIMEOUT(客户端1.2s主动断开)","ms":1509}
③ 链路本地地址 fe80::1      ：{"ok":false,"code":"TIMEOUT(客户端1.2s主动断开)","ms":1216}
⑥ DNS 层就失败（.invalid 是 RFC 6761 保留 TLD）：code=ENOTFOUND syscall=getaddrinfo hostname=no-such-host.invalid
```

关键信息在 `syscall` 和 `ms` 上：`syscall=connect` 说明解析已成功、包已发出；`syscall=getaddrinfo` 说明还卡在名字转数字，网络层根本没开始。1 毫秒和 1500 毫秒是两种性质——前者是对方内核立刻回 RST，后者是 SYN 石沉大海、一直等到客户端自己放弃。

| 现象 | 底层发生了什么 | 典型耗时 | 该往哪一层查 |
| --- | --- | --- | --- |
| `ECONNREFUSED` / `Connection refused` | 走到了目标机器，该地址上确实没有监听者，内核回 RST | 毫秒级，几乎立刻 | 服务的监听地址与进程是否活着 |
| `ETIMEDOUT` / 一直卡住到超时 | SYN 没到达目标，或到达后被静默丢弃（DROP） | 秒级，等客户端超时 | 路由、安全组、主机防火墙、中间代理 |
| `ENOTFOUND` + `syscall=getaddrinfo` | 名字解析失败，没走到网络层 | 取决于解析器 | DNS、hosts 文件、解析器缓存 |
| `EHOSTUNREACH` / `ENETUNREACH` | 连路由都没有，包发不出去 | 毫秒级 | 本机网卡状态、路由表、VPC 与子网配置 |

这个判据非常省时间：看到 `refused` 就别再翻防火墙了——拦截一般是静默丢弃，表现为超时而不是拒绝；看到超时也别急着怀疑应用挂了，先确认解析出来的 IP 是不是你以为那台机器。

curl 的退出码是同一套判据的命令行版本。同一台机器实测：

```bash
curl -sS "http://no-such-host.invalid/" -o /dev/null; echo "退出码=$?"
curl: (6) Could not resolve host: no-such-host.invalid
退出码=6

curl -sS -m 2 "http://192.0.2.1:8080/" -o /dev/null; echo "退出码=$?"
curl: (28) Connection timed out after 2009 milliseconds
退出码=28

curl -s -o /dev/null --fail "http://127.0.0.1:45999/"; echo "退出码=$?"
退出码=7
```

6 = 解析失败，28 = 超时，7 = 连不上（拒绝）。写部署脚本的健康检查时，靠 `curl -sSf` 的退出码判断比读输出文本可靠得多——但别把 `curl ... | grep` 的退出码当成 curl 的，这个坑本章后面会原样重现一次。

## 监听地址决定谁能连进来

这是整章最该记住的一张表。同一个端口 45971，只改监听地址，从三个来源地址探测的结果（本机实测，`192.168.1.*` 是真实网卡地址的掩码形式）：

| 监听地址 | 从 `127.0.0.1` 连 | 从 `::1` 连 | 从本机网卡 `192.168.1.*` 连 | 含义 |
| --- | --- | --- | --- | --- |
| `127.0.0.1` | 通 | 不通 `ECONNREFUSED`(2ms) | 不通 `TIMEOUT`(604ms) | 只有本机回环能进 |
| `0.0.0.0` | 通 | 不通 `ECONNREFUSED`(0ms) | 通 | 所有 IPv4 地址，但**不是双栈** |
| `::` | 通 | 通 | 通 | IPv6 任意 + 双栈：IPv4 也一起听 |
| `::1` | 不通 `ECONNREFUSED`(1ms) | 通 | 不通 `TIMEOUT`(603ms) | 只有 IPv6 回环 |
| `192.168.1.*`（具体网卡 IP） | 不通 `ECONNREFUSED`(0ms) | 不通 `ECONNREFUSED`(1ms) | 通 | 只听这一块网卡 |

三个可以直接当结论用的读法。

**第一，`0.0.0.0` 不含 IPv6。** 绑 `0.0.0.0` 之后从 `::1` 连是 `ECONNREFUSED`；反过来绑 `::` 从 `127.0.0.1` 连是通的。这就是为什么很多服务的默认值是 `::`——一个 socket 同时接 IPv4（以 IPv4-mapped 形式）和 IPv6。

**第二，绑具体网卡 IP 与绑 `0.0.0.0` 的差别只在多网卡机器上暴露。** 服务器同时有内网网卡和公网 IP 时，只想让内网访问就绑内网地址——这比「绑全部再靠防火墙挡」安全，因为它根本不创建可被外部连接的入口。

**第三，来源不通时的耗时差异不能照抄到 Linux。** 本机从网卡地址连一个只听回环的服务，结果是 `TIMEOUT`(604ms)；很多人以为这种情况应该立刻 `refused`。这是 Windows 网络栈在这条本机路径上的表现，Linux 上目标 IP 由本机持有时通常内核会更快回绝。**别把这里的毫秒数当成 Linux 的行为**，判据只有一条：来源地址不在监听集合内就一定连不上，且与防火墙无关。

对应到实际配置：开发机上绑 `127.0.0.1` 是对的；容器里要让端口映射生效通常得绑 `0.0.0.0`（容器内 `0.0.0.0` 只覆盖这个网络命名空间，不是「向全世界开放」）；Nginx 写 `listen 127.0.0.1:80;` 就只服务本机反代链路，这类「有意只听本机」的绑法在[把站点接到公网](/linux/nginx)里会再碰到。

## localhost 不等于 127.0.0.1

「服务在监听，本机也连不上」在 Node 上最常见的原因是名字解析。用 `node:dns` 实测：

```text
系统配置的 DNS 服务器：["127.0.0.1"]
lookup("localhost", all)          : [{"address":"::1","family":6},{"address":"127.0.0.1","family":4}]
verbatim=true（Node 17+ 默认）     : [{"address":"::1","family":6},{"address":"127.0.0.1","family":4}]
verbatim=false（IPv4 在前）        : [{"address":"127.0.0.1","family":4},{"address":"::1","family":6}]
resolve4("localhost")              : code=ECONNREFUSED（本机配置的解析器拒答这类查询）
lookup 直接传 IP 也返回成功         : [{"address":"127.0.0.1","family":4}]
```

同一份监听代码，`net.createServer().listen(45971, '127.0.0.1')` 只监听 IPv4 回环；客户端如果写成 `connect(45971, 'localhost')`，Node 17+ 默认 `verbatim: true`，先拿到 `::1`，于是连接被拒。实测两个方向都试了：

```text
④ 绑了 ::1 之后从 127.0.0.1 连（IPv6-only 监听）：
   {"ok":false,"code":"ECONNREFUSED/syscall=connect","ms":0} / 从 ::1 连：{"ok":true,"code":"CONNECTED","ms":1}
⑤ 绑 0.0.0.0 之后从 ::1 连（IPv4-only 监听）：
   {"ok":false,"code":"ECONNREFUSED/syscall=connect","ms":0} / 从 127.0.0.1 连：{"ok":true,"code":"CONNECTED","ms":0}
```

结论直接可执行：**配置里要区分「本机自己回环检查」和「给外部访问的地址」**。健康检查用 `127.0.0.1` 而不是 `localhost`，就绕开了这一整套歧义；要么就服务端绑 `::`、两边都能接。

名字到 IP 有两条完全不同的路径，排障时必须分清自己在哪一条上：

| | `dns.lookup()` / `getaddrinfo()` | `dns.resolve*()` |
| --- | --- | --- |
| 走什么 | 系统的名称解析服务 | 直接向配置的 DNS 服务器发查询 |
| 读 `/etc/hosts`（Windows 的 `hosts` 文件）吗 | 读 | **不读** |
| 走解析器缓存吗 | 走（Linux 上可能是 systemd-resolved、nscd） | 不走 |
| Node 里 | `net`、`http` 默认用它，跑在线程池 | 只有显式调用 `dns.resolve4` 等才用 |

于是出现两类「明明改了却不生效」：改了 `hosts` 但用 `resolve` 的组件不认；改了云上 DNS 记录但本机解析器缓存旧值。Linux 侧的确认命令与预期输出（**未在本机验证**）：

```bash
getent hosts api.example.com     # 走 getaddrinfo/nsswitch 这一条路径
resolvectl query api.example.com # 用 systemd-resolved 时看它选中哪条链路、哪个 DNS 服务器
resolvectl flush-caches          # 清缓存；无 systemd-resolved 的机器看 nscd / dns-clean 之类
```

很多容器基础镜像里没有 `systemd-resolved`，第二条命令会直接报不存在，这不代表解析坏了——先 `cat /etc/resolv.conf` 看 nameserver 是谁。`getaddrinfo` 的 `AI_ADDRCONFIG` / `AI_V4MAPPED` 标志语义见章末手册页链接。

## 端口被占了：EADDRINUSE 与「谁在听」

同一端口起第二个监听者，本机实测的原文错误：

```text
第二个监听失败：code=EADDRINUSE errno=-4091 syscall=listen message=listen EADDRINUSE: address already in use 127.0.0.1:45971
```

`syscall=listen` 明确告诉你失败发生在绑定阶段，不是连接阶段。三种成因按出现频率排：上一版进程还没退（最常见）、两个服务配了同一端口、重启时旧 socket 还在 TIME_WAIT 而新进程没设复用选项（第三种和 Linux 的 `SO_REUSEADDR` 语义有关，**未在本机验证**）。现象都是 `EADDRINUSE`，所以排查动作一样：先看谁占着。

Linux 上确认监听关系用 `ss`（iproute2 包）。`-l` 只显示监听中的 socket、`-n` 不解析名字和端口、`-t` 只看 TCP、`-p` 显示使用它的进程——四个选项的含义对照 ss(8) 手册页核实过。预期输出形态（**示意，未在本机执行**）：

```bash
ss -lntp sport = :45971
```

```text
State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process
LISTEN  0       511     127.0.0.1:45971     0.0.0.0:*          users:(("node",pid=1234,fd=19))
```

判读三个点。`Local Address:Port` 显示 `127.0.0.1:45971` 而不是 `0.0.0.0:45971` / `[::]:45971`，那前面那张表已经给出答案了，防火墙不背这个锅。`Recv-Q` 在 LISTEN 行是已建立但应用还没 `accept()` 的积压，持续变大说明事件循环卡住了——这是「端口通、请求不响应」的典型指纹。`users:(...)` 只有 root 或同属主才看得全，看不到就 `ss -lnt` 先确认端口，再回 `ps` 找 PID（顺父进程链到 systemd，见[第 3 章](/linux/processes-and-systemd)）。端口冲突的根治办法不是「杀掉再试」，而是让端口可配、并在绑定失败时打印实际尝试的地址——这属于[软件包与运行环境](/linux/packages-and-runtime)那条「同一个二进制在不同环境下行为不同」的主线。

## 读 curl -v：一次请求的阶段与连接复用

`curl -v` 的输出是被忽略最多的诊断信息。一次成功连接的完整原文（本机 curl 8.17.0，打到一个只监听回环的临时 HTTP 服务）：

```text
*   Trying 127.0.0.1:45983...
* Established connection to 127.0.0.1 (127.0.0.1 port 45983) from 127.0.0.1 port 7372
* using HTTP/1.x
> GET / HTTP/1.1
> Host: 127.0.0.1:45983
> User-Agent: curl/8.17.0
> Accept: */*
>
< HTTP/1.1 200 OK
< content-type: text/plain
< connection: keep-alive
< Date: Tue, 20 Oct 2026 02:36:09 GMT
< Transfer-Encoding: chunked
<
* Connection #0 to host 127.0.0.1:45983 left intact
```

`*` 开头是 curl 自己的阶段说明，`>` 是发出去的请求行/头，`<` 是收到的响应。**`>` 出现而 `<` 不出现**，说明请求已经发出去了、问题在服务端或链路更远处；连 `>` 都没有、卡在 `Trying ...` 之后，说明 TCP 就没建成，服务端配置根本还没参与。最后一行 `left intact` 意味着连接留在连接池里没关——这正是 keep-alive。

失败的原文对比一下，判读点非常具体：

```text
*   Trying 127.0.0.1:45999...
* connect to 127.0.0.1 port 45999 from 0.0.0.0 port 7377 failed: Connection refused
* Failed to connect to 127.0.0.1 port 45999 after 2038 ms: Could not connect to server
* closing connection #0
```

`from 0.0.0.0 port 7377` 是本地侧地址还没定下来的表现；`after 2038 ms` 是 curl 尝试的总耗时。这里有一个必须如实记录的教训：这一条我当时写成 `curl -sv ... 2>&1 | tr -d '\r'`，然后 `echo $?` 拿到 **0**——管道里 `$?` 是 `tr` 的退出码，不是 curl 的；不带管道再测才是 7。部署脚本里的健康检查犯这个错，就会把「连不上」判成「成功」。

分阶段计时用 `-w`，本机真实读数：

```bash
curl -s -o /dev/null -w 'dns=%{time_namelookup} connect=%{time_connect} start=%{time_starttransfer} total=%{time_total} code=%{http_code} num_connects=%{num_connects} ip=%{remote_ip} rport=%{remote_port} lport=%{local_port}\n' "http://127.0.0.1:45983/"
```

```text
dns=0.000044 connect=0.000901 start=0.001395 total=0.001444 code=200 num_connects=1 ip=127.0.0.1 rport=45983 lport=7375
```

四个时间是累计值，差值才是阶段耗时：`dns` 是解析、`connect - dns` 是三次握手、`start - connect` 是服务端处理加首字节、`total - start` 是收完 body。同一条命令打三个 URL（curl 对同一 host 默认复用连接）：

```text
num_connects=1 num_requests=
num_connects=0 num_requests=
num_connects=0 num_requests=
```

`num_connects` 只在第一次是 1，后两次是 0——三次请求只建立了一条 TCP 连接。`-v` 里的对应证据是第二、三次出现了这行而没有新的 `Trying`：

```text
* Reusing existing http: connection with host 127.0.0.1
```

两个本机限制也记下来，它们会让人误判「curl 坏了」：`%{num_requests}` 在本机 8.17.0 上**不认**，报 `curl: unknown --write-out variable: 'num_requests'` 且输出留空，写 `-w` 前先用最简形式验证一遍；`-w` 里放中文会在 Windows 控制台输出成乱码，那是代码页问题不是 curl 的错。另一个反直觉的实测：`--next` 并不会强制新建连接，照样打印 `Reusing existing http: connection`——它只把命令行切成两个 transfer，连接缓存没清。

服务端侧的硬证据更直接：同一个临时服务，前两次请求带 `Connection: close`、后三次共用一个 keep-alive agent，服务端自己数的连接数停在 **3**。

```text
agent:false + Connection: close #1 首字节 11.78ms  总 12.48ms  服务端看到的连接序号=1
agent:false + Connection: close #2 首字节  2.04ms  总  2.16ms  服务端看到的连接序号=2
keepAlive agent 第 1 次            首字节  1.12ms  总  1.30ms  服务端看到的连接序号=3
keepAlive agent 第 3 次            首字节  0.51ms  总  0.60ms  服务端看到的连接序号=3
```

（脚本那行小结写的是「四次请求」，实际发了五次；结论不变。抄录时我没替它圆。）

这条链的排障意义是：客户端到服务端之间每一层（Nginx 上游连接池、CDN、云 LB）都在复用连接，所以「某个请求偶发慢 200ms」不一定是服务端处理慢，很可能只是那次真的重新握手了。反过来的坑是两端 keep-alive 超时不匹配：上游闲置回收比 Nginx 快，就会出现经典的「偶发 502 而重启即好」。`Connection` / `Keep-Alive` 头的语义见 MDN 的 HTTP 文档，站内[实时通信](/realtime/)也涉及长连接。

## TCP 有两半：一端关了另一端还能发

`net` 模块实测半关闭，客户端 `write` 后立刻 `end()`：

```text
  服务端收到："hello\n"
  服务端看到客户端 FIN（end 事件），但它没关自己那半边
  客户端 FIN 之后读到："  服务端在收到 FIN 之后仍然回了数据\n"
```

`end()` 只发自己这一边的 FIN，对方那半边照样能发数据；把 `end()` 当成「断开」就会丢掉响应尾巴。要立刻切断得用 `destroy()`，但那不是优雅关闭。

同一个实验里更实用的发现：N1 那些「探测一下就走」的短连接，服务端每一边都会收到 `ECONNRESET`。**必须给每个 socket 挂 `c.on('error', () => {})`，否则整个进程直接崩掉。**「监控探测把被扫的服务扫崩」就是这么发生的。给 socket 挂 error 监听是必需项而不是防御性冗余；优雅停机要反过来做：先停止 accept，再等在途请求结束。

## 连不通的完整分层：从解析到安全组

把判据串成一条从上到下的排查链，每一层只问一个问题，答案明确就往下走。

```text
第 0 层  名字解析对不对   → ENOTFOUND / 解析出的 IP 是不是你以为那台
第 1 层  路由到不到       → EHOSTUNREACH / ENETUNREACH
第 2 层  包能不能进来了   → 一直超时：云安全组 / 主机防火墙 / 中间网络 ACL
第 3 层  端口有没有人听   → refused：监听地址、进程死了、绑了别的端口
第 4 层  服务答得对不对   → 连上了但 502/超时/证书错：应用、TLS、上游配置
```

第 2 层最容易被跳过，因为它需要一个关键认识：**入站被拦的典型表现是超时，不是拒绝**——DROP 规则静默丢弃包、不给回音，REJECT 规则才回拒绝。Linux 上把这两层分开看（以下命令与输出形态**未在本机执行**，请在测试机上验证）：

```bash
ip -br addr                       # 网卡状态与地址，确认服务要绑的地址真的存在
ip route get 203.0.113.10         # 出网走哪块网卡、哪个源地址
nft list ruleset                  # nftables 的完整规则；没有 nft 的老机器是 iptables -S
ufw status verbose                # Ubuntu 的 ufw 是 nftables/iptables 的前端
firewall-cmd --list-all           # RHEL 系 firewalld
```

两种典型情形。「`ss` 显示监听在 `0.0.0.0`、本机 `curl 127.0.0.1` 通、外部超时」——问题几乎必在第 2 层：安全组没放行，或主机规则 DROP 了。这时最有效的工具是在目标机抓包：

```bash
tcpdump -i eth0 -nn 'tcp port 443'    # 未在本机验证
```

只看到 SYN 没有 SYN/ACK，说明包**到了**这台机器但没人或规则不让它回去；一个 SYN 都没抓到，说明包**没到**，继续往上查安全组、路由、NAT。「SYN 有没有出现在网卡上」这个二分，比调十遍防火墙规则都快。

云上安全组通常是**有状态**的：放行入站后同一连接的回包自动允许，不必再开对应端口的出站规则（各云厂商实现有差异，请在你的云的文档里核对，本章不凭记忆写产品差异）。这一层最容易漏，因为「我在服务器上 curl 外面是通的」只验证了出站。

最后一个必须说清的实测局限。本机验过「从这台机器连它自己的网卡地址」：

```text
address()={"address":"0.0.0.0","family":"IPv4","port":45971}；回环 通(0ms)，本机网卡 通(0ms)
```

两条都通，说明这台 Windows 没拦「本机发起、目标为本机网卡」的连接，也说明**这类自连不能用来验证入站规则是否放行**——要判断防火墙，必须从另一台机器发起。「服务器上 curl 自己的公网 IP 通了」不等于外部能访问，这条路径常常在主机内部就绕回来了，没走到外部过滤点。

## 常见错误与排查

**1. 看到 `Connection refused` 就去翻防火墙规则。** 现象：连接毫秒级失败，错误里带 `ECONNREFUSED`，`syscall=connect`。原因是拒绝是**目标机器内核主动回的**，说明包已经到了，问题在「这个地址上没人听」。怎么确认：在目标机 `ss -lntp` 看 `Local Address:Port` 那一列到底是什么。修法：把监听地址改成 `0.0.0.0` 或 `::`（容器里尤其常见），或者换对来源地址再测。

**2. 用 `localhost` 做健康检查，服务却只听 IPv4 回环。** 现象：`curl http://localhost:3000` 失败、`curl http://127.0.0.1:3000` 成功，看起来像随机故障。原因是 Node 17+ 的 `dns.lookup` 默认 `verbatim: true`，本机实测 `localhost` 返回顺序是 `::1` 在前。怎么确认：`node -e "require('dns').lookup('localhost',{all:true},(e,a)=>console.log(a))"`。修法：配置和探针统一写 `127.0.0.1`，或服务端绑 `::` 一次接两族；不要为此改全局解析行为。

**3. 重启服务报 `EADDRINUSE`，杀了进程还是报。** 现象：`listen EADDRINUSE: address already in use 127.0.0.1:45971`，`syscall=listen`（实测原文）。三类原因见上一节：还有第二个进程在听、旧 socket 在 TIME_WAIT、systemd 在你手动重启的同时也拉起了一个。修法：`ss -lntp` 拿 PID 再看父进程链，父进程是 `systemd` 就说明你手动起的那个才是冲突源——要么统一交给 `systemctl restart`，要么调试时先 `systemctl stop`。

**4. 健康检查脚本把 curl 的失败读成成功。** 现象：CI 里 curl 连不上，脚本却继续执行、部署"成功"。原因是管道会吃掉退出码：本章实测 `curl -sv ... 2>&1 | tr -d '\r'` 之后 `echo $?` 得到 0，而 curl 真实退出码是 7。修法：`set -o pipefail`，或用 `${PIPESTATUS[0]}` 取最左边的退出码；判定优先看 `--fail` 的退出码而不是输出文本。

**5. 从服务器自己 curl 自己的公网 IP 通了，就认为外部可访问。** 现象：本机验证全绿，用户仍然打不开。原因是本机发起、目标为本机持有地址的连接通常绕过了你关心的那道入站过滤（本机实测回环与网卡地址两条都通）。修法：验收必须从另一台机器或外部探测服务发起同一条 curl——这正是[第一期上线里程碑](/guide/roadmap)要求「域名 + HTTPS 真实可访问」的原因。

## 练习

<Exercise title="复现 localhost 抢先解析到 IPv6" difficulty="进阶">

用 Node 内置模块（不装任何东西）做两件事：起一个只监听 `127.0.0.1` 的服务，然后分别用 `localhost` 和 `127.0.0.1` 作为主机名连它，记录两次结果。如果两次表现一样，说明你的环境解析顺序不是本章机器那样，请打印出 `dns.lookup('localhost', { all: true })` 的实际顺序来证明你的结论。

<template #answer>

```js
import net from 'node:net'
import dns from 'node:dns'

const srv = net.createServer((c) => c.on('error', () => {}))
srv.on('error', (e) => console.log('监听失败', e.code))
srv.listen(45971, '127.0.0.1', () => {
  console.log('解析顺序：', dns.lookup('localhost', { all: true }, (e, a) => console.log(e ?? a)))
  for (const host of ['localhost', '127.0.0.1']) {
    const c = net.connect(45971, host, () => {
      console.log(host, '→ 连上了'); c.destroy()
    })
    c.on('error', (e) => console.log(host, '→', e.code, e.syscall))
  }
})
```

本章机器的实测结果：`localhost` 解析返回 `[{"address":"::1","family":6},{"address":"127.0.0.1","family":4}]`，`::1` 在前；用 `localhost` 连得到 `ECONNREFUSED syscall=connect`，用 `127.0.0.1` 连成功——正好对应正文那句「只听 IPv4 回环时从 `::1` 连不通（实测 0ms）」。

三个要点：差异完全由解析顺序产生，与防火墙、服务代码无关；`srv.on('error')` 不能省，否则端口被占时进程以未捕获异常退出；如果你两次都成功，多半是 hosts 里 `::1 localhost` 被注释掉了或解析器只给 IPv4——打印顺序就是证据，别凭「应该通」下结论。修法按优先级：连接方直接写 `127.0.0.1`，或服务端绑 `::` 一次接两族。

</template>

</Exercise>

<Exercise title="故意造出端口冲突并定位占用者" difficulty="进阶">

在同一个端口上起两个监听，把第二个的完整错误原文抄下来（含 `code`、`errno`、`syscall`、`message`）。然后回答：为什么单看错误文本无法知道是谁占着这个端口？在 Linux 上用什么命令拿到 PID，在 Windows 上又用什么命令？

<template #answer>

本章机器的实测原文：`code=EADDRINUSE errno=-4091 syscall=listen message=listen EADDRINUSE: address already in use 127.0.0.1:45971`。`syscall=listen` 表明失败在绑定阶段而不是连接阶段，这是把它和「连不上别人的端口」区分开的关键。

错误文本里没有占用者身份：绑定检查是内核里的全局状态，它只知道「这个地址加端口已被占用」，不会带回持有者的进程信息。要身份就得查 socket 表。

Linux：`ss -lntp sport = :45971` 看 `users:(("node",pid=...,fd=...))`，拿到 PID 后 `ps -o pid,ppid,cmd -p <pid>`——父进程是 `systemd` 就说明该由 systemd 管而不是手动起。非 root 时 `users:` 可能为空，需要 sudo。

Windows：`netstat -ano | findstr :45971` 拿到 PID，再 `tasklist /FI "PID eq <pid>"`（本章清理阶段实际用的是 `tasklist //FI ...`——Git Bash 里单个 `/` 会被当成 POSIX 路径前缀吃掉，MSYS 风格参数要写 `//`）。

补充：N1 里同一端口依次换监听地址能全部成功，是因为每次都已 close。若第二个进程绑的是**另一个地址**（一个 `127.0.0.1`、一个 `0.0.0.0`），Linux 上通常同样算冲突（`0.0.0.0` 覆盖 `127.0.0.1`）——这条**未在本机验证**，请在目标环境用两个进程实测后再下结论。

</template>

</Exercise>

<Exercise title="写一段能真正报错的连通性检查" difficulty="挑战">

用 curl 写一个 shell 片段：对三个 URL 分别给出「解析失败 / 拒绝 / 超时 / 成功」四种判定之一并输出各阶段耗时，且**不能**因为管道或参数写错把失败读成成功。只允许使用你已验证存在的 `--write-out` 变量；写完必须构造一次失败，证明判定分支真的走通。

<template #answer>

```bash
#!/usr/bin/env bash
set -uo pipefail

probe() {
  local url=$1 out rc
  out=$(curl -sS -o /dev/null --connect-timeout 3 --max-time 8 \
        -w 'dns=%{time_namelookup} connect=%{time_connect} ttfb=%{time_starttransfer} total=%{time_total} code=%{http_code} conns=%{num_connects} ip=%{remote_ip}' \
        -- "$url")
  rc=$?
  printf '%s\n  %s\n  rc=%s\n' "$url" "${out:-<无输出>}" "$rc"
  case $rc in
    0)  echo '  判定：成功（注意 code 可能不是 2xx，那是应用层问题，不算连通性失败）' ;;
    6)  echo '  判定：解析失败 → 查 getent hosts / 解析器缓存' ;;
    7)  echo '  判定：连不上（拒绝）→ 查 ss -lntp 的监听地址' ;;
    28) echo '  判定：超时 → 查安全组 / 主机防火墙，必要时 tcpdump 看 SYN' ;;
    *)  echo "  判定：其他退出码 $rc → 用 curl --help 核对该版本含义" ;;
  esac
}

probe http://127.0.0.1:45999/            # 没人监听
probe http://no-such-host.invalid/       # 解析不了
probe http://192.0.2.1:8080/             # 无人应答
```

三个要点都是本章踩过的。`--connect-timeout 3` 让超时分支在 3 秒而不是系统默认的两分多钟出结果——不设它的部署脚本，一次网络故障就能把 CI 卡到被杀。`-- "$url"` 防止 URL 以 `-` 开头时被当成选项。`set -uo pipefail` 对应「常见错误」第 4 条那个管道坑；更稳的做法是像这里一样把输出先塞进变量、`rc=$?` 紧跟赋值取值，别在 `curl | tee` 之后才 `echo $?`。

变量必须逐个验证存在：本机 8.17.0 上 `%{num_connects}` 可用，`%{num_requests}` 报 `curl: unknown --write-out variable` 并让 `-w` 输出留空。写脚本前用一条最简 `curl -w '%{num_connects}\n'` 打一遍，比查文档还快（各发行版的 curl 版本差异很大）。判定必须靠构造失败来验证：上面三段 probe 在本机实测的退出码分别是 7、6、28——如果你的脚本对这三行都输出「成功」，那健康检查形同虚设。

</template>

</Exercise>

## 官方文档与延伸阅读

- [ss(8) 手册页（Debian bookworm / iproute2）](https://manpages.debian.org/bookworm/iproute2/ss.8.en.html)：核实正文用的 `-l` / `-n` / `-t` / `-p` 选项含义与 LISTEN 行 `Recv-Q` 的语义。**已核实**。
- [getaddrinfo(3)](https://manpages.debian.org/bookworm/manpages-dev/getaddrinfo.3.en.html)：核实 `AI_ADDRCONFIG`、`AI_V4MAPPED` 两个标志的行为，也就是「`localhost` 为什么有时只给 IPv4」的机制来源。**已核实**；实际返回顺序仍取决于你的 nsswitch 与解析器配置。
- [RFC 6761 Special-Use Domain Names](https://www.rfc-editor.org/rfc/rfc6761)：核实用来可靠复现「解析失败」的 `.invalid` 是保留顶级域、按规范应立即返回 NXDOMAIN。**已核实**。
- Node.js API 文档：[`net`](https://nodejs.org/api/net.html)、[`http`](https://nodejs.org/api/http.html)、[`dns`](https://nodejs.org/api/dns.html)——分别对应 `listen(port, host)` 的地址语义、`Agent({ keepAlive })` 与 `Connection: close` 的行为、`lookup` 与 `resolve` 的分工及 `verbatim` 默认值。这个默认值是版本相关的，动手前核对你那一版。
- [curl 官网](https://curl.se/)：`-w` 变量清单与退出码表（6 / 7 / 28）的入口。本章的实测结论是这份清单**必须按你机器上的 curl 版本核对**——`%{num_requests}` 在本机 8.17.0 上就不存在。
- [MDN HTTP 文档](https://developer.mozilla.org/en-US/docs/Web/HTTP)：`Connection` / `Keep-Alive` 的逐跳语义，支撑「两端 keep-alive 超时不匹配造成偶发 502」。
- [netfilter / nftables 官方站点](https://netfilter.org/)：`nft`、DROP 与 REJECT 区别的入口。**本章所有 `ip` / `ss` / `nft` / `ufw` / `firewall-cmd` / `tcpdump` / `resolvectl` 命令均未在本地 Linux 环境执行**，请以服务器所在发行版的文档与实测为准。
- 站内：上一章[软件包与运行环境](/linux/packages-and-runtime)、[进程与 systemd](/linux/processes-and-systemd)、[把站点接到公网](/linux/nginx)、下一章 [Shell 脚本](/linux/shell-scripting)。

## 下一章

本章把「连不上」拆成监听地址、解析路径、端口占用、连接阶段、防火墙分层五件事。排障时你会不断写脚本——健康检查、备份轮转、清理临时文件——而脚本最常见的失败方式是**在你机器上跑得好好的、在服务器 cron 里跑不通**。下一章 [Shell 脚本](/linux/shell-scripting) 会把本章露过一次脸的那个坑（管道让退出码说谎）讲透，并给出 `while read` 吃掉循环输入、CRLF、相对路径按调用者目录解析这些真实故障的可复现证据。
