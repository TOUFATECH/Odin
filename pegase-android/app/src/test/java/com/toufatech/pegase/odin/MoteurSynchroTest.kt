package com.toufatech.pegase.odin

import com.toufatech.pegase.coeur.Cols
import com.toufatech.pegase.coeur.Donnees
import com.toufatech.pegase.coeur.Empreintes
import com.toufatech.pegase.coeur.Enregistrement
import com.toufatech.pegase.coeur.EtatSynchro
import com.toufatech.pegase.coeur.FileAttente
import com.toufatech.pegase.coeur.Indicateur
import com.toufatech.pegase.stockage.ChiffreurAes
import com.toufatech.pegase.stockage.Magasin
import org.junit.After
import org.junit.Test
import java.io.File
import java.nio.file.Files
import javax.crypto.KeyGenerator
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** La synchro en vrai : un faux Odin HTTP local, deux « téléphones », de vraies requêtes et un vrai flux SSE. */
class MoteurSynchroTest {
    private val odin = FauxOdin()
    private val dossiers = ArrayList<File>()
    private val moteurs = ArrayList<MoteurSynchro>()
    private val cle = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    @After
    fun fin() {
        for (m in moteurs) m.arreter()
        odin.arreter()
        for (d in dossiers) d.deleteRecursively()
    }

    private class Telephone(val moteur: MoteurSynchro, val magasin: Magasin, val auth: Authentification, val indicateurs: MutableList<Indicateur>, val revoques: MutableList<String>)

    private fun telephone(appareil: String, dossier: File? = null): Telephone {
        val d = dossier ?: Files.createTempDirectory("pegase-essai").toFile().also { dossiers += it }
        val magasin = Magasin(d, ChiffreurAes { cle })
        val donnees = Donnees()
        val file = FileAttente()
        magasin.charger(donnees, file)
        val indicateurs = java.util.Collections.synchronizedList(ArrayList<Indicateur>())
        val revoques = java.util.Collections.synchronizedList(ArrayList<String>())
        val (a, r) = odin.ouvrirSession(appareil)
        val session = Session(odin.base, null, appareil, "Téléphone $appareil", acces = a, expire = System.currentTimeMillis() + 900_000, renouvellement = r)
        val client = ClientOdin(odin.base)
        val auth = Authentification(client, HORLOGE_SYSTEME, session) { }
        val moteur = MoteurSynchro(
            donnees, file, magasin,
            ecoute = object : EcouteSynchro {
                override fun indicateur(i: Indicateur) {
                    indicateurs += i
                }

                override fun revoque(texte: String) {
                    revoques += texte
                }
            },
        )
        moteurs += moteur
        return Telephone(moteur, magasin, auth, indicateurs, revoques)
    }

    private fun brancher(t: Telephone) = t.moteur.demarrer(ApiPegase(ClientOdin(odin.base), t.auth))

    private fun attendre(delaiMs: Long = 5000, quoi: String, cond: () -> Boolean) {
        val fin = System.currentTimeMillis() + delaiMs
        while (System.currentTimeMillis() < fin) {
            if (cond()) return
            Thread.sleep(20)
        }
        throw AssertionError("délai dépassé : $quoi")
    }

    @Test
    fun unFavoriArriveSurLAutreTelephoneEnMoinsDUneSeconde() {
        val a = telephone("app-a-0001")
        val b = telephone("app-b-0002")
        brancher(a)
        brancher(b)
        attendre(quoi = "deux flux ouverts") { odin.nbFlux() == 2 }
        val t0 = System.currentTimeMillis()
        a.moteur.modifier(Cols.FAVORIS, "f-mayotte", mapOf("url" to "https://mayotte.fr", "titre" to "Mayotte"))
        attendre(quoi = "favori reçu par B") { b.moteur.donnees.un(Cols.FAVORIS, "f-mayotte") != null }
        val duree = System.currentTimeMillis() - t0
        assertTrue(duree < 1000, "arrivé en $duree ms")
        assertEquals("Mayotte", b.moteur.donnees.un(Cols.FAVORIS, "f-mayotte")!!.data["titre"])
        // Odin a remplacé l'appareil par celui du jeton.
        assertEquals("app-a-0001", odin.cols[Cols.FAVORIS]!!["f-mayotte"]!!.appareil)
        attendre(quoi = "file vide") { a.moteur.file.taille == 0 }
    }

    @Test
    fun lesChangementsRapprochesPartentEnUnSeulEnvoi() {
        val a = telephone("app-a-0001")
        brancher(a)
        attendre(quoi = "flux") { odin.nbFlux() == 1 }
        a.moteur.attendre()
        Thread.sleep(300)
        val avant = odin.envois.get()
        for (i in 1..20) a.moteur.modifier(Cols.HISTORIQUE, "h-$i", mapOf("url" to "https://exemple.yt/$i", "date" to i))
        attendre(quoi = "20 visites chez Odin") { odin.cols[Cols.HISTORIQUE]!!.size == 20 }
        assertTrue(odin.envois.get() - avant <= 2, "${odin.envois.get() - avant} envois pour 20 changements")
    }

    @Test
    fun horsLignePuisRattrapage() {
        val dossier = Files.createTempDirectory("pegase-essai").toFile().also { dossiers += it }
        val a = telephone("app-a-0001", dossier)
        odin.coupe = true
        brancher(a)
        a.moteur.modifier(Cols.FAVORIS, "f1", mapOf("titre" to "un"))
        a.moteur.modifier(Cols.AGENDA, "r1", mapOf("titre" to "Dentiste", "debut" to "2026-11-20T09:00:00+03:00", "fin" to "2026-11-20T09:30:00+03:00"))
        a.moteur.modifier(Cols.FAVORIS, "f2", mapOf("titre" to "deux"))
        attendre(quoi = "hors ligne (3 en attente)") { a.moteur.indicateur.let { it.etat == EtatSynchro.HORS_LIGNE && it.enAttente == 3 } }
        assertEquals("hors ligne (3 en attente)", a.moteur.indicateur.texte)
        // L'appli est fermée : la file et les données sont sur le disque, chiffrées.
        a.moteur.arreter()
        moteurs.remove(a.moteur)
        assertTrue(dossier.listFiles()!!.none { f -> String(f.readBytes(), Charsets.ISO_8859_1).contains("Dentiste") }, "rien en clair sur le disque")
        // Elle se rouvre, Odin revient : tout part.
        odin.coupe = false
        val a2 = telephone("app-a-0001", dossier)
        assertEquals(3, a2.moteur.file.taille)
        assertEquals("Dentiste", a2.moteur.donnees.un(Cols.AGENDA, "r1")!!.data["titre"])
        brancher(a2)
        attendre(quoi = "rattrapage") { odin.cols[Cols.FAVORIS]!!.size == 2 && odin.cols[Cols.AGENDA]!!.size == 1 }
        attendre(quoi = "synchronisé") { a2.moteur.indicateur.etat == EtatSynchro.SYNCHRONISE && a2.moteur.file.taille == 0 }
        assertEquals("Odin · synchronisé", a2.moteur.indicateur.texte)
    }

    @Test
    fun conflitLePlusRecentGagnePartout() {
        val a = telephone("app-a-0001")
        val b = telephone("app-b-0002")
        // Les deux modifient le même favori hors ligne ; B le fait plus tard.
        odin.coupe = true
        brancher(a)
        brancher(b)
        a.moteur.modifier(Cols.FAVORIS, "f-commun", mapOf("titre" to "version A"))
        Thread.sleep(15)
        b.moteur.modifier(Cols.FAVORIS, "f-commun", mapOf("titre" to "version B"))
        Thread.sleep(300)
        odin.coupe = false
        a.moteur.verifierMaintenant()
        b.moteur.verifierMaintenant()
        attendre(8000, "les deux voient la version B") {
            a.moteur.donnees.un(Cols.FAVORIS, "f-commun")?.data?.get("titre") == "version B" &&
                b.moteur.donnees.un(Cols.FAVORIS, "f-commun")?.data?.get("titre") == "version B" &&
                odin.cols[Cols.FAVORIS]!!["f-commun"]?.data?.get("titre") == "version B"
        }
    }

    @Test
    fun lesEmpreintesRattrapentCeQuiAEchappeAuFlux() {
        val a = telephone("app-a-0001")
        // Chez Odin : 7 favoris venus d'ailleurs (le téléphone ne les a jamais reçus), page de 3 pour essayer la suite.
        odin.limitePage = 3
        for (i in 1..7) odin.mettre(Enregistrement("o-$i", Cols.FAVORIS, mapOf("titre" to "odin $i"), 1000L + i, "app-pc"))
        // Chez le téléphone : 2 favoris qu'Odin n'a pas, et qui ne sont plus dans la file (file perdue).
        a.moteur.donnees.appliquer(Enregistrement("t-1", Cols.FAVORIS, mapOf("titre" to "tel 1"), 2000, "local"))
        a.moteur.donnees.appliquer(Enregistrement("t-2", Cols.FAVORIS, mapOf("titre" to "tel 2"), 2001, "local", suppr = true))
        brancher(a)
        attendre(8000, "mêmes empreintes") {
            Empreintes.de(odin.cols[Cols.FAVORIS]!!.values) == a.moteur.donnees.empreinte(Cols.FAVORIS) && odin.cols[Cols.FAVORIS]!!.size == 9
        }
        assertEquals(8, a.moteur.donnees.actifs(Cols.FAVORIS).size)
        attendre(quoi = "synchronisé") { a.moteur.indicateur.etat == EtatSynchro.SYNCHRONISE }
        // Une « verif » d'Odin plus tard ne change rien.
        odin.verif()
        Thread.sleep(300)
        a.moteur.attendre()
        assertEquals(EtatSynchro.SYNCHRONISE, a.moteur.indicateur.etat)
    }

    @Test
    fun jetonExpireRenouveleTouSeul() {
        val a = telephone("app-a-0001")
        brancher(a)
        attendre(quoi = "flux") { odin.nbFlux() == 1 }
        val ancien = a.auth.session!!.renouvellement
        odin.expirerAcces()
        a.moteur.modifier(Cols.REGLAGES, "theme", mapOf("valeur" to "glace"))
        attendre(quoi = "réglage chez Odin") { odin.cols[Cols.REGLAGES]!!["theme"] != null }
        // Rotation : un nouveau jeton de renouvellement a remplacé l'ancien.
        assertTrue(a.auth.session!!.renouvellement != ancien)
    }

    @Test
    fun appareilRevoqueDepuisOdin() {
        val a = telephone("app-a-0001")
        var perdu: String? = null
        a.auth.surPerte = { perdu = it }
        brancher(a)
        attendre(quoi = "flux") { odin.nbFlux() == 1 }
        odin.revoquer("app-a-0001")
        attendre(quoi = "révoqué") { a.revoques.isNotEmpty() }
        assertEquals("Cet appareil a été déconnecté depuis Odin.", a.revoques.first())
        assertEquals("Cet appareil a été déconnecté depuis Odin.", perdu)
        assertNull(a.auth.session)
    }
}
