export const categories = [
  { id: 'all', label: '全部' }, { id: 'health', label: '健康作息' },
  { id: 'automation', label: '自动化' }, { id: 'system', label: '系统' },
];
export const catalog = [
  { id: 'rest', name: '久坐提醒', icon: 'chair', category: 'health', color: 'iris', builtin: true, enabled: true, description: '适时起身舒展身体，根据活动节奏提醒你休息。', title: '坐了一会儿，起来走走吧。', defaults: { interval: '45', duration: '5', sound: true }, history: [1, 2, 3, 0, 1, 2, 1, 2] },
  { id: 'water', name: '喝水提醒', icon: 'drop', category: 'health', color: 'sky', enabled: true, description: '忙碌办公时也别忘了补充水分，让喝水成为日常。', title: '喝口水，再继续。', defaults: { interval: '60', duration: '2', sound: false }, history: [1, 0, 1, 1, 0, 1, 1, 1] },
  { id: 'eye', name: '护眼提醒', icon: 'eye', category: 'health', color: 'green', enabled: true, description: '暂时移开目光，看看远处，让眼睛从屏幕中休息一下。', title: '把目光留给远处。', defaults: { interval: '20', duration: '1', sound: false }, history: [2, 1, 2, 0, 2, 1, 2, 2] },
  { id: 'timer', name: '定时提醒', icon: 'clock', category: 'automation', color: 'amber', enabled: true, description: '用轻量提醒，留住生活和工作中的小安排。', title: '你设置的提醒时间到了。', defaults: { sound: true }, history: [0, 1, 0, 0, 1, 0, 2, 0] },
  { id: 'agent', name: 'Agent 通知', icon: 'terminal', category: 'automation', color: 'violet', enabled: true, description: '任务完成或需要你确认时，再把重要消息带到桌面。', title: '任务已完成，来看看结果。', defaults: { sound: false }, history: [1, 2, 0, 1, 3, 2, 0, 1] },
  { id: 'bt-music', name: '蓝牙音乐', icon: 'bluetooth', category: 'system', color: 'blue', enabled: false, description: '根据蓝牙设备连接事件，衔接你的音乐体验。', title: '耳机已连接，音乐就绪。', defaults: { sound: false }, history: [1, 0, 0, 1, 0, 0, 1, 0] },
];
export const historyHours = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];
export function makeState(overrides = {}) {
  return {
    selected: 'rest', query: '', category: 'all', tab: 'settings', mobileDetail: false,
    enabled: Object.fromEntries(catalog.map(p => [p.id, p.enabled])),
    drafts: Object.fromEntries(catalog.map(p => [p.id, { ...p.defaults }])),
    applied: Object.fromEntries(catalog.map(p => [p.id, { ...p.defaults }])),
    events: [], status: '配置仅保存在本次预览，刷新后重置。', ...overrides,
  };
}
export function visiblePlugins(state) {
  const query = state.query.trim().toLowerCase();
  return catalog.filter(p => (state.category === 'all' || p.category === state.category)
    && `${p.name} ${p.id} ${p.description}`.toLowerCase().includes(query));
}
export function getPlugin(id) { return catalog.find(p => p.id === id); }
export function categoryName(id) { return categories.find(c => c.id === id)?.label || id; }
export function isDirty(state, id = state.selected) { return JSON.stringify(state.drafts[id]) !== JSON.stringify(state.applied[id]); }
export function validationErrors(config) {
  const errors = {};
  for (const [name, max] of [['interval', 240], ['duration', 60]]) {
    if (config[name] !== undefined && (String(config[name]).trim() === '' || !Number.isInteger(Number(config[name])) || Number(config[name]) < 1 || Number(config[name]) > max)) {
      errors[name] = `请输入 1–${max} 之间的整数。`;
    }
  }
  return errors;
}
function appendEvent(state, action, text, kind) {
  return [{ id: `${action.time}-${state.events.length}`, plugin: action.id || state.selected, time: action.time, text, kind }, ...state.events];
}
export function reducer(state, action) {
  switch (action.type) {
    case 'query': return { ...state, query: action.value };
    case 'category': return { ...state, category: action.value };
    case 'select': return { ...state, selected: action.id, mobileDetail: true, status: '配置仅保存在本次预览，刷新后重置。' };
    case 'back': return { ...state, mobileDetail: false };
    case 'tab': return { ...state, tab: action.value };
    case 'enable': return {
      ...state, enabled: { ...state.enabled, [action.id]: action.value },
      events: appendEvent(state, action, action.value ? '在预览中启用了插件' : '在预览中停用了插件', 'toggle'),
      status: `${getPlugin(action.id).name}已在预览中${action.value ? '启用' : '停用'}，未修改真实应用。`,
    };
    case 'edit': return { ...state, drafts: { ...state.drafts, [state.selected]: { ...state.drafts[state.selected], [action.field]: action.value } } };
    case 'reset': return { ...state, drafts: { ...state.drafts, [state.selected]: { ...getPlugin(state.selected).defaults } }, status: '已恢复默认草稿；点击「更新设置」后在预览中应用。' };
    case 'apply': {
      const draft = state.drafts[state.selected];
      if (Object.keys(validationErrors(draft)).length) return { ...state, status: '设置尚未应用，请先修正输入。' };
      return { ...state, applied: { ...state.applied, [state.selected]: { ...draft } }, status: '已应用到本次预览，未连接系统服务。', events: appendEvent(state, action, '在预览中应用了设置', 'config') };
    }
    case 'preview': {
      if (!state.enabled[state.selected]) return state;
      return { ...state, events: appendEvent(state, action, '预览了一条演示通知', 'preview') };
    }
    case 'ack': return { ...state, events: appendEvent(state, action, '完成了一条演示通知', 'ack'), status: '演示通知已标记完成。' };
    default: return state;
  }
}
