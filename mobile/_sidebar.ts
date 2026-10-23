import type { DefaultTheme } from 'vitepress'

/**
 * 移动端开发 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '移动端开发',
    items: [
      { text: '领域首页与学习路线', link: '/mobile/' },
      { text: '要不要做移动端、做哪种', link: '/mobile/choosing-route' },
      { text: '移动端 Web 适配', link: '/mobile/mobile-web' },
      { text: '微信小程序：心智对照（一）', link: '/mobile/miniprogram-model' },
      { text: '微信小程序：心智对照（二）', link: '/mobile/miniprogram-api' },
      { text: 'uni-app', link: '/mobile/uni-app' },
      { text: '跨端方案概览', link: '/mobile/cross-platform' },
      { text: '真机调试', link: '/mobile/device-debugging' },
      { text: '发布流程', link: '/mobile/release' },
      { text: '阶段项目：一个真实上线的小程序', link: '/mobile/project' }
    ]
  }
]

export default sidebar
