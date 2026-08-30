import { db } from '../db.js'
import { getEmployee } from '../repo.js'
import { REQUEST_PERMISSIONS } from './requestAuthorization.js'

interface ShiftSwapActor { employeeId: string; permissions: Set<string> }

export function isEligibleShiftSwapPartner(actor: ShiftSwapActor, partnerEmployeeId: string): boolean {
  if (!actor.permissions.has(REQUEST_PERMISSIONS.CREATE_OWN)) return false
  if (!partnerEmployeeId || partnerEmployeeId === actor.employeeId) return false
  const owner = getEmployee(actor.employeeId)
  const partner = getEmployee(partnerEmployeeId)
  return !!owner && !!partner && partner.status === 2 && partner.departmentId === owner.departmentId
}

export function listEligibleShiftSwapPartners(actor: ShiftSwapActor): { id: string; name: string; code: string }[] {
  const owner = getEmployee(actor.employeeId)
  if (!owner || !actor.permissions.has(REQUEST_PERMISSIONS.CREATE_OWN)) return []
  return (db.prepare(`SELECT id, full_name, employee_code FROM employees
    WHERE department_id=? AND id<>? AND status=2 ORDER BY full_name`).all(owner.departmentId, owner.id) as any[])
    .map((employee) => ({ id: employee.id, name: employee.full_name, code: employee.employee_code }))
}
