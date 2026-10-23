# 内容许可说明（CONTENT-LICENSE）

本项目采用**双许可**：程序代码与原创课程内容分别授权。本文件说明课程内容的那一半，
以及两份许可各自的边界。

| 授权对象 | 许可证 | 文本位置 |
| --- | --- | --- |
| 程序代码 | MIT License | [LICENSE](LICENSE) |
| 原创课程内容 | CC BY 4.0（署名 4.0 国际版） | 本文件 |

---

## 一、课程内容：CC BY 4.0

仓库中由本项目原创撰写的技术课程内容，采用
[知识共享署名 4.0 国际许可协议（Creative Commons Attribution 4.0 International，CC BY 4.0）](https://creativecommons.org/licenses/by/4.0/deed.zh-hans)授权。

- 许可摘要（中文，便于阅读，非法律文本）：<https://creativecommons.org/licenses/by/4.0/deed.zh-hans>
- 法律文本（英文，具有法律效力）：<https://creativecommons.org/licenses/by/4.0/legalcode>

### 你可以做什么

在遵守下述署名条件的前提下，**无需另行取得授权**，你可以：

- **分享 / 转载**：以任何媒介或格式复制、发行本课程内容，包括整站镜像与部分章节摘录；
- **修改 / 改编**：翻译、改写、节选、重新组织、与其它材料合并；
- **二次发布**：把修改后的版本发布在你自己的网站、仓库、文档系统或印刷物中；
- **商业使用**：用于收费课程、付费专栏、企业内部培训、商业产品文档等营利性用途。

许可人不得撤回这些授权，只要你在继续使用期间遵守许可条款。

### 你必须做什么（署名条件）

CC BY 4.0 是**署名型**许可，唯一的核心条件是**适当署名（Attribution）**，具体包含三项：

1. **适当署名**：注明原作者与作品名称，并保留原内容中已有的版权声明、许可声明、
   免责说明与指向原始出处的链接。
   例如：

   > 本文改编自 [Flygreenbaby/learns-site](https://github.com/Flygreenbaby/learns-site)
   > 《全栈学习手册》的 `linux/command-line.md`，原作者 Flygreenbaby，
   > 依据 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.zh-hans) 使用。

2. **提供许可链接**：给出 CC BY 4.0 许可的链接
   （<https://creativecommons.org/licenses/by/4.0/deed.zh-hans>）。

3. **说明修改情况**：如果你对原内容做了任何修改，必须明确指出「已修改」，
   并最好简要说明改了什么。不能让读者误以为修改后的版本仍出自原作者。

署名方式可以按媒介合理调整（例如页脚、随文脚注、仓库 README、视频简介），
但不能暗示原作者为你或你的用途背书——**CC BY 4.0 不授予任何商标权或背书权**。

### 你不得做什么

- 不得附加法律条款或采取技术措施（如 DRM），限制他人行使本许可已授予的权利；
- 不得把课程内容重新声明为「保留所有权利」或套用更严格的许可；
- 本项目按「原样」提供内容，**不对其准确性、完整性或适用性作任何担保**，
  也不对使用后果承担责任。技术内容会随上游版本演进而过时，使用前请自行核对官方文档。

### CC BY 4.0 覆盖哪些文件

- 17 个领域目录下的全部原创 Markdown 正文、练习与答案解析：
  `html/`、`css/`、`javascript/`、`typescript/`、`vue/`、`react/`、`frontend-engineering/`、
  `backend/`、`database/`、`data-storage/`、`message-queue-cloud/`、`linux/`、`devops/`、
  `computer-science/`、`realtime/`、`ai-apps/`、`mobile/`；
- `guide/` 下的使用说明与学习路线；
- 根 `index.md` 首页文案；
- 各领域 `index.md` 中的定位说明与状态说明文字；
- 课程配套的教学示例 `public/examples/`。

---

## 二、程序代码：MIT License

站点框架代码采用 [MIT License](LICENSE) 授权，
文本参见 [Open Source Initiative 的 MIT 许可模板](https://opensource.org/license/mit)
与 [SPDX 标识符 `MIT`](https://spdx.org/licenses/MIT.html)。

MIT 覆盖：

- 站点配置与数据源：`.vitepress/config.mts`、`.vitepress/domains.ts`；
- 自定义主题：`.vitepress/theme/` 下的 `index.ts`、`style.css` 与全部 Vue 组件
  （`Callout`、`Exercise`、`RoadmapTable`、`StatusBadge`、`HomeDomains`）；
- 各领域 `_sidebar.ts` 侧边栏定义；
- 校验与生成脚本：`scripts/` 下的 `.cjs` 文件；
- CI 工作流：`.github/workflows/`；
- 工程配置：`package.json`、`package-lock.json`、`tsconfig.json`。

**同一文件同时包含代码与讲解文字时**（例如领域 `index.md` 里的说明文字），
代码部分按 MIT、文字部分按 CC BY 4.0 处理，两份许可并行生效、互不覆盖。

---

## 三、许可边界：哪些**不**在本项目许可范围内

这一点必须说清楚，避免误用。

**本项目两份许可都不覆盖以下内容，它们各自保留原有的授权条件：**

1. **第三方依赖**。`package.json` 中声明的开发依赖 VitePress、TypeScript、vue-tsc，
   以及它们的传递依赖（Vite、Vue、MiniSearch 等），各自遵循其上游许可证，
   具体版本见 `package-lock.json`。`npm ci` 安装得到的 `node_modules/` 不属于本项目作品。

2. **构建产物中由上游打包带入的资产**。`.vitepress/dist/` 里的运行时 JS、CSS，
   以及 14 个 `inter-*.woff2` 字体文件（[Inter 字体，采用 SIL Open Font License 1.1](https://github.com/rsms/inter)），
   均由 VitePress 在构建时带入，遵循各自的许可，不因它们出现在本项目产物中就转为 MIT 或 CC BY 4.0。

3. **不属于本项目原创的第三方材料**。本项目只以链接形式引用外部规范与官方文档，
   不转载其正文。例如 `javascript/` 章节与 [javascript.info](https://javascript.info/)
   配套使用，但 javascript.info 的正文不属于本项目，其权利与许可归原作者所有。
   课程正文中引用的第三方文档、规范、代码片段，版权均归各自权利人，
   使用时必须注明原始出处并遵守其原有许可。

4. **贡献者提交前需自行确认权属**。提交 Pull Request 即表示你确认自己有权以
   对应许可证（代码 MIT / 内容 CC BY 4.0）授权所提交的修改；引入的任何第三方材料，
   须在 PR 中说明来源与许可，且不得与本项目的双许可冲突。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 四、常见疑问

**问：我可以把这个站点整站部署到自己域名下收费访问吗？**
可以。CC BY 4.0 允许商业使用，MIT 允许任意使用代码。条件是做好署名、给出许可链接、
说明你是否修改过内容。

**问：我可以只抄其中一章放进我的付费课程吗？**
可以，同样只需满足署名条件。

**问：我可以把它改成「禁止转载」再发布吗？**
不可以。修改版仍是演绎作品，必须继续以 CC BY 4.0 授权，不得附加更严格的限制。

**问：署名必须写在每一页吗？**
不必。按媒介合理即可——网站可放页脚或「关于」页，仓库可放 README，
视频可放简介，印刷物可放版权页。

**问：内容出错了谁负责？**
两份许可都按「原样」提供，不含任何担保。发现错误请通过
[GitHub Issues](https://github.com/Flygreenbaby/learns-site/issues) 反馈，
或直接提交 PR 修正。
