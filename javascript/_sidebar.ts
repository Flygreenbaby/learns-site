import type { DefaultTheme } from 'vitepress'

/**
 * JavaScript 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'JavaScript',
    items: [
      { text: '领域首页与学习路线', link: '/javascript/' },
      { text: 'JavaScript 学习地图与 javascript.info 章节对照', link: '/javascript/learning-map' },
      { text: '类型、值与引用语义', link: '/javascript/types-and-values' },
      { text: '对象、数组与常用方法', link: '/javascript/objects-and-arrays' },
      { text: '函数、作用域、闭包与 this', link: '/javascript/functions-and-scope' },
      { text: '原型链、class 与封装', link: '/javascript/prototypes-and-classes' },
      { text: '事件循环、Promise 与 async/await', link: '/javascript/asynchronous' },
      { text: 'DOM 操作与事件系统', link: '/javascript/dom-and-events' },
      { text: 'fetch、同源策略与浏览器存储', link: '/javascript/network-and-storage' },
      { text: 'ES 模块、动态导入与迭代器', link: '/javascript/modules-and-iterators' },
      { text: '错误处理与 DevTools 调试', link: '/javascript/errors-and-debugging' },
      { text: 'JS 层面的无障碍与性能', link: '/javascript/accessibility-and-performance' },
      { text: '阶段项目：纯 JavaScript 待办清单', link: '/javascript/project' }
    ]
  }
]

export default sidebar
