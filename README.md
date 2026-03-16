# X Popular Link Filter

Chrome Extension (Manifest V3) that collects popular link posts from the X home timeline.

## Current behavior

- Works on `https://x.com/home`
- Extracts visible posts and scrolls the page to gather more
- Keeps only posts that include an external URL
- Filters by fixed engagement thresholds
- Shows results inside the extension popup

Default thresholds:

- Likes: `100`
- Reposts: `50`
- Replies: `20`

## Load locally

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this directory
5. Open X home timeline and click the extension action

## Notes

- The extractor depends on X DOM structure and may need selector updates if the UI changes.
- The first implementation is intentionally limited to the home timeline and does not use the X API.
