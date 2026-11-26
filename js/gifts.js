import * as THREE from 'three';
import { PLATFORM_TOP } from './platform.js';

const GOLD = new THREE.Color(0xffd08a);

/**
 * 圆台上的礼物。
 *
 * 之前是"稀疏外壳 + 棱边"的点盒子——远看是一团团雾，堆多了就糊成一片。
 * 现在改用开场那条**发光丝带**的画法：盒子只用线（十二条棱 + 顶上和侧面的
 * 十字丝带 + 蝴蝶结），每条线是一束连续的亮点（亮芯 + 外晕），
 * 于是每个盒子都是一圈会发光的轮廓线，堆满一台子也还看得清各自。
 *
 * 所有盒子烘进同一份几何体：一种材质、一次 draw call，
 * 想堆多少个都行。
 */

const rand = (min, max) => min + Math.random() * (max - min);

/** 礼物的配色：红、松绿、金、雪白、莓紫、暖橙 */
const COLORS = [0xe0503f, 0x2f9c6a, 0xffc46a, 0xdfeaf6, 0xa4549c, 0xff8a45];

/** 盒身 / 盒盖的半尺寸（烘进几何体，靠 gift 的 s 缩放） */
const BOX = { w: 0.42, h: 0.3, d: 0.42 };
const LID = { w: 0.47, h: 0.055, d: 0.47 };

function makeBuffers() {
  return { pos: [], col: [], size: [], phase: [], alpha: [] };
}

/** 一条"发光丝带"：沿途一串点，每颗再带一颗大而暗的外晕 */
function stroke(buf, from, to, color, { points = 16, core = 1.6, halo = 0.11, gain = 1 } = {}) {
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    const x = from[0] + (to[0] - from[0]) * t;
    const y = from[1] + (to[1] - from[1]) * t;
    const z = from[2] + (to[2] - from[2]) * t;
    const phase = Math.random() * Math.PI * 2;

    buf.pos.push(x, y, z);
    buf.col.push(color.r * gain, color.g * gain, color.b * gain);
    buf.size.push(core * rand(0.85, 1.2));
    buf.phase.push(phase);
    buf.alpha.push(1);

    buf.pos.push(x, y, z);
    buf.col.push(color.r * gain * halo, color.g * gain * halo, color.b * gain * halo);
    buf.size.push(core * 2.1);
    buf.phase.push(phase);
    buf.alpha.push(1);
  }
}

/** 盒面上撒一点很暗的点：纯线框会像玻璃盒，得有个"面"才像礼物 */
function fillFaces(buf, pt, bw, bh, bd, color) {
  const dim = color.clone().multiplyScalar(0.5);
  for (let i = 0; i < 16; i++) {
    for (const [lx, y, lz] of [
      [rand(-bw, bw), bh, rand(-bd, bd)],
      [rand(-bw, bw), 0, rand(-bd, bd)],
      [bw, rand(0, bh), rand(-bd, bd)],
      [-bw, rand(0, bh), rand(-bd, bd)],
      [rand(-bw, bw), rand(0, bh), bd],
      [rand(-bw, bw), rand(0, bh), -bd],
    ]) {
      const p = pt(lx, y, lz);
      buf.pos.push(p[0], p[1], p[2]);
      buf.col.push(dim.r, dim.g, dim.b);
      buf.size.push(rand(0.6, 1.0));
      buf.phase.push(Math.random() * Math.PI * 2);
      buf.alpha.push(0.16);
    }
  }
}

/** 一个盒子：十二条棱 + 十字丝带 + 盒盖 + 蝴蝶结，全部用丝带画 */
function addGift(buf, { x, z, yaw, s, color, lift = 0, tiltX = 0, tiltZ = 0 }) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const baseY = PLATFORM_TOP + lift;
  const cx = Math.cos(tiltX);
  const sx = Math.sin(tiltX);
  const cz = Math.cos(tiltZ);
  const sz = Math.sin(tiltZ);

  // 局部坐标：先绕 X、再绕 Z 轻微倾斜（像被随手扔上去的），最后绕 Y 转
  const pt = (lx, y, lz) => {
    const y1 = y * cx - lz * sx;
    const z1 = y * sx + lz * cx;
    const x1 = lx * cz - y1 * sz;
    const y2 = lx * sz + y1 * cz;
    const xr = x1 * cos - z1 * sin;
    const zr = x1 * sin + z1 * cos;
    return [x + xr * s, baseY + y2 * s, z + zr * s];
  };

  const edgeColor = color.clone().lerp(new THREE.Color(0xffffff), 0.06);
  const ribbonColor = GOLD.clone().lerp(color, 0.15);

  // 盒身
  const bw = BOX.w;
  const bh = BOX.h * 2;
  const bd = BOX.d;
  const corners = [
    [-bw, 0, -bd], [bw, 0, -bd], [bw, 0, bd], [-bw, 0, bd],
    [-bw, bh, -bd], [bw, bh, -bd], [bw, bh, bd], [-bw, bh, bd],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const [ai, bi] of edges) {
    stroke(buf, pt(...corners[ai]), pt(...corners[bi]), edgeColor, {
      points: 8,
      core: 1.35,
    });
  }
  fillFaces(buf, pt, bw, bh, bd, color);

  // 盒身上的十字丝带：前后左右各一条竖带 + 顶面十字
  const half = 0.062;
  for (const side of [-1, 1]) {
    stroke(buf, pt(-half, 0, side * bd), pt(-half, bh, side * bd), ribbonColor, { points: 5, core: 1.25 });
    stroke(buf, pt(half, 0, side * bd), pt(half, bh, side * bd), ribbonColor, { points: 5, core: 1.25 });
    stroke(buf, pt(side * bw, 0, -half), pt(side * bw, bh, -half), ribbonColor, { points: 5, core: 1.25 });
    stroke(buf, pt(side * bw, 0, half), pt(side * bw, bh, half), ribbonColor, { points: 5, core: 1.25 });
  }
  stroke(buf, pt(-half, bh, -bd), pt(-half, bh, bd), ribbonColor, { points: 5, core: 1.25 });
  stroke(buf, pt(-bw, bh, -half), pt(bw, bh, -half), ribbonColor, { points: 5, core: 1.25 });

  // 盒盖：一圈略宽的边 + 顶面十字
  const lw = LID.w;
  const lh = bh + LID.h * 2;
  const ld = LID.d;
  const lid = [
    [-lw, bh, -ld], [lw, bh, -ld], [lw, bh, ld], [-lw, bh, ld],
    [-lw, lh, -ld], [lw, lh, -ld], [lw, lh, ld], [-lw, lh, ld],
  ];
  const lidEdges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const [ai, bi] of lidEdges) {
    stroke(buf, pt(...lid[ai]), pt(...lid[bi]), edgeColor, { points: 6, core: 1.05 });
  }

  // 蝴蝶结：两个小环
  const bowY = lh + 0.03;
  for (const loop of [{ cx: -0.13, rot: 0.6 }, { cx: 0.13, rot: -0.6 }]) {
    const ring = [];
    for (let i = 0; i <= 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const lx = Math.cos(a) * 0.15;
      const ly = Math.sin(a) * 0.075;
      const c2 = Math.cos(loop.rot);
      const s2 = Math.sin(loop.rot);
      ring.push(pt(loop.cx + lx * c2 - ly * s2, bowY + lx * s2 + ly * c2, 0.02));
    }
    for (let i = 0; i < ring.length - 1; i++) {
      stroke(buf, ring[i], ring[i + 1], ribbonColor, { points: 2, core: 1.25 });
    }
  }
}

/**
 * 摆满一台子。
 *
 * 两层：里层大一点、外层小一点，都在台面半径之内；再随机叠几摞。
 * 数量按"铺满"给——盒子之间本来就会压着，挤在一起才像一堆礼物。
 */
function buildPile() {
  const buf = makeBuffers();
  const FILL = [
    { rMin: 1.75, rMax: 2.5, count: 16, sMin: 0.3, sMax: 0.46 },
    { rMin: 2.45, rMax: 3.3, count: 26, sMin: 0.5, sMax: 0.8 },
    { rMin: 3.2, rMax: 3.92, count: 28, sMin: 0.34, sMax: 0.56 },
  ];

  const placed = [];
  for (const band of FILL) {
    for (let i = 0; i < band.count; i++) {
      // 只留开正前方最中间那一小段：台面前沿正好压在底部文案上
      let a = rand(-Math.PI, Math.PI);
      if (a > 1.42 && a < 1.72) a += Math.PI;
      const r = rand(band.rMin, band.rMax);
      const s = rand(band.sMin, band.sMax);
      const color = new THREE.Color(COLORS[(Math.random() * COLORS.length) | 0]);
      const gift = {
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        yaw: rand(0, Math.PI),
        s,
        color,
        lift: 0,
        tiltX: rand(-0.1, 0.1),
        tiltZ: rand(-0.1, 0.1),
      };
      placed.push(gift);
      addGift(buf, gift);
    }
  }

  // 叠几摞：落在下层盒盖上方
  for (let i = 0; i < 6; i++) {
    const base = placed[(Math.random() * placed.length) | 0];
    addGift(buf, {
      x: base.x + rand(-0.04, 0.04),
      z: base.z + rand(-0.04, 0.04),
      yaw: rand(0, Math.PI),
      s: base.s * rand(0.55, 0.7),
      color: new THREE.Color(COLORS[(Math.random() * COLORS.length) | 0]),
      lift: (BOX.h * 2 + LID.h * 2) * base.s * 0.92,
    });
  }

  return buf;
}

export function createGifts() {
  const buf = buildPile();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(buf.col, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(buf.size, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(buf.phase, 1));
  geometry.setAttribute('aAlpha', new THREE.Float32BufferAttribute(buf.alpha, 1));
  geometry.computeBoundingSphere();

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uOpacity: { value: 0 },
    uGold: { value: GOLD.clone() },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uOpacity;

      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      attribute float aAlpha;

      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        // 极轻微的漂浮：这些东西是光凝成的，不是硬摆上去的
        p.y += sin(uTime * 0.7 + aPhase * 9.0) * 0.006;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        float twinkle = 0.72 + 0.28 * sin(uTime * (1.1 + aPhase) + aPhase * 5.0);

        vColor = aColor;
        vAlpha = uOpacity * aAlpha * (0.24 + 0.3 * twinkle);
        gl_PointSize = aSize * uPixelRatio * (30.0 / max(0.6, -mv.z)) * (0.85 + 0.3 * twinkle);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float falloff = smoothstep(0.5, 0.0, d);
        float alpha = falloff * vAlpha;
        if (alpha < 0.006) discard;
        gl_FragColor = vec4(vColor * (0.72 + falloff * 0.42), alpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 5;

  const group = new THREE.Group();
  group.add(points);

  return {
    group,
    setReveal(value) {
      uniforms.uOpacity.value = value;
    },
    update(time) {
      uniforms.uTime.value = time;
    },
    setPixelRatio(value) {
      uniforms.uPixelRatio.value = value;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
