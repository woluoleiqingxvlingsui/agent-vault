import type { Repo } from '../db/repo'
import type { ScanPreferences } from '../../shared/types'

const KEY = 'scan.preferences'

export function getScanPreferences(repo: Repo): ScanPreferences {
  try {
    const value = JSON.parse(repo.getSetting(KEY) ?? 'null')
    if (value && Array.isArray(value.agentIds)) {
      return { initialized: value.initialized === true, paused: value.paused === true,
        agentIds: value.agentIds.filter((id: unknown): id is string => typeof id === 'string') }
    }
  } catch { /* 未配置或旧数据：先询问用户 */ }
  return { initialized: false, paused: true, agentIds: [] }
}

export function saveScanPreferences(repo: Repo, value: ScanPreferences): void {
  repo.setSetting(KEY, JSON.stringify(value))
}

export function seedAgentLaunchers(repo: Repo, adapters: import('../adapters/types').AgentAdapter[]): void {
  for (const adapter of adapters) {
    const id = `agent-${adapter.id}`
    if (repo.getLauncher(id)) continue
    repo.saveLauncher({ id, name: adapter.name, kind: adapter.surface === 'cli' ? 'cli' : 'app',
      command: adapter.launch.command, protocol: adapter.launch.protocol, args: adapter.launch.args,
      cwd: adapter.launch.cwd, enabled: true, icon: adapter.vendor })
  }
}
