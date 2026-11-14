package com.toufatech.pegase.coeur

import java.security.MessageDigest

/**
 * La logique pure de la synchro avec Odin (protocole Pégase v1, docs/pegase-protocole.md d'Odin, § 3).
 * Rien ici ne touche au réseau, au disque ni à Android : tout est vérifiable dans les essais JVM.
 */

/** Les collections synchronisées (jamais : cookies, cache, fenêtres privées, mots de passe). */
object Cols {
    const val PROFIL = "profil"
    const val FAVORIS = "favoris"
    const val ONGLETS = "onglets"
    const val ESPACES = "espaces"
    const val BUREAUX = "bureaux"
    const val HISTORIQUE = "historique"
    const val AGENDA = "agenda"
    const val REGLAGES = "reglages"
    const val TELECHARGEMENTS = "telechargements"

    val TOUTES = listOf(PROFIL, FAVORIS, ONGLETS, ESPACES, BUREAUX, HISTORIQUE, AGENDA, REGLAGES, TELECHARGEMENTS)

    fun connue(col: String) = col in TOUTES
}

/** Un enregistrement synchronisé : `{ id, col, data, maj, appareil, suppr? }`. */
data class Enregistrement(
    val id: String,
    val col: String,
    val data: Map<String, Any?>,
    val maj: Long,
    val appareil: String,
    val suppr: Boolean = false,
) {
    fun versJson(): Map<String, Any?> {
        val m = LinkedHashMap<String, Any?>()
        m["id"] = id
        m["col"] = col
        m["data"] = if (suppr) emptyMap<String, Any?>() else data
        m["maj"] = maj
        m["appareil"] = appareil
        if (suppr) m["suppr"] = true
        return m
    }

    companion object {
        /** 1 à 200 caractères parmi A-Z a-z 0-9 . _ : @ - */
        private val ID = Regex("^[A-Za-z0-9._:@-]{1,200}$")

        fun idValide(id: String) = ID.matches(id)

        /** Lit un enregistrement venu d'Odin ou du disque ; null s'il est mal formé (il est alors ignoré). */
        fun deJson(m: Map<String, Any?>): Enregistrement? {
            val id = m.texte("id") ?: return null
            val col = m.texte("col") ?: return null
            val maj = m.entier("maj") ?: return null
            if (!idValide(id) || !Cols.connue(col)) return null
            return Enregistrement(
                id = id,
                col = col,
                data = m.objet("data") ?: emptyMap(),
                maj = maj,
                appareil = m.texte("appareil") ?: "",
                suppr = m.booleen("suppr") == true,
            )
        }

        fun listeDeJson(l: List<Any?>?): List<Enregistrement> = (l ?: emptyList()).objets().mapNotNull { deJson(it) }
    }
}

/** Règle du conflit : le `maj` le plus grand gagne ; à égalité, l'`appareil` le plus petit (comparaison de chaînes). */
object Fusion {
    /** Vrai si [nouveau] doit remplacer [actuel]. Une version identique ne remplace rien. */
    fun gagne(nouveau: Enregistrement, actuel: Enregistrement?): Boolean {
        if (actuel == null) return true
        if (nouveau.maj != actuel.maj) return nouveau.maj > actuel.maj
        if (nouveau.appareil != actuel.appareil) return nouveau.appareil < actuel.appareil
        return false
    }
}

/** L'empreinte d'une collection : `{ n, hash }`. */
data class Empreinte(val n: Int, val hash: String) {
    fun versJson(): Map<String, Any?> = linkedMapOf("n" to n, "hash" to hash)

    companion object {
        fun deJson(m: Map<String, Any?>?): Empreinte? {
            if (m == null) return null
            val n = m.entier("n") ?: return null
            val h = m.texte("hash") ?: return null
            return Empreinte(n.toInt(), h)
        }
    }
}

object Empreintes {
    /** SHA-256 de rien : l'empreinte d'une collection vide. */
    const val VIDE = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

    /**
     * Le texte haché (identique côté Odin) : une ligne `id:maj` par enregistrement, pierres tombales comprises,
     * triées par ordre des codes (String.compareTo = tri JavaScript par défaut), jointes par "\n" sans "\n" final.
     */
    fun texte(enregs: Collection<Enregistrement>): String =
        enregs.map { it.id + ":" + it.maj }.sorted().joinToString("\n")

    fun de(enregs: Collection<Enregistrement>): Empreinte = Empreinte(enregs.size, sha256Hex(texte(enregs)))

    fun sha256Hex(s: String): String = hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)))

    fun hex(b: ByteArray): String {
        val chiffres = "0123456789abcdef"
        val sb = StringBuilder(b.size * 2)
        for (x in b) {
            val v = x.toInt() and 0xff
            sb.append(chiffres[v ushr 4]).append(chiffres[v and 15])
        }
        return sb.toString()
    }

    /** Les collections dont l'empreinte d'Odin diffère de la nôtre (une collection absente chez Odin est ignorée). */
    fun differentes(locales: Map<String, Empreinte>, distantes: Map<String, Empreinte>): List<String> =
        Cols.TOUTES.filter { col -> distantes[col] != null && distantes[col] != locales[col] }

    fun deJson(m: Map<String, Any?>?): Map<String, Empreinte> {
        val r = LinkedHashMap<String, Empreinte>()
        if (m == null) return r
        for (col in Cols.TOUTES) Empreinte.deJson(m.objet(col))?.let { r[col] = it }
        return r
    }
}

/**
 * Les données d'un profil, en mémoire : toutes les collections, pierres tombales comprises
 * (elles comptent dans l'empreinte et disent aux autres appareils ce qui a été supprimé).
 */
class Donnees {
    private val cols = HashMap<String, LinkedHashMap<String, Enregistrement>>()

    /** Applique un enregistrement s'il gagne ; rend vrai s'il a changé quelque chose. */
    @Synchronized
    fun appliquer(e: Enregistrement): Boolean {
        val m = cols.getOrPut(e.col) { LinkedHashMap() }
        if (!Fusion.gagne(e, m[e.id])) return false
        m[e.id] = e
        return true
    }

    @Synchronized
    fun un(col: String, id: String): Enregistrement? = cols[col]?.get(id)

    /** Tout, pierres tombales comprises. */
    @Synchronized
    fun tous(col: String): List<Enregistrement> = cols[col]?.values?.toList() ?: emptyList()

    /** Seulement ce qui existe (sans les pierres tombales). */
    @Synchronized
    fun actifs(col: String): List<Enregistrement> = tous(col).filter { !it.suppr }

    @Synchronized
    fun remplacer(col: String, liste: Collection<Enregistrement>) {
        val m = LinkedHashMap<String, Enregistrement>()
        for (e in liste) if (e.col == col && Fusion.gagne(e, m[e.id])) m[e.id] = e
        cols[col] = m
    }

    @Synchronized
    fun empreinte(col: String): Empreinte = Empreintes.de(tous(col))

    @Synchronized
    fun empreintes(): Map<String, Empreinte> = Cols.TOUTES.associateWith { empreinte(it) }
}

/** Après un `tirer` : ce qu'on prend d'Odin, et ce qu'on lui renvoie parce qu'il ne l'a pas (ou en plus ancien). */
object Rapprochement {
    data class Resultat(val aAppliquer: List<Enregistrement>, val aEnvoyer: List<Enregistrement>)

    fun calculer(locaux: Collection<Enregistrement>, distants: Collection<Enregistrement>): Resultat {
        val chezOdin = HashMap<String, Enregistrement>()
        for (d in distants) if (Fusion.gagne(d, chezOdin[d.id])) chezOdin[d.id] = d
        val chezNous = HashMap<String, Enregistrement>()
        for (l in locaux) chezNous[l.id] = l

        val aAppliquer = chezOdin.values.filter { Fusion.gagne(it, chezNous[it.id]) }.sortedBy { it.maj }
        val aEnvoyer = chezNous.values.filter { Fusion.gagne(it, chezOdin[it.id]) }.sortedBy { it.maj }
        return Resultat(aAppliquer, aEnvoyer)
    }
}

/**
 * La file d'attente des changements pas encore reçus par Odin (gardée sur le disque hors ligne).
 * Un même enregistrement n'y figure qu'une fois : sa dernière version.
 */
class FileAttente {
    private val file = LinkedHashMap<String, Enregistrement>()

    private fun cle(e: Enregistrement) = e.col + "/" + e.id

    @Synchronized
    fun ajouter(e: Enregistrement) {
        val k = cle(e)
        val actuel = file[k]
        if (actuel == null || Fusion.gagne(e, actuel)) {
            file.remove(k)
            file[k] = e
        }
    }

    @get:Synchronized
    val taille: Int get() = file.size

    @Synchronized
    fun tout(): List<Enregistrement> = file.values.toList()

    /** Le prochain envoi : 1 000 changements et ~1,9 Mo au plus (la limite d'Odin est 1 000 et 2 Mo). */
    @Synchronized
    fun lot(max: Int = 1000, maxOctets: Int = 1_900_000): List<Enregistrement> {
        val r = ArrayList<Enregistrement>()
        var octets = 32
        for (e in file.values) {
            if (r.size >= max) break
            val taille = Json.ecrire(e.versJson()).toByteArray(Charsets.UTF_8).size + 1
            if (r.isNotEmpty() && octets + taille > maxOctets) break
            r.add(e)
            octets += taille
        }
        return r
    }

    /** Retire ce qu'Odin a reçu, sauf ce qui a été modifié depuis (la nouvelle version repartira). */
    @Synchronized
    fun retirer(envoyes: Collection<Enregistrement>) {
        for (e in envoyes) {
            val k = cle(e)
            if (file[k] == e) file.remove(k)
        }
    }

    @Synchronized
    fun versJson(): String = Json.ecrire(file.values.map { it.versJson() })

    @Synchronized
    fun charger(texte: String?) {
        file.clear()
        if (texte.isNullOrBlank()) return
        val l = try {
            Json.lire(texte) as? List<*>
        } catch (e: Json.Illisible) {
            null
        }
        @Suppress("UNCHECKED_CAST")
        for (e in Enregistrement.listeDeJson(l as List<Any?>?)) ajouter(e)
    }
}

/** L'indicateur de la maquette : « Odin · synchronisé », « synchronisation… », « hors ligne (n en attente) ». */
enum class EtatSynchro { SYNCHRONISE, EN_COURS, HORS_LIGNE, SANS_ODIN }

data class Indicateur(val etat: EtatSynchro, val enAttente: Int) {
    val texte: String
        get() = when (etat) {
            EtatSynchro.SYNCHRONISE -> "Odin · synchronisé"
            EtatSynchro.EN_COURS -> "synchronisation…"
            EtatSynchro.HORS_LIGNE -> if (enAttente > 0) "hors ligne ($enAttente en attente)" else "hors ligne"
            EtatSynchro.SANS_ODIN -> "sans Odin"
        }
}

/** Date d'un changement local : jamais plus petite que la version d'avant (sinon notre propre changement perdrait). */
fun prochaineMaj(maintenant: Long, precedent: Enregistrement?): Long =
    if (precedent != null && precedent.maj >= maintenant) precedent.maj + 1 else maintenant
