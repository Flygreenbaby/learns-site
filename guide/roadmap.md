# 完整学习路线

这一页是全站的学习顺序总表。目标很明确：**从零基础到能独立做出一个产品并部署到自己的服务器上运行**。

路线按三期组织。这不是「先学完一期才能碰二期」的硬性规定，而是投入产出比的排序——第一期的内容直接决定你能不能把东西做出来并上线，第三期决定你能走多远。

## 总表

<RoadmapTable />

## 第一期 · 能上线

这一期结束的标志是：你有一个真实可访问的产品跑在你自己的服务器上。

**主线顺序：**

1. [HTML](/html/) — 文档结构与语义化。这是唯一没有前置依赖的领域，也是所有 UI 的地基。写不对 HTML，后面 CSS 和框架都会一直在跟浏览器对抗。
2. [CSS](/css/) — 层叠、盒模型、Flexbox 与 Grid、响应式。**CSS 的核心难点不是记属性，而是理解层叠与布局算法**，所以这个领域重点讲原理。
3. [JavaScript](/javascript/) — 语言主线用 [javascript.info](https://javascript.info/)，本站不复制它的正文；[本站的 JavaScript 领域](/javascript/)提供 12 章中文正文（含阶段项目）和一张与 javascript.info 的章节对照地图，用来补齐语言层易错点、DOM 与事件、事件循环与 async/await、模块、网络与存储、错误调试、无障碍与性能。
4. [TypeScript](/typescript/) — 在 JavaScript 之上加类型系统。重点不是语法，而是「如何让类型帮你发现错误」。
5. [Vue 3](/vue/) — 响应式原理、组合式 API、组件设计、Vue Router、Pinia。
6. [前端工程化](/frontend-engineering/) — npm、Vite、构建、代码规范。穿插在前面几步中学习，不必单独留一段时间。
7. [后端开发](/backend/) — Node.js 运行时、HTTP 与 REST 原理、Fastify、认证授权、安全、日志。
8. [数据库](/database/) — SQL、建模、索引、事务、迁移、备份。SQLite 入门，PostgreSQL 主线。
9. [工程工具与部署](/devops/) 的最小集 — Git、Dockerfile、Nginx 反向代理、HTTPS。
10. [Linux](/linux/) 的最小集 — 命令行、权限、进程、systemd、SSH。

**里程碑**：一个带用户注册登录、数据持久化、部署在 VPS 上通过域名 + HTTPS 访问的完整产品。

## 第二期 · 能运维

产品上线之后真正的问题才开始：服务器被入侵、数据库没备份、缓存不一致、部署一次要停机十分钟。

- [Linux](/linux/) 完整内容 — Shell 脚本、网络与防火墙、日志与故障定位、服务器安全加固
- [工程工具与部署](/devops/) 完整内容 — CI/CD 与 GitHub Actions、Docker Compose、发布与回滚策略
- [数据存储进阶](/data-storage/) — Redis、缓存策略与三大经典问题、Prisma 与 Drizzle 对照、连接池
- [实时通信](/realtime/) — WebSocket、SSE、心跳重连、Nginx 代理配置
- 测试体系 — Vitest 单测、Playwright E2E

**里程碑**：产品具备自动部署、监控告警、定时备份、故障可定位的运维能力。

## 第三期 · 能长久

这一期决定你的技术判断力和天花板，但不阻塞上线。

- [计算机基础](/computer-science/) — 数据结构与复杂度、算法思路、计算机网络、操作系统、软件架构取舍
- [AI 应用开发](/ai-apps/) — LLM API、Prompt 工程、流式响应、RAG 全链路、Agent 编排
- [消息队列与云服务](/message-queue-cloud/) — 异步解耦、可靠投递与幂等、对象存储、CDN、Serverless
- [移动端开发](/mobile/) — 微信小程序、uni-app、跨端方案取舍
- [React](/react/) — 以「Vue → React 概念对照」的方式学，成本远低于从零学第二套

## 关于依赖关系的几点说明

**为什么 HTML 在 CSS 前面**：CSS 选择器和布局的效果完全取决于 HTML 结构。结构语义化做得好，CSS 会短一半；结构混乱时，你会用大量 CSS hack 去对抗自己写坏的 HTML。

**为什么 TypeScript 在 Vue 前面**：Vue 3 的组合式 API 与 TypeScript 深度绑定，`ref` 的类型推断、props 的类型声明、Pinia store 的类型安全，都需要先理解 TS 的泛型与类型推断。

**为什么数据库在后端之后而不是之前**：先用 Fastify 写出返回内存数据的 API，理解请求处理链路；再引入数据库，你会清楚地看到「数据访问层」解决的是什么问题。反过来先学 SQL，容易停留在语法层面。

**为什么 Linux 被拆成两次**：第一期只需要能登录服务器、跑起容器、配好 Nginx；第二期才需要 Shell 脚本、防火墙、故障定位这些运维能力。一次学完会严重拖慢第一次上线。

**计算机基础为什么放最后**：它不阻塞你做产品，但网络协议（HTTP / DNS / TLS）和 IO 模型这些内容会在第一、二期的实战中反复遇到。遇到时回查即可，不必等第三期。
