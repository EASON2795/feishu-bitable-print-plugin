import {
  ITEM_FIELD_LABELS,
  LINKED_ITEMS_FIELD_NAME,
  MAIN_FIELD_LABELS,
} from './piConfig'
import {
  OFFICIAL_LAYOUT_TEMPLATE_ID,
  type OfficialTemplateSummary,
  type PrintTemplate,
  type TemplateFieldMapping,
} from './types'

export type DesignerFieldSource = {
  source: 'main' | 'item'
  fieldName: string
  fieldType?: string
}

type DesignerContent = {
  document?: {
    pages?: DesignerPage[]
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

type DesignerPage = {
  rows?: DesignerRow[]
}

type DesignerRow = {
  columns?: DesignerColumn[]
}

type DesignerColumn = {
  width?: number
  blocks?: DesignerBlock[]
}

type DesignerBlock = {
  type?: number
  content?: DesignerParagraph[]
  table?: DesignerTable
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

type DesignerTable = {
  columns?: { width?: number }[]
  rows?: DesignerTableRow[]
  merges?: DesignerTableMerge[]
  dynamicRows?: DesignerDynamicRow[]
}

type DesignerTableRow = {
  cells?: DesignerTableCell[]
}

type DesignerTableCell = {
  content?: DesignerParagraph[]
  verticalAlign?: 'top' | 'middle' | 'bottom'
}

type DesignerTableMerge = {
  rowIndex?: number
  colIndex?: number
  rowSpan?: number
  colSpan?: number
}

type DesignerDynamicRow = {
  rowIndex?: number
  dataSource?: {
    rootPath?: string[]
  }
}

type DesignerParagraph = {
  type?: string
  align?: string
  children?: DesignerInlineNode[]
}

type DesignerInlineNode = {
  type?: string
  text?: string
  name?: string[]
  pathName?: string
  bold?: boolean
  fontSize?: string
  children?: DesignerInlineNode[]
}

export function makeDesignerReadyTemplate(template: PrintTemplate): PrintTemplate {
  if (template.officialTemplate) {
    return template
  }

  const mainFields = template.mainFields.length ? template.mainFields : createDefaultMainFields()
  const itemFields = template.itemFields.length ? template.itemFields : createDefaultItemFields()
  const linkedItemsFieldName = template.linkedItemsFieldName.trim() || LINKED_ITEMS_FIELD_NAME
  const content = createStandardOfficialContent({
    ...template,
    mainFields,
    itemFields,
    linkedItemsFieldName,
  })

  return {
    ...template,
    status: template.mainTableName.trim() && template.itemTableName.trim() ? template.status : 'draft',
    rendererTemplateId: OFFICIAL_LAYOUT_TEMPLATE_ID,
    linkedItemsFieldName,
    mainFields,
    itemFields,
    officialTemplate: summarizeOfficialTemplate(template.name, content),
  }
}

export function bindFieldToDesignTarget(
  template: PrintTemplate,
  designId: string,
  field: DesignerFieldSource,
): PrintTemplate {
  const editable = makeDesignerReadyTemplate(template)
  if (!editable.officialTemplate) {
    return editable
  }

  const content = cloneContent(editable.officialTemplate.content)
  const dynamicRoot = getDynamicRoot(editable)
  const existingMapping = findExistingMapping(editable, field)
  const fieldRef =
    field.source === 'item'
      ? buildItemFieldRef(dynamicRoot, existingMapping?.key ?? field.fieldName)
      : existingMapping?.key ?? field.fieldName
  const didReplace = replaceDesignTargetContent(content, designId, variableParagraphs(fieldRef))

  if (!didReplace) {
    return editable
  }

  const nextTemplate = addFieldMapping(editable, field, fieldRef)

  return {
    ...nextTemplate,
    officialTemplate: summarizeOfficialTemplate(nextTemplate.name, content),
  }
}

export function getDesignTargetText(template: PrintTemplate, designId: string): string {
  const content = template.officialTemplate?.content
  if (!content) {
    return ''
  }

  const target = getDesignTargetContent(content, designId)
  return target ? paragraphsToEditableText(target) : ''
}

export function updateDesignTargetText(
  template: PrintTemplate,
  designId: string,
  text: string,
): PrintTemplate {
  const editable = makeDesignerReadyTemplate(template)
  if (!editable.officialTemplate) {
    return editable
  }

  const content = cloneContent(editable.officialTemplate.content)
  const didReplace = replaceDesignTargetContent(content, designId, parseEditableText(text))
  if (!didReplace) {
    return editable
  }
  const nextTemplate = addMappingsFromEditableText(editable, text)

  return {
    ...nextTemplate,
    officialTemplate: summarizeOfficialTemplate(nextTemplate.name, content),
  }
}

function createStandardOfficialContent(template: PrintTemplate): DesignerContent {
  const settings = template.printSettings
  const text = settings.text
  const layout = settings.layout
  const dynamicRoot = getDynamicRoot(template)

  return {
    pageSetting: {
      width: 210,
      height: 297,
      paddingTop: layout.pagePaddingTopMm,
      paddingBottom: layout.pagePaddingBottomMm,
      paddingLeft: layout.pagePaddingXMm,
      paddingRight: layout.pagePaddingXMm,
    },
    settings: {
      lang: 'zh-CN',
      fontSize: layout.fontSizePt,
      defaultLineHeight: 1.38,
    },
    document: {
      pages: [
        {
          rows: [
            fullRow(tableBlock([100], [
              [cell(text.companyName, 'center')],
              [cell(text.companyAddress, 'center')],
              [cell(text.companyContact, 'center')],
            ])),
            fullRow(textBlock(text.documentTitle, 'center')),
            fullRow(tableBlock(
              [50, 50],
              [
                [
                  variableCell(findMainRef(template, 'customerInvoiceTitle'), ''),
                  mixedCell(`${text.invoiceNoLabel}：`, findMainRef(template, 'invoiceNo')),
                ],
                [
                  cell(''),
                  mixedCell(`${text.dateLabel}: `, findMainRef(template, 'invoiceDate')),
                ],
              ],
              [{ rowIndex: 0, colIndex: 0, rowSpan: 2, colSpan: 1 }],
            )),
            fullRow(tableBlock(
              [
                layout.columnWidths.itemName,
                layout.columnWidths.specification,
                layout.columnWidths.quantity,
                layout.columnWidths.unit,
                layout.columnWidths.unitPrice,
                layout.columnWidths.subtotal,
              ],
              [
                [
                  cell(text.itemHeaders.itemName),
                  cell(text.itemHeaders.specification),
                  cell(text.itemHeaders.quantity),
                  cell(text.itemHeaders.unit),
                  cell(text.itemHeaders.unitPrice),
                  cell(text.itemHeaders.subtotal),
                ],
                [
                  variableCell(buildItemFieldRef(dynamicRoot, findItemRef(template, 'itemName'))),
                  variableCell(buildItemFieldRef(dynamicRoot, findItemRef(template, 'specification'))),
                  variableCell(buildItemFieldRef(dynamicRoot, findItemRef(template, 'quantity'))),
                  variableCell(buildItemFieldRef(dynamicRoot, findItemRef(template, 'unit'))),
                  variableCell(buildItemFieldRef(dynamicRoot, findItemRef(template, 'unitPrice'))),
                  variableCell(buildItemFieldRef(dynamicRoot, findItemRef(template, 'subtotal'))),
                ],
              ],
              undefined,
              [{ rowIndex: 1, dataSource: { rootPath: [dynamicRoot] } }],
            )),
            fullRow(tableBlock([100], [
              [mixedCell(`${text.totalLabel}:`, findMainRef(template, 'totalWithCurrency'))],
              [mixedCell(`${text.sayLabel} `, findMainRef(template, 'sayAmount'))],
              [mixedCell(`${text.paymentTermsLabel}: `, findMainRef(template, 'paymentTerms'))],
              [mixedCell(`${text.priceTermsLabel}: `, findMainRef(template, 'priceTerms'))],
              [mixedCell(`${text.productionTimeLabel}: `, findMainRef(template, 'productionTime'))],
              [mixedCell(`${text.portOfDepartureLabel}: `, findMainRef(template, 'portOfDeparture'))],
              [mixedCell(`${text.portOfDestinationLabel}: `, findMainRef(template, 'portOfDestination'))],
              [mixedCell(`${text.bankInformationLabel}：`, findMainRef(template, 'bankInformation'))],
            ])),
          ],
        },
      ],
    },
  }
}

function fullRow(block: DesignerBlock): DesignerRow {
  return {
    columns: [
      {
        width: 100,
        blocks: [block],
      },
    ],
  }
}

function textBlock(text: string, align: string = 'left'): DesignerBlock {
  return {
    content: textParagraphs(text, align),
  }
}

function tableBlock(
  columnWidths: number[],
  rows: DesignerTableCell[][],
  merges?: DesignerTableMerge[],
  dynamicRows?: DesignerDynamicRow[],
): DesignerBlock {
  return {
    table: {
      columns: columnWidths.map((width) => ({ width })),
      rows: rows.map((row) => ({ cells: row })),
      merges,
      dynamicRows,
    },
  }
}

function cell(text: string, align: string = 'left'): DesignerTableCell {
  return {
    content: textParagraphs(text, align),
  }
}

function mixedCell(prefix: string, fieldRef: string): DesignerTableCell {
  return {
    content: [
      {
        type: 'paragraph',
        children: [
          { text: prefix },
          { type: 'variable', name: splitFieldRef(fieldRef) },
        ],
      },
    ],
  }
}

function variableCell(fieldRef: string, fallbackPrefix = ''): DesignerTableCell {
  return {
    content: [
      {
        type: 'paragraph',
        children: [
          ...(fallbackPrefix ? [{ text: fallbackPrefix }] : []),
          { type: 'variable', name: splitFieldRef(fieldRef) },
        ],
      },
    ],
  }
}

function textParagraphs(text: string, align: string): DesignerParagraph[] {
  const lines = text.split(/\r?\n/)
  return (lines.length ? lines : ['']).map((line) => ({
    type: 'paragraph',
    align,
    children: [{ text: line }],
  }))
}

function variableParagraphs(fieldRef: string): DesignerParagraph[] {
  return [
    {
      type: 'paragraph',
      children: [{ type: 'variable', name: splitFieldRef(fieldRef) }],
    },
  ]
}

function parseEditableText(text: string): DesignerParagraph[] {
  return text.split(/\r?\n/).map((line) => ({
    type: 'paragraph',
    children: parseInlineText(line),
  }))
}

function parseInlineText(text: string): DesignerInlineNode[] {
  const nodes: DesignerInlineNode[] = []
  const variablePattern = /\[([^\]]+)]/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = variablePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ text: text.slice(lastIndex, match.index) })
    }
    nodes.push({ type: 'variable', name: splitFieldRef(match[1]) })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push({ text: text.slice(lastIndex) })
  }

  return nodes.length ? nodes : [{ text: '' }]
}

function paragraphsToEditableText(paragraphs: DesignerParagraph[]): string {
  return paragraphs.map((paragraph) => inlineNodesToText(paragraph.children ?? [])).join('\n')
}

function inlineNodesToText(nodes: DesignerInlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.name) {
        return `[${normalizeFieldPath(node.name)}]`
      }
      if (node.pathName) {
        return `[${normalizeFieldPath(node.pathName)}]`
      }
      if (node.children?.length) {
        return inlineNodesToText(node.children)
      }
      return node.text ?? ''
    })
    .join('')
}

function replaceDesignTargetContent(
  content: Record<string, unknown>,
  designId: string,
  nextContent: DesignerParagraph[],
): boolean {
  const target = getDesignTarget(content, designId)
  if (!target) {
    return false
  }

  target.content = nextContent
  return true
}

function getDesignTargetContent(
  content: Record<string, unknown>,
  designId: string,
): DesignerParagraph[] | null {
  return getDesignTarget(content, designId)?.content ?? null
}

function getDesignTarget(
  content: Record<string, unknown>,
  designId: string,
): { content?: DesignerParagraph[] } | null {
  const parsed = parseDesignId(designId)
  if (!parsed) {
    return null
  }

  const designerContent = content as DesignerContent
  const block =
    designerContent.document?.pages?.[parsed.pageIndex]?.rows?.[parsed.rowIndex]?.columns?.[
      parsed.columnIndex
    ]?.blocks?.[parsed.blockIndex]

  if (!block) {
    return null
  }

  if (parsed.type === 'block') {
    return block
  }

  if (parsed.type === 'cell') {
    return block.table?.rows?.[parsed.tableRowIndex]?.cells?.[parsed.tableColIndex] ?? null
  }

  return null
}

function parseDesignId(designId: string):
  | {
      type: 'block'
      pageIndex: number
      rowIndex: number
      columnIndex: number
      blockIndex: number
    }
  | {
      type: 'cell'
      pageIndex: number
      rowIndex: number
      columnIndex: number
      blockIndex: number
      tableRowIndex: number
      tableColIndex: number
    }
  | null {
  const blockMatch = designId.match(/^block:p(\d+)-r(\d+)-c(\d+)-b(\d+)$/)
  if (blockMatch) {
    return {
      type: 'block',
      pageIndex: Number(blockMatch[1]),
      rowIndex: Number(blockMatch[2]),
      columnIndex: Number(blockMatch[3]),
      blockIndex: Number(blockMatch[4]),
    }
  }

  const cellMatch = designId.match(/^cell:p(\d+)-r(\d+)-c(\d+)-b(\d+)-row(\d+)-col(\d+)$/)
  if (cellMatch) {
    return {
      type: 'cell',
      pageIndex: Number(cellMatch[1]),
      rowIndex: Number(cellMatch[2]),
      columnIndex: Number(cellMatch[3]),
      blockIndex: Number(cellMatch[4]),
      tableRowIndex: Number(cellMatch[5]),
      tableColIndex: Number(cellMatch[6]),
    }
  }

  return null
}

function addFieldMapping(
  template: PrintTemplate,
  field: DesignerFieldSource,
  fieldRef: string,
): PrintTemplate {
  if (field.source === 'main') {
    return {
      ...template,
      mainFields: upsertFieldMapping(template.mainFields, fieldRef, field.fieldName),
    }
  }

  return {
    ...template,
    itemFields: upsertFieldMapping(template.itemFields, fieldRef, field.fieldName),
  }
}

function addMappingsFromEditableText(template: PrintTemplate, text: string): PrintTemplate {
  const dynamicRoot = getDynamicRoot(template)

  return extractEditableFieldRefs(text).reduce((current, fieldRef) => {
    const normalized = normalizeFieldPath(fieldRef)
    if (!normalized) {
      return current
    }

    if (isChildFieldPath(normalized, dynamicRoot)) {
      return {
        ...current,
        itemFields: upsertFieldMapping(current.itemFields, normalized, getLeafFieldName(normalized)),
      }
    }

    return {
      ...current,
      mainFields: upsertFieldMapping(current.mainFields, normalized, getLeafFieldName(normalized)),
    }
  }, template)
}

function extractEditableFieldRefs(text: string): string[] {
  return Array.from(text.matchAll(/\[([^\]]+)]/g), (match) => match[1])
}

function upsertFieldMapping(
  fields: TemplateFieldMapping[],
  key: string,
  label: string,
): TemplateFieldMapping[] {
  if (fields.some((field) => field.key === key)) {
    return fields.map((field) => (field.key === key ? { ...field, label } : field))
  }

  return [...fields, { key, label, required: false }]
}

function findExistingMapping(
  template: PrintTemplate,
  field: DesignerFieldSource,
): TemplateFieldMapping | undefined {
  const fields = field.source === 'main' ? template.mainFields : template.itemFields
  return fields.find((mapping) => mapping.label === field.fieldName || mapping.key === field.fieldName)
}

function findMainRef(template: PrintTemplate, fallbackKey: string): string {
  return template.mainFields.find((field) => field.key === fallbackKey)?.key ?? fallbackKey
}

function findItemRef(template: PrintTemplate, fallbackKey: string): string {
  return template.itemFields.find((field) => field.key === fallbackKey)?.key ?? fallbackKey
}

function buildItemFieldRef(dynamicRoot: string, fieldRef: string): string {
  const normalized = normalizeFieldPath(fieldRef)
  if (normalized === dynamicRoot || normalized.startsWith(`${dynamicRoot}/`)) {
    return normalized
  }

  return `${dynamicRoot}/${normalized}`
}

function getDynamicRoot(template: PrintTemplate): string {
  return template.officialTemplate?.dynamicRoots[0] || template.linkedItemsFieldName || LINKED_ITEMS_FIELD_NAME
}

function createDefaultMainFields(): TemplateFieldMapping[] {
  return Object.entries(MAIN_FIELD_LABELS).map(([key, label]) => ({
    key,
    label,
    required: ['invoiceNo', 'invoiceDate', 'totalWithCurrency'].includes(key),
  }))
}

function createDefaultItemFields(): TemplateFieldMapping[] {
  return Object.entries(ITEM_FIELD_LABELS).map(([key, label]) => ({
    key,
    label,
    required: ['itemName', 'quantity', 'unitPrice', 'subtotal'].includes(key),
  }))
}

function summarizeOfficialTemplate(exportName: string, content: DesignerContent): OfficialTemplateSummary {
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
      const table = node.table as DesignerTable
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
  const pageCount = Array.isArray(content.document?.pages) ? content.document.pages.length : 0

  return {
    exportName,
    content: content as Record<string, unknown>,
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

function splitFieldRef(fieldRef: string): string[] {
  return normalizeFieldPath(fieldRef).split('/').filter(Boolean)
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

function cloneContent(content: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(content)
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
