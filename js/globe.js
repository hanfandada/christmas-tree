import * as THREE from 'three';

/**
 * 包着整棵树的一层光晕（雪景球的那层"空气"）。
 *
 * 这条路上走过两个极端，都记在这里，别再走回去：
 *
 *   一版：只有一层点壳 + 掠射角提亮。球面读不出来，看着就是一片散开的雾。
 *   二版：为了把"球"做出来，加了菲涅尔球壳 + 高光 + 均匀的亮边。
 *        结果是一个边界干净、亮度均匀的圆——**一个球被贴在了画面上**。
 *        在满屏加法混合的柔光里，这么硬的一个圆当然格格不入。
 *
 * 结论：要的是"有体积的光",不是"一个球"。
 * 区别全在边界上——球的边界是一条连续的等亮线，而光没有边界。
 * 所以现在：
 *   - 掠射角提亮保留（远处薄、中间透，体积感全靠它），但**不连续**：
 *     按经纬分成几段明暗，轮廓被拆成一节一节，读起来是光在球面上流动，
 *     而不是一个圆环
 *   - 经纬网格保留（球面有参照物，转起来才看得出来），但压得很淡
 *   - 前后两半层分亮度（朝向镜头的那半更亮更大），深度靠这个立
 *   - 不再有连续的网格球壳，也不再有高光点
 *
 * 球底在圆台台面高度淡出，不要露出一条地平线似的硬边。
 */

const rand = (min, max) => min + Math.random() * (max - min);

const SHELL_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform float uPixelRatio;
  uniform vec2 uFade;
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
    p += aNormal * sin(uTime * 0.5 + aPhase * 3.0) * 0.05;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    vec3 viewN = normalize((modelViewMatrix * vec4(aNormal, 0.0)).xyz);
    float facing = dot(viewN, normalize(mv.xyz));

    // 掠射角那一圈最亮：远处薄、中间透，体积感全靠这一条
    float rim = 1.0 - abs(facing);
    float band = pow(rim, 2.2);

    float lat = asin(clamp(aNormal.y, -1.0, 1.0));
    float lon = atan(aNormal.z, aNormal.x) + uTime * 0.05;

    // ★ 关键：把轮廓拆成一段一段。
    // 均匀的一圈读出来是"剪影"，剪影就是球；分成几段明暗之后，
    // 边界时而亮时而熄灭，才像一层光而不是一层壳
    float sectors = 0.5 + 0.5 * sin(lon * 3.0 + uTime * 0.16);
    float caps = 0.5 + 0.5 * sin(lat * 2.6 + 1.1);
    float broken = 0.18 + 0.82 * mix(sectors, caps, 0.4);

    // 经纬网格：球面上最容易读出来的参照物，而且让球"转"得出来
    float gridRing = smoothstep(0.90, 1.0, cos(lat * 5.0));
    float gridMeridian = smoothstep(0.90, 1.0, cos(lon * 8.0));
    float grid = gridRing + gridMeridian * 0.4;
    // 球面内部也留一点薄雾：只有一圈边的话，中间是空的
    float haze = pow(max(0.0, facing), 4.0) * 0.07;

    float twinkle = 0.55 + 0.45 * sin(uTime * (0.9 + aPhase * 0.5) + aPhase * 7.0);

    // 法线朝向相机的是前面那半层：亮一点、大一点，前后才不会糊成一片
    float front = 0.45 + 0.55 * smoothstep(-0.6, 0.95, facing);
    // 树快亮完的时候才浮出来；球底在圆台位置淡掉
    float reveal = smoothstep(0.6, 1.0, uProgress);
    float bottom = smoothstep(uFade.x, uFade.y, p.y);

    vColor = mix(uCool, uWarm, 0.2 + 0.32 * sin(aPhase * 2.0));
    vAlpha = (0.03 + 0.95 * band * broken + haze)
      * (1.0 + 1.25 * grid)
      * (0.4 + 0.7 * twinkle)
      * reveal * bottom * front;

    gl_PointSize = aSize * uPixelRatio * (0.5 + 0.9 * band + 0.45 * grid)
      * (26.0 / max(0.6, -mv.z));
  }
`;

const SHELL_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float falloff = smoothstep(0.5, 0.0, d);
    float alpha = falloff * vAlpha;
    if (alpha < 0.006) discard;
    gl_FragColor = vec4(vColor * (1.0 + falloff * 0.75), alpha);
  }
`;

export function createGlobe({ radius = 6.5, centerY = 0.95, count = 6800 } = {}) {
  const group = new THREE.Group();

  // 球底在圆台台面的高度收口：再往下就是台子里面了，
  // 在这里淡掉，球才像是从礼物堆里长出来的，而不是浮在半空
  const fade = new THREE.Vector2(-4.15, -3.35);

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
    uFade: { value: fade },
    uCool: { value: new THREE.Color(0x9fc8ff) },
    uWarm: { value: new THREE.Color(0xffd9a0) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: SHELL_VERTEX,
    fragmentShader: SHELL_FRAGMENT,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;
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
      group.clear();
    },
  };
}
