import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db } from '../db.js'
import { isoNow } from '../lib/date.js'
import { httpError } from '../types.js'

const MIN_CREDENTIAL_LENGTH = 16

function validateCredential(credential: string): void {
  if (typeof credential !== 'string' || credential.length < MIN_CREDENTIAL_LENGTH) {
    throw httpError(400, `Device credential must contain at least ${MIN_CREDENTIAL_LENGTH} characters.`)
  }
}

function credentialHash(credential: string, salt: string): Buffer {
  return scryptSync(credential, salt, 32)
}

export function createAttendanceDevice(input: { id: string; name: string; credential: string }): void {
  if (!input.id?.trim() || !input.name?.trim()) throw httpError(400, 'Device id and name are required.')
  validateCredential(input.credential)
  const salt = randomBytes(16).toString('hex')
  const now = isoNow()
  db.prepare(`INSERT INTO attendance_devices
    (id, name, credential_salt, credential_hash, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)`)
    .run(input.id.trim(), input.name.trim(), salt, credentialHash(input.credential, salt).toString('hex'), now, now)
}

export function rotateAttendanceDeviceCredential(deviceId: string, credential: string): void {
  validateCredential(credential)
  const salt = randomBytes(16).toString('hex')
  const updated = db.prepare(`UPDATE attendance_devices SET credential_salt=?, credential_hash=?, updated_at=?
    WHERE id=? AND is_active=1`).run(salt, credentialHash(credential, salt).toString('hex'), isoNow(), deviceId)
  if (updated.changes !== 1) throw httpError(404, 'Device not found or revoked.')
}

export function revokeAttendanceDevice(deviceId: string): void {
  const now = isoNow()
  const updated = db.prepare(`UPDATE attendance_devices SET is_active=0, revoked_at=?, updated_at=?
    WHERE id=? AND is_active=1`).run(now, now, deviceId)
  if (updated.changes !== 1) throw httpError(404, 'Device not found or already revoked.')
}

export function authenticateAttendanceDevice(deviceId: string | undefined, credential: string | undefined): { id: string; name: string } | null {
  if (!deviceId || !credential) return null
  const row = db.prepare(`SELECT id, name, credential_salt, credential_hash FROM attendance_devices
    WHERE id=? AND is_active=1`).get(deviceId) as any
  if (!row) return null
  const expected = Buffer.from(row.credential_hash, 'hex')
  const actual = credentialHash(credential, row.credential_salt)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  db.prepare('UPDATE attendance_devices SET last_used_at=?, updated_at=? WHERE id=? AND is_active=1')
    .run(isoNow(), isoNow(), row.id)
  return { id: row.id, name: row.name }
}
