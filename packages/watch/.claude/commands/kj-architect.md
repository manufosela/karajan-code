# kj-architect — Architecture Design

Analyze the task and propose an architecture before implementation.

## Your task

$ARGUMENTS

## Steps

1. Read the task and understand the requirements
2. Explore the existing codebase structure (`ls`, `find`, read key files)
3. Identify the appropriate architectural approach
4. Propose a design with tradeoffs

## What to deliver

### Architecture overview
- Architecture type (layered, hexagonal, event-driven, etc.)
- Key components/layers and their responsibilities
- Data flow between components

### API contracts (if applicable)
- Endpoints with method, path, request/response schema
- Error handling strategy

### Data model changes (if applicable)
- New entities/collections
- Modified fields
- Migration strategy

### Tradeoffs
- For each design decision: what was chosen, why, and what alternatives were considered
- Constraints that influenced the design

### Clarification questions
- Any ambiguities that could affect the architecture
- Decisions that need stakeholder input

## Constraints

- Follow existing patterns in the codebase — don't introduce a new architecture without justification
- Keep it simple — the right amount of complexity is the minimum needed
- Consider testability in every design decision
- Do NOT start coding — this is design only
