# 前面站着一层：location 优先级、代理要补的头与 HTTPS 的分界

产品上线后，浏览器只跟一台机器上的 80/443 说话，这台机器再按 URI 把请求分派给静态文件、Node 后端、WebSocket 服务。承担这一层的 Nginx 同时干三件事，而三件事的**故障表现完全不同**：静态配错是 404，代理配错是 502/504，TLS 配错是证书不对。把它们混成「Nginx 挂了」，排查就变成猜。

这一章的模型是：**Nginx 是一台「按 URI 分派的转发器」，它在最前面终结 TLS**。所有坑都能从这句话推出来——`location` 的优先级决定分派到哪；「转发」决定后端看到的 `Host` 是什么、真实客户端 IP 在哪；TLS 终结点决定后端该生成 `http` 还是 `https` 的链接。

<Callout type="verified" title="本章实测环境">

Windows 10 x64 + Git Bash + Node v25.4.0（只用内置模块）+ 本机自带的 OpenSSL 3.5.4，日期 2026-10-20。证据脚本 `nginx7.mjs` 只监听 `127.0.0.1`（端口 46011～46044），临时文件只写在 `.scratch/w7`，跑完删除并核实：`端口 46041 现在=ECONNREFUSED；w7 目录是否存在=false；剩余 server=0`。正文引用的实测块逐字摘自 `nginx7-output.txt`，只去掉行首缩进与分节标题；毫秒数是那一次运行的观测值，不是性能结论。

</Callout>

<Callout type="unverified" title="本机没有 Nginx，实测的是机制不是 Nginx">

这台机器上**没有 nginx 二进制，也没有安装**（`command -v nginx` 找不到），所以本章所有 `nginx` 代码块都**没有在真实 Nginx 上运行过**，是按官方文档语义写的教学示例。实测只有两类，正文逐条标明：用 Node 手写的最小转发器与 TLS 服务复现的**协议机制**，以及本站按官方规则实现的 **location 匹配算法**。指令语义与默认值逐字引用 nginx.org 当前文档，但该文档描述的是最新主线（已到 1.29.x），发行版打包的通常更老——动手前先 `nginx -V`，有版本差异处本章都标了分界号。

</Callout>

## 配置的骨架，和「改完为什么不生效」

官方 Beginner's Guide：`The events and http directives reside in the main context, server in http, and location in server.` 四层嵌套 `main → http → server → location`。配置文件默认叫 `nginx.conf`，具体目录由发行版与编译参数决定（**未在本机验证**）；`conf.d` 与 `sites-available` + `sites-enabled` 那套是**发行版约定，官方文档里没有**。

改完必须显式生效。官方 `switches.html` 的定义（逐字）：

```text
-t — test the configuration file: nginx checks the configuration for correct syntax,
     and then tries to open files referred in the configuration.
-T — same as -t, but additionally dump configuration files to standard output (1.9.2).
-s signal — stop（快速关闭）／quit（优雅关闭）／reload／reopen（重开日志文件）
```

`-t` 值钱的是后半句：它不只查语法，还**尝试打开配置引用的文件**，证书路径写错、`include` 的 glob 落空都能被抓到。reload 的官方语义是成功才起新 worker、**失败则回滚、继续用旧配置跑**，所以顺序只能是 `-t` → `reload` → 再验证；「配置写错了但站点看着没事」恰恰说明新配置没进去。

```bash
nginx -t                                                  # 期望 syntax is ok / test is successful
nginx -T 2>/dev/null | grep -n 'server_name\|proxy_pass'   # 把 include 展开后的真相当面摊开
```

## location 匹配优先级：先算最长前缀，再按出现顺序查正则

官方原文（`ngx_http_core_module.html#location`，逐字，省略号为本文所加）：

> nginx first checks locations defined using the prefix strings … the location with the longest matching prefix is selected and remembered. Then regular expressions are checked, in the order of their appearance in the configuration file. The search of regular expressions terminates on the first match … If no match with a regular expression is found, … the configuration of the prefix location remembered earlier is used. If the longest matching prefix location has the "^~" modifier, then regular expressions … are not checked. … using the "=" modifier it is possible to define an exact match of URI and location. If an exact match is found, the search terminates.

本站把这段规则实现成一份算法（**是本站对规则的复现，不是 Nginx 的判定结果**），对下面配置的输出逐字贴出：

```nginx
location = /exact          { ... }
location ^~ /static/       { ... }
location /static/css/      { ... }
location /                 { ... }
location ~ \.(png|gif)$    { ... }
location ~ ^/api/          { ... }
location ~ exact$          { ... }
```

```text
/exact                → = /exact           命中精确匹配 /exact，官方规则：搜索立即终止，正则根本不查
/static/app.png       → ^~ /static/        最长前缀 /static/ 带 ^~，官方规则：不再查正则
/static/css/site.css  → 前缀 /static/css/    没有正则命中，用先前记住的最长前缀 /static/css/
/static/css/logo.png  → ~ \.(png|gif)$     按配置文件出现顺序，正则 \.(png|gif)$ 先命中（此时前缀最优本来会落到 前缀 /static/css/，被正则抢走）
/api/v1/orders        → ~ ^/api/           按配置文件出现顺序，正则 ^/api/ 先命中（此时前缀最优本来会落到 前缀 /（兜底），被正则抢走）
/index.html           → 前缀 /（兜底）           没有正则命中，用先前记住的最长前缀 /
```

第四行是最常见的事故：你以为 `/static/css/` 会接住 `logo.png`，实际被图片正则抢走，因为**正则永远赢过不带修饰符的前缀**。所以「这个目录不许正则插手」写 `^~`，「这条 URL 我要独吞」写 `=`。

## server_name 决定哪个 server 接住请求

官方给出的查找顺序（逐字）：`1. the exact name 2. the longest wildcard name starting with an asterisk … 3. the longest wildcard name ending with an asterisk … 4. the first matching regular expression (in order of appearance in the configuration file)`。

「谁都不匹配时归谁」也是官方定死的：`If none of the directives have the default_server parameter then the first server with the address:port pair will be the default server for this pair.` 后果很具体——扫描器会用各种 Host 打你的公网 IP，没写 `default_server` 时**配置里第一个 server 块**就替全站接住这些请求。官方给的对策（逐字示例）：

```nginx
server {
    listen       80  default_server;
    server_name  _;
    return       444;
}
```

`return` 的定义写清了 444：`The non-standard code 444 closes a connection without sending a response header.` 它不是状态码，是「直接断开、一个字节都不回」；官方同时说明 `_` 没有特殊含义，只是永远不会与真实域名相交的非法名字。验证（**未在本机执行**）：

```bash
curl -sI -H 'Host: random-scan.example' http://<你的IP>/ | head -1   # 期望被 444 断开：curl: (52) Empty reply from server
```

再用真实域名的 Host 打一次作对照，期望 200/301。

## 静态资源：root 与 alias 不是同一种拼法

官方对 `root` 只有一句但极其重要：`A path to a file is constructed by merely adding a URI to the value of the root directive.`；`alias` 则是 `Defines a replacement for the specified location`。本站在沙箱里造了两棵目录树，把两条规则算出的路径用 `fs.existsSync` 逐个探（**验证的是路径算术，不是 Nginx 行为**），输出逐字：

```text
location /i/，请求 URI=/i/top.gif
root   <沙箱>/w3    —— 官方：把 URI 直接加到值后面
  <沙箱>\w3\i\top.gif → 不存在 → 404
alias  <沙箱>/w3/images/ —— 官方：替换掉 location 那段
  <沙箱>\w3\images\top.gif → 文件存在，内容="REAL-under-alias"
```

**记法：`root` 是拼接，`alias` 是替换**——同一个 `location /i/`，用 `root` 就 404。`try_files` 的官方定义把两者缝起来：`Checks the existence of files in the specified order … The path to a file is constructed … according to the root and alias directives … specifying a slash at the end of a name, e.g. "$uri/". If none of the files were found, an internal redirect to the uri specified in the last parameter is made.` 最后一句是关键：末位参数是**内部跳转**，不是返回那个文件。这就是单页应用 history 路由的标准写法：

```nginx
location / {
    root /var/www/shop-dist;
    index index.html;
    try_files $uri $uri/ /index.html;   # 前两个找不到 → 内部跳到 /index.html
}
```

但同一段**绝不能套在 API 前缀上**：后端 404 时你要的是真 404，而不是被兜底成一张 `Content-Type: text/html` 的 200——那比 404 难查得多。

## 反向代理：先搞清 Nginx 默认改了哪些头

官方 `ngx_http_proxy_module.html` 原话：

> By default, the header fields "Host" and "Connection" from the original request are not passed to the proxied server. If HTTP/1.0 or HTTP/1.1 is enabled for proxying, these fields are redefined:
> proxy_set_header Host $proxy_host;
> proxy_set_header Connection close;

官方建议用 `$host` 而不是 `$http_host`（后者在客户端没带该头时什么都不传），而 `$proxy_host` 是「name and port of a proxied server as specified in the proxy_pass directive」。

本站用 Node 写了最小转发代理，让上游打印**实际收到的头**，两种配置的输出逐字（**机制验证，非 Nginx**）：

```text
-- A 代理不碰 Host（配置里什么都不写）
   状态=200 响应体="upstream-ok"
   上游收到：HTTP/1.1 url=/api/orders?page=2 Host=127.0.0.1:46011 | XFF=203.0.113.9 | XFP=(没有这个头) | Connection=keep-alive
-- B 代理显式保留原始 Host、追加 XFF、补 X-Forwarded-Proto
   状态=200 响应体="upstream-ok"
   上游收到：HTTP/1.1 url=/api/orders?page=2 Host=shop.example.com | XFF=203.0.113.9, 127.0.0.1 | XFP=https | Connection=keep-alive
```

后果很实：A 组里客户端请求的是 `shop.example.com`，上游看到 `Host=127.0.0.1:46011`——后端按 `Host` 分派多租户、或用它拼找回密码邮件里的链接，就会拿到内网地址。而 A 组的 `X-Forwarded-Proto` 根本没有：官方只提供了 `$proxy_add_x_forwarded_for`，**没有任何自动设该头的机制**。于是几乎所有产品都要写这段：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;              # 版本敏感，见下
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`proxy_http_version` 是网上教程互相矛盾之处：官方表述 `Default: proxy_http_version 1.1;` 并注明 `Since 1.29.7, version 1.1 is used by default. Before 1.29.7, version 1.0 was used by default.` 你的发行版大概率还停在 1.0。**结论：一律显式写 1.1**，两个区间里都对且无害；省略它在老版本上会同时踩到 WebSocket 与连接复用。

`proxy_pass` 末尾**带不带 URI** 决定路径怎么传，官方逐字：`If the proxy_pass directive is specified with a URI … the part of a normalized request URI matching the location is replaced by a URI specified in the directive`；`If proxy_pass is specified without a URI, the request URI is passed to the server in the same form as sent by a client`。按这段推导（**语义推导，未在本机验证**）：

| location | proxy_pass | 请求 URI | 上游收到 |
| --- | --- | --- | --- |
| `/api/` | `http://127.0.0.1:3000` | `/api/orders` | `/api/orders`（原样） |
| `/api/` | `http://127.0.0.1:3000/` | `/api/orders` | `/orders` |

所以后端路由是 `/api/orders` 却写了带 `/` 的 `proxy_pass`，上游收到 `/orders` → 404。判据：`curl` 直连后端 200、走 Nginx 404，而 access log 里有这条请求——转出去了，只是路径不对。

超时默认值决定 502/504 的分工：`proxy_connect/send/read_timeout` 都是 60s，`proxy_buffering` 默认 on。`$upstream_status` 那句最实用——`If a server cannot be selected, the variable keeps the 502 (Bad Gateway) status code.` 即 **502 = 没能和上游建立可用连接**，**504 = 连上了但 `proxy_read_timeout` 内没等到响应**；两者排查动作相反，见本章末「502 与 504」。后端生成的跳转里可能是内网地址，`proxy_redirect` 官方定义是 `rewrites the text in the "Location" and "Refresh" header fields of a proxied server response`，默认 `default` 多数时候够用。

## HTTPS：证书挂在 server 上，但发哪张由 SNI 决定

现代写法是 `listen 443 ssl;`。三处版本变更要避开：`ssl` 指令 `obsolete in version 1.15.0 and removed in version 1.25.1`，改用 `listen` 的 `ssl` 参数；HTTP/2 从 1.25.1 起用独立指令 `http2 on;`（Default off），`listen` 的 `http2` 参数已废弃；`ssl_protocols` 当前默认 `TLSv1.2 TLSv1.3`。中间证书要拼在同一文件、主证书在前；1.11.0 起 `ssl_certificate` 可写多次以同时加载 RSA 与 ECDSA。

多域名为什么总拿到第一张证书？官方（`configuring_https_servers.html`，逐字）：

> The SSL connection is established before the browser sends an HTTP request and nginx does not know the name of the requested server. Therefore, it may only offer the default server's certificate.

解法是 SNI：`allows a browser to pass a requested server name during the SSL handshake and, therefore, the server will know which certificate it should use`。

本站用 Node 的 `tls` 加 OpenSSL 现造的两张自签证书复现了这个机制（**Node 的 TLS 实现，不是 Nginx**），一个端口、四种客户端：

```text
客户端 SNI=a.example.com → 拿到的证书 CN=a.example.com
客户端 SNI=b.example.com → 拿到的证书 CN=b.example.com
客户端 SNI=nope.example.com → 拿到的证书 CN=a.example.com
客户端 SNI=null → 拿到的证书 CN=a.example.com
服务端侧记录到的握手：a.example.com / b.example.com / nope.example.com
```

判读：SNI 命中哪个 `server_name` 就发哪张；SNI 是未知名字或不带 SNI，就落到**默认 server 的证书**。线上验证不用登服务器（`s_client` 本机可用，输出字段以你机器版本为准）：

```bash
openssl s_client -connect 203.0.113.10:443 -servername shop.example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates      # 期望 CN 就是该域名；看到别的域名 → 落到默认证书
curl -sI --http2 -o /dev/null -w 'ver=%{http_version}\n' https://shop.example.com/   # 2 还是 1.1
```

80 到 443 的跳转用官方 `return`（支持对 301/302/303/307/308 给 URL）：

```nginx
server {
    listen 80;
    server_name shop.example.com;
    return 301 https://$host$request_uri;
}
```

用 `$host` 而不是 `$server_name`：后者永远是你配置里写的那个名字，多域名共用这一块会把所有域名重定向到同一个站。证书签发是真实环境操作，本章**未在本机验证**，入口是 [Certbot Instructions](https://certbot.eff.org/instructions)。三件事要知道：它会把 `ssl_certificate` 路径写进 443 那块；HTTP-01 校验需要 80 可达；续期靠定时器，**装完跑一次 `--dry-run` 并确认定时器真的在跑**，否则 90 天后静默过期。

## WebSocket：两行头加一个超时，缺了就断

官方 `http/websocket.html`：`Upgrade` 和 `Connection` 属于逐跳头，默认不传给上游，必须显式配置；WebSocket 代理自 1.3.13 起支持。它给的配置（逐字，含官方注释）——用 map 是因为把 `Connection: upgrade` 写死会让普通 HTTP 请求也带着这个头去上游：

```nginx
http {
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }
    server {
        location /chat/ {
            proxy_pass http://backend;
            # proxy_http_version 1.1; # before version 1.29.7
            proxy_set_header Upgrade    $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
        }
    }
}
```

本站用 Node 写了两条转发路径，让上游打印收到的请求行与头（**机制验证，非 Nginx**），输出逐字：

```text
-- A 逐跳头不吃掉、版本不改（等价 nginx 默认行为）
   [上游收到] GET /chat/ HTTP/1.0  Upgrade头=false  Sec-WebSocket-Key=(被代理吃掉了)
   客户端收到首行=HTTP/1.1 400 Bad Request → 握手没成立
-- B 透传 Upgrade/Connection，保持 HTTP/1.1
   [上游收到] GET /chat/ HTTP/1.1  Upgrade头=true  Sec-WebSocket-Key=有
   客户端收到首行=HTTP/1.1 101 Switching Protocols
   升级后发 21 字节裸帧 → 回收到 21 字节，逐字节一致=true（说明代理已退化成纯 TCP 管道）
```

上游看不到 `Upgrade: websocket` 就不回 101，浏览器表现为「WebSocket 连接失败」，而后端日志里**连一条握手记录都没有**。101 之后代理退化成裸字节管道，gzip、限流、`add_header` 对已升级的连接都不起作用。

官方在同一页还说明：默认 60 秒没有数据就关闭，可用 `proxy_read_timeout` 加大，或由被代理服务定期发 ping 帧保活。本站把超时压到 300ms 复现出「握手成功但空闲即断」（**数字是本机为可见性造的，不是 Nginx 默认值**）：

```text
   握手首行=HTTP/1.1 101 Switching Protocols（2ms）
   握手后 366ms 被关闭；期间空闲约 363ms
```

**优先用应用层心跳，别把 `proxy_read_timeout` 调到 1 小时**——那只是让死连接更晚被发现，半开连接却一直占着 worker 的连接额度。

## gzip：默认只压 text/html，其余要自己列

官方默认值（`ngx_http_gzip_module.html`）：`gzip` 默认 `off`；`gzip_types` 默认 `text/html`，且 `Responses with the "text/html" type are always compressed.`；`gzip_min_length` 默认 20，长度只从 `Content-Length` 判定；`gzip_proxied` 默认 off，而「是否被代理」由请求里的 `Via` 头判定。两个可执行的判断：CSS/JS/JSON **默认不压**，必须显式列 `gzip_types`；后端用 chunked 时 `gzip_min_length` 判不了。

```nginx
gzip on;
gzip_types text/css application/javascript application/json image/svg+xml;
gzip_min_length 1024;
gzip_comp_level 5;
gzip_vary on;    # 加 Vary: Accept-Encoding，否则缓存层可能把压缩内容发给不支持的客户端
```

`comp_level` 越高越费 CPU、收益递减，这是通用经验而非官方结论。官方在本页的安全警告要记住：`When using the SSL/TLS protocol, compressed responses may be subject to BREACH attacks.`——对同时含秘密值和可控内容的响应（带 CSRF token 的 HTML、会话接口）开压缩是有代价的。验证用 `curl -sI -H 'Accept-Encoding: gzip' …| grep -i content-encoding`，见本章练习。

## 访问日志：把「慢」拆成 Nginx 时间和上游时间

官方 `ngx_http_log_module.html` 里，默认的 `combined` 格式记的是 `$remote_addr`、`$time_local`、`$request`、`$status`、`$body_bytes_sent`、`$http_referer`、`$http_user_agent`。光有这些看不出「慢在哪一层」，要自己加变量。`$request_time` 是 `request processing time in seconds with a milliseconds resolution`；上游三个变量在 `ngx_http_upstream_module.html`：`$upstream_addr` 存上游地址（多次尝试逗号分隔）、`$upstream_status` 存上游状态码（选不到服务器时即 502）、`$upstream_response_time` 是 `time spent on receiving the response from the upstream server`。

```nginx
log_format perf '$remote_addr [$time_iso8601] "$request" $status '
                'rt=$request_time urt=$upstream_response_time us=$upstream_status ua=$upstream_addr';
access_log /var/log/nginx/perf.log perf;
```

`rt` 与 `urt` 的差值就是 Nginx 自己加网络花掉的时间（**下面两行是判读示例，不是实测日志**）：

```text
rt=6.500 urt=6.498 us=200 ua=127.0.0.1:3000  → 慢在后端，别查 Nginx
rt=6.500 urt=-      us=502 ua=127.0.0.1:3000 → 没连上上游；urt=- 也出现在静态命中
```

## 限流：burst 是缓冲，不是并发额度

官方 `ngx_http_limit_req_module.html` 要点（逐字，省略号为本文所加）：

> If the requests rate exceeds the rate configured for a zone, their processing is delayed such that requests are processed at a defined rate. Excessive requests are delayed until their number exceeds the maximum burst size in which case the request is terminated with an error. By default, the maximum burst size is equal to zero. … If delaying … is not desired, the parameter nodelay should be used … Default: limit_req_status 503;

`rate` 支持 r/s 与 r/m（半个每秒就写 30r/m），1m 的 zone 官方说约存一万六千个 64 字节状态。两个常被误解的点：**默认超限返回 503 而不是 429**，监控里会计成服务错误率，登录/验证码这类接口该显式 `limit_req_status 429;`。第二，不带 `nodelay` 时超额请求是**被延迟排队**的，不立刻拒绝——它拖慢 P99 却不体现在状态码上。

```nginx
limit_req_zone $binary_remote_addr zone=login:1m rate=5r/m;
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
location = /api/login { limit_req zone=login burst=3 nodelay; limit_req_status 429; }
location /api/        { limit_req zone=api burst=20 nodelay; proxy_pass http://127.0.0.1:3000; }
```

键选 `$binary_remote_addr`（定长、比 `$remote_addr` 省内存，官方例子也是它）。**但前面还有 CDN/云 LB 时 `$remote_addr` 是代理地址，全站用户会挤进同一个状态桶被一起限死**——这时键要换成经 `realip` 还原的地址，或把限流放厚、交给应用层按用户限。zone 写小了会报 no shared memory zone。以上配置**均未在本机验证**；验证要靠压测：连打 12 次同一个登录接口，期望前面若干 200/401（业务码）、之后出现 429，且 error.log 里有 limiting requests 记录。

## 常见错误与排查

**1. 改了配置毫无变化。** `-t` 通过不等于 reload 成功。动作：`nginx -t && nginx -s reload`，再用 `-T` 确认新内容真在里面；「看着没事」按官方语义说明发生了回滚。

**2. 502 与 504。** 选不到服务器时是 502，即**连接层没成功**——用 `ss -lntp` 查后端在不在监听、地址是不是 `127.0.0.1`、端口对不对；用 Unix socket 时还要查 socket 权限。504 是连上了但 60 秒内没等到响应，去查后端为什么慢，合法长请求单独放宽。502 与超时无关，调超时参数是白费。

**3. 上传报 413 且页面空白。** 官方默认 `client_max_body_size 1m;`，并提醒 `browsers cannot correctly display this error`。本站实测过这种「提前拒绝」的形状：`[服务侧] 只看到请求头，Content-Length=3072B > 限额 1024B → 直接回 413，一个 body 字节都没读`。修法是在具体 `location` 里提高上限或设 0（官方：`Setting size to 0 disables checking`），不要为一个接口放大全站。

**4. WebSocket 连不上、后端日志为空。** 缺 `Upgrade`/`Connection`，或 `proxy_http_version` 还停在 1.0。判据即本章 A 组实测：上游收到的是普通 GET，客户端拿到 400 而不是 101。

**5. 静态文件 404。** 十有八九是 `root`/`alias` 拼错（拼接 vs 替换），或 `try_files` 把 404 兜成了 200 的 HTML。判据：`curl -I` 那个 URL、看 access log 的状态、按本章那份路径算术手算一遍。

**6. 在 location 里加了一条 `add_header`，server 级的安全头全没了。** 官方规则逐字：`These directives are inherited from the previous configuration level if and only if there are no add_header directives defined on the current level.` 继承是**整层替换**、不合并；动作是在该 location 把需要的头重写全，或用 `include` 复用一段。

**7. 上线前的对照单子。** `-T` 里 `include` 是否展开成你要的几块；80 的 `default_server` 是不是 444 那块而不是业务块；`location /` 有没有误吞 `/api/`；`proxy_pass` 带不带结尾 `/`；后端拿到的 `Host` 是不是真实域名；每块 443 的证书是否各自正确（各打一次 SNI）；`/ws/` 是否真能收到 101。第 10 章接管 VPS 时这张单子会再用一次。

## 练习

<Exercise title="判断请求会落到哪个 location" difficulty="基础">

沿用本章那份配置（`= /exact`、`^~ /static/`、`/static/css/`、`/`、`~ \.(png|gif)$`、`~ ^/api/`、`~ exact$`）。先不看答案，写出这 5 个 URI 各命中哪一块、赢在哪条规则：`/exact`、`/static/js/app.js`、`/static/css/reset.css`、`/static/css/icon.png`、`/api/v1/login`。

<template #answer>

```text
/exact                → = /exact          精确匹配即终止，后面的 ~ exact$ 没机会
/static/js/app.js     → ^~ /static/       最长前缀且带 ^~ → 不查正则
/static/css/reset.css → 前缀 /static/css/  被记住但不带 ^~；两条正则都不命中 → 落回它
/static/css/icon.png  → ~ \.(png|gif)$    正则赢过不带修饰符的前缀（最易误判的一条）
/api/v1/login         → ~ ^/api/          前缀最优本来是兜底的 /，被正则抢走
```

`/static/css/icon.png` 想留在 `/static/css/`，就把那个块改成 `^~ /static/css/`。若你的结果与上面不符，先检查正则 location 的**书写顺序**——「按出现顺序，第一个命中即停」，顺序本身就是语义的一部分。

</template>

</Exercise>

<Exercise title="把后端看到的身份补齐" difficulty="进阶">

你的 Fastify 后端要靠 `Host` 区分多个品牌域名，要在找回密码邮件里生成绝对链接，日志里还要有真实客户端 IP。写出 `location /api/` 的配置，并回答：不写 `proxy_set_header Host $host;` 会怎样；`X-Forwarded-Proto` 该设成什么；后端该取 `X-Forwarded-For` 的第一个还是最后一个地址、为什么。

<template #answer>

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;      # 不写结尾 /，URI 原样传
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

不写 Host 时官方默认是 `Host $proxy_host;`，而 `$proxy_host` 就是 `proxy_pass` 里写的上游名字和端口，后端于是永远看到 `127.0.0.1:3000`——多租户分派失效、生成的链接变成内网地址（本章 P1 的 A 组输出的正是这一类形态）。`X-Forwarded-Proto` 设 `$scheme`：TLS 在 Nginx 终结，后端听到的永远是 http，不补这个头 `req.secure` 为假，绝对链接生成成 `http://`，浏览器在 https 页面里加载 http 资源会被直接拦；官方没有任何自动设该头的机制。

XFF 取第一个：官方定义是「客户端带来的 XFF + `$remote_addr`」，链条是「声称的原始客户端 … 上一跳 本跳」，第一个是起点、最后一个才是你直接对上的一跳。**但第一个可被伪造**，所以只有确知前面只有一层你自己的代理时才该信任它，否则用 `$remote_addr`；前面还有 CDN 时需要 `realip` 模块显式声明信任哪些来源地址，那部分本章未验证。

</template>

</Exercise>

<Exercise title="不看配置远程定位 HTTPS 故障" difficulty="挑战">

不许登录服务器、不许看配置，只用 `curl` 和 `openssl` 打真实节点。写出你判断这 5 件事的命令与预期：① 该 IP 对某域名下发的证书是不是它自己的；② 80 是否正确跳转；③ 是否协商到 HTTP/2；④ 静态 JS 是否被压缩；⑤ 后端拿到的 Host 对不对（只能间接判断，说明你的推理链）。

<template #answer>

```bash
IP=203.0.113.10; HOST=shop.example.com
openssl s_client -connect $IP:443 -servername $HOST </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
curl -sI http://$HOST/ | sed -n '1p;/^[Ll]ocation/p;/^[Ss]erver/p'
curl -sI --http2 -o /dev/null -w 'ver=%{http_version}\n' https://$HOST/
curl -sI -H 'Accept-Encoding: gzip' https://$HOST/app.js | grep -iE 'content-encoding|content-length|vary'
```

① `subject` 的 CN 必须是 `$HOST`；看到别的域名 → 这块 server 没拿到自己的证书，落到了默认 server（本章 SNI 实测的第 3、4 行就是这个现象），顺带看 `notAfter` 是否快到期。② 期望 `301` 且 `Location` 指向 https 的同域名；出现 `127.0.0.1:3000` → 后端自己生成跳转却没收到正确的 `Host`/`X-Forwarded-Proto`；直接 200 出页面 → 80 上没配跳转。③ `ver=2` 才说明 `http2 on;` 生效。④ 期望 `content-encoding: gzip` 且 `content-length` 明显变小；只有 `vary` 没有 `content-encoding` → `gzip_types` 没列 `application/javascript`。

⑤ 只能推理：让接口暴露自己看到的绝对 URL（`curl -s https://$HOST/api/self | jq .url`），返回 `http://127.0.0.1:3000/...` 说明 `Host` 被重定义成了 `$proxy_host`。但两者都无法区分「Nginx 没设头」与「后端没读头」，最后必须登服务器用 `nginx -T` 加一次 `curl -H 'Host: …' http://127.0.0.1:3000/` 才能定论——别把推测当结论。这些命令在本机 curl 8.17.0 / openssl 3.5.4 可执行，但需要一个真实可达的 HTTPS 站点；**本章未针对任何线上站点跑通这五条**，预期输出按官方语义给出。

</template>

</Exercise>

## 官方文档与延伸阅读

以下页面均在 2026 年 10 月由本章实际抓取并逐字引用过原文或默认值：

- [Beginner's Guide](https://nginx.org/en/docs/beginners_guide.html)、[Command-line Parameters](https://nginx.org/en/docs/switches.html) —— 上下文嵌套、`-t`/`-T`/`-s`。
- [ngx_http_core_module](https://nginx.org/en/docs/http/ngx_http_core_module.html#location) —— location 优先级；同页含 `root`/`alias`、`try_files`、`client_max_body_size`、`server_name`、`listen`。
- [ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) —— Host/Connection 默认重定义、`proxy_http_version` 版本分界、`proxy_pass` 带不带 URI、各超时默认值。
- [WebSocket Proxy Support](https://nginx.org/en/docs/http/websocket.html) 与 [RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455) —— 逐跳头不传、60 秒空闲关闭。
- [ngx_http_ssl_module](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)、[Configuring HTTPS servers](https://nginx.org/en/docs/http/configuring_https_servers.html)、[ngx_http_v2_module](https://nginx.org/en/docs/http/ngx_http_v2_module.html)、[Certbot Instructions](https://certbot.eff.org/instructions)。
- [gzip](https://nginx.org/en/docs/http/ngx_http_gzip_module.html)、[add_header](https://nginx.org/en/docs/http/ngx_http_headers_module.html)、[limit_req](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)、[log](https://nginx.org/en/docs/http/ngx_http_log_module.html)、[upstream](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)。

## 下一章

Nginx 把端口和分派理顺后，剩下的问题是「谁能动这台机器」。[服务器安全](/linux/server-security) 从 SSH 加固开始，讲 fail2ban 为什么要挂在真实登录日志上、专用用户跑服务怎么和第 2 章的权限模型接起来，以及被入侵后按什么顺序看痕迹。
