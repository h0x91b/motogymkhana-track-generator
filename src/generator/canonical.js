// Canonical serialization: object keys sorted at every level, arrays kept in
// their (stable, id-ordered) order. Used to compare a course with the one on
// screen (same recipe and seed) and by the repeatability tests.

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

export function canonicalJSON(value) {
  return JSON.stringify(sortKeys(value));
}
