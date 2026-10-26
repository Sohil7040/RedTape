import type { BitmapPixels } from './bitmapTrace'

export interface ImportMedia {
  pages: number
  render: (page: number) => Promise<{ pixels: BitmapPixels; preview: string; widthMm: number; heightMm: number }>
  close: () => Promise<void>
}
export const isMediaFile = (name: string) => /\.(pdf|png|jpe?g|webp|bmp|gif)$/i.test(name)
const MAX_FILE = 50*1024*1024
function readCanvas(canvas: HTMLCanvasElement, widthMm: number, heightMm: number) {
  const context=canvas.getContext('2d',{willReadFrequently:true})
  if(!context)throw new Error('Image rendering is unavailable')
  const pixels=context.getImageData(0,0,canvas.width,canvas.height)
  return {pixels,preview:canvas.toDataURL('image/png'),widthMm,heightMm}
}
export async function openImportMedia(file: File): Promise<ImportMedia> {
  if(!isMediaFile(file.name))throw new Error('Choose PDF, PNG, JPEG, WebP, BMP or GIF')
  if(file.size>MAX_FILE)throw new Error('Image/PDF import is limited to 50 MB per file')
  if(/\.pdf$/i.test(file.name)) {
    const pdfjs=await import('pdfjs-dist')
    const {default:workerUrl}=await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc=workerUrl
    const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),
      cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',
      wasmUrl:'/pdfjs/wasm/'})
    task.onPassword=()=>{void task.destroy()}
    let pdf
    try { pdf=await task.promise } catch(error) { await task.destroy(); throw new Error(error instanceof Error && /password|destroy/i.test(error.message)?'Password-protected PDFs must be unlocked before import':`Could not open PDF: ${error instanceof Error?error.message:'invalid file'}`) }
    if(pdf.numPages>1000){await task.destroy();throw new Error('PDF import supports at most 1000 pages. Split this document first.')}
    return {pages:pdf.numPages,close:()=>task.destroy(),render:async(pageNumber)=>{
      if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>pdf.numPages)throw new Error('Choose a valid PDF page')
      const page=await pdf.getPage(pageNumber), base=page.getViewport({scale:1})
      if(!Number.isFinite(base.width)||!Number.isFinite(base.height)||base.width<=0||base.height<=0)throw new Error('PDF page has invalid dimensions')
      const viewport=page.getViewport({scale:1024/Math.max(base.width,base.height)})
      const canvas=document.createElement('canvas')
      canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height))
      try { await page.render({canvas,viewport,background:'#ffffff'}).promise
        return readCanvas(canvas,base.width*25.4/72,base.height*25.4/72)
      } finally {page.cleanup()}
    }}
  }
  const url=URL.createObjectURL(file), image=new Image()
  try {
    image.src=url; await image.decode()
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40000000)throw new Error('Image must contain at most 40 million pixels')
    const scale=Math.min(1,1024/Math.max(image.naturalWidth,image.naturalHeight))
    const canvas=document.createElement('canvas')
    canvas.width=Math.max(1,Math.floor(image.naturalWidth*scale));canvas.height=Math.max(1,Math.floor(image.naturalHeight*scale))
    const context=canvas.getContext('2d')!
    context.drawImage(image,0,0,canvas.width,canvas.height)
    const result=readCanvas(canvas,image.naturalWidth*25.4/96,image.naturalHeight*25.4/96)
    return {pages:1,render:async()=>result,close:async()=>{}}
  } finally {URL.revokeObjectURL(url)}
}
