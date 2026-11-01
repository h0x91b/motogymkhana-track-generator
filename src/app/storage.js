// The last form, under one namespaced and versioned localStorage key. Every
// access is guarded: private mode or a full quota just means no memory.
// localStorage.clear() is never called — other keys on the origin are not ours.

const KEY = 'motogymkhana-constructor:form:v1';

export function loadForm() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function saveForm(form) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(form));
  } catch {
    // Storage unavailable: the app keeps working without remembering the form.
  }
}

// The ride-through speed, a per-viewer preference under its own key.
const SPEED_KEY = 'motogymkhana-constructor:ride-speed:v1';

export function loadRideSpeed() {
  try {
    return Number(window.localStorage.getItem(SPEED_KEY)) || null;
  } catch {
    return null;
  }
}

export function saveRideSpeed(speed) {
  try {
    window.localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    // Storage unavailable: the speed resets on the next visit.
  }
}
