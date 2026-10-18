/** The Good News Today example, shared by the demo player, its poster and the step sections. */

/**
 * The run's timeline in milliseconds. The written answers and the posts are typed; everything
 * else arrives as whole lines. Research holds on the repeat it finds, because that is the point
 * of the product.
 */
export const TIMING = {
  /**
   * One question at a time, slow enough to read: each answer goes in, holds for a moment, then
   * lands in the summary just before the next question. Kept brisk so the posts arrive about
   * half a minute in; the question about repeats and slow news days holds longest.
   */
  QUESTION_STARTS: [300, 2900, 4600, 6700, 9300, 11200, 13300],
  ANSWERED: [2700, 4400, 6500, 9100, 11000, 13100, 14700],
  TYPE_START: 700,
  TYPE_DURATION: 1500,
  CHANNEL_TICKS: [3500, 3800],
  AVOID_START: 5100,
  AVOID_DURATION: 900,
  SOURCE_START: 7200,
  SOURCE_INTERVAL: 350,
  DAILY: 9900,
  RUN_TIME: 10400,
  STORY_COUNT: 12300,
  POSTING: 14100,
  /** Every question is answered; the cursor goes to the button. */
  DONE: 14900,
  CURSOR_START: 15700,
  CURSOR_TRAVEL: 500,
  CLICK: 16200,
  /** The workspace opens out from the answers once they are submitted. */
  EXPAND: 16800,
  PLAYBOOK: 17300,
  RULE_START: 17600,
  RULE_INTERVAL: 750,
  READY: 20300,
  /** "Playbook created" only once the playbook is actually ready. */
  CREATED: 20300,
  RESEARCH: 20800,
  EVENT_STARTS: [21100, 22600, 24100],
  CANDIDATE_START: 25600,
  CANDIDATE_INTERVAL: 400,
  RESOLVE_START: 27300,
  RESOLVE_INTERVAL: 550,
  MATCH: 29000,
  MATCH_HOLD: 1600,
  POSTS: 32700,
  X_START: 32950,
  X_DURATION: 1750,
  LI_START: 34950,
  LI_DURATION: 2250,
  POSTS_READY: 37600,
  STORY_2: 38600,
  STORY_3: 39450,
  WRITING_SETTLED: 39800,
  BUFFER: 40800,
  SLOT_START: 41200,
  SLOT_INTERVAL: 900,
  RECEIPT: 43800,
  /** The next morning: it runs again without anyone touching it, and skips what it posted. */
  NEXT_DAY: 45900,
  NEXT_ROW_START: 47100,
  NEXT_ROW_INTERVAL: 800,
  NEXT_RECEIPT: 50500,
  NEXT_CLOSING: 51900,
  /** The run ends once the closing line has settled; the last frame holds. */
  DURATION: 55000,
} as const

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
  /** Every text channel Dispatchlet supports, offered in the setup; this account picks two. */
  allChannels: ['X', 'LinkedIn', 'Threads', 'Bluesky', 'Mastodon'],
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

export const RULES = [
  ['Sources', 'Your 4 sites, plus other reliable outlets.'],
  ['Voice', 'Warm and factual, no hype.'],
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
        'Wildlife is making a comeback after a decade of habitat restoration. Patient conservation pays off. bbc.co.uk/news/…',
      ],
      [
        'LinkedIn',
        'A decade of local conservation work is helping wildlife recover. A reminder that long-term investment in restoring habitats can make a difference. bbc.co.uk/news/…',
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
        'A repair café keeps everyday things in use and brings neighbours together. Less waste, more connection. positive.news/…',
      ],
      [
        'LinkedIn',
        'A neighbourhood repair café turns everyday repairs into community connections. Volunteers share their skills, keeping useful things out of landfill. positive.news/…',
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
        'Community solar that pays back locally: its proceeds fund neighbourhood projects. theguardian.com/…',
      ],
      [
        'LinkedIn',
        'Community-owned solar can do more than generate power. This project reinvests its proceeds in the neighbourhood’s own priorities. theguardian.com/…',
      ],
    ],
  },
]
export const CANDIDATES = [
  ...STORIES.map(({ title, source }) => [title, 'New, selected', source]),
  ['The urban garden story', 'Already posted, skipped', 'Good News Network'],
  ['A company’s new product launch', 'Company PR, skipped', 'Press release'],
]

/**
 * The second run, the next morning. Two stories are new; two are yesterday's stories reported by
 * other outlets, so they are skipped. With only two worth posting, it schedules fewer.
 */
export const NEXT_DAY = [
  ['Bees return to a city park', 'New, goes out at 09:00', 'BBC'],
  ['A library lends tools to its town', 'New, goes out at 12:00', 'Positive News'],
  ['Wildlife makes a comeback', 'Already posted, skipped', 'The Guardian'],
  ['A repair café brings neighbours together', 'Already posted, skipped', 'Good News Network'],
]

export const PREVIOUS_POST =
  'A neighbourhood garden is turning an unused plot into a place for neighbours to grow food together.'
