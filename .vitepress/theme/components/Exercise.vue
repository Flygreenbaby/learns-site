<script setup lang="ts">
import { ref } from 'vue'

/**
 * 练习组件：题干常驻显示，答案与解析默认折叠。
 *
 * 在 Markdown 中的用法（注意组件标签与内容之间必须留空行，
 * 否则 markdown-it 会把内容当成 HTML 块而不解析 Markdown）：
 *
 * <Exercise title="练习 1 · 语义化标题层级" difficulty="基础">
 *
 * 题干正文，支持 **Markdown** 与代码块。
 *
 * <template #answer>
 *
 * 答案与解析，同样支持 Markdown。
 *
 * </template>
 * </Exercise>
 */

withDefaults(
  defineProps<{
    /** 练习标题，通常形如「练习 1 · xxx」 */
    title?: string
    /** 难度标签：基础 / 进阶 / 挑战 */
    difficulty?: '基础' | '进阶' | '挑战' | string
    /** 是否默认展开答案 */
    open?: boolean
  }>(),
  {
    title: '练习',
    difficulty: '基础',
    open: false
  }
)

const expanded = ref<boolean>(false)

function toggle() {
  expanded.value = !expanded.value
}
</script>

<template>
  <section class="exercise" :class="`is-${difficulty}`">
    <header class="exercise__head">
      <span class="exercise__badge">练习</span>
      <h4 class="exercise__title">{{ title }}</h4>
      <span class="exercise__difficulty">{{ difficulty }}</span>
    </header>

    <div class="exercise__body">
      <slot />
    </div>

    <div class="exercise__answer">
      <button
        type="button"
        class="exercise__toggle"
        :aria-expanded="open || expanded"
        @click="toggle"
      >
        <span aria-hidden="true">{{ open || expanded ? '▾' : '▸' }}</span>
        {{ open || expanded ? '收起答案与解析' : '查看答案与解析' }}
      </button>

      <div v-show="open || expanded" class="exercise__answer-body">
        <slot name="answer">
          <p class="exercise__empty">（本篇暂未提供答案解析）</p>
        </slot>
      </div>
    </div>
  </section>
</template>

<style scoped>
.exercise {
  margin: 28px 0;
  border: 1px solid var(--vp-c-divider);
  border-left: 3px solid var(--vp-c-brand-1);
  border-radius: 8px;
  background-color: var(--vp-c-bg-soft);
  overflow: hidden;
}

.exercise__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--vp-c-divider);
  background-color: var(--vp-c-bg-mute);
}

.exercise__badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 4px;
  background-color: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
}

.exercise__title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

.exercise__difficulty {
  flex-shrink: 0;
  color: var(--vp-c-text-3);
  font-size: 12px;
}

.exercise__body {
  padding: 4px 16px 12px;
}

/* 组件内 Markdown 渲染的首尾元素去掉多余外边距 */
.exercise__body :deep(> :first-child) {
  margin-top: 12px;
}

.exercise__body :deep(> :last-child) {
  margin-bottom: 4px;
}

.exercise__answer {
  border-top: 1px dashed var(--vp-c-divider);
}

.exercise__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 9px 16px;
  border: 0;
  background-color: transparent;
  color: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s;
}

.exercise__toggle:hover {
  background-color: var(--vp-c-bg-mute);
}

.exercise__answer-body {
  padding: 0 16px 12px;
}

.exercise__answer-body :deep(> :first-child) {
  margin-top: 4px;
}

.exercise__empty {
  color: var(--vp-c-text-3);
  font-size: 13px;
}
</style>
