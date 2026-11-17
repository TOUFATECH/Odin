package com.toufatech.agora.appli

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.toufatech.agora.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File

/**
 * Installer et désinstaller avec PackageInstaller (documentation d'Android, PackageInstaller et SessionParams) :
 *  - une appli ordinaire (permission REQUEST_INSTALL_PACKAGES) : Android rend STATUS_PENDING_USER_ACTION et la personne
 *    confirme d'un toucher (fenêtre d'Android « Installer ») ; Agora ne peut pas la contourner ;
 *  - une MISE À JOUR d'une appli qu'Agora a installée peut se faire sans toucher (Android 12 et plus,
 *    USER_ACTION_NOT_REQUIRED, si l'appli vise un Android assez récent) ;
 *  - si Agora est PROPRIÉTAIRE DE L'APPAREIL (mode « géré par Odin », voir [Gestion]) : tout se fait sans toucher.
 * Le fichier est vérifié (empreinte SHA-256) AVANT d'arriver ici (coeur/Store.kt, Regles.copierVerifie).
 */
object Installeur {
    const val ACTION = "com.toufatech.agora.RESULTAT"

    private fun retour(c: Context, element: String, ordre: String?, sens: String, code: Int): PendingIntent {
        val i = Intent(c, RecepteurInstallation::class.java).setAction(ACTION).setPackage(c.packageName)
            .putExtra("element", element).putExtra("ordre", ordre).putExtra("sens", sens)
        // Android 14+ : le résultat de PackageInstaller est ajouté à l'intention : elle doit être modifiable.
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
    }

    fun installer(c: Context, apk: File, element: String, ordre: String?) {
        val pi = c.packageManager.packageInstaller
        val p = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        if (Build.VERSION.SDK_INT >= 31) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        if (Build.VERSION.SDK_INT >= 34) p.setPackageSource(PackageInstaller.PACKAGE_SOURCE_STORE)
        p.setSize(apk.length())
        val id = pi.createSession(p)
        pi.openSession(id).use { s ->
            s.openWrite("agora.apk", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; s.fsync(out) }
            s.commit(retour(c, element, ordre, "installer", id).intentSender)
        }
        apk.delete()
    }

    fun desinstaller(c: Context, paquet: String, element: String, ordre: String?) {
        c.packageManager.packageInstaller.uninstall(paquet, retour(c, element, ordre, "desinstaller", paquet.hashCode()).intentSender)
    }

    /** Une installation attend le toucher de la personne : on ouvre la fenêtre d'Android (ou une notification si Agora est en arrière-plan). */
    fun demanderToucher(c: Context, confirmation: Intent, element: String, nom: String) {
        Agora.etat.update { it.copy(attente = it.attente + element, message = "$nom va s'installer : touche « Installer » dans la fenêtre d'Android pour finir.") }
        if (MainActivity.auPremierPlan) { c.startActivity(confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return }
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("installations", "Installations du store", NotificationManager.IMPORTANCE_HIGH))
        val pi = PendingIntent.getActivity(c, element.hashCode(), confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(c, "installations").setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("$nom est prête à s'installer").setContentText("Touche pour confirmer l'installation (demandée par Odin).")
            .setContentIntent(pi).setAutoCancel(true).build()
        try { NotificationManagerCompat.from(c).notify(element.hashCode(), n) } catch (_: SecurityException) { /* notifications refusées : l'écran du store le dit */ }
    }
}

/** Le résultat d'une installation ou d'une désinstallation : rendu à Odin (installée, absente, erreur). */
class RecepteurInstallation : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val element = i.getStringExtra("element") ?: return; val ordre = i.getStringExtra("ordre"); val sens = i.getStringExtra("sens") ?: "installer"
        val nom = Agora.etat.value.articles.firstOrNull { it.id == element }?.nom ?: element
        if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION") val conf = (if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else i.getParcelableExtra(Intent.EXTRA_INTENT)) ?: return
            Installeur.demanderToucher(c, conf, element, nom); return
        }
        val fin = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val cl = Agora.client
                Agora.etat.update { it.copy(attente = it.attente - element, enCours = it.enCours - element) }
                if (st == PackageInstaller.STATUS_SUCCESS) {
                    i.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME)?.let { Agora.retenirPaquet(c, element, it) }
                    val a = Agora.etat.value.articles.firstOrNull { it.id == element }
                    val inst = a?.let { Agora.installee(c, it) }
                    Agora.noter(if (sens == "desinstaller") "$nom désinstallée." else "$nom ${inst?.version ?: ""} installée.")
                    cl?.etat(element, if (sens == "desinstaller") "absente" else "installee", ordre, version = inst?.version ?: a?.paquet?.version)
                } else {
                    val m = when (st) { PackageInstaller.STATUS_FAILURE_ABORTED -> "installation annulée sur le téléphone"; PackageInstaller.STATUS_FAILURE_STORAGE -> "plus assez de place"; PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "appli incompatible avec ce téléphone"; PackageInstaller.STATUS_FAILURE_CONFLICT -> "conflit avec une appli déjà installée (signature différente ?)"; PackageInstaller.STATUS_FAILURE_BLOCKED -> "installation bloquée par le téléphone"; else -> i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "échec ($st)" }
                    Agora.etat.update { it.copy(erreurs = it.erreurs + (element to m)) }; Agora.noter("$nom : $m")
                    cl?.etat(element, "erreur", ordre, erreur = m)
                }
                Agora.etat.update { it.copy(installees = it.articles.mapNotNull { a -> Agora.installee(c, a)?.let { x -> a.id to x } }.toMap()) }
            } catch (_: Exception) { /* hors ligne : l'inventaire du prochain démarrage rattrapera */ } finally { fin.finish() }
        }
    }
}

/**
 * Mode « géré par Odin » (Android Enterprise) : Agora devient PROPRIÉTAIRE DE L'APPAREIL. Alors installations et
 * désinstallations imposées se font sans toucher. Cela se fait sur un téléphone remis à zéro, par un ordinateur :
 *   adb shell dpm set-device-owner com.toufatech.agora/.appli.Gestion
 * (ou par l'enrôlement Android Enterprise / QR code d'un vrai système de gestion). Agora n'impose AUCUNE autre règle au
 * téléphone. Pour en sortir : Réglages d'Agora → « Ne plus gérer ce téléphone » (clearDeviceOwnerApp).
 */
class Gestion : DeviceAdminReceiver() {
    companion object {
        fun gere(c: Context): Boolean = c.getSystemService(DevicePolicyManager::class.java)?.isDeviceOwnerApp(c.packageName) == true
        @Suppress("DEPRECATION") fun quitter(c: Context) { if (gere(c)) c.getSystemService(DevicePolicyManager::class.java)?.clearDeviceOwnerApp(c.packageName) }
    }
}

/** Au démarrage du téléphone : le service du store reprend (le flux des ordres d'Odin). */
class RecepteurDemarrage : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) { if (i.action == Intent.ACTION_BOOT_COMPLETED && Agora.prefs(c).getString("session", null) != null) ServiceStore.demarrer(c) }
}
