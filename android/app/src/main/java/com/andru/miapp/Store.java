package com.andru.miapp;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Cola de notificaciones de plata capturadas, guardada en el teléfono hasta que la app web las recoja. */
final class Store {
    private static final String P = "miapp";
    private static final Pattern PLATA = Pattern.compile("(\\$\\s?\\d)|(\\bCOP\\s?\\d)", Pattern.CASE_INSENSITIVE);
    private static final String[] BANCOS = {"nequi", "bancolombia", "todo1", "daviplata", "davivienda", "bbva", "nubank", "com.nu.", "lulo", "movii", "rappipay", "bancodebogota", "bancodeoccidente", "scotiabank", "colpatria", "itau", "avvillas", "popular", "falabella", "dale"};

    private Store() {}

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(P, Context.MODE_PRIVATE); }

    /** ¿Es una notificación de plata de un banco/billetera? */
    static boolean esDePlata(String pkg, String texto) {
        if (texto == null || !PLATA.matcher(texto).find()) return false;
        String p = pkg == null ? "" : pkg.toLowerCase(Locale.ROOT);
        for (String b : BANCOS) if (p.contains(b)) return true;
        return texto.toLowerCase(Locale.ROOT).contains("nequi");
    }

    static synchronized JSONArray cola(Context c) {
        try { return new JSONArray(prefs(c).getString("cola", "[]")); } catch (JSONException e) { return new JSONArray(); }
    }

    /** Agrega a la cola. Devuelve null si es repetida (misma notificación en los últimos 10 min). */
    static synchronized JSONObject agregar(Context c, String pkg, String texto, long t) {
        SharedPreferences p = prefs(c);
        long ahora = System.currentTimeMillis();
        try {
            JSONObject vistos = new JSONObject(p.getString("vistos", "{}"));
            if (vistos.has(texto) && ahora - vistos.getLong(texto) < 10 * 60 * 1000L) return null;
            JSONObject limpio = new JSONObject();
            Iterator<String> k = vistos.keys();
            while (k.hasNext()) {
                String x = k.next();
                long v = vistos.getLong(x);
                if (ahora - v < 60 * 60 * 1000L) limpio.put(x, v);
            }
            limpio.put(texto, ahora);
            JSONArray cola = cola(c);
            JSONObject it = new JSONObject();
            it.put("id", "n" + t + "_" + Math.abs(texto.hashCode()));
            it.put("t", t);
            it.put("pkg", pkg);
            it.put("texto", texto);
            cola.put(it);
            while (cola.length() > 300) cola.remove(0);
            p.edit().putString("cola", cola.toString()).putString("vistos", limpio.toString())
                    .putInt("total", p.getInt("total", 0) + 1).putString("ultima", pkg).putLong("ultimaT", ahora).apply();
            return it;
        } catch (JSONException e) {
            return null;
        }
    }

    /** Quita de la cola las que la app web ya guardó en "Por clasificar". */
    static synchronized int quitar(Context c, String idsJson) {
        try {
            JSONArray ids = new JSONArray(idsJson);
            Set<String> s = new HashSet<>();
            for (int i = 0; i < ids.length(); i++) s.add(ids.getString(i));
            JSONArray cola = cola(c), nueva = new JSONArray();
            for (int i = 0; i < cola.length(); i++) {
                JSONObject it = cola.getJSONObject(i);
                if (!s.contains(it.optString("id"))) nueva.put(it);
            }
            prefs(c).edit().putString("cola", nueva.toString()).apply();
            return cola.length() - nueva.length();
        } catch (JSONException e) {
            return 0;
        }
    }

    static int total(Context c) { return prefs(c).getInt("total", 0); }
    static String ultima(Context c) { return prefs(c).getString("ultima", ""); }
    static long ultimaT(Context c) { return prefs(c).getLong("ultimaT", 0); }
}
