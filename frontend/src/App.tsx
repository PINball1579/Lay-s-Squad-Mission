import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from './lib/api'
import { lineAdapter, shareOrCopy } from './lib/liff'
import { MissionRunner } from './components/Missions'
import { roles, type Dashboard, type Invitation, type MissionAttempt, type Role, type Squad, type User } from './types'

type Screen = 'loading' | 'intro' | 'consent' | 'lobby' | 'squad' | 'mission' | 'error'

export default function App() {
  if (window.location.pathname.startsWith('/admin')) return <AdminDashboard />
  return <PlayerApp />
}

function PlayerApp() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [squad, setSquad] = useState<Squad | null>(null)
  const [invitation, setInvitation] = useState<Invitation | null>(null)
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
        if (session.squad) setSquad(session.squad)
        setScreen(session.consent.requiredAccepted ? (session.squad ? 'squad' : 'lobby') : 'consent')
      } catch (cause) {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) setScreen('intro')
        else { setError(cause instanceof Error ? cause.message : 'Unable to open the campaign'); setScreen('error') }
      }
    }
    void boot()
    return () => { active = false }
  }, [])

  const squadID = squad?.id
  useEffect(() => {
    if (!squadID || screen === 'mission') return
    const timer = window.setInterval(() => api.getSquad(squadID).then(setSquad).catch(() => undefined), 3000)
    return () => window.clearInterval(timer)
  }, [squadID, screen])

  const authenticateMock = async (mockUserId: string) => {
    try { const nextUser = await api.mockAuth(mockUserId); setUser(nextUser); setScreen('consent') }
    catch (cause) { showError(cause) }
  }
  const authenticateLine = async () => {
    try {
      const token = lineAdapter.getIDToken()
      if (!token) { lineAdapter.login(); return }
      const nextUser = await api.lineAuth(token)
      setUser(nextUser); setScreen('consent')
    } catch (cause) { showError(cause) }
  }
  const showError = (cause: unknown) => {
    setError(cause instanceof Error ? cause.message : 'Something went wrong')
    setScreen('error')
  }

  if (screen === 'loading') return <Loading />
  if (screen === 'error') return <ErrorScreen message={error} retry={() => window.location.reload()} />
  if (screen === 'intro') return <Intro onMock={authenticateMock} onLine={authenticateLine} />
  if (!user) return <Loading />
  if (screen === 'consent') return <ConsentScreen onContinue={async (analytics) => { await api.consent(true, analytics); setScreen('lobby') }} />
  if (screen === 'lobby') return <Lobby user={user} onCreate={async (name) => { try { const result = await api.createSquad(name); setSquad(result.squad); setInvitation(result.invitation); setScreen('squad') } catch (cause) { showError(cause) } }} onJoin={async (token) => { try { setSquad(await api.joinSquad(token)); setScreen('squad') } catch (cause) { showError(cause) } }} />
  if (screen === 'mission' && squad && missionRole && missionAttempt) return <MissionRunner role={missionRole} challenge={missionAttempt.challenge} expiresAt={missionAttempt.expiresAt} errorMessage={missionError} line={lineAdapter} validateQR={(token) => api.validateQR(token, missionAttempt.id)} onBack={() => { setMissionAttempt(null); setMissionError(''); setScreen('squad') }} onComplete={async (properties) => { try { const result = await api.completeMission(squad.id, missionRole, missionAttempt.id, properties); setSquad(result.squad); setMissionAttempt(null); setMissionError(''); setScreen('squad') } catch (cause) { if (cause instanceof ApiError && cause.code === 'attempt_invalid') { setMissionAttempt(null); setMissionError(''); setMissionNotice('That attempt expired or was replaced. Start the mission again.'); setScreen('squad') } else if (cause instanceof ApiError && cause.code === 'mission_not_complete') { setMissionError('That response did not satisfy this challenge. Check your choices and try again.') } else showError(cause) } }} />
  if (squad) return <SquadScreen user={user} squad={squad} invitation={invitation} startingRole={startingRole} missionNotice={missionNotice} onRole={async (role) => { try { setSquad(await api.claimRole(squad.id, role)) } catch (cause) { showError(cause) } }} onMission={async (role) => { if (startingRole) return; setStartingRole(role); setMissionNotice(''); try { const attempt = await api.startMission(squad.id, role); setMissionRole(role); setMissionAttempt(attempt); setScreen('mission') } catch (cause) { showError(cause) } finally { setStartingRole(null) } }} onInvite={async () => { try { const next = await api.invite(squad.id); setInvitation(next); const url = `${window.location.origin}?invite=${encodeURIComponent(next.token)}`; await api.event('share_initiated', { squadId: squad.id }); await shareOrCopy(lineAdapter, 'Join my Crunch Squad!', url); await api.event('share_completed', { squadId: squad.id }) } catch (cause) { showError(cause) } }} onRedeem={async () => { try { setSquad(await api.redeem(squad.id)) } catch (cause) { showError(cause) } }} />
  return <Lobby user={user} onCreate={() => Promise.resolve()} onJoin={() => Promise.resolve()} />
}

function Loading() {
  return <main className="grid min-h-screen place-items-center p-6"><div className="text-center"><ChipMark /><p className="mt-5 text-xl font-black">Warming up the crunch…</p></div></main>
}

function Intro({ onMock, onLine }: { onMock: (id: string) => void; onLine: () => void }) {
  const mock = import.meta.env.VITE_MOCK_LIFF !== 'false'
  return <main className="relative mx-auto min-h-screen max-w-lg overflow-hidden px-5 py-8">
    <FloatingChips />
    <div className="relative rounded-[2.5rem] bg-white/90 p-6 shadow-pop">
      <p className="rounded-full bg-crunch-ink px-3 py-1 text-center text-xs font-black text-white">UNOFFICIAL CAMPAIGN DEMO · PLACEHOLDER ART</p>
      <div className="my-7 flex justify-center"><ChipMark /></div>
      <p className="font-black uppercase tracking-[.22em] text-crunch-red">Lay's Crunch Squad</p>
      <h1 className="mt-2 text-5xl font-black leading-[.95] text-crunch-ink">Build your squad.<br />Complete the crunch.</h1>
      <p className="mt-5 text-lg text-crunch-ink/75">Four friends. Four missions. One Crunch Vault.</p>
      <div className="mt-7 rounded-2xl bg-crunch-cream p-4 text-sm"><strong>Before you play</strong><p className="mt-1">This age-neutral demo uses mock rewards and no official brand assets. Read the privacy notice before continuing.</p></div>
      {mock ? <div className="mt-6"><p className="mb-2 font-black">Choose a mock LINE player</p><div className="grid grid-cols-2 gap-3">{['mali','nok','beam','ploy'].map((id) => <button key={id} onClick={() => onMock(id)} className="min-h-14 rounded-2xl bg-crunch-red px-4 font-black capitalize text-white">{id}</button>)}</div></div> : <button onClick={onLine} className="mt-6 min-h-14 w-full rounded-2xl bg-[#06c755] font-black text-white">Continue with LINE</button>}
    </div>
  </main>
}

function ConsentScreen({ onContinue }: { onContinue: (analytics: boolean) => Promise<void> }) {
  const [required, setRequired] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [busy, setBusy] = useState(false)
  return <main className="mx-auto min-h-screen max-w-lg px-5 py-8"><section className="rounded-[2rem] bg-white p-6 shadow-pop">
    <p className="font-black uppercase tracking-[.18em] text-crunch-red">Your choice</p><h1 className="mt-2 text-4xl font-black">Privacy before play</h1>
    <p className="mt-3 text-crunch-ink/70">Required account data keeps your squad and reward state working. Optional analytics helps evaluate observed game behavior.</p>
    <label className="mt-6 flex gap-3 rounded-2xl border-2 border-crunch-ink/10 p-4"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} /><span><strong>I accept required data use</strong><small className="block">Pseudonymous account, squad progress, security, and reward integrity.</small></span></label>
    <label className="mt-3 flex gap-3 rounded-2xl border-2 border-crunch-ink/10 p-4"><input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} /><span><strong>Optional campaign analytics</strong><small className="block">Preferences and interaction events. You can play without this.</small></span></label>
    <button disabled={!required || busy} onClick={async () => { setBusy(true); await onContinue(analytics) }} className="mt-6 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">Continue to the squad</button>
  </section></main>
}

function Lobby({ user, onCreate, onJoin }: { user: User; onCreate: (name: string) => Promise<void>; onJoin: (token: string) => Promise<void> }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [name, setName] = useState(`${user.displayName}'s Crunch Crew`)
  const [token, setToken] = useState(params.get('invite') ?? '')
  return <main className="mx-auto min-h-screen max-w-lg px-5 py-7"><header className="flex items-center justify-between"><div><p className="text-sm font-bold">Ready, {user.displayName}?</p><h1 className="text-3xl font-black">Form your squad</h1></div><ChipMark small /></header>
    <section className="mt-7 rounded-[2rem] bg-white p-5 shadow-pop"><h2 className="text-2xl font-black">Start a squad</h2><label className="mt-4 block font-bold">Squad name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border-2 border-crunch-ink/20 px-3" /></label><button onClick={() => onCreate(name)} className="mt-4 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white">Create squad</button></section>
    <section className="mt-5 rounded-[2rem] bg-crunch-ink p-5 text-white"><h2 className="text-2xl font-black">Join friends</h2><label className="mt-4 block font-bold">Invitation code<input value={token} onChange={(event) => setToken(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl bg-white px-3 text-crunch-ink" /></label><button disabled={!token} onClick={() => onJoin(token)} className="mt-4 min-h-14 w-full rounded-2xl bg-crunch-yellow font-black text-crunch-ink disabled:opacity-40">Join squad</button></section>
  </main>
}

function SquadScreen({ user, squad, invitation, startingRole, missionNotice, onRole, onMission, onInvite, onRedeem }: { user: User; squad: Squad; invitation: Invitation | null; startingRole: Role | null; missionNotice: string; onRole: (role: Role) => Promise<void>; onMission: (role: Role) => Promise<void>; onInvite: () => Promise<void>; onRedeem: () => Promise<void> }) {
  const current = squad.members.find((member) => member.userId === user.id)
  const claimed = new Set(squad.members.map((member) => member.role))
  const complete = squad.members.filter((member) => member.completed).length
  const progress = complete * 25
  return <main className="mx-auto min-h-screen max-w-lg px-5 py-7">
    <header className="flex items-center justify-between"><div><p className="font-bold text-crunch-red">{squad.name}</p><h1 className="text-3xl font-black">{squad.rewardUnlocked ? 'Crunch Vault unlocked!' : `${progress}% crunchy`}</h1></div><ChipMark small /></header>
    <BagProgress progress={progress} />
    {missionNotice && <p role="status" className="mt-4 rounded-xl bg-white p-3 font-bold text-crunch-red">{missionNotice}</p>}
    {squad.rewardUnlocked && <section className="mt-5 rounded-[2rem] bg-crunch-ink p-6 text-center text-white"><span className="text-5xl" aria-hidden>✦</span><h2 className="mt-2 text-3xl font-black">Vault open!</h2><p className="mt-2">Mock Crunch Badge · DEMO — not a coupon</p><button disabled={squad.rewardRedeemed} onClick={onRedeem} className="mt-4 min-h-12 rounded-2xl bg-crunch-yellow px-6 font-black text-crunch-ink disabled:opacity-50">{squad.rewardRedeemed ? 'Mock reward claimed' : 'Claim mock reward'}</button></section>}
    <section className="mt-5 grid gap-3" aria-label="Squad roles">{roles.map((role) => {
      const member = squad.members.find((item) => item.role === role.code)
      const mine = current?.role === role.code
      return <article key={role.code} className="rounded-3xl bg-white p-4 shadow-pop"><div className="flex gap-3"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-crunch-yellow text-2xl font-black" aria-hidden>{role.icon}</span><div className="min-w-0 flex-1"><h2 className="text-xl font-black">{role.title}</h2><p className="text-sm text-crunch-ink/65">{member ? `${member.displayName} · ${member.completed ? 'Complete' : 'In progress'}` : role.description}</p></div></div>{mine && !member?.completed && <button disabled={startingRole !== null} onClick={() => onMission(role.code)} className="mt-3 min-h-12 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-60">{startingRole === role.code ? 'Preparing challenge…' : 'Start my mission'}</button>}{!current?.role && !claimed.has(role.code) && <button onClick={() => onRole(role.code)} className="mt-3 min-h-12 w-full rounded-2xl bg-crunch-ink font-black text-white">Choose this role</button>}</article>
    })}</section>
    {!squad.rewardUnlocked && squad.members.length < 4 && <button onClick={onInvite} className="mt-5 min-h-14 w-full rounded-2xl bg-crunch-yellow font-black text-crunch-ink">Invite a squadmate</button>}
    {invitation && <p className="mt-3 break-all rounded-xl bg-white/70 p-3 text-xs">Invite ready until {new Date(invitation.expiresAt).toLocaleTimeString()}</p>}
  </main>
}

function BagProgress({ progress }: { progress: number }) {
  return <div className="mt-6" aria-label={`Squad progress ${progress}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="relative h-20 overflow-hidden rounded-b-[2rem] rounded-t-lg border-4 border-crunch-ink bg-white"><div className="absolute inset-x-0 bottom-0 bg-crunch-yellow transition-all duration-500 motion-reduce:transition-none" style={{ height: `${progress}%` }} /><div className="absolute inset-0 grid grid-cols-4">{[1,2,3,4].map((part) => <span key={part} className="border-r border-crunch-ink/20 last:border-0" />)}</div></div><p className="mt-2 text-center font-black">{progress === 100 ? 'Crunch complete!' : `${4 - progress / 25} mission${progress === 75 ? '' : 's'} remain`}</p></div>
}

function AdminDashboard() {
  const [token, setToken] = useState('')
  const [metrics, setMetrics] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  const load = async () => { try { setError(''); setMetrics(await api.adminMetrics(token)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load dashboard') } }
  const exportCSV = async () => { try { const blob = await api.exportAdminEvents(token); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'analytics-events.csv'; anchor.click(); URL.revokeObjectURL(url) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to export CSV') } }
  return <main className="min-h-screen bg-[#f5f1e6] p-5 md:p-10"><div className="mx-auto max-w-6xl"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-black uppercase tracking-[.18em] text-crunch-red">Protected admin</p><h1 className="text-4xl font-black">Campaign analytics</h1><p className="mt-2 text-crunch-ink/60">Observed behavior only — choices are not purchase intent.</p></div><div className="flex gap-2"><input type="password" aria-label="Admin API token" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Admin token" className="min-h-12 rounded-xl border px-3" /><button onClick={load} className="min-h-12 rounded-xl bg-crunch-ink px-5 font-bold text-white">Load</button></div></header>
    {error && <p role="alert" className="mt-6 rounded-xl bg-red-100 p-4 text-red-900">{error}</p>}{!metrics && !error && <p className="mt-10 rounded-2xl bg-white p-8 text-center">Enter an admin token to load metrics.</p>}{metrics && <><section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Players" value={metrics.uniquePlayers} /><Metric label="Squads" value={metrics.squadsCreated} /><Metric label="Complete" value={metrics.completedSquads} /><Metric label="Unlocked" value={metrics.rewardsUnlocked} /><Metric label="Redeemed" value={metrics.rewardsRedeemed} /></section><section className="mt-6 grid gap-6 lg:grid-cols-2"><DataCard title="Acquisition & journey" values={metrics.eventsByName} /><DataCard title="Mission completions" values={metrics.completionsByRole} /></section><button onClick={exportCSV} className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-crunch-red px-5 font-bold text-white">Export CSV</button></>}
  </div></main>
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl bg-white p-5"><p className="text-sm font-bold text-crunch-ink/55">{label}</p><strong className="text-4xl">{value}</strong></div> }
function DataCard({ title, values }: { title: string; values: Record<string, number> }) { const entries = Object.entries(values); return <section className="rounded-2xl bg-white p-5"><h2 className="text-xl font-black">{title}</h2>{entries.length ? <dl className="mt-4 divide-y">{entries.map(([key, value]) => <div key={key} className="flex justify-between py-2"><dt>{key.replaceAll('_',' ')}</dt><dd className="font-black">{value}</dd></div>)}</dl> : <p className="mt-4 text-crunch-ink/55">No observed events yet.</p>}</section> }

function ErrorScreen({ message, retry }: { message: string; retry: () => void }) { return <main className="grid min-h-screen place-items-center p-6"><section className="max-w-sm rounded-3xl bg-white p-6 text-center shadow-pop"><span className="text-5xl">!</span><h1 className="mt-3 text-3xl font-black">Crunch interrupted</h1><p role="alert" className="mt-3">{message}</p><button onClick={retry} className="mt-5 min-h-12 rounded-xl bg-crunch-red px-5 font-bold text-white">Try again</button></section></main> }
function ChipMark({ small = false }: { small?: boolean }) { return <div className={`grid ${small ? 'h-14 w-14 text-xl' : 'h-28 w-28 text-4xl'} rotate-6 place-items-center rounded-[45%] border-4 border-crunch-orange bg-crunch-yellow font-black text-crunch-ink shadow-pop`} aria-label="Placeholder chip artwork">CR</div> }
function FloatingChips() { return <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden"><span className="absolute left-2 top-16 h-16 w-12 -rotate-12 rounded-[45%] bg-crunch-orange/50" /><span className="absolute bottom-20 right-0 h-24 w-16 rotate-12 rounded-[45%] bg-crunch-red/30" /></div> }

