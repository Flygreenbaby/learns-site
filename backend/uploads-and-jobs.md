# 文件上传、定时任务与后台作业：三类「一跑就看不见」的活

第 12 章给每个请求打了点、编了号，但本章三件事都发生在请求之外。一次上传的真实成本不在堆里（实测：收 1 MB 之后 `heapUsed` 只动了 1 MB 不到，`rss` 涨了 21 MB），一个定时任务的错误要三天后才在对账单上露头，一个后台作业的重复投递则会当场变成两次扣款。你能提前做的只有把边界写死：谁能传、传多大、是什么类型、任务几点跑、跑失败了怎么办。

前置：[结构化日志与指标](/backend/logging-and-monitoring) 结尾实测的 `rss` 与「饱和度比利用率更能杀死进程」是本章第一节的判据；[Web 安全](/backend/web-security) 的「一切输入都是不可信输入」在上传这里最具体——文件名、`Content-Type`、文件内容都是攻击者控制的字符串；[统一错误处理](/backend/error-handling) 的 `cause` 序列化决定了任务失败后你能不能查出真因。

## 三种接收方式：memory、fs、stream

同一个 multipart 表单分别用三种写法收，把收到的字节数、内存和耗时都打出来（本机 `node:http` 裸写，不装任何库）：

```text
起始 heapUsed=7 MB, rss=60.7 MB
  mode    收到的总字节   文件部分字节  heapUsed  rss   魔数判定          耗时(ms)
  memory          314           68       7.8    61.6   image/png          2.3
  memory          377          131       8.1    61.8   image/jpeg         0.3
  memory          280           34       8.3    64.1   image/gif          0.2
  fs          1048750      1048750       8.6    90     UNKNOWN/BINARY     7.1
  stream      1048644            0       8.9    82.1   image/png          2.6
```

三行 `memory` 是小文件收进 `Buffer` 再落盘；`fs` 是管道直落临时文件、最后再读头部；`stream` 是 `req.on('data')` 里逐段累加字节数、只保留前 16 字节做嗅探、超限就写响应并 `req.destroy()`。

三个结论：

1. **判断上传会不会把进程打到 OOM，必须看 `rss`，看 `heapUsed` 是自欺欺人**。Buffer 走 external 内存，`heapUsed` 几乎不动——上面 `fs` 那一行 `heapUsed` 只有 8.6 MB，`rss` 已经 90 MB。GC 也救不了你：字节不在堆上，就没有「及时回收」这回事。
2. **`fs` 模式的魔数判定报了 `UNKNOWN/BINARY`，是本机代码的真 bug 不是文件的问题**：管道直落磁盘后读到的前 16 字节是 `--X--Content-D`，也就是 multipart 分隔符加 part 头，不是文件头。嗅探必须先定位到 part 的内容起点，`stream` 模式同理——上面 `stream` 行 `文件部分字节 = 0` 是因为我故意只数总量不落文件，`head` 里恰好从内容开始。
3. **三种模式的失败模式完全不同**：`memory` 是「一个请求吃掉整个内存上限」；`fs` 是「磁盘写满 + 留下没清理的临时文件」；`stream` 是「校验在被拒之后才发现不能撤销」。选 `stream` 的唯一理由是它能边收边判，代价是回滚要么删文件要么留着。

<Callout type="verified" title="本章上传、定时器、时区与队列数字都在本机跑出">

Windows 10 x64 + Node v25.4.0，2026-10-18，`node backend/.scratch/uj-jobs.mjs`，只用 `node:` 内置模块。如实交代边界：嗅探、大小限制与预签名用的 9 个文件是我为测试构造的最小样本，不是真实照片；**客户端与服务端在同一进程里，所以 `rss` 数字（241.6 MB、90 MB）只能看量级，不能当作服务端隔离结论**；元数据剥离是本机手写的 chunk/segment 走查，不是解码后重编码，也没让第三方解码器验过；预签名是 HMAC 语义演示，不是 S3 SigV4；队列是追加写 JSONL 文件，不是 Redis/BullMQ，「崩溃」是用「做完副作用不 ack」模拟的；cron 的 36 次/18 次 missed 是按表达式算出的时刻数，不是某个真实调度器跑出来的。临时脚本已删除。

</Callout>

<Callout type="unverified" title="multer 与 @fastify/multipart 的选项名未经本机验证">

本机没装 multer，也没装 `@fastify/multipart`（本章坚持只用 `node:` 内置模块），所以它们的选项**一行都没执行**：`storage`/`diskStorage` 的字段名、`limits.fileSize`、Fastify 的 `attachFieldsToBody`、`awaitPartRead` 与「超限后 part 是否自动丢弃」——请以 [multer 仓库 README](https://github.com/expressjs/multer) 和 [@fastify/multipart](https://github.com/fastify/fastify-multipart) 当前版本核对后再抄。要点是通用的：任何库都给你三个开关——收到哪里（内存/磁盘/流）、单文件上限、文件个数上限，三个都必须显式设，别信默认值。

</Callout>

## 类型判定：扩展名、声明 MIME、真实魔数互不相同

9 个真实构造的文件（扩展名、声明的 `Content-Type`、文件头 8 字节、按魔数判定的结果都打了出来）：

```text
  文件名           声明 Content-Type    前 8 字节 hex        魔数判定             字节数
  photo.png        image/png           89504e470d0a1a0a     image/png               68
  photo.png        image/png           504b030414000000     application/zip        133
  holiday.jpg      image/jpeg          ffd8ffe000104a46     image/jpeg             131
  holiday.jpg      image/jpeg          89504e470d0a1a0a     image/png               68
  logo.gif         image/gif           4749463839610200     image/gif               34
  doc.pdf          application/pdf     255044462d312e37     application/pdf         69
  cover.svg.png    image/png           3c73766720786d6c     image/svg+xml           85
  shell.php.png    image/png           3c3f706870207379     text/x-php              28
  report.zip       application/zip     1f8b080000000000     application/gzip        29
扩展名与真实类型一致的只有 4/9；只看扩展名会放行的危险件 = 2 个（cover.svg.png, shell.php.png）
声明的 Content-Type 与真实魔数不符的行数 = 2
```

**扩展名是用户写的，`Content-Type` 是用户浏览器写的，只有文件头是文件本身**。`multipart` 里每个 part 的 `Content-Type` 由客户端填，服务端信它就等于让上传方自称什么就是什么。嗅探就是「取前若干字节比对签名表」：`89504e47…` → PNG、`ffd8ff` → JPEG、`474946383961`/`474946383761` → GIF、`25504446`（`%PDF`）→ PDF、`504b0304` → ZIP、`1f8b` → gzip、`3c3f706870`（`<?php`）→ PHP、正则 `^\s*<svg` → SVG；比对要在**去空白之后的文本头 + 二进制头**两条路上都做一遍，本机那张 `cover.svg.png` 就是靠文本头才认出 `image/svg+xml` 的。没命中签名表的一律 `UNKNOWN/BINARY` 直接拒。

判定之后还要三件事：

- **白名单，不是黑名单**：只允许 `image/png`、`image/jpeg`、`image/gif`、`image/webp`；「不是 `.php` 就行」永远漏。
- **`image/svg+xml` 要单独决策**：SVG 是 XML，可以带 `<script>` 和外部引用。要么拒绝，要么存成 `image/svg+xml` 但用独立域名下发并强制 `Content-Disposition: attachment`——放在主域下当图片渲染，就是一次存储型 XSS（见 [Web 安全](/backend/web-security)）。
- **`application/zip` 与 `application/gzip` 是一对**：`report.zip` 的真头是 `1f8b`（gzip）。扩展名与内容不一致时，永远以内容为准并把扩展名丢掉。

## 文件名与路径穿越：22 个真实载荷

把 22 个载荷喂进同一份 `safeJoin(base, name)`，结果如实贴出来（放行 9 / 拦截 13，**落点逃出基目录的 0 个**）：

```text
  "photo.png"                        放行   <TMP>\uploads\photo.png
  "../../evil.png"                   放行   <TMP>\uploads\evil.png
  "..\\..\\evil.png"                 放行   <TMP>\uploads\evil.png
  "/etc/passwd"                      放行   <TMP>\uploads\passwd
  "C:\\Windows\\win.ini"             放行   <TMP>\uploads\win.ini
  "....//....//x.png"                放行   <TMP>\uploads\x.png
  "\\\\server\\share\\x.png"          放行   <TMP>\uploads\x.png
  "%2e%2e%2f%2e%2e%2fetc%2fpasswd"   拦截   含未解码的 %
  "photo.png\u0000.png"              拦截   含控制字符/NUL
  "CON.png" / "nul"                  拦截   Windows 保留设备名
  "." / ".." / ""                    拦截   basename 退化或空名
  "evil.png " / "evil.png."          拦截   结尾点或空格会被 Windows 裁掉
  "pīc.png" / "a<b>.png" / "sh~1.png"  拦截  字符白名单不通过
  超长名（> 200 字符）                 拦截
```

「放行」不等于危险：9 个放行载荷全部因为**先 `basename` 拉平、再 `resolve` 后校验前缀**而落在基目录内。这两步缺一不可：

```js
const name = path.basename(raw);                       // "../../evil.png" -> "evil.png"
const full = path.resolve(base, name);
if (!full.startsWith(path.resolve(base) + path.sep)) throw new Error('ESCAPED');
if (/[<>:"|?*\u0000-\u001f]/.test(name)) throw new Error('CTRL');
if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) throw new Error('RESERVED');
```

三个坑值得单独记：

1. **同一份校验代码在两个平台语义不同**：`..\..\x` 在 POSIX 上是一个合法文件名（反斜杠不是分隔符，不穿越），在 Windows 上是两步父目录。用 `path.posix` 写的校验拿到 Windows 上就是漏的，反过来则是过严。
2. **二次解码**：`decodeURIComponent("%2e%2e%2f")` = `../`，本机把它再喂进 `safeJoin` 仍落在 `uploads\passwd`（`basename` 已经拉平）。但只解码一次就拼路径、或解码两次才校验，都会漏。规则是**校验之前完成所有解码，且只解码一次**；看到还没解码的 `%` 就直接拒。
3. **最稳的做法是不接受用户给的名字**：本机生成的存储键是 `da65ddafd0014523871f3ab3b669295c.png`（随机 uuid + 由魔数决定的扩展名），原名只进数据库字段 `original_name`，下载时通过 `Content-Disposition` 回给用户。穿越、保留名、超长名、编码歧义一次性全消。

## 大小上限、拒绝服务，以及那个没送达的 413

拿 40 MB 打服务端上限 8 MB 的两个端点：

```text
40MB -> memory(8MB 上限)：客户端 CLIENT-ERR TypeError: fetch failed / cause=ECONNRESET, 68 ms
   服务端读到 8453895 字节即断，heapUsed 8.6 MB，rss 241.6 MB
40MB -> stream(413 写完立刻 req.destroy)：同样是 ECONNRESET, 55 ms, 读到 8453882 字节, 15.2 ms 完成丢弃
40MB -> graceful(先写 413 再继续读完剩余字节)：客户端仍然是 ECONNRESET, 57 ms
慢客户端(每 120ms 发 1KB)打到 idle-timeout=200ms 的端点：408 idle timeout
   服务端记录 {"mode":"slow-abort","bytes":1024,"ms":213}，客户端耗时 484 ms
```

要点：

- **超上限要在「读到就断」，不是「收完再判」**。上面 `memory` 那行只读到 845 万字节就停手，但 `rss` 已经 241 MB（客户端与服务端在同进程，这个数字只能看量级，不能当服务端隔离结论）——上限设多大，等于你允许攻击者一次性占用多少内存。真正抗 DoS 的是 `stream` + 计数 + 超限即断。
- **那个 413 客户端根本没收到**。三种拒绝方式（`destroy`、写完就断、先响应后丢弃）在本机实测里客户端**全部**拿到 `ECONNRESET`。也就是说：写 `if (status === 413) 提示「文件太大」` 的前端代码在生产上永远不会命中，用户看到的是「上传失败，请重试」。要么让服务端在 `Content-Length` 就超限时先响应再断（浏览器一般会读到），要么前端在上传前用 `file.size` 拦，并在 `fetch` 抛错时也走同一段文案。
- **必须有 idle timeout，不只是 size 上限**。慢客户端一个字节一个字节地挤，能把连接和临时文件占几小时；本机 200 ms 空闲就返回 408 并断开。

## 图片里的元数据：删段和重编码不是一回事

本机自己写了 chunk/segment 走查，剥掉非像素段（不是完整重编码）：

```text
PNG chunk 序列 = IHDR(13) tEXt(18) tEXt(8) IDAT(11) IEND(0)
原始 118 字节 -> 剥离后 68 字节
剥离后仍含敏感串? 31.2304=false | zhang@example.com=false | tEXt=false | XML:com.adobe.xmp=false
剥离后仍是合法 PNG: 签名正确，保留 chunk 序列 = IHDR IDAT IEND
   IDAT inflate：剥离后成功还原 14 字节扫描线 / 未剥离原件同样 14 字节
JPEG 段序列里被丢弃的 = FFE0(APP0), FFE1(EXIF/APP1)；131 字节 -> 45 字节
剥离后仍含 GPS? false；SOI/EOI 仍在 = true
```

手机照片默认带 EXIF：GPS 经纬度、拍摄时间、设备型号、序列号，XMP 里还可能有作者邮箱和「软件版本」。**对外发布的图片必须剥**——这不是隐私偏好，是「用户上传的原图泄露他家庭住址」的事故。

如实划清边界：上面只证明「元数据段被删掉、容器结构没坏、像素数据 inflate 得回来」，**没有**证明第三方解码器还能正常出图，也没有做真重编码（本机没有图像库）。真正安全的做法是解码 → 重新编码成新的 PNG/JPEG：像素重新生成，所有非像素段自然消失，顺带还能统一尺寸、压掉 `tEXt`/`iTXt`/`zTXt`、把 ICC 色彩配置按需要保留。删段是权宜之计，重编码才是终点；做重编码时记得宽高、旋转标记（EXIF `Orientation`）和透明通道都要验证，否则用户会发现图片全歪了。

## 直传对象存储：预签名 URL 换来什么、丢掉什么

本机用 `node:crypto` 的 HMAC 实现了一个语义等价的签发/校验端点（不是 S3 SigV4）：

```text
  正常 60s TTL          -> HTTP 200 (ok)     /dl?k=a.png&e=<过期秒>&s=<32位hex>
  已过期                 -> HTTP 403 (expired)
  签名后把 k 改成 b.png   -> HTTP 403 (signature-mismatch)
  TTL=0，等 1.1s 再请求   -> HTTP 403 (expired)
```

签名覆盖「对象键 + 过期时刻」，改任何一个字节签名就废——这就是一条能力很窄的临时凭据。取舍：

- **换来的**：服务端不再中转字节，带宽和 `rss` 都归到对象存储；上传 40 MB 不再影响应用进程；并发能力与实例数解耦。
- **丢掉的**：应用侧收不到流，于是本章前面所有校验（魔数嗅探、路径穿越、大小计数、元数据剥离）**全部做不了**，只能靠 bucket 端的 policy 字段兜（`content-length-range`、限 `content-type`、限键前缀），或者上传完再由对象存储触发函数补做。
- **必须配的**：键前缀只能落在用户自己的目录（否则一张签名能覆盖别人对象）、`Content-Disposition` 与 `Content-Type` 由服务端定死、TTL 短到几十秒、且**签发与校验必须统一时区基准**（上面 `TTL=0` 那行的过期判定完全依赖服务端时钟，见下一节）。
- 直传之后仍然要「确认对象真的存在再落库」：客户端拿到 204 不代表文件真上传成功。做法是回调 + 轮询双保险，或者先记 `pending`，由后台作业核对后再置 `ready`——这个后台作业正好就是本章后面的队列一节。

## 事件循环上的定时器：漂移、丢拍、重叠、丢任务

`setInterval` 在本机的真实表现（`period=50ms`，观察 500 ms）：

```text
无阻塞：实际触发 9 次（理论 10），最后一次晚点 97.7 ms，平均晚点 56.2 ms
第 3 次触发里同步阻塞 300 ms：实际触发 5 次（理论 10）
  期望/实际/晚点(ms)：1:50/62.4/12.4  2:100/124.7/24.7  3:150/187.4/37.4
                     4:200/487.5/287.5  5:250/548/298
  晚点 >= 一个周期的触发数 = 2；被合并掉的拍数 = 10 - 5
重叠：period=80ms 而任务耗时 250ms -> 5 个 tick 的峰值并发 = 3
  start#1@94 start#2@189 start#3@270 end#3@359 start#4@359 end#4@453 start#5@453 end#5@532
加「上一轮没跑完就跳过」的守卫：tick=8 执行完成 2 跳过 5 峰值并发 1，总耗时 739 ms
Windows 定时器粒度：setTimeout(5ms) 实际 15.5 ms
```

四条都在上面：

1. **漂移**：`setInterval` 的「下一次」= 上一次回调执行完 + period，于是每次被延后都累积。自我纠偏的写法是自己算应触发时刻：`setTimeout` 的第 n 次延迟 = `start + n*period - 现在`（取不小于 0），并记得 `id.unref()`（见第 4 点）。本机对照跑同样 1.6 秒窗口：`setTimeout` 链**触发 16 次，最后一次晚点 10.1 ms**，同参数 `setInterval` **触发 13 次，最后一次晚点 177.6 ms，平均晚点 100.3 ms**。长周期任务必须自己纠偏。

2. **丢拍不补拍**：Node 不会为错过的 tick 各补一次，它们被合并掉了（上面 10 次变 5 次）。如果语义是「每 5 分钟必须结算一批」，被合并掉的那两轮就是少算的钱；如果语义是「现在是什么状态就行」（reconcile），跳过反而正确。**先想清楚要哪一种，再决定跳过还是排队。**
3. **重叠**：`setInterval` 不等上一轮结束，任务比周期长时并发度直接涨到 3——两次同时跑「清理过期文件」或「发对账邮件」是事故。守卫（`if (running) return`）能把峰值并发压到 1，但本机守卫版 8 个 tick 只完成 2、跳过 5，说明**任务本身跑不完时守卫只是让现象变体面**，真正要改的是任务耗时或周期。
4. **进程不退出与任务丢失**：只挂着 `setInterval` 不 `clearInterval`/`unref` 的子进程被父进程杀掉（退出码 `null`，观察 923 ms），同样代码调用 `timer.unref()` 后 75 ms 正常退出码 0。而内存数组当队列：处理到第 3 个任务时抛异常，**已完成 2，剩余待办 = 1**（第 3 个已经被 `shift` 出来，随栈一起没了）——不需要崩机，一个异常就够。这两条一起构成了把任务落到持久化存储的理由。

## 时区与夏令时：02:30 那天根本不存在

本机时区 `Asia/Shanghai`，目标时区 `America/New_York`，换算只用 `Intl.DateTimeFormat`，不用 `Date` 的本地方法：

```text
2026-03-08 02:30 New York 是否存在 = 不存在（春季拨快 1 小时，02:00-02:59 被跳过）
   匹配到的瞬时数 = 0
2026-11-01 01:30 New York -> 匹配到 2 个瞬时: 2026-11-01T05:30:00.000Z 与 06:30:00.000Z
2026-03-08 03:30 -> 1 个瞬时（07:30:00.000Z）；普通日 2026-06-15 02:30 -> 1 个瞬时
"每 24 小时"用 ms 累加（起点 = 2026-03-07 02:30 ET = 07:30Z）：
  +0h  -> 墙上时间 03-07 02:30 (offset -5h)
  +24h -> 墙上时间 03-08 03:30 (offset -4h)   漂了
  +48h -> 墙上时间 03-09 03:30 (offset -4h)   继续 03:30
```

三种写法三种错：**0 次**（春季那天的 02:30 任务不跑）、**2 次**（秋季拨回，同一个墙上时间对应两个瞬时，任务跑两遍）、**永远挪一小时**（按 24×3600×1000 ms 累加，拨快之后它变成 03:30）。规则：

- 存储一律 UTC（或 `epoch`），跨时区系统里本地时间没有可比性；展示时才用 `Intl` 加用户时区。
- 调度要么明确「按 UTC 跑」，要么明确「按某个业务时区的墙上时间跑」，并在后者时用 IANA 名（`America/New_York`）而不是固定偏移——偏移不随夏令时变，IANA 名会。
- **同一分钟跑两遍要靠幂等键挡住**，不能靠「应该不会重复」。下一节的作业队列就是干这个的。
- **好消息**：Node 的 timer 用单调时钟，改系统时间不会让定时器立刻补跑或倒退；但第 12 章实测的 `Date.now()` 会被 NTP 回拨打穿，所以耗时用 `hrtime`、时刻记 UTC ISO。

## cron 表达式与 misfire 语义

```text
cron "*/10 * * * *" 在 6 小时里应触发 36 次
若进程停机 3 小时（错过 18 次）后恢复：
  catch-up（补跑）= 一次性补 18 个任务同时开跑
  skip-to-now（跳过）= 只跑下一个 10 分钟档 1 次，少 18 次
cron "30 2 * * *" 在 America/New_York 的 2026 年 3 月：31 天里只有 30 天存在 02:30 -> 实际触发 30 次
```

- **misfire 策略必须写在配置里，不能留给默认值**：补跑会把 18 个报表任务同时放出去（依赖被打死，「每天一次」的报表重复 18 次），跳过则对账缺一块。生产上再加 deadline：misfire 超过 N 分钟就不补，转为人工或单独补偿任务。
- **字段数有歧义**：`crontab(5)` 是 5 字段（分 时 日 月 周），不少 Node 库支持 6 字段（多一个秒），Spring 是 6–7 字段；同一串 `0 30 2 * * *` 在前者非法、在后者是「每天 02:30:00」。另外日/月同时受限时是「或」不是「且」。具体库支持几种字段、`?` 是否可用、周日是 0–6 还是 1–7，请以该库文档核对（本章未装任何 cron 库，此条属文档核实）。，所以它天然会遇到上一节的 0 次/2 次：`30 2 * * *` 在纽约每年少跑一次（3 月 8 日），要么接受，要么改成不落在切换窗口的时刻。

## 持久化队列：退避、死信与幂等

先测退避的时间序列（基 200 ms、翻倍、上限 30 秒、最多 3 次重试）：

```text
  none   各次失败后的等待(ms) = [200, 400, 800, -]  实际总耗时 1424 ms  调用次数 = 4
  equal  各次失败后的等待(ms) = [151, 306, 643, -]  实际总耗时 1127 ms  调用次数 = 4
  full   各次失败后的等待(ms) = [102, 212, 486, -]  实际总耗时  818 ms  调用次数 = 4
  full jitter 的 200 次抽样 = 190 个不同延迟值（无抖动时 200 个客户端会在同一毫秒齐刷刷重试）
```

无抖动就是**重试风暴**：下游刚有点恢复，被你一次同步的 200 倍流量又打死。equal jitter 只随机化一半，full jitter 在 `[0, cap]` 里均匀取，本机数据里 full 最快也最分散。只对「可能自愈」的失败重试（超时、连接重置、429、5xx）；对「永远不会自愈」的失败（校验不过、用户不存在）直接失败——无脑重试 4 次等于把 4 倍流量送给一个已经明确说不的客户。

然后是文件版持久化队列（追加式 JSONL，字段就是生产队列的那几个：`attempts`、`nextAt`、`state`、`idempotencyKey`）。入队 5 个任务：`j1` 正常、`j5` 与 `j1` 共用幂等键、`j2` 前 2 次超时、`j3` 永久失败、`j4` 副作用做完后崩溃：

```text
03:33:49.121 j2 attempts=1 失败(timeout)      -> 退避 120ms 后重投
03:33:49.137 j3 attempts=1 失败(下游 500)     -> 退避 120ms 后重投
03:33:49.153 j4 attempts=1 失败(PROCESS_CRASH（副作用后、ack 前）) -> 退避 120ms 后重投
第一轮后: 副作用文件行数 = 3, 状态 = j1:done j2:pending j3:pending j4:pending j5:done
03:33:50.263 j3 attempts=3 失败(下游 500)     -> 进 DLQ
三轮后:   副作用文件行数 = 5, 状态 = j1:done j2:done j3:dead j4:done j5:done
j4 的副作用落地次数 = 2
```

再跑一次同样的负载但**打开幂等台账**：`副作用行数 = 2`，状态 `j1:done j5:skipped j6:done`。这几行就是本节全部要点：

- **至少一次交付下，重复执行不是 bug，是语义**。`j4` 的副作用落了 2 次，因为「做完副作用」和「ack」之间总有窗口。所以消费端必须幂等：外部副作用带幂等键（扣款、发短信、写消息）、写操作先查后写或用唯一索引、或者像本机那样维护一张台账把第二次直接 `skipped`。
- **「先 ack 后处理」在任何至少一次队列里都是错的顺序**：只有队列 ack 成功但副作用没做 = 丢任务，反之 = 重复；宁可重复也不能丢，所以顺序只能是「处理成功 → 再 ack」，然后靠幂等吃掉那一次重复。
- **死信队列（DLQ）要有，而且要有人看**。`j3` 三次失败进 DLQ，带着 `attempts`、每次的错误 `name`/`code`/`cause`（第 12 章的序列化格式在这里正好用得上）和原始载荷。没有 DLQ 的重试策略等于把任务静静扔掉。
- **可见性超时 / 心跳续租**：worker 拿到任务后如果卡死，任务要能被别人重新领走；处理时间不确定就要续租，否则一边做一边被重投。并发数也要显式设成上限并暴露成 gauge（第 12 章 USE 里的 saturation），别靠 `while` 抢。

## 超时与取消：AbortSignal 是协作式的

```text
  对端收下连接但永不响应 + AbortSignal.timeout(200) -> TimeoutError / 实测 211 ms
  不尊重 signal 的任务：取消在 156 ms 发出，副作用仍然在 406 ms 才发生
  同样 400ms 的工作拆成 40 个 10ms 且每步检查 signal：157 ms 停下，只完成 9/40 步
  AbortSignal.any([timeout(60), 手动 abort]) -> TimeoutError @ 62 ms
```

`signal` **不会打断任何正在执行的东西**，它只是一个标志位，靠被调方在每个 `await` 处自己检查。所以：给每个外部调用（HTTP、数据库、下游 RPC）一个显式超时，别指望调用方取消；长任务要自己写成可中断的分片循环；捕获 `AbortError` 后不要把取消当成业务失败去重试——本机那次取消里「重试」只会让副作用再多落一次。优雅关闭（收到 SIGTERM 后停止领取新任务、给在跑的活儿一个有限窗口）留给下一章。

## 常见错误与排查

**1. 相信客户端声明的 `Content-Type`。** 现象：`shell.php.png` 被当成图片存下并被访问。确认：把落盘文件的头 8 字节和数据库记的类型并排查一遍（本章实测 9 个样本只有 4 个一致）。修：魔数嗅探 + 白名单 + 扩展名由服务端重写。

**2. 用用户给的文件名直接拼路径。** 现象：`uploads` 之外的目录出现文件。确认：拿 `../../`、`....//`、`%2e%2e%2f`、`CON.png`、结尾空格这几条载荷打你的实现。修：`basename` 拉平 + `resolve` 前缀校验 + 随机存储键；同时记住 Windows 与 POSIX 对 `\` 的语义不同。

**3. 上传大小只在前端限制。** 现象：绕过前端的请求把 `rss` 打到几百 MB。确认：看进程 `rss` 曲线而不是 `heapUsed`（实测 Buffer 让 `heapUsed` 几乎不动）。修：服务端边读边计数超限即断 + 单文件与文件个数都设上限。

**4. 定时任务里不做重入保护。** 现象：同一批邮件发了两遍、清理逻辑互删。确认：把周期设成比任务耗时短，看并发峰值（实测峰值 3）。修：守卫标志 + 把周期放宽 + 跨实例分布式锁或单实例部署。

**5. 「每 24 小时」用毫秒累加。** 现象：夏令时切换后任务时间点变了（实测 02:30 挪到 03:30）或跑了两遍。修：按业务时区的墙上时间安排并由调度库换算，落库一律 UTC，配合幂等键吃掉重复。

## 练习

<Exercise title="练习 1 · 判断这份上传该不该收下" difficulty="基础">

一个 part 的元数据是：`filename = "../avatar.png"`，`Content-Type = "image/png"`，内容前 8 字节 `504b030414000000`，声明长度 312 字节。服务端基目录是 `/srv/uploads`，上限 8 MB。① 三个信息来源里哪两个不可信？② 真实类型是什么？③ 落盘名与路径怎么定？

<template #answer>

① `filename` 与 `Content-Type` 都是客户端写的，都不可信；只有内容头是文件本身。本章实测：9 个样本里扩展名与真实类型一致的只有 4 个。② `504b0304` 是 ZIP 本地文件头——它是一个 zip（可能是 docx/xlsx/apk），不是 PNG；`image/png` 的头应是 `89504e47`。若白名单只有图片类型，这个必须拒。③ `basename("../avatar.png") = "avatar.png"`，`resolve("/srv/uploads", "avatar.png")` 仍在基目录内，前缀校验通过；但更稳的是不采用用户名字，直接生成随机键（扩展名由魔数决定，这里是 `.zip`），原名进数据库字段。312 字节远小于 8 MB，大小这一关能过，但**不能因为小就跳过类型校验**。

</template>

</Exercise>

<Exercise title="练习 2 · 给这个任务算退避与总耗时" difficulty="进阶">

外部支付回调：基延迟 200 ms、指数翻倍、上限 3 秒、最多重试 3 次（共 4 次调用）。① 无抖动时第 1、2、3 次失败后各等多久？② 换成 equal jitter 和 full jitter，本机实测的等待序列分别是什么？③ 200 个 worker 同时失败时，无抖动会发生什么？④ 如果第 4 次调用成功但响应丢失、worker 崩溃后重投，你的代码要防什么？

<template #answer>

① 200、400、800 ms（本机实测总耗时 1424 ms，调用 4 次）。② equal `[151, 306, 643]` 总 1127 ms；full `[102, 212, 486]` 总 818 ms；full jitter 在 200 次抽样里给出 190 个不同延迟值。③ 无抖动时它们会在同一毫秒齐刷刷重试，把刚恢复的下游再打死——这就是重试风暴，抖动唯一的作用就是打散这一刻度。④ 至少一次交付下第 4 次调用会真的执行两遍：本章队列实测里那个 `j4` 的副作用落了 2 次。所以支付回调必须带幂等键（先查台账再动账，或用唯一索引），并保证「做完副作用才 ack」。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造错误：让每天一次的任务跑两遍" difficulty="挑战">

部署在纽约时区的一台机器上，用「起点时间 + 24 小时毫秒数」实现每天 01:30 的对账任务，起点设在 2026-10-31 01:30。任务体是读一段 SQL、然后调用一次扣款接口，没有幂等键，也没有重入守卫。预测 2026-11-01 当天发生什么、日志里能看到什么，并给出四条改法。

<template #answer>

2026-11-01 纽约把时钟从 02:00 拨回 01:00，于是墙上时间 01:30 **出现两次**——本章实测同一个墙上时刻匹配到 2 个瞬时：`2026-11-01T05:30:00.000Z` 与 `06:30:00.000Z`。如果你的调度是「每次醒来看现在是不是 01:30」，那天就跑两遍；如果严格按 24×3600×1000 ms 累加，那时间点会被持续推着漂（实测从 02:30 漂到 03:30 并保持），日志看起来一切正常，只有对账单三天后不对劲。更糟的是没有重入守卫：若第一次扣款调用因网络慢超过周期，两次执行并发，同一批订单被扣两次。

改法：① 任务体带幂等键（`job=daily-reconcile, runDate=2026-11-01` 落唯一索引，第二次直接 `skipped`，就是本机那个台账实验）；② 加运行守卫或分布式锁，重叠时跳过并统计 `skipped`；③ 调度按业务时区的墙上时间（IANA 名）而不是固定偏移，落库与日志一律 UTC；④ 把 misfire 与 deadline 写进配置，成功时输出 `lastSuccessAt` 指标，让「今天没跑」成为可被告警出来的症状（第 12 章：基于症状而不是原因）。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Node.js `node:http`](https://nodejs.org/docs/latest/api/http.html) 与 [`stream`](https://nodejs.org/docs/latest/api/stream.html) —— 核实请求体事件顺序、`req.destroy()` 语义、背压。本章三种接收方式都是本机用这两个模块裸写的。另见 [`node:crypto`](https://nodejs.org/docs/latest/api/crypto.html)（HMAC）与 [`Intl.DateTimeFormat`](https://nodejs.org/docs/latest/api/intl.html)（`timeZone` 接受 IANA 时区名）：DST 的 0 次/2 次结果是本机 `Intl` 实测。
- [multer](https://github.com/expressjs/multer) 与 [@fastify/multipart](https://github.com/fastify/fastify-multipart) —— **本章一行都没执行**：`limits`、`storage`、Fastify 的 `parts`/`file` 与超限行为都请以当前版本 README 为准。
- [crontab(5)](https://man7.org/linux/man-pages/man5/crontab.5.html) 与各 cron 库的 misfire 文档 —— 核实 5 字段语义、日/月同时受限时的「或」规则；字段数与秒/年支持、补跑策略名称属文档核实，未在本机执行。真实生产队列的语义请对照 [BullMQ](https://docs.bullmq.io/) 自行确认。

## 下一章

本章把三类「跑起来就看不见」的活各自的边界钉住了：上传要限字节、认魔数、拒原名、走 `stream` 并盯 `rss`；定时任务要纠漂移、防重叠、按业务时区安排并用幂等键吃掉重复；后台作业要持久化、退避加抖动、DLQ 加幂等，并且永远「处理成功才 ack」。[服务部署：Docker、优雅关闭与配置](/backend/docker-and-shutdown) 接着处理这些机制落地的前提：进程收到 SIGTERM 后怎么停止领取新任务并跑完在跑的活儿、配置与密钥从哪来、容器里时区该怎么设。
