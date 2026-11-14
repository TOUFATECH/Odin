package com.toufatech.pegase.coeur

/**
 * JSON sans dépendance (le cœur de Pégase n'utilise que la bibliothèque standard de Kotlin,
 * pour tourner tel quel dans les essais JVM).
 *
 * Correspondance : objet → Map<String, Any?> (ordre des champs gardé), tableau → List<Any?>,
 * nombre entier → Long, autre nombre → Double, texte → String, true/false → Boolean, null → null.
 */
object Json {
    class Illisible(message: String) : Exception(message)

    fun lire(texte: String): Any? {
        val l = Lecteur(texte)
        l.blancs()
        val v = l.valeur()
        l.blancs()
        if (!l.fini()) throw Illisible("Texte en trop après le JSON (position ${l.pos}).")
        return v
    }

    @Suppress("UNCHECKED_CAST")
    fun objet(texte: String): Map<String, Any?> =
        lire(texte) as? Map<String, Any?> ?: throw Illisible("Un objet JSON était attendu.")

    fun ecrire(v: Any?): String = StringBuilder().also { ecrireDans(it, v) }.toString()

    private fun ecrireDans(sb: StringBuilder, v: Any?) {
        when (v) {
            null -> sb.append("null")
            is String -> texte(sb, v)
            is Boolean -> sb.append(if (v) "true" else "false")
            is Int, is Long, is Short, is Byte -> sb.append(v.toString())
            is Double -> nombre(sb, v)
            is Float -> nombre(sb, v.toDouble())
            is Number -> nombre(sb, v.toDouble())
            is Map<*, *> -> {
                sb.append('{')
                var premier = true
                for ((k, x) in v) {
                    if (!premier) sb.append(',')
                    premier = false
                    texte(sb, k.toString())
                    sb.append(':')
                    ecrireDans(sb, x)
                }
                sb.append('}')
            }
            is Iterable<*> -> {
                sb.append('[')
                var premier = true
                for (x in v) {
                    if (!premier) sb.append(',')
                    premier = false
                    ecrireDans(sb, x)
                }
                sb.append(']')
            }
            is Array<*> -> ecrireDans(sb, v.asList())
            else -> texte(sb, v.toString())
        }
    }

    private fun nombre(sb: StringBuilder, d: Double) {
        when {
            d.isNaN() || d.isInfinite() -> sb.append("null")
            d == Math.floor(d) && Math.abs(d) < 1e15 -> sb.append(d.toLong().toString())
            else -> sb.append(d.toString())
        }
    }

    private fun texte(sb: StringBuilder, s: String) {
        sb.append('"')
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                ' ' -> sb.append("\\u2028")
                ' ' -> sb.append("\\u2029")
                else -> if (c < ' ') {
                    sb.append("\\u")
                    sb.append(Integer.toHexString(c.code).padStart(4, '0'))
                } else {
                    sb.append(c)
                }
            }
        }
        sb.append('"')
    }

    private class Lecteur(val s: String) {
        var pos = 0

        fun fini() = pos >= s.length

        fun blancs() {
            while (pos < s.length && (s[pos] == ' ' || s[pos] == '\n' || s[pos] == '\r' || s[pos] == '\t')) pos++
        }

        fun valeur(): Any? {
            if (fini()) throw Illisible("Le JSON s'arrête trop tôt.")
            val c = s[pos]
            return when {
                c == '{' -> objet()
                c == '[' -> tableau()
                c == '"' -> texte()
                c == 't' -> mot("true", true)
                c == 'f' -> mot("false", false)
                c == 'n' -> mot("null", null)
                c == '-' || c in '0'..'9' -> nombre()
                else -> throw Illisible("Caractère inattendu « $c » (position $pos).")
            }
        }

        private fun mot(m: String, v: Any?): Any? {
            if (!s.startsWith(m, pos)) throw Illisible("Mot inconnu à la position $pos.")
            pos += m.length
            return v
        }

        private fun attendre(c: Char) {
            if (fini() || s[pos] != c) throw Illisible("« $c » attendu à la position $pos.")
            pos++
        }

        private fun objet(): Map<String, Any?> {
            pos++
            val m = LinkedHashMap<String, Any?>()
            blancs()
            if (!fini() && s[pos] == '}') {
                pos++
                return m
            }
            while (true) {
                blancs()
                if (fini() || s[pos] != '"') throw Illisible("Nom de champ attendu à la position $pos.")
                val k = texte()
                blancs()
                attendre(':')
                blancs()
                m[k] = valeur()
                blancs()
                if (fini()) throw Illisible("Objet JSON non fermé.")
                when (s[pos]) {
                    ',' -> pos++
                    '}' -> {
                        pos++
                        return m
                    }
                    else -> throw Illisible("« , » ou « } » attendu à la position $pos.")
                }
            }
        }

        private fun tableau(): List<Any?> {
            pos++
            val l = ArrayList<Any?>()
            blancs()
            if (!fini() && s[pos] == ']') {
                pos++
                return l
            }
            while (true) {
                blancs()
                l.add(valeur())
                blancs()
                if (fini()) throw Illisible("Tableau JSON non fermé.")
                when (s[pos]) {
                    ',' -> pos++
                    ']' -> {
                        pos++
                        return l
                    }
                    else -> throw Illisible("« , » ou « ] » attendu à la position $pos.")
                }
            }
        }

        fun texte(): String {
            pos++
            val sb = StringBuilder()
            while (true) {
                if (fini()) throw Illisible("Texte JSON non fermé.")
                val c = s[pos++]
                when {
                    c == '"' -> return sb.toString()
                    c == '\\' -> {
                        if (fini()) throw Illisible("Échappement incomplet.")
                        when (val e = s[pos++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                if (pos + 4 > s.length) throw Illisible("Échappement \\u incomplet.")
                                val code = s.substring(pos, pos + 4).toIntOrNull(16)
                                    ?: throw Illisible("Échappement \\u illisible.")
                                sb.append(code.toChar())
                                pos += 4
                            }
                            else -> throw Illisible("Échappement inconnu « \\$e ».")
                        }
                    }
                    c < ' ' -> throw Illisible("Caractère de contrôle dans un texte JSON.")
                    else -> sb.append(c)
                }
            }
        }

        private fun chiffres() {
            while (pos < s.length && s[pos] in '0'..'9') pos++
        }

        private fun nombre(): Any {
            val debut = pos
            if (s[pos] == '-') pos++
            chiffres()
            var entier = true
            if (pos < s.length && s[pos] == '.') {
                entier = false
                pos++
                chiffres()
            }
            if (pos < s.length && (s[pos] == 'e' || s[pos] == 'E')) {
                entier = false
                pos++
                if (pos < s.length && (s[pos] == '+' || s[pos] == '-')) pos++
                chiffres()
            }
            val t = s.substring(debut, pos)
            if (entier) t.toLongOrNull()?.let { return it }
            return t.toDoubleOrNull() ?: throw Illisible("Nombre illisible « $t ».")
        }
    }
}

// Petits accès sûrs aux champs d'un objet JSON lu.

fun Map<String, Any?>.texte(cle: String): String? = this[cle] as? String

fun Map<String, Any?>.entier(cle: String): Long? = when (val v = this[cle]) {
    is Long -> v
    is Int -> v.toLong()
    is Double -> if (v == Math.floor(v) && !v.isInfinite()) v.toLong() else null
    else -> null
}

fun Map<String, Any?>.decimal(cle: String): Double? = (this[cle] as? Number)?.toDouble()

fun Map<String, Any?>.booleen(cle: String): Boolean? = this[cle] as? Boolean

@Suppress("UNCHECKED_CAST")
fun Map<String, Any?>.objet(cle: String): Map<String, Any?>? = this[cle] as? Map<String, Any?>

@Suppress("UNCHECKED_CAST")
fun Map<String, Any?>.liste(cle: String): List<Any?>? = this[cle] as? List<Any?>

@Suppress("UNCHECKED_CAST")
fun List<Any?>.objets(): List<Map<String, Any?>> = mapNotNull { it as? Map<String, Any?> }
