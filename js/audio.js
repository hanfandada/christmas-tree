/**
 * 背景音乐：全部用 Web Audio 的振荡器现场合成，不引入任何音频文件。
 *
 * 曲目是 1857 年的《Jingle Bells》（公有领域），音色走八音盒：
 * 正弦打底 + 一个高八度的三角波当泛音，短促的指数衰减 + 低通削掉刺耳的高频。
 *
 * 调度用 AudioContext.currentTime 提前排音符，setInterval 只负责"叫醒"，
 * 所以页面掉帧也不会让节奏抖。
 */

const BPM = 132;
const SPB = 60 / BPM; // 一拍多少秒
const MASTER_VOLUME = 0.16;
const NOTE_LIMIT = 1.8; // 单音最长响多久（秒）

/** [midi, 起始拍, 持续拍] —— 音高用 MIDI 号：C4 = 60 */
const SCORE = [
  // 副歌第一遍
  [64, 0, 1], [64, 1, 1], [64, 2, 1],
  [64, 4, 1], [64, 5, 1], [64, 6, 1],
  [64, 8, 1], [67, 9, 1], [60, 10, 1], [62, 11, 1], [64, 12, 3],
  [65, 16, 1], [65, 17, 1], [65, 18, 1], [65, 19, 1],
  [65, 20, 1], [64, 21, 1], [64, 22, 1], [64, 23, 1],
  [64, 24, 1], [62, 25, 1], [62, 26, 1], [64, 27, 1], [62, 28, 2], [67, 30, 2],

  // 副歌第二遍（结尾收在主和弦）
  [64, 32, 1], [64, 33, 1], [64, 34, 1],
  [64, 36, 1], [64, 37, 1], [64, 38, 1],
  [64, 40, 1], [67, 41, 1], [60, 42, 1], [62, 43, 1], [64, 44, 3],
  [65, 48, 1], [65, 49, 1], [65, 50, 1], [65, 51, 1],
  [65, 52, 1], [64, 53, 1], [64, 54, 1], [64, 55, 1],
  [67, 56, 1], [67, 57, 1], [65, 58, 1], [62, 59, 1], [60, 60, 4],
];

const TOTAL_BEATS = 64;

const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * 排一个音：正弦基频 + 高八度三角波泛音，包络是"一击即衰"的八音盒。
 * 抽成独立函数，实时播放和离线渲染共用一份，测试才能真正验到声音。
 */
function scheduleNote(ctx, dest, note, when) {
  const [midi, , beats] = note;
  const freq = midiToHz(midi);
  const dur = Math.min(NOTE_LIMIT, Math.max(0.35, beats * SPB * 1.2));

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(0.5, when + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0008, when + dur);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2600;
  filter.Q.value = 0.6;

  const base = ctx.createOscillator();
  base.type = 'sine';
  base.frequency.value = freq;

  const shimmer = ctx.createOscillator();
  shimmer.type = 'triangle';
  shimmer.frequency.value = freq * 2.004; // 轻微失谐，音色才不会太"电子"
  const shimmerGain = ctx.createGain();
  shimmerGain.gain.value = 0.14;

  base.connect(gain);
  shimmer.connect(shimmerGain);
  shimmerGain.connect(gain);
  gain.connect(filter);
  filter.connect(dest);

  const end = when + dur + 0.05;
  base.start(when);
  shimmer.start(when);
  base.stop(end);
  shimmer.stop(end);
}

export function createMusic() {
  let ctx = null;
  let master = null;
  let timer = 0;
  let playing = false;
  let noteIndex = 0;
  let startTime = 0;
  let volume = MASTER_VOLUME;

  function ensureContext() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    return ctx;
  }

  /** 提前 0.2 秒把所有该响的音排进去 */
  function pump() {
    if (!ctx || !playing) return;
    const horizon = ctx.currentTime + 0.2;
    for (let guard = 0; guard < 64; guard++) {
      const note = SCORE[noteIndex];
      const at = startTime + note[1] * SPB;
      if (at > horizon) break;
      if (at >= ctx.currentTime - 0.05) scheduleNote(ctx, master, note, at);
      noteIndex += 1;
      if (noteIndex >= SCORE.length) {
        // 一段放完，整段往后挪，继续循环
        noteIndex = 0;
        startTime += TOTAL_BEATS * SPB;
      }
    }
  }

  function start() {
    if (!ensureContext()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    playing = true;
    noteIndex = 0;
    startTime = ctx.currentTime + 0.12;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.7);
    clearInterval(timer);
    timer = setInterval(pump, 40);
    pump();
    return true;
  }

  function stop() {
    playing = false;
    clearInterval(timer);
    timer = 0;
    if (!ctx) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
  }

  return {
    /** 浏览器要求必须在用户手势里创建 AudioContext，点按钮时才走到这里 */
    start,
    stop,
    toggle() {
      if (playing) {
        stop();
        return false;
      }
      return start();
    },
    setVolume(value) {
      volume = Math.min(Math.max(value, 0), 1);
      if (ctx && playing) master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.2);
    },
    get playing() {
      return playing;
    },
    get state() {
      return ctx ? ctx.state : 'none';
    },
    get currentTime() {
      return ctx ? ctx.currentTime : 0;
    },
    dispose() {
      stop();
      if (ctx) {
        ctx.close().catch(() => {});
        ctx = null;
        master = null;
      }
    },
  };
}

/**
 * 离线渲染一小段，用来验证"合成器真的出声了"——无头环境没有声卡，
 * 只有走 OfflineAudioContext 才能拿到可以量化的波形。
 */
export async function renderPreview(seconds = 3) {
  const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctor) return null;
  const sampleRate = 44100;
  const offline = new Ctor(1, Math.round(sampleRate * seconds), sampleRate);
  const dest = offline.destination;

  for (const note of SCORE) {
    const at = note[1] * SPB + 0.05;
    if (at >= seconds) break;
    scheduleNote(offline, dest, note, at);
  }

  const buffer = await offline.startRendering();
  const data = buffer.getChannelData(0);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > peak) peak = v;
    sum += data[i] * data[i];
  }
  return {
    peak: Math.round(peak * 1000) / 1000,
    rms: Math.round(Math.sqrt(sum / data.length) * 1000) / 1000,
    samples: data.length,
  };
}
