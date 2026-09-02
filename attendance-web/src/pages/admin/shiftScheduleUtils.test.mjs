import assert from 'node:assert/strict'
import test from 'node:test'

import { filterBulkScheduleDates, getScheduleDayMeta } from './shiftScheduleUtils.ts'

test('filters dates by the selected range and weekdays', () => {
  const days = Array.from({ length: 7 }, (_, index) => `2026-09-0${index + 1}`)

  assert.deepEqual(
    filterBulkScheduleDates(days, 1, 7, new Set([1, 2, 3, 4, 5])),
    ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07'],
  )
})

test('returns no dates for an invalid range or no selected weekdays', () => {
  const days = ['2026-09-01', '2026-09-02']

  assert.deepEqual(filterBulkScheduleDates(days, 2, 1, new Set([2, 3])), [])
  assert.deepEqual(filterBulkScheduleDates(days, 1, 2, new Set()), [])
})

test('handles leap-day weekday calculation deterministically', () => {
  assert.deepEqual(getScheduleDayMeta('2028-02-29'), {
    day: 29,
    dayLabel: '29',
    weekday: 2,
    weekdayLabel: 'Thứ 3',
    isWeekend: false,
  })
})

test('formats Sunday with its full Vietnamese label', () => {
  assert.deepEqual(getScheduleDayMeta('2026-09-06'), {
    day: 6,
    dayLabel: '06',
    weekday: 0,
    weekdayLabel: 'Chủ nhật',
    isWeekend: true,
  })
})
