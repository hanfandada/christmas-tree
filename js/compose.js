import * as THREE from 'three';
import { PALETTE, TREE } from './config.js';
import { createGlowTexture } from './textures.js';

/**
 * 组合技：整棵树的粒子先炸开混成一团，再收拢成一句 "Merry Christmas"。
 *
 * 只用一个 Points + 一个着色器，每个粒子记三组位置：
 *   position   树上的原位（起点）
 *   aMix       "混成一团"阶段乱窜的位置
 *   aText      文字上的落点（相机坐标系，运行时再转到世界）
 * 顶点着色器按 uProgress 在 three 之间插值，CPU 每帧只更新几个 uniform，
 * 所以粒子数上万也几乎不花 CPU。
 *
 * 照片进来时按像素采样，把自己的颜色带进文字里——字是用照片拼的。
 */

const CLOUD_STAGE = 0.36; // uProgress 到这里算"完全炸开"
const RATE_OPEN = 0.26; // 每秒推进多少（0 → 0.36 约 1.4s）
const RATE_TEXT = 0.36; // 0.36 → 1 约 1.8s
const RATE_CLOSE = 0.85; // 1 → 0 约 1.2s
// 看照片结束时要"慢慢散开"，用比拼字更慢的一档
const RATE_CLOSE_SLOW = 0.17; // 0.36 → 0 约 2.1s，真的是"慢慢散开"
const RATE_FAST = 1.6; // 减少动效时用的倍率

// 参考机位（19.8）处的画面世界高度 = 2 * 19.8 * tan(fov/2)，
// 和 textLayout 用的是同一个数。照片和光框都按这个尺度算，再乘 uTextScale 跟随镜头
const REF_VIEW_HEIGHT = 15.2;

const PHOTO_BUDGET = 12000; // 照片粒子总上限

// 成字阶段整体压暗一档：上万颗亮点挤在笔画里，全亮会被泛光抓成一片白，
// 笔画的边缘反而糊掉，看起来"太亮"而不是"很亮"
const TEXT_TONE = 0.72;

const WARM_A = new THREE.Color(0xffd9a0);
const WARM_B = new THREE.Color(0xffb968);
const GREEN_A = new THREE.Color(PALETTE.treeMid);
const GREEN_B = new THREE.Color(PALETTE.treeTop);

const rand = (min, max) => min + Math.random() * (max - min);
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

/* ------------------------------------------------------------------ *
 * 文字采样
 * ------------------------------------------------------------------ */

function drawTextCanvas(lines, fontPx) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const family =
    '"Optima", "Palatino Linotype", "Songti SC", "Noto Serif SC", Georgia, serif';
  const font = `700 ${fontPx}px ${family}`;

  ctx.font = font;
  const widths = lines.map((line) => ctx.measureText(line).width);
  const lineHeight = fontPx * 1.16;
  const width = Math.ceil(Math.max(...widths) + fontPx * 0.5);
  const height = Math.ceil(lineHeight * lines.length + fontPx * 0.4);

  canvas.width = width;
  canvas.height = height;

  // 改尺寸会把 context 状态重置，字体要重设
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    const offset = (i - (lines.length - 1) / 2) * lineHeight;
    ctx.fillText(line, width / 2, height / 2 + offset);
  });
  return canvas;
}

/** 从文字画布里随机取 count 个落在笔画上的点，换算成以中心为原点的世界单位 */
function sampleText(canvas, count, targetWidth) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  const lit = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 190) lit.push(x, y);
    }
  }
  if (!lit.length) return null;

  const total = lit.length / 2;
  const scale = targetWidth / width;
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const k = (Math.random() * total) | 0;
    const px = lit[k * 2];
    const py = lit[k * 2 + 1];
    points[i * 3] = (px - width / 2) * scale;
    points[i * 3 + 1] = -(py - height / 2) * scale; // canvas 的 y 朝下
    points[i * 3 + 2] = 0;
  }
  return { points, count, width: width * scale, height: height * scale };
}

/** 竖屏用两行，横屏用一行；目标宽度按画面比例算，保证完整入镜 */
function textLayout(aspect) {
  const visibleWidth = 15.2 * aspect;
  const target = THREE.MathUtils.clamp(visibleWidth * 0.8, 3.4, 15);
  const twoLines = aspect < 1.0;
  return {
    lines: twoLines ? ['Merry', 'Christmas'] : ['Merry Christmas'],
    targetWidth: target,
    fontPx: twoLines ? 128 : 150,
  };
}

/* ------------------------------------------------------------------ *
 * 照片采样：把一张照片的像素变成带颜色的点
 * ------------------------------------------------------------------ */

function samplePhoto(canvas, count) {
  const small = document.createElement('canvas');
  const sw = 40;
  const sh = Math.max(1, Math.round((canvas.height / canvas.width) * sw));
  small.width = sw;
  small.height = sh;
  const ctx = small.getContext('2d');
  ctx.drawImage(canvas, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;

  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const px = (Math.random() * sw) | 0;
    const py = (Math.random() * sh) | 0;
    const o = (py * sw + px) * 4;
    // 稍微提亮：照片本身偏暗的话，进到文字里会看不见
    color.setRGB(
      data[o] / 255,
      data[o + 1] / 255,
      data[o + 2] / 255,
      THREE.SRGBColorSpace
    );
    // 只轻微提亮：照片本来就亮的话，再乘就全成白的，颜色就没了
    colors[i * 3] = Math.min(1, color.r * 1.05 + 0.06);
    colors[i * 3 + 1] = Math.min(1, color.g * 1.05 + 0.06);
    colors[i * 3 + 2] = Math.min(1, color.b * 1.05 + 0.06);
  }
  return colors;
}

/* ------------------------------------------------------------------ *
 * 着色器
 * ------------------------------------------------------------------ */

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform float uPixelRatio;
  uniform float uOpacity;
  uniform vec3 uAnchor;
  uniform mat3 uCamRot;
  uniform float uTextScale;
  uniform float uHalo;
  uniform float uKick;

  attribute vec3 aMix;
  attribute vec3 aText;
  attribute vec3 aHalo;
  attribute vec3 aColor;
  attribute vec3 aTextColor;
  attribute float aDelay;
  attribute float aPhase;
  attribute float aSize;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float up = smoothstep(0.0, 0.34, uProgress);
    float local = smoothstep(0.46 + aDelay * 0.26, 0.94, uProgress);

    vec3 p = mix(position, aMix, up);

    // 乱窜：只在"炸开之后、成字之前"最强
    float chaos = up * (1.0 - local);
    p += vec3(
      sin(uTime * 1.6 + aPhase * 6.28),
      cos(uTime * 1.9 + aPhase * 4.71),
      sin(uTime * 1.3 + aPhase * 3.14)
    ) * 0.6 * chaos;

    // 文字：贴在相机朝向的平面上，缩放跟着机位距离走，永远整句入镜
    vec3 target = uAnchor + uCamRot * (aText * uTextScale);
    p = mix(p, target, local);

    // 看照片：粒子沿照片外沿围成一道光框
    vec3 haloPos = uAnchor + uCamRot * (aHalo * uTextScale);
    p = mix(p, haloPos, uHalo);
    // 换照片的瞬间给一圈径向的抖，光框"重新排布"才有动感
    p += normalize(haloPos - uAnchor + vec3(0.0001))
      * sin(uTime * 5.2 + aPhase * 6.283) * uKick * uHalo * 0.7;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float twinkle = 0.7 + 0.3 * sin(uTime * 2.4 + aPhase * 9.0);
    gl_PointSize = aSize * uPixelRatio * (34.0 / max(1.0, -mv.z)) * (1.0 + chaos * 0.3 + local * 0.1 + uHalo * 0.15) * twinkle;

    vColor = mix(aColor, aTextColor, local);
    // 光框统一偏暖金：绕在照片外面的那一圈要像灯光，不像树叶
    vColor = mix(vColor, vec3(1.0, 0.86, 0.62), uHalo * 0.75);
    // 成字阶段压一档：上万颗加色点叠在笔画上，单个点再亮就糊成一片白，
    // 反而看不清字形。云阶段保持原亮度，只压落位之后的部分
    // 光框那圈粒子比云阶段稀，但挤在一圈上更容易过曝，先压一档
    vAlpha = uOpacity * mix(1.0, 0.6, local) * mix(1.0, 0.55, uHalo);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uProgress;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float falloff = smoothstep(0.5, 0.04, d);
    float alpha = falloff * vAlpha;
    if (alpha < 0.006) discard;
    // 成字阶段只提一点点，提多了就是过曝
    gl_FragColor = vec4(vColor * (1.05 + smoothstep(0.55, 1.0, uProgress) * 0.16), alpha);
  }
`;

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

export function createCompose({ count = 13000, reducedMotion = false } = {}) {
  const group = new THREE.Group();
  group.visible = false;

  /* ---------------- 静态几何：位置属性在 open 时才填 ---------------- */

  // 前 count 个是树粒子，后面一段预留给照片粒子（照片数不定，按上限分配）
  const TOTAL = count + PHOTO_BUDGET;
  const positions = new Float32Array(TOTAL * 3);
  const mixPositions = new Float32Array(TOTAL * 3);
  const textPositions = new Float32Array(TOTAL * 3);
  const haloPositions = new Float32Array(TOTAL * 3);
  const colors = new Float32Array(TOTAL * 3);
  const textColors = new Float32Array(TOTAL * 3);
  const delays = new Float32Array(TOTAL);
  const phases = new Float32Array(TOTAL);
  const sizes = new Float32Array(TOTAL);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aMix', new THREE.BufferAttribute(mixPositions, 3));
  geometry.setAttribute('aText', new THREE.BufferAttribute(textPositions, 3));
  geometry.setAttribute('aHalo', new THREE.BufferAttribute(haloPositions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aTextColor', new THREE.BufferAttribute(textColors, 3));
  geometry.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uPixelRatio: { value: 1 },
    uOpacity: { value: 1 },
    uAnchor: { value: new THREE.Vector3(0, 1.2, 0) },
    uCamRot: { value: new THREE.Matrix3() },
    uTextScale: { value: 1 },
    uHalo: { value: 0 },
    uKick: { value: 0 },
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
  points.renderOrder = 5;
  group.add(points);

  /* ---------------- 照片 ---------------- */

  const photoGroup = new THREE.Group();
  group.add(photoGroup);
  let photos = [];

  // 照片背后铺一层柔光：加色的场景里，照片直接贴在黑底上像一张糊上去的图
  const photoGlowTexture = createGlowTexture(256);
  const photoGlowMaterial = new THREE.SpriteMaterial({
    map: photoGlowTexture,
    color: 0xffd9a0,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
  });
  const photoGlow = new THREE.Sprite(photoGlowMaterial);
  photoGlow.renderOrder = 8;
  photoGlow.visible = false;
  photoGroup.add(photoGlow);

  function clearPhotos() {
    for (const item of photos) {
      photoGroup.remove(item.sprite);
      item.material.dispose();
      item.texture.dispose();
    }
    photos = [];
  }

  /* ---------------- 状态 ---------------- */

  let active = false;
  let closing = false;
  let stage = 'idle'; // idle | open | text | gallery | closing
  let current = 0;
  let target = 0;
  let startedAt = 0;
  let textAt = 0;
  let pixelRatio = 1;
  let photoParticles = 0;
  let onDone = null;

  // 看照片：一次只亮一张，捏一下换下一张
  let gallery = false;
  let activePhoto = -1;
  let photoAt = 0;
  let photoAlpha = 0;
  let prevPhoto = -1;
  let halo = 0;
  let kick = 0;
  let frameAspect = 0;
  let haloBuilt = false;
  let photoW = 0;
  let photoH = 0;

  const camQ = new THREE.Quaternion();
  const parentQ = new THREE.Quaternion();
  const rotMatrix = new THREE.Matrix4();
  const anchorWorld = new THREE.Vector3();

  /* ---------------- 生成粒子 ---------------- */

  function seedParticles(treePositions, textInfo, photoItems) {
    const treeCount = treePositions ? treePositions.length / 3 : 0;
    // 炸开的范围：稍微给大一点，颗粒一散才不显得是一团挤在树心
    const cloudRadius = Math.max(4.3, TREE.baseRadius * 2.4);
    const green = new THREE.Color();
    const warm = new THREE.Color();

    for (let i = 0; i < count; i++) {
      // 起点：优先取树上的真实位置，剩下 10% 补在外围，炸开时才有厚度
      let sx;
      let sy;
      let sz;
      if (treeCount && Math.random() < 0.9) {
        const k = ((Math.random() * treeCount) | 0) * 3;
        sx = treePositions[k];
        sy = treePositions[k + 1];
        sz = treePositions[k + 2];
      } else {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * cloudRadius;
        sx = Math.cos(a) * r;
        sy = TREE.baseY + Math.random() * TREE.height * 0.95;
        sz = Math.sin(a) * r;
      }
      positions[i * 3] = sx;
      positions[i * 3 + 1] = sy;
      positions[i * 3 + 2] = sz;

      // 乱窜点：树心周围一个球壳
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(rand(-1, 1));
      const radius = cloudRadius * rand(0.42, 1.0);
      mixPositions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      mixPositions[i * 3 + 1] = 1.1 + Math.cos(phi) * radius * 0.72;
      mixPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;

      // 云阶段是树的绿，成字阶段换成暖金
      const h = clamp01((sy - TREE.baseY) / TREE.height);
      green.copy(GREEN_A).lerp(GREEN_B, Math.pow(h, 0.7));
      warm.copy(WARM_A).lerp(WARM_B, Math.random());
      const roll = Math.random();
      if (roll < 0.06) {
        // 挂饰的节日色：红
        colors[i * 3] = 1; colors[i * 3 + 1] = 0.32; colors[i * 3 + 2] = 0.4;
      } else if (roll < 0.12) {
        // 金
        colors[i * 3] = 1; colors[i * 3 + 1] = 0.72; colors[i * 3 + 2] = 0.3;
      } else if (roll < 0.16) {
        // 冰蓝
        colors[i * 3] = 0.43; colors[i * 3 + 1] = 0.82; colors[i * 3 + 2] = 1;
      } else if (roll < 0.2) {
        // 暖白
        colors[i * 3] = 0.92; colors[i * 3 + 1] = 0.96; colors[i * 3 + 2] = 1;
      } else {
        colors[i * 3] = green.r;
        colors[i * 3 + 1] = green.g;
        colors[i * 3 + 2] = green.b;
      }
      textColors[i * 3] = warm.r * TEXT_TONE;
      textColors[i * 3 + 1] = warm.g * TEXT_TONE;
      textColors[i * 3 + 2] = warm.b * TEXT_TONE;

      delays[i] = Math.random();
      phases[i] = Math.random();
      sizes[i] = rand(0.75, 1.9);

      textPositions[i * 3] = textInfo.points[i * 3];
      textPositions[i * 3 + 1] = textInfo.points[i * 3 + 1];
      textPositions[i * 3 + 2] = 0;
    }

    // 照片粒子：从礼物位置起飞，混进云里，最后带着自己的颜色落进笔画
    let slot = count;
    for (const item of photoItems) {
      const n = Math.min(item.colors ? item.colors.length / 3 : 0, PHOTO_BUDGET);
      for (let i = 0; i < n && slot < TOTAL; i++, slot++) {
        const t = Math.random();
        const sample = ((t * textInfo.count) | 0) * 3;

        positions[slot * 3] = item.from.x;
        positions[slot * 3 + 1] = item.from.y;
        positions[slot * 3 + 2] = item.from.z;

        const theta = Math.random() * Math.PI * 2;
        const radius = item.radius * rand(0.8, 1.25);
        mixPositions[slot * 3] = Math.cos(theta) * radius;
        mixPositions[slot * 3 + 1] = 1.2 + item.lift + rand(-1.1, 1.1);
        mixPositions[slot * 3 + 2] = Math.sin(theta) * radius;

        const r = item.colors[i * 3];
        const g = item.colors[i * 3 + 1];
        const b = item.colors[i * 3 + 2];
        colors[slot * 3] = r;
        colors[slot * 3 + 1] = g;
        colors[slot * 3 + 2] = b;
        textColors[slot * 3] = r * TEXT_TONE;
        textColors[slot * 3 + 1] = g * TEXT_TONE;
        textColors[slot * 3 + 2] = b * TEXT_TONE;

        textPositions[slot * 3] = textInfo.points[sample];
        textPositions[slot * 3 + 1] = textInfo.points[sample + 1];
        textPositions[slot * 3 + 2] = 0;

        delays[slot] = Math.random();
        phases[slot] = Math.random();
        sizes[slot] = rand(0.9, 2.1);
      }
    }
    photoParticles = slot - count;

    for (const key of ['position', 'aMix', 'aText', 'aColor', 'aTextColor', 'aDelay', 'aPhase', 'aSize']) {
      geometry.attributes[key].needsUpdate = true;
    }
    geometry.setDrawRange(0, count + photoParticles);
  }


  /* ---------------- 看照片：一次亮一张，捏一下换下一张 ---------------- */

  /**
   * 照片在相机平面上的尺寸。用统一的"参考机位可视范围"算，
   * 再乘 uTextScale 跟随镜头，所以拉近拉远都整张入镜。
   */
  function photoFit(aspect) {
    const view = window.innerWidth / Math.max(1, window.innerHeight);
    const refWidth = REF_VIEW_HEIGHT * Math.max(0.4, view);
    const maxW = refWidth * 0.76;
    const maxH = REF_VIEW_HEIGHT * 0.58;
    let w = maxW;
    let h = w / Math.max(0.2, aspect);
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    return { w, h };
  }

  /**
   * 沿"圆角矩形"周长均匀取点的采样器。
   *
   * 第一版直接沿直角矩形的四条边取点，结果四条边被填成了四条发光的横杠——
   * 又硬又像贴了张边框贴纸。改成圆角 + 沿法线羽化之后，才是"围绕照片的一圈光"。
   * 也不能用椭圆：椭圆的四个角落在矩形内侧，会把光压在照片角上。
   */
  function roundedPerimeter(halfW, halfH) {
    const r = Math.min(halfW, halfH) * 0.28;
    const ix = halfW - r;
    const iy = halfH - r;
    const quarter = (Math.PI / 2) * r;

    const arc = (cx, cy, start) => (u) => {
      const a = start + u / r;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      return { x: cx + nx * r, y: cy + ny * r, nx, ny };
    };

    const segments = [
      { len: 2 * ix, at: (u) => ({ x: -ix + u, y: -halfH, nx: 0, ny: -1 }) },
      { len: quarter, at: arc(ix, -iy, -Math.PI / 2) },
      { len: 2 * iy, at: (u) => ({ x: halfW, y: -iy + u, nx: 1, ny: 0 }) },
      { len: quarter, at: arc(ix, iy, 0) },
      { len: 2 * ix, at: (u) => ({ x: ix - u, y: halfH, nx: 0, ny: 1 }) },
      { len: quarter, at: arc(-ix, iy, Math.PI / 2) },
      { len: 2 * iy, at: (u) => ({ x: -halfW, y: iy - u, nx: -1, ny: 0 }) },
      { len: quarter, at: arc(-ix, -iy, Math.PI) },
    ];

    const total = segments.reduce((sum, seg) => sum + seg.len, 0);
    return (f) => {
      let t = f * total;
      for (const seg of segments) {
        if (t <= seg.len) return seg.at(t);
        t -= seg.len;
      }
      return segments[0].at(0);
    };
  }

  /**
   * 光框：55% 贴着照片边缘羽化一圈，45% 散在更外面。
   * 羽化用 pow(random, 1.8) 而不是均匀分布——越靠近照片越密，往外越来越稀，
   * 这样才是一层光，而不是一条有厚度的带子。
   */
  function buildHalo(halfW, halfH, total) {
    const arr = haloPositions;
    const perimeter = roundedPerimeter(halfW, halfH);

    for (let i = 0; i < total; i++) {
      const ring = Math.random() < 0.55;
      let x;
      let y;
      let z;

      if (ring) {
        const point = perimeter(Math.random());
        const out = 0.22 + Math.pow(Math.random(), 1.8) * 0.95;
        // 沿切线抖一点，边才不会是一条直线
        const jitter = rand(-0.16, 0.16);
        x = point.x + point.nx * out - point.ny * jitter;
        y = point.y + point.ny * out + point.nx * jitter;
        z = 0.18 * rand(-1, 1);
      } else {
        const angle = Math.random() * Math.PI * 2;
        const spread = 1.15 + Math.pow(Math.random(), 0.6) * 1.45;
        x = Math.cos(angle) * halfW * spread;
        y = Math.sin(angle) * halfH * spread;
        z = 0.9 * rand(-1, 1);
      }

      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    }

    geometry.attributes.aHalo.needsUpdate = true;
  }

  function layoutFrame(aspect) {
    const fit = photoFit(aspect);
    photoW = fit.w;
    photoH = fit.h;
    const changed = Math.abs(aspect - frameAspect) > frameAspect * 0.04;
    frameAspect = aspect;
    if (changed || !haloBuilt) {
      buildHalo(fit.w / 2, fit.h / 2, count + photoParticles);
      haloBuilt = true;
    }
  }

  /** 挑下一张：随机，但不会连着重复同一张 */
  function pickPhoto() {
    if (!photos.length) return -1;
    if (photos.length === 1) return 0;
    let next = activePhoto;
    while (next === activePhoto) next = (Math.random() * photos.length) | 0;
    return next;
  }

  function showPhoto(timer) {
    if (!photos.length) return false;

    // 上一张不要直接切断：让它淡出去，和新的错开一个身位
    if (activePhoto >= 0 && photos[activePhoto]) photos[activePhoto].fade = 1;
    prevPhoto = activePhoto;

    activePhoto = pickPhoto();
    if (activePhoto < 0) return false;
    const item = photos[activePhoto];
    layoutFrame(item.aspect);
    photoAt = timer;
    kick = 1;
    for (let i = 0; i < photos.length; i++) photos[i].sprite.visible = i === activePhoto;
    return true;
  }

  /** 进入看照片：粒子从云里收到照片外沿，亮出第一张 */
  function enterGallery(timer = 0) {
    if (!active || gallery || stage !== 'open') return false;
    if (!photos.length) return false;
    stage = 'gallery';
    gallery = true;
    photoAlpha = 0;
    haloBuilt = false;
    prevPhoto = -1;
    showPhoto(timer);
    return true;
  }

  /** 再捏一下：换下一张 */
  function nextPhoto(timer = 0) {
    if (!gallery || closing) return false;
    return showPhoto(timer);
  }

  /* ---------------- 对外 ---------------- */

  function open({ treePositions, photoList = [], timer = 0 } = {}) {
    if (active) return false;

    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const layout = textLayout(aspect);
    const canvas = drawTextCanvas(layout.lines, layout.fontPx);
    const textInfo = sampleText(canvas, count, layout.targetWidth);
    if (!textInfo) return false;

    // 先把照片摆好（粒子要用它们的颜色和起飞位置）
    clearPhotos();
    const per = photoList.length
      ? Math.max(500, Math.min(2400, Math.floor(PHOTO_BUDGET / photoList.length)))
      : 0;

    for (const entry of photoList) {
      const pxColors = entry.sampleCanvas ? samplePhoto(entry.sampleCanvas, per) : null;
      const spriteMaterial = new THREE.SpriteMaterial({
        map: entry.texture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.renderOrder = 9;
      sprite.visible = false;
      photoGroup.add(sprite);

      photos.push({
        id: entry.id,
        from: entry.from ? entry.from.clone() : new THREE.Vector3(),
        aspect: entry.aspect || 1,
        phase: Math.random() * Math.PI * 2,
        radius: rand(3.0, 4.5),
        lift: rand(-0.9, 1.8),
        sprite,
        material: spriteMaterial,
        texture: entry.texture,
        colors: pxColors,
        arrived: 0,
        fade: 0,
      });
    }

    seedParticles(treePositions, textInfo, photos);

    active = true;
    closing = false;
    stage = 'open';
    gallery = false;
    activePhoto = -1;
    photoAlpha = 0;
    halo = 0;
    kick = 0;
    frameAspect = 0;
    haloBuilt = false;
    uniforms.uHalo.value = 0;
    uniforms.uKick.value = 0;
    current = reducedMotion ? 0.12 : 0;
    target = CLOUD_STAGE;
    startedAt = timer;
    textAt = 0;
    group.visible = true;
    uniforms.uOpacity.value = 1;
    return true;
  }

  function setText(timer = 0) {
    if (!active || stage === 'text') return false;
    stage = 'text';
    target = 1;
    textAt = timer;
    return true;
  }

  function close() {
    if (!active || closing) return;
    closing = true;
    stage = 'closing';
    target = 0;
  }

  function finish() {
    active = false;
    closing = false;
    stage = 'idle';
    gallery = false;
    activePhoto = -1;
    prevPhoto = -1;
    photoAlpha = 0;
    halo = 0;
    kick = 0;
    photoGlow.visible = false;
    uniforms.uHalo.value = 0;
    uniforms.uKick.value = 0;
    group.visible = false;
    clearPhotos();
    geometry.setDrawRange(0, 0);
    onDone?.();
  }

  function updatePhotos(time, dt) {
    if (gallery) {
      // 亮起来快、散场慢：最后那一两秒照片先在原地淡掉，粒子才收回去
      photoAlpha = closing
        ? Math.max(0, photoAlpha - dt * 1.5)
        : Math.min(1, photoAlpha + dt * 3.2);

      const item = photos[activePhoto];
      if (photoAlpha <= 0.01 || !item) {
        for (const entry of photos) entry.sprite.visible = false;
        photoGlow.visible = false;
        return;
      }

      // 换照片时从小的重新长大；照片贴在相机平面上，靠 uTextScale 跟随镜头
      const t = clamp01((time - photoAt) / 0.62);
      const ease = 1 - Math.pow(1 - t, 3);
      const scale = uniforms.uTextScale.value;
      const grow = 0.7 + 0.3 * ease;

      // 上一张往下缩着淡掉，新的一张从 0.7 倍长大
      if (prevPhoto >= 0 && prevPhoto !== activePhoto) {
        const prev = photos[prevPhoto];
        prev.fade = Math.max(0, prev.fade - dt * 5.5);
        if (prev.fade > 0.01) {
          prev.sprite.visible = true;
          prev.material.opacity = photoAlpha * prev.fade;
          prev.sprite.scale.multiplyScalar(1 - dt * 0.5);
        } else {
          prev.sprite.visible = false;
          prevPhoto = -1;
        }
      }

      for (let i = 0; i < photos.length; i++) {
        const keep = i === activePhoto || i === prevPhoto;
        if (!keep) photos[i].sprite.visible = false;
      }
      item.sprite.position.copy(uniforms.uAnchor.value);
      item.sprite.scale.set(photoW * scale * grow, photoH * scale * grow, 1);
      item.material.opacity = photoAlpha * (0.3 + 0.7 * ease);
      item.material.rotation = 0;

      photoGlow.visible = true;
      photoGlow.position.copy(item.sprite.position);
      photoGlow.scale.set(photoW * scale * grow * 1.75, photoH * scale * grow * 1.75, 1);
      photoGlowMaterial.opacity = photoAlpha * 0.3;
      return;
    }

    for (const item of photos) {
      const t = clamp01((time - startedAt) / 1.3);
      const ease = t * t * (3 - 2 * t);
      const orbit = time * 0.55 + item.phase;

      const cx = Math.cos(orbit) * item.radius;
      const cz = Math.sin(orbit) * item.radius;
      const cy = 1.2 + item.lift + Math.sin(time * 1.3 + item.phase) * 0.4;

      item.sprite.position.set(
        item.from.x + (cx - item.from.x) * ease,
        item.from.y + (cy - item.from.y) * ease,
        item.from.z + (cz - item.from.z) * ease
      );

      // 成字过程中缩小并淡出，让位给它们自己化成的粒子
      const dissolve = clamp01((current - CLOUD_STAGE) / (1 - CLOUD_STAGE));
      const visible = 1 - dissolve * 1.3;
      const scale = (1.1 + ease * 0.5) * Math.max(0, visible);
      item.sprite.scale.set(Math.max(0.001, scale * item.aspect), Math.max(0.001, scale), 1);
      item.material.opacity = Math.max(0, visible) * (0.35 + ease * 0.65);
      item.material.rotation = Math.sin(time * 0.9 + item.phase) * 0.12;
      item.sprite.visible = item.material.opacity > 0.02;
      item.arrived = ease;
    }
  }

  return {
    group,

    open,
    setText,
    close,
    enterGallery,
    nextPhoto,

    update(time, dt, camera) {
      if (!active) return;

      uniforms.uTime.value = time;

      // 光框的进出，以及换照片那一下的径向抖。
      // 收得比张得慢：照片先淡掉，光框再一层层散回云里
      const haloGoal = gallery && !closing ? 1 : 0;
      const haloRate = haloGoal > halo ? 2.6 : 1.3;
      halo = THREE.MathUtils.clamp(
        halo + Math.sign(haloGoal - halo) * Math.min(Math.abs(haloGoal - halo), dt * haloRate),
        0,
        1
      );
      uniforms.uHalo.value = halo;
      kick = Math.max(0, kick - dt * 2.4);
      uniforms.uKick.value = kick;

      // 推进 uProgress
      const closeRate =
        gallery && stage === 'closing' ? RATE_CLOSE_SLOW : RATE_CLOSE;
      const slow =
        stage === 'open' ? RATE_OPEN : stage === 'text' ? RATE_TEXT : closeRate;
      const rate = slow * (reducedMotion ? RATE_FAST : 1);
      if (current < target) current = Math.min(target, current + rate * dt);
      else if (current > target) current = Math.max(target, current - rate * dt);
      uniforms.uProgress.value = current;

      // 相机朝向（转到 world 局部空间）
      if (camera) {
        camQ.copy(camera.quaternion);
        if (group.parent) {
          group.parent.getWorldQuaternion(parentQ);
          camQ.premultiply(parentQ.invert());
        }
        rotMatrix.makeRotationFromQuaternion(camQ);
        uniforms.uCamRot.value.setFromMatrix4(rotMatrix);

        // 缩放跟着机位距离走，拉近了也不会出画
        const dist = camera.position.length();
        uniforms.uTextScale.value = THREE.MathUtils.clamp(dist / 19.8, 0.45, 2.4);
      }

      // 收尾淡出
      if (closing) {
        uniforms.uOpacity.value = clamp01(current / 0.12);
        if (current <= 0.0001) finish();
      }

      updatePhotos(time, dt);
    },

    setPixelRatio(value) {
      pixelRatio = value;
      uniforms.uPixelRatio.value = value;
    },

    onDone(cb) {
      onDone = cb;
    },

    get active() {
      return active;
    },
    /** 粒子云是否已经接管画面（主循环据此隐藏真实场景） */
    get covered() {
      return active && current > 0.05;
    },
    get progress() {
      return current;
    },
    get stage() {
      return stage;
    },
    get photoCount() {
      return photos.length;
    },
    get particleCount() {
      return count + photoParticles;
    },

    dispose() {
      clearPhotos();
      photoGlowMaterial.dispose();
      photoGlowTexture.dispose();
      geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
