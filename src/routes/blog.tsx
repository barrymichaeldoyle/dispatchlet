import { createFileRoute } from '@tanstack/react-router'
import { LegalPage, legalHead } from '../components/legal-page'

/** Newest first. */
const POSTS = [
  {
    path: '/blog/cost-per-run',
    title: 'How I tested cheaper AI models to lower my cost-per-run',
    date: '31 Oct 2026',
    summary:
      'I tested Claude Haiku against Sonnet on 14 test accounts. Haiku now does the research and Sonnet writes the posts, and a run costs about $0.07.',
  },
]

export const Route = createFileRoute('/blog')({
  component: Blog,
  head: () => legalHead('Blog', 'Posts about building Dispatchlet.', '/blog'),
})

function Blog() {
  return (
    <LegalPage title="Blog" updated={POSTS[0]!.date}>
      <p>Posts about building Dispatchlet.</p>
      <ul className="blog-list">
        {POSTS.map((post) => (
          <li key={post.path}>
            <a href={post.path}>{post.title}</a>
            <span className="blog-date">{post.date}</span>
            <p>{post.summary}</p>
          </li>
        ))}
      </ul>
    </LegalPage>
  )
}
