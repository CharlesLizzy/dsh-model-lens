/**
 * Installs the Model Lens pet action into dsh-pet.
 *
 * This is intentionally separate from the HUD patch: adding an action to the
 * dsh-pet config and asset directory is invasive, so it only happens when the
 * user explicitly runs this installer from the settings page.
 *
 * Idempotent. Re-run after every dsh-pet upgrade.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginDir = dirname(here)
const rawArgs = process.argv.slice(2)
const uninstall = rawArgs.includes('--uninstall')
const args = rawArgs.filter((arg) => arg !== '--uninstall')
const defaultPetDir = process.env.DSH_PROFILE_DIR
  ? join(process.env.DSH_PROFILE_DIR, 'node_modules', 'dsh-pet')
  : null
const petDir = args[0] || defaultPetDir
if (!petDir) {
  console.error('usage: node tools/patch-dsh-pet-action.mjs <path-to-dsh-pet> [--uninstall]')
  console.error('tip: set DSH_PROFILE_DIR, or pass the package directory explicitly')
  process.exit(2)
}
const backupRoot = args[1] || join(homedir(), '.dsh', 'dsh-model-lens-backups')
const configFile = join(petDir, 'assets', 'config.jsonc')
const actionSource = join(pluginDir, 'pet', 'reactions', 'cutscene.webm')
const actionTarget = join(petDir, 'assets', 'webm', '戳戳小圆球.webm')
const ACTION_NAME = '戳戳小圆球'

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

function backup(file) {
  if (!existsSync(file)) return null
  const dir = join(backupRoot, 'dsh-pet-action-' + stamp())
  mkdirSync(dir, { recursive: true })
  const target = join(dir, file.replace(/[\\/:]/g, '_'))
  copyFileSync(file, target)
  return dir
}

if (!existsSync(configFile)) throw new Error('dsh-pet config not found: ' + configFile)
if (!uninstall && !existsSync(actionSource)) throw new Error('action video source not found: ' + actionSource)

const backupDir = backup(configFile)
backup(actionTarget)

let config = readFileSync(configFile, 'utf8')
const before = config
if (uninstall) {
  config = config
    .replace(/,\s*"戳戳小圆球"/g, '')
    .replace(/"戳戳小圆球",\s*/g, '')
} else if (!config.includes('"' + ACTION_NAME + '"')) {
  const anchor = '"晨间刷牙"'
  if (!config.includes(anchor)) throw new Error('anchor not found: 小动作 list')
  config = config.replace(anchor, anchor + ', "' + ACTION_NAME + '"')
}
if (config !== before) writeFileSync(configFile, config, 'utf8')

if (uninstall) {
  if (existsSync(actionTarget)) rmSync(actionTarget, { force: true })
} else {
  copyFileSync(actionSource, actionTarget)
}

console.log('uninstalled=' + uninstall)
console.log('config=' + configFile)
console.log('action=' + actionTarget)
console.log('backup=' + (backupDir || '(none)'))
