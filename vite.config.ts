// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRuidaMiddleware } from './server/ruidaBridge.mjs'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// PDF resources stay local in development and in the installed offline app.
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  fs.cpSync(fileURLToPath(new URL(`./node_modules/pdfjs-dist/${folder}`, import.meta.url)),
    fileURLToPath(new URL(`./public/pdfjs/${folder}`, import.meta.url)), {recursive:true})
}

function ruidaLaserBridgePlugin() {
  const middleware = createRuidaMiddleware({ writesEnabled: process.env.RUIDA_ALLOW_WRITES === '1' })
  return {
    name: 'ruida-laser-bridge',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}
export default defineConfig({
  plugins: [react(), ruidaLaserBridgePlugin()],
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
  preview: { host: '127.0.0.1', port: 5179, strictPort: true },
})
