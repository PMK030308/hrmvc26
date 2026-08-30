import assert from 'node:assert/strict'
import test from 'node:test'
import {
  REQUEST_PERMISSIONS,
  canApproveCurrentStep,
  canCancelRequest,
  canManageRequestAttachment,
  canModifyRequest,
  canRespondToShiftSwap,
  canViewRequest,
  type RequestActor,
  type RequestAuthorizationContext,
} from './requestAuthorization.js'

const employeePermissions = Object.values(REQUEST_PERMISSIONS).filter((permission) =>
  permission !== REQUEST_PERMISSIONS.VIEW_ALL && permission !== REQUEST_PERMISSIONS.VIEW_SCOPED,
)

function actor(overrides: Partial<RequestActor> = {}): RequestActor {
  return {
    userId: 'user-a', employeeId: 'employee-a', roles: ['Employee'], departmentScopes: [],
    permissions: new Set(employeePermissions), ...overrides,
  }
}

function context(overrides: Partial<RequestAuthorizationContext> = {}): RequestAuthorizationContext {
  return {
    request: {
      id: 'request-1', type: 'leaves', employeeId: 'employee-a', departmentId: 'department-a',
      status: 2, requestVersion: 1, currentLevel: 1, suggestedSwapPartnerId: null, swapPartnerStatus: 0,
    },
    approvals: [], currentApproval: null, delegationActive: false, ...overrides,
  }
}

test('owner can view their own request when role permission allows it', () => {
  assert.equal(canViewRequest(actor(), context()), true)
})

test('employee cannot view another employee request', () => {
  assert.equal(canViewRequest(actor(), context({ request: { ...context().request, employeeId: 'employee-b' } })), false)
})

test('HR can only view requests inside current department scopes', () => {
  const hr = actor({ roles: ['HR'], departmentScopes: ['department-a'], permissions: new Set([...employeePermissions, REQUEST_PERMISSIONS.VIEW_SCOPED]) })
  assert.equal(canViewRequest(hr, context({ request: { ...context().request, employeeId: 'employee-b' } })), true)
  assert.equal(canViewRequest(hr, context({ request: { ...context().request, employeeId: 'employee-b', departmentId: 'department-b' } })), false)
})

test('prior approver can view but cannot approve the current step', () => {
  const ctx = context({
    request: { ...context().request, employeeId: 'employee-b', currentLevel: 2 },
    approvals: [
      { level: 1, status: 3, approverUserId: 'user-a', onBehalfOfUserId: null },
      { level: 2, status: 2, approverUserId: 'user-b', onBehalfOfUserId: null },
    ],
    currentApproval: { level: 2, status: 2, approverUserId: 'user-b', onBehalfOfUserId: null },
  })
  assert.equal(canViewRequest(actor(), ctx), true)
  assert.equal(canApproveCurrentStep(actor(), ctx), false)
})

test('only the resolved current approver can approve', () => {
  const currentApproval = { level: 1, status: 2, approverUserId: 'user-a', onBehalfOfUserId: null }
  assert.equal(canApproveCurrentStep(actor(), context({ approvals: [currentApproval], currentApproval })), true)
  assert.equal(canApproveCurrentStep(actor({ userId: 'user-b' }), context({ approvals: [currentApproval], currentApproval })), false)
})

test('delegation switches action authority based on current validity', () => {
  const currentApproval = { level: 1, status: 2, approverUserId: 'delegate', onBehalfOfUserId: 'delegator' }
  const active = context({ approvals: [currentApproval], currentApproval, delegationActive: true })
  const expired = context({ approvals: [currentApproval], currentApproval, delegationActive: false })
  assert.equal(canApproveCurrentStep(actor({ userId: 'delegate' }), active), true)
  assert.equal(canApproveCurrentStep(actor({ userId: 'delegator' }), active), false)
  assert.equal(canApproveCurrentStep(actor({ userId: 'delegate' }), expired), false)
  assert.equal(canApproveCurrentStep(actor({ userId: 'delegator' }), expired), true)
})

test('owner can only modify before an approval step is initialized', () => {
  assert.equal(canModifyRequest(actor(), context({ request: { ...context().request, status: 6 } })), true)
  assert.equal(canModifyRequest(actor(), context({ approvals: [{ level: 1, status: 2, approverUserId: 'user-b', onBehalfOfUserId: null }] })), false)
})

test('owner can cancel non-terminal requests but not approved requests', () => {
  assert.equal(canCancelRequest(actor(), context()), true)
  assert.equal(canCancelRequest(actor(), context({ request: { ...context().request, status: 3 } })), false)
})

test('attachment permissions distinguish current approver actions', () => {
  const currentApproval = { level: 1, status: 2, approverUserId: 'approver', onBehalfOfUserId: null }
  const pending = context({ request: { ...context().request, employeeId: 'employee-owner' }, approvals: [currentApproval], currentApproval })
  assert.equal(canManageRequestAttachment(actor({ userId: 'approver' }), pending, 'read'), true)
  assert.equal(canManageRequestAttachment(actor({ userId: 'approver' }), pending, 'upload'), true)
  assert.equal(canManageRequestAttachment(actor({ userId: 'approver' }), pending, 'delete'), false)
})

test('only the suggested shift-swap partner can respond once', () => {
  const swap = context({ request: { ...context().request, type: 'shift-swaps', employeeId: 'employee-owner', status: 6, suggestedSwapPartnerId: 'employee-a', swapPartnerStatus: 1 } })
  assert.equal(canRespondToShiftSwap(actor(), swap), true)
  assert.equal(canRespondToShiftSwap(actor({ employeeId: 'employee-b' }), swap), false)
  assert.equal(canRespondToShiftSwap(actor(), context({ request: { ...swap.request, swapPartnerStatus: 2 } })), false)
})

test('permission matrix can revoke an otherwise valid owner action', () => {
  assert.equal(canViewRequest(actor({ permissions: new Set() }), context()), false)
})
