import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type {
  AgentDescriptor,
  ConversationMessage,
  ConversationSession,
  Project,
  ProjectStats,
  SortDir,
  SortField
} from '../../shared/types'
import { UNGROUPED } from '../../shared/types'
import { Badge, Button, Collapsible, EmptyState, IconButton, Segmented, ToastStack, useToasts } from '../components/ui'
import { Icon } from '../components/Icon'
import { StatusDot } from '../components/LauncherIcon'
import { formatTime } from '../format'

interface Props {
  agents: AgentDescriptor[]
  projects: Project[]
  stats: ProjectStats
  token: number
}

type SortKey = SortField

export default function ConversationsPage({
  agents,
  projects,
  stats,
  token
}: Props): React.JSX.Element {
  const [agentId, setAgentId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('updatedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [sessions, setSessions] = useState<ConversationSession[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{
    session: ConversationSession
    messages: ConversationMessage[]
  } | null>(null)
  const [scanning, setScanning] = useState(false)
  const { toasts, push } = useToasts()

  // 搜索输入做防抖：避免每敲一个字就触发一次全库 LIKE 查询
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(timer)
  }, [search])

  // 请求序号：慢的旧响应不再覆盖新结果
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    const result = await api.sessions.list({
      agentId,
      projectId,
      search: debouncedSearch,
      sortBy,
      sortDir,
      limit: 300
    })
    if (id !== requestId.current) return
    setSessions(result.items)
    setTotal(result.total)
  }, [agentId, projectId, debouncedSearch, sortBy, sortDir])

  useEffect(() => {
    void load()
  }, [load, token])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    void api.sessions
      .get(selectedId)
      .then((result) =>
        setDetail(result as { session: ConversationSession; messages: ConversationMessage[] } | null)
      )
  }, [selectedId, token])

  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]))
    return (id: string | null | undefined): string => (id ? (map.get(id) ?? '未分组') : '未分组')
  }, [projects])

  const agentName = useCallback(
    (id: string): string => agents.find((a) => a.id === id)?.name ?? id,
    [agents]
  )

  const setSessionProject = async (sessionId: string, next: string): Promise<void> => {
    const value = next === 'auto' ? null : next === UNGROUPED ? '' : next
    await api.sessions.setProject(sessionId, value)
    await load()
    const refreshed = await api.sessions.get(sessionId)
    if (refreshed) setDetail(refreshed as never)
    push('ok', next === 'auto' ? '已恢复自动归组' : `已调整归属到「${projectName(value || null)}」`)
  }

  const rescan = async (): Promise<void> => {
    setScanning(true)
    try {
      if (agentId) {
        const { result } = await api.agents.rescan(agentId)
        push(
          result.error ? 'err' : 'ok',
          result.error
            ? `${agentName(agentId)}：${result.error}`
            : `${agentName(agentId)}：新增 ${result.imported}，更新 ${result.updated}，跳过 ${result.skipped}`
        )
      } else {
        const { results } = await api.agents.scanAll()
        const added = results.reduce((s, r) => s + r.imported, 0)
        const failed = results.filter((r) => r.error).length
        push(
          failed ? 'err' : 'ok',
          `扫描完成：新增 ${added} 条会话${failed ? `，${failed} 个来源有问题` : ''}`
        )
      }
      await load()
    } catch (err) {
      push('err', (err as Error).message)
    } finally {
      setScanning(false)
    }
  }

  const totalSessions = agents.reduce((s, a) => s + a.sessionCount, 0)

  return (
    <div className="page conv-page">
      <header className="page-head">
        <div>
          <h1>对话记录</h1>
          <p className="page-sub">
            按 Agent 与项目浏览本地历史。数据全部存储在本机 SQLite，查看已导入记录不需要联网。
          </p>
        </div>
        <div className="head-actions">
          <div className="search-wrap">
            <Icon name="search" size={14} />
            <input
              className="search wide"
              placeholder="搜索标题与正文…"
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
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: 'updatedAt', label: '更新时间' },
              { value: 'createdAt', label: '创建时间' }
            ]}
          />
          <Button
            variant="ghost"
            icon={sortDir === 'desc' ? 'download' : 'upload'}
            onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
            title={sortDir === 'desc' ? '当前降序，点击切为升序' : '当前升序，点击切为降序'}
          >
            {sortDir === 'desc' ? '降序' : '升序'}
          </Button>
          <Button icon="refresh" loading={scanning} onClick={() => void rescan()}>
            {agentId ? `扫描 ${agentName(agentId)}` : '扫描全部'}
          </Button>
        </div>
      </header>

      <div className="conv-toolbar">
        <div className="agent-tabs" style={{ flex: 1 }}>
          <button
            className={`agent-tab ${agentId === null ? 'active' : ''}`}
            onClick={() => setAgentId(null)}
          >
            <Icon name="sparkle" size={13} />
            全部 Agent
            <span className="count">{totalSessions}</span>
          </button>
          {agents.map((a) => (
            <button
              key={a.id}
              className={`agent-tab ${agentId === a.id ? 'active' : ''} ${a.sessionCount === 0 ? 'empty' : ''}`}
              onClick={() => setAgentId(a.id)}
              title={a.capabilities.reasons.join('\n')}
            >
              <StatusDot status={a.capabilities.records} />
              {a.name}
              <span className="count">{a.sessionCount}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="conv-layout">
        <aside className="rail">
          <div className="rail-title">项目</div>
          <button
            className={`rail-item ${projectId === null ? 'active' : ''}`}
            onClick={() => setProjectId(null)}
          >
            <Icon name="projects" size={13} />
            <span>全部项目</span>
            <span className="count">{totalSessions}</span>
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              className={`rail-item ${projectId === p.id ? 'active' : ''}`}
              onClick={() => setProjectId(p.id)}
              title={p.rootPath}
            >
              <Icon name="folder" size={13} />
              <span className="ellipsis">{p.name}</span>
              <span className="count">{stats.byProject[p.id] ?? 0}</span>
            </button>
          ))}
          <button
            className={`rail-item pinned ${projectId === UNGROUPED ? 'active' : ''}`}
            onClick={() => setProjectId(UNGROUPED)}
            title="未匹配到任何项目根目录的会话"
          >
            <Icon name="alert" size={13} />
            <span>未分组</span>
            <span className="count">{stats.ungrouped}</span>
          </button>
        </aside>

        <section className="session-list">
          <div className="muted small" style={{ padding: '2px 4px 6px' }}>
            {total} 条会话
            {sessions.length < total ? `（显示前 ${sessions.length} 条）` : ''}
          </div>
          {sessions.length === 0 ? (
            <EmptyState
              icon="chat"
              title="没有匹配的会话"
              hint="可调整 Agent / 项目筛选或搜索词；也可以在设置页手动扫描来源或导入 JSON / Markdown。"
            />
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                className={`session-item ${selectedId === s.id ? 'active' : ''}`}
                onClick={() => setSelectedId(s.id)}
              >
                <div className="session-title">{s.title || '(无标题)'}</div>
                <div className="session-meta">
                  {agentId === null ? <Badge tone="accent">{agentName(s.agentId)}</Badge> : null}
                  <Badge tone={s.effectiveProjectId ? 'muted' : 'warn'}>
                    {projectName(s.effectiveProjectId)}
                  </Badge>
                  {s.manualProjectId !== null ? (
                    <Badge tone="info" title="已手动指定归属，重新扫描不会覆盖">
                      手动
                    </Badge>
                  ) : null}
                  <span>
                    {formatTime(s.updatedAt ?? s.createdAt)} · {s.messageCount} 条消息
                  </span>
                </div>
              </button>
            ))
          )}
        </section>

        <section className="detail">
          {!detail ? (
            <EmptyState icon="chat" title="选择左侧会话查看详情" hint="支持按项目筛选、搜索正文与时间排序。" />
          ) : (
            <>
              <div className="detail-head">
                <div style={{ minWidth: 0 }}>
                  <div className="detail-title">{detail.session.title || '(无标题)'}</div>
                  <div className="detail-sub">
                    <Badge tone="accent">{agentName(detail.session.agentId)}</Badge>
                    <Badge tone={detail.session.effectiveProjectId ? 'muted' : 'warn'}>
                      {projectName(detail.session.effectiveProjectId)}
                    </Badge>
                    <span>创建 {formatTime(detail.session.createdAt)}</span>
                    <span>更新 {formatTime(detail.session.updatedAt)}</span>
                    <span>{detail.messages.length} 条消息</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                  <span className="muted small">项目归属</span>
                  <select
                    style={{ width: 200 }}
                    value={
                      detail.session.manualProjectId !== null
                        ? detail.session.manualProjectId === ''
                          ? UNGROUPED
                          : detail.session.manualProjectId
                        : 'auto'
                    }
                    onChange={(e) => void setSessionProject(detail.session.id, e.target.value)}
                  >
                    <option value="auto">
                      自动归组（{projectName(detail.session.autoProjectId)}）
                    </option>
                    <option value={UNGROUPED}>强制未分组</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="detail-body">
                <Collapsible
                  title="来源与元数据"
                  meta={`${detail.session.sourcePath || '无来源文件'}`}
                  defaultOpen={false}
                >
                  <dl className="meta-grid">
                    <dt>Agent</dt>
                    <dd>{agentName(detail.session.agentId)}</dd>
                    <dt>外部会话 ID</dt>
                    <dd className="mono">{detail.session.externalId ?? '—'}</dd>
                    <dt>来源文件</dt>
                    <dd className="mono">{detail.session.sourcePath || '—'}</dd>
                    <dt>来源 cwd</dt>
                    <dd className="mono">{detail.session.sourceCwd ?? '—'}</dd>
                    <dt>自动归组</dt>
                    <dd>{projectName(detail.session.autoProjectId)}</dd>
                    <dt>手动覆盖</dt>
                    <dd>
                      {detail.session.manualProjectId === null
                        ? '未设置（跟随自动归组）'
                        : detail.session.manualProjectId === ''
                          ? '强制未分组'
                          : projectName(detail.session.manualProjectId)}
                    </dd>
                    <dt>导入指纹</dt>
                    <dd className="mono">{detail.session.fingerprint}</dd>
                    <dt>原始元数据</dt>
                    <dd className="mono">{JSON.stringify(detail.session.rawMeta)}</dd>
                  </dl>
                  <div style={{ marginTop: 10 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="external"
                      onClick={() => void api.app.openPath(detail.session.sourcePath)}
                    >
                      在资源管理器中显示来源文件
                    </Button>
                  </div>
                </Collapsible>

                {detail.messages.length === 0 ? (
                  <EmptyState icon="chat" title="该会话没有可显示的消息正文" />
                ) : (
                  <div className="messages">
                    {detail.messages.map((m) => (
                      <MessageBubble key={m.id} message={m} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <ToastStack toasts={toasts} />
    </div>
  )
}

const ROLE_LABEL: Record<string, string> = {
  user: '用户',
  assistant: '助手',
  system: '系统',
  tool: '工具',
  developer: '开发者'
}

function MessageBubble({ message }: { message: ConversationMessage }): React.JSX.Element {
  const role = message.role || 'assistant'
  const cls = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : role
  const [copied, setCopied] = useState(false)
  // 超长正文（例如注入的 system-reminder）默认折叠，避免详情页变成一大段噪声
  const isLong = message.content.length > 1200
  const [expanded, setExpanded] = useState(!isLong)

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  }

  return (
    <div className={`msg msg-${cls}`}>
      <div className="msg-head">
        <span className="msg-role">{ROLE_LABEL[role] ?? role}</span>
        {message.createdAt ? <span>{formatTime(message.createdAt)}</span> : null}
        <IconButton
          icon={copied ? 'check' : 'app'}
          label={copied ? '已复制' : '复制内容'}
          onClick={() => void copy(message.content)}
        />
      </div>
      <div className={'msg-body' + (isLong && !expanded ? ' clamped' : '')}>
        <RichText content={message.content} />
      </div>
      {isLong ? (
        <button className="msg-more" onClick={() => setExpanded(!expanded)}>
          <Icon name="chevron" size={12} />
          {expanded ? '收起全文' : '展开全文（' + message.content.length + ' 字符）'}
        </button>
      ) : null}
    </div>
  )
}

type Part =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string; lang: string }
  | { kind: 'hidden'; value: string; label: string }

/** 需要折叠展示的注入标签（Agent 内部提示词，不属于对话正文） */
const HIDDEN_TAGS = ['system-reminder', 'agent-context', 'system_info']

/**
 * 极简渲染：识别 ``` 代码块与 Agent 注入标签，其余按纯文本展示。
 * 不引入 Markdown 解析依赖，也不修改原始数据，只是展示层折叠。
 */
function RichText({ content }: { content: string }): React.JSX.Element {
  const parts = useMemo(() => parseContent(content), [content])

  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === 'code') {
          return (
            <pre key={i} className="md-code">
              <div className="md-code-bar">
                <span>{part.lang || 'code'}</span>
              </div>
              <code>{part.value}</code>
            </pre>
          )
        }
        if (part.kind === 'hidden') {
          return <HiddenBlock key={i} label={part.label} value={part.value} />
        }
        return <span key={i}>{part.value}</span>
      })}
    </>
  )
}

/** 默认折叠的注入内容块，点击可展开查看原文（内容不丢失） */
function HiddenBlock({ label, value }: { label: string; value: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={'hidden-block' + (open ? ' open' : '')}>
      <button type="button" className="hidden-head" onClick={() => setOpen(!open)}>
        <Icon name="eye" size={13} />
        <span>{label} · {value.length} 字符</span>
        <span className="grow" />
        <span className="muted small">{open ? '点击收起' : '点击展开原文'}</span>
      </button>
      {open ? <pre className="md-code"><code>{value}</code></pre> : null}
    </div>
  )
}

function parseContent(content: string): Part[] {
  if (!content.includes('```') && !HIDDEN_TAGS.some((t) => content.includes('<' + t + '>'))) {
    return [{ kind: 'text', value: content }]
  }
  const pattern = new RegExp(
    '```(\\w*)\\n?([\\s\\S]*?)```' +
      '|<(' +
      HIDDEN_TAGS.join('|') +
      ')>([\\s\\S]*?)</\\3>' +
      '|<(' +
      HIDDEN_TAGS.join('|') +
      ')>([\\s\\S]*)$',
    'g'
  )
  const out: Part[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    if (match.index > last) out.push({ kind: 'text', value: content.slice(last, match.index) })
    if (match[2] !== undefined) {
      out.push({ kind: 'code', value: match[2].replace(/\n$/, ''), lang: match[1] || '' })
    } else {
      const tag = match[3] ?? match[5]
      const body = match[4] ?? match[6]
      out.push({ kind: 'hidden', value: body ?? '', label: tag ? '注入内容 <' + tag + '>' : '注入内容' })
    }
    last = match.index + match[0].length
  }
  if (last < content.length) out.push({ kind: 'text', value: content.slice(last) })
  return out
}

