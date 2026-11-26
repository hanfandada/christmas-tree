import * as THREE from 'three';
import { createGlowTexture } from './textures.js';

/**
 * 天上的流星。
 *
 * 每条流星就是一颗被拉长的软光点（用同一张柔光贴图，横向拉长、按飞行方向
 * 转到屏幕角度），头部再叠一颗更亮更小的。位置在很远的天幕上，
 * 所以只做屏幕空间的角度对齐就够了。
 */

const rand = (min, max) => min + Math.random() * (max - min);

/** 两条流星同时出现的概率很低，各自错开间隔 */
const NEXT_GAP = [2.6, 6.5];

export function createShootingStars({ count = 3 } = {}) {
  const group = new THREE.Group();
  const texture = createGlowTexture(128);
  const meteors = [];

  const headMat = new THREE.SpriteMaterial({
    map: texture,
    color: 0xeaf4ff,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    opacity: 0,
  });
  const tailMat = new THREE.SpriteMaterial({
    map: texture,
    color: 0x9fc4ff,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    opacity: 0,
  });

  for (let i = 0; i < count; i++) {
    const head = new THREE.Sprite(headMat.clone());
    const tail = new THREE.Sprite(tailMat.clone());
    head.renderOrder = 1;
    tail.renderOrder = 1;
    head.visible = false;
    tail.visible = false;
    group.add(head, tail);

    meteors.push({
      head,
      tail,
      active: false,
      wait: rand(1.5, 6),
      t: 0,
      life: 0,
      from: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      length: 0,
    });
  }

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  function spawn(m) {
    // 起点在画面上方偏一侧，飞向右下或左下
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = rand(-18, 18);
    const y = rand(9, 18);
    m.from.set(x, y, rand(-34, -18));
    m.dir.set(-side * rand(0.6, 1.0), -rand(0.45, 0.75), rand(-0.1, 0.1)).normalize();
    m.length = rand(7, 13);
    m.life = rand(0.9, 1.5);
    m.t = 0;
    m.active = true;
    m.head.visible = true;
    m.tail.visible = true;
  }

  function update(dt, camera) {
    for (const m of meteors) {
      if (!m.active) {
        m.wait -= dt;
        if (m.wait <= 0) spawn(m);
        continue;
      }

      m.t += dt;
      const k = m.t / m.life;
      if (k >= 1) {
        m.active = false;
        m.head.visible = false;
        m.tail.visible = false;
        m.wait = rand(NEXT_GAP[0], NEXT_GAP[1]);
        continue;
      }

      // 走完整条路：长度按速度自动算，不用积分
      const dist = m.length * 2.4;
      a.copy(m.from).addScaledVector(m.dir, dist * k);
      b.copy(a).addScaledVector(m.dir, m.length * 0.9);

      // 屏幕空间的角度：把两点投到 NDC，按像素差算倾斜
      const pa = a.clone().project(camera);
      const pb = b.clone().project(camera);
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      const angle = Math.atan2((pb.y - pa.y) * 1, (pb.x - pa.x) * aspect);

      const fade = Math.sin(Math.PI * Math.min(1, k)) ** 0.6;

      m.head.position.copy(b);
      m.head.scale.set(1.1, 1.1, 1);
      m.head.material.rotation = angle;
      m.head.material.opacity = fade * 0.95;

      m.tail.position.copy(a).lerp(b, 0.5);
      m.tail.scale.set(m.length, 0.55, 1);
      m.tail.material.rotation = angle;
      m.tail.material.opacity = fade * 0.5;
    }
  }

  return {
    group,
    update,
    _meteors: meteors,
    dispose() {
      texture.dispose();
      for (const m of meteors) {
        m.head.material.dispose();
        m.tail.material.dispose();
      }
    },
  };
}
