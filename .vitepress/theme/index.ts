import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Exercise from './components/Exercise.vue'
import StatusBadge from './components/StatusBadge.vue'
import Callout from './components/Callout.vue'
import HomeDomains from './components/HomeDomains.vue'
import RoadmapTable from './components/RoadmapTable.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // 注册为全局组件，Markdown 中可直接使用 <Exercise>、<StatusBadge>、<Callout> 等
    app.component('Exercise', Exercise)
    app.component('StatusBadge', StatusBadge)
    app.component('Callout', Callout)
    app.component('HomeDomains', HomeDomains)
    app.component('RoadmapTable', RoadmapTable)
  }
} satisfies Theme
