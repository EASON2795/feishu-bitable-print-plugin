import {
  PROFORMA_INVOICE_TEMPLATE_ID,
  type DocumentKind,
  type PiItemFieldKey,
  type PiMainFieldKey,
  type PrintTemplate,
} from './types'
import { clonePrintSettings } from './templateDefaults'

export const EXPECTED_BASE_NAME = '单据打印示例库'
export const PI_MAIN_TABLE_NAME = '单据打印主表'
export const PI_ITEM_TABLE_NAME = '单据明细表'
export const COMMERCIAL_INVOICE_MAIN_TABLE_NAME = PI_MAIN_TABLE_NAME
export const COMMERCIAL_INVOICE_ITEM_TABLE_NAME = PI_ITEM_TABLE_NAME
export const PACKING_LIST_MAIN_TABLE_NAME = COMMERCIAL_INVOICE_MAIN_TABLE_NAME
export const PACKING_LIST_ITEM_TABLE_NAME = COMMERCIAL_INVOICE_ITEM_TABLE_NAME
export const MAX_PI_DOCUMENTS_PER_BATCH = 20

export const MAIN_FIELD_LABELS: Record<PiMainFieldKey, string> = {
  customerInvoiceTitle: '客户发票抬头',
  invoiceNo: '订单号',
  invoiceDate: '文本 4',
  totalWithCurrency: '总计代币种',
  sayAmount: 'SAY',
  paymentTerms: 'Payment Terms',
  priceTerms: 'Price Terms',
  productionTime: 'Production Time',
  portOfDeparture: 'Port of departure',
  portOfDestination: 'Port of destination',
  bankInformation: '银行信息',
}

export const ITEM_FIELD_LABELS: Record<PiItemFieldKey, string> = {
  sortNo: '序号',
  itemName: 'ITEM NAME',
  specification: 'SPECIFICATION',
  quantity: 'QUANTITY',
  unit: 'UNIT',
  unitPrice: 'UNIT PRICE',
  subtotal: 'SUBTOTAL形式发票',
}

export const COMMERCIAL_INVOICE_MAIN_FIELD_LABELS: Record<PiMainFieldKey, string> = {
  customerInvoiceTitle: '客户发票抬头',
  invoiceNo: '订单号',
  invoiceDate: '发票箱单日期',
  totalWithCurrency: '发票金额带币种',
  sayAmount: '发票金额大写',
  paymentTerms: 'Payment Terms',
  priceTerms: 'Price Terms',
  productionTime: 'Production Time',
  portOfDeparture: 'Port of departure',
  portOfDestination: 'Port of destination',
  bankInformation: '银行信息',
}

export const COMMERCIAL_INVOICE_ITEM_FIELD_LABELS: Record<PiItemFieldKey, string> = {
  sortNo: '序号',
  itemName: 'ITEM NAME',
  specification: 'SPECIFICATION',
  quantity: '实际生产数量',
  unit: 'UNIT',
  unitPrice: 'UNIT PRICE',
  subtotal: '实际发票',
}

export const PACKING_LIST_MAIN_FIELD_LABELS: Record<PiMainFieldKey, string> = {
  customerInvoiceTitle: '客户发票抬头',
  invoiceNo: '订单号',
  invoiceDate: '发票箱单日期',
  totalWithCurrency: '件数英文',
  sayAmount: '净重计算',
  paymentTerms: '毛重计算',
  priceTerms: '体积计算',
  productionTime: '件数计算',
  portOfDeparture: 'Port of departure',
  portOfDestination: 'Port of destination',
  bankInformation: '客户发票抬头',
}

export const PACKING_LIST_ITEM_FIELD_LABELS: Record<PiItemFieldKey, string> = {
  sortNo: '序号',
  itemName: 'ITEM NAME',
  specification: 'SPECIFICATION',
  quantity: '实际生产数量',
  unit: '件数',
  unitPrice: '净重',
  subtotal: '毛重',
}

export const LINKED_ITEMS_FIELD_NAME = '订单选择'

const NOW = '2026-06-29T00:00:00.000Z'

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  'proforma-invoice': '形式发票',
  'commercial-invoice': '商业发票',
  'packing-list': '装箱单',
  'purchase-order': '采购单',
}

const REQUIRED_MAIN_FIELD_KEYS: PiMainFieldKey[] = ['invoiceNo', 'invoiceDate', 'totalWithCurrency']
const REQUIRED_ITEM_FIELD_KEYS: PiItemFieldKey[] = ['itemName', 'quantity', 'unitPrice', 'subtotal']

function createMainFieldMappings(labels: Record<PiMainFieldKey, string>) {
  return (Object.entries(labels) as [PiMainFieldKey, string][]).map(([key, label]) => ({
    key,
    label,
    required: REQUIRED_MAIN_FIELD_KEYS.includes(key),
  }))
}

function createItemFieldMappings(labels: Record<PiItemFieldKey, string>) {
  return (Object.entries(labels) as [PiItemFieldKey, string][]).map(([key, label]) => ({
    key,
    label,
    required: REQUIRED_ITEM_FIELD_KEYS.includes(key),
  }))
}

const MAIN_FIELD_MAPPINGS = createMainFieldMappings(MAIN_FIELD_LABELS)
const ITEM_FIELD_MAPPINGS = createItemFieldMappings(ITEM_FIELD_LABELS)

export const DEFAULT_TEST_TEMPLATE: PrintTemplate = {
  id: PROFORMA_INVOICE_TEMPLATE_ID,
  name: '测试模板（形式发票）',
  documentKind: 'proforma-invoice',
  description: '用于测试主表、关联明细和打印窗口。正式使用请导入模板文件，或复制后绑定自己的字段。',
  status: 'ready',
  isBuiltIn: true,
  mainTableName: PI_MAIN_TABLE_NAME,
  itemTableName: PI_ITEM_TABLE_NAME,
  linkedItemsFieldName: LINKED_ITEMS_FIELD_NAME,
  rendererTemplateId: PROFORMA_INVOICE_TEMPLATE_ID,
  mainFields: MAIN_FIELD_MAPPINGS,
  itemFields: ITEM_FIELD_MAPPINGS,
  printSettings: clonePrintSettings(),
  createdAt: NOW,
  updatedAt: NOW,
}

export const TEMPLATE_REGISTRY: PrintTemplate[] = [DEFAULT_TEST_TEMPLATE]
