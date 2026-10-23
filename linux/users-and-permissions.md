# 用户与权限：目录的 x 位管的是「能不能查名字」，不是「能不能执行」

Nginx 返回 403，你 `ls -l` 一看：`-rw-r--r-- 1 www-data www-data 2048 index.html`。属主对、组对、`644` 里连「所有人都能读」都写了，可浏览器就是 403。你把整棵目录 `chmod -R 777`，403 立刻消失——然后你在安全审计里收到一条高危。真正的原因在上一层目录：`/home/deploy/` 是 `750`，`www-data` 进不去，连「把 `index.html` 这个名字解析成 inode」这一步都做不到。**权限检查发生在路径的每一级上，任何一级缺 `x`，后面那文件多漂亮的 `644` 都没用。**

第二种故障更凶：你把 SSH 私钥拷进共享目录，在 Windows 的 Git Bash 里 `chmod 600` 跑完没报错，`ssh` 却说 `Permissions 0644 for 'id_rsa' are too open`（Linux 上的原文）。第三种是 `sudo`：同事给你一份 sudoers 片段，写着 `NOPASSWD: /usr/bin/awk`，你照着配上，第二天发现任何能 `sudo awk` 的人都是 root。三类故障共用一套模型：**内核只认数字 UID/GID 和模式位；名字是查表来的；`rwx` 对文件和目录含义不同；而权限位之上还压着一套完全不同的强制访问控制。**

前置：[命令行基础](/linux/command-line)——`ls -l` 字段、`stat`、`find -perm`、管道与重定向在这里反复用到。版本口径与[领域首页](/linux/)一致：Debian 12（bookworm）与 Ubuntu LTS，用户与组工具来自 `passwd`/`shadow` 软件包。**先读下面那个 Callout：本章的权限实验在本机（Windows Git Bash）全部做不了，我用实测证据说明了为什么。**

## 内核只认 UID：`id` 的每一列怎么读

进程持有的是**数字**：real UID/GID（发起者身份）、effective UID/GID（做权限检查时用的身份）、saved、filesystem UID，外加一组附加组（supplementary groups）。名字→数字的映射在 `/etc/passwd` 与 `/etc/group`，由 NSS（Name Service Switch）在运行时查，配置在 `/etc/nsswitch.conf`。这解释了那个经典现象：**NIS/LDAP 挂了，`ls -l` 立刻把用户名显示成裸数字**——属主的数字在 inode 里，名字要靠现查。

`id` 是本章最有信息量的命令，输出形态（格式为预期结果，本机 `id` 的真实输出见下面的 Callout，它没有组名）：

```text
uid=1000(deploy) gid=1000(deploy) groups=1000(deploy),27(sudo),998(www-data)
```

三段依次是当前身份、主组、**附加组列表**。判读要点：**做权限检查时 effective GID 加上列出的所有附加组都算数**，所以「把人加进 `www-data` 组」必须重新登录才生效——组列表是**登录那一刻**写进进程凭据的，`usermod -aG` 改的是数据库，改完要新开 session 用 `id` 验证；`getent passwd 名字` 给完整条目含登录 shell。

**UID 0 就是 root**，这不是约定而是代码里的判断：内核在许多路径上直接检查 `euid == 0` 并跳过常规 DAC 检查。所以「两个用户都叫 admin 但 UID 都是 0」等于两个 root，删掉一个叫 admin 的账号根本不撤销超级权限。数字范围是发行版约定而非内核强制，实操只需记住：**UID < 1000 是系统账号**（Debian 上系统用户从 100 起、普通用户从 1000 起；RHEL 系历史上用 500 起）。阈值随 `/etc/login.defs` 的 `UID_MIN`/`SYS_UID_MIN` 变化，动手前 `grep -E '^UID_MIN|^SYS_UID' /etc/login.defs` 核对（**未在本机验证**）。

## `/etc/passwd` 与 `/etc/shadow`：字段逐个讲

先破除一个误解：**`/etc/passwd` 里没有密码**，它是一张身份索引表，所以本来就全局可读（`644`）——很多程序要把 UID 翻成名字。真正的密码散列在 `/etc/shadow`，权限通常是 `640 root:shadow`（Ubuntu 属组是 `shadow`，Debian 上常是 `0 root`，以 `ls -l /etc/shadow` 为准）。

`/etc/passwd` 一行七个字段，冒号分隔：

```text
deploy:x:1000:1000:Deploy user:/home/deploy:/bin/bash
  1   2  3    4       5          6           7
```

| 序 | 字段 | 运维里怎么用它 |
| --- | --- | --- |
| 1 | 登录名 | 必须与 `/etc/shadow` 第 1 字段配对 |
| 2 | 密码占位 | 一般是 `x`（「去 shadow 里查」）；空字符串**等于该账号可免密登录**；`*` 或 `!` 表示无有效密码 |
| 3 | UID | UID 0 即 root；**重复 UID 会造成「改了一个人的权限动了另一个人」** |
| 4 | GID | 主组数字，新建文件时属组的来源 |
| 5 | GECOS/注释 | 审计时靠它写「这个账号给备份脚本用」 |
| 6 | 家目录 | `cd ~` 的目标、`~/.ssh` 的父目录；**不存在会导致 SSH 密钥登录失败** |
| 7 | 登录 shell | `su -`/SSH 登录后执行的程序；服务账号应为 `/usr/sbin/nologin` 或 `/bin/false` |

`/etc/shadow` 九个字段（**未在本机验证**，以手册为准）：登录名、加密密码、**上次改密日（距 1970-01-01 的天数）**、最短使用期、最长有效期、告警天数、宽限天数、失效日期、保留位。密码字段的**前缀**比数值更重要：

| 开头 | 含义 | 现象 |
| --- | --- | --- |
| `$6$盐$散列` | SHA-512 crypt | 常规密码散列 |
| `$y$j9T$...` | yescrypt（较新 Debian/Ubuntu 默认） | 更抗 GPU 破解；升级系统后老散列仍在，直到用户下次改密才换 |
| `!` / `!!` | 密码被锁定 | `passwd -l` 的效果；`!!` 常见于「从未设过密码」 |
| `*` | 无有效密码 | 常由 `useradd` 不设密码产生 |
| 空 | **不需要密码即可登录** | 事故，不是配置；`awk -F: '$2==""' /etc/shadow` 扫一遍 |

字段语义以 [passwd(5)](https://man7.org/linux/man-pages/man5/passwd.5.html) 与 [shadow(5)](https://man7.org/linux/man-pages/man5/shadow.5.html) 为准。**这两个文件在本机根本不存在**（实测见下文）。别用编辑器直接改：`useradd`/`usermod`/`passwd` 是正道，`vipw`/`vigr` 才是给你手工编辑用的（加锁 + 校验字段数）。

## 三位八进制的真实含义：文件与目录是两套语义

`-rwxr-xr-x` 拆成**属主/属组/其他**三组，每组 `r=4 w=2 x=1` 相加。真正的高频误解在下面——**同一个字母，对文件和对目录说的是完全不同的事**：

| 位 | 对普通文件 | 对目录 |
| --- | --- | --- |
| `r` | 读内容（`cat`） | **列出目录里的名字**（`ls 目录` 能打印文件名） |
| `w` | 改内容 | **增删改名目录里的条目**——删的是条目，与那个文件自己的权限无关 |
| `x` | 执行（脚本还要 `r`） | **进入（`cd`）+ 按名字查找（路径解析）**。没有 `x`，任何「通过路径访问」都失败 |

三条由此推出的结论，每一条都是事故源：

**一、只有 `r` 没有 `x` 的目录**：`ls` 能列名字，但 `cat 目录/文件`、`cd 目录` 全部 `Permission denied`——这就是「我能看到文件，为什么读不了」。反过来**只有 `x` 没有 `r`**：能 `cd` 进去、能对确切名字的文件读写，但不能列目录。**这不是缺陷而是特性**：「知道确切文件名的人可访问、不许围观目录结构」，Web 服务器与共享目录常这么配。

**二、删文件靠的是所在目录的 `w` + sticky。** `-r-------- 1 bob bob`（`400`，谁都不能写）的文件放在 `drwxrwxrwx` 目录里，alice 能把它**删掉**（虽然改不了内容）。要挡住就得给目录加 sticky（`1777` 的 `/tmp` 正是如此）。

**三、路径每一级都要 `x`。** 访问 `/var/www/html/site/index.html` 需要四级目录全有 `x`，加上文件自身的 `r`。**开头那段 403 就死在这里**：`/home/deploy` 是 `750`，`www-data` 不在 `deploy` 组，缺 `x` → 整条路径解析失败 → Nginx 报 403，`error.log` 里通常是 `open() failed (13: Permission denied)`。

Linux 上这组对照实验的预期输出（**本机无法验证**）：

```bash
mkdir site && touch site/index.html
chmod 750 site && chmod 644 site/index.html
sudo -u www-data ls site           # 预期：Permission denied（缺 x，无法解析名字）
chmod 711 site                      # 属主 rwx，其他只给 x
sudo -u www-data ls site           # 预期：仍 Permission denied（列目录要 r）
sudo -u www-data cat site/index.html  # 预期：成功输出内容（有 x + 文件有 r）
```

`711` 那两行是本章最该动手验证的一组对照，它把「`r` 管围观、`x` 管通行」彻底分开。

<Callout type="verified" title="我在 Git Bash 上把权限实验跑了一遍，结论是这些实验全部无效">

本机（Windows 10 + Git Bash，MSYS 层）实测原文（账户名替换为占位值 `learner`，uid/gid 数字未改动）：

```text
$ umask 077; touch f077.txt; mkdir -p d077
$ stat -c '%a %A %n' f077.txt d077
644 -rw-r--r-- f077.txt
755 drwxr-xr-x d077
$ chmod 700 locked; stat -c '%a' locked
755
$ chmod 600 locked; stat -c '%a' locked
755
$ cat locked/inside.txt >/dev/null && echo "READ OK"
READ OK            # 「600 目录（无 x）」里照样能读，内核没有强制
$ chmod 4755 x.txt; stat -c '%a %A' x.txt
644 -rw-r--r--     # SUID 位直接被丢掉
$ chmod 1777 d000; stat -c '%a %A' d000
755 drwxr-xr-x     # sticky 位同样不存在
$ getfacl x.txt
getfacl: x.txt: Not supported
$ chown nobody x.txt
chown: invalid user: ‘nobody’
$ id
uid=197609(learner) gid=197609 groups=197609
$ head -n 1 /etc/passwd
head: cannot open '/etc/passwd' for reading: No such file or directory
```

**结论与含义**：NTFS 上没有 POSIX 权限位，MSYS 只能给你合成一套「看起来像 `644`」的默认值，所以 `umask 077` 拿不到 `600`、`chmod 700` 改不动任何东西、SUID/sticky 被直接丢弃、ACL 报 `Not supported`、没有 `nobody` 用户、`/etc/passwd` 与 `/etc/shadow` 不存在，`ls -l` 的属组列是裸数字（`stat` 里显示 UNKNOWN）。所以**本章的权限实验一个都不能在本机做**——上面这段的价值不在于「跑通了」，而在于用证据告诉你「这里跑不通」，你在 Git Bash 里得出的任何权限结论都不可迁移。真环境请用 WSL2 或虚拟机（见首页的三环境对照表）。

</Callout>

## chmod、chown、chgrp：数字、符号与递归

数字模式写三位（`644`）或四位。[chmod(1) 手册](https://man7.org/linux/man-pages/man1/chmod.1.html)对四位形式的定义我核实了原文：**"A numeric mode is from one to four octal digits... The first digit selects the set user ID (4) and set group ID (2) and restricted deletion or sticky (1) attributes."** 第一位只有 0/1/2/4/5/6/7 这几个有意义的组合，它们不是「读权限的另一种写法」而是特殊位。

符号模式更适合只改一项而不碰其他项：`who` 取 `u g o a`，操作符取 `+ - =`，权限字母手册原文 **"The letters rwxXst select file mode bits"**——大写 `X` 表示「只给目录、或已经有执行位的文件加 `x`」，`s`/`t` 对应特殊位。还有一条常被忽略（同为核实过的原文）：**"If none of these are given, the effect is as if (a) were given, but bits that are set in the umask are not affected."** 所以 `chmod +w file` 不等于 `chmod a+w file`。

日常对照表（Linux 上的目标值，**未在本机验证**）：

| 场景 | 目录 | 文件 |
| --- | --- | --- |
| Web 站点（Nginx 静态） | `755` | `644`，属主给部署用户、属组给 `www-data` |
| 家目录（有 `~/.ssh`）与 `~/.ssh` | `750` 与 `700` | **家目录绝不能 `g+w`/`o+w`**，否则 sshd `StrictModes` 拒绝密钥登录；私钥 `600`、`authorized_keys` `644` |
| 协作共享目录 | `2775` + 共同组 | `664`（靠 SGID 继承组，见特殊位一节） |
| 只有属主能看 | `700` | `600`，用 `chmod go-rwx`（比 `-R 600` 安全，不误伤执行位） |

**递归要分开处理目录和文件**：`chmod -R a+X` 让目录拿到 `x`、已可执行的文件保留 `x`、数据文件不加；反面例子 `chmod -R 777 目录` 把所有 `644` 变成可执行，还可能顺手毁掉 `~/.ssh`。另一条核实过的行为：**"chmod ignores symbolic links encountered during recursive directory traversals."** 递归不跟随符号链接——`chmod -R` 改不到链接目标，你以为改了其实没改，用 `ls -l` 第一列是不是 `l` 判断。

```bash
chown deploy:www-data /var/www/html        # 一条命令同时设属主与属组
chown -R deploy:deploy /srv/app            # 递归
chgrp www-data file                        # 只改组（需你是属主且本人在该组）
```

`chown` 只有 root 能做（改属主等于改「谁能删这个文件」）；属主则可以把文件 `chgrp` 到**自己所属的某个组**。部署目录归谁，本章建议：**属主给部署用户、属组给 `www-data`、目录 `2775`/文件 `664`**——Web 能读、部署脚本能写，不需要 `sudo` 也不需要 777。

## umask 是一个「减法掩码」：怎么算，从哪来

`umask` 不设置权限，它**从默认权限里扣掉一批位**。基准：新建**文件** `0666`，新建**目录** `0777`。结果 = 基准与 `umask` 取反按位与；快捷算法是**逐位减法但不借位**。

| umask | 文件（基准 666） | 目录（基准 777） | 典型场景 |
| --- | --- | --- | --- |
| `022` | `644` | `755` | 发行版默认，个人工作站 |
| `002` | `664` | `775` | 团队协作目录（配合共同组与 SGID） |
| `077` | `600` | `700` | 安全要求高的主机、堡垒机 |
| `027` | `640` | `750` | 组内可见、外部禁止；`/var/www` 常见 |

**为什么文件基准是 666 而不是 777？** 因为「新建文件就自带可执行位」不合理。所以 `umask 077` 与 `umask 022` 下新建文件都是「不可执行」，差别只在组和他人有没有 `r`——这个不对称就是「umask 明明改了，执行位还是没变」的答案。

来源按覆盖顺序：内核默认 → `/etc/login.defs` 的 `UMASK`（经 PAM 影响登录会话，默认多为 `022`）→ `~/.bashrc` 里的 `umask`（**只影响交互 shell，这是最常见的事故源**：你的 shell 是 002，systemd 起的服务不是）→ 单元的 `UMask=`（只对该服务进程树，最可控，见[进程、信号与 systemd](/linux/processes-and-systemd)）。验证只认实际值：`touch x; stat -c '%a' x`。**别把「新建文件的权限」归因于「chmod 没跑对」，先 `umask` 一下。**

## `sudo`、`/etc/sudoers` 与最小权限

`sudo` 干的事：以 root 身份（`/usr/bin/sudo` 在 Linux 上是 SUID root 或带 file capability 的程序）读 `/etc/sudoers`，判断「你这个 uid，在这台主机上，能不能以那个身份跑这条命令」，然后 `fork` + `setuid` + `exec`。策略层才是重点。

一行 sudoers 的语法骨架（**全部未在本机验证**，语义以 [sudoers(5)](https://man7.org/linux/man-pages/man5/sudoers.5.html) 为准）：

```text
deploy  ALL=(root)  /usr/bin/systemctl restart myapp.service
^       ^    ^      ^
谁      哪台 以谁的身份跑   能跑什么（必须绝对路径、含参数形式）
```

| 写法 | 含义 |
| --- | --- |
| `%sudo ALL=(ALL:ALL) ALL` | 整个组可以干任何事（Debian/Ubuntu 默认组名 `sudo`；RHEL 系是 `wheel`） |
| `deploy ALL=(root) NOPASSWD: /usr/bin/apt update` | 免密执行这一条 |
| `Cmnd_Alias LOGS = /usr/bin/tail -f /var/log/app/*.log`<br>`deploy ALL=(root) LOGS` | 别名把一组命令打包，好审计；`Defaults secure_path=...` 决定 `sudo` 下 `PATH` 是哪一条 |

**改它只用 `visudo`（或 `visudo -f /etc/sudoers.d/myapp`）**：`/etc/sudoers` 语法错误会让 `sudo` 全线拒绝工作，一台只有 `sudo` 一条通道的 VPS 就此把你锁在门外。`visudo` 会加锁、写临时文件、**装回去之前做语法校验**。写进 `/etc/sudoers.d/` 是正确做法（升级不覆盖），但**里面的文件有语法错会被 `sudo` 直接忽略并告警**——「我明明加了为什么不行」的真相往往就在这；落盘前跑 `visudo -c`，输出 `parsed OK` 才算过关。另外该目录里**以 `~` 结尾或含 `.` 的文件名会被忽略**，`myapp.conf` 这种命名直接失效，用 `myapp` 或 `90-myapp`。

`NOPASSWD` 的风险不是「少输一次密码」，而是**它把这条命令变成了提权通道**。判断标准只有一条：**这条命令有没有能力再执行别的东西。**

| 允许的命令 | 风险 | 为什么 |
| --- | --- | --- |
| `/usr/bin/systemctl restart myapp` | 可接受 | 不读任意路径、不开交互界面，动作有限 |
| `/usr/bin/less /var/log/app.log` | **高** | `less` 里敲 `!sh` 就有 shell；`more`、`vi`、`man`、`awk`（`system()`）、`find -exec`、`git` 同理 |
| `/bin/bash`、`ALL=(ALL) NOPASSWD: ALL` | 等于 root | 账号一旦被攻破（弱密码、泄露密钥、Web RCE），攻击者立刻拿到 root |

这类「合法工具可用来起 shell」的清单在 GTFOBins 项目里有系统整理（本站不复制其内容，只提醒存在）。生产原则：**能用 systemd 单元解决的事不要靠 `sudo` 授权；确实要授权就精确到完整路径与参数形式，且不允许任何能开子进程的程序。**

`sudo` 与 `su` 的差别：**认证**——`sudo` 用你自己的密码，`su` 要目标用户的密码；**审计**——`/var/log/auth.log` 记录「谁 sudo 了什么」，`su` 只知道有人成了谁；**环境**——`sudo` 按 `env_reset` + `secure_path` 清洗，`su` 保留大量当前环境（`su -` 才重建）。现代发行版常禁用 root 密码，所以 `sudo -i` 是首选。顺带解释上一章那个坑：**`sudo` 下 `PATH` 变了**（`secure_path` 典型值 `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`），`sudo npm -v` 找不到 nvm 装的 npm 就是这个原因，正道是把程序装进系统路径（见[软件包与运行环境](/linux/packages-and-runtime)）。

## 服务账号该不该有登录 shell：`nologin` 与 `false`

`su -` 与 SSH 登录最终会执行 `/etc/passwd` 第 7 字段指定的程序。`/bin/bash` 给人用；`/usr/sbin/nologin` 连接后立即拒绝并打印一行提示（文案在 `/etc/nologin.txt` 可改），**SSH 也能给用户可读的错误**，这是它优于 `/bin/false` 的唯一理由；`/bin/false` 立即退出、零提示，扫描者拿不到信息。

原则：**给人管理的账号要有 shell；纯服务账号一律 `nologin` 或 `false`**（Debian/Ubuntu 上 `postgresql`、`www-data` 的 shell 就是 `nologin`，用 `getent passwd www-data` 看，**未在本机验证**）。服务账号被攻破时攻击者的第一需求是拿到一个能跑反向连接、能读 `.bashrc` 的 shell，没有 shell 就多一道墙；但**这只是一层防御**，进程本身的权限（下一章的 `User=`）才是关键。

```bash
useradd -r -m -d /var/lib/myapp -s /usr/sbin/nologin -g myapp myapp
#         ^系统账号  ^建家目录  ^禁止登录        ^主组
adduser --system --group --home /var/lib/myapp --shell /usr/sbin/nologin myapp
#  ^ Debian 系的 Perl 封装：自动建家目录、写注释、交互确认
```

`useradd` 是底层工具（RHEL 系唯一选择），**不带 `-m` 不会建家目录**，而缺家目录是「服务起来但读不到 `~/.myapp/config`」的头号原因；`adduser` 做得更多，也意味着脚本里行为不一致。`usermod -aG` 的 `-a` 不能省（少了会**覆盖**整个附加组，是删权限的经典事故）。删账号用 `userdel -r`，**没 `-r` 会留下没人认领的目录**，日后有人被分到同一 UID 就凭空继承一堆别人的文件权限。

## SSH 密钥的权限：不对会怎样

OpenSSH 客户端和服务端都做 **StrictModes** 检查：任何「参与认证的文件被别人能改」都视为不可信，直接拒绝。道理是信任边界——若组可写，同组任何人都能把自己加进 `authorized_keys`，密钥登录就不再证明身份。

| 文件/目录 | 权限 | 错成什么会怎样 |
| --- | --- | --- |
| `~/.ssh/` | `700` | `755` 尚可容忍；**带 `g+w`/`o+w` 时服务端拒绝** |
| 私钥（客户端） | `600` | Linux 客户端原文 `Permissions 0644 for 'id_ed25519' are too open.` → **直接不加载这个密钥**，回落密码认证或 `Permission denied (publickey)` |
| 公钥 `.pub` | `644` | 公钥泄露无害 |
| `authorized_keys`（服务端） | `600`/`644`，属主必须是本人 | 属主成了 root（用 `sudo` 编辑留下的）→ 认证**静默**失败 |
| 家目录本身 | 不能 `g+w`/`o+w` | 常漏检：`775` 的家目录会让密钥登录失败，报错和密钥本身无关 |

Windows 侧的真问题（前面已实测本机 `chmod` 是空操作，所以这条我有把握给方向）：**Git Bash 里对私钥 `chmod 600` 不会改变 Windows ACL**，而 OpenSSH for Windows 看的是 NTFS ACL，不是 MSYS 的假 `644`。正确做法：

```console
# PowerShell：关掉继承，只给自己读权限
icacls $env:USERPROFILE\.ssh\id_ed25519 /inheritance:r /grant:r "$($env:USERNAME):R"
```

而**用 Git Bash 自带的 `ssh` 客户端**时它认的是 MSYS 模式位，行为可能和上面相反——这正是「同一把私钥，换个客户端就好/坏」的原因。判据只有一个：把报错原文抄下来。`Host key verification failed` 属于另一回事（known_hosts 冲突），完整 SSH 加固在[服务器安全](/linux/server-security)。

## 特殊权限：SUID、SGID、sticky bit

`rwsr-xr-x` 里那个小写 `s`、`drwxrwxrwt` 末尾的 `t` 就是特殊位，由四位模式的第一位控制（含义见前面引用的手册原文）：

| 值 | 名称 | 文件上的效果 | 目录上的效果 | `ls -l` 里的样子 |
| --- | --- | --- | --- | --- |
| `4000` | set-user-ID | 执行时**有效 UID 变成文件属主**：`/usr/bin/passwd` 是 `-rwsr-xr-x root`，所以普通用户能改 `/etc/shadow` | 目录里新建文件属主 = 目录属主（少见） | 属主执行位写 `s`；**大写 `S` = 有 SUID 却没执行位，是配置错误** |
| `2000` | set-group-ID | 执行时有效 GID 变成文件属组 | **组继承**：目录里新建的文件/子目录属组 = 目录属组（子目录继续往下传），团队共享目录的标准做法 | 组执行位 `s` / 大写 `S` |
| `1000` | sticky | 现代 Linux 上对普通文件基本无意义 | **只能由属主/root 删除目录里的条目**，即使目录是 `777`；`/tmp` 就是 `drwxrwxrwt` | 其他执行位 `t` / 大写 `T` |

两个必做的审计动作（Linux 上，**未在本机验证**）：`find / -xdev -perm -4000 -type f 2>/dev/null` 出全盘 SUID 清单与「已知集合」比对，`find / -xdev -perm -2000 -type f 2>/dev/null` 同理，再加 `ls -ld /tmp /var/tmp`。

SUID 是提权审计的第一入口：任何 SUID root 程序都是「以 root 身份跑、由你控制参数」的入口，只要有任意文件读写/命令执行/解析漏洞就能拿 root。发行版自带的集合有限且已知（`su`、`passwd`、`ping`、`mount`、`sudo`、`newgrp`），**你自己 `chmod 4755` 出来的每个 SUID root 二进制都是可疑面**。需要「以特权做一件小事」时正道是 sudoers 精确授权或 systemd 的 `AmbientCapabilities`，而不是 SUID 一个脚本——**Linux 内核忽略脚本上的 SUID 位**，给 `.sh` 加 `4755` 完全无效。

团队协作目录的配法（三步，顺序有意义，**未在本机验证**）：

```bash
groupadd deploy && usermod -aG deploy alice && usermod -aG deploy bob
mkdir -p /srv/app && chgrp deploy /srv/app && chmod 2775 /srv/app
# alice 与 bob 都要 umask 002，并重新登录让附加组生效
```

`2775` 里的 `2` 是 SGID（不是 sticky），`775` 是目录权限。少了 `umask 002` 这一环，SGID 只保证「组对」、权限还是 `644`，同事照样写不进去——**SGID 管组继承，umask 管组权限位，两者必须同时配**。

## ACL：三位八进制不够用时才上它

一个文件只能有一个属主、一个属组。需求是「`deploy` 组要能写，`backup` 用户要能读，`alice` 只要能看日志头」时 `rwx` 三组不够，用 POSIX ACL（`ext4`/`xfs` 默认支持，NFS 需导出选项）。

```bash
setfacl -m u:backup:r-- /var/log/app/access.log   # 给单个用户加一条
setfacl -m g:deploy:rw- /srv/app                  # 给一个组
setfacl -d -m g:deploy:rwx /srv/app               # 默认 ACL：此后新建条目自动继承
setfacl -x u:backup /var/log/app/access.log       # 删一条；-b 是清空全部
getfacl /var/log/app/access.log
```

`getfacl` 的输出（**预期结果，未在本机验证**——本机直接报 `Not supported`）：

```text
# file: var/log/app/access.log
# owner: root
# group: adm
user::rw-
user:backup:r--
group::r--
group:deploy:rw-
mask::rw-
other::r--
```

必须理解的坑是 `mask`：它是**所有「命名用户/命名组」条目的上限**。上表里 `group:deploy:rw-` 实际生效是 `rw`，但如果之后有人跑了 `chmod g=r /path`，mask 被压到 `r`，`deploy` 就写不进去了——`ls -l` 上表现为组执行位变成 `+`（`-rw-rw-r--+`），那个 `+` 就是「此文件有 ACL」的暗号。**诊断顺序**：看到 `+` → `getfacl` → 先看 `mask`。这也是**能用组解决就别用 ACL** 的原因：ACL 让「谁能访问」不再能从 `ls -l` 一眼看出。

## 权限位之上还有强制访问控制：SELinux 与 AppArmor

这是最多人「权限明明对，还是 Permission denied」的终点。**前面所有位都属于 DAC（自主访问控制）**：属主可以随意改。**MAC（强制访问控制）**是内核之上的另一套策略，由安全模块执行，属主改不动，`chmod` 对它零影响：

| | AppArmor | SELinux |
| --- | --- | --- |
| 默认在哪 | **Debian/Ubuntu 默认**，以 profile 限制自带 profile 的守护进程 | RHEL/CentOS/Fedora/Alma/Rocky 默认 **enforcing** |
| 策略单位 | 按可执行文件路径的 profile | 按类型（type）与标签的策略矩阵 |
| 怎么看 | `sudo aa-status`、`ls /etc/apparmor.d/` | `getenforce`、`sestatus`、`sudo semanage port -l` |
| 日志 | `journalctl -k` 里 `apparmor="DENIED"` | `/var/log/audit/audit.log`（`ausearch -m avc -ts recent`）、`dmesg` 里 `avc: denied` |
| 文件上的标记 | 无（按路径匹配） | `ls -Z` 显示安全上下文，如 `http_sys_content_t` |
| 临时放行 | `sudo aa-complain /etc/apparmor.d/名字` | `sudo setenforce 0`（**运行时临时宽容，重启回 enforcing**） |

典型现象：Nginx 换到非标准端口 `8081` 后 `bind() to 0.0.0.0:8081 failed (13: Permission denied)`，文件与目录权限全对。DAC 下 root 可以绑任何端口——这是 SELinux 的端口类型标签在拦，正解是 `sudo semanage port -a -t http_port_t -p tcp 8081`（**未在本机验证**）。**不要因为 MAC 报错就整体关掉它**：`setenforce 0` 是排查手段不是修法，写策略（`audit2allow` 生成模块、给内容目录打上 `httpd_sys_content_t`）才是。

## 排查「Permission denied」的固定顺序

现象只有一个（`EACCES`；`Operation not permitted` 是另一回事 `EPERM`），原因链是固定的，照着走不要跳步：

| 步 | 检查什么 | 命令与判据 |
| --- | --- | --- |
| 1 | 我是谁 | `id`；服务则看它用什么身份跑（`ps -o user= -p PID`、单元 `User=`）。附加组里有没有目标组，新加组要重登录 |
| 2 | 路径每一级能不能过 | `namei -l /var/www/html/site/index.html`：一行一级列出权限，缺 `x` 的那级一眼看到——**本节最有用的工具** |
| 3 | 目标本身的位 | `ls -l` + `stat -c '%A %U %G' file`：数字/符号与预期一致？属主属组对不对？ |
| 4 | 有没有 `+` | 看到 `-rw-rw-r--+` 就 `getfacl`：ACL 的 `mask` 压住了实际权限 |
| 5 | 特殊位 | `ls -l`、`find -perm`：大写 `S` 意味着 SUID 无执行位（配置错） |
| 6 | MAC | `getenforce` / `aa-status` / `journalctl -k`：有 `avc: denied` 或 `apparmor="DENIED"` 就是它 |
| 7 | 进程视角 | `sudo -u 服务用户 真实命令`：**用报错进程的 UID 复现，比用自己的 shell 试可靠一万倍** |
| 8 | 是不是别的机制 | 容器、`chroot`、只读挂载（`mount \| grep ' ro,'`）、`ProtectSystem=strict`、`df -h`：磁盘满报的是 `ENOSPC`，常被误读成权限 |

第 7 步是新手与老手的分水岭：你本人 `cat` 得动，不代表 `www-data` 读得到。`sudo -u www-data cat /var/www/html/site/index.html` 一条命令就能定界。

## 常见错误与排查

**1. 现象：文件 `644`、属主正确，Nginx 还是 403。** 原因：路径某一级目录缺 `x`（最常见 `/home/用户名` 是 `750`/`700`）。确认：`namei -l 完整路径`，或在 `error.log` 里找 `open() ... Permission denied` 那行的路径。修法：把站点放到 `/var/www/`（各级本来 `755`）；或 `chmod o+x /home/deploy` 只给通行不给列名（注意这也让别人能探测该目录下确切存在的文件名）；或用 ACL 精确给 `www-data` 加 `--x`。

**2. 现象：改完 `authorized_keys`，密钥登录失效。** 原因：`~/.ssh` 或家目录被组/其他写（StrictModes 拒绝），或 `authorized_keys` 属主成了 root。确认：服务端 `sudo journalctl -u ssh -n 50`，典型原文 `Authentication refused: bad ownership or modes for directory /home/deploy`；本地加 `-v` 看客户端提交了哪把密钥。修法：`chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys && chown -R deploy:deploy ~/.ssh`。**别用 `chmod -R 777 ~/.ssh` 试错**，那是本章最坏的修法，只会更确定地失败。

**3. 现象：`usermod -aG www-data deploy` 之后部署脚本还是写不了。** 原因：附加组在登录时固化，当前 session 没更新。确认：`id` 里有没有 `www-data`。修法：新开 SSH session；systemd 服务改完要 `daemon-reload && restart`（下一章）。同类现象还有「新目录里的文件总是 `644`，同组同事写不进去」——那是 `umask 022` 且目录没 SGID，修法 `chmod 2775 目录` + 组内 `umask 002`，服务写的文件由单元 `UMask=0002` 控制。

**4. 现象：`sudo visudo` 报 syntax error，之后所有 `sudo` 都不通。** 原因：手工编辑或用 `echo >>` 追加导致语法错。修法：还有已登录 root session 就用它 `visudo -c` 定位行号，把错的 include 文件整体删掉；没有就只能走云厂商 VNC/救援模式。**所以改 sudoers 前先确认你有第二条进 root 的路。**

**5. 现象：权限位、属主、SELinux 都正常，报的却是 `Operation not permitted`。** 原因：这是 `EPERM` 不是 `EACCES`——通常是能力被剥夺（systemd 的 `ProtectSystem=strict`、`PrivateTmp=`、缺 `AmbientCapabilities`、非 root 想绑 1024 以下端口、想 `chown`）。确认：`grep CapEff /proc/PID/status` 看能力掩码（`/proc` 见下一章）。修法：给服务加最小必要能力（`AmbientCapabilities=CAP_NET_BIND_SERVICE`）而不是 `User=root`。

## 练习

<Exercise title="练习 1 · 算出 umask 的结果" difficulty="基础">

不查表直接回答：`umask 027` 时 `touch a` 与 `mkdir d` 分别得到什么权限？换成 `umask 111` 呢？`umask 0` 时新建的文件会有执行位吗，为什么？

<template #answer>

`umask 027`：文件基准 `666` 去掉 `27`（`2` 抹掉组的写、`7` 抹掉其他全部）→ `640`；目录基准 `777` → `750`。

`umask 111`：只去掉三个执行位 → 文件 `666 & ~111 = 666`（**文件本来就没有执行位，减不掉**），目录 `777 & ~111 = 666`。目录变成 `666` 意味着**没有 `x`**：你能 `ls` 它但进不去，里面任何文件都无法通过路径访问——这是 `umask 111` 的真实危险，也是「文件不受影响、目录被打死」的典型例子。

`umask 0`：文件 `666`（**没有执行位**，因为基准是 `0666`）、目录 `777`。所以「umask 设 0 会让所有新文件可执行」是错的：对普通文件它只是 `rw-rw-rw-`，任何人可写才是真问题。

补充：`umask -S` 在 `027` 下输出 `u=rwx,g=,o=`，符号形式表示的是「被 mask 掉的位」，`g=` 为空不代表组只剩读。判据永远是实际值 `touch x; stat -c '%a' x`——本章 Callout 已用实测说明本机 Git Bash 拿不到真值，必须到 Linux 上做。

</template>

</Exercise>

<Exercise title="练习 2 · 判断 403 卡在哪一级" difficulty="进阶">

现状：`-rw-r--r-- 1 deploy deploy 2048 /home/deploy/site/index.html`，`/home/deploy` 是 `drwxr-x---`，`/home/deploy/site` 是 `drwxr-xr-x`，Nginx 以 `www-data` 运行。回答：

1. `www-data` 能否读到 `index.html`？卡在哪一级？
2. 给出最小改动（不许 `chmod -R 777`，也不许把站点文件属主改成 `www-data`）。
3. 改完用什么一条命令逐级确认？

<template #answer>

1. **读不到。** 文件自身 `644` 给了 `o+r`，但路径解析要经过 `/home/deploy`，它 `drwxr-x---` 对「其他」是 `---`，`www-data` 既不是 `deploy` 也不在该组 → 缺 `x`，连解析 `site` 这个名字都做不到。`/home/deploy/site` 的 `755` 完全用不上，因为它在链条更深处，走不到。

2. 两个方向都比 777 好：

```bash
chmod o+x /home/deploy          # 方案 A：给「其他」只加通行位，变成 751
usermod -aG deploy www-data     # 方案 B：让服务用户进入目录属组，目录保持 750
```

方案 B 要选对方向：目录属组是 `deploy`，所以应该把 `www-data` **加进 `deploy` 组**。注意 `usermod -aG 组 用户` 的参数顺序——写成 `usermod -aG www-data deploy` 是把 deploy 加进 www-data 组，方向完全反了。组的生效需要重启服务（进程身份在服务启动时固定）。**更工程化的答案其实是「站点别放 `/home` 下，放 `/var/www`」**；考点在于你能不能指出是 `/home/deploy` 这一级拦的。

3. `namei -l /home/deploy/site/index.html`：从 `/` 开始一行一级打印权限与属主，缺 `x` 的那行直接显形。再用进程身份实证：`sudo -u www-data cat /home/deploy/site/index.html`（预期成功）。**`namei -l` 是必须记住的那条命令。**

</template>

</Exercise>

<Exercise title="练习 3 · 故意把 sudoers 写坏并解释现象" difficulty="进阶">

你在 `/etc/sudoers.d/myapp` 里写下（**未在本机验证**，请在虚拟机里做，先快照）：

```text
deploy ALL=(root) NOPASSWD: /usr/bin/less /var/log/app/*.log
```

回答：

1. `visudo -c` 会报语法错吗？这条授权本身有什么问题？
2. `deploy` 执行 `sudo less /var/log/app/error.log` 之后，怎样在**不使用任何漏洞**的情况下拿到 root shell？写出你敲的按键。
3. 保留「看日志」的需求，给出安全的替代方案（至少两种）。

<template #answer>

1. **语法合法**（路径通配形式 sudoers 支持），所以 `visudo -c` 会报 OK——这正是危险所在：语法检查通过不等于授权安全。问题在于 `less` 是「能起子进程的程序」。

2. 在 `less` 提示符里敲 `!sh`（或 `!/bin/bash`）回车，`less` 会用**它自己的 euid（root）**起一个 shell，立刻得到 `#` 提示符。同类工具一大把：`more`、`vi`（`:!/bin/sh`）、`man`（`!/bin/sh`）、`awk`（`BEGIN{system("/bin/sh")}`）、`find -exec /bin/sh ;`、`git`（`:!sh`）。所以「`NOPASSWD` 给任何能开交互界面或执行子命令的程序」等于交出 root。

3. 替代方案：**其一**，不给交互程序，给只能读的工具并把参数一起钉死——`deploy ALL=(root) NOPASSWD: /usr/bin/journalctl -u myapp *, /usr/bin/tail -n 200 /var/log/app/error.log`。**其二（更推荐）**，完全不给 sudo：把 `error.log` 设成 `640 root:adm`，让 `deploy` 进 `adm` 组（`usermod -aG adm deploy`）——没有 sudo 就没有提权通道；现代做法是让服务直接写 journald，读日志靠 `systemd-journal` 组权限（下一章）。另外提醒：**通配 `*` 会匹配任意字符串与空格**，`/usr/bin/less /var/log/app/*.log` 里 `less` 仍能接受额外参数（`-x`、甚至 `-` 开头的怪路径），所以精确授权要连参数形式一起钉死，或换成没有参数注入面的一条命令。

</template>

</Exercise>

## 官方文档与延伸阅读

- [chmod(1) — man7.org](https://man7.org/linux/man-pages/man1/chmod.1.html) —— 本章「四位八进制第一位 = setuid(4)/setgid(2)/restricted deletion 或 sticky(1)」「符号字母 rwxXst」「未指定 who 时按 `a` 处理但受 umask 影响」「递归时忽略符号链接」四条的出处，这四条已逐句核实。
- [passwd(5)](https://man7.org/linux/man-pages/man5/passwd.5.html) 与 [shadow(5)](https://man7.org/linux/man-pages/man5/shadow.5.html) —— 七字段与九字段的权威定义（本章按手册叙述列出，**未在本机验证**，因为本机没有这两个文件）。
- [useradd(8)](https://man7.org/linux/man-pages/man8/useradd.8.html)、[usermod(8)](https://man7.org/linux/man-pages/man8/usermod.8.html)、[userdel(8)](https://man7.org/linux/man-pages/man8/userdel.8.html) —— `-r`/`-m`/`-d`/`-s`/`-g`/`-G` 的语义、`-aG` 与 `-G` 的区别、`/etc/login.defs` 里的 UID 范围默认值。
- [sudoers(5) 手册](https://man7.org/linux/man-pages/man5/sudoers.5.html) 与 [sudo 官网](https://www.sudo.ws/) —— sudoers 语法表、`env_reset`/`secure_path`、`sudoers.d` 命名规则均以它为准。**说明：本次我没有抓取该页原文（工具轮次预算限制），以上按稳定语义叙述，动手前请以手册为最终依据。** `NOPASSWD` 给 `less`/`awk` 可起 shell 属公认事实，具体按键建议自己在虚拟机复现后再引用。
- [setfacl(1) / getfacl(1) / acl(5)](https://man7.org/linux/man-pages/man5/acl.5.html)、[Ubuntu 官方 AppArmor 文档](https://documentation.ubuntu.com/server/how-to/security/apparmor/) 与 [OpenSSH 手册（sshd(8) 的 StrictModes）](https://www.openssh.com/manual.html) —— `mask` 如何限制命名条目、默认 ACL、`ls -l` 末尾 `+` 的含义（**本机 `getfacl` 实测报 `Not supported`**）；两套 MAC 的判读命令；以及「为什么权限不对会拒绝密钥登录」的正式定义。

## 下一章

本章把「谁能碰什么」讲完：UID 是内核唯一的身份货币、`rwx` 对目录换了一套语义、`umask` 做减法、`sudo` 的授权边界、特殊位与 ACL 是补充而不是替代、MAC 压在这一切之上。下一章进入**「谁在跑、以什么身份跑、死了谁负责」**：[进程、信号与 systemd](/linux/processes-and-systemd)。本章的结论会在那里落地——单元的 `User=`/`Group=` 就是这里的 UID/GID 模型，`UMask=` 决定服务新建文件的权限，`ProtectSystem=strict` 造成的 `Operation not permitted` 不是本章的 DAC 问题，而 `kill -9` 之后谁替它收尸取决于父进程有没有在 `wait`。
