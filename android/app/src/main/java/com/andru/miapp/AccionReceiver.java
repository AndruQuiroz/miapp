package com.andru.miapp;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** "Luego": quita el aviso; el movimiento queda en la cola y aparece en "Por clasificar" al abrir la app. */
public class AccionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(i.getIntExtra("nid", 0));
    }
}
