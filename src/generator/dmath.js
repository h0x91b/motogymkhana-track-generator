// Deterministic trigonometry for the generator.
//
// ECMAScript leaves Math.sin/cos/atan2 "implementation-approximated", so V8
// and JavaScriptCore may differ in the last bit — enough to flip a geometric
// comparison and give Safari and Chrome different courses for one seed.
// These versions use only + - * / (correctly rounded in IEEE 754) and
// Math.sqrt / Math.round / Math.floor, which are exact everywhere.

export const PI = Math.PI;
export const TAU = 2 * PI;
const HALF_PI = PI / 2;
const SQRT3 = Math.sqrt(3);
const TAN_15 = 2 - SQRT3;

function sinPoly(x) {
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))));
}

function cosPoly(x) {
  const x2 = x * x;
  return 1 + x2 * (-1 / 2 + x2 * (1 / 24 + x2 * (-1 / 720 + x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600 + x2 * (-1 / 87178291200 + x2 * (1 / 20922789888000))))))));
}

export function sin(x) {
  const k = Math.round(x / HALF_PI);
  const r = x - k * HALF_PI;
  switch (k & 3) {
    case 0: return sinPoly(r);
    case 1: return cosPoly(r);
    case 2: return -sinPoly(r);
    default: return -cosPoly(r);
  }
}

export function cos(x) {
  const k = Math.round(x / HALF_PI);
  const r = x - k * HALF_PI;
  switch (k & 3) {
    case 0: return cosPoly(r);
    case 1: return -sinPoly(r);
    case 2: return -cosPoly(r);
    default: return sinPoly(r);
  }
}

function atanSmall(z) {
  // |z| <= tan 15°: the series converges to double precision in 13 terms.
  const z2 = z * z;
  let sum = 0;
  for (let n = 25; n >= 1; n -= 2) sum = 1 / n - z2 * sum;
  return z * sum;
}

function atanUnit(t) {
  // 0 <= t <= 1
  if (t <= TAN_15) return atanSmall(t);
  return PI / 6 + atanSmall((t * SQRT3 - 1) / (t + SQRT3));
}

export function atan(t) {
  const sign = t < 0 ? -1 : 1;
  const a = t * sign;
  const r = a <= 1 ? atanUnit(a) : HALF_PI - atanUnit(1 / a);
  return sign * r;
}

export function atan2(y, x) {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let r = ax >= ay ? atanUnit(ay / ax) : HALF_PI - atanUnit(ax / ay);
  if (x < 0) r = PI - r;
  return y < 0 ? -r : r;
}

export function acos(x) {
  const c = x > 1 ? 1 : x < -1 ? -1 : x;
  return atan2(Math.sqrt(1 - c * c), c);
}

/** angle in [0, 2π) */
export function mod2pi(a) {
  return a - TAU * Math.floor(a / TAU);
}

/** angle in (-π, π] */
export function wrapPi(a) {
  const m = mod2pi(a);
  return m > PI ? m - TAU : m;
}
