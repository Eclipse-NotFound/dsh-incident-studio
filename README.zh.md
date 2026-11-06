# 现场取证台 · dsh-incident-studio

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 侧边栏插件：**把屏幕画面、日志行和键鼠输入放在同一条毫秒时间轴上**。录完圈出问题那几秒、在画面上拖红框标注、写一句现象，然后把「关键帧条带 + 动图 + 对齐后的日志切片 + 你的描述」一键填进 composer 交给 Agent。

它不绑定任何游戏或项目：日志源是配置出来的，任何会写文件的程序都能接；程序也可以反过来把事件直接推给插件。键鼠记录同样可配，目标进程填你自己的游戏或应用。

![现场取证台示意：画面帧、时间轴与日志行共用同一套墙钟](assets/diagram.svg)

## 它解决什么

实测类问题（游戏模组、GUI 客户端、前端交互）在**画面上**很明显，在**日志里**很隐晦。人写一句话反馈给 Agent，Agent 得自己翻几百行日志去猜「你说的那一刻」是哪一行；而「我按了什么」通常只有你自己的手指记得。

这个工具把四件事绑在一起：

| 证据 | 来源 | 精度 |
|---|---|---|
| 画面 | 宿主抓帧（见下文三条路） | 默认 6 fps，每帧带墙钟时间 |
| 事件 | 日志文件跟随（增量读）+ 打点 + HTTP 推送 | 行写入时刻，误差约几十毫秒；推送可到毫秒 |
| 键鼠 | 轮询助手（只在前台为目标程序时） | 约 30 Hz，误差 ±1 个采样间隔 |
| 你的话 | 画面上的标注框 + 一句话描述 | 挂在选中的区间上 |

交付物里每一行日志都带 `[00:12.340]` 相对时间，与图像帧、按键事件同源，所以 Agent 不必猜时刻，也不必猜你按了什么。

## 怎么用

```
按「开始录制」 ──> 画面按帧抓 + 日志实时跟随 + 键鼠记录（同一时钟）
      │
出问题按「⚑ 打点」──> 「■ 停止」
      │
右侧栏复看：拖区间 ─ 画面上拖红框 ─ 写一句描述 ─ 翻键鼠输入
      │
「生成产物」──> frames.png（6 帧条带）+ clip.gif（区间动图）落到工作区
      │
「填进输入框」──> 正文 + 附件进 composer（或「直接发送」）
```

1. **开面板**：右侧栏的 `+`（引导页里的「现场取证台」），或 composer 下方那条 `🎥 取证`。首次挂载它会自己打开一次，`localStorage` 记住。
2. **配日志源**（只需一次）：面板右上「设置」→ 填日志文件的绝对路径（或相对当前工作区的路径）。文件可以稍后才出现——先开录制、再开游戏也接得上。同一页里填「目标进程名」（例如 `Remains`），键鼠记录才知道该在哪个窗口前台时记录。
3. **录制**：选采集源 →「● 开始录制」。出问题时按「⚑ 打点」（可以按多次）——打点会自动记下「前一条输入」，也就是问题出现前你最后按下的那个键。
4. **复看**：停止后默认区间＝最后一次打点 ±3 秒；也可以自己拖起点/终点，或用「全部」「最后 8 秒」「打点前后 3 秒」快捷。拖画面播放头时日志会自动定位到同一时刻，点日志行能跳回对应画面；「输入」那块点「展开」能看到这段区间里的每次按键/点击，点一条同样跳到对应画面。
5. **标注**：在画面上按住拖出红框；每个框都能写一句说明。
6. **交付**：「生成产物」→「填进输入框」。附件默认带关键帧条带，可勾选同时带动图；确认无误后回车发送，或直接点「直接发送」。

### 给程序用的推送接口

除了跟随日志文件，任何本机进程（模组、测试脚本、dev server）都能直接推事件：

```sh
curl -X POST http://127.0.0.1:<dsh端口>/dsh-incident-studio/api/ingest \
  -H "content-type: application/json" \
  -H "x-incident-token: <面板设置里显示的令牌>" \
  -d '{"text":"进入 raiders 房间","src":"RConnect","level":"info"}'
```

`x-incident-token` 每进程一个，面板「设置」里能看到；同源面板自己推送不用令牌。带上 `wall`（epoch 毫秒）时按你给的时间入轴，否则按收到时刻。

## 产物长什么样

落在**当前会话工作区**的 `.dsh-incidents/<录制ID>/`：

```
.dsh-incidents/20261104-193045-a1b2c3/
  frames-20261104193045.png   6 帧横向条带，带时间戳与红框
  clip-20261104193045.gif     区间动图（460px 宽，区间内重采样）
  input.jsonl                 原始键鼠记录（每行一个 JSON 事件）
  bundle.md                   完整纪要：描述、标注坐标、全部事件行、输入记录
  bundle.json                 同上的机器可读版（给工具用）
```

`bundle.md` 节选：

```markdown
# 捡箱子后悬空

- **取证时间**：2026-11-04 19:30:45 (+08:00)
- **区间**：`00:12.340` → `00:16.780`（时长 00:04.440）
- **采集方式**：GDI 抓屏 6fps
- **输入记录**：按键 12 次按下、鼠标 3 次点击、前台切换 1 次（区间内 26 条）

## 问题描述
捡起箱子后角色浮空，动画没切回走路

## 打点
- `00:15.000` 问题点

## 事件流（区间内）
```log
[00:12.210] (host) RConnectGame: moveTest -> 966,900
[00:14.250] (host) ReferenceError: chest state mismatch (sost:LEVITATING)
[00:15.000] ⚑ 问题点
```

## 输入记录
- 采样：轮询约 50 Hz，只记键鼠的「变化」，不记录任何文字内容
- 记录范围：前台为 remains 时，指针只记点击位置
- 区间内 26 条：按键 12 次按下 / 12 次抬起，鼠标 3 次点击，前台切换 1 次
- 按得最多：W×8（共 2.40s）、Space×2、LShift×2
- 按住最久：W 0.91s（`00:12.900`→`00:13.810`）

### 打点前后的输入
**`00:15.000` 问题点**（前一条输入：Space ↓ 0.12s 前）

```input
[00:14.420] W ↓
[00:14.880] Space ↓
[00:15.020] Space ↑ (0.14s)
```
```

填进 composer 的正文是它的**紧凑版**：现象、区间、产物路径、标注说明、键鼠统计，以及最多 80 行日志（错误行与打点优先保留，打点行会附上「前一条输入」）；完整清单指向 `bundle.md`。

## 三条采集路径

| 宿主进程能拿到什么 | 走哪条 | 说明 |
|---|---|---|
| `electron.desktopCapturer`（Electron 主进程） | 定时抓 JPEG | 默认 6 fps / 960px / q62；能按**窗口**选源 |
| 只有 Node（Electron utility 进程 / 纯 `dsh web`） | **Windows GDI 抓屏助手**（`tools/grab-frames.ps1`） | 整个虚拟桌面（多显示器取并集）；一个长驻 PowerShell 按帧率写 JPEG，主机收帧后立刻删临时文件 |
| 真实浏览器打开 `dsh web` | `getDisplayMedia` + `MediaRecorder` | 需要允许屏幕共享；停录后本地 seek 抽帧 |

三条路的产物都是「带墙钟时间的帧」，之后的标注、导出、交付完全一致。

> **实测记录**：DSH 桌面端的插件宿主拿不到 `desktopCapturer`（`/state` 里 `nativeReason: "desktopCapturer 不可用"`），所以桌面端实际走 GDI。GDI 用 `System.Drawing` + `Graphics.CopyFromScreen`；320px / 4fps 时单帧约 5KB，1.4 秒取 5 帧、时间戳严格递增、停止后临时目录清干净（`node test/live-capture.mjs`）。代价是没有「选某个窗口」。

帧缓冲有上限（默认最多 900 帧 / 96MB / 5 分钟），超出丢最早的帧，长时间录制不会拖垮进程。

## 键鼠输入记录

「我按了 W 才卡住」「点这个按钮没反应」这类话，Agent 拿不到手感。插件在录制期间同时记键鼠，**和画面、日志共用一条时钟**：

- **记录什么**：每个键的按下/抬起（键名 + 虚拟键码）、鼠标左/右/中/X1/X2 的按下与抬起（带屏幕坐标）、前台窗口切换（目标程序 / 别的程序 / 插件自己）、可选的指针轨迹。
- **怎么记的**：`tools/record-input.ps1` 是长驻助手，每 20ms（约 30Hz）读一次 `GetAsyncKeyState`，**只写变化**。不装键盘钩子、不做键位翻译、不碰 `ToUnicode`——这是故意的：钩子既像键盘记录器（杀软敏感），又会把系统输入延迟拖进你的进程。
- **只在前台为目标程序时记**：设置里填「目标进程名」（`Remains`、`Remains.exe` 都行，可多个，逗号分隔）。你一 alt-tab 出去，记录就暂停并写一条「失焦释放」，不会把你在别处的输入记进来。插件宿主进程本身永远被排除。
- **按住时长**：抬起行会带 `(0.14s)`；失焦时正在按住的键不编造抬起时间，而是写一行 `blur-release: W, Space`，统计里不计入。
- **打点锚点**：按「⚑ 打点」时，自动找「打点前 2 秒内最后一次按下」，写进打点行与纪要——`（前一条输入：Space ↓ 0.12s 前）`。
- **上限**：一次录制最多留 20000 条（超出丢最早的并计数），原始 JSONL 超过 24MB 停止收；助手最长跑 30 分钟自己停。
- **依赖**：Windows + 系统自带的 Windows PowerShell 5.1。首次启动会编译一个小程序集（约 0.1–1 秒，之后走缓存，放在 `%LOCALAPPDATA%\dsh-incident-studio\`）。

**能不能用**由启动时的一次真探测决定，结果落在 `$DSH_HOME/storages/dsh-incident-studio/input-capability.json`；面板「设置」里会显示「输入助手可用（108 个键位）」或具体原因。不可用时只是这一项不工作，其它功能照旧。

> **实测记录**：`node test/live-input.mjs --inject` 会真的按一下左 Shift（单独的 Shift 不产生字符）并断言助手抓到了按下与抬起：155ms 的按住被记成两条事件，误差约半个采样间隔。30Hz 轮询下，助手进程约占单核 2.2% CPU，一条事件约 67–120 字节。

## 配置项

面板「设置」改的就是 `<DSH_HOME>/storages/dsh-incident-studio/profiles.json`（`DSH_HOME` 默认 `~/.dsh`；Windows 上是 `%USERPROFILE%\.dsh`），也可以直接编辑该文件：

```json
{
  "version": 1,
  "activeId": "my-project",
  "profiles": [
    {
      "id": "my-project",
      "name": "我的项目",
      "note": "主机与测试实例两份日志",
      "sources": [
        { "id": "main", "label": "主日志", "color": "#6aa9ff", "kind": "file",
          "path": "C:/Users/you/AppData/Roaming/MyApp/logs/main.log", "enabled": true, "preRoll": true },
        { "id": "test", "label": "测试实例", "color": "#7bd88f", "kind": "file",
          "path": "C:/Users/you/AppData/Roaming/MyApp-test/logs/main.log", "enabled": true, "preRoll": true }
      ],
      "input": { "enabled": true, "targets": "Remains.exe", "scope": "target", "pollMs": 20, "trailHz": 0 }
    }
  ]
}
```

- `path` **不展开** `%VAR%` / `$HOME`，写绝对路径或相对当前工作区的路径。
- `preRoll`（默认开）：录制开始时额外抓文件尾部最多 96KB / 800 行，标成「录制前」；历史行没有逐行时间戳，所以用序号占位（`-N` 毫秒）保证顺序。
- `kind` 目前是 `file`；`ingest`（HTTP 推送）与 `marker`（打点）由插件自己生成。
- `input`：键鼠记录设置，跟着 profile 走（每个游戏一份）。`targets` 是目标进程名（`.exe` 可省略、大小写不敏感、最多 8 个）；`scope: "all"` 表示除插件自身外的所有前台窗口；`pollMs` 是采样间隔（10–200，20≈30Hz、10≈60Hz）；`trailHz > 0` 时额外记指针轨迹（会明显变大，默认关）。`enabled: false` 关掉这一项。

宿主的可选配置（写在 profile 的 patch 行里）：

```yaml
- id: incident-studio
  config:
    artifactsDirName: .dsh-incidents   # 产物目录名（相对会话工作区）
    captureFps: 6                      # 抓帧频率
    captureWidth: 960                  # 抓帧宽度
    captureQuality: 62                 # JPEG 质量
    inputProbe: true                   # 启动时真跑一次输入助手（关掉可省一次 PowerShell）
```

### 一个可照抄的例子：Remains（Adobe AIR）模组日志

AIR 游戏的模组日志通常在 `File.applicationStorageDirectory` 下（app id 决定目录名），例如 `%APPDATA%\<app-id>\Local Store\`：

```
C:/Users/<you>/AppData/Roaming/pfe/Local Store/<ModName>.log     ← 主实例
C:/Users/<you>/AppData/Roaming/pfe2/Local Store/<ModName>.log    ← 双开测试实例
```

把上面两行换成绝对路径填进两个日志源即可。这类日志是**追加写**的：录制开始后只抓新行，`preRoll` 会把尾部历史带进来标成「录制前」，所以"我按录制前那两秒就出问题了"也能看到上下文；日志行本身没有时间戳，对齐靠"这一行写进文件的时刻"。

## 安装

需要 **DeepSeek Harness 0.2.1+**（本插件用 0.2.1 的 Connection 服务与侧边栏 tab API）。

```sh
# 直接从本仓库安装（client.js 已随仓库提交，无需构建）
dsh plugin --profile <profile> add https://github.com/Eclipse-NotFound/dsh-incident-studio

# 发布到 npm 之后也可以用包名
dsh plugin --profile <profile> add dsh-incident-studio
```

桌面端的 profile 由应用自己管理：在 **设置 → 插件** 里按包名/仓库地址安装，别用 CLI 装进 `profiles/web`（那不会出现在桌面端）。装完**重启一次**才会加载宿主半侧；浏览器半侧随宿主发布，页面会热更新重跑。

停用：在 `dsh.profile.bundles` 里删掉 `dsh-incident-studio`，或在 profile 的 patch 里加：

```yaml
- id: incident-studio
  disabled: true
```

## 隐私与安全边界

- **抓帧只在你按下「开始录制」之后进行，停止即停**。桌面端 GDI 拍的是整个虚拟桌面，敏感窗口请先移开。
- **键鼠记录同样只在录制期间，而且默认只记「目标程序在前台」的那段**。它只记「哪个键按下/抬起、鼠标点在哪」，**不记任何文字内容**（不做键位翻译、不碰 `ToUnicode`），也不安装键盘钩子；插件宿主进程本身永远被排除，所以你在面板或对话里打字不会被记。
- 画面帧、动图、键鼠原始记录、纪要**只写当前会话工作区的 `.dsh-incidents/`**；`profiles.json` 与三份回执（`client-boot.json` / `capture-capability.json` / `input-capability.json`）写在 `$DSH_HOME/storages/dsh-incident-studio/`。键鼠助手运行时的临时 JSONL 在系统临时目录，停止时归档进取证目录后即删除。
- **不上任何网络**：插件没有任何遥测。数据进模型是你按「填进输入框 / 直接发送」之后由 DSH 正常发出去的，和你手打一条消息没有区别。
- `/dsh-incident-studio/api/*` 走宿主 Web 服务的同源校验；外部进程只能凭每进程一换的 `x-incident-token` 推事件。`/open` 只允许打开本会话 `.dsh-incidents/` 内的路径。
- 自检回执只写数量与阶段（`client-boot.json` 记录页面跑到哪一步、`capture-capability.json` 只记屏幕/窗口**数量**、`input-capability.json` 只记键位数量与耗时），不记窗口标题、不抓像素、不记按键内容。

## 开发

```sh
npm ci                        # 开发依赖（类型参考 + 测试用的 jsdom / react-dom / gifenc）
node tools/build-client.mjs   # 拼接 src/client/*.js → client.js，并做语法自检
node test/run.mjs             # 457 项断言：主机全链路、输入记录、包清单形状、客户端纯函数、apply 座位、jsdom 交互、GIF/条带、采集轮询
node test/live-capture.mjs    # 真机 GDI 抓帧（会短暂截屏 1.4 秒 / 320px，抓完立即删除；CI 里别跑）
node test/live-input.mjs      # 真机输入助手（--inject 会按一下左 Shift 验证真能抓到；CI 里别跑）
node tools/check-live.mjs --fetch   # 对着正在运行的 DSH 核对：路由、模块图、下发的 bundle、抓帧/输入能力、页面回执
```

`client.js` 是**生成产物**，不要手改；`src/vendor/gifenc.js` 由 `tools/vendor-gifenc.mjs` 从 `node_modules/gifenc` 生成（MIT）。

```
index.js                        主机端：日志跟随、帧采集、输入记录接线、18 条路由、产物落盘
src/client/00-head.js … 90-tail.js   浏览器端源码（按序拼接成 client.js）
tools/grab-frames.ps1           Windows GDI 抓屏助手
tools/record-input.ps1          键鼠轮询助手（编译并加载下面的互操作程序集）
tools/input-interop.cs          互操作源码（GetAsyncKeyState / 前台进程 / 精确时钟 + 键位表）
tools/check-live.mjs            实机自检（路由 / 模块图 / 下发脚本 / 能力回执 / 页面回执）
test/host.test.mjs              起真 HTTP 服务跑全部路由
test/input.test.mjs             输入记录：配置规整、行解析、统计、锚点、Markdown、假助手全链路
test/manifest.test.mjs          包清单与发布物件形状（无 BOM、dsh.bundle、files 白名单）
test/pure.test.mjs              装载真正的 client.js 测纯函数
test/client-apply.test.mjs      假客户端上下文里跑 apply()、注册座位、走递交链路
test/capture.test.mjs           采集轮询、停止、失败上报、API 错误映射
test/dom.test.mjs               jsdom 里把面板点一遍（录制→打点→停止→描述→填进输入框）
test/live-capture.mjs           真机 GDI 抓帧
test/live-input.mjs             真机键鼠助手（探测 / 自检 / 真录 / 可选注入）
```

`check-live.mjs` 是排「到底加载了没有」的第一现场工具：`403` 说明路由已注册且按设计拒绝外部请求（`404` 才是没注册）；模块图里应有本插件条目，且服务端下发的 `client.js` 与本地构建逐字一致（服务端会多一行 source-map trailer）；`client-boot.json` 里应能看到 `apply → seat → panel` 三个阶段。

## 已知限制

- **发布时机**：宿主半侧在**启动时**装配（改 `index.js` 要重启 DSH）；浏览器 bundle 走热更新，宿主重组后页面会重新执行 `apply`。实测对 profile 的 `cordis.patch.yml` 做**实质内容修改**会触发宿主重组，只改插件目录里的文件不会。
- **对齐精度**：文件跟随是「行写进文件后」才看到的，误差几十毫秒；要更精确就让程序走 `/ingest` 并带 `wall`。
- **桌面端是帧序列不是视频**：默认 6 fps，看渐变/插值抖动够用，单帧级动画曲线不够；把 `captureFps` 调到 10–15 会同步增加内存与 JPEG 开销。
- **GDI 只能拍整个桌面**：选不了单个窗口，多显示器取并集。
- **GIF 是单一 128 色调色板**（首帧定全局表）：屏幕录制配色稳定时体积小、效果好；大面积渐变会有轻微色带。
- **浏览器路径的 webm 抽帧依赖 seek**：`MediaRecorder` 产物没有索引，极端情况下会丢尾帧。
- **没有语音**：描述靠打字与标注框。
- **键鼠只在前台为目标程序时记**：这是安全默认值，不是缺陷。想看「切出去之后游戏有没有崩」，靠日志与画面；`scope: "all"` 可以放开范围，但那就把其它窗口的按键也记进来了。
- **没有滚轮**：`GetAsyncKeyState` 看不到滚轮增量，要精确记需要装鼠标钩子或走 Raw Input，本插件刻意不做。滚轮操作请用「打点 + 文字描述」补。
- **键鼠时间精度是 ±1 个采样间隔**：默认 20ms（约 30Hz），要更细就设 `pollMs: 10`（约 60Hz，CPU 略高）。
- **助手需要能编译 C#**：杀软/EDR 可能拦住「运行时编译并加载小程序集」这一步（本机就撞到过 `Add-Type` 的临时文件被拒）。所以插件会启动时真跑一次探测，把结果写进 `input-capability.json`，面板会显示原因；被拦时只有输入记录这一项不可用。
- **产物目录在工作区内**：`.dsh-incidents/` 记得加进你的 `.gitignore`（`input.jsonl` 也在里面）。

## 许可

MIT。产品直觉受 [AGIHunt/blurt](https://github.com/AGIHunt/blurt)（Mac 菜单栏的「说给 Agent 听」工具）启发；这里是 DSH 内的通用取证面板，实现与场景不同。
