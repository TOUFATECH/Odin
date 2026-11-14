plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.toufatech.pegase"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.toufatech.pegase"
        // GeckoView récent demande Android 8.0 (API 26) au moins.
        minSdk = 26
        // Android 16 : on passera à 37 (Android 17) après l'avoir essayé sur un vrai téléphone.
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-essai"
        }
        release {
            // Pas encore de réduction R8 : à activer après un essai sur téléphone (GeckoView a ses propres règles).
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Pas de signature ici : l'APK « release » sort non signée (la clé reste chez le propriétaire).
        }
    }

    // Un APK par processeur : GeckoView pèse lourd (le moteur complet de Firefox).
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }

    lint {
        // Le rapport de lint est produit, mais il ne bloque pas la construction de l'APK d'essai.
        abortOnError = false
        checkReleaseBuilds = false
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.geckoview)
    implementation(libs.kotlinx.coroutines.android)

    // Essais JVM (la logique pure : synchro, empreintes, conflits, .ics, thèmes, client Odin).
    testImplementation(libs.junit)
    testImplementation(libs.kotlin.test.junit)
}
