// Course search: one deterministic attempt to lay out exactly n elements.
//
// Elements are placed one by one in route order. Each placement is drawn near
// its layout target, checked against the hard rules (inside the site, zones
// disjoint, connectors clear of every zone) and scored by the soft criteria;
// the best few are explored depth-first with backtracking. The effort is
// bounded by a count of evaluated placements, never by time, so a slow phone
// and a fast laptop always reach the same course.

import { chooseParams, instantiate, minimalParams, DIFFICULTY_TABLE, ZONE_PAD } from './catalog.js';
import { dubinsPaths } from './dubins.js';
import {
  AXIS_STEPS, axisVector, boundsOverlap, dirAngle, obbBounds, obbCorners, obbOverlap,
  pointsBounds, polylineHitsObb, polylineLength, round2,
} from './geometry.js';
import { createStream } from './prng.js';
import { layoutTargets, scorePlacement } from './soft.js';
import { GENERATOR_VERSION } from './version.js';

export const SITE_MARGIN = 1;
const START_LEAD = 2; // start line → entry of the first element, metres
const FINISH_LEAD = 2; // exit of the last element → finish line
const BEHIND_START = 2; // open course: room to wait behind the start line
const RUN_OUT = 2; // free space past the finish line
const LINE_STEPS = { side: 3, diagonal: 2 }; // half-width of a start/finish line in half-metre lattice steps
const CANDIDATES = 24; // placements drawn per element and type
const BRANCH = 3; // best placements explored per element and type before backtracking
const TYPE_TRIES = 3; // types tried per element, in its seeded order of preference
const CONNECTOR_RADII = [1, 1.5]; // × the minimum turning radius
const BUDGET_BASE = 720; // evaluated placements per attempt…
const BUDGET_PER_ELEMENT = 360; // …plus this many per requested element
const ROUNDS = 3; // the budget is split into restarts so early choices get revisited
const EPS = 0.01; // touching a zone edge is fine, entering it by more is not

const LOCAL_DIRS = { '1,0': 0, '0,1': 2, '-1,0': 4, '0,-1': 6 };
const localDirIndex = ([a, b]) => LOCAL_DIRS[`${a},${b}`];

function innerRect(recipe) {
  return [SITE_MARGIN, SITE_MARGIN, recipe.width - SITE_MARGIN, recipe.length - SITE_MARGIN];
}

const inside = (r, p) => p[0] >= r[0] - 1e-9 && p[0] <= r[2] + 1e-9 && p[1] >= r[1] - 1e-9 && p[1] <= r[3] + 1e-9;

/** Does the template's core (cones + trajectory) fit the inner site in any orientation? */
export function templateFits(tpl, inner) {
  const w = inner[2] - inner[0];
  const h = inner[3] - inner[1];
  const la = (tpl.core[2] - tpl.core[0]) * tpl.unit;
  const lb = (tpl.core[3] - tpl.core[1]) * tpl.unit;
  if (tpl.diagonal) {
    const e = (la + lb) * Math.SQRT1_2;
    return e <= w && e <= h;
  }
  return (la <= w && lb <= h) || (lb <= w && la <= h);
}

function templateFor(plan, diagonal, mirrored) {
  const key = `${diagonal ? 1 : 0}${mirrored ? 1 : 0}`;
  if (!(key in plan.templates)) {
    const params = diagonal ? plan.params.diagonal : plan.params.side;
    plan.templates[key] = params ? instantiate(plan.type, params, diagonal, mirrored) : null;
  }
  return plan.templates[key];
}

/** Places a local template: axis 0..7, anchor on whole metres. */
function placeTemplate(tpl, axis, ax, ay) {
  const [dx, dy] = AXIS_STEPS[axis];
  const px = -dy;
  const py = dx;
  const toM = (a, b) => [(2 * ax + a * dx + b * px) / 2, (2 * ay + a * dy + b * py) / 2];
  const z = tpl.zone;
  const zone = {
    c: toM((z[0] + z[2]) / 2, (z[1] + z[3]) / 2),
    u: axisVector(axis),
    v: axisVector(axis + 2),
    hu: ((z[2] - z[0]) / 2) * tpl.unit,
    hv: ((z[3] - z[1]) / 2) * tpl.unit,
  };
  const k = tpl.core;
  const core = [toM(k[0], k[1]), toM(k[2], k[1]), toM(k[2], k[3]), toM(k[0], k[3])];
  const entryDir = (localDirIndex(tpl.entryDir) + axis) % 8;
  const exitDir = (localDirIndex(tpl.exitDir) + axis) % 8;
  const entry = toM(...tpl.path[0]);
  const exit = toM(...tpl.path[tpl.path.length - 1]);
  return {
    tpl, axis, ax, ay, zone, zoneBounds: obbBounds(zone), core, entry, exit, entryDir, exitDir,
    center: zone.c,
    world: () => ({
      cones: tpl.cones.map((c) => ({ hx: 2 * ax + c.a * dx + c.b * px, hy: 2 * ay + c.a * dy + c.b * py, height: c.height })),
      path: tpl.path.map(([a, b]) => toM(a, b)),
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
function closingLeg(fromPose, startT, radius, inner, zones) {
  const u = axisVector(startT.dir);
  const approach = [startT.center[0] - u[0] * radius, startT.center[1] - u[1] * radius];
  const last = [approach, startT.center];
  if (!inside(inner, approach) || !pathClear(last, pointsBounds(last), zones)) return null;
  const leg = connect(fromPose, pose(approach, startT.dir), radius, inner, zones);
  if (!leg) return null;
  const points = [...leg.points, startT.center];
  return { ...leg, points, bounds: pointsBounds(points), length: leg.length + radius };
}

function pathClear(points, bounds, zones) {
  for (const z of zones) {
    if (!boundsOverlap(bounds, z.zoneBounds)) continue;
    if (polylineHitsObb(points, z.zone, EPS)) return false;
  }
  return true;
}

function zoneClear(candidate, zones, paths) {
  for (const z of zones) {
    if (boundsOverlap(candidate.zoneBounds, z.zoneBounds) && obbOverlap(candidate.zone, z.zone)) return false;
  }
  for (const p of paths) {
    if (boundsOverlap(candidate.zoneBounds, p.bounds) && polylineHitsObb(p.points, candidate.zone, EPS)) return false;
  }
  return true;
}

/**
 * Shortest Dubins connector that stays inside the site and out of every zone.
 * Tried at the minimum turning radius first, then at a wider one, which gives
 * differently shaped detours around nearby zones.
 */
function connect(fromPose, toPose, radius, inner, zones) {
  for (const rho of CONNECTOR_RADII.map((k) => k * radius)) {
    for (const path of dubinsPaths(fromPose, toPose, rho)) {
      if (!path.points.every((p) => inside(inner, p))) continue;
      const bounds = pointsBounds(path.points);
      if (!pathClear(path.points, bounds, zones)) continue;
      return { points: path.points, bounds, length: path.length, turnLeft: path.turnLeft, turnRight: path.turnRight };
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
  return { points, bounds: pointsBounds(points), length: polylineLength(points), turnLeft: 0, turnRight: 0 };
}

/** Allowed types that fit the site at their most compact sizes, in canonical order. */
export function feasibleTypes(recipe) {
  const inner = innerRect(recipe);
  return recipe.types.filter((type) => {
    const p = minimalParams(type, recipe.difficulty);
    return [p.side && instantiate(type, p.side, false, false), p.diagonal && instantiate(type, p.diagonal, true, false)]
      .some((tpl) => tpl && templateFits(tpl, inner));
  });
}

/** Seeded order of preference over the feasible types, one list per element. */
function typePreferences(seed, feasible, n) {
  const rng = createStream(seed, 'types');
  const out = [];
  for (let i = 0; i < n; i++) {
    const pool = [...feasible];
    const order = [];
    while (pool.length) order.push(pool.splice(Math.floor(rng.float() * pool.length), 1)[0]);
    out.push(order);
  }
  return out;
}

/** Sizes of element i when it is of `type`: drawn from its own stream, compacted if they do not fit. */
function makePlan(recipe, seed, i, type, inner) {
  const plan = { type, params: chooseParams(type, recipe.difficulty, createStream(seed, `params:${i}:${type}`)), templates: {} };
  const fitsAxis = (axis) => {
    const tpl = templateFor(plan, axis % 2 === 1, false);
    return tpl && templateFits(tpl, inner);
  };
  if (![0, 1].some(fitsAxis)) {
    plan.params = minimalParams(type, recipe.difficulty);
    plan.templates = {};
  }
  plan.axes = [0, 1, 2, 3, 4, 5, 6, 7].filter(fitsAxis);
  return plan;
}

class BudgetExhausted extends Error {}

/**
 * @returns {{ok: true, course: object} | {ok: false}}
 */
export function buildCourse(recipe, seed, n) {
  const inner = innerRect(recipe);
  const site = [0, 0, recipe.width, recipe.length];
  const feasible = feasibleTypes(recipe);
  if (!feasible.length) return { ok: false };
  const preferences = typePreferences(seed, feasible, n);
  const plans = new Map();
  const planFor = (i, type) => {
    const key = `${i}:${type}`;
    if (!plans.has(key)) plans.set(key, makePlan(recipe, seed, i, type, inner));
    return plans.get(key);
  };
  const targets = layoutTargets(inner, n, recipe.closed, createStream(seed, 'layout'));
  const place = createStream(seed, 'place');
  const radius = DIFFICULTY_TABLE[recipe.difficulty].turnRadius;
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
    const plan = planFor(i, type);
    const target = targets[i];
    const out = [];
    for (let c = 0; c < CANDIDATES; c++) {
      if (++spent > roundEnd) throw new BudgetExhausted();
      const axis = place.pick(plan.axes);
      const mirrored = place.int(0, 1) === 1;
      const reach = (0.03 + (0.3 * c) / CANDIDATES) * diagonal;
      const jx = place.range(-reach, reach);
      const jy = place.range(-reach, reach);
      const tpl = templateFor(plan, axis % 2 === 1, mirrored);
      const origin = placeTemplate(tpl, axis, 0, 0);
      // Slide the anchor (whole metres) so the core stays inside the site.
      const [x0, y0, x1, y1] = pointsBounds(origin.core);
      const ax = clampInt(Math.round(target[0] + jx - origin.center[0]), inner[0] - x0, inner[2] - x1);
      const ay = clampInt(Math.round(target[1] + jy - origin.center[1]), inner[1] - y0, inner[3] - y1);
      if (ax === null || ay === null) continue;
      const cand = placeTemplate(tpl, axis, ax, ay);
      const result = evaluate(i, cand);
      if (result) out.push({ ...result, cand, order: c });
    }
    out.sort((a, b) => b.score - a.score || a.order - b.order);
    return out.slice(0, BRANCH);
  }

  function evaluate(i, cand) {
    if (!cand.core.every((p) => inside(inner, p))) return null;
    const paths = [...legs];
    if (!zoneClear(cand, zones, paths)) return null;
    let entryLeg;
    let terminal = null;
    if (i === 0) {
      terminal = startTerminal(cand, recipe.closed);
      if (!terminalInside(terminal, inner, site)) return null;
      if (recipe.closed) {
        // Room behind the line for the closing connector to line up.
        const u = axisVector(terminal.dir);
        if (!inside(inner, [terminal.center[0] - u[0] * radius, terminal.center[1] - u[1] * radius])) return null;
      }
      if (!zoneClear(terminal, zones, paths)) return null;
      if (obbOverlap(terminal.zone, cand.zone)) return null;
      entryLeg = straightLeg(terminal.center, cand.entry);
    } else {
      const prev = placed[i - 1];
      entryLeg = connect(pose(prev.exit, prev.exitDir), pose(cand.entry, cand.entryDir), radius, inner, [...zones, cand]);
      if (!entryLeg) return null;
    }
    let exitLeg = null;
    let finishTerminalCand = null;
    if (i === n - 1) {
      const startT = terminal || start;
      if (recipe.closed) {
        // The start zone is an obstacle too, so the closing connector cannot cut
        // across the start's own lead-in; it arrives on the zone edge at the line.
        const obstacles = i === 0 ? [cand, startT] : [...zones, cand];
        exitLeg = closingLeg(pose(cand.exit, cand.exitDir), startT, radius, inner, obstacles);
        if (!exitLeg) return null;
      } else {
        finishTerminalCand = finishTerminal(cand);
        if (!terminalInside(finishTerminalCand, inner, site)) return null;
        const others = i === 0 ? [startT] : [...zones];
        if (!zoneClear(finishTerminalCand, others, [...paths, entryLeg])) return null;
        if (obbOverlap(finishTerminalCand.zone, cand.zone)) return null;
        exitLeg = straightLeg(cand.exit, finishTerminalCand.center);
      }
    }
    const tl = turnLeft + entryLeg.turnLeft + cand.tpl.turnLeft + (exitLeg ? exitLeg.turnLeft : 0);
    const tr = turnRight + entryLeg.turnRight + cand.tpl.turnRight + (exitLeg ? exitLeg.turnRight : 0);
    const score = scorePlacement({
      center: cand.center,
      target: targets[i],
      others: placed.map((p) => p.center),
      connectorLength: entryLeg.length + (exitLeg ? exitLeg.length : 0),
      turnLeft: tl,
      turnRight: tr,
      diagonal,
    });
    return { score, entryLeg, exitLeg, terminal, finishTerminal: finishTerminalCand };
  }

  function search(i) {
    if (i === n) return true;
    const prev = i > 0 ? placed[i - 1].tpl.type : null;
    // Two identical types in a row only when the user allowed a single type.
    const types = preferences[i].filter((t) => recipe.types.length === 1 || t !== prev).slice(0, TYPE_TRIES);
    for (const type of types) {
      for (const option of candidates(i, type)) {
        const { cand, entryLeg, exitLeg, terminal, finishTerminal: fin } = option;
        const saved = { turnLeft, turnRight, start, finish, zones: zones.length, legs: legs.length };
        if (terminal) {
          start = terminal;
          zones.push(terminal);
        }
        placed.push(cand);
        zones.push(cand);
        legs.push(entryLeg);
        if (exitLeg) legs.push(exitLeg);
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
  placed.forEach((p, i) => {
    const id = `e${i + 1}`;
    const world = p.world();
    const ids = world.cones.map((c) => addCone(c.hx, c.hy, c.height));
    for (const pass of p.tpl.passes) {
      const base = { id: `p${passes.length + 1}`, element: id };
      if (pass.kind === 'gate') {
        passes.push({ ...base, kind: 'gate', left: ids[pass.left], right: ids[pass.right] });
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
    });
  });
  const finishOut = recipe.closed ? startOut : terminalOut(finish);
  const routeLegs = [];
  legs.forEach((leg, i) => {
    const from = i === 0 ? 'start' : elements[i - 1].id;
    const to = i < elements.length ? elements[i].id : 'finish';
    routeLegs.push({ kind: 'connector', from, to, path: leg.points.map(rp) });
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
    route: { closed: recipe.closed, start: startOut, finish: finishOut, legs: routeLegs },
  };
}
