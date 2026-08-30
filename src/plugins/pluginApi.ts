import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type PluginHttpResponse = {
  status: number
  url: string
  contentType?: string | null
  body: string
}

export type PluginProcessInfo = { pid: number }
export type PluginPathName = 'appData' | 'appConfig' | 'appCache' | 'home' | 'desktop' | 'documents' | 'downloads' | 'temp'
export type PluginPlatformInfo = { os: 'windows' | 'macos' | 'linux' | 'unknown'; arch: string; family: string }
export type PluginClipboardImage = { rgba: number[]; width: number; height: number }
export type PluginScreenPoint = { x: number; y: number }
export type PluginDisplay = {
  name?: string | null
  size: { width: number; height: number }
  position: { x: number; y: number }
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } }
  scaleFactor: number
}
export type PluginDialogOptions = {
  title?: string
  defaultPath?: string
  fileName?: string
  filters?: Array<{ name: string; extensions: string[] }>
}
export type PluginNotificationOptions = {
  title: string
  body?: string
  level?: 'info' | 'warning' | 'error' | 'success'
  sticky?: boolean
}
export type PluginAudioPlayOptions = {
  volume?: number
  repeat?: boolean
  speed?: number
}

export type PluginEventAction = { id: string; label: string }
export type PluginEventPublishOptions = {
  eventType: string
  kind: string
  title: string
  body?: string
  level?: 'info' | 'warning' | 'error' | 'success'
  sticky?: boolean
  actions?: PluginEventAction[]
  payload?: unknown
  dedupeKey?: string
  expiresAt?: number
  correlationId?: string
  progress?: unknown
}

export type PluginActivitySnapshot = {
  active: boolean
  count: number
  mediaActive: boolean
  fullscreenActive: boolean
}

type PluginLogLevel = 'info' | 'warn' | 'error'
type PluginLogPayload = { pluginId: string; level: string; message: string; data?: unknown }

export type PluginApi = {
  env: { getAll(): Promise<Record<string, string>> }
  dialog: {
    showOpenDialog(options?: PluginDialogOptions & { directory?: boolean }): Promise<string | null>
    showSaveDialog(options?: PluginDialogOptions): Promise<string | null>
    pickFile(): Promise<string | null>
    pickFolder(): Promise<string | null>
  }
  path: { get(name: PluginPathName): Promise<string>; getPluginDir(): Promise<string> }
  clipboard: {
    writeText(text: string): Promise<void>
    readText(): Promise<string>
    writeImage(image: PluginClipboardImage): Promise<void>
    readImage(): Promise<PluginClipboardImage>
    clear(): Promise<void>
  }
  window: { hideMain(): Promise<void>; showMain(): Promise<void> }
  screen: {
    getCursorPoint(): Promise<PluginScreenPoint>
    getDisplayNearestPoint(point: PluginScreenPoint): Promise<PluginDisplay | null>
    getAllDisplays(): Promise<PluginDisplay[]>
  }
  /** Plugin-isolated JSON runtime storage (SQLite). */
  storage: {
    get<T = unknown>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<void>
    remove(key: string): Promise<void>
  }
  /** Whole-object settings store (`plugin_config:{id}`); readable while disabled. */
  config: {
    get<T = unknown>(): Promise<T | null>
    set(value: unknown): Promise<void>
  }
  /** Enable/disable this plugin (main window / settings). */
  setEnabled(enabled: boolean): Promise<void>
  audio: {
    play(path: string, options?: PluginAudioPlayOptions): Promise<string>
    stop(playbackId: string): Promise<void>
    pause(playbackId: string): Promise<void>
    resume(playbackId: string): Promise<void>
    setVolume(playbackId: string, volume: number): Promise<void>
    isPlaying(playbackId: string): Promise<boolean>
  }
  shell: {
    openExternal(url: string): Promise<void>
    openPath(path: string): Promise<void>
    showItemInFolder(path: string): Promise<void>
    beep(): Promise<void>
  }
  platform: { getInfo(): Promise<PluginPlatformInfo> }
  theme: { isDark(): Promise<boolean> }
  /** Simple toast helper (kind defaults to plugin id). */
  notification: { show(options: PluginNotificationOptions): Promise<unknown> }
  /** Full Event Bus publish with actions/payload (plugin must be enabled). */
  events: { publish(options: PluginEventPublishOptions): Promise<unknown> }
  /** Host activity / rest anchors for interval schedulers. */
  activity: {
    get(): Promise<PluginActivitySnapshot>
    getLastRealRest(): Promise<number | null>
  }
  process: { spawn(path: string, args?: string[]): Promise<PluginProcessInfo> }
  http: { get(url: string): Promise<PluginHttpResponse> }
  log: Record<PluginLogLevel, (message: string, data?: unknown) => Promise<void>>
  sidecar: { request<T = unknown>(method: string, params?: unknown): Promise<T> }
}

export function createPluginApi(pluginId: string): PluginApi {
  const log = (level: PluginLogLevel, message: string, data?: unknown) =>
    invoke<void>('plugin_api_log', { pluginId, level, message, data })
  const showOpenDialog = (options: PluginDialogOptions & { directory?: boolean } = {}) => {
    const { directory = false, ...dialogOptions } = options
    return invoke<string | null>('plugin_api_show_open_dialog', { pluginId, directory, options: dialogOptions })
  }

  return {
    env: { getAll: () => invoke('plugin_api_get_environment', { pluginId }) },
    dialog: {
      showOpenDialog,
      showSaveDialog: (options = {}) => invoke('plugin_api_show_save_dialog', { pluginId, options }),
      pickFile: () => showOpenDialog(),
      pickFolder: () => showOpenDialog({ directory: true }),
    },
    path: {
      get: (name) => invoke('plugin_api_get_path', { pluginId, name }),
      getPluginDir: () => invoke('plugin_api_get_plugin_dir', { pluginId }),
    },
    clipboard: {
      writeText: (text) => invoke('plugin_api_clipboard_write_text', { pluginId, text }),
      readText: () => invoke('plugin_api_clipboard_read_text', { pluginId }),
      writeImage: (image) => invoke('plugin_api_clipboard_write_image', { pluginId, image }),
      readImage: () => invoke('plugin_api_clipboard_read_image', { pluginId }),
      clear: () => invoke('plugin_api_clipboard_clear', { pluginId }),
    },
    window: {
      hideMain: () => invoke('plugin_api_window_hide_main', { pluginId }),
      showMain: () => invoke('plugin_api_window_show_main', { pluginId }),
    },
    screen: {
      getCursorPoint: () => invoke('plugin_api_screen_get_cursor_point', { pluginId }),
      getDisplayNearestPoint: (point) => invoke('plugin_api_screen_get_display_nearest_point', { pluginId, point }),
      getAllDisplays: () => invoke('plugin_api_screen_get_all_displays', { pluginId }),
    },
    storage: {
      get: async <T = unknown>(key: string) => {
        const value = await invoke<string | null>('plugin_api_storage_get', { pluginId, key })
        return value === null ? null : JSON.parse(value) as T
      },
      set: (key, value) => invoke('plugin_api_storage_set', { pluginId, key, value: JSON.stringify(value) }),
      remove: (key) => invoke('plugin_api_storage_remove', { pluginId, key }),
    },
    config: {
      get: <T = unknown>() => invoke<T | null>('get_plugin_config', { pluginId }),
      set: (value) => invoke('set_plugin_config', { pluginId, value }),
    },
    setEnabled: async (enabled) => {
      await invoke('set_external_plugin_enabled', { id: pluginId, enabled })
    },
    audio: {
      play: (path, options = {}) =>
        invoke<string>('plugin_api_audio_play', { pluginId, path, options }),
      stop: (playbackId) => invoke('plugin_api_audio_stop', { pluginId, playbackId }),
      pause: (playbackId) => invoke('plugin_api_audio_pause', { pluginId, playbackId }),
      resume: (playbackId) => invoke('plugin_api_audio_resume', { pluginId, playbackId }),
      setVolume: (playbackId, volume) => invoke('plugin_api_audio_set_volume', { pluginId, playbackId, volume }),
      isPlaying: (playbackId) => invoke<boolean>('plugin_api_audio_is_playing', { pluginId, playbackId }),
    },
    shell: {
      openExternal: (url) => invoke('plugin_api_shell_open_external', { pluginId, url }),
      openPath: (path) => invoke('plugin_api_shell_open_path', { pluginId, path }),
      showItemInFolder: (path) => invoke('plugin_api_shell_show_item_in_folder', { pluginId, path }),
      beep: () => invoke('plugin_api_shell_beep', { pluginId }),
    },
    platform: { getInfo: () => invoke('plugin_api_platform_get_info', { pluginId }) },
    theme: { isDark: () => invoke('plugin_api_theme_is_dark', { pluginId }) },
    notification: { show: (options) => invoke('plugin_api_notification_show', { pluginId, options }) },
    events: {
      publish: (options) =>
        invoke('plugin_api_event_publish', {
          pluginId,
          event: {
            eventType: options.eventType,
            kind: options.kind,
            title: options.title,
            body: options.body ?? '',
            level: options.level,
            sticky: options.sticky,
            actions: options.actions ?? [],
            payload: options.payload ?? null,
            dedupeKey: options.dedupeKey,
            expiresAt: options.expiresAt,
            correlationId: options.correlationId,
            progress: options.progress,
          },
        }),
    },
    activity: {
      get: () => invoke<PluginActivitySnapshot>('plugin_api_get_activity', { pluginId }),
      getLastRealRest: () => invoke<number | null>('plugin_api_get_last_real_rest', { pluginId }),
    },
    process: { spawn: (path, args = []) => invoke('plugin_api_spawn_process', { pluginId, path, args }) },
    http: { get: (url) => invoke('plugin_api_http_get', { pluginId, url }) },
    log: {
      info: (message, data) => log('info', message, data),
      warn: (message, data) => log('warn', message, data),
      error: (message, data) => log('error', message, data),
    },
    sidecar: { request: (method, params = {}) => invoke('plugin_sidecar_request', { pluginId, method, params }) },
  }
}

export function wrapPluginSource(pluginId: string, source: string): string {
  return `const plugin = globalThis.__CATRACE_CREATE_PLUGIN_API__(${JSON.stringify(pluginId)});\n${source}`
}

let pluginLogListener: Promise<UnlistenFn> | null = null

export function ensurePluginLogConsole() {
  if (pluginLogListener) return
  pluginLogListener = listen<PluginLogPayload>('catrace:plugin-log', ({ payload }) => {
    const prefix = `[plugin:${payload.pluginId}] ${payload.message}`
    const args = payload.data === undefined || payload.data === null ? [prefix] : [prefix, payload.data]
    if (payload.level === 'error') console.error(...args)
    else if (payload.level === 'warn') console.warn(...args)
    else console.info(...args)
  })
}
