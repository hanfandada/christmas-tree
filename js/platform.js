import * as THREE from 'three';
import { GROUND_Y } from './config.js';

const TAU = Math.PI * 2;

/**
 * 树站的圆台。
 *
 * 之前礼物直接散在雪地上，跟地面的雪光糊在一起，看不出"一堆礼物"，
 * 只像地上撒了一把碎光。给树加一个圆台当舞台：台面暗、台沿亮，
 * 礼物摆在台面上就有了立足点，整个底部也收得住。
 */

/** 台面半径 / 厚度 */
export const PLATFORM_RADIUS = 4.4;
export const PLATFORM_HEIGHT = 0.52;
export const PLATFORM_TOP = GROUND_Y + PLATFORM_HEIGHT;

const rand = (min, max) => min + Math.random() * (max - min);

function buildGeometry() {
  const pos = [];
  const size = [];
  const kind = []; // 0 = 台面, 1 = 台沿, 2 = 侧面
  const phase = [];

  const top = PLATFORM_TOP;
  const bottom = GROUND_Y;

  // 台面：同心圆撒点，越靠外越密（面积）
  for (let i = 0; i < 2600; i++) {
    const r = Math.sqrt(Math.random()) * PLATFORM_RADIUS * 0.98;
    const a = Math.random() * TAU;
    pos.push(Math.cos(a) * r, top + rand(-0.01, 0.01), Math.sin(a) * r);
    size.push(rand(0.5, 1.05));
    kind.push(0);
    phase.push(Math.random() * TAU);
  }

  // 台沿：两圈更亮的点，把边界挑出来
  for (const [ringR, per, sz] of [
    [PLATFORM_RADIUS, 900, [1.1, 1.9]],
    [PLATFORM_RADIUS * 0.955, 520, [0.8, 1.3]],
  ]) {
    for (let i = 0; i < per; i++) {
      const a = (i / per) * TAU;
      pos.push(
        Math.cos(a) * ringR,
        top + rand(-0.012, 0.012),
        Math.sin(a) * ringR
      );
      size.push(rand(sz[0], sz[1]));
      kind.push(1);
      phase.push(a);
    }
  }

  // 侧面：稀疏的竖线，让台子有厚度、不是一张圆片
  for (let i = 0; i < 760; i++) {
    const a = (i / 760) * TAU + rand(-0.004, 0.004);
    const y = rand(bottom, top);
    pos.push(Math.cos(a) * PLATFORM_RADIUS, y, Math.sin(a) * PLATFORM_RADIUS);
    size.push(rand(0.7, 1.3));
    kind.push(2);
    phase.push(Math.random() * TAU);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createPlatform() {
  const geometry = buildGeometry();

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uPixelRatio: { value: 1 },
    uFace: { value: new THREE.Color(0x2f4a63) },
    uRim: { value: new THREE.Color(0xffd9a0) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform float uPixelRatio;
      uniform vec3 uFace;
      uniform vec3 uRim;

      attribute float aSize;
      attribute float aKind;
      attribute float aPhase;

      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;

        float twinkle = 0.6 + 0.4 * sin(uTime * 1.4 + aPhase * 6.0);
        // 沿台沿跑的一道光：给静止的圆台一点动势
        float run = pow(0.5 + 0.5 * sin(aPhase * 3.0 - uTime * 1.1), 6.0);

        vec3 color = uFace;
        float alpha = 0.17 * twinkle;
        float sizeMul = 1.0;

        if (aKind > 0.5 && aKind < 1.5) {
          color = uRim;
          alpha = 0.34 + 0.85 * run;
          sizeMul = 1.0 + 0.6 * run;
        } else if (aKind > 1.5) {
          color = mix(uFace, uRim, 0.35);
          alpha = 0.16 * twinkle;
        }

        // 等树的灯光快走到根部时再浮现：太早亮起来就是半棵树配一个空台子
        float reveal = smoothstep(0.55, 1.0, uProgress);

        gl_PointSize = aSize * sizeMul * uPixelRatio * (26.0 / max(0.6, -mv.z));

        vColor = color;
        vAlpha = alpha * reveal;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float falloff = smoothstep(0.5, 0.0, d);
        float alpha = falloff * vAlpha;
        if (alpha < 0.006) discard;
        gl_FragColor = vec4(vColor * (1.0 + falloff * 0.6), alpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;

  const group = new THREE.Group();
  group.add(points);

  return {
    group,
    update(time) {
      uniforms.uTime.value = time;
    },
    setProgress(value) {
      uniforms.uProgress.value = value;
    },
    setPixelRatio(value) {
      uniforms.uPixelRatio.value = value;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
