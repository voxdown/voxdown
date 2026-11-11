# Changes to the VoxDown spec

The spec is versioned on its own, apart from the packages (SPEC.md §16).

## Unreleased

- **Character references** (§11): `&amp;`, `&quot;`, `&#8217;` and the HTML Standard's other names stand for their characters, as in Markdown, heard and printed as them. This gives meaning to text a 1.0 file would rarely hold, so by §16 it belongs to the next minor version, 1.1: SPEC.md marks the paragraph "new in 1.1 (draft)", and `conformance.json` gives its example `"since": "1.1"`, for 1.0 readers to skip.

Clarifications: no file reads differently.

- §13, rule 3: a direction of its own for a paragraph that carries a speech on goes just inside its opening mark, and a mark between two characters with no space between them goes without its space, so the book doesn't change.
- §13, rule 3 also says that a direction a speech takes from its mark is set in the mark, for the whole speech, and a stretch's own `@(…)` is replaced where it is.
- §13, rule 4: a speech over paragraphs is given away whole, from any of its paragraphs.
- §5.2: names ignore the kind of apostrophe, as they ignore case: `@O'Brien` and `@O’Brien` are one character.
- §4.4: a scene break's signs may have spaces between them, as in Markdown: `* * *` and `- - -` are scene breaks.
- §8.3: a link is written on one line, as marks are; one that runs onto the next line is read as a sound and text, and warned about. An image may be a link's text, as in Markdown, with a new example; §12.1 gives its line in the spoken script.

## 1.0 (9 November 2026)

The first stable version. Everything a 0.1 draft file says, it still says, except as noted.

- **The name.** The format is VoxDown. The front matter key that names the version is `voxdown` (it was `audiobook-markup`): write `voxdown: 1.0`.
- **The file extension.** Files end in `.vxd`. `.md` is still read, for files mostly read in Markdown tools. The suggested media type is `text/markdown; variant=VoxDown`.
- **Front matter.** The part of YAML every reader understands is now written down (§4.2).
- **Warnings** have stable codes, listed in §12.3 with their level.
- A link straight after an `@`, `@[text](address)`, is a link (§8.3), as after a name.
- **Formatting** (§13, rule 8): what a formatter may change, and only when asked.
- **Conformance** (§15): two levels, a reader and a writer, and `conformance.json`, every example as data for other implementations.
- **Versions** (§16): what a minor and a major version may change.
- The **performance view** of §14 is now called the **script view**.
- Examples of a tool's own marks use a neutral tool, `{recorder:take 3}`.
- The open questions that remain are now "Beyond 1.0" (§17). The name, file extension and front matter questions are settled.

## Draft 0.1 (7 November 2026)

The first public draft, as "Audiobook Markup": the marks, the two readings, and a worked example for every rule.
