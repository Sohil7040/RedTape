import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRuidaMiddleware } from './ruidaBridge.mjs'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' }
export function createDesktopHandler({ dist = root, writesEnabled = true, port = 5188 } = {}) {
  const bridge = createRuidaMiddleware({ writesEnabled })
  return (req, res) => {
    if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403); res.end('Local app host required'); return }
    if (req.url === '/api/corelith/health') {
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify({ app: 'corelith-studio', desktop: true, writesEnabled })); return
    }
    bridge(req, res, () => {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return }
      let pathname
      try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname) } catch { res.writeHead(400); res.end(); return }
      const file = path.resolve(dist, pathname === '/' ? 'index.html' : `.${pathname}`)
      if (!file.startsWith(path.resolve(dist) + path.sep)) { res.writeHead(403); res.end(); return }
      fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return }
        res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Content-Length', stat.size)
        if (req.method === 'HEAD') { res.end(); return }
        const stream = fs.createReadStream(file)
        stream.on('error', () => res.destroy()); stream.pipe(res)
      })
    })
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CORELITH_PORT || 5188)
  const server = http.createServer(createDesktopHandler({ port, writesEnabled: process.env.RUIDA_ALLOW_WRITES === '1' }))
  server.on('error', err => { console.error(`Corelith desktop: ${err.message}`); process.exit(1) })
  server.listen(port, '127.0.0.1', () => console.log(`Corelith desktop ready at http://127.0.0.1:${port}`))
}
