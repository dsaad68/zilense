/* target.js — pure helper for the PDF viewer's target URL, factored out so it can
   be unit-tested without loading pdfjs. The viewer receives the PDF to open in its
   own URL hash as `#file=<encodeURIComponent(url)>` (a hash, like Reader mode's
   nonce, so the target never travels in a network request). Only http(s)/file
   URLs are accepted — anything else (javascript:, data:, chrome-extension:, junk)
   resolves to '' so the viewer shows its "no PDF" state instead of fetching it. */

const ALLOWED = new Set(['http:', 'https:', 'file:'])

// is this string an allowed-scheme absolute URL?
function allowedUrl(s) {
  try { return ALLOWED.has(new URL(s).protocol) ? s : '' } catch (e) { return '' }
}

// parse the viewer's location.hash into a validated PDF URL, or '' when absent /
// malformed / a disallowed scheme. The hash is `file=<url>`, where the URL is
// percent-encoded when the popup builds it but RAW when the auto-redirect
// declarativeNetRequest rule builds it (DNR can't encode). So try the decoded form
// first, then fall back to the raw form — whichever is a valid allowed URL wins.
export function parsePdfTarget(hash) {
  if (typeof hash !== 'string') return ''
  const h = hash.replace(/^#/, '')
  if (!h) return ''
  const raw = (h.startsWith('file=') ? h.slice('file='.length) : h).trim()
  if (!raw) return ''
  let decoded = raw
  try { decoded = decodeURIComponent(raw).trim() } catch (e) { decoded = raw }
  return allowedUrl(decoded) || allowedUrl(raw)
}

// is this a local file:// target? (used to surface the "Allow access to file URLs"
// hint, which Chrome can't grant via the manifest — the user must toggle it).
export function isFileTarget(url) {
  return typeof url === 'string' && url.startsWith('file:')
}
