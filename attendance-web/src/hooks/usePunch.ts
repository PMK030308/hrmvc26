import { useEffect, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { attendanceApi } from '@/api/attendance'
import type { PunchSource, PunchResponse } from '@/types'
import { toast } from 'sonner'

/** Đồng hồ HH:mm:ss realtime. */
export function useClock(): string {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now.toLocaleTimeString('vi-VN', { hour12: false })
}

/** Trạng thái chấm công hôm nay + hàm chấm. */
export function usePunch() {
  const qc = useQueryClient()
  const today = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: () => attendanceApi.today(),
  })

  const punch = useMutation({
    mutationFn: (vars: { source: PunchSource; latitude?: number; longitude?: number; accuracy?: number; wifiSsid?: string; notes?: string }) =>
      attendanceApi.punch(vars),
    onSuccess: (res: PunchResponse) => {
      if (res.success) toast.success(res.message)
      else toast.warning(res.message)
      qc.invalidateQueries({ queryKey: ['attendance', 'today'] })
      qc.invalidateQueries({ queryKey: ['employee', 'dashboard'] })
      qc.invalidateQueries({ queryKey: ['attendance', 'detail'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const doPunch = useCallback((source: PunchSource, extra?: { latitude?: number; longitude?: number; wifiSsid?: string; notes?: string }) => {
    punch.mutate({ source, ...extra })
  }, [punch])

  const record = today.data?.record ?? null
  const punches = today.data?.punches ?? []
  const totalPunches = punches.length
  const isCompleted = record?.checkInTime != null && record?.checkOutTime != null
  const nextAction: 'check_in' | 'check_out' | 'completed' =
    isCompleted ? 'completed' : record?.checkInTime == null ? 'check_in' : 'check_out'

  return {
    today, record, punches, totalPunches, isCompleted, nextAction,
    doPunch, isPunching: punch.isPending,
  }
}