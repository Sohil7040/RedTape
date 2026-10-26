import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const url = 'http://127.0.0.1:5188'
const state = path.join(os.homedir(), '.local/state/corelith-studio')
fs.mkdirSync(state, { recursive: true })
async function running() {
  try {
    const res = await fetch(`${url}/api/corelith/health`, { signal: AbortSignal.timeout(700) })
    const info = await res.json()
    return info.app === 'corelith-studio' && info.desktop && info.writesEnabled
  } catch { return false }
}
if (!await running()) {
  const log = fs.openSync(path.join(state, 'server.log'), 'a')
  const child = spawn(process.execPath, [path.join(root, 'server/desktopServer.mjs')], {
    detached: true, stdio: ['ignore', log, log], env: { ...process.env, RUIDA_ALLOW_WRITES: '1' },
  })
  child.unref(); fs.closeSync(log)
  let ready = false
  for (let i = 0; i < 30; i++) {
    if (await running()) { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  if (!ready) throw new Error(`Corelith could not start. Inspect ${path.join(state, 'server.log')}; port 5188 may be occupied.`)
}
if (process.argv.includes('--check')) { console.log(`Corelith desktop ready: ${url}`); process.exit(0) }
const browser = ['google-chrome', 'chromium', 'chromium-browser'].find(name => spawnSync('which', [name]).status === 0)
if (!browser) throw new Error('Install Google Chrome or Chromium to run the Corelith desktop window.')
const profile = path.join(os.homedir(), '.local/share/corelith-studio/browser-profile')
const app = spawn(browser, [`--app=${url}/`, `--user-data-dir=${profile}`, '--class=CorelithStudio', '--no-first-run'], { detached: true, stdio: 'ignore' })
app.on('error', err => console.error(err.message)); app.unref()
