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

import { BIKE_TURN_RADIUS, elementParams, elementSizes, instantiate, SIZE_SPECS, sizeControls, TYPE_NAMES, typeAxes, typicalSizes } from './catalog.js';
import { dubinsPaths } from './dubins.js';
import {
  assemble, closingLeg, CLOSING_TURN_LIMITS, conesClear, connect, CONNECTOR_RADII, EMPTY_TRACK, extendTrack, finishTerminal, homeFinish, innerRect, inside,
  MAX_CONNECTOR_TURN, pathClear, placeTemplate, pose, ridden, SITE_MARGIN, startTerminal, straightLeg, terminalInside, trainClear, uTurnCones,
} from './generate.js';
import { axisVector, boundsOverlap, dirAngle, obbCorners, obbOverlap, pointsBounds, polylineLength, wrapPi } from './geometry.js';
import { ELEMENT_TYPES, ELEMENTS_MAX, parseRecipe, TYPE_LEVELS } from './recipe.js';

export { ELEMENTS_MAX };

// ---------------------------------------------------------------- placing

const templates = new Map();

/** The catalog template of an element; elements of one kind share it, however often the layout is routed. */
function template(type, params, diagonal, mirrored) {
  const key = `${type}|${diagonal ? 1 : 0}${mirrored ? 1 : 0}|${SIZE_SPECS[type].map((s) => params[s.key]).join(',')}`;
  if (!templates.has(key)) {
    if (templates.size > 400) templates.clear();
    templates.set(key, instantiate(type, params, diagonal, mirrored));
  }
  return templates.get(key);
}

function place(el, bike) {
  const diagonal = el.axis % 2 === 1;
  return placeTemplate(template(el.type, elementParams(el.type, el.sizes, diagonal, bike), diagonal, el.mirrored), el.axis, el.x, el.y);
}

/** The layout of a course: what `routeLayout` needs to build it again. */
export function layoutOf(course) {
  const byId = new Map(course.cones.map((c) => [c.id, c]));
  return {
    recipe: course.recipe,
    seed: course.seed,
    elements: course.elements.map((e) => {
      const anchor = byId.get(e.anchor);
      return { type: e.type, sizes: elementSizes(e.type, e.params, e.axis % 2 === 1), axis: e.axis, mirrored: e.mirrored, x: anchor.hx / 2, y: anchor.hy / 2 };
    }),
  };
}

/**
 * A layout read back from storage, or null when it is not one this build can
 * route: an unknown type, a size that is not a number, an axis the type cannot
 * stand on.
 */
export function parseLayout(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.elements)) return null;
  const recipe = parseRecipe(raw.recipe);
  if (!recipe.ok || !Number.isInteger(raw.seed)) return null;
  if (raw.elements.length < 1 || raw.elements.length > ELEMENTS_MAX) return null;
  const elements = [];
  for (const e of raw.elements) {
    if (!e || !ELEMENT_TYPES.includes(e.type) || !typeAxes(e.type).includes(e.axis)) return null;
    if (!Number.isInteger(e.x) || !Number.isInteger(e.y) || typeof e.mirrored !== 'boolean') return null;
    if (!e.sizes || !SIZE_SPECS[e.type].every((s) => Number.isFinite(e.sizes[s.key]))) return null;
    const sizes = Object.fromEntries(SIZE_SPECS[e.type].map((s) => [s.key, e.sizes[s.key]]));
    const pivot = Array.isArray(e.pivot) && e.pivot.length === 2 && e.pivot.every(Number.isFinite) ? { pivot: [e.pivot[0], e.pivot[1]] } : {};
    elements.push({ type: e.type, sizes, axis: e.axis, mirrored: e.mirrored, x: e.x, y: e.y, ...pivot });
  }
  return { recipe: recipe.recipe, seed: raw.seed, elements };
}

// ---------------------------------------------------------------- routing

const overlaps = (a, aBounds, b, bBounds) => boundsOverlap(aBounds, bBounds) && obbOverlap(a, b);

/**
 * The least bad Dubins connector when none keeps every rule: it stays on the
 * site if any does, then out of zones, then loop-free. Returns the leg and
 * what is wrong with it, worst first.
 */
function looseConnector(from, to, radius, inner, zones, paths, maxTurn, accept, tail = []) {
  let best = null;
  for (const rho of CONNECTOR_RADII.map((k) => k * radius)) {
    for (const path of dubinsPaths(from, to, rho)) {
      const points = [...path.points, ...tail];
      const bounds = pointsBounds(points);
      const cones = uTurnCones(path.arcs);
      const faults = [];
      if (!points.every((p) => inside(inner, p))) faults.push({ code: 'connector-off-site', weight: 16 });
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
  const placed = layout.elements.map((el) => place(el, recipe.bike));
  const n = placed.length;
  const id = (i) => `e${i + 1}`;
  const problems = [];
  const report = (code, text, where = {}) => problems.push({ code, text, elements: [], connector: null, ...where });

  // Each element on its own, then every pair.
  placed.forEach((p, i) => {
    if (!p.core.every((q) => inside(inner, q))) {
      report('off-site', `Элемент ${i + 1} ближе ${SITE_MARGIN} м к краю площадки — отодвиньте его от края`, { elements: [id(i)] });
    } else if (p.runOff && !obbCorners(p.runOff).every((q) => inside(site, q))) {
      report('run-off-site', `Зоне выката элемента ${i + 1} не хватает 5 м асфальта у края площадки — отодвиньте его от края`, { elements: [id(i)] });
    }
  });
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const [a, b] = [placed[i], placed[j]];
      if (overlaps(a.zone, a.zoneBounds, b.zone, b.zoneBounds)) {
        report('overlap', `Элементы ${i + 1} и ${j + 1} накладываются — раздвиньте их`, { elements: [id(i), id(j)] });
      } else if (a.runOff && overlaps(a.runOff, a.runOffBounds, b.zone, b.zoneBounds)) {
        report('in-run-off', `Элемент ${j + 1} стоит в зоне выката элемента ${i + 1}: вокруг разворота нужно 5 м — раздвиньте их`, { elements: [id(i), id(j)] });
      } else if (b.runOff && overlaps(b.runOff, b.runOffBounds, a.zone, a.zoneBounds)) {
        report('in-run-off', `Элемент ${i + 1} стоит в зоне выката элемента ${j + 1}: вокруг разворота нужно 5 м — раздвиньте их`, { elements: [id(i), id(j)] });
      }
    }
  }

  // Start and finish lines follow from the first and the last element. A line
  // may stand in the run-off zone of its own element, never of another one.
  const terminalProblems = (t, name, own, code) => {
    const lead = name === 'Старт' ? 'перед элементом 1' : `за элементом ${n}`;
    if (!terminalInside(t, inner, site)) {
      report(`${code}-off-site`, `${name} не помещается ${lead} — отодвиньте элемент от края площадки или поверните`, { elements: [id(own)] });
      return;
    }
    placed.forEach((p, i) => {
      if (overlaps(t.zone, t.zoneBounds, p.zone, p.zoneBounds)) {
        report(`${code}-overlap`, `${name} накладывается на элемент ${i + 1} — раздвиньте элементы ${Math.min(own, i) + 1} и ${Math.max(own, i) + 1}`, { elements: [id(own), id(i)] });
      } else if (i !== own && p.runOff && overlaps(t.zone, t.zoneBounds, p.runOff, p.runOffBounds)) {
        report(`${code}-overlap`, `${name} стоит в зоне выката элемента ${i + 1} — раздвиньте элементы ${Math.min(own, i) + 1} и ${Math.max(own, i) + 1}`, { elements: [id(own), id(i)] });
      }
    });
  };
  const start = startTerminal(placed[0], closed);
  terminalProblems(start, 'Старт', 0, 'start');
  /** The finish line of an open course: straight past the last element. */
  const finishAhead = () => {
    const line = finishTerminal(placed[n - 1]);
    terminalProblems(line, 'Финиш', n - 1, 'finish');
    if (overlaps(line.zone, line.zoneBounds, start.zone, start.zoneBounds)) {
      report('finish-overlap', 'Финиш накладывается на старт — раздвиньте первый и последний элементы', { elements: [id(0), id(n - 1)] });
    }
    return line;
  };
  // A finish by the start is found last, once the way to it is known.
  let finish = shape === 'open' ? finishAhead() : null;

  // Everything a connector keeps out of: zones of the elements and the lines, then the U-turn cones as they appear.
  const zones = [start, ...placed, ...(finish ? [finish] : [])];
  const zoneName = (z) => {
    if (z === start) return 'зону старта';
    if (z === finish) return 'зону финиша';
    const i = placed.indexOf(z);
    return i >= 0 ? `элемент ${i + 1}` : 'место у конуса разворота другой связки';
  };
  const legs = [straightLeg(start.center, placed[0].entry)];
  let track = recipe.train ? EMPTY_TRACK : null;
  const trainProblem = (i) => report('train', `Элемент ${i + 1} пересекает маршрут: в паровозике мотоциклы встретятся — отодвиньте его или замените`, { elements: [id(i)] });
  if (track) {
    if (!trainClear(track, [legs[0].points, ridden(placed[0])])) trainProblem(0);
    track = extendTrack(track, [legs[0].points, ridden(placed[0])]);
  }

  /** A connector by the generator's rules, or the least bad one with its problem. `name` is «3 → 4». */
  const connectorProblem = (fault, connector, name, ends) => {
    const texts = {
      'connector-off-site': `Связка ${name} выходит за площадку — отодвиньте элементы от края или поверните один из них`,
      'connector-zone': `Связка ${name} проходит через ${fault.hit ? fault.hit.map(zoneName).join(' и ') : ''} — освободите ей путь или поверните один из элементов`,
      'connector-loop': `Связка ${name} закладывает петлю — раздвиньте элементы или поверните один из них входом к другому`,
      'connector-cone': `Конусу разворота на связке ${name} не хватает 1,5 м свободного асфальта — раздвиньте элементы`,
      'connector-train': `Связка ${name} пересекает маршрут: в паровозике мотоциклы встретятся — переставьте элементы`,
    };
    report(fault.code, texts[fault.code], { elements: ends, connector });
  };

  for (let i = 1; i < n; i++) {
    const [prev, cur] = [placed[i - 1], placed[i]];
    const from = pose(prev.exit, prev.exitDir);
    const to = pose(cur.entry, cur.entryDir);
    const accept = track && ((pts) => trainClear(track, [pts, ridden(cur)]));
    let leg = connect(from, to, radius, inner, zones, legs, MAX_CONNECTOR_TURN, accept);
    if (!leg && track) {
      // The rules hold but for «паровозик»: is it the connector that meets the route, or the element it leads into?
      leg = connect(from, to, radius, inner, zones, legs, MAX_CONNECTOR_TURN);
      if (leg && trainClear(track, [leg.points])) trainProblem(i);
      else if (leg) connectorProblem({ code: 'connector-train' }, i, `${i} → ${i + 1}`, [id(i - 1), id(i)]);
    }
    if (!leg) {
      const loose = looseConnector(from, to, radius, inner, zones, legs, MAX_CONNECTOR_TURN, track && ((pts) => trainClear(track, [pts])));
      leg = loose.leg;
      connectorProblem(loose.faults[0], i, `${i} → ${i + 1}`, [id(i - 1), id(i)]);
    }
    legs.push(leg);
    zones.push(...leg.cones);
    if (track) track = extendTrack(track, [leg.points, ridden(cur)]);
  }

  const last = placed[n - 1];
  if (closed) {
    // Back to the start: lined up one turning radius before the line, then straight across it.
    const from = pose(last.exit, last.exitDir);
    const accept = track && ((pts) => trainClear(track, [pts], true));
    let leg = null;
    for (const limit of CLOSING_TURN_LIMITS) leg = leg || closingLeg(from, start, radius, inner, zones, legs, limit, accept);
    if (!leg) {
      const u = axisVector(start.dir);
      const approach = [start.center[0] - u[0] * radius, start.center[1] - u[1] * radius];
      const loose = looseConnector(from, pose(approach, start.dir), radius, inner, zones, legs, CLOSING_TURN_LIMITS.at(-1), accept, [start.center]);
      leg = loose.leg;
      connectorProblem(loose.faults[0] ?? { code: 'connector-zone' }, n, `${n} → старт`, [id(n - 1), id(0)]);
    }
    legs.push(leg);
  } else {
    if (shape === 'return') {
      // A finish line by the start, reached lined up like a closing connector.
      const from = pose(last.exit, last.exitDir);
      const accept = track && ((pts) => trainClear(track, [pts]));
      let home = null;
      for (const limit of CLOSING_TURN_LIMITS) home = home || homeFinish(from, start, radius, inner, site, zones, legs, limit, accept);
      if (home) {
        finish = home.terminal;
        legs.push(home.leg);
      } else {
        report('finish-away', `Финишу нет места у старта, он стоит за элементом ${n} — освободите место у старта или поверните элемент ${n} выходом к нему`, { elements: [id(0), id(n - 1)], connector: n });
        finish = finishAhead();
      }
    }
    if (legs.length === n) {
      const leg = straightLeg(last.exit, finish.center);
      if (track && !trainClear(track, [leg.points])) connectorProblem({ code: 'connector-train' }, n, `${n} → финиш`, [id(n - 1)]);
      legs.push(leg);
    }
  }

  const course = assemble(recipe, layout.seed, placed, legs, start, finish);
  return { course: { ...course, requested: n, placed: n, edited: true }, problems };
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
  const p = place(el, recipe.bike);
  const full = slack(p, recipe, true);
  const core = slack(p, recipe, false);
  const shift = [0, 1].map((k) => clampInt(0, ...full[k]) ?? clampInt(0, ...core[k]) ?? 0);
  return shift[0] || shift[1] ? { ...el, x: el.x + shift[0], y: el.y + shift[1] } : el;
}

/** The element with the centre of its zone as close to `centre` as an anchor on whole metres allows. */
function centred(el, centre, bike) {
  const origin = place({ ...el, x: 0, y: 0 }, bike);
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
  const { bike } = layout.recipe;
  const pivot = el.pivot ?? place(el, bike).center;
  return withElement(layout, i, fitted(centred({ ...el, ...change, pivot }, pivot, bike), layout.recipe));
}

/** Moves the anchor of element i to (x, y), whole metres, as far as the site lets it. */
export function moveElement(layout, i, x, y) {
  return withElement(layout, i, fitted({ ...unpinned(layout.elements[i]), x: Math.round(x), y: Math.round(y) }, layout.recipe));
}

/** Turns element i by one step of its axes — 45°, or 90° for a type that only stands along the site sides — about the middle of its zone. */
export function rotateElement(layout, i, dir) {
  const el = layout.elements[i];
  const axes = typeAxes(el.type);
  return turned(layout, i, { axis: axes[(axes.indexOf(el.axis) + dir + axes.length) % axes.length] });
}

/** Mirrors element i across its axis: turns swap sides, and so do the colours of its cones. */
export function mirrorElement(layout, i) {
  return turned(layout, i, { mirrored: !layout.elements[i].mirrored });
}

/** Gives element i new nominal sizes (one of `sizeControls`' steps); its anchor stays. */
export function resizeElement(layout, i, sizes) {
  return withElement(layout, i, fitted({ ...unpinned(layout.elements[i]), sizes }, layout.recipe));
}

/** Typical sizes of a type for the layout's difficulty and bike class; a type used only from medium takes medium sizes on an easy course. */
function startingSizes(type, recipe) {
  const levels = TYPE_LEVELS[type];
  return typicalSizes(type, levels && !levels.includes(recipe.difficulty) ? levels[0] : recipe.difficulty, recipe.bike, recipe.sizes);
}

/** The axis on which the element is entered as close to `dir` (0..7) as its type allows. */
function axisEnteredAlong(el, dir, bike) {
  let best = el.axis;
  let off = Infinity;
  for (const axis of typeAxes(el.type)) {
    const d = Math.abs(wrapPi(dirAngle(place({ ...el, axis, x: 0, y: 0 }, bike).entryDir) - dirAngle(dir)));
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
  const was = place(old, recipe.bike);
  const el = { type, sizes: startingSizes(type, recipe), axis: typeAxes(type)[0], mirrored: old.mirrored, x: 0, y: 0 };
  el.axis = axisEnteredAlong(el, was.entryDir, recipe.bike);
  return withElement(layout, i, fitted(centred(el, was.center, recipe.bike), recipe));
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
  const others = layout.elements.map((e) => place(e, recipe.bike));
  const prev = others[at - 1];
  const next = others[at];
  const along = (p, dir, d) => [p[0] + axisVector(dir)[0] * d, p[1] + axisVector(dir)[1] * d];
  const ideal = prev && next ? [(prev.exit[0] + next.entry[0]) / 2, (prev.exit[1] + next.entry[1]) / 2]
    : prev ? along(prev.exit, prev.exitDir, AHEAD)
      : next ? along(next.entry, next.entryDir, -AHEAD)
        : [recipe.width / 2, recipe.length / 2];
  const el = { type, sizes: startingSizes(type, recipe), axis: 0, mirrored: false, x: 0, y: 0 };
  const turn = (a, b) => Math.abs(wrapPi(a - b));
  const bearing = (from, to) => Math.atan2(to[1] - from[1], to[0] - from[0]);
  const spots = [];
  for (const axis of typeAxes(type)) {
    const origin = place({ ...el, axis }, recipe.bike);
    const range = slack(origin, recipe, true).map(([lo, hi]) => [Math.ceil(lo - 1e-9), Math.floor(hi + 1e-9)]);
    for (let x = range[0][0]; x <= range[0][1]; x += SPOT_STEP) {
      for (let y = range[1][0]; y <= range[1][1]; y += SPOT_STEP) {
        const moved = (o) => ({ ...o, c: [o.c[0] + x, o.c[1] + y] });
        const shifted = (b) => [b[0] + x, b[1] + y, b[2] + x, b[3] + y];
        const zone = moved(origin.zone);
        const zoneBounds = shifted(origin.zoneBounds);
        const runOff = origin.runOff && moved(origin.runOff);
        const runOffBounds = origin.runOff && shifted(origin.runOffBounds);
        const free = others.every((o) => !overlaps(zone, zoneBounds, o.zone, o.zoneBounds)
          && !(o.runOff && overlaps(zone, zoneBounds, o.runOff, o.runOffBounds))
          && !(runOff && overlaps(runOff, runOffBounds, o.zone, o.zoneBounds)));
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
  if (!spots.length) return withSpot(fitted(centred(el, ideal, recipe.bike), recipe));
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

/** The sizes of element i as the editor shows them, with the steps down and up (`sizeControls`). */
export function elementControls(layout, i) {
  const el = layout.elements[i];
  return sizeControls(el.type, el.sizes, el.axis % 2 === 1, layout.recipe.bike);
}

/** Name of element i's type. */
export const elementName = (layout, i) => TYPE_NAMES[layout.elements[i].type];
