package com.toufatech.pegase.odin

import com.toufatech.pegase.coeur.Jetons
import com.toufatech.pegase.coeur.Json
import com.toufatech.pegase.coeur.Oidc
import com.toufatech.pegase.coeur.entier
import com.toufatech.pegase.coeur.liste
import com.toufatech.pegase.coeur.objet
import com.toufatech.pegase.coeur.texte

/** L'heure, remplaçable dans les essais. */
fun interface Horloge {
    fun maintenant(): Long
}

val HORLOGE_SYSTEME = Horloge { System.currentTimeMillis() }

/**
 * Ce que Pégase garde de sa connexion à Odin (chiffré sur le téléphone par une clé de l'Android Keystore ;
 * jamais de mot de passe). Deux sortes de jetons, que les routes /api/pegase/ acceptent toutes les deux :
 * - la connexion unique d'Odin (SSO) : jeton d'accès de 15 min + jeton de renouvellement à usage unique ;
 * - le jeton d'appareil `pg1.…` (profil créé depuis Pégase avec l'accord du propriétaire).
 */
data class Session(
    val odin: String,
    val empreinte: String?,
    /** Identifiant de cette installation (8 à 64 caractères), donné à chaque connexion et renouvellement. */
    val appareil: String,
    val appareilNom: String,
    val emetteur: String? = null,
    val acces: String? = null,
    val expire: Long = 0,
    val renouvellement: String? = null,
    val jetonPegase: String? = null,
    val personne: Map<String, Any?> = emptyMap(),
) {
    val nom: String get() = personne.texte("name") ?: personne.texte("nom") ?: personne.texte("preferred_username") ?: "Ton profil"
    val email: String? get() = personne.texte("email")

    /** Le dossier du profil sur le téléphone : l'identifiant stable de la personne (sub). */
    val profilId: String
        get() = (personne.texte("sub") ?: personne.texte("id") ?: "odin").replace(Regex("[^A-Za-z0-9_-]"), "_")

    fun versJson(): String = Json.ecrire(
        linkedMapOf(
            "odin" to odin, "empreinte" to empreinte, "appareil" to appareil, "appareilNom" to appareilNom,
            "emetteur" to emetteur, "acces" to acces, "expire" to expire, "renouvellement" to renouvellement,
            "jetonPegase" to jetonPegase, "personne" to personne,
        ),
    )

    companion object {
        fun deJson(texte: String?): Session? {
            if (texte.isNullOrBlank()) return null
            return try {
                val m = Json.objet(texte)
                Session(
                    odin = m.texte("odin") ?: return null,
                    empreinte = m.texte("empreinte"),
                    appareil = m.texte("appareil") ?: return null,
                    appareilNom = m.texte("appareilNom") ?: "Téléphone",
                    emetteur = m.texte("emetteur"),
                    acces = m.texte("acces"),
                    expire = m.entier("expire") ?: 0,
                    renouvellement = m.texte("renouvellement"),
                    jetonPegase = m.texte("jetonPegase"),
                    personne = m.objet("personne") ?: emptyMap(),
                )
            } catch (e: Exception) {
                null
            }
        }

        /** Un identifiant d'installation : 8 à 64 caractères A-Z a-z 0-9 _ - (SSO § 4). */
        fun nouvelAppareil(): String = "and-" + Oidc.aleatoire(18).replace(Regex("[^A-Za-z0-9_-]"), "x")
    }
}

/**
 * La connexion à Odin : obtenir, renouveler et oublier les jetons (docs/sso-protocole.md § 3 à 6).
 * [sauver] est appelé à chaque changement (rotation des jetons de renouvellement) ; null = déconnecté.
 */
class Authentification(
    val client: ClientOdin,
    private val horloge: Horloge,
    session: Session,
    private val sauver: (Session?) -> Unit,
) {
    @Volatile
    var session: Session? = session
        private set

    /** Appelé quand la session est perdue (jeton révoqué, droit retiré) : message à montrer tel quel. */
    @Volatile
    var surPerte: ((String) -> Unit)? = null

    private fun appareilChamps(s: Session) = listOf("appareil" to s.appareil, "appareil_nom" to s.appareilNom, "plateforme" to "android")

    /** Un jeton valable pour Odin, renouvelé au besoin ; null si on n'est plus connecté. */
    @Synchronized
    fun jeton(): String? {
        val s = session ?: return null
        if (s.jetonPegase != null) return s.jetonPegase
        if (s.acces != null && s.expire - 60_000 > horloge.maintenant()) return s.acces
        if (s.renouvellement == null) return null
        return renouveler()
    }

    val estSso: Boolean get() = session?.jetonPegase == null

    /** Renouvelle le jeton d'accès (rotation : le jeton de renouvellement ne sert qu'une fois). */
    @Synchronized
    fun renouveler(): String? {
        val s = session ?: return null
        val r = s.renouvellement ?: return null
        val rep = client.postFormulaire(
            "/sso/jeton",
            listOf("grant_type" to "refresh_token", "refresh_token" to r, "client_id" to Oidc.CLIENT, "appareil" to s.appareil),
        )
        if (!rep.ok) {
            if (rep.statut in 400..403) perdre(rep.message)
            throw rep.erreur()
        }
        val j = Jetons.deJson(rep.corps, horloge.maintenant()) ?: throw ErreurOdin(rep.statut, "reponse", "Odin a répondu sans jeton : réessaie.")
        val nouvelle = s.copy(acces = j.acces, expire = j.expire, renouvellement = j.renouvellement ?: s.renouvellement)
        session = nouvelle
        sauver(nouvelle)
        return j.acces
    }

    /** Odin a dit « jeton_invalide » : le prochain appel renouvelle (ou la session est perdue). */
    @Synchronized
    fun invalider() {
        val s = session ?: return
        if (s.jetonPegase != null) {
            perdre("Ce téléphone n'est plus reconnu par Odin : reconnecte-toi.")
        } else {
            session = s.copy(expire = 0)
        }
    }

    @Synchronized
    fun perdre(message: String) {
        if (session == null) return
        session = null
        sauver(null)
        surPerte?.invoke(message)
    }

    /** Se déconnecter : révoque la session chez Odin (sans attendre la réponse en cas d'échec) puis oublie tout. */
    fun deconnecter() {
        val s = session ?: return
        try {
            if (s.renouvellement != null) {
                client.postJson("/sso/revoquer", mapOf("token" to s.renouvellement, "token_type_hint" to "refresh_token"))
            }
            if (s.jetonPegase != null) {
                client.postJson("/api/pegase/deconnexion", emptyMap(), mapOf("authorization" to "Bearer ${s.jetonPegase}"))
            }
        } catch (e: ErreurOdin) {
            // Hors ligne : la session sera révoquée depuis Persona si besoin.
        }
        synchronized(this) {
            session = null
            sauver(null)
        }
    }

    companion object {
        /**
         * Connexion directe (identifiant ou e-mail + mot de passe tapés dans Pégase) : `POST /sso/connexion`.
         * Le mot de passe part une fois vers Odin et n'est gardé nulle part.
         * Erreurs à montrer telles quelles : identifiants, code_requis (demander le code à 6 chiffres), refuse…
         */
        fun connexionDirecte(
            client: ClientOdin,
            horloge: Horloge,
            base: Session,
            identifiant: String,
            motdepasse: String,
            code: String?,
        ): Session {
            val corps = linkedMapOf<String, Any?>(
                "identifiant" to identifiant.trim(),
                "motdepasse" to motdepasse,
                "appli" to Oidc.CLIENT,
                "appareil" to mapOf("id" to base.appareil, "nom" to base.appareilNom, "plateforme" to "android"),
            )
            if (!code.isNullOrBlank()) corps["code"] = code.trim()
            val rep = client.postJson("/sso/connexion", corps)
            if (!rep.ok) throw rep.erreur()
            return sessionDe(rep.corps, horloge, base) ?: throw ErreurOdin(rep.statut, "reponse", "Odin a répondu sans jeton : réessaie.")
        }

        /** Après la page d'Odin (code + PKCE) : `POST /sso/jeton` grant_type=authorization_code. */
        fun echangerCode(client: ClientOdin, horloge: Horloge, base: Session, code: String, verificateur: String): Session {
            val rep = client.postFormulaire(
                "/sso/jeton",
                listOf(
                    "grant_type" to "authorization_code", "code" to code, "redirect_uri" to Oidc.RETOUR,
                    "client_id" to Oidc.CLIENT, "code_verifier" to verificateur,
                    "appareil" to base.appareil, "appareil_nom" to base.appareilNom, "plateforme" to "android",
                ),
            )
            if (!rep.ok) throw rep.erreur()
            val s = sessionDe(rep.corps, horloge, base) ?: throw ErreurOdin(rep.statut, "reponse", "Odin a répondu sans jeton : réessaie.")
            // La personne : dans le jeton d'identité, sinon /sso/infos.
            if (s.personne.texte("sub") != null) return s
            val infos = client.getJson("/sso/infos", mapOf("authorization" to "Bearer ${s.acces}"))
            return if (infos.ok) s.copy(personne = infos.corps) else s
        }

        private fun sessionDe(corps: Map<String, Any?>, horloge: Horloge, base: Session): Session? {
            val j = Jetons.deJson(corps, horloge.maintenant()) ?: return null
            val personne = corps.objet("personne")
                ?: j.identite?.let { com.toufatech.pegase.coeur.Jwt.charge(it) }
                ?: emptyMap()
            return base.copy(acces = j.acces, expire = j.expire, renouvellement = j.renouvellement, jetonPegase = null, personne = personne)
        }

        /** Les applis que la personne a le droit d'ouvrir (réponse de connexion ou /sso/infos). */
        fun applis(corps: Map<String, Any?>): List<String> = corps.liste("applis")?.mapNotNull { it as? String } ?: emptyList()
    }
}
