/**
 * 摄像头手势：比心 / 竖大拇指。
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

const HOLD_MS = 220; // 姿势稳住多久触发（手感上"一摆好就出"）
const COOLDOWN_MS = 1000; // 两次触发的最短间隔
const MIN_STREAK = 2; // 至少连续几帧判定成功
const INFERENCE_INTERVAL = 55; // 推理节流，约 18fps
const RELEASE_STREAK = 2; // 连续几帧没姿势才重新上膛

/**
 * 判定阈值都放这里，真机手感不对就调这几个数。
 * 比心：拇指食指指尖靠近、两指都伸出来、其余三指收住
 * 大拇指：四指全收、拇指明显伸出来且朝上
 */
export const THRESHOLD = {
  heartTipGap: 0.85,
  heartThumbOut: 0.32,
  heartIndexOut: 0.5,
  heartCurled: 1.12,
  thumbOut: 0.5,
  thumbRise: 0.12,
  thumbCurled: 1.0,
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

export function createHandTracker({ video, onHeart, onThumb, onTrack, onStatus } = {}) {
  let landmarker = null;
  let stream = null;
  let running = false;
  let starting = false;
  let session = 0;
  let raf = 0;
  let lastInfer = 0;
  let lastMetrics = null;

  // 手势状态机
  let currentKind = null;
  let since = 0;
  let streak = 0;
  let releaseStreak = 0;
  let lastFire = -Infinity;
  let armed = true;

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
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
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

  /* ---------------- 识别与状态机 ---------------- */

  function handleLandmarks(lm, now) {
    if (!lm || lm.length < 21) {
      lastMetrics = null;
      pointerOff();
      currentKind = null;
      since = 0;
      streak = 0;
      releaseStreak += 1;
      if (releaseStreak >= RELEASE_STREAK) armed = true;
      return;
    }

    const heart = analyzeHeart(lm);
    const thumb = analyzeThumbUp(lm);
    lastMetrics = { heart, thumb };

    let kind = null;
    if (heart.isHeart) kind = 'heart';
    else if (thumb.isThumbUp) kind = 'thumb';

    const pos = palmScreen(lm);

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
    onTrack?.({ present: true, x: pos.x, y: pos.y, kind, progress, metrics: { heart, thumb } });

    if (armed && progress >= 1 && streak >= MIN_STREAK && now - lastFire >= COOLDOWN_MS) {
      armed = false;
      lastFire = now;
      if (kind === 'heart') onHeart?.({ ...pos, metrics: heart });
      else onThumb?.({ ...pos, metrics: thumb });
    }
  }

  function pointerOff(pos = null) {
    onTrack?.(pos ? { present: true, x: pos.x, y: pos.y, kind: null, progress: 0 } : { present: false });
  }

  function tick(now) {
    if (!running) return;
    raf = requestAnimationFrame(tick);

    if (document.hidden || !video || video.readyState < 2) return;
    if (now - lastInfer < INFERENCE_INTERVAL) return;
    lastInfer = now;

    let result = null;
    try {
      result = landmarker.detectForVideo(video, now);
    } catch {
      return; // 偶尔会有帧没准备好，跳过就好
    }
    handleLandmarks(result?.landmarks?.[0] || null, now);
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
      currentKind = null;
      since = 0;
      streak = 0;
      releaseStreak = 0;
      armed = true;
      setStatus('running');
      raf = requestAnimationFrame(tick);
    } catch (error) {
      if (mySession === session) {
        starting = false;
        running = false;
        stopCamera();
        cancelAnimationFrame(raf);
        raf = 0;
        setStatus(errorCode(error), error);
      }
    }
  }

  function stop() {
    session += 1;
    running = false;
    starting = false;
    cancelAnimationFrame(raf);
    raf = 0;
    stopCamera();
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
    analyze: analyzeHeart,
    analyzeThumb: analyzeThumbUp,
    /** 调试用：直接喂一组关键点走完整状态机 */
    feed(lm, now = performance.now()) {
      handleLandmarks(lm, now);
    },
  };
}
