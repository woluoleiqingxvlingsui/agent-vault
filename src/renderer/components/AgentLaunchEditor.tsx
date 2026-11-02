import { useState } from 'react'
import type { AgentDescriptor } from '../../shared/types'
import { api } from '../api'
import { Button, Field } from './ui'

export default function AgentLaunchEditor({ agent, onChanged }: {
  agent: AgentDescriptor; onChanged: () => void | Promise<void>
}): React.JSX.Element {
  const [command, setCommand] = useState(agent.launchCommand)
  const [args, setArgs] = useState(agent.launchArgs.join('\n'))
  const [cwd, setCwd] = useState(agent.launchCwd)
  const [protocol, setProtocol] = useState(agent.launchProtocol)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (test = false): Promise<void> => {
    setBusy(true)
    try {
      const id = `agent-${agent.id}`
      const existing = (await api.launchers.list()).find((l) => l.id === id)
      await api.launchers.save({ ...existing, id, name: existing?.name ?? agent.name,
        kind: existing?.kind ?? (agent.surface === 'cli' ? 'cli' : 'app'), command, protocol,
        args: args.split('\n').filter(Boolean), cwd })
      setMessage(test ? (await api.launchers.launch(id)).message : '启动配置已保存，重启后继续生效')
      await onChanged()
    } catch (err) { setMessage((err as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="agent-editor">
    <Field label="启动方式"><select value={protocol} onChange={(e) => setProtocol(e.target.value as typeof protocol)}>
      <option value="exec">程序或 CLI 命令</option><option value="appsfolder">Windows MSIX 应用 ID</option>
    </select></Field>
    <Field label="启动命令"><input value={command} onChange={(e) => setCommand(e.target.value)} />
      {protocol === 'exec' && <Button size="sm" onClick={async () => { const picked = await api.shell.pickFile(); if (picked) setCommand(picked) }}>选择程序</Button>}
    </Field>
    <Field label="参数（一行一个）"><textarea rows={3} value={args} onChange={(e) => setArgs(e.target.value)} placeholder={'例如：\n--port\n3000'} /></Field>
    <Field label="工作目录"><input value={cwd} onChange={(e) => setCwd(e.target.value)} />
      <Button size="sm" onClick={async () => { const picked = await api.shell.pickDirectory(); if (picked) setCwd(picked) }}>选择目录</Button>
    </Field>
    <div className="row-actions"><Button loading={busy} onClick={() => void save()}>保存启动配置</Button>
      <Button loading={busy} onClick={() => void save(true)}>保存并测试启动</Button></div>
    {message && <p role="status">{message}</p>}
  </div>
}
