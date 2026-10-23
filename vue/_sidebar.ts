import type { DefaultTheme } from 'vitepress'

/**
 * Vue 3 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Vue 3',
    items: [
      { text: '领域首页与学习路线', link: '/vue/' },
      { text: 'Vue 是什么与心智模型', link: '/vue/mental-model' },
      { text: '响应式原理：ref、reactive 与 Proxy', link: '/vue/reactivity' },
      { text: '模板语法与指令', link: '/vue/template-syntax' },
      { text: '计算属性与侦听器', link: '/vue/computed-and-watch' },
      { text: '组件基础：props、emit 与插槽', link: '/vue/components' },
      { text: '组合式 API、composables 与组件设计', link: '/vue/composables' },
      { text: '生命周期、模板引用与依赖注入', link: '/vue/lifecycle-and-inject' },
      { text: 'Vue Router', link: '/vue/router' },
      { text: 'Pinia 状态管理', link: '/vue/pinia' },
      { text: '渲染性能：v-memo、shallowRef 与长列表', link: '/vue/rendering-performance' },
      { text: '单文件组件与构建链', link: '/vue/sfc-and-build' },
      { text: '阶段项目：多页面待办应用', link: '/vue/project' }
    ]
  }
]

export default sidebar
