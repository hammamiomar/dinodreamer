# Agent guidance

## Engineering standard

Make the project **simple to understand, practical to recover, and efficient to run**.

- Use descriptive names for human-facing files, folders and runs. A name such as
  `train-shard-000042.safetensors` or `step-002000.pt` explains its purpose.
  Keep checksums in metadata; do not use a bare hash as the user-facing name unless
  a current storage requirement needs it. Preserve upstream IDs where appropriate.
- Reliability code must address a concrete failure or compatibility risk. Prefer
  one clear recovery mechanism over extra registries, duplicate records or wrappers.
  Keep useful boundary checks; do not add machinery for every imaginable failure.
- Match reliability work to the stage of the project. Research and experiments
  need fast feedback and practical recovery, not production hardening by default.
  Protect expensive progress, data integrity and valid results. Weigh each safeguard
  against its I/O, latency and code complexity; more checks are not automatically better.
- Put validation at clear ownership boundaries and reuse accepted results where
  appropriate. A repeated check needs a new risk or changed input to justify it.
  Keep expensive audits explicit. Measure startup and end-to-end costs, not only
  the numerical loop, before making a safeguard part of the routine workflow.
- Test the current contract, not obsolete internal work. When a boundary changes,
  keep tests for correctness and recovery, move corruption checks to explicit audits,
  and replace assertions that require redundant I/O. Remove obsolete instructions
  from active docs too; delete superseded plans instead of keeping competing checklists.
  Preserve useful measurements as dated evidence, not recurring tasks.
  Do not delete a useful test merely to make a refactor pass.
  Test I/O bounds where repeated work was a problem.
- Choose persistence frequency from measured cost and acceptable lost progress.
  Batch writes where useful. Short recovery-test intervals are not production defaults.
- Keep data preparation and repeated large-file scans out of the GPU training path
  when an ordinary CPU preparation step can do the same work. Measure logical bytes
  read separately from actual network transfer. Do not remove integrity checks blindly.
- Treat the repository as a tool for people. A reader should know what an artifact
  contains, why a function exists, and how to resume without reconstructing a framework.

## Naming

Every name you choose, for files, scripts, directories, functions, variables, classes,
commits, branches, anything, must use precise professional vocabulary. Choose the word a
1972 IBM engineer would write in a specification. No slang, no casual shorthand, no cute
or clever names, no words borrowed from chat culture. This applies universally, not only
to the one example that follows: a script that deploys dashboards is
`deploy_dashboards.sh`, not `push_dashboards.sh`. That is one illustration of the
principle, not the extent of it.

## Understand intent before choosing a solution

Treat examples, analogies and suggested tools as context for the user's intent,
unless the user makes them requirements. Identify the outcome and constraints,
then form an independent recommendation. Adopt a reference's structure or naming
only when it fits this project's responsibilities. Preserve explicit decisions;
clarify ambiguity when it changes scope or behavior. Use judgment for local choices
and explain consequential departures. Agreement should follow reasons and evidence,
not repeated emphasis on a suggestion.

## Tensor code

- Use shape suffixes on tensor variables and fields when their shape is known:
  `images_BCHW`, `patches_BTD`, `tokens_ND`, `frames_GDR`, `codes_NKR`.
  Existing axes: B images/batch, C channels, H/W spatial, T patch positions,
  D model width, G dictionary blocks, R block rank, N flattened tokens or sampled
  occurrences, K selected blocks, V views. Document extra axes locally. Scalars
  need meaningful names, not invented suffixes; genuinely variable shapes are exempt.
- Prefer named-axis `einsum`, `einops.rearrange` and `einops.reduce` for contractions,
  reshaping and non-obvious reductions. Simple indexing, last-axis reductions and
  matrix operations are fine when the suffixed names make the axes unambiguous.
  Do not add a helper merely to hide one tensor operation.
- Vectorize tensor-axis work. Loops over optimizer steps, layers, files and bounded
  memory chunks are legitimate; don't replace bounded batching with a giant tensor.
- Use jaxtyping at public tensor boundaries in new training code. Exercise shape
  contracts in tests; runtime checking belongs in tests/debugging, not hot GPU loops.
- Keep dtype casts, normalization constants and reduction axes visible. Comments
  explain mathematical choices, memory bounds or mutation hazards—not the syntax.

## Human-facing documentation

Use [ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/about_STE.html)
as the default style for all human-facing documentation.
This includes READMEs, research reports, proposals, plans, guides, and release notes.

- Use short, active sentences and short paragraphs. Give each paragraph one topic.
  State the main point first. Remove filler, vague wording, and unnecessary jargon.
- Give one instruction per sentence. Use imperative verbs for instructions.
  Put necessary conditions before the action.
- Use one consistent term for each concept. Define technical terms at first use.
  Keep precise technical nouns; do not replace them with misleading everyday words.
- Simplify the prose, not the technical content. Preserve equations, assumptions,
  constants, qualifications, and evidence limits. Distinguish results from hypotheses.
  Follow the mathematical guidance below for self-contained explanations.
- Review new or edited prose for sentence length, consistent terms, and clear references.
  Do not claim full ASD-STE100 compliance without checking its rules and controlled dictionary.
  Ordinary documents do not need a repeated style disclaimer or a separate STE copy.

## Mathematical explanations

Follow the self-contained presentation of [Chapter 8 of *Learning Deep Representations*](https://ma-lab-berkeley.github.io/deep-representation-learning-book/Ch8.html)
([source](https://github.com/Ma-Lab-Berkeley/deep-representation-learning-book/blob/main/chapters/chapter8/applications.tex)):
define symbols, dimensions, domains/codomains and reduction axes locally,
identifying learned, frozen and data-fitted quantities.
State assumptions, derive the result in readable steps, and explain its practical
meaning with a small example where useful; distinguish mathematical consequences,
measurements and hypotheses.
Preserve the implementation's constants and normalization conventions, and use
notation the destination renders correctly—readable plain text when chat math
does not render—without sending readers elsewhere to reconstruct missing definitions.

## Structure and experiments

- One-off scripts stay flat. Reusable training code may use small dataclasses,
  cohesive modules and ordinary stateful objects where optimizer/resume state
  makes them useful. No base-class hierarchy or generic trainer framework.
- Keep model, loss and update logic readable in place. Modal owns remote execution;
  ordinary Python owns the ML/data work. Cloud imports must not be needed for local
  numerical tests.
- Clean functions and modular code are a priority. A reader should be able to follow
  the actual workflow without chasing wrappers. Separate real responsibilities;
  don't just move complexity into more files or shorten code into dense expressions.
- Keep Modal entry points thin: resources, remote calls and storage visibility.
  Dataset processing and database construction belong in ordinary, locally testable
  functions. Use concrete records and named database columns when the fields are known.
- Prefer one clear output and restart rule per unit of work. Do not introduce an
  attempt registry, generic artifact protocol or multi-version cache unless a current
  requirement needs it. Keep identity, completion and coverage checks at the boundaries
  where they protect data; do not repeat them throughout the workflow.
- Validate external data, user configuration and checkpoint compatibility at their
  boundaries. Keep checks that prevent corruption, split leakage or lost progress;
  avoid repeating the same validation in every internal helper.
- Keep seeds, resolved settings and useful code provenance with meaningful runs;
  use the lockfile. A dirty checkout is something to record, not an automatic reason
  to block a smoke test or require a commit. Do not impose an artifact registry.
- Repeat seeds when uncertainty could change a decision. Do not turn every useful
  experiment into a mandatory controlled study or treat a single run as proof of
  a universal improvement.

## Code clarity and change isolation

The code is also an explanation of the instrument. Optimize for a human learning
how it works, not minimum line count. These rules apply to TypeScript and UI code
as well as Python and tensor code.

- Before adding a feature, identify who owns its data, its behavior and its I/O.
  Group functions by those responsibilities. A change to pinning should not require
  understanding reference retrieval, canvas rendering or cloud lifecycle.
- Keep domain operations independently callable and testable. Give a function the
  smallest meaningful input it needs: a target operation takes a target, not the
  entire application state and configuration. Pass changeable settings explicitly.
- Reducers and entry points coordinate operations. They may route actions and make
  simple local assignments, but must not contain the implementation of every
  behavior. Multi-step rules belong in named domain functions; do not merely move
  a giant conditional into another file.
- Use separate named operations for different semantics. For example, explicit
  replacement and following a selection have different pin rules; do not hide that
  distinction behind a mode boolean. Booleans that represent actual settings are fine.
- When a design specifies a behavior table, keep its policy in a named operation
  and test the meaningful rows directly. Do not scatter its rules across UI handlers.
- Keep UI wording, numerical-request/revision accounting and domain updates separate.
  A generic update helper must not silently add unrelated side effects; changing a
  pin is not itself a change to the numerical objective.
- Format types, object construction and updates for reading. Expand substantial
  records, use intermediate names for meaningful steps and avoid nested ternaries
  or dense one-line switch cases. A longer readable file beats compressed code.
- Preserve unchanged values deliberately. Do not use JSON serialization as general
  equality/change detection. Compare the relevant domain fields or preserve object
  identity when an operation has no effect.
- Keep tunable defaults together and name genuine fixed model constraints. Do not
  scatter magic values inside functions, or turn mathematical constants into a
  speculative configuration system.
- Cohesive modules are the aim, not a file per function. Extract a real responsibility,
  not pass-through wrappers, single-operation helpers or an abstraction without a
  present use. No arbitrary line-count target substitutes for this judgment.

Before committing new behavior, perform a change-isolation review:

1. Can its rule be found by name and changed without editing unrelated policies?
2. Can it be tested without mounting the UI or mocking the cloud?
3. Does the coordinating function read as the workflow, rather than implement all
   its details? If not, refactor before adding the next layer.

## Commit messages

Use scope-first messages: `area: description`, not Conventional Commits.

Do not attribute work in commit messages or pull request descriptions. Do not add
co-author lines, session links or "generated with" lines, for people, tools or agents.

- Lead with the affected component or directory, not a change type such as
  `feat`, `fix`, or `chore`. Avoid `type(scope): ...`.
- Describe the concrete change clearly. For example:
  `training: compare square resizing with aspect-preserving crops`.
- Write for people reading the project's history. Explain motivation and
  tradeoffs in the body when useful; do not spend effort classifying the change.
- Keep user-facing release notes separate: summarize the resulting behavior,
  rather than treating the commit log as a changelog.
- Base checks on actual changes, not commit-message labels. Decide version
  bumps from the resulting compatibility changes, not prefixes alone.

Rationale: [Stop Using Conventional Commits — Sumner Evans](https://sumnerevans.com/posts/software-engineering/stop-using-conventional-commits/).
