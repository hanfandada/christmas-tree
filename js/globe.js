import * as THREE from 'three';

/**
 * 包着整棵树的一层光球（水晶球）。
 *
 * 参考图里最抓眼的就是这一层：一个由细碎星光组成的球壳，边缘最亮，
 * 里面的树像被装在水晶球里。做法和丝带的"掠射角"一样——
 * 法线几乎垂直于视线的那一圈最亮，正对镜头的地方几乎透明，
 * 所以它只是一个轮廓，不会挡住树。
 */

const rand = (min, max) => min + Math.random() * (max - min);

export function createGlobe({ radius = 7.1, centerY = 1.2, count = 5600 } = {}) {
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // 球面均匀采样
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);

    const nx = Math.cos(theta) * r;
    const ny = u;
    const nz = Math.sin(theta) * r;

    // 壳有一点点厚度，不然像一层纸
    const radius2 = radius * rand(0.985, 1.015);

    positions[i * 3] = nx * radius2;
    positions[i * 3 + 1] = centerY + ny * radius2;
    positions[i * 3 + 2] = nz * radius2;

    normals[i * 3] = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;

    sizes[i] = rand(0.5, 1.9);
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aNormal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uPixelRatio: { value: 1 },
    uCool: { value: new THREE.Color(0x9fc8ff) },
    uWarm: { value: new THREE.Color(0xffd9a0) },
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
      uniform vec3 uCool;
      uniform vec3 uWarm;

      attribute vec3 aNormal;
      attribute float aSize;
      attribute float aPhase;

      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        // 极轻的呼吸，球壳才不是一块死掉的玻璃
        p += aNormal * sin(uTime * 0.5 + aPhase * 3.0) * 0.06;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        vec3 viewN = normalize((modelViewMatrix * vec4(aNormal, 0.0)).xyz);
        float facing = dot(viewN, normalize(mv.xyz));

        // 掠射角那一圈最亮：球壳只是一层轮廓
        float rim = pow(1.0 - abs(facing), 3.2);

        float twinkle = 0.55 + 0.45 * sin(uTime * (0.9 + aPhase * 0.5) + aPhase * 7.0);

        vColor = mix(uCool, uWarm, 0.25 + 0.3 * sin(aPhase * 2.0));
        // 树快亮完的时候球壳才浮出来
        float reveal = smoothstep(0.6, 1.0, uProgress);
        vAlpha = (0.1 + 1.1 * rim) * (0.35 + 0.75 * twinkle) * reveal;

        gl_PointSize = aSize * uPixelRatio * (0.65 + 0.9 * rim) * (26.0 / max(0.6, -mv.z));
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
        gl_FragColor = vec4(vColor * (1.0 + falloff * 0.8), alpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;

  const group = new THREE.Group();
  group.add(points);

  return {
    group,
    update(time) {
      uniforms.uTime.value = time;
      // 自己慢慢转，和树的转速错开，两层才不会像焊在一起
      group.rotation.y = time * 0.035;
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
