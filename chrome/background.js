const STORAGE_KEY = 'feishuSnapshotBridgeV1'
const BRIDGE_CHANNEL = 'feishu-bitable-print-plugin'
const BRIDGE_VERSION = 1
const SNAPSHOT_MESSAGE = 'FEISHU_SNAPSHOT_V1'
const STORE_FEISHU_SNAPSHOT_MESSAGE = 'STORE_FEISHU_SNAPSHOT_V1'
const GET_FEISHU_SNAPSHOT_MESSAGE = 'GET_FEISHU_SNAPSHOT_V1'
const TRUSTED_PLUGIN_ORIGIN = 'https://eason2795.github.io'
const TRUSTED_PLUGIN_PATH = '/feishu-bitable-print-plugin/'
const MAX_BRIDGE_BYTES = 2 * 1024 * 1024
const MAX_DOCUMENTS = 20

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === STORE_FEISHU_SNAPSHOT_MESSAGE) {
    void storeBridgeSnapshot(message.data, sender).then(sendResponse)
    return true
  }

  if (message?.type === GET_FEISHU_SNAPSHOT_MESSAGE) {
    void getBridgeSnapshot().then(sendResponse)
    return true
  }

  return false
})

async function storeBridgeSnapshot(data, sender) {
  if (!isTrustedPluginSender(sender)) {
    return { ok: false, error: '同步来源未通过校验。' }
  }

  const validationError = validateBridgeData(data)
  if (validationError) {
    return { ok: false, error: validationError }
  }

  const storedData = {
    snapshot: data.payload.snapshot,
    schema: data.payload.schema ?? null,
    activeTemplateId: data.payload.activeTemplateId || '',
    emittedAt: data.emittedAt,
    receivedAt: Date.now(),
  }

  await chrome.storage.session.set({ [STORAGE_KEY]: storedData })
  return { ok: true, receivedAt: storedData.receivedAt }
}

async function getBridgeSnapshot() {
  const stored = await chrome.storage.session.get(STORAGE_KEY)
  const data = stored[STORAGE_KEY]
  if (!data?.snapshot) {
    return {
      ok: false,
      error:
        '尚未收到飞书勾选数据。请先在飞书多维表格中打开“单据排版打印台”插件并勾选记录。',
    }
  }

  return { ok: true, data }
}

function isTrustedPluginSender(sender) {
  if (!sender?.url) {
    return false
  }

  try {
    const url = new URL(sender.url)
    return url.origin === TRUSTED_PLUGIN_ORIGIN && url.pathname.startsWith(TRUSTED_PLUGIN_PATH)
  } catch {
    return false
  }
}

function validateBridgeData(data) {
  if (
    !data ||
    typeof data !== 'object' ||
    data.channel !== BRIDGE_CHANNEL ||
    data.version !== BRIDGE_VERSION ||
    data.type !== SNAPSHOT_MESSAGE ||
    !data.payload ||
    typeof data.emittedAt !== 'number'
  ) {
    return '同步消息格式不正确。'
  }

  const snapshot = data.payload.snapshot
  const documents = snapshot?.payload?.documents
  if (!snapshot || snapshot?.context?.source !== 'feishu' || !Array.isArray(documents)) {
    return '同步内容不是飞书单据快照。'
  }

  if (!documents.length) {
    return '飞书当前没有可同步的单据。'
  }

  if (documents.length > MAX_DOCUMENTS) {
    return `一次最多同步 ${MAX_DOCUMENTS} 条单据。`
  }

  try {
    if (new Blob([JSON.stringify(data)]).size > MAX_BRIDGE_BYTES) {
      return '同步数据超过 2 MB，请减少勾选记录后重试。'
    }
  } catch {
    return '同步数据无法序列化。'
  }

  return null
}
