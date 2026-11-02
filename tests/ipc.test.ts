import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createTestDb } from './helpers'
import { Scanner } from '../src/main/scan/scanner'
import { SourceWatcher } from '../src/main/scan/watcher'
import { registerIpc } from '../src/main/ipc'
import { createCodexAdapter } from '../src/main/adapters/codex'

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>())
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
  app: { getVersion: () => '0.1.0', relaunch: vi.fn(), quit: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {}, shell: {}
}))
afterEach(() => handlers.clear())

describe('界面 IPC 合约与首次使用隐私', () => {
  it('确认前不解析来源，导入返回嵌套统计与失败信息', async () => {
    const t = createTestDb()
    const adapter = createCodexAdapter({ id: 'codex-cli', name: 'test', surface: 'cli',
      defaultSourcePath: t.dir, sourceHint: '', matchOriginator: () => true, originatorLabel: '',
      launch: { command: 'cmd.exe', protocol: 'exec', args: [], cwd: '', note: '' } })
    const discover = vi.spyOn(adapter, 'discover')
    const parse = vi.spyOn(adapter, 'parse')
    const scanner = new Scanner(t.repo, [adapter]); const watcher = new SourceWatcher(scanner, [adapter])
    try {
      registerIpc({ repo: t.repo, scanner, adapters: [adapter], dataDir: t.dir,
        dbFile: path.join(t.dir, 'test.db'), db: t.db, watcher, notify: vi.fn(async () => {}), demoMode: false })
      await handlers.get('agents:list')!({})
      expect(discover).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled()
      await expect(handlers.get('agents:rescan')!({}, 'codex-cli')).rejects.toThrow('扫描范围')
      const file = path.join(t.dir, 'exchange.json')
      await fs.writeFile(file, JSON.stringify({ version: 1, sessions: [
        { agentId: 'codex-cli', title: 'good', messages: [{ role: 'user', content: 'hello' }] },
        { title: 'missing agent', messages: [] }
      ] }))
      const response = await handlers.get('io:import')!({}, { filePath: file, format: 'json' })
      expect(response).toMatchObject({ ok: true, result: { imported: 1, failed: 1 } })
      expect(response.result.errors[0]).toContain('缺少 Agent')
    } finally { watcher.stop(); t.cleanup() }
  })

  it('演示模式拒绝启动外部程序', async () => {
    const t = createTestDb(); const scanner = new Scanner(t.repo, []); const watcher = new SourceWatcher(scanner, [])
    try {
      registerIpc({ repo: t.repo, scanner, adapters: [], dataDir: t.dir,
        dbFile: path.join(t.dir, 'test.db'), db: t.db, watcher, notify: vi.fn(async () => {}), demoMode: true })
      expect(await handlers.get('launchers:launch')!({}, 'any')).toMatchObject({ ok: false })
    } finally { watcher.stop(); t.cleanup() }
  })
})
