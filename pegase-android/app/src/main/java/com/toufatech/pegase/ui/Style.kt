package com.toufatech.pegase.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.toufatech.pegase.R
import com.toufatech.pegase.coeur.Palette
import com.toufatech.pegase.coeur.Palettes
import com.toufatech.pegase.coeur.Theme
import kotlin.math.abs
import kotlin.math.max

// ------------------------------------------------------------------ couleurs et polices de la maquette

fun Long.c(): Color = Color(this.toInt())

val LocalPalette = staticCompositionLocalOf { Palettes.de(Theme.BLEU) }

/** IBM Plex Sans (texte) et Bricolage Grotesque (titres), licence OFL, polices variables. */
val Plex = FontFamily(
    Font(R.font.ibm_plex_sans, FontWeight.Normal),
    Font(R.font.ibm_plex_sans, FontWeight.Medium),
    Font(R.font.ibm_plex_sans, FontWeight.SemiBold),
    Font(R.font.ibm_plex_sans, FontWeight.Bold),
)
val Bricolage = FontFamily(Font(R.font.bricolage_grotesque, FontWeight.Bold))

fun style(taille: TextUnit = 15.sp, poids: FontWeight = FontWeight.Normal, couleur: Color = Color.Unspecified, titre: Boolean = false) =
    TextStyle(fontFamily = if (titre) Bricolage else Plex, fontSize = taille, fontWeight = if (titre) FontWeight.Bold else poids, color = couleur)

@Composable
fun T(
    texte: String,
    modifier: Modifier = Modifier,
    taille: TextUnit = 15.sp,
    poids: FontWeight = FontWeight.Normal,
    couleur: Color? = null,
    doux: Boolean = false,
    titre: Boolean = false,
    lignes: Int = Int.MAX_VALUE,
) {
    val p = LocalPalette.current
    Text(
        texte,
        modifier = modifier,
        style = style(taille, poids, couleur ?: (if (doux) p.texteDoux else p.texte).c(), titre),
        maxLines = lignes,
        overflow = TextOverflow.Ellipsis,
    )
}

/** Le fond des écrans : couleur, taches (transparent, glace) et voile en dégradé à 160°, comme la maquette. */
fun Modifier.fondPegase(p: Palette): Modifier = drawBehind {
    if (p.vitre) {
        // Le fond d'écran du téléphone se voit à travers : un léger voile bleu pour garder la barre lisible.
        drawRect(Color(0x591B3A6B))
    } else {
        drawRect(p.base.c())
        for (t in p.taches) {
            val r = max(t.rx * size.width, t.ry * size.height) * 0.7f
            drawRect(
                Brush.radialGradient(
                    listOf(t.couleur.c(), t.couleur.c().copy(alpha = 0f)),
                    center = Offset(t.x * size.width, t.y * size.height),
                    radius = r.coerceAtLeast(1f),
                ),
            )
        }
    }
    // Direction CSS 160° : vers le bas, un peu vers la droite.
    val dx = 0.342f
    val dy = 0.940f
    val long = abs(size.width * dx) + abs(size.height * dy)
    val c = Offset(size.width / 2, size.height / 2)
    val debut = c - Offset(dx, dy) * (long / 2)
    val fin = c + Offset(dx, dy) * (long / 2)
    drawRect(Brush.linearGradient(*p.voile.map { it.position to it.couleur.c() }.toTypedArray(), start = debut, end = fin))
}

// ------------------------------------------------------------------ icônes (tracés repris de la maquette, 24×24)

private fun cercle(cx: Float, cy: Float, r: Float) = "M${cx - r},${cy}a$r,$r 0 1,0 ${2 * r},0a$r,$r 0 1,0 ${-2 * r},0"
private fun rect(x: Float, y: Float, w: Float, h: Float, r: Float) =
    "M${x + r},${y}h${w - 2 * r}a$r,$r 0 0 1 $r,$r" + "v${h - 2 * r}a$r,$r 0 0 1 -$r,$r" + "h${-(w - 2 * r)}a$r,$r 0 0 1 -$r,-$r" + "v${-(h - 2 * r)}a$r,$r 0 0 1 $r,-${r}z"

private fun icone(nom: String, vararg d: String, epaisseur: Float = 1.9f, plein: Boolean = false): ImageVector =
    ImageVector.Builder(nom, 24.dp, 24.dp, 24f, 24f).apply {
        for (chemin in d) {
            addPath(
                pathData = addPathNodes(chemin),
                fill = if (plein) SolidColor(Color.Black) else null,
                stroke = if (plein) null else SolidColor(Color.Black),
                strokeLineWidth = epaisseur,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
    }.build()

object Icones {
    val recul = icone("recul", "M19 12H5", "M11 6l-6 6 6 6")
    val avance = icone("avance", "M5 12h14", "M13 6l6 6-6 6")
    val plus = icone("plus", "M12 5v14M5 12h14", epaisseur = 2f)
    val fermer = icone("fermer", "M6 6l12 12M18 6L6 18", epaisseur = 2.4f)
    val fermerRond = icone("fermerRond", cercle(12f, 12f, 9f), "M9 9l6 6M15 9l-6 6")
    val bouclier = icone("bouclier", "M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z", "M8.5 12l2.5 2.5 4.5-5", epaisseur = 2.2f)
    val bouclierVide = icone("bouclierVide", "M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z", epaisseur = 2.2f)
    val loupe = icone("loupe", cercle(11f, 11f, 7f), "M20 20l-3.5-3.5", epaisseur = 2.2f)
    val micro = icone("micro", rect(9f, 3f, 6f, 11f, 3f), "M5 11a7 7 0 0 0 14 0", "M12 18v3", epaisseur = 2f)
    val profil = icone("profil", cercle(12f, 8f, 4f), "M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6", epaisseur = 2.2f)
    val dossier = icone("dossier", "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", epaisseur = 1.8f)
    val dossierPlus = icone("dossierPlus", "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M12 10v6M9 13h6", epaisseur = 1.8f)
    val video = icone("video", rect(3f, 5f, 18f, 14f, 2f), "M12 11h7v6h-7z")
    val partage = icone("partage", rect(3f, 4f, 18f, 16f, 2f), "M3 12h18", epaisseur = 2f)
    val partagePlus = icone("partagePlus", rect(3f, 4f, 18f, 16f, 2f), "M12 4v16M15 12h4M17 10v4")
    val prive = icone("prive", "M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z", "M4 4l16 16")
    val oeil = icone("oeil", "M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z", cercle(12f, 12f, 3f))
    val espaces = icone("espaces", "M7 3h10v18H7z", "M11 17h2")
    val telecharger = icone("telecharger", "M12 4v10", "M8 10l4 4 4-4", "M5 20h14")
    val ranges = icone("ranges", "M3 4h18v5H3z", "M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9")
    val reglages = icone("reglages", cercle(12f, 12f, 3f), "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1")
    val sortie = icone("sortie", "M15 4h4v16h-4", "M10 8l-4 4 4 4", "M6 12h10")
    val lecture = icone("lecture", "M7 4.5v15l13-7.5z", plein = true)
    val pause = icone("pause", rect(6f, 5f, 4f, 14f, 1f), rect(14f, 5f, 4f, 14f, 1f), plein = true)
    val retourOnglet = icone("retourOnglet", "M15 5H5v10", "M5 5l9 9", epaisseur = 2.2f)
    val coche = icone("coche", "M5 12l5 5 9-10", epaisseur = 3f)
    val etoile = icone("etoile", "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z")
    val agenda = icone("agenda", rect(3f, 5f, 18f, 16f, 2f), "M3 10h18M8 3v4M16 3v4")
    val odin = icone("odin", "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z", "M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z")
    val menu = icone("menu", "M4 7h16M4 12h16M4 17h16", epaisseur = 2f)
    val ranger = icone("ranger", "M4 6h16M7 12h10M10 18h4", epaisseur = 2f)
    val haut = icone("haut", "M6 15l6-6 6 6", epaisseur = 2.2f)
    val recharger = icone("recharger", "M20 11a8 8 0 1 0-2.3 5.7", "M20 4v7h-7", epaisseur = 2f)
}

@Composable
fun Icone(v: ImageVector, description: String?, couleur: Color = LocalPalette.current.texte.c(), taille: Dp = 22.dp) {
    Icon(v, description, Modifier.size(taille), tint = couleur)
}

/** Un bouton d'icône de la barre du bas (48 × 44, cible tactile suffisante). */
@Composable
fun BoutonIcone(
    v: ImageVector,
    description: String,
    onClick: () -> Unit,
    couleur: Color = LocalPalette.current.texte.c(),
    actif: Boolean = true,
    taille: Dp = 22.dp,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .size(48.dp, 44.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable(enabled = actif, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Icone(v, null, if (actif) couleur else couleur.copy(alpha = 0.45f), taille)
    }
}

/** La lettre colorée d'un site ou d'un onglet (« T » sur fond or). */
@Composable
fun Lettre(nom: String, fond: Color, taille: Dp = 20.dp, coin: Dp = 6.dp, tailleTexte: TextUnit = 11.sp) {
    val l = nom.trim().removePrefix("www.").firstOrNull { it.isLetterOrDigit() }?.uppercaseChar()?.toString() ?: "·"
    Box(Modifier.size(taille).clip(RoundedCornerShape(coin)).background(fond), contentAlignment = Alignment.Center) {
        Text(l, style = style(tailleTexte, FontWeight.Bold, Color(0xFF14151E)))
    }
}

/** L'avatar du profil : un anneau aux couleurs de Pégase et l'initiale. */
@Composable
fun Avatar(nom: String, taille: Dp) {
    val anneau = Brush.sweepGradient(listOf(Color(0xFFF2C366), Color(0xFFFF9C86), Color(0xFFB49CFF), Color(0xFF7FB2FF), Color(0xFF6CE0B8), Color(0xFFF2C366)))
    Box(Modifier.size(taille).clip(CircleShape).background(anneau).padding(3.dp)) {
        Box(Modifier.fillMaxSize().clip(CircleShape).background(Color(0xFF20223A)), contentAlignment = Alignment.Center) {
            Text(nom.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?", style = style((taille.value * 0.38f).sp, titre = true, couleur = Color(0xFFF2C366)))
        }
    }
}

/** La pastille « Odin » (verte quand la synchro marche). */
@Composable
fun PastilleOdin(enLigne: Boolean) {
    val vert = Palettes.VERT.c()
    Row(
        Modifier.height(30.dp).clip(RoundedCornerShape(15.dp)).background(if (enLigne) vert.copy(alpha = 0.16f) else Color(0x29FFFFFF)).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(if (enLigne) vert else Color(0xFF9AA0B4)))
        Text("Odin", style = style(12.sp, FontWeight.SemiBold, if (enLigne) Palettes.VERT_TEXTE.c() else LocalPalette.current.texteDoux.c()))
    }
}

/** Le bouton principal (dégradé violet de la maquette). */
@Composable
fun BoutonPrincipal(texte: String, onClick: () -> Unit, modifier: Modifier = Modifier, actif: Boolean = true) {
    Box(
        modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(13.dp))
            .background(Brush.linearGradient(listOf(Palettes.VIOLET_1.c(), Palettes.VIOLET_2.c())))
            .clickable(enabled = actif, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) { Text(texte, style = style(15.sp, FontWeight.SemiBold, Color.White.copy(alpha = if (actif) 1f else 0.6f))) }
}

@Composable
fun BoutonContour(texte: String, onClick: () -> Unit, modifier: Modifier = Modifier, couleur: Color = LocalPalette.current.texte.c()) {
    Box(
        modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp))
            .border(1.dp, couleur.copy(alpha = 0.25f), RoundedCornerShape(12.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) { Text(texte, style = style(15.sp, FontWeight.Medium, couleur)) }
}

/** Une tuile (fond blanc léger, coins ronds). */
@Composable
fun Tuile(modifier: Modifier = Modifier, coin: Dp = 14.dp, fort: Boolean = false, onClick: (() -> Unit)? = null, contenu: @Composable BoxScope.() -> Unit) {
    val p = LocalPalette.current
    var m = modifier.clip(RoundedCornerShape(coin)).background((if (fort) p.tuileForte else p.tuile).c())
    if (p.givre) m = m.border(1.dp, p.bordure.c(), RoundedCornerShape(coin))
    if (onClick != null) m = m.clickable(onClick = onClick)
    Box(m, content = contenu)
}

/** Un champ de texte de la maquette (étiquette au-dessus, fond léger, bord fin). */
@Composable
fun Champ(
    valeur: String,
    changer: (String) -> Unit,
    etiquette: String? = null,
    indice: String = "",
    modifier: Modifier = Modifier,
    motDePasse: Boolean = false,
    visible: Boolean = false,
    clavier: KeyboardType = KeyboardType.Text,
    action: ImeAction = ImeAction.Next,
    surAction: () -> Unit = {},
    apres: (@Composable () -> Unit)? = null,
) {
    val p = LocalPalette.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (etiquette != null) T(etiquette, taille = 12.sp, doux = true)
        Row(
            Modifier.fillMaxWidth().height(46.dp).clip(RoundedCornerShape(11.dp)).background(p.tuile.c())
                .border(1.dp, p.bordure.c(), RoundedCornerShape(11.dp)).padding(start = 12.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f)) {
                if (valeur.isEmpty() && indice.isNotEmpty()) T(indice, taille = 15.sp, doux = true, lignes = 1)
                BasicTextField(
                    valeur, changer,
                    singleLine = true,
                    textStyle = style(15.sp, couleur = p.texte.c()),
                    cursorBrush = SolidColor(p.texte.c()),
                    visualTransformation = if (motDePasse && !visible) PasswordVisualTransformation() else VisualTransformation.None,
                    keyboardOptions = KeyboardOptions(keyboardType = if (motDePasse) KeyboardType.Password else clavier, imeAction = action),
                    keyboardActions = KeyboardActions(onAny = { surAction() }),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            apres?.invoke()
        }
    }
}

/** Une feuille du bas (menu, téléchargement…) posée sur un voile ; toucher le voile la ferme. */
@Composable
fun FeuilleDuBas(fermer: () -> Unit, modifier: Modifier = Modifier, contenu: @Composable ColumnScope.() -> Unit) {
    val p = LocalPalette.current
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier.fillMaxSize().background(Color(0x7308090E))
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = fermer)
                .semantics { contentDescription = "Fermer" },
        )
        var m = modifier.align(Alignment.BottomCenter).fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
            .background(p.feuille.c())
        if (p.givre) m = m.border(1.dp, p.bordure.c(), RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
        Column(
            m.clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .navigationBarsPadding().imePadding().padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.align(Alignment.CenterHorizontally).width(40.dp).height(5.dp).clip(RoundedCornerShape(3.dp)).background(p.texte.c().copy(alpha = 0.3f)))
            contenu()
        }
    }
}

/** Un interrupteur de la maquette (vert quand il est mis). */
@Composable
fun Interrupteur(mis: Boolean, changer: (Boolean) -> Unit, description: String, actif: Boolean = true) {
    Box(
        Modifier.size(42.dp, 24.dp).clip(RoundedCornerShape(12.dp))
            .background(if (mis) Palettes.VERT.c() else Color(0x4DFFFFFF))
            .clickable(enabled = actif, role = Role.Switch) { changer(!mis) }
            .semantics { contentDescription = description + if (mis) " : oui" else " : non" },
    ) {
        Box(Modifier.align(if (mis) Alignment.CenterEnd else Alignment.CenterStart).padding(3.dp).size(18.dp).clip(CircleShape).background(Color.White))
    }
}
