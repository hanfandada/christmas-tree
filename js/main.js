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
import { createPhotoOrnaments } from './photo-ornaments.js';
import { createHandTracker } from './hand.js';
import { createGestureFx } from './gesture-fx.js';
import { createSanta } from './santa.js';
import {
  blobToAverageColor,
  fileToPhotoBlob,
  listPhotos,
  removePhoto,
  savePhoto,
} from './photos.js';

const canvas = document.getElementById('scene');
const loader = document.getElementById('loader');
const greetingEl = document.getElementById('greeting');
const subEl = document.getElementById('sub');
const appEl = document.getElementById('app');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ?quality=high|medium|low 可强制画质档位；强制后不再自动降级（截图和演示用）
const query = new URLSearchParams(window.location.search);
const forcedQuality = query.get('quality');
const allowAutoDegrade = !forcedQuality;

/* ---------------- 画质档位 ---------------- */

const coarsePointer =
  window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 760;
const cores = navigator.hardwareConcurrency || 4;
let qualityName = coarsePointer || cores <= 4 ? 'medium' : 'high';
if (window.innerWidth < 760) qualityName = 'medium';
if (forcedQuality && QUALITY[forcedQuality]) qualityName = forcedQuality;
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
  0.42, // radius
  0.45 // threshold
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

// 屏幕空间的手势反馈：准星、蓄力环、比心 / 大拇指特效
const gestureFx = createGestureFx();

const photoOrnaments = createPhotoOrnaments(world, {
  onSparkle: (position) => bursts.spawn(position, 0.32),
});

// 过场：圣诞老人雪橇拖着照片绕树下降
const santa = createSanta({
  onFinish: () => {
    snow.setIntensity(0.32);
    ground.setSnow(0);
  },
  // 照片落到礼物上的那一下，给一簇星火
  onPhotoLand: (position) => bursts.spawn(position, 1.1),
});
world.add(santa.group);

/* 像素比同步给所有着色器 */
tree.setPixelRatio(pixelRatio);
trunk.setPixelRatio(pixelRatio);
snow.setPixelRatio(pixelRatio);
sky.setPixelRatio(pixelRatio);
bursts.setPixelRatio(pixelRatio);
photoOrnaments.setPixelRatio(pixelRatio);
santa.setPixelRatio(pixelRatio);


/* ---------------- 文案：支持 ?to=名字 定制 ---------------- */

const params = query;
const toWho = params.get('to');
const gestureHint = coarsePointer
  ? '拖拽旋转 · 双指缩放 · 轻点礼物拆开'
  : '点击礼物拆开 · 拖入照片挂上树 · 点星星再看一遍雪橇';
greetingEl.textContent = 'Merry Christmas';
subEl.textContent = toWho ? `To ${toWho} · ${gestureHint}` : gestureHint;

/* ---------------- 指针：视差与点击星火 ---------------- */

const pointer = new THREE.Vector2();
const pointerTarget = new THREE.Vector2();
let pointerDownAt = null;
let pointerMoved = false;
let hoverCheckAt = 0;
const hoverNdc = new THREE.Vector2();

window.addEventListener(
  'pointermove',
  (event) => {
    pointerTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointerTarget.y = (event.clientY / window.innerHeight) * 2 - 1;

    if (pointerDownAt) {
      const dx = event.clientX - pointerDownAt.x;
      const dy = event.clientY - pointerDownAt.y;
      if (Math.hypot(dx, dy) > 8) pointerMoved = true;
    } else {
      // 悬停探测：成本很低，但仍节流到约 60ms 一次
      const now = performance.now();
      if (now - hoverCheckAt > 60) {
        hoverCheckAt = now;
        hoverNdc.set(
          (event.clientX / window.innerWidth) * 2 - 1,
          -(event.clientY / window.innerHeight) * 2 + 1
        );
        raycaster.setFromCamera(hoverNdc, camera);
        const hovered = photoOrnaments.pick(raycaster);
        photoOrnaments.setHover(hovered);
        canvas.classList.toggle('is-pointing', Boolean(hovered));
      }
    }
  },
  { passive: true }
);

canvas.addEventListener('pointerdown', (event) => {
  pointerDownAt = { x: event.clientX, y: event.clientY };
  pointerMoved = false;
});

canvas.addEventListener('pointerleave', () => {
  photoOrnaments.setHover(null);
  canvas.classList.remove('is-pointing');
});

canvas.addEventListener('pointerup', (event) => {
  if (pointerDownAt && !pointerMoved) {
    const ndc = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);

    // 点树顶星：重播一遍雪橇过场
    if (raycaster.intersectObject(star.group, true).length) {
      playSanta({ force: true });
      pointerDownAt = null;
      return;
    }

    const hitId = photoOrnaments.pick(raycaster);

    if (hitId) {
      const rect = photoOrnaments.getScreenRect(
        hitId,
        camera,
        window.innerWidth,
        window.innerHeight
      );
      const worldPosition = photoOrnaments.getPosition(hitId);
      photoOrnaments.setOpen(hitId, true);
      if (worldPosition) {
        bursts.spawn(worldPosition, 1.5);
        window.setTimeout(() => {
          const again = photoOrnaments.getPosition(hitId);
          if (again) bursts.spawn(again, 1.0);
        }, 150);
      }
      photoOrnaments.setHover(null);
      canvas.classList.remove('is-pointing');
      // 先让盒盖弹开一点，照片再飞出来
      window.setTimeout(() => openViewer(hitId, rect), 380);
    } else {
      const worldPoint = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera);
      const direction = worldPoint.sub(camera.position).normalize();
      const origin = camera.position.clone().addScaledVector(direction, 9.5);
      bursts.spawn(origin, 0.95);
    }
  }
  pointerDownAt = null;
});


/* ---------------- 照片：上传、挂树、查看、删除 ---------------- */

const photoRows = new Map();
const raycaster = new THREE.Raycaster();
const viewerEl = document.getElementById('viewer');
const viewerImage = document.getElementById('viewer-image');
const viewerBackdropEl = viewerEl?.querySelector('[data-close]');
const toastEl = document.getElementById('toast');

let viewerUrl = null;
let toastTimer = 0;

function showToast(text) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2600);
}

async function openViewer(id, origin = null) {
  const row = photoRows.get(id);
  if (!row) return;
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = URL.createObjectURL(row.blob);
  viewerImage.src = viewerUrl;
  viewerEl.hidden = false;
  viewerEl.dataset.photoId = id;
  controls.autoRotate = false;

  // 照片按原比例显示，加载完成前尺寸是 0，先解码再量尺寸，飞出动画才不会算错
  try {
    await viewerImage.decode();
  } catch {
    // 解码失败就退化成直接出现
  }

  // 解码期间用户可能已经关掉了
  if (viewerEl.hidden || viewerEl.dataset.photoId !== id) return;

  requestAnimationFrame(() => {
    viewerEl.classList.add('is-open');

    // 照片从礼物盒的位置飞出来、放大到卡片尺寸
    if (origin && !reducedMotion) {
      const rect = viewerImage.getBoundingClientRect();
      const dx = origin.x - (rect.left + rect.width / 2);
      const dy = origin.y - (rect.top + rect.height / 2);
      const scale = Math.max(0.04, origin.size / Math.max(1, rect.width));

      viewerImage.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.35 },
          { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        ],
        { duration: 780, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
      viewerBackdropEl?.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 420,
        easing: 'ease-out',
      });
    }
  });
}

function closeViewer() {
  if (!viewerEl) return;
  const openId = viewerEl.dataset.photoId;
  if (openId) photoOrnaments.setOpen(openId, false);
  viewerEl.classList.remove('is-open');
  viewerEl.hidden = true;
  viewerEl.dataset.photoId = '';
  viewerImage.removeAttribute('src');
  if (viewerUrl) {
    URL.revokeObjectURL(viewerUrl);
    viewerUrl = null;
  }
  controls.autoRotate = !reducedMotion;
}

/* 手势：握拳 → 张开，照片从掌心飞出来 */

let lastPoppedId = null;

/** 树上确实有原始数据的照片（顺序 = 挂上树的先后） */
function photosOnTree() {
  return photoOrnaments.getIds().filter((id) => photoRows.has(id));
}

function popPhotoFromHand(x, y) {
  gestureFx.burst('pulse', x, y);

  // 查看器开着的时候，同一个手势用来把它收回去
  if (!viewerEl.hidden) {
    closeViewer();
    return;
  }

  const ids = photosOnTree();
  if (!ids.length) {
    showToast('先挂一张照片，握拳再张开，它就会从手里飞出来');
    return;
  }

  // 刚挂上树的优先，但别连着两次弹同一张
  let id = ids[ids.length - 1];
  if (id === lastPoppedId && ids.length > 1) id = ids[ids.length - 2];
  lastPoppedId = id;

  const worldPosition = photoOrnaments.getPosition(id);
  photoOrnaments.setHover(null);
  photoOrnaments.setOpen(id, true);
  if (worldPosition) {
    bursts.spawn(worldPosition, 1.5);
    window.setTimeout(() => {
      const again = photoOrnaments.getPosition(id);
      if (again) bursts.spawn(again, 0.9);
    }, 150);
  }
  // 让盒盖先弹开一点，照片再从掌心飞出来放大
  window.setTimeout(() => openViewer(id, { x, y, size: 96 }), 320);
}

/* ---------------- 过场：圣诞老人雪橇 ---------------- */

const forceSanta = query.get('santa') === '1';
let santaPending = false;

/**
 * 把照片画进一张带金色发光边框的画布。
 *
 * 加边框不是为了好看：夜空是黑的、照片本身可能也是暗的，纯图贴上去直接消失。
 * 一圈发光的边能在任何背景下勾出照片的轮廓，也顺手有了拍立得的味道。
 */
function framePhoto(bitmap) {
  // 照片在屏幕上最多百来像素，贴图不需要原尺寸：长边压到 640，省显存也省上传时间
  const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const pad = Math.max(10, Math.round(Math.min(width, height) * 0.075));
  const canvas = document.createElement('canvas');
  canvas.width = width + pad * 2;
  canvas.height = height + pad * 2;
  const ctx = canvas.getContext('2d');

  ctx.drawImage(bitmap, pad, pad, width, height);

  const stroke = Math.max(3, pad * 0.42);
  const inset = stroke / 2 + pad * 0.12;
  const radius = Math.max(4, pad * 0.5);

  ctx.save();
  ctx.lineWidth = stroke;
  ctx.strokeStyle = 'rgba(255, 222, 164, 0.96)';
  ctx.shadowColor = 'rgba(255, 186, 104, 0.95)';
  ctx.shadowBlur = pad * 1.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2, radius);
  } else {
    ctx.rect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2);
  }
  ctx.stroke();
  ctx.restore();

  return canvas;
}

/** 把树上最近挂的几张照片转成贴图，跟着雪橇飞一圈再送回树上 */
async function buildSantaPhotos() {
  const ids = photosOnTree().slice(-6);
  const entries = [];
  for (const id of ids) {
    const row = photoRows.get(id);
    if (!row) continue;
    try {
      // 走一遍 canvas：ImageBitmap 直接当贴图在部分浏览器里会上下翻，
      // 画到 canvas 上就是标准的 CanvasTexture 行为
      const bitmap = await createImageBitmap(row.blob);
      const surface = framePhoto(bitmap);
      if (bitmap.close) bitmap.close();

      const texture = new THREE.CanvasTexture(surface);
      texture.colorSpace = THREE.SRGBColorSpace;
      entries.push({
        id,
        texture,
        aspect: surface.width / Math.max(1, surface.height),
        target: photoOrnaments.getPosition(id),
      });
    } catch (error) {
      console.warn('有一张照片没能跟上雪橇', error);
    }
  }
  return entries;
}

async function playSanta({ force = false } = {}) {
  if (santa.active || santaPending) return false;
  if (reducedMotion && !force) return false;
  santaPending = true;
  try {
    const entries = await buildSantaPhotos();
    santa.play(entries, elapsed);
    showToast(entries.length ? `圣诞老人送回了 ${entries.length} 张照片` : '圣诞老人从树上飞过去了');
    return true;
  } finally {
    santaPending = false;
  }
}

async function addPhotoFromFile(file) {
  if (!file.type.startsWith('image/')) return;
  if (photoOrnaments.count >= photoOrnaments.max) {
    showToast(`树上最多挂 ${photoOrnaments.max} 张照片`);
    return;
  }

  try {
    const photo = await fileToPhotoBlob(file);
    const row = await savePhoto(photo);
    const color = await blobToAverageColor(photo);
    photoRows.set(row.id, row);
    photoOrnaments.add(row.id, color, {
      spawnFrom: camera.position.clone(),
      animate: !reducedMotion,
    });
  } catch (error) {
    console.error(error);
    showToast('这张照片没能挂上去，换一张试试');
  }
}

async function hydratePhotos() {
  try {
    const rows = await listPhotos();
    for (const row of rows) {
      photoRows.set(row.id, row);
      const color = await blobToAverageColor(row.blob);
      photoOrnaments.add(row.id, color, { animate: false });
    }
    if (rows.length) showToast(`树上有 ${rows.length} 张照片`);
  } catch (error) {
    console.error(error);
  }
}

const addButton = document.getElementById('add-photo');
const fileInput = document.getElementById('photo-input');

addButton?.addEventListener('click', () => fileInput?.click());

fileInput?.addEventListener('change', async () => {
  const files = [...(fileInput.files || [])];
  fileInput.value = '';
  for (const file of files) await addPhotoFromFile(file);
});

let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  document.body.classList.add('is-dragging');
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('is-dragging');
});
window.addEventListener('drop', async (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('is-dragging');
  const files = [...(event.dataTransfer?.files || [])];
  for (const file of files) await addPhotoFromFile(file);
});

document.getElementById('viewer-close')?.addEventListener('click', closeViewer);
viewerEl?.querySelector('[data-close]')?.addEventListener('click', closeViewer);

document.getElementById('viewer-delete')?.addEventListener('click', async () => {
  const id = viewerEl?.dataset.photoId;
  if (!id) return;
  closeViewer();
  await removePhoto(id);
  photoRows.delete(id);
  photoOrnaments.remove(id);
  showToast('已经从树上取下来了');
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeViewer();
});

/* ---------------- 摄像头手势：比心 ---------------- */

const gestureVideo = document.getElementById('gesture-video');
const gestureToggle = document.getElementById('gesture-toggle');
const gestureLabel = document.getElementById('gesture-label');
const gesturePreviewToggle = document.getElementById('gesture-preview-toggle');
const PREVIEW_KEY = 'xmas-gesture-preview';

let previewOn = false;
try {
  previewOn = localStorage.getItem(PREVIEW_KEY) === '1';
} catch {
  previewOn = false;
}

const GESTURE_USED_KEY = 'xmas-gesture-used';

const gestureMessages = {
  'no-api': '浏览器不给用摄像头，需要 https 或 localhost',
  denied: '摄像头权限被拒了，在地址栏允许后再点一次',
  'no-camera': '没找到可用的摄像头',
  nosimd: '浏览器版本太旧，跑不动手势识别',
  failed: '手势模型没加载成功，检查网络再试',
};

function syncPreview(running) {
  document.body.classList.toggle('is-gesture-preview', running && previewOn);
  gesturePreviewToggle?.setAttribute('aria-pressed', String(previewOn));
}

// ?debug=1 时右下角给个数值面板，方便判断是"没识别到手"还是"识别到了但姿势不对"
let gestureDebugEl = null;
if (query.get('debug') === '1') {
  gestureDebugEl = document.createElement('div');
  gestureDebugEl.className = 'gesture-debug';
  gestureDebugEl.hidden = true;
  document.body.appendChild(gestureDebugEl);
}

const handTracker = createHandTracker({
  video: gestureVideo,
  onTrack: (state) => {
    gestureFx.track(state);
    if (!gestureDebugEl) return;
    if (!state || !state.present) {
      gestureDebugEl.hidden = true;
      return;
    }
    const m = state.metrics;
    gestureDebugEl.hidden = false;
    gestureDebugEl.textContent = m
      ? `手势 ${state.kind || '-'} ${Math.round((state.progress || 0) * 100)}% | ` +
        `心 gap ${m.heart.tipGap?.toFixed(2)} curl ${m.heart.curled?.toFixed(2)} | ` +
        `拇指 out ${m.thumb.thumbOut?.toFixed(2)} rise ${m.thumb.rise?.toFixed(2)} | ` +
        `拳 ${m.fist.maxCurl?.toFixed(2)}/${m.fist.thumbTuck?.toFixed(2)} ` +
        `开 ${m.open.minCurl?.toFixed(2)}/${m.open.thumbOut?.toFixed(2)} | ` +
        `延迟 ${handTracker.latency ?? '-'}ms`
      : '手势 -';
  },
  onHeart: ({ x, y }) => gestureFx.burst('heart', x, y),
  onThumb: ({ x, y }) => gestureFx.burst('thumb', x, y),
  onPalm: ({ x, y }) => popPhotoFromHand(x, y),
  onStatus: (status) => {
    const busy = status === 'loading';
    // 加载中也可以再点一次取消
    if (gestureToggle) {
      gestureToggle.setAttribute('aria-pressed', String(status === 'running'));
    }
    if (gestureLabel) {
      gestureLabel.textContent =
        busy ? '准备中…' : status === 'running' ? '手势 · 开' : '手势';
    }
    if (gesturePreviewToggle) gesturePreviewToggle.hidden = status !== 'running';
    syncPreview(status === 'running');

    if (status === 'running') {
      try {
        localStorage.setItem(GESTURE_USED_KEY, '1');
      } catch {
        // 隐私模式存不了，最多下次多等一会儿
      }
      showToast('比心、竖大拇指，或者握拳再张开');
    } else if (gestureMessages[status]) {
      showToast(gestureMessages[status]);
    }
  },
});

gestureToggle?.addEventListener('click', () => handTracker.toggle());

// 预热：鼠标移到按钮上、或用过手势的人空闲时，先把模型拉下来
let prewarmStarted = false;

function prewarmGesture() {
  if (prewarmStarted || handTracker.running) return;
  prewarmStarted = true;
  handTracker.prewarm();
}

gestureToggle?.addEventListener('pointerenter', prewarmGesture, { once: true });
gestureToggle?.addEventListener('focus', prewarmGesture, { once: true });

try {
  if (localStorage.getItem(GESTURE_USED_KEY) === '1') {
    const idle = window.requestIdleCallback || ((cb) => window.setTimeout(cb, 2500));
    idle(() => prewarmGesture(), { timeout: 4000 });
  }
} catch {
  // 读不到 localStorage 就只在悬停时预热
}

gesturePreviewToggle?.addEventListener('click', () => {
  previewOn = !previewOn;
  try {
    localStorage.setItem(PREVIEW_KEY, previewOn ? '1' : '0');
  } catch {
    // 隐私模式下存不了，只影响下次是否记住
  }
  syncPreview(handTracker.running);
});

hydratePhotos().then(() => {
  // 照片挂好后过一会儿自动放一遍过场；?santa=1 直接提前播
  window.setTimeout(() => playSanta({ force: forceSanta }), forceSanta ? 1200 : 6000);
});

// 调试钩子：只在 ?debug=1 时暴露，方便自动化测试定位挂饰
if (query.get('debug') === '1') {
  window.__xmas = {
    THREE,
    camera,
    photoOrnaments,
    openViewer,
    closeViewer,
    viewerEl,
    hand: handTracker,
    gestureFx,
    popPhotoFromHand,
    santa,
    playSanta,
    scene,
    renderer,
    controls,
  };
}

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
  gestureFx.setViewport(width, height, pixelRatio);

  // 竖屏时整体缩小，保证整棵树完整入镜
  const isPortrait = aspect < 0.82;
  const scale = isPortrait ? 0.78 : aspect < 1.05 ? 0.9 : 1;
  world.scale.setScalar(scale);
  ground.group.scale.setScalar(scale);

  // 雪橇路径横跨 ±6.8，窄屏按画面宽度压扁一点，别飞出画外
  const halfWidth = Math.tan((CAMERA.fov * Math.PI) / 360) * CAMERA.position[2] * aspect;
  santa.setHorizontalScale((halfWidth * 0.9) / (6.8 * scale));
}

window.addEventListener('resize', layout);
layout();

/* ---------------- 开场时序 ---------------- */

const startedAt = performance.now();
let lastFrameAt = startedAt;
let elapsed = 0;
let hudShown = false;
let firstFrame = true;
let snowBoost = 0;

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
  photoOrnaments.setPixelRatio(pixelRatio);
  santa.setPixelRatio(pixelRatio);
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
  photoOrnaments.update(elapsed, dt, camera.position);
  santa.update(elapsed, dt);
  gestureFx.update(elapsed, dt);

  // 过场期间雪下得更足，结束后慢慢回到平时的细雪
  const snowTarget = santa.active ? 1 : 0;
  snowBoost += (snowTarget - snowBoost) * Math.min(1, dt * 1.6);
  snow.setIntensity(0.32 + snowBoost * 0.68);
  ground.setSnow(snowBoost);

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
    if (allowAutoDegrade && !degraded && elapsed > 5 && fps < 44 && qualityName !== 'low') {
      degraded = true;
      degrade();
    }
    frameCount = 0;
    fpsWindow = 0;
  }
}

animate();
