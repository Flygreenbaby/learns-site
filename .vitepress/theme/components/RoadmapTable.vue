<script setup lang="ts">
import { DOMAINS, PHASE_LABEL, STATUS_LABEL } from '../../domains'

/**
 * 学习路线总表：按分期列出所有领域、前置依赖与当前建设状态。
 * 数据同样来自 domains.ts，保证与首页、导航一致。
 */

const phases = [1, 2, 3, 0] as const

function titleOf(dir: string): string {
  return DOMAINS.find((d) => d.dir === dir)?.short ?? dir
}
</script>

<template>
  <div class="roadmap">
    <section v-for="phase in phases" :key="phase" class="roadmap__phase">
      <h3>{{ PHASE_LABEL[phase] }}</h3>
      <table>
        <thead>
          <tr>
            <th>领域</th>
            <th>前置依赖</th>
            <th>建设状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in DOMAINS.filter((x) => x.phase === phase)" :key="d.dir">
            <td>
              <a :href="`/${d.dir}/`">{{ d.title }}</a>
            </td>
            <td>
              <template v-if="d.prerequisites.length">
                <span v-for="(p, i) in d.prerequisites" :key="p">
                  <a :href="`/${p}/`">{{ titleOf(p) }}</a
                  ><span v-if="i < d.prerequisites.length - 1">、</span>
                </span>
              </template>
              <span v-else class="roadmap__none">无</span>
            </td>
            <td>
              <span class="roadmap__status" :data-status="d.status">
                {{ STATUS_LABEL[d.status] }}
              </span>
              <span v-if="d.statusNote" class="roadmap__note">{{ d.statusNote }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.roadmap__phase {
  margin: 28px 0;
}

.roadmap__phase h3 {
  margin: 0 0 10px !important;
  border: 0 !important;
  padding: 0 !important;
  font-size: 16px;
}

.roadmap__phase table {
  font-size: 14px;
}

.roadmap__none {
  color: var(--vp-c-text-3);
}

.roadmap__status {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 12px;
  background-color: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}

.roadmap__status[data-status='ready'] {
  background-color: var(--vp-c-green-soft);
  color: var(--vp-c-green-1);
}

.roadmap__status[data-status='partial'] {
  background-color: var(--vp-c-yellow-soft);
  color: var(--vp-c-yellow-1);
}

.roadmap__note {
  margin-left: 6px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
</style>
