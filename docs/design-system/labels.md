# Labels

```
What is the label?
 ├── A category's funding state or available amount
 │    → a funding component (AvailablePill, FundingRing); never a Tag
 ├── Something waiting for the user to check → review dot
 └── A short word about a row or property → Tag
```

Neither takes a size. Neither is clickable; if it needs to be pressed, it's a
`Button`.

## Tag

`src/components/ui/tag.tsx`. Tones: `neutral`, `attention`. Nothing else
exists.

- `neutral` is the default: a plain descriptor.
- `attention` means the user has to do something: Reconnect, Not linked, an
  uncategorized transaction's category. If nothing is waiting on the user,
  it is not `attention`, however important it looks.

A Tag marks an exception: the one transaction with no category among a
register of categorized ones. If every row in a list would carry a tag, drop
the tags. The list's heading already says what the rows have in common, and
a detail about one row belongs in its secondary text ("Could be the $38.99
order from Oct 16"). Seven tags in a row mark nothing.

Keep it to 1–3 words. A sentence belongs in body text.

A Tag names a state ("Signed out", "Not linked"), never an action. When the
user can fix it from the same place, the action is a `Button` beside it;
a Tag that reads "Reconnect" next to a Reconnect button says the same thing
twice.

```tsx
// Correct
<Property
  label="Account"
  icon={account?.kind === "credit" ? CreditCardIcon : LandmarkIcon}
>
  {account?.name ?? <Tag tone="attention">Not linked</Tag>}
</Property>

// Incorrect: a money state shown as a Tag, and a tone named for its color
<Tag tone="amber">Underfunded</Tag>
```

## Review dot

Something waiting for the user to check, like transactions to review, is a
6px dot in `--text-secondary`: `.reviewDot` with `data-on` in the prototype.
It says "look here", never how many. Never a number and never the accent:
a colored count in the sidebar competes with money states for attention,
and the register already shows what is waiting.

Give a standalone dot `role="img"` and an `aria-label` saying what is
waiting. Drop the dot when nothing is.

```tsx
// Correct
{
  toReview && (
    <span
      className={styles.reviewDot}
      data-on
      data-inline
      role="img"
      aria-label="Transactions to review"
    />
  );
}

// Incorrect: a count, in the accent color
<span className={styles.count}>{reviewCount}</span>;
```
