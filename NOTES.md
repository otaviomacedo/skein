# Notes

These are flow of consciousness notes. Agents, please ignore this file.

## Ideas to explore

## What's unique or noteworthy

- Takes full advantage of TypeScript features.
- Functional: abstractions are functions that modify CFN resources rather than black boxes
    - "boxes compose without owning" - sounds like a good slogan to use in some places
    - Can be composed sequentially, in parallel, or nested
- Backed by a semantic formalism: wiring diagrams
    - Easier to perform mechanical refactors (check this claim). My hypothesis: since two programs
      that have the same wiring diagrams are equivalent, any composition of boxes (including
      nesting) can be replaced with another composition that produces the same diagram. And it
      should not be too hard to find such possible compositions, given a program and a library of
      boxes.
- More resistant to refactoring

## Alternative paths

- What would it look like if this was implemented in another language?
    - Would it be more ergonomic in Lisp/Clojure?
    - If it were in Haskell, could we use typeclasses and all that?