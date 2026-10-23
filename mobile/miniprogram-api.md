# 生命周期、页面栈与登录链路：小程序把「谁在什么时候调用我」交给了平台

第一个故事是重复请求。一个人在 `onShow` 里拉列表数据，理由是「切回这个页面时要刷新」。测试没问题，上线后他自己发现：每次从详情页按返回键回到列表，页面都会重新加载、滚动位置回到顶部，而且服务端同一个接口被同一批用户反复调用——因为 `onShow` 不只管「页面被切回前台」，它**也管「上一个页面出栈后本页面重新显示」**。他没读生命周期表里的一句话，就把自己产品的接口调用量放大了一倍。

第二个故事是「本地能跑，线上不行」。开发时他勾了开发者工具里的「不校验请求域名」，接口用的是测试环境的域名。提审被拒后换成正式域名，真机上一片 `request 域名不合法`。原因不是代码写错，是**小程序的网络前提压根不在代码里**：域名要先在平台上登记，而且只支持 https。这一条是[第一章](/mobile/choosing-route)那句「先审核再发布」在技术层面的具体形态。

第三个故事最常见，也最贵。有人为了让登录「简单点」，把 `appsecret` 写进了小程序前端代码，用它直接换 `openid`。小程序包是可以被拆开的，**前端代码是公开物料**。这不是粗心，是不清楚那条链路为什么要拆开写：临时凭证 `code` 天生就该由服务端拿去换标识，密钥只该存在于服务端。

这三件事的共同点是：**第 3 章讲的是小程序的静态心智（两层分离决定了模板和样式长什么样），本章讲动态的那一半——谁在什么时候被调用、数据走哪条路、标识从哪来。** 而动态这半边的答案，一半在官方 API 文档里，另一半在平台配置里。你在 Web 里养成的三个默认前提，这里都要还给平台：**页面栈由浏览器历史变成你自己维护的十层栈；请求可以打到任何允许跨域的地址变成必须先登记域名；身份由你自己的会话体系变成平台签发、你再接管。**

<Callout type="verified">

**本章已核实项**（核实时间 2026-10-22，微信开放文档站内页面）：页面生命周期与 App 生命周期的官方方法清单；组件生命周期五个回调名；`wx.navigateTo` 页面所述「入栈」与页面栈上限；网络章节关于域名白名单、https/wss 协议限制、并发上限与开发环境跳过校验选项的原文；登录章节的 `code` → `code2Session` → OpenID/UnionID/session_key 链路与「`session_key` 不应下发」；分包章节的主包职责与「分包总计 30M、单个分包 2M」两项数字。

**本章未逐项核实、正文已就地标注的项**：本地存储容量上限与 API 完整清单；分包的主包单独上限、预加载与独立分包规则；页面参数的长度限制；组件样式隔离选项的取值。**这些不要引用本章，以你动手当天的官方文档为准。**

</Callout>

## 三层生命周期：App、页面、组件

小程序把「一个应用」的生命周期切成三层，各有一组回调。下表左列是官方方法名，右列是 Vue 3 里承担同样职责的位置——**对照看，别背**。

| 层级 | 官方回调 | 触发时机（官方口径） | Vue 3 / 浏览器里的对应物 | 判定 |
| --- | --- | --- | --- | --- |
| App | `onLaunch` | 小程序初始化 | 应用入口脚本顶层、`main.js` 里的 createApp | 形似神不同 |
| App | `onShow` | 小程序启动或从后台进入前台 | `visibilitychange` | 一样 |
| App | `onHide` | 小程序从前台进入后台 | `visibilitychange` | 一样 |
| 页面 | `onLoad` | 生命周期开始，收到路由参数 | `setup()` + 路由参数 | 形似神不同 |
| 页面 | `onShow` | 页面显示 | `activated`（keep-alive 场景） | 形似神不同 |
| 页面 | `onReady` | 页面初次渲染完成 | `onMounted` | 一样 |
| 页面 | `onHide` | 页面隐藏 | `deactivated` | 形似神不同 |
| 页面 | `onUnload` | 页面卸载 | `onUnmounted` | 一样 |
| 页面 | `onPullDownRefresh` | 用户下拉 | 无（要自己写触摸逻辑） | 没有 |
| 页面 | `onReachBottom` | 页面滚动到底部 | IntersectionObserver / scroll 计算 | 没有 |
| 页面 | `onPageScroll` | 页面整体滚动 | `scroll` 事件 | 一样但代价不同 |
| 页面 | `onShareAppMessage` | 用户点右上角分享 | 无 | 没有 |
| 组件 | `created` | 实例刚创建 | `setup()` | 一样 |
| 组件 | `attached` | 进入节点树 | 无（模板挂载即存在） | 没有 |
| 组件 | `ready` | 组件布局完成、可以操作节点 | `onMounted` | 一样 |
| 组件 | `moved` | 节点树移动后 | 无 | 没有 |
| 组件 | `detached` | 移出节点树并销毁 | `onUnmounted` | 一样 |

三个读法。

**一、`onLaunch` 和 `onLoad` 不等价于「组件创建」。** 它们在平台侧被调用，参数由平台塞进来（`onLoad` 直接收到路由参数对象），你不像 Vue 那样从 `route.query` 里主动取。**参数是送上门的，但只有一层结构：全是字符串。**

**二、`onReady` 只保证「初次渲染完成」。** 官方口径是渲染完成，不是数据可用。想拿到节点布局信息，要在 `onReady` 之后用平台的查询接口——不是 `document`，原因见[第 3 章](/mobile/miniprogram-model)。

**三、组件那五个回调官方推荐写在 `lifetimes` 对象里**，不与 `properties`、`data`、`methods` 平铺。读到写在顶层的旧代码不用慌，那是早期写法。

## `onShow` 为什么是个陷阱

前面那个故事的根因，是这一张表。

| 场景 | 页面 `onLoad` | 页面 `onShow` | App `onShow` | 页面 `onUnload` |
| --- | --- | --- | --- | --- |
| 首次进入页面 | 是 | 是 | 是（冷启动时） | 否 |
| 从详情页返回本页 | 否 | **是** | 否 | 否 |
| 切到别的应用再切回来 | 否 | **是** | 是 | 否 |
| 从本页跳到下一页 | 否 | 否 | 否 | 否 |
| 在本页 `redirectTo` 走掉 | 否 | 否 | 否 | **是** |

第二行和第三行都触发页面 `onShow`，**但你要做的事完全不同**：第三行是「回到前台，可能要刷新时效性数据」，第二行是「上一个页面可能改了数据，要不要同步回来」。把它们混在一个回调里处理，就会得到「返回就跳回顶部」这种体验。

三种可用的分流做法，代价从低到高：

```js
// 做法一：首次加载放 onLoad，onShow 只在「别的页面把我标脏了」时才刷新
Page({
  data: { list: [], loaded: false },
  onLoad() { this.fetchList(); },
  onShow() {
    if (this.data.loaded && getApp().globalData.listDirty) {
      getApp().globalData.listDirty = false;
      this.fetchList();
    }
  },
  fetchList() {
    wx.request({ url: 'https://example.com/api/items', success: (res) => this.setData({ list: res.data.items }) });
  }
});
```

```js
// 做法二：详情页编辑成功后，只通知上一页更新那一条，避免「刷新一切」
const prev = getCurrentPages()[getCurrentPages().length - 2];
if (prev && prev.onItemUpdated) prev.onItemUpdated(item);
wx.navigateBack();
```

**做法三：把时效性判断挪到服务端**——返回时不带参数请求一个轻量的「自上次同步以来是否变化」接口，变了再拉全量。这条最贵，也最适合真正需要实时的场景。

判据是一句问话：**这个页面在返回时，数据变了吗？变了的话，是我这边的操作导致，还是外部导致？** 前者用做法二，后者用做法一或三，「不确定就每次全量重拉」是最差的答案，因为它把成本同时加在服务端和用户的滚动位置上。

## 页面栈只有十层，参数只能是字符串

`wx.navigateTo` 的官方页面写得很直接：新开页面**把当前页面压入栈中**，页面栈最多十层。这十层不是建议，是上限——到第十层再 `navigateTo` 会失败。

五个路由方法的职责分工：

| 方法 | 对栈做什么 | 典型用途 | 和 Web 的对应直觉 |
| --- | --- | --- | --- |
| `wx.navigateTo` | 压栈，保留当前页 | 列表 → 详情 | 像「打开新页面」，**不是**开新标签 |
| `wx.redirectTo` | 替换栈顶，当前页销毁 | 表单填完换成结果页 | 像 `location.replace` |
| `wx.navigateBack` | 出栈 | 返回 | 像 `history.back` |
| `wx.switchTab` | 切到 tabBar 页 | 底部导航 | 无对应，tab 页不参与普通栈 |
| `wx.reLaunch` | 关掉所有页面，打开目标页 | 登录后回首页、异常兜底 | 无对应，最重的手术 |

**参数怎么传**：URL query 字符串，目标页在 `onLoad` 的 `options` 里收到。

```js
wx.navigateTo({ url: '/pages/detail/detail?id=' + item.id + '&from=list' });
```

```js
Page({
  onLoad(options) {
    // options.id 与 options.from 都是字符串，'123' 不是 123
    this.setData({ id: options.id });
  }
});
```

由此推出三条必须遵守的纪律：

**一、类型自己负责。** query 过一遍 URL 就全是字符串，比较时别用 `===` 比数字。这一条和[复杂度分析](/computer-science/complexity)里「先算清数据量」同理——边界上的类型转换要显式写，不要靠运气。

**二、别塞对象。**想传复杂数据时，正确做法是传 ID 再在目标页 `onLoad` 里按 ID 取，或者放在服务端的临时状态里。**参数的长度上限本批未从页面取到明确数字，别用它当传输通道。**

**三、`getCurrentPages()` 拿到的数组是平台维护的栈，不要缓存它的元素。** 页面出栈后引用会失效，`this` 也不一定还是那个可写的对象。

十层上限带来的真实问题不是报错，是**导航结构**：列表 → 详情 → 相关推荐 → 详情 → 评论列表 → …，第六层用户就找不到返回的尽头了。所以栈深有上限其实是替你做了一个产品决策——**超过三四层的链路应该改成 tab、`redirectTo` 或重新进入**。这和[软件架构](/computer-science/architecture)里「可逆性」的思路一样：能把状态收回去的设计，比能一直往里走的设计好维护。

## 网络请求：域名要先登记，并发有上限

官方「网络」页面的原文，逐条抄下来：

> 每个微信小程序需要事先设置通讯域名，小程序只可以跟指定的域名进行网络通信。
> 域名只支持 https 和 wss 协议。
> `wx.request`、`wx.uploadFile`、`wx.downloadFile` 的最大并发限制是 10 个，`wx.connectSocket` 的最大并发限制是 5 个。
> 在微信开发者工具中，可以临时开启「开发环境不校验请求域名、TLS 版本及 HTTPS 证书」选项，跳过服务器域名的校验。

这四条决定了两件事：**上线前的准备清单里有一条不属于代码**，以及**「本地能跑」不构成通过**。

与 `fetch` 的差异，按你会真的踩到的顺序排：

| 维度 | 浏览器 `fetch` | `wx.request` |
| --- | --- | --- |
| 能不能连某个域名 | 同域自由，跨域看 CORS 响应头 | 白名单决定，代码里改不了 |
| 失败原因 | 网络错误 / CORS / 状态码 | 域名未登记、协议不对、证书问题、超时 |
| 默认返回 | Response 对象，需 `res.json()` | 直接给你解析后的数据（`res.data`） |
| 状态码 | 4xx/5xx **不** reject，要自己判断 | 同样要自己判断，`success` 回调只看请求有没有发出去 |
| 并发 | 浏览器同域连接数限制 | 官方写死 10 |
| 超时与取消 | `AbortController` | `timeout` 参数；返回 requestTask，可 `abort()` |

**最容易踩的是第四行**：`success` 回调意味着「请求完成了」，不是「业务成功了」。把 401 和 500 当成功处理，是这个领域的经典事故。

封装成 Promise 只是语法糖，不改变上面任何一条：

```js
export function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: 'https://example.com' + path,
      method: options.method || 'GET',
      data: options.data,
      header: { authorization: 'Bearer ' + getMyToken() },
      timeout: 10000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error('http ' + res.statusCode));   // 状态码要自己判
      },
      fail(err) { reject(err); }   // 域名不合法也走这里
    });
  });
}
```

`header` 里那个自定义的会话凭证是你自己签发的，**不是** `openid`，原因见下一节。上线前检查这三样：域名登记好了吗、协议是 https 吗、开发者工具里那个跳过校验的勾取消了吗。前两条在平台后台，第三条在工具设置里，**都不在你的代码仓库里**——这正是很多人反复踩的原因：改代码看不出问题。

## 登录链路：`code` 是一次性的，`session_key` 不下发

官方给的概念模型是这样一条链路，**你的服务端在中间，不在两端**：

```text
小程序端                    你的服务端                   微信服务器
   | wx.login()                |                            |
   | 把 code 交给它 ----------->|--- code2Session ---------> |
   |                           |<-- OpenID / UnionID / session_key
   |<-- 你自己的 token -------|   （这三样只停在服务端）    |
   | 存进本地，后续请求带上它   |                            |
```

四件事必须由服务端做，一件都不能挪到前端：

1. **拿 `code` 去换标识**。这一步要 `appsecret`，而 `appsecret` 出现在前端就等于公开。
2. **决定这个用户是不是你已有的用户**。`openid` 是「同一个用户在你的这一个小程序里的标识」，UnionID 才是「同一主体下的多个应用之间的一致标识」（后者要绑定开放平台才可用，具体条件本批未逐项核实）。
3. **签发你自己的会话凭证**。官方口径是你需要生成自定义登录态与自己的用户体系关联起来，`session_key` **不应下发给前端**。
4. **管会话的有效期与失效**。小程序不会替你管登出，也不会保证 `code` 之外任何东西长期有效。

这套模式你在站内已经见过一次：[会话与登录](/backend/auth-session)讲的是同一个结构，只是提供方从「你自己的用户名密码」换成了「平台签发的临时凭证」。**换的是提供方，不换的是原则：身份来源和你的会话体系要解耦。** 解耦没做好的典型症状是：数据库里的用户表以外键存着 `openid`，前端拿 `openid` 当凭证访问接口——一旦你多做一个小程序或 App，用户就被劈成两半，而这正是[第一章](/mobile/choosing-route)「用户关系属不属于你」那一格的技术后果。

顺带一条常被忽略的：**登录不等于授权。**「拿到用户标识」和「拿到用户昵称头像」是两件事，后者在小程序里要走平台的用户信息接口，而且需要用户主动触发；具体交互约束随基础库版本调整过（本批不给出当前条款），动手前查当天文档。

## 本地存储：它是 KV，不是数据库

官方把这组 API 分成异步与同步两套（`wx.setStorage` / `wx.setStorageSync` 的后缀规律），判断不在 API 名，在**你存什么**：

| 存什么 | 该不该存 | 理由 |
| --- | --- | --- |
| 你自己的会话凭证 | 可以，但要当敏感数据处理 | 设备丢失等于凭证丢失，服务端要有过期与吊销 |
| 首屏缓存、上次浏览位置 | 推荐 | 冷启动体验最直接的一项改进 |
| 用户没提交的草稿 | 推荐 | 意外退出后能恢复，价值高、成本低 |
| 业务主数据（当唯一副本） | 不该 | 清缓存、换设备就没了 |
| 密钥、`appsecret`、`session_key` | 绝对不该 | 本地存储不是保险柜 |

**容量上限本批未取到数字**，本章不给结论，但它不影响设计：**本地存储的用途是「加速」和「暂存」，必须长期存在的数据要回落到服务端**——只有一份、又随时可能被用户一键清掉的数据，等于没有备份（与[备份与恢复](/database/backup-and-restore)口径一致）。

写缓存的两条纪律：给它一个版本号和一个失效条件，否则你会花一整天调试「改了接口返回但页面还是旧的」。**缓存没有失效策略，就是延迟执行的 bug。**

## 组件化与分包：代码重量要放在对的位置

组件的官方形状是 `Component({ properties, data, methods, lifetimes })`，用之前必须**在页面的 json 文件里做引用声明**（官方原文：「使用已注册的自定义组件前，首先要在页面的 json 文件中进行引用声明」）。这条和 Vue 的 import 直觉不一样：**注册声明写在配置里，不写在脚本里**，也是「组件没生效」这类问题的第一现场——代码没错，json 少了两行。

父子之间只有两条通道，方向和 Vue 一致但机制不同：

```html
<child-card item="{{current}}" bind:updated="onUpdated">
  <view slot="footer">底部操作</view>
</child-card>
```

```js
// 子组件：props 只能由父组件下行，改要往上喊
Component({
  properties: { item: { type: Object, value: null } },
  methods: {
    save() {
      this.triggerEvent('updated', { id: this.data.item.id });
    }
  }
});
```

上例第一行是 WXML 插值写法（属性绑定用双大括号，机制见[第 3 章](/mobile/miniprogram-model)）。三点结论：**父→子走 `properties`，子→父走 `triggerEvent`，内容用 `slot`**；Vue 里 `v-model` 那种双向糖要自己写成「下行 + 上喊」两半；样式隔离有选项但取值本批未核实，核实前用命名约定兜底，别指望机制替你隔离。

分包解决的是另一类问题：**用户点开你的小程序时，要下载多少代码。** 官方分工写得清楚：主包放默认启动页面、tabBar 页面和所有分包都需要的公共文件或资源；其余页面按功能模块拆进分包。数字上，官方页面写明**全部分包大小总计不超过 30M、单个分包不超过 2M**（第三方服务商平台的总计数字不同，为 20M）。

什么时候开始分包？判据不是页面数量，是这两条：

- 冷启动要下载的代码里，有多大比例是**首屏用不到的**？这个比例就是分包的收益。
- 有没有一条功能链路（比如「下单」「个人中心」）本来就只在特定入口才进入？它天然是一个分包边界。

反面例子是把分包当目录整理：按「页面类型」拆成 `common`、`pages`、`utils` 三个包，结果首屏页面在 A 包、它 import 的组件在 B 包，跨包引用又要求公共部分回主包——**绕一圈回到主包变大**。分包边界要按用户路径划，不按代码分类划。这和[代码规范](/devops/code-standards)里「按变更原因分组」是同一条原则换了一层皮。

## 常见错误与排查

**一、每次返回页面都全量刷新。**现象：列表返回后跳回顶部、接口调用量异常。原因：把页面 `onShow` 只理解成「回前台」。怎么确认：在两个场景各打一次日志（切后台再切回、从下一页返回），看是否都进了同一个分支。怎么修：用「脏标记」或上一页回传函数分流，见本节上面的做法一/二。

**二、真机上一片 `request:fail url not in domain list`。**原因：域名没登记，或登记了 https 但代码用了 http。怎么确认：把报错里的域名逐字符和平台后台对照（子域、端口都算不同域名）。怎么修：加白名单，别把工具里的「不校验域名」带到线上判断——它只影响开发者工具。

**三、`success` 回调里当成功处理。**现象：401/500 走了正常分支，页面显示空数据。原因：回调只看请求是否完成。怎么修：封装一层统一判断 `statusCode`，把这层判断写在一个地方，见[API 文档与契约](/backend/api-docs)里「契约收拢到一个适配层」的做法。

**四、页面第十层以后 `navigateTo` 失败。**原因：页面栈上限。怎么确认：把 `getCurrentPages().length` 打出来。怎么修：中间层换 `redirectTo`，或改产品结构。**别用 `reLaunch` 绕过**——它销毁所有页面，用户返回时找不到东西。

**五、`options.id` 和列表里的 `item.id` 比较永远不等。**原因：query 传过来是字符串。怎么修：在 `onLoad` 边界处显式转换并往下传同一个类型，别在每个比较点各转一次。

**六、`appsecret` 出现在小程序代码里。**现象：安全通报或第三方拿到你的标识能力。原因：登录链路前后端职责写反。怎么修：立刻在服务端做换凭证的接口，**并去平台重置密钥**（重置的操作路径与影响本批未核实，按官方流程当天指引做）。这条属于[服务器安全](/linux/server-security)里「泄露的密钥必须轮换」的同一个纪律。

**七、组件写了但页面上不显示。**第一现场不是样式，是页面 json 里没声明 `usingComponents`。怎么确认：看页面 json 有没有那两行。怎么修：声明后重编译。

**八、分包后报「未找到页面」或首屏反而更慢。**原因：分包边界按代码分类划、或启动页被放进了分包。怎么修：把默认启动页与 tabBar 页回主包，按用户路径重划边界，然后看包体积报告确认分布。

## 练习

<Exercise title="判断你的应用里有多少次重复请求" difficulty="基础">

拿你正在做的那个小程序（或照着本章示例新建一个「列表页 → 详情页」结构）。在列表页的 `onLoad` 和 `onShow` 各加一行日志，日志里带上 `getCurrentPages().length`。

然后跑四个动作：首次进入列表 → 进详情 → 返回列表 → 切到别的 App 再切回来。把四次动作分别触发了哪些回调列成一张表，再回答：**如果你把请求放在 `onShow`，同一次浏览里这个接口被打了几次？**

<template #answer>

回调序列是：首次进入列表 `onLoad` + `onShow`（栈深 1）；进详情时列表不触发任何回调（栈深 2，列表只被隐藏）；返回列表触发 `onShow`（**不触发 `onLoad`**，栈深回 1）；切走再切回触发 App 的 `onHide`/`onShow` 加页面的 `onShow`。

所以「首次进入 + 返回 + 切后台回来」这一串动作里，放在 `onShow` 的请求会发 3 次，而实际只有第 3 种情况可能真的需要重新确认数据。改法就是正文里那张表给出的分流：首次加载放 `onLoad`，脏标记或上一页回传负责跨页同步，纯时效性需求才放到「变化检查」这种轻量接口上。

延伸自查：如果你的产品有多页面互相跳，同一次浏览的接口调用量放大倍数会随页面数增长。这个数字应该在服务端日志里能看到——看不到的话，第一动作是把页面标识加进日志，而不是马上改代码（与[日志与监控](/backend/logging-and-monitoring)的口径一致）。

</template>

</Exercise>

<Exercise title="把一个对象参数改造成合法的传参方式" difficulty="基础">

下面这段代码在 Web 里看着没问题，到小程序里有两个隐患。写出让它们暴露出来的验证动作，再改写。

```js
wx.navigateTo({
  url: '/pages/detail/detail?item=' + JSON.stringify(chosenItem)
});
```

<template #answer>

两个隐患：**（a）** 参数值是字符串，目标页要自己 `JSON.parse`，一次转义出错就是白屏；**（b）** URL 长度有限制（上限本批未核实），而 `chosenItem` 通常带着列表用不到的大字段。

暴露动作：把最长的一个字段填成 2000 个字符再跳一次，看是否报错或空白；在目标页 `onLoad` 里原样打印 `options.item`，对比它与你预期的长度差别。

改写：只传标识。

```js
wx.navigateTo({ url: '/pages/detail/detail?id=' + chosenItem.id });
```

目标页在 `onLoad` 里拿 `options.id` 请求详情接口，或从已有的列表缓存里查这一条。如果确实需要「列表页已经算好、不想再请求」的数据，正确通道是 `getApp().globalData` 或本地存储里的一个临时键，**配合读一次就清的失效策略**——它比 URL 更合适，因为它不受 URL 编码影响，也能被明确清理。

</template>

</Exercise>

<Exercise title="把登录链路按职责拆开写" difficulty="进阶">

有人写了这样的代码：小程序里拿到 `wx.login()` 的 `code` 后，直接在小程序端调用「用 code 换 openid」的第三方接口，并把 `appsecret` 写在常量文件里；然后把 `openid` 存进本地，之后每个请求都带 `openid` 当身份。

请指出这条链路里有几处原则性问题，分别应该怎么改；并给出一个能证明「服务端才持有密钥」的验证方法。

<template #answer>

三处原则性问题，都出在「谁持有什么」。

**一、密钥出现在前端。** `appsecret` 打进小程序包等于公开。改法：换取动作搬到服务端，前端只把 `code` 交给自己的登录接口。

**二、`session_key` 的去向没管。** 官方口径是它不应下发。改法：留在服务端，前端只拿你自己签发的会话凭证。

**三、`openid` 被当成访问凭证。** 它是稳定标识，不是秘密——出现在 `Authorization` 里，等于任何人抓到一串 openid 就能冒充。改法：换取标识后由服务端签发有期限、可吊销的自定义登录态，请求带它，服务端从会话表反查用户。

验证「密钥只在服务端」靠做减法而不是读代码：删掉客户端里所有相关字符串、重新出包，在解压后的产物里全文搜——搜不到才算通过；再抓一次登录请求，确认请求体只有 `code`、响应只有你自己的 token。这与[会话与登录](/backend/auth-session)「凭证必须由签发方验证」的思路一致。

</template>

</Exercise>

<Exercise title="给一个真实项目划分包边界" difficulty="挑战">

假设一个小程序有这些页面：首页（tab）、分类页（tab）、商品详情、搜索、购物车（tab）、下单流程 4 页、订单列表、订单详情、售后 3 页、个人中心（tab）、设置、地址管理 2 页、优惠券 2 页。主包目前装下了全部页面。

请你按「用户路径」而不是「代码分类」划出分包方案，写出每个分包的入口条件与容量理由，并指出哪两个页面看起来可以分包但**必须留在主包**。

<template #answer>

必须留在主包的：**默认启动页与全部 tabBar 页面**（官方明确这两类归主包），以及被多个包引用的公共组件、工具函数与样式。

按用户路径的分包建议：**交易包**＝下单 4 页 + 地址管理 2 页，入口条件是「用户点了结算」，链路之外没人需要它，收益最大；**售后包**＝售后 3 页，入口是「订单详情里点了申请售后」，低频且深，最典型的候选；**订单包**＝订单列表 + 详情，入口是「个人中心里点订单」（若详情页属于个人中心的可见首屏，就留主包，别为了对称硬拆）；**优惠券包**＝2 页，低频入口。搜索可以独立一包，但**要先查它是否被首页直接跳转**——如果被，收益会被首次下载等待吃掉，留主包更合理。

判断理由的写法应该是这两句，而不是页面数：「这个包只在特定动作后才进入」＋「这个包里不包含主包页面需要的公共件」。反面划法是把「所有列表页」「所有详情页」各归一包：每条用户路径都要跨包，跨包引用又逼你把公共件塞回主包，最终主包没变小、还多一次分包加载等待。

诚实提醒：主包单独上限、预加载与独立分包的具体规则本批未逐项核实，动手时查当天官方文档再定边界数字；**分包的实际收益只能用真机冷启动和包体积报告验证**，不能靠估。

</template>

</Exercise>

## 官方文档与延伸阅读

站内链接（本章不复述它们的内容）：

- [微信小程序：心智对照（一）](/mobile/miniprogram-model) —— 两层分离与 `setData` 的机制，本章所有「为什么参数要过桥」的推论都建立在它上面。
- [移动端 Web 适配](/mobile/mobile-web) —— 页面滚动、软键盘与视口那套标准层知识，是理解 `onPageScroll` 代价的对照物。
- [要不要做移动端、做哪种](/mobile/choosing-route) —— 「先审核再发布」与「用户关系归谁」这两笔账在这里论证。
- [会话与登录](/backend/auth-session)、[API 文档与契约](/backend/api-docs)、[日志与监控](/backend/logging-and-monitoring)、[服务器安全](/linux/server-security)、[备份与恢复](/database/backup-and-restore)、[复杂度分析](/computer-science/complexity)、[软件架构：模式与取舍](/computer-science/architecture)、[代码规范](/devops/code-standards)。

站外官方文档（微信开放文档站内路径，核实时间 2026-10-22；深链接稳定性一般，找不到时从站内目录进）：

- [框架 · 网络](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html) —— 域名白名单、协议限制与并发上限的原文。
- [注册页面（Page）](https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html) —— 页面生命周期回调的官方清单。
- [注册小程序（App）](https://developers.weixin.qq.com/miniprogram/dev/reference/api/App.html) —— `onLaunch`/`onShow`/`onHide`。
- [组件生命周期](https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/lifetimes.html) —— `created`/`attached`/`ready`/`moved`/`detached` 与 `lifetimes` 写法。
- [自定义组件](https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/) —— `properties`、`data`、`methods` 与页面 json 引用声明。
- [wx.navigateTo](https://developers.weixin.qq.com/miniprogram/dev/api/route/wx.navigateTo.html) —— 入栈语义与页面栈上限。
- [小程序登录](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html) —— `code` → `code2Session` → OpenID/UnionID/session_key 链路。
- [分包加载](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages.html) —— 主包职责与分包大小数字。
- [小程序性能建议](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/runtime_setData.html) —— 官方对数据更新与启动性能的口径。

## 下一章

第 3、4 章合起来是原生小程序的完整心智：静态那半（两层分离决定模板与样式）、动态那半（生命周期、路由、网络与登录由平台规定）。带着这套心智再看框架，问题就变成一个：**框架替你封装了什么，封装的代价是什么。**

下一章是 [uni-app](/mobile/uni-app)：一套 Vue 代码怎么编译到小程序和 H5，条件编译的正确用法与滥用边界，为什么「平台新出的 API 框架不一定马上有」，以及 H5 端和小程序端表现不一致的常见来源。顺序是刻意的——**先被原生小程序的约束硌过一次，再看封装层才知道哪一层硌人。** 如果你已经在考虑 React Native 或 Flutter，可以跳读[第 6 章 跨端方案概览](/mobile/cross-platform)，那一章讲的是三条技术路线在渲染机制上的根本差别，和 uni-app 走的「编译到小程序」是两类问题。
