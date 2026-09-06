/*
 * Alarm noise.
 *
 * This used to synthesise beeps through the Web Audio API. That works on
 * Chrome and Firefox but is unreliable on Safari, which suspends AudioContexts
 * aggressively - in particular for background tabs, which is exactly when a
 * pomodoro alarm needs to fire. An <audio> element behaves far better: once it
 * has been played inside a user gesture, Safari lets it play again later on its
 * own, including while the tab is in the background.
 *
 * There is still no way to make sound before the page has had a gesture; that
 * is browser policy. What we can do is make the unlock happen on the first
 * interaction of any kind, and keep retrying rather than giving up after one
 * attempt.
 *
 * The sound itself is generated as a WAV data URI at load, so there is no
 * audio asset to ship and nothing to 404.
 */
const SAMPLE_RATE = 22050;
const CYCLE_SECONDS = 1;      // one double-beep per second, looped
const BEEP_HZ = 880;
const BEEP_SECONDS = 0.14;
const BEEP_GAP = 0.22;        // start-to-start within a pair

function addBeep(pcm, atSeconds) {
  const start = Math.floor(atSeconds * SAMPLE_RATE);
  const length = Math.floor(BEEP_SECONDS * SAMPLE_RATE);
  const fade = Math.floor(0.008 * SAMPLE_RATE);
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    // Fade the edges, otherwise the square wave clicks audibly.
    let env = 1;
    if (i < fade) env = i / fade;
    else if (i > length - fade) env = Math.max(0, (length - i) / fade);
    const square = Math.sin(2 * Math.PI * BEEP_HZ * t) >= 0 ? 1 : -1;
    pcm[start + i] = Math.round(square * env * 0.45 * 32767);
  }
}

function encodeWav(pcm) {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                    // PCM
  view.setUint16(22, 1, true);                    // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);      // byte rate
  view.setUint16(32, 2, true);                    // block align
  view.setUint16(34, 16, true);                   // bits per sample
  str(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(binary);
}

function buildAlarmSound() {
  const pcm = new Int16Array(Math.floor(SAMPLE_RATE * CYCLE_SECONDS));
  addBeep(pcm, 0);
  addBeep(pcm, BEEP_GAP);
  return encodeWav(pcm);
}

const audio = new Audio(buildAlarmSound());
audio.loop = true;
audio.preload = 'auto';

let unlocked = false;
let priming = false;
let playing = false;

export const Alarm = {
  /*
   * Call from any real user gesture. Playing the element once inside the
   * gesture is what earns permission to play it later unprompted; we do it at
   * volume 0 and stop immediately so the unlock itself is inaudible.
   *
   * play() resolves asynchronously, so `unlocked` will not be true by the time
   * this returns. Poll isUnlocked().
   */
  prime() {
    if (unlocked || priming || playing) return unlocked;
    priming = true;
    const restore = audio.volume;
    audio.volume = 0;
    let result;
    try {
      result = audio.play();
    } catch (err) {
      priming = false;
      audio.volume = restore;
      return false;
    }
    if (result && typeof result.then === 'function') {
      result.then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = restore;
        unlocked = true;
        priming = false;
      }).catch(() => {
        audio.volume = restore;
        priming = false;   // stay locked, and let the next gesture try again
      });
    } else {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = restore;
      unlocked = true;
      priming = false;
    }
    return unlocked;
  },

  isUnlocked() {
    return unlocked;
  },

  isPlaying() {
    return playing;
  },

  start() {
    if (playing) return true;
    // Don't latch as playing if we were never unlocked - the caller retries,
    // so the alarm starts the moment the page finally gets a gesture.
    if (!unlocked) return false;
    audio.currentTime = 0;
    playing = true;
    const result = audio.play();
    if (result && typeof result.catch === 'function') {
      result.catch(() => { playing = false; unlocked = false; });
    }
    return true;
  },

  stop() {
    if (!playing) return;
    audio.pause();
    audio.currentTime = 0;
    playing = false;
  }
};
