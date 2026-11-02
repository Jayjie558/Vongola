// Headless check: feed the retargeter a synthetic hand built from the glove's
// own rest joints (rotated, scaled, plus a finger curl) and verify the fitted
// model lands where the landmarks say it should.
import * as THREE from 'three';
import { CONFIG } from './config.js';

export function createSelftest(retarget, setStatus, view) {
  const selftestParams = new URLSearchParams(location.search);
  const mirrorPath = selftestParams.has('mirror');
  const twoHands = selftestParams.has('two');
  const fistPath = selftestParams.has('fist');
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
  if (fistPath) {
    // Fold every joint and all of its descendants so the fingertips actually
    // travel back toward the palm.
    const chains = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20], [1, 2, 3, 4]];
    for (const chain of chains) {
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
    }
  } else {
    for (const [i0, i1] of [[10, 11], [11, 12], [6, 7], [7, 8], [14, 15], [15, 16], [18, 19], [19, 20]]) {
      curl(world[i1], world[i0], i0 === 10 || i0 === 11 ? -0.62 : -0.34);
    }
  }

  // ?mirror=1 feeds a physically right-handed pose (reflected across the palm
  // plane), which is what the retarget must mirror the left-hand model onto.
  if (mirrorPath) for (const p of world) p.z = -p.z;

  const lms = world.map((p) => {
    const px = p.x * view.ch + view.cw / 2;
    const py = view.ch / 2 - p.y * view.ch;
    return {
      x: 1 - (px - view.ox) / view.rw,
      y: (py - view.oy) / view.rh,
      z: -p.z * view.ch / (view.rw * CONFIG.zGain),
    };
  });

  let frames = 0;
  let done = false;

  function report() {
    done = true;
    const err = retarget.lastError;
    const q = retarget.bones.Middle_Distal.quaternion;
    const rest = retarget.rest.Middle_Distal;
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
