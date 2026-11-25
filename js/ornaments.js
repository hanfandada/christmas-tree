import * as THREE from 'three';
import { PALETTE, TREE } from './config.js';
import { createGlowTexture } from './textures.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * 树上的挂饰位。现在放的是发光小球占位，
 * 之后照片挂饰会直接复用这里的 slot 坐标。
 */
export function createOrnaments(count) {
  const group = new THREE.Group();
  const glowTexture = createGlowTexture(128);
  const sphereGeometry = new THREE.IcosahedronGeometry(1, 2);

  const slots = [];
  const items = [];

  for (let i = 0; i < count; i++) {
    // 高度稍微避开树根和树尖，挂饰才落在身体上
    const heightRatio = 0.1 + ((i + 0.5) / count) * 0.78;
    const angle = i * GOLDEN_ANGLE;
    const radius = TREE.baseRadius * Math.pow(1 - heightRatio, 0.94) * 1.07;

    const position = new THREE.Vector3(
      Math.cos(angle) * radius,
      TREE.baseY + heightRatio * TREE.height,
      Math.sin(angle) * radius
    );

    const baseColor = new THREE.Color(PALETTE.ornaments[i % PALETTE.ornaments.length]);
    const size = 0.075 + Math.random() * 0.05;

    const material = new THREE.MeshBasicMaterial({
      color: baseColor.clone().multiplyScalar(1.15),
    });
    const mesh = new THREE.Mesh(sphereGeometry, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(size);

    const haloMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: baseColor,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    const halo = new THREE.Sprite(haloMaterial);
    halo.position.copy(position);
    halo.scale.setScalar(size * 5.2);

    group.add(mesh, halo);

    const item = {
      mesh,
      halo,
      material,
      haloMaterial,
      baseColor,
      phase: Math.random() * Math.PI * 2,
      speed: 0.8 + Math.random() * 1.3,
      origin: position.clone(),
    };
    items.push(item);

    slots.push({
      index: i,
      position: position.clone(),
      heightRatio,
      angle,
      size,
    });
  }

  return {
    group,
    slots,
    /** reveal 控制挂饰随生长动画逐个亮起 */
    update(time, reveal) {
      for (const item of items) {
        const wave = 0.5 + 0.5 * Math.sin(time * item.speed + item.phase);
        const pulse = Math.pow(wave, 2.2);
        const intensity = reveal * (0.35 + 0.95 * pulse);

        // 没亮之前要真的看不见：原来这里有个 0.6 的基础亮度，礼物会先于树叶亮起来
        item.material.color.copy(item.baseColor).multiplyScalar((0.04 + 0.56 * reveal) + intensity * 1.5);
        item.haloMaterial.opacity = intensity * 0.38;

        // 极轻微的上下浮动，像挂在枝头被风带着
        item.halo.position.y = item.origin.y + Math.sin(time * 0.9 + item.phase) * 0.018;
        item.mesh.position.y = item.halo.position.y;
      }
    },
    setVisible(visible) {
      group.visible = visible;
    },
    dispose() {
      sphereGeometry.dispose();
      glowTexture.dispose();
      for (const item of items) {
        item.material.dispose();
        item.haloMaterial.dispose();
      }
    },
  };
}
