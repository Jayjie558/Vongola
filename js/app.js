import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CONFIG } from './config.js';
import { Retarget, mirrorFromLabel, toWorld } from './retarget.js';
import { ZeroBurst } from './zero-burst.js';
import { startTracking } from './hand-tracker.js';
import { FireSystem } from './fire.js';
import { FlameRig } from './flame3d.js';
import { GloveGlow } from './glove-glow.js';
import { HandGesture, PairGesture, GESTURE_LABELS } from './gesture.js';

const video = document.getElementById('webcam');
const canvas = document.getElementById('gl-canvas');
const fireCanvas = document.getElementById('fire-canvas');
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');
const flipBtn = document.getElementById('flip-btn');
const modeSwitch = document.getElementById('mode-switch');
const modeButtons = [...modeSwitch.querySelectorAll('button')];
const gesturePanel = document.getElementById('gesture-debug');

const params = new URLSearchParams(location.search);
const MODE = { glow: 'glow', flame: 'flame' };
function initialMode() {
  const v = (params.get('mode') || CONFIG.defaultMode).toLowerCase();
  return v === 'flame' || v === 'fire' || v === '2' ? MODE.flame : MODE.glow;
}
let visualMode = initialMode();

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = CONFIG.exposure;
renderer.setClearColor(0x000000, 0);
// The glow quad is drawn on top of the scene without wiping it.
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.01, 10);
camera.position.set(0, 0, 3);

// Flame meshes sit on their own layer so the bloom pass can render them alone.
const FLAME_LAYER = 1;
camera.layers.enable(FLAME_LAYER);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(-1.2, 1.6, 2.2);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x9fb8ff, 1.1);
rimLight.position.set(1.2, -0.3, -1.5);
scene.add(rimLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.3));

const fire = new FireSystem(fireCanvas);
const zeroBurst = new ZeroBurst(scene);

// Bloom only the flame: the glove is bright metal and would smear if the whole
// frame were filtered, so the flame lives on its own layer and gets a second,
// flame-only render. Its glow is then added straight onto the canvas, which
// keeps the flame's own per-fragment tone mapping untouched.
const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false; // the glow is composited by hand below
bloomComposer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  CONFIG.bloomStrength,
  CONFIG.bloomRadius,
  CONFIG.bloomThreshold,
);
bloomComposer.addPass(bloomPass);

const glowScene = new THREE.Scene();
const glowCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const glowQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: { tGlow: { value: null } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tGlow;
      varying vec2 vUv;
      void main() {
        vec3 g = texture2D(tGlow, vUv).rgb;
        vec3 c = vec3(1.0) - exp(-g);
        c = pow(c, vec3(0.4545));
        // color is added as-is; alpha only where there is glow, so the page
        // background stays transparent.
        gl_FragColor = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0));
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  }),
);
glowQuad.frustumCulled = false;
glowScene.add(glowQuad);

function setStatus(text) {
  statusEl.textContent = text;
}

function computeView() {
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const scale = Math.max(cw / vw, ch / vh);
  const rw = vw * scale;
  const rh = vh * scale;
  return { cw, ch, rw, rh, ox: (cw - rw) / 2, oy: (ch - rh) / 2 };
}

function resize() {
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(cw, ch, false);
  bloomComposer.setPixelRatio(dpr);
  bloomComposer.setSize(cw, ch);
  camera.left = -0.5 * cw / ch;
  camera.right = 0.5 * cw / ch;
  camera.top = 0.5;
  camera.bottom = -0.5;
  camera.updateProjectionMatrix();
  fire.resize();
  zeroBurst.setPixelRatio(dpr);
}
window.addEventListener('resize', resize);
resize();

setStatus('加载手套模型…');

const loader = new GLTFLoader();
const modelUrl = new URL('../glove.glb', import.meta.url).href;
let gltf;
try {
  gltf = await loader.loadAsync(modelUrl);
} catch (err) {
  console.error(err);
  setStatus('模型加载失败：' + err.message);
  throw err;
}

function prepareModel(model) {
  model.traverse((o) => {
    if (o.isMesh) {
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) m.side = THREE.DoubleSide;
    }
  });
  model.updateMatrixWorld(true);
}

const modelLeft = gltf.scene;
const modelRight = cloneSkeleton(modelLeft);
prepareModel(modelLeft);
prepareModel(modelRight);
scene.add(modelLeft);
scene.add(modelRight);

function makeSlot(name, model) {
  const retarget = new Retarget(model);
  retarget.setVisible(false);
  return {
    name,
    model,
    retarget,
    latest: null,
    lastLms: null,
    fire: fire.createHand(name),
    glow: new GloveGlow(model),
    gesture: new HandGesture(name),
  };
}

const slots = {
  left: makeSlot('left', modelLeft),
  right: makeSlot('right', modelRight),
};
const slotList = [slots.left, slots.right];
const pairGesture = new PairGesture();

// Procedural flame aura sphere around each fist.
fire.use3dBody = true;
for (const slot of slotList) {
  slot.flame = new FlameRig(slot.retarget.bones.Palm, scene);
}

const forceFire = params.has('fire');
let synthetic = null;
let mode = 'track';

function applyMode(next, updateUrl = false) {
  visualMode = next;
  fire.glowOnly = next === MODE.glow;
  for (const btn of modeButtons) {
    const active = btn.dataset.mode === next;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
  hintEl.textContent = next === MODE.glow
    ? '握拳点亮 · 张手熄灭 · 支持双手'
    : '握拳点火 · 张手熄灭 · 支持双手';

  // Swap visuals immediately instead of waiting for either side to fade out.
  for (const slot of slotList) {
    if (next === MODE.glow && slot.flame) {
      slot.flame.mesh.visible = false;
      slot.flame.light.visible = false;
    }
    if (next === MODE.flame && slot.glow) slot.glow.reset();
  }

  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('mode', next);
    history.replaceState(null, '', url);
  }
}

for (const btn of modeButtons) {
  btn.addEventListener('click', () => applyMode(btn.dataset.mode, true));
}
applyMode(visualMode);

if (params.has('raw')) {
  mode = 'raw';
  modelLeft.scale.setScalar(2.0);
  modelLeft.position.set(0, -0.2, 0);
  slots.left.retarget.setVisible(true);
  setStatus('RAW 绑定姿态');
} else if (params.has('selftest')) {
  mode = 'selftest';
  const mod = await import('./selftest.js');
  synthetic = mod.createSelftest(slots.left.retarget, setStatus, computeView());
} else {
  try {
    await startTracking({ video, onResults });
    setStatus('请把手放进画面');
  } catch (err) {
    console.error(err);
    setStatus('摄像头/识别启动失败：' + err.message);
  }
}

function updateStatus(now) {
  const parts = [];
  for (const slot of slotList) {
    if (!slot.latest || now - slot.latest.t >= CONFIG.handLostMs) continue;
    const side = slot === slots.left ? '左手' : '右手';
    const active = slot.fire.firing || slot.fire.intensity > 0.15;
    const label = visualMode === MODE.glow ? '微光' : '燃烧';
    const gesture = slot.gesture.label !== 'none'
      ? ' · ' + GESTURE_LABELS[slot.gesture.label] : '';
    parts.push(side + gesture + (active ? ' · ' + label : ' · 已贴合'));
  }
  if (pairGesture.active) parts.push('零点突破');
  setStatus(parts.length ? parts.join('    ') : '请把手放进画面');
}

// ── Gesture debug panel (?gesture=1, or press G) ──
const FINGER_CN = { thumb: '拇', index: '食', middle: '中', ring: '无', pinky: '小' };
const FINGER_ORDER = ['thumb', 'index', 'middle', 'ring', 'pinky'];
let gesturePanelOn = params.has('gesture');
if (gesturePanel) gesturePanel.hidden = !gesturePanelOn;

function gestureSnapshot() {
  const out = {};
  for (const slot of slotList) {
    const g = slot.gesture;
    out[slot === slots.left ? 'left' : 'right'] = {
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
    const text = JSON.stringify(gestureSnapshot(), null, 2);
    navigator.clipboard?.writeText(text)
      .then(() => { copiedUntil = performance.now() + 1500; })
      .catch(() => {});
    console.log(text);
  }
});

function updateGesturePanel() {
  if (!gesturePanel || !gesturePanelOn) return;
  const lines = [];
  for (const slot of slotList) {
    const g = slot.gesture;
    const side = slot === slots.left ? '左手' : '右手';
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

function onResults(results) {
  const lmsList = results.multiHandLandmarks || [];
  const handedness = results.multiHandedness || [];
  const t = performance.now();
  const claimed = new Set();

  for (let i = 0; i < lmsList.length; i++) {
    const label = handedness[i] ? handedness[i].label : null;
    const realRight = mirrorFromLabel(label);
    let slot = realRight === true ? slots.right : realRight === false ? slots.left : null;
    if (!slot || claimed.has(slot)) {
      // Missing or duplicate handedness: hand this detection to a free slot.
      slot = slotList.find((s) => !claimed.has(s)) || null;
    }
    if (!slot) continue;
    claimed.add(slot);
    slot.latest = { lms: lmsList[i], label, t };
  }
}

let mirrorOverride = null;

flipBtn.addEventListener('click', () => {
  const current = mirrorOverride !== null
    ? mirrorOverride
    : (slots.left.retarget.mirror || slots.right.retarget.mirror);
  mirrorOverride = !current;
});

let lastFrame = performance.now();
let lastStatusAt = 0;

// Where the two hands' thumb/index tips meet, in scene units, plus the hand's
// wrist-to-knuckle length so the energy can scale with the hands.
const zeroAnchor = { center: new THREE.Vector3(), size: 0 };
function computeZeroAnchor(view) {
  const a = slots.left.lastLms;
  const b = slots.right.lastLms;
  if (!a || !b) return null;
  zeroAnchor.center.set(0, 0, 0);
  for (const i of [4, 8]) {
    zeroAnchor.center.add(toWorld(a[i], view)).add(toWorld(b[i], view));
  }
  zeroAnchor.center.multiplyScalar(0.25);
  const sizeA = toWorld(a[0], view).distanceTo(toWorld(a[9], view));
  const sizeB = toWorld(b[0], view).distanceTo(toWorld(b[9], view));
  zeroAnchor.size = 0.5 * (sizeA + sizeB);
  return zeroAnchor;
}

function frame(now) {
  requestAnimationFrame(frame);

  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  const t = now * 0.001;
  const view = computeView();

  if (mode !== 'raw') {
    const inputs = synthetic ? (synthetic.next(now) || []) : null;

    for (let i = 0; i < slotList.length; i++) {
      const slot = slotList[i];
      let input = null;
      if (synthetic) {
        input = inputs[i] || null;
      } else if (slot.latest && now - slot.latest.t < CONFIG.handLostMs) {
        input = slot.latest;
      }

      if (input) {
        slot.retarget.update(input.lms, view, input.label || null, mirrorOverride);
      }
      slot.retarget.setVisible(!!input);
      slot.lastLms = input ? input.lms : null;
      slot.gesture.update(dt, input ? input.lms : null, view);
      slot.fire.update(dt, view, input ? input.lms : null, forceFire);
      if (slot.flame) slot.flame.update(t, visualMode === MODE.flame ? slot.fire.intensity : 0, dt);
      // pairGesture.active is one frame behind here; the 0.15s debounce hides it
      slot.glow.update(t, visualMode === MODE.glow ? slot.fire.intensity : 0, dt,
        pairGesture.active ? 1 : 0);
    }
  } else {
    for (const slot of slotList) {
      slot.lastLms = null;
      slot.gesture.update(dt, null, view);
      slot.fire.update(dt, view, null, false);
      if (slot.flame) slot.flame.update(t, 0, dt);
      slot.glow.update(t, 0, dt, 0);
    }
  }

  pairGesture.update(dt, slots.left, slots.right, view);

  const anchor = computeZeroAnchor(view);
  zeroBurst.update(t, pairGesture.active, anchor ? anchor.center : null, anchor ? anchor.size : 0);

  fire.render(dt);

  // The bloom composer leaves its own target bound; come back to the canvas.
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(scene, camera);

  // Glow mode has no flame layer to bloom, and its glow must not spill onto
  // the silver glove.
  if (visualMode === MODE.flame) {
    camera.layers.set(FLAME_LAYER);
    bloomComposer.render(dt);
    camera.layers.enableAll();
    glowQuad.material.uniforms.tGlow.value = bloomPass.renderTargetsHorizontal[0].texture;
    renderer.setRenderTarget(null);
    renderer.render(glowScene, glowCamera);
  }

  if (now - lastStatusAt > 200) {
    lastStatusAt = now;
    if (mode === 'track') updateStatus(now);
    updateGesturePanel();
  }
}
requestAnimationFrame(frame);

window.__GLOVE = {
  slots, slotList, fire, pair: pairGesture, zeroBurst, mode, scene, camera, renderer,
  get visualMode() { return visualMode; },
  setMode: (m) => applyMode(m),
};
