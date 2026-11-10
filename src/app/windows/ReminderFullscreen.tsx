import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Button, Slider } from '@heroui/react'
import { Lock, Unlock } from 'lucide-react'
import {
  getReminderData, snoozeReminder, skipReminder, setFullscreenSettings,
  DEFAULT_ELEMENT_TRANSFORMS, type ElementTransforms,
} from '../../api/tauri'
import { useT } from '../i18n'
import { useShellStore } from '../store'
import './reminder-fullscreen.css'

type ElementName = keyof ElementTransforms
const ELEMENT_NAMES: ElementName[] = ['title', 'body', 'countdown', 'actions']

function defaultTransforms(): ElementTransforms {
  return {
    title: { ...DEFAULT_ELEMENT_TRANSFORMS.title },
    body: { ...DEFAULT_ELEMENT_TRANSFORMS.body },
    countdown: { ...DEFAULT_ELEMENT_TRANSFORMS.countdown },
    actions: { ...DEFAULT_ELEMENT_TRANSFORMS.actions },
  }
}

function formatTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function ElementSlider({
  value,
  min,
  max,
  step,
  label,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  label: string
  onChange: (value: number) => void
}) {
  return (
    <Slider
      className="w-full"
      value={value}
      minValue={min}
      maxValue={max}
      step={step}
      aria-label={label}
      onChange={(next) => {
        if (typeof next === 'number') onChange(next)
      }}
    >
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb />
      </Slider.Track>
    </Slider>
  )
}

const INITIAL_DATA = {
  title: '', body: '', boundary: 0, breakMinutes: 5,
  bgImage: '', opacity: 80, fitMode: 'contain',
}

export default function ReminderFullscreen() {
  const t = useT()
  const locale = useShellStore((state) => state.locale)
  const [data, setData] = useState(INITIAL_DATA)
  const [elementTransforms, setElementTransforms] = useState(defaultTransforms)
  const [isEditMode, setEditMode] = useState(false)
  const [selectedElement, setSelectedElement] = useState<ElementName | null>(null)
  const [dragElement, setDragElement] = useState<ElementName | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const dataRef = useRef(data)
  const transformsRef = useRef(elementTransforms)
  const editRef = useRef(false)
  const selectedRef = useRef<ElementName | null>(null)
  const remainingRef = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ name: ElementName; x: number; y: number; elementX: number; elementY: number } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ready = useRef(false)

  const persistTransforms = async () => {
    const current = dataRef.current
    try {
      await setFullscreenSettings(
        current.bgImage, current.opacity, current.fitMode, JSON.stringify(transformsRef.current),
      )
    } catch (error) {
      console.error('[FS] saveTransforms error:', error)
    }
  }
  const scheduleSave = () => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void persistTransforms()
    }, 300)
  }
  const updateTransforms = (next: ElementTransforms) => {
    transformsRef.current = next
    setElementTransforms(next)
    if (ready.current && !editRef.current) scheduleSave()
  }
  const select = (name: ElementName | null) => {
    selectedRef.current = name
    setSelectedElement(name)
  }

  const handleSkip = async () => {
    if (editRef.current) return
    try { await skipReminder(dataRef.current.boundary) }
    catch (error) { console.error(error) }
    await getCurrentWebviewWindow().close()
  }
  const handleSnooze = async (minutes: number) => {
    if (editRef.current) return
    try { await snoozeReminder(minutes) }
    catch (error) { console.error(error) }
    await getCurrentWebviewWindow().close()
  }

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    void (async () => {
      try {
        const reminder = await getReminderData('reminder-fullscreen')
        if (!alive) return
        if (reminder) {
          const next = {
            title: reminder.title, body: reminder.body, boundary: reminder.boundary,
            breakMinutes: reminder.break_minutes || 5,
            bgImage: reminder.fullscreen_bg ?? '', opacity: reminder.fullscreen_opacity ?? 80,
            fitMode: reminder.fullscreen_fit_mode ?? 'contain',
          }
          const transforms = defaultTransforms()
          if (reminder.fullscreen_element_transforms) {
            try {
              const parsed = JSON.parse(reminder.fullscreen_element_transforms) as ElementTransforms
              for (const name of ELEMENT_NAMES) {
                if (parsed[name]) transforms[name] = { ...DEFAULT_ELEMENT_TRANSFORMS[name], ...parsed[name] }
              }
            } catch (error) { console.error('[FS] Failed to parse element transforms:', error) }
          }
          dataRef.current = next
          setData(next)
          ready.current = true
          updateTransforms(transforms)
        }
      } catch (error) { console.error('[FS] loadData error:', error) }
      if (!alive) return
      remainingRef.current = dataRef.current.breakMinutes * 60
      setRemainingSeconds(remainingRef.current)
      timer = setInterval(() => {
        if (remainingRef.current <= 0) return
        remainingRef.current -= 1
        setRemainingSeconds(remainingRef.current)
        if (remainingRef.current === 0) {
          if (timer !== null) clearInterval(timer)
          void handleSkip()
        }
      }, 1000)
    })()
    return () => {
      alive = false
      if (timer !== null) clearInterval(timer)
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
        void persistTransforms()
      }
    }
    // The window owns one countdown; editing reads the current values through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const wheel = (event: WheelEvent) => {
      // The non-passive native listener prevents wheel scrolling while editing elements.
      if (!(event.target instanceof Element) || !event.target.closest('.reminder-fullscreen-editable-element')) return
      event.preventDefault()
      const selected = selectedRef.current
      if (!editRef.current || !selected) return
      const current = transformsRef.current
      const scale = Math.round(Math.max(0.3, Math.min(3, current[selected].scale + (event.deltaY > 0 ? -0.05 : 0.05))) * 100) / 100
      updateTransforms({ ...current, [selected]: { ...current[selected], scale } })
    }
    root.addEventListener('wheel', wheel, { passive: false })
    return () => root.removeEventListener('wheel', wheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleEditMode = () => {
    editRef.current = !editRef.current
    setEditMode(editRef.current)
    if (!editRef.current) {
      select(null)
      scheduleSave()
    }
  }
  const startDrag = (name: ElementName, event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (!editRef.current) return
    const current = transformsRef.current[name]
    drag.current = { name, x: event.clientX, y: event.clientY, elementX: current.x, elementY: current.y }
    setDragElement(name)
  }
  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const currentDrag = drag.current
    if (!currentDrag) return
    const { name, x, y, elementX, elementY } = currentDrag
    const current = transformsRef.current
    updateTransforms({ ...current, [name]: {
      ...current[name],
      x: Math.round(Math.min(90, Math.max(10, elementX + (event.clientX - x) / window.innerWidth * 100))),
      y: Math.round(Math.min(90, Math.max(10, elementY + (event.clientY - y) / window.innerHeight * 100))),
    } })
  }
  const stopDrag = () => { drag.current = null; setDragElement(null) }
  const updateSelected = (field: 'scale' | 'rotate', value: number) => {
    if (!selectedElement) return
    const current = transformsRef.current
    updateTransforms({ ...current, [selectedElement]: { ...current[selectedElement], [field]: value } })
  }
  const editable = (name: ElementName, children: ReactNode) => {
    const transform = elementTransforms[name]
    const style: CSSProperties = {
      left: `${transform.x}%`, top: `${transform.y}%`,
      transform: `translate(-50%, -50%) scale(${transform.scale}) rotate(${transform.rotate}deg)`,
    }
    return <div
      className={`reminder-fullscreen-editable-element${isEditMode ? ' edit-mode' : ''}${selectedElement === name ? ' selected' : ''}${dragElement === name ? ' dragging' : ''}`}
      style={style}
      onClick={(event) => { event.stopPropagation(); if (editRef.current) select(name) }}
      onMouseDown={(event) => startDrag(name, event)}
    >
      {isEditMode && <div className="reminder-fullscreen-element-label">{name === 'body' ? 'Body' : name[0].toUpperCase() + name.slice(1)}</div>}
      {children}
    </div>
  }

  // 全屏提醒永远叠在背景图/桌面上：Radix 控件局部用深色外观，避免浅色主题下按钮和滑块
  // 跟暗色控制条、白色文案对不上。这里只覆盖本窗口，不动全局主题。
  const content = <div ref={rootRef} data-theme="dark" className="reminder-fullscreen-root" onMouseMove={onMouseMove} onMouseUp={stopDrag} onMouseLeave={stopDrag} onClick={() => select(null)}>
    {data.bgImage && <>
      <div className="reminder-fullscreen-bg" style={{ backgroundImage: `url(${data.bgImage})`, opacity: data.opacity / 100 }} />
      <div className="reminder-fullscreen-sharp" style={{ backgroundImage: `url(${data.bgImage})`, backgroundSize: data.fitMode === 'fill' ? '100% 100%' : data.fitMode, opacity: data.opacity / 100 }} />
    </>}
    <div className="reminder-fullscreen-edit-toggle" onClick={(event) => { event.stopPropagation(); toggleEditMode() }}>
      <Button type="button" isIconOnly variant="ghost" size="lg" aria-label={t(isEditMode ? 'reminder.lock' : 'reminder.unlock')}>
        {isEditMode ? <Unlock size={20} /> : <Lock size={20} />}
      </Button>
    </div>
    {isEditMode && <div className="reminder-fullscreen-edit-toolbar">
      <div className="reminder-fullscreen-toolbar-title">{t('reminder.editMode')}</div>
      <div className="reminder-fullscreen-toolbar-hint">{selectedElement ? `${t('reminder.scale')} / ${t('reminder.rotate')}` : locale === 'zh-CN' ? '点击元素以选中' : 'Click element to select'}</div>
    </div>}
    {editable('title', <h1 className="reminder-fullscreen-title">{data.title}</h1>)}
    {editable('body', <p className="reminder-fullscreen-subtitle">{data.body}</p>)}
    {editable('countdown', <div className="reminder-fullscreen-countdown">
      <div className="reminder-fullscreen-countdown-label">{t('reminder.countdown')}</div>
      <div className="reminder-fullscreen-countdown-time">{formatTime(remainingSeconds)}</div>
    </div>)}
    {editable('actions', <div className="reminder-fullscreen-actions">
      <Button type="button" variant="tertiary" size="lg" onClick={(event) => { event.stopPropagation(); void handleSnooze(5) }}>{t('reminder.snooze5')}</Button>
      <Button type="button" variant="tertiary" size="lg" onClick={(event) => { event.stopPropagation(); void handleSnooze(10) }}>{t('reminder.snooze10')}</Button>
      <Button type="button" variant="primary" size="lg" onClick={(event) => { event.stopPropagation(); void handleSkip() }}>{t('reminder.skip')}</Button>
    </div>)}
    {isEditMode && selectedElement && <div className="reminder-fullscreen-element-controls" onClick={(event) => event.stopPropagation()}>
      <div className="reminder-fullscreen-control-row">
        <span className="reminder-fullscreen-control-label">{t('reminder.scale')}</span>
        <ElementSlider value={elementTransforms[selectedElement].scale} min={0.3} max={3} step={0.05} label={t('reminder.scale')} onChange={(value) => updateSelected('scale', value)} />
        <span className="reminder-fullscreen-control-value">{Math.round(elementTransforms[selectedElement].scale * 100)}%</span>
      </div>
      <div className="reminder-fullscreen-control-row">
        <span className="reminder-fullscreen-control-label">{t('reminder.rotate')}</span>
        <ElementSlider value={elementTransforms[selectedElement].rotate} min={-180} max={180} step={1} label={t('reminder.rotate')} onChange={(value) => updateSelected('rotate', value)} />
        <span className="reminder-fullscreen-control-value">{elementTransforms[selectedElement].rotate}°</span>
      </div>
      <Button type="button" variant="tertiary" size="sm" fullWidth onClick={() => updateTransforms({ ...transformsRef.current, [selectedElement]: { ...DEFAULT_ELEMENT_TRANSFORMS[selectedElement] } })}>{t('reminder.resetElement')}</Button>
    </div>}
  </div>

  return content
}
