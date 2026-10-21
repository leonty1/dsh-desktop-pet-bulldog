window.__ModuleLoader__.load({ id: 'dsh-frenchie', factory: (require) => {
  const module = { exports: {} }
  const exports = module.exports
  const React = require('react')
  const { useEffect, useRef, useState } = React
  const { Checkbox, IconChevronDownOutlineRegular, Menu, Switch } = require('@deepseek-ai/dsh-client-ui-primitives')
  const PACKAGE_NAME = 'dsh-frenchie'
  const CONFIG_ENDPOINT = '/plugins/dsh-frenchie/config'
  const EVENTS_ENDPOINT = '/plugins/dsh-frenchie/events'
  const MANIFEST_ENDPOINT = '/plugins/dsh-frenchie/manifest'
  const FRAME_ENDPOINT = '/plugins/dsh-frenchie/frame'
  const VISIBILITY_ENDPOINT = '/plugins/dsh-frenchie/visibility'
  // Quick-action seat contributed into dsh-plugin-ui's list slot; the pet
  // button only appears when that UI plugin (owner of the slot) is mounted.
  const QUICK_ACTION_SLOT = 'pluginUi.quickAction'
  const QUICK_ACTION_ID = 'dsh-frenchie-toggle'

  const COPY = {
    zh: {
      enabledTitle: '显示桌宠', enabledDescription: '法斗浮在桌面最上层，跟着 DSH 的任务状态动作。',
      sizeTitle: '宠物大小', sizeDescription: '拖动即时改变桌上法斗的大小。',
      bubbleSizeTitle: '气泡大小', bubbleSizeDescription: '状态卡片相对法斗的尺寸。',
      activityTitle: '活跃程度', activityDescription: '空闲时微动作出现的频率。',
      activityQuiet: '安静', activityNormal: '标准', activityLively: '活泼',
      reducedTitle: '减少动态效果', reducedDescription: '收起走动、循环帧和程序化晃动。',
      lieTitle: '趴下时间', lieDescription: '多久没有任务后先趴着休息；0 表示不趴。',
      sleepTitle: '入睡时间', sleepDescription: '安静多久后闭眼睡着；0 表示不睡。',
      soundTitle: '提示音', soundDescription: '任务完成或出错时叫一声。',
      bubbleTitle: '气泡显示', bubbleDescription: '常驻显示、完全隐藏，或自定义哪些状态显示气泡。',
      bubbleAlways: '常驻显示', bubbleHidden: '完全隐藏', bubbleCustom: '自定义显示状态',
      statesTitle: '自定义显示状态', statesDescription: '勾选的状态出现时才显示气泡。',
      subagentsTitle: '响应子 Agent', subagentsDescription: '默认只跟随顶层任务，避免状态过度跳动。',
      hotkeyTitle: '全局快捷键', hotkeyDescription: '在系统任何地方按快捷键切换桌宠的显示与隐藏；默认关闭。',
      hotkeyNone: '未设置', hotkeyRecord: '设置快捷键', hotkeyRecording: '按下组合键…',
      hotkeyClearHint: 'Esc 取消，退格清除', hotkeyInvalid: '至少要有一个 Ctrl/Alt/Cmd/Win 修饰键',
      quickActionLabel: '切换桌宠', quickActionShow: '开启宠物', quickActionHide: '关闭宠物',
      overlayTitle: '页面内桌宠', overlayDescription: '在 DSH 页面右下角再显示一只跟随状态的小法斗；改动后刷新页面生效。',
      loading: '正在读取设置…', unavailable: '桌宠设置尚未连接到 DSH Host。', saving: '正在保存…',
      idle: '空闲', thinking: '思考中', working: '工作中', waiting: '等待确认', success: '完成', error: '错误',
      minutes: '{n} 分钟', never: '不睡',
    },
    en: {
      enabledTitle: 'Show desktop pet', enabledDescription: 'The bulldog floats above your desktop and reacts to DSH task states.',
      sizeTitle: 'Pet size', sizeDescription: 'Drag to resize the bulldog on the desktop.',
      bubbleSizeTitle: 'Bubble size', bubbleSizeDescription: 'How large the status card sits beside the dog.',
      activityTitle: 'Activity', activityDescription: 'How often idle micro-movements appear.',
      activityQuiet: 'Quiet', activityNormal: 'Standard', activityLively: 'Lively',
      reducedTitle: 'Reduce motion', reducedDescription: 'Drop walking loops, cycling frames, and procedural sway.',
      lieTitle: 'Lie down after', lieDescription: 'Minutes of quiet before the dog lies down to rest; 0 keeps it sitting.',
      sleepTitle: 'Fall asleep after', sleepDescription: 'Minutes of quiet before it closes its eyes; 0 keeps it awake.',
      soundTitle: 'Sounds', soundDescription: 'Bark when a task finishes or fails.',
      bubbleTitle: 'Status bubble', bubbleDescription: 'Always show it, hide it, or pick the states that show it.',
      bubbleAlways: 'Always', bubbleHidden: 'Hidden', bubbleCustom: 'Chosen states',
      statesTitle: 'Bubble states', statesDescription: 'The bubble appears only for the checked states.',
      subagentsTitle: 'Follow subagents', subagentsDescription: 'Off by default so the state tracks the top-level task.',
      hotkeyTitle: 'Global hotkey', hotkeyDescription: 'Show or hide the pet from anywhere in the system with a hotkey; off by default.',
      hotkeyNone: 'Not set', hotkeyRecord: 'Set hotkey', hotkeyRecording: 'Press a combo…',
      hotkeyClearHint: 'Esc cancels, Backspace clears', hotkeyInvalid: 'Needs at least a Ctrl/Alt/Cmd/Win modifier',
      quickActionLabel: 'Toggle pet', quickActionShow: 'Show pet', quickActionHide: 'Hide pet',
      overlayTitle: 'In-page pet', overlayDescription: 'A second small dog in the page corner that follows the state; reload the page to apply.',
      loading: 'Loading settings…', unavailable: 'Pet settings are not connected to the DSH Host.', saving: 'Saving…',
      idle: 'Idle', thinking: 'Thinking', working: 'Working', waiting: 'Waiting', success: 'Done', error: 'Error',
      minutes: '{n} min', never: 'Never',
    },
  }

  const STYLE_ID = 'dsh-frenchie-settings'
  const STYLE_TEXT = `
.fr-row{display:flex;align-items:center;gap:8px;padding:16px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08))}
.fr-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding-right:48px}
.fr-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#1a1a1a)}
.fr-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(0,0,0,.45))}
.fr-sliderRow{display:flex;align-items:center;justify-content:flex-end;gap:12px}
.fr-readout{font-size:13px;line-height:20px;min-width:52px;text-align:right;color:var(--dsw-alias-label-primary,#1a1a1a)}
.fr-slider{-webkit-appearance:none;appearance:none;width:180px;height:4px;border-radius:2px;outline:none;cursor:pointer;margin:0}
.fr-slider:disabled{cursor:default;opacity:.45}
.fr-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border:0;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:0 1px 4px rgba(0,0,0,.25);cursor:pointer}
.fr-slider::-moz-range-thumb{width:16px;height:16px;border:0;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:0 1px 4px rgba(0,0,0,.25);cursor:pointer}
.fr-pill{display:inline-flex;align-items:center;gap:12px;height:36px;padding:0 14px;border:0;border-radius:18px;background:var(--dsw-alias-bg-module-platform,#f2f2f2);font-family:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#1a1a1a);cursor:pointer}
.fr-pill:hover{background:var(--dsw-alias-interactive-bg-hover,#e8e8e8)}
.fr-chevron{flex:none}
.fr-states{display:grid;grid-template-columns:repeat(3,min-content);gap:10px 20px;padding-top:12px}
.fr-hotkey{display:flex;align-items:center;gap:8px}
.fr-hotkeyBtn{display:inline-flex;align-items:center;height:32px;padding:0 12px;border:0;border-radius:16px;background:var(--dsw-alias-bg-module-platform,#f2f2f2);font-family:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#1a1a1a);cursor:pointer;white-space:nowrap}
.fr-hotkeyBtn:hover{background:var(--dsw-alias-interactive-bg-hover,#e8e8e8)}
.fr-hotkeyBtn:disabled{cursor:default;opacity:.45}
.fr-hotkeyBtn.recording{color:var(--dsw-alias-brand-primary,#ff5b2e)}
.fr-status{padding:16px 0;font-size:13px;color:var(--dsw-alias-label-tertiary,rgba(0,0,0,.45))}
`

  function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.textContent = STYLE_TEXT
    document.head.appendChild(tag)
  }

  function Row({ title, description, children }) {
    return React.createElement('div', { className: 'fr-row' },
      React.createElement('div', { className: 'fr-text' },
        React.createElement('div', { className: 'fr-title' }, title),
        React.createElement('div', { className: 'fr-desc' }, description),
      ),
      children,
    )
  }

  function Slider({ min, max, step, value, label, readout, disabled, onInput }) {
    const filled = ((value - min) / (max - min)) * 100
    return React.createElement('div', { className: 'fr-sliderRow' },
      React.createElement('span', { className: 'fr-readout' }, readout),
      React.createElement('input', {
        className: 'fr-slider', type: 'range', min, max, step, value, disabled,
        'aria-label': label,
        style: {
          background: `linear-gradient(to right, var(--dsw-alias-brand-primary,#ff5b2e) ${filled}%,`
            + ' var(--dsw-alias-bg-base,#e6e6e6) ' + filled + '%)',
        },
        onChange: (event) => { onInput(Number(event.target.value)) },
      }),
    )
  }

  function Picker({ value, options, disabled, onSelect }) {
    const [open, setOpen] = useState(false)
    const pillRef = useRef(null)
    const chosen = options.find((option) => option.id === value) ?? options[0]
    const pill = React.createElement('button', {
      ref: pillRef, type: 'button', className: 'fr-pill', disabled,
      'aria-haspopup': 'menu', 'aria-expanded': open,
      onClick: () => { setOpen((next) => !next) },
    }, chosen.label, React.createElement(IconChevronDownOutlineRegular, { className: 'fr-chevron' }))
    return React.createElement(Menu, {
      open, onClose: () => { setOpen(false) },
      items: options.map((option) => ({ id: option.id, label: option.label })),
      selectedId: value,
      onSelect: (id) => { pillRef.current?.focus({ preventScroll: true }); setOpen(false); onSelect(id) },
      align: 'end', portal: true, anchor: pill,
    })
  }

  function BubbleStates({ value, disabled, labels, onChange }) {
    const selected = Array.isArray(value) ? value : []
    return React.createElement('div', { className: 'fr-states' },
      ...labels.map(([state, label]) => React.createElement(Checkbox, {
        key: state, label, disabled, checked: selected.includes(state),
        onChange: (checked) => {
          const next = new Set(selected)
          if (checked) next.add(state)
          else next.delete(state)
          onChange([...next])
        },
      })),
    )
  }

  // Records one global-hotkey combination. The capture runs on the window's
  // capture phase and always preventDefaults, so the pressed combo never
  // triggers the page's own shortcuts while recording. Escape cancels and
  // Backspace clears; anything without a real modifier (Ctrl/Alt/Cmd, or
  // Shift plus another modifier) is ignored, mirroring the helpers' parser,
  // which rejects bare-letter hotkeys because they would fire while typing.
  function HotkeyRecorder({ value, disabled, t, onCommit }) {
    const [recording, setRecording] = useState(false)
    useEffect(() => {
      if (!recording) return
      const handler = (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (event.key === 'Escape') {
          setRecording(false)
          return
        }
        if (event.key === 'Backspace') {
          setRecording(false)
          onCommit('')
          return
        }
        const mods = []
        if (event.ctrlKey) mods.push('Ctrl')
        if (event.altKey) mods.push('Alt')
        if (event.metaKey) mods.push('Cmd')
        if (event.shiftKey) mods.push('Shift')
        const fkey = /^F([1-9]|1[0-9]|2[0-4])$/i.exec(event.key)
        const key = fkey
          ? `F${fkey[1]}`
          : (event.key.length === 1 && /[a-z0-9]/i.test(event.key) ? event.key.toUpperCase() : null)
        if (!key || !mods.some((mod) => mod !== 'Shift')) return
        setRecording(false)
        onCommit([...mods, key].join('+'))
      }
      window.addEventListener('keydown', handler, true)
      return () => window.removeEventListener('keydown', handler, true)
    }, [recording, onCommit])
    const label = recording
      ? t('hotkeyRecording')
      : (typeof value === 'string' && value ? value : t('hotkeyNone'))
    return React.createElement('button', {
      type: 'button',
      className: recording ? 'fr-hotkeyBtn recording' : 'fr-hotkeyBtn',
      disabled,
      'aria-label': t('hotkeyTitle'),
      title: recording ? t('hotkeyClearHint') : t('hotkeyRecord'),
      onClick: () => { setRecording((next) => !next) },
    }, label)
  }

  function FrenchieConfig({ t }) {
    const [status, setStatus] = useState('loading')
    const [value, setValue] = useState({})
    const [busy, setBusy] = useState(false)
    const patchSeq = useRef(0)
    const sliderTimers = useRef(new Map())
    ensureStyles()
    useEffect(() => {
      let active = true
      fetch(CONFIG_ENDPOINT, { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error(`settings request failed: ${response.status}`)
          return response.json()
        })
        .then((next) => { if (active) { setValue(next); setStatus('ready') } })
        .catch(() => { if (active) setStatus('unavailable') })
      return () => {
        active = false
        for (const timer of sliderTimers.current.values()) clearTimeout(timer)
        sliderTimers.current.clear()
      }
    }, [])
    const write = async (field, next) => {
      const seq = ++patchSeq.current
      setBusy(true)
      try {
        const response = await fetch(CONFIG_ENDPOINT, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [field]: next }),
        })
        if (!response.ok) throw new Error(`settings write failed: ${response.status}`)
        const updated = await response.json()
        if (seq === patchSeq.current) {
          setValue(updated)
          setStatus('ready')
        }
      } catch {
        if (seq === patchSeq.current) setStatus('unavailable')
      } finally {
        if (seq === patchSeq.current) setBusy(false)
      }
    }
    const writeSlider = (field, next) => {
      // The thumb follows the pointer at once and the dog resizes while the drag
      // pauses, so the write is debounced well inside one gesture.
      setValue((prev) => ({ ...prev, [field]: next }))
      // Invalidate any in-flight write so a stale response cannot overwrite the
      // optimistic slider value while the user keeps dragging.
      patchSeq.current += 1
      const pending = sliderTimers.current.get(field)
      if (pending) clearTimeout(pending)
      const timer = setTimeout(() => {
        sliderTimers.current.delete(field)
        void write(field, next)
      }, 100)
      sliderTimers.current.set(field, timer)
    }
    const writable = status === 'ready' && !busy
    if (status === 'unavailable') return React.createElement('div', { className: 'fr-status', role: 'status' }, t('unavailable'))
    if (status === 'loading') return React.createElement('div', { className: 'fr-status' }, t('loading'))
    const bubbleMode = value.bubbleMode ?? 'always'
    return React.createElement(React.Fragment, null,
      React.createElement(Row, { title: t('enabledTitle'), description: t('enabledDescription') },
        React.createElement(Switch, {
          label: t('enabledTitle'), checked: value.enabled !== false, disabled: !writable,
          onChange: (next) => { void write('enabled', next) },
        }),
      ),
      React.createElement(Row, { title: t('sizeTitle'), description: t('sizeDescription') },
        React.createElement(Slider, {
          min: 0.28, max: 0.98, step: 0.01, value: value.scale ?? 0.6, disabled: status !== 'ready', label: t('sizeTitle'),
          readout: `${Math.round((value.scale ?? 0.6) * 100)}%`,
          onInput: (next) => { void writeSlider('scale', next) },
        }),
      ),
      bubbleMode !== 'hidden'
        ? React.createElement(Row, { title: t('bubbleSizeTitle'), description: t('bubbleSizeDescription') },
            React.createElement(Slider, {
              min: 0.8, max: 1.2, step: 0.05, value: value.bubbleScale ?? 1, disabled: status !== 'ready', label: t('bubbleSizeTitle'),
              readout: `${Math.round((value.bubbleScale ?? 1) * 100)}%`,
              onInput: (next) => { void writeSlider('bubbleScale', next) },
            }),
          )
        : null,
      React.createElement(Row, { title: t('activityTitle'), description: t('activityDescription') },
        React.createElement(Picker, {
          value: value.activityLevel ?? 'normal', disabled: !writable,
          options: [{ id: 'quiet', label: t('activityQuiet') }, { id: 'normal', label: t('activityNormal') },
            { id: 'lively', label: t('activityLively') }],
          onSelect: (id) => { void write('activityLevel', id) },
        }),
      ),
      React.createElement(Row, { title: t('reducedTitle'), description: t('reducedDescription') },
        React.createElement(Switch, {
          label: t('reducedTitle'), checked: value.reducedMotion === true, disabled: !writable,
          onChange: (next) => { void write('reducedMotion', next) },
        }),
      ),
      React.createElement(Row, { title: t('lieTitle'), description: t('lieDescription') },
        React.createElement(Slider, {
          min: 0, max: 180, step: 1, value: value.lieAfterMinutes ?? 1, disabled: status !== 'ready', label: t('lieTitle'),
          readout: (value.lieAfterMinutes ?? 1) === 0 ? t('never') : t('minutes', { n: value.lieAfterMinutes ?? 1 }),
          onInput: (next) => { void writeSlider('lieAfterMinutes', next) },
        }),
      ),
      React.createElement(Row, { title: t('sleepTitle'), description: t('sleepDescription') },
        React.createElement(Slider, {
          min: 0, max: 180, step: 1, value: value.sleepAfterMinutes ?? 6, disabled: status !== 'ready', label: t('sleepTitle'),
          readout: (value.sleepAfterMinutes ?? 6) === 0 ? t('never') : t('minutes', { n: value.sleepAfterMinutes ?? 6 }),
          onInput: (next) => { void writeSlider('sleepAfterMinutes', next) },
        }),
      ),
      React.createElement(Row, { title: t('soundTitle'), description: t('soundDescription') },
        React.createElement(Switch, {
          label: t('soundTitle'), checked: value.soundEnabled !== false, disabled: !writable,
          onChange: (next) => { void write('soundEnabled', next) },
        }),
      ),
      React.createElement(Row, { title: t('bubbleTitle'), description: t('bubbleDescription') },
        React.createElement(Picker, {
          value: bubbleMode, disabled: !writable,
          options: [{ id: 'always', label: t('bubbleAlways') }, { id: 'hidden', label: t('bubbleHidden') },
            { id: 'custom', label: t('bubbleCustom') }],
          onSelect: (id) => { void write('bubbleMode', id) },
        }),
      ),
      bubbleMode === 'custom'
        ? React.createElement(Row, { title: t('statesTitle'), description: t('statesDescription') },
            React.createElement(BubbleStates, {
              value: value.bubbleStates ?? ['SUCCESS', 'ERROR', 'WAITING'], disabled: !writable,
              labels: [['IDLE', t('idle')], ['THINKING', t('thinking')], ['WORKING', t('working')],
                ['WAITING', t('waiting')], ['SUCCESS', t('success')], ['ERROR', t('error')]],
              onChange: (next) => { void write('bubbleStates', next) },
            }),
          )
        : null,
      React.createElement(Row, { title: t('subagentsTitle'), description: t('subagentsDescription') },
        React.createElement(Switch, {
          label: t('subagentsTitle'), checked: value.includeSubagents === true, disabled: !writable,
          onChange: (next) => { void write('includeSubagents', next) },
        }),
      ),
      React.createElement(Row, { title: t('hotkeyTitle'), description: t('hotkeyDescription') },
        React.createElement('div', { className: 'fr-hotkey' },
          React.createElement(Switch, {
            label: t('hotkeyTitle'), checked: value.hotkeyEnabled === true, disabled: !writable,
            onChange: (next) => { void write('hotkeyEnabled', next) },
          }),
          React.createElement(HotkeyRecorder, {
            value: value.hotkeyShortcut ?? '', disabled: !writable, t,
            onCommit: (shortcut) => {
              void (async () => {
                await write('hotkeyShortcut', shortcut)
                if (shortcut && value.hotkeyEnabled !== true) await write('hotkeyEnabled', true)
              })()
            },
          }),
        ),
      ),
      React.createElement(Row, { title: t('overlayTitle'), description: t('overlayDescription') },
        React.createElement(Switch, {
          label: t('overlayTitle'), checked: value.webOverlay === true, disabled: !writable,
          onChange: (next) => { void write('webOverlay', next) },
        }),
      ),
      busy ? React.createElement('div', { className: 'fr-status', role: 'status' }, t('saving')) : null,
    )
  }

  // In-page companion (opt-in via the webOverlay setting). Purely decorative:
  // it mirrors the DSH state as a small looping sprite in the page corner and
  // never blocks or outlives the page. Every failure path ends in "no pet",
  // never in an exception reaching the WebUI.
  function PetOverlay() {
    const [src, setSrc] = useState(null)
    useEffect(() => {
      let alive = true
      let raf = 0
      let source = null
      fetch(MANIFEST_ENDPOINT, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error('manifest'))))
        .then((manifest) => {
          if (!alive) return
          const runtime = { frames: manifest.clips.idle.frames, frameMs: manifest.clips.idle.frameMs || 42, index: 0 }
          let preloader = null
          const applyClip = (name) => {
            const clip = manifest.clips[name] || manifest.clips.idle
            runtime.frames = clip.frames
            runtime.frameMs = clip.frameMs || 42
            runtime.index = 0
          }
          const frameUrl = (frame) => FRAME_ENDPOINT + '?frame=' + encodeURIComponent(frame)
          const show = () => {
            if (!alive || runtime.frames.length === 0) return
            if (runtime.frames.length > 1) runtime.index = (runtime.index + 1) % runtime.frames.length
            setSrc(frameUrl(runtime.frames[runtime.index]))
            if (runtime.frames.length > 1 && typeof Image === 'function') {
              try {
                preloader = preloader || new Image()
                preloader.src = frameUrl(runtime.frames[(runtime.index + 1) % runtime.frames.length])
              } catch {}
            }
          }
          show()
          if (typeof requestAnimationFrame !== 'function') return
          let previous = 0
          let spent = 0
          const step = (now) => {
            if (!alive) return
            if (previous) {
              spent += now - previous
              if (spent >= runtime.frameMs) {
                spent %= runtime.frameMs
                show()
              }
            }
            previous = now
            raf = requestAnimationFrame(step)
          }
          raf = requestAnimationFrame(step)
          if (typeof EventSource !== 'undefined') {
            try {
              source = new EventSource(EVENTS_ENDPOINT)
              source.onmessage = (event) => {
                try {
                  const message = JSON.parse(event.data)
                  if (message.kind === 'state' && message.state && manifest.stateMap[message.state]) {
                    applyClip(manifest.stateMap[message.state])
                  }
                  if (message.kind === 'task' && message.state === 'WORKING' && message.activity
                    && manifest.workingActivityMap && manifest.workingActivityMap[message.activity]) {
                    applyClip(manifest.workingActivityMap[message.activity])
                  }
                } catch {}
              }
            } catch {}
          }
        })
        .catch(() => {})
      return () => {
        alive = false
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
        try { source?.close() } catch {}
      }
    }, [])
    if (!src) return null
    return React.createElement('img', {
      src, alt: '', 'aria-hidden': true, draggable: false,
      style: {
        position: 'fixed', right: 16, bottom: 12, width: 132, zIndex: 2147483000,
        pointerEvents: 'none', userSelect: 'none', opacity: 0.96,
        filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.25))',
      },
    })
  }

  // Seat button for dsh-plugin-ui's quick-action slot. The helper owns the
  // truth: this button posts a toggle request and then mirrors the helper's
  // visibility report arriving on the event stream, so hotkey, right-click
  // menu, and this button always agree. Unknown state shows the paw; a known
  // hidden state shows the "pet is away" variant so the seat reads as an
  // invitation to summon, not as a mute indicator.
  function quickActionCopy() {
    return COPY[/^zh/i.test(typeof navigator !== 'undefined' && navigator.language || '') ? 'zh' : 'en']
  }

  // Last known pet visibility, persisted so a freshly loaded page shows the
  // correct 开启/关闭 label before any event arrives (the helper only reports
  // on changes, so an SSE snapshot alone cannot always answer "is it out?").
  const VISIBILITY_STORE_KEY = 'dsh-frenchie.visibility'
  function storedVisibility() {
    try {
      const value = localStorage.getItem(VISIBILITY_STORE_KEY)
      return value === 'true' ? true : value === 'false' ? false : null
    } catch {
      return null
    }
  }
  function storeVisibility(visible) {
    try {
      localStorage.setItem(VISIBILITY_STORE_KEY, String(visible))
    } catch {}
  }

  function QuickActionToggle({ size }) {
    const [visible, setVisible] = useState(storedVisibility)
    useEffect(() => {
      let source
      try {
        source = new EventSource(EVENTS_ENDPOINT)
        source.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)
            if (message?.kind === 'visibility' && typeof message.visible === 'boolean') {
              setVisible(message.visible)
              storeVisibility(message.visible)
            }
          } catch {}
        }
      } catch {}
      return () => { try { source?.close() } catch {} }
    }, [])
    const toggle = () => {
      setVisible((prev) => {
        const next = prev === null ? true : !prev
        storeVisibility(next)
        return next
      })
      try {
        fetch(VISIBILITY_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ visible: 'toggle' }),
        }).catch(() => {})
      } catch {}
    }
    const copy = quickActionCopy()
    const label = visible === false ? copy.quickActionShow
      : visible === true ? copy.quickActionHide
      : copy.quickActionLabel
    // The owner cell (.externalSeat) is a fixed 30px column, so the button is
    // absolutely positioned against its right edge: collapsed it is the 30px
    // icon seat, on hover it grows leftward over the row and reveals the
    // state-dependent label, matching the account trigger's ease-out feel.
    return React.createElement('span', { className: 'fr-quickSeatWrap' },
      React.createElement('button', {
        type: 'button', className: 'fr-quickSeat', 'aria-label': label,
        style: { '--fr-icon-size': `${Number(size) || 14}px` },
        onClick: toggle,
      },
      React.createElement('span', { className: 'fr-quickSeatIcon', 'aria-hidden': true },
        visible === false ? React.createElement('svg', {
          className: 'fr-quickSeatGlyph', width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none',
        },
        React.createElement('path', { d: 'M12 5.5c2.1 0 3.8-1.2 3.8-2.7C15.8 1.2 14.1 0 12 0S8.2 1.2 8.2 2.8c0 1.5 1.7 2.7 3.8 2.7Z', fill: 'currentColor', opacity: 0.9 }),
        React.createElement('path', { d: 'M4.9 9.6c1.4 0 2.6-1.2 2.6-2.7S6.3 4.2 4.9 4.2 2.3 5.4 2.3 6.9s1.2 2.7 2.6 2.7Z', fill: 'currentColor', opacity: 0.9 }),
        React.createElement('path', { d: 'M19.1 9.6c1.4 0 2.6-1.2 2.6-2.7s-1.2-2.7-2.6-2.7-2.6 1.2-2.6 2.7 1.2 2.7 2.6 2.7Z', fill: 'currentColor', opacity: 0.9 }),
        React.createElement('path', { d: 'M12 22.9c4.2 0 7.3-2.2 7.3-5.4 0-3.9-4.1-7.4-7.3-7.4s-7.3 3.5-7.3 7.4c0 3.2 3.1 5.4 7.3 5.4Z', fill: 'currentColor' }),
        ) : React.createElement('svg', {
          className: 'fr-quickSeatGlyph', width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none',
        },
        React.createElement('ellipse', { cx: '7.2', cy: '7.4', rx: '2.2', ry: '2.9', fill: 'currentColor' }),
        React.createElement('ellipse', { cx: '12', cy: '5.6', rx: '2.2', ry: '2.9', fill: 'currentColor' }),
        React.createElement('ellipse', { cx: '16.8', cy: '7.4', rx: '2.2', ry: '2.9', fill: 'currentColor' }),
        React.createElement('path', { d: 'M12 21.6c3.7 0 6.4-2.1 6.4-4.9 0-3.6-3.9-6.6-6.4-6.6S5.6 13.1 5.6 16.7c0 2.8 2.7 4.9 6.4 4.9Z', fill: 'currentColor' }),
        )),
      React.createElement('span', { className: 'fr-quickSeatLabel' }, label),
      ),
    )
  }

  const QUICK_SEAT_STYLE = `
.fr-quickSeatWrap{position:relative;display:flex;align-items:stretch;justify-content:center;flex:none;width:30px}
.fr-quickSeat{position:absolute;right:0;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:6px;height:28px;padding:0 6px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-tertiary,rgba(0,0,0,.45));font:inherit;font-size:12px;line-height:20px;cursor:pointer;max-width:30px;overflow:hidden;white-space:nowrap;transition:max-width 180ms ease,background 120ms ease,color 120ms ease}
.fr-quickSeat:hover{max-width:220px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1a1a1a)}
.fr-quickSeatIcon{display:flex;align-items:center;justify-content:center;flex:none;width:var(--fr-icon-size,14px);height:var(--fr-icon-size,14px)}
.fr-quickSeatLabel{opacity:0;transition:opacity 140ms ease 60ms}
.fr-quickSeat:hover .fr-quickSeatLabel{opacity:1}
.fr-quickSeatGlyph{display:block}
`
  function ensureQuickSeatStyles() {
    if (typeof document === 'undefined') return
    // The page can hot-replace this bundle while a style tag from an older
    // version stays in the document (client HMR keeps DOM elements). Update
    // the existing tag in place instead of skipping when the id is present,
    // otherwise the seat button renders with a stale stylesheet and loses
    // its expanding/hover rules.
    let tag = document.getElementById('dsh-frenchie-quick-seat')
    if (!tag) {
      tag = document.createElement('style')
      tag.id = 'dsh-frenchie-quick-seat'
      document.head.appendChild(tag)
    }
    if (tag.textContent !== QUICK_SEAT_STYLE) tag.textContent = QUICK_SEAT_STYLE
  }

  function registerWebOverlay(ctx) {
    const registerOverlay = () => {
      try {
        ctx.slots.register({ name: 'shell.overlay', id: 'dsh-frenchie-overlay', order: 999 }, () =>
          React.createElement(PetOverlay, {}))
      } catch (error) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[dsh-frenchie] failed to register web overlay:', error)
        }
      }
    }
    try {
      ctx.slots.inject('shell.overlay', registerOverlay)
    } catch (error) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[dsh-frenchie] failed to inject overlay slot:', error)
      }
    }
  }

  function apply(ctx) {
    ctx.effect(() => ctx.locale.register('petCompanion', COPY), 'pet: settings dictionaries')
    // The settings page is decorative: if DSH changes the slot contract again, fail
    // this page quietly instead of failing the whole WebUI load (that regressed
    // before as 'other plugins stop working'). The guard must live INSIDE the inject
    // callback because DSH may invoke it asynchronously, outside any try around the
    // inject() call itself.
    const registerConfig = () => {
      try {
        ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME, locale: 'petCompanion' }, FrenchieConfig)
      } catch (error) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[dsh-frenchie] failed to register the settings page:', error)
        }
      }
    }
    try {
      ctx.slots.inject('plugins.bundle.config', registerConfig)
    } catch (error) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[dsh-frenchie] failed to inject the settings slot:', error)
      }
    }

    // The quick-action seat lives in dsh-plugin-ui's list slot. Everything is
    // guarded: without that plugin the slot never exists and the pet simply
    // has no seat, instead of failing the WebUI load.
    const registerQuickAction = () => {
      try {
        ensureQuickSeatStyles()
        ctx.slots.register({
          name: QUICK_ACTION_SLOT,
          id: QUICK_ACTION_ID,
          order: 30,
          // resolveSlotLabel accepts a function and calls it at render time, so
          // the dropdown follows the interface language without re-registering.
          label: () => COPY[/^zh/i.test(typeof navigator !== 'undefined' && navigator.language || '') ? 'zh' : 'en'].quickActionLabel,
        }, QuickActionToggle)
      } catch (error) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[dsh-frenchie] failed to register the quick-action seat:', error)
        }
      }
    }
    try {
      ctx.slots.inject(QUICK_ACTION_SLOT, registerQuickAction)
    } catch (error) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[dsh-frenchie] quick-action slot unavailable:', error)
      }
    }

    // The in-page pet is opt-in; read the local config once at mount. Any
    // failure (endpoint absent, offline host, closed page) just means no pet.
    try {
      fetch(CONFIG_ENDPOINT, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((config) => {
          if (config && config.webOverlay === true) registerWebOverlay(ctx)
        })
        .catch(() => {})
    } catch {}
  }

  module.exports = {
    name: 'dsh-frenchie-client',
    inject: ['slots', 'locale'],
    apply,
  }
  return module.exports
} })
