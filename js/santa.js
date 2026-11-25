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
  return {
    positions: [],
    sizes: [],
    tints: [],
    // 驯鹿的关节骨架。每个点带上"该怎么动"的全部信息，
    // 顶点着色器就能只靠 uTime 把整只鹿跑起来，CPU 每帧不用碰几何体：
    //   deerMask 是不是鹿身上的点
    //   seg      0 = 不隶属任何一条腿，1 = 大腿（髋→膝），2 = 小腿（膝→蹄）
    //   hips     这条腿的髋（俯仰平面里的 x,y）
    //   knees    这条腿的膝（小腿绕它弯）
    //   amp      摆幅。负值表示后腿，膝关节朝反方向折
    //   phase    这条腿（或这只鹿）的步频相位
    //   origin   整只鹿的俯仰支点
    deerMask: [],
    seg: [],
    hips: [],
    knees: [],
    amp: [],
    phase: [],
    origin: [],
    // 表面法线。实体表面撒出来的点带法线，着色器据此剔掉背面，
    // 否则加法混合没有深度遮挡，球的前后两层会叠在一起，正面看就是一团散点。
    // 线稿点这里是 (0,0,0)，表示"不用剔"
    normals: [],
    // 亮度系数：暗色的体积点、远侧的腿靠它压下去，
    // 光靠 tint 只改色相，不改明暗
    bright: [],
  };
}

function pushPoint(buf, x, y, z, size, tint, bright = 1) {
  buf.positions.push(x, y, z);
  buf.sizes.push(size);
  buf.tints.push(tint);
  buf.deerMask.push(0);
  buf.seg.push(0);
  buf.hips.push(0, 0);
  buf.knees.push(0, 0);
  buf.amp.push(0);
  buf.phase.push(0);
  buf.origin.push(0, 0);
  buf.normals.push(0, 0, 0);
  buf.bright.push(bright);
}

/** 一条抖动的线段：线稿的基本单位 */
function stroke(buf, ax, ay, bx, by, z, count, size, tint, bright = 1) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    pushPoint(
      buf,
      ax + (bx - ax) * t + rand(-0.012, 0.012),
      ay + (by - ay) * t + rand(-0.012, 0.012),
      z + rand(-0.018, 0.018),
      size * rand(0.72, 1.3),
      tint,
      bright
    );
  }
}

/** 椭圆轮廓：身体、头都用它 */
function ellipse(buf, cx, cy, rx, ry, z, count, size, tint, bright = 1) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pushPoint(
      buf,
      cx + Math.cos(a) * rx,
      cy + Math.sin(a) * ry,
      z + rand(-0.024, 0.024),
      size * rand(0.72, 1.3),
      tint,
      bright
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
  geometry.setAttribute('aDeer', new THREE.Float32BufferAttribute(buf.deerMask, 1));
  geometry.setAttribute('aSeg', new THREE.Float32BufferAttribute(buf.seg, 1));
  geometry.setAttribute('aHip', new THREE.Float32BufferAttribute(buf.hips, 2));
  geometry.setAttribute('aKnee', new THREE.Float32BufferAttribute(buf.knees, 2));
  geometry.setAttribute('aAmp', new THREE.Float32BufferAttribute(buf.amp, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(buf.phase, 1));
  geometry.setAttribute('aOrigin', new THREE.Float32BufferAttribute(buf.origin, 2));
  geometry.setAttribute('aBright', new THREE.Float32BufferAttribute(buf.bright, 1));
  geometry.setAttribute('aNormal', new THREE.Float32BufferAttribute(buf.normals, 3));
  return geometry;
}

/* ------------------------------------------------------------------ *
 * 把真实几何体的三角形表面撒成点云
 * ------------------------------------------------------------------ */

function sampleSurface(geometry, count, buf, size, tint, bright = 1) {
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
      tint,
      bright
    );
    // 这一片的法线：背面剔除要用
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a)).normalize();
    const last = buf.positions.length / 3 - 1;
    buf.normals[last * 3] = n.x;
    buf.normals[last * 3 + 1] = n.y;
    buf.normals[last * 3 + 2] = n.z;
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
  // 按弧长均匀取点。getPoints 是按曲线参数取的，圆弧段会挤上一大堆点、
  // 直线段几乎没点，于是车头车尾亮成两个白月牙、车厢里一片黑，
  // 坐在车里的人就被那两团光吃掉了
  const outline = shape.getSpacedPoints(170);
  for (const side of [-1, 1]) {
    const z = (side * depth) / 2;
    for (const p of outline) {
      pushPoint(
        buf,
        p.x + rand(-0.008, 0.008),
        p.y + rand(-0.008, 0.008),
        z + rand(-0.02, 0.02),
        rand(1.2, 1.65),
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

function addDeer(buf, ox, oy, s, phase = 0) {
  const px = (x) => ox + x * s;
  const py = (y) => oy + y * s;
  const deerStart = buf.positions.length / 3;

  /**
   * 一条两节腿：髋 → 膝 → 蹄。
   * 大腿上的点标 seg 1（绕髋转），小腿标 seg 2（先绕膝弯、再跟着大腿绕髋转），
   * 这样才有关节的折叠感，而不是一根棍子在扇形摆动。
   */
  function leg(hx, hy, kx, ky, fx, fy, z, amp, ph, bright) {
    const hip = [px(hx), py(hy)];
    const knee = [px(kx), py(ky)];

    const begin = buf.positions.length / 3;
    stroke(buf, hip[0], hip[1], knee[0], knee[1], z, 7, 2.1, 0.66, bright); // 大腿
    const mid = buf.positions.length / 3;
    stroke(buf, knee[0], knee[1], px(fx), py(fy), z, 8, 1.7, 0.58, bright); // 小腿
    const end = buf.positions.length / 3;

    const tag = (i) => {
      buf.seg[i] = i < mid ? 1 : 2;
      buf.hips[i * 2] = hip[0];
      buf.hips[i * 2 + 1] = hip[1];
      buf.knees[i * 2] = knee[0];
      buf.knees[i * 2 + 1] = knee[1];
      buf.amp[i] = amp;
      buf.phase[i] = ph;
    };
    for (let i = begin; i < end; i++) tag(i);

    // 蹄子：也算小腿的一部分，跟着膝盖一起甩
    const hoof = buf.positions.length / 3;
    pushPoint(buf, px(fx), py(fy), z, 2.4, 0.88, bright);
    tag(hoof);
    buf.seg[hoof] = 2;

    // 肩/臀的肌肉块，把腿和身子接上，不然侧面看是四根棍子插在球上
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 0.1;
      pushPoint(buf, hip[0] + Math.cos(a) * r, hip[1] + Math.sin(a) * r * 1.25, z * 0.75, rand(0.8, 1.5), 0.5, 0.45 * bright);
    }
  }

  // ---- 躯干 ----
  // 先塞一层暗点当体积。r 偏向外圈，才像个有厚度、边缘结实的身体，
  // 而不是一团均匀的雾
  for (let i = 0; i < 120; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.6);
    pushPoint(
      buf,
      px(Math.cos(a) * 0.40 * r),
      py(Math.sin(a) * 0.20 * r),
      rand(-0.05, 0.05),
      rand(0.75, 1.4),
      0.45,
      0.55
    );
  }
  ellipse(buf, px(0), py(0), 0.40 * s, 0.20 * s, 0, 36, 2.2, 0.72); // 亮轮廓
  // 肩、臀两块鼓包，侧面才有前后之分
  ellipse(buf, px(0.30), py(-0.02), 0.13 * s, 0.15 * s, 0, 16, 1.7, 0.6, 0.85);
  ellipse(buf, px(-0.30), py(0.01), 0.15 * s, 0.165 * s, 0, 16, 1.7, 0.6, 0.85);
  // 脊背一道高光
  for (let i = 0; i < 15; i++) {
    const t = i / 14;
    pushPoint(buf, px(-0.30 + t * 0.6), py(0.183 - Math.abs(t - 0.52) * 0.1), rand(-0.02, 0.02), 1.8, 0.95, 1);
  }
  stroke(buf, px(-0.26), py(-0.168), px(0.24), py(-0.16), 0, 12, 1.3, 0.42, 0.55); // 肚皮暗线

  // ---- 脖子：短而前倾，从肩里长出来，压在躯干上，不能留缝 ----
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const x = 0.30 + t * 0.21;
    const y = 0.0 + t * 0.2;
    const w = 0.098 * (1 - t) + 0.05 * t;
    pushPoint(buf, px(x), py(y + w * 0.8), 0, 1.8, 0.72, 0.9);
    pushPoint(buf, px(x), py(y - w), 0, 1.8, 0.6, 0.68);
    if (i > 1 && i % 2 === 0) pushPoint(buf, px(x - 0.01), py(y), rand(-0.03, 0.03), 1.3, 0.45, 0.45);
  }
  // 喉线，把下颌和胸口连起来
  stroke(buf, px(0.585), py(0.20), px(0.35), py(-0.06), 0, 8, 1.2, 0.5, 0.55);

  // ---- 头 ----
  ellipse(buf, px(0.60), py(0.245), 0.105 * s, 0.063 * s, 0, 18, 1.9, 0.88);
  ellipse(buf, px(0.71), py(0.222), 0.052 * s, 0.033 * s, 0, 10, 1.6, 0.8, 0.9); // 口鼻
  pushPoint(buf, px(0.755), py(0.222), 0, 1.7, 0.9); // 鼻尖
  // 耳朵：近侧亮、远侧暗
  stroke(buf, px(0.555), py(0.30), px(0.482), py(0.375), 0.05, 4, 1.5, 0.85, 0.95);
  stroke(buf, px(0.585), py(0.295), px(0.52), py(0.365), -0.05, 4, 1.3, 0.5, 0.45);
  pushPoint(buf, px(0.625), py(0.262), 0.04, 3.2, 1); // 眼睛

  // ---- 鹿角 ----
  // 主枝从角座往后上方扫，三个叉朝前上方；左右各一根，远侧压暗
  const antler = (z, bright) => {
    // 主枝：从角座一路往后上方扫，越长越像鹿角
    stroke(buf, px(0.555), py(0.30), px(0.487), py(0.45), z, 3, 1.45, 0.94, bright);
    stroke(buf, px(0.487), py(0.45), px(0.437), py(0.565), z, 3, 1.4, 0.94, bright);
    stroke(buf, px(0.437), py(0.565), px(0.4), py(0.665), z, 3, 1.35, 0.94, bright);
    // 眉叉朝前
    stroke(buf, px(0.532), py(0.36), px(0.628), py(0.402), z, 3, 1.3, 1, bright);
    // 中叉
    stroke(buf, px(0.487), py(0.45), px(0.578), py(0.512), z, 3, 1.3, 1, bright);
    // 后叉
    stroke(buf, px(0.452), py(0.535), px(0.518), py(0.60), z, 2, 1.25, 1, bright);
    // 顶端的掌状分叉
    stroke(buf, px(0.4), py(0.665), px(0.362), py(0.738), z, 2, 1.25, 1, bright);
    stroke(buf, px(0.4), py(0.665), px(0.442), py(0.728), z, 2, 1.25, 1, bright);
  };
  antler(0.05, 1.0);
  antler(-0.05, 0.5);

  // ---- 尾巴：驯鹿的尾巴短而翘 ----
  stroke(buf, px(-0.38), py(0.10), px(-0.455), py(0.155), 0, 4, 1.7, 0.72, 0.9);
  pushPoint(buf, px(-0.475), py(0.17), 0, 2.5, 0.9);

  // ---- 四条腿 ----
  // 横向奔跑的四拍落蹄次序：后近 → 后远 → 前近 → 前远。
  // amp 的符号决定膝关节往哪边折：前腿收蹄时向后折、后腿的跗关节向前收。
  leg(-0.27, -0.01, -0.32, -0.23, -0.25, -0.55, 0.13, 0.55, phase + 0.0, 1.0);
  leg(-0.31, -0.01, -0.36, -0.23, -0.29, -0.55, -0.13, 0.5, phase + 0.45, 0.45);
  leg(0.26, -0.01, 0.27, -0.25, 0.25, -0.55, 0.13, -0.62, phase + 3.4, 1.0);
  leg(0.21, -0.01, 0.22, -0.25, 0.2, -0.55, -0.13, -0.56, phase + 3.85, 0.45);

  // 项圈 + 铃铛
  stroke(buf, px(0.36), py(0.11), px(0.34), py(-0.07), 0.02, 5, 1.6, 0.92, 1);
  pushPoint(buf, px(0.35), py(-0.1), 0, 3.6, 1);

  // 剩下的点：打上"鹿"的标记，支点定在躯干中心，并继承这只鹿的步频相位。
  // 腿上的点（seg > 0）保持自己的相位，绝不覆盖——之前前后腿共用相位就是这么来的。
  const end = buf.positions.length / 3;
  for (let i = deerStart; i < end; i++) {
    buf.deerMask[i] = 1;
    buf.origin[i * 2] = px(0);
    buf.origin[i * 2 + 1] = py(0);
    if (buf.seg[i] === 0) buf.phase[i] = phase;
  }
}

/* ------------------------------------------------------------------ *
 * 圣诞老人：永远正对镜头的立绘
 *
 * 试过三条路：
 *  - 侧面线稿：雪橇绕树飞，转到正对镜头就成了一条线；
 *  - 实体表面撒点：加法混合没有深度遮挡，前后两层叠在一起；而且他在画面里
 *    只有 70px，撒满表面只会糊成一团白烟；
 *  - 3D 线框（正交圆环 + 母线）：从侧面看那些水平环塌成横条，像条形码。
 * 这个尺幅下唯一稳的办法是让画永远正对镜头：点云本身是平面立绘，
 * 着色器每帧按摄像机方位绕他的竖轴转一下。雪橇转多少他都还是那副样子。
 * ------------------------------------------------------------------ */

function buildRigGeometry() {
  const buf = makeBuffers();

  addSleighBody(buf);
  // 两只鹿错开相位，不然像一起抽筋
  const DEER = [
    { ox: 2.05, oy: 0.12, s: 1.15, phase: 0 },
    { ox: 3.55, oy: 0.06, s: 1.06, phase: 2.1 },
  ];
  for (const d of DEER) addDeer(buf, d.ox, d.oy, d.s, d.phase);

  // 缰绳：从车头拉到驯鹿脖子。锚点跟着鹿的缩放走，不然鹿一大就脱开了
  const neck = (d) => [d.ox + 0.36 * d.s, d.oy + 0.08 * d.s];
  for (const side of [-1, 1]) {
    const z = side * 0.26;
    stroke(buf, 1.05, 0.16, neck(DEER[0])[0], neck(DEER[0])[1], z, 14, 1.0, 0.85);
    stroke(buf, DEER[0].ox - 0.42 * DEER[0].s, 0.16, neck(DEER[1])[0], neck(DEER[1])[1], z, 18, 1.0, 0.85);
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
      attribute float aDeer;
      attribute float aSeg;
      attribute vec2 aHip;
      attribute vec2 aKnee;
      attribute float aAmp;
      attribute float aPhase;
      attribute vec2 aOrigin;
      attribute float aBright;
      attribute vec3 aNormal;

      varying float vTint;
      varying float vAlpha;

      // 步频：约 1.7 Hz，再慢就像在飘而不是在跑
      const float GAIT = 10.5;

      vec2 rot(vec2 v, float a) {
        float c = cos(a);
        float s = sin(a);
        return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
      }

      void main() {
        vec3 p = position;


        // 驯鹿跑起来：四腿两步。整根雪橇被 faceForward 转过 90°，
        // 侧影落在 (z, y) 平面上，所以关节也在这个平面里转。
        if (aSeg > 0.5) {
          float ph = uTime * GAIT + aPhase;
          float swing = abs(aAmp);
          float dir = aAmp < 0.0 ? -1.0 : 1.0;
          float hip = sin(ph) * swing;
          // 腿抬起来的那半程才弯膝，落地时是直的
          float bend = max(0.0, sin(ph - 1.0)) * swing * 1.7 * dir;

          vec2 rel = p.zy;
          if (aSeg > 1.5) rel = aKnee + rot(rel - aKnee, bend); // 小腿先绕膝
          rel = aHip + rot(rel - aHip, hip);                    // 再一起绕髋
          p.z = rel.x;
          p.y = rel.y;
        }
        // 整只鹿的二次运动：绕躯干中心俯仰 + 上下颠 + 一点前后涌
        if (aDeer > 0.5) {
          float ph = uTime * GAIT + aPhase;
          vec2 rel = rot(p.zy - aOrigin, sin(ph + 0.9) * 0.075);
          p.z = aOrigin.x + rel.x + sin(ph + 1.4) * 0.022;
          p.y = aOrigin.y + rel.y + sin(ph + 0.6) * 0.034;
        }

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        float twinkle = 0.78 + 0.22 * sin(uTime * 5.0 + position.x * 7.0 + position.y * 4.0);
        gl_PointSize = aSize * uPixelRatio * twinkle * (34.0 / max(1.0, -mv.z));

        // 实体点只留朝向镜头的那半边。没有这一步，加法混合会把球的
        // 前后两层叠在一起，正对镜头时整片糊成白光
        float cull = 1.0;
        if (dot(aNormal, aNormal) > 0.0001) {
          vec3 n = normalize((modelViewMatrix * vec4(aNormal, 0.0)).xyz);
          cull = smoothstep(0.12, -0.1, dot(n, normalize(mv.xyz)));
        }

        vTint = aTint;
        vAlpha = uOpacity * aBright * cull;
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
 * 车里坐的圣诞老人：把一张现成的插画"粒子化"
 *
 * 自己用光点画过三版（线稿、实体表面撒点、3D 线框）都不像——这个尺幅下
 * 手画的形状撑不住。直接贴 SVG 又和整体粒子语汇打架。
 * 所以拿公有领域的 Classic Santa 插画（zeimusu，Openclipart #1545）当底稿：
 * 把它栅格化后按颜色采样像素，再用彩色小光点重新拼出来。
 * 形状来自成熟画稿，材质还是场景里的光点。
 * ------------------------------------------------------------------ */

const SANTA_SRC = './assets/santa.svg';

/**
 * 采样插画，生成点云。
 *
 * 直接按颜色撒点试过：白胡子会糊成一团发光的雾，脸只有 20px，全被吃掉。
 * 关键是这个场景里能认出来的东西都是"线"（驯鹿就是线稿），
 * 所以这里把插画拆成两层：
 *   - 描边：插画的黑轮廓是粗线，整条抽出来画成亮金色，形状全靠它
 *   - 填色：红帽子、肤色按原色，但要压得很暗，只当一层底色
 */
function buildSantaCloud(image) {
  const H = 260;
  const W = Math.max(1, Math.round((H * image.width) / image.height));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;

  const lines = [];
  const fills = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] < 140) continue;
      const sum = data[i] + data[i + 1] + data[i + 2];
      if (sum < 130) lines.push(x, y);
      else fills.push(x, y, data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    }
  }

  const unit = 1.45 / H;
  const positions = [];
  const sizes = [];
  const colors = [];
  const put = (x, y, size, r, g, b) => {
    positions.push(
      (x - W / 2) * unit + rand(-0.004, 0.004),
      (H / 2 - y) * unit + rand(-0.004, 0.004),
      rand(-0.02, 0.02)
    );
    sizes.push(size * rand(0.85, 1.15));
    colors.push(r, g, b);
  };

  // 描边：抽稀到 ~1000 个点，画亮金色
  const lineTotal = lines.length / 2;
  const lineKeep = Math.min(1, 1000 / Math.max(1, lineTotal));
  for (let n = 0; n < lineTotal; n++) {
    if (Math.random() > lineKeep) continue;
    put(lines[n * 2], lines[n * 2 + 1], 0.78, 1.0, 0.85, 0.6);
  }

  // 只补一层红帽子。整张插画都铺色会糊成一团雾，
  // 但"头上一抹红"对认人特别管用，别的颜色都可以不要
  for (let n = 0; n < fills.length / 5; n++) {
    const r = fills[n * 5 + 2];
    const g = fills[n * 5 + 3];
    const b = fills[n * 5 + 4];
    if (r < 0.55 || g > 0.45 || b > 0.45) continue;
    if (Math.random() > 0.35) continue;
    put(fills[n * 5], fills[n * 5 + 1], 0.62, r * 0.55, g * 0.3, b * 0.3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function makeSantaMaterial(pixelRatio) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uPixelRatio: { value: pixelRatio },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uPixelRatio;
      uniform float uOpacity;
      uniform float uTime;

      attribute float aSize;
      attribute vec3 aColor;

      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;

        float twinkle = 0.8 + 0.2 * sin(uTime * 4.0 + position.x * 30.0 + position.y * 21.0);
        gl_PointSize = aSize * uPixelRatio * twinkle * (30.0 / max(1.0, -mv.z));

        vColor = aColor;
        vAlpha = uOpacity * twinkle;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float falloff = smoothstep(0.5, 0.05, d);
        float alpha = falloff * vAlpha;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor, alpha);
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
  const faceTmp = new THREE.Vector3();
  let pixelRatio = 1;

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

  // 车里的人：一张插画粒子化出来的点云，每个点带自己的颜色
  const santaGroup = new THREE.Group();
  santaGroup.position.set(0, 0.5, 0.02);
  rigGroup.add(santaGroup);
  const santaMat = makeSantaMaterial(pixelRatio);
  let santaCloud = null;
  {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      santaCloud = new THREE.Points(buildSantaCloud(img), santaMat);
      santaCloud.frustumCulled = false;
      santaCloud.renderOrder = 9;
      santaGroup.add(santaCloud);
    };
    img.onerror = () => console.warn('圣诞老人的底图没加载出来');
    img.src = SANTA_SRC;
  }

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
        delay: 0.05 + i * 0.038, // 跟在雪橇后面多远：间距拉开，卡片才不叠
        detach: 0.58 + i * 0.05, // 开始往树上送的时刻
        phase: Math.random() * Math.PI * 2,
        // 排成一排：同一时刻、同一条路径、同一个大小，不做左右交替也不加随机倾斜
        tilt: 0,
        size: sizeScale,
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
        // 完全贴着雪橇走过的轨迹，一个跟一个，排成一条线
        group.worldToLocal(cursor);
        item.sprite.position.copy(cursor);
        const shrink = !item.target ? 1 - clamp01((p - item.detach) / 0.12) : 1;
        item.sprite.scale.set(
          Math.max(0.001, item.size * item.aspect * shrink),
          Math.max(0.001, item.size * shrink),
          1
        );
        item.material.rotation = item.tilt;
        item.material.opacity = clamp01((p - item.release) / 0.05) * (shrink > 0.02 ? 1 : 0);
      } else {
        // 送到树上：从脱离点拱一道弧线飞到对应礼物的位置，一边缩小淡出
        const k = clamp01((p - item.detach) / (arrive - item.detach));
        sampleAt(clamp01(item.detach - item.delay), detachAt);
        group.worldToLocal(detachAt);
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
      // 路径点是世界坐标，但这个 Points 挂在已经平移/旋转过的 group 上，
      // 不换算成本地坐标就会被整体再偏移一次（拖尾会斜着飞出去）
      group.worldToLocal(cursor);
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
      santaMat.uniforms.uOpacity.value = alpha;
      santaMat.uniforms.uTime.value = time;
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
      // 下面要把世界坐标换成本地坐标，先把本帧的变换算出来
      group.updateMatrixWorld();

      updateTrail(local);
      updatePhotos(local, time);
    },

    /** 让车里那张立绘正对镜头 */
    faceCamera(camera) {
      if (!running) return;
      faceTmp.copy(camera.position);
      group.worldToLocal(faceTmp);
      santaGroup.rotation.y = Math.atan2(faceTmp.x, faceTmp.z);
    },

    setPixelRatio(value) {
      pixelRatio = value;
      rigMaterial.uniforms.uPixelRatio.value = value;
      santaMat.uniforms.uPixelRatio.value = value;
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
      santaCloud?.geometry.dispose();
      santaMat.dispose();
      group.clear();
    },
  };
}
