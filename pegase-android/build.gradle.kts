// AGP 9 compile le Kotlin lui-même (« Kotlin intégré ») : pas de plugin org.jetbrains.kotlin.android.
// On fixe quand même la version du compilateur Kotlin (KGP) pour qu'elle soit la même que celle
// du plugin Compose (sinon AGP prendrait la sienne, plus ancienne).
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath(libs.kotlin.gradle.plugin)
    }
}

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
