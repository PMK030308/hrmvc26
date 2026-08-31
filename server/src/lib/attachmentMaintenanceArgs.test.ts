import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAttachmentMaintenanceArgs } from './attachmentMaintenanceArgs.js'

test('attachment maintenance commands default to dry-run and require explicit apply', () => {
  assert.deepEqual(parseAttachmentMaintenanceArgs(['backfill']), { mode: 'backfill', apply: false, batchSize: 100 })
  assert.deepEqual(parseAttachmentMaintenanceArgs(['cleanup', '--apply', '--batch-size=25']), { mode: 'cleanup', apply: true, batchSize: 25 })
})

test('attachment maintenance rejects unknown modes, flags and unsafe batch sizes', () => {
  assert.throws(() => parseAttachmentMaintenanceArgs(['unknown']), /mode/i)
  assert.throws(() => parseAttachmentMaintenanceArgs(['backfill', '--delete-legacy']), /argument/i)
  assert.throws(() => parseAttachmentMaintenanceArgs(['backfill', '--batch-size=0']), /batch/i)
  assert.throws(() => parseAttachmentMaintenanceArgs(['backfill', '--batch-size=501']), /batch/i)
})
