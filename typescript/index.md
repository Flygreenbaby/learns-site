# TypeScript · 领域首页

<StatusBadge state="ready" note="12 章正文全部完成（第 12 章为阶段项目），可连续学习" />

## 这个领域解决什么问题

**TypeScript 不是「带类型的 JavaScript 语法」，它是一台在你写代码时就跑起来的错误检测器。** 把 TS 当成语法糖学，你会写出一堆类型标注，然后发现它一个 bug 都没帮你抓到——这是最常见也最可惜的学法。

不用类型时，下面这些错误只能在运行时暴露，而且往往在用户那里暴露：

- 后端返回的字段叫 `created_at`，前端读的是 `createdAt`，页面上显示 `undefined`。不报错，只是空白。
- 一个函数有时候返回 `User`，有时候返回 `null`。调用方忘了判空，页面在某个特定数据下崩掉。
- 接口改了参数顺序，两个都是 `string` 类型，编译期毫无察觉，运行时行为完全错乱。
- 重构时改了一个函数名，二十个调用点里漏了三个。JavaScript 项目里你只能全局搜索然后祈祷。
- 从 `localStorage` 里 `JSON.parse` 出来的东西直接当对象用，实际结构和你以为的完全不一样。
- 一个第三方库的返回值，文档里写了但类型定义里没有，你只能靠猜。

TypeScript 能把上面前四类问题全部提前到编辑器里。**但前提是类型写得对。** 而「写得对」的门槛比多数人想象的高，具体的失败模式是：

- 到处写 `any`。`any` 不是「稍后再补」，它是**关掉类型检查**——一旦一个值是 `any`，它流经的所有地方都失去保护，而且 TS 不会报错。项目里 `any` 的数量和它能抓到的 bug 数量成反比。
- 用 `as` 强行断言。`as` 是告诉编译器「相信我」，编译器就真的信了。断言错了不会有警告，只会在运行时炸。
- 给每个变量都手写类型标注，包括 `const count: number = 0` 这种。TS 有类型推断（type inference），过度标注不仅冗余，还会在重构时制造不一致。
- 把接口定义成一大堆可选属性 `?`，因为「不确定后端会不会返回」。结果每个使用点都要判空，而真正该有的判别联合（discriminated union）没用上。
- 遇到「类型不匹配」的报错，第一反应是加 `@ts-ignore` 或者放宽成 `unknown` 再断言回去。这是把报警器拆掉而不是灭火。
- 泛型写不出来，于是复制粘贴五份几乎一样的函数，只为了参数类型不同。

本领域要教的是：**先理解类型系统的运行机制，再谈语法**。核心是三件事——推断（TS 大部分时候不需要你写类型）、收窄（narrowing，把宽类型在具体分支里变窄）、泛型（用类型参数写一份适用于多种类型的代码）。这三件事理解了，剩下的都是查文档。

还有一个必须建立的认知：**TypeScript 的类型系统是结构化的（structural），不是名义化的（nominal）。** 两个类型只要结构兼容就互相兼容，名字不同没关系。这一点和 Java / C# 完全不同，是大量「为什么这个能通过编译」困惑的根源。

## 前置知识

**[JavaScript](/javascript/)。**

本站的 JavaScript 领域不重写教程，主体材料是 [javascript.info](https://javascript.info/)。开始本领域之前，你需要完成 javascript.info 第一部分的这些章节：Fundamentals、Objects: the basics、Data types、Advanced working with functions（尤其 `closure`）、Classes、Promise / async / await、Modules。

原因很具体：TypeScript 编译之后就是 JavaScript，类型信息全部被擦除。你写的所有代码在运行时都是纯 JS。如果你不理解 JS 的引用语义、闭包、`this` 绑定、Promise 解包规则，你就无法判断 TS 的类型标注在运行时到底意味着什么，也无法读懂 TS 的报错——很多 TS 报错其实是在描述一个 JS 运行时行为。

完整清单见 [JavaScript 领域的衔接说明](/javascript/)。

不需要先学 CSS，也不需要先学 Vue。本领域是[学习路线](/guide/roadmap)第一期第 4 步，学完之后才进入 Vue。

## 章节目录

| 章节 | 内容 | 学完能做什么 |
| --- | --- | --- |
| [1. 为什么需要类型](/typescript/why-types) | 动态类型的真实代价、结构化类型系统 vs 名义化类型系统、TS 的编译流程与类型擦除、TS 能抓到和抓不到的错误 | 判断什么项目值得上 TS，理解「类型通过 ≠ 逻辑正确」 |
| [2. 基础类型与类型注解](/typescript/basic-types) | 原始类型与 `unknown` / `any` / `never` / `void` 的区别、数组与元组、字面量类型、`readonly`、何时该写注解何时不该 | 给一个 JS 文件加上准确的类型，不冗余也不漏 |
| [3. 联合类型与收窄](/typescript/unions-and-narrowing) | 联合类型、`typeof` / `instanceof` / `in` 守卫、真值收窄、等值收窄、判别联合、可辨识的失败分支、`never` 的穷尽检查 | 处理「多种可能形状」的数据时不写一次 `as` |
| [4. 对象类型与接口](/typescript/objects-and-interfaces) | `interface` 与 `type` 的区别与选择、可选属性、索引签名、交叉类型、结构兼容性、对象字面量的多余属性检查 | 为后端接口返回的 JSON 建立准确的数据模型 |
| [5. 函数类型](/typescript/functions) | 函数类型表达式、参数与返回值标注、可选与默认参数、剩余参数、`this` 参数、重载、函数类型的双向协变 | 给回调、事件处理器、工具函数写出正确的签名 |
| [6. 泛型](/typescript/generics) | 类型参数、泛型函数与泛型类型、约束（`extends`）、默认类型参数、多个类型参数之间的关系、什么时候不该用泛型 | 写一份适用于多种类型的代码，而不是复制粘贴五遍 |
| [7. 类型推断与上下文类型](/typescript/inference) | 推断的触发时机、上下文类型（contextual typing）、`as const`、控制流分析、推断失败时如何修 | 大幅减少手写注解，并知道推断在哪种情况下会给出 `any` |
| [8. 工具类型](/typescript/utility-types) | `Partial` / `Required` / `Pick` / `Omit` / `Record` / `Exclude` / `Extract` / `ReturnType` / `Awaited` 等内置工具类型，以及用条件类型与映射类型自己写一个 | 从已有类型派生新类型，避免重复定义 |
| [9. 模块与声明文件](/typescript/modules-and-declarations) | ES 模块与 TS 的关系、`.d.ts` 的作用、`declare` 关键字、`@types/*` 包、全局类型扩展、找不到类型定义时怎么办 | 让第三方库和无类型的旧代码在 TS 项目里可用 |
| [10. tsconfig 关键选项](/typescript/tsconfig) | `strict` 及其拆分的各个开关、`noUncheckedIndexedAccess`、`target` 与 `lib`、`module` 与 `moduleResolution`、`paths`、`include` / `exclude` | 为一个新项目配置一份合理的 tsconfig，并说清每个选项在防什么 |
| [11. 真实项目中的取舍](/typescript/tradeoffs) | 何时可以接受 `any`、`unknown` 的正确用法、`as` 的安全边界、边界处的类型校验、渐进式迁移一个 JS 项目的策略 | 在「类型完美」和「先跑起来」之间做出有意识的决定 |
| [12. 阶段项目](/typescript/project) | 用 TypeScript 重写一个纯 JS 小项目，并加上接口数据的类型校验 | 把前 11 章串成一个可编译、零 `any` 泄漏的真实项目 |

## 学习顺序建议

**严格按 1 → 12 的顺序学。第 1、2、3 章是绝对不能跳的地基。**

第 1 章看起来最「虚」，但它决定你后面所有代码的质量。如果你不理解「TS 是结构化的类型系统」和「类型在运行时被擦除」这两件事，你会写出大量「编译通过但运行时崩」的代码，然后得出结论说 TS 没用。

第 3 章（联合与收窄）是全站被低估最严重的一章。**收窄是 TS 日常使用中频率最高的技能**——处理接口返回、处理用户输入、处理 `localStorage`，本质上都是「一个宽类型，需要在分支里变窄」。跳过它的人，会用 `as` 替代收窄，然后所有类型保护都失效。

第 6 章泛型建议在第 4、5 章之后学，因为泛型的约束（`extends`）需要你先理解对象类型和函数类型。泛型是第 8 章工具类型的前提——所有工具类型都是泛型 + 条件类型 + 映射类型的组合。

第 7 章（类型推断）位置上放在泛型之后，但**它的思想从第 2 章就要开始实践**：默认不写注解，让 TS 推断；只在推断结果不对或者函数签名需要对外承诺时才写。

第 10 章 tsconfig 不要提前学。在没有真实项目之前背选项没有意义，你会记不住每个开关防的是什么错误。等你在第 12 章的项目里踩过一次，再回头看会立刻理解。

第 11 章是横向总结，必须在最后读。

## 学习方法

- **用 [TypeScript Playground](https://www.typescriptlang.org/play/) 做所有实验。** 它会在右侧显示编译后的 JS 和类型信息，你能直接看到「类型擦除」是怎么发生的。把 `strict` 打开。
- **练习的正确形式是：故意制造报错，然后读懂报错。** 每学一个概念，先写一段能通过编译的代码，再把它改坏，看 TS 给什么提示。TS 的报错信息质量很高，学会读报错比学会写类型更重要——报错的第一行通常是类型不匹配的位置，后面的缩进部分在解释「哪个属性不兼容」。
- **不要一上来就配项目。** 前 8 章全部可以在 Playground 里完成，不需要 Node.js、不需要 `npm install`。等到第 9、10 章需要模块和 tsconfig 时再建项目。
- **配好编辑器再开始。** VS Code + TypeScript 内置支持已经足够。把鼠标悬停在变量上看推断出的类型，这个动作每天要做几十次——它是你验证「TS 以为这是什么类型」的唯一手段。
- **给自己立一条硬规矩：本领域的所有练习里禁止使用 `any`、`as` 和 `@ts-ignore`。** 遇到类型不匹配，只能通过收窄、泛型或修改类型定义来解决。第 11 章会告诉你什么时候可以打破这条规矩，在那之前先养成肌肉记忆。
- **每章末尾，找一个你以前写过的 JS 文件，尝试给它加类型。** 这比做练习题更接近真实工作，也会暴露出你的类型设计习惯问题。

## 阶段项目

**用 TypeScript 重写 JavaScript 领域的阶段项目**（那个纯 JS 待办清单），并在此基础上扩展。

技术约束：

- 从零建一个 TS 项目，`tsconfig.json` 中 `strict` 必须为 `true`，并额外开启 `noUncheckedIndexedAccess`。
- 编译产物零 error、零 warning。
- 全项目 `any` 的出现次数为 0。如果某处确实无法避免，必须写注释说明原因，并限制在一个函数内部不外泄。
- 不使用 `as` 做类型断言，除非在解析外部数据的边界处，并且该处必须有运行时校验。

功能扩展：

- 待办项支持标签（tag）和截止日期，用判别联合表达「进行中 / 已完成 / 已过期」三种状态，每种状态携带的字段不同。用 `never` 穷尽检查确保 `switch` 覆盖所有分支。
- 用泛型写一个 `fetchJson<T>(url: string): Promise<T>`，调用方传入期望的类型；在函数内部对 `fetch` 的返回做运行时结构校验，校验失败抛出可辨识的错误类型。
- 用 `Pick` / `Omit` / `Partial` 从主数据模型派生出至少三个衍生类型（例如创建入参、更新入参、列表展示项），不要重复定义字段。

验收标准：

- 故意把 `fetchJson` 的泛型参数写错，编译器能报错——这验证你的类型是真的在起作用，不是装饰。
- 故意删掉 `switch` 的一个分支，编译器能报错——这验证穷尽检查生效。
- 用 `grep` 搜索 `any`、`as `、`@ts-ignore`，结果符合上面的约束。
- 你能解释 tsconfig 里每一个打开的选项分别在防什么错误。

## 官方文档与延伸阅读

- [TypeScript 手册（The TypeScript Handbook）](https://www.typescriptlang.org/docs/handbook/intro.html) —— 官方主教程，本领域的骨架参照它组织。
- [TypeScript 五分钟入门](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html) —— 如果你想在开始第 1 章之前先建立整体印象。
- [从 JavaScript 迁移到 TypeScript](https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html) —— 第 12 章阶段项目的直接参考。
- [基础类型（The Basics）](https://www.typescriptlang.org/docs/handbook/2/basic-types.html) 与 [严格模式说明](https://www.typescriptlang.org/docs/handbook/intro.html#strict-mode) —— 第 1、2 章核心参考。
- [日常类型（Everyday Types）](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) —— 涵盖[字面量类型](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types)与 [`null` / `undefined`](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#null-and-undefined)，第 2 章核心参考。
- [收窄（Narrowing）](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) —— 第 3 章核心参考，包含 [`typeof` 守卫](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#the-typeof-type-guard) 与 [判别联合](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)。
- [对象类型（Object Types）](https://www.typescriptlang.org/docs/handbook/2/objects.html) —— 第 4 章核心参考，包含 [`unknown`](https://www.typescriptlang.org/docs/handbook/2/objects.html#the-unknown-type)、[索引签名](https://www.typescriptlang.org/docs/handbook/2/objects.html#index-signatures)、[`readonly`](https://www.typescriptlang.org/docs/handbook/2/objects.html#the-readonly-modifier) 与 [泛型对象类型](https://www.typescriptlang.org/docs/handbook/2/objects.html#generic-object-types)。
- [函数（Functions）](https://www.typescriptlang.org/docs/handbook/2/functions.html) —— 第 5 章核心参考，包含 [函数类型表达式](https://www.typescriptlang.org/docs/handbook/2/functions.html#function-type-expressions) 与 [`unknown`](https://www.typescriptlang.org/docs/handbook/2/functions.html#unknown)。
- [泛型（Generics）](https://www.typescriptlang.org/docs/handbook/2/generics.html) —— 第 6 章核心参考，包含 [泛型类型](https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-types) 与 [泛型约束](https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-constraints)。
- [类（Classes）](https://www.typescriptlang.org/docs/handbook/2/classes.html) —— 本站路线以函数式和组合式风格为主，class 用得不多，但需要能读懂第三方库的类定义。
- [模块（Modules）](https://www.typescriptlang.org/docs/handbook/2/modules.html) —— 第 9 章核心参考。
- [类型声明（Type Declarations）](https://www.typescriptlang.org/docs/handbook/2/type-declarations.html) 与 [`.d.ts` 文件](https://www.typescriptlang.org/docs/handbook/2/type-declarations.html#dts-files) —— 第 9 章核心参考。
- [声明文件总览](https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html)、[按示例编写声明文件](https://www.typescriptlang.org/docs/handbook/declaration-files/by-example.html)、[消费声明文件](https://www.typescriptlang.org/docs/handbook/declaration-files/consumption.html)、[模块声明模板](https://www.typescriptlang.org/docs/handbook/declaration-files/templates/module-d-ts.html) —— 第 9 章的深入材料。
- [工具类型（Utility Types）](https://www.typescriptlang.org/docs/handbook/utility-types.html) —— 第 8 章核心参考，包含 [`Partial`](https://www.typescriptlang.org/docs/handbook/utility-types.html#partialtype) 与 [`Record`](https://www.typescriptlang.org/docs/handbook/utility-types.html#recordkeys-type)。
- [tsconfig 选项参考](https://www.typescriptlang.org/tsconfig/) —— 第 10 章核心参考，包含 [`strict`](https://www.typescriptlang.org/tsconfig/#strict)、[`noImplicitAny`](https://www.typescriptlang.org/tsconfig/#noImplicitAny)、[`moduleResolution`](https://www.typescriptlang.org/tsconfig/#moduleResolution)、[`target`](https://www.typescriptlang.org/tsconfig/#target)。
- [选择编译器选项指南](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html) —— 官方给出的 tsconfig 决策路径，第 10 章必读。
- [TypeScript Playground](https://www.typescriptlang.org/play/) —— 本领域的主要练习环境。
- [TypeScript 发行说明总览](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html) 与 [TypeScript 团队博客](https://devblogs.microsoft.com/typescript/) —— 追踪新版本的唯一可靠来源。

## 版本说明

本领域内容基于 **TypeScript 5.x** 编写，核实时间为 2026 年 10 月。参考的官方手册为 Handbook 2（即 TypeScript 4.x 之后重写的版本）。

时效性风险按章节区分：

- **第 1–8 章（类型系统核心）非常稳定。** 联合类型、收窄、泛型、工具类型这些概念自 TS 2.x 起就没有本质变化，向后兼容是 TS 团队的硬约束。这一部分内容的过期风险很低。
- **第 9 章（模块与声明文件）中等风险。** TS 的模块解析策略经历过多次调整（`node` → `node16` → `nodenext` → `bundler`），旧教程里的 `moduleResolution` 配置可能已经不适用。以 [选择编译器选项指南](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html) 为准。
- **第 10 章（tsconfig）是最容易过时的部分。** 新选项每个小版本都可能增加，默认值也会调整。动手前对照 [tsconfig 参考](https://www.typescriptlang.org/tsconfig/) 确认当前版本的默认值。
- **具体版本的特性**（例如 [TS 5.0](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)、[5.5](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html)、[5.8](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html) 引入的能力），文中涉及时会标注最低版本要求。
- **第 8 章的内置工具类型清单会随版本增长。** 本站只讲常用且稳定的那一批，新工具类型请查官方手册。
