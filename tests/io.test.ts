import { describe, expect, it } from 'vitest'
import { buildExportBundle, exportToJson, exportToMarkdown } from '../src/main/io/exporter'
import {
  importMarkdownSessions,
  importSessions,
  parseJsonImport,
  parseMarkdownImport
} from '../src/main/io/importer'
import { computeContentHash, computeFingerprint } from '../src/main/domain/dedup'
import { createTestDb } from './helpers'

function seed(repo: ReturnType<typeof createTestDb>['repo'], projectId: string | null): void {
  repo.upsertSession({
    agentId: 'codex-cli',
    externalId: 'sess-1',
    fingerprint: computeFingerprint({ agentId: 'codex-cli', externalId: 'sess-1' }),
    title: '修复登录问题',
    createdAt: 1000,
    updatedAt: 2000,
    sourcePath: 'C:\\src\\sess-1.jsonl',
    sourceCwd: 'C:\\code\\demo',
    rawMeta: { source: 'codex' },
    contentHash: computeContentHash('修复登录问题', [{ role: 'user', content: 'hello' }]),
    autoProjectId: projectId,
    sourceMtime: 1,
    messages: [
      { role: 'user', content: 'hello', createdAt: 1000 },
      { role: 'assistant', content: 'hi there', createdAt: 2000 }
    ]
  })
}

describe('JSON 导入导出', () => {
  it('导出后可在空数据目录重新导入，并恢复项目归属', () => {
    const source = createTestDb()
    let json = ''
    try {
      const project = source.repo.saveProject({ name: '演示项目', rootPath: 'C:\\code\\demo' })
      seed(source.repo, project.id)
      const bundle = buildExportBundle(source.repo)
      expect(bundle.sessions).toHaveLength(1)
      expect(bundle.projects).toHaveLength(1)
      json = exportToJson(bundle)
    } finally {
      source.cleanup()
    }

    const target = createTestDb()
    try {
      const parsed = parseJsonImport(json)
      expect(parsed.error).toBeUndefined()
      const bundle = parsed.bundle!
      for (const p of bundle.projects) {
        target.repo.saveProject({ id: p.id, name: p.name, rootPath: p.rootPath })
      }
      const result = importSessions(target.repo, bundle.sessions)
      expect(result.imported).toBe(1)
      expect(result.failed).toBe(0)
      expect(target.repo.countSessions()).toBe(1)

      const list = target.repo.listSessions({})
      expect(list.items[0].title).toBe('修复登录问题')
      expect(list.items[0].sourceCwd).toBe('C:\\code\\demo')
      expect(target.repo.getSessionMessages(list.items[0].id)).toHaveLength(2)

      // 重复导入不产生副本
      const again = importSessions(target.repo, bundle.sessions)
      expect(again.imported).toBe(0)
      expect(again.skipped).toBe(1)
      expect(target.repo.countSessions()).toBe(1)
    } finally {
      target.cleanup()
    }
  })

  it('非本工具格式的文件给出明确错误', () => {
    expect(parseJsonImport('not json').error).toBeTruthy()
    expect(parseJsonImport('{"a":1}').error).toBeTruthy()
  })
})

describe('Markdown 导入导出', () => {
  it('导出后可被解析回来（标题 / Agent / 项目 / 正文）', () => {
    const source = createTestDb()
    let md = ''
    try {
      const project = source.repo.saveProject({ name: '演示项目', rootPath: 'C:\\code\\demo' })
      seed(source.repo, project.id)
      md = exportToMarkdown(buildExportBundle(source.repo))
    } finally {
      source.cleanup()
    }

    expect(md).toContain('# 修复登录问题')
    expect(md).toContain('- agent: codex-cli')

    const parsed = parseMarkdownImport(md)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].title).toBe('修复登录问题')
    expect(parsed[0].agentId).toBe('codex-cli')
    expect(parsed[0].projectName).toBe('演示项目')
    expect(parsed[0].messages).toHaveLength(2)
    expect(parsed[0].messages[0].content).toBe('hello')

    const target = createTestDb()
    try {
      const result = importMarkdownSessions(target.repo, parsed)
      expect(result.imported).toBe(1)
      expect(target.repo.countSessions()).toBe(1)
      const list = target.repo.listSessions({})
      expect(list.items[0].title).toBe('修复登录问题')
      expect(list.items[0].effectiveProjectId).not.toBeNull()
      expect(target.repo.getSessionMessages(list.items[0].id)).toHaveLength(2)
    } finally {
      target.cleanup()
    }
  })
})
