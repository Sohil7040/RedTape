#!/usr/bin/env node
/** Offline SVG conversion. Uses the app's geometry, production and RD encoder.
 * Usage: node scripts/convert_svg.mjs input.svg output --width-mm 100
 * This CLI accepts untransformed paths, rectangles and circles. Use the app
 * for grouped/transformed SVG. No network or controller access is performed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadCore } from './load-core.mjs'

export async function convertSvgToRuida(svgPath, outputPrefix = 'output', options = {}) {
  const c = await loadCore()
  const svg = fs.readFileSync(svgPath, 'utf8')
  if (/\btransform\s*=|<(?:use|text|image|ellipse|line|polygon|polyline|clipPath|mask)\b/i.test(svg)) {
    throw new Error('CLI supports untransformed path, rect and circle elements only; import this SVG in the app')
  }
  const attr = (tag, name) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]
  const shapes = []
  for (const match of svg.matchAll(/<(path|rect|circle)\b[^>]*>/gi)) {
    const [tag, type] = match
    if (type.toLowerCase() === 'path') {
      const d = attr(tag, 'd') || ''
      if (/[aqt]/i.test(d)) throw new Error('Unsupported SVG path command (A/Q/T); convert to cubic curves first')
      shapes.push(c.makeShape('path', c.parseSvgPathD(d)))
    } else if (type.toLowerCase() === 'rect') {
      if (Number(attr(tag, 'rx')) || Number(attr(tag, 'ry'))) throw new Error('Rounded rectangles require conversion to curves')
      shapes.push(c.createRectShape(Number(attr(tag, 'x') || 0), Number(attr(tag, 'y') || 0),
        Number(attr(tag, 'width')), Number(attr(tag, 'height'))))
    } else {
      const r = Number(attr(tag, 'r'))
      shapes.push(c.createEllipseShape(Number(attr(tag, 'cx') || 0), Number(attr(tag, 'cy') || 0), r, r))
    }
  }
  if (!shapes.length) throw new Error('No supported vector geometry in SVG')
  const bounds = c.selectionBounds(shapes)
  const targetWidth = Number(options.widthMm)
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) {
    throw new Error('Specify --width-mm for the physical artwork width; SVG pixels are not millimeters')
  }
  const scale = targetWidth / bounds.w
  for (const shape of shapes) for (const sub of shape.subpaths) for (const node of sub.nodes) {
    for (const point of [node, node.in, node.out]) if (point) {
      point.x = (point.x - bounds.x) * scale + 20
      point.y = (point.y - bounds.y) * scale + 20
    }
  }
  const name = c.ruidaFilename(path.basename(outputPrefix))
  const doc = c.createBlankDocument({ name })
  doc.layers[0].shapes = shapes
  doc.production.leadIn = 0; doc.production.leadOut = 0; doc.production.kerf = 0
  doc.production.layers[doc.layers[0].id] = { ...c.defaultLayerOperation('cut'),
    speed: Number(options.speed ?? 30), power: Number(options.power ?? 50),
    minPower: Number(options.minPower ?? options.power ?? 50), maxPower: Number(options.power ?? 50), passes: 1 }
  const bytes = c.buildJobRD(doc, name)
  const rdFile = `${outputPrefix}.rd`, dxfFile = `${outputPrefix}.dxf`
  fs.writeFileSync(rdFile, bytes)
  fs.writeFileSync(dxfFile, c.buildJobDXF(doc))
  console.log(`Offline export: ${rdFile} (${bytes.length} bytes), ${dxfFile}; width ${targetWidth} mm, speed ${doc.production.layers[doc.layers[0].id].speed} mm/s, power ${doc.production.layers[doc.layers[0].id].minPower}–${doc.production.layers[doc.layers[0].id].maxPower}%`)
  return { rdFile, dxfFile, bytes: bytes.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, prefix, ...rest] = process.argv.slice(2)
  const options = {}
  for (let i = 0; i < rest.length; i += 2) {
    const key = { '--width-mm': 'widthMm', '--speed': 'speed', '--power': 'power', '--min-power': 'minPower' }[rest[i]]
    if (!key || rest[i + 1] === undefined) throw new Error('Unknown or missing CLI option')
    options[key] = rest[i + 1]
  }
  try {
    if (!input) throw new Error('Usage: node scripts/convert_svg.mjs input.svg output --width-mm 100')
    await convertSvgToRuida(input, prefix || path.basename(input, path.extname(input)), options)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
