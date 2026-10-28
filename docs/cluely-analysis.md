# Analyse de Cluely v2.0.198 (Windows)

Source : `%LOCALAPPDATA%\Programs\cluely-v2\resources\app.asar`, extrait puis lu statiquement
(main process `dist-electron/main.js` régions `electron/domains/*`, renderer `dist/assets/*`).
Rien n'a été exécuté. « Observé » = lu dans le code livré ; « Inféré » = déduit ; « Inconnu » = côté serveur.

## Architecture (observé)

- Electron + React (TanStack Router), état partagé unique `shared-state.json` (zod) diffusé à toutes
  les fenêtres par IPC `shared-state-updated` ; les fenêtres le modifient via `patch-shared-state`.
- Le renderer est chargé depuis `https://renderer.v2.cluely.com`, intercepté et servi depuis `dist/` local.
- Backend `api.v2.cluely.com` : oRPC (HTTP) + Cloudflare Agent `ChatAgent` en WebSocket (AI SDK `useChat`).
- Auth Clerk, paiement Stripe/RevenueCat, analytics PostHog, mise à jour electron-updater.

## Fenêtres (observé, `electron/constants.ts`)

| Fenêtre | Taille | Propriétés |
|---|---|---|
| Control (pilule) | 163×50, centrée en haut, y=workArea+25 | transparent, frameless, alwaysOnTop, skipTaskbar, type panel, non redimensionnable |
| Chat | 540 × (140/152 replié, 500 menus, jusqu'à hauteur du contenu ≥350 déplié) | idem, collée 6px sous la pilule, suit ses déplacements |
| Dashboard | 1050×700 (min 800×600) | fenêtre normale, fermeture = masquer |
| MeetingNotification | 360×300 coin haut-droit | « Upcoming Meeting » |
| Onboarding / Splash / Auth | — | permissions, connexion |

- **Invisibilité** : `setContentProtection(isInvisible || isCapturingScreenshot)` sur toutes les fenêtres
  (Windows : `WDA_EXCLUDEFROMCAPTURE`, la fenêtre disparaît des partages d'écran et captures).
- **Ne pas voler le focus** : `noFocusWhenInvisible` → `setFocusable(false)`.
- Affichage sans flash sous Windows : opacity 0 → show → opacity 1 après 30 ms.
- Option « Hide Cluely hides widget » (`hideChatHidesControlWindow`).

## Raccourcis globaux par défaut (observé)

| Action | Accélérateur |
|---|---|
| Afficher/masquer | `Ctrl+\` |
| Ask / Assist | `Ctrl+Enter` |
| Effacer + replier | `Ctrl+R` |
| Démarrer/arrêter session | `Ctrl+Shift+\` |
| Déplacer fenêtre (pas 80px) | `Ctrl+Flèches` |
| Scroll réponse (240px) | `Ctrl+Shift+Haut/Bas` |

Tous éditables ; désactivés pendant l'enregistrement d'un raccourci.

## Audio et transcription (observé)

- **Moi** : micro via `node-record-lpcm16` + SoX, 48 kHz mono PCM16 → IPC `chat-audio-data {role:"me"}`.
- **Eux (Windows)** : `setDisplayMediaRequestHandler` renvoie `{video: écran[0], audio: "loopback"}` →
  le renderer obtient le son système via `getDisplayMedia`. (macOS : binaire `audiotee`.)
- Renderer : Silero VAD (`@ricky0123/vad-web` NonRealTimeVAD, `redemptionMs 300`, `preSpeechPadMs 300`),
  ré-échantillonnage 48→16 kHz, segment forcé à 20 s max, WAV base64 → `transcription.transcribe({wavBase64, language})`.
- Si « eux » parlent, l'audio « moi » est remplacé par du silence (anti-écho).
- Max 4 transcriptions en parallèle ; entrée `transcribing` puis `ready`, supprimée si texte vide.
- Indicateurs `meHasVoiceActivity` / `themHasVoiceActivity`.
- Inactivité : si transcript et messages n'évoluent pas pendant 10 min → modal « Are you still there? ».

## Chat (observé côté client, prompts serveur inconnus)

- Message → `uploadScreenshot` (capture de l'écran sous le chat, PNG ≤1920px, fenêtres masquées
  pendant la capture via content protection) + `uploadPartialAudio` (segments en cours).
- Actions rapides :
  - **Assist** (Ctrl+Enter, champ vide) : « Based on what's on my screen, infer and provide me with the best
    information to help me at the current moment. » / en session : « I'm (the user) in the middle of a
    conversation, and I'm asking you for help without specifically prompting you. »
  - **What should I say?** : « What should I say next? Output only the words I should say. »
  - **Follow-up questions** : « Suggest two follow-up questions… Output as two bullet points. »
  - **Recap** : « Recap the most recent thing that happened in the conversation. »
- **Smart** : « Extra reasoning before answering ». Réponse vide → « Nothing to add right now. »
- Copier, régénérer, effacer ; rendu Markdown + KaTeX + coloration code (Shiki).
- **Ambient chat** (`isAmbientEnabled`) : chat hors réunion.
- Réglage `screenUse` : off / required.

## Modes (observé)

Mode = `chatPrompt` (« Real-time prompt ») + `summarySections[{title, prompt}]` (« Notes template »)
+ fichiers de référence (contexte temps réel). Un seul mode actif. Modèles intégrés :
General, Sales, Recruiting, Team Meet, Looking for work (interview), Lecture — repris tels quels dans
`src/modes.js`.

## Après la session (observé)

Page session : Summary (sections du mode, « Generating notes… »), Transcript, notes perso éditables,
« Ask about this meeting… », Follow-up email (Subject, envoi Gmail / client mail par défaut),
copier résumé/transcript, reprendre la session (`sessions.resume`), ré-analyser, supprimer.
Dashboard : liste des sessions, recherche (« Find meetings, people, and more »), « Ask AI about past meetings ».

## Calendrier (observé)

Google Calendar OAuth, liste des réunions à venir, notification « Upcoming Meeting » avec démarrage
de session, « People in this call » / « Previous meetings » (recherche de personnes côté serveur).

## Réglages (observé)

Langue d'entrée audio, langue de sortie (EN, NL, DE, IT, PL…), micro, thème, ouverture au login,
raccourcis, undetectability, éviter le vol de focus, masquer le widget.

## Hors périmètre du clone

Auth Clerk, Stripe/RevenueCat, PostHog, auto-update, migration v1, deep links, version mobile.
