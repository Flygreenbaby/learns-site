# API 文档：OpenAPI 是契约，不是事后补的说明书

前端照着文档调 `PATCH /bookmarks/{id}`，请求体按文档写的传，回来一个 400；他截图问你，你查代码才发现文档里那个字段的 schema 引用了一个**根本不存在的 `$ref`**——渲染工具遇到解析不了的引用不会报错，它只是把那块画成空白。文档过期比没文档更糟，因为它会让人自信地做错事。

这一章讲三件事：**一份 OpenAPI 文档由哪些块组成**（以及每一块写错的后果）、**同一份 schema 怎么同时当文档和请求门卫**、**文档与实现怎么漂移，以及怎么在 CI 里把漂移抓出来**。为了让结论可复现，我在本机手写了一份「书签 API」的 OpenAPI 3.1 文档，故意留下 5 处缺陷，再用自己写的检查脚本跑出问题清单和 payload 校验结果——**这些输出都是真实终端输出**。而 OpenAPI/Swagger 的官方工具链（`@fastify/swagger`、Swagger UI、Prism）本机**没有安装、没有跑过**，涉及它们的部分一律标为未实测并给预期输出。前置：[HTTP 与 REST 原理](/backend/http-and-rest)、[Fastify 入门](/backend/fastify-basics)、[授权与权限](/backend/authorization)。

## 文档由哪几块组成：先认字段，再谈工具

这是我为本章手写的那份文档的核心部分（真实文件，节选）：

```json
{
  "openapi": "3.1.0",
  "info": { "title": "书签 API", "version": "1.0.0" },
  "servers": [{ "url": "https://api.example.com/v1" }],
  "components": {
    "securitySchemes": { "bearerAuth": { "type": "http", "scheme": "bearer", "bearerFormat": "JWT" } },
    "schemas": {
      "CreateBookmark": {
        "type": "object",
        "required": ["url"],
        "additionalProperties": false,
        "properties": {
          "url": { "type": "string", "format": "uri", "maxLength": 2048 },
          "title": { "type": "string", "maxLength": 200 },
          "tags": { "type": "array", "items": { "type": "string" }, "maxItems": 10 }
        }
      }
    },
    "responses": {
      "BadRequest": {
        "description": "请求体未通过 schema 校验",
        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } }
      }
    }
  },
  "paths": {
    "/bookmarks": {
      "post": {
        "operationId": "createBookmark",
        "security": [{ "bearerAuth": [] }],
        "requestBody": {
          "required": true,
          "content": { "application/json": { "schema": { "$ref": "#/components/schemas/CreateBookmark" } } }
        },
        "responses": {
          "201": { "description": "创建成功", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Bookmark" } } } },
          "400": { "$ref": "#/components/responses/BadRequest" },
          "401": { "$ref": "#/components/responses/Unauthorized" }
        }
      }
    }
  }
}
```

顶层就六块，每块写错的后果不一样：

| 键 | 管什么 | 写错的后果 |
| --- | --- | --- |
| `openapi` | 规范版本，如 `3.1.0` | 工具按 3.0 解析时，3.1 才有的写法（对 JSON Schema 的直连、`webhooks`）会静默不认 |
| `info` | 标题、版本、说明 | 文档不带版本，前端不知道自己对接的是哪一版 |
| `servers` | base URL 与环境 | 调试台把请求打到错误环境，或线上文档写着测试域名 |
| `paths` | 每个端点的方法、参数、响应 | **响应表里少写 401/403，等于告诉前端「这里不会失败」**，于是没有错误分支的 UI |
| `components` | 可复用的 schema / 响应 / 安全方案 | 每个操作各抄一份字段定义，改一处漏一处，这就是漂移的源头 |
| `security` + `securitySchemes` | 这个操作要什么凭证 | **漏写 `security` 在语义上等于「本接口公开」**，我实测的 5 条问题里有 2 条就是它 |

`$ref` 是同一文档内的 JSON Pointer（`#/components/schemas/Error` 就是从根往下取键），它的价值是让「一个字段只定义一次」成立；代价是**它把错误推迟到使用时刻**——引用不存在的键，编辑器不报错、文档站点只是少渲染一块。实测这份文档里 `18` 处 `$ref`，其中一处指向 `#/components/schemas/UpdateBookmark`，而这个 schema 我压根没写：

```text
✗ 无法解析的 $ref #/components/schemas/UpdateBookmark （位置 $.paths./bookmarks/{id}.patch.requestBody.content.application/json.schema）
```

**报错要给出位置**，这是自己写检查脚本时最容易漏的点：只说「有悬空引用」没人改得动。

## schema 即校验：一份定义同时当文档和门卫

OpenAPI 的请求/响应 schema 本身就是 JSON Schema 子集，所以它天然是可执行的规则。下面这张表是本机对自己写的校验器喂各种 payload 的**实测输出**（规则就是上面那个 `CreateBookmark`）：

```text
合法最小 body          -> 通过
缺 url                -> 拒绝 | $.url: 缺少必填字段
多余字段 note          -> 拒绝 | $.note: 文档未声明的多余字段（additionalProperties=false）
url 不是绝对 URI       -> 拒绝 | $.url: 不是绝对 URI（format=uri）
tags 超上限           -> 拒绝 | $.tags: 元素数 11 超过 maxItems 10
title 超长           -> 拒绝 | $.title: 长度 201 超过 maxLength 200
query page=0          -> ["query.page: 0 小于 minimum 1"]
query page="3"（字符串） -> ["query.page: 应为整数"]
```

三条值得单独说的：

- **`additionalProperties: false` 同时是文档约束和越权防护**。它拒掉客户端多塞的字段，正好堵住[授权与权限](/backend/authorization)里讲的批量赋值（mass assignment）：请求里多传一个 `roles: ["admin"]` 或 `tenantId`，没这道闸门就会被直接灌进模型。写文档时顺手加这一行，等于免费拿到一条安全规则。
- **`format` 不是校验，是声明**。`format: "uuid"` 在多数实现里默认**不强制**（JSON Schema 把 format 定为可注解可校验的两可项）。所以「文档写了 uuid 就安全了」是错觉：`"abc"` 照样过。要么在编译 schema 时显式打开 format 校验，要么在代码里自己判。
- **query 也要有 schema**。`page=0`、`pageSize=100000`、`sort=unknown_field` 这三类是线上最常见的「文档没写所以没人拦」。上表最后两行就是 query 校验的形态：类型不符和越界各报一条，字段路径带 `query.` 前缀，前端一看就知道改哪儿。

Fastify 的做法正是把这个思路制度化：**schema 写在路由定义里，插件编译一次，请求进来先校验、响应再按同一份 schema 序列化**（未实测，机制以其官方文档为准）。这样文档与校验不可能不一致，因为它们是同一段代码；剩下的问题只有一个——文档怎么从这段代码里出来。

## 生成方式对比：手写文档、路由内联、扫描框架路由

| 方式 | 怎么维护 | 漂移风险 | 适合 |
| --- | --- | --- | --- |
| 手写 `openapi.yaml`，代码照着实现（design-first） | 先改文档再改代码，评审时看 diff | **高**：文档改了代码没跟上，没人知道 | 对外 API、需要契约先行与多方评审 |
| 路由内联 schema，工具扫出文档（code-first） | 只有一处定义 | **低**：文档是派生物 | Fastify / NestJS / Spring Boot 这类有 schema 位置的框架 |
| 注释/装饰器生成（JSDoc、`@Operation`） | 注释贴着实现写 | 中：注释与代码可能反向漂移 | 已有大项目补文档 |

我的判断：**能对内外一致用 code-first，对外契约用 design-first**。但无论哪种，**生成产物都要提交进仓库并参与 diff**——评审时看得见的改动才是改动，看不见的漂移是事故。

## 用 `@fastify/swagger` 接线：预期输出（本机未装，未实测）

以 Fastify 为例，接法是把路由的 `schema` 交给插件汇总，再由另一个插件挂出文档站：

```js
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

const app = Fastify();
await app.register(swagger, {
  openapi: {
    info: { title: '书签 API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com/v1' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }
    }
  }
});
await app.register(swaggerUi, { routePrefix: '/docs' });

app.post('/bookmarks', {
  schema: {
    operationId: 'createBookmark',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: { type: 'string', format: 'uri', maxLength: 2048 },
        title: { type: 'string', maxLength: 200 }
      }
    },
    response: { 201: { type: 'object', properties: { id: { type: 'string' } } } }
  }
}, handler);

app.get('/json', { schema: { hide: true } }, async (req, reply) => app.swagger());
```

**预期**（我**没有**跑过，别当成实测）：`GET /json` 返回一份 JSON，其中 `paths["/bookmarks"].post` 下有 `operationId: "createBookmark"`、`security`、`requestBody.content["application/json"].schema` 与上面 `body` 一致，`responses["201"]` 来自 `response` 声明；`GET /docs` 返回可交互页面，`Try it out` 会带上 `servers` 的 base URL。三条要注意：路由的 `response` 用状态码做键，未声明的状态码在序列化时可能被**过滤掉字段**（这是 code-first 的反直觉之处，也是官方文档里专门提醒的点）；`hide: true` 用于把文档端点自身从产物里排除；UI 挂在业务域下要确认它对公网是否可达——**一份能任意调接口的调试台本身就是攻击面**（回指[Web 安全](/backend/web-security)）。

## 漂移是常态：把契约检查放进 CI

漂移有两种方向。**文档落后于实现**：加了字段没写文档、改了错误码没同步；**实现落后于文档**：文档承诺了 `403`，代码里有两条路径直接返回 `400`。前者误导调用方，后者违反契约。所以要把「文档也是代码」落到检查上。

我用自己写的脚本对上面那份文档做了结构检查，**实测**问题清单：

```text
PROBLEM 5 条:
  ✗ 无法解析的 $ref #/components/schemas/UpdateBookmark （位置 $.paths./bookmarks/{id}.patch.requestBody.content.application/json.schema）
  ✗ GET /bookmarks/{id} 缺 operationId
  ✗ GET /bookmarks/{id} 没写 security（等于公开接口，确认是故意的吗）
  ✗ PATCH /bookmarks/{id} 缺 operationId
  ✗ PATCH /bookmarks/{id} 没写 security（等于公开接口，确认是故意的吗）
```

顺手拿到的统计信息也是检查项（同一脚本输出）：

```text
INFO 1 openapi=3.1.0 | title=书签 API 1.0.0
INFO 2 全文 $ref 总数 = 18
INFO 3 GET /bookmarks/{id} 声明了 404 但无 401
INFO 4 paths=2 operations=5 operationId=[listBookmarks, createBookmark, deleteBookmark]
INFO 5 schemas=Bookmark, CreateBookmark, Error | responses=BadRequest, Unauthorized, Forbidden, NotFound
INFO 6 已定义但从未被引用: （无）
```

值得常驻 CI 的检查就七条，每条都能机器判定：

| 检查 | 为什么必须自动化 |
| --- | --- |
| `$ref` 全部可解析 | 悬空引用不报错，只是少渲染一块（实测那条就是这么来的） |
| `operationId` 存在且全局唯一 | 代码生成器用它当函数名；缺了就没有稳定入口，前端手写调用无法统一 |
| 每个操作都有 2xx | 说明这条路径真的成功过；缺 2xx 多半是复制粘贴出来的文档 |
| 声明了 4xx/5xx 就检查鉴权声明 | 上表 `INFO 3` 那类：有 `404` 没 `401`，要么是真公开，要么是忘了写 |
| `security` 覆盖率 | 漏写即「公开」，需要有人明确签字说这是故意的 |
| path 模板与 `parameters` 对齐 | `{id}` 出现却没声明参数，参数就是凭空缺存在的 |
| 未被任何 `$ref` 引用的 schema | 要么是待删的死代码，要么是本该引用却写漏了 |

再加两道闸。**产物快照 diff**：把生成的 `openapi.json` 提交进仓库，CI 里重新生成一次并 `git diff --exit-code`，任何没提交的改动直接失败——这一条成本最低、拦住一半漂移。**破坏性变更检测**：删字段、改类型、把可选变必填、改端点路径，都要在 PR 上标红（规范上按语义化版本处理：破坏性契约改动就是大版本）。最后补一句**契约测试**：拿文档当 stub 起一个假服务（Prism 这类，本机未装、未实测）让前端在实现完成前就能验证，或者反过来用真实服务逐个比对文档声明——它测的是「实现是否履行契约」，跟单元测试测「函数内部对不对」不是一回事，别用单测代替。

<Callout type="unverified" title="OpenAPI 与 Swagger 工具链本机未安装，以下结论未实测">

**已实测**（Windows 10 x64、Node v25.4.0，2026-10-18）：手写的书签 API OpenAPI 3.1 文档，与配套的自己写的检查脚本——`$ref` 解析（18 处、1 处悬空）、`operationId` 与 `security` 覆盖率、path 参数对齐、未引用 schema 检测，以及按 `CreateBookmark` 定义对 8 组 payload / query 的校验判定。正文里所有带 `->` 的输出行都是终端逐字抄录。

**未实测**：`@fastify/swagger`、`@fastify/swagger-ui`、Swagger UI、Prism、openapi-diff、各类代码生成器均未安装（本机不装依赖），**「预期」那一段是依据官方文档的机制描述，不是运行结果**；`format` 在各校验器里默认是否强制、响应序列化是否过滤未声明字段，都取决于具体实现与配置，动手前请以官方文档和一次真实运行确认。检查脚本是我自己写的子集实现，不能替代规范级校验器。

</Callout>

## 常见错误与排查

**1. 文档写完了但从没跑过。** 现象：前端照文档传参，服务端 400；或调试台里字段名对不上。确认：把 `openapi.json` 与一次真实请求/响应对照，看差在哪。修：schema 单一来源（路由内联或 design-first 产物），别手写第二份字段表。

**2. 悬空 `$ref`。** 现象：某个请求体或响应在文档站上整块空白，没有报错。确认：脚本遍历全文 `"$ref"` 字符串（实测 `18` 处、1 处指向不存在的 `UpdateBookmark`）。修：CI 加可解析性检查，报错带上 JSON Pointer 位置。

**3. 只写 200，不写 4xx。** 现象：前端没有错误分支，令牌过期时页面白屏。确认：统计每个操作声明的状态码（实测有 3 个操作声明了 `403/404` 却没写 `401`）。修：`components.responses` 里固化 `BadRequest/Unauthorized/Forbidden/NotFound`，操作里只做引用。

**4. 漏写 `security`。** 现象：文档说接口公开，实现却依赖会话；或生成的客户端代码没地方填 token。确认：跑覆盖率统计（实测 5 个操作里 2 个没写）。修：默认全局 `security`，公开接口反过来显式声明 `security: []`。

**5. `additionalProperties: false` 不敢开。** 现象：客户端多传 `role`、`tenantId` 被直接写进记录（批量赋值）。确认：故意多传一个字段看是否通过（实测被拒并给出 `$.note` 位置）。修：请求体一律显式声明允许的字段；PATCH 需要部分更新就另建一个 `required: []` 的更新 schema，而不是放宽原 schema。

**6. 文档当内部笔记本用。** 现象：文档里出现真实手机号、内部表名、生产 server URL，调试台对公网开放。确认：搜文档全文的示例值与环境地址。修：示例统一用假数据，`servers` 按环境生成，`/docs` 只在内部环境挂载。

## 练习

<Exercise title="练习 1 · 找出这份文档的毛病" difficulty="基础">

下面是某项目里 `GET /orders/{id}` 的文档片段。指出至少四处问题，并说明每种问题会让调用方遇到什么。

```json
"/orders/{id}": {
  "get": {
    "summary": "查订单",
    "responses": {
      "200": { "description": "订单", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Order" } } } },
      "404": { "description": "没找到" }
    }
  }
}
```

<template #answer>

**① 缺 `operationId`。** 生成的客户端方法只能叫 `ordersIdGet` 这类自动名，跨版本不稳定；改名就是 breaking change。修：`"operationId": "getOrder"`。

**② 缺 `parameters`。** 路径里有 `{id}` 却没声明参数，等于文档没告诉调用方 `id` 的类型和是否必填——实现里它可能允许数字，文档里没写，前端传 `"all"` 就 500。修：`parameters: [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }]`（并确认 `{id}` 与之对齐，这是七条检查里的一条）。

**③ 缺 `security`。** 语义上等于「本接口公开」，而订单几乎必然是越权高危面（[授权与权限](/backend/authorization)里的 IDOR：换 `id` 就能读别人的订单）。修：显式 `security`，并在 `responses` 里加 `401` 与 `403`。

**④ 只有 200/404，没有 401/403。** 而这条路径真实返回过 401（令牌过期）。修：引用 `components` 里的公共响应。

**⑤ 示例与错误体缺失。** 两个响应都没有 `example`，`404` 也没声明结构，前端无法确定该读 `message` 还是 `error`。修：给 200 一份脱敏示例、给错误统一 `$ref: "#/components/responses/NotFound"`。

顺带：`description` 写「没找到」这种含糊措辞，掩盖了一个真实设计问题——跨租户访问到底返回 403 还是 404 必须在文档里定死，否则两个团队各实现一种。

</template>

</Exercise>

<Exercise title="练习 2 · 让 PATCH 可校验" difficulty="进阶">

要为 `PATCH /bookmarks/{id}` 补文档。已知更新 schema 应允许只改 `title`，禁止改 `url` 之外未声明字段，`title` 与 `tags` 都可选。请写出 schema 与所在操作的关键字段，并解释为什么不直接复用 `CreateBookmark`。

<template #answer>

不能复用 `CreateBookmark`：它 `required: ["url"]`，而 PATCH 的语义是「不带字段就是不改」，用创建 schema 校验会让所有只改标题的请求都吃 400——这正是本章开头那个现场。

```json
"UpdateBookmark": {
  "type": "object",
  "minProperties": 1,
  "additionalProperties": false,
  "properties": {
    "title": { "type": "string", "maxLength": 200 },
    "tags": { "type": "array", "items": { "type": "string" }, "maxItems": 10 }
  }
}
```

要点：① `required` 留空，靠 `minProperties: 1` 拒绝空对象（否则 `PATCH {}` 变成一次无意义的成功写）；② `additionalProperties: false` 保留，堵住批量赋值；③ 不在属性表里的字段（`id`、`createdAt`、`ownerId`）自然无法从外部传入，这也是「文档没写的字段不存在」的兑现；④ 操作上要显式 `required: true` 于 `requestBody`，并补 `operationId: "updateBookmark"`、`security`、`400/401/403/404` 四个响应引用——上面实测的两条 `PATCH` 问题就是这么来的。

若 `url` 确实允许改，则把它加进 `properties` 并保持 `format: "uri"`；但**要单独确认服务端有 SSRF 防护**，因为「用户提供的 URL 会被后端抓取」属于 [Web 安全](/backend/web-security)的范围，文档写了 `format: uri` 不代表安全。

</template>

</Exercise>

<Exercise title="练习 3 · 设计漂移闸门" difficulty="挑战">

团队现状：文档由 `@fastify/swagger` 从路由生成（未实测），产物不入库，CI 只跑单测。半年后前端抱怨「文档从来不可信」，你们打算把契约检查建起来。给出四步落地方案，每步说明能拦住哪类问题、以及它会带来什么新的负担。

<template #answer>

**第一步：产物入库 + diff 门禁。** CI 里生成 `openapi.json` 并提交（或由 CI 产物归档），再用 `git diff --exit-code` 判定「代码改了、文档没跟着提交」。拦住的是**实现改了但没人重生成文档**这一整类。负担：合并冲突集中在生成文件上，需要约定重新生成的命令并在 CI 失败时给出「跑一下 `npm run docs:gen`」的提示。

**第二步：结构检查。** 就是本章那七条（`$ref` 可解析、`operationId` 存在且唯一、每操作有 2xx、`security` 覆盖率、path 参数对齐、4xx 与鉴权声明一致、未引用 schema）。拦住的是**写漏**，而且报错要带 JSON Pointer 位置。负担：初期会一次性爆几十条，需要分级——新增文件严格、历史文件设基线只卡增量。

**第三步：破坏性变更检测。** 与上一版基线比对：删字段、改类型、可选变必填、路径或方法消失、状态码语义变化 → 阻断并要求大版本；新增可选字段 → 放行。拦住的是**悄悄改掉对外承诺**。负担：需要保存上一版基线（发布分支产物），且误报需要 allowlist。

**第四步：契约测试。** 用文档起 stub 让前端并行开发，同时对真实服务逐操作比对声明（响应结构、必填字段、状态码）。拦住的是**文档与运行时行为不一致**——前三步只能保证文档自身自洽。负担：要维护用例集，且 schema 校验会暴露响应里那些「多给了一个内部字段」的脏数据，得配套统一序列化。

顺序不能反：先做 1、2（几乎零成本，收益立现），再补 3、4。只做 4 是常见的错法，因为契约测试报出的差异里一大半来自文档本身没写完。

</template>

</Exercise>

## 官方文档与延伸阅读

- [OpenAPI Specification 3.1.0](https://spec.openapis.org/oas/v3.1.0.html) —— 顶层结构、`paths` / `components` / `security` / 固定字段（`$ref`、`operationId`）的权威定义；3.1 与 3.0 的差异也以此页为准。
- [OpenAPI 官方站点](https://www.openapis.org/) —— 版本列表、生态工具入口与规范 PDF。
- [Swagger UI](https://swagger.io/tools/swagger-ui/) 与 [Swagger Editor](https://editor/swagger.com/) —— 文档渲染与在线编辑；`Try it out` 的行为取决于 `servers` 与 CORS，动手前实测。
- [@fastify/swagger 与 @fastify/swagger-ui 官方文档](https://docs.fastify.dev/plugins/swagger) —— code-first 的 `schema` → `openapi` 映射、`response` 用状态码做键、`hide` 排除端点。**本章未实测，配置项名称与默认值以该文档当前内容为准。**
- [JSON Schema `format` 关键字](https://json-schema.org/understanding-json-schema/reference/string#format) —— `format` 默认是注解、是否强制由实现决定，这是「文档写了 uuid 却不拦非法值」的根因。
- [Prism（Stoplight）](https://stoplight.io/open-source/prism) —— 按 OpenAPI 起 mock 与契约校验的代理，本章未实测。
- 站内：[HTTP 与 REST 原理](/backend/http-and-rest)、[Fastify 入门](/backend/fastify-basics)、[统一错误处理](/backend/error-handling)、[授权与权限](/backend/authorization)、[JWT 与 OAuth](/backend/jwt-and-oauth)、[Web 安全](/backend/web-security)。

## 下一章

这一章的主线是**一份 schema、两个用途**：写成文档给人看，编译成校验器给机器用，两处必须同源；漂移靠自动化拦，而不是靠人记得更新文档——`$ref` 悬空、`security` 漏写这两类错误连报错都不产生，只能被脚本抓出来（本章实测的 5 条问题就是这么浮出水面的）。契约立住了，接口也就暴露面清晰了。下一章 [Web 安全：OWASP Top 10 与实践](/backend/web-security) 接着看这些接口在网络层会被怎么打：注入把数据当代码执行、CSRF 借浏览器自动携带凭证、文档与调试台本身也是攻击面——把上一章的安全默认值一路带到部署。
