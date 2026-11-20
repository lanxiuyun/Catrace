const desktop = document.querySelector('.desktop');
const toolbar = document.querySelector('.demo-toolbar');
const tabs = Array.from(document.querySelectorAll('[data-scene-button]'));
const scenes = Array.from(document.querySelectorAll('.demo-scene'));
const playButton = document.querySelector('.play-toggle');
const status = document.getElementById('demo-status');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const messages = {
  agent: ['已允许，继续工作吧。', '不用切回终端，也能处理这次请求。', '授权结果 · 交互演示'],
  phone: ['顺手复制，接着登录。', '重要的信息，不必藏在另一个屏幕里。', '复制完成 · 交互演示'],
  rest: ['好，忙完这一点再休息。', '可以推迟，也可以跳过。节奏由你决定。', '5 分钟后提醒 · 交互演示'],
};
const sequence = Object.keys(messages).flatMap((scene) => [
  { scene, resolved: false, hold: 3400 },
  { scene, resolved: true, hold: 2000 },
]);

let frame = 0;
let timer = null;
let remaining = sequence[0].hold;
let deadline = 0;
let inView = false;
let requested = !motion.matches;

function setResolved(resolved, message = messages[desktop.dataset.scene]) {
  const scene = document.getElementById(`scene-${desktop.dataset.scene}`);
  desktop.dataset.resolved = String(resolved);
  scene.querySelector('.initial-state').setAttribute('aria-hidden', String(resolved));
  scene.querySelector('.success-state').setAttribute('aria-hidden', String(!resolved));
  scene.querySelector('.notification-actions').inert = resolved;
  scene.querySelector('.demo-reset').disabled = !resolved;
  scene.querySelector('.success-state h3').textContent = message[0];
  scene.querySelector('.success-state p').textContent = message[1];
  scene.querySelector('.result-note').textContent = message[2];
}

function setScene(name, resolved = false) {
  desktop.dataset.scene = name;
  for (const scene of scenes) {
    const active = scene.id === `scene-${name}`;
    scene.dataset.active = String(active);
    scene.setAttribute('aria-hidden', String(!active));
    scene.inert = !active;
  }
  for (const tab of tabs) {
    const active = tab.dataset.sceneButton === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  setResolved(resolved);
}

function pauseTimer() {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
  remaining = Math.max(0, deadline - performance.now());
}

function syncPlayback() {
  const playing = requested && inView && !document.hidden;
  desktop.dataset.playing = String(playing);
  playButton.querySelector('.play-label').textContent = requested ? '暂停演示' : '播放演示';
  playButton.querySelector('.play-glyph').textContent = requested ? 'Ⅱ' : '▶';
  playButton.setAttribute('aria-label', requested ? '暂停演示' : '播放演示');
  if (!playing) {
    pauseTimer();
    return;
  }
  if (timer !== null) return;
  deadline = performance.now() + remaining;
  timer = setTimeout(() => {
    timer = null;
    frame = (frame + 1) % sequence.length;
    const next = sequence[frame];
    setScene(next.scene, next.resolved);
    remaining = next.hold;
    syncPlayback();
  }, remaining);
}

function stopForInteraction() {
  requested = false;
  desktop.dataset.autoplay = 'false';
  syncPlayback();
}

function selectManually(tab, keyboard) {
  stopForInteraction();
  desktop.dataset.instant = String(keyboard || motion.matches);
  frame = sequence.findIndex((item) => item.scene === tab.dataset.sceneButton);
  remaining = sequence[frame].hold;
  setScene(tab.dataset.sceneButton);
  status.textContent = '';
}

for (const tab of tabs) {
  tab.addEventListener('click', (event) => selectManually(tab, event.detail === 0));
  tab.addEventListener('keydown', (event) => {
    let index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault();
    selectManually(tabs[index], true);
    tabs[index].focus();
  });
}

desktop.addEventListener('pointerdown', stopForInteraction);
desktop.addEventListener('focusin', stopForInteraction);
for (const button of desktop.querySelectorAll('[data-demo-action]')) {
  button.disabled = false;
  button.addEventListener('click', (event) => {
    stopForInteraction();
    desktop.dataset.instant = String(event.detail === 0 || motion.matches);
    const action = button.dataset.demoAction;
    let message = messages[desktop.dataset.scene];
    if (action === 'decline') message = ['好，这次不执行。', '请求已拒绝，继续手头的工作。', '已拒绝 · 交互演示'];
    if (action === 'skip') message = ['好，这一轮不再提醒。', '什么时候休息，还是由你决定。', '跳过本次 · 交互演示'];
    const resolved = action !== 'reset';
    setResolved(resolved, message);
    frame = sequence.findIndex((item) => item.scene === desktop.dataset.scene) + Number(resolved);
    remaining = sequence[frame].hold;
    status.textContent = resolved ? `${message[0]} ${message[2]}` : '已重置当前演示。';
    // Keep keyboard focus inside the newly visible state, not its inert predecessor.
    const scene = button.closest('.demo-scene');
    const target = scene.querySelector(resolved ? '.demo-reset' : '.demo-primary');
    target.focus({ preventScroll: true });
  });
}

playButton.addEventListener('click', (event) => {
  requested = !requested;
  desktop.dataset.instant = String(event.detail === 0 || motion.matches);
  desktop.dataset.autoplay = 'true';
  syncPlayback();
});
document.addEventListener('visibilitychange', syncPlayback);
motion.addEventListener('change', () => {
  desktop.dataset.instant = String(motion.matches);
  if (motion.matches) stopForInteraction();
});

setScene('agent');
desktop.dataset.instant = String(motion.matches);
desktop.dataset.autoplay = String(requested);
toolbar.hidden = false;

if ('IntersectionObserver' in window) {
  desktop.dataset.entered = String(motion.matches);
  const demoObserver = new IntersectionObserver((entries) => {
    inView = entries[0].isIntersecting && entries[0].intersectionRatio >= .25;
    if (inView) desktop.dataset.entered = 'true';
    syncPlayback();
  }, { threshold: .25 });
  demoObserver.observe(desktop);

  const revealObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: .12, rootMargin: '0px 0px -4% 0px' });
  for (const element of document.querySelectorAll('[data-reveal]')) {
    if (!motion.matches) element.classList.add('reveal-pending');
    revealObserver.observe(element);
  }

  const story = document.querySelector('.story-visual');
  const shots = Array.from(document.querySelectorAll('[data-shot]'));
  const dots = Array.from(document.querySelectorAll('[data-dot]'));
  const visibility = new Map();
  const storyObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) visibility.set(entry.target, entry.intersectionRatio);
    const best = Array.from(visibility).sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] === 0) return;
    const name = best[0].dataset.step;
    story.dataset.story = name;
    for (const shot of shots) shot.dataset.active = String(shot.dataset.shot === name);
    for (const dot of dots) dot.dataset.active = String(dot.dataset.dot === name);
  }, { rootMargin: '-25% 0px -25% 0px', threshold: [0, .25, .5, .75, 1] });
  for (const step of document.querySelectorAll('[data-step]')) storyObserver.observe(step);
} else {
  // Without visibility observation, only play when explicitly requested.
  inView = true;
  requested = false;
  desktop.dataset.autoplay = 'false';
}

syncPlayback();
