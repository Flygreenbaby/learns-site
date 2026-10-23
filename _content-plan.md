# 全站章节蓝图与写作规范（内部文件，不进站点）

本文件是内容建设的唯一事实源：所有领域的 **文件名 slug**、侧边栏标题、写作规范都在这里。
并行写作的子任务必须严格遵守本文件，否则会产生死链与风格漂移。

- `srcExclude` 已包含 `**/_*.md`，本文件不会被构建成页面。
- 站点：VitePress 1.6.4，`cleanUrls: false`，本地搜索（中文分词），暗色模式，Shiki 代码高亮。
- 本地运行环境：Windows 10 x64 + Node v25.4.0（可用于跑 JS/TS 代码片段）。

---

## 一、slug 总表（新建文件按此命名，不得自创）

约定：`## 章节正文` 中的 slug 指 `<领域目录>/<slug>.md`。侧边栏标题即 `{text}` 字段值。

### css/（4 章已完成，补 8 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 5 | `flexbox` | Flexbox：主轴、flex 简写与项目尺寸分配 |
| 6 | `grid` | Grid：轨道、fr 单位、自动放置与响应式卡片墙 |
| 7 | `positioning-and-stacking` | 定位与层叠上下文：z-index 为什么没生效 |
| 8 | `units-and-custom-properties` | 值、单位与自定义属性：设计令牌与主题切换 |
| 9 | `responsive-design` | 响应式设计：视口、媒体查询与容器查询 |
| 10 | `transitions-and-animations` | 过渡与动画：可过渡属性、合成层与减弱动效 |
| 11 | `debugging-layout` | 布局调试方法论：DevTools 与固定排查路径 |
| 12 | `project` | 阶段项目：响应式产品落地页 |

已完成（可引用，禁止改写）：`how-it-works`、`selectors`、`box-model`、`flow-and-bfc`。

### javascript/（新建 12 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `learning-map` | JavaScript 学习地图与 javascript.info 章节对照 |
| 2 | `types-and-values` | 类型、值与引用语义 |
| 3 | `objects-and-arrays` | 对象、数组与常用方法 |
| 4 | `functions-and-scope` | 函数、作用域、闭包与 this |
| 5 | `prototypes-and-classes` | 原型链、class 与封装 |
| 6 | `asynchronous` | 事件循环、Promise 与 async/await |
| 7 | `dom-and-events` | DOM 操作与事件系统 |
| 8 | `network-and-storage` | fetch、同源策略与浏览器存储 |
| 9 | `modules-and-iterators` | ES 模块、动态导入与迭代器 |
| 10 | `errors-and-debugging` | 错误处理与 DevTools 调试 |
| 11 | `accessibility-and-performance` | JS 层面的无障碍与性能 |
| 12 | `project` | 阶段项目：纯 JavaScript 待办清单 |

### typescript/（新建 12 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `why-types` | 为什么需要类型：结构化类型与类型擦除 |
| 2 | `basic-types` | 基础类型与类型注解 |
| 3 | `unions-and-narrowing` | 联合类型与收窄 |
| 4 | `objects-and-interfaces` | 对象类型与接口 |
| 5 | `functions` | 函数类型 |
| 6 | `generics` | 泛型 |
| 7 | `inference` | 类型推断与上下文类型 |
| 8 | `utility-types` | 工具类型、条件类型与映射类型 |
| 9 | `modules-and-declarations` | 模块与声明文件 |
| 10 | `tsconfig` | tsconfig 关键选项 |
| 11 | `tradeoffs` | 真实项目中的取舍 |
| 12 | `project` | 阶段项目：用 TypeScript 重写待办清单 |

### vue/（新建 12 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `mental-model` | Vue 是什么与心智模型 |
| 2 | `reactivity` | 响应式原理：ref、reactive 与 Proxy |
| 3 | `template-syntax` | 模板语法与指令 |
| 4 | `computed-and-watch` | 计算属性与侦听器 |
| 5 | `components` | 组件基础：props、emit 与插槽 |
| 6 | `composables` | 组合式 API、composables 与组件设计 |
| 7 | `lifecycle-and-inject` | 生命周期、模板引用与依赖注入 |
| 8 | `router` | Vue Router |
| 9 | `pinia` | Pinia 状态管理 |
| 10 | `rendering-performance` | 渲染性能：v-memo、shallowRef 与长列表 |
| 11 | `sfc-and-build` | 单文件组件与构建链 |
| 12 | `project` | 阶段项目：多页面待办应用 |

### react/（新建 12 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `two-rendering-models` | 两套渲染模型：Vue 与 React 的根本差异 |
| 2 | `jsx` | JSX 与模板的对照 |
| 3 | `state` | useState / useReducer 与不可变更新 |
| 4 | `props-and-children` | props、回调与 children |
| 5 | `use-effect` | useEffect 与 watch 的对照 |
| 6 | `context` | Context 与 provide / inject 的对照 |
| 7 | `re-render-performance` | 重渲染机制与性能 |
| 8 | `router` | React Router 与 Vue Router 对照 |
| 9 | `state-management` | 状态管理选型：Redux / Zustand 与 Pinia 对照 |
| 10 | `refs-and-forms` | useRef 与受控组件 |
| 11 | `react-only` | 对照法的盲区：React 特有的东西 |
| 12 | `project` | 阶段项目：双框架对照重写 |

### frontend-engineering/（新建 12 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `package-managers` | 包管理：npm 与 pnpm |
| 2 | `semver-and-lockfile` | 语义化版本与锁文件 |
| 3 | `vite-dev` | Vite 开发侧：原生 ESM、预构建与 HMR |
| 4 | `vite-build` | Vite 构建侧：打包、代码分割与产物分析 |
| 5 | `lint-and-format` | 代码规范：ESLint 与 Prettier |
| 6 | `rendering-pipeline` | 浏览器渲染机制与关键渲染路径 |
| 7 | `http-caching` | HTTP 缓存与资源加载策略 |
| 8 | `performance` | 性能指标与 Core Web Vitals |
| 9 | `testing` | 测试体系：Vitest、Vue Test Utils 与 Playwright |
| 10 | `env-and-config` | 环境变量与配置管理 |
| 11 | `monorepo` | Monorepo 与工作区 |
| 12 | `project` | 阶段项目：工程化体检 |

### backend/（新建 15 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `node-runtime` | Node.js 运行时：模块、事件循环与流 |
| 2 | `minimal-http-server` | 用 node:http 手写最小服务器 |
| 3 | `http-and-rest` | HTTP 与 REST 原理 |
| 4 | `fastify-basics` | Fastify 入门：路由、插件与 Schema |
| 5 | `layered-architecture` | 分层架构与请求处理链路 |
| 6 | `error-handling` | 统一错误处理 |
| 7 | `auth-session` | 认证：Session、Cookie 与密码哈希 |
| 8 | `authorization` | 授权与权限：RBAC 与越权防护 |
| 9 | `jwt-and-oauth` | JWT 与 OAuth |
| 10 | `api-docs` | API 文档：Swagger 与 OpenAPI |
| 11 | `web-security` | Web 安全：OWASP Top 10 与实践 |
| 12 | `logging-and-monitoring` | 日志与监控 |
| 13 | `uploads-and-jobs` | 文件上传、定时任务与后台作业 |
| 14 | `docker-and-shutdown` | 服务部署：Docker、优雅关闭与配置 |
| 15 | `project` | 阶段项目：多用户资源管理 API |

### database/（新建 13 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `relational-model` | 关系模型与基础概念 |
| 2 | `sqlite-first` | SQLite 入门 |
| 3 | `sql-basics` | SQL 查询基础 |
| 4 | `sql-advanced` | SQL 查询进阶：窗口函数与 CTE |
| 5 | `data-modeling` | 数据建模 |
| 6 | `indexes` | 索引与执行计划 |
| 7 | `transactions` | 事务与并发 |
| 8 | `migrations` | 迁移与版本管理 |
| 9 | `backup-and-restore` | 备份与恢复 |
| 10 | `postgres-features` | PostgreSQL 进阶特性 |
| 11 | `mysql-differences` | MySQL 差异对照 |
| 12 | `data-access-design` | 数据访问设计：ORM、N+1 与分页 |
| 13 | `project` | 阶段项目：为真实应用落地数据层 |

### data-storage/（新建 14 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `why-this-layer` | 数据存储进阶要解决什么 |
| 2 | `redis-data-structures` | Redis 基础：数据结构与常用命令 |
| 3 | `redis-persistence` | Redis 持久化：RDB 与 AOF |
| 4 | `expiry-and-eviction` | Redis 过期与内存淘汰 |
| 5 | `caching-patterns` | 缓存模式：Cache-Aside 与 Read/Write-Through |
| 6 | `cache-penetration-breakdown-avalanche` | 缓存三大问题：穿透、击穿、雪崩 |
| 7 | `cache-consistency` | 缓存一致性与更新失效策略 |
| 8 | `session-rate-limit-idempotency` | 分布式会话、限流与幂等 |
| 9 | `distributed-lock` | 分布式锁及其陷阱 |
| 10 | `prisma-deep-dive` | Prisma 深入：关系查询与事务 |
| 11 | `raw-sql-and-drizzle` | 原始 SQL、Drizzle 对照与类型安全边界 |
| 12 | `connection-pool-and-slow-query` | 连接池与慢查询定位 |
| 13 | `object-storage-and-cdn` | 对象存储与 CDN |
| 14 | `project` | 阶段项目：加一层扛得住量的数据层 |

### message-queue-cloud/（新建 14 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `why-async` | 为什么需要异步解耦 |
| 2 | `mq-concepts` | 消息队列核心概念 |
| 3 | `reliable-delivery` | 可靠投递：确认、重投与幂等 |
| 4 | `dlq-delay-order` | 死信队列、延迟消息与顺序性 |
| 5 | `delivery-semantics` | 投递语义：不丢、不重与取舍 |
| 6 | `rabbitmq` | RabbitMQ：定位与适用场景 |
| 7 | `redis-stream` | Redis Stream：轻量级队列 |
| 8 | `kafka` | Kafka：高吞吐日志流 |
| 9 | `choosing` | 三者选型对照 |
| 10 | `object-storage-and-cdn` | 云服务基础：对象存储与 CDN |
| 11 | `sms-email-and-api` | 云服务基础：短信、邮件与第三方 API |
| 12 | `serverless-and-cloud-services` | Serverless、云数据库与云网络 |
| 13 | `self-host-vs-cloud` | 自托管 vs 云服务、厂商锁定与成本 |
| 14 | `project` | 阶段项目：把慢操作异步化 |

### linux/（新建 10 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `command-line` | 命令行基础 |
| 2 | `users-and-permissions` | 用户与权限 |
| 3 | `processes-and-systemd` | 进程、信号与 systemd |
| 4 | `packages-and-runtime` | 软件包与运行环境 |
| 5 | `networking` | 网络诊断与防火墙 |
| 6 | `shell-scripting` | Shell 脚本 |
| 7 | `nginx` | Nginx |
| 8 | `server-security` | 服务器安全 |
| 9 | `logs-and-troubleshooting` | 日志与故障定位 |
| 10 | `project` | 阶段项目：从零接管一台 VPS |

### devops/（新建 10 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `git-basics` | Git 基础 |
| 2 | `git-collaboration` | Git 协作与 GitHub |
| 3 | `code-standards` | 代码规范与提交约定 |
| 4 | `testing` | 测试体系 |
| 5 | `ci-cd` | CI/CD 与 GitHub Actions |
| 6 | `docker-basics` | Docker 基础 |
| 7 | `docker-compose` | Docker Compose、卷与网络 |
| 8 | `deploy-to-vps` | 部署到 VPS |
| 9 | `release-and-rollback` | 发布与回滚 |
| 10 | `project` | 阶段项目：完整部署上线 |

### computer-science/（新建 12 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `data-structures-linear` | 数据结构（一）：线性结构 |
| 2 | `data-structures-hash-tree-graph` | 数据结构（二）：哈希、树与图 |
| 3 | `complexity` | 复杂度分析 |
| 4 | `algorithms` | 常见算法思路 |
| 5 | `network-dns` | 网络：分层模型与 DNS |
| 6 | `network-tcp-tls` | 网络：TCP、UDP 与 TLS |
| 7 | `network-http` | 网络：HTTP 演进与 CDN |
| 8 | `os-process-thread` | 操作系统：进程与线程 |
| 9 | `os-memory-io` | 操作系统：内存与 IO 模型 |
| 10 | `architecture` | 软件架构：模式与取舍 |
| 11 | `domain-modeling` | 领域建模与技术选型方法论 |
| 12 | `project` | 阶段项目：全链路诊断演练 |

### realtime/（新建 11 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `why-http-is-not-enough` | 为什么请求-响应不够 |
| 2 | `websocket-protocol` | WebSocket 协议 |
| 3 | `sse` | SSE：单向服务器推送 |
| 4 | `choosing` | 三种方案对比与选型 |
| 5 | `heartbeat-and-reconnect` | 心跳与断线重连 |
| 6 | `rooms-and-presence` | 房间、广播与在线状态 |
| 7 | `node-implementations` | Node 侧实现对照 |
| 8 | `nginx-proxy` | Nginx 代理 WebSocket |
| 9 | `scaling-out` | 扩展性：多实例的广播问题 |
| 10 | `ai-streaming` | 与 AI 流式输出的关系 |
| 11 | `project` | 阶段项目：实时聊天室 |

### ai-apps/（新建 11 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `llm-api-basics` | LLM API 基础 |
| 2 | `prompt-engineering` | Prompt 工程 |
| 3 | `streaming` | 流式响应与前端渲染 |
| 4 | `context-and-cost` | 上下文窗口与 token 成本 |
| 5 | `structured-output` | 结构化输出 |
| 6 | `rag-retrieval` | RAG（一）：从文档到向量库 |
| 7 | `rag-quality` | RAG（二）：检索质量与注入 |
| 8 | `function-calling-and-agents` | Function Calling 与 Agent 编排 |
| 9 | `evaluation-and-observability` | 评测与可观测 |
| 10 | `security-and-abuse` | 安全与滥用防护 |
| 11 | `project` | 阶段项目：个人知识库问答助手 |

### mobile/（新建 9 个）

| # | slug | 侧边栏标题 |
| --- | --- | --- |
| 1 | `choosing-route` | 要不要做移动端、做哪种 |
| 2 | `mobile-web` | 移动端 Web 适配 |
| 3 | `miniprogram-model` | 微信小程序：心智对照（一） |
| 4 | `miniprogram-api` | 微信小程序：心智对照（二） |
| 5 | `uni-app` | uni-app |
| 6 | `cross-platform` | 跨端方案概览 |
| 7 | `device-debugging` | 真机调试 |
| 8 | `release` | 发布流程 |
| 9 | `project` | 阶段项目：一个真实上线的小程序 |

**合计待建：187 个正文文件。** 已完成正文：HTML 9 章 + 项目、CSS 4 章。

---

## 二、写作规范（必须遵守）

### 2.1 文件与标题

- 首行是单个 H1：`# 讲清主题的句子标题`（参考 `# 常规流与格式化上下文：容器为什么塌陷，BFC 到底管什么`）。不要写「第 4 章」这类编号前缀，编号交给侧边栏顺序。
- 章节内部用 `##` 分节，标题写成「结论式短句」（`## 建立 BFC 的手段：一张实测对照表`），不要 `## 概述`、`## 简介`、`## 小结` 这类空壳标题。
- 末尾固定三节：`## 常见错误与排查`、`## 练习`、`## 官方文档与延伸阅读`，最后一节 `## 下一章`（用一段话衔接：上一章讲了什么、下一章解决什么，各带链接）。
- 不使用 YAML frontmatter。
- 篇幅目标：普通章 **12–20 KB**（约 3500–5500 个中文字 + 代码 + 表格）；`project` 章 **16–28 KB**。宁可短而密，不许灌水。禁止「这很重要」「值得注意的是」一类无信息量句子重复出现。

### 2.2 组件用法（写错会导致构建失败）

`<Exercise>`（练习 + 折叠答案）与 `<Callout>`（提示框）已全局注册。

```markdown
<Exercise title="练习 1 · 预测 flex-basis 的结果" difficulty="基础">

题干，支持 **Markdown**、`行内代码`、表格、代码块。

<template #answer>

答案与解析，同样支持 Markdown。

</template>

</Exercise>
```

```markdown
<Callout type="warn" title="这里有一个容易踩的点">

正文，支持 Markdown。

</Callout>
```

硬性规则：

1. **组件开标签行之后必须空一行**，闭标签行之前也必须空一行。markdown-it 会把「开标签到第一个空行」当成原始 HTML 不解析，不空行会导致反引号失效、`<table>` 等被当真标签泄漏进 Vue 模板并在构建时报 `Element is missing end tag.`。
2. `title` 属性值里 **不能出现反引号、尖括号、双引号**。要提到 `<div>` 就写 `div 元素`。
3. `difficulty` 只取 `基础` / `进阶` / `挑战`。
4. `Callout` 的 `type` 只取 `info` / `warn` / `danger` / `verified` / `unverified`。
5. 每章练习 3–6 道，其中至少 1 道「故意制造错误并解释报错」类。每道都必须有 `#answer` 内容。
6. **正文与内联代码里绝不能出现连续的 `{{`。** VitePress 把 Markdown 编译成 Vue 模板，`{{` 会被当成插值表达式编译，报 `[vite:vue] Error parsing JavaScript expression`。已发生的真实故障：表格单元格里写 `` `${{a:1}}` `` 直接让构建失败。正确做法：写成 `${ {a:1} }`（合法且等价），或把含 `{{ }}` 的 Vue 模板示例放进 ```vue 代码围栏（围栏内的插值是安全的）。

### 2.3 内容诚实性（最高优先级）

- **禁止伪造验证。** 只有你在本任务里真正跑过并看到输出的代码，才可以写「实测 / 已运行验证」，并必须用 `<Callout type="verified">` 交代环境（例如 `Node v25.4.0`、命令、日期 2026-10-17）。没跑过的一律写「预期结果是…」，必要时加 `<Callout type="unverified">`。
- 环境限制说明：Linux / Docker / Nginx / 数据库服务 / Redis / 云控制台等命令，本机不一定具备。**不能声称执行过**；给出命令、预期输出、验证方法，并明确标注「未在本机验证」。
- 版本相关断言（API 名、选项默认值、浏览器支持度、命令参数）优先用 WebFetch 核实官方文档，每章至少核实 2–3 个最关键的事实；核实不了的就不写具体版本号，改写成「以官方文档当前版本为准，动手前核对 <链接>」。
- **禁止编造外部链接。** URL 只写你确信存在的官方页面（MDN、typescriptlang.org、vuejs.org、react.dev、vite.dev、nodejs.org、fastify.dev、postgresql.org、redis.io、prisma.io、drizzle.team、git-scm.com、docs.docker.com、nginx.org、github.com/docs、caniuse.com、w3.org/TR、owasp.org、微信官方文档 developers.weixin.qq.com、阿里云/AWS 官方文档首页等）。拿不准深层路径就链接到该站的主文档入口，绝不编造长 slug。
- 不复制第三方教程正文，全部中文原创讲解；引用只给链接与结论。

### 2.4 内部链接

- 站内链接一律用绝对路径、**不带 `.html`**：`/css/flexbox`、`/typescript/generics`、`/backend/auth-session`。跨域引用某领域整体时写 `/vue/`。
- 只允许链接本文件列出的 slug 或已存在的页面。**不要链接不存在的文件**（如 `/css/animation`、`/vue/intro` 都是错的）。
- 代码块必须带语言标注（```bash / ```sql / ```ts / ```vue / ```js / ```json / ```yaml / ```nginx / ```dockerfile / ```text）。VitePress 对未标注语言的代码块在构建时会警告，且没有高亮。
- `vue` 代码块里的 SFC 片段是可以的；不要在一个 `vue` 代码块里写超过一个 `<script setup>` 组件。

### 2.5 每章必含的实质要素

1. 这一章要解决的问题（开头 2–4 段，从真实故障现象切入，不要从定义切入）。
2. 概念之间的联系与机制解释（为什么这样设计，和前置章节的关系）。
3. 可运行/可验证的代码示例 + **预期结果**（表格化对照最佳）。
4. `## 常见错误与排查`：至少 5 条「现象 → 原因 → 怎么确认 → 怎么修」。
5. 练习与折叠答案。
6. 官方文档与延伸阅读（带「用于核实本章哪个结论」的说明）。
7. 与前后章节衔接（`## 下一章`，以及正文里回指前置章节的链接）。

`project` 章额外要求：目标与范围、分阶段实施步骤（含每阶段的可验证产出）、验收清单（可勾选）、常见翻车点、参考答案要点或关键实现片段（折叠在 `<Exercise>` 内，题干写「参考答案要点」）。项目章不得引入未完成的前置依赖作为唯一路径，涉及外部服务（VPS、云服务、小程序审核）时把「无法本地完成」的步骤标为「需要真实账号，本地可用替代方案验证」。

### 2.6 术语与风格

- 中文正文，技术术语首次出现给英文原名，如「层叠上下文（stacking context）」。
- 用第二人称「你」，语气直给，允许「这是错的」「别这么做」。
- 不写「本章将介绍」「学完本章你将掌握」这类导语，直接进入问题。
- 表格优先于长段罗列；结论加粗不超过每节 2 处。
- 领域内引用统一写法：`[Flexbox](/css/flexbox)`、`[TypeScript 第 3 章 收窄](/typescript/unions-and-narrowing)`。

### 2.7 版本基线（各领域的默认口径）

| 领域 | 默认口径 |
| --- | --- |
| HTML / CSS | W3C / WHATWG 现行标准，核实时间 2026 年 10 月 |
| JavaScript | ECMAScript 2022+ 语法为基线，浏览器与 Node 双环境说明 |
| TypeScript | 5.x；模块解析涉及 `bundler` / `nodenext` 时注明以 tsconfig 参考为准 |
| Vue | Vue 3 + `<script setup>`；Vue Router 4；Pinia 2/3（版本号不确定时只写名称） |
| React | React 18+ 函数组件与 Hooks；React Router v7 相关结论以官方文档为准 |
| 构建 | Vite（版本不确定就只写「当前主版本」）、npm / pnpm、ESLint 扁平配置 |
| 后端 | Node LTS（本机为 v25.4.0，可作运行时示例环境）、Fastify 主版本以官方文档为准 |
| 数据库 | SQLite / PostgreSQL 主线、MySQL 对照；Prisma、Drizzle 以各自官方文档为准 |
| 系统 | Debian / Ubuntu LTS、systemd、Nginx 稳定版、Docker Engine、GitHub Actions |

每个领域首页已有「版本说明」一节，章内不要再重复大段时效性声明，只在涉及高风险特性时加一句提示 + `unverified` Callout。

---

## 三、主任务负责的公共文件（子任务不得改动）

- 各领域 `_sidebar.ts`（章节注册）
- `.vitepress/domains.ts`（状态徽章数据）
- 各领域 `index.md` 的 `<StatusBadge>` 与章节目录链接
- `README.md`、`index.md`、`guide/*.md`
- 构建、类型检查、死链检查、`learns-site.zip` 生成

子任务只能新建自己领域内的 `.md` 正文文件。
