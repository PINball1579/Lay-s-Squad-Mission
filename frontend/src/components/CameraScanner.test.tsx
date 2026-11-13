import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraScanner } from './CameraScanner'

const scanner = vi.hoisted(() => ({ decode: vi.fn(), stop: vi.fn() }))
vi.mock('@zxing/browser', () => ({ BrowserQRCodeReader: class { decodeFromConstraints = scanner.decode } }))

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('browser camera scanner', () => {
  it('reads a QR only once and releases the scanner on unmount', async () => {
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } })
    scanner.decode.mockResolvedValue({ stop: scanner.stop })
    const onResult = vi.fn()
    const view = render(<CameraScanner onResult={onResult} onClose={vi.fn()} />)
    await waitFor(() => expect(scanner.decode).toHaveBeenCalledTimes(1))
    const callback = scanner.decode.mock.calls[0][2]
    callback({ getText: () => 'signed-token' }, undefined, { stop: scanner.stop })
    callback({ getText: () => 'signed-token' }, undefined, { stop: scanner.stop })
    expect(onResult).toHaveBeenCalledExactlyOnceWith('signed-token')
    view.unmount()
    expect(scanner.stop).toHaveBeenCalled()
  })

  it('explains camera permission denial and keeps a close action available', async () => {
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } })
    scanner.decode.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    render(<CameraScanner onResult={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('กรุณาอนุญาตการใช้กล้อง')
    expect(screen.getByRole('button', { name: 'ปิดกล้อง' })).toBeEnabled()
  })
})
