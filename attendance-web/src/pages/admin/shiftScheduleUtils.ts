export const DEFAULT_WORK_WEEKDAYS = [1, 2, 3, 4, 5] as const

export const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Thứ 2' },
  { value: 2, label: 'Thứ 3' },
  { value: 3, label: 'Thứ 4' },
  { value: 4, label: 'Thứ 5' },
  { value: 5, label: 'Thứ 6' },
  { value: 6, label: 'Thứ 7' },
  { value: 0, label: 'Chủ nhật' },
] as const

const WEEKDAY_LABELS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'] as const

export function getScheduleDayMeta(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()

  return {
    day,
    dayLabel: String(day).padStart(2, '0'),
    weekday,
    weekdayLabel: WEEKDAY_LABELS[weekday],
    isWeekend: weekday === 0 || weekday === 6,
  }
}

export function filterBulkScheduleDates(
  days: string[],
  fromDay: number,
  toDay: number,
  selectedWeekdays: ReadonlySet<number>,
) {
  if (fromDay > toDay || selectedWeekdays.size === 0) return []

  return days.filter((date) => {
    const { day, weekday } = getScheduleDayMeta(date)
    return day >= fromDay && day <= toDay && selectedWeekdays.has(weekday)
  })
}
