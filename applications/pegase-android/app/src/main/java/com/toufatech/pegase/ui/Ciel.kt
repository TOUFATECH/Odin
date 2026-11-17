package com.toufatech.pegase.ui

import android.content.Context
import android.provider.Settings
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalContext
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

// Fond des écrans d'accueil (lancement, connexion à Odin) : nuit noire, étoiles qui scintillent — quelques-unes brillent
// fort (halo et petite croix lumineuse), les autres doucement ; immobile si le téléphone demande moins d'animations.
// Même dessin que Pégase sur l'ordinateur (pegase/src/ui/ecrans.ts, fonction `ciel`), tailles en dp.

/** Une étoile : position (fraction de l'écran), rayon (dp), éclat, nombre de scintillements par période, phase. */
private class Etoile(val x: Float, val y: Float, val r: Float, val b: Float, val tours: Int, val p: Float, val forte: Boolean)

/** Une période de 60 s et un nombre entier de scintillements par période : l'animation boucle sans à-coup. */
private const val PERIODE_S = 60

/** Les mêmes étoiles d'un écran à l'autre (tirées une fois par lancement). */
private val ETOILES: List<Etoile> = List(260) {
    val forte = Random.nextFloat() < 0.07f
    Etoile(
        x = Random.nextFloat(),
        y = Random.nextFloat(),
        r = if (forte) 1.3f + Random.nextFloat() * 1.1f else 0.4f + Random.nextFloat() * 0.9f,
        b = if (forte) 0.85f else 0.25f + Random.nextFloat() * 0.45f,
        // 4 à 19 scintillements par minute : 0,42 à 2 radians par seconde, comme sur l'ordinateur (0,4 à 2).
        tours = 4 + Random.nextInt(16),
        p = Random.nextFloat() * 6.3f,
        forte = forte,
    )
}

private val HALO = Color(0xFFD2E1FF)

/** Le téléphone demande moins d'animations (Accessibilité → « Supprimer les animations » : durée des animations à 0). */
fun animationsSupprimees(c: Context): Boolean =
    try {
        Settings.Global.getFloat(c.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    } catch (e: Exception) {
        false
    }

/** Le ciel noir étoilé, à poser derrière un écran d'accueil (il remplit son `modifier`). */
@Composable
fun Ciel(modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val calme = remember(ctx) { animationsSupprimees(ctx) }
    if (calme) {
        Canvas(modifier) { dessinerCiel(null) }
    } else {
        val temps by rememberInfiniteTransition(label = "ciel").animateFloat(
            initialValue = 0f,
            targetValue = PERIODE_S.toFloat(),
            animationSpec = infiniteRepeatable(tween(PERIODE_S * 1000, easing = LinearEasing), RepeatMode.Restart),
            label = "scintillement",
        )
        // Le temps n'est lu qu'au dessin : seule l'image est refaite à chaque image, pas l'écran.
        Canvas(modifier) { dessinerCiel(temps) }
    }
}

/** `temps` en secondes (null : immobile, chaque étoile à son éclat moyen). */
private fun DrawScope.dessinerCiel(temps: Float?) {
    drawRect(Color.Black)
    val w = size.width
    val h = size.height
    val d = density
    // Autant d'étoiles au cm² que sur un écran d'ordinateur (260 pour 1280 × 800) : moins sur un téléphone.
    val n = (260f * (w / d) * (h / d) / 1_024_000f).roundToInt().coerceIn(110, 260)
    for (i in 0 until n) {
        val s = ETOILES[i]
        val sc = if (temps == null) 1f else 0.55f + 0.45f * sin(temps * (2f * PI.toFloat() * s.tours / PERIODE_S) + s.p)
        val a = min(1f, s.b * (if (s.forte) 0.6f + 0.4f * sc else sc))
        val c = Offset(s.x * w, s.y * h)
        val r = s.r * d
        if (s.forte) {
            val rh = r * 7f
            drawCircle(Brush.radialGradient(listOf(HALO.copy(alpha = a * 0.55f), HALO.copy(alpha = 0f)), center = c, radius = rh), radius = rh, center = c)
            val l = r * (4f + 3f * sc)
            val trait = Color.White.copy(alpha = a * 0.7f)
            drawLine(trait, Offset(c.x - l, c.y), Offset(c.x + l, c.y), strokeWidth = 0.8f * d)
            drawLine(trait, Offset(c.x, c.y - l), Offset(c.x, c.y + l), strokeWidth = 0.8f * d)
        }
        drawCircle(Color.White.copy(alpha = a), radius = r, center = c)
    }
}
