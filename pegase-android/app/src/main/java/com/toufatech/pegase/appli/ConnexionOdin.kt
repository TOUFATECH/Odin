package com.toufatech.pegase.appli

import com.toufatech.pegase.coeur.Oidc
import com.toufatech.pegase.coeur.texte
import com.toufatech.pegase.odin.ApiPegase
import com.toufatech.pegase.odin.Authentification
import com.toufatech.pegase.odin.Bonjour
import com.toufatech.pegase.odin.ClientOdin
import com.toufatech.pegase.odin.Epinglage
import com.toufatech.pegase.odin.ErreurOdin
import com.toufatech.pegase.odin.HORLOGE_SYSTEME

/** Une connexion par la page d'Odin en cours (code + PKCE) : ce qu'il faut pour vérifier le retour. */
class DemandeSso(
    val bonjour: Bonjour,
    val emetteur: String,
    val verificateur: String,
    val etat: String,
    val nonce: String,
    val url: String,
    /** Sans écran (prompt=none) : marche seulement si une session Odin existe déjà dans Pégase. */
    val silencieuse: Boolean,
)

/**
 * Se connecter à Odin (connexion unique, docs/sso-protocole.md) :
 * - automatiquement si une session Odin existe déjà (page d'Odin invisible, prompt=none) ;
 * - par la page d'Odin (portail Persona, dans un écran intégré à Pégase, certificat épinglé) ;
 * - ou directement avec l'e-mail et le mot de passe tapés dans Pégase (`/sso/connexion`).
 * Sans droit sur Pégase : le message d'Odin est montré tel quel.
 */
class ConnexionOdin(private val pegase: Pegase) {

    fun client(b: Bonjour) = ClientOdin(b.base, Epinglage(b.empreinte))

    /** Prépare la page de connexion d'Odin (appel réseau : sur un fil de fond). */
    fun preparer(b: Bonjour, silencieuse: Boolean): DemandeSso {
        val c = client(b)
        val conf = c.getJson("/.well-known/openid-configuration", delaiMs = 6000)
        if (!conf.ok) throw ErreurOdin(conf.statut, "sso", "Cet Odin ne propose pas encore la connexion unique : mets-le à jour, ou connecte-toi avec ton e-mail.")
        val emetteur = conf.corps.texte("issuer") ?: b.base
        val autoriser = conf.corps.texte("authorization_endpoint") ?: "${b.base}/sso/autoriser"
        // Le point d'entrée doit être sur le même Odin (sinon on ne l'ouvre pas).
        if (!autoriser.startsWith(b.base) && !autoriser.startsWith(emetteur)) {
            throw ErreurOdin(0, "sso", "La page de connexion annoncée n'est pas sur ton Odin : connexion refusée.")
        }
        val v = Oidc.verificateur()
        val etat = Oidc.aleatoire(16)
        val nonce = Oidc.aleatoire(16)
        val url = Oidc.adresseAutorisation(autoriser, Oidc.defi(v), etat, nonce, prompt = if (silencieuse) "none" else null)
        return DemandeSso(b, emetteur, v, etat, nonce, url, silencieuse)
    }

    /**
     * Le retour de la page d'Odin. Rend null si tout va bien (la connexion se termine en fond),
     * sinon le texte à montrer (celui d'Odin, tel quel). Une connexion automatique ratée ne dit rien.
     */
    fun retour(d: DemandeSso, url: String, fini: (String?) -> Unit) {
        when (val r = Oidc.lireRetour(url, d.etat, d.emetteur)) {
            is Oidc.Retour.Erreur -> fini(if (d.silencieuse && r.code in setOf("login_required", "interaction_required", "consent_required")) null else r.message)
            is Oidc.Retour.Code -> pegase.enFond {
                try {
                    val base = pegase.sessionDeBase(d.bonjour).copy(emetteur = d.emetteur)
                    val s = Authentification.echangerCode(client(d.bonjour), HORLOGE_SYSTEME, base, r.code, d.verificateur, d.nonce)
                    pegase.connecte(s)
                    pegase.surUi { fini(null) }
                } catch (e: ErreurOdin) {
                    pegase.surUi { fini(e.message) }
                }
            }
        }
    }

    /** Connexion directe (e-mail ou identifiant + mot de passe, et le code à 6 chiffres si besoin). */
    fun directe(b: Bonjour, identifiant: String, motdepasse: String, code: String?, fini: (ErreurOdin?) -> Unit) {
        pegase.enFond {
            try {
                val c = client(b)
                val conf = c.getJson("/.well-known/openid-configuration", delaiMs = 6000)
                val emetteur = if (conf.ok) conf.corps.texte("issuer") else null
                val s = Authentification.connexionDirecte(c, HORLOGE_SYSTEME, pegase.sessionDeBase(b).copy(emetteur = emetteur), identifiant, motdepasse, code)
                pegase.connecte(s)
                pegase.surUi { fini(null) }
            } catch (e: ErreurOdin) {
                pegase.surUi { fini(e) }
            }
        }
    }

    /** L'adresse tapée à la main (IP et port) : on vérifie qu'un Odin répond, https d'abord. */
    fun essayer(ip: String, port: String, fini: (Bonjour?) -> Unit) {
        pegase.enFond {
            val p = port.trim().ifEmpty { "7777" }
            var b: Bonjour? = null
            for (schema in listOf("https", "http")) {
                b = ApiPegase.bonjour(ClientOdin("$schema://${ip.trim()}:$p", Epinglage(null)), 4000)
                if (b != null) break
            }
            pegase.surUi { fini(b) }
        }
    }
}
