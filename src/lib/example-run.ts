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
  READY: 8000,
  /** "Playbook created" only once the playbook is actually ready. */
  CREATED: 8000,
  RESEARCH: 8800,
  EVENT_STARTS: [9000, 10200, 11400],
  CANDIDATE_START: 12600,
  CANDIDATE_INTERVAL: 300,
  RESOLVE_START: 14000,
  RESOLVE_INTERVAL: 450,
  MATCH: 15350,
  MATCH_HOLD: 1300,
  POSTS: 18300,
  X_START: 18500,
  X_DURATION: 1400,
  LI_START: 20100,
  LI_DURATION: 1800,
  POSTS_READY: 22200,
  STORY_2: 23000,
  STORY_3: 23700,
  WRITING_SETTLED: 24000,
  BUFFER: 24800,
  SLOT_START: 25100,
  SLOT_INTERVAL: 700,
  RECEIPT: 27200,
  DURATION: 33000,
} as const

export const RUN_SECONDS = TIMING.DURATION / 1000

/** When each research candidate settles: the three fresh stories first, then the repeat after its match, then the PR piece. */
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
  ['Delivery', '3 stories each morning for X and LinkedIn, 3 hours apart.'],
]
export const STORIES = [
  {
    title: 'Wildlife makes a comeback',
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
  ...STORIES.map(({ title }) => [title, 'Fresh, selected']),
  ['The urban garden story', 'Already posted, skipped'],
  ['A company’s new product launch', 'Company PR, skipped'],
]

export const PREVIOUS_POST =
  'A neighbourhood garden is turning an unused plot into a place for neighbours to grow food together.'
