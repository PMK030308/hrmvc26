import { AlertTriangle, Home, RefreshCw } from 'lucide-react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { Button, Card } from '@/components/ui'

export default function RouteErrorFallback() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? error.statusText || `Lỗi ${error.status}`
    : error instanceof Error ? error.message : 'Dữ liệu trả về không đúng định dạng.'

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-4">
      <Card className="w-full max-w-lg p-6 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-danger-50 text-danger-600">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Không thể hiển thị trang này</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="secondary" icon={<Home className="h-4 w-4" />} onClick={() => window.location.assign('/')}>Trang chủ</Button>
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => window.location.reload()}>Tải lại</Button>
        </div>
      </Card>
    </div>
  )
}

