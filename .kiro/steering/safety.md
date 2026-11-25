# Safety steering
- Only scan public repos listed in the app's watch list; at most 10 per walk.
- Respect Lychgate's public rate limit (6 scans per 10 minutes per IP): space scans at least 100 s apart, stop the walk on HTTP 429 and say when to retry.
- No secrets, tokens or API keys anywhere in the repo; nothing paid.
- Never write to watched repos; network calls go only to the Lychgate host configured in the watch list (default https://lychgate-taupe.vercel.app).
- Agents may read the app's walk history but only the walk script writes it.
