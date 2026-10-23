import type { DefaultTheme } from 'vitepress'

/**
 * Linux 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Linux',
    items: [
      { text: '领域首页与学习路线', link: '/linux/' },
      { text: '命令行基础', link: '/linux/command-line' },
      { text: '用户与权限', link: '/linux/users-and-permissions' },
      { text: '进程、信号与 systemd', link: '/linux/processes-and-systemd' },
      { text: '软件包与运行环境', link: '/linux/packages-and-runtime' },
      { text: '网络诊断与防火墙', link: '/linux/networking' },
      { text: 'Shell 脚本', link: '/linux/shell-scripting' },
      { text: 'Nginx', link: '/linux/nginx' },
      { text: '服务器安全', link: '/linux/server-security' },
      { text: '日志与故障定位', link: '/linux/logs-and-troubleshooting' },
      { text: '阶段项目：从零接管一台 VPS', link: '/linux/project' }
    ]
  }
]

export default sidebar
