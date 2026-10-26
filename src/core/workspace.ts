/** Presentation preferences are separate from project data and undo history. */
export type Workflow = 'design' | 'laser' | 'preview'
export type ProductionTab = 'machine' | 'layers' | 'sim' | 'output' | 'settings'
export type Theme = 'light' | 'dark'
export const WORKSPACE_KEY = 'corelith.workspace.v1'
export const AUTOSAVE_KEY = 'corelith.autosave.v1'
export interface WorkspacePreferences { theme: Theme; leftOpen: boolean; rightOpen: boolean }
export function loadWorkspace(storage?: Pick<Storage, 'getItem'>): WorkspacePreferences {
  const defaults: WorkspacePreferences = { theme: 'light', leftOpen: true, rightOpen: true }
  try {
    const saved = JSON.parse(storage?.getItem(WORKSPACE_KEY) ?? '{}')
    return { theme: saved?.theme === 'dark' ? 'dark' : 'light', leftOpen: typeof saved?.leftOpen === 'boolean' ? saved.leftOpen : true, rightOpen: typeof saved?.rightOpen === 'boolean' ? saved.rightOpen : true }
  } catch { return defaults }
}
export function saveLocalDocument(storage: Pick<Storage,'setItem'>, doc: unknown, savedAt = Date.now()): { ok: true; savedAt: number } | { ok: false; error: string } {
  try { storage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt, doc })); return { ok: true, savedAt } }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Local storage is unavailable' } }
}
export const WORKFLOWS: { id: Workflow; label: string; action: string }[] = [
  { id: 'design', label: 'Design', action: 'Prepare Laser Job' },
  { id: 'laser', label: 'Laser', action: 'Preview Job' },
  { id: 'preview', label: 'Preview & Send', action: 'Upload to Machine' },
]

// Presentation accents do not change artwork colours or exported controller metadata.
export const UI_OPERATION_COLORS = {cut:'#D94B5B',engrave:'#5269C9',score:'#9b6b1b',ignore:'#69727D',dot:'#9b6b1b',pen:'#7c3aed'}
