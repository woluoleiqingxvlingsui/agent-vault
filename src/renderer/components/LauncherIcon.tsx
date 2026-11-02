import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Launcher } from '../../shared/types'
import { Icon } from './Icon'
import type { IconName } from './Icon'

/** 主进程提取的原生图标 dataURL 缓存（按目标路径），避免重复 IPC */
const iconCache = new Map<string, string | null>()
const pending = new Set<string>()

function kindIcon(kind: Launcher['kind']): IconName {
  return kind === 'cli' ? 'terminal' : kind === 'project' ? 'folder' : 'app'
}

/** 由名称生成稳定色相，用于无原生图标时的占位底图 */
function hue(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 360
  return h
}

function initials(name: string): string {
  const cleaned = name.trim()
  if (!cleaned) return '?'
  const ascii = cleaned.replace(/[^A-Za-z0-9]/g, '')
  if (ascii.length >= 2) return ascii.slice(0, 2).toUpperCase()
  return cleaned.slice(0, Math.min(2, cleaned.length))
}

/**
 * 启动项图标：优先使用主进程提取的 Windows 原生文件图标，
 * 取不到时回退到类型图标 + 名称首字母占位块。
 */
export function LauncherIcon({
  launcher,
  size = 40
}: {
  launcher: Launcher
  size?: number
}): React.JSX.Element {
  const target = launcher.kind === 'project' ? launcher.command : launcher.command
  const [src, setSrc] = useState<string | null>(() => iconCache.get(target) ?? null)
  const [failed, setFailed] = useState(() => iconCache.get(target) === null)

  useEffect(() => {
    if (iconCache.has(target)) {
      setSrc(iconCache.get(target) ?? null)
      setFailed(iconCache.get(target) === null)
      return
    }
    if (pending.has(target)) return
    pending.add(target)
    let alive = true
    void api.app
      .icon(target)
      .then((dataUrl) => {
        iconCache.set(target, dataUrl ?? null)
        if (!alive) return
        setSrc(dataUrl ?? null)
        setFailed(!dataUrl)
      })
      .catch(() => {
        iconCache.set(target, null)
        if (alive) setFailed(true)
      })
      .finally(() => pending.delete(target))
    return () => {
      alive = false
    }
  }, [target])

  if (launcher.icon && launcher.icon.startsWith('data:')) {
    return <img className="launcher-icon" src={launcher.icon} alt="" style={{ width: size, height: size }} />
  }

  if (src) {
    return (
      <img
        className="launcher-icon"
        src={src}
        alt=""
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    )
  }

  if (!failed && launcher.kind !== 'project' && !launcher.command.startsWith('shell:')) {
    return (
      <span className="launcher-icon placeholder" style={{ width: size, height: size }}>
        <Icon name={kindIcon(launcher.kind)} size={size * 0.45} />
      </span>
    )
  }

  const h = hue(launcher.name || launcher.command)
  return (
    <span
      className="launcher-icon initial"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, size * 0.34),
        background: `linear-gradient(140deg, hsl(${h} 62% 52%), hsl(${(h + 42) % 360} 58% 42%))`
      }}
    >
      {initials(launcher.name || launcher.command)}
    </span>
  )
}

/** 项目卡片用的纯色字母块（项目没有可执行文件图标） */
export function ProjectGlyph({ name, size = 38 }: { name: string; size?: number }): React.JSX.Element {
  const h = hue(name || 'p')
  return (
    <span
      className="project-glyph"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(12, size * 0.34),
        background: `linear-gradient(140deg, hsl(${h} 58% 46%), hsl(${(h + 48) % 360} 52% 38%))`
      }}
    >
      {initials(name)}
    </span>
  )
}

/** Agent 能力状态圆点 */
export function StatusDot({ status }: { status: string }): React.JSX.Element {
  return <span className={`status-dot status-${status}`} />
}
