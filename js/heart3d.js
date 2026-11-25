import * as THREE from 'three';
import { TREE } from './config.js';

/**
 * 🤟 的反馈：整棵树上的一部分粒子离开树体，在树前方汇聚成一颗立体的爱心，
 * 缓慢自转、微微跳动，停留一会儿再飞回树上。
 *
 * 和「组合技拼字」是同一套做法——只用一个 Points，每个粒子记两组位置：
 *   aStart   树上的原位（起点，open 时按真实粒子坐标填）
 *   position 心形上的落点（本地坐标，着色器里再自转 + 平移）
 * 顶点着色器按 uProgress 在两处之间插值，CPU 每帧只更新几个 uniform。
 *
 * 和拼字不同的是：这里**不隐藏真实场景**，树还在，粒子看起来是从树上长出来的。
 */

const FLY_OUT = 1.6; // 飞出去
const HOLD = 1.6; // 悬停
const FLY_BACK = 1.4; // 飞回去
const TOTAL = FLY_OUT + HOLD + FLY_BACK;

const rand = (min, max) => min + Math.random() * (max - min);

// 心形的三种暖色 + 一点点冷白提亮
const ROSE = new THREE.Color(0xff3d6b);
const PINK = new THREE.Color(0xff8fab);
const GOLD = new THREE.Color(0xffc06a);
const WHITE = new THREE.Color(0xffe9f0);

/**
 * 心形参数方程，归一化到 [-1, 1]（+y 朝上）。
 * 也是"轮廓多边形"，内部填充用射线法判断。
 */
function buildOutline(steps = 300) {
  const raw = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    raw.push([
      16 * Math.pow(Math.sin(t), 3),
      13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
    ]);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of raw) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const span = Math.max(maxX - minX, maxY - minY) / 2 || 1;
  const cx = (maxX + minX) / 2;
  const cy = (maxY + minY) / 2;
  return raw.map(([x, y]) => [(x - cx) / span, (y - cy) / span]);
}

const OUTLINE = buildOutline();

function insideHeart(x, y) {
  let inside = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [xi, yi] = OUTLINE[i];
    const [xj, yj] = OUTLINE[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 心形点云：轮廓 55%（形状才认得出来）、内部 45%（有体积感）。
 *
 * 厚度不是简单的"再复制一层"，而是按 x 位置算出该处有多厚——
 * 中间厚、边缘薄，看起来才是一颗鼓起来的心，不是一块板。
 */
function buildHeartPoints(count) {
  const points = [];
  const rimCount = Math.round(count * 0.55);
  const puff = (x) => Math.sqrt(Math.max(0, 1 - Math.min(1, (x / 1.02) ** 2))) * 0.62;

  for (let i = 0; i < rimCount; i++) {
    const [x, y] = OUTLINE[(Math.random() * OUTLINE.length) | 0];
    const px = x + rand(-0.014, 0.014);
    const py = y + rand(-0.014, 0.014);
    // 大部分贴在正反表面上，少量在中间，才有"壳"的观感
    const side = Math.random() < 0.5 ? -1 : 1;
    const depth = Math.random() < 0.78 ? side : rand(-1, 1);
    points.push({ x: px, y: py, z: depth * puff(px) * rand(0.86, 1) });
  }

  let placed = 0;
  let guard = 0;
  while (placed < count - rimCount && guard < count * 40) {
    guard += 1;
    const x = rand(-1, 1);
    const y = rand(-0.62, 0.8);
    if (!insideHeart(x, y)) continue;
    placed += 1;
    points.push({ x, y, z: rand(-1, 1) * puff(x) * 0.8 });
  }

  return points;
}

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform float uPixelRatio;
  uniform float uRot;
  uniform float uScale;
  uniform vec3 uCenter;

  attribute vec3 aStart;
  attribute vec3 aColor;
  attribute float aDelay;
  attribute float aPhase;
  attribute float aSize;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // 起飞：按 aDelay 依次离开树，别整团一起动
    float outT = smoothstep(0.0, 1.0, clamp((uProgress - aDelay * 0.16) / 0.34, 0.0, 1.0));
    // 落位：最后一段一起飞回树上
    float backT = smoothstep(0.72, 1.0, uProgress);

    // 心形落点：绕 Y 轴缓慢自转 + 心跳
    float c = cos(uRot);
    float s = sin(uRot);
    vec3 h = position;
    h.xz = mat2(c, -s, s, c) * h.xz;
    float beat = 1.0 + 0.045 * sin(uTime * 2.4);
    vec3 target = uCenter + h * uScale * beat;

    vec3 p = mix(aStart, target, outT);
    p = mix(p, aStart, backT);

    // 飞行途中绕一下，别走直线
    float swirl = sin(3.14159 * outT) * (1.0 - backT);
    p += vec3(
      sin(uTime * 1.3 + aPhase * 6.28),
      cos(uTime * 1.1 + aPhase * 4.0),
      sin(uTime * 1.7 + aPhase * 3.0)
    ) * 0.8 * swirl;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float twinkle = 0.72 + 0.28 * sin(uTime * 3.1 + aPhase * 12.0);
    gl_PointSize = aSize * uPixelRatio * (30.0 / max(0.8, -mv.z)) * twinkle * (0.75 + 0.35 * outT);

    vColor = aColor;
    // 加色混合叠上泛光，单点不能太亮，否则整颗心糊成一片白
    vAlpha = (0.16 + 0.34 * outT) * (1.0 - backT * 0.9) * (0.8 + 0.2 * twinkle);
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float falloff = smoothstep(0.5, 0.05, d);
    float alpha = falloff * vAlpha;
    if (alpha < 0.006) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

export function createHeart3D({ count = 6000, size = 2.1, reducedMotion = false } = {}) {
  const group = new THREE.Group();
  group.visible = false;

  const heartPos = buildHeartPoints(count);
  const positions = new Float32Array(count * 3);
  const starts = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const delays = new Float32Array(count);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const pt = heartPos[i] || { x: 0, y: 0, z: 0 };
    positions[i * 3] = pt.x;
    positions[i * 3 + 1] = pt.y;
    positions[i * 3 + 2] = pt.z;

    const roll = Math.random();
    const color = roll < 0.42 ? ROSE : roll < 0.72 ? PINK : roll < 0.9 ? GOLD : WHITE;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    delays[i] = Math.random();
    phases[i] = Math.random();
    sizes[i] = Math.random() < 0.12 ? rand(3.6, 5.2) : rand(2.0, 3.4);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aStart', new THREE.BufferAttribute(starts, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uPixelRatio: { value: 1 },
    uRot: { value: 0 },
    uScale: { value: size },
    // 挂在树前方一段距离：太近会和树叶糊在一起，看不出是一颗心
    uCenter: { value: new THREE.Vector3(0, TREE.baseY + TREE.height * 0.5, 4.2) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 6;
  group.add(points);

  let active = false;
  let startedAt = 0;
  let progress = 0;
  let paused = false; // 只在 seek() 里用：定格在某个进度方便截图
  const duration = reducedMotion ? TOTAL * 0.55 : TOTAL;

  /** 用树上的真实粒子坐标当起点，看起来才是"从树里飞出来的" */
  function play({ treePositions, time = 0 } = {}) {
    const n = treePositions ? treePositions.length / 3 : 0;
    for (let i = 0; i < count; i++) {
      if (n) {
        const k = ((Math.random() * n) | 0) * 3;
        starts[i * 3] = treePositions[k];
        starts[i * 3 + 1] = treePositions[k + 1];
        starts[i * 3 + 2] = treePositions[k + 2];
      } else {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * TREE.baseRadius;
        starts[i * 3] = Math.cos(a) * r;
        starts[i * 3 + 1] = TREE.baseY + Math.random() * TREE.height;
        starts[i * 3 + 2] = Math.sin(a) * r;
      }
    }
    geometry.getAttribute('aStart').needsUpdate = true;

    startedAt = time;
    progress = 0;
    paused = false;
    uniforms.uProgress.value = 0;
    uniforms.uRot.value = 0;
    group.visible = true;
    active = true;
  }

  return {
    group,
    play,
    update(time, dt, camera) {
      if (!active || paused) return;
      const t = time - startedAt;
      progress = Math.min(t / duration, 1);
      uniforms.uProgress.value = progress;
      uniforms.uTime.value = time;
      // 全程只转 60 度左右：转太多就看不出是心形了
      uniforms.uRot.value = reducedMotion ? 0 : t * 0.2;
      if (progress >= 1) {
        active = false;
        group.visible = false;
      }
    },
    setPixelRatio(value) {
      uniforms.uPixelRatio.value = value;
    },
    get active() {
      return active;
    },
    get progress() {
      return progress;
    },
    get particleCount() {
      return count;
    },
    /** 调试用：定格在某个进度（截图不用等动画跑完） */
    seek(value, time = 0) {
      if (!active) play({ time });
      paused = true;
      progress = Math.min(1, Math.max(0, value));
      uniforms.uProgress.value = progress;
      uniforms.uTime.value = time;
      uniforms.uRot.value = progress * TOTAL * 0.2;
      group.visible = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
