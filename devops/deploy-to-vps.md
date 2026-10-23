# 上线是四层链路的逐层验证：解析、放行、监听、证书，每一层都换一个报错

本地跑通的 `docker compose up -d` 到「别人能用域名打开你的产品」之间，隔着四层互相独立的东西：**解析对不对、端口通不通、容器在不在监听、证书对不对得上域名**。它们的失败长相完全不同，所以排查不是「打不开就瞎改」，而是**从上往下问：这一层的判据满足了吗**。本章按这条链走：SSH 进服务器 → 服务器准备 → compose 生产形态 → Nginx 反代 → 签发并自动续期 HTTPS → 验证与日志 → 固化成一条命令的部署脚本。顺序不能倒：**先手动成功一次再谈自动化**，否则出问题你分不清是流水线坏了还是部署本身坏了。

<Callout type="verified" title="本章实测环境">

Windows 10 + Git Bash + Node.js `v25.4.0`，核实时间 2026-10-20。本机没有 VPS、没有 Docker、没有远端 SSH 目标，也**没有购买或连接任何服务器**。实测的是这条链路上与服务器无关的机制：`openssl` 自签三张证书 + Node 起 TLS/HTTP 服务端，复现解析失败、证书三类报错、按 SNI 选站、明文打 TLS 端口、80 端口跳转写法吞掉 ACME 校验文件、SSH 连接失败的几种形态、`bash -n` 与 `set -euo pipefail` 的真实拦截面。全程只绑 `127.0.0.1`，端口由系统分配，临时文件用完即删（证据文件末尾有清理核实）。逐字输出在 `devops/.scratch/vps10-output.txt`。

</Callout>

<Callout type="unverified" title="本章所有服务器端命令都没有执行过">

`apt`、`ufw`、`docker`、`nginx -t`、`certbot` 在本机 `command -v` 全部找不到，也没有安装任何东西。所以正文里每条服务器命令、每份 Nginx 配置与 `deploy.sh`，**都是按官方文档语义写成、供你照着执行的步骤，不是本章跑过的结果**。「站点是否真的上线」「证书是否真的续上」只能在你的服务器上确认。带行号的实测数据来自上面那份证据文件，其余一律标了出处或未实测。

</Callout>

## 先选形态：为什么本站主线是 VPS + Docker + Nginx

| 形态 | 你要管什么 | 适合 | 代价 |
| --- | --- | --- | --- |
| 静态托管 + 托管数据库（Vercel/Netlify + Neon 一类） | 只管代码 | 纯前端、原型起步 | 后端逻辑、长连接、定时任务容易撞平台边界 |
| PaaS（Render/Fly/Railway 一类） | 管代码与配置 | 想快点上线、不想碰机器 | 平台条款变了就得迁；调试受限于它的日志与构建规则 |
| **VPS + Docker + Nginx（本章主线）** | 管机器、进程、证书、备份 | 要完整控制权，要接数据库/WebSocket/worker | 一切故障归你，本章四层链路都得自己会查 |
| 托管 K8s / Serverless | 管编排与冷启动 | 多服务、流量起伏大 | 第一期用不上，复杂度会吃掉开发时间 |

官方对 Compose 上线的定位就是第三种的最小版本：「The easiest way to deploy an application is to run it on a single server, similar to how you would run your development environment」。所以本章不需要 Kubernetes，一台 2 vCPU / 2 GB 的 VPS 加 Docker 就够把第一版产品跑起来。

## 四层链路总表：每层的判据与失败长相

| 层 | 判据（怎么算通过） | 失败时你看到什么 |
| --- | --- | --- |
| ① 解析 | 域名查到目标 IP | `curl: (6) Could not resolve host`（实测 exit=6）；Node 侧 `getaddrinfo ENOTFOUND` |
| ② 放行 | TCP 端口能连上 | `Connection refused`（实测 exit=255）＝没人监听；卡到超时＝包被 DROP |
| ③ 监听 | 容器在听、且路径可达 | 连上但对端不是你要的服务：`Connection closed by`、`Empty reply`（实测两类都出现过） |
| ④ 证书 | 证书受信 + 域名匹配 + 没过期 | `DEPTH_ZERO_SELF_SIGNED_CERT`（Node）/`SEC_E_UNTRUSTED_ROOT`（本机 curl）/`Hostname ... not in the cert's altnames`，三种都实测复现 |

本章后面每一节只做一件事：给判据、给通过时的输出长相、给最常见的失败原因。

## 第 0 步：SSH 进得去，且只进得去你自己

**买之前先确认三件事**：能否重装系统（换发行版不花钱）、公网 IPv4 是否固定（有些按带宽计费的实例重启就换 IP）、云防火墙/安全组在哪一层配置——多数厂商在控制台，它和服务器里的 `ufw` 是两道门。

生成密钥（这一步**在本机可做，本章实测过命令本身**）：

```bash
ssh-keygen -t ed25519 -C "deploy@本机"     # 一路回车；passphrase 建议设
ssh-keygen -l -f ~/.ssh/id_ed25519.pub     # 回读指纹
```

实测输出：`ssh-keygen` 退出码 0，公钥是三段的（算法 / base64 正文 / 注释），指纹回读形如 `256 SHA256:…（ED25519）`。**指纹必须能回读**——登进服务器后就是拿它核对 `~/.ssh/authorized_keys` 里那行是不是同一把。

首次连接：

```bash
ssh -p 22 deploy@<你的服务器公网IP>
```

第一次会问你确认主机指纹。**这一层本章测不到**（没有可连的远端，也没有 sshd），只讲判据：确认后指纹写入 `~/.ssh/known_hosts`；以后同一主机指纹变了导致连接被拒，是机器被重装或换了密钥，不是 bug，别习惯性用 `-o StrictHostKeyChecking=no` 绕过。

连不上时按实测到的三种形态分诊（都在本机 `127.0.0.1` 上复现，报错原文与远端一致）：

```text
① 没有任何进程监听这个端口
   ssh: connect to host 127.0.0.1 port 14684: Connection refused      exit=255
②③ 端口通，但对端不是 sshd（指到了 80/443 上）
   Connection closed by 127.0.0.1 port 14686                            exit=255
④ TCP 连上、对端一个字都不回（防火墙 DROP / 服务卡死）
   Connection timed out during banner exchange                          耗时 4089ms
```

于是：**`Connection refused`＝机器活着但那个端口没人听**（sshd 没起、端口填错、只绑了 `127.0.0.1`）；**一直卡到超时＝包没回来**（云安全组没放行、IP 记错、路由不通）；**立刻 `Connection closed`＝端口是通的，但你连的是别的服务**。

进去后的最小准备（Linux 第 1～6 章在这里汇合，不重讲原理）：建非 root 的 `deploy` 用户、公钥贴进 `~/.ssh/authorized_keys`、装 Docker 引擎与 Compose 插件、`ufw` 只放 `22`/`80`/`443`、系统时间交给 NTP（**时间不对，证书校验会整批失败**）。做完再往下，否则后面每一步都在猜。

## 第 1 层：域名解析——先证明「查得到」，再证明「查到的是这台机」

前置条件：域名已在注册商处解析到 VPS 的公网 IP（`A` 记录填主机名为 `@` 或 `app`，值为 IPv4；要 `www` 就再加一条），云防火墙允许 80/443 入站。

判据与实测到的报错长相：

```bash
nslookup app.example.com        # 期望：Address 就是你 VPS 的公网 IP
curl -I http://app.example.com  # 解析失败时：curl: (6) Could not resolve host（实测 exit=6）
```

本机实测：`example.invalid` 与随机不存在的名字都返回 `getaddrinfo ENOTFOUND`，`curl` 侧对应 `curl: (6)`；有记录的名字一次解析耗时 11ms，返回 IPv6 与 IPv4 各两条。**`ENOTFOUND` 只说明「查不到」，不区分「没加记录」「拼错」「TTL 没过期所以老 IP 还在」**——所以加完记录要拿 `nslookup` 看具体 IP，而不是「能打开就行」。

本章**测不到**：指定上游 DNS 复核、查 TTL、查 NS 委派——本机 `dns.resolve*` 一律 `ECONNREFUSED`（出站 53 被拦），只有系统解析器可用。你自己在电脑上可以：`dig +trace` 看委派链、`dig @1.1.1.1` 换一台解析器复核。

**没有 DNS 也能提前验证站点**——这是本章最有用的一个实测结论。`curl --resolve` 让「域名 → IP」只活在这一条命令里，不改 hosts、不需要解析生效：

```bash
curl --resolve app.example.com:443:<服务器IP> -I https://app.example.com/
```

实测里 `--resolve` + `--cacert` 直接拿到 200，服务端回显 `handshake ok, server saw SNI=app.example.test`——**证明这个名字在服务器这一侧被正确认领了**。所以上线顺序可以反过来：先用 `--resolve` 确认站点能按域名应答，再改 DNS。

## 第 2 层：把 compose.yaml 变成生产形态

上一章那份文件不能直接搬上服务器。官方列的生产改动清单里最要紧的三条逐字是：「Removing any volume bindings for application code」「Specifying a restart policy like `restart: always` to avoid downtime」「Adding extra services such as a log aggregator」，此外还要改宿主绑定端口与环境变量。**用 overlay 表达差异，不改主文件**：

```yaml
# compose.production.yaml —— 只写差异，叠加在 compose.yaml 之上
services:
  app:
    image: registry.example.com/myblog/app:${IMAGE_TAG:?部署必须指定镜像 tag}
    build: !reset null          # 生产不构建，用推好的镜像
    ports: []                   # 只有 Nginx 需要对公网，应用不直接暴露
    restart: always
  db:
    restart: always
    # 代码卷绑定在这里被移除；命名卷留在 compose.yaml 里
```

```bash
docker compose -f compose.yaml -f compose.production.yaml config    # 先看合成结果
docker compose -f compose.yaml -f compose.production.yaml up -d
```

`config` 的合成输出**必须看一遍**：变量注入对不对、端口有没有意外绑到 `0.0.0.0`（上一章讲过：不写 host IP 就是 `0.0.0.0`，绕过宿主防火墙）。

镜像来源三条：本机 `build` 后 `push`、服务器直接 `build`、CI 构建推送（第 5 章）。**第一次上线建议在服务器 `build`**——此时你要看清每个失败发生在哪一层，而不是被「流水线红了」这种聚合信号挡住。

重部署单个服务的官方姿势是两条命令：`docker compose build web` 然后 `docker compose up --no-deps -d web`，官方解释「The --no-deps flag prevents Compose from also recreating any services that web depends on」——**少了 `--no-deps`，数据库会跟着被重建**，你以为只是发个前端，实际把库的连接全断了。

判据：`docker compose ps` 里是 `Up (healthy)`（前提是上一章写了 `healthcheck`）；`docker compose logs --tail=50 app` 最后一行是你的「listening on :3000」；在**服务器本机**直连 `curl -I http://127.0.0.1:3000` 应拿到 200。最后这条是关键分诊：本机 200 而公网不通 → 问题在 ②③ 层；本机都不通 → 问题在容器里。

## 第 3 层：Nginx 反代容器——四个 header 少一个就少一类信息

Linux 第 7 章讲 `server_name` 时留了尾巴，本章实测补上：同一个 443 端口挂三张证书（app / api / legacy），客户端按 SNI 给出不同名字时，服务端回的是：

```text
SNI=app.example.test     → CN=app.example.test     SAN=DNS:app.example.test
SNI=api.example.test     → CN=api.example.test     SAN=DNS:api.example.test
SNI=nobody.example.test  → CN=app.example.test     ← 没挂这个域名的站点，落到默认那张
不带 SNI 连接            → CN=app.example.test     （Nginx 里对应 default_server / 第一个 server 块）
```

拿对应证书当信任锚做真校验：`SNI=api` 通过；`SNI=legacy`（CN 是 legacy，SAN 只有 `old.example.test`）报 `ERR_TLS_CERT_ALTNAME_INVALID`；`SNI=nobody` 同一个错。**新域名证书报「域名不匹配」，往往不是证书坏了，是 server 块没配上、请求落到了默认站**；`CN` 里有名字不算数，校验只看 SAN（`server_name` 的匹配顺序见 [Linux 第 7 章 Nginx](/linux/nginx)）。

配置骨架（`nginx -t` 未在本机执行，语义按官方文档）：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name app.example.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    server_name app.example.com;
    ssl_certificate     /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

`ssl_certificate` 的官方语法是 `ssl_certificate file;`（Context: http, server），要的是 **`fullchain.pem` 而不是单独的证书**——少了中间证书，一部分客户端报链不完整、另一部分照常打开，这是最难查的「只有我同事打不开」。

四个 header 不是惯例，是官方默认行为的反面：`proxy_set_header` 默认值是 `Host $proxy_host;` 和 `Connection close;`，且「By default, the header fields "Host" and "Connection" from the original request are not passed to the proxied server」；官方还写明这些指令**只有在当前层级没有任何 `proxy_set_header` 时才从上层继承**——所以 `location` 里写了一条，`server` 层其余的就失效，必须在同一层写全。应用拿不到访客真实 IP、拿不到 `http`/`https` scheme，根因都在这里。配置里的 `map $http_upgrade` 与 `Upgrade`/`Connection` 两行是 WebSocket 所需，写法细节见 [Linux 第 7 章 Nginx](/linux/nginx)。

改完配置的验证顺序（命令未执行，语义按官方「Controlling nginx」）：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

官方对 HUP（reload）的描述：主进程先检查语法、再尝试应用新配置（打开日志与新监听套接字），**失败就回滚、继续用旧配置工作**。两个推论：reload 不中断在线用户；但**「没报错」不等于生效了**——判据是 `nginx -t` 的 `syntax is ok / test is successful` 两行，加上重载后真发一个请求看行为变没变。

## 第 4 层：HTTPS 证书——90 天、三种验证、以及自己把自己限流的坑

Let's Encrypt 的三种验证方式，官方要点：

| 方式 | 怎么证明域名归你 | 硬约束 | 什么时候用 |
| --- | --- | --- | --- |
| HTTP-01 | 在 `http://<域名>/.well-known/acme-challenge/<TOKEN>` 放文件让它取 | 「can only be done on port 80」；不能签通配符；多机每台都要能取到；ISP 封 80 就不可用 | 本章默认，80 必须开放 |
| DNS-01 | 在 `_acme-challenge.<域名>` 放指定值的 `TXT` | 「harder to configure than HTTP-01」；能签通配符；DNS 没有可用 API 就不必用它 | 要 `*.example.com`、或 80 不能开 |
| TLS-ALPN-01 | 在 443 做基于主机的校验 | 「It works if port 80 is unavailable to you」；不能验证通配域 | 80 被占死又不能放行时 |

HTTP-01 对跳转的处理也写死了：跟随最多 10 次跳转，只接受 `http:`/`https:` 且端口 80/443，跳到 https 时**不校验证书**。**但它比的是响应体，不是状态码**——本章测了两种常见写法：

```text
写法一（所有请求一律 301 到 https）
  /.well-known/acme-challenge/<TOKEN> → 301 ; Location: https://… ; 200
  客户端最终拿到的响应体 = "SNI=app.example.test"      ← 拿到的不是那个文件
写法二（先放行 /.well-known，其余才 301）
  /.well-known/acme-challenge/<TOKEN> → 200
  客户端最终拿到的响应体 = "keyAuthorization.example-value"   ← 对上了
```

**这就是「配了全站强制跳转之后证书签不下来」的机制**：状态码一路 200，内容却是你的应用首页。所以第 3 层那份配置把 `location /.well-known/acme-challenge/` 写在 `return 301` 之前。

签发与续期（certbot 文档逐字，命令本章未执行）：

```bash
sudo certbot --nginx -d app.example.com -d www.example.com
sudo certbot certificates                    # 看有效期与路径
sudo certbot renew --dry-run                 # 用 staging 演练，不产出真证书
```

插件边界（官方逐字）：`--nginx`「should work for most configurations」，建议先备份，且**可用 `certbot --nginx rollback` 回退它改过的配置**；`--standalone` 要自己绑 80（「you may need to stop your existing webserver」），**Nginx 在跑就别用它**；`--webroot` 要求允许从隐藏目录取文件。它生成的 access log 行长这样（官方样例，含 UA）：

```text
"GET /.well-known/acme-challenge/HGr8U1IeTW4k… HTTP/1.1" 200 87 … "Mozilla/5.0 (compatible; Let's Encrypt validation server; +https://www.letsencrypt.org)"
```

**这条 UA 是排错时最硬的证据**：`grep 'acme-challenge' /var/log/nginx/access.log` 有这行且 200 → CA 真来过也取到了；一行都没有 → 它进不来（80 没放行、域名没解析到这台、被 CDN 挡了）。官方对验证失败成因的原文就是「usually stem from network or firewall configurations that prevent Let's Encrypt validation servers from reaching your server」。

**有效期与续期**：默认 90 天；因为「Industry rules will limit certificate lifetimes to a maximum of 47 days starting on March 15, 2029」，2028 年 2 月前最长有效期会降到 45 天。**到期邮件提醒已关停**，判据只能是续期任务真的跑过。`certbot renew` 只处理临近到期的：4.0.0 起阈值是**剩余寿命少于 1/3**（寿命 ≤10 天的是 1/2）；`--force-renewal` 天天跑「will quickly run into the certificate authority rate limit」。确认有没有定时器，没有就加官方这条（随机 sleep 是别让所有人的 0 点同时打爆 CA）：

```bash
systemctl list-timers | grep -i certbot        # 有 → 发行版打包时就带了
grep -r certbot /etc/crontab /etc/cron.*/*     # 或在这里
SLEEPTIME=$(awk 'BEGIN{srand(); print int(rand()*(3600+1))}'); echo "0 0,12 * * * root sleep $SLEEPTIME && certbot renew -q" | sudo tee -a /etc/crontab > /dev/null
```

最后是**限流**（官方页面标注更新于 2026-08-05）：每注册域 7 天 50 张；**同一组完全相同的标识符 7 天 5 张**，补充 1 张/34 小时，且「We do not offer overrides for this limit」，而官方点名的成因正是新手排错动作本身（见练习 2）。**后果是一周签不出证书且申请不到豁免**，所以 `/etc/letsencrypt` 与账号目录属于服务器状态，不能跟着部署流程删。豁免要分清：重复提交**完全相同的标识符组**算 renewal，免掉「300 orders/账号」与「50 张/注册域」，**但不免 5 张/组**；只有 ARI（ACME Renewal Info）协调的续期才全部豁免。测试一律 `--dry-run`（默认打 staging，限额高得多；显式给了 `--server` 时官方警告可能「causes real certificates to be issued and discarded」）。授权失败也限：每标识符每小时 5 次，连续失败到阈值会暂停签发，需去自助门户解除。

判据（命令与输出形态本章实测过，真机上格式一致）：

```bash
openssl s_client -connect <服务器IP>:443 -servername app.example.com </dev/null | sed -n '1,12p'
```

实测换 `-servername` 的值，输出的 `0 s:CN=` 就跟着换——**先确认这台机器在该域名下出示的是哪张证书，再谈它对不对**。

## 上线验证清单：从下往上打一遍

```bash
nslookup app.example.com                                  # ① 解析 = 你的 IP
curl -I http://app.example.com                            # ② 80 通 + 期望 301
curl -I --resolve app.example.com:443:<IP> https://app.example.com/   # ②③ 443 通 + 站点认领
curl -s https://app.example.com/healthz | head -c 200     # ③④ 内容来自应用，不是 Nginx 默认页
grep 'acme-challenge' /var/log/nginx/access.log | tail -3 # ④ CA 来过
docker compose ps                                         # ③ 全部 Up (healthy)
docker compose logs --since 10m app | tail -30            # ③ 无重启循环
```

关键在第 4 行：**首页 200 不代表应用活着**（Nginx 默认页、静态兜底 `index.html` 都会回 200），所以要 `/healthz` 这种只有应用会答的路径，并确认响应里有当前版本号。

## 部署脚本化：把成功判据写进脚本，而不是写进记忆

`deploy.sh` 放在仓库里，作用是「下次上线不用回忆」。它依赖的 shell 语义本章实测过（bash 5.2.37，逐字输出另见 `devops/.scratch/vps10b-deploy-sh.txt`）：`set -euo pipefail`、`${VAR:?}`、以及 `bash -n` ——后者只查语法不执行任何动作（语法错时 exit=2 并报「unexpected EOF …」），发布前先跑它。

```bash
#!/usr/bin/env bash
set -euo pipefail                          # 实测：不加 -e 时失败行后面照跑（exit=0）
trap 'echo "失败发生在第 ${LINENO} 行附近，看上面最后一条命令"' ERR
IMAGE_TAG="${1:?用法: ./deploy.sh <镜像 tag>}"   # 实测：不给参数就停下，报错带文件名与行号
HOST="${DEPLOY_HOST:?必须在环境里给出部署主机}"

ssh -o BatchMode=yes "deploy@${HOST}" bash -s -- "${IMAGE_TAG}" <<'EOF'
set -euo pipefail
cd /srv/myblog
export IMAGE_TAG="${1:?远端没收到镜像 tag}"   # 三条 compose 都要读它做插值
docker compose -f compose.yaml -f compose.production.yaml config >/dev/null
docker compose -f compose.yaml -f compose.production.yaml up -d
docker compose -f compose.yaml -f compose.production.yaml ps
EOF

curl -sf https://app.example.com/healthz >/dev/null     # 自己不收 2xx 就失败
```

三条实测结论直接决定脚本可不可信：`VAR=$(失败命令)` 会让脚本退出（实测 exit=2），想继续跑就得写 `VAR=$(...) || { 兜底; }`；`if` 条件里的失败不触发退出；**只写 `set -e` 拦不住管道左侧失败**——`false | true` 在只有 `set -e` 时 exit=0 并把后面那行执行了，加上 `pipefail` 才 exit=1。这就是「`docker compose logs | grep` 没匹配到却当成功」的由来。脚本里 `ssh`、`docker compose`、`curl` 那几段本章只用替代脚本验证过传参，真命令没执行过，它只在你服务器上跑通之后才算存在。

## 常见错误与排查

- **证书报 `Hostname ... is not in the cert's altnames`**：本章复现出三条路径——名字不在 SAN 里、用 IP 直连 HTTPS（实测 `IP: 127.0.0.1 is not in the cert's list`）、**没配这个域名的 server 块所以落到默认证书**。第三条最阴，因为证书本身完全合法。先用 `openssl s_client -servername` 确认出示的是哪张。SSH 连不上的分诊（`refused` vs 卡到超时）见第 0 步那三句。
- **证书验证一直失败，而浏览器访问正常**：`/.well-known` 被 301 吞了（实测响应体变成应用回显），或 80 没放行。判据见第 4 层那条带 LE UA 的 access log。域名压根查不到（`curl: (6)`）是第 1 层没过，这一层没过时后面任何 5xx 都不必去看。
- **前端能打开、接口全 502**：宿主机 Nginx 解析不到 `app:3000`（容器服务名只在 Compose 网络里有效），或应用绑的地址不对。分诊顺序：服务器本机 `curl 127.0.0.1:3000` → `docker compose ps` → Nginx error log。签了几次之后被限流、一周签不出，那是另一回事，见第 4 层末节。

## 练习

<Exercise title="用 curl --resolve 在改 DNS 之前验证站点" difficulty="进阶">

假设应用已部署到 VPS、Nginx 站点也配好了，但 DNS 记录还没改（或你不想等 TTL）。给出一条命令，在不改 hosts、不加解析记录的前提下，证明「这台服务器会在 `app.example.com` 这个名字下正确应答」，并说明你要从输出里读到哪两个信息、读不到时分别对应哪一层。

<template #answer>

```bash
curl -v --resolve app.example.com:443:<服务器公网IP> https://app.example.com/ 2>&1 | head -40
```

两个必看点：① `* Connected to app.example.com (<IP>) port 443` → **②放行层**通过，443 有东西在听；② 握手段的 `SSL certificate verify ok` 与服务端出示证书的 CN/SAN 是否为 `app.example.com` → **④证书层 + 选站**对不对。

按层分诊：`Trying <IP>...` 之后超时 → 安全组没放行；立刻 `Connection refused` → 端口没人监听（Nginx 没起或绑了别的地址）；`Connected` 之后握手失败且 CN 是另一个域名 → `server_name` 没匹配上、落到默认站（实测的 `SNI=nobody → CN=app` 就是这个形态）；握手过但 502 → ③监听层，去 `docker compose ps` 与应用日志。

本章实测的是这条命令的机制（`--resolve` + 正确信任锚拿到 200），**没在真实服务器上跑过**。真机证书由 CA 签发、不需要 `--cacert`；若报 `unable to get local issuer certificate`，是链不完整（用了 `cert.pem` 而非 `fullchain.pem`）。

</template>

</Exercise>

<Exercise title="判断这次签证书会不会把自己限流" difficulty="基础">

你在排查签发失败时依次做了这些事：重装 certbot 两次、删掉 `/etc/letsencrypt` 后重签、又手工跑三次 `certbot --nginx -d app.example.com -d www.example.com`（两次成功、一次失败）。回答：(1) 哪些动作各消耗了哪条额度？(2) 哪条额度官方明确不给豁免？(3) 接下来两小时最该改的一个动作是什么？

<template #answer>

(1) 三次成功签发烧的是**「同一组完全相同标识符 5 张/7 天」**：`[app.example.com, www.example.com]` 这组已打出三次，补充只有 1 张/34 小时。它们同属注册域 `example.com`，但官方在「Limit Exemptions for Renewals」写明：重复提交完全相同的标识符组算 renewal，**免掉「300 orders/账号」与「50 张/注册域」，却仍受「5 张/组」和「每标识符授权失败」约束**（只有 ARI 协调的续期全免）。删 `/etc/letsencrypt` 不重置任何额度——两条都写着「regardless of which account submits them」。失败那次占「每标识符每小时 5 次授权失败」（补充 1/12 分钟）。官方点名的打爆成因正是「为排错反复重装客户端」与「每次部署删 ACME 配置」，你这串正是它。

(2) **5 张/组/7 天**，官方原文「We do not offer overrides for this limit」；每标识符授权失败那条同样不给豁免。34 小时才恢复 1 张，等不起也没用。

(3) 最该改的一个动作：所有测试挪到 staging——`certbot --nginx --dry-run …`（官方说明 `--dry-run` 用的就是 staging，除非你显式传 `--server`）。staging 限额高得多，照样能验证「Nginx 放行、webroot 路径、域名认领」，只是证书不被浏览器信任。已签出的那几张留着别删，`/etc/letsencrypt` 从现在起当服务器状态对待。

</template>

</Exercise>

<Exercise title="给上线写一份能被证伪的验证清单" difficulty="挑战">

写出你自己的「推上去 60 秒内确认这次上线成功」清单（不超过 8 条命令），每条指明**期望输出**与**失败对应四层里的哪一层**。再设计一个证伪实验：故意让其中一条判据失效，验证你的清单真的会红。

<template #answer>

照抄本章「上线验证清单」那 7 条命令，逐条补上期望输出与失败归属，再补一条 `date -u`。几个容易写错的判据：

1. `nslookup app.example.com` → 那台机器的 IP；返回旧 IP = ①解析（TTL 未过期）
2. `curl -sS https://app.example.com/healthz` → 含当前 `IMAGE_TAG` 的响应体；`502` = ③监听；证书错 = ④
3. `openssl s_client -connect <IP>:443 -servername app.example.com </dev/null | sed -n '1,12p'` → `0 s:CN=app.example.com` 且未过期；别的 CN = ④选站
4. `docker compose ps` → 全 `Up (healthy)`；`Restarting` = ③起了又崩，接着看 `docker compose logs --since 5m app | tail -30`
5. `grep 'acme-challenge' /var/log/nginx/access.log | tail -3` → 续期窗口内有带 LE UA 的 200；没有 = ②/④
6. `date -u` → 与部署时间对得上；时间漂移 = ④整批校验失败

证伪实验才是重点：**故意让第 2 条失败，看清单是不是只红那一条**。做法：`docker compose stop app`（保留 Nginx）。期望第 1、3 条照旧通过——解析与证书都不依赖应用活着；第 2 条变 `502`、第 4 条 `Exit`。若第 1 条也一起红，说明你写的是「网站打不开」而不是「哪一层断了」，判据没分离干净，回去拆。反向同理：给 app 多绑一个宿主端口，`ss -lntp` 该多一行而清单都不该变红——**不相关的判据不该被牵动**。这几步本章没替你跑，因为需要一台真服务器。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Docker Compose 用于生产](https://docs.docker.com/compose/how-tos/production/) —— 「单服务器最简单」的定位、生产改动清单、overlay 叠加命令、`up --no-deps -d` 语义。
- [`docker compose up`](https://docs.docker.com/reference/cli/docker/compose/up/) 与 [`config`](https://docs.docker.com/reference/cli/docker/compose/config/) —— `-d`、`--no-deps`、合成后配置检查。
- [Controlling nginx](https://nginx.org/en/docs/control.html) —— HUP reload「先查语法、失败即回滚」。
- [ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) —— `proxy_set_header` 的默认值与继承条件、`$host`/`$http_host` 取舍。
- [ngx_http_ssl_module](https://nginx.org/en/docs/http/ngx_http_ssl_module.html) 与 [服务名匹配](https://nginx.org/en/docs/http/server_names.html) —— `ssl_certificate file;` 语法、匹配顺序与未命中落到默认 server。
- [Let's Encrypt 验证方式](https://letsencrypt.org/docs/challenge-types/) —— HTTP-01 只能 80、最多跟随 10 次跳转、不能签通配符；DNS-01 需要 DNS API；TLS-ALPN-01 用于 80 不可用。
- [证书有效期](https://letsencrypt.org/docs/cert-lifetimes/) —— 90 天默认、2028 年 2 月前降到 45 天、2029-03-15 起上限 47 天、到期邮件提醒已关停。
- [限流](https://letsencrypt.org/docs/rate-limits/)（标注更新于 2026-08-05）—— 50 张/注册域、5 张/相同标识符组且不给豁免、每标识符每小时 5 次授权失败、renewal 的分层豁免。
- [Certbot 用户手册](https://eff-certbot.readthedocs.io/en/stable/using.html) —— 三种插件边界、`--nginx rollback`、4.0.0 的 1/3 阈值、`--dry-run` 用 staging、`list-timers` 与 cron 兜底那行。
- [上一章：Docker Compose、卷与网络](/devops/docker-compose) —— 本章复用它那份 `compose.yaml`。
- [Linux 第 5 章 网络诊断与防火墙](/linux/networking)、[第 7 章 Nginx](/linux/nginx)、[第 8 章 服务器安全](/linux/server-security)、[第 9 章 日志与故障定位](/linux/logs-and-troubleshooting) —— `ss`/`ufw`/`journalctl` 细节回这四章查。

## 下一章

四层链路都能靠手敲命令验证，但每次上线都要 SSH、`git pull`、`build`、`up -d`，回滚靠翻 shell 历史，出问题只有你一个人在屏幕前。下一章讲发布策略——镜像 tag 怎么打、SemVer 怎么用、迁移为什么会让「回滚」变成一句空话，以及怎么在 5 分钟内退回上一个可用版本 → [发布与回滚](/devops/release-and-rollback)。把这套流程交给机器自动执行的，是还没写的 [CI/CD 与 GitHub Actions](/devops/ci-cd)；[测试体系](/devops/testing) 则在前面兜着「你敢不敢在周五下午点部署」。
