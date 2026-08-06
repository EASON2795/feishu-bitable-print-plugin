import type { DataSourceSchema, PiSnapshot } from './types'

export const FEISHU_BRIDGE_CHANNEL = 'feishu-bitable-print-plugin'
export const FEISHU_BRIDGE_VERSION = 1
export const FEISHU_SNAPSHOT_MESSAGE = 'FEISHU_SNAPSHOT_V1'
export const FEISHU_BRIDGE_ACK_MESSAGE = 'FEISHU_BRIDGE_ACK_V1'

export type FeishuSnapshotBridgeMessage = {
  channel: typeof FEISHU_BRIDGE_CHANNEL
  version: typeof FEISHU_BRIDGE_VERSION
  type: typeof FEISHU_SNAPSHOT_MESSAGE
  emittedAt: number
  payload: {
    snapshot: PiSnapshot
    schema: DataSourceSchema | null
    activeTemplateId: string
  }
}

type FeishuBridgeAckMessage = {
  channel: typeof FEISHU_BRIDGE_CHANNEL
  version: typeof FEISHU_BRIDGE_VERSION
  type: typeof FEISHU_BRIDGE_ACK_MESSAGE
  emittedAt: number
  receivedAt: number
}

export function publishFeishuSnapshot(
  snapshot: PiSnapshot,
  schema: DataSourceSchema | null,
  activeTemplateId: string,
): number {
  const emittedAt = Date.now()
  const message: FeishuSnapshotBridgeMessage = {
    channel: FEISHU_BRIDGE_CHANNEL,
    version: FEISHU_BRIDGE_VERSION,
    type: FEISHU_SNAPSHOT_MESSAGE,
    emittedAt,
    payload: {
      snapshot,
      schema,
      activeTemplateId,
    },
  }

  window.postMessage(message, window.location.origin)
  return emittedAt
}

export function isFeishuBridgeAckMessage(value: unknown): value is FeishuBridgeAckMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<FeishuBridgeAckMessage>
  return (
    candidate.channel === FEISHU_BRIDGE_CHANNEL &&
    candidate.version === FEISHU_BRIDGE_VERSION &&
    candidate.type === FEISHU_BRIDGE_ACK_MESSAGE &&
    typeof candidate.emittedAt === 'number' &&
    typeof candidate.receivedAt === 'number'
  )
}
