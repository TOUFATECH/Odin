package com.toufatech.pegase.coeur

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SynchroTest {
    private fun e(id: String, maj: Long, appareil: String = "a_moi", col: String = Cols.FAVORIS, suppr: Boolean = false, titre: String = id) =
        Enregistrement(id, col, if (suppr) emptyMap() else mapOf("titre" to titre), maj, appareil, suppr)

    @Test
    fun empreinteDUneCollectionVide() {
        assertEquals(Empreinte(0, Empreintes.VIDE), Empreintes.de(emptyList()))
        assertEquals(Empreintes.VIDE, Empreintes.sha256Hex(""))
    }

    @Test
    fun empreinteCommeOdin() {
        // Exemple du protocole : a:2 et b:10 → "a:2\nb:10" (même valeur calculée par Node, comme dans Odin).
        val emp = Empreintes.de(listOf(e("b", 10), e("a", 2)))
        assertEquals(2, emp.n)
        assertEquals("7c8e706eeabf170d5008c3f6ca7dd636c41f54e1e44b3bb9d2cc2b1bbc13f30e", emp.hash)
    }

    @Test
    fun triParCodesCommeJavaScript() {
        // Tri JavaScript par défaut : "B:1" < "Z:3" < "a:10" < "a:2" < "b:10" < "é:5"
        val l = listOf(e("b", 10), e("a", 2), e("B", 1), e("Z", 3), e("é", 5, appareil = "x"))
        assertEquals("B:1\nZ:3\na:2\nb:10\né:5", Empreintes.texte(l))
        val l2 = listOf(e("a", 10), e("b", 10))
        assertEquals("a:10\nb:10", Empreintes.texte(l2))
        assertEquals(
            "b0368d20b7c65c342fce4d0ae8a65db539698d506dcdff19cc6f107b3edd84aa",
            Empreintes.sha256Hex(listOf("b:10", "a:2", "B:1", "a:10", "é:5", "Z:3").sorted().joinToString("\n")),
        )
    }

    @Test
    fun lesPierresTombalesComptent() {
        val d = Donnees()
        d.appliquer(e("x", 5))
        d.appliquer(e("x", 6, suppr = true))
        assertEquals(1, d.empreinte(Cols.FAVORIS).n)
        assertEquals(0, d.actifs(Cols.FAVORIS).size)
        assertEquals(Empreintes.sha256Hex("x:6"), d.empreinte(Cols.FAVORIS).hash)
    }

    @Test
    fun conflitLePlusRecentGagne() {
        assertTrue(Fusion.gagne(e("x", 2), e("x", 1)))
        assertFalse(Fusion.gagne(e("x", 1), e("x", 2)))
        // À égalité : l'appareil au plus petit identifiant gagne.
        assertTrue(Fusion.gagne(e("x", 5, "a_1"), e("x", 5, "a_2")))
        assertFalse(Fusion.gagne(e("x", 5, "a_2"), e("x", 5, "a_1")))
        // La même version ne remplace rien.
        assertFalse(Fusion.gagne(e("x", 5, "a_1"), e("x", 5, "a_1")))
        assertTrue(Fusion.gagne(e("x", 1), null))
    }

    @Test
    fun donneesIgnorentUneVersionPerdante() {
        val d = Donnees()
        assertTrue(d.appliquer(e("x", 10, titre = "neuf")))
        assertFalse(d.appliquer(e("x", 9, titre = "vieux")))
        assertEquals("neuf", d.un(Cols.FAVORIS, "x")!!.data["titre"])
    }

    @Test
    fun rapprochementPrendEtRenvoie() {
        val locaux = listOf(e("commun", 5), e("chez-moi", 3), e("plus-neuf-ici", 20), e("plus-vieux-ici", 1))
        val distants = listOf(e("commun", 5), e("chez-odin", 4, "a_autre"), e("plus-neuf-ici", 10, "a_autre"), e("plus-vieux-ici", 7, "a_autre"))
        val r = Rapprochement.calculer(locaux, distants)
        assertEquals(listOf("chez-odin", "plus-vieux-ici"), r.aAppliquer.map { it.id }.sorted())
        assertEquals(listOf("chez-moi", "plus-neuf-ici"), r.aEnvoyer.map { it.id }.sorted())
    }

    @Test
    fun fileAttenteGardeLaDerniereVersion() {
        val f = FileAttente()
        f.ajouter(e("x", 1, titre = "un"))
        f.ajouter(e("y", 1))
        f.ajouter(e("x", 2, titre = "deux"))
        assertEquals(2, f.taille)
        assertEquals("deux", f.tout().first { it.id == "x" }.data["titre"])
        // Odin a reçu la version 2 de x, mais y a changé entre-temps : y reste dans la file.
        val lot = f.lot()
        f.ajouter(e("y", 3, titre = "modifié"))
        f.retirer(lot)
        assertEquals(listOf("y"), f.tout().map { it.id })
        // Elle se relit telle quelle depuis le disque.
        val g = FileAttente()
        g.charger(f.versJson())
        assertEquals(f.tout(), g.tout())
        g.charger("pas du json")
        assertEquals(0, g.taille)
    }

    @Test
    fun lotRespecteLesLimitesDOdin() {
        val f = FileAttente()
        for (i in 0 until 1500) f.ajouter(e("id-$i", i.toLong()))
        assertEquals(1000, f.lot().size)
        val gros = "x".repeat(60_000)
        val g = FileAttente()
        for (i in 0 until 50) g.ajouter(Enregistrement("g-$i", Cols.HISTORIQUE, mapOf("titre" to gros), i.toLong(), "a_moi"))
        val lot = g.lot()
        assertTrue(lot.size in 20..32, "lot de ${lot.size}")
        assertTrue(Json.ecrire(mapOf("changements" to lot.map { it.versJson() })).length < 2_000_000)
    }

    @Test
    fun enregistrementDuJson() {
        val m = Json.objet("""{"id":"f-1","col":"favoris","data":{"url":"https://mayotte.fr"},"maj":1763112000123,"appareil":"a_9f"}""")
        val r = Enregistrement.deJson(m)!!
        assertEquals("https://mayotte.fr", r.data["url"])
        assertFalse(r.suppr)
        assertNull(Enregistrement.deJson(Json.objet("""{"id":"mauvais id!","col":"favoris","maj":1}""")))
        assertNull(Enregistrement.deJson(Json.objet("""{"id":"x","col":"cookies","maj":1}""")))
        val t = Enregistrement("x", Cols.FAVORIS, mapOf("a" to 1), 5, "a", suppr = true).versJson()
        assertEquals(true, t["suppr"])
        assertEquals(emptyMap<String, Any?>(), t["data"])
    }

    @Test
    fun differencesDEmpreintes() {
        val loc = mapOf(Cols.FAVORIS to Empreinte(1, "a"), Cols.AGENDA to Empreinte(0, Empreintes.VIDE))
        val dist = mapOf(Cols.FAVORIS to Empreinte(2, "b"), Cols.AGENDA to Empreinte(0, Empreintes.VIDE), Cols.ONGLETS to Empreinte(1, "c"))
        assertEquals(listOf(Cols.FAVORIS, Cols.ONGLETS), Empreintes.differentes(loc, dist))
        val lu = Empreintes.deJson(Json.objet("""{"favoris":{"n":12,"hash":"h"},"inconnu":{"n":1,"hash":"z"}}"""))
        assertEquals(mapOf(Cols.FAVORIS to Empreinte(12, "h")), lu)
    }

    @Test
    fun indicateurEtDates() {
        assertEquals("Odin · synchronisé", Indicateur(EtatSynchro.SYNCHRONISE, 0).texte)
        assertEquals("hors ligne (3 en attente)", Indicateur(EtatSynchro.HORS_LIGNE, 3).texte)
        assertEquals(1000L, prochaineMaj(1000, null))
        assertEquals(1501L, prochaineMaj(1000, e("x", 1500)))
    }
}
