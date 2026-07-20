/** Demo Timer plugin card — plain Vue options API ESM (no build).
 * Uses host-injected globalThis.__CATRACE_VUE__ (bare `vue` import won't resolve from asset URL).
 * Contract: props.event (BusEvent), props.isHovered?; emits close / action(actionId)
 */
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing (__CATRACE_VUE__.h)')
}

const STYLE_ID = 'catrace-plugin-demo-timer-css'
const CSS = `
.demo-timer {
  display: flex; flex-direction: column; width: 100%; min-height: 0;
  --accent: #0d9488; --title: #134e4a; --body: #0f766e; --bg: #f0fdfa;
  font-family: system-ui, -apple-system, Segoe UI, sans-serif;
}
.demo-timer .hdr { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.demo-timer .left { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.demo-timer .badge {
  flex-shrink: 0; font-size: 0.625rem; font-weight: 700; letter-spacing: 0.04em;
  color: #fff; background: var(--accent); border-radius: 0.25rem; padding: 0.125rem 0.35rem;
}
.demo-timer .title {
  margin: 0; font-size: 0.9375rem; font-weight: 600; color: var(--title);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.demo-timer .x {
  flex-shrink: 0; width: 1.5rem; height: 1.5rem; border: none; background: transparent;
  border-radius: 0.25rem; color: #94a3b8; font-size: 1.125rem; line-height: 1; cursor: pointer;
}
.demo-timer .x:hover { background: var(--bg); color: var(--accent); }
.demo-timer .bar {
  height: 0.125rem; border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--bg));
  transform-origin: left center;
  animation: demo-timer-shrink var(--toast-auto-hide-ms, 8000ms) linear forwards;
  margin: 0.25rem 0 0.5rem;
}
.demo-timer .bar.paused { animation-play-state: paused; }
@keyframes demo-timer-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.demo-timer .body {
  margin: 0; font-size: 0.8125rem; line-height: 1.45; color: var(--body);
  white-space: pre-wrap; word-break: break-word;
}
.demo-timer .prog { margin-top: 0.5rem; }
.demo-timer .track { height: 0.375rem; border-radius: 999px; background: var(--bg); overflow: hidden; }
.demo-timer .fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width 0.2s ease; }
.demo-timer .label { margin-top: 0.25rem; font-size: 0.75rem; color: var(--body); }
.demo-timer .acts { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.625rem; }
.demo-timer .btn {
  border: none; border-radius: 0.375rem; padding: 0.375rem 0.625rem;
  font-size: 0.75rem; font-weight: 600; cursor: pointer;
}
.demo-timer .btn.ghost { background: var(--bg); color: var(--title); }
.demo-timer .btn.primary { background: var(--accent); color: #fff; }
.demo-timer .btn:hover { filter: brightness(0.97); }
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function progressOf(event) {
  const p = event && event.progress
  if (!p || !p.total) return null
  const pct = Math.min(100, Math.round((p.current / p.total) * 100))
  return { ...p, pct }
}

export default {
  name: 'DemoTimerCard',
  props: {
    event: { type: Object, required: true },
    isHovered: { type: Boolean, default: false },
  },
  emits: ['close', 'action'],
  created() {
    ensureStyles()
  },
  render() {
    const event = this.event || {}
    const progress = progressOf(event)
    const actions = event.actions || []

    const children = [
      h('div', { class: 'hdr' }, [
        h('div', { class: 'left' }, [
          h('span', { class: 'badge' }, 'DEMO'),
          h('h2', { class: 'title' }, event.title || ''),
        ]),
        h(
          'button',
          {
            class: 'x',
            type: 'button',
            'aria-label': 'Close',
            onClick: () => this.$emit('close'),
          },
          '×',
        ),
      ]),
    ]

    if (!event.sticky) {
      children.push(
        h('div', {
          class: ['bar', this.isHovered ? 'paused' : ''],
        }),
      )
    }

    if (event.body) {
      children.push(h('p', { class: 'body' }, event.body))
    }

    if (progress) {
      children.push(
        h('div', { class: 'prog' }, [
          h('div', { class: 'track' }, [
            h('div', {
              class: 'fill',
              style: { width: progress.pct + '%' },
            }),
          ]),
          h(
            'div',
            { class: 'label' },
            progress.label || `${progress.current}/${progress.total}`,
          ),
        ]),
      )
    }

    if (actions.length) {
      children.push(
        h(
          'div',
          { class: 'acts' },
          actions.map((a, i) =>
            h(
              'button',
              {
                key: a.id,
                type: 'button',
                class: ['btn', i === actions.length - 1 ? 'primary' : 'ghost'],
                onClick: () => this.$emit('action', a.id),
              },
              a.label,
            ),
          ),
        ),
      )
    }

    return h('div', { class: 'demo-timer' }, children)
  },
}
