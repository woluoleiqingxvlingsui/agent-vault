import { useState } from 'react'
import { api } from '../api'
import type { Launcher, Project, ProjectStats } from '../../shared/types'
import { Badge, Button, EmptyState, Field, IconButton, Modal, ToastStack, useToasts } from '../components/ui'
import { Icon } from '../components/Icon'
import { ProjectGlyph } from '../components/LauncherIcon'
import { middleTruncate } from '../format'

interface Props {
  projects: Project[]
  launchers: Launcher[]
  stats: ProjectStats
  onChanged: () => Promise<void> | void
}

const emptyDraft = (): Partial<Project> => ({ name: '', rootPath: '', launcherId: null })

export default function ProjectsPage({
  projects,
  launchers,
  stats,
  onChanged
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState<Partial<Project> | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { toasts, push } = useToasts()

  const browse = async (): Promise<void> => {
    const picked = await api.shell.pickDirectory()
    if (picked && draft) setDraft({ ...draft, rootPath: picked })
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    try {
      await api.projects.save({ ...draft, id: editingId ?? undefined })
      setDraft(null)
      setEditingId(null)
      await onChanged()
      push('ok', '已保存项目，相关会话已按路径最长匹配重新归组')
    } catch (err) {
      push('err', (err as Error).message)
    }
  }

  const remove = async (item: Project): Promise<void> => {
    if (!window.confirm(`确认删除项目「${item.name}」？相关会话将回退到自动归组。`)) return
    await api.projects.remove(item.id)
    await onChanged()
    push('ok', `已删除项目「${item.name}」`)
  }

  const regroup = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.projects.regroup()
      await onChanged()
      push('ok', `已重新归组 ${result.changed} 条会话（手动调整的归属保持不变）`)
    } catch (err) {
      push('err', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>项目</h1>
          <p className="page-sub">
            登记项目根目录后，对话记录按路径最长匹配自动归组；多个项目匹配时归属路径最深的项目，未匹配的进入「未分组」。
          </p>
        </div>
        <div className="head-actions">
          <Button icon="refresh" loading={busy} onClick={() => void regroup()}>
            重新归组全部记录
          </Button>
          <Button
            variant="primary"
            icon="plus"
            onClick={() => {
              setEditingId(null)
              setDraft(emptyDraft())
            }}
          >
            登记项目
          </Button>
        </div>
      </header>

      <div className="stat-strip">
        <div className="stat-card">
          <span className="stat-card-icon">
            <Icon name="projects" size={17} />
          </span>
          <div>
            <div className="stat-card-value">{projects.length}</div>
            <div className="stat-card-label">已登记项目</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-card-icon">
            <Icon name="chat" size={17} />
          </span>
          <div>
            <div className="stat-card-value">
              {Object.values(stats.byProject).reduce((a, b) => a + b, 0)}
            </div>
            <div className="stat-card-label">已归组会话</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-card-icon">
            <Icon name="folder" size={17} />
          </span>
          <div>
            <div className="stat-card-value">{stats.ungrouped}</div>
            <div className="stat-card-label">未分组会话</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-card-icon">
            <Icon name="launch" size={17} />
          </span>
          <div>
            <div className="stat-card-value">
              {projects.filter((p) => p.launcherId).length}
            </div>
            <div className="stat-card-label">带启动配置</div>
          </div>
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon="projects"
          title="还没有登记任何项目"
          hint="登记项目根目录后，落在该目录下的对话记录会自动归入对应项目；也可以在会话详情中手动调整归属。"
          action={
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setEditingId(null)
                setDraft(emptyDraft())
              }}
            >
              登记项目
            </Button>
          }
        />
      ) : (
        <div className="project-grid">
          {projects.map((item) => {
            const count = stats.byProject[item.id] ?? 0
            const launcher = item.launcherId
              ? launchers.find((l) => l.id === item.launcherId)
              : undefined
            return (
              <div key={item.id} className="project-card">
                <div className="project-card-top">
                  <ProjectGlyph name={item.name} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="project-name ellipsis">{item.name}</div>
                    <div className="muted small">{count} 条会话</div>
                  </div>
                  {launcher ? (
                    <Badge tone="accent" title={launcher.command}>
                      <Icon name="launch" size={11} /> {launcher.name}
                    </Badge>
                  ) : (
                    <Badge tone="muted">无启动配置</Badge>
                  )}
                </div>

                <div className="project-path ellipsis" title={item.rootPath}>
                  {middleTruncate(item.rootPath, 46)}
                </div>

                <div className="project-card-foot">
                  <Button
                    size="sm"
                    variant="soft"
                    icon="external"
                    onClick={() => void api.projects.reveal(item.rootPath)}
                  >
                    打开目录
                  </Button>
                  {launcher ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="launch"
                      onClick={async () => {
                        const result = await api.launchers.launch(launcher.id)
                        push(
                          result.ok ? 'ok' : 'err',
                          result.ok ? `已启动「${launcher.name}」` : `启动失败：${result.message}`
                        )
                        await onChanged()
                      }}
                    >
                      启动
                    </Button>
                  ) : null}
                  <span className="grow" />
                  <IconButton
                    icon="edit"
                    label="编辑"
                    onClick={() => {
                      setEditingId(item.id)
                      setDraft({ ...item })
                    }}
                  />
                  <IconButton
                    icon="trash"
                    label="删除"
                    className="danger"
                    onClick={() => void remove(item)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {draft && (
        <Modal
          title={editingId ? '编辑项目' : '登记项目'}
          subtitle="保存后会自动对全部会话重新计算归组（手动归属不受影响）。"
          onClose={() => {
            setDraft(null)
            setEditingId(null)
          }}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(null)
                  setEditingId(null)
                }}
              >
                取消
              </Button>
              <Button variant="primary" onClick={() => void save()}>
                保存
              </Button>
            </>
          }
        >
          <Field label="项目名称">
            <input
              value={draft.name ?? ''}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="例如：番茄钟"
            />
          </Field>
          <Field label="根目录" hint="会话的 cwd / 来源路径落在该目录下（含子目录）时自动归入此项目。">
            <div className="inline">
              <input
                className="mono"
                value={draft.rootPath ?? ''}
                onChange={(e) => setDraft({ ...draft, rootPath: e.target.value })}
                placeholder="C:\\Users\\you\\code\\project"
              />
              <Button variant="ghost" onClick={() => void browse()}>
                浏览
              </Button>
            </div>
          </Field>
          <Field label="启动配置（可选）">
            <select
              value={draft.launcherId ?? ''}
              onChange={(e) => setDraft({ ...draft, launcherId: e.target.value || null })}
            >
              <option value="">不关联</option>
              {launchers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </Modal>
      )}

      <ToastStack toasts={toasts} />
    </div>
  )
}
