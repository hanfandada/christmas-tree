import * as THREE from 'three';
import { TREE } from './config.js';
import { createGlowTexture } from './textures.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_PHOTOS = 60;
const RIBBON_COLOR = 0xe0b169;
// 照片主色太灰时，退回一组节日配色，避免树上挂一排"白盒子"
const FESTIVE = [0xc8443f, 0xd08a3c, 0x2f8f63, 0x3f6fc4, 0xa8478c];

/**
 * 礼物盒挂饰。
 *
 * 树上挂的不是照片，而是一个个小礼盒；照片藏在盒子里。
 * 平时：小小一个盒子（颜色取自照片主色），安静挂在枝头。
 * 悬停：盒子放大、轻微晃动、盒盖翘起，周围洒粒子。
 * 点击：盒盖弹开、炸出一簇金色火光，照片从盒子里飞出、放大到页面中间。
 */
export function createPhotoOrnaments(world, { onSparkle } = {}) {
  const group = new THREE.Group();
  world.add(group);

  const glowTexture = createGlowTexture(128);

  /* ---------------- 共用几何体 ---------------- */

  const bodyGeometry = new THREE.BoxGeometry(1, 0.78, 1);
  const lidGeometry = new THREE.BoxGeometry(1.1, 0.14, 1.1);
  const ribbonGeometryV = new THREE.BoxGeometry(0.16, 0.8, 1.03);
  const ribbonGeometryH = new THREE.BoxGeometry(1.03, 0.8, 0.16);
  const lidRibbonGeometryV = new THREE.BoxGeometry(0.16, 0.16, 1.12);
  const lidRibbonGeometryH = new THREE.BoxGeometry(1.12, 0.16, 0.16);
  const bowGeometry = new THREE.TorusGeometry(0.115, 0.038, 8, 18);
  const stringGeometry = new THREE.PlaneGeometry(0.02, 0.3);

  const vertexShader = /* glsl */ `
    varying vec3 vNormalW;
    varying vec3 vLocal;
    void main() {
      vLocal = position;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  // 没有真实灯光，用最便宜的假光照：一个固定方向 + 一点自发光
  const fragmentShader = /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uGlow;
    varying vec3 vNormalW;
    varying vec3 vLocal;

    void main() {
      vec3 n = normalize(vNormalW);
      float lambert = clamp(dot(n, normalize(vec3(0.45, 0.8, 0.55))), 0.0, 1.0);
      float rim = pow(1.0 - abs(n.z), 2.0);
      float gradient = 0.82 + 0.34 * smoothstep(-0.42, 0.46, vLocal.y);
      vec3 color = uColor * (0.45 + 0.62 * lambert) * gradient;
      color += uColor * uGlow * 0.55;
      color += uColor * rim * 0.12;
      gl_FragColor = vec4(color, uOpacity);
    }
  `;

  /** 环绕礼物飘的光尘：绕盒子缓慢转、一边上升一边闪 */
  function makeSparkles(color) {
    const count = 64;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const radii = new Float32Array(count);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      phases[i] = Math.random();
      speeds[i] = 0.55 + Math.random() * 1.1;
      radii[i] = 0.5 + Math.random() * 0.8;
      sizes[i] = 0.7 + Math.random() * 1.6;
      offsets[i] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aHeight', new THREE.BufferAttribute(offsets, 1));

    const uniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uIntensity: { value: 0.25 },
      uColor: { value: color.clone().lerp(new THREE.Color(0xffd79a), 0.45) },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPixelRatio;
        uniform float uIntensity;

        attribute float aPhase;
        attribute float aSpeed;
        attribute float aRadius;
        attribute float aSize;
        attribute float aHeight;

        varying float vAlpha;

        void main() {
          float life = fract(aHeight + uTime * aSpeed * 0.22);
          float angle = aPhase * 6.2831853 + uTime * (0.45 + aSpeed * 0.55);
          float radius = aRadius * (0.85 + 0.18 * sin(uTime * 1.2 + aPhase * 9.0));
          float y = -0.18 + life * 1.55;

          vec3 p = vec3(cos(angle) * radius, y, sin(angle) * radius);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;

          float twinkle = 0.5 + 0.5 * sin(uTime * 2.6 + aPhase * 14.0);
          vAlpha = sin(life * 3.14159) * (0.3 + 0.7 * twinkle) * uIntensity;
          gl_PointSize = aSize * uPixelRatio * (42.0 / max(0.6, -mv.z)) * (0.7 + 0.6 * twinkle);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;

        void main() {
          float d = length(gl_PointCoord - 0.5);
          float falloff = smoothstep(0.5, 0.0, d);
          float alpha = falloff * vAlpha;
          if (alpha < 0.008) discard;
          gl_FragColor = vec4(uColor * 1.5, alpha);
        }
      `,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 7;
    return { points, uniforms, geometry, material };
  }

  function makeMaterial(color) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 1 },
        uGlow: { value: 0 },
      },
      transparent: true,
      depthWrite: true,
      vertexShader,
      fragmentShader,
    });
  }

  /* ---------------- 开盒冲击波 ---------------- */

  const ringGeometry = new THREE.RingGeometry(0.6, 0.645, 64);
  const rings = [];

  function spawnRing(item) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffd79a,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(ringGeometry, material);
    mesh.position.copy(item.group.position);
    mesh.renderOrder = 8;
    group.add(mesh);
    rings.push({
      mesh,
      material,
      life: 0,
      duration: 0.6,
      startScale: Math.max(0.2, item.group.scale.x * 0.9),
    });
  }

  /* ---------------- 状态 ---------------- */

  const items = new Map();
  const order = [];
  let hoveredId = null;
  let sparkleAt = 0;
  let pixelRatio = 1;

  function slotFor(index, total) {
    const t = 0.12 + 0.74 * ((index + 0.5) / Math.max(total, 1));
    const angle = index * GOLDEN_ANGLE + 0.35;
    const radius = TREE.baseRadius * Math.pow(1 - t, 0.94) * 1.22;
    return new THREE.Vector3(
      Math.cos(angle) * radius,
      TREE.baseY + t * TREE.height,
      Math.sin(angle) * radius
    );
  }

  function sizeFor(total) {
    return THREE.MathUtils.clamp(0.52 * Math.pow(6 / Math.max(total, 1), 0.14), 0.34, 0.52);
  }

  function reflow() {
    const total = order.length;
    const size = sizeFor(total);
    order.forEach((id, index) => {
      const item = items.get(id);
      item.slot.copy(slotFor(index, total));
      item.targetScale = size;
    });
  }

  /* ---------------- 创建 / 销毁 ---------------- */

  function add(id, color, { spawnFrom = null, animate = true } = {}) {
    if (items.has(id) || items.size >= MAX_PHOTOS) return null;

    const itemGroup = new THREE.Group();
    itemGroup.userData.photoId = id;

    // 用照片主色给礼物上色；太灰就换成节日配色
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    const sourceColor = hsl.s < 0.12 ? new THREE.Color(FESTIVE[order.length % FESTIVE.length]) : color;
    const baseColor = sourceColor.clone().offsetHSL(0, 0.24, -0.05).multiplyScalar(0.5);

    const bodyMaterial = makeMaterial(baseColor);
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.renderOrder = 6;
    itemGroup.add(body);

    // 盒盖（连同盖子上的丝带和蝴蝶结一起动）
    const lid = new THREE.Group();
    lid.position.y = 0.46;

    const lidMaterial = makeMaterial(baseColor.clone().multiplyScalar(1.12));
    const lidMesh = new THREE.Mesh(lidGeometry, lidMaterial);
    lid.add(lidMesh);

    const ribbonMaterial = makeMaterial(new THREE.Color(RIBBON_COLOR).multiplyScalar(0.75));
    const lidRibbonV = new THREE.Mesh(lidRibbonGeometryV, ribbonMaterial);
    lidRibbonV.position.y = 0.02;
    const lidRibbonH = new THREE.Mesh(lidRibbonGeometryH, ribbonMaterial);
    lidRibbonH.position.y = 0.02;
    lid.add(lidRibbonV, lidRibbonH);

    const bowMaterial = makeMaterial(new THREE.Color(RIBBON_COLOR).multiplyScalar(0.8));
    const bowLeft = new THREE.Mesh(bowGeometry, bowMaterial);
    bowLeft.position.set(-0.1, 0.14, 0);
    bowLeft.rotation.set(0, 0.5, 0.6);
    const bowRight = new THREE.Mesh(bowGeometry, bowMaterial);
    bowRight.position.set(0.1, 0.14, 0);
    bowRight.rotation.set(0, -0.5, -0.6);
    lid.add(bowLeft, bowRight);

    itemGroup.add(lid);

    // 盒身竖向丝带
    const bodyRibbonV = new THREE.Mesh(ribbonGeometryV, ribbonMaterial);
    const bodyRibbonH = new THREE.Mesh(ribbonGeometryH, ribbonMaterial);
    bodyRibbonV.renderOrder = 6;
    bodyRibbonH.renderOrder = 6;
    itemGroup.add(bodyRibbonV, bodyRibbonH);

    // 挂绳
    const stringMaterial = makeMaterial(0xcbb894);
    stringMaterial.uniforms.uOpacity.value = 0.22;
    const string = new THREE.Mesh(stringGeometry, stringMaterial);
    string.position.y = 0.84;
    itemGroup.add(string);

    const sparkles = makeSparkles(baseColor);
    itemGroup.add(sparkles.points);

    // 盒子外圈的柔光，让礼物在暗处也有一圈呼吸感
    const auraMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: baseColor.clone().lerp(new THREE.Color(0xffe6b8), 0.35),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.16,
    });
    const aura = new THREE.Sprite(auraMaterial);
    aura.scale.setScalar(2.0);
    aura.renderOrder = 5;
    itemGroup.add(aura);

    // 盒子里的光（打开时溢出）
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: baseColor.clone().lerp(new THREE.Color(0xfff0c8), 0.5),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    const glow = new THREE.Sprite(glowMaterial);
    glow.position.y = 0.3;
    glow.scale.setScalar(1.6);
    glow.renderOrder = 5;
    itemGroup.add(glow);

    const item = {
      id,
      group: itemGroup,
      lid,
      glow,
      aura,
      auraMaterial,
      sparkles,
      bodyMaterial,
      lidMaterial,
      ribbonMaterial,
      bowMaterial,
      stringMaterial,
      glowMaterial,
      slot: new THREE.Vector3(),
      targetScale: 0.4,
      spawnFrom: spawnFrom ? spawnFrom.clone() : null,
      progress: animate ? 0 : 1,
      phase: Math.random() * Math.PI * 2,
      hover: 0,
      hoverTarget: 0,
      open: 0,
      openTarget: 0,
    };

    itemGroup.position.copy(item.spawnFrom || slotFor(order.length, order.length + 1));
    itemGroup.scale.setScalar(animate ? 0.05 : item.targetScale);

    items.set(id, item);
    order.push(id);
    group.add(itemGroup);
    reflow();

    if (!animate) {
      itemGroup.position.copy(item.slot);
      itemGroup.scale.setScalar(item.targetScale);
    }

    return item;
  }

  function remove(id) {
    const item = items.get(id);
    if (!item) return;
    items.delete(id);
    const index = order.indexOf(id);
    if (index >= 0) order.splice(index, 1);
    group.remove(item.group);
    item.bodyMaterial.dispose();
    item.lidMaterial.dispose();
    item.ribbonMaterial.dispose();
    item.bowMaterial.dispose();
    item.stringMaterial.dispose();
    item.glowMaterial.dispose();
    item.auraMaterial.dispose();
    item.sparkles.geometry.dispose();
    item.sparkles.material.dispose();
    reflow();
  }

  function clear() {
    for (const id of [...order]) remove(id);
  }

  /* ---------------- 每帧更新 ---------------- */

  const cameraLocal = new THREE.Vector3();

  function update(time, dt, cameraWorld) {
    const easeOut = (x) => 1 - Math.pow(1 - x, 3);
    if (cameraWorld && group.parent) {
      cameraLocal.copy(cameraWorld);
      group.parent.worldToLocal(cameraLocal);
    }

    for (let i = rings.length - 1; i >= 0; i--) {
      const ring = rings[i];
      ring.life += dt;
      const k = Math.min(1, ring.life / ring.duration);
      ring.mesh.scale.setScalar(ring.startScale * (1 + k * 3.2));
      ring.material.opacity = Math.pow(1 - k, 2.2) * 0.55;
      ring.mesh.lookAt(cameraLocal);
      if (k >= 1) {
        group.remove(ring.mesh);
        ring.material.dispose();
        rings.splice(i, 1);
      }
    }

    for (const item of items.values()) {
      // 飞入 / 归位
      if (item.progress < 1) {
        item.progress = Math.min(1, item.progress + dt / 0.85);
        const k = easeOut(item.progress);
        if (item.spawnFrom) item.group.position.lerpVectors(item.spawnFrom, item.slot, k);
        else item.group.position.copy(item.slot);
        item.group.scale.setScalar(0.05 + (item.targetScale - 0.05) * k);
      } else {
        item.group.position.lerp(item.slot, Math.min(1, dt * 2.2));
        item.hover += (item.hoverTarget - item.hover) * Math.min(1, dt * 9);
        const desired = item.targetScale * (1 + item.hover * 0.85);
        const current = item.group.scale.x;
        item.group.scale.setScalar(current + (desired - current) * Math.min(1, dt * 6));
      }

      // 开合进度
      item.open += (item.openTarget - item.open) * Math.min(1, dt * 7);

      const pulse = 0.5 + 0.5 * Math.sin(time * 1.5 + item.phase);

      // 盒盖：悬停微翘，点击弹开
      const lift = item.hover * 0.06 + item.open * 0.72;
      item.lid.position.y = 0.46 + lift;
      item.lid.rotation.z = item.open * 0.9 + item.hover * 0.06;
      item.lid.rotation.x = item.open * 0.28;
      item.lidMaterial.uniforms.uOpacity.value = 1 - item.open * 0.65;

      // 盒身：打开时内部透出暖光
      item.bodyMaterial.uniforms.uGlow.value = item.open * 0.5 + item.hover * 0.08 + 0.03 * pulse;
      item.glowMaterial.opacity = item.open * 0.85;
      item.glow.scale.setScalar(1.2 + item.open * 1.6);

      // 光尘：平时微弱，悬停变亮，开盒时喷一层
      const sparkle = item.sparkles.uniforms;
      sparkle.uTime.value = time;
      sparkle.uPixelRatio.value = pixelRatio;
      sparkle.uIntensity.value = 0.32 + item.hover * 1.7 + item.open * 2.2;
      item.auraMaterial.opacity = 0.12 + 0.14 * pulse + item.hover * 0.45 + item.open * 0.5;
      item.aura.scale.setScalar(1.9 + item.hover * 0.5 + item.open * 0.9);

      // 悬停时轻轻晃
      item.group.rotation.z = Math.sin(time * 3.2 + item.phase) * 0.05 * item.hover;

      // 朝向相机
      const dx = cameraLocal.x - item.group.position.x;
      const dz = cameraLocal.z - item.group.position.z;
      item.group.rotation.y = Math.atan2(dx, dz);

      // 转到背面淡出
      const normal = Math.hypot(item.group.position.x, item.group.position.z);
      let facing = 1;
      if (normal > 0.0001) {
        const nx = item.group.position.x / normal;
        const nz = item.group.position.z / normal;
        const len = Math.hypot(dx, dz) || 1;
        facing = nx * (dx / len) + nz * (dz / len);
      }
      const visibility = THREE.MathUtils.smoothstep(facing, -0.05, 0.3);
      item.group.visible = visibility > 0.02;

      item.bodyMaterial.uniforms.uOpacity.value = visibility;
      item.lidMaterial.uniforms.uOpacity.value = (1 - item.open * 0.65) * visibility;
      item.ribbonMaterial.uniforms.uOpacity.value = visibility;
      item.bowMaterial.uniforms.uOpacity.value = visibility;
      item.stringMaterial.uniforms.uOpacity.value = (0.18 + item.hover * 0.25) * visibility;
      item.glowMaterial.opacity = item.open * 0.85 * visibility;

      // 悬停时朝观众浮出一点，并持续洒粒子
      if (item.hover > 0.01) {
        const fx = cameraLocal.x - item.group.position.x;
        const fy = cameraLocal.y - item.group.position.y;
        const fz = cameraLocal.z - item.group.position.z;
        const len = Math.hypot(fx, fy, fz) || 1;
        item.group.position.x += (fx / len) * item.hover * 0.22;
        item.group.position.y += (fy / len) * item.hover * 0.22;
        item.group.position.z += (fz / len) * item.hover * 0.22;
      }

      if (item.hover > 0.4 && onSparkle && time - sparkleAt > 0.18) {
        sparkleAt = time;
        onSparkle(item.group.getWorldPosition(new THREE.Vector3()));
      }
    }
  }

  function pick(raycaster) {
    const meshes = [];
    for (const item of items.values()) {
      if (item.group.visible) meshes.push(item.group);
    }
    const hits = raycaster.intersectObjects(meshes, true);
    if (!hits.length) return null;

    let node = hits[0].object;
    while (node && !node.userData.photoId) node = node.parent;
    return node ? node.userData.photoId : null;
  }

  return {
    group,
    add,
    remove,
    clear,
    update,
    pick,
    setHover(id) {
      if (hoveredId === id) return;
      hoveredId = id;
      for (const item of items.values()) item.hoverTarget = item.id === id ? 1 : 0;
    },
    setPixelRatio(value) {
      pixelRatio = value;
    },
    setOpen(id, open) {
      const item = items.get(id);
      if (!item) return;
      if (open && item.openTarget !== 1) spawnRing(item);
      item.openTarget = open ? 1 : 0;
    },
    getPosition(id) {
      const item = items.get(id);
      return item ? item.group.getWorldPosition(new THREE.Vector3()) : null;
    },
    getScreenRect(id, camera, width, height) {
      const item = items.get(id);
      if (!item) return null;
      const position = item.group.getWorldPosition(new THREE.Vector3());
      const projected = position.clone().project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;

      const edge = position.clone().add(new THREE.Vector3(0, item.group.scale.x, 0));
      const edgeProjected = edge.project(camera);
      const edgeY = (-edgeProjected.y * 0.5 + 0.5) * height;
      const size = Math.abs(edgeY - y) * 2;

      return { x, y, size };
    },
    getDebug() {
      return [...items.values()].map((i) => ({
        id: i.id,
        visible: i.group.visible,
        hover: +i.hover.toFixed(2),
        open: +i.open.toFixed(2),
        scale: +i.group.scale.x.toFixed(3),
      }));
    },
    get count() {
      return items.size;
    },
    get max() {
      return MAX_PHOTOS;
    },
    dispose() {
      clear();
      bodyGeometry.dispose();
      lidGeometry.dispose();
      ribbonGeometryV.dispose();
      ribbonGeometryH.dispose();
      lidRibbonGeometryV.dispose();
      lidRibbonGeometryH.dispose();
      bowGeometry.dispose();
      stringGeometry.dispose();
      ringGeometry.dispose();
      glowTexture.dispose();
    },
  };
}
