/**
 * What an app page shows while its data loads: the shape of a page (a title, a row of figures,
 * a card) in quiet blocks, so the content arrives in place instead of after a blank screen.
 */
export function PageSkeleton({ figures = true }: { figures?: boolean }) {
  return (
    <div className="app-skeleton" role="status" aria-label="Loading">
      <span className="app-skeleton-title" />
      <span className="app-skeleton-line" />
      {figures ? (
        <div className="app-skeleton-figures">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : null}
      <span className="app-skeleton-card" />
    </div>
  )
}
