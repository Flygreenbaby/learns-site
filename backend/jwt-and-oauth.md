# JWT 的三段不是保险箱：签名、撤销与 OAuth 的委托授权

工单上写着「把离职同事的登录踢掉」。你改了数据库里的用户状态，但那个已经泄露的 token 在接下来的 12 小时里依然有效——它是**无状态**的，服务器上没有一份可以撤销的东西。选 JWT 的同时就选了「没有集中撤销点」。

第二个现场更省人也更要命：某个验证实现按令牌 header 里自报的 `alg` 决定怎么验签，于是 `{"alg":"none"}` 的令牌**任何人都能通过校验**——攻击者自己写一个 `role: admin` 的 payload，不签名，直接发请求。RFC 7518 专门为它写了一条强制要求：实现**默认不得接受**不带完整性的令牌。

本章的签发、验签、篡改、伪造全部在本机 Node v25.4.0 用 `node:crypto` 手写实现并跑过，**不依赖任何第三方 JWT 库**，规范结论以 RFC 原文核实。前置：[认证：Session、Cookie 与密码哈希](/backend/auth-session)、[授权与权限](/backend/authorization)。

## JWT 是签名不是加密：三段结构实测拆开

JWS 紧凑序列是三段用 `.` 连接：**Base64url(header) . Base64url(payload) . Base64url(signature)**，签名覆盖前两段拼起来的 ASCII 字符串。RFC 7519 明确 base64url **不加填充**，字母表把 `+` `/` 换成 `-` `_`。同一段字节在两种编码下的样子（实测）：

```text
01 base64      -> +/+/Pi8A
01 base64url   -> -_-_Pi8A | 有无 + / = : true / false
```

最小签发实现（`node:crypto`，无依赖）：

```js
import crypto from 'node:crypto';
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function signHS256(payload, secret, ttlSec = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);          // NumericDate：秒，不是毫秒
  const body = { iat: now, exp: now + ttlSec, ...payload };
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${sig.toString('base64url')}`;
}
```

跑出来的令牌与拆解：

```text
02 token       -> eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3OTIyODc1MzQsImV4cCI6MTc5MjI5MTEzNCwic3ViIjoidXNlci00MiIsInJvbGUiOiJlZGl0b3IifQ.2h-P7aH-hbbaRIoACGSZ2rnzf87myZhYdeowGgvfkzM
03 段数 / 各段长度 : 3 36,90,43
04 header      -> {"alg":"HS256","typ":"JWT"}
04 payload     -> {"iat":1792287534,"exp":1792291134,"sub":"user-42","role":"editor"}
05 无密钥解码 payload : { iat: 1792287534, exp: 1792291134, sub: 'user-42', role: 'editor' }
```

`03` 里的 **43** 值得记：HMAC-SHA256 输出 32 字节，base64url 后正好 43 字符；RS256 用 2048 位密钥时签名 256 字节 → **342 字符**（实测 `63,96,342`）。**从段长就能反推算法，攻击者也知道**。`05` 更要紧：**没有密钥就能解出明文**——base64url 是编码不是加密，签名提供**完整性**而非机密性。手机号、邮箱列进 JWT 就等于公开，**把 payload 缩到最小**是唯一可行的防护；真要机密性得用 JWE。

## 校验必须自己写对：算法白名单与 timingSafeEqual

一个「看起来没问题」的验签函数，四个检查点缺一不可：

```js
function verifyHS256(jwt, secret, { skewSec = 5 } = {}) {
  const partsA = jwt.split('.');
  if (partsA.length !== 3) throw new Error('JWT 结构非法：不是三段');
  const [h, p, s] = partsA;
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  if (header.alg !== 'HS256') throw new Error(`算法不被允许: ${header.alg}`);   // ① 不接受自报算法
  const expect = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const got = Buffer.from(s, 'base64url');
  if (got.byteLength !== expect.byteLength) throw new Error('签名长度不对');      // ② 先等长
  if (!crypto.timingSafeEqual(got, expect)) throw new Error('签名校验失败');      // ③ 常数时间比较
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && now > claims.exp + skewSec) throw new Error(`令牌已过期 exp=${claims.exp} now=${now}`);
  if (typeof claims.nbf === 'number' && now + skewSec < claims.nbf) throw new Error('令牌尚未生效 nbf');   // ④ 时间校验
  return claims;
}
```

四组篡改实验的真实报错（逐字抄自终端）：

```text
06 正常校验    -> {"iat":1792287534,"exp":1792291134,"sub":"user-42","role":"editor"}
07 篡改 payload -> Error: 签名校验失败
08 篡改签名    -> Error: 签名校验失败
09 timingSafeEqual 长度不同 -> RangeError: Input buffers must have the same byte length
09 长度相同内容不同 -> false
09 长度相同内容相同 -> true
10 错密钥        -> 签名校验失败
```

`09` 那条 RangeError 是真实的坑：**`crypto.timingSafeEqual` 要求两个 Buffer 字节长度相同，否则抛错而不是返回 false**。忘记先比长度，就会出现「所有签名错误的请求返回 500 而不是 401」——错误码被掩盖，攻击者还能借 500 探测签名长度。对不定长的秘密（API Key）先哈希成定长摘要再比，就永远不会触发它：

```js
const sha = (s) => crypto.createHash('sha256').update(s).digest();   // 定长 32 字节
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));     // 实测 true / false / false
```

为什么不用 `===`：逐字符短路比较让「猜对前缀越多耗时越长」，理论上可被反推；换成 `timingSafeEqual` 是**零成本的规范写法**。

## 两个真实攻击：alg 为 none 与 RS/HS 混淆

**攻击一：不带签名的令牌。** RFC 7518 定义了 `alg: none` 的「Unsecured JWS」：JWS 可以被创建成**不提供完整性保护**的形式，而实现 **MUST NOT 默认接受**这种令牌。问题出在「按 header 自报算法来验」的实现上。构造空签名的伪造令牌，喂给两种验证器：

```text
11 alg=none 令牌 -> eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhdHRhY2tlciIsInJvbGUiOiJhZG1pbiIsImV4cCI6OTk5OTk5OTk5OX0.
11 naive 验证器结果 : {"sub":"attacker","role":"admin","exp":9999999999}
11 安全验证器拒了 : 算法不被允许: none
```

**注意尾部那个点**：第三段是空字符串，`split('.')` 仍得到 3 个元素，所以「检查三段」拦不住它，**真正拦住它的是算法白名单**。结论：算法永远由服务端决定，不从令牌里读。

**攻击二：RS256 → HS256 混淆。** 很多成熟库历史上都中过。授权服务器用 RSA 私钥签 RS256，**公钥是公开的**（JWKS 端点就是拿来公开的）。若验证器「按 header 的 `alg` 分支，HS256 就把 key 当 HMAC 密钥」，而它手里那把 key 正是公钥 PEM，攻击者**用公钥字符串当 HMAC 密钥**签一个 HS256 令牌就能通过。本机实跑（`generateKeyPairSync` 生成 2048 位密钥对）：

```text
12 RS256 令牌段长 : 63,96,342
12 header         -> {"alg":"RS256","typ":"JWT","kid":"key-2026-10"}
13 伪造令牌 alg   -> HS256 | 签名段长 43 vs RS256 的 342
14 被混淆的验证器接受伪造令牌 : {"iat":1792287534,"exp":1792288434,"sub":"user-7","scope":"orders:read"}
14 同一验证器接受真令牌         : {"iat":1792287534,"exp":1792288434,"sub":"user-7","scope":"orders:read"}
```

第 14 行两条输出**一模一样**，这就是攻破。正确写法是**把密钥与算法绑定并按 `kid` 查表**（`KEYS = { 'key-2026-10': { alg: 'RS256', material: publicKey } }`），实跑证明它连照抄 `kid` 的伪造也挡得住：

```text
15 严格验证器拒伪造 : 未知 kid: undefined
15 严格验证器拒带 kid 的伪造 : kid 的算法是 RS256，令牌自称 HS256
15 严格验证器 accept 真令牌 : {"iat":1792287534,"exp":1792288434,"sub":"user-7","scope":"orders:read"}
```

同一条纪律还有：**`iss` 与 `aud` 必须校验**。只验签名不验签发方与受众，等于接受「别的系统合法签出、给别的受众的令牌」来访问你的接口。手写这三段是为了**理解**——生产要用维护中的库，但写不出三段，你在库里配错参数时看不出问题。

## 过期、刷新与「JWT 无法撤销」

时间声明的单位是**秒**（NumericDate）。把毫秒写进去的 bug 我也实测了：

```text
16 过期 1 小时被拒  : 令牌已过期 exp=1792283934 now=1792287534
17 毫秒 exp 的值 : 1792291134133 按秒解释相当于距今 20723366 天
17 毫秒 exp 被接受（等于永久有效，这是事故）
18 nbf 在未来被拒  : 令牌尚未生效 nbf
```

`17` 最阴：**它不报错，它「成功」**。`Date.now()` 直接赋给 `exp` 就是两万多年后过期，而只测「刚签发的能验过」的单测全绿。纪律：**`exp` 由签发函数内部按秒计算，不接受调用方传时间戳**，CI 里断言 `exp - iat` 落在合理区间；时钟漂移留容差（上面 `skewSec = 5`）。

「JWT 无法撤销」的准确版本是：**验证方不需要状态就能判断有效，因此也不需要状态来判断无效。**加上状态就把无状态的优势还回来了，可用方案只有四种：

| 方案 | 怎么做 | 代价 | 适用 |
| --- | --- | --- | --- |
| **短时效 + 刷新令牌** | access 5–15 分钟，refresh 长期且**存库** | 最坏窗口 = access 剩余寿命 | **默认选择** |
| jti 黑名单 | 撤销时写进 Redis，**TTL = 令牌剩余寿命** | 每次验证多一次查库 | 踢人、疑似泄露 |
| token version | 库里存版本号，写进自定义 claim 比对 | 仍要查库（可缓存），一条记录覆盖该用户全部令牌 | 改密码后全部失效 |
| 换签名密钥 | 轮换 `kid`，旧密钥不再接受 | **所有人**一起掉线 | 密钥泄露事件响应 |

**双令牌的分工**常被写反：access 是 JWT、短期、每次请求都带、不入库；refresh 应该是**不透明随机串**（`randomBytes(32).toString('hex')`，它不需要携带声明）、存库、一次一用地产轮换、且只能打到 `/token` 一个端点。

| 维度 | Session + httpOnly Cookie | JWT |
| --- | --- | --- |
| 撤销 | 删记录即刻生效 | 只能等过期，或加状态 |
| 多实例 | 要共享存储（[分布式会话](/data-storage/session-rate-limit-idempotency)） | 无需共享 |
| 每请求成本 | 一次查库（可缓存） | 只验签 |
| CSRF | **必须防** | 天然免疫（不自动携带） |
| 泄露面 | 服务端存储 | **payload 明文**，长期留在客户端 |

规律：**撤销需求刚性 → Session；跨服务、能容忍分钟级窗口 → JWT。**

## 存哪里：localStorage 与 HttpOnly Cookie

| | `localStorage` + `Authorization` 头 | `HttpOnly` Cookie |
| --- | --- | --- |
| XSS 发生后 | **脚本直接读走凭证本体** | 读不到，只能借浏览器发请求 |
| CSRF | 天然免疫 | **必须防**：`SameSite` + CSRF token |
| 携带方式 | 前端自己拼头 | 浏览器自动带 |
| 跨源 | 预检需放行 `Authorization` | 需 `credentials: 'include'`，且 `Allow-Origin` 不能是 `*` |
| 体积 | 无此约束 | **单 cookie 约 4 KB 级**，claims 多的 JWT 会撑爆 |

结论与 [浏览器存储那一章](/javascript/network-and-storage) 一致：**浏览器场景优先 `HttpOnly` + `Secure` + `SameSite=Lax`，由后端 `Set-Cookie` 下发**（写法见[认证](/backend/auth-session)）。放 `localStorage` 是妥协，只在确信 XSS 已被拦住（[Web 安全](/backend/web-security)）且令牌短期有效时才用。**`HttpOnly` 挡不住 CSRF，`SameSite` 挡不住 XSS**——两组风险正交，必须各配一招。另一条实操细节：浏览器原生 WebSocket / `EventSource` **带不上 `Authorization` 头**，只能用 cookie，见 [WebSocket 协议](/realtime/websocket-protocol)。

## OAuth 2.x：委托授权不是登录，PKCE 堵的是哪条路

OAuth 解决的是「**第三方 App 能不能替用户读它的资源，而拿不到他的密码**」。四个角色混了就看不懂流程：

| 角色 | 是谁 | 持有什么 |
| --- | --- | --- |
| 资源所有者 | 用户本人 | 密码（只在授权服务器输入） |
| 客户端 client | 第三方应用 | `client_id`（公开）+ 可能的 secret |
| 授权服务器 | 验证身份、发令牌 | 用户密码、会话、签名私钥 |
| 资源服务器 | 存数据、验收 access token | 只验令牌，从不见密码 |

**授权码流程是现行唯一推荐的交互流程**（核心规范 RFC 6749），各步骤传什么：

```text
1  用户点「用 <Provider> 登录」 → 浏览器跳授权端点
   GET /authorize?response_type=code&client_id=…&redirect_uri=…
       &scope=profile%20email&state=<随机>&code_challenge=<S256>&code_challenge_method=S256
2  用户在授权服务器登录并同意 —— 客户端不参与这一步，因此拿不到密码
3  授权服务器 302 回 redirect_uri，带上一次性授权码
   GET https://app.example.com/callback?code=abc123&state=<原样回传>
4  客户端后端用授权码换令牌（直连，不经过浏览器）
   POST /token  grant_type=authorization_code&code=abc123&redirect_uri=…&code_verifier=<第 1 步的原始随机串>
5  拿到 access token（可选 refresh token），之后带 Bearer 头访问资源服务器
```

**第 3 步的 `code` 出现在浏览器地址栏、历史、Referer 里**，任何能看到回调 URL 的一方都拿得到，所以需要两道锁，各挡一类攻击：

- **`state` 挡 CSRF**：客户端生成、存在自己会话里、回调时比对。它防的是「攻击者诱导你的浏览器带着他给的授权码完成绑定」，把你的账号绑到他的身份上。
- **PKCE（RFC 7636）挡授权码截获**：`state` 救不了「code 被第三方拿到后直接去换令牌」。机制是**客户端先生成高熵的 `code_verifier` 留在自己手里，把它的 S256 哈希作为 `code_challenge` 带进第 1 步；第 4 步交换时交出原始 verifier**，授权服务器校验哈希相等——截获到 code 却没有 verifier 的人换不到令牌。规范里 `code_challenge_method` **只有 `plain` 与 `S256` 两个取值，`plain` 不要用**。

还有一条线是**客户端类型**：机密客户端（后端服务）能保管 `client_secret`，公开客户端（SPA、App）**不能**，所以必须上 PKCE、绝不在前端做第 4 步的交换。**Implicit 与 Password Credentials 在官方列表里已标为 legacy**，OAuth 2.1 的方向是收紧这些历史包袱（并把 PKCE 变成普遍要求）；现状以 [oauth.net/2/](https://oauth.net/2/) 为准。最后：**「用 OAuth 登录」严格说不是 OAuth**——`access_token` 能读资源不等于身份信息，身份层是 OpenID Connect 加的 `id_token` 与 `/userinfo`。

## 常见错误与排查

**1. 验签按 header 里的 `alg` 决定怎么验。** 现象：`alg: none` 或「`alg: HS256` + 公钥当密钥」的令牌能通过。确认：本章 `11`、`14` 两段输出照抄就能在自己项目上复现。修：服务端固定算法白名单；非对称场景用 `kid → {alg, key}` 绑定（`15` 的拒因）。

**2. `exp` 写成毫秒。** 现象：令牌永不过期、撤销「无效」、且没有任何报错。确认：解 payload 看 `exp` 位数，10 位是秒、13 位是毫秒。修：`exp` 由签发函数按秒生成，CI 断言 `exp - iat` 区间。

**3. `timingSafeEqual` 直接比不定长 Buffer。** 现象：错误签名的请求返回 500 而不是 401，日志里是 `RangeError: Input buffers must have the same byte length`。确认：把签名段删掉几个字符再请求。修：先比长度，或先哈希成定长摘要再比。

**4. 把权限码或 PII 写进 payload。** 现象：被降级的用户仍能执行高权限动作直到令牌过期；或者没有代码漏洞，但手机号被任何人解出。确认：改权限后用旧 token 请求一次。修：claims 只放身份，权限每次查库（回指[授权与权限](/backend/authorization)）。

**5. OAuth 回调不校验 `state`、challenge 用 `plain`、或在浏览器里换令牌。** 现象：可被构造回调完成账号绑定；verifier 明文传输等于没有 PKCE；`client_secret` 出现在前端源码里。修：`state` 存会话且一次性使用；只用 `S256`；交换放后端。

## 练习

<Exercise title="练习 1 · 哪一段变了会导致验签失败" difficulty="基础">

一个 HS256 令牌 `A.B.C`。分别改：① header 里加一个字段；② payload 的 `role` 改成 `admin`；③ 签名段最后一个字符；④ 签名段删掉 5 个字符。对每种情况回答：签名覆盖的输入变了吗？上面那个带四个检查点的验证器会走到哪一行、抛什么？

<template #answer>

签名覆盖的是 **`A + '.' + B` 的 ASCII 字节**。

**① A 变了** → HMAC 结果不同 → 走到 ③ 抛 `Error: 签名校验失败`（实测 `07`/`08` 的形态）。附带效果：`alg` 仍是 `HS256`，白名单放行，把它挡住的是**签名**。

**② B 变了** → 同样签名失败。这正是「签名不是加密」的意义：**明文可读，一字不能改**——攻击者读得到 `role: editor`，也能改成 `admin`，但改完就验不过。

**③ 只改签名段**：长度仍是 43 → ② 的等长检查放行 → `timingSafeEqual` 返回 `false`（实测 `09 长度相同内容不同 -> false`）→ 抛「签名校验失败」。

**④ 改长度**：43 → 38，**没有 ② 那一行就会在 `timingSafeEqual` 里抛 `RangeError`，客户端拿到 500**；有它就干净地报「签名长度不对」。这就是 ② 存在的唯一理由。

</template>

</Exercise>

<Exercise title="练习 2 · 故意制造错误：删掉三道检查会怎样" difficulty="进阶">

有人把 `verifyHS256` 里这三行删了，理由分别是「冗余」「多一次查库没必要」「性能」：

```js
if (header.alg !== 'HS256') throw new Error(`算法不被允许: ${header.alg}`);      // ①
if (claims.iss !== EXPECTED_ISS || !claims.aud?.includes(EXPECTED_AUD)) throw …; // ②
const rec = KEYS[header.kid]; if (header.alg !== rec.alg) throw …;               // ③
```

对每一行给出具体打穿方式，并指出对应本章哪一段实测输出。

<template #answer>

**删 ①**：构造 `{"alg":"none"}` + 自定义 payload + 空签名。`split('.')` 仍是三段，任何「按 header 分支」的实现会把它当未签名令牌接受。对应实测 `11`：naive 返回 `{"sub":"attacker","role":"admin","exp":9999999999}`，白名单版返回 `算法不被允许: none`。

**删 ②**：签名照样成立，因为密钥属于同一套体系。打法是拿**另一个受众**的合法令牌——同一授权服务器给「内部审计工具」签的令牌，`iss` 相同、验签通过，`aud` 却是别人——用它调生产 API。这种「A 系统的令牌能调 B 系统」是内网横向移动最常见路径。修：`iss` 精确匹配、`aud` 必须包含自己的标识。

**删 ③**：RS/HS 混淆，对应实测 `13`/`14`：伪造令牌签名段 43 字符、真令牌 342 字符，但混淆验证器**对两者输出一模一样的 claims**；保留 ③ 时即使照抄 `kid` 也会撞上 `kid 的算法是 RS256，令牌自称 HS256`（`15`）。

共性：**不是加密强度问题，而是「算法与密钥由谁决定」的问题**——决定权必须在服务端，令牌里的自报字段只是数据。

</template>

</Exercise>

<Exercise title="练习 3 · Session 还是 JWT，刷新流程怎么设计" difficulty="挑战">

两个任务。① 四个场景各选 Session 还是 JWT，并说明撤销怎么处理：公司后台（3 个实例、离职立即失效）／面向 App 的公开 API（几百万设备）／SPA + 外部身份提供商登录／内部报表的一次性短链接。② 为第二个场景写出 access/refresh 双令牌的形态、寿命、存放位置、轮换规则，以及「检测到 refresh 被盗」时的处置。

<template #answer>

**① 场景选择。** 公司后台用 **Session + httpOnly Cookie**：「立即失效」是一行删除，用 JWT 就得引入黑名单或版本表，等于把状态加回来，多实例共享会话存 Redis。公开 API 用 **JWT**：量大、跨服务，Session 存储会成瓶颈。SPA + 外部身份提供商用**授权码 + PKCE，令牌放后端会话**，前端只看到自己的应用会话。一次性短链接用**对「报表 id + 过期时间 + nonce」做 HMAC 的短期签名令牌**，不需要 JWT 结构——做成 JWT 只会诱导别人往 payload 塞敏感字段。

**② 双令牌。** access 是 JWT，5–15 分钟，claims 只放 `sub`/`tenant`/`sid`，由后端注入请求头或放 `HttpOnly` Cookie，**不进 `localStorage`**。refresh 是不透明随机串（`crypto.randomBytes(32)` 的 hex），7–30 天，**存库的是它的哈希** + user + 设备指纹 + 已用标记，放 `HttpOnly`、`Path=/api/auth/refresh`、`Secure`、`SameSite=Lax` 的 Cookie，只被 `/refresh` 一个端点接受。每次换 access 时**同时签发新 refresh 并作废旧的**；旧 refresh 被再次使用是**并发使用信号**，正常客户端不可能同时持有两个副本。

**盗用处置**：撤销该用户**整个会话家族**（同一 `sid` 下所有 refresh），强制重新登录，写审计日志。这就是 refresh 必须存库的原因：**「JWT 无法撤销」只适用于 access，refresh 的全部价值恰恰是可撤销**；access 剩余那十几分钟是已知风险窗口，要写进设计文档而不是事故时才讨论。反过来说，refresh 不该做成 JWT：它不需要携带声明，而验证方本来就要查库，无状态的优势为**零**，可离线验证的令牌还天然抗撤销。

</template>

</Exercise>

<Callout type="verified" title="签发、验签、篡改与两类攻击都在本机跑过">

**环境**：Windows 10 x64、Node v25.4.0，2026-10-18。临时脚本只用 `node:crypto`（`createHmac`、`createSign`/`createVerify`、`generateKeyPairSync` 生成 RSA 2048 的 spki/pkcs8 PEM、`timingSafeEqual`），**未引入任何第三方 JWT 库**；正文里的 `signHS256` / `verifyHS256` 就是跑通的版本，脚本 `backend/.scratch/jwt.mjs` 已在收工前删除。

**确认的结论**：base64url 段无填充、不含 `+` `/`；HS256 签名段 43 字符、RS256（2048 位）342 字符；payload 无需密钥即可解出明文；三类篡改均抛 `Error: 签名校验失败`；`timingSafeEqual` 对不等长 Buffer 抛 `RangeError`；`alg:none` 被 naive 验证器接受、被白名单验证器拒绝；RS/HS 混淆令牌被「按 header 分支」的验证器接受且输出与真令牌一致，被 `kid→算法` 绑定的验证器拒绝；毫秒 `exp` 的令牌被接受（等效永久有效）。

**未验证部分**：真实第三方登录（Google / GitHub 等）的端到端流程、JWKS 端点缓存与密钥轮换、任何第三方 JWT 库的行为（本机未装依赖）、浏览器里 Cookie 与 `localStorage` 的实际携带行为，均**没有实测**，正文只给机制与核实入口。

</Callout>

## 官方文档与延伸阅读

- [RFC 7519（JSON Web Token）](https://datatracker.ietf.org/doc/html/rfc7519) —— 三段 base64url 紧凑序列与**不使用填充**、七个注册声明（`iss`/`sub`/`aud`/`exp`/`nbf`/`iat`/`jti`）、时间是 NumericDate（**秒**）。
- [RFC 7518（JSON Web Algorithms）](https://datatracker.ietf.org/doc/html/rfc7518) —— `alg: none` 属「Unsecured JWS」且实现 **MUST NOT 默认接受**；HS256 = HMAC-SHA256（对称）、RS256 = RSASSA-PKCS1-v1_5 + SHA-256（RSA）。
- [RFC 7636（PKCE）](https://datatracker.ietf.org/doc/html/rfc7636) —— 缓解**授权码拦截**；challenge 在第 1 步送出、verifier 在交换时提交；`code_challenge_method` **只有 `plain` 与 `S256`**。
- [RFC 6749（OAuth 2.0）](https://datatracker.ietf.org/doc/html/rfc6749) —— 四个角色与授权码流程的原文定义。
- [oauth.net 的规范列表](https://oauth.net/2/) —— 核心是 6749、安全实践是 9700、PKCE 单列、2.1 是对 2.0 的合并收紧，Implicit 与 Password 已列为 legacy。**本章不写 2.1 的版本号，动手前以该页当前内容为准。**
- [jwt.io 介绍页](https://jwt.io/introduction) —— 三段结构的直观对照；结论以 RFC 原文为准，在线工具只用于观察。
- [Node.js `node:crypto`](https://nodejs.org/docs/latest/api/crypto.html) 与 [MDN HTTP Cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies) —— `timingSafeEqual` 的等长要求、`generateKeyPairSync` 的编码参数，以及 `HttpOnly` / `Secure` / `SameSite` / `Path` 各自作用。
- 站内：[认证](/backend/auth-session)、[授权与权限](/backend/authorization)、[Web 安全](/backend/web-security)、[分布式会话、限流与幂等](/data-storage/session-rate-limit-idempotency)、[WebSocket 协议](/realtime/websocket-protocol)、[fetch、同源策略与浏览器存储](/javascript/network-and-storage)。

## 下一章

主线只有一句：**令牌的三个自报字段（`alg`、`kid`、`exp`）只能由服务端解释，不能由服务端相信**。`11` 与 `14` 证明按 header 分支的验证器会同时被 `alg:none` 和被公钥伪造的 HS256 打穿，而把算法绑到 `kid` 之后同一份伪造被拒；`17` 那条「毫秒 exp 不报错、直接永久有效」说明单位错配是静默的。身份与令牌都定了，还剩一件事没落地——**别人怎么知道你的接口长什么样**。下一章 [API 文档：Swagger 与 OpenAPI](/backend/api-docs) 讲把 schema 变成契约：一份文档同时当校验规则与在线调试台，以及文档与实现的漂移怎么在提交前被抓出来。
