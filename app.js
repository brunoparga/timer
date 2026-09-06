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
var soundWarning = document.getElementById('sound-warning');
var enableSoundBtn = document.getElementById('btn-enable-sound');
var goblinSign = document.getElementById('goblin-sign');

// The sign flips on the click itself, not on the audio actually unlocking:
// resume() resolves asynchronously, and she should get her "thanks!" instantly.
var signClicked = false;

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

/*
 * The native spinner arrows on a number input fire `input`, but in some
 * browsers they do not focus the field and do not fire `change` until it is
 * blurred - which never happens if you only ever click the arrows. The old
 * code listened for `change` alone, so a spun value was never committed, and
 * the 100ms render then wrote the stored value back over it. Listening for
 * `input` fixes both halves.
 *
 * `input` also fires per keystroke, so the commit is debounced to avoid a
 * write per digit, and renders are told to leave the field alone while an
 * edit is settling.
 */
var editingUntil = 0;
var commitTimer = null;

function scheduleDuration() {
  editingUntil = Date.now() + 600;
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(function () {
    commitTimer = null;
    applyDuration();
  }, 250);
}

function commitDurationNow() {
  if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
  editingUntil = 0;
  applyDuration();
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

  // Don't clobber what someone is actively typing or spinning.
  var settling = Date.now() < editingUntil;
  if (document.activeElement !== minutesInput && !settling) {
    minutesInput.value = Math.floor(state.durationMs / 60000);
  }
  if (document.activeElement !== secondsInput && !settling) {
    secondsInput.value = Math.floor(state.durationMs / 1000) % 60;
  }
  minutesInput.disabled = !live || locked;
  secondsInput.disabled = !live || locked;

  startBtn.disabled = !live || state.status === 'running' || (left <= 0 && state.status !== 'alarming');
  startBtn.textContent = state.status === 'paused' ? 'Resume' : 'Start';
  pauseBtn.disabled = !live || state.status !== 'running';
  stopBtn.disabled = !live || (state.status === 'idle' && left === state.durationMs);
  stopAlarmBtn.disabled = !ringing;

  var thanked = signClicked || Alarm.isUnlocked();
  goblinSign.textContent = thanked ? 'thanks!' : 'click me';
  goblinSign.classList.toggle('is-thanked', thanked);

  // The written explanation is now only a fallback: it appears if she took the
  // hint and the browser still refused, rather than competing with the sign.
  soundWarning.hidden = !signClicked || Alarm.isUnlocked();
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

minutesInput.addEventListener('input', scheduleDuration);
secondsInput.addEventListener('input', scheduleDuration);
minutesInput.addEventListener('change', commitDurationNow);
secondsInput.addEventListener('change', commitDurationNow);

/*
 * Unlock audio on the FIRST interaction of any kind, not just on Start. Someone
 * who only ever watches a timer that a colleague started would otherwise never
 * unlock it, and would sit through a silent alarm.
 */
function unlockAudio() {
  Alarm.prime();
  render(Sync.get());
}

// pointerdown covers mouse and touch on modern browsers; click and touchstart
// are belt and braces for older Safari.
document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('touchstart', unlockAudio, { once: true });
document.addEventListener('click', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });
enableSoundBtn.addEventListener('click', unlockAudio);

goblinSign.addEventListener('click', function () {
  signClicked = true;
  unlockAudio();
});

// Returning to a backgrounded tab can leave the context suspended.
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) Alarm.prime();
});

Sync.subscribe(render);
setInterval(tick, 100);
