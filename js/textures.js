import * as THREE from 'three';

/** 生成一张中心亮、边缘透明的径向柔光贴图，给星星和挂饰当光晕 */
export function createGlowTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;

  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0.0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.18, 'rgba(255, 255, 255, 0.7)');
  gradient.addColorStop(0.42, 'rgba(255, 255, 255, 0.22)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.05)');
  gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** 地面光晕用的椭圆径向渐变贴图 */
export function createGroundGlowTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;

  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0.0, 'rgba(150, 255, 210, 0.55)');
  gradient.addColorStop(0.35, 'rgba(90, 220, 170, 0.18)');
  gradient.addColorStop(1.0, 'rgba(40, 120, 100, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
