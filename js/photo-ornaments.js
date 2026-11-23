import * as THREE from 'three';
import { PALETTE, TREE } from './config.js';
import { createGlowTexture } from './textures.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_PHOTOS = 60;

/**
 * 照片挂饰：把照片贴成一张圆形发光挂饰，按黄金角螺旋均匀分布在树身上。
 *
 * 数量变化时不重建，而是重算每个挂饰的目标位置并让它平滑滑过去，
 * 所以"加一张照片"是连续的动画，而不是跳一下。
 */
export function createPhotoOrnaments(world) {
  const group = new THREE.Group();
  group.renderOrder = 4;
  world.add(group);

  const glowTexture = createGlowTexture(128);
  const circleGeometry = new THREE.CircleGeometry(1, 56);
  const rimGeometry = new THREE.RingGeometry(1.0, 1.14, 56);

  /** id -> item */
  const items = new Map();
  /** 保持插入顺序，决定从下往上的排列 */
  const order = [];

  function slotFor(index, total) {
    const t = 0.12 + 0.74 * ((index + 0.5) / Math.max(total, 1));
    const angle = index * GOLDEN_ANGLE + 0.35;
    const radius = TREE.baseRadius * Math.pow(1 - t, 0.94) * 1.2;
    return new THREE.Vector3(
      Math.cos(angle) * radius,
      TREE.baseY + t * TREE.height,
      Math.sin(angle) * radius
    );
  }

  /** 照片越多，挂饰越小，避免挤成一团 */
  function radiusFor(total) {
    return THREE.MathUtils.clamp(0.62 * Math.pow(6 / Math.max(total, 1), 0.32), 0.26, 0.55);
  }

  function reflow() {
    const total = order.length;
    const radius = radiusFor(total);
    order.forEach((id, index) => {
      const item = items.get(id);
      item.slot.copy(slotFor(index, total));
      item.targetRadius = radius;
    });
  }

  function add(id, texture, { spawnFrom = null, animate = true } = {}) {
    if (items.has(id) || items.size >= MAX_PHOTOS) return null;

    const itemGroup = new THREE.Group();

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0x8c8c8c, // 压一点亮度，避免照片被泛光糊掉
      toneMapped: false, // 照片保持原本的颜色，不被色调映射压灰
      transparent: true,
    });
    const face = new THREE.Mesh(circleGeometry, material);
    face.userData.photoId = id;
    face.renderOrder = 5; // 排在树体粒子之后，避免被加法混合的光点叠白
    itemGroup.add(face);

    const rimMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: new THREE.Color(PALETTE.ornaments[1]),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.22,
    });
    const halo = new THREE.Sprite(rimMaterial);
    halo.scale.setScalar(2.6);
    halo.renderOrder = 5;
    itemGroup.add(halo);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffd9a0),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(rimGeometry, ringMaterial);
    itemGroup.add(ring);

    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0x05070b,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outline = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.07, 56), outlineMaterial);
    outline.renderOrder = 1;
    itemGroup.add(outline);

    const item = {
      id,
      group: itemGroup,
      face,
      halo,
      ring,
      material,
      ringMaterial,
      outlineMaterial,
      texture,
      slot: new THREE.Vector3(),
      targetRadius: 0.4,
      spawnFrom: spawnFrom ? spawnFrom.clone() : null,
      progress: animate ? 0 : 1,
      phase: Math.random() * Math.PI * 2,
      disposing: false,
    };

    // 初始位置：从相机方向飞入
    itemGroup.position.copy(item.spawnFrom || slotFor(order.length, order.length + 1));
    itemGroup.scale.setScalar(animate ? 0.05 : 1);

    items.set(id, item);
    order.push(id);
    group.add(itemGroup);
    reflow();

    if (!animate) {
      itemGroup.position.copy(item.slot);
      itemGroup.scale.setScalar(item.targetRadius);
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
    item.material.dispose();
    item.ringMaterial.dispose();
    item.outlineMaterial.dispose();
    item.texture.dispose();
    item.halo.material.dispose();
    reflow();
  }

  function clear() {
    for (const id of [...order]) remove(id);
  }

  const cameraLocal = new THREE.Vector3();

  function update(time, dt, cameraWorld) {
    const easeOut = (x) => 1 - Math.pow(1 - x, 3);
    if (cameraWorld && group.parent) {
      cameraLocal.copy(cameraWorld);
      group.parent.worldToLocal(cameraLocal);
    }

    for (const item of items.values()) {
      // 飞入动画
      if (item.progress < 1) {
        item.progress = Math.min(1, item.progress + dt / 0.85);
        const k = easeOut(item.progress);
        if (item.spawnFrom) {
          item.group.position.lerpVectors(item.spawnFrom, item.slot, k);
        } else {
          item.group.position.copy(item.slot);
        }
        item.group.scale.setScalar(0.05 + (item.targetRadius - 0.05) * k);
      } else {
        // 已就位：缓慢滑向新槽位（数量变化时）
        item.group.position.lerp(item.slot, Math.min(1, dt * 2.2));
        const current = item.group.scale.x;
        const next = current + (item.targetRadius - current) * Math.min(1, dt * 3.2);
        item.group.scale.setScalar(next);
      }

      const pulse = 0.5 + 0.5 * Math.sin(time * 1.4 + item.phase);
      item.ringMaterial.opacity = 0.3 + 0.35 * pulse;
      item.halo.material.opacity = 0.12 + 0.18 * pulse;
      item.halo.scale.setScalar(2.2 + pulse * 0.35);

      // 绕 Y 轴朝向相机：像挂在枝头的小吊坠，永远正面对着看的人
      const dx = cameraLocal.x - item.group.position.x;
      const dz = cameraLocal.z - item.group.position.z;
      item.group.rotation.y = Math.atan2(dx, dz);
      item.group.rotation.x = -0.06 + Math.sin(time * 0.7 + item.phase) * 0.05;

      // 转到树背面时淡出：否则会被树体粒子叠成一片白雾
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
      item.material.opacity = visibility;
      item.outlineMaterial.opacity = 0.55 * visibility;
      item.ringMaterial.opacity = (0.3 + 0.35 * pulse) * visibility;
      item.halo.material.opacity = (0.12 + 0.18 * pulse) * visibility;
    }
  }

  function pick(raycaster) {
    // 只拾取当前朝向观众的挂饰，转背面淡出的那些不该被点到
    const faces = [];
    for (const item of items.values()) {
      if (item.group.visible) faces.push(item.face);
    }
    const hits = raycaster.intersectObjects(faces, false);
    if (!hits.length) return null;
    return hits[0].object.userData.photoId || null;
  }

  return {
    group,
    add,
    remove,
    clear,
    update,
    pick,
    get count() {
      return items.size;
    },
    get faces() {
      return [...items.values()].map((item) => item.face);
    },
    get max() {
      return MAX_PHOTOS;
    },
    dispose() {
      clear();
      circleGeometry.dispose();
      rimGeometry.dispose();
      glowTexture.dispose();
    },
  };
}
