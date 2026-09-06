/*
 * Shared-state layer, backed by Firebase Realtime Database.
 *
 * Interface (unchanged from the local version, so app.js is untouched):
 *
 *   Sync.get()          -> current state object
 *   Sync.set(patch)     -> publish a new state
 *   Sync.subscribe(fn)  -> fn(state) on every change, including immediately
 *   Sync.isReady()      -> has the first snapshot arrived?
 *
 * State is timestamp-based: while running we store `endsAt`, the wall-clock
 * instant the timer expires, rather than a decrementing count. Every client
 * derives its own remaining time from that instant, so all clients agree
 * without exchanging ticks and without needing synchronised clocks beyond
 * roughly-correct system time.
 *
 * The shape written here must satisfy database.rules.json exactly: the four
 * required numeric/string fields, an optional numeric endsAt, and no other
 * keys. Anything else is rejected by the server with a permission error.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getDatabase, ref, onValue, set as dbSet
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { firebaseConfig } from './firebase-config.js';

const DEFAULT_DURATION_MS = 25 * 60 * 1000;

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const timerRef = ref(db, 'timer');

let state = {
  status: 'idle',
  durationMs: DEFAULT_DURATION_MS,
  remainingMs: DEFAULT_DURATION_MS,
  endsAt: null,
  updatedAt: 0
};

let listeners = [];
let ready = false;
let seeded = false;

function emit() {
  for (const fn of listeners) fn(state);
}

/*
 * Firebase omits keys whose value is null, so `endsAt` simply won't be present
 * when the timer isn't running. Normalise it back to an explicit null so the
 * rest of the app never has to distinguish "absent" from "null".
 */
function normalise(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.status !== 'string' || typeof raw.durationMs !== 'number') return null;
  return {
    status: raw.status,
    durationMs: raw.durationMs,
    remainingMs: typeof raw.remainingMs === 'number' ? raw.remainingMs : 0,
    endsAt: typeof raw.endsAt === 'number' ? raw.endsAt : null,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0
  };
}

// Strip nulls before writing: the rules reject unexpected keys, and a null
// endsAt would otherwise be sent as an explicit delete of a key that must
// either be a positive number or absent.
function payload(s) {
  const out = {
    status: s.status,
    durationMs: s.durationMs,
    remainingMs: s.remainingMs,
    updatedAt: s.updatedAt
  };
  if (typeof s.endsAt === 'number' && s.endsAt > 0) out.endsAt = s.endsAt;
  return out;
}

onValue(timerRef, (snapshot) => {
  const incoming = normalise(snapshot.val());
  ready = true;

  if (!incoming) {
    // Node is empty or was deleted. Seed it once with the defaults rather than
    // looping if the write is rejected.
    if (!seeded) {
      seeded = true;
      Sync.set({ status: 'idle', remainingMs: state.durationMs, endsAt: null });
    }
    emit();
    return;
  }

  seeded = true;
  state = incoming;
  emit();
}, (error) => {
  // Most likely cause: rules not published, or the node is unreadable.
  console.error('[sync] cannot read /timer —', error.message);
  ready = true;
  emit();
});

export const Sync = {
  DEFAULT_DURATION_MS,

  get() {
    return state;
  },

  isReady() {
    return ready;
  },

  set(next) {
    state = { ...state, ...next, updatedAt: Date.now() };
    emit();  // optimistic: don't wait for the round trip to redraw
    dbSet(timerRef, payload(state)).catch((error) => {
      console.error('[sync] write rejected —', error.message);
    });
    return state;
  },

  subscribe(fn) {
    listeners.push(fn);
    fn(state);
  }
};
