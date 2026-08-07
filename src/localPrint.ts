import { buildPdfFileName, buildPrintDocument } from './printDocument'
import type { PiPrintPayload } from './types'

const PRINT_WORKSPACE_SESSION_ID = createPrintWorkspaceSessionId()
const PRINT_WORKSPACE_NAME = `feishu-bitable-print-workspace-${PRINT_WORKSPACE_SESSION_ID}`
const PRINT_ASSET_WAIT_TIMEOUT_MS = 5000

export function getPrintRuntimeLabel(): string {
  return '浏览器本地（单据数据不会上传）'
}

export async function checkLocalPrint(): Promise<boolean> {
  return typeof window !== 'undefined' && typeof window.print === 'function'
}

export async function openPrintWorkspace(payload: PiPrintPayload): Promise<void> {
  const printWindow = window.open(
    '',
    PRINT_WORKSPACE_NAME,
    'popup=yes,width=1180,height=880,resizable=yes,scrollbars=yes',
  )
  if (!printWindow) {
    throw new Error('浏览器拦截了独立打印窗口，请允许弹出窗口后重试。')
  }

  printWindow.document.open()
  printWindow.document.write(buildPrintWorkspaceDocument(payload))
  printWindow.document.close()
  wirePrintWorkspaceControls(printWindow)

  try {
    printWindow.opener = null
  } catch {
    // Some embedded hosts expose a read-only opener. The window remains usable without this hardening.
  }

  await waitForPrintAssets(printWindow)
  printWindow.focus()
}

function buildPrintWorkspaceDocument(payload: PiPrintPayload): string {
  const documentHtml = buildPrintDocument({
    ...payload,
    designMode: false,
    selectedDesignId: undefined,
  }).replace("script-src 'unsafe-inline'", "script-src 'none'")
  const title = buildPdfFileName(payload)
  const documentCount = payload.documents.length
  const itemCount = payload.documents.reduce((total, document) => total + document.items.length, 0)
  const toolbarStyles = `
    .print-workspace-toolbar {
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
    .print-workspace-summary {
      min-width: 0;
      display: grid;
      gap: 3px;
    }
    .print-workspace-summary strong {
      overflow: hidden;
      color: #17262e;
      font-size: 14px;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .print-workspace-summary span {
      color: #667585;
      font-size: 12px;
      line-height: 1.45;
    }
    .print-workspace-actions {
      display: flex;
      flex: 0 0 auto;
      gap: 8px;
    }
    .print-workspace-actions button {
      min-height: 36px;
      padding: 0 14px;
      border: 1px solid #b9c7d5;
      border-radius: 7px;
      color: #17262e;
      background: #ffffff;
      font: 700 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }
    .print-workspace-actions button:hover {
      border-color: #6e879c;
      background: #f4f8fb;
    }
    .print-workspace-actions button:focus-visible {
      outline: 3px solid rgba(29, 92, 255, 0.28);
      outline-offset: 2px;
    }
    .print-workspace-actions .print-workspace-primary {
      border-color: #155eef;
      color: #ffffff;
      background: #155eef;
    }
    @media (max-width: 680px) {
      .print-workspace-toolbar {
        align-items: stretch;
        flex-direction: column;
      }
      .print-workspace-actions button {
        flex: 1 1 0;
      }
    }
    @media print {
      .print-workspace-toolbar {
        display: none !important;
      }
    }
  `
  const toolbarMarkup = `<header class="print-workspace-toolbar">
    <div class="print-workspace-summary">
      <strong>${escapeHtml(title)}</strong>
      <span>本次快照 · ${documentCount} 条单据 · ${itemCount} 行明细 · 数据仅保留在此窗口</span>
    </div>
    <div class="print-workspace-actions">
      <button id="print-workspace-close" type="button">关闭窗口</button>
      <button class="print-workspace-primary" id="print-workspace-print" type="button">打印 / 另存 PDF</button>
    </div>
  </header>`

  return documentHtml
    .replace('</head>', `<style>${toolbarStyles}</style></head>`)
    .replace(/<body([^>]*)>/, `<body$1>${toolbarMarkup}`)
}

function wirePrintWorkspaceControls(target: Window): void {
  const closeButton = target.document.getElementById('print-workspace-close')
  const printButton = target.document.getElementById('print-workspace-print')
  if (!closeButton || !printButton) {
    throw new Error('独立打印窗口初始化失败，请关闭窗口后重试。')
  }

  closeButton.addEventListener('click', () => target.close())
  printButton.addEventListener('click', () => target.print())
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

function createPrintWorkspaceSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
