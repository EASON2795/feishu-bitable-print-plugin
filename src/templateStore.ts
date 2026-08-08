import { DEFAULT_TEST_TEMPLATE, LINKED_ITEMS_FIELD_NAME, TEMPLATE_REGISTRY } from './piConfig'
import { clonePrintSettings } from './templateDefaults'
import {
  COMMERCIAL_INVOICE_TEMPLATE_ID,
  OFFICIAL_LAYOUT_TEMPLATE_ID,
  PACKING_LIST_TEMPLATE_ID,
  PROFORMA_INVOICE_TEMPLATE_ID,
  PURCHASE_ORDER_TEMPLATE_ID,
  type DocumentKind,
  type PrintTemplate,
} from './types'

const STORAGE_KEY = 'feishu-bitable-print-template-workspace-v1'
const RETIRED_BUILT_IN_TEMPLATE_IDS = new Set<string>([
  COMMERCIAL_INVOICE_TEMPLATE_ID,
  PACKING_LIST_TEMPLATE_ID,
  PURCHASE_ORDER_TEMPLATE_ID,
])

export type TemplateWorkspace = {
  activeTemplateId: string
  customTemplates: PrintTemplate[]
  retiredActiveTemplateId?: string
  recoveredOfficialRendererTemplateIds?: string[]
}

type StoredWorkspace = Partial<TemplateWorkspace>

export function loadTemplateWorkspace(): TemplateWorkspace {
  const fallback = createFallbackWorkspace()

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return fallback
    }

    const parsed = JSON.parse(stored) as StoredWorkspace
    const storedCustomTemplates = Array.isArray(parsed.customTemplates)
      ? parsed.customTemplates.filter(isCustomTemplate)
      : []
    const recoveredOfficialRendererTemplateIds = storedCustomTemplates
      .filter(
        (template) =>
          Boolean(template.officialTemplate) &&
          template.rendererTemplateId !== OFFICIAL_LAYOUT_TEMPLATE_ID,
      )
      .map((template) => template.id)
    const recoveredOfficialRendererTemplateIdSet = new Set(recoveredOfficialRendererTemplateIds)
    const customTemplates = storedCustomTemplates.map((template) =>
      hydrateTemplate(template, recoveredOfficialRendererTemplateIdSet.has(template.id)),
    )
    const storedActiveTemplateId =
      typeof parsed.activeTemplateId === 'string' ? parsed.activeTemplateId : ''
    const hasStoredTemplate = Boolean(
      storedActiveTemplateId && findTemplate(storedActiveTemplateId, customTemplates),
    )
    const storedRetiredActiveTemplateId =
      typeof parsed.retiredActiveTemplateId === 'string' &&
      RETIRED_BUILT_IN_TEMPLATE_IDS.has(parsed.retiredActiveTemplateId)
        ? parsed.retiredActiveTemplateId
        : undefined
    const retiredActiveTemplateId =
      storedRetiredActiveTemplateId ??
      (!hasStoredTemplate && RETIRED_BUILT_IN_TEMPLATE_IDS.has(storedActiveTemplateId)
        ? storedActiveTemplateId
        : undefined)

    return {
      activeTemplateId: hasStoredTemplate ? storedActiveTemplateId : fallback.activeTemplateId,
      customTemplates,
      retiredActiveTemplateId,
      recoveredOfficialRendererTemplateIds: recoveredOfficialRendererTemplateIds.length
        ? recoveredOfficialRendererTemplateIds
        : undefined,
    }
  } catch {
    return fallback
  }
}

export function saveTemplateWorkspace(workspace: TemplateWorkspace) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      activeTemplateId: workspace.activeTemplateId,
      customTemplates: workspace.customTemplates,
      retiredActiveTemplateId: workspace.retiredActiveTemplateId,
    }),
  )
}

export function removeCustomTemplate(
  workspace: TemplateWorkspace,
  templateId: string,
): TemplateWorkspace {
  const template = workspace.customTemplates.find((current) => current.id === templateId)
  if (!template || template.isBuiltIn) {
    return workspace
  }

  const customTemplates = workspace.customTemplates.filter((current) => current.id !== templateId)
  const activeTemplateId =
    workspace.activeTemplateId === templateId
      ? DEFAULT_TEST_TEMPLATE.id
      : workspace.activeTemplateId

  return {
    ...workspace,
    activeTemplateId,
    customTemplates,
  }
}

export function mergeTemplates(customTemplates: PrintTemplate[]): PrintTemplate[] {
  return [...TEMPLATE_REGISTRY, ...customTemplates]
}

export function createBlankTemplate(): PrintTemplate {
  const now = new Date().toISOString()

  return {
    id: makeTemplateId('custom-template'),
    name: '新单据模板',
    documentKind: 'commercial-invoice',
    description: '',
    status: 'draft',
    isBuiltIn: false,
    mainTableName: '',
    itemTableName: '',
    linkedItemsFieldName: LINKED_ITEMS_FIELD_NAME,
    mainFields: [],
    itemFields: [],
    printSettings: clonePrintSettings(),
    createdAt: now,
    updatedAt: now,
  }
}

export function copyTemplate(template: PrintTemplate): PrintTemplate {
  const now = new Date().toISOString()

  return {
    ...template,
    id: makeTemplateId(template.documentKind),
    name: `${template.name} 副本`,
    isBuiltIn: false,
    officialTemplate: cloneOfficialTemplate(template.officialTemplate),
    designOverrides: cloneDesignOverrides(template.designOverrides),
    printSettings: clonePrintSettings(template.printSettings),
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizeTemplateForSave(template: PrintTemplate): PrintTemplate {
  const now = new Date().toISOString()
  const name = template.name.trim() || '未命名单据模板'
  const documentKind: DocumentKind = template.documentKind
  const hasOfficialTemplate = Boolean(template.officialTemplate)
  const canUseOfficialRenderer = hasOfficialTemplate && hasCompleteDataSourceBinding(template)
  const canUseExistingRenderer =
    (template.rendererTemplateId === PROFORMA_INVOICE_TEMPLATE_ID && documentKind === 'proforma-invoice') ||
    (template.rendererTemplateId === COMMERCIAL_INVOICE_TEMPLATE_ID && documentKind === 'commercial-invoice') ||
    (template.rendererTemplateId === PACKING_LIST_TEMPLATE_ID && documentKind === 'packing-list')
  const canRender = canUseOfficialRenderer || canUseExistingRenderer
  const rendererTemplateId = hasOfficialTemplate
    ? OFFICIAL_LAYOUT_TEMPLATE_ID
    : canUseExistingRenderer
      ? template.rendererTemplateId
      : undefined

  return {
    ...template,
    name,
    documentKind,
    description: template.description.trim(),
    isBuiltIn: false,
    rendererTemplateId,
    status: canRender ? 'ready' : 'draft',
    mainTableName: template.mainTableName.trim(),
    itemTableName: template.itemTableName.trim(),
    linkedItemsFieldName:
      template.linkedItemsFieldName.trim() ||
      (hasOfficialTemplate ? '' : LINKED_ITEMS_FIELD_NAME),
    officialTemplate: cloneOfficialTemplate(template.officialTemplate),
    designOverrides: cloneDesignOverrides(template.designOverrides),
    printSettings: clonePrintSettings(template.printSettings),
    updatedAt: now,
  }
}

function hydrateTemplate(template: PrintTemplate, requiresSchemaValidation = false): PrintTemplate {
  const officialTemplate = cloneOfficialTemplate(template.officialTemplate)
  return {
    ...template,
    status: officialTemplate
      ? requiresSchemaValidation
        ? 'draft'
        : template.status
      : template.status,
    rendererTemplateId: officialTemplate
      ? OFFICIAL_LAYOUT_TEMPLATE_ID
      : template.rendererTemplateId,
    officialTemplate,
    designOverrides: cloneDesignOverrides(template.designOverrides),
    printSettings: clonePrintSettings(template.printSettings),
  }
}

function hasCompleteDataSourceBinding(template: PrintTemplate): boolean {
  return Boolean(
    typeof template.mainTableName === 'string' &&
      template.mainTableName.trim() &&
      typeof template.itemTableName === 'string' &&
      template.itemTableName.trim() &&
      typeof template.linkedItemsFieldName === 'string' &&
      template.linkedItemsFieldName.trim(),
  )
}

function createFallbackWorkspace(): TemplateWorkspace {
  return {
    activeTemplateId: DEFAULT_TEST_TEMPLATE.id,
    customTemplates: [],
  }
}

function findTemplate(templateId: string, customTemplates: PrintTemplate[]): PrintTemplate | undefined {
  return mergeTemplates(customTemplates).find((template) => template.id === templateId)
}

function isCustomTemplate(value: unknown): value is PrintTemplate {
  if (!value || typeof value !== 'object') {
    return false
  }

  const template = value as PrintTemplate
  return (
    typeof template.id === 'string' &&
    typeof template.name === 'string' &&
    typeof template.documentKind === 'string' &&
    template.isBuiltIn === false
  )
}

function makeTemplateId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  return `${prefix}-${random}`
}

function cloneOfficialTemplate(template: PrintTemplate['officialTemplate']) {
  if (!template) {
    return undefined
  }

  return structuredClone(template)
}

function cloneDesignOverrides(overrides: PrintTemplate['designOverrides']) {
  if (!overrides) {
    return undefined
  }

  return structuredClone(overrides)
}
