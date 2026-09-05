// popup 脚本：表单读写、与 background 通信
const $ = (id) => document.getElementById(id);

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + (kind || 'off');
}

async function load() {
  const cfg = await chrome.storage.local.get([
    'targetURL', 'interval', 'seatSelector', 'matchText', 'grabSelector',
    'matchMode', 'autoGrab', 'playSound', 'flash',
    'targetKeyword', 'statusKeyword',
    'enabled', 'lastTick', 'hitCount'
  ]);
  $('targetURL').value   = cfg.targetURL || '';
  $('interval').value    = cfg.interval || 1;
  $('seatSelector').value= cfg.seatSelector || '';
  $('matchText').value   = cfg.matchText || '';
  $('grabSelector').value= cfg.grabSelector || '';
  $('matchMode').value   = cfg.matchMode || 'row-match';
  $('targetKeyword').value = cfg.targetKeyword || '';
  $('statusKeyword').value = cfg.statusKeyword || '有名额';
  $('autoGrab').checked  = !!cfg.autoGrab;
  $('playSound').checked = cfg.playSound !== false; // 默认开启
  $('flash').checked     = cfg.flash !== false;     // 默认开启
  $('hitCount').textContent = cfg.hitCount || 0;
  lastSeenHitCount = cfg.hitCount || 0;
  $('lastTick').textContent = cfg.lastTick
    ? new Date(cfg.lastTick).toLocaleTimeString()
    : '—';
  syncSections();
  setStatus(cfg.enabled ? '运行中' : '未运行', cfg.enabled ? 'on' : 'off');
}

// row-match 与通用选择器模式的区块显隐
function syncSections() {
  const isRow = $('matchMode').value === 'row-match';
  ['rowSection', 'rowSection2'].forEach(id => { $(id).style.display = isRow ? '' : 'none'; });
  ['selectorSection', 'selectorSection2', 'selectorSection3'].forEach(id => { $(id).style.display = isRow ? 'none' : ''; });
}

async function save() {
  const interval = Math.max(1, parseInt($('interval').value, 10) || 1);
  const cfg = {
    targetURL:    $('targetURL').value.trim(),
    interval,
    seatSelector: $('seatSelector').value.trim(),
    matchText:    $('matchText').value.trim(),
    grabSelector: $('grabSelector').value.trim(),
    matchMode:    $('matchMode').value,
    targetKeyword: $('targetKeyword').value.trim(),
    statusKeyword: $('statusKeyword').value.trim() || '有名额',
    autoGrab:     $('autoGrab').checked,
    playSound:    $('playSound').checked,
    flash:        $('flash').checked
  };
  await chrome.storage.local.set(cfg);
  return cfg;
}

// 匹配模式切换时同步显示/隐藏
$('matchMode').addEventListener('change', syncSections);

$('start').addEventListener('click', async () => {
  const cfg = await save();
  if (!cfg.targetURL) { setStatus('请填写目标 URL', 'err'); return; }
  if (cfg.matchMode === 'row-match') {
    if (!cfg.targetKeyword) { setStatus('请填写目标考点名称', 'err'); return; }
  } else if (!cfg.seatSelector) {
    setStatus('请填写考位选择器', 'err'); return;
  }
  await chrome.runtime.sendMessage({
    type: 'START_MONITOR',
    targetURL: cfg.targetURL,
    intervalMinutes: cfg.interval
  });
  setStatus('运行中', 'on');
});

$('stop').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP_MONITOR' });
  setStatus('未运行', 'off');
});

$('test').addEventListener('click', async () => {
  await save();
  const logBox = $('logBox');
  logBox.textContent = '正在注入并检测当前标签页…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) { logBox.textContent = '未找到当前标签页'; return; }

    // 先把最新 content script 注入到当前页（解决"重新加载后旧页未注入"的问题）
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    // 再发检测指令，拿结果
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_NOW' });
    logBox.className = 'logBox ' + (res && res.hit ? 'hit' : 'miss');
    if (res && res.hit) {
      logBox.textContent = '✅ 命中！当前状态：' + (res.statusText || '有名额') + (res.grabbed ? '（已点击预定）' : '');
      setStatus('运行中', 'on');
    } else {
      logBox.textContent = '本次未检测到考位（' + new Date().toLocaleTimeString() + '）';
    }
    // 如果有诊断信息（未命中时），追加显示，帮定位问题
    if (res && res.debug && res.debug.length) {
      logBox.textContent += '\n— 诊断 —\n' + res.debug.join('\n');
    }
  } catch (e) {
    logBox.className = 'logBox miss';
    logBox.textContent = '无法检测：' + e.message;
  }
  setTimeout(load, 800);
});

document.addEventListener('DOMContentLoaded', load);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') load();
});

// "立即停止提示音" 按钮：停后台 TTS + 给所有 tab 发 STOP_BEEP
$('silence').addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'STOP_BEEP' });
    $('silence').hidden = true;
    const logBox = $('logBox');
    if (logBox) logBox.textContent = '已停止所有提示音';
  } catch (e) {
    console.warn('停止提示音失败：', e);
  }
});

// 命中后显示"停止"按钮（监听 background 推送的 SEAT_FOUND 状态变化）
// 这里用 chrome.storage 的 hitCount 变化间接判断：
// 当 hitCount 增长，说明刚命中；显示按钮
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.hitCount && typeof changes.hitCount.newValue === 'number') {
    if (changes.hitCount.newValue > lastSeenHitCount) {
      $('silence').hidden = false;
      lastSeenHitCount = changes.hitCount.newValue;
    }
  }
});