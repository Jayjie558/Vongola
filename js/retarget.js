import * as THREE from 'three';
import { CONFIG } from './config.js';

// MediaPipe landmark chain -> glove bones.
const CHAINS = [
  { lm: [5, 6, 7, 8], bones: ['Index_Proximal', 'Index_Middle', 'Index_Distal'] },
  { lm: [9, 10, 11, 12], bones: ['Middle_Proximal', 'Middle_Middle', 'Middle_Distal'] },
  { lm: [13, 14, 15, 16], bones: ['Ring_Proximal', 'Ring_Middle', 'Ring_Distal'] },
  { lm: [17, 18, 19, 20], bones: ['Pinky_Proximal', 'Pinky_Middle', 'Pinky_Distal'] },
  { lm: [1, 2, 3, 4], bones: ['Thumb_Metacarpal', 'Thumb_Proximal', 'Thumb_Distal'] },
];

// The glove is a left-hand model: for a left hand its palm/back already line
// up with the observed landmarks; a right hand needs the model mirrored
// across the palm plane. MediaPipe's label assumes mirrored (selfie) input,
// so on our raw camera feed the label is the opposite of the real hand.
export function mirrorFromLabel(label) {
  if (!label) return null;
  const realRight = CONFIG.swapHandedness ? label === 'Left' : label === 'Right';
  return realRight;
}

function toWorld(lm, view) {
  const px = (1 - lm.x) * view.rw + view.ox;
  const py = lm.y * view.rh + view.oy;
  return new THREE.Vector3(
    (px - view.cw * 0.5) / view.ch,
    (view.ch * 0.5 - py) / view.ch,
    -lm.z * (view.rw / view.ch) * CONFIG.zGain,
  );
}

export class Retarget {
  constructor(model) {
    this.model = model;
    this.bones = {};
    this.rest = {};
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (o.isBone) {
        this.bones[o.name] = o;
        this.rest[o.name] = o.quaternion.clone();
      }
    });

    const at = (name) => this.bones[name].getWorldPosition(new THREE.Vector3());
    this.canon = {
      wrist: at('Palm'),
      index: at('Index_Proximal'),
      middle: at('Middle_Proximal'),
      ring: at('Ring_Proximal'),
      pinky: at('Pinky_Proximal'),
      thumb: at('Thumb_Metacarpal'),
    };
    this.canonWidth = this.canon.index.distanceTo(this.canon.pinky);
    this.canonPalm = this.canon.middle.distanceTo(this.canon.wrist);
    this.palmQuat = this.bones.Palm.getWorldQuaternion(new THREE.Quaternion());

    this.mirror = false;
    this.initialized = false;
    this.curPos = new THREE.Vector3();
    this.curQuat = new THREE.Quaternion();
    this.curScale = new THREE.Vector3(1, 1, 1);
    this.lastError = 0;
  }

  setVisible(on) {
    if (this.model) this.model.visible = on;
  }

  /**
   * @param {Array} lms 21 MediaPipe normalized landmarks
   * @param {object} view { cw, ch, rw, rh, ox, oy } of the covered video
   * @param {string|null} label 'Left' | 'Right' as reported by MediaPipe
   * @param {boolean|null} mirrorOverride force mirror on/off, null = auto
   */
  update(lms, view, label, mirrorOverride = null) {
    const W = lms.map((lm) => toWorld(lm, view));
    const wrist = W[0].clone();

    // palm frame: up = along the fingers, side = towards the pinky
    const up = W[9].clone().sub(wrist).add(W[13].clone().sub(wrist)).normalize();
    const side = W[17].clone().sub(W[5]);
    side.addScaledVector(up, -side.dot(up)).normalize();
    const back = new THREE.Vector3().crossVectors(side, up).normalize();

    let mirror;
    if (mirrorOverride === true || mirrorOverride === false) {
      mirror = mirrorOverride;
    } else {
      const byLabel = mirrorFromLabel(label);
      if (byLabel !== null) {
        mirror = byLabel;
      } else {
        // thumb sits on the palmar side of the palm plane
        const palmNormal = new THREE.Vector3().crossVectors(up, side);
        mirror = W[2].clone().sub(wrist).dot(palmNormal) < 0;
      }
    }

    const s = 0.5 * (W[5].distanceTo(W[17]) / this.canonWidth
                   + W[9].distanceTo(wrist) / this.canonPalm);
    const scale = Math.min(30, Math.max(0.2, s));

    const basis = new THREE.Matrix4().makeBasis(side, up, back);
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    const scaleVec = new THREE.Vector3(scale, scale, mirror ? -scale : scale);

    const place = new THREE.Matrix4().compose(new THREE.Vector3(), q, scaleVec);
    const anchor = this.canon.wrist.clone().applyMatrix4(place);
    const t = wrist.sub(anchor);

    if (!this.initialized || mirror !== this.mirror) {
      this.curQuat.copy(q);
      this.curPos.copy(t);
      this.curScale.copy(scaleVec);
      this.initialized = true;
    } else {
      const a = CONFIG.rootSmooth;
      this.curQuat.slerp(q, a);
      this.curPos.lerp(t, a);
      this.curScale.lerp(scaleVec, a);
    }
    this.mirror = mirror;

    this.model.position.copy(this.curPos);
    this.model.quaternion.copy(this.curQuat);
    this.model.scale.copy(this.curScale);

    // targets in model space (undo the root rotation, then the mirror)
    const invRoot = this.curQuat.clone().invert();
    for (const chain of CHAINS) {
      const dirs = [];
      for (let i = 0; i < 3; i++) {
        const d = new THREE.Vector3().subVectors(W[chain.lm[i + 1]], W[chain.lm[i]]);
        d.applyQuaternion(invRoot);
        if (mirror) d.z = -d.z;
        dirs.push(d.lengthSq() > 1e-14 ? d.normalize() : null);
      }

      // clone: parentQuat is mutated below and palmQuat must stay at rest
      let parentQuat = this.palmQuat.clone();
      for (let i = 0; i < 3; i++) {
        const name = chain.bones[i];
        const bone = this.bones[name];
        const base = parentQuat.clone().multiply(this.rest[name]);
        if (dirs[i]) {
          const curY = new THREE.Vector3(0, 1, 0).applyQuaternion(base);
          const swing = new THREE.Quaternion().setFromUnitVectors(curY, dirs[i]);
          const wantWorld = swing.multiply(base);
          const local = parentQuat.clone().invert().multiply(wantWorld);
          bone.quaternion.slerp(local, CONFIG.boneSmooth);
        }
        parentQuat.multiply(bone.quaternion);
      }
    }

    this.model.updateMatrixWorld(true);

    // how far the wrist ended up from where the landmarks say it should be
    this.lastError = this.canon.wrist.clone().applyMatrix4(this.model.matrixWorld)
      .distanceTo(W[0]);
  }
}
