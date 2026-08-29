import { useState } from 'react'
import { NavLink, useLocation, useNavigate, Outlet } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X, LogOut, ChevronDown, ChevronUp, Fingerprint, UserRound, Bell, Sun, Moon, Monitor } from 'lucide-react'
import { navForRoles, homeForRoles, type NavItem } from './nav'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { useRealtime } from '@/hooks/useRealtime'
import { ROLE_LABEL } from '@/constants/enums'
import { Avatar } from '@/components/ui'
import { NotificationBell } from './NotificationBell'
import { ChatbotWidget } from '@/components/chatbot/ChatbotWidget'
import { orgApi } from '@/api/org'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/cn'

function SidebarItem({ item, onNav }: { item: NavItem; onNav?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink to={item.to} end={item.to.endsWith('/employee') || item.to === '/director' || item.to === '/admin/dashboard'}
      onClick={onNav}
      className={({ isActive }) => cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
        isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}>
      <Icon className="h-5 w-5 shrink-0" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  )
}

function UserMenu({ placement = 'topbar' }: { placement?: 'sidebar' | 'topbar' }) {
  const [open, setOpen] = useState(false)
  const user = useAuthStore((s) => s.user)!
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const { data: emp } = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => orgApi.employee(user.employeeId),
    enabled: !!user.employeeId,
  })
  const roleLabel = user.roles.map((r) => ROLE_LABEL[r].label).join(', ')

  return (
    <div className={cn('relative', placement === 'sidebar' && 'w-full')}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        className={cn('flex items-center gap-2 rounded-lg p-1.5 transition hover:bg-slate-100', placement === 'sidebar' && 'w-full px-2 py-2')}>
        <Avatar name={emp?.fullName ?? user.email} src={emp?.avatarData} size="sm" />
        <div className="hidden text-left sm:block">
          <p className="max-w-[140px] truncate text-xs font-semibold text-slate-800">{emp?.fullName ?? user.email}</p>
          <p className="text-[10px] text-slate-500">{roleLabel}</p>
        </div>
        {placement === 'sidebar'
          ? <ChevronUp className={cn('ml-auto h-4 w-4 text-slate-400 transition-transform', open && 'rotate-180')} />
          : <ChevronDown className={cn('hidden h-4 w-4 text-slate-400 transition-transform sm:block', open && 'rotate-180')} />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className={cn(
            'absolute right-0 z-40 w-56 rounded-xl bg-white p-1.5 shadow-pop ring-1 ring-slate-200',
            placement === 'sidebar' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}>
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="text-sm font-semibold text-slate-800">{emp?.fullName ?? user.email}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
            <button onClick={() => { navigate(homeForRoles(user.roles)); setOpen(false) }}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
              <Fingerprint className="h-4 w-4" /> Trang chủ
            </button>
            <button onClick={() => { navigate('/employee/profile'); setOpen(false) }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
              <UserRound className="h-4 w-4" /> Hồ sơ tài khoản
            </button>
            <button onClick={() => { navigate('/employee/notifications'); setOpen(false) }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
              <Bell className="h-4 w-4" /> Thông báo
            </button>
            <div className="my-1 border-y border-slate-100 px-2 py-2.5">
              <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Giao diện</p>
              <div className="grid grid-cols-3 gap-1">
                {([
                  { value: 'light' as const, label: 'Sáng', icon: Sun },
                  { value: 'dark' as const, label: 'Tối', icon: Moon },
                  { value: 'system' as const, label: 'Máy', icon: Monitor },
                ]).map((item) => <button key={item.value} type="button" onClick={() => setTheme(item.value)} title={item.value === 'system' ? 'Theo giao diện Windows' : item.label}
                  className={cn('flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium transition', theme === item.value ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100' : 'text-slate-500 hover:bg-slate-100')}>
                  <item.icon className="h-4 w-4" />{item.label}
                </button>)}
              </div>
            </div>
            <button onClick={() => { logout(); navigate('/login') }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger-600 hover:bg-danger-50">
              <LogOut className="h-4 w-4" /> Đăng xuất
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function AppLayout() {
  const user = useAuthStore((s) => s.user)!
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebar = useUIStore((s) => s.setSidebar)
  const location = useLocation()
  const nav = navForRoles(user.roles).filter((it) => !it.roles || it.roles.some((r) => user.roles.includes(r)))
  useRealtime()

  // Mobile bottom nav — 5 mục đầu (mobile-first)
  const bottomNav = nav.slice(0, 5)

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">
            <Fingerprint className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">HRM Chấm công</p>
            <p className="text-[10px] text-slate-400">TechNova JSC</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map((item) => <SidebarItem key={item.to} item={item} />)}
        </nav>
        <div className="border-t border-slate-100 p-3"><UserMenu placement="sidebar" /></div>
      </aside>

      {/* Sidebar mobile (drawer) */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" onClick={() => setSidebar(false)} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'tween', duration: 0.2 }}
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-white lg:hidden">
              <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
                <div className="flex items-center gap-2">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white"><Fingerprint className="h-5 w-5" /></div>
                  <p className="text-sm font-bold text-slate-800">HRM Chấm công</p>
                </div>
                <button onClick={() => setSidebar(false)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
              </div>
              <nav className="flex-1 space-y-1 overflow-y-auto p-3">
                {nav.map((item) => <SidebarItem key={item.to} item={item} onNav={() => setSidebar(false)} />)}
              </nav>
              <div className="border-t border-slate-100 p-3"><UserMenu placement="sidebar" /></div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="lg:pl-64">
        {/* TopBar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur lg:px-6">
          <button onClick={() => setSidebar(true)} className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-800">{pageTitle(location.pathname)}</p>
            <p className="hidden text-xs text-slate-400 sm:block">{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
          </div>
          <NotificationBell />
          <div className="hidden sm:block"><UserMenu /></div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-24 pt-5 lg:px-6 lg:pb-8">
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            <Outlet />
          </motion.div>
        </main>

        {/* BottomNav mobile */}
        <nav className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
          {bottomNav.map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={item.to.endsWith('/employee') || item.to === '/director'}
                className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium', isActive ? 'text-brand-600' : 'text-slate-500')}>
                <Icon className="h-5 w-5" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
      </div>

      <ChatbotWidget />
    </div>
  )
}

function pageTitle(path: string): string {
  const map: Record<string, string> = {
    '/employee': 'Cổng nhân viên', '/employee/attendance': 'Chấm công', '/employee/timesheet': 'Bảng chấm công',
    '/employee/shift-schedule': 'Bảng phân ca', '/employee/leave-plan': 'Kế hoạch nghỉ phép',
    '/employee/requests': 'Đơn từ', '/employee/approvals': 'Duyệt đơn', '/employee/salary': 'Lương',
    '/employee/notifications': 'Thông báo', '/employee/profile': 'Hồ sơ cá nhân',
    '/employee/face-register': 'Đăng ký khuôn mặt', '/employee/face-punch': 'Chấm công khuôn mặt',
    '/employee/leavers-today': 'Nhân viên nghỉ trong ngày', '/employee/punch-options': 'Phương thức chấm công',
    '/admin/dashboard': 'Dashboard tổng quan', '/admin/live': 'Live Dashboard', '/admin/employees': 'Quản lý nhân viên',
    '/admin/departments': 'Phòng ban & vị trí', '/admin/shifts': 'Quản lý ca', '/admin/shift-schedule': 'Bảng phân ca',
    '/admin/timesheet': 'Bảng công chi tiết', '/admin/summary-timesheet': 'Bảng công tổng hợp',
    '/admin/requests': 'Quản lý đơn', '/admin/payroll': 'Lương', '/admin/reports': 'Báo cáo',
    '/admin/roles': 'Role & Quyền', '/admin/audit': 'Audit log',
    '/director': 'Cổng Giám đốc', '/director/approvals': 'Duyệt đơn cấp cuối', '/director/payroll': 'Kỳ lương', '/director/reports': 'Báo cáo',
    '/accountant/payroll': 'Bảng lương', '/accountant/reports': 'Báo cáo',
  }
  return map[path] ?? 'HRM Chấm công'
}
