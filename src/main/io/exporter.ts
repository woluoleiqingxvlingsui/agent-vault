import type { Repo } from '../db/repo'
import type { ConversationSession } from '../../shared/types'

export const EXPORT_FORMAT_VERSION = 1

export interface ExportSession {
  id: string
  agentId: string
  externalId: string | null
  title: string
  createdAt: number | null
  updatedAt: number | null
  messageCount: number
  sourcePath: string
  sourceCwd: string | null
  autoProjectId: string | null
  manualProjectId: string | null
  rawMeta: Record<string, unknown>
  messages: Array<{ role: string; content: string; createdAt: number | null }>
}

export interface ExportBundle {
  version: number
  exportedAt: number
  /** 本次导出覆盖的会话总数（用于提示是否被截断） */
  total: number
  projects: Array<{ id: string; name: string; rootPath: string }>
  sessions: ExportSession[]
}

/** 分页拉取全部会话，避免超过单页上限时被静默截断 */
const EXPORT_PAGE_SIZE = 500

export function buildExportBundle(repo: Repo, options: { agentId?: string | null } = {}): ExportBundle {
  const projects = repo.listProjects()
  const sessions: ExportSession[] = []
  let total = 0
  let offset = 0
  for (;;) {
    const page = repo.listSessions({
      agentId: options.agentId ?? null,
      limit: EXPORT_PAGE_SIZE,
      offset,
      sortBy: 'updatedAt',
      sortDir: 'desc'
    })
    total = page.total
    for (const session of page.items) {
      const messages = repo.getSessionMessages(session.id)
      sessions.push({
        id: session.id,
        agentId: session.agentId,
        externalId: session.externalId,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
        sourcePath: session.sourcePath,
        sourceCwd: session.sourceCwd,
        autoProjectId: session.autoProjectId,
        manualProjectId: session.manualProjectId,
        rawMeta: session.rawMeta,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt
        }))
      })
    }
    offset += page.items.length
    if (page.items.length < EXPORT_PAGE_SIZE || sessions.length >= total) break
  }
  return {
    version: EXPORT_FORMAT_VERSION,
    exportedAt: Date.now(),
    total,
    projects: projects.map((p) => ({ id: p.id, name: p.name, rootPath: p.rootPath })),
    sessions
  }
}

export function exportToJson(bundle: ExportBundle): string {
  return JSON.stringify(bundle, null, 2)
}

function isoOrEmpty(ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** 元数据值必须压成单行，否则会破坏 Markdown 结构 */
function oneLine(value: string): string {
  return (value ?? '').replace(/\r?\n/g, ' ').trim()
}

/**
 * 正文转义。
 *
 * 行首的 `#` 会被当成角色分节（`## user`），整行 `---` 会被当成会话分隔符，
 * 行首 `\` 是转义前缀本身——这三类都要加反斜杠前缀，导入时还原。
 */
export function escapeMarkdownBody(content: string): string {
  return (content ?? '')
    .split('\n')
    .map((line) => {
      if (line.startsWith('#') || line.startsWith('\\')) return `\\${line}`
      if (line.trim() === '---') return `\\${line}`
      return line
    })
    .join('\n')
}

/** 正文反转义（与 escapeMarkdownBody 对称） */
export function unescapeMarkdownBody(content: string): string {
  return (content ?? '')
    .split('\n')
    .map((line) => (line.startsWith('\\') ? line.slice(1) : line))
    .join('\n')
}

/** 导出为 Markdown（人类可读；导入时按同样格式解析） */
export function exportToMarkdown(bundle: ExportBundle): string {
  const projectById = new Map(bundle.projects.map((p) => [p.id, p]))
  const blocks: string[] = []
  for (const session of bundle.sessions) {
    const effectiveProjectId = session.manualProjectId ?? session.autoProjectId
    const project = effectiveProjectId ? projectById.get(effectiveProjectId) : undefined
    const lines: string[] = []
    lines.push(`# ${oneLine(session.title) || '(无标题)'}`)
    lines.push('')
    lines.push(`- agent: ${oneLine(session.agentId)}`)
    lines.push(`- project: ${project ? oneLine(project.name) : '未分组'}`)
    lines.push(`- project-path: ${project ? oneLine(project.rootPath) : ''}`)
    lines.push(`- source: ${oneLine(session.sourcePath)}`)
    lines.push(`- source-cwd: ${oneLine(session.sourceCwd ?? '')}`)
    lines.push(`- external-id: ${session.externalId ?? ''}`)
    lines.push(`- created: ${isoOrEmpty(session.createdAt)}`)
    lines.push(`- updated: ${isoOrEmpty(session.updatedAt)}`)
    lines.push('')
    for (const message of session.messages) {
      lines.push(`## ${oneLine(message.role) || 'assistant'}`)
      lines.push('')
      lines.push(escapeMarkdownBody(message.content ?? ''))
      lines.push('')
    }
    blocks.push(lines.join('\n'))
  }
  return `${blocks.join('\n---\n\n')}\n`
}
