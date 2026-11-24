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

const HOLD_MS = 100; // 姿势稳住多久触发：一摆好就出，尽量不让人等
const COOLDOWN_MS = 700; // 两次触发的最短间隔
const MIN_STREAK = 2; // 至少连续几帧判定成功
const RELEASE_STREAK = 2; // 连续几帧没姿势才重新上膛

// 送进模型前先缩到这个宽度：640×480 直接喂太浪费，缩一半速度明显更快
const PROCESS_WIDTH = 320;

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
  let frameHandle = 0;
  let lastInfer = 0;
  let lastMetrics = null;
  let lastTimestamp = 0;
  let lastLatency = null;
  let frames = 0;
  let prewarming = null;
  let processCanvas = null;
  let processCtx = null;

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

  /* ---------------- 每帧识别 ---------------- */

  /** 把视频帧等比缩到 320 宽再送模型：省掉一大半上传/缩放开销 */
  function prepareFrame() {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const width = Math.min(PROCESS_WIDTH, vw);
    const height = Math.max(1, Math.round((vh / vw) * width));

    if (!processCanvas) {
      processCanvas = document.createElement('canvas');
      processCtx = processCanvas.getContext('2d');
    }
    if (processCanvas.width !== width || processCanvas.height !== height) {
      processCanvas.width = width;
      processCanvas.height = height;
    }
    processCtx.drawImage(video, 0, 0, width, height);
    return processCanvas;
  }

  function runDetection() {
    if (!running || document.hidden || !video || video.readyState < 2) return;

    const frame = prepareFrame();
    // 用视频自己的时间戳，比 rAF 时间稳，跟踪不会因为掉帧乱跳
    const raw = video.currentTime * 1000;
    const timestamp = Math.max(raw, lastTimestamp + 1);
    lastTimestamp = timestamp;

    frames += 1;
    let result = null;
    try {
      result = landmarker.detectForVideo(frame, timestamp);
    } catch {
      return; // 偶尔会有帧没准备好，跳过就好
    }
    handleLandmarks(result?.landmarks?.[0] || null, performance.now());
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
      currentKind = null;
      since = 0;
      streak = 0;
      releaseStreak = 0;
      armed = true;
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
    /** 调试用：直接喂一组关键点走完整状态机 */
    feed(lm, now = performance.now()) {
      handleLandmarks(lm, now);
    },
  };
}
