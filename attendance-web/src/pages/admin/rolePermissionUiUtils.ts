interface PermissionRowLike {
  key: string
  module: string
  label: string
  roles: Record<string, boolean>
}

const MODULE_LABELS: Record<string, string> = {
  requests: 'Đơn từ', config: 'Cấu hình hệ thống', system: 'Hệ thống', attendance: 'Chấm công',
  face: 'Khuôn mặt', shifts: 'Ca làm việc', org: 'Tổ chức & nhân viên', delegation: 'Ủy quyền',
  timesheet: 'Bảng công', payroll: 'Tiền lương', reports: 'Báo cáo', audit: 'Nhật ký hệ thống', chatbot: 'Trợ lý AI',
}

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/gi, (letter) => letter === 'Đ' ? 'D' : 'd').toLocaleLowerCase('vi').trim()
}

export function matchesNormalizedSearch(value: string, query: string): boolean {
  return normalizeSearch(value).includes(normalizeSearch(query))
}

export function groupPermissionRows<T extends PermissionRowLike>(rows: T[], query: string) {
  const needle = normalizeSearch(query)
  const groups = new Map<string, { module: string; label: string; rows: T[] }>()
  for (const row of rows) {
    const moduleLabel = MODULE_LABELS[row.module] ?? row.module
    if (needle && !matchesNormalizedSearch(`${row.label} ${row.key} ${row.module} ${moduleLabel}`, needle)) continue
    const group = groups.get(row.module) ?? { module: row.module, label: moduleLabel, rows: [] }
    group.rows.push(row)
    groups.set(row.module, group)
  }
  return [...groups.values()]
}

export function countPermissionChanges<T extends PermissionRowLike>(baseline: T[], draft: T[]): number {
  const baselineByKey = new Map(baseline.map((row) => [row.key, row]))
  let changes = 0
  for (const row of draft) {
    const original = baselineByKey.get(row.key)
    if (!original) continue
    for (const role of new Set([...Object.keys(original.roles), ...Object.keys(row.roles)])) {
      if (original.roles[role] !== row.roles[role]) changes += 1
    }
  }
  return changes
}

export function shouldSyncPermissionMatrix<T extends PermissionRowLike>(
  currentVersion: number | null,
  incomingVersion: number,
  baseline: T[],
  draft: T[],
): boolean {
  if (currentVersion === null) return true
  return incomingVersion > currentVersion && countPermissionChanges(baseline, draft) === 0
}
