import type { DefaultTheme } from 'vitepress'

/**
 * 消息队列与云服务 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '消息队列与云服务',
    items: [
      { text: '领域首页与学习路线', link: '/message-queue-cloud/' },
      { text: '为什么需要异步解耦', link: '/message-queue-cloud/why-async' },
      { text: '消息队列核心概念', link: '/message-queue-cloud/mq-concepts' },
      { text: '可靠投递：确认、重投与幂等', link: '/message-queue-cloud/reliable-delivery' },
      { text: '死信队列、延迟消息与顺序性', link: '/message-queue-cloud/dlq-delay-order' },
      { text: '投递语义：不丢、不重与取舍', link: '/message-queue-cloud/delivery-semantics' },
      { text: 'RabbitMQ：定位与适用场景', link: '/message-queue-cloud/rabbitmq' },
      { text: 'Redis Stream：轻量级队列', link: '/message-queue-cloud/redis-stream' },
      { text: 'Kafka：高吞吐日志流', link: '/message-queue-cloud/kafka' },
      { text: '三者选型对照', link: '/message-queue-cloud/choosing' },
      { text: '云服务基础：对象存储与 CDN', link: '/message-queue-cloud/object-storage-and-cdn' },
      { text: '云服务基础：短信、邮件与第三方 API', link: '/message-queue-cloud/sms-email-and-api' },
      { text: 'Serverless、云数据库与云网络', link: '/message-queue-cloud/serverless-and-cloud-services' },
      { text: '自托管 vs 云服务、厂商锁定与成本', link: '/message-queue-cloud/self-host-vs-cloud' },
      { text: '阶段项目：把慢操作异步化', link: '/message-queue-cloud/project' }
    ]
  }
]

export default sidebar
