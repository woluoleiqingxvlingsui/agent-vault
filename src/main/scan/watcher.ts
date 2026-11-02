import { watch, statSync, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { AgentAdapter } from '../adapters/types'
import type { Scanner } from './scanner'

export interface WatcherOptions {
  /** 轮询间隔（毫秒），作为文件监控的兜底 */
  intervalMs?: number
  /** 变更后延迟多久触发扫描（毫秒） */
  debounceMs?: number
  onScan?: (agentId: string) => void
}

/**
 * 增量监控：
 *  - 使用 fs.watch 监听来源目录（目录来源递归监听，文件来源监听其父目录）；
 *  - 同时保留周期性轮询作为兜底（Windows 上网络盘/部分目录事件不可靠）。
 *  - 监听与扫描都使用「用户配置的来源路径」，用户在设置页改路径后立即生效。
 * 扫描器本身按来源 mtime 跳过未变化的来源，因此重复触发不会重复导入。
 */
export class SourceWatcher {
  private watchers: FSWatcher[] = []
  private timer: NodeJS.Timeout | null = null
  private debounceTimers = new Map<string, NodeJS.Timeout>()
  private running = false
  /** 已监听的目录，避免同一个目录被重复监听 */
  private watchedDirs = new Map<string, Set<string>>()
  private polling = false

  constructor(
    private readonly scanner: Scanner,
    private readonly adapters: AgentAdapter[],
    private readonly options: WatcherOptions = {}
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    for (const adapter of this.scanner.automaticAgents()) {
      if (!adapter.supportsWatch) continue
      this.watchAdapter(adapter)
    }
    const interval = this.options.intervalMs ?? 60_000
    this.timer = setInterval(() => {
      void this.poll()
    }, interval)
    this.timer.unref?.()
  }

  stop(): void {
    this.running = false
    for (const w of this.watchers) {
      try {
        w.close()
      } catch {
        /* ignore */
      }
    }
    this.watchers = []
    this.watchedDirs.clear()
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const t of this.debounceTimers.values()) clearTimeout(t)
    this.debounceTimers.clear()
  }

  refresh(): void { this.stop(); this.start() }

  /** 监听某个 Agent 的来源目录（文件来源监听其父目录） */
  private watchAdapter(adapter: AgentAdapter): void {
    const source = this.scanner.resolveSourceRoot(adapter)
    if (!source) return
    let fileSource = adapter.recordSupport === 'sqlite'
    try { fileSource = statSync(source).isFile() } catch { /* 由轮询发现后续创建的来源 */ }
    const target = fileSource ? path.dirname(source) : source
    const key = path.resolve(target).toLowerCase()
    const shared = this.watchedDirs.get(key)
    if (shared) { shared.add(adapter.id); return }
    const ids = new Set([adapter.id])
    try {
      const watcher = watch(target, { recursive: !fileSource }, () => {
        for (const id of ids) this.scheduleScan(id)
      })
      watcher.on('error', () => {
        /* 监听失败时由轮询兜底 */
      })
      this.watchers.push(watcher)
      this.watchedDirs.set(key, ids)
    } catch {
      /* 目录不存在或不支持监听时由轮询兜底 */
    }
  }

  private scheduleScan(agentId: string): void {
    const existing = this.debounceTimers.get(agentId)
    if (existing) clearTimeout(existing)
    const delay = this.options.debounceMs ?? 1500
    const timer = setTimeout(() => {
      this.debounceTimers.delete(agentId)
      void this.scanner
        .scanAgent(agentId, { automatic: true })
        .then(() => this.options.onScan?.(agentId))
        .catch(() => undefined)
    }, delay)
    timer.unref?.()
    this.debounceTimers.set(agentId, timer)
  }

  private async poll(): Promise<void> {
    if (this.polling || !this.running) return
    this.polling = true
    try {
      for (const adapter of this.scanner.automaticAgents()) {
        if (!adapter.supportsWatch) continue
        try {
          if (!this.running || !this.scanner.automaticAgents().some((a) => a.id === adapter.id)) break
          await this.scanner.scanAgent(adapter.id, { automatic: true })
          this.options.onScan?.(adapter.id)
        } catch {
          /* 单个 Agent 失败不影响其它 */
        }
      }
    } finally { this.polling = false }
  }
}
