# 插件更新与回退

法斗桌宠由 DSH 的 profile 管理（桌面版是 `desktop`，WebUI 是 `web`）。Helper 不提供
独立更新器，也不要手动替换 `runtime/bin/` 里的编译产物——那个目录不入库，装包时由
`prepare` 脚本按当前平台重新编译。

## 从 git 更新

1. 完全退出 DSH。
2. 在 DSH 安装目录重新执行安装命令（仓库是公开的，`git+https://`、`github:` 简写、SSH 都可以）：

```bash
dsh plugin --profile web add git+https://github.com/leonty1/dsh-desktop-pet-bulldog.git
```

pnpm 把 git 依赖锁到解析时的提交，所以同一条命令会按 spec 重新解析：spec 里写
`#main` 就跟分支，写 `#<commit>` 就锁提交。第一次安装若被 pnpm 拦下构建脚本，按它打印的
那串 key 写进 profile 的 `pnpm-workspace.yaml` 再重跑：pnpm 11 是 `allowBuilds` 映射
（key 形如 `dsh-frenchie@<spec>#<commit>`），pnpm 10 是 `onlyBuiltDependencies` 列表（写包名）。

这一步要下载的是仓库本身——帧和 Helper 都是构建产物、不入库，仓库跟踪约 1.2 MB——装包时由
`prepare` 现烘帧、现编 macOS Helper。实测一次完整的仓库安装（解析、下载、烘帧、编译）约 2 分钟。

桌面版（Electron）的 profile 归应用管：`dsh plugin --profile desktop …` 会被直接拒绝，
装卸都在应用的「插件」页里做。

`add` 会替换 profile 里原有的插件依赖。重新启动 DSH 后，插件、状态卡和 Helper 一起
更新。用户设置由 DSH 保存，正常更新不需要重新配置。

## 从本地目录或压缩包更新

开发中的改动直接重装目录：

```bash
dsh plugin --profile web add .
```

分发给别的机器时先 `npm pack`，再安装打出的 `dsh-frenchie-<version>.tgz`：

```bash
dsh plugin --profile web add ./dsh-frenchie-0.1.0.tgz
```

## 回退

回退就是把安装 spec 换回旧版本：旧提交（`…#<commit>`）、旧的本地目录，或之前保留的
旧 `.tgz`。

## 卸载

```bash
dsh plugin --profile web remove dsh-frenchie
```

DSH 可能留下一份不再生效的历史设置，它不会启动进程，也不会占用端口。
