import { sha256 } from '../util/paths'

export interface SessionIdentity {
  agentId: string
  /** Agent 侧的外部会话 id（如果有） */
  externalId?: string | null
  /** 来源文件或来源位置 */
  sourcePath?: string | null
  /** 内容指纹（无稳定 id / 路径时的兜底） */
  contentHash?: string | null
}

/**
 * 导入指纹：优先用外部会话 id，其次来源文件路径，最后内容指纹。
 * 保证同一来源重复扫描不会产生重复会话。
 */
export function computeFingerprint(identity: SessionIdentity): string {
  const basis = identityKey(identity)
  return sha256(`${identity.agentId}${basis}`)
}

export function identityKey(identity: SessionIdentity): string {
  if (identity.externalId) return `ext:${identity.externalId}`
  if (identity.sourcePath) return `src:${identity.sourcePath.toLowerCase()}`
  return `con:${identity.contentHash || ''}`
}

/** 内容指纹：用于判断来源内容是否变化（决定增量更新还是跳过） */
export function computeContentHash(title: string, messages: Array<{ role: string; content: string }>): string {
  const payload = messages.map((m) => `${m.role}${m.content}`).join('')
  return sha256(`${title}${payload}`)
}
