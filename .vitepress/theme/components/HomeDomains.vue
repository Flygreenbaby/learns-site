<script setup lang="ts">
import { computed } from 'vue'
import {
  DOMAINS,
  GROUP_LABEL,
  PHASE_LABEL,
  STATUS_LABEL,
  type DomainGroup
} from '../../domains'

/**
 * 首页领域导航卡片。
 * 数据直接来自 .vitepress/domains.ts，新增领域只需改一处。
 */

const groups = computed(() => {
  const order: DomainGroup[] = ['frontend', 'backend', 'system', 'topic']
  return order.map((group) => ({
    group,
    label: GROUP_LABEL[group],
    items: DOMAINS.filter((d) => d.group === group)
  })).filter((g) => g.items.length > 0)
})
</script>

<template>
  <div class="domains">
    <section v-for="group in groups" :key="group.group" class="domains__group">
      <h2 class="domains__group-title">{{ group.label }}</h2>
      <div class="domains__grid">
        <a
          v-for="d in group.items"
          :key="d.dir"
          class="card"
          :class="`is-${d.status}`"
          :href="`/${d.dir}/`"
        >
          <div class="card__top">
            <span class="card__title">{{ d.title }}</span>
            <span class="card__status" :data-status="d.status">
              {{ STATUS_LABEL[d.status] }}
            </span>
          </div>
          <p class="card__summary">{{ d.summary }}</p>
          <div class="card__meta">
            <span>{{ PHASE_LABEL[d.phase] }}</span>
            <span v-if="d.statusNote" class="card__note">{{ d.statusNote }}</span>
          </div>
        </a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.domains {
  max-width: 1152px;
  margin: 0 auto;
  padding: 24px 24px 64px;
}

.domains__group {
  margin-top: 40px;
}

.domains__group-title {
  margin: 0 0 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 18px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.domains__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background-color: var(--vp-c-bg-soft);
  text-decoration: none;
  transition:
    border-color 0.2s,
    transform 0.2s,
    box-shadow 0.2s;
}

.card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
}

.card.is-planned {
  opacity: 0.92;
}

.card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.card__status {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.7;
  background-color: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}

.card__status[data-status='ready'] {
  background-color: var(--vp-c-green-soft);
  color: var(--vp-c-green-1);
}

.card__status[data-status='partial'] {
  background-color: var(--vp-c-yellow-soft);
  color: var(--vp-c-yellow-1);
}

.card__summary {
  flex: 1 1 auto;
  margin: 0;
  font-size: 13px;
  line-height: 1.75;
  color: var(--vp-c-text-2);
}

.card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

/* 状态补充说明（来自 domains.ts 的 statusNote），靠右与分期标签分开 */
.card__note {
  margin-left: auto;
  text-align: right;
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .domains {
    padding: 16px 20px 48px;
  }

  .domains__grid {
    grid-template-columns: 1fr;
  }
}
</style>
