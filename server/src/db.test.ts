import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

test('database path can be redirected to an isolated file for integration tests', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hrm-authz-db-'))
  const databasePath = join(directory, 'authorization.test.db')
  process.env.HRM_DB_PATH = databasePath

  const { db } = await import(`./db.js?isolated=${Date.now()}`)

  try {
    assert.equal(resolve(db.name), resolve(databasePath))
  } finally {
    db.close()
    delete process.env.HRM_DB_PATH
    rmSync(directory, { recursive: true, force: true })
  }
})
