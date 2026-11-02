import { describe, expect, it } from 'vitest'
import { UNGROUPED } from '../src/shared/types'
import { computeContentHash, computeFingerprint } from '../src/main/domain/dedup'
import { Db } from '../src/main/db/database'
import { Repo } from '../src/main/db/repo'
import { createTestDb } from './helpers'

function seedSession(
  repo: ReturnType<typeof createTestDb>['repo'],
  opts: {
    agentId: string
    externalId: string
    title: string
    body: string
    createdAt: number
    updatedAt?: number
    cwd?: string
    sourcePath?: string
    autoProjectId?: string | null
  }
): string {
  const fingerprint = computeFingerprint({
    agentId: opts.agentId,
    externalId: opts.externalId
  })
  const outcome = repo.upsertSession({
    agentId: opts.agentId,
    externalId: opts.externalId,
    fingerprint,
    title: opts.title,
    createdAt: opts.createdAt,
    updatedAt: opts.updatedAt ?? opts.createdAt,
    sourcePath: opts.sourcePath ?? `C:\\src\\${opts.externalId}.jsonl`,
    sourceCwd: opts.cwd ?? null,
    rawMeta: {},
    contentHash: computeContentHash(opts.title, [{ role: 'user', content: opts.body }]),
    autoProjectId: opts.autoProjectId ?? null,
    sourceMtime: 1,
    messages: [{ role: 'user', content: opts.body, createdAt: opts.createdAt }]
  })
  return outcome.id
}

describe('数据模型：启动项与项目', () => {
  it('启动项支持新增、编辑、禁用、删除', () => {
    const { repo, cleanup } = createTestDb()
    try {
      const created = repo.saveLauncher({
        name: '我的 CLI',
        kind: 'cli',
        command: 'C:\\tools\\mycli.exe',
        args: ['--flag'],
        cwd: 'C:\\work'
      })
      expect(repo.listLaunchers()).toHaveLength(1)

      const edited = repo.saveLauncher({ ...created, name: '改过名字', enabled: false })
      expect(edited.name).toBe('改过名字')
      expect(edited.enabled).toBe(false)
      expect(edited.args).toEqual(['--flag'])

      repo.setLauncherEnabled(created.id, true)
      expect(repo.getLauncher(created.id)?.enabled).toBe(true)

      expect(repo.deleteLauncher(created.id)).toBe(true)
      expect(repo.listLaunchers()).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  it('项目可登记、编辑与删除，删除后会话回退到自动归组', () => {
    const { repo, cleanup } = createTestDb()
    try {
      const project = repo.saveProject({ name: '演示项目', rootPath: 'C:\\code\\demo' })
      const sessionId = seedSession(repo, {
        agentId: 'codex-cli',
        externalId: 's1',
        title: 't',
        body: 'b',
        createdAt: 1,
        autoProjectId: project.id
      })
      repo.setSessionProject(sessionId, project.id)
      expect(repo.getSession(sessionId)?.manualProjectId).toBe(project.id)

      repo.deleteProject(project.id)
      expect(repo.getSession(sessionId)?.manualProjectId).toBeNull()
      expect(repo.getSession(sessionId)?.autoProjectId).toBe(project.id)
    } finally {
      cleanup()
    }
  })
})

describe('数据模型：会话检索', () => {
  it('按 Agent 筛选', () => {
    const { repo, cleanup } = createTestDb()
    try {
      seedSession(repo, { agentId: 'codex-cli', externalId: 'a', title: 'A', body: 'x', createdAt: 1 })
      seedSession(repo, { agentId: 'minimax-cli', externalId: 'b', title: 'B', body: 'y', createdAt: 2 })
      expect(repo.listSessions({ agentId: 'codex-cli' }).items).toHaveLength(1)
      expect(repo.listSessions({ agentId: null }).items).toHaveLength(2)
    } finally {
      cleanup()
    }
  })

  it('按项目与未分组筛选', () => {
    const { repo, cleanup } = createTestDb()
    try {
      const project = repo.saveProject({ name: 'P', rootPath: 'C:\\code\\p' })
      seedSession(repo, {
        agentId: 'codex-cli',
        externalId: 'a',
        title: 'A',
        body: 'x',
        createdAt: 1,
        autoProjectId: project.id
      })
      seedSession(repo, { agentId: 'codex-cli', externalId: 'b', title: 'B', body: 'y', createdAt: 2 })
      expect(repo.listSessions({ projectId: project.id }).items).toHaveLength(1)
      expect(repo.listSessions({ projectId: UNGROUPED }).items).toHaveLength(1)
      expect(repo.listSessions({ projectId: null }).items).toHaveLength(2)
    } finally {
      cleanup()
    }
  })

  it('搜索命中标题与正文', () => {
    const { repo, cleanup } = createTestDb()
    try {
      seedSession(repo, {
        agentId: 'codex-cli',
        externalId: 'a',
        title: '修复登录问题',
        body: '正文包含 Elasticsearch 关键词',
        createdAt: 1
      })
      seedSession(repo, { agentId: 'codex-cli', externalId: 'b', title: '别的事', body: '无关内容', createdAt: 2 })
      expect(repo.listSessions({ search: '登录' }).items).toHaveLength(1)
      expect(repo.listSessions({ search: 'elasticsearch' }).items).toHaveLength(1)
      expect(repo.listSessions({ search: 'zzz' }).items).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  it('按创建时间 / 更新时间排序', () => {
    const { repo, cleanup } = createTestDb()
    try {
      seedSession(repo, {
        agentId: 'codex-cli',
        externalId: 'a',
        title: 'A',
        body: 'x',
        createdAt: 100,
        updatedAt: 900
      })
      seedSession(repo, {
        agentId: 'codex-cli',
        externalId: 'b',
        title: 'B',
        body: 'y',
        createdAt: 200,
        updatedAt: 200
      })
      const byCreatedDesc = repo.listSessions({ sortBy: 'createdAt', sortDir: 'desc' }).items
      expect(byCreatedDesc[0].title).toBe('B')
      const byUpdatedDesc = repo.listSessions({ sortBy: 'updatedAt', sortDir: 'desc' }).items
      expect(byUpdatedDesc[0].title).toBe('A')
      const byCreatedAsc = repo.listSessions({ sortBy: 'createdAt', sortDir: 'asc' }).items
      expect(byCreatedAsc[0].title).toBe('A')
    } finally {
      cleanup()
    }
  })

  it('手动归组在重新打开数据库后依然有效', () => {
    const { repo, db, dir, cleanup } = createTestDb()
    try {
      const project = repo.saveProject({ name: 'P', rootPath: 'C:\\code\\p' })
      const sessionId = seedSession(repo, {
        agentId: 'codex-cli',
        externalId: 'a',
        title: 'A',
        body: 'x',
        createdAt: 1,
        autoProjectId: null
      })
      repo.setSessionProject(sessionId, project.id)
      db.close()

      // 模拟重启：重新打开同一个数据库文件
      const reopened = new Db(`${dir}\\test.db`)
      const repo2 = new Repo(reopened)
      expect(repo2.getSession(sessionId)?.manualProjectId).toBe(project.id)
      expect(repo2.listSessions({ projectId: project.id }).items).toHaveLength(1)
      reopened.close()
    } finally {
      cleanup()
    }
  })

  it('项目统计按生效归属统计，手动覆盖优先且未分组单独计数', () => {
    const { repo, cleanup } = createTestDb()
    try {
      const p1 = repo.saveProject({ name: 'P1', rootPath: 'C:\\code\\p1' })
      const p2 = repo.saveProject({ name: 'P2', rootPath: 'C:\\code\\p2' })
      const inP1 = seedSession(repo, {
        agentId: 'codex-cli',
        externalId: 'a',
        title: 'A',
        body: 'x',
        createdAt: 1,
        autoProjectId: p1.id
      })
      const inP2 = seedSession(repo, {
        agentId: 'codex-cli',
        externalId: 'b',
        title: 'B',
        body: 'y',
        createdAt: 2,
        autoProjectId: p2.id
      })
      const orphan = seedSession(repo, {
        agentId: 'codex-cli',
        externalId: 'c',
        title: 'C',
        body: 'z',
        createdAt: 3,
        autoProjectId: null
      })

      let stats = repo.projectStats()
      expect(stats.byProject[p1.id]).toBe(1)
      expect(stats.byProject[p2.id]).toBe(1)
      expect(stats.ungrouped).toBe(1)

      // 手动覆盖优先：把 P1 的记录改到 P2，统计立即反映手动归属
      repo.setSessionProject(inP1, p2.id)
      stats = repo.projectStats()
      expect(stats.byProject[p1.id]).toBeUndefined()
      expect(stats.byProject[p2.id]).toBe(2)

      // 强制未分组（空字符串）计入未分组
      repo.setSessionProject(inP2, '')
      stats = repo.projectStats()
      expect(stats.byProject[p2.id]).toBe(1)
      expect(stats.ungrouped).toBe(2)

      // 清掉覆盖后回到自动归组
      repo.setSessionProject(orphan, null)
      expect(repo.projectStats().ungrouped).toBe(2)
    } finally {
      cleanup()
    }
  })
})

