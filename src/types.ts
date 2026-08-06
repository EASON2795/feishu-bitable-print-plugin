export const PROFORMA_INVOICE_TEMPLATE_ID = 'proforma-invoice-no-photo' as const
export const COMMERCIAL_INVOICE_TEMPLATE_ID = 'commercial-invoice-no-photo' as const
export const PACKING_LIST_TEMPLATE_ID = 'packing-list-no-photo' as const
export const PURCHASE_ORDER_TEMPLATE_ID = 'purchase-order-no-photo' as const
export const OFFICIAL_LAYOUT_TEMPLATE_ID = 'official-layout-template' as const

export type TemplateId = string

export type BuiltInTemplateId =
  | typeof PROFORMA_INVOICE_TEMPLATE_ID
  | typeof COMMERCIAL_INVOICE_TEMPLATE_ID
  | typeof PACKING_LIST_TEMPLATE_ID
  | typeof PURCHASE_ORDER_TEMPLATE_ID

export type DocumentKind =
  | 'proforma-invoice'
  | 'commercial-invoice'
  | 'packing-list'
  | 'purchase-order'

export type PrintTemplateStatus = 'ready' | 'draft'

export type TemplateFieldMapping = {
  key: string
  label: string
  required: boolean
}

export type DataSourceFieldOption = {
  id: string
  name: string
  type: string
}

export type DataSourceTableOption = {
  id: string
  name: string
  fields: DataSourceFieldOption[]
}

export type DataSourceSchema = {
  source: 'feishu' | 'mock' | 'local'
  tables: DataSourceTableOption[]
}

export type PageMode = 'a4-auto' | 'continuous' | 'fit-one-page'

export type ItemColumnKey =
  | 'itemName'
  | 'specification'
  | 'quantity'
  | 'unit'
  | 'unitPrice'
  | 'subtotal'

export type TemplateTextSettings = {
  companyName: string
  companyAddress: string
  companyContact: string
  documentTitle: string
  invoiceNoLabel: string
  dateLabel: string
  totalLabel: string
  sayLabel: string
  paymentTermsLabel: string
  priceTermsLabel: string
  productionTimeLabel: string
  portOfDepartureLabel: string
  portOfDestinationLabel: string
  bankInformationLabel: string
  itemHeaders: Record<ItemColumnKey, string>
}

export type TemplateLayoutSettings = {
  pageMode: PageMode
  fontSizePt: number
  headerFontSizePt: number
  titleFontSizePt: number
  pagePaddingTopMm: number
  pagePaddingBottomMm: number
  pagePaddingXMm: number
  titleGapMm: number
  itemTableGapMm: number
  summaryGapMm: number
  bankHeightMm: number
  stampTopMm: number
  stampRightMm: number
  stampWidthMm: number
  columnWidths: Record<ItemColumnKey, number>
}

export type TemplatePrintSettings = {
  text: TemplateTextSettings
  layout: TemplateLayoutSettings
}

export type TextAlign = 'left' | 'center' | 'right'

export type TemplateNodeStyleOverride = {
  fontFamily?: string
  fontSizePt?: number
  lineHeight?: number
  bold?: boolean
  textAlign?: TextAlign
  paddingMm?: number
  imageWidthMm?: number
  imageOffsetXMm?: number
  imageOffsetYMm?: number
}

export type TemplatePageStyleOverride = {
  pageMode?: PageMode
  fontSizePt?: number
  lineHeight?: number
  pagePaddingTopMm?: number
  pagePaddingBottomMm?: number
  pagePaddingXMm?: number
}

export type TemplateDesignOverrides = {
  pageSettings?: TemplatePageStyleOverride
  nodeStyles?: Record<string, TemplateNodeStyleOverride>
  tableColumnWidths?: Record<string, number[]>
}

export type OfficialTemplateSummary = {
  exportName: string
  content: Record<string, unknown>
  fieldRefs: string[]
  mainFieldRefs: string[]
  itemFieldRefs: string[]
  dynamicRoots: string[]
  pageCount: number
  tableCount: number
  staticImageCount: number
  attachmentFieldCount: number
}

export type PrintTemplate = {
  id: TemplateId
  name: string
  documentKind: DocumentKind
  description: string
  status: PrintTemplateStatus
  isBuiltIn: boolean
  mainTableName: string
  itemTableName: string
  linkedItemsFieldName: string
  rendererTemplateId?: TemplateId
  sourceFile?: string
  officialTemplate?: OfficialTemplateSummary
  designOverrides?: TemplateDesignOverrides
  mainFields: TemplateFieldMapping[]
  itemFields: TemplateFieldMapping[]
  printSettings: TemplatePrintSettings
  createdAt: string
  updatedAt: string
}

export type PiMainFieldKey =
  | 'customerInvoiceTitle'
  | 'invoiceNo'
  | 'invoiceDate'
  | 'totalWithCurrency'
  | 'sayAmount'
  | 'paymentTerms'
  | 'priceTerms'
  | 'productionTime'
  | 'portOfDeparture'
  | 'portOfDestination'
  | 'bankInformation'

export type PiItemFieldKey =
  | 'sortNo'
  | 'itemName'
  | 'specification'
  | 'quantity'
  | 'unit'
  | 'unitPrice'
  | 'subtotal'

export type PiPrintFields = Record<PiMainFieldKey, string>

export type PiPrintItem = Record<PiItemFieldKey, string> & {
  recordId: string
}

export type OfficialPrintValue = {
  text: string
  imageUrls?: string[]
}

export type OfficialPrintDocumentData = {
  fields: Record<string, OfficialPrintValue>
  itemGroups: Record<string, Record<string, OfficialPrintValue>[]>
}

export type PiPrintDocument = {
  recordId: string
  title: string
  fields: PiPrintFields
  items: PiPrintItem[]
  official?: OfficialPrintDocumentData
}

export type PiPrintPayload = {
  templateId: TemplateId
  templateSettings?: TemplatePrintSettings
  officialTemplate?: OfficialTemplateSummary
  designOverrides?: TemplateDesignOverrides
  designMode?: boolean
  selectedDesignId?: string
  generatedAt: string
  source: {
    baseName: string
    tableName: string
    viewName: string
  }
  documents: PiPrintDocument[]
}

export type ValidationSeverity = 'blocker' | 'warning' | 'info'

export type ValidationIssue = {
  severity: ValidationSeverity
  message: string
  code: string
  recordId?: string
}

export type PiPrintContext = {
  source: 'feishu' | 'mock' | 'local'
  baseName: string
  mainTableId: string
  mainTableName: string
  itemTableId: string
  itemTableName: string
  viewId: string
  viewName: string
}

export type PiSnapshot = {
  context: PiPrintContext
  payload: PiPrintPayload
  issues: ValidationIssue[]
  selectedRecordIds: string[]
}

export type PdfServiceStatus = 'checking' | 'online' | 'offline'
