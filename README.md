<div align="center">

**中文** · [English →](README_EN.md)

# DSH 法斗桌宠 🐕

**住在桌面上、跟着 DeepSeek Harness 真实会话状态换动作的伴侣插件。**

[更新与回退](docs/UPDATING.md) · [皮肤管线](skin/README.md)

</div>

![八个状态各自的样子](docs/images/frenchie-states.png)

DSH 启用它、也负责它的启停。桌面上是一只透明、无边框、始终置顶的法斗，动作来自 DSH 的会话
事件，不来自屏幕截图——你在别的应用里敲键盘它不会动。

## 安装

macOS（原生 Swift 窗口，本仓库的主路径）：

```bash
git clone git@github.com:leonty1/dsh-desktop-pet-bulldog.git
cd dsh-desktop-pet-bulldog
npm install          # prepare 会编出 Helper：十三秒，只需要 Command Line Tools 的 swiftc
dsh plugin --profile web add .
```

Windows / Linux 用随包的 PySide6 Helper，装包时不自动编译（那要 Python + PyInstaller +
PySide6，几分钟的下载和冻结不该塞进安装），显式跑一次：

```bash
npm install
npm run build:helper
dsh plugin --profile web add .
```

也可以让 DSH 直接从 git 装（本仓库是公开的，`git+https://`、`github:` 简写和 SSH 都行）：

```bash
dsh plugin --profile web add git+https://github.com/leonty1/dsh-desktop-pet-bulldog.git
```

**这条在慢网络上看运气**：pnpm 解析出 commit 之后，是去 `codeload.github.com` 下该 commit 的
tar.gz，而这个包约 40 MB 几乎全是精灵帧。这台机器实测到 codeload 只有约 17 KB/s——五分钟收到
5 MB 就断了，所以 pnpm 必然在 fetch 超时上报 `error (23)` / `TimeoutError`；把 profile 的
`pnpm-workspace.yaml` 里 `settings.fetchTimeout` 提到 900000 也没救回来。日常用上面的目录安装。

pnpm 还会先拦下带构建脚本的依赖，按它打印的提示写进 profile 的 `pnpm-workspace.yaml` 再重跑：
pnpm 11 要 `allowBuilds` 映射，key 是它原样打印的那串 `dsh-frenchie@<spec>#<commit>`；pnpm 10 要
`onlyBuiltDependencies` 列表，写包名即可。

桌面版（Electron）的 profile 归应用自己管：`dsh plugin --profile desktop …` 会直接拒绝，要在应用
的「插件」页里装卸。更新与回退见 [docs/UPDATING.md](docs/UPDATING.md)。装完照常启动 DSH，不需要
手动开 Helper。

## 状态与动作

DSH 的会话状态映射到一段 clip（`assets/pet-manifest.json` 的 `stateMap`）：

| DSH 状态 | clip | 它的样子 |
| --- | --- | --- |
| `IDLE` | `idle` | 坐着，慢慢呼吸，偶尔瞟一眼 |
| `THINKING` | `thinking` | 抬头想，耳朵跟着动 |
| `WORKING` | `working` / `working_command` | 见下一段 |
| `WAITING` | `waiting` | 趴着，下巴搁在前爪上，隔一会儿眨一次眼 |
| `SUCCESS` | `success` | 吐舌叫两声 |
| `ERROR` | `error` | 缩成一团呜咽，眼睛转圈 |
| `DISCONNECTED` | `idle` | 回到静息 |

`WORKING` 按工具类型再分一次：搜索、读文件、改文件是伏案敲键盘（`working`）；执行命令、
跑测试是皱眉盯着屏幕等输出（`working_command`）。

空闲时每隔一会儿来一次小动作——瞟眼、抬爪挥一下、甩尾、舔舌头，频率由「空闲活跃度」
（安静 / 标准 / 活泼）决定。

安静下来是分两级的：到「趴下时间」（默认 1 分钟）先趴下休息，眼睛还睁着；继续安静到
「入睡时间」（默认 6 分钟）才闭上眼飘 Z。两个计时都从最后一次动静算起，任一设为 0 就跳过
那一级；趴着的时候来了新状态，它会先站起来再干活。趴下和起身是两段真动作（`lie_down` /
`wake_up`），不是切图。

## 桌面互动

- **拖动**：按住身体挪位置，位置会存下来；身体以外的空白和头顶气泡都不是把手。松手之后依次
  是弹开、晕乎（眼睛转圈）、抗议（整个转过身去背对你，停一下再转回来），每段都按它自己的
  动画长度停留，开启「减少动态」时跳过。
- **点击**：按落点分——点头顶摸头，点前爪它把爪子抬起来，点右侧甩尾巴，点别处是戳一下；
  双击一律摸头。之后回到最新的 DSH 状态。
- **悬停**：碰到就起身；macOS 上空闲时眼神还会跟着光标走（Qt 端只做到起身）。
- **右键**：大小、气泡大小、减少动态、打开 WebUI、本次隐藏或本次关闭。

## 状态卡

单任务时是两行：状态标题加当前这一步（项目名、阶段、待办进度、实际采用的推理强度）。

多个任务同时跑时列成一张表，展开 6 秒后自动折成一枚小胶囊——只写最早开始的那个任务和
「+N」；鼠标放到气泡上重新展开全部，移开两秒后再折回。有新任务加入或某个任务结束时也会
重新展开，任务进度的刷新不会打断折叠。

## 设置

入口：DSH 设置 → 插件 → 插件配置 → 桌面法斗。都由 DSH 保存，更新插件通常不用重配。

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 启用桌面法斗 | 开 | 关掉就不起 Helper |
| 角色大小 | 0.6 | 0.5–1.4 |
| 气泡大小 | 1 | 0.8–1.2 |
| 空闲活跃度 | 标准 | 安静 / 标准 / 活泼，控制小动作频率 |
| 减少动态 | 关 | 停用微动作和松手反应，循环帧定在静息那一帧 |
| 趴下时间 | 1 分钟 | 安静多久趴下，0 为不趴 |
| 入睡时间 | 6 分钟 | 安静多久睡着，0 为不睡 |
| 提示音 | 开 | 完成或出错时响一声 |
| 气泡显示 | 常驻 | 常驻 / 隐藏 / 自定义哪些状态显示（默认 SUCCESS、ERROR、WAITING） |
| 子 Agent 抢占 | 关 | 打开后子会话的状态也能上卡 |
| 页面内桌宠 | 关 | 在 DSH 页面右下角显示一个轻量版，可与桌面窗口同时开 |

## 仓库结构

```text
src/           DSH 插件：会话事件归约、状态优先级、与 Helper 的换行 JSON 协议
native/macos/  macOS 原生透明置顶窗口（Swift/AppKit）
runtime/       Windows/Linux 的 PySide6 Helper，以及两端共用的动画状态机
assets/        25 段精灵帧与 pet-manifest.json
skin/          烘焙这些帧的骨骼管线（母图、分层、逐帧矩阵、SVG 合成）
docs/          更新与回退、发布记录、验收记录
runtime/bin/   编译产物，不入库
```

## 皮肤是怎么来的

一张母图切成分层骨骼（躯干、头、两只耳朵、一只前爪），每根骨头带父级和枢轴，每个 clip 是
这套骨架的一个姿态，帧以 2 倍分辨率烘焙（逻辑 412×344，设备 824×688）。所有状态共用同一
副身体，所以切换动作不会在两张不同的画之间跳。细节在 [skin/README.md](skin/README.md)。

```bash
npm run skin                         # 重烘 25 段 clip
node skin/build-sprites.mjs --rest   # 每副骨架静息态与母图对差
node skin/outline-scan.mjs           # 轮廓上有没有断线
```

结果落在 `skin/frames/`，确认后同步到 `assets/`。

## 开发与测试

```bash
npm install
npm test             # 用装好的 Helper 走一遍协议，并抓一张可视快照
npm run test:swift   # 状态机与布局存储的单测，需要 Xcode
```

`test:swift` 在只有 Command Line Tools 的机器上跑不了——CLT 不带 XCTest，`swift test`
会报 `no such module 'XCTest'`。Qt 端和 Swift 端是两份并行实现，改动画规则要同时改
`runtime/animation_model.py` 和 `native/macos/Sources/AnimationModel.swift`，两端一致性
靠同一份 manifest 分别驱动来核对。

## 边界

- 只吃 DSH 的 Agent 事件：不截图、不读其它应用、不把你在别处的操作当成 DSH 在干活。
- DSH 没给待办清单时只显示「分析阶段」这类可靠信息，不编造完成百分比。
- macOS 的 `.app` 是 ad-hoc 签名，没有 Developer ID 签名或公证。
- 设置与桌面文案目前是简体中文。

## 许可与来源

代码是 MIT（[`LICENSE`](./LICENSE)）。本仓库 fork 自社区插件
[dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)：协议、状态机骨架和 Helper 沿用上游，
法斗的外观（`assets/pet/`、`skin/`）和 macOS 原生窗口是本仓库重做的，美术来源与授权见
[`ASSET_LICENSE.md`](./ASSET_LICENSE.md)。
