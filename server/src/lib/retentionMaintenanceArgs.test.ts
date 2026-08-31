import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRetentionMaintenanceArgs } from './retentionMaintenanceArgs.js'

test('retention maintenance defaults to dry-run and bounded batches', () => {
  assert.deepEqual(parseRetentionMaintenanceArgs(['audit-security']), {
    category: 'audit-security', dryRun: true, batchSize: 100,
  })
  assert.deepEqual(parseRetentionMaintenanceArgs(['face-attempt-metadata', '--apply', '--batch-size=25']), {
    category: 'face-attempt-metadata', dryRun: false, batchSize: 25,
  })
})

test('retention maintenance rejects unsafe or unsupported arguments', () => {
  assert.throws(() => parseRetentionMaintenanceArgs([]), /category/i)
  assert.throws(() => parseRetentionMaintenanceArgs(['unknown']), /category/i)
  assert.throws(() => parseRetentionMaintenanceArgs(['audit-security', '--batch-size=0']), /batch/i)
  assert.throws(() => parseRetentionMaintenanceArgs(['audit-security', '--force']), /argument/i)
})
