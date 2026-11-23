import * as THREE from 'three';

/**
 * 远景星空：包住相机的一层稀疏光点，极慢自转。
 * 作用是让"纯黑背景"有层次，所以它必须很淡、很慢，不能抢树。
 */
export function createSky(count) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // 球面均匀分布
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = 62 + Math.random() * 26;
    const s = Math.sqrt(1 - u * u);

    positions[i * 3] = r * s * Math.cos(theta);
    positions[i * 3 + 1] = r * u * 0.65 + 12;
    positions[i * 3 + 2] = r * s * Math.sin(theta);

    phases[i] = Math.random() * Math.PI * 2;
    sizes[i] = 0.5 + Math.random() * 1.5;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;

      attribute float aPhase;
      attribute float aSize;

      varying float vAlpha;

      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;

        float twinkle = 0.55 + 0.45 * sin(uTime * (0.4 + aPhase * 0.25) + aPhase * 4.0);
        vAlpha = 0.18 + 0.42 * twinkle * twinkle;

        gl_PointSize = aSize * uPixelRatio * (26.0 / max(1.0, -mv.z));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float falloff = smoothstep(0.5, 0.1, d);
        float alpha = falloff * vAlpha;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(vec3(0.85, 0.93, 1.0), alpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -50;

  const group = new THREE.Group();
  group.add(points);

  return {
    group,
    update(time) {
      uniforms.uTime.value = time;
      group.rotation.y = time * 0.006;
    },
    setPixelRatio(value) {
      uniforms.uPixelRatio.value = value;
    },
    setDrawCount(n) {
      geometry.setDrawRange(0, n);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
