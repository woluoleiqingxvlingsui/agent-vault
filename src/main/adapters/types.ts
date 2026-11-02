export interface SourceRef {
  /** 展示用的来源标识 */
  path: string
  /** 实际读取的文件 */
  file: string
  mtimeMs: number
  size: number
}

export interface ParsedMessage {
  role: string
  content: string
  createdAt: number | null
}

export interface ParsedSession {
  externalId: string | null
  title: string
  createdAt: number | null
  updatedAt: number | null
  cwd: string | null
  sourcePath: string
  rawMeta: Record<string, unknown>
  messages: ParsedMessage[]
}

export interface AgentLaunchConfig {
  /** exec = 直接 spawn 可执行文件；appsfolder = 通过 shell:AppsFolder 启动 MSIX 应用 */
  protocol: 'exec' | 'appsfolder'
  command: string
  args: string[]
  cwd: string
  note: string
}

export interface AgentAdapter {
  id: string
  name: string
  vendor: string
  surface: 'cli' | 'desktop'
  launch: AgentLaunchConfig
  /** 默认来源根路径（文件或目录） */
  defaultSourcePath: string
  /** 来源路径说明（设置页展示，告诉用户如何手动配置） */
  sourceHint: string
  /** 记录解析支持情况：file = 普通文件；sqlite = SQLite 库；none = 无可解析记录源 */
  recordSupport: 'file' | 'sqlite' | 'none'
  /** recordSupport=none 时的原因说明（展示在能力矩阵里） */
  limitReason?: string
  /** 轻量探测：只验证来源是否可读可解析，不做完整导入 */
  probe?: (root: string) => Promise<{ ok: boolean; reason: string; sampleCount?: number }>
  supportsWatch: boolean
  discover(root: string): Promise<SourceRef[]>
  /** 解析一个来源，返回 0..n 条会话（SQLite 来源一次可返回整库会话） */
  parse(ref: SourceRef): Promise<ParsedSession[]>
}
