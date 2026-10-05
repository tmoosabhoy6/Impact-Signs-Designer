import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../api';
import type { Me } from '../App';
import { Button, FIELD, Notice } from '../components/ui';
import { Logo } from '../components/TopBar';

/** Finished concept plaques (public/login/), laid out as the sign-in page's montage. */
const MONTAGE_COLUMNS: number[][] = [
  [1, 6, 4, 3],
  [3, 7, 2, 9],
  [5, 1, 8, 6],
  [9, 4, 3, 2],
  [2, 8, 7, 5],
  [6, 3, 1, 4],
  [4, 9, 5, 7],
];
// Small fixed tilts and offsets so the wall reads as pinned-up proofs, not a rigid grid.
const TILTS = [-1.6, 1.2, -0.8, 1.8, -1.2, 0.9, -1.9, 1.4, -0.6];

/** A wall of real concept plaques behind the sign-in card. Decorative only. */
function PlaqueMontage() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#141a2e]" aria-hidden>
      <div className="absolute -inset-x-10 -inset-y-16 grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        {MONTAGE_COLUMNS.map((col, c) => (
          <div key={c} className={`flex flex-col gap-4 ${c % 2 ? 'mt-12' : 'mt-0'} ${c >= 4 ? 'hidden lg:flex' : c === 3 ? 'hidden sm:flex' : ''}`}>
            {col.map((n, r) => (
              // The tilt sits on a wrapper because the entrance animation ends with `transform: none`.
              <div key={r} style={{ transform: `rotate(${TILTS[(c * 4 + r) % TILTS.length]}deg)` }}>
                <img
                  src={`/login/plaque-${n}.jpg`}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="plaque-shadow rise w-full rounded-[3px] object-cover"
                  style={{ animationDelay: `${(c * 4 + r) * 50}ms` }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* A dark wash keeps the card readable while the plaques stay visible. */}
      <div className="absolute inset-0 bg-[#141a2e]/60" />
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
    <div className="relative grid min-h-full place-items-center px-4 py-10">
      <PlaqueMontage />
      <div className="relative z-10 w-full max-w-sm">
        <form
          className="card card-rule rise w-full shadow-[0_30px_70px_-20px_rgba(0,0,0,0.7)]"
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
