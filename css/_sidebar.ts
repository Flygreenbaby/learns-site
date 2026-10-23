import type { DefaultTheme } from 'vitepress'

/**
 * CSS 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'CSS',
    items: [
      { text: '领域首页与学习路线', link: '/css/' },
      { text: 'CSS 如何生效：来源、层叠、继承与值的计算', link: '/css/how-it-works' },
      { text: '选择器与特异性：怎么算，以及为什么越低越好', link: '/css/selectors' },
      { text: '盒模型与外边距折叠：尺寸怎么算，间距为什么不是你想的那个数', link: '/css/box-model' },
      { text: '常规流与格式化上下文：容器为什么塌陷，BFC 到底管什么', link: '/css/flow-and-bfc' },
      { text: 'Flexbox：主轴、flex 简写与项目尺寸分配', link: '/css/flexbox' },
      { text: 'Grid：轨道、fr 单位、自动放置与响应式卡片墙', link: '/css/grid' },
      { text: '定位与层叠上下文：z-index 为什么没生效', link: '/css/positioning-and-stacking' },
      { text: '值、单位与自定义属性：设计令牌与主题切换', link: '/css/units-and-custom-properties' },
      { text: '响应式设计：视口、媒体查询与容器查询', link: '/css/responsive-design' },
      { text: '过渡与动画：可过渡属性、合成层与减弱动效', link: '/css/transitions-and-animations' },
      { text: '布局调试方法论：DevTools 与固定排查路径', link: '/css/debugging-layout' },
      { text: '阶段项目：响应式产品落地页', link: '/css/project' }
    ]
  }
]

export default sidebar
