# 后端开发（Node.js + Fastify）

<StatusBadge state="ready" note="15 章正文全部完成（第 15 章为阶段项目），可连续学习" />

## 这个领域解决什么问题

前端能让页面动起来，但一旦涉及「多个用户、各看各的数据、刷新后还在、别人不能乱改」，你就必须有一个跑在服务器上、独立于浏览器的程序来接管这些逻辑。这就是后端。很多人以为后端就是「写几个接口」，真正的坑在于：

- 接口在本地跑得好好的，一部署就崩 —— 因为你把密钥硬编码进了代码，或者依赖了只有本机才有的路径。
- 用户 A 能通过改 URL 里的 id 看到用户 B 的订单 —— 因为你只做了「登录校验」，没做「这条数据是不是你的」这一层授权。
- 密码用明文或简单加密存进了数据库，一次拖库就全部泄露 —— 因为你没用专门的密码哈希算法。
- 一个接口被脚本疯狂调用，服务器被打满 —— 因为你没做速率限制，也没想过「同一个请求被重发两次会不会重复下单」。
- 出错了前端只收到一个 `500 Internal Server Error`，你在服务器日志里翻不到任何有用信息 —— 因为你没做统一的错误处理和结构化日志。
- 前端提交了一个字段类型不对的 JSON，你的代码在深处某行抛异常 —— 因为你在业务逻辑里才开始校验，而不是在入口处就拦住。

后端要解决的，是**把「不可信的外部请求」安全、可靠、可追踪地转换成「对数据的操作」，再把结果如实返回**。这个过程里的每一步——解析请求、校验、鉴权、业务处理、错误兜底、日志记录——都有约定俗成的正确做法。这个领域就是带你把这些做法一个一个落地，而不是等出了安全事故才回头补。

## 前置知识

- [TypeScript](/typescript/) —— 本站后端全程用 TypeScript 编写。你需要先理解类型、接口、泛型和类型收窄，才能看懂 Fastify 的类型推断、请求体的类型声明，以及分层架构里 DTO（数据传输对象）的作用。

JavaScript 基础通过 TypeScript 领域间接依赖，不再单列。你不需要先学数据库：本领域会先用内存数据把请求链路讲透，数据库在[数据库领域](/database/)单独展开。

## 章节目录

| 章节 | 内容 | 学完能做什么 |
| --- | --- | --- |
| [1. Node.js 运行时](/backend/node-runtime) | ESM 与 CommonJS 的区别与选择、事件循环与异步模型、Buffer 与流、进程与线程、环境变量与配置 | 看懂 Node 程序的运行机制，知道一段异步代码的执行顺序，会正确读取环境配置 |
| [2. 用 node:http 手写最小服务器](/backend/minimal-http-server) | 不依赖任何框架，用原生 `node:http` 接收请求、解析 URL 与 body、返回响应 | 亲手走通一次完整的请求生命周期，理解框架到底帮你做了什么 |
| [3. HTTP 与 REST 原理](/backend/http-and-rest) | 方法语义、状态码、请求/响应头部、缓存、幂等性、URL 设计与版本化 | 设计出语义清晰、可缓存、可演进的 REST 接口，不再乱用状态码 |
| [4. Fastify 入门](/backend/fastify-basics) | 路由、插件与作用域隔离、钩子生命周期、基于 JSON Schema 的请求校验与序列化 | 用 Fastify 写出带自动校验和序列化的接口，理解插件封装边界 |
| [5. 分层架构与请求处理链路](/backend/layered-architecture) | controller / service / repository 分层、DTO、轻量依赖注入、如何组织目录 | 把「路由处理」和「业务逻辑」「数据访问」解耦，代码可测试可维护 |
| [6. 统一错误处理](/backend/error-handling) | 错误分类、集中式错误处理器、错误码与响应体约定、如何不泄露内部信息 | 所有异常都被兜住并返回一致、安全、可读的错误结构 |
| [7. 认证：Session、Cookie 与密码哈希](/backend/auth-session) | 密码哈希算法、Session + httpOnly Cookie、登录态维护、CSRF 防护 | 实现一套安全的注册登录，密码永不明文存储，会话不易被窃取 |
| [8. 授权与权限：RBAC 与越权防护](/backend/authorization) | 角色权限模型、资源级权限校验、水平/垂直越权的防护 | 确保用户只能访问自己有权限、且属于自己的数据 |
| [9. JWT 与 OAuth](/backend/jwt-and-oauth) | JWT 的结构与常见坑、无状态认证的取舍、刷新令牌、第三方登录流程 | 知道什么时候该用 JWT、什么时候该用 Session，能接入第三方登录 |
| [10. API 文档：Swagger 与 OpenAPI](/backend/api-docs) | `@fastify/swagger` 生成 OpenAPI、文档与校验 Schema 的关系、如何提供可交互文档 | 让接口自带一份始终和代码同步、前端可直接调用的在线文档 |
| [11. Web 安全：OWASP Top 10 与实践](/backend/web-security) | 注入、XSS、CORS、速率限制、密钥管理、依赖漏洞排查 | 对照 OWASP 清单自查一个后端，堵住最常见的安全缺口 |
| [12. 日志与监控](/backend/logging-and-monitoring) | pino 结构化日志、日志级别、请求追踪（request id）、健康检查端点 | 线上出问题时能靠日志快速定位，能被负载均衡器探活 |
| [13. 文件上传、定时任务与后台作业](/backend/uploads-and-jobs) | 上传的接收与校验、对接对象存储的思路、定时任务与后台作业的组织方式 | 处理图片/附件上传，把耗时操作移出请求主链路 |
| [14. 服务部署：Docker、优雅关闭与配置管理](/backend/docker-and-shutdown) | 多阶段 Dockerfile、容器化 Node 应用、SIGTERM 优雅关闭、环境隔离与配置 | 把后端打包成镜像，能平滑重启而不丢请求 |
| [15. 阶段项目：多用户资源管理 API](/backend/project) | 把前 14 章收进一个进程：认证授权、入口校验、限流幂等、结构化日志、健康检查、优雅关闭，每个机制配一条可判真假的断言 | 从零搭出并实测一个多用户资源管理后端，知道每一条验收标准由哪条断言证明 |

## 学习顺序建议

**严格按 1 → 15 的顺序学，其中第 2 章不能跳过。**

第 1 章的运行时知识（尤其是事件循环）是理解后面所有异步行为的地基。第 2 章让你在没有框架的情况下手写一次请求处理——很多人一上来就用 Fastify，结果框架帮他做了校验、序列化、错误兜底，他却不知道这些东西原本要自己写，一旦框架行为不符合预期就束手无策。先手写一遍，再进第 4 章，你会对「Fastify 到底省了哪些事」有具体感受。

第 3 章的 HTTP/REST 原理要放在 Fastify 之前，否则你会把框架的路由写法误当成 HTTP 本身的规则。第 5 章分层架构是第 6～9 章的载体：错误处理、认证、授权都要挂在分层的正确位置上，先有骨架再谈血肉。第 7、8 章（认证与授权）必须连着学——**「登录了」和「有权限」是两件事**，只做前者是新手最常见的安全漏洞。第 11 章安全是前面所有章节的横向收口，第 14 章部署是最后的落地，第 15 章[阶段项目](/backend/project)把前面每一条约定变成能跑、能测、能复现的一个进程——不要跳过它，分章示例全绿不等于拼在一起还成立。

## 学习方法

**每章都要动手跑代码，不要只读。** 判断学会的标准：合上教程，你能从零写出同样的接口，并解释每一段为什么这么写。

**本地环境准备（Windows）：**

- **Node.js**：到 [nodejs.org](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs) 下载当前 LTS 版本安装。Windows 下可直接用官方 `.msi` 安装程序；如果你需要在多个版本间切换，可用 nvm-windows 这类版本管理器。安装后在终端执行 `node -v` 和 `npm -v` 确认。
- **模块系统**：本项目统一用 ESM。在 `package.json` 里加 `"type": "module"`，源文件用 `import` / `export`。较新的 Node LTS 支持 `node --watch` 在文件改动时自动重启，开发时很方便。
- **编辑器**：VS Code，安装 ESLint 与 Prettier 插件。
- **框架**：`npm install fastify`。请求测试可用浏览器、`curl`，或任意图形化 HTTP 客户端。
- **数据库**：本领域前期用内存数据即可，不需要提前装数据库；等进入[数据库领域](/database/)再接入。

调试时，第 12 章的结构化日志会比你想象的更有用——养成「先加日志再猜」的习惯。

## 阶段项目

**[多用户资源管理 API](/backend/project)**：用 Fastify + TypeScript 实现一个带认证授权的后端服务，管理某种属于用户的资源（例如书签、笔记或待办）。前期数据存在内存里，但必须通过第 5 章讲的 repository 层访问，为后续替换成真实数据库留好边界。验收标准：

- 注册 / 登录可用，**密码以哈希形式存储**，登录态通过 httpOnly Cookie 维护，能防 CSRF。
- 未登录访问受保护接口返回 401；登录后访问**不属于自己的资源**返回 403（必须专门测试这条越权防护）。
- 所有接口的请求体都通过 JSON Schema 校验，非法输入在进入业务逻辑前就返回 400 并给出可读的错误信息。
- 有统一的错误响应结构，任何未捕获异常都不会把堆栈直接暴露给客户端。
- 集成 `@fastify/swagger`，能通过浏览器打开一份可交互的接口文档。
- 每次请求都有带 request id 的结构化日志，提供健康检查端点。
- 用一个多阶段 Dockerfile 打包成镜像并能启动；进程收到 SIGTERM 时优雅关闭，不丢正在处理的请求。

## 官方文档与延伸阅读

本站所有内容均为中文原创讲解，以下官方资料用于查证与深入：

- [Node.js 官方指南（英文）](https://nodejs.org/en/learn/) —— Node 运行时、异步模型、模块系统的权威入门。
- [Node.js 简介](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs) —— 第一次接触 Node 时先看这篇。
- [事件循环、timers 与 process.nextTick](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) —— 理解第 1 章异步模型的核心。
- [Node.js `http` 模块 API](https://nodejs.org/docs/latest/api/http.html) —— 第 2 章手写服务器的依据。
- [Node.js ESM 模块文档](https://nodejs.org/docs/latest/api/esm.html) —— ESM 与 CommonJS 互操作的权威说明。
- [Node.js Stream 文档](https://nodejs.org/docs/latest/api/stream.html) 与 [Process 文档](https://nodejs.org/docs/latest/api/process.html) —— 流处理与进程/信号（优雅关闭）参考。
- [Fastify 官方文档（英文）](https://fastify.dev/docs/latest/) 与 [Fastify 中文文档](https://fastify.cn/docs/latest/) —— 框架主参考。
- [Fastify 插件与作用域](https://fastify.dev/docs/latest/Reference/Plugins/)、[钩子](https://fastify.dev/docs/latest/Reference/Hooks/)、[校验与序列化](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)、[错误处理](https://fastify.dev/docs/latest/Reference/Errors/) —— 第 4、6 章的一手资料。
- [fastify-swagger（GitHub）](https://github.com/fastify/fastify-swagger) —— 第 10 章生成 OpenAPI 文档所用插件。
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) 与 [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) —— 第 11 章安全实践的清单与速查。
- [JWT 官方介绍](https://jwt.io/introduction) —— 第 9 章理解 JWT 结构。
- [pino 官方文档](https://getpino.io/) —— 第 12 章结构化日志（Fastify 默认集成的日志库）。
- [MDN HTTP 文档（中文）](https://developer.mozilla.org/zh-CN/docs/Web/HTTP) —— 第 3 章 HTTP 原理的实用参考。
- [TypeScript 手册](https://www.typescriptlang.org/docs/handbook/intro.html) —— 遇到类型问题时回查。

## 版本说明

本领域内容基于 **Node.js 当前 LTS（长期支持）版本** 与 **Fastify 当前稳定主版本** 编写，核实时间为 2026 年 10 月。为避免误导，具体主版本号请以 [nodejs.org](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs) 公布的最新 LTS 和 [Fastify 官方文档](https://fastify.dev/docs/latest/) 的最新稳定版为准。

容易过时、需重点核对的部分：

- **Node 的模块系统与内置能力**：ESM 的支持细节、内置模块（如 `--watch` 等命令行能力）在不同 Node 版本间有差异，升级 Node 大版本后要重新确认。
- **Fastify 主版本升级**：框架的插件 API、Schema 写法在大版本间可能不兼容，本站示例锁定编写时的主版本，跨大版本请以官方迁移指南为准。
- **安全相关做法**：OWASP Top 10 会更新（约每四年一版），密码哈希算法的推荐也会随算力发展变化，第 7、11 章的具体建议请对照最新的官方清单。
