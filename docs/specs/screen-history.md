# Spec : l'IA voit les 5 dernières secondes d'écran

## Problème

« Assister » (et toute question avec `screenUse: 'required'`) joint une seule capture prise au moment du clic.
Quand on demande de l'aide, c'est souvent parce que quelque chose vient de se passer (une slide qui a changé,
un message apparu puis disparu, un code qui défilait). L'IA ne voit que l'état final.

## Solution

Pendant une session, MeetInter garde en mémoire une capture d'écran par seconde sur les 5 dernières secondes.
À chaque question, l'IA reçoit ces captures plus celle de maintenant, dans l'ordre chronologique, et le prompt
le lui dit.

## Récits utilisateur

1. Session en cours, « Utiliser l'écran » sur « Joindre » : je clique « Assister » ; l'IA reçoit jusqu'à
   5 captures (−5 s … −1 s, une par seconde) puis la capture actuelle, la plus ancienne en premier.
2. Sa réponse peut s'appuyer sur ce qui était à l'écran juste avant (ex. une slide qui vient de partir).
3. Juste après le début de la session, il y a moins de 5 s d'historique : l'IA reçoit ce qui existe + maintenant.
4. Hors session (mode ambiant, premier clic qui démarre la session) : une seule capture, comme aujourd'hui.
5. « Utiliser l'écran » sur « Jamais » : aucune capture, aucun tampon ne tourne.
6. Fin de session : le tampon s'arrête et est vidé. Rien n'est jamais écrit sur disque.
7. Questions tapées et actions rapides : même comportement que « Assister » (toute question qui joint l'écran).

## Décisions d'implémentation

- Tampon côté main (`src/main/main.js`) : un `setInterval` de 1 s démarré avec la session, arrêté à la fin
  ou quand `screenUse` passe à `'off'`. Chaque tick capture l'écran le plus proche de la fenêtre chat via
  `desktopCapturer.getSources` en 1280 px de large max, garde `{ at, png }`, et ne conserve que les entrées
  de moins de 5,5 s (au plus 5).
- Un tick est sauté si le précédent n'est pas fini ou si une capture « maintenant » est en cours.
- Les ticks ne basculent PAS `isCapturingScreenshot` (sinon la content protection clignote chaque seconde).
  Conséquence acceptée : si le mode invisible est désactivé, les captures de l'historique peuvent montrer les
  overlays de MeetInter. La capture « maintenant » garde le comportement actuel (`captureScreen`).
- `ask` envoie `images: [...historique, maintenant]` (Buffers PNG) au lieu de `imagePng`. Les 4 fournisseurs
  (`anthropic`, `openai`, `claude-cli`, `codex-cli` via plusieurs `-i`) acceptent une liste.
- `buildChatPrompt` prend `screenshots: n` (au lieu de `hasScreenshot`) : n = 1 → phrase actuelle ;
  n > 1 → « n screenshots, one per second, oldest first, the last one is the screen right now ».
- Le message user garde `screenshot: boolean` (pas de changement de forme des données sauvegardées).

## Hors périmètre

- Pas de vidéo envoyée à l'IA, pas d'extraction d'images depuis l'enregistrement WebM.
- Pas de nouveau réglage (durée et cadence fixes : 5 s, 1 image/s).
- Pas de tampon hors session.
- Pas de mise en avant des 5 dernières secondes du transcript (déjà envoyé en entier).

## Vérification

- `npm test` vert, avec des tests nouveaux pour le prompt (n = 1, n > 1) et pour la sélection des captures
  récentes (fonction pure : âge, ordre, plafond de 5).
- Manuel : session en cours, afficher une page A 3 s puis une page B, cliquer « Assister » en demandant
  « qu'est-ce qui était affiché juste avant ? » : la réponse cite la page A.
