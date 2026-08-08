import { buildPdfFileName, buildPrintDocument } from './printDocument'
import type { PiPrintPayload } from './types'

const DIRECT_PRINT_SESSION_ID = createDirectPrintSessionId()
const DIRECT_PRINT_WINDOW_NAME = `feishu-bitable-direct-print-${DIRECT_PRINT_SESSION_ID}`
const PRINT_ASSET_WAIT_TIMEOUT_MS = 5000

export function getPrintRuntimeLabel(): string {
  return '浏览器本地（单据数据不会上传）'
}

export async function checkLocalPrint(): Promise<boolean> {
  return typeof window !== 'undefined' && typeof window.print === 'function'
}

export async function printDirectly(payload: PiPrintPayload): Promise<void> {
  const printWindow = window.open(
    '',
    DIRECT_PRINT_WINDOW_NAME,
    'popup=yes,width=1180,height=880,resizable=yes,scrollbars=yes',
  )
  if (!printWindow) {
    throw new Error('浏览器阻止了打印，请允许弹出式窗口后重试。')
  }

  try {
    printWindow.document.open()
    printWindow.document.write(buildDirectPrintDocument(payload))
    printWindow.document.close()
    const enableManualPrint = wireDirectPrintControls(printWindow)

    try {
      printWindow.opener = null
    } catch {
      // Some embedded hosts expose a read-only opener. Printing still works without this hardening.
    }

    await waitForPrintAssets(printWindow)
    if (printWindow.closed) {
      return
    }

    printWindow.addEventListener(
      'afterprint',
      () => {
        window.setTimeout(() => {
          if (!printWindow.closed) {
            printWindow.close()
          }
        }, 0)
      },
      { once: true },
    )
    enableManualPrint()
    printWindow.focus()
    printWindow.print()
  } catch (error) {
    if (!printWindow.closed) {
      printWindow.close()
    }
    throw error
  }
}

function buildDirectPrintDocument(payload: PiPrintPayload): string {
  const documentHtml = buildPrintDocument({
    ...payload,
    designMode: false,
    selectedDesignId: undefined,
  }).replace("script-src 'unsafe-inline'", "script-src 'none'")
  const title = buildPdfFileName(payload)
  const documentCount = payload.documents.length
  const itemCount = payload.documents.reduce((total, document) => total + document.items.length, 0)
  const toolbarStyles = `
    .direct-print-toolbar {
      position: sticky;
      top: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 64px;
      padding: 10px 18px;
      border-bottom: 1px solid #dce3ea;
      color: #17262e;
      background: rgba(255, 255, 255, 0.97);
      box-shadow: 0 8px 24px rgba(31, 48, 64, 0.12);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-sizing: border-box;
      backdrop-filter: blur(12px);
    }
    .direct-print-summary {
      min-width: 0;
      display: grid;
      gap: 3px;
    }
    .direct-print-summary strong {
      overflow: hidden;
      color: #17262e;
      font-size: 14px;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .direct-print-summary span {
      color: #667585;
      font-size: 12px;
      line-height: 1.45;
    }
    .direct-print-actions {
      display: flex;
      flex: 0 0 auto;
      gap: 8px;
    }
    .direct-print-actions button {
      min-height: 36px;
      padding: 0 14px;
      border: 1px solid #b9c7d5;
      border-radius: 7px;
      color: #17262e;
      background: #ffffff;
      font: 700 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }
    .direct-print-actions button:hover {
      border-color: #6e879c;
      background: #f4f8fb;
    }
    .direct-print-actions button:disabled {
      border-color: #cbd5df;
      color: #7b8794;
      background: #eef2f6;
      cursor: wait;
    }
    .direct-print-actions button:focus-visible {
      outline: 3px solid rgba(29, 92, 255, 0.28);
      outline-offset: 2px;
    }
    .direct-print-actions .direct-print-primary {
      border-color: #155eef;
      color: #ffffff;
      background: #155eef;
    }
    @media (max-width: 680px) {
      .direct-print-toolbar {
        align-items: stretch;
        flex-direction: column;
      }
      .direct-print-actions button {
        flex: 1 1 0;
      }
    }
    @media print {
      .direct-print-toolbar {
        display: none !important;
      }
    }
  `
  const toolbarMarkup = `<header class="direct-print-toolbar">
    <div class="direct-print-summary">
      <strong>${escapeHtml(title)}</strong>
      <span id="direct-print-status" role="status">正在准备字体和图片，完成后会自动打开系统打印 · ${documentCount} 条单据 · ${itemCount} 行明细</span>
    </div>
    <div class="direct-print-actions">
      <button id="direct-print-close" type="button">关闭</button>
      <button class="direct-print-primary" disabled id="direct-print-retry" type="button">正在准备…</button>
    </div>
  </header>`

  return documentHtml
    .replace('</head>', `<style>${toolbarStyles}</style></head>`)
    .replace(/<body([^>]*)>/, `<body$1>${toolbarMarkup}`)
}

function wireDirectPrintControls(target: Window): () => void {
  const closeButton = target.document.getElementById('direct-print-close')
  const printButton = target.document.getElementById('direct-print-retry') as HTMLButtonElement | null
  const status = target.document.getElementById('direct-print-status')
  if (!closeButton || !printButton || !status) {
    throw new Error('临时打印页初始化失败，请关闭后重试。')
  }

  closeButton.addEventListener('click', () => target.close())
  printButton.addEventListener('click', () => target.print())

  return () => {
    status.textContent = '系统打印没有自动出现？请点击页面上的“打印”按钮。'
    printButton.disabled = false
    printButton.textContent = '打印 / 另存 PDF'
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

async function waitForPrintAssets(target: Window): Promise<void> {
  await Promise.race([
    waitForPrintAssetsToSettle(target),
    new Promise<void>((resolve) => window.setTimeout(resolve, PRINT_ASSET_WAIT_TIMEOUT_MS)),
  ])
}

async function waitForPrintAssetsToSettle(target: Window): Promise<void> {
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

function createDirectPrintSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
