import { buildPdfFileName, buildPrintDocument } from './printDocument'
import type { PiPrintPayload } from './types'

const EXPORT_FRAME_WIDTH_PX = 1200
const EXPORT_FRAME_LOAD_TIMEOUT_MS = 6000
const EXPORT_ASSET_WAIT_TIMEOUT_MS = 8000
const EXPORT_IMAGE_FETCH_TIMEOUT_MS = 10_000
const EXPORT_IMAGE_MAX_BYTES = 15 * 1024 * 1024
const EXPORT_IMAGES_MAX_TOTAL_BYTES = 40 * 1024 * 1024
const EXPORT_IMAGE_MAX_COUNT = 100
const EXPORT_IMAGE_MAX_DIMENSION_PX = 12_000
const EXPORT_IMAGE_MAX_PIXELS = 40_000_000
const EXPORT_IMAGES_MAX_TOTAL_PIXELS = 80_000_000
const PDF_RENDER_SCALE = 2
const PDF_MAX_PAGE_LENGTH_MM = 5080
const LONG_IMAGE_MAX_DIMENSION_PX = 30_000
const LONG_IMAGE_MAX_PIXELS = 20_000_000
const PDF_MIN_RENDER_SCALE = 1.25
const LONG_IMAGE_MIN_SCALE = 1.25
const LONG_IMAGE_PREFERRED_SCALE = 2
const LONG_IMAGE_PAGE_GAP_PX = 16

type PreparedExportFrame = {
  document: Document
  dispose: () => void
}

export async function exportPdf(payload: PiPrintPayload): Promise<void> {
  const frame = await prepareExportFrame(payload)

  try {
    const pages = getExportPages(frame.document)
    const html2canvas = (await import('html2canvas')).default
    const { jsPDF } = await import('jspdf')
    let pdf: InstanceType<typeof jsPDF> | null = null

    for (const [index, page] of pages.entries()) {
      const rect = page.getBoundingClientRect()
      const widthMm = pixelsToMillimeters(rect.width)
      const heightMm = pixelsToMillimeters(rect.height)
      if (Math.max(widthMm, heightMm) > PDF_MAX_PAGE_LENGTH_MM) {
        throw new Error('单个排版页面内容过长，无法导出 PDF。请调整模板分页后重试。')
      }
      const orientation = widthMm > heightMm ? 'landscape' : 'portrait'
      const renderScale = calculateSafeCanvasScale(
        rect.width,
        rect.height,
        PDF_RENDER_SCALE,
        PDF_MIN_RENDER_SCALE,
        '单个排版页面内容过长，无法清晰导出 PDF。请调整模板分页后重试。',
      )
      const canvas = await html2canvas(page, buildCanvasOptions(frame.document, renderScale))

      if (!pdf) {
        pdf = new jsPDF({
          compress: true,
          format: [widthMm, heightMm],
          orientation,
          unit: 'mm',
        })
      } else {
        pdf.addPage([widthMm, heightMm], orientation)
      }

      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST')
      releaseCanvas(canvas)

      if (index % 2 === 1) {
        await yieldToBrowser()
      }
    }

    if (!pdf) {
      throw new Error('没有找到可以导出的单据页面。')
    }

    downloadBlob(pdf.output('blob'), buildPdfFileName(payload))
  } catch (error) {
    throw normalizeExportError(error, 'PDF 导出失败，请重试。')
  } finally {
    frame.dispose()
  }
}

export async function exportLongImage(payload: PiPrintPayload): Promise<void> {
  const frame = await prepareExportFrame(payload)

  try {
    const pages = getExportPages(frame.document)
    const pageRects = pages.map((page) => page.getBoundingClientRect())
    const maxWidth = Math.max(...pageRects.map((rect) => rect.width))
    const totalHeight = pageRects.reduce((sum, rect) => sum + rect.height, 0)
    const totalGap = Math.max(0, pages.length - 1) * LONG_IMAGE_PAGE_GAP_PX
    const scale = calculateLongImageScale(maxWidth, totalHeight + totalGap)
    const canvasWidth = Math.ceil(maxWidth * scale)
    const canvasHeight = Math.ceil((totalHeight + totalGap) * scale)
    const longCanvas = document.createElement('canvas')
    longCanvas.width = canvasWidth
    longCanvas.height = canvasHeight
    const context = longCanvas.getContext('2d')
    if (!context) {
      throw new Error('浏览器无法创建长图画布，请改用“导出 PDF”。')
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvasWidth, canvasHeight)
    const html2canvas = (await import('html2canvas')).default
    let y = 0

    for (const page of pages) {
      const pageCanvas = await html2canvas(page, buildCanvasOptions(frame.document, scale))
      const x = Math.max(0, Math.round((canvasWidth - pageCanvas.width) / 2))
      context.drawImage(pageCanvas, x, y)
      y += pageCanvas.height + Math.round(LONG_IMAGE_PAGE_GAP_PX * scale)
      releaseCanvas(pageCanvas)
      await yieldToBrowser()
    }

    const blob = await canvasToBlob(longCanvas, 'image/png')
    releaseCanvas(longCanvas)
    downloadBlob(blob, buildLongImageFileName(payload))
  } catch (error) {
    throw normalizeExportError(error, '长图导出失败，请重试。')
  } finally {
    frame.dispose()
  }
}

async function prepareExportFrame(payload: PiPrintPayload): Promise<PreparedExportFrame> {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.tabIndex = -1
  Object.assign(frame.style, {
    border: '0',
    height: '900px',
    left: '-100000px',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0',
    width: `${EXPORT_FRAME_WIDTH_PX}px`,
  })

  const objectUrls: string[] = []
  const dispose = () => {
    frame.remove()
    objectUrls.forEach((url) => URL.revokeObjectURL(url))
  }

  try {
    const ready = waitForFrameLoad(frame)
    frame.srcdoc = buildExportDocument(payload)
    document.body.append(frame)
    await ready
    const frameDocument = frame.contentDocument
    if (!frameDocument) {
      throw new Error('导出页面初始化失败，请重试。')
    }

    await waitForDocumentAssets(frameDocument)
    await makeImagesCanvasReadable(frameDocument, objectUrls)
    return { document: frameDocument, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}

function buildExportDocument(payload: PiPrintPayload): string {
  const exportStyles = `
    body { background: #ffffff !important; }
    .invoice-stack, .official-stack { gap: 0 !important; padding: 0 !important; }
    .invoice-page, .official-page { box-shadow: none !important; margin: 0 auto !important; }
  `

  const html = buildPrintDocument({
    ...payload,
    designMode: false,
    selectedDesignId: undefined,
  })
    .replace("script-src 'unsafe-inline'", "script-src 'none'")
    .replace('</head>', `<style>${exportStyles}</style></head>`)

  const parsedDocument = new DOMParser().parseFromString(html, 'text/html')
  for (const image of Array.from(parsedDocument.images)) {
    const source = image.getAttribute('src')
    if (source && !source.startsWith('data:') && !source.startsWith('blob:')) {
      image.dataset.exportSource = new URL(source, window.location.href).href
      image.removeAttribute('src')
    }
  }
  return `<!doctype html>${parsedDocument.documentElement.outerHTML}`
}

function waitForFrameLoad(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('导出页面加载超时，请重试。')), EXPORT_FRAME_LOAD_TIMEOUT_MS)
    frame.addEventListener(
      'load',
      () => {
        window.clearTimeout(timeout)
        resolve()
      },
      { once: true },
    )
  })
}

async function waitForDocumentAssets(frameDocument: Document): Promise<void> {
  await Promise.race([
    Promise.all([
      frameDocument.fonts?.ready ?? Promise.resolve(),
      Promise.all(Array.from(frameDocument.images).map(waitForImageToSettle)),
    ]).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, EXPORT_ASSET_WAIT_TIMEOUT_MS)),
  ])
}

async function makeImagesCanvasReadable(frameDocument: Document, objectUrls: string[]): Promise<void> {
  const imagesBySource = new Map<string, HTMLImageElement[]>()
  const embeddedSources = new Set<string>()
  let totalDecodedPixels = 0

  for (const image of Array.from(frameDocument.images)) {
    const source = image.dataset.exportSource || image.currentSrc || image.src
    if (!source || source.startsWith('data:') || source.startsWith('blob:')) {
      ensureImageLoaded(image)
      if (source && !embeddedSources.has(source)) {
        embeddedSources.add(source)
        totalDecodedPixels += validateImageDimensions(image)
        if (totalDecodedPixels > EXPORT_IMAGES_MAX_TOTAL_PIXELS) {
          throw new Error('模板图片的总尺寸过大，无法在浏览器中安全导出。请压缩图片后重试。')
        }
      }
      continue
    }

    let url: URL
    try {
      url = new URL(source, window.location.href)
    } catch {
      throw new Error('模板中有无法识别的图片地址，请更换图片后重试。')
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('模板中的图片格式不支持导出，请改用“打印”。')
    }

    const matchingImages = imagesBySource.get(url.href) ?? []
    matchingImages.push(image)
    imagesBySource.set(url.href, matchingImages)
  }

  if (embeddedSources.size + imagesBySource.size > EXPORT_IMAGE_MAX_COUNT) {
    throw new Error('模板中的图片数量过多，无法在浏览器中安全导出。请减少图片后重试。')
  }

  let totalBytes = 0

  for (const source of imagesBySource.keys()) {
    let result: Awaited<ReturnType<typeof fetchImageObjectUrl>>
    try {
      result = await fetchImageObjectUrl(new URL(source))
    } catch (error) {
      if (error instanceof Error && error.message === 'image-too-large') {
        throw new Error('模板中的某张图片过大，无法在浏览器中安全导出。请压缩图片后重试。')
      }
      throw new Error('模板中的某张图片不允许浏览器导出。请改用“打印”，或更换为允许导出的图片地址。')
    }

    objectUrls.push(result.objectUrl)
    totalBytes += result.size

    if (totalBytes > EXPORT_IMAGES_MAX_TOTAL_BYTES) {
      throw new Error('模板图片总量过大，无法在浏览器中安全导出。请压缩图片后重试。')
    }

    const matchingImages = imagesBySource.get(source) ?? []
    try {
      await Promise.all(matchingImages.map(async (image) => {
        image.src = result.objectUrl
        await waitForImageToSettle(image)
        ensureImageLoaded(image)
      }))
    } catch {
      throw new Error('模板中的某张图片不允许浏览器导出。请改用“打印”，或更换为允许导出的图片地址。')
    }

    const firstImage = matchingImages[0]
    if (firstImage) {
      totalDecodedPixels += validateImageDimensions(firstImage)
      if (totalDecodedPixels > EXPORT_IMAGES_MAX_TOTAL_PIXELS) {
        throw new Error('模板图片的总尺寸过大，无法在浏览器中安全导出。请压缩图片后重试。')
      }
    }
  }
}

function validateImageDimensions(image: HTMLImageElement): number {
  const width = image.naturalWidth
  const height = image.naturalHeight
  const pixels = width * height
  if (
    width > EXPORT_IMAGE_MAX_DIMENSION_PX ||
    height > EXPORT_IMAGE_MAX_DIMENSION_PX ||
    pixels > EXPORT_IMAGE_MAX_PIXELS
  ) {
    throw new Error('模板中的某张图片尺寸过大，无法在浏览器中安全导出。请压缩图片后重试。')
  }
  return pixels
}

async function fetchImageObjectUrl(url: URL): Promise<{ objectUrl: string; size: number }> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), EXPORT_IMAGE_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url.href, {
      credentials: url.origin === window.location.origin ? 'same-origin' : 'omit',
      mode: 'cors',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const announcedBytes = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(announcedBytes) && announcedBytes > EXPORT_IMAGE_MAX_BYTES) {
      throw new Error('image-too-large')
    }

    const blob = await readResponseBlobWithLimit(response, EXPORT_IMAGE_MAX_BYTES)
    return { objectUrl: URL.createObjectURL(blob), size: blob.size }
  } finally {
    window.clearTimeout(timeout)
  }
}

async function readResponseBlobWithLimit(response: Response, limit: number): Promise<Blob> {
  if (!response.body) {
    const blob = await response.blob()
    if (blob.size > limit) {
      throw new Error('image-too-large')
    }
    return blob
  }

  const reader = response.body.getReader()
  const chunks: ArrayBuffer[] = []
  let size = 0

  try {
    while (true) {
      const result = await reader.read()
      if (result.done) {
        break
      }
      size += result.value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error('image-too-large')
      }
      chunks.push(Uint8Array.from(result.value).buffer)
    }
  } finally {
    reader.releaseLock()
  }

  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' })
}

function getExportPages(frameDocument: Document): HTMLElement[] {
  const pages = Array.from(frameDocument.querySelectorAll<HTMLElement>('.print-page, .invoice-page'))
  if (!pages.length) {
    throw new Error('没有找到可以导出的单据页面。')
  }
  return pages
}

function buildCanvasOptions(frameDocument: Document, scale: number) {
  return {
    allowTaint: false,
    backgroundColor: '#ffffff',
    logging: false,
    scale,
    useCORS: true,
    windowHeight: Math.max(frameDocument.documentElement.scrollHeight, 900),
    windowWidth: EXPORT_FRAME_WIDTH_PX,
  }
}

function calculateLongImageScale(width: number, height: number): number {
  return calculateSafeCanvasScale(
    width,
    height,
    LONG_IMAGE_PREFERRED_SCALE,
    LONG_IMAGE_MIN_SCALE,
    '单据内容过长，无法生成一张清晰长图。请减少勾选记录，或改用“导出 PDF”。',
  )
}

function calculateSafeCanvasScale(
  width: number,
  height: number,
  preferredScale: number,
  minimumScale: number,
  errorMessage: string,
): number {
  const dimensionScale = LONG_IMAGE_MAX_DIMENSION_PX / Math.max(width, height)
  const pixelScale = Math.sqrt(LONG_IMAGE_MAX_PIXELS / Math.max(width * height, 1))
  const scale = Math.min(preferredScale, dimensionScale, pixelScale)

  if (!Number.isFinite(scale) || scale < minimumScale) {
    throw new Error(errorMessage)
  }

  return scale
}

function waitForImageToSettle(image: HTMLImageElement): Promise<void> {
  if (image.complete) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    image.addEventListener('load', () => resolve(), { once: true })
    image.addEventListener('error', () => resolve(), { once: true })
  })
}

function ensureImageLoaded(image: HTMLImageElement) {
  if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new Error('模板中的某张图片加载失败，请检查图片后重试。')
  }
}

function pixelsToMillimeters(pixels: number): number {
  return Math.max(1, (pixels * 25.4) / 96)
}

function buildLongImageFileName(payload: PiPrintPayload): string {
  return buildPdfFileName(payload).replace(/\.pdf$/i, '-long.png')
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  window.setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  }, 60_000)
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('浏览器没有生成图片文件，请重试。'))
        }
      }, type)
    } catch {
      reject(new Error('模板中的图片不允许浏览器导出，请改用“打印”。'))
    }
  })
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 1
  canvas.height = 1
}

function normalizeExportError(error: unknown, fallback: string): Error {
  if (error instanceof DOMException && error.name === 'SecurityError') {
    return new Error('模板中的图片不允许浏览器导出。请改用“打印”，或更换为允许导出的图片地址。')
  }
  if (error instanceof Error && /taint|cross-origin|security/i.test(error.message)) {
    return new Error('模板中的图片不允许浏览器导出。请改用“打印”，或更换为允许导出的图片地址。')
  }
  return error instanceof Error ? error : new Error(fallback)
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}
