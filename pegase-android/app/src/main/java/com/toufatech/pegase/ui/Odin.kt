package com.toufatech.pegase.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.platform.LocalContext
import java.io.File
import java.io.FileOutputStream
import kotlin.math.min

// Odin, le même dessin que dans l'interface d'Odin et dans Pégase sur l'ordinateur (pegase/src/ui/odin-visage.ts) :
// corps bleu en dégradé, deux halos qui tournent, yeux carrés qui clignent, une respiration lente. Immobile si le
// téléphone demande moins d'animations. Repère de 120 × 120 comme le dessin d'origine.

private val CORPS = listOf(Color(0xFF2F6FE0), Color(0xFF3F82F0), Color(0xFF7EAEF8), Color(0xFFC3DBFF))
private val HALO_1 = Color(0xFFC3DBFF)
private val HALO_2 = Color(0xFFFFFFFF)

/** Odin animé, dans un carré (il prend la plus petite des deux tailles de son `modifier`). */
@Composable
fun OdinVisage(modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val calme = remember(ctx) { animationsSupprimees(ctx) }
    if (calme) {
        Canvas(modifier) { dessinerOdin(0f, 0f, 1f, 1f) }
    } else {
        val t = rememberInfiniteTransition(label = "odin")
        val tour1 by t.animateFloat(0f, 360f, infiniteRepeatable(tween(7000, easing = LinearEasing)), label = "halo1")
        val tour2 by t.animateFloat(360f, 0f, infiniteRepeatable(tween(9500, easing = LinearEasing)), label = "halo2")
        val souffle by t.animateFloat(1f, 1.035f, infiniteRepeatable(tween(2200, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "souffle")
        // Un clignement toutes les 5,2 s (comme face.js : fermé à 93,5 % du cycle).
        val yeux by t.animateFloat(
            1f, 1f,
            infiniteRepeatable(
                keyframes {
                    durationMillis = 5200
                    1f at 4732
                    0.08f at 4862
                    1f at 4992
                },
            ),
            label = "clignement",
        )
        Canvas(modifier) { dessinerOdin(tour1, tour2, souffle, yeux) }
    }
}

private fun DrawScope.dessinerOdin(tour1: Float, tour2: Float, souffle: Float, yeux: Float) {
    val k = size.minDimension / 120f
    val o = Offset((size.width - 120f * k) / 2f, (size.height - 120f * k) / 2f)
    fun p(x: Float, y: Float) = Offset(o.x + x * k, o.y + y * k)
    val milieu = p(60f, 60f)
    // Les deux halos (légèrement décalés), qui tournent en sens contraires.
    rotate(tour1, pivot = milieu) {
        val c = p(63f, 64f)
        drawCircle(Brush.radialGradient(0f to HALO_1.copy(alpha = 0.65f), 0.8f to HALO_1.copy(alpha = 0.65f), 0.93f to HALO_1.copy(alpha = 0.38f), 1f to HALO_1.copy(alpha = 0f), center = c, radius = 49f * k), radius = 49f * k, center = c)
    }
    rotate(tour2, pivot = milieu) {
        val c = p(57.5f, 57f)
        drawCircle(Brush.radialGradient(0f to HALO_2.copy(alpha = 0.72f), 0.8f to HALO_2.copy(alpha = 0.72f), 0.93f to HALO_2.copy(alpha = 0.4f), 1f to HALO_2.copy(alpha = 0f), center = c, radius = 48f * k), radius = 48f * k, center = c)
    }
    // Le corps qui respire, et les yeux.
    scale(souffle, pivot = milieu) {
        // Dégradé du dessin d'origine : centre à (50 %, 46 %) du rond, rayon 54 % de sa largeur (88).
        drawCircle(Brush.radialGradient(0f to CORPS[0], 0.5f to CORPS[1], 0.82f to CORPS[2], 1f to CORPS[3], center = p(60f, 56.48f), radius = 47.52f * k), radius = 44f * k, center = milieu)
        for (x in listOf(40f, 65f)) {
            val h = 12f * yeux
            drawRoundRect(Color.White, topLeft = p(x, 50f + (12f - h) / 2f), size = Size(15f * k, h * k), cornerRadius = CornerRadius(2.6f * k))
        }
    }
}

/** La photo du profil : choisie par la personne, coupée en carré au centre et réduite (256 px), gardée sur le téléphone. */
object PhotoProfil {
    /** Lit l'image choisie (bien tournée sur Android 9 et plus), en carré de `cote` pixels ; null si elle est illisible. */
    fun reduite(c: Context, uri: Uri, cote: Int = 256): Bitmap? = try {
        val b: Bitmap? = if (Build.VERSION.SDK_INT >= 28) {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(c.contentResolver, uri)) { decodeur, info, _ ->
                decodeur.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                var ech = 1
                while (min(info.size.width, info.size.height) / (ech * 2) >= cote) ech *= 2
                decodeur.setTargetSampleSize(ech)
            }
        } else {
            val bornes = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            c.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bornes) }
            var ech = 1
            while (bornes.outWidth > 0 && min(bornes.outWidth, bornes.outHeight) / (ech * 2) >= cote) ech *= 2
            c.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = ech }) }
        }
        b?.let {
            val m = min(it.width, it.height)
            Bitmap.createScaledBitmap(Bitmap.createBitmap(it, (it.width - m) / 2, (it.height - m) / 2, m, m), cote, cote, true)
        }
    } catch (e: Exception) {
        null
    }

    fun enregistrer(b: Bitmap, f: File) {
        f.parentFile?.mkdirs()
        FileOutputStream(f).use { b.compress(Bitmap.CompressFormat.JPEG, 86, it) }
    }

    fun lire(f: File): Bitmap? = if (f.isFile) BitmapFactory.decodeFile(f.path) else null
}
