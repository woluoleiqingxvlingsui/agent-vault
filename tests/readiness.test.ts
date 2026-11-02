import { describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createTestDb } from './helpers'
import { Db } from '../src/main/db/database'
import { Repo } from '../src/main/db/repo'
import { buildExportBundle } from '../src/main/io/exporter'
import { importSessions, importMarkdownSessions, parseMarkdownImport, parseJsonImport } from '../src/main/io/importer'
import { snapshot, stageRestore, applyPendingRestore, validateBackup } from '../src/main/io/backup'
import { getScanPreferences, saveScanPreferences, seedAgentLaunchers } from '../src/main/agents/preferences'
import { resolveExecutable } from '../src/main/launch/launcher'
import { Scanner } from '../src/main/scan/scanner'
import { SourceWatcher } from '../src/main/scan/watcher'
import type { AgentAdapter } from '../src/main/adapters/types'

const session = (title: string, content = title) => ({
  id: '', agentId: 'codex-cli', externalId: null, title, createdAt: 1, updatedAt: 2,
  messageCount: 1, sourcePath: '', sourceCwd: null, autoProjectId: null, manualProjectId: null,
  rawMeta: {}, messages: [{ role: 'user', content, createdAt: 1 }]
})
const adapter = (id: string, root = 'C:\\demo'): AgentAdapter => ({
  id, name: id, vendor: 'demo', surface: 'cli', recordSupport: 'file', supportsWatch: true,
  launch: { protocol: 'exec', command: 'demo.exe', args: [], cwd: '', note: '' },
  defaultSourcePath: root, sourceHint: '', discover: vi.fn(async () => []), parse: vi.fn(async () => [])
})

describe('发布前数据与配置回归', () => {
  it('关联可以清空，未提供字段仍保留原值', () => {
    const t = createTestDb()
    try {
      const p = t.repo.saveProject({ name: 'p', rootPath: 'C:\\p' })
      const l = t.repo.saveLauncher({ name: 'l', kind: 'app', command: 'x', projectId: p.id })
      expect(t.repo.saveLauncher({ id: l.id, name: 'l', kind: 'app', command: 'x' }).projectId).toBe(p.id)
      expect(t.repo.saveLauncher({ ...l, projectId: null }).projectId).toBeNull()
      t.repo.saveProject({ ...p, launcherId: l.id })
      expect(t.repo.saveProject({ ...p, launcherId: null }).launcherId).toBeNull()
    } finally { t.cleanup() }
  })

  it('重新初始化不会覆盖用户启动命令、参数与工作目录', () => {
    const t = createTestDb()
    try {
      const a = adapter('test')
      seedAgentLaunchers(t.repo, [a])
      const saved = t.repo.getLauncher('agent-test')!
      t.repo.saveLauncher({ ...saved, command: 'custom.exe', args: ['a b'], cwd: 'C:\\custom' })
      seedAgentLaunchers(t.repo, [a])
      expect(t.repo.getLauncher(saved.id)).toMatchObject({ command: 'custom.exe', args: ['a b'], cwd: 'C:\\custom' })
    } finally { t.cleanup() }
  })

  it('无稳定标识的 JSON 会话按内容区分，重复导入不产生副本', () => {
    const t = createTestDb()
    try {
      expect(importSessions(t.repo, [session('one'), session('two')])).toMatchObject({ imported: 2, updated: 0 })
      expect(importSessions(t.repo, [session('one'), session('two')])).toMatchObject({ skipped: 2, imported: 0 })
      expect(t.repo.countSessions()).toBe(2)
    } finally { t.cleanup() }
  })

  it('无来源的多条 Markdown 会话不会合并', () => {
    const t = createTestDb()
    try {
      const parsed = parseMarkdownImport('# one\n- agent: codex-cli\n## user\none\n---\n\n# two\n- agent: codex-cli\n## user\ntwo\n')
      expect(importMarkdownSessions(t.repo, parsed).imported).toBe(2)
      expect(importMarkdownSessions(t.repo, parsed).skipped).toBe(2)
    } finally { t.cleanup() }
  })

  it('坏会话不会阻止好会话导入，并返回失败原因', () => {
    const t = createTestDb()
    try {
      const result = importSessions(t.repo, [null as never, session('good')])
      expect(result).toMatchObject({ imported: 1, failed: 1 })
      expect(result.errors).toHaveLength(1)
    } finally { t.cleanup() }
  })

  it('JSON 手动未分组及消息时间戳可以往返', () => {
    const t = createTestDb(); const target = createTestDb()
    try {
      importSessions(t.repo, [{ ...session('manual'), manualProjectId: '' }])
      const bundle = buildExportBundle(t.repo)
      importSessions(target.repo, bundle.sessions)
      const restored = buildExportBundle(target.repo).sessions[0]
      expect(restored.manualProjectId).toBe('')
      expect(restored.messages).toEqual(bundle.sessions[0].messages)
    } finally { t.cleanup(); target.cleanup() }
  })

  it('拒绝未来版本与无效项目结构，兼容省略 projects 的包', () => {
    expect(parseJsonImport('{"version":999,"sessions":[]}').error).toBeTruthy()
    expect(parseJsonImport('{"version":1,"sessions":[],"projects":[null]}').error).toBeTruthy()
    expect(parseJsonImport('{"version":1,"sessions":[]}').bundle?.projects).toEqual([])
  })

  it('PATH 同时支持无扩展名与带扩展名的系统命令', () => {
    expect(resolveExecutable('cmd').ok).toBe(true)
    expect(resolveExecutable('cmd.exe').ok).toBe(true)
  })

  it('未确认时不发现来源，选择范围后只扫描已选来源', async () => {
    const t = createTestDb()
    try {
      const a = adapter('a'); const b = adapter('b'); const scanner = new Scanner(t.repo, [a, b])
      expect(getScanPreferences(t.repo).initialized).toBe(false)
      await scanner.scanSelected()
      expect(a.discover).not.toHaveBeenCalled()
      saveScanPreferences(t.repo, { initialized: true, paused: false, agentIds: ['b'] })
      await scanner.scanSelected()
      expect(a.discover).not.toHaveBeenCalled(); expect(b.discover).toHaveBeenCalledOnce()
      saveScanPreferences(t.repo, { initialized: true, paused: true, agentIds: ['b'] })
      await scanner.scanSelected()
      expect(b.discover).toHaveBeenCalledOnce()
    } finally { t.cleanup() }
  })

  it('自动扫描排队后取消来源，不再读取该来源', async () => {
    const t = createTestDb()
    try {
      const a = adapter('a'); const b = adapter('b')
      let release!: () => void
      a.discover = vi.fn(() => new Promise<[]>((resolve) => { release = () => resolve([]) }))
      const scanner = new Scanner(t.repo, [a, b])
      saveScanPreferences(t.repo, { initialized: true, paused: false, agentIds: ['a', 'b'] })
      const running = scanner.scanAgent('a')
      await Promise.resolve()
      const queued = scanner.scanAgent('b', { automatic: true })
      saveScanPreferences(t.repo, { initialized: true, paused: true, agentIds: [] })
      release(); await running; await queued
      expect(b.discover).not.toHaveBeenCalled()
    } finally { t.cleanup() }
  })

  it('完整备份包含 WAL 最新提交以及启动项、设置，恢复前不替换当前库', async () => {
    const t = createTestDb()
    try {
      t.db.exec('PRAGMA journal_mode=WAL')
      t.db.exec('PRAGMA wal_autocheckpoint=0')
      t.repo.saveLauncher({ name: 'Original', kind: 'app', command: 'x.exe' })
      t.repo.setSetting('audit-setting', 'saved')
      importSessions(t.repo, [session('WAL recent')])
      const file = path.join(t.dir, 'backup.db')
      snapshot(t.db, file); validateBackup(file)
      const backup = new Db(file, { readOnly: true })
      try {
        const repo = new Repo(backup)
        expect(repo.countSessions()).toBe(1)
        expect(repo.getSetting('audit-setting')).toBe('saved')
        expect(repo.listLaunchers()[0].name).toBe('Original')
      } finally { backup.close() }
      t.repo.setSetting('audit-setting', 'changed')
      stageRestore(file, path.join(t.dir, 'test.db'))
      expect(t.repo.getSetting('audit-setting')).toBe('changed')
      t.db.close()
      applyPendingRestore(path.join(t.dir, 'test.db'))
      const restored = new Db(path.join(t.dir, 'test.db'))
      try { expect(new Repo(restored).getSetting('audit-setting')).toBe('saved') }
      finally { restored.close() }
      // 已有备份文件可以被新快照安全覆盖。
      const current = new Db(path.join(t.dir, 'test.db'))
      try { snapshot(current, file) } finally { current.close() }
    } finally { t.cleanup() }
  })

  it('损坏或其他 SQLite 数据库不能进入恢复队列', async () => {
    const t = createTestDb()
    try {
      const invalid = path.join(t.dir, 'invalid.db')
      await fs.writeFile(invalid, 'invalid')
      expect(() => stageRestore(invalid, path.join(t.dir, 'test.db'))).toThrow()
      expect(t.repo.listProjects()).toEqual([])
      expect(() => validateBackup(path.join(t.dir, 'missing.db'))).toThrow()
    } finally { t.cleanup() }
  })

  it('替换中断后可回滚旧文件，再恢复；旧 WAL 不会应用到新库', async () => {
    const t = createTestDb()
    try {
      t.repo.setSetting('saved', 'old')
      const dbFile = path.join(t.dir, 'test.db')
      const backup = path.join(t.dir, 'backup.db')
      snapshot(t.db, backup)
      stageRestore(backup, dbFile)
      t.db.close()
      // 模拟主库已移走、附属文件已移走，但尚未安装新库时进程中断。
      await fs.rename(dbFile, `${dbFile}.restore-previous`)
      await fs.writeFile(`${dbFile}.restore-previous-wal`, 'old sidecar marker')
      applyPendingRestore(dbFile)
      const restored = new Db(dbFile)
      try { expect(new Repo(restored).getSetting('saved')).toBe('old') }
      finally { restored.close() }
      await expect(fs.stat(`${dbFile}-wal`)).rejects.toThrow()
    } finally { t.cleanup() }
  })
})

describe('来源监听回归', () => {
  it('共用目录的 Agent 都会收到文件事件，换目录后监听立即更新', async () => {
    const t = createTestDb()
    let watcher: SourceWatcher | undefined
    try {
      const a = adapter('a', t.dir); const b = adapter('b', t.dir)
      saveScanPreferences(t.repo, { initialized: true, paused: false, agentIds: ['a', 'b'] })
      const scanner = new Scanner(t.repo, [a, b])
      const scanned = vi.spyOn(scanner, 'scanAgent')
      watcher = new SourceWatcher(scanner, [a, b], { intervalMs: 100_000, debounceMs: 20 })
      watcher.start()
      await fs.writeFile(path.join(t.dir, 'event.txt'), 'one')
      await vi.waitFor(() => {
        expect(scanned).toHaveBeenCalledWith('a', { automatic: true }); expect(scanned).toHaveBeenCalledWith('b', { automatic: true })
      })
      const next = path.join(t.dir, 'next'); await fs.mkdir(next)
      t.repo.setSetting('agent.source.b', next)
      watcher.refresh(); scanned.mockClear()
      await fs.writeFile(path.join(next, 'event.txt'), 'two')
      await vi.waitFor(() => expect(scanned).toHaveBeenCalledWith('b', { automatic: true }))
    } finally { watcher?.stop(); t.cleanup() }
  })

  it('轮询完成通知界面，暂停后不再扫描', async () => {
    const t = createTestDb()
    let watcher: SourceWatcher | undefined
    try {
      const a = adapter('a', path.join(t.dir, 'not-created'))
      const scanner = new Scanner(t.repo, [a]); const notify = vi.fn()
      saveScanPreferences(t.repo, { initialized: true, paused: false, agentIds: ['a'] })
      watcher = new SourceWatcher(scanner, [a], { intervalMs: 20, onScan: notify })
      watcher.start()
      await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('a'))
      saveScanPreferences(t.repo, { initialized: true, paused: true, agentIds: ['a'] })
      watcher.refresh(); notify.mockClear()
      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(notify).not.toHaveBeenCalled()
    } finally { watcher?.stop(); t.cleanup() }
  })
})
