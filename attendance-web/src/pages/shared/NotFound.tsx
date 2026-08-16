import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui'

export default function NotFoundPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
      <div className="text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-brand-600">
          <Compass className="h-8 w-8" />
        </div>
        <h1 className="mt-5 text-5xl font-bold text-slate-800">404</h1>
        <p className="mt-2 text-sm text-slate-500">Trang bạn tìm không tồn tại hoặc đã bị di chuyển.</p>
        <Link to="/" className="mt-5 inline-block">
          <Button icon={<Compass className="h-4 w-4" />}>Về trang chủ</Button>
        </Link>
      </div>
    </div>
  )
}