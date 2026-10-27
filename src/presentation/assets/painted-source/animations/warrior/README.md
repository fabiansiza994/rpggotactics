# Warrior authored assets

The final active assembly is manifest.json (44 poses × 4 directions = 176). Source canvas 512×512 RGBA; foot anchor (256,448); runtime cells 256 with three columns. Block aliases Guard hold poses. Five Bash frames use authored source indices 0,1,2,3,5. Older unused alternatives are retained for review.

Use e2e/prepare-warrior-assets.py with Python + Pillow. The script writes only Warrior assets and contact sheets. Pose sheets are authored raster images, not transforms of a single idle image. Attack RIGHT contact/followthrough have independent full-frame sources because a wide sheet cut their weapon tips. Head/foot annotations preserve body size while importing them. Connected-alpha cleanup removes adjacent-cell fragments. Rest frames are 372 px tall; raised weapons remain inside the safe margins.

Portrait master is separate from the normalized board fallback. No runtime image generation. Final prompts and visual QA: qa/warrior/visual and qa/warrior/VISUAL_REPORT.md.
