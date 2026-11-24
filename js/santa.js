import * as THREE from 'three';
import { createGlowTexture } from './textures.js';

/**
 * 过场：圣诞老人雪橇沿 S 形绕树下降，车尾拖着照片。
 *
 * 全部用光点拼，和树的粒子语汇一致，不做写实模型：
 *  - 雪橇 = 侧面剪影挤出成车身，再在表面撒点 + 两侧更亮的轮廓
 *  - 驯鹿 = 圆点勾出的线稿（身体、脖子、鹿角、腿、铃铛）
 *  - 路径 = CatmullRom 曲线，预采样成数组，每帧只查表
 *
 * 整个过程不保存运动状态：每帧只由进度 p 算出位置，
 * 所以可以随时重播，掉帧也不会让时序漂掉。
 */

const DURATION = 12.0; // 整段时长（秒）
const SAMPLES = 420; // 路径预采样点数
const MAX_PHOTOS = 6;

/** 路径控制点：从画面上方进入 → 绕过树顶 → S 形螺旋下降 → 右下飞出画面 */
const PATH = [
  [-9.6, 11.2, 1.2],
  [-6.2, 9.4, 4.0],
  [-2.2, 8.2, 5.4],
  [2.4, 7.4, 5.2],
  [5.8, 5.8, 3.0],
  [6.8, 3.8, -1.8],
  [4.6, 2.3, -6.0],
  [-2.2, 1.2, -6.8],
  [-6.0, -0.2, -3.2],
  [-4.9, -1.6, 2.2],
  [-0.8, -2.6, 4.8],
  [3.6, -3.0, 4.6],
  [7.4, -2.8, 5.8],
  [11.2, -1.2, 7.8],
];

const rand = (min, max) => min + Math.random() * (max - min);
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/* ------------------------------------------------------------------ *
 * 点云缓冲（全部按"x 朝前、y 朝上、z 是宽度"的局部坐标画）
 * ------------------------------------------------------------------ */

function makeBuffers() {
  return { positions: [], sizes: [], tints: [] };
}

function pushPoint(buf, x, y, z, size, tint) {
  buf.positions.push(x, y, z);
  buf.sizes.push(size);
  buf.tints.push(tint);
}

/** 一条抖动的线段：线稿的基本单位 */
function stroke(buf, ax, ay, bx, by, z, count, size, tint) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    pushPoint(
      buf,
      ax + (bx - ax) * t + rand(-0.012, 0.012),
      ay + (by - ay) * t + rand(-0.012, 0.012),
      z + rand(-0.018, 0.018),
      size * rand(0.72, 1.3),
      tint
    );
  }
}

/** 椭圆轮廓：身体、头都用它 */
function ellipse(buf, cx, cy, rx, ry, z, count, size, tint) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pushPoint(
      buf,
      cx + Math.cos(a) * rx,
      cy + Math.sin(a) * ry,
      z + rand(-0.024, 0.024),
      size * rand(0.72, 1.3),
      tint
    );
  }
}

/** 把"朝 +x"的局部点云转成"朝 +z"，之后直接用 rotation.y 对朝向 */
function faceForward(buf) {
  const p = buf.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i];
    const z = p[i + 2];
    p[i] = -z;
    p[i + 2] = x;
  }
}

function buildPoints(buf) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(buf.sizes, 1));
  geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(buf.tints, 1));
  return geometry;
}

/* ------------------------------------------------------------------ *
 * 把真实几何体的三角形表面撒成点云
 * ------------------------------------------------------------------ */

function sampleSurface(geometry, count, buf, size, tint) {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.attributes.position;
  const triCount = Math.floor(pos.count / 3);
  if (!triCount) return;

  const areas = new Float32Array(triCount);
  let total = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    a.fromBufferAttribute(pos, i * 3);
    b.fromBufferAttribute(pos, i * 3 + 1);
    c.fromBufferAttribute(pos, i * 3 + 2);
    const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    areas[i] = area;
    total += area;
  }
  if (total <= 0) return;

  for (let n = 0; n < count; n++) {
    let r = Math.random() * total;
    let idx = 0;
    while (idx < triCount - 1 && r > areas[idx]) {
      r -= areas[idx];
      idx += 1;
    }
    a.fromBufferAttribute(pos, idx * 3);
    b.fromBufferAttribute(pos, idx * 3 + 1);
    c.fromBufferAttribute(pos, idx * 3 + 2);

    let u = Math.random();
    let v = Math.random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    pushPoint(
      buf,
      a.x + (b.x - a.x) * u + (c.x - a.x) * v,
      a.y + (b.y - a.y) * u + (c.y - a.y) * v,
      a.z + (b.z - a.z) * u + (c.z - a.z) * v,
      size * rand(0.7, 1.35),
      tint
    );
  }
}

/* ------------------------------------------------------------------ *
 * 雪橇 / 驯鹿
 * ------------------------------------------------------------------ */

/** 雪橇侧影：车头翘起、滑板贴地、车尾靠背内凹 */
function sleighShape() {
  const shape = new THREE.Shape();
  shape.moveTo(1.18, 0.3);
  shape.quadraticCurveTo(1.32, 0.12, 1.14, 0.02);
  shape.lineTo(0.98, -0.18);
  shape.quadraticCurveTo(0.88, -0.35, 0.62, -0.36);
  shape.lineTo(-0.72, -0.36);
  shape.quadraticCurveTo(-1.0, -0.36, -1.02, -0.1);
  shape.lineTo(-1.04, 0.26);
  shape.quadraticCurveTo(-1.02, 0.52, -0.74, 0.52);
  shape.quadraticCurveTo(-0.52, 0.52, -0.46, 0.34);
  shape.lineTo(-0.4, 0.1);
  shape.lineTo(0.42, 0.1);
  shape.lineTo(0.72, 0.2);
  shape.quadraticCurveTo(0.94, 0.26, 1.18, 0.3);
  return shape;
}

function addSleighBody(buf) {
  const shape = sleighShape();
  const depth = 0.62;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 10,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);

  // 车身：偏冷的暗色点，撑出体积；密度必须克制，不然轮廓会被糊掉
  sampleSurface(geometry, 900, buf, 1.25, 0.45);

  // 两侧轮廓：更亮更密的金色点，远处也认得出来是雪橇
  const outline = shape.getPoints(260);
  for (const side of [-1, 1]) {
    const z = (side * depth) / 2;
    for (const p of outline) {
      pushPoint(
        buf,
        p.x + rand(-0.008, 0.008),
        p.y + rand(-0.008, 0.008),
        z + rand(-0.02, 0.02),
        rand(1.5, 2.2),
        1
      );
    }
  }

  // 滑板的几道横梁，把两侧连起来
  for (const x of [-0.45, 0.1, 0.55]) {
    stroke(buf, x, -0.34, x, -0.16, 0, 6, 1.8, 0.6);
  }

  geometry.dispose();
}

function addDeer(buf, ox, oy, s) {
  const px = (x) => ox + x * s;
  const py = (y) => oy + y * s;

  // 身体：先填一层暗一点的点，再勾一圈亮轮廓，远处才不是个空圆圈
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    pushPoint(
      buf,
      px(Math.cos(a) * 0.44 * r),
      py(Math.sin(a) * 0.26 * r),
      rand(-0.03, 0.03),
      rand(0.9, 1.8),
      0.62
    );
  }
  ellipse(buf, px(0), py(0), 0.44 * s, 0.26 * s, 0, 30, 2.0, 0.7);

  stroke(buf, px(0.3), py(0.14), px(0.5), py(0.44), 0, 10, 1.9, 0.8); // 脖子
  ellipse(buf, px(0.57), py(0.48), 0.14 * s, 0.09 * s, 0, 16, 1.8, 0.9); // 头
  stroke(buf, px(0.52), py(0.55), px(0.47), py(0.64), 0, 5, 1.7, 0.8); // 耳朵

  // 鹿角
  stroke(buf, px(0.58), py(0.55), px(0.64), py(0.76), 0, 8, 1.7, 1);
  stroke(buf, px(0.64), py(0.76), px(0.78), py(0.82), 0, 6, 1.6, 1);
  stroke(buf, px(0.62), py(0.67), px(0.74), py(0.7), 0, 6, 1.6, 1);
  stroke(buf, px(0.55), py(0.58), px(0.44), py(0.78), 0, 7, 1.6, 1);
  stroke(buf, px(0.48), py(0.71), px(0.39), py(0.74), 0, 4, 1.5, 1);

  // 腿
  stroke(buf, px(-0.24), py(-0.16), px(-0.31), py(-0.64), 0, 10, 1.9, 0.7);
  stroke(buf, px(0.18), py(-0.16), px(0.25), py(-0.64), 0, 10, 1.9, 0.7);
  // 尾巴
  stroke(buf, px(-0.42), py(0.06), px(-0.55), py(-0.02), 0, 5, 1.6, 0.7);

  pushPoint(buf, px(0.61), py(0.5), 0, 3.6, 1); // 眼睛
  pushPoint(buf, px(0.42), py(0.3), 0, 4.0, 1); // 铃铛
}

/** 坐在车里的人：有个人形轮廓，远远一看就知道是圣诞老人 */
function addSantaFigure(buf) {
  // 红色身体
  for (let i = 0; i < 34; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    pushPoint(buf, -0.04 + Math.cos(a) * 0.2 * r, 0.4 + Math.sin(a) * 0.15 * r, rand(-0.12, 0.12), rand(1.0, 1.8), 0.22);
  }
  // 头 + 帽子 + 胡子
  ellipse(buf, -0.02, 0.68, 0.12, 0.12, 0, 20, 1.9, 1);
  stroke(buf, -0.02, 0.79, -0.13, 0.9, 0, 6, 1.6, 1);
  pushPoint(buf, -0.15, 0.93, 0, 3.4, 1);
  stroke(buf, 0.05, 0.63, 0.09, 0.55, 0, 5, 1.6, 1);

  // 车尾的礼物袋
  ellipse(buf, -0.62, 0.32, 0.18, 0.18, 0, 14, 1.5, 0.85);
  pushPoint(buf, -0.62, 0.5, 0, 2.6, 1);
  // 车头挂的小灯
  pushPoint(buf, 0.52, 0.26, 0, 3.0, 1);
}

function buildRigGeometry() {
  const buf = makeBuffers();

  addSleighBody(buf);
  addSantaFigure(buf);
  addDeer(buf, 2.05, 0.12, 1.0);
  addDeer(buf, 3.55, 0.06, 0.94);

  // 缰绳：从车头拉到驯鹿脖子
  const deer = [2.05, 3.55];
  for (const side of [-1, 1]) {
    const z = side * 0.26;
    stroke(buf, 1.05, 0.16, deer[0] + 0.42, 0.3, z, 14, 1.0, 0.85);
    stroke(buf, deer[0] - 0.35, 0.14, deer[1] + 0.42, 0.3, z, 18, 1.0, 0.85);
  }

  faceForward(buf);
  return buildPoints(buf);
}

/* ------------------------------------------------------------------ *
 * 着色器
 * ------------------------------------------------------------------ */

function makeMaterial({ pixelRatio = 1, opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uPixelRatio: { value: pixelRatio },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
      uCool: { value: new THREE.Color(0xb03a30) },
      uWarm: { value: new THREE.Color(0xffcf7a) },
    },
    vertexShader: /* glsl */ `
      uniform float uPixelRatio;
      uniform float uOpacity;
      uniform float uTime;

      attribute float aSize;
      attribute float aTint;

      varying float vTint;
      varying float vAlpha;

      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;

        float twinkle = 0.78 + 0.22 * sin(uTime * 5.0 + position.x * 7.0 + position.y * 4.0);
        gl_PointSize = aSize * uPixelRatio * twinkle * (34.0 / max(1.0, -mv.z));

        vTint = aTint;
        vAlpha = uOpacity;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCool;
      uniform vec3 uWarm;
      varying float vTint;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float falloff = smoothstep(0.5, 0.02, d);
        float alpha = falloff * vAlpha;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(mix(uCool, uWarm, vTint), alpha);
      }
    `,
  });
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

export function createSanta({ onFinish, onPhotoLand } = {}) {
  const group = new THREE.Group();
  group.visible = false;
  group.rotation.order = 'YXZ';

  const glowTexture = createGlowTexture(128);

  /* ---------------- 路径采样 ---------------- */

  const curve = new THREE.CatmullRomCurve3(
    PATH.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'centripetal',
    0.5
  );

  const samplePos = new Float32Array(SAMPLES * 3);
  const sampleYaw = new Float32Array(SAMPLES);
  const sampleBank = new Float32Array(SAMPLES);
  {
    const p = new THREE.Vector3();
    const next = new THREE.Vector3();
    const prev = new THREE.Vector3();
    for (let i = 0; i < SAMPLES; i++) {
      const u = i / (SAMPLES - 1);
      curve.getPointAt(u, p);
      samplePos[i * 3] = p.x;
      samplePos[i * 3 + 1] = p.y;
      samplePos[i * 3 + 2] = p.z;

      curve.getPointAt(Math.min(1, u + 0.02), next);
      curve.getPointAt(Math.max(0, u - 0.02), prev);
      sampleYaw[i] = Math.atan2(next.x - prev.x, next.z - prev.z);
    }
    // 侧倾：用较宽窗口的朝向变化算，避免逐点噪声
    for (let i = 0; i < SAMPLES; i++) {
      const a = sampleYaw[Math.max(0, i - 6)];
      const b = sampleYaw[Math.min(SAMPLES - 1, i + 6)];
      let delta = b - a;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      sampleBank[i] = Math.max(-0.42, Math.min(0.42, -delta * 1.6));
    }
  }

  // 竖屏时画面很窄，整条路径要横向压扁一点才不会飞出画外
  let horizontal = 1;

  function sampleAt(progress, out) {
    const i = Math.min(SAMPLES - 1, Math.max(0, Math.round(progress * (SAMPLES - 1))));
    out.set(samplePos[i * 3] * horizontal, samplePos[i * 3 + 1], samplePos[i * 3 + 2] * horizontal);
    return i;
  }

  /* ---------------- 雪橇本体 ---------------- */

  // 整体放大一点：跟 9 单位的树比，原尺寸在画面里太小，看不清是雪橇
  const rigGroup = new THREE.Group();
  rigGroup.scale.setScalar(1.3);
  group.add(rigGroup);

  const rigMaterial = makeMaterial();
  const rigPoints = new THREE.Points(buildRigGeometry(), rigMaterial);
  rigPoints.frustumCulled = false;
  rigPoints.renderOrder = 7;
  rigGroup.add(rigPoints);

  // 车灯：一颗暖白前灯 + 一颗红色尾灯，雪橇才像在飞
  const lampMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xffd9a0,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0.45,
  });
  const lamp = new THREE.Sprite(lampMaterial);
  lamp.scale.setScalar(1.1);
  lamp.position.set(0, 0.22, 1.15);
  rigGroup.add(lamp);

  const rearMaterial = lampMaterial.clone();
  rearMaterial.color = new THREE.Color(0xff6a4a);
  rearMaterial.opacity = 0.4;
  const rearLamp = new THREE.Sprite(rearMaterial);
  rearLamp.scale.setScalar(1.0);
  rearLamp.position.set(0, 0.32, -1.1);
  rigGroup.add(rearLamp);

  /* ---------------- 尾迹：一路撒下的光尘 ---------------- */

  const TRAIL = 150;
  const trailPositions = new Float32Array(TRAIL * 3);
  const trailSizes = new Float32Array(TRAIL);
  const trailTints = new Float32Array(TRAIL);
  const trailJitter = new Float32Array(TRAIL * 2);
  for (let i = 0; i < TRAIL; i++) {
    trailSizes[i] = rand(0.7, 2.0);
    trailTints[i] = Math.random() < 0.3 ? 0.15 : 1;
    trailJitter[i * 2] = rand(-1, 1);
    trailJitter[i * 2 + 1] = rand(-1, 1);
  }
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setAttribute('aSize', new THREE.BufferAttribute(trailSizes, 1));
  trailGeometry.setAttribute('aTint', new THREE.BufferAttribute(trailTints, 1));
  const trailMaterial = makeMaterial({ opacity: 0.9 });
  const trailPoints = new THREE.Points(trailGeometry, trailMaterial);
  trailPoints.frustumCulled = false;
  trailPoints.renderOrder = 7;
  group.add(trailPoints);

  /* ---------------- 照片拖尾 ---------------- */

  const photoGroup = new THREE.Group();
  group.add(photoGroup);

  let photos = [];
  let running = false;
  let startedAt = 0;
  let lastTime = 0;
  let pixelRatio = 1;

  const cursor = new THREE.Vector3();
  const detachAt = new THREE.Vector3();
  const targetLocal = new THREE.Vector3();
  const landWorld = new THREE.Vector3();

  function clearPhotos() {
    for (const item of photos) {
      photoGroup.remove(item.sprite);
      photoGroup.remove(item.glow);
      item.material.dispose();
      item.glowMaterial.dispose();
      item.texture.dispose();
    }
    photos = [];
  }

  function stagePhotos(entries) {
    clearPhotos();
    const list = entries.slice(0, MAX_PHOTOS);
    // 竖屏时路径被横向压扁，照片如果还保持原尺寸就会挤成一坨：
    // 按压扁系数同时缩小照片、加大上下错开的间距
    const tighten = horizontal;
    const sizeScale = 0.62 + 0.38 * tighten;
    const laneScale = 1 + (1 - tighten) * 1.2;
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];

      const material = new THREE.SpriteMaterial({
        map: entry.texture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(material);
      sprite.renderOrder = 9;
      sprite.visible = false;
      photoGroup.add(sprite);

      const glowMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffd9a0,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const glow = new THREE.Sprite(glowMaterial);
      glow.renderOrder = 8;
      glow.visible = false;
      photoGroup.add(glow);

      photos.push({
        landed: false,
        id: entry.id,
        texture: entry.texture,
        aspect: entry.aspect || 1,
        target: entry.target ? entry.target.clone() : null,
        release: 0.07 + i * 0.045, // 依次放出来
        delay: 0.06 + i * 0.022, // 跟在雪橇后面多远
        detach: 0.58 + i * 0.05, // 开始往树上送的时刻
        phase: Math.random() * Math.PI * 2,
        tilt: rand(-0.12, 0.12),
        // 上下错开成一串，不然几张照片会在同一位置叠成一坨
        lane: (i % 2 === 0 ? 1 : -1) * (0.34 + Math.floor(i / 2) * 0.26) * laneScale,
        size: (1.15 - i * 0.02) * sizeScale,
        sprite,
        material,
        glow,
        glowMaterial,
      });
    }
  }

  function hidePhoto(item) {
    item.sprite.visible = false;
    item.glow.visible = false;
    item.material.opacity = 0;
    item.glowMaterial.opacity = 0;
  }

  function updatePhotos(p, time) {
    for (const item of photos) {
      if (p < item.release) {
        hidePhoto(item);
        continue;
      }

      const arrive = Math.min(0.975, item.detach + 0.14);
      if (p > arrive) {
        hidePhoto(item);
        continue;
      }

      // 跟随位置：落在雪橇后面 delay 的地方
      sampleAt(clamp01(p - item.delay), cursor);

      if (p < item.detach || !item.target) {
        const sway = Math.sin(time * 2.1 + item.phase) * 0.3;
        const bob = Math.cos(time * 2.7 + item.phase * 1.7) * 0.2;
        item.sprite.position.set(
          cursor.x + sway,
          cursor.y + bob + item.lane,
          cursor.z + sway * 0.6 + item.lane * 0.35
        );
        const shrink = !item.target ? 1 - clamp01((p - item.detach) / 0.12) : 1;
        item.sprite.scale.set(
          Math.max(0.001, item.size * item.aspect * shrink),
          Math.max(0.001, item.size * shrink),
          1
        );
        item.material.rotation = item.tilt + Math.sin(time * 1.6 + item.phase) * 0.14;
        item.material.opacity = clamp01((p - item.release) / 0.05) * (shrink > 0.02 ? 1 : 0);
      } else {
        // 送到树上：从脱离点拱一道弧线飞到对应礼物的位置，一边缩小淡出
        const k = clamp01((p - item.detach) / (arrive - item.detach));
        sampleAt(clamp01(item.detach - item.delay), detachAt);
        detachAt.y += item.lane;
        targetLocal.copy(item.target);
        group.worldToLocal(targetLocal);

        const e = easeInOut(k);
        item.sprite.position.lerpVectors(detachAt, targetLocal, e);
        item.sprite.position.y += Math.sin(e * Math.PI) * 1.2;

        const shrink = 1 - e * 0.72;
        item.sprite.scale.set(
          Math.max(0.001, item.size * item.aspect * shrink),
          Math.max(0.001, item.size * shrink),
          1
        );
        item.material.rotation = item.tilt * (1 - e);
        item.material.opacity = 1 - clamp01((k - 0.55) / 0.45);

        // 落地的一瞬间给个星火，照片确实"放进礼物里"了
        if (!item.landed && k > 0.62) {
          item.landed = true;
          onPhotoLand?.(group.localToWorld(landWorld.copy(targetLocal)));
        }
      }

      item.sprite.visible = item.material.opacity > 0.01;
      item.glow.position.copy(item.sprite.position);
      item.glow.scale.setScalar(item.size * 2.2);
      item.glowMaterial.opacity = item.sprite.visible ? item.material.opacity * 0.55 : 0;
      item.glow.visible = item.sprite.visible;
    }
  }

  function updateTrail(p) {
    for (let i = 0; i < TRAIL; i++) {
      const back = (i / TRAIL) * 0.075;
      sampleAt(clamp01(p - back), cursor);
      const spread = 0.25 + back * 9;
      trailPositions[i * 3] = cursor.x + trailJitter[i * 2] * spread;
      trailPositions[i * 3 + 1] = cursor.y + trailJitter[i * 2 + 1] * spread * 0.7 + back * 0.5;
      trailPositions[i * 3 + 2] = cursor.z + trailJitter[i * 2] * spread;
    }
    trailGeometry.attributes.position.needsUpdate = true;
  }

  function finish() {
    running = false;
    group.visible = false;
    clearPhotos();
    onFinish?.();
  }

  return {
    group,

    /** entries: [{ id, texture, aspect, target: Vector3 }] */
    play(entries = [], now = 0) {
      stagePhotos(entries);
      startedAt = now;
      lastTime = now;
      running = true;
      group.visible = true;
    },

    stop() {
      if (running) finish();
    },

    update(time, dt) {
      if (!running) return;
      lastTime = time;
      const p = (time - startedAt) / DURATION;
      if (p >= 1) {
        finish();
        return;
      }
      const local = clamp01(p);

      // 进场淡入、出场淡出
      const alpha = Math.min(clamp01(local / 0.04), 1 - clamp01((local - 0.93) / 0.07));

      rigMaterial.uniforms.uOpacity.value = alpha;
      rigMaterial.uniforms.uTime.value = time;
      trailMaterial.uniforms.uOpacity.value = alpha * 0.9;
      trailMaterial.uniforms.uTime.value = time;
      lampMaterial.opacity = 0.45 * alpha;
      rearMaterial.opacity = 0.4 * alpha;

      const index = sampleAt(local, cursor);
      group.position.copy(cursor);
      group.position.y += Math.sin(time * 3.4) * 0.08; // 悬浮呼吸
      group.rotation.y = sampleYaw[index];
      group.rotation.z = sampleBank[index];
      group.rotation.x = Math.sin(time * 1.3) * 0.04;

      updateTrail(local);
      updatePhotos(local, time);
    },

    setPixelRatio(value) {
      pixelRatio = value;
      rigMaterial.uniforms.uPixelRatio.value = value;
      trailMaterial.uniforms.uPixelRatio.value = value;
    },

    /** 横向压缩系数：横竖屏切换时由外部按画面宽度算好传进来 */
    setHorizontalScale(value) {
      horizontal = Math.min(1, Math.max(0.35, value));
    },

    get active() {
      return running;
    },
    get progress() {
      return running ? clamp01((lastTime - startedAt) / DURATION) : 0;
    },
    get photoCount() {
      return photos.length;
    },
    get duration() {
      return DURATION;
    },

    dispose() {
      clearPhotos();
      rigPoints.geometry.dispose();
      rigMaterial.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
      lampMaterial.dispose();
      rearMaterial.dispose();
      glowTexture.dispose();
      group.clear();
    },
  };
}
