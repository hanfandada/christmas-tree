import * as THREE from 'three';
import { GROUND_Y } from './config.js';
import { createGlowTexture, createGroundGlowTexture } from './textures.js';

/**
 * 地面：一圈向外淡出的暗色雪地 + 树干底部的接触阴影 + 一圈绿色落光。
 * 有了它，树和树干才有"站在地上"的重量，而不是浮在空中。
 */
export function createGround() {
  const group = new THREE.Group();

  const surface = new THREE.Mesh(
    new THREE.CircleGeometry(19, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(0x0d1a26) },
        uEdge: { value: new THREE.Color(0x060c14) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uEdge;
        varying vec2 vUv;

        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float alpha = smoothstep(1.0, 0.28, d) * 0.95;

          // 极轻微的雪面斑驳，避免一整片死灰
          float mottle = 0.88 + 0.12 * sin(vUv.x * 54.0) * sin(vUv.y * 61.0);
          vec3 col = mix(uColor, uEdge, smoothstep(0.15, 0.95, d)) * mottle;

          gl_FragColor = vec4(col, alpha);
        }
      `,
    })
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = GROUND_Y;
  surface.renderOrder = 0;
  group.add(surface);

  // 接触阴影：树干底下压暗一圈，树才像"插"进地里
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const ctx = shadowCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
  gradient.addColorStop(0.45, 'rgba(0, 0, 0, 0.45)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 4.6),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = GROUND_Y + 0.012;
  shadow.renderOrder = 2;
  group.add(shadow);

  // 绿色落光：树裙洒在地上的颜色
  const glowTexture = createGroundGlowTexture(256);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 13),
    new THREE.MeshBasicMaterial({
      map: glowTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.3,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = GROUND_Y + 0.02;
  glow.renderOrder = 1;
  group.add(glow);

  // 薄薄一层积雪的反光：只提亮不遮色，过场下雪时加浓
  const snowTexture = createGlowTexture(256);
  const snowMaterial = new THREE.MeshBasicMaterial({
    map: snowTexture,
    color: 0xa9c8ec,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.12,
  });
  const snowSheen = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), snowMaterial);
  snowSheen.rotation.x = -Math.PI / 2;
  snowSheen.position.y = GROUND_Y + 0.035;
  snowSheen.renderOrder = 3;
  group.add(snowSheen);

  return {
    group,
    /** 0 = 平时的地面积雪，1 = 雪下大了 */
    setSnow(value) {
      snowMaterial.opacity = 0.12 + Math.min(Math.max(value, 0), 1) * 0.2;
    },
    dispose() {
      surface.geometry.dispose();
      surface.material.dispose();
      shadow.geometry.dispose();
      shadow.material.dispose();
      shadowTexture.dispose();
      glow.geometry.dispose();
      glow.material.dispose();
      glowTexture.dispose();
      snowSheen.geometry.dispose();
      snowMaterial.dispose();
      snowTexture.dispose();
    },
  };
}
