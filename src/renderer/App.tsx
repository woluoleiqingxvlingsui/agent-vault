import { useCallback, useEffect, useState } from 'react'
import ScanSettings from './components/ScanSettings'
import type { ScanPreferences } from '../shared/types'
import { api } from './api'
import type { AgentDescriptor, Launcher, Project, ProjectStats } from '../shared/types'
import { useTheme } from './theme'
import { Icon } from './components/Icon'
import type { IconName } from './components/Icon'
import LaunchPage from './pages/LaunchPage'
import ProjectsPage from './pages/ProjectsPage'
import ConversationsPage from './pages/ConversationsPage'
import SettingsPage from './pages/SettingsPage'

export type PageId = 'launch' | 'projects' | 'conversations' | 'settings'

const NAV: Array<{ id: PageId; label: string; icon: IconName }> = [
  { id: 'launch', label: '启动', icon: 'launch' },
  { id: 'projects', label: '项目', icon: 'projects' },
  { id: 'conversations', label: '对话记录', icon: 'chat' },
  { id: 'settings', label: '设置', icon: 'settings' }
]

const PAGE_IDS: PageId[] = ['launch', 'projects', 'conversations', 'settings']

function readPageFromHash(): PageId {
  const raw = window.location.hash.replace('#', '') as PageId
  return PAGE_IDS.includes(raw) ? raw : 'launch'
}

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<PageId>(readPageFromHash())
  const [launchers, setLaunchers] = useState<Launcher[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [agents, setAgents] = useState<AgentDescriptor[]>([])
  const [stats, setStats] = useState<ProjectStats>({ byProject: {}, ungrouped: 0 })
  const [demo, setDemo] = useState(false)
  const [preferences, setPreferences] = useState<ScanPreferences | null>(null)
  const [token, setToken] = useState(0)
  const { theme, toggle } = useTheme()

  // 用 hash 记录当前页，支持深链与刷新后保持位置
  useEffect(() => {
    const onHashChange = (): void => setPage(readPageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const go = (next: PageId): void => {
    setPage(next)
    window.location.hash = next
  }

  const reload = useCallback(async () => {
    const [l, p, a, s, prefs, info] = await Promise.all([
      api.launchers.list(),
      api.projects.list(),
      api.agents.list(),
      api.projects.stats(),
      api.scan.preferences(),
      api.app.info()
    ])
    setLaunchers(l)
    setProjects(p)
    setAgents(a)
    setStats(s)
    setPreferences(prefs)
    setDemo(info.demo)
  }, [])

  useEffect(() => {
    void reload()
    const off = api.onDataChanged(() => {
      setToken((t) => t + 1)
      void reload()
    })
    return off
  }, [reload])

  const totalSessions = agents.reduce((sum, a) => sum + a.sessionCount, 0)
  const enabledCount = launchers.filter((l) => l.enabled).length

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="sparkle" size={17} />
          </span>
          <div>
            <div className="brand-title">Agent Vault</div>
            <div className="brand-sub">项目启动器 · 对话记录</div>
          </div>
        </div>

        <nav className="nav">
          <div className="nav-section">工作区</div>
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => go(item.id)}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
              {item.id === 'launch' && launchers.length > 0 ? (
                <span className="nav-count">{enabledCount}</span>
              ) : null}
              {item.id === 'projects' && projects.length > 0 ? (
                <span className="nav-count">{projects.length}</span>
              ) : null}
              {item.id === 'conversations' && totalSessions > 0 ? (
                <span className="nav-count">{totalSessions}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="stat-row">
            <div className="stat">
              <b>{launchers.length}</b>
              <span>启动项</span>
            </div>
            <div className="stat">
              <b>{projects.length}</b>
              <span>项目</span>
            </div>
            <div className="stat">
              <b>{agents.length}</b>
              <span>Agent</span>
            </div>
          </div>
          <button className="theme-toggle" onClick={toggle}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
            <span>{theme === 'dark' ? '浅色主题' : '深色主题'}</span>
          </button>
        </div>
      </aside>

      <main className="content">
        {demo && <div className="demo-banner"><span>演示模式 · 虚构会话，独立数据目录</span>
          <button className="btn ghost sm" onClick={() => void api.app.demo()}>退出演示并返回个人数据</button></div>}
        {preferences && !preferences.initialized && page !== 'settings' && (
          <ScanSettings agents={agents} onChanged={reload} firstRun />
        )}
        {page === 'launch' && (
          <LaunchPage launchers={launchers} projects={projects} onChanged={reload} />
        )}
        {page === 'projects' && (
          <ProjectsPage
            projects={projects}
            launchers={launchers}
            stats={stats}
            onChanged={reload}
          />
        )}
        {page === 'conversations' && (
          <ConversationsPage agents={agents} projects={projects} stats={stats} token={token} />
        )}
        {page === 'settings' && <SettingsPage agents={agents} onChanged={reload} token={token} />}
      </main>
    </div>
  )
}
