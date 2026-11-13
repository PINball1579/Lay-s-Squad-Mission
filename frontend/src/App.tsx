import { useEffect, useState } from 'react'
import { api, ApiError } from './lib/api'
import { lineAdapter, shareOrCopy } from './lib/liff'
import { MissionRunner } from './components/Missions'
import { roles, type Dashboard, type Invitation, type MissionAttempt, type Role, type Squad, type User } from './types'

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
  return cause instanceof Error ? cause.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
}

function clearInviteFromAddress() {
  const next = new URL(window.location.href)
  next.searchParams.delete('invite')
  window.history.replaceState({}, '', `${next.pathname}${next.search}${next.hash}`)
}

export default function App() {
  if (window.location.pathname.startsWith('/admin')) return <AdminDashboard />
  return <PlayerApp />
}

function PlayerApp() {
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite') ?? '')
  const [screen, setScreen] = useState<Screen>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [squad, setSquad] = useState<Squad | null>(null)
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [shareNotice, setShareNotice] = useState('')
  const [missionRole, setMissionRole] = useState<Role | null>(null)
  const [missionAttempt, setMissionAttempt] = useState<MissionAttempt | null>(null)
  const [startingRole, setStartingRole] = useState<Role | null>(null)
  const [missionNotice, setMissionNotice] = useState('')
  const [missionError, setMissionError] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const boot = async () => {
      try {
        await lineAdapter.initialize()
        const session = await api.me()
        if (!active) return
        if (session.consent.analyticsAllowed) await api.event('liff_opened', { properties: { deviceCategory: 'mobile' } }).catch(() => undefined)
        setUser(session.user)
        if (session.squad) {
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
  if (screen === 'lobby') return <Lobby user={user} onCreate={async (name) => { try { const result = await api.createSquad(name); setSquad(result.squad); setInvitation(result.invitation); setScreen('squad') } catch (cause) { showError(cause) } }} />
  if (screen === 'mission' && squad && missionRole && missionAttempt) return <MissionRunner role={missionRole} challenge={missionAttempt.challenge} expiresAt={missionAttempt.expiresAt} errorMessage={missionError} line={lineAdapter} validateQR={(token) => api.validateQR(token, missionAttempt.id)} onFlavorVote={(matchId, winnerId, decisionMs) => api.flavorCupVote(squad.id, missionAttempt.id, matchId, winnerId, decisionMs)} track={(name, properties) => api.event(name, { squadId: squad.id, properties }).then(() => undefined).catch(() => undefined)} onBack={() => { setMissionAttempt(null); setMissionError(''); setScreen('squad') }} onComplete={async (properties) => { try { const result = await api.completeMission(squad.id, missionRole, missionAttempt.id, properties); setSquad(result.squad); setMissionAttempt(null); setMissionError(''); setScreen('squad') } catch (cause) { if (cause instanceof ApiError && cause.code === 'attempt_invalid') { setMissionAttempt(null); setMissionError(''); setMissionNotice('รอบภารกิจหมดอายุหรือถูกแทนที่ กดเริ่มใหม่ได้เลย'); setScreen('squad') } else if (cause instanceof ApiError && cause.code === 'mission_not_complete') { setMissionError('คำตอบยังไม่ครบตามโจทย์ ลองตรวจอีกครั้ง') } else showError(cause) } }} />
  if (squad) return <SquadScreen user={user} squad={squad} invitation={invitation} shareNotice={shareNotice} startingRole={startingRole} missionNotice={missionNotice} onRole={async (role) => { try { setSquad(await api.claimRole(squad.id, role)) } catch (cause) { if (cause instanceof ApiError && cause.code === 'role_taken') setMissionNotice(errorMessages.role_taken); else showError(cause) } }} onMission={async (role) => { if (startingRole) return; setStartingRole(role); setMissionNotice(''); try { const attempt = await api.startMission(squad.id, role); setMissionRole(role); setMissionAttempt(attempt); setScreen('mission') } catch (cause) { showError(cause) } finally { setStartingRole(null) } }} onInvite={async () => { try { setShareNotice(''); setInvitation(await api.invite(squad.id)) } catch (cause) { showError(cause) } }} onShare={async (next) => { try { const url = `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(next.token)}`; await api.event('share_initiated', { squadId: squad.id }); const result = await shareOrCopy(lineAdapter, { url, squadName: squad.name, expiresLabel: `ลิงก์หมดอายุ ${new Date(next.expiresAt).toLocaleString('th-TH')}` }); setShareNotice(result === 'line' ? 'ส่งการ์ดเชิญแล้ว' : 'คัดลอกลิงก์เชิญแล้ว'); await api.event('share_completed', { squadId: squad.id, properties: { result } }) } catch (cause) { showError(cause) } }} onRedeem={async () => { try { setSquad(await api.redeem(squad.id)) } catch (cause) { showError(cause) } }} />
  return null
}

function Loading({ invited }: { invited: boolean }) {
  return <main className="grid min-h-screen place-items-center p-6"><div className="text-center"><LaysLogo className="mx-auto w-32" /><p className="mt-5 text-xl font-black">{invited ? 'กำลังพาคุณเข้าทีม…' : 'กำลังเตรียมความครันช์…'}</p></div></main>
}

function Intro({ invited, onMock, onLine }: { invited: boolean; onMock: (id: string) => void; onLine: () => void }) {
  const mock = import.meta.env.VITE_MOCK_LIFF !== 'false'
  return <main className="relative mx-auto min-h-screen max-w-lg overflow-hidden px-5 py-6">
    <FloatingChips />
    <div className="relative overflow-hidden rounded-[2.5rem] bg-white/95 shadow-pop">
      <div className="relative h-52 overflow-hidden"><img src="/brand/lays-classic.jpg" alt="มันฝรั่งทอดกรอบ" className="h-full w-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" /><LaysLogo className="absolute bottom-3 left-5 w-28 drop-shadow-lg" /></div>
      <div className="p-6">
        <p className="font-black uppercase tracking-[.2em] text-crunch-red">LAY'S CRUNCH SQUAD</p>
        <h1 className="mt-2 text-4xl font-black leading-tight text-crunch-ink">{invited ? 'เพื่อนชวนคุณเข้าทีม!' : 'รวมทีมให้ครบ รับความครันช์ให้เต็มคำ'}</h1>
        <p className="mt-3 text-lg text-crunch-ink/70">4 คน · 4 ภารกิจ · ปลดล็อกรางวัลพิเศษไปด้วยกัน</p>
        {mock ? <div className="mt-6"><p className="mb-3 font-black">{invited ? 'เลือกชื่อเพื่อเข้าร่วมทีม' : 'เลือกผู้เล่น'}</p><div className="grid grid-cols-2 gap-3">{['mali','nok','beam','ploy'].map((id) => <button key={id} onClick={() => onMock(id)} className="min-h-14 rounded-2xl bg-crunch-red px-4 font-black capitalize text-white shadow-sm">{id}</button>)}</div><p className="mt-3 text-center text-xs text-crunch-ink/50">โหมดทดสอบภายในเครื่อง</p></div> : <button onClick={onLine} className="mt-6 min-h-14 w-full rounded-2xl bg-[#06c755] font-black text-white">เข้าร่วมด้วย LINE</button>}
      </div>
    </div>
    <PhotoCredit />
  </main>
}

function ConsentScreen({ invited, onContinue }: { invited: boolean; onContinue: (analytics: boolean) => Promise<void> }) {
  const [required, setRequired] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [busy, setBusy] = useState(false)
  return <main className="mx-auto min-h-screen max-w-lg px-5 py-8"><section className="rounded-[2rem] bg-white p-6 shadow-pop">
    <LaysLogo className="w-24" /><p className="mt-4 font-black uppercase tracking-[.18em] text-crunch-red">ความเป็นส่วนตัว</p><h1 className="mt-2 text-4xl font-black">ก่อนเริ่มความครันช์</h1>
    <p className="mt-3 text-crunch-ink/70">เราใช้ข้อมูลเท่าที่จำเป็นเพื่อจัดเก็บสมาชิก ความคืบหน้า และสิทธิ์รางวัลของทีม</p>
    <label className="mt-6 flex gap-3 rounded-2xl border-2 border-crunch-ink/10 p-4"><input aria-label="ยอมรับการใช้ข้อมูลที่จำเป็น" type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} /><span><strong>ยอมรับการใช้ข้อมูลที่จำเป็น</strong><small className="block">บัญชีแบบนามแฝง สถานะทีม ความปลอดภัย และรางวัล</small></span></label>
    <label className="mt-3 flex gap-3 rounded-2xl border-2 border-crunch-ink/10 p-4"><input aria-label="อนุญาตการวิเคราะห์กิจกรรม" type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} /><span><strong>อนุญาตการวิเคราะห์กิจกรรม (ไม่บังคับ)</strong><small className="block">ช่วยให้เราพัฒนาประสบการณ์ให้ดีขึ้น</small></span></label>
    <button disabled={!required || busy} onClick={async () => { setBusy(true); try { await onContinue(analytics) } finally { setBusy(false) } }} className="mt-6 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{busy ? 'กำลังเข้าร่วมทีม…' : invited ? 'ยืนยันและเข้าร่วมทีม' : 'ยืนยันและเริ่มเล่น'}</button>
  </section></main>
}

function Lobby({ user, onCreate }: { user: User; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState(`ทีมครันช์ของ ${user.displayName}`)
  const [busy, setBusy] = useState(false)
  return <main className="mx-auto min-h-screen max-w-lg px-5 py-7"><header className="flex items-center justify-between"><div><p className="text-sm font-bold">พร้อมแล้วนะ {user.displayName}</p><h1 className="text-3xl font-black">ตั้งทีมของคุณ</h1></div><LaysLogo className="w-20" /></header>
    <section className="mt-7 rounded-[2rem] bg-white p-5 shadow-pop"><h2 className="text-2xl font-black">ตั้งชื่อทีมให้จำง่าย</h2><p className="mt-2 text-crunch-ink/65">หลังจากสร้างทีม คุณจะได้การ์ดเชิญไปชวนเพื่อน</p><label className="mt-4 block font-bold">ชื่อทีม<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border-2 border-crunch-ink/20 px-3" /></label><button disabled={!name.trim() || busy} onClick={async () => { setBusy(true); try { await onCreate(name) } finally { setBusy(false) } }} className="mt-4 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{busy ? 'กำลังสร้างทีม…' : 'สร้างทีม'}</button></section>
  </main>
}

function SquadScreen({ user, squad, invitation, shareNotice, startingRole, missionNotice, onRole, onMission, onInvite, onShare, onRedeem }: { user: User; squad: Squad; invitation: Invitation | null; shareNotice: string; startingRole: Role | null; missionNotice: string; onRole: (role: Role) => Promise<void>; onMission: (role: Role) => Promise<void>; onInvite: () => Promise<void>; onShare: (invitation: Invitation) => Promise<void>; onRedeem: () => Promise<void> }) {
  const current = squad.members.find((member) => member.userId === user.id)
  const claimed = new Set(squad.members.map((member) => member.role))
  const complete = squad.members.filter((member) => member.completed).length
  const progress = complete * 25
  return <main className="mx-auto min-h-screen max-w-lg px-5 py-7">
    <header className="flex items-center justify-between gap-3"><div><p className="font-bold text-crunch-red">{squad.name}</p><h1 className="text-3xl font-black">{squad.rewardUnlocked ? 'ปลดล็อก Crunch Vault แล้ว!' : `ความครันช์ ${progress}%`}</h1></div><LaysLogo className="w-20 shrink-0" /></header>
    <BagProgress progress={progress} />
    {!current?.role && <section className="mt-5 rounded-[2rem] bg-crunch-ink p-5 text-white"><p className="text-xs font-black uppercase tracking-[.18em] text-crunch-yellow">ขั้นตอนต่อไป</p><h2 className="mt-1 text-2xl font-black">เลือกและล็อกภารกิจของคุณ</h2><p className="mt-2 text-white/70">หนึ่งคนรับหนึ่งภารกิจ เลือกแล้วเปลี่ยนไม่ได้</p></section>}
    {missionNotice && <p role="status" className="mt-4 rounded-xl bg-white p-3 font-bold text-crunch-red">{missionNotice}</p>}
    {squad.rewardUnlocked && <section className="mt-5 rounded-[2rem] bg-crunch-ink p-6 text-center text-white"><span className="text-5xl" aria-hidden>✦</span><h2 className="mt-2 text-3xl font-black">Crunch Vault เปิดแล้ว!</h2><p className="mt-2">สิทธิ์รางวัลพิเศษของทีมรอคุณอยู่</p><button disabled={squad.rewardRedeemed} onClick={onRedeem} className="mt-4 min-h-12 rounded-2xl bg-crunch-yellow px-6 font-black text-crunch-ink disabled:opacity-50">{squad.rewardRedeemed ? 'รับสิทธิ์แล้ว' : 'รับสิทธิ์รางวัล'}</button></section>}
    <section className="mt-5 grid gap-3" aria-label="ภารกิจของทีม">{roles.map((role) => {
      const member = squad.members.find((item) => item.role === role.code)
      const mine = current?.role === role.code
      return <article key={role.code} className={`rounded-3xl bg-white p-4 shadow-pop ${mine ? 'ring-4 ring-crunch-red' : ''}`}><div className="flex gap-3"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-crunch-yellow text-2xl font-black" aria-hidden>{role.icon}</span><div className="min-w-0 flex-1"><h2 className="text-xl font-black">{role.title}</h2><p className="text-sm text-crunch-ink/65">{member ? `${member.displayName} · ${member.completed ? 'สำเร็จแล้ว' : 'กำลังลุย'}` : role.description}</p></div></div>{mine && !member?.completed && <button disabled={startingRole !== null} onClick={() => onMission(role.code)} className="mt-3 min-h-12 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-60">{startingRole === role.code ? 'กำลังเตรียมโจทย์…' : 'เริ่มภารกิจของฉัน'}</button>}{!current?.role && !claimed.has(role.code) && <button onClick={() => onRole(role.code)} className="mt-3 min-h-12 w-full rounded-2xl bg-crunch-ink font-black text-white">ล็อกภารกิจนี้</button>}</article>
    })}</section>
    {!squad.rewardUnlocked && squad.members.length < 4 && <button onClick={onInvite} className="mt-5 min-h-14 w-full rounded-2xl bg-crunch-yellow font-black text-crunch-ink shadow-pop">สร้างการ์ดเชิญเพื่อน</button>}
    {invitation && <InviteCard squad={squad} invitation={invitation} notice={shareNotice} onShare={() => onShare(invitation)} />}
  </main>
}

function InviteCard({ squad, invitation, notice, onShare }: { squad: Squad; invitation: Invitation; notice: string; onShare: () => void }) {
  const remaining = Math.max(0, 4 - squad.members.length)
  return <section className="mt-5 overflow-hidden rounded-[2rem] bg-white shadow-pop" aria-label="การ์ดเชิญเข้าร่วมทีม">
    <div className="relative h-36 overflow-hidden"><img src="/brand/lays-classic.jpg" alt="" className="h-full w-full object-cover" /><div className="absolute inset-0 bg-gradient-to-r from-black/60 to-black/10" /><LaysLogo className="absolute left-4 top-4 w-24" /><p className="absolute bottom-4 left-4 font-black text-white">LAY'S CRUNCH SQUAD</p></div>
    <div className="p-5"><p className="text-sm font-black text-crunch-red">คำเชิญจากทีม</p><h2 className="mt-1 text-2xl font-black">{squad.name}</h2><p className="mt-2 text-crunch-ink/65">เหลือที่ว่างอีก {remaining} คน · กดลิงก์แล้วเข้าทีมได้ทันที</p><p className="mt-2 text-xs text-crunch-ink/50">หมดอายุ {new Date(invitation.expiresAt).toLocaleString('th-TH')}</p><button onClick={onShare} className="mt-4 min-h-14 w-full rounded-2xl bg-[#06c755] font-black text-white">ส่งการ์ดเชิญ / คัดลอกลิงก์</button>{notice && <p role="status" className="mt-3 text-center font-bold text-[#07883d]">{notice}</p>}</div>
  </section>
}

function BagProgress({ progress }: { progress: number }) {
  const remaining = 4 - progress / 25
  return <div className="mt-6" aria-label={`ความคืบหน้าของทีม ${progress}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="relative h-20 overflow-hidden rounded-b-[2rem] rounded-t-lg border-4 border-crunch-ink bg-white"><div className="absolute inset-x-0 bottom-0 bg-crunch-yellow transition-all duration-500 motion-reduce:transition-none" style={{ height: `${progress}%` }} /><div className="absolute inset-0 grid grid-cols-4">{[1,2,3,4].map((part) => <span key={part} className="border-r border-crunch-ink/20 last:border-0" />)}</div></div><p className="mt-2 text-center font-black">{progress === 100 ? 'ความครันช์เต็ม 100%!' : `เหลืออีก ${remaining} ภารกิจ`}</p></div>
}

function AdminDashboard() {
  const [token, setToken] = useState('')
  const [metrics, setMetrics] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  const load = async () => { try { setError(''); setMetrics(await api.adminMetrics(token)) } catch (cause) { setError(thaiError(cause)) } }
  const exportCSV = async () => { try { const blob = await api.exportAdminEvents(token); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'analytics-events.csv'; anchor.click(); URL.revokeObjectURL(url) } catch (cause) { setError(thaiError(cause)) } }
  return <main className="min-h-screen bg-[#f5f1e6] p-5 md:p-10"><div className="mx-auto max-w-6xl"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-black uppercase tracking-[.18em] text-crunch-red">สำหรับผู้ดูแลระบบ</p><h1 className="text-4xl font-black">ภาพรวมแคมเปญ</h1></div><div className="flex gap-2"><input type="password" aria-label="โทเคนผู้ดูแล" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Admin token" className="min-h-12 rounded-xl border px-3" /><button onClick={load} className="min-h-12 rounded-xl bg-crunch-ink px-5 font-bold text-white">โหลดข้อมูล</button></div></header>
    {error && <p role="alert" className="mt-6 rounded-xl bg-red-100 p-4 text-red-900">{error}</p>}{!metrics && !error && <p className="mt-10 rounded-2xl bg-white p-8 text-center">กรอกโทเคนเพื่อดูภาพรวม</p>}{metrics && <><section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><Metric label="ผู้เล่น" value={metrics.uniquePlayers} /><Metric label="ทีม" value={metrics.squadsCreated} /><Metric label="สำเร็จ" value={metrics.completedSquads} /><Metric label="ปลดล็อก" value={metrics.rewardsUnlocked} /><Metric label="รับสิทธิ์" value={metrics.rewardsRedeemed} /></section><section className="mt-6 grid gap-6 lg:grid-cols-2"><DataCard title="เส้นทางผู้เล่น" values={metrics.eventsByName} /><DataCard title="ภารกิจที่สำเร็จ" values={metrics.completionsByRole} /><FlavorPerformanceCard values={metrics.flavorPerformance ?? []} /></section><button onClick={exportCSV} className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-crunch-red px-5 font-bold text-white">ดาวน์โหลด CSV</button></>}
  </div></main>
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl bg-white p-5"><p className="text-sm font-bold text-crunch-ink/55">{label}</p><strong className="text-4xl">{value}</strong></div> }
function DataCard({ title, values }: { title: string; values: Record<string, number> }) { const entries = Object.entries(values); return <section className="rounded-2xl bg-white p-5"><h2 className="text-xl font-black">{title}</h2>{entries.length ? <dl className="mt-4 divide-y">{entries.map(([key, value]) => <div key={key} className="flex justify-between py-2"><dt>{key.replaceAll('_',' ')}</dt><dd className="font-black">{value}</dd></div>)}</dl> : <p className="mt-4 text-crunch-ink/55">ยังไม่มีข้อมูล</p>}</section> }
function FlavorPerformanceCard({ values }: { values: Dashboard['flavorPerformance'] }) { return <section className="rounded-2xl bg-white p-5 lg:col-span-2"><h2 className="text-xl font-black">Flavor Cup: อัตราชนะและจำนวนครั้งที่ปรากฏ</h2><p className="mt-1 text-sm text-crunch-ink/55">แสดง exposure ควบคู่ win rate เพื่อเปรียบเทียบอย่างเป็นธรรม</p>{values.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="py-2">รสชาติ</th><th>Exposure</th><th>ชนะ</th><th>Win rate</th><th>แชมป์</th></tr></thead><tbody>{values.map((value) => <tr key={value.flavorId} className="border-t"><td className="py-2 font-bold">{value.flavorId}</td><td>{value.exposureCount}</td><td>{value.winCount}</td><td>{Math.round(value.winRate * 100)}%</td><td>{value.championCount}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-crunch-ink/55">ยังไม่มีข้อมูลการแข่งขัน</p>}</section> }
function ErrorScreen({ message, retry }: { message: string; retry: () => void }) { return <main className="grid min-h-screen place-items-center p-6"><section className="max-w-sm rounded-3xl bg-white p-6 text-center shadow-pop"><LaysLogo className="mx-auto w-24" /><h1 className="mt-3 text-3xl font-black">ความครันช์สะดุดชั่วคราว</h1><p role="alert" className="mt-3">{message}</p><button onClick={retry} className="mt-5 min-h-12 rounded-xl bg-crunch-red px-5 font-bold text-white">ลองอีกครั้ง</button></section></main> }
function LaysLogo({ className = '' }: { className?: string }) { return <img src="/brand/lays-logo.svg" alt="Lay's" className={className} /> }
function FloatingChips() { return <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden"><span className="absolute left-2 top-16 h-16 w-12 -rotate-12 rounded-[45%] bg-crunch-orange/50" /><span className="absolute bottom-20 right-0 h-24 w-16 rotate-12 rounded-[45%] bg-crunch-red/30" /></div> }
function PhotoCredit() { return <p className="mt-5 text-center text-[10px] text-crunch-ink/45">ภาพมันฝรั่งทอด: <a className="underline" href="https://commons.wikimedia.org/wiki/File:2019-04-01_23_16_02_Lay%27s_Classic_Potato_Chips_in_the_Dulles_section_of_Sterling,_Loudoun_County,_Virginia.jpg">Famartin / CC BY-SA 4.0</a></p> }
