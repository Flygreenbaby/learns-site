import type { DefaultTheme } from 'vitepress'

/**
 * 数据存储进阶 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '数据存储进阶',
    items: [
      { text: '领域首页与学习路线', link: '/data-storage/' },
      { text: '数据存储进阶要解决什么', link: '/data-storage/why-this-layer' },
      { text: 'Redis 基础：数据结构与常用命令', link: '/data-storage/redis-data-structures' },
      { text: 'Redis 持久化：RDB 与 AOF', link: '/data-storage/redis-persistence' },
      { text: 'Redis 过期与内存淘汰', link: '/data-storage/expiry-and-eviction' },
      { text: '缓存模式：Cache-Aside 与 Read/Write-Through', link: '/data-storage/caching-patterns' },
      { text: '缓存三大问题：穿透、击穿、雪崩', link: '/data-storage/cache-penetration-breakdown-avalanche' },
      { text: '缓存一致性与更新失效策略', link: '/data-storage/cache-consistency' },
      { text: '分布式会话、限流与幂等', link: '/data-storage/session-rate-limit-idempotency' },
      { text: '分布式锁及其陷阱', link: '/data-storage/distributed-lock' },
      { text: 'Prisma 深入：关系查询与事务', link: '/data-storage/prisma-deep-dive' },
      { text: '原始 SQL、Drizzle 对照与类型安全边界', link: '/data-storage/raw-sql-and-drizzle' },
      { text: '连接池与慢查询定位', link: '/data-storage/connection-pool-and-slow-query' },
      { text: '对象存储与 CDN', link: '/data-storage/object-storage-and-cdn' },
      { text: '阶段项目：加一层扛得住量的数据层', link: '/data-storage/project' }
    ]
  }
]

export default sidebar
