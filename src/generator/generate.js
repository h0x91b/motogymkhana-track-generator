// Course search: one deterministic attempt to lay out exactly n elements.
//
// Elements are placed one by one in route order. Each placement is drawn near
// its layout target, checked against the hard rules (inside the site, zones
// disjoint, connectors clear of every zone) and scored by the soft criteria;
// the best few are explored depth-first with backtracking. The effort is
// bounded by a count of evaluated placements, never by time, so a slow phone
// and a fast laptop always reach the same course.

import { BIKE_TURN_RADIUS, chooseParams, instantiate, isBig, minimalParams, ZONE_PAD } from './catalog.js';
import { dubinsPaths } from './dubins.js';
import { atan2, PI, wrapPi } from './dmath.js';
import {
  AXIS_STEPS, axisVector, boundsOverlap, dirAngle, obbBounds, obbCorners, obbOverlap,
  pointsBounds, polylineHitsObb, polylineLength, round2,
} from './geometry.js';
import { createStream } from './prng.js';
import { TRAIN_EXEMPT_TYPES, usableTypes } from './recipe.js';
import { layoutTargets, scorePlacement } from './soft.js';
import { GENERATOR_VERSION } from './version.js';

export const SITE_MARGIN = 1;
const START_LEAD = 2; // start line → entry of the first element, metres
const FINISH_LEAD = 2; // exit of the last element → finish line
const BEHIND_START = 2; // open course: room to wait behind the start line
const RUN_OUT = 2; // free space past the finish line
// Course whose finish is by the start: the finish line's centre lies within
// HOME_REACH m of the start line's, its zone clear of the start's. Offsets
// tried, in whole metres across and along the start's direction of travel.
const HOME_REACH = 8;
const HOME_ACROSS = [3, 4, 5, 6, 7, 8];
const HOME_ALONG = [0, -2, 2, -4, 4];
const HOME_TRIES = 8; // finish lines per placement given a connector to try
const LINE_STEPS = { side: 3, diagonal: 2 }; // half-width of a start/finish line in half-metre lattice steps
const CANDIDATES = 24; // placements drawn per element and type
const BRANCH = 3; // best placements explored per element and type before backtracking
// Types tried per element, in its seeded order of preference. Every allowed
// type is tried only on sites where no course fits with the first few: with
// many large types allowed, all three can be too big for a small site.
export const TYPE_TRY_LIMITS = [3, Infinity];
const CONNECTOR_RADII = [1, 1.5]; // × the minimum turning radius
const BUDGET_BASE = 720; // evaluated placements per attempt…
const BUDGET_PER_ELEMENT = 360; // …plus this many per requested element
const ROUNDS = 3; // the budget is split into restarts so early choices get revisited
const EPS = 0.01; // touching a zone edge is fine, entering it by more is not
// Connectors may not turn more than this in total: beyond it the rider would
// ride an unmarked loop.
const MAX_CONNECTOR_TURN = 300;
// Limits tried in turn for the closing connector of a closed course. The looser
// one is only for sites where no loop-free closed course fits at any size:
// bringing the rider back round to the start there can need a full turnaround.
export const CLOSING_TURN_LIMITS = [MAX_CONNECTOR_TURN, 400];
// A connector arc turning this much or more is a U-turn: a tall cone stands at
// its centre so the rider reads it as a turn round a cone, not open asphalt.
export const U_TURN_ANGLE = 160;
const U_TURN_RAD = (U_TURN_ANGLE * PI) / 180;
// Free asphalt kept round a U-turn cone: no zone and no other route leg comes
// closer (a square keep-out, so a little more along the diagonals).
export const U_TURN_CONE_CLEARANCE = 1.5;
// Two arcs the same way with a straight no longer than this between them are
// ridden as one turn: its cone stands midway between their centres.
const U_TURN_JOIN = 1;

// «Паровозик», a column of riders: the route never crosses itself or comes
// back within 1.5 m of itself, or two riders of the column could meet. Checked
// on 0.5 m samples, with a margin for the sampling error; samples closer than
// TRAIN_NEAR along the route are the same stretch. The passes of an exempt
// element are not checked against each other (TRAIN_EXEMPT_TYPES).
const TRAIN_CLEARANCE = 2;
const TRAIN_NEAR = 4;
const TRAIN_STEP = 0.5;

/**
 * The route ridden so far, as samples every TRAIN_STEP m with their distance
 * along, hashed into a grid of TRAIN_CLEARANCE cells.
 */
const EMPTY_TRACK = { grid: new Map(), length: 0, last: null };
const trainCell = (x, y) => `${Math.floor(x / TRAIN_CLEARANCE)},${Math.floor(y / TRAIN_CLEARANCE)}`;

/**
 * The trajectory of a placed element as the train check rides it: an exempt
 * one comes wrapped, and its samples are never checked against each other.
 */
const ridden = (el) => (TRAIN_EXEMPT_TYPES.includes(el.tpl.type) ? { points: el.path } : el.path);

/**
 * Samples of polylines ridden straight after `track`, continuing its distance
 * along. Samples of a wrapped polyline carry it as their owner.
 */
function continueTrack(track, polylines) {
  const samples = [];
  let s = track.length;
  let prev = track.last;
  for (const line of polylines) {
    const owner = line.points ? line : null;
    for (const p of line.points ?? line) {
      if (!prev) samples.push({ x: p[0], y: p[1], s, owner });
      else {
        const dx = p[0] - prev[0];
        const dy = p[1] - prev[1];
        const len = Math.sqrt(dx * dx + dy * dy);
        const k = Math.max(1, Math.ceil(len / TRAIN_STEP));
        for (let j = 1; j <= k; j++) samples.push({ x: prev[0] + (dx * j) / k, y: prev[1] + (dy * j) / k, s: s + (len * j) / k, owner });
        s += len;
      }
      prev = p;
    }
  }
  return { samples, length: s, last: prev };
}

function addToGrid(grid, p) {
  const key = trainCell(p.x, p.y);
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(p);
}

function extendTrack(track, polylines) {
  const { samples, length, last } = continueTrack(track, polylines);
  const grid = new Map([...track.grid].map(([key, cell]) => [key, [...cell]]));
  for (const p of samples) addToGrid(grid, p);
  return { grid, length, last };
}

/**
 * Whether `next`, ridden straight after `track`, keeps clear of the route so
 * far and of itself. When it `closes` the route back onto its start, distance
 * along also counts the way through the finish.
 */
function trainClear(track, next, closes = false) {
  const { samples, length } = continueTrack(track, next);
  const fresh = new Map();
  const meets = (p, cell) => {
    if (!cell) return false;
    for (const q of cell) {
      if (p.owner && p.owner === q.owner) continue;
      const along = p.s - q.s;
      const gap = closes && length - along < along ? length - along : along;
      if (gap < TRAIN_NEAR) continue;
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      if (dx * dx + dy * dy < TRAIN_CLEARANCE * TRAIN_CLEARANCE) return true;
    }
    return false;
  };
  for (const p of samples) {
    const cx = Math.floor(p.x / TRAIN_CLEARANCE);
    const cy = Math.floor(p.y / TRAIN_CLEARANCE);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const key = `${cx + i},${cy + j}`;
        if (meets(p, track.grid.get(key)) || meets(p, fresh.get(key))) return false;
      }
    }
    addToGrid(fresh, p);
  }
  return true;
}

const LOCAL_DIRS = { '1,0': 0, '0,1': 2, '-1,0': 4, '0,-1': 6 };
const localDirIndex = ([a, b]) => LOCAL_DIRS[`${a},${b}`];

function innerRect(recipe) {
  return [SITE_MARGIN, SITE_MARGIN, recipe.width - SITE_MARGIN, recipe.length - SITE_MARGIN];
}

const inside = (r, p) => p[0] >= r[0] - 1e-9 && p[0] <= r[2] + 1e-9 && p[1] >= r[1] - 1e-9 && p[1] <= r[3] + 1e-9;

/** Does a local rectangle of the template fit a w × h area in some orientation? */
function rectFits(tpl, rect, w, h) {
  const la = (rect[2] - rect[0]) * tpl.unit;
  const lb = (rect[3] - rect[1]) * tpl.unit;
  if (tpl.diagonal) {
    const e = (la + lb) * Math.SQRT1_2;
    return e <= w && e <= h;
  }
  return (la <= w && lb <= h) || (lb <= w && la <= h);
}

/**
 * Does the template's core (cones + trajectory) fit the inner site, and its
 * run-off zone the whole site, in some orientation?
 */
export function templateFits(tpl, inner) {
  const fitsCore = rectFits(tpl, tpl.core, inner[2] - inner[0], inner[3] - inner[1]);
  if (!fitsCore || !tpl.runOff) return fitsCore;
  return rectFits(tpl, tpl.runOff, inner[2] - inner[0] + 2 * SITE_MARGIN, inner[3] - inner[1] + 2 * SITE_MARGIN);
}

function templateFor(plan, diagonal, mirrored) {
  const key = `${diagonal ? 1 : 0}${mirrored ? 1 : 0}`;
  if (!(key in plan.templates)) {
    const params = diagonal ? plan.params.diagonal : plan.params.side;
    plan.templates[key] = params ? instantiate(plan.type, params, diagonal, mirrored) : null;
  }
  return plan.templates[key];
}

/**
 * The axis whose entry faces the way the element is reached from `from`
 * towards `to`, so the connector leads straight in instead of turning round
 * on open asphalt; the first such axis in the plan's order on a tie.
 */
function facingAxis(plan, mirrored, from, to) {
  const bearing = atan2(to[1] - from[1], to[0] - from[0]);
  let best = null;
  let off = Infinity;
  for (const axis of plan.axes) {
    const tpl = templateFor(plan, axis % 2 === 1, mirrored);
    const d = Math.abs(wrapPi(dirAngle((localDirIndex(tpl.entryDir) + axis) % 8) - bearing));
    if (d < off - 1e-9) {
      off = d;
      best = axis;
    }
  }
  return best;
}

/** Places a local template: axis 0..7, anchor on whole metres. */
function placeTemplate(tpl, axis, ax, ay) {
  const [dx, dy] = AXIS_STEPS[axis];
  const px = -dy;
  const py = dx;
  const toM = (a, b) => [(2 * ax + a * dx + b * px) / 2, (2 * ay + a * dy + b * py) / 2];
  const obb = (z) => ({
    c: toM((z[0] + z[2]) / 2, (z[1] + z[3]) / 2),
    u: axisVector(axis),
    v: axisVector(axis + 2),
    hu: ((z[2] - z[0]) / 2) * tpl.unit,
    hv: ((z[3] - z[1]) / 2) * tpl.unit,
  });
  const zone = obb(tpl.zone);
  const runOff = tpl.runOff && obb(tpl.runOff);
  const k = tpl.core;
  const core = [toM(k[0], k[1]), toM(k[2], k[1]), toM(k[2], k[3]), toM(k[0], k[3])];
  const entryDir = (localDirIndex(tpl.entryDir) + axis) % 8;
  const exitDir = (localDirIndex(tpl.exitDir) + axis) % 8;
  const entry = toM(...tpl.path[0]);
  const exit = toM(...tpl.path[tpl.path.length - 1]);
  const path = tpl.path.map(([a, b]) => toM(a, b));
  return {
    tpl, axis, ax, ay, zone, zoneBounds: obbBounds(zone), runOff, runOffBounds: runOff && obbBounds(runOff), core, entry, exit, entryDir, exitDir, path,
    center: zone.c,
    world: () => ({
      cones: tpl.cones.map((c) => ({ hx: 2 * ax + c.a * dx + c.b * px, hy: 2 * ay + c.a * dy + c.b * py, height: c.height })),
      path,
      // Arcs to lay curved walls and rings out with a tape: centre in metres,
      // radii in metres, angles in degrees anticlockwise from +x.
      guides: tpl.guides.map((g) => {
        const from = (((g.from * 180) / PI + 45 * axis) % 360 + 360) % 360;
        return { center: toM(...g.center), radii: g.radii.map((r) => r * tpl.unit), from, to: from + ((g.to - g.from) * 180) / PI };
      }),
    }),
  };
}

/** A start or finish line two low cones wide, across `dir`, centred near `ideal`. */
function lineTerminal(ideal, dir, from, to) {
  const [dx, dy] = AXIS_STEPS[dir];
  const steps = dir % 2 === 1 ? LINE_STEPS.diagonal : LINE_STEPS.side;
  const px = -dy;
  const py = dx;
  // First cone on whole metres; the second is an even number of half-metre steps away.
  const c1 = [Math.round(ideal[0] - (px * steps) / 2), Math.round(ideal[1] - (py * steps) / 2)];
  const c2 = [c1[0] + px * steps, c1[1] + py * steps];
  const center = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2];
  const u = axisVector(dir);
  const v = axisVector(dir + 2);
  const half = (steps * Math.sqrt(px * px + py * py)) / 2;
  const zone = {
    c: [center[0] + u[0] * ((from + to) / 2), center[1] + u[1] * ((from + to) / 2)],
    u, v, hu: (to - from) / 2, hv: half + ZONE_PAD,
  };
  return { cones: [c1, c2], center, dir, zone, zoneBounds: obbBounds(zone) };
}

function startTerminal(first, closed) {
  const u = axisVector(first.entryDir);
  const ideal = [first.entry[0] - u[0] * START_LEAD, first.entry[1] - u[1] * START_LEAD];
  const probe = lineTerminal(ideal, first.entryDir, 0, 0);
  const lead = (first.entry[0] - probe.center[0]) * u[0] + (first.entry[1] - probe.center[1]) * u[1];
  return lineTerminal(ideal, first.entryDir, closed ? 0 : -BEHIND_START, lead);
}

function finishTerminal(last) {
  const u = axisVector(last.exitDir);
  const ideal = [last.exit[0] + u[0] * FINISH_LEAD, last.exit[1] + u[1] * FINISH_LEAD];
  const probe = lineTerminal(ideal, last.exitDir, 0, 0);
  const lead = (probe.center[0] - last.exit[0]) * u[0] + (probe.center[1] - last.exit[1]) * u[1];
  return lineTerminal(ideal, last.exitDir, -lead, RUN_OUT);
}

/** Cones inside the margin, and the waiting / run-out area on the asphalt. */
function terminalInside(t, inner, site) {
  return t.cones.every((c) => inside(inner, c)) && obbCorners(t.zone).every((p) => inside(site, p));
}

/**
 * Closing connector of a closed course: a Dubins path to a point one turning
 * radius behind the start line, then straight across it, so the rider is lined
 * up when crossing the line.
 */
function closingLeg(fromPose, startT, radius, inner, zones, paths, maxTurn, accept = null) {
  const u = axisVector(startT.dir);
  const approach = [startT.center[0] - u[0] * radius, startT.center[1] - u[1] * radius];
  const last = [approach, startT.center];
  if (!inside(inner, approach) || !pathClear(last, pointsBounds(last), zones)) return null;
  const whole = accept && ((pts) => accept([...pts, startT.center]));
  const leg = connect(fromPose, pose(approach, startT.dir), radius, inner, zones, paths, maxTurn, whole);
  if (!leg) return null;
  const points = [...leg.points, startT.center];
  return { ...leg, points, bounds: pointsBounds(points), length: leg.length + radius };
}

/**
 * Cones at the centres of a Dubins path's U-turns (an arc, or two arcs the
 * same way joined by a short straight), on the half-metre
 * lattice, each with a square keep-out that the search treats like a zone.
 * The cone stays on the inside of the turn: blue (left) on a left turn.
 */
function uTurnCones(arcs) {
  const turns = [];
  for (const arc of arcs) {
    const last = turns[turns.length - 1];
    if (last && last.left === arc.left && arc.gapBefore <= U_TURN_JOIN + 1e-6) {
      last.turn += arc.turn;
      last.center = [(last.first[0] + arc.center[0]) / 2, (last.first[1] + arc.center[1]) / 2];
    } else turns.push({ turn: arc.turn, left: arc.left, center: arc.center, first: arc.center });
  }
  const cones = [];
  for (const t of turns) {
    if (t.turn < U_TURN_RAD - 1e-9) continue;
    const hx = Math.round(2 * t.center[0]);
    const hy = Math.round(2 * t.center[1]);
    const zone = { c: [hx / 2, hy / 2], u: [1, 0], v: [0, 1], hu: U_TURN_CONE_CLEARANCE, hv: U_TURN_CONE_CLEARANCE };
    cones.push({ hx, hy, side: t.left ? 'left' : 'right', zone, zoneBounds: obbBounds(zone) });
  }
  return cones;
}

/**
 * U-turn cones stand on the site, with their keep-out clear of every zone
 * (elements, terminals, other U-turn cones), of every run-off zone and of
 * every route leg in `paths`.
 */
function conesClear(cones, inner, zones, paths) {
  for (const cone of cones) {
    if (!inside(inner, cone.zone.c)) return false;
    for (const z of zones) {
      if (boundsOverlap(cone.zoneBounds, z.zoneBounds) && obbOverlap(cone.zone, z.zone)) return false;
      // A U-turn cone is placed: it stays out of every run-off zone too.
      if (z.runOff && boundsOverlap(cone.zoneBounds, z.runOffBounds) && obbOverlap(cone.zone, z.runOff)) return false;
    }
    for (const p of paths) {
      if (boundsOverlap(cone.zoneBounds, p.bounds) && polylineHitsObb(p.points, cone.zone, EPS)) return false;
    }
  }
  return true;
}

/**
 * Finish line by the start, in a fixed order of preference: closest to the
 * start first, ties in the order tried (same direction of travel as the start
 * before the opposite one, then left before right, then along). Its zone keeps
 * clear of the start's and of every other zone and leg, and the last element's
 * connector reaches it lined up, like the closing connector of a closed course,
 * with its U-turn cones clear of the finish zone too.
 */
function homeFinish(fromPose, startT, radius, inner, site, zones, paths, maxTurn, accept) {
  const u = axisVector(startT.dir);
  const v = axisVector(startT.dir + 2);
  const spots = [];
  for (const dir of [startT.dir, (startT.dir + 4) % 8]) {
    for (const across of HOME_ACROSS) {
      for (const side of [1, -1]) {
        for (const along of HOME_ALONG) {
          const ideal = [
            startT.center[0] + v[0] * across * side + u[0] * along,
            startT.center[1] + v[1] * across * side + u[1] * along,
          ];
          const t = lineTerminal(ideal, dir, -FINISH_LEAD, RUN_OUT);
          const dx = t.center[0] - startT.center[0];
          const dy = t.center[1] - startT.center[1];
          spots.push({ t, d2: dx * dx + dy * dy, order: spots.length });
        }
      }
    }
  }
  spots.sort((a, b) => a.d2 - b.d2 || a.order - b.order);
  let tries = 0;
  for (const { t, d2 } of spots) {
    if (d2 > HOME_REACH * HOME_REACH) break;
    if (!terminalInside(t, inner, site)) continue;
    if (obbOverlap(t.zone, startT.zone) || !zoneClear(t, zones, paths)) continue;
    if (++tries > HOME_TRIES) break;
    const leg = closingLeg(fromPose, t, radius, inner, zones, paths, maxTurn, accept);
    if (leg && leg.cones.every((c) => !obbOverlap(c.zone, t.zone))) return { terminal: t, leg };
  }
  return null;
}

function pathClear(points, bounds, zones) {
  for (const z of zones) {
    if (!boundsOverlap(bounds, z.zoneBounds)) continue;
    if (polylineHitsObb(points, z.zone, EPS)) return false;
  }
  return true;
}

/**
 * Zones disjoint, connectors out of the candidate's zone, and nothing placed in
 * a run-off zone: no other element's zone or terminal in the candidate's, the
 * candidate's zone in no other's. Run-off zones may overlap each other and
 * connectors may cross them: they are only free asphalt.
 */
function zoneClear(candidate, zones, paths) {
  for (const z of zones) {
    if (boundsOverlap(candidate.zoneBounds, z.zoneBounds) && obbOverlap(candidate.zone, z.zone)) return false;
    if (z.runOff && boundsOverlap(candidate.zoneBounds, z.runOffBounds) && obbOverlap(candidate.zone, z.runOff)) return false;
    if (candidate.runOff && boundsOverlap(candidate.runOffBounds, z.zoneBounds) && obbOverlap(candidate.runOff, z.zone)) return false;
  }
  for (const p of paths) {
    if (boundsOverlap(candidate.zoneBounds, p.bounds) && polylineHitsObb(p.points, candidate.zone, EPS)) return false;
  }
  return true;
}

/**
 * Shortest Dubins connector that stays inside the site, out of every zone and,
 * when given, passes `accept`. Tried at the minimum turning radius first, then
 * at a wider one, which gives differently shaped detours around nearby zones.
 */
function connect(fromPose, toPose, radius, inner, zones, paths, maxTurn = MAX_CONNECTOR_TURN, accept = null) {
  for (const rho of CONNECTOR_RADII.map((k) => k * radius)) {
    for (const path of dubinsPaths(fromPose, toPose, rho)) {
      if (path.turnLeft + path.turnRight > maxTurn) continue;
      if (!path.points.every((p) => inside(inner, p))) continue;
      const bounds = pointsBounds(path.points);
      if (!pathClear(path.points, bounds, zones)) continue;
      const cones = uTurnCones(path.arcs);
      if (cones.length && !conesClear(cones, inner, zones, [...paths, { points: path.points, bounds }])) continue;
      if (accept && !accept(path.points)) continue;
      return { points: path.points, bounds, length: path.length, turnLeft: path.turnLeft, turnRight: path.turnRight, cones };
    }
  }
  return null;
}

const pose = (p, dir) => [p[0], p[1], dirAngle(dir)];

/** v clamped to the integers in [lo, hi], or null when there are none. */
function clampInt(v, lo, hi) {
  const a = Math.ceil(lo - 1e-9);
  const b = Math.floor(hi + 1e-9);
  if (a > b) return null;
  return v < a ? a : v > b ? b : v;
}

function straightLeg(a, b) {
  const points = [a, b];
  return { points, bounds: pointsBounds(points), length: polylineLength(points), turnLeft: 0, turnRight: 0, cones: [] };
}

/** Allowed types that fit the site at their most compact sizes, in canonical order. */
export function feasibleTypes(recipe) {
  const inner = innerRect(recipe);
  return usableTypes(recipe).filter((type) => {
    const p = minimalParams(type, recipe.difficulty, recipe.bike);
    return [p.side && instantiate(type, p.side, false, false), p.diagonal && instantiate(type, p.diagonal, true, false)]
      .some((tpl) => tpl && templateFits(tpl, inner));
  });
}

/** Is the type a big element even at its most compact sizes, on every axis class? */
export function alwaysBig(type, difficulty, bike) {
  const p = minimalParams(type, difficulty, bike);
  return [p.side && instantiate(type, p.side, false, false), p.diagonal && instantiate(type, p.diagonal, true, false)]
    .filter(Boolean)
    .every(isBig);
}

/** Seeded order of preference over the feasible types, one list per element. */
function typePreferences(seed, feasible, n) {
  // Deal types like cards from a shuffled deck, so a course uses every
  // allowed type once before repeating any; the rest of the deck, in its
  // shuffled order, are the fallbacks when the dealt type does not fit.
  const rng = createStream(seed, 'types');
  const shuffle = (items) => {
    const pool = [...items];
    const out = [];
    while (pool.length) out.push(pool.splice(Math.floor(rng.float() * pool.length), 1)[0]);
    return out;
  };
  const dealt = [];
  while (dealt.length < n) dealt.push(...shuffle(feasible));
  return dealt.slice(0, n).map((first) => [first, ...shuffle(feasible.filter((t) => t !== first))]);
}

/**
 * Sizes of element i when it is of `type`: drawn from its own stream,
 * compacted if they do not fit — or, when `small`, if they make a big element.
 * A type that is big even at its most compact sizes gets no axes then.
 */
function makePlan(recipe, seed, i, type, inner, small) {
  const plan = { type, params: chooseParams(type, recipe.difficulty, recipe.bike, createStream(seed, `params:${i}:${type}`)), templates: {} };
  const fitsAxis = (axis) => {
    const tpl = templateFor(plan, axis % 2 === 1, false);
    return tpl && templateFits(tpl, inner) && !(small && isBig(tpl));
  };
  if (![0, 1].some(fitsAxis)) {
    plan.params = minimalParams(type, recipe.difficulty, recipe.bike);
    plan.templates = {};
  }
  plan.axes = [0, 1, 2, 3, 4, 5, 6, 7].filter(fitsAxis);
  return plan;
}

class BudgetExhausted extends Error {}

/**
 * @returns {{ok: true, course: object} | {ok: false}}
 */
export function buildCourse(recipe, seed, n, closingTurn = MAX_CONNECTOR_TURN, typeTries = TYPE_TRY_LIMITS[0]) {
  const inner = innerRect(recipe);
  const site = [0, 0, recipe.width, recipe.length];
  const feasible = feasibleTypes(recipe);
  if (!feasible.length) return { ok: false };
  const preferences = typePreferences(seed, feasible, n);
  const plans = new Map();
  // After a big element, every later one must be small.
  const planFor = (i, type, small) => {
    const key = `${i}:${type}:${small ? 1 : 0}`;
    if (!plans.has(key)) plans.set(key, makePlan(recipe, seed, i, type, inner, small));
    return plans.get(key);
  };
  const closed = recipe.shape === 'closed';
  const targets = layoutTargets(inner, n, recipe.shape !== 'open', createStream(seed, 'layout'));
  const place = createStream(seed, 'place');
  const radius = BIKE_TURN_RADIUS[recipe.bike];
  const diagonal = Math.sqrt(recipe.width * recipe.width + recipe.length * recipe.length);
  const budget = BUDGET_BASE + BUDGET_PER_ELEMENT * n;
  let spent = 0;
  let roundEnd = 0;

  const placed = []; // placements in route order
  const legs = []; // connectors and straight legs in route order
  const zones = []; // every zone placed so far: elements and terminals
  let start = null;
  let finish = null;
  let turnLeft = 0;
  let turnRight = 0;

  function candidates(i, type) {
    const plan = planFor(i, type, placed.some((p) => isBig(p.tpl)));
    const target = targets[i];
    const out = [];
    for (let c = 0; c < CANDIDATES; c++) {
      if (++spent > roundEnd) throw new BudgetExhausted();
      const drawn = place.pick(plan.axes);
      const mirrored = place.int(0, 1) === 1;
      // Every other candidate faces the connector that leads into it.
      const axis = i > 0 && c % 2 === 0 ? facingAxis(plan, mirrored, placed[i - 1].exit, target) : drawn;
      const reach = (0.03 + (0.3 * c) / CANDIDATES) * diagonal;
      const jx = place.range(-reach, reach);
      const jy = place.range(-reach, reach);
      const tpl = templateFor(plan, axis % 2 === 1, mirrored);
      const origin = placeTemplate(tpl, axis, 0, 0);
      // Slide the anchor (whole metres) so the core stays inside the margin
      // and the run-off zone, if any, on the site.
      const [x0, y0, x1, y1] = pointsBounds(origin.core);
      let lo = [inner[0] - x0, inner[1] - y0];
      let hi = [inner[2] - x1, inner[3] - y1];
      if (origin.runOff) {
        const [r0, s0, r1, s1] = origin.runOffBounds;
        lo = [Math.max(lo[0], site[0] - r0), Math.max(lo[1], site[1] - s0)];
        hi = [Math.min(hi[0], site[2] - r1), Math.min(hi[1], site[3] - s1)];
      }
      const ax = clampInt(Math.round(target[0] + jx - origin.center[0]), lo[0], hi[0]);
      const ay = clampInt(Math.round(target[1] + jy - origin.center[1]), lo[1], hi[1]);
      if (ax === null || ay === null) continue;
      const cand = placeTemplate(tpl, axis, ax, ay);
      const result = evaluate(i, cand);
      if (result) out.push({ ...result, cand, order: c });
    }
    out.sort((a, b) => b.score - a.score || a.order - b.order);
    return out.slice(0, BRANCH);
  }

  // In «паровозик», the route ridden before element i, kept per depth of the search.
  const tracks = [];
  function trackBefore(i) {
    if (i === 0) return EMPTY_TRACK;
    const kept = tracks[i];
    if (kept && kept.owner === placed[i - 1]) return kept.track;
    const track = extendTrack(trackBefore(i - 1), [legs[i - 1].points, ridden(placed[i - 1])]);
    tracks[i] = { owner: placed[i - 1], track };
    return track;
  }

  function evaluate(i, cand) {
    if (!cand.core.every((p) => inside(inner, p))) return null;
    if (cand.runOff && !obbCorners(cand.runOff).every((p) => inside(site, p))) return null;
    const track = recipe.train ? trackBefore(i) : null;
    const paths = [...legs];
    if (!zoneClear(cand, zones, paths)) return null;
    let entryLeg;
    let terminal = null;
    if (i === 0) {
      terminal = startTerminal(cand, closed);
      if (!terminalInside(terminal, inner, site)) return null;
      if (closed) {
        // Room behind the line for the closing connector to line up.
        const u = axisVector(terminal.dir);
        if (!inside(inner, [terminal.center[0] - u[0] * radius, terminal.center[1] - u[1] * radius])) return null;
      }
      if (!zoneClear(terminal, zones, paths)) return null;
      if (obbOverlap(terminal.zone, cand.zone)) return null;
      entryLeg = straightLeg(terminal.center, cand.entry);
      if (track && !trainClear(track, [entryLeg.points, ridden(cand)])) return null;
    } else {
      const prev = placed[i - 1];
      // In «паровозик» the connector and the element it leads into keep clear of the route so far.
      const accept = track && ((pts) => trainClear(track, [pts, ridden(cand)]));
      entryLeg = connect(pose(prev.exit, prev.exitDir), pose(cand.entry, cand.entryDir), radius, inner, [...zones, cand], paths, MAX_CONNECTOR_TURN, accept);
      if (!entryLeg) return null;
    }
    let exitLeg = null;
    let finishTerminalCand = null;
    if (i === n - 1) {
      const startT = terminal || start;
      if (closed) {
        // The start zone is an obstacle too, so the closing connector cannot cut
        // across the start's own lead-in; it arrives on the zone edge at the line.
        const obstacles = i === 0 ? [cand, startT] : [...zones, cand, ...entryLeg.cones];
        // In «паровозик» it keeps clear of the whole route, and rides back into its start.
        const before = track && extendTrack(track, [entryLeg.points, ridden(cand)]);
        const accept = track && ((pts) => trainClear(before, [pts], true));
        exitLeg = closingLeg(pose(cand.exit, cand.exitDir), startT, radius, inner, obstacles, [...paths, entryLeg], closingTurn, accept);
        if (!exitLeg) return null;
      } else if (recipe.shape === 'return') {
        // Back to a finish line by the start; the start zone is an obstacle, and
        // in «паровозик» the way there keeps clear of the whole route.
        const obstacles = i === 0 ? [cand, startT] : [...zones, cand, ...entryLeg.cones];
        const before = track && extendTrack(track, [entryLeg.points, ridden(cand)]);
        const accept = track && ((pts) => trainClear(before, [pts]));
        const home = homeFinish(pose(cand.exit, cand.exitDir), startT, radius, inner, site, obstacles, [...paths, entryLeg], closingTurn, accept);
        if (!home) return null;
        finishTerminalCand = home.terminal;
        exitLeg = home.leg;
      } else {
        finishTerminalCand = finishTerminal(cand);
        if (!terminalInside(finishTerminalCand, inner, site)) return null;
        const others = i === 0 ? [startT] : [...zones, ...entryLeg.cones];
        if (!zoneClear(finishTerminalCand, others, [...paths, entryLeg])) return null;
        if (obbOverlap(finishTerminalCand.zone, cand.zone)) return null;
        exitLeg = straightLeg(cand.exit, finishTerminalCand.center);
        // The straight run to the finish keeps clear of every U-turn cone.
        if (!pathClear(exitLeg.points, exitLeg.bounds, others.filter((z) => z.side))) return null;
        if (track && !trainClear(extendTrack(track, [entryLeg.points, ridden(cand)]), [exitLeg.points])) return null;
      }
    }
    const tl = turnLeft + entryLeg.turnLeft + cand.tpl.turnLeft + (exitLeg ? exitLeg.turnLeft : 0);
    const tr = turnRight + entryLeg.turnRight + cand.tpl.turnRight + (exitLeg ? exitLeg.turnRight : 0);
    const score = scorePlacement({
      center: cand.center,
      target: targets[i],
      others: placed.map((p) => p.center),
      connectorLength: entryLeg.length + (exitLeg ? exitLeg.length : 0),
      connectorTurn: entryLeg.turnLeft + entryLeg.turnRight + (exitLeg ? exitLeg.turnLeft + exitLeg.turnRight : 0),
      turnLeft: tl,
      turnRight: tr,
      diagonal,
    });
    return { score, entryLeg, exitLeg, terminal, finishTerminal: finishTerminalCand };
  }

  function search(i) {
    if (i === n) return true;
    const prev = i > 0 ? placed[i - 1].tpl.type : null;
    // Two identical types in a row only when the user allowed a single type,
    // and never a second big element: a type that is big at any size is not
    // tried once one stands.
    const small = placed.some((p) => isBig(p.tpl));
    const types = preferences[i]
      .filter((t) => (usableTypes(recipe).length === 1 || t !== prev) && !(small && planFor(i, t, true).axes.length === 0))
      .slice(0, typeTries);
    for (const type of types) {
      for (const option of candidates(i, type)) {
        const { cand, entryLeg, exitLeg, terminal, finishTerminal: fin } = option;
        const saved = { turnLeft, turnRight, start, finish, zones: zones.length, legs: legs.length };
        if (terminal) {
          start = terminal;
          zones.push(terminal);
        }
        placed.push(cand);
        zones.push(cand, ...entryLeg.cones);
        legs.push(entryLeg);
        if (exitLeg) {
          legs.push(exitLeg);
          zones.push(...exitLeg.cones);
        }
        if (fin) {
          finish = fin;
          zones.push(fin);
        }
        turnLeft += entryLeg.turnLeft + cand.tpl.turnLeft + (exitLeg ? exitLeg.turnLeft : 0);
        turnRight += entryLeg.turnRight + cand.tpl.turnRight + (exitLeg ? exitLeg.turnRight : 0);
        if (search(i + 1)) return true;
        placed.pop();
        zones.length = saved.zones;
        legs.length = saved.legs;
        ({ turnLeft, turnRight, start, finish } = saved);
      }
    }
    return false;
  }

  // Each round is a fresh depth-first search; the placement stream carries on,
  // so every round draws new candidates. A round that runs dry (search space
  // exhausted) hands its unused budget to the next one.
  for (let round = 0; round < ROUNDS && spent < budget; round++) {
    roundEnd = round === ROUNDS - 1 ? budget : Math.min(budget, spent + Math.ceil(budget / ROUNDS));
    placed.length = 0;
    legs.length = 0;
    zones.length = 0;
    start = null;
    finish = null;
    turnLeft = 0;
    turnRight = 0;
    try {
      if (search(0)) return { ok: true, course: assemble(recipe, seed, placed, legs, start, finish) };
    } catch (e) {
      if (!(e instanceof BudgetExhausted)) throw e;
      spent = roundEnd;
    }
  }
  return { ok: false };
}

const rp = ([x, y]) => [round2(x), round2(y)];
const zoneCorners = (zone) => obbCorners(zone).map(rp);

function assemble(recipe, seed, placed, legs, start, finish) {
  const cones = [];
  const addCone = (hx, hy, height) => {
    const id = `c${cones.length + 1}`;
    cones.push({ id, hx, hy, height });
    return id;
  };
  const terminalOut = (t) => ({
    x: round2(t.center[0]),
    y: round2(t.center[1]),
    dir: t.dir,
    cones: t.cones.map(([x, y]) => addCone(2 * x, 2 * y, 'low')),
    zone: zoneCorners(t.zone),
  });
  const startOut = terminalOut(start);
  const elements = [];
  const passes = [];
  // U-turn cones of each connector, in route order with the elements' cones;
  // turning round one is a pass of the connector.
  const legCones = legs.map((leg, i) => {
    const from = i === 0 ? 'start' : `e${i}`;
    const to = i < placed.length ? `e${i + 1}` : 'finish';
    return () => leg.cones.map((c) => {
      const cone = addCone(c.hx, c.hy, 'tall');
      passes.push({ id: `p${passes.length + 1}`, kind: 'cone', connector: { from, to }, cone, side: c.side });
      return cone;
    });
  });
  const connectorCones = [];
  placed.forEach((p, i) => {
    connectorCones.push(legCones[i]());
    const id = `e${i + 1}`;
    const world = p.world();
    const ids = world.cones.map((c) => addCone(c.hx, c.hy, c.height));
    for (const pass of p.tpl.passes) {
      const base = { id: `p${passes.length + 1}`, element: id };
      if (pass.kind === 'gate') {
        passes.push({ ...base, kind: 'gate', left: ids[pass.left], right: ids[pass.right] });
      } else if (pass.kind === 'line') {
        passes.push({ ...base, kind: 'line', from: ids[pass.from], to: ids[pass.to] });
      } else {
        passes.push({ ...base, kind: 'cone', cone: ids[pass.cone], side: pass.side, ...(pass.angle ? { angle: pass.angle } : {}) });
      }
    }
    elements.push({
      id,
      order: i + 1,
      type: p.tpl.type,
      axis: p.axis,
      mirrored: p.tpl.mirrored,
      params: p.tpl.params,
      anchor: ids[0],
      cones: ids,
      entry: { x: round2(p.entry[0]), y: round2(p.entry[1]), dir: p.entryDir },
      exit: { x: round2(p.exit[0]), y: round2(p.exit[1]), dir: p.exitDir },
      path: world.path.map(rp),
      zone: zoneCorners(p.zone),
      ...(p.runOff ? { runOff: zoneCorners(p.runOff) } : {}),
      ...(p.tpl.lines.length ? { lines: p.tpl.lines.map((l) => ({ kind: l.kind, cones: l.cones.map((k) => ids[k]) })) } : {}),
      ...(world.guides.length
        ? {
          guides: world.guides.map((g) => ({
            x: round2(g.center[0]), y: round2(g.center[1]), radii: g.radii.map(round2), from: round2(g.from), to: round2(g.to),
          })),
        }
        : {}),
    });
  });
  for (let i = placed.length; i < legs.length; i++) connectorCones.push(legCones[i]());
  const finishOut = recipe.shape === 'closed' ? startOut : terminalOut(finish);
  const routeLegs = [];
  legs.forEach((leg, i) => {
    const from = i === 0 ? 'start' : elements[i - 1].id;
    const to = i < elements.length ? elements[i].id : 'finish';
    const cones = connectorCones[i];
    routeLegs.push({ kind: 'connector', from, to, path: leg.points.map(rp), ...(cones.length ? { cones } : {}) });
    if (i < elements.length) routeLegs.push({ kind: 'element', element: elements[i].id });
  });
  return {
    generatorVersion: GENERATOR_VERSION,
    recipe,
    seed,
    site: { width: recipe.width, length: recipe.length, margin: SITE_MARGIN },
    cones,
    elements,
    passes,
    route: { shape: recipe.shape, start: startOut, finish: finishOut, legs: routeLegs },
  };
}
