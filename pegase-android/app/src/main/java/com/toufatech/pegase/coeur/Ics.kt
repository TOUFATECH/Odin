package com.toufatech.pegase.coeur

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Un rendez-vous de l'agenda (collection `agenda`, protocole Pégase § 6).
 * `debut` et `fin` : ISO 8601 avec décalage horaire (« 2026-11-20T09:00:00+03:00 »),
 * ou date seule pour une journée entière (« 2026-11-20 », `fin` exclue comme en iCalendar).
 */
data class RendezVous(
    val id: String,
    val titre: String,
    val debut: String,
    val fin: String,
    val lieu: String? = null,
    val agenda: String? = null,
    val rappel: Int? = null,
    val couleur: String? = null,
    val notes: String? = null,
) {
    val journee: Boolean get() = Ics.estDate(debut)

    fun versData(): Map<String, Any?> {
        val m = LinkedHashMap<String, Any?>()
        m["titre"] = titre
        m["debut"] = debut
        m["fin"] = fin
        if (lieu != null) m["lieu"] = lieu
        if (agenda != null) m["agenda"] = agenda
        if (rappel != null) m["rappel"] = rappel
        if (couleur != null) m["couleur"] = couleur
        if (notes != null) m["notes"] = notes
        return m
    }

    companion object {
        fun deData(id: String, d: Map<String, Any?>): RendezVous? {
            val debut = d.texte("debut") ?: return null
            return RendezVous(
                id = id,
                titre = d.texte("titre") ?: "Sans titre",
                debut = debut,
                fin = d.texte("fin") ?: debut,
                lieu = d.texte("lieu"),
                agenda = d.texte("agenda"),
                rappel = d.entier("rappel")?.toInt(),
                couleur = d.texte("couleur"),
                notes = d.texte("notes"),
            )
        }
    }
}

/** Import et export iCalendar (RFC 5545), écrits pour Pégase (aucun code repris d'ailleurs). */
object Ics {
    private val UTC = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC)
    private val LOCAL = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss")
    private val ISO_DECALAGE = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX")
    private val DATE_SEULE = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    private val DUREE = Regex("^([+-])?P(?:(\\d+)W)?(?:(\\d+)D)?(?:T(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?)?$")

    fun estDate(iso: String) = DATE_SEULE.matches(iso)

    /** Le moment d'une date ISO de l'agenda (une date seule = minuit dans [zone]). */
    fun instant(iso: String, zone: ZoneId = ZoneId.systemDefault()): Instant? = try {
        when {
            estDate(iso) -> LocalDate.parse(iso).atStartOfDay(zone).toInstant()
            else -> try {
                OffsetDateTime.parse(iso).toInstant()
            } catch (e: Exception) {
                LocalDateTime.parse(iso).atZone(zone).toInstant()
            }
        }
    } catch (e: Exception) {
        null
    }

    fun isoDe(instant: Instant, zone: ZoneId): String = OffsetDateTime.ofInstant(instant, zone).format(ISO_DECALAGE)

    // ---------------------------------------------------------------- export

    fun exporter(rdvs: List<RendezVous>, maintenant: Long, nom: String = "Pégase"): String {
        val lignes = ArrayList<String>()
        lignes += "BEGIN:VCALENDAR"
        lignes += "VERSION:2.0"
        lignes += "PRODID:-//TOUFATECH//Pegase Android//FR"
        lignes += "CALSCALE:GREGORIAN"
        lignes += "METHOD:PUBLISH"
        lignes += "X-WR-CALNAME:" + echapper(nom)
        val tampon = UTC.format(Instant.ofEpochMilli(maintenant))
        for (r in rdvs) {
            val debut = propDate("DTSTART", r.debut) ?: continue
            lignes += "BEGIN:VEVENT"
            lignes += "UID:" + echapper(r.id + "@pegase.odin")
            lignes += "DTSTAMP:$tampon"
            lignes += debut
            propDate("DTEND", r.fin)?.let { lignes += it }
            lignes += "SUMMARY:" + echapper(r.titre)
            if (!r.lieu.isNullOrEmpty()) lignes += "LOCATION:" + echapper(r.lieu)
            if (!r.notes.isNullOrEmpty()) lignes += "DESCRIPTION:" + echapper(r.notes)
            if (!r.agenda.isNullOrEmpty()) lignes += "CATEGORIES:" + echapper(r.agenda)
            if (!r.couleur.isNullOrEmpty()) lignes += "X-PEGASE-COULEUR:" + echapper(r.couleur)
            if (r.rappel != null && r.rappel >= 0) {
                lignes += "BEGIN:VALARM"
                lignes += "ACTION:DISPLAY"
                lignes += "DESCRIPTION:" + echapper(r.titre)
                lignes += "TRIGGER:-PT${r.rappel}M"
                lignes += "END:VALARM"
            }
            lignes += "END:VEVENT"
        }
        lignes += "END:VCALENDAR"
        val sb = StringBuilder()
        for (l in lignes) sb.append(plier(l)).append("\r\n")
        return sb.toString()
    }

    private fun propDate(nom: String, iso: String): String? {
        if (estDate(iso)) {
            return try {
                "$nom;VALUE=DATE:" + LocalDate.parse(iso).format(DateTimeFormatter.BASIC_ISO_DATE)
            } catch (e: Exception) {
                null
            }
        }
        val i = instant(iso) ?: return null
        return "$nom:" + UTC.format(i)
    }

    /** Échappe un texte iCalendar : \ ; , et les retours à la ligne. */
    fun echapper(s: String): String {
        val sb = StringBuilder()
        for (c in s) {
            when (c) {
                '\\' -> sb.append("\\\\")
                ';' -> sb.append("\\;")
                ',' -> sb.append("\\,")
                '\n' -> sb.append("\\n")
                '\r' -> Unit
                else -> sb.append(c)
            }
        }
        return sb.toString()
    }

    fun desechapper(s: String): String {
        val sb = StringBuilder()
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '\\' && i + 1 < s.length) {
                when (val n = s[i + 1]) {
                    'n', 'N' -> sb.append('\n')
                    else -> sb.append(n)
                }
                i += 2
            } else {
                sb.append(c)
                i++
            }
        }
        return sb.toString()
    }

    private fun octetsUtf8(cp: Int) = when {
        cp < 0x80 -> 1
        cp < 0x800 -> 2
        cp < 0x10000 -> 3
        else -> 4
    }

    /** Plie une ligne à 75 octets (UTF-8) sans couper un caractère : la suite commence par une espace. */
    fun plier(ligne: String): String {
        val sb = StringBuilder()
        var octets = 0
        var i = 0
        while (i < ligne.length) {
            val cp = ligne.codePointAt(i)
            val o = octetsUtf8(cp)
            if (octets + o > 75) {
                sb.append("\r\n ")
                octets = 1
            }
            sb.appendCodePoint(cp)
            octets += o
            i += Character.charCount(cp)
        }
        return sb.toString()
    }

    // ---------------------------------------------------------------- import

    private class Ligne(val nom: String, val params: Map<String, String>, val valeur: String)

    private fun lireLigne(l: String): Ligne? {
        var guillemets = false
        var deuxPoints = -1
        for (i in l.indices) {
            val c = l[i]
            if (c == '"') guillemets = !guillemets
            else if (!guillemets && c == ':') {
                deuxPoints = i
                break
            }
        }
        if (deuxPoints <= 0) return null
        val tete = l.substring(0, deuxPoints)
        val morceaux = ArrayList<String>()
        val cour = StringBuilder()
        guillemets = false
        for (c in tete) {
            if (c == '"') guillemets = !guillemets
            if (c == ';' && !guillemets) {
                morceaux += cour.toString()
                cour.setLength(0)
            } else {
                cour.append(c)
            }
        }
        morceaux += cour.toString()
        val params = HashMap<String, String>()
        for (p in morceaux.drop(1)) {
            val eg = p.indexOf('=')
            if (eg > 0) params[p.substring(0, eg).uppercase()] = p.substring(eg + 1).trim('"')
        }
        return Ligne(morceaux[0].trim().uppercase(), params, l.substring(deuxPoints + 1))
    }

    private fun deplier(texte: String): List<String> {
        val r = ArrayList<String>()
        for (brute in texte.split(Regex("\r\n|\n|\r"))) {
            if ((brute.startsWith(" ") || brute.startsWith("\t")) && r.isNotEmpty()) {
                r[r.size - 1] = r[r.size - 1] + brute.substring(1)
            } else if (brute.isNotEmpty()) {
                r += brute
            }
        }
        return r
    }

    /** Durée iCalendar (« -PT30M », « P1D », « PT1H30M ») en secondes, signe compris ; null si illisible. */
    fun duree(s: String): Long? {
        val m = DUREE.matchEntire(s.trim()) ?: return null
        val g = m.groupValues
        fun n(i: Int) = if (g[i].isEmpty()) 0L else g[i].toLong()
        if (g.drop(2).all { it.isEmpty() }) return null
        val total = n(2) * 7 * 86400 + n(3) * 86400 + n(4) * 3600 + n(5) * 60 + n(6)
        return if (g[1] == "-") -total else total
    }

    private fun zoneDe(tzid: String?, defaut: ZoneId): ZoneId {
        if (tzid.isNullOrBlank()) return defaut
        return try {
            ZoneId.of(tzid.trim().trimStart('/'))
        } catch (e: Exception) {
            defaut
        }
    }

    /** Une date iCalendar → (texte ISO de l'agenda, moment). Journée entière : la date seule. */
    private class Moment(val iso: String, val jour: LocalDate?, val instant: Instant?, val zone: ZoneId)

    private fun moment(l: Ligne, zoneDefaut: ZoneId): Moment? {
        val v = l.valeur.trim()
        return try {
            if (l.params["VALUE"]?.uppercase() == "DATE" || Regex("^\\d{8}$").matches(v)) {
                val j = LocalDate.parse(v.take(8), DateTimeFormatter.BASIC_ISO_DATE)
                Moment(j.toString(), j, null, zoneDefaut)
            } else {
                val utc = v.endsWith("Z") || v.endsWith("z")
                val local = LocalDateTime.parse(v.trimEnd('Z', 'z'), LOCAL)
                val zone = if (utc) ZoneOffset.UTC else zoneDe(l.params["TZID"], zoneDefaut)
                val inst = local.atZone(zone).toInstant()
                val zoneAffichee = if (utc) zoneDefaut else zone
                Moment(isoDe(inst, zoneAffichee), null, inst, zoneAffichee)
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun decaler(m: Moment, secondes: Long): String = when {
        m.jour != null -> m.jour.plusDays(Math.floorDiv(secondes, 86400L)).toString()
        m.instant != null -> isoDe(m.instant.plusSeconds(secondes), m.zone)
        else -> m.iso
    }

    /** Lit un fichier .ics ; les rendez-vous annulés sont laissés de côté, une répétition (RRULE) garde sa 1re date. */
    fun importer(texte: String, zoneDefaut: ZoneId = ZoneId.systemDefault()): List<RendezVous> {
        val r = ArrayList<RendezVous>()
        var evt: HashMap<String, Ligne>? = null
        var dansAlarme = false
        var rappel: Int? = null
        for (brute in deplier(texte)) {
            val l = lireLigne(brute) ?: continue
            when {
                l.nom == "BEGIN" && l.valeur.trim().uppercase() == "VEVENT" -> {
                    evt = HashMap()
                    rappel = null
                    dansAlarme = false
                }
                l.nom == "BEGIN" && l.valeur.trim().uppercase() == "VALARM" -> dansAlarme = true
                l.nom == "END" && l.valeur.trim().uppercase() == "VALARM" -> dansAlarme = false
                l.nom == "END" && l.valeur.trim().uppercase() == "VEVENT" -> {
                    val e = evt
                    evt = null
                    if (e != null) construire(e, rappel, zoneDefaut)?.let { r += it }
                }
                evt != null && dansAlarme -> {
                    if (l.nom == "TRIGGER" && rappel == null && l.params["VALUE"]?.uppercase() != "DATE-TIME" &&
                        l.params["RELATED"]?.uppercase() != "END"
                    ) {
                        val s = duree(l.valeur)
                        if (s != null && s <= 0) rappel = ((-s) / 60).toInt()
                    }
                }
                evt != null -> if (!evt.containsKey(l.nom)) evt[l.nom] = l
            }
        }
        return r
    }

    private fun construire(e: Map<String, Ligne>, rappel: Int?, zoneDefaut: ZoneId): RendezVous? {
        if (e["STATUS"]?.valeur?.trim()?.uppercase() == "CANCELLED") return null
        val debut = e["DTSTART"]?.let { moment(it, zoneDefaut) } ?: return null
        val fin = e["DTEND"]?.let { moment(it, zoneDefaut) }?.iso
            ?: e["DURATION"]?.let { d -> duree(d.valeur)?.let { decaler(debut, it) } }
            ?: if (debut.jour != null) debut.jour.plusDays(1).toString() else debut.iso
        val titre = e["SUMMARY"]?.let { desechapper(it.valeur) }?.ifBlank { null } ?: "Sans titre"
        val uid = e["UID"]?.valeur?.trim()
        val id = idDepuisUid(uid, titre + "|" + debut.iso)
        val couleur = (e["X-PEGASE-COULEUR"]?.valeur ?: e["COLOR"]?.valeur)?.trim()?.takeIf { it.startsWith("#") }
        val agenda = e["CATEGORIES"]?.let { desechapper(it.valeur.split(Regex("(?<!\\\\),"))[0]) }?.ifBlank { null }
        return RendezVous(
            id = id,
            titre = titre,
            debut = debut.iso,
            fin = fin,
            lieu = e["LOCATION"]?.let { desechapper(it.valeur) }?.ifBlank { null },
            agenda = agenda,
            rappel = rappel,
            couleur = couleur,
            notes = e["DESCRIPTION"]?.let { desechapper(it.valeur) }?.ifBlank { null },
        )
    }

    /** Un même UID donne toujours le même identifiant : réimporter un fichier met à jour au lieu de doubler. */
    fun idDepuisUid(uid: String?, secours: String): String {
        if (uid != null && uid.endsWith("@pegase.odin")) {
            val brut = uid.removeSuffix("@pegase.odin")
            if (Enregistrement.idValide(brut)) return brut
        }
        return "ics-" + Empreintes.sha256Hex(uid ?: secours).take(32)
    }
}

/** Une durée en minutes, comme on la dit : « 45 min », « 1 h », « 1 h 30 ». */
fun dureeLisible(minutes: Long): String = when {
    minutes < 60 -> "$minutes min"
    minutes % 60 == 0L -> "${minutes / 60} h"
    else -> "${minutes / 60} h ${"%02d".format(minutes % 60)}"
}
