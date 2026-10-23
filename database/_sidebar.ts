import type { DefaultTheme } from 'vitepress'

/**
 * 数据库（SQL / PostgreSQL） 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '数据库（SQL / PostgreSQL）',
    items: [
      { text: '领域首页与学习路线', link: '/database/' },
      { text: '关系模型与基础概念', link: '/database/relational-model' },
      { text: 'SQLite 入门', link: '/database/sqlite-first' },
      { text: 'SQL 查询基础', link: '/database/sql-basics' },
      { text: 'SQL 查询进阶：窗口函数与 CTE', link: '/database/sql-advanced' },
      { text: '数据建模', link: '/database/data-modeling' },
      { text: '索引与执行计划', link: '/database/indexes' },
      { text: '事务与并发', link: '/database/transactions' },
      { text: '迁移与版本管理', link: '/database/migrations' },
      { text: '备份与恢复', link: '/database/backup-and-restore' },
      { text: 'PostgreSQL 进阶特性', link: '/database/postgres-features' },
      { text: 'MySQL 差异对照', link: '/database/mysql-differences' },
      { text: '数据访问设计：ORM、N+1 与分页', link: '/database/data-access-design' },
      { text: '阶段项目：为真实应用落地数据层', link: '/database/project' }
    ]
  }
]

export default sidebar
