// Both tracked hands and everything that follows them: the glove models, the
// per-hand effects, the gesture state and the cross-hand 零点突破 state.
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from './config.js';
import { Retarget, mirrorFromLabel } from './retarget.js';
import { GloveGlow } from './glove-glow.js';
import { FlameRig } from './flame3d.js';
import { HandGesture, PairGesture } from './gesture.js';
import { lmToWorld } from './coords.js';

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

function makeSlot(name, model, fire) {
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

export class HandRig {
  constructor({ gltf, scene, fire }) {
    // cloneSkeleton shares materials between the two hands; GloveGlow clones
    // them again per hand so each side can glow independently.
    const left = gltf.scene;
    const right = cloneSkeleton(left);
    prepareModel(left);
    prepareModel(right);
    scene.add(left);
    scene.add(right);

    this.slots = {
      left: makeSlot('left', left, fire),
      right: makeSlot('right', right, fire),
    };
    this.slotList = [this.slots.left, this.slots.right];
    this.pair = new PairGesture();
    this.mirrorOverride = null;
    this._anchor = { center: new THREE.Vector3(), size: 0 };

    for (const slot of this.slotList) {
      slot.flame = new FlameRig(slot.retarget.bones.Palm, scene);
    }
  }

  toggleMirror() {
    const current = this.mirrorOverride !== null
      ? this.mirrorOverride
      : (this.slots.left.retarget.mirror || this.slots.right.retarget.mirror);
    this.mirrorOverride = !current;
  }

  // MediaPipe results -> the two hand slots. Keyed by real left/right, not by
  // the order MediaPipe happens to return the hands in.
  claim(results) {
    const lmsList = results.multiHandLandmarks || [];
    const handedness = results.multiHandedness || [];
    const t = performance.now();
    const claimed = new Set();

    for (let i = 0; i < lmsList.length; i++) {
      const label = handedness[i] ? handedness[i].label : null;
      const realRight = mirrorFromLabel(label);
      let slot = realRight === true ? this.slots.right : realRight === false ? this.slots.left : null;
      if (!slot || claimed.has(slot)) {
        // Missing or duplicate handedness: hand this detection to a free slot.
        slot = this.slotList.find((s) => !claimed.has(s)) || null;
      }
      if (!slot) continue;
      claimed.add(slot);
      slot.latest = { lms: lmsList[i], label, t, score: handedness[i]?.score ?? null };
    }
  }

  /**
   * @param {number} dt seconds since the last frame
   * @param {object} view covered-video rect from coords.computeView
   * @param {object} opts
   *   time       seconds, for shader animation
   *   inputs     synthetic landmark lists (selftest), or null for live/raw
   *   enabled    false in raw mode: hands keep their last pose and effects idle
   *   forceFire  debug flag (?fire=1)
   *   channels   { flame: 0|1, glow: 0|1 } weights for the two visual modes
   */
  update(dt, view, { time, inputs, enabled, forceFire, channels }) {
    for (let i = 0; i < this.slotList.length; i++) {
      const slot = this.slotList[i];
      let input = null;

      if (enabled) {
        if (inputs) {
          input = inputs[i] || null;
        } else if (slot.latest && performance.now() - slot.latest.t < CONFIG.handLostMs) {
          input = slot.latest;
        }
        if (input) {
          slot.retarget.update(input.lms, view, input.label || null, this.mirrorOverride);
        }
        slot.retarget.setVisible(!!input);
      }

      slot.lastLms = input ? input.lms : null;
      slot.lastInput = input;
      slot.gesture.update(dt, input ? input.lms : null, view);
      slot.fire.update(dt, view, input ? input.lms : null, {
        ignited: enabled && slot.gesture.label === 'fist',
        force: enabled && forceFire,
      });

      const intensity = enabled ? slot.fire.intensity : 0;
      if (slot.flame) slot.flame.update(time, intensity * channels.flame, dt);
      // pair.active is from the previous frame; the gesture debounce hides it
      slot.glow.update(time, intensity * channels.glow, dt, this.pair.active ? 1 : 0);
    }

    this.pair.update(dt, this.slots.left, this.slots.right, view);
  }

  // Where the two hands' thumb/index tips meet, in scene units, plus the hand's
  // wrist-to-knuckle length so the energy can scale with the hands.
  getZeroAnchor(view) {
    const a = this.slots.left.lastLms;
    const b = this.slots.right.lastLms;
    if (!a || !b) return null;

    const anchor = this._anchor;
    anchor.center.set(0, 0, 0);
    for (const i of [4, 8]) {
      anchor.center.add(lmToWorld(a[i], view)).add(lmToWorld(b[i], view));
    }
    anchor.center.multiplyScalar(0.25);
    const sizeA = lmToWorld(a[0], view).distanceTo(lmToWorld(a[9], view));
    const sizeB = lmToWorld(b[0], view).distanceTo(lmToWorld(b[9], view));
    anchor.size = 0.5 * (sizeA + sizeB);
    return anchor;
  }
}
