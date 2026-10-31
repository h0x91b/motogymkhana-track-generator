// The one PRNG of the generator: mulberry32, seeded per named stream.
// Each decision family (types, parameters, layout, placement) draws from its
// own stream, so adding a draw in one family never shifts another family.

function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function streamState(seed, label) {
  let h = mix32((seed >>> 0) ^ 0x9e3779b9);
  for (let i = 0; i < label.length; i++) {
    h = mix32(h ^ label.charCodeAt(i));
  }
  return h;
}

/**
 * @param {number} seed integer 0..2^32-1
 * @param {string} label stream name, e.g. "types" or "params:3"
 */
export function createStream(seed, label) {
  let state = streamState(seed, label);
  const u32 = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const float = () => u32() / 4294967296;
  return {
    u32,
    float,
    /** integer in [min, max], both inclusive */
    int: (min, max) => min + Math.floor(float() * (max - min + 1)),
    pick: (items) => items[Math.floor(float() * items.length)],
    range: (min, max) => min + float() * (max - min),
  };
}
