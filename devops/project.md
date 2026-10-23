# 阶段项目：从 git push 到线上更新——十条验收标准、五个交接点、一次五分钟回滚演练

你手工把第一个版本推上服务器，成功了。第二次改动只是「加一个字段」，于是照旧打包、上传、重启，进程没报错，十分钟后用户开始报 500：迁移根本没跑。第三次你多加了一步「顺手清一下旧镜像」，`ls | sort | head -1` 把正在服务的 `1.10.0` 当成最老的删了。这三件事的共同点不是「你不够仔细」，而是**这条链路上每个环节是否存在，取决于你当天记不记得它**。只要还有一个环节活在记忆里，它就是随机故障源。

所以本章不引入新工具，只做一件事：把前九章给出的判据串成一条**有输入、有输出、有失败长相**的链路，并把每个交接点写成机器能检查的形式。验收标准不看「网站能打开」——那只是第 7 阶段的一条副产物——而看你能否在陌生人在场时，对着这条链讲二十分钟并回答追问：为什么这个 job 要等那个 job、这条命令失败时你先查哪一层、回滚时数据为什么退不回来。

交付形态有两条路，都算完成本章。**实践路径**：有一台 VPS、一个 GitHub 仓库、一个域名，十条验收标准逐条做出证据。**学习路径**：没有 VPS 也没有云账号，仍然可以在本机把 ①②③④ 四个阶段做到有产出，把 ⑤⑥⑦⑧ 写成「可被复核的推演」——写出配置、说明每条命令的判据、指出失败会落在哪一层。本章正文按实践路径讲，末尾单列学习路径能覆盖到哪一条、哪些环节必须有真实账号。

<Callout type="unverified" title="本章没有任何一条服务器命令被真正执行过">

写作环境是 Windows 10 + Git Bash + Node.js `v25.4.0`（2026-10-20 核实）。本机 `command -v docker nginx certbot ssh-agent` 一个都找不到，没有 Docker 引擎、没有目标服务器、没有 GitHub 仓库、没有域名与证书，也没有安装任何东西。因此本章所有 `docker compose`、`nginx -t`、`certbot`、`ssh`、`git push` 类命令**都是按前九章与官方文档语义写成的步骤，不是本章跑过的结果**；配置片段属于示例。可以复核的部分只有：引用的每条官方结论都注明出处与前章链接，命令之间的先后与判据是自洽的，失败长相与前九章实测过的机制（退出码契约、`set -euo pipefail` 的三条结论、`depends_on` 的 572ms 窗口、字典序删版本的推断链）一致。凡本章额外推演出的结论，正文里标「推演」。

</Callout>

## 十条验收标准先落到阶段

[领域首页](/devops/)的阶段项目清单给了十条验收标准。它们是本章的需求清单，不增不减；这里只做一件事——把每条挂到一个阶段上，并规定「拿什么算过」。挂不上任何阶段的条目说明链路设计有缺口，挂上之后仍然说不清判据的条目说明那条标准是空的。

| 验收标准 | 落在哪个阶段 | 拿什么算过（证据形态） |
| --- | --- | --- |
| 主分支受保护，功能开发走 PR | ① | 保护分支设置页截图或 `gh api` 输出；一个真实 PR 的链接 |
| 提交符合 Conventional Commits，能生成 changelog | ① | `git log --no-merges --pretty='%s'` 全绿；`CHANGELOG.md` 里有一节真版本号 |
| ESLint + Prettier 在仓库里，CI 强制检查 | ② | workflow 里那个 step 的原始日志；把某文件写坏后 PR 变红 |
| 后端至少一组有意义的 API 测试，CI 自动跑 | ② | `node --test` 的退出码与 pass/fail 计数出现在日志里 |
| 前后端各有 Dockerfile，后端多阶段构建 | ③ | 两份 Dockerfile 进仓库；镜像体积与 `docker image ls` 一行 |
| `compose.yaml` 在 VPS 上拉起应用 + PostgreSQL + Nginx | ④ | `docker compose ps` 显示三服务 `Up (healthy)` |
| Actions：push → lint 与测试 → 构建镜像 → SSH 部署，无人工干预 | ⑥ | 一次 run 的 job 图与三行关键日志 |
| 域名解析、HTTPS 有效且自动续期、HTTP 跳 HTTPS | ⑤ | `certbot certificates` 的有效期行 + 定时器存在 |
| 密钥全走 Secrets 与环境变量，`git log` 翻不出任何密钥 | ②④⑥ | `git log -p -S` 查不到密钥字串；secrets 列表截图 |
| 故意部署坏版本，5 分钟内退回并记录步骤 | ⑧ | `RELEASES.txt` 里那一行 + 演练记录 |

两条必须连在一起读。**第 7 条写的是「全程无人工干预」，但它的前置是第 10 条**：[CI/CD 与 GitHub Actions](/devops/ci-cd) 的结论是「从 Delivery 到 Deployment 不是技术升级，是信任升级」，底气来自真的回滚过一次。顺序上应当先做第 10 条的演练（手动跑 `release.sh`/`rollback.sh`），再关掉人工闸门让第 7 条成立。反过来做也做得出来，只是那一刻你的自动部署没有任何退路——这正是要在演练里补的东西。

**第 9 条横跨三个阶段**，因为密钥泄漏有三种入口：提交进历史（①的钩子拦格式、②的 CI 全量扫描拦漏网）、写进镜像层（③的 `.dockerignore` 与构建参数）、运行时注入（④的 `env_file` 与⑥的 Secrets）。只在其中一个入口做防护，另外两个照样能把它带出去。

## 不做什么

范围控制比功能列表更能决定这个项目能不能收口。以下五件在本章明确排除，每件都注明「什么时候才需要它」：

- **不上 Kubernetes、不加多实例。** 单机 Docker Compose 的容量上限远高于个人产品的第一年的实际需求；一旦上多实例，`compose` 的默认网络、命名卷、`depends_on` 全部失效，你要重做的东西比得到的多。等你真的被单机的 CPU 或磁盘逼到墙角，再回来读[扩展性](/realtime/scaling-out)那一类问题。
- **不搭监控告警栈。** 本章只要求 `/healthz` 与 `RELEASES.txt` 两个判据能落到人眼。Prometheus、Grafana、告警路由是另一套技能树，塞进来会把这条主线挤掉。
- **不做蓝绿与滚动发布。** [发布与回滚](/devops/release-and-rollback)已经讲清单机 Docker 上「蓝绿」能做到什么程度；单机做不到的事，配置写不出来就不是你的责任范围。
- **不动数据迁移工具链。** 本章只要求你写出一条「旧版本还能接受」的迁移（expand 那一半），工具用法沿用[迁移与版本管理](/database/migrations)与[Prisma 深入](/data-storage/prisma-deep-dive)。
- **不在演练里制造真实数据损失。** 演练用的坏版本必须是「起不来」或「健康检查不过」这种**可逆**故障，而不是删表。想验证数据层退不回去，在开发库上做，别在生产库上做（原因见第 8 阶段的风险边界）。

## 交付形态与目录结构

链路上的每个文件都要能被追溯到某一章的产出。下面这套目录是本主线的形状：前端构建产物交给宿主机 Nginx 直接服务，后端跑在容器里，Nginx 反代到 `127.0.0.1:3000`——这是[部署到 VPS](/devops/deploy-to-vps)第 3 层那份配置的形状。[Docker Compose、卷与网络](/devops/docker-compose)里那个 `proxy` 服务是另一种形态（全容器、`nginx:1.27-alpine` 也归 Compose 管）；**两种不要混用**，否则宿主机 Nginx 与容器里的 Nginx 抢 80 端口，报错长相是 `address already in use`。本章主线用前者：证书续期、`nginx -t`、reload 这三件事在宿主机上做，链路最短。

```text
myblog/
├─ .githooks/                 # 第 3 章实测的零依赖钩子（commit-msg / pre-commit / pre-push）
├─ .github/workflows/
│  ├─ ci.yml                  # 第 5 章那份 name: CI（push 与 pull_request 触发）
│  └─ release.yml             # 第 5 章那份 name: Release（构建镜像 + 部署到 production）
├─ apps/web/                  # 前端
│  ├─ Dockerfile              # 只构建静态产物（多阶段：build → 产物给 Nginx 目录或 nginx 镜像）
│  └─ …
├─ apps/api/                  # 后端
│  ├─ Dockerfile              # 第 6 章的多阶段：AS build 装依赖构建 → 运行层只带 prod 依赖
│  ├─ healthcheck.js          # 第 6 章 HEALTHCHECK 里那行 CMD node healthcheck.js 的脚本
│  └─ src/…
├─ deploy/
│  ├─ compose.yaml            # 第 7 章的开发形态（含 build 与代码卷）
│  ├─ compose.production.yaml # 第 8 章的 overlay：ports 清空、restart: always、image 用 IMAGE_TAG
│  ├─ nginx/app.conf          # 第 8 章第 3 层：/.well-known 在 301 之前、四个 proxy_set_header
│  ├─ deploy.sh               # 第 8 章那条命令的部署脚本
│  ├─ release.sh              # 第 9 章：闸门 → 部署 → 就绪探测 → 记 RELEASES.txt → git tag
│  ├─ rollback.sh             # 第 9 章：从记录读 previous → 先 pull 再 up
│  ├─ lib-semver.sh           # 第 9 章：semver_parse / semver_cmp / release_gate
│  └─ RELEASES.txt            # 发布记录，previous 的唯一来源
├─ .env.example               # 只列键名与用途，值一律为空；真 .env 在 .gitignore 里
└─ package.json               # scripts: lint / format:check / type-check / test
```

`.env.example` 与 `.env` 的分工在第 4 阶段会真的用到：**键名进仓库、值不进**。新人（和三个月后的你）靠 `.env.example` 知道要准备哪七个变量；靠[环境变量与配置](/frontend-engineering/env-and-config)的机制知道它们分别从哪儿注入。

## 整条链路的形状：五个交接点

```text
   你                GitHub（Actions）                     你的 VPS
┌──────┐  push   ┌──────────────┐   绿 + 闸门通过   ┌──────────────────┐
│ 本地 │ ──────▶ │ ci.yml       │  ───────────────▶ │ release.yml 的   │
│ 分支 │  PR     │  lint/test/  │                   │ deploy job：     │
└──────┘         │  build 镜像  │   红 → 停在原地   │ pull → up -d →   │
   ▲             └──────┬───────┘                   │ 探 /healthz →    │
   │ 改到绿为止          │ 必需状态检查               │ reload nginx     │
   │                   ▼                           └────────┬─────────┘
   │            ┌──────────────┐                            │ 失败
   └────────────│ 保护分支拦住 │◀── 绿灯 ≠ 允许合并          ▼
      合并       └──────────────┘                    四层分诊 + rollback.sh
```

| 交接点 | 上游交出什么 | 下游凭什么开始 | 断了会是什么长相 |
| --- | --- | --- | --- |
| ① → ② | 一笔符合约定的提交、一个 PR | Actions 被事件触发，workflow 文件被读进去 | 完全没有检查：文件放错目录、事件不匹配（`paths` 与 `branches` 要同时满足） |
| ② → ③ | 全绿的必需检查 | 你（或合并按钮）允许 `main` 前进 | 明明绿了却说不满足：检查名与实际报的名字对不上，矩阵 job 需要 `gate` 汇总 |
| ③ → ④ | 一个带规范版本 tag 的镜像、digest 已记录 | Compose 按 `image: …:${IMAGE_TAG:?…}` 拉到镜像 | `latest` 导致「重跑部署却没换代码」；tag 已重推导致新旧不一致 |
| ④ → ⑤ | 三个服务 `Up (healthy)`、容器内 `/healthz` 有版本号 | 反代拿得到后端 | 首页 200、接口 502：`proxy_pass` 指向的端口没映射，或四个 header 少写 |
| ⑤ → ⑥/⑧ | 域名 + 有效证书 + HTTP 301 | 部署脚本能用 `curl -sf` 自检 | 证书签不下来（`/.well-known` 被 301 吞了）；时间不对导致校验整批失败 |

**这张表就是本章的考点。** 每一行的「下游凭什么开始」都必须是一个**能被机器读到的信号**——退出码、状态字符串、响应码、记录行——不是「我看了一眼觉得正常」。九章里反复出现的那条主张（[测试体系](/devops/testing)：测试的产物是失败判据，不是跑过一遍）在这里升到链路级别：**每个交接点的产物必须是一个判据，否则下游无法信任上游。**

## 阶段 ① 仓库、分支与提交约定

输入是本地代码，交出的是「可被机器强制的约定」。第 1～3 章在这里落成三件具体的事：

```bash
# 一次性设置（实测机制见第 3 章：core.hooksPath 是取代而非叠加）
git config core.hooksPath .githooks        # 让仓库里那三个脚本真的生效
git remote add origin <你的仓库地址>
git push -u origin main
# 自查提交历史是否合规（第 3 章给的筛法）
git log --no-merges --pretty='%s' | grep -vE '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?: '
```

最后那条 `grep -v` 输出为空才算过；非空的那些行就是将来 changelog 里读不懂的条目。**为什么要在本机先跑一遍**：客户端钩子对 `--no-verify` 无解是第 3 章实测过的天花板，所以服务端还得再拦一次（阶段 ② 的 `commitlint --from .. --to HEAD`，未在本机验证，规则号与默认值以官方文档当前版本为准）。

分支策略按最小可用写死：`main` 永远是可发布状态；功能在 `feat/*`、修复在 `fix/*`；只允许通过 PR 合并进 `main`，且 PR 必须等必需检查绿。GitHub 上的保护分支设置本域没有账号，属「按第 2 章操作路径执行、本章未验证」的那类步骤；如果你按学习路径走，就在本地裸仓库里用 `git push` 的拒绝规则模拟一次非快进失败——第 2 章已经实测过这条路。

## 阶段 ② CI 闸门：先有判据，再谈自动化

这一步唯一的产出是「红/绿」这个信号，不部署任何东西。第 5 章那份 `ci.yml` 在这里补成完整形状，四个 step 各对应一章的承诺：

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
permissions:
  contents: read          # 指定任一权限，其余自动为 none（官方规则）
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: npm }
      - run: npm ci                          # 严格按锁文件装，别用 install
      - run: npm run lint && npm run format:check
      - run: npm run type-check
      - run: node --test                     # 第 4 章：包根无参数才认全部 *.test.mjs
      - run: npx --no-install commitlint --from origin/main --to HEAD   # 未在本机验证
  gate:
    needs: verify
    runs-on: ubuntu-latest
    steps:
      - run: echo "汇总检查名固定为 gate"     # 必需检查只勾这个，避免矩阵后缀对不上
```

三条判据按顺序成立：**workflow 被识别**（Actions 页面能看到这条 run）、**job 被创建并跑完**（`verify` 有日志）、**退出码为 0**（绿）。第 5 章的失败定位四层在这里直接用：文件没读进去、runner 标签拼错、step 自身失败、跑绿了但检查名对不上，四种长相完全不同。

密钥在这一阶段的责任只有一条：**扫描**。把 `gitleaks` 一类工具放进 CI 全量跑一次（第 3 章说过，钩子只扫暂存内容，完整性只有 CI 全量能保证），它是第 9 条验收标准的兜底。注意它属于「读到全部 secrets 的位置」——第 5 章讲过写权限可读全部 secrets，所以扫描 job 的 `permissions` 必须是 `contents: read`，且不要把环境 secrets 传给这个 job。

## 阶段 ③ 镜像：两份 Dockerfile 与一个不可变的 tag

输入是绿了的 `main`，交出的是 `registry.example.com/myblog/api:1.3.0` 这样**带规范版本号、不可重推**的镜像，以及它的 digest。后端按第 6 章的多阶段形状写：

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci                       # 构建层需要 dev 依赖（测试、类型检查、构建脚本）
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev            # 运行层只带生产依赖
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000                      # 只是元数据，不发布端口（官方原话）
HEALTHCHECK CMD node healthcheck.js
CMD ["node", "src/index.js"]     # exec 形式，node 才是 PID 1，收得到 SIGTERM
```

`.dockerignore` 至少写 `node_modules`（官方推荐的最小内容），否则宿主机依赖被复制进去会盖掉容器里刚装好的那套。前端那份 Dockerfile 只需要构建静态产物——它的运行层是 `nginx:1.27-alpine` 或直接产出一个 `dist/` 目录给宿主机 Nginx 用，取决于你在目录结构一节选了哪种形态。

tag 规则是第 9 章三条判据之一，这里落成一条纪律：**`IMAGE_TAG` 只收规范形式的版本号（`1.3.0`），永远不传 `latest`**。理由不是风格：`latest` 让「回滚」这条命令变成空操作（引用没变 → 配置与镜像都没 changed → 按官方 `up` 的语义不重建容器），而且带版本 tag 且本机已有时 Compose 不会自动重拉。发布记录里同时写 digest，它是事后证据——证明服务上跑的到底是哪次构建。

**第一次上线建议在服务器上 `build`**（第 8 章那条建议在本章仍然成立），此时每个失败都落在你能看懂的一层上；等 ①②④⑤ 都手动成功过，再把构建挪进 CI（阶段 ⑥）。「没手动成功过的流程不要自动化」这条纪律在本项目里的具体形式就是：阶段 ⑥ 之前，你已经能说出每条命令失败时会报什么。

## 阶段 ④ Compose：三服务职责、就绪顺序与数据

主文件描述「服务之间是什么关系」，overlay 只描述「生产与开发的差异」，不改主文件：

```yaml
# compose.yaml（开发形态，第 7 章）
services:
  app:
    build: ../apps/api
    image: myblog/app:0.1.0
    ports: ["127.0.0.1:3000:3000"]   # 端口加引号：base-60 会把 80:00 算成别的数
    environment: { DATABASE_URL: postgres://appuser:secret@db:5432/app }
    depends_on:
      db: { condition: service_healthy }   # 长语法，短语法挡不住那个窗口
    volumes: [uploads:/data/uploads]
  db:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: appuser, POSTGRES_PASSWORD: secret, POSTGRES_DB: app }
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U appuser -d app"]
      interval: 10s
      start_period: 30s
      retries: 5
    volumes: [db-data:/var/lib/postgresql/data]
volumes:
  db-data:
  uploads:
```

三个服务的职责一句话说清：**`app` 只有业务进程**，不知道自己对外用什么域名；**`db` 只有数据**，靠命名卷活过容器重建；**`proxy`（或宿主机 Nginx）只有流量入口**，证书与跳转都在它身上。容器之间**用服务名而不是 localhost**——`app` 连 `db:5432`，因为每个服务都会把名字注册进 Compose 建的内部 DNS；`ports` 只决定宿主机能不能访问，跟服务间通信完全无关。这两条混淆是第 7 章列的第一类翻车。

生产 overlay 用第 8 章那份，本章只补一处**判据随之变化**的细节：overlay 里 `ports: []` 把应用对宿主机的映射彻底拿掉之后，第 8 章那条「服务器本机 `curl -I http://127.0.0.1:3000` 应拿到 200」就不成立了（推演：没有端口映射，宿主机回环上没有监听）。要么把这条判据放在上 overlay **之前**跑完，要么换成在容器内部测自己：

```bash
docker compose -f compose.yaml -f compose.production.yaml config >/dev/null   # 先看合成结果
docker compose -f compose.yaml -f compose.production.yaml up -d
docker compose ps                          # 三个服务都应是 Up (healthy)
docker compose exec app node -e \
  "fetch('http://127.0.0.1:3000/healthz').then(r=>r.text()).then(console.log)"  # 容器内测自己
docker compose exec app sh -c 'nc -z db 5432 && echo db-reachable'              # 连通性最小判据
```

`config` 的合成输出必须看一遍：变量注入对不对、有没有端口意外绑到 `0.0.0.0`（不写 host IP 就是 `0.0.0.0`，绕过宿主防火墙）。密钥的边界在这里划清：**数据库口令、JWT 密钥这类运行时秘密走 `.env`（服务器上的文件，不进仓库、不进镜像层），CI 需要的走 Secrets**；`DATABASE_URL` 写进 compose 的 `environment` 时引用变量名，不要把口令明文留在文件里——明文进了 Git 就是第 9 条验收标准失败，且必须轮换 + 改写历史。

## 阶段 ⑤ 域名、证书与反向代理

四层判据从上往下问，每层只回答自己那一个问题（第 8 章的整章结构就是这个）：解析对不对 → 端口通不通 → 容器在不在监听 → 证书对不对得上域名。本章把它们写成一张可打勾的表：

| 层 | 命令（在服务器或本机执行） | 通过判据 | 不通过时先查 |
| --- | --- | --- | --- |
| ① 解析 | `dig +short app.example.com` | 返回你的公网 IPv4 | 记录值、TTL、是否托管在另一个账号 |
| ② 端口 | `curl -I http://app.example.com` | 80 通且**期望 301** | 云安全组与服务器 `ufw` 是两道门，只放了 22 |
| ③ 监听 | `docker compose ps` / `curl -s http://127.0.0.1:3000/healthz` | 全部 `Up (healthy)`，healthz 带当前版本号 | 容器重启循环、应用绑的地址不是 `0.0.0.0` |
| ④ 证书 | `certbot certificates` | 域名对、有效期未临近、路径存在 | SNI 落到默认站、缺中间证书 |

Nginx 那份配置的关键顺序只有一条不能改：`location /.well-known/acme-challenge/` 必须写在 `return 301` **之前**，否则签发请求被跳走，CA 拿到的是你的首页而状态码一路 200——第 8 章实测过这个响应形态。四个 `proxy_set_header` 必须在同一层级写全（`location` 里写了一条，`server` 层其余的就失效，这是官方默认值 `Host $proxy_host` / `Connection close` 的反面），少一个的代价分别是：应用拿不到真实 IP、拿不到 scheme、`Host` 变成上游名、长连接被断。

续期没有邮件可等（到期提醒已关停），判据只能是定时器真的存在：`systemctl list-timers | grep -i certbot` 有输出，或 `certbot renew --dry-run` 手动演练通过。**先备份再动 Nginx 配置**是官方对 `--nginx` 插件的建议，且它提供 `certbot --nginx rollback` 回退自己改过的配置——这条退路要记在演练文档里，别到出事那天现找。

## 阶段 ⑥ 自动部署：一条 run 与一道人工闸门

前五个阶段都能手动跑通之后，才把它交给机器。第 5 章那份 `release.yml` 的骨架在这里补上三样东西：**审批闸门、并发唯一性、以及 secrets 的最小暴露面**。

```yaml
name: Release
on:
  push:
    tags: ["v*"]              # 由 release.sh 的 git tag -a 打出来（第 9 章）
  workflow_dispatch: {}       # 手动触发，用于回滚演练与「发某个已有版本」
permissions:
  contents: read
concurrency:
  group: production-deploy
  cancel-in-progress: false   # 部署到一半被取消会留下半套状态，这里宁排队不中断
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npm run build
      - run: docker build -t registry.example.com/myblog/app:${GITHUB_REF_NAME} ./apps/api
      - run: echo "${REGISTRY_TOKEN}" | docker login -u "${REGISTRY_USER}" --password-stdin
      - run: docker push registry.example.com/myblog/app:${GITHUB_REF_NAME}
  deploy:
    needs: build
    environment:
      name: production        # 引用环境：保护规则通过前 job 不开始，也拿不到环境 secrets
    runs-on: ubuntu-latest
    steps:
      - name: 部署到 VPS
        env:
          IMAGE_TAG: ${{ github.ref_name }}
        run: ./deploy/release.sh "$IMAGE_TAG"
```

`environment: production` 是本项目里「人工闸门」的实现方式。官方说明的机制（核实 2026-10-20，转述）：**工作流引用环境时，作业在该环境的所有保护规则通过之前不会开始；在保护规则全部通过之前，它也无法访问该环境定义的 secrets**。保护规则能做三件事——要求人工审批、延迟一段时间再起 job、限制哪些分支可以部署到这里。环境本身会显示在仓库主页，可以看部署历史。另有一条容易被忽略的配置：环境设置里 `deployment` 默认 `true`，设成 `false` 时等待计时器与必需审阅者仍然生效，但**不创建部署对象、不更新部署历史**（自定义保护规则的 GitHub App 会因此失败）。

这一节必须诚实标注：环境创建、审批人设置、分支策略这些操作在 GitHub 界面上，本域没有账号，**本章未验证操作路径**；上面那段机制描述来自官方文档，YAML 里的 `environment` 写法属示例。

密钥的三条原则在第 5 章给全了，这里只列本项目实际需要的最小集合，按「哪个 job 需要就只给谁」分配：

| 名称 | 用途 | 作用域 | 泄漏后果 | 轮换方式 |
| --- | --- | --- | --- | --- |
| `SSH_PRIVATE_KEY` | Actions 连服务器 | 环境 `production` | 等于交出整台机器 | 服务器改 `authorized_keys`，旧公钥即刻删除 |
| `DEPLOY_HOST` / `DEPLOY_USER` | 目标地址与用户 | 仓库变量（非 secret） | 无直接危害，但别塞进 secret 里 | 换机即改 |
| `REGISTRY_USER` / `REGISTRY_TOKEN` | 推镜像 | 环境 `production` | 能投毒镜像，下一次部署就是攻击 | 令牌有效期设短，定期重签 |
| `APP_ENV_*`（JWT 口令等） | 运行时配置 | **只在服务器上**，不进 Actions | 用户会话可被伪造 | 改 `.env` + 重启，同时通知依赖方 |

最后一行是本项目里最多人做错的地方：**运行时密钥不需要经过 CI**。把它们塞进 Secrets 只是让泄漏面从一台服务器扩大到「所有能读 secrets 的 workflow 与被攻破的第三方 action」——第 5 章的原话是单个 action 被攻破即可访问所有 secrets。Actions 需要的只有「怎么连上服务器、怎么推镜像」这两类。

## 阶段 ⑦ 上线后验证：把「我觉得好了」写成四行判据

部署脚本的退出码 0 不等于服务活着。第 8 章那条主张在这里变成阶段收尾的四条命令，顺序固定，任何一条不满足就进第 ⑧ 阶段而不是继续往前：

```bash
curl -sf https://app.example.com/healthz | head -c 200    # 只有应用会答这个路径，含当前版本号
docker compose -f compose.yaml -f compose.production.yaml ps   # 三服务 Up (healthy)，无重启循环
docker compose logs --since 10m app | tail -30             # 最后一行是你的 listening on :3000
tail -3 deploy/RELEASES.txt                                # current/previous 指针对得上
```

**首页 200 不代表应用活着**（静态兜底与 Nginx 默认页都会回 200），所以判据必须是 `/healthz` 这种只有后端会答的路径，并且响应体里带版本号——那正是你在阶段 ⑧ 里判断「退回成功没有」的锚点。日志侧只要求 `docker compose logs --since 10m` 里错误行没有变多；再深的日志功走在 [Linux 第 9 章 日志与故障定位](/linux/logs-and-troubleshooting)（尚未成文，缺口就写在这里，不假装已经覆盖）。

第 8 章 `deploy.sh` 那三条实测结论在这一阶段变成检查表：`VAR=$(失败命令)` 会让脚本退出，想继续得写 `|| { 兜底; }`；`if` 条件里的失败不触发退出；只写 `set -e` 拦不住管道左侧失败（`false | true` 在只有 `set -e` 时退出码 0 并把下一行执行了）。**`docker compose logs | grep ERROR` 没匹配到却当成功**就是这么来的——发布脚本里凡是走管道的判据，都要带 `pipefail`。

## 阶段 ⑧ 五分钟回滚演练：目标、顺序、判据与风险边界

这是十条标准里唯一一条「必须以失败为输入」的验收项，也是第 7 条敢去掉人工闸门的前提。演练的目的不是「证明回滚能成」，而是**测出你的退路有多慢**。

前置条件四项，缺一项就别开始：`RELEASES.txt` 里至少有两条 `current=` 记录（只剩一版时 `rollback.sh` 报 `no-previous`，这是第 9 章实测过的状态机分支）；服务器上有 current 与 previous 两个镜像且 registry 保留策略覆盖它们；通知渠道已经发出（哪怕收件人只有你自己）；数据库处于「本次改动是 expand 那一半」的状态——也就是说，**旧版本的代码还能接受新表结构**。

```text
T+0:00  故意部署坏版本：IMAGE_TAG=1.3.1（该版本启动即崩 / healthz 返回 500）
T+0:30  就绪探测失败，release.sh 自己喊停 → 立刻进回滚，不要先看日志
T+1:00  ./rollback.sh：从 RELEASES.txt 读 previous → docker pull previous → export IMAGE_TAG=previous → up -d
T+2:30  四条判据（阶段 ⑦）逐条跑：healthz 版本号必须是 1.3.0，不是 1.3.1
T+3:30  写记录行：current=1.3.0 result=ready(…) 与一句「为什么 1.3.1 会坏」
T+4:30  确认坏版本没被删（它是排查线索），且没有顺手 git push --force
T+5:00  演练结束
```

成功判据只有三条，且必须是机器读数：**`/healthz` 返回的版本号等于 previous**、`docker compose ps` 三服务 `Up (healthy)`、`RELEASES.txt` 里新增了一行而不是改了旧行。5 分钟不是考核指标，是**计时起点放在「决定退回」那一刻**——很多人把「发现问题」到「决定退回」那段犹豫也算进去了，于是演练数字很好看，真出事时同样卡在犹豫上。

风险边界必须写进文档。**代码能退回，数据退不回去**：Prisma 官方现状是没有 `migrate down`，撤销方式是往历史里追加一条新迁移（「git revert 而不是 git reset」）；`db migrate` 执行破坏性操作前不询问。所以演练里唯一允许的「坏版本」是**不改表结构**的坏版本；一旦这次发布带了 contract 那一半（删列、改类型、加非空约束），回滚脚本救不了你，能救的只有备份——那是[备份与恢复](/database/backup-and-restore)的内容，本章只要求你在演练文档里写明「最近一次可用备份的时间点」。第二条边界：**不要用 `down -v`**。`docker compose down` 带 `-v` 会连命名卷一起删，`db-data` 就此消失，这是把回滚演练做成数据事故最快的路径。

## 没有 VPS 也能走完的部分，以及哪些环节必须有真实账号

学习路径与实践路径的分界不在「有没有钱」，而在**哪些判据只有真实服务才给出**。下表是本域的诚实边界：

| 阶段 | 没有 VPS / 没有 GitHub 仓库时能做到 | 必须有真实账号才能验的东西 |
| --- | --- | --- |
| ① | 本地裸仓库跑通 push/PR/非快进拒绝（第 2 章实测路线） | 保护分支界面、必需检查的实际勾选 |
| ② | 用 `node --test`、`npm run lint` 在本机拿到同样的退出码；`bash -n` 查 workflow 里的脚本 | workflow 是否被触发、runner 行为、检查名显示 |
| ③ | Dockerfile 写完做静态自查：指令顺序、`.dockerignore`、exec 形式 CMD（第 6 章用 Node 算过失效面） | 真实构建、层缓存速度、镜像体积 |
| ④ | 手写一份「就绪时间轴」推演：`pg_isready` 与 `service_healthy` 之间那段窗口 | `docker compose ps` 的 healthy 状态、卷持久化 |
| ⑤⑥⑦ | 配置与脚本写完，逐条说明判据与失败长相 | DNS、证书、Actions 审批、SSH 部署 |
| ⑧ | 用第 9 章那套 shell 状态机在本机演练「目标不存在 / 只剩一版 / 字典序删错」三支 | 真机 5 分钟计时 |

也就是说：**十条验收标准里，第 1、2、3、4、5、10 条在学习路径下能做出八成证据，第 6、7、8、9 条只能做成「可复核的推演」**。这不算没完成本章——本域的主张从来是「先能把链路讲清楚，再谈把它跑通」。但请明确写一句：学习路径的产出**不能**当成「已经上线过」的凭证。

## 验收清单（逐条怎么留证据）

```text
[ ] ① 仓库托管 + 保护分支：设置页截图或 API 输出，附一个真实 PR 链接
[ ] ① 提交约定：git log --no-merges --pretty='%s' 无输出；CHANGELOG.md 有版本号小节
[ ] ② CI 强制检查：那条 run 的原始日志（lint/type-check/test 三段各一行退出码）
[ ] ② API 测试在 CI 跑：pass/fail 计数出现在日志里，且曾有一次是真红
[ ] ② 密钥扫描：CI 全量扫一次为 0 命中；git log -p -S <旧密钥> 能证明历史里没有
[ ] ③ 两份 Dockerfile 进仓库；image ls 一行显示体积与 tag（规范形式，非 latest）
[ ] ④ compose ps：三服务 Up (healthy)；config 合成结果里无 0.0.0.0 意外绑定
[ ] ⑤ dig / curl -I（301）/ certbot certificates / renew --dry-run 四条读数齐全
[ ] ⑥ 一次 run 的 job 图：build → deploy（含审批停留），环境 secrets 只在 deploy 可见
[ ] ⑦ 上线后四条判据的读数贴在 PR 或发布记录里
[ ] ⑧ 演练记录：T+0 到 T+5:00 的时间戳、成功判据三项、坏版本未被删、备份时间点写明
```

最后一条 ⑧ 里那句「坏版本未被删」值得单列：**清镜像的脚本必须用比较器（`semver_cmp` 或 `sort -V`），且不能删 current 与 previous**——第 9 章实测过 `keep=2` 留下哪三个版本，也实测过字典序会把 `1.10.0` 当最老的。清理脚本在演练之后单独跑一次，并把它删掉的那几行列进记录。

## 常见翻车点

**1. 现象：PR 里没有任何状态检查，绿/red 都不知道去哪看。** 原因：workflow 文件不在 `.github/workflows/`、或事件与分支/路径不匹配（`branches` 与 `paths` 要同时满足）、或文件里有语法错导致根本未被识别。确认：Actions 页面完全没有这条 run → 文件层面；有 run 但 `verify` 不出现 → job 层面。修法：先让最简单的 `on: push` + 一个 `echo` step 跑起来，再逐层加。这一条是第 5 章「四层往下缩小范围」的第一层。

**2. 现象：检查全绿，GitHub 仍说「必需状态检查未通过」。** 原因：勾的名字与实际上报的名字不一致（矩阵展开后带参数后缀），或必需检查指向了一个被 `if` 跳过的 job——「跳过」也算过关是反过来的坑。确认：PR 页面检查列表里的实际名字。修法：加一个名字固定的汇总 job（本章 `gate`），必需检查只勾它；同时让测试 job 无条件跑。

**3. 现象：部署脚本退出码 0，站点却起着旧代码。** 原因：`IMAGE_TAG` 传了 `latest`（或重推了同一个 tag），引用没变 → 配置与镜像都没 changed → 官方 `up` 的语义不重建容器；带版本 tag 且本机已有时也不会自动重拉。确认：`RELEASES.txt` 里两次记录的 digest 是否相同。修法：tag 只收规范 SemVer、坏版本发新号（`1.3.1` 而不是重推 `1.3.0`）、需要重拉就显式 `pull`。

**4. 现象：`db` 起了，`app` 报 `ECONNREFUSED`，或者第一次能连、重启后连不上。** 原因：`depends_on` 用了短语法（官方：启动时不等「ready」，只等「running」），或连接串写了 `localhost:5432`（容器里 localhost 是它自己）。确认：`docker compose ps` 看 db 是否 healthy、`exec app sh -c 'nc -z db 5432'`。修法：给 db 写 healthcheck、app 用 `condition: service_healthy`，同时应用侧保留重试——健康门槛只覆盖启动那一刻。

**5. 现象：证书签不下来，`curl` 到 ACME 挑战路径一路 200，内容是你的首页。** 原因：全站 `return 301` 把 `/.well-known/acme-challenge/` 也跳走了，CA 跟的是跳转。确认：直接 `curl -i http://app.example.com/.well-known/acme-challenge/test` 看响应体。修法：把那条 `location` 写在 301 之前（第 8 章那份配置）。**反复重试会撞 CA 限流**，一周内签不出来是限流而非配置——这正是本章把 certbot 额度单独列进风险边界的原因。

**6. 现象：接口全 502，但首页能打开。** 原因：宿主机 Nginx 解析不到容器服务名（`app:3000` 只在 Compose 网络里有效，宿主机上要用 `127.0.0.1:3000`），或 overlay 的 `ports: []` 把映射拿掉之后仍按宿主机端口写 `proxy_pass`。确认：分诊顺序——服务器本机 `curl 127.0.0.1:3000` → `docker compose ps` → Nginx error log。修法：两种形态选一种并写进文档；用 overlay 时把 `proxy_pass` 与判据一起改（本阶段那条 `exec app` 自测就是为此）。

**7. 现象：回滚跑到 `pull` 那步失败，或指针切到一个不存在的 tag。** 原因：要退的 tag 不在 registry（保留策略把它清了），或脚本没先验证目标存在。确认：`git ls-remote --tags`（第 2 章用它判断 tag 推没推上去）与 registry 列表。修法：`rollback.sh` 先 `pull` 成功再 `up`；保留策略覆盖 current + previous；`previous` 只从 `RELEASES.txt` 读，不靠记忆。

**8. 现象：Actions 里 deploy job 停在「等待审批」，你以为卡住了。** 这不是故障：环境挂了必需审阅者时，官方语义就是**规则全部通过前作业不开始、也拿不到环境 secrets**。要么你去点批准，要么在这个环境上把审批摘掉（前提是你已经按第 ⑧ 阶段真演练过）。把它误当故障去删并发组或重推 tag，就会同时踩翻车点 3 与 7。

## 练习

<Exercise title="练习 1 · 把这条链画出来并标出判据" difficulty="基础">

不看本章那张图，凭记忆画出「一笔提交 → 用户看到新版本」的完整链路：标出 GitHub 与 VPS 两边各自跑了什么、哪几个地方需要人点头、每个交接点交出什么信号。然后回答两个追问：如果 `verify` 红了，你的服务器上会发生什么？如果 `deploy` 成功但 `RELEASES.txt` 没写进去，下次回滚会发生什么？

<template #answer>

链路形状是：本地 `feat/*` 提交 → push → PR → `ci.yml` 的 `verify` 与 `gate` → 保护分支允许合并 → `main` 前进 → `release.sh` 打 tag → `release.yml` 的 `build`（推镜像、记 digest）→ `deploy`（环境审批通过后 SSH 到服务器）→ 服务器 `pull` → `up -d` → 四条上线判据 → 记录行。需要人点头的地方有两处：合并 PR、环境审批（若开了必需审阅者）。

`verify` 红了：服务器上**什么都不发生**。这是整条链最重要的一条性质——闸门在 GitHub 侧，不在你机器上。反过来说，如果你的 `verify` 红着而线上还是换了代码，那说明部署走的是另一条路径（手敲 `deploy.sh`，或 `release.yml` 没等必需检查），必须查那条路径。

记录没写：`previous` 的来源就断了。`rollback.sh` 从 `RELEASES.txt` 倒数第二个 `current=` 读目标；记录缺失时它只能读到一个错值或报 `no-previous`，那一刻你的「5 分钟退路」实际不存在。所以记录写失败必须让发布脚本自己失败（`set -e` 下追加写失败就退出），而不是「部署成功、日志没落盘」这种看起来无害的组合。

</template>

</Exercise>

<Exercise title="练习 2 · 故意把这四种配置写错并预测长相" difficulty="进阶">

本章的四个配置各改一处，写出预期报错与它属于哪一层（配置层面 / 服务层面 / 数据层面 / 流程层面）：① 把 overlay 的 `ports: []` 删掉但保留宿主机 Nginx；② 把 `/.well-known` 那条 `location` 移到 `return 301` 之后；③ 把 `depends_on` 写回短语法并删掉 db 的 `healthcheck`；④ 把 `deploy` job 的 `environment` 改成 `permissions: contents: write` 且不给 `pull_request` 加限制。

<template #answer>

① 端口映射回来了：应用被暴露在宿主机上（写 `"3000:3000"` 时是 `0.0.0.0`，绕过 `ufw` 之前的那道认知防线），服务层面——功能仍正常，但攻击面变宽。判据：`docker compose config` 的合成输出 + 从公网 `curl` 你的 IP:3000。

② 证书签发失败：ACME 请求被 301 带走，`curl -i` 到挑战路径拿到 200 但响应体是首页。配置层面（且是「状态码骗人」那一类）。修法见第 ⑤ 阶段；连试几次还会撞 CA 限流，那时候即使改对也要等额度窗口。

③ `app` 起在 `db` 之前：报 `ECONNREFUSED`（端口没人听）或连上了但库还没初始化完（报关系不存在）。服务层面。第 7 章本机实测的那个 572ms 窗口就是这段；`pg_isready` 通过也只表示能接受连接，不等于你的迁移跑完了，所以应用侧重试仍然要保留。

④ 这是流程层面的漏洞，也是最贵的一种：写权限的 workflow 可读全部 secrets，而 `pull_request` 事件的运行来自别人的代码；`environment` 摘掉之后审批闸门也不存在了。两条纪律因此必须并列（第 5 章的注入一节给了可执行的同构实验）。判据：`permissions` 段里是否出现 `write`、环境是否还挂必需审阅者、以及 `pull_request_target` 是否在同一仓库里跑着带 secrets 的 job。

</template>

</Exercise>

<Exercise title="练习 3 · 五分钟窗口里你只能做三件事" difficulty="挑战">

演练时 T+0:30 就绪探测失败，你手上有：`rollback.sh`、`docker compose logs`、`nginx -t`、`RELEASES.txt`、坏版本的 Dockerfile、`certbot renew`。规定：不许在窗口内开始调试坏版本。请选出这三件事并说明顺序与每件事的判据；再回答为什么「先看 30 秒日志」是这类演练里最常见的失败原因。

<template #answer>

按顺序是：**① `rollback.sh`**（判据：`pull` 成功、`up -d` 完成、`ps` 显示 healthy）；**② 阶段 ⑦ 那四条判据**（判据：`/healthz` 版本号等于 previous，而不是等于 200）；**③ 写 `RELEASES.txt` 记录行**（判据：新增一行含 `current=` 与 `result=`，并附一句现象描述）。`RELEASES.txt` 是读 `previous` 的来源，先读它属于第 ① 步内部动作而不是独立一步。

不许先翻日志的理由很实际：**用户可感知的故障时长只由「什么时候把指针切回去」决定**，而你从 `logs` 里 30 秒能得到的信息量，几乎不足以定位一个刚上线就崩的版本。看日志的正确时机是回滚完成之后——那时线上已经恢复，坏版本还在（不许删），你有一个完整的现场。第 9 章那句「没演练过的 previous 不算退路」在这里的操作性含义是：**在压力下先做可逆动作，把不可逆动作（调试、改配置、重装、`down -v`）留在恢复之后**。最常见的失败正是「我就看一眼」，然后第 4 分钟还在看，回滚从来没被执行过。

</template>

</Exercise>

## 官方文档与延伸阅读

站内衔接：本章不重复任何一章的机制，只引用它们——[Git 基础](/devops/git-basics)、[Git 协作](/devops/git-collaboration)、[代码规范与提交约定](/devops/code-standards)、[测试体系](/devops/testing)、[CI/CD 与 GitHub Actions](/devops/ci-cd)、[Docker 基础](/devops/docker-basics)、[Docker Compose、卷与网络](/devops/docker-compose)、[部署到 VPS](/devops/deploy-to-vps)、[发布与回滚](/devops/release-and-rollback)、[领域首页](/devops/)；跨域依赖[服务部署：Docker、优雅关闭与配置](/backend/docker-and-shutdown)、[迁移与版本管理](/database/migrations)、[备份与恢复](/database/backup-and-restore)、[环境变量与配置](/frontend-engineering/env-and-config)、[SemVer 与锁文件](/frontend-engineering/semver-and-lockfile)。

- [使用 GitHub Actions 进行部署（Environments 与保护规则）](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments) —— 核实阶段 ⑥「引用环境时作业在保护规则全部通过前不开始、也拿不到环境 secrets」，以及 `deployment: false` 的行为差别。**正文措辞为官方页面转述，非逐字原文。**
- [Deployments and environments 参考页](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) —— 保护规则的三种能力（人工审批、延迟、限制分支）与自定义规则由 GitHub App 提供。
- [Compose 文件参考](https://docs.docker.com/compose/compose-file/05-services/) —— `healthcheck` 与 `HEALTHCHECK` 同默认值、`depends_on` 的三种 `condition`、`ports` 的引号与 base-60 告警、不写 host IP 即绑 `0.0.0.0`。
- [Compose 工作流（含生产 overlay 与单服务重部署）](https://docs.docker.com/compose/) —— `config` 先看合成结果、`--no-deps` 防下游被重建、官方生产改动清单三条（移除代码卷绑定、`restart: always`、加日志类服务）。
- [Nginx 反向代理模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) —— `proxy_set_header` 的默认值与继承规则，阶段 ⑤ 那四个 header 的依据。
- [Certbot 文档](https://eff-certbot.readthedocs.io/) —— `--nginx` 插件建议先备份、`certbot --nginx rollback`、`renew` 与 `--dry-run` 的语义（**本章未执行任何 certbot 命令**）。
- [Conventional Commits 规范（中文）](https://www.conventional-commits.org/zh-hans/) 与 [SemVer 中文](https://semver.org/lang/zh-CN/) —— 阶段 ①③ 的格式与版本号依据；前者只规定信息怎么读，不规定工具。
- [Prisma 迁移文档](https://www.prisma.io/docs) —— 阶段 ⑧ 的数据边界：没有 `migrate down`，撤销靠追加新迁移；`db migrate` 破坏性操作不询问（**具体页面路径与措辞以该站当前版本为准，本章未重新核实**）。

## 下一章

devops 到这里是一条完整的线了：第 1～3 章把「记忆」变成仓库里的约定，第 4 章给出「什么算坏」的退出码，第 5 章把那把尺子交给 GitHub 的机器，第 6～7 章把运行环境本身写成代码，第 8 章第一次把它推上公网，第 9 章处理第二次上线和第一次出事，本章把十条标准挂回这九个环节上，并只要求一件事——**每个交接点的产物都是机器能读的判据**。你的缺口现在很明确：日志功只到 `--since 10m` 这一层，服务器安全加固与系统层排障还没有专门一章；数据侧的备份恢复、连接池与慢查询在别的领域。

下一站是 [Linux](/linux/)：本域反复引用它却没有被本域讲透的两块——`journalctl` 与系统日志的分诊、服务器安全加固——正好是它尚未成文的两章，加上它自己的阶段项目（从零接管一台 VPS）。想清楚「流水线红了而服务器还活着是哪一层的问题」，就得能在系统层读数。全站学习顺序与各领域该什么时候学，见[学习路线图](/guide/roadmap)；本域十条验收标准里第 10 条之外的所有真实账号相关步骤，都等你有了服务器与域名之后再回来打勾。
