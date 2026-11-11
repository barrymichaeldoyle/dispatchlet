import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { RouteError } from './route-error'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

test('a page file that a deploy removed offers a reload, not a broken link', async () => {
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
  const error = new TypeError(
    'Failed to fetch dynamically imported module: https://dispatchlet.com/assets/app-CBK65lTy.js',
  )
  render(<RouteError error={error} reset={() => {}} />)
  expect(screen.getByRole('heading', { name: 'This page did not load' })).toBeTruthy()
  expect(screen.queryByText(/link may be broken/)).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Reload the page' }))
  expect(reload).toHaveBeenCalledTimes(1)
})

test('any other error keeps the broken-link message', () => {
  render(<RouteError error={new Error('Invalid id')} reset={() => {}} />)
  expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back to the app' })).toBeTruthy()
})
