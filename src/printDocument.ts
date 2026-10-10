import { isOriginalTemplateImageUrl } from './templateImages'
import { clonePrintSettings } from './templateDefaults'
import {
  OFFICIAL_LAYOUT_TEMPLATE_ID,
  type OfficialPrintValue,
  type PiPrintDocument,
  type PiPrintPayload,
  type TemplateDesignOverrides,
  type TemplateNodeStyleOverride,
  type TemplatePrintSettings,
} from './types'

type OfficialContent = {
  document?: {
    pages?: OfficialPage[]
  }
  pageSetting?: {
    width?: number
    height?: number
    paddingTop?: number
    paddingBottom?: number
    paddingLeft?: number
    paddingRight?: number
  }
  settings?: {
    lang?: string
    fontSize?: number
    defaultLineHeight?: number
  }
}

type OfficialPage = {
  rows?: OfficialRow[]
}

type OfficialRow = {
  columns?: OfficialColumn[]
}

type OfficialColumn = {
  width?: number
  blocks?: OfficialBlock[]
}

type OfficialBlock = {
  type?: number
  content?: OfficialContentNode[]
  table?: OfficialTable
  imageConfig?: {
    file?: {
      url?: string
    }
  }
  width?: number
  position?: {
    x?: number
    y?: number
  }
}

type OfficialTable = {
  columns?: { width?: number }[]
  rows?: OfficialTableRow[]
  merges?: OfficialTableMerge[]
  dynamicRows?: OfficialDynamicRow[]
}

type OfficialTableRow = {
  cells?: OfficialTableCell[]
}

type OfficialTableCell = {
  content?: OfficialContentNode[]
  background?: string
  borderColor?: string
  borderWidth?: number
  verticalAlign?: 'top' | 'middle' | 'bottom'
  borderBottomStyle?: string
  borderTopStyle?: string
  borderLeftStyle?: string
  borderRightStyle?: string
}

type OfficialTableMerge = {
  rowIndex?: number
  colIndex?: number
  rowSpan?: number
  colSpan?: number
}

type OfficialDynamicRow = {
  rowIndex?: number
  dataSource?: {
    rootPath?: string[]
  }
}

type OfficialContentNode = {
  type?: string
  text?: string
  name?: string[]
  pathName?: string
  children?: OfficialContentNode[]
  align?: string
  fontSize?: string
  bold?: boolean
  lineHeight?: string | number
  marginBottom?: string | number
  rootPath?: string[]
  itemContent?: OfficialContentNode[]
  renderConfig?: {
    mode?: string
    imageDisplayMode?: string
    inlineJoiner?: string
  }
}

const LEGACY_SPACER_COLUMNS = false as boolean

type OfficialRenderContext = {
  rootPath?: string
  item?: Record<string, OfficialPrintValue>
  itemIndex?: number
  compactText?: boolean
  path: string
}

export function buildPrintDocument(payload: PiPrintPayload): string {
  if (payload.templateId === OFFICIAL_LAYOUT_TEMPLATE_ID && payload.officialTemplate) {
    return buildOfficialPrintDocument(payload)
  }

  return buildInvoicePrintDocument(payload)
}

export function buildInvoicePrintDocument(payload: PiPrintPayload): string {
  const settings = clonePrintSettings(payload.templateSettings)
  const pageModeClass = `page-mode-${settings.layout.pageMode}`
  const pages = payload.documents
    .map((document) => renderInvoicePage(document, settings))
    .join('')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
    <title>${escapeHtml(buildPdfFileName(payload))}</title>
    <style>${buildInvoicePrintStyles(settings)}</style>
  </head>
  <body class="${pageModeClass}">
    <main class="invoice-stack">${pages}</main>
  </body>
</html>`
}

export function buildPdfFileName(payload: PiPrintPayload): string {
  const firstDocument = payload.documents[0]
  const officialOrderNo =
    firstDocument?.official?.fields['订单号']?.text ||
    firstDocument?.official?.fields['合同编号']?.text ||
    firstDocument?.official?.fields['INVOICE NO']?.text
  const firstInvoiceNo = officialOrderNo || firstDocument?.fields.invoiceNo || payload.officialTemplate?.exportName || 'print-document'
  const suffix = payload.documents.length > 1 ? `-${payload.documents.length}-docs` : ''
  return `${slugify(firstInvoiceNo)}${suffix}.pdf`
}

export function openPdfBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function downloadPdfBlob(blob: Blob, fileName: string) {
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

function renderInvoicePage(document: PiPrintDocument, settings: TemplatePrintSettings): string {
  const fields = document.fields
  const text = settings.text
  const itemRows = document.items.map(renderItemRow).join('')

  return `<article class="invoice-page">
    <div class="invoice-content">
      <section class="company-box">
        <div class="company-name">${formatMultiline(text.companyName)}</div>
        <div>${formatMultiline(text.companyAddress)}</div>
        <div>${formatMultiline(text.companyContact)}</div>
      </section>

      <h2 class="document-title">${formatMultiline(text.documentTitle)}</h2>

      <section class="invoice-meta">
        <div class="buyer-cell">${formatMultiline(fields.customerInvoiceTitle)}</div>
        <div class="number-cell">${formatInline(text.invoiceNoLabel)}：${escapeHtml(fields.invoiceNo)}</div>
        <div class="date-cell">${formatInline(text.dateLabel)}: ${escapeHtml(fields.invoiceDate)}</div>
      </section>

      <table class="items-table">
        <colgroup>
          <col class="col-item" />
          <col class="col-spec" />
          <col class="col-qty" />
          <col class="col-unit" />
          <col class="col-price" />
          <col class="col-subtotal" />
        </colgroup>
        <thead>
          <tr>
            <th>${formatInline(text.itemHeaders.itemName)}</th>
            <th>${formatInline(text.itemHeaders.specification)}</th>
            <th class="compact-header">${formatCompactSvg(text.itemHeaders.quantity)}</th>
            <th class="compact-header">${formatCompactSvg(text.itemHeaders.unit)}</th>
            <th class="compact-header">${formatCompactSvg(text.itemHeaders.unitPrice)}</th>
            <th class="compact-header">${formatCompactSvg(text.itemHeaders.subtotal)}</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <table class="summary-table">
        <tbody>
          <tr class="total-row">
            <td>${formatInline(text.totalLabel)}:${escapeHtml(fields.totalWithCurrency)}<br />${formatInline(text.sayLabel)} ${escapeHtml(fields.sayAmount)}</td>
          </tr>
          <tr><td>${formatInline(text.paymentTermsLabel)}: ${escapeHtml(fields.paymentTerms)}</td></tr>
          <tr><td>${formatInline(text.priceTermsLabel)}: ${escapeHtml(fields.priceTerms)}</td></tr>
          <tr><td>${formatInline(text.productionTimeLabel)}: ${escapeHtml(fields.productionTime)}</td></tr>
          <tr><td>${formatInline(text.portOfDepartureLabel)}: ${escapeHtml(fields.portOfDeparture)}</td></tr>
          <tr><td>${formatInline(text.portOfDestinationLabel)}: ${escapeHtml(fields.portOfDestination)}</td></tr>
          <tr><td class="bank-cell">${formatInline(text.bankInformationLabel)}： ${formatMultiline(fields.bankInformation)}</td></tr>
        </tbody>
      </table>

    </div>
  </article>`
}

function renderItemRow(item: PiPrintDocument['items'][number]): string {
  return `<tr>
    <td>${formatMultiline(item.itemName)}</td>
    <td class="spec-cell">${formatMultiline(item.specification)}</td>
    <td class="compact-value">${formatCompactSvg(item.quantity)}</td>
    <td class="compact-value">${formatCompactSvg(item.unit)}</td>
    <td class="compact-value">${formatCompactSvg(item.unitPrice)}</td>
    <td class="compact-value">${formatCompactSvg(item.subtotal)}</td>
  </tr>`
}

function formatCompactSvg(value: string): string {
  const visibleValue = value.replaceAll('\u00a0', ' ')
  const characters = Array.from(visibleValue)
  const emWidth = Math.min(Math.max(characters.length * 0.58, 1.5), 8)
  const viewBoxWidth = Math.max(characters.length * 9, 24)

  return `<svg class="compact-svg" style="width:${numberCss(emWidth, 1.5)}em" viewBox="0 0 ${viewBoxWidth} 16" preserveAspectRatio="xMinYMid meet" role="img" aria-label="${escapeHtml(visibleValue)}"><text x="0" y="12">${escapeHtml(visibleValue)}</text></svg>`
}

function buildOfficialPrintDocument(payload: PiPrintPayload): string {
  const officialTemplate = payload.officialTemplate
  if (!officialTemplate) {
    throw new Error('缺少官方模板结构。')
  }

  const content = officialTemplate.content as OfficialContent
  const pages = payload.documents
    .map((document) => renderOfficialDocument(document, content, payload.designOverrides))
    .join('')
  const designModeClass = payload.designMode ? ' design-mode' : ''
  const selectedStyle = payload.selectedDesignId
    ? `body.design-mode [data-design-id="${cssEscape(payload.selectedDesignId)}"] { outline: 2px solid #246bfe; outline-offset: 1px; }`
    : ''

  return `<!doctype html>
<html lang="${escapeHtml(content.settings?.lang || 'zh-CN')}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
    <title>${escapeHtml(buildPdfFileName(payload))}</title>
    <style>${buildOfficialPrintStyles(content, payload.templateSettings, payload.designOverrides)}${selectedStyle}</style>
  </head>
  <body class="official-body${designModeClass}">
    <main class="official-stack">${pages}</main>
    ${payload.designMode ? buildDesignerSelectionScript() : ''}
  </body>
</html>`
}

function renderOfficialDocument(
  document: PiPrintDocument,
  content: OfficialContent,
  overrides?: TemplateDesignOverrides,
): string {
  const pages = content.document?.pages?.length ? content.document.pages : [{ rows: [] }]

  return pages.map((page, pageIndex) => renderOfficialPage(page, document, overrides, `p${pageIndex}`)).join('')
}

function renderOfficialPage(
  page: OfficialPage,
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  path: string,
): string {
  const rows = page.rows ?? []

  return `<article class="official-page print-page">
    <div class="official-page-content">
      ${rows.map((row, rowIndex) => renderOfficialRow(row, document, overrides, `${path}-r${rowIndex}`)).join('')}
    </div>
  </article>`
}

function renderOfficialRow(
  row: OfficialRow,
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  path: string,
): string {
  const columns = row.columns ?? []
  const template = columns.map((column) => `${numberCss(column.width, 100 / Math.max(columns.length, 1))}%`).join(' ')

  return `<section class="official-row" style="grid-template-columns:${escapeHtml(template)}">
    ${columns.map((column, columnIndex) => renderOfficialColumn(column, document, overrides, `${path}-c${columnIndex}`)).join('')}
  </section>`
}

function renderOfficialColumn(
  column: OfficialColumn,
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  path: string,
): string {
  return `<div class="official-column">
    ${(column.blocks ?? [])
      .map((block, blockIndex) => renderOfficialBlock(block, document, overrides, `${path}-b${blockIndex}`))
      .join('')}
  </div>`
}

function renderOfficialBlock(
  block: OfficialBlock,
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  path: string,
): string {
  const margins = (['Top', 'Right', 'Bottom', 'Left'] as const)
    .map((side) => {
      const value = (block as Record<string, unknown>)[`margin${side}`]
      return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 400
        ? `margin-${side.toLowerCase()}:${value}px`
        : ''
    })
    .filter(Boolean)
  const inner = renderOfficialBlockInner(block, document, overrides, path)
  return margins.length ? `<div class="official-block-margin" style="${margins.join(';')}">${inner}</div>` : inner
}

function renderOfficialBlockInner(
  block: OfficialBlock,
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  path: string,
): string {
  if (block.table) {
    return renderOfficialTable(block.table, document, overrides, `table:${path}`)
  }

  if (block.type === 9 || block.imageConfig) {
    return renderOfficialStaticImage(block, overrides, `image:${path}`)
  }

  const designId = `block:${path}`
  return `<div class="official-text-block" ${designAttrs(designId, 'text')} style="${buildNodeStyle(
    overrides?.nodeStyles?.[designId],
  )}">${renderOfficialContent(block.content ?? [], document, overrides, { path: designId })}</div>`
}

function renderOfficialTable(
  table: OfficialTable,
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  designId: string,
): string {
  const columns = table.columns ?? []
  const rows = table.rows ?? []
  const columnWidths = overrides?.tableColumnWidths?.[designId]
  const effectiveColumnWidths = getEffectiveColumnWidths(columns, columnWidths)
  const tableStyle = buildNodeStyle(overrides?.nodeStyles?.[designId], { includePadding: false })
  const dynamicRows = new Map<number, string>(
    (table.dynamicRows ?? [])
      .map((row) => [row.rowIndex, row.dataSource?.rootPath?.[0]] as const)
      .filter((entry): entry is [number, string] => typeof entry[0] === 'number' && Boolean(entry[1])),
  )

  const bodyRows = rows.flatMap((row, rowIndex) => {
    const rootPath = dynamicRows.get(rowIndex)
    if (!rootPath) {
      return renderOfficialTableRow(table, row, document, overrides, { path: designId }, rowIndex, designId)
    }

    const items = document.official?.itemGroups[rootPath] ?? []
    const scopedItems = items.length ? items : [undefined]
    return scopedItems.map((item, itemIndex) =>
      renderOfficialTableRow(table, row, document, overrides, { rootPath, item, itemIndex, path: designId }, rowIndex, designId),
    )
  })

  return `<div class="official-table-box" ${designAttrs(designId, 'table')} data-column-widths="${escapeHtml(
    JSON.stringify(effectiveColumnWidths),
  )}" style="${tableStyle}">
    <table class="official-table">
      <colgroup>
        ${effectiveColumnWidths
          .map((width) => `<col style="width:${numberCss(width, 100 / Math.max(columns.length, 1))}%">`)
          .join('')}
      </colgroup>
      <tbody>${bodyRows.join('')}</tbody>
    </table>
    ${renderOfficialTableResizers(effectiveColumnWidths)}
  </div>`
}

function renderOfficialTableRow(
  table: OfficialTable,
  row: OfficialTableRow,
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  context: OfficialRenderContext,
  rowIndex: number,
  tableDesignId: string,
): string {
  const cells = row.cells ?? []
  const renderedCells = cells
    .map((cell, colIndex) => renderOfficialTableCell(table, cell, document, overrides, context, rowIndex, colIndex, tableDesignId))
    .join('')

  return `<tr>${renderedCells}</tr>`
}

function renderOfficialTableCell(
  table: OfficialTable,
  cell: OfficialTableCell,
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  context: OfficialRenderContext,
  rowIndex: number,
  colIndex: number,
  tableDesignId: string,
): string {
  if (isCoveredByMerge(table.merges ?? [], rowIndex, colIndex)) {
    return ''
  }

  const merge = findMerge(table.merges ?? [], rowIndex, colIndex)
  const attrs = [
    merge?.colSpan && merge.colSpan > 1 ? `colspan="${merge.colSpan}"` : '',
    merge?.rowSpan && merge.rowSpan > 1 ? `rowspan="${merge.rowSpan}"` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const designId = `cell:${tableDesignId.slice('table:'.length)}-row${rowIndex}-col${colIndex}`
  const compactText = isOfficialCompactColumn(table, colIndex)
  const style = [buildOfficialCellStyle(cell), buildNodeStyle(overrides?.nodeStyles?.[designId])]
    .filter(Boolean)
    .join(';')
  const classAttr = compactText ? ' class="official-compact-cell"' : ''

  return `<td${classAttr} ${attrs} ${designAttrs(designId, 'cell', tableDesignId)} style="${style}">${renderOfficialContent(
    cell.content ?? [],
    document,
    overrides,
    { ...context, compactText, path: designId },
  )}</td>`
}

function isOfficialCompactColumn(table: OfficialTable, colIndex: number): boolean {
  const headerCell = table.rows?.[0]?.cells?.[colIndex]
  if (!headerCell) {
    return false
  }

  const header = (headerCell.content ?? [])
    .map((node) => flattenOfficialInlineText(node))
    .join(' ')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
    .toUpperCase()

  return ['QUANTITY', 'QTY', 'UNIT', 'UNIT PRICE', 'SUB TOTAL', 'SUBTOTAL', 'AMOUNT'].includes(header)
}

function renderOfficialContent(
  content: OfficialContentNode[],
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  context: OfficialRenderContext,
): string {
  return content.map((node) => renderOfficialContentNode(node, document, overrides, context)).join('')
}

function renderOfficialContentNode(
  node: OfficialContentNode,
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  context: OfficialRenderContext,
): string {
  if (node.type === 'attachment') {
    return renderOfficialAttachment(node, document, overrides, context)
  }

  if (node.type === 'loop') {
    return renderOfficialLoop(node, document, overrides, context)
  }

  if (node.type === 'paragraph' || node.type === 'heading-one' || node.children) {
    const align = ['left', 'center', 'right', 'justify'].includes(node.align || '') ? node.align : 'left'
    // The original editor renders runs of spaces with white-space: pre-wrap, so long
    // space runs wrap lines exactly like the original. Keep that behaviour instead of
    // re-interpreting spaces as left/right columns.
    const usesLayoutSpacer = LEGACY_SPACER_COLUMNS && hasLegacyLayoutSpacer(node.children ?? [])
    const className = [
      'official-paragraph',
      node.type === 'heading-one' ? 'official-heading' : '',
      usesLayoutSpacer ? 'official-paragraph-spaced' : '',
    ]
      .filter(Boolean)
      .join(' ')
    const paragraphStyles = [`text-align:${align}`]
    const lineHeight = cssLength(node.lineHeight)
    if (lineHeight) paragraphStyles.push(`line-height:${lineHeight}`)
    const marginBottom = cssLength(node.marginBottom)
    if (marginBottom) paragraphStyles.push(`margin-bottom:${marginBottom}`)
    return `<p class="${className}" style="${paragraphStyles.join(';')}">${renderOfficialInlineNodes(
      node.children ?? [],
      document,
      overrides,
      context,
      usesLayoutSpacer,
    )}</p>`
  }

  return renderOfficialInlineNode(node, document, overrides, context)
}

function renderOfficialInlineNodes(
  nodes: OfficialContentNode[],
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  context: OfficialRenderContext,
  usesLayoutSpacer = false,
): string {
  if (usesLayoutSpacer) {
    return renderOfficialSpacedInlineNodes(nodes, document, overrides, context)
  }

  return nodes
    .map((node) => renderOfficialInlineNode(node, document, overrides, context))
    .join('')
}

function renderOfficialSpacedInlineNodes(
  nodes: OfficialContentNode[],
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  context: OfficialRenderContext,
): string {
  const left: string[] = []
  const right: string[] = []
  let foundSeparator = false

  nodes.forEach((node) => {
    if (!foundSeparator && node.type !== 'variable' && !node.name && typeof node.text === 'string') {
      const match = /[ \t\u00a0]{6,}/.exec(node.text)
      if (match) {
        const before = node.text.slice(0, match.index)
        const after = node.text.slice(match.index + match[0].length)
        if (before) {
          left.push(renderOfficialInlineNode({ ...node, text: before }, document, overrides, context))
        }
        if (after) {
          right.push(renderOfficialInlineNode({ ...node, text: collapseLegacyLayoutFill(after) }, document, overrides, context))
        }
        foundSeparator = true
        return
      }
    }

    const target = foundSeparator ? right : left
    const normalizedNode =
      foundSeparator && typeof node.text === 'string'
        ? { ...node, text: collapseLegacyLayoutFill(node.text) }
        : node
    target.push(renderOfficialInlineNode(normalizedNode, document, overrides, context))
  })

  return `<span class="official-layout-left">${left.join('')}</span><span class="official-layout-right">${right.join('')}</span>`
}

function renderOfficialInlineNode(
  node: OfficialContentNode,
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  context: OfficialRenderContext,
): string {
  if (node.type === 'attachment') {
    return renderOfficialAttachment(node, document, overrides, context)
  }

  if (node.type === 'variable' || node.name) {
    const fieldPath = normalizeFieldPath(node.name ?? '')
    const value = getOfficialValue(document, fieldPath, context)
    return `<span class="official-variable">${formatInline(value.text)}</span>`
  }

  const styles = [
    node.bold ? 'font-weight:700' : '',
    node.fontSize ? `font-size:${escapeHtml(node.fontSize)}` : '',
  ]
    .filter(Boolean)
    .join(';')
  const styleAttr = styles ? ` style="${styles}"` : ''

  const text = node.text ?? ''
  return `<span${styleAttr}>${formatInline(text)}</span>`
}

function renderOfficialLoop(
  node: OfficialContentNode,
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  context: OfficialRenderContext,
): string {
  const rootPath = normalizeFieldPath(node.rootPath ?? [])
  const items = document.official?.itemGroups[rootPath] ?? []
  const joiner = node.renderConfig?.inlineJoiner ?? '、'
  const parts = items
    .map((item, itemIndex) =>
      (node.itemContent ?? [])
        .map((child) =>
          (child.children ?? [child])
            .map((inline) =>
              renderOfficialInlineNode(inline, document, overrides, { ...context, rootPath, item, itemIndex }),
            )
            .join(''),
        )
        .join(''),
    )
    .filter((part) => part.replace(/<[^>]+>/g, '').trim())
  const unique = parts.filter((part, index) => parts.indexOf(part) === index)
  return `<span class="official-loop">${unique.join(escapeHtml(joiner))}</span>`
}

function cssLength(value: string | number | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return /^\d+(?:\.\d+)?(?:em|px|pt|mm|%)?$/.test(trimmed) ? trimmed : ''
}

function hasLegacyLayoutSpacer(nodes: OfficialContentNode[]): boolean {
  const text = nodes.map((node) => flattenOfficialInlineText(node)).join('')
  return /\S[ \t\u00a0]{6,}(?=\S)/.test(text)
}

function flattenOfficialInlineText(node: OfficialContentNode): string {
  if (node.type === 'variable' || node.name) {
    return '\uFFFC'
  }

  if (node.children?.length) {
    return node.children.map((child) => flattenOfficialInlineText(child)).join('')
  }

  return node.text ?? ''
}

function collapseLegacyLayoutFill(value: string): string {
  return value.replace(/[ \t\u00a0]{6,}/g, ' ')
}

function renderOfficialAttachment(
  node: OfficialContentNode,
  document: PiPrintDocument,
  overrides: TemplateDesignOverrides | undefined,
  context: OfficialRenderContext,
): string {
  const fieldPath = normalizeFieldPath(node.pathName || '')
  const value = getOfficialValue(document, fieldPath, context)
  if (value.imageUrls?.length) {
    const baseDesignId = buildAttachmentImageDesignId(context.path, fieldPath)
    return `<div class="official-attachment-images">
      ${value.imageUrls
        .map((url, index) =>
          renderOfficialAttachmentImage(
            url,
            value.text || '附件图片',
            `${baseDesignId}-${index}`,
            overrides,
          ),
        )
        .join('')}
    </div>`
  }

  if (value.imageLoadFailed) {
    return '<span class="official-empty-image">照片读取失败，请重新读取</span>'
  }

  return value.text ? `<span>${formatInline(value.text)}</span>` : '<span class="official-empty-image">无图片</span>'
}

function renderOfficialAttachmentImage(
  url: string,
  alt: string,
  designId: string,
  overrides: TemplateDesignOverrides | undefined,
): string {
  const nodeStyle = overrides?.nodeStyles?.[designId]
  const widthMm = nodeStyle?.imageWidthMm ?? 32
  const xMm = nodeStyle?.imageOffsetXMm ?? 0
  const yMm = nodeStyle?.imageOffsetYMm ?? 0

  return `<div class="official-image-block official-attachment-image-block" ${designAttrs(
    designId,
    'image',
  )} data-image-x-mm="${numberCss(xMm, 0)}" data-image-y-mm="${numberCss(
    yMm,
    0,
  )}" style="${buildNodeStyle(nodeStyle)}">
    <img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" draggable="false" style="width:${numberCss(
      widthMm,
      32,
    )}mm; transform:translate(${numberCss(xMm, 0)}mm, ${numberCss(yMm, 0)}mm)" />
  </div>`
}

function buildAttachmentImageDesignId(contextPath: string, fieldPath: string): string {
  return `attachment:${contextPath}:${fieldPath.replace(/[^\w\u4e00-\u9fa5-]+/g, '-') || 'image'}`
}

function renderOfficialTableResizers(widths: number[]): string {
  if (widths.length < 2) {
    return ''
  }

  let left = 0
  return widths
    .slice(0, -1)
    .map((width, index) => {
      left += width
      return `<span class="official-table-resizer" data-column-index="${index}" style="left:${numberCss(
        left,
        0,
      )}%"></span>`
    })
    .join('')
}

function renderOfficialStaticImage(
  block: OfficialBlock,
  overrides: TemplateDesignOverrides | undefined,
  designId: string,
): string {
  const nodeStyle = overrides?.nodeStyles?.[designId]
  const widthMm = nodeStyle?.imageWidthMm ?? pxToMm(safeNumber(block.width, 120))
  const xMm = nodeStyle?.imageOffsetXMm ?? pxToMm(safeNumber(block.position?.x, 0))
  const yMm = nodeStyle?.imageOffsetYMm ?? pxToMm(safeNumber(block.position?.y, 0))
  const uploadedUrl = overrides?.staticImages?.[designId]?.dataUrl
  const originalUrl = block.imageConfig?.file?.url
  const url = isSafeEmbeddedStaticImage(uploadedUrl)
    ? uploadedUrl
    : isOriginalTemplateImageUrl(originalUrl)
      ? originalUrl.trim()
      : ''

  if (!url) {
    return `<div class="official-image-block official-static-image-placeholder" ${designAttrs(
      designId,
      'image',
    )} data-image-x-mm="${numberCss(xMm, 0)}" data-image-y-mm="${numberCss(yMm, 0)}" style="${buildNodeStyle(
      nodeStyle,
    )}">
      <span style="width:${widthMm}mm; transform:translate(${xMm}mm, ${yMm}mm)">固定图片待手动上传</span>
    </div>`
  }

  return `<div class="official-image-block" ${designAttrs(designId, 'image')} data-image-x-mm="${numberCss(
    xMm,
    0,
  )}" data-image-y-mm="${numberCss(yMm, 0)}" style="${buildNodeStyle(nodeStyle)}">
    <img src="${escapeHtml(url)}" alt="" draggable="false" style="width:${widthMm}mm; left:${xMm}mm; top:${yMm}mm" />
  </div>`
}

function isSafeEmbeddedStaticImage(source: string | undefined): source is string {
  return Boolean(source && /^data:image\/(?:jpeg|png|webp);base64,/i.test(source))
}

function getOfficialValue(
  document: PiPrintDocument,
  fieldPath: string,
  context: OfficialRenderContext,
): OfficialPrintValue {
  if (fieldPath === '#') {
    return { text: String((context.itemIndex ?? 0) + 1) }
  }

  const normalizedPath = normalizeFieldPath(fieldPath)
  const leafName = getLeafFieldName(normalizedPath)

  if (context.item) {
    const itemValue =
      context.item[normalizedPath] ||
      context.item[leafName] ||
      (context.rootPath ? context.item[stripRootPath(normalizedPath, context.rootPath)] : undefined)
    if (itemValue) {
      return itemValue
    }
  }

  const fieldValue = document.official?.fields[normalizedPath] || document.official?.fields[leafName]
  if (fieldValue) {
    return fieldValue
  }

  const fallback = getLegacyFieldFallback(document, leafName)
  return { text: fallback || `[${normalizedPath}]` }
}

function getLegacyFieldFallback(document: PiPrintDocument, leafName: string): string {
  const normalized = leafName.toLowerCase()
  if (leafName === '订单号' || normalized.includes('invoice')) return document.fields.invoiceNo
  if (leafName === '日期' || normalized.includes('date')) return document.fields.invoiceDate
  if (leafName === '总值' || leafName.includes('合计') || normalized.includes('total')) {
    return document.fields.totalWithCurrency
  }
  if (leafName.includes('金额大写') || normalized === 'say') return document.fields.sayAmount
  return ''
}

function normalizeFieldPath(path: string[] | string): string {
  return (Array.isArray(path) ? path.join('/') : path.replaceAll('.', '/')).replaceAll('//', '/').trim()
}

function stripRootPath(fieldPath: string, rootPath: string): string {
  return fieldPath.startsWith(`${rootPath}/`) ? fieldPath.slice(rootPath.length + 1) : fieldPath
}

function getLeafFieldName(fieldPath: string): string {
  return fieldPath.split('/').filter(Boolean).at(-1) || fieldPath
}

function findMerge(merges: OfficialTableMerge[], rowIndex: number, colIndex: number) {
  return merges.find((merge) => merge.rowIndex === rowIndex && merge.colIndex === colIndex)
}

function isCoveredByMerge(merges: OfficialTableMerge[], rowIndex: number, colIndex: number): boolean {
  return merges.some((merge) => {
    const startRow = merge.rowIndex ?? -1
    const startCol = merge.colIndex ?? -1
    const rowSpan = merge.rowSpan ?? 1
    const colSpan = merge.colSpan ?? 1
    const isOrigin = startRow === rowIndex && startCol === colIndex
    return !isOrigin && rowIndex >= startRow && rowIndex < startRow + rowSpan && colIndex >= startCol && colIndex < startCol + colSpan
  })
}

function buildOfficialCellStyle(cell: OfficialTableCell): string {
  const verticalAlign = cell.verticalAlign === 'middle' ? 'middle' : cell.verticalAlign === 'bottom' ? 'bottom' : 'top'
  const styles = [`vertical-align:${verticalAlign}`]
  const safeColor = (value: string | undefined) =>
    value && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(value.trim()) ? value.trim() : ''
  if (safeColor(cell.background)) styles.push(`background:${safeColor(cell.background)}`)
  if (safeColor(cell.borderColor)) styles.push(`border-color:${safeColor(cell.borderColor)}`)
  if (typeof cell.borderWidth === 'number' && cell.borderWidth >= 0 && cell.borderWidth <= 6) {
    styles.push(`border-width:${cell.borderWidth}px`)
  }
  ;(
    [
      ['border-top', cell.borderTopStyle],
      ['border-right', cell.borderRightStyle],
      ['border-bottom', cell.borderBottomStyle],
      ['border-left', cell.borderLeftStyle],
    ] as const
  ).forEach(([property, value]) => {
    if (value === 'none') {
      styles.push(`${property}:0`)
    }
  })

  return styles.join(';')
}

function formatMultiline(value: string): string {
  return escapeHtml(value || '').replace(/\n/g, '<br />')
}

function formatInline(value: string): string {
  // Keep spaces exactly as typed; the paragraph's white-space rule lays them out
  // like the original editor (runs of spaces push following text to a new line).
  return escapeHtml(value || '')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function slugify(value: string): string {
  return value.trim().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]+/g, '').toLowerCase()
}

function buildInvoicePrintStyles(settings: TemplatePrintSettings): string {
  const layout = settings.layout

  return `
  @page {
    size: A4;
    margin: 0;
  }

  :root {
    color: #111;
    font-family: Arial, "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: ${numberCss(layout.fontSizePt, 9)}pt;
    line-height: 1.38;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: #e9edf2;
  }

  .invoice-stack {
    display: flex;
    flex-direction: column;
    gap: 8mm;
    padding: 8mm 0;
  }

  .invoice-page {
    position: relative;
    width: 210mm;
    min-height: ${layout.pageMode === 'continuous' ? 'auto' : '297mm'};
    margin: 0 auto;
    padding: ${numberCss(layout.pagePaddingTopMm, 17.3)}mm ${numberCss(layout.pagePaddingXMm, 10)}mm ${numberCss(layout.pagePaddingBottomMm, 17.3)}mm;
    background: #fff;
    color: #111;
    page-break-after: ${layout.pageMode === 'continuous' ? 'auto' : 'always'};
    box-shadow: 0 18px 50px rgba(28, 39, 55, 0.18);
    overflow: hidden;
  }

  .invoice-page:last-child {
    page-break-after: auto;
  }

  .company-box {
    display: grid;
    grid-template-rows: 15mm 6.5mm 6.5mm;
    text-align: center;
    border: 1px solid #111;
    margin: 0 auto;
    width: 100%;
  }

  .company-box > div {
    display: grid;
    place-content: center;
    min-width: 0;
    padding: 0 2mm;
    border-bottom: 1px solid #111;
  }

  .company-box > div:last-child {
    border-bottom: 0;
  }

  .company-name {
    font-size: ${numberCss(layout.headerFontSizePt, 16)}pt;
    line-height: 1.1;
    font-weight: 700;
  }

  .document-title {
    margin: ${numberCss(layout.titleGapMm, 6)}mm 0 ${numberCss(layout.titleGapMm, 6)}mm;
    text-align: center;
    font-size: ${numberCss(layout.titleFontSizePt, 16)}pt;
    line-height: 1;
    font-weight: 700;
  }

  .invoice-meta {
    display: grid;
    grid-template-columns: 50% 50%;
    border: 1px solid #111;
    border-bottom: 0;
  }

  .invoice-meta > div {
    min-height: 9mm;
    padding: 2mm 2.4mm;
    border-bottom: 1px solid #111;
  }

  .buyer-cell {
    grid-row: span 2;
    border-right: 1px solid #111;
    white-space: normal;
    word-break: break-word;
  }

  .number-cell,
  .date-cell {
    white-space: pre-wrap;
  }

  .items-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin-top: ${numberCss(layout.itemTableGapMm, 5)}mm;
  }

  .items-table th,
  .items-table td {
    border: 1px solid #111;
    padding: 1.8mm 1.2mm;
    text-align: left;
    vertical-align: top;
    word-break: break-word;
  }

  .items-table th {
    min-height: 11mm;
    padding: 1.8mm 1mm;
    font-size: 8.2pt;
    font-weight: 400;
    word-break: normal;
  }

  .items-table th:nth-child(3),
  .items-table th:nth-child(4),
  .items-table th:nth-child(5),
  .items-table th:nth-child(6) {
    padding-left: 0;
    padding-right: 0;
    font-size: 6.4pt;
    line-height: 1.12;
    overflow-wrap: normal;
    word-break: normal;
  }

  .items-table th:nth-child(3),
  .items-table th:nth-child(4) {
    font-size: 5.9pt;
  }

  .items-table td {
    font-size: 8.5pt;
  }

  .items-table tbody tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .items-table td:nth-child(3),
  .items-table td:nth-child(4),
  .items-table td:nth-child(5),
  .items-table td:nth-child(6) {
    text-align: left;
    padding-left: 0.6mm;
    padding-right: 0.6mm;
    font-size: 7pt;
    font-variant-numeric: tabular-nums;
    line-height: 1.18;
    overflow-wrap: normal;
    word-break: normal;
    white-space: nowrap;
  }

  .items-table .compact-header {
    padding-left: 0.2mm !important;
    padding-right: 0.2mm !important;
    font-size: 5.2pt !important;
    line-height: 1.08 !important;
    letter-spacing: -0.03em;
    white-space: nowrap !important;
    overflow-wrap: normal !important;
    word-break: keep-all !important;
  }

  .items-table .compact-value {
    padding-left: 0.25mm !important;
    padding-right: 0.25mm !important;
    font-size: 6.2pt !important;
    line-height: 1.12 !important;
    letter-spacing: -0.015em;
    white-space: nowrap !important;
    overflow-wrap: normal !important;
    word-break: keep-all !important;
  }

  .items-table .compact-svg {
    display: block;
    max-width: 100%;
    height: 1.2em;
    overflow: hidden;
    font-family: Arial, "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
    fill: currentColor;
  }

  .spec-cell {
    line-height: 1.28;
  }

  .col-item {
    width: ${numberCss(layout.columnWidths.itemName, 25.997267905505645)}%;
  }

  .col-spec {
    width: ${numberCss(layout.columnWidths.specification, 35.90595226485051)}%;
  }

  .col-qty {
    width: ${numberCss(layout.columnWidths.quantity, 12.567083292697678)}%;
  }

  .col-unit {
    width: ${numberCss(layout.columnWidths.unit, 5.072708243805661)}%;
  }

  .col-price {
    width: ${numberCss(layout.columnWidths.unitPrice, 10.258639197767733)}%;
  }

  .col-subtotal {
    width: ${numberCss(layout.columnWidths.subtotal, 10.198349095372773)}%;
  }

  .summary-table {
    width: 100%;
    margin-top: ${numberCss(layout.summaryGapMm, 8)}mm;
    border-collapse: collapse;
    table-layout: fixed;
  }

  .summary-table td {
    min-height: 6.4mm;
    border: 1px solid #111;
    padding: 1.2mm 1.6mm;
    line-height: 1.35;
    word-break: break-word;
    vertical-align: top;
  }

  .summary-table .total-row td {
    min-height: 11mm;
  }

  .bank-cell {
    height: ${numberCss(layout.bankHeightMm, 31)}mm;
    white-space: normal;
  }

  .stamp-image {
    position: absolute;
    right: ${numberCss(layout.stampRightMm, 21)}mm;
    top: ${numberCss(layout.stampTopMm, 150)}mm;
    width: ${numberCss(layout.stampWidthMm, 38)}mm;
    height: auto;
  }

  .page-mode-fit-one-page .invoice-page {
    height: 297mm;
  }

  .page-mode-fit-one-page .invoice-content {
    transform-origin: top left;
  }

  @media screen and (max-width: 900px) {
    .invoice-stack {
      padding: 0;
      gap: 16px;
    }

    .invoice-page {
      width: 100%;
      min-height: auto;
      box-shadow: none;
    }
  }

  @media print {
    body {
      background: transparent;
    }

    .invoice-stack {
      gap: 0;
      padding: 0;
    }

    .invoice-page {
      box-shadow: none;
      margin: 0;
    }
  }
`
}

function buildOfficialPrintStyles(
  content: OfficialContent,
  settings: PiPrintPayload['templateSettings'],
  overrides?: TemplateDesignOverrides,
): string {
  const page = content.pageSetting ?? {}
  const printSettings = clonePrintSettings(settings)
  const pageOverrides = overrides?.pageSettings
  const pageMode = pageOverrides?.pageMode ?? printSettings.layout.pageMode
  const width = safeNumber(page.width, 210)
  const height = safeNumber(page.height, 297)
  const paddingTop = pageOverrides?.pagePaddingTopMm ?? safeNumber(page.paddingTop, printSettings.layout.pagePaddingTopMm)
  const paddingBottom = pageOverrides?.pagePaddingBottomMm ?? safeNumber(page.paddingBottom, printSettings.layout.pagePaddingBottomMm)
  const paddingLeft = pageOverrides?.pagePaddingXMm ?? safeNumber(page.paddingLeft, printSettings.layout.pagePaddingXMm)
  const paddingRight = pageOverrides?.pagePaddingXMm ?? safeNumber(page.paddingRight, printSettings.layout.pagePaddingXMm)
  const fontSize = pageOverrides?.fontSizePt ?? safeNumber(content.settings?.fontSize, printSettings.layout.fontSizePt)
  const lineHeight = pageOverrides?.lineHeight ?? safeNumber(content.settings?.defaultLineHeight, 1.5)

  return `
  @page { size: ${width}mm ${height}mm; margin: 0; }
  :root {
    color: #111;
    /* Same font stack as the original Feishu print plugin (DocuGenius). */
    font-family: Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Noto Sans", "Noto Sans CJK SC", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: ${fontSize}pt;
    line-height: ${lineHeight};
  }
  * { box-sizing: border-box; }
  body.official-body { margin: 0; background: #e9edf2; }
  body.design-mode [data-design-id] {
    cursor: pointer;
  }
  body.design-mode [data-design-id]:hover {
    outline: 1px dashed #2f80ed;
    outline-offset: 1px;
  }
  body.design-mode [data-design-id].designer-drop-hover {
    outline: 2px solid #0d9488;
    outline-offset: 2px;
    background: rgba(13, 148, 136, 0.08);
  }
  .official-stack {
    display: flex;
    flex-direction: column;
    gap: 8mm;
    padding: 8mm 0;
  }
  .official-page {
    position: relative;
    width: ${width}mm;
    min-height: ${pageMode === 'continuous' ? 'auto' : `${height}mm`};
    margin: 0 auto;
    padding: ${paddingTop}mm ${paddingRight}mm ${paddingBottom}mm ${paddingLeft}mm;
    background: #fff;
    color: #111;
    page-break-after: ${pageMode === 'continuous' ? 'auto' : 'always'};
    box-shadow: 0 18px 50px rgba(28, 39, 55, 0.18);
    overflow: hidden;
  }
  .official-page:last-child { page-break-after: auto; }
  .official-page-content {
    position: relative;
    transform-origin: top left;
  }
  .official-row {
    display: grid;
    width: 100%;
  }
  /* The original editor separates layout rows with a 17px gap; templates cancel
     it with a negative block marginTop to join tables. */
  .official-row + .official-row {
    margin-top: 17px;
  }
  .official-column {
    min-width: 0;
  }
  .official-text-block {
    width: 100%;
  }
  .official-paragraph {
    margin: 0;
    min-height: 1em;
    /* Matches the original editor: spaces kept (pre-wrap), words may break anywhere. */
    white-space: pre-wrap;
    word-break: break-all;
  }
  .official-paragraph-spaced {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    column-gap: 3mm;
    white-space: normal;
  }
  .official-layout-left {
    min-width: 0;
  }
  .official-layout-right {
    justify-self: end;
    text-align: right;
    white-space: nowrap;
  }
  .official-variable {
    white-space: pre-wrap;
  }
  .official-compact-cell .official-paragraph {
    word-break: keep-all;
    overflow-wrap: normal;
  }
  .official-heading {
    font-size: 1.6em;
    font-weight: 700;
  }
  .official-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .official-table-box {
    position: relative;
    width: 100%;
  }
  .official-table td {
    border: 1px solid #111;
    padding: 4px 5px;
    word-break: break-all;
  }
  .official-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .official-table-resizer {
    display: none;
  }
  body.design-mode .official-table-resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 6;
    display: block;
    width: 8px;
    margin-left: -4px;
    cursor: col-resize;
    touch-action: none;
  }
  body.design-mode .official-table-resizer::after {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 2px;
    content: '';
    background: transparent;
  }
  body.design-mode .official-table-resizer:hover::after,
  body.design-mode .official-table-resizer.is-dragging::after {
    background: #246bfe;
  }
  .official-attachment-images {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5mm;
    align-items: flex-start;
    justify-content: flex-start;
  }
  .official-attachment-image-block {
    width: auto;
    min-width: 20mm;
    min-height: 20mm;
    overflow: visible;
  }
  .official-attachment-image-block img {
    max-width: none;
    max-height: none;
    object-fit: contain;
  }
  .official-empty-image {
    display: inline-flex;
    min-height: 20mm;
    align-items: center;
    color: #7a8790;
    font-size: 8pt;
  }
  .official-image-block {
    position: relative;
    width: 100%;
    min-height: 0;
  }
  .official-image-block:not(.official-attachment-image-block) {
    height: 0;
    overflow: visible;
    z-index: 2;
  }
  .official-image-block:not(.official-attachment-image-block) img {
    position: absolute;
  }
  .official-image-block img {
    display: block;
    position: relative;
    height: auto;
    user-select: none;
    -webkit-user-drag: none;
  }
  .official-static-image-placeholder span {
    align-items: center;
    background: #f7f9fc;
    border: 1px dashed #8ea5c4;
    color: #52657a;
    display: flex;
    justify-content: center;
    min-height: 18mm;
    padding: 2mm;
    text-align: center;
  }
  body.design-mode .official-image-block {
    cursor: move;
    touch-action: none;
  }
  body.design-mode .official-image-block.is-image-moving {
    outline: 2px solid #246bfe;
    outline-offset: 2px;
  }
  .page-mode-fit-one-page .official-page,
  .official-body .official-page {
    ${pageMode === 'fit-one-page' ? `height: ${height}mm;` : ''}
  }
${buildFitToWidthStyles(width)}
  @media print {
    body.official-body { background: transparent; }
    .official-stack { gap: 0; padding: 0; }
    .official-page { box-shadow: none; margin: 0; }
  }
  ${buildDesignOverrideStyles(overrides)}
`
}

// Never reflow the page to a narrower width: that is what made table cells and
// space-aligned text wrap differently from the original. Shrink the whole page
// visually instead (CSS only, so it also works in the sandboxed preview iframe).
function buildFitToWidthStyles(pageWidthMm: number): string {
  const pagePx = (pageWidthMm * 96) / 25.4
  const rules: string[] = [
    'body.official-body { container-type: inline-size; container-name: printstack; }',
  ]
  for (let zoom = 0.95; zoom >= 0.3; zoom -= 0.05) {
    const breakpoint = Math.round(pagePx * (zoom + 0.05) + 24)
    rules.push(
      `@container printstack (max-width: ${breakpoint}px) { body:not(.design-mode) .official-page { zoom: ${zoom.toFixed(2)}; } body:not(.design-mode) .official-stack { padding: 12px 0; gap: 12px; } }`,
    )
  }
  return `@media screen { ${rules.join('\n')} }`
}

function designAttrs(designId: string, kind: string, tableId?: string): string {
  const tableAttr = tableId ? ` data-table-id="${escapeHtml(tableId)}"` : ''
  return `data-design-id="${escapeHtml(designId)}" data-design-kind="${escapeHtml(kind)}"${tableAttr}`
}

function buildNodeStyle(
  style?: TemplateNodeStyleOverride,
  options: { includePadding?: boolean } = {},
): string {
  if (!style) {
    return ''
  }
  const includePadding = options.includePadding ?? true

  return [
    style.fontFamily ? `font-family:${style.fontFamily}` : '',
    typeof style.fontSizePt === 'number' ? `font-size:${style.fontSizePt}pt` : '',
    typeof style.lineHeight === 'number' ? `line-height:${style.lineHeight}` : '',
    typeof style.bold === 'boolean' ? `font-weight:${style.bold ? 700 : 400}` : '',
    style.textAlign ? `text-align:${style.textAlign}` : '',
    includePadding && typeof style.paddingMm === 'number' ? `padding:${style.paddingMm}mm` : '',
  ]
    .filter(Boolean)
    .join(';')
}

function buildDesignOverrideStyles(overrides?: TemplateDesignOverrides): string {
  const nodeStyles = overrides?.nodeStyles
  if (!nodeStyles) {
    return ''
  }

  return Object.entries(nodeStyles)
    .map(([designId, style]) => {
      const baseStyle = buildNodeCascadeStyle(style, false)
      const childStyle = buildNodeCascadeStyle(style, true)
      const tableCellStyle = buildTableCellCascadeStyle(style)
      const selector = `[data-design-id="${cssEscape(designId)}"]`
      const rules = [
        baseStyle ? `${selector} { ${baseStyle} }` : '',
        childStyle ? `${selector} p, ${selector} span, ${selector} strong, ${selector} em { ${childStyle} }` : '',
        tableCellStyle ? `${selector}.official-table-box td { ${tableCellStyle} }` : '',
      ]
      return rules.filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .join('\n')
}

function buildNodeCascadeStyle(style: TemplateNodeStyleOverride, forceTextChildren: boolean): string {
  return [
    style.fontFamily ? `font-family:${style.fontFamily}${forceTextChildren ? ' !important' : ''}` : '',
    typeof style.fontSizePt === 'number'
      ? `font-size:${style.fontSizePt}pt${forceTextChildren ? ' !important' : ''}`
      : '',
    typeof style.lineHeight === 'number'
      ? `line-height:${style.lineHeight}${forceTextChildren ? ' !important' : ''}`
      : '',
    typeof style.bold === 'boolean'
      ? `font-weight:${style.bold ? 700 : 400}${forceTextChildren ? ' !important' : ''}`
      : '',
    style.textAlign ? `text-align:${style.textAlign}${forceTextChildren ? ' !important' : ''}` : '',
  ]
    .filter(Boolean)
    .join(';')
}

function buildTableCellCascadeStyle(style: TemplateNodeStyleOverride): string {
  return [
    style.fontFamily ? `font-family:${style.fontFamily}` : '',
    typeof style.fontSizePt === 'number' ? `font-size:${style.fontSizePt}pt` : '',
    typeof style.lineHeight === 'number' ? `line-height:${style.lineHeight}` : '',
    typeof style.bold === 'boolean' ? `font-weight:${style.bold ? 700 : 400}` : '',
    style.textAlign ? `text-align:${style.textAlign}` : '',
    typeof style.paddingMm === 'number' ? `padding:${style.paddingMm}mm` : '',
  ]
    .filter(Boolean)
    .join(';')
}

function buildDesignerSelectionScript(): string {
  return `<script>
    var lastDropTarget = null;
    var resizeState = null;
    var imageMoveState = null;
    function closestDesignTarget(event) {
      return event.target && event.target.closest ? event.target.closest('[data-design-id]') : null;
    }
    function measureMmPerPx() {
      var probe = document.createElement('div');
      probe.style.position = 'absolute';
      probe.style.left = '-9999px';
      probe.style.top = '-9999px';
      probe.style.width = '100mm';
      document.body.appendChild(probe);
      var rect = probe.getBoundingClientRect();
      probe.remove();
      return rect.width ? 100 / rect.width : 0.264583;
    }
    function clearDropTarget() {
      if (lastDropTarget) {
        lastDropTarget.classList.remove('designer-drop-hover');
        lastDropTarget = null;
      }
    }
    document.addEventListener('click', function(event) {
      var target = closestDesignTarget(event);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      window.parent.postMessage({
        type: 'bitable-print-design-select',
        designId: target.getAttribute('data-design-id'),
        kind: target.getAttribute('data-design-kind') || 'element',
        tableId: target.getAttribute('data-table-id') || ''
      }, '*');
    }, true);
    document.addEventListener('dragover', function(event) {
      var target = closestDesignTarget(event);
      if (!target) {
        clearDropTarget();
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      if (lastDropTarget !== target) {
        clearDropTarget();
        lastDropTarget = target;
        lastDropTarget.classList.add('designer-drop-hover');
      }
    }, true);
    document.addEventListener('dragleave', function(event) {
      if (!event.relatedTarget || !document.contains(event.relatedTarget)) {
        clearDropTarget();
      }
    }, true);
    document.addEventListener('drop', function(event) {
      var target = closestDesignTarget(event);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      clearDropTarget();
      var raw = event.dataTransfer.getData('application/x-bitable-print-field') || event.dataTransfer.getData('text/plain');
      if (!raw) return;
      try {
        window.parent.postMessage({
          type: 'bitable-print-design-drop',
          designId: target.getAttribute('data-design-id'),
          kind: target.getAttribute('data-design-kind') || 'element',
          tableId: target.getAttribute('data-table-id') || '',
          field: JSON.parse(raw)
        }, '*');
      } catch (error) {
        window.parent.postMessage({
          type: 'bitable-print-design-error',
        message: '字段拖拽数据无法读取'
        }, '*');
      }
    }, true);
    function parseWidths(value) {
      try {
        var widths = JSON.parse(value || '[]');
        return Array.isArray(widths) ? widths.map(function(width) { return Number(width) || 0; }) : [];
      } catch (error) {
        return [];
      }
    }
    function updateTablePreview(wrapper, widths) {
      var total = widths.reduce(function(sum, width) { return sum + width; }, 0) || 100;
      var cols = wrapper.querySelectorAll('col');
      cols.forEach(function(col, index) {
        col.style.width = String(widths[index] || 0) + '%';
      });
      var left = 0;
      wrapper.querySelectorAll('.official-table-resizer').forEach(function(handle, index) {
        left += widths[index] || 0;
        handle.style.left = String((left / total) * 100) + '%';
      });
      wrapper.setAttribute('data-column-widths', JSON.stringify(widths));
    }
    function resizeColumns(startWidths, index, deltaPercent) {
      var widths = startWidths.slice();
      var minWidth = 3;
      var pairTotal = (startWidths[index] || 0) + (startWidths[index + 1] || 0);
      if (pairTotal <= minWidth * 2) return widths;
      var nextLeft = Math.max(minWidth, Math.min(pairTotal - minWidth, (startWidths[index] || 0) + deltaPercent));
      widths[index] = Number(nextLeft.toFixed(3));
      widths[index + 1] = Number((pairTotal - nextLeft).toFixed(3));
      return widths;
    }
    document.addEventListener('pointerdown', function(event) {
      var handle = event.target && event.target.closest ? event.target.closest('.official-table-resizer') : null;
      if (!handle) return;
      var wrapper = handle.closest('.official-table-box');
      if (!wrapper) return;
      event.preventDefault();
      event.stopPropagation();
      handle.classList.add('is-dragging');
      resizeState = {
        handle: handle,
        wrapper: wrapper,
        tableId: wrapper.getAttribute('data-design-id') || '',
        index: Number(handle.getAttribute('data-column-index')) || 0,
        startX: event.clientX,
        tableWidth: wrapper.getBoundingClientRect().width || 1,
        widths: parseWidths(wrapper.getAttribute('data-column-widths'))
      };
      try {
        handle.setPointerCapture(event.pointerId);
      } catch (error) {}
    }, true);
    document.addEventListener('pointerdown', function(event) {
      var wrapper = event.target && event.target.closest ? event.target.closest('.official-image-block') : null;
      if (!wrapper || wrapper.getAttribute('data-design-kind') !== 'image') return;
      var image = wrapper.querySelector('img');
      if (!image) return;
      event.preventDefault();
      event.stopPropagation();
      window.parent.postMessage({
        type: 'bitable-print-design-select',
        designId: wrapper.getAttribute('data-design-id'),
        kind: 'image',
        tableId: ''
      }, '*');
      imageMoveState = {
        wrapper: wrapper,
        image: image,
        designId: wrapper.getAttribute('data-design-id') || '',
        startX: event.clientX,
        startY: event.clientY,
        startImageX: Number(wrapper.getAttribute('data-image-x-mm')) || 0,
        startImageY: Number(wrapper.getAttribute('data-image-y-mm')) || 0,
        mmPerPx: measureMmPerPx()
      };
      wrapper.classList.add('is-image-moving');
      try {
        wrapper.setPointerCapture(event.pointerId);
      } catch (error) {}
    }, true);
    document.addEventListener('mousedown', function(event) {
      var wrapper = event.target && event.target.closest ? event.target.closest('.official-image-block') : null;
      if (!wrapper || wrapper.getAttribute('data-design-kind') !== 'image') return;
      var image = wrapper.querySelector('img');
      if (!image) return;
      event.preventDefault();
      event.stopPropagation();
      window.parent.postMessage({
        type: 'bitable-print-design-select',
        designId: wrapper.getAttribute('data-design-id'),
        kind: 'image',
        tableId: ''
      }, '*');
      imageMoveState = {
        wrapper: wrapper,
        image: image,
        designId: wrapper.getAttribute('data-design-id') || '',
        startX: event.clientX,
        startY: event.clientY,
        startImageX: Number(wrapper.getAttribute('data-image-x-mm')) || 0,
        startImageY: Number(wrapper.getAttribute('data-image-y-mm')) || 0,
        mmPerPx: measureMmPerPx()
      };
      wrapper.classList.add('is-image-moving');
    }, true);
    document.addEventListener('pointermove', function(event) {
      if (!resizeState) return;
      event.preventDefault();
      var deltaPercent = ((event.clientX - resizeState.startX) / resizeState.tableWidth) * 100;
      updateTablePreview(
        resizeState.wrapper,
        resizeColumns(resizeState.widths, resizeState.index, deltaPercent)
      );
    }, true);
    document.addEventListener('pointermove', function(event) {
      if (!imageMoveState) return;
      event.preventDefault();
      var nextX = imageMoveState.startImageX + ((event.clientX - imageMoveState.startX) * imageMoveState.mmPerPx);
      var nextY = imageMoveState.startImageY + ((event.clientY - imageMoveState.startY) * imageMoveState.mmPerPx);
      nextX = Number(nextX.toFixed(2));
      nextY = Number(nextY.toFixed(2));
      imageMoveState.wrapper.setAttribute('data-image-x-mm', String(nextX));
      imageMoveState.wrapper.setAttribute('data-image-y-mm', String(nextY));
      if (getComputedStyle(imageMoveState.image).position === 'absolute') { imageMoveState.image.style.left = nextX + 'mm'; imageMoveState.image.style.top = nextY + 'mm'; } else { imageMoveState.image.style.transform = 'translate(' + nextX + 'mm, ' + nextY + 'mm)'; }
    }, true);
    document.addEventListener('mousemove', function(event) {
      if (!imageMoveState) return;
      event.preventDefault();
      var nextX = imageMoveState.startImageX + ((event.clientX - imageMoveState.startX) * imageMoveState.mmPerPx);
      var nextY = imageMoveState.startImageY + ((event.clientY - imageMoveState.startY) * imageMoveState.mmPerPx);
      nextX = Number(nextX.toFixed(2));
      nextY = Number(nextY.toFixed(2));
      imageMoveState.wrapper.setAttribute('data-image-x-mm', String(nextX));
      imageMoveState.wrapper.setAttribute('data-image-y-mm', String(nextY));
      if (getComputedStyle(imageMoveState.image).position === 'absolute') { imageMoveState.image.style.left = nextX + 'mm'; imageMoveState.image.style.top = nextY + 'mm'; } else { imageMoveState.image.style.transform = 'translate(' + nextX + 'mm, ' + nextY + 'mm)'; }
    }, true);
    document.addEventListener('pointerup', function(event) {
      if (!resizeState) return;
      event.preventDefault();
      var widths = parseWidths(resizeState.wrapper.getAttribute('data-column-widths'));
      resizeState.handle.classList.remove('is-dragging');
      window.parent.postMessage({
        type: 'bitable-print-table-resize',
        tableId: resizeState.tableId,
        widths: widths
      }, '*');
      resizeState = null;
    }, true);
    document.addEventListener('pointerup', function(event) {
      if (!imageMoveState) return;
      event.preventDefault();
      var nextX = Number(imageMoveState.wrapper.getAttribute('data-image-x-mm')) || 0;
      var nextY = Number(imageMoveState.wrapper.getAttribute('data-image-y-mm')) || 0;
      imageMoveState.wrapper.classList.remove('is-image-moving');
      window.parent.postMessage({
        type: 'bitable-print-image-move',
        designId: imageMoveState.designId,
        xMm: nextX,
        yMm: nextY
      }, '*');
      imageMoveState = null;
    }, true);
    document.addEventListener('mouseup', function(event) {
      if (!imageMoveState) return;
      event.preventDefault();
      var nextX = Number(imageMoveState.wrapper.getAttribute('data-image-x-mm')) || 0;
      var nextY = Number(imageMoveState.wrapper.getAttribute('data-image-y-mm')) || 0;
      imageMoveState.wrapper.classList.remove('is-image-moving');
      window.parent.postMessage({
        type: 'bitable-print-image-move',
        designId: imageMoveState.designId,
        xMm: nextX,
        yMm: nextY
      }, '*');
      imageMoveState = null;
    }, true);
  </script>`
}

function getEffectiveColumnWidths(
  columns: { width?: number }[],
  overrideWidths?: number[],
): number[] {
  const fallbackWidth = 100 / Math.max(columns.length, 1)
  const rawWidths = columns.map((column, index) => {
    const width = overrideWidths?.[index] ?? column.width ?? fallbackWidth
    return Number.isFinite(width) && width > 0 ? width : fallbackWidth
  })
  const total = rawWidths.reduce((sum, width) => sum + width, 0)

  if (!Number.isFinite(total) || total <= 0) {
    return rawWidths
  }

  return rawWidths.map((width) => Number.parseFloat(((width / total) * 100).toFixed(3)))
}

function cssEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function numberCss(value: number | undefined, fallback: number): string {
  return Number.isFinite(value) ? String(value) : String(fallback)
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function pxToMm(value: number): number {
  return Number.parseFloat((value * 0.264583).toFixed(3))
}
