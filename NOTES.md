# Notes

These are flow of consciousness notes. Agents, please ignore this file.

## Ideas to explore

## What's unique or noteworthy

- Is based on a different foundation: wiring diagrams
- Takes full advantage of TypeScript features.
- Functional: abstractions are functions that modify CFN resources rather than black boxes
    - "boxes compose without owning" - sounds like a good slogan to use in some places
    - Can be composed sequentially, in parallel, or nested
- Because user controls logical IDs, they make more sense in the CFN template (fewer hashes and contractions)
- Main selling points:
  - More resistant to refactoring
  - Amenable to automatic refactoring
  - Easier to check for backward compatibility
  - The diagram shown in the visual tool IS the program.


## Alternative paths

- What would it look like if this was implemented in another language?
    - Would it be more ergonomic in Lisp/Clojure?
    - If it were in Haskell, could we use typeclasses and all that?
 
## TODO

- Improve the GUI:
  - Show the name of each input port right next to it in some way. Maybe just above the input wire.
  - The ability to click on a box, and all other boxes get faded, except the ones directly connected to it (input and output)
  - Add editing capability. Right now, it's readonly
  - Show nested boxes INSIDE their container boxes