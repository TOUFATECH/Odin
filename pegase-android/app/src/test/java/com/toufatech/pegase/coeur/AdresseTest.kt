package com.toufatech.pegase.coeur

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AdresseTest {
    @Test
    fun adresseOuRecherche() {
        assertEquals("https://toufatech.com", Adresse.versUrl("toufatech.com"))
        assertEquals("https://oqgbarber.com/admin", Adresse.versUrl("  oqgbarber.com/admin "))
        assertEquals("https://mayotte.fr", Adresse.versUrl("https://mayotte.fr"))
        assertEquals("http://192.168.1.10:7777", Adresse.versUrl("192.168.1.10:7777"))
        assertEquals("http://localhost:8080/x", Adresse.versUrl("localhost:8080/x"))
        assertEquals("https://duckduckgo.com/?q=devis+Starlink", Adresse.versUrl("devis Starlink"))
        assertEquals("https://duckduckgo.com/?q=meteo", Adresse.versUrl("meteo"))
        assertEquals("about:blank", Adresse.versUrl(""))
        // Jamais de « javascript: » ou de fichier ouvert depuis la barre.
        assertTrue(Adresse.versUrl("javascript:alert(1)").startsWith("https://duckduckgo.com/"))
        assertTrue(Adresse.versUrl("file:///sdcard/x").startsWith("https://duckduckgo.com/"))
        assertTrue(Adresse.versUrl("999.1.1.1").startsWith("https://duckduckgo.com/"))
    }

    @Test
    fun affichageEtRecherche() {
        assertEquals("toufatech.com", Adresse.pourAffichage("https://www.toufatech.com/devis?x=1"))
        assertEquals("", Adresse.pourAffichage("about:blank"))
        assertEquals("devis Starlink", Adresse.rechercheDe("https://duckduckgo.com/?q=devis+Starlink&ia=web"))
        assertNull(Adresse.rechercheDe("https://toufatech.com/"))
    }

    @Test
    fun trouverOdin() {
        val c = Decouverte.candidats("192.168.1.42")
        assertEquals(Decouverte.Candidat("127.0.0.1", 7777), c.first())
        assertEquals(1 + 253 * 2, c.size)
        assertFalse(c.any { it.hote == "192.168.1.42" })
        assertTrue(c.contains(Decouverte.Candidat("192.168.1.10", 7443)))
        assertEquals(1, Decouverte.candidats(null).size)
        assertEquals(1, Decouverte.candidats("pas une ip").size)
        assertEquals("https://192.168.1.10:7777", Decouverte.Candidat("192.168.1.10", 7777).base(true))
        assertEquals("192.168.1.42", Decouverte.choisirIp(listOf("100.70.1.2", "192.168.1.42")))
        assertNull(Decouverte.choisirIp(listOf("8.8.8.8")))
    }
}
