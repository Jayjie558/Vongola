// Fist-driven glow on the glove itself: mode 1 renders no fire, it only adds
// a warm rim light to the glove's materials. The base PBR color is untouched,
// so the silver/black leather does not turn orange.
import * as THREE from 'three';
import { CONFIG } from './config.js';

// How strongly each material picks up the rim glow.
const WEIGHTS = {
  Glove_GemCrest: 2.0,
  Glove_FingerCore: 1.6,
  Glove_Groove: 1.4,
  Glove_Seam: 1.2,
  Glove_Band: 1.0,
  Glove_Leather: 0.9,
  Glove_Silver: 1.0,
  Glove_SilverBright: 1.05,
};

const UNIFORM_DECL = /* glsl */`
uniform float uGlowLevel;
uniform vec3 uGlowColor;
uniform float uGlowPower;
`;

const RIM_GLSL = /* glsl */`
#include <emissivemap_fragment>
float rimGlow = 1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
totalEmissiveRadiance += uGlowColor * pow(rimGlow, uGlowPower) * uGlowLevel;
`;

export class GloveGlow {
  constructor(model) {
    this.materials = [];
    this.shaders = [];
    this.color = new THREE.Color(CONFIG.gloveGlowColor);
    this.current = 0;
    this.zeroLevel = 0;

    // cloneSkeleton shares materials between the two hands, so each hand needs
    // its own copy before either can glow independently.
    const clones = new Map();
    model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const source = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = source.map((m) => {
        let c = clones.get(m);
        if (!c) {
          c = m.clone();
          clones.set(m, c);
          this.materials.push(c);
          this._installRim(c, WEIGHTS[c.name] ?? 0.9);
        }
        return c;
      });
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
    });
  }

  _installRim(material, weight) {
    if (!material.isMeshStandardMaterial) return;
    material.emissive.setHex(0x000000);
    material.emissiveIntensity = 1;

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uGlowLevel = { value: 0 };
      shader.uniforms.uGlowColor = { value: this.color };
      shader.uniforms.uGlowPower = { value: CONFIG.gloveGlowPower };
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', UNIFORM_DECL + 'void main() {')
        .replace('#include <emissivemap_fragment>', RIM_GLSL);
      // A material can compile more than one program variant; keep each
      // variant's uniforms in sync but do not register the same one twice.
      if (!this.shaders.some((s) => s.shader === shader)) {
        this.shaders.push({ shader, weight });
      }
    };
  }

  _setLevel(level, zero = 0) {
    // A lower fresnel power spreads the zero-breakthrough glow inward instead
    // of leaving it as a thin line on the silhouette.
    const power = CONFIG.gloveGlowPower
      + (CONFIG.gloveGlowZeroPower - CONFIG.gloveGlowPower) * zero;
    for (const s of this.shaders) {
      s.shader.uniforms.uGlowLevel.value = level * s.weight;
      s.shader.uniforms.uGlowPower.value = power;
    }
  }

  reset() {
    this.current = 0;
    this.zeroLevel = 0;
    this._setLevel(0);
  }

  update(time, intensity, dt, zero = 0) {
    const target = intensity > 0.02 ? Math.min(1, intensity) : 0;
    this.current += (target - this.current) * (1 - Math.exp(-10 * dt));
    this.zeroLevel += (zero - this.zeroLevel) * (1 - Math.exp(-12 * dt));

    // slow breathing plus a faster flicker, so it reads as live energy
    const pulse = 1 + CONFIG.gloveGlowPulse
      * (0.65 * Math.sin(time * 5.1) + 0.35 * Math.sin(time * 11.7));
    let level = this.current * CONFIG.gloveGlowStrength * pulse;

    if (this.zeroLevel > 0.001) {
      const blink = 0.5 + 0.5 * Math.cos(time * Math.PI * 2 * CONFIG.gloveGlowZeroBlinkHz);
      level += this.zeroLevel * CONFIG.gloveGlowZeroStrength * blink;
    }
    this._setLevel(level, Math.min(1, this.zeroLevel));
  }
}
