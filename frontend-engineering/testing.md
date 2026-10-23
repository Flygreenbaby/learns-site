# 测试体系：单元、组件与端到端各自拦得住什么事故

你重构了 [组合式 API 那一章](/vue/composables)写出来的 `useTodoFilter`，把「只看未完成」的判定从 `t.done === false` 改成 `!t.done`，顺手把归档过滤的边界也从 `<` 挪成 `<=`。本地跑了三下，看起来都对，合并。两周后有用户说「我的任务不见了」——不是数据丢了，是归档时间恰好落在边界上的那批任务被两个筛选条件同时排除，列表里永远不出现。这类 bug 有个共同特征：**它不报错、不白屏、控制台干净，只是结果是错的。** 没有任何运行时会替你发现它，只有「给定输入、断言输出」这一种办法能拦住，而它只需要一个十行的测试。

第二种故事更常见，也更该引以为戒。有人（可能就是三个月前的你）为了「有测试覆盖率」，给每个组件加了一个快照测试，一共四十个。第一次改样式，`npm run test` 红了二十三条，报错里全是 `<div class="card">` 变成了 `<div class="card card--compact">`。评审的人说「这是预期改动」，于是大家学会了一条命令：`vitest -u`。三个月后这套测试的通过率永远是 100%，而它已经拦不住任何东西了。**更糟的是它开始制造工作量**：每次 PR 的 diff 里都有几十行快照变化要人「确认」，而没有人真的在看。终于某次清理依赖时有人问「这些测试有必要留吗」，全删。**覆盖率数字换来的是一份会让人养成「按下通过」习惯的资产。**

第三种是端到端测试的崩坏方式。写了十二个 Playwright 用例，定位器长这样：`.page-root > .toolbar > div:nth-child(3) > button`。有一天把工具栏里两个按钮换了个位置，十二个用例同时红，其中八个只是位置变了、功能一点没坏。修了一整天。剩下那个用例每二十次红一次，负责的人说「网络抖动吧」，于是给它加了 `page.waitForTimeout(2000)`——**从此它不再测任何东西，只是在等。** 不稳定的端到端测试比没有测试更糟，因为它教会整个团队「红了不用管」。

三种故事对应三个不同的问题：**逻辑对不对（单元）、组件的行为对不对（组件）、整条流程走得通吗（端到端）**。它们拦的事故种类、失败时的可信度、维护成本完全不同。这一章要给你的不是「大厂那套金字塔」，而是一个人在维护的项目里**能活下来**的最低限度测试。

## 测试金字塔在个人项目里的真实形状

教科书版本是「大量单元测试 + 适量集成测试 + 少量端到端」，那是一个有专职 QA、有测试团队、有几百个开发者的组织画出来的比例。**个人项目不要照搬**，因为你的约束完全不同：没有人替你维护测试、你写测试的动机只会在「刚被 bug 咬过」时出现、而任何需要维护成本的测试最终都会被删掉。

真实的形状是**一个哑铃，两头重、中间薄**：

| 层 | 个人项目该有多少 | 写在哪 | 跑多久 | 拦得住的事故 | 失败时的可信度 |
| --- | --- | --- | --- | --- | --- |
| 纯逻辑单元测试 | **最多**，全部集中在有判断的地方 | `*.test.ts`（Vitest，node 环境） | 毫秒级 | 边界值、筛选/排序/日期计算、金额与状态机 | **最高**：红了几乎一定是代码错 |
| 组件行为测试 | **2–5 个**，只测有交互的组件 | `*.test.ts`（Vitest + `@vue/test-utils`，jsdom/happy-dom） | 几十毫秒 | props 与渲染结果不匹配、事件没 emit、异步状态没回落 | 高 |
| 快照测试 | **0**，除非你清楚自己在换什么 | — | — | 意外的结构大幅变动 | **低**：它把「改动」和「错误」混成同一条报错 |
| 端到端测试 | **3 条**，只覆盖最不能坏的主流程 | `e2e/*.spec.ts`（Playwright） | 秒级到十几秒 | 路由与鉴权、URL 状态同步、写操作真的落库、部署后的环境差异 | 中高（取决于定位器写法） |

三条取舍理由，比图更重要：

**第一，单元测试为什么最多：它是唯一「便宜到可以随手写」的一层。** 一个纯函数测试不需要 DOM、不需要浏览器、不需要 mock 网络，跑一次几毫秒，且失败信息直接指向一行代码。而你的项目里最容易出「静默错误」的正是这些纯逻辑——[Vue 第 12 章的项目](/vue/project) 里是筛选、排序、日期计算，不是模板。

**第二，快照为什么建议不写。** 快照的断言对象是「序列化后的结构一模一样」，而 Vue 组件的渲染结构恰恰是你最常合理修改的东西。它的信噪比在你重构时会迅速恶化，而信噪比恶化的测试会被删掉——**不如一开始就不建立这一层。** 如果你确实要防「组件被改得面目全非」，用组件行为测试（断言可见文本与关键属性）比快照便宜得多、报错也精确得多。

**第三，端到端为什么只写三条。** 端到端测的是「装配对不对」：路由配置、鉴权、环境变量注入、真实接口、构建产物 + 服务器（这一层能抓住第 7 章那个缓存事故，单元测试抓不到）。它慢、脆、调试成本高，所以只配用在「这条流程挂了整个产品就不能用」的地方。

## Vitest 与 Vite 共用一套配置

Vitest 的主要优势就是这件事：它复用你 [第 3 章](/frontend-engineering/vite-dev) 已经配好的 Vite 转换管线，所以 `.vue` 单文件组件、TS、路径别名（`@/`）在测试里直接就能用，不需要再维护一套独立配置。

```ts
// vitest.config.ts
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // node = 纯逻辑；组件测试需要 DOM，用 jsdom 或 happy-dom（两者都要单独装依赖）
    environment: 'node',
    // 关掉某条测试后自动 restore 的能力会导致用例互相污染，建议开
    restoreMocks: true,
    include: ['src/**/*.test.ts'],
  },
})
```

脚本分层（名字与下面「CI 里怎么分层跑」对齐）：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run --include 'src/**/*.test.ts'",
    "test:e2e": "playwright test"
  }
}
```

`vitest` 不带参数是 watch 模式，`vitest run` 才是跑一次就退出——CI 里必须用后者，否则流水线会永远不结束。组件测试与纯逻辑测试想跑在不同环境，常见做法是给组件测试文件单独加注释声明环境，或者拆两个 project 配置；具体机制以 [Vitest 配置文档](https://vitest.dev/config/) 当前版本为准。

## 单元测试：断言选对，比多写十条重要

拿 [第 12 章项目](/vue/project) 里那个筛选 composable 做例子。被测对象是一个纯逻辑：给定任务列表和筛选条件，返回该显示哪些。

```ts
// src/composables/useTodoFilter.test.ts
import { describe, expect, it } from 'vitest'
import { filterTodos } from './filterTodos'

const t = (id: number, done: boolean, archivedAt: number | null) => ({
  id,
  title: `任务 ${id}`,
  done,
  archivedAt,
})

describe('filterTodos', () => {
  it('active 排除已完成与已归档', () => {
    const list = [t(1, false, null), t(2, true, null), t(3, false, 1000)]
    expect(filterTodos(list, 'active')).toEqual([list[0]])
  })

  it('边界：archivedAt 恰好等于阈值时不应被算作未归档', () => {
    const list = [t(1, false, 999), t(2, false, 1000)]
    expect(filterTodos(list, 'active', { archiveBefore: 1000 })).toEqual([list[0]])
  })

  it('空列表返回空数组而不是 undefined', () => {
    expect(filterTodos([], 'active')).toEqual([])
  })

  it('未知筛选条件抛错，而不是静默返回全部', () => {
    expect(() => filterTodos([], 'nope' as never)).toThrow(/Unknown filter/)
  })
})
```

四个断言的选择理由，比测试本身更值得记：

| 你想验的事 | 用 | 别用 | 为什么 |
| --- | --- | --- | --- |
| 原始值、同一引用、布尔 | `toBe` | `toEqual` | `toBe` 是 `Object.is`，不会偷偷做深比较 |
| 数组/对象的内容 | `toEqual` | `toStrictEqual` | `toEqual` 忽略 `undefined` 属性与类实例身份；要严格到「多一个 `undefined` 字段也算错」才用 `toStrictEqual` |
| 只关心部分字段 | `toMatchObject` | 手写解构比较 | 报错只打印差异子集 |
| 浮点（金额、比例、耗时） | `toBeCloseTo` | `toBe` | `0.1 + 0.2` 不等于 `0.3`，这类测试会在某个无关改动后莫名变红 |
| 异步/被拒绝的 Promise | `await expect(p).resolves.toEqual(...)` / `.rejects.toThrow(...)` | try/catch 里断言 | 忘了 `await` 时断言根本不会被执行，测试**假绿** |
| 回调是否被调用与入参 | `toHaveBeenCalled` / `toHaveBeenCalledWith` | 手动记 flag | 后者等于你自己写一遍实现来测实现 |

**单元测试的选题标准只有一条：这个判断如果错了，用户会不会拿到一个「看起来正常但是错」的结果？** 会 → 测。不会（比如一个只负责把 class 拼起来的辅助函数）→ 别测，那是模板的事。**不要为了覆盖率写测试：覆盖率是「哪些地方还没测到」的提示器，不是一个可以交付的目标数字。**

## mock 有三层，代价完全不同

| 手段 | 适用 | 代价 |
| --- | --- | --- |
| **依赖注入**（把函数/客户端当参数传进来，测试时传 `vi.fn()`） | 首选。你写的 composable/服务应接受一个 `fetcher` 之类的入参 | 几乎为零：测试与被测实现的耦合最松，且不需要任何框架魔法 |
| `vi.spyOn(obj, 'method')` | 替换**已有对象上的方法**（`console.log`、store 的 action、某个 client 实例的方法） | 只能作用于「对象上的属性」。**ES 模块的命名导出是只读绑定，不能直接 spy 另一个模块导出的函数**；`restoreMocks: true` 才能自动还原 |
| `vi.mock('模块路径', 工厂)` | 只有边界才用：网络层、时间、文件系统、第三方 SDK | **代价最高**，见下面四条 |

`vi.mock` 的四条代价必须写清楚，因为它是新手最容易滥用的 API：

**① 它会被提升（hoist）到文件顶部。** Vitest 把 `vi.mock` 调用挪到所有 import 之前执行，所以你写在模块顶层的变量在工厂函数里访问不到——预期报错大致是「在初始化之前被访问」那一类（`Cannot access '...' before initialization`），确切措辞随版本变化。**解法是 `vi.hoisted()`**：把需要共享的值放进它返回的对象里。这条约束本身就是「mock 有摩擦成本」的证据。

**② 工厂必须覆盖被测模块用到的所有导出。** 你写 `vi.mock('./api', () => ({ fetchUser: vi.fn() }))`，而组件里还 import 了 `deleteUser`，那个名字就是 `undefined`，报错发生在 import 或调用时，而信息不会告诉你「你少 mock 了一个」。Vitest 提供 `importOriginal` 做部分替换（保留真实实现、只换其中一两个），比手写全量工厂安全得多。

**③ mock 之后，实现改了它不会红。** 这是最本质的代价：你的测试从此验证的是「你写的那个假对象的行为」，而不是真实模块的行为。真实 `fetchUser` 哪天把返回结构从 `{ data }` 改成直接返回数组，你的 mock 依然是旧结构，**测试一路绿，线上炸**。用得越多，你的绿色可信度越低。

**④ 同一个 mock 实例跨用例共享。** 工厂只执行一次，于是第一个 `it` 里 `mockResolvedValue` 设的值会漏到第二个 `it`。要么每条用例显式重置（`mockClear` / `mockReset`），要么靠 `restoreMocks` / `clearMocks` 配置。

<Callout type="unverified" title="上面四条里的报错措辞本章未在本机复现">

四条代价里，②③④ 是机制层面的结论（可从 mock 的工作原理直接推出，不依赖具体报错文本）；① 提到的报错句式、以及本章「常见错误与排查」第 3、5 条里的报错形态，**都是预期措辞，不是抄自实际运行输出**——写作当天对 vitest.dev 的直连抓取失败，本机也没有装 Vitest。你自己踩到时以终端原文为准，机制解释仍然成立。动手前先核对 [Vitest 的 Mocking 指南](https://vitest.dev/guide/mocking)。

</Callout>

一条纪律：**`vi.mock` 只用于真正的系统边界。** 如果你的单元测试里 mock 了自己项目的三个模块，那不是单元测试，那是一份和实现平行维护的假象。

## 组件测试：为什么测行为而不是测快照

组件测试的对象是「给定 props 与一次用户操作，界面呈现什么、向外发出什么」。这两件事是**对外契约**，重构内部实现（把 `computed` 拆成两个、把 `for` 换成 `map`）不该让它们变。而快照断言的是渲染结构，任何一次合理的 class 调整都会让它红——**这就是脆弱测试的定义：改动正确时也失败。**

```vue
<!-- src/components/TodoItem.vue：被测组件 -->
<script setup>
import { ref } from 'vue'
const props = defineProps({ todo: { type: Object, required: true } })
const emit = defineEmits(['toggle', 'remove'])
const confirmOpen = ref(false)

function onRemove() {
  if (!confirmOpen.value) {
    confirmOpen.value = true
    return
  }
  emit('remove', props.todo.id)
}
</script>

<template>
  <li>
    <input type="checkbox" :checked="props.todo.done" @change="emit('toggle', props.todo.id)">
    <span>{{ props.todo.title }}</span>
    <button @click="onRemove">删除</button>
    <p v-if="confirmOpen">再点一次确认删除</p>
  </li>
</template>
```

```ts
// src/components/TodoItem.test.ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TodoItem from './TodoItem.vue'

const todo = { id: 7, title: '写第 9 章', done: false }

describe('TodoItem', () => {
  it('已完成的任务复选框是勾选状态', () => {
    const wrapper = mount(TodoItem, { props: { todo: { ...todo, done: true } } })
    // 断言的是「用户看到的属性」，不是内部 data
    expect(wrapper.get('input[type="checkbox"]').element.checked).toBe(true)
  })

  it('点一次删除只是要求确认，不 emit remove', async () => {
    const wrapper = mount(TodoItem, { props: { todo } })
    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('remove')).toBeUndefined()
    expect(wrapper.text()).toContain('再点一次确认删除')
  })

  it('第二次点击才带 id emit remove', async () => {
    const wrapper = mount(TodoItem, { props: { todo } })
    const btn = wrapper.get('button')
    await btn.trigger('click')
    await btn.trigger('click')

    expect(wrapper.emitted('remove')).toEqual([[7]])
  })
})
```

`emitted()` 返回的是「每次调用的参数数组的数组」，所以断言写成 `toEqual([[7]])`——这一层形状是 VTU 最容易记错的地方。

这两份文件跑起来之后，**预期输出**长这样（**本章未在本机装 Vitest 跑过，下列是格式示例，数字与行序以你的实际运行为准**）：

```text
 ✓ src/composables/useTodoFilter.test.ts (4 tests) 9ms
 ✓ src/components/TodoItem.test.ts (3 tests) 41ms

 Test Files  2 passed (2)
      Tests  7 passed (7)
   Start at  10:24:31
   Duration  1.36s (transform 188ms, setup 0ms, collect 312ms, tests 50ms)
```

读这份输出的三个要点：`✓` 后面的**括号里是用例数**，如果它比你在文件里写的 `it` 少，说明有用例没被收集（文件名不匹配 `include`、或者被 `it.skip` 掉了）；`Duration` 里 `transform` 那一段是编译 `.vue` 的成本，组件测试多了它会明显上升；**全绿不代表断言执行过**——`async` 用例里漏掉 `await` 时，Vitest 只会认为这个测试同步就结束了，照样打勾。这是本章「假绿」的头号来源。

三条写法规矩：

- **用 `wrapper.get(...)` / `find(...)` 而不是 `wrapper.vm.xxx`。** `vm` 能让你读组件内部状态，读得到反而说明你在测实现细节；一旦重构，测试红而功能没坏。**断言只写在 DOM 文本、可观察属性（`checked`、`disabled`、`aria-*`）和 `emitted` 这三处。**
- **异步之后要等一个 tick。** `trigger` / `setValue` 返回 Promise，但 Vue 的更新是异步批处理的；组件里若有 `await`（例如提交表单后把 `loading` 置回 false），一个 tick 可能不够，需要 `await nextTick()` 再来一次，或用 `flushPromises()` 这类工具把微任务队列清空。漏掉这一等，症状是「断言拿到旧值」，然后有人误以为组件有 bug。
- **`shallowMount` 用来隔离子组件。** 当被测组件里嵌了一个复杂表格而你只想测外壳，`shallowMount` 会把子组件替换成桩；需要真实协作就用 `mount`。**如果你发现需要 mock 掉子组件才能测外壳，通常说明组件拆得不对**，先考虑把逻辑提到 composable 里用单元测试测（回到哑铃左边）。

## `@vue/test-utils` 与 testing-library：两种切入角度

| | `@vue/test-utils`（VTU） | `@testing-library/vue` 一类 |
| --- | --- | --- |
| 给你什么 | 一个 `wrapper`：`mount` 的返回值，能查 DOM、读 `emitted`、访问 `vm` 实例、`setValue` 表单、`trigger` 事件 | `render()` 返回一组**查询器**（按角色/标签/文本找元素）+ `fireEvent` / `userEvent` |
| 视角 | 框架内部视角起步，可以「往下钻」到组件实例 | 强制用户视角：只能通过屏幕上看到的东西操作与断言 |
| 独有能力 | 测 `provide`/`inject`、插槽、指令、过渡、`global.stubs`、pinia/router 插件注入 | 查询器优先走可访问性语义，天然逼你写正确的 `role` / `label` |
| 风险 | 因为能用 `wrapper.vm`，很容易写成测内部状态 | 读不到 setup 内部值（这正是它的设计意图）；接 Vue 生态不如 VTU 顺 |
| 本站建议 | **主用 VTU**（Vue 官方维护、能装配插件），但把断言限制在 DOM 与 `emitted` 层，等于用 VTU 的壳遵守 testing-library 的纪律 | 你已经在 React 项目里熟悉它、想统一写法时再选 |

一句话概括差别：**VTU 问「这个组件实例做了什么」，testing-library 问「用户看到了什么」。** 后者的问题更好，因为组件被重写时用户看到的东西不变。而你也可以在 VTU 里只问后者——这是本章推荐的组合。

## 端到端：Playwright 只覆盖那三条最不能坏的

个人项目里值得端到端测的流程，判据是「这条挂了，产品对用户就不存在了」：

1. **写操作真的生效**：新增一条待办 → 列表里出现 → 刷新页面还在（这一条同时覆盖前端表单、接口、持久化，是哑铃右边最值钱的用例）。
2. **状态与 URL 同步 / 深链**：切到「已完成」筛选，刷新或把地址发给别人，看到的仍是已完成视图；访问一个不存在的详情页，看到 404 而不是白屏。
3. **鉴权与路由守卫**：未登录访问受保护页被送到登录页；登录后回到原来那个页面。

```ts
// e2e/todo.spec.ts
import { expect, test } from '@playwright/test'

test('新增一条待办后列表出现该项，刷新后仍在', async ({ page }) => {
  await page.goto('/')

  // 定位器优先级：按角色 + 可访问名称
  await page.getByRole('textbox', { name: '新任务内容' }).fill('买咖啡豆')
  await page.getByRole('button', { name: '新增' }).click()

  await expect(page.getByRole('listitem').filter({ hasText: '买咖啡豆' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('listitem').filter({ hasText: '买咖啡豆' })).toBeVisible()
})

test('访问不存在的详情看到 404 而不是白屏', async ({ page }) => {
  await page.goto('/todos/not-exist')
  await expect(page.getByRole('heading', { name: /404|不存在/ })).toBeVisible()
  await expect(page.locator('#app')).not.toBeEmpty()
})
```

定位器的选择顺序是端到端测试能不能活下来的分水岭：

**`getByRole`（带可访问名称）> `getByLabel` / `getByPlaceholder` / `getByText` > `getByTestId`（`data-testid`）> CSS/XPath 结构选择器（不要用）。**

理由：角色名来自可访问性树，它改动的频率远低于 class 名和 DOM 层级；同时这条纪律会顺手逼你把 `label`、`aria-label` 写对——等于**端到端测试顺便替你做了无障碍检查**（回指 [JS 层面的无障碍与性能](/javascript/accessibility-and-performance)）。`data-testid` 是逃生通道，只用在「语义上无法唯一定位」的地方；把它当主力，你会得到一套「结构一改就红、而结构改动本来就是预期」的测试，那正是本章开头第二种故障。

另外两条纪律：

- **不要写 `waitForTimeout`。** Playwright 的 `expect(...)` 断言是「重试到超时为止」的 web-first 断言，`click()` / `fill()` 也会自动等待元素可操作。**手动 sleep 不会让测试变稳，只会让它慢且假绿**——它掩盖了「这一步其实有时真的没完成」。
- **失败时留证据。** 配置里开 trace（例如仅在重试时录），红了以后用 `playwright show-trace` 回放：截图、DOM 快照、网络、控制台全在里面。端到端最难的是「它红的时候不在你眼前」，trace 是唯一解药。

**端到端测的是「部署之后的那个东西」。** 所以它应该跑在真实构建产物 + 真实服务器上（`webServer` 配置起一个 preview 服务），而不是开发服务器。只跑 dev server 的端到端测试抓不到第 4 章的 `base` 路径问题、路由 history fallback 问题，也抓不到本章开头那类只在生产出现的缓存事故。

## CI 里怎么分层跑

原则：**快的每次跑，慢的少跑，最慢的定时跑。** 具体编排见 [/devops/ci-cd](/devops/ci-cd) 与 [/devops/testing](/devops/testing)，这里只讲前端这侧怎么切：

| 时机 | 跑什么 | 预期耗时 | 失败动作 |
| --- | --- | --- | --- |
| pre-commit（可选钩子，本地） | 类型检查 + lint | 秒级 | 拦在最前面；**不要在这里跑测试**，太慢会让人绕过钩子 |
| 每个 PR / 每次 push | `vitest run`（单元 + 组件） | 几秒到几十秒 | 阻断合并 |
| 合并到 main 之前 | 上面 + `playwright test`（端到端，跑在构建产物上） | 1–3 分钟 | 阻断发布 |
| 定时（每天/每周） | 端到端 + Lighthouse 体积预算（第 8 章） | 分钟级 | 只通知，不阻断 |

两条经验：

**分层跑的前提是分层可寻址。** 所以目录上就把两类测试分开（`src/**/*.test.ts` 与 `e2e/*.spec.ts`），脚本也分开（`test:unit` / `test:e2e`），`npm run test` 才只是两者的聚合。**如果 CI 每次都得跑全套，它就会因为太慢被人取消**——这不是猜测，是所有团队的默认结局。

**别在 CI 里装浏览器装不好就跳过端到端。** Playwright 需要单独下载浏览器（`playwright install`，CI 镜像里还要系统依赖）。如果这一步在流水线上失败，你的选择是「修好它」或者「明确知道 main 分支没有端到端保护」；把它静默跳过，等于给自己发了一张「有测试」的假证明。具体命令与镜像选择以 Playwright 官方 CI 文档为准。

## 测试到底在防什么事故：一张对照表

| 事故 | 单元测试 | 组件测试 | 端到端 | 类型检查 / lint |
| --- | --- | --- | --- | --- |
| 筛选边界写错，任务静默消失 | **拦住** | 可能 | 看运气 | 拦不住 |
| 表单提交后 `loading` 一直转（没回落） | — | **拦住** | 拦住 | 拦不住 |
| 事件 payload 结构变了，父组件收不到 | — | **拦住**（`emitted`） | 拦住 | 有时 |
| 部署到子路径后白屏（`base` 没配） | — | — | **只有它能拦** | 拦不住 |
| 发版后 HTML 被缓存、旧 chunk 404 | — | — | **只有它能拦**（第 7 章） | 拦不住 |
| 深链 404 页面本身坏了 | — | 拦住 | 拦住 | 拦不住 |
| 改了 props 类型忘了同步调用方 | — | — | — | **拦住**（[TypeScript 第 4 章](/typescript/objects-and-interfaces)） |
| 依赖漂移导致构建产物变坏 | — | — | 拦住 | 拦不住（那是第 2 章的锁文件） |
| 界面文案打错字 | — | 看断言写法 | 看断言写法 | 拦不住 |

**读这张表的正确方式：它告诉你「哪一类事故你目前完全没有防线」。** 一个只有单元测试的项目，对第 4、5 行那两类部署故障是零防护的；而一个只有端到端的项目，对第 1 行是零防护的——后者恰恰是最常见的 bug 来源。

## 常见错误与排查

1. **`vitest` 跑起来后 CI 永远不结束** —— 用了 watch 模式。确认：CI 日志里停在「waiting for file changes」。修：CI 用 `vitest run`；`test` 脚本写成 `vitest run`，把 watch 单独放一个 `test:watch`。
2. **测试文件里 import `.vue` 组件报「解析失败」或拿到空模块** —— 测试配置里没有 `@vitejs/plugin-vue`（或复用了没装插件的 vite 配置）。确认：同样的 import 在应用代码里能用、在测试里不能。修：`plugins: [vue()]`；并确认测试用的是哪份配置文件（`vitest.config.ts` 优先于 `vite.config.ts`）。
3. **组件测试报 `Cannot read properties of null` 或断言永远拿到旧值** —— 忘了 Vue 的更新是异步批处理，`trigger` 之后没等 tick。确认：把断言换成 `expect(true)` 后 `console.log(wrapper.html())`，看到的还是旧结构就是这个。修：`await` 事件方法；有网络/微任务时 `await nextTick()` 两次或用 `flushPromises()`。
4. **组件里 `useRouter` 报错（没有安装插件）** —— 用 `mount` 直接挂了一个依赖路由的组件。确认：报错指向 `inject` 返回 undefined。修：`mount(C, { global: { plugins: [router] } })`（真实路由用 `createRouter` + `memory` history）或 `global: { mocks: { $router: ... } }`；`provide` 同理用 `global.provide`。**具体选项对象形状以 VTU 文档为准**，不同主版本改过这块的写法。
5. **`vi.mock` 工厂里引用顶层变量，报「在初始化之前被访问」** —— `vi.mock` 被提升到所有 import 之前执行。确认：报错形如 `Cannot access '...' before initialization`。修：把共享值放进 `vi.hoisted()`；或者干脆重构成依赖注入，别 mock 模块。
6. **mock 了模块之后实现改了，测试仍然全绿，线上炸** —— 这是 `vi.mock` 的结构性代价，不是配置问题。确认：把 mock 工厂注释掉跑一次，红成一片就说明测试测的是假对象。修：缩小 mock 面（用 `importOriginal` 做部分替换）、对真实边界改用端到端覆盖、给 mock 工厂加一条「结构与真实实现一致」的独立断言（例如对真实模块的导出做一次形状检查）。
7. **端到端测试每二十次红一次** —— 十有八九是断言抢在异步完成之前，或者用了 `nth-child` 这类位置定位器、或者用例之间共享了同一条测试数据（上一个用例留下的状态）。确认：看 trace 里失败瞬间的截图与 DOM 快照——它是「还没出现」还是「出现了两个」。修：删掉所有 `waitForTimeout`，改用 web-first 断言；给每个用例自己造数据（API 直接建、或用唯一名称）；把定位器换成角色。
8. **快照测试每天红，团队开始无条件 `-u`** —— 断言对象（渲染结构）本来就是高频合理变动的东西。确认：看这些红的 diff 是不是每次都是预期改动。修：**删掉这层测试**，把每个快照换成一到两条行为断言（可见文本 + 关键属性 + `emitted`）。别指望「大家会更认真地看快照」，那条路走不通。
9. **测试跑过一次之后互相污染** —— 模块级 mock 实例被共享、`vi.spyOn` 没还原、fake timers 忘了关。确认：单独跑某个文件是绿的、整个目录一起跑就红（`vitest run path/to/one.test.ts` 对比）。修：开 `restoreMocks`（以及需要时 `clearMocks`）、`afterEach` 里 `vi.useRealTimers()`、每条用例显式设置自己的 mock 返回值。

## 练习

<Exercise title="练习 1 · 给一个纯逻辑函数补三条真会红的测试" difficulty="基础">

为 `src/composables/formatDate.ts`（输入一个时间戳与语言，输出中文相对时间：「刚刚」「5 分钟前」「昨天」「2026年3月14日」）写三条单元测试。**要求其中至少一条能在你把阈值从「60 分钟前算作分钟前」改成「120 分钟」时立刻变红。** 写出你的三条测试文件和每条断言的理由。

<template #answer>

```ts
import { describe, expect, it } from 'vitest'
import { formatDate } from './formatDate'

const MIN = 60_000
const now = 1_700_000_000_000   // 固定基准时刻，绝不用 Date.now()

describe('formatDate', () => {
  it('一分钟内算刚刚', () => {
    expect(formatDate(now - 30 * 1000, now, 'zh')).toBe('刚刚')
  })

  // 这一条是「边界哨兵」：它专门用来在阈值被改动时变红
  it('59 分钟前仍属分钟前，60 分钟前起属小时', () => {
    expect(formatDate(now - 59 * MIN, now, 'zh')).toBe('59 分钟前')
    expect(formatDate(now - 60 * MIN, now, 'zh')).toBe('1 小时前')
  })

  it('跨年走绝对日期，不出现「NaN年前」', () => {
    expect(formatDate(now - 400 * 24 * 60 * MIN, now, 'zh')).toBe('2023年10月4日')
  })
})
```

三条的理由：① **传基准时间进去**而不是让函数内部调 `Date.now()`——否则你需要 fake timers，测试变复杂且更脆。② 边界哨兵必须**同时断言阈值两侧**：只测一侧的话，把阈值从 60 改成 120 它仍然绿（那一侧的值还在新区间里），这正是大量「测了但没用」的测试的成因。改阈值到 120 时，`59 分钟前` 那条依然绿，但 `60 分钟前 → 1 小时前` 会红——**这就是这条测试存在的唯一目的。** ③ 第三条防的是「相对时间无限延伸」这类看起来正常但结果荒谬的输出（「3 年前」对用户没意义），这类问题只有你能想到就去断言它。

</template>

</Exercise>

<Exercise title="练习 2 · 把一段 `wrapper.vm` 断言改写成行为断言" difficulty="进阶">

下面这段测试能过，但它是坏味道。请指出三处问题并改写成只依赖「用户可见信息 + emit」的版本。

```ts
const wrapper = mount(SearchBox)
wrapper.vm.keyword = 'vite'
wrapper.vm.onSubmit()
expect(wrapper.vm.loading).toBe(false)
expect(wrapper.vm.results.length).toBe(3)
```

<template #answer>

三处问题：① **直接给内部状态赋值**（`wrapper.vm.keyword = 'vite'`）绕过了输入框这条真实路径，用户实际操作触发的逻辑（`v-model` 修饰符、`trim`、输入防抖）一点没测到；② **直接调用内部方法**（`onSubmit()`）绕过了点击/回车事件绑定，模板里的 `@submit.prevent` 写错也不会红；③ **断言内部字段**（`loading`、`results`）把测试和实现细节焊死：把 `results` 改名成 `items`、或把 `loading` 拆成 `pending`/`fetching`，功能没坏测试就红——这就是脆弱测试的定义。

改写版本：

```ts
const wrapper = mount(SearchBox, { props: { fetcher: fakeFetcher } })
const input = wrapper.get('input[type="search"]')

await input.setValue('vite')          // 走真实的 v-model 路径
await wrapper.get('button').trigger('click')

// 等待异步回落：这里可能需要在断言前再等一个 tick / flushPromises
expect(wrapper.find('.spinner').exists()).toBe(false)          // 用户不再看到加载中
expect(wrapper.findAll('li')).toHaveLength(3)                   // 用户看到三条结果
expect(wrapper.emitted('searched')).toEqual([[3]])              // 对外契约
expect(fakeFetcher).toHaveBeenCalledWith('vite')                // 参数真的传对了
```

注意 `fetcher` 是**通过 props 注入**的假实现，不是 `vi.mock` 掉的模块——代价从「与实现脱钩」变成「组件多一个入参」，后者是设计上的改善。把 `results.length` 换成 `findAll('li')`，测的是同一件事，但前者会在重构时红、后者不会。

</template>

</Exercise>

<Exercise title="练习 3 · 故意制造一个必然随机变红的快照测试并解释" difficulty="挑战">

给一个渲染当前时间的组件写一个快照测试，跑一次生成基线，再跑第二次。① 描述两次运行的结果与报错形态（重点：diff 里哪一行变了）；② 解释为什么这类失败让「`-u`」变成必然选择；③ 如果组件不渲染时间、而是渲染一个来自接口的列表，快照测试还有没有意义？给出你的判据；④ 写出替代方案（具体断言）。

<template #answer>

① 第一次生成 `__snapshots__/Xxx.test.ts.snap` 并通过；第二次运行**必然失败**，因为 `Date` 每次不同。报错形态是「snapshot mismatch」加上一个 unified diff，其中只有那一行时间戳是 `-` / `+`，其余几百行结构完全一致。

② 关键在于：**这个 diff 的信息量是零。** 它告诉你「结构变了」，实际是「某个必然变的值变了」，而它把这两件事用同一种红色呈现。团队无法区分「预期改动」和「真出错」，于是最省力的规则变成「红就 `-u`」。**一条需要人每次都按通过的测试，等价于没有测试，还多花了跑测试的时间。** 顺带一提，快照里出现时间/随机数/哈希路径/自增 id 都属于同一类问题，Vitest 提供了快照序列化/替换器来抹平它们——**但如果你需要配置序列化器才能让快照稳定，通常说明这个断言对象本来就不该用快照。**

③ 判据只有一条：**基线里的每个字节，是不是都由你的代码决定？** 来自接口的数据不是——上游加一个字段、换一条文案，快照就红，而你的代码一行没改。于是你要么 mock 掉接口（回到「测的是假对象」），要么承受外部变化引起的红。**两种情况下这层测试提供的保护都远低于它的维护成本。**

④ 替代方案（同一组件，三到四条断言顶掉一个快照）：

```ts
const wrapper = mount(TodoList, { props: { todos } })
expect(wrapper.findAll('li')).toHaveLength(todos.length)
expect(wrapper.text()).toContain('写第 9 章')
expect(wrapper.find('[aria-current="date"]').exists()).toBe(false)
expect(wrapper.emitted('select')).toBeUndefined()
```

它们锁的是「条数对不对、内容出不出现、该不该有某个语义标记、有没有误发事件」——这四件事是**功能契约**，重构不改它们；而快照锁的是标签嵌套与 class 名，重构必改它们。

</template>

</Exercise>

<Exercise title="练习 4 · 把定位器从脆弱改成稳定" difficulty="基础">

下面三个 Playwright 定位器各自会因为什么改动而失效？按本章的优先级把它们改写成稳定版本；如果某个场景语义上无法唯一定位，说明这时该用什么、并写清「什么时候允许用 `data-testid`」。

```ts
page.locator('.btn.btn-primary')
page.locator('div.toolbar > div:nth-child(3) > button')
page.locator('text=删除')
```

<template #answer>

| 原定位器 | 会因什么失效 | 稳定写法 |
| --- | --- | --- |
| `.btn.btn-primary` | 换 UI 框架 / 改样式类名 / 多个主按钮共存（strict mode 直接报「匹配到多个」） | `page.getByRole('button', { name: '保存' })` |
| `nth-child(3)` | 工具栏加一个按钮、换顺序 | 同上，按可访问名称定位，与位置无关 |
| `text=删除` | **文案改了**（这是它的合理职责）；更要命的是它会同时匹配列表里每一条待办的删除按钮 → 匹配多个 → 报错或误操作 | 先缩小范围再按角色定位：`page.getByRole('listitem').filter({ hasText: '买咖啡豆' }).getByRole('button', { name: '删除' })` |

第三条值得多说一句：`text=` 匹配「子串、可能多处」，而 Playwright 默认是 **strict**（一个定位器只能命中一个元素，否则报错）。所以端到端测试里最常见的红不是「功能坏了」，而是「定位器不够具体」——这时**不要**加 `.first()` 绕过 strict，那等于把「我不知道点的是哪一个」写进测试。正确做法是先把作用域收窄到那一条待办，再在里面找按钮。

`data-testid` 的合法使用时机：语义确实无法唯一定位（比如一个没有可访问名称的图标按钮、一个 canvas 里的热区），或你要断言的东西不面向用户（比如埋点触发）。纪律是：**它是逃生通道，用了就要在评审里解释为什么语义定位做不到；一个 PR 里出现十个 `data-testid`，说明测试写在了错误的抽象层。** 反过来，如果你的 HTML 连按钮的名字都读不出来（`aria-label` 缺失），端到端测试会立刻把这个问题暴露出来——**这正是这层测试的第二重收益。**

</template>

</Exercise>

<Exercise title="练习 5 · 决定这条命令该跑在哪一层" difficulty="进阶">

你的项目现在有 30 个单元测试、5 个组件测试、3 个端到端测试。CI 上每次 push 全跑一遍要 4 分钟，团队（只有你）开始觉得「太慢，本地不跑测试了」。给出具体的分层方案：哪一层每次 push 跑、哪一层只在 PR/main 跑、哪一层定时跑，并说明你放弃了哪些保护、为什么可以接受。另：本地开发时应该用什么命令形态，为什么「跑全套」是让人放弃测试的头号原因。

<template #answer>

分层：① **单元 + 组件（`vitest run`）每次 push 必跑**——它们合计应该在十几秒内完成，4 分钟里的大头几乎肯定是端到端（浏览器启动 + 真实构建 + 服务器）；② **端到端只在 PR 合并前和 main 上跑**；③ 体积预算与 Lighthouse（第 8 章）定时跑，失败只通知。本地用 `vitest`（watch）而不是 `vitest run`：它只重跑受改动影响的文件，反馈在秒级；端到端本地按文件跑（`playwright test e2e/todo.spec.ts`）而不是每次全套。

**放弃的保护是什么**：一个只 push 特性分支、不开 PR 的改动，会在几分钟内没有端到端覆盖。可接受的理由是：端到端测的是装配层问题（路由、`base`、缓存、鉴权），这类问题的成本在「合并到 main 时拦住」完全够用；而单元层能拦的静默逻辑错误一旦要等到端到端才被发现，调试成本高十倍。**这个取舍的前提是端到端确实在 main 前跑了一次**——如果你的 main 也没有端到端保护，那就不是取舍而是缺口。

最后一条：**「跑全套太慢所以不跑」不是纪律问题，是工具配置问题。** 解法永远是加快反馈环（watch 模式、影响面过滤、把慢的挪出关键路径），而不是「我要更自觉地跑测试」。任何需要你靠意志力维持的工程流程，都会在下一次赶工的时候输。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Vitest · 指南入口](https://vitest.dev/guide/) 与 [为什么选 Vitest](https://vitest.dev/guide/why) —— 核实「与 Vite 共用配置/转换管线」这一本章立论前提，以及 `vitest run` 与 watch 模式的区别。
- [Vitest · Mocking](https://vitest.dev/guide/mocking) 与 [API · mock](https://vitest.dev/api/) —— 核实 `vi.mock` 的提升（hoisting）行为、`vi.hoisted()`、`importOriginal` 做部分替换、`vi.spyOn` 对 ES 模块命名导出的限制、`restoreMocks` / `clearMocks` 的还原范围。**本章关于「工厂必须覆盖全部导出」「mock 实例跨用例共享」这两条代价，请以这一页当前描述为准。**
- [Vitest · 配置](https://vitest.dev/config/) —— 核实 `test.environment`（`node` / `jsdom` / `happy-dom`）、`include`、以及测试文件如何指定各自环境；`--coverage` 需要额外装 provider 这件事也在这里确认。
- [Vue Test Utils 指南](https://test-utils.vuejs.org/guide/) —— 核实 `mount` / `shallowMount` 的差异、`get` / `find` / `findAll` 的行为（含 `get` 找不到时直接抛错）、`trigger` / `setValue` 返回 Promise、`emitted()` 的返回形状（为什么断言要写成 `toEqual([[7]])`）、`global.plugins` / `global.stubs` / `global.provide` 的选项对象结构。
- [Playwright 文档 · 定位器](https://playwright.dev/docs/locators) —— **本章最该核实的一页**：`getByRole` 等语义定位器的推荐顺序、strict mode 的默认行为、`.first()` 为什么不是解法、`filter({ hasText })` 的用法。
- [Playwright 文档 · 入门](https://playwright.dev/docs/intro)、[Trace Viewer](https://playwright.dev/docs/trace-viewer-intro) 与 [组件测试](https://playwright.dev/docs/test-components) —— 核实 web-first 断言的自动重试语义（「不要写 `waitForTimeout`」的依据）、trace 的内容与开启方式；最后一条是「用 Playwright 也能做组件测试」的官方说法，与本章「组件测试交给 Vitest + VTU」的建议对照着读，别同时上两套。
- 站内回指：[组合式 API、composables 与组件设计](/vue/composables)（被测对象的写法）、[多页面待办应用](/vue/project)（练习对象）、[测试体系](/devops/testing) 与 [CI/CD 与 GitHub Actions](/devops/ci-cd)（本章最后一节的编排落到流水线上）、[Vite 构建侧](/frontend-engineering/vite-build)（端到端为什么必须跑在构建产物上）、[HTTP 缓存与资源加载策略](/frontend-engineering/http-caching)（只有端到端能拦的那类事故）。

## 下一章

第 8 章 [性能指标与 Core Web Vitals](/frontend-engineering/performance) 给站点定了可判度的数字预算，本章给代码定了「改了敢不敢上线」的最低防线——两者合起来才是「工程化做对了」的证据，而不是配置文件的堆砌。但有一类问题既不会被性能指标暴露、也不会被这三层测试拦住：**同一份代码在不同环境里行为不一样，而这个「不一样」是配置带来的。** 下一章 [环境变量与配置管理](/frontend-engineering/env-and-config) 讲 `VITE_` 前缀的暴露机制、为什么前端的环境变量一律不算秘密、以及把接口地址写进 `VITE_API_BASE` 之后它如何变成 `dist/` 里任何人可读的明文——那是本站领域首页列出的「代价最高」的两章之一（另一章是[锁文件](/frontend-engineering/semver-and-lockfile)）。
