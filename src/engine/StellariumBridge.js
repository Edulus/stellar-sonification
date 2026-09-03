// StellariumBridge — wraps the raw Stellarium Web Engine JS API into a small,
// React-friendly surface that emits normalized star-selection data.
//
// The entire API used here is documented and verified in PHASE0-FINDINGS.md.
// Highlights that drove this design:
//   - The engine factory `StelWebEngine({...})` is a global from the engine .js.
//   - Selection changes arrive via `stel.change((obj, attr) => ...)`; we filter
//     to `attr === 'selection'`. No polling loop.
//   - A selected star's data comes from `obj.designations()` (method),
//     `obj.getInfo('vmag'|'distance'|'radec')`, and `obj.jsonData.model_data`
//     (spect_t, BVMag, plx). There are no `obj.hip`/`obj.spect_t` properties.

import { ENGINE_CONFIG } from "./config.js";

/**
 * Dynamically load the engine glue script, which defines the global
 * `StelWebEngine` factory. We load it as a classic script (it's an Emscripten
 * UMD-ish bundle, not an ES module), once.
 */
function loadEngineScript(jsUrl) {
  if (window.StelWebEngine) return Promise.resolve(window.StelWebEngine);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-swe="1"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.StelWebEngine));
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = jsUrl;
    s.async = true;
    s.dataset.swe = "1";
    s.onload = () => {
      if (window.StelWebEngine) resolve(window.StelWebEngine);
      else reject(new Error("Engine script loaded but StelWebEngine is undefined"));
    };
    s.onerror = () => reject(new Error(`Failed to load engine script: ${jsUrl}`));
    document.head.appendChild(s);
  });
}

/** Parse "PREFIX value" out of a designations array, e.g. ("HIP 32349","HIP") -> "32349". */
function pickDesignation(designations, prefix) {
  if (!designations) return null;
  const hit = designations.find((d) => d.startsWith(prefix + " "));
  return hit ? hit.slice(prefix.length + 1).trim() : null;
}

/** Choose the most human-friendly name from a designations array. */
function pickName(designations) {
  if (!designations || !designations.length) return null;
  const named = designations.find((d) => d.startsWith("NAME "));
  if (named) return named.slice(5).trim();
  // Otherwise fall back to the first designation (often a Bayer name like "* alf CMa").
  return designations[0];
}

// ── display-name helpers (hover tooltip) ──────────────────────────────────
//
// The bundled catalog spells Bayer designations the Simbad way: "* alf Aur",
// "* mu.01 Boo". Rendering those raw looks like a database dump, so we expand
// the greek abbreviation and turn the ".01" component index into a superscript.

const GREEK = {
  alf: "\u03b1", bet: "\u03b2", gam: "\u03b3", del: "\u03b4", eps: "\u03b5",
  zet: "\u03b6", eta: "\u03b7", tet: "\u03b8", iot: "\u03b9", kap: "\u03ba",
  lam: "\u03bb", mu: "\u03bc", nu: "\u03bd", ksi: "\u03be", omi: "\u03bf",
  pi: "\u03c0", rho: "\u03c1", sig: "\u03c3", tau: "\u03c4", ups: "\u03c5",
  phi: "\u03c6", khi: "\u03c7", psi: "\u03c8", ome: "\u03c9",
};
const SUPERSCRIPT = "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079";

/**
 * "* alf Aur" -> "α Aur"; "* mu.01 Boo" -> "μ¹ Boo"; "NAME Pleiades" -> "Pleiades".
 * The catalog writes the component index both ways ("mu.01", "sig02"), so the
 * separating dot is optional.
 */
export function prettyDesignation(d) {
  if (!d) return d;
  const s = String(d).replace(/^NAME\s+/, "").replace(/^V?\*+\s+/, "");
  return s.replace(/^([a-z]{2,3})(?:\.?0*(\d+))?(?=\s|$)/i, (m, abbr, idx) => {
    const letter = GREEK[abbr.toLowerCase()];
    if (!letter) return m;
    const sup = idx ? String(idx).replace(/\d/g, (c) => SUPERSCRIPT[+c]) : "";
    return letter + sup;
  });
}

// Designations that are pure catalog ids — usable as a fallback label, but we
// prefer a proper name or a Bayer/Flamsteed designation when one exists.
const CATALOG_RE = /^(HIP|HD|HR|SAO|TYC|GAIA|Gaia|2MASS|BD|CD|CPD|NGC|IC|M|Cl|OCl|GCl|LBN|LDN|PGC|UGC|Mel|Melotte|Ced|Sh2|C)\b/;

/** The most human-readable designation, plus up to two alternates. */
function pickDisplayNames(designations) {
  const list = (designations || []).filter(Boolean);
  if (!list.length) return { name: null, alts: [] };
  const proper = list.find((d) => d.startsWith("NAME ")) ||
    list.find((d) => !CATALOG_RE.test(d) && !/^V?\*+\s/.test(d));
  const bayer = list.find((d) => /^V?\*+\s/.test(d));
  const primary = proper || bayer || list[0];
  const alts = list.filter((d) => d !== primary).slice(0, 2).map(prettyDesignation);
  return { name: prettyDesignation(primary), alts };
}

export class StellariumBridge {
  constructor(canvas) {
    this.canvas = canvas;
    this.stel = null; // the engine handle (=== Module)
    this._listeners = new Map(); // event name -> Set<callback>
    this._destroyed = false;
  }

  /** Initialize the engine into the canvas and wire selection change events. */
  async init(config = ENGINE_CONFIG) {
    const StelWebEngine = await loadEngineScript(config.jsFile);
    if (this._destroyed) return;

    const stel = await new Promise((resolve, reject) => {
      try {
        StelWebEngine({
          wasmFile: config.wasmFile,
          canvas: this.canvas,
          translateFn: (domain, str) => str,
          onReady: (s) => resolve(s),
        });
      } catch (e) {
        reject(e);
      }
    });
    if (this._destroyed) return;

    this.stel = stel;
    this._registerDataSources(config);
    this._registerFonts(config);
    this._applyNightSky(config.nightSky);
    if (config.defaultLocation) {
      const l = config.defaultLocation;
      this.setLocation(l.lat, l.lng, l.elevation);
      this._location = l;
    }
    // Opens on the real current sky, ticking forward — core_init already
    // seeded the observer's clock from the system clock, so this is the only
    // thing needed to make it "now, live" rather than a frozen snapshot of
    // whatever moment the page happened to load.
    this.setLive(true);
    this._wireSelection();
    this._wireHover();
    this.emit("ready");
    return stel;
  }

  /**
   * Keep every star clickable regardless of what time is showing (see
   * config.nightSky). Disabling the atmosphere is what actually keeps the
   * sky black at any sun altitude — real daylight scattering would hide
   * almost everything there is to click. Landscape starts off (full-sphere
   * view); the user can flip it on via setLandscapeVisible(). Each toggle is
   * guarded — a missing module just means that layer isn't present in this
   * build.
   */
  _applyNightSky(opts) {
    if (!opts) return;
    const core = this.stel?.core;
    if (!core) return;
    if (opts.atmosphere === false && core.atmosphere) core.atmosphere.visible = false;
    if (opts.landscape === false && core.landscapes) core.landscapes.visible = false;
  }

  /**
   * Move the observer. lat/lng in signed decimal degrees (N/E positive),
   * elevation in metres. The engine's `observer.latitude/longitude` are in
   * radians. Does NOT touch the clock — changing location while looking at a
   * chosen date/time should show that same moment from the new location, not
   * silently jump the time too.
   */
  setLocation(lat, lng, elevation = 0) {
    const obs = this.stel?.core?.observer;
    if (!obs) return;
    // FOOT-GUN: observer.latitude/longitude are RADIANS, but every caller (and
    // locations.js) speaks degrees. Always convert — never assign raw degrees.
    const D2R = Math.PI / 180;
    try {
      obs.latitude = lat * D2R;   // deg -> rad
      obs.longitude = lng * D2R;  // deg -> rad
      if ("elevation" in obs) obs.elevation = elevation; // metres (not converted)
    } catch (e) {
      console.warn("[StellariumBridge] setLocation failed:", e);
    }
    this._location = { lat, lng, elevation };
  }

  /**
   * Show or hide the ground/horizon landscape. Off (the default, per
   * config.nightSky.landscape) exposes the full celestial sphere — you can
   * look "through" the ground at stars below the local horizon. On draws the
   * landscape silhouette so the horizon reads as a horizon. Purely visual;
   * does not affect what's selectable or the atmosphere setting.
   */
  setLandscapeVisible(visible) {
    const landscapes = this.stel?.core?.landscapes;
    if (!landscapes) return;
    try {
      landscapes.visible = !!visible;
    } catch (e) {
      console.warn("[StellariumBridge] setLandscapeVisible failed:", e);
    }
  }

  // ── time control ─────────────────────────────────────────────────────
  //
  // `core.time_speed` is the engine's own throttle (0 = frozen, 1 = real
  // time, exported the same dynamic-property way as atmosphere/landscape
  // .visible — see the SweObj constructor in the engine glue). `core_init`
  // already seeds the observer's clock from the *real* system time (see
  // core.c), so enabling live ticking needs nothing else — there is no "now"
  // to compute ourselves. `observer.utc` is a genuine engine property (see
  // PROPERTY(utc, ...) in observer.c), so setting it directly is correct
  // without hand-rolling the UTC/TT leap-second offset — `date2MJD`/
  // `MJD2date` (both exported on the engine Module) do that conversion.

  /**
   * Start or stop the clock ticking forward in real time. Enabling always
   * snaps the observer to the *actual* current moment first — without this,
   * "resume live" after a frozen custom date would just start ticking
   * forward from wherever it was frozen (e.g. still 1969), not jump back to
   * the real present. init() relies on this too: it's what makes the app
   * open on "now" rather than whatever the engine's own default happened to
   * be a render tick after core_init seeded it.
   */
  setLive(enabled) {
    const core = this.stel?.core;
    const obs = this.stel?.core?.observer;
    if (!core) return;
    try {
      if (enabled && obs) obs.utc = this.stel.date2MJD(Date.now());
      core.time_speed = enabled ? 1 : 0;
    } catch (e) {
      console.warn("[StellariumBridge] setLive failed:", e);
    }
  }

  /** Whether the clock is currently ticking forward in real time. */
  isLive() {
    return (this.stel?.core?.time_speed ?? 0) !== 0;
  }

  /**
   * Jump to an exact date/time (a JS Date). Interpreted as UTC — the engine
   * has no per-location timezone database, so UTC is the one unambiguous
   * choice for "any point on Earth" (the UI labels it as such). Also freezes
   * the clock there via setLive(false); picking an exact moment and having
   * it immediately start drifting away would defeat the point of picking it.
   */
  setDateTime(date) {
    const obs = this.stel?.core?.observer;
    if (!obs || !(date instanceof Date) || Number.isNaN(date.getTime())) return;
    try {
      obs.utc = this.stel.date2MJD(date.getTime());
    } catch (e) {
      console.warn("[StellariumBridge] setDateTime failed:", e);
      return;
    }
    this.setLive(false);
  }

  /** Current observer date/time as a JS Date (UTC), or null before ready. */
  getDateTime() {
    const obs = this.stel?.core?.observer;
    if (!obs) return null;
    try {
      return this.stel.MJD2date(obs.utc);
    } catch {
      return null;
    }
  }

  /**
   * Jump to solar midnight *today* at the current location and freeze there
   * — the app's original fixed behavior, kept as a one-click "guaranteed
   * dark sky right now" shortcut. Solar midnight (UTC) for longitude λ° is
   * ~ (0 − λ/15) h.
   */
  goToTonight(date = new Date()) {
    const lng = this._location?.lng ?? 0;
    const midnightUTCh = ((0 - lng / 15) % 24 + 24) % 24;
    const d = new Date(Date.UTC(
      date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
      0, 0, 0, 0,
    ));
    d.setUTCHours(midnightUTCh, (midnightUTCh % 1) * 60, 0, 0);
    this.setDateTime(d);
  }

  _registerDataSources(config) {
    const core = this.stel.core;
    for (const src of config.dataSources) {
      const mod = core[src.module];
      if (!mod || typeof mod.addDataSource !== "function") {
        // A missing module just means that layer won't render; stars is the
        // only one we truly need for Phase 0.
        console.warn(`[StellariumBridge] no module "${src.module}" to add data source`);
        continue;
      }
      mod.addDataSource({ url: config.skydataBase + src.url, key: src.key });
    }
  }

  _registerFonts(config) {
    if (typeof this.stel.setFont !== "function" || !config.fonts) return;
    try {
      this.stel.setFont("regular", config.fonts.regular.url, config.fonts.regular.scale);
      this.stel.setFont("bold", config.fonts.bold.url, config.fonts.bold.scale);
    } catch (e) {
      console.warn("[StellariumBridge] setFont failed:", e);
    }
  }

  /**
   * Register the global change listener and translate `selection` changes into
   * our own `starSelected` / `deselected` events. See PHASE0-FINDINGS.md §2.
   */
  _wireSelection() {
    let last = this.stel.core.selection || null;
    this.stel.change((_obj, attr) => {
      // `hovered` fires on every mouse move — ignore it (and this build never
      // emits it anyway; hover is handled by _wireHover via screen picking).
      if (attr !== "selection") return;
      const sel = this.stel.core.selection || null;
      if (sel === last) return;
      last = sel;
      if (sel) {
        this.emit("starSelected", this.extractStarData(sel));
      } else {
        this.emit("deselected");
      }
    });
  }

  /**
   * Hover detection. The engine has no hover gesture — it only picks an object
   * on click (core_get_obj_at, inside C). We expose that picker as
   * `stel.getObjAt(x, y, maxDist)` (custom engine build) and poll it on canvas
   * mousemove, emitting `starHovered` / `starUnhovered` when the picked object
   * changes. Picking is throttled to once per animation frame.
   *
   * Each picked SweObj is retained by the engine; we release it (_obj_release)
   * as soon as we've read its id/data, so frequent picking doesn't leak.
   */
  _wireHover() {
    if (typeof this.stel.getObjAt !== "function") {
      console.warn("[StellariumBridge] engine has no getObjAt(); hover disabled. Rebuild the engine to enable it.");
      return;
    }
    const canvas = this.canvas;
    let pending = null;     // {x, y} latest mouse position awaiting a pick
    let rafId = null;
    let lastId = null;      // id string of the currently-hovered object (or null)

    const objId = (obj) => {
      try { return obj.id || (obj.designations() || [])[0] || String(obj.v); }
      catch { return String(obj.v); }
    };

    const pick = () => {
      rafId = null;
      if (!this.stel || !pending) return;
      const { x, y } = pending;
      pending = null;
      let obj = null;
      try { obj = this.stel.getObjAt(x, y, 18); } catch { obj = null; }

      if (!obj) {
        // Cursor left all stars → wind everything down (handled as fade-all).
        if (lastId !== null) { lastId = null; this.emit("starUnhovered"); }
        return;
      }
      const id = objId(obj);
      if (id !== lastId) {
        // Moving star→star does NOT stop the previous: up to 3 stars accumulate
        // and ring together (the engine caps + force-fades the oldest). Only
        // leaving to empty sky (above / mouseleave) winds them down.
        lastId = id;
        let data = null;
        try { data = this.extractStarData(obj); } catch { /* non-star */ }
        if (data) {
          // Tooltip payload: works for any object type, not just stars.
          data.info = this.extractObjectInfo(obj);
          // Locate the star's screen position (so the label sits on it, not the
          // cursor) by finding the centroid of its pickable area.
          const c = this._starScreenCenter(x, y, obj.v);
          data.screenX = c.x;
          data.screenY = c.y;
          data.starKey = id; // stable hover key (also the audio/ring key)
          this.emit("starHovered", data);
        }
      }
      // Release the retained C reference now that we've read what we need.
      try { this.stel._obj_release(obj.v); } catch { /* */ }
    };

    this._onCanvasMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      pending = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (rafId === null) rafId = requestAnimationFrame(pick);
    };
    this._onCanvasLeave = () => {
      pending = null;
      if (lastId !== null) { lastId = null; this.emit("starUnhovered"); }
    };
    canvas.addEventListener("mousemove", this._onCanvasMove);
    canvas.addEventListener("mouseleave", this._onCanvasLeave);
  }

  /**
   * Find the screen centroid (CSS px) of the star identified by pointer `refV`,
   * by sampling the engine's own picker around (cx, cy). Uses the raw ccall to
   * core_get_obj_at (returns a pointer) and pointer-compares — no SweObj built —
   * so the ~170 probes stay cheap. Releases every retained pointer it gets.
   */
  _starScreenCenter(cx, cy, refV) {
    const R = 18, step = 3, maxd = 8;
    let sx = 0, sy = 0, n = 0;
    for (let dy = -R; dy <= R; dy += step) {
      for (let dx = -R; dx <= R; dx += step) {
        let ptr = 0;
        try {
          ptr = this.stel.ccall("core_get_obj_at", "number",
            ["number", "number", "number"], [cx + dx, cy + dy, maxd]);
        } catch { ptr = 0; }
        if (ptr) {
          if (ptr === refV) { sx += cx + dx; sy += cy + dy; n += 1; }
          try { this.stel._obj_release(ptr); } catch { /* */ }
        }
      }
    }
    return n ? { x: sx / n, y: sy / n } : { x: cx, y: cy };
  }

  /**
   * Tooltip-grade description of ANY picked object — star, DSO, planet, moon.
   * Unlike `extractStarData` (which is shaped for the sonification cascade) this
   * is purely for display: a readable name, a human object type, and whichever
   * of magnitude / distance / colour / size / horizon position the engine can
   * actually supply for that object. Every field is optional; the tooltip just
   * omits what is null.
   *
   * Must be called while the SweObj is still retained (i.e. inside the hover
   * pick, before `_obj_release`).
   */
  extractObjectInfo(obj) {
    const stel = this.stel;
    const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

    const designations = safe(() => obj.designations() || [], []);
    const { name, alts } = pickDisplayNames(designations);
    const jd = safe(() => obj.jsonData, null);
    const md = jd?.model_data ?? null;
    const types = jd?.types || [];
    const getInfo = (k) => safe(() => obj.getInfo(k), null);

    // "*" -> "Star", "OpC" -> "Open Cluster", … The list ends in "?" (unknown);
    // take the first entry the engine can actually name.
    let typeLabel = null;
    if (typeof stel?.otypeToStr === "function") {
      for (const t of types) {
        const label = safe(() => stel.otypeToStr(t), null);
        if (label && label !== "?" && label.toLowerCase() !== "unknown") { typeLabel = label; break; }
      }
    }

    // Horizon + equatorial position, from the ICRF unit vector the engine gives
    // us. `radec` is a cartesian vector, NOT [ra, dec] — see PHASE0-FINDINGS §3.
    let altDeg = null, azDeg = null, raHours = null, decDeg = null;
    const icrf = getInfo("radec");
    const obs = stel?.core?.observer;
    if (icrf && obs && typeof stel.convertFrame === "function") {
      const observed = safe(() => stel.c2s(stel.convertFrame(obs, "ICRF", "OBSERVED", icrf)));
      if (observed) {
        azDeg = stel.anp(observed[0]) * stel.R2D;
        altDeg = stel.anpm(observed[1]) * stel.R2D;
      }
      const eq = safe(() => stel.c2s(stel.convertFrame(obs, "ICRF", "JNOW", icrf)));
      if (eq) {
        raHours = (stel.anp(eq[0]) * stel.R2D) / 15;
        decDeg = stel.anpm(eq[1]) * stel.R2D;
      }
    }

    const distanceAU = getInfo("distance");
    // Angular size: DSOs carry dimx/dimy in arcmin; point sources carry nothing.
    const sizeArcmin = md?.dimx ?? null;

    return {
      name: name || "Unnamed object",
      alts,
      designations,
      typeLabel,
      otype: types[0] ?? null,
      magnitude: getInfo("vmag") ?? md?.Vmag ?? null,
      bv: md?.BVMag ?? null,
      spectralType: md?.spect_t ?? null,
      distanceAU: distanceAU ?? null,
      distanceLy: distanceAU != null ? distanceAU / 63241.077 : null,
      sizeArcmin,
      phase: getInfo("phase"),
      altDeg,
      azDeg,
      raHours,
      decDeg,
    };
  }

  /** Normalize a selected SweObj into a plain data object (see PHASE0-FINDINGS.md §8). */
  extractStarData(obj) {
    let designations = [];
    try {
      designations = obj.designations() || [];
    } catch {
      /* non-star objects may differ; tolerate */
    }

    const md = (() => {
      try {
        return obj.jsonData?.model_data ?? null;
      } catch {
        return null;
      }
    })();

    const num = (v) => (v == null ? null : Number.parseInt(v, 10));
    const getInfo = (key) => {
      try {
        return obj.getInfo(key);
      } catch {
        return undefined;
      }
    };

    return {
      hip: num(pickDesignation(designations, "HIP")),
      hd: num(pickDesignation(designations, "HD")),
      gaia: pickDesignation(designations, "GAIA"),
      name: pickName(designations),
      designations,
      spectralType: md?.spect_t ?? null,
      magnitude: getInfo("vmag") ?? null,
      bv: md?.BVMag ?? null,
      distanceAU: getInfo("distance") ?? null,
      radecICRF: getInfo("radec") ?? null,
      _obj: obj, // raw handle, handy while debugging Phase 0
    };
  }

  // ── tiny event emitter ────────────────────────────────────────────────
  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return () => this.off(event, cb);
  }

  off(event, cb) {
    this._listeners.get(event)?.delete(cb);
  }

  emit(event, data) {
    this._listeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (e) {
        console.error(`[StellariumBridge] listener for "${event}" threw:`, e);
      }
    });
  }

  destroy() {
    this._destroyed = true;
    if (this._onCanvasMove) this.canvas?.removeEventListener("mousemove", this._onCanvasMove);
    if (this._onCanvasLeave) this.canvas?.removeEventListener("mouseleave", this._onCanvasLeave);
    this._listeners.clear();
    // The engine has no clean teardown in the JS API; dropping references and
    // letting the canvas be removed is the practical approach.
    this.stel = null;
  }
}

export default StellariumBridge;
