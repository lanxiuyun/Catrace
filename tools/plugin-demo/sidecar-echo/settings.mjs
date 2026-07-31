/** Sidecar capability demo settings — host environment, dialogs, process and HTTP. */
const vue = globalThis.__CATRACE_VUE__ || {}
const naive = globalThis.__CATRACE_NAIVE__ || {}
const { h, ref, computed, onMounted } = vue
const { NAlert, NButton, NInput, NTag, useMessage } = naive

if (typeof h !== 'function' || typeof ref !== 'function') {
  throw new Error('Catrace plugin Vue runtime missing')
}
if (!NButton || !NInput || !NTag || !NAlert || !useMessage) {
  throw new Error('Catrace plugin naive runtime missing')
}

const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args)
const PLUGIN_ID = 'sidecar-echo'
const sidecarRequest = (method, params = {}) => invoke('plugin_sidecar_request', {
  pluginId: PLUGIN_ID,
  method,
  params,
})
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
        environment.value = await sidecarRequest('environment.get')
        message.success(`读取到 ${Object.keys(environment.value).length} 个环境变量`)
      })
    }

    async function pickFile(forProgram = false) {
      await run(forProgram ? 'program-file' : 'file', async () => {
        const path = await sidecarRequest('dialog.pickFile')
        if (!path) return
        if (forProgram) programPath.value = path
        else selectedFile.value = path
      })
    }

    async function pickFolder() {
      await run('folder', async () => {
        const path = await sidecarRequest('dialog.pickFolder')
        if (path) selectedFolder.value = path
      })
    }

    async function runProgram() {
      await run('run', async () => {
        const result = await sidecarRequest('process.spawn', {
          path: programPath.value,
          args: splitArgs(programArgs.value),
        })
        processResult.value = `已启动，PID=${result.pid}`
        message.success(processResult.value)
      })
    }

    async function httpGet() {
      await run('http', async () => {
        const result = await sidecarRequest('http.get', { url: url.value })
        httpResult.value = [
          `HTTP ${result.status}`,
          `URL: ${result.url}`,
          `Content-Type: ${result.contentType || '-'}`,
          '',
          result.body,
        ].join('\n')
      })
    }

    onMounted(loadEnvironment)

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
        default: () => '这是可信本地插件能力演示。设置页只通过通用 RPC 调用独立 Node sidecar；具体桌面能力不写进 Rust。',
      }),
      h('div', { class: 'grid' }, [
        card('环境变量', 'ENV', '读取 Node sidecar 进程可见的环境变量并完整展示。', [
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
        card('HTTP GET', 'NETWORK', '由插件 Node sidecar/fetch 发起 GET，并展示状态码、最终 URL、Content-Type 和响应正文。', [
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
      ]),
    ])
  },
}
