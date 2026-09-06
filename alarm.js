/*
 * Alarm noise, synthesised with the Web Audio API so there is no audio asset to
 * ship and no format-support guesswork. Repeating double-beep, loops until
 * stopped.
 *
 * Browsers refuse to play audio until the page has had a user gesture. Note
 * that CREATING an AudioContext still succeeds without one - it just comes back
 * suspended, and anything scheduled on it is silent. So "did the context get
 * created" is not the question; "is it actually running" is.
 */
var BEEP_HZ = 880;
var BEEP_LENGTH = 0.14;   // seconds of tone
var BEEP_GAP = 0.22;      // start-to-start spacing within a pair
var CYCLE_MS = 1000;      // spacing between pairs

var ctx = null;
var loop = null;

function context() {
  if (!ctx) {
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function beep(at) {
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(BEEP_HZ, at);
  // Short ramps top and tail, otherwise the square wave clicks audibly.
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.22, at + 0.01);
  gain.gain.setValueAtTime(0.22, at + BEEP_LENGTH - 0.02);
  gain.gain.linearRampToValueAtTime(0, at + BEEP_LENGTH);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + BEEP_LENGTH + 0.02);
}

function pair() {
  var now = ctx.currentTime;
  beep(now);
  beep(now + BEEP_GAP);
}

export const Alarm = {
  /*
   * Call from any real user gesture, so the context is unlocked long before the
   * alarm needs to fire on its own.
   *
   * Safari is the strict one: resume() alone is not always enough, it wants a
   * source actually started inside the gesture before it treats the context as
   * unlocked. So we play one silent sample. resume() also resolves
   * asynchronously, so the caller must not expect state to have flipped by the
   * time this returns - poll isUnlocked() instead.
   */
  prime: function () {
    var c = context();
    if (!c) return false;
    try {
      var buffer = c.createBuffer(1, 1, 22050);
      var source = c.createBufferSource();
      source.buffer = buffer;
      source.connect(c.destination);
      source.start(0);
    } catch (err) {
      /* Older implementations; resume() alone will have to do. */
    }
    return c.state === 'running';
  },

  // Whether audio can actually be heard right now.
  isUnlocked: function () {
    return ctx !== null && ctx.state === 'running';
  },

  isPlaying: function () {
    return loop !== null;
  },

  start: function () {
    if (loop !== null) return true;
    var c = context();
    // A suspended context accepts scheduled notes and plays none of them. Do
    // not latch `loop` in that case, so the caller keeps retrying and the alarm
    // starts the moment the page gets a gesture.
    if (!c || c.state !== 'running') return false;
    pair();
    loop = window.setInterval(pair, CYCLE_MS);
    return true;
  },

  stop: function () {
    if (loop === null) return;
    window.clearInterval(loop);
    loop = null;
  }
};

