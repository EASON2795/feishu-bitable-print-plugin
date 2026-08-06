import type {
  DataSourceSchema,
  PiPrintDocument,
  PiPrintFields,
  PiPrintItem,
  PiSnapshot,
} from './types'

const MAX_IMPORT_BYTES = 5 * 1024 * 1024
const MAX_DOCUMENTS = 20
const MAIN_TABLE_NAME = '本地导入单据'
const ITEM_TABLE_NAME = '本地导入明细'

const EMPTY_FIELDS: PiPrintFields = {
  customerInvoiceTitle: '',
  invoiceNo: '',
  invoiceDate: '',
  totalWithCurrency: '',
  sayAmount: '',
  paymentTerms: '',
  priceTerms: '',
  productionTime: '',
  portOfDeparture: '',
  portOfDestination: '',
  bankInformation: '',
}

const EMPTY_ITEM: Omit<PiPrintItem, 'recordId'> = {
  sortNo: '',
  itemName: '',
  specification: '',
  quantity: '',
  unit: '',
  unitPrice: '',
  subtotal: '',
}

const FIELD_ALIASES: Record<keyof PiPrintFields, string[]> = {
  customerInvoiceTitle: ['customerInvoiceTitle', 'customer', 'buyer', '客户抬头', '客户', '买方'],
  invoiceNo: ['invoiceNo', 'invoiceNumber', 'orderNo', 'piNo', '单据号', '发票号', '订单号', 'PI号'],
  invoiceDate: ['invoiceDate', 'date', '单据日期', '发票日期', '日期'],
  totalWithCurrency: ['totalWithCurrency', 'total', 'amount', '总计', '总金额', '金额'],
  sayAmount: ['sayAmount', 'amountInWords', '金额大写'],
  paymentTerms: ['paymentTerms', '付款条款', '支付条款'],
  priceTerms: ['priceTerms', 'tradeTerms', '价格条款', '贸易条款'],
  productionTime: ['productionTime', 'leadTime', '生产时间', '交期'],
  portOfDeparture: ['portOfDeparture', 'departurePort', '起运港'],
  portOfDestination: ['portOfDestination', 'destinationPort', '目的港'],
  bankInformation: ['bankInformation', 'bankInfo', '银行信息'],
}

const ITEM_ALIASES: Record<keyof typeof EMPTY_ITEM, string[]> = {
  sortNo: ['sortNo', 'lineNo', '序号', '行号'],
  itemName: ['itemName', 'productName', 'description', '品名', '产品名称', '货物名称'],
  specification: ['specification', 'spec', '规格', '产品规格'],
  quantity: ['quantity', 'qty', '数量'],
  unit: ['unit', '单位'],
  unitPrice: ['unitPrice', 'price', '单价'],
  subtotal: ['subtotal', 'lineTotal', '小计', '金额小计'],
}

type ImportResult = {
  snapshot: PiSnapshot
  schema: DataSourceSchema
}

type UnknownRecord = Record<string, unknown>

export async function importDataFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('文件不能超过 5 MB。')
  }

  const text = (await file.text()).replace(/^\uFEFF/, '')
  if (!text.trim()) {
    throw new Error('文件内容为空。')
  }

  const lowerName = file.name.toLowerCase()
  if (lowerName.endsWith('.json')) {
    return importJson(text, file.name)
  }

  if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv')) {
    return importDelimitedText(text, file.name)
  }

  throw new Error('暂时只支持 CSV、TSV 或 JSON 文件。')
}

function importJson(text: string, sourceName: string): ImportResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('JSON 格式不正确，请检查逗号、引号和括号。')
  }

  if (Array.isArray(parsed)) {
    return buildFromFlatRows(parsed, sourceName)
  }

  if (!isRecord(parsed)) {
    throw new Error('JSON 顶层应为对象或数组。')
  }

  const payload = isRecord(parsed.payload) ? parsed.payload : parsed
  const rawDocuments = Array.isArray(payload.documents) ? payload.documents : null
  if (!rawDocuments) {
    throw new Error('JSON 中没有找到 documents 数组。')
  }

  const documents = rawDocuments.map((document, index) => normalizeJsonDocument(document, index))
  return makeImportResult(documents, sourceName, collectJsonSchema(rawDocuments))
}

function importDelimitedText(text: string, sourceName: string): ImportResult {
  const delimiter = detectDelimiter(text)
  const matrix = parseDelimitedText(text, delimiter).filter((row) => row.some((cell) => cell.trim()))
  if (matrix.length < 2) {
    throw new Error('CSV 至少需要一行表头和一行数据。')
  }

  const headers = matrix[0].map((header) => header.trim())
  const rows = matrix.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() ?? ''])),
  )

  return buildFromFlatRows(rows, sourceName)
}

function buildFromFlatRows(rows: unknown[], sourceName: string): ImportResult {
  const normalizedRows = rows.filter(isRecord)
  if (!normalizedRows.length) {
    throw new Error('没有找到可导入的数据行。')
  }

  const documents = new Map<string, PiPrintDocument>()
  normalizedRows.forEach((row, rowIndex) => {
    const fields = readMappedFields(row, FIELD_ALIASES, EMPTY_FIELDS)
    const invoiceNo = fields.invoiceNo || `LOCAL-${String(rowIndex + 1).padStart(3, '0')}`
    const groupKey = invoiceNo
    const existing = documents.get(groupKey)
    const document = existing ?? {
      recordId: makeSafeId(invoiceNo, rowIndex),
      title: invoiceNo,
      fields: { ...EMPTY_FIELDS, invoiceNo },
      items: [],
    }

    mergeFirstNonEmpty(document.fields, fields)
    const itemValues = readMappedFields(row, ITEM_ALIASES, EMPTY_ITEM)
    if (Object.values(itemValues).some(Boolean)) {
      document.items.push({
        ...itemValues,
        sortNo: itemValues.sortNo || String(document.items.length + 1),
        recordId: `${document.recordId}-item-${document.items.length + 1}`,
      })
    }

    documents.set(groupKey, document)
  })

  return makeImportResult([...documents.values()], sourceName, Object.keys(normalizedRows[0]))
}

function normalizeJsonDocument(value: unknown, index: number): PiPrintDocument {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 条 documents 不是对象。`)
  }

  const rawFields = isRecord(value.fields) ? value.fields : value
  const fields = readMappedFields(rawFields, FIELD_ALIASES, EMPTY_FIELDS)
  const invoiceNo = fields.invoiceNo || readString(value, ['title', 'recordId']) || `LOCAL-${index + 1}`
  const recordId = readString(value, ['recordId']) || makeSafeId(invoiceNo, index)
  const rawItems = Array.isArray(value.items) ? value.items : []
  const items = rawItems.filter(isRecord).map((item, itemIndex) => {
    const normalized = readMappedFields(item, ITEM_ALIASES, EMPTY_ITEM)
    return {
      ...normalized,
      sortNo: normalized.sortNo || String(itemIndex + 1),
      recordId: readString(item, ['recordId']) || `${recordId}-item-${itemIndex + 1}`,
    }
  })

  return {
    recordId,
    title: readString(value, ['title']) || invoiceNo,
    fields: { ...fields, invoiceNo },
    items,
  }
}

function makeImportResult(
  documents: PiPrintDocument[],
  sourceName: string,
  headers: string[],
): ImportResult {
  if (!documents.length) {
    throw new Error('没有找到可打印的单据。')
  }

  if (documents.length > MAX_DOCUMENTS) {
    throw new Error(`一次最多导入 ${MAX_DOCUMENTS} 条单据，请分批处理。`)
  }

  const selectedRecordIds = documents.map((document) => document.recordId)
  const fieldNames = headers.length ? headers : [...Object.keys(EMPTY_FIELDS), ...Object.keys(EMPTY_ITEM)]

  return {
    snapshot: {
      context: {
        source: 'local',
        baseName: 'Chrome 本地数据',
        mainTableId: 'local-main',
        mainTableName: MAIN_TABLE_NAME,
        itemTableId: 'local-items',
        itemTableName: ITEM_TABLE_NAME,
        viewId: 'local-import',
        viewName: sourceName,
      },
      payload: {
        templateId: '',
        generatedAt: new Date().toISOString(),
        source: {
          baseName: 'Chrome 本地数据',
          tableName: MAIN_TABLE_NAME,
          viewName: sourceName,
        },
        documents,
      },
      issues: [
        {
          severity: 'info',
          code: 'local-import',
          message: `已从「${sourceName}」导入 ${documents.length} 条单据；数据只保留在当前页面。`,
        },
      ],
      selectedRecordIds,
    },
    schema: {
      source: 'local',
      tables: [
        {
          id: 'local-main',
          name: MAIN_TABLE_NAME,
          fields: fieldNames.map((name) => ({ id: `local-${normalizeKey(name)}`, name, type: 'text' })),
        },
      ],
    },
  }
}

function collectJsonSchema(documents: unknown[]): string[] {
  const names = new Set<string>()
  documents.filter(isRecord).forEach((document) => {
    const fields = isRecord(document.fields) ? document.fields : document
    Object.keys(fields).forEach((name) => names.add(name))
    const firstItem = Array.isArray(document.items) ? document.items.find(isRecord) : undefined
    if (firstItem) {
      Object.keys(firstItem).forEach((name) => names.add(name))
    }
  })
  return [...names]
}

function readMappedFields<T extends Record<string, string>>(
  source: UnknownRecord,
  aliases: Record<keyof T, string[]>,
  fallback: T,
): T {
  const normalizedEntries = new Map(
    Object.entries(source).map(([key, value]) => [normalizeKey(key), stringifyCell(value)]),
  )
  const result = { ...fallback }

  for (const key of Object.keys(aliases) as (keyof T)[]) {
    const matched = aliases[key]
      .map((alias) => normalizedEntries.get(normalizeKey(alias)))
      .find((value) => Boolean(value))
    result[key] = (matched ?? '') as T[keyof T]
  }

  return result
}

function mergeFirstNonEmpty<T extends Record<string, string>>(target: T, source: T) {
  for (const key of Object.keys(target) as (keyof T)[]) {
    if (!target[key] && source[key]) {
      target[key] = source[key]
    }
  }
}

function readString(source: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = stringifyCell(source[key])
    if (value) {
      return value
    }
  }
  return ''
}

function stringifyCell(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[\s_./\\\-()（）:：]/g, '')
}

function makeSafeId(value: string, index: number): string {
  const slug = value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return `local-${slug || index + 1}`
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function detectDelimiter(text: string): ',' | '\t' | ';' {
  const firstLine = text.split(/\r?\n/, 1)[0]
  const candidates: (',' | '\t' | ';')[] = [',', '\t', ';']
  return candidates.sort((left, right) => countChar(firstLine, right) - countChar(firstLine, left))[0]
}

function countChar(value: string, char: string): number {
  return [...value].filter((current) => current === char).length
}

function parseDelimitedText(text: string, delimiter: ',' | '\t' | ';'): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }

    if (!quoted && char === delimiter) {
      row.push(field)
      field = ''
      continue
    }

    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1
      }
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }

    field += char
  }

  if (quoted) {
    throw new Error('CSV 中存在未闭合的引号。')
  }

  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }

  return rows
}
