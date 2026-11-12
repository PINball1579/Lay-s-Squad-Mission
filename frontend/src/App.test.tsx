import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => vi.restoreAllMocks())

describe('LIFF bootstrap states', () => {
  it('shows the mock authentication choices after an unauthenticated session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'authentication_required', message: 'Authentication required' } }),
    }))
    render(<App />)
    expect(screen.getByText(/Warming up the crunch/i)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /Build your squad/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'mali' })).toBeInTheDocument()
  })

  it('provides a retry action when startup fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')))
    render(<App />)
    expect(await screen.findByRole('heading', { name: /Crunch interrupted/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument()
  })
})

