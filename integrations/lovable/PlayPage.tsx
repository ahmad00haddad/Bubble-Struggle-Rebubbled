/**
 * Drop-in route for a Lovable (React + Vite) app, e.g. at /play.
 *
 * The game stays a self-contained Phaser module served by the Cloudflare Worker;
 * React only provides the container element. No game logic lives in React.
 *
 * Setup in Lovable:
 *   1. Add this file as src/pages/PlayPage.tsx
 *   2. Add a route:  <Route path="/play" element={<PlayPage />} />
 *   3. Set VITE_ORB_SERVER_URL=https://orb-lancers.<your-account>.workers.dev
 *      (or hard-code GAME_SERVER below).
 *
 * Invite links work out of the box: /play?room=K7PX2M opens the join screen.
 */
import { useEffect, useRef, useState } from 'react';

const GAME_SERVER: string =
  (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_ORB_SERVER_URL ??
  'https://orb-lancers.YOUR-ACCOUNT.workers.dev';

interface GameHandle {
  destroy(): void;
}

export default function PlayPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let handle: GameHandle | null = null;
    let cancelled = false;
    import(/* @vite-ignore */ `${GAME_SERVER}/embed/orb-lancers.js`)
      .then(({ mountGame }) => {
        if (!cancelled && hostRef.current) handle = mountGame(hostRef.current, { serverUrl: GAME_SERVER });
      })
      .catch(() => setError('The game server is unreachable right now. Please try again later.'));
    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }, []);

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 64px)', minHeight: 420, background: '#070a1f', position: 'relative' }}>
      {error && (
        <p style={{ color: '#ff5d73', textAlign: 'center', paddingTop: 80, fontFamily: 'sans-serif' }}>{error}</p>
      )}
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

/*
 * Alternative with zero code coupling — an iframe:
 *
 *   <iframe
 *     src={`${GAME_SERVER}/${window.location.search}`}
 *     style={{ width: '100%', height: '100vh', border: 0 }}
 *     allow="fullscreen; autoplay; clipboard-write"
 *   />
 */
