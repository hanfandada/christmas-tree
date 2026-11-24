import * as THREE from 'three';
import { TREE } from './config.js';
import { createGlowTexture } from './textures.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_PHOTOS = 60;
const GOLD = new THREE.Color(0xffd08a);
const FESTIVE = [0xd6504a, 0xd98f3f, 0x3a9a6c, 0x4a7fd0, 0xb2518f];

/* ------------------------------------------------------------------ *
 * 礼物盒的粒子几何
 * 整个盒子由光点拼成：稀疏的外壳 + 更亮的棱边 + 金色丝带 + 蝴蝶结，
 * 这样它和粒子圣诞树才像同一个世界里的东西。
 * ------------------------------------------------------------------ */

const BODY = { w: 0.5, h: 0.39, d: 0.5 };
const LID = { w: 0.55, h: 0.07, d: 0.55 };

function makeBuffers() {
  return { positions: [], sizes: [], tints: [] };
}

function pushPoint(buf, x, y, z, size, tint) {
  buf.positions.push(x, y, z);
  buf.sizes.push(size);
  buf.tints.push(tint);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

/** 外壳：六个面随机撒点 */
function addShell(buf, box, perFace, size) {
  const { w, h, d } = box;
  for (let i = 0; i < perFace; i++) {
    // +Y / -Y
    pushPoint(buf, rand(-w, w), h, rand(-d, d), size, 0);
    pushPoint(buf, rand(-w, w), -h, rand(-d, d), size, 0);
    // +X / -X
    pushPoint(buf, w, rand(-h, h), rand(-d, d), size, 0);
    pushPoint(buf, -w, rand(-h, h), rand(-d, d), size, 0);
    // +Z / -Z
    pushPoint(buf, rand(-w, w), rand(-h, h), d, size, 0);
    pushPoint(buf, rand(-w, w), rand(-h, h), -d, size, 0);
  }
}

/** 十二条棱：更亮更密的点，勾出盒子轮廓 */
function addEdges(buf, box, perEdge) {
  const { w, h, d } = box;
  const corners = [
    [-w, -h, -d], [w, -h, -d], [w, -h, d], [-w, -h, d],
    [-w, h, -d], [w, h, -d], [w, h, d], [-w, h, d],
  ];
  const pairs = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  for (const [ai, bi] of pairs) {
    const a = corners[ai];
    const b = corners[bi];
    for (let i = 0; i < perEdge; i++) {
      const t = i / (perEdge - 1);
      pushPoint(
        buf,
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        rand(1.3, 2.2),
        2
      );
    }
  }
}

/** 丝带：盒子上一横一竖两条金色光带 */
function addRibbon(buf, box, count) {
  const { w, h, d } = box;
  const half = 0.075;
  for (let i = 0; i < count; i++) {
    // 前后两个面上的竖带
    pushPoint(buf, rand(-half, half), rand(-h, h), d + 0.002, rand(1.3, 2.1), 1);
    pushPoint(buf, rand(-half, half), rand(-h, h), -d - 0.002, rand(1.3, 2.1), 1);
    // 左右两个面上的竖带
    pushPoint(buf, w + 0.002, rand(-h, h), rand(-half, half), rand(1.3, 2.1), 1);
    pushPoint(buf, -w - 0.002, rand(-h, h), rand(-half, half), rand(1.3, 2.1), 1);
    // 顶面的十字带
    pushPoint(buf, rand(-half, half), h + 0.002, rand(-d, d), rand(1.3, 2.1), 1);
    pushPoint(buf, rand(-w, w), h + 0.002, rand(-half, half), rand(1.3, 2.1), 1);
  }
}

/** 蝴蝶结：两个椭圆光点在盒盖上方 */
function addBow(buf, topY) {
  const loops = [
    { cx: -0.11, rot: 0.55 },
    { cx: 0.11, rot: -0.55 },
  ];
  for (const loop of loops) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rx = 0.14;
      const ry = 0.09;
      const x = Math.cos(a) * rx;
      const y = Math.sin(a) * ry;
      const cos = Math.cos(loop.rot);
      const sin = Math.sin(loop.rot);
      pushPoint(
        buf,
        loop.cx + x * cos - y * sin,
        topY + x * sin + y * cos,
        Math.sin(a * 2) * 0.02,
        rand(1.4, 2.3),
        1
      );
    }
  }
}

function buildGiftGeometry() {
  const body = makeBuffers();
  addShell(body, BODY, 84, rand(0.85, 1.5));
  addEdges(body, BODY, 12);
  addRibbon(body, BODY, 16);

  const lid = makeBuffers();
  addShell(lid, LID, 32, rand(0.85, 1.4));
  addEdges(lid, LID, 7);
  addRibbon(lid, LID, 8);
  addBow(lid, LID.h + 0.06);

  return { body, lid };
}

function buildAttributeGeometry(buf) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(buf.sizes, 1));
  const phases = new Float32Array(buf.sizes.length);
  for (let i = 0; i < phases.length; i++) phases[i] = Math.random();
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(buf.tints, 1));
  return geometry;
}

/* ------------------------------------------------------------------ */

export function createPhotoOrnaments(world, { onSparkle } = {}) {
  const group = new THREE.Group();
  world.add(group);

  const glowTexture = createGlowTexture(128);
  const giftGeometry = buildGiftGeometry();

  const vertexShader = /* glsl */ `
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
      // 极轻微的漂浮，让盒子像光凝成的一样
      p += vec3(
        sin(uTime * 0.9 + aPhase * 12.0),
        cos(uTime * 0.7 + aPhase * 9.0),
        sin(uTime * 0.8 + aPhase * 15.0)
      ) * 0.01;

      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;

      float twinkle = 0.5 + 0.5 * sin(uTime * (1.1 + aPhase * 1.6) + aPhase * 7.0);

      vec3 color = uColor;
      if (aTint > 0.5) color = uGold;
      if (aTint > 1.5) color = mix(uGold, uColor, 0.55);

      vColor = color;
      vAlpha = uOpacity * (0.3 + 0.5 * twinkle) * (aTint > 1.5 ? 0.95 : 1.0);
      gl_PointSize = aSize * uPixelRatio * (38.0 / max(0.6, -mv.z)) * (0.75 + 0.4 * twinkle);
    }
  `;

  const fragmentShader = /* glsl */ `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      float d = length(gl_PointCoord - 0.5);
      float falloff = smoothstep(0.5, 0.0, d);
      float alpha = falloff * vAlpha;
      if (alpha < 0.008) discard;
      gl_FragColor = vec4(vColor * 1.35, alpha);
    }
  `;

  function makeGiftMaterial(color) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uOpacity: { value: 1 },
        uColor: { value: color.clone().multiplyScalar(1.0) },
        uGold: { value: GOLD.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader,
      fragmentShader,
    });
  }

  /* ---------------- 光尘拖尾：每个粒子画一小段线，形成尾迹 ---------------- */

  function makeTrail(color) {
    const count = 34;
    const positions = new Float32Array(count * 2 * 3);
    const ends = new Float32Array(count * 2);
    const phases = new Float32Array(count * 2);
    const speeds = new Float32Array(count * 2);
    const radii = new Float32Array(count * 2);
    const offsets = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
      const phase = Math.random();
      const speed = 0.55 + Math.random() * 1.1;
      const radius = 0.55 + Math.random() * 0.8;
      const offset = Math.random();

      for (let e = 0; e < 2; e++) {
        const k = i * 2 + e;
        ends[k] = e;
        phases[k] = phase;
        speeds[k] = speed;
        radii[k] = radius;
        offsets[k] = offset;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    geometry.setAttribute('aHeight', new THREE.BufferAttribute(offsets, 1));

    const uniforms = {
      uTime: { value: 0 },
      uIntensity: { value: 0.3 },
      uTrail: { value: 0.3 },
      uColor: { value: color.clone().lerp(GOLD, 0.5) },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;
        uniform float uTrail;

        attribute float aEnd;
        attribute float aPhase;
        attribute float aSpeed;
        attribute float aRadius;
        attribute float aHeight;

        varying float vAlpha;

        void main() {
          float t = uTime - aEnd * uTrail;
          float life = fract(aHeight + t * aSpeed * 0.22);
          float angle = aPhase * 6.2831853 + t * (0.28 + aSpeed * 0.3);
          float radius = aRadius * (0.85 + 0.18 * sin(t * 1.2 + aPhase * 9.0));
          float y = -0.14 + life * 1.25;

          vec3 p = vec3(cos(angle) * radius, y, sin(angle) * radius);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

          float fade = sin(life * 3.14159);
          float twinkle = 0.5 + 0.5 * sin(t * 2.6 + aPhase * 14.0);
          vAlpha = fade * (1.0 - aEnd * 0.88) * (0.35 + 0.65 * twinkle) * uIntensity;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;

        void main() {
          if (vAlpha < 0.01) discard;
          gl_FragColor = vec4(uColor * 1.7, vAlpha);
        }
      `,
    });

    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.renderOrder = 7;
    return { lines, uniforms, geometry, material };
  }

  /* ---------------- 礼物之间的粒子连线 ---------------- */

  const ARC_SEGMENTS = 18;
  const arcs = [];
  let lastArcAt = -10;

  function createArc() {
    const positions = new Float32Array((ARC_SEGMENTS + 1) * 3);
    const ts = new Float32Array(ARC_SEGMENTS + 1);
    for (let i = 0; i <= ARC_SEGMENTS; i++) ts[i] = i / ARC_SEGMENTS;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aT', new THREE.BufferAttribute(ts, 1));

    // 用一串小光点连成虚线，比 1px 实线更符合粒子场景，也更显眼
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uPixelRatio: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute float aT;
        varying float vT;
        varying float vAlpha;

        void main() {
          vT = aT;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);

          float head = fract(uTime * 0.3);
          float band = exp(-pow((head - aT) * 3.2, 2.0));
          float twinkle = 0.5 + 0.5 * sin(uTime * 3.0 + aT * 18.0);

          vAlpha = 0.3 + 0.55 * band + 0.2 * twinkle;

          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.9 + band * 1.1) * uPixelRatio * (30.0 / max(1.0, -mv.z));
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vT;
        varying float vAlpha;

        void main() {
          float d = length(gl_PointCoord - 0.5);
          float falloff = smoothstep(0.5, 0.0, d);
          float alpha = falloff * vAlpha * uOpacity;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * 1.3, alpha);
        }
      `,
    });

    const line = new THREE.Points(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 7;
    line.visible = false;
    group.add(line);

    const arc = { line, material, geometry, positions, a: null, b: null, life: 0, duration: 3.2 };
    arcs.push(arc);
    return arc;
  }

  function spawnArc() {
    if (items.size < 2) return;
    const free = arcs.find((arc) => !arc.a);
    if (!free) return;

    const list = [...items.values()].filter((item) => item.group.visible);
    if (list.length < 2) return;

    const pairs = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const dist = list[i].group.position.distanceTo(list[j].group.position);
        if (dist < 4.6) pairs.push({ a: list[i], b: list[j], dist });
      }
    }
    if (!pairs.length) return;
    pairs.sort((p, q) => p.dist - q.dist);
    const pick = pairs[Math.floor(Math.random() * Math.min(4, pairs.length))];

    free.a = pick.a;
    free.b = pick.b;
    free.life = 0;
    free.line.visible = true;
  }

  for (let i = 0; i < 4; i++) createArc();

  const arcPoint = new THREE.Vector3();
  function updateArcs(time, dt) {
    for (const arc of arcs) {
      if (!arc.a) continue;

      arc.life += dt;
      // 一端转到背面就加速淡出，避免出现"连到树里"的断线
      if (!arc.a.group.visible || !arc.b.group.visible) arc.life += dt * 3;
      const k = arc.life / arc.duration;

      if (k >= 1 || !items.has(arc.a.id) || !items.has(arc.b.id)) {
        arc.a = null;
        arc.b = null;
        arc.line.visible = false;
        arc.material.uniforms.uOpacity.value = 0;
        continue;
      }

      const start = arc.a.group.position;
      const end = arc.b.group.position;
      const mid = arcPoint.copy(start).add(end).multiplyScalar(0.5);
      mid.y += 0.35;
      mid.x *= 1.06;
      mid.z *= 1.06;

      for (let i = 0; i <= ARC_SEGMENTS; i++) {
        const t = i / ARC_SEGMENTS;
        const oneMinus = 1 - t;
        const x = oneMinus * oneMinus * start.x + 2 * oneMinus * t * mid.x + t * t * end.x;
        const y = oneMinus * oneMinus * start.y + 2 * oneMinus * t * mid.y + t * t * end.y;
        const z = oneMinus * oneMinus * start.z + 2 * oneMinus * t * mid.z + t * t * end.z;
        arc.positions[i * 3] = x;
        arc.positions[i * 3 + 1] = y;
        arc.positions[i * 3 + 2] = z;
      }
      arc.geometry.attributes.position.needsUpdate = true;

      const envelope = Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k);
      arc.material.uniforms.uTime.value = time;
      arc.material.uniforms.uPixelRatio.value = pixelRatio;
      arc.material.uniforms.uOpacity.value = Math.max(0, envelope) * 2.4;

      const dist = start.distanceTo(end);
      arc.material.uniforms.uOpacity.value *= THREE.MathUtils.clamp(1.35 - dist / 9, 0.55, 1);
    }
  }

  /* ---------------- 状态 ---------------- */

  const items = new Map();
  const order = [];
  let hoveredId = null;
  let sparkleAt = 0;
  let pixelRatio = 1;

  function slotFor(index, total) {
    const t = 0.12 + 0.74 * ((index + 0.5) / Math.max(total, 1));
    const angle = index * GOLDEN_ANGLE + 0.35;
    const radius = TREE.baseRadius * Math.pow(1 - t, 0.94) * 1.22;
    return new THREE.Vector3(
      Math.cos(angle) * radius,
      TREE.baseY + t * TREE.height,
      Math.sin(angle) * radius
    );
  }

  function sizeFor(total) {
    return THREE.MathUtils.clamp(0.62 * Math.pow(6 / Math.max(total, 1), 0.14), 0.38, 0.62);
  }

  function reflow() {
    const total = order.length;
    const size = sizeFor(total);
    order.forEach((id, index) => {
      const item = items.get(id);
      item.slot.copy(slotFor(index, total));
      item.targetScale = size;
    });
  }

  /* ---------------- 创建 / 销毁 ---------------- */

  function add(id, color, { spawnFrom = null, animate = true } = {}) {
    if (items.has(id) || items.size >= MAX_PHOTOS) return null;

    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    const sourceColor = hsl.s < 0.12
      ? new THREE.Color(FESTIVE[order.length % FESTIVE.length])
      : color;
    const baseColor = sourceColor.clone().offsetHSL(0, 0.26, -0.02);

    const itemGroup = new THREE.Group();
    itemGroup.userData.photoId = id;

    const bodyMaterial = makeGiftMaterial(baseColor);
    const bodyPoints = new THREE.Points(buildAttributeGeometry(giftGeometry.body), bodyMaterial);
    bodyPoints.frustumCulled = false;
    bodyPoints.renderOrder = 6;
    itemGroup.add(bodyPoints);

    // 盒盖：单独一组粒子，开盒时整组飞走
    const lidGroup = new THREE.Group();
    lidGroup.position.y = 0.46;
    const lidMaterial = makeGiftMaterial(baseColor.clone().offsetHSL(0, 0, 0.05));
    const lidPoints = new THREE.Points(buildAttributeGeometry(giftGeometry.lid), lidMaterial);
    lidPoints.frustumCulled = false;
    lidPoints.renderOrder = 6;
    lidGroup.add(lidPoints);
    itemGroup.add(lidGroup);

    // 拖尾光尘
    const trail = makeTrail(baseColor);
    itemGroup.add(trail.lines);

    // 外圈柔光
    const auraMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: baseColor.clone().lerp(new THREE.Color(0xffe6b8), 0.4),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.16,
    });
    const aura = new THREE.Sprite(auraMaterial);
    aura.scale.setScalar(2.0);
    aura.renderOrder = 5;
    itemGroup.add(aura);

    // 盒内的光（打开时溢出）
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: baseColor.clone().lerp(new THREE.Color(0xfff0c8), 0.55),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    const glow = new THREE.Sprite(glowMaterial);
    glow.position.y = 0.28;
    glow.scale.setScalar(1.6);
    glow.renderOrder = 8;
    itemGroup.add(glow);

    // 只用来接射线的隐形盒子
    const pickMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 1.15, 1.15),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    pickMesh.userData.photoId = id;
    itemGroup.add(pickMesh);

    const item = {
      id,
      group: itemGroup,
      lidGroup,
      bodyMaterial,
      lidMaterial,
      trail,
      aura,
      auraMaterial,
      glow,
      glowMaterial,
      pickMesh,
      slot: new THREE.Vector3(),
      targetScale: 0.4,
      spawnFrom: spawnFrom ? spawnFrom.clone() : null,
      progress: animate ? 0 : 1,
      phase: Math.random() * Math.PI * 2,
      hover: 0,
      hoverTarget: 0,
      open: 0,
      openTarget: 0,
    };

    itemGroup.position.copy(item.spawnFrom || slotFor(order.length, order.length + 1));
    itemGroup.scale.setScalar(animate ? 0.05 : item.targetScale);

    items.set(id, item);
    order.push(id);
    group.add(itemGroup);
    reflow();

    if (!animate) {
      itemGroup.position.copy(item.slot);
      itemGroup.scale.setScalar(item.targetScale);
    }

    return item;
  }

  function remove(id) {
    const item = items.get(id);
    if (!item) return;
    items.delete(id);
    const index = order.indexOf(id);
    if (index >= 0) order.splice(index, 1);
    group.remove(item.group);

    item.bodyMaterial.dispose();
    item.lidMaterial.dispose();
    item.trail.geometry.dispose();
    item.trail.material.dispose();
    item.auraMaterial.dispose();
    item.glowMaterial.dispose();
    item.group.children.forEach((child) => {
      if (child.isMesh && child.geometry) child.geometry.dispose();
    });
    reflow();
  }

  function clear() {
    for (const id of [...order]) remove(id);
  }

  /* ---------------- 每帧更新 ---------------- */

  const cameraLocal = new THREE.Vector3();

  function updateItems(time, dt, cameraWorld) {
    const easeOut = (x) => 1 - Math.pow(1 - x, 3);
    if (cameraWorld && group.parent) {
      cameraLocal.copy(cameraWorld);
      group.parent.worldToLocal(cameraLocal);
    }

    // 礼物之间的连线：隔一会儿挑两个靠近的礼物连一下
    if (time - lastArcAt > 1.8 && items.size >= 2) {
      lastArcAt = time;
      spawnArc();
    }
    updateArcs(time, dt);

    for (const item of items.values()) {
      if (item.progress < 1) {
        item.progress = Math.min(1, item.progress + dt / 0.85);
        const k = easeOut(item.progress);
        if (item.spawnFrom) item.group.position.lerpVectors(item.spawnFrom, item.slot, k);
        else item.group.position.copy(item.slot);
        item.group.scale.setScalar(0.05 + (item.targetScale - 0.05) * k);
      } else {
        item.group.position.lerp(item.slot, Math.min(1, dt * 2.2));
        item.hover += (item.hoverTarget - item.hover) * Math.min(1, dt * 9);
        const desired = item.targetScale * (1 + item.hover * 0.85);
        const current = item.group.scale.x;
        item.group.scale.setScalar(current + (desired - current) * Math.min(1, dt * 6));
      }

      item.open += (item.openTarget - item.open) * Math.min(1, dt * 7);
      const pulse = 0.5 + 0.5 * Math.sin(time * 1.5 + item.phase);

      // 材质时间与亮度
      const bodyUniforms = item.bodyMaterial.uniforms;
      const lidUniforms = item.lidMaterial.uniforms;
      bodyUniforms.uTime.value = time;
      lidUniforms.uTime.value = time;
      bodyUniforms.uPixelRatio.value = pixelRatio;
      lidUniforms.uPixelRatio.value = pixelRatio;

      // 盒盖飞出
      const lift = item.hover * 0.06 + item.open * 0.8;
      item.lidGroup.position.y = 0.46 + lift;
      item.lidGroup.rotation.z = item.open * 0.95 + item.hover * 0.06;
      item.lidGroup.rotation.x = item.open * 0.35;

      // 光尘与柔光
      item.trail.uniforms.uTime.value = time;
      item.trail.uniforms.uIntensity.value = 0.8 + item.hover * 2.2 + item.open * 2.6;
      item.auraMaterial.opacity = 0.08 + 0.08 * pulse + item.hover * 0.3 + item.open * 0.4;
      item.aura.scale.setScalar(2.0 + item.hover * 0.5 + item.open * 0.8);
      item.glowMaterial.opacity = item.open * 0.85;
      item.glow.scale.setScalar(1.2 + item.open * 1.8);

      // 朝向相机
      const dx = cameraLocal.x - item.group.position.x;
      const dz = cameraLocal.z - item.group.position.z;
      item.group.rotation.y = Math.atan2(dx, dz);

      // 背面淡出
      const normal = Math.hypot(item.group.position.x, item.group.position.z);
      let facing = 1;
      if (normal > 0.0001) {
        const nx = item.group.position.x / normal;
        const nz = item.group.position.z / normal;
        const len = Math.hypot(dx, dz) || 1;
        facing = nx * (dx / len) + nz * (dz / len);
      }
      const visibility = THREE.MathUtils.smoothstep(facing, -0.05, 0.3);
      item.group.visible = visibility > 0.02;

      bodyUniforms.uOpacity.value = visibility;
      lidUniforms.uOpacity.value = visibility * (1 - item.open * 0.9);
      item.trail.uniforms.uIntensity.value *= visibility;
      item.auraMaterial.opacity *= visibility;
      item.glowMaterial.opacity *= visibility;

      // 悬停时朝观众浮出
      if (item.hover > 0.01) {
        const fx = cameraLocal.x - item.group.position.x;
        const fy = cameraLocal.y - item.group.position.y;
        const fz = cameraLocal.z - item.group.position.z;
        const len = Math.hypot(fx, fy, fz) || 1;
        item.group.position.x += (fx / len) * item.hover * 0.22;
        item.group.position.y += (fy / len) * item.hover * 0.22;
        item.group.position.z += (fz / len) * item.hover * 0.22;
      }

      if (item.hover > 0.4 && onSparkle && time - sparkleAt > 0.22) {
        sparkleAt = time;
        onSparkle(item.group.getWorldPosition(new THREE.Vector3()));
      }
    }
  }

  function pick(raycaster) {
    const meshes = [];
    for (const item of items.values()) {
      if (item.group.visible && item.pickMesh) meshes.push(item.pickMesh);
    }
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    return hits[0].object.userData.photoId || null;
  }

  /* ---------------- 冲击波 ---------------- */

  const ringGeometry = new THREE.RingGeometry(0.6, 0.66, 64);
  const rings = [];

  function spawnRing(item) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffd79a,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(ringGeometry, material);
    mesh.position.copy(item.group.position);
    mesh.renderOrder = 8;
    group.add(mesh);
    rings.push({
      mesh,
      material,
      life: 0,
      duration: 0.6,
      startScale: Math.max(0.2, item.group.scale.x * 0.9),
    });
  }

  function updateRings(dt) {
    for (let i = rings.length - 1; i >= 0; i--) {
      const ring = rings[i];
      ring.life += dt;
      const k = Math.min(1, ring.life / ring.duration);
      ring.mesh.scale.setScalar(ring.startScale * (1 + k * 3.2));
      ring.material.opacity = Math.pow(1 - k, 2.2) * 0.6;
      ring.mesh.lookAt(cameraLocal);
      if (k >= 1) {
        group.remove(ring.mesh);
        ring.material.dispose();
        rings.splice(i, 1);
      }
    }
  }

  return {
    group,
    add,
    remove,
    clear,
    update(time, dt, cameraWorld) {
      updateItems(time, dt, cameraWorld);
      updateRings(dt);
    },
    pick,
    setPixelRatio(value) {
      pixelRatio = value;
    },
    setHover(id) {
      if (hoveredId === id) return;
      hoveredId = id;
      for (const item of items.values()) item.hoverTarget = item.id === id ? 1 : 0;
    },
    setOpen(id, open) {
      const item = items.get(id);
      if (!item) return;
      if (open && item.openTarget !== 1) spawnRing(item);
      item.openTarget = open ? 1 : 0;
    },
    getPosition(id) {
      const item = items.get(id);
      return item ? item.group.getWorldPosition(new THREE.Vector3()) : null;
    },
    getScreenRect(id, camera, width, height) {
      const item = items.get(id);
      if (!item) return null;
      const position = item.group.getWorldPosition(new THREE.Vector3());
      const projected = position.clone().project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;

      const edge = position.clone().add(new THREE.Vector3(0, item.group.scale.x, 0));
      const edgeProjected = edge.project(camera);
      const edgeY = (-edgeProjected.y * 0.5 + 0.5) * height;
      const size = Math.abs(edgeY - y) * 2;

      return { x, y, size };
    },
    getArcCount() {
      return arcs.filter((a) => a.a).length;
    },
    /** 树上照片的 id，按挂上树的先后顺序 */
    getIds() {
      return [...order];
    },
    getDebug() {
      return [...items.values()].map((i) => ({
        id: i.id,
        visible: i.group.visible,
        hover: +i.hover.toFixed(2),
        open: +i.open.toFixed(2),
        scale: +i.group.scale.x.toFixed(3),
      }));
    },
    get count() {
      return items.size;
    },
    get max() {
      return MAX_PHOTOS;
    },
    dispose() {
      clear();
      ringGeometry.dispose();
      glowTexture.dispose();
      for (const arc of arcs) {
        arc.geometry.dispose();
        arc.material.dispose();
      }
    },
  };
}
