/** The Good News Today example, shared by the demo player, its poster and the step sections. */

/**
 * The run's timeline in milliseconds. The brief and the posts are typed; everything else arrives
 * as whole lines. Research holds on the repeat it finds, because that is the point of the product.
 */
export const TIMING = {
  TYPE_START: 400,
  TYPE_DURATION: 3000,
  CURSOR_START: 3800,
  CURSOR_TRAVEL: 500,
  CLICK: 4300,
  /** The workspace opens out from the brief once it is submitted. */
  EXPAND: 4800,
  PLAYBOOK: 5200,
  RULE_START: 5400,
  RULE_INTERVAL: 600,
  READY: 7600,
  /** "Playbook created" only once the playbook is actually ready. */
  CREATED: 7600,
  RESEARCH: 8000,
  EVENT_STARTS: [8200, 9400, 10600],
  CANDIDATE_START: 11800,
  CANDIDATE_INTERVAL: 300,
  RESOLVE_START: 13200,
  RESOLVE_INTERVAL: 450,
  MATCH: 14550,
  MATCH_HOLD: 1300,
  POSTS: 17500,
  X_START: 17700,
  X_DURATION: 1400,
  LI_START: 19300,
  LI_DURATION: 1800,
  POSTS_READY: 21400,
  STORY_2: 22200,
  STORY_3: 22900,
  WRITING_SETTLED: 23200,
  BUFFER: 24000,
  SLOT_START: 24300,
  SLOT_INTERVAL: 700,
  RECEIPT: 26400,
  /** The run ends once the receipt has settled; the last frame holds, so nothing runs on after it. */
  DURATION: 27000,
} as const

export const RUN_SECONDS = TIMING.DURATION / 1000

/** When each research candidate settles: the three new stories first, then the repeat after its match, then the PR piece. */
export function resolveAt(index: number): number {
  const { RESOLVE_START, RESOLVE_INTERVAL, MATCH, MATCH_HOLD } = TIMING
  if (index < 3) return RESOLVE_START + index * RESOLVE_INTERVAL
  if (index === 3) return MATCH + MATCH_HOLD
  return MATCH + MATCH_HOLD + RESOLVE_INTERVAL
}

export const PROMPT =
  'Find three positive stories each morning about conservation and communities. Skip company PR and anything we’ve posted before. Write for X and LinkedIn, and schedule each story three hours apart.'

export const RULES = [
  ['Sources', 'Positive News, Good News Network, BBC and The Guardian.'],
  ['Voice', 'Warm and factual. Specific details, no hype.'],
  ['Rules', 'Verify the source. Skip company PR and stories already covered.'],
  ['Delivery', 'Research at 08:00. Post from 09:00, 3 hours apart.'],
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
