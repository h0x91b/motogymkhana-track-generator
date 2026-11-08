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

// Whether the plan shows the reserved zones, a per-viewer preference.
const ZONES_KEY = 'motogymkhana-constructor:zones:v1';

export function loadZones() {
  try {
    return window.localStorage.getItem(ZONES_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveZones(on) {
  try {
    window.localStorage.setItem(ZONES_KEY, on ? 'on' : 'off');
  } catch {
    // Storage unavailable: the zones are shown again on the next visit.
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

// The course as edited by hand («Правка»): its layout, under its own key and
// format version. It is shown again only for the recipe and seed it was made from.
const EDIT_KEY = 'motogymkhana-constructor:edit:v1';

export function loadEdit() {
  try {
    const raw = window.localStorage.getItem(EDIT_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the edited layout, or forgets it (null). */
export function saveEdit(layout) {
  try {
    if (layout) window.localStorage.setItem(EDIT_KEY, JSON.stringify(layout));
    else window.localStorage.removeItem(EDIT_KEY);
  } catch {
    // Storage unavailable: the edits live until the tab is closed.
  }
}
