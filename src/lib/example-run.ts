/** The Good News Today example, shared by the demo player, its poster and the step sections. */

export const RUN_SECONDS = 38

export const PROMPT =
  'Find three positive stories each morning about conservation and communities. Skip company PR and anything we’ve posted before. Write for X and LinkedIn, and schedule each story three hours apart.'

export const RULES = [
  ['Sources', 'Positive News, Good News Network, BBC and The Guardian.'],
  ['Voice', 'Warm and factual. Specific details, no hype.'],
  ['Rules', 'Verify the source. Skip company PR and stories already covered.'],
  ['Delivery', '3 stories each morning · X + LinkedIn · Spread 3 hours apart'],
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
  ...STORIES.map(({ title }) => [title, 'Fresh · selected']),
  ['The urban garden story', 'Already posted · skipped'],
  ['A company’s new product launch', 'Company PR · skipped'],
]

export const PREVIOUS_POST =
  'A neighbourhood garden is turning an unused plot into a place for neighbours to grow food together.'
