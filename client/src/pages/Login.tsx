import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../api';
import type { Me } from '../App';
import { Button, FIELD, Notice } from '../components/ui';
import { Logo } from '../components/TopBar';

export function Login({ mode, onDone }: { mode: Me['authMode']; onDone: () => void }) {
  // Accounts sign in with a username; the older shared-password setup asks for a name.
  const accounts = mode === 'supabase';
  const [name, setName] = useState(() => localStorage.getItem('pps-name') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-full place-items-center bg-[#2E3092] px-4 py-10">
      <div className="w-full max-w-sm">
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
