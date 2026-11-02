# MeetInter : conception

Clone personnel de Cluely (voir `cluely-analysis.md`). Windows d'abord. Aucun compte, aucun serveur :
tout tourne en local, l'IA passe par une clé API, un modèle local ou les CLI Claude Code / Codex.

## Pile

Electron, JavaScript ES modules sans étape de build. Dépendances : `electron`, `@anthropic-ai/sdk`,
`openai`, `marked`. Tests : `node --test`.

## Forme des données (source de vérité unique dans le main process)

```js
State = {
  settings: Settings,
  modes: Mode[],              // intégrés (src/shared/modes.js) + personnalisés
  session: LiveSession|null,  // session en cours, null sinon
  ui: { showChat, chatExpanded, isCapturingScreenshot, meSpeaking, themSpeaking, upcomingMeeting|null,
        recordingShortcut },     // recordingShortcut suspend les raccourcis globaux pendant leur édition
}
Settings = {
  ai: { provider: 'anthropic'|'openai'|'claude-cli'|'codex-cli', model, smartModel, apiKey, baseUrl },
  stt: { baseUrl, apiKey, model, language },   // endpoint OpenAI-compatible /audio/transcriptions
  outputLanguage, invisible, noFocusWhenInvisible, hideChatHidesControl,
  screenUse: 'off'|'required', smartMode, ambient, openAtLogin, icsUrl, activeModeId,
  shortcuts: { toggleVisibility, ask, clear, toggleSession, scrollUp, scrollDown },
}
Mode = { id, name, builtin, chatPrompt, summarySections: {title, prompt}[], files: {name, text}[] }
Segment = { id, at, relativeMs, role: 'me'|'them', text, status: 'transcribing'|'ready' }
Message = { id, role: 'user'|'assistant', text, display?, screenshot?: boolean }
LiveSession = { id, modeId, startedAt, transcript: Segment[], messages: Message[] }
SavedSession = LiveSession & { endedAt, title, notes, summary: string|null, followUpEmail: {subject, body}|null,
                               status: 'summarizing'|'done'|'error', error?: string }
```

Raccourci démarrer/arrêter par défaut : `Ctrl+Alt+\` (Electron refuse `Ctrl+Shift+\` sur cette machine).

Persistance : `userData/settings.json`, `userData/modes.json` (perso seulement), `userData/sessions/<id>.json`.

## Cycle de vie d'une session (machine à états)

`idle → live → summarizing → done` (`error` si le résumé échoue, relançable via « Ré-analyser »).
`live` : capture audio + transcription. L'arrêt sauvegarde, lance le résumé du mode actif, ouvre la session
dans le dashboard. Inactivité : 10 min sans nouveau segment ni message → bandeau « Toujours là ? » dans le chat.

## Processus et fenêtres

| Fenêtre | Rôle |
|---|---|
| control | notch noir fixé en haut au centre de l'écran principal : compact (point de voix + start/stop), s'élargit au survol pour montrer Ask/Hide ; clic logo → dashboard. Zone transparente traversable (`setIgnoreMouseEvents`) |
| chat | 540 px sous la pilule : transcript live repliable, réponses Markdown, actions rapides, input |
| dashboard | sessions (liste + recherche), détail session, modes, réglages, chat « passé » |
| notify | réunion imminente (ICS) avec bouton Démarrer |
| audio (cachée) | capture micro + loopback système, VAD, envoi des segments |

Toutes les fenêtres sauf dashboard : transparent, frameless, alwaysOnTop (niveau `screen-saver`), skipTaskbar.
`setContentProtection(settings.invisible || ui.isCapturingScreenshot)` sur toutes.
Focusable = `!(invisible && noFocusWhenInvisible)`.

## Contrat IPC (preload expose `window.api`)

- `api.getState()` → State ; `api.onState(cb)` reçoit chaque nouvel état.
- `api.patchSettings(partial)`, `api.patchUi(partial)`.
- `api.startSession()`, `api.endSession()`.
- `api.ask({ text?, display?, quick?: 'assist'|'say'|'followup'|'recap' })` → streame via `api.onChatDelta(cb({messageId, delta, done, error}))`.
- `api.clearChat()`, `api.notchHover(bool)`, `api.resizeChat(height)`.
- `api.addSegment(role, wavBase64, at)` (fenêtre audio) ; main transcrit et met à jour l'état.
- Dashboard : `api.listSessions(query)`, `api.getSession(id)`, `api.updateSession(id, {notes, title})`,
  `api.deleteSession(id)`, `api.reanalyze(id)`, `api.followUpEmail(id)`, `api.askSession(id, text)`,
  `api.askPast(text)`, `api.saveMode(mode)`, `api.deleteMode(id)`, `api.addModeFile(id)`.
- Événements main → renderer : `chat-focus-input`, `chat-blur-input`, `chat-scroll {deltaY}`, `chat-submit`.

## IA

`src/main/ai.js` : registre `providers[kind].complete({ system, messages, imagePng?, smart, onDelta })`.
- `anthropic` : SDK, streaming ; smart → `smartModel`.
- `openai` : SDK avec `baseURL` (OpenAI, Ollama `http://localhost:11434/v1`, LM Studio…), streaming.
- `claude-cli` : `claude -p` (image écrite en fichier temporaire et référencée), sortie en une fois.
- `codex-cli` : `codex exec --skip-git-repo-check -i <png> --output-last-message <file> -`, sortie en une fois.

Construction des prompts = fonctions pures (`buildChatPrompt`, `buildSummaryPrompt`, `buildFollowUpPrompt`) :
prompt du mode + fichiers de référence + transcript formaté (`[mm:ss] Moi/Eux: …`) + langue de sortie.
Textes des actions rapides repris de Cluely (voir analyse).

## Audio

Windows : `session.setDisplayMediaRequestHandler` → `{ video: écran[0], audio: 'loopback' }` ; la fenêtre audio
appelle `getDisplayMedia` (son « eux ») et `getUserMedia` (micro « moi »). Les deux flux passent par le
segmenteur pur `src/shared/vad.js` : RMS sur trames de 30 ms à 16 kHz, hystérésis, pré-roll 300 ms,
fin après 600 ms de silence, segment forcé à 20 s, minimum 400 ms de parole. Micro rendu muet pendant que
« eux » parlent (anti-écho, comme Cluely). Segment → WAV 16 kHz mono base64 → main → STT.

## Calendrier

`icsUrl` (adresse secrète iCal de Google Calendar ou autre). Sondage toutes les 5 min, parseur ICS pur
(`DTSTART`, `SUMMARY`, URL Meet/Zoom/Teams dans `LOCATION`/`DESCRIPTION`). Fenêtre notify 2 min avant.

## Hors périmètre

Comptes, facturation, analytics, auto-update, macOS (audiotee), recherche de personnes.
