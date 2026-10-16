import type { ReactNode } from 'react'

function Row({ time, last, children }: { time: string; last?: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid grid-cols-[80px_minmax(0,1fr)] gap-x-4 border-b sm:gap-x-6 ${
        last ? 'border-ink' : 'border-rule'
      }`}
    >
      <span className="border-r border-rule pt-[18px] pr-3 pb-4 text-right text-sm text-muted">
        {time}
      </span>
      <div className="flex flex-col gap-1.5 py-4">{children}</div>
    </div>
  )
}

function Story({
  kept,
  title,
  reason,
  last,
}: {
  kept?: boolean
  title: string
  reason: string
  last?: boolean
}) {
  return (
    <tr className={`border-t border-rule ${kept ? 'bg-tint' : ''} ${last ? 'border-b' : ''}`}>
      <td
        className={`w-[72px] py-2.5 pr-4 pl-2 align-top ${kept ? 'font-medium text-pine' : 'text-muted'}`}
      >
        {kept ? 'Kept' : 'Skipped'}
      </td>
      <td className={`py-2.5 pr-2 align-top ${kept ? '' : 'text-muted'}`}>
        {title}
        <br />
        <span className="text-muted">{reason}</span>
      </td>
    </tr>
  )
}

function Post({
  channel,
  children,
  last,
}: {
  channel: string
  children: ReactNode
  last?: boolean
}) {
  return (
    <div className={`flex flex-col gap-2.5 border-b py-4 ${last ? 'border-ink' : 'border-rule'}`}>
      <div className="flex justify-between text-sm text-muted">
        <span>{channel}</span>
        <span>Draft</span>
      </div>
      <p className="m-0 text-[15px] leading-[1.55]">{children}</p>
    </div>
  )
}

export function ExampleRun() {
  return (
    <section id="run" aria-label="Example run" className="flex scroll-mt-6 flex-col pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3 pb-4">
        <span className="text-base font-medium">A run from the Good News Today playbook</span>
        <span className="text-sm text-muted">15 Oct at 09:00.</span>
      </div>
      <div className="grid grid-cols-1 gap-x-8 border-t border-ink md:grid-cols-12">
        <div className="flex flex-col md:col-span-8">
          <Row time="09:00:03">
            <span className="text-base font-medium">Research</span>
            <p className="m-0 max-w-[64ch] text-[15px] leading-[1.55]">
              Ran 7 searches and read 11 pages on positive.news, goodnewsnetwork.org,
              reasonstobecheerful.world, bbc.com and theguardian.com. Kept 4 stories from the last 2
              days.
            </p>
          </Row>
          <Row time="09:00:51">
            <span className="text-base font-medium">Chose 1 of 4 stories</span>
            <table className="w-full table-fixed border-collapse text-[15px] leading-normal [overflow-wrap:anywhere]">
              <tbody>
                <Story
                  kept
                  title="[Species] numbers in [region] double after a 10 year reserve programme"
                  reason="theguardian.com, 5 hours ago. A named conservation body and a figure. Not posted before."
                />
                <Story
                  title="[Town] opens a free repair cafe in its old library"
                  reason="Good story, but the playbook allows 1 post per run. Kept for tomorrow."
                />
                <Story
                  title="[Company] pledges to plant a million trees"
                  reason="Company press release, and the playbook says to skip those."
                  last
                />
              </tbody>
            </table>
          </Row>
          <Row time="09:01:55" last>
            <span className="text-base font-medium">Saved to Buffer</span>
            <p className="m-0 text-[15px] leading-[1.55]">
              2 drafts created, one for X and one for LinkedIn, both tagged Dispatchlet.
            </p>
          </Row>
        </div>
        <div className="flex flex-col md:col-span-4">
          <Post channel="Good News Today on X">
            [Species] numbers in [region] have doubled since a reserve was set up ten years ago,
            according to [conservation body]. Slow work, but it works. theguardian.com/…
          </Post>
          <Post channel="Good News Today on LinkedIn" last>
            Ten years ago [region] set aside a reserve for [species]. This week [conservation body]
            reported the population has doubled.
            <br />
            <br />
            It took patience, local rangers and not much money. The full story is in the link.
          </Post>
        </div>
      </div>
      <p className="m-0 pt-4 text-sm text-muted">
        This run is from testing. Live runs start 28 October.
      </p>
    </section>
  )
}
