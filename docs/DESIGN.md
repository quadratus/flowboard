# Flowboard UI design plan

Method: `frontend-design` skill (plan → review against defaults → build → critique with screenshots).

## Brief

- **Subject:** a work tracker for one product team. Work flows through columns, and each list can have its own columns.
- **Audience:** engineers and leads who keep the board open all day. Also a reviewer who has 5 minutes to judge whether scoped statuses, custom fields and permissions work.
- **Primary job:** show where each piece of work is, and make the inheritance model visible. A reviewer must see _why_ List A and List B have different columns.

## Direction: "the signal box"

A railway signal box controls a flow of trains through fixed sections on a lit panel. Flowboard does the same with tasks through status columns. From this world the design takes:

- a dark control-panel rail on the left (the tree);
- a pale panel surface for the board;
- coloured signal lamps for statuses;
- amber for the "attention" state (focus, drag, selection).

It takes no skeuomorphic texture, no rivets and no trains.

## Tokens

| Name         | Hex       | Role                                                         |
| ------------ | --------- | ------------------------------------------------------------ |
| Panel        | `#1F2A2E` | Sidebar rail, top of the drawer, primary buttons             |
| Panel text   | `#C9D3D1` | Text on the rail                                             |
| Surface      | `#E7EAE6` | Board background: a grey with a slight green tint, not cream |
| Paper        | `#FBFCFA` | Cards, table rows, drawer body                               |
| Ink          | `#1B2124` | Body text                                                    |
| Signal amber | `#E8A317` | Focus ring, drag lift, selected tree item, unsaved changes   |

Status and option colours come from the data (the seed and the config UI), so the board shows real values.

## Type

**Bricolage Grotesque** (variable: weight, width and optical size) is the only family.

- **List title:** 40px, condensed width (`wdth` 75), weight 700, display optical size. The type is the header; the page needs no logo block.
- **Column names:** 15px, semi-condensed, weight 650.
- **UI and body:** 14/20, normal width, text optical size.
- **Numbers:** tabular figures (`font-variant-numeric: tabular-nums`) for estimates, counts and dates.

The design uses no mono face, no all-caps labels and no eyebrow text.

## Layout

```
┌───────────────┬──────────────────────────────────────────────────────────────┐
│ Flowboard     │ Engineering / Q2 Launch                  Board  Table   ⚙   │
│               │ Sprint                                          [Alice ▾]    │
│ Engineering   │──────────────────────────────────────────────────────────────│
│  Q2 Launch    │ To do 2      In progress 2   In review 2   Blocked 1   Shipped│
│ ▌ Sprint      │ workspace    workspace       Engineering   this list   Q2 Lau.│
│   Backlog     │ ┌─────────┐ ┌─────────┐                                       │
│ Leadership 🔒 │ │ card    │ │ card    │                                       │
│  Hiring       │ └─────────┘ └─────────┘                                       │
│   Pipeline    │                                                ┌─ drawer ──┐  │
└───────────────┴────────────────────────────────────────────────┴───────────┘──┘
```

- Everything is left-aligned. Columns have a fixed width of 272px, sit on the surface without a box, and are separated by space, not borders.
- Cards are paper with a 1px hairline and a 6px radius. They have no resting shadow. A card gets an amber outline and a lift shadow only while the user drags it.
- The task drawer slides in from the right over the board. That is the only entrance animation, and it answers a click.

## The one bold element

**The column header shows the lineage of each status.** Under each column name, a small line names the level that owns it: "workspace", "Engineering", "Q2 Launch" or "this list". A status that overrides an ancestor shows the overriding level. This puts the main graded feature on screen without a single tooltip. Fields in the drawer use the same pattern.

Everything else stays quiet.

## Review against generic defaults

| Default trait                                               | Risk here                                                                                 | Decision                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Cream background with a serif and a terracotta accent       | None. The surface is a cool grey-green, the type is a grotesque, and the accent is amber. | Keep                                                                                                      |
| Near-black with one acid accent                             | The rail is dark                                                                          | Kept the dark part on the rail only, used a blue-green tone (not `#111`), and kept the main surface light |
| SaaS-card kit (every block a card, one radius, grey shadow) | Kanban boards default to this                                                             | Columns have no box; cards have no resting shadow; radii differ by role: card 6, button 999, drawer 0     |
| Mono for small data labels, `A · B · C` meta strings        | Card metadata invites it                                                                  | Tabular figures in the text face; metadata as separate small elements, not joined with dots               |
| ALL-CAPS eyebrows                                           | Column headers invite it                                                                  | Sentence-case names; lineage line in normal case                                                          |

**Change after the review:** the first draft had a top bar with the logo, a search field and an avatar. A search field does nothing in this scope, and the logo repeats the rail. I removed the top bar. The list title is the header, and the user switcher sits at its right.

## Quality floor

- Visible keyboard focus: a 2px amber ring.
- `prefers-reduced-motion`: no drawer slide.
- Contrast: AA for text on paper and on the rail.
- Drag and drop has a keyboard path (dnd-kit keyboard sensor) and a non-drag path (the status select in the drawer).
- Layout: desktop first. Below 900px the rail collapses and the board scrolls sideways.

## Critique log

Checked with the `agent-browser` CLI at 1440×900 and 390×844.

| Pass | Finding                                                                     | Change                                                      |
| ---- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1    | Home opened Pipeline, the last list in the tree                             | Home opens the first list in sidebar order                  |
| 1    | "Overdue · 8 Nov" used the dot-joined meta pattern that the plan rejects    | Date first, then a separate "overdue" word                  |
| 2    | Five Sprint columns overflowed at 1440px, so "Shipped" was cut off          | Columns flex from 200px to 300px and share the width        |
| 2    | Two-letter initials overlapped in the avatar stack                          | One initial: the three demo users have unique first letters |
| 3    | A save remounted the drawer (keyed by `updatedAt`), so "Saved" never showed | Key the form by `listId`: it remounts only after a move     |
| 3    | A user switch left the old user's tree on screen                            | A switch reloads the app, like a log out and log in         |
| 4    | Remap prompt, table view, Bob's 403 page and the 390px layout               | No change needed                                            |
