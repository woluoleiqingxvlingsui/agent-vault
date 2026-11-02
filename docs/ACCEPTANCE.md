# 本地验收记录 · 2026-11-02

本记录对应本次发布准备修复，不代表已运行 GitHub 远程工作流或已在其它电脑验证。

## 已通过

- `npm run verify`：主进程、渲染层、测试和 scripts 类型检查通过；11 个测试文件、67 个用例通过。
- `npm run build`：主进程、preload、渲染层构建通过。
- `git diff --check`：通过。
- 构建 NSIS 安装包与便携版；目录版、便携单文件均以 `--demo` 启动，显示虚构会话、独立演示提示和可用界面。
- 使用 computer-use 检查开发构建的启动页、设置页与启动配置表单；修正演示提示挤压主内容的布局问题。
- 新增回归覆盖：关联清空、配置保留、无稳定身份导入、部分失败、手动未分组、PATH 扩展名、确认前不读来源、范围与暂停、排队取消、共用目录监听、轮询通知、WAL 一致备份、恢复中断与旧 WAL 隔离、IPC 返回结构。
- 完整备份恢复在临时样本数据库验证，未对个人数据库执行恢复。
- 应用 asar 内容检查：只包含构建产物与包信息，没有数据库、会话原文件或密钥；打包主进程与当前 out/main/index.js 字节一致，未发现个人用户目录常量。
- 忽略规则检查覆盖默认命名导出、数据库备份、密钥、证书和 .npmrc。没有提交、推送或发布。

## 打包环境与处理

初次 Electron 下载遭遇 TLS 连接中断，最终使用已安装的 Electron 38.8.6 与打包工具镜像验证：

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
node node_modules/electron-builder/cli.js --win nsis portable --config.electronDist=node_modules/electron/dist
```

本机图标转换子进程曾异常退出，已将转换后的原生 ICO 纳入 build/icon.ico，并显式配置打包使用，避免每次重新转换。包均未代码签名。

## 当前产物

| 文件（release/，未纳入 Git） | 字节数 | SHA-256 |
| --- | ---: | --- |
| Agent Vault-0.1.0-x64.exe | 102214118 | 41DE1974E424A91D15A5B04E8E728D05428852D34030D4916CFE0F7D10E81EC5 |
| Agent Vault-0.1.0-portable.exe | 94029208 | F3EFF80C31FF4ED15B103DE4979B141F328C8D853E78F5B6A737811FED4CAB86 |

## 尚未验证

- GitHub Actions 在干净 Windows runner 的依赖下载、构建及 Release 上传，需未来授权推送后核实。
- NSIS 安装、卸载和跨机器行为，本轮没有实际安装。
- 各外部 Agent 在其它版本、安装渠道和设备上的启动与记录格式。
- 大规模会话与长时间运行性能；本轮不使用个人聊天记录进行压力测试。

程序源码和验证通过不等同于所有环境无 bug。发布前请结合上述范围决定是否作为测试版发布。
