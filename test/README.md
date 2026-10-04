# Export checks

Run from the glitterizer folder. The browser check needs an installed Playwright
module and a Chromium browser. Supply their paths rather than installing them
into the app:

```powershell
node test/verify-export.mjs --playwright <playwright-module-path> --browser <browser-executable>
```

This serves the app on a temporary local port, brushes a generated gradient,
checks preset dimensions and preview alignment, downloads exports, checks
project save/load and older defaults, and writes four GIF fixtures with their
expected post-profile pixels. The fixtures cover shared adaptive palettes,
transparent frame differences, all three dithers, a web-safe palette, and the
full-color GIF fallback. Generated files go to the ignored `test/output/`.

Decode with FFmpeg and inspect timing with ffprobe, then compare every pixel:

```powershell
foreach ($fixture in 0..3) {
  ffmpeg -v error -threads 2 -i "test/output/fixture-$fixture.gif" -threads 2 -fps_mode passthrough -f rawvideo -pix_fmt rgba -y "test/output/fixture-$fixture.rgba"
  ffprobe -v error -count_frames -show_entries stream=nb_read_frames,width,height:format=duration -of json "test/output/fixture-$fixture.gif" | Set-Content -Encoding utf8 "test/output/fixture-$fixture.json"
}
node test/verify-decoded.mjs
ffprobe -v error -count_frames -show_entries stream=width,height,nb_read_frames -of json test/output/ui.webm
```

The GIF comparison requires exact pixels, exact frame counts, and a two-second
duration in each fixture. The WebM check reports dimensions and frame count;
the real-time recorder adds a priming frame and can drop frames under load.
