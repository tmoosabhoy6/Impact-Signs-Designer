import { Config } from '@remotion/cli/config';

// Headless shell shipped with this environment's Playwright install; set REMOTION_BROWSER to override.
Config.setBrowserExecutable(process.env.REMOTION_BROWSER ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell');
Config.setEntryPoint('src/index.js');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setCodec('h264');
Config.setCrf(16);
Config.setPixelFormat('yuv420p');
Config.setConcurrency(4);
Config.setChromiumOpenGlRenderer('swangle');
