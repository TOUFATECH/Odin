// Demandes de tous les jours, en plusieurs langues, pour le corpus de départ de Soul (Noûs) : le propriétaire veut
// qu'Odin ne suppose plus le français (demande du 17/11, n° 21). Mêmes actions dites en français, anglais, espagnol,
// arabe et japonais. Chaque demande n'entre dans le corpus que si l'appli et l'action existent vraiment
// (corpus-depart.ts). D'autres formulations des mêmes actions sont gardées À PART pour mesurer (banc d'essai,
// test/entrainement/demandes-langues.ts) : elles ne sont jamais apprises.
//
// Langues : fr, en, es, ar, ja. Le shimaoré et le kibushi demandent une matière écrite par des personnes qui les
// parlent : rien n'est inventé ici.

export const DEMANDES_LANGUES: Array<{ demande: string; module: string; action: RegExp; langue: string }> = [
  // Vortex : qui est sur le VPN
  { langue: 'en', demande: 'who is connected to the VPN?', module: 'gjoll', action: /^appareils$/ },
  { langue: 'es', demande: '¿quién está conectado a la VPN?', module: 'gjoll', action: /^appareils$/ },
  { langue: 'ar', demande: 'من المتصل بالشبكة الافتراضية الخاصة؟', module: 'gjoll', action: /^appareils$/ },
  { langue: 'ja', demande: 'VPNに接続しているのは誰？', module: 'gjoll', action: /^appareils$/ },
  // Vénus : regarder un film, une série
  { langue: 'en', demande: 'play the movie on the TV', module: 'freyja', action: /^regarder$/ },
  { langue: 'es', demande: 'pon la película en la tele', module: 'freyja', action: /^regarder$/ },
  { langue: 'ar', demande: 'شغّل الفيلم على التلفاز', module: 'freyja', action: /^regarder$/ },
  { langue: 'ja', demande: 'テレビで映画を再生して', module: 'freyja', action: /^regarder$/ },
  // Hygie : ce qui tourne sur la machine
  { langue: 'fr', demande: 'quels programmes tournent sur la machine ?', module: 'eir', action: /^processus$/ },
  { langue: 'en', demande: 'which programs are running on the machine?', module: 'eir', action: /^processus$/ },
  { langue: 'es', demande: '¿qué programas se están ejecutando?', module: 'eir', action: /^processus$/ },
  { langue: 'ar', demande: 'ما البرامج التي تعمل الآن على الجهاز؟', module: 'eir', action: /^processus$/ },
  { langue: 'ja', demande: '今どのプログラムが動いている？', module: 'eir', action: /^processus$/ },
  // Sphinx : bloquer un site
  { langue: 'fr', demande: 'bloque ce site pour toute la maison', module: 'vidarr', action: /^bloquer$/ },
  { langue: 'en', demande: 'block this website for the whole house', module: 'vidarr', action: /^bloquer$/ },
  { langue: 'es', demande: 'bloquea esta web en toda la casa', module: 'vidarr', action: /^bloquer$/ },
  { langue: 'ar', demande: 'احظر هذا الموقع في كل البيت', module: 'vidarr', action: /^bloquer$/ },
  { langue: 'ja', demande: 'このサイトを家全体でブロックして', module: 'vidarr', action: /^bloquer$/ },
  // Phénix : sauvegarder
  { langue: 'fr', demande: 'sauvegarde mon dossier Documents', module: 'sindri', action: /^sauvegarder$/ },
  { langue: 'en', demande: 'back up my Documents folder', module: 'sindri', action: /^sauvegarder$/ },
  { langue: 'es', demande: 'haz una copia de seguridad de mis documentos', module: 'sindri', action: /^sauvegarder$/ },
  { langue: 'ar', demande: 'اعمل نسخة احتياطية لمجلد المستندات', module: 'sindri', action: /^sauvegarder$/ },
  { langue: 'ja', demande: 'ドキュメントフォルダをバックアップして', module: 'sindri', action: /^sauvegarder$/ },
  // Apollon : jouer de la musique
  { langue: 'fr', demande: 'joue du jazz dans le salon', module: 'aegir', action: /^jouer$/ },
  { langue: 'en', demande: 'play some jazz in the living room', module: 'aegir', action: /^jouer$/ },
  { langue: 'es', demande: 'pon jazz en el salón', module: 'aegir', action: /^jouer$/ },
  { langue: 'ar', demande: 'شغّل موسيقى الجاز في الصالون', module: 'aegir', action: /^jouer$/ },
  { langue: 'ja', demande: 'リビングでジャズをかけて', module: 'aegir', action: /^jouer$/ },
  // Chronos : les rendez-vous
  { langue: 'fr', demande: 'quels rendez-vous j\'ai demain ?', module: 'frigg', action: /^agenda$/ },
  { langue: 'en', demande: 'what appointments do I have tomorrow?', module: 'frigg', action: /^agenda$/ },
  { langue: 'es', demande: '¿qué citas tengo mañana?', module: 'frigg', action: /^agenda$/ },
  { langue: 'ar', demande: 'ما مواعيدي غداً؟', module: 'frigg', action: /^agenda$/ },
  { langue: 'ja', demande: '明日の予約は何がある？', module: 'frigg', action: /^agenda$/ },
  // Cyclope : une photo d'une caméra
  { langue: 'fr', demande: 'prends une photo avec la caméra du jardin', module: 'himinbjorg', action: /^photo$/ },
  { langue: 'en', demande: 'take a picture with the garden camera', module: 'himinbjorg', action: /^photo$/ },
  { langue: 'es', demande: 'haz una foto con la cámara del jardín', module: 'himinbjorg', action: /^photo$/ },
  { langue: 'ar', demande: 'التقط صورة بكاميرا الحديقة', module: 'himinbjorg', action: /^photo$/ },
  { langue: 'ja', demande: '庭のカメラで写真を撮って', module: 'himinbjorg', action: /^photo$/ },
  // Genèse : une clé USB de démarrage
  { langue: 'fr', demande: 'prépare une clé USB de démarrage', module: 'thjalfi', action: /^cle_preparer$/ },
  { langue: 'en', demande: 'make a bootable USB stick', module: 'thjalfi', action: /^cle_preparer$/ },
  { langue: 'es', demande: 'prepara una memoria USB de arranque', module: 'thjalfi', action: /^cle_preparer$/ },
  { langue: 'ar', demande: 'جهّز مفتاح USB للإقلاع', module: 'thjalfi', action: /^cle_preparer$/ },
  { langue: 'ja', demande: '起動用のUSBメモリを作って', module: 'thjalfi', action: /^cle_preparer$/ },
  // Thésauros : un mot de passe
  { langue: 'fr', demande: 'génère un mot de passe solide', module: 'brisingamen', action: /^generer$/ },
  { langue: 'en', demande: 'generate a strong password', module: 'brisingamen', action: /^generer$/ },
  { langue: 'es', demande: 'genera una contraseña segura', module: 'brisingamen', action: /^generer$/ },
  { langue: 'ar', demande: 'أنشئ كلمة مرور قوية', module: 'brisingamen', action: /^generer$/ },
  { langue: 'ja', demande: '強いパスワードを作って', module: 'brisingamen', action: /^generer$/ },
  // Pythie : chercher sur le web
  { langue: 'fr', demande: 'cherche sur internet le prix d\'une pompe à chaleur', module: 'volva', action: /^chercher$/ },
  { langue: 'en', demande: 'search the web for heat pump prices', module: 'volva', action: /^chercher$/ },
  { langue: 'es', demande: 'busca en internet el precio de una bomba de calor', module: 'volva', action: /^chercher$/ },
  { langue: 'ar', demande: 'ابحث في الإنترنت عن سعر مضخة حرارية', module: 'volva', action: /^chercher$/ },
  { langue: 'ja', demande: 'ヒートポンプの値段をネットで調べて', module: 'volva', action: /^chercher$/ },
  // Hydre : une machine virtuelle
  { langue: 'fr', demande: 'crée une machine virtuelle Debian', module: 'ymir', action: /^creer_machine$/ },
  { langue: 'en', demande: 'create a Debian virtual machine', module: 'ymir', action: /^creer_machine$/ },
  { langue: 'es', demande: 'crea una máquina virtual Debian', module: 'ymir', action: /^creer_machine$/ },
  { langue: 'ar', demande: 'أنشئ آلة افتراضية ديبيان', module: 'ymir', action: /^creer_machine$/ },
  { langue: 'ja', demande: 'Debianの仮想マシンを作って', module: 'ymir', action: /^creer_machine$/ },
];
