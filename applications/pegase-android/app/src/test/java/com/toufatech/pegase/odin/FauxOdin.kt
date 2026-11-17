package com.toufatech.pegase.odin

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import com.toufatech.pegase.coeur.Cols
import com.toufatech.pegase.coeur.Empreintes
import com.toufatech.pegase.coeur.Enregistrement
import com.toufatech.pegase.coeur.Fusion
import com.toufatech.pegase.coeur.Json
import com.toufatech.pegase.coeur.Oidc
import com.toufatech.pegase.coeur.entier
import com.toufatech.pegase.coeur.liste
import com.toufatech.pegase.coeur.objet
import com.toufatech.pegase.coeur.objets
import com.toufatech.pegase.coeur.texte
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Un faux Odin fidèle au protocole (docs/pegase-protocole.md et docs/sso-protocole.md), pour les essais JVM :
 * vrai serveur HTTP local, vraies requêtes, vrai flux SSE. Un seul profil.
 */
class FauxOdin {
    private val serveur: HttpServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    val base: String get() = "http://127.0.0.1:${serveur.address.port}"

    /** Les données d'Odin : col → id → enregistrement. */
    val cols = ConcurrentHashMap<String, ConcurrentHashMap<String, Enregistrement>>()

    /** jeton d'accès → appareil ; jetons de renouvellement encore valables → appareil. */
    private val acces = ConcurrentHashMap<String, String>()
    private val renouvellements = ConcurrentHashMap<String, String>()
    private val compteur = AtomicInteger()

    private class Flux(val appareil: String, val q: LinkedBlockingQueue<String>)

    private val flux = CopyOnWriteArrayList<Flux>()

    @Volatile
    var coupe = false

    @Volatile
    var limitePage = 5000
    val envois = AtomicInteger()

    init {
        for (c in Cols.TOUTES) cols[c] = ConcurrentHashMap()
        serveur.executor = Executors.newCachedThreadPool()
        serveur.createContext("/") { ex ->
            try {
                if (coupe) {
                    ex.close()
                    return@createContext
                }
                router(ex)
            } catch (e: Exception) {
                try {
                    repondre(ex, 500, mapOf("ok" to false, "code" to "interne", "erreur" to e.toString()))
                } catch (_: Exception) {
                }
            }
        }
        serveur.start()
    }

    fun arreter() {
        couperFlux()
        serveur.stop(0)
    }

    fun couperFlux() {
        for (f in flux) f.q.offer("FIN")
    }

    // ------------------------------------------------------------ outils pour les essais

    fun ouvrirSession(appareil: String): Pair<String, String> {
        val n = compteur.incrementAndGet()
        val a = "acces-$n"
        val r = "odr1.s$n.secret$n"
        acces[a] = appareil
        renouvellements[r] = appareil
        return a to r
    }

    /** Tous les jetons d'accès expirent (le renouvellement doit prendre le relais). */
    fun expirerAcces() = acces.clear()

    fun mettre(e: Enregistrement) {
        cols[e.col]!![e.id] = e
    }

    fun verif() = diffuser(null, "verif", Json.ecrire(mapOf("serveur" to System.currentTimeMillis(), "empreintes" to empreintes())))

    fun revoquer(appareil: String) {
        acces.entries.removeIf { it.value == appareil }
        renouvellements.entries.removeIf { it.value == appareil }
        for (f in flux) if (f.appareil == appareil) {
            f.q.offer("event: revoque\ndata: {\"texte\":\"Cet appareil a été déconnecté depuis Odin.\"}\n\n")
            f.q.offer("FIN")
        }
    }

    fun nbFlux() = flux.size

    // ------------------------------------------------------------ HTTP

    private fun repondre(ex: HttpExchange, statut: Int, corps: Map<String, Any?>) {
        val b = Json.ecrire(corps).toByteArray(Charsets.UTF_8)
        ex.responseHeaders.add("content-type", "application/json; charset=utf-8")
        ex.sendResponseHeaders(statut, b.size.toLong())
        ex.responseBody.use { it.write(b) }
    }

    private fun corpsJson(ex: HttpExchange): Map<String, Any?> = Json.objet(String(ex.requestBody.readBytes(), Charsets.UTF_8))

    private fun formulaire(ex: HttpExchange): Map<String, String> = Oidc.parametres("x://y/?" + String(ex.requestBody.readBytes(), Charsets.UTF_8))

    private fun appareilDe(ex: HttpExchange): String? {
        val h = ex.requestHeaders.getFirst("authorization") ?: return null
        return acces[h.removePrefix("Bearer ")]
    }

    private fun empreintes() = Cols.TOUTES.associateWith { Empreintes.de(cols[it]!!.values).versJson() }

    private fun diffuser(sauf: String?, type: String, data: String) {
        for (f in flux) if (f.appareil != sauf) f.q.offer("event: $type\ndata: $data\n\n")
    }

    private fun router(ex: HttpExchange) {
        val chemin = ex.requestURI.path
        when {
            chemin == "/api/pegase/bonjour" -> repondre(
                ex, 200,
                mapOf("odin" to true, "nom" to "Odin", "version" to "1.24.1", "protocole" to 1, "empreinte" to null, "https" to false, "dns" to false, "comptes" to true),
            )
            chemin == "/sso/connexion" -> {
                val c = corpsJson(ex)
                val id = c.texte("identifiant")
                val app = c.objet("appareil")?.texte("id") ?: return repondre(ex, 400, mapOf("ok" to false, "code" to "requete_invalide", "message" to "appareil manquant"))
                when {
                    id == "sans-droit" -> repondre(ex, 403, mapOf("ok" to false, "code" to "refuse", "message" to "Tu n'as pas accès à Pégase. Demande à Awa de t'ajouter au groupe famille."))
                    c.texte("motdepasse") != "bon-mot-de-passe-123" -> repondre(ex, 401, mapOf("ok" to false, "code" to "identifiants", "message" to "Identifiant ou mot de passe incorrect."))
                    else -> {
                        val (a, r) = ouvrirSession(app)
                        repondre(
                            ex, 200,
                            mapOf(
                                "ok" to true, "access_token" to a, "token_type" to "Bearer", "expires_in" to 900, "refresh_token" to r,
                                "personne" to mapOf("sub" to "a41f0c9e2b", "preferred_username" to "awa", "name" to "Awa Saïd", "groups" to listOf("famille")),
                                "appli" to "pegase", "applis" to listOf("pegase"),
                            ),
                        )
                    }
                }
            }
            chemin == "/sso/jeton" -> {
                val f = formulaire(ex)
                if (f["grant_type"] != "refresh_token") return repondre(ex, 400, mapOf("error" to "unsupported_grant_type"))
                val app = renouvellements.remove(f["refresh_token"] ?: "")
                if (app == null || app != f["appareil"]) {
                    return repondre(ex, 400, mapOf("error" to "invalid_grant", "error_description" to "Ta session a été coupée : reconnecte-toi.", "message" to "Ta session a été coupée : reconnecte-toi."))
                }
                val (a, r) = ouvrirSession(app)
                repondre(ex, 200, mapOf("access_token" to a, "token_type" to "Bearer", "expires_in" to 900, "refresh_token" to r))
            }
            chemin == "/sso/revoquer" -> {
                renouvellements.remove(corpsJson(ex).texte("token") ?: "")
                repondre(ex, 200, mapOf("ok" to true))
            }
            chemin.startsWith("/api/pegase/") -> {
                val app = appareilDe(ex)
                    ?: return repondre(ex, 401, mapOf("ok" to false, "code" to "jeton_invalide", "erreur" to "Ce Pégase n'est plus reconnu par Odin : reconnecte-toi."))
                pegase(ex, chemin.removePrefix("/api/pegase/"), app)
            }
            else -> repondre(ex, 404, mapOf("ok" to false, "code" to "introuvable", "erreur" to "Route inconnue."))
        }
    }

    private fun pegase(ex: HttpExchange, route: String, app: String) {
        when (route) {
            "envoyer" -> {
                envois.incrementAndGet()
                val l = corpsJson(ex).liste("changements")!!.objets()
                val gagnants = ArrayList<Map<String, Any?>>()
                val ignores = ArrayList<Map<String, Any?>>()
                val acceptes = ArrayList<Map<String, Any?>>()
                var appliques = 0
                for (m in l) {
                    val e = Enregistrement.deJson(m)?.copy(appareil = app) ?: continue
                    val col = cols[e.col]!!
                    synchronized(col) {
                        val actuel = col[e.id]
                        if (Fusion.gagne(e, actuel)) {
                            col[e.id] = e
                            appliques++
                            acceptes += e.versJson()
                        } else if (actuel != e) {
                            ignores += mapOf("id" to e.id, "col" to e.col, "raison" to "plus ancien")
                            gagnants += actuel!!.versJson()
                        }
                    }
                }
                if (acceptes.isNotEmpty()) diffuser(app, "changements", Json.ecrire(mapOf("changements" to acceptes)))
                repondre(ex, 200, mapOf("ok" to true, "serveur" to System.currentTimeMillis(), "appliques" to appliques, "ignores" to ignores, "refuses" to emptyList<Any>(), "gagnants" to gagnants))
            }
            "empreintes" -> repondre(ex, 200, empreintes())
            "tirer" -> {
                val c = corpsJson(ex)
                val depuis = c.entier("depuis")
                val col = c.texte("col")!!
                val tri = cols[col]!!.values.filter { depuis == null || it.maj >= depuis }.sortedWith(compareBy({ it.maj }, { it.id }))
                val n = limitePage
                if (tri.size <= n) {
                    repondre(ex, 200, mapOf("ok" to true, "col" to col, "changements" to tri.map { it.versJson() }, "complet" to true, "suite" to null))
                } else {
                    val part = tri.take(n)
                    repondre(ex, 200, mapOf("ok" to true, "col" to col, "changements" to part.map { it.versJson() }, "complet" to false, "suite" to part.last().maj))
                }
            }
            "flux" -> {
                val f = Flux(app, LinkedBlockingQueue())
                ex.responseHeaders.add("content-type", "text/event-stream")
                ex.sendResponseHeaders(200, 0)
                val sortie = ex.responseBody
                flux += f
                try {
                    sortie.write("event: bonjour\ndata: {\"profil\":\"p_1\",\"appareil\":\"$app\"}\n\n".toByteArray())
                    sortie.flush()
                    while (true) {
                        val m = f.q.poll(30, TimeUnit.SECONDS) ?: ": signe de vie\n\n"
                        if (m == "FIN" || coupe) break
                        sortie.write(m.toByteArray(Charsets.UTF_8))
                        sortie.flush()
                    }
                } catch (_: Exception) {
                } finally {
                    flux -= f
                    try {
                        sortie.close()
                    } catch (_: Exception) {
                    }
                }
            }
            "moi" -> repondre(ex, 200, mapOf("ok" to true, "profil" to mapOf("id" to "a41f0c9e2b", "nom" to "Awa"), "appareil" to mapOf("id" to app)))
            else -> repondre(ex, 404, mapOf("ok" to false, "code" to "introuvable", "erreur" to "Route inconnue."))
        }
    }
}
