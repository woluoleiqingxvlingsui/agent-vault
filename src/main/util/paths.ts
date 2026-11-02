import { createHash } from 'node:crypto'

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * 归一化路径用于比较：统一分隔符、去尾部分隔符、统一大小写（Windows）。
 */
export function normalizePath(input: string | null | undefined): string {
  if (!input) return ''
  let s = String(input).trim().replace(/\//g, '\\')
  if (s.length > 3) s = s.replace(/\\+$/, '')
  return s.toLowerCase()
}

/** child 是否位于 parent 之内（含相等） */
export function isPathUnder(child: string | null | undefined, parent: string | null | undefined): boolean {
  const c = normalizePath(child)
  const p = normalizePath(parent)
  if (!c || !p) return false
  if (c === p) return true
  const prefix = p.endsWith('\\') ? p : `${p}\\`
  return c.startsWith(prefix)
}

/** 找到 child 相对 parent 的偏移（用于截断展示路径） */
export function relativeTo(child: string, parent: string): string {
  const c = normalizePath(child)
  const p = normalizePath(parent)
  if (!c.startsWith(p)) return child
  return child.slice(p.length).replace(/^[\\/]/, '')
}
