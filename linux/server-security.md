# 服务器安全：先把能被登录的入口数清楚，再逐层收窄

上线第三周的某个晚上，你收到云厂商的出网流量告警，同事又发来一张截图：首页被挂了一段乱码。SSH 登上去，`top` 里有个 `kworker/u4:2-events` 占着 190% CPU，而你从没写过这个进程；`auth.log` 里翻出四万行 `Failed password for root`，中间夹着一行 `Accepted password for root`。这时候要回答的不是「装哪个安全软件」，而是三个更朴素的问题：**这台机器有几个入口能被人碰到？这个入口是哪一层放开的？他进来之后能改走什么？**

大多数加固教程把安全写成清单：改端口、禁 root、关密码、装 fail2ban、开防火墙。照抄的人会卡在两处：每条都在改同一条登录路径，**顺序错了就把自己锁在门外**；清单不解释机制，于是你无法判断「这样算加固完了吗」——为什么关了 `PasswordAuthentication` 还能被密码登录？为什么 `PermitRootLogin no` 写了两遍不生效？为什么 Docker 起的端口不听防火墙的话？本章因此按一次攻击面清点来做，而不是按清单。

<Callout type="unverified" title="本章所有服务器端命令都没有在本机执行">

本机是 Windows 10，没有 Linux 内核、systemd、nftables、sshd，也没有可操作的真实服务器。下面每条 `sshd -T`、`ufw`、`fail2ban-client`、`unattended-upgrade`、`last`、`dpkg -V` 都**只给命令、预期输出形态和验证方法**，不写成实测。默认值取自官方手册页（核实日期 2026-10-20），但仍以你机器上的生效值为准——本章会反复给你那条自查命令。

</Callout>

## 第一步不是加固，是把入口数出来

判据只有一条命令：`sudo ss -ltnp`（谁在听 TCP、绑在哪个地址哪个端口、是哪个进程；`-p` 要特权才看得全），UDP 用 `ss -lunp`。预期输出形态（**未在本机验证**，字段语义见第 5 章）：

```text
State  Recv-Q Local Address:Port  Process
LISTEN 0      0.0.0.0:22          users:(("sshd",pid=812,fd=3))
LISTEN 0      0.0.0.0:80          users:(("nginx",pid=1024,fd=6))
LISTEN 0      127.0.0.1:3000      users:(("node",pid=1188,fd=19))
LISTEN 0      127.0.0.1:5432      users:(("postgres",pid=1420))
LISTEN 0      *:6379              users:(("redis-server"))
```

按「外面能不能连进来」分类，就是你的攻击面清单：

| 监听地址 | 外部能不能到 | 该怎么办 |
| --- | --- | --- |
| `127.0.0.1:5432`、`/run/redis/redis.sock` | 不能，只在回环 | **已经收好了**，别动它 |
| `0.0.0.0:22`、`80`、`443` | 能，且必须能 | 保住，然后收紧认证与 TLS |
| `0.0.0.0:3000`、`*:6379` | 能，且通常没人记得自己开过 | **优先处理**：改 bind，或收进反向代理 |

**这张表里唯一值得背的结论：能从 `0.0.0.0` 改成 `127.0.0.1` 的服务，永远先改 bind，而不是先加防火墙规则。** 改 bind 是把入口从系统里删掉；防火墙是在入口上装一道门，而门会被放行规则、被别的链、被 Docker 直接写内核的规则绕过（第四节讲这个坑）。两者都要有，顺序上先删门。

## `sshd_config` 的正确读法：一条规则解释所有的「为什么不生效」

服务端配置在 `/etc/ssh/sshd_config`，与客户端的 `ssh_config` 是两份文件、两套手册页——**改错文件是本章第一大乌龙**。[sshd_config(5)](https://manpages.debian.org/bookworm/openssh-server/sshd_config.5.en.html) 里那条规则是整个配置模型的钥匙：

> For each keyword, the first obtained value will be used.

**同一关键字出现多次，第一个值生效，后面全部忽略**；而 Debian 系的包在文件开头就放了 `Include /etc/ssh/sshd_config.d/*.conf`，按首值生效，被 include 的 drop-in **排在主文件其余配置之前**。于是这些现象同时说得通：你在主文件末尾加 `PermitRootLogin no`，而 `sshd_config.d/50-cloud-init.conf` 里已有 `PermitRootLogin yes`（很多云镜像为首次登录方便而写），你的修改一行都不生效；你把同一行粘贴三遍「确保生效」，生效的是最先出现那遍。

正确的改法是**固定一处、先看生效值再动手**：

```bash
sudo sshd -T | grep -Ei 'permitrootlogin|passwordauth|kbdinteractive|pubkeyauth'
#        ^ 以「当前真会生效」的口径打印全部配置，唯一可信的自查命令
sudoedit /etc/ssh/sshd_config.d/90-hardening.conf    # 新建 drop-in，不动主文件
sudo sshd -t                                          # 语法校验：不报错才继续
sudo systemctl reload ssh                             # Debian/Ubuntu 单元名 ssh.service，RHEL 系 sshd.service
```

`sshd -t` 与 `reload` 是安全网：语法错时 `sshd` 拒绝启动，而 `reload`（SIGHUP）不会因新配置里一条语法错就杀掉已在监听的进程，**你这条会话不会断**。但别拿它当赌本——后路与验证点见下面的落地顺序。

### 三条加固，和它们各自的默认值

下表是 2026-10-20 从那页手册核实的**上游默认值**；发行版可能在 drop-in 里显式改掉，所以以你的 `sshd -T` 为准：

| 关键字 | 手册默认 → 加固值 | 为什么 |
| --- | --- | --- |
| `PermitRootLogin` | `prohibit-password` → `no` | 默认**只是不让 root 用密码**，root 用密钥照样能登。而所有冲着 root 来的猜测、以及「谁往 root 的 `authorized_keys` 塞了一行」都直接等于最高权限。改成 `no` 逼所有人先登自己账号再 `sudo`，每次提权才在日志里留下「谁」 |
| `PasswordAuthentication` | `yes` → `no` | 关掉它，暴破的前提消失：没有「猜对密码」这条路，只剩猜中 256 位私钥这条路 |
| `KbdInteractiveAuthentication` | `yes` → `no` | **最常被漏。** 只关上一条，在启用 PAM 的发行版上客户端仍可走 keyboard-interactive 被要求输口令——表象就是「我明明关了密码登录，为什么还能用密码登进来」 |

`MaxAuthTries`、`LoginGraceTime`、`MaxStartups` 只缓解连接堆积、**不防暴破**，抄进加固清单没有意义；真正值得再加一条的是 `AllowUsers` 或 `AllowGroups` 白名单（默认全部允许；配合 `usermod -aG`，`-a` 不能省，见[用户与权限](/linux/users-and-permissions)）。

落地顺序是本章唯一必须严格照做的流程：**① 云控制台确认 VNC/串口能进（后路没确认之前一步都不要改）→ ② 建管理用户并进 sudo/wheel 组（第 2 章）→ ③ 把公钥装进他的 `authorized_keys` → ④ 新开终端用密钥登录这个新用户并成功（验证点，失败则改回配置毫无代价）→ ⑤ `sshd -T` 看生效值、改 drop-in、`sshd -t`、reload → ⑥ 保持第 ④ 步那个会话不断开，再开一个终端试着用密码登录，必须失败 → ⑦ 全部通过才允许关掉旧会话。** 第 ⑥ 步是判据：跳过它，你确认的是「配置写了」，不是「加固生效了」。

**改默认端口值不值？** 不增加真实安全性——扫描器几十分钟内就把 1–65535 打完，公开漏洞利用和凭据填充从来不看端口；唯一收益是日志噪音骤减。代价是确定的：每次连接记 `-p`、主机防火墙与安全组要同时放行、CI 脚本与备份跟着改，SELinux 系还要给端口打标签，否则 sshd 起不来。**把它当舒适度选项，别当加固项。**

## 服务不要以 root 跑：算的是「被拿下之后能拿走什么」

第 2 章建立了 UID 与权限位模型，第 3 章给了 `User=deploy`。这一节把两者接成一个安全问题：**进程权限的意义不是阻止入侵，而是把「一台机器沦陷」降级为「一个服务沦陷」。** Web 应用被拿下最常见的方式是远程代码执行，攻击者拿到的是一个 shell——**这个 shell 的 UID 决定他下一步能做什么**：

| 以 root 跑 | 以专用低权限用户跑 |
| --- | --- |
| 直接改 `/etc/shadow`、加一个 UID 0 账号 → 永久驻留 | 读不到（`640 root:shadow`），写不进 |
| 改 `/etc/sudoers`、往任意账号的 `authorized_keys` 塞公钥 | 只有本服务账号的家目录可写，塞不进别人的 |
| 读走所有站点、所有 `.env`、所有数据库文件和备份；装内核模块、删日志 | 只能读自己那一套目录；日志删不掉（journald 存储属主是 root，且默认带 Seal） |

`/etc/shadow`、`authorized_keys`、`/etc/sudoers` 共同构成 Linux 的**驻留机制**，三者都要求 root 或属主权限才能改——**这就是 `User=` 的真实收益：让他进来之后拿不到「下次还能进来」的能力。** 泄露半径自查三件事（**未在本机验证**）：`ps -o user=,pid=,cmd= -C node` 看这个进程究竟以谁的身份在跑；`sudo -u www-data cat /etc/shadow` 用进程的 UID 复现一次，读不到才算过关；`ls -l /srv/app/.env` 必须是 600 且属主为服务账号。

`.env` 是泄露事故的头号载体，标准很简单：**读得到 `.env` 的进程被拿下，等价于里面的凭据全部泄露。** 于是权限与发法要同时收紧：文件 `600` 且属主为服务账号；数据库账号只给这一个库的 `SELECT/INSERT/UPDATE`，云 API Key 用只到单个 bucket 的最小策略而不是管理员 AccessKey。第 7 章那个「`alias` 路径拼错、把 `.env` 当静态文件发出去」的组合，是很多站点真实的第一次泄露。

凭据还有两条纪律：**能被换掉的凭据才敢放在服务器上**——泄露后的处置成本应该是「改一行配置 + 重启」，而不是「重装系统」；**服务器上存的是公钥，不是你本机的私钥**——私钥被偷和服务器被偷是两件事。

## 防火墙与云安全组：两层各管什么，以及谁绕过了谁

第 5 章已经确立那条链：外部连不上一半在安全组、一半在主机规则，而 `ss` 显示在听只证明第 3 层没问题。这里讲两层的**职责差别**：

| 层 | 由谁执行 | 能不能被绕过 | 适合放什么 |
| --- | --- | --- | --- |
| 应用 bind | 应用自己 | 它自己说了算 | 默认 `127.0.0.1`，要公网再显式改 |
| 主机防火墙（nftables / ufw / firewalld） | 内核 netfilter，包进协议栈时 | **会被同机进程绕过**：Docker 直接往内核写规则，root 能 `nft flush ruleset` | 收紧「谁能在公网上敲门」 |
| 云安全组 / ACL | 云平台虚拟化层，包到你机器**之前** | 主机上的进程动不了它 | **最后一道兜底**，也是你被入侵后仍生效的唯一一层 |

这张表决定一条纪律：**只有 22/80/443 可以在安全组放行，其余一律不放行。** 它防不住攻击者，但防得住「你自己在机器上手滑开的那个端口」被公网发现。反过来只配安全组、不配主机规则也是错的：同 VPC 里另一台机器（或者被入侵的那台内网机）可以直接触达你的 3306。

命令怎么写在第 5 章讲过，这里只补安全视角的两条纪律。第一，**先 `allow 22/tcp` 再 `default deny incoming`**，然后 `ufw status verbose` 确认 `Default: deny (incoming)`——顺序写反不必然致命，但会制造「我明明 allow 了」的心理陷阱。第二，`policy drop` 这类默认丢弃的策略，落盘前用 `nft -c -f /tmp/test.nft` 只校验不加载，并且**保持已登录的会话不退出**：规则加载失败、或加载对了却把你锁在外面，都只有那条会话能救你。

真正致命的是这两类。**一、IPv6 被漏掉：** `inet6` 的监听项与 v4 是两套，手工写 nft 只加 `ip` 家族就等于 v6 全开；从另一台机器分别 `curl -4`/`curl -6` 各打一次。**二、Docker 发布的端口绕过 ufw：** Docker Engine 为做端口发布直接往内核的 NAT/`FORWARD` 链写规则，`-p 3000:3000` 一生效公网就能直连容器端口，**跟你在 ufw 里 deny 得再严没关系**；判据是 `sudo docker ps` 的 PORTS 列出现 `0.0.0.0:3000->3000/tcp` 且外部 `nc -vz` 通，修法是发布成 `127.0.0.1:3000:3000` 让 Nginx 走回环，或容器不发布端口（见[Docker Compose、卷与网络](/devops/docker-compose)）。附带一条：fail2ban 封禁时写的是自己的链，你手工清空规则集会把它一起清掉。

## 自动安全更新：把「记得打补丁」从你的意志力里拿走

真实的服务器沦陷里很大一块不是 0day，而是「发行版早就发了补丁，但没人装」。正确解法是把它交给系统，而不是交给自己的记性（**Debian/Ubuntu 的做法，包名与配置项以官方文档为准，未在本机验证**）：

```bash
sudo apt install unattended-upgrades
systemctl enable --now apt-daily-upgrade.timer
systemctl list-timers | grep -Ei 'apt|motd'   # 判据：真的排上了下次触发时间
sudo unattended-upgrade --dry-run --debug     # 把「打算装哪些包、会不会重启服务」打出来
```

配置分两处。`/etc/apt/apt.conf.d/50unattended-upgrades` 里最关键的是允许来源列表，Debian 上通常形如 `"${distro_id}:${distro_codename}-security";`——**把它只留给 `-security`，是自动更新敢开的前提**：全量自动升级会把一个小版本变更直接推上生产，而「打补丁」和「发布」应该各有验证点与回滚路径（后者见[发布与回滚](/devops/release-and-rollback)）。第二处是周期开关（`20auto-upgrades` 这一类文件）：`APT::Periodic::Update-Package-Lists "1"` 与 `APT::Periodic::Unattended-Upgrade "1"`。

两个决策工具不会替你做。**内核补丁装了不重启等于没装**（`/proc/version` 还是旧内核），而自动重启单实例服务器不可接受——要么有负载均衡能滚动（见[部署到 VPS](/devops/deploy-to-vps)），要么设每周维护窗口人工重启。**受影响的服务要不要自动重启**由 `needrestart` 一类的开关决定，开关名随版本变动，别照抄博客，用上面那条 `--dry-run --debug` 问你自己的机器。还有一条坑：它持有 `apt` 的锁，部署脚本报 `Could not get lock /var/lib/dpkg/lock-frontend` 多半是定时器正在跑（见[软件包与运行环境](/linux/packages-and-runtime)）。

## fail2ban：挂在哪份日志上，就只看得见那份日志里的攻击

工作模型只有三步：**读认证日志 → 用 filter 正则匹配出失败事件 → 按 jail 聚合，超过阈值就把来源 IP 交给 action 去封。** 所以判断力完全受第一步限制：**它读不到的日志，就不存在攻击。** 配置分三层（`/etc/fail2ban/`）：`jail.conf` 是发行版带来的默认 jails，`filter.d/` 定义「什么样的行算一次失败」，`action.d/` 定义「封的时候对防火墙说什么」。[jail.conf(5)](https://manpages.debian.org/bookworm/fail2ban/jail.conf.5.en.html) 明确写着这类文件应保持不变以便升级：

> It is recommended that \*.conf files should remain unchanged to ease upgrades.

所以**永远改 `jail.local`，不改 `jail.conf`**——这与 sshd 的 drop-in、systemd 的 `systemctl edit`、apt 的 `sources.list.d` 是同一套设计哲学：**你的意图写在独立文件里，升级不动它，也不被它覆盖。**

```ini
[DEFAULT]
backend = systemd                 ; 从 journald 读，而不是 /var/log/auth.log
ignoreip = 127.0.0.1/8 ::1 192.0.2.5
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
```

三处取舍必须讲清。**`backend` 要与日志来源匹配：** 较新发行版上 `auth.log` 可能根本不存在（日志全在 journald），或者 `rsyslog` 又把它落回文本文件；选错的结果是 **fail2ban 跑得好好的、一条都没封过**。判据是两条命令对照：`journalctl -u ssh -n 20` 有没有失败行，`sudo fail2ban-client -d | grep -E 'backend|logpath'` 生效配置读的哪。**默认值别看教程抄：** `bantime`/`findtime`/`maxretry` 的包内默认随版本变化，用 `fail2ban-client get sshd bantime` 问你的机器。**`ignoreip` 忘写就是自杀式配置：** 动态宽带 IP 被运营商复用，某天分给你的测试机就被封在门外。

最后一句定位：**它封的是 IP，不是凭据。** 有效范围是字典暴破、扫路径、单源洪水；防不住分布式慢速尝试（每 IP 只试三次），更防不住**拿着你泄露的私钥直接登录**的人——认证一次通过、日志干干净净，`fail2ban-client status sshd` 显示 0 封禁。**它是日志驱动的自动封禁，降低成本与噪音，不是访问控制。**

## 被入侵之后：按顺序看痕迹，以及为什么不「清理」

先讲决策，因为它决定后面所有动作的顺序。**如果这台机器在跑生产数据，处置是：取证 → 隔离 → 重装系统 → 轮换全部凭据 → 从干净备份恢复 → 补上被利用的那条路径。** 不是「杀毒式清理」。两个理由：攻击者有 root 时可以让 `ps`、`ss`、`ls` 都是假的（替换二进制、`ld.so.preload` 注入、内核模块），**你在这台机器上跑的每条排查命令本身都可以被欺骗**；而且你不知道要清理什么——你看见那个挖矿进程，看不见他留在 `authorized_keys` 里的第三把公钥。以下命令**均未在本机执行**。

**1. 他什么时候、用什么方式进来。**

```bash
last -Fai      # /var/log/wtmp：谁登录过、从哪个 IP（still logged in = 会话还在，先记下别踢）
lastb -Fai     # /var/log/btmp：失败尝试，需要特权
lastlog        # 每个账号最后一次成功登录——用它发现「从没登录过的账号突然登过」
sudo journalctl -u ssh --since "2026-10-17" | grep -Ei 'Accepted|Failed'
```

三种成功要分开读：`Accepted publickey for deploy`（正常，是你自己）、`Accepted password for root`（只有 `PermitRootLogin` 被显式改成 `yes` 才可能出现，出现即说明配置或凭据有问题）、`Failed ... for invalid user X`（账号不存在，猜中也没意义）。`last` 里 `down` 时间与会话对不上，说明有人改过或删过 wtmp。

**2. 现在在跑什么。** `ps -eo pid,user,etimes,pcpu,cmd --sort=-pcpu | head -15`——`etimes` 是运行秒数，一个「刚起 300 秒」的高 CPU 进程和你上周部署的服务不是同一类东西；`ss -tnp` 看陌生外连（矿池、C2 回连都在这张表里）。**判据别看进程名，看 `/proc/PID/exe`**：真内核线程没有可执行文件路径，所以一个有 exe、还指向 `(deleted)`、却叫 `kworker` 的进程就是伪装（练习 2 就在练这条）。

**3. 他有没有留下「下次还能进来」的东西。**

```bash
sudo grep -c . /home/*/.ssh/authorized_keys /root/.ssh/authorized_keys   # 行数比你想的多？
sudo ls -la /etc/sudoers.d/ /etc/systemd/system/   # 多出来的授权与单元
sudo cat /etc/ld.so.preload          # 有内容基本等于 rootkit
sudo dpkg -V                          # 每行都是一个被改动的系统文件
sudo find / -xdev -perm -4000 -type f # SUID 全集：陌生的那个就是提权台阶
```

**4. 把「四万行」压成三行证据。** 用 `grep`/`awk`/`sort | uniq -c | sort -rn` 按「被试用户名是否真实存在」「来源 IP」「成功方式」三个维度聚合认证日志，完整方法与本机实测过程在下一章。要记的结论只有一条：满屏 `invalid user` 是常态噪音，**「不带 `invalid user` 的失败行」才说明攻击者知道这是真实账号**；若成功行全部落在 `publickey` 加你自己的已知 IP 上，就是「暴破没得手」的证据形态，反过来出现 `Accepted password for deploy` 就直接走上面 1～3 步。

## 常见错误与排查

1. **现象：`PermitRootLogin no` 明明写了，`ssh root@` 还能登。** 原因：首值生效——主文件里更早就有一次赋值，或某个 drop-in 在你之前被 include 且写了 `yes`；也可能你改的是客户端 `ssh_config`。怎么确认：`sudo sshd -T | grep -i permitrootlogin`，**它打印生效值而不是文件内容**。怎么修：把所有赋值收敛成一处，改完 `sshd -t` + reload，再按上面落地顺序的第 ⑥ 步做行为验证。
2. **现象：关了 `PasswordAuthentication`，`ssh -o PreferredAuthentications=password` 仍能触发口令提示。** 原因：`KbdInteractiveAuthentication` 还是 `yes`，客户端改走 keyboard-interactive，服务端交给 PAM 问口令。怎么确认：`sshd -T | grep -Ei 'password|kbd|usepam'`，并看 `ssh -v` 里服务端列出的可用认证方法。怎么修：两条一起关，**且先确认密钥登录成功过**。
3. **现象：开防火墙后 SSH 超时（不是拒绝）。** 原因：`default deny incoming` 生效时 allow 里没有 SSH 端口；或放行的是 22 而你改了端口；或主机放行了而安全组没放行；或规则只对 v4 生效而你从 v6 连。怎么确认：**超时=包被丢弃，拒绝=端口没人听**（第 5 章判据）；`ufw status numbered` 与 `nft list ruleset`；从另一台机器 `nc -vz -4` 与 `-6` 各试一次。怎么修：从云控制台 VNC 进去补规则，别远程改；改完不要立刻退出已有会话。
4. **现象：fail2ban 装了、jail 启了，`status sshd` 的 failed 一直是 0，但日志明明在被打。** 原因：`backend` 与日志来源不匹配（`logpath` 指向不存在的 `auth.log`，或 journald 里根本没有那条流）；或 jail 名与服务单元名混淆（Debian 单元叫 `ssh`，jail 叫 `sshd`）。怎么确认：`fail2ban-client -d | grep -E 'backend|logpath'` 对照 `journalctl -u ssh -n 20` 与 `ls -l /var/log/auth.log`。怎么修：二选一——设 `backend = systemd`，或让 `rsyslog` 真的产生文本日志。**别把「重启 fail2ban」当修法，它起来就是读不到。**
5. **现象：`reload` 之后监听端口没变，或 `Failed to reload ssh.service`。** 原因：SIGHUP 不会让 sshd 重新绑定监听地址与端口——端口和主机密钥只在进程启动时读，改 `Port` 必须 `restart`。怎么确认：`ss -ltnp | grep sshd` 与 `systemctl status ssh` 的启动时间。怎么修：**先确认控制台后路可用**再 restart，随后立刻 `journalctl -u ssh -n 20` 看有没有 `fatal:`；报错就用后路进去把 drop-in 改名成 `.disabled` 再启动。

## 练习

<Exercise title="练习 1 · 从 ss 的输出里数出入口" difficulty="基础">

一台刚部署完博客的 VPS 上 `sudo ss -ltnp` 的输出（**为本题造的示例数据**）：

```text
LISTEN 0  511   0.0.0.0:3000    users:(("node",pid=1188,fd=19))
LISTEN 0  80    127.0.0.1:5432  users:(("postgres",pid=1420))
LISTEN 0  4096  *:6379          users:(("redis-server"))
LISTEN 0  128   [::]:22         users:(("sshd",pid=812,fd=4))
```

1. 按「立刻处理 / 只需确认 / 已经是收好的」分档。
2. `*:6379` 与 `[::]:22` 各说明什么？
3. Redis 那行打算怎么改、改完怎么验证——注意 **Redis 默认没有认证**。

<template #answer>

**立刻处理**：`0.0.0.0:3000`（Node 本该由 Nginx 代理）与 `*:6379`——无认证服务直接对公网，任何人都能读写你的缓存，旧版 Redis 常被用来写 crontab 或 SSH key 实现 RCE。**只需确认**：`[::]:22` 是 sshd 的 IPv6 监听，域名有 AAAA 记录时防火墙与 fail2ban 的 v6 路径必须同时生效，否则你收紧的只是其中一半。**已经是收好的**：`127.0.0.1:5432`。

`*:6379` 比 `0.0.0.0` 更宽（v4 与 v6 都接）。改法是**先改 bind 再谈防火墙**：`bind 127.0.0.1 -::1` 加 `protected-mode yes`，或让应用走 Unix 套接字（`unixsocket /run/redis/redis.sock`），连 TCP 端口都不留；Docker 起的就发布成 `127.0.0.1:6379:6379` 或不发布。验证两条：`ss -ltn | grep 6379` 只剩回环，**且从另一台机器 `nc -vz 公网IP 6379` 必须失败**——本机自连证明不了外部不可达（第 5 章那条实测局限在这里同样成立）。

</template>

</Exercise>

<Exercise title="练习 2 · 这份日志说明沦陷了吗" difficulty="进阶">

从一台对外提供 API 的服务器上截了三段（**为本题准备的合成数据，形态取自上面本机跑过的那条统计管道**）：

```text
A  1247 行  Failed password for invalid user admin from 203.0.113.10
      31 行  Failed password for deploy from 203.0.113.10
       1 行  Accepted publickey for deploy from 192.0.2.5

B  ss -tnp:  node  ESTAB  10.0.0.12:41234 -> 198.51.100.66:4444
   ps -eo pid,user,etimes,pcpu,cmd:  2871 root  300  98  /usr/bin/kworker

C  ls -l /proc/2871/exe -> (deleted)；cat /etc/ld.so.preload 为空
```

1. A 里为什么「`deploy` 被试 31 次」比「admin 被试 1247 次」更值得看？
2. B 里哪几个特征组合起来足以判定是入侵，而不可能是正常服务？
3. C 的两条结果各排除了什么、没排除什么？
4. 你现在最该做的三件事，按顺序。

<template #answer>

1. 1247 条 `invalid user` 是字典扫描的常态噪音——账号不存在，猜中也没意义。`Failed password for deploy` 不带 `invalid user`，说明**攻击者知道 `deploy` 是真实账号**（可能来自公开代码、报错页脚或泄露的 `.git`）；有效账号 + 弱口令是最快的入侵路径。那条 `Accepted publickey` 只要来源是你自己的出口 IP 就属正常，但账号名已暴露，该考虑换不显眼的名字或改用 `AllowGroups`。
2. 单看 CPU 98% 或单看进程名都不能判定。**判定组合：① 外连到与业务无关的地址端口（4444 常见于反向 shell 或矿池）；② 属主 root 而 `etimes` 只有 300 秒——你没在 5 分钟前部署过任何东西；③ `/proc/PID/exe` 指向一个已删除的普通可执行文件，而真内核线程没有 exe。** C 就在验第 ③ 条。
3. `exe -> (deleted)` 排除了「真内核线程」，并留下取证线索：先 `sudo cp /proc/2871/exe /tmp/evidence.bin` 再杀。`ld.so.preload` 为空**只排除这一种**用户态注入，没排除被替换的系统二进制（`dpkg -V`）、新增单元与 `crontab`、`authorized_keys` 里的新公钥、内核模块。「一个排查点干净」不等于「机器干净」。
4. **保存证据再动手**（exe 副本、`last`、日志片段拉到另一台机器）→ **切断入口而不是切断进程**（安全组收紧到只允许你的 IP，吊销密钥、改云 API Key、轮换数据库口令；`kill -9` 没用，他还有 crontab）→ **做一份干净备份，重装系统、换新凭据重新部署**。三件不要做：`rm -rf` 他的文件当「清理」；重装前先 `shutdown`（内存证据没了）；没搞清入口就把同一份 `.env` 原样搬回新系统。

</template>

</Exercise>

<Exercise title="练习 3 · 故意把自己锁在门外，并解释每一步的现象" difficulty="挑战">

你一次做完四件事，按这个顺序：

```bash
sudo sed -i 's/^#Port 22/Port 2222/' /etc/ssh/sshd_config   # 1 改 sshd 端口
sudo systemctl restart ssh                                  # 2 立刻重启服务
ssh -p 2222 deploy@203.0.113.10      # 3 另一个终端连接（原会话还开着）→ Operation timed out
sudo ufw status                      # 4 检查防火墙 → Status: active，只有 22、80、443 的 ALLOW
```

1. 第 3 步为什么是**超时**而不是 `Connection refused`？给出这一层的判断链。
2. 三个必须同时修的地方。
3. 如果第 2 步之后原来那个会话也断了，你还剩哪条路？由此推出这条流程里最该提前做的一件事。
4. 用一句话说出「把 SSH 端口改成 2222」的安全顺序，并指出它和上面这个错误顺序差在哪。

<template #answer>

1. **超时 = 包被静默丢弃（DROP），拒绝 = 包到了机器但那个端口没人听（RST）。** 22 上确实没人听了，但 2222 明明有 sshd 在听（`ss -ltnp | grep 2222` 会显示），你却拿到超时——说明**包没走到传输层就在网络层被丢了**，问题一定在防火墙类过滤上：ufw 只 allow 了 22，云安全组大概率也只放行 22。（拿到 `Connection refused` 的判读完全反过来：包到了，但 sshd 没在新端口起来，去看 `journalctl -u ssh`。）
2. **ufw** 先 `allow 2222/tcp` 再 `delete allow 22/tcp`（先加后删，顺序不能反）；**云安全组**放行 2222 并撤掉 22；SELinux 系还要 `semanage port -a -t ssh_port_t -p tcp 2222`（**未在本机验证**），否则 restart 时 sshd `bind: Permission denied`。
3. 旧会话一断，SSH 这条路就全断——**唯一后路是云控制台的 VNC/串口终端**（有些厂商叫救援模式或 Web Shell），它不走 22、也不受 ufw 影响。所以最该提前做的是：**任何改认证或改监听口的操作之前，先去控制台亲自进去一次**。有它，你能把 drop-in 改名成 `.disabled`、`sshd -t`、再启动，几分钟恢复；没有它，这类改动等价于赌博。
4. 「后路 → 先放行 2222（22 保留）→ 改配置 → `sshd -t` → `restart` → `ss` 确认在听 → **旧会话不断**的前提下新终端连 2222 → 才撤 22 → 最后更新 `~/.ssh/config`、部署脚本与 CI 里的端口」。与题目那个错误顺序的差别只有一条：**任何时刻都至少有一条能进去的路**，而题目里 22 在第一步就被 sed 关掉、2222 还没放行。

</template>

</Exercise>

## 官方文档与延伸阅读

站内衔接：入口清点与「超时/拒绝」判据在[网络诊断与防火墙](/linux/networking)；UID、`sudoers`、`authorized_keys` 与 MAC 在[用户与权限](/linux/users-and-permissions)；`User=` 与单元硬化在[进程、信号与 systemd](/linux/processes-and-systemd)；`alias` 拼错与 TLS 在 [Nginx](/linux/nginx)；日志与排障在[日志与故障定位](/linux/logs-and-troubleshooting)；把本章挂进交付流程的是[阶段项目：从零接管一台 VPS](/linux/project)。

- [sshd_config(5)（Debian bookworm 手册页）](https://manpages.debian.org/bookworm/openssh-server/sshd_config.5.en.html)——**已核实**：「同一关键字取第一个值」、Debian include `sshd_config.d/*.conf`，以及 `PermitRootLogin` 默认 `prohibit-password`、`PasswordAuthentication` 与 `KbdInteractiveAuthentication` 默认 `yes`。本章默认值以此页为准，但仍要用 `sshd -T` 核对你机器上的生效值。
- [OpenSSH Manual](https://www.openssh.com/manual.html)——`sshd(8)` 的 `-T`/`-t` 语义与「重载不会改变监听端口」，`ssh_config(5)` 是另一份文件。
- [fail2ban 官网](https://www.fail2ban.org/) 与 [jail.conf(5)（Debian 手册页）](https://manpages.debian.org/bookworm/fail2ban/jail.conf.5.en.html)——后者**已核实**「conf 文件应保持不变、覆盖写在 `jail.local`」。本章不写 `bantime`/`maxretry` 的默认值，因为包内默认随版本变化。
- [nftables wiki](https://wiki.nftables.org/)——`policy drop`、`ct state established,related`、`inet` 家族与 `iptables-nft` 兼容层。
- [Debian Reference 手册](https://www.debian.org/doc/manuals/debian-reference/) 与 [Ubuntu 官方服务器文档](https://documentation.ubuntu.com/)——`dpkg -V`、`unattended-upgrades`、`last`/`lastb`、`ufw`，以及两个发行版的组名与单元名差异。本章所有发行版专属命令**均未在本机执行**。

## 下一章

这一章讲「别让门开着」，[日志与故障定位](/linux/logs-and-troubleshooting) 讲「门都关了，机器为什么还是慢、还是挂、磁盘为什么又满了」：journald 的存储与空间控制、logrotate 为什么有时不按 `size` 轮转、磁盘/CPU/内存三条主线，最后把本章的「看痕迹」与第 5 章的分层链合并成一套固定的排除顺序。学完它就能进[阶段项目](/linux/project)。
