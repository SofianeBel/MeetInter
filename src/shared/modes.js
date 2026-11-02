const sec = (title, prompt) => ({ title, prompt });

const ACTIONS_ME = 'All action items that were said I would do after the meeting.';
const OVERVIEW = 'Concise overview of the conversation and any note-worthy points that were mentioned from the talk.';

export const BUILTIN_MODES = [
  {
    id: 'general', name: 'General', chatPrompt: '',
    summarySections: [
      sec('Action Items', ACTIONS_ME),
      sec('Summary', OVERVIEW),
      sec('Background', 'Context about the conversation and the people involved.'),
      sec('Questions', 'All questions and responses that were asked to me during the conversation.'),
      sec('Overview', 'Detailed overview and notes of the conversation, including any deadlines, specifics, or key reminders.'),
    ],
  },
  {
    id: 'sales', name: 'Sales',
    chatPrompt: 'I am a salesperson selling to prospective buyer. Help me ask quality discovery questions, handle objections, and close the sale.',
    summarySections: [
      sec('Action Items', ACTIONS_ME),
      sec('Outcome', 'How the call ended and the agreed next steps.'),
      sec('Prospect background', 'Who the prospect is, their company, role and context.'),
      sec('Discovery', 'Pain points, needs, goals, budget and timeline the prospect shared.'),
      sec('Product', 'What was said about the product: features shown, pricing, fit.'),
      sec('Objections', 'Objections or concerns raised by the prospect and how they were handled.'),
    ],
  },
  {
    id: 'recruiting', name: 'Recruiting',
    chatPrompt: 'I am a recruiter evaluating job candidates for a position. Help me evaluate the candidate.',
    summarySections: [
      sec('Action Items', ACTIONS_ME),
      sec('Experience and skills', "The candidate's relevant experience, skills and achievements."),
      sec('Quality of responses', 'How clear, specific and convincing the candidate\'s answers were, with examples.'),
      sec('Interest in company', "The candidate's motivation and interest in the company and the role."),
      sec('Role expectations', "What the candidate expects from the role: scope, compensation, availability."),
    ],
  },
  {
    id: 'team', name: 'Team Meet',
    chatPrompt: 'I am in a team meeting. Help me understand what\'s going on and contribute to the conversation if applicable.',
    summarySections: [
      sec('Action Items', ACTIONS_ME),
      sec('Announcements', 'Announcements and news shared with the team.'),
      sec('Team updates', 'Status updates given by each team member.'),
      sec('Challenges or blockers', 'Problems, risks or blockers that were raised.'),
      sec('Decisions made', 'Decisions that were made and who owns them.'),
    ],
  },
  {
    id: 'work', name: 'Looking for work',
    chatPrompt: 'I am a candidate interviewing for a position. Help me answer questions during the interview. If there is code, keep it short with brief comments. If a behavioral question needs an example, give one specific example in two or three sentences.',
    summarySections: [
      sec('Follow-up actions', 'Everything I should do after the interview (thank-you note, send documents, deadlines).'),
      sec('Overview', 'Concise overview of the interview and its tone.'),
      sec('Questions and responses', 'Each question I was asked and the answer I gave.'),
      sec('Areas to improve', 'Answers that were weak or missing and how I could improve them.'),
      sec('Role details', 'What was said about the role, team, process and next steps.'),
    ],
  },
  {
    id: 'lecture', name: 'Lecture',
    chatPrompt: "I am a student listening to a lecture. Help me understand what's happening in the lecture.",
    summarySections: [
      sec('Follow-up work', 'Homework, readings and deadlines mentioned.'),
      sec('Topic', 'The topic of the lecture and how it fits in the course.'),
      sec('Key concepts', 'Key concepts, definitions and formulas introduced.'),
      sec('Content', 'Detailed notes of the lecture content in order.'),
    ],
  },
].map((m) => ({ ...m, builtin: true, files: [] }));

export const QUICK_ACTIONS = {
  assist: {
    label: 'Assister',
    prompt: 'Based on what\'s on my screen, give me the one thing that helps me most right now.',
    sessionPrompt: "I'm in the middle of the conversation and need a quick nudge: answer the latest question or point in the transcript, the way I could say it.",
  },
  say: { label: 'Que dire ?', prompt: 'What should I say next? Output only the words I should say, one or two natural sentences.' },
  followup: { label: 'Questions de suivi', prompt: 'Suggest two short follow-up questions I could ask. Output as two bullet points.' },
  recap: { label: 'Récap', prompt: 'Recap the most recent thing that happened in the conversation in one or two sentences.' },
};

export const LANGUAGES = [
  ['fr', 'Français'], ['en', 'English'], ['nl', 'Nederlands'], ['de', 'Deutsch'],
  ['it', 'Italiano'], ['es', 'Español'], ['pl', 'Polski'], ['pt', 'Português'],
];

export const DEFAULT_SHORTCUTS = {
  toggleVisibility: 'Ctrl+\\', ask: 'Ctrl+Enter', clear: 'Ctrl+R', toggleSession: 'Ctrl+Alt+\\', // Electron cannot register Ctrl+Shift+\ on Windows (Cluely's default)
  moveUp: 'Ctrl+Up', moveDown: 'Ctrl+Down', moveLeft: 'Ctrl+Left', moveRight: 'Ctrl+Right',
  scrollUp: 'Ctrl+Shift+Up', scrollDown: 'Ctrl+Shift+Down',
};

export const SHORTCUT_LABELS = {
  toggleVisibility: 'Afficher / masquer', ask: 'Demander / Assister', clear: 'Effacer et replier',
  toggleSession: 'Démarrer / arrêter la session', moveUp: 'Déplacer vers le haut', moveDown: 'Déplacer vers le bas',
  moveLeft: 'Déplacer vers la gauche', moveRight: 'Déplacer vers la droite',
  scrollUp: 'Défiler la réponse vers le haut', scrollDown: 'Défiler la réponse vers le bas',
};
