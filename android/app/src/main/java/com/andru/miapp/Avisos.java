package com.andru.miapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.net.Uri;

import org.json.JSONObject;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Notificaciones propias: "¿Qué fue esto?" con 🎙️ Contar / Clasificar / Luego, y avisos simples. */
final class Avisos {
    static final String CANAL = "movimientos", CANAL_REC = "recordatorios";
    private static final Pattern MONTO = Pattern.compile("\\$\\s?([\\d.,]+)");

    private Avisos() {}

    static void canales(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CANAL, "Movimientos de Nequi", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Te pregunto qué fue cada movimiento de plata");
        nm.createNotificationChannel(ch);
        NotificationChannel r = new NotificationChannel(CANAL_REC, "Recordatorios", NotificationManager.IMPORTANCE_DEFAULT);
        r.setDescription("Cobros, resumen y pendientes");
        nm.createNotificationChannel(r);
    }

    static long monto(String t) {
        Matcher m = MONTO.matcher(t);
        if (!m.find()) return 0;
        String s = m.group(1).replaceAll("[.,]\\d{1,2}$", "").replaceAll("\\D", "");
        try { return s.isEmpty() ? 0 : Long.parseLong(s); } catch (NumberFormatException e) { return 0; }
    }

    static String dir(String t) {
        String s = t.toLowerCase(Locale.ROOT);
        if (s.matches(".*(recibi|recibiste|te envi|te lleg|te consign|te pag|abono a tu|entr[oó] plata|llegaron).*")) return "in";
        if (s.matches(".*(enviaste|pagaste|pago en|pago a|compra en|compraste|retir|transferiste|env[ií]o a|enviado a|debitad|saliste).*")) return "out";
        return "?";
    }

    static String plata(long v) { return "$" + String.format(Locale.ROOT, "%,d", v).replace(',', '.'); }

    static PendingIntent abrir(Context c, int code, String accion, String noti, String id) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.setData(Uri.parse("miapp://" + accion + "/" + code));
        i.putExtra("accion", accion);
        if (noti != null) i.putExtra("noti", noti);
        if (id != null) i.putExtra("id", id);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void preguntar(Context c, JSONObject it) {
        canales(c);
        String texto = it.optString("texto"), id = it.optString("id");
        long m = monto(texto);
        String d = dir(texto), p = m > 0 ? " " + plata(m) : "";
        String titulo = "in".equals(d) ? "💰 Te entraron" + p : "out".equals(d) ? "💸 Salieron" + p : "📲 Movimiento" + p;
        int code = id.hashCode() & 0x0fffffff;
        Notification.Builder b = new Notification.Builder(c, CANAL)
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(0xFF0BB877)
                .setContentTitle(titulo + " · ¿qué fue?")
                .setContentText(texto)
                .setStyle(new Notification.BigTextStyle().bigText(texto + "\n\nToca 🎙️ Contar y dime qué fue."))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setContentIntent(abrir(c, code, "voz", texto, id));
        b.addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_mic), "🎙️ Contar", abrir(c, code + 1, "voz", texto, id)).build());
        b.addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_stat), "Clasificar", abrir(c, code + 2, "pend", null, id)).build());
        Intent luego = new Intent(c, AccionReceiver.class);
        luego.setAction("com.andru.miapp.LUEGO");
        luego.putExtra("nid", code);
        b.addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_stat), "Luego",
                PendingIntent.getBroadcast(c, code + 3, luego, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)).build());
        try { c.getSystemService(NotificationManager.class).notify(code, b.build()); } catch (SecurityException ignored) {}
    }

    static void simple(Context c, int nid, String titulo, String texto, String accion) {
        canales(c);
        Notification.Builder b = new Notification.Builder(c, CANAL_REC)
                .setSmallIcon(R.drawable.ic_stat).setColor(0xFF0BB877)
                .setContentTitle(titulo).setContentText(texto)
                .setStyle(new Notification.BigTextStyle().bigText(texto))
                .setAutoCancel(true)
                .setContentIntent(abrir(c, 500000 + nid, accion == null ? "abrir" : accion, null, null));
        try { c.getSystemService(NotificationManager.class).notify(500000 + nid, b.build()); } catch (SecurityException ignored) {}
    }
}
