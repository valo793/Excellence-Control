# Kanban Structural Mock V1 (Low Fidelity)

Scope: hierarchy and operational flow only. No visual decoration.

## Desktop Wireframe

```text
+--------------------------------------------------------------------------------------------------------------+
| Header: [Menu] [Search.....................................] [Filters] [Tools] [New Project]               |
+--------------------------------------------------------------------------------------------------------------+
| KPI Strip: [Active Projects] [WIP Breaches] [Overdue Items] [High Priority Open] [Realized vs Target]     |
+--------------------------------------------------------------------------------------------------------------+
| Board Controls: [Show Archived] [Group/Sort] [Density: Comfortable|Compact] [Swimlane toggle]              |
+--------------------------------------------------------------------------------------------------------------+
| BACKLOG (12 / WIP 8) | TODO (24 / WIP 16) | IN PROGRESS (18 / WIP 12) | REVIEW (5 / WIP 8) | DONE (40)    |
| -------------------- | ------------------ | -------------------------- | ------------------ | ------------ |
| [Card]               | [Card]             | [Card]                     | [Card]             | [Card]       |
| Priority             | Priority           | Priority + Overdue flag    | Priority           | Completion   |
| Owner + Due + Value  | Owner + Due + Value| Owner + Due + Value        | Owner + Due + Value| Owner + Date |
| Governance line      | Governance line    | Governance line            | Governance line    | Governance   |
| -------------------- | ------------------ | -------------------------- | ------------------ | ------------ |
| Empty state / CTA    | ...                | ...                        | ...                | ...          |
+--------------------------------------------------------------------------------------------------------------+
```

## Tablet Wireframe

```text
+--------------------------------------------------------------------------------+
| Header: [Menu] [Search.............] [Filters] [New]                          |
+--------------------------------------------------------------------------------+
| KPI Strip (horizontal scroll): [Active] [WIP] [Overdue] [Priority] [Value]    |
+--------------------------------------------------------------------------------+
| Column Tabs: [BACKLOG] [TODO] [IN PROGRESS] [REVIEW] [DONE] [ARCHIVED]        |
+--------------------------------------------------------------------------------+
| Active Column View                                                             |
| [Column Header: Count + WIP target + governance summary]                       |
| [Card]                                                                          |
| [Card]                                                                          |
| [Card]                                                                          |
+--------------------------------------------------------------------------------+
```

## Card Hierarchy (Per Card)

```text
1) Title + Priority
2) Governance strip (Overdue | At Risk | WIP breach relation | Blocked)
3) Key metadata (Owner, Due Date, Area)
4) Secondary metadata (Value, Category, Tags)
5) Action row (Open, Quick status move)
```

## Governance Signal Model

```text
Priority:
- Critical: strong semantic color + icon marker
- High: warning semantic color
- Medium/Low: neutral semantic color

Overdue:
- Explicit overdue label + age (e.g., "Overdue 6d")
- Column-level overdue count in header

WIP:
- Column header displays "current / target"
- Breach state uses semantic warning/danger, no glow
```

## Interaction Model (Structural)

```text
Hover:
- card border emphasis only

Drag:
- dedicated drag handle
- drop-zone highlight at column level
- optimistic update + rollback on error

Keyboard:
- tab sequence: board controls -> column headers -> cards
- arrow-based navigation between cards (planned)
- visible focus ring on every interactive element
```

## Validation Gate Before Kanban Refactor

1. Confirm this hierarchy keeps Kanban as the primary operational center.
2. Confirm KPI strip metrics are the five governance-critical signals.
3. Confirm card information density (5 layers) is acceptable for manager workflows.
4. Confirm tablet behavior (tabs + single active column) before implementation.
