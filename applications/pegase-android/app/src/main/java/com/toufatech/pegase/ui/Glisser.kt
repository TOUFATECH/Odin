package com.toufatech.pegase.ui

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * Une liste (ou une grille de [colonnes]) qu'on range en glissant : appui long, puis glisser (écrans 14 et 17).
 * Les lecteurs d'écran ont « Monter » et « Descendre » à la place du geste.
 * Les éléments ont tous la même hauteur [hauteur] ; [ecart] est l'espace entre deux lignes.
 */
@Composable
fun <T> ListeGlissable(
    elements: List<T>,
    cle: (T) -> Any,
    hauteur: Dp,
    ranger: (List<T>) -> Unit,
    colonnes: Int = 1,
    ecart: Dp = 6.dp,
    contenu: @Composable (element: T, tenu: Boolean) -> Unit,
) {
    var liste by remember(elements) { mutableStateOf(elements) }
    var tenu by remember { mutableStateOf<Any?>(null) }
    var dx by remember { mutableFloatStateOf(0f) }
    var dy by remember { mutableFloatStateOf(0f) }
    val d = LocalDensity.current
    val pasY = with(d) { (hauteur + ecart).toPx() }
    var largeurColonne by remember { mutableFloatStateOf(1f) }

    fun deplacer(k: Any, vers: Int) {
        val i = liste.indexOfFirst { cle(it) == k }
        if (i < 0 || vers !in liste.indices || vers == i) return
        val l = liste.toMutableList()
        l.add(vers, l.removeAt(i))
        liste = l
    }

    Column(verticalArrangement = Arrangement.spacedBy(ecart)) {
        for (ligne in liste.chunked(colonnes)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (e in ligne) {
                    val k = cle(e)
                    val estTenu = tenu == k
                    Box(
                        Modifier.weight(1f).height(hauteur)
                            .graphicsLayer {
                                if (estTenu) {
                                    translationX = dx
                                    translationY = dy
                                    scaleX = 1.03f
                                    scaleY = 1.03f
                                }
                            }
                            .onSizeChanged { largeurColonne = it.width + with(d) { 8.dp.toPx() } }
                            .alpha(if (estTenu) 0.85f else 1f)
                            .semantics {
                                customActions = listOf(
                                    CustomAccessibilityAction("Monter") {
                                        deplacer(k, liste.indexOfFirst { cle(it) == k } - colonnes); ranger(liste); true
                                    },
                                    CustomAccessibilityAction("Descendre") {
                                        deplacer(k, liste.indexOfFirst { cle(it) == k } + colonnes); ranger(liste); true
                                    },
                                )
                            }
                            .pointerInput(k) {
                                detectDragGesturesAfterLongPress(
                                    onDragStart = {
                                        tenu = k
                                        dx = 0f
                                        dy = 0f
                                    },
                                    onDrag = { change, delta ->
                                        change.consume()
                                        dx += delta.x
                                        dy += delta.y
                                        val i = liste.indexOfFirst { cle(it) == k }
                                        val lignes = (dy / pasY).roundToInt()
                                        val cols = if (colonnes > 1) (dx / largeurColonne).roundToInt() else 0
                                        val cible = (i + lignes * colonnes + cols).coerceIn(0, liste.size - 1)
                                        if (cible != i) {
                                            deplacer(k, cible)
                                            dy -= lignes * pasY
                                            dx -= cols * largeurColonne
                                        }
                                    },
                                    onDragEnd = {
                                        tenu = null
                                        dx = 0f
                                        dy = 0f
                                        ranger(liste)
                                    },
                                    onDragCancel = {
                                        tenu = null
                                        dx = 0f
                                        dy = 0f
                                    },
                                )
                            },
                    ) { contenu(e, estTenu) }
                }
                repeat(colonnes - ligne.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/** « Parler » : la reconnaissance vocale du téléphone tape la recherche à ta place. */
@Composable
fun rememberParole(recu: (String) -> Unit): () -> Unit {
    val l = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == Activity.RESULT_OK) {
            r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let(recu)
        }
    }
    return {
        try {
            l.launch(
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_WEB_SEARCH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "fr-FR")
                    .putExtra(RecognizerIntent.EXTRA_PROMPT, "Dis ce que tu cherches"),
            )
        } catch (e: Exception) {
            // Pas de reconnaissance vocale sur ce téléphone : le bouton ne fait rien.
        }
    }
}
