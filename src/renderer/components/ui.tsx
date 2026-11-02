import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

/* ------------------------------------------------------------------ 徽章 */

export type BadgeTone = 'accent' | 'ok' | 'warn' | 'err' | 'muted' | 'info'

export function Badge({
  tone = 'muted',
  children,
  title
}: {
  tone?: BadgeTone
  children: React.ReactNode
  title?: string
}): React.JSX.Element {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ 按钮 */

export function Button({
  variant = 'ghost',
  size = 'md',
  icon,
  loading = false,
  children,
  ...rest
}: {
  variant?: 'primary' | 'ghost' | 'soft' | 'danger'
  size?: 'sm' | 'md'
  icon?: IconName
  loading?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button className={`btn ${variant} ${size}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} size={size === 'sm' ? 13 : 15} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  )
}

export function IconButton({
  icon,
  label,
  ...rest
}: { icon: IconName; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button className="icon-btn" title={label} aria-label={label} {...rest}>
      <Icon name={icon} size={15} />
    </button>
  )
}

/* -------------------------------------------------------------- 分段控件 */

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string; icon?: IconName }>
  onChange: (next: T) => void
}): React.JSX.Element {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`segmented-item ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon ? <Icon name={opt.icon} size={14} /> : null}
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ 开关 */

export function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      title={checked ? '已启用，点击禁用' : '已禁用，点击启用'}
    >
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
      {label ? <span className="switch-label">{label}</span> : null}
    </button>
  )
}

/* ------------------------------------------------------------------ 字段 */

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

/* ------------------------------------------------------------------ 弹窗 */

export function Modal({
  title,
  subtitle,
  onClose,
  footer,
  children,
  width = 560
}: {
  title: string
  subtitle?: string
  onClose: () => void
  footer?: React.ReactNode
  children: React.ReactNode
  width?: number
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p className="muted small">{subtitle}</p> : null}
          </div>
          <IconButton icon="close" label="关闭" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- 空状态 */

export function EmptyState({
  icon = 'sparkle',
  title,
  hint,
  action
}: {
  icon?: IconName
  title: string
  hint?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={22} />
      </div>
      <p className="empty-title">{title}</p>
      {hint ? <p className="muted small">{hint}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  )
}

/* ---------------------------------------------------------------- 提示条 */

export interface ToastItem {
  id: number
  kind: 'ok' | 'err' | 'info'
  text: string
}

export function useToasts(): {
  toasts: ToastItem[]
  push: (kind: ToastItem['kind'], text: string) => void
} {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const timers = useRef<number[]>([])

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  const push = (kind: ToastItem['kind'], text: string): void => {
    const id = ++seq.current
    setToasts((list) => [...list.slice(-2), { id, kind, text }])
    const timer = window.setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id))
    }, kind === 'err' ? 7000 : 4000)
    timers.current.push(timer)
  }

  return { toasts, push }
}

export function ToastStack({ toasts }: { toasts: ToastItem[] }): React.JSX.Element | null {
  if (!toasts.length) return null
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === 'ok' ? 'check' : t.kind === 'err' ? 'alert' : 'sparkle'} size={14} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------ 可折叠区块 */

export function Collapsible({
  title,
  meta,
  children,
  defaultOpen = false
}: {
  title: string
  meta?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`collapsible ${open ? 'open' : ''}`}>
      <button type="button" className="collapsible-head" onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={14} />
        <span>{title}</span>
        {meta ? <span className="muted small">{meta}</span> : null}
      </button>
      {open ? <div className="collapsible-body">{children}</div> : null}
    </div>
  )
}
