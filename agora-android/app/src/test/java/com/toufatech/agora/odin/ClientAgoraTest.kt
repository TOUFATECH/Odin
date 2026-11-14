package com.toufatech.agora.odin

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import com.toufatech.agora.coeur.EmpreinteFausse
import com.toufatech.agora.coeur.EvenementSse
import com.toufatech.agora.coeur.Json
import com.toufatech.agora.coeur.Regles
import com.toufatech.agora.coeur.Store
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Le client du store contre un faux Odin qui parle comme le vrai (src/web/agora-api.ts et src/valhalla/sso/oidc.ts) :
 * connexion unique, renouvellement, inscription, store, flux SSE, téléchargement et vérification de l'empreinte.
 * (Contre le VRAI Odin : voir le rapport, essai d'interopération lancé à part.)
 */
class ClientAgoraTest {
    private lateinit var srv: HttpServer
    private val vus = CopyOnWriteArrayList<String>()
    private var jetonValide = "acces-1"
    private val apk = "apk d'essai".toByteArray()
    private val sha = MessageDigest.getInstance("SHA-256").digest(apk).joinToString("") { "%02x".format(it) }
    private val adresse get() = "http://127.0.0.1:${srv.address.port}"

    private fun repondre(x: HttpExchange, code: Int, corps: String, type: String = "application/json") { val b = corps.toByteArray(); x.responseHeaders.add("content-type", type); x.sendResponseHeaders(code, b.size.toLong()); x.responseBody.use { it.write(b) } }
    @Before fun demarrer() {
        srv = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        srv.createContext("/") { x ->
            val corps = x.requestBody.readBytes().toString(Charsets.UTF_8); val auth = x.requestHeaders.getFirst("authorization") ?: ""
            vus += "${x.requestMethod} ${x.requestURI.path}"
            when (x.requestURI.path) {
                "/sso/connexion" -> { val j = Json.objet(corps); if (j["motdepasse"] == "bon-mot-de-passe-long" && j["appli"] == "agora") repondre(x, 200, """{"ok":true,"access_token":"acces-1","token_type":"Bearer","expires_in":900,"refresh_token":"odr1.s1.r1","personne":{"name":"Sami"}}""") else repondre(x, 401, """{"ok":false,"code":"mauvais_mot_de_passe","message":"Identifiant ou mot de passe faux."}""") }
                "/sso/jeton" -> if (corps.contains("refresh_token=odr1.s1.r1") && corps.contains("client_id=agora")) { jetonValide = "acces-2"; repondre(x, 200, """{"access_token":"acces-2","token_type":"Bearer","expires_in":900,"refresh_token":"odr1.s1.r2"}""") } else repondre(x, 400, """{"error":"invalid_grant","error_description":"Ce jeton de renouvellement a déjà servi."}""")
                else -> {
                    if (auth != "Bearer $jetonValide") return@createContext repondre(x, 401, """{"ok":false,"code":"jeton_invalide","message":"Ta connexion à Odin a expiré : renouvelle-la."}""")
                    when (x.requestURI.path) {
                        "/api/agora/inscrire" -> repondre(x, 200, """{"ok":true,"appareil":{"id":"tel-essai-0001","nom":"Pixel"},"personne":{"nom":"Sami","login":"sami","groupes":["famille"]},"store":[{"id":"pegase","nom":"Pégase","desc":"","mode":"office","par":"Awa","paquet":{"format":"apk","version":"1.0.0","sha256":"$sha","taille":${apk.size},"nomFichier":"p.apk","ident":"com.toufatech.pegase","telecharger":"/api/agora/telecharger?element=pegase&plateforme=android"}}],"ordres":[]}""")
                        "/api/agora/etat" -> repondre(x, 200, """{"ok":true}""")
                        "/api/agora/telecharger" -> { x.responseHeaders.add("x-odin-empreinte", sha); x.sendResponseHeaders(200, apk.size.toLong()); x.responseBody.use { it.write(apk) } }
                        "/api/agora/faux" -> { x.sendResponseHeaders(200, 0); x.responseBody.use { it.write(apk + byteArrayOf(1)) } }
                        "/api/agora/flux" -> { x.responseHeaders.add("content-type", "text/event-stream"); x.sendResponseHeaders(200, 0); x.responseBody.use { o -> o.write("event: bonjour\ndata: {\"appareil\":{}}\n\n: signe de vie\n\nevent: ordre\ndata: {\"id\":\"o1\",\"element\":\"pegase\",\"nom\":\"Pégase\",\"action\":\"installer\",\"version\":\"1.0.0\",\"impose\":true,\"par\":\"mode\",\"qui\":\"Awa\"}\n\n".toByteArray()); o.flush() } }
                        else -> repondre(x, 404, """{"ok":false,"code":"introuvable","message":"Route inconnue"}""")
                    }
                }
            }
        }
        srv.start()
    }
    @After fun arreter() { srv.stop(0) }

    @Test
    fun connexionUniqueInscriptionFluxEtTelechargement() {
        val gardees = CopyOnWriteArrayList<Session?>()
        val c = ClientAgora(adresse, null, "tel-essai-0001") { gardees += it }
        assertEquals(401, c.connecter("sami", "faux").statut)
        val r = c.connecter("sami", "bon-mot-de-passe-long"); assertTrue(r.ok)
        assertEquals("odr1.s1.r1", gardees.last()?.refresh, "la session est gardée (à chiffrer par le téléphone)")
        val i = c.inscrire("Pixel", "Android 16", "0.1.0", false); assertTrue(i.ok)
        val l = Store.articles(i.corps); assertEquals("com.toufatech.pegase", l[0].paquet?.ident)
        // Flux : l'ordre arrive, les signes de vie sont ignorés.
        val evs = CopyOnWriteArrayList<EvenementSse>(); c.flux { evs += it }
        assertEquals(listOf("bonjour", "ordre"), evs.map { it.type }); assertEquals("installer", Store.ordre(Json.objet(evs[1].data))?.action)
        // Téléchargement depuis Odin, empreinte vérifiée ; un fichier abîmé est refusé.
        val f = File.createTempFile("agora", ".apk")
        val (flux, taille) = c.telecharger(l[0].paquet!!.telecharger); flux.use { Regles.copierVerifie(it, f, sha, taille) }
        assertEquals(apk.toList(), f.readBytes().toList())
        val (faux, _) = c.telecharger("/api/agora/faux"); assertFailsWith<EmpreinteFausse> { faux.use { Regles.copierVerifie(it, f, sha) } }
        // Un lien externe doit être en https.
        assertFailsWith<ErreurOdin> { c.telecharger("http://exemple.fr/x.apk") }
    }

    @Test
    fun jetonExpireRenouveleTouSeulPuisSessionPerdue() {
        val gardees = CopyOnWriteArrayList<Session?>()
        val c = ClientAgora(adresse, null, "tel-essai-0001") { gardees += it }
        assertTrue(c.connecter("sami", "bon-mot-de-passe-long").ok)
        jetonValide = "autre" // Odin a « oublié » le jeton d'accès : 401, renouvellement, nouvel essai
        assertTrue(c.etat("pegase", "installee", "o1", version = "1.0.0").ok)
        assertTrue(vus.contains("POST /sso/jeton")); assertEquals("odr1.s1.r2", gardees.last()?.refresh)
        // Session reprise avec un jeton de renouvellement déjà servi : perdue (il faut se reconnecter).
        val d = ClientAgora(adresse, null, "tel-essai-0001") { gardees += it }
        assertEquals(false, d.reprendre(Session(adresse, null, "odr1.s9.vieux", "tel-essai-0001")))
        assertEquals(null, gardees.last())
        assertNotNull(c.refresh)
    }
}
