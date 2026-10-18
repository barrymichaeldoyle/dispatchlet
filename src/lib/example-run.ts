/** The Good News Today example, shared by the demo player, its poster and the step sections. */

/**
 * The run's timeline in milliseconds. The written answers and the posts are typed; everything
 * else arrives as whole lines. Research holds on the repeat it finds, because that is the point
 * of the product.
 */
export const TIMING = {
  /** The questions are answered in order; each one holds the focus ring while it is filled in. */
  QUESTION_STARTS: [300, 2000, 2600, 3400, 4700, 5500, 6100],
  TYPE_START: 400,
  TYPE_DURATION: 1400,
  CHANNEL_TICKS: [2150, 2350],
  AVOID_START: 2700,
  AVOID_DURATION: 600,
  SOURCE_START: 3500,
  SOURCE_INTERVAL: 280,
  DAILY: 4850,
  RUN_TIME: 5150,
  STORY_COUNT: 5750,
  POSTING: 6300,
  CURSOR_START: 6800,
  CURSOR_TRAVEL: 500,
  CLICK: 7300,
  /** The workspace opens out from the answers once they are submitted. */
  EXPAND: 7800,
  PLAYBOOK: 8200,
  RULE_START: 8400,
  RULE_INTERVAL: 600,
  READY: 10600,
  /** "Playbook created" only once the playbook is actually ready. */
  CREATED: 10600,
  RESEARCH: 11000,
  EVENT_STARTS: [11200, 12400, 13600],
  CANDIDATE_START: 14800,
  CANDIDATE_INTERVAL: 300,
  RESOLVE_START: 16200,
  RESOLVE_INTERVAL: 450,
  MATCH: 17550,
  MATCH_HOLD: 1300,
  POSTS: 20500,
  X_START: 20700,
  X_DURATION: 1400,
  LI_START: 22300,
  LI_DURATION: 1800,
  POSTS_READY: 24400,
  STORY_2: 25200,
  STORY_3: 25900,
  WRITING_SETTLED: 26200,
  BUFFER: 27000,
  SLOT_START: 27300,
  SLOT_INTERVAL: 700,
  RECEIPT: 29400,
  /** The run ends once the receipt has settled; the last frame holds, so nothing runs on after it. */
  DURATION: 30000,
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

/** The answers as the workspace shows them once they are submitted. */
export const ANSWER_SUMMARY = [
  ['Research', ANSWERS.topic],
  ['Avoid', ANSWERS.avoid],
  ['Runs', `Daily at ${ANSWERS.time}, up to ${ANSWERS.stories} stories`],
  ['Posting', 'Scheduled in Buffer'],
]

export const RULES = [
  [
    'Sources',
    'Positive News, Good News Network, BBC and The Guardian, plus other reliable outlets.',
  ],
  ['Voice', 'Warm and factual. Specific details, no hype.'],
  ['Rules', 'Verify the source. Skip company PR, politics and repeats.'],
  ['Delivery', 'Daily at 08:00. Posts from 09:00, 3 hours apart.'],
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
