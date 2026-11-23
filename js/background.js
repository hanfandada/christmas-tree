import * as THREE from 'three';
import { PALETTE } from './config.js';

/**
 * 远景天幕：一个巨大的反向球体，用着色器画出
 * 上蓝下黑的渐变 + 树后方的一团冷色星云。
 * 用几何体而不是 CSS 渐变，是为了让泛光能吃到它，边缘也更干净。
 */
export function createBackground() {
  const uniforms = {
    uHigh: { value: new THREE.Color(PALETTE.backgroundHigh) },
    uLow: { value: new THREE.Color(PALETTE.backgroundLow) },
    uNebula: { value: new THREE.Color(PALETTE.nebula) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHigh;
      uniform vec3 uLow;
      uniform vec3 uNebula;
      varying vec3 vDir;

      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uLow, uHigh, pow(h, 1.55));

        // 树后方的一团暖冷混合星云，让画面中心有纵深
        vec3 center = normalize(vec3(-0.16, 0.1, -1.0));
        float d = max(dot(vDir, center), 0.0);
        col += uNebula * (pow(d, 2.4) * 0.22 + pow(d, 10.0) * 0.42);

        // 轻微抖动，消除大面积渐变的色带
        float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        col += (noise - 0.5) * 0.006;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(140, 32, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}
