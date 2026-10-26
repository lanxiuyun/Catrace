import { useCallback, useEffect, useRef, useState } from 'react'
import {
  GlassBackdrop,
  GlassButton,
  GlassPopover,
  GlassProvider,
  GlassSegmentedControl,
  GlassSwitch,
  GlassToolbar,
  ToolbarGroup,
  ToolbarSpacer,
  getGlassDiagnostics,
  supportsSvgBackdrop,
  useGlassPolicy,
  type GlassMaterial,
  type GlassRenderer,
} from '@ttqtt/liquid-glass-react'
import '@ttqtt/liquid-glass-react/style.css'
import { PageScroll } from '../components/PageScroll'
import { useShellStore } from '../store'
import { readSystemReducedTransparency } from '../transparency'
import './glass-lab.css'

/**
 * liquid-glass-react 的 PoC 页（仅 DEV 路由 /lab/glass）。
 *
 * 目的不是复刻某个界面，而是回答三个问题：
 *   1. WebView2 上 `backdrop-filter: url(#…)` 这条折射路径到底能不能跑；
 *   2. 它的深色材质放进 Catrace 的壳里观感如何；
 *   3. 带动画时 backdrop-filter 的逐帧开销大概是什么量级。
 *
 * 页面自己画了一块 canvas 当背景（真实壁纸才有东西可折），玻璃组件都浮在它上面。
 */

type LabPolicy = {
  material: GlassMaterial
  renderer: GlassRenderer
  svg: boolean
  chroma: boolean
}

type Diagnostics = {
  svg: boolean
  chrome: string
  webview: boolean
  generated: number
  observers: number
  entries: number
  /** 系统「减少透明度」的原始值；应用已覆盖它，只用来说明差异。 */
  systemReduced: boolean
}

function readDiagnostics(): Diagnostics {
  const ua = navigator.userAgent
  const stats = getGlassDiagnostics()
  return {
    svg: supportsSvgBackdrop(),
    chrome: ua.match(/Chrome\/(\d+)/)?.[1] ?? '?',
    webview: /Edg\//.test(ua),
    generated: stats.generated,
    observers: stats.observers,
    entries: stats.entries,
    systemReduced: readSystemReducedTransparency(),
  }
}

/** 数 1 秒多的 rAF，用来粗看逐帧预算；不是 GPU 计时。 */
function measureFrames(durationMs: number): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0
    const start = performance.now()
    const tick = (now: number) => {
      frames += 1
      if (now - start < durationMs) requestAnimationFrame(tick)
      else resolve((frames * 1000) / Math.max(1, now - start))
    }
    requestAnimationFrame(tick)
  })
}

/** 舞台背景：彩色竖条 + 细网格 + 同心弧 + 大字轮廓，足够让边缘折射显形。 */
function drawStage(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const width = canvas.clientWidth || 1
  const height = canvas.clientHeight || 1
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const base = ctx.createLinearGradient(0, 0, width, height)
  base.addColorStop(0, '#081019')
  base.addColorStop(0.55, '#10202c')
  base.addColorStop(1, '#0a1017')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, width, height)

  const columns = ['#0d3a41', '#222a5a', '#48214a', '#4a2a18', '#1d3a26', '#252c38']
  const columnWidth = width / columns.length
  columns.forEach((color, index) => {
    ctx.fillStyle = color
    ctx.fillRect(index * columnWidth, 0, columnWidth + 1, height)
  })

  ctx.strokeStyle = 'rgb(255 255 255 / .09)'
  ctx.lineWidth = 1
  for (let x = 0; x <= width; x += 16) {
    ctx.beginPath()
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, height)
    ctx.stroke()
  }
  for (let y = 0; y <= height; y += 16) {
    ctx.beginPath()
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(width, y + 0.5)
    ctx.stroke()
  }

  const centerX = width * 0.5
  const centerY = height * 1.08
  for (let radius = 60, index = 0; radius < width; radius += 16, index += 1) {
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.strokeStyle = index % 3 === 0 ? 'rgb(255 255 255 / .24)' : 'rgb(255 255 255 / .10)'
    ctx.lineWidth = index % 3 === 0 ? 1.6 : 1
    ctx.stroke()
  }

  const wordSize = Math.round(Math.min(width * 0.16, height * 0.42))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 ${wordSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.fillStyle = 'rgb(255 255 255 / .06)'
  ctx.fillText('CATRACE', centerX, height * 0.44)
  ctx.strokeStyle = 'rgb(255 255 255 / .30)'
  ctx.lineWidth = 1.5
  ctx.strokeText('CATRACE', centerX, height * 0.44)
}

const DEFAULT_POLICY: LabPolicy = { material: 'clear', renderer: 'auto', svg: true, chroma: false }

/**
 * 直接读 provider 真正解析出来的策略。
 * 用来区分「应用开关没传到 store」和「传到了但 LGR 没照做」。
 */
function PolicyProbe() {
  const policy = useGlassPolicy()
  return (
    <div className="gl-policy" aria-hidden="true">
      <span>provider · {policy.reduceTransparency ? 'opaque' : 'normal'}</span>
      <span>renderer · {policy.renderer}</span>
    </div>
  )
}

export function GlassLab() {
  const resolvedTheme = useShellStore((state) => state.resolvedTheme)
  const transparency = useShellStore((state) => state.transparency)
  const [policy, setPolicy] = useState<LabPolicy>(DEFAULT_POLICY)
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(readDiagnostics)
  const [fps, setFps] = useState<number | null>(null)
  const [stress, setStress] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => drawStage(canvas)
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  // 贴图是异步解的，挂载后等一拍再读诊断，看到的是真实条目数。
  useEffect(() => {
    const timer = setTimeout(() => setDiagnostics(readDiagnostics()), 500)
    return () => clearTimeout(timer)
  }, [policy, transparency])

  const runStress = useCallback(() => {
    if (stress) return
    setStress(true)
    void measureFrames(1400).then((value) => {
      setFps(Math.round(value * 10) / 10)
      setStress(false)
      setDiagnostics(readDiagnostics())
    })
  }, [stress])

  const update = <K extends keyof LabPolicy>(key: K, value: LabPolicy[K]) => {
    setPolicy((current) => ({ ...current, [key]: value }))
  }

  return (
    <PageScroll>
      <div className="gl-page">
        <header className="gl-head">
          <div>
            <h1 className="gl-title">玻璃实验 · liquid-glass-react</h1>
            <p className="gl-desc">
              仅 DEV 路由（<code>#/lab/glass</code>）。舞台背景是 canvas 现画的，玻璃组件浮在它上面。
              重点看三件事：折射在 WebView2 上成不成立、深色材质放进 Catrace 观感如何、动画时掉不掉帧。
            </p>
          </div>
          <div className="gl-chips">
            <span className={diagnostics.webview ? 'gl-chip is-ok' : 'gl-chip'}>
              {diagnostics.webview ? 'WebView2' : '非 WebView2'} · Chrome {diagnostics.chrome}
            </span>
            <span className={diagnostics.svg ? 'gl-chip is-ok' : 'gl-chip is-warn'}>
              {diagnostics.svg ? 'url() 背景滤镜可用' : 'url() 不支持（只会磨砂）'}
            </span>
            <span className={transparency ? 'gl-chip' : 'gl-chip is-warn'}>
              应用透明度：{transparency ? '开' : '关'}
            </span>
            {diagnostics.systemReduced && (
              <span className="gl-chip">系统：减少透明度（应用设置优先）</span>
            )}
            <span className="gl-chip">贴图 {diagnostics.entries} · 生成 {diagnostics.generated}</span>
            <span className="gl-chip">观察器 {diagnostics.observers}</span>
            <span className="gl-chip">{fps === null ? 'FPS 未测' : `${fps} fps`}</span>
          </div>
        </header>

        {diagnostics.systemReduced && transparency && (
          <div className="gl-banner" role="status">
            <div className="gl-banner-text">
              <strong>系统要求减少透明度，但这里按应用开关走</strong>
              <span>
                唯一开关是「设置 → 系统 → 界面透明度」；系统那一项只影响其它应用。把它关掉，玻璃会退成实心（LGR 的
                opaque 材质）。
              </span>
            </div>
          </div>
        )}

        {!transparency && (
          <div className="gl-banner" role="status">
            <div className="gl-banner-text">
              <strong>应用透明度已关闭</strong>
              <span>
                玻璃退成实心：没有模糊、没有折射，也不再生成新的贴图（计数里的是切换前缓存的旧图）。在「设置 →
                系统 → 界面透明度」里可以重新打开。
              </span>
            </div>
          </div>
        )}

        <section className="gl-stage" aria-label="玻璃舞台">
          <canvas ref={canvasRef} className="gl-stage-canvas" />
          <GlassProvider
            theme={resolvedTheme}
            material={policy.material}
            renderer={policy.renderer}
            enableSvgAuto={policy.svg}
            transparency={transparency ? 'system' : 'opaque'}
            density="comfortable"
          >
            <GlassBackdrop tone="dark" className="gl-stage-inner">
              <PolicyProbe />
              <div className="gl-stage-toolbar">
                <GlassToolbar aria-label="玻璃实验工具栏">
                  <ToolbarGroup chroma={policy.chroma}>
                    <GlassButton controlSize="small">概览</GlassButton>
                    <GlassButton controlSize="small">事件</GlassButton>
                  </ToolbarGroup>
                  <ToolbarSpacer variant="flexible" />
                  <ToolbarGroup prominent chroma={policy.chroma}>
                    <GlassButton controlSize="small" variant="glassProminent">
                      提醒我
                    </GlassButton>
                  </ToolbarGroup>
                </GlassToolbar>
              </div>

              <div className="gl-stage-controls">
                <GlassSegmentedControl
                  aria-label="时间范围"
                  density="compact"
                  defaultValue="today"
                  items={[
                    { value: 'today', label: '今天' },
                    { value: 'week', label: '本周' },
                    { value: 'month', label: '本月' },
                  ]}
                />
                <GlassSwitch aria-label="专注模式" label="专注模式" defaultChecked density="compact" />
                <GlassPopover
                  title="玻璃上的 Popover"
                  description="面板从按钮长出来，Escape 关闭。"
                  trigger={<GlassButton controlSize="small">打开 Popover</GlassButton>}
                >
                  <p className="gl-popover-text">
                    如果这个 WebView 真的画 <code>url()</code> 背景滤镜，面板边缘会有折射；否则只剩磨砂和底色。
                  </p>
                </GlassPopover>
                <GlassButton
                  controlSize="small"
                  independent
                  chroma={policy.chroma}
                  className={stress ? 'gl-stress' : undefined}
                  onClick={runStress}
                >
                  压力测试
                </GlassButton>
              </div>
            </GlassBackdrop>
          </GlassProvider>
        </section>

        <section className="gl-config" aria-label="参数">
          <div className="gl-field">
            <span className="gl-field-label">
              材质 <code>material</code>
            </span>
            <div className="gl-seg">
              {(['clear', 'regular'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={policy.material === value}
                  onClick={() => update('material', value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className="gl-field">
            <span className="gl-field-label">
              渲染器 <code>renderer</code>
            </span>
            <div className="gl-seg">
              {(['auto', 'svg', 'css'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={policy.renderer === value}
                  onClick={() => update('renderer', value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className="gl-field">
            <span className="gl-field-label">
              SVG 折射 <code>enableSvgAuto</code>
            </span>
            <div className="gl-seg">
              <button type="button" aria-pressed={!policy.svg} onClick={() => update('svg', false)}>
                关
              </button>
              <button type="button" aria-pressed={policy.svg} onClick={() => update('svg', true)}>
                开
              </button>
            </div>
          </div>

          <div className="gl-field">
            <span className="gl-field-label">
              色散 <code>chroma</code>
            </span>
            <div className="gl-seg">
              <button type="button" aria-pressed={!policy.chroma} onClick={() => update('chroma', false)}>
                关
              </button>
              <button type="button" aria-pressed={policy.chroma} onClick={() => update('chroma', true)}>
                开（约三倍滤镜开销）
              </button>
            </div>
          </div>

          <div className="gl-field">
            <span className="gl-field-label">诊断</span>
            <div className="gl-seg">
              <button type="button" onClick={() => setDiagnostics(readDiagnostics())}>
                刷新
              </button>
              <button type="button" onClick={runStress}>
                测 FPS
              </button>
            </div>
          </div>
        </section>

        <section className="gl-notes">
          <h2>怎么看</h2>
          <ul>
            <li>
              <strong>折射</strong>：切 <code>renderer=css</code> 与 <code>svg</code> 对比边缘——svg 时工具栏底边和
              Popover 的圆角处会把背景的竖条折弯，css 时只是磨砂。
            </li>
            <li>
              <strong>材质</strong>：<code>clear</code> 是薄 tint（看得穿），<code>regular</code> 是 tint 0.78 + blur
              14px 的厚材质；Catrace 的深色界面更接近后者。
            </li>
            <li>
              <strong>性能</strong>：点「压力测试」，那块玻璃会左右移动 1.4 秒，期间逐帧都要重算 backdrop；
              右上角 FPS 是这 1.4 秒的平均值。数字仅供参考，不是 GPU 计时。
            </li>
            <li>
              <strong>降级</strong>：把窗口挪到 macOS（WKWebView）打开同一页，徽章会显示 url() 不可用，玻璃只剩磨砂——
              布局和交互不受影响。
            </li>
            <li>
              <strong>透明度开关</strong>：「设置 → 系统 → 界面透明度」是唯一真源，不跟随 Windows 的「透明效果」。
              关闭后玻璃退成实心（LGR 的 <code>opaque</code> 材质，不再生成贴图），侧栏等自绘半透明表面也会一起降级。
            </li>
          </ul>
          <p className="gl-footnote">
            这个页面只在 dev 构建注册路由，也不在侧边栏常驻；确认要不要继续之后，要么删掉，要么换成一个正式页面。
          </p>
        </section>
      </div>
    </PageScroll>
  )
}
