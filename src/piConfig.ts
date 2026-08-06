import {
  COMMERCIAL_INVOICE_TEMPLATE_ID,
  PACKING_LIST_TEMPLATE_ID,
  PROFORMA_INVOICE_TEMPLATE_ID,
  PURCHASE_ORDER_TEMPLATE_ID,
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
const COMMERCIAL_INVOICE_MAIN_FIELD_MAPPINGS = createMainFieldMappings(
  COMMERCIAL_INVOICE_MAIN_FIELD_LABELS,
)
const COMMERCIAL_INVOICE_ITEM_FIELD_MAPPINGS = createItemFieldMappings(
  COMMERCIAL_INVOICE_ITEM_FIELD_LABELS,
)
const PACKING_LIST_MAIN_FIELD_MAPPINGS = createMainFieldMappings(PACKING_LIST_MAIN_FIELD_LABELS)
const PACKING_LIST_ITEM_FIELD_MAPPINGS = createItemFieldMappings(PACKING_LIST_ITEM_FIELD_LABELS)

export const TEMPLATE_REGISTRY: PrintTemplate[] = [
  {
    id: PROFORMA_INVOICE_TEMPLATE_ID,
    name: '无照片形式发票',
    documentKind: 'proforma-invoice',
    description: '读取多维表格主记录和关联明细，生成 A4 形式发票。',
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
  },
  {
    id: COMMERCIAL_INVOICE_TEMPLATE_ID,
    name: '无照片商业发票',
    documentKind: 'commercial-invoice',
    description: '读取发票装箱单和利润核算表，生成无照片商业发票 PDF。',
    status: 'ready',
    isBuiltIn: true,
    mainTableName: COMMERCIAL_INVOICE_MAIN_TABLE_NAME,
    itemTableName: COMMERCIAL_INVOICE_ITEM_TABLE_NAME,
    linkedItemsFieldName: LINKED_ITEMS_FIELD_NAME,
    rendererTemplateId: COMMERCIAL_INVOICE_TEMPLATE_ID,
    mainFields: COMMERCIAL_INVOICE_MAIN_FIELD_MAPPINGS,
    itemFields: COMMERCIAL_INVOICE_ITEM_FIELD_MAPPINGS,
    printSettings: clonePrintSettings({
      text: {
        documentTitle: 'COMMERCIAL INVOICE',
        itemHeaders: {
          itemName: 'ITEM  NAME',
          specification: 'SPECIFICATION',
          quantity: 'QUANTITY',
          unit: 'UNIT',
          unitPrice: 'UNIT PRICE',
          subtotal: 'SUB TOTAL',
        },
      },
    }),
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: PACKING_LIST_TEMPLATE_ID,
    name: '装箱单',
    documentKind: 'packing-list',
    description: '读取发票装箱单和利润核算表，生成装箱单 PDF。',
    status: 'ready',
    isBuiltIn: true,
    mainTableName: PACKING_LIST_MAIN_TABLE_NAME,
    itemTableName: PACKING_LIST_ITEM_TABLE_NAME,
    linkedItemsFieldName: LINKED_ITEMS_FIELD_NAME,
    rendererTemplateId: PACKING_LIST_TEMPLATE_ID,
    mainFields: PACKING_LIST_MAIN_FIELD_MAPPINGS,
    itemFields: PACKING_LIST_ITEM_FIELD_MAPPINGS,
    printSettings: clonePrintSettings({
      text: {
        documentTitle: 'PACKING LIST',
        totalLabel: 'TOTAL PACKAGES',
        sayLabel: 'TOTAL N.W.',
        paymentTermsLabel: 'TOTAL G.W.',
        priceTermsLabel: 'MEAS.',
        productionTimeLabel: 'CARTONS',
        itemHeaders: {
          itemName: 'ITEM  NAME',
          specification: 'PACKING DESCRIPTION',
          quantity: 'QUANTITY',
          unit: 'CARTONS',
          unitPrice: 'N.W.',
          subtotal: 'G.W.',
        },
      },
    }),
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: PURCHASE_ORDER_TEMPLATE_ID,
    name: '采购单',
    documentKind: 'purchase-order',
    description: '预留采购单模板，待接入供应商、采购明细和签章版式。',
    status: 'draft',
    isBuiltIn: true,
    mainTableName: '采购单打印导出',
    itemTableName: '采购单明细表',
    linkedItemsFieldName: LINKED_ITEMS_FIELD_NAME,
    mainFields: [],
    itemFields: [],
    printSettings: clonePrintSettings({
      text: {
        documentTitle: 'PURCHASE ORDER',
        itemHeaders: {
          itemName: 'ITEM  NAME',
          specification: 'SPECIFICATION',
          quantity: 'QUANTITY',
          unit: 'UNIT',
          unitPrice: 'UNIT PRICE',
          subtotal: 'AMOUNT',
        },
      },
    }),
    createdAt: NOW,
    updatedAt: NOW,
  },
]
