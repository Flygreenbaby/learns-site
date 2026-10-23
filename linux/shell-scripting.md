# 在你机器上跑得好好的：Shell 脚本的引号、退出码与静默失败

备份脚本每天在 cron 里显示「执行成功」，你去恢复时才发现它一份都没删、也一份都没备；CI 里 `bash deploy.sh` 中途某步已经失败，脚本却继续往下跑，最后返回 0，于是流水线绿灯合并。这两类事故有个共同点：**Shell 不会因为你写错了就停下来，它只在你明说要停的时候停**。而它的默认行为——把变量当多个词拆开、把找不到匹配的通配符原样留着、把任何命令的失败吞成一个数字——都是为了让交互输入更顺手而设计的，放到脚本里全是反作用。

更麻烦的是环境差异。同一份脚本，你在 Git Bash 里跑得好好的，放到服务器的 cron 里就报 `command not found` 或 `/bin/bash^M: bad interpreter`。上一章（[网络诊断](/linux/networking)）里那条「管道会让 `curl` 的退出码说谎」只是这一章问题的一个具体表现：Shell 的引号、词分割、退出码传递和 `set -e` 的边界，合起来构成一套**静默失败**的机制。

<Callout type="verified" title="本章实测环境">

Git Bash 的 `GNU bash 5.2.37(1)-release (x86_64-pc-msys)` + GNU coreutils/findutils/tar/grep，Windows 10 x64，日期 2026-10-19 至 10-20。所有实验都在 `.scratch/` 下的临时沙箱里跑，脚本结束自己删除沙箱目录（最后一次运行输出：`沙箱已清理：... w6 是否存在：否`）。输出里的用户名与组名一律写成 `<用户> <组>`。

</Callout>

<Callout type="unverified" title="Git Bash 不等于 Linux">

本章所有标「实测」的结果都来自这台 Windows 上的 MSYS bash。**语法层的东西（引号、词分割、`[[ ]]`、`PIPESTATUS`、`set -e` 边界）可以迁移**，因为那是 bash 本身的行为；**环境层的不行**：可执行位、`chmod` 效果、`systemd`、`apt`、`man`、`nc`、`ps -ejH`、`/dev/tcp` 这些本机不存在或语义不同，本章末尾有逐项复核。最典型的例子是 CRLF：Git Bash 对带 `\r` 的脚本**宽容到能正常跑完**，而这恰恰是你不能拿它当验收工具的原因。

</Callout>

## 变量里存的是文本，不是命令

```bash
cmd="ls /nonexistent-path"
echo "$cmd"        # 只打印这行文本，不执行
$cmd               # 展开后当作命令执行
```

```text
hello world
赋值只是字符串，展开后仍然执行：
ls: cannot access '/nonexistent-path': No such file or directory
退出码=2
```

第 3 行打印文本、第 4 行才真的执行。这个区别决定了后面所有内容：**Shell 先做展开，再决定怎么切词、谁是命令**。你写的是字符串，Shell 看到的是一行待解析的输入。

## 引号不是美观问题

三个真实后果，全部本机实测。

**空格文件名被拆成两个参数。** 沙箱里有一个文件叫 `my report.txt`：

```text
--- ls my report.txt（不加引号）---
ls: cannot access 'my': No such file or directory
ls: cannot access 'report.txt': No such file or directory
退出码=2
--- ls "my report.txt"（加引号）---
my report.txt
退出码=0
```

**通配符装进变量后会被现场展开。** 你想「把匹配模式传给别人」，结果传出去的是当前展开结果：

```text
pat 的内容是：*.txt
不加引号传给 echo：my report.txt
加引号传给 echo：  *.txt
```

**空变量会整体消失，导致参数错位。** 这是最阴的一种，因为它不报错：

```text
--- 不加引号：空变量整体消失，参数个数变了 ---
[a] [b]
--- 加引号：留下一个空参数，位置没塌 ---
[a] [] [b]
```

`printf '[%s] ' a $empty b` 少了一个参数，`%s` 就复用格式串去填空串；真实脚本里，这会让 `rsync` 的目标路径、`curl -H` 的请求头、`tar` 的排除项全部错位。**规则只有一条：变量展开一律加双引号**，除非你确实想要词分割。

连函数定义都能因为少写一个分号变成语法错——本章脚本第一次就死在这上面：

```text
bash: -c: line 2: syntax error: unexpected end of file
```

`f2() { show $*; }` 里 `;` 不能省，因为 `{ ... }` 是复合命令，`}` 必须是独立的一个词。

转发参数时，`$*` 和 `$@` 的差别就在引号上：

```text
用 $* 转发参数会拼成一个词：
  arg1=[a]
  arg2=[b]
  arg3=[c]
用 "$@" 转发才对：
  arg1=[a b]
  arg2=[c]
```

原始参数是两个（`a b` 和 `c`），`"$*"` 会粘成一个，`"$@"` 保持每个参数的边界。写包装脚本就用 `"$@"`。

## `[ ]` 是一条命令，不是语法

这是理解判断语句报错的关键：`[` 是内建命令（也是 `/usr/bin/[` 这个真文件，实测 `which [ -> /usr/bin/[`），它的 `]` 参数必须是独立的一个词。所以变量为空时，展开就把命令拆坏了：

```text
x 为空字符串时：[ $x = "a" ]
sh6.sh: line 55: [: =: unary operator expected
  退出码=2 —— 报错原文来自 [ 这条命令本身
  走了假（退出码 2 属于 if，不是错误）
```

第二行的 `[:` 前面那个冒号是「命令名: 消息」格式的一部分，不是笔误。加引号之后 `[ "$x" = "a" ]` 就是干净的假（退出码 1，无报错）。同一条判断写成 `[[ $x = "a" ]]` 也不需要引号、也不报错，因为 `[[ ]]` 是 Shell 语法结构，内部不再做词分割和 glob。

顺带实测的两个坑：

```text
[[ ]] 里 && 短路（左假不求右）：
sh6.sh: line 64: ]: command not found
  退出码=127
[ ] 里用 -a 混逻辑（易错）：
  [ 1 -a "" ] 退出码=1
```

第一个是我自己写错留下的证据：`[ "" ] && [ ... ]` 里我多写了个 `;`，把 `]` 切成了独立命令。`127` 这个退出码专门表示「命令没找到」，看到它就该去查 `PATH` 或拼写——上一章 E7/E8 讲过同一件事。第二个是 `[ ]` 里 `-a` / `-o` 的优先级和参数展开混在一起容易得出意外结果，**要组合条件就用 `[[ ]]` 加 `&&` / `||`，或者干脆写成两个 `[ ]`**。

两者的能力差别：

| 需求 | `[ ]`（test） | `[[ ]]` |
| --- | --- | --- |
| 空变量不加引号 | 报 `unary operator expected` | 安全 |
| 字符串模式匹配 | 不支持 | `[[ f == *.log ]]` |
| 正则 | 不支持 | `[[ s =~ re ]]` + `BASH_REMATCH` |
| 逻辑组合 | `-a` / `-o`（易错） | `&&` / `||`，且短路 |
| 可移植性（`sh`、POSIX） | 是 | 不是 |

实测的匹配与捕获：`[ "010" -eq 10 ]` 退出码 0（数字比较会做进制归一）；`[[ ab123 = ab* ]]` 与 `[[ ab123 =~ ^[a-z]+[0-9]+$ ]]` 都退出码 0；用正则从文件名里提日期，`BASH_REMATCH[1]` 拿到 `2026-10-19-0312`。需要严格匹配字面量时记得加引号：`[[ name == "1.0" ]]`。

还有一个跨环境后果实测到了：含 `\r` 的字符串和不带的比较**不相等**（`=` 和 `[[ == ]]` 都退出码 1），`case` 也匹配失败。所以「读配置文件的行来做判断」的脚本在 CRLF 文件上会全线失灵。

## 退出码：0 是真，非 0 是假，而且只留低 8 位

```text
exit 0 -> 0
exit 255 -> 255
exit 256 -> 0（256 被截成 0）
exit 300 -> 44（300-256=44）
```

这不是学术细节：如果你用退出码传递状态数字，`exit 256` 会被当成「成功」。想让脚本输出一个失败信号，就挑 1–255 里互不冲突的几个值并在注释里写明含义。

第二个实测现象更常见：

```text
grep 没匹配到 -> 退出码=1（但上面明明打印了 0）
ls 失败 -> 退出码=2
```

`grep -c` 打印 `0`（匹配行数）**同时**以退出码 1 结束——因为「没匹配到任何行」按定义就是假。在 `set -e` 的脚本里，`n=$(grep -c pattern file)` 会因为这一条把脚本直接终止。这类「输出是你要的数，退出码却是失败」的命令，处理办法是把它放到条件位（`set -e` 不管条件位，见下一节）或者显式接住：`n=$(grep -c pattern file || true)`。

## `set -euo pipefail` 到底管什么

三件套的作用分别是什么：`set -e` 让命令失败即退出、`set -u` 让用到未定义变量报错、`set -o pipefail` 让管道的退出码取第一个失败的成员。听起来等于「脚本会老实报错」，但边界很多，全部实测过：

```text
--- ① 普通命令失败：脚本停不停 ---
  外层看到退出码=1
--- ② 命令在 if / && / || 条件位里：set -e 不管 ---
②这行出现了：条件位里的失败不触发 errexit
  退出码=0
③false || 后面：|| 左边失败也不触发
③继续
  退出码=0
  退出码=1
  退出码=1
--- ⑥ 管道：set -e 只看最后一个命令 ---
⑥管道中段失败但末尾 cat 成功 → 脚本继续（这就是 pipefail 存在的理由）
  退出码=0
--- ⑦ PIPESTATUS 才是真相 ---
  PIPESTATUS=1 0; 普通 $? = 0
  开 pipefail 后 $? = 1
--- ⑧ set -u：用到未定义变量 ---
  开始
  bash: line 1: NO_SUCH_VAR: unbound variable
  上面即报错原文
--- ⑨ 但 set -u 对「空数组展开」有历史坑 ---
  元素数=0
  ⑨空数组在 bash 5.2 下不报错
--- ⑩ set -x 跟踪（排错第一步）---
  + a=1
  + b=3
  + echo b=3
```

上面那两行光秃秃的 `退出码=1` 是 ④ 和 ⑤：子 shell 里的 `(false)` 和函数里的 `false`——两条**都触发**了 errexit。也就是说 `set -e` 的判断依据是「这条命令的失败结果有没有被用于条件判断」，而不是「它在不在脚本主体里」。把它当「出错就停」用，会在下面两类地方翻车：

```bash
if grep -q pattern file; then ...; fi        # 条件位：grep 失败不退出脚本，这是对的
grep pattern file || exit 1                   # || 左边失败也不退出，靠右边兜住
local count=$(wc -l < big.log)                 # 不触发：local 自己的返回码盖住了命令替换
count=$(wc -l < big.log)                        # 触发：直接赋值时命令替换的失败会停
```

后两条是本章特意补测的（用独立的 `bash -c` 片段跑，不在上面那段输出里），差别就在声明与赋值是否合写：`local` / `export` 这类前缀命令的退出码是它自己的 0，会把里面 `$(...)` 的失败盖掉。想让失败真的生效，**先声明、再赋值**，或者写 `local count; count=$(...)`。

`set -u` 还有一个版本相关的坑：空数组 `"${arr[@]}"` 在旧 bash 里会报 unbound variable，社区惯例是写 `${arr[@]+"${arr[@]}"}`。本机 bash 5.2 实测**不报错**（`元素数=0` 后正常继续），所以这条老建议在你自己的服务器上是否还必要，得先看那台机器的 bash 版本。排错时最有用的是 `set -x`——trace 里的 `+ 命令` 前缀能直接告诉你它把哪些词当成一个参数了，而且 `set -x` 会写进 stderr，cron 的邮件里就带着它。

## 循环体吃掉了你的输入

`while read` 从 stdin 读，循环体里任何命令也继承同一个 stdin——于是它们会抢走剩下的行。这是「`for` 循环里放 `ssh`，只有第一行被处理」的经典事故。实测：

```text
--- 循环体里放一个会读 stdin 的命令 ---
  第 1 次迭代：a.txt
    [子进程从 stdin 抢走了 "b.txt\nc.txt\n"]
  循环实际迭代次数=1（3 行只跑了 1 次）
--- 修法 1：< /dev/null ---
  修法 1 后迭代次数=3
--- 修法 2：给循环独立 fd ---
  修法 2（fd 3 独立于循环体的 stdin）迭代次数=3
```

```bash
while IFS= read -r name; do
  ssh host "true" < /dev/null     # 修法 1：不让它读
done < list.txt

while IFS= read -r -u 3 name; do   # 修法 3：显式指定 fd
  ...
done 3< list.txt

mapfile -t files < list.txt        # 修法 4：先全读进数组，不再依赖 stdin
```

`IFS= ` 和 `-r` 也都不能省：前者防止行首行尾空白被吃掉，后者防止 `\` 被当续行。文件名里没有换行的话，`mapfile` + 数组是最省心的写法。

## 相对路径按谁的工作目录解析

脚本里写 `cat data.txt`，它的含义是「**当前工作目录**下的 data.txt」，而不是「脚本所在目录下的」。放进 cron、systemd 或别人的 CI 里，工作目录就变了：

```text
--- 在 / 下调用：相对路径解析到哪里？ ---
cat: data.txt: No such file or directory
--- 用脚本自身目录拼绝对路径 ---
cat 成功：data.txt 的内容
```

两种写法实测的差异只在路径。取脚本自身位置：

```bash
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
```

`$0` 在 `bash script.sh` 下是 `script.sh`，在 `source` 场景里则完全不是这个脚本，所以要用 `BASH_SOURCE[0]`。`cd` 之后再用相对路径，行为就跟调用方式无关了。这条属于上一章「同一个二进制在不同环境下行为不同」的同一主题——cron 给你的 `PATH` 和 `HOME` 也更少，见[软件包与运行环境](/linux/packages-and-runtime)。

shebang 相关的两件事本机也复核了：`/bin/bash`、`/usr/bin/bash`、`/usr/bin/env` 在 Git Bash 里都存在，`./hello.sh` 能直接跑（**没有 chmod**），`$0` 分别是 `./hello.sh` 和 `hello.sh`。在 Linux 上少了可执行位会报 `Permission denied`、退出码 126——这条**未在本机验证**，机制见上一章 E1。

## CRLF：从 Windows 拷到 Linux 的第一号故障

Git Bash 对带 `\r` 的脚本**完全宽容**：

```text
文件里是否真有 \r：2 行含 CR
--- Git Bash 跑带 CRLF 的脚本（观察它宽容还是报错）---
  第一行
  第二行
--- 退出码=0 ---
--- 用 cat -A 看到行尾（$ 是行尾，^M 就是 CR）：---
echo "第一行"^M$
echo "第二行"^M$
```

`cat -A` 里 `^M$` 就是「CR + 行尾」，这就是证据本身。**但这份宽容不能作为验收**：Linux 上 bash 会把 `\r` 当成命令名的一部分（`$'echo\r': command not found`），而 shebang 行带 `\r` 时内核会去找一个叫 `/bin/bash\r` 的解释器，报 `/bin/bash^M: bad interpreter` 或 `no such file or directory`——这两句是预期现象，**未在本机验证**。

顺带一个本机才有的怪现象：本章用带 CR 的管道测试 `grep '^第二行$'`，Git Bash 的 grep **把 CR 吞了**，命中 1 条；同样的命令在 Linux 的 GNU grep 上大概率不命中。**这条现象不可迁移，不要据此判断自己的数据。**

修法按场景选：`tr -d '\r' < in > out`、`sed -i 's/\r$//' file`（两者本机实测有效）、本机存在的 `dos2unix`。根治则是让 Git 别在检出时转换：`git config --get core.autocrlf` 在本机是 `true`，这正是「仓库里 LF、工作区 CRLF」的来源；跨平台共享脚本时用仓库根的 `.gitattributes` 固定 `*.sh text eol=lf`。这条配置属于[工程工具与部署](/devops/)的范围，本章只给结论，未在本机改动过任何仓库配置。

## 两个真跑过的脚本：备份轮转与日志清理

备份部分跑的是真实 GNU tar，沙箱里造 5 份、留下最新 3 份，并先校验内容再删：

```bash
tar -czf "$BACKUP_DIR/backup-$STAMP.tar.gz" data            # 打包
tar -tzf "$BACKUP_DIR/backup-$STAMP.tar.gz"                  # 校验：列内容，不看退出码就删等于没备份
mapfile -t all < <(ls -1 "$BACKUP_DIR"/backup-*.tar.gz | sort -r)
for f in "${all[@]:"$KEEP"}"; do rm -f "$f"; done            # 只删第 KEEP 份之后
```

```text
生成的备份：
backup-2026-10-11-0300.tar.gz
backup-2026-10-12-0300.tar.gz
backup-2026-10-13-0300.tar.gz
backup-2026-10-14-0300.tar.gz
backup-2026-10-15-0300.tar.gz
--- 校验备份内容真的在 ---
data/
data/app.conf
data/app.db
--- 只留最新 keep 份（按名字倒序，不解析 ls 的坑写法）---
  删除 backup-2026-10-12-0300.tar.gz
  删除 backup-2026-10-11-0300.tar.gz
保留后剩：3 份
```

（时间戳是脚本用 `date` 往前推生成的假日期，不是真实运行时刻。）

命名要按字典序能排出时间序，所以用 `backup-YYYY-MM-DD-HHMM`，别用 `backup-$RANDOM`。反面写法也实测了——把 `ls` 的结果直接交给不加引号的 `for`：

```text
  for + 未加引号展开把它拆成：[backup]
  for + 未加引号展开把它拆成：[with]
  for + 未加引号展开把它拆成：[space.tar.gz]
```

一个文件 `backup with space.tar.gz` 被拆成三个词，`rm -f` 会拿着 `backup`、`with`、`space.tar.gz` 三个名字去删。用 `mapfile` + `"${arr[@]}"`，或者 `-print0` 配 `xargs -0`。

日志清理的关键是 `find -mtime` 的真实语义。同一目录放三个文件（3 天前、25 小时前、现在），实测：

| 文件的 mtime | `-mtime +1` | `-mtime +0` |
| --- | --- | --- |
| 3 天前（10-17） | 命中 | 命中 |
| 25 小时前（10-19 10:02） | 不命中 | 命中 |
| 现在（10-20 11:02） | 不命中 | 不命中 |

`-mtime +N` 判断的是「文件的 mtime 距现在**超过了 N+1 个 24 小时**」，是整除之后的比较，所以 25 小时前的文件不算 `+1`——你以为在删「超过 1 天」的，实际删的是「至少 2 天」的。想按小时精确控制就用 `-mmin`。删除动作的纪律：**先 `-print` 演练，看到列表再换 `-delete`**，这一步实测过（演练输出 `log/a.log`，剩余 `b.log c.log`）。批量删除配合空格文件名：

```bash
find . -name '*.log' -mtime +7 -print0 | xargs -0 rm -f    # 本机实测：安全删除 old 1.log、old 2.log
```

`xargs` 不带 `-0` 时按空白切分，含空格的文件名会碎成两个参数；`-print0` / `-0` 用 NUL 分隔才安全。GNU findutils 的 `-delete` 隐含 `-depth`，所以想同时 `-delete` 目录要按深度顺序来。

## 函数与 trap：清理动作放哪

下面这段是脚本 S12 的原样输出，`local`、`return`、`trap EXIT` 三件事一次跑完：

```text
  函数里 a=内部值
  函数外 a=外部值（local 生效）
  函数返回值：0
  return 7 → $? = 7
    正常退出前
  [trap] EXIT 清理被执行
  准备失败退出
[trap] EXIT 也会捕获退出码
  外层看到退出码=3
```

`[trap] EXIT 清理被执行` 出现在正常退出那条，`[trap] EXIT 也会捕获退出码` 出现在 `exit 3` 那条——**两种结束路径都跑了清理**，所以它是唯一可靠的收尾位置。函数没有返回值，只有退出码：`return 7` 之后 `$?` 是 7；想传数据就写 stdout 或用 `printf -v` 传引用。`local` 只在函数里有效，实测外层变量保持原值。

```bash
tmp=$(mktemp) || exit 1
trap 'rm -f "$tmp"' EXIT
```

注意 `trap` 里的引用要用单引号延迟展开，且如果脚本会被 `kill -9`，任何 trap 都不会执行——那种场景得靠外部约定（写进 `mktemp -d` 的目录并在下次运行时清理残留）。

## 常见错误与排查

**1. 脚本在终端里正常，进 cron 就 `command not found`。** 现象：cron 邮件或 `/var/log/cron` 里报命令找不到，退出码 127。原因是 cron 给的 `PATH` 比你的登录 shell 短得多（见上一章 E5 的 `env -i` 复现法），或者 `PATH` 里有但版本不对。怎么确认：在脚本开头临时加 `echo "PATH=$PATH"; command -v node`，让它把环境写进日志。修法：脚本里显式 `export PATH=/usr/local/bin:/usr/bin:/bin`，或全部用绝对路径；`crontab -l` 之外还要看 `/etc/cron.d/` 与 `systemd.timer`（见[进程与 systemd](/linux/processes-and-systemd)）。

**2. `set -e` 加了，脚本还是带病跑到底。** 现象：某步明显失败，后续继续执行，最后退出码 0。原因有三类实测边界：命令处在条件位（`if`/`&&`/`||` 左边）、管道中段失败（`set -e` 只看最后一个命令）、失败发生在命令替换里而外面是 `local`/`export` 声明。怎么确认：`set -x` 跑一遍看 trace，或用 `bash -e -c` 单条复现。修法：`set -euo pipefail` + 关键步骤显式 `|| exit 1`，别把 `set -e` 当保险箱。

**3. 变量没加引号，文件名带空格就出事。** 现象：`rm`、`tar`、`rsync` 报「找不到文件」，或者删掉了你没打算删的东西。原因是词分割：实测 `my report.txt` 被拆成两个参数、`backup with space.tar.gz` 被拆成三个。怎么确认：把命令 echo 出来看参数个数（`printf '[%s]\n' $var`），空变量消失也是同一机制。修法：所有展开加双引号；遍历文件用 `mapfile` 或 `-print0 | xargs -0`。

**4. 判断语句报 `unary operator expected` 或 `too many arguments`。** 现象：脚本还在跑，但走错分支。原因：`[` 是命令，变量为空时展开把参数拆坏（实测退出码 2，且在 `if` 里表现为假而不是错误）。怎么确认：直接把 `[ $x = a ]` 打在终端看报错原文。修法：`[ "$x" = "a" ]`，或改用 `[[ $x = a ]]`；要正则、模式匹配、逻辑组合一律用 `[[ ]]`。

**5. 循环只跑了一次。** 现象：三个条目的列表，循环体只执行一遍，剩下的条目像被吞了。原因：循环体里的命令读走了同一个 stdin（实测子进程一次读走 `"b.txt\nc.txt\n"`，迭代次数=1）。怎么确认：循环体第一行加 `wc -c <&0`，看还剩几字节。修法：给该命令接 `< /dev/null`，或 `read -u 3` 用独立 fd，或 `mapfile` 先读进数组。

**6. `bash script.sh` 报 `bad interpreter` 或 `command not found`，但 Git Bash 里毫无问题。** 现象：Linux 上第一行就死。原因：文件是 CRLF，`$ cat -A` 能看到行尾 `^M$`。怎么确认：本机实测的 `grep -c $'\r' file` 或直接 `cat -A`。修法：`tr -d '\r'`、`sed -i 's/\r$//'`、`dos2unix`；仓库侧用 `.gitattributes` 固定 `*.sh text eol=lf`。注意这条**不能靠 Git Bash 验证**——它宽容到能跑通。

**7. `grep -c` 结果为 0 时脚本意外终止。** 现象：`set -e` 的脚本在统计那一步停了，但屏幕上明明打印了 `0`。原因：`grep` 没匹配到就是退出码 1，这是语义而不是 bug（实测）。修法：`n=$(grep -c pat file || true)`，或把它放进条件位；真要「计数允许为 0」就用 `grep -c ... | tail -1` 之外的显式处理。

## 练习

<Exercise title="故意把脚本写坏并读报错" difficulty="基础">

在临时目录里造一个文件名为 `my report.txt` 的文件，然后依次执行下面三行，把每一行的**报错原文**和退出码抄下来，并解释差异来自哪一步（展开、词分割还是 glob）：

1. `f="my report.txt"; ls $f`
2. `f="my report.txt"; ls "$f"`
3. `f=; [ $f = "a" ]; echo $?`，再和 `[ "$f" = "a" ]; echo $?` 对比

<template #answer>

本章实测结果：

1. 两行报错加退出码 2：`ls: cannot access 'my': No such file or directory` 和 `ls: cannot access 'report.txt': No such file or directory`。原因是无引号的变量展开后做词分割，一个参数变两个。

2. `ls` 正常输出文件名，退出码 0。

3. 不加引号：`bash: [: =: unary operator expected`，退出码 2；加引号：无输出，退出码 1。差异是空变量不加引号时**整体消失**，`[` 收到的参数少了一个，`=` 变成一元操作数。

如果第 3 条在你的 shell 里 `[ $f = "a" ]` 出现在 `if` 条件位，注意它的退出码 2 会被当成「假」，脚本不会报错、只会走错分支——这正是这类 bug 难发现的原因。第三问的补充实验：把 `f` 设成含两个词的字符串再判断，报错会变成 `too many arguments`，同一机制。

</template>

</Exercise>

<Exercise title="让管道里的失败真的暴露出来" difficulty="进阶">

写一段脚本，把 `grep pattern big.txt | wc -l` 的结果送进一个变量，同时要求：当 `grep` 因为「没匹配到」而失败时脚本继续但记录这一事实；当 `grep` 因为「文件不存在」而失败时脚本立即退出。给出你的实现，并说明为什么不能只用 `set -e` 来判断。

<template #answer>

```bash
set -uo pipefail
out=$(grep pattern big.txt 2>/dev/null); gstatus=$?
case $gstatus in
  0) count=$(printf '%s\n' "$out" | wc -l); echo "匹配 $count 行" ;;
  1) echo "没匹配到，继续"; count=0 ;;
  2) echo "grep 用法或文件错误"; exit 1 ;;
  *) echo "未预期退出码 $gstatus"; exit 1 ;;
esac
```

要点：`set -e` 只看命令的成败布尔值，不区分失败原因，而 `grep` 的退出码本身是有语义的——0 有匹配、1 无匹配、2 出错（本章实测：无匹配时打印 `0` 但退出码 1；文件不存在时退出码 2）。要按原因分支，必须**先把 `$?` 取出来**，再决定继续还是退出。

反面写法是 `n=$(grep -c pattern big.txt | wc -l)`：即使开了 `pipefail`，命令替换失败在外层是普通赋值，`set -e` 是否触发取决于是否带 `local`（本章实测：`local v=$(false)` 不触发、`v=$(false)` 触发）。想读管道每一段的码，只有 `PIPESTATUS`——实测 `PIPESTATUS=1 0` 而普通 `$? = 0`，这正是本章正文那条「管道会让退出码说谎」的机制，上一章 [网络诊断](/linux/networking) 的 curl 健康检查踩的是同一个坑。

</template>

</Exercise>

<Exercise title="写一个可重复运行的备份脚本" difficulty="挑战">

要求：备份 `data/` 到 `backups/`，文件名带时间戳；保留最新 3 份；删除前必须校验新归档能列出内容；备份目录里存在带空格的文件名也不能出错；同一分钟重复运行不能把已有备份删掉。写出脚本骨架，并列出你为每一条要求做的具体决定。

<template #answer>

本章实测跑通的骨架：

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

BACKUP_DIR=$PWD/backups
KEEP=3
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y-%m-%d-%H%M)
ARCHIVE="$BACKUP_DIR/backup-$STAMP.tar.gz"
[ -e "$ARCHIVE" ] && { echo "本分钟已备份过：$ARCHIVE"; exit 0; }

tar -czf "$ARCHIVE" data
tar -tzf "$ARCHIVE" >/dev/null          # 校验：列不出内容就非零退出，set -e 拦住

mapfile -t all < <(find "$BACKUP_DIR" -maxdepth 1 -name 'backup-*.tar.gz' -printf '%f\n' \
                   | sort -r | sed "s|^|$BACKUP_DIR/|")
for f in "${all[@]:$KEEP}"; do
  rm -f -- "$f"
  echo "删除 $f"
done
```

逐条决定：`cd "$(dirname "${BASH_SOURCE[0]}")"` 让相对路径按脚本所在目录解析，不依赖调用者的 cwd（实测差异就在这一步）；`set -euo pipefail` 加显式校验，靠 `tar -tzf` 的退出码而不是「有没有输出」；命名 `backup-YYYY-MM-DD-HHMM` 保证字典序等于时间序，所以 `sort -r` 直接给出「新在前」；用 `find -printf` + `mapfile` 而不是解析 `ls`（实测不加引号的 `for` 把 `backup with space.tar.gz` 拆成 3 个词）；`rm -f --` 阻断以 `-` 开头的名字；同一分钟重名先退出，避免刚生成的归档出现在「旧版本」列表里被删。

如果想更严格，`KEEP` 的删除可以再加一层：只删「比当前时间早 24 小时」的，用 `find -mtime +0`——但注意本章实测的语义是 `-mtime +0` 命中超过 24 小时的文件，而 `+1` 要 48 小时，按小时需求请换 `-mmin`。

</template>

</Exercise>

## 官方文档与延伸阅读

- [GNU Bash Manual: DEFINITIONS](https://www.gnu.org/software/bash/manual/html_node/DEFINITIONS.html) 与 [Bash Reference Manual](https://www.gnu.org/software/bash/manual/html_node/index.html)：用于核实「word / pathname expansion / simple command」的定义顺序，即为什么无引号展开会先词分割再 glob；本章 `set` 内建的各项边界对照 [The Set Builtin](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html)。**已核实**（`set -e` / `pipefail` / `errexit` 的描述与该页一致）。注意手册按 5.x 编写，`"${arr[@]}"` 在空数组下的行为随版本变化，本章实测的是本机 5.2。
- [GNU Bash Manual: Bash Builtins](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html)：`[` / `test` / `[[ ]]` / `mapfile` / `read -u` / `trap` 的参数与退出码语义。
- [GNU findutils: find](https://www.gnu.org/software/findutils/manual/html_mono/find.html)：`-mtime` 的「24 小时为一单位」计算方式与 `-delete` 隐含 `-depth` 的行为；`-print0` / `xargs -0` 的配对。
- [GNU coreutils: tar（GNU tar）](https://www.gnu.org/software/tar/manual/) 与 [xargs](https://www.gnu.org/software/coreutils/manual/html_node/xargs-invocation.html)：`-tzf` 列内容与退出码、`xargs -0` 的分隔约定。
- [MDN / git 官方文档：git-config 与核心变量](https://git-scm.com/docs/git-config)：`core.autocrlf` 与 `.gitattributes` 的 `text eol=lf` 语义。本机实测仅到 `git config --get core.autocrlf` 返回 `true`，未改动任何仓库配置。
- 站内：[命令行与 Shell 基础](/linux/command-line)（展开顺序的第一手实验）、[用户与权限](/linux/users-and-permissions)（可执行位与 `Permission denied` / 126）、[软件包与运行环境](/linux/packages-and-runtime)（cron 的极简 `PATH` 与 `env -i` 复现法）、[网络诊断](/linux/networking)（管道退出码那一条的实战现场）、[进程与 systemd](/linux/processes-and-systemd)（timer 与 cron 的差别）。

## 下一章

本章把「在本地跑得好好的」拆成了展开、退出码、边界、stdin、路径、行尾六件事，你现在能对着一份脚本说出它在 cron 里会怎么死。下一章 [Nginx：把站点接到公网](/linux/nginx) 开始处理另一条线：机器上的服务已经监听对了，怎么让域名和公网流量真正走进来——反向代理、静态资源、HTTPS，以及本章那条「先演练再删除」的纪律在配置文件上的对应形式：`nginx -t` 与 reload 的安全顺序。
