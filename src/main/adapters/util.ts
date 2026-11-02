import { promises as fs, statSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/** 递归列出目录下的文件（带深度上限，避免超大目录卡死） */
export async function listFiles(
  root: string,
  filter: (name: string) => boolean,
  maxDepth = 8
): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else if (entry.isFile() && filter(entry.name)) {
        out.push(full)
      }
    }
  }
  await walk(root, 0)
  return out
}

/** 解压 zstd 内容（Codex 会话使用 .jsonl.zst） */
export function decompressZstd(buffer: Buffer): string {
  const fn = (zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }).zstdDecompressSync
  if (typeof fn !== 'function') {
    throw new Error('当前 Node/Electron 运行时不支持 zstd 解压（需要 Node >= 22.15）')
  }
  return fn(buffer).toString('utf8')
}

/** 从消息列表派生标题 */
export function deriveTitle(messages: Array<{ role: string; content: string }>): string {
  const meaningful = messages.filter(
    (m) => m.role === 'user' && !isNoiseContent(m.content)
  )
  const source = meaningful[0] ?? messages.find((m) => !isNoiseContent(m.content))
  if (!source) return '(空会话)'
  const flat = source.content.replace(/\s+/g, ' ').trim()
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat
}

/** 系统提示 / 提醒类内容不适合作为标题 */
function isNoiseContent(content: string): boolean {
  const trimmed = (content ?? '').trim()
  if (!trimmed) return true
  return (
    trimmed.startsWith('<system-reminder>') ||
    trimmed.startsWith('<environment_context>') ||
    trimmed.startsWith('<user_instructions>') ||
    trimmed.startsWith('<ide_selection>') ||
    trimmed.startsWith('<background-task-finished>') ||
    trimmed.startsWith('<command-name>') ||
    trimmed.startsWith('<local-command-stdout>')
  )
}

/** 读取 JSONL 文件，逐行返回已解析对象（跳过坏行） */
export function parseJsonl<T = Record<string, unknown>>(text: string): T[] {
  const out: T[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as T)
    } catch {
      /* 跳过非法行 */
    }
  }
  return out
}

/** 把内容块数组拼成纯文本 */
export function joinContentBlocks(
  blocks: Array<{ type?: string; text?: string; thinking?: string }> | undefined
): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) {
    if (typeof block.text === 'string' && block.text.length > 0) parts.push(block.text)
  }
  return parts.join('\n\n')
}

export function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // 兼容秒级时间戳
    return value < 1e11 ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

export function statOrNull(file: string): { mtimeMs: number; size: number } | null {
  try {
    const stat = statSync(file)
    return { mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return null
  }
}
