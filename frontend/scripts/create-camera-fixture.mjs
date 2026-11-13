// Local E2E fixture only. The API must use the same local signing secret.
import { createHmac, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import QRCode from 'qrcode'

const directory = mkdtempSync(join(tmpdir(), 'crunch-camera-'))
const payload = Buffer.from(JSON.stringify({ locationId: 'demo-store', expiresAt: Math.floor(Date.now() / 1000) + 3600, nonce: randomBytes(12).toString('hex') })).toString('base64url')
const unsigned = `v1.${payload}`
const secret = process.env.QR_SIGNING_SECRET || 'local-qr-signing-key-change-me-32-byte'
const token = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`
const png = join(directory, 'activity.png')
const video = join(directory, 'activity.y4m')
await QRCode.toFile(png, token, { width: 640, margin: 4, errorCorrectionLevel: 'M' })
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', png, '-t', '3', '-r', '10', '-pix_fmt', 'yuv420p', '-f', 'yuv4mpegpipe', video])
process.stdout.write(video)
