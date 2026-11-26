import * as THREE from 'three';
import { PLATFORM_TOP } from './platform.js';

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

/**
 * 摆一堆。
 *
 * 均匀撒成一圈会像栅栏——真实的一堆礼物是**几摊**挤在一起、有大有小、
 * 还会叠。所以先定几个"堆心"，再围着它们撒，外层再补几个散落的。
 * 半径控制在台面内（台子 4.4），正前方最中间那段留空，不然会压到底部文案。
 */
const CLUSTERS = [
  { a: -0.55, r: 3.15, n: 5 },
  { a: 0.62, r: 3.4, n: 4 },
  { a: 1.45, r: 3.05, n: 4 },
  { a: -1.62, r: 3.3, n: 5 },
  { a: 2.35, r: 3.2, n: 4 },
  { a: -2.5, r: 3.5, n: 3 },
];

function buildPile() {
  const out = [];

  for (const cluster of CLUSTERS) {
    for (let i = 0; i < cluster.n; i++) {
      const a = cluster.a + rand(-0.26, 0.26);
      if (a > 1.0 && a < 2.0) continue; // 正前方最中间：会压到底部文案
      out.push({
        a,
        r: cluster.r + rand(-0.42, 0.42),
        s: rand(0.42, 0.86),
        yaw: rand(0, Math.PI),
        c: Math.floor(Math.random() * COLORS.length),
        y: 0,
      });
    }
  }

  // 几摞：在下层盒盖上方再放一个小盒子，堆才"立"得起来
  for (const base of out.slice(0, 4)) {
    out.push({
      a: base.a + rand(-0.05, 0.05),
      r: base.r + rand(-0.05, 0.05),
      s: base.s * rand(0.55, 0.7),
      yaw: rand(0, Math.PI),
      c: Math.floor(Math.random() * COLORS.length),
      y: base.s * 0.74,
    });
  }

  // 外围再撒几个小的，边缘不至于空
  for (let i = 0; i < 6; i++) {
    const a = rand(-Math.PI, Math.PI);
    if (a > 1.0 && a < 2.0) continue;
    out.push({
      a,
      r: rand(3.6, 4.05),
      s: rand(0.3, 0.48),
      yaw: rand(0, Math.PI),
      c: Math.floor(Math.random() * COLORS.length),
      y: 0,
    });
  }

  return out;
}

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
  // 在函数里展开：COLORS 是下面才定义的 const，模块顶层调用会撞上暂时性死区
  const GIFTS = buildPile();
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
    points.position.set(x, PLATFORM_TOP - 0.02 + spec.y, z);
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
