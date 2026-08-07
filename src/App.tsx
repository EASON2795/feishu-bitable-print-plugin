import { Component, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import './App.css'
import {
  getMockDataSourceSchema,
  loadDataSourceSchema,
  loadPiSnapshot,
  loadSyncedTemplate,
  notifyHost,
  pickPiRecordIds,
  subscribeSelectionChange,
} from '@runtime-host'
import { getMockPiSnapshot } from './mockData'
import { importDataFile } from './dataImport'
import { DOCUMENT_KIND_LABELS } from './piConfig'
import {
  checkLocalPrint,
  getPrintRuntimeLabel,
  openPrintWorkspace,
} from './localPrint'
import { buildPrintDocument } from './printDocument'
import {
  bindFieldToDesignTarget,
  getDesignTargetText,
  makeDesignerReadyTemplate,
  updateDesignTargetText,
  type DesignerFieldSource,
} from './designerTemplate'
import {
  copyTemplate,
  createBlankTemplate,
  loadTemplateWorkspace,
  mergeTemplates,
  normalizeTemplateForSave,
  removeCustomTemplate,
  saveTemplateWorkspace,
  type TemplateWorkspace,
} from './templateStore'
import { importTemplateFromText } from './templateImport'
import {
  COMMERCIAL_INVOICE_TEMPLATE_ID,
  OFFICIAL_LAYOUT_TEMPLATE_ID,
  PACKING_LIST_TEMPLATE_ID,
  PROFORMA_INVOICE_TEMPLATE_ID,
  type DataSourceSchema,
  type DocumentKind,
  type ItemColumnKey,
  type OfficialPrintValue,
  type PageMode,
  type PdfServiceStatus,
  type PiPrintPayload,
  type PiSnapshot,
  type TemplateDesignOverrides,
  type PrintTemplate,
  type TemplateLayoutSettings,
  type TemplateNodeStyleOverride,
  type TemplateTextSettings,
  type TextAlign,
  type ValidationIssue,
} from './types'

type ActivePanel = 'print' | 'templates'

type DiagnosticEvent = {
  id: string
  level: 'info' | 'warning' | 'error'
  message: string
  detail?: string
  createdAt: string
}

type RuntimeInfo = {
  href: string
  protocol: string
  userAgent: string
  language: string
  viewport: string
  secureContext: boolean
  inIframe: boolean
}

type DesignerSelection = {
  designId: string
  kind: string
  tableId: string
}

type DesignerMessage = Partial<DesignerSelection> & {
  type?: string
  field?: DesignerFieldSource
  widths?: number[]
  xMm?: number
  yMm?: number
}

type DesignerTableInfo = {
  id: string
  label: string
  columnWidths: number[]
}

type DesignerImageInfo = {
  id: string
  label: string
  offsetXMm: number
  offsetYMm: number
  widthMm: number
}

const PAGE_MODE_LABELS: Record<PageMode, string> = {
  'a4-auto': 'A4 自动分页',
  continuous: '连续长页面',
  'fit-one-page': '缩放到一页 A4',
}

const ITEM_COLUMN_LABELS: Record<ItemColumnKey, string> = {
  itemName: '品名列',
  specification: '规格列',
  quantity: '数量列',
  unit: '单位列',
  unitPrice: '单价列',
  subtotal: '金额列',
}

const MAX_DIAGNOSTIC_EVENTS = 8
const CHROME_SCHEMA_TIMEOUT_MS = 3000
const FEISHU_SCHEMA_TIMEOUT_MS = 12_000
const FONT_OPTIONS = [
  { label: '默认字体', value: '' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: '微软雅黑', value: '"Microsoft YaHei", sans-serif' },
  { label: '苹方', value: '"PingFang SC", sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
]

function App() {
  const isChromeExtension = isChromeExtensionRuntime()
  const chromeBridgeLoadedRef = useRef(false)
  const selectionReadSequenceRef = useRef(0)
  const selectionLoadCountRef = useRef(0)
  const selectionReloadTokenRef = useRef(0)
  const selectionReloadPendingRef = useRef(false)
  const activeTemplateRef = useRef<PrintTemplate | null>(null)
  const deleteTemplateTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [snapshot, setSnapshot] = useState<PiSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSelectionReloadPending, setIsSelectionReloadPending] = useState(false)
  const [busyAction, setBusyAction] = useState<'workspace' | null>(null)
  const [pdfStatus, setPdfStatus] = useState<PdfServiceStatus>('checking')
  const [message, setMessage] = useState<string | null>(null)
  const [dataSourceSchema, setDataSourceSchema] = useState<DataSourceSchema | null>(null)
  const [activePanel, setActivePanel] = useState<ActivePanel>('print')
  const [isControlPanelCollapsed, setIsControlPanelCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 860,
  )
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [diagnosticEvents, setDiagnosticEvents] = useState<DiagnosticEvent[]>(() => [
    createDiagnosticEvent(
      'info',
      isChromeExtension ? 'Chrome 打印台正在查找飞书同步数据。' : '插件页面已开始加载。',
    ),
  ])
  const [templateWorkspace, setTemplateWorkspace] = useState<TemplateWorkspace>(() =>
    loadTemplateWorkspace(),
  )
  const [bridgedTemplate, setBridgedTemplate] = useState<PrintTemplate | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<PrintTemplate | null>(null)
  const [pendingDeleteTemplate, setPendingDeleteTemplate] = useState<PrintTemplate | null>(null)
  const [templateNotice, setTemplateNotice] = useState<string | null>(null)

  const cancelTemplateDelete = useCallback(() => {
    setPendingDeleteTemplate(null)
    window.setTimeout(() => {
      if (deleteTemplateTriggerRef.current?.isConnected) {
        deleteTemplateTriggerRef.current.focus()
      }
    }, 0)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const narrowPanel = window.matchMedia('(max-width: 859px)')
    const syncPanelLayout = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsControlPanelCollapsed(event.matches)
    }

    syncPanelLayout(narrowPanel)
    narrowPanel.addEventListener('change', syncPanelLayout)
    return () => narrowPanel.removeEventListener('change', syncPanelLayout)
  }, [])

  useEffect(() => {
    if (!templateNotice) {
      return undefined
    }

    const timeout = window.setTimeout(() => setTemplateNotice(null), 4500)
    return () => window.clearTimeout(timeout)
  }, [templateNotice])

  const templates = useMemo(
    () => mergeTemplates(templateWorkspace.customTemplates),
    [templateWorkspace.customTemplates],
  )
  const localActiveTemplate = useMemo(
    () =>
      templates.find((template) => template.id === templateWorkspace.activeTemplateId) ??
      templates[0],
    [templates, templateWorkspace.activeTemplateId],
  )
  const activeTemplate = bridgedTemplate ?? localActiveTemplate
  activeTemplateRef.current = activeTemplate
  const previewTemplate =
    activePanel === 'templates' && editingTemplate ? editingTemplate : activeTemplate
  const runtimeInfo = useMemo(() => collectRuntimeInfo(), [])
  const currentInvoiceNo =
    snapshot?.payload.documents[0]?.fields.invoiceNo ||
    snapshot?.payload.documents[0]?.recordId ||
    '等待当前单据数据'
  const currentItemCount =
    snapshot?.payload.documents.reduce((total, document) => total + document.items.length, 0) ?? 0

  const addDiagnosticEvent = useCallback(
    (level: DiagnosticEvent['level'], message: string, detail?: string) => {
      setDiagnosticEvents((current) =>
        [createDiagnosticEvent(level, message, detail), ...current].slice(0, MAX_DIAGNOSTIC_EVENTS),
      )
    },
    [],
  )

  const loadCurrentSelection = useCallback(async () => {
    const selectionReadSequence = ++selectionReadSequenceRef.current
    const selectionReloadToken = selectionReloadTokenRef.current
    const templateAtStart = activeTemplate
    const isStaleSelectionLoad = () =>
      selectionReadSequence !== selectionReadSequenceRef.current ||
      activeTemplateRef.current !== templateAtStart
    selectionLoadCountRef.current += 1
    setIsLoading(true)
    setMessage(null)
    addDiagnosticEvent(
      'info',
      isChromeExtension ? '开始接收飞书插件同步数据。' : '开始读取飞书当前记录。',
    )

    try {
      const nextSnapshot = await withTimeout(loadPiSnapshot(activeTemplate), 6000)
      if (isStaleSelectionLoad()) {
        return
      }
      setSnapshot(nextSnapshot)
      if (isChromeExtension) {
        const [nextSchema, nextTemplate] = await Promise.all([
          withTimeout(loadDataSourceSchema(), CHROME_SCHEMA_TIMEOUT_MS),
          withTimeout(loadSyncedTemplate(), CHROME_SCHEMA_TIMEOUT_MS),
        ])
        if (isStaleSelectionLoad()) {
          return
        }
        setDataSourceSchema(nextSchema)
        setBridgedTemplate(nextTemplate)
      }
      if (selectionReloadToken === selectionReloadTokenRef.current) {
        selectionReloadPendingRef.current = false
        setIsSelectionReloadPending(false)
      }
      addDiagnosticEvent(
        'info',
        isChromeExtension
          ? `已接收飞书勾选数据：${nextSnapshot.payload.documents.length} 条单据。`
          : `飞书数据读取完成：${nextSnapshot.payload.documents.length} 条单据。`,
        `来源：${nextSnapshot.context.source}；表：${nextSnapshot.context.mainTableName}；视图：${nextSnapshot.context.viewName}`,
      )
    } catch (hostError) {
      if (isStaleSelectionLoad()) {
        return
      }
      const fallbackMessage =
        hostError instanceof Error ? hostError.message : '无法连接飞书插件容器。'
      setMessage(fallbackMessage)
      if (shouldUseDemoData()) {
        setSnapshot(getMockPiSnapshot(fallbackMessage))
        addDiagnosticEvent('warning', '未连接飞书，已进入明确启用的演示模式。', formatUnknownError(hostError))
      } else {
        setSnapshot(null)
        addDiagnosticEvent('error', '读取飞书数据失败，已停止打印。', formatUnknownError(hostError))
      }
    } finally {
      selectionLoadCountRef.current = Math.max(0, selectionLoadCountRef.current - 1)
      if (selectionLoadCountRef.current === 0) {
        setIsLoading(false)
      }
    }
  }, [activeTemplate, addDiagnosticEvent, isChromeExtension])

  useEffect(() => {
    if (!isChromeExtension) {
      void loadCurrentSelection()
    }
  }, [isChromeExtension, loadCurrentSelection])

  useEffect(() => {
    if (!isChromeExtension || chromeBridgeLoadedRef.current) {
      return
    }

    chromeBridgeLoadedRef.current = true
    void loadCurrentSelection()
  }, [isChromeExtension, loadCurrentSelection])

  useEffect(() => {
    if (isChromeExtension) {
      return
    }

    let isMounted = true

    async function loadSchema() {
      try {
        const schema = await withTimeout(loadDataSourceSchema(), FEISHU_SCHEMA_TIMEOUT_MS)
        if (isMounted) {
          setDataSourceSchema(schema)
          addDiagnosticEvent(
            schema.source === 'feishu' ? 'info' : 'warning',
            schema.source === 'feishu' ? '飞书字段结构读取完成。' : '飞书字段结构读取失败，已使用样例结构。',
            `表数量：${schema.tables.length}`,
          )
        }
      } catch (error) {
        if (isMounted) {
          if (shouldUseDemoData()) {
            const fallbackSchema = getMockDataSourceSchema()
            setDataSourceSchema(fallbackSchema)
            addDiagnosticEvent('warning', '演示模式已使用样例字段结构。', formatUnknownError(error))
          } else {
            setDataSourceSchema(null)
            addDiagnosticEvent('error', '字段结构读取失败。', formatUnknownError(error))
          }
        }
      }
    }

    void loadSchema()

    return () => {
      isMounted = false
    }
  }, [addDiagnosticEvent, isChromeExtension])

  useEffect(() => {
    let reloadTimer: number | undefined
    const unsubscribe = subscribeSelectionChange(() => {
      selectionReloadTokenRef.current += 1
      selectionReloadPendingRef.current = true
      setIsSelectionReloadPending(true)
      selectionReadSequenceRef.current += 1
      window.clearTimeout(reloadTimer)
      reloadTimer = window.setTimeout(() => {
        void loadCurrentSelection()
      }, 300)
    })

    return () => {
      window.clearTimeout(reloadTimer)
      unsubscribe()
    }
  }, [isChromeExtension, loadCurrentSelection])

  useEffect(() => {
    let isMounted = true

    async function probe() {
      setPdfStatus('checking')
      const online = await checkLocalPrint()
      if (isMounted) {
        setPdfStatus(online ? 'online' : 'offline')
        addDiagnosticEvent(
          online ? 'info' : 'warning',
          online ? '本地打印功能可用。' : '本地打印功能不可用。',
          `处理方式：${getPrintRuntimeLabel()}`,
        )
      }
    }

    void probe()

    return () => {
      isMounted = false
    }
  }, [addDiagnosticEvent])

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      addDiagnosticEvent('error', '客户端脚本错误。', event.message)
    }
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      addDiagnosticEvent('error', '客户端异步错误。', formatUnknownError(event.reason))
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [addDiagnosticEvent])

  const printPayload = useMemo(
    () => buildPayloadForTemplate(snapshot?.payload ?? null, previewTemplate),
    [snapshot, previewTemplate],
  )
  const templateIssues = useMemo(() => getTemplateIssues(activeTemplate), [activeTemplate])
  const allIssues = useMemo(
    () => [...(snapshot?.issues ?? []), ...templateIssues],
    [snapshot, templateIssues],
  )
  const blockers = useMemo(
    () => allIssues.filter((issue) => issue.severity === 'blocker'),
    [allIssues],
  )
  const wrongTableIssue = useMemo(
    () => blockers.find((issue) => issue.code === 'wrong-table'),
    [blockers],
  )
  const warnings = useMemo(
    () => allIssues.filter((issue) => issue.severity !== 'blocker'),
    [allIssues],
  )
  const previewHtml = useMemo(
    () => (printPayload?.documents.length ? buildPrintDocument(printPayload) : ''),
    [printPayload],
  )
  const isDesignerMode = activePanel === 'templates' && Boolean(editingTemplate?.officialTemplate)
  const canRenderPdf =
    Boolean(printPayload?.documents.length) &&
    blockers.length === 0 &&
    pdfStatus === 'online' &&
    !isLoading &&
    !isSelectionReloadPending &&
    !busyAction
  const canPickRecords = !isChromeExtension && Boolean(snapshot) && !isLoading && !wrongTableIssue

  async function handleOpenPrintWorkspace() {
    if (!printPayload || !canRenderPdf) {
      return
    }

    await runPdfAction('workspace', async () => {
      await openPrintWorkspace(printPayload)
      await notifyHost('独立打印窗口已打开；可以调整窗口大小后再打印或另存 PDF。')
    })
  }

  async function runPdfAction(label: 'workspace', action: () => Promise<void>) {
    setBusyAction(label)
    setMessage(null)

    try {
      await action()
    } catch (actionError) {
      const nextMessage = actionError instanceof Error ? actionError.message : 'PDF 操作失败。'
      setMessage(nextMessage)
      addDiagnosticEvent('error', 'PDF 操作失败。', formatUnknownError(actionError))
      await notifyHost(nextMessage)
    } finally {
      setBusyAction(null)
    }
  }

  async function handlePickRecords() {
    if (!snapshot) {
      return
    }

    const selectionReadSequence = ++selectionReadSequenceRef.current
    const templateAtStart = activeTemplate
    const isStaleSelectionLoad = () =>
      selectionReadSequence !== selectionReadSequenceRef.current ||
      activeTemplateRef.current !== templateAtStart
    selectionLoadCountRef.current += 1
    setIsLoading(true)
    setMessage(null)

    try {
      const recordIds = await pickPiRecordIds(snapshot)
      if (isStaleSelectionLoad()) {
        return
      }
      const nextSnapshot = await withTimeout(loadPiSnapshot(activeTemplate, recordIds), 6000)
      if (isStaleSelectionLoad()) {
        return
      }
      setSnapshot(nextSnapshot)
      addDiagnosticEvent('info', `手动选择记录完成：${recordIds.length} 条。`)
    } catch (pickError) {
      if (isStaleSelectionLoad()) {
        return
      }
      const nextMessage = pickError instanceof Error ? pickError.message : '选择记录失败。'
      setMessage(nextMessage)
      addDiagnosticEvent('error', '选择记录失败。', formatUnknownError(pickError))
      await notifyHost(nextMessage)
    } finally {
      selectionLoadCountRef.current = Math.max(0, selectionLoadCountRef.current - 1)
      if (selectionLoadCountRef.current === 0) {
        setIsLoading(false)
      }
    }
  }

  function commitTemplateWorkspace(nextWorkspace: TemplateWorkspace) {
    try {
      saveTemplateWorkspace(nextWorkspace)
      setTemplateWorkspace(nextWorkspace)
      return true
    } catch (storageError) {
      setMessage('模板没有保存成功，请检查浏览器是否允许本地存储。')
      addDiagnosticEvent('error', '模板本地存储失败。', formatUnknownError(storageError))
      return false
    }
  }

  function handleUseTemplate(templateId: string) {
    setBridgedTemplate(null)
    const didSave = commitTemplateWorkspace({
      ...templateWorkspace,
      activeTemplateId: templateId,
    })
    if (!didSave) {
      return
    }
    setActivePanel('print')
    setIsMoreMenuOpen(false)
    setMessage(null)
  }

  function handleNewTemplate() {
    setEditingTemplate(makeDesignerReadyTemplate(createBlankTemplate()))
    setActivePanel('templates')
    setIsMoreMenuOpen(false)
  }

  function handleCopyTemplate(template: PrintTemplate) {
    setEditingTemplate(makeDesignerReadyTemplate(copyTemplate(template)))
    setActivePanel('templates')
    setIsMoreMenuOpen(false)
  }

  function handleEditTemplate(template: PrintTemplate) {
    setEditingTemplate(makeDesignerReadyTemplate(template.isBuiltIn ? copyTemplate(template) : template))
    setActivePanel('templates')
    setIsMoreMenuOpen(false)
  }

  async function handleSaveTemplate(template: PrintTemplate) {
    const savedTemplate = normalizeTemplateForSave(template)
    const customTemplates = templateWorkspace.customTemplates.some(
      (current) => current.id === savedTemplate.id,
    )
      ? templateWorkspace.customTemplates.map((current) =>
          current.id === savedTemplate.id ? savedTemplate : current,
        )
      : [...templateWorkspace.customTemplates, savedTemplate]

    const didSave = commitTemplateWorkspace({
      activeTemplateId: savedTemplate.id,
      customTemplates,
    })
    if (!didSave) {
      return
    }
    setEditingTemplate(null)
    setActivePanel('print')
    setMessage('模板已保存到当前浏览器。')
  }

  function handleDeleteTemplate(templateId: string) {
    const template = templateWorkspace.customTemplates.find((current) => current.id === templateId)
    if (!template || template.isBuiltIn) {
      setMessage('系统内置模板不能删除；可以复制后修改自定义副本。')
      return false
    }

    const deletingEffectiveTemplate = activeTemplate.id === templateId
    const nextWorkspace = removeCustomTemplate(templateWorkspace, templateId)
    if (nextWorkspace === templateWorkspace || !commitTemplateWorkspace(nextWorkspace)) {
      return false
    }

    if (editingTemplate?.id === templateId) {
      setEditingTemplate(null)
    }

    if (bridgedTemplate?.id === templateId) {
      setBridgedTemplate(null)
    }

    if (deletingEffectiveTemplate) {
      selectionReadSequenceRef.current += 1
      setSnapshot(null)
      setIsLoading(!isChromeExtension)
    }

    setTemplateNotice(`已删除自定义模板「${template.name}」。`)
    addDiagnosticEvent('info', `已删除自定义模板「${template.name}」。`)
    return true
  }

  function requestDeleteTemplate(template: PrintTemplate, trigger: HTMLButtonElement) {
    if (template.isBuiltIn) {
      setMessage('系统内置模板不能删除；可以复制后修改自定义副本。')
      return
    }

    deleteTemplateTriggerRef.current = trigger
    setPendingDeleteTemplate(template)
  }

  function confirmTemplateDelete() {
    if (!pendingDeleteTemplate || !handleDeleteTemplate(pendingDeleteTemplate.id)) {
      return
    }

    setPendingDeleteTemplate(null)
    window.setTimeout(() => {
      const nextFocusTarget =
        document.querySelector<HTMLButtonElement>('.template-nav-item-active') ??
        document.querySelector<HTMLButtonElement>(
          '.template-row-active .template-row-actions button:not(:disabled)',
        ) ??
        document.querySelector<HTMLButtonElement>('[data-template-delete-focus-fallback]') ??
        document.querySelector<HTMLButtonElement>('.sidebar-create-button')
      nextFocusTarget?.focus()
    }, 0)
  }

  async function handleImportTemplateFile(file: File) {
    try {
      const rawText = await file.text()
      const importedTemplate = importTemplateFromText(file.name, rawText)
      setEditingTemplate(makeDesignerReadyTemplate(importedTemplate))
      setActivePanel('templates')
      setMessage('模板已导入，请选择源数据后保存。')
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '模板文件解析失败。'
      setMessage(`模板文件解析失败：${nextMessage}`)
      addDiagnosticEvent('error', '模板文件解析失败。', formatUnknownError(error))
    }
  }

  async function handleImportDataFile(file: File) {
    setIsLoading(true)
    setMessage(null)

    try {
      const result = await importDataFile(file)
      setSnapshot(result.snapshot)
      setDataSourceSchema(result.schema)
      setActivePanel('print')
      const itemCount = result.snapshot.payload.documents.reduce(
        (total, document) => total + document.items.length,
        0,
      )
      const successMessage = `已导入 ${result.snapshot.payload.documents.length} 条单据、${itemCount} 行明细；数据只保留在当前页面。`
      setMessage(successMessage)
      addDiagnosticEvent('info', successMessage, `文件：${file.name}`)
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '单据数据解析失败。'
      setMessage(`导入失败：${nextMessage}`)
      addDiagnosticEvent('error', '单据数据导入失败。', formatUnknownError(error))
    } finally {
      setIsLoading(false)
    }
  }

  function handleLoadDemoData() {
    const demoSnapshot = getMockPiSnapshot()
    setSnapshot(demoSnapshot)
    setDataSourceSchema(getMockDataSourceSchema())
    setActivePanel('print')
    setMessage('已恢复虚构示例数据。')
    addDiagnosticEvent('info', '已恢复虚构示例数据。')
  }

  if (isDesignerMode && editingTemplate) {
    return (
      <TemplateDesigner
        dataSourceSchema={dataSourceSchema}
        isDataPrintAllowed={!isLoading && !isSelectionReloadPending}
        onCancel={() => setEditingTemplate(null)}
        onSave={(template) => void handleSaveTemplate(template)}
        pdfStatus={pdfStatus}
        snapshot={snapshot}
        template={editingTemplate}
      />
    )
  }

  const appShellClassName = [
    'app-shell',
    isChromeExtension ? 'app-shell-chrome' : '',
    isControlPanelCollapsed ? 'app-shell-panel-collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={appShellClassName}>
      {!isControlPanelCollapsed ? (
        <TemplateSidebar
          activePanel={activePanel}
          activeTemplateId={activeTemplate.id}
          onCollapse={() => setIsControlPanelCollapsed(true)}
          onDeleteTemplate={requestDeleteTemplate}
          onImportTemplateFile={(file) => void handleImportTemplateFile(file)}
          onNewTemplate={handleNewTemplate}
          onSearchChange={setTemplateSearch}
          onUseTemplate={handleUseTemplate}
          search={templateSearch}
          templates={templates}
        />
      ) : null}

      <main className="preview-shell">
        {isChromeExtension ? (
          <input
            accept=".csv,.tsv,.json,text/csv,application/json"
            className="visually-hidden"
            id="local-data-upload"
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void handleImportDataFile(file)
              }
              event.currentTarget.value = ''
            }}
          />
        ) : null}
        {isControlPanelCollapsed ? (
          <button
            className="preview-sidebar-reveal"
            onClick={() => setIsControlPanelCollapsed(false)}
            type="button"
          >
            显示模板
          </button>
        ) : null}
        <header className="app-tabs" aria-label="插件导航">
          <button
            className={activePanel === 'print' ? 'app-tab app-tab-active' : 'app-tab'}
            onClick={() => setActivePanel('print')}
            type="button"
          >
            排版打印
          </button>
          <button
            className={activePanel === 'templates' ? 'app-tab app-tab-active' : 'app-tab'}
            data-template-delete-focus-fallback
            onClick={() => setActivePanel('templates')}
            type="button"
          >
            模板管理
          </button>
        </header>

        <header className="preview-toolbar">
          <div className="preview-template-title">
            <div className="template-title-line">
              <StatusChip label="记录" />
              <h2>{previewTemplate.name}</h2>
              <span>A4 / 纵向</span>
              <button className="text-link-button" onClick={() => handleEditTemplate(activeTemplate)} type="button">
                修改
              </button>
            </div>
            {isChromeExtension ? (
              <div className="preview-data-links">
                <button
                  className="batch-link"
                  disabled={isLoading}
                  onClick={() => void loadCurrentSelection()}
                  type="button"
                >
                  读取飞书勾选数据
                </button>
                <label className="batch-link batch-link-label" htmlFor="local-data-upload">
                  导入 CSV / JSON
                </label>
              </div>
            ) : (
              <button
                className="batch-link"
                onClick={() => void handlePickRecords()}
                disabled={!canPickRecords}
                title={wrongTableIssue?.message}
                type="button"
              >
                {wrongTableIssue
                  ? `先切到 ${activeTemplate.mainTableName}`
                  : snapshot?.selectedRecordIds.length
                    ? '重新选择记录'
                    : '选择要打印的记录'}
              </button>
            )}
          </div>

          <div className="preview-toolbar-actions">
            {isChromeExtension ? (
              <>
                <button
                  className="toolbar-button"
                  disabled={isLoading}
                  onClick={() => void loadCurrentSelection()}
                  type="button"
                >
                  {isLoading ? '读取中' : '同步飞书'}
                </button>
                <label className="toolbar-button toolbar-button-import" htmlFor="local-data-upload">
                  导入数据
                </label>
              </>
            ) : null}
            <div className="more-menu-wrap">
              <button
                className="toolbar-button"
                onClick={() => setIsMoreMenuOpen((current) => !current)}
                type="button"
              >
                更多
              </button>
              {isMoreMenuOpen ? (
                <div className="more-menu" role="menu">
                  {isChromeExtension ? (
                    <>
                      <button onClick={() => void loadCurrentSelection()} disabled={isLoading} type="button">
                        读取飞书勾选数据
                      </button>
                      <label htmlFor="local-data-upload" onClick={() => setIsMoreMenuOpen(false)}>
                        导入 CSV / JSON
                      </label>
                      <button onClick={handleLoadDemoData} type="button">
                        载入虚构示例
                      </button>
                    </>
                  ) : (
                    <button onClick={() => void handlePickRecords()} disabled={!canPickRecords} type="button">
                      选择要打印的记录
                    </button>
                  )}
                  <button onClick={() => handleEditTemplate(activeTemplate)} type="button">
                    排版设置
                  </button>
                  <button onClick={() => handleCopyTemplate(activeTemplate)} type="button">
                    复制排版
                  </button>
                  {!isChromeExtension ? (
                    <button onClick={() => void loadCurrentSelection()} type="button">
                      刷新数据
                    </button>
                  ) : null}
                  <button
                    onClick={() => {
                      setShowDiagnostics((current) => !current)
                      setIsMoreMenuOpen(false)
                    }}
                    type="button"
                  >
                    {showDiagnostics ? '收起诊断' : '打开诊断'}
                  </button>
                  <button
                    onClick={() => {
                      setIsControlPanelCollapsed((current) => !current)
                      setIsMoreMenuOpen(false)
                    }}
                    type="button"
                  >
                    {isControlPanelCollapsed ? '显示模板栏' : '收起模板栏'}
                  </button>
                </div>
              ) : null}
            </div>
            {!isControlPanelCollapsed ? (
              <button
                className="toolbar-button toolbar-button-quiet"
                onClick={() => setIsControlPanelCollapsed(true)}
                type="button"
              >
                隐藏模板
              </button>
            ) : null}
            <button className="toolbar-button" onClick={() => handleEditTemplate(activeTemplate)} type="button">
              编辑
            </button>
            <button
              className="toolbar-button toolbar-button-primary"
              onClick={() => void handleOpenPrintWorkspace()}
              disabled={!canRenderPdf}
              title="在独立窗口中可打印或选择“另存为 PDF”"
              type="button"
            >
              {busyAction === 'workspace' ? '打开中' : '在新窗口打印'}
            </button>
          </div>
        </header>

        <section className="workbench-status">
          <span>{getDataSourceLabel(snapshot?.context.source)}</span>
          <span>{pdfStatusLabel(pdfStatus)}</span>
          <span>{DOCUMENT_KIND_LABELS[activeTemplate.documentKind]}</span>
          <span>当前表：{snapshot?.context.mainTableName || '尚未读取'}</span>
          <span>模板需要：{activeTemplate.mainTableName || '尚未设置'}</span>
          <span>
            {isSelectionReloadPending
              ? '正在更新勾选…'
              : `已勾选：${snapshot?.selectedRecordIds.length ?? 0} 条`}
          </span>
          <strong>{currentInvoiceNo}</strong>
          <span>{snapshot?.payload.documents.length ?? 0} 条单据</span>
          <span>{currentItemCount} 行明细</span>
          {message ? (
            <button className="status-message-button" onClick={() => setShowDiagnostics(true)} type="button">
              有提示
            </button>
          ) : null}
          {warnings.length ? (
            <button className="status-message-button" onClick={() => setShowDiagnostics(true)} type="button">
              {warnings.length} 条提醒
            </button>
          ) : null}
          {blockers.length ? <span className="status-blocker">{blockers.length} 个阻断项</span> : null}
        </section>

        {blockers.length || showDiagnostics ? (
          <section className="workbench-drawer">
            {message && showDiagnostics ? (
              <section className="alert-banner">
                <strong>当前提示</strong>
                <p>{message}</p>
              </section>
            ) : null}
            {blockers.length ? (
              <IssuePanel title="阻断项" issues={blockers} emptyText="当前单据可以生成 PDF。" />
            ) : null}
            {warnings.length && showDiagnostics ? (
              <IssuePanel title="提醒" issues={warnings} emptyText="没有额外提醒。" />
            ) : null}
            {showDiagnostics ? (
              <DiagnosticsPanel
                dataSourceSchema={dataSourceSchema}
                events={diagnosticEvents}
                pdfStatus={pdfStatus}
                runtimeInfo={runtimeInfo}
                snapshot={snapshot}
              />
            ) : null}
          </section>
        ) : null}

        {activePanel === 'templates' ? (
          <section className="template-management-stage">
            <TemplateConsole
              activeTemplateId={activeTemplate.id}
              editingTemplate={editingTemplate}
              onCancelEdit={() => setEditingTemplate(null)}
              onCopyTemplate={handleCopyTemplate}
              onDeleteTemplate={requestDeleteTemplate}
              onEditTemplate={handleEditTemplate}
              onImportTemplateFile={(file) => void handleImportTemplateFile(file)}
              onNewTemplate={handleNewTemplate}
              onSaveTemplate={handleSaveTemplate}
              onUseTemplate={handleUseTemplate}
              templates={templates}
              dataSourceSchema={dataSourceSchema}
            />
          </section>
        ) : isLoading ? (
          <section className="empty-stage">
            <div className="loading-ring" />
            <p>正在读取当前单据。</p>
          </section>
        ) : previewHtml ? (
          <iframe className="invoice-preview-frame" sandbox="" title="单据打印预览" srcDoc={previewHtml} />
        ) : (
          <section className="empty-stage">
            <p>{isChromeExtension ? '尚未收到飞书勾选数据。' : '没有可预览的单据。'}</p>
            <p className="muted-text">
              {isChromeExtension
                ? '请保持飞书里的同名插件打开并勾选记录，再点击“同步飞书”。'
                : '请选择已接入 PDF 版式的模板和记录。'}
            </p>
          </section>
        )}
      </main>
      {pendingDeleteTemplate ? (
        <TemplateDeleteDialog
          onCancel={cancelTemplateDelete}
          onConfirm={confirmTemplateDelete}
          template={pendingDeleteTemplate}
        />
      ) : null}
      {templateNotice ? (
        <div aria-live="polite" className="template-action-toast" role="status">
          <span>{templateNotice}</span>
          <button aria-label="关闭模板提示" onClick={() => setTemplateNotice(null)} type="button">
            ×
          </button>
        </div>
      ) : null}
    </div>
  )
}

function TemplateSidebar({
  activePanel,
  activeTemplateId,
  onCollapse,
  onDeleteTemplate,
  onImportTemplateFile,
  onNewTemplate,
  onSearchChange,
  onUseTemplate,
  search,
  templates,
}: {
  activePanel: ActivePanel
  activeTemplateId: string
  onCollapse: () => void
  onDeleteTemplate: (template: PrintTemplate, trigger: HTMLButtonElement) => void
  onImportTemplateFile: (file: File) => void
  onNewTemplate: () => void
  onSearchChange: (value: string) => void
  onUseTemplate: (templateId: string) => void
  search: string
  templates: PrintTemplate[]
}) {
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const visibleTemplates = normalizedSearch
    ? templates.filter((template) =>
        `${template.name} ${DOCUMENT_KIND_LABELS[template.documentKind]} ${template.mainTableName}`
          .toLocaleLowerCase()
          .includes(normalizedSearch),
      )
    : templates

  return (
    <aside className="template-sidebar">
      <button className="template-sidebar-collapse" onClick={onCollapse} title="隐藏模板栏" type="button">
        ‹
      </button>
      <div className="template-sidebar-search">
        <label className="visually-hidden" htmlFor="template-sidebar-search">
          搜索模板
        </label>
        <input
          id="template-sidebar-search"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索模板"
          value={search}
        />
        <label className="sidebar-icon-button" htmlFor="template-sidebar-upload" title="导入飞书模板">
          导入
        </label>
        <input
          accept=".txt,.json"
          className="visually-hidden"
          id="template-sidebar-upload"
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              onImportTemplateFile(file)
            }
            event.currentTarget.value = ''
          }}
        />
      </div>

      <nav className="template-nav" aria-label="模板列表">
        <section className="template-nav-section">
          <div className="template-nav-heading">
            <span>记录模板</span>
            <small>{visibleTemplates.length}</small>
          </div>
          <div className="template-nav-list">
            {visibleTemplates.length ? (
              visibleTemplates.map((template) => (
                <div className="template-nav-row" key={template.id}>
                  <button
                    className={
                      template.id === activeTemplateId
                        ? 'template-nav-item template-nav-item-active'
                        : 'template-nav-item'
                    }
                    onClick={() => onUseTemplate(template.id)}
                    title={`${DOCUMENT_KIND_LABELS[template.documentKind]} · ${template.name}`}
                    type="button"
                  >
                    <span className="template-nav-icon" aria-hidden="true" />
                    <span>{template.name}</span>
                  </button>
                  {template.isBuiltIn ? (
                    <span className="template-nav-protected" title="系统内置模板不可删除">
                      内置
                    </span>
                  ) : (
                    <button
                      aria-label={`删除自定义模板：${template.name}`}
                      className="template-nav-delete"
                      onClick={(event) => onDeleteTemplate(template, event.currentTarget)}
                      title={`删除「${template.name}」`}
                      type="button"
                    >
                      删除
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p className="template-nav-empty">没有匹配的模板。</p>
            )}
          </div>
        </section>

        <section className="template-nav-section template-nav-section-muted">
          <div className="template-nav-heading">
            <span>视图模板</span>
            <small>0</small>
          </div>
          <p className="template-nav-empty">暂无视图模板</p>
        </section>
      </nav>

      <div className="template-sidebar-footer">
        <button
          className={activePanel === 'templates' ? 'sidebar-create-button sidebar-create-button-muted' : 'sidebar-create-button'}
          onClick={onNewTemplate}
          type="button"
        >
          + 创建模板
        </button>
      </div>
    </aside>
  )
}

function DiagnosticsPanel({
  dataSourceSchema,
  events,
  pdfStatus,
  runtimeInfo,
  snapshot,
}: {
  dataSourceSchema: DataSourceSchema | null
  events: DiagnosticEvent[]
  pdfStatus: PdfServiceStatus
  runtimeInfo: RuntimeInfo
  snapshot: PiSnapshot | null
}) {
  return (
    <section className="panel diagnostics-panel">
      <div className="panel-heading-row">
        <PanelTitle title="诊断信息" />
        <StatusChip label="运行记录" tone="cool" />
      </div>
      <dl className="meta-grid diagnostics-grid">
        <MetaItem label="页面地址" value={runtimeInfo.href} />
        <MetaItem label="协议" value={runtimeInfo.protocol} />
        <MetaItem label="安全上下文" value={runtimeInfo.secureContext ? '是' : '否'} />
        <MetaItem label="嵌入页面" value={runtimeInfo.inIframe ? '是' : '否'} />
        <MetaItem label="窗口大小" value={runtimeInfo.viewport} />
        <MetaItem label="语言" value={runtimeInfo.language} />
        <MetaItem label="打印方式" value={`${pdfStatusLabel(pdfStatus)} · ${getPrintRuntimeLabel()}`} />
        <MetaItem label="数据来源" value={snapshot?.context.source ?? '尚未读取'} />
        <MetaItem label="当前表" value={snapshot?.context.mainTableName ?? '尚未读取'} />
        <MetaItem label="当前视图" value={snapshot?.context.viewName ?? '尚未读取'} />
        <MetaItem label="单据数量" value={`${snapshot?.payload.documents.length ?? 0}`} />
        <MetaItem label="字段结构" value={dataSourceSchema ? `${dataSourceSchema.source} · ${dataSourceSchema.tables.length} 表` : '读取中'} />
      </dl>
      <div className="diagnostic-events">
        <p className="muted-text">以下是本次打开后的历史记录；当前状态请以上方提示为准。</p>
        {events.map((event) => (
          <article className={`diagnostic-event diagnostic-event-${event.level}`} key={event.id}>
            <div>
              <strong>{event.message}</strong>
              <time>{event.createdAt}</time>
            </div>
            {event.detail ? <p>{event.detail}</p> : null}
          </article>
        ))}
      </div>
      <details className="diagnostic-details">
        <summary>浏览器信息</summary>
        <p>{runtimeInfo.userAgent}</p>
      </details>
    </section>
  )
}

function IssuePanel({
  title,
  issues,
  emptyText,
}: {
  title: string
  issues: ValidationIssue[]
  emptyText: string
}) {
  return (
    <section className="panel">
      <PanelTitle title={title} />
      {issues.length ? (
        <div className="issue-list">
          {issues.map((issue) => (
            <div className={`issue-row issue-row-${issue.severity}`} key={`${issue.code}-${issue.message}`}>
              <span>{issue.severity === 'blocker' ? '需处理' : '提示'}</span>
              <p>{issue.recordId ? `${issue.message}（${issue.recordId}）` : issue.message}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted-text">{emptyText}</p>
      )}
    </section>
  )
}

function TemplateConsole({
  activeTemplateId,
  dataSourceSchema,
  editingTemplate,
  onCancelEdit,
  onCopyTemplate,
  onDeleteTemplate,
  onEditTemplate,
  onImportTemplateFile,
  onNewTemplate,
  onSaveTemplate,
  onUseTemplate,
  templates,
}: {
  activeTemplateId: string
  dataSourceSchema: DataSourceSchema | null
  editingTemplate: PrintTemplate | null
  onCancelEdit: () => void
  onCopyTemplate: (template: PrintTemplate) => void
  onDeleteTemplate: (template: PrintTemplate, trigger: HTMLButtonElement) => void
  onEditTemplate: (template: PrintTemplate) => void
  onImportTemplateFile: (file: File) => void
  onNewTemplate: () => void
  onSaveTemplate: (template: PrintTemplate) => void
  onUseTemplate: (templateId: string) => void
  templates: PrintTemplate[]
}) {
  const activeTemplate =
    templates.find((template) => template.id === activeTemplateId) ?? templates[0]

  return (
    <>
      <section className="panel">
        <div className="panel-heading-row">
          <PanelTitle title="模板保存台" />
          <div className="header-actions">
            <label className="small-button file-button" htmlFor="template-upload">
              导入飞书模板
            </label>
            <input
              accept=".txt,.json"
              className="visually-hidden"
              id="template-upload"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  onImportTemplateFile(file)
                }
                event.currentTarget.value = ''
              }}
            />
            <button className="small-button" onClick={onNewTemplate} type="button">
              新建
            </button>
          </div>
        </div>
        <p className="hint-text">
          支持飞书导出的 .txt 模板，也支持兼容的 .json 模板。导入后请选择主表、明细表和关联字段，再保存模板。
        </p>
        <p className="hint-text">
          自定义模板可以删除；系统内置模板会保留，复制后可自由修改。
        </p>
        <div className="template-list">
          {templates.map((template) => (
            <div
              className={
                template.id === activeTemplateId ? 'template-row template-row-active' : 'template-row'
              }
              key={template.id}
            >
              <div className="template-row-main">
                <div className="template-row-title">
                  <strong>{template.name}</strong>
                  <StatusChip
                    label={template.status === 'ready' ? '可打印' : '草稿'}
                    tone={template.status === 'ready' ? 'cool' : 'warm'}
                  />
                </div>
                <p>
                  {DOCUMENT_KIND_LABELS[template.documentKind]} ·{' '}
                  {template.isBuiltIn ? '内置模板' : '自定义模板'}
                </p>
                <p>{template.mainTableName || '未设置主表'}</p>
              </div>
              <div className="template-row-actions">
                <button onClick={() => onUseTemplate(template.id)} type="button">
                  使用
                </button>
                <button onClick={() => onEditTemplate(template)} type="button">
                  编辑
                </button>
                <button onClick={() => onCopyTemplate(template)} type="button">
                  复制
                </button>
                {!template.isBuiltIn ? (
                  <button
                    aria-label={`删除自定义模板：${template.name}`}
                    className="danger-button"
                    onClick={(event) => onDeleteTemplate(template, event.currentTarget)}
                    type="button"
                  >
                    删除
                  </button>
                ) : (
                  <button className="protected-button" disabled title="系统内置模板不可删除" type="button">
                    系统保留
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {editingTemplate ? (
        <TemplateEditor
          key={editingTemplate.id}
          dataSourceSchema={dataSourceSchema}
          onCancel={onCancelEdit}
          onSave={onSaveTemplate}
          template={editingTemplate}
        />
      ) : (
        <TemplateFieldOverview template={activeTemplate} />
      )}
    </>
  )
}

function TemplateDeleteDialog({
  onCancel,
  onConfirm,
  template,
}: {
  onCancel: () => void
  onConfirm: () => void
  template: PrintTemplate
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    cancelButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) {
        return
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      )
      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      if (!firstElement || !lastElement) {
        return
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div
      className="template-delete-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onCancel()
        }
      }}
    >
      <section
        aria-describedby="template-delete-description"
        aria-labelledby="template-delete-title"
        aria-modal="true"
        className="template-delete-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <p className="eyebrow">模板管理</p>
        <h2 id="template-delete-title">删除自定义模板？</h2>
        <p id="template-delete-description">
          将永久删除“{template.name}”及其排版设置。此操作无法撤销。
        </p>
        <p className="template-delete-note">
          已经打开的打印窗口是本次快照，如不再需要请一并关闭。
        </p>
        <div className="template-delete-actions">
          <button ref={cancelButtonRef} onClick={onCancel} type="button">
            取消
          </button>
          <button className="template-delete-confirm" onClick={onConfirm} type="button">
            删除模板
          </button>
        </div>
      </section>
    </div>
  )
}

function TemplateDesigner({
  dataSourceSchema,
  isDataPrintAllowed,
  onCancel,
  onSave,
  pdfStatus,
  snapshot,
  template,
}: {
  dataSourceSchema: DataSourceSchema | null
  isDataPrintAllowed: boolean
  onCancel: () => void
  onSave: (template: PrintTemplate) => void
  pdfStatus: PdfServiceStatus
  snapshot: PiSnapshot | null
  template: PrintTemplate
}) {
  const [draft, setDraft] = useState(template)
  const [selected, setSelected] = useState<DesignerSelection | null>(null)
  const [busyAction, setBusyAction] = useState<'workspace' | null>(null)
  const previewFrameRef = useRef<HTMLIFrameElement>(null)
  const [designerNotice, setDesignerNotice] = useState<string | null>(null)
  const [isDesignerLeftCollapsed, setIsDesignerLeftCollapsed] = useState(false)
  const [isDesignerRightCollapsed, setIsDesignerRightCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1180,
  )
  const tables = useMemo(() => collectOfficialTables(draft), [draft])
  const images = useMemo(() => collectOfficialImages(draft), [draft])
  const selectedTableId = selected?.tableId || getTableIdFromDesignId(selected?.designId ?? '')
  const selectedTable = tables.find((table) => table.id === selectedTableId)
  const selectedImage = images.find((image) => image.id === selected?.designId)
  const selectedImageDefaultWidthMm = selected?.designId.startsWith('attachment:') ? 32 : 48
  const selectedStyle = selected?.designId
    ? draft.designOverrides?.nodeStyles?.[selected.designId] ?? {}
    : {}
  const selectedTableStyle = selectedTable
    ? draft.designOverrides?.nodeStyles?.[selectedTable.id] ?? {}
    : {}
  const selectedText = selected?.designId ? getDesignTargetText(draft, selected.designId) : ''
  const previewPayload = useMemo(
    () => buildDesignerPayload(draft, snapshot, selected?.designId),
    [draft, selected?.designId, snapshot],
  )
  const previewHtml = useMemo(
    () => (previewPayload ? buildPrintDocument(previewPayload) : ''),
    [previewPayload],
  )
  const mainTableOption = dataSourceSchema?.tables.find((table) => table.name === draft.mainTableName)
  const itemTableOption = dataSourceSchema?.tables.find((table) => table.name === draft.itemTableName)
  const mainFieldOptions = mainTableOption?.fields ?? []
  const itemFieldOptions = itemTableOption?.fields ?? []
  const unboundFields = [...draft.mainFields, ...draft.itemFields].filter((field) => !field.label.trim())
  const canRenderPdf =
    isDataPrintAllowed && Boolean(previewPayload) && pdfStatus === 'online' && !busyAction
  const isDesignerFocusMode = isDesignerLeftCollapsed && isDesignerRightCollapsed

  useEffect(() => {
    setDraft(template)
    setSelected(null)
    setDesignerNotice(null)
  }, [template])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== previewFrameRef.current?.contentWindow) {
        return
      }

      const data = event.data as DesignerMessage
      if (data?.type === 'bitable-print-table-resize' && data.tableId && data.widths?.length) {
        updateTableColumnWidths(data.tableId, data.widths)
        setSelected({
          designId: data.tableId,
          kind: 'table',
          tableId: data.tableId,
        })
        setDesignerNotice('表格列宽已调整。')
        return
      }

      if (
        data?.type === 'bitable-print-image-move' &&
        data.designId &&
        typeof data.xMm === 'number' &&
        typeof data.yMm === 'number'
      ) {
        updateImagePosition(data.designId, data.xMm, data.yMm)
        setSelected({
          designId: data.designId,
          kind: 'image',
          tableId: '',
        })
        setDesignerNotice('图片位置已调整。')
        return
      }

      if (!data?.type || !data.designId) {
        return
      }

      if (data.type === 'bitable-print-design-drop' && data.field) {
        applyFieldToTarget(
          {
            designId: data.designId,
            kind: data.kind || 'element',
            tableId: data.tableId || getTableIdFromDesignId(data.designId),
          },
          data.field,
        )
        return
      }

      if (data.type !== 'bitable-print-design-select') {
        return
      }

      setSelected({
        designId: data.designId,
        kind: data.kind || 'element',
        tableId: data.tableId || getTableIdFromDesignId(data.designId),
      })
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  })

  function applyFieldToTarget(target: DesignerSelection, field: DesignerFieldSource) {
    setSelected(target)
    setDraft((current) => bindFieldToDesignTarget(current, target.designId, field))
    setDesignerNotice(`${field.source === 'main' ? '主表' : '明细'}字段「${field.fieldName}」已放入模板。`)
  }

  function handleFieldDragStart(event: DragEvent<HTMLElement>, field: DesignerFieldSource) {
    const payload = JSON.stringify(field)
    event.dataTransfer.setData('application/x-bitable-print-field', payload)
    event.dataTransfer.setData('text/plain', payload)
    event.dataTransfer.effectAllowed = 'copy'
  }

  function handleFieldClick(field: DesignerFieldSource) {
    if (!selected) {
      setDesignerNotice('先点击中间模板里的文字块或表格单元格，再点字段即可放入。')
      return
    }

    applyFieldToTarget(selected, field)
  }

  function updateSelectedText(value: string) {
    if (!selected?.designId) {
      return
    }

    setDraft((current) => updateDesignTargetText(current, selected.designId, value))
    setDesignerNotice('选中位置的文字已更新。')
  }

  function updateDraft<K extends keyof PrintTemplate>(key: K, value: PrintTemplate[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function updateMainFieldMapping(key: string, label: string) {
    setDraft((current) => ({
      ...current,
      mainFields: current.mainFields.map((field) =>
        field.key === key ? { ...field, label } : field,
      ),
    }))
  }

  function updateItemFieldMapping(key: string, label: string) {
    setDraft((current) => ({
      ...current,
      itemFields: current.itemFields.map((field) =>
        field.key === key ? { ...field, label } : field,
      ),
    }))
  }

  function selectMainTable(tableName: string) {
    const table = dataSourceSchema?.tables.find((current) => current.name === tableName)
    updateDraft('mainTableName', tableName)
    if (table && !table.fields.some((field) => field.name === draft.linkedItemsFieldName)) {
      updateDraft('linkedItemsFieldName', '')
    }
  }

  function updateDesignOverrides(nextOverrides: TemplateDesignOverrides) {
    setDraft((current) => ({
      ...current,
      designOverrides: nextOverrides,
    }))
  }

  function updatePageSetting<K extends keyof NonNullable<TemplateDesignOverrides['pageSettings']>>(
    key: K,
    value: NonNullable<TemplateDesignOverrides['pageSettings']>[K],
  ) {
    const current = draft.designOverrides ?? {}
    updateDesignOverrides({
      ...current,
      pageSettings: {
        ...current.pageSettings,
        [key]: value,
      },
    })
  }

  function updateSelectedStyle(patch: TemplateNodeStyleOverride) {
    if (!selected?.designId) {
      return
    }

    const current = draft.designOverrides ?? {}
    updateDesignOverrides({
      ...current,
      nodeStyles: {
        ...current.nodeStyles,
        [selected.designId]: {
          ...current.nodeStyles?.[selected.designId],
          ...patch,
        },
      },
    })
  }

  function updateTableStyle(tableId: string, patch: TemplateNodeStyleOverride) {
    const current = draft.designOverrides ?? {}
    updateDesignOverrides({
      ...current,
      nodeStyles: {
        ...current.nodeStyles,
        [tableId]: {
          ...current.nodeStyles?.[tableId],
          ...patch,
        },
      },
    })
  }

  function updateTableColumnWidths(tableId: string, widths: number[]) {
    const table = tables.find((current) => current.id === tableId)
    if (!table) {
      return
    }

    const nextWidths = normalizeColumnWidths(
      table.columnWidths.map((fallback, index) => sanitizeColumnWidth(widths[index], fallback)),
    )
    const current = draft.designOverrides ?? {}
    updateDesignOverrides({
      ...current,
      tableColumnWidths: {
        ...current.tableColumnWidths,
        [tableId]: nextWidths,
      },
    })
  }

  function updateTableColumnWidth(tableId: string, columnIndex: number, width: number) {
    const table = tables.find((current) => current.id === tableId)
    if (!table) {
      return
    }

    const current = draft.designOverrides ?? {}
    const existing = current.tableColumnWidths?.[tableId] ?? table.columnWidths
    const nextWidths = existing.map((currentWidth, index) => (index === columnIndex ? width : currentWidth))
    updateDesignOverrides({
      ...current,
      tableColumnWidths: {
        ...current.tableColumnWidths,
        [tableId]: nextWidths,
      },
    })
  }

  function updateImagePosition(designId: string, xMm: number, yMm: number) {
    const current = draft.designOverrides ?? {}
    updateDesignOverrides({
      ...current,
      nodeStyles: {
        ...current.nodeStyles,
        [designId]: {
          ...current.nodeStyles?.[designId],
          imageOffsetXMm: xMm,
          imageOffsetYMm: yMm,
        },
      },
    })
  }

  async function openDesignerPrintWorkspace() {
    if (!previewPayload || !canRenderPdf) {
      return
    }

    setBusyAction('workspace')
    try {
      await openPrintWorkspace({
        ...previewPayload,
        designMode: false,
        selectedDesignId: undefined,
      })
      await notifyHost('独立打印窗口已打开。')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF 操作失败。'
      await notifyHost(message)
    } finally {
      setBusyAction(null)
    }
  }

  function toggleDesignerFocusMode() {
    if (isDesignerFocusMode) {
      setIsDesignerLeftCollapsed(false)
      setIsDesignerRightCollapsed(false)
      return
    }

    setIsDesignerLeftCollapsed(true)
    setIsDesignerRightCollapsed(true)
  }

  const pageSettings = draft.designOverrides?.pageSettings ?? {}
  const designerShellClassName = [
    'designer-shell',
    isDesignerLeftCollapsed ? 'designer-shell-left-collapsed' : '',
    isDesignerRightCollapsed ? 'designer-shell-right-collapsed' : '',
    isDesignerFocusMode ? 'designer-shell-focus-mode' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={designerShellClassName}>
      <header className="designer-topbar">
        <div>
          <p className="eyebrow">Template Designer</p>
          <h1>{draft.name}</h1>
        </div>
        <div className="designer-topbar-actions">
          <button
            className="small-button"
            onClick={() => setIsDesignerLeftCollapsed((current) => !current)}
            type="button"
          >
            {isDesignerLeftCollapsed ? '显示字段栏' : '收起字段栏'}
          </button>
          <button
            className="small-button"
            onClick={() => setIsDesignerRightCollapsed((current) => !current)}
            type="button"
          >
            {isDesignerRightCollapsed ? '显示设置栏' : '收起设置栏'}
          </button>
          <button
            className="small-button"
            aria-pressed={isDesignerFocusMode}
            onClick={toggleDesignerFocusMode}
            type="button"
          >
            {isDesignerFocusMode ? '退出专注' : '专注预览'}
          </button>
          <button className="small-button" onClick={onCancel} type="button">
            退出编辑
          </button>
          <button
            className="small-button small-button-accent"
            disabled={!canRenderPdf}
            onClick={() => void openDesignerPrintWorkspace()}
            title="在独立窗口中可打印或选择“另存为 PDF”"
            type="button"
          >
            {busyAction === 'workspace' ? '打开中' : '在新窗口打印'}
          </button>
          <button className="small-button" onClick={() => onSave(draft)} type="button">
            保存模板
          </button>
        </div>
      </header>

      <aside className="designer-left designer-panel">
        <div className="designer-scroll">
          <section className="designer-section">
            <h2>基础信息</h2>
            <label className="setting-field">
              <span>模板名称</span>
              <input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} />
            </label>
            <label className="setting-field">
              <span>单据类型</span>
              <select
                value={draft.documentKind}
                onChange={(event) => updateDraft('documentKind', event.target.value as DocumentKind)}
              >
                {Object.entries(DOCUMENT_KIND_LABELS).map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="designer-section">
            <h2>源数据</h2>
            <label className="setting-field">
              <span>主表</span>
              <DataSourceSelect
                id="designer-main-table"
                options={dataSourceSchema?.tables.map((table) => table.name) ?? []}
                placeholder="选择主表"
                value={draft.mainTableName}
                onChange={selectMainTable}
              />
            </label>
            <label className="setting-field">
              <span>明细表</span>
              <DataSourceSelect
                id="designer-item-table"
                options={dataSourceSchema?.tables.map((table) => table.name) ?? []}
                placeholder="选择明细表"
                value={draft.itemTableName}
                onChange={(value) => updateDraft('itemTableName', value)}
              />
            </label>
            <label className="setting-field">
              <span>关联字段</span>
              <DataSourceSelect
                id="designer-link-field"
                options={mainFieldOptions.map((field) => field.name)}
                placeholder="选择关联字段"
                value={draft.linkedItemsFieldName}
                onChange={(value) => updateDraft('linkedItemsFieldName', value)}
              />
            </label>
          </section>

          <section className="designer-section">
            <div className="panel-heading-row">
              <h2>可拖拽字段</h2>
              <StatusChip label={dataSourceSchema?.source === 'mock' ? '样例数据' : '飞书数据'} />
            </div>
            <p className="hint-text">
              把字段拖到中间模板的文字块或表格单元格上；也可以先点中间位置，再点这里的字段。
            </p>
            <FieldSourceList
              fields={mainFieldOptions}
              title={draft.mainTableName || '主表字段'}
              source="main"
              onFieldClick={handleFieldClick}
              onFieldDragStart={handleFieldDragStart}
            />
            <FieldSourceList
              fields={itemFieldOptions}
              title={draft.itemTableName || '明细字段'}
              source="item"
              onFieldClick={handleFieldClick}
              onFieldDragStart={handleFieldDragStart}
            />
            {designerNotice ? <p className="designer-notice">{designerNotice}</p> : null}
          </section>

          <section className="designer-section">
            <div className="panel-heading-row">
              <h2>字段映射</h2>
              <StatusChip
                label={unboundFields.length ? `${unboundFields.length} 个未绑定` : '已绑定'}
                tone={unboundFields.length ? 'warm' : 'cool'}
              />
            </div>
            <div className="designer-mapping-group">
              <h3>主表字段</h3>
              {draft.mainFields.map((field) => (
                <label className="designer-mapping-row" key={field.key}>
                  <span title={field.key}>{field.key}</span>
                  <DataSourceSelect
                    id={`designer-main-${field.key}`}
                    options={mainFieldOptions.map((option) => option.name)}
                    placeholder="绑定主表字段"
                    value={field.label}
                    onChange={(value) => updateMainFieldMapping(field.key, value)}
                  />
                </label>
              ))}
            </div>
            <div className="designer-mapping-group">
              <h3>明细字段</h3>
              {draft.itemFields.map((field) => (
                <label className="designer-mapping-row" key={field.key}>
                  <span title={field.key}>{field.key}</span>
                  <DataSourceSelect
                    id={`designer-item-${field.key}`}
                    options={itemFieldOptions.map((option) => option.name)}
                    placeholder="绑定明细字段"
                    value={field.label}
                    onChange={(value) => updateItemFieldMapping(field.key, value)}
                  />
                </label>
              ))}
            </div>
          </section>
        </div>
      </aside>

      <main className="designer-canvas">
        {(isDesignerLeftCollapsed || isDesignerRightCollapsed) ? (
          <div className="designer-canvas-controls" aria-label="设计台侧栏控制">
            {isDesignerLeftCollapsed ? (
              <button
                className="small-button"
                onClick={() => setIsDesignerLeftCollapsed(false)}
                type="button"
              >
                显示字段栏
              </button>
            ) : null}
            {isDesignerRightCollapsed ? (
              <button
                className="small-button"
                onClick={() => setIsDesignerRightCollapsed(false)}
                type="button"
              >
                显示设置栏
              </button>
            ) : null}
          </div>
        ) : null}
        <iframe
          className="designer-preview-frame"
          ref={previewFrameRef}
          sandbox="allow-scripts"
          title="模板实时预览"
          srcDoc={previewHtml}
        />
      </main>

      <aside className="designer-right designer-panel">
        <div className="designer-scroll">
          <section className="designer-section">
            <h2>页面</h2>
            <label className="setting-field">
              <span>输出模式</span>
              <select
                value={pageSettings.pageMode ?? draft.printSettings.layout.pageMode}
                onChange={(event) => updatePageSetting('pageMode', event.target.value as PageMode)}
              >
                {Object.entries(PAGE_MODE_LABELS).map(([mode, label]) => (
                  <option key={mode} value={mode}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <NumberSettingInput
              label="基础字号 pt"
              min={6}
              max={18}
              step={0.5}
              value={pageSettings.fontSizePt ?? draft.printSettings.layout.fontSizePt}
              onChange={(value) => updatePageSetting('fontSizePt', value)}
            />
            <NumberSettingInput
              label="基础行距"
              min={0.9}
              max={2.4}
              step={0.05}
              value={pageSettings.lineHeight ?? 1.5}
              onChange={(value) => updatePageSetting('lineHeight', value)}
            />
            <NumberSettingInput
              label="左右边距 mm"
              min={3}
              max={30}
              step={0.5}
              value={pageSettings.pagePaddingXMm ?? draft.printSettings.layout.pagePaddingXMm}
              onChange={(value) => updatePageSetting('pagePaddingXMm', value)}
            />
          </section>

          <section className="designer-section">
            <h2>选中元素</h2>
            {selected ? (
              <>
                <p className="designer-selected-id">{selected.kind} · {selected.designId}</p>
                {selected.kind === 'cell' || selected.kind === 'text' ? (
                  <label className="setting-field">
                    <span>文字/字段变量</span>
                    <textarea
                      rows={3}
                      value={selectedText}
                      onChange={(event) => updateSelectedText(event.target.value)}
                    />
                    <small>字段写成 [字段名]，或从左侧拖字段放进来。</small>
                  </label>
                ) : null}
                <label className="setting-field">
                  <span>字体</span>
                  <select
                    value={selectedStyle.fontFamily ?? ''}
                    onChange={(event) =>
                      updateSelectedStyle({ fontFamily: event.target.value || undefined })
                    }
                  >
                    {FONT_OPTIONS.map((font) => (
                      <option key={font.label} value={font.value}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberSettingInput
                  label="选中字号 pt"
                  min={6}
                  max={28}
                  step={0.5}
                  value={selectedStyle.fontSizePt ?? pageSettings.fontSizePt ?? draft.printSettings.layout.fontSizePt}
                  onChange={(value) => updateSelectedStyle({ fontSizePt: value })}
                />
                <NumberSettingInput
                  label="选中行距"
                  min={0.8}
                  max={2.6}
                  step={0.05}
                  value={selectedStyle.lineHeight ?? pageSettings.lineHeight ?? 1.5}
                  onChange={(value) => updateSelectedStyle({ lineHeight: value })}
                />
                <label className="setting-field setting-checkbox">
                  <input
                    checked={Boolean(selectedStyle.bold)}
                    type="checkbox"
                    onChange={(event) => updateSelectedStyle({ bold: event.target.checked })}
                  />
                  <span>加粗</span>
                </label>
                <label className="setting-field">
                  <span>对齐</span>
                  <select
                    value={selectedStyle.textAlign ?? 'left'}
                    onChange={(event) => updateSelectedStyle({ textAlign: event.target.value as TextAlign })}
                  >
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </select>
                </label>
                <NumberSettingInput
                  label="内边距 mm"
                  min={0}
                  max={8}
                  step={0.2}
                  value={selectedStyle.paddingMm ?? 0}
                  onChange={(value) => updateSelectedStyle({ paddingMm: value })}
                />
                {selected.kind === 'image' ? (
                  <>
                    <NumberSettingInput
                      label="横向位置 mm"
                      min={-80}
                      max={220}
                      step={1}
                      value={selectedStyle.imageOffsetXMm ?? selectedImage?.offsetXMm ?? 0}
                      onChange={(value) => updateSelectedStyle({ imageOffsetXMm: value })}
                    />
                    <NumberSettingInput
                      label="纵向位置 mm"
                      min={-80}
                      max={260}
                      step={1}
                      value={selectedStyle.imageOffsetYMm ?? selectedImage?.offsetYMm ?? 0}
                      onChange={(value) => updateSelectedStyle({ imageOffsetYMm: value })}
                    />
                    <NumberSettingInput
                      label="图片宽度 mm"
                      min={8}
                      max={120}
                      step={1}
                      value={selectedStyle.imageWidthMm ?? selectedImage?.widthMm ?? selectedImageDefaultWidthMm}
                      onChange={(value) => updateSelectedStyle({ imageWidthMm: value })}
                    />
                  </>
                ) : null}
              </>
            ) : (
              <p className="muted-text">点击中间预览里的文字、表格单元格或图片后，在这里调整样式。</p>
            )}
          </section>

          {selectedTable ? (
            <section className="designer-section">
              <h2>表格列宽</h2>
              <p className="muted-text">{selectedTable.label}。可以拖动预览表格里的竖线，也可以在这里输入数值。</p>
              <NumberSettingInput
                label="整表行距"
                min={0.9}
                max={2.6}
                step={0.05}
                value={selectedTableStyle.lineHeight ?? pageSettings.lineHeight ?? 1.5}
                onChange={(value) => updateTableStyle(selectedTable.id, { lineHeight: value })}
              />
              <NumberSettingInput
                label="整表单元格留白 mm"
                min={0}
                max={8}
                step={0.2}
                value={selectedTableStyle.paddingMm ?? 1.8}
                onChange={(value) => updateTableStyle(selectedTable.id, { paddingMm: value })}
              />
              {(draft.designOverrides?.tableColumnWidths?.[selectedTable.id] ?? selectedTable.columnWidths).map(
                (width, index) => (
                  <NumberSettingInput
                    key={`${selectedTable.id}-${index}`}
                    label={`第 ${index + 1} 列 %`}
                    min={3}
                    max={70}
                    step={0.1}
                    value={width}
                    onChange={(value) => updateTableColumnWidth(selectedTable.id, index, value)}
                  />
                ),
              )}
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

function sanitizeColumnWidth(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(3, value as number) : Math.max(3, fallback)
}

function normalizeColumnWidths(widths: number[]): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0)
  if (!Number.isFinite(total) || total <= 0) {
    return widths
  }

  return widths.map((width) => Number.parseFloat(((width / total) * 100).toFixed(3)))
}

function FieldSourceList({
  fields,
  onFieldClick,
  onFieldDragStart,
  source,
  title,
}: {
  fields: DataSourceSchema['tables'][number]['fields']
  onFieldClick: (field: DesignerFieldSource) => void
  onFieldDragStart: (event: DragEvent<HTMLElement>, field: DesignerFieldSource) => void
  source: DesignerFieldSource['source']
  title: string
}) {
  return (
    <div className="field-source-group">
      <h3>{title}</h3>
      {fields.length ? (
        <div className="field-source-list">
          {fields.map((field) => {
            const fieldSource: DesignerFieldSource = {
              source,
              fieldName: field.name,
              fieldType: field.type,
            }

            return (
              <button
                className="field-source-card"
                draggable
                key={field.id}
                onClick={() => onFieldClick(fieldSource)}
                onDragStart={(event) => onFieldDragStart(event, fieldSource)}
                title={`${field.name} · ${field.type}`}
                type="button"
              >
                <span>{field.name}</span>
                <small>{source === 'main' ? '主表' : '明细'}</small>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="muted-text">选择数据表后显示字段。</p>
      )}
    </div>
  )
}

function TemplateEditor({
  dataSourceSchema,
  onCancel,
  onSave,
  template,
}: {
  dataSourceSchema: DataSourceSchema | null
  onCancel: () => void
  onSave: (template: PrintTemplate) => void
  template: PrintTemplate
}) {
  const [draft, setDraft] = useState(template)

  useEffect(() => {
    setDraft(template)
  }, [template])

  function updateDraft<K extends keyof PrintTemplate>(key: K, value: PrintTemplate[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function updateText<K extends keyof TemplateTextSettings>(key: K, value: TemplateTextSettings[K]) {
    setDraft((current) => ({
      ...current,
      printSettings: {
        ...current.printSettings,
        text: {
          ...current.printSettings.text,
          [key]: value,
        },
      },
    }))
  }

  function updateItemHeader(key: ItemColumnKey, value: string) {
    setDraft((current) => ({
      ...current,
      printSettings: {
        ...current.printSettings,
        text: {
          ...current.printSettings.text,
          itemHeaders: {
            ...current.printSettings.text.itemHeaders,
            [key]: value,
          },
        },
      },
    }))
  }

  function updateLayout<K extends keyof TemplateLayoutSettings>(
    key: K,
    value: TemplateLayoutSettings[K],
  ) {
    setDraft((current) => ({
      ...current,
      printSettings: {
        ...current.printSettings,
        layout: {
          ...current.printSettings.layout,
          [key]: value,
        },
      },
    }))
  }

  function updateColumnWidth(key: ItemColumnKey, value: number) {
    setDraft((current) => ({
      ...current,
      printSettings: {
        ...current.printSettings,
        layout: {
          ...current.printSettings.layout,
          columnWidths: {
            ...current.printSettings.layout.columnWidths,
            [key]: value,
          },
        },
      },
    }))
  }

  const text = draft.printSettings.text
  const layout = draft.printSettings.layout
  const columnTotal = Object.values(layout.columnWidths).reduce((total, width) => total + width, 0)
  const mainTableOption = dataSourceSchema?.tables.find(
    (table) => table.name === draft.mainTableName,
  )
  const itemTableOption = dataSourceSchema?.tables.find(
    (table) => table.name === draft.itemTableName,
  )
  const mainFieldOptions = mainTableOption?.fields ?? []
  const itemFieldOptions = itemTableOption?.fields ?? []

  function updateMainFieldMapping(key: string, label: string) {
    setDraft((current) => ({
      ...current,
      mainFields: current.mainFields.map((field) =>
        field.key === key ? { ...field, label } : field,
      ),
    }))
  }

  function updateItemFieldMapping(key: string, label: string) {
    setDraft((current) => ({
      ...current,
      itemFields: current.itemFields.map((field) =>
        field.key === key ? { ...field, label } : field,
      ),
    }))
  }

  function selectMainTable(tableName: string) {
    const table = dataSourceSchema?.tables.find((current) => current.name === tableName)
    updateDraft('mainTableName', tableName)
    if (table && !table.fields.some((field) => field.name === draft.linkedItemsFieldName)) {
      updateDraft('linkedItemsFieldName', '')
    }
  }

  return (
    <section className="panel template-editor">
      <PanelTitle title="保存模板" />
      <div className="editor-section">
        <h3>基础信息</h3>
      <div className="form-grid">
        <label className="field-label" htmlFor="template-name">
          模板名称
        </label>
        <input
          id="template-name"
          value={draft.name}
          onChange={(event) => updateDraft('name', event.target.value)}
        />

        <label className="field-label" htmlFor="template-kind">
          单据类型
        </label>
        <select
          id="template-kind"
          value={draft.documentKind}
          onChange={(event) => updateDraft('documentKind', event.target.value as DocumentKind)}
        >
          {Object.entries(DOCUMENT_KIND_LABELS).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>

        <label className="field-label" htmlFor="template-main-table">
          主表
        </label>
        <DataSourceSelect
          id="template-main-table"
          options={dataSourceSchema?.tables.map((table) => table.name) ?? []}
          value={draft.mainTableName}
          onChange={selectMainTable}
          placeholder="输入或选择主表"
        />

        <label className="field-label" htmlFor="template-item-table">
          明细表
        </label>
        <DataSourceSelect
          id="template-item-table"
          options={dataSourceSchema?.tables.map((table) => table.name) ?? []}
          value={draft.itemTableName}
          onChange={(value) => updateDraft('itemTableName', value)}
          placeholder="输入或选择明细表"
        />

        <label className="field-label" htmlFor="template-link-field">
          关联字段
        </label>
        <DataSourceSelect
          id="template-link-field"
          options={mainFieldOptions.map((field) => field.name)}
          value={draft.linkedItemsFieldName}
          onChange={(value) => updateDraft('linkedItemsFieldName', value)}
          placeholder="输入或选择关联字段"
        />

        <label className="field-label" htmlFor="template-description">
          备注
        </label>
        <textarea
          id="template-description"
          rows={3}
          value={draft.description}
          onChange={(event) => updateDraft('description', event.target.value)}
        />
      </div>
      </div>

      {draft.officialTemplate ? <OfficialTemplateSummaryPanel template={draft} /> : null}

      <div className="editor-section">
        <h3>源数据字段映射</h3>
        <p className="hint-text">把模板需要的字段，绑定到你选择的主表和明细表字段。</p>
        <div className="mapping-list">
          <h4>主表字段</h4>
          {draft.mainFields.map((field) => (
            <label className="mapping-row" key={field.key}>
              <span>{field.key}</span>
              <DataSourceSelect
                id={`main-field-${field.key}`}
                options={mainFieldOptions.map((option) => option.name)}
                value={field.label}
                onChange={(value) => updateMainFieldMapping(field.key, value)}
                placeholder="选择主表字段"
              />
            </label>
          ))}
          <h4>明细字段</h4>
          {draft.itemFields.map((field) => (
            <label className="mapping-row" key={field.key}>
              <span>{field.key}</span>
              <DataSourceSelect
                id={`item-field-${field.key}`}
                options={itemFieldOptions.map((option) => option.name)}
                value={field.label}
                onChange={(value) => updateItemFieldMapping(field.key, value)}
                placeholder="选择明细字段"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="editor-section">
        <h3>模板文字</h3>
        <div className="form-grid">
          <TextSettingInput
            label="公司名称"
            value={text.companyName}
            onChange={(value) => updateText('companyName', value)}
          />
          <TextSettingInput
            label="公司地址"
            multiline
            value={text.companyAddress}
            onChange={(value) => updateText('companyAddress', value)}
          />
          <TextSettingInput
            label="电话邮箱"
            value={text.companyContact}
            onChange={(value) => updateText('companyContact', value)}
          />
          <TextSettingInput
            label="单据标题"
            value={text.documentTitle}
            onChange={(value) => updateText('documentTitle', value)}
          />
          <TextSettingInput
            label="发票号标签"
            value={text.invoiceNoLabel}
            onChange={(value) => updateText('invoiceNoLabel', value)}
          />
          <TextSettingInput
            label="日期标签"
            value={text.dateLabel}
            onChange={(value) => updateText('dateLabel', value)}
          />
          <TextSettingInput
            label="合计标签"
            value={text.totalLabel}
            onChange={(value) => updateText('totalLabel', value)}
          />
          <TextSettingInput
            label="金额大写标签"
            value={text.sayLabel}
            onChange={(value) => updateText('sayLabel', value)}
          />
          <TextSettingInput
            label="付款条款标签"
            value={text.paymentTermsLabel}
            onChange={(value) => updateText('paymentTermsLabel', value)}
          />
          <TextSettingInput
            label="价格条款标签"
            value={text.priceTermsLabel}
            onChange={(value) => updateText('priceTermsLabel', value)}
          />
          <TextSettingInput
            label="生产时间标签"
            value={text.productionTimeLabel}
            onChange={(value) => updateText('productionTimeLabel', value)}
          />
          <TextSettingInput
            label="起运港标签"
            value={text.portOfDepartureLabel}
            onChange={(value) => updateText('portOfDepartureLabel', value)}
          />
          <TextSettingInput
            label="目的港标签"
            value={text.portOfDestinationLabel}
            onChange={(value) => updateText('portOfDestinationLabel', value)}
          />
          <TextSettingInput
            label="银行信息标签"
            value={text.bankInformationLabel}
            onChange={(value) => updateText('bankInformationLabel', value)}
          />
        </div>
      </div>

      <div className="editor-section">
        <h3>明细表头</h3>
        <div className="form-grid form-grid-two">
          {(Object.keys(ITEM_COLUMN_LABELS) as ItemColumnKey[]).map((key) => (
            <TextSettingInput
              key={key}
              label={ITEM_COLUMN_LABELS[key]}
              value={text.itemHeaders[key]}
              onChange={(value) => updateItemHeader(key, value)}
            />
          ))}
        </div>
      </div>

      <div className="editor-section">
        <h3>版式设置</h3>
        <div className="form-grid">
          <label className="field-label" htmlFor="page-mode">
            输出模式
          </label>
          <select
            id="page-mode"
            value={layout.pageMode}
            onChange={(event) => updateLayout('pageMode', event.target.value as PageMode)}
          >
            {Object.entries(PAGE_MODE_LABELS).map(([mode, label]) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grid form-grid-two setting-grid">
          <NumberSettingInput
            label="正文字号 pt"
            min={6}
            max={16}
            step={0.5}
            value={layout.fontSizePt}
            onChange={(value) => updateLayout('fontSizePt', value)}
          />
          <NumberSettingInput
            label="公司标题 pt"
            min={8}
            max={28}
            step={0.5}
            value={layout.headerFontSizePt}
            onChange={(value) => updateLayout('headerFontSizePt', value)}
          />
          <NumberSettingInput
            label="单据标题 pt"
            min={8}
            max={28}
            step={0.5}
            value={layout.titleFontSizePt}
            onChange={(value) => updateLayout('titleFontSizePt', value)}
          />
          <NumberSettingInput
            label="左右边距 mm"
            min={4}
            max={30}
            step={0.5}
            value={layout.pagePaddingXMm}
            onChange={(value) => updateLayout('pagePaddingXMm', value)}
          />
          <NumberSettingInput
            label="上边距 mm"
            min={0}
            max={40}
            step={0.5}
            value={layout.pagePaddingTopMm}
            onChange={(value) => updateLayout('pagePaddingTopMm', value)}
          />
          <NumberSettingInput
            label="下边距 mm"
            min={0}
            max={40}
            step={0.5}
            value={layout.pagePaddingBottomMm}
            onChange={(value) => updateLayout('pagePaddingBottomMm', value)}
          />
          <NumberSettingInput
            label="明细上间距 mm"
            min={0}
            max={30}
            step={0.5}
            value={layout.itemTableGapMm}
            onChange={(value) => updateLayout('itemTableGapMm', value)}
          />
          <NumberSettingInput
            label="汇总上间距 mm"
            min={0}
            max={30}
            step={0.5}
            value={layout.summaryGapMm}
            onChange={(value) => updateLayout('summaryGapMm', value)}
          />
          <NumberSettingInput
            label="银行信息高度 mm"
            min={12}
            max={90}
            step={1}
            value={layout.bankHeightMm}
            onChange={(value) => updateLayout('bankHeightMm', value)}
          />
          <NumberSettingInput
            label="印章上边距 mm"
            min={20}
            max={260}
            step={1}
            value={layout.stampTopMm}
            onChange={(value) => updateLayout('stampTopMm', value)}
          />
          <NumberSettingInput
            label="印章右边距 mm"
            min={0}
            max={80}
            step={1}
            value={layout.stampRightMm}
            onChange={(value) => updateLayout('stampRightMm', value)}
          />
          <NumberSettingInput
            label="印章宽度 mm"
            min={10}
            max={80}
            step={1}
            value={layout.stampWidthMm}
            onChange={(value) => updateLayout('stampWidthMm', value)}
          />
        </div>
      </div>

      <div className="editor-section">
        <div className="panel-heading-row">
          <h3>明细列宽</h3>
          <span className={Math.abs(columnTotal - 100) > 0.5 ? 'column-total-warning' : 'column-total'}>
            合计 {columnTotal.toFixed(1)}%
          </span>
        </div>
        <div className="form-grid form-grid-two setting-grid">
          {(Object.keys(ITEM_COLUMN_LABELS) as ItemColumnKey[]).map((key) => (
            <NumberSettingInput
              key={key}
              label={`${ITEM_COLUMN_LABELS[key]} %`}
              min={3}
              max={70}
              step={0.1}
              value={layout.columnWidths[key]}
              onChange={(value) => updateColumnWidth(key, value)}
            />
          ))}
        </div>
        <p className="hint-text">列宽合计建议保持 100%，也可以临时超出或缩小来试版。</p>
      </div>

      <div className="template-save-state">
        <StatusChip
          label={getDraftTemplateStateLabel(draft)}
          tone={canDraftTemplateRenderAfterSave(draft) ? 'cool' : 'warm'}
        />
        <span>{formatTemplateDate(draft.updatedAt)}</span>
      </div>

      <div className="action-grid action-grid-two panel-actions">
        <button className="action-button" onClick={onCancel} type="button">
          取消
        </button>
        <button className="action-button action-button-accent" onClick={() => onSave(draft)} type="button">
          保存模板
        </button>
      </div>
    </section>
  )
}

function TextSettingInput({
  label,
  multiline = false,
  onChange,
  value,
}: {
  label: string
  multiline?: boolean
  onChange: (value: string) => void
  value: string
}) {
  const id = `setting-${label}`

  return (
    <label className="setting-field" htmlFor={id}>
      <span>{label}</span>
      {multiline ? (
        <textarea id={id} rows={2} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  )
}

function DataSourceSelect({
  id,
  onChange,
  options,
  placeholder,
  value,
}: {
  id: string
  onChange: (value: string) => void
  options: string[]
  placeholder: string
  value: string
}) {
  const listId = `${id}-options`

  return (
    <>
      <input
        id={id}
        list={listId}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  )
}

function NumberSettingInput({
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  step: number
  value: number
}) {
  const id = `setting-${label}`

  return (
    <label className="setting-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        max={max}
        min={min}
        step={step}
        type="number"
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => onChange(Number.parseFloat(event.target.value) || min)}
      />
    </label>
  )
}

function TemplateFieldOverview({ template }: { template: PrintTemplate }) {
  const columnTotal = Object.values(template.printSettings.layout.columnWidths).reduce(
    (total, width) => total + width,
    0,
  )

  return (
    <section className="panel">
      <PanelTitle title="模板字段" />
      <dl className="meta-grid">
        <MetaItem label="单据类型" value={DOCUMENT_KIND_LABELS[template.documentKind]} />
        <MetaItem label="主表" value={template.mainTableName} />
        <MetaItem label="明细表" value={template.itemTableName} />
        <MetaItem label="关联字段" value={template.linkedItemsFieldName} />
        <MetaItem label="输出模式" value={PAGE_MODE_LABELS[template.printSettings.layout.pageMode]} />
        <MetaItem label="字号" value={`${template.printSettings.layout.fontSizePt} pt`} />
        <MetaItem label="列宽合计" value={`${columnTotal.toFixed(1)}%`} />
      </dl>
      <FieldList title="主字段" fields={template.mainFields} />
      <FieldList title="明细字段" fields={template.itemFields} />
      {template.officialTemplate ? <OfficialTemplateFacts template={template} /> : null}
    </section>
  )
}

function OfficialTemplateSummaryPanel({ template }: { template: PrintTemplate }) {
  const officialTemplate = template.officialTemplate
  if (!officialTemplate) {
    return null
  }

  return (
    <div className="editor-section official-template-panel">
      <h3>官方模板解析结果</h3>
      <OfficialTemplateFacts template={template} />
      <p className="hint-text">
        这些字段来自上传的官方模板。主表字段绑定主表，带「/」的字段绑定到动态明细表。
      </p>
    </div>
  )
}

function OfficialTemplateFacts({ template }: { template: PrintTemplate }) {
  const officialTemplate = template.officialTemplate
  if (!officialTemplate) {
    return null
  }

  return (
    <dl className="meta-grid official-template-facts">
      <MetaItem label="来源模板" value={officialTemplate.exportName} />
      <MetaItem label="页面" value={`${officialTemplate.pageCount}`} />
      <MetaItem label="表格" value={`${officialTemplate.tableCount}`} />
      <MetaItem label="动态明细" value={officialTemplate.dynamicRoots.join('、') || '未发现'} />
      <MetaItem label="主表字段" value={`${officialTemplate.mainFieldRefs.length}`} />
      <MetaItem label="明细字段" value={`${officialTemplate.itemFieldRefs.length}`} />
      <MetaItem label="照片/附件" value={`${officialTemplate.attachmentFieldCount}`} />
      <MetaItem label="静态图片" value={`${officialTemplate.staticImageCount}`} />
    </dl>
  )
}

function FieldList({
  fields,
  title,
}: {
  fields: PrintTemplate['mainFields']
  title: string
}) {
  return (
    <div className="field-list-block">
      <h3>{title}</h3>
      {fields.length ? (
        <div className="field-pill-list">
          {fields.map((field) => (
            <span className="field-pill" key={`${field.key}-${field.label}`}>
              {field.label}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted-text">暂未配置字段。</p>
      )}
    </div>
  )
}

function PanelTitle({ title }: { title: string }) {
  return <h2 className="panel-title">{title}</h2>
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
    </>
  )
}

function StatusChip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'cool' | 'warm' }) {
  return <span className={`status-chip status-chip-${tone}`}>{label}</span>
}

function pdfStatusLabel(status: PdfServiceStatus): string {
  if (status === 'online') {
    return '本地打印可用'
  }

  if (status === 'offline') {
    return '本地打印不可用'
  }

  return '检测本地打印'
}

function buildDesignerPayload(
  template: PrintTemplate,
  snapshot: PiSnapshot | null,
  selectedDesignId?: string,
): PiPrintPayload | null {
  if (!template.officialTemplate) {
    return null
  }

  const snapshotDocuments = snapshot?.payload.documents.filter((document) => document.official) ?? []

  return {
    templateId: template.rendererTemplateId || OFFICIAL_LAYOUT_TEMPLATE_ID,
    templateSettings: template.printSettings,
    officialTemplate: template.officialTemplate,
    designOverrides: template.designOverrides,
    designMode: true,
    selectedDesignId,
    generatedAt: new Date().toISOString(),
    source: snapshot?.payload.source ?? {
      baseName: '模板编辑样例',
      tableName: template.mainTableName || '未选择主表',
      viewName: '模板编辑台',
    },
    documents: snapshotDocuments.length ? snapshotDocuments : [createDesignerPlaceholderDocument(template)],
  }
}

function createDesignerPlaceholderDocument(template: PrintTemplate): PiPrintPayload['documents'][number] {
  const officialTemplate = template.officialTemplate
  const fields: Record<string, OfficialPrintValue> = {}
  const itemGroups: Record<string, Record<string, OfficialPrintValue>[]> = {}

  officialTemplate?.mainFieldRefs.forEach((fieldRef) => {
    addDesignerValueAlias(fields, fieldRef, { text: `[${fieldRef}]` })
  })

  ;(officialTemplate?.dynamicRoots ?? []).forEach((root) => {
    const row: Record<string, OfficialPrintValue> = {}
    officialTemplate?.itemFieldRefs
      .filter((fieldRef) => fieldRef === root || fieldRef.startsWith(`${root}/`))
      .forEach((fieldRef) => {
        const leaf = getDesignerLeafFieldName(fieldRef)
        addDesignerValueAlias(row, fieldRef, { text: `[${leaf}]` }, root)
      })
    itemGroups[root] = [row]
  })

  return {
    recordId: 'designer-placeholder',
    title: template.name,
    fields: {
      customerInvoiceTitle: '',
      invoiceNo: template.name,
      invoiceDate: '',
      totalWithCurrency: '',
      sayAmount: '',
      paymentTerms: '',
      priceTerms: '',
      productionTime: '',
      portOfDeparture: '',
      portOfDestination: '',
      bankInformation: '',
    },
    items: [],
    official: {
      fields,
      itemGroups,
    },
  }
}

function addDesignerValueAlias(
  target: Record<string, OfficialPrintValue>,
  fieldRef: string,
  value: OfficialPrintValue,
  root?: string,
) {
  const normalized = fieldRef.replaceAll('.', '/')
  const leaf = getDesignerLeafFieldName(normalized)
  const stripped = root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized
  target[normalized] = value
  target[leaf] = value
  target[stripped] = value
}

function getDesignerLeafFieldName(fieldRef: string): string {
  return fieldRef.split('/').filter(Boolean).at(-1) || fieldRef
}

function collectOfficialTables(template: PrintTemplate): DesignerTableInfo[] {
  const content = template.officialTemplate?.content as
    | { document?: { pages?: { rows?: { columns?: { blocks?: unknown[] }[] }[] }[] } }
    | undefined
  const tables: DesignerTableInfo[] = []

  content?.document?.pages?.forEach((page, pageIndex) => {
    page.rows?.forEach((row, rowIndex) => {
      row.columns?.forEach((column, columnIndex) => {
        column.blocks?.forEach((block, blockIndex) => {
          if (!block || typeof block !== 'object' || !('table' in block)) {
            return
          }

          const table = (block as { table?: { columns?: { width?: number }[] } }).table
          if (!table?.columns?.length) {
            return
          }

          const id = `table:p${pageIndex}-r${rowIndex}-c${columnIndex}-b${blockIndex}`
          tables.push({
            id,
            label: `第 ${tables.length + 1} 个表格`,
            columnWidths: table.columns.map((tableColumn) => tableColumn.width ?? 100 / table.columns!.length),
          })
        })
      })
    })
  })

  return tables
}

function collectOfficialImages(template: PrintTemplate): DesignerImageInfo[] {
  const content = template.officialTemplate?.content as
    | { document?: { pages?: { rows?: { columns?: { blocks?: unknown[] }[] }[] }[] } }
    | undefined
  const images: DesignerImageInfo[] = []

  content?.document?.pages?.forEach((page, pageIndex) => {
    page.rows?.forEach((row, rowIndex) => {
      row.columns?.forEach((column, columnIndex) => {
        column.blocks?.forEach((block, blockIndex) => {
          if (!isOfficialImageBlock(block)) {
            return
          }

          images.push({
            id: `image:p${pageIndex}-r${rowIndex}-c${columnIndex}-b${blockIndex}`,
            label: `第 ${images.length + 1} 张图片`,
            offsetXMm: pxToMmForDesigner(block.position?.x ?? 0),
            offsetYMm: pxToMmForDesigner(block.position?.y ?? 0),
            widthMm: pxToMmForDesigner(block.width ?? 120),
          })
        })
      })
    })
  })

  return images
}

function isOfficialImageBlock(
  block: unknown,
): block is { type?: number; width?: number; position?: { x?: number; y?: number }; imageConfig?: unknown } {
  return Boolean(
    block &&
      typeof block === 'object' &&
      ('imageConfig' in block || ('type' in block && (block as { type?: number }).type === 9)),
  )
}

function pxToMmForDesigner(value: number): number {
  return Number.parseFloat((value * 0.264583).toFixed(2))
}

function getTableIdFromDesignId(designId: string): string {
  if (designId.startsWith('table:')) {
    return designId
  }

  if (designId.startsWith('cell:')) {
    return `table:${designId.slice('cell:'.length).replace(/-row\d+-col\d+$/, '')}`
  }

  return ''
}

function buildPayloadForTemplate(
  payload: PiPrintPayload | null,
  template: PrintTemplate,
): PiPrintPayload | null {
  if (!payload || !template.rendererTemplateId || template.status !== 'ready') {
    return null
  }

  return {
    ...payload,
    templateId: template.rendererTemplateId,
    templateSettings: template.printSettings,
    officialTemplate: template.officialTemplate,
    designOverrides: template.designOverrides,
  }
}

function getTemplateIssues(template: PrintTemplate): ValidationIssue[] {
  if (template.status === 'ready' && template.rendererTemplateId) {
    return []
  }

  return [
    {
      severity: 'blocker',
      code: 'template-not-renderable',
      message: `模板「${template.name}」已保存，但还没有接入 PDF 版式。`,
    },
  ]
}

function canDraftTemplateRenderAfterSave(template: PrintTemplate): boolean {
  if (
    template.rendererTemplateId === OFFICIAL_LAYOUT_TEMPLATE_ID &&
    template.officialTemplate &&
    template.mainTableName.trim() &&
    template.itemTableName.trim() &&
    template.linkedItemsFieldName.trim()
  ) {
    return true
  }

  return Boolean(
    (template.rendererTemplateId === PROFORMA_INVOICE_TEMPLATE_ID &&
      template.documentKind === 'proforma-invoice') ||
      (template.rendererTemplateId === COMMERCIAL_INVOICE_TEMPLATE_ID &&
        template.documentKind === 'commercial-invoice') ||
      (template.rendererTemplateId === PACKING_LIST_TEMPLATE_ID && template.documentKind === 'packing-list'),
  )
}

function getDraftTemplateStateLabel(template: PrintTemplate): string {
  if (template.status === 'ready') {
    return '可打印'
  }

  if (canDraftTemplateRenderAfterSave(template)) {
    return '保存后可打印'
  }

  return '草稿'
}

function formatTemplateDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '未保存'
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('飞书容器连接超时，已切换到本地样例。'))
    }, timeoutMs)

    promise.then(
      (value) => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function createDiagnosticEvent(
  level: DiagnosticEvent['level'],
  message: string,
  detail?: string,
): DiagnosticEvent {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level,
    message,
    detail,
    createdAt: new Date().toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  }
}

function collectRuntimeInfo(): RuntimeInfo {
  return {
    href: window.location.href,
    protocol: window.location.protocol,
    userAgent: window.navigator.userAgent,
    language: window.navigator.language,
    viewport: `${window.innerWidth} x ${window.innerHeight}`,
    secureContext: window.isSecureContext,
    inIframe: window.self !== window.top,
  }
}

function isChromeExtensionRuntime(): boolean {
  return (
    import.meta.env.MODE === 'chrome' ||
    (typeof window !== 'undefined' && window.location.protocol === 'chrome-extension:')
  )
}

function getDataSourceLabel(source?: PiSnapshot['context']['source']): string {
  if (source === 'feishu') {
    return '飞书数据'
  }

  if (source === 'local') {
    return '本地导入'
  }

  if (source === 'mock') {
    return '本地样例'
  }

  return '尚未读取'
}

function shouldUseDemoData(): boolean {
  if (import.meta.env.DEV) {
    return true
  }

  return new URLSearchParams(window.location.search).get('demo') === '1'
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return [error.message, error.stack].filter(Boolean).join('\n')
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return '未知错误'
  }
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Print plugin crashed', error)
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    const runtimeInfo = collectRuntimeInfo()

    return (
      <main className="fatal-diagnostics">
        <section className="panel diagnostics-panel">
          <p className="eyebrow">Bitable Print</p>
          <h1>插件加载异常</h1>
          <p>页面已经打开，但客户端脚本运行失败。请把下面错误信息截图发给我们排查。</p>
          <dl className="meta-grid diagnostics-grid">
            <MetaItem label="错误" value={this.state.error.message} />
            <MetaItem label="页面地址" value={runtimeInfo.href} />
            <MetaItem label="协议" value={runtimeInfo.protocol} />
            <MetaItem label="安全上下文" value={runtimeInfo.secureContext ? '是' : '否'} />
            <MetaItem label="嵌入页面" value={runtimeInfo.inIframe ? '是' : '否'} />
            <MetaItem label="窗口大小" value={runtimeInfo.viewport} />
          </dl>
          <details className="diagnostic-details" open>
            <summary>错误详情</summary>
            <pre>{this.state.error.stack || this.state.error.message}</pre>
          </details>
          <details className="diagnostic-details">
            <summary>浏览器信息</summary>
            <p>{runtimeInfo.userAgent}</p>
          </details>
        </section>
      </main>
    )
  }
}

function AppRoot() {
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  )
}

export default AppRoot
