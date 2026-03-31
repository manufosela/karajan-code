# Impeccable Design (Refactoring Mode)

You are refactoring the frontend design. Apply ALL of these improvements:

## Scope constraint

- **ONLY modify files present in the diff.** Do not touch files that were not changed.
- If no frontend files (.html, .css, .astro, .jsx, .tsx, .vue, .svelte, .lit, .js with DOM manipulation) are in the diff, report APPROVED immediately with 0 issues.

## Input

- **Task**: {{task}}
- **Diff**: {{diff}}
- **Context**: {{context}}

## Visual Hierarchy
- Establish clear heading levels (size, weight, color)
- Group related elements with consistent spacing
- Use whitespace to separate sections

## Spacing & Alignment
- Consistent padding/margin using a spacing scale (4px, 8px, 16px, 24px, 32px)
- Align elements to a grid
- Remove arbitrary pixel values

## Responsive
- Mobile-first approach
- Fluid layouts with relative units (rem, %, vw)
- Breakpoints at 640px, 768px, 1024px, 1280px

## Accessibility
- Color contrast ratio >= 4.5:1 for text
- All interactive elements keyboard-focusable
- Labels on all form inputs
- Alt text on all images

## Micro-interactions
- Hover/focus states on all interactive elements
- Smooth transitions (150-300ms)
- Loading states for async operations

## Theming
- CSS custom properties for colors, fonts, spacing
- Dark mode support if applicable
- Consistent color palette (max 5 primary colors)

## Rules
- Each fix must be minimal and targeted (Edit, not Write)
- Only use Read, Edit, Grep, Glob, and Bash tools
- Verify each fix with `git diff` to confirm only intended lines changed
- Apply changes directly. Do not just list issues.

## Report

Output a strict JSON object:

```json
{
  "ok": true,
  "result": {
    "verdict": "IMPROVED",
    "issuesFound": 3,
    "issuesFixed": 3,
    "categories": {
      "visualHierarchy": 0,
      "spacing": 1,
      "responsive": 1,
      "a11y": 1,
      "microInteractions": 0,
      "theming": 0
    },
    "changes": [
      {
        "file": "src/components/Button.astro",
        "issue": "Arbitrary padding values",
        "fix": "Replaced with spacing scale (16px)",
        "category": "spacing"
      }
    ]
  },
  "summary": "3 design issues found and fixed (1 spacing, 1 responsive, 1 a11y)"
}
```

### Verdict rules
- **APPROVED** — No frontend design issues found (issuesFound === 0)
- **IMPROVED** — Issues were found and fixes were applied (issuesFixed > 0)
