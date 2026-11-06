# One seed produces exactly one course — no variant index

The original brief proposed three variants per generation, addressed by a `variantIndex`. We dropped that: a recipe and a seed produce exactly one course, and "show me another" is a new seed. This removes the variant index from the data model, the reproducibility contract and the share code (`recipe + seed`, nothing else), and matches how the user actually browses: tap "new seed" until a course looks good.

Reproducibility across phones and builds was later dropped (ADR 0009); one seed is still one course within a build.
