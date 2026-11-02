import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Scanner } from '../src/main/scan/scanner'
import type { AgentAdapter, SourceRef } from '../src/main/adapters/types'
import { createTestDb } from './helpers'

function makeAdapter(files: Map<string, string>): AgentAdapter {
  return {
    id: 'fake-agent',
    name: 'Fake Agent',
    vendor: 'Test',
    surface: 'cli',
    launch: { protocol: 'exec', command: 'x.exe', args: [], cwd: 'C:\\', note: '' },
    defaultSourcePath: 'C:\\fake',
    sourceHint: 'fixture',
    recordSupport: 'file',
    supportsWatch: true,
    async discover(): Promise<SourceRef[]> {
      const refs: SourceRef[] = []
      for (const [p, content] of files) {
        const stat = await fs.stat(p)
        refs.push({ path: p, file: p, mtimeMs: stat.mtimeMs, size: stat.size })
      }
      return refs
    },
    async parse(ref: SourceRef) {
      const content = files.get(ref.path) ?? ''
      const payload = JSON.parse(content) as { cwd: string; title: string; body: string }
      return [
        {
          externalId: path.basename(ref.path),
          title: payload.title,
          createdAt: 1000,
          updatedAt: 2000,
          cwd: payload.cwd,
          sourcePath: ref.path,
          rawMeta: {},
          messages: [{ role: 'user', content: payload.body, createdAt: 1000 }]
        }
      ]
    }
  }
}

describe('扫描器：增量扫描与自动归组', () => {
  it('首次导入后再次扫描不会产生副本（按来源 mtime 跳过）', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-scan-'))
    const { repo, cleanup } = createTestDb()
    try {
      const file = path.join(dir, 's1.json')
      await fs.writeFile(
        file,
        JSON.stringify({ cwd: 'C:\\code\\demo', title: '会话', body: '内容' }),
        'utf8'
      )
      const files = new Map([[file, await fs.readFile(file, 'utf8')]])
      const adapter = makeAdapter(files)
      const scanner = new Scanner(repo, [adapter])

      const first = await scanner.scanAgent('fake-agent', { sourceRoot: dir })
      expect(first.imported).toBe(1)
      expect(repo.countSessions()).toBe(1)

      const second = await scanner.scanAgent('fake-agent', { sourceRoot: dir })
      expect(second.imported).toBe(0)
      expect(second.skipped).toBe(1)
      expect(repo.countSessions()).toBe(1)
    } finally {
      cleanup()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('自动归组按项目根目录最长匹配', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-scan-'))
    const { repo, cleanup } = createTestDb()
    try {
      const outer = repo.saveProject({ name: '外层', rootPath: 'C:\\code' })
      const inner = repo.saveProject({ name: '内层', rootPath: 'C:\\code\\demo' })

      const file = path.join(dir, 's1.json')
      const content = JSON.stringify({ cwd: 'C:\\code\\demo\\src', title: '会话', body: '内容' })
      await fs.writeFile(file, content, 'utf8')
      const adapter = makeAdapter(new Map([[file, content]]))
      const scanner = new Scanner(repo, [adapter])

      await scanner.scanAgent('fake-agent', { sourceRoot: dir })
      const session = repo.listSessions({}).items[0]
      expect(session.autoProjectId).toBe(inner.id)
      expect(session.autoProjectId).not.toBe(outer.id)
    } finally {
      cleanup()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('无法匹配项目的会话进入未分组', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-scan-'))
    const { repo, cleanup } = createTestDb()
    try {
      const file = path.join(dir, 's1.json')
      const content = JSON.stringify({ cwd: 'E:\\elsewhere', title: '会话', body: '内容' })
      await fs.writeFile(file, content, 'utf8')
      const adapter = makeAdapter(new Map([[file, content]]))
      const scanner = new Scanner(repo, [adapter])

      await scanner.scanAgent('fake-agent', { sourceRoot: dir })
      const session = repo.listSessions({}).items[0]
      expect(session.autoProjectId).toBeNull()
      expect(session.effectiveProjectId).toBeNull()
    } finally {
      cleanup()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
