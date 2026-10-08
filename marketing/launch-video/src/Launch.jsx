import { useLayoutEffect, useRef, useState } from 'react';
import { AbsoluteFill, Audio, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { MARKUP } from './scene/markup.js';
import { createFilm } from './scene/timeline.js';

// The stage is plain DOM driven by one paused GSAP timeline (src/scene/timeline.js).
// Remotion owns the clock: every frame seeks the timeline to frame / fps.
export const Launch = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const host = useRef(null);
  const [film, setFilm] = useState(null);
  const [handle] = useState(() => delayRender('Loading fonts, images and building the timeline'));
  const ready = useRef(false);

  useLayoutEffect(() => {
    let alive = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = staticFile('style.css');
    const css = new Promise((r) => { link.onload = link.onerror = r; });
    document.head.appendChild(link);
    host.current.innerHTML = MARKUP.replace(/src="media\/([^"]+)"/g, (_, f) => `src="${staticFile('media/' + f)}"`);
    css
      .then(() => createFilm((p) => staticFile(p)))
      .then((f) => {
        if (!alive) return;
        // scripts/cues.mjs reads this line to time the sound effects.
        console.log('CUES:' + JSON.stringify(f.cues));
        setFilm(f);
      });
    return () => { alive = false; link.remove(); };
  }, []);

  useLayoutEffect(() => {
    if (!film) return;
    film.tl.seek(frame / fps, false);
    if (!ready.current) { ready.current = true; continueRender(handle); }
  }, [film, frame, fps, handle]);

  return (
    <AbsoluteFill style={{ backgroundColor: '#141a2e' }}>
      <div ref={host} />
      <Audio src={staticFile('audio/soundtrack.wav')} />
    </AbsoluteFill>
  );
};
