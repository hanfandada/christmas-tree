import * as THREE from 'three';
import { PALETTE } from './config.js';

const FIELD_HEIGHT = 17.2; // 雪的垂直循环区间
const FIELD_BASE = -4.3; // 循环区间底部

/**
 * 飘雪：位置在顶点着色器里算，CPU 每帧只更新几个 uniform。
 * 每片雪的初相位、下落速度、尺寸都不同，才不会像"一堵雪墙"。
 *
 * 分两层：
 *  - 远景细雪（far）：数量多、个头小，负责整片天空的密度
 *  - 近景大雪花（near）：数量少、个头大、边缘更柔，负责"雪下得真大"的存在感
 * 两者的强度都由 setIntensity 统一控制，过场时拉满。
 */
function buildLayer(count, options) {
  const {
    radius = 15,
    speedMin = 0.45,
    speedMax = 1.6,
    sizeMin = 0.55,
    sizeMax = 1.8,
    alpha = 0.42,
    sizeScale = 1,
    soft = 0.5,
    additive = false,
  } = options;

  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = Math.random() * FIELD_HEIGHT;
    positions[i * 3 + 2] = Math.sin(angle) * r;

    speeds[i] = speedMin + Math.random() * (speedMax - speedMin);
    phases[i] = Math.random() * Math.PI * 2;
    sizes[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
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
    uAlpha: { value: 1 },
    uWind: { value: 1 },
    uSizeScale: { value: sizeScale },
    uSoft: { value: soft },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    // 近景大雪花走加法混合：在黑夜里是柔和的光斑，而不是灰蒙蒙的圆片
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uHeight;
      uniform float uBase;
      uniform float uWind;
      uniform float uSizeScale;

      attribute float aSpeed;
      attribute float aPhase;
      attribute float aSize;

      varying float vAlpha;

      void main() {
        vec3 p = position;

        // 循环下落：mod 保证永远落不完
        float fall = mod(p.y - uTime * aSpeed + 100.0, uHeight);
        p.y = uBase + fall;

        // 横向风偏，两层不同频率叠出"飘"的感觉；起风时整体漂得更远
        p.x += (sin(uTime * 0.34 + aPhase) * 0.6 + sin(uTime * 0.12 + aPhase * 2.1) * 0.9) * uWind;
        p.z += cos(uTime * 0.27 + aPhase * 1.4) * 0.5 * uWind;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        float fadeIn = smoothstep(0.0, 2.0, fall);
        float fadeOut = 1.0 - smoothstep(uHeight - 3.2, uHeight, fall);
        vAlpha = fadeIn * fadeOut * (0.34 + 0.26 * sin(uTime * 1.1 + aPhase));

        gl_PointSize = aSize * uSizeScale * uPixelRatio * (30.0 / max(1.0, -mv.z));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uSoft;

      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        // 近景大雪花边缘更虚，像失焦的光斑
        float falloff = smoothstep(0.5, 0.5 - uSoft * 0.46, d);
        float alpha = falloff * vAlpha * uAlpha;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(uColor, min(alpha, 1.0));
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 6;

  return { points, uniforms, geometry, material, count };
}

export function createSnow(count) {
  const nearCount = Math.max(140, Math.round(count * 0.085));

  const far = buildLayer(count, {
    radius: 15,
    speedMin: 0.45,
    speedMax: 1.6,
    sizeMin: 0.55,
    sizeMax: 1.8,
    sizeScale: 1,
    soft: 0.5,
  });

  const near = buildLayer(nearCount, {
    radius: 13,
    speedMin: 0.25,
    speedMax: 0.85,
    sizeMin: 2.2,
    sizeMax: 5.6,
    sizeScale: 1.35,
    soft: 1.6,
    additive: true,
  });

  const group = new THREE.Group();
  group.add(far.points, near.points);

  let intensity = 0.32;

  function applyIntensity() {
    // 近景层是"雪变大"的主力，远景层只轻微加浓
    near.uniforms.uAlpha.value = 0.1 + intensity * 0.5;
    far.uniforms.uAlpha.value = 0.82 + intensity * 0.3;
    near.uniforms.uWind.value = 1 + intensity * 2.4;
    far.uniforms.uWind.value = 1 + intensity * 1.6;
  }
  applyIntensity();

  return {
    points: group,
    update(time) {
      far.uniforms.uTime.value = time;
      near.uniforms.uTime.value = time;
    },
    setPixelRatio(value) {
      far.uniforms.uPixelRatio.value = value;
      near.uniforms.uPixelRatio.value = value;
    },
    setDrawCount(n) {
      far.geometry.setDrawRange(0, Math.min(far.count, n));
      near.geometry.setDrawRange(0, Math.min(near.count, Math.round(near.count * (n / far.count))));
    },
    /** 0 = 平时的细雪，1 = 过场时的暴雪 */
    setIntensity(value) {
      intensity = Math.min(Math.max(value, 0), 1);
      applyIntensity();
    },
    get intensity() {
      return intensity;
    },
    setVisible(visible) {
      group.visible = visible;
    },
    dispose() {
      for (const layer of [far, near]) {
        layer.geometry.dispose();
        layer.material.dispose();
      }
    },
  };
}
