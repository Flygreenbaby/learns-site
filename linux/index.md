# Linux · 领域首页

<StatusBadge state="ready" note="10 章正文（含阶段项目）" />

## 这个领域解决什么问题

你的产品最终要跑在一台 VPS（Virtual Private Server，虚拟专用服务器）上，而这台服务器几乎一定是 Linux。从部署那一刻起，你就不再是「写代码的人」，而是「唯一的管理员」。这个领域要解决的，是你在服务器上必然会遇到的一连串具体问题：

- **SSH 连不上服务器。** 是密钥权限不对（私钥文件权限过于开放会被 OpenSSH 直接拒绝）？是端口被防火墙挡了？是 `sshd` 配置改了没重启？还是云厂商的安全组没放行？不懂 Linux 网络与权限模型，你只能靠碰运气逐条试。
- **磁盘满了，但不知道是什么占的。** 服务突然写不进数据，`df` 显示 100%，然后呢？你需要知道怎么用 `du` 逐层定位大目录，怎么发现「文件已删除但进程还握着句柄导致空间不释放」这种经典陷阱，怎么知道 journald 日志和 Docker 镜像在悄悄吃掉你的磁盘。
- **改了配置、重启了服务，但没生效。** 可能是改错了文件（很多配置有全局与用户两份），可能是 systemd 需要先 `daemon-reload`，可能是前面还有一层 Nginx 缓存或代理配置在起作用。不理解服务是怎么被 systemd 管理、配置是怎么被逐层加载的，你会一直在「玄学重启」。
- **网站被人扫爆、数据库端口暴露在公网。** 你需要的不是背安全清单，而是理解用户与权限、防火墙、SSH 加固为什么那样设计，出了事知道去哪看入侵痕迹。
- **想把重复的操作写成脚本，但 shell 脚本一报错就整段带病继续跑。** 因为不知道 `set -euo pipefail` 和退出码这回事。

Linux 的难点不在「命令太多背不下来」——没有人背得下来，也不需要。难在**心智模型**：一切皆文件的文件系统、用权限位而非「管理员弹窗」控制访问、用信号（signal）而非强制手段管理进程、用管道把小程序组合成大工具。模型建立了，命令忘了随时 `man` 一下就行；模型没建立，背一百个命令也还是不会排查问题。

## 前置知识

**无。** 本领域在数据源中不依赖任何其他领域，从零基础讲起。

但要注意学习节奏上的配合（见下方「学习顺序建议」）：按全站路线，第一期你只需要本领域的「最小集」，配合[工程工具与部署](/devops/)完成第一次上线；第二期再回来学完整内容。如果你已经会一点[后端开发](/backend/)，学进程与 systemd 那几章会更有体感——你终于知道自己在服务器上跑的到底是个什么东西了。

## 章节目录

| 章节 | 内容 | 学完能做什么 |
| --- | --- | --- |
| [1. 命令行基础](/linux/command-line) | 文件系统与路径（绝对/相对、`~`、`.`、`..`）、`cd`/`ls`/`cp`/`mv`/`rm`、管道与重定向、`grep`/`sed`/`awk` 入门、`find` 与 `xargs`、压缩与解压 | 在一台陌生服务器上自由移动，用命令组合从日志里捞出想要的那几行 |
| [2. 用户与权限](/linux/users-and-permissions) | 用户/组模型、`rwx` 权限位与八进制表示、`chmod`/`chown`、`umask`、`sudo` 与最小权限原则、SSH 密钥登录原理 | 配置好密钥登录并关掉密码登录，理解「Permission denied」到底是谁在拒绝谁 |
| [3. 进程与资源](/linux/processes-and-systemd) | 进程与 PID、`ps`/`top`/`htop`、信号与 `kill`、前台/后台与 `nohup`、systemd 服务单元编写、`systemctl` 与 `journalctl` | 把自己的 Node 服务写成 systemd 服务，开机自启、崩溃自动拉起，并会看它的日志 |
| [4. 软件包与运行环境](/linux/packages-and-runtime) | `apt` 与软件源、编译安装与包管理的取舍、Node 版本管理（nvm 类工具）、环境变量与 `PATH`、`profile`/`bashrc` 的加载时机 | 在服务器上装出干净、可复现的运行环境，不再「我本地明明是好的」 |
| [5. 网络基础](/linux/networking) | `ip`/`ss`/`ping`/`curl` 与 `-v` 诊断、端口与监听地址（`0.0.0.0` vs `127.0.0.1`）、防火墙与云安全组的分层、DNS 解析排查、iptables/nftables 概念、`tcpdump` 抓包入门 | 独立回答「为什么这个端口从外面访问不通」，并给出证据链而不是猜测 |
| [6. Shell 脚本](/linux/shell-scripting) | 变量与引号、条件与 `[ ]`/`[[ ]]`、循环、函数、退出码与 `set -euo pipefail`、实用运维脚本（备份、健康检查、日志清理） | 把重复的运维操作固化成可靠的脚本，出错即停而不是带病继续 |
| [7. Nginx](/linux/nginx) | 配置结构与 `server`/`location` 匹配、反向代理、静态资源托管、HTTPS 与证书（Let's Encrypt）、gzip 压缩、WebSocket 代理升级（`proxy_http_version`、`Upgrade`/`Connection` 头）、访问日志与限流 | 让一台 Nginx 同时托管前端静态文件、代理后端 API、挂好 HTTPS，并为实时通信留好升级通道 |
| [8. 服务器安全](/linux/server-security) | 入口清点（`ss -ltnp` 分档）、`sshd_config` 的「取第一个值」读法与 drop-in、SSH 加固（禁 root、禁密码、改默认端口的取舍）、最小权限运行服务、防火墙与云安全组的分层、自动安全更新、fail2ban、被入侵后的处置顺序 | 把一台「裸奔」的 VPS 加固到能安心跑生产服务，出事知道先看哪里、先保证据再断入口 |
| [9. 日志与故障定位](/linux/logs-and-troubleshooting) | 日志的来源与去向、journald 的存储与空间控制、logrotate 为什么不轮转与 `copytruncate` 的丢失窗口、时间同步、`systemctl status` 的三个字段、状态码背后的责任划分、磁盘/CPU/内存三条排查主线、`dmesg` 与 OOM、从外到内的分层排除法 | 面对「服务器变慢了」「服务挂了」「502」能按固定套路缩小范围并拿出证据行，而不是重启碰运气 |
| [10. 阶段项目](/linux/project) | 从零接管一台 VPS：一页纸规划、初始化、SSH 收紧、运行环境、systemd 服务、Nginx 与 HTTPS、边界收敛、备份与**恢复演练**、故障演练、30 分钟接管清单；区分本地可完成的理解练习与需要真实服务器的操作 | 把前 9 章串成一次完整的、可复述的服务器接管流程，不买 VPS 也能走完理解与验收 |

## 学习顺序建议

**本领域按全站路线拆成两次学，这是刻意设计，不是内容组织失误。**

**第一期最小集**（目标是「能上线」，对应路线第一期第 10 步）：

- 第 1 章命令行基础、第 2 章用户与权限（重点：SSH 密钥登录）
- 第 3 章的 systemd 部分（能写服务单元、能用 `journalctl` 看日志即可）
- 第 4 章的 apt 与 Node 环境部分
- 第 5 章的端口、监听地址与防火墙概念（够排查「为什么访问不通」即可）
- 第 7 章 Nginx（反向代理 + 静态托管 + HTTPS）

学完这些，配合[工程工具与部署](/devops/)就能完成第一次部署。**一次学完整个 Linux 领域会严重拖慢你的第一次上线**，而第一次上线带来的正反馈对长期自学至关重要。

**第二期完整内容**（目标是「能运维」）：产品上线后回来补齐第 6 章 Shell 脚本、第 8 章服务器安全、第 9 章日志与故障定位，以及第 5 章的抓包与 nftables 部分。这时候你有一台真实跑着产品的服务器，每个练习都能直接作用在它上面——这比第一期干学有效得多。

章节内部不要跳着学：第 2 章的权限模型是第 3 章「为什么 systemd 服务要用专用用户跑」的前提；第 5 章的网络分层是第 7 章理解 Nginx 监听与代理的前提。

## 学习方法

**你在 Windows 上学习，需要三个层次的 Linux 环境，建议全部拥有：**

| 方式 | 成本 | 真实度 | 便利性 | 用途 |
| --- | --- | --- | --- | --- |
| **WSL2**（Windows Subsystem for Linux） | 免费 | 中：是真实 Linux 内核，但没有 systemd 默认体验（新版本已支持开启）、没有独立的公网网络栈 | 最高：一条 `wsl --install` 装好，与 Windows 文件系统互通 | 日常练命令行、grep/sed/awk、Shell 脚本 |
| **虚拟机**（VirtualBox / VMware + Debian ISO） | 免费 | 高：完整系统，含 systemd、独立网卡、可随意快照回滚 | 中：要装虚拟化软件，占内存 | 练 systemd、防火墙、安全加固、故意搞坏再恢复 |
| **便宜 VPS** | 约每月 5–10 美元起 | 最高：就是你将来生产环境的形态，有公网 IP，会被真实的扫描器访问 | 中：只能通过 SSH 操作，搞坏了要重装（重装本身也是练习） | 练 SSH、Nginx、部署，以及第 8 章安全——被扫这件事只有公网机器才会遇到 |

**推荐路径**：先用 WSL2 过第 1、2、6 章（零成本、启动快）；学 systemd 和防火墙时切到虚拟机（WSL2 里体验不完整，且虚拟机可以快照，敢下手）；进入第 7 章 Nginx 之前买一台便宜 VPS，之后所有练习直接做在它上面。第一期结束你应该已经有一台跑了三个月的 VPS。

其他要点：

- **每条命令都亲手敲，不要复制粘贴。** 肌肉记忆对命令行异常重要。敲完看 `man 命令名`（或 `命令 --help`），对照自己理解的用法差在哪。
- **刻意练习「先预测再执行」**：运行前先在脑子里说出这条命令会改变什么，运行后验证。错了的差距就是你的知识缺口。
- **虚拟机快照是你的安全网**：每做完一个危险实验（改防火墙、改 SSH 配置）前先快照，搞坏了回滚重来，而不是重装。
- 判断是否学会的标准：合上教程，你能完成「阶段项目」的检查清单，并且每一步都能说出为什么。

## 阶段项目

**[从零接管一台 VPS](/linux/project)**。以下验收项分两条路径完成：没有服务器时用「理解路径」（在虚拟机或 WSL2 上推演 + 复述，本章每项都给了判据），有服务器时用「实操路径」。**不要求你先买 VPS 才能学这一章。** 全新 VPS（Debian 或 Ubuntu LTS）上的全部验收项：

- [ ] 创建一个非 root 的专用管理用户，配置 SSH 密钥登录，禁用 root 远程登录与密码登录
- [ ] 服务器时区、主机名、自动安全更新配置完成
- [ ] 用 apt（或 nvm 类工具）安装 Node.js LTS，写一个最小的 Fastify/Node HTTP 服务
- [ ] 为该服务编写 systemd 单元文件：专用低权限用户运行、开机自启、崩溃自动重启、日志进 journald
- [ ] Nginx 反向代理该服务：80 端口跳转 443，用 Let's Encrypt 签一张真实域名的证书并配置自动续期
- [ ] 防火墙只放行 SSH、HTTP、HTTPS 三个端口；从公网验证数据库端口（如果你装了）确实不可达
- [ ] 安装 fail2ban 并验证 SSH 暴破尝试会被封禁（可以用另一台机器或朋友的机器试，别把自己锁在外面——先在控制台确认你有 VNC/网页终端这条后路）
- [ ] 写一个备份脚本：打包指定目录 + 保留最近 7 天 + cron（或 systemd timer）定时执行
- [ ] 演练一次故障定位：人为把磁盘填满（`fallocate` 造一个大文件），然后用 `df`/`du` 定位并清理；再人为让服务崩溃，从 `journalctl` 里找到崩溃原因
- [ ] 全程记录一份自己的「接管清单」，下次买新服务器时照着 30 分钟内完成初始化

## 官方文档与延伸阅读

以下链接均已验证可访问（核实时间 2026 年 10 月）：

- [Debian Reference（官方入门手册）](https://www.debian.org/doc/manuals/debian-reference/) —— 基于 Debian 的最权威系统手册，本站 Linux 内容以 Debian 系为基准。
- [Ubuntu Tutorials](https://ubuntu.com/tutorials) —— 如果你的 VPS 选了 Ubuntu，从这里的命令行教程开始。
- [man7.org Linux manual pages](https://man7.org/linux/man-pages/) —— 所有核心命令与系统调用的 man 手册在线版，查参数拼写用它，不要信博客。
- [GNU Bash Reference Manual](https://www.gnu.org/software/bash/manual/bash.html) —— Shell 脚本一节的最终答案来源，特别是引号与展开规则。
- [systemd.service 官方手册](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) —— 编写服务单元文件时的权威参考。
- [OpenSSH Manual](https://www.openssh.com/manual.html) —— SSH 客户端与服务端配置（`ssh_config`/`sshd_config`）的官方说明。
- [Nginx Beginner's Guide](https://nginx.org/en/docs/beginners_guide.html) —— 第 7 章的主参考。
- [Nginx ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) —— 反向代理全部指令的官方文档，`proxy_set_header`、`proxy_http_version` 都在这。
- [Let's Encrypt 文档](https://letsencrypt.org/docs/) —— 免费证书的原理与客户端（certbot 等）入口。
- [fail2ban 官网](https://www.fail2ban.org/) —— 第 8 章暴破防护工具。
- [nftables wiki](https://wiki.nftables.org/) —— 新一代防火墙框架的官方 wiki。
- [WSL 官方文档（中文）](https://learn.microsoft.com/zh-cn/windows/wsl/) —— Windows 下安装与配置 WSL2 的权威说明。

## 版本说明

本领域内容基于 **Debian 12（bookworm）** 编写，命令与 Ubuntu LTS（22.04 / 24.04）基本一致——这两个发行版占 VPS 市场的绝对多数，也最贴合本站「部署到自己的 VPS」的主线。

必须诚实指出的发行版差异：

- **包管理**：Debian/Ubuntu 用 `apt`，RHEL/Fedora 系用 `dnf`，Alpine（很多 Docker 镜像的基础）用 `apk`。三者概念相通但命令与包名不同，文中会标注对应关系。
- **systemd 覆盖范围**：Debian/Ubuntu/RHEL 系全部使用 systemd，但 Alpine 用 OpenRC，部分容器环境没有 init 系统。本站讲 systemd，因为它覆盖你会遇到的绝大多数 VPS 场景。
- **防火墙**：老教程大量使用 `iptables`，Debian 12 与较新的发行版底层已转向 `nftables`（并提供 `iptables-nft` 兼容层）。文中会讲清这层关系，避免你照着十年前的教程操作新系统。
- **Nginx**：以发行版仓库或 nginx.org 官方源的最新稳定版（stable）为准，本站不锁定具体版本号；配置指令以 [nginx.org 官方文档](https://nginx.org/en/docs/beginners_guide.html)为准。
- Node.js 版本策略以 [Node.js 官方发布计划](https://nodejs.org/en/learn)为准（选 LTS），文中不写死小版本号。
