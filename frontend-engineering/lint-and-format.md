# 代码规范：ESLint 管对错，Prettier 管长相，打架多半是分工错了

按下保存，格式化工具把这行改成 A，ESLint 立刻报「这里应写成 B」；你再保存，它又改回 A。PR 里吵三天的分号、引号、缩进，本该在保存那一刻自动结束。第二类现象更贵：照教程建了 `.eslintrc.js`，`npx eslint .` 要么毫无输出要么报找不到配置；或者 ESLint 在你的 TypeScript 文件里刷一屏 `no-undef`，而 `tsc` 什么都没报——前一种是**配置文件格式换过**（扁平配置 `eslint.config.js` 已取代 `.eslintrc.*`），后一种是你把**类型检查器的活交给了语法检查器**。

边界先划清：**Prettier 只管怎么排版，它重写代码但从不判断对错；ESLint 只管「这可能错」，做的是静态分析。** 所有冲突都来自有人在 ESLint 里开了格式类规则。剩下的要配的东西其实很少：一份扁平配置、一个格式化器、三处入口（编辑器 / CLI / CI）对齐。

<Callout type="unverified" title="本章的核实方式：文档已核、命令未跑">

**本站这个仓库现在没装 ESLint，也没装 Prettier。** 只读确认过（2026-10-18）：`node_modules/.bin` 里匹配 `eslint` 或 `prettier` 的可执行文件是 **0 个**；根目录没有 `eslint.config.*`、`.eslintrc.*`、`.prettierrc*`、`.editorconfig`；`package.json` 的 `scripts` 只有 `dev`、`build`、`preview`、`type-check`，**没有 `lint`**（复现命令见练习 1）。

所以本章**没有在本机跑过任何 `eslint` / `prettier` 命令**，所有配置片段与报错原文都是「预期结果」。已核实的是官方文档层面的事实（2026-10-18）：扁平配置的默认文件名、配置对象字段、`defineConfig` 的来源、全局忽略写法、`@eslint/js` 提供 `js.configs.recommended`；typescript-eslint 的六个共享配置名、`languageOptions.parserOptions.projectService: true`、共享配置会关掉与 TS 冲突的核心规则（含 `no-undef`）。**未核实**：`eslint-plugin-vue` 与 `eslint-config-prettier` 在扁平配置下的导出名——本章只标出该填哪个位置，不编写法。

</Callout>

## 职责边界：一张表 + 三条推论

| | ESLint | Prettier |
| --- | --- | --- |
| 它在做什么 | 静态分析：读 AST，按规则判断「这可能错」 | 格式化：把代码重排成唯一的合法写法 |
| 典型条目 | 未定义变量、不可达代码、漏 `await`、框架特有的误用 | 缩进、引号、分号、换行位置、尾随逗号 |
| 会不会改文件 | 默认只报告，`--fix` 才改，且只改标了可自动修复的规则 | 天生就改（`--write`） |
| 冲突时 | **把格式类规则从 ESLint 全关掉** | 让 Prettier 独占格式 |

三条推论：**格式类规则曾经也在 ESLint 核心里，后来被整体迁出**，由社区项目 [ESLint Stylistic](https://eslint.style/) 继续维护——今天的推荐分工就是这么来的。**逻辑类问题永远不能自动修**（「这个变量可能未定义」没有机械解法），所以 `--fix` 修不完一次 `eslint .` 的全部输出是正常的。**「那只用 ESLint Stylistic、少一个工具」技术上成立**，但你要逐条把几十条格式规则调到和团队习惯一致并永久维护这份决策；Prettier 只有少数几个选项、其余不可协商，配一次就不必再吵。本站口径：**Prettier 管格式，ESLint 管质量，两者冲突用专门关冲突项的配置包（`eslint-config-prettier`）一次性处理**，导入写法以该包当前文档为准。

## 扁平配置：eslint.config.js 的三条硬规则

核实到的当前形态（[官方配置文档](https://eslint.org/docs/latest/use/configure/configuration-files)）：默认配置文件名 `eslint.config.js`，也接受 `.mjs` / `.cjs`；**扁平配置已是默认**；默认导出**一个数组**；`defineConfig`（从 `eslint/config` 导入）只是给编辑器补全用的包装；每个元素的字段是 `name`、`files`、`ignores`、`languageOptions`、`plugins`、`rules`、`linterOptions`。由此三条：

1. **数组按顺序合并，后面的对象覆盖前面的。** 「通用在前、针对具体文件的例外在后」是这套机制的本质，不是风格偏好。旧格式的 `extends` 递归解析与「就近 `.eslintrc` 级联」都没了——那正是它被换掉的原因：最终结果要靠猜。
2. **`files` 决定作用范围，`ignores` 决定排除；只含 `ignores` 的那个对象是全局忽略**，等价于旧的 `.eslintignore`——而 `.eslintignore` 现在**已经不生效**，照抄旧教程最常踩这条。
3. **插件要显式注册。** `plugins` 是「名字 → 插件对象」的映射，必须真的 `import` 进来；旧格式按包名前缀自动查找的机制没了。`languageOptions` 里的 `ecmaVersion`、`sourceType`、`globals`、`parser` 也逐项声明，不会自动继承。

TS + Vue 项目的骨架：

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'   // 导出名以该插件当前文档为准
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  pluginVue.configs['flat/recommended'],     // ← 名字未核实，抄之前开插件文档核对
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { 'no-console': 'warn', 'eqeqeq': ['error', 'always'] },
  },
  { files: ['**/*.md'], rules: { 'no-console': 'off' } },
)
```

读它的正确方式是认出五个层次：忽略什么 → 基础规则集 → 按语言加什么 → 按框架加什么 → 这个项目收紧什么。**最后那种「例外块」必须在数组最后**，否则会被后面的通用对象盖掉（练习 3 就考这个）。

## typescript-eslint：为什么要关掉 no-undef

已核实的共享配置清单（[配置页](https://typescript-eslint.io/users/configs/)）：`recommended`（偏正确性）、`strict`（更严更主观）、`stylistic`（格式类）、`recommendedTypeChecked` / `strictTypeChecked`（再加**需要类型信息**的规则）、`disableTypeChecked`（关掉类型相关）。用法是 `import tseslint from 'typescript-eslint'` 再展开对应数组；**这些共享配置已经替你关掉与 TypeScript 冲突的核心规则，其中包括 `no-undef`**。

| 你想做的事 | 该开的配置 | 代价 |
| --- | --- | --- |
| 起步、只抓明显错误 | `recommended` | 抓不到靠类型才能发现的问题 |
| 抓漏 `await`、可疑的比较这类要推理类型的 bug | `recommendedTypeChecked` + `projectService: true` | **慢**（要为每个文件建立类型信息），且文件必须落在某个 `tsconfig` 的 `include` 里 |

`no-undef` 值得单说：`document`、`process`、框架自动导入的组件、只在类型里出现的名字，ESLint 的默认解析器都看不见——它只看语法层，类型信息不在它的输入里。所以 TS 项目里它只会制造噪音，解法是让共享配置关掉它、需要浏览器全局时用 `languageOptions.globals` 声明。**你确实想让工具替你回答「这个变量真的存在吗」时，答案是 TypeScript，不是 ESLint**——这是本章最有用的一句话。

类型那一档还有个固定坑：`projectService` / `parserOptions.project` 要求每个被 lint 的文件都被某个 `tsconfig` 覆盖，而配置文件（`vite.config.ts`、`eslint.config.js` 自身）、脚本、测试文件常年在 `include` 之外，于是报「文件不属于任何项目」。修法不是关掉整档，而是给这些文件单独一个只跑语法规则的配置对象（`include` 的口径见 [tsconfig 关键选项](/typescript/tsconfig)）。

## Vue 项目多出来的两块拼图

`.vue` 一个文件里有 `template`、`script`、`style` 三块，ESLint 默认解析器读不了——HTML 部分根本不是它的输入。所以必须有一个专门 parser 把 SFC 拆开再交给 JS/TS 解析器，规则集由 `eslint-plugin-vue` 提供（入口 [eslint.vuejs.org](https://eslint.vuejs.org/)，**本章未核实它扁平配置的导出名与档位命名**）。而 Vue 规则集真正值得开的理由不是格式，是几条框架特有的误用：模板里改 props、`v-for` 里用可复现的 `key`、`v-if` 与 `v-for` 同层。这些 `tsc` 一概看不见（语法合法、类型也自洽），只有懂框架语义的规则抓得到——这就是「装了 TypeScript 为什么还要 ESLint」的标准答案，另一半见 [模板语法](/vue/template-syntax)。

## 三处入口必须一致：编辑器、CLI、CI

配好文件不算完，得保证「谁改文件」这条路上三处用同一套规则，否则你会得到一堆未格式化的提交。

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix && prettier --write .",
    "format:check": "prettier --check .",
    "lint:ci": "eslint . --max-warnings 0"
  }
}
```

`lint` 不带 `--fix`，这样「随手跑一下」不会改你的文件；`lint:fix` 的顺序是**先 ESLint 后 Prettier**，让排版成为最后一步；`format:check` 只读比对，专供 CI；`lint:ci` 那条 `--max-warnings 0` **就是防假通过的开关**——默认 `warn` 不影响退出码，于是流水线里那条绿色的「lint 通过」是假的，仓库堆几千个 warning 之后所有人对 ESLint 的输出免疫。

编辑器侧（VS Code 的 `.vscode/settings.json`）要的是：保存时格式化、默认格式化器指到 Prettier 扩展、保存时执行 ESLint 的 autofix。两处 Windows 相关的坑（**均未在本机用工具验证**，只给形状）：行尾符 CRLF 与 LF 会让「内容没变、只有行尾变了」的巨大 diff 出现在全仓库，Prettier 用 `endOfLine` 选项处理，而这件事和 Git 的 `core.autocrlf` 是**两套独立机制**，同时配会互相顶——先只配一处、验证干净再动另一处（Git 侧见 [Git 基础](/devops/git-basics)）。

## 豁免的正确形状，和它的社会成本

严重级三档：`off`/`0`、`warn`/`1`、`error`/`2`；带选项的规则写数组，第一项是级别。单行豁免 `// eslint-disable-next-line 规则名`，**必须带规则名和一句原因**——不带规则名的整文件禁用会把所有规则关掉，半年后没人知道当初为什么关。想确认豁免有没有烂掉，看扁平配置里 `linterOptions` 那一组选项，其中有专门报告「未使用的禁用注释」的项（名字以配置文档当前版本为准）。

两条经验属于组织而非技术：**一条规则如果有 300 处报错，不要写 300 条豁免**，要么一次修完、要么降级并暂时从闸门里摘掉；**新项目开规则宁少勿多**，第一天就开最严配置报 800 条，一周后大家会跳过 pre-commit。ESLint 的价值在于你**相信它报的每一条**——噪音压过信号之后这套工具就废了，和第 9 章「测试因为脆弱所以被人删掉」是同一种死法。

## 常见错误与排查

1. **照抄旧教程建了 `.eslintrc.js`，`npx eslint .` 说找不到配置或毫无反应** —— 默认只读 `eslint.config.js`（`.mjs`/`.cjs` 同），`.eslintrc.*` 已不是默认格式。确认：项目里到底是哪种文件名；官方文档有没有你装的版本的迁移指引（**迁移命令我不确定，以文档为准，别手抄**）。修：按本章骨架重写。判断一篇教程是否过期，看配置文件名就够了。
2. **保存后被改回去，同一行两个工具来回改** —— ESLint 里开着格式类规则。确认：关掉 `formatOnSave`，只跑 `npx eslint . --fix` 看谁改了文件，再只跑 `npx prettier --write .` 看第二轮还剩什么在改。修：ESLint 侧格式规则整批关掉（用那个专门处理冲突的配置包），让 Prettier 独占格式。
3. **TS 文件报一屏 `no-undef`，代码能跑、`tsc` 也不报错** —— 全局对象没声明，且核心规则与 TypeScript 冲突。确认：报错的名字是不是 `document`/`process`/自动导入的组件。修：改用 typescript-eslint 共享配置（它会关 `no-undef`，这条已核实），需要浏览器全局就在 `languageOptions.globals` 声明。
4. **`.vue` 报 `Parsing error`，或根本没人检查它** —— 没接框架 parser，或 `files` 里没有 `.vue`。确认：`npx eslint src/App.vue` 单独指一个文件，看它报的是解析错还是规则错。修：补插件与 parser（导出名核对插件文档），把 `**/*.vue` 放进 `files`。
5. **`npm run lint` 通过，但 `src/**/*.ts` 一条都没被检查** —— 默认匹配的是 JS 系列扩展名，TS/Vue 要靠 `files` 与命令行路径显式覆盖。确认：**故意在某个 `.ts` 里写一个必然报错的东西，看 lint 有没有反应**——这是最快的「lint 到底在不在工作」测试。修：显式给目录与扩展名。
6. **第一次接 Prettier，一个提交改了 2600 个文件，`git blame` 全废** —— 一次性格式化撞上功能改动。修：**单独一次纯格式化提交**，提交信息里写明不逐行评审；配 `.prettierignore` 排除生成物与 `dist/`；之后 CI 用 `--check` 而不是 `--write`，避免顺手重排别人的文件。
7. **类型规则报「文件不属于任何 tsconfig 项目」** —— 配置文件与脚本常年在外（见前面那节）。修：拆一个只跑语法规则的配置对象，别整档关掉。

## 练习

<Exercise title="练习 1 · 只读确认一个项目有没有配规范" difficulty="基础">

不装任何东西，用只读命令回答四问：① 有没有 ESLint 配置、是哪种文件名？② 装没装 `eslint` / `prettier`？③ `scripts` 里有没有 `lint`？④ 类型检查是谁在做、有没有接进 `build`？请在本站仓库里跑一遍。

<template #answer>

本站实际结果（2026-10-18 只读确认）：① 根目录**没有任何** `eslint.config.*` / `.eslintrc.*` / `.prettierrc*` / `.editorconfig`。② `node_modules/.bin` 里匹配 `eslint` 或 `prettier` 的可执行文件 **0 个**，两个都没装（这个仓库的 `vite`、`rollup`、`esbuild`、`typescript`、`vue-tsc` 由 VitePress 带进来，不是根包直接依赖）。③ `scripts` 只有 `dev`、`build`、`preview`、`type-check`，**没有 `lint`**。④ 类型检查是 `vue-tsc --noEmit -p tsconfig.json`，独立一条，`build` 没调用它。

结论形状：这个仓库有类型检查、没有静态分析与格式约束——正是阶段项目要补的那块。可复用的确认命令：`ls -a | grep -iE "eslint|prettier"`、`node -p "JSON.stringify(require('./package.json').scripts)"`、`ls node_modules/.bin | grep -E "^(eslint|prettier)$"`、`npm ls eslint`（区分直接依赖与传递依赖）。

</template>

</Exercise>

<Exercise title="练习 2 · 故意让两个工具打架" difficulty="进阶">

把一条格式类规则（例如 `indent: ['error', 4]`）加进 ESLint 的 `rules`，同时让 Prettier 是单引号、两格缩进，然后保存文件。① 你看到什么？② 解释这条链路。③ 给出两种修法，并说明为什么第二种是错的实践。

<template #answer>

① **来回改**：保存时 Prettier 把文件排成单引号两格，ESLint 立刻在同一行报缩进应为 4；开了「保存时自动修」的话两个工具在同一次保存里互相顶，文件在两种写法之间抖动，或者那条报错永远修不掉。② 根因是「谁负责格式」交错了：两个工具对同一行提不同要求，没有主次就没有收敛点。③ 正确修法：**把 ESLint 侧格式类规则整批关掉**，Prettier 独占格式，ESLint 只留质量规则。第二种是「卸掉 Prettier、只用 ESLint Stylistic」——它能收敛，但是错的实践：你得逐条对齐几十条规则并永久维护这份决策。**冲突的解法是把职责分开，不是让一个工具接管另一个的全部工作。**

</template>

</Exercise>

<Exercise title="练习 3 · 读一份扁平配置判断哪条规则生效" difficulty="挑战">

顺序即优先级。配置数组是：①`{ ignores: ['src/**'] }`；②`js.configs.recommended`；③`{ files: ['**/*.vue'], rules: { 'no-console': 'off' } }`；④`{ rules: { 'no-console': 'error' } }`。问：`src/pages/Home.vue` 会被检查吗？如果不会，为什么？把①的 `ignores` 去掉之后 `no-console` 是什么级别？判断依据是哪条规则？

<template #answer>

**不会**——①只含 `ignores`，是**全局忽略**，`src/**` 在进入任何规则匹配之前就被排除，后面三个对象根本不会再看到这些文件。「忽略优先于匹配」这条最容易记错。把①的 `ignores` 去掉之后，级别是 **`error`**：数组按顺序合并、**后面的对象覆盖前面的**，③虽然明确作用于 `**/*.vue`，但④没有 `files`（即作用于所有被检查文件）且排在它后面，同一字段后写的赢。依据就是本章那三条硬规则：忽略优先、`files` 定范围、顺序定优先级。实践启示：**针对具体文件的例外要放在数组最后**，否则被后面的通用对象悄悄盖掉——这是「我明明关了这条规则怎么还报」最常见的原因，也正是扁平配置比旧格式好调试的地方：结果完全由这个数组决定，不用猜级联。

</template>

</Exercise>

## 官方文档与延伸阅读

- [ESLint 配置文件（扁平配置）](https://eslint.org/docs/latest/use/configure/configuration-files) —— 本章三条硬规则全部核实自这页：默认文件名 `eslint.config.js`/`.mjs`/`.cjs`、扁平配置已是默认、默认导出数组、`defineConfig` 来自 `eslint/config`、字段 `name`/`files`/`ignores`/`languageOptions`/`plugins`/`rules`/`linterOptions`、只含 `ignores` 的对象是全局忽略。改配置前看这页，别看博客。
- [ESLint 配置总览](https://eslint.org/docs/latest/use/configure/) 与 [规则列表](https://eslint.org/docs/latest/rules/) —— 多份配置怎么合并、`files` 与优先级如何互相作用（练习 3 的判断口径）；某条规则能否自动修、有哪些选项。
- [typescript-eslint 共享配置](https://typescript-eslint.io/users/configs/) —— 核实六个配置名与各自定位、`import tseslint from 'typescript-eslint'` 的用法、类型档要 `languageOptions.parserOptions.projectService: true`、共享配置会关掉与 TS 冲突的核心规则（含 `no-undef`）。
- [Prettier 文档](https://prettier.io/docs/) 与 [配置选项](https://prettier.io/docs/options) —— 核实 `semi`、`singleQuote`、`printWidth`、`trailingComma`、`endOfLine` 的选项名，以及 `--check` / `--write` 语义与 `.prettierignore` 写法；[ESLint Stylistic](https://eslint.style/) 是格式类规则迁出后的归属。**[eslint-plugin-vue](https://eslint.vuejs.org/) 是本章唯一没核实的接入方式，接 Vue 前必须打开核对。**
- 站内衔接：[包管理](/frontend-engineering/package-managers)（`devDependencies` 与 `scripts` 放哪）、[语义化版本与锁文件](/frontend-engineering/semver-and-lockfile)（工具版本为什么决定报错内容）、[tsconfig 关键选项](/typescript/tsconfig)（`include` 与类型信息）、[Vite 构建侧](/frontend-engineering/vite-build)（`build` 里没有类型检查那条）、[代码规范与提交约定](/devops/code-standards)。

## 下一章

本章把规范拆回两半：Prettier 独占格式、ESLint 只做质量；扁平配置是一个按顺序合并的数组，忽略优先、`files` 定范围、顺序定优先级；CI 那条不带 `--max-warnings 0` 就是假通过。你也确认了本站现状——有 `type-check`、没有 `lint`。下一章进入浏览器内部：[浏览器渲染机制与关键渲染路径](/frontend-engineering/rendering-pipeline) —— 第 3、4 章讲「代码怎么变成产物」，从这章起讲「产物被浏览器变成像素的那段路上时间花在哪」，第 7、8 章的因果模型都来自这里。
