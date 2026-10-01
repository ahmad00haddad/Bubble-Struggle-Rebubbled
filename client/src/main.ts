import { mountGame } from './embed';

const el = document.getElementById('game');
if (el) {
  const handle = mountGame(el);
  // Handy for debugging in the browser console.
  (window as unknown as { orbLancers: unknown }).orbLancers = handle;
}
