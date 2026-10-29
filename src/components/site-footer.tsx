import { BrandText } from './brand-text'

const SOURCE_URL = 'https://github.com/barrymichaeldoyle/dispatchlet'
const BARRY_URL = 'https://x.com/barrymdoyle'

export function SiteFooter() {
  return (
    <footer className="landing-footer">
      <span>
        <a href={BARRY_URL}>Built in public for Buffer Commit</a>{' '}
        <BrandText>on the Buffer API. Not a Buffer product.</BrandText>
      </span>
      <span>
        <a href={BARRY_URL}>Barry Michael Doyle</a>{' '}
        <a href={SOURCE_URL}>Source, Elastic License 2.0</a> <a href="/docs">Docs</a>{' '}
        <a href="/docs/api">API</a> <a href="/privacy">Privacy</a> <a href="/terms">Terms</a>
      </span>
    </footer>
  )
}
