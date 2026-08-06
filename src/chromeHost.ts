import {
  ITEM_FIELD_LABELS,
  LINKED_ITEMS_FIELD_NAME,
  MAIN_FIELD_LABELS,
  PI_ITEM_TABLE_NAME,
  PI_MAIN_TABLE_NAME,
} from './piConfig'
import type { DataSourceSchema, PiSnapshot, PrintTemplate } from './types'

const GET_FEISHU_SNAPSHOT_MESSAGE = 'GET_FEISHU_SNAPSHOT_V1'
const FEISHU_SNAPSHOT_UPDATED_MESSAGE = 'FEISHU_SNAPSHOT_UPDATED_V1'

type ChromeBridgeResponse = {
  ok?: boolean
  error?: string
  data?: {
    snapshot?: PiSnapshot
    schema?: DataSourceSchema | null
    activeTemplateId?: string
    emittedAt?: number
    receivedAt?: number
  }
}

type LatestBridgeData = NonNullable<ChromeBridgeResponse['data']> & {
  snapshot: PiSnapshot
}

type ChromeRuntimeApi = {
  sendMessage(message: unknown): Promise<ChromeBridgeResponse>
  onMessage: {
    addListener(listener: (message: unknown) => void): void
    removeListener(listener: (message: unknown) => void): void
  }
}

function getChromeRuntime(): ChromeRuntimeApi {
  const chromeApi = (globalThis as typeof globalThis & {
    chrome?: { runtime?: ChromeRuntimeApi }
  }).chrome

  if (!chromeApi?.runtime) {
    throw new Error('Chrome 扩展通信尚未就绪，请重新打开打印台。')
  }

  return chromeApi.runtime
}

async function getLatestBridgeData(): Promise<LatestBridgeData> {
  const response = await getChromeRuntime().sendMessage({ type: GET_FEISHU_SNAPSHOT_MESSAGE })
  if (!response?.ok || !response.data?.snapshot) {
    throw new Error(
      response?.error ||
        '尚未收到飞书勾选数据。请先在飞书多维表格中打开“单据排版打印台”插件并勾选记录。',
    )
  }

  return {
    ...response.data,
    snapshot: response.data.snapshot,
  }
}

export async function loadPiSnapshot(
  _template?: PrintTemplate,
  _recordIds?: string[],
): Promise<PiSnapshot> {
  void _template
  void _recordIds
  const data = await getLatestBridgeData()
  return data.snapshot
}

export async function pickPiRecordIds(snapshot: PiSnapshot): Promise<string[]> {
  return snapshot.selectedRecordIds
}

export async function notifyHost(_message: string): Promise<void> {
  void _message
  // Chrome 本地版没有飞书宿主通知栏。
}

export async function loadDataSourceSchema(): Promise<DataSourceSchema> {
  const data = await getLatestBridgeData()
  return data.schema ?? getMockDataSourceSchema()
}

export function getMockDataSourceSchema(): DataSourceSchema {
  return {
    source: 'mock',
    tables: [
      {
        id: 'tbl_mock_pi_export',
        name: PI_MAIN_TABLE_NAME,
        fields: [...Object.values(MAIN_FIELD_LABELS), LINKED_ITEMS_FIELD_NAME].map((name) => ({
          id: `mock-${name}`,
          name,
          type: 'mock',
        })),
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
  let runtime: ChromeRuntimeApi
  try {
    runtime = getChromeRuntime()
  } catch {
    return () => {}
  }

  const listener = (message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      (message as { type?: string }).type === FEISHU_SNAPSHOT_UPDATED_MESSAGE
    ) {
      onChange()
    }
  }

  runtime.onMessage.addListener(listener)
  return () => runtime.onMessage.removeListener(listener)
}
