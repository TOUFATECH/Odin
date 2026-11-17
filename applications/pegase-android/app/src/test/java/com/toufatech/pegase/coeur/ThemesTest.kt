package com.toufatech.pegase.coeur

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ThemesTest {
    @Test
    fun lesSixCouleursEtAuto() {
        assertEquals(listOf("noir", "blanc", "bleu", "rouge", "transparent", "glace", "auto"), Theme.CHOIX.map { it.id })
        assertEquals(Theme.BLEU, Theme.deId(null))
        assertEquals(Theme.BLEU, Theme.deId("inconnu"))
        assertEquals(Theme.GLACE, Theme.deId("glace"))
        assertEquals(setOf(Theme.BLANC, Theme.GLACE), Theme.entries.filter { it.clair }.toSet())
        assertEquals(Theme.NOIR, Theme.AUTO.resolu(true))
        assertEquals(Theme.BLANC, Theme.AUTO.resolu(false))
        assertEquals("Transp.", Theme.TRANSPARENT.nomCourt)
    }

    @Test
    fun leTexteResteLisibleSurChaqueTheme() {
        for (t in Theme.CHOIX) {
            for (sombre in listOf(true, false)) {
                val p = Palettes.de(t, sombre)
                if (p.vitre) continue // le fond d'écran du téléphone se voit : vérifié à part ci-dessous
                // Les deux bouts du voile posé sur la couleur de base.
                for (arret in p.voile) {
                    val fond = Palettes.poser(arret.couleur, p.base)
                    val c = Palettes.contraste(p.texte, fond)
                    assertTrue(c >= 4.5, "${t.id} : contraste $c trop faible")
                }
                for (tache in p.taches) {
                    val fond = Palettes.poser(p.voile.first().couleur, tache.couleur)
                    assertTrue(Palettes.contraste(p.texte, fond) >= 4.5, "${t.id} : tache ${tache.couleur.toString(16)}")
                }
            }
        }
    }

    @Test
    fun theme_transparent_barreLisibleSurSaBase() {
        val p = Palettes.de(Theme.TRANSPARENT)
        assertTrue(p.vitre)
        assertTrue(Palettes.contraste(p.texte, p.base) >= 4.5)
        // La feuille du bas (menu) est presque opaque : lisible quel que soit le fond d'écran.
        assertTrue(Palettes.contraste(p.texte, Palettes.poser(p.feuille, 0xFFFFFFFFL)) >= 4.5)
    }

    @Test
    fun outilsDeCouleur() {
        assertEquals(21.0, Palettes.contraste(0xFF000000L, 0xFFFFFFFFL), 0.01)
        assertEquals(0xFF808080L, Palettes.poser(0x80FFFFFFL, 0xFF000000L))
        assertEquals(Palettes.teintePour("toufatech.com"), Palettes.teintePour("toufatech.com"))
        assertFalse(Palettes.de(Theme.GLACE).vitre)
        assertTrue(Palettes.de(Theme.GLACE).givre)
    }
}
