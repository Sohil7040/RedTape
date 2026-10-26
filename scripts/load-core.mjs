import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// Compile the same TypeScript used by the app for offline CLI tools/tests.
export async function loadCore() {
  const result = await build({
    stdin: { contents: `export * from './src/core/transferPresentation'; export * from './src/core/workspace'; export * from './src/core/bitmapTrace'; export * from './src/core/snapping'; export * from './src/core/machiningCurves'; export * from './src/core/nativeCurveMath'; export * from './src/core/ruidaIO'; export * from './src/core/model'; export * from './src/core/geometry'; export * from './src/core/production'; export * from './src/core/svgIO'; export * from './src/core/vectorIO'; export * from './src/core/store'; export * from './src/core/exporters'; export * from './src/core/laserClient'; export * from './src/core/patterns'; export * from './src/core/booleans'; export * from './src/core/knife'; export * from './src/core/textCurves'; export { drawShape, drawDraft } from './src/render/renderer'`,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022',
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
}
