# 命令行基础：Shell 替你做的四件事，你必须知道

SSH 连上一台新 VPS，回车后屏幕上只有一行 `[root@iZ2ze ~]#`。你不知道自己在哪个目录，`ls` 出来的东西一半看不懂，打错一个字母就 `command not found`。第二天更难受：`tail -f app.log` 明明看到报错，你想把错误抓下来，`grep error app.log > out.txt` 跑完 `out.txt` 是 0 字节；把 `2>&1` 加在 `> out.txt` 前面，错误照样打在屏幕上，文件里还是空的。没人解释过为什么。

这些窘态来自同一个缺口：**你不知道 shell 在你按下回车之后替你干了什么**。它替你做了四件事——按 `PATH` 找可执行文件、把 `*` `?` 展开成文件名列表、把 `$var` 与 `$(...)` 换成值并按空格切词、建立三个文件描述符并把管道与重定向接好。每一件都有可复现的报错在等你。

本章把这四件事讲清，并且**在本机 Git Bash 里逐条跑过**，同时把「Git Bash 成立、Linux 生产机不成立」的差异逐条摆出来——这正是很多人练完命令行上服务器反而更懵的原因。版本口径与[领域首页](/linux/)一致：GNU bash 5.x / coreutils / GNU grep / GNU tar，发行版按 Debian 12 与 Ubuntu LTS；BusyBox 的同名命令选项更少，动手前用 `man 命令名` 核对。

## shell 是个程序：命令查找顺序决定你跑到哪一个

内核不认识「ls」这个字符串，它只认路径。所以「运行命令」这件事全程由 shell 完成：解析输入 → 找到可执行文件 → `fork` + `execve` → 等它结束。理解这条链，一半的「命令找不到」和「行为不对」就能自查。查找顺序固定：

| 顺序 | 类型 | 怎么确认 | 典型坑 |
| --- | --- | --- | --- |
| 1 | 别名 alias | `alias ls` | 发行版默认 `ls --color=auto`，脚本里重复加选项 |
| 2 | 函数 function | `type -a 名字` | 别人写进 `~/.bashrc` 的同名函数覆盖真命令 |
| 3 | 内建命令 builtin | `type cd` | `cd`/`echo`/`test` 是 shell 自己的代码，**不看 `PATH`** |
| 4 | `PATH` 从左到右第一个可执行文件 | `which` / `command -v` | 装了两版 node，前一个挡住后一个 |

`type` 比 `which` 可信，它按真实顺序报。本机实测（Git Bash，bash 5.2.37）：

```text
$ type ls
ls is /usr/bin/ls
$ type cd
cd is a shell builtin
$ type -a bash
bash is /usr/bin/bash
bash is /bin/bash
bash is /usr/bin/bash
bash is /c/Windows/System32/bash
```

最后一行是 Windows 自带的 bash 残影——`PATH` 里有它，`bash` 就可能跑到你不想用的那个。**「同名命令有几份、哪份赢」是「我明明装了却用的是旧版」的唯一答案。** 我又造了个只打印 `[fake ls ran]` 的 `fakebin/ls`，在子 shell 里把它塞到 `PATH` 最前再执行 `which ls` 与 `ls`：

```text
-- which ls: /d/work/learns/linux/.scratch/w1b/fakebin/ls
-- ls says: [fake ls ran]
-- back outside, which ls: /usr/bin/ls
```

`hash -r` 不是仪式：bash 会把「命令名 → 路径」记进哈希表，改完 `PATH` 或覆盖文件后它可能还在用旧路径。子 shell 结束后 `which ls` 回到 `/usr/bin/ls`，这就是「改 `PATH` 只影响当前 shell 及其子进程」的直观演示——也是为什么你 `export PATH=$PATH:/usr/local/node/bin` 之后，**systemd 启动的服务看不到它**（第 3 章展开）。两条纪律：`which` 不是 POSIX，最小化镜像里可能没有，脚本用 `command -v`；`which` 看不到别名与内建命令，不能替代 `type`。

## 你在哪、名字是谁展开的：`pwd`、`~`、大小写、glob

```text
$ pwd
/d/work/learns/linux/.scratch/w1b
$ pwd -W
D:/work/learns/linux/.scratch/w1b
$ echo $HOME
/c/Users/learner
```

Git Bash 把驱动器映射成 `/d/` 这类挂载点，`-W` 才给 Windows 原生路径；Linux 上两者相同。更要命的是另一对：`cd` 改的是**逻辑路径**，`pwd` 默认打印逻辑路径、`pwd -P` 打印物理路径。生产机上 `/usr/local/bin` 常是指向别处的符号链接，`cd` 进去再 `pwd` 看到的不是真实位置，照着它改配置就改错文件了。

符号链接这个实验**本机做不出来**——`ln -s` 返回 0，但它其实是复制：

```text
$ ln -s file.txt sym.txt; echo "ln -s exit=$?"
ln -s exit=0
$ [ -L sym.txt ] && echo YES || echo NO
NO
$ stat -c '%n : %F' file.txt sym.txt
file.txt : regular file
sym.txt : regular file
```

`[ -L ]` 判否、`%F` 说是普通文件，两条独立证据都证明链接没建立。**你在 Git Bash 里练的 `ln -s`、`cd` 穿链接、`ls -l` 里的 `->`，全都没有真正发生。**

大小写同理：目录里只有 `file.txt`，而 `ls FILE.TXT` 在本机**成功**（输出 `FILE.TXT`），因为 NTFS 不敏感；Linux 的 ext4 会报 `No such file or directory`。**你在 Windows 上练出「抓不到就加 `-i`」的习惯，上了 Linux 才发现 `Makefile` 和 `makefile` 是两个文件。**

`ls -l` 的字段逐列是：**类型+权限 / 硬链接数 / 属主 / 属组 / 字节数 / 时间 / 名字**。本机真实输出：

```text
$ ls -l
total 1
drwxr-xr-x 1 learner 197609  0 Oct 18 11:09 fakebin
-rw-r--r-- 1 learner 197609 24 Oct 18 11:09 file.txt
drwxr-xr-x 1 learner 197609  0 Oct 18 11:09 subdir
$ stat -c 'n=%n F=%F a=%A u=%u/%U g=%g/%G size=%s links=%h' file.txt
n=file.txt F=regular file a=-rw-r--r-- u=197609/learner g=197609/UNKNOWN size=24 links=1
```

第一列首字符是文件类型（`-` 普通、`d` 目录、`l` 链接、`s` 套接字、`b`/`c` 设备、`p` 管道），Linux 上运维靠它认 `/var/run/mysqld/mysqld.sock`。**本机的数字不可带走**：属组是裸数字 `197609`（`stat` 直接说 `UNKNOWN`）；目录 `size` 是 `0`，Linux 上目录本身是存名字列表的文件、典型 `4096`；硬链接数恒为 `1`，Linux 上目录是 `2 + 子目录数`。原因在第 2 章实测里给：NTFS 没有 POSIX 权限与属主语义。

`ls` 日常够用组合只有四个：`-l` 长格式、`-a` 含隐藏文件、`-h` 配合 `-l` 出 `KiB`/`MiB`、`-t` 按时间倒序（排第一的就是刚被改过的，查「谁又写了一次日志」极有用）。**别把 `ls` 的输出喂脚本**：文件名可以含空格与引号，那不是给机器读的格式，要枚举用 `find`。

**glob（路径展开）由 shell 完成**，这是本章最值钱的认知：

```text
$ echo a*.txt        → a1.txt a2.txt
$ echo 'a*.txt'      → a*.txt
$ echo "a*.txt"      → a*.txt
$ echo zzz*.txt      → zzz*.txt
$ echo a?.txt        → a1.txt a2.txt
$ echo {a,b}*.txt    → a1.txt a2.txt b1.txt
$ printf 'ARG:[%s]\n' g/*.txt
ARG:[g/a1.txt]
ARG:[g/a2.txt]
ARG:[g/b1.txt]
ARG:[g/two words.txt]
$ ls 'g/*.txt'
ls: cannot access 'g/*.txt': No such file or directory
```

四条结论：单/双引号都关掉 glob（引号就是「别展开」的开关）；**没有匹配时 bash 把模式原样交给命令**（`zzz*.txt` 那行），这就是 `rm *.tmp` 在没有 `.tmp` 时报 `rm: cannot remove '*.tmp': No such file or directory` 的原因；花括号是**另一套机制**（展开发生在 glob 之前，不需要文件存在）；`printf` 那行显示 glob 产出的是**四个独立参数**。最后一行是高频事故原文：**给 glob 加引号，模式就死了**。验证「模式有没有被展开」的通用办法就是把它交给 `echo`。

## 看文本：`cat` 用来拼，`less` 用来看，`tail -f` 用来看正在长的那部分

| 命令 | 用途 | 关键选项与按键 | 注意 |
| --- | --- | --- | --- |
| `cat` | 打印小文件、拼接、从管道写内容 | `-n` 编号、`-A` 显示不可见字符 | 大日志会刷爆终端；`cat -A` 是查 CRLF 的利器 |
| `less` | 分页看大文件 | `q` 退出、`/词` 搜、`n`/`N`、`G`/`g` 尾首、`-N` 行号、`+F` 边看边跟 | 不整读进内存，2 GB 日志也安全 |
| `head` | 前 N 行 | `-n 3`、GNU 特有 `-n -3`（排除末尾 N 行）、`-c 200` | 负数形式 BusyBox/macOS 不支持 |
| `tail` | 后 N 行、跟随 | `-n 20`、`-f` 跟随、`-F` 轮转后仍跟随 | **生产看日志用 `-F`**，`-f` 在 logrotate 后会卡住 |

本机实测（`nums.txt` = `seq 20`）：

```text
$ head -n 3 nums.txt → 1 2 3        $ tail -n 3 nums.txt → 18 19 20
$ head -n -3 nums.txt | tail -n 2 → 16 17
$ wc nums.txt
20 20 51 nums.txt
$ wc -l < nums.txt
20
```

`wc` 三列依次是**行、单词、字节**；`< 文件` 的写法不附带文件名，脚本里取纯数字就用它。`tail -f` 我也按真实流程跑了：后台起 `tail -n +1 -f follow.log` 并重定向进文件，中途追加两行，再发 `SIGTERM`。

```text
tail exit=143
-- captured.txt:
event-A
```

**只有 `event-A`，`event-B` 丢了**：输出目标不是终端时 `tail` 块缓冲，进程被信号打断时最后未满的缓冲区没落盘。两个含义：靠「重定向 `tail -f` 抓现场」会漏尾部，正式做法是 `stdbuf -oL tail -f`；而 `143` 是第 3 章的公式（`128 + SIGTERM(15)`），在 Git Bash 里就已成立。

## grep：从日志里捞出那几行

先记一条会浪费你半小时的默认行为：**`grep` 区分大小写，无匹配时退出码 1**。实测（`log.txt` 五行，含 `Error:`、`ERROR`、`warning:`、`info`）：

```text
$ grep error log.txt ; echo "exit=$?"      → 空     exit=1
$ grep -i error log.txt                    → Error: disk full / ERROR network / Error: disk full
$ grep -c -i error log.txt                 → 3
$ grep -n -i error log.txt                 → 1:Error: disk full / 3:ERROR network / 5:Error: disk full
$ grep -o -E 'disk [a-z]+' log.txt         → disk full  ×2
$ grep -w err <<< 'terr err error'         → terr err error   （只有独立的 err 命中）
```

| 选项 | 作用 | 什么时候非用不可 |
| --- | --- | --- |
| `-i` | 忽略大小写 | 日志里 `Error`/`ERROR`/`error` 混写 |
| `-n` | 带行号 | 要回去改那一行；配合 `vi 文件 +行号` |
| `-c` | 只报匹配行数 | 判断「有没有」和「多少次」，比管道到 `wc -l` 少一个进程 |
| `-v` | 反转 | 剔掉 `INFO`；`grep -v '^#'` 去注释看配置 |
| `-r` | 递归 | 找「这句配置写在哪个文件」，配 `--include='*.conf'` 提速 |
| `-E` | 扩展正则 | 想写 `a|b`、`(x)+`、`{2,4}` 而不用反斜杠 |
| `-F` | 固定字符串 | 查 `1.2.3.4:8080` 这类含 `.` `+` 的串，快且不误伤 |
| `-A`/`-B`/`-C` | 后/前/两侧上下文行数 | `grep -C 3 'EACCES' app.log` 把前后三行一起带出来 |

`-E` 与非 `-E`（BRE）只差元字符：BRE 里 `+ ? | ( ) { }` 是普通字符，要当元字符必须加反斜杠。实测两种写法：

```text
$ grep 'd.\{1,4\}f' log.txt     # BRE，反斜杠版
Error: disk full
$ grep -E 'Error|warning' log.txt
Error: disk full
warning: low space
```

记不住就统一 `-E`（等价于已被标记为历史遗留的 `egrep`）。`^` 与 `$` 是必须掌握的：`grep '^port' /etc/ssh/sshd_config` 才只命中未被注释的那条。

## 管道与重定向：三个文件描述符，顺序决定一切

每个进程开机就带着三个 descriptor：**0 stdin、1 stdout、2 stderr**。`> 文件` 只是「把 1 号指向文件」，`2>` 是把 2 号指走，`|` 是「左边 1 号接右边 0 号」。报错走 stderr 不是风格而是设计：**这样你能只丢结果、只留错误，或反过来**。实测：

```text
$ ls nosuchdir > out.txt 2> err.txt
$ echo "exit=$?"        → exit=2
$ wc -c < out.txt       → 0
$ cat err.txt
ls: cannot access 'nosuchdir': No such file or directory
$ ls nosuchdir > both.txt 2>&1 ; cat both.txt
ls: cannot access 'nosuchdir': No such file or directory
```

`2>&1` 的意思是「把 2 号指向 1 号**当前**指向的东西」，**它有方向**，重定向从左到右逐个生效。看这两条的真实差异：

```text
$ bash -c 'echo to-stdout; echo to-stderr >&2' 2>&1 > trap.txt
to-stderr                          ← 打在屏幕上
$ cat trap.txt
to-stdout                          ← 文件里只有它

$ bash -c 'echo to-stdout; echo to-stderr >&2' > both2.txt 2>&1
$ cat both2.txt
to-stdout
to-stderr
```

第一条里 `2>&1` 先执行，那时 1 号还连终端，于是 2 号也连终端；随后 `> trap.txt` 只搬走了 1 号。**你以为抓到了现场，其实错误全漏了。** 正确形式记一句：**`> 文件 2>&1`，`2>&1` 永远写在后面。**

| 写法 | 效果 | 备注 |
| --- | --- | --- |
| `> f` | 1 → f，**先清空 f** | 覆盖不是追加；实测 `>line1` → `>>line2` → `>line3`，最终只剩 `line3`（6 字节） |
| `>> f` | 追加 | 日志一律用它 |
| `2> f` | 只有错误进 f | 抓异常栈 |
| `> f 2>&1` / `&> f` | 两者都进 f | 生产最常用；`|&` 是 `2>&1 \|` 的缩写（bash 4+，**`#!/bin/sh` 即 dash 会语法错误**） |
| `< f`、`exec 3> f` / `exec 3>&-` | 0 ← f；开/关任意 fd | `wc -l < f` 不带文件名；实测 `echo "written to fd3" >&3` 写入成功 |

管道只搬 stdout：`bash -c 'echo o; echo e >&2' | cat` 里 `e` 是直接落终端的，**没经过 `cat`**（顺序随缓冲策略变，别把顺序当证据）；要连错误一起进管道只能 `|&` 或 `2>&1 |`。

## 退出码与 `&&`、`;`、`\|`、`\|\|`

程序退出时留一个 0–255 的整数，shell 存在 `$?`。**0 成功、非 0 失败**，这是一切条件操作的底层依据。实测：

```text
grep 命中 → $?=0     grep 无匹配 → $?=1     grep 文件不存在 → $?=2
true → 0    false → 1    bash -c 'exit 42' → 42
$ true && echo step1 && false && echo step2 && echo step3
step1                      ← 链在第一个失败处断掉
$ false; echo YES
YES                        ← ; 无条件继续，失败被吞
```

`grep` 的约定单独背：**0 有匹配 / 1 无匹配 / 2 出错**；`grep -q` 咽掉输出只留退出码，所以「配置里到底有没有这行」就是 `grep -q '^Port 22' /etc/ssh/sshd_config`。

| 写法 | 语义 | 典型用法 |
| --- | --- | --- |
| `A && B` | A 成功才跑 B | `apt update && apt install -y nginx` |
| `A \|\| B` | A 失败才跑 B | `test -f x \|\| echo missing` |
| `A ; B` | 无条件依次跑，**A 的失败被吞** | 只在真要「无论成败都继续」时用 |
| `A \| B` | A 的 stdout 接 B 的 stdin，同时运行 | 数据流水线 |

**最坑的是 `;`**：`cd /opt/app; rm -rf ./data` 在目录不存在时 `cd` 失败、`rm` 照跑，而且是在你还站着的地方跑。写 `&&`。

管道的退出码**只取最后一个命令**，前面全挂也报成功。实测：

```text
$ bash -c 'exit 3' | cat ; echo "exit -> $?"
exit -> 0
$ echo "PIPESTATUS=${PIPESTATUS[*]}"
PIPESTATUS=3 0
$ set -o pipefail ; bash -c 'exit 3' | cat ; echo "exit -> $?"
exit -> 3
```

`${PIPESTATUS[@]}` 逐段列出每个环节的退出码，`set -o pipefail` 让整条管道取「最后一个非零」。判断成败要靠管道中段时忘了 `pipefail`，脚本会永远报成功——「部署脚本报成功但其实没拉到代码」就是这么来的。

同构的另一条规律：**被信号杀死时退出码是 `128 + 信号编号`**，本机实测三组加一组 SIGPIPE：

```text
-- default TERM -> wait exit=143    -- SIGKILL -> wait exit=137    -- SIGINT -> wait exit=130
$ yes | head -n 1 ; echo "PIPESTATUS=${PIPESTATUS[*]}"
y
PIPESTATUS=141 0
```

`137` 是容器与 OOM 场景里最常见的「我的进程为什么没了」；`141 = 128+13` 是 **SIGPIPE**：`yes` 无限写、`head -n 1` 读够一行就关闭管道，`yes` 再写就往无人读取的管道写，内核发 SIGPIPE 打死它。这几个数字是[进程、信号与 systemd](/linux/processes-and-systemd) 推理的地基。

## 引号、变量与展开

```text
$ name="world files"
$ echo $name      → world files   （两个参数被 echo 重新用空格拼上，破坏被隐藏）
$ echo '$name'    → $name         （单引号关掉一切展开）
$ echo "a$name b" → aworld files b
$ echo "a\$b \c"  → a$b \c        （双引号里反斜杠只对 $ ` " \ 换行 有意义）
$ echo $'tab\there\nnewline'      （$'...' 才解释 \t \n）
$ echo $(echo nested $(echo deep)) → nested deep
$ echo `echo outer \`echo inner\`` → outer inner   （反引号嵌套要转义）
$ echo $((6*7))   → 42            （$(( )) 是算术求值，不是命令替换）
$ echo "${NEVERSET:-fallback}" → fallback   $ echo "${#name}" → 11
```

单引号关掉一切；双引号保留 `$var`、`$(...)`、`$((...))` 与少量转义，关掉 glob 与花括号。**词分裂（word splitting）**才是重点：未加引号的展开结果按 `$IFS`（默认空格、Tab、换行）切成多个参数：

```text
$ touch 'two words.txt'
$ ls two words.txt
ls: cannot access 'two': No such file or directory
words.txt
$ ls 'two words.txt'
two words.txt
```

**纪律只有一条：`$` 一律带双引号**，写 `"$name"`。花括号的额外好处是看清边界（`"${file}_bak"`）并支持 `${X:-默认}`、`${#X}`。命令替换**剥掉结果末尾的换行**（内部换行保留）：`v=$(printf 'a\nb\n\n')` 实测得到 `len=3 value=[a b]`——拿它计数或写回文件时这个差异会咬人。读未定义变量默认得到空串且**不报错**，这正是脚本「带病继续跑」的源头；`RO=2` 在 `readonly RO=1` 之后的报错原文是 `RO: readonly variable`。

## 历史、补全与帮助

快捷键在 Linux bash 里通用（语义以 [GNU Bash 手册](https://www.gnu.org/software/bash/manual/bash.html) 为准，**未在本机逐条验证**）：`Tab` 补全（连按两次列候选）、`Ctrl-R` 反向搜历史（敲过一次的复杂 `tar`/`openssl` 就靠它）、`!$` 与 `Alt-.` 复用上一条命令的最后一个参数、`Ctrl-A`/`Ctrl-E` 行首行尾、`Ctrl-W`/`Ctrl-U` 删到词首/行首、`Ctrl-L` 清屏、`Ctrl-C` 发 SIGINT、`Ctrl-Z` 发 SIGTSTP。本机是非交互脚本环境，历史内容取不到（`fc -l` 无输出、`echo $HISTFILE` 为空），但补全绑定确实在：`bind -p | grep complete` → `"\C-i": complete`（`\C-i` 就是 Tab）。想让历史耐用，在 `~/.bashrc` 加 `shopt -s histappend` 与 `HISTSIZE=10000 HISTFILESIZE=10000`，避免多终端互相覆盖。

查帮助优先级：`命令 --help`（一屏选项，快）→ `man 命令`（完整语义与退出码）→ `info`（GNU 分层手册）。`man` 的分节编号是通用约定：**1 用户命令、2 系统调用、3 库函数、5 文件格式、7 概念、8 管理命令**。所以 `man kill`（命令）与 `man 2 kill`（内核接口）是两份文档，`man 1 passwd` 与 `man 5 passwd` 更是两回事；**`man -k 关键词`（= `apropos`）解决「知道要干什么但不知道命令叫什么」。** 平台现实是 **Git Bash 里 `man` 与 `info` 根本没装**，实测：

```text
$ command -v man || echo "man NOT installed"
man NOT installed
$ command -v info || echo "info NOT installed"
info NOT installed
$ ls --help | head -n 1
Usage: ls [OPTION]... [FILE]...
$ grep --version | head -n 1 ; tar --version | head -n 1
grep (GNU grep) 3.0
tar (GNU tar) 1.35
```

所以在 Windows 上练命令行的正确搭配是 `--help` + [man7.org](https://man7.org/linux/man-pages/)；上了 Linux 第一件事常是 `sudo apt install man-db manpages`。

## `find` 与 `xargs`：把找到的东西交给别的命令

骨架是 `find 起点 条件 -print`。本机建了 `t/a.txt`、`t/b.md`、`t/sub/c.txt`、`t/sub/deeper/d.txt`、`t/sub/e f.txt`：

```text
$ find t -type f -name '*.txt'
t/a.txt
t/sub/c.txt
t/sub/deeper/d.txt
t/sub/e f.txt
$ find t -maxdepth 1 -type f   → t/a.txt  t/b.md
$ find t -type f -name '*.txt' | wc -l   → 4
$ find t -type f -newer acc.log | wc -l  → 5
```

选项记这几组：`-type f/d/l`、`-name`/`-iname`、`-path`、`-maxdepth N`、`-size +10M`、`-mtime -7`（7 天内改过）、`-newer 文件`、`-user`、`-not`、`-delete`、`-exec 命令 {} \;`（逐个）/ `-exec 命令 {} +`（批量）。**`-name` 的模式一定要加引号**，否则先被 shell 展开，结果取决于你在哪个目录跑。

真正会丢数据的是把结果交给别的命令，我用带空格的文件名把事故跑出来了：

```text
$ find t -type f -name '*.txt' | xargs wc -l
wc: t/sub/e: No such file or directory
wc: f.txt: No such file or directory
$ find t -type f -name '*.txt' -print0 | xargs -0 wc -l
0 t/sub/e f.txt
0 total
$ find t -type f -name '*.txt' -exec wc -c {} +
0 t/sub/e f.txt
0 total
$ find t -type f -name '*.md' | xargs -I{} sh -c 'echo "FILE={}"'
FILE=t/b.md
```

`xargs` 默认按空白切分并把引号当语法吃掉，一个文件名裂成两个参数。修法是 `-print0 | xargs -0`（NUL 分隔）或 `-exec {} +`；`xargs` 还能并行（`-P 4`）与替换（`-I`）。**删之前把 `-delete` 换成 `-print` 跑一遍**——这条纪律的价值你第一次误删之后会完全理解。

## 一条统计管道：`grep`、`cut`、`tr`、`sort`、`uniq`、`wc`

单条命令是玩具，串起来才是工具。造一份 Nginx 风格访问日志（空格分隔，字段编号 1=IP、7=路径、9=状态码、10=字节数）：

```text
10.0.0.1 - - [17/Oct/2026:10:00:01 +0000] "GET /api/users HTTP/1.1" 200 1043
10.0.0.2 - - [17/Oct/2026:10:00:02 +0000] "GET /api/items HTTP/1.1" 200 812
10.0.0.1 - - [17/Oct/2026:10:00:03 +0000] "POST /api/users HTTP/1.1" 500 96
10.0.0.3 - - [17/Oct/2026:10:00:04 +0000] "GET /api/items HTTP/1.1" 404 0
10.0.0.2 - - [17/Oct/2026:10:00:05 +0000] "GET /api/items HTTP/1.1" 200 812
```

本机跑出的真实结果：

```text
$ wc -l < acc.log
5
$ cut -d' ' -f9 acc.log | sort | uniq -c | sort -rn
      3 200
      1 500
      1 404
$ cut -d' ' -f7 acc.log | sort | uniq -c | sort -rn | head -n 1
      3 /api/items
$ cut -d' ' -f9 acc.log | grep -c '5..'
1
```

「按某维度分组的访问量」的模板是 **`cut` 抠字段 → `sort` 让相同值相邻 → `uniq -c` 计数 → `sort -rn` 排序 → `head` 取前几**。每一步都不能省，因为 `uniq` 只合并**相邻**重复行：

```text
$ printf 'a\nb\na\n' | uniq              → a / b / a     ← 去重失败
$ printf 'a\nb\na\n' | sort | uniq -c    → "      2 a" / "      1 b"
$ printf '10\n9\n100\n1\n' | sort        → 1 / 10 / 100 / 9      ← 字典序
$ printf '10\n9\n100\n1\n' | sort -n     → 1 / 9 / 10 / 100
$ printf 'a:b:c\n' | cut -d: -f1,3      → a:c
$ printf 'one   two\tthree\n' | tr -s ' \t' ' '  → one two three
$ printf 'hello' | tr 'a-z' 'A-Z'       → HELLO
```

这就是「明明加了 `uniq` 为什么还有重复」和「9 排在 10 后面」的全部答案。`sort` 补三个：`-r` 反向、`-u` 去重、`-k1,1` 只按第一列（不写 `,1` 时排序键一直读到行尾，结果会变）。`cut` 补两个：`-f2-`（第 2 列到末尾）、`-c`（按字符位置）。`tr` 的高频用法是 `tr ' ' '\n'`——把一行里的多个词拆成多行再交给 `sort | uniq -c`，从一行 `netstat` 或一行 JSON 里做统计就靠它。需要求和时管道工具不够用：`cut -d' ' -f10 acc.log | awk '{s+=$1} END{print s}'` 实测得 `2763`（`awk` 正式讲解在第 6 章）。

## tar：归档和压缩是两件事

`tar` 本身只**归档**（把多文件拼成一个，不减大小），压缩是叠加的第二步（`-z` gzip / `-j` bzip2 / `-J` xz）：

```bash
tar -czf backup.tgz 目录名          # 建：c=create z=gzip f=文件
tar -tzf backup.tgz                 # 看清单，不解压
tar -xzf backup.tgz -C 目标目录      # 解压到指定目录
tar -xzf backup.tgz -C restore 't/b.md'   # 只取一个成员
```

实测（GNU tar 1.35，`tar -xvf snap.tgz -C restore -- 't/b.md'` 单成员提取也成功）：

```text
$ tar -czf snap.tgz t ; tar -tzf snap.tgz | head -n 4
t/
t/a.txt
t/b.md
t/sub/
$ wc -c < snap.tgz
225
$ mkdir -p restore && tar -xzf snap.tgz -C restore ; find restore -type f | head -n 3
restore/t/a.txt
restore/t/b.md
restore/t/sub/c.txt
```

四条纪律：一，**清单里带前导 `/` 要警惕**，`tar -czf x.tgz /etc` 解出来的成员是绝对路径，`-x` 会覆盖系统文件——给别人做备份用 `tar -czf etc.tgz -C / etc`，恢复才落在 `./etc`。二，`-C` 在建包和解包时都生效且**顺序敏感**。三，Linux 上 tar 会保存权限、属主与时间戳，但**非 root 解包时属主变成自己**、权限受 `umask` 影响，备份系统配置要 `sudo tar ... -p` 并在恢复后 `ls -l` 复核（本机 `tar -tvf` 显示的是 `learner/197609` 这种合成身份，不可当证据）。四，tar 不感知「文件正被进程握着」，数据库热备份不能用它拷文件（见[备份与恢复](/database/backup-and-restore)）。

<Callout type="verified" title="本章实测环境，以及四处不能迁移到 Linux 的差异">

所有 `$` 开头的片段都在本机真实执行：**Windows 10 x64 + Git for Windows 的 Git Bash**，`GNU bash 5.2.37(1)-release (x86_64-pc-msys)`、GNU coreutils、`grep 3.0`、`tar (GNU tar) 1.35`，日期 2026-10-18，临时文件建在 `D:\work\learns\linux\.scratch\` 并已清理。**示例里的账户名 `learner` 与目录前缀 `D:\work` 是占位值**，字段形状、uid/gid 数字和时间戳与真实输出一致。

**四处不可迁移，本章都逐条标了**：① 权限与属主（`ls -l` 属组是裸数字、目录 `size` 为 0、硬链接数恒 1，成因见第 2 章实测）；② `ln -s` 退化成复制；③ NTFS 大小写不敏感；④ `man`/`info` 未安装、`ps` 不支持 `-ejH`、`chmod`/`umask` 基本无效。**凡依赖这些特性的行为，本章只给命令与预期输出，不做实测声明。** 反过来，管道与重定向、glob 与引号、退出码与 `PIPESTATUS`、`grep`/`sort`/`uniq`/`cut`/`tr`/`find`/`xargs`/`tar` 的文本处理语义是 GNU 工具自身的行为，与 Windows 无关，可以放心迁移。

</Callout>

## 常见错误与排查

**1. 现象：`command not found`，但你确定装过。** 原因：`PATH` 里没有那个目录；或 `PATH` 里有两份、跑到旧的；或被别名/函数挡住；或 bash 还缓存着旧路径。确认：`type -a 命令名`、`echo $PATH | tr ':' '\n'`、`ls -l 那个文件`（缺可执行位、或架构不对——x86-64 机器跑 ARM 二进制也报 `command not found`，缺的其实是解释器）。修法：`export PATH="$PATH:/opt/tool/bin"` 先临时验证，确认后写进 `~/.bashrc`（只影响交互 shell）或服务的 `Environment=`（第 3 章）；换过文件后 `hash -r`。

**2. 现象：`rm *.tmp` 报 `cannot remove '*.tmp'`。** 原因：glob 无匹配时模式原样传下去（实测 `echo zzz*.txt` → `zzz*.txt`）。修法：脚本里 `shopt -s nullglob`；或 `find . -maxdepth 1 -name '*.tmp' -delete`。**同族更危险的版本是 `rm -rf $dir/*`：`dir` 为空串时展开成 `rm -rf /*`。** 永远写 `rm -rf "${dir:?未指定目录}"/*`——`${VAR:?消息}` 在变量为空时直接退出并打印那句。

**3. 现象：`grep error app.log > out.txt` 得 0 字节，加 `2>&1` 也没用。** 原因：`2>&1` 写在 `>` 前面（实测证据见上文）。确认：`wc -c out.txt`、`grep -c error app.log`。修法：`> out.txt 2>&1` 或 `&> out.txt`；只留错误就 `2> err.txt` 并把 stdout 指向 `/dev/null`。

**4. 现象：脚本报「成功」，但中间那步明明失败了。** 原因：管道退出码只取最后一个（实测 `PIPESTATUS=3 0` 而 `$?=0`），或用 `;` 吞掉失败。修法：`set -euo pipefail`（第 6 章正式讲）；单点判断读 `${PIPESTATUS[0]}`。

**5. 现象：`find ... | xargs rm` 删错或漏删。** 原因：文件名含空格/换行被词分裂（实测原文两行 `wc: ...: No such file`）。确认：`find . -name '* *' -print`。修法：`-print0 | xargs -0` 或 `-exec {} +`；删除前先把 `-delete` 换 `-print`。

**6. 现象：Windows 上写好的脚本/配置，Linux 上处处报错。** 原因：换行符是 CRLF。典型报错是 `bash: /bin/bash^M: bad interpreter`。确认：`cat -A 文件 | head`（`^M$` 就是 CRLF）、`file 文件`。修法：`sed -i 's/\r$//' 文件`，或 Git 里 `core.autocrlf=input`；编辑器保存为 LF。

**7. 现象：`tail -f` 看着看着不动了，但日志在写。** 原因：logrotate 改名并新建同名文件，`-f` 按 inode 跟到了被改名的旧文件。确认：`ls -i 日志` 与 `lsof -p PID | grep 日志` 的 inode 不一致。修法：`tail -F`；或改 `journalctl -u 服务 -f`（第 3 章）。另有一条同源教训：**`cat 大文件 | grep x` 是多余的一次进程与整读**，直接 `grep x 大文件`（可给多个文件，输出自动带 `文件:` 前缀）。

## 练习

<Exercise title="练习 1 · 先预测展开结果再执行" difficulty="基础">

目录 `g/` 里有 `a1.txt`、`a2.txt`、`b1.txt`。写出下面六条的输出，再对照本章实测。第 4 条与第 5 条输出相同、机制有何不同？

```bash
cd g
echo a*.txt
echo 'a*.txt'
echo zzz*.txt
echo a{1,2}.txt
echo a1.txt a2.txt
ls 'a*.txt'
```

<template #answer>

依次：`a1.txt a2.txt`（glob 展开成两个匹配名）、`a*.txt`（引号关掉展开）、`zzz*.txt`（无匹配时模式**原样传递**，这就是 `rm *.tmp` 报错的由来）、`a1.txt a2.txt`（花括号展开，不要求文件存在——`echo a{9,8}.txt` 也照样打印）、`a1.txt a2.txt`（本来就是两个字面参数）。第 4 条与第 5 条输出相同、机制不同：花括号是 shell 的字符串生成，glob 是对文件系统的匹配查询。最后一条报 `ls: cannot access 'a*.txt': No such file or directory`，因为引号把模式变成了字面文件名。**验证「模式有没有被展开」的通用办法是交给 `echo`；要数清参数个数用 `printf 'ARG:[%s]\n' 模式`。**

</template>

</Exercise>

<Exercise title="练习 2 · 数出 404 与最活跃的来源 IP" difficulty="基础">

用本章那份 5 行 `acc.log`（1=IP、7=路径、9=状态码、10=字节数），只允许 `grep`、`cut`、`sort`、`uniq`、`wc`、`head`，求：1）状态码 404 的行数；2）出现过非 2xx 的客户端 IP 及次数；3）平均每次请求的字节数（取整）。

<template #answer>

```bash
cut -d' ' -f9 acc.log | grep -c '^404$'                       # 1
cut -d' ' -f9,1 acc.log | grep -v '^2' | cut -d' ' -f2 | sort | uniq -c | sort -rn
cut -d' ' -f10 acc.log | awk '{s+=$1} END{print int(s/NR)}'   # 552
```

第 1 题本机实测是 `1`。写 `grep -c 404` 不加 `^$` 会误命中端口里含 404 的行——**统计字段值时把整行锚点加上**。第 2 题的思路是「先把状态码和 IP 一起抠出来（`-f9,1`），过滤掉 2 开头，再回头取 IP」，分两次 `cut` 同一份文件也能做但容易错位；本章数据里 10.0.0.1（一笔 500）与 10.0.0.3（一笔 404）各 1 次。第 3 题管道工具不够用：`awk` 是唯一顺手选择，2763/5=552.6 → 552。这题的收获是认清边界：**分组计数用 `sort | uniq -c`，一旦涉及求和、平均、比例就换 `awk`。**

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造三条报错并解释原文" difficulty="进阶">

在空目录里执行三段（第三段别在有重要文件的地方跑），逐条抄下报错原文并解释：1）为什么第一段没建出名叫 `a b.txt` 的文件？2）第二段的两类错误分别从哪来？3）第三段的退出码为什么是 0？

```bash
touch a b.txt && ls -l
find . -type f -name *.txt | xargs wc -l
bash -c 'exit 7' | grep -c '' ; echo "exit=$?"
```

<template #answer>

第一段：`touch` 收到两个参数 `a` 和 `b.txt`，于是建了**两个**文件。原因是未加引号时的词分裂（本章 `ls two words.txt` 的报错同源）。正确写法 `touch 'a b.txt'`。

第二段两类错误：`-name *.txt` 的模式被 shell 先展开成目录里的实际文件名（若当前目录有多个文件，`find` 会因「选项后跟了意外参数」报错；若一个都没有，模式才原样传下去）——这就是本章「`-name` 的模式必须加引号」的反面教材；然后 `xargs` 把带空格的文件名切成两个参数，实测原文是 `wc: t/sub/e: No such file or directory` 与 `wc: f.txt: No such file or directory`。修法：`find . -type f -name '*.txt' -print0 | xargs -0 wc -l`（实测输出 `0 t/sub/e f.txt` 与 `0 total`）。

第三段：`exit=0`。管道退出码只取最后一个命令（实测同类 `bash -c 'exit 3' | cat` → `$?=0`、`PIPESTATUS=3 0`），`grep -c ''` 对任何非空输入都输出计数并返回 0，左边的 7 被彻底吞掉。要拿到 7 就 `set -o pipefail` 或读 `${PIPESTATUS[0]}`。**这是「CI 永远绿」最常见的成因。**

</template>

</Exercise>

## 官方文档与延伸阅读

- [GNU Bash Reference Manual](https://www.gnu.org/software/bash/manual/bash.html) —— 命令查找顺序、shell 展开（glob / 花括号 / 引号 / 词分裂）的先后次序、`&&`/`||`/`|` 与重定向语法、`PIPESTATUS` 与 `pipefail` 的最终依据。
- [GNU grep manual](https://www.gnu.org/software/grep/manual/grep.html) —— 核实 `-E`(ERE) 与 BRE 的元字符差异、`-w` 整词定义、退出码 0/1/2（本机跑出的 `exit=1`、`-c -i` → 3 与之一致）。
- [GNU coreutils 手册](https://www.gnu.org/software/coreutils/manual/) —— `sort -k` 字段语义、`uniq` 只合并相邻重复行（本机实测三行输出证实）、`head -n -N` 属 GNU 扩展、`ls` 输出非终端时不上色。
- [GNU findutils 手册（`find` 与 `xargs`）](https://www.gnu.org/software/findutils/manual/html_mono/find.html) —— `-print0 | xargs -0` 是带空白/换行文件名的唯一安全通道、`-exec {} +` 与 `\;` 的批量差异（本机那两行 `wc: ...: No such file` 即出自这里）。
- [GNU tar manual](https://www.gnu.org/software/tar/manual/) —— 归档与压缩分层（`-z/-j/-J` 只是过滤器）、`-C` 的顺序敏感、非 root 解包时属主与权限的处理。
- [man7.org Linux manual pages](https://man7.org/linux/man-pages/) 与 [Debian Reference 的 Shell and command line 一节](https://www.debian.org/doc/manuals/debian-reference/) —— 前者是 Windows 上没有 `man` 时的查法（本章参数拼写以它为准），后者告诉你哪些行为是 Debian 默认配置（别名、颜色、启动文件）而非 POSIX 约定。

## 下一章

本章解决「你在服务器上能不能看懂自己在干什么」：shell 的查找与展开规则、三个文件描述符与重定向顺序、退出码驱动的 `&&`/`||`，以及 glob/引号/管道这几处高频事故点，并用实测钉出了 Git Bash 与 Linux 的四类差异。下一章处理另一类问题——**同一台机器上「谁能碰什么」**：为什么 `nginx` 读不到你放在 `/home/deploy/` 下的文件（目录的 `x` 位管的是「能否进入并解析名字」，不是「能否执行」）、`umask` 怎么做减法、SSH 私钥权限不对会被拒绝成什么样、`sudo` 的授权边界在哪。权限模型的坑比命令更多，而且**在 Windows 上完全练不出来**（第 2 章会用实测证据说明）：[用户与权限](/linux/users-and-permissions)。
