# <Task Title>

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

## User Request / Topic

- 

## Goal

A good Goal is more than a larger prompt. It is a compact contract for how the agent should work, what counts as success, and what should happen if success is not yet reachable.

The strongest Goals usually define six things:
* Outcome: what should be true when the work is done.
* Verification surface: the test, benchmark, report, artifact, command output, or source material that proves it.
* Constraints: what must not regress while the agent works.
* Boundaries: which files, tools, data, repositories, or resources the agent may use.
* Iteration policy: how the agent should decide what to try next after each attempt.
* Blocked stop condition: when the agent should stop and report that no defensible path remains under the current limits.

A useful pattern is:

```text
/goal <desired end state> verified by <specific evidence> while preserving <constraints>. Use <allowed inputs, tools, or boundaries>. Between iterations, <how the agent should choose the next best action>. If blocked or no valid paths remain, <what the agent should report and what would unlock progress>.
```

## Current State

- 

## Decisions / Discussion

-


## Verification / Test

-

## Implementation Walkthrough

-

## TODO / Follow-ups

- 
