---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript Rules

Loaded only when Claude reads or edits a `.ts`/`.tsx` file.

## Strict compiler config

`tsconfig.json` must have:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- Never use `any`. Use `unknown` and narrow it, or define a proper type.
- No `as` casts to bypass the type checker, and no non-null assertions (`!`) unless immediately preceded by a one-line comment explaining why it's safe.
- Every exported function has explicit parameter types and an explicit return type.
- No unused variables, params, or imports.

## Falsy checks — prefer conciseness over explicit comparison chains

Prefer optional chaining and truthy/falsy checks over verbose, explicit null/undefined comparisons:

```typescript
// Avoid
if (a != null && a != undefined && a.length > 0) { ... }

// Prefer
if (a?.length) { ... }
```

- `x != null` (loose equality) already covers both `null` and `undefined` — never chain `&& x != undefined` after it, it's redundant and violates DRY.
- Use `??` (nullish coalescing) instead of `||` whenever `0`, `''`, or `false` are valid values you don't want accidentally overridden.
- If the project's ESLint config enables `strict-boolean-expressions`, a bare truthy check on a non-boolean type (`number | undefined`) will be rejected — use `(a?.length ?? 0) > 0` instead in that case. Pick one policy for the codebase and keep it consistent; don't mix both styles in the same file.

## Early return, TypeScript-flavored

Combine guard clauses with `?.` / `??` for flat, readable validation instead of nested conditionals:

```typescript
const getDiscountedPrice = (item?: LineItem): number => {
  if (!item?.basePrice) return 0;
  // ...rest of the logic, unnested
};
```

## Type composition — derive, don't redefine

Prefer deriving a new type from an existing one with `Pick`, `Omit`, `Partial`, or intersections (`&`) instead of manually re-declaring a new interface/type that copies fields that already exist elsewhere. This is DRY applied to types: a hand-copied field silently drifts out of sync when the source type changes.

```typescript
interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

// Avoid — re-defines fields that already exist on User; can drift out of sync
interface UserSummary {
  id: string;
  name: string;
}

// Prefer — derived, stays in sync with User automatically
type UserSummary = Pick<User, "id" | "name">;
```

When deriving from more than one source, don't pull the same property from a redundant second source if one already contains it:

```typescript
interface A {
  prop1: string;
  prop2: string;
}
interface B extends A {
  prop3: string;
}

// Avoid — prop2 already comes from A via B, pulling it from two sources is noise
type C = Pick<A, "prop1"> & Pick<B, "prop2">;

// Prefer — single source
type C = Pick<A, "prop1" | "prop2">;
```

## TSDoc — concise

Every exported function, class, type, and interface gets a TSDoc block. Summary + tags only, no filler:

```typescript
/**
 * Returns the discounted price for a single cart line item.
 * @param item - line item to price
 * @param rules - active discount rules
 * @returns final price in cents, never negative
 */
```

- One-line summary that says what it does or why it exists — don't restate the function name.
- `@param` / `@returns` only when the name/type doesn't already make it obvious.
- `@throws` only if the function can throw.
- No `@example` unless usage is genuinely non-obvious.

## Numbered inline comments when TSDoc isn't enough

If a function body has logic the TSDoc summary can't fully convey — multi-step algorithms, branching business rules, non-obvious edge cases — add short numbered comments above each step. Don't narrate obvious lines.

```typescript
/**
 * Calculates the discounted price for a cart line item.
 * @param item - line item to price
 * @param rules - active discount rules
 * @returns final price in cents
 */
const calculateLineItemPrice = (item: LineItem, rules: DiscountRule[]): number => {
  if (!item?.basePrice) return 0;

  // 1. Only rules matching this item's category apply.
  const applicable = rules.filter((r) => r.category === item.category);

  // 2. Rules don't stack — use the single highest-value one.
  const best = applicable.sort((a, b) => b.value - a.value)[0];

  // 3. Guard against a negative price from an oversized fixed discount.
  return Math.max(0, item.basePrice - (best?.value ?? 0));
};
```

## Refer arrow function instead of function keyword

Prefer arrow function instead of function keyword, except when it is a method of a class.

```typescript
// Avoid
function foo() {
  return 1;
}

// Prefer
const foo = () => 1;
```

## Self-check before finishing a task

- [ ] `tsc --noEmit` passes — no `any`, no unjustified `!`
- [ ] Falsy/optional-chaining style used instead of verbose null chains, consistent across the file
- [ ] Nested if-else replaced by early return where it applies
- [ ] New types derive from existing ones (Pick/Omit/intersection) instead of hand-copied fields, with no redundant multi-source pulls
- [ ] All exports have concise TSDoc
- [ ] Non-obvious function bodies have numbered step comments
