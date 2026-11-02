import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentDescriptor,
  ImportResponse,
  ScanPreferences,
  AppInfo,
  ProjectStats,
  LaunchResult,
  Launcher,
  Project,
  ScanResult,
  SessionListResult,
  SessionQuery
} from '../shared/types'

const api = {
  scan: {
    preferences: (): Promise<ScanPreferences> => ipcRenderer.invoke('scan:preferences'),
    configure: (value: ScanPreferences): Promise<ScanPreferences> => ipcRenderer.invoke('scan:configure', value)
  },
  app: {
    demo: (): Promise<boolean> => ipcRenderer.invoke('app:demo'),
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
    openPath: (target: string): Promise<boolean> => ipcRenderer.invoke('app:openPath', target),
    revealDataDir: (): Promise<string> => ipcRenderer.invoke('io:revealDataDir'),
    icon: (target: string): Promise<string | null> => ipcRenderer.invoke('app:icon', target)
  },
  shell: {
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('shell:pickDirectory'),
    pickFile: (filters?: Electron.FileFilter[]): Promise<string | null> =>
      ipcRenderer.invoke('shell:pickFile', filters)
  },
  launchers: {
    list: (): Promise<Launcher[]> => ipcRenderer.invoke('launchers:list'),
    save: (launcher: Partial<Launcher>): Promise<Launcher> =>
      ipcRenderer.invoke('launchers:save', launcher),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('launchers:delete', id),
    setEnabled: (id: string, enabled: boolean): Promise<Launcher[]> =>
      ipcRenderer.invoke('launchers:setEnabled', { id, enabled }),
    launch: (id: string): Promise<LaunchResult> => ipcRenderer.invoke('launchers:launch', id)
  },
  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
    save: (project: Partial<Project>): Promise<Project> => ipcRenderer.invoke('projects:save', project),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('projects:delete', id),
    regroup: (): Promise<{ changed: number }> => ipcRenderer.invoke('projects:regroup'),
    stats: (): Promise<ProjectStats> => ipcRenderer.invoke('projects:stats'),
    reveal: (target: string): Promise<boolean> => ipcRenderer.invoke('projects:reveal', target)
  },
  agents: {
    list: (): Promise<AgentDescriptor[]> => ipcRenderer.invoke('agents:list'),
    setSource: (agentId: string, source: string): Promise<AgentDescriptor[]> =>
      ipcRenderer.invoke('agents:setSource', { agentId, source }),
    rescan: (agentId: string): Promise<{ result: ScanResult; descriptors: AgentDescriptor[] }> =>
      ipcRenderer.invoke('agents:rescan', agentId),
    scanAll: (): Promise<{ results: ScanResult[]; descriptors: AgentDescriptor[] }> =>
      ipcRenderer.invoke('agents:scanAll')
  },
  sessions: {
    list: (query: SessionQuery): Promise<SessionListResult> =>
      ipcRenderer.invoke('sessions:list', query),
    get: (id: string): Promise<{ session: any; messages: any[] } | null> =>
      ipcRenderer.invoke('sessions:get', id),
    setProject: (id: string, projectId: string | null): Promise<any> =>
      ipcRenderer.invoke('sessions:setProject', { id, projectId }),
    counts: (): Promise<{ total: number; byAgent: Record<string, number> }> =>
      ipcRenderer.invoke('sessions:counts')
  },
  io: {
    restore: (): Promise<{ canceled: boolean }> => ipcRenderer.invoke('io:restore'),
    export: (format: 'json' | 'markdown', agentId?: string | null): Promise<any> =>
      ipcRenderer.invoke('io:export', { format, agentId }),
    import: (filePath: string, format: 'json' | 'markdown'): Promise<ImportResponse> =>
      ipcRenderer.invoke('io:import', { filePath, format }),
    backup: (): Promise<{ canceled: boolean; filePath?: string }> => ipcRenderer.invoke('io:backup')
  },
  onDataChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('data:changed', listener)
    return () => ipcRenderer.removeListener('data:changed', listener)
  }
}

contextBridge.exposeInMainWorld('vault', api)

export type VaultApi = typeof api
