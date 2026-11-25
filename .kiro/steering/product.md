# Gravekeeper: product steering

Gravekeeper is a Kiro Crew app that keeps watch over the docs of public GitHub repos. Once a week it walks the graveyard: it asks the public Lychgate scanner (https://lychgate-taupe.vercel.app) to scan each watched repo's Markdown links, saves the result, and writes a short report when health drops or new dead links (Tombstone, Ghost, Zombie) appear, with Wayback snapshots and a ready PR description.

- Audience: maintainers of open-source docs anywhere in the world.
- Tone: clear first, a little haunted (graves, walks, the keeper's lantern), never so campy that it hides the evidence.
- Credit: Demir (demir-sama) only.
- It only reports. It never opens pull requests, comments, or writes to watched repos.
