import type { DefaultTheme } from 'vitepress'

/**
 * 前端工程化 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '前端工程化',
    items: [
      { text: '领域首页与学习路线', link: '/frontend-engineering/' },
      { text: '包管理：npm 与 pnpm', link: '/frontend-engineering/package-managers' },
      { text: '语义化版本与锁文件', link: '/frontend-engineering/semver-and-lockfile' },
      { text: 'Vite 开发侧：原生 ESM、预构建与 HMR', link: '/frontend-engineering/vite-dev' },
      { text: 'Vite 构建侧：打包、代码分割与产物分析', link: '/frontend-engineering/vite-build' },
      { text: '代码规范：ESLint 与 Prettier', link: '/frontend-engineering/lint-and-format' },
      { text: '浏览器渲染机制与关键渲染路径', link: '/frontend-engineering/rendering-pipeline' },
      { text: 'HTTP 缓存与资源加载策略', link: '/frontend-engineering/http-caching' },
      { text: '性能指标与 Core Web Vitals', link: '/frontend-engineering/performance' },
      { text: '测试体系：Vitest、Vue Test Utils 与 Playwright', link: '/frontend-engineering/testing' },
      { text: '环境变量与配置管理', link: '/frontend-engineering/env-and-config' },
      { text: 'Monorepo 与工作区', link: '/frontend-engineering/monorepo' },
      { text: '阶段项目：工程化体检', link: '/frontend-engineering/project' }
    ]
  }
]

export default sidebar
