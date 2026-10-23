'use strict';
// app/ocr.js: extraer IMEI, batería y almacenamiento del texto que devuelve el OCR (textos reales de Tesseract sobre pantallazos).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const O = require('../app/ocr.js');

test('Luhn: IMEI válidos e inválidos', () => {
  assert.ok(O.luhnOk('353911104869129'));
  assert.ok(!O.luhnOk('353911104869128'));
  assert.ok(!O.luhnOk('35391110486912'));
});
test('iPhone, Ajustes → General → Información (con IMEI2 y "Disponible")', () => {
  const r = O.extraerDatosTelefono(`Información\n\nNombre iPhone de Andru\nVersión de ¡OS 18.2\nNombre del modelo iPhone 13\nNúmero de modelo MLPF3LL/A\nNúmero de serie F2LXK9QWP4\nCapacidad 128 GB\nDisponible 37,4 GB\nIMEI 35 391110 486912 9\nIMEI2 35 391110 571203 9`);
  assert.equal(r.imei, '353911104869129'); assert.equal(r.imei2, '353911105712039');
  assert.equal(r.almac, '128GB'); assert.equal(r.modelo, 'iPhone 13'); assert.equal(r.serie, 'F2LXK9QWP4');
});
test('un dígito ilegible se recupera con el dígito de control', () => {
  const r = O.extraerDatosTelefono('IMEI 35 391110 48691? 9');
  assert.equal(r.imei, '353911104869129');
});
test('letras confundidas por el OCR (O→0, I→1, S→5)', () => {
  assert.equal(O.extraerDatosTelefono('IMEI: 35 S467I I2398765').imei, '355467112398765');
});
test('la etiqueta no se come el primer dígito ("IMEI 35…", "IMEI2 35…")', () => {
  assert.equal(O.extraerDatosTelefono('IMEI 355467112398765').imei, '355467112398765');
  assert.equal(O.extraerDatosTelefono('IMEI 35 420963 1123451').imei, '354209631123451');
});
test('batería: iPhone y Android, en la misma línea o en la siguiente', () => {
  assert.equal(O.extraerDatosTelefono('Salud de la batería\nCapacidad máxima 87 %').bateria, 87);
  assert.equal(O.extraerDatosTelefono('Capacidad máxima\n91%').bateria, 91);
  assert.equal(O.extraerDatosTelefono('Battery health 79%').bateria, 79);
  assert.equal(O.extraerDatosTelefono('Estado de la batería: Bueno (85%)').bateria, 85);
  assert.equal(O.extraerDatosTelefono('Capacidad 128 GB').bateria, undefined);
});
test('almacenamiento: etiquetas en español/inglés, Android con 119 GB, TB, y no confunde "Disponible"', () => {
  assert.equal(O.extraerDatosTelefono('Almacenamiento 256 GB').almac, '256GB');
  assert.equal(O.extraerDatosTelefono('Almacenamiento interno\n119 GB').almac, '128GB');
  assert.equal(O.extraerDatosTelefono('Capacity 1 TB').almac, '1TB');
  assert.equal(O.extraerDatosTelefono('Disponible 37,4 GB\nCapacidad 64 GB').almac, '64GB');
  assert.equal(O.extraerDatosTelefono('Capacidad máxima 90 %').almac, undefined);
});
test('sin datos → objeto vacío, sin inventar nada', () => {
  const r = O.extraerDatosTelefono('hola mundo 12345');
  assert.equal(r.imei, undefined); assert.equal(r.bateria, undefined); assert.equal(r.almac, undefined);
});

test('reporte de 3uTools (EN): modelo completo, ciclos, color, serial, batería por capacidades', () => {
  const r = O.extraerDatosTelefono(`Device Report
Device Type: iPhone 16 Pro Max
IMEI: 35 391110 486912 9
Serial Number: F2LXK9ABPRMX
Capacity: 256 GB
Color: Desert Titanium
Cycle Count: 312
Design Capacity: 4685 mAh
Full Charge Capacity: 4123 mAh`);
  assert.equal(r.imei, '353911104869129');
  assert.equal(r.modelo, 'iPhone 16 Pro Max');
  assert.equal(r.serie, 'F2LXK9ABPRMX');
  assert.equal(r.almac, '256GB');
  assert.equal(r.color, 'Desert Titanium');
  assert.equal(r.ciclos, 312);
  assert.equal(r.bateria, 88);   // 4123/4685
});
test('reporte 3uTools (ES): salud de batería en %, ciclos de carga, color', () => {
  const r = O.extraerDatosTelefono(`Modelo: iPhone 14 Pro
Capacidad: 128GB
Color: Morado Oscuro
Salud de la batería: 91%
Ciclos de carga: 148`);
  assert.equal(r.modelo, 'iPhone 14 Pro');
  assert.equal(r.bateria, 91);
  assert.equal(r.ciclos, 148);
  assert.equal(r.color, 'Morado Oscuro');
  assert.equal(r.almac, '128GB');
});
test('nombres completos de iPhone (XS Max, SE, 11)', () => {
  assert.equal(O.extraerDatosTelefono('iPhone XS Max').modelo, 'iPhone XS Max');
  assert.equal(O.extraerDatosTelefono('Modelo iPhone 11').modelo, 'iPhone 11');
  assert.equal(O.extraerDatosTelefono('iPhone SE (2nd gen)').modelo.replace(/\s+/g,' ').startsWith('iPhone SE'), true);
});
