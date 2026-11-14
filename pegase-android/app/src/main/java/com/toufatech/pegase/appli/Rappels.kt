package com.toufatech.pegase.appli

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.toufatech.pegase.R
import com.toufatech.pegase.coeur.Ics
import com.toufatech.pegase.coeur.RendezVous

/** Les rappels de l'agenda : une alarme (inexacte, économe en batterie) par rendez-vous qui a un rappel. */
object Rappels {
    private const val CANAL = "rappels"

    fun creerCanal(ctx: Context) {
        if (Build.VERSION.SDK_INT >= 26) {
            val c = NotificationChannel(CANAL, ctx.getString(R.string.canal_rappels), NotificationManager.IMPORTANCE_HIGH)
            ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(c)
        }
    }

    private fun intention(ctx: Context, r: RendezVous?, id: String): PendingIntent {
        val i = Intent(ctx, RecepteurRappel::class.java).apply {
            putExtra("id", id)
            if (r != null) {
                putExtra("titre", r.titre)
                putExtra("texte", listOfNotNull(Ics.instant(r.debut)?.let { java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(it.toEpochMilli())) }, r.lieu).joinToString(" · "))
            }
        }
        return PendingIntent.getBroadcast(ctx, id.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Recalcule toutes les alarmes (après chaque changement de l'agenda, d'ici ou d'un autre appareil). */
    fun planifier(ctx: Context, rdvs: List<RendezVous>, supprimes: List<String>, maintenant: Long) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        for (id in supprimes) am.cancel(intention(ctx, null, id))
        for (r in rdvs) {
            val pi = intention(ctx, r, r.id)
            val debut = Ics.instant(r.debut)?.toEpochMilli()
            val quand = if (r.rappel != null && debut != null) debut - r.rappel * 60_000L else null
            if (quand == null || quand < maintenant) {
                am.cancel(pi)
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, quand, pi)
            }
        }
    }

    fun montrer(ctx: Context, id: String, titre: String, texte: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val n = NotificationCompat.Builder(ctx, CANAL)
            .setSmallIcon(R.drawable.ic_launcher_avant)
            .setContentTitle(titre)
            .setContentText(texte.ifBlank { "Rendez-vous à venir" })
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(id.hashCode(), n)
        } catch (e: SecurityException) {
            // Notifications refusées : rien à faire.
        }
    }
}

class RecepteurRappel : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Rappels.montrer(ctx, intent.getStringExtra("id") ?: "rdv", intent.getStringExtra("titre") ?: "Rendez-vous", intent.getStringExtra("texte") ?: "")
    }
}
