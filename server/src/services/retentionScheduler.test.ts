import assert from 'node:assert/strict'
import test from 'node:test'
import { createRetentionScheduler } from './retentionScheduler.js'

test('retention scheduler waits for initial delay, runs one cycle, and reschedules without startup cleanup', async () => {
  const timers: Array<() => void> = []
  let cycles = 0
  const scheduler = createRetentionScheduler({
    initialDelayMs: 300_000,
    intervalMs: 86_400_000,
    runCycle: async () => { cycles += 1 },
    setTimer: (callback: () => void) => { timers.push(callback); return callback as unknown as NodeJS.Timeout },
    clearTimer: () => undefined,
  })
  scheduler.start()
  assert.equal(cycles, 0)
  assert.equal(timers.length, 1)
  await timers.shift()?.()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(cycles, 1)
  assert.equal(timers.length, 1)
  scheduler.stop()
})
