package com.toufatech.agora.appli

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.toufatech.agora.BuildConfig
import com.toufatech.agora.coeur.Decision
import com.toufatech.agora.coeur.EmpreinteFausse
import com.toufatech.agora.coeur.Json
import com.toufatech.agora.coeur.Ordre
import com.toufatech.agora.coeur.Plan
import com.toufatech.agora.coeur.Regles
import com.toufatech.agora.coeur.Store
import com.toufatech.agora.coeur.liste
import com.toufatech.agora.coeur.objet
import com.toufatech.agora.coeur.objets
import com.toufatech.agora.coeur.texte
import com.toufatech.agora.odin.ClientAgora
import com.toufatech.agora.odin.ErreurOdin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import com.toufatech.agora.coeur.Texte

class AgoraApp : Application()

/**
 * Le service du store : inscrit le téléphone, envoie l'inventaire, écoute le flux des ordres d'Odin (reconnexion 1 s,
 * 2 s… 30 s) et les exécute un par un. Il tourne au premier plan (notification « Agora · à jour avec Odin ») : Android
 * ne le coupe pas, et la personne voit qu'il est là.
 */
class ServiceStore : Service() {
    companion object {
        fun demarrer(c: Context) { c.startForegroundService(Intent(c, ServiceStore::class.java)) }
        /** Une action de la personne (écran) passe par la même file que les ordres d'Odin. */
        val file = Channel<Pair<Ordre, String>>(Channel.UNLIMITED)
    }
    private val portee = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("store", getString(com.toufatech.agora.R.string.canal_store), NotificationManager.IMPORTANCE_MIN))
        val n = NotificationCompat.Builder(this, "store").setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle(getString(com.toufatech.agora.R.string.notif_store)).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(1, n)
        if (!lance) { lance = true; portee.launch { boucle() }; portee.launch { executer() } }
        return START_STICKY
    }
    private var lance = false
    override fun onDestroy() { portee.cancel(); super.onDestroy() }

    private suspend fun boucle() {
        var pause = 1000L
        while (portee.isActive) {
            val cl = Agora.reprendre(this) ?: run { Agora.etat.update { it.copy(connexion = "aucune") }; stopSelf(); return }
            try {
                inscrire(cl)
                pause = 1000L
                Agora.etat.update { it.copy(enLigne = true, connexion = "ok", erreur = null) }
                cl.flux({ !portee.isActive }) { ev ->
                    val j = try { Json.objet(ev.data) } catch (_: Exception) { return@flux }
                    when (ev.type) {
                        "ordre" -> Store.ordre(j)?.let { ServiceStore.file.trySend(it to "impose") }
                        "store" -> try { Agora.prendreStore(this, cl.store().corps) } catch (_: Exception) { }
                        "retire" -> { Agora.etat.update { it.copy(connexion = "aucune", erreur = j.texte("message")) }; Agora.oublier(this); stopSelf() }
                    }
                }
            } catch (e: ErreurOdin) {
                if (e.statut == 401) { Agora.oublier(this); Agora.etat.update { it.copy(erreur = e.message) }; stopSelf(); return }
                Agora.etat.update { it.copy(enLigne = false, connexion = "horsligne", erreur = e.message) }
            } catch (e: Exception) { Agora.etat.update { it.copy(enLigne = false, connexion = "horsligne", erreur = "Odin ne répond pas (${e.message}).") } }
            delay(pause); pause = (pause * 2).coerceAtMost(30_000)
        }
    }
    private fun inscrire(cl: ClientAgora) {
        val gere = Gestion.gere(this)
        val r = cl.inscrire(Build.MODEL ?: "Téléphone", "Android ${Build.VERSION.RELEASE}", BuildConfig.VERSION_NAME, gere)
        if (!r.ok) throw ErreurOdin(r.statut, r.code, r.message)
        val p = r.corps.objet("personne")
        Agora.etat.update { it.copy(personne = p?.texte("nom") ?: "", groupes = (p?.liste("groupes") ?: emptyList()).map { x -> x.toString() }, gere = gere) }
        Agora.prendreStore(this, r.corps)
        cl.api("inventaire", mapOf("applis" to Agora.etat.value.installees.map { (id, x) -> mapOf("element" to id, "etat" to "installee", "version" to x.version) }))
        for (o in (r.corps.liste("ordres") ?: emptyList()).objets()) Store.ordre(o)?.let { file.trySend(it to "impose") }
    }
    /** Les ordres (d'Odin) et les demandes (de la personne), un par un. */
    private suspend fun executer() {
        for ((o, par) in file) {
            val cl = Agora.client ?: continue
            val a = Agora.etat.value.articles.firstOrNull { it.id == o.element } ?: run { try { Agora.prendreStore(this, cl.store().corps) } catch (_: Exception) { }; Agora.etat.value.articles.firstOrNull { it.id == o.element } }
            val ordre = if (par == "impose") o.id else null
            try {
                when (val p = Decision.plan(o, a, a?.let { Agora.installee(this, it) }, Gestion.gere(this))) {
                    is Plan.DejaFait -> cl.etat(o.element, p.etat, ordre, version = p.version, par = par)
                    is Plan.Impossible -> { cl.etat(o.element, "erreur", ordre, erreur = p.raison, par = par); Agora.noter("${o.nom} : ${p.raison}") }
                    is Plan.Desinstaller -> { cl.etat(o.element, "desinstallation", ordre, par = par); Installeur.desinstaller(this, p.paquetAndroid, o.element, ordre) }
                    is Plan.Installer -> {
                        cl.etat(o.element, "installation", ordre, progression = 0, par = par)
                        Agora.etat.update { it.copy(enCours = it.enCours + (o.element to 0), erreurs = it.erreurs - o.element) }
                        val (flux, taille) = cl.telecharger(p.paquet.telecharger)
                        val f = File(cacheDir, "agora-${o.element}.apk")
                        var dernier = 0
                        flux.use { Regles.copierVerifie(it, f, p.paquet.sha256, if (taille > 0) taille else p.paquet.taille) { pc -> Agora.etat.update { e -> e.copy(enCours = e.enCours + (o.element to pc * 9 / 10)) }; if (pc - dernier >= 10) { dernier = pc; try { cl.etat(o.element, "installation", ordre, progression = pc * 9 / 10, par = par) } catch (_: Exception) { } } } }
                        Installeur.installer(this, f, o.element, ordre) // la suite arrive dans RecepteurInstallation
                    }
                }
            } catch (e: EmpreinteFausse) {
                Agora.etat.update { it.copy(enCours = it.enCours - o.element, erreurs = it.erreurs + (o.element to (e.message ?: ""))) }; Agora.noter("${o.nom} : ${e.message}")
                try { cl.etat(o.element, "erreur", ordre, erreur = e.message, par = par) } catch (_: Exception) { }
            } catch (e: Exception) {
                val m = Texte.sansChemin(e.message)
                Agora.etat.update { it.copy(enCours = it.enCours - o.element, erreurs = it.erreurs + (o.element to m)) }
                try { cl.etat(o.element, "erreur", ordre, erreur = m, par = par) } catch (_: Exception) { }
            }
        }
    }
}
