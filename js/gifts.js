import * as THREE from 'three';
import { GROUND_Y } from './config.js';

const GOLD = new THREE.Color(0xffd08a);

/**
 * 树脚下堆的礼物。
 *
 * 和树上的挂饰是同一套做法：盒子由光点拼成——稀疏的外壳 + 更亮的棱边 +
 * 金色丝带 + 顶上的蝴蝶结——只在脚下多一层：盒子有大小、有朝向、互相压着，
 * 像随手堆的，而不是摆成一圈。
 */

const rand = (min, max) => min + Math.random() * (max - min);

/** 盒子外廓（半宽 / 半高 / 半深） */
const BOX = { w: 0.44, h: 0.33, d: 0.44 };
const LID = { w: 0.48, h: 0.06, d: 0.48 };

/** 脚下的礼物：角度 / 离树心多远 / 多大 / 转多少 / 什么颜色 */
// 树冠几乎垂到地面、底半径 3，半径小于 3 的盒子会被整片树针淹没；
// 正前方（角度接近 0）又正好压在底部那行文案上。
// 所以都摆在 3 米这一圈偏侧后方，从镜头看是"树脚下围了一圈"。
// 树冠几乎垂到地面、底半径 3，半径小于 3 的盒子会被整片树针淹没。
// 而 z 方向越靠近镜头，投影位置就越低——正前方那一片会掉到底部文案下面。
// 所以只摆在"两侧偏后"这一带（|sin a| 小、cos a 大），从镜头看正好
// 是在树脚两边各堆了几盒。
const GIFTS = [
  { a: 0.3, r: 3.05, s: 0.82, yaw: 0.24, c: 0 },
  { a: 0.62, r: 3.2, s: 0.67, yaw: 1.12, c: 1 },
  { a: -0.34, r: 3.0, s: 0.74, yaw: 2.3, c: 2 },
  { a: -0.66, r: 3.18, s: 0.61, yaw: 0.72, c: 3 },
  { a: 2.55, r: 3.0, s: 0.76, yaw: 1.75, c: 4 },
  { a: 2.86, r: 3.16, s: 0.62, yaw: 2.9, c: 5 },
  { a: -2.5, r: 3.02, s: 0.70, yaw: 0.45, c: 1 },
  { a: -2.82, r: 3.18, s: 0.56, yaw: 1.4, c: 2 },
];

/** 礼物的配色：红、松绿、金、雪白、莓紫、暖橙 */
const COLORS = [0xe0503f, 0x2f9c6a, 0xffc46a, 0xdfeaf6, 0xa4549c, 0xff8a45];

/** 一堆礼物用同一份几何体，各自只改缩放、朝向和颜色 */
function buildGiftGeometry() {
  const pos = [];
  const size = [];
  const tint = [];

  const push = (x, y, z, sz, t) => {
    pos.push(x, y, z);
    size.push(sz);
    tint.push(t);
  };

  /** 一个长方体：六面撒点 + 十二条棱 */
  function box(b, yBase, shellCount, edgePer, tShell, tEdge) {
    const { w, h, d } = b;
    const y0 = yBase;
    const y1 = yBase + h * 2;

    for (let i = 0; i < shellCount; i++) {
      push(rand(-w, w), rand(y0, y1), y1, rand(0.9, 1.5), tShell); // 顶
      push(rand(-w, w), y0, rand(-d, d), rand(0.9, 1.5), tShell); // 底
      push(w, rand(y0, y1), rand(-d, d), rand(0.9, 1.5), tShell);
      push(-w, rand(y0, y1), rand(-d, d), rand(0.9, 1.5), tShell);
      push(rand(-w, w), rand(y0, y1), d, rand(0.9, 1.5), tShell);
      push(rand(-w, w), rand(y0, y1), -d, rand(0.9, 1.5), tShell);
    }

    const corners = [
      [-w, y0, -d], [w, y0, -d], [w, y0, d], [-w, y0, d],
      [-w, y1, -d], [w, y1, -d], [w, y1, d], [-w, y1, d],
    ];
    const pairs = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (const [ai, bi] of pairs) {
      const a = corners[ai];
      const b2 = corners[bi];
      for (let i = 0; i < edgePer; i++) {
        const t = i / Math.max(1, edgePer - 1);
        push(
          a[0] + (b2[0] - a[0]) * t,
          a[1] + (b2[1] - a[1]) * t,
          a[2] + (b2[2] - a[2]) * t,
          rand(1.3, 2.2),
          tEdge
        );
      }
    }
  }

  /** 盒身上的十字丝带 */
  function ribbon(b, yBase, count) {
    const { w, h, d } = b;
    const half = 0.07;
    const y0 = yBase;
    const y1 = yBase + h * 2;
    for (let i = 0; i < count; i++) {
      push(rand(-half, half), rand(y0, y1), d + 0.004, rand(1.2, 2.0), 1);
      push(rand(-half, half), rand(y0, y1), -d - 0.004, rand(1.2, 2.0), 1);
      push(w + 0.004, rand(y0, y1), rand(-half, half), rand(1.2, 2.0), 1);
      push(-w - 0.004, rand(y0, y1), rand(-half, half), rand(1.2, 2.0), 1);
      push(rand(-half, half), y1 + 0.004, rand(-d, d), rand(1.2, 2.0), 1);
      push(rand(-w, w), y1 + 0.004, rand(-half, half), rand(1.2, 2.0), 1);
    }
  }

  // 盒身 → 盒盖 → 蝴蝶结，从地面往上摞
  box(BOX, 0, 70, 11, 0, 0);
  ribbon(BOX, 0, 14);

  const lidBase = BOX.h * 2;
  box(LID, lidBase, 26, 7, 0, 2);
  ribbon(LID, lidBase, 7);

  const bowY = lidBase + LID.h * 2 + 0.02;
  for (const loop of [{ cx: -0.13, rot: 0.6 }, { cx: 0.13, rot: -0.6 }]) {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const x = Math.cos(a) * 0.15;
      const y = Math.sin(a) * 0.085;
      const c = Math.cos(loop.rot);
      const s = Math.sin(loop.rot);
      push(loop.cx + x * c - y * s, bowY + x * s + y * c, Math.sin(a * 2) * 0.02, rand(1.3, 2.1), 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  const phases = new Float32Array(size.length);
  for (let i = 0; i < phases.length; i++) phases[i] = Math.random();
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  return geometry;
}

function makeMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uOpacity: { value: 0 },
      uColor: { value: color.clone() },
      uGold: { value: GOLD.clone() },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uOpacity;
      uniform vec3 uColor;
      uniform vec3 uGold;

      attribute float aSize;
      attribute float aPhase;
      attribute float aTint;

      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        // 一点点漂动：盒子像由光凝成的，不是硬邦邦摆在那
        p += vec3(
          sin(uTime * 0.8 + aPhase * 11.0),
          cos(uTime * 0.6 + aPhase * 9.0),
          sin(uTime * 0.7 + aPhase * 13.0)
        ) * 0.008;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        float twinkle = 0.55 + 0.45 * sin(uTime * (1.2 + aPhase * 1.4) + aPhase * 6.0);

        vec3 color = uColor;
        if (aTint > 0.5) color = uGold;
        if (aTint > 1.5) color = mix(uGold, uColor, 0.55);

        vColor = color;
        vAlpha = uOpacity * (0.2 + 0.3 * twinkle) * (aTint > 1.5 ? 0.95 : 1.0);
        gl_PointSize = aSize * uPixelRatio * (30.0 / max(0.6, -mv.z)) * (0.8 + 0.35 * twinkle);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float falloff = smoothstep(0.5, 0.0, d);
        float alpha = falloff * vAlpha;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(vColor * (0.8 + falloff * 0.45), alpha);
      }
    `,
  });
}

export function createGifts() {
  const group = new THREE.Group();
  const geometry = buildGiftGeometry();
  const materials = [];
  const items = [];

  for (let i = 0; i < GIFTS.length; i++) {
    const spec = GIFTS[i];
    const color = new THREE.Color(COLORS[spec.c % COLORS.length]);
    const material = makeMaterial(color);
    materials.push(material);

    const points = new THREE.Points(geometry, material);
    points.renderOrder = 4;
    points.frustumCulled = false;

    const x = Math.cos(spec.a) * spec.r;
    const z = Math.sin(spec.a) * spec.r;
    points.position.set(x, GROUND_Y - 0.01, z);
    points.rotation.y = spec.yaw;
    // 高矮胖瘦也变一变，不然十个盒子一个模子
    points.scale.set(spec.s * rand(0.9, 1.1), spec.s * rand(0.85, 1.15), spec.s * rand(0.9, 1.1));

    group.add(points);
    items.push(points);
  }

  return {
    group,

    /** 跟着树上的挂饰一起亮起来 */
    setReveal(value) {
      for (const m of materials) m.uniforms.uOpacity.value = value;
    },

    update(time) {
      for (const m of materials) m.uniforms.uTime.value = time;
    },

    setPixelRatio(value) {
      for (const m of materials) m.uniforms.uPixelRatio.value = value;
    },

    dispose() {
      geometry.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
