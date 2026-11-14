package com.toufatech.pegase.odin

import com.toufatech.pegase.coeur.Cols
import com.toufatech.pegase.coeur.Donnees
import com.toufatech.pegase.coeur.Empreinte
import com.toufatech.pegase.coeur.Empreintes
import com.toufatech.pegase.coeur.Enregistrement
import com.toufatech.pegase.coeur.EtatSynchro
import com.toufatech.pegase.coeur.FileAttente
import com.toufatech.pegase.coeur.Indicateur
import com.toufatech.pegase.coeur.LecteurSse
import com.toufatech.pegase.coeur.Rapprochement
import com.toufatech.pegase.coeur.liste
import com.toufatech.pegase.coeur.objet
import com.toufatech.pegase.coeur.prochaineMaj
import com.toufatech.pegase.coeur.texte
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/** Où ranger les données d'un profil (fichiers chiffrés sur le téléphone, voir stockage/Magasin.kt). */
interface Persistance {
    fun sauverCollection(col: String, liste: List<Enregistrement>)
    fun sauverFile(texte: String)
}

/** Ce que la synchro raconte à l'interface (appelé depuis un fil de fond : l'interface repasse sur son fil). */
interface EcouteSynchro {
    fun changement(cols: Set<String>) {}
    fun indicateur(i: Indicateur) {}
    fun restaure(texte: String) {}
    fun revoque(texte: String) {}
}

/**
 * La synchro en temps réel avec Odin (protocole § 3) :
 * - chaque changement local est rangé, mis en file (sur le disque) et envoyé, regroupés au plus 250 ms ;
 * - le flux SSE apporte aussitôt les changements des autres appareils ;
 * - à chaque connexion et à chaque `verif` (30 s), on compare les empreintes ; si une collection diffère,
 *   on la tire en entier, on prend ce qui manque et on renvoie ce qu'Odin n'a pas.
 * Hors ligne : la file reste sur le disque et se vide au retour.
 */
class MoteurSynchro(
    val donnees: Donnees,
    val file: FileAttente,
    private val persistance: Persistance,
    private val horloge: Horloge = HORLOGE_SYSTEME,
    private val ecoute: EcouteSynchro = object : EcouteSynchro {},
) {
    @Volatile
    var api: ApiPegase? = null
        private set

    /** L'identifiant de cet appareil chez Odin (appris par l'évènement `bonjour` du flux). */
    @Volatile
    var appareil: String = "local"
        private set

    private val travail: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "pegase-synchro").apply { isDaemon = true }
    }
    private var envoiPrevu: ScheduledFuture<*>? = null
    private val sales = HashSet<String>()
    private var sauvegardePrevue: ScheduledFuture<*>? = null

    @Volatile
    private var actif = false
    private var filFlux: Thread? = null

    @Volatile
    private var connexionFlux: HttpURLConnection? = null

    @Volatile
    var indicateur = Indicateur(EtatSynchro.SANS_ODIN, 0)
        private set

    private fun annoncer(etat: EtatSynchro) {
        val i = Indicateur(if (api == null) EtatSynchro.SANS_ODIN else etat, file.taille)
        indicateur = i
        ecoute.indicateur(i)
    }

    // ------------------------------------------------------------------ changements locaux

    /** Un changement fait sur ce téléphone (favori, onglet, réglage…). */
    fun modifier(col: String, id: String, data: Map<String, Any?>): Enregistrement =
        local(col, id, data, false)

    fun supprimer(col: String, id: String): Enregistrement = local(col, id, emptyMap(), true)

    private fun local(col: String, id: String, data: Map<String, Any?>, suppr: Boolean): Enregistrement {
        require(Cols.connue(col)) { "Collection inconnue : $col" }
        require(Enregistrement.idValide(id)) { "Identifiant invalide : $id" }
        val e = synchronized(donnees) {
            val e = Enregistrement(id, col, data, prochaineMaj(horloge.maintenant(), donnees.un(col, id)), appareil, suppr)
            donnees.appliquer(e)
            e
        }
        file.ajouter(e)
        marquer(setOf(col))
        persistance.sauverFile(file.versJson())
        ecoute.changement(setOf(col))
        prevoirEnvoi(250)
        return e
    }

    /** Range sur le disque les collections changées (regroupé : une écriture par demi-seconde au plus). */
    private fun marquer(cols: Set<String>) {
        synchronized(sales) {
            sales += cols
            if (sauvegardePrevue == null) {
                sauvegardePrevue = travail.schedule({ ranger() }, 500, TimeUnit.MILLISECONDS)
            }
        }
    }

    private fun ranger() {
        val cols = synchronized(sales) {
            sauvegardePrevue = null
            val c = sales.toSet()
            sales.clear()
            c
        }
        for (c in cols) persistance.sauverCollection(c, donnees.tous(c))
    }

    /** Écrit tout de suite ce qui attend (à appeler quand l'appli passe en arrière-plan). */
    fun rangerMaintenant() {
        travail.submit { ranger() }.get(5, TimeUnit.SECONDS)
    }

    private fun prevoirEnvoi(delaiMs: Long) {
        synchronized(this) {
            if (envoiPrevu?.isDone == false) return
            envoiPrevu = travail.schedule({ vider() }, delaiMs, TimeUnit.MILLISECONDS)
        }
    }

    // ------------------------------------------------------------------ reçus d'Odin

    private fun appliquerRecus(liste: List<Enregistrement>) {
        if (liste.isEmpty()) return
        val changees = HashSet<String>()
        for (e in liste) if (donnees.appliquer(e)) changees += e.col
        if (changees.isNotEmpty()) {
            marquer(changees)
            ecoute.changement(changees)
        }
    }

    // ------------------------------------------------------------------ envoi

    /** Vide la file vers Odin, lot par lot (sur le fil de la synchro). */
    private fun vider() {
        val a = api ?: return
        while (actif) {
            val lot = file.lot()
            if (lot.isEmpty()) break
            val r = try {
                a.envoyer(lot)
            } catch (e: ErreurOdin) {
                annoncer(EtatSynchro.HORS_LIGNE)
                if (e.horsLigne) prevoirEnvoi(5_000)
                return
            }
            if (r.statut == 401 || r.statut == 403) {
                annoncer(EtatSynchro.HORS_LIGNE)
                return
            }
            if (r.statut >= 500 || r.statut == 429) {
                annoncer(EtatSynchro.HORS_LIGNE)
                prevoirEnvoi(10_000)
                return
            }
            // 200 : appliqués, ignorés (Odin a plus récent : on prend ses gagnants) ou refusés (mal formés).
            // 400 / 413 sur tout le lot : il ne passera jamais tel quel, on ne bloque pas la file avec.
            file.retirer(lot)
            persistance.sauverFile(file.versJson())
            if (r.ok) appliquerRecus(Enregistrement.listeDeJson(r.corps.liste("gagnants")))
        }
        annoncer(if (file.taille == 0) EtatSynchro.SYNCHRONISE else EtatSynchro.EN_COURS)
    }

    // ------------------------------------------------------------------ vérification « à l'identique »

    /** Compare les empreintes ; tire et renvoie ce qui diffère (sur le fil de la synchro). */
    private fun verifier(distantesDonnees: Map<String, Empreinte>?) {
        val a = api ?: return
        try {
            val distantes = distantesDonnees ?: a.empreintes()
            val differentes = Empreintes.differentes(donnees.empreintes(), distantes)
            if (differentes.isEmpty()) {
                annoncer(if (file.taille == 0) EtatSynchro.SYNCHRONISE else EtatSynchro.EN_COURS)
                if (file.taille > 0) vider()
                return
            }
            annoncer(EtatSynchro.EN_COURS)
            for (col in differentes) {
                val chezOdin = a.tirerTout(col)
                val r = Rapprochement.calculer(donnees.tous(col), chezOdin)
                appliquerRecus(r.aAppliquer)
                for (e in r.aEnvoyer) file.ajouter(e)
            }
            persistance.sauverFile(file.versJson())
            vider()
            val apres = Empreintes.differentes(donnees.empreintes(), a.empreintes())
            annoncer(if (apres.isEmpty() && file.taille == 0) EtatSynchro.SYNCHRONISE else EtatSynchro.EN_COURS)
        } catch (e: ErreurOdin) {
            annoncer(EtatSynchro.HORS_LIGNE)
        }
    }

    /** Demande une vérification tout de suite (bouton « Synchroniser » des réglages). */
    fun verifierMaintenant() {
        travail.execute { verifier(null) }
    }

    // ------------------------------------------------------------------ flux

    private fun boucleFlux() {
        var pause = 1_000L
        while (actif) {
            val a = api ?: return
            var c: HttpURLConnection? = null
            try {
                c = a.ouvrirFlux()
                connexionFlux = c
                val statut = c.responseCode
                if (statut == 401) {
                    a.auth.invalider()
                    if (a.auth.session == null) return
                    continue
                }
                if (statut != 200) {
                    annoncer(EtatSynchro.HORS_LIGNE)
                    if (statut == 403) {
                        val m = ApiPegase.lireJson(c.errorStream?.use { String(it.readBytes(), Charsets.UTF_8) } ?: "")
                        a.auth.perdre(m.texte("message") ?: m.texte("erreur") ?: "Odin a refusé l'accès à Pégase.")
                        return
                    }
                    throw java.io.IOException("flux $statut")
                }
                pause = 1_000L
                val lecteur = LecteurSse { ev -> evenement(ev.type, ev.data) }
                BufferedReader(InputStreamReader(c.inputStream, Charsets.UTF_8)).use { r ->
                    while (actif) {
                        val ligne = r.readLine() ?: break
                        lecteur.ligne(ligne)
                    }
                }
            } catch (e: Exception) {
                // Coupure, Odin éteint, ou 70 s sans « verif » : on rouvre après une pause croissante.
                if (!actif) return
                annoncer(EtatSynchro.HORS_LIGNE)
            } finally {
                c?.disconnect()
                connexionFlux = null
            }
            if (!actif) return
            try {
                Thread.sleep(pause)
            } catch (e: InterruptedException) {
                return
            }
            pause = (pause * 2).coerceAtMost(30_000L)
        }
    }

    private fun evenement(type: String, data: String) {
        val m = ApiPegase.lireJson(data)
        when (type) {
            "bonjour" -> {
                m.texte("appareil")?.let { appareil = it }
                travail.execute {
                    vider()
                    verifier(null)
                }
            }
            "changements" -> {
                val l = Enregistrement.listeDeJson(m.liste("changements"))
                travail.execute { appliquerRecus(l) }
            }
            "verif" -> {
                val emp = Empreintes.deJson(m.objet("empreintes"))
                travail.execute { verifier(if (emp.isEmpty()) null else emp) }
            }
            "restaure" -> ecoute.restaure(m.texte("texte") ?: "Les données ont été remises depuis une copie d'Odin.")
            "revoque" -> {
                val texte = m.texte("texte") ?: "Ce téléphone a été déconnecté depuis Odin."
                actif = false
                api?.auth?.perdre(texte)
                ecoute.revoque(texte)
            }
        }
    }

    // ------------------------------------------------------------------ marche / arrêt

    /** Branche la synchro sur Odin (ou la débranche avec null : Pégase marche alors seul sur le téléphone). */
    @Synchronized
    fun demarrer(nouvelle: ApiPegase?) {
        arreterFlux()
        api = nouvelle
        if (nouvelle == null) {
            annoncer(EtatSynchro.SANS_ODIN)
            return
        }
        actif = true
        annoncer(EtatSynchro.EN_COURS)
        filFlux = Thread({ boucleFlux() }, "pegase-flux").apply {
            isDaemon = true
            start()
        }
        prevoirEnvoi(0)
    }

    @Synchronized
    private fun arreterFlux() {
        actif = false
        // Couper la connexion depuis un autre fil peut attendre le fil qui lit (selon l'implémentation de
        // HttpURLConnection) : on la coupe dans un petit fil à part pour ne jamais bloquer l'interface.
        connexionFlux?.let { c -> Thread({ c.disconnect() }, "pegase-flux-fin").apply { isDaemon = true }.start() }
        filFlux?.interrupt()
        filFlux = null
    }

    /** Arrête tout (fermeture du profil) en rangeant ce qui attend. */
    fun arreter() {
        arreterFlux()
        try {
            rangerMaintenant()
        } catch (e: Exception) {
            // rien : la file et les collections ont déjà été écrites au fil de l'eau
        }
        travail.shutdown()
    }

    /** Pour les essais : attend que le fil de la synchro ait tout traité. */
    fun attendre() {
        travail.submit {}.get(10, TimeUnit.SECONDS)
    }
}
