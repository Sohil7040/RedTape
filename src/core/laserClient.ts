import { DocumentModel } from './model'
import { getProductionJob } from './production'
import { buildJobRD, RUIDA_HARDWARE_LIMITS, ruidaFilename } from './ruidaIO'

export interface MachineProfile { ip: string; port: number }
export const PROFILE_KEY = 'corelith.ruida.profile.v1'
export const TRANSFER_KEY = 'corelith.ruida.transfer.v1'
export function validProfile(profile: MachineProfile): boolean {
  const octets = profile.ip.split('.')
  return octets.length === 4 && octets.every(o => /^(0|[1-9]\d{0,2})$/.test(o) && Number(o) <= 255) &&
    Number.isInteger(profile.port) && profile.port >= 1 && profile.port <= 65535
}
export function loadMachineProfile(): MachineProfile {
  const fallback = { ip: RUIDA_HARDWARE_LIMITS.defaultDeviceIP, port: RUIDA_HARDWARE_LIMITS.ruidaPort }
  try { const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null'); return p && validProfile(p) ? p : fallback }
  catch { return fallback }
}
/** EVA output-axis calibration is based on JOB.RD readback and the physical SOHIL result. */
export function machineOrientationIssue(doc: DocumentModel, profile: MachineProfile): string | null {
  if (profile.ip !== RUIDA_HARDWARE_LIMITS.defaultDeviceIP || profile.port !== RUIDA_HARDWARE_LIMITS.ruidaPort) return null
  const actual = doc.production.originCorner, expected = RUIDA_HARDWARE_LIMITS.defaultOrigin
  if (actual === expected) return null
  if (!['top-left','top-right','bottom-left','bottom-right'].includes(actual)) return 'Output orientation mismatch: apply the corrected EVA orientation, then regenerate the job.'
  const axes = [actual.endsWith('right') !== expected.endsWith('right') ? 'left-to-right' : '', actual.startsWith('bottom') !== expected.startsWith('bottom') ? 'upside down' : ''].filter(Boolean).join(' and ')
  return `Output orientation mismatch: this job uses ${actual}, but the calibrated EVA profile uses ${expected}. Output would be ${axes}. Apply the corrected EVA orientation, then regenerate the job.`
}
export function prepareLaserJob(doc: DocumentModel, filename: string, profile?: MachineProfile) {
  const job = getProductionJob(doc)
  try {
    const orientation = profile ? machineOrientationIssue(doc, profile) : null
    if (orientation) throw new Error(orientation)
    const name = ruidaFilename(filename) + '.RD'
    const bytes = buildJobRD(doc, name)
    if (bytes.length > 32 * 1024 * 1024) throw new Error('RD file exceeds the 32 MiB transfer limit')
    return { filename: name, bytes, error: null, warnings: job.warnings }
  } catch (error) {
    return { filename: '', bytes: null, error: error instanceof Error ? error.message : 'Unable to prepare RD file', warnings: job.warnings }
  }
}
export function bytesToBase64(bytes: Uint8Array): string {
  let text = ''
  // Avoid creating one JS array element per byte for large jobs.
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}
export async function bridgeJSON(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(10000) })
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) throw new Error('Local laser bridge is unavailable. Start npm run laser and open its localhost URL.')
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? `Bridge returned HTTP ${res.status}`)
  return body
}
