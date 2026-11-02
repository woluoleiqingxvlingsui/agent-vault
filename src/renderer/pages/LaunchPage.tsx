import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { Launcher, LauncherKind, Project } from '../../shared/types'
import { Badge, Button, EmptyState, Field, IconButton, Modal, Segmented, Switch, ToastStack, useToasts } from '../components/ui'
import { Icon } from '../components/Icon'
import { LauncherIcon } from '../components/LauncherIcon'
import { formatRelative, middleTruncate } from '../format'

interface Props {
  launchers: Launcher[]
  projects: Project[]
  onChanged: () => Promise<void> | void
}

const KIND_LABEL: Record<LauncherKind, string> = { app: '应用', cli: 'CLI', project: '目录' }
const KIND_TONE: Record<LauncherKind, 'accent' | 'ok' | 'info'> = {
  app: 'accent',
  cli: 'ok',
  project: 'info'
}

const emptyDraft = (): Partial<Launcher> => ({
  name: '',
  kind: 'app',
  command: '',
  protocol: 'exec',
  args: [],
  cwd: '',
  projectId: null,
  icon: '',
  enabled: true
})

type ViewMode = 'grid' | 'list'
/** 来源筛选：Agent 入口由应用自动登记，与用户自建启动项分开 */
type Filter = 'all' | 'agent' | LauncherKind | 'disabled'

/** 首次使用引导：只有自动登记的 Agent 入口、还没登记项目时展示 */
const ONBOARDING_STEPS = [
  {
    title: '登记你的项目根目录',
    detail: '在「项目」页登记后，对话记录会按路径最长匹配自动归组，未匹配的进入「未分组」。'
  },
  {
    title: '添加常用的启动项',
    detail: '应用、CLI 命令、项目目录都可以一键启动；CLI 以程序路径 + 参数数组启动，不经过 shell 拼接。'
  },
  {
    title: '确认 Agent 来源路径',
    detail: '在「设置」页核对每个 Agent 的来源路径，点「扫描全部来源」即可导入历史对话。'
  }
]

export default function LaunchPage({ launchers, projects, onChanged }: Props): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [view, setView] = useState<ViewMode>('grid')
  const [filter, setFilter] = useState<Filter>('all')
  const [draft, setDraft] = useState<Partial<Launcher> | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { toasts, push } = useToasts()

  const agentCount = useMemo(() => launchers.filter((l) => l.id.startsWith('agent-')).length, [launchers])

  // Agent 入口由应用自动登记，与用户自建的启动项分开统计，避免两类口径混在一起
  const counts = useMemo(() => {
    const custom = launchers.filter((l) => !l.id.startsWith('agent-'))
    return {
      all: launchers.length,
      agent: agentCount,
      app: custom.filter((l) => l.kind === 'app').length,
      cli: custom.filter((l) => l.kind === 'cli').length,
      project: custom.filter((l) => l.kind === 'project').length,
      disabled: launchers.filter((l) => !l.enabled).length
    }
  }, [launchers, agentCount])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return launchers.filter((l) => {
      const okFilter =
        filter === 'all'
          ? true
          : filter === 'disabled'
            ? !l.enabled
            : filter === 'agent'
              ? l.id.startsWith('agent-')
              : !l.id.startsWith('agent-')
      if (!okFilter) return false
      if (!q) return true
      return [l.name, l.command, l.cwd, l.args.join(' ')].join(' ').toLowerCase().includes(q)
    })
  }, [launchers, search, filter])

  const recent = useMemo(
    () =>
      launchers
        .filter((l) => l.lastLaunchedAt && l.enabled)
        .sort((a, b) => (b.lastLaunchedAt ?? 0) - (a.lastLaunchedAt ?? 0))
        .slice(0, 8),
    [launchers]
  )

  const lastLaunch = recent[0]?.lastLaunchedAt ?? null

  const run = async (item: Launcher): Promise<void> => {
    setBusyId(item.id)
    try {
      const result = await api.launchers.launch(item.id)
      push(
        result.ok ? 'ok' : 'err',
        result.ok ? `已启动「${item.name}」${result.pid ? `（pid ${result.pid}）` : ''}` : `启动「${item.name}」失败：${result.message}`
      )
      await onChanged()
    } catch (err) {
      push('err', `启动「${item.name}」失败：${(err as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    try {
      await api.launchers.save({ ...draft, id: editingId ?? undefined })
      setDraft(null)
      setEditingId(null)
      await onChanged()
      push('ok', '已保存启动项')
    } catch (err) {
      push('err', (err as Error).message)
    }
  }

  const remove = async (item: Launcher): Promise<void> => {
    if (!window.confirm(`确认删除启动项「${item.name}」？`)) return
    await api.launchers.remove(item.id)
    await onChanged()
    push('ok', `已删除启动项「${item.name}」`)
  }

  const toggle = async (item: Launcher): Promise<void> => {
    await api.launchers.setEnabled(item.id, !item.enabled)
    await onChanged()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setEditingId(null)
        setDraft(emptyDraft())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>启动</h1>
          <p className="page-sub">
            集中管理应用、CLI 命令与项目目录，一键启动。CLI 以程序路径 + 参数数组启动，不经过 shell 拼接。
          </p>
        </div>
        <div className="head-actions">
          <div className="search-wrap">
            <Icon name="search" size={14} />
            <input
              className="search"
              placeholder="搜索名称 / 命令 / 路径…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search ? (
              <button className="search-clear" onClick={() => setSearch('')} title="清空">
                <Icon name="close" size={12} />
              </button>
            ) : null}
          </div>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'grid', label: '卡片', icon: 'app' },
              { value: 'list', label: '列表', icon: 'terminal' }
            ]}
          />
          <Button
            variant="primary"
            icon="plus"
            onClick={() => {
              setEditingId(null)
              setDraft(emptyDraft())
            }}
          >
            新增启动项
          </Button>
        </div>
      </header>

      <div className="stat-strip">
        <div className="stat-card">
          <span className="stat-card-icon">
            <Icon name="launch" size={17} />
          </span>
          <div>
            <div className="stat-card-value">{launchers.length}</div>
            <div className="stat-card-label">启动项</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-card-icon">
            <Icon name="check" size={17} />
          </span>
          <div>
            <div className="stat-card-value">{counts.all - counts.disabled}</div>
            <div className="stat-card-label">已启用</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-card-icon">
            <Icon name="sparkle" size={17} />
          </span>
          <div>
            <div className="stat-card-value">{agentCount}</div>
            <div className="stat-card-label">Agent 入口</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-card-icon">
            <Icon name="clock" size={17} />
          </span>
          <div>
            <div className="stat-card-value" style={{ fontSize: 14 }}>
              {lastLaunch ? formatRelative(lastLaunch) : '暂无记录'}
            </div>
            <div className="stat-card-label">最近启动</div>
          </div>
        </div>
      </div>

      {counts.all === counts.agent && projects.length === 0 && (
        <section className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-head">
            <span className="panel-title">三步开始使用</span>
            <span className="muted small">数据只保存在本机，外部 Agent 的原始记录只读</span>
          </div>
          <div className="panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 18 }}>
              {ONBOARDING_STEPS.map((step, index) => (
                <div key={step.title}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        background: 'var(--accent)',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flex: 'none'
                      }}
                    >
                      {index + 1}
                    </span>
                    <b>{step.title}</b>
                  </div>
                  <div className="muted small">{step.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <div className="section-title" style={{ marginBottom: 8 }}>
            <Icon name="clock" size={14} />
            最近使用
          </div>
          <div className="recent-strip">
            {recent.map((item) => (
              <button key={item.id} className="recent-tile" onClick={() => void run(item)}>
                <LauncherIcon launcher={item} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div className="tile-name ellipsis">{item.name}</div>
                  <div className="tile-time">{formatRelative(item.lastLaunchedAt)}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="filter-row">
        {
          ([
            ['all', '全部'],
            ['agent', 'Agent 入口'],
            ['app', '应用'],
            ['cli', 'CLI'],
            ['project', '目录'],
            ['disabled', '已禁用']
          ] as Array<[Filter, string]>)
            // 只显示有内容的分类，避免一排 0 计数
            .filter(([key]) => key === 'all' || counts[key] > 0)
            .map(([key, label]) => (
              <button
                key={key}
                className={`chip ${filter === key ? 'active' : ''}`}
                onClick={() => setFilter(key)}
              >
                {label}
                <span className="chip-count">{counts[key]}</span>
              </button>
            ))
        }
        <span className="grow" />
        <span className="muted small">共 {filtered.length} 项</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="launch"
          title={launchers.length === 0 ? '还没有启动项' : '没有匹配的启动项'}
          hint={
            launchers.length === 0
              ? '点击右上角「新增启动项」添加应用、CLI 命令或项目目录；Agent 入口会在首次启动时自动登记。'
              : '试试更换筛选条件或清空搜索关键词。'
          }
          action={
            launchers.length === 0 ? (
              <Button
                variant="primary"
                icon="plus"
                onClick={() => {
                  setEditingId(null)
                  setDraft(emptyDraft())
                }}
              >
                新增启动项
              </Button>
            ) : undefined
          }
        />
      ) : view === 'grid' ? (
        <div className="launch-grid">
          {filtered.map((item) => (
            <div key={item.id} className={`launch-card ${item.enabled ? '' : 'disabled'}`}>
              <div className="launch-card-top">
                <LauncherIcon launcher={item} size={40} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="launch-card-name">{item.name}</div>
                  <div className="launch-card-kind">
                    <Badge tone={KIND_TONE[item.kind]}>{KIND_LABEL[item.kind]}</Badge>
                  </div>
                </div>
              </div>

              <div className="launch-card-cmd">
                <div className="cmd-name ellipsis" title={item.command}>
                  {commandLabel(item)}
                </div>
                <div className="cmd-path mono ellipsis" title={`${item.command} ${item.args.join(' ')}`}>
                  {middleTruncate(
                    item.args.length > 0
                      ? `${commandTarget(item)} ${item.args.join(' ')}`
                      : commandTarget(item)
                  )}
                </div>
              </div>

              <div className="launch-card-meta">
                <span className="ellipsis" title={item.cwd}>
                  <Icon name="folder" size={11} /> {item.cwd || '未指定工作目录'}
                </span>
                <span className="grow" />
                <span className="flex-none">
                  {item.lastLaunchedAt ? `上次 ${formatRelative(item.lastLaunchedAt)}` : ''}
                </span>
              </div>

              <div className="launch-card-actions">
                <Button
                  variant="primary"
                  size="sm"
                  icon="launch"
                  loading={busyId === item.id}
                  disabled={!item.enabled}
                  onClick={() => void run(item)}
                >
                  启动
                </Button>
                <IconButton
                  icon="edit"
                  label="编辑"
                  onClick={() => {
                    setEditingId(item.id)
                    setDraft({ ...item })
                  }}
                />
                <IconButton icon="trash" label="删除" className="danger" onClick={() => void remove(item)} />
                <span className="grow" />
                <Switch checked={item.enabled} onChange={() => void toggle(item)} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="launch-list">
          {filtered.map((item) => (
            <div key={item.id} className={`launch-row ${item.enabled ? '' : 'disabled'}`}>
              <LauncherIcon launcher={item} size={28} />
              <div className="cell-name" title={item.name}>
                {item.name}
              </div>
              <div className="mono ellipsis" title={`${item.command} ${item.args.join(' ')}`}>
                {middleTruncate(
                  item.args.length > 0
                    ? `${item.command} ${item.args.join(' ')}`
                    : item.command,
                  70
                )}
              </div>
              <div className="mono ellipsis muted" title={item.cwd}>
                {item.cwd || '—'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Badge tone={KIND_TONE[item.kind]}>{KIND_LABEL[item.kind]}</Badge>
                <Switch checked={item.enabled} onChange={() => void toggle(item)} />
                <Button
                  size="sm"
                  variant="soft"
                  icon="launch"
                  loading={busyId === item.id}
                  disabled={!item.enabled}
                  onClick={() => void run(item)}
                >
                  启动
                </Button>
                <IconButton
                  icon="edit"
                  label="编辑"
                  onClick={() => {
                    setEditingId(item.id)
                    setDraft({ ...item })
                  }}
                />
                <IconButton icon="trash" label="删除" className="danger" onClick={() => void remove(item)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <LauncherModal
          draft={draft}
          projects={projects}
          editing={editingId !== null}
          onChange={setDraft}
          onCancel={() => {
            setDraft(null)
            setEditingId(null)
          }}
          onSave={() => void save()}
        />
      )}

      <ToastStack toasts={toasts} />
    </div>
  )
}

function LauncherModal(props: {
  draft: Partial<Launcher>
  projects: Project[]
  editing: boolean
  onChange: (next: Partial<Launcher>) => void
  onCancel: () => void
  onSave: () => void
}): React.JSX.Element {
  const { draft, projects, editing, onChange, onCancel, onSave } = props
  const set = (patch: Partial<Launcher>): void => onChange({ ...draft, ...patch })
  const isProject = draft.kind === 'project'

  const browseExe = async (): Promise<void> => {
    const picked = await api.shell.pickFile([
      { name: '可执行文件', extensions: ['exe', 'cmd', 'bat', 'com', 'js'] }
    ])
    if (picked) set({ command: picked })
  }

  const browseDir = async (): Promise<void> => {
    const picked = await api.shell.pickDirectory()
    if (picked) {
      set(isProject ? { command: picked, cwd: picked } : { cwd: picked })
    }
  }

  return (
    <Modal
      title={editing ? '编辑启动项' : '新增启动项'}
      subtitle={isProject ? '项目目录启动项会用资源管理器打开该目录。' : undefined}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" onClick={onSave}>
            保存
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
        <Field label="名称">
          <input
            value={draft.name ?? ''}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="例如：Codex 桌面端"
          />
        </Field>
        <Field label="类型">
          <select
            value={draft.kind ?? 'app'}
            onChange={(e) => set({ kind: e.target.value as LauncherKind })}
          >
            <option value="app">普通应用</option>
            <option value="cli">CLI 命令</option>
            <option value="project">项目目录</option>
          </select>
        </Field>
      </div>

      <Field label={isProject ? '目录路径' : '可执行文件 / 命令'}>
        <div className="inline">
          <input
            className="mono"
            value={draft.command ?? ''}
            onChange={(e) => set({ command: e.target.value })}
            placeholder={isProject ? 'C:\\path\\to\\project' : 'C:\\path\\to\\app.exe'}
          />
          <Button variant="ghost" onClick={() => void (isProject ? browseDir() : browseExe())}>
            浏览
          </Button>
        </div>
      </Field>

      <Field
        label="参数（每行一个，按数组传递不做 shell 拼接）"
        hint={isProject ? '项目目录类型无需参数。' : undefined}
      >
        <textarea
          value={(draft.args ?? []).join('\n')}
          onChange={(e) => set({ args: e.target.value.split('\n').filter((s) => s.length > 0) })}
          placeholder="--flag&#10;value"
          rows={3}
        />
      </Field>

      <Field label="工作目录" hint="启动前会校验目录是否存在。">
        <div className="inline">
          <input
            className="mono"
            value={draft.cwd ?? ''}
            onChange={(e) => set({ cwd: e.target.value })}
            placeholder="C:\\path\\to\\workdir"
          />
          <Button variant="ghost" onClick={() => void browseDir()}>
            浏览
          </Button>
        </div>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="关联项目（可选）">
          <select
            value={draft.projectId ?? ''}
            onChange={(e) => set({ projectId: e.target.value || null })}
          >
            <option value="">不关联</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="图标 / 标记（可选）">
          <input
            value={draft.icon ?? ''}
            onChange={(e) => set({ icon: e.target.value })}
            placeholder="留空则自动提取文件图标"
          />
        </Field>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.enabled ?? true}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        <span>启用该启动项</span>
      </label>
    </Modal>
  )
}

/** 取可执行文件名；MSIX / 目录类目标直接返回原值 */
function basename(target: string): string {
  if (!target) return '—'
  if (target.startsWith('shell:')) return target.replace(/^shell:AppsFolder\\/, '')
  const parts = target.split(/[\\/]/)
  return parts[parts.length - 1] || target
}

/** 命令区次行：目标所在位置（完整路径或来源说明） */
function commandTarget(item: Launcher): string {
  if (item.kind === 'project') return item.command
  if (item.command.startsWith('shell:')) return 'MSIX 应用（shell:AppsFolder）'
  if (basename(item.command) === item.command) return 'PATH 中查找'
  return item.command
}
/** 命令区首行：目标名称（文件名 / 目录名 / 命令名 / MSIX 应用名） */
function commandLabel(item: Launcher): string {
  if (item.kind === 'project') return basename(item.command) || '项目目录'
  if (item.command.startsWith('shell:')) return item.command.replace(/^shell:AppsFolder\\/, '')
  return basename(item.command)
}

