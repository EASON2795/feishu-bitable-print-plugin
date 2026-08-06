import type {
  TemplateLayoutSettings,
  TemplatePrintSettings,
  TemplateTextSettings,
} from './types'

type PrintSettingsPatch = {
  text?: Partial<TemplateTextSettings> & {
    itemHeaders?: Partial<TemplateTextSettings['itemHeaders']>
  }
  layout?: Partial<TemplateLayoutSettings> & {
    columnWidths?: Partial<TemplateLayoutSettings['columnWidths']>
  }
}

export const DEFAULT_PRINT_SETTINGS: TemplatePrintSettings = {
  text: {
    companyName: 'YOUR COMPANY NAME',
    companyAddress: 'Your company address',
    companyContact: 'Tel: +00 000 0000 0000  Email: sales@example.com',
    documentTitle: 'PROFORMA INVOICE',
    invoiceNoLabel: 'INVOICE NO',
    dateLabel: 'DATE',
    totalLabel: 'TOTAL',
    sayLabel: 'SAY',
    paymentTermsLabel: 'Payment Term',
    priceTermsLabel: 'Price Term',
    productionTimeLabel: 'Production Time',
    portOfDepartureLabel: 'Port of Departure',
    portOfDestinationLabel: 'Port of Destination',
    bankInformationLabel: 'Bank information',
    itemHeaders: {
      itemName: 'ITEM  NAME',
      specification: 'SPECIFICATION',
      quantity: 'QUANTITY',
      unit: 'UNIT',
      unitPrice: 'UNIT PRICE',
      subtotal: 'SUB TOTAL',
    },
  },
  layout: {
    pageMode: 'a4-auto',
    fontSizePt: 9,
    headerFontSizePt: 16,
    titleFontSizePt: 16,
    pagePaddingTopMm: 17.3,
    pagePaddingBottomMm: 17.3,
    pagePaddingXMm: 10,
    titleGapMm: 6,
    itemTableGapMm: 5,
    summaryGapMm: 8,
    bankHeightMm: 31,
    stampTopMm: 150,
    stampRightMm: 21,
    stampWidthMm: 38,
    columnWidths: {
      itemName: 25.997267905505645,
      specification: 35.90595226485051,
      quantity: 12.567083292697678,
      unit: 5.072708243805661,
      unitPrice: 10.258639197767733,
      subtotal: 10.198349095372773,
    },
  },
}

export function clonePrintSettings(settings?: PrintSettingsPatch): TemplatePrintSettings {
  return {
    text: {
      ...DEFAULT_PRINT_SETTINGS.text,
      ...settings?.text,
      itemHeaders: {
        ...DEFAULT_PRINT_SETTINGS.text.itemHeaders,
        ...settings?.text?.itemHeaders,
      },
    },
    layout: {
      ...DEFAULT_PRINT_SETTINGS.layout,
      ...settings?.layout,
      columnWidths: {
        ...DEFAULT_PRINT_SETTINGS.layout.columnWidths,
        ...settings?.layout?.columnWidths,
      },
    },
  }
}
