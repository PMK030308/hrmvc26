import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import ExcelJS from 'exceljs'
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const PDF_MIME = 'application/pdf'

export interface TabularColumn {
  header: string
  key: string
  width?: number
  numeric?: boolean
}

export interface TabularDocument {
  title: string
  subtitle?: string
  sheetName: string
  columns: TabularColumn[]
  rows: Array<Record<string, unknown>>
}

const require = createRequire(import.meta.url)
const pdfMake = require('pdfmake') as typeof import('pdfmake')
const pdfMakeRoot = dirname(require.resolve('pdfmake/package.json'))
const fontRoot = resolve(pdfMakeRoot, 'fonts', 'Roboto')
const fontRootPrefix = `${fontRoot}${sep}`

pdfMake.setFonts({
  Roboto: {
    normal: join(fontRoot, 'Roboto-Regular.ttf'),
    bold: join(fontRoot, 'Roboto-Medium.ttf'),
    italics: join(fontRoot, 'Roboto-Italic.ttf'),
    bolditalics: join(fontRoot, 'Roboto-MediumItalic.ttf'),
  },
})
pdfMake.setUrlAccessPolicy(() => false)
pdfMake.setLocalAccessPolicy((path) => {
  const resolvedPath = resolve(path)
  return resolvedPath === fontRoot || resolvedPath.startsWith(fontRootPrefix)
})

function safeSheetName(value: string): string {
  return value.replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || 'Dữ liệu'
}

function safeCellValue(value: unknown): string | number {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? value : ''
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  const text = String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function pdfText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)
  return String(value)
}

export async function createTabularExcel(document: TabularDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'HRM Attendance'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet(safeSheetName(document.sheetName), { views: [{ state: 'frozen', ySplit: 3 }] })
  sheet.addRow([document.title])
  sheet.mergeCells(1, 1, 1, document.columns.length)
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF0F172A' } }
  sheet.getCell(1, 1).alignment = { vertical: 'middle' }
  sheet.getRow(1).height = 26
  sheet.addRow([document.subtitle ?? `Xuất lúc ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`])
  sheet.mergeCells(2, 1, 2, document.columns.length)
  sheet.getCell(2, 1).font = { italic: true, color: { argb: 'FF64748B' } }
  const header = sheet.addRow(document.columns.map((column) => column.header))
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  header.height = 24
  for (const row of document.rows) {
    const excelRow = sheet.addRow(document.columns.map((column) => safeCellValue(row[column.key])))
    excelRow.alignment = { vertical: 'top', wrapText: true }
    document.columns.forEach((column, index) => {
      if (column.numeric) excelRow.getCell(index + 1).numFmt = '#,##0.00'
    })
  }
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: document.columns.length } }
  document.columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width ?? 18 })
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 3 && rowNumber % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
    row.eachCell((cell) => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } } })
  })
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function createTabularPdf(document: TabularDocument): Promise<Buffer> {
  const header: TableCell[] = document.columns.map((column) => ({
    text: column.header, bold: true, color: '#ffffff', fillColor: '#2563eb', margin: [3, 4, 3, 4],
  }))
  const body: TableCell[][] = [header, ...document.rows.map((row) => document.columns.map((column): TableCell => ({
    text: pdfText(row[column.key]), alignment: column.numeric ? 'right' : 'left', margin: [3, 3, 3, 3],
  })))]
  const content: Content[] = [
    { text: document.title, fontSize: 16, bold: true, color: '#0f172a' },
    { text: document.subtitle ?? '', fontSize: 9, color: '#64748b', margin: [0, 3, 0, 10] },
    { table: { headerRows: 1, widths: document.columns.map(() => '*'), body }, layout: 'lightHorizontalLines', fontSize: 8 },
  ]
  const definition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: document.columns.length > 6 ? 'landscape' : 'portrait',
    pageMargins: [24, 28, 24, 28],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    content,
    footer: (currentPage, pageCount) => ({
      text: `Trang ${currentPage}/${pageCount}`, alignment: 'right', color: '#94a3b8', fontSize: 8, margin: [0, 0, 24, 0],
    }),
  }
  return Buffer.from(await pdfMake.createPdf(definition).getBuffer())
}
