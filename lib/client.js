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
          min: 0.28, max: 0.98, step: 0.02, value: value.scale ?? 0.6, disabled: status !== 'ready', label: t('sizeTitle'),
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
