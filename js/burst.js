import * as THREE from 'three';
import { PALETTE } from './config.js';

/**
 * 点击撒星火：每次点击在指针位置炸开一小簇金色粒子，
 * 受重力下落并快速淡出。用对象池的思路管理，避免越点越卡。
 */
export function createBurstSystem(scene, { particles = 120, maxBursts = 5, duration = 1.35 } = {}) {
  const bursts = [];
  const sparkColor = new THREE.Color(PALETTE.spark);
  let pixelRatio = 1;

  const vertexShader = /* glsl */ `
    uniform float uPixelRatio;
    uniform float uSize;
    attribute float aSize;
    varying float vShade;

    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uSize * uPixelRatio * (34.0 / max(1.0, -mv.z));
      vShade = aSize;
    }
  `;

  const fragmentShader = /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vShade;

    void main() {
      float d = length(gl_PointCoord - 0.5);
      float falloff = smoothstep(0.5, 0.0, d);
      float alpha = falloff * uOpacity;
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(mix(uColor, vec3(1.0), vShade * 0.45) * 1.8, alpha);
    }
  `;

  function createBurst(origin, strength) {
    const positions = new Float32Array(particles * 3);
    const velocities = new Float32Array(particles * 3);
    const sizes = new Float32Array(particles);

    for (let i = 0; i < particles; i++) {
      // 半球形向外飞散，整体朝上偏
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - Math.random() * 1.35);
      const speed = (1.1 + Math.random() * 2.6) * strength;

      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] = Math.cos(phi) * speed * 0.9 + 0.8;
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;

      sizes[i] = 0.5 + Math.random() * 1.3;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: sparkColor },
        uOpacity: { value: 1 },
        uSize: { value: 1 },
        uPixelRatio: { value: pixelRatio },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader,
      fragmentShader,
    });

    const points = new THREE.Points(geometry, material);
    points.position.copy(origin);
    points.frustumCulled = false;
    points.renderOrder = 20;
    scene.add(points);

    const burst = { points, geometry, material, velocities, life: 0, duration, disposed: false };
    bursts.push(burst);
    return burst;
  }

  function disposeBurst(burst) {
    if (burst.disposed) return;
    burst.disposed = true;
    scene.remove(burst.points);
    burst.geometry.dispose();
    burst.material.dispose();
  }

  return {
    spawn(origin, strength = 1) {
      if (bursts.length >= maxBursts) {
        disposeBurst(bursts.shift());
      }
      createBurst(origin, strength);
    },
    setPixelRatio(value) {
      pixelRatio = value;
      for (const b of bursts) b.material.uniforms.uPixelRatio.value = value;
    },
    update(dt) {
      for (let i = bursts.length - 1; i >= 0; i--) {
        const burst = bursts[i];
        burst.life += dt;

        const positions = burst.geometry.attributes.position.array;
        const velocities = burst.velocities;

        for (let p = 0; p < particles; p++) {
          const ix = p * 3;
          velocities[ix + 1] -= 2.4 * dt;
          velocities[ix] *= 0.988;
          velocities[ix + 1] *= 0.992;
          velocities[ix + 2] *= 0.988;

          positions[ix] += velocities[ix] * dt;
          positions[ix + 1] += velocities[ix + 1] * dt;
          positions[ix + 2] += velocities[ix + 2] * dt;
        }
        burst.geometry.attributes.position.needsUpdate = true;

        const k = Math.min(burst.life / burst.duration, 1);
        burst.material.uniforms.uOpacity.value = Math.pow(1 - k, 1.7);
        burst.material.uniforms.uSize.value = 1.0 - k * 0.45;

        if (k >= 1) {
          disposeBurst(burst);
          bursts.splice(i, 1);
        }
      }
    },
    dispose() {
      for (const b of bursts) disposeBurst(b);
      bursts.length = 0;
    },
  };
}
