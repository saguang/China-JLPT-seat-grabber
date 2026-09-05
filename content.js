// content script：检测考位 + 可选自动点击抢按钮
// 采用命名空间 + 幂等初始化：允许通过 chrome.scripting 重复注入，
// 每次更新最新逻辑，但只绑定一次消息监听。
(function () {
  const NS = (window.__examSeatMonitor = window.__examSeatMonitor || {});
  if (!NS.inited) {
    NS.inited = true;
  }

  let cfg = null;
  let lastReportAt = 0;
  let lastDebug = [];

  async function loadCfg() {
    cfg = await chrome.storage.local.get([
      'seatSelector',
      'matchText',
      'matchMode',     // 'include' | 'disabled-true' | 'visible-clickable' | 'row-match'
      'grabSelector',
      'autoGrab',
      'flash',
      'playSound',
      'targetKeyword',  // row-match 模式：目标考点名称/代码
      'statusKeyword'   // row-match 模式：视为"有考位"的状态词，默认"有名额"
    ]);
  }

  // 持续强提示音：双频交替 + 循环，直到 stopBeep() 或 NS._beepStopAt 到期
  // 默认持续 30 秒、音量 0.8，比之前的 3 声短促响得多。
  function startBeep(durationMs) {
    stopBeep();
    try {
      const dur = Math.max(5000, Math.min(300000, durationMs || 30000)); // 5s~5min
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
      const stopAt = ctx.currentTime + dur / 1000;
      NS._beepCtx = ctx;
      NS._beepStopAt = stopAt;

      // 4 音一组："叮-咚-叮-嗒"，刺耳易识别
      const patterns = [
 880, 660, 880, 1320
      ];
      const perDur = 0.18;

      function playLoop() {
        if (!NS._beepCtx || NS._beepCtx !== ctx) return;
        if (ctx.currentTime >= stopAt) {
          try { master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05); } catch (e) {}
          return;
        }
        let t = ctx.currentTime + 0.02;
        patterns.forEach(f => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'square'; // 方波更刺耳
          osc.frequency.value = f;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.7, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.001, t + perDur);
          osc.connect(g);
          g.connect(master);
          osc.start(t);
          osc.stop(t + perDur + 0.01);
          t += perDur;
        });
        // 下一拍延迟触发（留 ~50ms 静音间隔）
        setTimeout(playLoop, (t - ctx.currentTime) * 1000 + 50);
      }
      playLoop();
      console.log('[考位监控] 持续提示音已开始（' + Math.round(dur / 1000) + '秒）');
    } catch (e) {
      console.warn('[考位监控] 无法播放提示音:', e);
    }
  }

  function stopBeep() {
    if (NS._beepCtx) {
      try { NS._beepCtx.close(); } catch (e) {}
      NS._beepCtx = null;
      NS._beepStopAt = 0;
      console.log('[考位监控] 提示音已停止');
    }
  }

  // 兼容旧调用（一次性的快速 beep）
  function beep() {
    startBeep(5000);
  }

  function log(...args) {
    console.log('%c[考位监控]', 'color:#ff9500;font-weight:bold', ...args);
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function matches(el) {
    if (!el) return false;
    if (cfg.matchMode === 'disabled-true') {
      const disabledAttr = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');
      return !disabledAttr && isVisible(el);
    }
    if (cfg.matchMode === 'visible-clickable') {
      return isVisible(el) && !el.disabled;
    }
    const text = (el.innerText || el.textContent || '').trim();
    if (!text) return false;
    if (!cfg.matchText) return isVisible(el);
    return text.includes(cfg.matchText);
  }

  function flash(el) {
    if (!el) return;
    const orig = el.style.outline;
    el.style.outline = '3px solid #ff3b30';
    el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = orig; }, 6000);
  }

  // ---- row-match 模式：适合 JLPT 表格 ----
  // 关键：NEEA 页面所有考点共用一个 <tr>（诊断显示"该行共 343 个 td"），
  // 是「地区/代码/名称/状态/预定」循环的扁平 td 序列，不能按行切分。
  // 因此改为扁平定位：找到含考点名称的 td，取它后面紧随的"状态"td（"有名额"那格）。
  // 返回 { hit, statusText, grabBtn, seatEl, nameCell, debug }。
  function findRowSeat() {
    const dbg = [];
    const kw = (cfg.targetKeyword || '').trim();
    if (!kw) return { hit: false, debug: ['未填目标考点名称'] };

    // 1) 收集全部 td
    const cells = Array.from(document.querySelectorAll('td'));
    dbg.push('页面 td 总数：' + cells.length);

    // 2) 找含目标考点名称的 td
    let nameIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      const t = (cells[i].innerText || cells[i].textContent || '').trim();
      // 要求：不含"地区/考点代码"等结构字段的标题行；文本就是考点名（短文本）
      if (t.includes(kw) && t.length <= 60) {
        nameIdx = i;
        dbg.push('✓ 找到考点名称 td @[' + i + ']：' + t);
        break;
      }
    }
    if (nameIdx < 0) {
      dbg.push('✗ 未找到包含"' + kw + '"的考点名称单元格');
      return { hit: false, debug: dbg };
    }

    // 3) 状态 td：名称 td 之后的第一个"状态"单元格（有名额/名额暂满）
    let statusIdx = -1;
    for (let i = nameIdx + 1; i < cells.length; i++) {
      const t = (cells[i].innerText || cells[i].textContent || '').trim();
      if (/名额|暂满|有名额|已满|满/.test(t)) { statusIdx = i; dbg.push('✓ 状态 td @[' + i + ']：' + t); break; }
      // 安全上限：最多找 5 格（代码/名称/状态/预定 间隔很近）
      if (i - nameIdx > 5) break;
    }
    if (statusIdx < 0) {
      dbg.push('✗ 未在考点名称后找到状态单元格');
      return { hit: false, debug: dbg };
    }
    const statusText = (cells[statusIdx].innerText || '').replace(/\s+/g, ' ').trim();

    // 4) 判定：含"有名额"且不含"暂满/已满"
    if (statusText.includes('暂满') || statusText.includes('已满')) {
      dbg.push('✗ 状态为"暂满/已满"，判定无考位');
      return { hit: false, statusText, debug: dbg };
    }
    if (!statusText.includes(cfg.statusKeyword || '有名额')) {
      dbg.push('✗ 状态不含关键词"' + (cfg.statusKeyword || '有名额') + '"，判定无考位');
      return { hit: false, statusText, debug: dbg };
    }
    dbg.push('✓ 状态为"有名额"，命中！');

    // 5) 预定按钮：在状态 td 之后找可点击元素（预定/预订）
    let grabBtn = null;
    for (let i = statusIdx + 1; i < cells.length && i <= statusIdx + 3; i++) {
      const clickable = cells[i].querySelector('a,button,input[type=button],input[type=submit],span[onclick]');
      if (clickable) {
        const t = (clickable.innerText || clickable.value || clickable.textContent || '').trim();
        if (/预定|预订/.test(t) || clickable.tagName === 'A' || clickable.tagName === 'BUTTON' || clickable.tagName === 'INPUT') {
          grabBtn = clickable;
          dbg.push('✓ 预定按钮 @[' + i + ']：' + (t || clickable.tagName));
          break;
        }
      }
    }
    if (!grabBtn) dbg.push('✗ 状态后 3 格内未定位到预订按钮（不影响命中，仅影响自动点击）');

    return { hit: true, statusText, grabBtn, seatEl: cells[statusIdx], nameCell: cells[nameIdx], debug: dbg };
  }

  async function checkAndGrab(quiet) {
    await loadCfg();
    if (!cfg) return { hit: false, reason: 'no-config' };

    let seatEl = null, grabBtn = null, rowEl = null, statusText = '';

    if (cfg.matchMode === 'row-match') {
      const found = findRowSeat();
      lastDebug = found.debug || [];
      if (!found.hit) {
        log('本次未检测到考位（', new Date().toLocaleTimeString(), '）', found.debug);
        // 把诊断信息传给 popup
        chrome.runtime.sendMessage({ type: 'DETECT_DIAG', lines: found.debug || [] }).catch(() => {});
        return { hit: false, reason: 'no-seat', debug: found.debug || [] };
      }
      ({ seatEl, grabBtn, statusText } = found);
      rowEl = found.nameCell || found.seatEl; // 用考点名称格或状态格做高亮/通知
    } else {
      if (!cfg.seatSelector) return { hit: false, reason: 'no-selector' };
      try { seatEl = document.querySelector(cfg.seatSelector); } catch (e) {
        log('选择器错误：', cfg.seatSelector, e.message);
        return { hit: false, reason: 'selector-error' };
      }
      if (!matches(seatEl)) {
        log('本次未检测到考位（', new Date().toLocaleTimeString(), '）');
        return { hit: false, reason: 'no-seat' };
      }
      if (cfg.grabSelector) {
        try { grabBtn = document.querySelector(cfg.grabSelector); } catch (e) {}
      }
    }

    const now = Date.now();
    if (!quiet && now - lastReportAt < 3000) return { hit: false, reason: 'throttled' };
    lastReportAt = now;

    log('✅ 检测到考位！', seatEl);
    if (cfg.flash !== false) flash(rowEl || seatEl);
    // 持续响 30 秒（强音）；旧名称 beep() 也兼容
    if (cfg.playSound !== false) startBeep(30000);

    chrome.runtime.sendMessage({
      type: 'SEAT_FOUND',
      text: ((rowEl || seatEl).innerText || '').slice(0, 200),
      url: location.href
    });

    if (cfg.autoGrab && grabBtn) {
      log('点击抢按钮：', grabBtn);
      if (cfg.flash !== false) flash(grabBtn);
      try { grabBtn.click(); } catch (e) { log('click 失败：', e); }
      chrome.runtime.sendMessage({ type: 'GRABBED' });
    }

    return { hit: true, statusText, grabbed: !!(cfg.autoGrab && grabBtn), debug: lastDebug };
  }

  // 暴露为命名空间方法，供重复注入时随时调用最新逻辑
  NS.checkAndGrab = checkAndGrab;
  NS.startBeep = startBeep;
  NS.stopBeep = stopBeep;

  // ---- 以下仅初始化一次（消息监听 / MutationObserver / 首次检测） ----
  if (!NS.bound) {
    NS.bound = true;

    // popup 触发立即检测（返回结果） / 停止提示音
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'CHECK_NOW') {
        checkAndGrab(true).then(res => sendResponse(res)).catch(() => sendResponse({ hit: false, reason: 'error' }));
        return true;
      }
      if (msg && msg.type === 'STOP_BEEP') {
        stopBeep();
        sendResponse({ ok: true });
        return false;
      }
    });

    // 初次
    setTimeout(() => checkAndGrab(true), 1500);

    // 监听 DOM 变化（很多报名系统用 JS 局部更新），节流
    const observer = new MutationObserver(() => {
      clearTimeout(window.__seatDebounce);
      window.__seatDebounce = setTimeout(() => checkAndGrab(false), 400);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 配置变化时立即重载
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') loadCfg();
    });
  }

  loadCfg();
})();