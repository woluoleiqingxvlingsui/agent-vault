import { describe, expect, it } from 'vitest'
import { computeContentHash, computeFingerprint, identityKey } from '../src/main/domain/dedup'
import { createTestDb } from './helpers'

describe('去重指纹', () => {
  it('外部会话 id 优先于来源路径，且同一来源指纹稳定', () => {
    const a = computeFingerprint({
      agentId: 'codex-cli',
      externalId: 'sess-1',
      sourcePath: 'C:\\a\\b.jsonl'
    })
    const b = computeFingerprint({
      agentId: 'codex-cli',
      externalId: 'sess-1',
      sourcePath: 'C:\\different\\path.jsonl'
    })
    expect(a).toBe(b)
    expect(identityKey({ agentId: 'x', externalId: 'sess-1', sourcePath: 'p' })).toBe('ext:sess-1')
  })

  it('没有外部 id 时回退到来源路径', () => {
    const key = identityKey({ agentId: 'x', externalId: null, sourcePath: 'C:\\a\\b.jsonl' })
    expect(key).toBe('src:c:\\a\\b.jsonl')
  })

  it('不同 Agent 的相同来源不产生相同指纹', () => {
    const a = computeFingerprint({ agentId: 'codex-cli', sourcePath: 'p' })
    const b = computeFingerprint({ agentId: 'codex-desktop', sourcePath: 'p' })
    expect(a).not.toBe(b)
  })

  it('内容指纹随正文变化', () => {
    const h1 = computeContentHash('t', [{ role: 'user', content: 'a' }])
    const h2 = computeContentHash('t', [{ role: 'user', content: 'b' }])
    expect(h1).not.toBe(h2)
  })
})

describe('重复导入不产生副本', () => {
  it('相同 fingerprint 第二次写入只会更新或跳过', () => {
    const { repo, cleanup } = createTestDb()
    try {
      const input = {
        agentId: 'codex-cli',
        externalId: 'sess-1',
        fingerprint: computeFingerprint({ agentId: 'codex-cli', externalId: 'sess-1' }),
        title: '会话一',
        createdAt: 1000,
        updatedAt: 1000,
        sourcePath: 'C:\\x\\sess-1.jsonl',
        sourceCwd: 'C:\\x',
        rawMeta: {},
        contentHash: computeContentHash('会话一', [{ role: 'user', content: 'hi' }]),
        autoProjectId: null,
        sourceMtime: 1,
        messages: [{ role: 'user', content: 'hi', createdAt: 1000 }]
      }
      const first = repo.upsertSession(input)
      expect(first.status).toBe('inserted')
      expect(repo.countSessions()).toBe(1)

      const second = repo.upsertSession(input)
      expect(second.status).toBe('skipped')
      expect(repo.countSessions()).toBe(1)

      const changed = repo.upsertSession({
        ...input,
        title: '会话一（已更新）',
        contentHash: computeContentHash('会话一（已更新）', [{ role: 'user', content: 'hi again' }]),
        messages: [{ role: 'user', content: 'hi again', createdAt: 1000 }]
      })
      expect(changed.status).toBe('updated')
      expect(repo.countSessions()).toBe(1)
      expect(repo.getSession(first.id)?.title).toBe('会话一（已更新）')
      expect(repo.getSessionMessages(first.id)).toHaveLength(1)
    } finally {
      cleanup()
    }
  })
})
