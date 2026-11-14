window.__ModuleLoader__.load({
  id: 'dsh-model-lens',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-model-lens/api/prefs'

    const CSS = [
      '.lens-wrap{max-width:720px;display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.lens-section{display:flex;flex-direction:column;gap:14px;min-width:0}',
      '.lens-tabs{display:inline-flex;align-self:flex-start;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}',
      '.lens-tabs button{background:transparent;color:inherit;border:0;padding:4px 16px;font:inherit;font-size:12.5px;cursor:pointer}',
      '.lens-tabs button.on{background:var(--dsw-alias-brand-primary);color:#fff}',
      '.lens-head{display:flex;flex-direction:column;gap:4px}',
      '.lens-title{font-size:15px;font-weight:650}',
      '.lens-sub{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}',
      '.lens-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}',
      '.lens-row{display:grid;grid-template-columns:132px minmax(0,1fr);gap:12px;align-items:center}',
      '.lens-label{color:var(--dsw-alias-label-secondary);font-size:12.5px}',
      '.lens-control{display:flex;align-items:center;gap:10px;min-width:0}',
      '.lens-select,.lens-number{background:transparent;color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 8px;font:inherit;min-width:120px}',
      '.lens-range{flex:1;accent-color:var(--dsw-alias-brand-primary);min-width:120px}',
      '.lens-value{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;min-width:52px;text-align:right}',
      '.lens-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}',
      '.lens-seg button{background:transparent;color:inherit;border:0;padding:4px 14px;font:inherit;cursor:pointer}',
      '.lens-seg button.on{background:var(--dsw-alias-brand-primary);color:#fff}',
      '.lens-actions{display:flex;align-items:center;gap:12px}',
      '.lens-btn{background:var(--dsw-alias-brand-primary);color:#fff;border:0;border-radius:8px;padding:6px 16px;font:inherit;cursor:pointer}',
      '.lens-btn:disabled{opacity:.55;cursor:default}',
      '.lens-btn.danger{background:var(--dsw-alias-state-error-primary)}',
      '.lens-status{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.lens-status.ok{color:var(--dsw-alias-state-success-primary)}',
      '.lens-status.err{color:var(--dsw-alias-state-error-primary)}',
      '.lens-check{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}',
      '.lens-note{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.6}',
      '.mon-add{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.mon-list{display:flex;flex-direction:column;gap:8px}',
      '.mon-row{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:9px 11px;display:flex;flex-direction:column;gap:8px}',
      '.mon-head{display:flex;align-items:center;gap:9px;min-width:0}',
      '.mon-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}',
      '.mon-dot.active{background:var(--dsw-alias-state-success-primary)}',
      '.mon-dot.offline{background:var(--dsw-alias-state-error-primary)}',
      '.mon-dot.loading{background:var(--dsw-alias-state-warn-primary)}',
      '.mon-main{flex:1;min-width:0}',
      '.mon-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.mon-meta{color:var(--dsw-alias-label-secondary);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.mon-actions{display:flex;gap:8px;flex:none}',
      '.mon-btn{background:transparent;color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:3px 9px;font:inherit;font-size:12px;cursor:pointer}',
      '.mon-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.mon-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.mon-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) minmax(0,1fr) 90px auto;gap:8px;align-items:center}',
      '.mon-form input{background:transparent;color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:4px 8px;font:inherit;min-width:0}',
      '.mon-pending{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;display:inline-flex;align-items:center;gap:4px}',
      '.mon-pending::before{content:"";width:8px;height:8px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:lens-spin .8s linear infinite}',
      '@keyframes lens-spin{to{transform:rotate(360deg)}}',
      '.mon-tag{flex:none;font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-radius:4px;padding:0 5px}',
      '.mon-empty{color:var(--dsw-alias-label-secondary);font-size:12px;padding:6px 0}',
    ].join('')

    let styled = false
    function ensureStyle() {
      if (styled || typeof document === 'undefined') return
      const el = document.createElement('style')
      el.setAttribute('data-dsh-model-lens', '')
      el.textContent = CSS
      document.head.appendChild(el)
      styled = true
    }

    function Row(props) {
      return h('div', { className: 'lens-row' },
        h('div', { className: 'lens-label' }, props.label),
        h('div', { className: 'lens-control' }, props.children))
    }

    function Select(props) {
      return h('select', {
        className: 'lens-select',
        value: props.value,
        onChange: (e) => props.onChange(e.target.value),
      }, props.options.map((option) => h('option', { key: option.value, value: option.value }, option.label)))
    }

    function Page(props) {
      const embedded = props?.embedded === true
      const [prefs, setPrefs] = React.useState(null)
      const [status, setStatus] = React.useState({ kind: '', text: '' })
      const [saving, setSaving] = React.useState(false)
      const [hudStatus, setHudStatus] = React.useState(null)
      const [hudMessage, setHudMessage] = React.useState('')
      const [patching, setPatching] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        fetch(API, { cache: 'no-store' })
          .then((r) => r.json())
          .then((data) => { if (alive && data && data.prefs) setPrefs(data.prefs) })
          .catch((error) => { if (alive) setStatus({ kind: 'err', text: '读取设置失败：' + String(error) }) })
        return () => { alive = false }
      }, [])

      React.useEffect(() => {
        let alive = true
        fetch('/dsh-model-lens/api/pet-patch', { cache: 'no-store' })
          .then((response) => response.json())
          .then((data) => { if (alive && data && data.status) setHudStatus(data.status) })
          .catch(() => { if (alive) setHudStatus({ installed: false, active: false }) })
        return () => { alive = false }
      }, [])

      async function runHudPatch(action = 'install') {
        setPatching(true)
        setHudMessage('')
        try {
          const response = await fetch('/dsh-model-lens/api/pet-patch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action }),
          })
          const data = await response.json()
          if (!response.ok || !data.ok) throw new Error(data.error || 'HTTP ' + response.status)
          setHudStatus(data.status)
          setHudMessage(
            action === 'uninstall'
              ? '卸载补丁已写入，重启 DSH 或重载桌宠后状态卡消失。'
              : data.status?.active
                ? '状态卡已激活。'
                : '补丁已写入，重启 DSH 后生效。'
          )
        } catch (error) {
          setHudMessage('操作失败：' + String(error.message || error))
        } finally {
          setPatching(false)
        }
      }

      function patch(key, value) {
        setPrefs((current) => ({ ...current, [key]: value }))
        setStatus({ kind: '', text: '' })
      }

      async function save() {
        setSaving(true)
        setStatus({ kind: '', text: '保存中…' })
        try {
          const response = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(prefs),
          })
          const data = await response.json()
          if (!response.ok || !data.ok) throw new Error(data.error || 'HTTP ' + response.status)
          setPrefs(data.prefs)
          setStatus({ kind: 'ok', text: '已保存，桌宠卡片会在 1–2 秒内更新' })
        } catch (error) {
          setStatus({ kind: 'err', text: '保存失败：' + String(error.message || error) })
        } finally {
          setSaving(false)
        }
      }

      if (!prefs) {
        return h('div', { className: embedded ? 'lens-section' : 'lens-wrap' },
          embedded ? null : h('div', { className: 'lens-title' }, '界面配置'),
          h('div', { className: 'lens-sub' }, status.text || '读取设置…'))
      }

      const followFont = prefs.fontScale === 'auto'

      return h('div', { className: embedded ? 'lens-section' : 'lens-wrap' },
        embedded ? null : h('div', { className: 'lens-head' },
          h('div', { className: 'lens-title' }, '界面配置'),
          h('div', { className: 'lens-sub' }, '控制桌宠旁卡片的主题、字号、宽度和位置。修改后点保存，卡片会即时刷新。')),
        h('div', { className: 'lens-card' },
          h('div', { className: 'lens-row' },
            h('div', { className: 'lens-label' }, '状态卡'),
            h('div', { className: 'lens-control' },
              h('span', { className: 'lens-status ' + (hudStatus === null ? '' : hudStatus.active ? 'ok' : 'err') },
                hudStatus === null ? '检测中…' : hudStatus.active ? '已激活' : '未激活'))),
          hudStatus
            ? h('div', { className: 'lens-actions' },
                h('button', {
                  className: 'lens-btn' + (hudStatus.active ? ' danger' : ''),
                  disabled: patching || hudStatus.installed === false,
                  onClick: () => runHudPatch(hudStatus.active ? 'uninstall' : 'install'),
                }, patching ? '写入中…' : hudStatus.active ? '运行卸载补丁' : '运行激活补丁'))
            : null,
          h('div', { className: 'lens-note' },
            hudMessage ||
              (hudStatus?.active
                ? '状态卡与“戳戳小圆球”动作已接通；补丁刚写入时重载桌宠后生效。'
                : hudStatus?.installed === false
                  ? '未检测到 dsh-pet；不装 dsh-pet 时状态卡和动作都不会显示。'
                  : '补丁会同时写入状态卡与“戳戳小圆球”动作，需要重启 DSH 或重载桌宠后生效。'))),
        h('div', { className: 'lens-card' },
          h(Row, { label: '主题' },
            h(Select, {
              value: prefs.theme,
              onChange: (value) => patch('theme', value),
              options: [
                { value: 'pet', label: '跟随桌宠（气泡白）' },
                { value: 'light', label: '浅色' },
                { value: 'dark', label: '深色' },
              ],
            })),
          h(Row, { label: '字号' },
            h('input', {
              className: 'lens-number',
              type: 'number', min: 11, max: 18, step: 1,
              disabled: followFont,
              value: followFont ? '' : prefs.fontScale,
              placeholder: followFont ? '自动' : '',
              onChange: (e) => patch('fontScale', Math.max(11, Math.min(18, Number(e.target.value) || 13))),
            }),
            h('label', { className: 'lens-check' },
              h('input', {
                type: 'checkbox',
                checked: followFont,
                onChange: (e) => patch('fontScale', e.target.checked ? 'auto' : 13),
              }),
              '跟随桌宠')),
          h(Row, { label: '窗口宽度' },
            h('input', {
              className: 'lens-range',
              type: 'range', min: 180, max: 360, step: 10,
              value: prefs.width,
              onChange: (e) => patch('width', Number(e.target.value)),
            }),
            h('span', { className: 'lens-value' }, prefs.width + ' px')),
          h(Row, { label: '窗口位置' },
            h('div', { className: 'lens-seg' },
              h('button', {
                className: prefs.anchor === 'left' ? 'on' : '',
                onClick: () => patch('anchor', 'left'),
              }, '宠物左侧'),
              h('button', {
                className: prefs.anchor === 'right' ? 'on' : '',
                onClick: () => patch('anchor', 'right'),
              }, '宠物右侧'))),
          h(Row, { label: '水平偏移' },
            h('input', {
              className: 'lens-number',
              type: 'number', min: -200, max: 200, step: 4,
              value: prefs.offsetX,
              onChange: (e) => patch('offsetX', Number(e.target.value) || 0),
            }),
            h('span', { className: 'lens-note' }, '正值向右')),
          h(Row, { label: '垂直偏移' },
            h('input', {
              className: 'lens-number',
              type: 'number', min: -200, max: 200, step: 4,
              value: prefs.offsetY,
              onChange: (e) => patch('offsetY', Number(e.target.value) || 0),
            }),
            h('span', { className: 'lens-note' }, '正值向下')),
          h(Row, { label: '最大行数' },
            h(Select, {
              value: String(prefs.maxRows),
              onChange: (value) => patch('maxRows', Number(value)),
              options: [4, 5, 6, 8, 10, 12].map((n) => ({ value: String(n), label: n + ' 行' })),
            })),
          h('div', { className: 'lens-actions' },
            h('button', { className: 'lens-btn', disabled: saving, onClick: save }, saving ? '保存中…' : '保存'),
            h('span', { className: 'lens-status ' + status.kind }, status.text))),
        h('div', { className: 'lens-note' },
          '默认「跟随桌宠」会使用桌宠当前的字体与气泡字号。卡片本身保持鼠标穿透，只有右侧的加载/卸载按钮区域可交互；停止服务需要二次确认。'))
    }

    async function requestJson(url, options) {
      const response = await fetch(url, options)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + response.status)
      return data
    }

    function MonitorPage(props) {
      const embedded = props?.embedded === true
      const [rows, setRows] = React.useState(null)
      const [prefs, setPrefs] = React.useState(null)
      const [status, setStatus] = React.useState({ kind: '', text: '' })
      const [draft, setDraft] = React.useState({ kind: 'openai', name: '', port: '' })
      const [editing, setEditing] = React.useState(null)
      const [form, setForm] = React.useState({ command: '', args: '', cwd: '', timeoutMs: '180000' })
      const [busy, setBusy] = React.useState(false)
      const [confirmStop, setConfirmStop] = React.useState(null)

      const load = React.useCallback(async () => {
        try {
          const data = await requestJson('/dsh-model-lens/api/monitor')
          setRows(data.endpoints || [])
        } catch (error) {
          setStatus({ kind: 'err', text: String(error.message || error) })
        }
      }, [])

      React.useEffect(() => {
        load()
        requestJson('/dsh-model-lens/api/prefs')
          .then((data) => setPrefs(data.prefs || null))
          .catch(() => {})
        const timer = setInterval(load, 5000)
        return () => clearInterval(timer)
      }, [load])

      async function togglePref(key, value) {
        const previous = prefs
        setBusy(true)
        setPrefs({ ...prefs, [key]: value })
        try {
          const data = await requestJson('/dsh-model-lens/api/prefs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...prefs, [key]: value }),
          })
          setPrefs(data.prefs || null)
          setStatus({ kind: 'ok', text: '服务控制已更新' })
          await load()
        } catch (error) {
          setPrefs(previous)
          setStatus({ kind: 'err', text: String(error.message || error) })
        } finally {
          setBusy(false)
        }
      }

      async function add() {
        setBusy(true)
        setStatus({ kind: '', text: '' })
        try {
          await requestJson('/dsh-model-lens/api/monitor/endpoints', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: draft.kind, name: draft.name, port: Number(draft.port) }),
          })
          setDraft({ kind: draft.kind, name: '', port: '' })
          setStatus({ kind: 'ok', text: '已添加，刷新后显示' })
          await load()
        } catch (error) {
          setStatus({ kind: 'err', text: String(error.message || error) })
        } finally {
          setBusy(false)
        }
      }

      function editRow(row) {
        setEditing(row.id)
        setForm({
          command: row.startConfig?.command || '',
          args: (row.startConfig?.args || []).join(' '),
          cwd: row.startConfig?.cwd || '',
          timeoutMs: String(row.startConfig?.timeoutMs || 180000),
        })
      }

      async function saveStart(id) {
        setBusy(true)
        try {
          await requestJson('/dsh-model-lens/api/monitor/endpoints/' + encodeURIComponent(id) + '/start-command', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              command: form.command,
              args: form.args,
              cwd: form.cwd,
              timeoutMs: Number(form.timeoutMs),
            }),
          })
          setEditing(null)
          setStatus({ kind: 'ok', text: '启动命令已保存' })
          await load()
        } catch (error) {
          setStatus({ kind: 'err', text: String(error.message || error) })
        } finally {
          setBusy(false)
        }
      }

      async function removeStart(id) {
        setBusy(true)
        try {
          await requestJson('/dsh-model-lens/api/monitor/endpoints/' + encodeURIComponent(id) + '/start-command', {
            method: 'DELETE',
          })
          setStatus({ kind: 'ok', text: '启动命令已清除' })
          await load()
        } catch (error) {
          setStatus({ kind: 'err', text: String(error.message || error) })
        } finally {
          setBusy(false)
        }
      }

      async function callService(row, action) {
        setBusy(true)
        const okText =
          action === 'start' ? '已开始加载' : action === 'stop' ? '已开始停止' : '已发送停止请求'
        try {
          await requestJson('/dsh-model-lens/api/services/' + encodeURIComponent(row.id) + '/' + action, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          setStatus({ kind: 'ok', text: okText })
          await load()
          setTimeout(load, 1200)
        } catch (error) {
          setStatus({ kind: 'err', text: String(error.message || error) })
        } finally {
          setBusy(false)
        }
      }

      function confirmThen(row, action) {
        const now = Date.now()
        if (confirmStop && confirmStop.id === row.id && now < confirmStop.until) {
          setConfirmStop(null)
          action()
          return
        }
        setConfirmStop({ id: row.id, until: now + 3000 })
        setTimeout(() => setConfirmStop((current) => (current && current.id === row.id ? null : current)), 3000)
      }

      function runService(row, action) {
        callService(row, action)
      }

      function stopService(row) {
        confirmThen(row, () => callService(row, 'stop'))
      }

      function stopExternal(row) {
        confirmThen(row, () => callService(row, 'stop-external'))
      }

      async function removeRow(id) {
        setBusy(true)
        try {
          await requestJson('/dsh-model-lens/api/monitor/endpoints/' + encodeURIComponent(id), { method: 'DELETE' })
          await load()
        } catch (error) {
          setStatus({ kind: 'err', text: String(error.message || error) })
        } finally {
          setBusy(false)
        }
      }

      const kindOptions = [
        { value: 'embedding', label: '嵌入' },
        { value: 'rerank', label: '重排' },
        { value: 'stt', label: 'ASR' },
        { value: 'tts', label: 'TTS' },
        { value: 'ollama', label: 'Ollama' },
        { value: 'openai', label: 'OpenAI 兼容' },
        { value: 'chat', label: '对话' },
      ]

      return h('div', { className: embedded ? 'lens-section' : 'lens-wrap' },
        embedded ? null : h('div', { className: 'lens-head' },
          h('div', { className: 'lens-title' }, '监控配置'),
          h('div', { className: 'lens-sub' }, '手动添加监控端点，或为已发现的端点配置启动命令。发布包默认只自动发现，不会猜测启动命令。')),
        h('div', { className: 'lens-card' },
          h('div', { className: 'lens-sub' }, '服务控制'),
          h(Row, { label: '卡片按钮' },
            h('label', { className: 'lens-check' },
              h('input', {
                type: 'checkbox',
                checked: prefs?.allowServiceControl === true,
                disabled: !prefs || busy,
                onChange: (e) => togglePref('allowServiceControl', e.target.checked),
              }),
              '允许在卡片上加载/停止服务')),
          h(Row, { label: '外部服务' },
            h('label', { className: 'lens-check' },
              h('input', {
                type: 'checkbox',
                checked: prefs?.allowExternalStop === true,
                disabled: !prefs || busy,
                onChange: (e) => togglePref('allowExternalStop', e.target.checked),
              }),
              '允许停止外部启动的服务')),
          h('div', { className: 'lens-note' }, '关闭卡片按钮不影响本页的加载/卸载。'),
          h('div', { className: 'lens-note' }, h('strong', null, '『外部服务』开启后可能导致错误的停止服务'))),
        h('div', { className: 'lens-card' },
          h('div', { className: 'lens-sub' }, '添加端点：类型、名称、端口。已有同端口端点会被更新。'),
          h('div', { className: 'mon-add' },
            h(Select, {
              value: draft.kind,
              onChange: (value) => setDraft({ ...draft, kind: value }),
              options: kindOptions,
            }),
            h('input', {
              className: 'lens-number',
              placeholder: '模型名称',
              value: draft.name,
              onChange: (e) => setDraft({ ...draft, name: e.target.value }),
            }),
            h('input', {
              className: 'lens-number',
              type: 'number',
              placeholder: '端口',
              value: draft.port,
              onChange: (e) => setDraft({ ...draft, port: e.target.value }),
            }),
            h('button', { className: 'lens-btn', disabled: busy, onClick: add }, '添加'))),
        h('div', { className: 'lens-card' },
          h('div', { className: 'lens-sub' }, '当前端点'),
          rows === null
            ? h('div', { className: 'mon-empty' }, '读取中…')
            : rows.length === 0
              ? h('div', { className: 'mon-empty' }, '还没有端点')
              : h('div', { className: 'mon-list' },
                  rows.map((row) => h('div', { className: 'mon-row', key: row.id },
                    h('div', { className: 'mon-head' },
                      h('span', { className: 'mon-dot ' + row.status }),
                      h('span', { className: 'mon-tag' }, row.tag),
                      h('div', { className: 'mon-main' },
                        h('div', { className: 'mon-name' }, row.name),
                        h('div', { className: 'mon-meta' },
                          row.kind + ' · :' + row.port + (row.template ? ' · 模板 ' + row.template : '') + (row.manual ? ' · 手动' : ''))),
                      h('div', { className: 'mon-actions' },
                        row.pending
                          ? h('span', { className: 'mon-pending' }, row.pending === 'starting' ? '启动中…' : '停止中…')
                          : row.canStart
                            ? h('button', {
                                className: 'mon-btn primary',
                                disabled: busy,
                                onClick: () => runService(row, 'start'),
                              }, '加载')
                            : row.canStop
                              ? h('button', {
                                  className: 'mon-btn danger',
                                  disabled: busy,
                                  onClick: () => stopService(row),
                                }, confirmStop && confirmStop.id === row.id ? '确认停止' : '卸载')
                              : row.canStopExternal
                                ? h('button', {
                                    className: 'mon-btn danger',
                                    disabled: busy,
                                    title: row.stopMode === 'command' ? '调用端点配置的停止命令' : '按端口结束监听进程',
                                    onClick: () => stopExternal(row),
                                  }, confirmStop && confirmStop.id === row.id ? '确认停止' : '停止')
                                : null,
                        row.start
                          ? h('button', {
                              className: 'mon-btn',
                              disabled: busy || Boolean(row.pending),
                              onClick: () => removeStart(row.id),
                            }, '卸载启动命令')
                          : h('button', {
                              className: 'mon-btn primary',
                              disabled: busy || Boolean(row.pending),
                              onClick: () => editRow(row),
                            }, '配置启动命令'),
                        row.manual
                          ? h('button', {
                              className: 'mon-btn',
                              disabled: busy,
                              onClick: () => removeRow(row.id),
                            }, '删除')
                          : null)),
                    editing === row.id
                      ? h('div', { className: 'mon-form' },
                          h('input', {
                            placeholder: 'command，例如 python.exe',
                            value: form.command,
                            onChange: (e) => setForm({ ...form, command: e.target.value }),
                          }),
                          h('input', {
                            placeholder: 'args，空格分隔',
                            value: form.args,
                            onChange: (e) => setForm({ ...form, args: e.target.value }),
                          }),
                          h('input', {
                            placeholder: 'cwd（可选）',
                            value: form.cwd,
                            onChange: (e) => setForm({ ...form, cwd: e.target.value }),
                          }),
                          h('input', {
                            type: 'number',
                            placeholder: '超时 ms',
                            value: form.timeoutMs,
                            onChange: (e) => setForm({ ...form, timeoutMs: e.target.value }),
                          }),
                          h('div', { style: { display: 'flex', gap: '6px' } },
                            h('button', { className: 'mon-btn primary', disabled: busy, onClick: () => saveStart(row.id) }, '保存'),
                            h('button', { className: 'mon-btn', onClick: () => setEditing(null) }, '取消')))
                      : null)))
          ),
        h('div', { className: 'lens-actions' },
          h('span', { className: 'lens-status ' + status.kind }, status.text)),
        h('div', { className: 'lens-note' },
          '提示：未安装 dsh-pet 时，这里的「加载/卸载」就是完整操作入口。启动命令会写入 ~/.dsh/dsh-model-lens-local.json；卸载启动命令只清除启动描述，不影响服务本身；外部服务停止需在本页打开开关。'))
    }

    function SettingsHome() {
      const [tab, setTab] = React.useState('ui')
      return h('div', { className: 'lens-wrap' },
        h('div', { className: 'lens-tabs' },
          h('button', { className: tab === 'ui' ? 'on' : '', onClick: () => setTab('ui') }, '界面配置'),
          h('button', { className: tab === 'monitor' ? 'on' : '', onClick: () => setTab('monitor') }, '监控配置')),
        tab === 'ui' ? h(Page, { embedded: true }) : h(MonitorPage, { embedded: true }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ensureStyle()
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-model-lens',
          order: 440,
          label: '本地模型监控',
        }, () => h(SettingsHome)))
      },
    }
  },
})
