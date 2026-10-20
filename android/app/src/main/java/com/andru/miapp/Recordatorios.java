package com.andru.miapp;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Recordatorios del teléfono (sin abrir la app): diario 9 a. m. y resumen del domingo 7 p. m. */
public class Recordatorios extends BroadcastReceiver {
    static final String DIARIO = "com.andru.miapp.DIARIO", SEMANAL = "com.andru.miapp.SEMANAL";

    @Override
    public void onReceive(Context c, Intent i) {
        String a = i.getAction() == null ? "" : i.getAction();
        Log.d("MiApp", "recordatorio " + a);
        if (DIARIO.equals(a)) diario(c, false);
        else if (SEMANAL.equals(a)) semanal(c, false);
        else programar(c);   // BOOT_COMPLETED / MY_PACKAGE_REPLACED
        Widget.actualizar(c);
    }

    private static PendingIntent pi(Context c, String accion, int code) {
        Intent i = new Intent(c, Recordatorios.class).setAction(accion);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static long proxima(int diaSemana, int hora) {
        Calendar k = Calendar.getInstance();
        k.set(Calendar.HOUR_OF_DAY, hora);
        k.set(Calendar.MINUTE, 0);
        k.set(Calendar.SECOND, 0);
        k.set(Calendar.MILLISECOND, 0);
        if (diaSemana > 0) {
            while (k.get(Calendar.DAY_OF_WEEK) != diaSemana || k.getTimeInMillis() <= System.currentTimeMillis()) k.add(Calendar.DAY_OF_MONTH, 1);
        } else if (k.getTimeInMillis() <= System.currentTimeMillis()) k.add(Calendar.DAY_OF_MONTH, 1);
        return k.getTimeInMillis();
    }

    /** Programa (o quita) las alarmas según lo que el usuario dejó prendido en Ajustes. */
    static void programar(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return;
        JSONObject r = Store.resumen(c);
        PendingIntent d = pi(c, DIARIO, 1), s = pi(c, SEMANAL, 2);
        am.cancel(d);
        am.cancel(s);
        if (r.optBoolean("recDiario", true)) am.setInexactRepeating(AlarmManager.RTC_WAKEUP, proxima(0, 9), AlarmManager.INTERVAL_DAY, d);
        if (r.optBoolean("recSemana", true)) am.setInexactRepeating(AlarmManager.RTC_WAKEUP, proxima(Calendar.SUNDAY, 19), AlarmManager.INTERVAL_DAY * 7, s);
    }

    static String hoy() { return new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date()); }

    /** Líneas del día, calculadas HOY con los datos que la app dejó (cobros con fecha, pendientes, último registro). */
    static List<String> lineasDelDia(Context c) {
        JSONObject r = Store.resumen(c);
        List<String> l = new ArrayList<>();
        String t = hoy();
        JSONArray cobros = r.optJSONArray("cobros");
        if (cobros != null) for (int k = 0; k < cobros.length(); k++) {
            JSONObject x = cobros.optJSONObject(k);
            if (x == null) continue;
            String f = x.optString("compromiso", "");
            if (f.isEmpty() || f.compareTo(t) > 0) continue;
            String quien = x.optString("nombre", "Alguien");
            String cuanto = Avisos.plata(x.optLong("pend"));
            l.add(f.equals(t) ? "🤝 " + quien + " prometió pagarte hoy: " + cuanto : "🤝 " + quien + " debía pagarte el " + f.substring(8, 10) + "/" + f.substring(5, 7) + ": " + cuanto);
        }
        int pend = r.optInt("pend", 0) + Store.cola(c).length();
        if (pend > 0) l.add("📲 Tienes " + pend + (pend == 1 ? " movimiento" : " movimientos") + " por clasificar");
        long ultimo = r.optLong("ultimoRegistro", 0);
        if (ultimo > 0) {
            long dias = (System.currentTimeMillis() - ultimo) / 86400000L;
            if (dias >= 3) l.add("📝 Llevas " + dias + " días sin registrar nada. ¿Compraste, vendiste o gastaste algo?");
        }
        JSONArray extra = r.optJSONArray("extra");
        if (extra != null) for (int k = 0; k < extra.length(); k++) l.add(extra.optString(k));
        return l;
    }

    static boolean diario(Context c, boolean prueba) {
        List<String> l = lineasDelDia(c);
        if (l.isEmpty()) {
            if (!prueba) return false;
            l.add("✅ Todo al día: nada vencido ni por clasificar.");
        }
        int pend = Store.resumen(c).optInt("pend", 0) + Store.cola(c).length();
        Avisos.simple(c, 1, "☀️ Mi App · tu día", String.join("\n", l), pend > 0 ? "pend" : "abrir");
        return true;
    }

    static boolean semanal(Context c, boolean prueba) {
        JSONObject r = Store.resumen(c);
        String s = r.optString("semana", "");
        if (s.isEmpty()) {
            if (!prueba) return false;
            s = "Abre la app para calcular tu semana.";
        }
        long act = r.optLong("actualizado", 0);
        long dias = act > 0 ? (System.currentTimeMillis() - act) / 86400000L : 0;
        if (dias >= 2) s += "\n(datos de hace " + dias + " días: abre la app para actualizarlos)";
        Avisos.simple(c, 2, "📊 Tu semana", s, "abrir");
        return true;
    }
}
