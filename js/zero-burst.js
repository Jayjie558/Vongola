// 零点突破 energy: an orange gas mass gathers on the contact axis, then bursts
// outward once per second, in step with the glove glow's blink peak.
import * as THREE from 'three';

const PARTICLE_COUNT = 110;

const ORB_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ORB_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uCore;
  uniform vec3 uMid;
  uniform vec3 uEdge;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;
    float a = pow(1.0 - smoothstep(0.0, 1.0, d), 1.4);
    float ang = atan(p.y, p.x);
    float swirl = 0.82 + 0.18 * sin(ang * 4.0 + uTime * 5.0 - d * 7.0);
    a *= swirl;
    a = clamp(a * uOpacity, 0.0, 1.0);
    vec3 col = mix(uEdge, uMid, smoothstep(1.0, 0.5, d));
    col = mix(col, uCore, smoothstep(0.55, 0.0, d));
    gl_FragColor = vec4(col, a);
  }
`;

const RING_FRAG = /* glsl */`
  uniform float uRad;
  uniform float uWidth;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vUv;

  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float band = smoothstep(uRad + uWidth, uRad, d)
               * smoothstep(uRad - uWidth, uRad, d);
    gl_FragColor = vec4(uColor, band * uOpacity);
  }
`;

const P_VERT = /* glsl */`
  attribute vec2 aDir;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aPhase;
  uniform float uPix;
  uniform float uRadius;
  uniform float uTwist;
  varying float vGlow;

  void main() {
    float c = cos(uTwist);
    float s = sin(uTwist);
    vec2 dir = vec2(aDir.x * c - aDir.y * s, aDir.x * s + aDir.y * c);
    vec3 pos = vec3(dir * uRadius * (0.72 + 0.5 * aSpeed), 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * uPix * (0.55 + 0.85 * aSpeed);
    vGlow = 0.5 + 0.5 * sin(aPhase * 3.1 + uTwist * 1.7);
  }
`;

const P_FRAG = /* glsl */`
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uAlpha;
  varying float vGlow;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    a *= a;
    vec3 col = mix(uColorB, uColorA, vGlow);
    gl_FragColor = vec4(col, a * uAlpha);
  }
`;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOutCubic = (v) => 1 - Math.pow(1 - v, 3);

export class ZeroBurst {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.orbMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uCore: { value: new THREE.Color(0xfff1c0) },
        uMid: { value: new THREE.Color(0xffab3d) },
        uEdge: { value: new THREE.Color(0xff4a10) },
      },
      vertexShader: ORB_VERT,
      fragmentShader: ORB_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    this.orb = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.orbMat);
    this.orb.frustumCulled = false;
    this.group.add(this.orb);

    this.ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uRad: { value: 0.5 },
        uWidth: { value: 0.12 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(0xffa028) },
      },
      vertexShader: ORB_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.ringMat);
    this.ring.frustumCulled = false;
    this.group.add(this.ring);

    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const dir = new Float32Array(PARTICLE_COUNT * 2);
    const speed = new Float32Array(PARTICLE_COUNT);
    const size = new Float32Array(PARTICLE_COUNT);
    const phase = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      dir[i * 2] = Math.cos(a);
      dir[i * 2 + 1] = Math.sin(a);
      speed[i] = 0.45 + Math.random() * 0.85;
      size[i] = 6 + Math.random() * 13;
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 2));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.particleMat = new THREE.ShaderMaterial({
      uniforms: {
        uPix: { value: 1 },
        uRadius: { value: 0 },
        uTwist: { value: 0 },
        uAlpha: { value: 0 },
        uColorA: { value: new THREE.Color(0xffd27a) },
        uColorB: { value: new THREE.Color(0xff5a14) },
      },
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.Points(geo, this.particleMat);
    this.particles.frustumCulled = false;
    this.group.add(this.particles);

    this.center = new THREE.Vector3();
    this.radius = 0.08;
    this.phase = 0;
    this.cond = 0;
    this.burst = 0;
  }

  setPixelRatio(dpr) {
    this.particleMat.uniforms.uPix.value = dpr;
  }

  update(t, active, center, handSize) {
    const period = 1;
    const p = t - Math.floor(t);
    this.phase = p;

    if (!active || !center) {
      this.group.visible = false;
      this.cond = 0;
      this.burst = 0;
      return;
    }

    this.group.visible = true;
    this.center.copy(center);
    this.group.position.copy(center);
    this.radius = Math.max(0.010, handSize * 0.75);

    const R = this.radius;
    const u = this.orbMat.uniforms;
    const ru = this.ringMat.uniforms;
    const pu = this.particleMat.uniforms;
    const BURST_END = 0.4;
    const COND_START = 0.46;

    u.uTime.value = t;

    if (p < BURST_END) {
      // shockwave flash already fired at the glow blink peak (p = 0)
      const q = clamp01(p / BURST_END);
      const e = easeOutCubic(q);
      const fade = Math.pow(1 - q, 1.4);
      this.burst = fade;
      this.cond = 0;

      const orbScale = R * (1.9 + 1.2 * e);
      this.orb.scale.set(orbScale, orbScale, 1);
      u.uOpacity.value = fade * 1.25;

      const ringScale = R * (2.2 + 4.4 * e);
      this.ring.scale.set(ringScale, ringScale, 1);
      ru.uRad.value = 0.86;
      ru.uWidth.value = 0.16 - 0.1 * q;
      ru.uOpacity.value = fade * 0.9;

      pu.uRadius.value = R * (0.35 + 2.9 * e);
      pu.uTwist.value = 0.9 * e;
      pu.uAlpha.value = fade * 0.95;
      this.particles.visible = true;
    } else if (p > COND_START) {
      // gather: spiralling particles collapse onto the axis, the orb condenses
      const c = clamp01((p - COND_START) / (1 - COND_START));
      const ce = c * c;
      this.cond = ce;
      this.burst = 0;

      const orbScale = R * (0.5 + 2.0 * ce);
      this.orb.scale.set(orbScale, orbScale, 1);
      u.uOpacity.value = ce * 1.05;

      this.ring.scale.setScalar(R * 0.2);
      ru.uOpacity.value = 0;

      pu.uRadius.value = R * (2.5 - 2.2 * ce);
      pu.uTwist.value = 1.8 * (1 - ce);
      pu.uAlpha.value = ce * 0.95;
      this.particles.visible = true;
    } else {
      this.cond = 0;
      this.burst = 0;
      this.orb.scale.setScalar(R * 0.2);
      u.uOpacity.value = 0;
      ru.uOpacity.value = 0;
      pu.uAlpha.value = 0;
      this.particles.visible = false;
    }
  }
}
