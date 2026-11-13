import { chromium, expect, request, test, type Page } from '@playwright/test'

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
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
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
  await claim(ploy, 'นักวิ่ง QR')

  await roleCard(flavorPage, 'Crunch Hunter').getByRole('button', { name: /เริ่มภารกิจของฉัน/i }).click()
  await expect(flavorPage.getByRole('heading', { name: /Crunch Hunt/ })).toBeVisible()
  const huntImage = flavorPage.getByRole('button', { name: 'ภาพชั้นวาง A' })
  await expect(flavorPage.getByText(/เวลา 90 วินาที/)).toBeVisible()
  const huntBox = await huntImage.boundingBox()
  if (!huntBox) throw new Error('Crunch Hunt image did not render')
  let foundCount = 0
  for (const [x, y] of [[.50,.13],[.19,.43],[.76,.43],[.35,.72],[.82,.73]]) {
    foundCount += 1
    await huntImage.click({ position: { x: huntBox.width * x, y: huntBox.height * y } })
    await expect(flavorPage.getByText(`พบ ${foundCount}/5`)).toBeVisible()
  }
  await flavorPage.getByRole('button', { name: /ยืนยันผล Crunch Hunt/i }).click()

  await roleCard(creatorPage, 'Flavor Referee').getByRole('button', { name: /เริ่มภารกิจของฉัน/i }).click()
  await expect(creatorPage.getByRole('heading', { name: /Flavor Cup/ })).toBeVisible()
  await creatorPage.getByRole('region', { name: 'คู่แข่งขันปัจจุบัน' }).getByRole('button').first().click()
  await creatorPage.reload()
  await expect(creatorPage.getByRole('region', { name: 'ภารกิจของทีม' })).toBeVisible()
  await roleCard(creatorPage, 'Flavor Referee').getByRole('button', { name: /เริ่มภารกิจของฉัน/i }).click()
  for (let selection = 1; selection < 7; selection++) {
    await creatorPage.getByRole('region', { name: 'คู่แข่งขันปัจจุบัน' }).getByRole('button').first().click()
  }
  await expect(creatorPage.getByRole('region', { name: 'My Flavor Champion result card' })).toBeVisible()
  await creatorPage.getByRole('button', { name: /ยืนยันแชมป์และจบภารกิจ/i }).click()

  await roleCard(beam, 'นักสืบสายสแน็ก').getByRole('button', { name: /เริ่มภารกิจของฉัน/i }).click()
  await expect(beam.getByRole('heading', { name: 'แกะเบาะเงื่อนงำให้ได้' })).toBeVisible()
  if (await beam.getByLabel('4 บทบาท', { exact: true }).count()) {
    await beam.getByLabel('4 บทบาท', { exact: true }).check()
    await beam.getByLabel('ทำครบทั้ง 4 ภารกิจ', { exact: true }).check()
  } else {
    await beam.getByLabel('นักวิ่ง QR', { exact: true }).check()
    await beam.getByLabel('ปลดล็อกสิทธิ์รางวัล', { exact: true }).check()
  }
  await beam.getByRole('button', { name: /ส่งคำตอบ/i }).click()

  await roleCard(ploy, 'นักวิ่ง QR').getByRole('button', { name: /เริ่มภารกิจของฉัน/i }).click()
  await ploy.getByLabel('รหัสสำหรับทดสอบภายใน').fill('not-a-valid-code')
  await ploy.getByRole('button', { name: /ยืนยันโค้ด/i }).click()
  await expect(ploy.getByRole('status')).toContainText(/โค้ดไม่ถูกต้อง/i)
  await ploy.getByLabel('รหัสสำหรับทดสอบภายใน').fill('mock:demo-store')
  await ploy.getByRole('button', { name: /ยืนยันโค้ด/i }).click()
  await expect(ploy.getByRole('heading', { name: /Crunch Vault เปิดแล้ว/i })).toBeVisible()
  await ploy.getByRole('button', { name: /รับสิทธิ์รางวัล/i }).click()
  await expect(ploy.getByRole('button', { name: /รับสิทธิ์แล้ว/i })).toBeDisabled()

  const fifth = await request.newContext({ baseURL: baseURL ?? 'http://localhost:5173' })
  const auth = await fifth.post('/api/v1/auth/mock', { data: { mockUserId: 'test-runner' } })
  const { csrfToken } = await auth.json()
  await fifth.post('/api/v1/consent', { headers: { 'X-CSRF-Token': csrfToken }, data: { requiredAccepted: true, analyticsAllowed: false } })
  const full = await fifth.post('/api/v1/squads/join', { headers: { 'X-CSRF-Token': csrfToken }, data: { token: invite } })
  expect(full.status()).toBe(409)
  expect((await full.json()).error.code).toBe('squad_full')
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
  return { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
}

