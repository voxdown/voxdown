# Studio security and privacy audit

Independent local review, 18 November 2026. Scope: the current `studio-fountain` working tree, including Studio imports, parser/layout/PDF export, recovery storage, backup format, browser rendering, dependencies, Vite configuration, and Pages deployment. This is a focused code and runtime audit, not penetration-test certification or a guarantee against unknown dependency vulnerabilities.

## Result

No exploitable source-to-script execution or story exfiltration path was found in the reviewed implementation. Hostile text remains text in the editor, preview, outline, private-notes workbench, library, and exported PDF. Production dependency audit returned zero advisories. There is a defense-in-depth gap in the initial reviewed revision: Studio has no Content Security Policy or referrer policy. Recommended action is below; this report does not claim that an unverified subsequent policy change passed testing.

Provisional security/privacy readiness score for this reviewed state: **8.5/10**. This is an evidence-based judgment for this scope, not a mathematical risk estimate. It is below the requested 9.5 release threshold. Policy hardening, built-page runtime verification, and the broader release checks remain necessary before revisiting that score.

## Findings and recommendations

### P2: Add a Studio-specific browser policy

The reviewed `site/studio/index.html` contains no CSP, and the Pages workflow uploads static assets without application-managed HTTP security headers. No present injection vulnerability was found, but an injected script or resource would currently lack an additional browser policy barrier.

Add a production-compatible CSP restricted to bundled same-origin code, workers, fonts, and asset fetches. Disallow object embeds, base URL changes, and form submission. CodeMirror inserts styles and the preview positions rows with inline styles, so the policy needs an explicit style allowance unless that architecture changes. Test the built site, PDF font loading, worker startup/restart, downloads, and dialogs with the policy enabled; Vite development HMR has different websocket requirements and must not weaken the shipped production policy. Add a no-referrer policy. Do not add `frame-ancestors` to a meta policy: it requires an HTTP response header and would not protect the page there.

When deployment supports custom headers, evaluate `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, and a restrictive Permissions Policy. The present GitHub Pages deployment does not provide an application configuration for those headers. This is a hosting limitation, not a reason to pretend an ineffective meta directive supplies protection.

### P3: Harmonize filename hardening

`projectName()` bounds UTF-8 filename length and removes reserved path punctuation, control characters, and bidirectional formatting controls. `fountainName()` currently removes slash/backslash and ASCII controls but does not implement the same bidi/device-name/byte-length hardening. The browser download API prevents this from becoming an arbitrary filesystem write. Nevertheless, applying a shared portable basename sanitizer would make Fountain/PDF names less confusing when exchanged across operating systems. This is low severity, not an observed code-execution path.

### Privacy boundaries that must remain explicit

- Recovery and snapshots are unencrypted browser-origin storage. Anyone with access to the same browser profile, or executable code elsewhere on the same origin, may be able to read them. They are recovery copies, not encrypted backups.
- Studio and Writer on the same site share the browser origin. CSP limits some injection paths but does not isolate them from a compromised same-origin application. A dedicated Studio origin would be a separate deployment/product decision.
- Fountain downloads and portable JSON backups intentionally include private notes and omitted passages. The backup dialog correctly states this. Only screenplay PDF output removes completed omissions; malformed omissions block export rather than silently exposing them.
- Local privacy does not mean the app is automatically available offline on first use. Bundled assets still need to load. PDF fonts are loaded from the same origin; the reviewed code sends no screenplay content in those requests.

## Evidence

| Check | Observed result |
| --- | --- |
| `pnpm audit --prod --json` | Zero info/low/moderate/high/critical advisories; 47 production dependencies. No dependency changes or broad upgrades made. |
| Source sink inspection | Studio uses `textContent`, form values, and CodeMirror state. No `innerHTML`, `eval`, `new Function`, external image rendering, or source-derived navigation found. |
| Fresh Chromium hostile-source runtime | HTML/script/img/iframe payloads in title metadata, section outline, action, completed note, and boneyard produced zero injected elements, dialogs, page errors, or external requests. Private-note workbench displayed the payload as literal text. Tested against local Studio at port 5173 in an isolated context. |
| New export security regressions | `site/test/studio-security.test.ts`: 2 passing tests. Prototype-sensitive title keys stay data; malicious-looking source/title produces a passive PDF object graph with no JavaScript, automatic action, URI, launch, embedded-file, or form objects. Completed private content is excluded. All four font faces use same-origin fetch with redirects forbidden. |
| Type checking | `pnpm --filter voxdown-site typecheck` passed after adding security tests. |
| Existing import validation reviewed | UTF-8 fatal decoding and file-size limits; exact JSON shape/version/key validation; per-source, aggregate, snapshot count, and byte caps; browser recovery IDs excluded from backups. |
| Existing storage safety reviewed | Atomic draft/metadata and snapshot/metadata transactions; immutable snapshot IDs; validation on persisted reads; malformed legacy records preserved but excluded from usable listing; explicit deletion only. |
| PDF/font loading reviewed | Fonts are bundled, same-origin checked before fetch, redirects rejected, failures retryable; source cannot choose a font URL. Unsupported characters are reported before export. |
| Deployment reviewed | Pinned GitHub Action commit references and lockfile installation. Pages deploy job alone has Pages write permission; no publication performed by this audit. |

The CLI audit emitted a Node `url.parse()` deprecation warning from the package-manager process. It did not report an application advisory. A clean audit only means the consulted advisory database reported no matching known issues at this time.

## Limits

This audit did not exercise a physical iPhone, Brave Shields, a deployed response-header configuration, browser-extension compromises, malicious system fonts, operating-system backups, or every PDF viewer. It did not fuzz all dependency code. It found no current story transmission path, but this should be rechecked when adding cloud, AI, collaboration, analytics, remote assets, or integrations. Preserve the strict portable-backup boundary and passive text rendering during future changes.


## Subsequent hardening and verification

The findings above describe the original audit revision. Sprint 20 added a Studio-only production
CSP through the Vite build plugin, a no-referrer policy and a shared portable filename sanitizer.
The policy permits bundled same-origin scripts/workers/fonts/fetches, blocks objects/forms/base
changes, and allows the inline styles required by CodeMirror and positioned screenplay rows.
Development HMR does not receive or weaken the shipped policy. The built Studio browser suite
subsequently passed in Chromium, Firefox and WebKit with this policy, including worker operation,
PDF/font loading and file downloads. The final independent workflow review found no new
correctness/security blocker and rated security 9.3/10. Hosting and same-origin storage limitations
above remain; this is not a penetration-test certification or a claim of 9.5 readiness.
