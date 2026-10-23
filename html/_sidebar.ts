import type { DefaultTheme } from 'vitepress'

/**
 * HTML 领域侧边栏。
 * 只在本目录内维护：新增章节时，写好 .md 文件再在这里加一行即可，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'HTML',
    items: [
      { text: '领域首页与学习路线', link: '/html/' },
      { text: 'HTML 是什么：文档、解析与容错', link: '/html/what-is-html' },
      { text: '文档骨架：DOCTYPE、head 与元数据', link: '/html/document-structure' },
      { text: '文本语义：标题、段落、列表与强调', link: '/html/text-semantics' },
      { text: '链接与导航：href、rel 与 URL', link: '/html/links' },
      { text: '图片与多媒体：srcset、picture 与 video', link: '/html/images-media' },
      { text: '表单：控件、label 与原生校验', link: '/html/forms' },
      { text: '表格：结构、表头关联与可访问性', link: '/html/tables' },
      { text: '语义化布局与文档大纲', link: '/html/layout-semantics' },
      { text: 'HTML 层面的无障碍', link: '/html/accessibility' },
      { text: '阶段项目：语义化个人学习档案页', link: '/html/project' }
    ]
  }
]

export default sidebar
