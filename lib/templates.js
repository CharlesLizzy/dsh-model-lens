/**
 * Common local model services, keyed by the port they usually listen on.
 * A template only supplies presentation defaults; it never overrides explicit
 * user configuration.
 */
export const TEMPLATES = [
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'ollama',
    ports: [11434],
    tag: 'Ollama',
    start: { command: 'ollama', args: ['serve'], timeoutMs: 120000 },
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    kind: 'openai',
    ports: [1234],
    tag: 'LM Studio',
    start: { command: 'lms', args: ['server', 'start'], timeoutMs: 120000 },
  },
  { id: 'vllm', name: 'vLLM', kind: 'openai', ports: [8000], tag: 'vLLM' },
  { id: 'llamacpp', name: 'llama.cpp', kind: 'openai', ports: [8080], tag: 'llama.cpp' },
  {
    id: 'xinference',
    name: 'Xinference',
    kind: 'xinference',
    ports: [9997, 9998],
    tag: '模型',
    start: { command: 'xinference-local', args: ['--host', '127.0.0.1', '--port', '{port}'], timeoutMs: 180000 },
  },
  { id: 'gpt-sovits', name: 'GPT-SoVITS', kind: 'tts', ports: [9880], tag: 'TTS' },
  { id: 'sensevoice', name: 'SenseVoice', kind: 'stt', ports: [10095], tag: 'ASR' },
  { id: 'whisper', name: 'Whisper', kind: 'stt', ports: [9000], tag: 'ASR' },
]

export function templateFor(endpoint) {
  if (!endpoint || !Number.isFinite(Number(endpoint.port))) return null
  return (
    TEMPLATES.find(
      (template) =>
        template.ports.includes(Number(endpoint.port)) &&
        (template.kind === endpoint.kind || endpoint.kind === 'other'),
    ) || null
  )
}

/** Apply non-destructive display defaults to an endpoint. */
export function applyTemplate(endpoint) {
  const template = templateFor(endpoint)
  if (!template) return endpoint
  endpoint.template = template.id
  if (!endpoint.tag) {
    endpoint.tag = template.tag
    endpoint.tagFromTemplate = true
  }
  if (!endpoint.label && !endpoint.model) endpoint.label = template.name
  if (template.kind === 'tts' && !endpoint.model) endpoint.model = template.name
  if (!endpoint.start && !endpoint.startDisabled && template.start) {
    endpoint.start = {
      command: template.start.command,
      args: (template.start.args || []).map((value) => String(value).replace('{port}', String(endpoint.port))),
      cwd: null,
      env: null,
      timeoutMs: template.start.timeoutMs || 180000,
      shell: false,
    }
  }
  return endpoint
}
