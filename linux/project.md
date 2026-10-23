# 阶段项目：从零接管一台 VPS

这一章把前九章合成一件事：**你拿到一台全新的、空白的 Linux 服务器，在一个下午之内把它变成一台能跑你自己产品、能被外面访问、出事你能查、被扫你能看出来、坏了你能恢复的机器**——并且能对着别人把整个过程复述一遍，每一步都说得出「为什么是这个顺序」。

它不要求你先买服务器。项目被明确拆成两条路径：**理解路径**（本机就能完成，产出是「你能复述的流程 + 你能读懂的输出」）与**实操路径**（需要一台真实 VPS 与真实域名）。按全站路线，第一期只需要把理解路径走完再加三件实操；第二期回到真机补齐其余。**只有实操路径里的动作才有真实成本，理解路径的验收标准是「说得清、看得懂、判得准」，不是「跑过」。**

<Callout type="unverified" title="本章的验收分两类，标注得很清楚">

**本机已实测**的部分只有两处，且都是文本与脚本层面的：第 6 章那个备份目录轮换脚本（Git Bash 下跑通，含保留 7 份与排序删除的判据），以及第 9 章用合成日志跑通的三套统计管道（`linux/.scratch/t15/`，产物在 `out/result.txt`）。除此之外，本章出现的每一条 `apt`、`systemctl`、`ufw`、`certbot`、`fail2ban-client`、`docker` 命令都**没有在本机执行过**——本机是 Windows 10，没有 Linux 内核与 systemd，也没有真实服务器。它们的正确性依据是官方手册页与前九章已核实的规则，验收时请把它们当作「待你在真机上验证的清单」，不是「已验证的结论」。

</Callout>

## 目标与范围

**要交付的东西**（按可核对的形式写出来）：

1. 一份**你自己的接管清单**：从拿到新机器到服务上线，每步一条命令加一条判据，目标 30 分钟内走完。
2. 一个跑在 systemd 下的最小服务：专用低权限用户、开机自启、崩溃自动重启、日志进 journald。
3. 一条完整的外部访问链：域名 → 云安全组 → 主机防火墙 → Nginx（80 跳 443、真实证书）→ 反向代理到只监听回环的上游。
4. 一个每天跑一次的备份任务，且**你演练过一次真实恢复**。
5. 一次故障定位演练：磁盘满与服务崩溃，各自从证据推到结论。

**不在范围内**（这些属于别的领域或后面的阶段）：数据库的高可用与主从、监控告警体系、Kubernetes 与编排、多机负载均衡、CDN 与对象存储的深度用法。这个项目的成功标准是**一台单实例机器被完整接管**，不是搭出一套基础设施。

## 怎么用这一章：两条路径

| 环节 | 理解路径（本机就能做） | 实操路径（需要真实 VPS） |
| --- | --- | --- |
| 攻击面清点 | 读第 8/9 章的示例输出，自己做一次「分类判断」练习 | `sudo ss -ltnp` 实际清点 |
| 用户与密钥 | 读本机 `~/.ssh/config`、写一份给假想机器的配置 | 建用户、装公钥、关密码 |
| systemd 单元 | 手写一个单元文件并逐行解释每个指令 | 装到机器上、`daemon-reload`、看到 `is-active` |
| Nginx 配置 | 走读配置块，回答「这条指令管哪一段」 | `nginx -t`、签发证书、跑一次 `curl -v` |
| 防火墙 | 画出「bind → 主机规则 → 安全组」三层图并标注每条规则属于哪层 | 真正放行与验证不可达 |
| 备份脚本 | **本机已实测**：逻辑与轮换判据可跑 | 挂上 timer/cron，真跑一次并恢复 |
| 故障演练 | **本机已实测**：合成日志的分诊管道 | `fallocate` 填满磁盘、人为让服务崩 |

理解路径不是「简化版」，它检验的是同一件事：**你能不能在没有终端的情况下预测一条命令会改变什么**。第 1 章就教过这个习惯（先预测再执行），这里把它当成验收工具——理解路径的全部题目都是「你预期输出是什么」，答不出来就说明那一步在真机上你也会卡住。

## 阶段 0：先把流程写成一页纸（本机，30 分钟）

在碰服务器之前，先按自己的理解把接管流程写下来，十个阶段各一到三行，**不许查资料**。写完再和第 1～9 章对照，缺口立刻显形。

这一步的产出是一份文档，它是整个项目里唯一在阶段 1 就能完成的东西，也是最后阶段要交付的那份清单的初稿。**为什么要先写**：真机操作时你的注意力全在「命令敲对了没有」，没有余力检查顺序；只有事先有一张纸，你才会在敲下第一条 `ufw default deny` 之前停下来问「我的 allow 写了吗」。

判据：你的清单里必须出现「先确认控制台后路，再动 SSH」「先放行再收紧」「先用密钥登录成功，再关密码」这三处顺序，且每一条都带一个验证点而不是只带动作。缺哪一处，就说明对应那章的那节要回读。

## 阶段 1：初始化一台新机器（真机）

拿到 VPS，用厂商给的 root 密码或密钥进去，第一件事不是装软件：

```bash
hostnamectl set-hostname app-01                 # 主机名会出现在日志里，多台机器时它是你的定位工具
timedatectl set-timezone Asia/Shanghai          # 或统一 UTC；见第 9 章「先看钟再读日志」
timedatectl                                       # 判据：三行都对得上（时区、NTP、synchronized）
adduser admin                                     # 建管理用户，密码可以先留着
usermod -aG sudo admin                          # Debian/Ubuntu 的组名是 sudo（RHEL 系是 wheel）
grep -E '^(admin|root)' /etc/passwd             # 判据：两个账号都在，UID 各是什么
```

（**未在本机验证**；`sudo` 组名随发行版变化，第 2 章讲过差异。）然后立刻做一件多数人推迟到「有空再说」的事：**把自动安全更新打开**（第 8 章那条 `unattended-upgrades`，来源列表只留 `-security`）。理由是真实的沦陷里很大一块不是 0day 而是没人打补丁，而这件事在机器还空的时候最容易配好。

**本地可完成的等价物**：读一遍第 8 章给出的三层职责表，然后回答阶段末尾练习 1 的「这台机器该放行什么」——同一套判断，不需要机器。

## 阶段 2：收紧 SSH，并且给自己留后路（真机）

顺序在第 8 章写过，这里是执行版：**① 去云控制台确认 VNC/串口终端能进去 → ② 把公钥装进 `admin` 的 `authorized_keys` → ③ 新开终端用密钥登录成功 → ④ 改 drop-in（`PermitRootLogin no`、`PasswordAuthentication no`、`KbdInteractiveAuthentication no`）→ ⑤ `sshd -t` 再 reload → ⑥ 保持第 ③ 步那个会话不断，另开终端试密码登录，必须失败 → ⑦ 才关旧会话。**

每一条都有理由，其中三条最容易被跳过：**第 ① 步**是唯一不可逆风险的保险，跳过它，后面每一步都是赌博；**第 ③ 步在改认证之前**——先关密码再验密钥，失败时你已经在门外；**第 ⑥ 步**是判据，不做它你确认的只是「配置写了」而不是「加固生效了」，这是第 8 章第一条常见错误的正面版本。

改完做一次自查：`sudo sshd -T | grep -Ei 'permitrootlogin|passwordauth|kbdinteractive'`，**它打印的是生效值**，而 drop-in 的首值生效规则（第 8 章）会让「文件里写了什么」和「实际生效什么」不同。很多云镜像自带 `sshd_config.d/50-cloud-init.conf` 里的 `PermitRootLogin yes`，不查这一步你会以为自己的修改没起作用。

## 阶段 3：运行时与目录布局（真机，本机可走读）

装 Node 的取舍在第 4 章讲过：发行版 `apt` 里的版本通常偏旧，用发行版官方源或 nvm 类工具装 LTS，**关键是记下你用的是哪条路**，因为将来复现和升级要照着同一条路走。

目录布局现在就定下来，它决定了备份要备什么、systemd 要指哪里、以及回滚怎么做（第 7、9 章与[部署到 VPS](/devops/deploy-to-vps) 都依赖它）：

```text
/srv/app/
  releases/20261018-1015/     # 每次发版一个目录，不可变
  current -> releases/20261018-1015
  shared/.env                 # 凭据只在这里，不随发版复制
  shared/uploads/             # 用户上传，也不随发版删除
```

三条纪律：**`current` 是一个软链**，发布 = 建新目录 + 切软链，回滚 = 把软链切回去；**`.env` 与上传目录放在 `shared/`**，因为它们既不属于某一次发版、也不能被下一次发版删掉；**`/srv/app` 的属主是服务账号而不是 root**，否则你的应用要么写不进上传目录，要么只能被你用 `chmod 777` 修好——那是第 2 章警告过的「靠权限放宽来掩盖属主错误」。

判据（真机）：`namei -l /srv/app/current/server.js` 一路可读；`ls -ld /srv/app/shared` 属主是服务账号且权限不含 `o+w`。**这条命令就是第 9 章练习 3 的那条**——现在先跑一次，将来出事时你会认得它。

## 阶段 4：把服务交给 systemd（真机；单元文件本机可写可读）

写一个最小但正确的单元（**未在本机验证**，指令语义见第 3 章与 `systemd.service(5)`）：

```ini
[Unit]
Description=My Node App
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=app
Group=app
WorkingDirectory=/srv/app/current
EnvironmentFile=/srv/app/shared/.env
ExecStart=/usr/bin/node /srv/app/current/server.js
Restart=on-failure
RestartSec=2
StartLimitBurst=5
StartLimitIntervalSec=60
MemoryMax=512M
ProtectSystem=strict
ReadWritePaths=/srv/app/shared/uploads /srv/app/shared/logs
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

装上去并验证的四条：`sudo systemctl daemon-reload`（**改了单元不跑这条，一切都不生效**）、`systemctl enable --now myapp`、`systemctl is-active myapp` 应为 `active`、`systemctl status myapp` 里 `User` 与 PID 对得上。再跑三条**主动验证**而不是被动确认：

```bash
sudo kill -TERM <MainPID>           # 判据：几秒后 status 里 PID 变了，服务又活了
ss -ltnp                            # 判据：进程只监听 127.0.0.1:3000，不是 0.0.0.0
journalctl -u myapp -n 20 --no-pager   # 判据：启动日志与请求日志都进了 journald
```

第一条测的是自动重启是否真的在起作用（不测你永远不知道 `Restart=` 写错在哪一段）；第二条测暴露边界（第 8 章：先改 bind 而不是先加防火墙）；第三条测日志通路（第 9 章：出事时你要有东西可看）。至于 `EnvironmentFile`：服务**不会读**你的 `~/.bashrc`（第 4 章讲过原因），所有变量必须从这里显式进。

**本地可完成的等价物**：把上面这个文件抄一遍，逐行给每条指令写出「删掉它会发生什么」。这是练习，不是形式主义——`After=` 与 `Wants=` 的区别、`ProtectSystem=strict` 与 `ReadWritePaths` 的配对、`MemoryMax=` 与 OOM 的关系，只有在你预测错的地方才会真正被学会。

## 阶段 5：Nginx、80 跳 443、一张真证书（真机；配置本机可走读）

三件事按顺序做，每件都有独立判据（指令细节在第 7 章，这里只给流程与验收）：

1. **静态与反代先跑通 HTTP**：前端文件用 `root`/`alias` 发出去，`/api` 代理到 `127.0.0.1:3000`。判据：`sudo nginx -t` 通过，`curl -sI http://域名/` 与 `curl -s http://域名/api/健康检查` 都有正常响应。
2. **再加 80 → 443 的跳转**：`return 301 https://$host$request_uri;`。判据：`curl -sI http://域名/some/path?x=1` 的 `Location` **保留完整路径与查询串**——丢了 `$request_uri` 是这个阶段最常见的一处错，而且只在非首页路径上暴露。
3. **最后签证书并配自动续期**：Let's Encrypt 的 HTTP-01 验证需要从公网访问 `/.well-known/acme-challenge/`，所以这一步必须在安全组与主机防火墙都放行 80 之后（**未在本机验证**）。判据：`curl -vI https://域名/` 里 `SSL certificate verify ok`，且 `sudo certbot renew --dry-run` 全绿；把续期挂到 systemd timer 或 cron，并检查它真的跑过（`systemctl list-timers | grep certbot`）。

顺序的理由：证书签发依赖 80 可达，而 80 一跳转发会打断 HTTP-01——**先签好再开强制跳转**，反过来会得到一个「证书签不下来、跳转又已经生效」的死局。这是这个项目里第一个由顺序造成的真实故障。

顺带在本机就能练的一件事：第 7 章那条 `log_format perf`（`rt`/`urt`/`us`）现在就配上，因为它决定你将来能不能做第 9 章那种分诊。**没有这两个字段的 access log，遇到「慢」你只能猜。**

## 阶段 6：防火墙与云安全组——两层都要，且只有三个端口（真机）

先画一张表再敲命令，**这张表就是这个阶段的产出**：

| 端口 | 谁在听（bind） | 主机规则 | 安全组 | 结论 |
| --- | --- | --- | --- | --- |
| 22 | sshd / `0.0.0.0` | allow | allow | 保留，认证已在阶段 2 收紧 |
| 80 | nginx / `0.0.0.0` | allow | allow | 保留（跳转与 ACME 需要） |
| 443 | nginx / `0.0.0.0` | allow | allow | 保留 |
| 3000 | node / **`127.0.0.1`** | 不需要 | **不放行** | 已收进反向代理，正确 |
| 5432 | postgres / `127.0.0.1` | 不需要 | **不放行** | 保持回环，别改 |

三条纪律与它们的验证方式：**一、只放行 22/80/443**，其余一律不放行（第 8 章那条），验证是从**另一台机器** `nc -vz 公网IP 3000` 必须失败；**二、v4 与 v6 都要配**，`curl -4`/`curl -6` 各打一次，只配一家族等于另一半全开；**三、如果之后用 Docker**，容器 `-p` 发布的端口会绕过 `ufw`（第 8 章那条坑），发布成 `127.0.0.1:3000:3000` 或不发布。

`policy`/`default deny` 之前，再确认一次阶段 2 的后路仍然可用（控制台能进去），并保持当前 SSH 会话不退出。**这一阶段的验收不是「规则配上了」，而是「我从外面确认过那三个端口通、其它端口不通」**——前者是你做了什么，后者是世界变成什么样，第 5 章反复讲过这个区别。

## 阶段 7：自动封禁与完整性基线（真机，可选但推荐）

fail2ban 按第 8 章配：`jail.local` 而不是 `jail.conf`、`backend` 与你的日志来源匹配、`ignoreip` 里写上你自己。**验收不能靠「装好了」**，要做一次真实尝试：从另一台机器连续输错密码 6 次，然后 `sudo fail2ban-client status sshd` 看到那个 IP 在 `Banned IP list` 里，并且它再连时是超时（第 8 章 DROP 的判读）。**没做过这次演练，你就不知道自己是不是配错了 `backend` 而它一条都没封过。**

同时留一份完整性基线，它在你怀疑被入侵时才有价值（**未在本机验证**）：`sudo dpkg -l > ~/baseline-packages.txt`、`sudo ss -ltnp > ~/baseline-ports.txt`、以及各服务账号 `authorized_keys` 的行数。第 8 章的入侵排查第一步就是拿现在和这份基线做差——**没有基线，「多了什么」这个问题无法回答**。

## 阶段 8：备份，并且演练一次恢复（脚本本机已实测）

第 6 章那个备份脚本在这里落地。它的核心逻辑——打包、按名字排序、只保留最近 7 份——**在本机 Git Bash 下真跑过**，包括故意造出 9 个旧存档、验证删掉的正好是最旧的 2 个、以及 `set -euo pipefail` 在一次路径错误时确实让脚本停在第 3 行而不是带病跑完。备份任务本身要备的东西按第 6 章那张表：**数据库导出 + `.env`/配置 + 用户上传目录 + 你的单元与 Nginx 配置 + 那份接管清单**；只备份 `/srv/app` 是常见错误，因为数据库在别处。

挂上定时有两种做法：`crontab -e` 加一行 `15 3 * * * /usr/local/bin/backup.sh`，或写一个 systemd timer（第 3 章两者都讲过，timer 的好处是状态与日志统一进 journald）。判据都是「下一次触发时间出现在列表里」：`systemctl list-timers`，或 cron 的话 `grep CRON /var/log/syslog`。

**恢复演练是这个阶段的真正验收，不是脚本跑成功。** 具体做法：找一台干净环境（本地虚拟机、或临时开一台按小时计费的机器），只给这份备份包，试着把服务重新跑起来并让 `curl` 打到健康检查。**没演练过的备份等于没有备份**——这条纪律来自一个残酷的统计：真正需要用备份的那天，你会同时面对磁盘、权限、依赖版本三个问题，而备份文件的格式是第四个。

## 阶段 9：故障演练（磁盘与崩溃，各一次）

两次演练，各写一份「现象 → 证据 → 结论」的记录。**这是整个项目里唯一「故意把机器搞坏」的阶段，所以只在真机或虚拟机上做，且做完要能回到已知良好状态。**

**磁盘满**（真机）：`sudo fallocate -l 8G /var/tmp/bigfile`，直到 `df -h /` 显示 100%，然后按第 9 章的顺序走：`df -h` → `df -i` → `sudo du -x --max-depth=1 /` → `sudo journalctl --disk-usage` → `sudo lsof +L1`。记录里必须有一条**你原先以为会占用但实际没有**的东西（通常是 Docker 或 journald），因为那正是下次你会漏掉的地方。清理后 `rm /var/tmp/bigfile`，并解释为什么 `df` 可能还不立刻回落（如果那个文件被进程握着——第 9 章第二条常见错误）。

**服务崩溃**（真机）：让应用启动时抛异常（例如把 `.env` 里的数据库地址改成一个不存在的），确认 `systemctl status` 的 `Result:` 与退出码，`journalctl -u myapp --since "-5 min"` 找到那行栈，然后**用日志证明是配置导致的，而不是靠改回来再看它是否复活**。第二条演练：`sudo kill -KILL <MainPID>`，看 systemd 多久把它拉起来（阶段 4 已经测过 TERM，这次测 KILL，它不可被捕获，是最坏情况的模拟）。

**本机可完成的等价物**：第 9 章的三套日志分诊管道已经在我这台 Windows 10 + Git Bash 上跑通过——识别扫描器、区分「被扫的时段」和「出事的时段」、按 `rt`/`urt` 把 300 行性能日志分成「慢在后端 8 / 慢不在后端 27 / 上游无响应 5」三桶。你可以照着 `linux/.scratch/t15/logtriage.sh` 自己重跑一遍并改条件（比如把「慢」的阈值从 0.5 秒改成 0.1 秒，看三桶怎么变）。**这是本章唯一不需要 Linux 也能练的排障肌肉。**

## 阶段 10：把接管写成一份 30 分钟的清单（本机）

最后交付那份文档。它的形式不是教程，是**清单**：每步一条命令 + 一条判据 + 一个「不通时看哪里」。写它的诀窍是**按时间线而不是按主题**——「阶段 2 的 SSH」和「阶段 6 的防火墙」在真实操作中是同一次会话里交错发生的（改端口就要同时动两层），把它们写成两个独立章节，你下次照着做就会漏。

同时在清单末尾留一段**这次的故障记录**：这个项目里你一定至少卡住过一次（`daemon-reload` 忘了、80 跳转挡住了 ACME、`du` 不加 `-x`、只配了 IPv4），把它写下来，那才是这份清单里最值钱的部分——**它不是知识，是你这台机器上验证过的事实**。

## 验收清单

全部勾选完，这个项目才算结束。**每一条都是可核对的，不是「我懂了」**：

- [ ] 有一个非 root 管理账号，密钥可登、密码登录已关、root 远程登录已禁，且我用 `sshd -T` 核对过**生效值**
- [ ] 我在改认证之前，从云控制台 VNC/串口进去过一次（后路确认）
- [ ] 主机名与时区已设，`timedatectl` 显示时钟已同步
- [ ] 自动安全更新已开，来源只留 `-security`，`systemctl list-timers` 里能看到它
- [ ] `sudo ss -ltnp` 的输出里，除了 22/80/443 没有任何服务监听在 `0.0.0.0` 或 `*`
- [ ] 目录布局是 `releases/<时间戳>` + `current` 软链 + `shared/`，且 `namei -l` 一路可读
- [ ] systemd 单元以专用账号运行，我 `kill -TERM` 过一次并看到它自动回来
- [ ] 服务的日志在 journald 里查得到（`journalctl -u` 有内容），不是散落在某个文件
- [ ] `curl -sI http://域名/任意路径?查询=1` 的跳转保留了完整路径与查询串
- [ ] 证书有效、`certbot renew --dry-run` 全绿、续期已挂定时器且跑过至少一次
- [ ] Nginx 访问日志里有 `rt`/`urt` 字段（第 9 章分诊的前提）
- [ ] 主机防火墙与安全组都只放行 22/80/443，且我从**另一台机器**验证过 3000 不可达
- [ ] IPv4 与 IPv6 都验证过（`curl -4` 与 `curl -6` 各一次）
- [ ] fail2ban 做过一次真实暴破演练，我在 `Banned IP list` 里看见过那个测试 IP
- [ ] 留了完整性基线：已装包清单、监听端口清单、各 `authorized_keys` 行数
- [ ] 备份脚本在定时器上跑过至少一次，产物存在且大小不是 0
- [ ] **我在另一台干净机器上只用那份备份恢复过一次服务**（这条不勾，前面那条等于没勾）
- [ ] 做过一次磁盘满演练与一次崩溃演练，各有一份「现象→证据→结论」记录
- [ ] 有一份自己的接管清单，下次买新机器能照着在 30 分钟内完成初始化
- [ ] 合上所有资料，我能把这条链完整讲一遍：域名 → 安全组 → 主机防火墙 → Nginx → 回环上游 → 数据与日志

**没有 VPS 的人**：把上面所有「我从另一台机器验证过」的项替换成练习里的「预测输出」题，其余（目录布局、单元指令逐行解释、接管清单、备份脚本逻辑、日志分诊管道）都能在本机完成。**理解路径的验收标准是：你能判断一条命令的输出对不对，而不是你跑过它。**

## 常见翻车点

**一、先开 80→443 强制跳转，再去签证书。** 症状是 ACME 一直 404 或 301，签发失败。原因：HTTP-01 需要从公网明文访问 `/.well-known/acme-challenge/`，而跳转把它送去了 443。修法是顺序（先签后跳），不是给 ACME 路径加例外——那会让你的跳转永久留一个洞。

**二、`.env` 与上传目录被放进 `releases/`。** 症状是每次发版后应用突然连不上数据库、上传的文件全「消失」（其实是被新目录取代）。原因：把随发版替换的东西放进了替换单元。这条在阶段 3 就决定了，出事后补救要搬目录、改属主、重启服务，代价远高于当时多想一步。

**三、以为「服务起不来」是应用问题，其实是 systemd 的 exec 阶段。** 症状：`journalctl -u myapp` 一行应用日志都没有。判据是第 9 章那条：`status=` 带阶段名（`CHDIR`/`EXEC`/`USER`）说明还没进你的代码——`WorkingDirectory` 指向的软链不存在是这个项目最常见的具体形态，因为它同时踩了翻车点二的变体（发版脚本没切软链）。

**四、只在这台机器上验证「端口能连」。** `curl 127.0.0.1:3000` 通、`curl 自己的公网IP:3000` 通，都不能证明外部可达（第 5 章讲过这个局限）。验收必须由另一台机器发起，这一步省下来的人，会在两周后发现数据库端口一直开着。

**五、备份跑了，从没恢复过。** 症状是出事那天：备份文件是 0 字节、或者 tar 里的路径带着绝对前缀、或者数据库导出的字符集和恢复目标不一致。这不是运气问题，是没演练。第 9 章「日志不在了」的教训同理：所有「事后才知道要看」的东西，都要在事前变成定时器与固定动作。

## 练习

<Exercise title="练习 1 · 不碰服务器，把这台机器的边界画出来" difficulty="基础">

假想一台刚部署完的 VPS，你只有下面这些输出（**为本题造的示例**）：

```text
$ sudo ss -ltnp
LISTEN 0 511   0.0.0.0:80     users:(("nginx",pid=900))
LISTEN 0 128   0.0.0.0:22     users:(("sshd",pid=812))
LISTEN 0 511   127.0.0.1:3000 users:(("node",pid=1188))
LISTEN 0 80    127.0.0.1:5432 users:(("postgres",pid=1420))
LISTEN 0 4096  *:6379         users:(("redis-server",pid=1500))

$ sudo ufw status numbered
[ 1] 22/tcp   ALLOW IN  Anywhere
[ 2] 80/tcp   ALLOW IN  Anywhere
[ 3] 443/tcp  ALLOW IN  Anywhere
Default: deny (incoming), allow (outgoing)
```

1. 这台机器现在真正暴露给公网的端口有几个？逐个说明理由。
2. 云安全组此刻必须放行哪些端口，不多不少？
3. Redis 那一行怎么办？给出「改 bind」与「加防火墙规则」两种做法，并说出你为什么选前者。
4. 这份输出里还缺哪个字段，会让你在第 9 章的分诊做不下去？

<template #answer>

1. **三个**：22（sshd，`0.0.0.0`）、80（nginx，`0.0.0.0`）、**6379（`*:6379`，v4 与 v6 都接，比 `0.0.0.0` 更宽，而且 Redis 默认无认证）**。`127.0.0.1:3000` 与 `127.0.0.1:5432` 不暴露——只在回环，外部无法直接触达；注意 443 虽然放行了但**根本没有进程在听**，这是另一种错（Nginx 没配 443 的 server 或证书未签），它不会立刻出事，但阶段 5 的验收会挂。
2. 22、80、443——**443 要放行**，即使现在没人听（你马上就配）。6379 绝不在安全组放行；第 8 章那条纪律是「只有这三个可以在安全组放行」，因为安全组是主机上的进程动不了的一层，也是被入侵后仍然生效的一层。
3. 改 bind：`bind 127.0.0.1 -::1` 并确认 `protected-mode yes`，或让应用走 Unix 套接字；Docker 起的就发布成 `127.0.0.1:6379:6379`。选前者的理由（第 8 章）：**改 bind 是把入口删掉，加规则是在入口上装门**，而门会被别的链、被放行改动、被 Docker 直接写内核的规则绕过。验证必须从另一台机器打：`nc -vz 公网IP 6379` 要失败。
4. **rt 与 urt**（`$request_time` 与 `$upstream_response_time`）。这份 access log 里没有耗时字段，于是第 9 章那张「慢在后端 / 慢不在后端 / 上游无响应」的三桶分诊根本开不了工——你会退回靠猜。这也是为什么阶段 5 要求现在就把 `log_format perf` 配上。

</template>

</Exercise>

<Exercise title="练习 2 · 上线当天这四个现象，你按什么顺序处理" difficulty="进阶">

刚做完阶段 6，四个现象同时出现（**为本题造的示例**）：

```text
A 浏览器打开 https://app.example.com → ERR_SSL_PROTOCOL_ERROR
B curl -sI http://app.example.com    → 301 Location: https://app.example.com/
C 手机流量（走另一张网）打同一站点   → 连接超时
D systemctl status myapp            → active (running)，ss -ltnp 显示 127.0.0.1:3000 在听
```

1. 这四条里哪两条其实是同一个原因？给出你的推理。
2. 处理顺序是什么？说明为什么这样排。
3. 你会先取哪两份证据？各用一条命令。
4. 修完之后，用什么命令证明你「真的」修好了，而不是碰巧？

<template #answer>

1. **A 与 C 同源，且都不是应用问题**（D 已排除上游）。B 说明 80 正常、跳转正常、DNS 解析正常，所以问题在 443 这一侧：**要么 443 在主机防火墙或安全组没放行（→ C 的超时），要么 Nginx 那边 443 的 server 没起来 / 证书链有问题（→ 浏览器的 SSL 协议错误）**。而这两者通常同一个根因：证书签发在阶段 5 没成功（`certbot` 失败）而强制跳转已经开了，于是 Nginx 只监听 80，`443/tcp` 无人接听，同时如果安全组也只放了 22/80，从另一张网打就是超时。**「B 通而 A/C 不通」这个组合，几乎是「跳转先开、证书没成」的指纹。**
2. **先恢复可达性，再恢复功能**：① 从外部确认 443 到底是不通（超时）还是拒绝（refused）——这决定问题在网络层还是应用层（第 5 章那条判据）；② 如果是超时，补安全组与主机规则；③ 如果是 refused/SSL 错误，看 `sudo nginx -t` 与 `ss -ltnp` 有没有 443；④ 证书没签下来就先**临时关掉强制跳转**，让 HTTP-01 能走通，签成后再打开（翻车点一的正确处置，而不是给 ACME 加永久例外）。
3. 从另一台机器：`nc -vz app.example.com 443`（区分超时=丢包 / 拒绝=没人听）；在机器上：`sudo nginx -T | grep -n 'listen\|ssl_certificate'`（看配置里到底有没有 443 与它用的是哪张证书）。再加一份时间线证据：`journalctl -u nginx --since "-1 hour" | tail -30`，看有没有 `cannot load certificate` 之类的启动失败行。
4. 三条一起过：`curl -sI https://app.example.com/深层路径?x=1` 返回 200 且**路径与查询串保留**；`echo | openssl s_client -connect app.example.com:443 -servername app.example.com 2>/dev/null | openssl x509 -noout -dates -issuer` 显示的是你预期的那张证书（多站点共 IP 时这条能证明 SNI 选对了）；**从第二个网络（手机流量）再打一次**，排除「只有我这个网络能通」的假成功。

</template>

</Exercise>

<Exercise title="练习 3 · 复述：从零到能服务，只给你 10 条" difficulty="挑战">

不许查资料。给一个刚买了 VPS 的朋友讲清「从零到能跑产品」，你只能写 **10 个编号步骤**，每步一行，但必须满足三个硬约束：

1. 每一步都能被一条命令**验证**（写出那条命令，不能只写动作）；
2. 至少两步是**后路或回滚**，而不是建设动作；
3. 顺序错了会出事的地方，你要在括号里标出「必须在第 N 步之前」。

写完后自测：把你写的清单给第 1～9 章对照，凡是「这一步我讲不出为什么在这个位置」的，就是还没学会的位置感。

<template #answer>

一份合格的参考答案（步骤、判据、后路标注三样齐）：

1. 确认控制台 VNC/串口能进去 —— 判据：真的开一个终端进去过（**后路，一切改动之前**）。
2. 建管理用户并装公钥，`sshd -T` 核对认证相关生效值 —— 判据：新终端用密钥登录成功（**必须在关密码之前**）。
3. 关 root 远程登录与两类密码认证，`sshd -t` 后 reload —— 判据：另开终端试密码登录**必须失败**（第 8 章第 ⑥ 步）。
4. 设主机名与时区、开 `-security` 自动更新 —— 判据：`timedatectl` 与 `systemctl list-timers` 都有对的值。
5. 装 Node LTS 与目录布局 `releases`/`current`/`shared` —— 判据：`namei -l /srv/app/current/server.js` 一路可读，`shared/.env` 是 600 且属主为服务账号。
6. 写 systemd 单元并 `daemon-reload`、`enable --now` —— 判据：`is-active` 为 active 且 `ss -ltnp` 显示上游只听 `127.0.0.1:3000`。
7. 崩溃与重启测试（`kill -TERM` 主 PID）—— 判据：PID 变了、服务回来了、`journalctl -u` 有这两段痕迹（**回滚能力靠这一步确认**）。
8. Nginx：HTTP 静态与 `/api` 反代先跑通，签证书 —— 判据：`nginx -t` 通过 + `certbot renew --dry-run` 全绿（**强制跳转必须在证书签发成功之后**）。
9. 开 80→443 跳转，收紧主机防火墙与安全组到 22/80/443，v4/v6 都配 —— 判据：**从另一台机器** `nc -vz IP 3000` 失败、`curl -sI http://域名/路径?x=1` 的 Location 保留完整路径。
10. 挂备份定时器 + 留完整性基线 + 做一次恢复演练 —— 判据：`list-timers` 有下次时间、产物大小非 0、**在另一台机器上只用备份包跑起来过**。

评分要点：**有没有把后路（1、2、7、10）写成步骤**是最能区分「会命令」与「会接管」的一条——四个纯建设性教程里通常完全没有它们。其次是括号那三处顺序约束：2 在 3 之前、8 在 9 之前、恢复演练在「项目完成」之前。第三是每条判据都必须是**外部可观察的事实**（PID 变了、从另一台机器打不通、Location 里路径在），而不是「我执行过了」——这正是第 9 章「把我觉得变成证据在这一行」在项目里的落法。

</template>

</Exercise>

## 官方文档与延伸阅读

站内衔接（这个项目全部依据已在这些章节里）：[命令行基础](/linux/command-line)、[用户与权限](/linux/users-and-permissions)、[进程、信号与 systemd](/linux/processes-and-systemd)、[软件包与运行环境](/linux/packages-and-runtime)、[网络诊断与防火墙](/linux/networking)、[Shell 脚本](/linux/shell-scripting)、[Nginx](/linux/nginx)、[服务器安全](/linux/server-security)、[日志与故障定位](/linux/logs-and-troubleshooting)；跨领域衔接：[部署到 VPS](/devops/deploy-to-vps)、[发布与回滚](/devops/release-and-rollback)、[Docker Compose、卷与网络](/devops/docker-compose)、[CI/CD 与 GitHub Actions](/devops/ci-cd)。

- [Debian Reference（官方系统手册）](https://www.debian.org/doc/manuals/debian-reference/)——本章所有 Debian 侧命令与路径的第一参考。
- [systemd.service(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) 与 [systemd.exec(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)——阶段 4 那份单元里每条指令的权威定义，包括 `ExecStart` 的解析规则与 exec 阶段错误码。
- [OpenSSH Manual](https://www.openssh.com/manual.html) 与 [sshd_config(5)（Debian 手册页）](https://manpages.debian.org/bookworm/openssh-server/sshd_config.5.en.html)——阶段 2；后者已核实「同一关键字取第一个值」与三个认证项的上游默认值。
- [Nginx Beginner's Guide](https://nginx.org/en/docs/beginners_guide.html) 与 [ngx_http_log_module](https://nginx.org/en/docs/http/ngx_http_log_module.html)——阶段 5 与 `rt`/`urt` 字段。
- [Let's Encrypt 文档](https://letsencrypt.org/docs/) 与 [fail2ban 官网](https://www.fail2ban.org/)——阶段 5 的 ACME 验证前提、阶段 7 的 jail 与 action 结构。
- [nftables wiki](https://wiki.nftables.org/)——阶段 6 想手写规则时的依据（`inet` 家族能一次覆盖 v4 与 v6，正是「IPv6 被漏掉」那节的解法）。

## 下一章

Linux 领域到这里结束：你已经能独立接管一台服务器。往上线那一步走，[部署到 VPS](/devops/deploy-to-vps) 把这里的手动流程变成一次可重复的发布；[发布与回滚](/devops/release-and-rollback) 处理「上线之后怎么不出事、出事怎么退回来」；[工程工具与部署](/devops/) 整个领域与本章是同一台机器上的两种视角——本章管「这台机器本身」，那一章管「代码怎么进到这台机器」。如果你还没决定产品跑在哪一层，先回[后端开发](/backend/)把服务这一层定下来。
