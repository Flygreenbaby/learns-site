# 对象存储与 CDN：发一个 40MB 文件要多占 48MB 内存时，静态资源就不该由你的应用进程来发

第一次出事前，监控里没有任何「错误」。运营在群里说「邀请函打不开」，你翻开日志：没有异常，没有 500，只有 Node 进程的 `rss` 从 90MB 抖到几百 MB，接口 P99 从 30ms 变成几秒，然后健康检查把你重启了。这条链路上唯一做的事是「把一个文件发给很多人」，而做这件事的进程同时还在处理登录、下单和查库——**它一边发文件，一边把文件整块留在内存里**。

第二条链路的故障现象正好相反。你把资源挪到对象存储、挂上 CDN，磁盘和内存都干净了，用户却开始看到上一版页面；你点了「刷新缓存」，几分钟后一部分人已经新了、一部分人还是旧的。你以为是刷新慢，其实是**这份资源在客户端压根没打算回来问**：文件名固定、`max-age` 很长，而「内容会变」从没写进任何一层配置。同一个 CDN，有人把命中率做到 90% 以上，有人接完之后回源比用户直连源站还多——差别不在厂商，在 URL 怎么命名、`Vary` 怎么写。

所以这一章要回答的不是「哪家对象存储好用」，而是两个问题：**这个文件该由谁来发**，以及换成别人发之后你必须自己管哪四件事——缓存什么时候失效、URL 怎么命名、私有读的授权怎么给、钱花在哪。厂商的 API 名、控制台路径、计费单价本章一律不写，本机没有云账号，写了就是编造；能在这里讲透的是 HTTP 层那几条规则，它们与厂商无关，谁实现都得遵守，而且本章全部在本机跑过。

<Callout type="verified">

本章的实测环境与范围（本机 Node v25.4.0 / Windows，2026-10-19）：`data-storage/.scratch/ds-file-serve.mjs`（发大文件的内存代价：40MB 文件，缓冲 / 流式 / 只取尾部四种写法，每种独立进程跑一次）与 `data-storage/.scratch/ds-http-cache.mjs`（`Cache-Control`、`ETag`、`Last-Modified`、`Vary`、`Content-Encoding`、`Range`、`Content-Disposition`、签名 URL、内容寻址文件名，一个真实 `node:http` 服务的请求响应原文）。`Cache-Control` 与 Range 的官方描述取自 MDN 当前页面（经转述工具摘录，逐字引用前请以页面为准）。**明确不覆盖**：云厂商的对象存储 API 与 SDK、CDN 控制台与配置项、回源、刷新与预热、计费、Nginx 的 `sendfile`、浏览器缓存的实际决策（Node 的 `fetch` 没有 HTTP 缓存层，所以测到的是「服务端对请求头怎么响应」，不是「浏览器会不会发这个请求」）。这些内容在本章都写成「预期结果」或标注未验证。

</Callout>

## 谁在发这个文件：三条路的实测差别

先把一件事量化。同一个 40MB 文件，四种发法——`/buffered` 与 `/streamed` 是全量发的两种写法，`tail-*` 是「只取尾部 8KB」的两种写法（用 `readFileSync` 整读再切片，或 `createReadStream` 带 `start/end`）：

```js
// 取自 data-storage/.scratch/ds-file-serve.mjs 的两条主分支（同一个 createServer 里）
if (req.url === '/buffered') {
  const b = fs.readFileSync(FILE)            // 整个 40MB 读进内存再发
  res.setHeader('Content-Length', String(b.length))
  return res.end(b)
}
if (req.url === '/streamed') {
  res.setHeader('Content-Length', String(SIZE))
  return fs.createReadStream(FILE).pipe(res)  // 边读边发，一次只持有一个小块
}
```

实测输出（每种写法单独立一个进程，`rss` 基线才干净；客户端与服务器在同一进程内，数字含客户端分块，是下限。最后两行真实返回 8192 字节，脚本按 MB 取整显示成 0MB）：

```text
buffered       并发= 1 字节= 40MB 状态=200 耗时=  224ms 起始rss=86.5MB 峰值rss=135.2MB 峰值增量=48.7MB
streamed       并发= 1 字节= 40MB 状态=200 耗时=  255ms 起始rss=86.5MB 峰值rss=94.4MB 峰值增量=7.9MB
buffered       并发= 8 字节=320MB 状态=200 耗时= 1046ms 起始rss=86.6MB 峰值rss=210.9MB 峰值增量=124.3MB
streamed       并发= 8 字节=320MB 状态=200 耗时= 1351ms 起始rss=86.7MB 峰值rss=129.4MB 峰值增量=42.8MB
tail-buffered  并发= 1 字节=  0MB 状态=206 耗时=   42ms 起始rss=86.5MB 峰值rss=129.1MB 峰值增量=42.6MB
tail-stream    并发= 1 字节=  0MB 状态=206 耗时=   41ms 起始rss=86.6MB 峰值rss=89.2MB 峰值增量=2.6MB
```

四条结论都出自这张表。**缓冲发的峰值内存约等于「文件大小 × 同时在飞的请求数」**（单请求 48.7MB，8 并发 124.3MB）：没到 8 × 40MB，是因为 Buffer 在 `res.end(b)` 写完后就能回收、socket 也有背压，但方向确定——**这条曲线的自变量是你控制不了的并发数**，这就是第一个故障现场的成因。

**流式发的峰值内存不随文件大小涨**（1 并发 7.9MB、8 并发 42.8MB，文件都是 40MB）。所以把 `readFileSync` 换成 `createReadStream` 不是性能优化，是把内存上限从「并发 × 文件大小」变成「并发 × 固定小块」，它决定你会不会在某个活动日 OOM。**流式也不更快**（255ms vs 224ms，8 并发 1351ms vs 1046ms）：买的是可预测，不是延迟——与第 12 章同构，池子不是为了更快，是为了让排队有上限。

**最荒谬的一行是 `tail-buffered`：只发 8KB，峰值多占 42.6MB。** 任何「取一段」的需求（断点续传、视频拖动、日志尾部）只要写成整读再切片，成本就是整个文件；`tail-stream` 同样返回 8192 字节，只多占 2.6MB，耗时还更短。

| 谁在发文件 | 内存特征 | 它同时还在干什么 | 什么时候选它 |
| --- | --- | --- | --- |
| 应用进程读盘整块发 | 峰值 ≈ 文件大小 × 并发（实测 48.7MB / 124.3MB） | 登录、下单、查库、持连接 | 本地生成的临时小文件，并发已知很小 |
| 应用进程流式发 | 峰值不随文件大小涨（实测 7.9MB / 42.8MB） | 同上，且同步读盘会占住事件循环 | 需要边生成边发（导出、打包）、鉴权后动态裁剪 |
| 静态服务器 / 对象存储 + CDN | 本进程 0（未在本机测） | 不再参与 | 构建产物、用户上传的原文件、图片视频、可用签名 URL 访问的一切 |

<Callout type="unverified">

以下几处只能给方向和验证方法：(1) Nginx `sendfile` / `X-Accel-Redirect` 的吞吐与内存，本机无 Nginx 环境；(2) 对象存储的读带宽与首字节延迟，各家与区域不同且本机无账号；(3) 浏览器是否真的在 `max-age` 内不发请求、`Vary` 在真实浏览器里怎么命中——本章测的是**服务端对请求头的响应**，浏览器侧要用 DevTools 的 Network 面板看请求是否出现、是否标成 `from disk cache`；(4) 「同步读盘阻塞事件循环」是从 `fs.readFileSync` 的同步语义推出的，本章未量化，要量化就在读盘同期起一个 `setInterval(..., 1)` 记录最大间隔，与不读盘时对照。

</Callout>

## 缓存头不是「加个 max-age」，是三层协议

三层各回答一个问题，配错一层就漏一层：`Cache-Control` 管「能不能存、存多久、要不要回来验证」，客户端与 CDN 都读它，配错就是「每次拖全量」或「永远拿旧的」；`ETag` / `Last-Modified` 管「我发请求了，你还给不给 body」，粒度不够就会明明变了却回 304；`Vary` 管「我存下来这份能不能给别的请求用」，漏写就会把 gzip 字节发给不认 gzip 的人。前两层实测如下——同一个带完整缓存头的资源，首次请求与带 `If-None-Match` 的请求：

```text
   首次： {"status":200,"ms":3,"cc":"public, max-age=31536000, immutable","etag":"\"029762d4d1eb94cad602\"","enc":"gzip","len":1760,"cl":"57","vary":"Accept-Encoding","cr":null,"text":"console.log(\"app v1\")\n..."}
   If-None-Match 命中： {"status":304,"ms":0,"cc":"public, max-age=31536000, immutable","etag":"\"029762d4d1eb94cad602\"","enc":null,"len":0,"cl":null,"vary":"Accept-Encoding","cr":null,"text":""}
   If-None-Match 不命中（改了 1 个字符）： 200
   内容变了 ETag 也变： true
```

看第二行：`status: 304`、`len: 0`，body 没了，但**这一趟请求还是发出去了**。`ms=0` 是本机 loopback，真实公网它就是一个 RTT——条件请求省的是带宽，不是延迟。这就是 `immutable` 的意义，MDN `Cache-Control` 页的原文：

> The `immutable` response directive indicates that the response will not be updated while it's fresh. … `immutable` tells a cache that the response is immutable while it's fresh and avoids those kinds of unnecessary conditional requests to the server.

> The `no-cache` response directive indicates that the response can be stored in caches, but the response must be validated with the origin server before each reuse, even when the cache is disconnected from the origin server.

把 `no-cache` 读成「不缓存」是本章第一个要拆掉的误解：它说的是**可以存，但每次复用前必须验证**；真正的「不要存」是 `no-store`。而 `max-age=31536000, immutable` 的含义是「一年之内客户端连问都不问」——这句话只有在 **URL 唯一对应一份永不修改的内容**时才安全。

## 文件名就是版本：先内容寻址，再谈 immutable

第二个故障现场的根因不在 CDN，在 URL。固定名 `app.js` + 长 `max-age`，等于告诉客户端「这一年别回来问」，然后你自己改了内容——客户端没错，它按你的指示行动；点「刷新缓存」只能清掉 CDN 那层，客户端本地那份清不掉。正确顺序是反过来：**先让文件名承载版本，再谈长期缓存**。实测：

```js
// 取自 data-storage/.scratch/ds-http-cache.mjs 的 H7
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const a = Buffer.from('hello world')
const b = Buffer.from('hello worlD')
console.log(`app-${sha(a).slice(0, 12)}.js｜app-${sha(b).slice(0, 12)}.js｜两者相同=${sha(a) === sha(b)}`)
```

```text
   app-b94d27b9934d.js｜app-519fd0f68497.js｜两者相同=false
```

同一份内容永远算出同一个名字，改一个字节就换一个名字。三条实际收益：**(1)** 长缓存 + `immutable` 可以放心用，因为「内容变」必然表现为「URL 变」，而 URL 变意味着客户端从没缓存过它；**(2)** 发版不需要刷新缓存——入口不缓存或短缓存，它引用的资产名一变，用户下次打开就是新的；**(3)** 旧版本天然还在，回滚只要把入口指回旧名字。

判据可以直接拿去审构建配置和 CDN 规则：**能被长期缓存的资产，文件名里必须有内容哈希；必须用固定 URL 引用的东西（`index.html`、`manifest`、第三方回调地址）就不能长缓存**。

## 秒粒度：`Last-Modified` 看不见同一秒内的修改

`Last-Modified` / `If-Modified-Since` 的精度是**秒**。实测：先按秒记录修改时间，然后同一秒内改内容，在「内容确实已变」这个相同前提下换两种验证头：

```text
   带 If-Modified-Since=Mon, 19 Oct 2026 07:15:51 GMT 且内容已改 → 304（304 = 秒粒度看不见这一秒内的修改）
   同一秒内再改一次，带刚才那个 ETag → 200（200 = ETag 看得见这一秒内的修改）
```

一个回 304（客户端继续用旧的），一个回 200（拿到新内容）。现实触发方式通常是这两种：构建脚本在一秒内写完同一文件名的多个中间版本；上传同名文件覆盖、存储把 `Last-Modified` 设成上传时刻。表现都是**更新偶发不生效、过一会儿又好了**，复现极不稳定，因为它按秒掷骰子。判据：**只要有「同名覆盖」的可能，就不要只依赖 `Last-Modified`**；`ETag`（内容哈希）当主验证，`Last-Modified` 只当补充——哈希命名则直接消掉了这个问题，不同内容不共用 URL，覆盖根本不存在。

## `Vary`：同一个 URL 可以有几份不同的身体

缓存键默认只是 URL，`Vary` 是告诉缓存方「请按这些请求头把键拆开」。实测同一个 `/asset`：

```text
   Accept-Encoding: identity → 200 传输字节=1760 encoding=null
   Accept-Encoding: gzip → 200 传输字节=57 解压后=1760 encoding=gzip，两种表示共用同一个 ETag=true
   Vary 头=Accept-Encoding
   撒谎的 Content-Encoding（声称 gzip 实际发明文）→ 客户端直接失败：terminated / cause=Z_DATA_ERROR
```

**第一，压缩后的表示只传了 57 字节，原文 1760 字节。** 静态资源接 CDN 后带宽的主要变化来自压缩，不是「节点离用户更近」——所以 `Content-Encoding` 配错时，收益直接变成故障。

**第二，两种表示共用同一个 `ETag`。** 逻辑上它们是同一资源的两种表示，但如果中间有缓存方**只看 URL 拆键**，就会把 gzip 那份存下来发给声明 `identity` 的人，body 解不开；`Vary: Accept-Encoding` 的存在就是把两种表示分成两个键。反过来，**命中率极低又查不出原因时先怀疑 `Vary` 写了不该写的头**：`Vary: Cookie` 或 `Vary: Authorization` 会让缓存按会话拆碎、几乎不可能命中，而 CDN 只按 `Cache-Control` 的 `public` 判断能不能存，不会替你阻止这种写法（机制说明，未实测；验证方法：把 `Vary` 改成包含会话头，观察命中率与回源次数）。

**第三，最后一条是本章最有用的报错原文。** 我用 `?lie=1` 让服务端**声明** `Content-Encoding: gzip` 却发送明文，客户端解 body 时立刻失败：`terminated / cause=Z_DATA_ERROR`。状态码是成功的、请求是通的，失败发生在解码阶段——所以「200 但页面空白 / 图片破图」的第三类原因就是**头部声称的表示与字节不一致**。生产上它通常来自中间层改了 body 却没同步改 `Content-Encoding` / `Content-Length`（自己叠一层压缩、网关重编码、把已 gzip 的文件当普通文件发却又带上编码头）。修法单向：**谁编码谁负责这两个头，另一层不要动**。

## `Range`：断点续传和进度条拖动的地基

大文件能不能「用」，取决于支不支持取一段。实测：

```text
   bytes=0-15 → {"status":206,"ms":1,"cc":null,"etag":null,"enc":null,"len":16,"cl":"16","vary":null,"cr":"bytes 0-15/1760","text":"console.log(\"app"}
   bytes=16- → {"status":206,"len":1744}
   bytes=999999- → 416
```

MDN 的 Range 页三句原文正好对上这三行：

> If an HTTP response includes the `Accept-Ranges` header with any value other than `none`, the server supports range requests.

> The `Content-Length` header indicates the size of the requested range... The `Content-Range` response header indicates where this partial message belongs within the full resource.

> A range request that is out of bounds will result in a `416` `Requested Range Not Satisfiable` status, meaning that none of the range values overlap the extent of the resource.

对应关系：`Content-Length: 16` 是**这一段的长度**而非文件长度，`Content-Range` 斜杠后面才是总长，越界返回 416 而不是 200 或 500。两个坑。**其一，我的 416 分支没带 `Content-Range: bytes */1760`**（脚本里直接 `res.end()`），后果是客户端不知道文件多大、重试无法收敛——「自己写 Range」与「交给专业组件」的差距常在这种不报错只难用的地方。**其二，`Range` 与压缩表示不能想当然地叠**：对 gzip 后的字节流按原始偏移取段，取到的不是用户想要的那段文本。MDN 那页没写这一点，本章把它列为**未证实的组合**，动手前核对 RFC 9110 的 range 章节；实践里最稳的是让 `Range` 只作用于未压缩表示（用 `Vary` 拆开，或对可拖动的大文件不压缩），并把这条决定写进验收清单。回到那两行数据：`tail-stream` 发 8KB 多占 2.6MB，`tail-buffered` 同样 8KB 却多占 42.6MB——**支持 `Range` 但用整读实现，等于把「拖动进度条」变成 DoS 自己**。

## 下载文件名：一条报错原文比十段教程有用

`Content-Disposition` 是 header，而 header 只能是 ASCII。把用户上传的原始名或中文报表名直接拼进去：

```text
   raw=1（未编码）：HEADER_ERROR::ERR_INVALID_CHAR::Invalid character in header content ["Content-Disposition"]
   RFC 5987 形式："ok"
```

第一段是 `res.setHeader()` 抛出的原文：`ERR_INVALID_CHAR` / `Invalid character in header content ["Content-Disposition"]`。第二段的写法：

```js
res.setHeader(
  'Content-Disposition',
  `attachment; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
)
```

`filename` 给老客户端一个纯 ASCII 兜底名，`filename*` 给现代客户端真正的中文名（`UTF-8''` 前缀 + 百分号编码；标准在 RFC 6266 与 RFC 8187）。这条故障阴在**它只在真实数据上出现**：你本地测的是 `test.pdf`，上线第一天用户上传 `季度报告.pdf`，或名字里带引号、带换行——带换行还多一层风险，这里是 header 注入的入口之一，所以编码之前要先剔除 CR/LF。它与第 11 章「标识符不能走参数位」同类：**接口边界上的字符集约束，不是业务校验。**

## 私有读：签名 URL 给得了什么、给不了什么

把桶设成公开读最省事，代价是「知道 URL 就能拿」。要控制访问，通用做法是签名 URL：把有效期和一份服务端密钥算出的签名放进查询串，边缘校验后再发文件。本机实现了一份最小的，四种情况的实测——注意 `/backend/auth-session` 那套 Cookie 会话在这里用不上，CDN 边缘不会替你带 Cookie：

```text
   正常：ok status=200
   换路径：bad-signature
   过期：expired
   伪造签名：bad-signature
```

签名逻辑的完整实现见 `ds-http-cache.mjs`，四个决定各对得上一次失败：
**签名覆盖 path，所以一张签名只对一个对象有效。** 我实测的是「换路径失败」，这是**正确实现的样子**；反面写法是只签 `exp`，那么任何一张签发过的 URL 都能靠改路径读走桶里其他对象，而且这类越权没有任何报错，它一直 200。**过期与伪造要分开返回**：对客户端都返 403，日志里保留原因，排查时才分得清是时钟问题还是密钥问题。**`timingSafeEqual` 不是仪式感**：先比长度再逐字节比，普通 `===` 会提前返回、暴露匹配前缀长度。**撤销的困境**：签名一旦发出就无法单独作废，只能等它过期或换密钥，而换密钥是全量作废——所以有效期要分钟级、签发接口要固定 key 前缀，别做成「给任意 key 都能签」的通用工具。密钥只能在服务端：一旦为了「前端直接生成下载链接」打进 bundle，它就成了公开读的同义词。

## 上传：本章只实测了「发」，没实测「收」

文件上行有三条路，本章**没有一条完整实测**（需要厂商账号），只给边界与判据，具体接口名以你选定厂商的当前文档为准：

| 路径 | 说明 | 适用 | 你要负责的事 |
| --- | --- | --- | --- |
| 应用中转 | 先收到进程再转发；本章测的是「发」的代价，「收」同理是整块进内存 | 小文件、需要服务端强校验 | body 上限、临时文件清理、上传超时（`/backend/uploads-and-jobs`） |
| 预签名 PUT | 服务端只签「允许 PUT 到指定 key、指定时效」的 URL | 大文件、不占应用带宽 | key 由服务端定、限制 Content-Type 与大小、落地后校验 |
| 表单直传 | 浏览器表单直接提交到存储，策略字段由服务端签名 | 网页端上传 | 策略字段写错会静默放宽权限，逐项核对 |

判据：**文件大于几十 MB 或上传并发可见，就别让它穿过应用进程**。两条纪律：key 由服务端生成（哈希 + 前缀 + 用户 id），别拿用户给的文件名当 key——同名覆盖、路径穿越（`../../`）、上面的 header 非法字符都从这里进来；客户端自报的 `Content-Type` 不可信，尺寸与「是不是伪装成 png 的脚本」要自己校验。直传之后还要处理**跨源**：上传与下载地址通常与站点不同源，`fetch`/`XHR` 读响应会撞 CORS（`<img src>` 不受影响，所以「图片能显示但取像素报错」「上传进度拿不到」多半是 CORS 缺失）。本章未实测浏览器行为，验证方法：`curl -H 'Origin: https://你的域名' -I <地址>` 看有没有 `Access-Control-Allow-Origin`；Range 场景还要看 `Access-Control-Expose-Headers: Content-Range`，不暴露时跨源 `fetch` 读不到总长、分片拼不回来。

## 接了 CDN 之后，钱会在哪儿冒出来

单价与计费规则各家差异大、变动频繁，本章不写任何数字，只给**构成项**与被低估时的成因：存储量（不去重、不删版本、日志也进桶）、请求次数（小文件海、页面几十个资源、健康检查打到源站）、外网下行流量（被爬、被刷、公开大文件被贴到公开页面）、回源与处理次数（命中率低、`Vary` 拆太碎、刷新预热当兜底）。对应手段依次是：内容寻址加生命周期清理、合并资源并控住命中率、私有读加短效签名加频次限制（`/data-storage/session-rate-limit-idempotency`）、哈希命名加 `immutable` 加审 `Vary`。排查顺序固定四问：命中率掉了吗（掉 → 先查 `Vary` 与命名有没有退化）；下行流量涨还是请求数涨；按次计费的处理调用有没有变多；有没有新桶或新区域落到更贵的存储类型。指标名与图表位置在厂商控制台里，本章未验证。

## 常见错误与排查

**1. 给了 `immutable` / 一年 `max-age`，文件名却没有哈希。**

现象：改内容后用户永远看到旧文件，清浏览器缓存才恢复，运营的截图永远和你不一样。原因：长缓存 + 固定 URL = 客户端在有效期内不再验证，实测那句「内容变了 ETag 也变」救不了它，因为它从不发请求。怎么确认：资源 URL 里有没有内容哈希，再对照 `Cache-Control` 是不是 `max-age=31536000` 一类。怎么修：改成哈希命名，同时把入口 HTML 改成不长缓存；改完做一次「改一处文案 → 不刷缓存 → 重新打开」的验收。

**2. 只依赖 `Last-Modified`，或允许同名覆盖上传。**

现象：更新偶发不生效，重试或过一会儿又好了。原因：秒粒度下同一秒内的修改不可见（实测 304 与 200 那一对）。怎么确认：同一秒内连续改两次并带 `If-Modified-Since` 请求，看是否返回 304。怎么修：让 `ETag` 或哈希命名成为主验证手段；上传 key 里带版本或内容哈希，禁止覆盖。

**3. `Vary` 写了 `Cookie` / `Authorization`。**

现象：CDN 命中率个位数、回源次数高于直连、用户抱怨「别人打开快我打开慢」。原因：缓存键按会话拆碎，每用户各一份。怎么确认：`curl -I` 看 `Vary` 内容；换掉请求里的会话头再请求，观察是否必然回源。怎么修：私有内容走签名 URL，而不是「公开 URL + 边缘按 Cookie 判断」；`Vary` 只保留真正影响 body 字节的头。

**4. 中间层改了 body 却没同步改 `Content-Encoding` / `Content-Length`。**

现象：状态 200、传输正常，但页面空白、图片破图、解码报错。原因：头部声称的表示与实际字节不符（实测原文 `terminated / cause=Z_DATA_ERROR`）。怎么确认：`curl --raw -o` 把 body 存下来看第一字节是不是 gzip 魔数 `1f 8b`，或带 `Accept-Encoding: identity` 对照。怎么修：只让一层负责压缩，另一层透传；禁止对已压缩资源二次压缩。

**5. 让应用进程读盘发大文件。**

现象：内存随并发上涨、P99 抖动、活动日 OOM 或被健康检查重启。原因：缓冲发法的峰值内存 ≈ 文件大小 × 并发（实测 48.7MB / 124.3MB）。怎么确认：把下载接口单独打并发，看 `rss` 是否随并发线性上抬；再看「只取一小段却涨几十 MB」有没有出现（实测 42.6MB）。怎么修：短期改 `createReadStream`（配合 `Range` 用 `start/end`），长期把文件交给对象存储 + CDN。

## 练习

<Exercise title="练习 1 · 亲手做出那条解码失败" difficulty="挑战">

用 `node:http` 写一个路由，声明 `Content-Encoding: gzip` 但 `res.end()` 发的是未压缩字符串，再用 `fetch` 读 body。写出你看到的报错原文，并解释：(1) 为什么状态码还是 200；(2) 为什么 `curl -I` 看不出问题、浏览器却白屏；(3) 如果两层都能压缩，职责该怎么定。

<template #answer>

(1) 因为状态码描述的是「请求处理成功」，头部与 body 的一致性不是服务端会检查的事，错误发生在**客户端解码阶段**，响应早已发完。本章实测原文是 `客户端直接失败：terminated / cause=Z_DATA_ERROR`（脚本里对应 `/asset?lie=1`，`Z_DATA_ERROR` 表示按 gzip 流解出来的数据校验不过）。(2) `-I` 只拿 header，每个头单独看都合法；只有把 body 真解一遍才暴露不一致——「看头」和「看字节」是两种检查，缺一不可。(3) 定成单向职责：源站负责产生最终表示（要么不压，要么压完就把 `Content-Encoding` 与 `Content-Length` 一起定死），边缘只透传不重编码；确实需要边缘压缩时用 `Vary: Accept-Encoding` 把表示分开，并禁用对已压缩资源的二次处理（`no-transform` 就是为这类冲突存在的）。验收：同一 URL 分别用 `identity` 和 `gzip` 各存一份文件，比对第一字节是不是 `1f 8b`。

</template>

</Exercise>

<Exercise title="练习 2 · 一张签名为何能读全站" difficulty="进阶">

把本章 H6 的实现改成只让 `exp` 参与签名（不签 path），然后用同一张签名分别请求 `/signed` 和另一个私有路径。回答：(1) 你会观察到什么，为什么没有任何报错；(2) 除了 path，还应把什么放进签名输入；(3) 为什么撤销只能靠过期或换密钥，工程上如何把这个损失降到最低。

<template #answer>

(1) 两个请求都会 200：服务端只验「签名与 `exp` 是否匹配」，`exp` 没变签名就仍然有效，路径不在它的计算范围内。这类越权表现为「一切正常」，所以**必须主动测**——任何签名 URL 实现上线前，用例里要有一条「改 key 后必须被拒」。本章实测的 `换路径：bad-signature` 就是正确实现该给出的结果，请把它固化成你自己的回归用例。(2) 至少含对象 key 与有效期；实践上还该含影响语义的字段（如上传场景里的 `Content-Type` 与长度限制），并把分隔符显式写进被签字符串（本章用 `'\n'`）以避免拼接歧义；签发接口还应约束可签的 key 前缀。(3) 签名 URL 是**无状态授权**：它的可验证性恰恰来自「不需要查服务端」，一旦需要查就失去了边缘直读的意义。所以把它当短期凭证而不是身份：有效期分钟级、按需签发（用户点下载时才签）、key 不接受前端任意传入、日志记录签发了哪个对象以便事后定位泄露面。

</template>

</Exercise>

<Exercise title="练习 3 · 从实测数字反推该不该把文件交出去" difficulty="基础">

用本章数据算三笔：(1) 单请求 40MB 缓冲发的峰值增量是 48.7MB，8 并发是 124.3MB，为什么后者不是 8 × 48.7？(2) 若一次活动预计 60 个并发同时下载同一份 30MB 文件，缓冲法大约要留多少内存？流式法呢？(3) 已知 `tail-buffered` 只发 8KB 却多占 42.6MB，写出你会给团队定的两条编码规矩。

<template #answer>

(1) Buffer 在 `res.end(b)` 写完后就能回收，而 socket 背压让 8 个响应不可能同时处于「读完了但还没写完」的状态；124.3MB 远小于 8 × 40MB，但**它仍随并发与文件大小同向增长**，上界不由你控制。要学的不是精确倍数，而是「缓冲法的内存峰值由并发决定」——活动日或爬虫都能把它推到你没算过的值。(2) 缓冲法的量级是「同时在飞的响应数 × 30MB」，60 并发即使一半同时持有也在 900MB 量级，进程基本会被自己的内存上限打死；流式法按实测外推约在几十 MB（1 并发 7.9MB、8 并发 42.8MB，不随文件大小线性）。但真正该做的不是「换流式」而是「别让应用进程发这份文件」：它已是可公开内容，交给哈希命名 + 长缓存 + 边缘。(3) 规矩一：超过阈值（例如 1MB）的响应必须流式，禁止 `readFileSync` / `Buffer.concat`；规矩二：任何「取一段」的接口必须用 `createReadStream` 的 `start/end` 或存储侧的 range 能力，禁止整读后切片。两条都能用一次 grep 审：`readFileSync` 出现在请求处理链路里就必须有明确理由。

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN · Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) —— 核实本章两处逐字引用：`immutable`「fresh 期间不会被更新、避免不必要的条件请求」，以及 `no-cache`「可以存但每次复用前必须验证」这个容易被读反的定义。
- [MDN · Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests) —— 核实 `Accept-Ranges` 的判定条件、206 必须同时给出「段的 `Content-Length`」与 `Content-Range`、416 表示区间与资源范围不重叠；本章 H4 三行输出逐条对它校验过。
- [RFC 6266](https://datatracker.ietf.org/doc/html/rfc6266)、[RFC 8187](https://datatracker.ietf.org/doc/html/rfc8187) —— 核实 `filename*=UTF-8''<编码值>` 的语法与兼容性顺序；本章实测只证明「非 ASCII 会被拒」，写法以原文为准。
- [RFC 9110](https://datatracker.ietf.org/doc/html/rfc9110) —— 核实条件请求与状态码的规范定义，尤其是本章标为「未证实」的 `Range` 与 `Content-Encoding` 组合关系。
- [Node.js · File system](https://nodejs.org/api/fs.html) 与 [Streams](https://nodejs.org/api/stream.html) —— 核实 `fs.readFileSync` 的同步语义与 `createReadStream` 的 `start` / `end` / `highWaterMark`，本章内存数字的实现依据。
- 产品资料入口（本章未使用其任何接口名或价格）：[Amazon S3](https://aws.amazon.com/s3/)、[阿里云对象存储 OSS](https://www.aliyun.com/product/oss)、[Cloudflare 文档入口](https://developers.cloudflare.com/)。动手前请从这些入口进去核对：桶权限模型、预签名与表单直传的字段、回源与刷新预热的语义和耗时、计费项划分。

## 下一章

本章把「文件该由谁发」画到 HTTP 层：实测的内存代价说明为什么大文件不该经过应用进程（一个 40MB 缓冲要多占 48.7MB，只取 8KB 却读满 42.6MB），`immutable` 与 ETag 的行为差别、`Vary` 的缓存键拆分、`Range` 的 206/416、`Content-Disposition` 的 `ERR_INVALID_CHAR`、「签 path + 分钟级有效期」的私有读形状，构成你在任何一家厂商面前都要自己守住的部分。有了这些，[阶段项目：加一层扛得住量的数据层](/data-storage/project) 才能把前 13 章串起来验收——那里会落到一份可勾选的清单上。若你的瓶颈已在 Nginx 或部署链路，[Nginx](/linux/nginx) 与[网络：HTTP 演进与 CDN](/computer-science/network-http) 更贴近问题。
