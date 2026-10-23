# 远端只是另一个仓库：把 push、pull 和 PR 还原成引用的移动

你在本地把三笔半成品压成一笔干净的，`git push -f`，成功。同事十分钟后 `git pull`，历史里冒出两个「同一个改动的不同版本」，接下来两小时他都在处理自己根本没写过的冲突。你打开自己电脑上的图，历史漂亮得像论文插图；他那边多了一个他解释不了的合并提交。**同一个仓库，两个形状**——这就是本章要拆开的东西。

Git 没有「中央服务器」这个概念：你电脑上的仓库和 GitHub 上的仓库是同一种东西，区别只在于那个仓库没有工作区、专门接收别人的引用。所有协作命令只做两件事：**把对象传过去/传过来**，以及**请求对方把某个引用挪到某个提交上**。`push` 是一次带条件的引用更新请求，`pull` 是 `fetch` 加一次集成，Pull Request 则把「请把我的分支合进 main」变成一个有讨论、有状态检查、有权限控制的网页对象。想通这层，「为什么我的 push 被拒」「为什么强推会伤人」是同一句话的不同写法。

本章实验全在一台机器上完成：`git init --bare` 建本地裸仓库当「服务器」，同一仓库克隆两份当两个同事，于是远端、非快进、强推、共享分支变基全都跑得出来。**GitHub 网站上的操作（PR 审查、CODEOWNERS、保护分支、Actions、Release）本机没有账号与网络，一律标「未在本机验证」并给操作路径**；浅克隆与部分克隆在本机的局限见「大仓库」。

<Callout type="verified" title="本章实测环境">

Git `2.52.0.windows.1`，Windows 10 x64，Git Bash，2026-10-18。「服务器」是 `git init --bare` 的本地裸仓库，「同事」是它的两个克隆。本章 `text` 输出（含 `(fetch first)`、`(stale info)`、`(forced update)`、`Merge made by the 'ort' strategy.`、`[ahead 1, behind 1]`、`[origin/topic: gone]`）都是真实返回值。另确认本机装有 `git-lfs/3.7.1`，而 `git filter-repo` **未安装**，相关段落只讲机制不报结果。

</Callout>

## 远端只是一个带名字的 URL

`git remote` 不是「连接」，是 `.git/config` 里的一段文本。建远端并推一次，然后直接读那个文件：

```bash
git remote add origin ../remote.git
git push -u origin main
cat .git/config
```

```text
[remote "origin"]
	url = ../remote.git
	fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
	remote = origin
	merge = refs/heads/main
```

三段各决定一件事：

| 配置 | 作用 | 影响哪条命令 |
| --- | --- | --- |
| `url` | 传输地址（本地路径、HTTPS、SSH 都合法） | 所有读写 |
| `fetch = +refs/heads/*:refs/remotes/origin/*` | 引用映射：远端每个分支 → 本地一个「远端跟踪分支」；开头 `+` 允许非快进更新这个映射 | `fetch` / `pull` |
| `[branch "main"] remote/merge` | 这条**本地分支**的上游是谁 | 无参数的 `pull`、`push`、`git status -sb`、`@{u}` |

`origin` 这名字毫无魔法，只是约定，实测 `git remote rename origin upstream` 之后 `git remote -v` 与 `.git/config` 同步更新。**开源项目里的双远端就靠这个**：`origin` 是你的 fork，`upstream` 是原仓库。裸仓库（`git init --bare`）没有工作区，`.git` 内容直接摊在顶层（实测 `HEAD config description hooks info objects refs`），也就是说 GitHub 上的仓库就是「一堆对象 + 一组引用」。这里藏着第一个坑：裸仓库 `HEAD` 默认指向 `refs/heads/master`，而你推的是 `main`，于是每个新克隆都报

```text
warning: remote HEAD refers to nonexistent ref, unable to checkout
```

自建裸仓库补一句 `git symbolic-ref HEAD refs/heads/main`（实测有效），GitHub 上则在 Settings → Branches 设默认分支。不想克隆就想看远端有什么引用，用 `git ls-remote`（实测输出 `<完整哈希>\theads/main` 这类行），它也常用来判断 tag 到底推没推上去。

## fetch、pull、push：谁动了哪一区

这是上一章「三个区」的远端版。**`fetch` 只更新 `refs/remotes/origin/*`，不碰你的分支，也不碰你的文件。**

```bash
git status -sb        # ## main...origin/main
git fetch origin      # 另一边刚推过一个提交
git status -sb        # ## main...origin/main [behind 1]
test -f a.txt         # 工作区文件：未变
```

`a.txt` 是对方提交里新增的文件，fetch 之后**不在磁盘上**——对象已下载到 `objects`，但没有引用把它变成现实。这正是 `fetch` 的安全性质：你可以 fetch、审 `git log main..origin/main`、看 `git diff main origin/main`，不满意就不动。

`pull` 是 fetch 之后立刻集成，本机默认 `merge`（system 配置 `pull.rebase=false`）。两边分叉时的真实后果：

```text
Merge made by the 'ort' strategy.
*   1c05923 Merge branch 'main' of D:/work/learns/devops/.scratch/remote
|\
| * eb5e0a2 feat: work1 功能
* | e1866ef feat: work2 功能
|/
* 8f3977a feat: 初始化
```

`git cat-file -p HEAD | grep -c parent` 返回 **2**，确认是真正的合并提交。**`git pull` 的隐患不是「会冲突」，而是它在你还没看清远端做了什么的时候就自动提交了一次合并**：你不知道自己有没有分叉、要不要分叉，历史上就多了一个「没有内容的合并」（`ort` 是 Git 2.34 起的默认合并策略名）。显式两步走（`fetch` + `merge`）永远更稳；让集成变成线性的，实测：

```bash
git pull --rebase
* 0499296 feat: 本地 A
* 125bcc5 feat: 远端 Z
* 672f852 chore: 基线      # 无合并提交，parent 数 = 1
```

**代价要讲清楚：`--rebase` 会重写你那几笔提交的 SHA**（parent 变了）。它只重写「你本地的、还没推给别人」的提交，所以个人分支上安全；全局打开 `pull.rebase=true` 之前，先确认你不会在共享分支上 `pull`。

`push` 反过来：传对象，然后**请求**把远端某引用挪到你的提交上。四条实测事实：

```text
$ git push origin main        # 远端有你没拉的提交
 ! [rejected]        main -> main (fetch first)
 hint: Updates were rejected because the remote contains work that you do not
 hint: have locally. ... use 'git pull' before pushing again.
```

- **非快进默认被拒**：Git 只接受「远端引用当前指向的提交是你提交链上的祖先」。这是它保护你不删别人历史的唯一手段。
- **push 不带 tag**：实测打完 `v0.2.0` 后 `git push origin main` 远端拿不到，要 `git push origin v0.2.0` 或 `--tags`。CI 靠 tag 触发发布时，忘推 tag 是最常见的「流水线没跑」原因。
- **无 refspec 时推哪个分支由 `push.default` 决定**，[官方文档](https://git-scm.com/docs/git-push)明确默认是 `simple`（当前分支 → 远端同名分支）；本机 `git config --get push.default` 无输出 = 用内置默认。老配置里的 `matching`（推所有同名分支）在脚本化环境要确认掉。
- **分离头指针下无 refspec 会被拒**，实测提示里给了 `HEAD:refs/heads/HEAD` 这种建议写法——看到它就该明白：先建分支再推。另外实测 `git push origin HEAD:refs/heads/topic` 能在远端建 `topic`、本地也有 `origin/topic`，但 `git branch --list topic` 返回 0 行：本地没有对应分支。

## 上游跟踪关系：ahead / behind 从哪来

`git push -u`（全称 `--set-upstream`）写的就是 `[branch "main"]` 那一段。有了它，三条命令才能不带参数：`git status -sb` 报 `[behind 1]`、`git pull` 知道拉哪、`git log @{u}..` 知道比谁。`origin/main` 这类**远端跟踪分支**是 fetch refspec 的产物，它是「我上次从远端看到的样子」，不是「远端现在样子」——这一条解释了一大半「为什么 push 被拒」：**你的 `origin/main` 落后，就等于你对世界的认知落后**。

三种状态实测（同一仓库、两个克隆、两个远端）：

```text
  main  e890129 [upstream/main: ahead 1] feat: 新分支内容
* topic e890129 [origin/topic] feat: 新分支内容
  topic e890129 [origin/topic: gone] feat: 新分支内容
```

`ahead 1` 是你有一笔远端没有的提交（快进推得上），无标记是完全同步，`[ahead 1, behind 1]` 是分叉（普通 push 必被拒，实测出现过）。**`gone` 表示上游引用在本地已不存在**——通常是别人在远端删了这个分支（合并后删除），你 `fetch -p` 后本地镜像跟着清了；看到这个标记基本意味着 PR 已经合掉，别抢救旧分支，`git switch main` 重新开一条。别手工编辑 `.git/refs/remotes/*`（那是缓存），刷新认知用 `git fetch`，清远端已删分支用 `git fetch --prune`（实测之后 `git branch -r` 少了那条），长期建议 `git config --global fetch.prune true`。

## 强推的三种写法，实测三种结果

场景：`lw_a`、`lw_b` 是同一仓库两个克隆。`lw_a` 推了 `af45f27 lwA 第一笔`；`lw_b` 从没 fetch 过，改写了自己的提交要推。

| 命令 | 实测输出 | 后果 |
| --- | --- | --- |
| `git push origin main` | `! [rejected] main -> main (fetch first)` | 安全拒绝：远端有你没见过的提交 |
| `git push --force-with-lease origin main` | `! [rejected] main -> main (stale info)` | **也拒绝**：你本地的 `origin/main` 与实际远端不一致，说明「你看不到的世界已经变了」 |
| `git push --force origin main` | `+ af45f27...6a1d907 main -> main (forced update)` | **成功**：`lwA 第一笔` 从 `main` 上消失 |

`lw_a` 那边 fetch 之后立刻 `## main...origin/main [ahead 1, behind 1]`——同事的提交「凭空蒸发」，他还得花时间搞明白自己刚推的东西去哪了。这就是 `-f` 的真实语义：**「按我说的挪，我不在乎你现在的状态」**。`--force-with-lease` 把它改成「**只在远端仍停在我上次看到的位置时才挪**」（租约）。[git-push 手册](https://git-scm.com/docs/git-push)的三种取值与本机行为一致：不带参数时对所有被更新的引用设租约，依据是**本地对应的远端跟踪分支**；`=<refname>` 只对一个引用；`=<refname>:<expect>` 用你显式给的值当预期。

所以它的成立条件是「你最近 fetch 过」：实测 `lw_b` 先 `git fetch` 再推就成功了（`+ 30c28a0...aa57971 main -> main (forced update)`）——**它只保证不删你没看见的东西，不保证你的改写对别人无害**。规矩：只在**自己的、没人基于它工作**的分支上强推，强推前打招呼（至少 PR 评论里说），一律用 `--force-with-lease` 而不是 `-f`；想永久避免靠服务器侧（`receive.denyNonFastForwards` 自建，或 GitHub 保护分支，**未在本机验证**）。中间态选项 `--force-if-includes` **本机未逐项实测**，用前查 `git push --help`。

## fork + PR：两条路径

| 场景 | 远端布局 | 日常循环 |
| --- | --- | --- |
| 个人项目 / 团队内部仓库（有写权限） | 一个 `origin` | 开分支 → `git push -u origin feat/x` → 开 PR → 合并 → `git fetch -p` → 删本地分支 |
| 开源贡献 / 跨团队（无写权限） | `origin` = 你的 fork，`upstream` = 原仓库 | 从 `upstream/main` 开分支 → 推 `origin` → 向 `upstream` 开 PR → 同步靠 `git fetch upstream && git rebase upstream/main` |

fork 路径的入口在 GitHub 网页（右上角 Fork），命令行侧依次是 `git clone 你的fork`（这就是 origin）→ `git remote add upstream 原仓库 && git fetch upstream` → `git switch -c fix/typo upstream/main`（**从上游主线开分支，别从自己的 main 开**）→ `git push -u origin fix/typo`。

**别从自己的 `main` 开分支**：它迟早落后于 upstream，落后之后每次同步都要多处理一次合并；从 `upstream/main` 开分支，PR 的 diff 天生干净。两条路径的差别只有一句：**PR 是「请谁改谁的引用」**——内部流程请 maintainer 改 `origin/main`，fork 流程请上游 maintainer 改 `upstream/main`。审查侧路径（**未在本机验证**）：仓库页 → Pull requests → New pull request → 选 base 与 compare → Create；Files changed → Review changes → Comment / Approve / Request changes。

## 分支策略：三个选项各自的赢面

- **主干开发**：一条 `main`，分支活几小时，发布也从 main 打 tag。适合小团队、有 CI 与特性开关、能高频部署；代价是未完成功能必须藏在开关后面。
- **Git Flow**：`main` / `develop` / `release/*` / `hotfix/*`。适合版本要长期并行维护、发布节奏由外部决定；代价是引用爆炸、合并链条长、`develop` 与 `main` 迟早漂移。
- **短生命周期特性分支 + PR**：一条受保护 `main` + 活 1–3 天的分支。绝大多数 Web 项目走这条（本站就是），代价是要求 PR 真能当天合掉。

结论直给：**独立开发者与小型 Web 项目选第三种，别为了「看起来专业」上 Git Flow**。前两种优化的是不同东西（trunk-based 优化集成频率，Git Flow 优化多版本并行维护），没有对错；真正让历史变脏的是**活得比它该长更久的分支**：分支越久，`main` 走得越远，代价以冲突和「一个改动散在 40 个提交里」的形式付。

## 在共享分支上变基：两个克隆实测事故全过程

`rb_a`、`rb_b` 是同一远端的两个克隆。第一步，`rb_a` 推两笔，`rb_b` 拉下来基于它们继续工作：

```text
3ca54d0 feat: rb_b 的新功能（基于那两笔）
3c4ca50 chore: p.txt 补第二行
d534e64 chore: 加 p.txt
```

第二步，`rb_a` 觉得那两笔太碎，用 `rebase -i` 压成一笔并强推（`GIT_SEQUENCE_EDITOR` 让待办清单可脚本化）：

```bash
GIT_SEQUENCE_EDITOR="sed -i '2s/^pick/fixup/'" git rebase -i --autosquash HEAD~2
# Rebasing (2/2)  Successfully rebased and updated refs/heads/main.
git push --force-with-lease origin main     # 成功：rb_a 刚 fetch 过，租约是干净的
```

`d534e64` 与 `3c4ca50` 都消失，`main` 上现在是 `a6b8eaf`。第三步，`rb_b` 毫不知情地推新功能 → `! [rejected] main -> main (fetch first)`（第一道保护生效）。第四步，`rb_b` 按提示 `git pull`：

```text
*   21be1df Merge branch 'main' of D:/work/learns/devops/.scratch/remote
|\
| * a6b8eaf chore: 加 p.txt
* | 3ca54d0 feat: rb_b 的新功能（基于那两笔）
* | 3c4ca50 chore: p.txt 补第二行
* | d534e64 chore: 加 p.txt
|/
* aa57971 fcB 改写后的提交
```

**同一份工作出现两份**：`3c4ca50`（旧）与 `a6b8eaf`（重写后）同时在 `main` 上，合并提交把被抹掉的历史复活了，此后所有人拉到的历史永久包含这个双份结构。这就是「不要在别人已拉取的分支上变基」的完整证据链——不是风格问题，是真会坏仓库。补救按优先级：`rb_b` 改用 `git rebase origin/main`（把自己的 `3ca54d0` 重放到 `a6b8eaf` 上，旧两笔被丢弃、图变线性）；或 `git fetch && git reset --hard origin/main` 再手工取回改动（**前提：那笔还在自己 reflog 里**）。事后判断有没有重复内容：`git log --cherry-pick --right-only main...origin/main`——Git 认得出「内容相同但 SHA 不同」。

## 整理提交：rebase -i 的动作表与 cherry-pick

`git rebase -i 起点` 打开的是**待办清单**，每行一个动作：

| 动作 | 效果 | 什么时候用 |
| --- | --- | --- |
| `pick` | 原样保留 | 默认 |
| `reword` | 保留内容、只改信息 | 写得像「fix bug」的提交 |
| `edit` | 停在这笔，改完 `git rebase --continue` | 拆分一笔提交、补漏掉的测试 |
| `squash`（`s`） | 与前一笔合并，**提交信息合并编辑** | 前一笔是同一件事的延续 |
| `fixup`（`f`） | 与前一笔合并，**丢弃本笔信息** | 「补一个分号」这类修补 |
| `drop` | 丢掉这笔 | 误提交、被后续推翻 |

实测 `fixup` 把两笔变成一笔（就是上面的 `a6b8eaf`）；配 `--autosquash`，`git commit --fixup=abc1234` 生成的提交会自动排到清单正确位置——这是「修 PR 的 review 意见」最省事的姿势。实测 `edit` 停下来的位置是 `## HEAD (no branch)`：**变基过程中你一直在分离头指针状态**，改完 `--amend` 再 `--continue` 才回到分支上；中途想退出永远用 `git rebase --abort`。

**cherry-pick** 把某笔提交单独复制到当前分支。实测 `git cherry-pick origin/main` 造出 `260f655 lwB 改写后`（作者信息一致，committer 变成你，SHA 不同）；冲突时留下 `.git/CHERRY_PICK_HEAD`（实测该文件存在），出路是 `--continue` / `--skip` / `--abort`。它只该用在一个场景：**把某笔已存在的提交搬到一条按定义就该独立承载它的分支**——典型是把 `main` 上的修复搬到 `release/1.2`（backport）。滥用长这样：为了让 PR 看起来干净，把别人分支上的一串提交逐个 cherry-pick 过来；后果就是上一节那种双份历史。真要搬一整段历史，用 merge 或 rebase。

## 读历史、解冲突的工具

```bash
git log --graph --oneline --decorate --all -n 12
git log --oneline --grep='^feat'   # 实测返回 3 笔
```

`--all` / `--remotes` / `--tags` 决定取材范围：**只看 `main` 与看全仓库，得到的图完全不同**，排查「这笔提交在哪个引用上」必须加 `--all`；`--follow` 跟着改名回溯。`git blame --line-porcelain b.txt` 实测输出含 `author Learner`，但 **blame 报的是「最后触碰这一行的提交」，不是「写出这个逻辑的人」**：格式化、变基、cherry-pick 都会污染它，加 `-w`、`-M -C`，并把纯格式化提交列进 `.git-blame-ignore-revs`。

`git mergetool` 要外部工具，实测 `git mergetool --tool-help` 在本机只列出 `vimdiff`（及 `vimdiff1/2/3`）——**Git for Windows 默认不带图形化工具**，装 VS Code/Meld 后配 `[merge] tool = vscode` 与 `cmd = code --wait $MERGED`。不配也能活：`git diff --name-only --diff-filter=U` 列清单加三段式标记，比多数图形化流程更快，工具不替你判断语义。`git rerere` 把解过的冲突记进 `.git/rr-cache` 自动套用，实测开启是 `git config rerere.enabled true`，**目录要等第一次真正解决冲突才创建**。

## GitHub 侧：审查、规则与自动化

以下全部**未在本机验证**（需要 GitHub 账号与真实仓库），只给机制与路径。

| 机制 | 解决什么 | 配置路径 |
| --- | --- | --- |
| Review、`Changes requested` 与 required reviews | 让「合并」需要一个明确同意动作，并决定「几个人同意」「谁必须同意」；request changes 阻止合并 | PR → Files changed → Review changes；Settings → Branches → Require a pull request before merging → Require approvals / Require review from Code Owners |
| `CODEOWNERS` | 把目录归属写进仓库，PR 自动 @ 对应人 | 仓库根或 `.github/` 下，每行 `模式 @团队/个人`，路径以仓库根为基准 |
| 状态检查与保护分支 | 「CI 绿了才许合」，并在服务器侧拦住 `--force`，避免本章那种事故 | Require status checks to pass；Do not allow force pushes；Require branches to be up to date before merging |
| Issue 与分支关联 | 让「为什么改」和「改了什么」绑定 | 分支名或提交里写 `#123`；`Fixes #123` 关闭 issue，`Refs #123` 只关联 |
| Release 与 tag | 把已发布的不可变快照给人看、附产物 | `git tag -a v1.2.0` 推上去 → Releases → Draft new release → 选该 tag |
| Actions 触发 | `push`（分支/tag/路径过滤）、`pull_request`、`workflow_dispatch`、`release` | 细节在[第 5 章](/devops/ci-cd)；`gh pr create` / `gh pr checks` 可在终端做同类操作，**本机未安装** |

**合并按钮的三种结果形状完全不同**（这条决定你的仓库好不好读）：

| 按钮 | 历史形状 | parent 数 | 副作用 |
| --- | --- | --- | --- |
| Create a merge commit | 保留分支结构，多一个合并提交；分支每笔提交都进主线 | 2 | 看得出「何时集成了哪个 PR」；主线出现分叉 |
| Squash and merge | **一条线性提交**，整段分支压成一个 | 1 | 回滚一步到位、日志干净；中间过程追溯丢失；原分支提交以另一个 SHA 存在 |
| Rebase and merge | 逐个重放，线性，**不加分支记录** | 每笔 1 | **SHA 全部改变**；看不出集成点；同一分支别处也合过就是双份历史 |

我的选择直给：**内部功能开发用 Squash and merge**（一个 PR = 一个可回滚的完整变更，配合下一章的约定式提交信息正好是 changelog 的一行）；**长期存在的发布分支、跨团队集成用 merge commit**（要保留谁在什么时候集成了什么）；`Rebase and merge` 只在「分支上每笔都独立有意义且都想留下」时用，实践里少见。

## 大仓库：sparse-checkout 实测，浅克隆本机测不了

`git sparse-checkout` 只检出你关心的目录。实测在 monorepo 骨架（`packages/alpha`、`packages/beta`、`docs`、`src`）里：

```bash
git sparse-checkout init --cone
git sparse-checkout set packages/alpha src
ls            # packages  src        ← docs 与 packages/beta 不在工作区
```

`git status -sb` 正常，`git sparse-checkout disable` 后全部回磁盘（实测）。**关键认识：稀疏检出只影响工作区，对象仍要全部下载**，所以它救的是「IDE 索引、构建、磁盘 IO」，不救「clone 慢」；cone 模式只能按目录给。

浅克隆与部分克隆**在本机测不出真实效果**：对本地路径的 clone 走本地优化并忽略这两个选项，实测原文：

```text
warning: --depth is ignored in local clones; use file:// instead.
warning: filtering not recognized by server, ignoring
```

（用 `file://` 试 `--filter=blob:none`：`remote.origin.promisor=true` 写进了配置，但历史仍是完整的 7 笔——本机这个「服务器」不支持过滤协议。）预期行为（**未在本机验证**，以 [gitclone 手册](https://git-scm.com/docs/git-clone) 为准）：`--depth 1` 只拿最新一笔、`.git/shallow` 记边界，补全用 `git fetch --unshallow`（实测对完整仓库执行报 `fatal: --unshallow on a complete repository does not make sense`）；`--filter=blob:none` 提交与树完整、blob 按需下载。大文件用 LFS（本机装有 `git-lfs/3.7.1`，推送与拉取要真实远端，**未验证**）：文件被换成文本指针，clone 后要 `git lfs pull`。

## 误提交密钥：历史里删不干净，轮换才是正解

先把两件事分开：**删历史能删掉对象，但删不掉「已被复制走的东西」**——密钥一旦推出去就等于已泄露（CI 缓存过、别人的 fork 里有、备份里有），`git log --all --oneline -- .env` 与 `git cat-file -p 提交:.env` 能证明它进过历史。所以**唯一正确的第一动作是轮换（revoke + 重新签发），不是清理仓库**。

清理顺序（**平台侧步骤未在本机验证**）：

```bash
# 1) 让密钥立刻失效并签发新的（这一步不在 Git 里）
# 2) 改写历史：官方推荐 git-filter-repo（Git for Windows 不自带）
git filter-repo --path .env --invert-paths     # 从所有提交移除该路径
# 3) 强推 + 请求平台清理旧对象
git push origin --all --force && git push origin --tags --force
```

`git filter-repo` 本机**未安装**（实测 `git filter-repo --version` 无输出），命令以 [git-filter-repo 文档](https://github.com/newren/git-filter-repo) 为准；**别再用 `filter-branch`**（已弃用）。改写后旧对象并不会立刻消失：GitHub 要联系客服做 GC，fork 与别人本地的副本仍带着旧提交——**这就是「轮换才是正解」的技术理由**。预防：`.gitignore`（只挡未跟踪文件，不是安全机制）、`pre-commit` 扫密钥（下一章）、真实值放 CI Secrets 与不跟踪的 `.env.local`（与[环境变量与配置管理](/frontend-engineering/env-and-config)一致）、组织级 secret scanning + push protection（**未验证**）。

## 常见错误与排查

**1. `git push` 报 `(fetch first)`，你以为再试一次就好。** 原因：非快进被规则拒绝（实测原文）。确认：`git status -sb` 出现 `behind` 或 `[ahead 1, behind 1]`。修法：`git fetch` 后自己判断要 merge 还是 rebase，别用 `-f` 绕过。

**2. 用 `-f` 之后同事的提交消失了。** 原因：强推覆盖远端引用（实测 `lwA 第一笔` 掉出 `main`，`lw_a` 变 `[ahead 1, behind 1]`）。确认：`git ls-remote origin main` 与预期不一致。修法：让同事 `git fetch`，从他的 reflog 找回（`git branch rescue HEAD@{n}`），再 `git rebase origin/main` 重新集成；长期靠 `--force-with-lease` + 保护分支。

**3. 变基之后 CI 全红，本地测试却通过。** 原因：重放时逐个套用改动，中间冲突解决（`rerere` 会自动套用！）可能语义错误；也可能你 rebase 的基线是过期的 `origin/main`。确认：`git log --oneline @{u}..` 看被重放的是哪几笔；`git diff HEAD@{1} HEAD` 对比变基前后**内容**是否等价（这一步最值钱：变基不该改内容，diff 应为空）。修法：把等价检查作为变基后固定动作；失败时 `git reflog` 回变基前重来。

## 练习

<Exercise title="练习 1 · 用本地裸仓库复现 fetch 与 pull 的差别" difficulty="基础">

建裸仓库当远端，克隆两份，两份各推一次形成分叉。分别执行 `git fetch` 与 `git pull`，用命令证明：① fetch 之后什么变了、什么没变；② pull 产生的合并提交有几个 parent；③ 换成 `git pull --rebase` 形状怎么变。

<template #answer>

```bash
git status -sb                            # fetch 后：## main...origin/main [behind 1]
test -f 对方新增的文件                      # 未变：fetch 不写工作区
git rev-list --count main..origin/main     # 1
git cat-file -p HEAD | grep -c parent      # pull(merge) → 2；pull --rebase → 1
```

结论：`fetch` 只让 `refs/remotes/origin/*` 前进，`pull` 才做集成；本机默认 merge（`pull.rebase=false`）留 2-parent 提交，`--rebase` 变线性但改 SHA。裸仓库要 `git symbolic-ref HEAD refs/heads/main`，否则克隆报 `remote HEAD refers to nonexistent ref`。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造一次强推事故并把同事救回来" difficulty="挑战">

两个克隆：`A` 推一笔，`B` 在未 fetch 的情况下改写自己那笔然后 `git push -f`。要求：① 贴出 `-f` 与 `--force-with-lease` 各自的真实输出行；② 证明 `A` 的提交从远端消失；③ 站在 `A` 的角度找回自己的提交并重新集成到新的远端历史上，且**不产生双份提交**。

<template #answer>

① 本章实测原文：`-f` → `+ af45f27...6a1d907 main -> main (forced update)`；`--force-with-lease` → `! [rejected]        main -> main (stale info)`。② 证明：远端 `git log --oneline main` 里已无那笔；`A` fetch 后 `git status -sb` 报 `## main...origin/main [ahead 1, behind 1]`。③ `A` 的救援：

```bash
git fetch
git rebase origin/main            # 把自己的提交重放到改写后的主线之上
git push origin main              # 快进，成功
git log --cherry-pick --right-only HEAD...origin/main   # 应为空
```

关键是**顺序**：先 fetch 再用 `rebase` 集成，绝不用 `git pull`——merge 会把远端刚消失的旧提交复活（本章实测产生过双份历史）。

</template>

</Exercise>

<Exercise title="练习 3 · 把一串 WIP 提交整理成两个可评审的提交" difficulty="进阶">

功能分支上有四笔：`feat: 加接口`、`fix`、`fix again`、`chore: 删调试日志`。用 `rebase -i` 整理成两笔（第一笔实现、第二笔清理），修补类用 `fixup`、需要改信息的用 `reword`。写出可脚本化的命令，并说明**在什么前提下整理完可以安全强推**。

<template #answer>

```bash
git log --oneline -4                     # 记下当前 SHA，事后 diff 用
GIT_SEQUENCE_EDITOR="sed -i '3s/^pick/fixup/;4s/^pick/fixup/'" git rebase -i HEAD~4
git diff HEAD@{1} HEAD                   # 变基前后内容必须等价（空 diff）
git push --force-with-lease origin 分支名
```

本章实测过 `GIT_SEQUENCE_EDITOR` 这条路子（`sed -i '2s/^pick/fixup/'` 确实把两笔压成一笔），脚本化完全可行。安全强推的三个前提：**① 这条分支只有你在用**（或团队已约定整理窗口并通知）；**② 没人基于这些提交继续工作**——本章事故案例正是违反这条；**③ 不是在共享分支上变基后强推**（那应该走 PR）。硬习惯：`--force-with-lease` + 整理完必做等价 diff 检查 + 保护分支允许在 `feature/*` 强推但不允许在 `main` 强推。

</template>

</Exercise>

## 官方文档与延伸阅读

- [git-push 手册](https://git-scm.com/docs/git-push) —— 核实 `--force` / `--force-with-lease` 的租约语义（依据本地远端跟踪分支、`<refname>:<expect>` 形式）、非快进规则、`push.default` 默认 `simple`。本章三种推法的实测输出与之逐条对齐。
- [git-fetch 手册](https://git-scm.com/docs/git-fetch) —— 核实 refspec 语法（`+refs/heads/*:refs/remotes/origin/*` 的含义）与 `--prune` / `remote.<name>.prune`。
- [git-pull 手册](https://git-scm.com/docs/git-pull) —— 核实 `pull` = `fetch` + `merge`/`rebase`、`--ff-only`、`pull.rebase` 取值，以及官方「不要在公开分支上 rebase」的警告。
- [git-clone 手册](https://git-scm.com/docs/git-clone) —— 核实 `--depth`、`--filter=blob:none` 的预期行为；本章因本地协议忽略这些选项，效果以该文档为准。需要同时留两条分支时另见 [git-worktree 手册](https://git-scm.com/docs/git-worktree)。
- [GitHub Docs · Pull Requests](https://docs.github.com/en/pull-requests) —— 核实 PR、review、`Changes requested` 的语义（平台侧行为未在本机验证）。
- [GitHub Docs · Code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) —— 核实 `CODEOWNERS` 位置、匹配规则与必需 owner 审批开关。
- [GitHub Docs · Branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository) —— 核实禁强推、必需状态检查、required reviews 的配置项名称。
- [git-filter-repo](https://github.com/newren/git-filter-repo) —— 核实历史改写工具现状与 `filter-branch` 的弃用；本章只讲机制与顺序，未执行。

## 下一章

这一章把远端还原成「引用 + 条件更新」：`fetch` 只更新认知、`pull` 是认知加集成、`push` 是带检查的请求，而 `--force-with-lease` 是唯一可接受的强推写法（实测 `(stale info)` 挡住了「你没看见就覆盖」那一类事故）。但协作不只是搬代码，还得让**信息**可检索：一笔提交是 `feat` 还是 `fix`、算不算破坏性变更、该升哪个版本号——这些约定目前还只存在你脑子里，PR 里那句 `fix again` 就是证据。下一章把它们变成机器强制的东西：Conventional Commits 的格式与 type 语义、`commit-msg` 钩子怎么拦（本机实测）、`core.hooksPath` 与 husky 一类工具怎么绕开「钩子不进仓库」的限制 → [代码规范与提交约定](/devops/code-standards)。往回看，本章关于快照、指针、`reflog` 的结论都来自 → [Git 基础](/devops/git-basics)。
