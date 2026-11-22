# Privacy-safe marketing screenshots

OnlyDM can capture its real UI without exposing a real inbox. The tooling is
debug-only, runs entirely on the local machine, and refuses to process a
capture that did not pass the in-app sanitization check.

## Why not use a real conversation

Names, profile photos, handles, timestamps, and message contents are personal
data. Blurring them after capture is not a reliable anonymization step, and a
single missed element or original file can leak the conversation. The tools
below replace the **rendered DOM** with fixture data before any screenshot is
taken.

## 1. Dump the text-free DOM skeleton

Use this when Instagram changes its layout and the selectors in
`screenshot-mode.js` need updating.

1. Run the app in development mode:

   ```bash
   npm run dev
   ```

2. Log in, open the DM conversation you want to use, and resize the window to a
   size that looks good in the landing page. The capture keeps the window's
   native size; a web content area around **1100×700 points** works well.
3. Choose **Developer → Copy DOM Skeleton**.
4. Click **Download JSON** (recommended) or **Copy JSON**.

The JSON contains tags, roles, class names, positions, sizes, text lengths,
font weights/sizes, and background kinds. It contains **no** visible text,
message contents, names, handles, image URLs, `alt` text, or `aria-label`
values. It is safe to share for selector debugging.

## 2. Prepare the sanitized demo screen

1. In the same development build, open the conversation again.
2. Choose **Developer → Prepare Demo Screenshot**.
3. The tool immediately hides the real page, clones the rendered body, replaces
   text and images with fixtures, and runs a verification pass.
4. On success, two thin green lines appear at the top and bottom of the web
   content. On failure, a red overlay explains which unfixtured element was
   found and shows the text-free skeleton. The original page remains hidden in
   both cases; only the verified clone is revealed on success.
5. To recover, choose **Developer → Reset Demo Screenshot** (or reload the
   page) and try another conversation.

If preparation fails, add the missing label to `UI_LABELS` or adjust the
region/message selectors in `src-tauri/scripts/screenshot-mode.js`. The
failure overlay only reports element positions and lengths, never the real
text.

## 3. Capture and write the landing assets

With the green lines visible:

```bash
npm run screenshot
```

Click the OnlyDM window when macOS asks. The script:

- captures the **whole macOS window**, including the title bar and traffic
  lights;
- verifies that both green sanitization markers are present;
- replaces the green marker rows with neighbouring content, so the full
  window size is preserved and no green pixels remain;
- strips metadata;
- writes `landing/assets/screenshot.png` and `screenshot.webp`;
- deletes the raw capture.

The resulting image keeps the window's native aspect ratio. There is no
2200×1400 crop in the default window mode. `--max-width` (default 2400)
downscales unusually wide captures without changing the aspect ratio.

To reprocess an existing capture:

```bash
python3 scripts/prepare-screenshot.py /path/to/capture.png
```

For the old content-only hero crop (2200×1400), use:

```bash
python3 scripts/prepare-screenshot.py /path/to/capture.png --mode content
```

`python3 scripts/prepare-screenshot.py --help` documents the modes, target
size, quality, and dry-run options.

## Safety properties

- The capture script refuses images without the green markers. A normal
  screenshot of the inbox cannot be published by accident.
- The screenshot scripts are gated behind `#[cfg(debug_assertions)]`; release
  bundles do not embed them and do not show the Developer menu.
- The sanitizer swaps the entire body for a static clone, removes scripts,
  iframes, videos, and event handlers, then verifies that every visible image
  is a local data URI and every visible text node is either fixture content or
  a known UI label.
- The skeleton dump never includes text, URLs, names, or attribute values.
- Fixtures are generated SVG avatars and a generated post image. Replace them
  only with images you created or have a clear commercial license for.
- The raw capture is deleted after processing. Do not run the preparation step
  while screen sharing or recording if the real page could be exposed during
  the brief wait for the DM inbox.
