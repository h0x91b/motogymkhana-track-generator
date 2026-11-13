// A course laid out by hand: the editor's model and the router that turns it
// back into a course (SPEC «Правка трассы»).
//
// A layout lists the elements of a course in route order — type, nominal
// sizes, axis, mirroring and the anchor on whole metres — with the recipe it
// came from. `routeLayout` puts every element exactly where the layout says
// and runs the start, the connectors and the finish between them by the
// generator's own rules. Where a rule cannot be kept the course is still
// built, with a problem that says which rule and where: an editor has to show
// an element where the user put it, not refuse to.
//
// Everything here is a pure function of the layout, so undo, redo and storage
// keep layouts and nothing else.

import { BIKE_TURN_RADIUS, diagonalAxis, editAxes, elementParams, elementSizes, freeHeading, instantiate, WAYPOINT, mirrorType, runOffFor, RUN_OFF_TYPES, SIZE_SPECS, sizeControls, TYPE_NAMES, typeAxes, typicalSizes } from './catalog.js';
import { dubinsPaths } from './dubins.js';
import {
  areaClear, assemble, barrierOf, boxEntries, boxFinish, CHAIN_ANGLE, chainLeg, closingLeg, closingTarget, CLOSING_TURN_LIMITS, coneInKeepOut, conesClear, connect, CONNECTOR_RADII, elementMargins, emptyTrack, extendTrack, finishTerminal, freeHeadings, homeBox, innerRect, inside,
  finishAt, isFree, lineOnAsphalt, MAX_CONNECTOR_TURN, onAsphalt, pathClear, placeTemplate, pose, provisional, quadOnAsphalt, ridden, START_LEAD_IN, startAt, startTerminal, straightLeg, terminalInside, trainClear, uTurnCones, zoneClear,
} from './generate.js';
import { axisVector, dirAngle, obbOverlap, pointsBounds, polylineHitsShape, polylineLength, segmentDistance2, shapesOverlap, shiftShape, wrapPi } from './geometry.js';
import {
  BLOCKED_KINDS, BLOCKED_MARGIN, BLOCKED_MAX, BLOCKED_NAMES, ELEMENT_SAFETY_KEYS, ELEMENT_TYPES, ELEMENTS_MAX, parseRecipe, parseSafetyValue, SAFETY_OPTIONS, safetyOf,
} from './recipe.js';

export { ELEMENTS_MAX };

// ---------------------------------------------------------------- placing

const templates = new Map();

/** The catalog template of an element; elements of one kind share it, however often the layout is routed. */
function template(type, params, diagonal, mirrored, margins) {
  const key = `${type}|${diagonal ? 1 : 0}${mirrored ? 1 : 0}|${SIZE_SPECS[type].map((s) => params[s.key]).join(',')}|${margins.pad},${margins.runOff}`;
  if (!templates.has(key)) {
    if (templates.size > 400) templates.clear();
    templates.set(key, instantiate(type, params, diagonal, mirrored, margins));
  }
  return templates.get(key);
}

/**
 * Margins element `el` sets for itself over the recipe's, or null: only the
 * ones its type has (no run-off on a type without a turn).
 */
function ownMargins(el) {
  if (!el.safety) return null;
  const own = {};
  for (const key of ELEMENT_SAFETY_KEYS) {
    if (el.safety[key] === undefined || (key === 'runOff' && !RUN_OFF_TYPES[el.type])) continue;
    own[key] = el.safety[key];
  }
  return Object.keys(own).length ? own : null;
}

function place(el, recipe) {
  const diagonal = diagonalAxis(el.type, el.axis);
  const own = ownMargins(el);
  const margins = { ...elementMargins(recipe, el.type), ...own };
  const p = placeTemplate(template(el.type, elementParams(el.type, el.sizes, diagonal, recipe.bike), diagonal, el.mirrored, margins), el.axis, el.x, el.y);
  return own ? { ...p, override: own } : p;
}

/** The layout of a course: what `routeLayout` needs to build it again. */
export function layoutOf(course) {
  const byId = new Map(course.cones.map((c) => [c.id, c]));
  return {
    recipe: course.recipe,
    seed: course.seed,
    elements: course.elements.map((e) => {
      const anchor = e.anchor ? byId.get(e.anchor) : { hx: 2 * e.at.x, hy: 2 * e.at.y };
      return {
        type: e.type, sizes: elementSizes(e.type, e.params, diagonalAxis(e.type, e.axis)),
        // The route gives a free-heading element its heading (ADR 0027): the layout keeps the 45° step nearest, which any build can read.
        axis: freeHeading(e.type) ? Math.round(e.axis) % 8 : e.axis,
        mirrored: e.mirrored, x: anchor.hx / 2, y: anchor.hy / 2,
        ...(e.safety ? { safety: { ...e.safety } } : {}),
      };
    }),
  };
}

/**
 * A layout read back from storage, or null when it is not one this build can
 * route: an unknown type, a size that is not a number, an axis the type cannot
 * be turned to (`editAxes`).
 */
export function parseLayout(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.elements)) return null;
  const recipe = parseRecipe(raw.recipe);
  if (!recipe.ok || !Number.isInteger(raw.seed)) return null;
  if (raw.elements.length < 1 || raw.elements.length > ELEMENTS_MAX) return null;
  const elements = [];
  for (const e of raw.elements) {
    if (!e || !(ELEMENT_TYPES.includes(e.type) || e.type === WAYPOINT) || !editAxes(e.type).includes(e.axis)) return null;
    if (!Number.isInteger(e.x) || !Number.isInteger(e.y) || typeof e.mirrored !== 'boolean') return null;
    if (!e.sizes || !SIZE_SPECS[e.type].every((s) => Number.isFinite(e.sizes[s.key]))) return null;
    const sizes = Object.fromEntries(SIZE_SPECS[e.type].map((s) => [s.key, e.sizes[s.key]]));
    const pivot = Array.isArray(e.pivot) && e.pivot.length === 2 && e.pivot.every(Number.isFinite) ? { pivot: [e.pivot[0], e.pivot[1]] } : {};
    let safety = {};
    if (e.safety !== undefined) {
      if (!e.safety || typeof e.safety !== 'object' || Object.keys(e.safety).some((k) => !ELEMENT_SAFETY_KEYS.includes(k))) return null;
      const own = {};
      for (const key of ELEMENT_SAFETY_KEYS) {
        if (e.safety[key] === undefined) continue;
        if (typeof e.safety[key] !== 'number') return null;
        const value = parseSafetyValue(SAFETY_OPTIONS.find((o) => o.key === key), e.safety[key]);
        if (value === null) return null;
        own[key] = value;
      }
      if (Object.keys(own).length) safety = { safety: own };
    }
    elements.push({ type: e.type, sizes, axis: e.axis, mirrored: e.mirrored, x: e.x, y: e.y, ...pivot, ...safety });
  }
  const out = { recipe: recipe.recipe, seed: raw.seed, elements };
  // A start or finish put by hand; without one it follows the first or the last element.
  for (const which of TERMINALS) {
    if (raw[which] === undefined) continue;
    const pose = parsePose(raw[which]);
    if (!pose) return null;
    if (which === 'start' || recipe.recipe.shape === 'open') out[which] = pose;
  }
  return out;
}

/** The two ends of a route that «Правка» moves like elements. A closed or `return` course has only the start: its finish is the same line. */
export const TERMINALS = ['start', 'finish'];
/** Axes a start or finish can be turned to: 22.5° steps, as an element off the lattice (ADR 0019). */
export const TERMINAL_AXES = Array.from({ length: 16 }, (_, k) => k / 2);

function parsePose(t) {
  if (!t || typeof t !== 'object' || !Number.isInteger(t.x) || !Number.isInteger(t.y) || !TERMINAL_AXES.includes(t.axis)) return null;
  const pivot = Array.isArray(t.pivot) && t.pivot.length === 2 && t.pivot.every(Number.isFinite) ? { pivot: [t.pivot[0], t.pivot[1]] } : {};
  return { x: t.x, y: t.y, axis: t.axis, ...pivot };
}

/** The terminals a layout of this shape has: the start, and for an open course its own finish. */
export const terminalsOf = (layout) => (layout.recipe.shape === 'open' ? TERMINALS : ['start']);

/** The start or finish line as the generator puts it: before the first element, past the last. */
function derivedTerminal(layout, which, placed = null) {
  const { recipe } = layout;
  const end = which === 'start' ? layout.elements[0] : layout.elements.at(-1);
  if (!placed && freeHeading(end.type)) {
    // Its heading follows from the route, so the line is where the routed course has it.
    const { course } = routeLayout({ ...layout, [which]: undefined });
    const t = course.route[which];
    const first = course.cones.find((c) => c.id === t.cones[0]);
    return { cones: [[first.hx / 2, first.hy / 2]], dir: t.dir };
  }
  if (which === 'start') return startTerminal(placed?.[0] ?? place(layout.elements[0], recipe), recipe.shape);
  return finishTerminal(placed?.[placed.length - 1] ?? place(layout.elements.at(-1), recipe));
}

/** Is the terminal `t` built where the pose says: its first cone, and crossed along its axis? */
const samePose = (p, t) => Math.abs(t.cones[0][0] - p.x) < 1e-9 && Math.abs(t.cones[0][1] - p.y) < 1e-9 && t.dir === p.axis;

/** The start or finish line where a pose puts it. */
const terminalAt = (which, p, shape) => (which === 'start' ? startAt([p.x, p.y], p.axis, shape) : finishAt([p.x, p.y], p.axis));

/**
 * The pose of the start or finish: the one put by hand, or the one the
 * generator gives it — its first cone, on whole metres, and the axis it is
 * crossed along — and whether it was put by hand.
 */
export function terminalPose(layout, which) {
  if (layout[which]) return { ...layout[which], pinned: true };
  const t = derivedTerminal(layout, which);
  return { x: t.cones[0][0], y: t.cones[0][1], axis: t.dir, pinned: false };
}

// ---------------------------------------------------------------- routing

/** Do a and b take the same asphalt: their footprints overlap, or a run-in or run-out of one goes through the other's barrier (ADR 0028)? */
const clash = (a, b) => shapesOverlap(a.footprint, b.footprint)
  || (a.ends ?? []).some((e) => polylineHitsShape(e.points, e.bounds, barrierOf(b)))
  || (b.ends ?? []).some((e) => polylineHitsShape(e.points, e.bounds, barrierOf(a)));
/** Is b (its footprint) in a's run-off zone? */
const inRunOff = (a, b) => Boolean(a.runOff) && shapesOverlap(a.runOff, b.footprint);

/**
 * The least bad Dubins connector when none keeps every rule: it stays on the
 * site if any does, then out of zones, then loop-free. Returns the leg and
 * what is wrong with it, worst first.
 */
function looseConnector(from, to, radius, inner, zones, paths, maxTurn, accept, tail = [], coneGap = undefined) {
  let best = null;
  for (const rho of CONNECTOR_RADII.map((k) => k * radius)) {
    for (const path of dubinsPaths(from, to, rho)) {
      const points = [...path.points, ...tail];
      const bounds = pointsBounds(points);
      const cones = uTurnCones(path.arcs, coneGap);
      const faults = [];
      if (!lineOnAsphalt(inner, points, bounds)) faults.push({ code: 'connector-off-site', weight: 16 });
      const hit = zones.filter((z) => !pathClear(points, bounds, [z]));
      if (hit.length) faults.push({ code: 'connector-zone', weight: 8, hit });
      if (path.turnLeft + path.turnRight > maxTurn) faults.push({ code: 'connector-loop', weight: 4 });
      if (cones.length && !conesClear(cones, inner, zones, [...paths, { points, bounds }])) faults.push({ code: 'connector-cone', weight: 2 });
      if (accept && !accept(points)) faults.push({ code: 'connector-train', weight: 1 });
      const weight = faults.reduce((sum, f) => sum + f.weight, 0);
      const length = path.length + polylineLength([path.points[path.points.length - 1], ...tail]);
      if (!best || weight < best.weight || (weight === best.weight && length < best.leg.length - 1e-9)) {
        best = { weight, faults, leg: { points, bounds, length, turnLeft: path.turnLeft, turnRight: path.turnRight, cones } };
      }
    }
  }
  return best;
}

/**
 * A straight leg from `a` (heading `aDir`) to `b` (entered along `bDir`) when
 * it continues both within CHAIN_ANGLE, as the generator joins a start line to
 * its first element: on the asphalt and through none of `zones`. Else null.
 */
function straightOn(a, aDir, b, bDir, inner, zones) {
  const bearing = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const limit = (CHAIN_ANGLE * Math.PI) / 180 + 1e-9;
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) return null;
  if (Math.abs(wrapPi(bearing - dirAngle(aDir))) > limit || Math.abs(wrapPi(bearing - dirAngle(bDir))) > limit) return null;
  const leg = straightLeg(a, b);
  return lineOnAsphalt(inner, leg.points, leg.bounds) && pathClear(leg.points, leg.bounds, zones) ? leg : null;
}

const fmt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

/**
 * The first blocked area an element's core comes within the margin of, or,
 * given, that its run-off zone (a shape) enters: its name, «вырез 1» or
 * «препятствие 2» numbered in the recipe's list, and the margin it keeps.
 */
function blockedHit(inner, core, runOff = null) {
  const only = (b) => Object.assign([inner[0], inner[1], inner[2], inner[3]], { blocked: [b] });
  const k = Math.max(0, inner.blocked.findIndex((b) => (runOff ? !areaClear(only(b), runOff) : !quadOnAsphalt(only(b), core))));
  return { name: `${BLOCKED_NAMES[inner.blocked[k].kind]} ${k + 1}`, margin: inner.blocked[k].m };
}

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);

/**
 * The course of a layout, and what is wrong with it. Every element stands
 * where the layout puts it; the start, the connectors, their U-turn cones and
 * the finish follow from the elements as in a generated course. A layout taken
 * from a generated course gives that course back with no problems.
 *
 * A problem is `{code, text, elements, connector}`: the ids of the elements it
 * is about and the number of the connector (0 = from the start), each possibly
 * absent. The text says what to do about it.
 *
 * @returns {{course: object, problems: object[]}}
 */
export function routeLayout(layout) {
  const { recipe } = layout;
  const { shape } = recipe;
  const closed = shape === 'closed';
  const inner = innerRect(recipe);
  const site = [0, 0, recipe.width, recipe.length];
  const radius = BIKE_TURN_RADIUS[recipe.bike];
  const { coneGap, trainGap, edge } = safetyOf(recipe);
  const placed = layout.elements.map((el) => place(el, recipe));
  const n = placed.length;
  const id = (i) => `e${i + 1}`;
  // Problems come out in a fixed order — the elements, the start and finish,
  // the route — though the route is laid first: the heading of a free element
  // (ADR 0027) is chosen with its connectors, and the elements are checked as
  // they then stand.
  const placing = [];
  const lines = [];
  const routing = [];
  let sink = routing;
  const report = (code, text, where = {}) => sink.push({ code, text, elements: [], connector: null, ...where });

  // A free element faces away from the one before until its connectors give it a heading.
  const free = placed.map(isFree);
  for (let j = 1; j < n; j++) if (free[j]) placed[j] = provisional(placed[j], placed[j - 1]);

  // Start and finish lines follow from the first and the last element.
  // A start or finish put by hand stands where it was put; the problems then say to move it, not the element.
  // A pose that is where the generator would put the line anyway changes nothing.
  const pinnedTerminal = (which) => {
    if (!layout[which] || (which === 'finish' && shape !== 'open')) return null;
    const derived = derivedTerminal(layout, which, placed);
    return samePose(layout[which], derived) ? null : terminalAt(which, layout[which], shape);
  };
  let pinnedStart = free[0] ? null : pinnedTerminal('start');
  let start = free[0] ? null : pinnedStart ?? startTerminal(placed[0], shape);
  let pinnedFinish = shape === 'open' && !free[n - 1] ? pinnedTerminal('finish') : null;
  // A finish by the start is found last, once the way to it is known.
  let finish = shape === 'open' && !free[n - 1] ? pinnedFinish ?? finishTerminal(placed[n - 1]) : null;

  // Everything a connector into element i keeps out of: the lines, the
  // elements but the free ones past it, whose headings are still to come,
  // then the U-turn cones as they appear.
  const cones = [];
  const standing = (i) => placed.filter((p, j) => !free[j] || j <= i);
  const zonesAt = (i) => [...(start ? [start] : []), ...standing(i), ...(finish ? [finish] : []), ...cones];
  const zoneName = (z) => {
    if (z === start || (start?.inBox && z === start.inBox)) return shape === 'return' ? 'коробку старта' : 'зону старта';
    if (z === finish) return 'зону финиша';
    const i = placed.indexOf(z);
    return i >= 0 ? `элемент ${i + 1}` : 'место у конуса разворота другой связки';
  };
  const legs = [];
  // The route a U-turn cone keeps clear of: the legs, and every element's run-in and run-out.
  const routeAt = (i) => [...legs, ...standing(i).flatMap((p) => p.ends)];
  /** A connector by the generator's rules, or the least bad one with its problem. `name` is «3 → 4». */
  const connectorProblem = (fault, connector, name, ends) => {
    const texts = {
      'connector-off-site': `Связка ${name} выходит за площадку — отодвиньте элементы от края или поверните один из них`,
      'connector-zone': `Связка ${name} проходит через ${fault.hit ? fault.hit.map(zoneName).join(' и ') : ''} — освободите ей путь или поверните один из элементов`,
      'connector-loop': `Связка ${name} закладывает петлю — раздвиньте элементы или поверните один из них входом к другому`,
      'connector-cone': coneGap > 0 ? `Конусу разворота на связке ${name} не хватает ${fmt(coneGap)} м свободного асфальта — раздвиньте элементы` : `Конус разворота на связке ${name} стоит в зоне — раздвиньте элементы`,
      'connector-train': `Связка ${name} пересекает маршрут: в паровозике мотоциклы встретятся — переставьте элементы`,
    };
    // The element a connector goes through is marked too, not only the two it joins.
    const through = (fault.hit ?? []).map((z) => placed.indexOf(z)).filter((i) => i >= 0).map(id);
    report(fault.code, texts[fault.code], { elements: [...ends, ...through.filter((e) => !ends.includes(e))], connector });
  };
  const trainOn = recipe.train && trainGap > 0;
  let track = trainOn ? emptyTrack(trainGap) : null;
  const leadOut = (t) => {
    const u = axisVector(t.dir);
    return pose([t.center[0] + u[0] * START_LEAD_IN, t.center[1] + u[1] * START_LEAD_IN], t.dir);
  };
  const lineUp = (t) => {
    const u = axisVector(t.dir);
    return pose([t.center[0] - u[0] * radius, t.center[1] - u[1] * radius], t.dir);
  };

  /**
   * The heading of free element k: the first of `freeHeadings` whose element,
   * connector in and — when what follows is fixed — connector out keep every
   * rule, as the generator chooses it, so a generated course routes back to
   * itself. When none does, the one that breaks the fewest of the three.
   */
  function resolve(k, pinStart, pinFinish) {
    const before = k > 0 ? placed[k - 1] : null;
    const last = k === n - 1;
    const next = last ? null : free[k + 1] ? provisional(placed[k + 1], placed[k]) : placed[k + 1];
    const from = before ? pose(before.exit, before.exitDir) : pinStart ? leadOut(start) : null;
    let to = null;
    if (next) to = pose(next.entry, next.entryDir);
    else if (shape === 'open') to = pinFinish ? lineUp(finish) : null;
    else if (k > 0 || pinStart) to = closingTarget(shape, start, radius);
    const others = (p) => [...(start && (k > 0 || pinStart) ? [start] : []), ...standing(k).filter((q) => q !== placed[k]), ...(finish && (!last || pinFinish) ? [finish] : []), ...cones].filter((z) => z !== p);
    let best = null;
    for (const p of freeHeadings(placed[k], from, to, radius)) {
      const faults = headingFaults(k, p, before, next, others(p), pinStart, pinFinish);
      if (faults === 0) return p;
      if (!best || faults < best.faults) best = { p, faults };
    }
    return best.p;
  }

  function headingFaults(k, p, before, next, zones, pinStart, pinFinish) {
    let faults = 0;
    const paths = [...legs, ...zones.filter((z) => placed.includes(z)).flatMap((q) => q.ends)];
    if (!quadOnAsphalt(inner, p.core) || (p.runOffPoly && !(p.runOffPoly.every((q) => inside(site, q)) && areaClear(inner, p.runOff))) || !zoneClear(p, zones, paths)) faults++;
    let first = null;
    let inLeg = null;
    if (k === 0 && !pinStart) {
      first = startTerminal(p, shape);
      const u = axisVector(first.dir);
      const ok = terminalInside(first, inner, site) && !shapesOverlap(first.footprint, p.footprint)
        && (!closed || onAsphalt(inner, [first.center[0] - u[0] * radius, first.center[1] - u[1] * radius]))
        && zones.every((q) => !placed.includes(q) || !(clash(first, q) || coneInKeepOut(first, q) || inRunOff(q, first)));
      inLeg = straightLeg(first.center, p.entry);
      if (!ok || (track && !trainClear(track, [inLeg.points, ridden(p)]))) faults++;
    } else if (k === 0) {
      inLeg = straightOn(start.center, start.dir, p.entry, p.entryDir, inner, zones.filter((z) => z !== start))
        || connect(leadOut(start), pose(p.entry, p.entryDir), radius, inner, [...zones, p], paths, MAX_CONNECTOR_TURN, null, coneGap);
      if (!inLeg) faults++;
    } else {
      const accept = track && ((pts) => trainClear(track, [pts, ridden(p)]));
      const chained = chainLeg(before, p);
      if (chained && accept && !accept(chained.points)) faults++;
      else {
        inLeg = chained || connect(pose(before.exit, before.exitDir), pose(p.entry, p.entryDir), radius, inner, [...zones, p], paths, MAX_CONNECTOR_TURN, accept, coneGap);
        if (!inLeg) faults++;
      }
    }
    if (!inLeg) return faults + 1;
    const after = [...(first ? [first] : []), ...zones, p, ...inLeg.cones];
    const out = [...paths, inLeg, ...p.ends];
    const ahead = track && extendTrack(track, [inLeg.points, ridden(p)]);
    const exit = pose(p.exit, p.exitDir);
    if (next && !free[k + 1]) {
      const accept = ahead && ((pts) => trainClear(ahead, [pts, ridden(next)]));
      const chained = chainLeg(p, next);
      const leg = chained && accept && !accept(chained.points) ? null : chained || connect(exit, pose(next.entry, next.entryDir), radius, inner, after, out, MAX_CONNECTOR_TURN, accept, coneGap);
      if (!leg) faults++;
    } else if (!next) {
      const startT = first ?? start;
      // Closing within MAX_CONNECTOR_TURN is what the generator tries first: a
      // heading that only closes with the looser limit is half a fault, so a
      // gentler one later in the order wins over it, as in the generator.
      const closes = (leg) => (leg(CLOSING_TURN_LIMITS[0]) ? 0 : CLOSING_TURN_LIMITS.slice(1).some(leg) ? 0.5 : 1);
      let ok = false;
      let closing = 0;
      if (closed) {
        const accept = ahead && ((pts) => trainClear(ahead, [pts], true));
        closing = closes((limit) => closingLeg(exit, startT, radius, inner, after, out, limit, accept, coneGap));
        ok = closing < 1;
      } else if (shape === 'return') {
        // The way back keeps clear of the route after the first element only.
        const accept = trainOn && ((pts) => trainClear(k === 0 ? emptyTrack(trainGap) : extendTrack(tail, [inLeg.points, ridden(p)]), [pts]));
        closing = closes((limit) => homeBox(exit, startT, radius, inner, after, out, limit, accept, coneGap));
        ok = closing < 1;
      } else if (pinFinish) {
        const rest = after.filter((z) => z !== finish);
        const straight = straightOn(p.exit, p.exitDir, finish.center, finish.dir, inner, rest.filter((z) => z !== p));
        closing = straight ? 0 : closes((limit) => closingLeg(exit, finish, radius, inner, rest, out, limit, null, coneGap));
        ok = closing < 1;
      } else {
        const line = finishTerminal(p);
        const rest = after.filter((z) => z !== p);
        const leg = straightLeg(p.exit, line.center);
        ok = terminalInside(line, inner, site) && zoneClear(line, rest, out) && !shapesOverlap(line.footprint, p.footprint)
          && pathClear(leg.points, leg.bounds, rest.filter((z) => z.side)) && (!ahead || trainClear(ahead, [leg.points]));
      }
      if (!ok) faults++;
      else faults += closing;
    }
    return faults;
  }

  // The first element's heading, then the start it gives.
  if (free[0]) {
    placed[0] = resolve(0, false, false);
    pinnedStart = pinnedTerminal('start');
    if (pinnedStart) {
      start = pinnedStart;
      placed[0] = resolve(0, true, false);
    } else start = startTerminal(placed[0], shape);
    if (n === 1 && shape === 'open') {
      pinnedFinish = pinnedTerminal('finish');
      if (pinnedFinish) {
        finish = pinnedFinish;
        placed[0] = resolve(0, !!pinnedStart, true);
      } else finish = finishTerminal(placed[0]);
    }
  }

  if (pinnedStart) {
    // From a start put by hand: straight on to the first element when it lies ahead, as the generator joins them;
    // else across the line and its lead-in, then a connector like any other.
    const leg = straightOn(start.center, start.dir, placed[0].entry, placed[0].entryDir, inner, zonesAt(0).filter((z) => z !== start && z !== placed[0]));
    if (leg) legs.push(leg);
    else {
      const from = leadOut(start);
      const to = pose(placed[0].entry, placed[0].entryDir);
      let lead = connect(from, to, radius, inner, zonesAt(0), routeAt(0), MAX_CONNECTOR_TURN, null, coneGap);
      if (!lead) {
        const loose = looseConnector(from, to, radius, inner, zonesAt(0), routeAt(0), MAX_CONNECTOR_TURN, null, [], coneGap);
        lead = loose.leg;
        connectorProblem(loose.faults[0], 0, 'старт → 1', [id(0)]);
      }
      const points = [start.center, ...lead.points];
      legs.push({ ...lead, points, bounds: pointsBounds(points), length: lead.length + START_LEAD_IN });
      cones.push(...lead.cones);
    }
  } else legs.push(straightLeg(start.center, placed[0].entry));
  const trainProblem = (i) => report('train', `Элемент ${i + 1} пересекает маршрут: в паровозике мотоциклы встретятся — отодвиньте его или замените`, { elements: [id(i)] });
  if (track) {
    if (!trainClear(track, [legs[0].points, ridden(placed[0])])) trainProblem(0);
    track = extendTrack(track, [legs[0].points, ridden(placed[0])]);
  }
  // The route after the first element: what the way back across the start line is checked against.
  let tail = track && emptyTrack(trainGap);

  for (let i = 1; i < n; i++) {
    if (free[i]) {
      const last = i === n - 1;
      placed[i] = resolve(i, false, false);
      if (last && shape === 'open') {
        pinnedFinish = pinnedTerminal('finish');
        if (pinnedFinish) {
          finish = pinnedFinish;
          placed[i] = resolve(i, false, true);
        } else finish = finishTerminal(placed[i]);
      }
    }
    const [prev, cur] = [placed[i - 1], placed[i]];
    const from = pose(prev.exit, prev.exitDir);
    const to = pose(cur.entry, cur.entryDir);
    const zones = zonesAt(i);
    const accept = track && ((pts) => trainClear(track, [pts, ridden(cur)]));
    // An entry that continues the exit is joined straight, as the generator does.
    const chained = chainLeg(prev, cur);
    let leg = chained && (!accept || accept(chained.points)) ? chained : connect(from, to, radius, inner, zones, routeAt(i), MAX_CONNECTOR_TURN, accept, coneGap);
    if (!leg && track) {
      // The rules hold but for «паровозик»: is it the connector that meets the route, or the element it leads into?
      leg = chained || connect(from, to, radius, inner, zones, routeAt(i), MAX_CONNECTOR_TURN, null, coneGap);
      if (leg && trainClear(track, [leg.points])) trainProblem(i);
      else if (leg) connectorProblem({ code: 'connector-train' }, i, `${i} → ${i + 1}`, [id(i - 1), id(i)]);
    }
    if (!leg) {
      const loose = looseConnector(from, to, radius, inner, zones, routeAt(i), MAX_CONNECTOR_TURN, track && ((pts) => trainClear(track, [pts])), [], coneGap);
      leg = loose.leg;
      connectorProblem(loose.faults[0], i, `${i} → ${i + 1}`, [id(i - 1), id(i)]);
    }
    legs.push(leg);
    cones.push(...leg.cones);
    if (track) track = extendTrack(track, [leg.points, ridden(cur)]);
    if (tail) tail = extendTrack(tail, [leg.points, ridden(cur)]);
  }

  const zones = zonesAt(n - 1);
  const route = routeAt(n - 1);
  const last = placed[n - 1];
  if (closed) {
    // Back to the start: lined up one turning radius before the line, then straight across it.
    const from = pose(last.exit, last.exitDir);
    const accept = track && ((pts) => trainClear(track, [pts], true));
    let leg = null;
    for (const limit of CLOSING_TURN_LIMITS) leg = leg || closingLeg(from, start, radius, inner, zones, route, limit, accept, coneGap);
    if (!leg) {
      const loose = looseConnector(from, lineUp(start), radius, inner, zones, route, CLOSING_TURN_LIMITS.at(-1), accept, [start.center], coneGap);
      leg = loose.leg;
      connectorProblem(loose.faults[0] ?? { code: 'connector-zone' }, n, `${n} → старт`, [id(n - 1), id(0)]);
    }
    legs.push(leg);
  } else if (shape === 'return') {
    // Back across the start line into the box, lined up like a closing connector.
    // In «паровозик» the whole column has ridden the start and the first
    // element long before the leader comes back, so the way back keeps clear
    // of the rest of the route only.
    const from = pose(last.exit, last.exitDir);
    const accept = tail && ((pts) => trainClear(tail, [pts]));
    let home = null;
    for (const limit of CLOSING_TURN_LIMITS) home = home || homeBox(from, start, radius, inner, zones, route, limit, accept, coneGap);
    if (!home) {
      // The least bad way back, square on unless an angle is less wrong.
      const obstacles = zones.map((z) => (z === start ? start.inBox : z));
      let best = null;
      for (const entry of boxEntries(start)) {
        const loose = looseConnector(from, pose(entry.approach, entry.dir), radius, inner, obstacles, route, CLOSING_TURN_LIMITS.at(-1), accept, [start.center], coneGap);
        if (!best || loose.weight < best.loose.weight) best = { loose, entry };
      }
      const { loose, entry } = best;
      const points = [...loose.leg.points, entry.stop];
      home = { dir: entry.dir, stop: entry.stop, leg: { ...loose.leg, points, bounds: pointsBounds(points) } };
      connectorProblem(loose.faults[0] ?? { code: 'connector-zone' }, n, `${n} → финиш`, [id(n - 1), id(0)]);
    }
    finish = boxFinish(start, home.dir, home.stop);
    legs.push(home.leg);
  } else if (pinnedFinish) {
    // To a finish put by hand: lined up one turning radius before it, like the closing connector of a closed course.
    const from = pose(last.exit, last.exitDir);
    const others = zones.filter((z) => z !== finish);
    let leg = straightOn(last.exit, last.exitDir, finish.center, finish.dir, inner, others.filter((z) => z !== last));
    for (const limit of CLOSING_TURN_LIMITS) leg = leg || closingLeg(from, finish, radius, inner, others, route, limit, null, coneGap);
    if (!leg) {
      const loose = looseConnector(from, lineUp(finish), radius, inner, others, route, CLOSING_TURN_LIMITS.at(-1), null, [finish.center], coneGap);
      leg = loose.leg;
      connectorProblem(loose.faults[0] ?? { code: 'connector-zone' }, n, `${n} → финиш`, [id(n - 1)]);
    }
    if (track && !trainClear(track, [leg.points])) connectorProblem({ code: 'connector-train' }, n, `${n} → финиш`, [id(n - 1)]);
    legs.push(leg);
  } else if (legs.length === n) {
    const leg = straightLeg(last.exit, finish.center);
    if (track && !trainClear(track, [leg.points])) connectorProblem({ code: 'connector-train' }, n, `${n} → финиш`, [id(n - 1)]);
    legs.push(leg);
  }

  // A connector laid before a free element had its heading does not go through it either.
  placed.forEach((p, j) => {
    if (!free[j]) return;
    for (let l = 0; l < j; l++) {
      if (!pathClear(legs[l].points, legs[l].bounds, [p])) {
        const name = l === 0 ? `старт → 1` : `${l} → ${l + 1}`;
        connectorProblem({ code: 'connector-zone', hit: [p] }, l, name, l === 0 ? [id(0)] : [id(l - 1), id(l)]);
      }
    }
  });

  // Each element on its own, then every pair, as they stand.
  sink = placing;
  placed.forEach((p, i) => {
    if (!p.core.every((q) => inside(inner, q))) {
      report('off-site', edge > 0 ? `Элемент ${i + 1} ближе ${fmt(edge)} м к краю площадки — отодвиньте его от края` : `Элемент ${i + 1} выходит за площадку — отодвиньте его от края`, { elements: [id(i)] });
    } else if (!quadOnAsphalt(inner, p.core)) {
      const hit = blockedHit(inner, p.core);
      report('blocked', hit.margin > 0
        ? `Элемент ${i + 1} заходит на ${hit.name} или стоит ближе ${fmt(hit.margin)} м к нему — отодвиньте элемент`
        : `Элемент ${i + 1} заходит на ${hit.name} — отодвиньте элемент`, { elements: [id(i)] });
    } else if (p.runOffPoly && !p.runOffPoly.every((q) => inside(site, q))) {
      report('run-off-site', `Зоне выката элемента ${i + 1} не хватает ${fmt(p.tpl.margins.runOff)} м асфальта у края площадки — отодвиньте его от края или уменьшите выкат`, { elements: [id(i)] });
    } else if (p.runOff && !areaClear(inner, p.runOff)) {
      report('run-off-blocked', `Зона выката элемента ${i + 1} заходит на ${blockedHit(inner, null, p.runOff).name}: вокруг разворота нужно ${fmt(p.tpl.margins.runOff)} м асфальта — отодвиньте элемент или уменьшите выкат`, { elements: [id(i)] });
    }
  });
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const [a, b] = [placed[i], placed[j]];
      if (clash(a, b)) {
        report('overlap', `Элементы ${i + 1} и ${j + 1} накладываются — раздвиньте их`, { elements: [id(i), id(j)] });
      } else if (coneInKeepOut(a, b)) {
        const [k, o] = a.keepOut && coneInKeepOut({ keepOut: a.keepOut }, b) ? [i, j] : [j, i];
        report('in-free-radius', `Конус элемента ${o + 1} стоит в свободном радиусе вращения (элемент ${k + 1}) — раздвиньте их или уменьшите радиус`, { elements: [id(i), id(j)] });
      } else if (inRunOff(a, b)) {
        report('in-run-off', `Элемент ${j + 1} стоит в зоне выката элемента ${i + 1}: вокруг разворота нужно ${fmt(a.tpl.margins.runOff)} м — раздвиньте их или уменьшите выкат`, { elements: [id(i), id(j)] });
      } else if (inRunOff(b, a)) {
        report('in-run-off', `Элемент ${i + 1} стоит в зоне выката элемента ${j + 1}: вокруг разворота нужно ${fmt(b.tpl.margins.runOff)} м — раздвиньте их или уменьшите выкат`, { elements: [id(i), id(j)] });
      }
    }
  }

  // A line may stand in the run-off zone of its own element, never of another one.
  sink = lines;
  const terminalProblems = (t, name, own, code, pinned) => {
    const lead = name === 'Старт' ? 'перед элементом 1' : `за элементом ${n}`;
    const which = name === 'Старт' ? 'старт' : 'финиш';
    if (!terminalInside(t, inner, site)) {
      report(`${code}-off-site`, pinned ? `${name} выходит за площадку или на вырез — отодвиньте его от края или поверните` : `${name} не помещается ${lead} — отодвиньте элемент от края площадки или поверните`, { elements: pinned ? [] : [id(own)] });
      return;
    }
    placed.forEach((p, i) => {
      const apart = pinned ? `отодвиньте ${which} или элемент ${i + 1}` : `раздвиньте элементы ${Math.min(own, i) + 1} и ${Math.max(own, i) + 1}`;
      if (clash(t, p)) {
        report(`${code}-overlap`, `${name} накладывается на элемент ${i + 1} — ${apart}`, { elements: pinned ? [id(i)] : [id(own), id(i)] });
      } else if (coneInKeepOut(t, p)) {
        report(`${code}-overlap`, `Конус ${which === 'старт' ? 'старта' : 'финиша'} стоит в свободном радиусе вращения (элемент ${i + 1}) — ${apart}`, { elements: pinned ? [id(i)] : [id(own), id(i)] });
      } else if (i !== own && inRunOff(p, t)) {
        report(`${code}-overlap`, `${name} стоит в зоне выката элемента ${i + 1} — ${apart}`, { elements: pinned ? [id(i)] : [id(own), id(i)] });
      }
    });
  };
  terminalProblems(start, 'Старт', 0, 'start', !!pinnedStart);
  if (shape === 'open') {
    terminalProblems(finish, 'Финиш', n - 1, 'finish', !!pinnedFinish);
    if (obbOverlap(finish.zone, start.zone)) {
      report('finish-overlap', pinnedStart || pinnedFinish ? 'Финиш накладывается на старт — отодвиньте одну из линий' : 'Финиш накладывается на старт — раздвиньте первый и последний элементы', { elements: [id(0), id(n - 1)] });
    }
  }

  const course = assemble(recipe, layout.seed, placed, legs, start, finish);
  return { course: { ...course, requested: n, placed: n, edited: true }, problems: [...placing, ...lines, ...routing] };
}

/** «3 проблемы» for a count of problems. */
export const problemsWord = (count) => `${count} ${plural(count, 'проблема', 'проблемы', 'проблем')}`;

// ---------------------------------------------------------------- editing

const withElement = (layout, i, el) => ({ ...layout, elements: layout.elements.map((e, k) => (k === i ? el : e)) });

/** v clamped to the integers in [lo, hi], or null when there are none. */
function clampInt(v, lo, hi) {
  const a = Math.ceil(lo - 1e-9);
  const b = Math.floor(hi + 1e-9);
  if (a > b) return null;
  return v < a ? a : v > b ? b : v;
}

/** How far the anchor may move along x and y with the element still on the site: `[[loX, hiX], [loY, hiY]]`, in metres from where it is. */
function slack(p, recipe, withRunOff) {
  const inner = innerRect(recipe);
  const [x0, y0, x1, y1] = pointsBounds(p.core);
  const range = [[inner[0] - x0, inner[2] - x1], [inner[1] - y0, inner[3] - y1]];
  if (withRunOff && p.runOff) {
    const [r0, s0, r1, s1] = p.runOffBounds;
    return [[Math.max(range[0][0], -r0), Math.min(range[0][1], recipe.width - r1)], [Math.max(range[1][0], -s0), Math.min(range[1][1], recipe.length - s1)]];
  }
  return range;
}

/**
 * The element slid the least so that it is inside the margin, with its run-off
 * zone on the site. Along a side it is too long for, it only keeps its cones on
 * the site if it can, and otherwise stays where it is.
 */
function fitted(el, recipe) {
  const p = place(el, recipe);
  const full = slack(p, recipe, true);
  const core = slack(p, recipe, false);
  const shift = [0, 1].map((k) => clampInt(0, ...full[k]) ?? clampInt(0, ...core[k]) ?? 0);
  return shift[0] || shift[1] ? { ...el, x: el.x + shift[0], y: el.y + shift[1] } : el;
}

/** The element with the centre of its zone as close to `centre` as an anchor on whole metres allows. */
function centred(el, centre, recipe) {
  const origin = place({ ...el, x: 0, y: 0 }, recipe);
  return { ...el, x: Math.round(centre[0] - origin.center[0]), y: Math.round(centre[1] - origin.center[1]) };
}

/** The element without the pivot it was turned about: whatever moves or resizes it starts afresh. */
const unpinned = ({ pivot, ...el }) => el;

/**
 * The element turned or mirrored (`change`) about the middle of its zone. An
 * anchor on whole metres cannot keep that middle exactly, so the element
 * remembers it as `pivot` for as long as it is only turned and mirrored: a
 * full turn then ends where it began instead of creeping across the site.
 */
function turned(layout, i, change) {
  const el = layout.elements[i];
  const { recipe } = layout;
  const pivot = el.pivot ?? place(el, recipe).center;
  return withElement(layout, i, fitted(centred({ ...el, ...change, pivot }, pivot, recipe), recipe));
}

/** Is `i` the start or the finish rather than an element's index? */
const isTerminal = (i) => i === 'start' || i === 'finish';

/** The layout with the start or finish put at `pose` by hand. */
const withTerminal = (layout, which, pose) => ({ ...layout, [which]: pose });

/**
 * The start or finish slid the least so that its cones are inside the margin
 * and its zone on the site, as an element is (`fitted`); where it cannot be,
 * it keeps its cones on the site if it can, and otherwise stays.
 */
function fittedTerminal(layout, which, p) {
  const { recipe } = layout;
  const inner = innerRect(recipe);
  const t = terminalAt(which, p, recipe.shape);
  const [x0, y0, x1, y1] = pointsBounds(t.cones);
  const [z0, w0, z1, w1] = t.zoneBounds;
  const cones = [[inner[0] - x0, inner[2] - x1], [inner[1] - y0, inner[3] - y1]];
  const full = [[Math.max(cones[0][0], -z0), Math.min(cones[0][1], recipe.width - z1)], [Math.max(cones[1][0], -w0), Math.min(cones[1][1], recipe.length - w1)]];
  const shift = [0, 1].map((k) => clampInt(0, ...full[k]) ?? clampInt(0, ...cones[k]) ?? 0);
  return shift[0] || shift[1] ? { ...p, x: p.x + shift[0], y: p.y + shift[1] } : p;
}

/** The start or finish turned to `axis` about the middle of its line, which it remembers as `pivot` like a turned element. */
function turnedTerminal(layout, which, axis) {
  const { recipe } = layout;
  const now = terminalPose(layout, which);
  const pivot = now.pivot ?? terminalAt(which, now, recipe.shape).center;
  const origin = terminalAt(which, { x: 0, y: 0, axis }, recipe.shape).center;
  const p = { x: Math.round(pivot[0] - origin[0]), y: Math.round(pivot[1] - origin[1]), axis, pivot };
  return withTerminal(layout, which, fittedTerminal(layout, which, p));
}

/**
 * Moves the anchor of element i to (x, y), whole metres, as far as the site
 * lets it. With i = 'start' or 'finish' it moves that line's first cone
 * instead, and the line stays where it is put from then on.
 */
export function moveElement(layout, i, x, y) {
  if (isTerminal(i)) {
    const { pivot, pinned, ...now } = terminalPose(layout, i);
    return withTerminal(layout, i, fittedTerminal(layout, i, { ...now, x: Math.round(x), y: Math.round(y) }));
  }
  return withElement(layout, i, fitted({ ...unpinned(layout.elements[i]), x: Math.round(x), y: Math.round(y) }, layout.recipe));
}

/**
 * Turns element i by one step of the axes it can be turned to in «Правка» —
 * 22.5°, or 45° for a side-only type (ADR 0019) — about the middle of its
 * zone. The start or finish ('start', 'finish') turns by 22.5° about the
 * middle of its line.
 */
export function rotateElement(layout, i, dir) {
  if (isTerminal(i)) {
    const { axis } = terminalPose(layout, i);
    const k = TERMINAL_AXES.indexOf(axis);
    return turnedTerminal(layout, i, TERMINAL_AXES[(k + dir + TERMINAL_AXES.length) % TERMINAL_AXES.length]);
  }
  const el = layout.elements[i];
  // The route turns a free-heading element itself (ADR 0027).
  if (freeHeading(el.type)) return layout;
  const axes = editAxes(el.type);
  return turned(layout, i, { axis: axes[(axes.indexOf(el.axis) + dir + axes.length) % axes.length] });
}

/** The angle of an axis in degrees, counter-clockwise from along the width (axis 0 points to +X). */
export const axisDegrees = (axis) => axis * 45;

/** The step in degrees an element of the type is turned by in «Правка»: 22.5°, or 45° for a side-only type. */
export const turnStep = (type) => 360 / editAxes(type).length;

/**
 * The axis an element of the type can be turned to nearest to `degrees` (any
 * number, wrapped to a full turn): there is nothing between them (ADR 0019).
 * Halfway between two the one nearer `current` wins, then the
 * counter-clockwise one. Null for something that is not a number.
 */
export const nearestAxis = (type, degrees, current = 0) => nearestOf(editAxes(type), degrees, current);

function nearestOf(axes, degrees, current) {
  if (!Number.isFinite(degrees)) return null;
  const off = (a, d) => Math.abs((((d - axisDegrees(a)) % 360) + 540) % 360 - 180);
  let best = null;
  for (const axis of axes) {
    const key = [off(axis, degrees), off(axis, axisDegrees(current)), -axis];
    if (!best || key[0] < best.key[0] - 1e-9 || (Math.abs(key[0] - best.key[0]) <= 1e-9 && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2])))) best = { axis, key };
  }
  return best.axis;
}

/** Turns element i (or the start or finish) to the axis nearest to `degrees` it can be turned to, about its middle like `rotateElement`. */
export function turnElementTo(layout, i, degrees) {
  if (isTerminal(i)) {
    const now = terminalPose(layout, i).axis;
    const axis = nearestOf(TERMINAL_AXES, degrees, now);
    return axis === null || axis === now ? layout : turnedTerminal(layout, i, axis);
  }
  const el = layout.elements[i];
  if (freeHeading(el.type)) return layout;
  const axis = nearestAxis(el.type, degrees, el.axis);
  return axis === null || axis === el.axis ? layout : turned(layout, i, { axis });
}

/** The start or finish back where the generator puts it: before the first element, past the last. */
export function resetTerminal(layout, which) {
  if (!layout[which]) return layout;
  const { [which]: _, ...rest } = layout;
  return rest;
}

/**
 * Mirrors element i across its axis: turns swap sides, and so do the colours
 * of its cones. A cone passed on one side becomes the one passed on the other
 * («Конус слева» ↔ «Конус справа»): there the side is the type.
 */
export function mirrorElement(layout, i) {
  const el = layout.elements[i];
  const other = mirrorType(el.type);
  return turned(layout, i, other !== el.type ? { type: other } : { mirrored: !el.mirrored });
}

/** Gives element i new nominal sizes (one of `sizeControls`' steps); its anchor stays. */
export function resizeElement(layout, i, sizes) {
  return withElement(layout, i, fitted({ ...unpinned(layout.elements[i]), sizes }, layout.recipe));
}

/**
 * Gives element i a typed size in metres under `key` (a length or a radius, as
 * the editor shows it): the nearest the type allows on its lattice, inside the
 * range, never below the bike-class minimum. Its anchor stays; a count, a
 * choice, an unknown key or a non-number leaves the layout as it was.
 */
export function setElementSize(layout, i, key, metres) {
  const el = layout.elements[i];
  const spec = SIZE_SPECS[el.type].find((s) => s.key === key);
  if (!spec || (spec.kind !== 'length' && spec.kind !== 'radius') || !Number.isFinite(metres)) return layout;
  const diagonal = el.axis % 2 === 1;
  const asked = { ...el.sizes, [key]: Math.round((metres / (spec.shown ?? 1)) * 2) / 2 };
  // Stored as the size the element is built with, so the layout never keeps a value it does not show.
  const sizes = elementSizes(el.type, elementParams(el.type, asked, diagonal, layout.recipe.bike), diagonal);
  return resizeElement(layout, i, sizes);
}

/**
 * Sets one of element i's own margins (`ELEMENT_SAFETY_KEYS`) to `value`
 * metres, or back to the recipe's with null; its anchor stays, slid only as
 * far as a wider run-off needs to stay on the site.
 */
export function setElementSafety(layout, i, key, value) {
  const el = layout.elements[i];
  const { [key]: _, ...rest } = el.safety ?? {};
  const own = value === null || value === undefined ? rest : { ...rest, [key]: value };
  const { safety: __, ...bare } = unpinned(el);
  return withElement(layout, i, fitted(Object.keys(own).length ? { ...bare, safety: own } : bare, layout.recipe));
}

/**
 * Element i's margins as the editor shows them: per key its value, whether
 * the element sets it itself, what the recipe gives its type (a single-cone
 * element half the run-off, ADR 0024) and the option it is one of.
 * Run-off only for a type with a turn.
 */
export function elementSafety(layout, i) {
  const el = layout.elements[i];
  const recipe = { ...safetyOf(layout.recipe) };
  recipe.runOff = runOffFor(el.type, recipe.runOff);
  return ELEMENT_SAFETY_KEYS.filter((key) => key !== 'runOff' || RUN_OFF_TYPES[el.type]).map((key) => {
    const option = SAFETY_OPTIONS.find((o) => o.key === key);
    const own = el.safety?.[key];
    return { key, name: option.name, value: own ?? recipe[key], own: own !== undefined, recipe: recipe[key], option };
  });
}

/** Typical sizes of a type for the layout's difficulty and bike class. */
function startingSizes(type, recipe) {
  return typicalSizes(type, recipe.difficulty, recipe.bike, recipe.sizes);
}

/** The axis on which the element is entered as close to `dir` (in 45° steps) as it can be turned to. */
function axisEnteredAlong(el, dir, recipe) {
  let best = el.axis;
  let off = Infinity;
  for (const axis of editAxes(el.type)) {
    const d = Math.abs(wrapPi(dirAngle(place({ ...el, axis, x: 0, y: 0 }, recipe).entryDir) - dirAngle(dir)));
    if (d < off - 1e-9) {
      off = d;
      best = axis;
    }
  }
  return best;
}

/** Replaces element i with one of another type at typical sizes, in the same place and entered the same way. */
export function replaceElement(layout, i, type) {
  const { recipe } = layout;
  const old = layout.elements[i];
  const was = place(old, recipe);
  const el = { type, sizes: startingSizes(type, recipe), axis: typeAxes(type)[0], mirrored: old.mirrored, x: 0, y: 0 };
  el.axis = axisEnteredAlong(el, was.entryDir, recipe);
  return withElement(layout, i, fitted(centred(el, was.center, recipe), recipe));
}

/** Removes element i; the last element of a course stays. */
export function removeElement(layout, i) {
  if (layout.elements.length <= 1) return layout;
  return { ...layout, elements: layout.elements.filter((_, k) => k !== i) };
}

/** Moves element i one place earlier (dir −1) or later (dir +1) in the route. */
export function shiftElement(layout, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= layout.elements.length) return layout;
  const elements = [...layout.elements];
  [elements[i], elements[j]] = [elements[j], elements[i]];
  return { ...layout, elements };
}

const AHEAD = 10; // a new last element is sought about this far past the one before it, metres
const TURN_COST = 3; // metres of detour a radian of turning into or out of the new element is worth
const SPOT_STEP = 2; // free places are sought on a grid this coarse, metres
const SPOT_TRIES = 40; // free places routed, best first, before settling for the least bad

/**
 * Puts a new element of `type` at place `at` of the route (0 = first), where
 * it is free: clear of every other element and run-off zone, near the way from
 * the element before to the element after, turned so the route runs through
 * it. Of such places it takes the first, in that order of preference, that
 * adds no problem to the layout. Without one it goes where it does the least
 * harm, and `routeLayout` says what it is in the way of.
 */
export function insertElement(layout, at, type) {
  const { recipe } = layout;
  if (layout.elements.length >= ELEMENTS_MAX) return layout;
  const others = layout.elements.map((e) => place(e, recipe));
  const prev = others[at - 1];
  const next = others[at];
  const along = (p, dir, d) => [p[0] + axisVector(dir)[0] * d, p[1] + axisVector(dir)[1] * d];
  const ideal = prev && next ? [(prev.exit[0] + next.entry[0]) / 2, (prev.exit[1] + next.entry[1]) / 2]
    : prev ? along(prev.exit, prev.exitDir, AHEAD)
      : next ? along(next.entry, next.entryDir, -AHEAD)
        : [recipe.width / 2, recipe.length / 2];
  if (type === WAYPOINT) return withWaypoint(layout, at, ideal[0], ideal[1]);
  const el = { type, sizes: startingSizes(type, recipe), axis: 0, mirrored: false, x: 0, y: 0 };
  const turn = (a, b) => Math.abs(wrapPi(a - b));
  const bearing = (from, to) => Math.atan2(to[1] - from[1], to[0] - from[0]);
  const inner = innerRect(recipe);
  const spots = [];
  for (const axis of typeAxes(type)) {
    const origin = place({ ...el, axis }, recipe);
    const range = slack(origin, recipe, true).map(([lo, hi]) => [Math.ceil(lo - 1e-9), Math.floor(hi + 1e-9)]);
    for (let x = range[0][0]; x <= range[0][1]; x += SPOT_STEP) {
      for (let y = range[1][0]; y <= range[1][1]; y += SPOT_STEP) {
        const at = {
          footprint: shiftShape(origin.footprint, x, y),
          barrier: shiftShape(origin.barrier, x, y),
          runOff: origin.runOff && shiftShape(origin.runOff, x, y),
          spots: origin.spots.map(([px, py]) => [px + x, py + y]),
          keepOut: origin.keepOut && { c: [origin.keepOut.c[0] + x, origin.keepOut.c[1] + y], r: origin.keepOut.r },
          ends: origin.ends.map((e) => ({ points: e.points.map(([px, py]) => [px + x, py + y]), bounds: [e.bounds[0] + x, e.bounds[1] + y, e.bounds[2] + x, e.bounds[3] + y] })),
        };
        const core = origin.core.map(([cx, cy]) => [cx + x, cy + y]);
        const free = quadOnAsphalt(inner, core) && (!at.runOff || areaClear(inner, at.runOff)) && others.every((o) => !clash(at, o) && !coneInKeepOut(at, o) && !inRunOff(o, at) && !inRunOff(at, o));
        const entry = [origin.entry[0] + x, origin.entry[1] + y];
        const exit = [origin.exit[0] + x, origin.exit[1] + y];
        const centre = [origin.center[0] + x, origin.center[1] + y];
        let cost = Math.sqrt((centre[0] - ideal[0]) * (centre[0] - ideal[0]) + (centre[1] - ideal[1]) * (centre[1] - ideal[1]));
        if (prev) cost += TURN_COST * (turn(bearing(prev.exit, entry), dirAngle(prev.exitDir)) + turn(dirAngle(origin.entryDir), bearing(prev.exit, entry)));
        if (next) cost += TURN_COST * (turn(bearing(exit, next.entry), dirAngle(origin.exitDir)) + turn(dirAngle(next.entryDir), bearing(exit, next.entry)));
        spots.push({ free, cost, axis, x, y, order: spots.length });
      }
    }
  }
  // Free places first, each kind best first; equal costs keep the order they were found in.
  spots.sort((a, b) => Number(b.free) - Number(a.free) || a.cost - b.cost || a.order - b.order);
  const withSpot = (spot) => {
    const elements = [...layout.elements];
    elements.splice(at, 0, { ...el, axis: spot.axis, x: spot.x, y: spot.y });
    return { ...layout, elements };
  };
  if (!spots.length) return withSpot(fitted(centred(el, ideal, recipe), recipe));
  const before = routeLayout(layout).problems.length;
  let best = null;
  for (const spot of spots.slice(0, SPOT_TRIES)) {
    const candidate = withSpot(spot);
    const count = routeLayout(candidate).problems.length;
    if (count <= before) return candidate;
    if (!best || count < best.count) best = { count, candidate };
  }
  return best.candidate;
}

/** The layout with a waypoint at (x, y), on whole metres inside the margin, put at index `at`. */
function withWaypoint(layout, at, x, y) {
  const [x0, y0, x1, y1] = innerRect(layout.recipe);
  const el = { type: WAYPOINT, sizes: {}, axis: 0, mirrored: false, x: clampTo(x, Math.ceil(x0), Math.floor(x1)), y: clampTo(y, Math.ceil(y0), Math.floor(y1)) };
  const elements = [...layout.elements];
  elements.splice(at, 0, el);
  return { ...layout, elements };
}

/**
 * Adds a waypoint where the user tapped the plan: at (x, y), in the list
 * between the two elements whose connector passes nearest the point, so the
 * route bends through it instead of jumping elsewhere first.
 */
export function insertWaypoint(layout, x, y) {
  if (layout.elements.length >= ELEMENTS_MAX) return layout;
  const { course } = routeLayout(layout);
  const index = new Map(course.elements.map((e, i) => [e.id, i]));
  const point = [x, y];
  let at = layout.elements.length;
  let best = Infinity;
  for (const leg of course.route.legs) {
    if (!leg.path) continue;
    for (let k = 1; k < leg.path.length; k++) {
      const d = segmentDistance2(leg.path[k - 1], leg.path[k], point, point);
      if (d < best) {
        best = d;
        at = index.get(leg.to) ?? layout.elements.length;
      }
    }
  }
  return withWaypoint(layout, at, x, y);
}

// ---------------------------------------------------------------- blocked areas

const withBlocked = (layout, blocked) => ({ ...layout, recipe: { ...layout.recipe, blocked } });
const clampTo = (v, lo, hi) => Math.min(Math.max(Math.round(v), lo), hi);

/** Blocked area k kept on the site: whole metres, at least 1 × 1 m, inside the lot's rectangle. */
function onSite(b, recipe) {
  const w = clampTo(b.w, 1, recipe.width);
  const h = clampTo(b.h, 1, recipe.length);
  const at = { kind: b.kind, x: clampTo(b.x, 0, recipe.width - w), y: clampTo(b.y, 0, recipe.length - h), w, h };
  return b.margin === undefined ? at : { ...at, margin: b.margin };
}

/** Default size of a new blocked area: a parked car, or a 6 × 6 m cutout. */
export const BLOCKED_DEFAULT = { obstacle: { w: 2, h: 5 }, cutout: { w: 6, h: 6 } };

/**
 * Adds a blocked area of `kind`: an obstacle in the middle of the lot, a cutout
 * at its lower left corner (cutouts are usually bites out of an edge). Its
 * number is its place in the list, so it is the last one.
 */
export function addBlocked(layout, kind) {
  const { recipe } = layout;
  if (!BLOCKED_KINDS.includes(kind) || recipe.blocked.length >= BLOCKED_MAX) return layout;
  const { w, h } = BLOCKED_DEFAULT[kind];
  const b = kind === 'cutout' ? { kind, x: 0, y: 0, w, h } : { kind, x: recipe.width / 2 - w / 2, y: recipe.length / 2 - h / 2, w, h };
  return withBlocked(layout, [...recipe.blocked, onSite(b, recipe)]);
}

/** Moves blocked area k so its corner nearest the reference corner is at (x, y), whole metres, on the site. */
export function moveBlocked(layout, k, x, y) {
  const { recipe } = layout;
  return withBlocked(layout, recipe.blocked.map((b, i) => (i === k ? onSite({ ...b, x, y }, recipe) : b)));
}

/** Gives blocked area k a new size along x and y, whole metres; its corner nearest the reference corner stays where the site lets it. */
export function resizeBlocked(layout, k, w, h) {
  const { recipe } = layout;
  return withBlocked(layout, recipe.blocked.map((b, i) => (i === k ? onSite({ ...b, w, h }, recipe) : b)));
}

/**
 * Drags a side or a corner of blocked area k: `sx` says which x edge moves
 * (-1 the one at x, +1 the one at x + w, 0 neither), `sy` the same along y,
 * by (dx, dy) metres from the rectangle `from` the drag began with. The
 * opposite side stays put; the moved one snaps to whole metres, keeps at least
 * 1 m from the opposite one and stops at the edge of the lot.
 */
export function resizeBlockedSide(layout, k, from, sx, sy, dx, dy) {
  const { recipe } = layout;
  let [x0, x1, y0, y1] = [from.x, from.x + from.w, from.y, from.y + from.h];
  if (sx < 0) x0 = clampTo(x0 + dx, 0, x1 - 1);
  if (sx > 0) x1 = clampTo(x1 + dx, x0 + 1, recipe.width);
  if (sy < 0) y0 = clampTo(y0 + dy, 0, y1 - 1);
  if (sy > 0) y1 = clampTo(y1 + dy, y0 + 1, recipe.length);
  return withBlocked(layout, recipe.blocked.map((b, i) => (i === k ? onSite({ ...b, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, recipe) : b)));
}

/**
 * Gives blocked area k its own margin, metres on the lot edge margin's steps
 * (clamped and snapped to them); null drops it, so the area keeps the lot edge
 * margin again (ADR 0022).
 */
export function setBlockedMargin(layout, k, margin) {
  const { recipe } = layout;
  const o = BLOCKED_MARGIN;
  return withBlocked(layout, recipe.blocked.map((b, i) => {
    if (i !== k) return b;
    const { margin: _, ...bare } = b;
    if (margin === null || margin === undefined) return bare;
    const v = Math.min(Math.max(o.min + Math.round((margin - o.min) / o.step) * o.step, o.min), o.max);
    return { ...bare, margin: v };
  }));
}

/** Blocked area k's margin as the editor shows it: the value, whether the area sets it itself, the lot edge margin. */
export function blockedMarginOf(layout, k) {
  const own = layout.recipe.blocked[k].margin;
  const edge = safetyOf(layout.recipe).edge;
  return { value: own ?? edge, own: own !== undefined, edge, option: BLOCKED_MARGIN };
}

/** Removes blocked area k; the numbers of those after it move up by one. */
export function removeBlocked(layout, k) {
  return withBlocked(layout, layout.recipe.blocked.filter((_, i) => i !== k));
}

/** The sizes of element i as the editor shows them, with the steps down and up (`sizeControls`). */
export function elementControls(layout, i) {
  const el = layout.elements[i];
  return sizeControls(el.type, el.sizes, diagonalAxis(el.type, el.axis), layout.recipe.bike);
}

/** Name of element i's type. */
export const elementName = (layout, i) => TYPE_NAMES[layout.elements[i].type];
