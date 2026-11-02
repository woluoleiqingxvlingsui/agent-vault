import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentAdapter, ParsedSession, SourceRef } from './types'
import { decompressZstd, deriveTitle, joinContentBlocks, listFiles, parseJsonl, statOrNull, toTimestamp } from './util'

interface CodexLine {
  timestamp?: string
  type?: string
  payload?: Record<string, unknown>
}

/**
 * Codex 适配器（CLI 与桌面端共用 ~/.codex/sessions 存储）。
 *
 * 真实探测来源：%USERPROFILE%\.codex\sessions\YYYY\MM\DD\rollout-*.jsonl.zst
 * 每行 JSON：type=session_meta 提供 id / cwd / originator；
 *            type=response_item + payload.type=message 提供对话正文。
 */
export function createCodexAdapter(options: {
  id: string
  name: string
  surface: 'cli' | 'desktop'
  launch: AgentAdapter['launch']
  defaultSourcePath: string
  sourceHint: string
  /** 桌面端匹配 originator；CLI 匹配其它 originator */
  matchOriginator: (originator: string) => boolean
  originatorLabel: string
}): AgentAdapter {
  return {
    id: options.id,
    name: options.name,
    vendor: 'OpenAI',
    surface: options.surface,
    launch: options.launch,
    defaultSourcePath: options.defaultSourcePath,
    sourceHint: options.sourceHint,
    recordSupport: 'file',
    supportsWatch: true,
    async discover(root: string): Promise<SourceRef[]> {
      const files = await listFiles(root, (name) => name.endsWith('.jsonl.zst'))
      const refs: SourceRef[] = []
      for (const file of files) {
        const stat = statOrNull(file)
        if (!stat) continue
        refs.push({ path: file, file, mtimeMs: stat.mtimeMs, size: stat.size })
      }
      return refs
    },
    async parse(ref: SourceRef): Promise<ParsedSession[]> {
      const buffer = await fs.readFile(ref.file)
      let text: string
      try {
        text = decompressZstd(buffer)
      } catch (err) {
        throw new Error(`无法解压 Codex 会话文件（${path.basename(ref.file)}）：${(err as Error).message}`)
      }
      const lines = parseJsonl<CodexLine>(text)
      let meta: Record<string, unknown> = {}
      const messages: Array<{ role: string; content: string; createdAt: number | null }> = []
      for (const line of lines) {
        const payload = line.payload ?? {}
        if (line.type === 'session_meta') {
          meta = payload
          continue
        }
        if (line.type !== 'response_item') continue
        if (payload.type !== 'message') continue
        const role = typeof payload.role === 'string' ? payload.role : 'unknown'
        if (role !== 'user' && role !== 'assistant') continue
        const content = joinContentBlocks(
          Array.isArray(payload.content)
            ? (payload.content as Array<{ type?: string; text?: string }>)
            : undefined
        )
        if (!content.trim()) continue
        messages.push({
          role,
          content,
          createdAt: toTimestamp(line.timestamp) ?? toTimestamp(payload.timestamp)
        })
      }
      if (!messages.length && !meta.session_id) return []
      const originator = typeof meta.originator === 'string' ? meta.originator : ''
      if (!options.matchOriginator(originator)) return []
      const externalId =
        typeof meta.session_id === 'string'
          ? meta.session_id
          : typeof meta.id === 'string'
            ? meta.id
            : null
      const createdAt = toTimestamp(meta.timestamp)
      const updatedAt = messages.reduce<number | null>(
        (acc, m) => (m.createdAt && (!acc || m.createdAt > acc) ? m.createdAt : acc),
        null
      )
      const cwd = typeof meta.cwd === 'string' ? meta.cwd : null
      return [
        {
          externalId,
          title: deriveTitle(messages),
          createdAt,
          updatedAt,
          cwd,
          sourcePath: ref.path,
          rawMeta: {
            source: 'codex',
            originator,
            originatorLabel: options.originatorLabel,
            cliVersion: meta.cli_version,
            modelProvider: meta.model_provider,
            runtimeWorkspaceRoots: meta.runtime_workspace_roots,
            file: path.basename(ref.file)
          },
          messages
        }
      ]
    }
  }
}
