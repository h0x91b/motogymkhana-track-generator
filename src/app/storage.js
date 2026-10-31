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
