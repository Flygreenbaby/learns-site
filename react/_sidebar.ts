import type { DefaultTheme } from 'vitepress'

/**
 * React 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'React',
    items: [
      { text: '领域首页与学习路线', link: '/react/' },
      { text: '两套渲染模型：Vue 与 React 的根本差异', link: '/react/two-rendering-models' },
      { text: 'JSX 与模板的对照', link: '/react/jsx' },
      { text: 'useState / useReducer 与不可变更新', link: '/react/state' },
      { text: 'props、回调与 children', link: '/react/props-and-children' },
      { text: 'useEffect 与 watch 的对照', link: '/react/use-effect' },
      { text: 'Context 与 provide / inject 的对照', link: '/react/context' },
      { text: '重渲染机制与性能', link: '/react/re-render-performance' },
      { text: 'React Router 与 Vue Router 对照', link: '/react/router' },
      { text: '状态管理选型：Redux / Zustand 与 Pinia 对照', link: '/react/state-management' },
      { text: 'useRef 与受控组件', link: '/react/refs-and-forms' },
      { text: '对照法的盲区：React 特有的东西', link: '/react/react-only' },
      { text: '阶段项目：双框架对照重写', link: '/react/project' }
    ]
  }
]

export default sidebar
