import { sha256 } from '../util/paths'

export interface GroupableProject {
  id: string
  rootPath: string
}

/**
 * 自动归组：使用记录的 cwd / 来源路径 / 适配器提供的项目路径，
 * 与已登记项目根目录匹配；多个项目匹配时取路径最长（最深）的项目；
 * 无法匹配返回 null（进入“未分组”）。
 */
export function resolveAutoProjectId(
  candidatePaths: Array<string | null | undefined>,
  projects: GroupableProject[]
): string | null {
  let bestId: string | null = null
  let bestLen = -1
  for (const candidate of candidatePaths) {
    if (!candidate) continue
    const c = candidate.trim()
    if (!c) continue
    for (const project of projects) {
      if (!isUnder(c, project.rootPath)) continue
      const len = normalizeLen(project.rootPath)
      if (len > bestLen) {
        bestLen = len
        bestId = project.id
      }
    }
  }
  return bestId
}

function normalizeLen(p: string): number {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').length
}

function isUnder(child: string, parent: string): boolean {
  const c = child.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  const p = parent.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  if (!c || !p) return false
  if (c === p) return true
  return c.startsWith(p.endsWith('\\') ? p : `${p}\\`)
}

/**
 * 手动覆盖优先，其次自动归组。
 * manualProjectId === '' 表示“强制归入未分组”，因此不能用真值判断。
 */
export function effectiveProjectId(
  autoProjectId: string | null,
  manualProjectId: string | null
): string | null {
  if (manualProjectId === null) return autoProjectId
  return manualProjectId === '' ? null : manualProjectId
}
