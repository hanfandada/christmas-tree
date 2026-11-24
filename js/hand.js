/**
 * 摄像头手势：比心 / 竖大拇指 / 握拳→张开。
 *
 * 三类手势分两套逻辑：
 *  - 比心、大拇指：姿势保持 HOLD_MS 就触发，属于"摆出来就出"
 *  - 握拳→张开：序列手势，要先把拳头稳住 PALM_HOLD_MS，再张开才算完成，
 *    这样单纯挥手、打字、张开手掌都不会误触
 *
 * 设计约束：
 *  - 模型与 wasm 全部 vendor 在 vendor/mediapipe/，点按钮时才动态 import，
 *    首页不会加载这 17MB，也不影响首屏
 *  - 视频只在本机内存里做推理，不上传、不落盘；关闭时立刻 stop 所有 track
 *  - 判定逻辑是纯函数，方便用构造的关键点做回归
 *
 * 关键点编号（MediaPipe Hands 21 点）：
 *  0 腕
 *  1-4 拇指  CMC / MCP / IP / TIP
 *  5-8 食指  MCP / PIP / DIP / TIP
 *  9-12 中指
 *  13-16 无名指
 *  17-20 小指
 */

const MODEL_URL = new URL('vendor/mediapipe/hand_landmarker.task', document.baseURI).href;
const WASM_DIR = new URL('vendor/mediapipe/wasm', document.baseURI).href;
const BUNDLE_URL = '../vendor/mediapipe/vision_bundle.mjs';

const HOLD_MS = 100; // 姿势稳住多久触发：一摆好就出，尽量不让人等
const COOLDOWN_MS = 700; // 两次触发的最短间隔
const MIN_STREAK = 2; // 至少连续几帧判定成功
const RELEASE_STREAK = 2; // 连续几帧没姿势才重新上膛
const PALM_HOLD_MS = 180; // 握拳要稳住这么久，张开才算数（太短会误触）
const FIST_TIMEOUT = 3000; // 握拳之后多久还没张开就作废
const COMBO_GRACE = 900; // 组合技触发后这段时间里屏蔽比心，免得同一下炸两颗心

// 送进模型前先缩到这个宽度：640×480 直接喂太浪费。
// 256 更省算力，但真机上小图更容易丢手，先用回 320 这个验证过的值。
const PROCESS_WIDTH = 320;

/**
 * 手部 ROI：只把手附近那块送进模型，远处的手在画面里只占一小片，
 * 整幅送去等于把 90% 的算力浪费在背景上。
 */
const ROI = {
  scale: 1.9, // 手框外扩倍数
  min: 0.34, // ROI 最小占画面比例，再小就容易丢手
  edge: 0.34, // 手中心进入 ROI 边缘这么多就开始重新居中
  lost: 2, // 连续丢几帧就退回全幅
};

/**
 * 判定阈值都放这里，真机手感不对就调这几个数。
 * 比心：拇指食指指尖靠近、两指都伸出来、其余三指收住
 * 大拇指：四指全收、拇指明显伸出来且朝上
 * 握拳：四指全收、拇指也收起来（跟竖大拇指区分开）
 * 张开：四指全伸、大拇指也张开
 */
export const THRESHOLD = {
  heartTipGap: 0.85,
  heartThumbOut: 0.32,
  heartIndexOut: 0.5,
  heartCurled: 1.12,
  thumbOut: 0.5,
  thumbRise: 0.12,
  thumbCurled: 1.0,
  // 握拳：真手上四指很难蜷到"比值 0.8"那么狠，而且总有某一根蜷得不够，
  // 所以同时看"最差的那根"和"平均"，再放宽一档
  fistCurl: 1.0,
  fistAvg: 0.88,
  fistThumbTuck: 0.7,
  openCurl: 0.98,
  openThumbOut: 0.4,
  pinchGap: 0.34,
  pinchThumbOut: 0.22,
  // 捏合时另外三指经常是半弯的，不能要求它们必须伸直
  pinchCurl: 0.8,
};

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.hypot(dx, dy, dz);
}

/** 指尖到腕的距离 ÷ 指根到腕的距离：伸直 > 1.1，蜷起 < 1 */
function curlRatio(lm, tip, pip) {
  const base = dist(lm[pip], lm[0]);
  if (base < 1e-6) return 1;
  return dist(lm[tip], lm[0]) / base;
}

function handScale(lm) {
  return dist(lm[0], lm[9]) || 1e-6;
}

/** 比心：拇指与食指指尖靠近，其余三指收拢 */
export function analyzeHeart(lm) {
  if (!lm || lm.length < 21) return { isHeart: false };

  const scale = handScale(lm);
  const tipGap = dist(lm[4], lm[8]) / scale;
  const thumbOut = dist(lm[4], lm[2]) / scale;
  const indexOut = dist(lm[8], lm[5]) / scale;
  const curled =
    (curlRatio(lm, 12, 10) + curlRatio(lm, 16, 14) + curlRatio(lm, 20, 18)) / 3;

  const isHeart =
    tipGap < THRESHOLD.heartTipGap &&
    thumbOut > THRESHOLD.heartThumbOut &&
    indexOut > THRESHOLD.heartIndexOut &&
    curled < THRESHOLD.heartCurled;

  return { isHeart, tipGap, thumbOut, indexOut, curled };
}

/** 竖大拇指：四指全收、拇指伸出来且朝上 */
export function analyzeThumbUp(lm) {
  if (!lm || lm.length < 21) return { isThumbUp: false };

  const scale = handScale(lm);
  const thumbOut = dist(lm[4], lm[2]) / scale;
  const rise = (lm[2].y - lm[4].y) / scale; // 图像里 y 向下，指尖比拇指根高就是正数
  const indexCurl = curlRatio(lm, 8, 6);
  const middleCurl = curlRatio(lm, 12, 10);
  const ringCurl = curlRatio(lm, 16, 14);
  const pinkyCurl = curlRatio(lm, 20, 18);
  const curled = Math.max(indexCurl, middleCurl, ringCurl, pinkyCurl);

  const isThumbUp =
    thumbOut > THRESHOLD.thumbOut &&
    rise > THRESHOLD.thumbRise &&
    curled < THRESHOLD.thumbCurled;

  return { isThumbUp, thumbOut, rise, curled };
}

/** 拇指尖到拇指根的相对距离：收起来 < 0.5，伸出去 > 0.5 */
function thumbSpread(lm, scale) {
  return dist(lm[4], lm[2]) / scale;
}

/** 四指（食指到小指）的蜷曲程度 */
function fingerCurls(lm) {
  return [
    curlRatio(lm, 8, 6),
    curlRatio(lm, 12, 10),
    curlRatio(lm, 16, 14),
    curlRatio(lm, 20, 18),
  ];
}

/** 握拳：四指全收，且拇指收在掌心（拇指伸出去的就是竖大拇指，不算握拳） */
export function analyzeFist(lm) {
  if (!lm || lm.length < 21) return { isFist: false };

  const scale = handScale(lm);
  const curls = fingerCurls(lm);
  const maxCurl = Math.max(...curls);
  const avgCurl = (curls[0] + curls[1] + curls[2] + curls[3]) / 4;
  const thumbTuck = thumbSpread(lm, scale);

  // 只看"四指蜷起来 + 拇指收回来"：握拳时拇指指尖压在食指中段，
  // 会比拇指根高，所以不能拿"拇指朝上"来排除竖大拇指，只能看拇指伸没伸出去
  const isFist =
    maxCurl < THRESHOLD.fistCurl &&
    avgCurl < THRESHOLD.fistAvg &&
    thumbTuck < THRESHOLD.fistThumbTuck;

  return { isFist, maxCurl, avgCurl, thumbTuck };
}

/** 张开手掌：四指全伸、拇指也张开 */
export function analyzeOpenPalm(lm) {
  if (!lm || lm.length < 21) return { isOpen: false };

  const scale = handScale(lm);
  const minCurl = Math.min(...fingerCurls(lm));
  const thumbOut = thumbSpread(lm, scale);

  const isOpen = minCurl > THRESHOLD.openCurl && thumbOut > THRESHOLD.openThumbOut;

  return { isOpen, minCurl, thumbOut };
}

/** 模型给的是"裁剪块内"的归一化坐标，换算回整幅画面 */
export function unprojectLandmarks(lm, crop) {
  if (!lm || !crop) return lm;
  for (const p of lm) {
    p.x = crop.x + p.x * crop.w;
    p.y = crop.y + p.y * crop.h;
  }
  return lm;
}

/** 21 个关键点的包围盒 */
export function handBounds(lm) {
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

/** 由手框算出下一个 ROI；手还在原来的框里就原样返回，保持裁剪稳定 */
export function nextRoi(bounds, current) {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * ROI.scale;
  const size = Math.min(1, Math.max(ROI.min, span));

  if (current) {
    const inside =
      Math.abs(cx - (current.x + current.size / 2)) < (current.size * ROI.edge) / 2 &&
      Math.abs(cy - (current.y + current.size / 2)) < (current.size * ROI.edge) / 2 &&
      Math.abs(size - current.size) < current.size * 0.5;
    if (inside) return current;
  }

  return {
    x: Math.min(1 - size, Math.max(0, cx - size / 2)),
    y: Math.min(1 - size, Math.max(0, cy - size / 2)),
    size,
  };
}

/**
 * 捏合：拇指指尖和食指指尖碰在一起，其余三指不蜷（这就是和比心的区别）。
 * 比心要求中指 / 无名指 / 小指收起来，捏合时它们是伸开的。
 */
export function analyzePinch(lm) {
  if (!lm || lm.length < 21) return { isPinch: false };

  const scale = handScale(lm);
  const curls = fingerCurls(lm);
  const gap = dist(lm[4], lm[8]) / scale;
  const thumbOut = thumbSpread(lm, scale);
  const others = Math.min(curls[1], curls[2], curls[3]);

  const isPinch =
    gap < THRESHOLD.pinchGap && thumbOut > THRESHOLD.pinchThumbOut && others > THRESHOLD.pinchCurl;

  return { isPinch, gap, others };
}

/** 手掌中心在屏幕上的位置（摄像头是镜像的，x 要翻） */
function palmScreen(lm) {
  const ids = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const i of ids) {
    x += lm[i].x;
    y += lm[i].y;
  }
  x /= ids.length;
  y /= ids.length;
  // 手通常在画面下半部，往上收一点，别让特效压在文字和按钮上
  return {
    x: Math.min(Math.max((1 - x) * window.innerWidth, 90), window.innerWidth - 90),
    y: Math.min(Math.max(y * window.innerHeight, 110), window.innerHeight - 200),
  };
}

function errorCode(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-camera';
  if (error?.code === 'nosimd') return 'nosimd';
  if (error?.code === 'no-api') return 'no-api';
  return 'failed';
}

export function createHandTracker({
  video,
  onHeart,
  onThumb,
  onPalm,
  onPinch,
  onTrack,
  onStatus,
  roi: roiEnabled = true,
} = {}) {
  let landmarker = null;
  let stream = null;
  let running = false;
  let starting = false;
  let session = 0;
  let frameHandle = 0;
  let lastInfer = 0;
  let lastMetrics = null;
  let lastTimestamp = 0;
  let lastLatency = null;
  let frames = 0;
  let prewarming = null;
  let processCanvas = null;
  let processCtx = null;
  let roi = null; // { x, y, size } 归一化坐标
  let lostFrames = 0;
  // 默认不开：裁剪会让"丢一帧"变多，而手势要求连续帧，真机上反而更难触发
  let useRoi = roiEnabled === true;
  let inferMs = 0;
  let inferAvg = 0;

  // 手势状态机（比心 / 大拇指：保持触发）
  let currentKind = null;
  let since = 0;
  let streak = 0;
  let releaseStreak = 0;
  let lastFire = -Infinity;
  let armed = true;

  // 序列状态机（握拳 → 张开 → 捏合）
  let fistStreak = 0;
  let openStreak = 0;
  let pinchStreak = 0;
  let neutralStreak = 0;
  let palmStage = 'idle'; // idle | fist | mixed
  let palmSince = 0;
  let lastPalmFire = -Infinity;
  let lastPinchFire = -Infinity;
  let lastComboAt = -Infinity;
  let lastPalmLatency = null;

  function setStatus(status, error) {
    onStatus?.(status, error);
  }

  /* ---------------- 模型 ---------------- */

  async function createLandmarker() {
    const mod = await import(BUNDLE_URL);
    const { FilesetResolver, HandLandmarker } = mod;

    // 只 vendor 了 SIMD 版本，老浏览器直接给个能读懂的提示
    if (typeof FilesetResolver.isSimdSupported === 'function') {
      const simd = await FilesetResolver.isSimdSupported();
      if (!simd) throw Object.assign(new Error('no simd'), { code: 'nosimd' });
    }

    const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      // 门槛放低一点：真实房间的光照和角度比合成数据苛刻，
      // 先把手"看见"，姿势判定那边还有一层过滤，误报不会直接触发特效
      minHandDetectionConfidence: 0.35,
      minHandPresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
    };

    try {
      return await HandLandmarker.createFromOptions(fileset, options);
    } catch {
      // 部分机器 / 无头环境拿不到 GPU delegate，退回 CPU
      options.baseOptions.delegate = 'CPU';
      return HandLandmarker.createFromOptions(fileset, options);
    }
  }

  /* ---------------- 摄像头 ---------------- */

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('no mediaDevices'), { code: 'no-api' });
    }

    const media = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 },
      },
    });

    video.srcObject = media;
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch {
      // iOS 上偶发 play() 被拒，autoplay + muted 一般也能出帧
    }
    return media;
  }

  function stopCamera() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (video) video.srcObject = null;
  }

  /* ---------------- 每帧识别 ---------------- */

  /**
   * 把视频帧缩到 PROCESS_WIDTH 送模型；开着 ROI 时只裁手附近那块。
   * 返回这一帧实际裁的是哪一块（归一化坐标），后面要靠它把关关键点换算回全幅。
   */
  function prepareFrame() {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;

    if (!processCanvas) {
      processCanvas = document.createElement('canvas');
      processCtx = processCanvas.getContext('2d');
    }

    // ROI 是归一化正方形，换成像素后自然就是视频的宽高比，不会把画面拉变形
    const crop = roi
      ? {
          x: roi.x,
          y: roi.y,
          w: roi.size,
          h: roi.size,
        }
      : null;

    const sw = crop ? Math.max(8, Math.round(crop.w * vw)) : vw;
    const sh = crop ? Math.max(8, Math.round(crop.h * vh)) : vh;
    const sx = crop ? Math.round(crop.x * vw) : 0;
    const sy = crop ? Math.round(crop.y * vh) : 0;

    const width = Math.max(32, Math.min(PROCESS_WIDTH, sw));
    const height = Math.max(1, Math.round((sh / sw) * width));

    if (processCanvas.width !== width || processCanvas.height !== height) {
      processCanvas.width = width;
      processCanvas.height = height;
    }
    processCtx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    return crop;
  }

  /** 手快出框或明显变大变小时才重新居中，避免每帧都动导致跟踪丢失 */
  function updateRoi(lm) {
    if (!useRoi || !lm || lm.length < 21) return;
    roi = nextRoi(handBounds(lm), roi);
  }

  function runDetection() {
    if (!running || document.hidden || !video || video.readyState < 2) return;

    const crop = prepareFrame();
    // 用视频自己的时间戳，比 rAF 时间稳，跟踪不会因为掉帧乱跳
    const raw = video.currentTime * 1000;
    const timestamp = Math.max(raw, lastTimestamp + 1);
    lastTimestamp = timestamp;

    frames += 1;
    const started = performance.now();
    let result = null;
    try {
      result = landmarker.detectForVideo(processCanvas, timestamp);
    } catch {
      return; // 偶尔会有帧没准备好，跳过就好
    }
    inferMs = performance.now() - started;
    inferAvg += (inferMs - inferAvg) * 0.15;

    const hand = unprojectLandmarks(result?.landmarks?.[0] || null, crop);

    if (hand) {
      lostFrames = 0;
      updateRoi(hand);
    } else if (roi && ++lostFrames >= ROI.lost) {
      // 连着两帧没手：可能是手出了裁剪框，退回全幅再找
      roi = null;
      lostFrames = 0;
    }

    handleLandmarks(hand, performance.now());
  }

  /**
   * 识别循环：rAF 驱动，但只在视频真的有新帧时才跑模型。
   * （不用 requestVideoFrameCallback：video 不可见时它会被浏览器节流，
   * 真机可能正常，但隐藏标签页/无头环境会直接卡死。）
   */
  let lastVideoTime = -1;

  function scheduleFrame() {
    if (!running) return;
    frameHandle = requestAnimationFrame(onAnimationFrame);
  }

  function onAnimationFrame(now) {
    if (!running) return;
    scheduleFrame();

    if (document.hidden || !video || video.readyState < 2) return;
    if (now - lastInfer < 15) return;
    lastInfer = now;

    if (video.currentTime === lastVideoTime) return; // 没有新帧，不重复跑
    lastVideoTime = video.currentTime;

    runDetection();
  }

  function cancelFrames() {
    if (!frameHandle) return;
    cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }

  /* ---------------- 识别与状态机 ---------------- */

  function resetPalm() {
    fistStreak = 0;
    openStreak = 0;
    pinchStreak = 0;
    neutralStreak = 0;
    palmStage = 'idle';
  }

  /**
   * 组合技序列：握拳 → 张开（炸开）→ 捏合（成字）。
   *
   * 两个真机上踩到的坑：
   *  - 握拳到张开之间会经过几帧"既不是拳也不是完全张开"，不能因为这几帧就作废，
   *    改成给整段一个超时（FIST_TIMEOUT），中间怎么动都行
   *  - 捏合和比心的手型几乎一样，所以进入 mixed 之后要屏蔽比心；
   *    而且捏合触发之后那几帧还要继续屏蔽，不然会同时炸一颗心
   * @returns {'open'|'pinch'|null} 这一帧完成的那一步
   */
  function updatePalm(now, fist, open, pinch) {
    fistStreak = fist.isFist ? fistStreak + 1 : 0;
    openStreak = open.isOpen ? openStreak + 1 : 0;
    pinchStreak = pinch.isPinch ? pinchStreak + 1 : 0;
    neutralStreak = !fist.isFist && !open.isOpen && !pinch.isPinch ? neutralStreak + 1 : 0;

    // 新的一拳：重新开始一轮（组合技中途也能用它打断）
    if (palmStage !== 'fist' && fistStreak >= MIN_STREAK) {
      palmStage = 'fist';
      palmSince = now;
      return null;
    }

    if (palmStage === 'fist') {
      // 中间那些"半握半开"的过渡帧不作废，只给一个总时长上限
      if (now - palmSince > FIST_TIMEOUT) {
        palmStage = 'idle';
        return null;
      }
      if (fistStreak > 0) return null;
      if (openStreak < MIN_STREAK) return null;
      if (now - palmSince < PALM_HOLD_MS) return null;
      if (now - lastPalmFire < COOLDOWN_MS) return null;
      lastPalmFire = now;
      lastComboAt = now;
      lastPalmLatency = Math.round(now - palmSince);
      palmStage = 'mixed';
      palmSince = now;
      return 'open';
    }

    if (palmStage === 'mixed') {
      // 手彻底放下（连续好几帧什么姿势都不是）才算走开
      if (neutralStreak >= 10) {
        palmStage = 'idle';
        return null;
      }
      if (now - palmSince < PALM_HOLD_MS) return null;
      if (pinchStreak >= MIN_STREAK && now - lastPinchFire >= COOLDOWN_MS) {
        lastPinchFire = now;
        lastComboAt = now;
        palmStage = 'idle';
        return 'pinch';
      }
    }
    return null;
  }

  function handleLandmarks(lm, now) {
    if (!lm || lm.length < 21) {
      lastMetrics = null;
      pointerOff();
      currentKind = null;
      since = 0;
      streak = 0;
      releaseStreak += 1;
      if (releaseStreak >= RELEASE_STREAK) armed = true;
      resetPalm();
      return;
    }

    const heart = analyzeHeart(lm);
    const thumb = analyzeThumbUp(lm);
    const fist = analyzeFist(lm);
    const open = analyzeOpenPalm(lm);
    const pinch = analyzePinch(lm);
    lastMetrics = { heart, thumb, fist, open, pinch };

    const pos = palmScreen(lm);

    // ⚠️ 必须在 updatePalm 之前取：捏合触发时它会把 palmStage 改回 idle，
    // 之后再判断就会把这一帧当成"不在组合技里"，于是捏合同时炸出一颗心
    const wasInCombo = palmStage === 'mixed';

    // 序列手势独立于下面比心 / 大拇指的"保持触发"
    const comboStep = updatePalm(now, fist, open, pinch);
    if (comboStep === 'open') {
      onPalm?.({ ...pos, latency: lastPalmLatency });
    } else if (comboStep === 'pinch') {
      onPinch?.({ ...pos });
    }

    // 组合技期间、以及刚触发完的 0.9 秒内，都不判比心 / 大拇指
    const suppress = wasInCombo || now - lastComboAt < COMBO_GRACE;
    let kind = null;
    if (!suppress && heart.isHeart) kind = 'heart';
    else if (!suppress && thumb.isThumbUp) kind = 'thumb';
    else if (pinch.isPinch && suppress) kind = 'pinch';
    else if (fist.isFist) kind = 'fist';
    else if (open.isOpen) kind = 'open';

    if (!kind) {
      pointerOff(pos);
      currentKind = null;
      since = 0;
      streak = 0;
      releaseStreak += 1;
      if (releaseStreak >= RELEASE_STREAK) armed = true;
      return;
    }

    releaseStreak = 0;
    if (kind !== currentKind) {
      currentKind = kind;
      since = now;
      streak = 0;
    }
    streak += 1;

    const held = now - since;
    const progress = armed ? Math.min(1, held / HOLD_MS) : 0;
    const palmKind = kind === 'fist' || kind === 'open' || kind === 'pinch';
    // 拳头 / 张开手掌只驱动准星蓄力，真正触发在 updatePalm 里
    const displayProgress = palmKind
      ? palmStage === 'fist'
        ? Math.min(1, (now - palmSince) / PALM_HOLD_MS)
        : 0
      : progress;
    onTrack?.({
      present: true,
      x: pos.x,
      y: pos.y,
      kind,
      progress: displayProgress,
      metrics: { heart, thumb, fist, open },
    });

    if (palmKind) return;

    if (armed && progress >= 1 && streak >= MIN_STREAK && now - lastFire >= COOLDOWN_MS) {
      armed = false;
      lastFire = now;
      // 从"姿势刚满足条件"到真正触发之间的耗时，用来验收响应速度
      lastLatency = Math.round(now - since);
      if (kind === 'heart') onHeart?.({ ...pos, metrics: heart, latency: lastLatency });
      else onThumb?.({ ...pos, metrics: thumb, latency: lastLatency });
    }
  }

  function pointerOff(pos = null) {
    onTrack?.(pos ? { present: true, x: pos.x, y: pos.y, kind: null, progress: 0 } : { present: false });
  }

  /* ---------------- 开关 ---------------- */

  async function start() {
    if (running || starting) return;
    starting = true;
    const mySession = ++session;
    setStatus('loading');

    try {
      const cameraPromise = openCamera().then((media) => {
        if (mySession !== session) {
          for (const track of media.getTracks()) track.stop();
          return null;
        }
        stream = media;
        return media;
      });

      const modelPromise = landmarker ? Promise.resolve(landmarker) : createLandmarker();
      const [media, model] = await Promise.all([cameraPromise, modelPromise]);

      if (mySession !== session || !media) return;

      landmarker = model;
      running = true;
      starting = false;
      lastInfer = 0;
      lastTimestamp = 0;
      lastVideoTime = -1;
      roi = null;
      lostFrames = 0;
      inferMs = 0;
      inferAvg = 0;
      currentKind = null;
      since = 0;
      streak = 0;
      releaseStreak = 0;
      armed = true;
      lastFire = -Infinity;
      lastPalmFire = -Infinity;
      resetPalm();
      setStatus('running');
      scheduleFrame();
    } catch (error) {
      if (mySession === session) {
        starting = false;
        running = false;
        stopCamera();
        cancelFrames();
        setStatus(errorCode(error), error);
      }
    }
  }

  function stop() {
    session += 1;
    running = false;
    starting = false;
    cancelFrames();
    stopCamera();
    roi = null;
    lostFrames = 0;
    pointerOff();
    setStatus('idle');
  }

  return {
    start,
    stop,
    toggle() {
      if (running || starting) stop();
      else start();
    },
    get running() {
      return running;
    },
    get starting() {
      return starting;
    },
    get metrics() {
      return lastMetrics;
    },
    get latency() {
      return lastLatency;
    },
    /** 单帧推理耗时（毫秒），面板里用来看 256 / ROI 到底省了多少 */
    get inferMs() {
      return Math.round(inferMs * 10) / 10;
    },
    get inferAvg() {
      return Math.round(inferAvg * 10) / 10;
    },
    /** 当前 ROI 占画面多少（1 = 全幅），调试用 */
    get roiSize() {
      return roi ? Math.round(roi.size * 100) / 100 : 1;
    },
    get warm() {
      return !!landmarker;
    },
    get frames() {
      return frames;
    },
    /** 提前把模型加载好，点「手势」时只剩摄像头握手 */
    prewarm() {
      if (landmarker) return Promise.resolve();
      if (!prewarming) {
        prewarming = createLandmarker()
          .then((model) => {
            landmarker = model;
            return model;
          })
          .catch(() => null)
          .finally(() => {
            prewarming = null;
          });
      }
      return prewarming;
    },
    analyze: analyzeHeart,
    analyzeThumb: analyzeThumbUp,
    analyzeFist,
    analyzeOpen: analyzeOpenPalm,
    analyzePinch,
    get palmStage() {
      return palmStage;
    },
    /** 调试用：直接喂一组关键点走完整状态机 */
    feed(lm, now = performance.now()) {
      handleLandmarks(lm, now);
    },
  };
}
