import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

export const DEFAULT_PREFS = {
  theme: 'pet',
  fontScale: 'auto',
  width: 260,
  anchor: 'left',
  offsetX: 0,
  offsetY: 50,
  maxRows: 6,
  allowServiceControl: false,
  allowExternalStop: false,
}

export const THEMES = ['pet', 'light', 'dark']

export function prefsPath() {
  return join(homedir(), '.dsh', 'dsh-model-lens.json')
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function normalizePrefs(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const theme = THEMES.includes(source.theme) ? source.theme : DEFAULT_PREFS.theme
  let fontScale = DEFAULT_PREFS.fontScale
  if (source.fontScale !== 'auto' && Number.isFinite(Number(source.fontScale))) {
    fontScale = Math.round(clamp(Number(source.fontScale), 11, 18))
  }
  const width = Math.round(clamp(Number(source.width) || DEFAULT_PREFS.width, 180, 360))
  const anchor = source.anchor === 'right' ? 'right' : 'left'
  const offsetX = Math.round(clamp(Number(source.offsetX) || 0, -400, 400))
  const offsetY = Math.round(clamp(Number(source.offsetY) || 0, -400, 400))
  const maxRows = Math.round(clamp(Number(source.maxRows) || DEFAULT_PREFS.maxRows, 3, 12))
  const allowServiceControl = source.allowServiceControl === true
  const allowExternalStop = source.allowExternalStop === true
  return { theme, fontScale, width, anchor, offsetX, offsetY, maxRows, allowServiceControl, allowExternalStop }
}

export async function readPrefs() {
  try {
    return normalizePrefs(JSON.parse(await readFile(prefsPath(), 'utf8')))
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export async function writePrefs(raw) {
  const prefs = normalizePrefs(raw)
  const file = prefsPath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(prefs, null, 2) + '\n', 'utf8')
  return prefs
}
