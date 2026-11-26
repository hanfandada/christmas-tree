import * as THREE from 'three';
import { PALETTE, TREE, TIMELINE } from './config.js';

const TAU = Math.PI * 2;

/**
 * 和 tree.js 里那条 reveal 的斜率保持一致：
 *   reveal = smoothstep(0.0, 0.1, uProgress * 1.12 - (1.0 - aHeight))
 * 也就是点亮的边界在归一化高度上处在 1 - 1.12 * uProgress。
 * 丝带的带头必须踩着同一条线走，不然会出现"丝带到了、树还没亮"的割裂感。
 */
const REVEAL_RATE = 1.12;

/**
 * 拖尾长度（归一化高度）。
 *
 * 试过按弧长算：树底的弧长大了一个数量级，尾巴会被压成几乎看不见的一小段，
 * 丝带在树底就"没了"。按高度算虽然底部会被拉成一道长弧，但那正好是
 * "丝带绕到树脚"的样子——只要把亮度压住就行。
 */
const TAIL = 0.26;

/**
 * 三条丝带：圈数、转速、拧的幅度、离树面的距离都不一样，
 * 免得看起来像一个模子刻出来、三份完全重合的螺旋。
 */
const RIBBONS = [
  { phase: 0.0, start: 0.0, turns: 2.2, spin: 0.5, twist: 0.5, radius: 1.04, tint: 0.0 },
  { phase: 0.06, start: 2.1, turns: 2.7, spin: -0.38, twist: -0.4, radius: 1.1, tint: 0.45 },
  { phase: -0.05, start: 4.3, turns: 3.1, spin: 0.28, twist: 0.6, radius: 0.99, tint: 0.9 },
];

const POINTS_PER_RIBBON = 1800;
// 每个采样点再出一颗大的暗点当外晕：只有实心点的话，这条带子就细得像根线
const PER_SAMPLE = 2;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 沿螺旋等弧长采样高度。
 *
 * 直接均匀取 h 的话，树尖那一段半径小、弧长也小，点会全挤在顶点糊成一团白；
 * 按弧长走，拖尾扫到哪一段都是同样疏密。
 */
function evenHeights({ turns, radius }, count) {
  const STEPS = 2048;
  const radiusAt = (h) => Math.max(0.05, TREE.baseRadius * Math.pow(1 - h, 0.94) * radius);
  const arc = new Float32Array(STEPS + 1);
  const dTheta = (turns * TAU) / STEPS;
  const dY = TREE.height / STEPS;

  for (let i = 1; i <= STEPS; i++) {
    const r0 = radiusAt((i - 1) / STEPS);
    const r1 = radiusAt(i / STEPS);
    const dr = r1 - r0;
    const along = r0 * dTheta;
    arc[i] = arc[i - 1] + Math.sqrt(dr * dr + along * along + dY * dY);
  }

  const total = arc[STEPS];
  const heights = new Float32Array(count);
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / Math.max(1, count - 1)) * total;
    while (cursor < STEPS - 1 && arc[cursor + 1] < target) cursor++;
    const span = arc[cursor + 1] - arc[cursor] || 1;
    heights[i] = (cursor + (target - arc[cursor]) / span) / STEPS;
  }
  return heights;
}

/** 开场时从上往下绕的几条发光丝带：让"树亮起来"有个看得见的原因 */
export function createRibbons({ reducedMotion = false } = {}) {
  const total = RIBBONS.length * POINTS_PER_RIBBON * PER_SAMPLE;
  const positions = new Float32Array(total * 3);
  const heights = new Float32Array(total);
  const phases = new Float32Array(total);
  const sizes = new Float32Array(total);
  const spins = new Float32Array(total);
  const twists = new Float32Array(total);
  const tints = new Float32Array(total);
  const halos = new Float32Array(total);
  const turnAttr = new Float32Array(total);

  let n = 0;
  for (const ribbon of RIBBONS) {
    const hs = evenHeights(ribbon, POINTS_PER_RIBBON);
    for (let i = 0; i < POINTS_PER_RIBBON; i++) {
      const h = hs[i];
      const r = Math.max(0.05, TREE.baseRadius * Math.pow(1 - h, 0.94) * ribbon.radius);
      const angle = ribbon.start + h * ribbon.turns * TAU;
      const x = Math.cos(angle) * r;
      const y = TREE.baseY + h * TREE.height;
      const z = Math.sin(angle) * r;
      const core = 1.8 + Math.random() * 1.6;

      for (let k = 0; k < PER_SAMPLE; k++) {
        positions[n * 3] = x;
        positions[n * 3 + 1] = y;
        positions[n * 3 + 2] = z;

        heights[n] = h;
        phases[n] = ribbon.phase;
        sizes[n] = k === 0 ? core : core * 2.4;
        spins[n] = ribbon.spin;
        twists[n] = ribbon.twist;
        tints[n] = ribbon.tint;
        halos[n] = k;
        turnAttr[n] = ribbon.turns;
        n += 1;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aSpin', new THREE.BufferAttribute(spins, 1));
  geometry.setAttribute('aTwist', new THREE.BufferAttribute(twists, 1));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));
  geometry.setAttribute('aHalo', new THREE.BufferAttribute(halos, 1));
  geometry.setAttribute('aTurns', new THREE.BufferAttribute(turnAttr, 1));
  geometry.computeBoundingSphere();

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uPixelRatio: { value: 1 },
    uFade: { value: 0 },
    uLift: { value: 0 },
    uHead: { value: new THREE.Color(0xffeecb) },
    uTail: { value: new THREE.Color(PALETTE.string) },
    uCool: { value: new THREE.Color(PALETTE.treeTop) },
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
      uniform float uFade;
      uniform float uLift;
      uniform vec3 uHead;
      uniform vec3 uTail;
      uniform vec3 uCool;

      attribute float aHeight;
      attribute float aPhase;
      attribute float aSize;
      attribute float aSpin;
      attribute float aTwist;
      attribute float aTint;
      attribute float aHalo;
      attribute float aTurns;

      varying vec3 vColor;
      varying float vAlpha;

      const float REVEAL_RATE = ${REVEAL_RATE.toFixed(2)};
      const float TAIL = ${TAIL.toFixed(2)};
      const float TREE_H = ${TREE.height.toFixed(2)};

      void main() {
        // 绕竖轴慢慢转，外加一点随高度拧的麻花：转的是几何体，不是贴图
        vec3 p = position;
        float ang = uTime * aSpin + aHeight * aTwist;
        float c = cos(ang);
        float s = sin(ang);
        p.x = position.x * c - position.z * s;
        p.z = position.x * s + position.z * c;
        p.y += uLift; // 收场时整体往上抽走

        // 带头：踩着树的点亮边界往下走，aPhase 让三条前后错开一点
        float head = 1.0 - REVEAL_RATE * uProgress + aPhase;
        float passed = aHeight - head; // >= 0 表示带头已经扫过这一层

        // 树底那一圈半径大，同样一段高度差会拉成很长一道弧：
        // 亮度按半径反比压一下，底部才不会白成一道激光
        float rHere = length(position.xz);
        float wide = mix(1.0, 0.44, clamp(rHere / 3.0, 0.0, 1.0));

        // 扫过之后才亮；离带头越远越暗，于是形成一条有方向的拖尾
        float lit = smoothstep(0.0, 0.012, passed);
        float tail = 1.0 - smoothstep(0.02, TAIL, passed);
        // 越往后越收：收场前丝带不该再抢戏
        float settle = mix(1.0, 0.5, uProgress);
        float glow = lit * (0.05 + 0.95 * pow(tail, 1.5)) * wide * settle;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        float twinkle = 0.78 + 0.22 * sin(uTime * 3.4 + aHeight * 42.0 + aPhase * 11.0);
        // 带头粗、尾巴细：一条带子该有的收束感
        float taper = mix(0.45, 1.0, tail);
        gl_PointSize = aSize * taper * uPixelRatio * twinkle * (26.0 / max(0.6, -mv.z));

        vec3 tailColor = mix(uTail, uCool, aTint * 0.55);
        vColor = mix(tailColor, uHead, tail) * (0.85 + 0.5 * tail);
        // 外晕那颗更大更暗，负责把带子的边缘晕开
        vAlpha = glow * uFade * (0.3 + 0.7 * tail) * mix(1.0, 0.16, aHalo);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float falloff = smoothstep(0.5, 0.02, d);
        float alpha = falloff * vAlpha;
        if (alpha < 0.006) discard;
        gl_FragColor = vec4(vColor * (0.85 + falloff * 0.55), alpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.renderOrder = 6;
  points.frustumCulled = false;

  const group = new THREE.Group();
  group.add(points);
  group.visible = false;

  const doneAt = TIMELINE.growDelay + TIMELINE.growDuration;
  let head = 1;
  let strength = 0;

  return {
    group,

    /**
     * 返回"带头现在在哪一层、还剩多少强度"，交给 tree 去加亮那一圈，
     * 树才会像被丝带点着，而不是各亮各的。
     */
    update(elapsed) {
      uniforms.uTime.value = elapsed;

      const progress = uniforms.uProgress.value;
      head = 1 - REVEAL_RATE * progress;

      // 星星亮起来时丝带跟着出现；树整棵亮完再用 0.65 秒抽走
      const fadeIn = clamp01((elapsed - TIMELINE.starDelay) / 0.45);
      const fadeOut = 1 - clamp01((elapsed - doneAt) / 0.65);
      const fade = reducedMotion ? 0 : fadeIn * fadeOut;

      uniforms.uFade.value = fade;
      uniforms.uLift.value = (1 - fadeOut) * 1.4;
      group.visible = fade > 0.004;

      strength = fade;
      return { head, strength };
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
