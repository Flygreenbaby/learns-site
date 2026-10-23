import type { DefaultTheme } from 'vitepress'

/**
 * AI 应用开发 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'AI 应用开发',
    items: [
      { text: '领域首页与学习路线', link: '/ai-apps/' },
      { text: 'LLM API 基础', link: '/ai-apps/llm-api-basics' },
      { text: 'Prompt 工程', link: '/ai-apps/prompt-engineering' },
      { text: '流式响应与前端渲染', link: '/ai-apps/streaming' },
      { text: '上下文窗口与 token 成本', link: '/ai-apps/context-and-cost' },
      { text: '结构化输出', link: '/ai-apps/structured-output' },
      { text: 'RAG（一）：从文档到向量库', link: '/ai-apps/rag-retrieval' },
      { text: 'RAG（二）：检索质量与注入', link: '/ai-apps/rag-quality' },
      { text: 'Function Calling 与 Agent 编排', link: '/ai-apps/function-calling-and-agents' },
      { text: '评测与可观测', link: '/ai-apps/evaluation-and-observability' },
      { text: '安全与滥用防护', link: '/ai-apps/security-and-abuse' },
      { text: '阶段项目：个人知识库问答助手', link: '/ai-apps/project' }
    ]
  }
]

export default sidebar
