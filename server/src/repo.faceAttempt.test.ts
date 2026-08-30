import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'

const directory = mkdtempSync(join(tmpdir(), 'hrm-face-attempt-'))
process.env.HRM_DB_PATH = join(directory, 'face-attempt.db')

const { db, initSchema } = await import('./db.js')
const { createAttemptToken, consumeAttemptToken } = await import('./repo.js')

before(() => initSchema())

after(() => {
  db.close()
  delete process.env.HRM_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

test('face attempt token is bound to its DB-fresh user and remains usable after a foreign attempt', () => {
  const { token } = createAttemptToken('user-a')
  const consumeForUser = consumeAttemptToken as unknown as (token: string, userId: string) => { userId: string } | null

  assert.equal(consumeForUser(token, 'user-b'), null)
  assert.deepEqual(consumeForUser(token, 'user-a'), { userId: 'user-a' })
  assert.equal(consumeForUser(token, 'user-a'), null)
})
