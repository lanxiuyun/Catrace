/** Sidecar capability demo settings — host environment, dialogs, process and HTTP. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, computed } = vue
const { NAlert, NButton, NInput, NTag, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing')
}
if (!NButton || !NInput || !NTag || !NAlert || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing')
}

const STYLE_ID = 'catrace-sidecar-capability-settings-css'
const CSS = `
.cap-demo { width:100%; display:flex; flex-direction:column; gap:0.75rem; color:#164e63; }
.cap-demo * { box-sizing:border-box; }
.cap-demo .intro { line-height:1.55; }
.cap-demo .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(19rem,1fr)); gap:0.75rem; }
.cap-demo .card { min-width:0; padding:1rem 1.125rem; border:0.0625rem solid #d5f3f8; border-radius:0.875rem; background:#fff; display:flex; flex-direction:column; gap:0.625rem; }
.cap-demo .head { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; }
.cap-demo h3 { margin:0; font-size:0.875rem; color:#155e75; }
.cap-demo .desc { margin:0; color:#648b95; font-size:0.75rem; line-height:1.5; }
.cap-demo .actions { display:flex; flex-wrap:wrap; gap:0.5rem; }
.cap-demo .value { min-height:2.25rem; padding:0.625rem; border-radius:0.5rem; background:#ecfeff; color:#155e75; font:0.75rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; white-space:pre-wrap; word-break:break-all; overflow:auto; max-height:14rem; }
.cap-demo .env { max-height:20rem; }
.cap-demo .row { display:flex; align-items:center; gap:0.5rem; }
.cap-demo .row .n-input { flex:1; min-width:0; }
`

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function splitArgs(value) {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) =>
    part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part
  ) || []
}

export default {
  name: 'SidecarCapabilitySettings',
  setup() {
    ensureStyles()
    const message = useMessage()
    const busy = ref('')
    const environment = ref({})
    const selectedFile = ref('')
    const selectedFolder = ref('')
    const programPath = ref('')
    const programArgs = ref('')
    const processResult = ref('尚未启动程序')
    const url = ref('https://httpbin.org/get?from=catrace-sidecar-demo')
    const httpResult = ref('尚未发送请求')
    const savedPath = ref('Not selected')
    const clipboardText = ref('Catrace plugin clipboard demo')
    const clipboardResult = ref('Not read')
    const clipboardImageResult = ref('Not tested')
    const storageKey = ref('demo-state')
    const storageValue = ref('Hello from sidecar-echo')
    const storageResult = ref('No operation yet')
    const pathResult = ref('Not loaded')
    const platformResult = ref('Not loaded')
    const screenResult = ref('Not loaded')

    const environmentText = computed(() => Object.entries(environment.value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') || '尚未读取')

    async function run(key, task) {
      busy.value = key
      try {
        await task()
      } catch (error) {
        const text = errorText(error)
        message.error(text)
        if (key === 'http') httpResult.value = text
        if (key === 'run') processResult.value = text
      } finally {
        busy.value = ''
      }
    }

    async function loadEnvironment() {
      await run('env', async () => {
        environment.value = await plugin.env.getAll()
        await plugin.log.info('environment loaded', { count: Object.keys(environment.value).length })
        message.success(`读取到 ${Object.keys(environment.value).length} 个环境变量`)
      })
    }

    async function pickFile(forProgram = false) {
      await run(forProgram ? 'program-file' : 'file', async () => {
        const path = await plugin.dialog.pickFile()
        if (!path) return
        if (forProgram) programPath.value = path
        else selectedFile.value = path
        await plugin.log.info('file selected', { path, forProgram })
      })
    }

    async function pickFolder() {
      await run('folder', async () => {
        const path = await plugin.dialog.pickFolder()
        if (path) {
          selectedFolder.value = path
          await plugin.log.info('folder selected', { path })
        }
      })
    }

    async function runProgram() {
      await run('run', async () => {
        const result = await plugin.process.spawn(programPath.value, splitArgs(programArgs.value))
        processResult.value = `已启动，PID=${result.pid}`
        await plugin.log.info('program started', { path: programPath.value, pid: result.pid })
        message.success(processResult.value)
      })
    }

    async function httpGet() {
      await run('http', async () => {
        const result = await plugin.http.get(url.value)
        await plugin.log.info('HTTP GET completed', { url: result.url, status: result.status })
        httpResult.value = [
          `HTTP ${result.status}`,
          `URL: ${result.url}`,
          `Content-Type: ${result.contentType || '-'}`,
          '',
          result.body,
        ].join('\n')
      })
    }

    async function saveDialog() {
      await run('save', async () => {
        const path = await plugin.dialog.showSaveDialog({ title: 'Choose demo save location', fileName: 'catrace-plugin-demo.txt', filters: [{ name: 'Text', extensions: ['txt'] }] })
        if (path) savedPath.value = path
      })
    }
    async function writeClipboard() { await run('clipboard-write', async () => { await plugin.clipboard.writeText(clipboardText.value); await plugin.log.info('clipboard text written'); message.success('Copied to clipboard') }) }
    async function readClipboard() { await run('clipboard-read', async () => { clipboardResult.value = await plugin.clipboard.readText() }) }
    async function writeClipboardImage() { await run('clipboard-image-write', async () => { await plugin.clipboard.writeImage({ width: 2, height: 2, rgba: [124, 58, 237, 255, 20, 184, 166, 255, 245, 158, 11, 255, 255, 255, 255, 255] }); clipboardImageResult.value = 'Wrote a 2x2 RGBA image' }) }
    async function readClipboardImage() { await run('clipboard-image-read', async () => { const image = await plugin.clipboard.readImage(); clipboardImageResult.value = JSON.stringify({ width: image.width, height: image.height, rgbaBytes: image.rgba.length }, null, 2) }) }
    async function clearClipboard() { await run('clipboard-clear', async () => { await plugin.clipboard.clear(); clipboardResult.value = 'Clipboard cleared'; clipboardImageResult.value = 'Clipboard cleared' }) }
    async function setStorage() { await run('storage-set', async () => { await plugin.storage.set(storageKey.value, { text: storageValue.value, savedAt: new Date().toISOString() }); storageResult.value = 'Saved' }) }
    async function getStorage() { await run('storage-get', async () => { storageResult.value = JSON.stringify(await plugin.storage.get(storageKey.value), null, 2) }) }
    async function removeStorage() { await run('storage-remove', async () => { await plugin.storage.remove(storageKey.value); storageResult.value = 'Removed' }) }
    async function loadPaths() { await run('paths', async () => { const names = ['appData', 'home', 'downloads', 'temp']; const values = await Promise.all(names.map(async (name) => [name, await plugin.path.get(name)])); pathResult.value = values.map(([name, path]) => `${name}: ${path}`).join('\n') }) }
    async function loadPlatform() { await run('platform', async () => { const [info, dark] = await Promise.all([plugin.platform.getInfo(), plugin.theme.isDark()]); platformResult.value = JSON.stringify({ ...info, dark }, null, 2) }) }
    async function showNotification() { await run('notification', () => plugin.notification.show({ title: 'Plugin host notification', body: 'sidecar-echo successfully called notification API', level: 'success' })) }
    async function loadScreenInfo() {
      await run('screen', async () => {
        const point = await plugin.screen.getCursorPoint()
        const [display, displays] = await Promise.all([
          plugin.screen.getDisplayNearestPoint(point),
          plugin.screen.getAllDisplays(),
        ])
        screenResult.value = JSON.stringify({ point, display, displayCount: displays.length, displays }, null, 2)
      })
    }
    async function hideMainBriefly() {
      await run('window', async () => {
        await plugin.window.hideMain()
        await new Promise((resolve) => setTimeout(resolve, 1000))
        await plugin.window.showMain()
      })
    }


    const card = (title, tag, description, children) => h('section', { class: 'card' }, [
      h('div', { class: 'head' }, [
        h('h3', title),
        h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => tag }),
      ]),
      h('p', { class: 'desc' }, description),
      ...children,
    ])
    const button = (label, key, onClick, props = {}) => h(NButton, {
      size: 'small',
      type: 'primary',
      secondary: true,
      loading: busy.value === key,
      disabled: !!busy.value && busy.value !== key,
      onClick,
      ...props,
    }, { default: () => label })

    return () => h('div', { class: 'cap-demo' }, [
      h(NAlert, { type: 'info', bordered: false, class: 'intro' }, {
        default: () => '这是可信本地插件能力演示。插件通过统一 plugin API 调用 Rust 宿主能力；sidecar 只负责自定义后台事件。',
      }),
      h('div', { class: 'grid' }, [
        card('环境变量', 'ENV', '读取 Rust 宿主进程可见的环境变量并完整展示。', [
          h('div', { class: 'actions' }, [button('重新读取', 'env', loadEnvironment)]),
          h('pre', { class: 'value env' }, environmentText.value),
        ]),
        card('文件选择', 'FILE', '调用系统文件选择器，返回绝对路径。', [
          h('div', { class: 'actions' }, [button('选择文件', 'file', () => pickFile(false))]),
          h('pre', { class: 'value' }, selectedFile.value || '尚未选择'),
        ]),
        card('目录选择', 'FOLDER', '调用系统目录选择器，返回绝对路径。', [
          h('div', { class: 'actions' }, [button('选择文件夹', 'folder', pickFolder)]),
          h('pre', { class: 'value' }, selectedFolder.value || '尚未选择'),
        ]),
        card('启动本机程序', 'PROCESS', '选择 exe/可执行文件，输入可选参数后启动。双引号可包裹含空格的参数。', [
          h('div', { class: 'row' }, [
            h(NInput, {
              value: programPath.value,
              'onUpdate:value': (value) => { programPath.value = value },
              placeholder: '可执行文件路径',
            }),
            button('选择', 'program-file', () => pickFile(true)),
          ]),
          h(NInput, {
            value: programArgs.value,
            'onUpdate:value': (value) => { programArgs.value = value },
            placeholder: '参数，例如："C:\\My File.txt" --demo',
          }),
          h('div', { class: 'actions' }, [button('运行', 'run', runProgram, {
            disabled: !programPath.value || (!!busy.value && busy.value !== 'run'),
          })]),
          h('pre', { class: 'value' }, processResult.value),
        ]),
        card('HTTP GET', 'NETWORK', '由 Rust 宿主发起 GET，并展示状态码、最终 URL、Content-Type 和响应正文。', [
          h(NInput, {
            value: url.value,
            'onUpdate:value': (value) => { url.value = value },
            placeholder: 'https://example.com',
            clearable: true,
          }),
          h('div', { class: 'actions' }, [button('发送 GET', 'http', httpGet, {
            disabled: !url.value || (!!busy.value && busy.value !== 'http'),
          })]),
          h('pre', { class: 'value' }, httpResult.value),
        ]),
        card('Save dialog', 'SAVE', 'Choose a target path without writing the file.', [
          h('div', { class: 'actions' }, [button('Choose save path', 'save', saveDialog)]),
          h('pre', { class: 'value' }, savedPath.value),
        ]),
        card('Clipboard', 'CLIPBOARD', 'Read and write the system text clipboard.', [
          h(NInput, { value: clipboardText.value, 'onUpdate:value': (value) => { clipboardText.value = value } }),
          h('div', { class: 'actions' }, [button('Write text', 'clipboard-write', writeClipboard), button('Read text', 'clipboard-read', readClipboard), button('Write image', 'clipboard-image-write', writeClipboardImage), button('Read image', 'clipboard-image-read', readClipboardImage), button('Clear', 'clipboard-clear', clearClipboard)]),
          h('pre', { class: 'value' }, clipboardResult.value),
          h('pre', { class: 'value' }, clipboardImageResult.value),
        ]),
        card('Plugin storage', 'STORAGE', 'JSON persistence isolated by plugin id.', [
          h(NInput, { value: storageKey.value, 'onUpdate:value': (value) => { storageKey.value = value }, placeholder: 'key' }),
          h(NInput, { value: storageValue.value, 'onUpdate:value': (value) => { storageValue.value = value }, placeholder: 'value' }),
          h('div', { class: 'actions' }, [button('Save', 'storage-set', setStorage), button('Read', 'storage-get', getStorage), button('Remove', 'storage-remove', removeStorage)]),
          h('pre', { class: 'value' }, storageResult.value),
        ]),
        card('Host paths and Shell', 'PATH', 'Resolve common paths, open folders and reveal files.', [
          h('div', { class: 'actions' }, [button('Load paths', 'paths', loadPaths), button('Open folder', 'open-path', () => run('open-path', () => plugin.shell.openPath(selectedFolder.value)), { disabled: !selectedFolder.value }), button('Reveal file', 'reveal', () => run('reveal', () => plugin.shell.showItemInFolder(selectedFile.value)), { disabled: !selectedFile.value })]),
          h('pre', { class: 'value' }, pathResult.value),
        ]),
        card('Platform, theme and notification', 'HOST', 'Inspect host info and publish a Toast through Event Bus.', [
          h('div', { class: 'actions' }, [button('Refresh', 'platform', loadPlatform), button('Notify', 'notification', showNotification), button('Open URL', 'external', () => run('external', () => plugin.shell.openExternal(url.value)))]),
          h('pre', { class: 'value' }, platformResult.value),
        ]),
        card('Screen, window and beep', 'DESKTOP', 'Read cursor/display information, control the main window and play the system beep.', [
          h('div', { class: 'actions' }, [
            button('Refresh screen', 'screen', loadScreenInfo),
            button('Hide for 1s', 'window', hideMainBriefly),
            button('Beep', 'beep', () => run('beep', () => plugin.shell.beep())),
          ]),
          h('pre', { class: 'value' }, screenResult.value),
        ]),
      ]),
    ])
  },
}
