/*
 * Timer state machine and UI wiring.
 *
 * All state lives in Sync (see sync.js), which is backed by Firebase. Nothing
 * here keeps its own copy of the state, and nothing here knows where the state
 * comes from - that is entirely sync.js's business.
 */
import { Sync } from './sync.js';
import { Alarm } from './alarm.js';

var readout = document.getElementById('readout');
var statusEl = document.getElementById('status');
var minutesInput = document.getElementById('input-minutes');
var secondsInput = document.getElementById('input-seconds');
var startBtn = document.getElementById('btn-start');
var pauseBtn = document.getElementById('btn-pause');
var stopBtn = document.getElementById('btn-stop');
var stopAlarmBtn = document.getElementById('btn-stop-alarm');
var testAlarmBtn = document.getElementById('btn-test-alarm');

var STATUS_TEXT = {
  idle: 'Ready',
  running: 'Running',
  paused: 'Paused',
  alarming: 'Time is up'
};

// --- derived values ---------------------------------------------------

function remainingMs(state) {
  if (state.status === 'running') return Math.max(0, state.endsAt - Date.now());
  return Math.max(0, state.remainingMs);
}

function isLocked(state) {
  // The duration may not be edited while the clock is running or ringing.
  return state.status === 'running' || state.status === 'alarming';
}

function formatTime(ms) {
  var total = Math.ceil(ms / 1000);
  var mins = Math.floor(total / 60);
  var secs = total % 60;
  return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
}

// --- actions ----------------------------------------------------------

function start() {
  var state = Sync.get();
  if (state.status === 'running') return;
  var left = state.status === 'alarming' ? state.durationMs : remainingMs(state);
  if (left <= 0) return;
  // Unlock the audio context while we still have the click, so the alarm can
  // fire later without a gesture of its own.
  Alarm.prime();
  Alarm.stop();
  Sync.set({ status: 'running', endsAt: Date.now() + left, remainingMs: left });
}

function pause() {
  var state = Sync.get();
  if (state.status !== 'running') return;
  Sync.set({ status: 'paused', remainingMs: remainingMs(state), endsAt: null });
}

function stop() {
  var state = Sync.get();
  Alarm.stop();
  Sync.set({ status: 'idle', remainingMs: state.durationMs, endsAt: null });
}

function stopAlarm() {
  Alarm.stop();
  if (Sync.get().status === 'alarming') stop();
}

function readDurationInputs() {
  var mins = parseInt(minutesInput.value, 10);
  var secs = parseInt(secondsInput.value, 10);
  if (isNaN(mins) || mins < 0) mins = 0;
  if (isNaN(secs) || secs < 0) secs = 0;
  mins = Math.min(mins, 999);
  secs = Math.min(secs, 59);
  return (mins * 60 + secs) * 1000;
}

function applyDuration() {
  var state = Sync.get();
  if (isLocked(state)) return;
  var ms = readDurationInputs();
  Sync.set({ durationMs: ms, remainingMs: ms, endsAt: null, status: 'idle' });
}

// --- rendering --------------------------------------------------------

function render(state) {
  var left = remainingMs(state);
  var locked = isLocked(state);
  var ringing = Alarm.isPlaying();
  // Until the first snapshot lands we don't know the shared state, so acting
  // would overwrite whatever everyone else is already looking at.
  var live = Sync.isReady();

  readout.textContent = formatTime(left);
  readout.classList.toggle('is-alarming', state.status === 'alarming');
  statusEl.textContent = live ? (STATUS_TEXT[state.status] || state.status) : 'Connecting';

  // Don't clobber what someone is actively typing into.
  if (document.activeElement !== minutesInput) {
    minutesInput.value = Math.floor(state.durationMs / 60000);
  }
  if (document.activeElement !== secondsInput) {
    secondsInput.value = Math.floor(state.durationMs / 1000) % 60;
  }
  minutesInput.disabled = !live || locked;
  secondsInput.disabled = !live || locked;

  startBtn.disabled = !live || state.status === 'running' || (left <= 0 && state.status !== 'alarming');
  startBtn.textContent = state.status === 'paused' ? 'Resume' : 'Start';
  pauseBtn.disabled = !live || state.status !== 'running';
  stopBtn.disabled = !live || (state.status === 'idle' && left === state.durationMs);
  stopAlarmBtn.disabled = !ringing;
}

function tick() {
  var state = Sync.get();
  if (!Sync.isReady()) { render(state); return; }
  if (state.status === 'running' && Date.now() >= state.endsAt) {
    // Publish the transition; every connected client then rings.
    Sync.set({ status: 'alarming', remainingMs: 0, endsAt: null });
    return;
  }
  if (state.status === 'alarming' && !Alarm.isPlaying()) Alarm.start();
  render(state);
}

// --- wiring -----------------------------------------------------------

startBtn.addEventListener('click', start);
pauseBtn.addEventListener('click', pause);
stopBtn.addEventListener('click', stop);
stopAlarmBtn.addEventListener('click', stopAlarm);
testAlarmBtn.addEventListener('click', function () {
  if (Alarm.isPlaying()) return;
  Alarm.start();
  render(Sync.get());
});

minutesInput.addEventListener('change', applyDuration);
secondsInput.addEventListener('change', applyDuration);

Sync.subscribe(render);
setInterval(tick, 100);
