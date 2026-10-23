# CI/CD：把「我本地跑过了」换成机器给的通行证

你晚上十点改了一个依赖版本，本地测试全绿，提交、推送、睡觉。第二天线上从那次提交起一直报 502。问题不在你懒，而在**「我本地跑过了」这句话没有任何机器读得懂的含义**：一次性、不可复查、只有你自己相信。上一章已经把客户端钩子的天花板钉死了——`git commit --no-verify` 一试就过，所以强制力必须来自服务器侧。第二个坑是部署：打包、上传、SSH、`compose up`、翻日志，每次十几分钟全靠记忆，忘一步就是 502 或跑着旧代码。第三个坑最贵：`.env` 跟着提交进仓库，历史里删不干净，只能全部轮换——本章第一次给你一个正经放秘密的地方，**仓库之外、运行之内**的加密变量。

所以 CI/CD 不是「自动化」这种抽象美德，而是一条具体链路：推代码 → 机器重跑判据 → 产出可发布的工件 → 按闸门放行 → 上线。判据由上一章的测试提供，工件由第 6–7 章的镜像提供，闸门与退路由第 9 章提供。

<Callout type="unverified" title="本章没有运行过任何 workflow">

本机没有配置任何 GitHub 仓库、没有 `gh` CLI、没有本地 runner 工具（`command -v gh` 与 `command -v act` 均返回未安装），**没有触发过一次 workflow 运行，没有连接任何 VPS，没有部署**。语法、默认值与限制数字来自 2026-10-20 抓取的官方文档，出处在文末，抓取摘要不保证逐字；凡没有出处的说法，文中写明「推演」或「未在真实仓库验证」。唯一在本机跑过的是「注入」一节的 shell 机制模型。

</Callout>

## CI、持续交付、持续部署：差别只在最后有没有人工闸门

三个词的流水线内容几乎一样，**唯一区别是「上线这一步由谁批准」**。

| 术语 | 自动化覆盖到哪 | 上线前要不要人点头 | 适合什么时候 |
| --- | --- | --- | --- |
| 持续集成 CI | 构建、测试、静态检查 | 不涉及上线 | 有第二个分支的那天起 |
| 持续交付 Delivery | 产出「随时可发布的版本」并归档 | **要**，人按一下 | 独立开发者的现实起点 |
| 持续部署 Deployment | 通过闸门的提交自动进生产 | 不要 | 有告警与回滚演练兜底之后 |

两个推论：**CI 是 CD 的前置而不是同义词**——没有可信判据就上自动部署，等于把「本地跑过了」的不可信度放大到生产。**从 Delivery 到 Deployment 不是技术升级，是信任升级**——底气来自[发布与回滚](/devops/release-and-rollback)的回滚演练。个人项目先做 Delivery，真的回滚过一次之后再考虑让 `main` 自动上线。

## 流水线的六个阶段：每段要么交出判据，要么交出产物

| # | 阶段 | 典型命令 | 失败拦住什么 |
| --- | --- | --- | --- |
| 1 | 准备环境 | `checkout`、`setup-node`、`npm ci` | 装不出依赖，后面全是噪音 |
| 2 | 静态检查 | `lint`、`type-check`、密钥扫描 | 格式、类型、泄漏的秘密 |
| 3 | 测试 | `npm test` | 上一章那条可重复的失败判据 |
| 4 | 构建产物 | `build` 传 `dist/`、`docker build` 推镜像 | 产物坏、体积超预算 |
| 5 | 发布部署 | 登录仓库、`ssh`、`compose up -d` | 这一步之后已影响用户 |
| 6 | 上线后验证 | HTTP 探活、错误率对比 | 脚本没报错但服务其实是坏的 |

三条设计原则比任何字段都重要。**阶段之间传产物，不重做工作**：部署的必须是构建出的那个 tag，而不是在服务器上重新构建，否则「CI 绿的」和「线上跑的」是两份东西。**判据靠退出码**：CI 只看返回 0 还是非 0，`vue-tsc --noEmit` 报错时照样吐文件，只有退出码拦得住（见 [TypeScript 的取舍](/typescript/tradeoffs)）；第 6 段同理要写成「不 2xx 就 exit 1」。**越靠后越少跑**：1–4 每个 PR 都跑，5–6 只在 `main` 或 tag 上跑。

## 六个对象各管什么：Workflow、Event、Job、Step、Runner、Action

| 对象 | 它是什么 | 一次运行里有几个 | 关键约束 |
| --- | --- | --- | --- |
| Workflow | `.github/workflows/` 下一个 YAML | 多个并存 | 官方原文：必须用 YAML 语法，扩展名 `.yml` 或 `.yaml`，且必须放在仓库的 `.github/workflows` 目录 |
| Event 与 Run | 触发条件，以及它产生的一次执行 | 声明 1..n 个事件 | 声明了不等于会触发；官方 limits：单次 run 上限 35 天 |
| Job | 一台执行机上的整段工作 | 多个，默认并行 | 官方原文：一次 run 由一个或多个 job 组成，**默认并行运行**；要顺序就用 `needs` |
| Step | job 里的一条命令或一个 action | 多个，严格顺序 | 同 job 的 step 共享工作目录；一个 step 非 0，job 默认立即失败 |
| Runner | 真正跑 step 的虚拟机或容器 | 每个 job 一台 | 官方原文：每个 job 运行在由 `runs-on` 指定的 runner 环境里 |
| Action | 可复用的 step，用 `uses` 引用 | 任意 | 版本用 `@vN` 或 commit SHA 固定；第三方 action 等价于「能读你全部 secrets 的协作者」 |

串起来：**workflow 文件在 event 发生时产生一次 run；run 里并行的 job 各占一台 runner；job 里顺序执行的 step 共享同一个工作目录。**

由此推出两条最常踩的约束（推演）：代码不是自动就在工作目录里的，第一个 step 通常要 `checkout`；**跨 job 不共享文件系统**，`verify` 里的 `dist/` 在 `deploy` 看不见——`needs` 只保证顺序，不搬文件。

## workflow 的骨架：一个最小例子与它的默认行为

```yaml
# .github/workflows/ci.yml —— 示例，未在任何仓库运行过
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '22'   # 填你项目 engines 里那个大版本，别抄示例
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test
```

字段表只列**已核实的默认值**，其余以官方 workflow 语法页为准：

| 字段 | 管什么 | 已核实的默认值或约束 |
| --- | --- | --- |
| `on` | 事件与过滤条件 | 必填 |
| `jobs.<id>.needs` | 依赖哪个 job | 构成 DAG；上游失败则下游默认不跑 |
| `jobs.<id>.runs-on` | 用哪台 runner | 必填，标签形式 |
| `steps[].run` 或 `.uses` | 执行命令 / 引用 action | 非 Windows 默认 `bash`（找不到则 `sh`），Windows 默认 PowerShell Core |
| `env` | 变量 map | 官方原文：map 里的变量**不能引用同一 map 里的其他变量**；同名取最具体那处 |
| `concurrency` | 同组内排队与取消 | 官方原文：默认允许并发；同组内已排队的 pending job 或 run 会被取消 |
| `permissions` | 本轮 `GITHUB_TOKEN` 的范围 | 官方原文：一旦显式指定任何一项，**没写的那些全部变 `none`** |

## 触发条件：什么时候跑，以及在谁的上下文里跑

`on` 决定两件事：事件，以及这个事件带来的**上下文**——后者决定 job 能看到哪些 secrets、跑在哪个 commit 上。

| 事件 | 什么时候触发 | 边界 |
| --- | --- | --- |
| `push` | 推送到分支或标签 | 可按 `branches`、`tags`、`paths` 过滤 |
| `pull_request` | 提 PR 或 PR 有更新 | 跑在合并后的代码上，但**拿不到仓库 secrets** |
| `workflow_dispatch` | 网页手动点 Run workflow | 官方文档：可定义自定义输入、默认值与是否必填 |
| `schedule` | cron | 官方原文：最短间隔 5 分钟；**只在默认分支的最新提交上运行**；60 天无活动自动禁用 |
| `pull_request_target` | PR 事件但上下文不同 | 官方原文：该事件**在默认分支的上下文里运行** |

**过滤条件要同时满足**：官方原文，同时写了 `branches` 和 `paths` 时，workflow 只在这两个条件**都**满足才运行。以为是「或」的人会碰上「改了 README 什么都没跑，还以为流水线坏了」。

**fork 的 PR 拿不到 secrets**：官方原文，除 `GITHUB_TOKEN` 外，由 fork 仓库触发的工作流不会把 secrets 传给 runner。这是刻意设计，否则任何人都能提 PR 来读你的密钥；带来的现象是部署 job 挂在 `pull_request` 上时 secrets 是空字符串，报错长相是「认证失败」这种看不出根因的东西。所以本章的取舍是：**部署类 workflow 不监听 PR 事件，测试类 workflow 不需要 secrets。**

## 缓存与产物：一个可以丢，一个不能丢

| 维度 | 依赖缓存 cache | 构建产物 artifact |
| --- | --- | --- |
| 目的 | 省时间与分钟数 | 保存并传递这次运行的输出 |
| 能否丢 | **能丢**，丢了只是慢一点 | 不能丢，丢了这次运行就没有交付物 |
| 作用域 | 跨运行共享，按 key 命中 | 属于单次 run，可下载、不可变 |
| 命中语义 | 官方原文：`key` 是显式指定的键，`restore-keys` 是**前缀匹配**的键，用于精确 key 未命中时恢复旧缓存 | 按名字取，取不到就报错 |
| 隔离与上限 | 官方原文：**默认分支的缓存对其他分支可用**；每仓库最多 10 GB，一周内没被访问过的缓存也会被清除 | 只有同一次或指定的 run 能下载；保留期天数本章未核实 |


三条纪律：**只用 `npm ci`**，它严格按锁文件装（差异见 [包管理与工作区](/frontend-engineering/package-managers)），而 `npm install` 会改写锁文件，于是 CI 装的树和你提交的那份不是一回事；**key 绑锁文件哈希**，绑时间等于每次不命中，绑分支会让每个分支各存一份、把 10 GB 吃满；**敏感东西不进缓存**——缓存跨分支共享，它不是 secrets 存储。

## Secrets、变量、权限：三套别混为一谈的东西

| 叫什么 | 放什么 | 可见性 | 怎么用 |
| --- | --- | --- | --- |
| Secrets | SSH 私钥、镜像仓库口令、第三方 token | 创建后**无法查看**原值；日志里被掩码 | `secrets` 上下文，作 `with` 参数或 `env` 值 |
| Variables | 域名、区域名这类**非敏感**配置 | 明文 | `vars` 上下文 |
| Permissions | 本轮 `GITHUB_TOKEN` 能对仓库做什么 | 所有能读 workflow 的人可见 | 顶层或 job 级 `permissions` 块 |

三条硬事实决定威胁模型，均为官方安全文档原文：**「对仓库有写权限的任何用户，都有该仓库所有已配置 secrets 的读权限」**（比「会不会泄漏」更基本：write access 等于能读密钥）；fork 触发时不传 secrets；**单个 action 被攻破的意义非常大，因为该 action 能访问所有 secrets**——这就是要固定版本的理由。环境级 secrets 需要管理员或所有者创建（官方页面转述）。

部署密钥的形状（示例，未实测）：专用密钥对，公钥只进 VPS 的 `authorized_keys`，私钥进 secrets；服务器侧把这个账号限制成只能跑发布脚本，不用个人密钥、不用 root。一个名字在 workflow 里只对应一份值，测试与生产不同就另建**环境级** secrets；构建时变量与部署环境变量是两套体系（回指[环境变量与配置](/frontend-engineering/env-and-config)）。

## 注入：本章在本机实测的唯一机制

<Callout type="verified" title="下面这段是本机跑过的">

环境：Windows 10 + Git Bash + Node v25.4.0，2026-10-20。跑的是一个 14 行 bash 脚本，**复现的是「字符串替换发生在解析之前」这个 shell 性质，不是 GitHub Actions 本身的行为**；Actions 的 `run` 块同样是「替换成字面值 → 写成脚本 → 交给 shell 执行」，所以这个模型相关，但结论边界到此为止。

</Callout>

官方安全文档对内联脚本的建议，原文是：处理不可信输入的推荐做法**是把表达式的值设到一个中间环境变量里**。下面脚本里的 `evil` 对应的就是 GitHub 上的 PR 标题、issue 正文或分支名：

```bash
evil='hello"; touch pwned-a; echo "'

# 危险：值直接拼进命令行（未加引号的 heredoc 在写入时展开，等价于替换字面值）
cat > step-danger.sh <<EOF
echo "Title is $evil"
EOF
bash step-danger.sh

# 安全：脚本里只有变量名，值走环境
cat > step-safe.sh <<'EOF'
echo "Title is $TITLE"
EOF
env TITLE='hello"; touch pwned-b; echo "' bash step-safe.sh
```

本机实际输出（原文摘录，含两处生成出来的脚本内容）：

```text
--- 生成的脚本内容 ---
echo "Title is hello"; touch pwned-a; echo ""
Title is hello

danger: pwned-a 已创建 → 拼接进去的指令被执行了
--- 生成的脚本内容 ---
echo "Title is $TITLE"
Title is hello"; touch pwned-b; echo "
safe: pwned-b 不存在 → 值只是数据
```

第一处生成的脚本里 `touch pwned-a` 已经从数据变成**一条独立命令**，文件真的被创建；第二处 `$TITLE` 只是原样打印。同一份字符串，走环境变量就只是文本。

```yaml
# 危险：可控文本进命令行，替换后被 shell 重新解析
- run: echo "PR title is ${{ github.event.pull_request.title }}"

# 正确：值进环境变量，命令行里只有变量名
- name: 读取 PR 标题
  env:
    TITLE: ${{ github.event.pull_request.title }}
  run: echo "PR title is $TITLE"
```

为什么它在 CI 里比在本地贵得多（推演）：一次运行里所有 secrets 都在这台 runner 上可用，日志的掩码只掩**值**，不掩盖你把它写进了攻击者可见的位置；更糟的是 workflow 会用你的 `GITHUB_TOKEN` 以仓库写权限执行。四条防线：**可控文本一律走 `env`**、**需要 secrets 的 workflow 不监听 PR 事件**、**action 固定到 commit SHA**（官方原文：固定到 commit SHA 有助于缓解有人在 action 仓库里加后门的风险）、**`permissions` 收到最小**。

## 必需状态检查与保护分支：绿灯不等于闸门

流水线跑绿十次，也拦不住一次「明知是红还是合了」。强制力的开关不在 workflow 文件里，而在仓库设置的**分支保护（branch protection）**：`Settings` → `Branches` → `Add branch protection rule`。以下均为官方页面转述，**本章未在任何真实仓库操作或验证**。

| 选项 | 作用 | 副作用 |
| --- | --- | --- |
| 合并前要求 PR | 变更必须走 pull request | 不能直接 push 到受保护分支 |
| 合并前要求状态检查通过 | 勾选的检查必须成功 | **必须逐个选中检查名**，一个都没勾等于没生效 |
| 合并前要求分支是最新的 | 必须与基线分支同步 | 别人先合了你就要重跑一轮检查 |
| 限制绕过 | 官方说明默认**不适用于管理员**，可选择也应用到管理员 | 你自己就是管理员时，闸门形同虚设 |

两个现象值得先记住（第一条基于官方「必需检查必须处于成功、跳过或中性状态」的说明，第二条是推演）：**「跳过」也算过关**——`if` 让测试 job 被 skip，而它又列在必需检查里，那么「没跑测试」也能满足合并条件；想真强制就得让测试无条件跑。想真强制就得让测试无条件跑；矩阵展开后检查名带参数后缀，所以需要名字固定的汇总 job（`gate`），必需检查只勾它。

给独立开发者的最小配置：保护 `main`，要求 PR、要求 `gate` 这个固定名字的汇总检查通过、把限制也应用到管理员；部署那条线不进必需检查，靠 `workflow_dispatch` 加环境审批手动放行。**流水线是证据，保护分支才是闸门**——YAML 只能决定「跑什么」，不能决定「不跑就不许合并」。

## 失败定位：四层往下缩小范围

| 层 | 典型现象 | 先看哪里 | 常见原因与修法 |
| --- | --- | --- | --- |
| ① 没被识别 | Actions 页面一个运行都没有 | 文件路径与扩展名、`on` 的过滤 | 不在 `.github/workflows`、扩展名是 `.yaml.txt`、`paths` 与 `branches` 同时要求、cron 只在默认分支生效 |
| ② 环境不对 | 本机过、CI 不过 | 日志最前几行：runner 标签、Node 版本、shell | 忘 `setup-node`；Windows runner 默认 PowerShell 而脚本是 bash；用了 `npm install` |
| ③ 命令本身失败 | 某一步红，报错与测试或 lint 有关 | 该 step 完整输出，找第一条错误 | 与第 4 章同源：先单跑那条命令，别在 CI 里改 |
| ④ 只有 CI 才有 | 本地怎么都复现不出来 | 差异清单：secrets、网络、时序、缓存、并发 | fork PR 里 secrets 为空、缓存命中旧依赖、并发测试互相抢数据、flaky |

**本地复现四步，不装任何东西**：用同一个 Node 大版本；删 `node_modules` 后 `npm ci`；把本地 `.env.local` 临时改名，模拟 CI 里没有开发环境变量；在 Git Bash 和 PowerShell 各跑一遍。这四步能定位绝大多数「本地好的线上坏了」，也回答了「没有 GitHub 仓库能学到什么」——判据类问题本机可复现，只有触发、secrets 与真实部署是在线的。**同一 commit 重跑结果不同**不是运气差：按第 4 章 flaky 三种来源逐条排查，别用重试掩盖。**也别指望本地跑 workflow**：这类工具跑不出真实 runner 的镜像、网络与权限差异。

## 成本：分钟倍率、并发上限与三个开关

数字来自官方计费页与限制页 2026-10-20 的抓取，属易变信息，动手前核对：

| 项目 | 官方数字 | 对你的意义 |
| --- | --- | --- |
| 每月包含分钟 | Free 2,000；Pro 与 Team 3,000；Enterprise Cloud 50,000 | 公共仓库用 Linux runner 不占额度 |
| 超额单价（每分钟） | Linux $0.002、Windows $0.010、macOS $0.062 | 按单价 macOS 是 Linux 的 31 倍；**免费额度的倍率折算表本章未核实** |
| 标准 hosted runner 并发 job | Free 20、Pro 40 | job 之间会排队，不是无限并行 |

一个粗略推演（不引用未核实的倍率表）：3 OS × 4 Node 的矩阵每次 12 job、每 job 4 分钟即 48 分钟，每天 35 次运行就是约 1,680 分钟/天，是 Free 额度的 25 倍——**不加过滤的全矩阵每次跑，个人项目一定烧穿**。

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

**① 取消旧运行**最立竿见影：10 分钟推 8 次，默认 8 次运行把额度烧光，而只有最后一次有意义。组名带 `github.ref` 才不会把两个分支的运行互相取消；**主干和 tag 的发布流水线不要开取消**。**② 收窄触发**：`paths-ignore` 挡掉只改文档的提交，PR 阶段只跑 `ubuntu × 你的当前大版本`，全矩阵挪到 `schedule`。**③ 缓存依赖、只跑一遍**：端到端按上一章原则「快的每次跑，慢的少跑，最慢的定时跑」。

## 接上 Docker 与 VPS：一条完整但保守的流水线

第二个文件放在 `.github/workflows/release.yml`：校验和测试由上面那个 `ci.yml` 承担（合并时被必需检查拦住），这个文件只负责**产出镜像**和**按闸门部署**。示例，整体未运行。

```yaml
# .github/workflows/release.yml —— build 段需要第 6 章写好的 Dockerfile
name: Release
on:
  push:
    tags: ['v*']
  workflow_dispatch:        # 手动触发，可带自定义输入项指定要部署的 tag
permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: 构建并推送镜像
        env:
          IMAGE: ghcr.io/OWNER/APP:${{ github.ref_name }}
        run: |
          docker build -t "$IMAGE" .
          docker push "$IMAGE"

  deploy:
    needs: build
    if: github.ref_type == 'tag'
    runs-on: ubuntu-latest
    environment:
      name: production
    steps:
      - name: 部署到 VPS
        env:
          IMAGE_TAG: ${{ github.ref_name }}
          SSH_KEY: ${{ secrets.VPS_SSH_KEY }}
          HOST: ${{ secrets.VPS_HOST }}
          USER: ${{ secrets.VPS_USER }}
        run: |
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          printf '%s\n' "$SSH_KEY" > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan "$HOST" >> ~/.ssh/known_hosts 2>/dev/null
          ssh -i ~/.ssh/id_ed25519 "$USER@$HOST" \
            "cd /srv/app && IMAGE_TAG=$IMAGE_TAG docker compose up -d --pull always && ./healthcheck.sh"
```

取舍：**镜像 tag 取 `github.ref_name`**，也就是那个 `v*` tag，这就是第 9 章要求的可比较版本号，不要用 `latest` 部署，且它通过 `env` 进 shell，符合注入一节的纪律。`deploy` 挂 `environment: production`，带来环境级 secrets、部署审批与「谁在什么时候推上生产」的记录（环境可配保护规则，细节未核实）。**最后一句 `&& ./healthcheck.sh` 就是第 6 阶段**：不 2xx 就 exit 1，让 job 变红。

三个接口：[Docker 基础](/devops/docker-basics) 与 [Compose](/devops/docker-compose) 让 `docker build` 那行有意义，层缓存与多阶段构建直接决定这条流水线是 3 分钟还是 13 分钟；[部署到 VPS](/devops/deploy-to-vps) 与[发布与回滚](/devops/release-and-rollback) 提供 deploy 段那几条命令的真实内容和退路；[测试体系](/devops/testing) 与[代码规范](/devops/code-standards) 提供 `verify` 那几行命令与提交信息检查。**顺序不能反：没手动成功过的流程不要自动化**——手工部署失败你知道是哪条命令错了，流水线里的失败只剩一堆日志。需要「PR 里跑一次带数据库的集成测试」时，Actions 支持在 job 上声明服务容器（语法页的 `services` 一节，写法本章未核实）。

## 常见错误与排查

**1. 推了代码，Actions 页面一个运行都没有。** 原因：文件不在 `.github/workflows`（官方硬性要求）、扩展名不对、被 `paths` 与 `branches` 双过滤挡住、或你在功能分支上写了 `schedule`。怎么确认：把路径和事件名对着表念一遍，再临时去掉所有过滤只留 `on: push` 试一次。修法：先让「能触发」成立，再收窄过滤。

**2. 必需检查一直显示等待，PR 合不掉。** 原因：勾的检查名在这次运行里从未被报出（名字带 matrix 参数、job 被 `if` 跳过、workflow 没触发）。怎么确认：看那次运行的 job 列表，逐字比对界面里的名字。修法：加一个名字固定的汇总 job 承接必需检查；或关掉「要求分支最新」。

**3. `deploy` 在 fork PR 上报「认证失败」，本地怎么试都对。** 原因：fork 触发的运行拿不到 secrets，变量是空字符串（官方原文）。怎么确认：判成 `[ -z "$IMAGE_PASSWORD" ] && echo 空`——**只打印是否为空，绝不打印值**。修法：部署 job 不挂 PR 事件，改成 tag 或 `workflow_dispatch`。

**4. 明明改了依赖，CI 装的还是旧版本。** 原因：缓存 key 绑的是分支名或固定字符串而不是锁文件哈希；或用了 `npm install` 改写锁文件；或 monorepo 没写 `cache-dependency-path`。怎么确认：日志里搜缓存命中提示，再对比 `npm ls` 输出与锁文件。修法：key 用锁文件哈希、只用 `npm ci`；要彻底排除干扰就临时改一次 key 前缀逼它不命中。

**5. 下游 job 报「找不到 dist 目录」。** 原因：以为 job 之间共享文件系统，而 `needs` 只保证顺序。怎么确认：在下游 job 第一步 `ls` 一下（推演级排查，本章未在真实 runner 上跑过）。修法：用 artifact 上传下载，或把构建与部署合进同一个 job（代价是失去阶段隔离）。

## 练习

<Exercise title="练习 1 · 数一数并行与依赖" difficulty="基础">

下面这段 workflow（示例，未运行）里有几个 job？哪些并行？哪一步失败会让 `deploy` 完全不执行？`dist` 能不能被 `deploy` 直接看到？

```yaml
on: push
jobs:
  lint:
    runs-on: ubuntu-latest
    steps: [{ run: npm run lint }]
  test:
    runs-on: ubuntu-latest
    steps: [{ run: npm test }]
  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps: [{ run: npm run build }]
  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps: [{ run: ./deploy.sh }]
```

<template #answer>

四个 job。`lint` 与 `test` 并行（官方原文：一次 run 里的 job 默认并行运行），`build` 等两者都绿才开始，`deploy` 等 `build`——形状是菱形，不是直线。

`lint` 或 `test` 任一失败 → `build` 因上游失败默认不跑 → `deploy` 的 `needs` 也不满足。注意「不跑」和「跑但跳过」在必需检查里语义不同：前者可能让检查一直显示等待，后者可能被算作过关，两个方向的坑别混。

`dist` 看不到：每个 job 一台 runner，`needs` 只表达顺序、不传递工作目录，要传就得上报与下载 artifact。

</template>

</Exercise>

<Exercise title="练习 2 · 把危险写法改成安全写法" difficulty="进阶">

这段 step 挂在 `pull_request` 上，准备把 PR 标题写进自动评论。指出问题、改写成正确版本，并说明这段攻击者可控文本在什么条件下会变成实际执行的命令。

```yaml
- run: |
    echo "### 变更摘要" >> body.md
    echo "标题：${{ github.event.pull_request.title }}" >> body.md
    echo "分支：${{ github.head_ref }}" >> body.md
```

<template #answer>

问题：表达式的替换发生在脚本交给 shell **之前**，所以标题里的内容会作为命令文本参与解析；`github.head_ref` 更是攻击者直接控制的分支名。标题里放一段引号加命令（例如本章实测的那个字符串），后半句就独立成一条命令。官方安全文档的推荐做法正是「把表达式的值设到一个中间环境变量里」——改法就是把 `TITLE` 与 `HEAD_REF` 写进这个 step 的 `env`，命令行里只引用变量名，形状与「注入」一节的正确写法完全一致。

触发条件：workflow 文件在**默认分支**上、且有人能向你提 PR。PR 事件的运行不带仓库 secrets（官方原文），攻击者只拿到这轮 `GITHUB_TOKEN` 的权限；但同仓库里 `pull_request_target` 或 push/tag 的 job 若也这么写，secrets 就在同一台机器上可用——这就是两条纪律必须并列的原因。

不用 GitHub 也能验：手工替换成字面值写成脚本跑一次，看有没有多出文件；换成 `env` 版本再跑，看是不是原样打印。

</template>

</Exercise>

<Exercise title="练习 3 · 故意造一个跑不通的 workflow 并解释报错" difficulty="挑战">

做三件事，每件写出预期的失败长相：① 把 workflow 文件放到 `workflows` 目录（漏掉 `.github`）；② 把 `runs-on` 写成 `ubuntu-lastest`；③ 在必需检查里勾一个不存在的检查名。三种失败分别属于失败定位四层里的哪一层？为什么 ① 和 ② 在 Actions 页面看到的长相完全不同？

<template #answer>

① 文件不在 `.github/workflows` → GitHub 根本不认为它是工作流：Actions 页面连条目都没有，**没有报错、没有日志**（官方原文：workflow 文件必须存放在仓库的 `.github/workflows` 目录）。属于第 ① 层，且是最阴的一种——界面给不出任何线索，只能自己核对路径。

② `runs-on` 拼错 → workflow 被识别、事件被触发、job 被创建，然后立刻失败，报的是「找不到满足该标签的可用 runner」这类信息（具体文案本章未在真实仓库验证）。属于第 ② 层：它证明文件被读进去了，但环境要求无法满足。

③ 必需检查名不存在 → 流水线正常跑绿，但 PR 上那条检查永远显示等待，合并不了。它失败在仓库设置与 workflow 的**接缝**上，最容易被误诊成「GitHub 抽风」。修法：用名字固定的汇总 job 承接必需检查。

区别一句话：**① 是没有运行，② 是运行了但起不来，③ 是跑绿了却拦住合并**。先问自己在哪一层，比读日志快得多。

</template>

</Exercise>

## 官方文档与延伸阅读

站内衔接：[上一章：测试体系](/devops/testing)、[代码规范与提交约定](/devops/code-standards)、[Docker 基础](/devops/docker-basics)、[部署到 VPS](/devops/deploy-to-vps)、[发布与回滚](/devops/release-and-rollback)、[阶段项目：完整部署上线](/devops/project)、[包管理与工作区](/frontend-engineering/package-managers)、[环境变量与配置](/frontend-engineering/env-and-config)、[领域首页](/devops/)。

外部（每条都在 2026-10-20 抓取过；**抓取摘要不保证逐字**，动手前自己核对）：

- [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) —— job 默认并行与 `needs`、job 跑在 `runs-on` 指定的 runner、`env` 内变量不能互相引用、指定任一权限则其余为 `none`、同并发组的 pending 运行会被取消。
- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) —— 事件清单、`branches` 与 `paths` 需同时满足、cron 最短 5 分钟且只在默认分支运行、60 天无活动自动禁用、fork 不传 secrets、`pull_request_target` 的上下文。
- [Security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) —— 写权限可读全部 secrets、不可信输入走中间环境变量、固定 commit SHA、单个 action 被攻破即访问所有 secrets。
- [Using secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) 与 [Limits](https://docs.github.com/en/actions/reference/limits) —— 三级 secrets、创建后不可读、日志掩码（转述）；run 35 天、matrix 256 job、文件 500 KB、各计划分钟与并发 job 数。
- [Actions 计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions) —— 三种 runner 每分钟单价、公共仓库免费、包含存储。**倍率折算表未核实。**
- [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) —— 保护分支选项语义、必需检查状态含跳过、限制默认不适用于管理员（转述）。
- [checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node)、[cache](https://github.com/actions/cache)、[upload-artifact](https://github.com/actions/upload-artifact) —— 三个 action 当前主版本 v7（v7.0.1 / v7.1.0 / v7.0.2）、`cache` 与 `cache-dependency-path` 写法、缓存 10 GB 与一周未访问即淘汰、默认分支缓存对其他分支可用。**`cache` 的版本本章未核实，动手前核对发布页。**

## 下一章

上一章把「什么算坏」写成机器能读的退出码，本章把这把尺子交到 GitHub 的机器上：每次提交自动重跑判据、产出带版本号的工件、由保护分支决定能不能合并、由手动闸门决定能不能上线。但本章那条 `docker build` 还是空话——你还没写 Dockerfile，也不知道层缓存为什么能决定这条流水线是 3 分钟还是 13 分钟。下一章回到「环境即代码」本身：镜像与容器、Dockerfile、多阶段构建 → [Docker 基础](/devops/docker-basics)。读完它再回来把本章 `build` 那个 job 填上：顺序是反的，内容必须成对读。
