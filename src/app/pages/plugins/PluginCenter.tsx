import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertDialog, Button, Switch } from '@radix-ui/themes'
import {
  Armchair, ArrowDownToLine, Check, ChevronRight, CircleAlert,
  FolderOpen, Github, LoaderCircle, Plug, RefreshCw, Search, ShieldCheck, Trash2, X,
} from 'lucide-react'
import { openPluginsDir, type PluginCatalogEntry, type RepositoryPluginInfo } from '../../../api/tauri'
import { useT } from '../../i18n'
import { PageScroll } from '../../components/PageScroll'
import { RadixPage } from '../../components/RadixPage'
import { showToast } from '../../ui/toast'
import { ExternalPluginSettings } from './ExternalPluginSettings'
import { usePluginCatalog } from './usePluginCatalog'

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

export function PluginCenter({ restEnabled, restBusy, restReady, onToggleRest, children }: Props) {
  const t = useT()
  const data = usePluginCatalog()
  const [tab, setTab] = useState<'discover' | 'installed'>('discover')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [trustId, setTrustId] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const detailOpener = useRef<HTMLButtonElement | null>(null)
  const alertOpener = useRef<HTMLElement | null>(null)
  const detailHeading = useRef<HTMLHeadingElement | null>(null)
  const listScroll = useRef(0)
  const openDetails = (id: string, opener: HTMLButtonElement) => {
    detailOpener.current = opener
    listScroll.current = opener.closest('.ct-page-scroll')?.scrollTop ?? 0
    setSelectedId(id)
  }
  const closeDetails = () => {
    setSelectedId(null)
    requestAnimationFrame(() => {
      const opener = detailOpener.current
      opener?.focus({ preventScroll: true })
      const scroll = opener?.closest('.ct-page-scroll')
      if (scroll) scroll.scrollTop = listScroll.current
    })
  }
  const restoreAlertFocus = (event: Event) => {
    event.preventDefault()
    alertOpener.current?.focus()
  }
  useEffect(() => {
    if (selectedId) detailHeading.current?.focus()
  }, [selectedId])
  const busy = data.busyId !== null || restBusy
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
  const visibleItems = (tab === 'installed' ? installedItems : discoverItems).filter((item) =>
    `${item.id} ${item.name} ${item.description}`.toLowerCase().includes(normalized),
  )

  useEffect(() => {
    if (selectedId && !allItems.has(selectedId) && !data.loadingLocal && !data.loadingRemote) {
      setSelectedId(null)
    }
  }, [selectedId, data.installed, data.repository, data.loadingLocal, data.loadingRemote])

  const reportError = (error: unknown) => showToast(t('pluginMarket.operationFailed', { error: String(error) }), 'error')
  const openDirectory = () => void openPluginsDir().catch(reportError)
  const isInstalled = (item: PluginItem) => item.builtin || !!item.installed
  const isEnabled = (item: PluginItem) => item.builtin ? restEnabled : !!item.installed?.info.enabled
  const icon = (item: PluginItem) => item.builtin ? <Armchair aria-hidden="true" /> : item.installed?.iconDataUrl
    ? <img src={item.installed.iconDataUrl} alt="" /> : <Plug aria-hidden="true" />
  const installButton = (item: PluginItem) => (
    <Button size="2" variant="soft" disabled={busy || data.loadingLocal || !!data.localError} onClick={() => void data.install(item.id)}>
      {data.busyId === item.id ? <LoaderCircle className="ct-market-spin" size={14} aria-hidden="true" /> : <ArrowDownToLine size={14} aria-hidden="true" />}
      {t(data.busyId === item.id ? 'pluginMarket.installing' : 'pluginMarket.install')}
    </Button>
  )

  return (
    <PageScroll>
      <RadixPage className="ct-plugins-page">
        <main className="ct-market" hidden={!!selected} aria-label={t('pluginMarket.title')}>
          <div className="ct-market-toolbar">
            <div className="ct-market-tabs" role="group" aria-label={t('pluginMarket.filter')}>
              <button type="button" aria-pressed={tab === 'discover'} className={tab === 'discover' ? 'is-active' : ''} onClick={() => setTab('discover')}>{t('pluginMarket.discover')}</button>
              <button type="button" aria-pressed={tab === 'installed'} className={tab === 'installed' ? 'is-active' : ''} onClick={() => setTab('installed')}>{t('pluginMarket.myPlugins')}<span>{data.loadingLocal ? '—' : installedItems.length}</span></button>
            </div>
            <div className="ct-market-tools">
              <label className="ct-plugin-search ct-market-search"><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('pluginsCenter.searchPlaceholder')} aria-label={t('pluginsCenter.searchPlaceholder')} spellCheck={false} /></label>
              <button type="button" className="ct-plugin-icon-btn ct-market-folder-btn" onClick={openDirectory}>
                <FolderOpen size={15} aria-hidden="true" />
                <span>{t('plugins.external.openDir')}</span>
              </button>
              <button type="button" className="ct-plugin-icon-btn" aria-label={t('pluginMarket.refresh')} title={t('pluginMarket.refresh')} disabled={busy || data.loadingRemote || data.loadingLocal} onClick={() => { void data.refreshLocal(); void data.refreshRemote() }}><RefreshCw size={15} aria-hidden="true" /></button>
            </div>
          </div>

          {data.localError && <div className="ct-market-error" role="alert"><CircleAlert size={18} aria-hidden="true" /><div><strong>{t('pluginMarket.localFailed')}</strong><p>{data.localError}</p></div><Button size="1" variant="soft" onClick={() => void data.refreshLocal()} disabled={data.loadingLocal}>{t('pluginMarket.retry')}</Button></div>}
          {tab === 'discover' && data.remoteError && <div className="ct-market-error" role="alert"><CircleAlert size={18} aria-hidden="true" /><div><strong>{t('pluginMarket.remoteFailed')}</strong><p>{data.remoteError}</p><p>{t('pluginMarket.offlineHint')}</p></div><Button size="1" variant="soft" onClick={() => void data.refreshRemote()} disabled={data.loadingRemote}>{t('pluginMarket.retry')}</Button></div>}

          <div className="ct-market-section-head"><h2>{t(tab === 'discover' ? 'pluginMarket.fromRepository' : 'pluginMarket.onThisDevice')}</h2></div>
          <section className="ct-market-grid" aria-label={t(tab === 'discover' ? 'pluginMarket.discover' : 'pluginMarket.myPlugins')} aria-busy={tab === 'discover' ? data.loadingRemote : data.loadingLocal}>
            {(tab === 'discover' ? data.loadingRemote && !data.repository : data.loadingLocal && data.installed.length === 0) ? (
              <div className="ct-market-empty" role="status"><LoaderCircle className="ct-market-spin" size={24} aria-hidden="true" /><p>{t('pluginMarket.loading')}</p></div>
            ) : visibleItems.length ? visibleItems.map((item) => (
              <article key={item.id} className="ct-market-card">
                <button type="button" className="ct-market-card-main" onClick={(event) => openDetails(item.id, event.currentTarget)} aria-label={t('pluginMarket.detailsFor', { name: item.name })}>
                  <span className={`ct-market-plugin-icon${item.builtin ? ' is-builtin' : ''}`}>{icon(item)}</span>
                  <div className="ct-market-card-copy"><h3>{item.name}</h3><span>{item.builtin ? t('pluginsCenter.builtinTag') : `v${item.version}`}</span></div>
                  <ChevronRight size={15} className="ct-market-card-arrow" aria-hidden="true" />
                  <p>{item.description || t('plugins.external.noDescription')}</p>
                </button>
                <div className="ct-market-card-footer">
                  <span className={`ct-market-card-status${isEnabled(item) ? ' is-enabled' : ''}${item.installed?.info.error ? ' is-error' : ''}`}>
                    {item.installed?.info.error ? <CircleAlert size={12} aria-hidden="true" /> : isInstalled(item) ? <Check size={12} aria-hidden="true" /> : <Github size={12} aria-hidden="true" />}
                    {item.installed?.info.error ? t('pluginMarket.needsAttention') : t(isEnabled(item) ? 'pluginMarket.enabled' : isInstalled(item) ? 'pluginMarket.notEnabled' : 'pluginMarket.repositoryPlugin')}
                  </span>
                  {isInstalled(item) ? <Button size="2" variant="soft" color="gray" onClick={(event) => openDetails(item.id, event.currentTarget)}>{t('pluginMarket.manage')}</Button> : installButton(item)}
                </div>
              </article>
            )) : <div className="ct-market-empty"><Search size={25} aria-hidden="true" /><h3>{t(query ? 'plugins.searchEmpty' : 'pluginMarket.noPlugins')}</h3><p>{t(query ? 'pluginMarket.searchHint' : 'pluginMarket.retryHint')}</p>{query && <Button variant="soft" onClick={() => setQuery('')}>{t('pluginMarket.clearSearch')}</Button>}</div>}
          </section>

        </main>

        <section className="ct-market ct-market-detail-dialog" hidden={!selected} aria-labelledby="ct-plugin-detail-title">
            {selected && <>
              <div className="ct-market-dialog-top"><span className="ct-market-eyebrow">{t('pluginMarket.pluginDetails')}</span><button className="ct-plugin-icon-btn" type="button" aria-label={t('pluginMarket.close')} onClick={closeDetails}><X size={16} aria-hidden="true" /></button></div>
              <div className="ct-market-detail-identity"><span className={`ct-market-plugin-icon is-large${selected.builtin ? ' is-builtin' : ''}`}>{icon(selected)}</span><div><h2 id="ct-plugin-detail-title" ref={detailHeading} tabIndex={-1}>{selected.name}</h2><span className="ct-plugin-tag">{selected.builtin ? t('pluginsCenter.builtinTag') : `v${selected.installed?.info.version ?? selected.version}`}</span></div></div>
              <p className="ct-market-detail-description">{selected.description || t('plugins.external.noDescription')}</p>
              {isInstalled(selected) ? <div className="ct-market-enable-row"><div><strong>{t(selectedEnabled ? 'pluginMarket.enabled' : 'pluginMarket.notEnabled')}</strong><p>{t(selected.builtin ? 'pluginMarket.builtinEnableHint' : selectedEnabled ? 'pluginMarket.disableHint' : 'pluginMarket.enableHint')}</p></div><Switch checked={selectedEnabled} disabled={busy || !!selectedError || (!!selected.builtin && !restReady)} aria-label={t('pluginMarket.enableFor', { name: selected.name })} onCheckedChange={(value) => { if (selected.builtin) onToggleRest(value); else if (value) { alertOpener.current = document.activeElement as HTMLElement | null; setTrustId(selected.id) } else void data.toggle(selected.id, false) }} /></div> : <div className="ct-market-enable-row"><div><strong>{t('pluginMarket.readyToInstall')}</strong><p>{t('pluginMarket.installHint')}</p></div>{installButton(selected)}</div>}
              {selectedError && <div className="ct-market-error" role="alert"><CircleAlert size={17} aria-hidden="true" /><div><strong>{t('pluginMarket.needsAttention')}</strong><p>{selectedError}</p></div></div>}
              <div className="ct-market-detail-body" key={selected.id}>
                {selected.builtin ? children : selected.installed ? <>
                  <div className="ct-market-trust-note"><ShieldCheck size={17} aria-hidden="true" /><p>{t('pluginMarket.trustNote')}</p></div>
                  {selectedEnabled && !selectedError && <ExternalPluginSettings id={selected.id} hasSettings={selected.installed.info.hasSettings} contentMtimeMs={selected.installed.info.contentMtimeMs} />}
                  <section className="ct-plugin-group ct-market-installation"><h3 className="ct-plugin-group-title">{t('pluginMarket.installation')}</h3><dl><div><dt>{t('pluginMarket.identifier')}</dt><dd>{selected.id}</dd></div><div><dt>{t('plugins.external.dir')}</dt><dd><code>{selected.installed.info.dir}</code></dd></div></dl><div className="ct-market-remove-row"><p>{t('pluginMarket.uninstallHint')}</p><Button variant="soft" color="red" disabled={busy} onClick={(event) => { alertOpener.current = event.currentTarget; setRemoveId(selected.id) }}><Trash2 size={14} aria-hidden="true" />{t('pluginMarket.uninstall')}</Button></div></section>
                </> : <div className="ct-market-trust-note"><ShieldCheck size={18} aria-hidden="true" /><p>{t('pluginMarket.trustNote')}</p></div>}
              </div>
            </>}
        </section>

        <AlertDialog.Root open={!!trustId} onOpenChange={(open) => { if (!open) setTrustId(null) }}><AlertDialog.Content maxWidth="28rem" onCloseAutoFocus={restoreAlertFocus}><AlertDialog.Title>{t('pluginMarket.trustTitle', { name: allItems.get(trustId ?? '')?.name ?? trustId ?? '' })}</AlertDialog.Title><AlertDialog.Description>{t('pluginMarket.trustDescription')}</AlertDialog.Description><div className="ct-market-confirm-actions"><AlertDialog.Cancel><Button variant="soft" color="gray">{t('pluginMarket.cancel')}</Button></AlertDialog.Cancel><AlertDialog.Action><Button onClick={() => { if (trustId) void data.toggle(trustId, true); setTrustId(null) }}>{t('pluginMarket.trustAndEnable')}</Button></AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Root>
        <AlertDialog.Root open={!!removeId} onOpenChange={(open) => { if (!open) setRemoveId(null) }}><AlertDialog.Content maxWidth="28rem" onCloseAutoFocus={restoreAlertFocus}><AlertDialog.Title>{t('pluginMarket.uninstallTitle', { name: allItems.get(removeId ?? '')?.name ?? removeId ?? '' })}</AlertDialog.Title><AlertDialog.Description>{t('pluginMarket.uninstallDescription')}</AlertDialog.Description><div className="ct-market-confirm-actions"><AlertDialog.Cancel><Button variant="soft" color="gray">{t('pluginMarket.cancel')}</Button></AlertDialog.Cancel><AlertDialog.Action><Button color="red" onClick={() => { if (removeId) void data.uninstall(removeId); setRemoveId(null) }}>{t('pluginMarket.uninstall')}</Button></AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Root>
      </RadixPage>
    </PageScroll>
  )
}
