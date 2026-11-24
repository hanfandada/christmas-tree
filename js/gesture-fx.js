/**
 * 手势反馈特效层（Canvas 2D，贴在主画布上）。
 *
 * 全部用粒子拼，不用整块贴图：
 *  - 比心：心形轮廓 + 内部填充几百颗光点，从外围飞入、呼吸、再炸开
 *  - 竖大拇指：把 👍 的剪影采样成点云，同样用光点拼出来（不画 emoji）
 *  - 冲击波也是点组成的环，不是实线圆
 *  - 再加一层飞散星火，带拖尾
 *
 * 用 2D canvas 而不是 WebGL：纯屏幕空间 UI 反馈，粒子和发光都能直接调。
 */

const TAU = Math.PI * 2;
const LIFE = { heart: 2.0, thumb: 1.9, pulse: 1.0 };

const isSmallScreen = () => Math.min(window.innerWidth, window.innerHeight) < 620;

/* ---------------- 形状采样 ---------------- */

/** 心形参数方程，归一化到 [-1, 1]（+y 朝上） */
function sampleHeartOutline(steps = 260) {
  const raw = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    raw.push([
      16 * Math.pow(Math.sin(a), 3),
      13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a),
    ]);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of raw) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const span = (maxX - minX) / 2 || 1;
  const cx = (maxX + minX) / 2;
  const cy = (maxY + minY) / 2;
  // 等比缩放：心形是宽 > 高，不能按两个轴分别拉成正方形
  return raw.map(([x, y]) => [(x - cx) / span, (y - cy) / span]);
}

const HEART_OUTLINE = sampleHeartOutline();

/**
 * 心形点云：轮廓密一点（形状才清楚），内部稀一点（有体积感），
 * 再撒一圈更暗的浮尘。
 */
/** 射线法判断点是否在心形内部，用来做均匀填充 */
function insideHeart(x, y) {
  let inside = false;
  for (let i = 0, j = HEART_OUTLINE.length - 1; i < HEART_OUTLINE.length; j = i++) {
    const [xi, yi] = HEART_OUTLINE[i];
    const [xj, yj] = HEART_OUTLINE[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function buildHeartPoints(total) {
  const rim = Math.round(total * 0.5);
  const fill = Math.round(total * 0.35);
  const dust = total - rim - fill;
  const points = [];

  for (let i = 0; i < rim; i++) {
    const [x, y] = HEART_OUTLINE[(Math.random() * HEART_OUTLINE.length) | 0];
    points.push({
      x: x + rand(-0.02, 0.02),
      y: y + rand(-0.02, 0.02),
      size: rand(6, 12),
      depth: rand(0.6, 1.15),
      seed: Math.random(),
      tint: Math.random() < 0.3 ? 'white' : Math.random() < 0.18 ? 'gold' : 'pink',
    });
  }

  // 内部用拒绝采样填，避免把轮廓点按比例缩向中心、在竖中线上堆出一条线
  let placed = 0;
  let guard = 0;
  while (placed < fill && guard < fill * 60) {
    guard += 1;
    const x = rand(-1, 1);
    const y = rand(-0.72, 0.72);
    if (!insideHeart(x, y)) continue;
    placed += 1;
    points.push({
      x,
      y,
      size: rand(4, 7.8),
      depth: rand(0.5, 0.95),
      seed: Math.random(),
      tint: Math.random() < 0.12 ? 'white' : Math.random() < 0.2 ? 'gold' : 'pink',
    });
  }

  for (let i = 0; i < dust; i++) {
    const [x, y] = HEART_OUTLINE[(Math.random() * HEART_OUTLINE.length) | 0];
    const k = rand(1.02, 1.5);
    points.push({
      x: x * k,
      y: y * k,
      size: rand(2, 4.2),
      depth: rand(0.2, 0.6),
      seed: Math.random(),
      tint: Math.random() < 0.5 ? 'pink' : 'gold',
    });
  }

  return finishPoints(points);
}

/** 把 👍 画进离屏画布，按 alpha 采样成点云：边缘点亮、内部点暗 */
function buildThumbPoints(total) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(size * 0.72)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.fillText('👍', size / 2, size * 0.52);

  const data = ctx.getImageData(0, 0, size, size).data;
  const alphaAt = (x, y) => data[(y * size + x) * 4 + 3];

  const rim = [];
  const inner = [];
  const step = 2;
  for (let y = step; y < size - step; y += step) {
    for (let x = step; x < size - step; x += step) {
      if (alphaAt(x, y) < 150) continue;
      const edge =
        Math.min(alphaAt(x - step, y), alphaAt(x + step, y), alphaAt(x, y - step), alphaAt(x, y + step)) < 150;
      (edge ? rim : inner).push([x / size, y / size]);
    }
  }

  const pick = [];
  const rimCount = Math.round(total * 0.58);
  for (let i = 0; i < rimCount && rim.length; i++) {
    pick.push({ p: rim[(Math.random() * rim.length) | 0], edge: true });
  }
  for (let i = pick.length; i < total && inner.length; i++) {
    pick.push({ p: inner[(Math.random() * inner.length) | 0], edge: false });
  }

  // 归一化到 [-0.5, 0.5]（保持长宽比）
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { p } of pick) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const span = Math.max(spanX, spanY);
  const cx = (maxX + minX) / 2;
  const cy = (maxY + minY) / 2;

  return finishPoints(
    pick.map(({ p, edge }) => ({
      x: (p[0] - cx) / span,
      y: (p[1] - cy) / span,
      size: edge ? rand(5.5, 9.5) : rand(2.6, 5),
      depth: edge ? rand(0.75, 1.15) : rand(0.3, 0.7),
      seed: Math.random(),
      tint: edge ? (Math.random() < 0.45 ? 'white' : 'gold') : Math.random() < 0.5 ? 'amber' : 'gold',
    }))
  );
}

/** 补上散开方向和闪烁相位 */
function finishPoints(points) {
  for (const p of points) {
    const len = Math.hypot(p.x, p.y) || 1;
    p.dx = p.x / len;
    p.dy = p.y / len;
    p.phase = Math.random() * TAU;
    p.spin = rand(-0.6, 0.6);
  }
  return points;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}

/** 圆形光点贴图（不再是整块心/emoji） */
function makeDotSprite(rgb) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.22, `rgba(${rgb}, 0.98)`);
  gradient.addColorStop(0.55, `rgba(${rgb}, 0.5)`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/* ---------------- 主入口 ---------------- */

export function createGestureFx() {
  const dots = {
    pink: makeDotSprite('255, 42, 94'),
    rose: makeDotSprite('255, 118, 150'),
    gold: makeDotSprite('255, 196, 96'),
    amber: makeDotSprite('255, 154, 74'),
    white: makeDotSprite('255, 238, 246'),
  };

  const heartPoints = buildHeartPoints(isSmallScreen() ? 580 : 1200);
  let thumbPoints = null; // 第一次用到再采样，省启动开销

  const canvas = document.createElement('canvas');
  canvas.className = 'fx-layer';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  (document.getElementById('app') || document.body).appendChild(canvas);

  const viewport = { width: window.innerWidth, height: window.innerHeight, pixelRatio: 1 };
  let baseScale = 110;

  const bursts = [];
  let lastDraw = null;
  let pointer = null;
  let pointerAlpha = 0;
  let ringProgress = 0;
  let needsClear = false;

  function resize() {
    canvas.width = Math.round(viewport.width * viewport.pixelRatio);
    canvas.height = Math.round(viewport.height * viewport.pixelRatio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    ctx.setTransform(viewport.pixelRatio, 0, 0, viewport.pixelRatio, 0, 0);
    needsClear = true;
  }

  /* ---------------- 追踪准星 ---------------- */

  function drawPointer(time) {
    pointerAlpha += ((pointer ? 1 : 0) - pointerAlpha) * 0.18;
    ringProgress += ((pointer?.progress ?? 0) - ringProgress) * 0.24;
    if (pointerAlpha < 0.01 && !pointer) return;

    const x = pointer?.x ?? 0;
    const y = pointer?.y ?? 0;
    // 握拳 / 张开手掌走冷白色，和比心的玫瑰色、大拇指的金色区分开
    const isPalm = pointer?.kind === 'fist' || pointer?.kind === 'open';
    const tint = isPalm ? 'white' : pointer?.kind === 'thumb' ? 'gold' : 'rose';
    const fillTint = isPalm ? 'gold' : pointer?.kind === 'thumb' ? 'amber' : 'pink';
    const radius = 30;

    ctx.globalCompositeOperation = 'lighter';

    // 12 个点围成的追踪环，比实线更像粒子
    const spin = time * 0.9;
    for (let i = 0; i < 12; i++) {
      const a = spin + (i / 12) * TAU;
      const twinkle = 0.55 + 0.45 * Math.sin(time * 6 + i);
      ctx.globalAlpha = pointerAlpha * 0.5 * twinkle;
      const s = 5;
      ctx.drawImage(dots[tint], x + Math.cos(a) * radius - s / 2, y + Math.sin(a) * radius - s / 2, s, s);
    }

    if (ringProgress > 0.02) {
      const arcDots = 26;
      ctx.globalAlpha = pointerAlpha * 0.95;
      for (let i = 0; i < arcDots * ringProgress; i++) {
        const a = -Math.PI / 2 + (i / arcDots) * TAU;
        const s = 7;
        ctx.drawImage(
          dots[fillTint],
          x + Math.cos(a) * radius - s / 2,
          y + Math.sin(a) * radius - s / 2,
          s,
          s
        );
      }
    }

    ctx.globalAlpha = pointerAlpha * 0.9;
    ctx.drawImage(dots.white, x - 3, y - 3, 6, 6);
  }

  /* ---------------- 粒子形状 ---------------- */

  function drawShape(burst, time) {
    const life = LIFE[burst.kind];
    const p = Math.min(burst.age / life, 1);
    const assemble = Math.min(p / 0.2, 1);
    const settle = easeOutCubic(assemble);
    const scatter = Math.max(0, (p - 0.62) / 0.38);
    const fade = 1 - Math.max(0, (p - 0.7) / 0.3);
    const envelope = Math.min(p / 0.08, 1) * fade;

    const scale =
      baseScale * (0.85 + 0.25 * settle) * (1 + 0.05 * Math.sin(time * 5)) * (burst.kind === 'thumb' ? 1.2 : 1.12);
    const rise = p * p * 40;
    const rot = Math.sin(time * 0.7 + burst.seed) * 0.04;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    const points = burst.kind === 'thumb' ? thumbPoints : heartPoints;
    // 心形来自数学坐标（y 朝上），canvas 的 y 朝下，要翻一下；大拇指的剪影本来就是屏幕坐标
    const ySign = burst.kind === 'thumb' ? 1 : -1;

    // 核心柔光：几颗大号软点，不画实心贴图也能有体积
    const coreCount = 5;
    for (let i = 0; i < coreCount; i++) {
      const a = (i / coreCount) * TAU + time * 0.2;
      const r = scale * 0.16 * (i % 2 === 0 ? 1 : -0.6);
      const coreSize = scale * rand(0.7, 1.1);
      ctx.globalAlpha = envelope * 0.24;
      ctx.drawImage(
        dots[burst.kind === 'thumb' ? 'amber' : 'rose'],
        burst.x + Math.cos(a) * r - coreSize / 2,
        burst.y + Math.sin(a) * r - rise - coreSize / 2,
        coreSize,
        coreSize
      );
    }

    for (let pi = 0; pi < points.length; pi++) {
      const pt = points[pi];
      // 从外围飞入：assemble 之前离中心更远
      const converge = 1 + (1 - settle) * (0.7 + pt.seed * 0.9);
      const bx = pt.x * converge;
      const by = pt.y * converge;

      const swirl = Math.sin(time * 2.2 + pt.phase) * 0.012;
      const rx = bx * cos - by * sin + swirl;
      const ry = (bx * sin + by * cos) * ySign;

      // 散开：沿径向飞出去
      const spread = scatter * (0.5 + pt.seed) * 70;
      const px = burst.x + rx * scale + pt.dx * spread;
      const py = burst.y + ry * scale - rise + pt.dy * ySign * spread + scatter * scatter * 50;

      const twinkle = 0.6 + 0.4 * Math.sin(time * 7 + pt.phase * 1.7);
      const size = pt.size * pt.depth * (0.55 + 0.45 * settle) * twinkle;
      ctx.globalAlpha = Math.min(1, envelope * (0.78 + 0.22 * twinkle) * (0.85 + 0.15 * pt.depth));
      ctx.drawImage(dots[pt.tint], px - size / 2, py - size / 2, size, size);
      if (pi === 0) lastDraw = { x: px, y: py, size, alpha: ctx.globalAlpha, kind: burst.kind };
    }
  }

  /* ---------------- 冲击波 / 星火 ---------------- */

  function drawWave(burst, p, delay, tint, speed, count) {
    const local = (p - delay) / (1 - delay);
    if (local <= 0 || local >= 1) return;
    const radius = baseScale * (0.45 + easeOutCubic(local) * speed);
    const dotsOnRing = Math.round(count * (1 - local * 0.4));
    ctx.globalAlpha = (1 - local) * 0.8;
    for (let i = 0; i < dotsOnRing; i++) {
      const a = (i / dotsOnRing) * TAU + local * 0.6;
      const s = 5.5 * (1 - local) + 1.5;
      ctx.drawImage(
        dots[tint],
        burst.x + Math.cos(a) * radius - s / 2,
        burst.y - local * 30 + Math.sin(a) * radius - s / 2,
        s,
        s
      );
    }
  }

  function updateSparks(burst, dt) {
    for (const spark of burst.sparks) {
      spark.px = spark.x;
      spark.py = spark.y;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.vy += 300 * dt;
      spark.vx *= 1 - 1.1 * dt;
      spark.vy *= 1 - 0.5 * dt;
    }
  }

  function drawSparks(burst, p) {
    const fade = 1 - Math.max(0, (p - 0.55) / 0.45);
    if (fade <= 0) return;
    for (const spark of burst.sparks) {
      const len = Math.hypot(spark.x - spark.px, spark.y - spark.py);
      if (len > 1.2) {
        ctx.globalAlpha = fade * 0.55;
        ctx.strokeStyle = spark.gold ? 'rgba(255, 198, 120, 0.9)' : 'rgba(255, 88, 130, 0.9)';
        ctx.lineWidth = spark.size * 0.32;
        ctx.beginPath();
        ctx.moveTo(burst.x + spark.px, burst.y + spark.py);
        ctx.lineTo(burst.x + spark.x, burst.y + spark.y);
        ctx.stroke();
      }
      ctx.globalAlpha = fade * 0.95;
      const dot = spark.gold ? dots.gold : dots.rose;
      ctx.drawImage(dot, burst.x + spark.x - spark.size / 2, burst.y + spark.y - spark.size / 2, spark.size, spark.size);
    }
  }

  function render(time, dt) {
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    ctx.globalCompositeOperation = 'lighter';

    let active = 0;
    for (let i = bursts.length - 1; i >= 0; i--) {
      const burst = bursts[i];
      burst.age += dt;
      const life = LIFE[burst.kind];
      if (burst.age >= life) {
        bursts.splice(i, 1);
        continue;
      }
      active += 1;
      const p = Math.min(burst.age / life, 1);

      updateSparks(burst, dt);
      if (burst.kind === 'pulse') {
        // 掌心脉冲：先闪一下，再两圈光点扩散出去，不画形状
        const flash = Math.max(0, 1 - p / 0.3);
        if (flash > 0) {
          const size = baseScale * (0.45 + (1 - flash) * 0.75);
          ctx.globalAlpha = flash * 0.85;
          ctx.drawImage(dots.white, burst.x - size / 2, burst.y - size / 2, size, size);
        }
        drawWave(burst, p, 0, 'white', 0.9, 40);
        drawWave(burst, p, 0.16, 'gold', 0.62, 26);
      } else {
        drawWave(burst, p, 0, burst.kind === 'thumb' ? 'gold' : 'pink', 1.6, 46);
        drawWave(burst, p, 0.12, burst.kind === 'thumb' ? 'white' : 'gold', 1.2, 34);
        drawShape(burst, time);
      }
      drawSparks(burst, p);
    }

    drawPointer(time);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    needsClear = active === 0 && !pointer;
  }

  return {
    track(state) {
      if (!state || !state.present) {
        pointer = null;
        return;
      }
      pointer = { x: state.x, y: state.y, progress: state.progress || 0, kind: state.kind || 'heart' };
    },
    burst(kind, x, y) {
      if (kind === 'thumb' && !thumbPoints) {
        thumbPoints = buildThumbPoints(isSmallScreen() ? 420 : 760);
      }
      const k = baseScale / 110;
      const sparkCount = kind === 'pulse' ? 26 : kind === 'thumb' ? 70 : 110;
      bursts.push({
        kind,
        x,
        y,
        age: 0,
        seed: Math.random() * TAU,
        sparks: Array.from({ length: sparkCount }, () => {
          const angle = Math.random() * TAU;
          const speed = rand(110, 380) * k;
          return {
            x: 0,
            y: 0,
            px: 0,
            py: 0,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - rand(20, 90),
            size: rand(2.5, 6.5),
            gold: Math.random() < 0.55,
          };
        }),
      });
    },
    update(time, dt) {
      if (!bursts.length && !pointer && !needsClear) return;
      render(time, dt);
    },
    setViewport(width, height, pixelRatio) {
      viewport.width = width;
      viewport.height = height;
      viewport.pixelRatio = pixelRatio;
      baseScale = Math.min(Math.max(Math.min(width, height) * 0.14, 62), 170);
      resize();
    },
    get activeCount() {
      return bursts.length;
    },
    get debug() {
      const bounds = (list) => {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of list) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
        return { count: list.length, minX, maxX, minY, maxY };
      };
      return {
        baseScale,
        heart: bounds(heartPoints),
        thumb: thumbPoints ? bounds(thumbPoints) : null,
        lastDraw,
        bursts: bursts.map((b) => ({ kind: b.kind, age: +b.age.toFixed(2) })),
      };
    },
    dispose() {
      canvas.remove();
    },
  };
}
