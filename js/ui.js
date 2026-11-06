// DOM readouts and controls: status bar, mode buttons, mirror flip, the
// gesture debug panel (?gesture=1 / G, C to copy a snapshot), and the protocol
// overlay/result. The live signal panel lives in signal-panel.js.
import { CONFIG } from './config.js';
import { GESTURE_LABELS } from './gesture.js';
import { createSignalPanel } from './signal-panel.js';

const FINGER_CN = { thumb: '拇', index: '食', middle: '中', ring: '无', pinky: '小' };
const FINGER_ORDER = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const RESULT_VISIBLE_MS = 15000;
const COPIED_MS = 1500;
const COVERAGE_WARN = 0.9;

export function createUI({
  slotList,
  pairGesture,
  params,
  getMode,
  onModeChange,
  onFlip,
  onSelectProtocol,
  onStartProtocol,
  onToggleSignal,
}) {
  const statusEl = document.getElementById('status');
  const hintEl = document.getElementById('hint');
  const gesturePanel = document.getElementById('gesture-debug');
  const modeButtons = [...document.querySelectorAll('#mode-switch button')];
  const flipBtn = document.getElementById('flip-btn');
  const protocolButtons = [...document.querySelectorAll('#protocol-bar button[data-protocol]')];
  const protocolStart = document.getElementById('protocol-start');
  const protocolOverlay = document.getElementById('protocol-overlay');
  const protocolCount = document.getElementById('protocol-count');
  const protocolTask = document.getElementById('protocol-task');
  const protocolHint = document.getElementById('protocol-hint');
  const resultPanel = document.getElementById('result-panel');
  const signalPanel = createSignalPanel({ params });

  let resultTimer = 0;

  for (const btn of protocolButtons) {
    btn.addEventListener('click', () => onSelectProtocol(btn.dataset.protocol));
  }
  protocolStart.addEventListener('click', onStartProtocol);
  resultPanel.addEventListener('click', hideResult);

  let gesturePanelOn = params.has('gesture');
  if (gesturePanel) gesturePanel.hidden = !gesturePanelOn;

  for (const btn of modeButtons) {
    btn.addEventListener('click', () => onModeChange(btn.dataset.mode));
  }
  flipBtn.addEventListener('click', onFlip);

  function syncMode(next) {
    for (const btn of modeButtons) {
      const active = btn.dataset.mode === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    hintEl.textContent = next === 'glow'
      ? '握拳点亮 · 张手熄灭 · 支持双手'
      : '握拳点火 · 张手熄灭 · 支持双手';
  }

  function updateStatus(now) {
    const parts = [];
    for (const slot of slotList) {
      if (!slot.latest || now - slot.latest.t >= CONFIG.handLostMs) continue;
      const side = sideLabel(slot);
      const active = slot.fire.firing || slot.fire.intensity > 0.15;
      const label = getMode() === 'glow' ? '微光' : '燃烧';
      const gesture = slot.gesture.label !== 'none'
        ? ' · ' + GESTURE_LABELS[slot.gesture.label] : '';
      parts.push(side + gesture + (active ? ' · ' + label : ' · 已贴合'));
    }
    if (pairGesture.active) parts.push('零点突破');
    statusEl.textContent = parts.length ? parts.join('    ') : '请把手放进画面';
  }

  function snapshot() {
    const out = {};
    for (const slot of slotList) {
      const g = slot.gesture;
      out[slot.name] = {
        detected: g.detected,
        label: g.label,
        candidate: g.candidate,
        curls: Object.fromEntries(
          FINGER_ORDER.map((n) => [n, Number(g.curls[n].toFixed(3))]),
        ),
        extended: { ...g.extended },
      };
    }
    out.pair = {
      active: pairGesture.active,
      metrics: pairGesture.metrics
        ? Object.fromEntries(
          Object.entries(pairGesture.metrics).map(([k, v]) => [k, Number(v.toFixed(3))]),
        )
        : null,
    };
    return out;
  }

  let copiedUntil = 0;

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'g' || e.key === 'G') {
      gesturePanelOn = !gesturePanelOn;
      if (gesturePanel) gesturePanel.hidden = !gesturePanelOn;
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      // Tuning aid: pop the current numbers on the clipboard for a bug report.
      const text = JSON.stringify(snapshot(), null, 2);
      navigator.clipboard?.writeText(text)
        .then(() => { copiedUntil = performance.now() + COPIED_MS; })
        .catch(() => {});
      console.log(text);
    }
    if (e.key === 's' || e.key === 'S') {
      onToggleSignal?.(signalPanel.toggle());
    }
  });

  function updateGesturePanel() {
    if (!gesturePanel || !gesturePanelOn) return;
    const lines = [];
    for (const slot of slotList) {
      const g = slot.gesture;
      const side = sideLabel(slot);
      if (!g.detected) {
        lines.push(side + '  未检测到');
        continue;
      }
      const label = GESTURE_LABELS[g.label] || g.label;
      const candidate = g.candidate !== g.label
        ? '  (候选 ' + (GESTURE_LABELS[g.candidate] || g.candidate) + ')'
        : '';
      const curls = FINGER_ORDER
        .map((n) => FINGER_CN[n] + g.curls[n].toFixed(2))
        .join(' ');
      lines.push(side + '  ' + label + candidate);
      lines.push('  ' + curls);
    }
    if (pairGesture.metrics) {
      const m = pairGesture.metrics;
      lines.push('双手  ' + (pairGesture.active ? '零点突破' : '—')
        + '  拇' + m.dThumb.toFixed(2)
        + ' 食' + m.dIndex.toFixed(2)
        + ' 轴' + m.symmetry.toFixed(2));
    }
    lines.push(performance.now() < copiedUntil ? '已复制 ✓' : '按 C 复制数据');
    gesturePanel.textContent = lines.join('\n');
  }

  function syncProtocol(def) {
    for (const btn of protocolButtons) {
      const active = btn.dataset.protocol === def.id;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    protocolStart.hidden = def.id === 'free';
    protocolStart.textContent = '开始';
  }

  function setProtocolBusy(busy) {
    for (const btn of protocolButtons) btn.disabled = busy;
    protocolStart.textContent = busy ? '取消' : '开始';
  }

  // During the lead-in the overlay is the countdown; while the task runs the
  // REC badge carries progress, so the overlay stays out of the way.
  function setProtocolPhase(phase, def, remain = 0) {
    if (phase === 'leadIn') {
      protocolOverlay.hidden = false;
      protocolCount.textContent = String(Math.max(1, Math.ceil(remain)));
      protocolTask.textContent = def.name;
      protocolHint.textContent = def.hint;
    } else {
      protocolOverlay.hidden = true;
    }
  }

  function hideResult() {
    clearTimeout(resultTimer);
    resultPanel.hidden = true;
  }

  function showResult(metrics, def) {
    clearTimeout(resultTimer);
    const lines = [`${def.name} · ${(metrics.durationMs / 1000).toFixed(1)}s`];
    if (def.metric === 'none') {
      lines.push(`${metrics.sampleCount} 个采样`);
    } else {
      for (const side of ['left', 'right']) {
        const m = metrics.hands?.[side];
        lines.push(formatHandMetrics(side, m, def.metric));
        if (m && m.detected && (m.coverage < COVERAGE_WARN || m.handSwap)) {
          const flags = [];
          if (m.coverage < COVERAGE_WARN) {
            flags.push('覆盖率 ' + Math.round(m.coverage * 100) + '%');
          }
          if (m.handSwap) flags.push('中途换手');
          lines.push('  ⚠ ' + flags.join(' · '));
        }
      }
    }
    lines.push('已保存 JSON');
    resultPanel.textContent = lines.join('\n');
    resultPanel.hidden = false;
    resultTimer = setTimeout(hideResult, RESULT_VISIBLE_MS);
  }

  function syncSignal(def) {
    signalPanel.sync(def);
  }

  function toggleSignalPanel(next) {
    return signalPanel.toggle(next);
  }

  function updateSignalPanel(monitor, def, now) {
    signalPanel.update(monitor, def, now);
  }

  return {
    syncMode,
    updateStatus,
    updateGesturePanel,
    syncProtocol,
    setProtocolBusy,
    setProtocolPhase,
    showResult,
    hideResult,
    syncSignal,
    toggleSignalPanel,
    updateSignalPanel,
  };
}

function sideLabel(slot) {
  return slot.name === 'left' ? '左手' : '右手';
}

function formatHandMetrics(side, m, metric) {
  const cn = side === 'left' ? '左手' : '右手';
  if (!m || !m.detected) return `${cn}  未检测到有效数据`;
  if (metric === 'cycle') {
    return `${cn}  开合 ${m.count} 次 · ${m.freqHz.toFixed(1)} Hz · 幅度 ${m.amplitude.toFixed(2)}`;
  }
  if (metric === 'rotation') {
    return `${cn}  翻腕 ${m.count.toFixed(1)} 次 · ${m.freqHz.toFixed(1)} Hz · 幅度 ${Math.round(m.rangeDeg)}°`;
  }
  return cn;
}
