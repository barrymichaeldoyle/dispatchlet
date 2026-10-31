import { createFileRoute } from '@tanstack/react-router'
import { LegalPage, legalHead } from '../components/legal-page'

const BENCHMARK_URL =
  'https://github.com/barrymichaeldoyle/dispatchlet/blob/main/convex/benchmark.ts'

export const Route = createFileRoute('/blog_/cost-per-run')({
  component: CostPerRun,
  head: () =>
    legalHead(
      'How I tested cheaper AI models to lower my cost-per-run',
      'What each Dispatchlet run costs, how I brought it down from 32 cents to about 7, and the test I ran to make sure the posts did not get worse.',
      '/blog/cost-per-run',
    ),
})

function CostPerRun() {
  return (
    <LegalPage
      title="How I tested cheaper AI models to lower my cost-per-run"
      published="31 Oct 2026"
    >
      <p>A Dispatchlet run now costs about 7 cents. When I started building it, a run cost 32.</p>
      <p>
        That number matters to you as much as to me. Your first 10 runs are free. After that, you
        connect your own Anthropic account and pay for what your runs use. Anthropic makes Claude,
        the AI that finds your stories and writes your posts.
      </p>
      <p>
        Here’s where the money goes, and how I tested cheaper versions of Claude without making the
        posts worse.
      </p>

      <h2>Where the money goes</h2>
      <p>
        Each run does two jobs: research (finding the stories) and writing (turning them into
        posts). When you first set up an automation, Dispatchlet also writes a playbook for it. The
        playbook is a short brief that says what to look for, which sites to check, what to skip and
        how the posts should sound. That only happens once.
      </p>
      <p>
        Anthropic sells a few versions of Claude at different prices. Haiku is the cheapest and
        fastest. Sonnet costs more and is a better writer. Dispatchlet uses both.
      </p>
      <p>These are averages from 42 test runs:</p>
      <div className="legal-table">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Which Claude</th>
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
                <strong>Total per run</strong>
              </td>
              <td></td>
              <td>
                <strong>About 7&nbsp;cents</strong>
              </td>
            </tr>
            <tr>
              <td>Playbook (once, at setup)</td>
              <td>Sonnet</td>
              <td>7&nbsp;cents</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        One thing surprised me. Most of the research cost isn’t the AI at all. Each time Claude
        searches the web, Anthropic charges a cent, and a run does about three searches. That’s 3 of
        the 5 cents. If I want runs to get cheaper from here, I need to make fewer, smarter
        searches. Switching to a cheaper AI won’t help much.
      </p>
      <p>
        Dispatchlet records what every run costs, so these numbers come from real runs, not
        estimates. You can see your own runs, what they cost and the cost per run in settings.
      </p>

      <h2>How I got here</h2>
      <p>
        I built Dispatchlet on Sonnet. Each run cost around 31 cents, nearly all of it research.
      </p>
      <p>
        On 28 October I tried Haiku for everything. I ran ten test accounts, read through what it
        found and wrote, and it looked just as good for a fifth of the price. So I switched.
      </p>
      <p>
        But that check was just me reading posts and deciding they looked fine. I wanted something
        more reliable. Then, at the end of the month, I had a reason to do it properly.
      </p>

      <h2>Why I spent $72 testing</h2>
      <p>
        My Claude Max plan comes with credits for Claude’s developer platform, and those credits
        expire at the end of each month. On 31 October I still had a good chunk left, and they would
        be gone the next day.
      </p>
      <p>
        So I spent them on a proper test of which version of Claude should do which job. It came to
        about $72. That’s roughly 1,100 Dispatchlet runs at today’s price. I wouldn’t normally spend
        that much on one round of testing, but the credits were going to waste otherwise, and the
        result changed how Dispatchlet works.
      </p>

      <h2>How the test works</h2>
      <h3>Lots of different kinds of accounts</h3>
      <p>
        I keep a set of made-up test accounts, each set up the way a real person would set one up. I
        picked them to be as different from each other as I could:
      </p>
      <ul>
        <li>Formula 1 news on X</li>
        <li>Good news stories on X and LinkedIn</li>
        <li>A weekly programming and security roundup on Bluesky and Mastodon</li>
        <li>New openings in Bristol’s food scene on Threads and X</li>
        <li>Releases from a small group of programming tools, using only their own websites</li>
        <li>A Sheffield Wednesday fan account</li>
        <li>A Kenyan wildlife charity on LinkedIn</li>
        <li>E-ink gadgets and games</li>
        <li>Industry news for a business software company</li>
        <li>Cornish lighthouse preservation, where nothing happens most weeks</li>
        <li>Other people’s projects in Buffer Commit, the hackathon Dispatchlet is entered in</li>
        <li>Space missions on Bluesky</li>
        <li>UK personal finance rule changes, using gov.uk figures only</li>
        <li>New AI models that anyone can download</li>
      </ul>
      <p>
        Each account also has one thing it must get right. For the finance account, every number and
        date has to match gov.uk exactly, and a proposal can’t be described as a new rule. For the
        lighthouse account, it should post nothing on a quiet week and say why, instead of padding
        with old news. Posting nothing on a slow week counts as a pass.
      </p>

      <h3>A fair comparison</h3>
      <p>
        The news changes by the hour. If I tested Haiku on Tuesday and Sonnet on Wednesday, they’d
        be looking at different news and the comparison would be meaningless. So each test went like
        this:
      </p>
      <ol>
        <li>Sonnet writes one playbook, the same way it does when a real person signs up.</li>
        <li>
          Haiku and Sonnet both research from that same playbook at the same moment, so they have
          the same news to find.
        </li>
        <li>
          The posts get written three ways: Haiku writing about Haiku’s stories, Sonnet writing
          about Sonnet’s stories, and Sonnet writing about Haiku’s stories.
        </li>
      </ol>
      <p>
        The third one is the important one. With both of them writing about the same stories, the
        writing gets judged on its own, and good or bad research can’t tip the result.
      </p>

      <h3>A judge that doesn’t know who wrote what</h3>
      <p>
        Reading hundreds of posts myself wasn’t realistic, so I used Opus, Anthropic’s most capable
        Claude, as a judge. For each test it gets the playbook, the thing the account must get
        right, and two sets of results labelled A and B. It never knows which version of Claude made
        which. It gives each one a score out of 5 for staying on topic, getting the facts right,
        quality of writing and meeting the account’s must-get-right rule. Then it picks a winner, or
        calls it a tie.
      </p>
      <p>
        AI judges have a known habit of favouring whichever answer they read first. To cancel that
        out, every pair gets judged twice, once with each one shown first. A side only wins if it
        wins both times. If the judge changes its mind when the order is swapped, it counts as a
        tie.
      </p>
      <p>
        For the posts, “getting the facts right” has a strict meaning. When Dispatchlet researches a
        story, it writes down the facts it found. The writer is only allowed to use those facts, so
        the judge marks down any post that adds something new.
      </p>
      <p>
        Every test account ran three times, which made 42 comparisons per round. The{' '}
        <a href={BENCHMARK_URL}>test itself</a> is in Dispatchlet’s source code if you want to see
        exactly how it works.
      </p>

      <h2>What I found</h2>
      <h3>Haiku is nearly as good at research</h3>
      <p>
        Over 42 comparisons, Sonnet’s research won 23 times, Haiku’s won 17, and 2 were ties. That’s
        close. Haiku even scored slightly better on getting the facts right. And Sonnet’s research
        cost six times as much.
      </p>

      <h3>Sonnet writes better posts</h3>
      <p>
        When both wrote about the same stories, Sonnet’s posts won 18 times and Haiku’s won 6, with
        10 ties. Sonnet scored higher for accuracy and for quality of writing.
      </p>
      <p>
        Here’s a typical example. A new cafe had opened in Bristol, and the facts said it served
        non-alcoholic drinks as an alternative to alcohol. Haiku wrote:
      </p>
      <blockquote>
        Gigi’s Pizzas runs the kitchen for a six-month residency, and there are non-alcoholic drinks
        as well as beer and wine.
      </blockquote>
      <p>
        Nothing in the facts mentions beer and wine. It’s a fair guess, but the whole point of
        Dispatchlet is that it only says what the source says. Sonnet stuck to what was there:
      </p>
      <blockquote>
        By day it’s a speciality coffee shop and second-hand record shop with Disk Frisk, and in the
        evenings a bar with music and kitchen pop-ups. Gigi’s Pizzas runs the kitchen for six
        months, Bristol Express reports.
      </blockquote>
      <p>
        Haiku did win some. On a NASA story, NASA had said that more measurements would help confirm
        a result. Haiku kept that wording:
      </p>
      <blockquote>NASA says more measurements will help confirm it.</blockquote>
      <p>Sonnet made it sound more certain than NASA did:</p>
      <blockquote>Future measurements should confirm it.</blockquote>
      <p>
        The judge picked Haiku both times on that one. Across the whole test, though, Sonnet was
        clearly the better writer.
      </p>

      <h3>Haiku doing everything wasn’t good enough</h3>
      <p>
        When I compared complete runs, Haiku doing everything lost to Sonnet doing everything 23 to
        10, with 3 ties. So the switch I made on 28 October did make the posts worse, even though
        they looked fine to me. In 6 of the 42 tests neither found a new story to post, which was
        the right call for the quiet accounts, so there was nothing to judge.
      </p>

      <h2>The fix: Haiku researches, Sonnet writes</h2>
      <p>
        The writing step is small. With Sonnet it costs about 2 cents, compared to a fifth of a cent
        with Haiku. Research is where most of the money goes, and research is what Haiku is good at.
      </p>
      <p>
        So I ran one more round: Haiku doing the research and Sonnet doing the writing, up against
        Sonnet doing everything.
      </p>
      <div className="legal-table">
        <table>
          <thead>
            <tr>
              <th>Setup</th>
              <th>Cost per&nbsp;run</th>
              <th>Against Sonnet doing everything</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sonnet does everything</td>
              <td>31&nbsp;cents</td>
              <td>–</td>
            </tr>
            <tr>
              <td>Haiku does everything</td>
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
      <p>
        Splitting the jobs gave posts as good as Sonnet doing everything, for about a fifth of the
        price. That’s how Dispatchlet works now.
      </p>

      <h2>What this test can’t tell you</h2>
      <ul>
        <li>
          <strong>The judge is an AI too.</strong> It can’t open links, so it checks posts against
          the facts the research wrote down, not against the original articles.
        </li>
        <li>
          <strong>It’s a small test.</strong> 14 accounts, three times each, on one day. That’s
          enough to show Sonnet writes better and that splitting the jobs holds up. It isn’t enough
          to say the split is better than Sonnet doing everything. 13 to 12 is a draw.
        </li>
        <li>
          <strong>The news was different each round.</strong> Within a round both versions saw the
          same news, but you can’t compare one round’s stories with another’s.
        </li>
      </ul>

      <h2>What’s next</h2>
      <p>
        I’ll run this test again whenever Anthropic releases a new version of Claude or I make a big
        change to how Dispatchlet researches or writes. Next, I want to see how far I can cut the
        number of web searches without missing stories, since that’s now most of what a run costs.
      </p>
    </LegalPage>
  )
}
