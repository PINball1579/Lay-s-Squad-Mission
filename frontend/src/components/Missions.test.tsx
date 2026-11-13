import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CrunchHunt, FlavorCup, SnackDetective } from './Missions'
import type { FlavorCupVoteResult } from '../types'

afterEach(cleanup)

const huntChallenge = {
  timerSeconds: 30,
  maxHints: 1,
  images: { left: '/a.svg', right: '/b.svg' },
  scoring: { basePerDifference: 100, speedBonusPerSecond: 1, wrongTapPenalty: 10, hintPenalty: 5 },
  differences: [{ id: 'one', x: .5, y: .5, radius: .1, hint: 'กลางภาพ' }],
}

const cupTournament = {
  bracketSize: 4,
  flavors: [
    { id: 'a', name: 'A', description: 'A flavor', image: '/a.svg', color: '#b33' },
    { id: 'b', name: 'B', description: 'B flavor', image: '/b.svg', color: '#383' },
    { id: 'c', name: 'C', description: 'C flavor', image: '/c.svg', color: '#338' },
    { id: 'd', name: 'D', description: 'D flavor', image: '/d.svg', color: '#833' },
  ],
  matches: [
    { id: 'r1m1', round: 1, index: 0, leftId: 'a', rightId: 'b' },
    { id: 'r1m2', round: 1, index: 1, leftId: 'c', rightId: 'd' },
    { id: 'r2m1', round: 2, index: 0, leftId: '', rightId: '' },
  ],
  currentMatchId: 'r1m1', completed: false, selectionCount: 0,
}

describe('replacement mission interactions', () => {
  it('starts Crunch Hunt only after both images load and uses normalized hotspots', async () => {
    const complete = vi.fn().mockResolvedValue(undefined)
    const track = vi.fn().mockResolvedValue(undefined)
    render(<CrunchHunt challenge={huntChallenge} onComplete={complete} track={track} />)
    const [imageA, imageB] = Array.from(document.querySelectorAll('img'))
    expect(screen.getByText(/เวลาจะยังไม่เริ่ม/)).toBeInTheDocument()
    fireEvent.load(imageA)
    expect(track).not.toHaveBeenCalledWith('crunch_hunt_started', expect.anything())
    fireEvent.load(imageB)
    expect(await screen.findByText('30 วิ')).toBeInTheDocument()
    const shelf = screen.getByRole('button', { name: 'ภาพชั้นวาง A' })
    vi.spyOn(shelf, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 200, height: 100, right: 210, bottom: 120, x: 10, y: 20, toJSON: () => ({}) })
    fireEvent.click(shelf, { clientX: 110, clientY: 70 })
    await userEvent.click(screen.getByRole('button', { name: /ยืนยันผล Crunch Hunt/ }))
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ foundDifferenceIds: ['one'], correctTaps: 1 }))
    expect(track).toHaveBeenCalledWith('crunch_hunt_tap', expect.objectContaining({ x: .5, y: .5, correct: true }))
  })

  it('penalizes an incorrect Crunch Hunt tap and provides a hint', async () => {
    render(<CrunchHunt challenge={huntChallenge} onComplete={vi.fn()} />)
    document.querySelectorAll('img').forEach((image) => fireEvent.load(image))
    const shelf = screen.getByRole('button', { name: 'ภาพชั้นวาง A' })
    vi.spyOn(shelf, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.click(shelf, { clientX: 5, clientY: 5 })
    expect(await screen.findByText(/ยังไม่ใช่จุดนี้/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /คำใบ้/ }))
    expect(screen.getByText('กลางภาพ')).toBeInTheDocument()
  })

  it('saves each Flavor Cup selection through the backend', async () => {
    const next = { ...cupTournament, matches: [{ ...cupTournament.matches[0], winnerId: 'a', selectedSide: 'left' }, cupTournament.matches[1], { ...cupTournament.matches[2], leftId: 'a' }], currentMatchId: 'r1m2', selectionCount: 1 }
    const onVote = vi.fn().mockResolvedValue({ attempt: { id: 'attempt', squadId: 'squad', role: 'crunch_creator', challenge: { tournament: next }, status: 'started', startedAt: '', expiresAt: '' }, matchId: 'r1m1', winnerId: 'a', leftFlavor: 'a', rightFlavor: 'b', selectedSide: 'left', round: 1, created: true } as FlavorCupVoteResult)
    render(<FlavorCup challenge={{ tournament: cupTournament }} onVote={onVote} onComplete={vi.fn()} />)
    expect(screen.queryByRole('region', { name: 'สายการแข่งขัน' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'เลือก A' }))
    expect(onVote).toHaveBeenCalledWith('r1m1', 'a', expect.any(Number))
    expect(await screen.findByRole('button', { name: 'เลือก C' })).toBeInTheDocument()
  })

  it('shows an immutable Flavor Cup champion card and completes the mission', async () => {
    const complete = vi.fn().mockResolvedValue(undefined)
    const finished = { ...cupTournament, matches: cupTournament.matches.map((match) => ({ ...match, leftId: match.leftId || 'a', rightId: match.rightId || 'c', winnerId: 'a' })), currentMatchId: '', championId: 'a', completed: true, selectionCount: 3 }
    render(<FlavorCup challenge={{ tournament: finished }} onVote={vi.fn()} onComplete={complete} />)
    expect(screen.getByRole('region', { name: 'My Flavor Champion result card' })).toHaveTextContent('A')
    expect(screen.getByRole('region', { name: 'สายการแข่งขัน' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /ยืนยันแชมป์และจบภารกิจ/ }))
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ championId: 'a', matchCount: 3 }))
  })

  it('keeps the current matchup available when saving a vote fails', async () => {
    const onVote = vi.fn().mockRejectedValue(new Error('offline'))
    render(<FlavorCup challenge={{ tournament: cupTournament }} onVote={onVote} onComplete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'เลือก A' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('บันทึกคำตอบไม่สำเร็จ')
    expect(screen.getByRole('button', { name: 'เลือก A' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'เลือก B' })).toBeEnabled()
  })
})

describe('preserved missions', () => {
  it('collects answers and confidence for Snack Detective', async () => {
    const complete = vi.fn().mockResolvedValue(undefined)
    render(<SnackDetective onComplete={complete} />)
    await userEvent.click(screen.getByLabelText('4 บทบาท'))
    await userEvent.click(screen.getByLabelText('ทำครบทั้ง 4 ภารกิจ'))
    await userEvent.selectOptions(screen.getByLabelText('มั่นใจแค่ไหน?'), 'somewhat sure')
    await userEvent.click(screen.getByRole('button', { name: /ส่งคำตอบ/ }))
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ accuracy: 1, confidence: 'somewhat sure' }))
  })

})
