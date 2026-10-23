<script setup lang="ts">
/**
 * 提示框。VitePress 自带 ::: tip / ::: warning / ::: danger 容器，
 * 但它们无法带自定义标题图标语义，且不便在组件内复用。
 * 这里补一个用于标注「未经运行验证」「版本适用范围」「常见错误」等状态的提示框。
 *
 * ⚠ 在 Markdown 中使用时，组件标签与内容之间**必须留空行**：
 *
 * <Callout type="warn" title="标题">
 *
 * 正文，支持 **Markdown**、`行内代码` 与代码块。
 *
 * </Callout>
 *
 * 原因：markdown-it 的 HTML 块规则（type 7）会把「自定义开标签所在行」到
 * 「第一个空行」之间的内容整体当作原始 HTML，不做任何 Markdown 解析。
 * 不留空行会导致两个真实故障（本项目踩过）：
 * 1. 反引号不生效，页面上直接显示出 ` 字符；
 * 2. 行内代码里的 `<table>`、`<td>` 等被当成真标签泄漏进 Vue 模板，
 *    构建时报 `[vite:vue] Element is missing end tag.`，
 *    而且报错的行列号是**生成后模板**的坐标，跟 .md 源文件对不上，极难定位。
 *
 * 另外：title 属性里不要写反引号或尖括号（属性值不会被 Markdown 处理，
 * 反引号会原样显示，尖括号则可能让 Vue 的模板解析器报错）。
 */
withDefaults(
  defineProps<{
    type?: 'info' | 'warn' | 'danger' | 'verified' | 'unverified'
    title?: string
  }>(),
  { type: 'info', title: '' }
)

const defaults: Record<string, string> = {
  info: '说明',
  warn: '注意',
  danger: '警告',
  verified: '已验证',
  unverified: '未经运行验证'
}
</script>

<template>
  <div class="callout" :class="`is-${type}`">
    <p class="callout__title">{{ title || defaults[type] }}</p>
    <div class="callout__body"><slot /></div>
  </div>
</template>

<style scoped>
.callout {
  margin: 20px 0;
  padding: 12px 16px;
  border: 1px solid var(--vp-c-divider);
  border-left-width: 3px;
  border-radius: 6px;
  background-color: var(--vp-c-bg-soft);
}

.callout__title {
  margin: 0 0 6px !important;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.5;
}

.callout__body {
  font-size: 14px;
}

.callout__body :deep(> :first-child) {
  margin-top: 0;
}

.callout__body :deep(> :last-child) {
  margin-bottom: 0;
}

.callout__body :deep(p) {
  margin: 6px 0;
}

.is-info {
  border-left-color: var(--vp-c-brand-1);
}
.is-info .callout__title {
  color: var(--vp-c-brand-1);
}

.is-warn {
  border-left-color: var(--vp-c-yellow-1);
  background-color: var(--vp-c-yellow-soft);
}
.is-warn .callout__title {
  color: var(--vp-c-yellow-1);
}

.is-danger {
  border-left-color: var(--vp-c-red-1);
  background-color: var(--vp-c-red-soft);
}
.is-danger .callout__title {
  color: var(--vp-c-red-1);
}

.is-verified {
  border-left-color: var(--vp-c-green-1);
  background-color: var(--vp-c-green-soft);
}
.is-verified .callout__title {
  color: var(--vp-c-green-1);
}

.is-unverified {
  border-left-color: var(--vp-c-text-3);
}
.is-unverified .callout__title {
  color: var(--vp-c-text-2);
}
</style>
