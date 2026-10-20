# Labels

```
What is the label?
 ├── A category's funding state or available amount
 │    → a funding component (AvailablePill, FundingRing); never a Tag
 ├── A number of things waiting → Badge
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

## Badge

`src/components/ui/badge.tsx`. Tones: `neutral`, `accent`. Nothing else
exists.

- `accent` for work waiting on the user, like transactions to review in the
  sidebar. At most one accent badge per list, or none of them stand out.
- `neutral` for a plain count.

Pass `aria-label` saying what the number counts; a bare "3" means nothing to
a screen reader. Hide the badge when the count is 0.

```tsx
// Correct: countLabel is `${reviewCount} to review`
{
  count ? (
    <Badge tone="accent" aria-label={countLabel}>
      {count}
    </Badge>
  ) : null;
}

// Incorrect: a count with no meaning and a zero that shouldn't show
<Badge tone="accent">{0}</Badge>;
```
