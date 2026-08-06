import { TEMPLATE_REGISTRY } from './piConfig'
import { clonePrintSettings } from './templateDefaults'
import {
  OFFICIAL_LAYOUT_TEMPLATE_ID,
  type DocumentKind,
  type ItemColumnKey,
  type OfficialTemplateSummary,
  type PrintTemplate,
} from './types'

const ITEM_KEYS: ItemColumnKey[] = [
  'itemName',
  'specification',
  'quantity',
  'unit',
  'unitPrice',
  'subtotal',
]

type OfficialTemplateExport = {
  name?: string
  content?: string
}

type OfficialTemplateContent = {
  document?: {
    pages?: OfficialPage[]
  }
  pageSetting?: {
    paddingTop?: number
    paddingBottom?: number
    paddingLeft?: number
    paddingRight?: number
  }
  settings?: Record<string, unknown>
}

type OfficialPage = {
  rows?: OfficialRow[]
}

type OfficialRow = {
  columns?: OfficialColumn[]
}

type OfficialColumn = {
  blocks?: OfficialBlock[]
}

type OfficialBlock = {
  type?: number
  content?: OfficialParagraph[]
  table?: OfficialTable
}

type OfficialTable = {
  columns?: { width?: number }[]
  rows?: { cells?: OfficialCell[] }[]
  dynamicRows?: OfficialDynamicRow[]
}

type OfficialCell = {
  content?: OfficialParagraph[]
}

type OfficialParagraph = {
  children?: OfficialTextNode[]
}

type OfficialTextNode = {
  text?: string
  name?: string[]
  pathName?: string
  children?: OfficialTextNode[]
}

type OfficialDynamicRow = {
  dataSource?: {
    rootPath?: string[]
  }
}

export function importTemplateFromText(fileName: string, rawText: string): PrintTemplate {
  const exported = parseOfficialExport(rawText)
  const content = exported.content ? (JSON.parse(exported.content) as OfficialTemplateContent) : null
  const base = TEMPLATE_REGISTRY[0]
  const settings = clonePrintSettings(base.printSettings)
  const pages = content?.document?.pages ?? []
  const blocks = pages.flatMap((page) =>
    (page.rows ?? []).flatMap((row) => (row.columns ?? []).flatMap((column) => column.blocks ?? [])),
  )

  const companyTable = blocks.find((block) => block.table?.rows && block.table.rows.length >= 3)?.table
  const companyRows = companyTable?.rows?.map((row) => row.cells?.map(cellText).join(' ').trim()).filter(Boolean)
  if (companyRows?.[0]) settings.text.companyName = companyRows[0]
  if (companyRows?.[1]) settings.text.companyAddress = companyRows[1]
  if (companyRows?.[2]) settings.text.companyContact = companyRows[2]

  const titleBlock = blocks
    .filter((block) => !block.table)
    .map(blockText)
    .find((text) => /invoice|packing|purchase|发票|装箱|采购/i.test(text))
  if (titleBlock) {
    settings.text.documentTitle = titleBlock
  }

  const itemTable = blocks.find((block) => {
    const columnCount = block.table?.columns?.length ?? 0
    return columnCount === 6 && (block.table?.dynamicRows?.length ?? 0) > 0
  })?.table
  const headers = itemTable?.rows?.[0]?.cells?.map(cellText) ?? []
  ITEM_KEYS.forEach((key, index) => {
    if (headers[index]) {
      settings.text.itemHeaders[key] = headers[index]
    }
  })
  ITEM_KEYS.forEach((key, index) => {
    const width = itemTable?.columns?.[index]?.width
    if (typeof width === 'number' && Number.isFinite(width)) {
      settings.layout.columnWidths[key] = width
    }
  })

  const allCellText = blocks
    .flatMap((block) => block.table?.rows ?? [])
    .flatMap((row) => row.cells ?? [])
    .map(cellText)

  settings.text.invoiceNoLabel = findLabel(allCellText, 'INVOICE NO', settings.text.invoiceNoLabel)
  settings.text.dateLabel = findLabel(allCellText, 'DATE', settings.text.dateLabel)
  settings.text.totalLabel = findLabel(allCellText, 'TOTAL', settings.text.totalLabel)
  settings.text.sayLabel = findLabel(allCellText, 'SAY', settings.text.sayLabel)
  settings.text.paymentTermsLabel = findLabel(allCellText, 'Payment Term', settings.text.paymentTermsLabel)
  settings.text.priceTermsLabel = findLabel(allCellText, 'Price Term', settings.text.priceTermsLabel)
  settings.text.productionTimeLabel = findLabel(allCellText, 'Production Time', settings.text.productionTimeLabel)
  settings.text.portOfDepartureLabel = findLabel(allCellText, 'Port of Departure', settings.text.portOfDepartureLabel)
  settings.text.portOfDestinationLabel = findLabel(allCellText, 'Port of Destination', settings.text.portOfDestinationLabel)
  settings.text.bankInformationLabel = findLabel(allCellText, 'Bank information', settings.text.bankInformationLabel)

  const pageSetting = content?.pageSetting
  if (pageSetting) {
    settings.layout.pagePaddingTopMm = safeNumber(pageSetting.paddingTop, settings.layout.pagePaddingTopMm)
    settings.layout.pagePaddingBottomMm = safeNumber(pageSetting.paddingBottom, settings.layout.pagePaddingBottomMm)
    settings.layout.pagePaddingXMm = safeNumber(pageSetting.paddingLeft, settings.layout.pagePaddingXMm)
  }

  const now = new Date().toISOString()
  const title = exported.name || fileName.replace(/\.[^.]+$/, '') || '上传模板'
  const officialTemplate = content
    ? buildOfficialTemplateSummary(title, content as Record<string, unknown>)
    : undefined
  const mainFields = officialTemplate?.mainFieldRefs.map((fieldRef) => ({
    key: fieldRef,
    label: getLeafFieldName(fieldRef),
    required: true,
  }))
  const itemFields = officialTemplate?.itemFieldRefs.map((fieldRef) => ({
    key: fieldRef,
    label: getLeafFieldName(fieldRef),
    required: true,
  }))
  const linkedItemsFieldName = officialTemplate?.dynamicRoots[0] || base.linkedItemsFieldName
  const isOfficialTemplateReady = Boolean(officialTemplate)

  return {
    ...base,
    id: `uploaded-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: title,
    documentKind: inferDocumentKind(settings.text.documentTitle),
    description: `从文件 ${fileName} 导入。`,
    status: 'draft',
    isBuiltIn: false,
    mainTableName: isOfficialTemplateReady ? '' : base.mainTableName,
    itemTableName: isOfficialTemplateReady ? '' : base.itemTableName,
    rendererTemplateId: isOfficialTemplateReady ? OFFICIAL_LAYOUT_TEMPLATE_ID : base.rendererTemplateId,
    sourceFile: fileName,
    officialTemplate,
    linkedItemsFieldName,
    mainFields: mainFields?.length ? mainFields : base.mainFields,
    itemFields: itemFields?.length ? itemFields : base.itemFields,
    printSettings: settings,
    createdAt: now,
    updatedAt: now,
  }
}

function parseOfficialExport(rawText: string): OfficialTemplateExport {
  const trimmed = rawText.trim()
  try {
    return JSON.parse(trimmed) as OfficialTemplateExport
  } catch {
    return JSON.parse(decodeBase64(trimmed)) as OfficialTemplateExport
  }
}

function decodeBase64(value: string): string {
  const binary = window.atob(value)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function blockText(block: OfficialBlock): string {
  return (block.content ?? []).map(paragraphText).join('\n').trim()
}

function cellText(cell: OfficialCell): string {
  return (cell.content ?? []).map(paragraphText).join('\n').replace(/\s+/g, ' ').trim()
}

function paragraphText(paragraph: OfficialParagraph): string {
  return (paragraph.children ?? [])
    .map((child) => child.text ?? (child.name ? `[${normalizeFieldPath(child.name)}]` : ''))
    .join('')
}

function findLabel(cells: string[], needle: string, fallback: string): string {
  const found = cells.find((cell) => cell.toLowerCase().includes(needle.toLowerCase()))
  if (!found) return fallback
  return found.split(/[:：[]/)[0]?.trim() || fallback
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function inferDocumentKind(title: string): DocumentKind {
  const normalized = title.toLowerCase()
  if (normalized.includes('packing') || title.includes('装箱')) return 'packing-list'
  if (normalized.includes('purchase') || title.includes('采购')) return 'purchase-order'
  if (normalized.includes('commercial') || title.includes('商业')) return 'commercial-invoice'
  return 'proforma-invoice'
}

function buildOfficialTemplateSummary(
  exportName: string,
  content: Record<string, unknown>,
): OfficialTemplateSummary {
  const fieldRefs = new Set<string>()
  const dynamicRoots = new Set<string>()
  let tableCount = 0
  let staticImageCount = 0
  let attachmentFieldCount = 0

  walkObject(content, (node) => {
    if (Array.isArray(node.name)) {
      const path = normalizeFieldPath(node.name)
      if (path) {
        fieldRefs.add(path)
      }
    }

    if (typeof node.pathName === 'string') {
      const path = normalizeFieldPath(node.pathName)
      if (path) {
        fieldRefs.add(path)
        attachmentFieldCount += 1
      }
    }

    if (node.table && typeof node.table === 'object') {
      tableCount += 1
      const table = node.table as OfficialTable
      ;(table.dynamicRows ?? []).forEach((row) => {
        const rootPath = row.dataSource?.rootPath?.[0]
        if (rootPath) {
          dynamicRoots.add(rootPath)
        }
      })
    }

    if (node.imageConfig || node.type === 9) {
      staticImageCount += 1
    }
  })

  const roots = Array.from(dynamicRoots)
  const sortedFieldRefs = Array.from(fieldRefs).sort((left, right) => left.localeCompare(right, 'zh-CN'))
  const mainFieldRefs = sortedFieldRefs.filter(
    (fieldRef) => fieldRef !== '#' && !roots.some((root) => isChildFieldPath(fieldRef, root)),
  )
  const itemFieldRefs = sortedFieldRefs.filter((fieldRef) =>
    roots.some((root) => isChildFieldPath(fieldRef, root)),
  )
  const pageCount = Array.isArray((content.document as OfficialTemplateContent['document'])?.pages)
    ? ((content.document as OfficialTemplateContent['document'])?.pages ?? []).length
    : 0

  return {
    exportName,
    content,
    fieldRefs: sortedFieldRefs,
    mainFieldRefs,
    itemFieldRefs,
    dynamicRoots: roots,
    pageCount,
    tableCount,
    staticImageCount,
    attachmentFieldCount,
  }
}

function normalizeFieldPath(path: string[] | string): string {
  return (Array.isArray(path) ? path.join('/') : path.replaceAll('.', '/'))
    .replaceAll('//', '/')
    .trim()
}

function isChildFieldPath(fieldRef: string, root: string): boolean {
  return fieldRef === root || fieldRef.startsWith(`${root}/`)
}

function getLeafFieldName(fieldRef: string): string {
  return fieldRef.split('/').filter(Boolean).at(-1) || fieldRef
}

function walkObject(value: unknown, callback: (node: Record<string, unknown>) => void) {
  if (!value || typeof value !== 'object') {
    return
  }

  if (!Array.isArray(value)) {
    callback(value as Record<string, unknown>)
  }

  Object.values(value).forEach((child) => {
    if (Array.isArray(child)) {
      child.forEach((item) => walkObject(item, callback))
    } else {
      walkObject(child, callback)
    }
  })
}
