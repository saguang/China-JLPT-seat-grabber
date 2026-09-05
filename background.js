// 后台 Service Worker：负责按间隔刷新目标页面，并广播状态
const ALARM = 'exam-seat-monitor-tick';

// 启动 / 重启时清理旧 alarm
chrome.runtime.onInstalled.addListener(() => {
  console.log('[考位监控] 扩展已安装');
  chrome.alarms.clear(ALARM);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.clear(ALARM);
});

// 接收 popup 的"启动监控"指令
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg && msg.type === 'START_MONITOR') {
      const { intervalMinutes, targetURL } = msg;
      await chrome.alarms.clear(ALARM);
      chrome.alarms.create(ALARM, { periodInMinutes: intervalMinutes });
      await chrome.storage.local.set({
        enabled: true,
        intervalMinutes,
        targetURL,
        lastTick: Date.now()
      });
      sendResponse({ ok: true });
      return;
    }
    if (msg && msg.type === 'STOP_MONITOR') {
      await chrome.alarms.clear(ALARM);
      await chrome.storage.local.set({ enabled: false });
      sendResponse({ ok: true });
      return;
    }
    if (msg && msg.type === 'CHECK_NOW') {
      await refreshTargetTabs();
      sendResponse({ ok: true });
      return;
    }
    if (msg && msg.type === 'STOP_BEEP') {
      await stopAlertSounds();
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, err: 'unknown' });
  })();
  return true; // 异步响应
});

// alarm 回调：到点刷新目标 URL 对应的 tab
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  await refreshTargetTabs();
});

async function refreshTargetTabs() {
  const { targetURL } = await chrome.storage.local.get(['targetURL']);
  if (!targetURL) return;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: targetURL });
  } catch (e) {
    // 一些站点 pattern 不匹配时 url 查询会抛错
  }
  // 兜底：active tab
  if (!tabs.length) {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  for (const tab of tabs) {
    if (tab.id != null) {
      try {
        await chrome.tabs.reload(tab.id);
      } catch (e) {}
    }
  }
  await chrome.storage.local.set({ lastTick: Date.now() });
}

// 持续强提示：浏览器自带 TTS 反复朗读
// 后台可调用 chrome.tts.speak，不受"用户手势"限制
function startTtsAlert() {
  try {
    if (chrome.tts && chrome.tts.stop) chrome.tts.stop();
    const text = '考位出现！请立刻抢报！考位出现！请立刻抢报！考位出现！';
    if (chrome.tts && chrome.tts.speak) {
      chrome.tts.speak(text, {
        rate: 1.2,
        pitch: 1.0,
        volume: 1.0,
        enqueue: false
      });
    }
  } catch (e) {
    console.warn('[考位监控] TTS 启动失败：', e);
  }
}

function stopAlertSounds() {
  try { if (chrome.tts && chrome.tts.stop) chrome.tts.stop(); } catch (e) {}
  // 通知所有匹配的 tab 停掉 content 中的 AudioContext
  chrome.tabs.query({}).then(tabs => {
    for (const t of tabs) {
      if (t && t.id != null) {
        try { chrome.tabs.sendMessage(t.id, { type: 'STOP_BEEP' }); } catch (e) {}
      }
    }
  });
}

// 接收 content script 的"发现考位"消息，发出系统通知 + 更新 badge + 持续提示
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'SEAT_FOUND') {
    chrome.notifications.create('seat-found', {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: '⚠️ 检测到考位！',
      message: (msg.text || '打开浏览器立即抢报') + '\n' + (msg.url || ''),
      priority: 2,
      requireInteraction: true   // 通知常驻，必须用户点掉
    });
    chrome.action.setBadgeText({ text: '! ' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });
    // 后台 TTS 朗读（持续声音）
    startTtsAlert();
    // 记命中数
    chrome.storage.local.get(['hitCount']).then(({ hitCount }) => {
      chrome.storage.local.set({ hitCount: (hitCount || 0) + 1 });
    });
  }
  if (msg && msg.type === 'GRABBED') {
    chrome.notifications.create('grabbed', {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: '已自动点击抢报按钮',
      message: '请尽快在浏览器内确认提交结果。',
      priority: 2
    });
    chrome.action.setBadgeText({ text: 'OK' });
    chrome.action.setBadgeBackgroundColor({ color: '#34c759' });
  }
});