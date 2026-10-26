import { ReactNode, useEffect, useRef, useState } from 'react'
import { ChevronDown, LucideIcon } from 'lucide-react'

export function Section({ title, action, children, className = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel-section ${className}`}>
      <header className="section-head">
        <h3>{title}</h3>
        {action && <div className="section-action">{action}</div>}
      </header>
      <div className="section-body">{children}</div>
    </section>
  )
}

export function IconButton({ icon: Icon, label, onClick, disabled, active, size = 16, className = '' }: {
  icon: LucideIcon; label: string; onClick?: () => void; disabled?: boolean; active?: boolean; size?: number; className?: string
}) {
  return (
    <button type="button" className={`icon-btn ${active ? 'active' : ''} ${className}`} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon size={size} strokeWidth={1.8} />
    </button>
  )
}

export function NumField({ value, onChange, label, suffix, step = 1, min = -1e6, max = 1e6, precision = 1, disabled }: {
  value: number; onChange: (v: number) => void; label: string; suffix?: string; step?: number; min?: number; max?: number; precision?: number; disabled?: boolean
}) {
  const [text, setText] = useState(format(value, precision))
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(format(value, precision)) }, [value, precision])
  const commit = (raw: string) => {
    const n = raw.trim() ? Number(raw.trim()) : NaN
    if (Number.isFinite(n)) { const next = Math.min(max, Math.max(min, n)); setText(format(next, precision)); if (next !== value) onChange(next) }
    else setText(format(value, precision))
  }
  return (
    <label className={`num-field ${disabled ? 'disabled' : ''}`}>
      <span className="num-label">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onFocus={() => { focused.current = true }}
        onBlur={() => { focused.current = false; commit(text) }}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() }
          if (e.key === 'ArrowUp') { e.preventDefault(); const n = text.trim() && Number.isFinite(Number(text)) ? Number(text) : value; onChange(Math.min(max, n + (e.shiftKey ? step * 10 : step))); setText(format(Math.min(max, n + (e.shiftKey ? step * 10 : step)), precision)) }
          if (e.key === 'ArrowDown') { e.preventDefault(); const n = text.trim() && Number.isFinite(Number(text)) ? Number(text) : value; onChange(Math.max(min, n - (e.shiftKey ? step * 10 : step))); setText(format(Math.max(min, n - (e.shiftKey ? step * 10 : step)), precision)) }
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </label>
  )
}

export function format(n: number, precision = 1): string {
  if (!Number.isFinite(n)) return '0'
  const v = Math.round(n * Math.pow(10, precision)) / Math.pow(10, precision)
  return String(v)
}

/** Commit a process value once, so intermediate typing cannot alter linked settings. */
export function ProcessNumber({ value, onChange, min = 0, max = 99, step = 1, ariaLabel, title }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; ariaLabel?: string; title?: string
}) {
  const [text, setText] = useState(String(value))
  const focused = useRef(false), cancelled = useRef(false)
  useEffect(() => { if (!focused.current) setText(String(value)) }, [value])
  return <input type="number" value={text} min={min} max={max} step={step} aria-label={ariaLabel} title={title}
    onFocus={() => { focused.current = true; cancelled.current = false }}
    onChange={e => setText(e.target.value)}
    onBlur={() => {
      focused.current = false
      if (cancelled.current) { cancelled.current = false; setText(String(value)); return }
      const n = text.trim() ? Number(text) : NaN
      if (!Number.isFinite(n)) { setText(String(value)); return }
      const next = Math.min(max, Math.max(min, n))
      setText(String(next)); if (next !== value) onChange(next)
    }}
    onKeyDown={e => {
      if (e.key === 'Enter') e.currentTarget.blur()
      if (e.key === 'Escape') { e.preventDefault(); cancelled.current = true; e.currentTarget.blur() }
    }} />
}

export function Segmented<T extends string>({ options, value, onChange, compact }: { options: { value: T; label: string; icon?: LucideIcon }[]; value: T; onChange: (v: T) => void; compact?: boolean }) {
  return (
    <div className={`segmented ${compact ? 'compact' : ''}`}>
      {options.map(o => {
        const Icon = o.icon
        return (
          <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} title={o.label}>
            {Icon && <Icon size={13} />}
            <span>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label?: string; description?: string }) {
  return (
    <label className={`switch-row ${label ? '' : 'bare'}`}>
      {label && <span className="switch-text"><span>{label}</span>{description && <small>{description}</small>}</span>}
      <button type="button" role="switch" aria-label={label ?? description ?? "Toggle setting"} aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <span className="switch-dot" />
      </button>
    </label>
  )
}

export function Toggle({ active, onClick, icon: Icon, label, hint }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string; hint?: string }) {
  return (
    <button type="button" className={`toggle-tile ${active ? 'on' : ''}`} onClick={onClick} title={hint ?? label}>
      <span className="toggle-icon"><Icon size={15} /></span>
      <span>{label}</span>
      <i className="toggle-led" />
    </button>
  )
}

export function ColorField({ value, onChange, label = 'Color', onHistory }: { value: string; onChange: (v: string) => void; label?: string; onHistory?: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const presets = ['#ff5c35', '#ffb21c', '#63e6c1', '#2b59ff', '#1f9d8b', '#d84c93', '#1d222b', '#f4f0e7', '#ffffff']
  return (
    <div className="color-field" ref={ref}>
      <button type="button" className="color-trigger" onClick={() => setOpen(o => !o)} title={label}>
        <span className="color-chip" style={{ background: value }} />
        <span className="color-hex">{value.toUpperCase()}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="color-popover">
          <div className="color-presets">
            {presets.map(c => <button key={c} type="button" className="preset-swatch" style={{ background: c }} onClick={() => { onChange(c); onHistory?.(); setOpen(false) }} title={c} />)}
          </div>
          <label className="native-color">
            <span>Custom</span>
            <input type="color" value={value} onChange={e => onChange(e.target.value)} onBlur={() => onHistory?.()} />
          </label>
        </div>
      )}
    </div>
  )
}

export function SelectField<T extends string>({ value, options, onChange, ariaLabel }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <label className="select-field">
      <select aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={12} />
    </label>
  )
}

export function EmptyHint({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="empty-hint">
      <span className="empty-icon"><Icon size={19} /></span>
      <div><strong>{title}</strong><p>{body}</p></div>
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>
}
