import { existsSync } from 'node:fs'
import path from 'node:path'
import type { AgentAdapter } from '../adapters/types'
import type { AgentCapabilities, CapabilityStatus } from '../../shared/types'
import { resolveExecutable } from '../launch/launcher'

export interface AgentEvaluation {
  capabilities: AgentCapabilities
  discoveredSources: string[]
  sourceRoot: string
}

/** 能力探测时最多抽样多少个来源文件（避免大目录全量解析） */
const PROBE_SAMPLE_LIMIT = 20

/** 评估启动能力：目标是否存在 */
export function evaluateLaunch(adapter: AgentAdapter): { status: CapabilityStatus; reason: string } {
  if (adapter.id === 'minimax-cli' && !adapter.launch.args.length &&
      /(^|[\\/])node(?:\.exe)?$/i.test(adapter.launch.command)) {
    return { status: 'needs_config', reason: '仅找到 Node，尚未配置 MiniMax/pi 的 CLI 脚本参数' }
  }
  if (adapter.launch.protocol === 'appsfolder') {
    const ok = adapter.launch.command.includes('!')
    return ok
      ? { status: 'launchable', reason: 'MSIX 应用入口已配置（通过 shell:AppsFolder 启动）' }
      : { status: 'needs_config', reason: 'MSIX 应用 ID 格式不正确，请在设置中修改' }
  }
  const resolved = resolveExecutable(adapter.launch.command)
  if (!resolved.ok) {
    return {
      status: 'needs_config',
      reason: `${resolved.reason}；可在设置中修改为实际可执行文件路径`
    }
  }
  return { status: 'launchable', reason: `已定位启动目标：${resolved.file}` }
}

/** 评估记录能力：来源是否可读、可解析、可增量扫描 */
export async function evaluateRecords(
  adapter: AgentAdapter,
  sourceRoot: string
): Promise<{ status: CapabilityStatus; reason: string }> {
  if (adapter.recordSupport === 'none') {
    return {
      status: 'unsupported',
      reason: adapter.limitReason ?? '该来源当前没有可验证的记录格式'
    }
  }
  if (!sourceRoot || !existsSync(sourceRoot)) {
    return {
      status: 'needs_config',
      reason: `来源路径不存在或未配置：${sourceRoot || '(空)'}；请在设置中指定实际来源目录`
    }
  }
  if (adapter.probe) {
    try {
      const result = await adapter.probe(sourceRoot)
      if (!result.ok) return { status: 'unsupported', reason: result.reason }
      return {
        status: adapter.supportsWatch ? 'watchable' : 'importable',
        reason: result.reason
      }
    } catch (err) {
      return { status: 'unsupported', reason: `探测失败：${(err as Error).message}` }
    }
  }
  try {
    const refs = await adapter.discover(sourceRoot)
    if (!refs.length) {
      return { status: 'unsupported', reason: `未在 ${sourceRoot} 发现可解析文件` }
    }
    // 不能只看第一个文件：同一个来源目录里可能混着别的形态的文件
    // （例如 Codex 桌面端与 CLI 共用 ~/.codex/sessions，按 originator 区分），
    // 只解析第一个会把「这个来源可用」误判成「无法验证」。
    const sample = refs.slice(0, PROBE_SAMPLE_LIMIT)
    let parsedCount = 0
    let lastReason = ''
    for (const ref of sample) {
      try {
        const parsed = await adapter.parse(ref)
        if (parsed.length) {
          parsedCount += parsed.length
          if (parsedCount >= 1) {
            return {
              status: adapter.supportsWatch ? 'watchable' : 'importable',
              reason: `已验证解析：${refs.length} 个来源文件，抽样 ${sample.length} 个得到 ${parsedCount} 条会话`
            }
          }
        }
      } catch (err) {
        lastReason = (err as Error).message
      }
    }
    return {
      status: 'unsupported',
      reason: lastReason
        ? `解析验证失败：${lastReason}`
        : `已发现 ${refs.length} 个来源文件，但抽样 ${sample.length} 个均未解析出会话（格式可能不匹配）`
    }
  } catch (err) {
    return { status: 'unsupported', reason: `解析验证失败：${(err as Error).message}` }
  }
}

export async function evaluateAgent(
  adapter: AgentAdapter,
  configuredSource: string
): Promise<AgentEvaluation> {
  const sourceRoot = (configuredSource || '').trim() || adapter.defaultSourcePath
  const launch = evaluateLaunch(adapter)
  const records = await evaluateRecords(adapter, sourceRoot)
  const reasons: string[] = []
  if (launch.status !== 'launchable') reasons.push(`启动：${launch.reason}`)
  else reasons.push(`启动：${launch.reason}`)
  reasons.push(`记录：${records.reason}`)
  return {
    sourceRoot,
    discoveredSources: sourceRoot ? [sourceRoot] : [],
    capabilities: {
      launch: launch.status,
      records: records.status,
      reasons
    }
  }
}

export function capabilityLabel(status: CapabilityStatus): string {
  switch (status) {
    case 'launchable':
      return '可启动'
    case 'importable':
      return '可导入'
    case 'watchable':
      return '可增量扫描'
    case 'needs_config':
      return '需配置'
    case 'unsupported':
      return '不支持'
    default:
      return status
  }
}

export function shortPath(p: string): string {
  if (!p) return ''
  const home = process.env.USERPROFILE ?? ''
  if (home && p.toLowerCase().startsWith(home.toLowerCase())) {
    return `%USERPROFILE%${p.slice(home.length)}`
  }
  return path.normalize(p)
}
