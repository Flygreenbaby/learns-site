import { defineConfig } from 'vitepress'
import { DOMAINS } from './domains'

import javascriptSidebar from '../javascript/_sidebar'
import htmlSidebar from '../html/_sidebar'
import cssSidebar from '../css/_sidebar'
import typescriptSidebar from '../typescript/_sidebar'
import vueSidebar from '../vue/_sidebar'
import reactSidebar from '../react/_sidebar'
import frontendEngineeringSidebar from '../frontend-engineering/_sidebar'
import backendSidebar from '../backend/_sidebar'
import databaseSidebar from '../database/_sidebar'
import dataStorageSidebar from '../data-storage/_sidebar'
import messageQueueCloudSidebar from '../message-queue-cloud/_sidebar'
import linuxSidebar from '../linux/_sidebar'
import devopsSidebar from '../devops/_sidebar'
import computerScienceSidebar from '../computer-science/_sidebar'
import realtimeSidebar from '../realtime/_sidebar'
import aiAppsSidebar from '../ai-apps/_sidebar'
import mobileSidebar from '../mobile/_sidebar'

/**
 * 中文分词器。
 *
 * VitePress 的本地搜索基于 MiniSearch，默认按空白与标点分词，
 * 对中文完全无效（整句会被当成一个 token）。
 * 这里的策略：
 * - 拉丁字母/数字序列按整词切分并转小写（保留 `.` `-` `_`，
 *   以便搜到 `flex-grow`、`Object.entries` 这类标识符）
 * - 连续 CJK 字符同时切出「单字」与「相邻双字」，
 *   单字保证召回，双字保证精度（搜「层叠」不会命中所有含「层」的文章）
 *
 * ⚠ 这个函数必须是**完全自包含**的：正则、常量都要写在函数体内部，
 * 不能引用模块作用域的任何变量。
 *
 * 原因（已在 VitePress 1.6.4 源码中核实）：配置文件里的函数不会作为函数传给浏览器，
 * 而是被序列化成 `_vp-fn_<函数源码文本>` 字符串写进每个页面的 siteData，
 * 客户端再用 `new Function('return ' + 源码)()` 还原
 * （见 vitepress/dist/node/chunk-D3CUZ4fa.js 的 serializeFunctions / deserializeFunctions）。
 * `new Function` 创建的函数**没有闭包**，只能访问全局作用域和自己的参数。
 * 一旦函数体引用了模块级常量（例如把正则提到函数外），构建和 dev 启动都不会报错
 * （Node 侧索引时闭包还在），但浏览器里一搜索就抛
 * `ReferenceError: XXX is not defined`，表现为「搜索框能打开、输入后永远没有结果」，
 * 控制台只有一条 `Unhandled error during execution of watcher callback`。
 */
function tokenize(text: string): string[] {
  // CJK 统一表意文字（基本区 + 扩展 A + 兼容区）连续成段；
  // 或者一段以字母/数字/下划线/$ 开头、允许含 . - _ 的标识符。
  const tokenRe = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|[A-Za-z0-9_$][A-Za-z0-9_$\-.]*/g
  const identRe = /^[A-Za-z0-9_$]/
  const tokens: string[] = []
  let match: RegExpExecArray | null
  while ((match = tokenRe.exec(text)) !== null) {
    const segment = match[0]
    if (identRe.test(segment)) {
      tokens.push(segment.toLowerCase())
      continue
    }
    for (let i = 0; i < segment.length; i++) {
      tokens.push(segment[i])
      if (i + 1 < segment.length) {
        tokens.push(segment.slice(i, i + 2))
      }
    }
  }
  return tokens
}

/**
 * 查询侧分词器（与索引侧不同，这是有意的）。
 *
 * 索引侧同时切出「单字 + 相邻双字」是为了召回；但如果查询侧也这么切，
 * 再配合 MiniSearch 的 `combineWith: 'OR'`，就会变成「命中任一单字即算匹配」。
 * 而「的」「不」「在」「是」这类单字几乎出现在每一篇文章里，结果是
 * **任何查询都返回满页结果**，包括根本不存在的词（实测：查「zzz不存在的词qqq」
 * 也返回 16 条无关结果）。这样的搜索没有筛选能力，等于没有搜索。
 *
 * 所以查询侧改成：
 * - CJK 连续段**不重叠地两两切分**（「学习进度」→ 学习 / 进度，奇数长度时末尾留单字）
 * - 拉丁标识符仍按整词切
 * 再配合 `combineWith: 'AND'`：查询里的每一段都必须在同一个章节里出现。
 * 语义上约等于「子串匹配」，行为可预期——搜不到就是真的没有，会显示「没有找到相关结果」。
 *
 * 已知代价（如实说明）：AND 让长句查询变严格。搜「表格布局」要求文中出现
 * 「表格布局」这个连续片段；如果原文写的是「表格的响应式方案」，就搜不到。
 * 对个人学习站点来说，按术语搜索是主要用法，这个取舍是值得的。
 *
 * ⚠ 同样必须自包含（理由见上方 tokenize 的注释）：不能引用模块作用域的变量。
 */
function queryTokenize(text: string): string[] {
  const tokenRe = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|[A-Za-z0-9_$][A-Za-z0-9_$\-.]*/g
  const identRe = /^[A-Za-z0-9_$]/
  const tokens: string[] = []
  let match: RegExpExecArray | null
  while ((match = tokenRe.exec(text)) !== null) {
    const segment = match[0]
    if (identRe.test(segment)) {
      tokens.push(segment.toLowerCase())
      continue
    }
    for (let i = 0; i < segment.length; i += 2) {
      tokens.push(segment.slice(i, i + 2))
    }
  }
  return tokens
}

const sidebarByDomain: Record<string, unknown> = {
  javascript: javascriptSidebar,
  html: htmlSidebar,
  css: cssSidebar,
  typescript: typescriptSidebar,
  vue: vueSidebar,
  react: reactSidebar,
  'frontend-engineering': frontendEngineeringSidebar,
  backend: backendSidebar,
  database: databaseSidebar,
  'data-storage': dataStorageSidebar,
  'message-queue-cloud': messageQueueCloudSidebar,
  linux: linuxSidebar,
  devops: devopsSidebar,
  'computer-science': computerScienceSidebar,
  realtime: realtimeSidebar,
  'ai-apps': aiAppsSidebar,
  mobile: mobileSidebar
}

// 各领域侧边栏按 `/<dir>/` 前缀隔离：编辑某个领域只影响它自己的侧边栏文件
const sidebar: Record<string, any> = {
  '/guide/': [
    {
      text: '关于本站',
      items: [
        { text: '如何使用本站学习', link: '/guide/how-to-use' },
        { text: '完整学习路线', link: '/guide/roadmap' }
      ]
    }
  ]
}
for (const domain of DOMAINS) {
  sidebar[`/${domain.dir}/`] = sidebarByDomain[domain.dir]
}

export default defineConfig({
  lang: 'zh-CN',
  title: '全栈学习手册',
  description:
    '面向个人自学者的中文全栈开发知识库：HTML、CSS、TypeScript、Vue 3、Node.js + Fastify、PostgreSQL、Linux、Docker 与部署。',

  // 保持默认 false：产物为 .html 文件，任何静态服务器（含机顶盒）都能直接托管，
  // 不需要 Nginx 额外配置 try_files 重写。
  cleanUrls: false,

  // README.md 是仓库说明；TASK-HANDOFF.md 是交接记录；scripts/ 是本地工具——都不作为站点页面
  // docs/ 下两篇是**只给维护者看**的发布前清单与部署说明：文件保留在源码里，
  // 但不构建成公开页面（学习者需要的启动步骤已经写在 guide/how-to-use.md）。
  // 逐文件列出而不是写 'docs/**'，是为了让「新增一篇维护文档会不会被公开」这件事
  // 必须在这里显式改一行才能决定，不会因为目录约定而悄悄发布。
  srcExclude: [
    'README.md',
    'TASK-HANDOFF.md',
    'scripts/**',
    '**/_*.md',
    'docs/deployment.md',
    'docs/project-file-inventory.md'
  ],

  lastUpdated: true,

  head: [
    ['meta', { name: 'theme-color', content: '#3e63dd' }],
    ['meta', { name: 'author', content: 'learns' }]
  ],

  themeConfig: {
    // 顶部导航：领域较多，按分组折叠为下拉菜单
    nav: [
      { text: '学习路线', link: '/guide/roadmap', activeMatch: '/guide/' },
      {
        text: '前端',
        items: DOMAINS.filter((d) => d.group === 'frontend').map((d) => ({
          text: d.short,
          link: `/${d.dir}/`
        }))
      },
      {
        text: '后端与数据',
        items: DOMAINS.filter((d) => d.group === 'backend').map((d) => ({
          text: d.short,
          link: `/${d.dir}/`
        }))
      },
      {
        text: '系统与工程',
        items: DOMAINS.filter((d) => d.group === 'system').map((d) => ({
          text: d.short,
          link: `/${d.dir}/`
        }))
      },
      {
        text: '专题',
        items: DOMAINS.filter((d) => d.group === 'topic').map((d) => ({
          text: d.short,
          link: `/${d.dir}/`
        }))
      }
    ],

    sidebar,

    // 本地搜索（不依赖 Algolia 等外部服务，离线也可用），配中文分词
    search: {
      provider: 'local',
      options: {
        detailedView: true,
        miniSearch: {
          // 索引侧：单字 + 相邻双字，保证召回
          options: {
            tokenize,
            processTerm: (term: string) => term.toLowerCase()
          },
          // 查询侧：不重叠双字 + AND，保证精度（详见 queryTokenize 的注释）
          searchOptions: {
            tokenize: queryTokenize,
            combineWith: 'AND',
            prefix: true
          }
        },
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: {
            displayDetails: '显示详细结果',
            resetButtonTitle: '重置',
            backButtonTitle: '返回',
            noResultsText: '没有找到相关结果',
            footer: {
              selectText: '选择',
              selectKeyAriaLabel: '选择',
              navigateText: '切换',
              navigateUpKeyAriaLabel: '向上',
              navigateDownKeyAriaLabel: '向下',
              closeText: '关闭',
              closeKeyAriaLabel: '关闭'
            }
          }
        }
      }
    },

    outline: {
      level: [2, 3],
      label: '本页目录'
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },

    lastUpdatedText: '最后更新',

    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',

    externalLinkIcon: true,

    notFound: {
      title: '页面不存在',
      quote: '这个链接可能已经失效，或者内容还没写到这里。',
      linkLabel: '返回首页',
      linkText: '返回首页'
    },

    footer: {
      message: '个人本地学习用途 · 内容为中文原创讲解，引用资料均指向官方文档',
      copyright: '不转载任何第三方教程正文'
    }
  }
})
