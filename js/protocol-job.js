// Guided measurement flow: select a protocol, run its lead-in countdown,
// record for the fixed task window, then analyze and download the JSON.
//
// The recorder only captures raw samples; protocols.js owns the metrics. This
// controller is the one place that knows the task phases, so a researcher can
// read the measurement pipeline without going through the render loop.
import { PROTOCOLS, analyzeSession } from './protocols.js';
import { downloadSession } from './measure.js';

export class ProtocolJob {
  constructor({
    recorder, ui, signalMonitor, setStatus, getSource, onSaved,
    onProtocolChange, getTaskMeta, onTaskStart,
  }) {
    this.recorder = recorder;
    this.ui = ui;
    this.signalMonitor = signalMonitor;
    this.setStatus = setStatus;
    // Source label for a free recording; selftest sessions are marked as such.
    this.getSource = getSource || (() => 'free');
    this.onSaved = onSaved || (() => {});
    // The app owns the visual side of a task (e.g. the trace target); this
    // module only reports which protocol is selected. getTaskMeta supplies
    // task-specific data (guide box/points) that analysis needs.
    this.onProtocolChange = onProtocolChange || (() => {});
    this.getTaskMeta = getTaskMeta || (() => null);
    this.onTaskStart = onTaskStart || (() => {});
    this.selected = 'free';
    this.job = null;
  }

  // Boot-time wiring: pick the protocol from the URL (or fall back to free)
  // and sync the protocol bar and signal panel.
  init(id) {
    this.selected = PROTOCOLS[id] ? id : 'free';
    this.syncUI();
    this.onProtocolChange(this.def);
  }

  get def() {
    return PROTOCOLS[this.selected];
  }

  get active() {
    return Boolean(this.job);
  }

  // Refused while a recording is running: it already carries its protocol id,
  // and relabeling a session after the fact would corrupt the data.
  select(id) {
    if (this.job || this.recorder.active || !PROTOCOLS[id]) return false;
    this.selected = id;
    this.syncUI();
    this.onProtocolChange(this.def);
    return true;
  }

  syncUI() {
    const def = this.def;
    this.signalMonitor.setMetric(def.metric);
    this.ui.syncProtocol(def);
    this.ui.syncSignal(def);
  }

  // The single action behind the start button and the M key.
  start(now = performance.now()) {
    if (this.job) {
      this.cancel('已取消');
      return;
    }
    const def = this.def;
    if (def.id === 'free') {
      this.save(this.recorder.toggle(this.getSource()));
      return;
    }
    if (this.recorder.active) return; // still recording a free session
    // A new task starts clean: clear the previous result and any task visuals
    // (the app decides what "task visuals" means).
    this.ui.hideResult();
    this.onTaskStart(def);
    this.job = { def, phase: 'leadIn', t0: now };
    this.ui.setProtocolBusy(true);
    this.ui.setProtocolPhase('leadIn', def, def.leadIn);
  }

  cancel(message = '已取消') {
    if (!this.job) return;
    if (this.job.phase === 'recording') this.recorder.stop();
    this.job = null;
    this.ui.setProtocolBusy(false);
    this.ui.setProtocolPhase('idle');
    this.setStatus(message);
  }

  // Called every frame; no-op when no task is running.
  update(now) {
    if (!this.job) return;
    if (this.job.phase === 'leadIn') {
      const remain = this.job.def.leadIn - (now - this.job.t0) / 1000;
      if (remain > 0) {
        this.ui.setProtocolPhase('leadIn', this.job.def, remain);
        return;
      }
      this.job.phase = 'recording';
      this.job.t0 = now;
      // Wipe the warm-up ink so the recorded window starts on a clean canvas.
      this.onTaskStart(this.job.def);
      this.recorder.start(this.job.def.id);
      this.ui.setProtocolPhase('recording');
      return;
    }
    if ((now - this.job.t0) / 1000 >= this.job.def.seconds) this.finish();
  }

  // Badge data for the frame loop; null when nothing is running.
  progress(now) {
    if (!this.job) return null;
    const elapsed = (now - this.job.t0) / 1000;
    if (this.job.phase === 'recording') {
      return { phase: 'recording', elapsed, seconds: this.job.def.seconds };
    }
    return { phase: 'leadIn', remain: this.job.def.leadIn - elapsed };
  }

  finish() {
    const data = this.recorder.stop();
    this.job = null;
    this.ui.setProtocolBusy(false);
    this.ui.setProtocolPhase('idle');
    this.save(data);
  }

  save(data) {
    if (!data) return;
    const task = this.getTaskMeta(data);
    if (task) data.task = { ...(data.task || {}), ...task };
    data.metrics = analyzeSession(data);
    this.onSaved(data);
    downloadSession(data);
    this.ui.showResult(data.metrics, PROTOCOLS[data.protocol] || PROTOCOLS.free);
  }
}
