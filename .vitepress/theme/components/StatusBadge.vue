<script setup lang="ts">
/**
 * 领域建设状态标签。用于各领域首页，如实标注内容完成度，
 * 避免用空目录冒充已完成的课程。
 */
withDefaults(
  defineProps<{
    /** ready = 可连续学习；partial = 部分完成；planned = 已规划未开始 */
    state?: 'ready' | 'partial' | 'planned'
    /** 补充说明，例如「已完成 4 / 共 10 章」 */
    note?: string
  }>(),
  {
    state: 'planned',
    note: ''
  }
)

const labels: Record<string, string> = {
  ready: '可连续学习',
  partial: '部分完成',
  planned: '已规划 · 未开始'
}
</script>

<template>
  <p class="status" :class="`is-${state}`">
    <span class="status__dot" aria-hidden="true"></span>
    <strong>建设状态：{{ labels[state] }}</strong>
    <span v-if="note" class="status__note">{{ note }}</span>
  </p>
</template>

<style scoped>
.status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 16px 0 !important;
  padding: 10px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background-color: var(--vp-c-bg-soft);
  font-size: 13px;
  line-height: 1.5;
}

.status__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--vp-c-text-3);
}

.status.is-ready .status__dot {
  background-color: var(--vp-c-green-1);
}

.status.is-partial .status__dot {
  background-color: var(--vp-c-yellow-1);
}

.status.is-planned .status__dot {
  background-color: var(--vp-c-text-3);
}

.status__note {
  color: var(--vp-c-text-2);
}
</style>
