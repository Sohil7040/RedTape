import { Font, parse } from 'opentype.js'
import { rotateSubpaths } from './geometry'
import { Shape } from './model'
import { parseSvgPathD } from './svgIO'

// The canvas and outline conversion use the same bundled fonts, offline.
export function textFontFamily(family: string): string {
  if (family === 'Courier New') return 'Corelith Mono'
  if (family === 'Georgia' || family === 'Times New Roman') return 'Corelith Serif'
  if (family === 'Arial' || family === 'Arial Black') return 'Corelith Sans'
  throw new Error(`Unsupported text font: ${family}. Choose a bundled family in Typography.`)
}
export function textFontWeight(weight: number): number { return weight >= 600 ? 700 : 400 }
export function fontAsset(family: string, weight: number): string {
  const group = textFontFamily(family).split(' ')[1]
  return `/fonts/Liberation${group}-${textFontWeight(weight) === 700 ? 'Bold' : 'Regular'}.ttf`
}
const fonts = new Map<string, Promise<Font>>()
export function loadTextFont(shape: Shape): Promise<Font> {
  if (!shape.text) return Promise.reject(new Error('No text to convert'))
  const url = fontAsset(shape.text.fontFamily, shape.text.fontWeight)
  if (!fonts.has(url)) fonts.set(url, fetch(url).then(res => {
    if (!res.ok) throw new Error('Could not load the local outline font. Retry after the app finishes loading.')
    return res.arrayBuffer()
  }).then(data => parse(data)).catch(err => { fonts.delete(url); throw err }))
  return fonts.get(url)!
}

export function textShapeToCurves(shape: Shape, font: Font): Shape {
  const t = shape.text
  if (shape.kind !== 'text' || !t) throw new Error('Select a text object to convert')
  if (!t.content.trim()) throw new Error(`“${shape.name}” contains no visible text. Delete it or set its layer to Ignore.`)
  if (!Number.isFinite(t.fontSize) || t.fontSize <= 0) throw new Error('Text size must be positive')
  if (t.content.length > 10000) throw new Error('Convert text in sections of at most 10,000 characters')
  // Do not silently emit unshaped script, missing-glyph boxes, or lost combining marks.
  if (/[\p{Mark}\u0590-\u109f\u1780-\u17ff\u200c-\u200f\u202a-\u202e]/u.test(t.content)) {
    throw new Error('This text needs script shaping. Convert it to paths in a shaping-capable vector editor and import SVG.')
  }
  for (const char of t.content.replace(/\n/g, '')) {
    if (!font.charToGlyphIndex(char)) throw new Error(`The bundled font has no outline for “${char}”. Choose supported text or import outlined SVG.`)
  }
  // Disable optional ligatures so spacing and canvas text stay predictable.
  const options = { kerning: true, letterSpacing: t.letterSpacing / t.fontSize, features: { liga: false, rlig: false } }
  const subpaths = t.content.split('\n').flatMap((line, i) => {
    const width = font.getAdvanceWidth(line, t.fontSize, options)
    const x = t.align === 'center' ? t.box.x + (t.box.w - width) / 2 :
      t.align === 'right' || t.align === 'end' ? t.box.x + t.box.w - width : t.box.x
    const path = font.getPath(line, x, t.box.y + t.fontSize * .82 + i * t.fontSize * 1.12, t.fontSize, options)
    // TrueType contours are implicitly closed; the parser can omit Z records.
    return parseSvgPathD(path.toPathData(8)).map(sub => {
      const first = sub.nodes[0], last = sub.nodes[sub.nodes.length - 1]
      if (sub.nodes.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-7) {
        first.in = { ...last.in }; sub.nodes.pop()
      }
      return { ...sub, closed: true }
    })
  })
  if (!subpaths.length) throw new Error('Text produced no outlines')
  return {
    ...shape, kind: 'path', text: undefined, fillRule: 'nonzero',
    subpaths: t.rotation ? rotateSubpaths(subpaths, { x: t.box.x + t.box.w / 2, y: t.box.y + t.box.h / 2 }, t.rotation) : subpaths,
    meta: { ...shape.meta, originalText: t.content, outlineFont: `${textFontFamily(t.fontFamily)} ${textFontWeight(t.fontWeight)}` },
  }
}
