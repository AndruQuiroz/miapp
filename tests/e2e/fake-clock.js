'use strict';
/**
 * Reloj falso para la ventana de jsdom: setTimeout/setInterval/Date controlados por la prueba.
 * Así "esperar 1,5 s de debounce" o "60 s de sync periódico" son instantáneos y deterministas.
 *
 *   const clock = new FakeClock('2026-10-05T10:00:00-05:00');
 *   clock.advance(1500);          // ejecuta, en orden, todo lo que venza en ese lapso
 *   clock.now                     // ms epoch "actual" de la ventana
 */
const RealDate = Date;

class FakeClock {
  constructor(start) {
    this.now = typeof start === 'number' ? start : new RealDate(start).getTime();
    if (Number.isNaN(this.now)) throw new Error('FakeClock: fecha inválida ' + start);
    this._id = 1;
    this._timers = new Map();
    this.onError = e => { throw e; };   // el harness lo cambia para acumular errores como window.onerror
  }

  setTimeout(fn, ms = 0, ...args) { return this._add(fn, ms, args, null); }
  setInterval(fn, ms = 0, ...args) { return this._add(fn, ms, args, Math.max(1, +ms || 0)); }
  clear(id) { this._timers.delete(id); }
  get pending() { return this._timers.size; }
  /** Milisegundos hasta el próximo temporizador (null si no hay). */
  get nextIn() {
    let min = null;
    for (const t of this._timers.values()) if (min === null || t.at < min) min = t.at;
    return min === null ? null : Math.max(0, min - this.now);
  }

  _add(fn, ms, args, every) {
    if (typeof fn !== 'function') return 0;
    const id = this._id++;
    this._timers.set(id, { id, seq: id, at: this.now + Math.max(0, +ms || 0), fn, args, every });
    return id;
  }

  /** Avanza el reloj `ms` ejecutando los temporizadores vencidos (incluye los que se creen durante el avance). */
  advance(ms) {
    const end = this.now + Math.max(0, ms);
    let guard = 0;
    for (;;) {
      let next = null;
      for (const t of this._timers.values()) if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && t.seq < next.seq))) next = t;
      if (!next) break;
      if (++guard > 20000) throw new Error('FakeClock.advance: demasiados temporizadores (¿un setInterval de 1 ms o un bucle de setTimeout?)');
      this.now = Math.max(this.now, next.at);
      if (next.every) { next.at += next.every; next.seq = this._id++; } else this._timers.delete(next.id);
      try { next.fn(...next.args); } catch (e) { this.onError(e); }
    }
    this.now = end;
  }

  /** Salta al próximo temporizador y lo ejecuta (devuelve false si no había). */
  step() {
    const n = this.nextIn;
    if (n === null) return false;
    this.advance(n);
    return true;
  }

  /** Fija la hora de la ventana (no ejecuta temporizadores). */
  set(iso) { this.now = typeof iso === 'number' ? iso : new RealDate(iso).getTime(); }

  /** Instala el reloj en una ventana de jsdom: setTimeout, setInterval, clear*, requestAnimationFrame y Date. */
  install(window) {
    const clock = this;
    window.setTimeout = (fn, ms, ...a) => clock.setTimeout(fn, ms, ...a);
    window.setInterval = (fn, ms, ...a) => clock.setInterval(fn, ms, ...a);
    window.clearTimeout = id => clock.clear(id);
    window.clearInterval = id => clock.clear(id);
    window.requestAnimationFrame = fn => clock.setTimeout(() => fn(clock.now), 16);
    window.cancelAnimationFrame = id => clock.clear(id);
    const WinDate = window.Date;
    class FrozenDate extends WinDate {
      constructor(...a) { if (a.length === 0) super(clock.now); else super(...a); }
      static now() { return clock.now; }
    }
    window.Date = FrozenDate;
    return this;
  }
}

module.exports = { FakeClock };
