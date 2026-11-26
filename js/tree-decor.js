import * as THREE from 'three';
import { PALETTE, TREE } from './config.js';

const TAU = Math.PI * 2;

/**
 * 树上的装饰层：主灯串之外的两样东西。
 *
 * 树本身只有一色渐变的话，远看就是一个绿块；加两条反方向的灯串、
 * 再撒一层会闪的亮点，树的表面才有"织在一起"的层次。
 */

/**
 * 金丝花环（tinsel）：和树里那条 26 圈的紧灯串反着来，只绕 4.5 圈。
 * 两股疏密完全不同的螺旋交叉起来，树的表面才有一层"网"——
 * 一条紧、一条松，比两条同样密度的灯串有层次得多。
 */
function buildTinsel(count) {
  const pos = new Float32Array(count * 3);
  const height = new Float32Array(count);
  const phase = new Float32Array(count);
  const size = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const t = Math.pow(i / count, 0.9);
    const angle = Math.PI * 0.6 - t * 4.5 * TAU;
    const radius = TREE.baseRadius * Math.pow(1 - t, 0.94) * 1.07;
    // 花环是挂着的，不是贴着的：给一个自身的下垂起伏
    const sag = Math.sin(i * 0.22) * 0.035;

    pos[i * 3] = Math.cos(angle) * radius;
    pos[i * 3 + 1] = TREE.baseY + t * TREE.height + sag;
    pos[i * 3 + 2] = Math.sin(angle) * radius;

    height[i] = t;
    phase[i] = Math.random() * TAU;
    size[i] = 1.4 + Math.random() * 1.3;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aHeight', new THREE.BufferAttribute(height, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.computeBoundingSphere();
  return g;
}

/** 枝头的霜团：一小簇一小簇的白，比均匀撒点更像"落了雪" */
function buildFrost(clumps, perClump) {
  const count = clumps * perClump;
  const pos = new Float32Array(count * 3);
  const height = new Float32Array(count);
  const phase = new Float32Array(count);
  const size = new Float32Array(count);

  let n = 0;
  for (let c = 0; c < clumps; c++) {
    const t = 0.05 + Math.random() * 0.9;
    const angle = Math.random() * TAU;
    const baseR = TREE.baseRadius * Math.pow(1 - t, 0.94) * (0.94 + Math.random() * 0.1);
    const y = TREE.baseY + t * TREE.height;

    for (let i = 0; i < perClump; i++) {
      const a = angle + (Math.random() - 0.5) * 0.12;
      const r = baseR * (1 + (Math.random() - 0.5) * 0.05);
      pos[n * 3] = Math.cos(a) * r;
      pos[n * 3 + 1] = y + (Math.random() - 0.5) * 0.16;
      pos[n * 3 + 2] = Math.sin(a) * r;
      height[n] = t;
      phase[n] = Math.random() * TAU;
      size[n] = 0.9 + Math.random() * 1.1;
      n += 1;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aHeight', new THREE.BufferAttribute(height, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.computeBoundingSphere();
  return g;
}

/** 亮点：撒在锥面上，各自按不同的节奏闪，像枝头挂的小灯 / 雪晶 */
function buildTwinkles(count) {
  const pos = new Float32Array(count * 3);
  const height = new Float32Array(count);
  const phase = new Float32Array(count);
  const size = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // 越靠下面积越大，按面积权重撒
    const t = 1 - Math.pow(1 - Math.random(), 1.7);
    const angle = Math.random() * TAU;
    const radius = Math.max(0.15, TREE.baseRadius * Math.pow(1 - t, 0.94) * (0.82 + Math.random() * 0.2));

    pos[i * 3] = Math.cos(angle) * radius;
    pos[i * 3 + 1] = Math.max(TREE.baseY, TREE.baseY + t * TREE.height);
    pos[i * 3 + 2] = Math.sin(angle) * radius;

    height[i] = t;
    phase[i] = Math.random() * TAU;
    size[i] = 1.0 + Math.random() * 1.8;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aHeight', new THREE.BufferAttribute(height, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.computeBoundingSphere();
  return g;
}

function makeMaterial({ color, gain, flash }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uPixelRatio: { value: 1 },
      uColor: { value: new THREE.Color(color) },
      uGain: { value: gain },
      uFlash: { value: flash },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform float uPixelRatio;
      uniform vec3 uColor;
      uniform float uGain;
      uniform float uFlash;

      attribute float aHeight;
      attribute float aPhase;
      attribute float aSize;

      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        // 和树体一样的生长揭示：树亮到哪，装饰亮到哪
        float reveal = smoothstep(0.0, 0.08, uProgress * 1.08 - (1.0 - aHeight));

        // 闪：指数把正弦压成窄峰，亮一下就暗，才像在眨眼
        float blink = pow(0.5 + 0.5 * sin(uTime * 1.6 + aPhase * 3.1), 5.0);
        float twinkle = mix(0.35, 1.0, blink);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        gl_PointSize = aSize * uPixelRatio * (26.0 / max(0.6, -mv.z)) * (0.75 + 0.5 * twinkle) * uFlash;

        vColor = uColor;
        vAlpha = reveal * uGain * (0.3 + 0.7 * twinkle);
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
        gl_FragColor = vec4(vColor * (1.0 + falloff * 0.8), alpha);
      }
    `,
  });
}

export function createTreeDecor({ tinsel = 1500, frostClumps = 46, twinkles = 180 } = {}) {
  const group = new THREE.Group();

  const tinselGeometry = buildTinsel(tinsel);
  const tinselMaterial = makeMaterial({ color: 0xffd9a0, gain: 0.8, flash: 1.0 });
  const tinselPoints = new THREE.Points(tinselGeometry, tinselMaterial);
  tinselPoints.frustumCulled = false;
  tinselPoints.renderOrder = 3;
  group.add(tinselPoints);

  const frostGeometry = buildFrost(frostClumps, 14);
  const frostMaterial = makeMaterial({ color: 0xe6f7ff, gain: 0.5, flash: 0.95 });
  const frostPoints = new THREE.Points(frostGeometry, frostMaterial);
  frostPoints.frustumCulled = false;
  frostPoints.renderOrder = 4;
  group.add(frostPoints);

  const twinkleGeometry = buildTwinkles(twinkles);
  const twinkleMaterial = makeMaterial({ color: PALETTE.star || 0xffe0a8, gain: 0.62, flash: 1.1 });
  const twinklePoints = new THREE.Points(twinkleGeometry, twinkleMaterial);
  twinklePoints.frustumCulled = false;
  twinklePoints.renderOrder = 4;
  group.add(twinklePoints);

  const materials = [tinselMaterial, frostMaterial, twinkleMaterial];
  const geometries = [tinselGeometry, frostGeometry, twinkleGeometry];

  return {
    group,
    update(time) {
      for (const m of materials) m.uniforms.uTime.value = time;
    },
    setProgress(value) {
      for (const m of materials) m.uniforms.uProgress.value = value;
    },
    setPixelRatio(value) {
      for (const m of materials) m.uniforms.uPixelRatio.value = value;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
