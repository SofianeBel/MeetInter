# Spec : enregistrement vidéo d'une fenêtre, aligné sur le transcript

## Problème

Après une réunion on n'a que le texte. Les slides, l'écran partagé, les visages sont perdus, et on ne peut pas
réécouter un passage précis du transcript.

## Solution

Option « Enregistrer la vidéo » dans les réglages (désactivée par défaut). Quand elle est active, démarrer une
session ouvre d'abord un sélecteur de fenêtres (vignette + titre). La fenêtre choisie est enregistrée en vidéo
avec le son (micro + système) pendant toute la session. Dans le dashboard, la session affiche un lecteur vidéo
à côté du transcript : cliquer une ligne saute à ce moment de la vidéo, la ligne en cours de lecture est mise en
évidence et suit la lecture. C'est le récap.

## Récits utilisateur

1. Je coche « Enregistrer la vidéo » dans les réglages ; le choix persiste.
2. Avec l'option active, je démarre une session (bouton du notch ou raccourci) et un sélecteur des fenêtres
   ouvertes apparaît ; je clique celle de la réunion et la session démarre.
3. J'annule le sélecteur : la session démarre quand même, sans vidéo (le transcript reste essentiel).
4. Option inactive : rien ne change par rapport à aujourd'hui.
5. En mode invisible, le sélecteur est lui aussi protégé du partage d'écran, comme les autres overlays.
6. Pendant la session, transcription et chat marchent comme avant.
7. Si la fenêtre enregistrée est fermée en cours de route, la vidéo s'arrête là, la session continue.
8. J'arrête la session : la vidéo est finalisée et rattachée à la session sauvegardée.
9. Dans le détail de la session, je vois le lecteur et le transcript ligne par ligne.
10. Je clique une ligne du transcript : la vidéo se place sur cette ligne et joue.
11. Pendant la lecture, la ligne courante est surlignée et reste visible (défilement automatique).
12. Je peux avancer/reculer dans la vidéo avec la barre du lecteur, y compris dans une vidéo d'une heure.
13. Une session sans vidéo affiche le transcript comme aujourd'hui.
14. Supprimer une session supprime aussi sa vidéo.
15. Si l'app plante en pleine session, la vidéo écrite jusque-là n'est pas perdue.

## Décisions d'implémentation

- Réglage `settings.recordVideo: boolean` (défaut `false`), case à cocher dans les réglages du dashboard.
- Sélecteur : `desktopCapturer.getSources({ types: ['window'] })` avec vignettes, dans un petit overlay
  (même règles que les autres overlays : frameless, alwaysOnTop, skipTaskbar, content protection). Les fenêtres
  de MeetInter sont exclues de la liste.
- Capture : la fenêtre audio (cachée) enregistre déjà ; le `setDisplayMediaRequestHandler` renvoie la fenêtre
  choisie au lieu de l'écran 0 quand une vidéo est demandée, toujours avec `audio: 'loopback'`. La piste vidéo
  est gardée au lieu d'être coupée.
- Son de la vidéo : mix micro + loopback via `MediaStreamAudioDestinationNode` dans l'`AudioContext` existant.
  Le mix ne doit pas modifier ce qui part au segmenteur VAD.
- Qualité : 1280×720 max, 60 i/s, WebM (VP9 si dispo, sinon VP8) + Opus, ~4 Mbit/s → ~1,8 Go/heure.
- Écriture : `MediaRecorder` avec timeslice (quelques secondes), chaque morceau est envoyé au main qui l'ajoute
  à `userData/recordings/<sessionId>.webm`. Rien n'est gardé en mémoire jusqu'à la fin.
- Lecture seekable : le WebM de `MediaRecorder` n'a ni durée ni index (cues) ; le lecteur doit pouvoir sauter
  n'importe où dans une vidéo longue. Corriger à la finalisation (durée + cues) par la plus petite solution qui
  marche ; une petite dépendance dédiée est acceptable si nécessaire.
- Alignement : `SavedSession.video = { file, offsetMs } | null`, `offsetMs` = instant de démarrage réel de
  l'enregistrement − `startedAt`. Temps vidéo d'un segment = `relativeMs − offsetMs` (borné à 0). Deux fonctions
  pures dans `src/shared/` : temps vidéo d'un segment, et segment courant pour un temps vidéo donné.
- Servir la vidéo au dashboard : protocole personnalisé (`protocol.handle`) qui ne sert que des fichiers de
  `userData/recordings/`, nom passé par `path.basename`, avec support des requêtes Range.
- Dashboard : l'onglet Transcript affiche le lecteur au-dessus (ou à côté) d'une liste de lignes cliquables
  quand `s.video` existe ; sinon le rendu actuel.
- `deleteSession` supprime aussi le fichier vidéo.
- `docs/design.md` est mis à jour (forme des données, contrat IPC, fenêtres).

## Tests

- Tests `node --test` des deux fonctions pures d'alignement (offset positif, segment avant le début de la vidéo,
  temps entre deux segments, après le dernier, transcript vide). Modèle : `test/vad.test.js`, `test/prompts.test.js`.
- Le reste (capture, sélecteur, lecteur) se vérifie en lançant l'app : vidéo de ~1 min, clic sur une ligne,
  surlignage pendant la lecture, saut au milieu via la barre.

## Hors périmètre

Montage ou découpe, export MP4, sélection auto de la fenêtre Meet/Zoom/Teams, enregistrement d'un écran entier,
bouton start/stop d'enregistrement dans le notch, utilisation de la vidéo par l'IA (résumé, captures), macOS.

## Hypothèses

- Usage perso, une session à la fois ; l'espace disque (~1,8 Go/h) est à la charge de l'utilisateur, pas de
  purge automatique.
- Annuler le sélecteur = session sans vidéo (pas d'annulation de la session).
