# Visual Cohesion Pass V1 (Holistic Direction)

## Visual Direction Statement

Design identity: **Operational Command Surface**

Desired feeling:
- Calm under pressure
- Structured at first glance
- Trustworthy and mature
- Governance-forward, not decorative

This direction treats the workspace as a decision console, not a marketing surface.

## What Was Intentionally Removed

1. Ambient glow/noise layers in workspace background.
2. Decorative hero motion in operational contexts.
3. Mixed visual metaphors (glass + glow + heavy gradient overlap).
4. Inconsistent spacing increments (`*.5` utility drift in core workspace shell).
5. Micro-label emphasis that competed with actionable project signals.

## What Was Intentionally Added

1. Semantic governance visibility:
- WIP breach state
- Overdue counts and per-card overdue markers
- Priority escalation markers

2. Single rhythm spacing model for core workspace:
- `4, 8, 12, 16, 20, 24, 32, 40px`
- tokenized as `--ds-space-1/2/3/4/5/6/8/10`

3. Title-first card composition:
- project title dominates
- governance strip second
- metadata tertiary

4. Focus clarity:
- high-contrast focus ring with tested >= `3:1` contrast in dark workspace.

5. Board-first composition:
- KPI strip designed for sub-3-second governance scan
- column header governance summary before card scanning

## Full Workspace Cohesion Plan

1. Shell (`Sidebar + Header + Main`):
- unify border/elevation depth
- remove ornamental contrast spikes
- preserve quick action accessibility

2. Kanban:
- keep logic untouched
- keep drag/drop behavior untouched
- improve structural hierarchy and governance legibility

3. Dashboard / Roadmap / Table:
- align section framing to the same surface/elevation system
- apply the same spacing scale and text hierarchy
- no decorative treatment that competes with operational content

4. Modal and Popover surfaces:
- unify edge radius + border + scrim density
- prioritize form readability and action clarity

## Acceptance Criteria (Visual Maturity)

1. Sub-3-second scan of governance KPI strip.
2. Card title remains primary focal point in dense columns.
3. Overdue and escalation states are unmistakable without glow effects.
4. No visible spacing drift in core workspace shell.
5. No text/chip overflow or baseline misalignment in target viewport.
