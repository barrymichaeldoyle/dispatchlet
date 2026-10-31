import { createFileRoute } from '@tanstack/react-router'
import { LegalPage, legalHead } from '../components/legal-page'

const BUFFER_COMMIT_URL = 'https://buffer.com/api/commit'
const BENCHMARK_URL =
  'https://github.com/barrymichaeldoyle/dispatchlet/blob/main/convex/benchmark.ts'

export const Route = createFileRoute('/blog_/cost-per-run')({
  component: CostPerRun,
  head: () =>
    legalHead(
      'How I tested cheaper AI models to lower my cost-per-run',
      'I tested Claude Haiku against Sonnet on 14 test accounts. Haiku now does the research and Sonnet writes the posts, and a run costs about $0.07.',
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
        A Dispatchlet run costs about $0.07 now, down from about $0.31 when I started. Most of that
        drop comes from a test I ran on 31 October. The test also showed that my first attempt at
        cutting the cost had made the posts worse.
      </p>
      <p>
        I built Dispatchlet for <a href={BUFFER_COMMIT_URL}>Buffer Commit</a>, Buffer’s hackathon
        for apps built on its API. Every run calls Claude to find stories and write posts, and every
        call costs money. Your free runs cost me, and if you add your own Anthropic key you pay it.
        A paid plan later would have to be priced around this number too, so I wanted it as low as I
        could get it without hurting the posts.
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
        costs about 20 times as much and writes better. Opus costs twice as much as Sonnet, and
        Fable, Anthropic’s most capable model, costs two and a half times as much as Opus. Opus and
        Fable are made for much harder problems than finding the news and writing a short post, and
        I don’t think they’d make those posts better by enough to justify the price.
      </p>
      <p>Dispatchlet uses Haiku for research and Sonnet for writing. Averaged over 42 test runs:</p>
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
              <td>$0.05</td>
            </tr>
            <tr>
              <td>Writing</td>
              <td>Sonnet</td>
              <td>$0.02</td>
            </tr>
            <tr>
              <td>
                <strong>Total</strong>
              </td>
              <td></td>
              <td>
                <strong>About $0.07</strong>
              </td>
            </tr>
            <tr>
              <td>Playbook (once)</td>
              <td>Sonnet</td>
              <td>$0.07</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Most of the $0.05 for research isn’t Haiku. Anthropic charges $0.01 for every web search,
        and research does about three per run. If I want runs to get cheaper, I need research to
        search less. A cheaper model wouldn’t save much now.
      </p>
      <p>
        The settings page in the app shows what your own runs cost. Every Claude call is logged with
        its price, so the numbers there are what you really spent.
      </p>

      <h2>Sonnet, then Haiku</h2>
      <p>I built Dispatchlet on Sonnet, and a run cost about $0.31.</p>
      <p>
        On 28 October I tried Haiku for everything. I ran ten test accounts, read what came out and
        couldn’t see a difference. It was a fifth of the price, so I switched.
      </p>
      <p>
        Reading a few posts was a quick check. A proper test would take hundreds of calls to Claude,
        so I planned it for the end of the month.
      </p>

      <h2>Spending $72 of expiring credits</h2>
      <p>
        My Claude Max plan comes with credits for Anthropic’s developer platform, and they reset at
        the end of each month. Whatever I haven’t used by then is gone, so 31 October was the best
        day to run a big test.
      </p>
      <p>
        It came to about $72, which is around 1,100 Dispatchlet runs. I wouldn’t have spent that
        much of my own money on one test.
      </p>

      <h2>How I tested it</h2>
      <p>
        I have 14 made-up accounts that I test with. Each one is set up the way a real person would
        answer Dispatchlet’s setup questions, and I picked topics that need different things. Five
        of them:
      </p>
      <ul>
        <li>Formula 1 news on X</li>
        <li>New openings in Bristol’s food scene on Threads and X</li>
        <li>A Kenyan wildlife charity on LinkedIn</li>
        <li>Cornish lighthouse preservation, where nothing happens most weeks</li>
        <li>UK personal finance rule changes, using gov.uk figures only</li>
      </ul>
      <p>The other nine include space missions, Rust libraries and a football fan account.</p>
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
        I wasn’t going to read hundreds of posts myself, so Opus did the judging. It got the
        playbook, the account’s rule and two results labelled A and B, without being told which
        model made which. It scored each one out of 5 and picked one, or called it a tie. AI judges
        tend to prefer whichever answer they read first, so I judged every pair twice with the order
        swapped, and a model only won if it won both times.
      </p>
      <p>
        When research picks a story, it writes down the facts it found, and the writer can only use
        those. So the judge could check every post against them and mark down anything made up.
      </p>
      <p>
        Each account ran three times, so a full round was 42 comparisons. The{' '}
        <a href={BENCHMARK_URL}>test code is on GitHub</a> if you want to see exactly how it works.
      </p>

      <h2>Results</h2>
      <p>
        Sonnet won research 23 to 17, with 2 ties, which is close enough to call even. Haiku
        actually scored a bit higher on getting facts right, and it cost a sixth as much.
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
        Writing is a small call: about $0.02 on Sonnet and $0.002 on Haiku. Research is where the
        money goes, and Haiku is fine at research. So I ran one more round with Haiku researching
        and Sonnet writing, against Sonnet doing both.
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
              <td>–</td>
            </tr>
            <tr>
              <td>Haiku does both</td>
              <td>$0.05</td>
              <td>Lost 10 to 23, 3&nbsp;ties</td>
            </tr>
            <tr>
              <td>Haiku researches, Sonnet writes</td>
              <td>$0.065</td>
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
          The judge is an AI too, and it’s a Claude model like the two it was judging, so it may
          favour Claude-style writing. It can’t open links, so it checked posts against the facts
          research wrote down, not the original articles.
        </li>
        <li>
          It’s small: 14 accounts, three times each, on one day. Three runs per account shows Sonnet
          writes better. It doesn’t show the split beats Sonnet doing both.
        </li>
        <li>
          I ran out of credits partway through the last round, so Haiku researching and Sonnet
          writing has 27 judged comparisons, not 42.
        </li>
        <li>
          I never tried Opus or Fable for writing. My view that they’d cost too much for what they
          add is a guess.
        </li>
      </ul>

      <h2>Next</h2>
      <p>
        Web searches are now most of what a run costs. Next I want to try cheaper models from
        outside Claude for the searching. That’s more than I can take on for my Buffer Commit
        submission, so it’ll come after.
      </p>
      <p>I’ll rerun this test when new models come out, or when I change the prompts.</p>
    </LegalPage>
  )
}
