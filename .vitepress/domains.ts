/**
 * 全站学习领域的唯一数据源。
 *
 * 顶部导航、首页领域卡片、侧边栏前缀都由这里派生，
 * 避免同一份领域清单在多处重复维护导致不一致。
 */

export type Phase = 0 | 1 | 2 | 3
export type DomainGroup = 'frontend' | 'backend' | 'system' | 'topic'
export type DomainStatus = 'ready' | 'partial' | 'planned'

export interface DomainMeta {
  /** 目录名，同时是 URL 前缀，如 `html` -> `/html/` */
  dir: string
  /** 中文标题 */
  title: string
  /** 导航与卡片中显示的简称 */
  short: string
  /** 一句话定位：这个领域解决什么问题 */
  summary: string
  /** 学习分期：0 = 外链入口，1 = 能上线，2 = 能运维，3 = 能长久 */
  phase: Phase
  group: DomainGroup
  /** 前置依赖的其他领域目录名 */
  prerequisites: string[]
  /** 内容建设状态 */
  status: DomainStatus
  /** 状态补充说明 */
  statusNote?: string
}

export const PHASE_LABEL: Record<Phase, string> = {
  0: '已有资源入口',
  1: '第一期 · 能上线',
  2: '第二期 · 能运维',
  3: '第三期 · 能长久'
}

/**
 * 状态徽章文案。三档的定义必须与磁盘上的真实内容一致，
 * 首页卡片和学习路线总表共用这一份，避免两处措辞漂移。
 *
 * - ready：领域内有可连续学习的完整章节（正文 + 练习 + 阶段项目）
 * - partial：领域首页 + 至少一章真实正文
 * - planned：只有领域首页（学习路线、章节规划、官方资料清单），**没有课程正文**
 */
export const STATUS_LABEL: Record<DomainStatus, string> = {
  ready: '可连续学习',
  partial: '部分完成',
  planned: '仅领域首页'
}

export const GROUP_LABEL: Record<DomainGroup, string> = {
  frontend: '前端',
  backend: '后端与数据',
  system: '系统与工程',
  topic: '专题方向'
}

export const DOMAINS: DomainMeta[] = [
  {
    dir: 'javascript',
    title: 'JavaScript',
    short: 'JavaScript',
    summary: 'JavaScript 基础与进阶：javascript.info 主线入口 + 中文知识地图、语言层易错点、DOM 与网络、阶段项目与 TypeScript 衔接。',
    phase: 1,
    group: 'frontend',
    prerequisites: [],
    status: 'ready',
    statusNote: '12 章中文正文（含阶段项目）+ javascript.info 主线入口'
  },
  {
    dir: 'html',
    title: 'HTML',
    short: 'HTML',
    summary:
      '文档结构、语义化标签、链接与多媒体、表单与校验、表格、文档大纲与 HTML 层面的无障碍。',
    phase: 1,
    group: 'frontend',
    prerequisites: [],
    status: 'ready',
    statusNote: '9 章正文 + 1 个阶段项目（含参考实现）'
  },
  {
    dir: 'css',
    title: 'CSS',
    short: 'CSS',
    summary:
      '层叠与选择器、盒模型、Flexbox 与 Grid 布局、响应式设计、动效，以及布局调试方法。',
    phase: 1,
    group: 'frontend',
    prerequisites: ['html'],
    status: 'ready',
    statusNote: '12 章正文（含阶段项目）'
  },
  {
    dir: 'typescript',
    title: 'TypeScript',
    short: 'TypeScript',
    summary:
      '类型系统基础、联合与收窄、泛型、工具类型、类型推断与声明文件，以及在真实项目中的取舍。',
    phase: 1,
    group: 'frontend',
    prerequisites: ['javascript'],
    status: 'ready',
    statusNote: '12 章正文（含阶段项目）'
  },
  {
    dir: 'vue',
    title: 'Vue 3',
    short: 'Vue 3',
    summary:
      '响应式原理、模板与组合式 API、组件设计与通信、Vue Router、Pinia 状态管理与渲染性能。',
    phase: 1,
    group: 'frontend',
    prerequisites: ['html', 'css', 'typescript'],
    status: 'ready',
    statusNote: '12 章正文全部完成（第 12 章为阶段项目），可连续学习'
  },
  {
    dir: 'react',
    title: 'React',
    short: 'React',
    summary:
      '以「Vue → React 概念对照」的方式学习：JSX、Hooks、状态与副作用、重渲染机制、生态选型。',
    phase: 3,
    group: 'frontend',
    prerequisites: ['vue'],
    status: 'ready',
    statusNote: '12 章正文全部完成（第 12 章为阶段项目），可连续学习'
  },
  {
    dir: 'frontend-engineering',
    title: '前端工程化',
    short: '前端工程化',
    summary:
      'npm 与依赖管理、Vite 与构建、代码规范、测试体系（Vitest / Playwright）、浏览器与网络机制、性能优化。',
    phase: 1,
    group: 'frontend',
    prerequisites: ['html', 'css', 'typescript'],
    status: 'ready',
    statusNote: '12 章正文全部完成（第 12 章为阶段项目），可连续学习'
  },
  {
    dir: 'backend',
    title: '后端开发（Node.js + Fastify）',
    short: '后端开发',
    summary:
      'Node.js 运行时、HTTP 与 REST 原理、Fastify、分层架构、认证授权、安全、日志与错误处理。',
    phase: 1,
    group: 'backend',
    prerequisites: ['typescript'],
    status: 'ready',
    statusNote: '15 章正文全部完成（第 15 章为阶段项目），可连续学习'
  },
  {
    dir: 'database',
    title: '数据库（SQL / PostgreSQL）',
    short: '数据库',
    summary:
      '关系模型、SQL 查询、数据建模、索引与执行计划、事务与隔离级别、迁移、备份恢复，PostgreSQL 主线 + MySQL 对照。',
    phase: 1,
    group: 'backend',
    prerequisites: [],
    status: 'ready',
    statusNote: '13 章正文全部完成（第 13 章为阶段项目），可连续学习'
  },
  {
    dir: 'data-storage',
    title: '数据存储进阶',
    short: '数据存储进阶',
    summary:
      'Redis 与缓存策略、缓存一致性与三大问题、分布式锁与限流、Prisma 与 Drizzle 对照、连接池与慢查询。',
    phase: 2,
    group: 'backend',
    prerequisites: ['database', 'backend'],
    status: 'ready',
    statusNote: '14 章正文全部完成（第 14 章为阶段项目），可连续学习'
  },
  {
    dir: 'message-queue-cloud',
    title: '消息队列与云服务',
    short: '消息队列与云服务',
    summary:
      '异步解耦、RabbitMQ / Redis Stream / Kafka 对照、可靠投递与幂等、死信队列，以及对象存储、CDN、短信邮件与 Serverless。',
    phase: 3,
    group: 'backend',
    prerequisites: ['backend', 'data-storage'],
    status: 'ready',
    statusNote: '14 章正文全部完成（第 14 章为阶段项目），可连续学习'
  },
  {
    dir: 'linux',
    title: 'Linux',
    short: 'Linux',
    summary:
      '命令行与文本处理、用户与权限、进程与 systemd、网络与防火墙、Shell 脚本、Nginx、服务器安全与故障定位。',
    phase: 2,
    group: 'system',
    prerequisites: [],
    status: 'ready',
    statusNote: '10 章正文（含阶段项目）'
  },
  {
    dir: 'devops',
    title: '工程工具与部署',
    short: '工程工具与部署',
    summary:
      'Git 与 GitHub 协作、代码规范、CI/CD 与 GitHub Actions、Docker 与 Compose、VPS + Nginx + HTTPS 部署与回滚。',
    phase: 1,
    group: 'system',
    prerequisites: ['linux'],
    status: 'ready',
    statusNote: '10 章正文（含阶段项目）'
  },
  {
    dir: 'computer-science',
    title: '计算机基础',
    short: '计算机基础',
    summary:
      '数据结构与复杂度、常见算法思路、计算机网络（DNS / TCP / TLS / HTTP）、操作系统（进程线程 / IO 模型）、软件架构取舍。',
    phase: 3,
    group: 'system',
    prerequisites: [],
    status: 'ready',
    statusNote:
      '12 章正文全部完成（第 12 章为阶段项目），可连续学习：数据结构线（第 1–4 章）、网络基础线（第 5–7 章）、操作系统基础线（第 8–9 章）与架构线（第 10–11 章）四条线首尾相接，第 12 章把它们挂到一台真实运行的机器上做诊断'
  },
  {
    dir: 'realtime',
    title: '实时通信',
    short: '实时通信',
    summary:
      'WebSocket 协议与握手、SSE、心跳与断线重连、Nginx 代理配置、房间与广播、Node 侧实现对照。',
    phase: 2,
    group: 'topic',
    prerequisites: ['backend', 'linux'],
    status: 'ready',
    statusNote: '11 章正文（含阶段项目）'
  },
  {
    dir: 'ai-apps',
    title: 'AI 应用开发',
    short: 'AI 应用开发',
    summary:
      'LLM API 集成、Prompt 工程、流式响应与前端渲染、上下文与 token 成本、RAG 全链路、Function Calling 与 Agent 编排。',
    phase: 3,
    group: 'topic',
    prerequisites: ['backend', 'database'],
    status: 'ready',
    statusNote:
      '11 章正文全部完成（第 11 章为阶段项目），可连续学习：第 1 章《LLM API 基础》、第 2 章《Prompt 工程》、第 3 章《流式响应与前端渲染》（可独立阅读）、第 4 章《上下文窗口与 token 成本》、第 5 章《结构化输出》、第 6 章《RAG（一）：从文档到向量库》、第 7 章《RAG（二）：检索质量与注入》、第 8 章《Function Calling 与 Agent 编排》、第 9 章《评测与可观测》、第 10 章《安全与滥用防护》、第 11 章《阶段项目：个人知识库问答助手》；第 1、2、4 章构成可调用的基础线，第 5、10 章构成消费输出与上线前防线，第 6、7 章构成从文档到候选片段再到质量判据的 RAG 两半，第 8 章把模型提出的调用请求切成提出、判定、执行、回填四段闸门，第 9 章把这几章的产物接成可执行的质量闭环，第 11 章把它们落成一条八阶段实施线——项目章的本机可验范围与需真实环境的验收在章内分段标注'
  },
  {
    dir: 'mobile',
    title: '移动端开发',
    short: '移动端开发',
    summary:
      '微信小程序（与 Vue 3 心智对照）、uni-app、跨端方案取舍、React Native 概览、移动端适配、真机调试与发布流程。',
    phase: 3,
    group: 'topic',
    prerequisites: ['vue'],
    status: 'ready',
    statusNote:
      '9 章正文全部完成（第 9 章为阶段项目），可连续学习：第 1 章路线选型与第 2 章移动端 Web 适配是不依赖平台的入门段，第 3、4 章构成小程序从双线程架构到登录、网络、分包的开发闭环，第 5 章 uni-app 与第 6 章跨端概览补齐路线取舍，第 7 章真机调试给出「缩小范围—采集证据—区分模拟器与真机」的工作流，第 8 章发布流程拆开构建、体验版、提审、发布与回滚的关系，第 9 章把它们组织成七阶段、三记录、一部 iPhone 的可交付项目——需要真实设备、已注册账号、平台审核与后端部署的验收项在章内逐条标注'
  }
]

/** 领域目录 -> 元数据 */
export const DOMAIN_MAP: Record<string, DomainMeta> = Object.fromEntries(
  DOMAINS.map((d) => [d.dir, d])
)

/** 按分组返回领域，用于导航与首页 */
export function domainsByGroup(): Array<{ group: DomainGroup; label: string; items: DomainMeta[] }> {
  const order: DomainGroup[] = ['frontend', 'backend', 'system', 'topic']
  return order
    .map((group) => ({
      group,
      label: GROUP_LABEL[group],
      items: DOMAINS.filter((d) => d.group === group)
    }))
    .filter((g) => g.items.length > 0)
}

/** 按分期返回领域，用于学习路线页 */
export function domainsByPhase(): Array<{ phase: Phase; label: string; items: DomainMeta[] }> {
  const order: Phase[] = [1, 2, 3, 0]
  return order
    .map((phase) => ({
      phase,
      label: PHASE_LABEL[phase],
      items: DOMAINS.filter((d) => d.phase === phase)
    }))
    .filter((g) => g.items.length > 0)
}
