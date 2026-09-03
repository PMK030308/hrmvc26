import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import express from 'express'
import { db, initSchema } from '../db.js'
import { signToken } from '../middleware/auth.js'
import { configRouter } from './config.js'

const app = express()
app.use(express.json())
app.use('/config', configRouter)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err?.status ?? 500).json({ message: err?.message ?? 'Internal error' })
})

let server: ReturnType<typeof app.listen>
let baseUrl = ''

const employeeToken = signToken({
  id: 'profile-test-user',
  email: 'profile-test@technova.vn',
  employeeId: 'profile-test-employee',
  roles: ['Employee'],
  permissions: [],
  departmentScopes: [],
})

const otherEmployeeToken = signToken({
  id: 'profile-other-user',
  email: 'profile-other@technova.vn',
  employeeId: 'profile-other-employee',
  roles: ['Employee'],
  permissions: [],
  departmentScopes: [],
})

before(() => {
  initSchema()
  db.exec('BEGIN')
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)')
    .run('profile-test-branch', 'Chi nhánh Profile', '')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)')
    .run('profile-test-department', 'PROFILE', 'Phòng Công nghệ')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)')
    .run('profile-other-department', 'OTHER', 'Phòng Không Thuộc Nhân Viên')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)')
    .run('profile-test-position', 'DEV', 'Lập trình viên')
  db.prepare(`INSERT INTO employees
    (id, employee_code, full_name, email, department_id, position_id, branch_id, hire_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      'profile-test-employee', 'PROFILE-001', 'Nhân viên Profile', 'profile-test@technova.vn',
      'profile-test-department', 'profile-test-position', 'profile-test-branch', '2026-01-01',
    )
  db.prepare(`INSERT INTO employees
    (id, employee_code, full_name, email, department_id, position_id, branch_id, hire_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      'profile-other-employee', 'PROFILE-002', 'Nhân viên Khác', 'profile-other@technova.vn',
      'profile-other-department', 'profile-test-position', null, '2026-01-01',
    )

  server = app.listen(0)
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(() => {
  server.close()
  db.exec('ROLLBACK')
})

test('GET profile returns the signed-in employee work names only', async () => {
  const response = await fetch(`${baseUrl}/config/profile`, {
    headers: { Authorization: `Bearer ${employeeToken}` },
  })

  assert.equal(response.status, 200)
  const profile = await response.json() as any
  assert.equal(profile.id, 'profile-test-employee')
  assert.equal(profile.departmentName, 'Phòng Công nghệ')
  assert.equal(profile.positionName, 'Lập trình viên')
  assert.equal(profile.branchName, 'Chi nhánh Profile')
  assert.notEqual(profile.departmentName, 'Phòng Không Thuộc Nhân Viên')
})

test('GET profile returns null for a missing optional work relation', async () => {
  const response = await fetch(`${baseUrl}/config/profile`, {
    headers: { Authorization: `Bearer ${otherEmployeeToken}` },
  })

  assert.equal(response.status, 200)
  const profile = await response.json() as any
  assert.equal(profile.id, 'profile-other-employee')
  assert.equal(profile.departmentName, 'Phòng Không Thuộc Nhân Viên')
  assert.equal(profile.branchName, null)
})

test('PUT profile preserves enriched work names in its response', async () => {
  const response = await fetch(`${baseUrl}/config/profile`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${employeeToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ phone: '0900000000' }),
  })

  assert.equal(response.status, 200)
  const profile = await response.json() as any
  assert.equal(profile.id, 'profile-test-employee')
  assert.equal(profile.phone, '0900000000')
  assert.equal(profile.departmentName, 'Phòng Công nghệ')
  assert.equal(profile.positionName, 'Lập trình viên')
  assert.equal(profile.branchName, 'Chi nhánh Profile')
})
