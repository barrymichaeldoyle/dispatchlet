import { BrandText } from './brand-text'

const SOURCE_URL = 'https://github.com/barrymichaeldoyle/dispatchlet'
const BARRY_URL = 'https://x.com/barrymdoyle'

export function SiteFooter() {
  return (
    <footer className="landing-footer">
      <span>
        <a href={BARRY_URL}>Built in public for Buffer Commit</a>.{' '}
        <BrandText>Built with the Buffer API. Not a Buffer product.</BrandText>
      </span>
      <span>
        <a href={BARRY_URL}>Barry Michael Doyle</a>
        <span aria-hidden="true"> · </span>
        <a href={SOURCE_URL}>Source</a> · Elastic License 2.0
        <span aria-hidden="true"> · </span>
        <a href="/privacy">Privacy</a>
        <span aria-hidden="true"> · </span>
        <a href="/terms">Terms</a>
      </span>
    </footer>
  )
}
