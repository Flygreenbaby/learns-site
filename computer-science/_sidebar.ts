import type { DefaultTheme } from 'vitepress'

/**
 * 计算机基础 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '计算机基础',
    items: [
      { text: '领域首页与学习路线', link: '/computer-science/' },
      { text: '数据结构（一）：线性结构', link: '/computer-science/data-structures-linear' },
      { text: '数据结构（二）：哈希、树与图', link: '/computer-science/data-structures-hash-tree-graph' },
      { text: '复杂度分析', link: '/computer-science/complexity' },
      { text: '常见算法思路', link: '/computer-science/algorithms' },
      { text: '网络：分层模型与 DNS', link: '/computer-science/network-dns' },
      { text: '网络：TCP、UDP 与 TLS', link: '/computer-science/network-tcp-tls' },
      { text: '网络：HTTP 演进与 CDN', link: '/computer-science/network-http' },
      { text: '操作系统：进程与线程', link: '/computer-science/os-process-thread' },
      { text: '操作系统：内存与 IO 模型', link: '/computer-science/os-memory-io' },
      { text: '软件架构：模式与取舍', link: '/computer-science/architecture' },
      { text: '领域建模与技术选型方法论', link: '/computer-science/domain-modeling' },
      { text: '阶段项目：全链路诊断演练', link: '/computer-science/project' }
    ]
  }
]

export default sidebar
