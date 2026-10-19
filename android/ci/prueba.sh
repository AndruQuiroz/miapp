#!/bin/bash
# Prueba de humo en el emulador: instala, abre, simula una notificación de Nequi y revisa que llegue a "Por clasificar".
set -x
OUT=out; mkdir -p $OUT
PKG=com.andru.miapp
cdp() { python3 android/ci/cdp.py "$1"; }
foto() { adb exec-out screencap -p > "$OUT/$1.png"; python3 android/ci/cdp.py "SHOT:$OUT/$1-web.png" || true; }
info() { cdp "JSON.stringify({vista: UI.view, onb: UI.onb, hoja: (document.querySelector('#sheetTitle')||{}).textContent || '', errores: window.__errs || [], texto: document.body.innerText.slice(0, 300)})"; }

adb install -r $OUT/MiApp.apk || { echo "INSTALAR_FALLO" > $OUT/resultado.txt; exit 1; }
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
adb shell cmd notification allow_listener $PKG/$PKG.NotiListener
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity
sleep 25
PID=$(adb shell pidof $PKG | tr -d '\r')
adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | sort -u > $OUT/sockets.txt
SOCK=$(grep -o "webview_devtools_remote_$PID" $OUT/sockets.txt | head -1); [ -z "$SOCK" ] && SOCK=$(tail -1 $OUT/sockets.txt)
adb forward tcp:9222 localabstract:$SOCK
foto 1-abre
cdp "document.title + ' | nativo=' + (typeof MiAppNativo) + ' | ' + (window.MiAppNativo ? MiAppNativo.estado() : '')" > $OUT/estado.txt
info > $OUT/info-1.txt
# bienvenida: "Es mi primera vez" con saldos, como lo haría él
cdp "document.querySelector('[data-testid=onb-first]').click(); 'ok'"
sleep 1
cdp "(function(){const s=(q,v)=>{const e=document.querySelector(q); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));}; s('[data-testid=onb-efectivo]','0'); s('[data-testid=onb-nequi]','3000000'); document.querySelector('[data-testid=onb-save]').click(); return 'ok'})()"
sleep 3
foto 2-inicio
info > $OUT/info-2.txt

# notificación falsa de Nequi (la publica el shell)
adb shell "cmd notification post -S bigtext -t 'Nequi' prueba1 'Recibiste \$1.600.000 de CAMILO PEREZ'"
sleep 6
adb shell cmd statusbar expand-notifications
sleep 3
adb exec-out screencap -p > $OUT/3-cortina.png
adb shell cmd statusbar collapse
sleep 2

# volver a la app como si tocara "Clasificar"
adb shell "am start -n $PKG/.MainActivity --es accion pend"
sleep 8
foto 4-pendientes
cdp "JSON.stringify(L(DB,'pend').map(p=>({monto:p.monto,dir:p.dir,quien:p.quien,raw:p.raw})))" > $OUT/pend.json
cdp "MiAppNativo.pendientes()" > $OUT/cola-nativa.json
cdp "typeof miappNativoSync + ' ' + typeof miappNativoEvento + ' ' + APP_VERSION" > $OUT/funciones.txt
cdp "String(miappNativoSync())" > $OUT/sync-directo.txt
cdp "JSON.stringify(L(DB,'pend').map(p=>p.monto))" > $OUT/pend-despues.txt
info > $OUT/info-4.txt

# "🎙️ Contar" desde la notificación
adb shell "am start -n $PKG/.MainActivity --es accion voz --es noti 'Nequi Recibiste \$1.600.000 de CAMILO PEREZ' --es id x1"
sleep 6
foto 5-contar
info > $OUT/info-5.txt

# botón de la cortina (tile) → abre en modo voz
adb shell input keyevent KEYCODE_BACK
sleep 1
adb shell cmd statusbar click-tile $PKG/.VozTile || true
sleep 6
foto 6-tile
info > $OUT/info-6.txt
# girar la pantalla (Android recrea la ventana): la app debe seguir funcionando
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
sleep 4
adb shell settings put system user_rotation 0
sleep 4
adb shell "cmd notification post -S bigtext -t 'Nequi' prueba2 'Enviaste \$45.000 a TIENDA X'"
sleep 4
adb shell "am start -n $PKG/.MainActivity --es accion pend"
sleep 6
cdp "JSON.stringify(L(DB,'pend').map(p=>p.monto))" > $OUT/pend-final.json
foto 7-final

adb logcat -d -s MiApp:V > $OUT/logcat.txt
adb logcat -d -b crash > $OUT/crash.txt
adb logcat -d | grep -E "AndroidRuntime|ActivityTaskManager.*$PKG" | tail -60 > $OUT/sistema.txt
adb shell dumpsys notification --noredact | grep -B2 -A12 "pkg=$PKG" | head -120 > $OUT/notis.txt
if grep -q 1600000 $OUT/pend.json; then echo "OK_CAPTURA" > $OUT/resultado.txt; else echo "FALLO_CAPTURA" > $OUT/resultado.txt; fi
cat $OUT/resultado.txt $OUT/estado.txt $OUT/pend.json $OUT/info-*.txt
