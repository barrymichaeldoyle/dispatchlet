import { createFileRoute } from '@tanstack/react-router'
import { LegalPage, legalHead } from '../components/legal-page'

/** Newest first. */
const POSTS = [
  {
    path: '/blog/cost-per-run',
    title: 'How I tested cheaper AI models to lower my cost-per-run',
    date: '31 Oct 2026',
    summary:
      'How a run went from 32 cents to about 7, and the test that showed which version of Claude should research and which should write.',
  },
]

export const Route = createFileRoute('/blog')({
  component: Blog,
  head: () =>
    legalHead(
      'Blog',
      'Notes from building Dispatchlet: what it costs to run, what I tested and what changed.',
      '/blog',
    ),
})

function Blog() {
  return (
    <LegalPage title="Blog" updated={POSTS[0]!.date}>
      <p>Notes from building Dispatchlet: what it costs, what I tested and what changed.</p>
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
