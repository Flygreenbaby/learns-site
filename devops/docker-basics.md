# 镜像是分层的只读文件包，容器只是它上面的一层临时写入：指令顺序决定构建快慢与镜像大小

你的项目在自己电脑上跑得好好的，换一台机器就要重来一遍：Node 版本装哪个、有没有全局工具、`sharp` 这类依赖要不要重新编译、环境变量少给了哪一个。等你把 `node_modules` 打包上传到服务器，它又炸一次——因为那些二进制是在 Windows 上装的。**「环境」从来没有被记录在任何地方，所以它每次都要靠人肉复现。**

装了 Docker 也不等于解决了。第一次写 Dockerfile 的人通常会撞上三件怪事：改一行业务代码，构建把依赖重装了一遍，等了八分钟；镜像 1 GB 出头，推到仓库再拉到服务器，又是十几分钟；`docker stop` 之后应用在日志里根本没执行清理，直接被杀死。**这三件事都不是 Docker 慢，而是你写的指令顺序和形式跟它的分层模型打架。**

本章讲这条因果链的源头：镜像是**只读的层**，容器是这些层之上**一层临时写入**。由此推出三条主线——层结构决定 Dockerfile 里每条指令该放哪（缓存与构建速度）；写入层是临时的，所以数据必须放卷（可复现、可丢弃）；进程是 1 号进程，所以命令的书写形式决定信号能不能到达（优雅退出）。**Compose 的多容器编排、网络与卷在下一章**，本章只管单个镜像怎么造、单个容器怎么看。

<Callout type="verified" title="本章实测环境">

Windows 10（MINGW64_NT-10.0-26200）+ Git Bash + Node.js `v25.4.0`，核实时间 2026-10-20。本机**没有** Docker，用 Node 真跑了两件与容器行为同构的机制：一个只绑 `127.0.0.1` 的监听端口，用本机局域网 IPv4 连不通（对照官方「`-p` 不写 host IP 就监听 `0.0.0.0`」）；一个服务分两段延迟就绪（t=400ms 才开监听、t=950ms 才返回 200）时的真实时间轴。另有两处**按官方规则做的算术推演**，正文已逐处标注：层缓存失效面（按官方三条规则算）和 `restart` 退避序列（按官方「100ms 起、每次翻倍、上限 1 分钟、稳定跑够 10 秒才重置」算）。逐字输出在 `devops/.scratch/docker9-output.txt`，脚本在 `devops/.scratch/docker9.mjs`。

</Callout>

<Callout type="unverified" title="本章所有 Dockerfile 与 docker 命令均未在本机运行">

`docker`、`docker-compose`、`podman` 在本机 `command -v` 全部找不到，也没有安装任何东西。本章每一条命令、每一个 Dockerfile 都**没有实际执行过**，它们的作用是「照着能在装了 Docker 的机器上跑」，语义依据是官方文档（链接在章末，逐字核实过）。镜像体积、构建耗时、拉取速度这类数字本章一律不给——没有一个真实引擎可测，编出来的数字只会误导。

</Callout>

## 先把镜像、容器、引擎三个词分开

| 概念 | 是什么 | 生命周期 | 一句话定位 |
| --- | --- | --- | --- |
| 镜像 image | **只读**的文件系统层 + 配置元数据（启动命令、环境变量、暴露端口） | `build` 或 `pull` 产生，一直躺在本地存储里直到你删它 | 可版本化的发布物 |
| 容器 container | 镜像的层 + 上面**一层可写层** + 一个被 namespace 隔离的真实进程 | `create` → `start` → 退出后仍在（`ps -a` 可见）→ `rm` 才消失 | **一次性进程**：可写层跟着容器一起没 |
| 卷 volume | 引擎托管的独立存储，挂在容器文件系统之外 | 不随容器删除而删除，显式删除或 `volume prune` 才走 | 「明天还要用」的数据放这里 |
| 引擎 daemon | 宿主机上真正创建与管理容器的服务 | 由 systemd 或 Docker Desktop 的后端进程管 | 所有命令都发给它 |

两个认知偏差，官方文档都写死了。**第一，tag 不是版本**：官方对镜像标签的原话是「Image tags are mutable」——同一个 `myapp:latest` 今天指向这组层，明天重新构建后指向另一组；真正唯一的是 digest（`sha256:...`）。所以「我本地的 `latest` 是好的」和「服务器上的 `latest`」本来就可以是两个东西。**第二，容器不是轻量虚拟机，但你在 Windows 上用的确实是一台虚拟机**：Linux 上容器就是被隔离的进程，而官方说明 Docker Desktop「runs the Docker Engine inside a lightweight Linux virtual machine (VM)」，差别会咬在端口、路径、权限上，本章末尾专节讲。

判断一条命令成功与否，本站的固定口径是先看退出码、再看回读：

```bash
docker build -t myapp:dev . ; echo "exit=$?"
docker images myapp:dev                                   # 回读：仓库里真有这个 tag
docker ps --filter name=web --format '{{.Names}} {{.Status}}'   # 回读：容器活着吗
```

但「打印了 Successfully tagged」不等于层缓存按你预期复用了——要看构建输出里每一层是 `CACHED` 还是真的重跑。

## 一条 `docker run` 里到底发生了什么

```bash
docker run -d --name web --init -p 127.0.0.1:8080:3000 \
  --restart unless-stopped -e NODE_ENV=production myapp:1.0.0
```

| 片段 | 语义（官方） | 容易误解的点 |
| --- | --- | --- |
| `-d` | 后台运行，只把容器 ID 打到标准输出 | 前台 `run` 占住终端；`Ctrl+C` 发给你的终端而不是容器 |
| `--name web` | 指定容器名，后续 `logs`/`exec`/`stop` 都靠它 | 同名容器已存在会直接报错，这是最便宜的幂等保护 |
| `--init` | 「Run an init inside the container that forwards signals and reaps processes」，官方标注 API 1.25+ | 不加它，应用就是 1 号进程：收不到信号，也回收不了僵尸子进程 |
| `-p 127.0.0.1:8080:3000` | 形式是 `[HOST_IP:]HOST_PORT:CONTAINER_PORT`，只映射 TCP，UDP 要写 `/udp` | **不写 HOST_IP 就绑 `0.0.0.0`**，官方明说这会「bypassing host firewall rules」 |
| `--restart unless-stopped` | 策略取值：`no` / `on-failure[:最大次数]` / `always` / `unless-stopped` | 它救「进程崩了」，不救「起来就崩」；重启间隔是退避的，见下 |
| `-e NODE_ENV=...` | 给这个容器进程注入环境变量 | 只在这条命令里生效；长期值该写进镜像 `ENV` 或下一章的 Compose |
| `myapp:1.0.0` | 镜像引用，本地没有才去 pull | 后面还能跟命令与参数，它们会**覆盖**镜像里的 `CMD` |

`-p` 的默认绑定地址，我在本机用 Node 做了同构验证：一个**只**绑 `127.0.0.1` 的端口，从 `127.0.0.1` 连得到，从本机另一块网卡的局域网 IPv4 连**不通**（超时）。真实输出（`docker9-output.txt` 第 27–31 行，本机局域网地址按本站脱敏约定不印出）：

```text
   dns.lookup('localhost') → ::1(family 6), 127.0.0.1(family 4)
-- 走 127.0.0.1:2130 → ok=true connected
-- 走 <本机局域网IP>:2130 → TIMEOUT（同一个端口，换个地址就不通：绑 127.0.0.1 只对 loopback 可达）
```

这解释了两类方向相反的事故：本地写了 `127.0.0.1:`，同事用局域网地址连不上（是绑定地址，不是防火墙）；服务器上随手写 `-p 8080:3000`，端口直接出现在公网接口上。另外 `dns.lookup('localhost')` 同时返回 `::1` 与 `127.0.0.1`，**只绑其中一个，另一个家族的连接照样失败**——「浏览器里 localhost 通、`curl 127.0.0.1` 不通」就来自这里。

重启策略的等待不是固定的。官方描述：失败后「double the previous delay, starting at 100 milliseconds」，直到「maximum delay of 1 minute」，进程「runs for at least 10 seconds」之后才把延迟重置回 100ms。按这条规则算出的序列（**算术推演，不是引擎实测**）：

```text
-- 一直起不来（每次都算失败）前 10 次等待(ms)：100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200
   累计等待=102300ms；第 7 次起就撞上 60000ms 上限
-- 每次起来后稳定跑够 10s 再崩：100, 100, 100, 100, 100, 100ms（等待被重置，累计=600ms）
```

也就是说 `--restart always` 不会把坏版本变成刷屏，它会自动退到每分钟一次；想「崩了先别拉起，让我看一眼现场」就用 `on-failure` 或 `no`。

## Dockerfile 的指令：写的是构建步骤，读的是缓存边界

```dockerfile
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
EXPOSE 3000
USER node
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node healthcheck.js
CMD ["node", "src/index.js"]
```

每条指令在缓存视角下的身份完全不同，这是本章最需要背下来的一张表：

| 指令 | 产生新层 | 什么改动会让这一层缓存失效 |
| --- | --- | --- |
| `FROM` | 引用已有层 | 换基础镜像或改它的 tag，连带其后全部失效 |
| `COPY` / `ADD` | **是** | 被复制文件的**内容或元数据（含权限）**变了 |
| `RUN` | **是**（执行结果固化成层） | **命令文本**变一个字符就失效；文本没变也可能「该失效时不失效」 |
| `ENV` / `ARG` | 元数据 | 值变了会让其后层失效（展开后的命令文本变了） |
| `WORKDIR` | 目录（其后各层的基底） | 改路径影响所有相对路径 |
| `EXPOSE` / `CMD` / `ENTRYPOINT` / `USER` / `STOPSIGNAL` / `HEALTHCHECK` | 元数据 | 不改变文件系统内容，只改变镜像配置与运行行为 |

下面四条官方硬语义，每条都对应一类线上事故。

**`EXPOSE` 不发布端口。** 官方原话是它「doesn't actually publish the port」，只是把「这个容器打算用这个端口」写进元数据，供人阅读和 `-P`（大写，随机映射所有 `EXPOSE` 的端口）使用。**真正让端口可达的只有 `-p`**（或下一章 Compose 的 `ports`）。以为写了 `EXPOSE 3000` 外部就能访问 3000，是最常见的误会之一。

**`CMD` 会被覆盖，`ENTRYPOINT` 不会。** 官方规则：`docker run <image>` 后面追加的参数「will be appended after all elements in an exec form ENTRYPOINT, and will override all elements specified using CMD」。所以约定是 `ENTRYPOINT` 定「这是干什么的程序」、`CMD` 定「默认参数」。另外 `ENTRYPOINT` 和 `HEALTHCHECK` 都只认最后一条（only the last ... will have an effect）。

**shell 形式收不到信号。** 字符串形式的 `CMD node src/index.js` 等价于 `/bin/sh -c "..."`，官方明确它「does not pass signals to the container」、被启动的程序「will not be the container's PID 1」、因此「doesn't receive a SIGTERM from docker stop」。于是默认发 SIGTERM 的 `docker stop` 之后，应用完全不知道自己在被关闭，等到超时被 SIGKILL——连接池没关、写一半的文件没落盘。**写成 exec 形式 `CMD ["node", "src/index.js"]`，node 就是 PID 1**，信号直达。运行侧加 `--init`（或镜像里用 `tini`）也能补上信号转发与僵尸回收。官方还说明 `STOPSIGNAL` 不影响 `Ctrl+C` 的行为，别指望改它能让终端控制键变成优雅停机。

**`HEALTHCHECK` 的默认值与退出码。** 官方默认是 `--interval=30s --timeout=30s --start-period=0s --start-interval=5s --retries=3`；退出码 `0: success`、`1: unhealthy`、`2: reserved - don't use this exit code`；探针超过 `timeout` 会被「abruptly stopped with a SIGKILL」；`start_period` 内的失败不计入 `retries`。探针命令要用镜像里确定存在的工具——`wget`/`curl` 在精简镜像里经常没有，像上面那样调一个应用自带的检查脚本更稳。

`COPY` 与 `ADD`：官方态度是「You'll mostly want to use COPY」——`ADD` 多出来的拉远程 HTTPS URL、自动解包本地 tar，都把不可控内容和隐藏行为带进构建；需要下载就显式写 `RUN curl` 加校验和，需要解包就写 `RUN tar`。`ARG` 只在构建期存在（写在第一个 `FROM` 之前时另有作用域规则），`ENV` 会留在镜像里、运行时也读得到。`USER` 只给用户名不给组时，官方说明进程会落到 root 组。

## 层缓存：为什么改一行代码要重装依赖

官方给出三条失效规则，本章的推演严格按这三条：

```text
- 改 RUN 指令的命令文本 → 该层失效
- 改 COPY / ADD 复制进来的文件（内容或权限这类元数据） → 该层失效
- 一旦某层失效，其后所有层都失效
```

前面说「镜像是分层的」、「Dockerfile 是指令清单」，这两句话合到实操上就是：**Dockerfile 里指令的顺序，决定你改一个文件要重建多少层。** 我用 Node 按这三条规则实现了两套排列（坏顺序把 `COPY . .` 放在 `npm ci` 之前，好顺序先 `COPY package.json`），对五种改动算失效面。取其中三行（**规则算术，不是 Docker 行为**，真实引擎上的复核要在装了 Docker 的机器上做）：

```text
A 只改业务代码，坏顺序   首个失效层=第 3 层(COPY)  重建 4/6 层：COPY→RUN→EXPOSE→CMD   重跑 npm ci = true
B 只改业务代码，好顺序   首个失效层=第 5 层(COPY)  重建 3/7 层：COPY→EXPOSE→CMD       重跑 npm ci = false
D 只改文件权限，好顺序   首个失效层=第 3 层(COPY)  重建 5/7 层：COPY→RUN→COPY→EXPOSE→CMD   重跑 npm ci = true
```

读这张表只看一个变量：**`npm ci` 那一层在不在重建链里。** A 和 B 改的是同一个业务文件，差别只在指令顺序。另外两种改动也顺理成章：改 `package.json`（好顺序下从第 3 层起全失效、重跑安装）是**应该**重跑的；把 `npm ci` 手改成 `npm install` 属于命令文本变更，从第 4 层起重建，不是「只改一个字」。

这就是官方最佳实践里那个推荐顺序（先只复制 `package.json` 与锁文件、装依赖、再复制源码）的全部理由：**按变动频率递减排列指令，把最贵又最少变的放前面。** `.dockerignore` 是另一半：官方推荐的最小内容是 `node_modules`。宿主机依赖一旦被复制进镜像，会盖掉容器里刚装好的那套（跨平台二进制还会直接崩），而且它文件数巨大，会拖慢构建上下文上传。

**上下文（context）**就是传给 `docker build` 的那个路径参数（默认 `.`），`COPY` 只能从它里面取文件，`-f` 指定的 Dockerfile 默认也在它下面——两者分开放时 `COPY` 全对不上、报文件找不到（见「常见错误」第 5 条）。

缓存也不是「该失效时不失效」的对称问题。官方举的反例是 `RUN apt-get dist-upgrade -y`：文本没变就**复用**，可上游软件源变了，镜像内容早就不同——这时缓存是错的。官方的应对是 `--no-cache`（Do not use cache when building the image）；另一个常用是 `--pull`（Always attempt to pull a newer version of the image）：前者解决「我的层不重跑」，后者解决「基础镜像不更新」，互不替代。

## 多阶段构建：把编译器和运行时分开

单阶段有个绕不过去的矛盾：构建需要编译器、devDependencies 和源码，运行只需要产物和运行时。全塞一个镜像，等于把整套工具链推上生产机。多阶段的做法是**在一个文件里写多个 `FROM`，最终只保留最后一个阶段**：

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN npm ci --omit=dev
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

前端更省：构建阶段产出 `dist/`，运行阶段换成 `nginx:1.27-alpine` 并 `COPY --from=build /app/dist /usr/share/nginx/html`，连 node 运行时都不必进最终镜像。

三个要点：**阶段名（`AS build`）只在这个文件内部被引用，不会留在最终镜像里**；`COPY --from=<阶段名或序号>` 是把产物从旧阶段搬进新阶段的手段；`--target build` 可以停在中间阶段（官方释义：Set the target build stage to build），用来判断「是编译失败还是运行失败」——把它当调试开关用。

基础镜像按口径选，别凭偏好：`alpine` 用 musl libc，体积小，但依赖原生二进制的包（`sharp`、`bcrypt`）行为可能不同；`slim`（Debian）大一些但 glibc 兼容性好；distroless 连 shell 都没有，`docker exec ... sh` 直接失效。**本机无 Docker，这些差异无法实测**；建议学习期统一 `alpine`，碰到原生依赖报错再换 `slim` 验证一次。

## 日常运维：只需要这六条命令

```bash
docker logs --tail 100 -f web            # 首选证据源：应用自己的 stdout/stderr
docker exec -it web sh                   # 进容器；alpine 有 sh，精简镜像可能只有 sh 或什么都没有
docker exec web printenv NODE_ENV        # 非交互读一个值，适合写进检查脚本
docker ps -a --filter name=web --format '{{.Names}}\t{{.Status}}'
docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' web
docker stats --no-stream web             # CPU/内存/网络/块 IO 的一次性快照
docker system df                         # 各类可回收对象占用，先看这个再决定 prune
```

判读口径固定三条。**状态看 `Status`**：`Exited (0)` 正常退出、`Exited (1)` 要翻 `logs`、`Restarting` 是崩了正被拉起、`unhealthy` 是探针在失败。**原因看 `logs` 最后几十行加 `inspect` 的 `ExitCode`/`OOMKilled`**：`OOMKilled` 为真是内存限制，与代码无关。**改动是否生效靠回读 `docker images` 的 tag 与 digest**，而不是「我重新构建过了」。

清理要先 `system df` 看占用、再决定删什么。官方警告清单原样抄在这里，因为 prune 的删除面比名字听起来大得多：

```text
$ docker system prune
WARNING! This will remove:
- all stopped containers
- all networks not used by at least one container
- all dangling images
- unused build cache
```

加上 `-a --volumes` 后，官方清单还会再多出「all anonymous volumes not used by at least one container」「all images without at least one container associated to them」「all build cache」。**也就是说 `prune -a` 会把当前没有容器在用的镜像全删掉**——这就是「本地跑得好，清理一次之后拉镜像二十分钟」的原因；而在真实服务器上，`--volumes` 是数据事故的入口。本站口径：服务器上只按名字清理（`docker image rm`、带 `--filter until=24h` 的 `docker container prune`、`docker volume ls` 人工确认后再 `docker volume rm`）；要动 `prune -a`，先确认镜像都拉得回来、卷里没有业务数据。官方也明确 volume「isn't removed automatically」——**卷不会被误删，但也不会自动回收。**

## 本机 Docker Desktop 与 VPS 上的引擎不是一台机器

| 维度 | 本机 Windows + Docker Desktop | 真实 Linux VPS |
| --- | --- | --- |
| 内核 | 引擎跑在轻量 Linux VM 里（官方原文） | 直接用宿主内核，没有中间 VM |
| `-p` 的宿主端口 | 由 `com.docker.backend` 在 Windows 上监听，再转发进 VM 到容器 IP（官方举了 `172.17.0.2:80`） | 引擎直接监听宿主接口，公网可达 |
| 路径与权限 | bind mount 要写 `/c/Users/...` 这类经 VM 共享的路径，跨文件系统权限与性能有损耗 | `/srv/app` 就是 `/srv/app`，`chown`/UID 语义是常规的 |
| 谁在管引擎 | 图形后端启停，重启电脑会带走所有容器 | systemd 管，`--restart always` 在这里才有意义 |

**哪些事在本地学不到真东西**：安全组与防火墙的验证、TLS 证书签发（域名必须公网可达）、磁盘配额与 OOM 的真实压力、镜像拉取速度、多容器重启风暴——这些放到第 8 章在 VPS 上做。**哪些事绝不要在 VPS 上试**：第一次写 Dockerfile、随手 `prune -a`、`--privileged` 试命令、把密钥写进 `-e` 又暴露公网端口。本地练习建一个专用目录，只在里面 build/run/rm，容器统一加前缀名方便按名清理。

## 常见错误与排查

**1. 改一行代码，构建把依赖重装了一遍，慢到想放弃 Docker。** 原因：`COPY . .` 写在 `RUN npm ci` 之前，业务文件一变就把依赖层打掉（上面 A 与 B 的差别）。确认：看构建输出里 `npm ci` 那步有没有 `CACHED`。修法：先只 `COPY package.json package-lock.json ./` → `RUN npm ci --omit=dev` → 再 `COPY` 源码；同时补 `.dockerignore`（至少 `node_modules`、`.git`、构建产物）。

**2. `docker stop` 要等十秒才结束，日志里没有清理信息。** 原因：`CMD` 用了 shell 形式，应用不是 PID 1（官方明确它收不到 SIGTERM），只能等超时被 SIGKILL。确认：`docker top web` 或 `docker exec web ps` 看是不是多了一层 `sh -c`；比对 `docker inspect` 输出里的 `Config.Cmd` 与 `Config.Entrypoint`。修法：改 exec 形式 `CMD ["node", "src/index.js"]`，应用里注册 SIGTERM 处理，运行侧加 `--init`。

**3. 端口映射了，外面还是连不上；或者本地连得上、同事连不上。** 三层原因按顺序排：应用只监听容器内的 `127.0.0.1`（要让它监听 `0.0.0.0`，否则映射进来的连接没人接）；映射写了 host IP（`-p 127.0.0.1:8080:3000` 只对宿主 loopback 可达，这是本机实测过的同构行为）；服务器上云安全组或防火墙没放行。确认：`docker port web` 看实际绑定、`docker logs web` 看应用打印的监听地址、宿主 `curl 127.0.0.1:8080` 与另一台机器分别试。本地想安全就写 `127.0.0.1:`；服务器上对外应该由第 8 章的 Nginx 反代承担，容器端口收回本机。

**4. 同一台机器昨天还好好的，今天 `latest` 的行为变了。** tag 可变（官方「Image tags are mutable」），重新构建就覆盖；`--pull` 也会让新构建拿到更新的基础镜像。确认：`docker images --digests myapp` 比对 digest。修法：部署用不可变 tag，`latest` 只用于本地开发。

**5. 构建报「文件找不到」，文件明明在磁盘上。** 原因都跟构建上下文有关而不是当前目录：`-f` 与 context 不同级、`.dockerignore` 写太宽（`*` 之后没有 `!` 例外，或误伤 `src/`）、CI 里 checkout 的路径与本地不同。确认：按 context 根目录手算一遍 `COPY` 的源路径，或临时加一个 `RUN ls -a` 阶段看进镜像前到底有什么。修法：Dockerfile 与 context 放同一级，`.dockerignore` 只排除确定不需要的目录。

## 练习

<Exercise title="练习 1 · 把一份会重跑依赖的 Dockerfile 改成增量构建" difficulty="基础">

下面是同事写的 Dockerfile，构建一次约等于把依赖装一次。指出问题出在哪条指令的顺序上，改写它，并说明改完之后「只改业务代码」和「只改锁文件」各自要重建哪几层。

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3000
CMD node src/index.js
```

<template #answer>

两处问题：**`COPY . .` 在 `RUN npm install` 之前**，以及**没有 `.dockerignore`**。改法就是把本章开头那个示例的顺序拿过来：`COPY package.json package-lock.json ./` → `RUN npm ci --omit=dev` → `COPY src/ ./src/` → `EXPOSE` → `CMD`。

按官方三条规则数失效面（与前面表里的 A/B 同构）：只改 `src/index.js` → 首个失效层是最后那个 `COPY`，重建 `COPY`→`EXPOSE`→`CMD`，**`npm ci` 复用缓存**；只改 `package-lock.json` → 首个失效层是 `COPY package*.json`，其后全部重建，`npm ci` 必须重跑（依赖确实变了，这次重跑合理）。

顺手要改的三处：`npm install` 换成 `npm ci`（有锁文件时 `ci` 严格按锁文件装、也不改写锁文件，构建才可复现）；`CMD` 换成 exec 形式，否则应用不是 PID 1；`.dockerignore` 至少写 `node_modules`、`.git`、`dist`，否则宿主机依赖被复制进镜像、盖掉容器里刚装好的那套。本机一个 Docker 都没装，以上层数是按官方规则的算术推演，要在装了引擎的机器上用构建输出的 `CACHED` 标记复核才算验证。

</template>

</Exercise>

<Exercise title="练习 2 · 故意写坏三次并预测代价" difficulty="挑战">

对同一份好顺序 Dockerfile（`COPY package*.json` → `RUN npm ci` → `COPY src/` → `EXPOSE` → `CMD`）分别做三件事：① 只把某个文件的权限位改掉，内容不变；② 把 `RUN npm ci --omit=dev` 改成 `RUN npm ci`；③ 把 `EXPOSE 3000` 从 `COPY src/` 之前挪到之后。逐条判断各要重建几层、是否重跑依赖安装，并说明哪一种「看起来最无害」而实际最贵。

<template #answer>

① **权限改动照样打掉整个依赖层。** 官方第二条规则把「文件元数据（如权限）」和内容变更同等对待，所以首个失效层是 `COPY package*.json`，其后全部重建、`npm ci` 重跑（前面表里的 D 就是这个场景）。② **改命令文本必然重跑**，首个失效层是 `RUN` 本身，其后重建——但这次是「合理的重跑」：去掉 `--omit=dev` 装的是全套依赖，镜像还会变大，属于正确性变更而不是缓存事故。③ **移动指令位置就是改变顺序**，从它之后的层全部重建，而 `EXPOSE` 本身只是元数据；把元数据夹在两个内容层中间，等于给后面的 `COPY src/` 和 `CMD` 重排了缓存键。

最「看起来无害」而实际最贵的是 ①：它不改动任何一行代码，`git diff` 甚至可能显示不出来（Windows 默认不跟踪权限位，Linux 上 `chmod` 会进 diff），但在缓存判断里它就是一次全量重装。**判断依据统一为一句话：贵不贵只看依赖安装那一层在不在重建链里。**

两条防线：第一版就按「变动频率递减」排指令；在 CI 里检查构建输出的 `CACHED` 层数，日常提交一旦出现 `npm ci` 就回头查 `COPY` 顺序、权限位或换行符这类隐形改动（`.gitattributes` 统一行尾是常见修法）。

</template>

</Exercise>

<Exercise title="练习 3 · 设计一次能证伪「优雅停机」的实验" difficulty="进阶">

假设一台机器上有 Docker。写出一个最小实验，分别验证 shell 形式与 exec 形式的 `CMD` 在 `docker stop` 下行为不同：给出 Dockerfile、会打印收到信号的应用片段、执行与计时命令，以及「什么输出算通过、什么算失败」。

<template #answer>

应用只老实记录信号：

```js
process.on('SIGTERM', () => { console.log('got SIGTERM, closing'); setTimeout(() => process.exit(0), 200) })
setInterval(() => {}, 1000)
```

两份 Dockerfile 只差 `CMD` 形式，其余完全一致（`CMD node s.js` 与 `CMD ["node", "s.js"]`）。执行与取证：

```bash
docker build -f Dockerfile.shell -t s1 . ; docker build -f Dockerfile.exec -t s2 .
docker run -d --name t1 s1 ; docker run -d --name t2 s2
time docker stop -t 3 t1 ; time docker stop -t 3 t2
docker logs t1 ; docker logs t2
```

判据（必须看到「坏的失败、好的通过」才算证据成立）：**exec 形式**的 `logs` 里出现 `got SIGTERM, closing`，`stop` 耗时远小于 3 秒；**shell 形式**的 `logs` 里没有那行，`stop` 顶到 3 秒超时（被 SIGKILL），退出码常显示 `137`。两个容器都要出现各自的表现才算验证成功——只看到 exec 通过，排除不了「这台机器上信号本来就没问题」。再补一组 `--init` 对照，单独确认「init 转发信号」这条机制。

依据是官方对 shell 形式「does not pass signals」「not the container's PID 1」「doesn't receive a SIGTERM」的说明以及 `--init`、`STOPSIGNAL` 的定义。**这个实验我在本机没有运行**（本机无 Docker），预期结果来自官方文档，不是实测数据。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Docker 概览](https://docs.docker.com/get-started/docker-overview/) —— 镜像、容器、引擎三个概念的官方定义，本章第一节的依据。
- [Dockerfile 参考](https://docs.docker.com/reference/dockerfile/) —— 逐条指令语义，本章四处硬语义的出处：`EXPOSE` 不发布端口、shell 形式不是 PID 1 且收不到 SIGTERM、`docker run` 参数覆盖 `CMD` 而追加到 exec 形式 `ENTRYPOINT` 之后、`HEALTHCHECK` 的默认值与退出码 `0`/`1`/`2`、`STOPSIGNAL` 默认 SIGTERM 且不影响 `Ctrl+C`、`USER` 无主组时落到 root 组。
- [构建缓存](https://docs.docker.com/build/cache/) 与 [构建最佳实践](https://docs.docker.com/build/building/best-practices/) —— 层失效三条官方规则、`RUN apt-get dist-upgrade -y` 复用旧缓存的反例、`--no-cache` 的用途、推荐的 Dockerfile 顺序与 `.dockerignore` 最小内容。
- [构建时的变量](https://docs.docker.com/build/building/variables/) —— `ARG` 与 `ENV` 的持久性差异及作用域规则。
- [多阶段构建](https://docs.docker.com/build/building/multi-stage/) —— `AS` 与 `COPY --from` 的官方写法。
- [docker run 手册](https://docs.docker.com/engine/reference/run/) 与 [容器运行](https://docs.docker.com/engine/containers/run/) —— 四种重启策略、退避「100ms 起、翻倍、上限 1 分钟、跑够 10 秒重置」、`--init`（API 1.25+）、`--rm`、`-P` 与 `-p` 的绑定地址语义。
- [docker image build](https://docs.docker.com/reference/cli/docker/image/build/) —— `-f`（默认 `PATH/Dockerfile`）、`-t`、`--no-cache`、`--pull`、`--build-arg`、`--target` 的官方释义。
- [卷](https://docs.docker.com/storage/volumes/) —— 卷是持久化的推荐机制、挂载会遮盖镜像内既有内容、卷不随容器自动删除、需 `docker volume prune`。
- [docker system prune](https://docs.docker.com/reference/cli/docker/system/prune/) —— 本章照抄的 WARNING 清单，以及 `-a`、`--volumes` 各自扩大了什么。
- [Docker Desktop](https://docs.docker.com/desktop/) 与 [Docker 引擎](https://docs.docker.com/engine/daemon/) —— 「引擎跑在轻量 Linux VM 里」「`-p` 默认监听 `0.0.0.0`，可限制到 `127.0.0.1`」「Windows/macOS 上由 `com.docker.backend` 在宿主监听再转发进 VM」的出处。
- [Docker Compose](https://docs.docker.com/compose/) —— 下一章的全部内容。

## 下一章

本章把「镜像 = 只读层、容器 = 一层临时写入」这条线走到底：指令顺序就是构建速度；`CMD` 的形式决定应用能不能收到停机信号（官方明确 shell 形式不是 PID 1、收不到 SIGTERM）；`-p` 的默认绑定地址决定端口对谁可达（本机实测：只绑 loopback 时局域网地址连接超时）；prune 的删除范围比名字听起来大得多。**但单个镜像解决不了一个真实产品的形状**：应用 + 数据库 + 反向代理是三个容器，它们要互相找到对方、数据库的数据要活过容器重建、连接串要从环境里注入——三条 `docker run` 加一堆 shell 变量可以写，只是不可交接、不可复现，也没人保证下次启动顺序一样。

本章还埋了一个下一章必须解决的坑：我用 Node 实测过一个「分两段就绪」的服务——t=400ms 才开监听、t=950ms 才返回 200，从「能连上」到「能用」中间差了 572ms（真实输出）。数据库场景里这个窗口通常是几秒到几十秒，多容器启动时应用正好会撞上它。下一章讲怎么把这三个容器写进一份 `compose.yaml`，以及怎么让应用等数据库**真的能用**再启动 → [Docker Compose、卷与网络](/devops/docker-compose)。
