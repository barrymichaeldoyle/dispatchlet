/** The Good News Today example, shared by the demo player, its poster and the step sections. */

/**
 * The run's timeline in milliseconds. The written answers and the posts are typed; everything
 * else arrives as whole lines. Research holds on the repeat it finds, because that is the point
 * of the product.
 */
export const TIMING = {
  /**
   * One question at a time, slow enough to read: each answer goes in, holds for a moment, then
   * lands in the summary just before the next question.
   */
  QUESTION_STARTS: [300, 3800, 6100, 8900, 12400, 15000, 17800],
  ANSWERED: [3600, 5900, 8700, 12200, 14800, 17600, 19800],
  TYPE_START: 900,
  TYPE_DURATION: 1800,
  CHANNEL_TICKS: [4600, 5000],
  AVOID_START: 6900,
  AVOID_DURATION: 1000,
  SOURCE_START: 9700,
  SOURCE_INTERVAL: 400,
  DAILY: 13300,
  RUN_TIME: 13900,
  STORY_COUNT: 16000,
  POSTING: 18800,
  /** Every question is answered; the cursor goes to the button. */
  DONE: 20000,
  CURSOR_START: 20800,
  CURSOR_TRAVEL: 500,
  CLICK: 21300,
  /** The workspace opens out from the answers once they are submitted. */
  EXPAND: 21900,
  PLAYBOOK: 22400,
  RULE_START: 22700,
  RULE_INTERVAL: 750,
  READY: 25400,
  /** "Playbook created" only once the playbook is actually ready. */
  CREATED: 25400,
  RESEARCH: 25900,
  EVENT_STARTS: [26200, 27700, 29200],
  CANDIDATE_START: 30700,
  CANDIDATE_INTERVAL: 400,
  RESOLVE_START: 32400,
  RESOLVE_INTERVAL: 550,
  MATCH: 34100,
  MATCH_HOLD: 1600,
  POSTS: 37800,
  X_START: 38050,
  X_DURATION: 1750,
  LI_START: 40050,
  LI_DURATION: 2250,
  POSTS_READY: 42700,
  STORY_2: 43700,
  STORY_3: 44550,
  WRITING_SETTLED: 44900,
  BUFFER: 45900,
  SLOT_START: 46300,
  SLOT_INTERVAL: 900,
  RECEIPT: 48900,
  /** The run ends once the receipt has settled; the last frame holds, so nothing runs on after it. */
  DURATION: 50000,
} as const

export const RUN_SECONDS = TIMING.DURATION / 1000

/** When each research candidate settles: the three new stories first, then the repeat after its match, then the PR piece. */
export function resolveAt(index: number): number {
  const { RESOLVE_START, RESOLVE_INTERVAL, MATCH, MATCH_HOLD } = TIMING
  if (index < 3) return RESOLVE_START + index * RESOLVE_INTERVAL
  if (index === 3) return MATCH + MATCH_HOLD
  return MATCH + MATCH_HOLD + RESOLVE_INTERVAL
}

/** The setup questions, answered for Good News Today. */
export const ANSWERS = {
  topic: 'Positive stories about conservation and communities',
  channels: ['X', 'LinkedIn'],
  avoid: 'Company PR and politics',
  sources: ['positive.news', 'goodnewsnetwork.org', 'bbc.co.uk', 'theguardian.com'],
  time: '08:00',
  stories: 3,
} as const

/** The answers as they build up beside the questions, one row per question. */
export const ANSWER_ROWS = [
  ['Research', ANSWERS.topic],
  ['Channels', 'X and LinkedIn'],
  ['Avoid', ANSWERS.avoid],
  ['Sources', '4 sites, others allowed'],
  ['Runs', `Daily at ${ANSWERS.time}`],
  ['Stories', `Up to ${ANSWERS.stories} a day`],
  ['Posting', 'Scheduled in Buffer'],
]

/** The same answers, shorter, once the workspace opens out and they share a column. */
export const ANSWER_SUMMARY = [
  ['Research', ANSWERS.topic],
  ['Avoid', ANSWERS.avoid],
  ['Runs', `Daily at ${ANSWERS.time}, up to ${ANSWERS.stories} stories`],
  ['Posting', 'Scheduled in Buffer'],
]

export const RULES = [
  ['Sources', 'Your 4 sites, plus other reliable outlets.'],
  ['Voice', 'Warm and factual. Specific details, no hype.'],
  ['Rules', 'Verify the source. Skip company PR, politics and repeats.'],
  ['Delivery', 'From 09:00, 3 hours apart.'],
]
export const STORIES = [
  {
    title: 'Wildlife makes a comeback',
    source: 'BBC',
    time: '09:00',
    posts: [
      [
        'X',
        'Wildlife is making a comeback after a decade of habitat restoration. Patient conservation pays off. [Source link]',
      ],
      [
        'LinkedIn',
        'A decade of local conservation work is helping wildlife recover. A reminder that long-term investment in restoring habitats can make a difference. [Source link]',
      ],
    ],
  },
  {
    title: 'A repair café brings neighbours together',
    source: 'Positive News',
    time: '12:00',
    posts: [
      [
        'X',
        'A community repair café keeps everyday things in use and brings neighbours together. Less waste, more connection. [Source link]',
      ],
      [
        'LinkedIn',
        'A neighbourhood repair café turns everyday repairs into community connections. Volunteers share their skills, keeping useful things out of landfill. [Source link]',
      ],
    ],
  },
  {
    title: 'Community solar funds local projects',
    source: 'The Guardian',
    time: '15:00',
    posts: [
      [
        'X',
        'A community solar project puts its proceeds back into neighbourhood projects. Clean energy, with a local return. [Source link]',
      ],
      [
        'LinkedIn',
        'Community-owned solar can do more than generate electricity. By reinvesting proceeds locally, this project helps fund the neighbourhood’s own priorities. [Source link]',
      ],
    ],
  },
]
export const CANDIDATES = [
  ...STORIES.map(({ title, source }) => [title, 'New, selected', source]),
  ['The urban garden story', 'Already posted, skipped', 'Good News Network'],
  ['A company’s new product launch', 'Company PR, skipped', 'Press release'],
]

export const PREVIOUS_POST =
  'A neighbourhood garden is turning an unused plot into a place for neighbours to grow food together.'
