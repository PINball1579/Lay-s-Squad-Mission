import { useEffect, useState } from 'react'
import { api, ApiError } from './lib/api'
import { lineAdapter, readInviteToken } from './lib/liff'
import { MissionRunner } from './components/Missions'
import { CouponDialog } from './components/CouponDialog'
import { restoreAppSession } from './lib/session'
import type { RewardCoupon } from './types'
import { SquadInvitation } from './components/SquadInvitation'
import { BrandHeader, CampaignFooter, MissionIcon } from './components/Brand'
import { roles, type Dashboard, type MissionAttempt, type Role, type Squad, type User } from './types'

type Screen = 'loading' | 'intro' | 'consent' | 'lobby' | 'squad' | 'mission' | 'error'

const errorMessages: Record<string, string> = {
  authentication_required: 'กรุณาเข้าสู่ระบบก่อนเริ่มเล่น',
  consent_required: 'กรุณายืนยันการใช้ข้อมูลที่จำเป็น',
  invitation_expired: 'คำเชิญนี้หมดอายุแล้ว ขอลิงก์ใหม่จากเพื่อนในทีม',
  not_found: 'ไม่พบคำเชิญนี้ ตรวจสอบลิงก์อีกครั้ง',
  squad_full: 'ทีมนี้ครบ 4 คนแล้ว',
  role_taken: 'เพื่อนเพิ่งล็อกภารกิจนี้ เลือกภารกิจอื่นได้เลย',
  already_member: 'บัญชีนี้อยู่ในทีมอื่นแล้ว',
  request_failed: 'ระบบไม่สามารถทำรายการนี้ได้',
}

function thaiError(cause: unknown) {
  if (cause instanceof ApiError) return errorMessages[cause.code] ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
  return 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง'
}

function clearInviteFromAddress() {
  const next = new URL(window.location.href)
  next.searchParams.delete('invite')
  next.searchParams.delete('liff.state')
  try { sessionStorage.removeItem('crunch:login-invite') } catch { /* Storage can be blocked in a webview. */ }
  window.history.replaceState({}, '', `${next.pathname}${next.search}${next.hash}`)
}

export default function App() {
  if (window.location.pathname.startsWith('/admin')) return <AdminDashboard />
  return <PlayerApp />
}

function PlayerApp() {
  const [inviteToken] = useState(() => { const fromURL = readInviteToken(); if (fromURL) return fromURL; try { return sessionStorage.getItem('crunch:login-invite') ?? '' } catch { return '' } })
  const [screen, setScreen] = useState<Screen>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [squad, setSquad] = useState<Squad | null>(null)
  const [missionRole, setMissionRole] = useState<Role | null>(null)
  const [missionAttempt, setMissionAttempt] = useState<MissionAttempt | null>(null)
  const [startingRole, setStartingRole] = useState<Role | null>(null)
  const [missionNotice, setMissionNotice] = useState('')
  const [missionError, setMissionError] = useState('')
  const [error, setError] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [coupon, setCoupon] = useState<RewardCoupon | null>(null)
  const [notificationRetry, setNotificationRetry] = useState<{ squadId: string; role: Role; attemptId: string; properties: Record<string, unknown> } | null>(null)
  const [notificationBusy, setNotificationBusy] = useState(false)

  useEffect(() => {
    let active = true
    const boot = async () => {
      try {
        await lineAdapter.initialize()
        const session = await restoreAppSession(lineAdapter)
        if (!active) return
        if (session.consent.analyticsAllowed) await api.event('liff_opened', { properties: { deviceCategory: 'mobile' } }).catch(() => undefined)
        setUser(session.user)
        if (session.squad) {
          clearInviteFromAddress()
          setSquad(session.squad)
          setScreen('squad')
        } else if (!session.consent.requiredAccepted) {
          setScreen('consent')
        } else if (inviteToken) {
          const joined = await api.joinSquad(inviteToken)
          if (!active) return
          setSquad(joined)
          clearInviteFromAddress()
          setScreen('squad')
        } else {
          setScreen('lobby')
        }
      } catch (cause) {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) setScreen('intro')
        else { setError(thaiError(cause)); setScreen('error') }
      }
    }
    void boot()
    return () => { active = false }
  }, [inviteToken])

  const squadID = squad?.id
  useEffect(() => {
    if (!squadID || screen === 'mission') return
    const timer = window.setInterval(() => api.getSquad(squadID).then(setSquad).catch(() => undefined), 3000)
    return () => window.clearInterval(timer)
  }, [squadID, screen])

  const showError = (cause: unknown) => { setError(thaiError(cause)); setScreen('error') }
  const finishMission = async (squadId: string, role: Role, attemptId: string, properties: Record<string, unknown>) => {
    const result = await api.completeMission(squadId, role, attemptId, properties, lineAdapter.getIDToken())
    setSquad(result.squad)
    if (result.notification === 'accepted') {
      setMissionNotice('ภารกิจสำเร็จแล้ว! เช็กการ์ดสรุปในแชต LINE ของเรา แล้วชวนเพื่อนลุยต่อได้เลย')
      setNotificationRetry(null)
    } else if (result.notification && result.notification !== 'mock') {
      setMissionNotice('บันทึกภารกิจสำเร็จแล้ว แต่ยังส่งการ์ดเข้า LINE ไม่สำเร็จ เพิ่มเพื่อนบัญชีของแคมเปญแล้วลองส่งอีกครั้งได้เลย')
      setNotificationRetry({ squadId, role, attemptId, properties })
    } else {
      setMissionNotice('ภารกิจสำเร็จแล้ว! ชวนเพื่อนในทีมลุยภารกิจที่เหลือกันต่อเลย')
    }
  }
  const authenticateMock = async (mockUserId: string) => {
    try { const nextUser = await api.mockAuth(mockUserId); setUser(nextUser); setScreen('consent') }
    catch (cause) { showError(cause) }
  }
  const authenticateLine = async () => {
    try {
      const token = lineAdapter.getIDToken()
      if (!token) { lineAdapter.login(); return }
      const nextUser = await api.lineAuth(token)
      setUser(nextUser)
      setScreen('consent')
    } catch (cause) { showError(cause) }
  }
  const acceptConsent = async (analytics: boolean) => {
    try {
      await api.consent(true, analytics)
      if (inviteToken) {
        const joined = await api.joinSquad(inviteToken)
        setSquad(joined)
        clearInviteFromAddress()
        setScreen('squad')
      } else setScreen('lobby')
    } catch (cause) { showError(cause) }
  }

  if (screen === 'loading') return <Loading invited={Boolean(inviteToken)} />
  if (screen === 'error') return <ErrorScreen message={error} retry={() => window.location.reload()} />
  if (screen === 'intro') return <Intro invited={Boolean(inviteToken)} onMock={authenticateMock} onLine={authenticateLine} />
  if (!user) return <Loading invited={Boolean(inviteToken)} />
  if (screen === 'consent') return <ConsentScreen invited={Boolean(inviteToken)} onContinue={acceptConsent} />
  if (screen === 'lobby') return <Lobby user={user} onCreate={async (name) => { try { const result = await api.createSquad(name); setSquad(result.squad); setScreen('squad') } catch (cause) { showError(cause) } }} />
  if (screen === 'mission' && squad && missionRole && missionAttempt) return <MissionRunner role={missionRole} challenge={missionAttempt.challenge} expiresAt={missionAttempt.expiresAt} errorMessage={missionError} verifyReceipt={(file) => api.verifyReceipt(missionAttempt.id, file)} onFlavorVote={(matchId, winnerId, decisionMs) => api.flavorCupVote(squad.id, missionAttempt.id, matchId, winnerId, decisionMs)} track={(name, properties) => api.event(name, { squadId: squad.id, properties }).then(() => undefined).catch(() => undefined)} onBack={() => { setMissionAttempt(null); setMissionError(''); setScreen('squad') }} onComplete={async (properties) => { try { await finishMission(squad.id, missionRole, missionAttempt.id, properties); setMissionAttempt(null); setMissionError(''); setScreen('squad') } catch (cause) { if (cause instanceof ApiError && cause.code === 'attempt_invalid') { setMissionAttempt(null); setMissionError(''); setMissionNotice('รอบภารกิจหมดอายุหรือถูกแทนที่ กดเริ่มใหม่ได้เลย'); setScreen('squad') } else if (cause instanceof ApiError && cause.code === 'mission_not_complete') { setMissionError('คำตอบยังไม่ครบตามโจทย์ ลองตรวจอีกครั้ง') } else setMissionError(thaiError(cause)) } }} />
  if (squad) return <SquadScreen user={user} squad={squad} coupon={coupon} onCouponClose={() => setCoupon(null)} notificationRetry={Boolean(notificationRetry)} notificationBusy={notificationBusy} onRetryNotification={async () => { if (!notificationRetry || notificationBusy) return; setNotificationBusy(true); try { await finishMission(notificationRetry.squadId, notificationRetry.role, notificationRetry.attemptId, notificationRetry.properties) } catch { setMissionNotice('ภารกิจยังบันทึกไว้เรียบร้อยแล้ว กรุณาลองส่งการ์ดอีกครั้งภายหลัง') } finally { setNotificationBusy(false) } }} startingRole={startingRole} actionBusy={actionBusy} missionNotice={missionNotice} onRole={async (role) => { if (actionBusy) return; setActionBusy(true); try { setSquad(await api.claimRole(squad.id, role)); setMissionNotice('ล็อกภารกิจเรียบร้อย เริ่มลุยได้เลย!') } catch (cause) { setMissionNotice(thaiError(cause)) } finally { setActionBusy(false) } }} onMission={async (role) => { if (startingRole) return; setStartingRole(role); setMissionNotice(''); try { const attempt = await api.startMission(squad.id, role); setMissionRole(role); setMissionAttempt(attempt); setScreen('mission') } catch (cause) { setMissionNotice(thaiError(cause)) } finally { setStartingRole(null) } }} onRedeem={async () => { if (actionBusy) return; setActionBusy(true); try { if (!squad.rewardRedeemed) setSquad(await api.redeem(squad.id)); const details = await api.reward(squad.id); if (!details.coupon) throw new Error('Coupon unavailable'); setCoupon(details.coupon) } catch (cause) { setMissionNotice(thaiError(cause)) } finally { setActionBusy(false) } }} />
  return null
}

function Loading({ invited }: { invited: boolean }) {
  return <main className="grid min-h-screen place-items-center p-6"><div className="screen-enter text-center"><div className="logo-pulse mx-auto grid h-40 w-40 place-items-center rounded-full bg-white/55"><LaysLogo className="w-32" /></div><p className="mt-5 text-xl font-black">{invited ? 'กำลังพาคุณเข้าทีม…' : 'กำลังเตรียมความครันช์…'}</p><div className="mx-auto mt-4 flex w-fit gap-2" aria-hidden>{[0,1,2].map((item) => <span key={item} className="loading-dot h-2.5 w-2.5 rounded-full bg-crunch-red" style={{ animationDelay: `${item * 140}ms` }} />)}</div></div></main>
}

function Intro({ invited, onMock, onLine }: { invited: boolean; onMock: (id: string) => void; onLine: () => void }) {
  const mock = import.meta.env.VITE_MOCK_LIFF !== 'false'
  return <main className="screen-enter campaign-page"><BrandHeader label="4 FRIENDS. ONE SQUAD." /><section className="campaign-hero"><div className="hero-copy"><p className="eyebrow">THE MORE WE CRUNCH, THE MORE WE CONNECT.</p><h1>{invited ? 'เพื่อนชวนคุณเข้าทีม!' : <>รวมทีมให้ครบ<br /><em>ครันช์ให้สุด!</em></>}</h1><p>4 คน 4 ภารกิจที่ต่างกัน<br />รวมพลังแก๊งของคุณ เปิด Crunch Vault ไปด้วยกัน</p><div className="hero-facts"><span><b>04</b> เพื่อนร่วมทีม</span><span><b>04</b> ภารกิจ</span><span><b>01</b> เป้าหมายเดียว</span></div></div><div className="hero-art" aria-hidden="true"><div className="hero-orbit" /><span className="hero-word">CRUNCH<br />TOGETHER.</span><div className="hero-emblem"><img src="/brand/lays-logo.svg" alt="" /></div><span className="hero-sticker">SQUAD<br />MISSION</span><div className="hero-mini-icons">{roles.map(role => <span key={role.code}><MissionIcon kind={role.code} /></span>)}</div></div></section><section className="join-panel"><div><p className="eyebrow">YOUR SQUAD STARTS HERE</p><h2>{invited ? 'เข้าทีม แล้วเลือกภารกิจที่ใช่' : 'พร้อมรวมแก๊งแล้วหรือยัง?'}</h2><p>ความคืบหน้าผูกกับบัญชีของคุณ กลับมาเล่นต่อได้เสมอ</p></div>{mock ? <div className="test-access"><span className="test-label">บัญชีสำหรับทดสอบระบบ</span><div className="grid grid-cols-2 gap-2">{['mali','nok','beam','ploy'].map(id => <button key={id} onClick={() => onMock(id)} className="identity-button" aria-label={id}><span aria-hidden>{id[0].toUpperCase()}</span>{id}</button>)}</div></div> : <button onClick={onLine} className="line-button">เข้าร่วมด้วย LINE <span aria-hidden>→</span></button>}</section><section className="mission-preview" aria-label="รู้จักภารกิจ"><div className="section-title"><span className="eyebrow">FIND YOUR ROLE</span><h2>แต่ละคนถนัดต่างกัน<br />ความสนุกถึงลงตัว</h2></div><div className="preview-grid">{roles.map((role,index) => <article key={role.code}><span className="preview-index">0{index+1}</span><MissionIcon kind={role.code} /><h3>{role.title}</h3><p>{role.description}</p></article>)}</div></section><CampaignFooter /></main>
}

function ConsentScreen({ invited, onContinue }: { invited: boolean; onContinue: (analytics: boolean) => Promise<void> }) {
  const [required, setRequired] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [busy, setBusy] = useState(false)
  return <main className="screen-enter mx-auto min-h-screen max-w-lg px-5 py-8"><section className="interactive-card rounded-[2rem] bg-white p-6 shadow-pop">
    <BrandHeader label="YOUR PRIVACY" /><p className="mt-4 font-black uppercase tracking-[.18em] text-crunch-red">ความเป็นส่วนตัว</p><h1 className="mt-2 text-4xl font-black">ก่อนเริ่มความครันช์</h1>
    <p className="mt-3 text-crunch-ink/70">เราใช้ข้อมูลเท่าที่จำเป็นเพื่อจัดเก็บสมาชิก ความคืบหน้า และสิทธิ์รางวัลของทีม</p>
    <details className="privacy-details"><summary>เราใช้ข้อมูลของคุณอย่างไร?</summary><p>บัญชีใช้ระบุสมาชิกในทีมและบันทึกภารกิจ ระบบเก็บสถานะการร่วมทีม ความคืบหน้า และการรับสิทธิ์รางวัล เมื่อทำภารกิจสำเร็จ เราส่งการ์ดสรุปไปยังแชต LINE ของคุณผ่านบัญชีแคมเปญ การวิเคราะห์กิจกรรมเป็นตัวเลือก คุณปฏิเสธได้และยังเล่นครบทุกภารกิจได้ตามปกติ</p></details>
    <label className="mt-6 flex gap-3 rounded-2xl border-2 border-crunch-ink/10 p-4"><input aria-label="ยอมรับการใช้ข้อมูลที่จำเป็น" type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} /><span><strong>ยอมรับการใช้ข้อมูลที่จำเป็น</strong><small className="block">บัญชีแบบนามแฝง สถานะทีม ความปลอดภัย และรางวัล</small></span></label>
    <label className="mt-3 flex gap-3 rounded-2xl border-2 border-crunch-ink/10 p-4"><input aria-label="อนุญาตการวิเคราะห์กิจกรรม" type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} /><span><strong>อนุญาตการวิเคราะห์กิจกรรม (ไม่บังคับ)</strong><small className="block">ช่วยให้เราพัฒนาประสบการณ์ให้ดีขึ้น</small></span></label>
    <button disabled={!required || busy} onClick={async () => { setBusy(true); try { await onContinue(analytics) } finally { setBusy(false) } }} className="mt-6 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{busy ? 'กำลังเข้าร่วมทีม…' : invited ? 'ยืนยันและเข้าร่วมทีม' : 'ยืนยันและเริ่มเล่น'}</button>
  </section></main>
}

function Lobby({ user, onCreate }: { user: User; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState(`ทีมครันช์ของ ${user.displayName}`)
  const [busy, setBusy] = useState(false)
  return <main className="screen-enter mx-auto min-h-screen max-w-lg px-5 py-7"><header className="flex items-center justify-between"><div><p className="text-sm font-bold">พร้อมแล้วนะ {user.displayName}</p><h1 className="text-3xl font-black">ตั้งทีมของคุณ</h1></div><LaysLogo className="w-20" /></header>
    <section className="interactive-card mt-7 rounded-[2rem] bg-white p-5 shadow-pop"><h2 className="text-2xl font-black">ตั้งชื่อทีมให้จำง่าย</h2><p className="mt-2 text-crunch-ink/65">สร้างทีมแล้วกดชวนเพื่อน เลือกเพื่อนใน LINE และส่งการ์ดชวนมาลุยด้วยกัน</p><label className="mt-4 block font-bold">ชื่อทีม<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border-2 border-crunch-ink/20 px-3" /></label><button disabled={!name.trim() || busy} onClick={async () => { setBusy(true); try { await onCreate(name) } finally { setBusy(false) } }} className="mt-4 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{busy ? 'กำลังสร้างทีม…' : 'สร้างทีม'}</button></section>
  </main>
}

function SquadScreen({ user, squad, coupon, onCouponClose, notificationRetry, notificationBusy, onRetryNotification, startingRole, actionBusy, missionNotice, onRole, onMission, onRedeem }: { user: User; squad: Squad; coupon: RewardCoupon | null; onCouponClose: () => void; notificationRetry: boolean; notificationBusy: boolean; onRetryNotification: () => Promise<void>; startingRole: Role | null; actionBusy: boolean; missionNotice: string; onRole: (role: Role) => Promise<void>; onMission: (role: Role) => Promise<void>; onRedeem: () => Promise<void> }) {
  const current = squad.members.find((member) => member.userId === user.id)
  const claimed = new Set(squad.members.map((member) => member.role))
  const complete = squad.members.filter((member) => member.completed).length
  const progress = complete * 25
  return <main className="screen-enter squad-page mx-auto min-h-screen max-w-3xl px-5 py-7"><BrandHeader label="SQUAD HQ" />
    <header className="flex items-center justify-between gap-3"><div><p className="font-bold text-crunch-red">{squad.name}</p><h1 className="text-3xl font-black">{squad.rewardUnlocked ? 'ปลดล็อก Crunch Vault แล้ว!' : `ความครันช์ ${progress}%`}</h1></div><LaysLogo className="w-20 shrink-0" /></header>
    <BagProgress progress={progress} />
    <section className="crew-panel" aria-label="สมาชิกในทีม"><div className="flex items-center justify-between"><h2>ทีมของเรา</h2><span>{squad.members.length}/4 คน</span></div><div className="crew-grid">{Array.from({ length: 4 }, (_, index) => { const member = squad.members[index]; return <div key={member?.userId ?? index} className={member ? 'crew-member' : 'crew-member empty'}><span className="crew-avatar">{member?.displayName.slice(0,1) ?? '+'}{member?.completed && <i>✓</i>}</span><strong>{member?.displayName ?? 'รอเพื่อน'}</strong><small>{member ? member.userId === user.id ? 'คุณ' : member.completed ? 'เสร็จภารกิจ' : 'อยู่ในทีม' : 'ชวนเข้าทีม'}</small></div> })}</div></section>
    {current?.completed && !squad.rewardUnlocked && <section className="completion-note" role="status"><span>✓</span><div><h2>ภารกิจของคุณสำเร็จแล้ว!</h2><p>อีก {4 - complete} ภารกิจจะเปิด Crunch Vault ชวนเพื่อนในทีมลุยต่อได้เลย</p></div></section>}
    {!current?.role && <section className="mt-5 rounded-[2rem] bg-crunch-ink p-5 text-white"><p className="text-xs font-black uppercase tracking-[.18em] text-crunch-yellow">ขั้นตอนต่อไป</p><h2 className="mt-1 text-2xl font-black">เลือกและล็อกภารกิจของคุณ</h2><p className="mt-2 text-white/70">หนึ่งคนรับหนึ่งภารกิจ เลือกแล้วเปลี่ยนไม่ได้</p></section>}
    {missionNotice && <p role="status" className="mt-4 rounded-xl bg-white p-3 font-bold text-crunch-red">{missionNotice}</p>}
    {notificationRetry && <button disabled={notificationBusy} onClick={onRetryNotification} className="mt-3 min-h-12 w-full rounded-2xl bg-[#06C755] px-4 font-black text-white disabled:opacity-50">{notificationBusy ? 'กำลังส่งการ์ด…' : 'ส่งการ์ดสรุปเข้า LINE อีกครั้ง'}</button>}
    {squad.rewardUnlocked && <section className="vault-panel mt-5 rounded-[2rem] bg-crunch-ink p-6 text-center text-white"><span className="text-5xl" aria-hidden>✦</span><h2 className="mt-2 text-3xl font-black">Crunch Vault เปิดแล้ว!</h2><p className="mt-2">{squad.rewardRedeemed ? 'บันทึกการรับสิทธิ์ของทีมเรียบร้อยแล้ว' : 'ทีมของคุณทำครบทั้ง 4 ภารกิจแล้ว'}</p><button disabled={actionBusy} onClick={onRedeem} className="mt-4 min-h-12 rounded-2xl bg-crunch-yellow px-6 font-black text-crunch-ink disabled:opacity-50">{actionBusy ? 'กำลังโหลด…' : squad.rewardRedeemed ? 'ดูรหัสคูปอง' : 'รับสิทธิ์รางวัล'}</button></section>}
    {coupon && <CouponDialog coupon={coupon} onClose={onCouponClose} />}
    <section className="mt-5 grid gap-3" aria-label="ภารกิจของทีม">{roles.map((role) => {
      const member = squad.members.find((item) => item.role === role.code)
      const mine = current?.role === role.code
      return <article key={role.code} className={`interactive-card mission-card rounded-3xl bg-white p-4 shadow-pop ${mine ? 'ring-4 ring-crunch-red' : ''} ${member?.completed ? 'mission-done' : ''}`} style={{ animationDelay: `${roles.indexOf(role) * 80}ms` }}><div className="mission-card-top"><span>MISSION 0{roles.indexOf(role)+1}</span><span>{member?.completed ? 'สำเร็จแล้ว ✓' : mine ? 'ภารกิจของคุณ' : member ? 'มีผู้รับภารกิจแล้ว' : 'พร้อมให้เลือก'}</span></div><div className="flex gap-3"><span className="role-icon grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-crunch-yellow" aria-hidden><MissionIcon kind={role.code} /></span><div className="min-w-0 flex-1"><h2 className="text-xl font-black">{role.title}</h2><p className="text-sm text-crunch-ink/65">{member ? `${member.displayName} · ${member.completed ? 'สำเร็จแล้ว' : 'กำลังลุย'}` : role.description}</p></div></div>{mine && !member?.completed && <button disabled={startingRole !== null} onClick={() => onMission(role.code)} className="mt-3 min-h-12 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-60">{startingRole === role.code ? 'กำลังเตรียมโจทย์…' : 'เริ่มภารกิจของฉัน'}</button>}{!current?.role && !claimed.has(role.code) && <button disabled={actionBusy} onClick={() => onRole(role.code)} className="mt-3 min-h-12 w-full rounded-2xl bg-crunch-ink font-black text-white disabled:opacity-50">ล็อกภารกิจนี้</button>}</article>
    })}</section>
    {!squad.rewardUnlocked && squad.members.length < 4 && <SquadInvitation squad={squad} />}
    <CampaignFooter />
  </main>
}

function BagProgress({ progress }: { progress: number }) {
  const remaining = 4 - progress / 25
  return <div className="team-progress" aria-label={`ความคืบหน้าของทีม ${progress}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="flex items-center justify-between"><div><span className="eyebrow">ROAD TO CRUNCH VAULT</span><p>{progress === 100 ? 'ความครันช์เต็ม 100%!' : `เหลืออีก ${remaining} ภารกิจ`}</p></div><strong>{progress}<small>%</small></strong></div><div className="progress-segments">{[25,50,75,100].map(value => <span key={value} className={progress >= value ? 'filled' : ''} />)}</div></div>
}

function AdminDashboard() {
  const [token, setToken] = useState('')
  const [metrics, setMetrics] = useState<Dashboard | null>(null)
  const [busy, setBusy] = useState(false)
  const [updatedAt, setUpdatedAt] = useState('')
  const [error, setError] = useState('')
  const load = async () => { setBusy(true); try { setError(''); setMetrics(await api.adminMetrics(token)); setUpdatedAt(new Date().toLocaleTimeString('th-TH')) } catch (cause) { setError(thaiError(cause)) } finally { setBusy(false) } }
  const exportCSV = async () => { try { const blob = await api.exportAdminEvents(token); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'analytics-events.csv'; anchor.click(); URL.revokeObjectURL(url) } catch (cause) { setError(thaiError(cause)) } }
  return <main className="min-h-screen bg-[#f5f1e6] p-5 md:p-10"><div className="mx-auto max-w-6xl"><BrandHeader label="CAMPAIGN OPERATIONS" /><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-black uppercase tracking-[.18em] text-crunch-red">สำหรับผู้ดูแลระบบ</p><h1 className="text-4xl font-black">ภาพรวมแคมเปญ</h1></div><div className="admin-controls flex flex-wrap gap-2"><input type="password" aria-label="โทเคนผู้ดูแล" value={token} onChange={(event) => setToken(event.target.value)} placeholder="โทเคนผู้ดูแล" className="min-h-12 rounded-xl border px-3" /><button disabled={busy || !token.trim()} onClick={load} className="min-h-12 rounded-xl bg-crunch-ink px-5 font-bold text-white">{busy ? 'กำลังโหลด…' : 'โหลดข้อมูล'}</button></div></header>
    {error && <p role="alert" className="mt-6 rounded-xl bg-red-100 p-4 text-red-900">{error}</p>}{!metrics && !error && <p className="mt-10 rounded-2xl bg-white p-8 text-center">กรอกโทเคนเพื่อดูภาพรวม</p>}{metrics && <><p className="mt-5 text-xs text-crunch-ink/50">อัปเดตล่าสุด {updatedAt} · ข้อมูลตามความยินยอมของผู้เล่น</p><section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><Metric label="ผู้เล่น" value={metrics.uniquePlayers} /><Metric label="ทีม" value={metrics.squadsCreated} /><Metric label="สำเร็จ" value={metrics.completedSquads} /><Metric label="ปลดล็อก" value={metrics.rewardsUnlocked} /><Metric label="รับสิทธิ์" value={metrics.rewardsRedeemed} /></section><section className="mt-6 grid gap-6 lg:grid-cols-2"><DataCard title="เส้นทางผู้เล่น" values={metrics.eventsByName} /><DataCard title="ภารกิจที่สำเร็จ" values={metrics.completionsByRole} /><FlavorPerformanceCard values={metrics.flavorPerformance ?? []} /></section><button onClick={exportCSV} className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-crunch-red px-5 font-bold text-white">ดาวน์โหลด CSV</button></>}
  </div></main>
}

function metricLabel(key: string) {
  const labels: Record<string,string> = { authentication_completed:'เข้าสู่ระบบ', consent_updated:'บันทึกความยินยอม', liff_opened:'เปิดแอป', squad_created:'สร้างทีม', squad_joined:'เข้าร่วมทีม', squad_join_failed:'เข้าร่วมไม่สำเร็จ', role_selected:'เลือกภารกิจ', role_viewed:'ดูภารกิจ', mission_started:'เริ่มภารกิจ', mission_completed:'ภารกิจสำเร็จ', mission_failed:'ภารกิจยังไม่ผ่าน', squad_completed:'ทีมสำเร็จ', reward_unlocked:'ปลดล็อกรางวัล', reward_redeemed:'รับสิทธิ์รางวัล', reward_viewed:'ดูรางวัล', share_initiated:'เริ่มแชร์คำเชิญ', share_completed:'แชร์คำเชิญสำเร็จ', crunch_hunt_started:'Crunch Hunt · เริ่มเล่น', crunch_hunt_tap:'Crunch Hunt · แตะภาพ', crunch_hunt_difference_found:'Crunch Hunt · พบจุดต่าง', crunch_hunt_hint_used:'Crunch Hunt · ใช้คำใบ้', crunch_hunt_restarted:'Crunch Hunt · เริ่มใหม่', crunch_hunt_timed_out:'Crunch Hunt · หมดเวลา', crunch_hunt_completed:'Crunch Hunt · สำเร็จ', flavor_cup_started:'Flavor Cup · เริ่มเล่น', flavor_cup_resumed:'Flavor Cup · กลับมาเล่นต่อ', flavor_cup_matchup_selected:'Flavor Cup · เลือกผู้ชนะ', flavor_cup_completed:'Flavor Cup · ได้แชมป์', flavor_cup_result_shared:'Flavor Cup · แชร์แชมป์' }
  return labels[key] ?? roles.find(role => role.code === key)?.title ?? key.replaceAll('_',' ')
}
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border border-crunch-ink/5 bg-white p-5"><p className="text-sm font-bold text-crunch-ink/55">{label}</p><strong className="mt-2 block text-4xl">{value.toLocaleString('th-TH')}</strong></div> }
function DataCard({ title, values }: { title: string; values: Record<string, number> }) { const entries = Object.entries(values); return <section className="rounded-2xl bg-white p-5"><h2 className="text-xl font-black">{title}</h2>{entries.length ? <dl className="mt-4 divide-y">{entries.map(([key, value]) => <div key={key} className="flex justify-between py-2"><dt>{metricLabel(key)}</dt><dd className="font-black">{value}</dd></div>)}</dl> : <p className="mt-4 text-crunch-ink/55">ยังไม่มีข้อมูล</p>}</section> }
function FlavorPerformanceCard({ values }: { values: Dashboard['flavorPerformance'] }) { return <section className="rounded-2xl bg-white p-5 lg:col-span-2"><h2 className="text-xl font-black">Flavor Cup: อัตราชนะและจำนวนครั้งที่ปรากฏ</h2><p className="mt-1 text-sm text-crunch-ink/55">อัตราชนะจากจำนวนครั้งที่ถูกเลือกเทียบกับจำนวนครั้งที่ปรากฏในคู่แข่งขัน</p>{values.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="py-2">รสชาติ</th><th>ครั้งที่ปรากฏ</th><th>ชนะ</th><th>อัตราชนะ</th><th>แชมป์</th></tr></thead><tbody>{values.map((value) => <tr key={value.flavorId} className="border-t"><td className="py-2 font-bold">{value.flavorId}</td><td>{value.exposureCount}</td><td>{value.winCount}</td><td>{Math.round(value.winRate * 100)}%</td><td>{value.championCount}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-crunch-ink/55">ยังไม่มีข้อมูลการแข่งขัน</p>}</section> }
function ErrorScreen({ message, retry }: { message: string; retry: () => void }) { return <main className="grid min-h-screen place-items-center p-6"><section className="max-w-sm rounded-3xl bg-white p-6 text-center shadow-pop"><LaysLogo className="mx-auto w-24" /><h1 className="mt-3 text-3xl font-black">ความครันช์สะดุดชั่วคราว</h1><p role="alert" className="mt-3">{message}</p><button onClick={retry} className="mt-5 min-h-12 rounded-xl bg-crunch-red px-5 font-bold text-white">ลองอีกครั้ง</button></section></main> }
function LaysLogo({ className = '' }: { className?: string }) { return <img src="/brand/lays-logo.svg" alt="Lay's" className={className} /> }
