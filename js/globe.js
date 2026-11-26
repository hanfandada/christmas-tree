import * as THREE from 'three';
import { createGlowTexture } from './textures.js';

/**
 * 包着整棵树的一层光球（水晶球）。
 *
 * 第一版只有一层点壳 + 掠射角提亮，结果是"看不出球"：一片发灰的雾。
 * 球形读不出来，是因为它缺了三个关键线索——
 *   1. 轮廓必须连续：纯点云只有 10% 的点落在剪影那圈，成不了干净的圆
 *   2. 球面要有结构：点云是随机均匀的，没有参照物就只是一个盘子
 *   3. 要有光在动：玻璃球最好认的就是高光和经纬环扫过的那一下
 * 所以现在是四层叠起来：
 *   - 点壳：边缘最亮，正对镜头的地方留一点雾，前后分亮度做出深度
 *   - 经纬网格：写在点壳的着色器里，随 uTime 转，球面立刻有方向感
 *   - 菲涅尔球壳：一层极淡的连续网格，把点补不上的轮廓补成一条干净的光边
 *   - 高光点：法线平分"球心→相机"和光线方向，位置随镜头走，像真的在反光
 *
 * 球底在圆台位置淡出，读起来就是"罩在礼物堆上的一个玻璃罩"，而不是浮在半空。
 */

const rand = (min, max) => min + Math.random() * (max - min);
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

/* ------------------------------------------------------------------ *
 * 点壳 + 经纬网格
 * ------------------------------------------------------------------ */

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

    // 掠射角那一圈最亮：球壳只是一层轮廓
    float rim = 1.0 - abs(facing);
    float band = pow(rim, 3.2);
    // 正面再留一点雾，不然球心是空的，只剩一个圆环
    float haze = pow(max(0.0, facing), 5.0) * 0.075;

    // 经纬网格：球面上最容易读出来的参照物，而且让球"转"得出来
    float lat = asin(clamp(aNormal.y, -1.0, 1.0));
    float lon = atan(aNormal.z, aNormal.x) + uTime * 0.05;
    float ring = smoothstep(0.90, 1.0, cos(lat * 5.0));
    float meridian = smoothstep(0.90, 1.0, cos(lon * 8.0));
    float grid = ring + meridian * 0.42;

    float twinkle = 0.55 + 0.45 * sin(uTime * (0.9 + aPhase * 0.5) + aPhase * 7.0);

    // 法线朝向相机的是前面那半层：亮一点、大一点，前后才不会糊成一片
    float front = 0.5 + 0.5 * smoothstep(-0.55, 0.95, facing);
    // 树快亮完的时候球壳才浮出来；球底在圆台位置淡掉
    float reveal = smoothstep(0.6, 1.0, uProgress);
    float bottom = smoothstep(uFade.x, uFade.y, p.y);

    vColor = mix(uCool, uWarm, 0.2 + 0.32 * sin(aPhase * 2.0));
    vAlpha = (0.04 + 0.5 * band + haze)
      * (1.0 + 1.2 * grid)
      * (0.4 + 0.7 * twinkle)
      * reveal * bottom * front;

    gl_PointSize = aSize * uPixelRatio * (0.55 + 0.95 * band + 0.5 * grid)
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
    gl_FragColor = vec4(vColor * (1.0 + falloff * 0.9), alpha);
  }
`;

/* ------------------------------------------------------------------ *
 * 菲涅尔球壳：把点补不上的轮廓补成一条连续的光边
 * ------------------------------------------------------------------ */

const FRESNEL_VERTEX = /* glsl */ `
  uniform vec2 uFade;
  varying float vRim;
  varying float vY;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 vn = normalize(normalMatrix * normal);
    vRim = 1.0 - abs(dot(vn, normalize(mv.xyz)));
    vY = position.y;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRESNEL_FRAGMENT = /* glsl */ `
  uniform float uProgress;
  uniform float uGain;
  uniform vec2 uFade;
  uniform vec3 uTint;
  varying float vRim;
  varying float vY;

  void main() {
    float r = pow(vRim, 4.6);
    float a = (r * uGain + 0.012)
      * smoothstep(0.6, 1.0, uProgress)
      * smoothstep(uFade.x, uFade.y, vY);
    if (a < 0.002) discard;
    gl_FragColor = vec4(uTint * (0.75 + r * 1.2), a);
  }
`;

export function createGlobe({ radius = 6.5, centerY = 0.95, count = 6200 } = {}) {
  const group = new THREE.Group();

  // 球底在圆台台面的高度收口：半径 6.5 的球在 y≈-3.8 处的截面正好等于圆台半径，
  // 从这里往上淡出，玻璃罩看起来就是"扣"在台面上，而不是浮在半空
  const fade = new THREE.Vector2(-4.15, -3.35);

  /* ---------------- 点壳 ---------------- */

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

  /* ---------------- 菲涅尔球壳 ---------------- */

  const shellGeometry = new THREE.SphereGeometry(radius, 72, 54);
  shellGeometry.translate(0, centerY, 0);

  const shellUniforms = {
    uProgress: uniforms.uProgress,
    uFade: { value: fade },
    uGain: { value: 0.34 },
    uTint: { value: new THREE.Color(0xbfd8ff) },
  };

  const shellMaterial = new THREE.ShaderMaterial({
    uniforms: shellUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    vertexShader: FRESNEL_VERTEX,
    fragmentShader: FRESNEL_FRAGMENT,
  });

  const shell = new THREE.Mesh(shellGeometry, shellMaterial);
  shell.frustumCulled = false;
  shell.renderOrder = 0;
  group.add(shell);

  /* ---------------- 高光 ---------------- */

  const glowTexture = createGlowTexture(128);

  function makeGlint(scale, color, order) {
    const glintMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(glintMaterial);
    sprite.scale.setScalar(scale);
    sprite.renderOrder = order;
    sprite.visible = false;
    group.add(sprite);
    return sprite;
  }

  // 主高光：左上，大而柔，像窗光打在玻璃上
  const glintMain = makeGlint(radius * 0.34, 0xfff2d8, 3);
  // 副高光：右下，小而紧，像球底反弹回来的一点光
  const glintKick = makeGlint(radius * 0.15, 0xcfe4ff, 3);

  const center = new THREE.Vector3(0, centerY, 0);
  const camDir = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const lightDir = new THREE.Vector3();
  const half = new THREE.Vector3();

  let progress = 0;
  let revealed = 0;

  return {
    group,

    update(time, camera) {
      uniforms.uTime.value = time;

      // 高光点就是把球面法线转到"正好把光反射进镜头"的那个角度：
      // 法线 = normalize(球心→相机 + 光线方向)。这样它会跟着镜头走，
      // 是"玻璃"最便宜也最有力的一条线索
      if (camera) {
        camDir.setFromMatrixPosition(camera.matrixWorld).sub(center).normalize();
        up.set(0, 1, 0).addScaledVector(camDir, -camDir.y).normalize();
        right.crossVectors(up, camDir).normalize();

        lightDir
          .copy(right)
          .multiplyScalar(-0.42)
          .addScaledVector(up, 0.6)
          .addScaledVector(camDir, 0.68)
          .normalize();
        half.copy(camDir).add(lightDir).normalize();
        glintMain.position.copy(center).addScaledVector(half, radius * 0.97);

        half
          .copy(camDir)
          .multiplyScalar(0.5)
          .addScaledVector(up, -0.64)
          .addScaledVector(right, 0.52)
          .normalize();
        glintKick.position.copy(center).addScaledVector(half, radius * 0.97);
      }

      const visible = revealed > 0.02;
      glintMain.visible = visible;
      glintKick.visible = visible;
      if (visible) {
        const pulse = 0.86 + 0.14 * Math.sin(time * 1.7);
        glintMain.material.opacity = revealed * 0.24 * pulse;
        glintMain.scale.setScalar(radius * 0.34 * (0.94 + 0.06 * pulse));
        glintKick.material.opacity = revealed * 0.3 * (1.86 - pulse);
        glintKick.scale.setScalar(radius * 0.15 * (0.92 + 0.14 * (1.86 - pulse)));
      }
    },

    setProgress(value) {
      uniforms.uProgress.value = value;
      progress = clamp01(value);
      // 球壳收得比点慢半拍，先有点、再连成玻璃
      revealed = clamp01((progress - 0.6) / 0.4);
    },

    setPixelRatio(value) {
      uniforms.uPixelRatio.value = value;
    },

    dispose() {
      geometry.dispose();
      material.dispose();
      shellGeometry.dispose();
      shellMaterial.dispose();
      glowTexture.dispose();
      glintMain.material.dispose();
      glintKick.material.dispose();
      group.clear();
    },
  };
}
