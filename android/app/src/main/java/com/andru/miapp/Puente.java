package com.andru.miapp;

import android.Manifest;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** window.MiAppNativo: lo que la app web le puede pedir al teléfono. */
public class Puente {
    private final MainActivity a;

    Puente(MainActivity a) { this.a = a; }

    @JavascriptInterface public String version() { return a.version(); }

    /** Movimientos capturados de Nequi que todavía no están en "Por clasificar". */
    @JavascriptInterface public String pendientes() { return Store.cola(a).toString(); }

    @JavascriptInterface public int confirmar(String idsJson) {
        int n = Store.quitar(a, idsJson);
        Log.d("MiApp", "confirmados " + n);
        return n;
    }

    @JavascriptInterface public void listo() { a.runOnUiThread(a::despachar); }

    @JavascriptInterface public String estado() {
        JSONObject o = new JSONObject();
        try {
            String activos = Settings.Secure.getString(a.getContentResolver(), "enabled_notification_listeners");
            ComponentName cn = new ComponentName(a, NotiListener.class);
            o.put("leerNotis", activos != null && activos.contains(cn.flattenToString()));
            NotificationManager nm = a.getSystemService(NotificationManager.class);
            boolean permiso = Build.VERSION.SDK_INT < 33 || a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            o.put("avisos", permiso && nm != null && nm.areNotificationsEnabled());
            PowerManager pm = a.getSystemService(PowerManager.class);
            o.put("bateria", pm != null && pm.isIgnoringBatteryOptimizations(a.getPackageName()));
            o.put("marca", Build.MANUFACTURER);
            o.put("android", Build.VERSION.SDK_INT);
            o.put("capturas", Store.total(a));
            o.put("ultimaApp", Store.ultima(a));
            o.put("ultimaT", Store.ultimaT(a));
            o.put("version", a.version());
        } catch (Exception ignored) {}
        return o.toString();
    }

    /** Abre los ajustes del teléfono que hacen falta (una sola vez). */
    @JavascriptInterface public void abrir(String que) {
        a.runOnUiThread(() -> {
            String pkg = a.getPackageName();
            try {
                switch (que == null ? "" : que) {
                    case "leerNotis":
                        a.startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
                        break;
                    case "avisos":
                        if (Build.VERSION.SDK_INT >= 33 && a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                                && !a.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
                            a.pedirPermisoNotis();
                        } else {
                            a.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg));
                        }
                        break;
                    case "bateria":
                        try {
                            a.startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg)));
                        } catch (Exception e) {
                            a.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                        }
                        break;
                    case "autoinicio":
                        try {
                            Intent i = new Intent();
                            i.setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
                            a.startActivity(i);
                        } catch (Exception e) {
                            a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)));
                        }
                        break;
                    default:
                        a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)));
                }
            } catch (Exception e) {
                Log.e("MiApp", "abrir " + que, e);
                try { a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg))); } catch (Exception ignored) {}
            }
        });
    }

    /** Dictado con el reconocedor de Google (en la app no existe el del navegador). */
    @JavascriptInterface public void escuchar(String cb) { a.runOnUiThread(() -> a.escuchar(cb)); }

    /** Simula una notificación de Nequi para probar todo el camino. */
    @JavascriptInterface public void probar() {
        JSONObject it = Store.agregar(a, "prueba.nequi", "Nequi Recibiste $1.000 de PRUEBA MI APP", System.currentTimeMillis());
        if (it != null) Avisos.preguntar(a, it);
    }

    @JavascriptInterface public void aviso(int id, String titulo, String texto, String accion) { Avisos.simple(a, id, titulo, texto, accion); }

    /** Guarda un archivo (respaldo) en Descargas. */
    @JavascriptInterface public boolean guardarArchivo(String nombre, String contenido) {
        if (Build.VERSION.SDK_INT < 29) return false;
        try {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, nombre);
            v.put(MediaStore.Downloads.MIME_TYPE, "application/json");
            ContentResolver cr = a.getContentResolver();
            Uri u = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (u == null) return false;
            try (OutputStream os = cr.openOutputStream(u)) {
                if (os == null) return false;
                os.write(contenido.getBytes(StandardCharsets.UTF_8));
            }
            return true;
        } catch (Exception e) {
            Log.e("MiApp", "guardarArchivo", e);
            return false;
        }
    }
}
