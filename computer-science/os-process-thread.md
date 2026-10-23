# 单线程指的是 JS 那一根执行流，不是整个进程

报表任务在整点跑起来的那一刻，整台服务开始超时。看监控的人第一反应是 CPU 不够，于是把实例从 1 个加到 4 个——超时照旧，而且四个实例一起超时，因为每个实例上都有一份同样的同步计算。健康检查接口本来是最简单的 `res.end('ok')`，它也超时了，这就是「CPU 密集任务把单线程占住」最典型的形状：不是某个请求慢，是**所有**请求都排在一串没有让出过执行权的代码后面。

另一个方向的错同样常见。「Node 是单线程的，所以性能不行，得换语言」——这句话把进程、线程、JS 执行流三件事压成了一件。有人于是开了 8 个 `worker_threads`，结果内存按 worker 数翻上去、任务耗时一点没降，因为每个 worker 拿到的是数据的副本，光搬运就把收益吃光了。

这三类判断之所以都错，是因为它们用同一个词「线程」指三种不同的东西。本章把三个口径分开：操作系统给你什么、Node 的运行时在里面做了什么、你在自己机器上能读到哪些数字。分清楚之后，「CPU 密集任务怎么办」这个问题才有正确答案：先看那份工作是「在等」还是「在算」，再看你要的是并发还是并行。

<Callout type="verified">

**本机实测**（Node v25.4.0 / Windows，2026-10-21，脚本 `computer-science/.scratch/os-proc-thread.cjs`、`os-cluster.cjs`）：主线程同步忙等期间的定时器心跳计数；worker 线程里跑同样忙等时主线程的心跳；普通对象与 `SharedArrayBuffer` 跨线程的可见性；`Atomics.wait` 在主线程与在 worker 里的不同结果；`cluster` 两个工作进程的 pid/ppid、六个连接分别由谁应答、杀掉一个之后的服务情况；`child_process.fork` 子进程崩溃时的隔离。

**按通用原理与官方文档陈述**（本机没有对应观测接口）：进程拥有独立虚拟地址空间、CPU 时间片如何被调度、容器里的 CPU 配额。

**边界**：本机是 Windows 单机，没有 Linux/容器环境，没有调度器观测接口；文中所有毫秒与次数只用来判断「有没有重叠、谁挡住了谁」，不用来给任何性能比例下结论。

</Callout>

## 进程是账本上的一格，线程是那格里同时干活的手

操作系统分配资源的基本单位是进程：一个 pid，一份自己的地址空间，一张自己打开的文件描述符表，一份自己的堆。进程之间默认互相看不见，一个进程崩了不会把邻居的内存一起带走——这条性质是「多进程部署」的全部价值来源。

CPU 调度的基本单位是线程。同一个进程里的多条线程共享那一份地址空间（所以它们能读到同一块内存，也因此需要锁或原子操作），但各自有独立的栈与寄存器状态。换句话说：进程决定「什么东西互相隔离」，线程决定「什么东西可以同时被推进」。

Node 里能直接读到的编号只有三个层级，它们正好对应上面这段话：

```text
process.pid    本进程的编号          本机实测：主进程 22276，cluster 子进程 21616 / 8052
process.ppid   父进程的编号          本机实测：两个子进程自报的 ppid 都等于主进程 pid
threadId       本线程在进程内的编号  本机实测：主线程 0，第一个 worker 自报 1
```

`isMainThread` 为 `true` 时 `threadId` 是 0，`new Worker()` 出来的线程从 1 开始递增。这条差异本身就是一张判定表：pid 相同而 threadId 不同 → 同一进程里的两条线程；pid 不同 → 两个进程，各自有各自的堆。

需要说清的一处边界：「每个进程有独立的虚拟地址空间」这句话属于内核与 MMU 的机制，Node 没有暴露任何可读的页表接口，Windows 上也没有 `/proc`。本章把它当作通用原理陈述，**不在本机验证**；能验证的是它的下游现象——两个进程的 `memoryUsage()` 数字互不相干，一个进程 OOM 崩溃时另一个照常工作（第五节与第九章各有一组实测）。

## 「同时」有两种意思：并发与并行

并发（concurrency）说的是**一段时间内有多件事在推进**，它可以只靠一条执行流轮流推进——你去泡咖啡的这段时间里，另一个人也在等水开。并行（parallelism）说的是**同一时刻真的有两处在工作**，需要两个以上的执行单元（核、超线程、另一台机器）。

这个区别在 Node 里不是文字游戏，因为它直接决定「异步」能给你什么。`await` 让出执行权，于是别的回调可以进来跑，这是并发；它不会让你的计算同时出现在两个核上，那不是并行。

本机实测的形状很干净。主线程挂一个 20 ms 的心跳定时器，然后写一段 400 ms 的同步忙等：

```text
最后一次心跳到下一次心跳之间隔了 400 ms（忙等 400 ms，心跳间隔 20 ms）
```

400 ms 里一次心跳都没执行——不是定时器坏了，是那条唯一的 JS 执行流被占着，事件循环没有机会推进任何回调。JS 代码跑完才轮到别人。这就是「Node 单线程」这句话真正承诺的内容：**同一段 JS 不会同时执行，任何同步代码都会先跑到底**。

把同一段忙等放进 worker 线程，主线程改成每 20 ms 记一次心跳：

```text
主线程在 520 ms 窗口里收到 17 次心跳 → worker 的忙等没有挡住主线程
worker 自报：threadId=1，忙等 400 ms；主线程 threadId=0 → 数字不同，是两条线程
```

这时候才是并行：两条线程各自占一个执行单元，同时各跑各的。

多少个执行单元？本机 `os.cpus().length` 是 8，`os.availableParallelism()` 也是 8，`os.cpus()` 里只出现一种型号。但这两个数不等价：官方文档明确写着 `os.cpus().length should not be used to calculate the amount of parallelism available to an application. Use os.availableParallelism() for this purpose.`。`availableParallelism()` 的返回值定义是「一个程序该使用的默认并行度的估计」，它是 libuv `uv_available_parallelism()` 的封装。区别在受限环境里才显形：容器里 `os.cpus()` 往往还是宿主机的核数，而你被允许用的只是配额那一点——这条本机没有容器环境，**未在本机验证**，但它是「我起了 8 个 worker 为什么没变快」最常见的答案之一。

## 「Node 单线程」这句话管到哪，不管哪

它管的只有一件事：**同一个 isolate 里的 JS 代码不会同时执行**。所有「异步能提速」的说法都建立在这上面——因为让出执行权是有意义的，同一时刻只有一段 JS 在跑。

它不管的有三块，而且这三块经常被人一起当成「单线程」：

```text
libuv 线程池     文件系统、部分 crypto、DNS 解析这类「请求」在别的线程上等，不占 JS 执行流（细节在第九章）
worker_threads   额外的 JS 执行流，可以真的并行跑计算，但默认不共享对象
cluster / 进程   额外的完整 Node 实例，各有自己的堆与事件循环，靠 IPC 或网络说话
```

有一条实测结果值得单独说，因为它正好是「把浏览器环境的结论搬到 Node」的反例。`Atomics.wait` 是 JS 里唯一能主动让线程阻塞的原语，MDN 的报错条件里写着：当前线程不能被阻塞时抛 `TypeError`，举的例子就是「因为它是主线程」——那是 Web 平台的规则。本机 Node 上：

```text
主线程 Atomics.wait → 返回 "timed-out"，主线程实际睡了 59 ms
worker 的 Atomics.wait 返回 "ok"，阻塞了 62 ms（主线程在 152 ms 这个时刻发出唤醒）
worker 阻塞期间主线程仍收到 13 次心跳 → 睡着的是 worker 线程
```

主线程没有抛错，它**真的睡过去了**——在 Node 里用 `Atomics.wait` 卡住主线程，效果和你写一个 `while` 循环占住事件循环是一样的，只是这次连 CPU 都不烧。查 API 行为时要先确认文档服务的是哪个平台：MDN 同时描述 Web 与 JavaScript 语言本身，而「主线程不许阻塞」属于前者。

## 默认什么都不共享：跨线程搬数据的代价

`worker_threads` 是本章唯一能同时提供「并行」和「独立 JS 执行流」的机制，但它的默认行为决定了它的适用面：**传过去的是副本**。

本机实验：主线程建一个普通对象 `{ hits: 0 }` 和一段 `SharedArrayBuffer`，都通过 `workerData` 交给 worker；worker 里把 `hits` 改成 999，并在共享内存上做两次 `Atomics.add`。

```text
worker 里把 plain.hits 改成 999；主线程看到的是 0 → 传过去的是副本（结构化克隆）
worker 里 Atomics.add 两次；主线程读同一段 SharedArrayBuffer 得到 2 → 只有 SharedArrayBuffer 真共享
```

官方文档对这条有明确定义：`workerData` 的内容「按 HTML structured clone 算法克隆」，`postMessage` 同理；而 `ArrayBuffer` 如果没有列进 `transferList`，「底层内存是被复制而不是被转移」。所以「把 12 MB 数组交给 worker 处理」这句话的真实含义是：先复制 12 MB 进 worker，再复制结果回来。

还有一条容易被忽略的成本：每个 worker 有自己的 V8 堆。本机两个 worker 各自报告 `heapUsed` 6.3 MB，主线程是 5.1 MB——三个数字互不相干，正好说明它们是三份独立的堆。于是 worker 数量的实际代价是：

```text
worker 数 ×  (自己的堆 + 自己那套模块实例)  +  每轮任务的两次结构化克隆
```

什么时候该用什么，判据是「这份工作在等还是在算」「数据能不能切开」：

- **在等**（网络、磁盘、数据库）：不需要 worker，异步并发就够；多线程反而会为排队位置付额外成本。
- **在算，且能整块切分**：`worker_threads` 或独立进程都可以，区别是隔离级别。worker 起停便宜、同进程内可以用 `SharedArrayBuffer`；进程隔离更彻底（一个崩了不影响另一个），但要走 IPC 或文件/网络。
- **在算，但数据是一个大整体、谁都要读它**：先想清楚能不能不改数据地分段处理（`SharedArrayBuffer` + `Atomics`，或者把大对象留在主线程、只把索引发给 worker）。搬数据往往比算数据更贵。
- **在算，而且量级是分钟以上**：把它请出请求路径——队列 + 独立工作进程/服务，这是[消息队列的概念](/message-queue-cloud/mq-concepts)那一类问题的答案，不是本章能靠开线程解决的。

## 多进程买到的是隔离，不是均摊

`cluster` 的官方定位是「让多进程共享同一个监听端口」。本机跑一个最小版本：主进程 fork 两个 worker，每个 worker 起一个监听在同一个端口的 TCP 服务，收到一行就回自己的 pid、ppid 和当前堆用量，然后连六次。

```text
在线工作进程：id=1 pid=21616，id=2 pid=8052
主进程 pid=22276 与 2 个子进程 pid=21616,8052 → 不同 pid 说明是不同的进程，不是线程
6 次连接，每次都写着：worker|pid=8052|ppid=22276|heapMB=4.8~5.5
出现过的应答进程 = 8052；主进程 pid=22276 没有出现在里面
子进程自报的父进程 pid = 22276 → 父子关系成立
```

六次连接**全部由同一个 worker 应答**。这不是「本机样本太小」这么简单的事，官方文档对分发方式有明确的说明：round-robin 是「除 Windows 之外所有平台的默认方式」，另一种方式是主进程创建监听 socket 再交给特定 worker，而文档紧接着写了一句很该被记住的话——实践中分发往往很不均衡，因为操作系统调度器的行为难以预测，曾经观察到八个进程里超过 70% 的连接落到其中两个进程上。Windows 上还有一条限制：在 worker 里没法建命名管道服务。同一份文档里也写着 `SCHED_RR` 在 Windows 上不是默认调度策略，要等 libuv 能有效分发 IOCP 句柄。

第二个实验测的是「容错」，这条性质才是多进程部署的主要收益：

```text
已 kill pid=21616；主进程观察到的退出事件：code=null signal=SIGTERM
kill 之后 4 次连接全部成功？是
cluster.settings.auto 当前 = undefined；本轮 1.2 秒内没有观察到新的 online 事件
```

服务没断，因为还剩一个 worker 在听。但**本机这一次没有观察到自动补齐进程**——`cluster.settings.auto` 在这台机器上读到 `undefined`，而官方文档里的重启语义在不同版本上调整过，所以本章不把「cluster 会自动拉起挂掉的 worker」写成结论。部署时这条要靠外部监督者明确实现（systemd 的 `Restart=`、容器编排的副本数、或进程管理器），而不是假设它存在。Linux 侧的具体命令与预期输出本机没有环境，**未在本机验证**。

第三个实验用 `child_process.fork` 起两个各听一个端口的独立进程，让其中一个在 1.2 秒后抛未捕获异常：

```text
fork 出两个子进程 pid=15996、4692（主进程 22276）
两个端口分别应答：child|pid=15996|port=23112 / child|pid=4692|port=23113
子进程 A 因未捕获异常退出：code=1 signal=null
A 崩了以后 B 仍可应答：child|pid=4692|port=23113
主进程此刻仍然活着：pid=22276
```

崩溃被限制在那一个进程里。这就是「进程边界」的可读形态：隔离是真的，均摊不是自动的。

顺序也因此很清楚：先问一份 JS 执行流够不够（不够 → worker 或加进程），再问要不要故障隔离（要 → 多进程 + 外部监督者），最后才轮到「多个进程之间怎么摊」——而这一问的答案通常不在 Node 里，在前面那层负载均衡器上。

## 常见错误与排查

**请求路径上出现同步计算，健康检查跟着一起超时。** 现象是整点、报表、图片处理、`JSON.parse` 一个几 MB 响应的时候全服务卡住，CPU 却不一定打满。原因是 JS 只有一根执行流，同步代码跑完之前事件循环不能推进（本机实测：400 ms 忙等期间 20 ms 的心跳一次都没走）。确认方法是把可疑计算放进一个带心跳的脚本跑一次，看心跳是否被整体推迟。修法是让出执行权（分片 + `setImmediate`）、把计算交给 worker，或者干脆把它挪出请求路径进队列。

**「开 8 个 worker 就该快 8 倍」，实际耗时没降、内存翻倍。** 原因是每个 worker 一份堆，而且数据要结构化克隆进出（本机实测：两个 worker 各报 6.3 MB 堆，主线程 5.1 MB；普通对象在 worker 里改 999，主线程读到 0）。确认方法是先在单线程下量清楚这份工作的时间到底花在算还是花在等；再看每轮传给 worker 的数据体积。修法是切数据而不是加 worker，或者把大对象留在原地只传索引。

**「cluster 起了 N 个进程，所以每个进程分到 1/N 流量」。** 本机六个连接全部由同一个 worker 应答，官方文档也直接承认分发会偏（8 个进程 70% 落到 2 个）。确认方法是让每个 worker 在自己的响应里写 pid，然后用稳定并发压一轮，统计的是直方图不是进程数。修法是把分发交给前面一层（负载均衡器），或者接受不均并让每个 worker 无状态。

**worker 崩了，主线程什么日志都没留下，进程直接退出。** 现象是整个 Node 进程以非零码结束，附带一段 `TypeError` 栈。原因是 worker 的 `error` 事件没人监听时会作为未捕获异常抛到主线程——本机第一次跑这段脚本就是这样被打死的。确认方法是看退出码与栈顶那行是不是来自 `[worker eval]`。修法是每个 `Worker` 建好就挂 `on('error')` 与 `on('exit')`，把原因写进日志再决定要不要重建。

**「Node 单线程，所以用不了多核，得换语言」。** 本机 `availableParallelism()` 返回 8，worker 与 cluster 都能各占一个执行单元。确认方法是看那个瓶颈进程实际用了几核、单进程是否已经把一颗核占满。修法是先分类工作：等 I/O 的用异步和连接池解决，算的用 worker/进程解决，只有当同一份逻辑需要在多个隔离环境里同时算时才考虑换运行时。

## 练习

<Exercise title="量出「同步代码占住主线程」的形状" difficulty="基础">

写一个脚本：主线程每 20 ms 打一次心跳时间戳，然后立刻执行一段 400 ms 的同步忙等（`while` 循环比较时间），忙等结束后再空跑 200 ms。回答两个问题：(1) 忙等窗口内心跳执行了几次，第一次心跳落在什么时刻；(2) 把忙等换成 `await new Promise(r => setTimeout(r, 400))`，同一份统计变成什么样。用这两个结果解释「异步不减少工作，只是不占着执行权等」。

<template #answer>

本机实测形状：忙等 400 ms 期间心跳 0 次，最后一次到下一次之间间隔正好 400 ms（心跳间隔 20 ms）。换成 `setTimeout` 之后，同样的 400 ms 窗口里会有约 20 次心跳，因为等待期间执行权还给了事件循环。

结论：`await` 不是「让计算变快」，而是「让出执行权」。判断一段代码该不该异步，问的不是它花多少时间，而是这段时间里它有没有占着那根唯一的 JS 执行流。顺带一条：忙等和等待的 CPU 成本完全不同——`while` 循环烧一整颗核，`setTimeout` 什么都不烧，所以「CPU 打满」和「响应很慢」这两条监控有时互相解释。

</template>

</Exercise>

<Exercise title="给 cluster 做一次真实的分发统计" difficulty="进阶">

在你自己的机器上写一个最小的 cluster 服务：主进程 fork 与 `os.availableParallelism()` 相同数量的 worker，每个 worker 监听同一个端口，并在响应里写自己的 pid 和「本进程已处理计数」。压 200 次请求，输出一张每个 pid 的处理数直方图。不许写「均摊」这两个字，除非数据支持；然后查官方文档，写出你所在平台上默认走的是哪一种分发方式。

<template #answer>

本机（Windows，2 个 worker，6 次连接）的直方图是 `8052: 6`，另一个 worker 一次都没接到；主进程不在应答名单里。这与你可能预期的「3/3」完全不同，而它和官方文档描述一致：round-robin 是除 Windows 外的默认方式，另一种方式由主进程把监听 socket 交给特定 worker，文档同时警告实际分发常因调度器行为而偏斜（曾观察到 8 个进程中 70% 的连接集中到 2 个）。

要点有三个：pid 不同意味着进程而不是线程（各自的 `memoryUsage()` 互不相干）；主进程不出现在应答里说明它只做监督与 socket 交接；直方图必须自己测，不能从进程数推。如果你在 Linux 容器里做这道题，再对照一次 `availableParallelism()` 与 `os.cpus().length` 是否相同——容器配额会让两个数分开。

</template>

</Exercise>

<Exercise title="故意把 worker 的消息通道搞坏，读你自己的报错" difficulty="挑战">

写一段代码：主线程建 `const box = new Int32Array(4)`（注意是普通 `ArrayBuffer`，不是 `SharedArrayBuffer`），通过 `workerData` 传给 worker；worker 里 `const i32 = new Int32Array(workerData)`，然后调用 `Atomics.wait(i32, 0, 0, 3000)`。先预测结果，再运行，把真实报错原文抄下来。然后做两处修改各跑一次：(1) 给 Worker 挂 `error` 事件监听；(2) 把主线程那段改成 `new Int32Array(new SharedArrayBuffer(16))`。

<template #answer>

本机真实报错（第一次跑的时候没挂 `error` 监听，整个脚本被打死，退出码 1）：

```text
TypeError: [object Int32Array] is not a shared typed array.
    at Atomics.wait (<anonymous>)
```

原因链有两条。第一条：普通 `Int32Array` 经过 `workerData` 过去时按结构化克隆**复制**了一份，它 view 的是另一块普通 `ArrayBuffer`，于是 worker 里那个 `new Int32Array(workerData)` 得到的是又一个非共享数组；`Atomics.wait` 要求 typed array 必须 view 在 `SharedArrayBuffer` 上，所以抛错。第二条：worker 里的异常默认会作为未捕获异常抛到主线程，没有 `error` 监听就把宿主进程一起带走——这就是为什么「worker 崩了却没日志」看起来像灵异事件。

修法：主线程用 `new Int32Array(new SharedArrayBuffer(16))`，并把这段共享内存本身传过去（SAB 不会被复制，两侧 view 同一块内存）；每个 Worker 一建好就挂 `error` 与 `exit`。顺带一个真测到的对照：SAB 上 worker 做两次 `Atomics.add`，主线程读到 2；普通对象里 worker 把字段改成 999，主线程读到 0。共享只发生在 `SharedArrayBuffer` 上，其余全是副本。

</template>

</Exercise>

## 官方文档与延伸阅读

- [Node.js `worker_threads` 文档](https://nodejs.org/docs/latest/api/worker_threads.html) —— 核实本章「`workerData` 按 HTML structured clone 算法克隆」「未列入 `transferList` 的 `ArrayBuffer` 其底层内存是被复制而不是被转移」两条，对应第四节的实测解释。
- [Node.js `cluster` 文档](https://nodejs.org/docs/latest/api/cluster.html) —— 核实两种连接分发方式、round-robin 是除 Windows 外的默认、分发不均衡的官方描述（8 进程 70% 落到 2 个）、Windows 不能在 worker 里建命名管道服务，对应第五节。
- [Node.js `os` 文档](https://nodejs.org/docs/latest/api/os.html) —— 核实 `availableParallelism()` 的定义（该用量的估计、libuv `uv_available_parallelism()` 封装）与「不要用 `os.cpus().length` 计算可用并行度」这句原话，对应第二节。
- [libuv 源码 `src/threadpool.c`](https://github.com/libuv/libuv) —— 默认线程池数组 `default_threads[4]`、环境变量名 `UV_THREADPOOL_SIZE`、上限 `MAX_THREADPOOL_SIZE 1024`；本章只用它说明「线程池是固定几张桌子」，细节在第九章展开。
- [MDN `Atomics.wait()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/wait) —— 核实「当前线程不能被阻塞（例如因为它是主线程）」这一抛错条件，与本机 Node 主线程返回 `"timed-out"` 的实测形成对照，用来提醒 Web 规则不能直接搬到 Node。
- 站内：[第七章 网络：HTTP 演进](/computer-science/network-http) —— HTTP/2 的多路复用是「一条执行流上的并发」，本章讲的是它的对立面「执行流本身够不够」。

## 下一章

本章把「一条 JS 执行流」和「一个进程」分开了，但还剩一个问题没有回答：那些不需要 JS 参与的工作——读文件、算哈希、解析域名——到底在哪里等、等谁的位置。答案是 libuv 线程池与一批可数的口径，而它们正是内存告警和「并发上不去」的现场。下一章[第九章 操作系统：内存与 IO 模型](/computer-science/os-memory-io)会把 `process.memoryUsage()` 的五个字段、线程池的排队形状、以及「文件删了但空间没回来」这三件日常事一次讲清楚。如果想先把网络侧收口，[第六章 网络：TCP、UDP 与 TLS](/computer-science/network-tcp-tls) 里的连接与等待语义在本章的心跳实验里已经用过一次。
