# NoText - Application de Sexting Visuel Anonyme

🔥 Une application mobile épurée pour les échanges visuels intimes et anonymes.

## � Concept

NoText est une application de sexting privé sans messages texte, où les utilisateurs s'échangent exclusivement des photos ou vidéos. L'interface est épurée, intime, pensée pour le plaisir visuel et la fluidité des échanges.

### ✨ Caractéristiques principales

- **100% visuel** : Aucun message texte, uniquement photos et vidéos
- **Authentification simple** : Pseudo unique, âge, sexe - pas d'email ni mot de passe
- **Médias éphémères** : Option "vue unique" (🔥) ou "revisitable" (♾️)
- **Interface minimaliste** : Navigation par swipes, design noir/violet sensuel
- **Anonymat complet** : Un seul appareil par pseudo, suppression automatique

## 🚀 Installation et Configuration

### Prérequis

- Node.js (v16+)
- Expo CLI
- Compte Supabase

### 1. Installation des dépendances

```bash
npm install
```

### 2. Configuration Supabase

Créez un projet Supabase et exécutez le script SQL suivant :

```sql
-- USERS
create table users (
  id uuid primary key default gen_random_uuid(),
  pseudo text unique not null,
  sexe text check (sexe in ('H','F','Autre')) not null,
  age int check (age >= 18) not null,
  device_id text not null,
  created_at timestamp default now()
);

-- MESSAGES
create table messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references users(id) on delete cascade,
  receiver_id uuid references users(id) on delete cascade,
  media_url text not null,
  media_type text check (media_type in ('photo','video')) not null,
  caption text,
  view_once boolean default true,
  seen boolean default false,
  created_at timestamp default now(),
  viewed_at timestamp
);

-- ENABLE RLS
alter table users enable row level security;
alter table messages enable row level security;

-- BUCKET STORAGE
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', false);
```

### 3. Variables d'environnement

Créez un fichier `.env` :

```env
SUPABASE_URL=votre_url_supabase
SUPABASE_ANON_KEY=votre_clé_anonyme
```

### 4. Démarrage

```bash
npm start
```

## 🏗️ Architecture

### Structure des dossiers

```
app/
├── _layout.tsx          # Navigation et authentification
├── screens/             # Écrans de l'application
│   ├── AuthScreen.js    # Authentification
│   ├── HomeScreen.js    # Liste des conversations
│   ├── ChatScreen.js    # Affichage des médias (style story)
│   └── CameraScreen.js  # Capture photo/vidéo
├── components/          # Composants réutilisables
│   ├── MediaViewer.js   # Affichage des médias
│   ├── UserTile.js      # Tuile utilisateur
│   └── CameraOverlay.js # Interface caméra
├── services/            # Services backend
│   ├── supabaseClient.js
│   ├── userService.js
│   └── mediaService.js
├── hooks/               # Hooks React
│   ├── useAuth.js
│   └── usePermissions.js
└── utils/               # Utilitaires
    └── secureStore.js   # Stockage sécurisé
```

### Technologies utilisées

- **React Native** avec Expo (Managed Workflow)
- **Supabase** (Base de données + Storage)
- **Expo Camera** pour la capture photo/vidéo
- **React Navigation** pour la navigation
- **Reanimated 3** pour les animations et gestes
- **Expo Secure Store** pour le stockage local sécurisé

## 🎮 Fonctionnalités

### 🔐 Authentification

- Pseudo unique (3+ caractères)
- Âge (18+ requis)
- Sexe (H/F/Autre)
- Device ID unique automatique
- Un seul appareil connecté par pseudo

### 🏠 Page d'accueil

- Liste des conversations récentes
- Miniature du dernier média échangé
- Indicateur 🔥 pour nouveaux messages
- Flou pour médias "vue unique" déjà vus
- Recherche par pseudo

### 💬 Chat visuel (Story-like)

- Affichage plein écran du média
- Navigation par swipe gauche/droite
- Swipe haut → Caméra
- Swipe bas → Retour accueil
- Médias floutés si déjà vus (vue unique)

### 📸 Caméra

- Appui simple → Photo
- Appui long → Vidéo (max 30s)
- Switch avant/arrière
- Mode 🔥 (vue unique) ou ♾️ (revisitable)
- Légende optionnelle
- Aperçu avant envoi

## 🎨 Design System

### Palette de couleurs

- **Noir** (`#0f0f0f`, `#1a1a1a`) - Arrière-plans
- **Violet** (`#8b5cf6`, `#2d1b69`) - Accents principaux
- **Rouge doux** (`#ff4444`) - Notifications
- **Blanc** (`#fff`) - Textes principaux
- **Gris** (`#666`, `#ccc`) - Textes secondaires

### Effets visuels

- **BlurView** pour les overlays
- **LinearGradient** pour les arrière-plans
- **Animations fluides** avec Reanimated
- **Effet de flou** pour médias vus
- **Haptic feedback** pour les interactions

## 🔒 Sécurité et Confidentialité

### Données utilisateur

- Aucune donnée personnelle stockée (pas d'email, téléphone)
- Device ID généré automatiquement et stocké localement
- Suppression automatique lors de la déconnexion

### Médias

- Stockage Supabase avec URL signées temporaires
- Suppression automatique des médias "vue unique" après visualisation
- Aucune sauvegarde locale dans la galerie

### Authentification

- Pas de mot de passe
- Session liée au device ID
- Déconnexion automatique si changement d'appareil

## 📋 TODO / Améliorations futures

### Fonctionnalités

- [ ] Notifications push en temps réel
- [ ] Système de blocage d'utilisateurs
- [ ] "Note de température" privée par contact
- [ ] Mode sombre/clair
- [ ] Réactions rapides (🔥❤️😍)

### Technique

- [ ] Optimisation du cache des images
- [ ] Compression automatique des médias
- [ ] Synchronisation en temps réel (WebSocket)
- [ ] Tests unitaires et d'intégration
- [ ] CI/CD pour deployment automatique

### UX/UI

- [ ] Animations de transition plus fluides
- [ ] Onboarding interactif
- [ ] Tutoriel gestes
- [ ] Feedback visuel amélioré

## 🚀 Déploiement

### Build de production

```bash
# Android
npx expo build:android

# iOS
npx expo build:ios
```

### Variables d'environnement production

Assurez-vous de configurer les variables dans l'environnement de production :

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

## 🤝 Contribution

1. Fork du projet
2. Créer une branche feature (`git checkout -b feature/nouvelle-fonctionnalite`)
3. Commit des changements (`git commit -am 'Ajout nouvelle fonctionnalité'`)
4. Push vers la branche (`git push origin feature/nouvelle-fonctionnalite`)
5. Créer une Pull Request

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier `LICENSE` pour plus de détails.

## 🔗 Liens utiles

- [Documentation Expo](https://docs.expo.dev/)
- [Documentation Supabase](https://supabase.com/docs)
- [React Navigation](https://reactnavigation.org/)
- [Reanimated](https://docs.swmansion.com/react-native-reanimated/)

---

**⚠️ Avertissement** : Cette application est destinée à un usage entre adultes consentants. Respectez les lois locales et les conditions d'utilisation des plateformes de distribution.
