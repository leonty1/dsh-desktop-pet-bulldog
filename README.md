# Windows 补丁集

给 **dsh-frenchie**（法斗桌宠）的 Windows 补丁。本目录**不改动仓库里的任何原有文件**：所有改动都
以补丁和独立伴生插件的形式放在这里。

针对 `dsh-frenchie 0.1.0` + DSH `0.2.0-rc.2`（Windows 11 / x64）实测。

## 修的是什么

### 1. Qt Helper 根本起不来 —— `patches/0002-ship-runtime-asset-paths.patch`

`runtime/helper.py` 第 21–28 行就要 `import asset_paths`，但 `runtime/asset_paths.py` 既不在仓库里
（`git ls-files runtime` 只有 4 个文件，raw.githubusercontent 上是 404），也不在 `package.json` 的
`files` 清单里。于是 **Windows / Linux 的桌面窗口从来没有起来过**：源码运行和 PyInstaller 冻结包都会
在这一行 `ModuleNotFoundError`。

`0002` 只补这一个运行时模块；把它加进 `files`、并忽略 `__pycache__/` 属于打包元数据，放在只对仓库
有意义的 `patches/0003-packaging-includes-the-module.patch` 里 —— 已安装的副本没有 `.gitignore`，
也不读 `files`。

模块本身取自本仓库所 fork 的上游 [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)（同一
MIT 血统），它实现的 `bundle_root()` 正是 `src/helper-process.js` 的缓存所假设的三级解析：冻结 exe
旁边 → 插件目录 → PyInstaller `_MEIPASS`。

### 2. 桌面上只有一颗脑袋 —— `patches/0001-qt-helper-logical-frame-size.patch`

精灵帧按 **2 倍**分辨率烘焙（仓库里 1240 张全是 824×688），而窗口尺寸、宠物矩形和所有命中框都用
清单里的**逻辑**尺寸（412×344）。`draw_pet` 却直接拿原始像素宽乘 `scale`：

| 角色大小 | 窗口（逻辑） | 实际画出的图 |
| --- | --- | --- |
| 0.6（默认） | 297 × 232 | **494 × 413** |
| 1.4 | 627 × 508 | 1153 × 963 |

狗被画成窗口的两倍多高，只有左上角那四分之一落在窗口内，看起来就是"只有脑袋"。补丁先除以烘焙倍率
（`_frame_pixel_ratio`）再乘 `scale`；2 倍帧继续负责 HiDPI 清晰度，画笔本来就开着
`SmoothPixmapTransform`。

### 3. 设置界面到不了 —— `plugin/`

本体把设置卡注册进 `settings.plugin.item`，而当前 DSH 里**没有任何包声明这个席位**（整个
`app.asar` 搜不到这个键，现在的官方做法是 `settings.plugins.tab`），卡片因此没有宿主：在界面上
翻遍「设置 → 插件」也找不到法斗的设置项。

`plugin/` 是一个**独立的 DSH 伴生插件**，用 DSH 给插件开放的席位把它补回来：

- 侧边栏最底部、设置那一条的正上方加两个入口：**宠物**（打开法斗设置面板）、**设置**（打开 DSH 设置）；
- 面板里就是本体那张设置卡（读写它自己已声明的 `/plugins/dsh-frenchie/config`），另加一个本体没有的
  **弹窗不透明度**（存在 `localStorage`，不碰本体的 schema）；
- 侧栏折叠成 56px 轨道时两个入口变成圆形图标按钮。

细节与席位表见 [plugin/README.md](plugin/README.md)。

## 目录

```text
windows-patch/
  README.md            本文件
  install.ps1          一键：应用补丁 + 安装伴生插件（-Uninstall 反向，-RebuildHelper 重编 Helper）
  patches/
    0001-qt-helper-logical-frame-size.patch        运行时，已安装副本与本仓库都适用
    0002-ship-runtime-asset-paths.patch            运行时，同上
    0003-packaging-includes-the-module.patch       只对仓库有意义（files 清单、忽略规则）
  plugin/              伴生插件：左下角两个入口 + 法斗设置面板
```

补丁按作用对象分两组：`0001` / `0002` 只碰 `runtime/`，所以打给**已安装的副本**（`install.ps1`
只应用这两个）；`0003` 改打包清单和忽略规则，只在你想从克隆出包时才有意义，在克隆根目录
`git apply windows-patch/patches/*.patch` 一并打上即可。

## 安装

一键（推荐，脚本会把两种情形都处理好，并在已应用时跳过）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows-patch\install.ps1 -RebuildHelper
```

手工两步：

```powershell
# 1) 把运行时补丁打到 profile 里已安装的那份副本上（只打 0001、0002）
$pet = "$env:DSH_HOME\profiles\desktop\node_modules\dsh-frenchie"   # web profile 换成 profiles\web
git -C $pet apply $PWD\windows-patch\patches\0001-qt-helper-logical-frame-size.patch
git -C $pet apply $PWD\windows-patch\patches\0002-ship-runtime-asset-paths.patch
cd $pet; npm run build:helper          # 冻结包必须重打，0001 才会生效

# 2) 装上左下角那两个入口
dsh plugin --profile desktop add $PWD\windows-patch\plugin
```

只想修 Qt Helper、不要界面入口：只做第 1 步即可。想让**克隆**本身也带上修复（例如自己出 exe）：
在仓库根目录 `git apply windows-patch/patches/*.patch`（三个补丁都能干净应用）。

## 卸载

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows-patch\install.ps1 -Uninstall
```

## 注意

- 补丁作用于 **profile 里已安装的那份 dsh-frenchie**（DSH 装的是打包产物）。插件一旦重装或升级，
  补丁随 node_modules 一起被替换 —— 重跑一次脚本即可；脚本会识别"已应用"和"打不上"两种情况。
- Helper 是冻结产物：`0001` 只在你重新 `npm run build:helper` 之后才体现在桌面上。新 exe 的字节数
  与旧的不同，而插件按尺寸给缓存命名（`%LOCALAPPDATA%\dsh-frenchie\<版本>\dsh-frenchie-helper-<大小>.exe`），
  所以重启后会自动用上新的那份，不需要手工清缓存。
- 本补丁集不修改本体的 `lib/client.js` / `src/plugin.js` / `runtime/helper.py` 之外的任何东西，也不
  向本体的配置 schema 里加字段；两个入口完全由独立插件提供，卸载后本体照旧。
- 若上游以后把这三点修了，删掉对应补丁即可：`install.ps1` 会跳过已经打不上的补丁并明确报出来，
  而不是留下半截状态。

## English summary

This directory is the Windows patch set for **dsh-frenchie**. It touches none of the repository's
own files:

- `patches/0002` restores `runtime/asset_paths.py`, which `runtime/helper.py` imports and the
  repository never shipped — the Qt Helper died on `ModuleNotFoundError` before drawing a frame.
- `patches/0001` divides the 2x-baked sprite frames (824×688) by their baked ratio before applying
  `scale`; the window and every hit box are logical (412×344), so the sprite used to be drawn twice
  the window and only its head was visible.
- `plugin/` is a companion DSH plugin that adds the 宠物 / 设置 entries at the sidebar foot and hosts
  the pet's settings panel, because the seat the pet's own settings card targets
  (`settings.plugin.item`) is declared by no package in DSH 0.2.0-rc.2.

Run `install.ps1 -RebuildHelper` to apply both patches to the installed plugin, install the
companion and rebuild the frozen Helper; `-Uninstall` reverses it.
