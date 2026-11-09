import React, { useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme, Box, Flex, Text, Heading, Button, IconButton, Badge, TextField, Switch, Select, Tabs, Dialog, RadioGroup } from '@radix-ui/themes';
import { LayoutGrid, Plug, Activity, Settings2, ShieldCheck, ShieldAlert, Sun, Moon, Search, Plus, Armchair, Droplet, Eye, Clock, Terminal, Bluetooth, Info, Bell, X, Check, ChevronRight, ArrowLeft, RotateCcw, SlidersHorizontal, ChartColumn, CircleHelp } from 'lucide-react';
import { catalog, categories, historyHours, makeState, reducer, visiblePlugins, getPlugin, categoryName, isDirty, validationErrors } from './model.mjs';
import '@radix-ui/themes/styles.css';
import './layout.css';

const defaults = { accentColor:'iris', grayColor:'slate', panelBackground:'solid', radius:'large', scaling:'100%' };
const icons = { chair:Armchair, drop:Droplet, eye:Eye, clock:Clock, terminal:Terminal, bluetooth:Bluetooth };
const timestamp = () => new Date().toISOString();
const displayTime = time => new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZone:'Asia/Shanghai'}).format(new Date(time));

function App({ initialState, initialMode = 'light', initialNotice = null }) {
  const [state, dispatch] = useReducer(reducer, initialState || makeState());
  const [mode,setMode] = useState(initialMode);
  const [systemDark,setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  const [notice,setNotice] = useState(initialNotice);
  const detailTitle = useRef(null);
  const noticeTrigger = useRef(null);
  const previousMobileDetail = useRef(false);
  const dark = mode === 'system' ? systemDark : mode === 'dark';
  useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)');const handler=()=>setSystemDark(media.matches);media.addEventListener('change',handler);return()=>media.removeEventListener('change',handler);},[]);
  useEffect(()=>{document.documentElement.classList.toggle('dark',dark);document.documentElement.classList.toggle('light',!dark);document.documentElement.style.colorScheme=dark?'dark':'light';},[dark]);
  useEffect(()=>{if(!notice)return;const close=e=>{if(e.key==='Escape'&&!document.querySelector('[role="dialog"]'))dismissNotice();};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[notice]);
  useEffect(()=>{
    if(matchMedia('(max-width: 680px)').matches){
      if(state.mobileDetail)detailTitle.current?.focus();
      else if(previousMobileDetail.current)document.querySelector('.plugin-select[aria-pressed="true"]')?.focus();
    }
    previousMobileDetail.current=state.mobileDetail;
  },[state.selected,state.mobileDetail]);
  function dismissNotice(){
    setNotice(null);
    const trigger=noticeTrigger.current;
    if(trigger?.isConnected)trigger.focus();else detailTitle.current?.focus();
  }
  const plugin = getPlugin(state.selected);
  const PluginIcon = icons[plugin.icon];
  const visible = visiblePlugins(state);
  const draft = state.drafts[plugin.id];
  const applied = state.applied[plugin.id];
  const errors = validationErrors(draft);
  const dirty = isDirty(state);
  const enabled = state.enabled[plugin.id];
  const currentEvents = state.events.filter(e=>e.plugin===plugin.id);
  const previews = currentEvents.filter(e=>e.kind==='preview').length;
  const selectedHidden = !visible.some(p=>p.id===plugin.id);
  function send(type, values = {}) { dispatch({type,time:timestamp(),...values}); }
  function update(field,value) { send('edit',{field,value}); }
  function preview(e) {
    if(!enabled)return;
    noticeTrigger.current=e.currentTarget;
    const body = plugin.id==='rest' ? `离开屏幕 ${applied.duration} 分钟，让下一段专注更轻松。` : plugin.description;
    setNotice({id:plugin.id,title:plugin.title,body,icon:plugin.icon,color:plugin.color});
    send('preview');
  }
  function apply(e) {
    e.preventDefault();
    send('apply');
    const first = Object.keys(errors)[0];
    if(first)document.getElementById(`setting-${first}`)?.focus();
  }
  function clearFilters() {send('query',{value:''});send('category',{value:'all'});}
  const NoticeIcon = notice ? icons[notice.icon] : Bell;

  return <Theme {...defaults}>
    <div className="app-layout" data-mobile-detail={state.mobileDetail}>
      <aside className="app-sidebar" aria-label="应用导航">
        <div className="brand-header"><div className="brand-mark" aria-hidden="true">C</div><div className="brand-copy"><strong>Catrace</strong><span>Desktop Event OS</span></div></div>
        <div className="nav-group"><div className="nav-section-label">控制中心</div><nav className="sidebar-nav" aria-label="主导航">
          <button className="side-nav-button" disabled aria-label="概览数据，本原型未实现" title="本原型仅展示插件中心"><LayoutGrid size={18}/><span className="nav-label">概览数据</span></button>
          <button className="side-nav-button" aria-current="page" aria-label="插件中心" onClick={()=>{clearFilters();send('back');}}><Plug size={18}/><span className="nav-label">插件中心</span><span className="nav-count">{catalog.length}</span></button>
          <button className="side-nav-button" disabled aria-label="完整运行记录，本原型未实现" title="可在右侧查看所选插件的预览记录"><Activity size={18}/><span className="nav-label">运行记录</span></button>
        </nav></div>
        <div className="sidebar-bottom">
          <Dialog.Root><Dialog.Trigger><button className="side-nav-button" aria-label="外观设置"><Settings2 size={18}/><span className="nav-label">外观设置</span></button></Dialog.Trigger><Dialog.Content maxWidth="430px"><Dialog.Title>外观设置</Dialog.Title><Dialog.Description size="2" mb="4">紫色强调与双主题。浅色沿用设计稿，深色保持中性黑灰；此选择仅影响当前预览。</Dialog.Description><RadioGroup.Root aria-label="明暗模式" value={mode} onValueChange={setMode}><RadioGroup.Item value="light">浅色</RadioGroup.Item><RadioGroup.Item value="dark">深色</RadioGroup.Item><RadioGroup.Item value="system">跟随系统</RadioGroup.Item></RadioGroup.Root><Flex justify="end" mt="5"><Dialog.Close><Button>完成</Button></Dialog.Close></Flex></Dialog.Content></Dialog.Root>
          <div className="local-note"><div className="local-status"><span className="status-dot"/><span>本机工作空间</span><Badge color="gray" size="1">原型</Badge></div><p>React · Radix Themes · Lucide<br/>不连接系统服务，刷新后重置</p></div>
        </div>
      </aside>
      <main className="app-main">
        <header className="app-topbar"><div className="breadcrumb"><span>工作空间</span><ChevronRight size={12}/><strong>插件中心</strong></div><div className="top-actions"><Badge color="gray" className="prototype-badge">离线预览</Badge><IconButton variant="surface" aria-label={dark?'切换浅色主题':'切换深色主题'} onClick={()=>setMode(dark?'light':'dark')}>{dark?<Sun size={17}/>:<Moon size={17}/>}</IconButton><Dialog.Root><Dialog.Trigger><Button><Plus size={15}/><span>安装新插件</span></Button></Dialog.Trigger><Dialog.Content maxWidth="440px"><Dialog.Title>安装新插件</Dialog.Title><Dialog.Description size="2">正式应用将在这里从本机文件夹或 ZIP 包安装插件。当前 HTML 仅用于设计评审，不读取文件、不安装插件，也不连接商店。</Dialog.Description><Flex justify="end" mt="5"><Dialog.Close><Button>知道了</Button></Dialog.Close></Flex></Dialog.Content></Dialog.Root></div></header>
        <div className="master-detail-layout">
          <aside className="plugin-master" aria-label="插件选择列表">
            <div className="master-tools"><div className="master-heading"><h1>插件</h1><span>{catalog.length} 个已安装</span></div><TextField.Root size="2" placeholder="搜索插件名称、描述…" aria-label="搜索插件名称或描述" value={state.query} onChange={e=>send('query',{value:e.target.value})}><TextField.Slot><Search size={15}/></TextField.Slot></TextField.Root><div className="category-filters" role="group" aria-label="插件分类">{categories.map(c=><button key={c.id} aria-pressed={state.category===c.id} onClick={()=>send('category',{value:c.id})}>{c.label}</button>)}</div></div>
            <div className="master-count" aria-live="polite"><span>匹配插件 · {visible.length} / {catalog.length}</span><span>{catalog.filter(p=>state.enabled[p.id]).length} 个已启用 · 全部</span></div>
            <div className="master-list">{visible.map(p=>{const Icon=icons[p.icon];return <div className="plugin-row" data-selected={p.id===plugin.id} key={p.id}><button className="plugin-select" aria-pressed={p.id===plugin.id} aria-controls="plugin-detail" onClick={()=>send('select',{id:p.id})}><span className={`plugin-icon ${p.color}`}><Icon size={21}/></span><span className="plugin-row-copy"><strong>{p.name}</strong><span className="plugin-row-description">{p.description}</span><span className="plugin-row-meta"><span>{categoryName(p.category)}</span><span className={state.enabled[p.id]?'enabled-text':''}>{state.enabled[p.id]?'已启用':'未启用'}</span></span></span></button><div className="row-switch"><Switch size="1" aria-label={`启用${p.name}（列表）`} checked={state.enabled[p.id]} onCheckedChange={value=>send('enable',{id:p.id,value})}/></div></div>;})}
              {!visible.length&&<div className="empty-state"><Search size={24}/><h2>没有找到匹配插件</h2><p>试试其他关键词，或清除分类筛选。</p><Button variant="soft" onClick={clearFilters}>清除筛选</Button></div>}
            </div><div className="master-footer"><ShieldCheck size={14}/><span>配置与数据留在你的设备上</span></div>
          </aside>
          <section className="detail-shell" id="plugin-detail" aria-labelledby="plugin-title">
            <div className="detail-scroll"><div className="detail-content">
              <button className="mobile-back" onClick={()=>send('back')}><ArrowLeft size={16}/>返回插件列表</button>
              {selectedHidden&&<div className="filter-notice"><Info size={15}/><span>当前插件不在筛选结果中，右侧保留你正在编辑的内容。</span><button onClick={clearFilters}>清除筛选</button></div>}
              <header className="detail-header panel"><div className="detail-identity"><span className={`plugin-icon hero ${plugin.color}`}><PluginIcon size={28}/></span><div><div className="detail-title-line"><h2 id="plugin-title" ref={detailTitle} tabIndex={-1}>{plugin.name}</h2><Badge color="iris" size="1">{categoryName(plugin.category)}</Badge></div><p>{plugin.description}</p><div className="detail-meta"><span>{plugin.builtin?'内置插件':'外部插件 · 示例'}</span><span>·</span><span>{enabled?'已启用':'未启用'}</span></div></div></div><label className="detail-enable"><span>插件启用</span><Switch checked={enabled} onCheckedChange={value=>send('enable',{id:plugin.id,value})} aria-label={`启用${plugin.name}（详情）`}/></label></header>
              <Tabs.Root value={state.tab} onValueChange={value=>send('tab',{value})} className="detail-tabs"><Tabs.List aria-label="插件工作区"><Tabs.Trigger value="settings"><SlidersHorizontal size={14}/>偏好设置{dirty&&<span className="draft-dot" title="有未应用的设置"/>}</Tabs.Trigger><Tabs.Trigger value="activity"><ChartColumn size={14}/>运行统计与日志</Tabs.Trigger><Tabs.Trigger value="about"><CircleHelp size={14}/>关于与权限</Tabs.Trigger></Tabs.List>
                <Tabs.Content value="settings"><form id="plugin-settings-form" key={plugin.id} noValidate onSubmit={apply}><section className="panel settings-panel"><div className="section-title"><h3>{draft.interval!==undefined?'提醒与定时规则':'通知与交互偏好'}</h3><span>仅用于预览</span></div>
                  {draft.interval!==undefined?<><SettingRow title={plugin.id==='rest'?'连续活动时长（触发周期）':'提醒间隔'} description="活动达到设定时长后，显示一张轻量提醒。" htmlFor="setting-interval"><NumberField id="setting-interval" value={draft.interval} error={errors.interval} max={240} onChange={value=>update('interval',value)}/></SettingRow><SettingRow title="建议休息时长" description="给身体与注意力留一点休息缓冲时间。" htmlFor="setting-duration"><NumberField id="setting-duration" value={draft.duration} error={errors.duration} max={60} onChange={value=>update('duration',value)}/></SettingRow></>:<div className="scope-note"><Info size={17}/><p>{plugin.id==='timer'?'定时规则编辑器留给插件专属面板；这里仅展示通用通知设置。':'此插件由外部事件触发，不套用健康提醒的周期设置。设备或事件接入不在本次原型范围内。'}</p></div>}
                  <SettingRow title="提示音效" description="只记录偏好，不播放真实音频。" htmlFor="setting-sound"><Switch id="setting-sound" checked={draft.sound} onCheckedChange={value=>update('sound',value)}/></SettingRow><SettingRow title="提醒方式" description="在桌面角落展示一张通知卡片。" htmlFor="setting-style"><Select.Root value="toast"><Select.Trigger id="setting-style" aria-label="提醒方式"/><Select.Content><Select.Item value="toast">桌面通知卡片</Select.Item></Select.Content></Select.Root></SettingRow>
                  {!enabled&&<p className="disabled-note">插件已停用，仍可调整设置；预览提醒需要先启用。</p>}
                </section></form>
                <div className="preview-banner"><div><Info size={17}/><p>{plugin.id==='rest'?'久坐提醒仅展示 Toast，不强制进入全屏休息。':'这是页面内的通知模拟器，不会发送操作系统通知。'}<small>预览使用已应用的设置，而非尚未保存的草稿。</small></p></div><Button disabled={!enabled} onClick={preview}><Bell size={14}/>预览提醒</Button></div>
                <section className="notification-stage"><div className="stage-label"><span>桌面通知预览</span><span>已应用设置</span></div><div className="notification-sample"><span className={`plugin-icon ${plugin.color}`}><PluginIcon size={23}/></span><div><div className="notification-title"><strong>{plugin.title}</strong><small>Catrace</small></div><p>{plugin.id==='rest'?`离开屏幕 ${applied.duration} 分钟，让下一段专注更轻松。`:plugin.description}</p></div></div></section>
                </Tabs.Content>
                <Tabs.Content value="activity"><section className="panel stats-panel"><div className="section-title"><h3>触发历史分布</h3><Badge color="gray">示例数据 · 非真实统计</Badge></div><div className="stats-rollup"><div><strong>{plugin.history.reduce((a,b)=>a+b,0)}</strong><span>次示例触发</span></div><div><strong>{previews}</strong><span>次本次预览</span></div><p>按插件展示独立的示例分布。<br/>下方日志只记录本页实际操作。</p></div><div className="history-chart" role="img" aria-label={`${plugin.name}示例触发分布：${historyHours.map((h,i)=>`${h} ${plugin.history[i]}次`).join('，')}`}>
                  {plugin.history.map((count,i)=><div className="chart-column" key={historyHours[i]}><span>{count}</span><div className="chart-track"><div className="chart-bar" style={{height:`${Math.max(2,count/Math.max(...plugin.history,1)*100)}%`}}/></div><small>{historyHours[i]}</small></div>)}
                </div><p className="chart-caption">示例时区：Asia/Shanghai · 不读取你的使用记录</p></section>
                <section className="panel logs-panel"><div className="section-title"><h3>本次预览日志</h3><span>{currentEvents.length} 条</span></div>{currentEvents.length?<ol className="log-list">{currentEvents.map(e=><li key={e.id}><time dateTime={e.time}>{displayTime(e.time)}</time><span>{e.text}</span><Badge size="1" color={e.kind==='preview'?'iris':'gray'}>{e.kind==='preview'?'PREVIEW':e.kind==='ack'?'ACK':'LOCAL'}</Badge></li>)}</ol>:<div className="empty-log"><Terminal size={22}/><p>还没有操作记录。</p><span>试试切换插件开关、应用设置或预览提醒。</span></div>}</section></Tabs.Content>
                <Tabs.Content value="about"><section className="panel about-panel"><div className="section-title"><h3>插件信息</h3><Badge color="gray">原型资料</Badge></div><dl className="about-grid"><div><dt>插件标识</dt><dd>{plugin.id}</dd></div><div><dt>插件类型</dt><dd>{plugin.builtin?'内置插件':'外部插件（示例）'}</dd></div><div><dt>分类</dt><dd>{categoryName(plugin.category)}</dd></div><div><dt>界面技术</dt><dd>React · Radix · Lucide</dd></div></dl><div className="permission-notice"><ShieldAlert size={20}/><div><h4>权限尚未接入</h4><p>此 HTML 不检查系统通知、输入监听或插件权限，也不运行真实插件。不能从这份预览判断插件是否已授权或处于沙盒中。</p></div></div><div className="about-copy"><h4>宿主与插件的边界</h4><p>宿主负责列表、详情外壳和主题；右侧设置区将来可挂载现有 Vue 插件兼容层。当前仅演示界面与内存状态，不修改 Rust 内核或本地配置。</p></div></section></Tabs.Content>
              </Tabs.Root>
            </div></div>
            <footer className="detail-footer"><div role="status" className="save-status"><span className={dirty?'unsaved-dot':'saved-dot'}/><span>{dirty?'有未应用的设置。':state.status}</span></div><div className="footer-actions"><Button variant="soft" color="gray" onClick={()=>{send('reset');send('tab',{value:'settings'});}}><RotateCcw size={14}/>恢复默认</Button><Button type="submit" form="plugin-settings-form" disabled={state.tab!=='settings'||!dirty}>更新设置</Button></div></footer>
          </section>
        </div>
      </main>
    </div>
    <div className="sr-only" role="status" aria-live="polite">{notice?`演示通知：${notice.title}`:''}</div>
    {notice&&<div className="notification-overlay"><section className="desktop-notice panel" aria-label="演示桌面通知"><span className={`plugin-icon ${notice.color}`}><NoticeIcon size={24}/></span><div className="notice-copy"><div><strong>{notice.title}</strong><small>刚刚 · 演示</small></div><p>{notice.body}</p><div className="notice-actions"><Button size="1" onClick={()=>{send('ack',{id:notice.id});dismissNotice();}}>标记完成</Button><Button size="1" variant="soft" color="gray" onClick={dismissNotice}>关闭预览</Button></div></div><IconButton size="1" variant="ghost" color="gray" aria-label="关闭演示通知" onClick={dismissNotice}><X size={15}/></IconButton></section></div>}
  </Theme>;
}
function SettingRow({title,description,htmlFor,children}) {return <div className="setting-row"><div className="setting-copy"><label htmlFor={htmlFor}>{title}</label><p>{description}</p></div><div className="setting-control">{children}</div></div>;}
function NumberField({id,value,max,onChange,error}) {return <div className="number-control"><div><TextField.Root id={id} type="number" min="1" max={max} step="1" required value={value} aria-invalid={!!error} aria-describedby={error?`${id}-error`:undefined} onChange={e=>onChange(e.target.value)} className="number-input"/><span>分钟</span></div>{error&&<p id={`${id}-error`} role="alert">{error}</p>}</div>;}
createRoot(document.getElementById('root')).render(<App/>);
