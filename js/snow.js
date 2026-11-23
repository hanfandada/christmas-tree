import * as THREE from 'three';
import { PALETTE } from './config.js';

const FIELD_HEIGHT = 17.2; // 雪的垂直循环区间
const FIELD_BASE = -4.3;   // 循环区间底部

/**
 * 飘雪：位置在顶点着色器里算，CPU 每帧只更新一个时间 uniform。
 * 每片雪的初相位、下落速度、尺寸都不同，才不会像"一堵雪墙"。
 */
export function createSnow(count) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);

  const radius = 15;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = Math.random() * FIELD_HEIGHT;
    positions[i * 3 + 2] = Math.sin(angle) * r;

    speeds[i] = 0.45 + Math.random() * 1.15;
    phases[i] = Math.random() * Math.PI * 2;
    sizes[i] = 0.55 + Math.random() * 1.25;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uHeight: { value: FIELD_HEIGHT },
    uBase: { value: FIELD_BASE },
    uColor: { value: new THREE.Color(PALETTE.snow) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uHeight;
      uniform float uBase;

      attribute float aSpeed;
      attribute float aPhase;
      attribute float aSize;

      varying float vAlpha;

      void main() {
        vec3 p = position;

        // 循环下落：mod 保证永远落不完
        float fall = mod(p.y - uTime * aSpeed + 100.0, uHeight);
        p.y = uBase + fall;

        // 横向风偏，两层不同频率叠出"飘"的感觉
        p.x += sin(uTime * 0.34 + aPhase) * 0.6 + sin(uTime * 0.12 + aPhase * 2.1) * 0.9;
        p.z += cos(uTime * 0.27 + aPhase * 1.4) * 0.5;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        float fadeIn = smoothstep(0.0, 2.0, fall);
        float fadeOut = 1.0 - smoothstep(uHeight - 3.2, uHeight, fall);
        vAlpha = fadeIn * fadeOut * (0.34 + 0.26 * sin(uTime * 1.1 + aPhase));

        gl_PointSize = aSize * uPixelRatio * (30.0 / max(1.0, -mv.z));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float falloff = smoothstep(0.5, 0.06, d);
        float alpha = falloff * vAlpha;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 6;

  return {
    points,
    update(time) {
      uniforms.uTime.value = time;
    },
    setPixelRatio(value) {
      uniforms.uPixelRatio.value = value;
    },
    setDrawCount(n) {
      geometry.setDrawRange(0, n);
    },
    setVisible(visible) {
      points.visible = visible;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
