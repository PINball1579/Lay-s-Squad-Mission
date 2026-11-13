import { chromium, expect, request, test, type Page } from '@playwright/test'
import { join } from 'node:path'

async function login(page: Page, mockUser: 'mali' | 'nok' | 'beam' | 'ploy', invite = '', analytics = true) {
  await page.goto(invite ? `/?invite=${encodeURIComponent(invite)}` : '/')
  await page.getByRole('button', { name: mockUser }).click()
  await page.getByLabel('ยอมรับการใช้ข้อมูลที่จำเป็น').check()
  if (analytics) await page.getByLabel('อนุญาตการวิเคราะห์กิจกรรม').check()
  await page.getByRole('button', { name: invite ? /ยืนยันและเข้าร่วมทีม/i : /ยืนยันและเริ่มเล่น/i }).click()
  if (invite) await expect(page.getByRole('region', { name: 'ภารกิจของทีม' })).toBeVisible()
  else await expect(page.getByRole('heading', { name: /ตั้งทีมของคุณ/i })).toBeVisible()
}

function roleCard(page: Page, name: string) {
  return page.getByRole('heading', { name }).locator('xpath=ancestor::article')
}

async function claim(page: Page, name: string) {
  await roleCard(page, name).getByRole('button', { name: /ล็อกภารกิจนี้/i }).click()
  await expect(roleCard(page, name).getByRole('button', { name: /เริ่มภารกิจของฉัน/i })).toBeVisible()
}

test('four-player journey, race handling, consent, QR, reward, and dashboard', async ({ baseURL }) => {
  const browser = process.env.PLAYWRIGHT_CDP_ENDPOINT
    ? await chromium.connectOverCDP(process.env.PLAYWRIGHT_CDP_ENDPOINT)
    : await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: [] }
      : undefined)
  const players = await Promise.all(['mali', 'nok', 'beam', 'ploy'].map(async () => {
    const context = await browser.newContext({ ...browserContextOptions() })
    const page = await context.newPage()
    return { context, page }
  }))
  const contexts = players.map(({ context }) => context)
  const [mali, nok, beam, ploy] = players.map(({ page }) => page)

  await login(mali, 'mali')
  const created = mali.waitForResponse((response) => response.url().endsWith('/api/v1/squads') && response.request().method() === 'POST')
  await mali.getByRole('button', { name: /สร้างทีม/i }).click()
  const createBody = await (await created).json()
  const invite = createBody.invitation.token as string
  await expect(mali.getByRole('region', { name: 'ภารกิจของทีม' })).toBeVisible()
  await mali.getByRole('button', { name: 'ชวนเพื่อนเข้าทีม' }).click()
  await expect(mali.getByRole('status')).toContainText('คัดลอกแล้ว!')
  await expect(mali.getByRole('region', { name: 'การ์ดเชิญเข้าร่วมทีม' })).toHaveCount(0)

  await login(nok, 'nok', invite, false)
  await login(beam, 'beam', invite)
  await login(ploy, 'ploy', invite)

  const maliResponse = mali.waitForResponse((response) => response.url().includes('/roles/flavor_scout'))
  const nokResponse = nok.waitForResponse((response) => response.url().includes('/roles/flavor_scout'))
  await Promise.all([
    roleCard(mali, 'Crunch Hunter').getByRole('button', { name: /ล็อกภารกิจนี้/i }).click(),
    roleCard(nok, 'Crunch Hunter').getByRole('button', { name: /ล็อกภารกิจนี้/i }).click(),
  ])
  const maliStatus = (await maliResponse).status()
  const nokStatus = (await nokResponse).status()
  const statuses = [maliStatus, nokStatus].sort()
  expect(statuses).toEqual([200, 409])
  const flavorPage = maliStatus === 200 ? mali : nok
  const creatorPage = flavorPage === mali ? nok : mali
  await creatorPage.reload()
  await expect(creatorPage.getByRole('region', { name: 'ภารกิจของทีม' })).toBeVisible()
  await claim(creatorPage, 'Flavor Referee')
  await claim(beam, 'นักสืบสายสแน็ก')
  await claim(ploy, 'นักล่าใบเสร็จ')

  await roleCard(flavorPage, 'Crunch Hunter').getByRole('button', { name: /เริ่มภารกิจของฉัน/i }).click()
  await expect(flavorPage.getByRole('heading', { name: /Crunch Hunt/ })).toBeVisible()
  const huntImage = flavorPage.getByRole('button', { name: 'ภาพชั้นวาง A' })
  await expect(flavorPage.getByText('90 วิ')).toBeVisible()
  const huntBox = await huntImage.boundingBox()
  if (!huntBox) throw new Error('Crunch Hunt image did not render')
  let foundCount = 0
  for (const [x, y] of [[.50,.13],[.19,.43],[.76,.43],[.35,.72],[.82,.73]]) {
    foundCount += 1
    await huntImage.click({ position: { x: huntBox.width * x, y: huntBox.height * y } })
    await expect(flavorPage.getByText(`${foundCount}/5`, { exact: true })).toBeVisible()
  }
  await flavorPage.getByRole('button', { name: /ยืนยันผล Crunch Hunt/i }).click()

  await roleCard(creatorPage, 'Flavor Referee').getByRole('button', { name: /เริ่มภารกิจของฉัน/i }).click()
  await expect(creatorPage.getByRole('heading', { name: /Flavor Cup/ })).toBeVisible()
  await expect(creatorPage.getByRole('region', { name: 'สายการแข่งขัน' })).toHaveCount(0)
  await creatorPage.getByRole('region', { name: 'คู่แข่งขันปัจจุบัน' }).getByRole('button').first().click()
  await creatorPage.reload()
  await expect(creatorPage.getByRole('region', { name: 'ภารกิจของทีม' })).toBeVisible()
  await roleCard(creatorPage, 'Flavor Referee').getByRole('button', { name: /เริ่มภารกิจของฉัน/i }).click()
  for (let selection = 1; selection < 15; selection++) {
    await creatorPage.getByRole('region', { name: 'คู่แข่งขันปัจจุบัน' }).getByRole('button').first().click()
  }
  await expect(creatorPage.getByRole('region', { name: 'My Flavor Champion result card' })).toBeVisible()
  await expect(creatorPage.getByRole('region', { name: 'สายการแข่งขัน' })).toBeVisible()
  await creatorPage.getByRole('button', { name: /ยืนยันแชมป์และจบภารกิจ/i }).click()

  await roleCard(beam, 'นักสืบสายสแน็ก').getByRole('button', { name: /เริ่มภารกิจของฉัน/i }).click()
  await expect(beam.getByRole('heading', { name: 'แกะเบาะเงื่อนงำให้ได้' })).toBeVisible()
  if (await beam.getByLabel('4 บทบาท', { exact: true }).count()) {
    await beam.getByLabel('4 บทบาท', { exact: true }).check()
    await beam.getByLabel('ทำครบทั้ง 4 ภารกิจ', { exact: true }).check()
  } else {
    await beam.getByLabel('นักล่าใบเสร็จ', { exact: true }).check()
    await beam.getByLabel('ปลดล็อกสิทธิ์รางวัล', { exact: true }).check()
  }
  await beam.getByRole('button', { name: /ส่งคำตอบ/i }).click()

  await roleCard(ploy, 'นักล่าใบเสร็จ').getByRole('button', { name: /เริ่มภารกิจของฉัน/i }).click()
  const receiptFixtures = process.env.RECEIPT_FIXTURE_DIR
  if (!receiptFixtures) throw new Error('Generate receipt fixtures and run with docker-compose.receipt-test.yml; see docs/RECEIPT_OCR.md')
  await ploy.getByLabel('เลือกภาพใบเสร็จ', { exact: true }).setInputFiles(join(receiptFixtures, 'negative.png'))
  await expect.poll(() => ploy.getByAltText('ภาพใบเสร็จที่จะส่งตรวจ').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await ploy.getByRole('checkbox', { name: 'ยินยอมส่งภาพใบเสร็จให้ iApp อ่านข้อความ' }).check()
  await ploy.getByRole('button', { name: 'ส่งใบเสร็จเพื่อตรวจสอบ' }).click()
  await expect(ploy.getByRole('alert')).toContainText('ยังไม่พบรายการเลย์')
  await ploy.getByLabel('เลือกภาพใบเสร็จ', { exact: true }).setInputFiles(join(receiptFixtures, 'positive.png'))
  await ploy.getByRole('button', { name: 'ส่งใบเสร็จเพื่อตรวจสอบ' }).click()
  await expect(ploy.getByRole('heading', { name: /Crunch Vault เปิดแล้ว/i })).toBeVisible()
  const beforeClaim = await contexts[3].request.get(`/api/v1/squads/${createBody.squad.id}/reward`)
  expect((await beforeClaim.json()).coupon).toBeNull()
  await ploy.getByRole('button', { name: /รับสิทธิ์รางวัล/i }).click()
  const couponDialog = ploy.getByRole('dialog', { name: 'รับสิทธิ์เรียบร้อยแล้ว!' })
  await expect(couponDialog).toBeVisible()
  const couponCode = await couponDialog.locator('code').innerText()
  expect(couponCode).toMatch(/^MOCK-/)
  const claimedReward = await contexts[3].request.get(`/api/v1/squads/${createBody.squad.id}/reward`)
  expect(claimedReward.headers()['cache-control']).toBe('no-store')
  await couponDialog.getByRole('button', { name: 'คัดลอกรหัสคูปอง' }).click()
  await expect(couponDialog.getByRole('status')).toContainText('คัดลอกรหัสคูปองแล้ว!')
  await couponDialog.getByRole('button', { name: 'ปิดคูปอง' }).click()
  await ploy.reload()
  await ploy.getByRole('button', { name: 'ดูรหัสคูปอง' }).click()
  await expect(couponDialog.locator('code')).toHaveText(couponCode)
  await couponDialog.getByRole('button', { name: 'ปิดคูปอง' }).click()

  const fifth = await request.newContext({ baseURL: baseURL ?? 'http://localhost:5173' })
  const auth = await fifth.post('/api/v1/auth/mock', { data: { mockUserId: 'test-runner' } })
  const { csrfToken } = await auth.json()
  await fifth.post('/api/v1/consent', { headers: { 'X-CSRF-Token': csrfToken }, data: { requiredAccepted: true, analyticsAllowed: false } })
  const full = await fifth.post('/api/v1/squads/join', { headers: { 'X-CSRF-Token': csrfToken }, data: { token: invite } })
  expect(full.status()).toBe(409)
  expect((await full.json()).error.code).toBe('squad_full')
  const privateCoupon = await fifth.get(`/api/v1/squads/${createBody.squad.id}/reward`)
  expect(privateCoupon.ok()).toBe(false)
  await fifth.dispose()

  await ploy.goto('/admin')
  await ploy.getByLabel('โทเคนผู้ดูแล').fill('local-admin-demo-token')
  await ploy.getByRole('button', { name: 'โหลดข้อมูล' }).click()
  await expect(ploy.getByText('ปลดล็อก', { exact: true }).locator('..')).toContainText('1')
  await expect(ploy.getByText('รับสิทธิ์', { exact: true }).locator('..')).toContainText('1')

  await Promise.all(contexts.map((context) => context.close()))
  await browser.close()
})

function browserContextOptions() {
  return { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] }
}

