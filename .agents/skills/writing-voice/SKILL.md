---
name: writing-voice
description: Write drafts in the user's voice for comments, docs, messages, reviews, and release notes.
---

# Writing Voice

Use this for any personal writing where the reader should think the user wrote it themselves: performance reviews, status updates, emails, proposals, design documents, blog posts, Slack drafts, GitHub comments, reviews, release notes, and commit messages. Apply it automatically whenever drafting this kind of user-facing prose on the user's behalf — do not wait to be told to "use the writing-voice skill" first.

This skill has two parts:

1. Voice profile: match how the user actually writes.
2. Style rules: avoid patterns that make text sound AI-generated.

Always read this whole file when using this skill, not just a reference file in isolation. The reference files are inputs to the workflow below, not a substitute for it — `user-curated-voice.md` alone omits the kill-list/style rules and the final-edit checklist.

Before drafting, read:

- `references/user-curated-voice.md` for the user's baseline voice.
- `references/style-rules.md` for kill-list words, filler, punctuation, and structure rules.

### When to sample (rare)

Do **not** read `references/voice-sampling.md` by default. The curated profile is committed to this skill and already exists — treat it as always present. A missing sampled/cached profile in `$HOME/.pi/voice-profiles/` is, by itself, never a reason to sample.

Only read `voice-sampling.md` when at least one of these is explicitly true:

- the user asks to sample or refresh the profile,
- a draft built from the curated profile clearly does not sound like the user, or
- the format needs signal the curated profile doesn't cover (e.g. a genre it doesn't address).

When in doubt, do not sample — use the curated profile as-is.

## Skill-local curated profile

`references/user-curated-voice.md` is the committed, sanitized baseline voice. Use it before sampling recent writing or cache files. Sampled profiles are supplemental signal, never a replacement.

Keep the curated profile style-only: no raw samples, internal links, teammate names, or private details. Do not overwrite it with sampled content; edit it by hand.

## Application workflow

1. Load the curated profile first.
2. Load the style rules.
3. Do not sample by default (see "When to sample (rare)" above). Only load `$HOME/.pi/voice-profiles/` notes or run `references/voice-sampling.md` when one of those explicit triggers applies.
4. Draft the text.
5. Edit once for voice: direct, plainspoken, specific, and appropriate to the venue.
6. Edit once for AI tells: kill-list words, filler, em-dash overuse, dramatic fragments, and generic conclusions.
7. Return or publish only after the final checklist passes.

## Default style target

If no profile is available, write in a direct, specific, confident-not-arrogant style:

- Use contractions unless the format is unusually formal.
- Lead with the point, then add context.
- Prefer concrete nouns and plain verbs.
- Keep paragraphs short.
- Cut filler before polishing.
- Ask for missing names, numbers, dates, or links instead of inventing them.

## Rules

1. **Curated profile first** — use `references/user-curated-voice.md` as the baseline; it is committed and always present.
2. **Sample rarely, and only on explicit trigger** — see "When to sample (rare)" above. A missing sampled cache is never a trigger by itself.
3. **Use sampled signal as supplemental** — never let sampled notes override the curated profile.
4. **Never show the profile unprompted** — use it silently; share only if asked.
5. **Kill-list words are absolute** — replace them even if the user uses them.
6. **Style beats voice for bad patterns** — copy good habits, not AI-sounding ones.
7. **Specifics beat polish** — when in doubt, make it shorter and more concrete.
8. **Keep profiles separate** — curated profile in the skill folder; sampled profiles in `~/.pi/voice-profiles`; refresh sampled profiles quarterly.

## Final edit checklist

Before returning prose, check:

- Does this sound like something the user would say to a colleague?
- Is the ask or point clear in the first few lines?
- Are the important details preserved?
- Did any AI-tell words, structures, or em-dash overuse slip in?
- Is it too polished for the context?
- Can any sentence be cut without losing meaning?
