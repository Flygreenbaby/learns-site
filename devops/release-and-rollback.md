# 回滚不是把 tag 改回去：版本要能比较，目标要能验证，迁移要能被旧版本接受

第 8 章把第一个版本推上服务器，本章处理第二次、第三次上线，以及第一次出事的时候。发布做得对不对，判据不是「上线成功了」，而是三件事同时成立：**版本号能被脚本比较大小**（否则清理脚本会把正在服务的 `1.10.0` 当最老的删掉）、**切过去的目标先被验证存在**（否则回滚会把指针切到一个仓库里根本没有的 tag 上）、**这次数据库改动旧版本还能接受**（否则镜像退回去了、每个写请求还在报错，**退无可退**）。主线沿用第 8 章那套：Docker Compose + VPS + Nginx，`IMAGE_TAG` 注入镜像，不另起架构。

<Callout type="verified" title="本章实测环境">

Windows 10 + Git Bash（bash 5.2.37）+ Node.js `v25.4.0`，核实时间 2026-10-20。本机**没有 Docker、没有 VPS、没有真数据库**，也没安装任何东西。实测的是流程里与服务器无关的四块逻辑：SemVer 比较与「不许悄悄退版」闸门（纯 bash）、发布目录 + `CURRENT` 指针的切换与清理纪律（真实文件系统）、就绪探测对 200 / 404 / 503 / 拒绝连接的判定（`node:http` 只绑 `127.0.0.1`）、Git 带注释 tag 与轻量 tag 的差别（临时仓库）。脚本与逐字输出在 `devops/.scratch/rr11-*`，临时目录与监听端口用完即删、末尾有清理核实。

</Callout>

<Callout type="unverified" title="所有 Docker、服务器与数据库动作都没有执行过">

`docker`、`docker compose`、`ssh`、`git push`、`psql`、`prisma` 本章一条都没跑过：本机 `command -v docker` 找不到，也没有可连的服务器。Docker 与 Compose 行为**全部按官方文档语义写成（逐字引用标了核实时间）**，脚本供你在服务器上执行；「镜像是否真的被重建」「回滚是否真的恢复了服务」只能在你的环境里确认。另两处标了「逻辑模型」的（tag→digest 解析、schema×旧应用兼容矩阵）是本机跑出来的 JS 模拟：结论是逻辑上的必然，但**不代表真数据库会报出一样的文案**。

</Callout>

## 版本号的价值是能被比较：SemVer 的三条硬规矩

官方逐字（semver.org，核实 2026-10-20）：

- 第 4 条：「A normal version number MUST take the form X.Y.Z… Each element MUST increase numerically. For instance: 1.9.0 -> 1.10.0 -> 1.11.0.」——**逐元素按数字增**，不是按字符串。
- 第 5 条：「Once a versioned package has been released, the contents of that version MUST NOT be modified. Any modifications MUST be released as a new version.」——发出去的版本号是**一次性**的。
- 第 12 条：「Build metadata MUST be ignored when determining version precedence.」——`1.0.0+a` 与 `1.0.0+b` 优先级相同。

这些规则在字典序下全部失效。下面这段比较器是所有闸门的地基，**整段实测过（文件顶部带 `set -euo pipefail`）**，可直接搬进 `deploy.sh`：

```bash
set -euo pipefail

semver_parse() {                 # $1 = 原始版本串；成功时填 SV_CORE / SV_PRE
  local v="${1#v}" pre="" build="" core id
  [[ $v == *+* ]] && { build="${v#*+}"; v="${v%%+*}"; }     # 构建元数据不参与优先级
  [[ $v == *-* ]] && { pre="${v#*-}";   v="${v%%-*}"; }
  if [[ ! $v =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
    return 1
  fi
  if [[ -n $pre ]]; then
    if [[ ! $pre =~ ^[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*$ ]]; then
      return 1
    fi
    local IFS=.
    for id in $pre; do
      [[ $id =~ ^0[0-9] ]] && return 1                      # 数字标识符不许有前导零
    done
  fi
  SV_CORE="$v"; SV_PRE="$pre"
  return 0
}

semver_cmp() {                   # 输出 -1 / 0 / 1；不合法返回 2
  semver_parse "$1" || { echo "非法版本: $1" >&2; return 2; }
  local core_a="$SV_CORE" pre_a="$SV_PRE"
  semver_parse "$2" || { echo "非法版本: $2" >&2; return 2; }
  local core_b="$SV_CORE" pre_b="$SV_PRE"
  local i
  local IFS=.
  local -a ca=($core_a) cb=($core_b)
  for i in 0 1 2; do
    if ((10#${ca[i]} > 10#${cb[i]})); then echo 1; return; fi
    if ((10#${ca[i]} < 10#${cb[i]})); then echo -1; return; fi
  done
  if [[ -z $pre_a && -z $pre_b ]]; then echo 0; return; fi
  if [[ -z $pre_a ]]; then echo 1; return; fi               # 正式版 > 预发布
  if [[ -z $pre_b ]]; then echo -1; return; fi
  local -a pa=($pre_a) pb=($pre_b)
  local n=${#pa[@]}
  if (( ${#pb[@]} < n )); then n=${#pb[@]}; fi
  local x y
  for ((i = 0; i < n; i++)); do
    x="${pa[i]}"; y="${pb[i]}"
    if [[ $x =~ ^[0-9]+$ && $y =~ ^[0-9]+$ ]]; then
      if ((10#$x > 10#$y)); then echo 1; return; fi
      if ((10#$x < 10#$y)); then echo -1; return; fi
    elif [[ $x =~ ^[0-9]+$ ]]; then
      echo -1; return                                     # 数字标识符优先级更低
    elif [[ $y =~ ^[0-9]+$ ]]; then
      echo 1; return
    else
      if [[ $x > $y ]]; then echo 1; return; fi
      if [[ $x < $y ]]; then echo -1; return; fi
    fi
  done
  if (( ${#pa[@]} > ${#pb[@]} )); then echo 1; return; fi
  if (( ${#pa[@]} < ${#pb[@]} )); then echo -1; return; fi
  echo 0
}

release_gate() {                 # 用法: release_gate <当前> <要发的> [allow-downgrade]
  local cur="$1" next="$2" force="${3:-}" d
  d="$(semver_cmp "$cur" "$next")" || return 3
  if (( d > 0 )); then                                     # cur 比 next 高 => 这是退版
    if [[ $force == allow-downgrade ]]; then echo "rollback(explicit)"; return 0; fi
    echo "refuse-downgrade: $cur -> $next"; return 1
  fi
  if (( d == 0 )); then echo "same(redeploy)"; return 0; fi
  echo forward
}
```

自检四组（官方预发布链、数字序 vs 字典序、非法输入、闸门），逐字摘录：

```text
官方链 7 对：PASS
1.9.0 vs 1.10.0        => -1   字典序排出来: 1.10.0 1.11.0 1.9.0
gate(1.10.0 1.9.0) => rc=1 refuse-downgrade: 1.10.0 -> 1.9.0
gate(1.10.0 1.9.0 allow-downgrade) => rc=0 rollback(explicit)
gate(latest 1.2.0) => rc=3
```

**最贵的一行是第二行**：`1.9.0` 和 `1.10.0` 谁新，字典序与数字序给的答案相反。要记住的不是它，而是：**任何用 `sort`、`ORDER BY`、字符串比较、`ls -t` 来「找最新版本」的脚本，都在赌版本号不会进位**。比较器故意接受一个前导 `v`（实测 `v1.2.0` 与 `1.2.0+build9` 判为相同），因为 Git tag 习惯带 `v` 而规范不承认它：**记录里存规范形式（`1.10.0`），tag 用 `v1.10.0`**。

## 镜像 tag 是一个可变的指针

Docker 官方说得毫不含糊（构建最佳实践，核实 2026-10-20）：「Image tags are mutable, meaning a publisher can update a tag to point to a new image.」「This publishing workflow is best practice… but it isn't enforced.」——**规范是约定，不是保证**。不 pin 就没有「an audit trail of the exact image versions that you're using」，而 pin 的代价是「you're opting out of automated security fixes」。

Compose 侧两个语法事实：`image` 的引用形式是 `[<registry>/][<project>/]<image>[:<tag>|@<digest>]`，**tag 与 digest 二选一**；「If the image does not exist on the platform, Compose attempts to pull it based on the `pull_policy`.」加上「The `latest` tag is always pulled even when the missing pull policy is used.」——反过来读就是：**带版本 tag 且本机已有，就不会自动重拉**。

逻辑模型跑一遍「同一个引用、两次解析出不同镜像」（本地 JSON 当仓库清单，不联网、不用 Docker）：

```text
latest 的解析历史（同一份 compose 文件、两次部署，镜像其实换了）：sha256:aaa111 → sha256:bbb222
回滚 =「把 IMAGE_TAG 改回 latest」=> 与当前值相同，配置与镜像都没变，按官方 up 的语义不会重建容器
若有人重推 1.2.0：sha256:aaa111 → sha256:zzz999 ← 版本号相同内容不同，这就是必须记 digest 的原因
```

**`IMAGE_TAG=latest` 时，「回滚」这条命令什么都不做**：官方对 `up` 的语义是「If there are existing containers for a service, and the service's configuration or image was changed after the container's creation, docker compose up picks up the changes by stopping and recreating the containers」。所以第 8 章那行配置要这样理解：

```yaml
services:
  app:
    image: registry.example.com/myblog/app:${IMAGE_TAG:?部署必须指定镜像 tag}
```

`IMAGE_TAG` 每次传**规范形式的版本号**（`1.10.0`），永远不传 `latest`。digest 的角色是**证据**：记录里写「`1.10.0` = `sha256:…`」，事后用来证明部署的是哪次构建；官方 pin digest 的建议针对**基础镜像**，自家应用用「不可变的版本 tag + 记录 digest」更好读。取 digest 的通道本机测不了（无 Docker），官方也没给可抄的字段样例：从 `docker image inspect` 的 JSON 里自己找字段，或以 CI 推送日志那行为准。

## 发布前检查：四道闸门

| 闸门 | 命令 | 通过判据 | 状态 |
| --- | --- | --- | --- |
| ① 版本号合法且不后退 | `release_gate "$CUR" "$NEW"` | 输出 `forward` 或 `same(redeploy)` 且退出码 0 | 实测 |
| ② 部署脚本语法 | `bash -n deploy.sh` | 退出码 0（第 8 章实测：只查语法不执行） | 实测 |
| ③ 要发的镜像存在 | 先 `pull` 再 `up` | `pull` 退出码 0 | 官方语义，未实测 |
| ④ 迁移是 expand 且旧应用可跑 | 下面那张矩阵 | 旧版读得到它要的列，写得不撞非空约束 | 逻辑模型实测，真库未实测 |

用法是 `release_gate "$CUR" "$IMAGE_TAG"`，`CUR` 从发布记录里读（见文末 `release.sh`），不从记忆里读——非 0 退出时 `set -e` 直接把流程断掉。②值得单列：闸门脚本自己语法错时，最坏结果不是「部署失败」，而是**整段检查被静默跳过**。

tag 与提交的绑定用带注释 tag（`git-tag` 手册，核实 2026-10-20）：「Annotated tags are meant for release… some git commands for naming objects (like git describe) will ignore lightweight tags by default.」「Unless -f is given, the named tag must not yet exist.」

临时仓库实测（逐字摘录，前两行来自 `git for-each-ref` 的 `objecttype`）：

```text
rel-1.0.1 -> tag
v1.0.0 -> commit
fatal: tag 'v1.0.0' already exists
rc=128
只有轻量 tag：git describe        = fatal: No annotated tags can describe '81ef635ad05c10e6e42ded3f2b45b27f755a18f7'.
However, there were unannotated tags: try --tags.
```

结论：`git describe` 默认不认轻量 tag；重复打同名 tag 被拒（`rc=128` 是 `pipefail` 下管道的真实退出码）——**这个「拒」是 SemVer 第 5 条唯一在你手上的防线**；但加 `-f` 就把 tag 移走了，实测 `git tag -f -a -m "moved!" rel-1.0.1` 没有任何报错，**git 拦不住重推**。

## 发布策略在单机 Docker 上能做到什么程度

滚动与蓝绿这两个词**没有权威定义可逐字引用**，本站按通行用法描述（概念梳理，不是官方口径）。

| 策略 | 需要几个实例 | 一台 VPS + Compose 的现实 |
| --- | --- | --- |
| 滚动发布（新老短暂共存） | ≥2 | 做不到，你只有一份容器；且新老必须能同时跑 → 只能 expand |
| 蓝绿（两套环境一次性切换） | 2 份应用 + 切换层 | 半做得到，见下；共用一份库 → 必须 expand |
| 重新部署 + 快速回退 | 1 | **本章主线**；迁移必须允许旧版本继续跑 |

两处卡点让它只算「半做」：宿主端口是全局的，两套容器会抢 80/443，只能靠宿主 Nginx 切上游；数据库只有一份，等于强制所有迁移都是 expand。所以**第一期不要做蓝绿**：把「换镜像 + 就绪探测 + 一条命令退回上一个版本」做扎实，有了第二个实例，滚动和蓝绿的前提才第一次成立。

## 回滚的状态机：先验证目标，再动指针

回滚的实现形式可以很多，正确性只取决于下面三条纪律。用「发布目录 + `CURRENT` 指针」这套通用布局在真实文件系统上跑一遍（逐字摘录）：

```text
{"ok":true,"current":"1.2.0","artifact":"1.2.0"}
失败分支：切到没准备好的 1.3.0 => {"ok":false,"why":"target-missing","current":"1.2.0"}（指针仍是 1.2.0，没被改成坏值）
回滚到底（只剩一版）=> {"ok":false,"why":"no-previous","current":"1.0.0"}
prune(keep=2) => {"kept":["1.10.0","1.9.0","1.3.0"],"deleted":["1.2.0","1.1.0","1.0.0"]}
```

1. **目标不存在就失败，且失败发生在任何改动之前**，指针保持原值。Docker 侧 `IMAGE_TAG` 可能压根没推上去，所以**先 `pull` 成功再 `up`**（`--pull always` 更保险，未实测）。
2. **回滚要有「上一个」可回**：只剩一版时报 `no-previous`，不是静默成功。服务器上至少留两个可用镜像 + 两条记录。
3. **清理不许删掉 current 和 previous**：实测 `keep=2` 留下 `1.10.0`、`1.9.0`、`1.3.0`；**排序必须用比较器**，按字典序排 `1.10.0` 会被当最老的删掉——第一节那句「赌不会进位」的落地后果。

`up` 的退出码语义决定脚本能不能信（官方 `docker compose up` 参考，逐字）：「If the process is interrupted using SIGINT (ctrl + C) or SIGTERM, the containers are stopped, and the exit code is 0.」——**你 Ctrl-C 之后它返回 0，但容器已经被停了**（出错时退出码是 1），写 `docker compose up -d && echo 部署成功` 就会打印假成功。`--wait` 只看 Compose 层面的 healthy，不知道迁移跑没跑完、接口通不通，所以下一节那个探测仍要自己做。

## 发布失败识别：探哪个路径、超时怎么算

`node:http` 起真服务，四种情形各测一次（逐字摘录）：

```text
慢启动(前 2 次 503) 探测 /healthz => {"ok":true,"attempts":3,"last":"HTTP 200","ms":350}
一直 503 探测 /healthz => {"ok":false,"attempts":6,"last":"HTTP 503","ms":947}
没有 /healthz 的旧版本：探 /healthz => {"ok":false,"attempts":5,"last":"HTTP 404","ms":548}
同一服务探首页 => {"ok":true,"attempts":1,"last":"HTTP 200","ms":1}
进程已退出（端口关）探 /healthz => {"ok":false,"attempts":5,"last":"ECONNREFUSED","ms":546}
```

```js
async function probe(url, { deadlineMs, intervalMs }) {
  const t0 = Date.now()
  let attempts = 0, last = null
  while (Date.now() - t0 < deadlineMs) {
    attempts++
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) })
      last = 'HTTP ' + r.status
      if (r.ok) return { ok: true, attempts, last, ms: Date.now() - t0 }
    } catch (e) { last = e.cause?.code || e.name + ': ' + e.message }
    await new Promise(r2 => setTimeout(r2, intervalMs))
  }
  return { ok: false, attempts, last, ms: Date.now() - t0 }
}
```

实测跑的是函数本身，`ready-check.mjs` 那层 CLI 壳没跑过。读法：**首页 200 不算就绪**（第四行 1 ms 就「成功」，答你的可能只是 Nginx 默认页）；**一直 503 到超时是失败**（别因为「进程在听」就报成功）；`404` / `503` / `ECONNREFUSED` 是三种不同的坏法：**探针路径不存在**（版本不对或这版没实现 `/healthz`）、**起了但没就绪**（迁移没跑完、依赖连不上）、**进程不在了**（崩溃循环或没起来）。

还有个自反的坑：**回滚之后你用什么判据确认恢复？** 如果 `/healthz` 是新版才加的，退到旧版会得到实测那种 `404`，判据自己失效。所以 `/healthz` 得在**所有还留在服务器上的版本里都存在**，否则把判据降级成「非 5xx 且响应里能读到当前版本号」，并把降级规则写进预案。恢复判据按顺序看（前两条本机测过，其余只能在服务器上看）：`/healthz` 里的版本 = 要退到的那个、`probe()` 返回 `ok:true` 且 `attempts` 是个位数、`docker compose ps` 是 `Up (healthy)` 而非 `Restarting`、`docker compose logs --since 5m app` 里没有反复的启动横幅。

## 数据库迁移为什么让「退回旧镜像」变成一句空话

镜像是**只读快照**，退回去就是那份文件系统；数据库是**共享的可变状态**，新版写过的东西旧版接着要用。逻辑模型把五种 schema 变更对「回滚后的旧应用」的影响测出来（JS 里的列定义与写入校验，不是数据库；`app_v1` 读写 `name`，`app_v2` 读写 `name`+`nickname`）：

| schema 状态 | 回滚后跑旧应用 `app_v1` | 说明 |
| --- | --- | --- |
| `v1`：只有 `name`，可空 | 三个判据全 `null` | 没做过迁移，当然能退 |
| `v2_expand`：加 `nickname` 且可空 | 全 `null` | **只有这一种可回滚** |
| `v2_notnull`：加 `nickname` 且非空 | `insertFails:["nickname"]` | 旧应用插入时不填它 → 每次新建都失败 |
| `v2_tighten`：把 `name` 也收紧为非空 | `insertFails:["nickname"]` | 见下面那条模型测不到的注意 |
| `v3_rename`：`name` 改名 `display_name` | `readFails:["name"], writeFails:["name"]` | 重命名后旧应用连读都读不到 |

对照行也测了：`schema=v1` 跑 `app_v2` 得 `readFails:["nickname"]`——**新版没先 expand 就发出去，是同一类错误的另一半**。`v2_tighten` 还暴露了模型的边界：被收紧的 `name` 旧应用本来就写它，模型判它没问题，**但真库里只要有一行是 NULL，加非空约束在 ALTER 那一刻就失败**，等不到回滚。删列不可逆实测出来了：删前 `[{"id":1,"name":"a","nickname":"nick"}]`，删后 `[{"id":1,"name":"a"}]`——真库的等价动作是 `ALTER TABLE … DROP COLUMN`，本章没有数据库可执行它。

Prisma 当前文档（ORM 8，核实 2026-10-20）逐字：「Prisma ORM has no migrate down command and no "down migration" files… To undo a change you add a new migration to your migration history… If you know git, this is git revert rather than git reset」「db migrate runs destructive operations without asking you to confirm」。v7 的 down migration 只对**失败的 up** 有效，且「other changes to data and application code… will not be reverted」——**连 v7 也只退结构，不退数据和应用代码**（工具用法在 [Prisma 深入](/data-storage/prisma-deep-dive)）。

合起来就是发布顺序的硬约束：

```text
① expand 迁移（加可空列 / 新表，旧版能无视） → ② 切镜像到新版 → ③ 观察窗口
                                                                  ↓ 出事
                        退镜像到上一个版本 ← ④ 只退镜像，数据库不动
```

**contract（删列、改名、收紧约束）必须单独一次发布**，且要在「新版已稳定、且你确定不再回滚到旧版」之后。contract 一做完，旧镜像就永久不可退——不是「回滚很麻烦」，是表里那三行 `insertFails` / `readFails`。真正的退路在**数据层**：contract 之前要有一次**刚验证过能恢复**的备份（`pg_dump` 一类，服务器动作，未实测）。列能加回来，值退不回来。

## 把流程固化：release、rollback 与发布记录

两个脚本都是**按第 8 章那套 SSH + Compose 写的模板**：`ssh`、`docker compose` 段落本章没执行过；比较器、闸门、退出码判定是实测过的。

```bash
#!/usr/bin/env bash
set -euo pipefail
trap 'echo "失败发生在第 ${LINENO} 行附近，看上面最后一条命令"' ERR
IMAGE_TAG="${1:?用法: ./release.sh <规范形式的版本号，如 1.10.0>}"
HOST="${DEPLOY_HOST:?必须在环境里给出部署主机}"
source "$(dirname "$0")/lib-semver.sh"     # 上面那三个函数放这里，别在两个脚本各拷一份

ssh -o BatchMode=yes "deploy@${HOST}" bash -s -- "${IMAGE_TAG}" <<'REMOTE'
set -euo pipefail
cd /srv/myblog && source lib-semver.sh
C() { docker compose -f compose.yaml -f compose.production.yaml "$@"; }
IMAGE_TAG="$1"
CUR="$(sed -n 's/.*current=\([^ ]*\).*/\1/p' RELEASES.txt | tail -1)"
release_gate "$CUR" "$IMAGE_TAG"                       # 闸门 ①
export IMAGE_TAG
C pull app                                             # 闸门 ③：镜像不存在在这里失败
C up -d --wait --wait-timeout 120 app
REMOTE

node ready-check.mjs "https://app.example.com/healthz" 120000 \
  || { echo "就绪判定没过，立刻回滚"; ./rollback.sh; exit 1; }
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) current=${IMAGE_TAG} image=${IMAGE_DIGEST:-unknown} migrations=${MIGRATIONS:-none} result=${READY}" >> RELEASES.txt
git tag -a "v${IMAGE_TAG}" -m "release ${IMAGE_TAG}" && git push --tags
```

回滚脚本更该短——出事时你读长文档的能力很差：

```bash
#!/usr/bin/env bash
set -euo pipefail
# previous = 历史里倒数第二个 current；不靠人脑记忆，手填就会填错
H=/srv/myblog/RELEASES.txt
PREV="${1:-$(sed -n 's/.*current=\([^ ]*\).*/\1/p' "$H" | tail -2 | head -1)}"
[ -n "$PREV" ] || { echo "记录里找不到上一个版本，不要盲退"; exit 1; }
ssh -o BatchMode=yes "deploy@${DEPLOY_HOST:?}" \
  "cd /srv/myblog && export IMAGE_TAG='${PREV}' && \
   docker compose -f compose.yaml -f compose.production.yaml pull app && \
   docker compose -f compose.yaml -f compose.production.yaml up -d --wait app"
node ready-check.mjs "https://app.example.com/healthz" 120000
```

退之前先回答矩阵里那个问题：**这次发布做过 contract 吗？** 做过就别退镜像（会退成 `readFails` / `insertFails` 那个形态），要么往前修，要么按备份恢复数据——两个不同的决定，别混成「先退退看」。发布记录五个字段，写不出前四个就不要点部署：

```text
2026-10-20T08:12:03Z current=1.10.0 image=sha256:7f3a… migrations=0007_add_nickname_null result=ready(2,HTTP200)
```

`result` 记**就绪探测返回的 attempts 与状态**，不是「成功」两个字——半年后你想知道的是当时等了几次；取不到 digest 就先落成 `unknown`，也比不写强。第 10 章那条「故意部署一个坏版本、5 分钟内退回」的演练产出的就是这行记录——没演练过的 previous 不算退路。

## 常见错误与排查

**1. 现象：脚本说「要发的 1.10.0 比当前 1.9.0 旧」并拒绝发布，或清理时把正在服务的版本删了。** 原因：用了字典序（`sort`、`ORDER BY tag`、`ls -t`、`Array.sort()`）。确认：比较器与 `sort` 各跑一遍同一组版本（实测两个答案不同）。修法：「找最新」一律显式数字比较（`semver_cmp` 或 `sort -V`），段数补齐（`1.11` 实测被拒）。

**2. 现象：`IMAGE_TAG=latest`，回滚退出码 0、`ps` 显示 Up，问题还在；或「明明重跑了部署」，机器上还是旧代码。** 同一根子的两种表现：引用没变就没有 changed，不满足官方 `up` 的重建前提；本机已有同名 tag 时 Compose 不重拉，根子上是有人重推了 `1.2.0`（违反第 5 条，git 与 registry 都不拦）。确认：记录里两次部署的 digest 是否相同。修法：`IMAGE_TAG` 只收规范 SemVer，`latest` 绝不进闸门（实测 rc=3）；坏版本发新号（`1.2.1`）而不是重推；要拉新镜像就显式 `pull`（`--pull always`，未实测）。

**3. 现象：脚本打印「部署成功」，用户访问却是 502 或旧版本。** 原因：把 `up -d` 的退出码当就绪信号——Ctrl-C 打断时容器已被停、退出码仍是 0。修法：`--wait` 只当第一层，后面接自己的 HTTP 探测并按三种失败形态判定；`trap … ERR` 放脚本开头（第 8 章实测：不加 `-e` 失败行后面照跑）。

**4. 现象：回滚后旧版本每个写请求都失败（约束被违反或某列不存在，文案取决于数据库，本章无真库不可复现）。** 原因：这次迁移做了 contract，就是矩阵里 `v2_notnull` / `v2_tighten` / `v3_rename` 三行。确认：`psql` 里 `\d 表名` 对照旧版代码用到的列。修法：**不要试图退库**；往前修一个放开约束或补回列的迁移，或按 contract 前的备份恢复数据（服务器动作，未实测）。

**5. 现象：回滚脚本在 `pull` 那步就失败，或 `git describe` 报 fatal、构建号取不到。** 前者是要退的 tag 已不在仓库、脚本没先验证目标（状态机实测 `target-missing`：失败发生在改动之前）；后者是仓库只打了轻量 tag（实测加 `--tags` 才回 `v1.0.0`）。修法：`rollback.sh` 先 `pull` 再 `up`，registry 保留策略覆盖 current + previous；发布统一 `git tag -a`，CI 用 `git describe --tags --dirty`。

## 练习

<Exercise title="判断这些版本号能不能放行" difficulty="基础">

候选 tag：`1.9.0`、`1.10.0`、`v1.11.0`、`01.12.0`、`1.11`、`latest`、`1.10.0-rc.1`、`1.10.0+build.7`。服务器当前服务的是 `1.10.0`。回答：(1) 哪些不是合法 SemVer？(2) 剩下的过一遍闸门，各输出什么？(3) 用字典序清理、`keep=2`，会发生什么？

<template #answer>

(1) `01.12.0`（数字段不许有前导零）、`1.11`（必须三段）、`latest`（不是版本号）——实测三类都在解析层被拒（`rc=2`）。`v1.11.0` 规范上也不合法，但比较器故意剥一个前导 `v`，所以能参与比较；记录里仍要存 `1.11.0`。

(2) `1.9.0` → `refuse-downgrade`（rc=1）；`1.10.0` → `same(redeploy)`；`v1.11.0` → `forward`；`1.10.0-rc.1` → `refuse-downgrade`（正式版高于它的预发布）；`1.10.0+build.7` → `same(redeploy)`（第 12 条）；`latest` → rc=3。

(3) 实测 `printf '%s\n' 1.9.0 1.11.0 1.10.0 | sort` 给 `1.10.0 1.11.0 1.9.0`：**`1.9.0` 排在最末**，「取末尾两个当最新」会把正在服务的 `1.10.0` 删掉；数字序 `keep=2` 实测留 `1.10.0,1.9.0,1.3.0`。**清理与「找最新」都必须用比较器，且 current / previous 要在删除名单之外**。

</template>

</Exercise>

<Exercise title="设计一次不会把自己堵死的迁移与发布顺序" difficulty="进阶">

你要给文章表加 `nickname`（新版要求非空），并把 `slug` 改名为 `post_slug`。回答：(1) 能一次性发上去吗？(2) 拆成可回滚的步骤序列，逐步标出「出事时能不能退回上一个版本」。(3) 哪个动作做完就再也退不回去，在那之前你必须有什么？

<template #answer>

(1) 不能。一起发之后回滚，数据库停在 contract 之后：旧应用读写 `slug` → 对应实测 `v3_rename` 行；`nickname` 非空 → 对应 `v2_notnull` 行的 `insertFails:["nickname"]`。矩阵里只有 expand 那一行全 `null`，也就是**只有「加可空列」这一种迁移允许你退镜像**。

(2) ① `ADD COLUMN nickname TEXT`（可空、无约束）——可退，旧版看不见这列；② 发新版应用，读写 `nickname` 但**不要求非空**，同时读写 `slug` 与 `post_slug`（双读双写）——可退；③ 数据回填（`UPDATE … SET post_slug = slug`，可重复执行）——可退；④ 确认不再需要退回旧版之后，单独一次发布做 contract。每步判据都是「上一个版本的应用在这个 schema 上还能跑」，也就是拿那张矩阵逐行核对。

(3) **④ 做完就退不回去**：删列的实测是删前有 `nickname`、删后整个字段消失，真库等价动作是 `ALTER TABLE … DROP COLUMN`（本章无数据库可执行）。所以 ④ 之前必须有一次**刚验证过能恢复**的备份，不是「上次备份过」，且 ④ 要单独占一个发布窗口。

</template>

</Exercise>

<Exercise title="写一份回滚预案并把它证伪" difficulty="挑战">

为第 8 章那套 VPS + Compose 应用写一份不超过 10 行的回滚预案，必须含：触发条件、决策分支（退镜像 / 往前修 / 恢复数据三选一）、执行命令、恢复判据、记录字段。再设计一个证伪实验：故意让预案里**恰好一条**判据失效，验证流程会走对分支而不是静默通过。

<template #answer>

参考形态（`previous` 从发布记录派生，不靠人脑）：

```text
触发：就绪探测 ok=false（404 / 503 / ECONNREFUSED 三种分开记），或错误率突增且起点≈部署时间
决策：本次发布含 contract 迁移？ 是 → 不许退镜像，走「往前修」或「按备份恢复」；否 → 退镜像
执行：./rollback.sh（内部：读 previous → pull → up -d --wait app）
判据：healthz 返回上一版号 + probe ok=true + docker compose ps 全 Up(healthy) + 日志无重启循环
记录：时间 current image-digest 迁移号 result(attempts,状态)
```

三处最容易写成「静默通过」的地方，逐个证伪：

1. **previous 指向不存在的 tag**：把记录里上一个版本改成没推过的 `1.8.0`，期望 `pull` 失败、停在 `up` 之前、线上仍是坏的那版——实测 `target-missing` 分支正是测它：失败必须发生在改动之前。
2. **恢复判据自反失效**：只有新版有 `/healthz`，退到旧版探测得 `404`（实测形态）→ 你以为回滚失败又退一次，把好版本也弄丢。修法：判据降级成「非 5xx 且能读到版本号」，并写死在预案里。
3. **决策分支写漏**：假装这次发布做过 contract 再按预案退镜像，期望旧应用立刻进入写失败（`insertFails:["nickname"]`）——不需要真数据库就能在逻辑模型里跑出来。

真机上按第 10 章的验收要求演练一次：部署坏版本、计时退回、把结果写进记录——那才是「有退路」的证据。

</template>

</Exercise>

## 官方文档与延伸阅读

- [语义化版本 SemVer 2.0.0](https://semver.org/) —— 第 4/5/6/7/12 条与 Precedence 一节。
- [镜像构建最佳实践](https://docs.docker.com/build/building/best-practices/) 与 [Compose 文件参考 · services](https://docs.docker.com/compose/compose-file/05-services/) —— tag 可变、审计线索、pin digest 的代价；`[:<tag>|@<digest>]`、`pull_policy`、`latest` 的例外。
- [`docker compose up` 参考](https://docs.docker.com/reference/cli/docker/compose/up/) —— 重建前提、`--pull`、`--wait`、退出码 1 与 SIGINT/SIGTERM 后仍为 0。
- [git-tag 手册](https://git-scm.com/docs/git-tag) 与 [git-describe 手册](https://git-scm.com/docs/git-describe) —— 两类 tag、`-f`、`describe` 忽略轻量 tag、`--dirty`。
- [Prisma · Rollbacks and recovery](https://www.prisma.io/docs/orm/migrations/rollbacks-and-recovery) 与 [Prisma v7 · Generating down migrations](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/generating-down-migrations) —— 没有 down migration、破坏性操作不询问。
- 站内：[上一章：部署到 VPS](/devops/deploy-to-vps)、[Docker Compose、卷与网络](/devops/docker-compose)、[语义化版本与锁文件](/frontend-engineering/semver-and-lockfile)、[迁移与版本管理](/database/migrations)、[备份与恢复](/database/backup-and-restore)、[服务部署：Docker、优雅关闭与配置](/backend/docker-and-shutdown)、[Linux 第 9 章 日志与故障定位](/linux/logs-and-troubleshooting)。

## 下一章

版本能被比较、指针能被验证、迁移知道能不能退——纸面上是一条纪律，真机上是一次演练。第 10 章把第 8 章的上线链路和本章的发布回滚合进一条流水线，最重要的验收项是「故意部署一个坏版本，5 分钟内退回上一个可用版本，并记录操作步骤」→ [阶段项目：完整部署上线](/devops/project)。把流程交给机器自动执行的是还没写的 [CI/CD 与 GitHub Actions](/devops/ci-cd)；敢不敢在周五下午点那个部署按钮，取决于还没写的 [测试体系](/devops/testing)。
