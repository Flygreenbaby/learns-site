# 快照而不是差异：想清楚 Git 存了什么，命令才不会像咒语

你在项目目录里改了三个文件，跑起来发现行为不对，想回到上午十点的状态。于是你手工复制了一份 `myapp-备份-0918`，后来变成 `myapp-final`、`myapp-final-真的final`。第三天你想对比两个备份到底哪一行不同，只能开 diff 工具两眼对两眼。这就是没有回退能力的样子：**你存的不是版本，是副本**，而副本之间没有任何可追溯的关系。

Git 的做法和你想象的不同。它不记录「改了什么」，它记录「每个时刻的完整状态长什么样」——快照（snapshot）。而且每个快照用一个由内容本身算出来的哈希命名，所以「这个版本」是一个地址，不是一个日期。想通这一点，很多像咒语的命令会变成同一件事的不同写法：`git reset --hard HEAD~1` 是把指针往回挪一格并同步磁盘，`git checkout v1.2.0` 是把磁盘变成那个快照，`git reflog` 能救命是因为**指针的每一次移动 Git 都单独记了账**。

本章所有输出都在本机真跑过（仓库建在临时目录里，命令执行完把原文抄下来）。**示例里的用户名、邮箱与 Git 安装路径已换成虚构占位值**，输出结构、字段顺序和取值本身未改动。凡是需要 GitHub 服务器、CI Runner 或 Docker 的都不碰。**唯一要提前警告的是 `git reset --hard` 与 `git clean -fd`：实测里磁盘上的文件真的被删掉了。**

<Callout type="verified" title="本章实测环境">

Git `2.52.0.windows.1`（Git for Windows，命令在 Git Bash 执行），Windows 10 x64，2026-10-18。本章 `text` 代码块里的输出都是真实返回值，未做美化；`git switch` / `git restore` / `git stash` / `git bisect` / `git bundle` / `git sparse-checkout` 在本机全部可用；默认分支名与 `pull.rebase` 的取值见「config 三级」一节——本机受 Git for Windows 的 system 级配置影响，你的机器可能不同。

</Callout>

## Git 存的是三类对象，全部用内容的哈希命名

建仓库、提交两个文件，然后打开 `.git` 看里面到底有什么。

```bash
mkdir tmp && cd tmp && git init        # Initialized empty Git repository in D:/.../tmp/.git/
printf 'hello\n' > a.txt && printf 'ignore me\n' > secret.txt
git add a.txt && git commit -m first
printf 'world\n' > b.txt && git add b.txt && git commit -m second
```

`git init` 之后 `.git` 顶层只有六个条目：

```text
HEAD  config  description  hooks  info  objects  refs
```

`refs` 放指针，`HEAD` 说明你在哪个指针上，`objects` 放全部数据。看看 objects 里实际有什么：

```text
18/eb80fbbbf9160491c007668d5298f1e86cd40a
2e/81171448eb9f2ee3821e3d447aa6b2fe3ddba1
91/3711bb486902691f13bdcf1ea9648b676309e9
cc/628ccd10742baea8241c5924df992b5c019f71
ce/013625030ba8dba906f756967f9e9ca394464a
f3/52bcbd62a271969445abc45aca3eb54b7ff90b
```

**两个提交产生了六个对象文件，不是两个**（`git count-objects -v`：`count: 6`、`in-pack: 0`）。目录名是哈希前 2 位、文件名是后 38 位，只为避免一个目录里堆几十万个文件。逐个问类型（`git cat-file -t <哈希>`）：

| 哈希 | 类型 | 是什么 |
| --- | --- | --- |
| `f352bcb` / `913711b` | commit | 两笔提交 |
| `18eb80f` / `2e81171` | tree | 两个时刻的根目录清单 |
| `ce01362` / `cc628cc` | blob | `hello`、`world` 两段内容 |

分工：**blob 存文件内容**（不含文件名）、**tree 存「名字 → blob 哈希」的清单**、**commit 存「一个 tree + 零到多个 parent + 作者与提交者」**。拆开看：

```text
$ git cat-file -p HEAD
tree 18eb80fbbbf9160491c007668d5298f1e86cd40a
parent 913711bb486902691f13bdcf1ea9648b676309e9
author Learner <learner@example.com> 1792292792 +0800
committer Learner <learner@example.com> 1792292792 +0800

second

$ git cat-file -p HEAD^{tree}
100644 blob ce013625030ba8dba906f756967f9e9ca394464a	a.txt
100644 blob cc628ccd10742baea8241c5924df992b5c019f71	b.txt
```

`git ls-files -s` 打的是索引里的同一份清单，格式 `<模式> <哈希> <stage号> <名字>`；stage 平时恒为 0，只有冲突时变成 1/2/3（冲突一节会看到它派上用场）。

**内容寻址（content addressing）是全部要害**：哈希由内容算出，内容相同 ⇒ 哈希相同 ⇒ 对象只存一份。验证一下，把 `hello` 直接喂给哈希函数，根本不碰仓库：

```bash
printf 'hello\n' | git hash-object --stdin
# ce013625030ba8dba906f756967f9e9ca394464a
```

和上面 `a.txt` 那个 blob 一字不差。于是三件事是推论而不是特性：同一内容复制一百份不多一个 blob；两人各自提交相同内容得到同一对象；改写历史里任何一个字节，哈希必变。

哈希算法默认仍是 SHA-1（40 个十六进制字符）。Git 2.52 换 SHA-256 必须建库时显式指定（实测 `git init --object-format=sha256` 成功，提交哈希长度 64），老仓库无法原地转换；别人说「Git 哈希会碰撞」时，先确认他指哪一个。另一条 Windows 专属事实：`git init` 后 `.git/config` 的 `[core]` 里被自动写了 `filemode = false`、`ignorecase = true`，这是 Git 探测文件系统的结果——别照抄 Linux 教程去 `chmod +x` 然后奇怪模式没变（写钩子时必须在 Git Bash 里 `chmod` 才有效）。

## 三个区，以及暂存区到底在替你做什么

**工作区（working tree）**是你正在编辑的文件，**暂存区（index）**是「下次提交准备收录的清单」，**仓库**是那些 commit 对象。

```bash
printf 'line1\nline2-CHANGED-WORKTREE\nline3\n' > f.txt   # 只改磁盘
printf 'a\nb\n' > keep.txt && git add keep.txt            # 改磁盘 + 写进清单
git status -s
#  M f.txt
# M  keep.txt
```

**这两行的区别就是暂存区的存在理由**：第一列是「暂存区 vs HEAD」，第二列是「工作区 vs 暂存区」。` M` 表示改动还没进清单，`M ` 表示已进好。于是 `git diff` 的三个变体不是三条近似命令，而是三个不同问题：

| 命令 | 比较 | 实测输出（同一时刻） |
| --- | --- | --- |
| `git diff` | 工作区 vs 暂存区 | `f.txt \| 2 +-` |
| `git diff --cached` | 暂存区 vs HEAD | `keep.txt \| 1 +` |
| `git diff HEAD` | 工作区 vs HEAD | 两者都有 |

注意 `git diff HEAD -- keep.txt` 输出 7 行而不是 0 行——**它没有排除已暂存的部分**。想知道「这次 commit 会包含什么」，只有 `--cached` 是对的。

暂存区买到的三样能力：**一次只提交一个逻辑变更**（顺手改了三处：修 bug、调格式、加日志，用 `git add -p` 挑）、**提交前审的就是即将成为历史的内容**（`git diff --cached` 比 `git diff` 更接近 review 对象）、**三方合并有地方同时存三个版本**（冲突时 stage 号不再是 0）。

`git add -p` 也能脚本化验证，`printf 'y\nq\n' | git add -p f.txt` 会看到它按块询问（`(1/1) Stage this hunk [y,n,q,a,d,e,p,P,?]?`）；答 `y` 后 f.txt 出现在 `git diff --cached --stat` 里——这一块进了清单，其余留在工作区。**HEAD、暂存区、工作区三者可以两两不一致，而 Git 认为这很正常**——新手的痛苦几乎都来自「想回退，却没搞清要回退哪一区」。

## .gitignore 只在「还没被跟踪」时起作用

`.gitignore` 不是「删除文件」，是「别把未跟踪的这个路径塞进清单」。规则实测：

```text
*.log
build/
!important.log
tmp/*
!tmp/keep/
```

```bash
git check-ignore -v app.log build/out.js important.log
# .gitignore:1:*.log	app.log
# .gitignore:2:build/	build/out.js
# .gitignore:3:!important.log	important.log
```

三条纪律，全部实测：

- **目录写成 `build/` 只匹配目录**；`tmp/*` 忽略 tmp 下的一切，而 `!tmp/keep/` 又把该子目录的内容放回来（`git add -n` 里出现 `add 'tmp/keep/keep.txt'`）。取反必须写在被忽略规则之后，且**父目录被整个忽略时无法用 `!` 救回里面的文件**——要写 `tmp/*` 而不是 `tmp/`。
- **`git add` 对「未跟踪 + 被忽略」直接拒绝**：`hint: Use -f if you really want to add them.`。这不是建议，是警告：加了 `-f` 文件就被跟踪，规则立刻形同废纸。
- **已跟踪的文件写进 ignore 完全无效。** 实测：提交 `conf.ini` 之后才追加规则，再改它，`git status` 照样报 ` M conf.ini`、`git add` 照样收。因为忽略机制只作用于「未跟踪」的候选集。

修法是把跟踪状态摘掉、**同时保留磁盘文件**：

```bash
git rm --cached conf.ini && git commit -m "chore: 停止跟踪 conf.ini"
# 之后：git status 干净；git ls-files 里 0 条；head -1 conf.ini 读得到内容
```

**顺序不能反：`rm --cached` 之后必须提交一次，这条规则才真正生效。** 另外 `git check-ignore` 默认会跳过已跟踪文件——文件仍被跟踪时它返回 exit=1 什么都不报，会让你误判规则写错了；要看规则本身匹不匹配，加 `--no-index`。

## 分支是一个 41 字节的文本文件

这是本章最值钱的图景。建分支，然后直接看 `.git`：

```bash
git branch feat-x
cat .git/refs/heads/feat-x      # f352bcbd62a271969445abc45aca3eb54b7ff90b
cat .git/HEAD                   # ref: refs/heads/master
```

**分支就是一个只装着一个 40 位哈希的文本文件。「新建分支」不复制任何文件，只是写一个文件**，所以百万提交的仓库开分支也是毫秒级。`HEAD` 则记录「我在哪个指针上」。切分支后 `cat .git/HEAD` 变成 `ref: refs/heads/feat-x`，磁盘被改写成分支所指快照的样子；两个分支指向同一提交时，切过去磁盘毫无变化——这就是「刚建的分支看起来什么都没变」的原因。

**分离头指针（detached HEAD）** 就是 `HEAD` 里放裸哈希而不是符号引用：

```bash
git switch --detach HEAD~1
cat .git/HEAD        # 913711bb486902691f13bdcf1ea9648b676309e9
git status | head -1 # HEAD detached at 913711b
```

在这种状态下提交，只有 `HEAD` 跟着挪，分支文件都不动（`git branch -v` 实测显示 `* (HEAD detached from 913711b) 688831f on detached head`）。**这笔提交不属于任何分支，切走再切回来就找不到它了**。什么时候会遇到：`git checkout v1.2.0`（tag 不是分支）、`git rebase` 进行中、CI 检出某个 commit。修法：`git switch -c 一个名字`。

## merge 怎么把冲突标记写进你的文件

两条分支改了同一行，合并必冲突（`main` 改第 2 行并加第 4 行，`bugfix` 改第 2 行）：

```text
$ git merge bugfix
CONFLICT (add/add): Merge conflict in both.txt
Auto-merging f.txt
CONFLICT (content): Merge conflict in f.txt
Automatic merge failed; fix conflicts and then commit the result.
```

`f.txt` 磁盘上的内容变成这样——**merge 直接改你的文件**：

```text
L1
<<<<<<< HEAD
L2-main-feature
L3
L4-new
=======
L2-bugfix
L3
>>>>>>> bugfix
```

`HEAD` 到 `=======` 是你这一侧，到分支名结尾是对侧。**默认 `merge.conflictStyle` 就是两段式**，不含共同祖先信息——这就是很多人解冲突像在猜的原因。要看三方合并：

```text
$ git -c merge.conflictStyle=diff3 merge bugfix
<<<<<<< HEAD
L1
L2-main-feature
L3
L4-new
||||||| a40cf77
line1
line2-CHANGED-WORKTREE
line3
=======
L1
L2-bugfix
L3
>>>>>>> bugfix
```

`|||||||` 下面那段是**共同祖先（merge base）**的内容，`a40cf77` 是它的提交短哈希。有了它才能判断「谁偏离了原样」，建议把 `merge.conflictStyle=diff3` 直接写进仓库配置。

冲突进行中 `.git` 多出五个文件：`AUTO_MERGE`、`MERGE_HEAD`（对侧提交）、`MERGE_MODE`、`MERGE_MSG`（预填的合并信息）、`ORIG_HEAD`（合并前的 HEAD，出事能退回）。`git status -s` 的码分两种：**`UU` 是内容冲突，`AA` 是双方各新增同名文件**。解决顺序只有一个：编辑删标记 → `git add` 该文件（**这步是「标记冲突已解决」，不是「暂存改动」**）→ 全部处理完才 commit。少 add 一个会被拒绝，实测原文：

```text
error: Committing is not possible because you have unmerged files.
hint: Fix them up in the work tree, and then use 'git add/rm <file>'
fatal: Exiting because of an unresolved conflict.
U	both.txt
```

`git diff --name-only --diff-filter=U` 是「还剩几个没解决」的可靠问法，不想干了就 `git merge --abort`。

**merge 与 rebase 的取舍**（机制实测，协作风险见下一章）：

| | merge | rebase |
| --- | --- | --- |
| 历史形状 | 保留真实时间线，产生 2-parent 合并提交 | 线性：提交逐个重放到目标之上 |
| 提交 SHA | 不变 | **全部改变**（parent 与时间戳变了） |
| 冲突次数 | 一次性集中处理 | 逐个提交处理，可能反复撞同一冲突 |
| 可追溯性 | `--graph` 看得出何时集成 | 看不出集成点，读起来干净 |
| 安全场景 | 已推送的共享分支 | 只有自己的、还没推的提交 |

在个人分支上用 `rebase` 整理半成品很好；用在别人已拉走的分支上就是制造陷阱——下一章用两个克隆实测后果。

## checkout 的旧统一命令被拆成三个

`git checkout` 历史上同时干「切分支」和「丢改动」两件不相干的事，Git 2.23 起拆开。本机 2.52 三个命令都在：

| 想做什么 | 现代写法 | 旧写法 | 实测备注 |
| --- | --- | --- | --- |
| 切到已有分支 | `git switch 分支` | `git checkout 分支` | 旧的仍可用 |
| 新建并切过去 | `git switch -c 新名` | `git checkout -b 新名` | `checkout -c` 报 `error: unknown switch 'c'` |
| 进入分离头指针 | `git switch --detach 提交` | `git checkout 提交` | |
| 丢弃工作区改动 | `git restore 文件` | `git checkout -- 文件` | |
| 把改动退回暂存区外 | `git restore --staged 文件` | `git reset 文件` | |
| 从别的提交取文件 | `git restore --source=HEAD~1 文件` | `git checkout HEAD~1 -- 文件` | |

分界线很硬：**`switch` 只碰分支，`restore` 只碰文件**，误操作半径变小。`restore` 管不到未跟踪文件，实测：

```bash
git restore tmp.txt
# error: pathspec 'tmp.txt' did not match any file(s) known to git
```

清未跟踪文件是 `git clean` 的活，而它是本章唯一**不进 reflog、不可恢复**的命令，先 `-nd` 看清单再 `-fd`。

## 撤销四件套：动的是哪一区，决定你能不能反悔

| 命令 | 动 HEAD | 动暂存区 | 动工作区 | 可恢复性 |
| --- | --- | --- | --- | --- |
| `git restore 文件` | 否 | 否 | **是** | 未提交的改动，**不可恢复** |
| `git restore --source=HEAD 文件` | 否 | 否 | 是（从指定快照取） | 同上 |
| `git restore --staged 文件` | 否 | **是** | 否 | 磁盘内容还在 |
| `git revert 提交` | 前进 | 前进 | 前进 | 生成新提交，历史完整 |
| `git reset --soft 目标` | **是** | 否 | 否 | 进 reflog，可捞 |
| `git reset 目标`（默认 mixed） | 是 | **是** | 否 | 文件留磁盘，但变成未跟踪 |
| `git reset --hard 目标` | 是 | 是 | **是** | 只有已提交的部分能捞 |

`--soft` 与 `--mixed` 的实测差别（三笔提交回退一格）：

```bash
git reset --soft HEAD~1 && git status -s
# A  c1.txt      ← 索引没动，改动全在暂存区，可以改个信息重提交
git reset HEAD~1 && git status -s
# ?? a1.txt  ?? b1.txt  ?? c1.txt  ?? d1.txt   ← 索引跟着回退，文件从已跟踪变未跟踪
```

**`--hard` 的真实破坏范围值得单独实测。** 上面 `--mixed` 之后文件已是未跟踪状态，紧接着的 `--hard` 没碰它们；但如果从含提交的状态直接 `--hard`，被丢弃提交里新增的**已跟踪**文件会从磁盘消失：

```text
--- c2 存在时磁盘: extra.txt only.txt      （另有未跟踪的 keepme.txt）
$ git reset --hard HEAD~1
HEAD is now at 481eb35 c1
--- 直接 reset --hard 后磁盘: keepme.txt only.txt
extra.txt（c2 里新增、已跟踪）还在吗: NO
keepme.txt（未跟踪）还在吗:          YES
only.txt 内容:                      v1
```

所以准确说法是：**`--hard` 把工作区和暂存区强行砸成目标快照，代价是丢掉提交里新增过的文件从磁盘删除、已跟踪文件的本地修改蒸发；未跟踪文件不受它影响**（要清它们得 `git clean -fd`，实测 `git clean -nd` 先报 `Would remove keepme.txt`）。**`--hard` 丢掉的未提交改动 Git 不记账，没有任何命令能救。** 写脚本时把它当 `rm -rf` 对待。

`git revert` 是唯一「向前撤销」的方式：生成一笔内容相反的新提交，历史一字未改，所以共享分支上只有它安全。

```text
e473391 Revert "main: rewrite line2 add line4"
 both.txt | 1 -
 f.txt    | 7 +++----
```

## reflog：为什么「丢掉」的提交通常还在

Git 为 `HEAD` 的每次移动单独写日志（`.git/logs/HEAD`）。上面三次 `reset` 全部留下痕迹：

```bash
git reflog -n 6
# 513e457 HEAD@{0}: reset: moving to HEAD~1
# 0563750 HEAD@{1}: reset: moving to HEAD~1
# 83d7f91 HEAD@{2}: reset: moving to HEAD~1
# f47797f HEAD@{3}: commit: 第三个文件
# 83d7f91 HEAD@{4}: commit: 两个文件
# 0563750 HEAD@{5}: checkout: moving from main to demo
```

`HEAD@{4}` 就是回退前的位置。**只要对象还在（默认 90 天内、没被 `git gc` 清掉），一条命令救回**：`git branch rescue HEAD@{4}` 实测让 `rescue` 指向 `83d7f91`，两个文件都回来了。

另一种是 `git cherry-pick HEAD@{4}`。它在本机**失败**（`Aborting` / `fatal: cherry-pick failed`），原因是上一步 `--mixed` 已把 `a1.txt`、`b1.txt` 变成磁盘上的未跟踪文件，cherry-pick 拒绝覆盖同名未跟踪文件。这是一个真实高频的组合坑：**`reset` 之后磁盘上还留着旧的未跟踪副本，任何 checkout/cherry-pick 都会撞它**。先确认状态（必要时 `git clean -nd` 看清再删）再捞。旁证：`git fsck --dangling` 在本机报出 3 个 `dangling tree`——对象确实在，只是没指针指着；`reflog` 是给人看的索引，`fsck` 是物理清单。

## stash、bisect、tag

**`git stash` 把工作区（和暂存区）压成一个临时提交。** 实测两个关键行为：

```bash
printf 'dirty\n' >> only.txt; printf 'untr\n' > u.txt
git stash push -m "半成品"      # Saved working directory and index state On main: 半成品
git status -s                   # ?? u.txt   ← 未跟踪文件仍在磁盘，没进 stash
git cat-file -t 'stash@{0}'     # commit
```

**默认 stash 不收未跟踪文件**，要连新文件一起带走得 `git stash push -u`。stash 本身是 commit 对象（`cat-file -p` 里它有两个 parent：当时的 HEAD 与当时的索引），所以能 `show`、能对比；pop 之后也能后悔——实测 `git stash pop` 末尾打印 `Dropped refs/stash@{0} (8aa5216e...)`，那个哈希就是后悔药。

**`git bisect` 用二分找「哪一笔开始坏的」**，7 个提交只需三步，判定脚本要「好返回 0、坏返回非 0」：

```bash
git bisect start HEAD "$(git rev-list --max-parents=0 HEAD)"
git bisect run bash -c '! grep -q BAD calc.txt'
# Bisecting: 2 revisions left to test after this (roughly 2 steps)
# bisect found first bad commit
```

`git bisect log` 完整记录判定过程（`# bad: [4ba2bf2] v6 改动` / `# good: [0165fc1] v3 改动` / `# first bad commit: [7ece411] v4 改动`），`7ece411` 正是我故意埋的那笔；跑完 `git bisect reset` 回原位（实测 `git bisect reset -q` 报 `error: '-q' is not a valid commit`，这子命令不吃 `-q`）。

**`git tag` 两种，差别在对象模型里看得见**：

```bash
git tag -a v0.1.0 -m "首个发布"; git tag wip
git cat-file -t v0.1.0    # tag     ← 独立 tag 对象，内含 object/type/tag/tagger
git cat-file -t wip       # commit  ← 只是一个指向提交的指针
git describe --tags       # v0.1.0-1-g1545b90
```

annotated 带 `tagger` 与签名位（`git verify-tag` 需要 GPG，本机未配密钥，**未验证**），轻量标签就是个分支别名。**发布版本必须用 annotated**，而且 tag 打完要单独推（`git push` 默认不带 tag，见下一章）。`git describe --tags` 那个 `v0.1.0-1-g1545b90` 字符串很适合直接当构建版本号。语义化版本三位含义见 [SemVer 中文](https://semver.org/lang/zh-CN/)，与发布流程怎么绑见[发布与回滚](/devops/release-and-rollback)。

## config 三级与身份：报错来自哪一层

`git config` 有 system / global / local 三个作用域，读取顺序 system → global → local，**后读到的覆盖前面的**。想知道值来自哪个文件，加 `--show-origin`：

```text
file:C:/Program Files/Git/etc/gitconfig	core.autocrlf=true
file:C:/Program Files/Git/etc/gitconfig	pull.rebase=false
file:C:/Program Files/Git/etc/gitconfig	init.defaultbranch=master
file:C:/Program Files/Git/etc/gitconfig	core.editor=notepad
file:C:/Program Files/Git/etc/gitconfig	credential.helper=manager
file:C:/Users/learner/.gitconfig	user.email=learner@example.com
file:C:/Users/learner/.gitconfig	user.name=Learner
file:.git/config	core.ignorecase=true
```

本机（Git for Windows）的 system 配置写了 `core.autocrlf=true` 与 `init.defaultBranch=master`，**所以本章每次 `git init` 建出的默认分支都叫 `master`，`git pull` 默认走 merge**。网上 `master` 派与 `main` 派教程并存，根源就在这里：这是安装器写的配置，不是 Git 内置默认。别抄我的结论，核对你的机器：

```bash
git config --show-origin --get init.defaultBranch    # 无输出 = 用内置默认
git config --show-origin --get pull.rebase
git config --get user.name; git config --get user.email
```

没配身份就提交，实测报错：

```text
Author identity unknown

*** Please tell me who you are.
```

三个身份坑：**`user.name`/`user.email` 是提交时写进对象的**，之后改配置只影响新提交；**工作邮箱与 GitHub 邮箱不一致会让贡献统计认不出你**，修法是给不同目录配 local 身份或用 `includeIf "gitdir:~/work/"`；**`core.autocrlf=true` 意味着每次检出可能把 LF 变成 CRLF**，实测每个新文件提交时都会警告：

```text
warning: in the working copy of 'a.txt', LF will be replaced by CRLF the next time Git touches it
```

跨平台项目里这是真实的分歧源。正解不是各自设 autocrlf，而是提交一份 `.gitattributes` 显式声明行尾（`* text=auto eol=lf`），让仓库自己决定——这和[环境变量与配置管理](/frontend-engineering/env-and-config)是同一类问题：配置要在仓库里说清楚。

## 离线传历史：format-patch、am、bundle

`git format-patch -1 HEAD -o /tmp/pt` 把提交导出成邮件形式的补丁（中文标题会被 MIME 编码，实测 `Subject: [PATCH] =?UTF-8?q?=E5=8F=91=E5=B8=83=E5=90=8E...`），收件方用 `git am 0001-xxx.patch` 还原成带原作者与原始提交信息的提交。实测两个坑：`git am` 在还没有任何提交的空仓库里直接失败（`fatal: your current branch 'master' does not have any commits yet`），得先有基线；打不上时留下 `.git/rebase-apply` 目录和 `--abort` / `--resolve` / `--skip` 三条出路。`git bundle` 把一段历史压成单个文件（`git bundle create /tmp/all.bundle --all` → `git bundle verify` 报 `is okay`，子命令是 `verify`，`bundle list` 不存在 → `git clone /tmp/all.bundle 目标目录` 得到完整历史），用于给不能联网的机器送可追溯的代码；致命约束是**必须有完整祖先链**。

## 常见错误与排查

**1. `git commit` 报 nothing to commit，文件明明改过。** 原因：改动被 ignore 命中，或你改的是另一份副本（Windows 上大小写路径是同一目录，`git ls-files` 里的大小写却可能不同）。确认：`git status --ignored -s`、`git check-ignore -v 路径`、`git rev-parse --show-toplevel`。修法：路径写对，或按上文 `git rm --cached` + ignore 的顺序处理。

**2. 每次 add 都刷 LF→CRLF 警告，diff 里整个文件都像被改了。** 原因：本机 system 级 `core.autocrlf=true`（实测），仓库里另一台机器提交的是 LF。确认：`git diff --stat` 行数等于文件总行数、`git ls-files --eol` 看 `i/lf w/crlf`。修法：提交 `.gitattributes`（`* text=auto eol=lf`）后 `git add --renormalize .` 一次归一。

**3. 切分支后「我的新文件不见了」。** 原因一：它是未跟踪的，会跟着你穿过所有分支，你以为它被提交了。原因二：你在 detached HEAD 下提交（实测 `* (HEAD detached from 913711b)`），切回分支后没有指针指向它。确认：`git reflog --date=iso | head`。修法：`git branch 名字 HEAD@{n}`，或 `git cherry-pick HEAD@{n}`（要求磁盘上没有同名未跟踪文件，见上文实测）。

**4. 把密钥或大文件提交了，已经 ignore + `git rm --cached`，同事拉下来还能翻到。** 原因：历史里的对象还在，ignore 只管未来的未跟踪候选。确认：`git log --all --oneline -- 路径`。修法见下一章——**先轮换密钥，历史改写只是止血**。

**5. `git pull` 之后多了一个自己没写过的合并提交，或卡在编辑器里出不来。** 原因：本机 `pull.rebase=false` + `core.editor=notepad`（都是 system 配置，实测），而 `pull` 的本质是 fetch + merge，分叉时必然产生合并提交。确认：`git config --get pull.rebase`、`git log --graph --oneline -5`。修法：个人分支显式 `git pull --rebase`，或分两步 `git fetch` + `git merge`（下一章实测三种写法的结果差异）。

## 练习

<Exercise title="练习 1 · 证明 Git 存的是快照而不是差异" difficulty="基础">

临时仓库里提交一个 10 行文件，只改第 10 行再提交一次。用命令回答：① 第二笔提交里这个文件对应几个 blob？② 两版 blob 哈希相同吗？③ objects 总数是随提交线性增长还是有复用？写出验证命令与输出。

<template #answer>

```bash
git rev-parse HEAD:a.txt HEAD~1:a.txt          # 两个不同哈希（内容不同 ⇒ 对象不同）
git cat-file -s HEAD:a.txt                     # 是完整文件字节数，不是差量
git count-objects -v                            # 未改动文件的 blob 在多个 tree 里复用
git ls-files -s                                 # 清单里只有哈希，没有任何 diff 信息
```

结论：① 一个路径在一笔提交里只对应**一个** blob，但它与上一版是**两个对象**。② 不同。③ 没改过的文件不产生新对象，增长只来自「真变过的文件 + 每层新 tree + 每笔新 commit」。这就是 `git checkout` 老版本快得离谱的原因——它不重算差量，只按清单把对应对象写回磁盘。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造一次 reset --hard 事故并自救" difficulty="挑战">

演示仓库里提交两笔，再建一个未跟踪文件，然后 `git reset --hard HEAD~1`。用 `git reflog` 把提交捞回来，并说明磁盘上哪个文件消失了、哪个没消失。最后回答：丢的是「改了但从未提交」的内容，还有救吗？

<template #answer>

本章实测现场：`extra.txt`（被丢弃提交里新增、已跟踪）从磁盘消失；`keepme.txt`（未跟踪）留在磁盘；`only.txt` 退回上一版（实测读到 `v1`）。自救：

```bash
git reflog                                   # 找 reset 之前那行
git branch rescue HEAD@{1}
git restore --source=rescue --staged --worktree extra.txt
```

未提交的改动 Git 不记账，`reflog` 里没有它，**答案是没救**。唯一的前置保护是编辑器本地历史、`git stash`（实测 `stash@{0}` 是 commit 对象，pop 后仍能从输出里拿到 SHA）或 IDE 的 shelf。这也是「随手提交、之后再整理」比「攒一天再提交」安全的理由。再记一条：删未跟踪文件的是 `git clean -fd`，它连 reflog 都不留，务必先 `-nd`。

</template>

</Exercise>

<Exercise title="练习 4 · 让一条 .gitignore 规则真正生效" difficulty="基础">

`.env` 早就被提交进仓库，你补了 `.gitignore` 却发现 `git status` 照样报它。① 用一条命令证明规则本身能不能匹配（提示：默认行为会让你误判）；② 解释为什么规则「看起来不生效」；③ 给出保留磁盘文件、又让规则生效的操作顺序，并写出每一步之后 `git status` 与 `git ls-files` 的结果。

<template #answer>

① `git check-ignore -v .env` 无输出、退出码 1——文件仍被跟踪时 `check-ignore` 会跳过它；加 `--no-index` 才问规则本身：`git check-ignore --no-index -v .env` → `.gitignore:2:.env	.env`。② 忽略只作用于**未跟踪**候选集：实测提交 `conf.ini` 后追加规则、再改它，`git status` 仍报 ` M conf.ini`、`git add` 照样收。③ 顺序：`git rm --cached .env`（状态变 `D  .env`，磁盘文件仍在）→ `git commit -m "chore: 停止跟踪 .env"` → 之后 `git ls-files` 里 0 条、`git status` 干净且不显示为未跟踪。**少提交那一步规则就仍未生效**；若 `.env` 里是真密钥，先轮换再清理，历史里的副本见下一章。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Pro Git 中文版 · Git 基础](https://git-scm.com/book/zh/v2) —— 核实「快照而非差量」「三类对象」「分支只是一个 movable 指针」这三个心智模型；本章 `cat-file -p` 与 `.git/refs/heads/feat-x` 的实测输出可与书里那两张图逐行对照。
- [git-config 手册](https://git-scm.com/docs/git-config) —— 核实 `merge.conflictStyle`（diff3/zdiff3）、`pull.rebase`、`init.defaultBranch`、`core.autocrlf` 各键取值。**默认值受发行版安装器影响**：本章的 `master` / `autocrlf=true` / `pull.rebase=false` 是本机 system 配置的实测结果，动手前用 `git config --list --show-origin` 核对你的机器。
- [gitignore 手册](https://git-scm.com/docs/gitignore) —— 核实规则语法、「取反不能救回被整体忽略的目录内容」这条限制，以及忽略只作用于未跟踪文件。
- [git-switch / git-restore 手册](https://git-scm.com/docs/git-switch) —— 核实 2.23 拆分 `checkout` 的职责划分（本机 2.52 两命令实测可用）。
- [git-reset 手册](https://git-scm.com/docs/git-reset) —— 核实 `--soft` / `--mixed` / `--hard` 各作用于哪一区；本章三张实测 `git status -s` 输出就是它那张表。
- [语义化版本 SemVer 中文](https://semver.org/lang/zh-CN/) —— 核实 tag 与 MAJOR/MINOR/PATCH 的对应关系。

## 下一章

本章把 Git 讲成「指针 + 快照」：分支是一个装着哈希的文本文件（实测）、撤销要分清动的是工作区、暂存区还是历史（实测 `--hard` 会删掉磁盘文件）、`reflog` 是几乎所有指针误动的后悔药。但这些结论都建立在一个假设上：仓库只有你一个人。一旦有人往同一分支推东西，`origin/main` 这个引用是怎么来的、`git pull` 为什么会在你历史里塞进一个你没写的合并提交、变基后强推会把同事的工作变成什么形状（本章已预演过一次：`rebase` 让所有 SHA 改变），下一章用同一台机器上的两个克隆把这三件事全跑出来，并映射到 GitHub 的 fork / Pull Request / 保护分支上 → [Git 协作与 GitHub](/devops/git-collaboration)。往回看，「改坏了」这个判断本身要靠测试给出，见[测试体系](/devops/testing)。
