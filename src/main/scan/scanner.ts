import type { Repo } from '../db/repo'
import type { AgentAdapter, ParsedSession, SourceRef } from '../adapters/types'
import { computeContentHash, computeFingerprint } from '../domain/dedup'
import { resolveAutoProjectId } from '../domain/grouping'
import { AGENT_SOURCE_KEY } from '../agents/keys'
import type { ScanResult } from '../../shared/types'

export interface ScanOptions {
  /** 覆盖该 Agent 的来源路径 */
  sourceRoot?: string
  /** 忽略增量跳过，强制重新解析 */
  force?: boolean
}

export class Scanner {
  constructor(
    private readonly repo: Repo,
    private readonly adapters: AgentAdapter[]
  ) {}

  getAdapter(id: string): AgentAdapter | undefined {
    return this.adapters.find((a) => a.id === id)
  }

  /** 用户在设置页配置的来源路径（未配置时返回空串） */
  configuredSource(agentId: string): string {
    return (this.repo.getSetting(AGENT_SOURCE_KEY(agentId)) ?? '').trim()
  }

  /**
   * 解析实际使用的来源根路径。
   * 优先级：显式覆盖 > 用户配置 > 适配器默认路径。
   */
  resolveSourceRoot(adapter: AgentAdapter, override?: string): string {
    return (override ?? '').trim() || this.configuredSource(adapter.id) || adapter.defaultSourcePath
  }

  async scanAgent(agentId: string, options: ScanOptions = {}): Promise<ScanResult> {
    const started = Date.now()
    const adapter = this.getAdapter(agentId)
    if (!adapter) {
      return {
        agentId,
        discovered: 0,
        imported: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        error: `未知的 Agent：${agentId}`,
        durationMs: Date.now() - started
      }
    }

    const result: ScanResult = {
      agentId,
      discovered: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      error: null,
      durationMs: 0
    }

    if (adapter.recordSupport === 'none') {
      result.error = adapter.limitReason ?? '该来源当前无法解析'
      this.repo.setScanState(agentId, Date.now(), result.error, 0)
      result.durationMs = Date.now() - started
      return result
    }

    const sourceRoot = this.resolveSourceRoot(adapter, options.sourceRoot)
    let refs: SourceRef[] = []
    try {
      refs = await adapter.discover(sourceRoot)
    } catch (err) {
      result.error = `发现来源失败：${(err as Error).message}`
      this.repo.setScanState(agentId, Date.now(), result.error, 0)
      result.durationMs = Date.now() - started
      return result
    }
    result.discovered = refs.length

    if (!refs.length) {
      result.error = `未在来源路径发现可解析文件：${sourceRoot}`
      this.repo.setScanState(agentId, Date.now(), result.error, 0)
      result.durationMs = Date.now() - started
      return result
    }

    const projects = this.repo.listProjects()
    const errors: string[] = []

    for (const ref of refs) {
      // 增量：来源未变化（按来源记录的 mtime 判断）=> 跳过解析
      const mtime = Math.floor(ref.mtimeMs)
      if (!options.force) {
        const known = this.repo.getSourceMtime(agentId, ref.path)
        if (known !== null && known === mtime) {
          result.skipped += 1
          continue
        }
      }
      let sessions: ParsedSession[] = []
      try {
        sessions = await adapter.parse(ref)
      } catch (err) {
        result.failed += 1
        errors.push(`${ref.path}: ${(err as Error).message}`)
        continue
      }
      for (const session of sessions) {
        try {
          const status = this.persistSession(agentId, session, projects, ref)
          if (status === 'inserted') result.imported += 1
          else if (status === 'updated') result.updated += 1
          else result.skipped += 1
        } catch (err) {
          result.failed += 1
          errors.push(`${ref.path}: ${(err as Error).message}`)
        }
      }
      // 源端已删除的会话不再保留（仅清理本 Agent 自己写入的记录）
      try {
        this.repo.deleteSessionsMissingFromSource(
          agentId,
          ref.path,
          sessions.map((s) => s.externalId).filter((id): id is string => Boolean(id))
        )
      } catch (err) {
        errors.push(`${ref.path}: 清理已删除会话失败：${(err as Error).message}`)
      }
      // 记录本次来源的 mtime，供下次增量判断
      this.repo.setSourceMtime(agentId, ref.path, mtime)
    }

    if (errors.length) {
      result.error = errors.slice(0, 3).join('；')
    }
    // 项目可能在上次导入之后才登记，这里统一重算一次自动归组
    this.repo.regroupAll()
    this.repo.setScanState(agentId, Date.now(), result.error, result.imported + result.updated)
    result.durationMs = Date.now() - started
    return result
  }

  private persistSession(
    agentId: string,
    session: ParsedSession,
    projects: ReturnType<Repo['listProjects']>,
    ref: SourceRef
  ): 'inserted' | 'updated' | 'skipped' {
    const fingerprint = computeFingerprint({
      agentId,
      externalId: session.externalId,
      sourcePath: session.externalId ? null : session.sourcePath
    })
    const contentHash = computeContentHash(
      session.title,
      session.messages.map((m) => ({ role: m.role, content: m.content }))
    )
    const autoProjectId = resolveAutoProjectId(
      [session.cwd, session.sourcePath],
      projects.map((p) => ({ id: p.id, rootPath: p.rootPath }))
    )
    const outcome = this.repo.upsertSession({
      agentId,
      externalId: session.externalId,
      fingerprint,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      sourcePath: session.sourcePath,
      sourceCwd: session.cwd,
      rawMeta: session.rawMeta,
      contentHash,
      autoProjectId,
      sourceMtime: Math.floor(ref.mtimeMs),
      messages: session.messages
    })
    return outcome.status
  }

  async scanAll(options: ScanOptions = {}): Promise<ScanResult[]> {
    const results: ScanResult[] = []
    for (const adapter of this.adapters) {
      results.push(await this.scanAgent(adapter.id, options))
    }
    return results
  }
}
