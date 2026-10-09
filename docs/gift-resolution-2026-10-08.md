# Gift resolution — v12.2.72

Gift now has an explicit CONTROL-stage handler in the existing deterministic engine. Applicable action blocks retain precedence; a blocked attempt does not spend a use. An eligible attempt to one living recipient returns SUCCESS with an external-GM-delivery explanation. It creates no inventory, ability grant, random reward, or status effect. Gift details are not needed to determine delivery success.

Existing source-specific CUSTOM definitions are not silently overwritten. For the saved Cade–Inventor review, set standardized ability type to Gift and category to CONTROL, then Recalculate. This explicitly reviewed reclassification overrides stale custom metadata while preserving the original ability identity. Review recalculated outcomes before finalizing; this release does not automatically apply or advance any game.

Four new isolated tests cover success without generated effects/grants, block with no consumption, dead recipient rejection, and reclassification of the saved-style custom Cade action. Full suite: 1,074 passed, zero failures/skips; static build passed. The historical v11.6 migration test still verifies its original 37 seed entries; Gift is a new client-side standard, not a retroactive migration edit. No database or Edge Function deployment required for deterministic review handling.
