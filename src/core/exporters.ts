import { pathToSvgD } from './geometry'
import { DocumentModel, shapeBounds } from './model'
import { EditorState } from './store'
import { drawShape, meshFillCanvas } from '../render/renderer'

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function safeName(name: string): string {
  return name.replace(/[^\w\-. ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'corelith-artwork'
}

export async function exportPNG(state: EditorState, scale = 300 / 25.4): Promise<void> {
  const page = state.doc.page
  const w = Math.round(page.width * scale), h = Math.round(page.height * scale)
  if (!Number.isFinite(w*h) || w < 1 || h < 1 || w > 16384 || h > 16384 || w*h > 64000000) throw new Error('PNG at 300 DPI exceeds the 64-megapixel limit. Export SVG or use a smaller page.')
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas export is unavailable')
  ctx.fillStyle = page.color
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(scale, scale)
  const exportState: EditorState = { ...state, view: { ...state.view, zoom: scale, panX: 0, panY: 0 } }
  for (const layer of state.doc.layers) {
    if (!layer.visible) continue
    for (const shape of layer.shapes) {
      if (shape.hidden) continue
      drawShape(ctx, shape, exportState)
    }
  }
  ctx.restore()
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG rendering failed')), 'image/png'))
  downloadBlob(blob, `${safeName(state.doc.name)}-${Math.round(scale * 25.4)}dpi.png`)
}

export function exportSVG(state: EditorState): void {
  downloadBlob(new Blob([buildSVG(state)], { type: 'image/svg+xml' }), `${safeName(state.doc.name)}.svg`)
}

export function buildSVG(state: EditorState): string {
  const doc = state.doc
  const W = doc.page.width, H = doc.page.height
  const defs: string[] = []
  const body: string[] = []
  let defId = 0
  const unique = (prefix: string) => `${prefix}-${++defId}`

  for (const layer of doc.layers) {
    if (!layer.visible) continue
    const shapes: string[] = []
    for (const shape of layer.shapes) {
      if (shape.hidden) continue
      const b = shapeBounds(shape)
      const attrs: string[] = []
      let fill = 'none'
      let meshHref: string | null = null
      let meshClipId: string | null = null
      if (shape.fill.type === 'solid') {
        fill = shape.fill.color
        if (shape.fill.opacity < 1) attrs.push(`fill-opacity="${shape.fill.opacity}"`)
      } else if (shape.fill.type === 'linear') {
        const id = unique('lg')
        const a = (shape.fill.angle * Math.PI) / 180
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2
        const r = Math.hypot(b.w, b.h) / 2
        defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${cx - Math.cos(a) * r}" y1="${cy - Math.sin(a) * r}" x2="${cx + Math.cos(a) * r}" y2="${cy + Math.sin(a) * r}">${shape.fill.stops.map(s => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join('')}</linearGradient>`)
        fill = `url(#${id})`
      } else if (shape.fill.type === 'radial') {
        const id = unique('rg')
        defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" r="${Math.hypot(b.w, b.h) / 2}">${shape.fill.stops.map(s => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join('')}</radialGradient>`)
        fill = `url(#${id})`
      } else if (shape.fill.type === 'mesh') {
        const clipId = unique('meshclip')
        defs.push(`<clipPath id="${clipId}"><path d="${pathToSvgD(shape.subpaths)}" clip-rule="${shape.fillRule}"/></clipPath>`)
        meshHref = meshFillCanvas(shape.fill.stops.map(s => s.color), 96).toDataURL('image/png')
        meshClipId = clipId
        fill = 'none'
      } else if (shape.fill.type === 'pattern') {
        const id = unique('pat')
        const kind = shape.fill.pattern ?? 'dots'
        const inner = kind === 'dots'
          ? `<circle cx="6" cy="6" r="2" fill="${shape.fill.color}"/><circle cx="18" cy="18" r="2" fill="${shape.fill.color}"/>`
          : kind === 'lines'
            ? `<path d="M-4 24 L24 -4 M8 28 L28 8" stroke="${shape.fill.color}" stroke-width="2"/>`
            : `<rect width="12" height="12" fill="${shape.fill.color}"/><rect x="12" y="12" width="12" height="12" fill="${shape.fill.color}"/>`
        defs.push(`<pattern id="${id}" width="24" height="24" patternUnits="userSpaceOnUse">${inner}</pattern>`)
        fill = `url(#${id})`
      }
      let stroke = 'none'
      if (shape.stroke.enabled && shape.stroke.width > 0) {
        stroke = shape.stroke.color
        attrs.push(`stroke-width="${shape.stroke.width}"`, `stroke-linecap="${shape.stroke.cap}"`, `stroke-linejoin="${shape.stroke.join}"`)
        if (shape.stroke.opacity < 1) attrs.push(`stroke-opacity="${shape.stroke.opacity}"`)
        if (shape.stroke.dash.length) attrs.push(`stroke-dasharray="${shape.stroke.dash.join(' ')}"`)
      }
      attrs.push(`stroke="${stroke}"`)
      if (fill !== 'none') attrs.push(`fill="${fill}"`, `fill-rule="${shape.fillRule}"`)
      else attrs.push('fill="none"')
      if (shape.opacity < 1) attrs.push(`opacity="${shape.opacity}"`)
      let filterAttr = ''
      if (shape.shadow.enabled) {
        const id = unique('shadow')
        defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${shape.shadow.x}" dy="${shape.shadow.y}" stdDeviation="${shape.shadow.blur / 2}" flood-color="${shape.shadow.color}" flood-opacity="${shape.shadow.opacity}"/></filter>`)
        filterAttr = ` filter="url(#${id})"`
      }
      let clipAttr = ''
      if (shape.clip?.length) {
        const id = unique('clip')
        defs.push(`<clipPath id="${id}"><path d="${pathToSvgD(shape.clip)}"/></clipPath>`)
        clipAttr = ` clip-path="url(#${id})"`
      }
      if (shape.kind === 'text' && shape.text) {
        const t = shape.text
        const lines = t.content.split('\n')
        const ax = t.align === 'center' ? t.box.x + t.box.w / 2 : t.align === 'right' ? t.box.x + t.box.w : t.box.x
        const content = lines.map((line, i) => `<tspan x="${ax}" y="${t.box.y + t.fontSize * 0.82 + i * t.fontSize * 1.12}">${escapeXml(line)}</tspan>`).join('')
        const anchor = t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start'
        const rot = t.rotation ? ` transform="rotate(${(t.rotation * 180 / Math.PI).toFixed(3)} ${(t.box.x + t.box.w / 2).toFixed(3)} ${(t.box.y + t.box.h / 2).toFixed(3)})"` : ''
        shapes.push(`<g${filterAttr}${clipAttr}><text${rot} font-family="${escapeXml(t.fontFamily)}, Arial, sans-serif" font-weight="${t.fontWeight}" font-size="${t.fontSize}" letter-spacing="${t.letterSpacing}" fill="${fill}" text-anchor="${anchor}" opacity="${shape.opacity}">${content}</text></g>`)
      } else {
        const d = pathToSvgD(shape.subpaths)
        if (meshHref && meshClipId) {
          shapes.push(`<g${filterAttr}><image x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="none" href="${meshHref}" clip-path="url(#${meshClipId})"/></g>`)
          if (stroke !== 'none') {
            const strokeAttrs = attrs.filter(a => a.startsWith('stroke') || a.startsWith('fill=') || a.startsWith('fill-opacity'))
            shapes.push(`<path d="${d}" fill="none" ${strokeAttrs.filter(a => !a.startsWith('fill=')).join(' ')}${filterAttr}${clipAttr}/>`)
          }
        } else {
          shapes.push(`<path d="${d}" ${attrs.join(' ')}${filterAttr}${clipAttr}/>`)
        }
      }
    }
    if (shapes.length) body.push(`<g id="${escapeXml(layer.name.replace(/\s+/g, '-'))}">${shapes.join('')}</g>`)
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n<title>${escapeXml(doc.name)}</title>\n<defs>${defs.join('')}</defs>\n<rect width="${W}" height="${H}" fill="${doc.page.color}"/>\n${body.join('\n')}\n</svg>`
  return svg
}

export function exportProject(doc: DocumentModel): void {
  const payload = { app: 'Corelith Studio', version: 1, savedAt: new Date().toISOString(), doc }
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${safeName(doc.name)}.corelith.json`)
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] ?? c))
}

