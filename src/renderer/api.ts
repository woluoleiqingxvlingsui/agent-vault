import type {
  AgentDescriptor,
  AppInfo,
  ImportResult,
  LaunchResult,
  Launcher,
  Project,
  ProjectStats,
  ScanResult,
  SessionListResult,
  SessionQuery
} from '../shared/types'

export interface VaultApi {
  app: {
    info(): Promise<AppInfo>
    openPath(target: string): Promise<boolean>
    revealDataDir(): Promise<string>
    icon(target: string): Promise<string | null>
  }
  shell: {
    pickDirectory(): Promise<string | null>
    pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>
  }
  launchers: {
    list(): Promise<Launcher[]>
    save(launcher: Partial<Launcher>): Promise<Launcher>
    remove(id: string): Promise<boolean>
    setEnabled(id: string, enabled: boolean): Promise<Launcher[]>
    launch(id: string): Promise<LaunchResult>
  }
  projects: {
    list(): Promise<Project[]>
    save(project: Partial<Project>): Promise<Project>
    remove(id: string): Promise<boolean>
    regroup(): Promise<{ changed: number }>
    reveal(target: string): Promise<boolean>
    stats(): Promise<ProjectStats>
  }
  agents: {
    list(): Promise<AgentDescriptor[]>
    setSource(agentId: string, source: string): Promise<AgentDescriptor[]>
    rescan(
      agentId: string
    ): Promise<{ result: ScanResult; descriptors: AgentDescriptor[] }>
    scanAll(): Promise<{ results: ScanResult[]; descriptors: AgentDescriptor[] }>
  }
  sessions: {
    list(query: SessionQuery): Promise<SessionListResult>
    get(id: string): Promise<{ session: any; messages: any[] } | null>
    setProject(id: string, projectId: string | null): Promise<any>
    counts(): Promise<{ total: number; byAgent: Record<string, number> }>
  }
  io: {
    export(format: 'json' | 'markdown', agentId?: string | null): Promise<any>
    import(
      filePath: string,
      format: 'json' | 'markdown'
    ): Promise<ImportResult & { ok: boolean; error?: string }>
    backup(): Promise<{ canceled: boolean; filePath?: string }>
  }
  onDataChanged(callback: () => void): () => void
}

declare global {
  interface Window {
    vault: VaultApi
  }
}

export const api: VaultApi = window.vault
