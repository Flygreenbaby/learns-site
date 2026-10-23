# 装上了、却「命令不存在」：PATH 顺序、启动文件时机与可复现的运行环境

同一台服务器上，你在终端里敲 `pm2 list` 好好的，把它写进 crontab 的那行却每晚报 `/bin/sh: 1: pm2: not found`，退出码 127。你用版本管理器把 Node 从 20 切到 22，`node -v` 立刻变了，但 systemd 拉起的那个服务跑的仍是 20。你在 Debian 上 `apt install nodejs`，装完发现是两年前的版本，于是加了第三方源，结果两条候选记录开始互相抢一个命令名。

这三件事看起来毫无关系，实际是同一套规则的三个切面：**包管理器只负责把文件放到磁盘上并登记，它从不管「这个名字能不能被找到」**。能不能找到由另外三件事决定——PATH 是一条有序列表，从左到右第一个命中就赢；把目录塞进 PATH 的那行配置写在某个启动文件里，而启动文件只在特定调用方式下才被读；进程继承的是父进程启动那一刻的环境副本，不是你的 rc 文件。

这一章把这三条规则逐条实测，再把它推到 apt、软件源、版本管理器与「换一台干净机器还装得起来吗」这个问题上。前置是[命令行基础](/linux/command-line)里 glob 与引号的机制，以及[用户与权限](/linux/users-and-permissions)里「属主与属组决定读不读得到」的结论；第 3 章讲的 systemd 会在本章末尾接上「服务的执行环境从哪来」。

<Callout type="verified" title="本章实测环境，以及三处不能迁移到 Linux 的结论">

本章标「实测」的部分都在本机真实执行：**Windows 10 x64 + Git for Windows 的 Git Bash**，`GNU bash 5.2.37(1)-release (x86_64-pc-msys)`、coreutils 与 findutils 为 GNU 版本、`curl 8.17.0 (x86_64-w64-mingw32)`、Node v25.4.0，日期 2026-10-19，临时文件建在 `linux/.scratch/` 下的沙箱目录并已删除。

**三处不可迁移，正文逐条标注**：① 可执行位——NTFS 与 MSYS 不实现 Linux 的 x 位语义，本机「不 chmod 也能执行」不能当作 Linux 的结论；② `apt`、`systemctl`、`man`、`nc` 在本机都不存在（实测 `command -v` 全部找不到），所有 Linux 包管理与服务管理命令只给命令、预期输出与验证方法，一律不声明执行过；③ 沙箱路径与本机网卡信息在正文里做了掩码（写成 `<沙箱>`）。反过来，**bash 的 PATH 查找、命令哈希、启动文件读取时机、变量继承这四组行为是 bash 与 libc 自身的规则，与操作系统无关，可以放心迁移**。

</Callout>

## 一次安装做的三件事里，没有一件叫「让你的命令能用」

先把「装软件」拆开。以 Debian 系为例，`apt install` 成功之后落在磁盘上的是这几类东西：

| 安装动作 | 典型位置 | 你该怎么核对 |
| --- | --- | --- |
| 可执行文件 | `/usr/bin`、`/usr/sbin`（发行版打包的）；`/usr/local/bin`（编译安装的惯例位置） | `dpkg -L 包名`，只看 bin 目录那一列 |
| 文件清单与安装状态 | `/var/lib/dpkg/info/`、`/var/lib/dpkg/status` | `dpkg -l 包名` 的第一列状态字母 |
| 配置 | `/etc/包名/` | `dpkg -L 包名` 里筛 `/etc` 开头；升级时是否覆盖由 conffile 机制决定 |
| 服务定义 | `/lib/systemd/system/*.service` | 见[进程、信号与 systemd](/linux/processes-and-systemd)，装了 unit 不等于启用了 |

注意这张表里没有一行叫「PATH」。命令目录之所以通常能直接用，是因为发行版已经把 `/usr/bin` 放进了默认 PATH——**它是「恰好在列表里」，不是「安装自动生效」**。这条区别在下面三个现场里都会咬你一口。

而 Linux 上「能不能执行这个文件」还多一道闸：可执行位。这一点本机复现不了，先看本机实测到的相反现象。

```bash
# 实测 E1：故意不 chmod，直接按路径执行
"$S/v1/myapp"; echo "退出码=$?"      # S 是沙箱目录
bash "$S/v1/myapp"; echo "退出码=$?"
chmod +x "$S/v1/myapp"; ls -l "$S/v1/myapp"
```

```text
myapp 1.0.0（旧版）
退出码=0
myapp 1.0.0（旧版）
退出码=0
-rwxr-xr-x 1 <用户> <组> 51 Oct 19 18:17 <沙箱>/v1/myapp
```

前两次执行都发生在 `chmod` **之前**——这台机器上按路径执行根本不检查可执行位。第三行 `ls -l` 是 chmod 之后拍的，别误读成「不 chmod 也显示 rwx」；但 MSYS 的 `ls -l` 权限位本身是**文件系统的报告值**而不是执行判据，第 2 章实测过 `chmod 600` 之后 `ls -l` 仍显示 `-rw-r--r--`（见本节末尾的复核）。

<Callout type="unverified" title="可执行位在 Linux 上是硬闸门，本机复现不了">

Linux 上直接执行一个没有 x 位的脚本会得到 `Permission denied`（退出码 126），而 `bash 脚本名` 这种显式指定解释器的调用永远不需要 x 位。**这条本机无法验证**：MSYS 不实现 Linux 的权限位。你在服务器上核对的方法很短：`ls -l 脚本`；`[ -x 脚本 ] && echo 有 || echo 没有`；`bash -c './脚本'` 与 `bash -c 'bash 脚本'` 各跑一次，比较退出码。

</Callout>

## PATH 是一条有序列表，第一个命中就赢

这是本章最值钱的一条规则，而且完全可本机验证。造两个同名不同版本的可执行文件，放两个目录，只改 PATH 的顺序。

```bash
# 实测 E2
export PATH="$S/v1:$S/v2:$PATH"
command -v myapp
myapp
PATH="$S/v2:$S/v1:$PATH"
command -v myapp
myapp
```

```text
<沙箱>/v1/myapp
myapp 1.0.0（旧版）
<沙箱>/v2/myapp
myapp 2.3.1（新版）
```

**同一个命令名，两次执行用了两个不同的文件，中间只动了 PATH 的左右顺序。**这就是「我明明装了新版本」的标准答案：不是没装，是被列表里更靠前的旧副本赢了。`/usr/local/bin` 与 `/usr/bin` 谁在前面，发行版之间就不同，你的 shell 启动文件还可能再改一次——所以**任何「版本不对」的问题，第一步都是问「解析到了哪个文件」，而不是问「装没装」**。

顺带纠正一条流传很广的经验：改了 PATH 必须 `hash -r`。

```bash
# 实测 E3：换了 PATH 之后，故意不做 hash -r
( PATH="$S/v1:$S/v2:$PATH"
  hash -r; myapp
  PATH="$S/v2:$S/v1:$PATH"
  echo "换 PATH 后不 hash -r，直接再跑一次："
  myapp )
```

```text
myapp 1.0.0（旧版）
换 PATH 后不 hash -r，直接再跑一次：
myapp 2.3.1（新版）
```

bash 5.2 下，**给 PATH 赋值这个动作本身就让旧的哈希条目失效**，下一条命令就用新列表。`hash -r` 真正的用途是另一种场景：哈希表里存着「上次解析到的路径」，你用 `type` 能看见它。

```text
# 实测 E8，逐字输出
type myapp  -> myapp is hashed (/…/w4pkg/v2/myapp)
which myapp -> <沙箱>/v2/myapp
command -v  -> <沙箱>/v2/myapp
对 builtin：command -v echo -> echo
找不到时：command -v definitely-not-here 退出码=1（且默认不打印任何错误）
```

| 你要确认什么 | 用哪条 | 为什么 |
| --- | --- | --- |
| 这个命令名解析到哪个文件 | `command -v 名字` | POSIX，脚本里可用；找不到时静默返回 1，适合做判断 |
| 它是文件、内建还是 alias，以及有没有被哈希 | `type -a 名字` | 只有 `type` 能区分 alias 与内建（实测 `type ll -> ll is aliased to 'foo'`） |
| 交互式排查、想顺便看哈希路径 | `which 名字` | `which` 是外部程序，行为随发行版不同，别写进脚本 |
| 到底装没装、装在哪 | `dpkg -L 包名`（Linux） | PATH 里的副本只说明「能被找到」，不说明「是谁装的」 |

版本管理器做的事，本质就是这一条规则。用两个假的 `node` 复现：

```bash
# 实测 E7
chmod +x "$S/n/20.11.1/bin/node" "$S/n/22.5.0/bin/node"
( PATH="$S/n/20.11.1/bin:$PATH"; command -v node; node --version )
( PATH="$S/n/22.5.0/bin:$PATH"; command -v node; node --version )
```

```text
切到 20：<沙箱>/n/20.11.1/bin/node → v20.11.1
切到 22：<沙箱>/n/22.5.0/bin/node → v22.5.0
对照：显式给 bash -c 时 node 解析到 → <沙箱>/n/22.5.0/bin/node
```

`node --version` 打印出 `v20.11.1` / `v22.5.0` 是**假脚本的输出**（它们是我写的一行 echo），这正是要看的点：所谓「切换版本」就是把某个目录顶到 PATH 最左。所以它有两个必然后果：只对**继承了这个 PATH 的进程**生效；一旦某个调用方重置了 PATH，切换就地失效——下一节就是这个后果的现场。

## 启动文件：谁在什么时候被读

把「PATH 里为什么有那个目录」追到根上，就是这个问题。用沙箱 HOME（三个文件各打一行标记，不碰真实 HOME）实测八种调用方式：

| 调用方式 | 读到的文件（实测） | 这对应现实里的什么 |
| --- | --- | --- |
| `bash -c '…'` | 什么都不读 | 脚本第一行 `#!/usr/bin/env bash`、CI step、`sh -c` |
| `bash -i -c '…'` | `.bashrc` | 你在终端里手敲命令 |
| `bash -l -c '…'` | `.bash_profile` | `bash -l` 包起来的调用 |
| `bash -i -l -c '…'` | `.bash_profile` | 登录 + 交互 + 带命令 |
| `bash -i -l < /dev/null` | `.bash_profile` | 最接近你 SSH 上去的那个 shell |
| `bash --norc --noprofile -i -c` | 什么都不读 | 显式关掉读文件 |
| `sh -c '…'` | 什么都不读 | `#!/bin/sh`、cron 的默认 shell |
| `sh -i -c '…'` | 什么都不读 | POSIX 模式的交互 shell |
| `ENV=沙箱/.bashrc sh -i -c '…'` | `.bashrc` | sh 只认 `$ENV` 指定的那一个文件 |

```text
# E4 逐字输出（节选）
--- bash -c            （非登录 + 非交互）
--- bash -i -c         （交互 + 非登录）
  [读到 .bashrc]
--- bash -l -c         （登录 + 非交互）
  [读到 .bash_profile]
--- bash -i -l  从 /dev/null 读命令（最接近真实登录终端）
  [读到 .bash_profile]
--- sh -i -c           （POSIX 模式：只认 $ENV 指定的文件）
--- sh -i -c 且 ENV 指向 .bashrc
  [读到 .bashrc]
```

**两个维度各自独立**：`交互`决定读不读 `.bashrc`，`登录`决定读不读 `/etc/profile` 与 `~/.bash_profile`/`~/.profile`。而 `-c` 让 shell 执行完命令就退出，所以「登录 + 命令」这一格实测只读到 `.bash_profile`——**这条是本机观察，Linux 上的细节以 GNU Bash 手册的启动文件一节为准，动手前核对**（本手册与 Debian 官方文档在下一节的链接里都给）。

发行版为什么能让登录终端同时拿到 `.bashrc` 里的配置？因为默认模板自己在 source 它。删掉 `.bash_profile` 还能验证优先级：

```text
# E4b 逐字输出
--- 登录 + 交互 ---
  [读到 .bash_profile]
  [读到 .bashrc]
--- 删掉 .bash_profile 后，登录 shell 读哪个（三个都存在的优先级）---
  [读到 .profile]
```

`.bash_profile` 存在时 `.profile` 就不读了——**这是「我改了 `~/.profile` 怎么没生效」的直接答案**。三个候选文件的先后顺序：`.bash_profile` → `.bash_login` → `.profile`，取第一个存在的，只读它。

## 「我本地明明是好的」：一条命令就能复现的成因

把上面两节合起来，就是那个经典故障的完整机制。实测做法是**清空环境**再执行，模拟 cron / systemd / CI 那种「只有寥寥几个变量」的起点：

```bash
# 实测 E5：只在 ~/.bashrc 里把新版目录加进 PATH
env -i HOME="$S/home" PATH=/usr/bin:/bin bash -i -c 'command -v myapp'; echo "退出码=$?"
env -i HOME="$S/home" PATH=/usr/bin:/bin bash -c  'command -v myapp'; echo "退出码=$?"
env -i HOME="$S/home" PATH=/usr/bin:/bin bash -l -c 'command -v myapp'
```

```text
  [读到 .bashrc]
/d/…/w4pkg/v2/myapp
  退出码=0
  退出码=1（1 = 找不到）
<沙箱>/v2/myapp
```

同一个 HOME、同一个 `.bashrc`，**加上 `-i` 就能找到，不加就是退出码 1**。`bash -l -c` 之所以也能找到，是因为它读的是 `.bash_profile`（我在里面补了一行同样的 PATH）——这就是为什么「在 crontab 里包一层 `bash -l -c`」这个民间修法是**碰巧有效**：它依赖某个文件恰好存在且恰好写了那行，一旦你把配置挪走就悄悄失效。

**正确的做法不是让脚本去找你的 shell 配置，而是让脚本自带环境**。三选一，按可靠性排序：

1. 脚本里用**绝对路径**调用可执行文件（最难看懂，但最少变量）。
2. 脚本开头显式设置：`PATH=/usr/local/bin:/usr/bin:/bin; export PATH`——**写死一行，不依赖任何启动文件**。
3. 把环境放进一个能被显式加载的文件：`set -a; . /etc/myservice/env; set +a`（`set -a` 让加载的赋值自动 export，实测见下）。

变量继承这条也实测了，它解释为什么第 3 条只对「export 过的」有效：

```text
# E6 逐字输出
父→子普通继承：parent-value
命令前缀赋值只给那一条：child-value / 父 shell 里仍是 parent-value
env -i 清空后：[]
node 子进程：from-node
```

```bash
# 实测：不加 set -a，. 进来的变量不会传给子进程
bash -c '. ./env-file; node -e "console.log(process.env.FROM_FILE)"'          # 期望 undefined
bash -c 'set -a; . ./env-file; set +a; node -e "console.log(process.env.FROM_FILE)"'  # 期望 有值
```

第二行是 `[ -a ]` 那条老规则的现代写法（`set -a` 即 `allexport`），**这两条我没在本机单独跑，属于预期结果**，核对方法就是上面那两行命令本身——在服务器上跑一遍只要 10 秒。

## 软件源：装到旧版本不是 apt 的错

`apt` 装到的版本由「候选版本」决定，候选版本由源决定。这一节**全部是 Linux 侧内容，本机没有 apt（实测 `command -v apt` 找不到），一律未在本机验证**，只给命令、要读什么、以及验证方法。

Debian 的 apt 手册页写明了源文件的读取位置与两种格式，这是本章相关结论的文档依据：

- apt 从 `/etc/apt/sources.list` 以及 `/etc/apt/sources.list.d/` 目录里读取，后者按 `.list` 与 `.sources` 两种后缀识别。
- 一行式格式的词序是 `deb [选项] URI 发行版/代号 组件1 组件2`。
- deb822 风格用 `Types:`、`URIs:`、`Suites:`、`Components:`、`Signed-By:` 这些字段名写成一段一段的 stanza。

```bash
# 在服务器上：这个包的候选版本从哪来
apt-cache policy 包名
```

预期输出（示意，字段结构以你机器上的 apt 版本为准）：

```text
包名:
  Installed: (none)
  Candidate: 1.x.y-1
  Version table:
     1.x.y-1 500
        500 http://deb.debian.org/debian bookworm/main amd64 Packages
     1.0.0-1 500
        500 http://security.debian.org/debian-security bookworm-security/main amd64 Packages
```

要读的是三处：`Candidate` 是「不指定版本时它会装哪个」；每个版本行末尾那个数字是 **Pin 优先级**，谁高谁赢，默认值与计算规则以 `apt_preferences` 手册页为准，**别凭记忆改**；`URI` 那列告诉你这个版本来自哪个源——同一命令名有两个来源时，这行就是你的判决书。

加第三方源之前，先问两个问题：**它是不是上游官方维护的源**；**它带来的包会不会顶掉发行版的同名包**。第二问的答案就在 Pin 数字里。另外一条硬规则：`curl … | sudo bash` 这类安装脚本，先把 URL 抓下来读一遍再决定跑不跑——它通常会改 `/etc/apt/` 下的文件、往你的 rc 文件追加一行，而这两处正是本章前面所有故障的来源。

## 脚本里该用 apt 还是 apt-get：一个字的差别

Debian 的 `apt(8)` 手册页说得很直白：apt 这个命令**可能在不同版本之间改变行为**，并且**建议在脚本里使用 apt-get / apt-cache 这些命令**。它还列出只有 `apt` 才有、`apt-get` 没有的子命令是 `list`、`show`、`edit-sources`。

结论是分工，不是优劣：

| 场景 | 用什么 | 理由（依据手册页措辞） |
| --- | --- | --- |
| 人坐在终端前装东西 | `apt install` / `apt update` | 输出为人设计，`apt list` 这类便利命令只有它有 |
| 写进脚本、CI、备份脚本 | `apt-get install -y` / `apt-get update` | 手册明确建议脚本用 apt-get / apt-cache，因为 apt 的行为可能随版本变化 |

```bash
# 脚本里常见的一种写法（Linux 侧，未在本机验证）
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends 包名
```

`DEBIAN_FRONTEND=noninteractive` 是为了避免安装过程弹交互问题（比如配置文件冲突时问你 keep/overwrite）；`--no-install-recommends` 只装必需依赖而不装推荐依赖，具体省掉哪些包由包自己的声明决定，**别假设两边装出来的东西一样**——第一次用请在测试机上先 `apt-get install --no-install-recommends -s 包名` 看模拟结果（`-s` 是 simulate，动手前用 `apt-get(8)` 手册核对选项字母）。同一时刻只能有一个 apt 事务在跑，锁被别的进程（比如自动升级）占着时，你的脚本会失败或等待，这是脚本里要预先想到的第一种错误。

## 编译安装、包管理、版本管理器：三种装法的边界

| | 发行版包（apt） | 编译安装（`./configure && make && make install`） | 用户级版本管理器 |
| --- | --- | --- | --- |
| 装到哪 | `/usr/bin` 等系统目录 | 默认 `/usr/local/`（惯例，不是强制） | `$HOME` 下的自己的目录树 |
| 谁负责升级 | apt，跟着发行版走 | **你自己**：`make uninstall` 经常不存在 | 你自己（且要重装全局包） |
| 怎么卸载干净 | `apt remove` 保留配置、`apt purge` 连配置一起删（差异见 `apt(8)`/`dpkg(8)` 手册） | 靠安装时的文件清单，没留就只能满盘找 | 删目录 + 清掉 rc 文件里追加的那行 |
| 会不会和系统包打架 | 不会（它自己管） | **会**：同名文件谁在前由 PATH 与 Pin 决定 | 只在你的 shell 里生效，别人（cron、systemd、别的用户）拿不到 |
| 适合 | 绝大多数服务端软件 | 需要特定编译选项、或发行版版本太旧且上游没打包 | 开发机上多版本共存 |

个人项目的默认顺序应该是：**发行版官方源 → 上游官方维护的源 → 版本管理器（只用于开发机） → 编译安装（最后手段，并自己记录装了什么）**。判据只有一条：换一台干净机器，你能不能用一份脚本把它装回来。

## 常见错误与排查

**1）刚装完就 `command not found`。** 现象：安装命令返回 0，紧接着敲命令名报 not found（退出码 127）。原因：这个文件根本不在你当前 PATH 里，或者它是靠 rc 文件被加进去的、而你当前的 shell 不是那种会读它的调用方式。怎么确认：`dpkg -L 包名 | grep bin`（看文件到底在哪）+ `echo "$PATH"`（看它在不在）+ `type -a 命令名`。怎么修：短期用绝对路径；长期把那一行 PATH 写进**所有调用方式都会读的地方**——`/etc/profile.d/xxx.sh`（登录类）或干脆在脚本里显式设置（最稳，见上一节第 2 条）。

**2）终端里能跑，crontab / systemd / CI 里报找不到。** 现象：一模一样的命令，人跑没事，机器跑 127。原因：非交互 shell 不读 `.bashrc`（实测表里 `bash -c` 那一行什么都不读），cron 与服务的 PATH 是你桌面 shell 的那份之外的另一份。怎么确认：在服务器上把 crontab 那行前面加 `env -i PATH=/usr/bin:/bin bash -c '…'` 跑一遍——**这个方法本机实测有效**，它能当场重现「加 `-i` 就通、不加就 1」。怎么修：脚本顶部 `PATH=…; export PATH` 写死，或 systemd 单元里显式给 `Environment=`（单元写法见第 3 章）。

**3）装了新版本，`命令名 --version` 还是旧的。** 现象：升级后版本没变。原因：PATH 里更靠前的位置有个旧副本（`/usr/bin` vs `/usr/local/bin` vs `$HOME/.nvm/.../bin`），第一个命中就赢——实测的两行输出就是这个。怎么确认：`command -v` 与 `type -a` 看解析到哪个文件；Linux 上再加 `dpkg -S 文件路径` 问「这个文件是哪个包装的」。怎么修：删掉旧副本，或者让新版目录顶到前面，**然后确认新起的进程也继承了它**（`systemctl` 管理的服务不会因为你改了 PATH 而变）。

**4）改完 PATH 想让它立刻生效，反复 `hash -r` 没用。** 现象：明明 `command -v` 已经指向新文件，脚本里却仍像旧的。原因：你改的是当前 shell 的 PATH，而那个脚本是**另一个进程**——环境变量是启动时的副本（实测 E6：`env -i` 之后变量就是空的）。怎么确认：`type -a`、以及在脚本里第一行 `echo "$PATH"`。怎么修：改完配置要让目标进程重新启动；调试时用 `bash -c 'echo "$PATH"'` 站在子进程视角看。

**5）`apt` 装不到需要的版本，于是随手加了个来源不明的源。** 现象：`Candidate` 一直是发行版那个旧版本；加源之后 `apt update` 报错，或者某个系统命令突然换了实现。原因：候选版本由源与 Pin 决定（见上文预期输出），而第三方源可能与发行版包同名争抢。怎么确认：`apt-cache policy 包名` 逐行看来源；`apt-get -s install 包名` 看它到底打算动哪些包。怎么修：优先上游官方源；加源之前先读它的安装脚本会往 `/etc/apt/` 和 rc 文件写什么。

**6）Windows 上写好的脚本传到服务器第一步就失败。** 现象：`bash: ./deploy.sh: /bin/bash^M: bad interpreter` 或诡异的语法错误。原因：CRLF 行尾，`\r` 被当成 shebang 的一部分。怎么确认：`cat -A deploy.sh | head -3` 看有没有 `^M$`；开发机上 `git config --get core.autocrlf`（本机实测值为 `true`，这正是 checkout 出来的脚本带 CR 的原因）。怎么修：`sed -i 's/\r$//' *.sh`，机制与完整实测见[第 6 章 Shell 脚本](/linux/shell-scripting)。

**7）`sudo` 之后版本又变回去了。** 现象：`node -v` 是 22，`sudo node -v` 是 18。原因：版本管理器装在 `$HOME` 下、靠你的 rc 文件生效，而 `sudo` 执行的是另一套环境（PATH 可能被重置，读的是 root 的启动文件）。怎么确认：`sudo env | grep -i path` 与 `env | grep -i path` 并排比。怎么修：服务端别用「切版本」解决问题，而是在服务定义里写死解释器绝对路径（这条与第 3 章的 unit 写法连得上）。

## 练习

<Exercise title="练习 1 · 同一命令名两个版本，判断解析结果" difficulty="基础">

一台机器上存在两个同名可执行文件：

```text
/usr/local/bin/tool   （你自己放的，1.9.0）
/usr/bin/tool         （apt 装的，1.7.2）
```

当前用户的 PATH 片段顺序是 `/usr/bin:/usr/local/bin`。

1. `tool --version` 打印什么？
2. 你只改一个地方（不动文件），让它打印 1.9.0，写出改法。
3. 改完之后，已经在跑的那个 systemd 服务的 `ExecStart=/usr/bin/env tool serve` 会跟着变成 1.9.0 吗？为什么？

<template #answer>

1. 打印 **1.7.2**。PATH 从左到右第一个命中即赢，`/usr/bin` 在前（本章实测 E2 的两行输出正是这个规律）。
2. 把 `/usr/local/bin` 挪到前面：在**所有调用方式都会生效**的位置写 `PATH=/usr/local/bin:$PATH` 并 `export`。只写 `~/.bashrc` 的话，非交互 shell 不读它（实测表第 1 行），脚本与 cron 里仍是旧版本。
3. **不会。**服务进程的环境是它被 systemd 拉起那一刻的副本，改你 shell 的 PATH 对它无影响；而且这条 `ExecStart` 走的是 `/usr/bin/env`，它按服务自己的 PATH 查找。核对方法：`systemctl show -p Environment 服务名`，以及最直接的一条——`command -v tool` 与 `ls -l /proc/<pid>/environ`（后者需要 root）。第 3 章有完整的服务环境写法。

</template>

</Exercise>

<Exercise title="练习 2 · 用 env -i 当场复现 cron 的故障" difficulty="进阶">

crontab 里有这一行，每天报 `myjob: command not found`：

```text
15 3 * * * myjob --backup >> /var/log/myjob.log 2>&1
```

`myjob` 是你在交互终端里装好的，`command -v myjob` 打印 `/home/deploy/.tools/bin/myjob`，而这一行 PATH 只写在 `~/.bashrc` 里。

1. 为什么交互终端能跑、cron 不能？
2. 写出你在**服务器上**验证这个解释的命令（要能当场重现，不能靠猜）。
3. 给两种修法，并说明哪一种更可靠、为什么。

<template #answer>

1. cron 执行命令用的是非交互 shell，**不读 `~/.bashrc`**（本章实测表：`bash -c` 一行什么都不读）。所以 `.tools/bin` 从没进过那条命令的 PATH。
2. `env -i HOME="$HOME" PATH=/usr/bin:/bin bash -c 'command -v myjob'; echo $?` → 期望退出码 **1**。再跑 `env -i HOME="$HOME" PATH=/usr/bin:/bin bash -i -c 'command -v myjob'` → 期望打印路径、退出码 0。这一对差异就是本机实测复现过的同一机制（`bash -i` 会读 `.bashrc`）。
3. 修法 A：把 cron 那行改成绝对路径 `/home/deploy/.tools/bin/myjob --backup …`。修法 B：在 `myjob` 脚本开头显式 `PATH=/home/deploy/.tools/bin:/usr/bin:/bin; export PATH`。更可靠的是 **A 与 B 都不依赖启动文件**；如果一定要「让环境跟着 shell 配置走」（在 cron 里包 `bash -l -c`），那是**碰巧有效**——它只在你恰好把同一行配置也写进 `.bash_profile` 时成立，实测里 `bash -l -c` 能找到命令正是因为我补了这一行，而不是因为 `-l` 有什么魔力。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误并解释报错" difficulty="进阶">

你在服务器上执行这三条，第二条报错：

```bash
echo 'export PATH=/opt/tools/bin:$PATH' >> ~/.profile
. ~/.profile
command -v mytool
```

但你真正想要的场景是：让 root 的 systemd 服务也能用 `mytool`。

1. 上面这三条为什么在你自己的终端里有效，在服务里无效？
2. 现在把 `~/.profile` 换成 `~/.bash_profile`（这个文件之前不存在），重新登录一次，`.profile` 里原有的内容还会被读吗？为什么？
3. 让服务可用的正确做法是什么（两处，分别说）。

<template #answer>

1. `. ~/.profile` 只影响**当前这个 shell**；服务进程有自己独立的环境副本（本章实测 E6：`env -i` 后变量就是空的），你追加的 rc 文件从来不在它的启动路径上。
2. **不会**。登录 shell 按 `.bash_profile` → `.bash_login` → `.profile` 的顺序取**第一个存在的**并只读它，这是本章实测 E4b 验证过的（删掉 `.bash_profile` 之后才轮到 `.profile`）。所以「凭空多出一个 `.bash_profile`」会让原来的 `.profile` 配置整个失效——这是很典型的「改 A 坏 B」。
3. 两处：① 把可执行文件的目录放进系统级的默认 PATH（例如 `/etc/profile.d/` 下一个脚本，或在服务的 `Environment=` 里显式给 PATH），保证非交互场景也能解析；② 更稳的做法是在服务定义里直接写 `ExecStart=/opt/tools/bin/mytool …` **绝对路径**，完全绕开 PATH。前者见第 3 章的 unit 写法。

</template>

</Exercise>

<Exercise title="练习 4 · 读 apt-cache policy 的输出下结论" difficulty="挑战">

你在 Debian 上执行 `apt-cache policy nodejs`，得到（示意）：

```text
nodejs:
  Installed: 18.19.0+dfsg-1ubuntu1
  Candidate: 20.11.1-1nodesource1
  Version table:
     20.11.1-1nodesource1 600
        600 https://deb.nodesource.com/node_20.x nodistro/main amd64 Packages
     18.19.0+dfsg-1ubuntu1 500
        500 http://archive.ubuntu.com/ubuntu jammy/main amd64 Packages
```

1. 直接 `apt-get install nodejs` 会装到哪个版本？依据是哪一行？
2. 你希望继续留在发行版的 18.x，但机器已经被第三方源影响过。写一条不改源就能防「顺手升级到第三方版本」的思路，并说明为什么不能凭记忆写配置文件。
3. 版本号里那个 `+dfsg` 后缀说明什么？这类信息该去哪核实？

<template #answer>

1. 装 **20.11.1-1nodesource1**。依据两行：`Candidate` 就是「不指定版本时装的那个」，而版本行末尾的 Pin 数字 600 高于 500，所以第三方源胜出。
2. 思路是给某个源或某类包降低 Pin 优先级（或对指定包固定版本），配置写在 `/etc/apt/preferences.d/` 下——**具体字段名、语法与默认值必须以 `apt_preferences` 手册页为准**，本章不凭记忆给配置内容，因为写错的直接后果是整台机器升级失败。安全的验证顺序：先 `apt-get -s install nodejs` 看模拟结果，再改配置，改完再跑一次模拟对比。
3. `+dfsg` 表示这个包按 Debian 自由软件指南做过删改（通常去掉了非自由部分），**不是上游原始发布内容**——所以它可能缺少某些非自由的组件。这类命名后缀属于 Debian 的包版本约定，核实入口是 Debian  Developers Reference 与 `deb-version(7)` 手册页（本章链接了 Debian 官方文档入口与 man7 手册页站点）。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Debian 手册页索引（manpages.debian.org）](https://manpages.debian.org/)——用于核实本章提到的 `apt(8)`「行为可能随版本改变、脚本建议用 apt-get/apt-cache」以及 apt 专有子命令 `list`/`show`/`edit-sources`；本章引用的原文来自 bookworm 的 [apt(8) 手册页](https://manpages.debian.org/bookworm/apt/apt.8.en.html)。
- [apt(8) 手册页（Debian bookworm）](https://manpages.debian.org/bookworm/apt/apt.8.en.html)——用于核实「脚本里该用哪个命令」这条结论本身。
- [sources.list(5) 手册页（Debian bookworm）](https://manpages.debian.org/bookworm/apt/sources.list.5.en.html)——用于核实源文件读取位置（`/etc/apt/sources.list` 与 `/etc/apt/sources.list.d` 下的 `.list`/`.sources`）、一行式 `deb [选项] URI 发行版 组件` 的词序，以及 deb822 的 `Types`/`URIs`/`Suites`/`Components`/`Signed-By` 字段名。
- [ss(8) 手册页（Debian bookworm）](https://manpages.debian.org/bookworm/iproute2/ss.8.en.html)——第 5 章要用，这里先给入口：用于核实 `-l`/`-t`/`-u`/`-n`/`-a`/`-4`/`-6` 各自的确切含义。
- [GNU Bash 手册](https://www.gnu.org/software/bash/manual/bash.html)——用于交叉核对启动文件与 `set` 内建的规则；本章「谁读哪个文件」的表是**本机实测**，手册是判据来源，两者冲突时以你机器上 bash 版本的实测为准。
- [Debian 官方文档入口](https://www.debian.org/doc/)——系统级包管理、版本代号（`bookworm` 这类 suite 名）与 APT 配置的权威说明都从这里进。
- [Ubuntu 官方文档](https://documentation.ubuntu.com/)——同一套 apt 机制在 Ubuntu 上的差异（源里出现 `jammy` 这类代号、`unattended-upgrades` 会占锁）从这里核实。

## 下一章

这一章的主线是「命令名到文件的这条路上有哪几道闸」：包只负责放文件，PATH 的顺序决定命中谁，启动文件的读取时机决定哪些进程能拿到这份 PATH，而进程继承的是环境副本。带着这三条去看[网络诊断与防火墙](/linux/networking)会更顺——那里最典型的故障同样是「服务确实起来了、也确实监听了，但你要找的那个地址上就是没有它」：监听地址是**收包方向**的选择，跟本章「PATH 是查找顺序」是一模一样的思路。下一章会给出监听地址矩阵、三种连不上在耗时上的区别，以及 `curl -v` 每行的读法。
