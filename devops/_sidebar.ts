import type { DefaultTheme } from 'vitepress'

/**
 * 工程工具与部署 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '工程工具与部署',
    items: [
      { text: '领域首页与学习路线', link: '/devops/' },
      { text: 'Git 基础', link: '/devops/git-basics' },
      { text: 'Git 协作与 GitHub', link: '/devops/git-collaboration' },
      { text: '代码规范与提交约定', link: '/devops/code-standards' },
      { text: '测试体系', link: '/devops/testing' },
      { text: 'CI/CD 与 GitHub Actions', link: '/devops/ci-cd' },
      { text: 'Docker 基础', link: '/devops/docker-basics' },
      { text: 'Docker Compose、卷与网络', link: '/devops/docker-compose' },
      { text: '部署到 VPS', link: '/devops/deploy-to-vps' },
      { text: '发布与回滚', link: '/devops/release-and-rollback' },
      { text: '阶段项目：完整部署上线', link: '/devops/project' }
    ]
  }
]

export default sidebar
