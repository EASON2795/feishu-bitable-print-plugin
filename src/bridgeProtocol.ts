import type { DataSourceSchema, PiSnapshot, PrintTemplate } from './types'

export const FEISHU_BRIDGE_CHANNEL = 'feishu-bitable-print-plugin'
export const FEISHU_BRIDGE_VERSION = 1
export const FEISHU_SNAPSHOT_MESSAGE = 'FEISHU_SNAPSHOT_V1'
export const FEISHU_BRIDGE_ACK_MESSAGE = 'FEISHU_BRIDGE_ACK_V1'
export const FEISHU_SNAPSHOT_REQUEST_MESSAGE = 'FEISHU_SNAPSHOT_REQUEST_V1'

export type FeishuSnapshotBridgeMessage = {
  channel: typeof FEISHU_BRIDGE_CHANNEL
  version: typeof FEISHU_BRIDGE_VERSION
  type: typeof FEISHU_SNAPSHOT_MESSAGE
  emittedAt: number
  payload: {
    snapshot: PiSnapshot
    schema: DataSourceSchema | null
    activeTemplateId: string
    activeTemplate: PrintTemplate
  }
}

type FeishuBridgeAckMessage = {
  channel: typeof FEISHU_BRIDGE_CHANNEL
  version: typeof FEISHU_BRIDGE_VERSION
  type: typeof FEISHU_BRIDGE_ACK_MESSAGE
  emittedAt: number
  receivedAt: number
}

type FeishuSnapshotRequestMessage = {
  channel: typeof FEISHU_BRIDGE_CHANNEL
  version: typeof FEISHU_BRIDGE_VERSION
  type: typeof FEISHU_SNAPSHOT_REQUEST_MESSAGE
  requestId: string
  requestedAt: number
}

export function publishFeishuSnapshot(
  snapshot: PiSnapshot,
  schema: DataSourceSchema | null,
  activeTemplate: PrintTemplate,
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
      activeTemplateId: activeTemplate.id,
      activeTemplate,
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

export function isFeishuSnapshotRequestMessage(
  value: unknown,
): value is FeishuSnapshotRequestMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<FeishuSnapshotRequestMessage>
  return (
    candidate.channel === FEISHU_BRIDGE_CHANNEL &&
    candidate.version === FEISHU_BRIDGE_VERSION &&
    candidate.type === FEISHU_SNAPSHOT_REQUEST_MESSAGE &&
    typeof candidate.requestId === 'string' &&
    typeof candidate.requestedAt === 'number'
  )
}
