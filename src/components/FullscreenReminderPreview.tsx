import { useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../app/i18n'
import { FullscreenReminderScene, type FullscreenReminderSceneProps } from './FullscreenReminderScene'
import './fullscreen-reminder-preview.css'

type PreviewProps = Omit<FullscreenReminderSceneProps, 'renderElement' | 'onSnooze' | 'onSkip'>

/** A uniformly scaled 16:9 scene. It never mounts the native-window controller. */
export function FullscreenReminderPreview(props: PreviewProps) {
  const t = useT()
  const viewport = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useLayoutEffect(() => {
    const host = viewport.current
    const scene = canvas.current
    if (!host || !scene) return
    const resize = () => setScale(scene.offsetWidth > 0 ? host.clientWidth / scene.offsetWidth : 0)
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    observer.observe(scene)
    resize()
    return () => observer.disconnect()
  }, [])

  return (
    <figure className="ct-fullscreen-preview-figure">
      <div ref={viewport} className="ct-fullscreen-preview" role="img" aria-label={t('plugins.rest.fullscreenPreviewLabel')}>
        <div
          ref={canvas}
          className="ct-fullscreen-preview-canvas"
          data-theme="dark"
          inert
          aria-hidden="true"
          style={{ transform: `scale(${scale})`, visibility: scale > 0 ? 'visible' : 'hidden' }}
        >
          <FullscreenReminderScene {...props} />
        </div>
      </div>
      <figcaption>{t('plugins.rest.fullscreenPreviewHint')}</figcaption>
    </figure>
  )
}
