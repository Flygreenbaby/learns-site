# 服务部署：镜像里谁收信号，优雅关闭那几秒到底在等谁

上一章把慢操作移出了请求主链路：上传落盘再转对象存储，作业进队列由 worker 慢慢做。代价是同一件事——**进程不再只欠「当前这个请求」，它还欠着一批没跑完的作业**。于是发布时最贵的问题浮出水面：容器被停掉那一刻，在途请求会不会被撕断，队列里那条作业做到一半去哪了，`docker stop` 之后新实例能不能立刻占住同一个端口。

三个真实故障形态。**发布窗口里 502**：LB 还在往旧容器转发，旧容器已经开始退出。**`docker stop` 卡满 10 秒**：信号根本没送到 Node——镜像里跑的是 `sh -c node server.js`，PID 1 是 `sh`，它收信号不退，Node 是 PID 8 没人通知它，最后 Docker 补一发 SIGKILL。**改一行代码重装所有依赖**：`COPY . .` 写在 `RUN npm ci` 前面，缓存没命中。

后两条是**「谁来接收信号」和「关闭顺序怎么排」**的问题，不开 Docker 就能测。本章后半部分就是这样测的（Node v25.4.0 / Windows 10，`node:http` + `server.close()` / `closeAllConnections()` + 信号监听 + 超时兜底），把「在途请求跑完 / 被强杀 / 端口何时释放」三组数字跑了回来；前半部分逐条对官方文档核实，标为未在本机验证。

## `docker stop` 到进程消失之间发生了什么

停容器是两步：先向**容器 PID 1** 发 `SIGTERM`，宽限期（`-t`/`--time`，默认 10 秒）到点还没退就补一发 `SIGKILL`——后者由内核回收，进程没机会执行任何代码。要点是：**这 10 秒是编排器给的预算，不是你关闭流程需要多久**；排空链路要实际需要 12 秒，就得把 `-t` 抬到 15 以上，否则最后一段一定是 SIGKILL。

<Callout type="unverified" title="本章 Docker 命令与输出未在本机执行">

本机（Windows 10 x64）没有安装 Docker，只有 Node v25.4.0。下面所有 Dockerfile 与 `docker` 命令都只对照官方文档核对过语义，**没有构建过镜像、没有跑过容器**。每条都给了「敲什么」和「预期看到什么」，请在有 Docker Engine 的机器上按后文「从本地构建到上线」那节的顺序自己验。

</Callout>

## 多阶段构建：最终镜像里只有最后一阶段的产物

多阶段的价值不是「装完再删干净」，而是**让装齐这件事根本不进最终镜像**：编译工具链、devDependencies、源码、构建缓存留在构建阶段，只有生产 `node_modules`、产物和入口被 `COPY --from=` 搬进运行阶段。

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

两个容易漏的点：**`package.json` 也要拷进运行阶段**（很多库读它拿包名版本，Node 解析 `"type": "module"` 也依赖它）；**`npm ci --omit=dev` 与「先 `npm ci` 再 `npm prune --omit=dev`」不等价**——前者根本不装 devDependencies，没有构建步骤时选它更省，后者只在确实需要 TypeScript 或打包器时才有意义。本站骨架是纯 `.mjs` 零依赖，删掉 `build` 阶段、把两个 `COPY --from` 换成 `COPY src ./src` 就够了。

预期输出（`docker build`，未在本机验证）：步骤行形如 `=> [ 2/10] RUN npm ci`，末尾是 `=> naming to docker.io/library/myapi:0.1.0 done`；`docker images` 的 `SIZE` 给几 MB 增量。

### `.dockerignore`：先排除，再谈缓存

构建上下文（build context）是你执行 `docker build .` 时**整个上传给 daemon 的目录**。`node_modules`、`.git`、日志都算体积，更糟的是它们参与缓存指纹——本地装过一次依赖，`COPY . .` 的校验和就变了。

```text
node_modules
.git
Dockerfile*
.dockerignore
*.log
.env
.env.*
dist
coverage
.scratch
*.sqlite
.vscode
```

`dist` 也要排除：它在容器内构建，拷进本地产物只会造成「用了旧产物」这种最难查的错。**`.env` 必须在里面**——密钥进镜像有去无回，`docker history` 与 `docker save` 都留底。

## 层顺序决定缓存命中

每条 `COPY`/`ADD`/`RUN` 生成一层，缓存判定**顺序敏感**：某层失效，它之后所有层全部重建。

| 写法 | 改一行源码 | 改 `package-lock.json` |
| --- | --- | --- |
| `COPY . .` → `RUN npm ci` | 依赖层重建 | 依赖层重建 |
| `COPY package*.json ./` → `RUN npm ci` → `COPY . .` | 依赖层命中 | 依赖层重建 |

`WORKDIR`/`ENV` 不产文件层，但占缓存位置。

## `node:slim` 与 `node:alpine`：差的是 libc，不是大小

`node:20-slim` 是 Debian minimal + glibc + `apt-get`；`node:20-alpine` 是 Alpine + musl libc + `apk`，通常再小一截。真正的差别不是大小而是 **libc**：prebuilt 二进制按 glibc 打包，musl 上可能没有对应产物，`bcrypt`、`sharp`、`better-sqlite3`、`argon2` 这类要编译 C++ 的包会回落到源码编译，得补 `apk add --no-cache python3 make g++`（同层清掉）。另一个差异点是 DNS：musl 的解析与 glibc 的 `getaddrinfo` 在搜索域、IPv6 上表现不完全一致，排障时别把它当成应用 bug。CI 里把基础镜像**钉到 digest**（`node:20-slim@sha256:...`），基座变动就只能由你主动改文件触发；变体内容见 [Node.js 官方镜像](https://hub.docker.com/_/node)。本机没有 Docker，musl 下的具体失败形态**我没跑出过**；本站骨架只用 `node:crypto`、`node:http`、`node:sqlite`，零依赖零编译，两个基座都可选，口径仍是「默认 slim，确证无 native 依赖再上 alpine」。

## PID 1 不只是进程号：它默认不响应信号

内核对 PID 1 有特殊保护：**没为它显式注册处理逻辑的信号会被直接丢弃**；`kill -9` 例外（内核回收），`SIGTERM` 不例外。于是 `CMD` 的两种写法产生完全不同的进程树：

```dockerfile
CMD node server.js
# PID 1 = /bin/sh -c "node server.js"，PID 8 = node
# docker stop 时 SIGTERM 打给 sh：sh 不转发，node 完全不知道有人要停机

CMD ["node", "server.js"]
# PID 1 = node，SIGTERM 直达那个 server.listen 的进程
```

前者是 shell 形式，会起一个 shell 来解释命令。**「我明明写了 `process.on('SIGTERM')`，为什么线上不生效」，八成就是这一行**。需要预处理脚本就自己 `exec node server.js`，别裸着写。

exec form 解决了投递，还剩一件事没人管：**PID 1 不负责回收孤儿进程**。服务要是会 `child_process.spawn` 任何东西，孤儿进程没人 `wait()`，会攒成僵尸。两种办法：`docker run --init`（官方语义是**插入一个极小的 init 进程，负责信号转发与进程回收**），或镜像里 `ENTRYPOINT ["/usr/bin/tini", "--"]` 配 exec form 的 `CMD`。判据一条命令：`docker top myapi`，预期 node 的 PID 为 1，或 PID 1 是 `docker-init`/`tini` 而 node 是它的直接子进程。

## 优雅关闭的完整链路：六步，顺序不能换

信号只是有人按了门铃，真正的活在处理函数里：

```text
1. 停止接新流量    就绪探针先改报 503，让 LB 摘掉实例（此时端口仍在监听）
2. 关监听句柄      server.close()：不再 accept，在途的继续
3. 等在途请求跑完  排空期间轮询 closeIdleConnections() 回收空闲连接
4. 排空后台作业    给队列一个「不再入队 + 等当前跑完」的预算
5. 关数据库与资源  连接池 end()、句柄 close()、sqlite close()
6. 超时兜底        到点仍未排空 -> closeAllConnections() 后强制退出，非零码
```

两个反直觉之处都实测过。**第 1 步必须在 `close()` 之前**：`close()` 一执行监听句柄立刻释放，之后的新连接是内核层 `ECONNREFUSED`，客户端拿不到你写的那个 503；想表达「我要下了」就得留一段**预排空窗口**——先改就绪状态并开始回 503，等 LB 摘掉流量再 `close()`（第 15 章骨架里的 `PRE_DRAIN_MS` 就是这段）。**第 6 步不能只靠 `closeAllConnections()`**：它对 upgrade 后的 socket 无效（后文有实测），兜底必须是 `process.exit(1)`。

本机跑过的实现（`node:http`，Node v25.4.0）：

```js
const GRACE_MS = Number(process.env.GRACE_MS || 5000)
const PRE_DRAIN_MS = Number(process.env.PRE_DRAIN_MS || 400)
let phase = 'running' // running -> draining
let inflight = 0
let exited = false

function beginShutdown(why) {
  if (phase !== 'running') return console.log(`${why} 重复触发，忽略`)
  phase = 'draining'
  console.log(`[${why}] 开始排空 inflight=${inflight}`)

  const doClose = () => {
    server.close(async (err) => {
      clearInterval(sweep)
      console.log(`server.close 回调 err=${err ? err.code : 'none'} inflight=${inflight}`)
      await drainJobs(Number(process.env.JOB_DRAIN_MS || 1000))
      db.close()
      exited = true
      process.exit(0)
    })
    const sweep = setInterval(() => server.closeIdleConnections(), 200)
    sweep.unref()
    setTimeout(() => {
      if (exited) return
      server.closeAllConnections()
      console.log(`宽限 ${GRACE_MS}ms 已到，强制关闭 inflight=${inflight}`)
      process.exit(1)
    }, GRACE_MS)
  }
  if (PRE_DRAIN_MS > 0) setTimeout(doClose, PRE_DRAIN_MS)
  else doClose()
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => beginShutdown(sig))
```

请求侧要配一行判决，否则排空期间进来的请求会被照常处理完：`phase !== 'running'` 时对 `/api/*` 抛 503 + 稳定错误码 `E_SERVER_DRAINING`。

<Callout type="verified" title="排空链路本机实测（2026-10-18）">

环境：Windows 10 x64、Node `v25.4.0`、`node:http`，临时脚本在 `backend/.scratch/`（跑完已删）。**在途请求（handler 1200 ms）在 5000 ms 宽限期内跑完并返回 200**（客户端 1225 ms），随后关库、退出码 0；宽限期改 1000 ms、handler 9000 ms 时，在途请求收到 `ECONNRESET`（1134 ms）、进程 1170 ms 结束；后台作业在 `close()` 回调之后、`db.close()` 之前排空（`jobs.drain` 为 `drained:true waitedMs:0 total:1`）。

</Callout>

## 信号能不能送到：Windows 与 Linux 的差别必须实测

上面代码的第一道坎是「信号根本到不了监听器」。本机用 `child_process.spawn` 起服务、`child.kill('SIGTERM')` 发信号：

| 信号 | `detached` | 监听器被调用 | 触发到死亡 | 父进程观察到 |
| --- | --- | --- | --- | --- |
| SIGTERM | false / true | 否 | 10 / 17 ms | `{code:null, sig:"SIGTERM"}` |
| SIGINT | false / true | 否 | 11 ms | `{code:null, sig:"SIGINT"}` |
| SIGHUP、SIGBREAK | false / true | 否 | 10 ms | `{code:null, sig:"SIGKILL"}` |

八种组合**没有一个监听器被调用**。原因是 Windows 上没有真正的 POSIX 信号：`child.kill()` 走 TerminateProcess，进程被直接终结，Node 只能在退出状态里**伪造** `sig` 字段，SIGHUP/SIGBREAK 甚至被映射成 SIGKILL 语义。对照组里我改用 `child.send('shutdown')`（IPC）触发同一个 `beginShutdown()`，链路完整跑完、退出码 0——**这恰好证明关闭逻辑本身没问题，问题只在触发源能不能送到**。

两条结论。**注册监听不会报错，但不代表会被调用**：八个信号监听（含 SIGUSR1/SIGUSR2/SIGCONT/SIGWINCH）一个都没抛异常，`platform=win32` 下全部静默失效——「写了 signal 处理」和「signal 处理会执行」是两件事。**Linux 容器里 SIGTERM 真能到达**，不能因 Windows 测不通就删掉这段逻辑；本地用 IPC 或管理端点验证排空，真实信号投递留给 Linux/WSL/CI。

<Callout type="unverified" title="Git Bash 的 kill 是否等同真实 SIGTERM，本机没有定论">

我试过在 Git Bash 里对后台 Node 进程执行 `kill -INT <pid>`，但那次的 pid 取自日志字段而非 shell 任务表，命令报 `No such process`，**测试没有成立**。「Git Bash 的 kill 能不能让监听器跑起来」我没有结论，请勿当成实测；要验证请在 Linux/WSL 里 `kill -TERM $(pgrep -f server.js)`，看第一行排空日志有没有打。

</Callout>

## `server.close()` 的回调为什么 5 秒后才来：keep-alive 陷阱

本章最有价值的一个实测。同一段代码（在途请求 1200 ms、宽限 5000 ms），三种客户端条件下排空耗时差别极大：

| 场景 | `close()` 回调 | 进程退出 |
| --- | --- | --- |
| 默认 agent（keep-alive），只调一次 `close()` | **+5161 ms**（等到超时兜底才放行） | +5361 ms，码 0 |
| 同上，但排空期间每 200 ms 轮询 `closeIdleConnections()` | +1377 ms（响应完成 +1237 ms 后第一次轮询） | +1487 ms，码 0 |
| 客户端发 `Connection: close` | +1238 ms | +1342 ms，码 0 |
| 宽限 1000 ms、handler 9000 ms | +1155 ms（被超时兜底强关） | +1170 ms，码 0 |

机制：`server.close()` 要等所有连接都不再处于「正在发请求或等待响应」状态才回调，而**它对「调用之后才转为空闲的连接」不负责**——那条连接在 `close()` 时是忙的，响应完成后转为空闲，等待集合却没把它算成可关的。我确认了 `http.globalAgent.keepAlive === true`，这正是内部 `fetch` 与浏览器默认复用连接的后果。官方文档写着 v19.0.0 起 `close()` 会「在返回前关闭空闲连接」，我实测到的范围是**调用那一刻已经空闲的连接**：连接先空闲再调 `close()`，回调 1 ms 就来（同一脚本 31 ms 内干净退出）。

两条写法：排空期间轮询 `server.closeIdleConnections()`（实测把回调从 +5161 ms 提前到 +1377 ms，代价接近零）；把服务端空闲超时收紧（`keepAliveTimeout` 65 秒略大于 LB 典型的 60 秒、`headersTimeout` 大于它、`requestTimeout` 限制单请求总时长）。实测时 `keepAliveTimeout` 是默认 60 秒而宽限期只有 5 秒：**宽限期等不到连接自然超时，必须主动关。**

还有个坑：**`closeIdleConnections()` 与 `closeAllConnections()` 的返回值不是数字**——文档说是被关闭的连接数，实测两者都返回 `undefined`（日志里就是 `closed undefined`）。别拿它当计数、别写 `if (n === 0) done()`，用 `server.getConnections()` 或自己维护的 `inflight`。

## 端口何时真的释放：外部 26 ms，自己复用 765 ms

对同机重启（blue-green、`docker stop` 完立刻 `docker run`）这条很关键。实测时间轴：

```text
t+0ms    触发排空（inflight=1，/slow 还剩约 1200ms）
t+27ms   外部新建连接探测该端口 -> ECONNREFUSED
t+26ms   外部新进程 bind 该端口 -> 立刻可用
t+765ms  同一进程内部再 listen 同端口 -> 成功
t+1242ms 在途请求响应完成
t+5161ms close() 回调（超时兜底强关）
t+5361ms 进程退出，码 0
```

**监听句柄在 `server.close()` 那一刻就释放了：进程还活着，端口已可让给别人。**对照：**硬杀（无 drain）时端口同样立刻可用**——对 PID 1 直接 SIGKILL，实测在途请求 `ECONNRESET`（130 ms）、`{code:null, sig:"SIGKILL"}`、端口立即 FREE。「端口能不能马上重绑」从来不是问题，**问题是那一瞬间在途请求和未落盘的作业去哪了**。

## 排空管不到的两类连接，以及那条不等式

`close()` 只认识「完整的 HTTP 连接状态」，两类例外我都实测过。**半开连接**：裸 TCP 连上、发 `GET /` 后不发空行就静默挂住（slow-loris）——它不算 in-flight（`inflight=0`），但回调一直不触发，直到宽限期截止的 `closeAllConnections()` 才放行（+1741 ms）；防护靠 `requestTimeout`/`headersTimeout`，不靠 drain。**已 upgrade 的 socket**：客户端拿到 `101 Switching Protocols` 后，`closeIdleConnections()` 与 `closeAllConnections()` **都关不掉它**（文档确实把升级中的 socket 排除在外），回调始终没来，最后由兜底 `process.exit(1)` 结束，客户端是 `ECONNRESET`、日志里 `剩余 upgrade socket=1`。实时连接要你自己维护集合、排空时逐个关闭或通知重连（见 [Node 侧实现对照](/realtime/node-implementations)）；SSE 与分块下载同理。

预算是一条不等式：`GRACE_MS > p99(handler) + 最坏单条作业耗时 + 资源关闭耗时`；而 `docker stop -t`、`terminationGracePeriodSeconds`、systemd 的 `TimeoutStopSec`（见 [进程、信号与 systemd](/linux/processes-and-systemd)）是**外部预算**，必须大于 `PRE_DRAIN_MS + GRACE_MS`，否则最后一段一定是 SIGKILL。兜底强杀不丢数据的前提是收尾可重入（事务整笔提交或整笔回滚、作业有租约与重试）；宽限定时器还要能容忍重复信号（实测做法：`phase !== 'running'` 直接忽略并记一行），兜底路径**必须走非零退出码**。

## healthcheck、就绪与存活要分开

```dockerfile
HEALTHCHECK --interval=5s --timeout=2s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

预期结果（未在本机验证）：`docker ps` 的 `STATUS` 列从 `Up 30 seconds` 变成 `Up 30 seconds (healthy)`，失败则 `(unhealthy)`；`docker inspect myapi` 输出的 `State.Health` 里有 `Status`、`FailingStreak` 与最近几次执行的退出码。`HEALTHCHECK` 只能表达「退出码 0 或非 0」这一位信息，接不了下面这个区分——它我在阶段项目骨架里实测过：

| 端点 | 回答的问题 | 排空期间（实测） |
| --- | --- | --- |
| `/livez` | 进程还活着、主循环还在转吗 | **保持 200**：排空期间进程是健康的，这里报 503 会让编排器直接杀掉还在处理请求的实例 |
| `/readyz` | 现在能接新流量吗 | **变 503**：依赖不通、以及排空一开始就变；实测 body `{"error":{"code":"E_NOT_READY","details":[{"phase":"draining","ready":false}]}}` |

实践上 `HEALTHCHECK` 探存活、就绪判定交给编排器的 readiness probe；排空期间每个 503 都该留一行带 request id 的日志（见 [日志与监控](/backend/logging-and-monitoring)），事后能核对摘流量前后各接了多少。

## 非 root 运行与两处连带改动

```dockerfile
COPY --chown=node:node . /app
WORKDIR /app
USER node
```

Node 官方镜像自带 `node` 用户（uid 1000）。两处连带改动最容易被忘。**写入目录的所有权**：绑定挂载的属主由宿主机决定，容器里 uid 1000 可能没写权限，上传落盘和 SQLite 会以 `EACCES`/`SQLITE_CANTOPEN` 失败——SQLite 还要**同目录**写权限建 `-journal`/`-wal`（见 [SQLite 入门](/database/sqlite-first)）；改用命名卷或在宿主机把属主改成 uid 1000。**特权端口**：非 root 绑不了 80，用 3000 加反代（见 [Nginx](/linux/nginx)）。

## 环境变量、secrets 与配置的边界

`ENV` 写进镜像就**有去无回**：`docker history` 与 `docker inspect` 都会带上它——所以 `ENV` 只放与镜像一起变的常量（`NODE_ENV`）。运行期差异（端口、日志级别、feature flag）用 `-e` / `--env-file`，但解析后的值仍进 `docker inspect`；**凭据走 secret 挂载**（`docker secret` / K8s Secret），以文件形式出现、不进环境变量。落地规则：**能改变行为的值进环境变量，凭据进 secret 文件，且用文件路径而不是值传进来**（`DATABASE_URL_FILE` 指向挂载点，启动读一次）——这决定了配置层要不要有读文件的能力，也决定了日志脱敏清单包含哪些字段（见 [Web 安全](/backend/web-security)）。
启动校验要在容器第一次起就失败，而不是第一个请求进来才失败：缺环境变量就抛错，报错里写清「请检查 `-e` / `env_file` / secret 挂载」，同时打印一行**不含值**的配置摘要。实测输出（阶段项目骨架，本机）：`{"msg":"server.listen","port":3310,"platform":"win32","node":"25.4.0","graceMs":5000,"maxBody":4096}`——有 `platform` 和 `node` 才能定位「同一份代码在容器里和 Windows 上行为不同」这类问题，`graceMs` 直接决定上一节那条不等式。

## 镜像体积与构建上下文：先量，再优化

优化前先拿三个数：**上下文大小、基座大小、最终镜像大小**，否则任何瘦身动作都是猜。`docker buildx build --progress=plain` 的输出里有 `transferring context: ...`，**它远大于 `du -sh .` 就是 `.dockerignore` 没配好**；`docker history` 每行是一层的 `SIZE / CREATED BY`，能看出基座占大头、`RUN npm ci` 占多少。按收益排序：多阶段构建、`.dockerignore`、`npm ci --omit=dev`、基座换 `-slim`/`-alpine`、apt 装完同层 `rm -rf /var/lib/apt/lists/*`、npm 缓存指到临时目录并在层末删、`--ignore-scripts`（顺带是供应链收益）。合并 `RUN` 也省体积，但让 `docker history` 读不出信息。

## 从本地构建到上线：一条验证顺序

顺序本身就是方法：**先证镜像能起，再证信号能到，再证排空真的等完了，最后才谈编排器**。

| 步 | 动作 | 判据（预期结果，未在本机验证） |
| --- | --- | --- |
| 1 | `docker build -t myapi:0.1.0 .` | 退出码 0；`transferring context` 与 `du -sh .` 同量级 |
| 2 | `docker run --rm -p 3000:3000 --init myapi:0.1.0` 后 `curl /readyz` | 启动行打印配置摘要；`200` 且 body 里 `ready:true` |
| 3 | `docker top myapi` | node 的 PID 为 1，或父进程是 tini/docker-init |
| 4 | 先发慢请求（`/slow?ms=3000`），另开终端 `docker stop -t 10` | 慢请求**拿到 200**；日志顺序 `shutdown.signal` → `drain.sweep` → `server.close.callback` → `database.closed` → `process.exit code=0` |
| 5 | `docker inspect myapi` 看 `State.ExitCode`，再把第 4 步换成 `docker stop -t 2` | 前者是 0（137 就是吃了 SIGKILL）；后者慢请求**断在半路**、日志末尾 `forced`、退出码 `1` |

第 4、5 两步是全章落点：**同一份代码，只改编排器预算，就能在「一个请求不丢」和「强杀」之间来回**。判据不看代码，看日志顺序和退出码：137（128+9）、0、1 分别是「被编排器杀了」「正常排空」「自己兜底强杀」。

## 常见错误与排查

**1. 写了 `process.on('SIGTERM')`，`docker stop` 之后仍被强杀（137）。** 原因是 `CMD node server.js` 为 shell 形式，PID 1 是 `sh`，信号没转发给 Node（同源错误：`ENTRYPOINT ["sh","-c",...]`、中间夹一层 wrapper）。确认：`docker top` 看进程树、`docker inspect` 的 `State.ExitCode`。修：exec form `CMD ["node","server.js"]` + `--init` 或镜像内 tini。

**2. 排空期间新请求拿到 `ECONNREFUSED` 而不是 503，LB 判定实例故障。** 原因是 `close()` 一执行监听句柄就释放（实测 26 ms 后端口就能被别人绑走），此后到的是内核层拒绝，不是你写的响应。确认：排空那一刻 `curl -v`，看是 `Connection refused` 还是带 `HTTP/1.1 503` 与响应体。修：先摘流量（就绪端点改 503）再等 `PRE_DRAIN_MS`，之后才 `close()`，编排器侧预算一起调。

**3. 没有 in-flight 请求，`close()` 回调却迟迟不来，最后总走超时兜底。** 原因是空闲的 keep-alive 连接没被回收（内部 `fetch` 走 `http.globalAgent`，实测 `keepAlive === true`）。确认：回调前打一行 `server.getConnections()`，`inflight=0` 而连接数不为 0 就是这条。修：排空期间每 200 ms 轮询 `closeIdleConnections()`（实测 +5161 ms → +1377 ms），`keepAliveTimeout` 收到 65 秒左右；**别拿返回值当计数**，实测是 `undefined`。

**4. 容器里 `EACCES`（SQLite 打不开、上传目录写不了），或镜像里根本没有 `node_modules`。** 前者是 `USER node`（uid 1000）对绑定挂载目录没写权限、SQLite 还需同目录写权限建 WAL/journal；后者通常是本地 `node_modules` 被 `COPY . .` 拷进镜像，或 native 依赖在 Windows 上编译成 `.node` 后带进了 Linux 镜像。确认：日志里的 `EACCES`/`SQLITE_CANTOPEN`、`docker exec myapi id` 对比 `ls -ln` 的 uid。修：命名卷 + `--chown`；`node_modules` 一定进 `.dockerignore`，依赖只在镜像里装，native 依赖按基座 libc 重装。**Windows 宿主 + Linux 容器的绑定挂载没有 POSIX 权限位，这类问题请在真实 Linux 上验。**

**5. Windows 上按 Ctrl+C 或 `child.kill()`，排空日志一行都没有。** 原因是 Windows 没有 POSIX 信号，`kill()` 走 TerminateProcess（上文八组实测全部如此）。确认：父进程观察到 `{code:null, sig:...}` 而你的第一行排空日志没打印——「有 sig、无日志」就是这条。修：代码保持不变（Linux 容器里 SIGTERM 是真的），Windows 上改用 IPC 或管理端点验证排空逻辑，或在 WSL/Linux CI 里跑真实信号。**别把「本地测不出来」当成「逻辑不对」。**

## 练习

<Exercise title="练习 1 · 指出这段 Dockerfile 的四处问题" difficulty="基础">

```dockerfile
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3000
CMD node server.js
```

找出四处会导致「镜像虚胖 / 缓存失效 / 信号丢失 / 权限过宽」的写法，各给一行修复。

<template #answer>

| 问题 | 后果 | 修复 |
| --- | --- | --- |
| `COPY . .` 在 `RUN npm install` 之前 | 改任何文件都重装依赖 | `COPY package*.json ./` → 装依赖 → `COPY . .` |
| `npm install` | 版本随范围漂移，CI 不可复现 | `npm ci --omit=dev` |
| `CMD node server.js`（shell 形式） | PID 1 是 `sh`，SIGTERM 不转发，等满 10 秒后 SIGKILL | `CMD ["node","server.js"]`，配 `--init` 或 tini |
| 没有 `USER`，基座用非 slim 的 `node:20` | 以 root 运行；基座大、带全套编译工具 | `FROM node:20-slim` + `USER node`（配 `COPY --chown=node:node`） |

另两处：没有 `HEALTHCHECK` 时 `docker ps` 只能说「进程在」；缺 `.dockerignore` 时 `COPY . .` 会把本地 `node_modules` 与 `.env` 拷进去——前者让缓存讨论全部失效，后者把密钥烧进层里。

</template>

</Exercise>

<Exercise title="练习 2 · 从排空日志里读出宽限期该设多少" difficulty="进阶">

某服务的排空日志（顺序即时间顺序）：

```text
shutdown.signal   signal=SIGTERM inflight=2
drain.sweep       inflight=2
drain.sweep       inflight=1
grace.expired     waited=5000 inflight=1 forced=true
process.exit      code=1
```

（1）哪一条说明 `close()` 回调根本没来？（2）哪个数字说明宽限期不够？（3）两种修法，各自要同步调整哪个编排器参数？

<template #answer>

（1）`process.exit code=1` 是兜底路径打的：正常回调时 `inflight` 应已归零、退出码是 0；这里是 1 且 `forced=true`，说明回调压根没触发。（2）`grace.expired waited=5000 inflight=1`——宽限期结束时还有 1 个请求在处理，即 **p99 handler 耗时大于 5000 ms**。（3）修法一：`GRACE_MS=15000` 且外部预算一起抬（`docker stop -t 20` / `terminationGracePeriodSeconds`），否则仍是 137；修完日志应是 `drain.sweep inflight=0` → `server.close.callback` → `code=0`。修法二：把慢接口挪出请求链路（改成作业 + 轮询，见 [文件上传、定时任务与后台作业](/backend/uploads-and-jobs)），代价是接口契约要改。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误：注释掉那一行轮询" difficulty="进阶">

把 `setInterval(() => server.closeIdleConnections(), 200)` 注释掉，用 curl 复现「请求都成功了、进程却不退出」：发一个不带 `Connection: close` 的请求，拿到响应后再发第二个，然后触发排空。**解释为什么两个请求都 200、进程却一定要等满宽限期，退出码是什么。**

<template #answer>

curl 默认不发 `Connection: close`，请求完成后连接保持；服务端 `keepAliveTimeout` 65 秒、宽限期只有 5 秒，所以这两个空闲连接在整个排空期间一直活着。日志会是：两个请求都 200、`inflight=0`、`grace.expired forced=true`、`process.exit code=1`。原因就是 `close()` 不回收「调用之后才转为空闲」的连接——即我实测的 +5161 ms 那一行；退出码是 **1** 而非 0，是刻意的：兜底强杀必须让编排器看见异常。

三种修法：保留 sweep 轮询（+1377 ms）、在 `close()` **之前**先调一次 `closeIdleConnections()`（实测回调 1 ms 内触发，但只带走那一刻已空闲的连接）、或让客户端发 `Connection: close`（+1238 ms）。**排空判据不能只看退出码，要看 `close()` 回调那行有没有打。**
</template>

</Exercise>

## 官方文档与延伸阅读

- [Node.js `http` 模块 API](https://nodejs.org/docs/latest/api/http.html) —— 核实 `server.close()`（v19.0.0 起会先关闭空闲连接）、`closeIdleConnections()`、`closeAllConnections()`（v18.2.0 加入，**不销毁已 upgrade 的 socket**）三者的语义边界。前面几节把这些句子和真实数字对齐：「调用时已空闲」与「调用后转为空闲」行为不同，文档没写清，以我的输出为准、请你自己复跑确认。
- [Node.js `process` API](https://nodejs.org/docs/latest/api/process.html) —— 核实各平台支持的信号列表、`SIGBREAK` 只在 Windows。别凭 Linux 习惯读 `kill` 手册。
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) 与 [Docker 构建与打包镜像](https://docs.docker.com/build/building/) —— 前者是多阶段 `FROM ... AS`、`COPY --from=`、`HEALTHCHECK`、`USER`、shell form 与 exec form 的确切写法；后者是「减少最终镜像体积」、构建上下文与 `.dockerignore`、非 root、钉版本的原文位置。`--init`、`--user`、`docker stop -t` 见 [`docker run` 文档](https://docs.docker.com/engine/reference/run/)，基座变体见 [Node.js 官方镜像](https://hub.docker.com/_/node)，init 实现见 [tini](https://github.com/krallin/tini)。
- 站内回指：[阶段项目：多用户资源管理 API](/backend/project)（下一章，本章骨架的完整可运行版本）、[文件上传、定时任务与后台作业](/backend/uploads-and-jobs)（排空第 4 步）、[日志与监控](/backend/logging-and-monitoring)（request id 与 503 日志）、[最小 HTTP 服务器](/backend/minimal-http-server)（`keepAliveTimeout`）、[环境变量与配置管理](/frontend-engineering/env-and-config)、[进程、信号与 systemd](/linux/processes-and-systemd)、[Docker 基础](/devops/docker-basics)、[领域首页](/backend/)。

## 下一章

这一章把「服务怎么停」测到了数字级：信号能不能到、`close()` 在等谁、端口何时释放、预算怎么算、镜像里谁是 PID 1。下一章是后端收官——[阶段项目：多用户资源管理 API](/backend/project)：把前 14 章的分层、错误处理、认证授权、校验、日志、上传与作业、优雅关闭和部署收进一个能一条命令起服务的服务，每个需求都配一条可勾选的判据（越权必须被真的拒掉、错误码必须稳定、`SIGTERM` 之后在途请求必须跑完）。我那份骨架在本机跑到 **41 项全通过、0 失败**，含本章的预排空 503、在途 200、`ECONNREFUSED` 与退出码 0。做完它，下一站是[数据库](/database/)：本章第 5 步关掉的「数据库」不再是假的 `close()`。
