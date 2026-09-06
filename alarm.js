/*
 * Alarm noise, synthesised with the Web Audio API so there is no audio asset to
 * ship and no format-support guesswork. Repeating double-beep, loops until
 * stopped.
 *
 * Browsers refuse to start audio without a user gesture, so the AudioContext is
 * created lazily on the first click and resumed defensively on every start.
 */
(function (global) {
  'use strict';

  var BEEP_HZ = 880;
  var BEEP_LENGTH = 0.14;   // seconds of tone
  var BEEP_GAP = 0.22;      // start-to-start spacing within a pair
  var CYCLE_MS = 1000;      // spacing between pairs

  var ctx = null;
  var loop = null;

  function context() {
    if (!ctx) {
      var Ctor = global.AudioContext || global.webkitAudioContext;
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

  var Alarm = {
    // Called from a real click so the context is unlocked well before the
    // alarm needs to fire on its own.
    prime: function () {
      return context() !== null;
    },

    isPlaying: function () {
      return loop !== null;
    },

    start: function () {
      if (loop !== null) return true;
      if (!context()) return false;
      pair();
      loop = global.setInterval(pair, CYCLE_MS);
      return true;
    },

    stop: function () {
      if (loop === null) return;
      global.clearInterval(loop);
      loop = null;
    }
  };

  global.Alarm = Alarm;
})(window);
