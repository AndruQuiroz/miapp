#!/bin/bash
# Prueba de humo en el emulador: instala, abre, simula una notificación de Nequi y revisa que llegue a "Por clasificar".
set -x
OUT=out; mkdir -p $OUT
PKG=com.andru.miapp
cdp() { python3 android/ci/cdp.py "$1"; }
foto() { adb exec-out screencap -p > "$OUT/$1.png"; }

adb install -r $OUT/MiApp.apk || { echo "INSTALAR_FALLO" > $OUT/resultado.txt; exit 1; }
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
adb shell cmd notification allow_listener $PKG/$PKG.NotiListener
adb shell am start -n $PKG/.MainActivity
sleep 30
PID=$(adb shell pidof $PKG | tr -d '\r')
adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
foto 1-abre
cdp "document.title + ' | nativo=' + (typeof MiAppNativo) + ' | ' + (window.MiAppNativo ? MiAppNativo.estado() : '')" > $OUT/estado.txt
# saltar la bienvenida para ver la app
cdp "CFG.onboarded=true;saveCfg();location.reload();'ok'"
sleep 12
foto 2-inicio

# notificación falsa de Nequi (la publica el shell)
adb shell "cmd notification post -S bigtext -t 'Nequi' prueba1 'Recibiste \$1.600.000 de CAMILO PEREZ'"
sleep 6
adb shell cmd statusbar expand-notifications
sleep 3
foto 3-cortina
adb shell cmd statusbar collapse
sleep 2

# volver a la app como si tocara "Clasificar"
adb shell am start -n $PKG/.MainActivity --es accion pend
sleep 10
foto 4-pendientes
cdp "JSON.stringify(L(DB,'pend').map(p=>({monto:p.monto,dir:p.dir,quien:p.quien,raw:p.raw})))" > $OUT/pend.json
cdp "MiAppNativo.pendientes()" > $OUT/cola-nativa.json

# "🎙️ Contar" desde la notificación
adb shell am start -n $PKG/.MainActivity --es accion voz --es noti "Nequi Recibiste \$1.600.000 de CAMILO PEREZ"
sleep 6
foto 5-contar
cdp "document.querySelector('#sheetTitle') ? document.querySelector('#sheetTitle').textContent : 'sin hoja'" > $OUT/hoja.txt

# botón de la cortina (tile) → abre en modo voz
adb shell cmd statusbar click-tile $PKG/.VozTile || true
sleep 6
foto 6-tile

adb logcat -d -s MiApp:V > $OUT/logcat.txt
adb shell dumpsys notification --noredact | grep -B2 -A12 "pkg=$PKG" | head -120 > $OUT/notis.txt
if grep -q 1600000 $OUT/pend.json; then echo "OK_CAPTURA" > $OUT/resultado.txt; else echo "FALLO_CAPTURA" > $OUT/resultado.txt; fi
cat $OUT/resultado.txt $OUT/estado.txt $OUT/pend.json $OUT/hoja.txt
