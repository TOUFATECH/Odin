package com.toufatech.pegase.appli

import android.content.Context
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.toufatech.pegase.coeur.Cols
import com.toufatech.pegase.coeur.Donnees
import com.toufatech.pegase.coeur.EtatSynchro
import com.toufatech.pegase.coeur.FileAttente
import com.toufatech.pegase.coeur.Indicateur
import com.toufatech.pegase.coeur.Palettes
import com.toufatech.pegase.coeur.RendezVous
import com.toufatech.pegase.coeur.Theme
import com.toufatech.pegase.coeur.booleen
import com.toufatech.pegase.coeur.decimal
import com.toufatech.pegase.coeur.entier
import com.toufatech.pegase.coeur.texte
import com.toufatech.pegase.moteur.Moteur
import com.toufatech.pegase.moteur.Navigateur
import com.toufatech.pegase.moteur.Telechargements
import com.toufatech.pegase.odin.ApiPegase
import com.toufatech.pegase.odin.Authentification
import com.toufatech.pegase.odin.Bonjour
import com.toufatech.pegase.odin.ClientOdin
import com.toufatech.pegase.odin.Decouvreur
import com.toufatech.pegase.odin.EcouteSynchro
import com.toufatech.pegase.odin.Epinglage
import com.toufatech.pegase.odin.ErreurOdin
import com.toufatech.pegase.odin.HORLOGE_SYSTEME
import com.toufatech.pegase.odin.MoteurSynchro
import com.toufatech.pegase.odin.Session
import com.toufatech.pegase.stockage.Magasin
import com.toufatech.pegase.ui.PhotoProfil
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import com.toufatech.pegase.coeur.Texte

enum class Ecran { DEMARRAGE, CONNEXION, NAVIGATEUR }

enum class Feuille { ONGLETS, MENU, ADRESSE, PROFIL, FAVORIS, AGENDA, REGLAGES, ODIN, TELECHARGEMENTS, RANGES, ESPACES }

data class Favori(val id: String, val titre: String, val url: String, val dossier: String?, val ordre: Double)

data class Espace(val id: String, val nom: String, val couleur: Long, val ordre: Double)

/** Un onglet synchronisé (collection `onglets` : ceux de tous les appareils du profil). */
data class OngletInfo(
    val id: String,
    val url: String,
    val titre: String,
    val espace: String?,
    val epingle: Boolean,
    val range: Boolean,
    val ordre: Double,
    val maj: Long,
)

/** Un profil ouvert sur le téléphone : ses fichiers chiffrés et sa synchro. */
class ProfilOuvert(val id: String, val magasin: Magasin, val moteur: MoteurSynchro) {
    val donnees: Donnees get() = moteur.donnees
}

/**
 * L'état de Pégase (ce que l'interface affiche) et ce qu'on peut y faire.
 * Le réseau et le disque passent par un fil de fond ; l'état affiché ne change que sur le fil de l'interface.
 */
class Pegase(val app: Context) {
    private val ui = Handler(Looper.getMainLooper())
    private val fond = Executors.newCachedThreadPool { r -> Thread(r, "pegase-fond").apply { isDaemon = true } }

    /** Ce qui est propre à ce téléphone (la session d'Odin, chiffrée) — jamais synchronisé. */
    val general = Magasin(File(app.filesDir, "general"), Coffre.chiffreur)

    var ecran by mutableStateOf(Ecran.DEMARRAGE)
    var feuille by mutableStateOf<Feuille?>(null)
    var revision by mutableIntStateOf(0)
        private set
    var indicateur by mutableStateOf(Indicateur(EtatSynchro.SANS_ODIN, 0))
        private set
    var message by mutableStateOf<String?>(null)
    var session by mutableStateOf<Session?>(null)
        private set
    var odinTrouve by mutableStateOf<Bonjour?>(null)
    var texteDemarrage by mutableStateOf("Recherche d'Odin sur ton réseau…")
    var appareilsOdin by mutableIntStateOf(0)
    var derniereSynchro by mutableStateOf<Long?>(null)

    var profil: ProfilOuvert? = null
        private set

    /** La photo du profil (réduite, gardée sur ce téléphone seulement) ; sans photo, c'est Odin qui s'affiche. */
    var photoProfil by mutableStateOf<ImageBitmap?>(null)
        private set
    private fun fichierPhoto(): File? = profil?.let { File(app.filesDir, "photos/${it.id}.jpg") }

    /** Une photo choisie par la personne remplace Odin dans l'avatar. */
    fun mettrePhoto(uri: Uri) {
        val f = fichierPhoto() ?: return
        enFond {
            val b = PhotoProfil.reduite(app, uri)
            if (b == null) {
                surUi { message = "Cette image ne se lit pas : choisis une photo JPG, PNG ou WebP." }
            } else {
                PhotoProfil.enregistrer(b, f)
                surUi { photoProfil = b.asImageBitmap() }
            }
        }
    }

    /** « Retirer la photo » : Odin revient dans l'avatar. */
    fun retirerPhoto() {
        fichierPhoto()?.delete()
        photoProfil = null
    }
    private var api: ApiPegase? = null

    val navigateur = Navigateur(this)
    val telechargements = Telechargements(this)

    /** Les téléphones larges (tablettes) montrent 4 pages et 4 vidéos ; un téléphone, 2. */
    val tablette: Boolean get() = app.resources.configuration.smallestScreenWidthDp >= 600
    val maxPages: Int get() = if (tablette) 4 else 2

    fun enFond(f: () -> Unit) {
        fond.execute {
            try {
                f()
            } catch (e: ErreurOdin) {
                surUi { message = e.message }
            } catch (e: Exception) {
                surUi { message = "Quelque chose n'a pas marché : ${Texte.sansChemin(e.message ?: e.javaClass.simpleName)}. Réessaie." }
            }
        }
    }

    fun surUi(f: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) f() else ui.post { f() }
    }

    // ------------------------------------------------------------------ démarrage

    private var demarre = false

    /** Le lancement (logo et 3 points) : on rouvre la session gardée, sinon on cherche Odin. */
    fun demarrer() {
        if (demarre) return
        demarre = true
        Moteur.runtime(app)
        enFond {
            val s = Session.deJson(general.lire("session"))
            val sansOdin = general.lire("sans-odin") == "oui"
            when {
                s != null -> surUi {
                    ouvrirProfil(s.profilId, s)
                    ecran = Ecran.NAVIGATEUR
                }
                sansOdin -> surUi {
                    ouvrirProfil("local", null)
                    ecran = Ecran.NAVIGATEUR
                }
                else -> {
                    val t0 = System.currentTimeMillis()
                    val trouves = Decouvreur.chercher()
                    // Le logo reste au moins une seconde : pas de clignotement.
                    val reste = 1000 - (System.currentTimeMillis() - t0)
                    if (reste > 0) Thread.sleep(reste)
                    surUi {
                        odinTrouve = trouves.firstOrNull()
                        ecran = Ecran.CONNEXION
                    }
                }
            }
        }
    }

    /** Le nom de ce téléphone pour Odin (« Pixel 8 de Awa ») : modèle du téléphone. */
    val nomAppareil: String
        get() {
            val nom = try {
                Settings.Global.getString(app.contentResolver, Settings.Global.DEVICE_NAME)
            } catch (e: Exception) {
                null
            }
            return (nom ?: "${Build.MANUFACTURER} ${Build.MODEL}").take(60)
        }

    /** L'identifiant de cette installation (créé une fois, gardé chiffré). */
    val idInstallation: String
        get() = general.lire("appareil") ?: Session.nouvelAppareil().also { general.ecrire("appareil", it) }

    /** Une session vide (avant connexion) pour une adresse d'Odin. */
    fun sessionDeBase(bonjour: Bonjour): Session =
        Session(bonjour.base, bonjour.empreinte, idInstallation, nomAppareil)

    /** Connexion réussie (directe ou par la page d'Odin) : on garde les jetons et on ouvre le profil. */
    fun connecte(s: Session) {
        general.ecrire("session", s.versJson())
        general.effacer("sans-odin")
        surUi {
            ouvrirProfil(s.profilId, s)
            ecran = Ecran.NAVIGATEUR
            message = "Bienvenue ${s.nom} : tes favoris, onglets et ton agenda arrivent d'Odin."
        }
    }

    /** « Ignorer » : Pégase marche seul sur le téléphone (on pourra se connecter à Odin plus tard). */
    fun ignorerOdin() {
        enFond {
            general.ecrire("sans-odin", "oui")
            surUi {
                ouvrirProfil("local", null)
                ecran = Ecran.NAVIGATEUR
            }
        }
    }

    /** Ouvre (ou change) le profil affiché et branche sa synchro. */
    fun ouvrirProfil(id: String, s: Session?) {
        profil?.moteur?.arreter()
        val magasin = Magasin(File(app.filesDir, "profils/$id"), Coffre.chiffreur)
        val donnees = Donnees()
        val file = FileAttente()
        magasin.charger(donnees, file)
        val moteur = MoteurSynchro(donnees, file, magasin, HORLOGE_SYSTEME, object : EcouteSynchro {
            override fun changement(cols: Set<String>) = surUi { donneesChangees(cols) }
            override fun indicateur(i: Indicateur) = surUi {
                this@Pegase.indicateur = i
                if (i.etat == EtatSynchro.SYNCHRONISE) derniereSynchro = System.currentTimeMillis()
            }
            override fun restaure(texte: String) = surUi { message = texte }
            override fun revoque(texte: String) = surUi { message = texte }
        })
        profil = ProfilOuvert(id, magasin, moteur)
        photoProfil = fichierPhoto()?.let { PhotoProfil.lire(it) }?.asImageBitmap()
        session = s
        if (s != null) {
            val client = ClientOdin(s.odin, Epinglage(s.empreinte))
            val auth = Authentification(client, HORLOGE_SYSTEME, s) { nouvelle ->
                if (nouvelle != null) general.ecrire("session", nouvelle.versJson()) else general.effacer("session")
                surUi { session = nouvelle }
            }
            auth.surPerte = { texte -> surUi { sessionPerdue(texte) } }
            val a = ApiPegase(client, auth)
            api = a
            moteur.demarrer(a)
            enFond { reglerProtection(s) }
        } else {
            api = null
            moteur.demarrer(null)
            Moteur.reglerDns(app, null, reglageTexte("dns-secours") ?: Moteur.DOH_SECOURS)
        }
        theme = Theme.deId(reglageTexte("theme"))
        navigateur.profilOuvert()
        donneesChangees(Cols.TOUTES.toSet())
    }

    /** Odin a coupé la session (révoquée, droit retiré…) : on garde les données locales, on revient à la connexion. */
    private fun sessionPerdue(texte: String) {
        message = texte
        profil?.moteur?.demarrer(null)
        api = null
        session = null
        ecran = Ecran.CONNEXION
    }

    fun apiOdin(): ApiPegase? = api

    /** DNS chiffré : Sphinx si Odin le propose et que le téléphone reconnaît son certificat, sinon le secours public. */
    private fun reglerProtection(s: Session) {
        val bonjour = ApiPegase.bonjour(ClientOdin(s.odin, Epinglage(s.empreinte)))
        if (bonjour != null) surUi { odinTrouve = bonjour }
        val veutSphinx = reglageBool("dns-sphinx", true)
        val sphinx = if (veutSphinx && bonjour?.dns == true) "${s.odin}/dns-query" else null
        val utilisable = sphinx != null && Moteur.sphinxUtilisable(sphinx)
        surUi {
            Moteur.reglerDns(app, if (utilisable) sphinx else null, reglageTexte("dns-secours") ?: Moteur.DOH_SECOURS)
            etatDns = when {
                utilisable -> "Adresses par Sphinx (Odin)"
                sphinx != null -> "Sphinx est là, mais le téléphone ne reconnaît pas encore le certificat d'Odin : DNS chiffré public en attendant."
                else -> "DNS chiffré public (Odin ne propose pas Sphinx)"
            }
        }
        // Infos du profil (nombre d'appareils) pour l'écran Profil.
        try {
            val moi = api?.moi()
            val n = (moi?.corps?.get("appareils") as? List<*>)?.size
            if (n != null) surUi { appareilsOdin = n }
        } catch (e: ErreurOdin) {
            // hors ligne
        }
    }

    var etatDns by mutableStateOf("DNS chiffré public")

    fun deconnecter() {
        val a = api
        enFond {
            a?.auth?.deconnecter()
            general.effacer("session")
            surUi {
                profil?.moteur?.demarrer(null)
                api = null
                session = null
                feuille = null
                ecran = Ecran.CONNEXION
                message = "Tu es déconnecté d'Odin. Tes données restent sur le téléphone, chiffrées."
            }
        }
    }

    /** Oublier ce profil sur le téléphone (« Quitter ») : efface ses fichiers ; ils restent sur Odin. */
    fun quitterProfil() {
        val p = profil ?: return
        val a = api
        enFond {
            a?.auth?.deconnecter()
            p.moteur.arreter()
            p.magasin.toutEffacer()
            general.effacer("session")
            general.effacer("sans-odin")
            surUi {
                profil = null
                api = null
                session = null
                feuille = null
                navigateur.toutFermer()
                ecran = Ecran.CONNEXION
            }
        }
    }

    // ------------------------------------------------------------------ données

    /** Appelé (fil de l'interface) quand des collections changent, d'ici ou d'un autre appareil. */
    fun donneesChangees(cols: Set<String>) {
        revision++
        if (Cols.REGLAGES in cols) {
            theme = Theme.deId(reglageTexte("theme"))
            navigateur.reglagesChanges()
        }
        if (Cols.ONGLETS in cols) navigateur.ongletsChanges()
        if (Cols.AGENDA in cols) {
            val p = profil ?: return
            val tous = p.donnees.tous(Cols.AGENDA)
            Rappels.planifier(app, rdvs(), tous.filter { it.suppr }.map { it.id }, System.currentTimeMillis())
        }
    }

    fun modifier(col: String, id: String, data: Map<String, Any?>) {
        val p = profil ?: return
        p.moteur.modifier(col, id, data)
    }

    fun supprimer(col: String, id: String) {
        val p = profil ?: return
        p.moteur.supprimer(col, id)
    }

    fun nouvelId(prefixe: String) = prefixe + "-" + UUID.randomUUID().toString()

    private fun donnees() = profil?.donnees

    fun reglage(cle: String): Any? = donnees()?.un(Cols.REGLAGES, cle)?.takeIf { !it.suppr }?.data?.get("valeur")
    fun reglageTexte(cle: String): String? = reglage(cle) as? String
    fun reglageBool(cle: String, defaut: Boolean): Boolean = reglage(cle) as? Boolean ?: defaut
    fun reglageNombre(cle: String, defaut: Long): Long = (reglage(cle) as? Number)?.toLong() ?: defaut

    @Suppress("UNCHECKED_CAST")
    fun reglageListe(cle: String): List<String> = (reglage(cle) as? List<Any?>)?.mapNotNull { it as? String } ?: emptyList()

    fun regler(cle: String, valeur: Any?) = modifier(Cols.REGLAGES, cle, mapOf("valeur" to valeur))

    var theme by mutableStateOf(Theme.BLEU)
        private set

    fun choisirTheme(t: Theme) {
        theme = t
        regler("theme", t.id)
    }

    fun systemeSombre(): Boolean =
        (app.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    fun favoris(): List<Favori> = (donnees()?.actifs(Cols.FAVORIS) ?: emptyList()).mapNotNull { e ->
        val url = e.data.texte("url") ?: return@mapNotNull null
        Favori(e.id, e.data.texte("titre")?.ifBlank { null } ?: url, url, e.data.texte("dossier"), e.data.decimal("ordre") ?: e.maj.toDouble())
    }.sortedBy { it.ordre }

    fun dossiersFavoris(): List<String> = (reglageListe("dossiers-favoris") + favoris().mapNotNull { it.dossier }).distinct()

    fun ajouterFavori(url: String, titre: String, dossier: String? = null) {
        if (url.isBlank() || url == "about:blank") return
        val existant = favoris().firstOrNull { it.url == url }
        if (existant != null) {
            message = "Déjà dans tes favoris."
            return
        }
        val ordre = (favoris().maxOfOrNull { it.ordre } ?: 0.0) + 1
        val data = linkedMapOf<String, Any?>("url" to url, "titre" to titre, "ordre" to ordre)
        if (dossier != null) data["dossier"] = dossier
        modifier(Cols.FAVORIS, nouvelId("f"), data)
        message = "Ajouté aux favoris."
    }

    /** Range une liste dans un nouvel ordre (glisser-déposer) : seuls les éléments déplacés sont réécrits. */
    fun reordonner(col: String, ids: List<String>) {
        val p = profil ?: return
        ids.forEachIndexed { i, id ->
            val e = p.donnees.un(col, id) ?: return@forEachIndexed
            if (e.suppr) return@forEachIndexed
            if ((e.data.decimal("ordre") ?: -1.0) != i.toDouble()) modifier(col, id, e.data + ("ordre" to i))
        }
    }

    fun espaces(): List<Espace> {
        val l = (donnees()?.actifs(Cols.ESPACES) ?: emptyList()).map { e ->
            val nom = e.data.texte("nom") ?: "Espace"
            val c = e.data.texte("couleur")?.let { couleurDe(it) } ?: Palettes.teintePour(nom)
            Espace(e.id, nom, c, e.data.decimal("ordre") ?: e.maj.toDouble())
        }.sortedBy { it.ordre }
        return l.ifEmpty { listOf(Espace(ESPACE_DEFAUT, "Perso", Palettes.OR, 0.0)) }
    }

    fun creerEspace(nom: String) {
        val ordre = (espaces().maxOfOrNull { it.ordre } ?: 0.0) + 1
        val couleur = Palettes.TEINTES[espaces().size % Palettes.TEINTES.size]
        modifier(Cols.ESPACES, nouvelId("e"), mapOf("nom" to nom.trim().take(40), "couleur" to versHex(couleur), "ordre" to ordre))
    }

    var espaceActif by mutableStateOf(ESPACE_DEFAUT)

    fun onglets(): List<OngletInfo> = (donnees()?.actifs(Cols.ONGLETS) ?: emptyList()).map { e ->
        OngletInfo(
            id = e.id,
            url = e.data.texte("url") ?: "",
            titre = e.data.texte("titre") ?: "",
            espace = e.data.texte("espace"),
            epingle = e.data.booleen("epingle") == true,
            range = e.data.booleen("range") == true,
            ordre = e.data.decimal("ordre") ?: e.maj.toDouble(),
            maj = e.maj,
        )
    }.sortedBy { it.ordre }

    fun rdvs(): List<RendezVous> = (donnees()?.actifs(Cols.AGENDA) ?: emptyList()).mapNotNull { RendezVous.deData(it.id, it.data) }

    /** Les tâches « à poser » de l'agenda : pas encore de date (on les glisse sur une heure). */
    fun aPoser(): List<Pair<String, Map<String, Any?>>> = (donnees()?.actifs(Cols.AGENDA) ?: emptyList())
        .filter { it.data.texte("debut") == null }
        .map { it.id to it.data }

    fun chiffresDuMois(): Map<String, Long> {
        val d = donnees() ?: return emptyMap()
        val debutMois = java.time.LocalDate.now().withDayOfMonth(1).atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
        val visites = d.actifs(Cols.HISTORIQUE).filter { (it.data.entier("date") ?: it.maj) >= debutMois }
        val secondes = visites.sumOf { it.data.entier("duree") ?: 0L }
        return mapOf(
            "bloques" to reglageNombre("bloques-${java.time.YearMonth.now()}", 0),
            "analyses" to d.actifs(Cols.TELECHARGEMENTS).count { (it.data.entier("date") ?: 0) >= debutMois }.toLong(),
            "favoris" to d.actifs(Cols.FAVORIS).size.toLong(),
            "heures" to secondes / 3600,
        )
    }

    /** Ajoute au compteur du mois les pubs bloquées (réglage synchronisé, écrit au plus une fois par page). */
    fun compterBloques(n: Int) {
        if (n <= 0 || profil == null) return
        val cle = "bloques-${java.time.YearMonth.now()}"
        regler(cle, reglageNombre(cle, 0) + n)
    }

    /** Le retour de la page de connexion d'Odin quand elle est passée par un autre navigateur (pegase://sso/retour). */
    var retourSso by mutableStateOf<String?>(null)

    /** Un lien reçu d'une autre appli avant que le navigateur soit prêt. */
    var lienEnAttente: String? = null

    /** Une question posée par la page montrée (alerte, liste, fichier…), affichée par l'interface. */
    var invite by mutableStateOf<com.toufatech.pegase.moteur.Invite?>(null)

    /** La feuille des onglets sert à choisir la page à ajouter à l'écran partagé. */
    var choixPartage by mutableStateOf(false)

    fun partagerTexte(texte: String) {
        val i = android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, texte)
        app.startActivity(android.content.Intent.createChooser(i, "Partager").addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Un lien vers une autre appli (tel:, mailto:, intent:…) : le téléphone choisit l'appli. */
    fun ouvrirAilleurs(url: String) {
        try {
            val i = if (url.startsWith("intent:")) {
                android.content.Intent.parseUri(url, android.content.Intent.URI_INTENT_SCHEME).apply {
                    // Jamais vers une appli précise demandée par la page : seulement l'action (sécurité).
                    component = null
                    selector = null
                    addCategory(android.content.Intent.CATEGORY_BROWSABLE)
                }
            } else {
                android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
            }
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            app.startActivity(i)
        } catch (e: Exception) {
            message = "Aucune appli du téléphone ne sait ouvrir ce lien."
        }
    }

    // ------------------------------------------------------------------ Odin

    fun synchroniserMaintenant() {
        profil?.moteur?.verifierMaintenant()
    }

    companion object {
        const val ESPACE_DEFAUT = "espace-perso"

        fun couleurDe(hex: String): Long? {
            val h = hex.removePrefix("#")
            if (h.length != 6) return null
            return h.toLongOrNull(16)?.let { 0xFF000000L or it }
        }

        fun versHex(argb: Long): String = "#" + (argb and 0xFFFFFF).toString(16).padStart(6, '0').uppercase()
    }
}
