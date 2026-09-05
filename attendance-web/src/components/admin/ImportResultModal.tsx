import { CircleAlert, CircleCheck } from 'lucide-react'
import { Button, Modal, Table, Td, Tr } from '@/components/ui'

interface ImportResult {
  totalRows: number
  importedCount: number
  errors: Array<{ row: number; field: string; message: string }>
}

export function ImportResultModal({ result, onClose }: { result: ImportResult | null; onClose: () => void }) {
  return (
    <Modal open={!!result} onClose={onClose} size="lg" title="Kết quả nhập Excel" footer={<Button onClick={onClose}>Đóng</Button>}>
      {result && <div className="space-y-4">
        <div className={`flex items-start gap-3 rounded-xl border p-4 ${result.errors.length ? 'border-danger-200 bg-danger-50' : 'border-success-200 bg-success-50'}`}>
          {result.errors.length ? <CircleAlert className="mt-0.5 h-5 w-5 text-danger-600" /> : <CircleCheck className="mt-0.5 h-5 w-5 text-success-600" />}
          <div>
            <p className="font-semibold text-slate-800">{result.errors.length ? `Có ${result.errors.length} lỗi cần sửa` : `Đã nhập thành công ${result.importedCount} dòng`}</p>
            <p className="mt-1 text-sm text-slate-600">Đã kiểm tra {result.totalRows} dòng. File có lỗi sẽ không ghi dữ liệu.</p>
          </div>
        </div>
        {result.errors.length > 0 && <Table headers={['Dòng', 'Cột', 'Lỗi']}>
          {result.errors.map((error, index) => <Tr key={`${error.row}-${error.field}-${index}`}>
            <Td>{error.row}</Td><Td className="font-medium">{error.field}</Td><Td className="whitespace-normal text-danger-700">{error.message}</Td>
          </Tr>)}
        </Table>}
      </div>}
    </Modal>
  )
}
