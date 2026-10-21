import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const source = readFileSync('preview.jsx', 'utf8').replace(
  "createRoot(document.getElementById('root')).render(<App/>);",
  `globalThis.matchMedia = () => ({ matches: false });
function ensure(markup, expected) {
  for (const value of expected) if (!markup.includes(value)) throw new Error('Missing rendered content: ' + value);
}
function render(props = {}) { return renderToStaticMarkup(<App {...props}/>); }
const markup = render();
ensure(markup, ['data-accent-color="iris"', 'data-gray-color="slate"', 'data-radius="large"', 'data-scaling="100%"', 'data-panel-background="solid"', '久坐提醒', 'master-detail-layout', 'plugin-master', 'detail-scroll', '健康作息', '桌面通知预览', 'setting-interval']);
if ((markup.match(/class="plugin-row"/g) || []).length !== 6) throw new Error('Expected six plugin rows');
if ((markup.match(/data-selected="true"/g) || []).length !== 1) throw new Error('Expected one selected plugin');
if ((markup.match(/role="switch"/g) || []).length !== 8) throw new Error('Expected six list switches, detail switch and sound switch');
if (/<button[^>]*class="plugin-select"[^>]*>(?:(?!<\\/button>)[\\s\\S])*role="switch"/.test(markup)) throw new Error('List switch nested inside selection button');
if (/官方默认主题|后台调度就绪|桌面通知权限已授权/.test(markup)) throw new Error('Unimplemented capability claim');
console.log('PASS: default screen; fixed master/detail markup; six rows; synchronized switch sources; no nested controls');
for (const tab of ['activity', 'about']) {
 const html = render({initialState:makeState({tab})});
 ensure(html, tab === 'activity' ? ['触发历史分布','示例数据','12','还没有操作记录'] : ['插件信息','权限尚未接入','不运行真实插件']);
}
console.log('PASS: statistics and permission panels disclose prototype boundaries');
const hidden = render({initialState:makeState({category:'system'})});
ensure(hidden,['当前插件不在筛选结果中','蓝牙音乐']);
const empty = render({initialState:makeState({query:'NO_MATCH_TEST'})});
ensure(empty,['没有找到匹配插件','清除筛选']);
if ((empty.match(/class="plugin-row"/g)||[]).length) throw new Error('Unexpected rows in empty state');
const agent = render({initialState:makeState({selected:'agent'})});
ensure(agent,['由外部事件触发']);
if (agent.includes('id="setting-interval"')) throw new Error('Agent inherited health timing fields');
console.log('PASS: filtered selection notice, empty result recovery, plugin-specific configuration');
const invalid = makeState(); invalid.drafts.rest.interval='-1';
ensure(render({initialState:invalid}),['aria-invalid="true"','setting-interval-error','请输入 1–240']);
const notice=render({initialMode:'dark',initialNotice:{id:'rest',title:'测试通知',body:'演示内容',icon:'chair',color:'iris'}});
ensure(notice,['测试通知','关闭演示通知','标记完成']);
console.log('PASS: invalid field semantics and notification rendering');`
);
await build({
  stdin: { contents: "import { renderToStaticMarkup } from 'react-dom/server';\n" + source, resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, platform: 'node', format: 'cjs', outfile: 'ssr-check.cjs',
  loader: { '.css': 'empty' }, jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
createRequire(import.meta.url)('./ssr-check.cjs');
