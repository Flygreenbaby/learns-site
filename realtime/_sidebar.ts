import type { DefaultTheme } from 'vitepress'

/**
 * 实时通信 领域侧边栏。
 * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，
 * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。
 */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '实时通信',
    items: [
      { text: '领域首页与学习路线', link: '/realtime/' },
      { text: '为什么请求-响应不够', link: '/realtime/why-http-is-not-enough' },
      { text: 'WebSocket 协议', link: '/realtime/websocket-protocol' },
      { text: 'SSE：单向服务器推送', link: '/realtime/sse' },
      { text: '三种方案对比与选型', link: '/realtime/choosing' },
      { text: '心跳与断线重连', link: '/realtime/heartbeat-and-reconnect' },
      { text: '房间、广播与在线状态', link: '/realtime/rooms-and-presence' },
      { text: 'Node 侧实现对照', link: '/realtime/node-implementations' },
      { text: 'Nginx 代理 WebSocket', link: '/realtime/nginx-proxy' },
      { text: '扩展性：多实例的广播问题', link: '/realtime/scaling-out' },
      { text: '与 AI 流式输出的关系', link: '/realtime/ai-streaming' },
      { text: '阶段项目：实时聊天室', link: '/realtime/project' }
    ]
  }
]

export default sidebar
