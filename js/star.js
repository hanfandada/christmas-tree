import * as THREE from 'three';
import { PALETTE, TREE } from './config.js';
import { createGlowTexture } from './textures.js';

/**
 * 树顶星：一个缓慢自转的立体五角星 + 一张始终面向相机的光晕。
 * 光晕是"亮"的来源，星星本体是"形状"的来源，两者叠起来才有分量。
 */
export function createStar() {
  const outer = 0.68;
  const inner = 0.245;
  const tips = 5;

  const shape = new THREE.Shape();
  for (let i = 0; i < tips * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i / (tips * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.035,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geometry.center();

  const starColor = new THREE.Color(PALETTE.star).multiplyScalar(1.05);
  const material = new THREE.MeshBasicMaterial({
    color: starColor,
    toneMapped: true,
  });

  const mesh = new THREE.Mesh(geometry, material);

  const glowTexture = createGlowTexture(256);
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: new THREE.Color(PALETTE.starGlow),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0.0,
  });
  const halo = new THREE.Sprite(glowMaterial);
  halo.scale.setScalar(3.6);

  const group = new THREE.Group();
  group.add(mesh, halo);
  group.position.set(0, TREE.baseY + TREE.height + 0.42, 0);

  const baseScale = 1;

  return {
    group,
    update(time, reveal) {
      // reveal: 0→1，星星亮起时有一个轻微"弹一下"
      const pop = reveal < 1 ? 0.75 + 0.25 * reveal + Math.sin(reveal * Math.PI) * 0.12 : 1;
      const flicker = 0.92 + 0.08 * Math.sin(time * 2.3) + 0.03 * Math.sin(time * 7.1);
      const scale = baseScale * pop * flicker;

      // 只做小幅摆动，不做整圈自转：否则会转到侧面变成一条竖线
      mesh.rotation.y = Math.sin(time * 0.45) * 0.42;
      mesh.rotation.x = Math.sin(time * 0.31) * 0.1;
      mesh.rotation.z = Math.sin(time * 0.4) * 0.05;
      mesh.scale.setScalar(scale);
      mesh.visible = reveal > 0.001;

      halo.visible = reveal > 0.001;
      halo.scale.setScalar(3.6 * pop * (0.85 + 0.15 * Math.sin(time * 1.7)));
      glowMaterial.opacity = 0.32 * reveal;
    },
    setVisible(visible) {
      group.visible = visible;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      glowTexture.dispose();
      glowMaterial.dispose();
    },
  };
}
