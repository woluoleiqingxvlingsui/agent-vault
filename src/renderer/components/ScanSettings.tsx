import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { AgentDescriptor, ScanPreferences } from '../../shared/types'
import { Button } from './ui'

export default function ScanSettings({ agents, onChanged, firstRun = false }: {
  agents: AgentDescriptor[]; onChanged: () => void | Promise<void>; firstRun?: boolean
}): React.JSX.Element {
  const [prefs, setPrefs] = useState<ScanPreferences | null>(null)
  const [ids, setIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [demo, setDemo] = useState(false)
  const initialized = useRef(false)
  useEffect(() => {
    if (!agents.length || initialized.current) return
    initialized.current = true
    void Promise.all([api.scan.preferences(), api.app.info()]).then(([value, info]) => {
      setPrefs(value); setDemo(info.demo)
      setIds(value.initialized ? value.agentIds : agents.filter((a) => a.sourceAvailable && a.recordSupport !== 'none').map((a) => a.id))
    }).catch((err) => setError(String(err)))
  }, [agents])
  const save = async (paused: boolean, selected = ids): Promise<void> => {
    setBusy(true); setError('')
    try {
      setPrefs(await api.scan.configure({ initialized: true, paused, agentIds: selected }))
      await onChanged()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <section className="panel scan-settings" style={{ margin: firstRun ? 24 : '0 0 24px', padding: 18 }}>
      <h2>{firstRun ? '首次使用：选择要汇总的记录' : '扫描范围与自动扫描'}</h2>
      <p className="muted">会话正文将复制到本机数据库，未加密保存。外部 Agent 的原始文件只读访问。请仅勾选你希望汇总的来源。</p>
      {demo ? <p>当前是独立演示模式，不读取真实 Agent 记录。</p> : <>
        <div className="scan-options">
          {agents.filter((a) => a.recordSupport !== 'none').map((a) => (
            <label key={a.id}><input type="checkbox" checked={ids.includes(a.id)} disabled={busy}
              onChange={(event) => setIds((old) => event.target.checked ? [...old, a.id] : old.filter((id) => id !== a.id))} />
              {a.name}{!a.sourceAvailable ? '（需配置来源）' : ''}</label>
          ))}
        </div>
        <p className="muted small">{prefs?.initialized ? prefs.paused ? '自动扫描已暂停。正在执行的扫描会完成；仍可手动扫描已选来源。' : '自动扫描已开启。取消勾选不会删除已经导入的会话。' : '确认之前不会读取会话正文。也可以暂不扫描，稍后在设置中开启。'}</p>
        <div className="row-actions">
          <Button loading={busy} disabled={!prefs} variant="primary" onClick={() => void save(false)}>保存范围并开始扫描</Button>
          <Button loading={busy} disabled={!prefs} onClick={() => void save(true, prefs?.initialized ? prefs.agentIds : [])}>
            {prefs?.initialized ? '暂停自动扫描' : '暂不扫描'}
          </Button>
        </div>
      </>}
      {error && <p className="err-text">{error}</p>}
    </section>
  )
}
