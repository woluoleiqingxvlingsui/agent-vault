import { randomUUID } from 'node:crypto'
import type { Db } from './database'
import type {
  ConversationMessage,
  ConversationSession,
  Launcher,
  LauncherKind,
  Project,
  SessionQuery,
  SortDir,
  SortField
} from '../../shared/types'
import { UNGROUPED } from '../../shared/types'
import { resolveAutoProjectId } from '../domain/grouping'

const EFFECTIVE_PROJECT = `CASE WHEN manual_project_id IS NOT NULL THEN manual_project_id ELSE auto_project_id END`

interface LauncherRow {
  id: string
  name: string
  kind: LauncherKind
  command: string
  protocol: 'exec' | 'appsfolder'
  args: string
  cwd: string
  project_id: string | null
  icon: string
  enabled: number
  last_launched_at: number | null
  created_at: number
  updated_at: number
}

interface ProjectRow {
  id: string
  name: string
  root_path: string
  launcher_id: string | null
  created_at: number
  updated_at: number
}

interface SessionRow {
  id: string
  agent_id: string
  external_id: string | null
  title: string
  created_at: number | null
  updated_at: number | null
  message_count: number
  source_path: string
  source_cwd: string | null
  raw_meta: string
  fingerprint: string
  auto_project_id: string | null
  manual_project_id: string | null
  content_hash: string
  source_mtime: number
}

export interface UpsertSessionInput {
  agentId: string
  externalId: string | null
  fingerprint: string
  title: string
  createdAt: number | null
  updatedAt: number | null
  sourcePath: string
  sourceCwd: string | null
  rawMeta: Record<string, unknown>
  contentHash: string
  autoProjectId: string | null
  sourceMtime: number
  messages: Array<{ role: string; content: string; createdAt: number | null }>
}

export type UpsertStatus = 'inserted' | 'updated' | 'skipped'

export class Repo {
  constructor(private readonly db: Db) {}

  // ---------------------------------------------------------------- launchers

  listLaunchers(): Launcher[] {
    const rows = this.db.all<LauncherRow>('SELECT * FROM launchers ORDER BY name COLLATE NOCASE')
    return rows.map(mapLauncher)
  }

  getLauncher(id: string): Launcher | null {
    const row = this.db.get<LauncherRow>('SELECT * FROM launchers WHERE id = ?', [id])
    return row ? mapLauncher(row) : null
  }

  saveLauncher(
    input: Partial<Launcher> & { name: string; kind: LauncherKind; command: string }
  ): Launcher {
    const now = Date.now()
    const id = input.id || randomUUID()
    const existing = this.getLauncher(id)
    const launcher: Launcher = {
      id,
      name: input.name,
      kind: input.kind,
      command: input.command,
      protocol: input.protocol ?? existing?.protocol ?? 'exec',
      args: input.args ?? existing?.args ?? [],
      cwd: input.cwd ?? existing?.cwd ?? '',
      projectId: input.projectId ?? existing?.projectId ?? null,
      icon: input.icon ?? existing?.icon ?? '',
      enabled: input.enabled ?? existing?.enabled ?? true,
      lastLaunchedAt: existing?.lastLaunchedAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    this.db.run(
      `INSERT INTO launchers (id, name, kind, command, protocol, args, cwd, project_id, icon, enabled, last_launched_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, kind = excluded.kind, command = excluded.command,
         protocol = excluded.protocol, args = excluded.args,
         cwd = excluded.cwd, project_id = excluded.project_id, icon = excluded.icon,
         enabled = excluded.enabled, updated_at = excluded.updated_at`,
      [
        launcher.id,
        launcher.name,
        launcher.kind,
        launcher.command,
        launcher.protocol,
        JSON.stringify(launcher.args),
        launcher.cwd,
        launcher.projectId,
        launcher.icon,
        launcher.enabled ? 1 : 0,
        launcher.lastLaunchedAt,
        launcher.createdAt,
        launcher.updatedAt
      ]
    )
    return launcher
  }

  deleteLauncher(id: string): boolean {
    const before = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM launchers WHERE id = ?', [id])
    this.db.run('DELETE FROM launchers WHERE id = ?', [id])
    this.db.run('UPDATE projects SET launcher_id = NULL WHERE launcher_id = ?', [id])
    return (before?.c ?? 0) > 0
  }

  setLauncherEnabled(id: string, enabled: boolean): void {
    this.db.run('UPDATE launchers SET enabled = ?, updated_at = ? WHERE id = ?', [
      enabled ? 1 : 0,
      Date.now(),
      id
    ])
  }

  markLauncherLaunched(id: string, at: number): void {
    this.db.run('UPDATE launchers SET last_launched_at = ?, updated_at = ? WHERE id = ?', [at, at, id])
  }

  // ----------------------------------------------------------------- projects

  listProjects(): Project[] {
    const rows = this.db.all<ProjectRow>('SELECT * FROM projects ORDER BY name COLLATE NOCASE')
    return rows.map(mapProject)
  }

  getProject(id: string): Project | null {
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id])
    return row ? mapProject(row) : null
  }

  saveProject(input: Partial<Project> & { name: string; rootPath: string }): Project {
    const now = Date.now()
    const id = input.id || randomUUID()
    const existing = this.getProject(id)
    const project: Project = {
      id,
      name: input.name,
      rootPath: input.rootPath,
      launcherId: input.launcherId ?? existing?.launcherId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    this.db.run(
      `INSERT INTO projects (id, name, root_path, launcher_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, root_path = excluded.root_path,
         launcher_id = excluded.launcher_id, updated_at = excluded.updated_at`,
      [project.id, project.name, project.rootPath, project.launcherId, project.createdAt, project.updatedAt]
    )
    return project
  }

  deleteProject(id: string): boolean {
    const before = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM projects WHERE id = ?', [id])
    this.db.run('DELETE FROM projects WHERE id = ?', [id])
    // 手动归组指向该项目的记录回退到自动归组
    this.db.run('UPDATE sessions SET manual_project_id = NULL WHERE manual_project_id = ?', [id])
    return (before?.c ?? 0) > 0
  }

  // ----------------------------------------------------------------- sessions

  countSessions(agentId?: string | null): number {
    if (agentId) {
      const row = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM sessions WHERE agent_id = ?', [
        agentId
      ])
      return row?.c ?? 0
    }
    const row = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM sessions')
    return row?.c ?? 0
  }

  /**
   * 写入（去重）一条会话。相同 fingerprint 不会产生副本：
   * 内容指纹一致 => skipped；不一致 => updated（并保留手动项目覆盖）。
   */
  upsertSession(input: UpsertSessionInput): { status: UpsertStatus; id: string } {
    const existing = this.db.get<SessionRow>(
      'SELECT * FROM sessions WHERE fingerprint = ?',
      [input.fingerprint]
    )
    const searchBlob = buildSearchBlob(input.title, input.messages)
    if (!existing) {
      const id = randomUUID()
      this.db.transaction(() => {
        this.db.run(
          `INSERT INTO sessions (id, agent_id, external_id, title, created_at, updated_at, message_count,
             source_path, source_cwd, raw_meta, fingerprint, auto_project_id, manual_project_id,
             content_hash, source_mtime, search_blob)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
          [
            id,
            input.agentId,
            input.externalId,
            input.title,
            input.createdAt,
            input.updatedAt,
            input.messages.length,
            input.sourcePath,
            input.sourceCwd,
            JSON.stringify(input.rawMeta),
            input.fingerprint,
            input.autoProjectId,
            input.contentHash,
            input.sourceMtime,
            searchBlob
          ]
        )
        this.insertMessages(id, input.messages)
      })
      return { status: 'inserted', id }
    }

    if (existing.content_hash === input.contentHash) {
      this.db.run('UPDATE sessions SET source_mtime = ? WHERE id = ?', [input.sourceMtime, existing.id])
      return { status: 'skipped', id: existing.id }
    }

    this.db.transaction(() => {
      this.db.run(
        `UPDATE sessions SET title = ?, created_at = ?, updated_at = ?, message_count = ?,
           source_path = ?, source_cwd = ?, raw_meta = ?, auto_project_id = ?,
           content_hash = ?, source_mtime = ?, search_blob = ?
         WHERE id = ?`,
        [
          input.title,
          input.createdAt,
          input.updatedAt,
          input.messages.length,
          input.sourcePath,
          input.sourceCwd,
          JSON.stringify(input.rawMeta),
          input.autoProjectId,
          input.contentHash,
          input.sourceMtime,
          searchBlob,
          existing.id
        ]
      )
      this.db.run('DELETE FROM messages WHERE session_id = ?', [existing.id])
      this.insertMessages(existing.id, input.messages)
    })
    return { status: 'updated', id: existing.id }
  }

  private insertMessages(
    sessionId: string,
    messages: Array<{ role: string; content: string; createdAt: number | null }>
  ): void {
    messages.forEach((m, index) => {
      this.db.run(
        'INSERT INTO messages (id, session_id, seq, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), sessionId, index, m.role, m.content, m.createdAt]
      )
    })
  }

  listSessions(query: SessionQuery): { total: number; items: ConversationSession[] } {
    const where: string[] = []
    const params: unknown[] = []

    if (query.agentId) {
      where.push('agent_id = ?')
      params.push(query.agentId)
    }
    if (query.projectId === UNGROUPED) {
      where.push(`(${EFFECTIVE_PROJECT} IS NULL OR ${EFFECTIVE_PROJECT} = '')`)
    } else if (query.projectId) {
      where.push(`${EFFECTIVE_PROJECT} = ?`)
      params.push(query.projectId)
    }
    if (query.search && query.search.trim()) {
      where.push(`search_blob LIKE ? ESCAPE '\\'`)
      params.push(`%${escapeLike(query.search.trim().toLowerCase())}%`)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const totalRow = this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM sessions ${whereSql}`, params)
    const total = totalRow?.c ?? 0

    const sortField: SortField = query.sortBy === 'updatedAt' ? 'updatedAt' : 'createdAt'
    const sortColumn = sortField === 'updatedAt' ? 'updated_at' : 'created_at'
    const dir: 'ASC' | 'DESC' = query.sortDir === 'asc' ? 'ASC' : 'DESC'
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 2000)
    const offset = Math.max(query.offset ?? 0, 0)

    const rows = this.db.all<SessionRow>(
      `SELECT * FROM sessions ${whereSql}
       ORDER BY COALESCE(${sortColumn}, 0) ${dir}, id ${dir}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    return { total, items: rows.map((row) => mapSession(row)) }
  }

  getSession(id: string): ConversationSession | null {
    const row = this.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id])
    return row ? mapSession(row) : null
  }

  /** 按来源路径查询已导入会话（增量扫描时判断来源是否变化） */
  listSessionsBySource(sourcePath: string): Array<{ id: string; source_mtime: number }> {
    return this.db.all<{ id: string; source_mtime: number }>(
      'SELECT id, source_mtime FROM sessions WHERE source_path = ?',
      [sourcePath]
    )
  }

  getSessionMessages(id: string): ConversationMessage[] {
    const rows = this.db.all<{
      id: string
      session_id: string
      seq: number
      role: string
      content: string
      created_at: number | null
    }>('SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC', [id])
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      seq: r.seq,
      role: r.role,
      content: r.content,
      createdAt: r.created_at
    }))
  }

  /**
   * 手动调整项目归属。
   * projectId 为 null => 清除覆盖（回退自动归组）
   * projectId 为 '' => 强制归入“未分组”
   */
  setSessionProject(sessionId: string, projectId: string | null): void {
    this.db.run('UPDATE sessions SET manual_project_id = ? WHERE id = ?', [
      projectId === null ? null : projectId,
      sessionId
    ])
  }

  /**
   * 重新计算全部会话的自动归组。
   * 已有手动覆盖的会话不会被改动（手动归属优先且必须保持）。
   * 返回被重新归组的会话数量。
   */
  regroupAll(): number {
    const projects = this.listProjects().map((p) => ({ id: p.id, rootPath: p.rootPath }))
    const rows = this.db.all<{
      id: string
      source_cwd: string | null
      source_path: string
      auto_project_id: string | null
    }>('SELECT id, source_cwd, source_path, auto_project_id FROM sessions')
    let changed = 0
    this.db.transaction(() => {
      for (const row of rows) {
        const next = resolveAutoProjectId(
          [row.source_cwd, row.source_path],
          projects
        )
        if (next === row.auto_project_id) continue
        this.db.run('UPDATE sessions SET auto_project_id = ? WHERE id = ?', [next, row.id])
        changed += 1
      }
    })
    return changed
  }

  /** 统计每个 Agent 的会话数量 */
  countByAgent(): Record<string, number> {
    const rows = this.db.all<{ agent_id: string; c: number }>(
      'SELECT agent_id, COUNT(*) AS c FROM sessions GROUP BY agent_id'
    )
    return Object.fromEntries(rows.map((r) => [r.agent_id, r.c]))
  }

  /**
   * 统计每个项目的会话数量（按生效归属计算）以及未分组数量，
   * 供界面展示项目计数，避免渲染进程遍历全部会话。
   */
  projectStats(): { byProject: Record<string, number>; ungrouped: number } {
    const rows = this.db.all<{ pid: string | null; c: number }>(
      `SELECT ${EFFECTIVE_PROJECT} AS pid, COUNT(*) AS c FROM sessions GROUP BY ${EFFECTIVE_PROJECT}`
    )
    const byProject: Record<string, number> = {}
    let ungrouped = 0
    for (const row of rows) {
      if (!row.pid || row.pid === '') ungrouped += row.c
      else byProject[row.pid] = (byProject[row.pid] ?? 0) + row.c
    }
    return { byProject, ungrouped }
  }

  // ----------------------------------------------------------------- sources

  /** 记录每个来源文件上次扫描时的 mtime（增量判断依据，按 Agent 分开记） */
  getSourceMtime(agentId: string, sourcePath: string): number | null {
    const row = this.db.get<{ mtime: number | null }>(
      'SELECT mtime FROM source_state WHERE agent_id = ? AND source_path = ?',
      [agentId, sourcePath]
    )
    return row?.mtime ?? null
  }

  setSourceMtime(agentId: string, sourcePath: string, mtime: number): void {
    this.db.run(
      `INSERT INTO source_state (agent_id, source_path, mtime, scanned_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(agent_id, source_path) DO UPDATE SET mtime = excluded.mtime, scanned_at = excluded.scanned_at`,
      [agentId, sourcePath, mtime, Date.now()]
    )
  }

  /**
   * 清理源端已删除的会话。
   *
   * 只动本 Agent 写入、且外部会话 id 已经不在源端集合里的记录；
   * 外部 id 为空的记录（例如手工导入的会话）一律保留。
   */
  deleteSessionsMissingFromSource(
    agentId: string,
    sourcePath: string,
    keepExternalIds: string[]
  ): number {
    const rows = this.db.all<{ id: string; external_id: string | null }>(
      'SELECT id, external_id FROM sessions WHERE agent_id = ? AND source_path = ?',
      [agentId, sourcePath]
    )
    const keep = new Set(keepExternalIds)
    const stale = rows.filter((r) => r.external_id && !keep.has(r.external_id)).map((r) => r.id)
    if (!stale.length) return 0
    this.db.transaction(() => {
      for (const id of stale) {
        this.db.run('DELETE FROM messages WHERE session_id = ?', [id])
        this.db.run('DELETE FROM sessions WHERE id = ?', [id])
      }
    })
    return stale.length
  }

  // ----------------------------------------------------------------- settings

  getSetting(key: string): string | null {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
    return row ? row.value : null
  }

  setSetting(key: string, value: string): void {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    )
  }

  // --------------------------------------------------------------- scan state

  getScanState(agentId: string): { lastScanAt: number | null; lastError: string | null; scanned: number } {
    const row = this.db.get<{
      last_scan_at: number | null
      last_error: string | null
      scanned_count: number
    }>('SELECT * FROM scan_state WHERE agent_id = ?', [agentId])
    return {
      lastScanAt: row?.last_scan_at ?? null,
      lastError: row?.last_error ?? null,
      scanned: row?.scanned_count ?? 0
    }
  }

  setScanState(agentId: string, lastScanAt: number | null, lastError: string | null, scanned: number): void {
    this.db.run(
      `INSERT INTO scan_state (agent_id, last_scan_at, last_error, scanned_count) VALUES (?, ?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET last_scan_at = excluded.last_scan_at,
         last_error = excluded.last_error, scanned_count = excluded.scanned_count`,
      [agentId, lastScanAt, lastError, scanned]
    )
  }
}

function buildSearchBlob(title: string, messages: Array<{ role: string; content: string }>): string {
  const parts = [title || '']
  for (const m of messages) parts.push(m.content || '')
  return parts.join('\n').toLowerCase()
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function mapLauncher(row: LauncherRow): Launcher {
  let args: string[] = []
  try {
    const parsed = JSON.parse(row.args || '[]')
    if (Array.isArray(parsed)) args = parsed.map((v) => String(v))
  } catch {
    args = []
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    command: row.command,
    protocol: row.protocol === 'appsfolder' ? 'appsfolder' : 'exec',
    args,
    cwd: row.cwd,
    projectId: row.project_id,
    icon: row.icon,
    enabled: row.enabled !== 0,
    lastLaunchedAt: row.last_launched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    launcherId: row.launcher_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapSession(row: SessionRow): ConversationSession {
  let rawMeta: Record<string, unknown> = {}
  try {
    rawMeta = JSON.parse(row.raw_meta || '{}')
  } catch {
    rawMeta = {}
  }
  return {
    id: row.id,
    agentId: row.agent_id,
    externalId: row.external_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    sourcePath: row.source_path,
    sourceCwd: row.source_cwd,
    autoProjectId: row.auto_project_id,
    manualProjectId: row.manual_project_id,
    effectiveProjectId:
      row.manual_project_id !== null
        ? row.manual_project_id === ''
          ? null
          : row.manual_project_id
        : row.auto_project_id,
    fingerprint: row.fingerprint,
    rawMeta
  }
}
