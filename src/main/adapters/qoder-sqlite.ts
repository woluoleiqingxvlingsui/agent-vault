import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Db } from '../db/database'
import type { AgentAdapter, ParsedSession, SourceRef } from './types'
import { deriveTitle, statOrNull, toTimestamp } from './util'

interface QoderSessionRow {
  session_id: string
  session_kind: string | null
  product_mode: string | null
  title: string | null
  cwd: string | null
  model: string | null
  permission_mode: string | null
  extra_json: string | null
  created_at: number | null
  updated_at: number | null
  archived: number | null
  deleted_at: number | null
}

interface QoderMessageRow {
  session_id: string
  message_id: string
  payload_json: string | null
  created_at: number | null
}

/**
 * Qoder 桌面端 / Qoder CN 适配器。
 *
 * 真实探测来源：%APPDATA%\com.qoder.app.stable\main.sqlite 与
 * %APPDATA%\com.qodercn.app.stable\main.sqlite
 * 会话位于 chat_sessions / chat_session_messages 表，cwd 字段用于项目归组。
 *
 * 只读保证：SQLite 从不打开原始文件，只做字节级复制到临时目录，
 * 解析全部发生在临时副本上，原始文件不会被本应用写入。
 */

/** 快照失败时的重试次数（源端正在写入时可能拷到不一致的一对文件） */
const SNAPSHOT_MAX_ATTEMPTS = 3
export function createQoderSqliteAdapter(options: {
  id: string
  name: string
  vendor: string
  surface: 'cli' | 'desktop'
  launch: AgentAdapter['launch']
  defaultSourcePath: string
  sourceHint: string
}): AgentAdapter {
  return {
    id: options.id,
    name: options.name,
    vendor: options.vendor,
    surface: options.surface,
    launch: options.launch,
    defaultSourcePath: options.defaultSourcePath,
    sourceHint: options.sourceHint,
    recordSupport: 'sqlite',
    supportsWatch: true,
    async probe(root: string) {
      const stat = statOrNull(root)
      if (!stat) return { ok: false, reason: `来源不存在：${root}` }
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-qoder-probe-'))
      try {
        const db = await openSnapshot(root, tmpDir)
        try {
          const tables = new Set(
            db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name)
          )
          if (!tables.has('chat_sessions') || !tables.has('chat_session_messages')) {
            return { ok: false, reason: 'SQLite 中缺少 chat_sessions / chat_session_messages 表' }
          }
          const count = Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM chat_sessions')?.c ?? 0)
          return {
            ok: true,
            reason: `已验证 SQLite 会话库，chat_sessions 共 ${count} 行`,
            sampleCount: count
          }
        } finally {
          db.close()
        }
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
      }
    },
    async discover(root: string): Promise<SourceRef[]> {
      const stat = statOrNull(root)
      if (!stat) return []
      // WAL 模式下新数据先写进 -wal，主库文件 mtime 不会变；
      // 增量判断必须把附属文件的 mtime 一起算进来，否则新会话永远扫不到。
      const sidecar = ['-wal', '-shm']
        .map((suffix) => statOrNull(`${root}${suffix}`)?.mtimeMs ?? 0)
      const mtimeMs = Math.max(stat.mtimeMs, ...sidecar)
      return [{ path: root, file: root, mtimeMs, size: stat.size }]
    },
    async parse(ref: SourceRef): Promise<ParsedSession[]> {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-qoder-'))
      try {
        const db = await openSnapshot(ref.file, tmpDir)
        try {
          const sessionRows = db.all<QoderSessionRow>(
            `SELECT session_id, session_kind, product_mode, title, cwd, model, permission_mode,
                    extra_json, created_at, updated_at, archived, deleted_at
             FROM chat_sessions
             ORDER BY created_at ASC`
          )
          const messageRows = db.all<QoderMessageRow>(
            `SELECT session_id, message_id, payload_json, created_at
             FROM chat_session_messages
             ORDER BY session_id ASC, rowid ASC`
          )
          const bySession = new Map<string, QoderMessageRow[]>()
          for (const row of messageRows) {
            const list = bySession.get(row.session_id)
            if (list) list.push(row)
            else bySession.set(row.session_id, [row])
          }
          const sessions: ParsedSession[] = []
          for (const s of sessionRows) {
            if (s.deleted_at) continue
            const messages = (bySession.get(s.session_id) ?? [])
              .map((row) => toMessage(row))
              .filter((m): m is { role: string; content: string; createdAt: number | null } => m !== null)
              .filter((m) => m.content.trim().length > 0)
            let extra: Record<string, unknown> = {}
            try {
              extra = s.extra_json ? (JSON.parse(s.extra_json) as Record<string, unknown>) : {}
            } catch {
              extra = {}
            }
            sessions.push({
              externalId: s.session_id,
              title: s.title?.trim() || deriveTitle(messages),
              createdAt: toTimestamp(s.created_at),
              updatedAt: toTimestamp(s.updated_at),
              cwd: s.cwd || null,
              sourcePath: ref.path,
              rawMeta: {
                source: 'qoder-sqlite',
                db: ref.path,
                sessionKind: s.session_kind,
                productMode: s.product_mode,
                model: s.model,
                permissionMode: s.permission_mode,
                archived: s.archived === 1,
                extra
              },
              messages
            })
          }
          return mergeQoderSessions(sessions)
        } finally {
          db.close()
        }
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }
}

/** Qoder 一个 session_id 可能对应多条记录（例如 side chat），按 externalId 合并 */
function mergeQoderSessions(sessions: ParsedSession[]): ParsedSession[] {
  const map = new Map<string, ParsedSession>()
  for (const s of sessions) {
    const key = s.externalId ?? s.sourcePath
    const existing = map.get(key)
    if (!existing) {
      map.set(key, s)
      continue
    }
    existing.messages = existing.messages.concat(s.messages)
    if (!existing.title && s.title) existing.title = s.title
    if (!existing.cwd && s.cwd) existing.cwd = s.cwd
    if ((s.updatedAt ?? 0) > (existing.updatedAt ?? 0)) existing.updatedAt = s.updatedAt
  }
  for (const s of map.values()) {
    s.messages.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  }
  return [...map.values()]
}

function toMessage(row: QoderMessageRow): { role: string; content: string; createdAt: number | null } | null {
  if (!row.payload_json) return null
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(row.payload_json) as Record<string, unknown>
  } catch {
    return null
  }
  const role = typeof payload.role === 'string' ? payload.role : 'unknown'
  let content = typeof payload.text === 'string' ? payload.text : ''
  if (!content && Array.isArray(payload.parts)) {
    content = payload.parts
      .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n\n')
  }
  const createdAt = toTimestamp(payload.timestamp) ?? toTimestamp(row.created_at)
  return { role, content, createdAt }
}

/**
 * 复制 SQLite 主文件与 WAL 附属文件。
 *
 * 只复制主库与 -wal：-shm 是索引文件，交给 SQLite 在副本上重建，
 * 复制旧 shm 反而可能带来不一致的快照。
 */
async function copySqliteBundle(src: string, dest: string): Promise<void> {
  await fs.copyFile(src, dest)
  try {
    await fs.copyFile(`${src}-wal`, `${dest}-wal`)
  } catch {
    /* 没有 WAL 附属文件时忽略 */
  }
}

/**
 * 打开来源库的一个一致快照。
 *
 * - 原始文件从不被 SQLite 打开，只做字节级复制，读取行为完全只读；
 * - 副本以可写方式打开，SQLite 可以在副本上重放 WAL，保证读到最新数据；
 * - 源端正在写入时可能拷到撕裂的快照，用完整性检查 + 重试兜住。
 */
async function openSnapshot(src: string, tmpDir: string): Promise<Db> {
  const dest = path.join(tmpDir, path.basename(src))
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= SNAPSHOT_MAX_ATTEMPTS; attempt += 1) {
    try {
      await copySqliteBundle(src, dest)
      const db = new Db(dest)
      const check = db.get<{ quick_check: string }>('PRAGMA quick_check')
      const verdict = check?.quick_check ?? 'ok'
      if (verdict !== 'ok') {
        db.close()
        throw new Error(`快照完整性检查未通过：${verdict}`)
      }
      return db
    } catch (err) {
      lastError = err as Error
      await fs.rm(dest, { force: true }).catch(() => undefined)
      await fs.rm(`${dest}-wal`, { force: true }).catch(() => undefined)
    }
  }
  throw new Error(`无法取得来源库的可用快照：${lastError?.message ?? '未知原因'}`)
}
