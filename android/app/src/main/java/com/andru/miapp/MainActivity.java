package com.andru.miapp;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.util.ArrayList;

/** Mi App dentro de Android: carga la app web (se actualiza sola) y le da lo que el navegador no puede. */
public class MainActivity extends Activity {
    static final String HOST = "andruquiroz.github.io";
    static final String URL_APP = "https://" + HOST + "/miapp/?app=1";
    static final int REQ_FILE = 11, REQ_VOZ = 12, REQ_PERM = 13;

    WebView web;
    ValueCallback<Uri[]> fileCb;
    String vozCb;
    String eventoPendiente;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0B0F14"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " MiAppAndroid/" + version());
        web.addJavascriptInterface(new Puente(this), "MiAppNativo");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException ignored) {}
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    v.loadDataWithBaseURL(null, "<html><body style='background:#0B0F14;color:#e6edf3;font-family:sans-serif;padding:32px;text-align:center'>"
                            + "<h2>Sin conexión</h2><p>La primera vez Mi App necesita internet para cargar. Después funciona sin señal.</p>"
                            + "<p><a style='color:#0BB877;font-size:20px' href='" + URL_APP + "'>Reintentar</a></p></body></html>", "text/html", "utf-8", null);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = params.createIntent();
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "Elegir"), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d("MiApp", "js: " + m.message());
                return true;
            }
        });

        Avisos.canales(this);
        pedirPermisoNotis();
        eventoPendiente = eventoDe(getIntent());
        Log.d("MiApp", "onCreate (recreada=" + (saved != null) + ")");
        web.loadUrl(URL_APP);   // siempre carga la app: los datos viven en el almacenamiento de la página, no en el estado de la pantalla
    }

    String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    void pedirPermisoNotis() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_PERM);
        }
    }

    static String eventoDe(Intent i) {
        if (i == null) return null;
        String accion = i.getStringExtra("accion");
        if (accion == null) return null;
        try {
            JSONObject o = new JSONObject();
            o.put("accion", accion);
            if (i.getStringExtra("noti") != null) o.put("noti", i.getStringExtra("noti"));
            if (i.getStringExtra("id") != null) o.put("id", i.getStringExtra("id"));
            return o.toString();
        } catch (Exception e) {
            return null;
        }
    }

    /** Entrega el evento (abrir micrófono, clasificar…) a la app web cuando esté lista. */
    void despachar() {
        if (eventoPendiente == null || web == null) return;
        final String ev = eventoPendiente;
        eventoPendiente = null;   // se entrega UNA vez; si la página aún no estaba lista, se reintenta cuando avise listo()
        web.evaluateJavascript("(function(){try{if(window.miappNativoEvento){miappNativoEvento(" + ev + ");return 'ok'}return 'no'}catch(e){return 'error: '+e}})()", r -> {
            Log.d("MiApp", "evento " + ev + " → " + r);
            if ("\"no\"".equals(r) && eventoPendiente == null) eventoPendiente = ev;
        });
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        String ev = eventoDe(i);
        if (ev != null) {
            eventoPendiente = ev;
            despachar();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("(function(){try{return window.miappNativoSync?String(miappNativoSync()):'sin-funcion'}catch(e){return 'error: '+e}})()", r -> Log.d("MiApp", "sync al volver → " + r));
            despachar();
        }
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        Log.d("MiApp", "onDestroy");
        if (web != null) {
            web.removeJavascriptInterface("MiAppNativo");
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(function(){try{return window.miappAtras&&miappAtras()?'1':'0'}catch(e){return '0'}})()", r -> {
            if (!"\"1\"".equals(r)) {
                if (web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    void escuchar(String cb) {
        if (cb == null || !cb.matches("[A-Za-z0-9_$]+")) return;
        vozCb = cb;
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-CO");
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "es-CO");
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, "¿Qué hiciste?");
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            startActivityForResult(i, REQ_VOZ);
        } catch (ActivityNotFoundException e) {
            llamarJs(cb, null);
        }
    }

    void llamarJs(String cb, String texto) {
        if (cb == null || web == null) return;
        String arg = texto == null ? "null" : JSONObject.quote(texto);
        web.evaluateJavascript("window['" + cb + "']&&window['" + cb + "'](" + arg + ")", null);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_FILE) {
            if (fileCb == null) return;
            Uri[] r = null;
            if (res == RESULT_OK && data != null) {
                ClipData cd = data.getClipData();
                if (cd != null && cd.getItemCount() > 0) {
                    ArrayList<Uri> us = new ArrayList<>();
                    for (int k = 0; k < cd.getItemCount(); k++) us.add(cd.getItemAt(k).getUri());
                    r = us.toArray(new Uri[0]);
                } else if (data.getData() != null) {
                    r = new Uri[]{data.getData()};
                }
            }
            fileCb.onReceiveValue(r);
            fileCb = null;
        } else if (req == REQ_VOZ) {
            String t = null;
            if (res == RESULT_OK && data != null) {
                ArrayList<String> rs = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (rs != null && !rs.isEmpty()) t = rs.get(0);
            }
            llamarJs(vozCb, t == null ? "" : t);
            vozCb = null;
        }
    }
}
