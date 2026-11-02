import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentAdapter, ParsedSession, SourceRef } from './types'
import { deriveTitle, joinContentBlocks, listFiles, parseJsonl, statOrNull, toTimestamp } from './util'

interface PiLine {
  type?: string
  id?: string
  timestamp?: string
  cwd?: string
  message?: {
    role?: string
    content?: Array<{ type?: string; text?: string }>
    timestamp?: number
    model?: string
    provider?: string
  }
}

/**
 * MiniMax CLI（pi-coding-agent）适配器。
 *
 * 真实探测来源：%USERPROFILE%\.pi\agent\sessions\<编码后的 cwd>\<时间戳>_<uuid>.jsonl
 * 首行 type=session 提供 id / cwd / timestamp；type=message 提供对话正文。
 */
export function createPiCliAdapter(options: {
  id: string
  name: string
  launch: AgentAdapter['launch']
  defaultSourcePath: string
  sourceHint: string
}): AgentAdapter {
  return {
    id: options.id,
    name: options.name,
    vendor: 'MiniMax',
    surface: 'cli',
    launch: options.launch,
    defaultSourcePath: options.defaultSourcePath,
    sourceHint: options.sourceHint,
    recordSupport: 'file',
    supportsWatch: true,
    async discover(root: string): Promise<SourceRef[]> {
      const files = await listFiles(root, (name) => name.endsWith('.jsonl'))
      const refs: SourceRef[] = []
      for (const file of files) {
        const stat = statOrNull(file)
        if (!stat) continue
        refs.push({ path: file, file, mtimeMs: stat.mtimeMs, size: stat.size })
      }
      return refs
    },
    async parse(ref: SourceRef): Promise<ParsedSession[]> {
      const text = await fs.readFile(ref.file, 'utf8')
      const lines = parseJsonl<PiLine>(text)
      let meta: PiLine = {}
      const messages: Array<{ role: string; content: string; createdAt: number | null }> = []
      for (const line of lines) {
        if (line.type === 'session') {
          meta = line
          continue
        }
        if (line.type !== 'message' || !line.message) continue
        const role = line.message.role ?? 'unknown'
        if (role !== 'user' && role !== 'assistant') continue
        const content = joinContentBlocks(line.message.content)
        if (!content.trim()) continue
        messages.push({
          role,
          content,
          createdAt: toTimestamp(line.message.timestamp) ?? toTimestamp(line.timestamp)
        })
      }
      if (!messages.length) return []
      return [
        {
          externalId: meta.id ?? path.basename(ref.file),
          title: deriveTitle(messages),
          createdAt: toTimestamp(meta.timestamp),
          updatedAt: messages.reduce<number | null>(
            (acc, m) => (m.createdAt && (!acc || m.createdAt > acc) ? m.createdAt : acc),
            null
          ),
          cwd: meta.cwd ?? decodeCwdFromPath(ref.file),
          sourcePath: ref.path,
          rawMeta: {
            source: 'pi-cli',
            file: path.basename(ref.file),
            sessionDir: path.basename(path.dirname(ref.file))
          },
          messages
        }
      ]
    }
  }
}

/** pi 把 cwd 编码进目录名，形如 "--C--Users--name--"，可近似反解 */
export function decodeCwdFromPath(file: string): string | null {
  const dir = path.basename(path.dirname(file))
  if (!dir.startsWith('--')) return null
  const decoded = dir
    .slice(2)
    .replace(/--/g, '\\')
    .replace(/^[A-Za-z]--/, 'C:\\')
  return decoded.replace(/\\+$/, '') || null
}
