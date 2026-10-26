import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile, spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'

export const DEFAULT_IP = '192.168.1.11'
export const DEFAULT_PORT = 50201
const script = fileURLToPath(new URL('../ruida_upload.py', import.meta.url))
const MAX_BYTES = 32 * 1024 * 1024

// Injectable runners make all transport tests offline. This module has no timers
// or sockets until the operator explicitly verifies or uploads a job.
export function createRuidaMiddleware({ writesEnabled = false, exec = execFile, launch = spawn } = {}) {
  let busy = false
  const transfers = new Map()
  return (req, res, next) => {
    if (!req.url?.startsWith('/api/ruida/')) return next()
    const url = new URL(req.url, 'http://localhost')
    const reply = (status, body) => {
      if (res.writableEnded || res.destroyed) return
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(body))
    }
    // Same-origin checks include probes, which also send a packet to hardware.
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      return reply(403, { success: false, error: 'Same-origin request required' })
    }
    if (url.pathname === '/api/ruida/capabilities') return reply(200, {
      writesEnabled, transport: 'UDP', defaultIP: DEFAULT_IP, defaultPort: DEFAULT_PORT, maxFileBytes: MAX_BYTES, busy,
    })
    if (url.pathname.startsWith('/api/ruida/transfers/')) {
      const key = url.pathname.split('/').pop()
      const transfer = transfers.get(key) ?? [...transfers.values()].find(t => t.requestId === key)
      return reply(transfer ? 200 : 404, transfer ?? { error: 'Transfer not found; do not assume a retry is safe' })
    }
    const ip = url.searchParams.get('ip') || DEFAULT_IP
    const port = Number(url.searchParams.get('port') || DEFAULT_PORT)
    if (!net.isIPv4(ip) || !Number.isInteger(port) || port < 1 || port > 65535) {
      return reply(400, { success: false, error: 'Valid IPv4 address and UDP port required' })
    }
    if (url.pathname === '/api/ruida/status' || url.pathname === '/api/ruida/discover') {
      if (req.method !== 'POST') return reply(405, { error: 'Use POST for an explicit UDP handshake' })
      if (busy) return reply(409, { error: 'A controller transfer or probe is already in progress' })
      busy = true
      exec('python3', [script, '-', 'DEFAULT.RD', ip, '--port', String(port), '--probe'], { timeout: 5000 }, (err, stdout) => {
        busy = false
        try { reply(200, JSON.parse(stdout)) }
        catch { reply(502, { online: false, error: err?.message || 'Invalid probe response' }) }
      })
      return
    }
    if (!['/api/ruida/upload-to-storage', '/api/ruida/send'].includes(url.pathname)) return reply(404, { error: 'Unknown Ruida endpoint' })
    if (!writesEnabled) return reply(403, { success: false, error: 'Read-only bridge. Run npm run laser to enable explicit storage uploads.' })
    if (req.method !== 'POST') return reply(405, { success: false, error: 'POST required' })
    if (!req.headers['content-type']?.includes('application/json')) return reply(415, { success: false, error: 'JSON required' })
    if (Number(req.headers['content-length']) > 45 * 1024 * 1024) return reply(413, { error: 'Request too large' })
    const chunks = []
    let size = 0, rejected = false
    req.on('data', chunk => {
      size += chunk.length
      if (size > 45 * 1024 * 1024) {
        rejected = true; chunks.length = 0
        reply(413, { success: false, error: 'Request too large' })
        return
      }
      if (!rejected) chunks.push(chunk)
    })
    req.on('error', () => { rejected = true })
    req.on('end', () => {
      if (rejected) return
      let dir
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!/^[A-Z0-9_-]{1,8}\.RD$/.test(body.filename) ||
            typeof body.fileBase64 !== 'string' || !body.fileBase64.length || body.fileBase64.length % 4 !== 0 ||
            /[^A-Za-z0-9+/=]/.test(body.fileBase64) || body.fileBase64.slice(0, -2).includes('=') ||
            (body.fileBase64.endsWith('=') === false && body.fileBase64.includes('=')) ||
            (body.fileBase64.at(-2) === '=' && !body.fileBase64.endsWith('='))) {
          return reply(400, { success: false, error: 'Valid 8.3 filename and base64 RD data required' })
        }
        if (!/^[a-zA-Z0-9-]{8,80}$/.test(body.requestId ?? '')) return reply(400, { error: 'Unique requestId required' })
        const fingerprint = createHash('sha256').update(`${ip}:${port}:${body.filename}:${body.fileBase64}`).digest('hex')
        const existing = [...transfers.values()].find(t => t.requestId === body.requestId)
        if (existing) return existing.fingerprint === fingerprint ? reply(202, { transferId: existing.id }) : reply(409, { error: 'requestId was already used for different job data' })
        if (busy) return reply(409, { error: 'Another controller transfer or probe is already in progress' })
        const bytes = Buffer.from(body.fileBase64, 'base64')
        if (!bytes.length || bytes.length > MAX_BYTES) return reply(413, { error: 'RD file must be between 1 byte and 32 MiB' })
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corelith-ruida-'))
        const file = path.join(dir, 'job.rd')
        fs.writeFileSync(file, bytes)
        const id = randomUUID()
        const transfer = { id, fingerprint, requestId: body.requestId, filename: body.filename, ip, port, transport: 'UDP',
          state: 'uploading', bytesSent: 0, totalBytes: bytes.length, startedAt: Date.now() }
        transfers.set(id, transfer)
        if (transfers.size > 30) transfers.delete(transfers.keys().next().value)
        busy = true
        let stdout = '', stderr = '', finished = false
        const finish = (result) => {
          if (finished) return
          finished = true; busy = false
          Object.assign(transfer, result, { state: result.success ? 'complete' : 'failed', finishedAt: Date.now() })
          fs.rmSync(dir, { recursive: true, force: true })
        }
        const child = launch('python3', [script, file, body.filename, ip, '--port', String(port), '--allow-write', '--progress', '--verify'],
          { stdio: ['ignore', 'pipe', 'pipe'] })
        // Timeout scales with packet count. A lost ACK still aborts in 3 seconds.
        const timeout = setTimeout(() => { child.kill(); finish({ success: false, error: 'Transfer timed out; controller storage state is uncertain. No automatic retry.' }) },
          Math.min(3600000, Math.max(30000, Math.ceil(bytes.length / 1024) * 3500)))
        const onLine = line => {
          if (!line.trim()) return
          try {
            const event = JSON.parse(line)
            if (event.event === 'progress') transfer.bytesSent = event.bytesSent
            else finish(event)
          } catch { finish({ success: false, error: 'Invalid uploader response; transfer state uncertain' }); child.kill() }
        }
        child.stdout.on('data', data => {
          stdout += data.toString()
          const lines = stdout.split('\n'); stdout = lines.pop()
          for (const line of lines) onLine(line)
          if (stdout.length > 65536) { finish({ success: false, error: 'Uploader response too large' }); child.kill() }
        })
        child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000) })
        child.once('error', err => { clearTimeout(timeout); finish({ success: false, error: err.message }) })
        child.once('close', () => {
          clearTimeout(timeout)
          if (stdout.trim()) onLine(stdout)
          if (!finished) finish({ success: false, error: stderr || 'Uploader exited without a result; transfer state uncertain' })
        })
        reply(202, { transferId: id })
      } catch (err) {
        if (dir) fs.rmSync(dir, { recursive: true, force: true })
        busy = false
        reply(400, { success: false, error: err.message })
      }
    })
  }
}
