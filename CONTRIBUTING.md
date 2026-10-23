# 贡献指南

感谢你愿意帮助完善《全栈学习手册》（[Flygreenbaby/learns-site](https://github.com/Flygreenbaby/learns-site)）。

这是一份面向中文自学者的技术知识库，内容全部是仓库里的 Markdown 文件，
构建后是一个纯静态网站（无后端、无数据库、无用户系统）。
我们欢迎纠错、内容补充、示例改进、官方资料更新，以及经过讨论的新章节贡献。

**你不需要本仓库的写权限**，也不需要被加为协作者。所有修改都通过
Fork + Pull Request 的方式提交，流程见下面第 4 节。

---

## 1. 提交 Issue

发现以下情况时，请优先开 [Issue](https://github.com/Flygreenbaby/learns-site/issues)
而不是直接改：

- 技术概念、代码示例或操作步骤有错误；
- 引用的官方文档链接失效、或链接内容与所讲知识点不对应；
- 站内链接 404、章节顺序混乱、侧边栏与实际文件不一致；
- 构建失败或本地跑不起来；
- 想新增一个领域、一个章节，或对课程结构有较大调整的想法。

一个有用的 Issue 至少包含三条信息：

1. **具体位置**：文件路径，例如 `linux/users-and-permissions.md`；能给行号更好。
2. **实际现象**：你看到的错误内容、报错信息原文、或失效的链接。
3. **依据**：官方文档 / 规范的链接，或可复现的步骤。

> 只写「这里不对」而不给依据的 Issue，维护者无法判断，也无法动手改。
> 本站对内容准确性有硬性要求（见第 3 节），提 Issue 时也请按同样的标准给证据。

---

## 2. 哪些可以直接提 PR，哪些先讨论

**可以直接提 PR（不需要先开 Issue）：**

- 修正错别字、标点、中英文混排与空格；
- 修正明显的技术错误、错误的命令、错误的代码示例；
- 更新失效或过时的官方文档链接；
- 补充遗漏的原理说明、常见错误、排查思路；
- 修复站内死链、章节 `## 下一章` 接错、侧边栏条目与文件不一致。

**请先开 Issue 讨论，得到确认后再动手：**

- 新增一个领域（顶层目录），或新增一整批章节；
- 大规模重写已有章节、改变章节切分方式或学习顺序；
- 修改 `.vitepress/config.mts`、`.vitepress/domains.ts`、`scripts/` 下的脚本；
- 引入新的构建依赖、新的组件、新的目录约定；
- 调整站点导航结构、主题样式或全局行为。

原因很实际：这类改动会牵动导航、侧边栏、领域元数据和校验脚本多处，
先对齐方向能避免你写完几百行却被整体退回。

---

## 3. 课程内容要求（硬性）

这是本项目最重要的一节。**内容准确性优先于篇幅、结构和排版。**

- 使用中文讲解，必要的英文技术术语保留原文，不要生硬翻译。
- 优先解释「为什么这样设计」「使用场景是什么」「出错了怎么排查」，不只给结论。
- **不得编造**：API 名称、函数签名、配置项、命令行输出、运行结果、测试数据、
  性能数字、报错信息、参考资料链接。宁可写「未验证」也不要写一个看起来对的假结果。
- **引用来源必须真实可查**：给出的链接必须真实存在、可访问，且内容确实支持你的说法。
  不确定的链接就不要放。
- 代码如果**没有实际运行验证过**，必须在章内明确标注验证范围，
  不得声称「测试通过」「已验证」。本项目用 `<Callout type="verified">` 表示
  「这段机制在本站编写环境里真跑过」，用 `<Callout type="unverified">` 表示
  「规范/文档级说明，本机没有条件验证」——每个 verified 框都要写清覆盖范围与不覆盖范围。
  请沿用这套标注，不要混用。
- 涉及 Linux、Docker、数据库服务、消息队列、云服务、真机调试这类
  本机无法真实运行的环境时，如果做的是机制层面的模拟验证，
  **必须写明「这是模拟，不等于在真实环境验证过」**。
- 新增章节请遵循项目现有格式：正文小节 → `## 常见错误与排查` → `## 练习`
  （`<Exercise>` 组件，3–6 道，带折叠答案）→ `## 官方文档与延伸阅读` → `## 下一章`。
  阶段项目章固定命名 `project.md`。详细写作规范见 [`_content-plan.md`](_content-plan.md) 第二节。
- **不要顺手改无关内容**：不要重排无关章节、不要批量格式化、
  不要改动治理文件（`_content-plan.md`、`_author-brief.md`）与 `scripts/` 下的校验脚本。
  它们是规范来源，改动需要先讨论。

---

## 4. 如何提交修改

### 4.1 Fork 与分支

```bash
# 1. 在 GitHub 页面点 Fork，然后克隆你自己的副本
git clone https://github.com/<你的用户名>/learns-site.git
cd learns-site

# 2. 添加上游，便于后续同步
git remote add upstream https://github.com/Flygreenbaby/learns-site.git

# 3. 从最新的 main 切一个独立分支（一个 PR 只做一件事）
git fetch upstream
git checkout -b fix/linux-permission-typo upstream/main
```

分支名建议带上意图前缀：`fix/…`、`docs/…`、`feat/…`、`refactor/…`。

### 4.2 安装依赖并本地预览

```bash
npm ci          # 严格按 package-lock.json 复现依赖（推荐）
npm run dev     # 开发服务器，默认 http://localhost:5173/
```

环境要求 Node.js 22 或更高。详见 [README.md](README.md) 第五、六节。

> 请先用 `npm ci` 而不是 `npm install`：`npm install` 会把带 `^` 的范围依赖
> （`typescript`、`vue-tsc`）升到新版本，而 `typescript@7` 与 `vue-tsc@3.3.13` 不兼容，
> 会让 `npm run type-check` 直接崩溃。原因写在 [README.md](README.md) 第三节。

### 4.3 提交前必须跑的检查

在项目根目录依次执行下面 4 条命令。**这 4 条都是项目里已经存在的检查，
不需要安装任何额外工具**：

```bash
npm run type-check                 # 类型检查：config.mts / domains.ts / _sidebar.ts / 主题 .ts .vue
node scripts/check-links.cjs       # 站内绝对链接死链检查（只读）
node scripts/scan-braces.cjs       # 扫描会让构建中止的连续左花括号插值符（只读）
npm run build                      # 完整构建，这是最终判据
```

判定标准：

| 命令 | 通过的样子 | 说明 |
| --- | --- | --- |
| `npm run type-check` | 退出码 0，无任何输出 | 不检查课程 Markdown |
| `node scripts/check-links.cjs` | 输出 `OK: no dead internal links. …` | 有已知盲区，见下方注意 |
| `node scripts/scan-braces.cjs` | 命中数不增加（基线是 3 处，全在被排除的 `_*.md` 治理文件里） | 命中在正文里会导致构建中止 |
| `npm run build` | **退出码 0** | 构建是全有或全无的：一旦中止，产物里一个页面都不会更新 |

**`npm run build` 是唯一权威判据。** `check-links.cjs` 只看以斜杠开头的站内绝对链接，
看不见相对链接、也不校验 `#锚点`，并且它的排除表比 `.vitepress/config.mts` 的 `srcExclude`
旧——它说 OK 不代表全站无死链。VitePress 构建时自带严格死链检查（本项目没有关闭它），
发现死链会抛错中止。

如果构建报 `N dead link(s) found.`，请先**改正链接写法**，
不要用 `ignoreDeadLinks` 把检查关掉。

### 4.4 提交与推送

```bash
git add <你改动的文件>          # 请逐个点名，不要用 git add -A
git commit -m "fix(linux): 修正 users-and-permissions 的权限位说明"
git push origin fix/linux-permission-typo
```

提交信息建议写明「改了什么 + 为什么」。一次提交只做一件事。

### 4.5 提交 Pull Request

在 GitHub 上向 `Flygreenbaby/learns-site` 的 `main` 分支发起 Pull Request，
并在描述里写清四件事：

1. **修改目的**：解决什么问题，或对应哪个 Issue（写 `Closes #123`）。
2. **主要变更**：改了哪些文件、改了什么。
3. **验证结果**：第 4.3 节那 4 条命令**你实际跑过没有、退出码是多少、输出了什么**。
4. **验证边界**：哪些是你真跑过的，哪些没有条件跑。

> **如果你的环境跑不了这些检查，请在 PR 里如实说明「未验证」，
> 不要声称检查已经通过。** 本项目对「已验证 / 未验证」的区分非常严格，
> 一句诚实的「本机没有 Docker，这段只做了机制说明」远比一个假的「已测试」有价值。

提交 PR 后，仓库的 GitHub Actions 工作流（`.github/workflows/build.yml`）
会自动跑一遍 `npm ci` + `npm run build`，并上传构建产物。
**PR 上的这次 CI 构建失败，就意味着你的改动会让站点构建中止，必须先修好。**
构建成功的 PR 会额外产出一个 `dist.zip` artifact，可下载后解压直接预览效果。

---

## 5. 审核与合并

维护者会按这几个维度审核：技术准确性、引用依据是否真实可查、
是否符合第 3 节的内容要求、是否动了无关文件、CI 构建是否通过。

维护者可能会要求你：补充依据、调整表述、拆分过大的 PR、
或先就方向开 Issue 讨论。**提交 PR 不代表修改一定会被合并。**

---

## 6. 许可

本仓库采用双许可，详见 [LICENSE](LICENSE) 与 [CONTENT-LICENSE.md](CONTENT-LICENSE.md)：

- **程序代码** → [MIT License](LICENSE)；
- **原创课程内容** → [CC BY 4.0（署名 4.0 国际版）](CONTENT-LICENSE.md)。

**提交 Pull Request 即表示你同意**：你所提交的代码按 MIT License 发布，
所提交的课程内容按 CC BY 4.0 发布。请确认你有权做出这个授权。

如果你引入了任何第三方材料（文字、代码片段、图片、字体等），
必须在 PR 中说明其来源与许可，且不得与上述双许可冲突。
第三方依赖与不属于本项目的第三方材料，**不在**本项目许可范围内，
它们保留各自的原有授权条件——边界清单见 [CONTENT-LICENSE.md](CONTENT-LICENSE.md) 第三节。

---

## 7. 相关文档

- [README.md](README.md)：项目定位、本地安装与构建、部署方式、常见问题
- [docs/deployment.md](docs/deployment.md)：完整部署步骤（Nginx、静态托管、局域网、更新与回滚）
- [docs/project-file-inventory.md](docs/project-file-inventory.md)：每一类文件的作用、能否删除、打包取舍
- [`_content-plan.md`](_content-plan.md)：章节规划与写作规范
- [CONTENT-LICENSE.md](CONTENT-LICENSE.md)：内容许可与许可边界

再次感谢每一位让这份知识库更准确、更易学的贡献者。
