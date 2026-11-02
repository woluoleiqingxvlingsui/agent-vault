import { useEffect, useState } from 'react'
import { api } from '../api'
import type { AgentDescriptor, AppInfo, ScanResult } from '../../shared/types'
import { Badge, Button, Collapsible, ToastStack, useToasts } from '../components/ui'
import { Icon } from '../components/Icon'
import ScanSettings from '../components/ScanSettings'
import AgentLaunchEditor from '../components/AgentLaunchEditor'
import { StatusDot } from '../components/LauncherIcon'

interface Props {
  agents: AgentDescriptor[]
  onChanged: () => Promise<void> | void
  token: number
}

const STATUS_LABEL: Record<string, string> = {
  launchable: '可启动',
  importable: '可导入',
  watchable: '可增量扫描',
  needs_config: '需配置路径',
  unsupported: '无法验证'
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'err' | 'muted'> = {
  launchable: 'ok',
  importable: 'ok',
  watchable: 'ok',
  needs_config: 'warn',
  unsupported: 'err'
}

export default function SettingsPage({ agents, onChanged }: Props): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [sources, setSources] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [lastScan, setLastScan] = useState<ScanResult[] | null>(null)
  const { toasts, push } = useToasts()

  useEffect(() => {
    void api.app.info().then(setInfo)
  }, [])

  // 只为尚未初始化的 Agent 填入默认值：
// 列表刷新（扫描、启动等）不能把用户正在编辑的来源路径清空
  useEffect(() => {
    setSources((prev) => {
      const next = { ...prev }
      let changed = false
      for (const a of agents) {
        if (next[a.id] === undefined) {
          next[a.id] = a.configuredSource || a.discoveredSources[0] || ''
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [agents])

  const saveSource = async (agentId: string): Promise<void> => {
    try {
      await api.agents.setSource(agentId, sources[agentId] ?? '')
      await onChanged()
      push('ok', `已更新 ${agentId} 的来源路径`)
    } catch (err) {
      push('err', (err as Error).message)
    }
  }

  const rescan = async (agentId: string): Promise<void> => {
    setBusy(agentId)
    try {
      const { result } = await api.agents.rescan(agentId)
      push(
        result.error ? 'err' : 'ok',
        result.error
          ? `${agentId}：${result.error}`
          : `${agentId}：新增 ${result.imported}，更新 ${result.updated}，跳过 ${result.skipped}`
      )
      await onChanged()
    } catch (err) {
      push('err', (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const scanAll = async (): Promise<void> => {
    setBusy('__all__')
    try {
      const { results } = await api.agents.scanAll()
      setLastScan(results)
      const added = results.reduce((s, r) => s + r.imported, 0)
      const failed = results.filter((r) => r.error).length
      push(failed ? 'err' : 'ok', `扫描完成：新增 ${added} 条会话${failed ? `，${failed} 个来源有问题` : ''}`)
      await onChanged()
    } catch (err) {
      push('err', (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const doExport = async (format: 'json' | 'markdown'): Promise<void> => {
    try {
      const result = await api.io.export(format, null)
      if (result?.canceled) return
      push('ok', `已导出 ${result.count} 条会话到 ${result.filePath}`)
    } catch (err) {
      push('err', (err as Error).message)
    }
  }

  const doImport = async (format: 'json' | 'markdown'): Promise<void> => {
    try {
      const picked = await api.shell.pickFile(
        format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
      )
      if (!picked) return
      const response = await api.io.import(picked, format)
      if (!response.ok) {
        push('err', response.error)
        return
      }
      const result = response.result
      push(result.failed ? 'err' : 'ok',
        `导入完成：新增 ${result.imported}，更新 ${result.updated}，跳过 ${result.skipped}，失败 ${result.failed}` +
        (result.errors.length ? `。${result.errors.slice(0, 3).join('；')}` : ''))
      await onChanged()
    } catch (err) {
      push('err', (err as Error).message)
    }
  }

  const doBackup = async (): Promise<void> => {
    try {
      const result = await api.io.backup()
      if (result.canceled) return
      push('ok', `已备份到 ${result.filePath}`)
    } catch (err) {
      push('err', (err as Error).message)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>设置</h1>
          <p className="page-sub">
            Agent 来源路径、能力状态、扫描与导入导出、本地数据备份。能力状态全部来自本机实际探测与验证。
          </p>
        </div>
        <div className="head-actions">
          <Button variant="primary" icon="refresh" loading={busy === '__all__'} onClick={() => void scanAll()}>
            扫描全部来源
          </Button>
        </div>
      </header>

      <ScanSettings agents={agents} onChanged={onChanged} />
      <section>
        <div className="section-title" style={{ marginBottom: 8 }}>
          <Icon name="sparkle" size={14} />
          Agent 来源与能力状态
          <span className="muted small">（{agents.length} 个）</span>
        </div>
        <div className="settings-grid">
          {agents.map((a) => (
            <div key={a.id} className="agent-card">
              <div className="agent-card-top">
                <div style={{ minWidth: 0 }}>
                  <div className="agent-name">{a.name}</div>
                  <div className="agent-vendor">
                    {a.vendor} · {a.surface === 'cli' ? 'CLI' : '桌面端'} · 已导入 {a.sessionCount} 条
                  </div>
                </div>
                <StatusDot status={a.capabilities.records} />
              </div>

              <div className="cap-row">
                <Badge
                  tone={STATUS_TONE[a.capabilities.launch]}
                  title={a.capabilities.reasons.filter((r) => r.startsWith('启动')).join('\n')}
                >
                  启动：{STATUS_LABEL[a.capabilities.launch]}
                </Badge>
                <Badge
                  tone={STATUS_TONE[a.capabilities.records]}
                  title={a.capabilities.reasons.filter((r) => r.startsWith('记录')).join('\n')}
                >
                  记录：{STATUS_LABEL[a.capabilities.records]}
                </Badge>
              </div>

              <div>
                <div className="field-label" style={{ marginBottom: 5 }}>
                  来源路径
                </div>
                <div className="source-input">
                  <input
                    className="mono"
                    value={sources[a.id] ?? ''}
                    onChange={(e) => setSources({ ...sources, [a.id]: e.target.value })}
                    placeholder={a.discoveredSources[0] ?? '未探测到来源路径'}
                    title={sources[a.id] || a.sourceHint}
                  />
                  <Button size="sm" onClick={async () => {
                    const picked = a.recordSupport === 'sqlite' ? await api.shell.pickFile() : await api.shell.pickDirectory()
                    if (picked) setSources((prev) => ({ ...prev, [a.id]: picked }))
                  }}>浏览</Button>
                  <Button size="sm" variant="ghost" onClick={() => void saveSource(a.id)}>
                    保存
                  </Button>
                </div>
              </div>

              <div className="hint-text">{a.sourceHint}</div>

              <div className="scan-line">
                <Icon name="clock" size={12} />
                {a.lastScanAt
                  ? `最近扫描 ${new Date(a.lastScanAt).toLocaleString()}`
                  : '尚未扫描'}
              </div>
              {a.lastError ? <div className="err-text">{a.lastError}</div> : null}

              <Collapsible title="编辑启动配置与能力原因">
                <AgentLaunchEditor agent={a} onChanged={onChanged} />
                <dl className="meta-grid">
                  <dt>启动命令</dt>
                  <dd className="mono">{a.launchCommand}</dd>
                  <dt>参数</dt>
                  <dd className="mono">{a.launchArgs.length ? a.launchArgs.join(' ') : '—'}</dd>
                  <dt>工作目录</dt>
                  <dd className="mono">{a.launchCwd || '—'}</dd>
                  <dt>协议</dt>
                  <dd>{a.launchProtocol === 'appsfolder' ? 'MSIX (shell:AppsFolder)' : '直接执行'}</dd>
                  <dt>发现结果</dt>
                  <dd className="mono">
                    {a.discoveredSources.length ? a.discoveredSources.join('\n') : '未发现'}
                  </dd>
                  <dt>说明</dt>
                  <dd>{a.launchNote || '—'}</dd>
                  <dt>能力原因</dt>
                  <dd>
                    {a.capabilities.reasons.length ? (
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {a.capabilities.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    ) : (
                      '—'
                    )}
                  </dd>
                </dl>
              </Collapsible>

              <div className="project-card-foot">
                <Button
                  size="sm"
                  variant="soft"
                  icon="refresh"
                  loading={busy === a.id}
                  onClick={() => void rescan(a.id)}
                >
                  重新扫描
                </Button>
                <span className="grow" />
                <Button
                  size="sm"
                  variant="ghost"
                  icon="launch"
                  onClick={async () => {
                    const result = await api.launchers.launch(`agent-${a.id}`)
                    push(
                      result.ok ? 'ok' : 'err',
                      result.ok ? `已启动 ${a.name}` : `启动失败：${result.message}`
                    )
                  }}
                >
                  启动
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {lastScan && (
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">最近一次扫描结果</span>
            <span className="muted small">
              新增 {lastScan.reduce((s, r) => s + r.imported, 0)} · 跳过{' '}
              {lastScan.reduce((s, r) => s + r.skipped, 0)}
            </span>
          </div>
          <div className="panel-body">
            <table className="result-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>发现</th>
                  <th>新增</th>
                  <th>更新</th>
                  <th>跳过</th>
                  <th>失败</th>
                  <th>耗时</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {lastScan.map((r) => (
                  <tr key={r.agentId}>
                    <td>{r.agentId}</td>
                    <td>{r.discovered}</td>
                    <td>{r.imported}</td>
                    <td>{r.updated}</td>
                    <td>{r.skipped}</td>
                    <td>{r.failed}</td>
                    <td>{r.durationMs} ms</td>
                    <td className={r.error ? 'err-text' : 'muted small'}>{r.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">导入 / 导出</span>
          <span className="muted small">重复导入同一文件不会产生副本</span>
        </div>
        <div className="panel-body">
          <div className="io-grid">
            <div className="io-card">
              <span className="io-card-icon">
                <Icon name="download" size={16} />
              </span>
              <div>
                <div className="io-card-title">导出 JSON</div>
                <div className="io-card-desc">会话交换，含项目、消息与来源元数据（不含启动项和设置）</div>
              </div>
              <Button size="sm" className="grow" onClick={() => void doExport('json')}>
                导出
              </Button>
            </div>
            <div className="io-card">
              <span className="io-card-icon">
                <Icon name="download" size={16} />
              </span>
              <div>
                <div className="io-card-title">导出 Markdown</div>
                <div className="io-card-desc">人工可读交换格式</div>
              </div>
              <Button size="sm" className="grow" onClick={() => void doExport('markdown')}>
                导出
              </Button>
            </div>
            <div className="io-card">
              <span className="io-card-icon">
                <Icon name="upload" size={16} />
              </span>
              <div>
                <div className="io-card-title">导入 JSON</div>
                <div className="io-card-desc">可在空数据目录恢复归属</div>
              </div>
              <Button size="sm" className="grow" onClick={() => void doImport('json')}>
                导入
              </Button>
            </div>
            <div className="io-card">
              <span className="io-card-icon">
                <Icon name="upload" size={16} />
              </span>
              <div>
                <div className="io-card-title">导入 Markdown</div>
                <div className="io-card-desc">自动登记涉及的项目</div>
              </div>
              <Button size="sm" className="grow" onClick={() => void doImport('markdown')}>
                导入
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">本地数据</span>
          <span className="muted small">数据仅保存在本机，查看已导入记录无需联网</span>
        </div>
        <div className="panel-body">
          <dl className="meta-grid">
            <dt>数据目录</dt>
            <dd className="mono">{info?.dataDir ?? '—'}</dd>
            <dt>数据库文件</dt>
            <dd className="mono">{info?.dbFile ?? '—'}</dd>
            <dt>应用版本</dt>
            <dd>
              {info?.version ?? '—'}（Electron {info?.electron ?? '—'}）
            </dd>
          </dl>
          <div className="row-actions" style={{ marginTop: 12 }}>
            <Button variant="primary" icon="database" onClick={() => void doBackup()}>
              完整备份数据库
            </Button>
            <Button onClick={async () => {
              try { await api.io.restore() } catch (err) { push('err', (err as Error).message) }
            }}>从完整备份恢复</Button>
            <Button onClick={() => void api.app.demo()}>
              {info?.demo ? '退出演示并返回个人数据' : '打开独立演示模式'}
            </Button>
            <Button variant="ghost" icon="external" onClick={() => void api.app.revealDataDir()}>
              打开数据目录
            </Button>
          </div>
        </div>
      </section>

      <ToastStack toasts={toasts} />
    </div>
  )
}
