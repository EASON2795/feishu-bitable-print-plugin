import { bitable, ui, viewCheckers } from '@lark-base-open/js-sdk'
import type { IFieldMeta, IOpenCellValue, ITable, IView } from '@lark-base-open/js-sdk'
import {
  DOCUMENT_KIND_LABELS,
  EXPECTED_BASE_NAME,
  ITEM_FIELD_LABELS,
  LINKED_ITEMS_FIELD_NAME,
  MAIN_FIELD_LABELS,
  MAX_PI_DOCUMENTS_PER_BATCH,
  PI_ITEM_TABLE_NAME,
  PI_MAIN_TABLE_NAME,
  TEMPLATE_REGISTRY,
} from './piConfig'
import {
  type DataSourceSchema,
  type OfficialPrintDocumentData,
  type OfficialPrintValue,
  type PiItemFieldKey,
  type PiMainFieldKey,
  type PiPrintDocument,
  type PiPrintFields,
  type PiPrintItem,
  type PiPrintPayload,
  type PiSnapshot,
  type PrintTemplate,
  type ValidationIssue,
} from './types'

type FieldIdMap<T extends string> = Record<T, string | null>

type TableContext = {
  mainTable: ITable
  itemTable: ITable
  view: IView
  mainTableId: string
  mainTableName: string
  itemTableId: string
  itemTableName: string
  viewId: string
  viewName: string
}

const EMPTY_MAIN_FIELDS: PiPrintFields = {
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

const OFFICIAL_MAIN_FIELD_ALIASES: Record<PiMainFieldKey, readonly string[]> = {
  customerInvoiceTitle: [
    'customerInvoiceTitle',
    'customer',
    'buyer',
    '客户发票抬头',
    '客户抬头',
    '客户',
    '买方',
  ],
  invoiceNo: [
    'invoiceNo',
    'invoiceNumber',
    'orderNo',
    'piNo',
    'contractNo',
    '单据号',
    '发票号',
    '订单号',
    'PI号',
    '合同编号',
  ],
  invoiceDate: [
    'invoiceDate',
    'date',
    '单据日期',
    '发票日期',
    '签订时间',
    '发票箱单日期',
    '文本 4',
    '日期',
  ],
  totalWithCurrency: [
    'totalWithCurrency',
    'total',
    'amount',
    '总计代币种',
    '发票金额带币种',
    '总值',
    '总计',
    '总金额',
    '金额',
    '件数英文',
  ],
  sayAmount: [
    'sayAmount',
    'amountInWords',
    'SAY',
    '金额大写',
    '发票金额大写',
    '净重计算',
  ],
  paymentTerms: [
    'paymentTerms',
    'paymentTerm',
    'Payment Terms',
    'Payment Term',
    '付款条款',
    '支付条款',
    '毛重计算',
  ],
  priceTerms: [
    'priceTerms',
    'priceTerm',
    'tradeTerms',
    'Price Terms',
    'Price Term',
    '价格条款',
    '贸易条款',
    '体积计算',
  ],
  productionTime: [
    'productionTime',
    'leadTime',
    'Production Time',
    '生产时间',
    '交期',
    '件数计算',
  ],
  portOfDeparture: [
    'portOfDeparture',
    'departurePort',
    'Port of departure',
    'Port of Departure',
    '起运港',
  ],
  portOfDestination: [
    'portOfDestination',
    'destinationPort',
    'Port of destination',
    'Port of Destination',
    '目的港',
  ],
  bankInformation: ['bankInformation', 'bankInfo', '银行信息'],
}

const OFFICIAL_ITEM_FIELD_ALIASES: Record<PiItemFieldKey, readonly string[]> = {
  sortNo: ['sortNo', 'lineNo', 'sequenceNo', '序号', '行号'],
  itemName: [
    'itemName',
    'productName',
    'description',
    'ITEM NAME',
    '品名',
    '产品名称',
    '货物名称',
  ],
  specification: ['specification', 'spec', 'SPECIFICATION', '规格', '产品规格'],
  quantity: ['quantity', 'qty', 'QUANTITY', '数量', '实际生产数量'],
  unit: ['unit', 'UNIT', '单位', '件数'],
  unitPrice: ['unitPrice', 'price', 'UNIT PRICE', '单价', '净重'],
  subtotal: [
    'subtotal',
    'lineTotal',
    'SUB TOTAL',
    'SUBTOTAL形式发票',
    '小计',
    '金额小计',
    '实际发票',
    '毛重',
  ],
}

const SELECTION_POLL_INTERVAL_MS = 1000

export async function loadPiSnapshot(
  template: PrintTemplate = TEMPLATE_REGISTRY[0],
  recordIds?: string[],
): Promise<PiSnapshot> {
  const tableContext = await resolveTableContext(template)
  const issues: ValidationIssue[] = []
  const documentLabel = DOCUMENT_KIND_LABELS[template.documentKind] ?? '单据'

  if (tableContext.mainTableName !== template.mainTableName) {
    issues.push({
      severity: 'blocker',
      code: 'wrong-table',
      message: `请先在飞书表格左侧/左上角切换到数据表「${template.mainTableName}」，再勾选要打印的记录。当前表是「${tableContext.mainTableName}」，不是这个模板的数据源。`,
    })
    return buildSnapshot(tableContext, template, [], issues, [])
  }

  const scopedRecordIds = recordIds ?? (await getSelectedRecordIds(tableContext.view))
  if (scopedRecordIds.length > MAX_PI_DOCUMENTS_PER_BATCH) {
    issues.push({
      severity: 'blocker',
      code: 'batch-too-large',
      message: `一次最多生成 ${MAX_PI_DOCUMENTS_PER_BATCH} 条${documentLabel}，请分批选择记录。`,
    })
    return buildSnapshot(tableContext, template, [], issues, scopedRecordIds)
  }

  if (!scopedRecordIds.length) {
    issues.push({
      severity: 'blocker',
      code: 'no-records',
      message: `请先在飞书表格中选中要打印的${documentLabel}记录，或点击“进入批量模式”。`,
    })
    return buildSnapshot(tableContext, template, [], issues, [])
  }

  const documents = await loadPiDocuments(tableContext, template, scopedRecordIds, issues)
  return buildSnapshot(tableContext, template, documents, issues, scopedRecordIds)
}

export async function pickPiRecordIds(snapshot: PiSnapshot): Promise<string[]> {
  if (snapshot.context.source === 'mock') {
    return snapshot.selectedRecordIds
  }

  const wrongTableIssue = snapshot.issues.find((issue) => issue.code === 'wrong-table')
  if (wrongTableIssue) {
    throw new Error(wrongTableIssue.message)
  }

  const recordIds = await ui.selectRecordIdList(snapshot.context.mainTableId, snapshot.context.viewId)
  if (recordIds.length > MAX_PI_DOCUMENTS_PER_BATCH) {
    throw new Error(`一次最多选择 ${MAX_PI_DOCUMENTS_PER_BATCH} 条单据，请分批选择。`)
  }

  return recordIds
}

export async function notifyHost(message: string): Promise<void> {
  try {
    await ui.showToast({ message })
  } catch {
    // Outside the Feishu host this is a no-op.
  }
}

export async function loadDataSourceSchema(): Promise<DataSourceSchema> {
  try {
    const tableMetas = await bitable.base.getTableMetaList()
    const tables = await Promise.all(
      tableMetas.map(async (tableMeta) => {
        const table = await bitable.base.getTableById(tableMeta.id)
        const fields = await table.getFieldMetaList()
        return {
          id: tableMeta.id,
          name: tableMeta.name,
          fields: fields.map((field) => ({
            id: field.id,
            name: field.name,
            type: String(field.type),
          })),
        }
      }),
    )

    return {
      source: 'feishu',
      tables,
    }
  } catch {
    return getMockDataSourceSchema()
  }
}

export async function loadSyncedTemplate(): Promise<PrintTemplate | null> {
  return null
}

export function getMockDataSourceSchema(): DataSourceSchema {
  return {
    source: 'mock',
    tables: [
      {
        id: 'tbl_mock_pi_export',
        name: PI_MAIN_TABLE_NAME,
        fields: [
          ...Object.values(MAIN_FIELD_LABELS),
          LINKED_ITEMS_FIELD_NAME,
        ].map((name) => ({ id: `mock-${name}`, name, type: 'mock' })),
      },
      {
        id: 'tbl_mock_pi_items',
        name: PI_ITEM_TABLE_NAME,
        fields: Object.values(ITEM_FIELD_LABELS).map((name) => ({
          id: `mock-${name}`,
          name,
          type: 'mock',
        })),
      },
    ],
  }
}

export function subscribeSelectionChange(onChange: () => void): () => void {
  let isDisposed = false
  let isPolling = false
  let lastCheckedRecordFingerprint: string | null = null
  let unsubscribeHost = () => {}

  try {
    unsubscribeHost = bitable.base.onSelectionChange(() => {
      // The host event already schedules a refresh. Let the next poll establish a new
      // baseline so that the same interaction does not trigger a second refresh.
      lastCheckedRecordFingerprint = null
      onChange()
    })
  } catch {
    return () => {}
  }

  const pollCheckedRecords = async () => {
    if (isDisposed || isPolling) {
      return
    }

    isPolling = true
    try {
      const fingerprint = await getCheckedRecordFingerprint()
      if (lastCheckedRecordFingerprint === null) {
        lastCheckedRecordFingerprint = fingerprint
      } else if (fingerprint !== lastCheckedRecordFingerprint) {
        lastCheckedRecordFingerprint = fingerprint
        onChange()
      }
    } catch {
      // The Base can be switching tables or views while a poll is in flight.
    } finally {
      isPolling = false
    }
  }

  void pollCheckedRecords()
  const pollTimer = window.setInterval(() => {
    void pollCheckedRecords()
  }, SELECTION_POLL_INTERVAL_MS)

  return () => {
    isDisposed = true
    window.clearInterval(pollTimer)
    unsubscribeHost()
  }
}

async function getCheckedRecordFingerprint(): Promise<string> {
  const table = await bitable.base.getActiveTable()
  const view = await resolveActiveView(table)
  const [tableMeta, viewMeta] = await Promise.all([table.getMeta(), view.getMeta()])
  let recordIds: string[]

  if (viewCheckers.isGridView(view)) {
    recordIds = await view.getSelectedRecordIdList()
  } else {
    const selection = await bitable.base.getSelection()
    recordIds = selection.recordId ? [selection.recordId] : []
  }

  return `${tableMeta.id}:${viewMeta.id}:${[...recordIds].sort().join(',')}`
}

async function resolveTableContext(template: PrintTemplate): Promise<TableContext> {
  const mainTable = await bitable.base.getActiveTable()
  const view = await resolveActiveView(mainTable)
  const mainTableMeta = await mainTable.getMeta()
  const viewMeta = await view.getMeta()
  const itemTable = await bitable.base.getTableByName(template.itemTableName || PI_ITEM_TABLE_NAME)
  const itemTableMeta = await itemTable.getMeta()

  return {
    mainTable,
    itemTable,
    view,
    mainTableId: mainTableMeta.id,
    mainTableName: mainTableMeta.name,
    itemTableId: itemTableMeta.id,
    itemTableName: itemTableMeta.name,
    viewId: viewMeta.id,
    viewName: viewMeta.name,
  }
}

async function resolveActiveView(table: ITable): Promise<IView> {
  const selection = await bitable.base.getSelection()
  return selection.viewId ? table.getViewById(selection.viewId) : table.getActiveView()
}

async function getSelectedRecordIds(view: IView): Promise<string[]> {
  if (viewCheckers.isGridView(view)) {
    const selected = await view.getSelectedRecordIdList()
    if (selected.length) {
      return selected
    }
  }

  const selection = await bitable.base.getSelection()
  return selection.recordId ? [selection.recordId] : []
}

async function loadPiDocuments(
  tableContext: TableContext,
  template: PrintTemplate,
  recordIds: string[],
  issues: ValidationIssue[],
): Promise<PiPrintDocument[]> {
  if (template.officialTemplate) {
    return loadOfficialDocuments(tableContext, template, recordIds, issues)
  }

  const mainFieldIds = await resolveFieldIds<PiMainFieldKey>(
    tableContext.mainTable,
    buildMainFieldLabels(template),
    issues,
    'main-field-missing',
  )
  const itemFieldIds = await resolveFieldIds<PiItemFieldKey>(
    tableContext.itemTable,
    buildItemFieldLabels(template),
    issues,
    'item-field-missing',
  )
  const linkedItemsFieldId = await resolveSingleFieldId(
    tableContext.mainTable,
    template.linkedItemsFieldName || LINKED_ITEMS_FIELD_NAME,
    issues,
    'linked-items-field-missing',
  )

  const hasBlockingSchemaIssue = issues.some((issue) => issue.severity === 'blocker')
  if (hasBlockingSchemaIssue) {
    return []
  }

  const documents = await Promise.all(
    recordIds.map(async (recordId) => {
      const fields = await loadMainFields(tableContext.mainTable, recordId, mainFieldIds)
      const linkedValue = await tableContext.mainTable.getCellValue(linkedItemsFieldId, recordId)
      const linkedRecordIds = extractLinkedRecordIds(linkedValue)
      const items = await loadItems(tableContext.itemTable, linkedRecordIds, itemFieldIds)
      const sortedItems = sortItems(items)

      addDocumentIssues(recordId, template, fields, sortedItems, issues)

      return {
        recordId,
        title: fields.invoiceNo || recordId,
        fields,
        items: sortedItems,
      }
    }),
  )

  return documents
}

async function loadOfficialDocuments(
  tableContext: TableContext,
  template: PrintTemplate,
  recordIds: string[],
  issues: ValidationIssue[],
): Promise<PiPrintDocument[]> {
  const mainFieldIds = await resolveFieldIds<string>(
    tableContext.mainTable,
    buildTemplateFieldLabels(template.mainFields),
    issues,
    'official-main-field-missing',
  )
  const itemFieldIds = await resolveFieldIds<string>(
    tableContext.itemTable,
    buildTemplateFieldLabels(template.itemFields),
    issues,
    'official-item-field-missing',
  )
  const dynamicRoot = template.officialTemplate?.dynamicRoots[0] || template.linkedItemsFieldName
  const linkedItemsFieldId = await resolveSingleFieldId(
    tableContext.mainTable,
    template.linkedItemsFieldName || dynamicRoot,
    issues,
    'linked-items-field-missing',
  )

  const hasBlockingSchemaIssue = issues.some((issue) => issue.severity === 'blocker')
  if (hasBlockingSchemaIssue) {
    return []
  }

  const documents = await Promise.all(
    recordIds.map(async (recordId) => {
      const officialFields = await loadOfficialFieldValues(
        tableContext.mainTable,
        recordId,
        mainFieldIds,
      )
      const linkedValue = await tableContext.mainTable.getCellValue(linkedItemsFieldId, recordId)
      const linkedRecordIds = extractLinkedRecordIds(linkedValue)
      const itemRows = await loadOfficialItemRows(
        tableContext.itemTable,
        linkedRecordIds,
        itemFieldIds,
        dynamicRoot,
      )
      const official: OfficialPrintDocumentData = {
        fields: officialFields,
        itemGroups: {
          [dynamicRoot]: itemRows,
        },
      }
      const fields = buildCanonicalMainFields(officialFields, template.mainFields)
      const items = sortItems(
        buildCanonicalItems(itemRows, linkedRecordIds, recordId, template.itemFields),
      )
      const title = fields.invoiceNo || recordId
      fields.invoiceNo ||= title

      addOfficialDocumentIssues(recordId, template, official, issues)

      return {
        recordId,
        title,
        fields,
        items,
        official,
      }
    }),
  )

  return documents
}

function buildCanonicalMainFields(
  officialFields: Record<string, OfficialPrintValue>,
  mappings: PrintTemplate['mainFields'],
): PiPrintFields {
  const fields: PiPrintFields = { ...EMPTY_MAIN_FIELDS }

  ;(Object.keys(OFFICIAL_MAIN_FIELD_ALIASES) as PiMainFieldKey[]).forEach((key) => {
    fields[key] = readOfficialAliasText(
      officialFields,
      expandOfficialAliases(OFFICIAL_MAIN_FIELD_ALIASES[key], mappings),
    )
  })

  return fields
}

function buildCanonicalItems(
  itemRows: Record<string, OfficialPrintValue>[],
  linkedRecordIds: string[],
  documentRecordId: string,
  mappings: PrintTemplate['itemFields'],
): PiPrintItem[] {
  return itemRows.map((row, index) => {
    const item = {
      recordId: linkedRecordIds[index] || `${documentRecordId}-item-${index + 1}`,
      sortNo: '',
      itemName: '',
      specification: '',
      quantity: '',
      unit: '',
      unitPrice: '',
      subtotal: '',
    } satisfies PiPrintItem

    ;(Object.keys(OFFICIAL_ITEM_FIELD_ALIASES) as PiItemFieldKey[]).forEach((key) => {
      item[key] = readOfficialAliasText(
        row,
        expandOfficialAliases(OFFICIAL_ITEM_FIELD_ALIASES[key], mappings),
      )
    })

    return item
  })
}

function expandOfficialAliases(
  aliases: readonly string[],
  mappings: PrintTemplate['mainFields'],
): string[] {
  const expanded = new Set(aliases)
  const normalizedAliases = new Set(aliases.map(normalizeOfficialAlias))

  mappings.forEach((mapping) => {
    const mappingAliases = [mapping.key, getOfficialLeafFieldName(mapping.key), mapping.label]
    if (mappingAliases.some((alias) => normalizedAliases.has(normalizeOfficialAlias(alias)))) {
      mappingAliases.forEach((alias) => expanded.add(alias))
    }
  })

  return Array.from(expanded)
}

function readOfficialAliasText(
  values: Record<string, OfficialPrintValue>,
  aliases: readonly string[],
): string {
  for (const alias of aliases) {
    const text = values[alias]?.text.trim()
    if (text) {
      return text
    }
  }

  const normalizedValues = new Map<string, string>()
  Object.entries(values).forEach(([key, value]) => {
    const text = value.text.trim()
    if (text && !normalizedValues.has(normalizeOfficialAlias(key))) {
      normalizedValues.set(normalizeOfficialAlias(key), text)
    }
  })

  for (const alias of aliases) {
    const text = normalizedValues.get(normalizeOfficialAlias(alias))
    if (text) {
      return text
    }
  }

  return ''
}

function normalizeOfficialAlias(value: string): string {
  return getOfficialLeafFieldName(normalizeOfficialFieldPath(value))
    .toLocaleLowerCase()
    .replace(/[\s_.\-:：/\\()[\]{}]+/g, '')
}

function buildMainFieldLabels(template: PrintTemplate): Record<PiMainFieldKey, string> {
  return {
    ...MAIN_FIELD_LABELS,
    ...Object.fromEntries(
      template.mainFields
        .filter((field): field is { key: PiMainFieldKey; label: string; required: boolean } =>
          field.key in MAIN_FIELD_LABELS,
        )
        .map((field) => [field.key, field.label]),
    ),
  }
}

function buildItemFieldLabels(template: PrintTemplate): Record<PiItemFieldKey, string> {
  return {
    ...ITEM_FIELD_LABELS,
    ...Object.fromEntries(
      template.itemFields
        .filter((field): field is { key: PiItemFieldKey; label: string; required: boolean } =>
          field.key in ITEM_FIELD_LABELS,
        )
        .map((field) => [field.key, field.label]),
    ),
  }
}

function buildTemplateFieldLabels(fields: PrintTemplate['mainFields']): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, field.label]))
}

async function resolveFieldIds<T extends string>(
  table: ITable,
  labels: Record<T, string>,
  issues: ValidationIssue[],
  missingCode: string,
): Promise<FieldIdMap<T>> {
  const metaList = await table.getFieldMetaList()
  const map = Object.fromEntries(
    (Object.keys(labels) as T[]).map((key) => {
      const field = findFieldByName(metaList, labels[key])
      if (!field) {
        issues.push({
          severity: 'blocker',
          code: missingCode,
          message: `缺少字段「${labels[key]}」。`,
        })
      }

      return [key, field?.id ?? null]
    }),
  ) as FieldIdMap<T>

  return map
}

async function resolveSingleFieldId(
  table: ITable,
  name: string,
  issues: ValidationIssue[],
  missingCode: string,
): Promise<string> {
  const metaList = await table.getFieldMetaList()
  const field = findFieldByName(metaList, name)
  if (!field) {
    issues.push({
      severity: 'blocker',
      code: missingCode,
      message: `缺少关联字段「${name}」。`,
    })
  }

  return field?.id ?? ''
}

function findFieldByName(fields: IFieldMeta[], name: string): IFieldMeta | undefined {
  return fields.find((field) => field.name.trim() === name)
}

async function loadMainFields(
  table: ITable,
  recordId: string,
  fieldIds: FieldIdMap<PiMainFieldKey>,
): Promise<PiPrintFields> {
  const fields: PiPrintFields = { ...EMPTY_MAIN_FIELDS }

  await Promise.all(
    (Object.keys(fieldIds) as PiMainFieldKey[]).map(async (key) => {
      const fieldId = fieldIds[key]
      fields[key] = fieldId ? await safeGetCellString(table, fieldId, recordId) : ''
    }),
  )

  return fields
}

async function loadItems(
  table: ITable,
  recordIds: string[],
  fieldIds: FieldIdMap<PiItemFieldKey>,
): Promise<PiPrintItem[]> {
  return Promise.all(
    recordIds.map(async (recordId) => {
      const item = {
        recordId,
        sortNo: '',
        itemName: '',
        specification: '',
        quantity: '',
        unit: '',
        unitPrice: '',
        subtotal: '',
      } satisfies PiPrintItem

      await Promise.all(
        (Object.keys(fieldIds) as PiItemFieldKey[]).map(async (key) => {
          const fieldId = fieldIds[key]
          item[key] = fieldId ? await safeGetCellString(table, fieldId, recordId) : ''
        }),
      )

      return item
    }),
  )
}

async function safeGetCellString(table: ITable, fieldId: string, recordId: string): Promise<string> {
  try {
    const value = await table.getCellString(fieldId, recordId)
    return value.trim()
  } catch {
    return ''
  }
}

async function safeGetOfficialValue(
  table: ITable,
  fieldId: string,
  recordId: string,
): Promise<OfficialPrintValue> {
  const [text, rawValue] = await Promise.all([
    safeGetCellString(table, fieldId, recordId),
    safeGetCellValue(table, fieldId, recordId),
  ])

  return {
    text,
    imageUrls: extractImageUrls(rawValue),
  }
}

async function safeGetCellValue(
  table: ITable,
  fieldId: string,
  recordId: string,
): Promise<IOpenCellValue | null> {
  try {
    return await table.getCellValue(fieldId, recordId)
  } catch {
    return null
  }
}

async function loadOfficialFieldValues(
  table: ITable,
  recordId: string,
  fieldIds: FieldIdMap<string>,
): Promise<Record<string, OfficialPrintValue>> {
  const values: Record<string, OfficialPrintValue> = {}

  await Promise.all(
    Object.entries(fieldIds).map(async ([fieldRef, fieldId]) => {
      const value = fieldId ? await safeGetOfficialValue(table, fieldId, recordId) : { text: '' }
      addOfficialValueAliases(values, fieldRef, value)
    }),
  )

  return values
}

async function loadOfficialItemRows(
  table: ITable,
  recordIds: string[],
  fieldIds: FieldIdMap<string>,
  dynamicRoot: string,
): Promise<Record<string, OfficialPrintValue>[]> {
  return Promise.all(
    recordIds.map(async (recordId) => {
      const row: Record<string, OfficialPrintValue> = {}

      await Promise.all(
        Object.entries(fieldIds).map(async ([fieldRef, fieldId]) => {
          const value = fieldId ? await safeGetOfficialValue(table, fieldId, recordId) : { text: '' }
          addOfficialValueAliases(row, fieldRef, value, dynamicRoot)
        }),
      )

      return row
    }),
  )
}

function addOfficialValueAliases(
  target: Record<string, OfficialPrintValue>,
  fieldRef: string,
  value: OfficialPrintValue,
  dynamicRoot?: string,
) {
  const normalized = normalizeOfficialFieldPath(fieldRef)
  const stripped = dynamicRoot ? stripOfficialRoot(normalized, dynamicRoot) : normalized
  const leaf = getOfficialLeafFieldName(normalized)
  target[normalized] = value
  target[stripped] = value
  target[leaf] = value
}

function extractLinkedRecordIds(value: IOpenCellValue): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return []
  }

  const link = value as { recordIds?: unknown; record_ids?: unknown }
  const recordIds = Array.isArray(link.recordIds) ? link.recordIds : link.record_ids

  return Array.isArray(recordIds) ? recordIds.filter((id): id is string => typeof id === 'string') : []
}

function extractImageUrls(value: unknown): string[] {
  const urls = new Set<string>()

  const visit = (current: unknown) => {
    if (!current) {
      return
    }

    if (typeof current === 'string') {
      if (/^https?:\/\//i.test(current)) {
        urls.add(current)
      }
      return
    }

    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }

    if (typeof current === 'object') {
      const record = current as Record<string, unknown>
      ;['url', 'src', 'previewUrl', 'preview_url', 'fileUrl', 'file_url', 'tmpUrl', 'tmp_url'].forEach(
        (key) => {
          const next = record[key]
          if (typeof next === 'string' && /^https?:\/\//i.test(next)) {
            urls.add(next)
          }
        },
      )
      Object.values(record).forEach(visit)
    }
  }

  visit(value)
  return Array.from(urls)
}

function sortItems(items: PiPrintItem[]): PiPrintItem[] {
  return [...items].sort((left, right) => {
    const leftSort = parseSortNo(left.sortNo)
    const rightSort = parseSortNo(right.sortNo)

    if (leftSort === null && rightSort === null) {
      return 0
    }

    if (leftSort === null) {
      return 1
    }

    if (rightSort === null) {
      return -1
    }

    return leftSort - rightSort
  })
}

function parseSortNo(value: string): number | null {
  const numeric = Number.parseFloat(value.replace(/[^\d.-]/g, ''))
  return Number.isFinite(numeric) ? numeric : null
}

function addDocumentIssues(
  recordId: string,
  template: PrintTemplate,
  fields: PiPrintFields,
  items: PiPrintItem[],
  issues: ValidationIssue[],
) {
  const documentLabel = DOCUMENT_KIND_LABELS[template.documentKind] ?? '单据'
  const mainFieldLabels = buildMainFieldLabels(template)

  if (!items.length) {
    issues.push({
      severity: 'blocker',
      code: 'no-items',
      message: `这条${documentLabel}没有关联的订单明细，不能生成。`,
      recordId,
    })
  }

  if (!fields.totalWithCurrency) {
    const totalFieldKind = template.documentKind === 'packing-list' ? '汇总字段' : '金额字段'
    issues.push({
      severity: 'blocker',
      code: 'missing-total',
      message: `${totalFieldKind}「${mainFieldLabels.totalWithCurrency}」为空，不能生成${documentLabel}。`,
      recordId,
    })
  }

  if (!fields.sayAmount) {
    issues.push({
      severity: 'warning',
      code: 'missing-say',
      message: `金额大写字段「${mainFieldLabels.sayAmount}」为空，生成前建议补齐。`,
      recordId,
    })
  }

  if (!fields.customerInvoiceTitle) {
    issues.push({
      severity: 'warning',
      code: 'missing-customer-title',
      message: '客户发票抬头为空，PDF 中客户信息会留空。',
      recordId,
    })
  }
}

function addOfficialDocumentIssues(
  recordId: string,
  template: PrintTemplate,
  official: OfficialPrintDocumentData,
  issues: ValidationIssue[],
) {
  template.mainFields
    .filter((field) => field.required)
    .forEach((field) => {
      if (!official.fields[field.key]?.text) {
        issues.push({
          severity: 'blocker',
          code: 'official-main-field-empty',
          message: `模板字段「${field.label}」为空。`,
          recordId,
        })
      }
    })

  const dynamicRoot = template.officialTemplate?.dynamicRoots[0] || template.linkedItemsFieldName
  if (dynamicRoot && !(official.itemGroups[dynamicRoot]?.length)) {
    issues.push({
      severity: 'blocker',
      code: 'official-no-items',
      message: `模板动态明细「${dynamicRoot}」没有关联记录。`,
      recordId,
    })
  }
}

function normalizeOfficialFieldPath(path: string): string {
  return path.replaceAll('.', '/').replaceAll('//', '/').trim()
}

function stripOfficialRoot(path: string, root: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

function getOfficialLeafFieldName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) || path
}

function buildSnapshot(
  tableContext: TableContext,
  template: PrintTemplate,
  documents: PiPrintDocument[],
  issues: ValidationIssue[],
  selectedRecordIds: string[],
): PiSnapshot {
  const payload: PiPrintPayload = {
    templateId: template.rendererTemplateId || template.id,
    generatedAt: new Date().toISOString(),
    source: {
      baseName: EXPECTED_BASE_NAME,
      tableName: tableContext.mainTableName,
      viewName: tableContext.viewName,
    },
    documents,
  }

  return {
    context: {
      source: 'feishu',
      baseName: EXPECTED_BASE_NAME,
      mainTableId: tableContext.mainTableId,
      mainTableName: tableContext.mainTableName,
      itemTableId: tableContext.itemTableId,
      itemTableName: tableContext.itemTableName,
      viewId: tableContext.viewId,
      viewName: tableContext.viewName,
    },
    payload,
    issues,
    selectedRecordIds,
  }
}
