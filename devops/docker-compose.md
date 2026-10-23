# 一份 compose.yaml 起三个服务：默认网络按服务名找到对方，depends_on 却不等你以为的「就绪」

上一条命令 `docker run` 起后端，下一条起数据库，再下一条起 Nginx，然后你发现：端口要在两条命令之间对齐、连接串要手抄、数据目录要先 `mkdir`、网络名要记，重启电脑后得把这五条按原顺序再敲一遍。**能背下来的流程不是自动化**——它不可交接（同事拿不到你那五条命令的历史），不可复现（少一个 `-e` 就换个行为），也没有版本记录。

更糟的是启动顺序。你写 `docker run` 时自然会「先起数据库再起应用」，可数据库容器**起来**不等于它**能用**：Postgres 要先初始化数据目录、跑恢复、开始监听。应用在这几百毫秒到几十秒里连上去，拿到的是连接被拒，然后它退了、被重启策略拉起来、再退。

Compose 解决前一件事：把服务、网络、卷、变量写进一份文件，交给 `docker compose` 执行。**但「等就绪」这件事它默认不做**——官方原文：「On startup, Compose does not wait until a container is "ready", only until it's running.」本章讲清楚哪些是 Compose 替你真的做了（网络、DNS、依赖顺序、命名前缀），哪些必须你自己显式声明（`healthcheck` + `depends_on` 长语法、卷、端口引号），以及配置写完怎么在不启动容器的前提下验证它。

<Callout type="verified" title="本章实测环境">

Windows 10 + Git Bash + Node.js `v25.4.0`，核实时间 2026-10-20。本机**没有** Docker，用 Node 真跑了一个「分两段就绪」的服务来复现本章最核心的时间轴（t=400ms 才开监听、t=950ms 才开始返回 200），以及两个越界端口的真实报错（`listen(65536)`、`listen(488000)`）。两处**按官方规则推演**、正文已标注：healthcheck 状态机（默认 `interval=30s`、`timeout=30s`、`retries=3`、`start_period=0s`）与 YAML base-60 的换算。逐字输出在 `devops/.scratch/docker9-output.txt`。

</Callout>

<Callout type="unverified" title="本章所有 compose.yaml 与 compose 命令均未在本机运行">

`docker`、`docker-compose`、`podman` 在本机 `command -v` 全部找不到，也没有安装任何东西。因此本章的每一份 `compose.yaml`、每一条 `docker compose` 子命令都**没有实际执行过**；配置语义来自官方文档逐字核实（链接在章末），实测结论仅限上面那两段 Node 机制实验。「服务能否正常互通」「数据是否真的落盘」这类只能在真实引擎上确认的事，本章一律标注为未验证。

</Callout>

## 为什么是 Compose：先认字段，再认命令

Compose 读的文件默认是工作目录里的 `compose.yaml`（官方：首选这个名，也兼容 `compose.yml`、`docker-compose.yaml`、`docker-compose.yml` 用于向后兼容；**两者同时存在时优先 `compose.yaml`**）。

```yaml
name: myblog

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: myblog/app:0.1.0
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
    volumes:
      - uploads:/app/uploads
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: blog
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?数据库密码必须从环境注入}
      POSTGRES_DB: blog
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 10s
      retries: 5
      start_period: 30s
    volumes:
      - db-data:/var/lib/postgresql/data
    restart: unless-stopped

  proxy:
    image: nginx:1.27-alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - app

volumes:
  db-data:
  uploads:
```

四个字段级事实，都会影响你怎么读别人的文件：

**顶层 `name` 就是项目名。** 官方模型里「project」是一次具体部署，资源名按项目名前缀、并打 `com.docker.compose.project` 标签；不写 `name` 时项目名来自目录名，也可以被 `--project-name` 或环境变量 `COMPOSE_PROJECT_NAME` 覆盖。同一份文件用不同项目名可以在同一台机器上部署两次（官方明说这是设计目标）。

**`version` 字段已经没用了。** 官方：它「only informative and you'll receive a warning message that it is obsolete」，Compose 始终按最新 schema 解析。老教程里 `version: "3.8"` 那一行的来历是 v1 时代文件格式的 1/2.x/3.x 演进，**看到它就当没有**，新项目不要写。

**`services` 下每个键是一个服务**，`build` 与 `image` 可以并存（前者定义怎么造，后者定义造出来的 tag）。

**顶层 `volumes`（还有 `networks`）是声明区。** 官方：要让一个命名卷在多个服务间复用，必须在顶层 `volumes` 里声明它。上面 `db-data`、`uploads` 就是这么用的。

## 端口映射：`"8000:8000"` 的引号不是洁癖

`ports` 的格式官方写作 `[HOST:]CONTAINER[/PROTOCOL]`，并且有一条明确的告警：**「HOST:CONTAINER should always be specified as a (quoted) string, to avoid conflicts with YAML base-60 float」**。这是 YAML 早期规范里的六十进制数字写法：`8000:8000` 不加引号时，按 base-60 解析得到 `8000*60+8000`，手算等于 **488000**（`3000:3000` 同理是 183000）。端口上限是 65535，这个数不是「有点奇怪」而是根本不可能监听。我在本机验证了越界端口的行为：

```text
   手算 base-60：8000*60+8000 = 488000；3000*60+3000 = 183000（端口上限 65535）
-- listen(65536) → ERR_SOCKET_BAD_PORT options.port should be >= 0 and < 65536. Received type number (65536).
-- listen(488000) → ERR_SOCKET_BAD_PORT options.port should be >= 0 and < 65536. Received type number (488000).
```

（本机没有 YAML 解析器——不装依赖——所以 base-60 的解析结果只有官方告警加上面的手算，未用真实解析器复现；「越界端口起不来」这一步是真跑的。）

另外两件事同样来自官方，且都被上一章的实测支持：

**省略 host IP 就绑 `0.0.0.0`。** 官方警告这会「bypassing host firewall rules」把容器直接暴露到公网。上一章我在本机实测过它的反面：只绑 `127.0.0.1` 的端口，用局域网 IPv4 连是超时的。所以本站的默认写法是 **`"127.0.0.1:3000:3000"`**——服务器上由 Nginx 反代对外，容器端口只监听本机。

**`network_mode: host` 与端口映射互斥。** 官方：「Port mapping must not be used with network_mode: host. Doing so causes a runtime error」，且 host 模式下「No port mapping is needed or supported, and service name DNS resolution does not work」——**用了 host 网络，服务名就不再是地址了**，这是「我把网络改成 host 之后 Nginx 连不上 app」的直接原因。

## 网络：服务名就是域名

不写任何 `networks` 时，Compose 会给项目建一张默认 bridge 网络，命名是 `<项目名>_default`，所有服务默认加入它。官方描述这套发现机制：「Each service registers its name with an internal DNS server」，并给出直接可抄的例子——「The web service can connect to the database at `postgres://db:5432`. From the host machine, the same database is accessible at `postgres://localhost:8001`」。

把这段话拆成三条规则，能避免本章最大的一类混乱：

| 谁在连谁 | 该用什么地址 | 用什么端口 |
| --- | --- | --- |
| 容器 → 同项目容器 | 服务名（`db`、`app`、`proxy`） | **CONTAINER_PORT**，即应用实际监听的那个端口，跟 `ports` 无关 |
| 宿主机 / 浏览器 → 容器 | `localhost` 或宿主 IP | **HOST_PORT**，即 `ports` 冒号左边那个 |
| 公网 → 服务 | 域名 + Nginx 反代（第 8 章） | 由反代决定 |

官方一句话总结：「Networked service-to-service communication uses the CONTAINER_PORT. The host port is only used when accessing the service from outside the network.」所以 `db` 服务**完全不需要写 `ports`** 就能被 `app` 连上；写 `ports` 只是为了你从宿主 `psql` 进去看数据。**而 `ports` 写了就等于对宿主暴露**，学习期给数据库加 `"5432:5432"`、到生产忘了删，是很常见的事故。

官方还有一条硬规定：**「you should always reference services by name, not IP address」**——容器 IP 每次重建都会变。要分组（比如只让 `proxy` 和 `app` 互通、`db` 只对 `app` 可见）就显式声明多个网络，服务写进不同网络即可；跨网络的容器要互相访问必须**共同**存在于某个网络里。

## 卷：让数据活过容器重建

上一章说过容器的可写层是临时的，`docker rm` 就没了。持久化只有两条正路，各有适用场景：

| 写法 | 数据实际在哪 | 适合什么 | 注意点 |
| --- | --- | --- | --- |
| 命名卷（`db-data:/var/lib/postgresql/data`，顶层声明） | 引擎托管的目录（Linux 上在 `/var/lib/docker/volumes/...`） | 数据库、上传件——任何「明天还要用」 | 换机器要 `docker volume` 备份；不在你的项目目录里，`ls` 看不到 |
| bind mount（`./nginx.conf:/etc/nginx/conf.d/default.conf:ro`） | 你写的宿主路径 | 配置文件、开发期热改源码 | 宿主路径必须存在；`:ro` 保命；Windows 侧跨文件系统有损耗 |

三条官方语义值得背下来。**第一，挂载点会遮盖镜像里原有的内容**——第一次给 Postgres 挂 `db-data` 时，空卷遮住镜像内的初始数据目录，所以官方提供 `copy`/`nocopy` 行为（默认对命名卷会把镜像内既有数据复制进去一次；bind mount 不复制）。这就是「配置了卷之后初始化脚本反而没跑过」的来源。**第二，卷不会自动删除**：官方明确 volume「isn't removed automatically」，回收要靠 `docker volume prune` 或显式 `docker volume rm`。**第三，`docker compose down` 默认不动卷**，是 `down -v` 才删——这条命令要当成危险操作对待。

`subpath`（官方标注 2.35.0 引入）能只挂载目录树里的一小段，本站未实测新版本可用性；至于官方文档里的 Synchronized file shares，那是付费订阅的功能，本站不依赖也不推荐使用。

## 环境变量：三条通道，优先级是写死的

同一个名字可能来自四个地方，分不清就会「明明改了怎么没生效」。按官方口径：

| 通道 | 写法 | 用途 | 会不会进版本库 |
| --- | --- | --- | --- |
| `environment` | 键值列表或映射 | 少量、非敏感的覆盖 | 会（别放密钥） |
| `env_file` | `- .env.local`（可以是列表，自上而下） | 一整个文件注入**服务进程** | 通常 `.gitignore` 掉 |
| `.env`（项目目录里，放 `compose.yaml` 旁边） | `POSTGRES_PASSWORD=...` | **给 compose 文件本身做插值** | 必须 ignore |
| shell 环境变量 | 执行前 `export` | 临时覆盖，优先级最高 | 不进库 |

两个容易混淆的点：`env_file` 是给**容器里的进程**的，`.env` 是给 **Compose 解析文件**用的，二者作用对象不同；优先级是 shell > `--env-file` > 项目目录 `.env`。而在同一个服务里同时写了 `env_file` 和 `environment` 时，官方规定「`environment` have precedence」。

插值语法（官方列出且只作用于**未加引号或双引号**的值）：`${VAR}`、`${VAR:-默认}`（未设置或为空则用默认）、`${VAR-默认}`（仅未设置）、`${VAR:?错误}`（未设置或为空则报错中止）、`${VAR:?...}` 用于强制密钥必须存在、`${VAR:+替换}`（有值才替换）。要**关掉**插值用 `$$`：上面示例里 `pg_isready -U $${POSTGRES_USER}` 就是故意把 `$POSTGRES_USER` 留给容器内的 shell 展开，而不是让 Compose 提前替换掉（官方 postgres 探针示例的原样写法）。反过来，`DATABASE_URL` 这种由应用进程自己读的值**不能**写 `$$`——应用不做变量展开，只会拿到一个字面量。

自检命令是不需要启动容器的，也是本章唯一要求你每次都跑的一条：

```bash
docker compose config            # 解析 + 插值后的最终配置，打印出来核对
docker compose config --environment
echo $?                          # 0 才算这份文件能被解析
```

`config` 会把默认值、插值结果、相对路径展开全部打印出来——**「配置写对了」的定义是它的输出等于你脑子里那份**。这一步在 Windows 与 Linux 上结果可能不同（路径展开），到服务器上第一件事就是重跑一次 `config` 对比。

## 启动顺序：depends_on 短语法挡不住的那个窗口

官方的两条基础保证：「Compose always starts and stops containers in dependency order」，依赖关系来自 `depends_on`、`links`、`volumes_from`、`network_mode: "service:..."`；但紧接着那句——启动时它「does not wait until a container is "ready", only until it's running」。**短语法（`depends_on: - app`）只保证「先创建并启动」，不保证「能用」。**

我在 Node 上真跑了一个分两段就绪的服务，把三种「等待」的差别量化出来（逐字输出，端口与探测次数是那次运行的观测值）：

```text
   目标端口=2130（已预留但尚未开启监听）计划：t=400ms 才 listen，t=950ms 才开始返回 200
-- 客户端 A「进程在就算可用」（等价 condition: service_started）
   t=4ms 首次连接 → ok=false 错误=ECONNREFUSED
-- 客户端 B「死磕到端口可连」：第 8 次尝试在 t=438ms 连上（此时服务仍没就绪）
   连上之后立刻发请求 → 首行="HTTP/1.1 503 Service Unavailable"（TCP 通了但应用在返 503）
-- 客户端 C「按响应码判健康」（等价 condition: service_healthy + healthcheck）
   探测 10 次，t=1010ms 才拿到 200 → 比「能连上」晚 572ms，这段时间就是 depends_on 短语法挡不住的故障窗口
```

这段实测解释了三个 `condition` 取值的真实差别。官方长语法的三个值是 `service_started`、`service_healthy`、`service_completed_successfully`，另有 `required: false`（官方标注 2.20.0 引入，默认 `true`）让某个依赖变成可选——**数据库挂了也不影响你先起 web 调试**；`restart: true`（2.17.0）则是给「依赖方重启后自己也重启」用的。

`service_healthy` 依赖服务自己声明 `healthcheck`。Compose 的 `healthcheck` 属性官方说明「works in the same way, and has the same default values, as the HEALTHCHECK Dockerfile instruction」，且 Compose 文件可以覆盖镜像里的值。默认值偏宽（`interval=30s`、`timeout=30s`、`retries=3`、`start_period=0s`、`start_interval=5s`），数据库这类服务要按上面示例收紧：`interval: 10s`、`start_period: 30s`、`timeout: 10s`、`retries: 5`。`test` 是列表时首项必须是 `NONE`/`CMD`/`CMD-SHELL`，写成字符串等价于 `CMD-SHELL`；`disable: true` 用来关掉镜像里的探针。

按官方规则推演三种探针时序（**状态机推演，不是引擎实测**；`start_period` 内的失败不计入 `retries`）：

```text
A 启动慢：t=5s 退出码 1（在 start_period=40s 内，不计 retries，仍 starting）→ t=15s 同上 → t=30s 退出码 0 → healthy
B 真坏了：t=5s 落在 start_period 内不算 → t=45s/75s/105s 连续失败 1/3、2/3、3/3 → unhealthy
C 探针卡死：每 30s 超过 timeout=30s 记一次失败（检查进程被 SIGKILL），三次后 → unhealthy
```

三条推论值得记住：**启动慢不是病**（`start_period` 就是给它用的）；**退出码 2 不要用**（官方：`2: reserved`）；**探针自己卡死也会被算成失败**，所以探针命令必须有超时兜底（`timeout` 会 SIGKILL 它）。

## 日常命令与「怎么算成功」

```bash
docker compose config -q ; echo "exit=$?"     # 语法与插值能过，-q 只报错误
docker compose up -d --build                  # 需要重建镜像时加 --build
docker compose ps                             # 三行都在、STATE 是 Up/healthy
docker compose logs -f app                    # 只看这一个服务
docker compose exec app printenv DATABASE_URL # 回读注入结果
docker compose down                           # 停并删容器与网络，保留卷
```

判据按顺序看：`config` 退出码非 0 就不是「跑得慢」而是文件不对；`up` 之后先看 `ps`（`healthy` 才代表探针过、`Restarting` 说明应用在崩）；再看 `logs` 找具体错误；最后用 `exec printenv` 证明变量真的进了进程。`down` 之后要确认清理：`docker compose ls` 里项目不在了、`docker volume ls` 里卷还在（这是**预期**，不是没清干净）。

**同一份文件在一台机器上跑两套**是官方设计能力：`--project-name other`（或 `COMPOSE_PROJECT_NAME`）会生成另一套 `<other>_default` 网络与 `<other>-db-1` 容器，但**端口仍是宿主级的**，两套要抢 `80`，必须错开 `ports` 或改宿主 IP 前缀。真实服务器上，`up -d` 之后重启机器能不能自动恢复取决于引擎由 systemd 托管加上 `restart: unless-stopped`——**Compose 不是进程管理器**，这一点在第 8 章对接服务器时会再强调。

## 本地学习时练不到、VPS 上才成立的事

Windows 上 Docker Desktop 的引擎跑在轻量 Linux VM 里，`-p` 的宿主端口由 `com.docker.backend` 监听再转发进 VM（官方描述），所以：bind mount 的路径写法和权限语义与 Linux 上不同，大目录挂载（比如把整个项目 `./node_modules` 挂进去）会明显慢；`localhost` 在容器里指容器自己，访问宿主要用官方提供的内部域名而不是 `localhost`。到 VPS 上，同一条 `compose up -d` 少了这层 VM，但多了三件本地没有的事：云安全组与防火墙真的会挡端口、`docker compose pull` 走公网仓库有速度差、磁盘小会让 `up --build` 中途失败。

还有两个只在服务器侧成立：官方说明 **pre-stop 钩子只在 `docker compose down` 或手动 `Ctrl+C` 停止时运行**，容器自己退出或被突然杀死时不跑——把「停服前备份」写成 pre-stop hook 是可以的，但它不保证在任何失败路径下执行；以及 `secrets`（文件型）在生产里比一堆 `-e` 干净，但本站第一条产品路线用 `.env` + `environment` 起步即可。

## 常见错误与排查

**1. `app` 连不上 `db`：`ECONNREFUSED` 或 `connection refused`。** 两个原因分开排：连接串写了 `localhost:5432`（容器里 `localhost` 是它自己，要用服务名 `db:5432`）；或者用了 `depends_on` 短语法，应用在数据库初始化完成前就起了（上面实测的 572ms 窗口）。确认：`docker compose ps` 看 `db` 是否 `healthy`、`docker compose exec app nc -z db 5432` 这类最小连通测试、`docker network inspect <项目>_default` 看两个容器是否在同一网络。修法：给 `db` 加 `healthcheck`，`app` 用 `condition: service_healthy`；同时应用侧自己带重试（`depends_on` 不能替代重试）。

**2. 改了 compose.yaml 没效果。** 原因：`up -d` 对配置没变的服务什么都不做，而变量插值来自 `.env`（它在文件解析时读入）。确认：`docker compose config` 的输出是不是你以为的值。修法：改文件后 `docker compose up -d` 会重建受影响容器；只改 `.env` 要重跑 `up`；始终用 `config` 而不是「我记得改了」来判断。

**3. 数据库数据没了。** 三个可能：只写了 bind mount 而宿主路径不存在（Docker 会建一个空目录，看起来像数据丢了）；用了匿名卷（`- /var/lib/postgresql/data` 不带名字），容器被 `rm` 后匿名卷留在 `volume ls` 里没人认领；执行过 `docker compose down -v`。确认：`docker volume ls` 加 `docker inspect` 看 `Mounts` 的 `Type` 与 `Source`。修法：数据库一律用顶层声明的命名卷，并把 `down -v` 从习惯命令里删掉。

**4. 端口冲突 / 「address already in use」。** 原因：项目名不同也共享宿主端口；或本机已有服务占了 `80`。确认：`docker compose config` 里读实际宿主端口，再 `netstat -ano | grep 80`（Windows 上是 `netstat -ano | findstr :80`）看占用进程。修法：把宿主端口改成 `127.0.0.1:8080:80`，对外统一交给第 8 章的反代；不要靠「关掉别的软件」解决。

**5. 服务起来了但健康检查一直不过，`ps` 显示 `unhealthy`。** 排查顺序：探针命令在容器里手动跑一次（`docker compose exec db sh -c "pg_isready -U blog"`）——镜像里没有 `curl`/`wget` 时 `CMD-SHELL` 那条会一直失败；`timeout` 比应用响应还短；`start_period` 没给够。注意官方那条「超时算一次失败」和「退出码 2 是保留的」，还有 `HEALTHCHECK` 只认最后一条。**这一步只能证明探针配置本身是好的，业务是否真的就绪仍要在装了 Docker 的机器上确认。**

## 练习

<Exercise title="练习 1 · 把五条 docker run 折叠成一份 compose.yaml" difficulty="基础">

给出一个 Node 后端 + Postgres + Nginx 反代场景的 `compose.yaml`：后端从源码构建、数据库数据必须活过重建、Nginx 加载同目录的 `nginx.conf`，并且只有 Nginx 对宿主暴露。写出文件后说明：哪些服务该有 `ports`、哪些不该，以及 `db` 的名字是怎么被 `app` 解析到的。

<template #answer>

骨架就是本章开头那份：`app` 用 `build` + `image`，`ports` 写 `"127.0.0.1:3000:3000"`（开发期直接看后端，生产删掉这行只留反代路径）；`db` **不写 `ports`**，因为它只被 `app` 在服务网络里访问，写到 `ports` 等于对宿主暴露一个数据库；`proxy` 写 `"80:80"`，`volumes` 用 `./nginx.conf:/etc/nginx/conf.d/default.conf:ro`。

服务名解析靠的是默认网络 `<项目名>_default` 上的内部 DNS：官方说每个服务会向内置 DNS 注册自己的名字，所以 `app` 里连 `postgres://db:5432/...` 就够，端口用**容器内**端口 5432，与 `ports` 完全无关。数据持久化靠顶层 `volumes: db-data:` 加服务里那行挂载；`nginx.conf` 用 bind mount 才能改完即生效（命名卷不适合放你要手改的文件）。

自查命令：`docker compose config` 看最终结构与路径展开、`docker compose up -d` 后 `docker compose ps` 应出现三行、`docker network inspect <项目>_default` 里三个容器都在。**这份文件我在本机没有运行过（无 Docker），以上是按官方语义写的配置，连通性与挂载效果需要你在装了引擎的机器上验证。**

</template>

</Exercise>

<Exercise title="练习 2 · 用 healthcheck 和长语法把启动竞态彻底关掉" difficulty="进阶">

本章实测显示「TCP 能连」到「返回 200」之间有 572ms 的窗口，真实数据库更久。请给 `db` 写一段 `healthcheck`，给 `app` 写对应的 `depends_on`，并说明：如果 `db` 起不来，`app` 会怎样；你希望「`db` 挂了我仍能单独起来调 `app`」该怎么改；以及为什么改完之后应用侧还是要保留重试。

<template #answer>

```yaml
  db:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 10s
      retries: 5
      start_period: 30s

  app:
    depends_on:
      db:
        condition: service_healthy
```

`test` 用 `CMD-SHELL`、变量写成 `$$` 让容器内 shell 展开（官方 postgres 示例原样）；`start_period: 30s` 让初始化期间的失败不计入 `retries`（官方规则），`timeout` 必须小于 `interval`。

`db` 起不来时，`app` **不会启动**——`service_healthy` 是硬门槛（默认 `required: true`）。要让它变成可选，官方给了 `required: false`（2.20.0）：`db` 不健康也不再拦 `app`，适合「先起前端调 UI」的场景。

**仍然要保留应用侧重试的理由**：健康门槛只覆盖「启动那一刻」的顺序。运行期数据库会重启、会短暂不可达、会被升级替换，这些都不在 `depends_on` 的管辖范围里；而且 `pg_isready` 通过只说明它能接受连接，不等于你的迁移已经跑完。所以启动顺序解决的是「第一次别撞墙」，重试解决的是「之后每一次」——两层都要有，缺任何一层都会在上面实测过的那类窗口里翻车。**本章没有 Docker，这段配置未在本机验证。**

</template>

</Exercise>

<Exercise title="练习 3 · 变量注入的四条通道，谁能盖住谁" difficulty="挑战">

场景：`compose.yaml` 里写了 `IMAGE_TAG: "0.1.0"`（`environment`）、服务另配了 `env_file: .env.staging`、项目目录有 `.env` 且里面也写了同名变量、你在 shell 里 `export` 了同一个变量。请回答：容器进程最终看到的是哪个值；`.env` 与 `env_file` 的区别是什么；`${VAR:?需要它}` 什么时候会让整份文件解析失败；以及你怎么在不启动容器的情况下验证答案。

<template #answer>

按官方优先级：给**容器进程**的值来自 shell > `--env-file` > 项目目录 `.env`（这是「变量从哪读」的顺序），而在同一个服务内同时存在 `env_file` 与 `environment` 时，**`environment` 优先**。所以进程最终看到的是 `environment` 里的 `0.1.0`（前提：那个名字写在 `environment` 里；如果文件里写的是 `${IMAGE_TAG}` 插值，则取上面那条「从哪里读值」的优先级，shell 的值胜出）。

`.env` 和 `env_file` 作用对象不同：`.env` 是给 **Compose 解析这份文件**用的（放在 `compose.yaml` 旁边，喂给 `${}` 插值），`env_file` 是把整个文件注入**容器进程**（可以是列表，自上而下）。官方还提醒 raw 格式的值不做插值，另外插值只作用于未加引号或双引号的值——所以 `'${HOME}'` 是字面量。

`${VAR:?错误}` 在变量**未设置或为空**时直接让解析失败并打印你写的错误信息（`${VAR?}` 只在未设置时报错）。这就是密钥的防线：`POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?数据库密码必须从环境注入}`，忘了设就起不来，而不是默默用一个空密码。

验证不需要启动容器：

```bash
IMAGE_TAG=0.9.9 docker compose config | grep -A3 IMAGE_TAG
docker compose config --environment
docker compose config ; echo "exit=$?"     # 未设必需变量时这里非 0 并打印你的错误文案
```

**这些行为我在本机没有跑过（无 Docker），依据是官方 Compose 文档的插值与优先级说明；`config` 的输出请在装了引擎的机器上核对。**

</template>

</Exercise>

## 官方文档与延伸阅读

- [Docker Compose 文档主页](https://docs.docker.com/compose/) —— 编排模型与命令总览。
- [Compose 文件参考](https://docs.docker.com/compose/compose-file/05-services/) —— 本章逐字引用的字段语义都在这一组页面：`version` obsolete、`healthcheck` 与 `HEALTHCHECK` 同默认值、`test` 的 `NONE`/`CMD`/`CMD-SHELL` 与 `disable: true`、`ports` 的 `[HOST:]CONTAINER[/PROTOCOL]` 与 base-60 引号告警、不写 host IP 绑 `0.0.0.0` 的防火墙警告、`network_mode: host` 不可映射端口、`depends_on` 的三种 `condition` 与 `required: false`（2.20.0）、`restart: true`（2.17.0）、`env_file` 与 `environment` 的优先级、顶层 `volumes` 才能复用、`subpath`（2.35.0）。
- [Compose 环境变量与插值](https://docs.docker.com/compose/environment-variables/) 与 [设置环境变量](https://docs.docker.com/compose/environment-variables/set-environment-variables/)、[env_file](https://docs.docker.com/compose/environment-variables/env-file/) —— 优先级（shell > `--env-file` > `.env`）、`${VAR:-}`/`${VAR:?}` 等语法、`$$` 转义、`config --environment`。
- [控制启动顺序](https://docs.docker.com/compose/how-tos/startup-order/) —— 「不等 ready 只等 running」这句官方告警与 `service_healthy` 的推荐做法、postgres 探针示例。
- [Compose 网络](https://docs.docker.com/compose/how-tos/networking/) —— 默认网络 `<项目>_default`、按服务名的内部 DNS、「用 CONTAINER_PORT 通信，宿主端口只给外部访问」「按名字而不是 IP 引用服务」。
- [卷](https://docs.docker.com/storage/volumes/) 与 [容器生命周期](https://docs.docker.com/engine/containers/run/) —— 卷是持久化的推荐机制、不自动删除、挂载遮盖镜像内既有数据；pre-stop 钩子只在 `down`/`Ctrl+C` 时运行。
- [Dockerfile 参考](https://docs.docker.com/reference/dockerfile/) —— `HEALTHCHECK` 的默认值、退出码 `0`/`1`/`2`、超时 SIGKILL、只认最后一条。
- [上一章：Docker 基础](/devops/docker-basics) —— 镜像分层、层缓存与多阶段构建；本章的 `build` 字段直接用它。

## 下一章

本章把「多容器」从五条命令折叠成一份文件：默认网络按服务名给 DNS、容器间用 CONTAINER_PORT、命名卷让数据活过重建、`.env`/`env_file`/`environment` 三条注入通道各有优先级、`depends_on` 长语法配 `healthcheck` 才真的等就绪（本机实测的 572ms 窗口就是短语法挡不住的那段）。**但到今天为止，所有事都发生在你自己这台机器上**：端口只对 `127.0.0.1` 可达、没有域名、没有证书、代码改动要靠手敲 `up -d --build`。

真实上线要补的是另外四件事：一台能被 SSH 进去的 VPS 怎么初始化（Linux 领域第 1～9 章的知识在这里汇合）、域名与 HTTPS 证书怎么签发续期、Nginx 怎么反代容器并把 WebSocket 一起带过去、以及怎么把「推代码 → 构建 → 部署」变成不用手敲的流程。下一章就从服务器初始化开始，把这份 `compose.yaml` 放到公网上去 → [部署到 VPS](/devops/deploy-to-vps)。
