import * as THREE from 'three';
import { TREE } from './config.js';

/**
 * 树干：一个自发光感的浅圆柱 + 一圈暖色余烬粒子。
 * 不用真实光照，而是用一个极简着色器伪造侧向光与轮廓光，
 * 这样树干在纯粒子场景里不会显得像块塑料。
 */
export function createTrunk() {
  const group = new THREE.Group();
  const height = TREE.trunkHeight;
  const topRadius = TREE.trunkRadius * 0.78;
  const bottomRadius = TREE.trunkRadius;

  const geometry = new THREE.CylinderGeometry(topRadius, bottomRadius, height, 30, 8, false);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(0x7a4420) },
      uBottom: { value: new THREE.Color(0x2e1809) },
      uRim: { value: new THREE.Color(0xb8642a) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vPosW;
      varying vec2 vUv;
      varying float vH;

      void main() {
        vH = uv.y;
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vPosW = worldPosition.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform vec3 uRim;

      varying vec3 vNormalW;
      varying vec3 vPosW;
      varying vec2 vUv;
      varying float vH;

      void main() {
        vec3 n = normalize(vNormalW);
        vec3 viewDir = normalize(cameraPosition - vPosW);

        // 假想主光从右上打来
        float lambert = clamp(dot(n, normalize(vec3(0.55, 0.45, 0.7))), 0.0, 1.0);
        float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.6);

        // 纵向木纹：角度方向的正弦叠加，避免表面一片死平
        float grain = 0.78 + 0.22 * sin(vUv.x * 96.0 + sin(vUv.x * 27.0) * 2.4);
        grain *= 0.9 + 0.1 * sin(vH * 42.0);

        vec3 bark = mix(uBottom, uTop, smoothstep(0.0, 1.0, vH));
        bark *= grain;
        bark *= 0.5 + 0.9 * lambert;
        bark += uRim * rim * (0.2 + 0.32 * vH);
        // 越靠根部越暗，视觉上"扎进地里"
        bark *= 0.45 + 0.55 * smoothstep(0.0, 0.18, vH);

        gl_FragColor = vec4(bark, 1.0);
      }
    `,
  });

  const trunk = new THREE.Mesh(geometry, material);
  trunk.position.y = TREE.baseY - height / 2;
  group.add(trunk);

  /* ---------- 树干周围的暖色余烬 ---------- */
  const count = 420;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = TREE.trunkRadius * (0.9 + Math.random() * 0.75);
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.random() * (height + 0.5);
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    phases[i] = Math.random() * Math.PI * 2;
    speeds[i] = 0.06 + Math.random() * 0.16;
    sizes[i] = 0.6 + Math.random() * 1.4;
  }

  const emberGeometry = new THREE.BufferGeometry();
  emberGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  emberGeometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  emberGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  emberGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const emberUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uBase: { value: TREE.baseY - height },
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
        vAlpha = (1.0 - life) * (0.55 + 0.4 * sin(uTime * 2.0 + aPhase));
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
    update(time) {
      emberUniforms.uTime.value = time;
    },
    setPixelRatio(value) {
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
