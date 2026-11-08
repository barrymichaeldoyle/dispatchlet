import { createFileRoute } from '@tanstack/react-router'
import { LegalPage, legalHead } from '../components/legal-page'

const BUFFER_COMMIT_URL = 'https://buffer.com/api/commit'
const BENCHMARK_URL =
  'https://github.com/barrymichaeldoyle/dispatchlet/blob/main/convex/benchmark.ts'

export const Route = createFileRoute('/blog_/cost-per-run')({
  component: CostPerRun,
  head: () =>
    legalHead(
      'How I tested cheaper AI models to lower my cost per run',
      'I tested Claude Haiku against Sonnet on 14 test accounts, 3 times each, twice over. Haiku now does the research and Sonnet writes the posts, and a run costs about $0.07.',
      '/blog/cost-per-run',
    ),
})

function CostPerRun() {
  return (
    <LegalPage
      title="How I tested cheaper AI models to lower my cost per run"
      published="31 Oct 2026"
    >
      <p>
        A Dispatchlet run costs $0.065 now, down from about $0.31 when I started. Most of that drop
        came on 28 Oct, when I moved everything to the cheapest Claude model. A test on 31 Oct
        showed that switch had made the posts worse, and fixing it cost a cent and a half a run.
      </p>
      <p>
        Dispatchlet is an agent that searches the web on a schedule and drafts posts for your Buffer
        queue. Each scheduled check is a run. I built it for{' '}
        <a href={BUFFER_COMMIT_URL}>Buffer Commit</a>, Buffer’s hackathon for apps built on its API.
        Every run calls Claude to find stories and write posts, and every call costs money. I pay
        for your free runs. If you add your own key from Anthropic, the company that makes Claude,
        you pay for the calls. A paid plan later would have to be priced around this number too, so
        I wanted it as low as I could get it without hurting the posts.
      </p>

      <h2>The breakdown</h2>
      <p>
        A run has 2 steps. Research searches the web, opens pages and picks the stories worth
        posting. Writing turns them into a post for each channel. When research finds nothing, there
        is nothing to write and the run ends there. There is also a call when you create an
        automation, one topic on one schedule. It writes the playbook, the brief that tells research
        what to look for and how your posts should sound. You pay that once, or again if you ask for
        the playbook to be rewritten.
      </p>
      <p>
        Anthropic sells a few Claude models at different prices. Haiku is the cheap one. Sonnet’s
        token prices are 20 times Haiku’s, and in this test it wrote better posts. Opus costs twice
        as much as Sonnet, and Fable, Anthropic’s most capable model, costs two and a half times as
        much as Opus. Opus and Fable are made for much harder problems than finding the news and
        writing a short post, and I don’t think they’d make those posts better by enough to justify
        the price.
      </p>
      <p>Dispatchlet uses Haiku for research and Sonnet for writing. Measured over 32 test runs:</p>
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
              <td>About $0.05</td>
            </tr>
            <tr>
              <td>Writing</td>
              <td>Sonnet</td>
              <td>About $0.02</td>
            </tr>
            <tr>
              <td>
                <strong>Whole run</strong>
              </td>
              <td></td>
              <td>
                <strong>$0.065</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Writing the playbook is a one-off Sonnet call of about $0.07. It is not part of the per-run
        cost.
      </p>
      <p>
        Most of the research cost isn’t Haiku. Anthropic charges $0.01 for every web search, and
        research does about 3 per run. That $0.03 is half of what a run costs. If I want runs to get
        cheaper, I need searches to cost less. A cheaper model wouldn’t save much now.
      </p>
      <p>
        The settings page in the app shows what your own runs cost. Every Claude call is logged with
        its price, so the numbers there are what you really spent.
      </p>

      <h2>Sonnet, then Haiku</h2>
      <p>I built Dispatchlet on Sonnet, and a run cost about $0.31.</p>
      <p>
        On 28 Oct I tried Haiku for everything. I ran 10 test accounts, read what came out and
        couldn’t see a difference. A run cost $0.05, a sixth of the price, so I switched.
      </p>
      <p>
        Reading a few posts was a quick check. A proper test would take hundreds of calls to Claude,
        so I planned it for the end of the month.
      </p>

      <h2>Spending $72 of expiring credits</h2>
      <p>
        My Claude Max plan comes with credits for Anthropic’s developer platform, the same API
        Dispatchlet calls. They reset at the end of each month, and whatever I haven’t used by then
        is gone, so 31 Oct was the best day to run a big test.
      </p>
      <p>
        It came to about $72, which is around 1,100 Dispatchlet runs at $0.065. I wouldn’t have paid
        that for one test.
      </p>

      <h2>How I tested it</h2>
      <p>
        I have 14 made-up accounts that I test with. Each one is set up the way a real person would
        answer Dispatchlet’s setup questions, and I picked topics that need different things. 5 of
        them:
      </p>
      <ul>
        <li>Formula 1 news on X</li>
        <li>New openings in Bristol’s food scene on Threads and X</li>
        <li>A Kenyan wildlife charity on LinkedIn</li>
        <li>Cornish lighthouse preservation, where nothing happens most weeks</li>
        <li>UK personal finance rule changes, using gov.uk figures only</li>
      </ul>
      <p>The other 9 include space missions, Rust libraries and a football fan account.</p>
      <p>
        Each account also has a rule it can’t break. The finance account has to quote gov.uk’s
        numbers exactly and can’t call a proposal a new rule. The lighthouse account should usually
        post nothing, because nothing has happened, and it shouldn’t dig up old news to fill the
        gap.
      </p>
      <p>
        News changes during the day, so both models researched at the same moment from the same
        playbook. Then the posts were written 3 ways: Haiku writing up Haiku’s stories, Sonnet
        writing up Sonnet’s stories, and Sonnet writing up Haiku’s stories. Comparing the first and
        third tests the writing on its own, because both models are working from the same stories.
      </p>
      <p>
        I wasn’t going to read hundreds of posts myself, so Opus did the judging. It got the
        playbook, the account’s rule and two results labelled A and B, without being told which
        model made which. It scored each one out of 5 on relevance, accuracy, craft and the
        account’s own rule, then picked one or called it a tie. It can’t open links, so for research
        it checked that stories were dated inside the window and came from sources the playbook
        allows, and for posts it checked every claim against the facts research wrote down.
      </p>
      <p>
        AI judges tend to prefer whichever answer they read first, so I judged every pair twice with
        the order swapped. A model only won if it won both times. When the two orders disagreed, I
        counted a tie, and almost every tie below is one of those.
      </p>
      <p>
        Each account ran 3 times, which makes a round of 42, and I ran the round twice, so 84
        comparisons of each kind at most. The <a href={BENCHMARK_URL}>test code is on GitHub</a> if
        you want to see exactly how it works.
      </p>

      <h2>Results</h2>
      <p>
        Research was even. Over the 84 comparisons Haiku won 41, Sonnet won 36, and 7 were ties. The
        two rounds disagreed: Haiku won the first 24 to 13 and Sonnet won the second 23 to 17, which
        is a good reason not to read much into a margin that size. Haiku scored slightly higher on
        the judge’s date and source checks, and its research cost about $0.05 against about $0.29 on
        Sonnet, a sixth as much.
      </p>
      <p>
        Writing wasn’t close. Writing was only judged when Haiku had found stories to write up,
        which was 70 of the 84 runs. On those same stories, Sonnet won 39, Haiku won 14, and 17 were
        ties.
      </p>
      <p>
        For a new cafe in Bristol, the facts mentioned non-alcoholic drinks and said nothing about
        beer or wine. Haiku wrote:
      </p>
      <blockquote>
        Gigi’s Pizzas runs the kitchen for a six-month residency, and there are non-alcoholic drinks
        as well as beer and wine.
      </blockquote>
      <p>
        Haiku guessed. Dispatchlet is only supposed to say what the source says. Sonnet left the
        drinks out rather than guess:
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
      <p>Across all 70 writing comparisons, though, Sonnet wrote better posts.</p>
      <p>
        Put together, a full Haiku run lost to a full Sonnet run 39 to 26, with 8 ties, over the 73
        runs where at least one of them found something. In the other 11, neither model found
        anything new to post. Those were the quiet accounts, and an empty run was what I expected
        from them. So switching everything to Haiku on 28 Oct did make the posts worse. I just
        couldn’t tell by reading them.
      </p>

      <h2>Haiku for research, Sonnet for writing</h2>
      <p>
        Writing is a small call: about $0.02 on Sonnet and $0.002 on Haiku. Research is where the
        money goes, and Haiku is fine at research. The first two rounds had Sonnet writing Haiku’s
        stories, but only judged against Haiku’s own writing, never against a full Sonnet run. So I
        ran a third round with Haiku researching and Sonnet writing, against Sonnet doing both.
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
              <td>$0.31</td>
              <td>Baseline</td>
            </tr>
            <tr>
              <td>Haiku does both</td>
              <td>$0.05</td>
              <td>Lost 26 to 39, 8&nbsp;ties</td>
            </tr>
            <tr>
              <td>Haiku researches, Sonnet writes</td>
              <td>$0.065</td>
              <td>13 to 12, 2&nbsp;ties</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        13 to 12 over 27 comparisons is a draw, at a fifth of the price. It doesn’t show the split
        is as good as Sonnet doing both. It does show it isn’t clearly worse, and it is clearly
        better than Haiku doing both. Dispatchlet runs this way now.
      </p>

      <h2>What the test doesn’t show</h2>
      <ul>
        <li>
          The judge is an AI too, and it’s from the same family as the two it was judging, so it may
          share Sonnet’s taste in phrasing. It can’t open links, so it checked posts against the
          facts research wrote down, not the original articles, and it never checked whether those
          facts were true.
        </li>
        <li>
          Most ties are the judge disagreeing with itself when the order was swapped, not the judge
          calling two results equal.
        </li>
        <li>
          It’s small: 14 accounts, 3 times each, twice over, on one day. That is enough to show
          Sonnet writes better. It isn’t enough to rank the two at research, or to show the split
          beats Sonnet doing both.
        </li>
        <li>
          I ran out of credits partway through the third round, so 32 of its 42 runs finished. 5 of
          those found nothing on either side, which leaves the 27 judged comparisons above.
        </li>
        <li>
          I never tried Opus or Fable for writing. My view that they’d cost too much for what they
          add is a guess.
        </li>
      </ul>

      <h2>Next</h2>
      <p>
        Web searches are now half of what a run costs. Next I want to try search tools and models
        from outside Claude that charge less than $0.01 a search. That’s more than I can take on for
        my Buffer Commit submission, so it’ll come after.
      </p>
      <p>I’ll rerun this test when new models come out, or when I change the prompts.</p>
    </LegalPage>
  )
}
