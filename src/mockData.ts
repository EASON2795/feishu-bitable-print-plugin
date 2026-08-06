import {
  EXPECTED_BASE_NAME,
  PI_ITEM_TABLE_NAME,
  PI_MAIN_TABLE_NAME,
} from './piConfig'
import {
  PROFORMA_INVOICE_TEMPLATE_ID,
  type PiSnapshot,
  type ValidationIssue,
} from './types'

export function getMockPiSnapshot(errorMessage?: string): PiSnapshot {
  const issues: ValidationIssue[] = errorMessage
    ? [
        {
          severity: 'warning',
          code: 'mock-data',
          message: `当前不在飞书插件容器内，已使用本地 PI 样例数据。原始提示：${errorMessage}`,
        },
      ]
    : [
        {
          severity: 'info',
          code: 'mock-data',
          message: '本地 PI 样例数据可用于调试版式和浏览器打印。',
        },
      ]

  const documents = [
    {
      recordId: 'rec_mock_pi_001',
      title: 'PI-DEMO-001',
      fields: {
        customerInvoiceTitle: 'DEMO CUSTOMER LTD.\n100 EXAMPLE ROAD\nSAMPLE CITY',
        invoiceNo: 'PI-DEMO-001',
        invoiceDate: '2026/08/01',
        totalWithCurrency: '$1,250.00',
        sayAmount: 'ONE THOUSAND TWO HUNDRED AND FIFTY US DOLLARS ONLY',
        paymentTerms: '30% T/T deposit, 70% balance payment before shipment.',
        priceTerms: 'FOB (Free on Board)',
        productionTime: '7-10 days after receive the deposit',
        portOfDeparture: 'SHANGHAI',
        portOfDestination: 'SAMPLE PORT',
        bankInformation: 'Replace this sample with your own bank information before use.',
      },
      items: [
        {
          recordId: 'rec_mock_item_001',
          sortNo: '1',
          itemName: 'SAMPLE PRODUCT A',
          specification:
            'Name Parameters\nPower Voltage (V/Hz): AC 220/50\nPower (W): 200\nMaximum Carton Sealing Dimensions (L x W x H): infinity x 500 x 600\nCarton Sealing Speed: 25-45 cartons/min',
          quantity: '1',
          unit: 'PCS',
          unitPrice: '$750.00',
          subtotal: '$750.00',
        },
        {
          recordId: 'rec_mock_item_002',
          sortNo: '2',
          itemName: 'SAMPLE PRODUCT B',
          specification:
            'ARCH DIMENSIONS (W*H): 1650MM*800MM\nTABLE HEIGHT: 725MM +100MM\nSTRAPPING SPEED: <=2.1 SECONDS/PASS\nAPPLICABLE BAND WIDTH: 15.5MM\nCONTROL METHOD: PLC',
          quantity: '1',
          unit: 'PCS',
          unitPrice: '$500.00',
          subtotal: '$500.00',
        },
      ],
    },
  ]

  return {
    context: {
      source: 'mock',
      baseName: EXPECTED_BASE_NAME,
      mainTableId: 'tbl_mock_pi_export',
      mainTableName: PI_MAIN_TABLE_NAME,
      itemTableId: 'tbl_mock_pi_items',
      itemTableName: PI_ITEM_TABLE_NAME,
      viewId: 'viw_mock_pi',
      viewName: 'PI 打印视图',
    },
    payload: {
      templateId: PROFORMA_INVOICE_TEMPLATE_ID,
      generatedAt: new Date().toISOString(),
      source: {
        baseName: EXPECTED_BASE_NAME,
        tableName: PI_MAIN_TABLE_NAME,
        viewName: 'PI 打印视图',
      },
      documents,
    },
    issues,
    selectedRecordIds: documents.map((document) => document.recordId),
  }
}
