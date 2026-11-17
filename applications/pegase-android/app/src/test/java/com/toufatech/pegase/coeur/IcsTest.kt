package com.toufatech.pegase.coeur

import org.junit.Test
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class IcsTest {
    private val mayotte = ZoneId.of("Indian/Mayotte")

    private val dentiste = RendezVous(
        id = "rdv-1", titre = "Dentiste, contrôle; annuel", debut = "2026-11-20T09:00:00+03:00", fin = "2026-11-20T09:30:00+03:00",
        lieu = "Cabinet de Mamoudzou", agenda = "Perso", rappel = 30, couleur = "#3b82f6", notes = "Apporter la carte\nVitale",
    )

    @Test
    fun exporteSelonLaRfc5545() {
        val ics = Ics.exporter(listOf(dentiste), 1763125200000L, "Agenda d'Awa")
        assertTrue(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"))
        assertTrue(ics.endsWith("END:VCALENDAR\r\n"))
        assertTrue("\r\n" in ics && ics.replace("\r\n", "").none { it == '\n' }, "toutes les lignes finissent par CRLF")
        assertTrue("UID:rdv-1@pegase.odin\r\n" in ics)
        assertTrue("DTSTART:20261120T060000Z\r\n" in ics)
        assertTrue("DTEND:20261120T063000Z\r\n" in ics)
        assertTrue("SUMMARY:Dentiste\\, contrôle\\; annuel\r\n" in ics)
        assertTrue("DESCRIPTION:Apporter la carte\\nVitale\r\n" in ics)
        assertTrue("TRIGGER:-PT30M\r\n" in ics)
        assertTrue("DTSTAMP:20251114T130000Z\r\n" in ics)
    }

    @Test
    fun plieA75OctetsSansCouperUnCaractere() {
        val long = RendezVous("long", "é".repeat(100), "2026-11-20", "2026-11-21")
        val ics = Ics.exporter(listOf(long), 0)
        for (ligne in ics.split("\r\n")) assertTrue(ligne.toByteArray(Charsets.UTF_8).size <= 75, "ligne trop longue : $ligne")
        val relu = Ics.importer(ics, mayotte)
        assertEquals("é".repeat(100), relu.single().titre)
    }

    @Test
    fun allerRetour() {
        val journee = RendezVous("j-1", "Fête de Mayotte", "2026-11-20", "2026-11-21", agenda = "Famille")
        val ics = Ics.exporter(listOf(dentiste, journee), 0)
        val relu = Ics.importer(ics, mayotte)
        assertEquals(2, relu.size)
        assertEquals(dentiste, relu[0])
        assertEquals(journee, relu[1])
        assertTrue(relu[1].journee)
    }

    @Test
    fun importeUnFichierDAilleurs() {
        // Comme un export Google / Outlook : TZID, durée, journée entière, lignes pliées, annulé, rappel, RRULE.
        val ics = listOf(
            "BEGIN:VCALENDAR",
            "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
            "VERSION:2.0",
            "BEGIN:VEVENT",
            "DTSTART;TZID=Europe/Paris:20261116T090000",
            "DURATION:PT1H30M",
            "RRULE:FREQ=WEEKLY;BYDAY=MO",
            "UID:abc123@google.com",
            "SUMMARY:Appel fournisseur",
            "DESCRIPTION:Ligne très longue qui a été pliée par l'agenda d'origine pour respecter",
            "  la limite de 75 octets",
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            "TRIGGER:-PT15M",
            "END:VALARM",
            "END:VEVENT",
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20261117",
            "UID:jour@exemple",
            "SUMMARY:Congé",
            "END:VEVENT",
            "BEGIN:VEVENT",
            "DTSTART:20261118T100000Z",
            "DTEND:20261118T110000Z",
            "STATUS:CANCELLED",
            "SUMMARY:Annulé",
            "END:VEVENT",
            "END:VCALENDAR",
        ).joinToString("\n")
        val l = Ics.importer(ics, mayotte)
        assertEquals(2, l.size)
        val appel = l[0]
        assertEquals("Appel fournisseur", appel.titre)
        assertEquals("2026-11-16T09:00:00+01:00", appel.debut)
        assertEquals("2026-11-16T10:30:00+01:00", appel.fin)
        assertEquals(15, appel.rappel)
        assertEquals("Ligne très longue qui a été pliée par l'agenda d'origine pour respecter la limite de 75 octets", appel.notes)
        assertTrue(appel.id.startsWith("ics-"))
        assertEquals(appel.id, Ics.importer(ics, mayotte)[0].id, "réimporter donne le même identifiant")
        val conge = l[1]
        assertEquals("2026-11-17", conge.debut)
        assertEquals("2026-11-18", conge.fin)
        assertNull(conge.rappel)
    }

    @Test
    fun heureUtcDevientLHeureLocale() {
        val ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x@pegase.odin\r\nDTSTART:20261120T060000Z\r\nSUMMARY:A\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
        val r = Ics.importer(ics, mayotte).single()
        assertEquals("x", r.id)
        assertEquals("2026-11-20T09:00:00+03:00", r.debut)
        assertEquals(r.debut, r.fin)
    }

    @Test
    fun durees() {
        assertEquals(-1800L, Ics.duree("-PT30M"))
        assertEquals(86400L, Ics.duree("P1D"))
        assertEquals(5400L, Ics.duree("PT1H30M"))
        assertEquals(604800L, Ics.duree("P1W"))
        assertNull(Ics.duree("P"))
        assertNull(Ics.duree("n'importe quoi"))
    }

    @Test
    fun donneesDeLAgenda() {
        val d = dentiste.versData()
        assertEquals(dentiste, RendezVous.deData("rdv-1", d))
        assertEquals(setOf("titre", "debut", "fin", "lieu", "agenda", "rappel", "couleur", "notes"), d.keys)
        assertNull(RendezVous.deData("x", mapOf("titre" to "sans début")))
    }

    @Test
    fun dureesLisibles() {
        assertEquals("45 min", dureeLisible(45))
        assertEquals("1 h", dureeLisible(60))
        assertEquals("1 h 30", dureeLisible(90))
        assertEquals("2 h 05", dureeLisible(125))
    }
}
