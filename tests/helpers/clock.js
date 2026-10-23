'use strict';
/**
 * Entorno determinista para TODA la suite.
 *
 *  - Fija TZ=America/Bogota (UTC-5 todo el año, sin horario de verano) antes de que
 *    ningún test cree una fecha, así la suite da lo mismo en tu PC, en CI o en UTC.
 *  - "Hoy" de la suite = 2026-10-05, 10:00 a. m. hora Colombia (NOW_ISO / HOY).
 *  - withNow(iso, fn): corre fn con el reloj congelado (new Date() y Date.now()) y
 *    SIEMPRE restaura el reloj real (try/finally). Es sincrónico a propósito: core.js no
 *    es asíncrono, y así ningún test puede dejar el reloj "pegado" para el siguiente.
 *  - withTZ(tz, fn): corre fn con otra zona horaria (para probar que las fechas no
 *    dependen de la zona del teléfono).
 */
process.env.TZ = 'America/Bogota';

const RealDate = Date;

const NOW_ISO = '2026-10-05T10:00:00-05:00';
const HOY = '2026-10-05';
const NOW_MS = new RealDate(NOW_ISO).getTime();
const HOUR = 36e5;
const DAY = 864e5;

/** epoch ms de una fecha/hora LOCAL de Colombia ('2026-10-04', '12:30'). */
const bogota = (ymd, hm = '12:00') => new RealDate(`${ymd}T${hm}:00-05:00`).getTime();

function withNow(iso, fn) {
  const now = typeof iso === 'number' ? iso : new RealDate(iso).getTime();
  if (Number.isNaN(now)) throw new Error('withNow: fecha inválida ' + iso);
  class FrozenDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(now); else super(...a); }
    static now() { return now; }
  }
  globalThis.Date = FrozenDate;
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('withNow es sincrónico: no devuelvas una promesa');
    return r;
  } finally {
    globalThis.Date = RealDate;
  }
}

/** Atajo: withNow(NOW_ISO, fn) */
const hoy = fn => withNow(NOW_ISO, fn);

function withTZ(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { process.env.TZ = prev; }
}

module.exports = { RealDate, NOW_ISO, NOW_MS, HOY, HOUR, DAY, bogota, withNow, withTZ, hoy };
