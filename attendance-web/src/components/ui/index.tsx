// ============================================================================
// UI Kit — component dùng chung (Button, Card, Input, Badge, Modal, ...).
// ============================================================================
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode,
  type HTMLAttributes } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Loader2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { initials, colorFromString } from '@/lib/format'
import type { LabelMeta } from '@/constants/enums'

/* -------------------------------- Button ---------------------------------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type Size = 'sm' | 'md' | 'lg' | 'icon'

const variantClass: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
  secondary: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 shadow-sm',
  success: 'bg-success-600 text-white hover:bg-success-700 shadow-sm',
}
const sizeClass: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
  icon: 'h-10 w-10',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition active:scale-[0.98]',
        'focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:pointer-events-none disabled:opacity-50',
        variantClass[variant], sizeClass[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

/* --------------------------------- Card ----------------------------------- */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl bg-white shadow-card ring-1 ring-slate-200/70', className)} {...rest}>{children}</div>
}
export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="flex items-center gap-3">
        {icon && <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-600">{icon}</div>}
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...rest}>{children}</div>
}

/* -------------------------------- Inputs ---------------------------------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: string }>(
  ({ label, error, hint, className, id, ...rest }, ref) => (
    <div>
      {label && <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>}
      <input ref={ref} id={id} className={cn(
        'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition',
        'focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 disabled:bg-slate-50',
        error ? 'border-danger-500' : 'border-slate-300', className,
      )} {...rest} />
      {error ? <p className="mt-1 text-xs text-danger-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  ),
)
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }>(
  ({ label, error, className, id, ...rest }, ref) => (
    <div>
      {label && <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>}
      <textarea ref={ref} id={id} className={cn(
        'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition',
        'focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500',
        error ? 'border-danger-500' : 'border-slate-300', className,
      )} {...rest} />
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
    </div>
  ),
)
Textarea.displayName = 'Textarea'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string }>(
  ({ label, error, className, id, children, ...rest }, ref) => (
    <div>
      {label && <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>}
      <div className="relative">
        <select ref={ref} id={id} className={cn(
          'w-full appearance-none rounded-lg border bg-white px-3 py-2 pr-9 text-sm text-slate-800 outline-none transition',
          'focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500',
          error ? 'border-danger-500' : 'border-slate-300', className,
        )} {...rest}>{children}</select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
    </div>
  ),
)
Select.displayName = 'Select'

/* -------------------------------- Badge ----------------------------------- */
type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted'
const toneBg: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  info: 'bg-info-50 text-info-600',
  muted: 'bg-slate-100 text-slate-500',
}
export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', toneBg[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  )
}

/* ------------------------------- Spinner ---------------------------------- */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-brand-500', className)} />
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} />
}

/* ------------------------------ EmptyState -------------------------------- */
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      {icon && <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">{icon}</div>}
      <div>
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/* ------------------------------- StatCard ---------------------------------- */
export function StatCard({ label, value, icon, tone = 'brand', hint, onClick }: {
  label: string; value: ReactNode; icon: ReactNode; tone?: Tone; hint?: string; onClick?: () => void
}) {
  const iconBg: Record<Tone, string> = {
    neutral: 'bg-slate-100 text-slate-600', brand: 'bg-brand-50 text-brand-600',
    success: 'bg-success-50 text-success-600', warning: 'bg-warning-50 text-warning-600',
    danger: 'bg-danger-50 text-danger-600', info: 'bg-info-50 text-info-600', muted: 'bg-slate-100 text-slate-500',
  }
  return (
    <Card className={cn('p-4 transition hover:shadow-soft', onClick && 'cursor-pointer')} {...(onClick ? { onClick } : {})}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1.5 text-2xl font-bold text-slate-800">{value}</p>
          {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
        </div>
        <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', iconBg[tone])}>{icon}</div>
      </div>
    </Card>
  )
}

/* -------------------------------- Avatar ---------------------------------- */
export function Avatar({ name, src, size = 'md', className }: { name: string; src?: string | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sz = size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-12 w-12 text-base' : 'h-10 w-10 text-sm'
  if (src) return <img src={src} alt={name} className={cn('rounded-full object-cover ring-2 ring-white', sz, className)} />
  return (
    <div className={cn('grid place-items-center rounded-full font-semibold text-white ring-2 ring-white', sz, className)}
      style={{ background: colorFromString(name) }}>
      {initials(name)}
    </div>
  )
}

/* ------------------------------ PageHeader -------------------------------- */
export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: string; actions?: ReactNode; back?: () => void }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {back && <button onClick={back} className="mb-1 text-xs font-medium text-brand-600 hover:underline">← Quay lại</button>}
        <h1 className="text-xl font-bold text-slate-800">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

/* --------------------------------- Tabs ----------------------------------- */
export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: ReactNode; count?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={cn('relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition',
            active === t.key ? 'text-brand-700' : 'text-slate-500 hover:text-slate-700')}>
          {t.label}
          {t.count != null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
          {active === t.key && <motion.div layoutId="tab-underline" className="absolute inset-x-0 -bottom-px h-0.5 bg-brand-600" />}
        </button>
      ))}
    </div>
  )
}

/* --------------------------------- Modal ---------------------------------- */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const w = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size]
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.98 }}
            className={cn('relative w-full rounded-t-2xl bg-white shadow-pop sm:rounded-2xl', w)}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-800">{title}</h3>
              <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/* ----------------------------- ConfirmDialog ------------------------------ */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmText = 'Xác nhận', danger }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string; confirmText?: string; danger?: boolean
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Hủy</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }}>{confirmText}</Button>
      </>}>
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  )
}

/* ------------------------------- DataTable -------------------------------- */
export function Table({ headers, children, className }: { headers: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/50 text-left">
            {headers.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  )
}
export function Tr({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return <tr onClick={onClick} className={cn('transition hover:bg-slate-50', onClick && 'cursor-pointer', className)}>{children}</tr>
}
export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('whitespace-nowrap px-4 py-3 text-slate-700', className)}>{children}</td>
}

/* --------------------------- StatusBadge (enum) -------------------------- */
export function StatusBadge<T extends string | number>({ map, value }: { map: Record<T, LabelMeta>; value: T }) {
  const meta = map[value]
  if (!meta) return <Badge>{String(value)}</Badge>
  return <Badge tone={meta.tone as Tone}>{meta.label}</Badge>
}

/* ------------------------------ ProgressBar ------------------------------- */
export function ProgressBar({ value, tone = 'brand', className }: { value: number; tone?: Tone; className?: string }) {
  const barTone: Record<Tone, string> = {
    neutral: 'bg-slate-400', brand: 'bg-brand-600', success: 'bg-success-500', warning: 'bg-warning-500',
    danger: 'bg-danger-500', info: 'bg-info-500', muted: 'bg-slate-300',
  }
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cn('h-full rounded-full transition-all', barTone[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}