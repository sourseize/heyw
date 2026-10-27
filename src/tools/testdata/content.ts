/**
 * Fixed vocabulary for the generator. Plain, plausible personal-work content —
 * no lorem ipsum — so the UI reads naturally during manual testing.
 */

export interface ProjectSpec {
  name: string;
  color: string;
  description: string;
  tasks: string[];
  archived?: boolean;
}

export const PROJECTS: ProjectSpec[] = [
  {
    name: 'HeyWork',
    color: '#2e7d32',
    description: 'The calm work OS itself',
    tasks: [
      'Ship the thought inbox', 'Fix timer drift after sleep', 'Write the Book of Work renderer', 'Add keyboard shortcut help',
      'Tidy the board column spacing', 'Profile the JSON persist path', 'Draft release notes', 'Review backup retention defaults',
      'Add dark-mode contrast pass', 'Investigate pop-out on Firefox', 'Rename export button', 'Write migration guide for v2 store',
      'Test restore from a corrupt file', 'Reduce heartbeat chatter', 'Polish empty states', 'Spike: encrypted store codec',
    ],
  },
  {
    name: 'Writing',
    color: '#7c3aed',
    description: 'Essays and the newsletter',
    tasks: [
      'Outline the deep-work essay', 'Draft chapter 3', 'Edit the March newsletter', 'Collect reader replies',
      'Rewrite the intro paragraph', 'Research attention studies', 'Schedule the April issue', 'Proofread the guest post',
      'Pick cover image', 'Write 500 words on rituals', 'Answer the interview questions', 'Update the about page',
    ],
  },
  {
    name: 'Home',
    color: '#d97706',
    description: 'Life admin',
    tasks: [
      'Renew passport', 'Book dentist', 'Fix the kitchen tap', 'Sort tax receipts', 'Plan the weekend hike',
      'Replace bike brake pads', 'Call the insurer', 'Declutter the study', 'Order new desk lamp', 'Back up the photo library',
    ],
  },
  {
    name: 'Learning',
    color: '#2563eb',
    description: 'Courses and practice',
    tasks: [
      'Finish TypeScript generics module', 'Practice piano scales', 'Read two chapters of SICP', 'Do the Rust ownership exercises',
      'Watch the distributed systems lecture', 'Write up notes on CRDTs', 'Solve three katas', 'Review flashcards',
    ],
  },
  {
    name: 'Old Freelance',
    color: '#64748b',
    description: 'Closed engagements (archived)',
    tasks: [],
    archived: true,
  },
];

export const UNASSIGNED_TASKS = ['Clear the inbox to zero', 'Think about Q2 priorities', 'Reply to Sam', 'Water the plants'];

export const TAGS = ['deep', 'quick', 'admin', 'creative', 'review', 'bug', 'idea', 'health'];

export const THOUGHTS = [
  'Check whether the retry logic double-charges on timeout',
  'Ask design about the empty state copy',
  'Could the export be streamed instead of buffered?',
  'Book the dentist before the end of the month',
  'Rename "Rest" to "Long break"? Maybe not',
  'Idea: weekly review template in the journal',
  'Is the streak logic right across time zones?',
  'Reply to the conference CFP',
  'Try 50-minute blocks for writing',
  'Buy a new notebook',
  'Move the standup to 10:00',
  'Read the paper on attention residue',
  'Should thoughts expire after 30 days?',
  'Add a keyboard hint to the capture bar',
  'Call mum on Sunday',
  'Write down the pricing idea before it goes',
  'The chart needs a zero state',
  'Check if the backups dir is in .gitignore',
  'Look into a CLI for quick capture',
  'Refactor the date helpers into one module',
  'Tidy the desk cables',
  'What would a "strict focus" mode look like?',
  'Ask about the invoice from February',
  'Compare estimate vs actual per project',
  'Draft the talk abstract',
  'Pause notifications during focus — OS level?',
  'Try the brown noise at lower volume',
  'Batch email to twice a day',
  'Find a better word than "tinkering"',
  'Plan a no-meeting Wednesday',
  'Check the CSS for the mini timer on small screens',
  'Note: the flaky test was a timezone issue',
];

export const INTENTIONS = [
  'Ship one meaningful thing', 'Protect the morning for deep work', 'Close the loop on open threads',
  'Write before reading', 'Two focus blocks before lunch', 'Leave the desk by six', 'Finish what I started yesterday',
  'Say no to one thing', 'Review the board before starting', 'Move the hardest task first', 'Keep the inbox at zero',
  'Walk at lunch', 'Clear blockers for tomorrow', 'One hour on the essay', 'Plan the week on paper',
];

export const RETROS = [
  'Good, deep morning. The afternoon drifted into email but the main thing shipped.',
  'Kept switching tasks. Tomorrow: one block, one task, no tabs.',
  'Slow start, strong finish. The 50-minute block worked better than two 25s.',
  'Too many meetings; salvaged one focus block at the end of the day.',
  'Calm day. Parked five thoughts instead of chasing them — that helped.',
  'Spent longer than estimated on the bug, but it is genuinely fixed now.',
  'Low energy. Did admin instead of forcing deep work. Fine.',
  'Best writing session in weeks. Brown noise and a closed door.',
  'Lost the thread after lunch. Should have taken the long break.',
  'Finished the chapter draft. Rough, but it exists.',
  'Steady. Nothing dramatic, which is the point.',
  'Got pulled into a rabbit hole on tooling. Worth it? Unclear.',
  'Three blocks, three completions. Rare and nice.',
  '',
  'Interrupted constantly. Moving the desk away from the door.',
  'Felt scattered until I wrote the intentions down. Then it clicked.',
];

export const NOTES: { title: string; content: string; tags: string[]; pinned?: boolean }[] = [
  { title: 'Weekly review checklist', content: '# Weekly review\n\n- Clear the thought inbox\n- Move done tasks off the board\n- Read last week\'s retros\n- Pick three intentions for next week', tags: ['review'], pinned: true },
  { title: 'Focus rituals', content: 'What works:\n\n1. Headphones on, brown noise.\n2. One task selected before starting the block.\n3. Park thoughts, do not chase them.\n4. Long break after three blocks.', tags: ['deep'], pinned: true },
  { title: 'Meeting notes — roadmap', content: 'Q2: thought inbox, book of work, encryption at rest later. Keep zero runtime deps.', tags: ['admin'] },
  { title: 'Essay ideas', content: '- Attention residue and task switching\n- Why calm software\n- The cost of a dashboard', tags: ['creative', 'idea'] },
  { title: 'Rust ownership cheatsheet', content: 'Move by default. Borrow with &. One mutable borrow at a time.', tags: ['quick'] },
  { title: 'Bike maintenance log', content: '2025-02-10 new chain\n2025-03-02 brake pads ordered', tags: ['admin'] },
  { title: 'Reading list', content: '- Deep Work\n- The Shallows\n- Four Thousand Weeks\n- Structure and Interpretation of Computer Programs', tags: ['idea'] },
  { title: 'Interview prep', content: 'Questions to ask: team rituals, on-call, how decisions get made.', tags: ['admin'] },
  { title: 'Newsletter template', content: '## This month\n\n## One idea\n\n## Links', tags: ['creative'] },
  { title: 'Scratch', content: 'temp: check the heartbeat interval on battery', tags: [] },
  { title: 'Piano practice plan', content: 'Scales 10 min, sight reading 10 min, piece 20 min.', tags: ['health'] },
  { title: 'Tax receipts 2024', content: 'Folder: ~/Documents/tax/2024 — still missing the March invoice.', tags: ['admin'] },
];

export const SESSION_NOTES = ['', '', '', 'Flow state', 'Kept getting pinged', 'Solid block', 'Mostly reading', 'Paired with Sam', 'Writing by hand first'];
