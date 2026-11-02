import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentAdapter, ParsedSession, SourceRef } from './types'
import { deriveTitle, joinContentBlocks, listFiles, parseJsonl, statOrNull, toTimestamp } from './util'

interface MmLine {
  message_id?: string
  turn_id?: string
  message?: {
    role?: string
    content?: Array<{ type?: string; text?: string }>
    timestamp?: number
    model?: string
    provider?: string
    stopReason?: string
  }
}

interface MmManifest {
  schemaVersion?: number
  sessionId?: string
  createdAtMs?: number
  updatedAtMs?: number
  source?: string
  layout?: string
  paths?: Record<string, string>
}

/**
 * MiniMax 桌面端（MiniMax Code）适配器。
 *
 * 真实探测来源：%USERPROFILE%\.minimax\v2\sessions\YYYY\MM\DD\<时间戳>-session_<id>\
 *   - messages.jsonl：逐行消息（message.role + message.content[].text）
 *   - manifest.json：sessionId / createdAtMs / updatedAtMs
 */
export function createMiniMaxDesktopAdapter(options: {
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
    surface: 'desktop',
    launch: options.launch,
    defaultSourcePath: options.defaultSourcePath,
    sourceHint: options.sourceHint,
    recordSupport: 'file',
    supportsWatch: true,
    async discover(root: string): Promise<SourceRef[]> {
      const files = await listFiles(root, (name) => name === 'messages.jsonl')
      const refs: SourceRef[] = []
      for (const file of files) {
        const stat = statOrNull(file)
        if (!stat) continue
        refs.push({ path: file, file, mtimeMs: stat.mtimeMs, size: stat.size })
      }
      return refs
    },
    async parse(ref: SourceRef): Promise<ParsedSession[]> {
      const dir = path.dirname(ref.file)
      let manifest: MmManifest = {}
      try {
        manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')) as MmManifest
      } catch {
        manifest = {}
      }
      const text = await fs.readFile(ref.file, 'utf8')
      const lines = parseJsonl<MmLine>(text)
      const messages: Array<{ role: string; content: string; createdAt: number | null }> = []
      let toolCallCount = 0
      for (const line of lines) {
        const m = line.message
        if (!m) continue
        const role = m.role ?? 'unknown'
        const blocks = Array.isArray(m.content) ? m.content : []
        for (const block of blocks) {
          if (block.type === 'toolCall') toolCallCount += 1
        }
        if (role !== 'user' && role !== 'assistant') continue
        const content = joinContentBlocks(blocks)
        if (!content.trim()) continue
        messages.push({
          role,
          content,
          createdAt: toTimestamp(m.timestamp) ?? null
        })
      }
      const externalId = manifest.sessionId ?? path.basename(dir)
      if (!messages.length) {
        // 空会话也保留元信息，便于观察来源可用性
        if (!manifest.sessionId) return []
        return [
          {
            externalId,
            title: '(空会话)',
            createdAt: toTimestamp(manifest.createdAtMs),
            updatedAt: toTimestamp(manifest.updatedAtMs),
            cwd: null,
            sourcePath: ref.path,
            rawMeta: { source: 'minimax-desktop', sessionDir: path.basename(dir), messageCount: 0 },
            messages: []
          }
        ]
      }
      const updatedAt =
        toTimestamp(manifest.updatedAtMs) ??
        messages.reduce<number | null>(
          (acc, m) => (m.createdAt && (!acc || m.createdAt > acc) ? m.createdAt : acc),
          null
        )
      return [
        {
          externalId,
          title: deriveTitle(messages),
          createdAt: toTimestamp(manifest.createdAtMs),
          updatedAt,
          cwd: null,
          sourcePath: ref.path,
          rawMeta: {
            source: 'minimax-desktop',
            sessionDir: path.basename(dir),
            layout: manifest.layout,
            toolCallCount
          },
          messages
        }
      ]
    }
  }
}
