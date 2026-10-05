import { useState } from 'react';
import { ArrowRight, FileCheck2, FileCog, Images, ListOrdered } from 'lucide-react';
import { api } from '../api';
import type { Me } from '../App';
import { Button, FIELD, Notice } from '../components/ui';
import { Logo } from '../components/TopBar';

const STEPS = [
  { icon: ListOrdered, label: 'Order', text: 'Paste the specification and the customer wording.' },
  { icon: Images, label: 'Concepts', text: 'Three production-realistic layouts in about a minute.' },
  { icon: FileCheck2, label: 'Proof', text: 'The customer proof sheet, measured from the real ones.' },
  { icon: FileCog, label: 'Vector PDF', text: 'The one-ink production file, text outlined.' },
];

/** A cast bronze plaque drawn by CSS from the catalog's own finish and texture images. */
function PlaqueIllustration() {
  return (
    <div className="plaque rise mx-auto w-full max-w-[420px]" aria-hidden style={{ animationDelay: '120ms' }}>
      <div className="plaque-field px-[9%]! text-center">
        <div className="plaque-text text-[clamp(20px,2.5vw,27px)] font-bold uppercase leading-tight tracking-[0.03em]">Plaque Proof Studio</div>
        <div className="plaque-text mt-3 text-[clamp(14px,1.7vw,18px)] leading-snug">Impact Signs</div>
        <div className="plaque-text mt-6 text-[clamp(11px,1.3vw,14px)] uppercase tracking-[0.18em]">Concepts · Proofs · Production</div>
        <div className="plaque-text mt-6 text-[clamp(10px,1.1vw,12px)] uppercase tracking-[0.12em]">Cast Bronze · Cast Aluminum</div>
      </div>
    </div>
  );
}

export function Login({ mode, onDone }: { mode: Me['authMode']; onDone: () => void }) {
  // Accounts sign in with a username; the older shared-password setup asks for a name.
  const accounts = mode === 'supabase';
  const [name, setName] = useState(() => localStorage.getItem('pps-name') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* The studio side: dark stage, the plaque, and the four steps the app walks through. */}
      <aside className="stage relative hidden flex-col justify-between overflow-hidden px-12 py-10 text-white lg:flex" aria-label="About Plaque Proof Studio">
        <div className="rise flex items-center gap-3">
          <Logo className="h-6" light />
          <span className="h-5 w-px bg-white/20" />
          <span className="font-display text-[14px] font-semibold uppercase tracking-[0.1em] text-white/80">Plaque Proof Studio</span>
        </div>
        <div className="my-10">
          <PlaqueIllustration />
        </div>
        <div>
          <div className="mb-5 h-[3px] w-16 bg-gold" aria-hidden />
          <ol className="stagger grid grid-cols-2 gap-x-8 gap-y-5 xl:grid-cols-4 xl:gap-x-6">
          {STEPS.map((s, i) => (
            <li key={s.label} className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-bronze">{String(i + 1).padStart(2, '0')}</span>
                <s.icon className="h-4 w-4 text-white/70" aria-hidden />
                <span className="font-display text-[14px] font-semibold uppercase tracking-[0.08em]">{s.label}</span>
              </div>
              <p className="mt-1 text-[13px] leading-snug text-white/55">{s.text}</p>
            </li>
          ))}
          </ol>
        </div>
      </aside>

      <div className="blueprint grid place-items-center px-4 py-10">
        <form
          className="card card-rule rise w-full max-w-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              localStorage.setItem('pps-name', name);
              await api.post('/login', accounts ? { username: name, password } : { name, password });
              onDone();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-5 p-7 sm:p-8">
            <div>
              <Logo className="h-7" />
              <h1 className="mt-5 font-display text-[22px] font-semibold uppercase leading-none tracking-[0.08em]">Plaque Proof Studio</h1>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted">Concepts, customer proofs and production files for cast bronze plaques.</p>
            </div>
            {mode === 'unconfigured' ? (
              <Notice tone="error">Sign-in is not set up on this server yet. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the server settings.</Notice>
            ) : (
              <>
                <label className="block">
                  <span className="label">{accounts ? 'Username' : 'Your name'}</span>
                  <input
                    className={`${FIELD} mt-1.5 h-11 w-full text-[15px]`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete={accounts ? 'username' : 'name'}
                    autoCapitalize="off"
                    spellCheck={false}
                    required
                  />
                </label>
                <label className="block">
                  <span className="label">{accounts ? 'Password' : 'Team password'}</span>
                  <input type="password" className={`${FIELD} mt-1.5 h-11 w-full text-[15px]`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                </label>
                {error && <Notice tone="error">{error}</Notice>}
                <Button type="submit" busy={busy} className="group h-11 w-full">
                  Sign in
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Button>
              </>
            )}
            <p className="border-t border-line pt-4 text-[12.5px] text-muted">Internal tool for Impact Signs designers. Each sign-in sees only its own jobs.</p>
          </div>
        </form>
      </div>
    </div>
  );
}
