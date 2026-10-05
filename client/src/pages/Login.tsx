import { useState } from 'react';
import { api } from '../api';
import type { Me } from '../App';
import { Button, Notice } from '../components/ui';
import { Logo } from '../components/TopBar';

export function Login({ mode, onDone }: { mode: Me['authMode']; onDone: () => void }) {
  // Accounts sign in with a username; the older shared-password setup asks for a name.
  const accounts = mode === 'supabase';
  const [name, setName] = useState(() => localStorage.getItem('pps-name') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-full place-items-center bg-paper px-4">
      <form
        className="w-full max-w-sm border border-line bg-white"
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
        <div className="h-[3px] bg-navy" />
        <div className="space-y-5 p-7">
          <div>
            <Logo className="h-7" />
            <h1 className="mt-4 font-display text-xl font-semibold uppercase tracking-[0.08em]">Plaque Proof Studio</h1>
            <p className="mt-1 text-[14px] text-muted">Concepts, customer proofs and production files for cast bronze plaques.</p>
          </div>
          {mode === 'unconfigured' ? (
            <Notice tone="error">Sign-in is not set up on this server yet. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the server settings.</Notice>
          ) : (
            <>
              <label className="block">
                <span className="label">{accounts ? 'Username' : 'Your name'}</span>
                <input
                  className="mt-1 h-10 w-full rounded-[3px] border border-line px-3 outline-none focus:border-navy"
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
                <input type="password" className="mt-1 h-10 w-full rounded-[3px] border border-line px-3 outline-none focus:border-navy" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </label>
              {error && <Notice tone="error">{error}</Notice>}
              <Button type="submit" busy={busy} className="w-full">
                Sign in
              </Button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
