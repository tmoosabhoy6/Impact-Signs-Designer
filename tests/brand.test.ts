import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('website interface palette', () => {
  it('keeps the measured website colors in shared UI tokens', () => {
    const css = fs.readFileSync('client/src/styles.css', 'utf8');
    const palette = { navy: '#1f2640', accent: '#1c7293', ink: '#2b2b2b', muted: '#686868', gold: '#b09e6e', line: '#e1e1e1', paper: '#f7f8f9', panel: '#ffffff' };
    for (const [name, hex] of Object.entries(palette)) expect(css).toContain(`--color-${name}: ${hex};`);
    // No gradients as decoration. The one allowed use of radial-gradient is a texture: a 1 px
    // dot repeated on a grid (sign-in grain, drafting-table backdrop), never a colour wash.
    const dotGrid = /radial-gradient\([^;{}]*?\s1px,\s*transparent\s1(?:\.\d+)?px\)/g;
    expect(css.replace(dotGrid, '')).not.toContain('radial-gradient');
  });
});
