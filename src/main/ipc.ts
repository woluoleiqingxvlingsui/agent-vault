import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import type { Repo } from './db/repo'
import type { Scanner } from './scan/scanner'
import type { AgentAdapter } from './adapters/types'
import type { AgentDescriptor, Launcher, Project, SessionQuery } from '../shared/types'
import { evaluateAgent, evaluateLaunch } from './agents/capabilities'
import { AGENT_SOURCE_KEY } from './agents/keys'
import { launch } from './launch/launcher'
import type { Db } from './db/database'
import type { SourceWatcher } from './scan/watcher'
import type { ImportResponse, ScanPreferences } from '../shared/types'
import { getScanPreferences, saveScanPreferences } from './agents/preferences'
import { snapshot, stageRestore } from './io/backup'
import { buildExportBundle, exportToJson, exportToMarkdown } from './io/exporter'
import {
  importMarkdownSessions,
  importSessions,
  parseJsonImport,
  parseMarkdownImport
} from './io/importer'

export interface AppContext {
  repo: Repo
  scanner: Scanner
  adapters: AgentAdapter[]
  dataDir: string
  dbFile: string
  db: Db
  watcher: SourceWatcher
  notify: () => Promise<void>
  demoMode: boolean
}

const SOURCE_KEY = AGENT_SOURCE_KEY

export function registerIpc(ctx: AppContext): void {
  const { repo, scanner, adapters } = ctx

  const handle = <T>(channel: string, fn: (...args: any[]) => Promise<T> | T): void => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...args)
      } catch (err) {
        throw new Error(`${channel} 失败：${(err as Error).message}`)
      }
    })
  }

  // ------------------------------------------------------------------ app
  handle('app:info', () => ({
    dataDir: ctx.dataDir,
    dbFile: ctx.dbFile,
    version: app.getVersion(),
    electron: process.versions.electron,
    demo: ctx.demoMode
  }))

  handle('app:demo', async () => {
    ctx.watcher.stop()
    await scanner.suspend()
    const args = process.argv.slice(1).filter((a) => a !== '--demo')
    if (!ctx.demoMode) args.push('--demo')
    app.relaunch({ args })
    app.quit()
    return true
  })

  handle('scan:preferences', () => getScanPreferences(repo))
  handle('scan:configure', async (value: ScanPreferences) => {
    if (!Array.isArray(value?.agentIds)) throw new Error('请选择扫描来源')
    const agentIds = adapters.filter((a) => a.recordSupport !== 'none' && value.agentIds.includes(a.id)).map((a) => a.id)
    const prefs = { initialized: true, paused: ctx.demoMode || value.paused === true, agentIds: ctx.demoMode ? [] : agentIds }
    saveScanPreferences(repo, prefs)
    ctx.watcher.refresh()
    await ctx.notify()
    if (!prefs.paused) void scanner.scanSelected().then(ctx.notify).catch(() => undefined)
    return prefs
  })

  handle('app:openPath', async (target: string) => {
    if (!target) return false
    shell.showItemInFolder(target)
    return true
  })

  handle('shell:pickDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  handle('shell:pickFile', async (filters?: Electron.FileFilter[]) => {
    const win = BrowserWindow.getFocusedWindow()
    const options = filters?.length ? { filters } : {}
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })

  // ------------------------------------------------------------- launchers
  handle('launchers:list', () => repo.listLaunchers())

  handle('launchers:save', (launcher: Partial<Launcher>) => {
    if (!launcher?.name?.trim()) throw new Error('名称不能为空')
    if (!launcher?.kind) throw new Error('类型不能为空')
    if (!launcher?.command?.trim()) throw new Error('可执行文件或命令不能为空')
    return repo.saveLauncher({
      ...launcher,
      name: launcher.name.trim(),
      command: launcher.command.trim(),
      kind: launcher.kind,
      args: Array.isArray(launcher.args) ? launcher.args.map((a) => String(a)) : [],
      enabled: launcher.enabled ?? true
    })
  })

  handle('launchers:delete', (id: string) => repo.deleteLauncher(id))

  handle('launchers:setEnabled', ({ id, enabled }: { id: string; enabled: boolean }) => {
    repo.setLauncherEnabled(id, enabled)
    return repo.listLaunchers()
  })

  handle('launchers:launch', async (id: string) => {
    if (ctx.demoMode) return { ok: false, message: '演示模式不启动外部程序，请返回个人数据后使用' }
    const item = repo.getLauncher(id)
    if (!item) return { ok: false, message: '启动项不存在' }
    if (!item.enabled) return { ok: false, message: `启动项「${item.name}」已禁用` }
    const result = await launch({
      protocol: item.protocol,
      command: item.command,
      args: item.args,
      cwd: item.cwd,
      asDirectory: item.kind === 'project',
      useTerminal: item.kind === 'cli'
    })
    if (result.ok) repo.markLauncherLaunched(id, Date.now())
    return result
  })

  // -------------------------------------------------------------- projects
  handle('projects:list', () => repo.listProjects())

  handle('projects:save', (project: Partial<Project>) => {
    if (!project?.name?.trim()) throw new Error('项目名称不能为空')
    if (!project?.rootPath?.trim()) throw new Error('项目根目录不能为空')
    const saved = repo.saveProject({
      ...project,
      name: project.name.trim(),
      rootPath: project.rootPath.trim()
    })
    // 项目变化后重新计算自动归组（手动覆盖不受影响）
    repo.regroupAll()
    return saved
  })

  handle('projects:delete', (id: string) => {
    const removed = repo.deleteProject(id)
    repo.regroupAll()
    return removed
  })

  handle('projects:regroup', () => ({ changed: repo.regroupAll() }))

  handle('projects:stats', () => repo.projectStats())

  /** 提取文件原生图标（用于启动项卡片展示真实应用图标），结果按路径缓存 */
  const iconCache = new Map<string, string | null>()
  handle('app:icon', async (target: string) => {
    if (!target) return null
    if (iconCache.has(target)) return iconCache.get(target) ?? null
    try {
      const icon = await app.getFileIcon(target, { size: 'large' })
      const dataUrl = icon.toDataURL()
      iconCache.set(target, dataUrl)
      return dataUrl
    } catch {
      iconCache.set(target, null)
      return null
    }
  })

  // ---------------------------------------------------------------- agents
  const buildDescriptors = async (): Promise<AgentDescriptor[]> => {
    const descriptors: AgentDescriptor[] = []
    for (const adapter of adapters) {
      const configured = repo.getSetting(SOURCE_KEY(adapter.id)) ?? ''
      const saved = repo.getLauncher(`agent-${adapter.id}`)
      const effective = saved ? { ...adapter, launch: { ...adapter.launch, command: saved.command,
        args: saved.args, cwd: saved.cwd, protocol: saved.protocol } } : adapter
      const prefs = getScanPreferences(repo)
      const canProbe = !ctx.demoMode && prefs.initialized && !prefs.paused && prefs.agentIds.includes(adapter.id)
      const evaluation = canProbe ? await evaluateAgent(effective, configured) : {
        discoveredSources: [adapter.defaultSourcePath], capabilities: {
          launch: evaluateLaunch(effective).status, records: 'needs_config' as const,
          reasons: [ctx.demoMode ? '演示模式：不读取真实 Agent 来源' : prefs.paused && prefs.initialized ? '记录：自动扫描已暂停' : '记录：请先在扫描范围中启用此来源']
        }
      }
      const state = repo.getScanState(adapter.id)
      descriptors.push({
        id: adapter.id,
        name: adapter.name,
        vendor: adapter.vendor,
        surface: adapter.surface,
        launchProtocol: effective.launch.protocol,
        launchCommand: effective.launch.command,
        launchArgs: effective.launch.args,
        launchCwd: effective.launch.cwd,
        launchNote: adapter.launch.note,
        discoveredSources: evaluation.discoveredSources,
        configuredSource: configured,
        sourceHint: adapter.sourceHint,
        sourceAvailable: existsSync(configured || adapter.defaultSourcePath),
        recordSupport: adapter.recordSupport,
        capabilities: evaluation.capabilities,
        lastScanAt: state.lastScanAt,
        lastError: state.lastError,
        sessionCount: repo.countSessions(adapter.id)
      })
    }
    return descriptors
  }

  handle('agents:list', () => buildDescriptors())

  handle('agents:setSource', async ({ agentId, source }: { agentId: string; source: string }) => {
    if (!adapters.some((a) => a.id === agentId)) throw new Error('未知的 Agent')
    repo.setSetting(SOURCE_KEY(agentId), (source ?? '').trim())
    ctx.watcher.refresh()
    return buildDescriptors()
  })

  handle('agents:rescan', async (agentId: string) => {
    if (ctx.demoMode) throw new Error('演示模式不扫描真实来源')
    if (!getScanPreferences(repo).initialized || !getScanPreferences(repo).agentIds.includes(agentId)) throw new Error('请先在扫描范围中启用此来源')
    const adapter = adapters.find((a) => a.id === agentId)
    if (!adapter) throw new Error(`未知的 Agent：${agentId}`)
    const configured = repo.getSetting(SOURCE_KEY(agentId)) ?? ''
    const result = await scanner.scanAgent(agentId, { sourceRoot: configured, force: true })
    await ctx.notify()
    return { result, descriptors: await buildDescriptors() }
  })

  handle('agents:scanAll', async () => {
    const results = await scanner.scanSelected()
    await ctx.notify()
    return { results, descriptors: await buildDescriptors() }
  })

  // -------------------------------------------------------------- sessions
  handle('sessions:list', (query: SessionQuery) =>
    repo.listSessions({
      agentId: query?.agentId ?? null,
      projectId: query?.projectId ?? null,
      search: query?.search ?? '',
      sortBy: query?.sortBy ?? 'updatedAt',
      sortDir: query?.sortDir ?? 'desc',
      limit: query?.limit ?? 200,
      offset: query?.offset ?? 0
    })
  )

  handle('sessions:get', (id: string) => {
    const session = repo.getSession(id)
    if (!session) return null
    return { session, messages: repo.getSessionMessages(id) }
  })

  handle('sessions:setProject', ({ id, projectId }: { id: string; projectId: string | null }) => {
    repo.setSessionProject(id, projectId)
    return repo.getSession(id)
  })

  handle('sessions:counts', () => ({
    total: repo.countSessions(),
    byAgent: Object.fromEntries(adapters.map((a) => [a.id, repo.countSessions(a.id)]))
  }))

  // --------------------------------------------------------------- import
  handle('io:export', async ({ format, agentId }: { format: 'json' | 'markdown'; agentId?: string | null }) => {
    const bundle = buildExportBundle(repo, { agentId: agentId ?? null })
    const win = BrowserWindow.getFocusedWindow()
    const defaultName = `agent-vault-export-${new Date().toISOString().slice(0, 10)}.${format === 'json' ? 'json' : 'md'}`
    const filters =
      format === 'json'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: defaultName, filters })
      : await dialog.showSaveDialog({ defaultPath: defaultName, filters })
    if (result.canceled || !result.filePath) return { canceled: true }
    const content = format === 'json' ? exportToJson(bundle) : exportToMarkdown(bundle)
    await fs.writeFile(result.filePath, content, 'utf8')
    return {
      canceled: false,
      filePath: result.filePath,
      count: bundle.sessions.length,
      total: bundle.total
    }
  })

  handle(
    'io:import',
    async ({ filePath, format }: { filePath: string; format: 'json' | 'markdown' }): Promise<ImportResponse> => {
      const text = await fs.readFile(filePath, 'utf8')
      if (format === 'json') {
        const { bundle, error } = parseJsonImport(text)
        if (error) return { ok: false, error }
        // 先登记项目，保证项目归属可恢复
        for (const p of bundle!.projects) {
          const exists = repo.listProjects().find((x) => x.id === p.id)
          if (!exists) repo.saveProject({ id: p.id, name: p.name, rootPath: p.rootPath })
        }
        const result = importSessions(repo, bundle!.sessions)
        await ctx.notify()
        return { ok: true, result }
      }
      const parsed = parseMarkdownImport(text)
      if (!parsed.length) return { ok: false, error: 'Markdown 中未解析出任何会话' }
      const result = importMarkdownSessions(repo, parsed)
      await ctx.notify()
      return { ok: true, result }
    }
  )

  handle('io:backup', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const defaultName = `agent-vault-backup-${new Date().toISOString().slice(0, 10)}.db`
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: 'SQLite', extensions: ['db'] }] })
      : await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'SQLite', extensions: ['db'] }] })
    if (result.canceled || !result.filePath) return { canceled: true }
    if (path.resolve(result.filePath).toLowerCase() === path.resolve(ctx.dbFile).toLowerCase()) {
      throw new Error('不能将备份覆盖到正在使用的数据库')
    }
    snapshot(ctx.db, result.filePath)
    return { canceled: false, filePath: result.filePath }
  })

  handle('io:restore', async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '完整数据库备份', extensions: ['db'] }] })
    if (picked.canceled) return { canceled: true }
    const confirmation = await dialog.showMessageBox({ type: 'warning', buttons: ['取消', '备份当前数据并恢复'],
      defaultId: 0, cancelId: 0, message: '恢复将替换当前应用的启动项、项目、设置与全部会话，并重启应用。',
      detail: '不会修改外部 Agent 的原始记录。当前数据库将自动保存到数据目录的 backups 文件夹。' })
    if (confirmation.response !== 1) return { canceled: true }
    ctx.watcher.stop()
    await scanner.suspend()
    try {
      const backupDir = path.join(ctx.dataDir, 'backups')
      await fs.mkdir(backupDir, { recursive: true })
      snapshot(ctx.db, path.join(backupDir, `before-restore-${Date.now()}.db`))
      stageRestore(picked.filePaths[0], ctx.dbFile)
      app.relaunch()
      app.quit()
      return { canceled: false }
    } catch (err) {
      scanner.resume()
      ctx.watcher.start()
      throw err
    }
  })

  handle('io:revealDataDir', async () => {
    await shell.openPath(ctx.dataDir)
    return ctx.dataDir
  })

  handle('projects:reveal', async (target: string) => {
    if (!target) return false
    await shell.openPath(target)
    return true
  })
}

export function defaultDbFile(dataDir: string): string {
  return path.join(dataDir, 'agent-vault.db')
}
