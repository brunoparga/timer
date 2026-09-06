/*
 * Shared-state layer.
 *
 * This is the ONLY file that needs to change to make the timer shared across
 * everyone connected to the site. It exposes three things:
 *
 *   Sync.get()            -> current state object
 *   Sync.set(state)       -> publish a new state
 *   Sync.subscribe(fn)    -> fn(state) on every change, including the first
 *
 * The state is deliberately timestamp-based rather than tick-based: when the
 * timer runs, we store the wall-clock instant it ends (`endsAt`) rather than a
 * countdown that has to be decremented. Every client derives the remaining time
 * from that instant, so N clients agree without exchanging ticks. That is what
 * makes the Firebase swap a drop-in.
 *
 * Current implementation: in-memory, plus BroadcastChannel so that multiple
 * TABS OF THE SAME BROWSER stay in step. That is a local convenience and a way
 * to exercise the multi-client paths; it is NOT cross-visitor sync. Two
 * different people still get two independent timers until Firebase is wired in.
 */
(function (global) {
  'use strict';

  var DEFAULT_DURATION_MS = 25 * 60 * 1000;

  var state = {
    status: 'idle',                    // idle | running | paused | alarming
    durationMs: DEFAULT_DURATION_MS,   // configured length
    remainingMs: DEFAULT_DURATION_MS,  // authoritative when not running
    endsAt: null,                      // epoch ms; authoritative when running
    updatedAt: Date.now()
  };

  var listeners = [];
  var channel = null;

  if ('BroadcastChannel' in global) {
    channel = new BroadcastChannel('goblin-timer');
    channel.onmessage = function (event) {
      var incoming = event.data;
      // Last write wins. Ignore anything we have already superseded locally.
      if (!incoming || incoming.updatedAt < state.updatedAt) return;
      state = incoming;
      emit();
    };
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) listeners[i](state);
  }

  var Sync = {
    DEFAULT_DURATION_MS: DEFAULT_DURATION_MS,

    get: function () {
      return state;
    },

    set: function (next) {
      state = Object.assign({}, state, next, { updatedAt: Date.now() });
      if (channel) channel.postMessage(state);
      emit();
      return state;
    },

    subscribe: function (fn) {
      listeners.push(fn);
      fn(state);
    }
  };

  global.Sync = Sync;
})(window);
