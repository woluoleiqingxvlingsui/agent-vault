import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createQoderSqliteAdapter } from '../src/main/adapters/qoder-sqlite'
import { createCodexAdapter } from '../src/main/adapters/codex'
import { createPiCliAdapter } from '../src/main/adapters/minimax-cli'
import { createMiniMaxDesktopAdapter } from '../src/main/adapters/minimax-desktop'
import { Db } from '../src/main/db/database'
import { fixture } from './helpers'

const LAUNCH = {
  protocol: 'exec' as const,
  command: 'test.exe',
  args: [],
  cwd: 'C:\\',
  note: 'test'
}

describe('适配器：Codex（.jsonl.zst）', () => {
  it('解析出会话、消息与 cwd，并按 originator 区分桌面端 / CLI', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-codex-'))
    try {
      const plain = await fs.readFile(fixture('codex/rollout-sample.jsonl'), 'utf8')
      const compressed = zlib.zstdCompressSync(Buffer.from(plain, 'utf8'))
      const file = path.join(dir, 'rollout-sample.jsonl.zst')
      await fs.writeFile(file, compressed)

      const desktop = createCodexAdapter({
        id: 'codex-desktop',
        name: 'Codex 桌面端',
        surface: 'desktop',
        launch: LAUNCH,
        defaultSourcePath: dir,
        sourceHint: 'fixture',
        matchOriginator: (o) => o === 'Codex Desktop',
        originatorLabel: 'Codex 桌面端'
      })
      const cli = createCodexAdapter({
        id: 'codex-cli',
        name: 'Codex CLI',
        surface: 'cli',
        launch: LAUNCH,
        defaultSourcePath: dir,
        sourceHint: 'fixture',
        matchOriginator: (o) => o !== 'Codex Desktop',
        originatorLabel: 'Codex CLI'
      })

      const refs = await desktop.discover(dir)
      expect(refs).toHaveLength(1)

      const sessions = await desktop.parse(refs[0])
      expect(sessions).toHaveLength(1)
      const session = sessions[0]
      expect(session.externalId).toBe('019f7a23-0000-7000-b6b4-c13decba45cc')
      expect(session.cwd).toBe('C:\\Users\\tester\\code\\demo-app')
      expect(session.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
      expect(session.messages[0].content).toContain('README')
      expect(session.title).toContain('README')
      expect(session.rawMeta.originator).toBe('Codex Desktop')

      // originator 不匹配时不返回会话
      expect(await cli.parse(refs[0])).toHaveLength(0)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('适配器：MiniMax CLI（pi jsonl）', () => {
  it('解析出 session 元信息与消息', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-pi-'))
    try {
      const target = path.join(dir, '--C--Users-tester-code-demo')
      await fs.mkdir(target, { recursive: true })
      await fs.copyFile(
        fixture('pi/session-sample.jsonl'),
        path.join(target, '2026-07-30T02-12-37-734Z_019fb0cb.jsonl')
      )
      const adapter = createPiCliAdapter({
        id: 'minimax-cli',
        name: 'MiniMax CLI',
        launch: LAUNCH,
        defaultSourcePath: dir,
        sourceHint: 'fixture'
      })
      const refs = await adapter.discover(dir)
      expect(refs).toHaveLength(1)
      const sessions = await adapter.parse(refs[0])
      expect(sessions).toHaveLength(1)
      expect(sessions[0].externalId).toBe('019fb0cb-8ce6-7fd8-9367-119bb5ecf179')
      expect(sessions[0].cwd).toBe('C:\\Users\\tester\\code\\demo-app')
      expect(sessions[0].messages).toHaveLength(3)
      expect(sessions[0].messages[1].content).toContain('快速排序')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('适配器：MiniMax 桌面端', () => {
  it('合并 manifest 元信息并只保留正文类内容块', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-mm-'))
    try {
      const sessionDir = path.join(dir, '2026', '11', '01', '12-02-35-695-session_x')
      await fs.mkdir(sessionDir, { recursive: true })
      await fs.copyFile(fixture('minimax/messages-sample.jsonl'), path.join(sessionDir, 'messages.jsonl'))
      await fs.copyFile(fixture('minimax/manifest-sample.json'), path.join(sessionDir, 'manifest.json'))

      const adapter = createMiniMaxDesktopAdapter({
        id: 'minimax-desktop',
        name: 'MiniMax 桌面端',
        launch: LAUNCH,
        defaultSourcePath: dir,
        sourceHint: 'fixture'
      })
      const refs = await adapter.discover(dir)
      expect(refs).toHaveLength(1)
      const sessions = await adapter.parse(refs[0])
      expect(sessions).toHaveLength(1)
      expect(sessions[0].externalId).toBe('mvs_b49483054c7343ffb3f9830ad93d188c')
      expect(sessions[0].createdAt).toBe(1793534555695)
      expect(sessions[0].messages).toHaveLength(2)
      expect(sessions[0].messages[0].content).toContain('示例项目')
      expect(sessions[0].messages[1].content).not.toContain('这段思考')
      expect((sessions[0].rawMeta.toolCallCount as number)).toBe(1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('适配器：Qoder SQLite', () => {
  it('解析 chat_sessions / chat_session_messages，且不修改原始库', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-qoder-'))
    try {
      const dbFile = path.join(dir, 'main.sqlite')
      const db = new Db(dbFile)
      db.exec(`
        CREATE TABLE chat_sessions (
          session_id TEXT PRIMARY KEY, session_kind TEXT, product_mode TEXT, title TEXT,
          cwd TEXT, model TEXT, permission_mode TEXT, extra_json TEXT,
          created_at INTEGER, updated_at INTEGER, archived INTEGER, deleted_at INTEGER
        );
        CREATE TABLE chat_session_messages (
          session_id TEXT, message_id TEXT, payload_json TEXT, created_at INTEGER
        );
      `)
      db.run(
        'INSERT INTO chat_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          'sess-1',
          'standard',
          'coding',
          '优化启动脚本',
          'C:\\Users\\tester\\code\\demo',
          'qfmodel',
          'auto',
          '{}',
          1787835050540,
          1787835050999,
          0,
          null
        ]
      )
      db.run('INSERT INTO chat_session_messages VALUES (?,?,?,?)', [
        'sess-1',
        'm1',
        JSON.stringify({ role: 'user', text: '优化一下启动脚本', timestamp: '2026-08-27T12:50:50.540Z' }),
        1787835050540
      ])
      db.run('INSERT INTO chat_session_messages VALUES (?,?,?,?)', [
        'sess-1',
        'm2',
        JSON.stringify({ role: 'assistant', text: '已优化启动脚本的启动速度。' }),
        1787835050999
      ])
      db.close()

      const before = await fs.stat(dbFile)
      const adapter = createQoderSqliteAdapter({
        id: 'qoder-cn',
        name: 'Qoder CN',
        vendor: 'Qoder',
        surface: 'desktop',
        launch: LAUNCH,
        defaultSourcePath: dbFile,
        sourceHint: 'fixture'
      })
      const refs = await adapter.discover(dbFile)
      const sessions = await adapter.parse(refs[0])
      expect(sessions).toHaveLength(1)
      expect(sessions[0].externalId).toBe('sess-1')
      expect(sessions[0].title).toBe('优化启动脚本')
      expect(sessions[0].cwd).toBe('C:\\Users\\tester\\code\\demo')
      expect(sessions[0].messages).toHaveLength(2)
      expect(sessions[0].messages[1].role).toBe('assistant')

      // 原始库未被写入（大小与 mtime 不变）
      const after = await fs.stat(dbFile)
      expect(after.size).toBe(before.size)
      expect(after.mtimeMs).toBe(before.mtimeMs)

      // probe 也能验证来源
      const probe = await adapter.probe?.(dbFile)
      expect(probe?.ok).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
