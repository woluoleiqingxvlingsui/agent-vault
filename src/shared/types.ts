/**
 * 统一数据模型（渲染进程 / 主进程 / IPC 共用）
 */

export type LauncherKind = 'app' | 'cli' | 'project'

export interface Launcher {
  id: string
  name: string
  kind: LauncherKind
  /** 可执行文件绝对路径，或 CLI 命令名，或项目目录路径 */
  command: string
  /** 启动协议：exec = 直接 spawn；appsfolder = MSIX 应用 */
  protocol: 'exec' | 'appsfolder'
  /** 参数数组（不拼接 shell 字符串） */
  args: string[]
  /** 工作目录 */
  cwd: string
  /** 可选关联项目 */
  projectId: string | null
  /** 图标路径或内置图标键 */
  icon: string
  enabled: boolean
  lastLaunchedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface Project {
  id: string
  name: string
  /** 项目根目录 */
  rootPath: string
  /** 可选启动配置（launcher id） */
  launcherId: string | null
  createdAt: number
  updatedAt: number
}

/** 能力状态 */
export type CapabilityStatus =
  | 'launchable' // 可启动
  | 'importable' // 已验证可导入
  | 'watchable' // 已验证可增量扫描
  | 'needs_config' // 需要用户配置来源路径
  | 'unsupported' // 当前环境或格式无法验证

export interface AgentCapabilities {
  launch: CapabilityStatus
  records: CapabilityStatus
  reasons: string[]
}

export type AgentSurface = 'cli' | 'desktop'

export interface AgentDescriptor {
  id: string
  name: string
  vendor: string
  surface: AgentSurface
  /** 启动协议：exec = 直接 spawn；appsfolder = MSIX 应用 */
  launchProtocol: 'exec' | 'appsfolder'
  launchCommand: string
  launchArgs: string[]
  launchCwd: string
  launchNote: string
  /** 自动发现的来源路径 */
  discoveredSources: string[]
  /** 用户自定义来源路径（覆盖自动发现） */
  configuredSource: string
  /** 来源路径说明（告诉用户如何配置） */
  sourceHint: string
  capabilities: AgentCapabilities
  lastScanAt: number | null
  lastError: string | null
  sessionCount: number
}

export interface ConversationMessage {
  id: string
  sessionId: string
  seq: number
  role: string
  content: string
  createdAt: number | null
}

export interface ConversationSession {
  id: string
  agentId: string
  externalId: string | null
  title: string
  createdAt: number | null
  updatedAt: number | null
  messageCount: number
  /** 来源文件或来源位置 */
  sourcePath: string
  /** 来源 cwd / 项目路径 */
  sourceCwd: string | null
  /** 自动归组结果 */
  autoProjectId: string | null
  /** 手动项目覆盖 */
  manualProjectId: string | null
  /** 实际生效的项目（手动优先） */
  effectiveProjectId: string | null
  fingerprint: string
  rawMeta: Record<string, unknown>
}

export type SortField = 'createdAt' | 'updatedAt'
export type SortDir = 'asc' | 'desc'

export interface SessionQuery {
  agentId?: string | null
  /** 项目 id；UNGROUPED 表示未分组；null/'' 表示全部 */
  projectId?: string | null
  search?: string
  sortBy?: SortField
  sortDir?: SortDir
  limit?: number
  offset?: number
}

export interface SessionListResult {
  total: number
  items: ConversationSession[]
}

export interface ProjectStats {
  byProject: Record<string, number>
  ungrouped: number
}

export interface LaunchResult {
  ok: boolean
  message: string
  pid?: number
}

export interface ScanResult {
  agentId: string
  discovered: number
  imported: number
  updated: number
  skipped: number
  failed: number
  error: string | null
  durationMs: number
}

export interface AppInfo {
  dataDir: string
  dbFile: string
  version: string
  electron: string
}

export interface ExportPayload {
  version: number
  exportedAt: number
  sessions: Array<
    ConversationSession & {
      messages: ConversationMessage[]
    }
  >
}

export interface ImportResult {
  imported: number
  updated: number
  skipped: number
  failed: number
  errors: string[]
}

/** 未分组项目的哨兵值 */
export const UNGROUPED = '__ungrouped__'
