import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const source = fileURLToPath(new URL('../', import.meta.url))
const release = new Date().toISOString().replace(/[:.]/g, '-')
const base = path.join(os.homedir(), '.local/share/corelith-studio')
const dest = path.join(base, 'releases', release)
if (!fs.existsSync(path.join(source, 'dist/index.html'))) throw new Error('Run npm run build before installation')
if (spawnSync('python3', ['--version']).status !== 0) throw new Error('Python 3 is required for the local upload bridge')
fs.mkdirSync(dest, { recursive: true })
for (const name of ['dist', 'server', 'ruida_upload.py']) fs.cpSync(path.join(source, name), path.join(dest, name), { recursive: true })
fs.mkdirSync(path.join(dest, 'scripts'))
fs.copyFileSync(path.join(source, 'scripts/desktop-launch.mjs'), path.join(dest, 'scripts/desktop-launch.mjs'))
fs.copyFileSync(process.execPath, path.join(dest, 'node'))
fs.chmodSync(path.join(dest, 'node'), 0o755)
const licenses = path.join(dest, 'licenses')
fs.mkdirSync(licenses)
for (const name of ['react', 'react-dom', 'lucide-react', 'opentype.js', 'pdfjs-dist']) {
  fs.copyFileSync(path.join(source, 'node_modules', name, 'LICENSE'), path.join(licenses, `${name}.txt`))
}
const nodeLicense = path.resolve(path.dirname(process.execPath), '../LICENSE')
if (fs.existsSync(nodeLicense)) fs.copyFileSync(nodeLicense, path.join(licenses, 'node.txt'))
const icon = path.join(dest, 'icon.svg')
fs.writeFileSync(icon, '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="54" fill="#10252c"/><path d="M173 66a78 78 0 1 0 0 124" fill="none" stroke="#2dd4bf" stroke-width="23" stroke-linecap="round"/><path d="m153 62-20 70h38l-22 64 65-93h-41l22-41z" fill="#fb923c"/></svg>')
const quote = value => `"${value.replace(/([\\"`$])/g, '\\$1')}"`
const launcher = path.join(base, 'launch.sh')
fs.writeFileSync(launcher, `#!/bin/sh\nexec ${quote(path.join(dest, 'node'))} ${quote(path.join(dest, 'scripts/desktop-launch.mjs'))} "$@"\n`, { mode: 0o755 })
const desktop = `[Desktop Entry]\nType=Application\nName=Corelith Studio\nComment=Vector design and laser job preparation\nExec=${quote(launcher)}\nIcon=${icon}\nTerminal=false\nCategories=Graphics;Engineering;\nStartupWMClass=CorelithStudio\n`
const apps = path.join(os.homedir(), '.local/share/applications')
fs.mkdirSync(apps, { recursive: true })
const entry = path.join(apps, 'corelith-studio.desktop')
fs.writeFileSync(entry, desktop, { mode: 0o755 })
const desktopDir = spawnSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' }).stdout?.trim()
if (desktopDir && fs.existsSync(desktopDir)) {
  const shortcut = path.join(desktopDir, 'Corelith Studio.desktop')
  fs.writeFileSync(shortcut, desktop, { mode: 0o755 })
  spawnSync('gio', ['set', shortcut, 'metadata::trusted', 'true'])
}
spawnSync('update-desktop-database', [apps])
console.log(JSON.stringify({ installed: dest, launcher, entry, sourcePreserved: source }, null, 2))
