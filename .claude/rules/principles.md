# Coding Principles

No `paths` frontmatter — this file loads every session, for every file type.

## Scope

Apply strictly to business logic under `src/`. Relax for tests (some duplication for readability is fine), one-off scripts, config files, and generated/vendor code — don't force these rules where they add friction without benefit.

## DRY — Don't Repeat Yourself

- Rule of three: extract shared logic into a function/utility on the **third** duplication, not the first. Abstracting earlier is premature and violates YAGNI.
- Reuse existing types/interfaces instead of redefining an equivalent shape.
- Centralize validation, formatting, and mapping logic once — don't duplicate it across layers.

## YAGNI — You Aren't Gonna Need It

- No config flags, params, or abstraction layers for a use case that doesn't exist yet.
- No generic/pluggable design when the codebase only has one concrete use case.
- Delete dead code, unused exports, and commented-out code instead of keeping it "just in case."

## KISS — Keep It Simple

- A function does one thing. If describing it needs "and," split it.
- **Early return / guard clause**: exit as soon as a condition rules out the rest of the function, instead of nesting the remaining logic inside `else`. Flat beats nested.

```typescript
// Avoid — nested
const process = (user: User | null) => {
  if (user != null) {
    if (user.isActive) {
      return doSomething(user);
    } else {
      return null;
    }
  } else {
    return null;
  }
};

// Prefer — early return, flat
const process = (user?: User | null) => {
  if (!user?.isActive) return null;
  return doSomething(user);
};
```

- If an if/else-if chain branches more than ~3 times on the **same discriminant** (a type, status, or role field), replace it with a `switch` (with an exhaustiveness check) or a lookup `Record`/`Map`. This also serves Open/Closed: adding a new case doesn't require editing the old chain.
- Don't add an indirection layer (factory, wrapper, manager) unless it removes real duplication — an extra layer that doesn't reduce duplication is complexity for its own sake.

## SOLID

- **S — Single Responsibility**: one reason to change per function/class/module.
- **O — Open/Closed**: extend behavior via new functions/composition rather than editing working, unrelated logic.
- **L — Liskov Substitution**: any implementation of an interface/base type must be swappable without breaking callers' expectations.
- **I — Interface Segregation**: prefer several small, focused interfaces/types over one large one callers only partially use.
- **D — Dependency Inversion**: depend on interfaces/abstractions; inject dependencies (services, clients, repos) rather than hardcoding concrete implementations inside logic.

## Self-check before finishing a task

- [ ] No duplicated logic that should be extracted (DRY)
- [ ] No speculative/unused code or params (YAGNI)
- [ ] Each function does one thing; nesting flattened with early return where it applies (KISS)
- [ ] Responsibilities, interfaces, and dependencies are properly separated (SOLID)
