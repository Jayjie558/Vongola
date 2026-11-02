// Procedural flame aura: a translucent energy sphere around the fist.
// The orange rim and the gradient interior are shader-only, so there is no
// modeled flame asset that can drift out of alignment with the hand.
import * as THREE from 'three';

const vertexShader = /* glsl */`
uniform float uTime;
uniform float uIntensity;
uniform vec3 uWind;
varying vec2 vUv;
varying vec3 vLocal;
varying vec3 vNormalV;
varying vec3 vViewDir;

void main() {
  vUv = uv;
  vec3 p = position;
  vLocal = position;
  float t = uTime;

  // whole-blob squash and lean, so the silhouette never settles
  p.x *= 1.0 + 0.12 * sin(t * 1.8 + 0.6);
  p.z *= 1.0 - 0.12 * sin(t * 1.8 + 0.6);
  p.y *= 1.0 + 0.13 * sin(t * 2.3 + 1.3);
  p.x += sin(t * 1.4 + 0.4) * 0.040 * p.y;
  p.z += cos(t * 1.2 + 1.7) * 0.040 * p.y;

  // anti-gravity: the crown rises while the bottom stays put
  float up = smoothstep(-0.2, 1.0, p.y);
  p.y *= 1.0 + 0.16 * up;
  p.xz *= 1.0 + 0.10 * up;

  // flame tips: angular lobes pull the crown into separate licking tongues
  float crown = smoothstep(0.30, 0.98, p.y);
  if (crown > 0.001) {
    float ang = atan(p.z, p.x);
    float lob = 0.5 + 0.32 * sin(ang * 5.0 + t * 1.2)
                    + 0.18 * sin(ang * 8.0 - t * 0.9);
    lob = lob * lob;
    p.y += crown * (0.06 + 0.34 * lob) * (0.5 + 0.5 * uIntensity);
    // fan the rising lobes outward so the crown spreads apart
    p.xz *= 1.0 + 0.25 * crown * lob;
    p.x += crown * 0.055 * sin(t * 1.7 + ang * 2.0) * (0.3 + 0.7 * lob);
    p.z += crown * 0.055 * cos(t * 1.9 + ang * 3.0) * (0.3 + 0.7 * lob);
  }

  // travelling surface waves at several scales
  float n1 = sin(p.x * 13.0 + t * 3.1) * sin(p.y * 10.0 - t * 2.3) * sin(p.z * 15.0 + t * 3.7);
  float n2 = sin(p.x * 25.0 - t * 4.3 + p.y * 9.0) * cos(p.z * 21.0 + t * 3.3);
  float n3 = sin(p.y * 30.0 + t * 5.1) * cos(p.x * 18.0 - t * 2.9);
  vec3 wave = normal * (n1 * 0.030 + n2 * 0.016 + n3 * 0.012) * (0.4 + 0.6 * uIntensity);
  p += wave;

  // hand-driven drag: stretch along the motion, squeeze across, trail behind
  float windAmt = length(uWind);
  if (windAmt > 1e-4) {
    vec3 wd = uWind / windAmt;
    float along = dot(p, wd);
    p += wd * along * 0.35 * windAmt;
    p -= (p - wd * along) * 0.15 * windAmt;
    p -= wd * 0.06 * windAmt;
  }

  // swells with the fist instead of popping in at full size
  p *= 0.86 + 0.14 * uIntensity;

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  // perturb the normal with the same waves so the rim ripples instead of
  // keeping a clean glassy outline
  vec3 ripple = vec3(n1 * 0.45, n2 * 0.45, n3 * 0.45);
  vNormalV = normalize(normalMatrix * normalize(normal + ripple));
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = /* glsl */`
uniform float uTime;
uniform float uIntensity;
uniform float uOpacity;
uniform float uInnerAlpha;
uniform float uRimAlpha;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
varying vec2 vUv;
varying vec3 vLocal;
varying vec3 vNormalV;
varying vec3 vViewDir;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y),
    mix(
      mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y),
    f.z
  );
}

void main() {
  float fres = 1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir)));
  float rim = pow(fres, 2.2);

  float n = noise(vec2(vUv.x * 6.0, vUv.y * 5.0 - uTime * 0.35));
  float h = vUv.y;

  // upward flow bands plus a faster swirl around the vertical axis
  float flow = 0.5 + 0.5 * sin(vLocal.y * 14.0 - uTime * 4.6
             + sin(vLocal.x * 9.0 + uTime * 1.9) * 1.8);
  float flow2 = 0.5 + 0.5 * sin(vLocal.y * 23.0 - uTime * 6.4
              + sin(vLocal.z * 12.0 - uTime * 2.4) * 1.4);
  float swirl = 0.5 + 0.5 * sin(atan(vLocal.z, vLocal.x) * 2.0 - uTime * 1.8);
  float mixFlow = flow * 0.75 + flow2 * 0.25;

  // interior gradient: gold core -> orange body -> red near the top/edges
  vec3 inner = mix(uCore, uMid, smoothstep(0.0, 0.9, h));
  inner = mix(inner, uEdge, smoothstep(0.7, 1.0, h) * 0.55);
  vec3 col = mix(inner, uEdge, rim * 0.75);
  col *= 0.70 + 0.55 * mixFlow;
  col = mix(col, uCore, mixFlow * 0.30);

  // internal fire: vertically stretched 3D noise scrolling upward, so the
  // inside reads as licking tongues instead of flat bands
  vec3 q = vec3(vLocal.x * 4.2, vLocal.y * 1.7 - uTime * 2.6, vLocal.z * 4.2);
  float warp = noise3(q * 1.6 + 3.1);
  float fire = noise3(q + warp * 0.8);
  fire = smoothstep(0.40, 0.78, fire);
  fire *= 0.45 + 0.55 * smoothstep(-1.0, 0.8, vLocal.y);
  fire *= 1.0 - rim * 0.55;
  col = mix(col, uCore, fire * 0.85);

  // the rim pulses with the flow so the outline is not a perfect ring
  rim *= 0.55 + 0.75 * mixFlow;
  float body = mix(uInnerAlpha, uRimAlpha, min(rim, 1.0));
  float alpha = body * (0.50 + 0.65 * mixFlow) * (0.82 + 0.18 * swirl) * (0.72 + 0.28 * n)
              * uOpacity * (0.15 + 0.85 * uIntensity);
  alpha += fire * 0.45 * uOpacity * (0.25 + 0.75 * uIntensity);

  // let the bottom melt away and the crown glow, so the aura floats upward
  alpha *= 0.55 + 0.45 * smoothstep(-1.0, 0.2, vLocal.y);
  alpha *= 0.85 + 0.30 * smoothstep(0.0, 1.0, vUv.y);
  gl_FragColor = vec4(col, alpha);
}
`;

// One aura sphere per hand, parented to the palm so it stays wrapped around the fist.
export class FlameRig {
  constructor(palmBone, scene) {
    this.palmBone = palmBone;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uOpacity: { value: 0.9 },
        uInnerAlpha: { value: 0.12 },
        uRimAlpha: { value: 0.85 },
        uCore: { value: new THREE.Color(1.0, 0.82, 0.34) },
        uMid: { value: new THREE.Color(1.0, 0.43, 0.06) },
        uEdge: { value: new THREE.Color(0.85, 0.10, 0.01) },
        uWind: { value: new THREE.Vector3() },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), this.material);
    this.baseY = 0.055;
    this.mesh.position.set(0, this.baseY, 0);
    this.mesh.scale.set(0.100, 0.125, 0.100);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(1); // flame-only layer, used by the bloom pass
    palmBone.add(this.mesh);

    this.light = new THREE.PointLight(0xff7a1a, 0, 0.45, 2);
    scene.add(this.light);

    this.worldPos = new THREE.Vector3();
    this.lastPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.velTarget = new THREE.Vector3();
    this.qWorld = new THREE.Quaternion();
    this.qInv = new THREE.Quaternion();
    this.wind = new THREE.Vector3();
    this.hasLast = false;
  }

  update(time, intensity, dt = 1 / 60) {
    const on = intensity > 0.02;
    this.mesh.visible = on;
    this.light.visible = on;
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uIntensity.value = intensity;

    // hover: drifts up as the flame ignites and bobs in place
    this.mesh.position.x = Math.sin(time * 0.55 + 1.2) * 0.006;
    this.mesh.position.y = this.baseY + 0.010 * intensity + Math.sin(time * 0.9) * 0.009;
    this.mesh.position.z = Math.cos(time * 0.7) * 0.005;

    // palm velocity in palm-local space drives the drag deformation
    this.palmBone.getWorldPosition(this.worldPos);
    const step = Math.max(dt, 1e-4);
    if (!this.hasLast) {
      this.lastPos.copy(this.worldPos);
      this.hasLast = true;
    } else {
      this.velTarget.subVectors(this.worldPos, this.lastPos).multiplyScalar(1 / step);
      this.vel.lerp(this.velTarget, 1 - Math.exp(-8 * dt));
      this.lastPos.copy(this.worldPos);
    }

    this.palmBone.getWorldQuaternion(this.qWorld);
    this.qInv.copy(this.qWorld).invert();
    this.wind.copy(this.vel).applyQuaternion(this.qInv);
    const speed = this.wind.length();
    const amt = Math.min(1, speed / 2.0);
    if (speed > 1e-5) this.wind.multiplyScalar(amt / speed);
    else this.wind.set(0, 0, 0);
    this.material.uniforms.uWind.value.copy(this.wind);

    if (on) {
      this.light.position.copy(this.worldPos);
      this.light.position.z += 0.12;
      this.light.intensity = intensity * 3.2;
    }
  }
}
