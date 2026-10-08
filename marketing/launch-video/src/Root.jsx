import { Composition } from 'remotion';
import { Launch } from './Launch.jsx';
import { DURATION } from './scene/timeline.js';

export const FPS = 60;

export const RemotionRoot = () => (
  <Composition id="Launch" component={Launch} durationInFrames={DURATION * FPS} fps={FPS} width={1920} height={1080} />
);
