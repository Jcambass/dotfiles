---
name: writing-voice
description: Write drafts in the user's voice for comments, docs, messages, reviews, and release notes.
---

# Writing Voice

Use this for any personal writing where the reader should think the user wrote it themselves: performance reviews, status updates, emails, proposals, design documents, blog posts, Slack messages, GitHub comments, reviews, release notes, and commit messages. Apply it automatically whenever drafting this kind of user-facing prose on the user's behalf — do not wait to be told to "use the writing-voice skill" first.

This skill has two parts:

1. Voice profile: match how the user actually writes.
2. Style rules: avoid patterns that make text sound AI-generated.

Always read this whole file when using this skill, not just a reference file in isolation. The reference files are inputs to the workflow below, not a substitute for it — `user-curated-voice.md` alone omits the kill-list/style rules and the final-edit checklist.

Before drafting, read:

- `references/user-curated-voice.md` for the user's baseline voice.
- `references/style-rules.md` for kill-list words, filler, punctuation, and structure rules.

### When to sample (rare)

Do **not** read `references/voice-sampling.md` by default. The curated profile is committed to this skill and already exists — treat it as always present. A missing sampled/cached profile in `$HOME/.cache/writing-voice/` is, by itself, never a reason to sample.

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
3. Do not sample by default (see "When to sample (rare)" above). Only load `$HOME/.cache/writing-voice/` notes or run `references/voice-sampling.md` when one of those explicit triggers applies.
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

## PR descriptions

Write PR descriptions as a clear technical narrative, not a completed-work checklist. Explain what the PR changes, why it matters, how its pieces fit together, and how it relates to the surrounding system or related work. Use enough structure and detail for reviewers to understand that wider picture:

- Check for an applicable repository PR template before drafting. When one exists, use it as the starting structure and fit the content into it while following these rules. Preserve required sections and checklists; adapt or omit optional boilerplate that does not apply.
- Explain why the change is needed before listing what changed.
- Explain how the implementation works at the ownership boundaries reviewers need to evaluate.
- Keep details that explain motivation, non-obvious behavior, or a real tradeoff. Do not inventory files, controls, or implementation details already clear from the diff.
- Link the existing source, precedent, or follow-up where it supports a non-obvious claim. The prose must still make sense without opening the links.
- Call out temporary compatibility code and name the intended replacement or follow-up.
- Separate current behavior from future plans. Qualify proposed versioning, release, backport, or support policies unless the repository already implements and documents them.
- Do not claim migration, upgrade preservation, or backward compatibility unless the feature has shipped state to preserve and the implementation and tests support the claim. Code on the PR base branch is not by itself evidence of deployed customer state.
- Include personal design history only when it helps reviewers understand a decision or tradeoff.
- Do not add a `Tests` section by default. Include validation details only when the user asks or when a non-obvious result materially helps reviewers evaluate risk.
- Omit routine test/assertion counts, lint/syntax/whitespace success logs, discovery-case inventories, and unavailable-environment execution logs unless explicitly requested or required by the repository. Explain behavior and design rationale instead; state material risks or limitations when they affect the review, without adding a generic `Testing` section.
- Use headings to make that narrative easy to follow. Larger PRs often need several specific sections, and smaller PRs may too. Do not default to `Why` and `How` or force every PR into the same template.
- Keep test results concise and secondary to the rationale and implementation.

## Rules

1. **Curated profile first** — use `references/user-curated-voice.md` as the baseline; it is committed and always present.
2. **Sample rarely, and only on explicit trigger** — see "When to sample (rare)" above. A missing sampled cache is never a trigger by itself.
3. **Use sampled signal as supplemental** — never let sampled notes override the curated profile.
4. **Never show the profile unprompted** — use it silently; share only if asked.
5. **Kill-list words are absolute** — replace them even if the user uses them.
6. **Style beats voice for bad patterns** — copy good habits, not AI-sounding ones.
7. **Specifics beat polish** — when in doubt, make it shorter and more concrete.
8. **Keep profiles separate** — curated profile in the skill folder; sampled profiles in `~/.cache/writing-voice`; refresh sampled profiles quarterly.

## Final edit checklist

Before returning prose, check:

- Does this sound like something the user would say to a colleague?
- Is the ask or point clear in the first few lines?
- Are the important details preserved?
- Did any AI-tell words, structures, or em-dash overuse slip in?
- Is it too polished for the context?
- Can any sentence be cut without losing meaning?
