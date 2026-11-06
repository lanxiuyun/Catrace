import { useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertDialog, Button, Switch } from '@radix-ui/themes'
import {
  Armchair, ArrowDownToLine, Check, ChevronLeft, ChevronRight, CircleAlert,
  FolderOpen, LoaderCircle, Plug, RefreshCw, Search, Trash2,
} from 'lucide-react'
import { openPluginsDir, type PluginCatalogEntry, type RepositoryPluginInfo } from '../../../api/tauri'
import { useT } from '../../i18n'
import { PageScroll } from '../../components/PageScroll'
import { RadixPage } from '../../components/RadixPage'
import { showToast } from '../../ui/toast'
import { ExternalPluginSettings } from './ExternalPluginSettings'
import { usePluginCatalog } from './usePluginCatalog'
import { PluginSourceSettings } from './PluginSourceSettings'

type PluginItem = {
  id: string
  name: string
  description: string
  version: string
  builtin?: boolean
  installed?: PluginCatalogEntry
  available?: RepositoryPluginInfo
}

type Props = {
  restEnabled: boolean
  restBusy: boolean
  restReady: boolean
  onToggleRest: (value: boolean) => void
  children: ReactNode
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> }
}

/**
 * The detail is an in-page view, but it must answer the system Back button (mouse side button,
 * Alt+Left). It therefore owns a history entry with the list URL and this state on it, so a POP
 * can close the detail instead of leaving the plugin page. See `openDetails` / `closeDetails`.
 */
type DetailHistoryState = { pluginDetail?: string }

const detailIdFromHistory = (state: unknown): string | null => {
  const id = (state as DetailHistoryState | null)?.pluginDetail
  return typeof id === 'string' && id ? id : null
}

/** React Router keeps its position in `window.history.state.idx`; 0 means there is nothing to pop. */
const historyIndex = () => (window.history.state as { idx?: number } | null)?.idx ?? 0

type PageTransition = 'push' | 'back'
/** Guards the transient inline style when two transitions overlap (no interruption support). */
let transitionSequence = 0
/** How far the detail scrolls before its nav bar takes on the toolbar material. */
const NAV_MATERIAL_SCROLL = 12

/**
 * List ↔ detail is an iOS-style push/pop: only the page content viewport is snapshotted
 * (the sidebar stays put). ::view-transition-* rules cannot be scoped by a document
 * attribute, so the direction travels as the view-transition-name itself and plugins.css
 * has matching keyframes for ct-plugin-push / ct-plugin-back.
 * WebViews without the View Transitions API keep the instant swap.
 */
const runPageTransition = (direction: PageTransition, apply: () => void, afterCommit?: () => void) => {
  const doc = document as ViewTransitionDocument
  if (typeof doc.startViewTransition !== 'function') {
    apply()
    if (afterCommit) requestAnimationFrame(afterCommit)
    return
  }
  const scroller = document.querySelector<HTMLElement>('.ct-plugin-scroll')
  const id = ++transitionSequence
  scroller?.style.setProperty('view-transition-name', direction === 'push' ? 'ct-plugin-push' : 'ct-plugin-back')
  const clear = () => { if (id === transitionSequence) scroller?.style.removeProperty('view-transition-name') }
  try {
    doc.startViewTransition(() => {
      flushSync(apply)
      afterCommit?.()
    }).finished.then(clear, clear)
  } catch {
    clear()
    apply()
    if (afterCommit) requestAnimationFrame(afterCommit)
  }
}

export function PluginCenter({ restEnabled, restBusy, restReady, onToggleRest, children }: Props) {
  const t = useT()
  const location = useLocation()
  const navigate = useNavigate()
  const data = usePluginCatalog()
  // Installed plugins lead: what this machine already has is the common visit.
  const [tab, setTab] = useState<'discover' | 'installed'>('installed')
  const [query, setQuery] = useState('')
  // The history entry wins on mount (coming Back from another page or reloading while a detail
  // is open), afterwards the two are kept in sync by `openDetails` / `closeDetails` / the POP effect.
  const historyDetailId = detailIdFromHistory(location.state)
  const [selectedId, setSelectedId] = useState<string | null>(historyDetailId)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [entering, setEntering] = useState<Set<string>>(() => new Set())
  const seenIds = useRef<Record<'discover' | 'installed', Set<string>>>({ discover: new Set(), installed: new Set() })
  const primedTabs = useRef<Record<'discover' | 'installed', boolean>>({ discover: false, installed: false })
  const detailOpener = useRef<HTMLButtonElement | null>(null)
  const alertOpener = useRef<HTMLElement | null>(null)
  const detailHeading = useRef<HTMLHeadingElement | null>(null)
  const detailSection = useRef<HTMLElement | null>(null)
  const listScroll = useRef(0)
  // Set when the UI itself closes the detail: the history entry is being popped on our behalf,
  // so the POP must not start a second transition.
  const closedByUi = useRef(false)
  // A close is requested but its state commit is still pending (the transition callback runs on
  // the next frame); repeated requests would stack transitions and pop extra history entries.
  const closePending = useRef(false)
  // Uninstall closes the detail from inside an async operation, so `selectedId` and the history
  // marker are read through refs: the closure that started the request is already stale by then.
  const selectedIdRef = useRef(selectedId)
  const historyDetailRef = useRef(historyDetailId)
  useEffect(() => {
    selectedIdRef.current = selectedId
    historyDetailRef.current = historyDetailId
  }, [selectedId, historyDetailId])
  // The detail nav bar is transparent until content scrolls underneath it; the plugin name
  // takes over the bar once the hero title leaves, so the page never loses its context.
  const [navScrolled, setNavScrolled] = useState(false)
  const [navTitled, setNavTitled] = useState(false)
  const restoreListPosition = () => {
    const scroller = document.querySelector<HTMLElement>('.ct-plugin-scroll')
    if (scroller) scroller.scrollTop = listScroll.current
    const opener = detailOpener.current
    if (opener?.isConnected) {
      opener.focus({ preventScroll: true })
      return
    }
    // After an uninstall the card that opened the detail is gone: keep keyboard focus inside the
    // page (the active tab) instead of dropping it on <body>.
    document.querySelector<HTMLElement>('.ct-market-tabs button[aria-pressed="true"]')?.focus({ preventScroll: true })
  }
  const openDetails = (id: string, opener: HTMLButtonElement) => {
    detailOpener.current = opener
    const scroller = opener.closest<HTMLElement>('.ct-page-scroll')
    listScroll.current = scroller?.scrollTop ?? 0
    // A detail always starts at its own top: opening from a scrolled list used to land the
    // reader in the middle of the page with the header already off-screen.
    runPageTransition('push', () => {
      setSelectedId(id)
      if (scroller) scroller.scrollTop = 0
    }, () => {
      // One detail = one history entry, so the system Back button pops just the detail. The entry
      // is added after the list has been committed, so the history-driven effect below sees the
      // two sides already in sync and does not start a second transition.
      navigate(location.pathname, { state: { pluginDetail: id } satisfies DetailHistoryState })
    })
  }
  // Idempotent on purpose: uninstall/reload effects can ask to close while the previous close is
  // still animating, and popping history twice would skip past the plugin list altogether.
  const closeDetails = () => {
    if (!selectedIdRef.current || closePending.current) return
    closePending.current = true
    const ownsHistoryEntry = !!historyDetailRef.current
    closedByUi.current = ownsHistoryEntry
    runPageTransition('back', () => setSelectedId(null), restoreListPosition)
    if (!ownsHistoryEntry) return
    // Pop the detail entry instead of stacking a second list page on top of it, so the next
    // Back still leaves the plugin page. Without anything to pop (deep link / reload) the
    // marker is dropped in place.
    if (historyIndex() > 0) navigate(-1)
    else navigate(location.pathname, { replace: true, state: null })
  }
  // System Back / Forward / Alt+Left drive the router history; replay them as the same
  // push/pop the buttons use. Only the detail's own entry changes this state, so a POP that
  // drops it closes the detail, and Forward restores it.
  useEffect(() => {
    if (closedByUi.current) {
      closedByUi.current = false
      return
    }
    if (historyDetailId === selectedId) return
    if (historyDetailId) runPageTransition('push', () => {
      setSelectedId(historyDetailId)
      // Forward lands on the detail the same way a card click does: from its own top.
      const scroller = detailSection.current?.closest<HTMLElement>('.ct-page-scroll')
      if (scroller) scroller.scrollTop = 0
    })
    else runPageTransition('back', () => setSelectedId(null), restoreListPosition)
    // Deliberately keyed on history movement only: the UI paths update `selectedId` and the entry
    // in step, so re-running this on `selectedId` would replay its own transition.
  }, [historyDetailId])
  const restoreAlertFocus = (event: Event) => {
    event.preventDefault()
    alertOpener.current?.focus()
  }
  // Uninstall removes the very thing the detail is about: leave it the way the back button does
  // instead of parking the reader on a now-uninstalled plugin. A failed attempt keeps the detail
  // so the error stays in context; a detail that is already gone is a no-op.
  const confirmUninstall = async (id: string) => {
    setRemoveId(null)
    const removed = await data.uninstall(id)
    if (removed) closeDetails()
  }
  useEffect(() => {
    if (selectedId) detailHeading.current?.focus()
    // The close is only finished once the detail has actually left the DOM again.
    else closePending.current = false
  }, [selectedId])

  // Nav bar state for the detail: the toolbar material appears only once content is under the
  // bar (a translucent band over an empty background is just a smudge), and the plugin name
  // replaces the hero title in the bar once the title has scrolled out of view.
  useEffect(() => {
    if (!selectedId) {
      setNavScrolled(false)
      setNavTitled(false)
      return
    }
    const section = detailSection.current
    const scroller = section?.closest<HTMLElement>('.ct-page-scroll')
    const nav = section?.querySelector<HTMLElement>('.ct-plugin-detail-nav')
    if (!scroller || !nav) return
    let frame = 0
    const measure = () => {
      frame = 0
      const heading = detailHeading.current
      setNavScrolled(scroller.scrollTop > NAV_MATERIAL_SCROLL)
      setNavTitled(!!heading && heading.getBoundingClientRect().bottom <= nav.getBoundingClientRect().bottom)
    }
    const requestMeasure = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    scroller.addEventListener('scroll', requestMeasure, { passive: true })
    window.addEventListener('resize', requestMeasure)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', requestMeasure)
      window.removeEventListener('resize', requestMeasure)
    }
  }, [selectedId])
  const busy = data.busyId !== null || restBusy || data.sourceBusy
  const installedById = new Map(data.installed.map((entry) => [entry.info.id, entry]))
  const availableById = new Map(data.repository?.plugins.map((entry) => [entry.id, entry]) ?? [])
  const builtin: PluginItem = {
    id: 'rest', name: t('plugins.rest.name'), description: t('plugins.rest.subtitle'),
    version: '', builtin: true,
  }
  const installedItems: PluginItem[] = [builtin, ...data.installed.map((entry) => ({
    ...entry.info, installed: entry, available: availableById.get(entry.info.id),
  }))]
  const discoverItems: PluginItem[] = (data.repository?.plugins ?? []).map((entry) => ({
    ...entry, available: entry, installed: installedById.get(entry.id),
  }))
  const allItems = new Map([...discoverItems, ...installedItems].map((item) => [item.id, item]))
  const selected = selectedId ? allItems.get(selectedId) : undefined
  const selectedEnabled = selected?.builtin ? restEnabled : !!selected?.installed?.info.enabled
  const selectedError = selected?.installed?.info.error
  const normalized = query.trim().toLowerCase()
  const isInstalled = (item: PluginItem) => item.builtin || !!item.installed
  const isEnabled = (item: PluginItem) => item.builtin ? restEnabled : !!item.installed?.info.enabled
  // Repository order follows plugin IDs, which reads as random next to the display
  // names on the cards; sort every list by the name the user actually sees.
  const byName = (a: PluginItem, b: PluginItem) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const visibleItems = (tab === 'installed' ? installedItems : discoverItems)
    .filter((item) => `${item.id} ${item.name} ${item.description}`.toLowerCase().includes(normalized))
    .sort(byName)

  // Only cards that genuinely appear later animate in; reordering, toggling and re-showing the
  // list after closing a detail keep their position and stay still.
  const visibleIds = visibleItems.map((item) => item.id).join('|')
  useEffect(() => {
    const bucket = seenIds.current[tab]
    const ids = visibleIds ? visibleIds.split('|') : []
    if (!primedTabs.current[tab]) {
      if (!ids.length) return
      for (const id of ids) bucket.add(id)
      primedTabs.current[tab] = true
      return
    }
    const fresh = ids.filter((id) => !bucket.has(id))
    for (const id of ids) bucket.add(id)
    if (!fresh.length) return
    setEntering(new Set(fresh))
    const timer = setTimeout(() => setEntering(new Set()), 200)
    return () => clearTimeout(timer)
  }, [visibleIds, tab])

  // Uninstalling (or a failed reload dropping the plugin) removes the detail out from under the
  // reader: leave it the same way the back button does, history entry included.
  useEffect(() => {
    if (selectedId && !allItems.has(selectedId) && !data.loadingLocal && !data.loadingRemote) {
      closeDetails()
    }
  }, [selectedId, data.installed, data.repository, data.loadingLocal, data.loadingRemote])

  const reportError = (error: unknown) => showToast(t('pluginMarket.operationFailed', { error: String(error) }), 'error')
  const openDirectory = () => void openPluginsDir().catch(reportError)
  const hasOtherSource = (item: PluginItem) => !!item.available && !!item.installed?.info.sourceRepository
    && item.installed.info.sourceRepository !== data.source
  // Discover answers "do I have it"; the installed tab shows the switch itself instead of
  // repeating the state in a badge. Only exception states need a footer line.
  const statusLabel = (item: PluginItem) => {
    if (item.installed?.info.error) return t('pluginMarket.needsAttention')
    if (hasOtherSource(item)) return t('pluginMarket.sourceOtherInstalled')
    return ''
  }
  const installedBadge = (item: PluginItem) => tab === 'discover' && item.installed
    ? <span className="ct-market-card-flag"><Check size={10} aria-hidden="true" />{t('pluginMarket.installed')}</span>
    : null
  const icon = (item: PluginItem) => item.builtin ? <Armchair aria-hidden="true" /> : item.installed?.iconDataUrl
    ? <img src={item.installed.iconDataUrl} alt="" /> : <Plug aria-hidden="true" />
  const installButton = (item: PluginItem) => (
    <Button size="2" variant="soft" disabled={busy || data.loadingLocal || !!data.localError} onClick={() => void data.install(item.id)}>
      {data.busyId === item.id ? <LoaderCircle className="ct-market-spin" size={14} aria-hidden="true" /> : <ArrowDownToLine size={14} aria-hidden="true" />}
      {t(data.busyId === item.id ? 'pluginMarket.installing' : 'pluginMarket.install')}
    </Button>
  )
  // The switch is the whole action: no confirmation sheet, both directions apply directly.
  const toggleCard = (item: PluginItem, value: boolean) => {
    if (item.builtin) { onToggleRest(value); return }
    void data.toggle(item.id, value)
  }

  return (
    <PageScroll className="ct-plugin-scroll">
      <RadixPage className="ct-plugins-page">
        <main className="ct-market" hidden={!!selected} aria-label={t('pluginMarket.title')}>
          <div className="ct-market-toolbar">
            <div className="ct-market-tabs" role="group" aria-label={t('pluginMarket.filter')}>
              <button type="button" aria-pressed={tab === 'installed'} className={tab === 'installed' ? 'is-active' : ''} onClick={() => setTab('installed')}>{t('pluginMarket.myPlugins')}<span>{data.loadingLocal ? '—' : installedItems.length}</span></button>
              <button type="button" aria-pressed={tab === 'discover'} className={tab === 'discover' ? 'is-active' : ''} onClick={() => setTab('discover')}>{t('pluginMarket.discover')}</button>
            </div>
            <div className="ct-market-tools">
              <label className="ct-plugin-search ct-market-search"><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('pluginsCenter.searchPlaceholder')} aria-label={t('pluginsCenter.searchPlaceholder')} spellCheck={false} /></label>
              <PluginSourceSettings source={data.source} mirror={data.mirror} saving={data.sourceBusy} disabled={data.sourceBusy} onChange={data.changeSource} />
              <div className="ct-market-tool-group">
                <button type="button" className="ct-plugin-icon-btn ct-market-label-btn" onClick={openDirectory}>
                  <FolderOpen size={15} aria-hidden="true" />
                  <span>{t('plugins.external.openDir')}</span>
                </button>
                <button type="button" className="ct-plugin-icon-btn" aria-label={t('pluginMarket.refresh')} disabled={data.loadingRemote || data.loadingLocal} onClick={() => { void data.refreshLocal(); void data.refreshRemote() }}><RefreshCw size={15} aria-hidden="true" /></button>
              </div>
            </div>
          </div>

          {data.localError && <div className="ct-market-error" role="alert"><CircleAlert size={18} aria-hidden="true" /><div><strong>{t('pluginMarket.localFailed')}</strong><p>{data.localError}</p></div><Button size="1" variant="soft" onClick={() => void data.refreshLocal()} disabled={data.loadingLocal}>{t('pluginMarket.retry')}</Button></div>}
          {tab === 'discover' && data.remoteError && <div className="ct-market-error" role="alert"><CircleAlert size={18} aria-hidden="true" /><div><strong>{t('pluginMarket.remoteFailed')}</strong><p>{data.remoteError}</p><p>{t('pluginMarket.offlineHint')}</p>{!data.mirror && !data.source.startsWith('https://gitee.com/') && <p>{t('pluginMarket.mirrorSuggestion')}</p>}</div><Button size="1" variant="soft" onClick={() => void data.refreshRemote()} disabled={busy || data.loadingRemote}>{t('pluginMarket.retry')}</Button></div>}

          <section className="ct-market-grid" aria-label={t(tab === 'discover' ? 'pluginMarket.discover' : 'pluginMarket.myPlugins')} aria-busy={tab === 'discover' ? data.loadingRemote : data.loadingLocal}>
            {(tab === 'discover' ? data.loadingRemote && !data.repository : data.loadingLocal && data.installed.length === 0) ? (
              <div className="ct-market-empty" role="status"><LoaderCircle className="ct-market-spin" size={24} aria-hidden="true" /><p>{t('pluginMarket.loading')}</p></div>
            ) : visibleItems.length ? visibleItems.map((item) => (
              <article key={item.id} className={`ct-market-card${tab === 'installed' ? ' has-toggle' : ''}${tab === 'installed' && !isEnabled(item) ? ' is-off' : ''}${entering.has(item.id) ? ' is-entering' : ''}`}>
                {/* One hit area for the whole card; the switch and install button paint above it. */}
                <button type="button" className="ct-market-card-open" onClick={(event) => openDetails(item.id, event.currentTarget)} aria-label={t('pluginMarket.detailsFor', { name: item.name })} />
                <div className="ct-market-card-main">
                  <span className={`ct-market-plugin-icon${item.builtin ? ' is-builtin' : ''}`}>{icon(item)}</span>
                  <div className="ct-market-card-copy"><h3>{item.name}</h3><span className="ct-market-card-meta">{item.builtin ? t('pluginsCenter.builtinTag') : `v${item.version}`}{installedBadge(item)}</span></div>
                  {tab !== 'installed' && <ChevronRight size={15} className="ct-market-card-arrow" aria-hidden="true" />}
                  <p>{item.description || t('plugins.external.noDescription')}</p>
                </div>
                {tab === 'installed' && <div className="ct-market-card-toggle"><Switch size="2" checked={isEnabled(item)} disabled={!!item.installed?.info.error || (item.builtin && !restReady)} aria-label={t('pluginMarket.enableFor', { name: item.name })} onCheckedChange={(value) => toggleCard(item, value)} /></div>}
                {(statusLabel(item) || !isInstalled(item)) && <div className="ct-market-card-footer">
                  {statusLabel(item) && <span className={`ct-market-card-status${item.installed?.info.error ? ' is-error' : ''}`}>
                    {item.installed?.info.error ? <CircleAlert size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
                    {statusLabel(item)}
                  </span>}
                  {!isInstalled(item) && installButton(item)}
                </div>}
              </article>
            )) : <div className="ct-market-empty"><Search size={25} aria-hidden="true" /><h3>{t(query ? 'plugins.searchEmpty' : 'pluginMarket.noPlugins')}</h3><p>{t(query ? 'pluginMarket.searchHint' : 'pluginMarket.retryHint')}</p>{query && <Button variant="soft" onClick={() => setQuery('')}>{t('pluginMarket.clearSearch')}</Button>}</div>}
          </section>

        </main>

        <section ref={detailSection} className="ct-plugin-detail" hidden={!selected} aria-labelledby="ct-plugin-detail-title">
            {selected && <>
              <div className={`ct-plugin-detail-nav${navScrolled ? ' is-scrolled' : ''}${navTitled ? ' is-titled' : ''}`}>
                <button className="ct-plugin-detail-back" type="button" aria-label={t('pluginMarket.back')} onClick={closeDetails}><ChevronLeft size={17} aria-hidden="true" /><span>{t('pluginMarket.title')}</span></button>
                <span className="ct-plugin-detail-nav-title" aria-hidden="true">{selected.name}</span>
              </div>
              <header className="ct-plugin-detail-header">
                <div className="ct-plugin-detail-identity"><span className={`ct-market-plugin-icon is-large${selected.builtin ? ' is-builtin' : ''}`}>{icon(selected)}</span><div className="ct-plugin-detail-titles"><h2 id="ct-plugin-detail-title" ref={detailHeading} tabIndex={-1}>{selected.name}</h2><span className="ct-plugin-tag">{selected.builtin ? t('pluginsCenter.builtinTag') : `v${selected.installed?.info.version ?? selected.version}`}</span></div>{isInstalled(selected) ? <Switch checked={selectedEnabled} disabled={busy || !!selectedError || (!!selected.builtin && !restReady)} aria-label={t('pluginMarket.enableFor', { name: selected.name })} onCheckedChange={(value) => { if (selected.builtin) onToggleRest(value); else void data.toggle(selected.id, value) }} /> : installButton(selected)}</div>
                <p className="ct-plugin-detail-description">{selected.description || t('plugins.external.noDescription')}</p>
              </header>
              {selectedError && <div className="ct-market-error" role="alert"><CircleAlert size={17} aria-hidden="true" /><div><strong>{t('pluginMarket.needsAttention')}</strong><p>{selectedError}</p></div></div>}
              <div className="ct-plugin-detail-body" key={selected.id}>
                {selected.builtin ? children : selected.installed ? <>
                  {selectedEnabled && !selectedError && <ExternalPluginSettings id={selected.id} hasSettings={selected.installed.info.hasSettings} contentMtimeMs={selected.installed.info.contentMtimeMs} />}
                  <section className="ct-plugin-group ct-market-installation"><h3 className="ct-plugin-group-title">{t('pluginMarket.installation')}</h3><dl><div><dt>{t('pluginMarket.identifier')}</dt><dd>{selected.id}</dd></div><div><dt>{t('pluginMarket.source')}</dt><dd>{selected.installed.info.sourceRepository ?? t('pluginMarket.sourceUnknown')}</dd></div>{selected.installed.info.sourceCommit && <div><dt>{t('pluginMarket.sourceCommit')}</dt><dd><code>{selected.installed.info.sourceCommit}</code></dd></div>}<div><dt>{t('plugins.external.dir')}</dt><dd><code>{selected.installed.info.dir}</code></dd></div></dl><div className="ct-market-remove-row"><p>{t('pluginMarket.uninstallHint')}</p><Button variant="soft" color="red" disabled={busy} onClick={(event) => { alertOpener.current = event.currentTarget; setRemoveId(selected.id) }}><Trash2 size={14} aria-hidden="true" />{t('pluginMarket.uninstall')}</Button></div></section>
                </> : null}
              </div>
            </>}
        </section>

        <AlertDialog.Root open={!!removeId} onOpenChange={(open) => { if (!open) setRemoveId(null) }}><AlertDialog.Content maxWidth="28rem" onCloseAutoFocus={restoreAlertFocus}><AlertDialog.Title>{t('pluginMarket.uninstallTitle', { name: allItems.get(removeId ?? '')?.name ?? removeId ?? '' })}</AlertDialog.Title><AlertDialog.Description>{t('pluginMarket.uninstallDescription')}</AlertDialog.Description><div className="ct-market-confirm-actions"><AlertDialog.Cancel><Button variant="soft" color="gray">{t('pluginMarket.cancel')}</Button></AlertDialog.Cancel><AlertDialog.Action><Button color="red" onClick={() => { if (removeId) void confirmUninstall(removeId) }}>{t('pluginMarket.uninstall')}</Button></AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Root>
      </RadixPage>
    </PageScroll>
  )
}
