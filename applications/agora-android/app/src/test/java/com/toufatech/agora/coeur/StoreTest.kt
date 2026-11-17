package com.toufatech.agora.coeur

import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.security.MessageDigest
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class StoreTest {
    private val sha = { b: ByteArray -> MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) } }
    private val apk = "contenu de l'apk d'essai".toByteArray()
    // La réponse de GET /api/agora/store, telle qu'Odin l'écrit (src/valhalla/agora/regles.ts, storeDe).
    private val json = """{"ok":true,"store":[
      {"id":"pegase","nom":"Pégase","desc":"Le navigateur","mode":"office","par":"Awa","paquet":{"format":"apk","version":"1.0.0","sha256":"${sha(apk)}","taille":${apk.size},"nomFichier":"pegase-1.0.0.apk","ident":"com.toufatech.pegase","telecharger":"/api/agora/telecharger?element=pegase&plateforme=android&version=1.0.0"}},
      {"id":"hestia","nom":"Hestia","desc":"La famille sur la carte","mode":"proposee","par":"Awa","web":"gladsheim"},
      {"id":"compagnon","nom":"Compagnon d'Odin","desc":"","mode":"proposee","par":"","paquet":{"format":"appimage","version":"1.4","sha256":"${"a".repeat(64)}","taille":1,"nomFichier":"c.AppImage","telecharger":"/x"}},
      {"id":"penpot","nom":"Penpot","desc":"","mode":"retiree","par":"Awa","web":"penpot"}]}"""

    @Test
    fun litLeStoreDOdin() {
        val l = Store.articles(Json.objet(json))
        assertEquals(listOf("pegase", "hestia", "compagnon", "penpot"), l.map { it.id })
        assertEquals(Mode.OFFICE, l[0].mode); assertTrue(l[0].impose); assertTrue(l[0].pourAndroid); assertEquals("com.toufatech.pegase", l[0].paquet?.ident)
        assertEquals("gladsheim", l[1].web); assertFalse(l[1].impose); assertEquals(Mode.RETIREE, l[3].mode)
        assertEquals("Imposée par Awa", Decision.texte(l[0], null, false))
        assertEquals("Installée · imposée", Decision.texte(l[0], Installee("com.toufatech.pegase", "1.0.0"), false))
        assertEquals("Installation demandée par Awa", Decision.texte(l[0], null, true))
        assertEquals("Dans ton espace Odin", Decision.texte(l[1], null, false))
        assertEquals("Pour ordinateur seulement", Decision.texte(l[2], null, false))
        assertEquals("Retirée par Awa", Decision.texte(l[3], null, false))
    }

    @Test
    fun ordresEtPlans() {
        val l = Store.articles(Json.objet(json)); val peg = l[0]
        val o = Store.ordre(Json.objet("""{"id":"o1","element":"pegase","nom":"Pégase","action":"installer","version":"1.0.0","impose":true,"par":"mode","qui":"Awa"}"""))!!
        assertEquals("installer", o.action); assertEquals("Awa", o.qui)
        assertEquals(null, Store.ordre(Json.objet("""{"id":"o2","element":"x","action":"formater"}""")), "action inconnue : ignorée")
        // Sans propriétaire de l'appareil : la personne confirme ; avec : sans toucher.
        assertEquals(Plan.Installer(peg.paquet!!, false), Decision.plan(o, peg, null, gere = false))
        assertEquals(Plan.Installer(peg.paquet!!, true), Decision.plan(o, peg, null, gere = true))
        assertIs<Plan.DejaFait>(Decision.plan(o, peg, Installee("com.toufatech.pegase", "1.0.0"), false))
        assertIs<Plan.Installer>(Decision.plan(o.copy(action = "mettre_a_jour"), peg, Installee("com.toufatech.pegase", "0.9.2"), false))
        assertIs<Plan.Impossible>(Decision.plan(o, l[2], null, false), "AppImage : pas pour Android")
        assertEquals(Plan.Desinstaller("com.toufatech.pegase", false), Decision.plan(o.copy(action = "desinstaller"), peg, Installee("com.toufatech.pegase", "1.0.0"), false))
        assertEquals(Plan.DejaFait("absente", null), Decision.plan(o.copy(action = "desinstaller"), peg, null, false))
        val fausse = peg.copy(paquet = peg.paquet!!.copy(sha256 = "pas-une-empreinte"))
        assertIs<Plan.Impossible>(Decision.plan(o, fausse, null, false))
        assertEquals(1, Store.compareVersions("1.2.10", "1.2.9")); assertEquals(0, Store.compareVersions("v1.0", "1.0.0")); assertEquals(-1, Store.compareVersions("1.0.0", "1.0.1"))
    }

    @Test
    fun empreinteVerifieeAvantInstallation() {
        val f = File.createTempFile("agora", ".apk"); var vu = -1
        Regles.copierVerifie(ByteArrayInputStream(apk), f, sha(apk), apk.size.toLong()) { vu = it }
        assertEquals(apk.toList(), f.readBytes().toList()); assertEquals(100, vu)
        val e = assertFailsWith<EmpreinteFausse> { Regles.copierVerifie(ByteArrayInputStream(apk + "abîmé".toByteArray()), f, sha(apk)) }
        assertTrue(e.message!!.startsWith("Empreinte différente : installation refusée")); assertFalse(f.exists(), "le fichier faux est effacé")
        assertFailsWith<EmpreinteFausse> { Regles.copierVerifie(ByteArrayInputStream(apk), f, "") }
    }
}
