import { createFileRoute } from '@tanstack/react-router'
import { LegalPage, legalHead } from '../components/legal-page'

const BENCHMARK_URL =
  'https://github.com/barrymichaeldoyle/dispatchlet/blob/main/convex/benchmark.ts'

export const Route = createFileRoute('/blog_/cost-per-run')({
  component: CostPerRun,
  head: () =>
    legalHead(
      'How I tested cheaper AI models to lower my cost-per-run',
      'I tested Claude Haiku against Sonnet on 14 test accounts. Haiku now does the research and Sonnet writes the posts, and a run costs about 7 cents.',
      '/blog/cost-per-run',
    ),
})

function CostPerRun() {
  return (
    <LegalPage
      title="How I tested cheaper AI models to lower my cost-per-run"
      published="31 Oct 2026"
    >
      <p>
        Dispatchlet uses Claude to find stories and write posts, and Claude isn’t free. I pay for
        your first 10 runs. After that you add your own Anthropic API key and Anthropic bills you
        directly, so the cost of a run is something you actually pay.
      </p>
      <p>
        Right now that’s about 7 cents. When I first got Dispatchlet working, it was closer to 32.
      </p>

      <h2>The breakdown</h2>
      <p>
        A run makes two calls to Claude. The first does the research: it searches the web, opens
        pages and picks the stories worth posting. The second writes the posts. There’s also a call
        when you create an automation, which writes its playbook, the brief that tells research what
        to look for and how your posts should sound. That one only happens once.
      </p>
      <p>
        Anthropic sells a few Claude models at different prices. Haiku is the cheap one. Sonnet
        costs about 20 times as much and writes better. Dispatchlet uses Haiku for research and
        Sonnet for writing. Averaged over 42 test runs:
      </p>
      <div className="legal-table">
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Model</th>
              <th>Cost per&nbsp;run</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Research</td>
              <td>Haiku</td>
              <td>5&nbsp;cents</td>
            </tr>
            <tr>
              <td>Writing</td>
              <td>Sonnet</td>
              <td>1.5–2&nbsp;cents</td>
            </tr>
            <tr>
              <td>
                <strong>Total</strong>
              </td>
              <td></td>
              <td>
                <strong>About 7&nbsp;cents</strong>
              </td>
            </tr>
            <tr>
              <td>Playbook (once)</td>
              <td>Sonnet</td>
              <td>7&nbsp;cents</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Most of the 5 cents for research isn’t Haiku. Anthropic charges a cent for every web search,
        and research does about three per run. If I want runs to get cheaper, I need research to
        search less. A cheaper model wouldn’t save much now.
      </p>
      <p>
        The settings page in the app shows what your own runs cost. Every Claude call is logged with
        its price, so the numbers there are what you really spent.
      </p>

      <h2>Sonnet, then Haiku</h2>
      <p>I built Dispatchlet on Sonnet, and a run cost about 31 cents.</p>
      <p>
        On 28 October I tried Haiku for everything. I ran ten test accounts, read what came out and
        couldn’t see a difference. It was a fifth of the price, so I switched.
      </p>
      <p>
        Reading a few posts and deciding they look fine isn’t really testing, though. I knew that,
        and I didn’t do anything about it until the end of the month.
      </p>

      <h2>Spending $72 of expiring credits</h2>
      <p>
        My Claude Max plan comes with credits for Anthropic’s developer platform, and they expire at
        the end of each month. On 31 October I still had a lot left, and they were going to
        disappear the next day.
      </p>
      <p>
        I’d rather they went on something useful, so I spent about $72 testing which model should do
        which job. That’s around 1,100 Dispatchlet runs. I wouldn’t have spent that much of my own
        money on one test.
      </p>

      <h2>How I tested it</h2>
      <p>
        I have 14 made-up accounts that I test with. Each one is set up the way a real person would
        answer Dispatchlet’s setup questions, and I picked topics that need different things:
      </p>
      <ul>
        <li>Formula 1 news on X</li>
        <li>Good news stories on X and LinkedIn</li>
        <li>A weekly programming and security roundup on Bluesky and Mastodon</li>
        <li>New openings in Bristol’s food scene on Threads and X</li>
        <li>Releases from a few Rust libraries, using only their own websites</li>
        <li>A Sheffield Wednesday fan account</li>
        <li>A Kenyan wildlife charity on LinkedIn</li>
        <li>E-ink gadgets and games</li>
        <li>Industry news for a business software company</li>
        <li>Cornish lighthouse preservation, where nothing happens most weeks</li>
        <li>Other people’s projects in Buffer Commit, the hackathon I built Dispatchlet for</li>
        <li>Space missions on Bluesky</li>
        <li>UK personal finance rule changes, using gov.uk figures only</li>
        <li>New AI models you can download and run yourself</li>
      </ul>
      <p>
        Each account also has a rule it can’t break. The finance account has to quote gov.uk’s
        numbers exactly and can’t call a proposal a new rule. The lighthouse account should usually
        post nothing, because nothing has happened, and it shouldn’t dig up old news to fill the
        gap.
      </p>
      <p>
        News changes during the day, so both models researched at the same moment from the same
        playbook. Then the posts were written three ways: Haiku writing up Haiku’s stories, Sonnet
        writing up Sonnet’s stories, and Sonnet writing up Haiku’s stories. That last one compares
        the writing on its own, because both models are working from the same stories.
      </p>
      <p>
        I wasn’t going to read hundreds of posts myself, so Opus, Anthropic’s most capable model,
        did the judging. It got the playbook, the account’s rule and two results labelled A and B,
        without being told which model made which. It scored each one out of 5 and picked one, or
        called it a tie.
      </p>
      <p>
        AI judges tend to prefer whichever answer they read first, so every pair was judged twice
        with the order swapped. A model only won if it won both times.
      </p>
      <p>
        When research picks a story, it writes down the facts it found, and the writer can only use
        those. So the judge could check every post against them and mark down anything made up.
      </p>
      <p>
        Each account ran three times, so a round was 42 comparisons. The{' '}
        <a href={BENCHMARK_URL}>test code is on GitHub</a> if you want to see exactly how it works.
      </p>

      <h2>Results</h2>
      <p>
        Research was close. Sonnet won 23 comparisons, Haiku won 17, and 2 were ties. Haiku actually
        scored a bit higher on getting facts right, and it cost a sixth as much.
      </p>
      <p>
        Writing wasn’t close. Writing up the same stories, Sonnet won 18, Haiku won 6, and 10 were
        ties.
      </p>
      <p>
        For a new cafe in Bristol, the facts said it served non-alcoholic drinks as an alternative
        to alcohol. Haiku wrote:
      </p>
      <blockquote>
        Gigi’s Pizzas runs the kitchen for a six-month residency, and there are non-alcoholic drinks
        as well as beer and wine.
      </blockquote>
      <p>
        Nothing said beer and wine. Haiku guessed. Dispatchlet is only supposed to say what the
        source says, and Sonnet did:
      </p>
      <blockquote>
        By day it’s a speciality coffee shop and second-hand record shop with Disk Frisk, and in the
        evenings a bar with music and kitchen pop-ups. Gigi’s Pizzas runs the kitchen for six
        months, Bristol Express reports.
      </blockquote>
      <p>
        Haiku won some too. NASA said more measurements would help confirm a result. Haiku kept
        that:
      </p>
      <blockquote>NASA says more measurements will help confirm it.</blockquote>
      <p>Sonnet made it sound more certain than NASA did:</p>
      <blockquote>Future measurements should confirm it.</blockquote>
      <p>Over all 34 writing comparisons, though, Sonnet wrote better posts.</p>
      <p>
        Put together, a full Haiku run lost to a full Sonnet run 23 to 10, with 3 ties. So switching
        everything to Haiku on the 28th did make the posts worse. I just couldn’t tell by reading
        them. In 6 of the 42 tests neither model found anything new to post, which was right for the
        quiet accounts.
      </p>

      <h2>Haiku for research, Sonnet for writing</h2>
      <p>
        Writing is a small call: about 2 cents on Sonnet and a fifth of a cent on Haiku. Research is
        where the money goes, and Haiku is fine at research. So I ran one more round with Haiku
        researching and Sonnet writing, against Sonnet doing both.
      </p>
      <div className="legal-table">
        <table>
          <thead>
            <tr>
              <th>Setup</th>
              <th>Cost per&nbsp;run</th>
              <th>Against Sonnet doing both</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sonnet does both</td>
              <td>31&nbsp;cents</td>
              <td>–</td>
            </tr>
            <tr>
              <td>Haiku does both</td>
              <td>5&nbsp;cents</td>
              <td>Lost 10 to 23, 3&nbsp;ties</td>
            </tr>
            <tr>
              <td>Haiku researches, Sonnet writes</td>
              <td>6.5&nbsp;cents</td>
              <td>
                <strong>Won 13 to 12, 2&nbsp;ties</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>13 to 12 is a draw, at a fifth of the price. Dispatchlet runs this way now.</p>

      <h2>What the test doesn’t show</h2>
      <ul>
        <li>
          The judge is an AI too. It can’t open links, so it checked posts against the facts
          research wrote down, not the original articles.
        </li>
        <li>
          It’s small: 14 accounts, three times each, on one day. That’s enough to show Sonnet writes
          better. It’s not enough to say the split setup beats Sonnet doing both.
        </li>
        <li>
          Each round saw different news, so the rounds can’t be compared with each other story by
          story.
        </li>
      </ul>

      <h2>Next</h2>
      <p>
        I’ll rerun this when Anthropic ships new models or when I change the prompts. Web searches
        are now most of what a run costs, so next I want to see if research can find the same
        stories with fewer of them.
      </p>
    </LegalPage>
  )
}
