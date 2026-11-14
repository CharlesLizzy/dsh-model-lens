import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const run = promisify(execFile)
const NVIDIA_INTERVAL = 2_500
// Windows 上这套探测要拉起 PowerShell 查 WMI，一次 1 秒出头，间隔给长一点。
const AMD_INTERVAL = 15_000

function cpuSnapshot() {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    for (const value of Object.values(cpu.times)) total += value
    idle += cpu.times.idle
  }
  return { idle, total }
}

async function readText(path) {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return null
  }
}

async function readNumber(path) {
  const text = await readText(path)
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

async function readAmdTemp(devicePath) {
  const hwmonRoot = join(devicePath, 'hwmon')
  const entries = await readdir(hwmonRoot).catch(() => [])
  for (const entry of entries) {
    if (!/^hwmon\d+$/.test(entry)) continue
    const value = await readNumber(join(hwmonRoot, entry, 'temp1_input'))
    if (value !== null && value > 0) return Math.round(value / 1000)
  }
  return null
}

async function sampleAmdLinux() {
  const drmRoot = '/sys/class/drm'
  const entries = await readdir(drmRoot).catch(() => [])
  const rows = []
  for (const entry of entries) {
    if (!/^card\d+$/.test(entry)) continue
    const device = join(drmRoot, entry, 'device')
    const vendor = await readText(join(device, 'vendor'))
    if (!vendor || vendor.toLowerCase() !== '0x1002') continue
    const totalBytes = await readNumber(join(device, 'mem_info_vram_total'))
    if (totalBytes === null || totalBytes <= 0) continue
    const usedBytes = (await readNumber(join(device, 'mem_info_vram_used'))) || 0
    const util = (await readNumber(join(device, 'gpu_busy_percent'))) || 0
    const name = (await readText(join(device, 'product_name'))) || `AMD GPU ${entry.slice(4)}`
    if (/Radeon.*Graphics|Vega.*Graphics/i.test(name)) continue
    rows.push({
      index: Number(entry.slice(4)),
      name,
      util: Math.round(util),
      memUsedMb: Math.round(usedBytes / 1048576),
      memTotalMb: Math.round(totalBytes / 1048576),
      tempC: await readAmdTemp(device),
    })
  }
  return rows
}

// amd-smi 给的是 { value, unit }，rocm-smi 给的是数字字符串，两种都收。
function unwrapNumber(value) {
  const raw = value && typeof value === 'object' ? value.value : value
  const number = Number(raw)
  return Number.isFinite(number) ? number : null
}

function toMb(value) {
  const number = unwrapNumber(value)
  if (number === null || number <= 0) return null
  return Math.round(number > 1_000_000 ? number / 1048576 : number)
}

function amdMetricRows(data) {
  let list = data && (data.gpu_data || data.gpuData || data)
  if (!Array.isArray(list)) list = list && typeof list === 'object' ? Object.values(list) : []
  const rows = []
  list.forEach((item, fallbackIndex) => {
    if (!item || typeof item !== 'object') return
    const metrics = item.gpu_metrics || item.metrics || item
    const memory = metrics.mem_usage || metrics.memory_usage || metrics.mem_info || {}
    const totalMb = toMb(
      memory.total_vram ?? memory.total ??
      metrics.mem_total ?? metrics.vram_total ?? item.mem_total,
    )
    if (!totalMb) return
    const usedMb = Math.min(
      totalMb,
      toMb(
        memory.used_vram ?? memory.used ??
        metrics.mem_used ?? metrics.vram_used ?? item.mem_used,
      ) || 0,
    )
    const usage = metrics.usage && typeof metrics.usage === 'object' ? metrics.usage : {}
    const util = unwrapNumber(
      usage.gfx_activity ?? usage.gpu_activity ??
      metrics.gfx_activity ?? metrics.gpu_activity ?? metrics.utilization,
    )
    const rawTemp = metrics.temperature
    let temp = unwrapNumber(
      rawTemp && typeof rawTemp === 'object'
        ? rawTemp.edge ?? rawTemp.hotspot ?? rawTemp.junction
        : rawTemp,
    )
    if (temp !== null && temp > 200) temp = Math.round(temp / 1000)
    const index = Number(item.gpu ?? item.gpu_id ?? item.index ?? fallbackIndex)
    rows.push({
      index: Number.isFinite(index) ? index : fallbackIndex,
      name: item.name || item.gpu_name || item.asic?.marketing_name || `AMD GPU ${fallbackIndex}`,
      util: Math.max(0, Math.min(100, Math.round(util ?? 0))),
      memUsedMb: usedMb,
      memTotalMb: totalMb,
      tempC: temp,
    })
  })
  return rows
}

function rocmMetricRows(data) {
  const rows = []
  for (const [key, card] of Object.entries(data || {})) {
    if (!/^card\d+$/.test(key) || !card || typeof card !== 'object') continue
    const totalMb = toMb(card['VRAM Total Memory (B)'])
    if (!totalMb) continue
    const usedMb = Math.min(totalMb, toMb(card['VRAM Total Used Memory (B)']) || 0)
    const util = Number(card['GPU use (%)'] ?? 0)
    const temp = Number(card['Temperature (Sensor edge) (C)'] ?? card['Temperature (Sensor junction) (C)'])
    rows.push({
      index: Number(key.slice(4)),
      name: card['Card series'] || `AMD GPU ${key.slice(4)}`,
      util: Math.max(0, Math.min(100, Math.round(Number.isFinite(util) ? util : 0))),
      memUsedMb: usedMb,
      memTotalMb: totalMb,
      tempC: Number.isFinite(temp) ? temp : null,
    })
  }
  return rows
}

export function parseAmdSmiOutput(stdout) {
  let data
  try {
    data = JSON.parse(String(stdout || '').replace(/^\uFEFF/, '').trim())
  } catch {
    return []
  }
  const rows = amdMetricRows(data)
  return rows.length > 0 ? rows : rocmMetricRows(data)
}

async function sampleAmdSmi() {
  const commands = [
    ['amd-smi', ['metric', '--json']],
    ['rocm-smi', ['--showuse', '--showmeminfo', 'vram', '--showtemp', '--json']],
  ]
  for (const [command, args] of commands) {
    try {
      const { stdout } = await run(command, args, {
        timeout: 4_000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      })
      const rows = parseAmdSmiOutput(stdout)
      if (rows.length > 0) return rows
    } catch (error) {
      const rows = parseAmdSmiOutput(error?.stdout)
      if (rows.length > 0) return rows
    }
  }
  return []
}

const WINDOWS_AMD_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$controllers = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'AMD|Radeon|Advanced Micro Devices' -and $_.Name -notmatch 'Radeon\\(TM\\) Graphics|Radeon Graphics|Vega.*Graphics' })",
  "if ($controllers.Count -eq 0) { Write-Output '{\"ok\":false}'; exit 0 }",
  "$engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -match 'engtype_(3D|Compute)' })",
  "$memory = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory)",
  // 只认与这块 AMD 卡 DriverDesc 一致的注册表项：以前取全系统最大值，双显卡
  // 机器上会把别家的显存当成 AMD 的。读不到就不给总数，让上层整行不显示。
  "$total = $null",
  "$keys = @(Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' | Where-Object { $_.PSChildName -match '^\\d{4}$' })",
  "foreach ($key in $keys) { $props = Get-ItemProperty $key.PSPath -Name 'DriverDesc','HardwareInformation.qwMemorySize' -ErrorAction SilentlyContinue; if ($props.DriverDesc -eq $controllers[0].Name -and $props.'HardwareInformation.qwMemorySize') { $total = [uint64]$props.'HardwareInformation.qwMemorySize' } }",
  "$util = ($engines | ForEach-Object { [double]$_.UtilizationPercentage } | Measure-Object -Maximum).Maximum",
  "$memUsed = ($memory | ForEach-Object { [double]$_.DedicatedUsage } | Measure-Object -Sum).Sum",
  "[pscustomobject]@{ ok=$true; name=$controllers[0].Name; util=$util; memUsed=$memUsed; memTotal=$total } | ConvertTo-Json -Compress",
].join('\n')

export function parseAmdWindowsOutput(stdout) {
  let data
  try {
    data = JSON.parse(String(stdout || '').replace(/^\uFEFF/, '').trim())
  } catch {
    return []
  }
  if (!data || data.ok !== true) return []
  const totalMb = Math.round(Number(data.memTotal) / 1048576)
  if (!Number.isFinite(totalMb) || totalMb <= 0) return []
  return [
    {
      index: 0,
      name: typeof data.name === 'string' && data.name ? data.name : 'AMD GPU',
      util: Math.max(0, Math.min(100, Math.round(Number(data.util) || 0))),
      memUsedMb: Math.max(0, Math.round(Number(data.memUsed) / 1048576) || 0),
      memTotalMb: totalMb,
      tempC: null,
    },
  ]
}

async function sampleAmdWindows() {
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_AMD_SCRIPT],
      { timeout: 6_000, windowsHide: true, maxBuffer: 1024 * 1024 },
    )
    return parseAmdWindowsOutput(stdout)
  } catch {
    return []
  }
}

async function sampleNvidia() {
  try {
    const { stdout } = await run(
      'nvidia-smi',
      [
        '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu',
        '--format=csv,noheader,nounits',
      ],
      { timeout: 1_800, windowsHide: true },
    )
    const rows = []
    for (const line of stdout.split('\n')) {
      const parts = line.split(',').map((part) => part.trim())
      if (parts.length < 6) continue
      const memTotalMb = Number(parts[4])
      if (!Number.isFinite(memTotalMb) || memTotalMb <= 0) continue
      rows.push({
        index: Number(parts[0]),
        name: parts[1],
        util: Number(parts[2]),
        memUsedMb: Number(parts[3]),
        memTotalMb,
        tempC: Number(parts[5]),
      })
    }
    return rows
  } catch {
    return []
  }
}

export class ResourceSampler {
  constructor(options = {}) {
    this.gpuEnabled = options.gpu !== false
    this.prev = cpuSnapshot()
    this.gpu = []
    this.gpuAt = 0
    this.gpuBusy = false
    this.gpuBackend = null
    this.gpuInterval = NVIDIA_INTERVAL
  }

  async detectGpu() {
    const nvidia = await sampleNvidia()
    if (nvidia.length > 0) {
      this.gpuBackend = 'nvidia'
      this.gpuInterval = NVIDIA_INTERVAL
      this.gpu = nvidia
      return
    }
    const amdSmi = await sampleAmdSmi()
    if (amdSmi.length > 0) {
      this.gpuBackend = 'amd-smi'
      this.gpuInterval = AMD_INTERVAL
      this.gpu = amdSmi
      return
    }
    if (process.platform === 'linux') {
      const amd = await sampleAmdLinux()
      if (amd.length > 0) {
        this.gpuBackend = 'amd-sysfs'
        this.gpuInterval = AMD_INTERVAL
        this.gpu = amd
        return
      }
    } else if (process.platform === 'win32') {
      const amd = await sampleAmdWindows()
      if (amd.length > 0) {
        this.gpuBackend = 'amd-windows'
        this.gpuInterval = AMD_INTERVAL
        this.gpu = amd
        return
      }
    }
    this.gpuBackend = 'none'
    this.gpu = []
  }

  async sampleGpu() {
    if (this.gpuBackend === 'nvidia') return sampleNvidia()
    if (this.gpuBackend === 'amd-smi') return sampleAmdSmi()
    if (this.gpuBackend === 'amd-sysfs') return sampleAmdLinux()
    if (this.gpuBackend === 'amd-windows') return sampleAmdWindows()
    return []
  }

  async refreshGpu(now) {
    if (!this.gpuEnabled || this.gpuBusy) return
    if (this.gpuBackend === 'none') return
    this.gpuBusy = true
    try {
      if (this.gpuBackend === null) {
        await this.detectGpu()
        this.gpuAt = now
      } else if (now - this.gpuAt >= this.gpuInterval) {
        this.gpu = await this.sampleGpu()
        this.gpuAt = now
      }
    } catch {
      this.gpu = []
      this.gpuAt = now
    } finally {
      this.gpuBusy = false
    }
  }

  sample() {
    const current = cpuSnapshot()
    const totalDelta = current.total - this.prev.total
    const idleDelta = current.idle - this.prev.idle
    this.prev = current
    const cpuPct = totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : 0
    const memTotal = os.totalmem()
    const memFree = os.freemem()
    return {
      cpuPct: Math.round(cpuPct),
      memUsedMb: Math.round((memTotal - memFree) / 1048576),
      memTotalMb: Math.round(memTotal / 1048576),
      gpu: this.gpu,
      gpuBackend: this.gpuBackend,
      dshRssMb: Math.round(process.memoryUsage().rss / 1048576),
    }
  }
}
