import { describe, expect, it } from 'vitest'
import { computeContentHash, computeFingerprint } from '../src/main/domain/dedup'
import { createTestDb } from './helpers'

function insert(repo: ReturnType<typeof createTestDb>['repo'], cwd: string, title: string): string {
  const fingerprint = computeFingerprint({ agentId: 'codex-cli', externalId: title })
  return repo.upsertSession({
    agentId: 'codex-cli',
    externalId: title,
    fingerprint,
    title,
    createdAt: 1,
    updatedAt: 1,
    sourcePath: `C:\\src\\${title}.jsonl`,
    sourceCwd: cwd,
    rawMeta: {},
    contentHash: computeContentHash(title, [{ role: 'user', content: 'x' }]),
    autoProjectId: null,
    sourceMtime: 1,
    messages: [{ role: 'user', content: 'x', createdAt: 1 }]
  }).id
}

describe('项目变更后重新归组', () => {
  it('新增项目后，未匹配过的会话会按最长路径重新归组', () => {
    const { repo, cleanup } = createTestDb()
    try {
      const sessionId = insert(repo, 'C:\\code\\demo\\src', '会话A')
      expect(repo.getSession(sessionId)?.autoProjectId).toBeNull()

      const outer = repo.saveProject({ name: '外层', rootPath: 'C:\\code' })
      const inner = repo.saveProject({ name: '内层', rootPath: 'C:\\code\\demo' })
      const changed = repo.regroupAll()

      expect(changed).toBe(1)
      expect(repo.getSession(sessionId)?.autoProjectId).toBe(inner.id)
      expect(repo.getSession(sessionId)?.autoProjectId).not.toBe(outer.id)
    } finally {
      cleanup()
    }
  })

  it('手动覆盖的会话在重新归组后保持不变', () => {
    const { repo, cleanup } = createTestDb()
    try {
      const sessionId = insert(repo, 'C:\\code\\demo\\src', '会话B')
      const manual = repo.saveProject({ name: '手动项目', rootPath: 'D:\\manual' })
      repo.setSessionProject(sessionId, manual.id)

      repo.saveProject({ name: '自动项目', rootPath: 'C:\\code\\demo' })
      repo.regroupAll()

      expect(repo.getSession(sessionId)?.manualProjectId).toBe(manual.id)
      expect(repo.getSession(sessionId)?.effectiveProjectId).toBe(manual.id)
    } finally {
      cleanup()
    }
  })

  it('删除项目后会话回退到自动归组结果', () => {
    const { repo, cleanup } = createTestDb()
    try {
      const sessionId = insert(repo, 'C:\\code\\demo', '会话C')
      const project = repo.saveProject({ name: 'P', rootPath: 'C:\\code\\demo' })
      repo.regroupAll()
      expect(repo.getSession(sessionId)?.autoProjectId).toBe(project.id)

      repo.deleteProject(project.id)
      repo.regroupAll()
      expect(repo.getSession(sessionId)?.autoProjectId).toBeNull()
    } finally {
      cleanup()
    }
  })
})
