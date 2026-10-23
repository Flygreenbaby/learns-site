# 日志与故障定位：把「我觉得」变成「证据在这一行」

服务器半夜不响应，你登上去的第一件事不是重启，而是回答三个问题：它什么时候开始坏的？坏之前最后一行日志说了什么？这个现象该由哪一层负责？能回答这三问，你就不需要猜。大多数人的困境是：日志有，但不会看；命令会敲，但看不出所以然；重启之后好了，却不知道是什么好了——于是同一种故障三个月后原样再来一次，你还得再猜一遍。

这一章建立一套固定方法：**先用日志确定时间线与责任层，再逐层取证据缩小范围，最后把「修好了」写成「因为这条证据所以是这一层」**。它和第 5 章的分层链是同一思路的不同工具：那一章讲「连不通」怎么分层，这一章讲「慢、挂、满」怎么分层，以及日志本身要怎么管——因为**日志自己也会成为故障源**（写满磁盘、限速丢消息、轮转没生效导致单个文件 40 GB）。

<Callout type="unverified" title="本章服务器端命令未在本机执行；文本统计管道是本机实测">

本机是 Windows 10：没有 journald、logrotate、systemd 单元，也没有 nginx 与真实服务器。`journalctl`、`systemctl`、`logrotate -d`、`timedatectl`、`df`/`du`/`lsof` 的全部示例**只给命令、预期形态与判据，不是实测**。两处例外：journald 与 logrotate 的默认值取自官方手册页（核实日期 2026-10-20，链接在文末）；「用文本管道把访问日志和性能日志压成分诊结论」那一段我在本机对合成日志真跑过，数据性质在那段里单独交代。

</Callout>

## 日志的唯一用途：把猜测变成可核对的证据

一份日志的价值不在于「有没有」，而在于**能不能在几分钟内定位到那一行**。你要看的四类来源各回答一个不同的问题：服务的标准输出（进 journald）回答「它为什么没起来」；Nginx access log 回答「请求有没有到我这里、谁给的错误码」；Nginx error log 回答「Nginx 为什么给这个错」；内核（`dmesg`、`journalctl -k`）回答「机器层面发生了什么——OOM、磁盘错误、网卡状态」。

新手最常见的动作是「翻最后 200 行看有没有 error」，但它有一个前提：**你得先知道故障的时间点**。时间点是整场排障的锚——先确定「什么时候开始坏的」，再取那个窗口前后各两分钟的全部日志，才谈得上「看什么」。确定时间点的手段按可得性排序：用户反馈的时间、监控曲线的拐点、access log 里第一个 5xx、`systemctl status` 的 `Active:` 时间。

<Callout type="warn" title="日志会「不在了」，这是排障失败的头号原因">

三个让证据消失的机制：journald 到空间上限自动删旧、logrotate 按保留份数删除、以及服务重启后上一次启动的日志被归档到 `-b -1`（默认只显示本次启动）。所以第一条习惯是**动手重启之前先把证据拷出来**：`journalctl -u 服务名 --since "…" --until "…" > /tmp/keep.log`。第 10 章把它写进项目流程。

</Callout>

## 谁产生、写到哪、谁会删

一条日志文本从产生到删除的典型路径（**未在本机验证**，路径随发行版与配置变化）：

```text
应用进程 ──stdout/stderr──> systemd/journald ──(可选)──> rsyslog ──> /var/log/*.log ──> logrotate 轮转
Nginx ──access_log/error_log 直接写文件──> /var/log/nginx/*.log ──> logrotate
容器 ──stdout──> json-file ──> /var/lib/docker/containers/<id>/*-json.log ──> Docker 自己的 max-size
内核 ──> 环形缓冲区 ──> journald(-k) 与 /var/log/kern.log
```

这张图只需要得出三条结论。**一、同一事件可能在两个地方各有一份**（journald 与 `/var/log/auth.log`），所以「这里没日志」不等于「没发生」——第 8 章 fail2ban 的 `backend` 选错就栽在这条上。**二、删除责任人不同**：journald 里的由 journald 的空间上限删，`/var/log` 下的由 logrotate 删，容器日志由 Docker 的日志驱动删，logrotate 完全不管最后一类。**三、谁在写盘决定磁盘为什么满**——三条主线之一。

`journalctl` 的基本功（**未在本机验证**）：

```bash
sudo journalctl -u ssh -f                      # 只看某单元，实时跟随
sudo journalctl --since "2026-10-18 09:55" --until "2026-10-18 10:05"
sudo journalctl -b -1 -u myapp                 # 上一次启动周期：重启前的现场
sudo journalctl -p err -k --since today        # 只看 error 及以上，只看内核
sudo journalctl --disk-usage                   # journald 现在占多少
```

`-u` 要的是**单元名**而不是进程名，这是最大的一个坑：`journalctl -u node` 什么都没有，因为单元叫 `myapp.service`。找不到单元名就先 `systemctl list-units --type=service | grep 关键字`。

## journald：空间控制、丢消息、以及为什么这台机器没有持久日志

[journald.conf(5)](https://manpages.debian.org/bookworm/systemd/journald.conf.5.en.html) 的默认值解释了所有「日志吃满磁盘」和「日志怎么少了」的现象（**已核实**，2026-10-20）：

| 配置 | 官方默认 | 它导致的现象 |
| --- | --- | --- |
| `Storage` | `auto` | `/var/log/journal` 存在就落盘，**否则只放内存** `/run/log/journal`，重启即丢 |
| `SystemMaxUse` | 文件系统的 10%，**上限 4 GB** | journald 的总占用上限，到顶就删最旧的 |
| `SystemMaxFileSize` | `SystemMaxUse` 的 1/8，上限 128 MB | 单个段文件的大小，决定「一次能翻多远」 |
| `MaxRetentionSec` | `0`（关闭） | 默认只按空间删不按时间——磁盘小的机器会很快把历史挤掉 |
| `RateLimitBurst` / 间隔 | 30 秒 10000 条 | 超出部分**被丢弃**，只补一条 `Suppressed N messages` |

三条判读。**「`auto` 但目录不存在」等于你根本没有持久日志**：Debian/Ubuntu 最小安装常常不带 `/var/log/journal`，于是重启前那次崩溃的现场全在内存里、随重启消失。建目录并 `systemctl restart systemd-journald` 才会落盘——**这条必须在出事前做**。

**「少了 3000 行」是限速丢的，不是没发生**：某个服务在死循环里疯狂打日志，journald 把它后面的都丢了，只留一条 `Suppressed N messages from …`。看到这条应该去找**是谁在刷**，而不是去找丢掉的行（找不到）。这是排障里少数「日志缺失本身就是证据」的情形。

**空间用配置收缩，不要手删**：`--vacuum-size=200M`、`--vacuum-time=7d` 是安全做法（**未在本机验证**）；手工 `rm` 那些 `.journal` 文件会让 journald 握着的句柄继续占空间——第 1 章那句「删了没释放」在这里原样成立。

## logrotate：为什么它有时「不轮转」，以及 copytruncate 丢哪一段

`/var/log` 下的文本日志由 logrotate 管。[logrotate.conf(5)](https://manpages.debian.org/bookworm/logrotate/logrotate.conf.5.en.html)（**已核实**）里四条默认值直接对应四种误解：

| 你以为 | 实际默认 | 现象 |
| --- | --- | --- |
| 配了 `size 10M` 就会立刻切 | `size` 与时间间隔**互斥**，且一天不重复处理同一日志 | 它是每日定时任务：没到下一次运行，再大也不切 |
| 不写 `rotate N` 会一直留 | `rotate` 默认 **0** | 切完直接删，一份历史都不留 |
| 文件不存在无所谓 | 默认是 `nomissingok` | 日志文件被删后 logrotate 报错，该配置块不再处理 |
| 空文件不会切 | 默认是 `ifempty` | 空日志也切出一份 0 字节历史 |

想要「大到就切」用 `maxsize`（周期未到也按大小切），想要「没长够就别切」用 `minsize`。轮转之后进程要不要重开文件，是两种模式的本质差别：Nginx 一直握着旧句柄写，新建的文件没人写，所以要 `create` 新文件 + 发信号让它重开。`copytruncate` 是**先复制再截断**，进程不用动——代价是复制与截断之间那一段**必然丢**，而且它不创建新文件（手册明确）。所以生产优先「轮转 + 通知重开」，只有你控制不了那个进程时才用 `copytruncate`。

一个完整的 Nginx 块（放 `/etc/logrotate.d/nginx`，发行版通常已带，**未在本机验证**）：

```text
/var/log/nginx/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 $(cat /var/run/nginx.pid)
    endscript
}
```

`delaycompress` 给「进程还没重开句柄」留缓冲：本次切出的那份先不压缩，下次再压。`sharedscripts` 保证 `postrotate` 整块只执行一次而不是每个文件一次。验证只有两条命令：`sudo logrotate -d /etc/logrotate.d/nginx` 是演练（不动文件，把打算做的打出来），`-f` 是强制立刻执行一次。**「配了但没生效」的答案 100% 在这两条的输出里。**

## 时间不同步时，所有日志都失去意义

这一步几乎所有人都跳过，但它是「为什么我的日志顺序不对」的唯一答案。先分清**时钟**（现在几点）与**时区**（怎么显示）：journald 存 UTC，显示按本机时区渲染，`--since "10 min ago"` 也是本机视角。

```bash
timedatectl status                    # 看 Local time / NTP / System clock synchronized
timedatectl set-timezone Asia/Shanghai   # 只改显示，不改钟
```

（**未在本机验证**；Debian/Ubuntu 由 `systemd-timesyncd` 或 `chrony` 对时，容器与最小安装里常常两者都没跑。）三个真实故障形态：**一、跨机器关联不上**——A 机 access log 与 B 机应用日志差 3 分钟，你永远对不上「哪个请求对应哪条异常」。**二、虚拟机快照恢复后时钟跳回**，随后 NTP 一次拉前，中间那批日志落在「未来」，`--since/--until` 全过滤不到。**三、TLS 与令牌**：证书有效期、JWT 的 `nbf/exp` 都依赖本地时间，钟偏几天会出现「配置明明对却握手失败」「token 还没生效」这种看不出与时钟有关的错。

判据一句口诀：**先看钟再读日志**。任何排障第一步 `timedatectl` 花两秒确认时间可信，否则后面所有「先后顺序」的推理都不成立。

## 服务启动失败：读 `systemctl status` 的三个字段

（**未在本机验证**）服务起不来，`status` 输出里有三处在给答案：

```text
● myapp.service - My Node App
     Loaded: loaded (/etc/systemd/system/myapp.service; enabled; vendor preset: enabled)
     Active: failed (Result: exit-code) since Sun 2026-10-18 10:03:12 UTC; 3min ago
   Main PID: 1587 (code=exited, status=1/FAILURE)
```

**一、`Active:` 括号里的 Result**：`exit-code` 是你的程序自己退的（去读下面的日志行）；`timeout` 是没在 `TimeoutStartSec` 内报到 ready；`signal` 是被信号杀的。**二、`code=exited, status=`**：`status=1/FAILURE` 是应用自己的退出码，这时末尾那几行日志才有意义；而 `status=203/CHDIR`、`204/EXEC`、`217/USER` 这类**带阶段名**的形式表示 systemd 在 exec 阶段就失败了——工作目录不存在、`ExecStart` 不可执行、`User=` 不存在，**你的程序一行都没跑**。具体编号语义以 `systemd.exec(5)` 为准（本章未核对该页），但「带阶段名 = 还没进你的代码」这个读法可靠：它让你去看单元文件而不是去看应用日志。**三、末尾日志行**：`status` 默认附带最后几行 journald 输出，不够就 `journalctl -u myapp -n 50`，重启后找现场用 `-b -1`。

改完单元文件必须 `sudo systemctl daemon-reload`——**忘了它是「改了没生效」的头号原因**（第 3 章讲过机制：解析结果缓存在内存里）。另有「起来又反复重启」：出现 `Start request repeated too quickly` 说明崩溃次数触发了 `StartLimitBurst`（写在 `[Unit]`，不在 `[Service]`）——先找到崩溃原因再调限制，否则只是把崩溃循环藏起来。

## 端口与反向代理故障：状态码就是责任划分

有 Nginx 在前面时，**状态码本身就是分诊单**（细节在第 5、7 章，这里是排障视角的归并）：

| 现象 | 谁给的 | 第一证据 | 常见根因 |
| --- | --- | --- | --- |
| `502` | Nginx | error log 里 `connect() failed (111: Connection refused)` | 上游没跑、socket 路径或权限错、监听地址写错 |
| `504` | Nginx | `upstream timed out` | 上游没在 `proxy_read_timeout` 内返回（慢查询、外部依赖卡住） |
| `500` | 上游应用 | journald 里你的异常栈 | 代码或数据问题，与 Nginx 无关 |
| WebSocket 连上就断 | Nginx | access log 里有没有 101 | `proxy_http_version 1.1` 或 `Upgrade`/`Connection` 头缺失 |
| 只有某一台机器不通 | 网络 | 从那台机器 `nc -vz` 与 `curl -v` | 本地 DNS、IPv6、或你只放了 v4 规则 |

`502` 与 `504` 的分别是关键：前者是**连不上或被立刻拒绝**（进程没在、地址错），后者是**连上了但没回**（进程在，但慢或卡）。前者查 `ss -ltnp` 与单元状态，后者查应用耗时与数据库。**把「重启 Nginx」当 502 的修法是最常见的无效动作**——Nginx 没错，错的是它的上游。

判据要落到字段上。第 7 章那条 `log_format perf` 把 `$request_time`（rt）与 `$upstream_response_time`（urt）都记进 access log，就是为了给「慢」一个客观分界：**rt 大而 urt 小 → 慢不在后端**（网络、TLS、静态发送、客户端带宽）；**rt 与 urt 都大且几乎相等 → 慢在后端**；**urt 是 `-` → 上游根本没响应**（对应 502/504）。

<Callout type="verified" title="本机实测：把访问日志与性能日志压成分诊结论">

环境：Windows 10 + Git Bash（bash 5.2.37）+ GNU awk，日期 2026-10-20。输入是我按真实格式造的**合成日志**：`linux/.scratch/t15/out/access.log`（1840 行 combined 格式）、`out/perf.log`（300 行，字段即第 7 章的 `perf` 格式）、`out/auth.log`；脚本与完整输出在同目录 `logtriage.sh` 与 `out/result.txt`。**数据是我造的，不是任何真实服务器的事件**，但管道与判读可以原样搬到真机：

```text
A  访问量前 5        400 203.0.113.11 / 400 203.0.113.10 / 400 198.51.100.7 / 17 192.0.2.30 …
B  只看可疑路径      三个 400 全部落在 /wp-login.php /.env /shell.php /phpmyadmin
C  单源状态码        203.0.113.10：267 次 404、133 次 200（其中 200 落在 /shell.php 67、/wp-login.php 66）
D  按小时聚合        800 次 03 时 403、267 次 03 时 404、40 次 10 时 502
F  perf 分桶 300 行  正常 260 / 慢在后端 8 / 上游无响应 5 / 慢不在后端 27
```

四条判读，每条在真机上都能立刻用。**①「访问量最大」不等于「最可疑」**：必须先做 B 那一步（按路径过滤），才知道前三名是扫描器。**②状态码分布告诉你有没有真的中招**：C 里 133 次 200 是坏消息——请求 `/shell.php` 却返回 200，在真实事故里意味着「这个路径存在」，要按第 8 章的沦陷流程处置，而不是继续当噪音。**③按小时聚合区分「被扫」与「出事」**：D 里 03 时的 403/404 尖峰是扫描窗口，10 时的 40 次 502 是你自己的服务在那十分钟坏了，两条时间线分开查。**④rt/urt 分桶给出该查谁的比例**：F 里慢在后端只有 8 行、慢不在后端 27 行——**先分桶再优化**，否则你会去调后端而问题根本不在那里。

</Callout>

## 三条主线：磁盘、CPU、内存

**磁盘满**，顺序固定（**未在本机验证**）：

```bash
df -h                      # 哪个挂载点满；先确认不是 /run 这类 tmpfs
df -i                      # inode 耗尽：df 说 100% 但 du 找不到大文件
sudo du -x --max-depth=1 / | sort -n | tail -15
sudo lsof +L1              # 已删除但进程还握着句柄的文件
sudo journalctl --disk-usage;  sudo docker system df
```

`du -x` 的 `-x` 是这一串里唯一值得背的：不加它，统计会钻进 `/proc`、`/sys` 和别的挂载点，结果毫无意义。四个高频答案：journald（`--vacuum-size` 收缩）、Docker 镜像与构建缓存（`prune --volumes` 会删卷，**先确认备份**，见[Docker Compose、卷与网络](/devops/docker-compose)）、容器 stdout 的 json 日志（无限增长，靠 `logging` 的 `max-size`）、「已删除但仍打开」的文件（`lsof +L1` 找到进程，重启它才释放）。

**CPU 高 / 变慢**：`top` 第一行的 `load average` 是 1/5/15 分钟的平均**可运行任务数**，不是百分比——4 核机器上 load 4 是满、load 8 是排队。分诊看 `%Cpu(s)` 四个字段：`us` 高是应用在算（去 profiling）；`sy` 高是系统调用与上下文切换太多；`wa` 高**根本不是 CPU 问题**而是磁盘慢，去看 `iostat -x` 的 `%util`；`st` 高是虚拟机被宿主抢走了时间。

**内存 / OOM**：`free -h` 要看 **`available` 而不是 `free`**——Linux 把空闲内存拿去做页缓存，`free` 小而 `available` 大是正常的。真正的 OOM 有确凿证据：`sudo dmesg -T | grep -i -E 'oom|killed process'` 或 `journalctl -k --since "1 hour ago"`，内核会打印它选了哪个进程、为什么选它。被杀之后 `systemctl status` 里是 `status=9/KILL` 或 `signal=KILL`——**这就是「服务反复重启但日志里没有异常栈」的标准答案**：程序来不及报错就被杀了。三条出路：给进程明确上限（Node 用 `--max-old-space-size`，比让内核随机杀可控）、加 swap 缓冲、或用 systemd 的 `MemoryMax=` 让它先被限住而不是把整机拖垮。数据库与 Web 同机时，最常见的原因是没给数据库设上限。

## 把方法固定下来：从外到内的排除顺序

前面几节合起来就是这张表。它规定**每一步只跑一条命令**，并给出「通过 / 不通过分别说明什么」（各层细节在第 5 章）：

| 层 | 一条命令 | 通了说明 | 不通查什么 |
| --- | --- | --- | --- |
| 0 我在对的机器上吗 | `hostname && pwd` | — | 先确认 SSH 的是哪台，再谈排障 |
| 1 单元在跑吗 | `systemctl status 单元名` | 进程活着 | status 三字段（第六节） |
| 2 它在听吗 | `sudo ss -ltnp` 里找目标端口 | 端口与 bind 对 | 配置里的监听地址（第 5 章） |
| 3 本机连得通吗 | `curl -sS http://127.0.0.1:端口/健康检查` | 应用本身正常 | journald 里这条请求与异常 |
| 4 外部到得了吗 | 从另一台机器 `nc -vz 公网IP 端口` | 网络路径通 | 超时查主机防火墙与安全组；拒绝查 bind |
| 5 Nginx 这层 | `sudo nginx -t` 加 error log 最后一行 | 代理与上游正常 | 按状态码分诊（第七节） |
| 6 机器资源 | `df -h && free -h && uptime` | 不是环境拖死的 | 三条主线（第八节） |
| 7 时间线 | `timedatectl` 后 `journalctl --since` | 时间可信 | 先修钟再回来 |

两层最容易被跳过。**第 0 层**不是玩笑：「服务起不来」的头号原因是 SSH 连到了另一台机器，一条 `hostname` 就能排除。**第 4 层**必须从另一台机器发起：本机 `curl` 自己的公网 IP 通，证明不了外部能进来（第 5 章那条实测局限），而从外面打一次能立刻区分「服务坏」与「路径不通」。

## 常见错误与排查

1. **现象：`journalctl -u myapp` 什么都没有，但服务确实在跑。** 原因：单元名不对（`-u` 要单元名，不是进程名）；或进程不是 systemd 起的（`nohup node app.js` 的输出在 `nohup.out`）；或单元把输出重定向了。怎么确认：`systemctl status myapp` 看单元是否存在，`systemctl cat myapp` 看 `StandardOutput=`。怎么修：让它由 systemd 管，或去指定文件里找。
2. **现象：磁盘 100%，但 `du` 一层层加起来远小于 `df`。** 原因：已删除但仍被打开的文件——目录项没了、句柄还在，空间不释放；或非 root 跑 `du` 静默漏掉读不到的目录。怎么确认：`sudo lsof +L1`、`sudo ls -l /proc/PID/fd | grep deleted`。怎么修：重启握着句柄的进程，而不是继续找大文件。
3. **现象：`logrotate` 配了 `size 10M`，文件 800 MB 还没切。** 原因：`size` 与时间间隔互斥且一天最多处理一次；也可能它根本没跑。怎么确认：`sudo logrotate -d /etc/logrotate.conf` 读演练输出，`systemctl status logrotate.timer`（或 cron 里那条）确认调度。怎么修：要「大到就切」用 `maxsize`，要当场验证用 `-f`。
4. **现象：轮转之后新日志一直空着。** 原因：进程还握着旧句柄。怎么确认：`ls -l /proc/PID/fd` 看它打开的是不是 `access.log.1`。怎么修：加 `postrotate` 发 `USR1` 让它重开（配 `sharedscripts`）——**Nginx 重开日志用 USR1，不是 HUP**（第 3 章信号一节讲过区别）。
5. **现象：502 一直在，重启 Nginx 之后还是 502。** 原因：错不在 Nginx。怎么确认：error log 里 `connect() failed` 括号里的错误号——`111` 是没进程在听、`13` 是权限、`2` 是 socket 路径不存在；再用 `ss -ltnp` 与 `systemctl status` 复核上游。怎么修：修上游或改 `proxy_pass` 目标。**依据是那个错误号，不是猜。**
6. **现象：A 机的请求比 B 机的处理「早」了 3 分钟。** 原因：两台时钟没同步，或一台显示时区不同但存的是 UTC（差 8 小时就是这种）。怎么确认：两台各跑 `timedatectl` 与 `date -u`，比较后者。怎么修：接到同一时间源，然后**用 UTC 关联、用本地时区阅读**，别靠肉眼换算。

## 练习

<Exercise title="练习 1 · 磁盘满了，但大文件不在你以为的地方" difficulty="基础">

`df -h /` 显示 `/dev/vda1 40G 38G 0 100% /`。你依次跑了三条命令（**为本题造的示例输出**）：

```text
$ sudo du -x --max-depth=1 / 2>/dev/null | sort -n | tail -5
52000   /var
184000  /usr
268000  /opt

$ sudo journalctl --disk-usage
Archived and active journals take up 3.9G in the file system.

$ sudo docker system df
Images        31 total, 4 active   SIZE 11.2GB   RECLAIMABLE 9.8GB
Build cache   240                  SIZE 4.1GB    RECLAIMABLE 4.1GB
```

1. 加起来对不上 38 GB，最该怀疑的两件事是什么？
2. 先做哪个清理动作？给出顺序和理由。
3. 清完之后，为了防止一周后又满，要改哪两处配置？

<template #answer>

1. 第一是**已删除但仍被打开的文件**：`du` 数目录项、`df` 数块占用，两者对不上是它的典型特征，用 `sudo lsof +L1` 确认。第二是 **`du` 没算全**：`-x` 不跨文件系统，所以独立挂载的数据盘、以及 `/var/lib/docker` 若在别的挂载点上就不在这张表里；另外没加 `sudo` 时会静默漏掉读不到的目录。
2. 顺序是**先收缩 journald，再清 Docker 的镜像与构建缓存，`--volumes` 单独判断**。`sudo journalctl --vacuum-size=500M` 零风险（官方支持的收缩方式），立刻释放约 3.4 GB。镜像与缓存用 `docker image prune -a`、`docker builder prune`，都不碰数据。`docker system prune --all --volumes` 会删卷，而卷里通常是数据库文件——**必须先确认备份**才能跑。`lsof +L1` 找到的进程，处理办法是重启它而不是删文件。
3. 两处：journald 设 `SystemMaxUse`（改完 `systemctl restart systemd-journald`）；Docker 给容器日志设 `max-size`/`max-file`（`daemon.json` 或 compose 的 `logging`），否则 stdout 日志无限增长。再加一条监控：`df -h` 阈值 85% 报警（第 6 章那个脚本挂 cron）。**磁盘满从来不是「突然」，是一周里慢慢长满而没人看。**

</template>

</Exercise>

<Exercise title="练习 2 · 这个「慢」该由谁负责" difficulty="进阶">

站点偶发很慢。用第 7 章的 `log_format perf` 采到 5 行（**为本题造的示例**；rt=整条请求耗时，urt=上游耗时）：

```text
GET /api/orders  200  rt=3.204 urt=3.201 us=200
GET /api/orders  504  rt=60.001 urt=-       us=-
GET /app.js      200  rt=2.900 urt=-        us=-
GET /api/cart    200  rt=2.401 urt=0.180    us=200
GET /api/login   200  rt=1.150 urt=1.149    us=200
```

1. 逐行判断「慢在后端」还是「慢不在后端」，并说出你依据的是哪个差值。
2. 第 1 行的 3.2 秒和第 2 行的 504 是同一个根因吗？下一步各查什么？
3. 第 3 行最有意思：一个 200 的静态文件请求也要 2.9 秒。列出三个可能原因，以及各自对应的验证命令。

<template #answer>

1. 判据是 **`rt - urt`**，不是绝对值。① 差 0.003 → **慢在后端**。② `urt=-` 且 504：不是慢，是上游没响应，走 502/504 分诊。③ `urt=-` 但 200 且是静态文件：与上游无关 → **慢不在后端**。④ 差 2.2 秒而上游只用 0.18 → **慢不在后端**，大头在 Nginx 到客户端这一段。⑤ 差 0.001 → **慢在后端**。这五条一起看就明白：先分桶再优化，否则你会去给 `/api/cart` 加索引，而它根本不慢。
2. 不一定同源，但可能在同一条链的两个阶段：第 1 行说明上游处理 `/api/orders` 本身要 3.2 秒（查慢查询、`EXPLAIN`、连接池等待）；第 2 行说明同一接口有时**完全不返回**直到 `proxy_read_timeout` 到点（查锁等待、外部依赖没有超时、连接池耗尽导致排队）。分别取两份证据：应用侧的耗时分解（数据库 vs 代码），以及那 60 秒里数据库在忙什么（`pg_stat_activity` 里等锁的语句）。
3. 三个方向：**一、传输而不是处理**——文件大或链路慢，rt 含发送时间；验证：`curl -o /dev/null -s -w '%{time_total} %{size_download}\n'` 在服务器本机与外部各跑一次，两个数一比就知道是不是外部链路。**二、Nginx 排队或磁盘慢**——验证：error log 有没有 `Too many open files`，`iostat -x` 看 `%util`。**三、前面还有一层缓存或 TLS 握手算进 rt**——验证：`curl -v` 看连接与 TLS 各阶段耗时（第 5 章那条 `-v` 分解）。**这一行的价值就是提醒你别看到 rt 大就去查数据库。**

</template>

</Exercise>

<Exercise title="练习 3 · 服务在崩溃循环里，日志却「什么都没有」" difficulty="挑战">

一次部署之后，`systemctl status myapp` 长这样（**为本题造的示例**）：

```text
     Active: activating (auto-restart) (Result: exit-code) since Sun 2026-10-18 10:12:01 UTC
   Main PID: 2211 (code=exited, status=203/CHDIR)

$ journalctl -u myapp --no-pager -n 3
Oct 18 10:12:01 vps systemd[1]: Started My Node App.
Oct 18 10:12:01 vps systemd[1]: myapp.service: Main process exited, code=exited, status=203/CHDIR
Oct 18 10:12:01 vps systemd[1]: myapp.service: Failed with result 'exit-code'.

$ ls -l /srv
drwxr-xr-x 4 deploy deploy 4096 Oct 18 09:58 releases
```

单元文件里有 `User=deploy`、`WorkingDirectory=/srv/app/current`、`ExecStart=/usr/bin/node /srv/app/current/server.js`。

1. 「日志里没有任何应用异常」这件事本身说明什么？给出推理。
2. 根因是什么？你打算怎么**确认**而不是直接改？
3. 修好之后，怎么让这次故障不以「重启三次就好了」收场？说出要补的三件事。

<template #answer>

1. 说明**程序一行都没执行**。`status=203/CHDIR` 是「带阶段名」的形式，属于 systemd 在 exec 阶段失败——它发生在切 `WorkingDirectory` 时，还没轮到 `ExecStart` 里的 node，所以 journald 里只有 systemd 的三行（该页的编号表本章未核对）。`Active: activating (auto-restart)` 则是 `Restart=` 与 `StartLimit*` 在起作用：它在崩溃循环里，不是「挂了没人管」。
2. 单元写 `/srv/app/current`，而 `ls -l /srv` 里只有 `releases`——**没有 `app`，更没有 `current` 软链**。这次部署用的是 `releases/<时间戳>` + `current` 软链的发法，而软链没建（或建在另一台机器上）。确认靠三条而不是猜：`ls -ld /srv/app/current` 看它在不在；`namei -l /srv/app/current` 逐段看每一级是否存在、能否穿过（第 2 章那条工具正用在这里）；`sudo -u deploy cd /srv/app/current` 用服务账号身份复现，排除「属主/权限」与「不存在」两种可能。
3. **一、把部署脚本的收尾变成断言**：切完软链跑一次 `curl -sS http://127.0.0.1:端口/健康检查`，不通就让部署失败并**保留旧软链**（回滚而不是半上线，见[发布与回滚](/devops/release-and-rollback)）。**二、让失败可见**：单元加 `OnFailure=` 指向通知服务，或监控 `systemctl is-active` 报警——崩溃循环能静默转很久，只因为它只写进 journald 而没人看。**三、把证据留在案并写进清单**：`journalctl -u myapp --since "-1h"` 存成事故文件，接管清单加一条「部署后必须验证软链与健康检查」。

</template>

</Exercise>

## 官方文档与延伸阅读

站内衔接：`ss`/`curl -v`/分层链与「自连证明不了外部可达」在[网络诊断与防火墙](/linux/networking)；单元指令、`daemon-reload`、信号在[进程、信号与 systemd](/linux/processes-and-systemd)；`log_format` 与 rt/urt 的定义在 [Nginx](/linux/nginx)；`namei -l` 与权限在[用户与权限](/linux/users-and-permissions)；沦陷后的痕迹排查在[服务器安全](/linux/server-security)；备份脚本与 cron 在[Shell 脚本](/linux/shell-scripting)。

- [journald.conf(5)（Debian bookworm 手册页）](https://manpages.debian.org/bookworm/systemd/journald.conf.5.en.html)——**已核实**：`Storage=auto` 的两种落点、`SystemMaxUse` 为「文件系统 10%、上限 4 GB」、`SystemMaxFileSize` 为「1/8 且上限 128 MB」、`MaxRetentionSec` 默认 `0`、限速 30 秒 10000 条。本章 journald 默认值以此页为准。
- [logrotate.conf(5)（Debian bookworm 手册页）](https://manpages.debian.org/bookworm/logrotate/logrotate.conf.5.en.html)——**已核实**：`rotate` 默认 0、`size` 与时间间隔互斥、`maxsize`/`minsize` 的分工、默认 `nomissingok` 与 `ifempty`、`copytruncate` 不创建新文件、同一日志一天不处理两次、出错以非零码退出。
- [systemd.service(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) 与 [systemd.time(7)](https://www.freedesktop.org/software/systemd/man/latest/systemd.time.html)——`Restart=`/`StartLimit*`/`TimeoutStartSec`，以及 `--since`/`--until` 接受的时间表达式语法。
- [Nginx ngx_http_log_module](https://nginx.org/en/docs/http/ngx_http_log_module.html)——`$request_time` 与 `$upstream_response_time` 的准确定义（rt/urt 分桶的依据）。
- [Debian Reference 手册](https://www.debian.org/doc/manuals/debian-reference/)——`df`/`du`/`lsof`/`dmesg`/`free` 的行为，以及 `lsof`、`procps` 在最小安装里可能需要额外装。本章服务器端命令**均未在本机执行**；本机实测只涉及文本日志的统计管道，性质见第七节那个 callout。

## 下一章

[阶段项目：从零接管一台 VPS](/linux/project) 把前九章按真实顺序串成一次可复述的接管流程：清点入口、建用户与密钥、装运行时、写单元、配 Nginx 与证书、收紧防火墙、部署与回滚、把日志和备份挂上定时器，最后用一次演练过的故障定位收尾。上面那张排除顺序表，就是那个项目的验收方法。
