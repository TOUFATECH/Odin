package com.toufatech.pegase.odin

import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import com.toufatech.pegase.coeur.Decouverte
import com.toufatech.pegase.stockage.ChiffreurAes
import com.toufatech.pegase.stockage.Magasin
import org.junit.After
import org.junit.Test
import java.io.File
import java.io.FileInputStream
import java.net.InetSocketAddress
import java.nio.file.Files
import java.security.KeyStore
import java.security.cert.X509Certificate
import javax.crypto.KeyGenerator
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ConnexionTest {
    private val odin = FauxOdin()
    private val aFermer = ArrayList<() -> Unit>()

    @After
    fun fin() {
        odin.arreter()
        aFermer.forEach { it() }
    }

    private fun base() = Session(odin.base, null, "app-test-0001", "Téléphone d'essai")

    @Test
    fun connexionDirecteParLeSsoDOdin() {
        val s = Authentification.connexionDirecte(ClientOdin(odin.base), HORLOGE_SYSTEME, base(), "awa@exemple.yt", "bon-mot-de-passe-123", null)
        assertNotNull(s.acces)
        assertNotNull(s.renouvellement)
        assertEquals("Awa Saïd", s.nom)
        assertEquals("a41f0c9e2b", s.profilId)
        // Le mot de passe n'est gardé nulle part.
        assertTrue("bon-mot-de-passe-123" !in s.versJson())
        assertEquals(s, Session.deJson(s.versJson()))
    }

    @Test
    fun mauvaisMotDePasseEtPasLeDroit() {
        val c = ClientOdin(odin.base)
        val e1 = assertFailsWith<ErreurOdin> { Authentification.connexionDirecte(c, HORLOGE_SYSTEME, base(), "awa", "faux", null) }
        assertEquals("identifiants", e1.code)
        assertEquals("Identifiant ou mot de passe incorrect.", e1.message)
        // Sans droit sur Pégase : le message d'Odin, tel quel.
        val e2 = assertFailsWith<ErreurOdin> { Authentification.connexionDirecte(c, HORLOGE_SYSTEME, base(), "sans-droit", "x", null) }
        assertEquals(403, e2.statut)
        assertEquals("Tu n'as pas accès à Pégase. Demande à Awa de t'ajouter au groupe famille.", e2.message)
    }

    @Test
    fun renouvellementRefuseFaitPerdreLaSession() {
        val sauvees = ArrayList<Session?>()
        val s = base().copy(acces = "x", expire = 0, renouvellement = "odr1.inconnu.x")
        val auth = Authentification(ClientOdin(odin.base), HORLOGE_SYSTEME, s) { sauvees += it }
        var message: String? = null
        auth.surPerte = { message = it }
        assertFailsWith<ErreurOdin> { auth.jeton() }
        assertNull(auth.session)
        assertEquals(listOf<Session?>(null), sauvees)
        assertEquals("Ta session a été coupée : reconnecte-toi.", message)
    }

    @Test
    fun odinInjoignable() {
        val c = ClientOdin("http://127.0.0.1:1")
        val e = assertFailsWith<ErreurOdin> { c.getJson("/api/pegase/bonjour") }
        assertTrue(e.horsLigne)
        assertTrue(e.message!!.startsWith("Odin ne répond pas"))
    }

    @Test
    fun trouveOdinSurLeReseau() {
        val port = odin.base.substringAfterLast(':').toInt()
        val candidats = listOf(Decouverte.Candidat("127.0.0.1", 1), Decouverte.Candidat("127.0.0.2", 9), Decouverte.Candidat("127.0.0.1", port))
        val t = Decouvreur.chercher(candidats, delaiMs = 800)
        assertEquals(1, t.size)
        assertEquals("http://127.0.0.1:$port", t[0].base)
        assertEquals("1.24.1", t[0].version)
        assertTrue(Decouvreur.chercher(candidats.take(2), delaiMs = 500).isEmpty())
    }

    /** Un vrai serveur HTTPS avec un certificat auto-signé (créé par keytool), comme Odin. */
    private fun odinHttps(): Pair<String, String> {
        val dossier = Files.createTempDirectory("pegase-tls").toFile()
        aFermer += { dossier.deleteRecursively() }
        val ks = File(dossier, "odin.p12")
        val keytool = File(System.getProperty("java.home"), "bin/keytool").path
        val p = ProcessBuilder(
            keytool, "-genkeypair", "-alias", "odin", "-keyalg", "EC", "-groupname", "secp256r1", "-dname", "CN=Odin",
            "-validity", "30", "-storetype", "PKCS12", "-keystore", ks.path, "-storepass", "essai-123", "-keypass", "essai-123",
        ).redirectErrorStream(true).start()
        p.inputStream.readBytes()
        assertEquals(0, p.waitFor(), "keytool")
        val magasin = KeyStore.getInstance("PKCS12").apply { FileInputStream(ks).use { load(it, "essai-123".toCharArray()) } }
        val empreinte = Epinglage.empreinte(magasin.getCertificate("odin") as X509Certificate)
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(magasin, "essai-123".toCharArray()) }
        val ssl = SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }
        val serveur = HttpsServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serveur.httpsConfigurator = HttpsConfigurator(ssl)
        serveur.createContext("/api/pegase/bonjour") { ex ->
            val b = """{"odin":true,"nom":"Odin","version":"1.24.1","protocole":1,"empreinte":"$empreinte","https":true,"dns":true,"comptes":true}""".toByteArray()
            ex.responseHeaders.add("content-type", "application/json")
            ex.sendResponseHeaders(200, b.size.toLong())
            ex.responseBody.use { it.write(b) }
        }
        serveur.start()
        aFermer += { serveur.stop(0) }
        return "https://127.0.0.1:${serveur.address.port}" to empreinte
    }

    @Test
    fun certificatEpingle() {
        val (adresse, empreinte) = odinHttps()
        // Premier contact : on retient le certificat réellement présenté, et il correspond à ce qu'Odin annonce.
        val b = ApiPegase.bonjour(ClientOdin(adresse, Epinglage(null)))
        assertNotNull(b)
        assertEquals(empreinte, b.empreinte)
        assertTrue(b.dns)
        // Ensuite : le même certificat passe…
        assertNotNull(ApiPegase.bonjour(ClientOdin(adresse, Epinglage(empreinte))))
        // … un autre est refusé.
        val e = assertFailsWith<ErreurOdin> { ClientOdin(adresse, Epinglage("00".repeat(32))).getJson("/api/pegase/bonjour") }
        assertEquals("certificat", e.code)
        assertTrue(Epinglage.courte(empreinte).matches(Regex("[0-9A-F]{4}(·[0-9A-F]{4}){3}")))
    }

    @Test
    fun magasinChiffreEtSurvitAUneCleChangee() {
        val dossier = Files.createTempDirectory("pegase-magasin").toFile()
        aFermer += { dossier.deleteRecursively() }
        val cle = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val m = Magasin(dossier, ChiffreurAes { cle })
        m.ecrire("session", "jeton-tres-secret")
        assertEquals("jeton-tres-secret", m.lire("session"))
        assertTrue(dossier.listFiles()!!.none { String(it.readBytes(), Charsets.ISO_8859_1).contains("secret") })
        // Clé perdue (téléphone restauré) : le fichier est mis de côté, rien ne plante.
        val autre = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        assertNull(Magasin(dossier, ChiffreurAes { autre }).lire("session"))
        assertTrue(File(dossier, "session.illisible").exists())
    }
}
