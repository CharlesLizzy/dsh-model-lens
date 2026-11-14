const DEFAULT_PORTS = [11434, 1234, 8000, 8080, 9997, 9998, 10095, 9880, 7860, 5000]

async function getJson(url, timeoutMs = 500) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return response.json()
}

async function getText(url, timeoutMs = 600) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return response.text()
}

async function classify(port) {
  const origin = `http://127.0.0.1:${port}`
  try {
    const tags = await getJson(origin + '/api/tags')
    if (tags && Array.isArray(tags.models)) {
      return { id: `scan-ollama-${port}`, kind: 'ollama', base: origin, origin, model: null, source: 'scan' }
    }
  } catch {}
  try {
    const metrics = await getText(origin + '/metrics')
    if (metrics.includes('xinference:model_info')) {
      return { id: `scan-xinference-${port}`, kind: 'xinference', base: origin, origin, model: null, source: 'scan' }
    }
  } catch {}
  try {
    const health = await getJson(origin + '/health')
    if (health && typeof health.model === 'string') {
      return { id: `scan-stt-${port}`, kind: 'stt', base: origin, origin, model: health.model, source: 'scan' }
    }
  } catch {}
  try {
    const spec = await getJson(origin + '/openapi.json')
    const paths = spec && spec.paths && typeof spec.paths === 'object' ? Object.keys(spec.paths) : []
    if (paths.some((path) => path === '/tts' || path.startsWith('/tts/'))) {
      const isGsv = paths.includes('/set_gpt_weights') || paths.includes('/set_sovits_weights')
      const title = spec && spec.info ? spec.info.title : null
      const model = isGsv
        ? 'GPT-SoVITS'
        : typeof title === 'string' && title !== '' && !/^fastapi$/i.test(title)
          ? title
          : null
      return { id: `scan-tts-${port}`, kind: 'tts', base: origin, origin, model, source: 'scan' }
    }
  } catch {}
  try {
    const models = await getJson(origin + '/v1/models')
    if (models && Array.isArray(models.data)) {
      return { id: `scan-openai-${port}`, kind: 'openai', base: origin + '/v1', origin, model: null, source: 'scan' }
    }
  } catch {}
  return null
}

/**
 * Probe common local-inference ports. Runs in parallel with a short timeout;
 * callers cache the result so the HUD poll stays cheap.
 */
export async function scanLocalServices(ports = DEFAULT_PORTS) {
  const results = await Promise.all(ports.map((port) => classify(port).catch(() => null)))
  return results.filter(Boolean)
}
