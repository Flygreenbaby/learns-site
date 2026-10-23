# 规范要靠机器执行：把提交信息和代码风格变成过不了就合不上的关卡

你 review 一个 PR，标题写着 `fix`。看 diff 猜了五分钟，才知道它改的是接口错误码还是页面配色。三个月后线上出问题，你想找出「哪个版本引入了破坏性变更」，`git log --oneline` 里是 400 行 `update`、`wip`、`修改`、`fix bug`、`Revert "fix bug"`。CHANGELOG 写不出来，因为没有任何人（包括未来的你）能从这些信息里判断该升哪一位版本号。

同一件事在代码风格上也在发生：两个人对着 Prettier 和 ESLint 的职责边界吵了半小时缩进和分号，评审里三分之一的评论是「这里少个 await」。人盯是盯不住的——**盯的成本随仓库年龄和人数线性上涨，而且盯的人会累、会离职、会怀疑自己的判断**。规范唯一能长期生效的形态是：写在仓库里、由机器在提交或合并时强制执行、违反时的报错能直接告诉你怎么改。

本章讲这套强制机制本身：约定式提交（Conventional Commits）的格式与类型语义、提交信息怎么写才有信息量、版本号与变更日志怎么从提交生成、Git 钩子（`commit-msg` / `pre-commit` / `pre-push`）的机制与它绕不过去的缺陷、以及代码审查与注释的边界。**ESLint 与 Prettier 本身怎么配不在这里**，那是[代码规范：ESLint 与 Prettier](/frontend-engineering/lint-and-format)的内容；本章管「约定 + 强制」，那章管「工具 + 规则」。钩子部分的拦截效果全部在本机真跑过。

<Callout type="verified" title="本章实测环境">

Git `2.52.0.windows.1`，Windows 10 x64，钩子由 Git Bash 的 `/bin/sh` 执行，2026-10-18。真跑过：`commit-msg` 拦下不合规信息（退出码 1、历史里没有那笔提交）、放行 `feat: 支持手机号登录`、`--no-verify` 成功绕过、`core.hooksPath` 指向仓库内 `.githooks/` 后钩子生效且**取代** `.git/hooks`、`pre-commit` 用暂存清单做增量检查（报出 `var` 与残留冲突标记）、`pre-push` 拦住一次推送。`commitlint`、`husky`、`standard-version`、`lint-staged`、`pre-commit` 框架都要装包，本章**未安装、未运行**，配置与预期一律标注未验证。

</Callout>

## 一条提交信息里能放什么

约定式提交把标题定成一个可解析的语法：

```text
<type>[可选 scope]: <描述>

<正文>

<页脚>
```

| 部分 | 回答什么 | 机器能否解析 |
| --- | --- | --- |
| 标题 | 这次做了**哪一类**事、影响**哪个范围** | 能（type/scope/`!` 都是语法位） |
| 正文 | **为什么**这么做：动机、被否决的替代方案、上下文 | 只作为整体进 changelog |
| 页脚 | `BREAKING CHANGE: ...`、`Closes #123`、`Co-authored-by:` | 能（按 token 解析） |

[规范原文](https://www.conventionalcommits.org/zh-hans/)里几个容易被忽略的点，已核实：**`feat` 与 `fix` 是唯二影响版本号的类型**；类型名**大小写不敏感**，但页脚 token `BREAKING CHANGE` 必须全大写；scope 是括号里的自由文本；规范**不规定**任何工具，也不规定 changelog 格式，只规定信息怎么读。

### type 语义：不是风格分类，是版本号算法

| type | 语义 | SemVer 影响 | 例子 |
| --- | --- | --- | --- |
| `feat` | 新增用户可用的能力 | **MINOR** | `feat(auth): 支持手机号登录` |
| `fix` | 修 bug，不新增能力 | **PATCH** | `fix(api): 修正分页 last 参数越界` |
| `docs` | 只改文档/注释 | 无 | `docs(deploy): 补证书续期步骤` |
| `refactor` | 行为不变的重构 | 无 | `refactor(parser): 抽出 token 状态机` |
| `perf` | 只为性能改的实现 | 无 | `perf(list): 虚拟滚动替换全量渲染` |
| `test` | 只动测试 | 无 | `test(auth): 补手机号冲突用例` |
| `style` | 不改语义的格式 | 无 | `style: Prettier 全量格式化` |
| `build` | 构建系统/依赖产物 | 无 | `build: 升级构建工具` |
| `ci` | 流水线配置与脚本 | 无 | `ci: lint 步骤只检查改动文件` |
| `chore` | 上面都不沾的杂务 | 无 | `chore: 删除过期 TODO` |

三个边界要提前定，否则一定吵：**改了接口字段名**算 `feat` 还是 `fix`？——只要外部调用方需要改代码，它就是带破坏性标记的变更。**同时修 bug 又加日志**？——拆两笔（上一章的 `git add -p` 就是为这个准备的）。**升级依赖**？——只影响构建用 `build`/`chore`，改了公开行为用 `fix`/`feat`。

### 破坏性变更：`!` 与页脚两种写法

```text
feat(api)!: 把错误响应体改成 RFC 9457 格式

BREAKING CHANGE: 4xx/5xx 响应字段从 {message} 变为 {type,title,detail}。
迁移方式：读取 detail 替代 message，见 docs/migration/v2.md。
Closes #418
```

两种标记**同时给**才稳妥：标题里的 `!`（在 scope 之后、冒号之前）让人 `git log --oneline` 一眼看见，页脚的 `BREAKING CHANGE:` 让工具能解析出迁移说明。核实过两者都算数；只写 `!` 不写页脚，changelog 里就没有「怎么迁移」。**`BREAKING CHANGE` 只能出现在页脚**，写在标题里会占掉 type 的位置、解析直接失败。破坏性变更前先把影响面在 PR 里讲清（合并按钮差异见上一章）；版本号三位含义见 [SemVer 中文](https://semver.org/lang/zh-CN/)，与发布流程怎么绑见[发布与回滚](/devops/release-and-rollback)。

## 提交信息要写「为什么」，因为「是什么」已经在 diff 里

diff 是「改了哪些行」，Git 已经存了，复述一遍是纯噪音。信息里唯一无法从代码推出来的是**决策**。同一件事的三种写法，信息量递增：

```text
✗  fix
✗  修复了用户列表接口的 bug
✓  fix(api): 修正分页 last 参数越界返回 500

   前端把 page 从 1 开始计数，接口用 offset 计算 last 页时没减去 1，
   最后一页请求越界。曾考虑把前端改成 0 起始，但那会让所有调用方同时
   改动，故在接口侧兼容两种写法并加测试。
   Closes #418
```

自查四条：**删掉「本次」「这个 PR」这类指代**（一年后没人知道「本次」指什么）；**标题用祈使句**（`fix` 而非 `fixed`，与 Git 自己的 `Merge branch ...` 同一时态）；**标题带症状而不只是动作**（`fix(cart): 优惠券为空时崩溃` 优于 `fix: 修正空指针`）；**正文讲替代方案为什么被否决**——那是评审时最有价值的一段。

中文项目要特别注意**长度限制按字符还是按字节**：实测把 `feat: 支持手机号登录` 交给钩子算，`wc -c` 报 **27 字节**，而它只有 13 个字符。英文圈通用的「标题 50/72」照搬中文会紧得离谱，正确做法是按字符限（例如 ≤ 30 字）并在钩子里明确按字符计——别让人为了过检把中文压成看不懂的缩写。

## 从提交生成版本号与 CHANGELOG

约定式提交的最大收益是**变更日志和版本号能从历史算出来**：扫提交 → 按 type 分组 → `feat` 触发 MINOR、`fix` 触发 PATCH、`!`/`BREAKING CHANGE` 触发 MAJOR → 写 `CHANGELOG.md` → 打 tag。

| 工具 | 定位 | 预期行为 |
| --- | --- | --- |
| `standard-version`（`npx standard-version`） | 一体化：校验信息、算版本、写日志、打 tag | 生成 `CHANGELOG.md`、更新 `package.json` 版本、创建 annotated tag |
| `conventional-changelog-cli`（`-p angular -i CHANGELOG.md -s`） | 只生成日志 | 按 preset 重放提交历史；monorepo 里另一条路是 Changesets（每个改动带一个「意图文件」，发布前显式声明升哪一位） |

三者全部**未在本机验证**（需要装包），命令以各自文档为准；`standard-version` 维护性已放缓，**选型前先看仓库最近发布时间**，别把「教程推荐」当「当前维护」。手工兜底够用：`git log --no-merges --pretty='%s' v1.2.0..HEAD | grep -E '^(feat|fix)'`；在本机实验仓库跑 `git log --oneline --grep='^feat'` 实测返回 3 笔。

**这套流程的前置条件是提交真按约定写。** 一次 `wip` 混进主线，changelog 里就多一行读不懂的条目，且永久留在发布说明里。这就是本章把钩子放在核心位置的原因：不强制，就没人守。

## 钩子：机制、清单与它绕不过去的缺陷

钩子就是 `.git/hooks/` 下**同名且可执行**的脚本，Git 在关键动作前后调用它们，**非零退出码即中止该动作**。新建仓库里只有 `.sample` 模板，实测目录清单：

```text
applypatch-msg.sample   commit-msg.sample        fsmonitor-watchman.sample
post-update.sample      pre-applypatch.sample    pre-commit.sample
pre-merge-commit.sample pre-push.sample          pre-rebase.sample
pre-receive.sample      prepare-commit-msg.sample  push-to-checkout.sample
sendemail-validate.sample  update.sample
```

`.sample` 结尾不会被执行（Git 认精确名字），`cp commit-msg.sample commit-msg` 就生效。按拦截位置分：

| 类别 | 钩子 | 时机 | 典型用途 | 参数 |
| --- | --- | --- | --- | --- |
| 客户端 | `pre-commit` | 写信息之前 | lint 暂存文件、扫密钥、查冲突标记 | 无 |
| 客户端 | **`commit-msg`** | 信息写完、提交前 | **校验约定式提交** | 存放提交信息的**临时文件路径** |
| 客户端 | `pre-rebase` | 变基前 | 阻止对共享分支变基（上一章那种事故） | 上游 + 分支 |
| 客户端 | **`pre-push`** | 传输前 | 跑测试、拦住未经 PR 的推送 | 引用行从标准输入读 |
| 服务端 | `pre-receive` / `update` / `post-receive` | 服务器收到 push 时 | 真正的强制（**GitHub 不提供，自建 Git 服务器才有**） | 引用变更行 |

钩子有两条硬缺陷，理解比记命令重要：

1. **`.git/` 里的东西不随仓库分发。** `git clone` 只复制对象与引用，`.git/hooks/` 是你本地生成的，**你写的钩子同事拿不到**。这是「钩子不可靠」说法的真正来源。
2. **`git commit --no-verify`（`-n`）一次绕过所有客户端钩子。** 实测：同一笔会被 `pre-commit` 拦下的改动，加 `--no-verify` 直接成功——`[main e0aed4a] chore: 绕过钩子`、退出码从 1 变 0。

绕开缺陷 1 的正解只有一行配置：**把钩子放进仓库跟踪的目录，用 `core.hooksPath` 指过去**。

```bash
git config core.hooksPath .githooks      # 每个克隆执行一次
git add .githooks && git commit -m "ci: 把钩子纳入版本管理"
```

实测之后不合规提交报的是**仓库里那份脚本**的输出（`✗ [仓库钩子] 标题不合规`）；优先级也实测了：`git -c core.hooksPath=.git/hooks commit ...` 会改用 `.git/hooks` 里那个旧脚本，说明 **`core.hooksPath` 是取代而非叠加**。husky、lefthook 本质就是「装依赖时帮你跑这条 `git config`」，`pre-commit` 框架再按语言与路径分派工具。缺陷 2 客户端无解——**唯一的强制在服务端**：GitHub 保护分支 + 必需状态检查（上一章），或自建仓库的 `pre-receive`。定位：**钩子是「快速反馈」（2 秒报错），CI 是「真正的闸门」（3 分钟报错）**，两者检查内容应当一致，所以钩子只跑增量、3 秒内结束，全量留给 CI。

## 第一个钩子：commit-msg 拦下不通顺的提交

下面这段在本机跑通过（放 `.githooks/commit-msg` 或 `.git/hooks/commit-msg`，并 `chmod +x`）：

```sh
#!/bin/sh
file="$1"
title=$(head -n 1 "$file")

case "$title" in
  Merge*|Revert*|fixup!*|amend!*) exit 0 ;;      # 交给 Git 自己的格式
esac

if ! printf '%s' "$title" | grep -qE \
  '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._-]+\))?!?: .+'; then
  printf '✗ 标题不符合约定式提交: [%s]\n' "$title" >&2
  printf '  应为 type(scope)?: 描述，例如 feat(auth): 支持手机号登录\n' >&2
  exit 1
fi

chars=$(printf '%s' "$title" | wc -m | tr -d ' ')
[ "$chars" -le 60 ] || { printf '✗ 标题 %s 字符，超过 60\n' "$chars" >&2; exit 1; }
exit 0
```

实测行为（`printf 'x' > f.txt; git add -A` 后反复提交）：

```text
标题=[修了个 bug]           → ✗ 标题不符合约定式提交: [修了个 bug]   退出码 1，提交未产生
标题=[fixed]               → ✗ 标题不符合约定式提交: [fixed]       退出码 1，提交未产生
标题=[feat: 支持手机号登录]  → ✓ 通过 (标题 27 字节)                 提交成功，历史数 0 → 1
```

三个写法细节都来自踩坑：**报错必须写 `>&2`**（`commit-msg` 的 stdout 可能被当作信息内容处理，标准错误才是给人的通道）；**报错要给「怎么改」的例子**，越含糊越容易被 `-n` 绕过；**放行 `Merge`、`Revert`、`fixup!`**，Git 自动生成的标题不符合约定，硬拦会让人在合并冲突时提交不了。`commitlint` + `@commitlint/config-conventional` 是这套逻辑的成品：`extends` 那个 preset，再用 `rules` 定制，例如 `'subject-case': [ 0 ]` 关掉英文 camelCase 检查、`'subject-max-length': [ 2, 'always', 60 ]` 改限长（**未在本机验证**，规则号与默认值以官方文档当前版本为准）。ESLint 那套「0/1/2 = 关/警告/错误」在这里也成立，**「警告」级规则不拦只打印**，别指望它做闸门。

## 第二个钩子：pre-commit 只检查改动过的文件

全量 lint 一个三千文件的仓库要一分钟，每次提交都等一分钟，人就会开始绕过。增量思路是把范围压到「这次暂存的文件」，实测这一行是整个方案的核心：

```bash
git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|ts)$'
```

`--diff-filter=ACM` 只要 Added / Copied / Modified（故意排除 Deleted，否则 `eslint` 会报「文件不存在」）。完整可跑（本机实测拦下了 `var` 与冲突标记）：

```sh
#!/bin/sh
git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|ts)$' > /tmp/staged.list
[ -s /tmp/staged.list ] || exit 0            # 没碰 js/ts 直接放行

bad=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  grep -nE '(^|[^A-Za-z0-9_])var [A-Za-z_$]' "$f" \
    && { printf '✗ %s 里用了 var\n' "$f" >&2; bad=1; }
  grep -q '<<<<<<<' "$f" \
    && { printf '✗ %s 残留冲突标记\n' "$f" >&2; bad=1; }
done < /tmp/staged.list
exit $bad
```

实测输出与结果：

```text
✗ bad2.js:1 使用了 var（只报暂存文件）
✗ conflicted.js 残留冲突标记
普通 commit 退出码=1        历史数不变
--no-verify 退出码=0        → [main e0aed4a] chore: 绕过钩子
```

还有一条**必须写进规范**的行为：未跟踪文件从不进入检查清单——上面实验里那个没 `git add` 的 `notstaged.js` 整轮一次都没被报出来。这不是 bug，是设计：**`pre-commit` 检查的是「即将成为提交的那份内容」，不是工作区的临时状态**，所以它不打扰你试验，也意味着「我检查过了」和「我把未跟踪文件提交进去了」是两件事。**增量检查的致命局限也在这里：它只看暂存内容，不看与全仓库是否一致**——两个必须配对修改的文件你只暂存了一个，增量检查会放行，完整性只有 CI 全量跑能保证（[CI/CD 与 GitHub Actions](/devops/ci-cd)）。`lint-staged` 把「挑暂存文件 → 分组跑工具 → 改完自动 `git add`」做成配置，[pre-commit 框架](https://www.pre-commit.com/)思路相同、现成 hook 多（`gitleaks`、`detect-secrets`、`check-merge-conflict`），二者**未在本机验证**。选 husky 还是 pre-commit 取决于团队主力语言，但**钩子机制只能有一个**——`core.hooksPath` 是一个值，实测不叠加。密钥扫描值得单列：把 `gitleaks` 放进 `pre-commit` 扫**暂存内容**几乎零成本，挡住的是「将来必须轮换密钥 + 改写全部历史」那种事故。

## lint、format、EditorConfig：三条互不替换的线

四层各管一件事，谁也不替换谁：**Prettier** 管排版（缩进、换行、引号、行宽），**ESLint** 管对错与风险（未定义变量、缺失 `await`、依赖数组），两者的规则与配置都在[代码规范：ESLint 与 Prettier](/frontend-engineering/lint-and-format)；**EditorConfig**（[官网](https://editorconfig.org/)）管编辑器最小一致（`indent_style`、`insert_final_newline`），不报错、只生效；**`tsc --noEmit`** 管结构契约（可空性、签名一致），见[为什么需要 TypeScript](/typescript/why-types)；**约定式提交**管历史可读性与版本号，由 `commit-msg` 钩子 + CI 执行（本章）。三条纪律把风格之争赶出评审：**格式改动独占一笔、标题写 `style:`**（它会污染 `blame` 与 `log -p`，所以要能整体跳过）；**格式化的唯一作者是工具**，PR 里出现手工调的空格就是流程坏了；**规则改动也独占一笔**（`chore` 或 `ci`），因为它让全仓库一起变，混在功能里根本评审不动。`.gitattributes` 与 `.editorconfig` 都属于「仓库自己声明约定」，前者还管行尾（上一章实测的 `core.autocrlf=true` 与 `LF will be replaced by CRLF` 警告）。

## 命名与目录约定：省的是查找成本，付的是灵活性

约定的价值只有一种度量：**它替你省掉多少次「这文件该放哪」「这名字是不是同一个东西」的搜索**。有效的：`components/` 只放无业务依赖的可复用 UI、`features/<域>/` 按业务域内聚（API + 状态 + 视图在一起）、后端按层或按域二选一但**全仓库统一**、测试文件与被测文件同名加 `.test`。无效的：为了「看起来整齐」把三层结构套在 300 行脚本上、每个目录都配一个只做转发的 `index`。代价也要写进规范：**目录层级超过 3 层就该问「这是在服务谁」**；按类型分目录（所有 `controllers` 一处、所有 `services` 一处）会让「改一个功能跨五个目录」——**改一个需求要打开的文件数**比任何架构名词都更能反映结构好坏，同一判据在[软件架构：模式与取舍](/computer-science/architecture)从设计侧讲，两侧要一致。

## 代码审查规范：评审的对象是变更，不是人

**小 PR 是纪律，不是偏好。** 一个 800 行的 PR 里，评审者前三百行在读代码，后面开始扫，最后写一句 `LGTM`。落地办法：垂直切片（一个能独立上线的最小功能，而不是「后端全做完再做前端」）、把 `style`/`refactor` 与 `feat` 分开、用「先合骨架 + 特性开关藏住实现」代替攒一周。PR 描述要回答四件事，缺一件评审者就得在评论里问：

```text
1. 为什么改：现象 + 影响面（贴 issue 或用户反馈）
2. 怎么改：关键决策与被否决的替代方案（一段话，不是逐行解说）
3. 怎么验证：跑过什么命令、覆盖哪些场景、边界在哪
4. 风险与回滚：是否破坏性变更（对应上一章 squash 的回滚粒度）、出问题怎么退
```

评论写法：**区分阻塞项与建议并写进文字**（`blocker:` / `nit:` / `非阻塞建议：`）；**指向行而不是指向人**——「这里 `fetch` 没 `await`，抛错会静默」优于「你怎么没写 `await`」；要问就用「什么条件下会走到这个分支？」而不是「你是不是搞错了」。**否决权属于代码所有者**：`CODEOWNERS` 与 required review 的机制在上一章列过（平台侧未验证），把它落到目录级，别让「谁资历老谁说了算」替代规则。审查里最该看的是**提交信息与 diff 是否一致**：标题写 `fix` 而 diff 里加了三个新接口，就是拆分信号——这条几乎不需要领域知识，却能挡住大部分「顺手夹带」。

## 注释与文档的边界：哪些注释在制造负债

注释只在它能说明「代码本身表达不了的东西」时有价值。该写的：不变量与前提（`调用前必须持锁`）、单位与精度（`timeout 单位是毫秒，非单调时钟`）、反直觉的实现原因（`这里 sleep 200ms 是等文件系统时间戳精度`）、被否决的方案、跨模块契约。**有害的注释有四类**，删掉它们是纯收益：**复述代码**（`// 设置一个变量`）、**历史叙事**（`// 2024-03 张三加了一行`——blame 已经知道，且会腐烂）、**道歉型**（`// TODO: 以后再重构`，没有 issue 号的 TODO 等于没有 TODO）、**免责声明**（`// 这个函数很复杂，但确实是这样的`）。

判据一条：**注释与代码不一致时，代码是对的**。所以能用类型、命名、测试表达的约束不要写成注释（`@param {number} 单位毫秒` 不如 `function f(timeoutMs: number)`；「这列永远不为空」不如 `NOT NULL` + 收窄类型）。文档放在**决策所在层**：为什么选这方案写进 PR 或 ADR，怎么用写进函数上方，「是什么」交给命名和类型。

## AI 协作时代，规范是它的接口

越来越真实的场景：改动是 AI 生成的，人是评审者，历史里躺着 30 笔它的提交。这时规范的作用比以前更硬：

- **可复现**：提交粒度小且每笔独立可用。AI 一次生成 1200 行时你没法「回滚其中一半」；粒度到「一笔一个决策」，`git revert` 就是可用单位。
- **可读**：`feat` / `fix` / `refactor` 是标签，让你 30 秒内判断哪些提交要细读；信息只写 `update` 时你只能逐行读——而 AI 产出的行数恰恰很多。
- **可验证**：规范把「验证方式」写进 PR 描述，AI 的「我改好了」于是变成可检查的陈述；钩子与 CI 是不知疲倦的第二人，**不会因为你赶时间就放过**。
- **约定要写进仓库**，因为模型不认识你的口头传统。`AGENTS.md`、`CONTRIBUTING.md`、ESLint 配置、`.editorconfig`、本章的 `.githooks/` 是同一类东西的不同载体：**能被机器读到的约定才是生效的约定**。只存在于群聊里的规范，会被 AI 和新同事稳定违反。

结论不难听：**AI 让写代码变便宜，让判断代码变贵**。所有把判断成本前移的机制——小提交、清晰信息、增量检查、必需评审——价值都在上升。

## 常见错误与排查

**1. 钩子建好了却一次都没跑。** 三种原因按概率排：文件名带 `.sample` 后缀（实测目录里全是 `.sample`，Git 只认精确名）；文件不可执行（Windows 上要在 Git Bash 里 `chmod +x .githooks/commit-msg`，用资源管理器改属性无效）；设置了 `core.hooksPath` 但那个目录里没有同名脚本——**实测 `core.hooksPath` 是取代而非叠加**，指过去之后 `.git/hooks` 里的脚本全都不再执行。确认：`git config --get core.hooksPath`、`ls -l` 看权限位、钩子第一行加 `echo hook-ran >&2`。

**2. 同事绕过钩子推了不合规提交，历史里有 `wip`。** 原因：客户端钩子对 `--no-verify` 无解（实测绕过成功）。确认：`git log --no-merges --pretty='%s'` 筛出不合规行。修法：CI 里加一步全量校验（`commitlint --from <基线> --to HEAD`），并在保护分支把它设成必需检查——只有服务器侧能强制。

**3. 生成 CHANGELOG 时版本号跳得莫名其妙。** 原因：`feat` 被写在修 bug 的提交里、破坏性变更只写了 `!` 没写页脚、或一堆 `chore: 升级依赖` 被算进 MINOR。确认：`git log --grep='^feat' 上个tag..HEAD` 逐条看。修法：先修信息（`git rebase -i` + `reword`，仅限自己还没推的分支）再重跑生成；长期把 type 白名单和「标 `!` 必须有 `BREAKING CHANGE` 页脚」放进 `commit-msg`。

**4. 每次提交都跑全量 lint，慢到开始用 `-n`。** 原因：检查范围写成了整个项目而不是暂存内容。确认：钩子里 `time` 一下，超过 3 秒就该改。修法：`git diff --cached --name-only --diff-filter=ACM` 或 `lint-staged`；类型检查这类必须全量的放 CI，本地交给编辑器增量提示。

**5. 一个 PR 里既有功能改动又有 800 行格式化，评审直接摆烂。** 原因：没有 `style` 独占一笔的纪律（实测 `git blame` 会把格式化那笔报成每行的作者）。确认：`git diff --stat` 改动行数远超功能所需。修法：拆两笔，格式化那笔 SHA 追加进 `.git-blame-ignore-revs`。装了 husky 却「同事克隆里钩子不生效」也归到这一类流程问题：`core.hooksPath` 是本地配置，要有人跑过 `husky install` / `npm run prepare`；要么强制「clone 后先装依赖」，要么用本章实测的零依赖路线（`.githooks` + 一条 `git config` 写进 setup 脚本）。

## 练习

<Exercise title="练习 1 · 写一个能拦住中文项目坏提交信息的钩子" difficulty="进阶">

实现 `commit-msg` 钩子：拦下没有 type 的标题、拦下 `fix:` 这种空描述、放行 `Merge`/`Revert`/`fixup!` 开头的自动标题、标题长度**按字符**而非按字节限制（中文 13 字符 = 27 字节的实测差异）。给出你的正则、验证用的信息列表，以及哪些被拦下、哪些被放行。

<template #answer>

判据就是本章正文那个 `commit-msg` 脚本（`head -n 1` 取标题 → `case` 放行 `Merge*|Revert*|fixup!*|amend!*` → `grep -qE '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._-]+\))?!?: .+'` 不匹配就 `exit 1` → 最后用 `wc -m` 按字符限 60）。

实测结果：`修了个 bug` → 拦下（退出码 1，历史里那笔没产生）；`fixed` → 拦下（缺冒号与描述）；`feat: 支持手机号登录` → 放行（27 字节 / 13 字符，两种算法都能过，这就是把限长写成字符的意义）；`feat(auth): 支持手机号登录`、`fix(api)!: 调整错误响应结构` → 放行（`(\([a-z0-9._-]+\))?` 覆盖 scope、`!?` 覆盖破坏性标记）。

两个必须想到的边界：**空标题**（`git commit` 不带 `-m` 时 `$1` 里只有模板注释，要先剥掉以 `#` 开头的行再判断）；**多行信息**（`head -n 1` 只取标题，正文前必须有空行，否则生成工具会把正文第一段当标题）。

</template>

</Exercise>

<Exercise title="练习 2 · 制造一次「钩子放行但 CI 必红」和一次「钩子错了」" difficulty="挑战">

构造两种情况：① 客户端钩子放行、但全量 CI 必须失败的一次改动；② 钩子失败、但你判断这次是钩子错了而不是代码错了。给出各自的证据命令，并说明你会改钩子还是改 CI，为什么。

<template #answer>

① **钩子只看暂存内容，看不见跨文件一致性**。例：接口把返回字段 `message` 改成 `detail`，你只暂存了服务端那一个文件，调用方文件留在工作区没 `git add`。实测过这机制的另一半——未跟踪文件从不进入检查清单（`notstaged.js` 一次都没被报），所以钩子全绿、CI 的类型检查/测试必炸。证据：`git diff --cached --stat`（只有 1 个文件）对比 `git status -s`（还有 1 个未暂存）。**改 CI**：这类检查（type-check、全量测试、契约校验）本来就不该指望增量钩子。

② **钩子错的最常见形态是白名单太窄**：`Merge branch 'release/1.2'` 被拦，或 `docs(README): 修一个错字` 因为 scope 含大写被判违规（本章正则是 `[a-z0-9._-]+`，`README` 会挂）。证据：把该标题喂给正则看是否匹配。**改钩子**：白名单太窄会让人开始用 `--no-verify`，一旦这个肌肉记忆形成，钩子对所有规则的约束力一起归零——**误拦一次的代价大于漏拦十次**。原则：宁可在 CI 里补严，也不把本地钩子写成逼人绕过。

</template>

</Exercise>

<Exercise title="练习 3 · 给仓库加上零依赖的强制机制" difficulty="基础">

不许装任何 npm 包：钩子脚本进版本库、新克隆一条命令启用、不合规提交在本地被拦、`pre-push` 拦住未经 PR 的推送。写出目录结构、启用命令，以及你实测到的拦截证据行。

<template #answer>

```text
.githooks/
  commit-msg    .githooks/pre-commit    .githooks/pre-push
README.md       # 一行启用命令
```

```bash
git config core.hooksPath .githooks     # 每个克隆一次，写进 setup 脚本
chmod +x .githooks/*                     # Windows 上必须在 Git Bash 里执行
```

实测证据：`✗ [仓库钩子] 标题不合规`（不合规提交被拒）、`git config core.hooksPath` 回读 `.githooks`、`git -c core.hooksPath=.git/hooks` 时改用旧脚本（证明取代而非叠加）、`pre-commit` 报 `✗ bad2.js:1 使用了 var（只报暂存文件）` 且退出码 1、`pre-push` 报 `[pre-push] 本机不允许直接 push，请走 PR` 后紧跟 `error: failed to push some refs to '../remote.git'`。

必须承认的限制：`git commit --no-verify` / `git push --no-verify` 实测都能绕过。所以这套机制的定位是快速反馈，**强制力来自保护分支 + 必需状态检查**（[Git 协作与 GitHub](/devops/git-collaboration) 与 [CI/CD 与 GitHub Actions](/devops/ci-cd)），不是来自这些脚本。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Conventional Commits 规范（中文）](https://www.conventionalcommits.org/zh-hans/) —— 本章格式与规则的原始依据：标题语法、`feat`/`fix` 影响版本、`BREAKING CHANGE` 必须全大写、破坏性变更可用 `!` 或页脚、**不强制任何工具或 changelog 格式**。
- [语义化版本 SemVer（中文）](https://semver.org/lang/zh-CN/) —— 核实 MAJOR/MINOR/PATCH 各自触发条件，即本章 type 表的版本列。
- [githooks 手册](https://git-scm.com/docs/githooks) 与 [git-config 手册](https://git-scm.com/docs/git-config) —— 逐个钩子的参数、标准输入与退出码语义（`commit-msg` 收到信息文件路径、`pre-push` 从 stdin 读引用行），以及 `core.hooksPath` 的定义（一个路径值，取代 `.git/hooks`）；本章实测的 `.sample` 目录清单与「取代而非叠加」结论与之对应。
- [git-commit 手册](https://git-scm.com/docs/git-commit) —— 核实 `--no-verify` 跳过 `pre-commit` 与 `commit-msg`；本章实测 `[main e0aed4a] chore: 绕过钩子` 就是它。
- [commitlint 文档](https://commitlint.js.org/) —— 规则名、`--from/--to` 的 CI 用法与默认配置；**本章未安装运行**，配置示例与规则号以该页当前版本为准。`lint-staged` 与 [pre-commit 框架](https://www.pre-commit.com/) 同理，属成品方案，本章只实测零依赖路线。
- [代码规范：ESLint 与 Prettier](/frontend-engineering/lint-and-format) —— ESLint 与 Prettier 的规则与配置在那一章，本章不重复。

## 下一章

上一章解决「两个人怎么在同一份历史上工作」，本章把这些约定写成可解析的语法（约定式提交）并交给机器执行（`core.hooksPath` + `commit-msg`/`pre-commit` 实测拦截）——但**客户端钩子对 `--no-verify` 无解，这是本章实测确认的天花板**，强制力必须来自服务器侧。还有个更根本的问题本章一直在回避：钩子和 lint 只能判断「信息格式对不对」「有没有用 `var`」，判断不了「这段代码是不是坏了」。要知道后者，得有能自动给出「坏」这个判据的东西——测试。下一章讲什么代码值得测、单元测试与端到端测试的边界、以及怎么让测试本身不变成负债 → [测试体系](/devops/testing)。测试写完要有人替它跑，那是[CI/CD 与 GitHub Actions](/devops/ci-cd)的事，本章的 `commitlint --from..to` 与全量 lint 到时会变成必需状态检查。
