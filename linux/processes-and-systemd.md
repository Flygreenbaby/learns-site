# 进程、信号与 systemd：谁启动它、谁盯着它、谁替它收尸

你在 SSH 里跑 `node app.js`，合上笔记本吃顿饭，回来服务没了——进程跟着终端一起死。改成 `nohup node app.js &`，服务活了，但你找不到它，重启也不回来。于是写第一个 systemd 单元：`Type=simple`，`systemctl start` 返回成功，第一个请求却 503——systemd 说的「已启动」只意味着 `fork()` 成功。第二天改了 `Environment=` 那行，`restart` 三次都不生效，因为改 unit 必须 `daemon-reload`。

这一章讲四件事：**进程是什么（谁负责它的生死）、信号怎么送与谁不能拦、systemd 作为 PID 1 做了什么、unit 文件每条指令的语义**。前置：[用户与权限](/linux/users-and-permissions)。

**诚实声明**：本机是 Windows 10 + Git Bash，没有 systemd，`ps` 不支持 `-j`（实测原文 `ps: unknown option -- j`），`/proc` 是 MSYS 合成的。Linux 侧输出一律写成预期结果并标注**未在本机验证**；只有信号编号、`128 + 编号` 退出码、SIGPIPE、`trap`、`jobs` 这类 POSIX/bash 层面的规律做了真机验证。请配合 WSL2 使用本章。

## 进程是程序的一次运行实例：PID、PPID 与进程树

内核眼里的进程是 `task_struct`：一段虚拟地址空间、一组文件描述符、一个 UID/GID、一个信号掩码、一个状态，以及**指向父进程的指针**。「启动进程」在 Linux 上是两步：`fork()` + `execve()`。观察用 `ps -ejH`（树形）与 `ps -eo pid,ppid,user,stat,rss,etime,cmd`。

预期输出（**未在本机验证**，Linux 的 `ps` 来自 `procps` 包）：

```text
  PID   PPID USER     STAT   RSS      ELAPSED CMD
 18734      1 deploy   Ssl    62140  01:22:33   /usr/bin/node /srv/app/server.js
 19001  18734 deploy   Z          0  00:00:12   [sh] <defunct>
```

最后一行 `STAT=Z`、`RSS=0`、`<defunct>` 是**僵尸**；`PPID=1` 表示由 systemd 直接管。

- **孤儿**：父先死子还活着，被 PID 1（或 `subreaper`）收养，继续跑，不用处理。
- **僵尸**：子已终止、**父还没调 `wait()` 收结果**。内核保留它的表项（退出码、时间）等被取走，于是 `STAT=Z`、`RSS=0`。**`kill -9` 对僵尸无效**——要么让父进程 `wait`，要么杀父进程，僵尸被 PID 1 收养并立刻收尸。危害是 **PID 与进程表槽位耗尽**：攒到上千时 `fork` 失败，连 shell 都开不出来。

文档依据（已核实）：signal(7) 里 `SIGCHLD` 的默认动作是 **`Ign`**——孩子死了不会主动通知父进程；`SIGHUP`/`SIGTERM`/`SIGPIPE` 默认都是 `Term`。

## `ps` 怎么读：STAT 的每个字母，与 RSS/VSZ 的区别

找与杀用 `pgrep -af node` / `pkill -f 'node /srv/app'`（`-f` 匹配整条命令行）。

**`STAT` 是 `ps` 里唯一必须背下来的东西**（含义表出自 `ps(1)`，**未在本机验证**）：

| 状态 | 含义 | 运维推理 |
| --- | --- | --- |
| `R` / `S` / `D` | 可运行 / 可中断睡眠 / **不可中断睡眠** | `load average` 数 `R` 与 `D`；`D` 在等内核操作（磁盘 IO、NFS 卡死），**`kill -9` 无效**，信号投递不进去 |
| `Z` / `T` | 僵尸 / 被 `SIGTSTP`、`SIGSTOP` 停止 | `Z` 见上；`T` 说明有人按过 `Ctrl-Z` 或 `kill -STOP` |

附加标志：`s` 会话首进程、`l` 多线程、`+` 前台组（决定 `Ctrl-C` 打到谁）——正常 Node 服务的 `STAT` 应是 `Ssl`。

**RSS 与 VSZ**（KiB）：`VSZ` 是**地址空间**总量（代码、库、堆、mmap、预留 arena 全算），JVM/Go/Node 天生虚高；`RSS` 是真正驻留物理内存的部分，但含共享库页且多进程各算一遍，要独占量看 `PSS`。

## `top`：两个数字的正确读法

`top` 来自 procps，`htop` 需另装（Debian 12 默认没有）。批处理形态用 `top -b -n 1`。

**坑一：`%CPU` 是单核口径。** 一核跑满是 `100%`，四线程满载是 `400%`（8 核机器上 600% = 75% 总占用）。头部 `%Cpu(s)` 是所有核平均，按 `1` 展开成每核一行。

**坑二：`load average` 是三个数，且不等于 CPU 忙。** 它是 1/5/15 分钟的平均「可运行 `R` + 不可中断 `D`」任务数。**必须除以核数**（`0.42` 在 1 核是 42% 忙、8 核是 5%，先看 `nproc`）；三个数一起看趋势（`0.42, 0.51, 0.55` 在缓解，`3.1, 1.2, 0.6` 是刚出事在回落）；**load 高、`us`+`sy` 低、`wa` 高 → IO 瓶颈**，去找 `D` 状态进程。注意容器里 `/proc/loadavg` 显示的是**宿主机的数字**。

## 作业控制、优先级与终端断开

作业控制是**交互式 shell 的特性**：shell 为每个管道建一个进程组，并维护一张作业表。

```bash
sleep 100 &        # 后台，输出 [1] 24381（作业号 + PID）
jobs -l            # [1]+  24381 Running                 sleep 100 &
fg %1              # 拉回前台；bg %1 让被停住的继续（bg 会发 SIGCONT）
disown %1          # 从作业表摘掉：shell 退出时不再给它发 SIGHUP
nice -n 10 node backup.js    # -20 最高 … 19 最低，默认 0；ps 里那列叫 NI
renice -n 5 -p 18734         # 改已运行进程（服务重启后效果消失）
```

作业表我在本机（Git Bash）真跑过：`jobs -l` 打出 `[1]-  284 Running  sleep 1 &` 与 `[2]+  286 Running  sleep 1 &` 两行，`wait -n` 返回 0。诚实标注：作业控制在非交互脚本里是残废的，`fg`/`bg` 依赖终端，脚本里通常只有 `&` 与 `wait`。

优先级：**普通用户只能把自己的进程 nice 调大，调小要 root**；**批量任务的元凶往往是 IO 不是 CPU**，备份脚本标准前缀 `ionice -c3 nice -n 19 tar ...`，systemd 侧用 `Nice=`/`IOSchedulingClass=` 固化。按键（signal(7) 已核实）：`Ctrl-C` = `SIGINT`(2)，`Ctrl-Z` = `SIGTSTP`(20)，恢复用 `SIGCONT`(18)。`Ctrl-Z` 停住的进程是 `T` 状态，**挂在内存里、端口还在 listen 却不处理请求**——这就是「我挂后台了，为什么网站卡住」的答案。

**终端断开为什么杀进程**：`sshd` 分配的 pty 是**控制终端**，你敲的命令属于前台进程组；终端关闭时内核给该组发 `SIGHUP`（默认 `Term`，已核实），随后 pty master 关闭，再往 stdout 写就得到 `EIO`/`SIGPIPE`。活下来的办法按可靠性排：`cmd &`（仍属该会话，**不可用**）、`disown`（shell 退出时不发 SIGHUP）、`nohup cmd > app.log 2>&1 &`（把 SIGHUP 设为忽略，应急可以）、`tmux`/`screen`（父进程变成 tmux server）。这四者**都不会开机自启**——唯一正确答案是 systemd 单元；纪律：**要跑超过一天的东西都写成 unit**。

## 信号：一张编号表与三条纪律

信号是内核的异步通知，本质是「一个 bit 加一次唤醒」。发送用 `kill`（名字有历史误会，它只是发信号）：

```bash
kill 24381               # 不带信号名就是 SIGTERM(15)；kill -l SIGTERM 查编号
kill -HUP 1234           # nginx 用它重载配置
kill -0 24381            # 不发信号，只探测进程存在与可发送权限
kill -TERM -24381        # 负数 = 进程组：对整个组发（已从 signal(7) 核实）
pkill -TERM -f 'node /srv/app'
```

`kill -0` 实测（Git Bash，bash 内建 `kill`）：

```text
-- kill -0 alive pid -> exit=0
linux/.scratch/run4.sh: line 74: kill: (283) - No such process
-- kill -0 after death -> exit=1
```

这是判断进程活着没的最轻办法。注意：**`Operation not permitted` 说明进程存在但不属于你（上一章），`No such process` 说明 PID 不存在或已被复用。**

Linux x86 信号表，编号与默认动作**已从 signal(7) 核实**（链接见文末）：

| 信号 | 编号 | 默认 | 可捕获 | 运维含义 |
| --- | --- | --- | --- | --- |
| `SIGHUP` | 1 | Term | 是 | 终端断开；守护进程惯例是「重载配置」（nginx、rsyslogd） |
| `SIGINT` / `SIGQUIT` | 2 / 3 | Term / **Core** | 是 | `Ctrl-C` / `Ctrl-\`；Go、JVM 借 QUIT 输出栈 dump |
| `SIGKILL` | 9 | Term | **否** | 内核直接终止，进程没有一行代码能执行 |
| `SIGUSR1` / `SIGUSR2` | 10 / 12 | Term | 是 | 应用自定义：nginx 重开日志、Node 开 inspector |
| `SIGPIPE` | 13 | Term | 是 | 往已关闭的管道写；`yes` 的退出码 141 就是它 |
| `SIGTERM` | 15 | Term | 是 | **礼貌停止的默认信号**，systemd 停服务先送它 |
| `SIGCHLD` | 17 | **Ign** | 是 | 子进程状态变化；默认被忽略，这正是「要主动 wait」的原因 |
| `SIGCONT` / `SIGSTOP` / `SIGTSTP` | 18 / 19 / 20 | Cont / Stop / Stop | 是 / **否** / 是 | 恢复 / 冻结 / `Ctrl-Z`。STOP 不可忽略 |

**手册关键原文（已核实）**："The signals SIGKILL and SIGSTOP cannot be caught, blocked, or ignored." 这就是 `kill -9` 之后进程一定死、而它也一定来不及清理的原因。段错误 `SIGSEGV`(11)、实时信号（32 起，可排队可带值）见同一张表。

关于编号有一个平台警告。本机 `kill -l` 拿到的表**与上表不同**：

```text
-- kill -l SIGTERM -> 15 ; SIGKILL -> 9 ; SIGPIPE -> 13 ; SIGSTOP -> 17 ; SIGUSR1 -> 30
```

`SIGTERM=15`、`SIGKILL=9`、`SIGPIPE=13` 与 Linux 一致（POSIX 定死的低位编号），但 **`SIGSTOP` 本机报 17、Linux 是 19；`SIGUSR1` 本机报 30、Linux 是 10**——MSYS 自己排了一套。**所以别用数字写信号**：写 `kill -TERM` 而不是 `kill -15`。

`128 + 编号` 这条约定实测四组：

```text
-- default TERM -> wait exit=143
-- SIGKILL    -> wait exit=137
-- SIGINT     -> wait exit=130
-- 'yes | head -n 1' PIPESTATUS=141 0
```

**143（TERM）**是 `systemctl stop` 或有人礼貌要求退出，属正常停止；**137（KILL）**是强杀，最常见来源是 **OOM killer**（`journalctl -k` 里有 `Killed process ... (node)`）——**不是程序崩了，是被外部处死了**；**130（INT）**有人按了 `Ctrl-C`；**141（PIPE）**本机真跑出来了：`yes` 无限写、`head -n 1` 读够一行就退出并关闭管道，`yes` 下一次写触发 SIGPIPE。

本机还做了一个 `trap` 实验：`trap '' TERM` 的后台进程收到 SIGTERM 后**照常跑完并输出 `survived-SIGTERM`**，验证「SIGTERM 可被忽略」，也解释 `nohup` 的做法就是把 `SIGHUP` 设成忽略。平台差异必须记录：本机 `bash -c "trap '' SIGKILL"` **没有报错**，与 Linux 上 bash 明确拒绝不同——所以**「trap 拦不住 SIGKILL」只能按 signal(7) 原文陈述，不能拿本机结果当证据**。

### 为什么 `kill -9` 是最后手段

`SIGKILL` 意味着进程没机会执行任何一行清理代码：缓冲区不 flush（日志尾部丢失、连接异常断开导致事务回滚，对照[事务与并发](/database/transactions)）；PID 文件残留（下次启动判定「已在运行」而拒绝）；**Linux 没有级联杀**，子进程变孤儿继续占端口（`EADDRINUSE`）；systemd 视角是异常退出，消耗 `StartLimitBurst`。**正确顺序永远是**：`kill -TERM` → 给合理超时（停接新请求、处理完在途再退出，即优雅关闭，[部署那一章](/backend/docker-and-shutdown)讲应用侧做法）→ 确认还在 → 才 `kill -KILL`。systemd 自动化了这个顺序：先发 `KillSignal=`（默认 SIGTERM），等 `TimeoutStopSec=` 才升级。

## `/proc`：进程状态的一面镜子，也是磁盘满的线索

`/proc` 是内核导出的虚拟文件系统，`/proc/数字` 就是那个 PID 的目录。**以下均为 Linux 行为，未在本机验证**——本机 `/proc/self/status` 里出现 `Name: head` 配 `Pid: 324` 这种自相矛盾的值，不要拿它做任何判断。

- `cmdline`（NUL 分隔）：`tr '\0' ' ' < /proc/18734/cmdline` 拿完整命令行，`ps` 截断时用它。
- `status`：`State`、`PPid`、`Uid`/`Gid`、`Threads`、`VmRSS`、`CapEff`——「这进程是谁、几个线程、有没有特权能力」。
- `cwd`：`ls -l /proc/18734/cwd` → **相对路径的日志到底写在哪**；`exe` 看它跑的是不是已删除的旧二进制。
- `fd/`：打开的文件描述符目录，**磁盘满排查的核心**：进程握着已 `rm` 的文件 inode，目录项没了但磁盘块还在计数。判据是 `df -h` 98% 而 `du -sh /*` 远不到 → `ls -l /proc/18734/fd | grep deleted` 或 `lsof -nP +L1`。修法是**让持有句柄的进程重开日志**：`kill -USR1`（nginx）、`systemctl restart rsyslog`。
- `limits`、`oom_score`、`cgroup`：对应 `LimitNOFILE=`、OOM 打分、是否在容器里。系统级还有 `loadavg`、`meminfo`、`uptime`（判断有没有偷偷重启过）。

## systemd 是什么：PID 1、单元与依赖

`systemd` 是第一个用户态进程（PID 1，`ppid=0`），负责服务生命周期、按依赖顺序拉起、socket 激活、timer、journald、登录会话、cgroup 资源控制。核心抽象是**单元（unit）**，类型记这些：`.service`（守护进程或一次性任务）、`.timer`（定时，替代 cron）、`.socket`（systemd 持有监听 socket，来连接才激活）、`.target`（一组单元的名字，如 `multi-user.target`）、`.mount`（由 `/etc/fstab` 生成）。

**依赖与顺序是两组完全不同的指令**，这是 unit 文件里最容易写错的一处（归属 `systemd.unit(5)`，已核实）：

- `After=` / `Before=` 只管**顺序**：只保证先后，不保证对方一定起。只写 `After=network-online.target`，网络挂了服务照起。
- `Requires=` 硬依赖：对方没起或中途挂 → 本单元起不来/被停。`Wants=` 软依赖：尽量一起拉起，对方失败不影响自己。
- `BindsTo=` 比 `Requires` 更强：对方消失本单元立即停止。`Requisite=` 只检查不拉起。`Conflicts=` 起 A 就停 B；`PartOf=` 停整体时跟随操作。

顺序与依赖要**一起写**：`After=network-online.target postgresql.service` + `Wants=network-online.target` + `Requires=postgresql.service`。`enable` 只让单元开机进入默认 target，实现是在 `WantedBy=` 目录建符号链接，跟「服务能不能起来」无关；`disable` 删链接；`mask` 链到 `/dev/null`，**`enable` 也救不回来**（`systemctl unmask` 解除）。

## unit 文件逐条指令：一个可抄的 Node 服务单元

位置与优先级（高覆盖低）：`/etc/systemd/system/` > `/run/systemd/system/`（重启即失）> `/usr/lib/systemd/system/`（**包提供的，不要改**）。改包提供的单元用 `systemctl edit 名字` 生成 drop-in `名字.service.d/override.conf`，合并而不复制，升级不被覆盖。

```ini
[Unit]
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300                 # 注意：这两条属于 [Unit]，不是 [Service]
StartLimitBurst=5                         # 300 秒内失败 5 次就不再重试，进入 failed

[Service]
Type=simple                               # 见下面的 Type 说明
User=deploy                               # 以该 UID 运行（上一章的模型）
WorkingDirectory=/srv/app                 # 相对路径与日志目录的基准
Environment="NODE_ENV=production"
EnvironmentFile=/etc/myapp/env
ExecStart=/usr/bin/node /srv/app/server.js
Restart=on-failure                        # 崩溃自动拉起
RestartSec=5
TimeoutStopSec=20                         # TERM 之后最多等 20 秒才升级 KILL
KillMode=mixed                            # TERM 给主进程，升级 KILL 时给整个 cgroup
LimitNOFILE=65536                         # RLIMIT_NOFILE，对应 /proc/PID/limits
UMask=0027                                # 服务新建文件的权限基准
ProtectSystem=full                        # /usr、/boot、/etc 只读
ProtectHome=true                          # 看不见 /home、/root
ReadWritePaths=/srv/app/logs /var/log/myapp   # 硬化之后再放行需要写的路径

[Install]
WantedBy=multi-user.target
```

### `Type=` 决定「启动成功」这四个字的含义

这是全章最容易出事的一条指令。`systemd.service` 手册的判定原文已核实（引号为原文，**未在本机运行验证**）：

- `simple`（默认）："consider the unit started immediately after the main service process has been forked off"——**只表示 `fork()` 返回了**，端口没监听它也不知道，必须靠外部健康检查。
- `exec`：主进程 `execve()` 成功后才 started，挡住「路径写错、不可执行」，但仍不代表就绪。
- `forking`："consider the unit started immediately after the binary that forked off by the manager exits." 传统 daemon；**必须给 `PIDFile=`**，否则停不掉。
- `oneshot`："service manager will consider the unit up after the main process exits." 一次性任务；`RemainAfterExit=yes` 才让后续依赖认为已完成。
- `notify`：等服务发 `READY=1`——**真正的应用级就绪**，应用要调 `sd_notify`（`systemd-notify --ready` 或 Node 的 `sd-notify`）。

「`start` 成功但 503」就出在 **`Type=simple` 的成功不等于就绪**。按成本递增：`Type=exec` → `Type=notify` → 编排层用就绪探针查 `/healthz`（见[部署到 VPS](/devops/deploy-to-vps)）。

### 前缀字符、重启限流、环境与硬化

systemd **不经过 shell** 执行 `ExecStart`：没有 glob、没有 `$VAR` 展开、没有管道，且要绝对路径。前缀字符（已核实）：`-` 该步退出码被记录但不影响结果；`+` 以**完整特权**执行、忽略 `User=`；`:` 用 shell 解释整行（**要管道或 glob 就明确写 `/bin/sh -c '...'`**）。

`Restart=` 取值（已核实）：`no`（默认）、`on-success`、`on-failure`、`on-abnormal`、`on-watchdog`、`on-abort`、`always`。差别在什么算失败：**`on-failure` = 非零码 + 被信号杀（不含 `systemctl stop` 触发的 TERM）+ 超时 + watchdog**，生产常用它。`RestartSec=` 默认 **100ms**：启动即崩的服务会以 100ms 连续重试，很快撞到 `StartLimitBurst` 进入 `failed` 不再拉起。**`StartLimitIntervalSec`/`StartLimitBurst` 属于 `[Unit]` 段**，放错段会报 `Unknown key name` 并忽略。

环境与硬化最常踩的三条：`User=deploy` 让 `$HOME` 变成该用户家目录，但 **`~` 不会被 systemd 展开**，`PATH` 也不继承你的 shell → `ExecStart` 一律绝对路径；`WorkingDirectory=` 缺省是 `/`，相对路径的日志就写成 `/error.log` 这类事故。`ProtectSystem=strict` 整盘只读、`full` 是 `/usr`+`/boot`+`/etc` 只读，要写得配 `ReadWritePaths=`；`ProtectHome=true` 看不见 `/home`；`PrivateTmp=true` 解释「文件明明写了却在 `/tmp` 找不到」——**这一组就是上一章「权限都对却 `Operation not permitted`」的元凶**。`EnvironmentFile=` 不带 `-` 就必须存在，格式 `KEY=VALUE`，**不是 shell 脚本**。

**改完 unit 文件必须 `systemctl daemon-reload`。** 不加它 systemd 用的还是内存里那份旧解析结果，于是「文件改了、`systemctl cat` 也看到新的，行为却是旧的」——`cat` 读磁盘，`start/restart` 用运行时状态。`systemctl edit` 会自动 reload，手工 `cp` 不会。

## `systemctl` 与 `journalctl`：够用的一组命令

```bash
systemctl status myapp.service     # 最有用：状态 + 最近日志 + Main PID + CGroup 树
systemctl start|stop|restart myapp
systemctl reload myapp             # 只在定义了 ExecReload 时有效
systemctl is-active myapp; systemctl is-enabled myapp     # 退出码可判断（active=0）
systemctl enable --now myapp       # 开机自启 + 立刻启动，一条做完两件事
systemctl mask myapp / unmask myapp
systemctl daemon-reload            # 改过 unit 文件之后
systemctl list-dependencies myapp --reverse    # 谁依赖我（停它之前先看）
systemctl show myapp -p MainPID -p ActiveState # 脚本里取字段
systemctl reset-failed myapp       # 清掉 failed，限流计数才重新计时
```

`status` 的字段按此读（**预期结果**）：`Active` 里的 `(running)`/`(exited)`/`(failed)` 才是真实状态；`Main PID` 是 systemd 认的那个进程（`Type=forking` 没配 `PIDFile=` 时是错值，`stop` 停不掉）；**`CGroup` 树是找残留子进程最方便的地方**——`stop` 杀的就是这棵树，怎么杀由 `KillMode` 决定。

journald 是二进制结构化存储，落在 `/var/log/journal/`（持久）或 `/run/log/journal/`（内存）。

```bash
journalctl -u myapp -f                      # 跟随某服务，等价 tail -f，但不怕日志轮转
journalctl -u myapp --since "10 min ago" --until "2026-10-17 10:00"
journalctl -b                               # 本次开机；-b -1 是上一次开机（查意外重启！）
journalctl -p err -k                        # 优先级 ≥ error；-k 是内核消息（OOM 在这里找）
journalctl --vacuum-size=200M               # 立刻回收；--vacuum-time=7d 只留 7 天
```

**权限**：非特权用户默认只看自己的日志，要看服务日志就把人加进 `systemd-journal`（或 `adm`），比给它 `sudo` 安全。打满的根治在 `/etc/systemd/journald.conf` 的 `SystemMaxUse=500M`（**未在本机验证**，以 `man 5 journald.conf` 为准）。

## timer 与 cron：定时任务的两种世界

timer 是「一个 `.timer` 触发一个 `.service`」，两个文件放 `/etc/systemd/system/`：

```ini
# backup-app.timer
[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=600
Persistent=true
[Install]
WantedBy=timers.target

# backup-app.service
[Service]
Type=oneshot
User=root
Nice=19
IOSchedulingClass=idle
ExecStart=/usr/local/bin/backup-app.sh
```

配套：`systemctl enable --now backup-app.timer`、`systemctl list-timers --all`、`systemd-analyze calendar '*-*-* 03:15:00'`（先验证表达式）。`OnCalendar` 支持 `Mon,Fri 08:00`、`daily`、`*-*-* *:00/15:00`；`OnBootSec=`/`OnUnitActiveSec=` 是相对形式。

与 cron 的三点差别：**输出**——cron 默认给本地邮件，多数 VPS 没配 MTA，日志**静默消失**；timer 进 journald。**错过的任务**——cron 不补，`Persistent=true` 会补跑。**依赖与身份**——cron 没有依赖概念，且 `PATH` 只剩 `/usr/bin:/bin`（「手动跑得好、定时跑找不到命令」的根因）。**新任务优先 timer**，最硬的两条理由是「日志看得见」和「错过会补」。

## `systemd-analyze`：启动慢与「起不来」的第一手证据

`systemd-analyze blame`（每个单元耗时降序）、`critical-path`（谁挡住了谁，比 `blame` 有用）、`verify myapp.service`（拼错的指令、缺失的依赖）、`security myapp`（硬化项逐条评分）、`calendar '*-*-* 03:15:00'`（验证定时器表达式）。`blame` 的头名通常是 `systemd-networkd-wait-online.service`（几十秒）——等网络就绪的真实代价，不是 bug。回答「为什么开机 40 秒」要用 `critical-path`：最慢的那个可能在并行跑、不拖总时长。

<Callout type="unverified" title="本章哪些是预期、哪些有实据">

**未在本机验证（Linux 专有，以你机器上的 `man` 为准）**：`ps`/`top` 的列值与口径、`nohup`/`tmux` 对真实 SIGHUP 的效果、`/proc` 全部条目、`lsof +L1`、所有 systemd 指令与 `systemctl`/`journalctl`/`systemd-analyze` 的输出、`203/EXEC`/`217/USER` 状态码。

**本机（Windows 10 + Git Bash，bash 5.2.37，2026-10-18）真跑过的**：`kill -0` 与两句原文；`trap '' TERM` 后存活；`wait` 退出码 `143`/`137`/`130`；`yes | head -n 1` 的 `PIPESTATUS=141 0`；`jobs -l` 与 `wait -n`；`kill -l` 编号表（证明与 Linux 在 `SIGSTOP`/`SIGUSR1` 上不一致）；`ps` 不支持 `-j`；`/proc` 自相矛盾。POSIX/bash 层面的结论可迁移，其余请上真机。

**文档核实（WebFetch）**：[systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) 的 `Type=` 判定原文、`ExecStart` 前缀语义、`Restart=` 集合与 `RestartSec=` 默认 100ms；[signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html) 的编号表与默认动作表、SIGKILL/SIGSTOP 那句原文、`kill(-pid)` 面向进程组。

</Callout>

## 常见错误与排查

**1. 改了 unit、`restart` 了，配置还不生效。** 没 `daemon-reload`。确认：`systemctl cat myapp`（磁盘，新）与 `systemctl show myapp -p Environment`（运行时，旧）不一致。修：`systemctl daemon-reload && systemctl restart myapp`。

**2. `status` 显示 `code=exited, status=203/EXEC`。** `ExecStart` 路径不存在、不可执行，或 shebang 的解释器不存在——systemd 不经 shell，`ExecStart=node server.js` 一定失败。确认要用服务视角的 `ls -l /usr/bin/node`，不是你 shell 里的 `which node`。修：写绝对路径；nvm 装的要指到 `/home/deploy/.nvm/versions/node/.../bin/node`（见[软件包与运行环境](/linux/packages-and-runtime)）。**`217/USER` 则是另一回事：`User=` 的账号不存在**，用 `getent passwd 那个用户` 确认，按上一章建服务账号。

**3. `status` 显示 `start request repeated too quickly`。** 启动即崩（配置错、端口占用）撞了 `StartLimitBurst`。确认：`journalctl -u myapp -n 50`（多半第一行就是真错误）、`systemctl show myapp -p NRestarts`。修：**先修崩溃本身**；调试期加大 `RestartSec=`、提高 `StartLimitBurst=`（写在 `[Unit]`）；恢复用 `systemctl reset-failed myapp`。`address already in use` 的另一常见来源是有人在 tmux 里 `nohup` 手动起过一份。

**4. `/var/log` 被 journald 打满；或 `ps aux` 里几十个 `<defunct>`。** 前者是某服务把循环错误每秒数十行打到 stdout/stderr：确认 `journalctl --disk-usage`，修：`--vacuum-size=200M` + 在 `journald.conf` 设 `SystemMaxUse=`；**`rm /var/log/journal/*` 是错的**——空间可能不释放。后者是父进程没 `wait`：`ps -eo pid,ppid,stat,cmd | awk '$3 ~ /Z/'` 找到再 `ps -p 那个PPID`；**别 `kill -9` 清僵尸**，修父进程代码或 `kill -TERM 父进程` 让 PID 1 收养回收。

## 练习

<Exercise title="练习 1 · 读一段 ps 输出并下结论" difficulty="基础">

以下为本章式预期输出（**未在本机验证**）：

```text
  PID  PPID USER  STAT   RSS    VSZ  %CPU COMMAND
18734     1 root  Ssl   204800 1780000  198 node /srv/app/server.js
19001 18734 root  Z          0       0  0.0 [sh] <defunct>
 4412     1 mysql D       12000  300000  0.0 /usr/sbin/mysqld
```

回答：`1780000` 说明这个 Node 进程用了 1.78 GB 内存吗？`%CPU` 198 在 4 核机器上算满载吗？僵尸怎么清理？`mysqld` 的 `D` 为什么让 `kill -9` 失效，`load average` 会怎么表现？

<template #answer>

**`1780000` 是 VSZ（KiB），不是 RSS。** 表里 RSS 是 `204800`，约 200 MiB 真实驻留；VSZ 含 V8 预留地址空间与共享库映射，虚高是常态——**按 VSZ 判内存会误杀正常服务**。`%CPU` 是单核口径：`198` = 1.98 个核，4 核机器上约 50%，不算满载。

僵尸不该去「杀」：`kill -9 19001` 无效（只剩内核表项）。要处理的是父进程 `18734`——让它 `wait`（Node 侧监听子进程 `exit`），或重启父进程，之后僵尸被 PID 1 收养并立刻回收。

`D` 是**不可中断睡眠**：信号要等它回到用户态才投递，所以 `kill -9` 也杀不掉。`load average` 把 `D` 计入，于是「load 很高、CPU 空闲、`wa` 高」——**IO 瓶颈不是 CPU 瓶颈**，下一步查 `iostat -x 1`。

</template>

</Exercise>

<Exercise title="练习 2 · 把 nohup 服务改写成 systemd 单元" difficulty="进阶">

现状：`nohup node server.js > log.txt 2>&1 &` 跑了三个月。要写成单元：以 `deploy` 跑、开机自启、崩溃自动重试但不要无限快速重试、日志进 journald、看不见别人的 `/home`、能写 `/var/log/myapp`（属组 `adm`、目录 `2775`、文件 `640`）。写出单元、上线步骤，以及怎么验证「改 unit 忘了 reload」。

<template #answer>

```ini
[Unit]
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=exec
User=deploy
WorkingDirectory=/srv/app
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
UMask=0027
ProtectHome=true
ReadWritePaths=/var/log/myapp

[Install]
WantedBy=multi-user.target
```

要点：`Type=exec` 比 `simple` 多挡住「不可执行」这类失败，但**仍不代表就绪**（要更严格就 `Type=notify` + 应用发 `READY=1`）。`ProtectHome=true` 满足要求，**但代码若从 `/home/deploy/.config` 读配置就读不到了**，改用 `EnvironmentFile=` 注入。文件要 `640` 靠 `UMask=0027`（`0666 & ~027 = 640`，上一章的算法）；`deploy` 不在 `adm` 组就写不进 `/var/log/myapp`，所以先 `usermod -aG adm deploy` 再重启。

上线顺序：`pgrep -af 'node server.js'` 找到手工起的 → `kill -TERM <PID>`、`ss -lntp | grep 3000` 确认端口释放 → 放单元文件 → `systemctl daemon-reload` → `systemctl enable --now myapp` → `journalctl -u myapp -n 20` → 演练崩溃拉起：`kill -TERM $(systemctl show -p MainPID --value myapp)`，`sleep 6; systemctl is-active myapp` 预期 `active`。

验证「忘 reload」：把 `RestartSec=99` 写进文件后 `sudo systemctl restart myapp`，再 `systemctl show myapp -p RestartUSec`——**仍是旧值 5s**，这就是磁盘与运行时脱节的证据；`daemon-reload` 后再 `restart` 才变 99s。

</template>

</Exercise>

<Exercise title="练习 3 · 退出码与 SIGPIPE 的误判" difficulty="进阶">

本章实测 `yes | head -n 1` 得到 `PIPESTATUS=141 0`。回答：

1. `141` 怎么算出来的？谁收到信号、谁没收到？
2. CI 里 `make 2>&1 | grep -v warning | tee build.log`，如果 `make` 失败会怎样？给出两种修法。
3. `sleep 100 & kill -TERM $!; wait $!` 的退出码是多少？这个数在生产上怎么反推？

<template #answer>

1. `141 = 128 + 13`，13 是 `SIGPIPE`（signal(7) 核实，本机 `kill -l SIGPIPE` 也报 13）。收到信号的是 `yes`：它继续往 `head` 已关闭的管道写，内核在写入时投递 SIGPIPE，默认 `Term`，于是终止；`head` 正常退出（0），所以是 `141 0`。若进程忽略 SIGPIPE，写操作返回 `EPIPE` 而不是被杀——这是应用层看到 `broken pipe` 而进程没死的原因。

2. **`make` 的失败被完全吞掉**：管道退出码只取最后一个命令（本机实测 `bash -c 'exit 3' | cat` → `$?=0`、`PIPESTATUS=3 0`），`grep` 与 `tee` 都成功，CI 绿灯而构建挂了。修法：`set -o pipefail`（实测之后 `$?=3`）或显式判断 `${PIPESTATUS[0]}`。

3. **`143 = 128 + 15`**（SIGTERM），本机实测就是这个值：shell 用 `128 + 编号` 表示「孩子是被信号带走的」；同理实测 `kill -9` → `137`、`Ctrl-C` → `130`。**价值在反推**：`systemctl status` 看到 `code=killed, status=137/KILL` 时第一反应应该是 OOM killer 或外部强杀——去 `journalctl -k -b` 找证据。但别拿本机 `kill -l` 的编号表做反推：本章已实测它与 Linux 不同。

</template>

</Exercise>

## 官方文档与延伸阅读

- [systemd.service 官方手册](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) —— `Type=` 各取值的「已启动」判定原文、`Restart=` 集合与 `RestartSec=` 默认 100ms、`ExecStart` 前缀字符、`KillMode=`/`KillSignal=`/`TimeoutStopSec=`。本章引用句出自该页（核实于 2026-10-18，本机无 systemd，未运行验证）。配套 [systemd.unit(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html) 与 [systemd.exec(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)。
- [signal(7) — man7.org](https://man7.org/linux/man-pages/man7/signal.7.html) —— **已核实**：x86 编号表、默认动作表、"The signals SIGKILL and SIGSTOP cannot be caught, blocked, or ignored."、`kill(-pid)` 面向进程组。配套 [kill(2)](https://man7.org/linux/man-pages/man2/kill.2.html)、[proc(5)](https://man7.org/linux/man-pages/man5/proc.5.html)、[ps(1)](https://man7.org/linux/man-pages/man1/ps.1.html)。

## 下一章

这一章把「进程活着还是死了、谁杀的、谁起的」变成可推理的问题。但服务起不起来还取决于**依赖装没装、版本对不对**——`ExecStart` 里那个绝对路径从哪来。下一章[软件包与运行环境](/linux/packages-and-runtime)讲 apt 与版本锁定，以及怎么让部署在第二台机器上不再翻车。
