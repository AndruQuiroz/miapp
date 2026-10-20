package com.andru.miapp;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** Widget de la pantalla de inicio: caja, por clasificar, te deben y botones 🎙️ / 📋 / 💬. */
public class Widget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) { actualizar(c); }

    static void actualizar(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            ComponentName cn = new ComponentName(c, Widget.class);
            int[] ids = m.getAppWidgetIds(cn);
            if (ids == null || ids.length == 0) return;
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
            JSONObject r = Store.resumen(c);
            boolean plata = r.optBoolean("widgetPlata", true);
            int pend = r.optInt("pend", 0) + Store.cola(c).length();
            long deben = r.optLong("deben", 0);
            if (r.has("caja")) v.setTextViewText(R.id.w_caja, plata ? "caja " + Avisos.plataCorta(r.optLong("caja")) : "caja ••••");
            String linea;
            if (!r.has("caja")) linea = "Abre la app una vez para ver tus datos";
            else {
                StringBuilder sb = new StringBuilder();
                sb.append(pend > 0 ? "📲 " + pend + " por clasificar" : "✅ Todo clasificado");
                if (deben > 0) sb.append(" · 🤝 te deben ").append(plata ? Avisos.plataCorta(deben) : "••••");
                int venc = r.optInt("vencidos", 0);
                if (venc > 0) sb.append(" · ⏰ ").append(venc).append(venc == 1 ? " cobro vencido" : " cobros vencidos");
                linea = sb.toString();
            }
            v.setTextViewText(R.id.w_linea, linea);
            v.setTextViewText(R.id.w_pend, pend > 0 ? "📋 " + pend : "📋");
            v.setOnClickPendingIntent(R.id.w_voz, Avisos.abrir(c, 9101, "voz", null, null));
            v.setOnClickPendingIntent(R.id.w_pend, Avisos.abrir(c, 9102, "pend", null, null));
            v.setOnClickPendingIntent(R.id.w_asis, Avisos.abrir(c, 9103, "asis", null, null));
            v.setOnClickPendingIntent(R.id.w_raiz, Avisos.abrir(c, 9104, "abrir", null, null));
            m.updateAppWidget(cn, v);
        } catch (Exception ignored) {}
    }
}
