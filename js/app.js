import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CONFIG } from './config.js';
import { computeView } from './coords.js';
import { HandRig } from './hands.js';
import { createUI } from './ui.js';
import { ZeroBurst } from './zero-burst.js';
import { startTracking } from './hand-tracker.js';
import { FireSystem } from './fire.js';

const video = document.getElementById('webcam');
const canvas = document.getElementById('gl-canvas');
const fireCanvas = document.getElementById('fire-canvas');
const statusEl = document.getElementById('status');

const params = new URLSearchParams(location.search);
const MODE = { glow: 'glow', flame: 'flame' };
function initialMode() {
  const v = (params.get('mode') || CONFIG.defaultMode).toLowerCase();
  return v === 'flame' || v === 'fire' || v === '2' ? MODE.flame : MODE.glow;
}
let visualMode = initialMode();
// Each visual mode is just a weight per effect; the effect modules never see
// the mode name itself.
function modeChannels(mode) {
  return mode === MODE.glow ? { flame: 0, glow: 1 } : { flame: 1, glow: 0 };
}
let channels = modeChannels(visualMode);

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

const hands = new HandRig({ gltf, scene, fire });
const slots = hands.slots;
const slotList = hands.slotList;
const pairGesture = hands.pair;

// Procedural flame aura sphere around each fist.
fire.use3dBody = true;

const forceFire = params.has('fire');
let synthetic = null;
let mode = 'track';

function applyMode(next, updateUrl = false) {
  visualMode = next;
  channels = modeChannels(next);
  fire.glowOnly = next === MODE.glow;
  ui.syncMode(next);
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

const ui = createUI({
  slots,
  slotList,
  pairGesture,
  params,
  getMode: () => visualMode,
  onModeChange: (next) => applyMode(next, true),
  onFlip: () => hands.toggleMirror(),
});
applyMode(visualMode);

function onResults(results) {
  hands.claim(results);
}

if (params.has('raw')) {
  mode = 'raw';
  slots.left.model.scale.setScalar(2.0);
  slots.left.model.position.set(0, -0.2, 0);
  slots.left.retarget.setVisible(true);
  setStatus('RAW 绑定姿态');
} else if (params.has('selftest')) {
  mode = 'selftest';
  const mod = await import('./selftest.js');
  synthetic = mod.createSelftest(slots.left.retarget, setStatus, computeView(video));
} else {
  try {
    await startTracking({ video, onResults });
    setStatus('请把手放进画面');
  } catch (err) {
    console.error(err);
    setStatus('摄像头/识别启动失败：' + err.message);
  }
}

let lastFrame = performance.now();
let lastStatusAt = 0;

function frame(now) {
  requestAnimationFrame(frame);

  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  const t = now * 0.001;
  const view = computeView(video);

  const inputs = synthetic ? (synthetic.next(now) || []) : null;
  hands.update(dt, view, {
    time: t,
    inputs,
    enabled: mode !== 'raw',
    forceFire,
    channels,
  });

  const anchor = hands.getZeroAnchor(view);
  zeroBurst.update(t, hands.pair.active, anchor ? anchor.center : null, anchor ? anchor.size : 0);

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
    if (mode === 'track') ui.updateStatus(now);
    ui.updateGesturePanel();
  }
}
requestAnimationFrame(frame);

window.__GLOVE = {
  slots, slotList, fire, pair: pairGesture, zeroBurst, mode, scene, camera, renderer,
  get visualMode() { return visualMode; },
  setMode: (m) => applyMode(m),
};
