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
export function prepareLaserJob(doc: DocumentModel, filename: string) {
  const job = getProductionJob(doc)
  try {
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
