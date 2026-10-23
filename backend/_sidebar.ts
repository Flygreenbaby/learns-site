import type { DefaultTheme } from 'vitepress'

/**
 * 后端开发（Node.js + Fastify） 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '后端开发（Node.js + Fastify）',
    items: [
      { text: '领域首页与学习路线', link: '/backend/' },
      { text: 'Node.js 运行时：模块、事件循环与流', link: '/backend/node-runtime' },
      { text: '用 node:http 手写最小服务器', link: '/backend/minimal-http-server' },
      { text: 'HTTP 与 REST 原理', link: '/backend/http-and-rest' },
      { text: 'Fastify 入门：路由、插件与 Schema', link: '/backend/fastify-basics' },
      { text: '分层架构与请求处理链路', link: '/backend/layered-architecture' },
      { text: '统一错误处理', link: '/backend/error-handling' },
      { text: '认证：Session、Cookie 与密码哈希', link: '/backend/auth-session' },
      { text: '授权与权限：RBAC 与越权防护', link: '/backend/authorization' },
      { text: 'JWT 与 OAuth', link: '/backend/jwt-and-oauth' },
      { text: 'API 文档：Swagger 与 OpenAPI', link: '/backend/api-docs' },
      { text: 'Web 安全：OWASP Top 10 与实践', link: '/backend/web-security' },
      { text: '日志与监控', link: '/backend/logging-and-monitoring' },
      { text: '文件上传、定时任务与后台作业', link: '/backend/uploads-and-jobs' },
      { text: '服务部署：Docker、优雅关闭与配置', link: '/backend/docker-and-shutdown' },
      { text: '阶段项目：多用户资源管理 API', link: '/backend/project' }
    ]
  }
]

export default sidebar
