import type { DefaultTheme } from 'vitepress'

/**
 * TypeScript 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'TypeScript',
    items: [
      { text: '领域首页与学习路线', link: '/typescript/' },
      { text: '为什么需要类型：结构化类型与类型擦除', link: '/typescript/why-types' },
      { text: '基础类型与类型注解', link: '/typescript/basic-types' },
      { text: '联合类型与收窄', link: '/typescript/unions-and-narrowing' },
      { text: '对象类型与接口', link: '/typescript/objects-and-interfaces' },
      { text: '函数类型', link: '/typescript/functions' },
      { text: '泛型', link: '/typescript/generics' },
      { text: '类型推断与上下文类型', link: '/typescript/inference' },
      { text: '工具类型、条件类型与映射类型', link: '/typescript/utility-types' },
      { text: '模块与声明文件', link: '/typescript/modules-and-declarations' },
      { text: 'tsconfig 关键选项', link: '/typescript/tsconfig' },
      { text: '真实项目中的取舍', link: '/typescript/tradeoffs' },
      { text: '阶段项目：用 TypeScript 重写待办清单', link: '/typescript/project' }
    ]
  }
]

export default sidebar
