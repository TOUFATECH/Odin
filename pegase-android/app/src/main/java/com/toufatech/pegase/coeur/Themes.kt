package com.toufatech.pegase.coeur

/**
 * Les couleurs du navigateur (maquette validée, écrans téléphone 9 à 18) : noir, blanc, bleu, rouge,
 * transparent (on voit le fond d'écran du téléphone à travers), glace (verre dépoli), et auto (suit le téléphone).
 * Couleurs en ARGB (0xAARRGGBB), sans dépendance à Android pour être vérifiées dans les essais.
 */
enum class Theme(val id: String, val nom: String, val clair: Boolean) {
    NOIR("noir", "Noir", false),
    BLANC("blanc", "Blanc", true),
    BLEU("bleu", "Bleu", false),
    ROUGE("rouge", "Rouge", false),
    TRANSPARENT("transparent", "Transparent", false),
    GLACE("glace", "Glace", true),
    AUTO("auto", "Auto", false);

    /** Le thème réellement dessiné : « auto » devient noir ou blanc selon le réglage du téléphone. */
    fun resolu(systemeSombre: Boolean): Theme = if (this == AUTO) (if (systemeSombre) NOIR else BLANC) else this

    /** Nom court sous la pastille du menu (la maquette écrit « Transp. »). */
    val nomCourt: String get() = if (this == TRANSPARENT) "Transp." else nom

    companion object {
        /** L'ordre des pastilles dans le menu. */
        val CHOIX = listOf(NOIR, BLANC, BLEU, ROUGE, TRANSPARENT, GLACE, AUTO)

        /** Bleu par défaut, comme la maquette. */
        fun deId(id: String?): Theme = entries.firstOrNull { it.id == id } ?: BLEU
    }
}

/** Une tache de couleur ronde du fond (dégradé radial) : centre et rayons en fraction de l'écran. */
data class Tache(val x: Float, val y: Float, val rx: Float, val ry: Float, val couleur: Long)

/** Un arrêt de dégradé : couleur ARGB et position (0 à 1). */
data class Arret(val couleur: Long, val position: Float)

data class Palette(
    /** Couleur de fond sous tout le reste. */
    val base: Long,
    /** Voile en dégradé linéaire à 160° posé au-dessus des taches. */
    val voile: List<Arret>,
    /** Taches de couleur (thèmes transparent et glace). */
    val taches: List<Tache>,
    val texte: Long,
    val texteDoux: Long,
    /** Feuilles du bas (menu, téléchargement, connexion). */
    val feuille: Long,
    /** Fond des boutons et tuiles (blanc très léger). */
    val tuile: Long,
    val tuileForte: Long,
    val bordure: Long,
    /** Pastille du menu des couleurs (dégradé à 145°). */
    val pastille: List<Long>,
    /** Le fond d'écran du téléphone se voit à travers (thème transparent). */
    val vitre: Boolean = false,
    /** Effet de verre dépoli (thème glace). */
    val givre: Boolean = false,
)

object Palettes {
    private const val TEXTE_SOMBRE = 0xFFF2F3FAL
    private const val TEXTE_SOMBRE_DOUX = 0xC7F2F3FAL // rgba(242,243,250,.78)
    private const val TEXTE_CLAIR = 0xFF1C1F2BL
    private const val TEXTE_CLAIR_DOUX = 0xAD1C1F2BL // rgba(28,31,43,.68)

    private fun sombre(base: Long, voile: List<Arret>, pastille: List<Long>, taches: List<Tache> = emptyList(), vitre: Boolean = false) =
        Palette(
            base = base, voile = voile, taches = taches,
            texte = TEXTE_SOMBRE, texteDoux = TEXTE_SOMBRE_DOUX,
            feuille = 0xF71E1F2AL, tuile = 0x1FFFFFFFL, tuileForte = 0x38FFFFFFL, bordure = 0x24FFFFFFL,
            pastille = pastille, vitre = vitre,
        )

    fun de(theme: Theme, systemeSombre: Boolean = true): Palette = when (theme.resolu(systemeSombre)) {
        Theme.NOIR -> sombre(
            0xFF0D0E12L,
            listOf(Arret(0xFF24252DL, 0f), Arret(0xFF0D0E12L, 1f)),
            listOf(0xFF2A2B33L, 0xFF0D0E12L),
        )
        Theme.BLANC -> Palette(
            base = 0xFFE4E7EEL,
            voile = listOf(Arret(0xFFFFFFFFL, 0f), Arret(0xFFE4E7EEL, 1f)),
            taches = emptyList(),
            texte = TEXTE_CLAIR, texteDoux = TEXTE_CLAIR_DOUX,
            feuille = 0xEBFFFFFFL, tuile = 0x0F141828L, tuileForte = 0x1F141828L, bordure = 0x1A141828L,
            pastille = listOf(0xFFFFFFFFL, 0xFFE4E7EEL),
        )
        Theme.BLEU -> sombre(
            0xFF3B3F8FL,
            listOf(Arret(0x1AFFFFFFL, 0f), Arret(0x4D000000L, 1f)),
            listOf(0xFF4C6FFFL, 0xFF1F3BB0L),
        )
        Theme.ROUGE -> sombre(
            0xFFA3233AL,
            listOf(Arret(0x1AFFFFFFL, 0f), Arret(0x4D000000L, 1f)),
            listOf(0xFFF0506AL, 0xFF8E1428L),
        )
        Theme.TRANSPARENT -> sombre(
            0xFF1B3A6BL,
            listOf(Arret(0x24FFFFFFL, 0f), Arret(0x0AFFFFFFL, 0.4f), Arret(0x380A0E1EL, 1f)),
            listOf(0xFF4C9BFFL, 0xFF7B3FE4L),
            taches = listOf(
                Tache(0.12f, 0.30f, 0.40f, 0.50f, 0xFFFFB25CL),
                Tache(0.80f, 0.25f, 0.55f, 0.60f, 0xFF2F8CFFL),
                Tache(0.60f, 0.95f, 0.50f, 0.55f, 0xFF11C7A0L),
                Tache(0.35f, 0.75f, 0.35f, 0.40f, 0xFFE0457BL),
            ),
            vitre = true,
        )
        Theme.GLACE -> Palette(
            base = 0xFFDDE6F5L,
            voile = listOf(Arret(0x9EFFFFFFL, 0f), Arret(0x5CFFFFFFL, 1f)),
            taches = listOf(
                Tache(0.15f, 0.15f, 0.60f, 0.55f, 0xFF7FD8FFL),
                Tache(0.90f, 0.85f, 0.55f, 0.60f, 0xFFFF9AD5L),
                Tache(0.75f, 0.10f, 0.45f, 0.45f, 0xFFA6FFCBL),
                Tache(0.30f, 0.90f, 0.50f, 0.50f, 0xFFB9A6FFL),
            ),
            texte = TEXTE_CLAIR, texteDoux = TEXTE_CLAIR_DOUX,
            feuille = 0x80FFFFFFL, tuile = 0x80FFFFFFL, tuileForte = 0xB3FFFFFFL, bordure = 0xCCFFFFFFL,
            pastille = listOf(0xD9FFFFFFL, 0xFF7FD8FFL, 0xFFFF9AD5L),
            givre = true,
        )
        Theme.AUTO -> error("« auto » est toujours résolu en noir ou blanc")
    }

    // Couleurs fixes de la maquette.
    const val VERT = 0xFF2ED378L
    const val VERT_TEXTE = 0xFF9CF0C0L
    const val ROUGE_TEXTE = 0xFFFFB4A6L
    const val ACCENT = 0xFF4B5AE0L
    const val VIOLET_1 = 0xFF8A2BFFL
    const val VIOLET_2 = 0xFFD11CFFL
    const val OR = 0xFFF2C366L

    /** Couleurs des espaces et des lettres d'onglets (or, bleu, menthe, corail, rose, lilas). */
    val TEINTES = listOf(0xFFF2C366L, 0xFF7FB2FFL, 0xFF6CE0B8L, 0xFFFF9C86L, 0xFFFF9AD5L, 0xFFB49CFFL)

    /** Une couleur stable pour un nom (même site = même couleur sur tous les appareils). */
    fun teintePour(nom: String): Long {
        var h = 0
        for (c in nom) h = 31 * h + c.code
        return TEINTES[Math.floorMod(h, TEINTES.size)]
    }

    // --- contraste (WCAG 2.1) : pour vérifier dans les essais que le texte reste lisible sur chaque thème

    private fun canal(c: Int): Double {
        val s = c / 255.0
        return if (s <= 0.03928) s / 12.92 else Math.pow((s + 0.055) / 1.055, 2.4)
    }

    fun luminance(argb: Long): Double {
        val r = ((argb shr 16) and 0xFF).toInt()
        val g = ((argb shr 8) and 0xFF).toInt()
        val b = (argb and 0xFF).toInt()
        return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
    }

    /** Mélange une couleur à demi transparente sur un fond opaque. */
    fun poser(dessus: Long, fond: Long): Long {
        val a = ((dessus shr 24) and 0xFF) / 255.0
        fun m(dec: Int): Long {
            val d = (dessus shr dec) and 0xFF
            val f = (fond shr dec) and 0xFF
            return Math.round(d * a + f * (1 - a)).toLong() and 0xFF
        }
        return (0xFFL shl 24) or (m(16) shl 16) or (m(8) shl 8) or m(0)
    }

    fun contraste(a: Long, b: Long): Double {
        val la = luminance(a)
        val lb = luminance(b)
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
    }
}
