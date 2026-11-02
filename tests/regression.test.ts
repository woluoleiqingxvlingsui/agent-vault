import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { buildExportBundle, exportToMarkdown } from '../src/main/io/exporter'
import {
  importMarkdownSessions,
  importSessions,
  parseMarkdownImport
} from '../src/main/io/importer'
import { computeContentHash, computeFingerprint } from '../src/main/domain/dedup'
import { createTestDb } from './helpers'
import { Scanner } from '../src/main/scan/scanner'
import type { AgentAdapter, SourceRef } from '../src/main/adapters/types'
import { createQoderSqliteAdapter } from '../src/main/adapters/qoder-sqlite'
import { AGENT_SOURCE_KEY } from '../src/main/agents/keys'

function seedSession(
  repo: ReturnType<typeof createTestDb>['repo'],
  input: {
    agentId: string
    externalId: string
    title: string
    content: string
    cwd?: string
    manualProjectId?: string | null
  }
): void {
  repo.upsertSession({
    agentId: input.agentId,
    externalId: input.externalId,
    fingerprint: computeFingerprint({ agentId: input.agentId, externalId: input.externalId }),
    title: input.title,
    createdAt: 1000,
    updatedAt: 2000,
    sourcePath: `C:\\src\\${input.externalId}.jsonl`,
    sourceCwd: input.cwd ?? 'C:\\code\\demo',
    rawMeta: { source: 'test' },
    contentHash: computeContentHash(input.title, [{ role: 'user', content: input.content }]),
    autoProjectId: null,
    sourceMtime: 1,
    messages: [
      { role: 'user', content: input.content, createdAt: 1000 },
      { role: 'assistant', content: '已处理', createdAt: 2000 }
    ]
  })
  if (input.manualProjectId !== undefined) {
    const session = repo
      .listSessions({ agentId: input.agentId, limit: 2000 })
      .items.find((s) => s.externalId === input.externalId)
    if (session) repo.setSessionProject(session.id, input.manualProjectId)
  }
}

describe('回归：Markdown 导出可以被完整切分回来', () => {
  it('多条会话的 Markdown 导出能按分隔符拆成多条', () => {
    const source = createTestDb()
    let md = ''
    try {
      seedSession(source.repo, {
        agentId: 'codex-cli',
        externalId: 'sess-1',
        title: '会话一',
        content: '内容一'
      })
      seedSession(source.repo, {
        agentId: 'codex-cli',
        externalId: 'sess-2',
        title: '会话二',
        content: '内容二'
      })
      seedSession(source.repo, {
        agentId: 'minimax-cli',
        externalId: 'sess-3',
        title: '会话三',
        content: '内容三'
      })
      md = exportToMarkdown(buildExportBundle(source.repo))
    } finally {
      source.cleanup()
    }

    const parsed = parseMarkdownImport(md)
    expect(parsed).toHaveLength(3)
    expect(parsed.map((p) => p.title).sort()).toEqual(['会话一', '会话三', '会话二'])
    expect(parsed.map((p) => p.agentId).sort()).toEqual(['codex-cli', 'codex-cli', 'minimax-cli'])
  })

  it('正文里的 ## 标题与 --- 分隔线不会破坏结构', () => {
    const source = createTestDb()
    let md = ''
    const tricky = [
      '## 这是正文里的二级标题',
      '---',
      '普通内容',
      '\\已经转义的行'
    ].join('\n')
    try {
      seedSession(source.repo, {
        agentId: 'codex-cli',
        externalId: 'sess-1',
        title: '带特殊字符的会话',
        content: tricky
      })
      md = exportToMarkdown(buildExportBundle(source.repo))
    } finally {
      source.cleanup()
    }

    const parsed = parseMarkdownImport(md)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].messages).toHaveLength(2)
    expect(parsed[0].messages[0].content).toBe(tricky)
  })

  it('Markdown 往返保留来源 cwd', () => {
    const source = createTestDb()
    let md = ''
    try {
      seedSession(source.repo, {
        agentId: 'codex-cli',
        externalId: 'sess-1',
        title: '带 cwd 的会话',
        content: '内容',
        cwd: 'C:\\code\\demo\\src'
      })
      md = exportToMarkdown(buildExportBundle(source.repo))
    } finally {
      source.cleanup()
    }
    const parsed = parseMarkdownImport(md)
    expect(parsed[0].sourceCwd).toBe('C:\\code\\demo\\src')
  })
})

describe('回归：导入恢复手动项目归属', () => {
  it('JSON 导入会恢复手动归属（manualProjectId）', () => {
    const source = createTestDb()
    const target = createTestDb()
    try {
      const project = source.repo.saveProject({ name: '演示项目', rootPath: 'C:\\code\\demo' })
      seedSession(source.repo, {
        agentId: 'codex-cli',
        externalId: 'sess-1',
        title: '手动归组的会话',
        content: '内容',
        manualProjectId: project.id
      })
      const bundle = buildExportBundle(source.repo)
      expect(bundle.sessions[0].manualProjectId).toBe(project.id)

      // 与界面导入入口一致：先登记导出包中的项目，再导入会话。
      for (const p of bundle.projects) target.repo.saveProject(p)
      const result = importSessions(target.repo, bundle.sessions)
      expect(result.imported).toBe(1)
      const restored = target.repo.listSessions({}).items[0]
      expect(restored.manualProjectId).toBe(project.id)
    } finally {
      source.cleanup()
      target.cleanup()
    }
  })

  it('Markdown 导入会把会话放进对应项目', () => {
    const source = createTestDb()
    const target = createTestDb()
    try {
      const project = source.repo.saveProject({ name: '演示项目', rootPath: 'C:\\code\\demo' })
      seedSession(source.repo, {
        agentId: 'codex-cli',
        externalId: 'sess-1',
        title: 'Markdown 会话',
        content: '内容',
        manualProjectId: project.id
      })
      const md = exportToMarkdown(buildExportBundle(source.repo))
      const parsed = parseMarkdownImport(md)
      const result = importMarkdownSessions(target.repo, parsed)
      expect(result.imported).toBe(1)
      const restored = target.repo.listSessions({}).items[0]
      expect(restored.effectiveProjectId).not.toBeNull()
      expect(restored.manualProjectId).not.toBeNull()
    } finally {
      source.cleanup()
      target.cleanup()
    }
  })
})

describe('回归：导出不会被单页上限截断', () => {
  it('超过 500 条会话时导出全部内容', () => {
    // 此处验证分页完整性；使用内存 SQLite，避免 520 次样本提交受 runner 磁盘延迟影响。
    // 持久化、WAL 和备份恢复用例仍使用真实临时磁盘库。
    const source = createTestDb({ memory: true })
    try {
      const total = 520
      for (let i = 0; i < total; i += 1) {
        seedSession(source.repo, {
          agentId: 'codex-cli',
          externalId: `sess-${i}`,
          title: `会话 ${i}`,
          content: `内容 ${i}`
        })
      }
      const bundle = buildExportBundle(source.repo)
      expect(bundle.total).toBe(total)
      expect(bundle.sessions).toHaveLength(total)
    } finally {
      source.cleanup()
    }
  })
})

describe('回归：扫描器使用用户配置的来源路径', () => {
  it('配置过来源路径后 resolveSourceRoot 返回配置值', () => {
    const { repo, cleanup } = createTestDb()
    try {
      const adapter: AgentAdapter = {
        id: 'fake-agent',
        name: 'Fake',
        vendor: 'Test',
        surface: 'cli',
        launch: { protocol: 'exec', command: 'x.exe', args: [], cwd: 'C:\\', note: '' },
        defaultSourcePath: 'C:\\default\\source',
        sourceHint: '',
        recordSupport: 'file',
        supportsWatch: true,
        async discover(): Promise<SourceRef[]> {
          return []
        },
        async parse(): Promise<never[]> {
          return []
        }
      }
      const scanner = new Scanner(repo, [adapter])
      expect(scanner.resolveSourceRoot(adapter)).toBe('C:\\default\\source')
      repo.setSetting(AGENT_SOURCE_KEY('fake-agent'), 'C:\\custom\\source')
      expect(scanner.resolveSourceRoot(adapter)).toBe('C:\\custom\\source')
      expect(scanner.resolveSourceRoot(adapter, 'C:\\override')).toBe('C:\\override')
    } finally {
      cleanup()
    }
  })
})

describe('回归：源端删除的会话会被清理', () => {
  it('重新扫描后源端已删除的会话不再保留', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-cleanup-'))
    const { repo, cleanup } = createTestDb()
    try {
      const file = path.join(dir, 's1.json')
      const payload = { cwd: 'C:\\code\\demo', title: '会话', body: '内容' }
      await fs.writeFile(file, JSON.stringify(payload), 'utf8')

      let visible = true
      const adapter: AgentAdapter = {
        id: 'fake-agent',
        name: 'Fake',
        vendor: 'Test',
        surface: 'cli',
        launch: { protocol: 'exec', command: 'x.exe', args: [], cwd: 'C:\\', note: '' },
        defaultSourcePath: dir,
        sourceHint: '',
        recordSupport: 'file',
        supportsWatch: true,
        async discover(): Promise<SourceRef[]> {
          const stat = await fs.stat(file)
          return [{ path: file, file, mtimeMs: stat.mtimeMs, size: stat.size }]
        },
        async parse(): Promise<Array<{ externalId: string | null; title: string; createdAt: number | null; updatedAt: number | null; cwd: string | null; sourcePath: string; rawMeta: Record<string, unknown>; messages: Array<{ role: string; content: string; createdAt: number | null }> }>> {
          if (!visible) return []
          return [
            {
              externalId: 'ext-1',
              title: '会话',
              createdAt: 1000,
              updatedAt: 2000,
              cwd: payload.cwd,
              sourcePath: file,
              rawMeta: {},
              messages: [{ role: 'user', content: '内容', createdAt: 1000 }]
            }
          ]
        }
      }
      const scanner = new Scanner(repo, [adapter])

      await scanner.scanAgent('fake-agent', { sourceRoot: dir })
      expect(repo.countSessions()).toBe(1)

      // 源端把会话删掉了
      visible = false
      await scanner.scanAgent('fake-agent', { sourceRoot: dir, force: true })
      expect(repo.countSessions()).toBe(0)
    } finally {
      cleanup()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('回归：WAL 模式下的来源变更能被感知', () => {
  it('Qoder 来源的 mtime 包含 -wal 附属文件', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-wal-'))
    let db: DatabaseSync | null = null
    try {
      const file = path.join(dir, 'main.sqlite')
      db = new DatabaseSync(file)
      db.exec('PRAGMA journal_mode=WAL')
      db.exec('CREATE TABLE t(a INTEGER)')
      db.prepare('INSERT INTO t VALUES (?)').run(1)

      const adapter = createQoderSqliteAdapter({
        id: 'qoder-cn',
        name: 'Qoder CN',
        vendor: 'Qoder',
        surface: 'desktop',
        launch: { protocol: 'exec', command: 'x.exe', args: [], cwd: 'C:\\', note: '' },
        defaultSourcePath: file,
        sourceHint: ''
      })

      const before = await adapter.discover(file)
      expect(before).toHaveLength(1)

      // WAL 模式下主库文件 mtime 不变，只有 -wal 变
      db.prepare('INSERT INTO t VALUES (?)').run(2)
      const after = await adapter.discover(file)
      expect(after[0].mtimeMs).toBeGreaterThan(before[0].mtimeMs)
    } finally {
      // 必须先关闭再删：断言失败也会走到这里，句柄泄漏会让删除一直失败
      db?.close()
      // Windows 上 -wal / -shm 的句柄释放有延迟，直接删会 EBUSY
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })
})
