const BRIDGE_CHANNEL = 'feishu-bitable-print-plugin'
const BRIDGE_VERSION = 1
const SNAPSHOT_MESSAGE = 'FEISHU_SNAPSHOT_V1'
const ACK_MESSAGE = 'FEISHU_BRIDGE_ACK_V1'
const STORE_MESSAGE = 'STORE_FEISHU_SNAPSHOT_V1'
const UPDATED_MESSAGE = 'FEISHU_SNAPSHOT_UPDATED_V1'

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) {
    return
  }

  const data = event.data
  if (
    !data ||
    data.channel !== BRIDGE_CHANNEL ||
    data.version !== BRIDGE_VERSION ||
    data.type !== SNAPSHOT_MESSAGE
  ) {
    return
  }

  void chrome.runtime
    .sendMessage({ type: STORE_MESSAGE, data })
    .then((response) => {
      if (!response?.ok) {
        return
      }

      window.postMessage(
        {
          channel: BRIDGE_CHANNEL,
          version: BRIDGE_VERSION,
          type: ACK_MESSAGE,
          emittedAt: data.emittedAt,
          receivedAt: response.receivedAt,
        },
        window.location.origin,
      )

      void chrome.runtime.sendMessage({ type: UPDATED_MESSAGE }).catch(() => {})
    })
    .catch(() => {
      // The bridge is best-effort; the Feishu app remains usable without Chrome.
    })
})
