# macOS 原生 Helper

> **AI 辅助生成**：本目录的 Swift 源码由 AI 辅助生成，经人工 review 与调试后合入。

桌宠有两个 Helper 实现：本目录的 Swift + AppKit 版用于 macOS，`runtime/helper.py`
的 PySide6 版用于 Windows / Linux。两者说同一套 stdin/stdout 协议、读同一份
`assets/pet-manifest.json`，因此行为必须对齐（见下「两端一致性」）。Swift 版不依赖
Python、Qt 或 PyObjC：一个 `swiftc` 就能编出来，`npm install` 的 `prepare` 在 macOS 上
现编（约十三秒），所以窗口实现里任何一处改动都不需要等打包机。

## 兼容性

- Universal binary：Apple Silicon（arm64）+ Intel（x86_64）
- 最低系统：macOS 12.0（`build.sh` 以 `-target *-apple-macosx12.0` 构建）
- 构建工具：Xcode Command Line Tools（`swiftc` + `lipo` + `codesign`）

## 功能

- 状态展示：`IDLE / THINKING / WORKING / WAITING / SUCCESS / ERROR / DISCONNECTED`，
  状态卡 + 多任务卡；多任务卡展开 6 秒后折成只写最早任务的小胶囊，鼠标悬停在气泡上重新展开
- 动画内核：动作全部烘进精灵帧（`skin/`），窗口本身不做任何程序化位移、缩放或旋转；
  两端用同一份 manifest 驱动，clip 之间的切换靠 crossfade
- 交互：左键拖拽（抓取、松手、眩晕与抗议动画，位置持久化）、单击摸头、双击、
  右键菜单（大小 / 气泡大小 / 减少动态 / 打开 WebUI / 辅助功能权限 / 本次隐藏 / 本次关闭）
- 全屏置顶：`NSWindow.CollectionBehavior` 的 `canJoinAllSpaces` + `fullScreenAuxiliary` +
  `stationary`，`NSWindow.Level.floating`，每 2 秒重新断言层级并 `orderFrontRegardless()`
- 布局持久化：`~/.dsh/dsh-frenchie/layout.json`（`$DSH_HOME`、`%LOCALAPPDATA%\DSH\`、
  `$XDG_CONFIG_HOME/dsh/` 各按平台优先）；首次启动会把旧 Qt Helper 写的 top-left 坐标
  换算成 AppKit 的 bottom-left
- 权限：UserNotifications 通知授权（SUCCESS/ERROR 脉冲时提示，拿不到就退回 beep + 抖动）、
  Accessibility 检查与请求（`AXIsProcessTrustedWithOptions` + 系统设置深链）
- 协议：与 `src/protocol.js` 一致（ready/pong/closed + state/pulse/task/tasks/config/shutdown），
  调试开关 `--headless` `--event-log` `--snapshot`

## 构建

```bash
npm run build:helper:darwin      # 即 bash native/macos/build.sh
```

产物 `runtime/bin/darwin/dsh-frenchie-helper.app`：素材由 `build.sh` 打进
`Contents/Resources/assets`，所以换皮肤后要重跑这一步（即使 Swift 代码没动）。
构建会 ad-hoc 签名并用 `codesign --verify --deep --strict` 校验包完整性；这不等于
Developer ID 签名或公证，带隔离属性的下载包仍可能被 Gatekeeper 拦下。

## 测试

```bash
npm run test:swift               # swift test --package-path native/macos
```

状态机（`AnimationModel`）与布局持久化（`PetLayout`）的断言在 `Tests/`，用 `Package.swift`
里的 `BigFishCore` 库 target 编译；`main.swift` 被排除（包 target 不能同时放顶层可执行代码），
`ProtocolIO` 因此单列在 `Sources/ProtocolIO.swift`。`swift test` 需要 XCTest，而 XCTest 不随
Command Line Tools 分发：只有 CLT 的机器上 `swift build` 能过、`swift test` 报
`no such module 'XCTest'`。这类机器上跑 `npm test`（打包 Helper 的可视烟测 + stdin EOF 生命周期），
它验证的是最终 `.app` 真的能起、能收协议、能退。

## 两端一致性

布局存储镜像 `runtime/layout_store.py` 的 `normalise_layout`，读写都过 `normalized()`。
测试发现并修掉的漂移：

- `defaultPath()` 缺 `XDG_CONFIG_HOME`（及 `LOCALAPPDATA`）回退，与 Python 的平台路径优先级
  不一致 → 已补齐，并支持注入环境字典以便测试
- JSON 布尔值会被 Swift 桥接成 `1/0`，导致 `x: true` 被当作坐标、`scale: false` 被当作
  `0.55` → 已按 Python 语义排除布尔值
- `bubbleStates` 含非法项时 Python 只保留字符串项，Swift 会整组丢弃 → 已改为同样的过滤
- `save()` 前不做归一化（Python 会 clamp scale/bubbleScale、校验 bubbleMode）→ 已统一
- Python 侧把布局写在 `dsh-dafeiyu/` 目录、环境变量前缀是 `DSH_DAFEIYU_`，与 Swift 的
  `dsh-frenchie/` 不一致 → 两端统一为 `dsh-frenchie/` 与 `DSH_FRENCHIE_`

事件日志的断言按协议语义匹配：JS 侧原先按 `"kind": "ping"`（带空格）的字符串匹配，与 JSON
序列化格式耦合；现改为逐行 `JSON.parse` 后判断 `kind`，Swift 与 Python 两个实现都能通过。

## 接入与回退

`src/helper-process.js` 在 `process.platform === 'darwin'` 时优先用本目录编出的 `.app`；
Helper 崩溃由插件重启，stdin/stdout/stderr 的 EPIPE 已兜底，不会拖垮 DSH。
临时停用：侧栏的宠物按钮或右键菜单「本次隐藏」。装卸插件本身走应用的插件页
（桌面 profile 由应用自己管），详见主 README。
