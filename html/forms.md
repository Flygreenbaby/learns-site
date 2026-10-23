# 表单：控件、label 与原生校验

表单是 HTML 里最复杂的部分——它有二十多种输入类型、一整套内置校验系统、以及与浏览器功能（自动填充、密码管理器、输入法）的深度集成。

大多数人对表单的认知停留在「写几个 input，用 JS 取值再发请求」。这种做法放弃了浏览器提供的全部能力，结果是：密码管理器不工作、手机上弹出错误的键盘、用户填错了没有提示、读屏软件读不出错误在哪。

**核心原则：能用 HTML 原生能力做到的，就不要用 JavaScript 重写。** 原生行为免费获得了无障碍、移动端适配、浏览器集成，而手写版本几乎一定会漏掉其中几项。

## form 元素与数据如何提交

```html
<form action="/api/login" method="post">
  <label for="email">邮箱</label>
  <input type="email" id="email" name="email" required>

  <label for="password">密码</label>
  <input type="password" id="password" name="password" required>

  <button type="submit">登录</button>
</form>
```

### method 与 action

| 属性 | 说明 |
| --- | --- |
| `action` | 提交到哪个 URL。省略则提交到当前页面 URL |
| `method` | `get`（默认）或 `post`（严格来说还支持 `dialog`，用于 `<dialog>` 内的表单） |
| `enctype` | 提交数据的编码方式，只在 `method="post"` 时有意义 |
| `target` | 在哪个浏览上下文里打开响应，取值同 `<a target>` |

`method="get"` 时，表单数据被编码进 URL 的查询字符串：

```
/search?q=css&lang=zh
```

**GET 的适用场景是「查询」**——请求是幂等的、无副作用的、结果可以被缓存和分享。搜索框、筛选器应当用 GET，这样用户可以把搜索结果页的 URL 发给别人。

**POST 用于「改变服务器状态」**——登录、注册、提交订单、发表评论。

<Callout type="danger" title="绝不要用 GET 提交密码">

GET 的数据在 URL 里，会被记录到浏览器历史、服务器访问日志、代理日志，还会通过 Referer 头泄露给第三方资源。密码、token、任何敏感信息都必须用 POST。

</Callout>

### enctype：三种编码方式

| 值 | 用途 |
| --- | --- |
| `application/x-www-form-urlencoded` | **默认**。数据编码为 `key=value&key2=value2`，特殊字符百分号编码 |
| `multipart/form-data` | **文件上传必须用这个**。每个字段作为一个独立部分发送，不做 URL 编码 |
| `text/plain` | 几乎不用。只把空格转成 `+`，不做其他编码 |

上传文件的表单如果忘了写 `enctype="multipart/form-data"`，服务器收到的 `file` 字段会是文件名字符串而不是文件内容——这是一个非常常见的错误。

### 提交时到底发生了什么

1. 浏览器执行**约束校验（constraint validation）**。任何控件不满足 `required`、`pattern`、`min`/`max` 等约束，提交被阻止，浏览器显示内置的错误提示气泡。
2. 校验通过后，浏览器收集所有**成功的控件**（successful controls）的 `name`/`value`。
3. 按 `enctype` 编码，用 `method` 发送到 `action`。
4. 浏览器导航到响应的 URL。

「成功的控件」有明确规则，这解释了几个常见困惑：

- **没有 `name` 属性的控件不会被提交**。这是初学者最常犯的错——用 `id` 或 JS 变量名代替了 `name`。
- **未选中的 checkbox 和 radio 不会被提交**（不是提交空值，而是完全不出现在数据里）。
- **`disabled` 的控件不会被提交**；`readonly` 的控件**会**被提交。这个区别很重要。
- **被 `<button type="submit">` 之外的方式提交**（比如按 Enter）时，`submitter` 信息可能不同。

## label：必须正确关联

```html
<!-- 方式 1：for + id（推荐） -->
<label for="email">邮箱</label>
<input type="email" id="email" name="email">

<!-- 方式 2：包裹（隐式关联） -->
<label>
  邮箱
  <input type="email" name="email">
</label>
```

两种方式效果相同，但**方式 1 更可靠**——方式 2 在某些读屏软件和自动化测试工具里支持不完整。

`label` 正确关联后带来三个真实收益：

1. **点击标签文字等于点击输入框**。这对 checkbox 和 radio 尤其重要——它们的点击目标只有十几像素，加上 label 后整个「□ 我同意条款」都可以点。
2. **读屏软件聚焦到输入框时会朗读 label 内容**。没有 label，用户听到的是「编辑框」，完全不知道要填什么。
3. **浏览器自动填充能正确识别字段**。没有 label（或 `autocomplete`）时，密码管理器不知道该往哪个框里填邮箱、哪个填密码。

<Callout type="warn" title="placeholder 不能代替 label">

`placeholder` 是「输入格式的示例提示」，不是标签。三个问题：

1. 用户一开始输入，placeholder 就消失了，看不到字段是什么。
2. 默认的浅灰色对比度通常不满足 WCAG 的对比度要求。
3. 部分读屏软件不朗读 placeholder。

正确用法是**两者都有**，各司其职：

```html
<label for="phone">手机号</label>
<input type="tel" id="phone" name="phone" placeholder="13800138000" autocomplete="tel">
```

</Callout>

## input 类型全景

`type` 不只是换个样式——它会改变**校验规则、移动端键盘、浏览器自动填充行为**。

### 文本类

| type | 校验 | 移动端键盘 | 用途 |
| --- | --- | --- | --- |
| `text` | 无 | 默认 | 兜底 |
| `email` | 必须像邮箱 | 带 `@` 和 `.` | 邮箱 |
| `password` | 无（但输入被遮蔽） | 默认 | 密码 |
| `tel` | **无内置校验** | 数字拨号盘 | 电话号码 |
| `url` | 必须是合法 URL | 带 `.com` 和 `/` | 网址 |
| `search` | 无 | 显示「搜索」键 | 搜索框 |
| `number` | 必须是数字 | 数字键盘 | 数值 |

**`tel` 不做校验是一个常见意外**。因为全球电话号码格式差异太大（区号、分隔符、长度），标准没有规定统一格式。需要校验就自己加 `pattern`：

```html
<input type="tel" name="phone" pattern="1[3-9]\d{9}"
       title="请输入 11 位中国大陆手机号">
```

**`number` 有几个坑**：
- 它允许输入 `e`、`E`、`+`、`-`（因为科学计数法是合法数字），这可能不是你想要的。
- 如果用户输入了非法内容（如 `12a`），`input.value` 会返回**空字符串**而不是用户实际输入的文本。要拿原始输入得用 `input.value` 之外的方式，或者干脆用 `type="text"` + `inputmode="numeric"` + `pattern`。
- 手机号、邮编、验证码**不应当用 `number`**——它们虽然由数字组成，但不是「数值」（前导零有意义、不做算术）。用 `text` + `inputmode="numeric"`。

### 选择类

```html
<!-- 单选：同组的 name 必须相同 -->
<fieldset>
  <legend>订阅频率</legend>
  <label><input type="radio" name="freq" value="daily" checked> 每天</label>
  <label><input type="radio" name="freq" value="weekly"> 每周</label>
  <label><input type="radio" name="freq" value="never"> 从不</label>
</fieldset>

<!-- 单个复选框：提交 value 或完全不提交 -->
<label>
  <input type="checkbox" name="agree" value="yes" required>
  我已阅读并同意服务条款
</label>

<!-- 多个复选框：同 name，每个选中项单独提交一次 -->
<fieldset>
  <legend>感兴趣的方向</legend>
  <label><input type="checkbox" name="topics" value="frontend"> 前端</label>
  <label><input type="checkbox" name="topics" value="backend"> 后端</label>
  <label><input type="checkbox" name="topics" value="devops"> 运维</label>
</fieldset>
```

**复选框提交数据的形状**是重点：

- 单个 checkbox 不带 `value` 属性时，选中后提交的值是字符串 `"on"`。所以**总是显式写 `value`**。
- 多个同 `name` 的 checkbox，选中几个就提交几次：`topics=frontend&topics=devops`。后端框架通常会把重复的 key 解析成数组。
- **未选中的 checkbox 完全不出现**在提交数据里。所以后端不能假设「字段不存在 = 用户填了空」，它可能是「没勾选」也可能是「表单里根本没这个字段」。这是很多 bug 的来源。

如果需要区分「没勾选」和「字段缺失」，一个常见技巧是在 checkbox 前放一个同名隐藏字段：

```html
<input type="hidden" name="subscribe" value="0">
<input type="checkbox" name="subscribe" value="1">
```

未勾选时提交 `subscribe=0`，勾选时提交 `subscribe=0&subscribe=1`（后端取最后一个或解析为数组）。

### 其他类型

```html
<input type="date" name="birthday">           <!-- 日期选择器 -->
<input type="time" name="alarm">              <!-- 时间 -->
<input type="datetime-local" name="meeting">  <!-- 日期+时间，无时区 -->
<input type="month" name="bill">              <!-- 年月 -->
<input type="week" name="sprint">             <!-- 年+周 -->
<input type="color" name="theme">             <!-- 取色器，值形如 #ff0000 -->
<input type="range" min="0" max="100" step="5" name="volume">  <!-- 滑块 -->
<input type="file" name="avatar" accept="image/png,image/jpeg"> <!-- 文件 -->
<input type="hidden" name="csrf_token" value="abc123">          <!-- 隐藏字段 -->
```

`accept` 只是**文件选择器的过滤提示**，不是安全校验——用户可以切换到「所有文件」绕过。**服务端必须自己校验文件类型和大小**，绝不能依赖 `accept`。

`multiple` 属性可以让 `file` 支持多选、让 `email` 支持多个邮箱：

```html
<input type="file" name="photos" accept="image/*" multiple>
```

## select、textarea、button

### select

```html
<label for="city">城市</label>
<select id="city" name="city">
  <option value="">请选择</option>
  <optgroup label="华东">
    <option value="shanghai">上海</option>
    <option value="hangzhou">杭州</option>
  </optgroup>
  <optgroup label="华北">
    <option value="beijing" selected>北京</option>
  </optgroup>
</select>

<!-- 多选 -->
<select name="skills" multiple size="5">
  <option value="html">HTML</option>
  <option value="css">CSS</option>
</select>
```

**关键点：提交的是 `value`，不是标签文字。** 如果 `<option>` 没有 `value` 属性，提交的就是标签文字本身——这在做国际化或改文案时会破坏后端逻辑，所以**总是显式写 `value`**。

`<optgroup label="...">` 用于分组，它的 `label` 只是显示用的组名，**不会被提交**。

第一个 `<option value="">请选择</option>` 是常见做法，作用是让 `select` 有一个「未选择」的初始状态，配合 `required` 强制用户主动选：

```html
<select name="city" required>
  <option value="" disabled selected>请选择</option>
  ...
</select>
```

`disabled` 让这个占位项选中后不能再被选回，`selected` 让它成为初始值，`required` 会因为值为空字符串而阻止提交。

### textarea

```html
<label for="message">留言</label>
<textarea id="message" name="message" rows="5" maxlength="500"
          placeholder="最多 500 字"></textarea>
```

- `rows` / `cols` 设定初始尺寸（但用户通常可以用右下角拖拽改变，由 CSS `resize` 控制）。
- **`textarea` 里没有 `value` 属性**，初始值就是标签之间的文本内容。
- `textarea` 内的空白是敏感的（默认 `white-space: pre-wrap`），所以标签内不要为了排版加缩进：

```html
<!-- 错误：初始值会带上前导空白和换行 -->
<textarea>
  默认内容
</textarea>

<!-- 正确 -->
<textarea>默认内容</textarea>
```

### button 的三种 type

```html
<button type="submit">提交</button>   <!-- 默认值 -->
<button type="reset">重置</button>
<button type="button">普通按钮</button>
```

<Callout type="danger" title="button 的默认 type 是 submit">

在 `<form>` 里写 `<button>点我</button>` 而不写 `type`，它会**提交表单**。这是大量「点一个按钮结果页面刷新了」bug 的原因。

**规则：表单内任何不是用来提交的按钮，都必须显式写 `type="button"`。**

同时，`<input type="submit">` 和 `<button type="submit">` 都能提交表单，但 `<button>` 内部可以放 HTML（图标、`<span>`），`<input>` 只能是纯文本。**优先用 `<button>`。**

</Callout>

用户按 `Enter` 也会提交表单——具体规则是：如果表单里有一个 submit 按钮，按 Enter 会触发它；如果表单只有一个文本输入框且没有 submit 按钮，按 Enter 也会提交（这是标准规定的行为）。

## fieldset 与 legend：给控件分组

```html
<fieldset>
  <legend>收货地址</legend>
  <label for="province">省份</label>
  <input type="text" id="province" name="province">
  <label for="street">街道</label>
  <input type="text" id="street" name="street">
</fieldset>
```

`<legend>` 是这一组的标题。读屏软件在用户进入组内任意控件时会先播报 legend，用户因此知道「我现在填的是收货地址部分」。

**radio 组必须用 `fieldset` + `legend`**。因为单个 radio 的 label 只说明了它自己（「每天」），不说明这组是在问什么（「订阅频率」）。没有 legend，读屏用户听到的是一串「每天 / 每周 / 从不」而不知道在选什么。

`fieldset` 有一个 CSS 上的历史包袱：它默认有一些浏览器特有的样式（边框、padding），且在某些浏览器里 `display: flex/grid` 曾经不生效。现代浏览器已基本解决，但如果遇到布局异常，可以给 fieldset 显式设 `display` 或 `min-width: 0`。

一个实用技巧：`<fieldset disabled>` 会一次性禁用组内所有控件，适合做「提交中，禁用整个表单」：

```html
<fieldset disabled id="form-fields">
  <!-- 所有控件都被禁用 -->
</fieldset>
```

## 原生校验：约束校验 API

浏览器有一整套内置校验系统，用 HTML 属性声明规则即可，不需要写 JS。

### 校验属性

| 属性 | 作用 | 适用 |
| --- | --- | --- |
| `required` | 不能为空 | 大部分控件 |
| `minlength` / `maxlength` | 字符数下限/上限 | 文本类 |
| `min` / `max` | 数值或日期的下限/上限 | `number`、`range`、日期类 |
| `step` | 数值步长 | `number`、`range`、日期类 |
| `pattern` | 正则表达式（必须完全匹配） | `text`、`tel`、`email`、`url`、`password`、`search` |
| `type` 本身 | 类型校验 | `email`、`url`、`number` |

```html
<label for="username">用户名</label>
<input type="text" id="username" name="username"
       required minlength="3" maxlength="20"
       pattern="[a-zA-Z0-9_]+"
       title="3-20 个字符，只能是字母、数字和下划线">
```

**`pattern` 有三个必须知道的细节**：

1. **它是完全匹配**，浏览器会自动在正则两端加 `^` 和 `$`。所以 `pattern="abc"` 要求整个值就是 `abc`，不是「包含 abc」。
2. **不要写 `/` 分隔符**。`pattern="/[a-z]+/"` 是错的，正则会被当成字面量。
3. **`title` 属性会作为错误提示的一部分显示**。不写 `title` 的话，用户看到的是浏览器默认的模糊提示（如「请与所请求的格式匹配」），完全不知道该填什么。**写了 `pattern` 就必须写 `title`。**

### 校验状态与 CSS 伪类

```css
/* 校验不通过时 */
input:invalid {
  border-color: var(--color-danger);
}

/* 校验通过时 */
input:valid {
  border-color: var(--color-success);
}
```

<Callout type="danger" title=":invalid 的时机陷阱">

页面**刚加载时**，所有 `required` 但还没填的字段就已经是 `:invalid` 状态了。所以直接写 `input:invalid { border-color: red }` 会导致表单打开就一片红——用户还没开始填就被指责。

正确做法是用 `:user-invalid`（用户已经交互过之后才生效）：

```css
input:user-invalid {
  border-color: var(--color-danger);
}
```

`:user-invalid` 是较新的伪类，浏览器支持度请以 [MDN 的 :user-invalid 页面](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:user-invalid)（仅英文版）的兼容性表为准。如果不支持，可以用 JS 配合 `submitted` class 手动控制。

</Callout>

### JavaScript 侧的 API

```js
const form = document.querySelector('form')
const input = document.querySelector('#email')

// 手动检查整个表单是否通过校验（不显示提示气泡）
form.checkValidity()   // true / false

// 检查并显示浏览器的提示气泡
form.reportValidity()  // true / false

// 读取具体是哪个约束失败了
input.validity
// { valueMissing: false, typeMismatch: true, patternMismatch: false,
//   tooShort: false, tooLong: false, rangeUnderflow: false,
//   rangeOverflow: false, stepMismatch: false, valid: false, ... }

input.validationMessage  // 浏览器生成的错误文案
```

`validity` 是一个 `ValidityState` 对象，每个属性对应一种失败原因。用它就能精确判断问题类型，比正则匹配 `validationMessage` 可靠得多。

### 自定义错误文案

浏览器的默认文案（如「请填写此字段」）常常不够具体。可以用 `setCustomValidity` 覆盖：

```js
const input = document.querySelector('#username')

input.addEventListener('input', () => {
  if (input.validity.patternMismatch) {
    input.setCustomValidity('用户名只能包含字母、数字和下划线')
  } else if (input.validity.tooShort) {
    input.setCustomValidity(`至少需要 ${input.minLength} 个字符，当前 ${input.value.length} 个`)
  } else {
    // 必须清空，否则字段会一直保持 invalid 状态
    input.setCustomValidity('')
  }
})
```

<Callout type="warn" title="setCustomValidity 的关键陷阱">

设置了非空的自定义消息后，该字段会**一直保持 invalid 状态**，直到你把消息清空（`setCustomValidity('')`）。忘记清空会导致表单永远无法提交，且错误提示不消失。

</Callout>

### 关闭原生校验

```html
<!-- 整个表单 -->
<form novalidate>

<!-- 单个提交按钮 -->
<button type="submit" formnovalidate>存为草稿</button>
```

`novalidate` 关闭浏览器的校验拦截，让你完全用 JS 接管。**什么时候该这么做**：当你需要自定义错误提示的样式和位置（比如把错误信息显示在字段下方而不是气泡里），或者需要在提交前做异步校验（比如检查用户名是否已存在）。

关闭 `novalidate` 之后，HTML 属性声明的约束**仍然生效**，`input.validity` 仍然可用——你只是接管了「什么时候提示、怎么提示」。这是推荐的做法：**用 HTML 声明规则，用 JS 控制呈现。**

## autocomplete 与 inputmode

### autocomplete：让密码管理器工作

```html
<input type="email" name="email" autocomplete="username">
<input type="password" name="password" autocomplete="current-password">
```

登录页的正确写法：

```html
<form action="/api/login" method="post">
  <input type="text" name="username" autocomplete="username" required>
  <input type="password" name="password" autocomplete="current-password" required>
  <button type="submit">登录</button>
</form>
```

注册/改密页：

```html
<input type="password" name="new_password" autocomplete="new-password" required>
<input type="password" name="confirm" autocomplete="new-password" required>
```

常用 token：

| token | 用途 |
| --- | --- |
| `username` | 用户名/账号 |
| `current-password` | 登录密码 |
| `new-password` | 注册或改密时的新密码 |
| `one-time-code` | 短信/邮箱验证码 |
| `email`、`tel`、`name` | 联系信息 |
| `street-address`、`address-line1`、`postal-code`、`country` | 地址 |
| `cc-number`、`cc-exp`、`cc-csc` | 信用卡 |
| `off` | 明确关闭自动填充 |

**为什么这很重要**：浏览器的密码管理器靠 `autocomplete`（以及 `type`、`name`、`id` 的启发式推断）来判断哪个框是用户名、哪个是密码。写错了，用户会遇到「保存了密码但下次登录不自动填充」，或者「密码被填进了用户名框」。

<Callout type="warn" title="autocomplete='off' 常常无效">

出于安全考虑，**浏览器会忽略密码字段上的 `autocomplete="off"`**。如果你的目的是防止敏感信息被记住，正确的做法是不要把敏感信息放在表单里，或者用 `autocomplete="new-password"`（浏览器会生成随机密码而不是记住旧的）。

</Callout>

### inputmode：控制移动端键盘

`type` 决定了校验，`inputmode` 只决定**移动端弹出哪个键盘**：

```html
<!-- 验证码：纯数字，但不是数值，所以用 text + inputmode -->
<input type="text" name="code" inputmode="numeric" pattern="\d{6}" maxlength="6"
       autocomplete="one-time-code" title="6 位数字验证码">

<!-- 金额：数字带小数点 -->
<input type="text" name="amount" inputmode="decimal">

<!-- 明确不要任何自动纠错和联想（如密码、验证码） -->
<input type="text" inputmode="none" autocomplete="off">
```

取值：`none`、`text`、`decimal`、`numeric`、`tel`、`search`、`email`、`url`。

**`inputmode="numeric"` vs `type="number"` 的选择**：手机号、邮编、验证码、订单号这类「由数字组成但不是数值」的字段，用 `type="text"` + `inputmode="numeric"` + `pattern`。因为 `type="number"` 会带来前导零丢失、允许 `e` 字符、非法输入时 `value` 为空等问题。

## 可访问的错误提示

原生校验的气泡提示有个缺陷：读屏软件用户可能不知道错误出现在哪个字段。要做完整，需要把错误信息通过 `aria-describedby` 关联到字段上：

```html
<label for="email">邮箱</label>
<input type="email" id="email" name="email" required
       aria-describedby="email-error" aria-invalid="false">
<p id="email-error" class="error" hidden>请输入有效的邮箱地址</p>
```

```js
input.addEventListener('invalid', () => {
  const error = document.getElementById('email-error')
  error.textContent = input.validationMessage
  error.hidden = false
  input.setAttribute('aria-invalid', 'true')
})
```

更完整的做法是把提交后所有错误汇总在表单顶部，并提供跳转链接，让用户不用逐个字段找错误。这属于无障碍进阶内容，详见[HTML 层面的无障碍](/html/accessibility)。

## 常见错误与排查

### 症状：提交后后端收不到某个字段

按顺序排查：
1. 这个控件有 `name` 属性吗？**没有 `name` 就不会被提交。**（`id` 不算）
2. 控件是 `disabled` 吗？disabled 的控件不提交，`readonly` 的会提交。
3. 是 checkbox/radio 吗？未选中的不提交。
4. 控件在 `<form>` 标签**外面**吗？可以用 `form="formId"` 属性关联，否则不提交。
5. 是 `<button type="submit">` 在 form 外面吗？同样需要 `form` 属性关联。

### 症状：点了一个普通按钮，页面刷新了

**原因**：`<button>` 默认 `type="submit"`。加 `type="button"`。

### 症状：表单打开时字段就是红色的

**原因**：`:invalid` 在页面加载时就对空的必填字段生效。改用 `:user-invalid`，或者用 JS 在表单提交过后才加 `submitted` class。

### 症状：设置了 setCustomValidity 后表单再也提交不了

**原因**：没有在校验通过时调用 `setCustomValidity('')` 清空。见前文。

### 症状：文件上传后端收到的是文件名字符串

**原因**：`<form>` 少了 `enctype="multipart/form-data"`。

### 症状：手机上填手机号弹出的是全键盘

**原因**：用了 `type="text"` 且没有 `inputmode`。加 `inputmode="numeric"`（不要用 `type="number"`，理由见前文）。

### 症状：密码管理器不自动填充

按顺序检查：
1. `autocomplete="username"` / `current-password` / `new-password` 写了吗？
2. 密码字段的 `type` 是 `password` 吗（不是 `text` 加 CSS 遮蔽）？
3. 登录表单是不是一个真正的 `<form>`？用 div 拼的「表单」浏览器识别不了。
4. 表单提交后有没有真的发生导航？SPA 里用 JS 拦截提交、URL 不变，浏览器可能不认为是成功的登录。

## 练习

<Exercise title="练习 1 · 写一个注册表单" difficulty="基础">

写一个注册表单，要求：

- 用户名：必填，3–20 个字符，只能字母数字下划线
- 邮箱：必填，必须是邮箱格式
- 手机号：必填，11 位中国大陆手机号，移动端弹数字键盘
- 密码：必填，至少 8 位，浏览器不应记住它（这是注册）
- 确认密码：必填，与密码一致（这一项需要 JS）
- 感兴趣的领域：多选，选项为前端/后端/运维
- 同意条款：必须勾选
- 出生日期：用日期选择器，不能是未来

要求：全部用原生 HTML 校验，`label` 正确关联，`autocomplete` 写对，错误提示文案清晰。

<template #answer>

```html
<form action="/api/register" method="post" novalidate>
  <fieldset>
    <legend>创建账户</legend>

    <p>
      <label for="username">用户名</label>
      <input type="text" id="username" name="username"
             required minlength="3" maxlength="20" pattern="[a-zA-Z0-9_]+"
             title="3-20 个字符，只能是字母、数字和下划线"
             autocomplete="username">
      <span class="error" id="username-error" hidden></span>
    </p>

    <p>
      <label for="email">邮箱</label>
      <input type="email" id="email" name="email" required
             autocomplete="email">
      <span class="error" id="email-error" hidden></span>
    </p>

    <p>
      <label for="phone">手机号</label>
      <input type="tel" id="phone" name="phone" required
             pattern="1[3-9][0-9]{9}" maxlength="11"
             inputmode="numeric" autocomplete="tel"
             title="请输入 11 位中国大陆手机号">
      <span class="error" id="phone-error" hidden></span>
    </p>

    <p>
      <label for="password">密码</label>
      <input type="password" id="password" name="password" required
             minlength="8" autocomplete="new-password"
             title="至少 8 个字符">
      <span class="error" id="password-error" hidden></span>
    </p>

    <p>
      <label for="password-confirm">确认密码</label>
      <input type="password" id="password-confirm" name="password_confirm" required
             autocomplete="new-password">
      <span class="error" id="password-confirm-error" hidden></span>
    </p>

    <p>
      <label for="birthday">出生日期</label>
      <input type="date" id="birthday" name="birthday" required
             max="2026-10-16" autocomplete="bday">
      <span class="error" id="birthday-error" hidden></span>
    </p>
  </fieldset>

  <fieldset>
    <legend>感兴趣的领域（可多选）</legend>
    <label><input type="checkbox" name="topics" value="frontend"> 前端</label>
    <label><input type="checkbox" name="topics" value="backend"> 后端</label>
    <label><input type="checkbox" name="topics" value="devops"> 运维</label>
  </fieldset>

  <p>
    <label>
      <input type="checkbox" name="agree" value="yes" required>
      我已阅读并同意<a href="/terms" target="_blank" rel="noopener">服务条款</a>
    </label>
    <span class="error" id="agree-error" hidden></span>
  </p>

  <button type="submit">注册</button>
</form>

<script>
  // 确认密码的一致性校验：HTML 属性无法表达「两个字段相等」，必须用 JS
  const password = document.getElementById('password')
  const confirm = document.getElementById('password-confirm')

  function checkMatch() {
    if (confirm.value !== password.value) {
      confirm.setCustomValidity('两次输入的密码不一致')
    } else {
      // 必须清空，否则字段会永远保持 invalid
      confirm.setCustomValidity('')
    }
  }
  confirm.addEventListener('input', checkMatch)
  password.addEventListener('input', checkMatch)
</script>
```

**每个决策的理由**：

- **`method="post"`**：注册改变服务器状态，且包含密码，绝不能用 GET。
- **`autocomplete="new-password"`**：告诉密码管理器这是新密码，应当提示生成强密码而不是填充已保存的旧密码。确认密码字段也写 `new-password`。
- **手机号用 `type="tel"` 而不是 `type="number"`**：`number` 会丢失前导零、允许 `e` 字符、且非法输入时 `value` 返回空字符串。手机号是「由数字组成的标识符」而非数值。
- **`inputmode="numeric"`**：让移动端弹数字键盘。注意 `type="tel"` 本身也会触发数字键盘，两者一起写兼容性最好。
- **`pattern="1[3-9][0-9]{9}"`**：不写 `/` 分隔符；浏览器自动加 `^...$` 做完全匹配。
- **每个 `pattern` 都配了 `title`**：否则用户看到的是浏览器默认的模糊提示。
- **出生日期用 `max`**：值应当动态生成（今天的日期），这里写死只是为了示例。实际项目应当用 JS 设置 `birthday.max = new Date().toISOString().slice(0, 10)`。
- **同意条款用包裹式 label**：让整行「□ 我已阅读并同意服务条款」都可以点击，而不是只有那个 13×13 像素的方框。
- **`novalidate`**：这里加上是为了演示自定义错误提示的位置（`<span class="error">`）。如果不需要自定义样式，应当去掉 `novalidate` 用浏览器原生气泡。
- **确认密码用 `setCustomValidity`**：HTML 没有「等于另一个字段」的约束，必须用 JS。注意 else 分支清空消息——这是最容易漏的一步。

**未选中的 checkbox 不提交**这一点在这里有实际影响：如果用户一个领域都不选，后端收到的数据里**完全没有 `topics` 字段**，而不是 `topics=`。后端必须用「字段可能不存在」的方式处理。

</template>

</Exercise>

<Exercise title="练习 2 · 预测提交数据" difficulty="进阶">

用户在这个表单里：勾选了「前端」和「运维」，没勾选「后端」；勾选了「同意」；没有填写备注；「记住我」没有勾选。点击提交后，服务器收到的请求体是什么？（假设 `method="post"`、默认 enctype）

```html
<form action="/api/settings" method="post">
  <input type="checkbox" name="topics" value="frontend" checked>
  <input type="checkbox" name="topics" value="backend">
  <input type="checkbox" name="topics" value="devops" checked>

  <input type="checkbox" name="agree" value="yes" checked>
  <input type="checkbox" name="remember">

  <textarea name="note"></textarea>

  <input type="hidden" name="token" value="abc123">
  <input type="text" name="nickname" value="张三" disabled>

  <button type="submit">保存</button>
</form>
```

<template #answer>

服务器收到的请求体是：

```
topics=frontend&topics=devops&agree=yes&note=&token=abc123
```

（`Content-Type: application/x-www-form-urlencoded`，实际传输中中文字符会做百分号编码，但这里没有中文被提交）

**逐项推导**：

| 控件 | 是否提交 | 原因 |
| --- | --- | --- |
| `topics=frontend`（勾选） | ✅ | 选中的 checkbox 提交 |
| `topics=backend`（未勾选） | ❌ | **未选中的 checkbox 完全不出现在数据里** |
| `topics=devops`（勾选） | ✅ | 选中的 checkbox 提交 |
| `agree=yes`（勾选） | ✅ | |
| `remember`（未勾选） | ❌ | 同 backend |
| `note`（textarea，空） | ✅ `note=` | **空的文本控件会提交空值**，与 checkbox 的行为不同 |
| `token=abc123`（hidden） | ✅ | hidden 字段总是提交 |
| `nickname=张三`（disabled） | ❌ | **`disabled` 的控件不提交**（注意：`readonly` 的会提交） |
| `<button type="submit">` | ❌ | 提交按钮本身不贡献数据（除非它有 name/value 且是被点击的那个 submitter） |

**三个关键区别**：

1. **checkbox 未选中 → 字段消失；文本框为空 → 字段存在但值为空。** 这是后端最容易出 bug 的地方。如果后端代码写成 `if (data.note !== undefined)` 来判断用户是否填了备注，那是错的——空 textarea 也会让 `note` 存在。正确判断是 `if (data.note)` 或 `if (data.note.trim() !== '')`。

2. **同 name 的多个 checkbox 提交多次**，形成 `topics=frontend&topics=devops`。后端框架的解析行为不一致：
   - Express 的 `body-parser` / `qs`：解析成数组 `['frontend', 'devops']`
   - Fastify 默认的 `application/x-www-form-urlencoded` 解析：也会得到数组
   - 但某些简化实现只会保留最后一个值 `'devops'`

   **所以后端拿到重复 key 时必须确认框架的解析行为**，不要假设。

3. **`disabled` 和 `readonly` 的区别**：`disabled` 不提交、不能聚焦、通常显示为灰色；`readonly` 会提交、能聚焦（可以选中文本复制）、用户不能修改但脚本能改。想做「用户不能改但数据要提交」的字段，用 `readonly` 或 `hidden`，不要用 `disabled`。

**验证方式**：在浏览器 Console 里可以直接看到浏览器会收集哪些数据：

```js
const form = document.querySelector('form')
new FormData(form)
// 可以迭代查看：
for (const [key, value] of new FormData(form)) {
  console.log(key, '=', value)
}
```

`FormData` 的构造规则与表单提交的「成功的控件」规则完全一致，所以这是最可靠的自检方式。

</template>

</Exercise>

## 官方文档与延伸阅读

- [WHATWG HTML 标准 · 表单](https://html.spec.whatwg.org/multipage/forms.html) —— `form`、所有 `input` 类型、`button`、`select`、`textarea`、`label`、`fieldset` 的规范定义，以及「成功的控件」的判定规则。**本章「提交时到底发生了什么」一节的依据。**
- [MDN · 表单（学习 Web 开发 / 扩展模块）](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Extensions/Forms) —— 表单的中文系列教程，比本章更侧重入门。
- [MDN · `<form>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/form) —— `method`、`action`、`enctype`、`novalidate` 的完整说明。
- [MDN · `<input>` 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/input) —— 所有 type 的索引页，每个类型都有独立的详细页面。
- [MDN · 表单数据管理](https://developer.mozilla.org/zh-CN/docs/Web/API/XMLHttpRequest_API/Using_XMLHttpRequest#sending_form_data) 与 [FormData](https://developer.mozilla.org/zh-CN/docs/Web/API/FormData) —— 练习 2 里用到的自检工具。
- [MDN · 客户端表单校验](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Extensions/Forms/Form_validation) —— 约束校验（constraint validation）API 的讲解，涉及 `ValidityState`。
- [MDN · autocomplete 属性](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Attributes/autocomplete) —— 所有合法 token 的清单。
- [MDN · inputmode 属性](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Global_attributes/inputmode)
- [MDN · `:user-invalid` 伪类](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:user-invalid) —— **该页面只有英文版**（中文站此页返回 404，2026 年 10 月核实）。注意查看浏览器兼容性表。
- WHATWG 标准里**没有** `form-control-attributes.html` 这个页面（老教程常引用它，现已 404）。`required`、`pattern` 等跨控件的通用属性定义在 [forms.html](https://html.spec.whatwg.org/multipage/forms.html) 里，别按旧链接去找。

## 下一章

表单收集数据，表格展示数据：[表格——结构、表头关联与可访问性](/html/tables)。
