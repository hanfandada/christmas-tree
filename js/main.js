import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CAMERA, GROUND_Y, QUALITY, TIMELINE } from './config.js';
import { createBackground } from './background.js';
import { createTree } from './tree.js';
import { createRibbons } from './ribbons.js';
import { createGifts } from './gifts.js';
import { createTreeDecor } from './tree-decor.js';
import { createPlatform } from './platform.js';
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
import { createCompose } from './compose.js';
import { createHeart3D } from './heart3d.js';
import { createMusic, renderPreview } from './audio.js';
import {
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
renderer.toneMappingExposure = 1.02; // 稍微提一点整体亮度，树才不会糊成一片黑

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

// 树上的装饰层：反向的冷白灯串 + 会闪的亮点
const treeDecor = createTreeDecor();
world.add(treeDecor.group);

// 开场：几条从树顶绕下来的发光丝带，把树"带亮"，树亮完就撤走
const ribbons = createRibbons({ reducedMotion });
world.add(ribbons.group);

// 树站的圆台：礼物摆在台面上，底部才收得住
const platform = createPlatform();
world.add(platform.group);

// 树脚下堆的一堆礼物
const gifts = createGifts();
world.add(gifts.group);

const ornaments = createOrnaments(quality.ornaments);
world.add(ornaments.group);

const star = createStar();
world.add(star.group);

const trunk = createTrunk({
  count: Math.round(quality.tree * 0.12),
  reducedMotion,
});
world.add(trunk.group);

const ground = createGround();
scene.add(ground.group);

const snow = createSnow(quality.snow);
scene.add(snow.points);

const bursts = createBurstSystem(scene);

// 屏幕空间的手势反馈：准星、蓄力环、🤟 / 大拇指特效
const gestureFx = createGestureFx();

const photoOrnaments = createPhotoOrnaments(world, {
  onSparkle: (position, strength = 0.32) => bursts.spawn(position, strength),
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

// 🤟：树上的粒子飞出来聚成一颗会自转的立体爱心
const heart3d = createHeart3D({
  count: Math.round(quality.tree * 0.1),
  reducedMotion,
});
world.add(heart3d.group);

// 组合技：整棵树的粒子炸开 → 收拢成 "Merry Christmas"
const compose = createCompose({
  count: Math.round(quality.tree * 0.26),
  reducedMotion,
});
world.add(compose.group);

// 粒子云接管画面时要一起藏起来的真实场景
const sceneObjects = [
  tree.group,
  treeDecor.group,
  platform.group,
  ribbons.group,
  gifts.group,
  ornaments.group,
  star.group,
  trunk.group,
  photoOrnaments.group,
  ground.group,
];
// 爱心不放进上面这个列表：它自己会收 visible，被一起置 true 会留下一层残影
let sceneHidden = false;

/* 像素比同步给所有着色器 */
tree.setPixelRatio(pixelRatio);
treeDecor.setPixelRatio(pixelRatio);
platform.setPixelRatio(pixelRatio);
ribbons.setPixelRatio(pixelRatio);
gifts.setPixelRatio(pixelRatio);
trunk.setPixelRatio(pixelRatio);
snow.setPixelRatio(pixelRatio);
sky.setPixelRatio(pixelRatio);
bursts.setPixelRatio(pixelRatio);
photoOrnaments.setPixelRatio(pixelRatio);
santa.setPixelRatio(pixelRatio);
compose.setPixelRatio(pixelRatio);
heart3d.setPixelRatio(pixelRatio);


/* ---------------- 文案：支持 ?to=名字 定制 ---------------- */

const params = query;
const toWho = params.get('to');
greetingEl.textContent = 'Merry Christmas';
// 平时不显示任何操作提示：画面里全是光点，多一行字就脏了。
// 只有 ?to= 定制的称呼值得单独占一行
if (toWho) {
  subEl.textContent = `To ${toWho}`;
  subEl.hidden = false;
}

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
      // 先让盒盖弹开一点，里面的东西再飞出来
      window.setTimeout(() => openViewer(pickRandomPhoto(), rect, hitId), 380);
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
const viewerDeleteBtn = document.getElementById('viewer-delete');
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

/**
 * 拆礼物：所有礼物盒长得一样，打开什么由"有没有照片"决定——
 * 有照片就随机挑一张，一张都没有就是祝福卡。
 * @param {string|null} photoId 要展示的照片 id（null = 祝福卡）
 * @param {{x:number,y:number,size:number}|null} origin 起飞位置
 * @param {string|null} giftId 哪个盒子被拆了（关的时候要把它盖上）
 */
async function openViewer(photoId, origin = null, giftId = null) {
  const row = photoId ? photoRows.get(photoId) : null;
  const isCard = !row;

  if (viewerUrl) {
    URL.revokeObjectURL(viewerUrl);
    viewerUrl = null;
  }
  if (isCard) {
    viewerImage.src = defaultCardDataUrl();
  } else {
    viewerUrl = URL.createObjectURL(row.blob);
    viewerImage.src = viewerUrl;
  }
  if (!isCard) lastShownPhoto = photoId;
  viewerEl.hidden = false;
  viewerEl.dataset.photoId = isCard ? '' : photoId;
  if (giftId) viewerEl.dataset.giftId = giftId;
  // 祝福卡不是照片，没有"删除"这一说
  if (viewerDeleteBtn) viewerDeleteBtn.hidden = isCard;
  controls.autoRotate = false;

  // 照片按原比例显示，加载完成前尺寸是 0，先解码再量尺寸，飞出动画才不会算错
  try {
    await viewerImage.decode();
  } catch {
    // 解码失败就退化成直接出现
  }

  // 解码期间用户可能已经关掉了
  if (viewerEl.hidden || viewerEl.dataset.giftId !== (giftId || '')) return;

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
  const openGift = viewerEl.dataset.giftId;
  if (openGift) photoOrnaments.setOpen(openGift, false);
  viewerEl.dataset.giftId = '';
  viewerEl.classList.remove('is-open');
  viewerEl.hidden = true;
  viewerEl.dataset.photoId = '';
  viewerImage.removeAttribute('src');
  if (viewerDeleteBtn) viewerDeleteBtn.hidden = false;
  if (viewerUrl) {
    URL.revokeObjectURL(viewerUrl);
    viewerUrl = null;
  }
  controls.autoRotate = !reducedMotion;
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

/** 所有存着的照片（顺序 = 存进来的先后）。礼物盒和照片不再一一绑定 */
function photoList() {
  return [...photoRows.keys()];
}

let lastShownPhoto = null;

/** 拆礼物时随机挑一张照片；只有一张就一直给那一张，多于一张不连着重复 */
function pickRandomPhoto() {
  const ids = photoList();
  if (!ids.length) return null;
  if (ids.length === 1) return ids[0];
  const pool = ids.filter((id) => id !== lastShownPhoto);
  return pool[(Math.random() * pool.length) | 0];
}

/** 把树上最近挂的几张照片画成带金框的贴图卡片（雪橇过场和组合技共用） */
async function buildPhotoCards(limit) {
  const ids = photoList().slice(-limit);
  const cards = [];
  for (const id of ids) {
    const row = photoRows.get(id);
    if (!row) continue;
    try {
      // 走一遍 canvas：ImageBitmap 直接当贴图在部分浏览器里会上下翻，
      // 画到 canvas 上就是标准的 CanvasTexture 行为
      const bitmap = await createImageBitmap(row.blob);
      const canvas = framePhoto(bitmap);
      if (bitmap.close) bitmap.close();

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      cards.push({
        id,
        texture,
        canvas,
        aspect: canvas.width / Math.max(1, canvas.height),
        // 照片不再挂死在某个盒子上，落到树上随便一个盒子的位置
        target: photoOrnaments.getRandomPosition(),
      });
    } catch (error) {
      console.warn('有一张照片没能用上', error);
    }
  }
  return cards;
}

async function playSanta({ force = false } = {}) {
  if (santa.active || santaPending || compose.active) return false;
  if (reducedMotion && !force) return false;
  santaPending = true;
  try {
    const cards = await buildPhotoCards(6);
    const entries = cards.map((card) => ({
      id: card.id,
      texture: card.texture,
      aspect: card.aspect,
      target: card.target,
    }));
    santa.play(entries, elapsed);
    return true;
  } finally {
    santaPending = false;
  }
}

async function addPhotoFromFile(file) {
  if (!file.type.startsWith('image/')) return;
  if (photoRows.size >= photoOrnaments.max) {
    showToast(`最多存 ${photoOrnaments.max} 张照片`);
    return;
  }

  try {
    const photo = await fileToPhotoBlob(file);
    const row = await savePhoto(photo);
    photoRows.set(row.id, row);
    // 照片不再挂死在某个盒子上，所以这里只让一个随机盒子闪一下当作回执
    photoOrnaments.flashRandom();
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
    }
    syncDefaultGifts();
  } catch (error) {
    console.error(error);
  }
}

/* ---------------- 常驻礼物盒 ---------------- */

// 树是 3D 的、还会转，所以礼物盒要保持固定数量绕在锥面上。
// 盒子不绑定照片：拆开时随机抽一张照片，一张都没有就是祝福卡
const DEFAULT_GIFTS = 24;
const GIFT_COLORS = [0xd93a4a, 0xe8a33d, 0x3f7fd6, 0x2fa87a, 0xf06292];

const isDefaultGift = (id) => typeof id === 'string' && id.startsWith('gift-');

function syncDefaultGifts() {
  // 盒子数量固定，跟照片多少无关：每拆一个都是"随机一张照片 / 祝福卡"
  const want = DEFAULT_GIFTS;
  const alive = photoOrnaments.getIds().filter(isDefaultGift);

  for (let i = alive.length; i < want; i++) {
    photoOrnaments.add(
      `gift-${i}`,
      new THREE.Color(GIFT_COLORS[i % GIFT_COLORS.length]),
      { animate: false }
    );
  }
  for (let i = alive.length - 1; i >= want; i--) {
    photoOrnaments.remove(alive[i]);
  }
}

/* ---------------- 默认祝福卡 ---------------- */

syncDefaultGifts();

let defaultCardUrl = null;

/** 没有照片的礼盒拆开是一张卡：深蓝底 + 金框 + 衬线字，不用图片资源 */
function defaultCardDataUrl() {
  if (defaultCardUrl) return defaultCardUrl;

  const w = 900;
  const h = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#16283c');
  bg.addColorStop(0.55, '#0b1522');
  bg.addColorStop(1, '#05090f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 星点
  for (let i = 0; i < 140; i++) {
    const r = Math.random() * 1.6 + 0.4;
    ctx.globalAlpha = 0.15 + Math.random() * 0.55;
    ctx.fillStyle = Math.random() < 0.3 ? '#ffd9a0' : '#dfeaff';
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h * 0.9, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 金色内框
  ctx.strokeStyle = 'rgba(232, 190, 122, 0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(46, 46, w - 92, h - 92);
  ctx.strokeStyle = 'rgba(232, 190, 122, 0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(62, 62, w - 124, h - 124);

  const serif = '"Optima", "Palatino Linotype", Palatino, Georgia, serif';
  ctx.textAlign = 'center';

  const name = (query.get('to') || '').trim();
  if (name) {
    ctx.fillStyle = 'rgba(240, 201, 135, 0.85)';
    ctx.font = `italic 56px ${serif}`;
    ctx.fillText(`To ${name}`, w / 2, h * 0.34);
  }

  ctx.fillStyle = '#fff3dd';
  ctx.font = `94px ${serif}`;
  ctx.fillText('Merry', w / 2, h * 0.48);
  ctx.fillText('Christmas', w / 2, h * 0.585);

  ctx.strokeStyle = 'rgba(232, 190, 122, 0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 90, h * 0.64);
  ctx.lineTo(w / 2 + 90, h * 0.64);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 226, 180, 0.72)';
  ctx.font = `italic 30px ${serif}`;
  ctx.fillText('a gift for you', w / 2, h * 0.7);

  defaultCardUrl = canvas.toDataURL('image/png');
  return defaultCardUrl;
}

/* ---------------- 组合技：粒子炸开 → 拼成 Merry Christmas ---------------- */

const COMBO_WINDOW = 8000; // 炸开之后多久内要再握一拳
const TEXT_HOLD = 4200; // 成字后停留多久自动散掉

let comboTimer = 0;
let composeBusy = false;

async function openCompose() {
  if (compose.active || composeBusy) return false;
  composeBusy = true;
  // 雪橇过场和粒子拼字同时出现会互相打架，先收掉
  santa.stop();
  try {
    const cards = await buildPhotoCards(8);
    const photoList = cards.map((card) => ({
      id: card.id,
      texture: card.texture,
      aspect: card.aspect,
      // 从各自的礼物位置飞出来
      from: card.target ? world.worldToLocal(card.target.clone()) : new THREE.Vector3(),
      sampleCanvas: card.canvas,
    }));

    const ok = compose.open({
      treePositions: tree.getPositions(),
      photoList,
      timer: elapsed,
    });

    if (!ok) {
      for (const card of cards) card.texture.dispose();
      return false;
    }

    clearTimeout(comboTimer);
    comboTimer = window.setTimeout(() => endCompose(), COMBO_WINDOW);
    return true;
  } finally {
    composeBusy = false;
  }
}

function composeToText() {
  if (!compose.active || compose.stage !== 'open') return false;
  compose.setText(elapsed);
  clearTimeout(comboTimer);
  comboTimer = window.setTimeout(() => endCompose(), TEXT_HOLD);
  return true;
}

function endCompose() {
  clearTimeout(comboTimer);
  comboTimer = 0;
  compose.close();
}

compose.onDone(() => {
  // 散回树上之后，把真实场景放出来
  for (const object of sceneObjects) object.visible = true;
  sceneHidden = false;
});

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

viewerDeleteBtn?.addEventListener('click', async () => {
  const id = viewerEl?.dataset.photoId;
  if (!id || isDefaultGift(id)) return;
  closeViewer();
  await removePhoto(id);
  photoRows.delete(id);
  if (lastShownPhoto === id) lastShownPhoto = null;
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeViewer();
});

/* ---------------- 摄像头手势：🤟 我爱你 ---------------- */

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
  // 手部裁剪默认关着（真机上更容易丢手），想试可以先 ?roi=1 打开
  roi: query.get('roi') === '1',
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
        `🤟 伸 ${m.love.extend?.toFixed(2)} 收 ${m.love.curl?.toFixed(2)} 拇 ${m.love.thumbOut?.toFixed(2)} | ` +
        `拇指 out ${m.thumb.thumbOut?.toFixed(2)} rise ${m.thumb.rise?.toFixed(2)} | ` +
        `拳 ${m.fist.maxCurl?.toFixed(2)}/${m.fist.thumbTuck?.toFixed(2)} ` +
        `开 ${m.open.minCurl?.toFixed(2)}/${m.open.thumbOut?.toFixed(2)} | ` +
        `推理 ${handTracker.inferAvg}ms · ROI ${Math.round(handTracker.roiSize * 100)}% | ` +
        `延迟 ${handTracker.latency ?? '-'}ms`
      : '手势 -';
  },
  // 🤟：粒子从树里飞出来聚成 3D 爱心（拼字进行中就不抢戏了）
  onLove: () => {
    if (compose.active) return;
    heart3d.play({ treePositions: tree.getPositions(), time: elapsed });
  },
  onThumb: ({ x, y }) => gestureFx.burst('thumb', x, y),
  onPalm: () => openCompose(),
  onCombo: () => composeToText(),
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
      // 拳头比张开的手难检测，先张手让模型锁定，再握起来跟踪才稳
      showToast('张手让镜头看到你 · 组合技：握拳 → 张开 → 再握拳');
    } else if (gestureMessages[status]) {
      showToast(gestureMessages[status]);
    }
  },
});

gestureToggle?.addEventListener('click', () => handTracker.toggle());

/* ---------------- 背景音乐 ---------------- */

const music = createMusic();
const musicToggle = document.getElementById('music-toggle');
const musicLabel = document.getElementById('music-label');
let musicWanted = false;

function syncMusic() {
  const on = music.playing;
  musicToggle?.setAttribute('aria-pressed', String(on));
  if (musicLabel) musicLabel.textContent = on ? '音乐 · 开' : '音乐';
}

musicToggle?.addEventListener('click', () => {
  musicWanted = !music.playing;
  if (music.playing) music.stop();
  else music.start();
  syncMusic();
});

// 切到后台就停，回来时如果之前是开着的就接着放
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (music.playing) {
      music.stop();
      syncMusic();
    }
  } else if (musicWanted && !music.playing) {
    music.start();
    syncMusic();
  }
});

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
    // 开场动画的时钟：自动化取样要按它对齐，而不是按 wall clock
    get elapsed() {
      return elapsed;
    },
    photoOrnaments,
    openViewer,
    closeViewer,
    viewerEl,
    hand: handTracker,
    gestureFx,
    santa,
    playSanta,
    music,
    musicPreview: renderPreview,
    compose,
    heart3d,
    openCompose,
    composeToText,
    endCompose,
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
  treeDecor.setPixelRatio(pixelRatio);
  platform.setPixelRatio(pixelRatio);
  ribbons.setPixelRatio(pixelRatio);
  gifts.setPixelRatio(pixelRatio);
  trunk.setPixelRatio(pixelRatio);
  snow.setPixelRatio(pixelRatio);
  sky.setPixelRatio(pixelRatio);
  bursts.setPixelRatio(pixelRatio);
  photoOrnaments.setPixelRatio(pixelRatio);
  santa.setPixelRatio(pixelRatio);
  compose.setPixelRatio(pixelRatio);
  heart3d.setPixelRatio(pixelRatio);
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
  // 用线性推进：easeOut 会把前 1/3 的时间冲掉，看上去还是"一下就亮完了"
  tree.setProgress(growRaw);
  treeDecor.setProgress(growRaw);
  treeDecor.update(elapsed);
  platform.setProgress(growRaw);
  platform.update(elapsed);
  ribbons.setProgress(growRaw);
  // 丝带的带头压在树的点亮边界上，返回的强度同时用来加亮那一圈树叶
  const ribbon = ribbons.update(elapsed);
  tree.setRibbonBand(ribbon.head, reducedMotion ? 0 : ribbon.strength);
  trunk.setProgress(growRaw);

  const ornamentReveal = reducedMotion
    ? 1
    : clamp01((elapsed - TIMELINE.stringDelay) / 1.2);

  const starReveal = reducedMotion ? 1 : clamp01((elapsed - TIMELINE.starDelay) / 0.95);

  tree.update(elapsed);
  trunk.update(elapsed);
  ornaments.update(elapsed, ornamentReveal);
  gifts.update(elapsed);
  gifts.setReveal(ornamentReveal);
  star.update(elapsed, starReveal);
  snow.update(elapsed);
  sky.update(elapsed);
  bursts.update(dt);
  photoOrnaments.update(elapsed, dt, camera.position, ornamentReveal);
  santa.update(elapsed, dt);
  santa.faceCamera(camera);
  compose.update(elapsed, dt, camera);
  heart3d.update(elapsed, dt, camera);
  gestureFx.update(elapsed, dt);

  // 粒子云一旦接管画面，就把真实场景收起来（不然会和云叠在一起）
  if (compose.covered !== sceneHidden) {
    sceneHidden = compose.covered;
    for (const object of sceneObjects) object.visible = !sceneHidden;
    heart3d.group.visible = !sceneHidden && heart3d.active;
    // 粒子拼字的时候，把底下那行 DOM 文案收起来，免得同一句话出现两次
    document.body.classList.toggle('is-composing', sceneHidden);
  }

  // 过场期间雪下得更足，结束后慢慢回到平时的细雪
  const snowTarget = santa.active || compose.covered ? 1 : 0;
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
