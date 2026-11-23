import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CAMERA, GROUND_Y, QUALITY, TIMELINE } from './config.js';
import { createBackground } from './background.js';
import { createTree } from './tree.js';
import { createStar } from './star.js';
import { createOrnaments } from './ornaments.js';
import { createSnow } from './snow.js';
import { createSky } from './sky.js';
import { createBurstSystem } from './burst.js';
import { createTrunk } from './trunk.js';
import { createGround } from './ground.js';

const canvas = document.getElementById('scene');
const loader = document.getElementById('loader');
const greetingEl = document.getElementById('greeting');
const subEl = document.getElementById('sub');
const appEl = document.getElementById('app');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- 画质档位 ---------------- */

const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const cores = navigator.hardwareConcurrency || 4;
let qualityName = coarsePointer || cores <= 4 ? 'medium' : 'high';
if (window.innerWidth < 760) qualityName = 'medium';
let quality = QUALITY[qualityName];

/* ---------------- 渲染器 ---------------- */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
} catch (error) {
  fallback('你的浏览器或显卡暂时不支持 WebGL，看不到这棵树。');
  throw error;
}

let pixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatio);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  CAMERA.fov,
  window.innerWidth / window.innerHeight,
  CAMERA.near,
  CAMERA.far
);
camera.position.set(...CAMERA.position);

const controls = new OrbitControls(camera, canvas);
controls.target.set(...CAMERA.target);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.enablePan = false;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.65;
controls.minPolarAngle = 0.62;
controls.maxPolarAngle = 1.72;
controls.minDistance = CAMERA.minDistance;
controls.maxDistance = CAMERA.maxDistance;
controls.autoRotate = !reducedMotion;
controls.autoRotateSpeed = 0.3;

/* ---------------- 后期：泛光是"发光感"的关键 ---------------- */

const composer = new EffectComposer(renderer);
composer.setPixelRatio(pixelRatio);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.5, // strength
  0.5, // radius
  0.34 // threshold
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

let useBloom = quality.bloom;

/* ---------------- 场景内容 ---------------- */

const background = createBackground();
scene.add(background);

const sky = createSky(quality.sky);
scene.add(sky.group);

const world = new THREE.Group();
scene.add(world);

const tree = createTree(quality.tree);
world.add(tree.group);

const ornaments = createOrnaments(quality.ornaments);
world.add(ornaments.group);

const star = createStar();
world.add(star.group);

const trunk = createTrunk();
world.add(trunk.group);

const ground = createGround();
scene.add(ground.group);

const snow = createSnow(quality.snow);
scene.add(snow.points);

const bursts = createBurstSystem(scene);

/* 像素比同步给所有着色器 */
tree.setPixelRatio(pixelRatio);
trunk.setPixelRatio(pixelRatio);
snow.setPixelRatio(pixelRatio);
sky.setPixelRatio(pixelRatio);
bursts.setPixelRatio(pixelRatio);


/* ---------------- 文案：支持 ?to=名字 定制 ---------------- */

const params = new URLSearchParams(window.location.search);
const toWho = params.get('to');
const gestureHint = coarsePointer
  ? '拖拽旋转 · 双指缩放 · 轻点撒一把星火'
  : '拖拽旋转 · 滚轮缩放 · 点击撒一把星火';
greetingEl.textContent = 'Merry Christmas';
subEl.textContent = toWho ? `To ${toWho} · ${gestureHint}` : gestureHint;

/* ---------------- 指针：视差与点击星火 ---------------- */

const pointer = new THREE.Vector2();
const pointerTarget = new THREE.Vector2();
let pointerDownAt = null;
let pointerMoved = false;

window.addEventListener(
  'pointermove',
  (event) => {
    pointerTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointerTarget.y = (event.clientY / window.innerHeight) * 2 - 1;

    if (pointerDownAt) {
      const dx = event.clientX - pointerDownAt.x;
      const dy = event.clientY - pointerDownAt.y;
      if (Math.hypot(dx, dy) > 8) pointerMoved = true;
    }
  },
  { passive: true }
);

canvas.addEventListener('pointerdown', (event) => {
  pointerDownAt = { x: event.clientX, y: event.clientY };
  pointerMoved = false;
});

canvas.addEventListener('pointerup', (event) => {
  if (pointerDownAt && !pointerMoved) {
    const ndc = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );
    const worldPoint = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera);
    const direction = worldPoint.sub(camera.position).normalize();
    const origin = camera.position.clone().addScaledVector(direction, 9.5);
    bursts.spawn(origin, 0.95);
  }
  pointerDownAt = null;
});

/* ---------------- 尺寸与构图 ---------------- */

function layout() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;

  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
  composer.setSize(width, height);
  bloomPass.setSize(width, height);

  // 竖屏时整体缩小，保证整棵树完整入镜
  const isPortrait = aspect < 0.82;
  const scale = isPortrait ? 0.78 : aspect < 1.05 ? 0.9 : 1;
  world.scale.setScalar(scale);
  ground.group.scale.setScalar(scale);
}

window.addEventListener('resize', layout);
layout();

/* ---------------- 开场时序 ---------------- */

const startedAt = performance.now();
let lastFrameAt = startedAt;
let elapsed = 0;
let hudShown = false;
let firstFrame = true;

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

/* ---------------- 帧率监测与自动降级 ---------------- */

let frameCount = 0;
let fpsWindow = 0;
let degraded = false;

function degrade() {
  qualityName = 'low';
  tree.setDrawCount(Math.round(quality.tree * 0.5));
  snow.setDrawCount(Math.round(quality.snow * 0.45));
  sky.setDrawCount(Math.round(quality.sky * 0.5));
  useBloom = false;
  pixelRatio = 1;
  renderer.setPixelRatio(pixelRatio);
  composer.setPixelRatio(pixelRatio);
  tree.setPixelRatio(pixelRatio);
  trunk.setPixelRatio(pixelRatio);
  snow.setPixelRatio(pixelRatio);
  sky.setPixelRatio(pixelRatio);
  bursts.setPixelRatio(pixelRatio);
}

function fallback(message) {
  if (loader) loader.classList.add('is-hidden');
  const note = document.createElement('p');
  note.className = 'noscript';
  note.textContent = message;
  appEl.appendChild(note);
}

/* ---------------- 主循环 ---------------- */

function animate() {
  requestAnimationFrame(animate);

  // 用真实墙钟推进开场动画：掉帧的设备上也能按时序点亮完
  const now = performance.now();
  const dt = Math.min((now - lastFrameAt) / 1000, 0.05);
  lastFrameAt = now;
  elapsed = (now - startedAt) / 1000;

  controls.update(dt);

  // 生长动画：树的进度、灯串、挂饰、星星依次点亮
  const growRaw = reducedMotion
    ? 1
    : clamp01((elapsed - TIMELINE.growDelay) / TIMELINE.growDuration);
  tree.setProgress(easeOutCubic(growRaw));

  const ornamentReveal = reducedMotion
    ? 1
    : clamp01((elapsed - TIMELINE.stringDelay) / 1.5);

  const starReveal = reducedMotion ? 1 : clamp01((elapsed - TIMELINE.starDelay) / 0.95);

  tree.update(elapsed);
  trunk.update(elapsed);
  ornaments.update(elapsed, ornamentReveal);
  star.update(elapsed, starReveal);
  snow.update(elapsed);
  sky.update(elapsed);
  bursts.update(dt);

  // 鼠标视差：树随指针轻微偏转，幅度必须小，否则会晕
  pointer.lerp(pointerTarget, 1 - Math.pow(0.0015, dt));
  world.rotation.y = pointer.x * 0.05;
  world.rotation.x = pointer.y * 0.022 + Math.sin(elapsed * 0.25) * 0.004;

  if (useBloom) composer.render();
  else renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    requestAnimationFrame(() => loader.classList.add('is-hidden'));
  }

  if (!hudShown && elapsed > TIMELINE.hudDelay) {
    hudShown = true;
    document.body.classList.add('is-ready');
  }

  // 连续掉帧就自动降一档，不让用户自己去翻设置
  frameCount += 1;
  fpsWindow += dt;
  if (fpsWindow >= 2) {
    const fps = frameCount / fpsWindow;
    if (!degraded && elapsed > 5 && fps < 44 && qualityName !== 'low') {
      degraded = true;
      degrade();
    }
    frameCount = 0;
    fpsWindow = 0;
  }
}

animate();
