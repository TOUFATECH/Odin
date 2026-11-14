package com.toufatech.pegase

import android.app.PictureInPictureParams
import android.content.Intent
import android.content.res.Configuration
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Rational
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.toufatech.pegase.appli.Ecran
import com.toufatech.pegase.appli.Pegase
import com.toufatech.pegase.appli.PegaseApp
import com.toufatech.pegase.coeur.Oidc
import com.toufatech.pegase.coeur.Palettes
import com.toufatech.pegase.ui.Racine
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private val pegase: Pegase get() = (application as PegaseApp).pegase
    private val minuterie = Handler(Looper.getMainLooper())

    /** En mode image dans l'image (Picture-in-Picture) : seule la vidéo de l'onglet montré est dessinée. */
    var imageDansImage by mutableStateOf(false)
        private set

    private val veille = object : Runnable {
        override fun run() {
            pegase.navigateur.mettreEnVeille()
            minuterie.postDelayed(this, 60_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        pegase.demarrer()
        setContent { Racine(pegase, this) }
        traiter(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        traiter(intent)
    }

    /** Un lien ouvert depuis une autre appli, ou le retour de la connexion unique d'Odin. */
    private fun traiter(i: Intent?) {
        val url = i?.dataString ?: return
        if (i.action != Intent.ACTION_VIEW) return
        when {
            Oidc.estRetour(url) -> pegase.retourSso = url
            url.startsWith("http://") || url.startsWith("https://") -> {
                if (pegase.ecran == Ecran.NAVIGATEUR) pegase.navigateur.ouvrir(url) else pegase.lienEnAttente = url
            }
        }
    }

    /** Thème « transparent » : le fond d'écran du téléphone se voit à travers Pégase (une vraie vitre). */
    fun reglerVitre(vitre: Boolean) {
        if (vitre) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER)
            window.setBackgroundDrawable(ColorDrawable(android.graphics.Color.TRANSPARENT))
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER)
            window.setBackgroundDrawable(ColorDrawable(Palettes.de(pegase.theme, pegase.systemeSombre()).base.toInt()))
        }
    }

    override fun onResume() {
        super.onResume()
        minuterie.postDelayed(veille, 60_000)
    }

    override fun onPause() {
        super.onPause()
        minuterie.removeCallbacks(veille)
        pegase.navigateur.pause()
        pegase.enFond { pegase.profil?.moteur?.rangerMaintenant() }
    }

    /** On quitte Pégase pendant qu'une vidéo joue : elle continue dans une petite fenêtre du téléphone. */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        val o = pegase.navigateur.ongletActif() ?: return
        if (Build.VERSION.SDK_INT >= 26 && o.enLecture && pegase.ecran == Ecran.NAVIGATEUR) {
            o.envoyer(JSONObject().put("type", "video-seule").put("actif", true))
            try {
                enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build())
            } catch (e: Exception) {
                o.envoyer(JSONObject().put("type", "video-seule").put("actif", false))
            }
        }
    }

    override fun onPictureInPictureModeChanged(dansPip: Boolean, config: Configuration) {
        super.onPictureInPictureModeChanged(dansPip, config)
        imageDansImage = dansPip
        if (!dansPip) pegase.navigateur.ongletActif()?.envoyer(JSONObject().put("type", "video-seule").put("actif", false))
    }
}
