import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CrunchCreator, FlavorScout, QRRunner, SnackDetective } from './Missions'
import { MockLineAdapter } from '../lib/liff'

afterEach(cleanup)

describe('mission interactions', () => {
  it('completes Flavor Scout after three valid discoveries', async () => {
    const user = userEvent.setup()
    const complete = vi.fn().mockResolvedValue(undefined)
    render(<FlavorScout onComplete={complete} />)
    await user.click(screen.getByRole('button', { name: /Sunny Salt/i }))
    await user.click(screen.getByRole('button', { name: /Smoky BBQ/i }))
    await user.click(screen.getByRole('button', { name: /Zesty Lime/i }))
    await user.click(screen.getByRole('button', { name: /Complete mission/i }))
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ accuracy: 1, discoveryOrder: ['Sunny Salt', 'Smoky BBQ', 'Zesty Lime'] }))
  })

  it('follows the server-issued Flavor Scout order', async () => {
    const user = userEvent.setup()
    const complete = vi.fn().mockResolvedValue(undefined)
    render(<FlavorScout challenge={{ requiredOrder: ['Zesty Lime', 'Sunny Salt', 'Smoky BBQ'] }} onComplete={complete} />)
    await user.click(screen.getByRole('button', { name: /Zesty Lime/i }))
    await user.click(screen.getByRole('button', { name: /Sunny Salt/i }))
    await user.click(screen.getByRole('button', { name: /Smoky BBQ/i }))
    await user.click(screen.getByRole('button', { name: /Complete mission/i }))
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ discoveryOrder: ['Zesty Lime', 'Sunny Salt', 'Smoky BBQ'] }))
  })

  it('submits a mission only once while completion is pending', async () => {
    const user = userEvent.setup()
    const complete = vi.fn(() => new Promise<void>(() => undefined))
    render(<FlavorScout onComplete={complete} />)
    await user.click(screen.getByRole('button', { name: /Sunny Salt/i }))
    await user.click(screen.getByRole('button', { name: /Smoky BBQ/i }))
    await user.click(screen.getByRole('button', { name: /Zesty Lime/i }))
    const submit = screen.getByRole('button', { name: /Complete mission/i })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Completing/i })).toBeDisabled()
  })

  it('renders and saves a template-driven Crunch Creator card', async () => {
    const user = userEvent.setup()
    const complete = vi.fn().mockResolvedValue(undefined)
    render(<CrunchCreator onComplete={complete} />)
    await user.selectOptions(screen.getByLabelText('Occasion'), 'Game night')
    await user.clear(screen.getByLabelText('Caption'))
    await user.type(screen.getByLabelText('Caption'), 'Crunch time!')
    await user.click(screen.getByRole('button', { name: /Save snack moment/i }))
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ occasion: 'Game night', caption: 'Crunch time!', creativeStyle: 'template-card' }))
  })

  it('locks Crunch Creator to the issued occasion', async () => {
    const user = userEvent.setup()
    const complete = vi.fn().mockResolvedValue(undefined)
    render(<CrunchCreator challenge={{ requiredOccasion: 'Road trip' }} onComplete={complete} />)
    expect(screen.getByLabelText('Occasion')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Save snack moment/i }))
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ occasion: 'Road trip' }))
  })

  it('collects answers and confidence for Snack Detective', async () => {
    const user = userEvent.setup()
    const complete = vi.fn().mockResolvedValue(undefined)
    render(<SnackDetective onComplete={complete} />)
    await user.click(screen.getByLabelText('Four'))
    await user.click(screen.getByLabelText('All four missions'))
    await user.selectOptions(screen.getByLabelText('How confident are you?'), 'somewhat sure')
    await user.click(screen.getByRole('button', { name: /Solve the case/i }))
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ accuracy: 1, confidence: 'somewhat sure' }))
  })

  it('renders the issued Snack Detective variant', async () => {
    const user = userEvent.setup()
    const complete = vi.fn().mockResolvedValue(undefined)
    render(<SnackDetective challenge={{ variant: 'location' }} onComplete={complete} />)
    await user.click(screen.getByLabelText('QR Runner'))
    await user.click(screen.getByLabelText('Mock Crunch Badge'))
    await user.click(screen.getByRole('button', { name: /Solve the case/i }))
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ answers: { q1: 'QR Runner', q2: 'Mock Crunch Badge' } }))
  })

  it('validates the local QR fixture before completion', async () => {
    const user = userEvent.setup()
    const complete = vi.fn().mockResolvedValue(undefined)
    const validateQR = vi.fn().mockResolvedValue({ locationId: 'demo-store' })
    render(<QRRunner line={new MockLineAdapter()} validateQR={validateQR} onComplete={complete} />)
    await user.click(screen.getByRole('button', { name: /Verify code/i }))
    expect(validateQR).toHaveBeenCalledWith('mock:demo-store')
    expect(await screen.findByText(/Verified at demo-store/i)).toBeInTheDocument()
    expect(complete).toHaveBeenCalledWith({ locationId: 'demo-store', conversion: true })
  })
})

