# 认证：把「你是谁」这件事钉死在服务器侧

一个用户注册后再也登不进来，你把源码翻了一遍，发现密码字段存的是 `e10adc3949ba59abbe56e057f20f883e`——那正是 `123456` 的 MD5。拖库的人连彩虹表都不用查，这串值在很多「弱口令对照表」里是第一条。**明文密码从没进过数据库，但它照样等于泄露了**：哈希快、不加盐、可反查，三者叠加就够把整库口令还原。

第二类故障更隐蔽：登录明明成功了，`Set-Cookie` 也发了，可用户刷新页面又变回未登录。原因往往不是 Cookie 没种上，而是你把会话存进了进程的 `Map`，负载均衡把下一次请求打到了另一个实例。第三类：会话在服务器里活得好好的，用户点了「退出登录」，前端只删了本地 Cookie，攻击者拿着之前抓到的那串 id 继续访问——**你没让服务端的那条会话失效，就永远没有真正的登出**。

认证（authentication）解决的是「来者是不是它声称的那个人」，它和「他有没有权限做这件事」（授权，见[授权与权限：RBAC 与越权防护](/backend/authorization)）是两码事。前置的[统一错误处理](/backend/error-handling)决定了认证失败该怎么返回一个不泄露信息的 401；本章负责把「身份」这件事从不可信的浏览器手里，搬到你自己能控制的服务器侧。核心只有一句话：**服务器不信任任何来自客户端的自我声明，只信任它自己签发、自己存储、自己能撤销的东西。**

## 一次登录的完整往返：每个 Cookie 属性各防谁

登录态的本质是：服务器生成一串高熵、不可预测的 **会话 ID（session id）**，把它和「这个 id 对应哪个用户」存进服务端存储，再通过 `Set-Cookie` 响应头把这串 id 交给浏览器；此后浏览器每个请求都在 `Cookie` 请求头里自动带回它，服务器查存储就知道是谁。整个链条如下：

```text
浏览器                                   服务器
  │  POST /login  {email, password}        │
  │ ─────────────────────────────────────► │  校验口令（慢哈希比对）
  │                                        │  生成 sid = crypto.randomBytes(32)
  │                                        │  存储：sessions[sid] = {uid, ...}
  │  200  Set-Cookie: sid=...; HttpOnly;   │
  │      Secure; SameSite=Lax; Path=/;     │
  │      Max-Age=1800                      │
  │ ◄───────────────────────────────────── │
  │  GET /me  Cookie: sid=...              │
  │ ─────────────────────────────────────► │  查 sessions[sid] → uid → 返回
```

`Set-Cookie` 的每个属性不是装饰，各挡一类攻击。下表是本章据 [MDN Set-Cookie 文档](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)（2026-10-18 读取）整理的效果：

| 属性 | 实际效果 | 防的是谁 | 漏配的代价 |
| --- | --- | --- | --- |
| `HttpOnly` | 浏览器 JS 用 `document.cookie` 读不到它（但仍会随 `fetch` 自动发出） | XSS 窃取会话 | 一个 XSS 就能把会话 id 发去攻击者服务器 |
| `Secure` | 只在 HTTPS 下发送（`localhost` 例外） | 明文 HTTP 中间人抓包 | 内网/公共 WiFi 下会话被顺走 |
| `SameSite=Lax` | 跨站「顶级导航的 GET」才带；跨站 POST/AJAX/子资源不带 | CSRF（默认值，多数浏览器已按 Lax） | 无此约束时任何第三方页面能带着你的 Cookie 发请求 |
| `SameSite=Strict` | 任何跨站请求都不带，连从邮件点进你站的第一跳也不带 | 更强的 CSRF | 从站外链接首次进入时「像是没登录」，体验受损 |
| `SameSite=None` | 明确允许跨站携带 | —— | **必须同时带 `Secure`**，否则浏览器直接丢弃该 Cookie |
| `Path=/` | 全站路径都携带 | —— | 不写时默认取当前请求 URL 的路径段，可能只覆盖半棵树 |
| `Max-Age` / `Expires` | 有=持久 Cookie；都省略=会话 Cookie（关浏览器即清） | —— | 二者都给时 `Max-Age` 优先；`Max-Age<=0` 立即过期 |
| `Domain` | 扩大可见域到该域及其子域 | —— | **省略才是「仅当前主机」的 host-only Cookie**；乱设会让子域都能收到 |
| `__Host-` 前缀 | 名字以此开头的 Cookie 必须 `Secure`、无 `Domain`、`Path=/` | Cookie 注入 / 子域串改 | 多租户子域场景里防止别的子域伪造会话 Cookie |

一个安全的最小签发写法：

```js
res.setHeader('Set-Cookie',
  `__Host-sid=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1800`);
```

<Callout type="verified" title="本章 Cookie 解析与篡改实验是本机跑出来的">

Windows 10 x64 + Node v25.4.0，2026-10-18，全程只用 `node:` 内置模块。实验用一个手写 `parseCookie(header)` 解析请求头，并把一段「把 `{uid, role}` 用 base64url 编码塞进 Cookie」的无状态会话，与一份「同样的载荷再加 HMAC-SHA256 签名」的会话做对照。如实说明：`parseCookie` 是我自己按 RFC 6265 的宽松子集实现的，只处理 `k=v;` 与 `decodeURIComponent`，不覆盖引号包裹值等边角；下节结论都建立在这次真实运行输出上。

</Callout>

## 篡改实验：base64 不是加密，签名才能挡住改

「把用户信息直接编码进 Cookie、服务器解出来就信」是新手最常见的无状态认证写法，它看着像加密，其实只是编码。实跑对照：

```text
[未签名] 原始 cookie: session=eyJ1aWQiOjQyLCJyb2xlIjoidXNlciJ9
[未签名] 服务器读回:   { uid: 42, role: 'user' }
[未签名] 篡改后读回:   { uid: 42, role: 'admin' }   <-- 越权成功

[已签名] 正常读回:     { uid: 42, role: 'user' }
[已签名] 篡改后读回:   { __error: '签名不匹配，会话作废' }   <-- 被挡住
```

`eyJ1...` 是 `{"uid":42,"role":"user"}` 的 base64url，任何人 `atob` 一解就懂、改完再编码回去就行；把 `role` 从 `user` 改成 `admin`，未签名的服务器照单全收。签名版给载荷附一段 `HMAC-SHA256(payload)`，攻击者没有服务器密钥就伪造不出对应签名，`timingSafeEqual` 一比就露馅、会话作废。代码形状：

```js
import crypto from 'node:crypto';
const SECRET = crypto.randomBytes(32);            // 生产里来自密钥管理，绝不能进 Git
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');

function makeSigned(obj) {
  const p = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `session=${p}.${sign(p)}`;
}
function readSigned(header) {
  const raw = Object.fromEntries(header.split(';').map((s) => {
    const i = s.indexOf('='); return [s.slice(0, i).trim(), decodeURIComponent(s.slice(i + 1).trim())];
  }));
  if (!raw.session) return null;
  const [p, sig] = raw.session.split('.');
  const expect = sign(p);
  // 定长 HMAC 输出，长度天然相等，可直接比较；变长内容务必先比长度
  const ok = sig && sig.length === expect.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
  return ok ? JSON.parse(Buffer.from(p, 'base64url').toString()) : { __error: '签名不匹配，会话作废' };
}
```

即便加签，也**别把会变的状态（角色、余额）放进自包含 Cookie**：签了名的 Cookie 一旦签发，在过期前改不动、也撤销不了——你把某用户降权，他手上的签名 Cookie 仍带着 `role:admin`。要能立即失效，就必须把状态放回服务端存储、Cookie 里只留一个随机 id。**自包含凭证（签名 Cookie / JWT，见[JWT 与 OAuth](/backend/jwt-and-oauth)）的代价就是「撤销难」**，这不是可以忽略的细节。

## 密码必须加盐慢哈希：每秒能试多少次说了算

口令一旦入库，就必须假设「数据库会被完整拖走」。防线不是「用哪种哈希」，而是**攻击者拿到库后每秒能试多少口令**。实测对照（本机、单线程、`scryptSync` 用 `maxmem:256MiB`）：

```text
SHA-256  1000 次耗时 13.82 ms  => 每秒约 72,366 次
scrypt   单次耗时    71.67 ms  => 每秒约 14 次
（同一批数据下 scrypt 相对裸 SHA-256 慢约 5000 倍）
```

72,366/s 意味着攻击者用一块 GPU + Hashcat，一晚上能把「8 位纯数字」空间穷举干净；14/s 意味着同样的算力，试一个口令要 70 毫秒。慢哈希不是「让登录变慢」，而是**把穷举成本抬高四五个数量级**。三条设计原则：

1. **必须加盐，且每人独立随机盐。** 盐让「同一个口令产生同一个哈希」不再成立，直接废掉彩虹表，也让攻击者无法对全库一次穷举——他必须逐个口令重新算。用 `crypto.randomBytes(16)`，盐可以明文存在哈希串里（它不是密钥）。
2. **必须用专门的慢哈希，不是通用哈希。** SHA-256 / SHA-512 / MD5 是「越快越好」设计的，拿来存口令等于自杀；MD5 还另有碰撞问题。
3. **参数要能随算力上调，并把参数存在哈希串里。** 这样今天算的哈希，明天用更大参数校验也不冲突。

三种主流算法的取舍（**本章只实测了内置的 `scrypt`；`argon2id` / `bcrypt` 需要第三方库，后端章节不装依赖，以下结论据算法定义与 OWASP 建议写成，未在本机运行**）：

| 算法 | 类型 | 关键取舍 | 参数起点（以官方为准，动手前核对） |
| --- | --- | --- | --- |
| `scrypt` | CPU+内存硬 | Node 内置、无需依赖；`N` 越大越吃内存；**受 `maxmem` 限制**（见下） | `N=2^15..2^17, r=8, p=1` |
| `argon2id` | 密码哈希竞赛冠军，抗 GPU/ASIC 最全面 | 需原生扩展（`node` 内置无）；内存/迭代/并行三参数可调 | RFC 9106 推荐 `m=19456 KiB, t=2, p=1` |
| `bcrypt` | 老而稳，纯 CPU | **只吃前 72 字节口令**（超长口令会被静默截断）；无独立内存参数，抗 GPU 弱于 argon2 | cost `10..12`，随硬件上调 |

选型建议：新项目优先 `argon2id`；不想引第三方依赖就用内置 `scrypt`；`bcrypt` 能用但要清楚它的 72 字节截断。

### 陷阱：Node 默认 `maxmem` 会直接挡住推荐参数

scrypt 内存占用约 `128 × N × r` 字节。`N=2^15, r=8` 就是 32 MiB，而 **`crypto.scrypt` 的默认 `maxmem` 是 32 MiB**，算上开销刚好越界。实测默认参数：

```text
N=2^14 内存约 16 MiB  耗时 36.9 ms  OK
N=2^15 内存约 32 MiB  抛错: ERR_CRYPTO_INVALID_SCRYPT_PARAMS
N=2^16 内存约 64 MiB  抛错: ERR_CRYPTO_INVALID_SCRYPT_PARAMS
```

很多人照着文档写 `N=2^15` 却在本地一跑就报 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`，就是撞上了这道默认上限——它不是内存不足（OOM），是 Node 主动拒绝。想上更高档位必须显式抬高 `maxmem`，实测（`maxmem:256MiB`）的耗时阶梯：

```text
N=2^15  32 MiB  72.6 ms  每秒约 14 次
N=2^16  64 MiB  144.1 ms 每秒约 7 次
N=2^17  128 MiB 342.6 ms 每秒约 3 次
```

调参不是越高越好：登录接口每次都要算一遍，`N=2^17` 单人 342 ms 在注册/登录密集时是明显延迟，而且 `scryptSync` 会**阻塞事件循环**（[Node.js 运行时](/backend/node-runtime)里那条结论）。生产用异步 `crypto.scrypt`（回调版），把目标调到「在你最差的服务器上约 100–500 ms」即可。一个可入库、可校验的写法：

```js
import crypto from 'node:crypto';
const PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await new Promise((res, rej) =>
    crypto.scrypt(pw, salt, 32, PARAMS, (e, k) => (e ? rej(e) : res(k))));
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [, N, r, p, saltHex, keyHex] = stored.split('$');
  const salt = Buffer.from(saltHex, 'hex');
  const key = await new Promise((res, rej) =>
    crypto.scrypt(pw, salt, keyHex.length / 2, { N: +N, r: +r, p: +p, maxmem: 256 * 1024 * 1024 },
      (e, k) => (e ? rej(e) : res(k))));
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));   // 两个 32 字节定长缓冲
}
```

实测 `verifyPassword` 正确口令 `true`、错误口令 `false`。注意参数从串里读回：日后 `N` 上调，旧用户的哈希仍按它自己那档 `N` 校验，登录成功后再透明地用新参数重算覆盖（渐进式重哈希）。

## `timingSafeEqual` 的长度陷阱

比对密钥/哈希要用 `crypto.timingSafeEqual` 而不是 `===`，因为后者在第一个不同字节就短路返回，攻击者能用响应时间逐字节猜出值。**但它有个坑：两个缓冲区的字节长度不相等时，它不返回 `false`，而是直接抛 `RangeError`。** 实跑：

```text
timingSafeEqual 不等长抛错: RangeError | Input buffers must have the same byte length
```

后果分两层。第一层是崩溃：如果你把「用户输入的长度」直接喂进去（比如拿一个变长的签名去比定长期望值），长度不匹配当场抛错、接口 500——这本身就是拒绝服务，而且**抛错路径和普通不匹配路径耗时不同，反而把你不想泄露的时序信息又送了回去**。第二层是错误用法：有人为了让长度相等先 `padEnd` 补齐，一旦这样，短前缀也算「相等」，安全属性当场归零。正确做法上一章已经示范：**先把长度检查放在外面**，`sig.length === expect.length && timingSafeEqual(...)`；定长的哈希/签名（如本例的 32 字节 scrypt 输出、定长 HMAC）天然等长，可省掉这层。短路的长度比较不泄露内容秘密，所以是安全的。

## 会话固定、会话劫持与真正的登出

会话 ID 必须来自 CSPRNG 且足够长。实测 `crypto.randomUUID()` 生成 10 万条无重复（形如 `1275baea-6ae5-4a82-aada-db08a51b7aa1`），`crypto.randomBytes(32).toString('base64url')` 得 43 字符——两者都够。反例是用 `Math.random()` 拼 id：

```text
Math.random 拼的"伪 token" 样例 = tokclbhtl3ompdgalx97pp6v4
```

`Math.random` 不是密码学安全随机数，熵不足、可被观测建模。**会话 id 只用 `crypto.randomBytes` / `randomUUID`**（`Math.random` 的更多坑见[Web 安全：OWASP Top 10 与实践](/backend/web-security)）。

围绕会话 id 有两类攻击：

- **会话劫持（session hijacking）**：攻击者通过 XSS、抓包、 shoulder-surfing 拿到受害者当前有效的 sid，直接冒充。防线是上面那串 Cookie 属性（`HttpOnly` 抗 XSS 窃取、`Secure` 抗明文抓取）加上「凭证只在传输中出现、绝不落 URL」。
- **会话固定（session fixation）**：攻击者先拿到一个**你自己发的** sid（比如登录页对未登录者也种 sid），诱导受害者用这个**已知** sid 去登录；若登录成功后你不换 id，攻击者手里那串就变成了已认证会话。防线只有一条：**登录成功的那一刻，作废旧 sid、签发新 sid。**

```js
function establishSession(req, res, uid) {
  const sid = crypto.randomBytes(32).toString('base64url');
  store.set(sid, { uid, createdAt: Date.now() });   // 见下节「存储放哪」
  res.setHeader('Set-Cookie',
    `__Host-sid=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1800`);
}
// /login 处理里：校验口令通过 -> 先销毁请求自带的旧 sid -> 再 establishSession
```

登出同理。**登出必须删服务端存储里的会话**，不是只让前端 `document.cookie=''`。实跑已证明：只要服务端那条 `sessions[sid]` 还在，攻击者用之前抓到的 id 照样能过——前端删 Cookie 删不掉别人手里的副本。

```js
function logout(req, res) {
  const sid = parseSid(req.headers.cookie);
  if (sid) store.delete(sid);            // 关键：服务端失效
  res.setHeader('Set-Cookie', '__Host-sid=; HttpOnly; Secure; Path=/; Max-Age=0');
  res.end('ok');
}
```

顺带一条「全员下线」的正确姿势：改密码、检测到盗号、用户注销账号时，要作废该用户**所有**会话——存储结构要能按 `uid` 反查它名下的 sid 集合，而不是只存 `sid -> uid` 单向映射。

## `SameSite` 挡不住一切：CSRF 令牌仍是第二道防线

CSRF（跨站请求伪造）是让受害者浏览器在攻击者发起的跨站请求里，自动带上受害者的会话 Cookie。`SameSite` 正是冲着它设计的，实测/文档口径：

| 值 | 跨站 POST / fetch 带不带 Cookie | 跨站顶级导航 GET 带不带 | 结论 |
| --- | --- | --- | --- |
| `Strict` | 不带 | 也不带（连从站外点进来的第一跳都不带） | 最安全，但外链进站像没登录 |
| `Lax`（现代浏览器默认） | 不带 | 带 | 挡住绝大多数 CSRF，放行正常的外链进站 |
| `None`（须配 `Secure`） | 带 | 带 | 跨站需要凭证的场景才用，此时 SameSite **完全不防 CSRF** |

**关键推论：`SameSite=Lax` 已经能挡住传统 CSRF，但它不是万能的。** 两个必须自己补上 CSRF 令牌的场景：

1. 你用了 `SameSite=None`（或历史浏览器把它当未设、退化成放行跨站），此时跨站请求带 Cookie，防线没了。
2. 子域被攻破或存在开放重定向时，「同源」的恶意表单仍会带 Cookie 打你的写接口。

`SameSite` 与 CSRF 令牌是两道**不能互相替代**的防线：前者是浏览器层「不带凭证」，后者是应用层「这请求真是这个用户主动发的吗」。CSRF 令牌的做法：会话里存一个随机 `csrfToken`，表单/`X-CSRF-Token` 头带一份，写操作时比对二者；GET 这类安全方法不发令牌。

```js
function requireCsrf(req) {
  const inSession = store.get(parseSid(req.headers.cookie))?.csrfToken;
  const inHeader = req.headers['x-csrf-token'];
  if (!inSession || !inHeader || inSession.length !== inHeader.length ||
      !crypto.timingSafeEqual(Buffer.from(inSession), Buffer.from(inHeader))) {
    throw Object.assign(new Error('CSRF 校验失败'), { code: 'CSRF_FAILED', httpStatus: 403 });
  }
}
```

<Callout type="info" title="别把 CSRF 令牌做成可预测值">

令牌要和会话绑定、来自 `crypto.randomBytes`，且对每个会话不同。用「一个全站共享的固定令牌」或「从 uid 派生」的令牌，等于没防。校验它时用定长比较，别用 `===` 短路。

</Callout>

## 会话存储放哪：进程内 `Map` 在多实例下为什么会失效

最省事的写法是把 `store = new Map()` 放在进程内存里。单机开发没问题，一上线就炸，原因全在「请求不一定落到同一个进程」：

- **多实例 / 负载均衡**：登录请求打到实例 A，`Map` 只写进了 A 的内存；下一个请求被轮询到实例 B，B 的 `Map` 里没有这个 sid，判你未登录。这正是开头「登录后刷新又掉线」那个故障。
- **多进程（`cluster`、Node 的多个 worker）**：每个 worker 是独立进程、独立堆，`Map` 不共享，同理会串号。
- **重启 / 部署**：进程内存随进程消失，发布一次全员被登出（若你没做持久化）。
- **无 TTL 就泄漏**：内存 `Map` 不会自动过期，得自己扫、自己删。

正确解法是把会话搬到**所有实例共享、支持带 TTL 键**的外部存储。多实例共享会话的完整方案（Redis 的过期、内存淘汰、分布式一致性）在[分布式会话、限流与幂等](/data-storage/session-rate-limit-idempotency)单独展开；本章只确立后端侧的接口形状——把存储抽成一个能替换的边界（对应[分层架构与请求处理链路](/backend/layered-architecture)的 repository 思想）：

```js
// 生产实现走 Redis：SET sid EX 1800；GET sid 命中即续期
// 这里用 Map 演示接口形状，注释标明它不适用于多实例
const store = new Map();
const sessions = {
  create(sid, data, ttlMs) { store.set(sid, data); /* 生产：redis.set(sid, data, 'PX', ttlMs) */ },
  get(sid) { return sid ? store.get(sid) : undefined; },   // 生产：redis.get(sid)
  delete(sid) { store.delete(sid); },                       // 生产：redis.del(sid)
};
```

单实例、会话量小、能接受「重启即全掉线」时，内存也不是绝对不行，但你必须清楚上面四条限制都还在。**只要考虑横向扩展或滚动发布，就把会话放外部共享存储。**

## 常见错误与排查

**1. 密码用 MD5/SHA 或不加盐。** 现象：库里哈希值定长、且两个用户同口令哈希相同。确认：拿一个已知弱口令的哈希去在线反查，命中即坐实。修：改用 `scrypt`/`argon2id`/`bcrypt`，每人随机盐，把参数存进哈希串；对老用户做「登录时透明重哈希」。

**2. Cookie 只写了名字和值。** 现象：XSS 一发就丢会话、HTTP 站点口令明文可抓。确认：DevTools → Application → Cookies，看属性栏有没有 `HttpOnly`/`Secure`/`SameSite`。修：照本章最小签发那行补齐；`SameSite=None` 一定要带 `Secure`，否则浏览器丢弃。

**3. `timingSafeEqual` 直接比变长输入。** 现象：偶发 `500`，日志里 `RangeError: Input buffers must have the same byte length`。原因：两侧字节长度不等。修：先比 `length` 再比内容（`a.length === b.length && timingSafeEqual(...)`），别用 `padEnd` 补长度。

**4. 登录后不换会话 id。** 现象：明明做了认证却被会话固定打穿。确认：走一遍「先用旧 sid 打开登录页 → 登录 → 看响应 `Set-Cookie` 的 sid 是否和进来时相同」，相同就是漏防。修：`establishSession` 里旧 sid 先 `delete` 再签新 sid。

**5. 登出只删前端 Cookie。** 现象：退出后旧 sid 仍能访问受保护接口。确认：退出前抓下 sid，退出后 `curl -H "Cookie: sid=..."` 打 `/me`，还能返回 200 即坐实。修：登出务必 `store.delete(sid)` 让服务端失效。

**6. 会话存进程内存却多实例部署。** 现象：登录后刷新随机掉线、滚动发布后大批用户被踢。确认：起两个实例挂负载，反复登录刷新看是否命中「未登录」。修：会话搬到 Redis 等共享存储（见[分布式会话、限流与幂等](/data-storage/session-rate-limit-idempotency)）。

## 练习

<Exercise title="练习 1 · 给一段 Set-Cookie 逐属性判用途" difficulty="基础">

下面这条 `Set-Cookie`，请指出每个属性的作用，并回答：把 `SameSite=None` 改成 `Strict` 会不会破坏某个功能？为什么？

```text
Set-Cookie: __Host-sid=abc; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=1800
```

<template #answer>

`__Host-` 前缀强制这条 Cookie 必须 `Secure`、不带 `Domain`、`Path=/`，把作用域钉死在当前主机根。`HttpOnly` 挡 JS 读取（抗 XSS 窃取）；`Secure` 只在 HTTPS 发送；`SameSite=None` 允许跨站携带（所以必须配 `Secure`）；`Path=/` 全站携带；`Max-Age=1800` 是 30 分钟持久会话。

改成 `Strict` 会破坏功能：`__Host-` 前缀允许不带 `SameSite`，但 `Strict` 意味着任何跨站请求都不带这条 Cookie——如果你的登录态需要被第三方页面（例如嵌入的 iframe、跨子域回调）携带，就会「看起来没登录」。另外注意 `__Host-` 还禁止 `Domain`，所以它天然只在本主机可见。是否要 `None` 取决于业务是否真的跨站携带凭证，不需要就退回 `Lax`。

</template>

</Exercise>

<Exercise title="练习 2 · 解释这段校验为什么当场抛 RangeError" difficulty="进阶">

有人写口令校验：`crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(storedHash))`，其中 `storedHash` 是 64 位十六进制的 SHA-256 输出，而 `inputHash` 是他「把用户输入原样传进来」直接 `Buffer.from(input)`。当用户在表单里输入 `short` 时会发生什么？怎么修？

<template #answer>

会抛 `RangeError: Input buffers must have the same byte length`（本章实测原文）。`storedHash` 是 64 字节，`Buffer.from('short')` 是 5 字节，长度不等，`timingSafeEqual` 直接抛错而不是返回 `false`——接口当场 500。

修法有两层。根本修法：先对输入做和存储时相同的哈希，保证两边都是定长 32/64 字节再比较。防御修法：无论比什么都先加长度闸门 `a.length === b.length && crypto.timingSafeEqual(a, b)`，长度不等直接判失败（长度本身不是秘密，短路不泄露内容）。绝不能用 `padEnd` 把短的补到等长——那样 `short` 和 `shortXXXXX` 会被判相等。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误：把会话做成人人可猜" difficulty="挑战">

设计两种「会话 id 看着能用、实则不安全」的写法，并说明分别对应本章哪个漏洞类别、怎么测出来。

<template #answer>

**写法一：`sid = 'u' + uid + '-' + Date.now()`。** id 完全可预测（能推别人的 uid、时间戳连续），攻击者枚举就能冒充——这是「会话 id 必须来自 CSPRNG」的反例，也顺带导致会话固定（攻击者能替受害者预生成 id）。测法：把连续两个用户的 sid 贴出来，肉眼能看出规律即坐实；修：`crypto.randomBytes(32).toString('base64url')`。

**写法二：登录后复用登录页发的匿名 sid，不重新生成。** 这就是会话固定：攻击者先用一个已知 sid 访问拿到 Cookie，诱导受害者用同一 sid 登录，登录后 sid 不变、攻击者手里的副本立即升级为已认证会话。测法：登录前记下 Cookie 里的 sid，登录后断言 `Set-Cookie` 的 sid 必须变化；若相等就是漏防。修：`/login` 成功分支里 `store.delete(旧 sid)` 后签新 sid。

（附带常见第三种：登出只发 `Max-Age=0` 给浏览器、不 `store.delete`，抓到的旧 sid 仍可用——服务端失效没做。）

</template>

</Exercise>

<Exercise title="练习 4 · 判断 SameSite 与 CSRF 令牌谁挡哪" difficulty="进阶">

某站所有写接口用 `POST`，`SameSite=Lax`，没有 CSRF 令牌。请判断下面三个场景是否被挡住，并说明理由：① 攻击者 `evil.tld` 页面自动提交一个 `POST` 表单到 `bank.tld/transfer`；② `bank.tld` 的某个第三方子域 `xss.bank.tld` 被植入恶意脚本发同源 `fetch`；③ 一个跨站链接让用户 `GET` 打开 `bank.tld/delete?sid=...`。

<template #answer>

① 挡住：`Lax` 下跨站 `POST` 不带 Cookie，`transfer` 收到的是无会话请求。② **没挡住**：这是同源请求，`SameSite` 只管跨站，`Lax` 对它无效；`xss.bank.tld` 的脚本发的同源 `fetch` 会带 Cookie——这正是「子域被攻破」场景，必须靠 CSRF 令牌这第二道防线。③ 部分危险：`Lax` 允许跨站顶级导航的 GET 带 Cookie，所以 GET `delete` 会被带上会话执行——根因是「用 GET 做有副作用的操作」（见[HTTP 与 REST 原理](/backend/http-and-rest)）；改成 `POST` 后 `Lax` 就挡住了。

结论：`SameSite` 挡的是「跨站」，挡不住「同源但被脚本利用」和「用 GET 写数据」。CSRF 令牌和「安全方法语义」是不可省的第二、第三道防线。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN `Set-Cookie`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie) —— 核实本章属性表：`HttpOnly` 阻止 `document.cookie` 读取但随请求发送、`SameSite=None` 必须配 `Secure`、`Max-Age` 与 `Expires` 同时存在时 `Max-Age` 优先、`Domain` 省略即 host-only、`__Host-`/`__Secure-` 前缀约束。2026-10-18 读取。
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) 与 [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) —— 核实会话固定/劫持的定义与「登录后换 id」「登出需服务端失效」的通用建议，以及 scrypt/argon2id/bcrypt 的推荐参数档位（**具体数值以官方当前版本为准，动手前核对**）。
- [Node.js `crypto` 文档](https://nodejs.org/docs/latest/api/crypto.html) —— 核实 `scrypt`/`scryptSync` 的 `N`/`r`/`p`/`maxmem` 语义与默认 `maxmem` 上限（本章默认上限挡住 `N=2^15` 为实测，报 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`）、`timingSafeEqual` 对不等长输入抛 `RangeError`、`randomBytes`/`randomUUID`/`randomInt` 为 CSPRNG（错误码与默认值以你所用 Node 版本为准）。

## 下一章

本章把「你是谁」钉在了服务器侧：口令用加盐慢哈希存（实测 scrypt 相对裸 SHA-256 慢约 5000 倍、每秒只能试 14 次）、会话 id 用 CSPRNG 生成、登录后换 id 防会话固定、登出做服务端失效、`SameSite` 加 CSRF 令牌两道防线互补、会话搬到共享存储才能多实例。但「登录成功」只回答了认证，**没有回答「他能不能碰这条数据」**——一个 `role:user` 的人把 URL 里的订单 id 改成别人的，认证照样通过，这正是越权。下一章[授权与权限：RBAC 与越权防护](/backend/authorization)处理这半件事。
