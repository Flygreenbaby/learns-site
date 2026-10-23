# HTTP 缓存与资源加载策略：发版后用户看到旧页面，罪魁祸首是哪一个响应头

你周五发了版本，产物是 `index-D7xQ2p.js`，本地预览一切正常。周一开始有人反馈「页面打开是空的，控制台一片红」。让用户 Ctrl+F5，好了；关掉再打开，又坏了。翻日志看到的报错是这条：

```text
Uncaught SyntaxError: Failed to load module script: Expected a JavaScript-or-Wasm
module script but the server responded with a MIME type of "text/html"
```

注意它引用的文件名：`index-CQ9f2a.js`。**你这次发布的产物里根本没有这个文件**——那是上一版的哈希。旧 HTML 引用的旧 chunk 已经被新构建删掉，服务器上不存在，于是 SPA 的 fallback 把这个请求重写成了 `index.html`，浏览器拿到一份 HTML 却按模块脚本执行，报的是 MIME 错误而不是 404。这条报错看着像构建坏了，实际是**缓存坏了**：那份旧 HTML 还躺在用户浏览器或中间 CDN 的新鲜期内，浏览器连问都不问服务器就直接用了它。

第二种翻车在反方向。你把 `index.html` 改成 `no-store` 求个「彻底不缓存」，结果二次访问首屏更慢——`no-store` 是**禁止存储**，连几十字节的 304 都拿不到，每次全量重传；配到 CDN 上还会让每个请求都回源，源站被打穿。`no-cache` 与 `no-store` 只差一个词，一个是「存，但每次用之前问服务器」，一个是「根本不许存」。**搞混这两个，你会在「用户看到旧页面」和「服务器扛不住」之间来回横跳，永远找不到中间点。**

第三种最隐蔽：你给带哈希的资源配了 `max-age=31536000`，用户按一次刷新，Network 里刷出几百行 304，你以为配置没生效。那是**没加 `immutable`** 时的正常行为——显式刷新会强制对每个资源做一次条件校验。

三件事的根源是同一个：**HTTP 缓存不是一个开关，而是两套机制的分工**。强缓存决定「要不要问服务器」，协商缓存决定「问了之后要不要传内容」。

## 强缓存与协商缓存：一次请求的两道闸门

```text
第 1 道（强缓存）：本地有这份响应，且还在新鲜期内吗？
  在   → 直接用本地副本，**不产生任何网络请求**
  不在 → 进第 2 道
第 2 道（协商缓存）：带条件头去问服务器
  If-None-Match: "abc"        ← 上次响应给的 ETag
  If-Modified-Since: <时间>   ← 上次响应给的 Last-Modified
  没变 → 304 Not Modified，**响应体为空**，用本地副本
  变了 → 200 + 完整响应体 + 新的 Cache-Control / ETag
```

| | 强缓存 | 协商缓存 |
| --- | --- | --- |
| 由什么控制 | `Cache-Control: max-age`（+ `immutable`） | `ETag` / `Last-Modified` |
| 有没有网络请求 | **完全没有** | 有，但响应体可以很小 |
| DevTools 里看到 | `200 (from memory cache)` / `(from disk cache)` | `304 Not Modified` |
| 代价 | 内容变了也拿不到新的 | 每次一个往返（RTT） |
| 适合 | 内容变了 URL 也变的资源 | 内容变但 URL 不变的东西 |

**两者不互斥。** `max-age=60, must-revalidate` 的意思是「60 秒内谁都不问；60 秒后必须问，问到 304 才用」。所以一个响应上同时有 `Cache-Control` 和 `ETag` 完全正常。而 304 省的是带宽、省不掉 RTT——**这正是强缓存比协商缓存快的原因。**

## Cache-Control 指令逐个

指令语义核实自 MDN 中文与英文的 `Cache-Control` 参考页（2026-10-17 检索到的原文表述）。`Cache-Control` 是**逗号分隔的指令列表**，`max-age` 单位是**秒**。

| 指令 | 精确语义 | 用在哪 |
| --- | --- | --- |
| `max-age=31536000` | 从响应生成时刻起一年内视为新鲜，期间不发请求 | 带内容哈希的 JS/CSS/图片/字体 |
| `no-cache` | **仍然存储**，但每次使用前必须回源校验（拿得到 304） | `index.html` |
| `no-store` | **禁止任何缓存存储**，每次完整下载 | 含密钥的接口、一次性 token |
| `must-revalidate` | 过期后**严禁**用陈旧副本，校验失败就必须报错 | 与 `max-age` 搭配 |
| `public` / `private` | 允许 / 不允许共享缓存（CDN、代理）存储 | 静态资源 / 带 `Set-Cookie` 的个性化 HTML |
| `immutable` | 新鲜期内正文不会变，客户端**即使显式刷新也不该发条件请求** | 带内容哈希的资源 |
| `s-maxage=N` | 只覆盖共享缓存的 max-age，私有缓存忽略 | 源站给 CDN 单独 TTL |
| `stale-while-revalidate=N` | 过期后 N 秒内先发旧的、后台刷新 | 可容忍延迟的列表数据 |

三个必踩的点：

**`no-cache` 不等于「不缓存」。** 对 HTML 你要的正是它（配合 `ETag`）：内容变了立刻拿新的，没变只花几十字节。`no-store` 只在「绝不允许落盘」时用。

**`immutable` 改变的是显式刷新的行为。** MDN 中文页原文表述：客户端不应发送 `If-None-Match` / `If-Modified-Since` 检查更新，**即使用户显式刷新**。不加它，一次刷新就是一次几百个条件请求。另注：该页提到在 Firefox 里 `immutable` 只对 https 事务生效。

<Callout type="unverified" title="关于把 max-age 写得比一年更大">

`31536000`（365 天）是惯例值。有些资料提到「超过一年的值会被按一年处理」，这条截断规则**本章未能直连原文核实**。写更大值不会带来更强效果，只会让读配置的人困惑——请对照 [MDN 的 Cache-Control 页](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Headers/Cache-Control) 自查。

</Callout>

## Expires 的历史地位

`Expires` 是 HTTP/1.0 的强缓存头，值是一个**绝对时间戳**（`Expires: Wed, 21 Oct 2026 07:28:00 GMT`）。两个硬伤让它被 `max-age` 取代：它**依赖客户端时钟**（用户电脑时间慢两小时，过期时刻就错两小时，症状是「偶尔有问题」且无法复现）；服务器要为每个响应算一个未来时刻，而相对秒数不用。现行规则：两者同时存在时 **`Cache-Control` 优先**，`Expires` 只当兼容兜底。请求侧的 `Pragma: no-cache` 同样是历史包袱，响应侧起作用的是 `Cache-Control: no-store`。

## ETag 与 Last-Modified：两种校验依据

| | `Last-Modified` | `ETag` |
| --- | --- | --- |
| 值 | 最后修改时间（秒级 HTTP-date） | 内容指纹（`"67ab43"`，或弱 `W/"67ab43"`） |
| 粒度 | **1 秒**。一秒内改两次，中间那次检测不到 | 内容级，改一个字节就变 |
| 假阳性 | 只改 mtime 不改内容（`git checkout` 重写文件）→ 白重传 | 无 |
| 假阴性 | 无 | 内容动态生成（每次都不同）→ 永远 200，协商形同虚设 |
| 代价 | 几乎为零，读文件系统即可 | 要算摘要；**多实例集群各机算出的值可能不同** |
| 优先级 | 两者都有时先按 `If-None-Match` 校验，不匹配再退回 `If-Modified-Since` | — |

`ETag` 那个「多实例算出不同值」是真实故障源：负载均衡把校验打到另一台机器，值不一致，304 变 200 全量重传，症状是「缓存命中率飘忽」。弱 `ETag`（`W/`）表示「语义等价即可」，用于 gzip 与原文可互换的场景。

## 唯一正确的组合：哈希产物长缓存 + HTML 不缓存

回指[第 4 章](/frontend-engineering/vite-build)：构建产物文件名带内容哈希，含义是**内容任何变化都换一个文件名，同名文件内容永不变**。这句话直接把缓存问题解决了——既然同名必不变，缓存它就零风险；既然变了一定换名，只要 HTML 里那个新名字能被拿到，用户就必然拿到新代码。

| 文件 | 响应头 | 理由 |
| --- | --- | --- |
| `assets/*.js`、`*.css`、图片、字体 | `public, max-age=31536000, immutable` | 文件名即版本号；`immutable` 让显式刷新也不再校验 |
| `index.html` | `no-cache, must-revalidate` + **必须给 `ETag`** | 每用一次校验一次：没变几十字节，变了立刻拿到新资源引用 |
| 无哈希资源（`/vendor/`、`favicon.ico`） | `public, max-age=86400, must-revalidate` | 你无法用文件名表达变化，只能短 TTL + 协商 |
| 含用户数据或密钥的接口 | `private, no-store` | 不许落盘 |

**「发版后用户看到旧页面」的真正原因就是第二行没做对**：HTML 被强缓存（你写的 `max-age`、CDN 的默认 TTL、或上一版遗留的头），浏览器在 TTL 内不发请求，拿到旧 HTML，旧 HTML 指向已删除的旧 chunk——于是本章开头那条 MIME 报错。

可以直接照抄并自己验证的 Nginx 片段（**未在本机跑过**，`nginx -t` 与响应头都要你自己验）：

```nginx
server {
  root /var/www/dist;

  location /assets/ {                     # 带哈希：一年 + immutable
    add_header Cache-Control "public, max-age=31536000, immutable";
  }
  location = /index.html {                # 精确匹配这一份文档
    add_header Cache-Control "no-cache, must-revalidate";
  }
  location / {                            # 承载 SPA fallback 的那个 location
    add_header Cache-Control "no-cache, must-revalidate";
    try_files $uri $uri/ /index.html;
  }
}
```

这段里最容易漏的是**第三个 location**。`try_files` 兜底出去的响应命中的是 `location /`，写在 `= /index.html` 上的头**不会**应用到它上面——于是用户访问 `/todos/123` 这类深链时拿到的 HTML 完全没有缓存头，浏览器于是启用**启发式新鲜度**（heuristic freshness：没有 `Cache-Control`/`Expires` 时，缓存按 `Last-Modified` 自猜一个 TTL，常见实现是「距上次修改时间的 10%」）。对一个 `Last-Modified` 是一年前的站点，这意味着深链页面可能被缓存数月。**这就是「明明配了不缓存，某些页面还是旧版」的经典原因。**

<Callout type="warn" title="add_header 的继承规则会让缓存头凭空消失">

Nginx 的 `add_header` 有「本层级只要出现一次，就不再继承上一层的那些头」的行为。你在某个 location 加了 `Cache-Control`，server 层原有的其他头在这里就全部消失。验证方法只有一个：`curl -sI` 分别请求一个真实路径和一个不存在的路径，把两条响应头抄下来对比。**别信配置读起来对不对。**

</Callout>

## 三层缓存：DevTools 里读出它走了哪一层

「浏览器缓存」在 Network 面板里其实是三个不同位置，判读方式和清理对象都不同。

| 层 | Network 的 Size 列 | 谁控制它 | 怎么清 |
| --- | --- | --- | --- |
| 内存缓存（memory cache） | `(memory cache)` | 浏览器自定策略，进程结束即失效 | 刷新即可能失效 |
| Service Worker | `(ServiceWorker)` | **你自己的 SW 代码** | Application → Service Workers → Unregister |
| HTTP 磁盘缓存（disk cache） | `(from disk cache)` | 响应头的 `Cache-Control` | Application → Clear site data；或勾 Disable cache 后刷新 |

三个陷阱：

**一、先确认有没有请求。** 强缓存命中的条目**不产生网络往返**；`304` 是「有请求」。别把「没下载内容」一律当成强缓存生效。

**二、Service Worker 排在 HTTP 缓存之前，而且盖住你所有响应头。** SW 用 `cache.put()` 存进去的副本不受 HTTP 缓存语义管辖，**`Cache-Control: no-cache` 对它毫无约束力**（SW 与 Cache API 的机制见 [fetch、同源策略与浏览器存储](/javascript/network-and-storage)）。症状是「HTML 设了 no-cache 但用户永远拿第一次访问那一版」，而 Network 里那条显示 `(ServiceWorker)`——跟 HTTP 缓存完全无关，改响应头白改，要改 SW 的更新策略（HTML 走 network-first、资源按哈希匹配、activate 时清旧缓存）。

**三、别用 DevTools 验证真实用户行为。** Network 顶部的 **Disable cache** 只要面板开着就让所有缓存全部失效；忘了取消，你会得出「缓存根本没生效」的错误结论。标准手法是**不开面板**加载一次、普通刷新看是否变快，再对照 Clear site data 之后的表现。「清空缓存并硬性重新加载」（右键刷新按钮）比 Ctrl+Shift+R 更彻底，是本领域默认工具。

## 资源提示：preload 与 preconnect 各管什么

```html
<head>
  <link rel="preconnect" href="https://api.example.com" crossorigin>
  <link rel="preload" href="/fonts/mono-subset.woff2" as="font"
        type="font/woff2" crossorigin>
  <link rel="preload" as="image" href="/hero-800.avif" fetchpriority="high">
</head>
```

| | `preconnect` | `preload` |
| --- | --- | --- |
| 省掉什么 | DNS + TCP + TLS 的握手时间 | **什么都不省**，只提早开始下载并提高优先级 |
| 适合 | 少数几个关键第三方源 | 浏览器**自己发现得太晚**的关键资源 |
| 数量 | 连接数有限，**只写 2–3 个**，超出抢带宽 | 优先级虽高仍与真正的关键资源竞争 |
| 必须写对 | 跨源带凭证时要 `crossorigin`；同源不需要 | **`as` 必填**，字体这类 CORS 取用的必须带 `crossorigin` |

一句话边界：**只有「浏览器会晚于实际需要才发现这个资源」时预加载才有价值。** 首屏 LCP 图片是标准答案——尤其当它写在 CSS 里：浏览器扫 HTML 时看不见它，必须等 CSSOM 建好才知道要下载（回指[浏览器渲染机制与关键渲染路径](/frontend-engineering/rendering-pipeline)）。自定义字体是第二个答案（回指 [值、单位与自定义属性](/css/units-and-custom-properties)）。

反过来这三种用法是错的：

- **给所有 chunk 手写 `preload`。** Vite 已给动态导入的 chunk 注入 `modulepreload`（第 4 章产物里能看到），重复一遍只是把首屏带宽分给当前路由根本不需要的代码。
- **`as` 漏写/写错，或字体漏 `crossorigin`。** 预加载请求与真实请求的 CORS 模式不同，会被当成两个不同资源：**下载两次，第一次纯浪费**。这是 preload 最常见的反效果。
- **用 preload 代替正确的加载顺序。** 大多数「首屏慢」的正解是把脚本挪到正确位置、拆掉阻塞资源（第 6 章），不是往 head 里塞提示。预加载了几秒内又没用上的资源，控制台会报未使用 warning，移动端是实打实的负优化。

`dns-prefetch`（只解析不建连）在有 `preconnect` 之后基本不必用；`prefetch`（预测下一个页面）只在下一条跳转高度确定时值得。

## 常见错误与排查

1. **发版后部分用户白屏，控制台报模块脚本 MIME 是 `text/html`** —— 旧 HTML 被强缓存，里面引用的旧哈希 chunk 已随新部署删除，SPA fallback 把 404 变成 HTML。确认：把报错文件名拿去 `ls dist/assets/` 对，对不上就是它。修：HTML 设 `no-cache, must-revalidate`；部署时保留上一版 `assets/` 一段时间再清；CDN 上确认 HTML 的 TTL 为 0。
2. **HTML 缓存头时有时无，深链页面拿旧版而首页正常** —— 头只加在 `= /index.html` 上，`try_files` 兜底的响应没带头，浏览器改用启发式新鲜度。确认：`curl -sI` 请求一个真实路径与一个不存在的路径，对比响应头。修：把不缓存策略写在承载 fallback 的 location 上，然后**两条 URL 各验一次**。
3. **改了响应头但行为没变** —— 旧响应还带着老 TTL 躺在磁盘缓存；或 SW 做了 cache-first，HTTP 头管不到它。确认：看该条目 Size 列是 `(from disk cache)` 还是 `(ServiceWorker)`。修：前者清站点数据后重验；后者改 SW 更新策略。
4. **用户按一次刷新，Network 刷出几百行 304** —— 带哈希资源只配了 `max-age` 没配 `immutable`。确认：304 条目是否全在 `/assets/` 且文件名带哈希。修：加 `immutable`——这些资源的校验本来就没有意义。
5. **加了 `no-store` 后二次访问更慢、CDN 命中率归零** —— 把 `no-store` 当成 no-cache 的加强版用在可缓存的东西上。确认：同一 URL 请求两次，看响应体是否每次完整传输。修：要「永远最新」用 `no-cache` + `ETag`；只有「绝不落盘」才用 `no-store`。
6. **CSS 变了但线上仍旧样式，而 JS 已经更新** —— 引用它的那份 HTML/JS 被缓存了；或那是一个**无哈希**的 `site.css` 被长缓存。确认：查该 CSS 的 `Cache-Control` 与文件名有无哈希。**没有内容哈希就没有资格享受长缓存。** 修：纳入构建管线让它带哈希，否则改短 TTL + `must-revalidate`。
7. **加了 `rel="preload"` 后字体下载两次** —— `as` 缺失或漏 `crossorigin`，两次请求 CORS 模式不同。确认：同一 woff2 出现两条，一条类型是 Preload 且被忽略。修：`as="font" type="font/woff2" crossorigin` 三个都写，写不全就别加。

## 练习

<Exercise title="练习 1 · 给一份部署目录写出完整缓存策略" difficulty="基础">

`dist/` 里有：`index.html`、`assets/index-D7xQ2p.js`、`assets/vendor-Cq1s9m.js`、`assets/hero.8f2a1c.avif`、`favicon.ico`、`robots.txt`。逐个写出你要下发的 `Cache-Control`（并说明是否需要 `ETag`），再解释：为什么 `favicon.ico` 不能和 `assets/` 下的文件同等待遇？

<template #answer>

| 文件 | 建议头 | 理由 |
| --- | --- | --- |
| `index.html` | `no-cache, must-revalidate` + 必须给 `ETag` | URL 不变而内容会变；`no-cache` 允许 304，代价几十字节 |
| 三个 `assets/*` | `public, max-age=31536000, immutable` | 文件名带哈希，同名即同内容；`vendor` 最大，长缓存收益最高 |
| `favicon.ico` | `public, max-age=86400, must-revalidate` + `ETag` | **它的 URL 不会变**：浏览器固定请求 `/favicon.ico`，你无法用文件名表达版本变化，只能靠短 TTL + 协商；标一年等于「图标永远换不掉」 |
| `robots.txt` | `no-cache` + `ETag` | 抓取工具需要看到变化 |

可推广的判据：**长缓存的资格来自「内容变了 URL 也变」**。哈希产物满足；一切「别人用固定 URL 引用」的东西（`favicon.ico`、`/manifest.webmanifest`、Service Worker 脚本）不满足——SW 脚本的缓存语义另有专门规则，本站不展开，动手前查 MDN。

</template>

</Exercise>

<Exercise title="练习 2 · 用 curl 实测自己的响应头" difficulty="进阶">

本地起一个静态服务（`npm run preview` 或任意服务器），跑这四条并把响应头抄下来：`curl -sI http://localhost:4173/`、`curl -sI http://localhost:4173/assets/某个带哈希.js`、`curl -sI http://localhost:4173/一个不存在的路径`、`curl -sI -H "If-None-Match: 上一个响应里的 ETag" http://localhost:4173/`。① 第三条与第一条的响应头差异说明什么？② 第四条应返回什么状态码、响应体多大？③ 若第三条没有 `Cache-Control`，浏览器怎么处理它的新鲜期？

<template #answer>

① 第三条若返回 HTML 而**没有 `Cache-Control`**，说明 fallback 路径没继承到你在 `index.html` 上配的头。② `304 Not Modified`，**没有响应体**（`Content-Length` 为 0 或不出现），但会带上会变的头（新的 `Cache-Control` / `ETag`）。③ 使用**启发式新鲜度**：常见实现参考 `Last-Modified`，取「当前时间减去最后修改时间的一个比例（例如 10%）」作为新鲜期。所以①那个差异的真实后果是：一个 `Last-Modified` 在一年前的静态站，深链页面可能被缓存数月。

诚实提示：`npm run preview`（Vite 的预览服务器）默认下发哪些缓存头，本章**未在本机验证**，它不反映你的生产服务器或 CDN 配置。这个练习的结论只能证明预览服务器怎么配的；**生产策略必须在真实部署环境上重跑这四条命令。**

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造一次「用户看到旧页面」并解释报错" difficulty="挑战">

在可回滚的项目里：① 给 `index.html` 下发 `max-age=600`；② 访问一次首页；③ 重新构建（哈希必变）并部署，**且删掉旧 assets 目录**；④ 十分钟内普通刷新，**不要**开 DevTools 的 Disable cache。写出完整现象链：控制台报错的关键片段、Network 里 HTML 那条显示什么、以及为什么报错里没有「404」字样。

<template #answer>

④ 的刷新中，HTML 请求**根本不出现在网络活动里**（或显示 `(from disk cache)`）——强缓存命中，不发请求。那份旧 HTML 里指向入口模块的 `script type="module"`（`src` 是 `/assets/index-OLD.js`）在新部署中已不存在；Nginx 的 `try_files $uri $uri/ /index.html;` 把这个请求重写成 `index.html`，于是浏览器请求模块脚本、收到 `Content-Type: text/html` 的文档。典型控制台输出（**预期形态，措辞随内核与版本变化，本练习未在本机复现**）：

```text
Uncaught SyntaxError: Failed to load module script: Expected a JavaScript-or-Wasm
module script but the server responded with a MIME type of "text/html".
Strict MIME type checking is enforced for module scripts per HTML spec.
```

**为什么没有 404**：服务器最终返回的是 **200**（一份 HTML），404 只存在于「按文件找」那一步，被 SPA fallback 吃掉了；而 ES 模块要求严格 MIME 校验，HTML 不能被当脚本执行，于是错误在解析阶段以 SyntaxError 抛出。连带效应：入口模块失败 → 应用没挂载 → 白屏；而 `index.html` 里那几个 `rel="modulepreload"` 也会报预加载被忽略的 warning，因为预加载的是同样已不存在的旧哈希文件。

整条因果链里没有任何一处出现「缓存」二字——这就是为什么它被误判成构建问题、然后有人去翻 `vite.config.ts`，而真正修复在服务器配置里。顺带一条纪律：**发版时不要删上一版的 `assets/`**（保留 N 版共存，成本几乎为零），它把「缓存里的旧 HTML 立刻坏掉」降级成「旧页面还能正常跑，只是没更新」。

</template>

</Exercise>

<Exercise title="练习 4 · preload、preconnect 还是什么都不加" difficulty="进阶">

你的首屏需要：A 托管在同源的 LCP 背景图（写在 CSS 里）；B 第三方字体文件；C 下一个路由（详情页）的 JS chunk；D 你自己的 `/api/todos` 接口。各选「preload / preconnect / 什么都不加」并说明理由，其中哪一个加了 `preload` 反而负优化？

<template #answer>

A：**加 `preload`**（`as="image"`，LCP 关键时带 `fetchpriority="high"`）。URL 在 CSS 里，浏览器要等 CSSOM 建好才知道要下载它——这时才排队，而它恰是 LCP 候选。这是 preload 最正当的用途。B：**只加 `preconnect`**（最多 2–3 个源）；只有当首屏文字确实依赖且完全由你控制字体文件时才考虑 `preload`（`as="font" type="font/woff2" crossorigin`）。C：**什么都不加**——这就是那个负优化选项：Vite 已在动态导入时注入 `modulepreload`，手写一遍等于把带宽分给当前路由不需要的代码。D：**只加 `preconnect`**（省握手）；`preload` 一个需要鉴权或带凭证的接口请求没有意义，而且 CORS/凭证规则会让它变成另一次请求。

判据收束成一句：**资源提示只在「浏览器晚于实际需要才发现它」时有价值；能用正确加载顺序解决的问题，加属性只会增加竞争。**

</template>

</Exercise>

## 官方文档与延伸阅读

- [MDN · Cache-Control（中文）](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Headers/Cache-Control) —— 核实指令表每一条：`no-cache`（存储但每次校验）与 `no-store`（禁止存储）之分、`must-revalidate` 的「过期后不得用陈旧副本」、`immutable` 的「即使显式刷新也不该发 `If-None-Match` / `If-Modified-Since`」。**本章写作时对该页的直连抓取失败，指令语义取自检索到的该页原文摘录——动手前务必自己打开逐条对照。**
- [MDN · Cache-Control（英文）](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) —— 该页把「URL 里带版本/哈希、内容变了就换 URL、绝不修改原资源」称作 cache-busting 模式，正是本章「哈希产物长缓存」的官方表述。
- [MDN · HTTP 缓存](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Caching) 与 [条件请求](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Conditional_requests) —— 核实两道闸门模型、`If-None-Match` 优先于 `If-Modified-Since`、启发式新鲜度（练习 2 第③问的依据）。
- [MDN · `ETag`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag)、[`Last-Modified`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Last-Modified)、[`304 Not Modified`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/304)、[`Expires`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Expires) —— 核实两种校验依据的粒度差异、弱 `ETag` 用途、304 允许携带哪些头。
- [MDN · `rel="preload"`](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Attributes/rel/preload) 与 [`rel="preconnect"`](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/preconnect) —— 核实「`as` 必填」「CORS 资源漏 `crossorigin` 会下载两次」「preconnect 只该用于少数关键源」。
- [MDN · Nginx 部署与 SPA fallback](https://developer.mozilla.org/en-US/docs/Glossary) —— 这一条不是外部依据，只是提醒：`try_files` 与 `add_header` 的继承行为属于 Nginx 自身文档（[nginx.org](https://nginx.org/en/docs/)），本章那段配置**未在本机验证**，`nginx -t` 必须你自己跑。
- [Vite · 构建生产版本](https://cn.vite.dev/guide/build) 与 [静态资源处理](https://cn.vite.dev/guide/assets) —— 核实「产物文件名带哈希」这一默认行为，即本章长缓存资格判据的前提；站内对应[第 4 章](/frontend-engineering/vite-build)。

## 下一章

上一章 [浏览器渲染机制与关键渲染路径](/frontend-engineering/rendering-pipeline) 讲浏览器拿到资源之后怎么变成像素，本章讲资源在到达浏览器之前和之后被存在哪里、要不要重复下载；两章合起来回答同一个问题——首屏那段时间花在哪了。但「花在哪」必须能被量化，否则它退化成凭感觉加懒加载。下一章 [性能指标与 Core Web Vitals](/frontend-engineering/performance) 就把本章的因果变成可读的数字：LCP 为什么会因一张没 `preload` 的 CSS 背景图变慢、首屏 JS 体积如何同时伤 TBT 与 INP、CLS 为什么会因一张没写宽高的图片崩掉，以及为什么 Lighthouse 的 98 分可能和用户体验毫无关系。
