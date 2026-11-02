import type { Repo } from '../db/repo'
import { computeContentHash, computeFingerprint } from '../domain/dedup'
import { resolveAutoProjectId } from '../domain/grouping'
import type { ImportResult } from '../../shared/types'
import {
  EXPORT_FORMAT_VERSION,
  unescapeMarkdownBody,
  type ExportBundle,
  type ExportSession
} from './exporter'

export interface ImportOptions {
  /** 导入时强制归属到的 Agent（Markdown 导入可指定） */
  agentId?: string
}

function isBundle(value: unknown): value is ExportBundle {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<ExportBundle>
  return typeof v.version === 'number' && Array.isArray(v.sessions)
}

/** 解析 JSON 导入文件 */
export function parseJsonImport(text: string): { bundle?: ExportBundle; error?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return { error: `JSON 解析失败：${(err as Error).message}` }
  }
  if (!isBundle(parsed)) return { error: '文件格式不正确：缺少 version / sessions 字段' }
  if (!Number.isInteger(parsed.version) || parsed.version < 1 || parsed.version > EXPORT_FORMAT_VERSION) {
    return { error: `不支持的导出版本：${parsed.version}（当前支持 ${EXPORT_FORMAT_VERSION}）` }
  }
  parsed.projects ??= []
  if (!Array.isArray(parsed.projects) || parsed.projects.some((p) => !p ||
    typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || typeof p.rootPath !== 'string')) {
    return { error: '项目格式不正确：需要 id / name / rootPath' }
  }
  return { bundle: parsed }
}

export interface ParsedMarkdownSession {
  title: string
  agentId: string
  projectName: string
  projectPath: string
  sourcePath: string
  sourceCwd: string
  externalId: string | null
  createdAt: number | null
  updatedAt: number | null
  messages: Array<{ role: string; content: string; createdAt: number | null }>
}

/**
 * 解析 Markdown 导入文件。
 *
 * 会话之间用一行 `---` 分隔（允许分隔线前后有空行）；
 * 正文里的 `#` / `---` / `\` 在导出时已加反斜杠前缀，这里还原。
 */
export function parseMarkdownImport(text: string): ParsedMarkdownSession[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const blocks = normalized.split(/\n[ \t]*---[ \t]*\n+(?=# )/).filter((b) => b.trim().length > 0)
  const out: ParsedMarkdownSession[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const titleLine = lines.find((l) => l.startsWith('# '))
    const title = titleLine ? titleLine.slice(2).trim() : '(无标题)'
    const meta: Record<string, string> = {}
    let idx = 0
    for (; idx < lines.length; idx += 1) {
      const line = lines[idx]
      if (line.startsWith('## ')) break
      const match = /^- ([a-z-]+):\s*(.*)$/.exec(line.trim())
      if (match) meta[match[1]] = match[2].trim()
    }
    const messages: Array<{ role: string; content: string; createdAt: number | null }> = []
    let currentRole: string | null = null
    let buffer: string[] = []
    const flush = () => {
      if (!currentRole) return
      messages.push({
        role: currentRole,
        content: unescapeMarkdownBody(buffer.join('\n').trim()),
        createdAt: null
      })
      buffer = []
    }
    for (; idx < lines.length; idx += 1) {
      const line = lines[idx]
      const heading = /^## (.+)$/.exec(line)
      if (heading) {
        flush()
        currentRole = heading[1].trim()
        continue
      }
      if (currentRole) buffer.push(line)
    }
    flush()

    out.push({
      title,
      agentId: meta['agent'] ?? '',
      projectName: meta['project'] && meta['project'] !== '未分组' ? meta['project'] : '',
      projectPath: meta['project-path'] ?? '',
      sourcePath: meta['source'] ?? '',
      sourceCwd: meta['source-cwd'] ?? '',
      externalId: meta['external-id'] ? meta['external-id'] : null,
      createdAt: meta['created'] ? Date.parse(meta['created']) || null : null,
      updatedAt: meta['updated'] ? Date.parse(meta['updated']) || null : null,
      messages: messages.filter((m) => m.content.length > 0)
    })
  }
  return out
}

/**
 * 导入会话（JSON bundle 或 Markdown）。
 * 使用与适配器相同的指纹规则，保证重复导入不产生副本。
 */
export function importSessions(
  repo: Repo,
  sessions: ExportSession[],
  options: ImportOptions = {}
): ImportResult {
  const result: ImportResult = { imported: 0, updated: 0, skipped: 0, failed: 0, errors: [] }
  const knownProjects = repo.listProjects()
  for (const session of sessions) {
    try {
      if (!session || typeof session.title !== 'string' || !Array.isArray(session.messages) ||
        session.messages.some((m) => !m || typeof m.role !== 'string' || typeof m.content !== 'string')) {
        throw new Error('会话需要 title 和有效的 messages 数组')
      }
      for (const value of [session.agentId, session.externalId, session.sourcePath, session.sourceCwd, session.manualProjectId]) {
        if (value != null && typeof value !== 'string') throw new Error('Agent、来源和归属字段必须是字符串')
      }
      for (const value of [session.createdAt, session.updatedAt, ...session.messages.map((m) => m.createdAt)]) {
        if (value != null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('时间戳必须是有效数字或 null')
      }
      const agentId = session.agentId || options.agentId
      if (!agentId) {
        result.failed += 1
        result.errors.push(`会话「${session.title}」缺少 Agent 标识`)
        continue
      }
      const contentHash = computeContentHash(
        session.title,
        session.messages.map((m) => ({ role: m.role, content: m.content }))
      )
      const fingerprint = computeFingerprint({ agentId, externalId: session.externalId,
        sourcePath: session.externalId ? null : session.sourcePath, contentHash })
      const autoProjectId = resolveAutoProjectId(
        [session.sourceCwd, session.sourcePath],
        knownProjects.map((p) => ({ id: p.id, rootPath: p.rootPath }))
      )
      if (session.manualProjectId && !knownProjects.some((p) => p.id === session.manualProjectId)) {
        throw new Error(`手动归属项目不存在：${session.manualProjectId}`)
      }
      const outcome = repo.upsertSession({
        agentId,
        externalId: session.externalId,
        fingerprint,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        sourcePath: session.sourcePath ?? '',
        sourceCwd: session.sourceCwd ?? null,
        rawMeta: session.rawMeta ?? { imported: true },
        contentHash,
        autoProjectId,
        sourceMtime: 0,
        messages: session.messages.map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt ?? null
        }))
      })
      // 导出包里带的手动归属必须一并恢复，否则「导出→导入」会丢掉手动归组
      if (session.manualProjectId !== undefined) {
        const projectId = session.manualProjectId
        repo.setSessionProject(outcome.id, projectId)
      }
      if (outcome.status === 'inserted') result.imported += 1
      else if (outcome.status === 'updated') result.updated += 1
      else result.skipped += 1
    } catch (err) {
      result.failed += 1
      result.errors.push(`${session?.title ?? "无标题"}: ${(err as Error).message}`)
    }
  }
  return result
}

/** 导入 Markdown：先把项目登记进去，再导入会话 */
export function importMarkdownSessions(
  repo: Repo,
  parsed: ParsedMarkdownSession[],
  options: ImportOptions = {}
): ImportResult {
  // 1) 登记涉及的项目
  for (const item of parsed) {
    if (!item.projectName) continue
    const exists = repo
      .listProjects()
      .find((p) => p.name === item.projectName || (item.projectPath && p.rootPath === item.projectPath))
    if (!exists) {
      repo.saveProject({ name: item.projectName, rootPath: item.projectPath || item.projectName })
    }
  }
  // 2) 共用 JSON 的校验、内容去重和错误统计逻辑。
  const projects = repo.listProjects()
  const sessions: ExportSession[] = parsed.map((item) => {
    const project = item.projectName
      ? projects.find((p) => p.name === item.projectName || p.rootPath === item.projectPath)
      : undefined
    return {
      id: '', agentId: item.agentId || options.agentId || '', externalId: item.externalId,
      title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt,
      messageCount: item.messages.length, sourcePath: item.sourcePath, sourceCwd: item.sourceCwd || null,
      autoProjectId: null, manualProjectId: project?.id ?? null,
      rawMeta: { imported: 'markdown' }, messages: item.messages
    }
  })
  return importSessions(repo, sessions, options)
}
