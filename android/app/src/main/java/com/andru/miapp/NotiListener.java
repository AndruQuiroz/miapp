package com.andru.miapp;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONObject;

/** Lee las notificaciones de Nequi (y bancos) y las guarda para "Por clasificar"; luego pregunta "¿qué fue?". */
public class NotiListener extends NotificationListenerService {

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            String pkg = sbn.getPackageName();
            if (getPackageName().equals(pkg)) return;
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            Bundle ex = n.extras;
            if (ex == null) return;
            CharSequence title = ex.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = ex.getCharSequence(Notification.EXTRA_TEXT);
            CharSequence big = ex.getCharSequence(Notification.EXTRA_BIG_TEXT);
            String cuerpo = big != null && big.length() > 0 ? big.toString() : (text == null ? "" : text.toString());
            String texto = ((title == null ? "" : title.toString()) + " " + cuerpo).replaceAll("\\s+", " ").trim();
            if (!Store.esDePlata(pkg, texto)) return;
            JSONObject it = Store.agregar(this, pkg, texto, sbn.getPostTime());
            Log.d("MiApp", "captura " + pkg + " → " + (it == null ? "repetida" : texto));
            if (it != null) Avisos.preguntar(this, it);
        } catch (Exception e) {
            Log.e("MiApp", "captura falló", e);
        }
    }

    @Override
    public void onListenerConnected() { Log.d("MiApp", "listener conectado"); }
}
