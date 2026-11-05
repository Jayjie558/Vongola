// Headless check: feed the retargeter a synthetic hand built from the glove's
// own rest joints (rotated, scaled, plus a finger curl) and verify the fitted
// model lands where the landmarks say it should.
import * as THREE from 'three';
import { worldToLm, worldToPixel, pixelToWorld } from './coords.js';

export function createSelftest(retarget, setStatus, view) {
  const selftestParams = new URLSearchParams(location.search);
  const mirrorPath = selftestParams.has('mirror');
  const twoHands = selftestParams.has('two');
  const fistPath = selftestParams.has('fist');
  const sixPath = selftestParams.has('six');
  const gunPath = selftestParams.has('gun');
  const gunvPath = selftestParams.has('gunv');
  const zeroPath = selftestParams.has('zero');
  const bones = retarget.bones;
  const head = (name) => bones[name].getWorldPosition(new THREE.Vector3());
  const ahead = (name) => {
    const q = bones[name].getWorldQuaternion(new THREE.Quaternion());
    return new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  };

  const joints = new Array(21).fill(null);
  joints[0] = head('Palm');

  const chain = (prefix, first) => {
    const a = head(prefix + '_Proximal');
    const b = head(prefix + '_Middle');
    const c = head(prefix + '_Distal');
    const tip = c.clone().add(ahead(prefix + '_Distal').multiplyScalar(b.distanceTo(c) * 0.7));
    joints[first] = a;
    joints[first + 1] = b;
    joints[first + 2] = c;
    joints[first + 3] = tip;
  };
  chain('Index', 5);
  chain('Middle', 9);
  chain('Ring', 13);
  chain('Pinky', 17);

  const t0 = head('Thumb_Metacarpal');
  const t1 = head('Thumb_Proximal');
  const t2 = head('Thumb_Distal');
  joints[1] = t0;
  joints[2] = t1;
  joints[3] = t2;
  joints[4] = t2.clone().add(ahead('Thumb_Distal').multiplyScalar(t1.distanceTo(t2) * 0.7));

  // pose it like a hand held up to the webcam
  const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.10, 0.22, 0.0, 'YXZ'));
  const S = 2.2;
  const T = new THREE.Vector3(0.0, -0.06, 0.06);
  const place = (p) => p.clone().multiplyScalar(S).applyMatrix4(R).add(T);
  const world = joints.map(place);

  // bend the middle finger (and lightly the rest) so articulation shows up
  const sideW = world[17].clone().sub(world[5]).normalize();
  const curl = (a, pivot, angle) => {
    const radius = a.distanceTo(pivot);
    const d = a.clone().sub(pivot).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(sideW, angle);
    a.copy(pivot).add(d.applyQuaternion(q).multiplyScalar(radius));
  };
  // Fold every joint and all of its descendants so the fingertip actually
  // travels back toward the palm.
  const fold = (chain) => {
    for (let k = 0; k < 3; k++) {
      const pivot = world[chain[k]];
      const q = new THREE.Quaternion().setFromAxisAngle(sideW, -1.05);
      for (let j = k + 1; j < chain.length; j++) {
        const p = world[chain[j]];
        const d = p.clone().sub(pivot);
        const radius = d.length();
        p.copy(pivot).add(d.normalize().applyQuaternion(q).multiplyScalar(radius));
      }
    }
  };

  if (fistPath) {
    for (const chain of [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20], [1, 2, 3, 4]]) {
      fold(chain);
    }
  } else if (sixPath) {
    // thumb + pinky out, the three middle fingers folded
    for (const chain of [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]) fold(chain);
  } else if (gunPath) {
    // thumb + index out, the three other fingers folded
    for (const chain of [[9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) fold(chain);
  } else if (gunvPath) {
    // pistol with the middle finger added: thumb + index + middle out
    for (const chain of [[13, 14, 15, 16], [17, 18, 19, 20]]) fold(chain);
  } else {
    for (const [i0, i1] of [[10, 11], [11, 12], [6, 7], [7, 8], [14, 15], [15, 16], [18, 19], [19, 20]]) {
      curl(world[i1], world[i0], i0 === 10 || i0 === 11 ? -0.62 : -0.34);
    }
  }

  // ?mirror=1 feeds a physically right-handed pose (reflected across the palm
  // plane), which is what the retarget must mirror the left-hand model onto.
  if (mirrorPath) for (const p of world) p.z = -p.z;

  const lms = world.map((p) => worldToLm(p, view));

  // ?zero=1: two hands whose corresponding fingertips meet on the window's
  // vertical centerline, mirrored about it. Rotate the first hand so its
  // thumb-index segment is vertical (both tips share an x), park that x on the
  // centerline, then mirror the whole hand across it.
  let zeroHands = null;
  if (zeroPath) {
    const screen = world.map((p) => worldToPixel(p, view));
    const mid = {
      x: 0.5 * (screen[4].x + screen[8].x),
      y: 0.5 * (screen[4].y + screen[8].y),
    };
    const rotate = (ang) => screen.map((p) => {
      const dx = p.x - mid.x;
      const dy = p.y - mid.y;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      return { x: mid.x + dx * c - dy * s, y: mid.y + dx * s + dy * c, z: p.z };
    });
    // rotate the thumb-index segment onto the vertical (+y) axis
    const segAngle = Math.atan2(screen[8].y - screen[4].y, screen[8].x - screen[4].x);
    const ang = Math.PI / 2 - segAngle;
    let posed = rotate(ang);
    // the palm body should sit on the left of the centerline
    if (posed[9].x > mid.x) posed = rotate(ang + Math.PI);

    const axis = view.cw / 2;
    const shift = axis - mid.x;
    const leftScreen = posed.map((p) => ({ x: p.x + shift, y: p.y, z: p.z }));
    const rightScreen = leftScreen.map((p) => ({ x: 2 * axis - p.x, y: p.y, z: p.z }));
    const toLms = (p) => worldToLm(pixelToWorld(p, view), view);
    zeroHands = [
      { lms: leftScreen.map(toLms), label: mirrorPath ? 'Left' : 'Right' },
      { lms: rightScreen.map(toLms), label: mirrorPath ? 'Right' : 'Left' },
    ];
  }

  let frames = 0;
  let done = false;

  function report() {
    done = true;
    const err = retarget.lastError;
    // the pistol variant keeps the middle finger straight, so check a folded one
    const bendBone = gunvPath ? 'Ring_Distal' : 'Middle_Distal';
    const q = retarget.bones[bendBone].quaternion;
    const rest = retarget.rest[bendBone];
    const bend = 2 * Math.acos(Math.min(1, Math.abs(q.dot(rest))));
    const scaleOk = retarget.model.scale.x > 0.5 && retarget.model.scale.x < 15;
    const ok = Number.isFinite(err) && err < 0.02 && bend > 0.3 && scaleOk;

    const text = `SELFTEST ${ok ? 'PASS' : 'FAIL'} err=${err.toFixed(4)} bend=${bend.toFixed(3)} `
      + `scale=${retarget.model.scale.x.toFixed(2)} mirror=${retarget.mirror}`;
    document.title = text;
    window.__SELFTEST = { ok, err, bend, scale: retarget.model.scale.x, mirror: retarget.mirror };
    setStatus(text);
    console.log(text);
  }

  return {
    next() {
      frames++;
      if (frames === 90 && !done) report();
      // raw-camera MediaPipe label: a real left hand reads as 'Right'
      const list = [{ lms, label: mirrorPath ? 'Left' : 'Right' }];
      if (zeroHands) return zeroHands;
      if (twoHands) {
        // second synthetic hand sits to the side, opposite handedness
        list.push({
          lms: lms.map((lm) => ({ x: lm.x - 0.3, y: lm.y, z: lm.z })),
          label: mirrorPath ? 'Right' : 'Left',
        });
      }
      return list;
    },
  };
}
