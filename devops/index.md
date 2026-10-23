# 工程工具与部署 · 领域首页

<StatusBadge state="ready" note="10 章正文全部完成（第 10 章为阶段项目），可连续学习" />

## 这个领域解决什么问题

代码在你电脑上能跑，和代码在服务器上稳定地跑，中间隔着一整条工程链路。这个领域解决的就是这条链路上的具体问题：

- **改坏了代码想回到昨天的版本，回不去。** 手动备份 `项目-final-v2-真的final.zip` 不是版本控制。你需要理解 Git 的仓库、提交与分支模型，才会知道「找回三天前删掉的一个文件」「在不影响主线的情况下试一个大改动」为什么是几条命令的事。
- **合并代码时冲突一片红，不敢下手。** 冲突本身不可怕，可怕的是不理解 merge 和 rebase 的区别、不知道解决冲突后该 `git add` 还是该中止，更不知道 `git reflog` 能把你从几乎任何误操作里捞回来。
- **每次部署都是手工操作：本地打包、scp 上传、SSH 进去重启服务。** 一次要十分钟，还总忘某个步骤。你需要的是一条 CI/CD 流水线：推代码 → 自动测试 → 自动构建镜像 → 自动部署，全程可追溯。
- **「在我机器上是好的」。** 因为你的机器和服务器的 Node 版本、依赖安装方式、环境变量都不一样。Docker 解决的就是这件事：把运行环境本身打进镜像，让「环境」变成代码的一部分，可构建、可版本化、可复现。
- **上线出了 bug，想回滚，却发现数据库迁移已经改了表结构，回不去了。** 发布与回滚不是「重启一下」，而是一组需要提前设计的能力：版本化的镜像、可逆的迁移意识、必要时蓝绿切换。

对独立开发者来说，这个领域的价值尤其高：你没有同事帮你 review、没有运维帮你兜底，**工具和流程就是你的同事**。Git 是你的记忆，CI 是你永不疲倦的测试员，Docker 是你可复现的机房。

## 前置知识

- [Linux](/linux/)——只需要第一期最小集：命令行、SSH 密钥登录、端口与防火墙概念、systemd 基础、Nginx 反向代理。本领域的部署实战全部发生在 Linux 服务器上，不会 Linux 基本操作就寸步难行；但不需要学完 Linux 的 Shell 脚本、安全加固等第二期内容。

此外，虽然数据源中未列为硬前置，实际动手时你最好已经跟着路线走完了[后端开发](/backend/)——阶段项目需要部署一个真实的前后端应用。Git 和测试部分则可以更早开始学，与写代码并行。

## 章节目录

| 章节 | 内容 | 学完能做什么 |
| --- | --- | --- |
| [1. Git 基础](/devops/git-basics) | 仓库/工作区/暂存区/提交的四层模型、分支的本质、merge 与 rebase 的取舍、冲突处理、撤销的完整地图（`restore`/`revert`/`reset` 的区别）、用 `reflog` 找回「丢失」的提交、tag 与版本号 | 独立完成日常版本管理，误操作后知道怎么救，且能解释每个撤销命令动了什么 |
| [2. Git 协作](/devops/git-collaboration) | GitHub 仓库与远程操作、fork 与 upstream、Pull Request 的完整流程、Code Review 的意义（哪怕是给自己看）、issue 管理、`.gitignore` 与「不小心把密钥提交了怎么办」 | 用 PR 流程管理自己的功能开发，理解开源协作的基本礼仪与机制 |
| [3. 代码规范](/devops/code-standards) | ESLint 与 Prettier 的分工（一个管对错、一个管格式）、EditorConfig、Conventional Commits 提交信息约定、由提交生成变更日志 | 给项目配好自动化规范，提交历史读起来像一份 changelog 而不是一堆 "fix" |
| [4. 测试体系](/devops/testing) | 三层测试的分界线（单元/集成/E2E 各拦什么、为什么中间层不能空）、零依赖 `node:test` 全流程与退出码契约、测试替身 fake/stub/spy/mock 的代价、覆盖率怎么看（以及为什么 100% 覆盖率不等于没 bug）、测试数据的可重复与自清理、flaky 的三种来源与定位、TDD 的适用面、Vitest 与 Playwright 的位置 | 能为后端 API 写出「可重复执行的失败判据」，知道什么代码值得测、测到什么程度，并把测试命令接进 CI 当闸门 |
| [5. CI/CD 与 GitHub Actions](/devops/ci-cd) | CI / 持续交付 / 持续部署的分界线（差别只在最后有没有人工闸门）、流水线的六个阶段、Workflow/Event/Job/Step/Runner/Action 六个对象的关系、workflow 文件骨架与它的默认行为、触发条件与运行上下文（fork 的 PR 拿不到 secrets）、缓存与产物的取舍、Secrets 与变量的边界、`permissions` 最小化与表达式注入防护、必需状态检查与保护分支、失败定位的四层缩小法、分钟倍率与并发上限 | 看得懂也写得出一个 workflow 文件，能解释每次 push 后自动发生了什么、绿灯为什么还不等于能合并，并把密钥与部署权限挡在代码库之外 |
| [6. Docker 基础](/devops/docker-basics) | 镜像与容器的关系、Dockerfile 编写、层缓存与指令顺序对构建速度的影响、多阶段构建（构建环境与运行环境分离）、常用运维命令（`logs`/`exec`/`stats`/`prune`） | 把自己的前端和后端分别写成 Dockerfile，镜像小、构建快、可复现 |
| [7. Docker Compose、卷与网络](/devops/docker-compose) | Compose 编排多容器（应用 + 数据库 + Nginx）、卷与数据持久化（容器删了数据还在）、容器网络与端口映射、环境变量注入 | 用一份 `compose.yaml` 拉起完整的多服务应用，理解数据该放哪、容器之间怎么互相找到对方 |
| [8. 部署到 VPS](/devops/deploy-to-vps) | 部署形态全景（本站主线：VPS + Docker + Nginx）、服务器初始化对接 [Linux](/linux/) 领域、域名解析、Nginx 反代容器、HTTPS 证书与自动续期、部署脚本化 | 把一个真实产品部署到自己的 VPS，通过域名 + HTTPS 访问 |
| [9. 发布与回滚](/devops/release-and-rollback) | 语义化版本（SemVer）、镜像打 tag 的策略、发布策略概念（滚动、蓝绿，以及在单机 Docker 上能做到什么程度）、数据库迁移与回滚的关系、回滚预案怎么写 | 每次发布有版本号、有记录、有退路；出事能在几分钟内回到上一个可用版本 |
| [10. 阶段项目：完整部署上线](/devops/project) | 把首页十条验收标准挂回前九章的交接点上：仓库与提交约定、CI 必需检查与密钥扫描、多阶段镜像与不可变 tag、Compose 三服务的职责与就绪顺序、域名/证书/反代的四层判据、带审批闸门的自动部署、上线后四行读数、五分钟回滚演练；每个阶段都给出输入、输出与失败长相 | 独立讲清（有条件时跑通）「一笔提交 → 用户看到新版本」这条链路，每个交接点都交得出机器可读的判据；没有 VPS 也能把它完成为一份可被复核的推演 |

## 学习顺序建议

**Git（第 1–2 章）越早学越好**，甚至可以和写第一个代码项目同步开始——没有版本控制的学习过程本身就是高风险的。第 3 章代码规范在你有第一个正式项目时立刻配上。

第 4 章测试体系建议在后端学习中段介入：先有代码可测，再学怎么测，否则测试章节会变成纯理论。

第 5–7 章（CI/CD 与 Docker）是第一期后段的主体。顺序不能反：先懂 Docker 镜像与容器，CI 里的「构建镜像」步骤才有意义；先手动部署成功一次（第 8 章的前半部分），再把手动步骤搬进流水线自动化——**没手动成功过的流程不要自动化**，否则你无法分辨是流水线的问题还是部署本身的问题。

第 9 章发布与回滚放在最后，因为它依赖前面所有能力的组合，而且只有真的发布过几次，才会对「回滚」有真实需求。

按全站路线，本领域第一期学最小集（Git、Dockerfile、Compose、部署上线），第二期回来补 CI/CD 完整流水线、测试体系与发布回滚策略。

## 学习方法

**Windows 环境准备：**

- **Git**：安装 Git for Windows，它自带 Git Bash。本站所有命令默认在 Git Bash（或 PowerShell）中执行，涉及路径差异处会标注。配置 GitHub 的 SSH 密钥登录，从第一天起就不用 HTTPS + 密码推送。
- **Docker**：Windows 下用 **Docker Desktop**，并选择 **WSL2 后端**（安装向导里默认推荐）。这意味着容器实际跑在 WSL2 的 Linux 内核上，行为与你的 Linux VPS 一致。两个常见坑提前说：镜像里路径用 `/` 而不是 `C:\`；容器内访问宿主机不能写 `localhost`。Docker Desktop 对个人学习免费，但注意其商业授权条款，公司环境使用前需自查。
- **CI/CD**：不需要任何本地环境，GitHub Actions 跑在 GitHub 的服务器上，你只需要一个 GitHub 仓库。这反而是最省事的一章的环境准备。
- **部署**：需要一台 VPS（参见 [Linux 领域的学习方法](/linux/)中的选购建议）。没有 VPS 之前，第 8 章的 Nginx + HTTPS 部分可以用 Docker Compose 在本机模拟域名与反代，但真实的公网部署体验无法替代。

**练习原则**：

- 学 Git 时专门建一个 `git-practice` 仓库做危险实验（硬重置、搞乱分支再救回来），永远不要在真实项目里第一次尝试新命令。
- 每章结束后问自己：这个工具的「心智模型」我能不能用三句话讲清楚？比如 Git 是「对快照的有向图管理」，Docker 是「把文件系统分层打包」，CI 是「把口头约定变成机器强制执行」。讲不清就回去重读。

## 阶段项目

**把第一期做的产品真正部署上线**。这是全站第一期的收官里程碑，验收标准：

- [ ] 代码托管在 GitHub，主分支受保护，功能开发走 PR 流程（哪怕 reviewer 只有你自己）
- [ ] 提交历史符合 Conventional Commits，能从提交信息生成 changelog
- [ ] ESLint + Prettier 配置在仓库中，CI 里强制检查
- [ ] 后端至少有一组有意义的 API 测试，在 CI 中自动运行
- [ ] 前端与后端各有 Dockerfile，后端使用多阶段构建（构建层与运行层分离）
- [ ] 一份 `compose.yaml` 能在 VPS 上拉起应用 + PostgreSQL + Nginx
- [ ] GitHub Actions 流水线：push 到主分支 → 跑 lint 与测试 → 构建镜像 → SSH 到 VPS 自动部署，全程无人工干预
- [ ] 域名解析到 VPS，HTTPS 证书有效且自动续期，HTTP 自动跳转 HTTPS
- [ ] 部署密钥全部走 GitHub Secrets 与服务器环境变量，代码库里 `git log` 翻不出任何密钥
- [ ] 完成一次回滚演练：故意部署一个坏版本，然后在 5 分钟内回退到上一个可用版本，并记录操作步骤

## 官方文档与延伸阅读

以下链接均已验证可访问（核实时间 2026 年 10 月）：

- [Pro Git 中文版（官方书籍，全文免费）](https://git-scm.com/book/zh/v2) —— Git 学习的唯一主线教材，本站第 1–2 章的深度以它为上限。
- [Git 命令参考手册](https://git-scm.com/docs) —— 查具体命令参数用这个，不用搜索引擎。
- [GitHub Docs · Pull Requests](https://docs.github.com/en/pull-requests) —— PR 与协作流程官方文档。
- [GitHub Docs · SSH 连接配置](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) —— 配置密钥推送的官方步骤。
- [GitHub Actions 文档](https://docs.github.com/en/actions) —— workflow 语法、secrets、缓存的权威来源。
- [Docker 概览（官方文档）](https://docs.docker.com/get-started/docker-overview/) —— 镜像、容器、引擎的官方概念定义。
- [Docker Compose 文档](https://docs.docker.com/compose/) —— 多容器编排的权威参考。
- [ESLint 文档](https://eslint.org/docs/latest/) / [Prettier 文档](https://prettier.io/docs/) —— 注意两者职责不同，先读 Prettier 文档里的「为什么不用 ESLint 格式化」说明。
- [EditorConfig 官网](https://editorconfig.org/) —— 跨编辑器统一基础格式的最小方案。
- [Conventional Commits 规范（中文）](https://www.conventionalcommits.org/zh-hans/) —— 提交信息约定的原始规范。
- [语义化版本 SemVer（中文）](https://semver.org/lang/zh-CN/) —— 版本号怎么起的唯一权威定义。
- [Vitest 文档](https://vitest.dev/) / [Playwright 文档](https://playwright.dev/docs/intro) —— 本站测试体系章节对应的工具文档。
- [Nginx ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) —— 反向代理指令参考，配合 [Linux 领域的 Nginx 章节](/linux/)使用。

## 版本说明

- **Git**：命令以 Git 2.x 现代语法为准（如 `git restore`/`git switch`，2.23+ 引入），与老教程中的 `checkout` 混用写法有差异，文中会注明。具体版本号以 [git-scm.com](https://git-scm.com/docs) 最新稳定版为准。
- **GitHub Actions**：workflow 语法基于当前主流版本编写。Actions 生态（marketplace 上的第三方 action）变化较快，涉及第三方 action 的地方以官方文档最新说明为准，本站会标注核实日期。
- **Docker**：以 Docker Engine 当前稳定版与 Compose V2（`docker compose` 子命令，而非已弃用的 `docker-compose` 独立二进制）为准，不锁定具体版本号。
- **ESLint**：以官方文档最新稳定版为准。特别注意 ESLint 近年更换了配置体系（flat config），网上大量旧教程使用已弃用的旧配置格式，遇到对不上时先确认教程年代。
- 其余工具（Vitest、Playwright、Prettier 等）均不写死版本号，以各自官方文档最新稳定版为准。
