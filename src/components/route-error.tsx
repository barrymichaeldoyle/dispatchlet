import { Link } from '@tanstack/react-router'

/**
 * What a page shows when rendering it threw: a bad id in the address, a query that refused the
 * arguments, or a tab still running the code from before a deploy against data in a newer shape.
 * The router reports the error (router.tsx); these only have to read well. Both sit inside the app
 * shell, so the sidebar and header stay up.
 */
export function RouteError() {
  return (
    <div className="app-route-error">
      <h1>Something went wrong</h1>
      <p>
        This link may be broken or the item may have been removed. If Dispatchlet was updated while
        this page was open, reloading it fixes this.
      </p>
      <div className="app-gate-actions">
        <button type="button" className="app-gate-primary" onClick={() => window.location.reload()}>
          Reload the page
        </button>
        <Link to="/app" className="app-gate-secondary">
          Back to the app
        </Link>
      </div>
    </div>
  )
}

/** For the pages keyed by an id: the same words they show when the id finds nothing. */
export function MissingItem({ what }: { what: 'automation' | 'run' }) {
  return (
    <div className="app-route-error">
      <h1>{what === 'run' ? 'Run not found' : 'Automation not found'}</h1>
      <p>This {what} does not exist, or it is not yours.</p>
      <Link to="/app" className="app-gate-secondary">
        Back to the app
      </Link>
    </div>
  )
}
