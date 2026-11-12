import { chromium, expect, request, test, type Page } from '@playwright/test'

async function login(page: Page, mockUser: 'mali' | 'nok' | 'beam' | 'ploy', invite = '', analytics = true) {
  await page.goto(invite ? `/?invite=${encodeURIComponent(invite)}` : '/')
  await page.getByRole('button', { name: mockUser }).click()
  await page.getByLabel('I accept required data use').check()
  if (analytics) await page.getByLabel('Optional campaign analytics').check()
  await page.getByRole('button', { name: /Continue to the squad/i }).click()
  await expect(page.getByRole('heading', { name: /Form your squad/i })).toBeVisible()
}

async function join(page: Page) {
  await page.getByRole('button', { name: /Join squad/i }).click()
  await expect(page.getByRole('region', { name: 'Squad roles' })).toBeVisible()
}

function roleCard(page: Page, name: string) {
  return page.getByRole('heading', { name }).locator('xpath=ancestor::article')
}

async function claim(page: Page, name: string) {
  await roleCard(page, name).getByRole('button', { name: /Choose this role/i }).click()
  await expect(roleCard(page, name).getByRole('button', { name: /Start my mission/i })).toBeVisible()
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
  await mali.getByRole('button', { name: /Create squad/i }).click()
  const createBody = await (await created).json()
  const invite = createBody.invitation.token as string
  await expect(mali.getByRole('region', { name: 'Squad roles' })).toBeVisible()

  await login(nok, 'nok', invite, false)
  await join(nok)
  await login(beam, 'beam', invite)
  await join(beam)
  await login(ploy, 'ploy', invite)
  await join(ploy)

  const maliResponse = mali.waitForResponse((response) => response.url().includes('/roles/flavor_scout'))
  const nokResponse = nok.waitForResponse((response) => response.url().includes('/roles/flavor_scout'))
  await Promise.all([
    roleCard(mali, 'Flavor Scout').getByRole('button', { name: /Choose this role/i }).click(),
    roleCard(nok, 'Flavor Scout').getByRole('button', { name: /Choose this role/i }).click(),
  ])
  const maliStatus = (await maliResponse).status()
  const nokStatus = (await nokResponse).status()
  const statuses = [maliStatus, nokStatus].sort()
  expect(statuses).toEqual([200, 409])
  const flavorPage = maliStatus === 200 ? mali : nok
  const creatorPage = flavorPage === mali ? nok : mali
  await creatorPage.reload()
  await expect(creatorPage.getByRole('region', { name: 'Squad roles' })).toBeVisible()
  await claim(creatorPage, 'Crunch Creator')
  await claim(beam, 'Snack Detective')
  await claim(ploy, 'QR Runner')

  await roleCard(flavorPage, 'Flavor Scout').getByRole('button', { name: /Start my mission/i }).click()
  const requiredFlavors = await flavorPage.getByRole('list', { name: 'Required flavor order' }).getByRole('listitem').allTextContents()
  for (const flavor of requiredFlavors) await flavorPage.getByRole('button', { name: new RegExp(flavor, 'i') }).click()
  await flavorPage.getByRole('button', { name: /Complete mission/i }).click()

  await roleCard(creatorPage, 'Crunch Creator').getByRole('button', { name: /Start my mission/i }).click()
  await creatorPage.getByRole('button', { name: /Save snack moment/i }).click()

  await roleCard(beam, 'Snack Detective').getByRole('button', { name: /Start my mission/i }).click()
  if (await beam.getByLabel('Four', { exact: true }).count()) {
    await beam.getByLabel('Four', { exact: true }).check()
    await beam.getByLabel('All four missions', { exact: true }).check()
  } else {
    await beam.getByLabel('QR Runner', { exact: true }).check()
    await beam.getByLabel('Mock Crunch Badge', { exact: true }).check()
  }
  await beam.getByRole('button', { name: /Solve the case/i }).click()

  await roleCard(ploy, 'QR Runner').getByRole('button', { name: /Start my mission/i }).click()
  await ploy.getByLabel('Fallback code').fill('not-a-valid-code')
  await ploy.getByRole('button', { name: /Verify code/i }).click()
  await expect(ploy.getByRole('status')).toContainText(/invalid or expired/i)
  await ploy.getByLabel('Fallback code').fill('mock:demo-store')
  await ploy.getByRole('button', { name: /Verify code/i }).click()
  await expect(ploy.getByRole('heading', { name: /Crunch Vault unlocked/i })).toBeVisible()
  await ploy.getByRole('button', { name: /Claim mock reward/i }).click()
  await expect(ploy.getByRole('button', { name: /Mock reward claimed/i })).toBeDisabled()

  const fifth = await request.newContext({ baseURL: baseURL ?? 'http://localhost:5173' })
  const auth = await fifth.post('/api/v1/auth/mock', { data: { mockUserId: 'test-runner' } })
  const { csrfToken } = await auth.json()
  await fifth.post('/api/v1/consent', { headers: { 'X-CSRF-Token': csrfToken }, data: { requiredAccepted: true, analyticsAllowed: false } })
  const full = await fifth.post('/api/v1/squads/join', { headers: { 'X-CSRF-Token': csrfToken }, data: { token: invite } })
  expect(full.status()).toBe(409)
  expect((await full.json()).error.code).toBe('squad_full')
  await fifth.dispose()

  await ploy.goto('/admin')
  await ploy.getByLabel('Admin API token').fill('local-admin-demo-token')
  await ploy.getByRole('button', { name: 'Load' }).click()
  await expect(ploy.getByText('Unlocked', { exact: true }).locator('..')).toContainText('1')
  await expect(ploy.getByText('Redeemed', { exact: true }).locator('..')).toContainText('1')

  await Promise.all(contexts.map((context) => context.close()))
  await browser.close()
})

function browserContextOptions() {
  return { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
}

