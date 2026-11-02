# 开发与验收

## 本地检查

```powershell
npm ci
npm run verify
npm run build
npm run pack:dir
```

验收使用虚构数据与临时数据库。发布前还应在干净 Windows 环境安装并运行 NSIS / 便携版，检查外部 Agent 启动与实际版本的记录解析。GitHub Actions 需推送后才能独立验证，本地出包不能替代远程工作流结果。

## 真实数据诊断脚本

以下脚本不在自动测试或启动流程内，运行前请理解其作用：

- `npx vite-node scripts/verify-roundtrip.ts`：只读打开个人数据库，导出到临时目录，再导入临时数据库；比较会话集合、有效归属、消息数量和重复导入结果，失败以非零退出。结束清理临时导出。
- `npx vite-node scripts/verify-rescan.ts`：会打开并修改个人应用数据库，重新扫描真实来源，可能更新或清理本地会话。先备份，不要把它当作只读检查。
- `npx vite-node scripts/verify-launch.ts`：启动测试外部命令，检查退出反馈。

scripts 已包含在 TypeScript 检查中。自动测试不读取个人会话目录。

## 旧截图 fixture 复现

README 截图使用以下专用目录中的虚构 Agent 文件。内置一键演示模式更适合普通用户体验，不需要执行本流程。

```powershell
$env:VAULT_DEMO_ROOT = 'C:\agent-vault-demo'
npm run make:demo
npm run build
$env:USERPROFILE = 'C:\agent-vault-demo'
$env:APPDATA = 'C:\agent-vault-demo\AppData\Roaming'
$env:LOCALAPPDATA = 'C:\agent-vault-demo\AppData\Local'
$env:VAULT_SCREENSHOT = '.\docs\screenshots\launch.png'
npx electron .
```

先在此虚构环境内确认扫描范围，诊断会依次抓取启动、会话、设置、项目与浅色主题。生成脚本会重建演示根目录下的 Agent 样本及应用库，请使用专用目录，不能指向个人工作目录。示例环境变量只作用于当前 PowerShell，结束后关闭窗口即可。

`VAULT_SCREENSHOT` 仅在显式设置时启用，不会读取 screenshot-request.txt。正式运行不要设置此变量；截图可能显示会话正文，提交前逐张检查。

## 数据与接口

应用数据库迁移版本记录在 schema_migrations，当前包含启动项、项目、会话、消息、设置、扫描状态及来源增量状态。会话 JSON 是交换格式，不是整库恢复协议。修改 schema 应新增迁移，验证旧库升级与当前备份恢复，不得破坏用户手动归属。

来源监听由 SourceWatcher 管理，Scanner 串行化解析与写入；首次扫描范围保存在 settings。退出/恢复会停止监听并等候扫描队列结束。源端适配器保持只读。

备份使用 VACUUM INTO 生成 SQLite 一致性快照；恢复先校验、迁移副本，再以 restore-pending 文件等待重启替换。恢复前完整备份保存在数据目录 backups 下，需由用户保管。
