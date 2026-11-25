import * as THREE from 'three';
import { PALETTE, TREE } from './config.js';

const TAU = Math.PI * 2;

/** 树体粒子：沿锥面螺旋分布，越靠底部越密，靠 shader 做呼吸与生长 */
export function createTree(count) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  const heights = new Float32Array(count);
  const tints = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // 按锥面面积采样：底面点密、树尖点稀，树尖才不会糊成一根白柱
    const t = 1 - Math.pow(1 - Math.random(), 1 / 1.94);
    const shell = Math.random() < 0.72;

    const coneRadius = TREE.baseRadius * Math.pow(1 - t, 0.94);
    const radius = Math.max(0.2, coneRadius * (shell ? 0.86 + Math.random() * 0.14 : Math.random() * 0.9));

    const angle = shell
      ? t * TREE.turns * TAU + (Math.random() - 0.5) * 0.62
      : Math.random() * TAU;

    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.max(
      TREE.baseY,
      TREE.baseY + t * TREE.height + (Math.random() - 0.5) * 0.5
    );
    positions[i * 3 + 2] = Math.sin(angle) * radius;

    phases[i] = Math.random() * TAU;
    heights[i] = t;
    sizes[i] = shell ? 0.7 + Math.random() * 1.05 : 0.35 + Math.random() * 0.5;
    tints[i] = Math.random() < 0.045 ? 1 : 0; // 少量暖色"浆果"，打散纯绿的单调
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));
  geometry.computeBoundingSphere();

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uPixelRatio: { value: 1 },
    uBottom: { value: new THREE.Color(PALETTE.treeBottom) },
    uMid: { value: new THREE.Color(PALETTE.treeMid) },
    uTop: { value: new THREE.Color(PALETTE.treeTop) },
    uWarm: { value: new THREE.Color(PALETTE.treeWarm) },
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
      uniform vec3 uBottom;
      uniform vec3 uMid;
      uniform vec3 uTop;
      uniform vec3 uWarm;

      attribute float aPhase;
      attribute float aSize;
      attribute float aHeight;
      attribute float aTint;

      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;

        // 树梢晃得比树根明显，像有微风穿过
        float sway = smoothstep(0.12, 1.0, aHeight);
        p.x += sin(uTime * 0.55 + aPhase * 0.8 + aHeight * 5.0) * 0.06 * sway;
        p.z += cos(uTime * 0.47 + aPhase * 0.6 + aHeight * 4.0) * 0.055 * sway;
        p.y += sin(uTime * 0.8 + aPhase) * 0.014 * sway;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        // 生长：星星先亮，光从上往下流（用 1.0 - aHeight 把顺序翻过来）
        float reveal = smoothstep(0.0, 0.1, uProgress * 1.12 - (1.0 - aHeight));

        float twinkle = 0.5 + 0.5 * sin(uTime * (0.7 + aPhase * 0.9) + aPhase * 5.0);
        float brightness = 0.5 + 0.5 * twinkle;

        gl_PointSize = aSize * uPixelRatio * (26.0 / max(0.6, -mv.z)) * (0.85 + 0.35 * twinkle);

        vec3 col = mix(uBottom, uMid, smoothstep(0.0, 0.52, aHeight));
        col = mix(col, uTop, smoothstep(0.52, 1.0, aHeight));
        col = mix(col, uWarm, aTint * 0.85);

        vColor = col;
        vAlpha = reveal * (0.11 + 0.33 * brightness);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float falloff = smoothstep(0.5, 0.02, d);
        float alpha = falloff * vAlpha;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(vColor * (0.85 + falloff * 0.55), alpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.renderOrder = 2;

  /* ---------------- 灯串：一条更紧的螺旋，亮度波自上而下流动 ---------------- */

  const stringCount = Math.round(count * 0.014) + 320;
  const sPos = new Float32Array(stringCount * 3);
  const sPhase = new Float32Array(stringCount);
  const sHeight = new Float32Array(stringCount);
  const sSize = new Float32Array(stringCount);

  for (let i = 0; i < stringCount; i++) {
    const t = i / (stringCount - 1);
    const angle = t * TREE.turns * 0.62 * TAU;
    const radius = TREE.baseRadius * Math.pow(1 - t, 0.94) * 1.04;
    sPos[i * 3] = Math.cos(angle) * radius;
    sPos[i * 3 + 1] = TREE.baseY + t * TREE.height;
    sPos[i * 3 + 2] = Math.sin(angle) * radius;
    sHeight[i] = t;
    sPhase[i] = Math.random() * TAU;
    sSize[i] = 1.0 + Math.random() * 1.5;
  }

  const sGeometry = new THREE.BufferGeometry();
  sGeometry.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeometry.setAttribute('aPhase', new THREE.BufferAttribute(sPhase, 1));
  sGeometry.setAttribute('aHeight', new THREE.BufferAttribute(sHeight, 1));
  sGeometry.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
  sGeometry.computeBoundingSphere();

  const sUniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uPixelRatio: { value: 1 },
    uColor: { value: new THREE.Color(PALETTE.string) },
  };

  const sMaterial = new THREE.ShaderMaterial({
    uniforms: sUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform float uPixelRatio;

      attribute float aPhase;
      attribute float aHeight;
      attribute float aSize;

      varying float vAlpha;

      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;

        float reveal = smoothstep(0.0, 0.08, uProgress * 1.08 - (1.0 - aHeight));
        // 亮波沿螺旋向下跑
        float wave = 0.22 + 0.78 * pow(0.5 + 0.5 * sin(aHeight * 46.0 - uTime * 2.8 + aPhase * 0.4), 4.0);

        gl_PointSize = aSize * uPixelRatio * (30.0 / max(0.6, -mv.z)) * (0.8 + wave * 0.5);
        vAlpha = reveal * wave * 0.72;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float falloff = smoothstep(0.5, 0.0, d);
        float alpha = falloff * vAlpha;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor * (1.15 + falloff * 0.7), alpha);
      }
    `,
  });

  const string = new THREE.Points(sGeometry, sMaterial);
  string.renderOrder = 3;

  const group = new THREE.Group();
  group.add(points, string);

  return {
    group,
    points,
    string,
    update(time) {
      uniforms.uTime.value = time;
      sUniforms.uTime.value = time;
    },
    setProgress(value) {
      uniforms.uProgress.value = value;
      sUniforms.uProgress.value = value;
    },
    setPixelRatio(value) {
      uniforms.uPixelRatio.value = value;
      sUniforms.uPixelRatio.value = value;
    },
    /** 粒子坐标（组合技炸开时要用同一套起点，才能接着树形无缝接管） */
    getPositions() {
      return positions;
    },
    /** 降画质时只减少绘制数量，不重建几何体 */
    setDrawCount(n) {
      points.geometry.setDrawRange(0, n);
    },
    setVisible(visible) {
      group.visible = visible;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      sGeometry.dispose();
      sMaterial.dispose();
    },
  };
}

/** 树体表面上的一个点：给挂饰定位用，heightRatio 决定挂多高 */
export function pointOnTree(heightRatio, angle, offset = 1.06) {
  const t = THREE.MathUtils.clamp(heightRatio, 0.02, 0.96);
  const radius = TREE.baseRadius * Math.pow(1 - t, 0.94) * offset;
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    TREE.baseY + t * TREE.height,
    Math.sin(angle) * radius
  );
}
