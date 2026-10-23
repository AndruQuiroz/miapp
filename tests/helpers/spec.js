'use strict';
/** Constantes del SPEC (§6.3) copiadas A PROPÓSITO: si quick.js se desvía del contrato, los tests lo detectan. */
const CATS = ['Celulares', 'Consolas', 'Computadores', 'Accesorios', 'Ropa', 'Calzado', 'Coleccionables', 'Moto/Auto', 'Otro'];
const GCATS = ['Envíos', 'Empaques', 'Comisiones', 'Publicidad', 'Transporte', 'Comida', 'Mantenimiento', 'Servicios', 'Entretenimiento', 'Personal', 'Otro'];
const NEG_CATS = ['Envíos', 'Empaques', 'Comisiones', 'Publicidad'];
const CONDS = ['nuevo', 'bueno', 'regular'];
const KINDS = ['compra', 'venta', 'gasto', 'ingreso', 'cobro', 'abono', 'transfer'];

/** normKey independiente (minúsculas, sin tildes, solo letras/dígitos separados por espacio) para comparar claves de reglas. */
const normKeyLocal = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

module.exports = { CATS, GCATS, NEG_CATS, CONDS, KINDS, normKeyLocal };
