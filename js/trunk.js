import * as THREE from 'three';
import { TREE } from './config.js';

/**
 * 树干：一整根**粒子**圆柱 + 一圈暖色余烬。
 *
 * 原来是真几何体（CylinderGeometry + 伪造光照），在满屏粒子里像块塑料，
 * 所以改成和树体同一套语言：整根树干由光点堆出来，木纹靠点亮度变化模拟，
 * 侧光 / 轮廓光还是用一个假想主光方向算。
 *
 * 加色混合下深褐几乎不发光，正好——根部自然隐没进地里，
 * 只有朝向光源的一面和轮廓会被"点亮"。
 */
export function createTrunk({ count = 6000, reducedMotion = false } = {}) {
  const group = new THREE.Group();
  const height = TREE.trunkHeight;
  const topRadius = TREE.trunkRadius * 0.78;
  const bottomRadius = TREE.trunkRadius;
  const baseY = TREE.baseY - height; // 树干底面

  /* ---------------- 树干粒子 ---------------- */

  const positions = new Float32Array(count * 3);
  const heights = new Float32Array(count);
  const angles = new Float32Array(count);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const h = Math.random();
    const angle = Math.random() * Math.PI * 2;

    // 顶细底粗；根部再外扩一点，像扎进地里的树根
    let radius = topRadius + (bottomRadius - topRadius) * (1 - h);
    radius *= 1 + 0.16 * Math.pow(1 - h, 6);
    // 树皮的凹凸：一部分点往里缩一点，边缘才不会是一条直上直下的线
    const bark = 1 + (Math.random() - 0.5) * 0.09 + Math.sin(angle * 6 + h * 26) * 0.035;
    // 少量点放到内层，补上轮廓处的密度
    const inward = Math.random() < 0.08 ? 0.6 + Math.random() * 0.3 : 1;

    positions[i * 3] = Math.cos(angle) * radius * bark * inward;
    positions[i * 3 + 1] = baseY + h * height;
    positions[i * 3 + 2] = Math.sin(angle) * radius * bark * inward;

    heights[i] = h;
    angles[i] = angle;
    seeds[i] = Math.random();
    sizes[i] = Math.random() < 0.1 ? 3.0 + Math.random() * 2.0 : 1.6 + Math.random() * 1.7;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 1 },
    uPixelRatio: { value: 1 },
    uTop: { value: new THREE.Color(0x9c5a2c) },
    uBottom: { value: new THREE.Color(0x1b0d06) },
    uRim: { value: new THREE.Color(0xc06a30) },
    uLight: { value: new THREE.Vector3(0.55, 0.45, 0.7).normalize() },
  };

  // 树干**不用**加色混合：棕色在加色下要么几乎看不见，要么一堆点叠成白色火光。
  // 用普通混合，点叠起来就是一整根深棕色的柱子，正好是树干该有的样子。
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform float uPixelRatio;
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform vec3 uRim;
      uniform vec3 uLight;

      attribute float aHeight;
      attribute float aAngle;
      attribute float aSeed;
      attribute float aSize;

      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        // 圆柱表面法线（只看水平方向就够）
        vec3 n = normalize(vec3(cos(aAngle), 0.0, sin(aAngle)));
        float lambert = clamp(dot(n, uLight), 0.0, 1.0);
        vec3 viewDir = normalize(cameraPosition - (modelMatrix * vec4(p, 1.0)).xyz);
        float rim = pow(1.0 - abs(dot(n, viewDir)), 2.6);

        // 木纹：沿圆周的疏密条纹，再叠一层纵向慢变化
        float grain = 0.78 + 0.22 * sin(aAngle * 96.0 + sin(aAngle * 27.0) * 2.4);
        grain *= 0.9 + 0.1 * sin(aHeight * 42.0);

        float twinkle = 0.82 + 0.18 * sin(uTime * 1.6 + aSeed * 20.0);

        vec3 bark = mix(uBottom, uTop, smoothstep(0.0, 1.0, aHeight));
        // 明暗拉开：背光面几乎沉进黑里，受光面才立得住
        bark *= grain * (0.28 + 1.15 * lambert) * twinkle;
        bark += uRim * rim * (0.18 + 0.3 * aHeight);
        // 根部压暗，视觉上"扎进地里"
        bark *= 0.35 + 0.65 * smoothstep(0.0, 0.18, aHeight);

        vColor = bark;
        // 跟着开场点亮：树干在最后 1/4 才醒，和树底同时
        float t = clamp((uProgress - 0.72) / 0.28, 0.0, 1.0);
        float reveal = smoothstep(0.0, 0.45, t * 1.25 - aSeed * 0.3);
        vAlpha = reveal * (0.55 + 0.4 * lambert) * (0.85 + 0.15 * twinkle);

        gl_PointSize = aSize * uPixelRatio * (26.0 / max(0.8, -mv.z)) * (0.9 + 0.2 * twinkle);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float falloff = smoothstep(0.5, 0.05, d);
        float alpha = falloff * vAlpha;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });

  const trunk = new THREE.Points(geometry, material);
  trunk.frustumCulled = false;
  trunk.renderOrder = 1;
  group.add(trunk);

  /* ---------- 树干周围的暖色余烬 ---------- */

  const emberCount = 420;
  const ePositions = new Float32Array(emberCount * 3);
  const ePhases = new Float32Array(emberCount);
  const eSpeeds = new Float32Array(emberCount);
  const eSizes = new Float32Array(emberCount);

  for (let i = 0; i < emberCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = TREE.trunkRadius * (0.9 + Math.random() * 0.75);
    ePositions[i * 3] = Math.cos(angle) * radius;
    ePositions[i * 3 + 1] = Math.random() * (height + 0.5);
    ePositions[i * 3 + 2] = Math.sin(angle) * radius;
    ePhases[i] = Math.random() * Math.PI * 2;
    eSpeeds[i] = 0.06 + Math.random() * 0.16;
    eSizes[i] = 0.6 + Math.random() * 1.4;
  }

  const emberGeometry = new THREE.BufferGeometry();
  emberGeometry.setAttribute('position', new THREE.BufferAttribute(ePositions, 3));
  emberGeometry.setAttribute('aPhase', new THREE.BufferAttribute(ePhases, 1));
  emberGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(eSpeeds, 1));
  emberGeometry.setAttribute('aSize', new THREE.BufferAttribute(eSizes, 1));

  const emberUniforms = {
    uTime: { value: 0 },
    uProgress: { value: 1 },
    uPixelRatio: { value: 1 },
    uBase: { value: baseY },
    uRange: { value: height + 0.6 },
    uColor: { value: new THREE.Color(0xff9a4a) },
  };

  const emberMaterial = new THREE.ShaderMaterial({
    uniforms: emberUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform float uPixelRatio;
      uniform float uBase;
      uniform float uRange;

      attribute float aPhase;
      attribute float aSpeed;
      attribute float aSize;

      varying float vAlpha;

      void main() {
        vec3 p = position;
        // 余烬缓慢上升并循环
        p.y = uBase + mod(p.y + uTime * aSpeed * 3.0, uRange);
        p.x += sin(uTime * 0.6 + aPhase) * 0.05;
        p.z += cos(uTime * 0.5 + aPhase * 1.3) * 0.05;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        float life = mod(p.y - uBase, uRange) / uRange;
        float reveal = smoothstep(0.0, 0.12, uProgress - 0.78);
        vAlpha = reveal * (1.0 - life) * (0.55 + 0.4 * sin(uTime * 2.0 + aPhase));
        gl_PointSize = aSize * uPixelRatio * (26.0 / max(0.8, -mv.z));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float falloff = smoothstep(0.5, 0.05, d);
        float alpha = falloff * vAlpha;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  const embers = new THREE.Points(emberGeometry, emberMaterial);
  embers.frustumCulled = false;
  group.add(embers);

  return {
    group,
    particleCount: count,
    update(time) {
      uniforms.uTime.value = time;
      emberUniforms.uTime.value = time;
    },
    /** 0→1 的生长进度：树干和余烬在最后一段才亮 */
    setProgress(value) {
      const v = reducedMotion ? 1 : value;
      uniforms.uProgress.value = v;
      emberUniforms.uProgress.value = v;
    },
    setPixelRatio(value) {
      uniforms.uPixelRatio.value = value;
      emberUniforms.uPixelRatio.value = value;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      emberGeometry.dispose();
      emberMaterial.dispose();
    },
  };
}
