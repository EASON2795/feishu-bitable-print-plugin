import { buildPrintDocument } from './printDocument'
import type { PiPrintPayload } from './types'

export function getPrintRuntimeLabel(): string {
  return '浏览器本地（单据数据不会上传）'
}

export async function checkLocalPrint(): Promise<boolean> {
  return typeof window !== 'undefined' && typeof window.print === 'function'
}

export async function previewPrint(payload: PiPrintPayload): Promise<void> {
  await openBrowserPrintDialog(payload)
}

export async function saveAsPdf(payload: PiPrintPayload): Promise<void> {
  await openBrowserPrintDialog(payload)
}

async function openBrowserPrintDialog(payload: PiPrintPayload): Promise<void> {
  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    throw new Error('浏览器拦截了打印窗口，请允许弹出窗口后重试。')
  }

  printWindow.document.open()
  printWindow.document.write(buildPrintDocument(payload))
  printWindow.document.close()

  await waitForPrintAssets(printWindow)
  printWindow.focus()
  printWindow.print()
}

async function waitForPrintAssets(target: Window): Promise<void> {
  if (target.document.readyState !== 'complete') {
    await new Promise<void>((resolve) => {
      target.addEventListener('load', () => resolve(), { once: true })
      window.setTimeout(resolve, 3000)
    })
  }

  await target.document.fonts?.ready
  await Promise.all(
    Array.from(target.document.images).map((image) => {
      if (image.complete) {
        return Promise.resolve()
      }

      return new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
      })
    }),
  )
}
