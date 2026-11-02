# Grilling

How to interview the user before a spec: the `grilling` skill's rounds, run
the Caishen way. The user decides product behavior and look; you decide
everything else.

## Who decides

```text
Is the question about what a person sees or does in the app,
or which seams the tests attach to?
 ├── Yes → ask the user, with your recommendation
 └── No: module shape, naming, file layout, ticket split, wiring
      → decide it, and list it under "What I'll decide unless you object"
```

Facts are yours too: read the code, run the app, look things up. Never ask
the user for something you can find.

## Each question

- **Plain first.** A line of context, then short plain sentences in the
  terms from [GLOSSARY.md](../GLOSSARY.md). Name the screen and the field
  ("the Payee in Record a partner's purchase"), never the component.
- **Recommend.** End on a recommendation worded so "yes" accepts it.
- **Show, don't describe.** Every question that touches UI carries a visual:

```text
What is the question about?
 ├── UI already in the app → screenshots from the running dev server,
 │     inline in the question. Annotate only when the point would
 │     otherwise be ambiguous.
 ├── A choice between ways something could look or behave → a prototype
 │     (emil-prototype skill) at /playground/<slug>, built from the real
 │     ui components, one variant per option, linked in the question
 └── Neither → words alone
```

A prototype's variants differ only on the axis being asked about; the
baseline (today's UI) is variant 1 when it exists.

```md
<!-- Correct -->
❓ **Q1 - How a search list opens**: In move money the list opens inside the
form and pushes Cancel/Move down. In a register entry it floats over the
form. [two screenshots] Prototype: http://localhost:3217/playground/search-list
➡️ Floats: the register is where you pick most often.

<!-- Incorrect: jargon, no visual, nothing to say yes to -->
❓ **Q1**: Should ChoiceField use placement="inline" or the Popover anchor?
```

## Rounds

Ask every question whose prerequisites are settled in one round, numbered.
After the answers, recompute and ask the next round. The session ends when
nothing is left open; play the agreed design back in one list and wait for a
yes before writing anything.

## After the yes

1. Put each prototype decision in the spec, with the rejected options and
   why, then delete the prototype route.
2. Write the spec (`to-spec`), then the tickets (`to-tickets`), labelled
   `ready-for-agent`.
