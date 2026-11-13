// Odin Launcher — l'écran d'accueil Odin OS pour Android.
// Une vue web plein écran affiche le bureau d'Odin OS (version téléphone) servi par Odin : sur le téléphone même
// (http://127.0.0.1:7777, base Ubuntu dans Termux) ou sur un serveur. Sans Odin joignable : le bureau embarqué, en mode essai.
// Un pont (window.OdinAndroid) donne au bureau les applis du téléphone et quelques réglages d'Android.
package os.odin.lanceur;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;

public class Lanceur extends Activity {
    private static final String ESSAI = "file:///android_asset/os/index.html?ecran=mobile&essai";
    private static final String ADRESSE_LOCALE = "http://127.0.0.1:7777";
    private WebView vue;
    private SharedPreferences reglages;
    /** Origine de la page affichée : le pont ne répond qu'au bureau d'Odin OS (embarqué, ou à l'adresse choisie). */
    private volatile String origine = "";

    @Override
    protected void onCreate(Bundle etat) {
        super.onCreate(etat);
        reglages = getSharedPreferences("odin-os", Context.MODE_PRIVATE);
        vue = new WebView(this);
        vue.setBackgroundColor(0xFF101A24);
        WebSettings s = vue.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        vue.addJavascriptInterface(new Pont(), "OdinAndroid");
        vue.setWebViewClient(new Client());
        setContentView(vue);
        charger();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Plein écran : le bureau dessine sa propre barre d'état.
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    /** Le bouton « retour » d'Android ferme l'appli ouverte dans le bureau : on ne quitte pas l'écran d'accueil. */
    @Override
    public void onBackPressed() {
        vue.evaluateJavascript("window.odinRetour && window.odinRetour()", null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Touche « accueil » : retour à l'accueil du bureau.
        vue.evaluateJavascript("(function(){var b=document.querySelector('#mobile .nav-m button:nth-child(2)');if(b)b.click();})()", null);
    }

    private String adresse() {
        return reglages.getString("adresse", ADRESSE_LOCALE).trim();
    }

    private static String origineDe(String url) {
        if (url == null) return "";
        if (url.startsWith("file:///android_asset/")) return "embarque";
        Uri u = Uri.parse(url);
        return u.getScheme() + "://" + u.getAuthority();
    }

    /** Affiche le bureau servi par Odin s'il répond, sinon le bureau embarqué (mode essai). */
    private void charger() {
        final String adr = adresse();
        if (adr.isEmpty()) { vue.loadUrl(ESSAI); return; }
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean repond = false;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(adr + "/health").openConnection();
                    c.setConnectTimeout(2500);
                    c.setReadTimeout(2500);
                    repond = c.getResponseCode() == 200;
                    c.disconnect();
                } catch (Exception e) {
                    repond = false;
                }
                final boolean ok = repond;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        vue.loadUrl(ok ? adr + "/os/?ecran=mobile" : ESSAI);
                        if (!ok && !ADRESSE_LOCALE.equals(adr)) Toast.makeText(Lanceur.this, "Odin ne répond pas à " + adr + " : mode essai.", Toast.LENGTH_LONG).show();
                    }
                });
            }
        }).start();
    }

    private class Client extends WebViewClient {
        @Override
        public void onPageStarted(WebView v, String url, Bitmap icone) {
            origine = origineDe(url);
        }

        /** Le bureau reste sur son adresse ; tout autre lien s'ouvre dans le navigateur du téléphone. */
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, String url) {
            String o = origineDe(url);
            if (o.equals("embarque") || o.equals(origineDe(adresse()))) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { /* aucun navigateur */ }
            return true;
        }

        /** Certificat non reconnu : on n'insiste jamais. Le bureau embarqué explique quoi faire. */
        @Override
        public void onReceivedSslError(WebView v, SslErrorHandler h, SslError e) {
            h.cancel();
            Toast.makeText(Lanceur.this, "Certificat d'Odin non reconnu : installe-le sur le téléphone (adresse d'Odin + /odin-cert.crt), ou utilise http sur ton réseau.", Toast.LENGTH_LONG).show();
            v.loadUrl(ESSAI);
        }
    }

    /** Le pont entre le bureau et Android. Chaque appel vérifie que c'est bien le bureau d'Odin OS qui demande. */
    private class Pont {
        private boolean sur() {
            String o = origine;
            return o.equals("embarque") || (!o.isEmpty() && o.equals(origineDe(adresse())));
        }

        /** Les applis du téléphone (celles qui ont une icône de lancement), en JSON : [{"paquet":"…","nom":"…"}]. */
        @JavascriptInterface
        public String applis() {
            if (!sur()) return "[]";
            PackageManager pm = getPackageManager();
            Intent i = new Intent(Intent.ACTION_MAIN, null);
            i.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> liste = pm.queryIntentActivities(i, 0);
            StringBuilder b = new StringBuilder("[");
            for (ResolveInfo r : liste) {
                String p = r.activityInfo.packageName;
                if (p.equals(getPackageName())) continue;
                if (b.length() > 1) b.append(',');
                b.append("{\"paquet\":").append(json(p)).append(",\"nom\":").append(json(String.valueOf(r.loadLabel(pm)))).append('}');
            }
            return b.append(']').toString();
        }

        /** L'icône d'une appli, en PNG (base64), 96 points. */
        @JavascriptInterface
        public String icone(String paquet) {
            if (!sur()) return "";
            try {
                Drawable d = getPackageManager().getApplicationIcon(paquet);
                Bitmap image = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888);
                Canvas c = new Canvas(image);
                d.setBounds(0, 0, 96, 96);
                d.draw(c);
                ByteArrayOutputStream o = new ByteArrayOutputStream();
                image.compress(Bitmap.CompressFormat.PNG, 100, o);
                return Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void lancer(String paquet) {
            if (!sur()) return;
            Intent i = getPackageManager().getLaunchIntentForPackage(paquet);
            if (i != null) startActivity(i);
        }

        /** Ouvre un écran de réglages d'Android : wifi, bluetooth, reglages, lanceur (choix de l'écran d'accueil). */
        @JavascriptInterface
        public void reglage(String nom) {
            if (!sur()) return;
            String action = "wifi".equals(nom) ? Settings.ACTION_WIFI_SETTINGS : "bluetooth".equals(nom) ? Settings.ACTION_BLUETOOTH_SETTINGS : "lanceur".equals(nom) ? Settings.ACTION_HOME_SETTINGS : Settings.ACTION_SETTINGS;
            try { startActivity(new Intent(action)); } catch (Exception e) { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
        }

        /** L'adresse d'Odin à laquelle le lanceur se relie (vide : mode essai). */
        @JavascriptInterface
        public String adresse() {
            return sur() ? Lanceur.this.adresse() : "";
        }

        @JavascriptInterface
        public void definirAdresse(String a) {
            if (!sur()) return;
            String propre = a == null ? "" : a.trim().replaceAll("/+$", "");
            if (!propre.isEmpty() && !propre.matches("^https?://[A-Za-z0-9.\\-\\[\\]:]+$")) return;
            reglages.edit().putString("adresse", propre).apply();
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    charger();
                }
            });
        }
    }

    private static String json(String t) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < t.length(); i++) {
            char c = t.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }
}
