package com.toufatech.pegase.moteur

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.toufatech.pegase.appli.Pegase
import com.toufatech.pegase.coeur.Adresse
import com.toufatech.pegase.coeur.Cols
import org.json.JSONObject
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.MediaSession
import org.mozilla.geckoview.WebExtension
import org.mozilla.geckoview.WebResponse

/** Un onglet vivant sur ce téléphone : sa page GeckoView (créée quand on en a besoin, mise en veille sinon). */
class OngletVivant(val id: String, val prive: Boolean) {
    var session: GeckoSession? = null
    var url by mutableStateOf("")
    var titre by mutableStateOf("")
    var peutReculer by mutableStateOf(false)
    var peutAvancer by mutableStateOf(false)
    var progression by mutableIntStateOf(100)
    var bloques by mutableIntStateOf(0)
    var securise by mutableStateOf(true)
    var media: MediaSession? = null
    var enLecture by mutableStateOf(false)
    var titreMedia by mutableStateOf<String?>(null)
    var position by mutableStateOf(0f)
    var port: WebExtension.Port? = null
    var dernierUsage: Long = System.currentTimeMillis()

    // La visite en cours (pour l'historique : url, titre, durée).
    var visiteUrl: String? = null
    var visiteDebut: Long = 0
    var bloquesComptes = 0

    fun envoyer(m: JSONObject) {
        try {
            port?.postMessage(m)
        } catch (e: Exception) {
            // la page est partie
        }
    }
}

/**
 * Les onglets : la liste vient de la collection synchronisée `onglets` (ceux de tous les appareils du profil,
 * comme la barre de côté d'Arc) ; chaque onglet ouvert ici a sa page GeckoView. Les onglets privés ne sont
 * jamais synchronisés ni gardés dans l'historique.
 */
class Navigateur(private val pegase: Pegase) {
    private val ui = Handler(Looper.getMainLooper())
    val vivants = mutableStateMapOf<String, OngletVivant>()

    /** L'onglet montré (ou le premier du groupe partagé). */
    var actif by mutableStateOf<String?>(null)
        private set

    /** Les pages l'une sur l'autre (écran partagé) : 2 sur téléphone, 4 sur tablette. Vide = une seule page. */
    val groupe = mutableStateListOf<String>()

    /** Les onglets dont la vidéo te suit en petite fenêtre. */
    val suivent = mutableStateListOf<String>()

    /** Les onglets privés de cette ouverture de Pégase. */
    val prives = mutableStateListOf<String>()

    /** Pour « Demander à Odin » : la réponse de la page à la demande de texte. */
    private val extraits = HashMap<String, (JSONObject) -> Unit>()

    fun vivant(id: String): OngletVivant = vivants.getOrPut(id) { OngletVivant(id, id in prives) }

    fun ongletActif(): OngletVivant? = actif?.let { vivants[it] }

    // ------------------------------------------------------------------ ouvrir, montrer, fermer

    /** Ouvre un nouvel onglet (vide = la page d'accueil de Pégase, avec tes favoris et les idées d'Odin). */
    fun ouvrir(saisie: String = "", prive: Boolean = false): String {
        val url = if (saisie.isBlank()) "" else Adresse.versUrl(saisie, moteurRecherche())
        val id = pegase.nouvelId(if (prive) "prive" else "o")
        if (prive) {
            prives += id
        } else {
            val ordre = (pegase.onglets().maxOfOrNull { it.ordre } ?: 0.0) + 1
            pegase.modifier(Cols.ONGLETS, id, linkedMapOf("url" to url, "titre" to "", "espace" to pegase.espaceActif, "ordre" to ordre))
        }
        val v = vivant(id)
        v.url = url
        montrer(id)
        if (url.isNotEmpty()) session(id).loadUri(url)
        return id
    }

    /** Montre un onglet (sa vidéo arrête alors de te suivre : elle est là, en grand). */
    fun montrer(id: String) {
        val ancien = actif
        if (id in suivent) nePlusSuivre(id)
        if (groupe.isNotEmpty() && id !in groupe) groupe.clear()
        // La vidéo de l'onglet qu'on quitte te suit (comme dans la maquette), s'il y a de la place.
        if (ancien != null && ancien != id && ancien !in groupe) {
            val a = vivants[ancien]
            if (a != null && a.enLecture && suivent.size < pegase.maxPages) suivre(ancien)
        }
        actif = id
        vivant(id).dernierUsage = System.currentTimeMillis()
        pegase.feuille = null
    }

    fun fermer(id: String) {
        terminerVisite(vivants[id])
        vivants.remove(id)?.session?.close()
        suivent.remove(id)
        groupe.remove(id)
        if (groupe.size == 1) groupe.clear()
        if (id in prives) prives.remove(id) else pegase.supprimer(Cols.ONGLETS, id)
        if (actif == id) {
            actif = (groupe.firstOrNull() ?: pegase.onglets().filter { !it.range }.lastOrNull()?.id ?: prives.lastOrNull())
        }
    }

    fun toutFermer() {
        for (v in vivants.values) v.session?.close()
        vivants.clear()
        suivent.clear()
        groupe.clear()
        prives.clear()
        actif = null
    }

    /** Ce qu'on tape dans la barre : une adresse ou une recherche, dans l'onglet montré (ou un nouveau). */
    fun aller(saisie: String) {
        val id = actif
        if (id == null) {
            ouvrir(saisie)
            return
        }
        val url = Adresse.versUrl(saisie, moteurRecherche())
        vivant(id).url = url
        session(id).loadUri(url)
        pegase.feuille = null
    }

    fun moteurRecherche(): String = pegase.reglageTexte("moteur") ?: Adresse.RECHERCHE_DEFAUT

    /** « Ranger » : les onglets du jour non épinglés passent dans « Onglets rangés ». */
    fun ranger() {
        for (o in pegase.onglets()) {
            if (o.epingle || o.range || o.id == actif || o.id in groupe) continue
            val e = pegase.profil?.donnees?.un(Cols.ONGLETS, o.id) ?: continue
            pegase.modifier(Cols.ONGLETS, o.id, e.data + ("range" to true))
            vivants.remove(o.id)?.session?.close()
        }
    }

    fun ressortir(id: String) {
        val e = pegase.profil?.donnees?.un(Cols.ONGLETS, id) ?: return
        pegase.modifier(Cols.ONGLETS, id, e.data - "range")
        montrer(id)
    }

    fun epingler(id: String, oui: Boolean) {
        val e = pegase.profil?.donnees?.un(Cols.ONGLETS, id) ?: return
        pegase.modifier(Cols.ONGLETS, id, e.data + ("epingle" to oui))
    }

    // ------------------------------------------------------------------ écran partagé et vidéos

    /** Ajoute une page à l'écran partagé (l'une sur l'autre). */
    fun partager(id: String) {
        val a = actif ?: return
        if (groupe.isEmpty()) groupe += a
        if (id in groupe) return
        if (groupe.size >= pegase.maxPages) {
            pegase.message = "Au plus ${pegase.maxPages} pages à la fois sur cet écran."
            return
        }
        if (id in suivent) nePlusSuivre(id)
        groupe += id
        pegase.feuille = null
    }

    fun retirerDuGroupe(id: String) {
        groupe.remove(id)
        if (groupe.size <= 1) {
            val reste = groupe.firstOrNull()
            groupe.clear()
            if (reste != null) actif = reste
        } else if (actif == id) {
            actif = groupe.first()
        }
    }

    fun suivre(id: String) {
        if (id in suivent || id in groupe) return
        if (suivent.size >= pegase.maxPages) suivent.removeAt(0).let { vivants[it]?.envoyer(JSONObject().put("type", "video-seule").put("actif", false)) }
        suivent += id
        vivants[id]?.envoyer(JSONObject().put("type", "video-seule").put("actif", true))
    }

    fun nePlusSuivre(id: String, pause: Boolean = false) {
        suivent.remove(id)
        val v = vivants[id] ?: return
        v.envoyer(JSONObject().put("type", "video-seule").put("actif", false))
        if (pause) v.media?.pause()
    }

    // ------------------------------------------------------------------ les pages GeckoView

    /** La page GeckoView d'un onglet, créée (ou réveillée) au besoin. */
    fun session(id: String): GeckoSession {
        val v = vivant(id)
        v.dernierUsage = System.currentTimeMillis()
        v.session?.let { return it }
        val s = GeckoSession(
            GeckoSessionSettings.Builder()
                .usePrivateMode(v.prive)
                .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_MOBILE)
                .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_MOBILE)
                .suspendMediaWhenInactive(false)
                .build(),
        )
        brancher(v, s)
        s.open(Moteur.runtime(pegase.app))
        v.session = s
        if (v.url.isEmpty()) v.url = pegase.onglets().firstOrNull { it.id == id }?.url ?: ""
        if (v.url.isNotEmpty()) s.loadUri(v.url)
        return s
    }

    private fun brancher(v: OngletVivant, s: GeckoSession) {
        s.setNavigationDelegate(object : GeckoSession.NavigationDelegate {
            override fun onLocationChange(
                session: GeckoSession,
                url: String?,
                perms: MutableList<GeckoSession.PermissionDelegate.ContentPermission>,
                hasUserGesture: Boolean,
            ) {
                if (url == null || url == v.url && v.visiteUrl == url) return
                terminerVisite(v)
                v.url = url
                v.bloques = 0
                v.bloquesComptes = 0
                v.visiteUrl = url
                v.visiteDebut = System.currentTimeMillis()
                enregistrerOnglet(v)
            }

            override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) {
                v.peutReculer = canGoBack
            }

            override fun onCanGoForward(session: GeckoSession, canGoForward: Boolean) {
                v.peutAvancer = canGoForward
            }

            override fun onLoadRequest(session: GeckoSession, request: GeckoSession.NavigationDelegate.LoadRequest): GeckoResult<AllowOrDeny>? {
                val u = request.uri
                // Liens vers d'autres applis (tel:, mailto:, intent:…) : le téléphone s'en occupe.
                if (!u.startsWith("http") && !u.startsWith("about:") && !u.startsWith("data:") && !u.startsWith("blob:") &&
                    !u.startsWith("moz-extension:") && !u.startsWith("resource:")
                ) {
                    ui.post { pegase.ouvrirAilleurs(u) }
                    return GeckoResult.deny()
                }
                return null
            }

            override fun onNewSession(session: GeckoSession, uri: String): GeckoResult<GeckoSession>? {
                // Un lien « nouvelle fenêtre » : un nouvel onglet à côté.
                val id = pegase.nouvelId(if (v.prive) "prive" else "o")
                if (v.prive) prives += id else pegase.modifier(
                    Cols.ONGLETS, id,
                    linkedMapOf("url" to uri, "titre" to "", "espace" to pegase.espaceActif, "ordre" to (pegase.onglets().maxOfOrNull { it.ordre } ?: 0.0) + 1),
                )
                val n = vivant(id)
                n.url = uri
                val ns = GeckoSession(GeckoSessionSettings.Builder().usePrivateMode(v.prive).build())
                brancher(n, ns)
                n.session = ns
                ui.post { montrer(id) }
                return GeckoResult.fromValue(ns)
            }
        })
        s.setProgressDelegate(object : GeckoSession.ProgressDelegate {
            override fun onProgressChange(session: GeckoSession, progress: Int) {
                v.progression = progress
            }

            override fun onSecurityChange(session: GeckoSession, securityInfo: GeckoSession.ProgressDelegate.SecurityInformation) {
                v.securise = securityInfo.isSecure
            }

            override fun onPageStop(session: GeckoSession, success: Boolean) {
                v.progression = 100
            }
        })
        s.setContentDelegate(object : GeckoSession.ContentDelegate {
            override fun onTitleChange(session: GeckoSession, title: String?) {
                v.titre = title ?: ""
                enregistrerOnglet(v)
            }

            override fun onExternalResponse(session: GeckoSession, response: WebResponse) {
                pegase.telechargements.recevoir(response)
            }

            override fun onCloseRequest(session: GeckoSession) {
                fermer(v.id)
            }

            override fun onCrash(session: GeckoSession) {
                v.session = null
                pegase.message = "La page a planté : touche-la pour la recharger."
            }

            override fun onKill(session: GeckoSession) {
                v.session = null
            }
        })
        s.setMediaSessionDelegate(object : MediaSession.Delegate {
            override fun onActivated(session: GeckoSession, mediaSession: MediaSession) {
                v.media = mediaSession
            }

            override fun onDeactivated(session: GeckoSession, mediaSession: MediaSession) {
                v.media = null
                v.enLecture = false
                if (v.id in suivent) nePlusSuivre(v.id)
            }

            override fun onPlay(session: GeckoSession, mediaSession: MediaSession) {
                v.enLecture = true
            }

            override fun onPause(session: GeckoSession, mediaSession: MediaSession) {
                v.enLecture = false
            }

            override fun onStop(session: GeckoSession, mediaSession: MediaSession) {
                v.enLecture = false
            }

            override fun onMetadata(session: GeckoSession, mediaSession: MediaSession, meta: MediaSession.Metadata) {
                v.titreMedia = meta.title
            }

            override fun onPositionState(session: GeckoSession, mediaSession: MediaSession, state: MediaSession.PositionState) {
                v.position = if (state.duration > 0) (state.position / state.duration).toFloat() else 0f
            }
        })
        s.setPromptDelegate(Invites(pegase))
        // Les messages de la page (pubs bloquées, texte pour Odin) passent par l'extension intégrée.
        Moteur.quandBloqueurPret { ext ->
            s.webExtensionController.setMessageDelegate(ext, object : WebExtension.MessageDelegate {
                override fun onConnect(port: WebExtension.Port) {
                    v.port = port
                    port.setDelegate(object : WebExtension.PortDelegate {
                        override fun onPortMessage(message: Any, port: WebExtension.Port) {
                            val m = message as? JSONObject ?: return
                            when (m.optString("type")) {
                                "bloques" -> v.bloques = m.optInt("n")
                                "extrait" -> extraits.remove(m.optString("id"))?.invoke(m)
                            }
                        }

                        override fun onDisconnect(port: WebExtension.Port) {
                            if (v.port === port) v.port = null
                        }
                    })
                    if (v.id in suivent) v.envoyer(JSONObject().put("type", "video-seule").put("actif", true))
                }
            }, Moteur.APPLI_NATIVE)
        }
    }

    /** Le titre et l'adresse de l'onglet partent vers Odin (sauf en privé). */
    private fun enregistrerOnglet(v: OngletVivant) {
        if (v.prive) return
        val e = pegase.profil?.donnees?.un(Cols.ONGLETS, v.id) ?: return
        if (e.suppr || (e.data["url"] == v.url && e.data["titre"] == v.titre)) return
        pegase.modifier(Cols.ONGLETS, v.id, e.data + mapOf("url" to v.url, "titre" to v.titre))
    }

    /** Quand on quitte une page : une visite dans l'historique (url, titre, date, durée), jamais en privé. */
    fun terminerVisite(v: OngletVivant?) {
        if (v == null || v.prive) return
        val url = v.visiteUrl ?: return
        v.visiteUrl = null
        if (!url.startsWith("http")) return
        pegase.compterBloques(v.bloques - v.bloquesComptes)
        v.bloquesComptes = v.bloques
        val duree = ((System.currentTimeMillis() - v.visiteDebut) / 1000).coerceAtLeast(0)
        val data = linkedMapOf<String, Any?>("url" to url, "titre" to v.titre, "date" to v.visiteDebut, "duree" to duree)
        Adresse.rechercheDe(url, moteurRecherche())?.let { data["recherche"] = it }
        pegase.modifier(Cols.HISTORIQUE, pegase.nouvelId("h"), data)
    }

    /** Demande à la page son texte visible (pour « Demander à Odin »), une donnée et jamais un ordre. */
    fun extrait(id: String, recu: (url: String, titre: String, texte: String) -> Unit) {
        val v = vivants[id]
        if (v?.port == null) {
            recu(v?.url ?: "", v?.titre ?: "", "")
            return
        }
        val cle = pegase.nouvelId("x")
        extraits[cle] = { m -> recu(m.optString("url"), m.optString("titre"), m.optString("texte")) }
        v.envoyer(JSONObject().put("type", "extrait").put("id", cle))
        ui.postDelayed({ extraits.remove(cle)?.invoke(JSONObject().put("url", v.url).put("titre", v.titre)) }, 3000)
    }

    // ------------------------------------------------------------------ veille, synchro

    /** Met en veille les pages qu'on n'a pas regardées depuis un moment (réglable, 10 min par défaut). */
    fun mettreEnVeille() {
        val delai = pegase.reglageNombre("veille-minutes", 10) * 60_000
        val maintenant = System.currentTimeMillis()
        for (v in vivants.values) {
            if (v.id == actif || v.id in groupe || v.id in suivent || v.enLecture) continue
            if (v.session != null && maintenant - v.dernierUsage > delai) {
                terminerVisite(v)
                v.session?.close()
                v.session = null
            }
        }
    }

    /** L'appli passe en arrière-plan : les visites en cours sont notées. */
    fun pause() {
        ongletActif()?.let { terminerVisite(it); it.visiteUrl = it.url; it.visiteDebut = System.currentTimeMillis() }
    }

    fun profilOuvert() {
        toutFermer()
        val o = pegase.onglets().filter { !it.range }
        actif = o.lastOrNull()?.id
        reglagesChanges()
    }

    /** Un onglet fermé sur un autre appareil disparaît ici aussi. */
    fun ongletsChanges() {
        val existants = pegase.onglets().map { it.id }.toSet()
        for (id in vivants.keys.toList()) {
            if (id in prives || id in existants) continue
            vivants.remove(id)?.session?.close()
            suivent.remove(id)
            groupe.remove(id)
        }
        if (actif != null && actif !in vivants && actif !in existants && actif !in prives) {
            actif = pegase.onglets().filter { !it.range }.lastOrNull()?.id
        }
    }

    fun reglagesChanges() {
        Moteur.bloqueurActif(pegase.reglageBool("bloqueur", true))
        Moteur.sitesSansBouclier(pegase.reglageListe("sans-bouclier"))
    }

    fun basculerBouclier(hote: String) {
        val l = pegase.reglageListe("sans-bouclier").toMutableList()
        if (hote in l) l.remove(hote) else l += hote
        pegase.regler("sans-bouclier", l)
        Moteur.sitesSansBouclier(l)
        ongletActif()?.session?.reload()
    }
}
