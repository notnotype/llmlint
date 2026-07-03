# Web Review Editor

## Relative documents refs

- `web/app/pages/index.vue`
- `web/app/components/TextPanel.vue`
- `web/app/components/HighlightedTextarea.vue`
- `web/app/composables/useLlmlint.ts`
- NeuroBook reference: `../neuro-book/app/components/markdown-studio/TipTapMarkdownEditor.vue`
- NeuroBook reference: `../neuro-book/app/components/markdown-studio/tiptap/InlineComment.ts`

## User Request / Topic

- Optimize the rule review interface after the user uploads or submits text.
- Consider TipTap for the editor.
- Support Markdown rendered mode and source text mode where Markdown syntax characters are visible.
- Let users select body text and add comments.
- Show regex replacement in the body when a deterministic replacement exists.

## Goal

Implement a practical first version of the llmlint review editor verified by the local web typecheck and a browser review path, while preserving the existing llmlint scan/filter/report contracts.

Constraints:

- Keep one Markdown string as the source of truth.
- Keep regex scanning and report export based on the original text and UTF-16 offsets.
- Do not copy NeuroBook's full Markdown Studio; reuse only relevant TipTap ideas.
- Do not write review comments into the submitted text.
- Do not enable automatic replacement for candidate/manual rules.

## Current State

- The detection page uses `TextPanel.vue` with `HighlightedTextarea.vue`.
- The source pane is precise because textarea offsets match scanner offsets.
- Existing two-way navigation is `Issue -> offset -> textarea scroll` and `textarea caret -> Issue`.
- The current textarea/backdrop design is not a good long-term fit for rendered Markdown, side comments, or inline replacement previews.

## Decisions / Discussion

- Use a dedicated llmlint `ReviewEditor` instead of migrating NeuroBook `TipTapMarkdownEditor.vue` wholesale.
- Use two editor surfaces with a single truth state:
  - `source`: precise text mode, Markdown syntax visible.
  - `preview`: TipTap rendered Markdown mode, optimized for reading and sidecar review annotations.
- Store comments as sidecar review data in the current scan session. They are not serialized back into Markdown.
- Show deterministic replacements only for `fixability: "auto"` rules with `action.type === "replace"`.
- Keep source mode as the precise contract. Preview decorations can be improved independently without changing scan semantics.

2026-07-02 inline menu iteration:

- Add a llmlint-specific TipTap `BubbleMenu` instead of copying NeuroBook's full formatting menu. The review editor needs review actions, not a general Markdown formatting toolbar.
- Preview selection menu actions: add sidecar comment, copy selection, locate source mode, and accept the selected auto replacement when the selection intersects a replaceable issue.
- Preview comments are only allowed when the selected rendered text maps uniquely back to the Markdown source. Repeated text shows a menu hint and asks the user to switch to source mode.
- Single issue replacement now uses the shared fix engine in full-text context, so lookbehind/capture/delete replacements match CLI semantics.
- Source edits transform sidecar comment ranges by a minimal diff: edits before a comment shift it, edits overlapping a comment delete it.
- Empty replacements are first-class delete actions: buttons and inline preview show "删除" instead of rendering a blank arrow.
- The inline menu opens below the selection in llmlint so it does not cover the editor mode switcher near the top of the panel.
- Sidecar comments now have a NeuroBook-like activation loop: clicking a comment mark activates the card, and clicking a comment card switches to preview mode and scrolls the marked text into view.
- Sidecar comments can be edited in-place from the comments rail. Editing updates only the comment body and keeps the reviewed range/quote stable.
- The workbench summary now exposes hidden hits as a one-click action. If default filters hide mechanical/human hits, users can reveal all hits without understanding every filter first.

2026-07-02 source menu / responsive iteration:

- Source mode now has its own inline selection menu instead of the old top-of-editor selection form. This keeps source mode as the precise UTF-16 textarea contract while giving it the same review affordance shape as the TipTap preview menu.
- `HighlightedTextarea` reports a local selection anchor calculated through a textarea mirror box. It does not own review actions; it only reports source selection text, offsets, and menu position.
- `ReviewSourceSelectionMenu.vue` routes source actions through the same sidecar comment and single-replacement events as preview mode: add comment, copy selection, and apply a selected auto replacement.
- The comment rail is no longer desktop-only. On mobile/narrow screens it becomes a bottom rail inside the editor, so comments added from source/preview remain visible and editable.

2026-07-02 unified text-change iteration:

- `TextPanel` now transforms sidecar comment ranges from a single watcher on the actual Markdown text value. This covers ordinary typing, source inline single replacements, preview replacements, parent-level one-click mechanical cleaning, and undo from the notification.
- `updateText()` and `acceptReplacement()` only commit the next text value. They no longer each own their own comment transform path, so future text-change entry points are less likely to skip comment maintenance.

2026-07-02 locate-state iteration:

- Clicking an issue in the right report list now updates the current active issue, not only the active rule id and source offset. This keeps the top replacement action, source highlight, and preview highlight aligned with the clicked issue.
- Preview issue decorations now include an active state for the currently located issue. The user gets a visible target in rendered Markdown after navigating from the issue list.
- Selection replacement actions now clear the current inline menu state after applying a replacement, preventing stale source/preview selection menus from lingering over changed text.

2026-07-02 selection lifecycle iteration:

- Inline comment actions now clear the current review selection after saving. Source and preview menus no longer remain pinned over text after a comment has been created.
- `HighlightedTextarea` exposes a small `collapseSelection(offset)` method so `ReviewEditor` can fold the source textarea selection after a source inline action. This prevents the next keystroke from accidentally replacing the just-reviewed text.
- Preview `ReviewSelectionMenu` is only mounted while `ReviewEditor` has a current review selection. Clearing selection now unmounts the TipTap BubbleMenu, instead of relying on ProseMirror focus state alone.

2026-07-02 preview locate-on-mode iteration:

- Preview issue scrolling now reacts to `mode`, `locateOffset`, and `activeIssueMark`. If the user clicks a report issue while in source mode and then switches to preview, the rendered Markdown scrolls to the active issue instead of staying at the top.
- The preview scroll waits for the mounted TipTap layout and scrolls the `.llmlint-review-editor` container directly. Long documents use immediate positioning so the target is visible without waiting for a long smooth-scroll animation.

2026-07-02 source menu placement iteration:

- Source inline menu now receives the textarea visible height with the selection anchor. When the selected text is near the bottom of a long source document, the menu flips above the selection instead of overflowing below the editor.
- This keeps source-mode comment/copy/replace actions reachable after the user scrolls to the end of a document.

2026-07-02 preview-to-source locate iteration:

- The preview inline menu's "locate source" action now preserves a pending source offset. After the editor switches to source mode, `HighlightedTextarea` reveals that offset and folds the caret there.
- `HighlightedTextarea` owns the reveal math because it knows the textarea layout and scroll model. `ReviewEditor` only coordinates the pending offset and mode switch.

2026-07-02 source menu scroll-follow iteration:

- Source textarea scrolling now refreshes the current source selection anchor. If the user scrolls after selecting text, the source inline menu follows the selected text instead of staying at its old screen position.

2026-07-02 source comment projection iteration:

- Source mode now projects sidecar comments into the textarea highlight backdrop. Commented text receives an accent underline/background while the Markdown string remains unchanged.
- `HighlightedTextarea` now splits text by both issue ranges and comment ranges, so rule highlights and comment marks can overlap without dropping either visual signal.

2026-07-02 comment card activation iteration:

- Comment rail activation now respects the current editor mode. Clicking a comment card in source mode keeps the user in source mode and reveals the comment offset in the textarea; clicking in preview mode keeps the preview mark activation behavior.
- Source comment projection now has an active visual state, so the selected comment is distinguishable in source mode.

2026-07-02 new comment activation iteration:

- Newly added comments now become the active comment automatically. This gives immediate source/preview feedback after saving a comment instead of requiring the user to click the new card.
- This is a UI activation state only; the sidecar comment storage model remains unchanged.

2026-07-02 source menu horizontal placement iteration:

- Source inline menu now receives the textarea visible width with the selection anchor. For selections near the left edge it opens to the right; near the right edge it opens to the left; otherwise it remains centered.
- This prevents the source menu from overflowing horizontally for one-character selections at line starts or line ends on desktop and mobile.
- The expanded source comment form is also clamped by estimated menu width, so opening the comment input near the mobile left/right edge does not push the menu outside the editor.

2026-07-02 filter active-state iteration:

- Active issue/rule state is now cleared when the current filtered issue set no longer contains the active issue or active rule.
- This prevents stale rule-card rings or top replacement actions from reappearing after a user hides a hit with filters and later changes the filter back.

2026-07-02 source Escape lifecycle iteration:

- Source mode now handles `Escape` at the textarea selection source of truth. Pressing `Escape` collapses the current selection to its end, clears the source inline menu, and emits the updated caret offset.
- This matches the TipTap preview menu's selection lifecycle more closely: when the user's selection is cancelled, the review action menu disappears instead of remaining pinned to stale text.
- Browser audit also rechecked the "查看全部命中" filter with source/preview mode switches. The persisted web settings keep `review=all` while `reviewEditorMode` changes, so mechanical issue marks remain available after normal mode switching.

2026-07-02 source click-outside lifecycle iteration:

- Source inline menu now closes when the user clicks outside the source editor surface and outside the source menu.
- The click-outside owner is `ReviewEditor`, not `HighlightedTextarea`, so the textarea remains responsible only for precise selection/offset reporting while the review shell owns menu lifecycle.
- Source menu internal actions are explicitly exempted, so opening the comment input, saving a comment, copying, and replacement buttons are not treated as outside clicks.

2026-07-02 preview click-outside lifecycle iteration:

- Preview BubbleMenu selection state now also closes when the user clicks outside the rendered preview and outside the preview menu.
- The top editor status no longer keeps showing "已选中" after the user leaves the preview selection by clicking the report pane or another outside area.
- Preview menu internal actions remain exempt, so adding a sidecar comment from the BubbleMenu still works normally.

2026-07-02 preview Escape lifecycle iteration:

- Preview mode now treats `Escape` as a selection-cancel action even when ProseMirror does not own keyboard focus after a DOM text selection.
- The document-level keyboard fallback skips events already handled by the BubbleMenu input, so pressing `Escape` inside the inline comment input only closes that input and keeps the current selection menu alive.
- Preview keyboard cancellation now uses the same `clearSelectionState()` path as click-outside and inline actions, keeping BubbleMenu, browser selection, and toolbar text aligned.

2026-07-02 hidden-filter empty-state iteration:

- User reported that the web page appeared unable to find issues on real NeuroBook manuscript text.
- Diagnosis with `workspace/ming-ding-zhi-shi-2/manuscript` showed the scanner and web registry were healthy: the full manuscript produced 788 total regex hits and 161 default Agent-visible hits.
- Browser reproduction showed a narrower persisted namespace filter can hide every visible hit, leaving the main result list saying only "未发现命中（当前过滤下）" while the hidden-count action sits in the summary bar.
- `IssueList` now receives the hidden count and renders a prominent filtered-empty state with the hidden issue count and a "查看全部命中" action, using the same filter-reset path as `SummaryBar`.

2026-07-02 comment resolution iteration:

- The sidecar comment model already had a `resolved` field, but the review UI had no way to use it. This made comments behave like disposable notes rather than review tasks.
- Comment cards now expose a lightweight `完成 / 重开` action. Resolved comments stay visible, but their cards and source/preview marks are visually softened.
- The comment rail header now shows unresolved/total counts, so a reviewer can see whether the current text still has open review notes.
- This remains session-local sidecar state and does not write inline comments back into Markdown.

2026-07-02 preview source-map ordinal iteration:

- Preview decoration mapping previously chose the rendered-text occurrence closest to the source UTF-16 offset. Markdown syntax characters make source offsets larger than rendered offsets, so repeated text near formatting marks could bind to the wrong rendered occurrence.
- Preview issue/comment decorations now compute the selected/matched text's occurrence index in the Markdown source and map it to the same occurrence index in rendered text.
- The old nearest-position fallback remains only for unusual cases where occurrence mapping cannot be established.
- This keeps source mode as the precise contract while making preview mode safer for repeated text around Markdown syntax such as `**重复**\n重复`.

2026-07-02 comment index iteration:

- NeuroBook inline comments expose a small in-text index badge, making it easy to match a mark in the document with the corresponding review item.
- llmlint preview comment marks now receive `data-comment-index` and render the same numbered badge style.
- Comment cards show the same index badge. The active comment uses the accent-filled badge in both preview text and the rail.
- This is a view-only ordinal derived from the current session comment order; it does not change the sidecar comment identity or Markdown source.

2026-07-02 preview duplicate selection iteration:

- Preview selection previously allowed comments only when selected text had a single source match. This was safe but forced users back to source mode even when TipTap's rendered selection made the occurrence unambiguous.
- Preview selection now computes the selected rendered text's occurrence index in the rendered document and maps it to the same occurrence in Markdown source when source/preview occurrence counts match.
- If source and preview occurrence counts diverge, preview remains conservative and asks the user to switch to source mode.
- This keeps source mode as the fallback precision contract while making common repeated-text review flows work directly in preview mode.

2026-07-02 rule-settings empty-state iteration:

- User re-reported that the web page appeared unable to find issues on real NeuroBook manuscript text.
- Diagnosis with `workspace/ming-ding-zhi-shi-2/manuscript/001-volume/001-chapter/index.md` confirmed the scanner path is healthy: CLI default review finds 61 visible Agent hits and `--review all --min-level low` finds 352 hits.
- Clean browser settings reproduce the same 61 visible hits in the web app.
- A local web rule override can disable the rules that would have matched, leaving `allIssues` empty and making the old empty state look like a real clean scan.
- `useLlmlint()` now exposes a default-rule scan path so the page can compare current settings with the default registry without changing the user's configured scan.
- `SummaryBar` and `IssueList` now distinguish rule-setting-hidden hits from filter-hidden hits. When current rule overrides hide default hits, the UI shows a dedicated "restore default rules" action instead of claiming there are no hits.

2026-07-02 source comment index iteration:

- Preview mode already showed NeuroBook-like numbered badges on comment marks, and the comment rail used the same ordinal number.
- Source mode only projected an underline/background into the textarea backdrop, so users had to infer which source mark mapped to which comment card.
- Source comment ranges now carry the current-session ordinal index into `HighlightedTextarea`.
- The source backdrop renders the same small numbered badge at the comment range start. Long comments split by issue highlight boundaries only show one badge, avoiding duplicated numbers across segments.
- Clicking a comment card in source mode keeps the source editor active and makes the matching numbered source mark active.

2026-07-02 multiline inline comment form iteration:

- The source and preview inline menus still used a single-line input for comments, which made review notes feel too throwaway compared with NeuroBook's inline comment workflow.
- Both inline comment forms now use a compact multiline textarea with explicit `保存` and `取消` actions.
- `Ctrl/Cmd+Enter` saves the current comment body, while `Esc` cancels the inline form.
- This keeps comments as session-local sidecar data and does not change Markdown serialization.

2026-07-02 source replacement hint iteration:

- Preview mode already showed deterministic auto replacements inline with `-> replacement` labels.
- Source mode kept the precise textarea contract but only showed generic issue highlight, so the exact replacement/delete action was invisible until the user selected the hit or used the top action.
- `ReviewEditor` now passes replaceable issue ranges into `HighlightedTextarea`.
- The source backdrop renders a green replacement hint badge at the start of each auto-fixable hit, including `删除` for empty replacements.
- This remains purely visual; the textarea text and scanner offsets are unchanged.

2026-07-02 single replacement undo iteration:

- Parent-level mechanical cleanup already had an undo notification, but source/preview single replacement actions were immediate and hard to recover from.
- `TextPanel` now captures the current text and sidecar comment snapshot before applying a single replacement.
- After applying a replacement, the UI shows a success notification with `撤销`.
- Undo restores both the Markdown text and the sidecar comments, so comments after the replacement do not drift or disappear during recovery.

## Verification / Test

- `cd web && bun run typecheck`
- Browser path:
  - Open `/`.
  - Submit sample text.
  - Switch source/preview modes.
  - Click rule hits and verify body navigation still works.
  - Select text in the editor and add a comment.
  - Accept an auto replacement and verify scan results refresh.

2026-07-02 results:

- `bun run typecheck`: pass. Nuxt/Vue still prints the existing `vue-router/volar/sfc-route-blocks` plugin warning.
- `bun run build`: pass. Vite prints dependency sourcemap/pure-annotation warnings only.
- Playwright smoke:
  - Submit text from `/`.
  - Switch `source -> preview -> source`.
  - Confirm TipTap preview renders Markdown heading text.
  - Select source text and add a sidecar comment.
  - Switch review filter to `none`, apply auto replacement on `测试！！！`, verify text becomes `测试！`.
  - Second browser run had no serious console errors.

2026-07-02 inline menu / 补漏 results:

- `bun test tests/llmlint.test.ts`: pass, 54 tests. Added regression coverage for single auto replacement with repeated punctuation, lookbehind deletion, zero-width deletion, capture groups, and comment range transforms.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Vite sourcemap/pure-annotation/chunk-size warnings remain.
- Playwright browser checks on `http://localhost:3001/`:
  - Submit Markdown text containing `他说……...`, `测试！！！`, a zero-width character, and repeated text.
  - Switch review filter to mechanical and editor mode to preview.
  - Select preview text and verify the inline menu appears.
  - Add a sidecar comment from the inline menu and verify it appears in the comments rail.
  - Select the `...` hit in `他说……...`, use the inline replacement action, and verify preview becomes `他说……`.
  - Select repeated `重复` text and verify the menu disables precise review actions with a source-mode hint.
  - Source mode can select and comment the second repeated `重复` occurrence precisely.
  - Mechanical single replacements work through the real UI for `测试！！！ -> 测试！`, `测\u200b试 -> 测试`, and `他说……... -> 他说……`.
  - Browser smoke caught the inline menu covering the mode switcher; menu placement was changed to bottom and revalidated.
  - Click a comment card from source mode and verify the editor switches to preview, scrolls to the comment mark, and highlights both the mark and card.
  - Edit a comment body in the comments rail, save it, and verify the updated body remains attached to the same quote.
  - Submit text with only mechanical hits under the default Agent filter, click "查看全部命中", and verify the hidden issue groups appear.

2026-07-02 source menu / responsive results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 54 tests.
- `cd web && bun run build`: pass. Existing Vite/Nitro warnings remain.
- Playwright source-mode smoke on `http://localhost:3001/`:
  - Submit text from the home state.
  - Reveal hidden mechanical hits when the default review filter hides them.
  - Select source text and verify the source inline menu appears.
  - Add a sidecar comment from the source inline menu and verify it appears in the rail.
  - Select `！！！` in source mode, use the inline replacement action, and verify `测试！！！` becomes `测试！`.
- Playwright mobile smoke:
  - Submit text at `390x844`.
  - Select source text, add a comment from the inline menu, and verify the comment rail is visible on mobile.

2026-07-02 unified text-change results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit `测试！！！\n唯一文本\n`.
  - Add a source inline comment to `唯一文本`.
  - Click the parent-level `清理机械问题` action.
  - Switch to preview and verify the comment mark still covers `唯一文本`, proving the comment range shifted after the external text change.

2026-07-02 locate-state results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit text containing `测试！！！` and `他说……...`.
  - Reveal hidden mechanical hits when needed.
  - Switch to preview, click the first issue row in the report list, and verify `.llmlint-issue-mark.is-active` appears in the rendered Markdown.
  - Switch to source, use the source inline replacement on `！！！`, verify the menu closes and text becomes `测试！`.

2026-07-02 selection lifecycle results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Select source text, add a comment through the source inline menu, and verify `.review-source-selection-menu` is hidden after save.
  - Switch to preview, select rendered text, add a comment through the TipTap BubbleMenu, and verify `.review-selection-menu` is hidden after save.

2026-07-02 preview locate-on-mode results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit a long text with `测试！！！` near the end.
  - Reveal hidden mechanical hits when needed.
  - Click the report issue while still in source mode.
  - Switch to preview and verify the active issue mark is visible inside `.llmlint-review-editor` with non-zero scroll.

2026-07-02 source menu placement results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit a long text.
  - Scroll source mode to the bottom and select the final line.
  - Verify `.review-source-selection-menu` is visible inside `.analysis-text-pane` instead of overflowing below it.

2026-07-02 preview-to-source locate results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit a long text with a unique sentence near the end.
  - Switch to preview, scroll to the end, drag-select the unique sentence, and click the inline menu's source-locate button.
  - Verify source mode opens with the textarea scrolled near the bottom and the caret collapsed at the selected sentence's source offset.

2026-07-02 source menu scroll-follow results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit a long text.
  - Select source text near the bottom.
  - Scroll the textarea and verify `.review-source-selection-menu` moves with the current selection anchor.

2026-07-02 source comment projection results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit text in source mode.
  - Add a source inline comment.
  - Verify the textarea backdrop renders a span for the commented quote with the accent comment class.

2026-07-02 comment card activation results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit a long text and add a source inline comment near the end.
  - Scroll source mode away from that comment.
  - Click the comment card and verify source mode stays active, the textarea scrolls back to the comment offset, and the source comment projection has the active outline.

2026-07-02 new comment activation results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Add a source inline comment and verify the source projection is active immediately after save.
  - Add a preview inline comment and verify `.llmlint-comment-mark.is-active` covers the newly commented text immediately after save.

2026-07-02 source menu horizontal placement results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Select a single source character at the line start on desktop and mobile, and verify the source menu stays inside `.analysis-text-pane`.
  - Select a single source character near the right edge on desktop and mobile, and verify the source menu stays inside `.analysis-text-pane`.
  - Open the source comment form near the mobile left/right edge and verify the expanded menu stays inside `.analysis-text-pane`.

2026-07-02 filter active-state results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Reveal a low-level mechanical hit and click it from the report list.
  - Change min level to high so the hit is hidden, then change back to low.
  - Verify no stale rule card ring or top replacement action remains.

2026-07-02 source Escape lifecycle results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 54 tests.
- `cd web && bun run build`: pass. Existing Vite sourcemap / VueUse pure annotation / chunk-size / Nitro deprecation warnings remain.
- Playwright browser checks on `http://localhost:3001/`:
  - Select source text and press `Escape`; verify `.review-source-selection-menu` is removed.
  - Click "查看全部命中", switch source -> preview -> source, and verify localStorage/report state keeps `review=all` while editor mode changes.
  - Run a full source/comment -> preview/comment -> delete comment -> source replacement path and verify the `！！！ -> ！` source replacement button appears when the mechanical hit is visible.

2026-07-02 source click-outside lifecycle results:

- Playwright browser checks on `http://localhost:3001/`:
  - Select source text, verify `.review-source-selection-menu` appears, click the right report pane, and verify the source menu is removed.
  - Select source text, click the source menu's comment action, save a comment, and verify the menu's internal interaction still creates one comment card and then closes normally.

2026-07-02 preview click-outside lifecycle results:

- Playwright browser checks on `http://localhost:3001/`:
  - Select preview text, verify `.review-selection-menu` appears and the toolbar says "已选中", click the right report pane, and verify the BubbleMenu is removed and the toolbar no longer shows a stale selection.
  - Select preview text, click the BubbleMenu's comment action, save a comment, and verify one comment card is created while the menu closes normally.

2026-07-02 preview Escape lifecycle results:

- Playwright browser checks on `http://localhost:3001/`:
  - Select preview text and press `Escape`; verify `.review-selection-menu` is removed and the toolbar no longer shows a stale "已选中" state.
  - Open the preview BubbleMenu comment input and press `Escape`; verify only the input closes while the selection menu and selected-text toolbar state remain available.

2026-07-02 hidden-filter empty-state results:

- CLI check on `../neuro-book/workspace/ming-ding-zhi-shi-2/manuscript`:
  - `--review all --min-level low`: 788 total visible hits.
  - default Agent review: 161 visible hits, 627 hidden by review.
- Web-registry harness against the same files:
  - 788 total hits, 161 Agent hits, 627 hidden.
- Playwright browser checks on `http://localhost:3001/`:
  - Clean local settings + chapter text shows 61 Agent hits and 291 hidden hits.
  - Persisted namespace filter `mechanical.zero-width` reproduces the confusing no-visible-hit state.
  - The result list now states that the current filter hid the hits and exposes "查看全部命中" in the empty state.

2026-07-02 comment resolution results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit text and add a source inline comment.
  - Verify the comment rail shows `未处理 1 / 1`.
  - Click `完成` and verify the rail shows `未处理 0 / 1`, the card shows `已完成`, and preview mark receives the resolved class.
  - Click `重开` and verify the rail returns to `未处理 1 / 1` and the preview resolved class is removed.

2026-07-02 preview source-map ordinal results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit `**重复**\n重复\n`.
  - Select the first source `重复` inside the Markdown bold markers and add a sidecar comment.
  - Switch to preview and verify the `.llmlint-comment-mark` is inside `<strong>`, proving the preview mark binds to the first rendered occurrence instead of the second plain occurrence.

2026-07-02 comment index results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit text with `第一处` and `第二处`.
  - Add two source-mode sidecar comments.
  - Switch to preview and verify the comment marks have `data-comment-index="1"` and `data-comment-index="2"`.
  - Click the second preview mark and verify the second comment card becomes active.

2026-07-02 preview duplicate selection results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit `重复\n\n重复\n`.
  - Switch to preview, drag-select the second rendered `重复`, and verify the inline comment button is enabled.
  - Save a comment and verify only the second preview paragraph contains `.llmlint-comment-mark`.

2026-07-02 rule-settings empty-state results:

- CLI default review on `../neuro-book/workspace/ming-ding-zhi-shi-2/manuscript/001-volume/001-chapter/index.md`: 61 visible Agent hits and 291 hidden by review.
- CLI `--review all --min-level low` on the same chapter: 352 total hits.
- Playwright browser check on `http://localhost:3001/`:
  - Clean local settings + chapter text: 26 visible rule cards and the summary contains `共 61 处`.
  - All regex namespaces disabled through local web settings: 0 visible cards and the report pane states that current rule settings closed default hits.
  - Clicking `恢复默认规则` restores visible results.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 54 tests.
- `cd web && bun run build`: pass. Existing Nuxt/Vite warnings remain: module-preload sourcemap, VueUse pure annotation, chunk size, and Node `DEP0155`.

2026-07-02 source comment index results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit `第一处\n第二处\n`.
  - Add source-mode comments to both phrases.
  - Verify source backdrop comment marks expose `data-comment-index="1"` and `data-comment-index="2"`.
  - Click the second comment card and verify the source mark with `data-comment-index="2"` becomes active.
- `cd web && bun run build`: pass. Existing Nuxt/Vite warnings remain: module-preload sourcemap, VueUse pure annotation, chunk size, and Node `DEP0155`.

2026-07-02 multiline inline comment form results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Source mode selection opens the inline comment form as a multiline textarea.
  - `Ctrl+Enter` saves a two-line source comment and the rail keeps both lines.
  - Source form `取消` closes the form without creating a comment.
  - Preview mode selection opens the same multiline comment form and saves a two-line preview comment.
  - Both menus close after save/cancel.
- `cd web && bun run build`: pass. Existing Nuxt/Vite warnings remain: module-preload sourcemap, VueUse pure annotation, chunk size, and Node `DEP0155`.

2026-07-02 source replacement hint results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit `测试！！！\n测\u200b试\n他说……...\n`.
  - Reveal hidden mechanical hits.
  - Verify source backdrop replacement badges include `！` and `删除`.
  - Select `！！！`, use the source inline replace action, and verify the text becomes `测试！`.
  - Verify remaining replacement hints update after the text changes.
- `cd web && bun run build`: pass. Existing Nuxt/Vite warnings remain: module-preload sourcemap, VueUse pure annotation, chunk size, and Node `DEP0155`.

2026-07-02 single replacement undo results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Playwright browser check on `http://localhost:3001/`:
  - Submit `测试！！！\n唯一文本\n`.
  - Add a source-mode sidecar comment on `唯一文本`.
  - Reveal hidden mechanical hits and apply source inline replacement on `！！！`.
  - Verify the notification says `已应用 1 处替换` and exposes `撤销`.
  - Click `撤销` and verify text returns to `测试！！！\n唯一文本\n`, the comment card still references `唯一文本`, and the source comment mark remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite warnings remain: module-preload sourcemap, VueUse pure annotation, chunk size, and Node `DEP0155`.

## Implementation Walkthrough

- Add TipTap dependencies to `web/package.json`.
- Add review range/replacement utilities.
- Add `ReviewEditor.vue` and a TipTap preview surface.
- Wire `TextPanel.vue` to `ReviewEditor`.
- Keep `index.vue` as the orchestration layer for scan/filter/group/report state.

2026-07-02:

- Added `web/app/utils/review-ranges.ts`.
- Added `web/app/components/ReviewEditor.vue`.
- Extended `HighlightedTextarea.vue` with selection reporting.
- Updated `TextPanel.vue` to own current-session sidecar comments and replacement application.
- Added `reviewEditorMode` to web settings.
- Kept `useLlmlint()` API stable while moving offset helpers to the shared review utility.

2026-07-02 inline menu iteration:

- Added `web/app/components/ReviewSelectionMenu.vue`.
- Updated `ReviewEditor.vue` to mount a TipTap `BubbleMenu` in preview mode and route inline actions through the same sidecar comment / replacement events as source mode.
- Updated `web/app/utils/review-ranges.ts` so review issue marks get replacements from the full-context fix helper and comments transform across source edits.
- Updated `skill/src/fix.ts` with `applySingleIssueReplacement()` for exact one-issue replacements shared by web review UI and future callers.
- Added focused regression tests in `tests/llmlint.test.ts`.
- Updated replacement UI labels so empty replacements render as delete actions in the top toolbar, inline menu, titles, and inline preview marks.
- Added local active comment state in `ReviewEditor.vue` so the comment rail and rendered text can activate each other without changing the sidecar persistence model.
- Added `update-comment` flow from `ReviewEditor.vue` to `TextPanel.vue`, keeping sidecar comments mutable without changing the Markdown source.
- Added a summary-level "show hidden" action that resets the visible filters to review=`all`, minLevel=`low`, namespaces=`[]`.

2026-07-02 source menu / responsive iteration:

- Added `web/app/components/ReviewSourceSelectionMenu.vue`.
- Extended `ReviewTextSelection` with an optional source selection anchor.
- Extended `HighlightedTextarea.vue` to report source selection anchor coordinates while keeping textarea editing and scanner offsets unchanged.
- Updated `ReviewEditor.vue` to mount the source inline menu over the textarea and removed the older source selection form.
- Updated the comment rail layout so it is a right rail on desktop and a bottom rail on mobile.

2026-07-02 unified text-change iteration:

- Updated `TextPanel.vue` so comment range maintenance is driven by `watch(text, (next, previous) => ...)`.
- Removed duplicated comment transform calls from `updateText()` and `acceptReplacement()`.

2026-07-02 locate-state iteration:

- Updated `web/app/pages/index.vue` so `onListLocate()` also sets `activeCaretIssue`.
- Updated `web/app/components/ReviewEditor.vue` so preview decorations refresh when `activeIssueMark` changes, issue decorations can render `is-active`, and replacement actions clear current selection state.

2026-07-02 selection lifecycle iteration:

- Updated `web/app/components/HighlightedTextarea.vue` to expose `collapseSelection(offset)`.
- Updated `web/app/components/ReviewEditor.vue` with a shared `clearSelectionState()` path for inline comment/replacement completion.
- Updated preview menu mounting to depend on a live `selected` value, so clearing selection reliably removes the BubbleMenu.

2026-07-02 preview locate-on-mode iteration:

- Updated `web/app/components/ReviewEditor.vue` so located issue scrolling is handled by `scrollLocatedIssueIntoView()`.
- The watcher now includes `props.mode`, `props.locateOffset`, and `props.activeIssueMark?.id`.

2026-07-02 source menu placement iteration:

- Extended `ReviewTextSelection.anchor` with `containerHeight`.
- Updated `web/app/components/HighlightedTextarea.vue` to include textarea visible height in source selection anchors.
- Updated `web/app/components/ReviewSourceSelectionMenu.vue` to flip above the selection when bottom space is tight.

2026-07-02 preview-to-source locate iteration:

- Extended `ReviewTextSelection.anchor` with `absoluteTop` for textarea reveal math.
- Updated `web/app/components/HighlightedTextarea.vue` with `revealOffset(offset)`.
- Updated `web/app/components/ReviewEditor.vue` to store `pendingSourceOffset` during preview source-location and reveal it after source mode mounts.

2026-07-02 source menu scroll-follow iteration:

- Updated `web/app/components/HighlightedTextarea.vue` so `syncScroll()` also emits the current selection state and refreshed anchor.

2026-07-02 source comment projection iteration:

- Updated `web/app/components/HighlightedTextarea.vue` with an optional `commentRanges` prop and boundary-based segmentation.
- Updated `web/app/components/ReviewEditor.vue` to pass current sidecar comments into source mode as comment ranges.

2026-07-02 comment card activation iteration:

- Updated `web/app/components/HighlightedTextarea.vue` so comment ranges can carry `active`.
- Updated `web/app/components/ReviewEditor.vue` so `activateComment()` uses source reveal when the current mode is `source`, and source comment ranges mark the active comment.

2026-07-02 new comment activation iteration:

- Updated `web/app/components/ReviewEditor.vue` with a comment id watcher that activates newly added comment ids and refreshes decorations.

2026-07-02 source menu horizontal placement iteration:

- Extended `ReviewTextSelection.anchor` with `containerWidth`.
- Updated `web/app/components/HighlightedTextarea.vue` to include textarea visible width in source selection anchors.
- Updated `web/app/components/ReviewSourceSelectionMenu.vue` to clamp menu center by estimated collapsed/expanded width.

2026-07-02 filter active-state iteration:

- Updated `web/app/pages/index.vue` so the `filteredIssues` watcher clears `activeCaretIssue`, `activeRuleId`, and `locateOffset` when the active target is no longer visible.

2026-07-02 source Escape lifecycle iteration:

- Updated `web/app/components/HighlightedTextarea.vue` so `Escape` explicitly clears the current source selection state and caret offset.

2026-07-02 source click-outside lifecycle iteration:

- Updated `web/app/components/ReviewEditor.vue` with a mounted document `pointerdown` listener for source-mode outside clicks.
- Added a `.llmlint-source-editor-surface` boundary around the source editor so outside-click logic can distinguish editor/menu interactions from report-pane or toolbar clicks.

2026-07-02 preview click-outside lifecycle iteration:

- Extended `web/app/components/ReviewEditor.vue` document `pointerdown` handling to preview selections.
- Outside clicks now call the same `clearSelectionState()` path used by inline actions, keeping BubbleMenu, browser selection, and top toolbar selection text in sync.

2026-07-02 preview Escape lifecycle iteration:

- Added preview `Escape` handling in `web/app/components/ReviewEditor.vue` through TipTap `handleDOMEvents.keydown` plus a document-level fallback for DOM selection focus gaps.
- The document fallback ignores already-prevented events and events inside `.review-selection-menu`, preserving BubbleMenu-local `Escape` behavior.

2026-07-02 hidden-filter empty-state iteration:

- Updated `web/app/pages/index.vue` to pass the hidden hit count and show-hidden action into `IssueList`.
- Updated `web/app/components/IssueList.vue` so filtered-empty and truly-clean-empty states are visually distinct.
- The fix intentionally does not reset user filters automatically; explicit filters remain user-controlled, but the product no longer looks like the scanner failed.

2026-07-02 comment resolution iteration:

- Updated `web/app/components/TextPanel.vue` so newly created comments explicitly start unresolved and can toggle resolved state.
- Updated `web/app/components/ReviewEditor.vue` so the comment rail displays unresolved/total counts and each card can be completed or reopened.
- Updated `web/app/components/HighlightedTextarea.vue` so source-mode comment projection can render resolved comments with the same softened visual state used by preview mode.

2026-07-02 preview source-map ordinal iteration:

- Updated `web/app/components/ReviewEditor.vue` so `locateSourceRangeInPreview()` maps source ranges by occurrence ordinal before falling back to nearest rendered position.
- This improves both issue decorations and sidecar comment decorations in preview mode without changing scanner offsets or source-mode editing.

2026-07-02 comment index iteration:

- Updated `web/app/components/ReviewEditor.vue` so preview comment decorations carry a current-session ordinal index and CSS renders the number badge.
- Updated the comment rail card header to show the same ordinal badge and highlight it when the comment is active.

2026-07-02 preview duplicate selection iteration:

- Updated `web/app/components/ReviewEditor.vue` so `selectionFromPreview()` uses rendered occurrence ordinal mapping before falling back to source-mode guidance.
- Added small helper functions for rendered-position lookup and occurrence-index matching, reusing the same occurrence-mapping idea introduced for preview decorations.

2026-07-02 rule-settings empty-state iteration:

- Updated `web/app/composables/useLlmlint.ts` with `scanDefault()` for comparing current local web overrides against the default active regex registry.
- Updated `web/app/pages/index.vue` to compute `hiddenByRuleSettings` and route the restore action through `resetRuleOverrides()` plus the existing show-hidden filter reset.
- Updated `web/app/components/SummaryBar.vue` and `web/app/components/IssueList.vue` with a dedicated rule-settings-hidden message and restore button.

2026-07-02 source comment index iteration:

- Updated `web/app/components/ReviewEditor.vue` so `sourceCommentRanges` includes the same ordinal used by preview marks and comment cards.
- Updated `web/app/components/HighlightedTextarea.vue` so comment segments can carry `commentIndex`, write `data-comment-index`, and render a visible badge from the otherwise text-transparent source backdrop.

2026-07-02 multiline inline comment form iteration:

- Updated `web/app/components/ReviewSelectionMenu.vue` from a single-line input to a compact textarea form with save/cancel actions and keyboard handling.
- Updated `web/app/components/ReviewSourceSelectionMenu.vue` with the same textarea form and adjusted source menu width clamping for the expanded form.

2026-07-02 source replacement hint iteration:

- Updated `web/app/components/ReviewEditor.vue` so source mode receives `sourceReplacementRanges` derived from `ReviewIssueMark.replacement`.
- Updated `web/app/components/HighlightedTextarea.vue` so the source backdrop splits around replacement ranges, writes `data-replacement-label`, and renders a visible green hint badge without changing the editable textarea content.

2026-07-02 single replacement undo iteration:

- Updated `web/app/components/TextPanel.vue` so `acceptReplacement()` records a text/comment snapshot and shows a notification action for undo.
- Added `notify.replacementDone` to `web/app/i18n/messages.ts`.

2026-07-02 scan visibility guard iteration:

- Diagnosis used NeuroBook's real manuscript at `workspace/ming-ding-zhi-shi-2/manuscript/001-volume/001-chapter/index.md`.
- CLI still finds issues: default Agent review finds 61 visible hits for the chapter, and `--review all --min-level low` finds 352 hits.
- Browser clean-settings smoke also finds 61 visible Agent hits, so scanner, built web registry, and text submission are healthy.
- The reproduced failure mode is stale persisted filters: a narrow namespace/review/level setting can hide every visible hit on a new scan, which reads to the user as "the page cannot find errors".
- Updated `web/app/pages/index.vue` so entering the workbench from the home state automatically reveals hidden hits when the current view filter would hide all results. This resets only view filters (`review=all`, `minLevel=low`, `namespaces=[]`), not rule overrides.
- If local rule overrides disable all default hits, the page now leaves the user's rule settings intact and shows a warning that the right panel can restore default rules.
- Updated `web/app/components/SummaryBar.vue` so zero visible hits with hidden results is no longer labeled as a clean scan. The summary bar now says whether hits are hidden by filters or by rule settings.

2026-07-02 scan visibility guard results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Playwright browser checks on `http://localhost:3001/`:
  - Clean settings + real NeuroBook chapter: submit from home and verify the report shows 61 visible hits.
  - Persisted namespace filter with no hits + same chapter: submit from home and verify the page automatically switches to all hits and shows 352 hits.
  - Confirm the persisted web settings after auto reveal are `review=all`, `minLevel=low`, and no namespace filter.

2026-07-02 review toolbar iteration:

- Compared `ReviewEditor.vue` with NeuroBook's `TipTapMarkdownEditor.vue`. The next practical gap was not richer formatting, but the review shell: llmlint had a plain selected-text status line where NeuroBook-style editors expose compact, actionable editor state.
- Updated `web/app/components/ReviewEditor.vue` with a compact review status strip:
  - Visible issue count.
  - Replaceable issue count.
  - Unresolved/total comment count.
  - Current selection status with blocked-selection reasons clipped safely.
- Added a comment rail toggle to the toolbar. Comments remain session-local sidecar data; the toggle only changes layout visibility.
- New comments automatically reopen the rail, and clicking a comment mark in source/preview also opens the rail and activates the matching comment card.
- Mobile keeps the status line from overflowing by collapsing summary chips and preserving the selection/hint text.

2026-07-02 review toolbar results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Playwright browser checks on `http://localhost:3001/`:
  - Submit text from the home state.
  - Select source text and add an inline sidecar comment.
  - Verify the toolbar shows issue, replaceable, and `批注 1 / 1` state.
  - Collapse the comment rail from the toolbar.
  - Switch to preview, click the rendered comment mark, and verify the rail reopens with both mark and card active.
- Screenshot QA at 1366x900 confirmed the review toolbar, comment rail, source marks, and report pane do not overlap.

2026-07-02 report inline replacement iteration:

- The report list could locate a hit, but deterministic auto replacement still required moving attention back into the editor toolbar or inline menu. This made the common review flow slower than NeuroBook-style in-context editor actions.
- Updated `web/app/components/IssueCard.vue` so auto-fixable replace issues expose a compact per-hit `替换` / `删除` action beside the report snippet.
- Updated `web/app/components/IssueList.vue` and `web/app/pages/index.vue` to route that action back to the left editor.
- Updated `web/app/components/TextPanel.vue` with an exposed `acceptIssueReplacement(issue)` method. TextPanel still owns the actual replacement, comment snapshot, and undo notification, so report actions do not duplicate text mutation logic.
- The report action first locates the hit, then applies the replacement if the current text still matches that issue. If the text has already drifted, it leaves the document unchanged and shows a lightweight notice.

2026-07-02 report inline replacement results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Playwright browser check on `http://localhost:3001/`:
  - Submit `测试！！！\n保留行\n` from the home state.
  - Use the right report card's inline `替换` action for `连续符号去重`.
  - Verify the left editor text becomes `测试！\n保留行\n`.
  - Use the notification `撤销` action and verify the text returns to `测试！！！\n保留行\n`.

2026-07-02 issue navigation iteration:

- The editor could locate a hit from the report list, but a reviewer still had to keep moving between the right report and left editor to walk through all hits.
- Updated `web/app/components/TextPanel.vue` with compact `上一处 / 下一处` controls and an active hit counter.
- Updated `web/app/pages/index.vue` so navigation uses the current filtered issue order, wraps at both ends, and reuses the existing `onListLocate()` path. This keeps left editor scroll, active issue highlight, and right report active card aligned.
- When no issue is active yet, `下一处` starts at the first visible hit and `上一处` starts at the last visible hit.

2026-07-02 issue navigation results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Playwright browser check on `http://localhost:3001/`:
  - Submit `测试！！！\n测试！！！\n保留行\n` from the home state.
  - Click editor `下一处命中` and verify the counter becomes `1/2` and the report card is active.
  - Click editor `下一处命中` again and verify the counter becomes `2/2`.
  - Click editor `上一处命中` and verify the counter returns to `1/2`.

2026-07-02 active issue row sync iteration:

- After editor-side issue navigation, the report panel still only highlighted the rule card. This was ambiguous when one rule had many hits, and the active hit could be hidden behind the card's collapsed limit.
- Updated `web/app/pages/index.vue` to compute a stable `activeIssueId` from the active issue.
- Updated `web/app/components/IssueList.vue` to pass `activeIssueId` down and scroll the exact active issue row into view before falling back to the rule card.
- Updated `web/app/components/IssueCard.vue` so the active issue row is visually highlighted, keeps its inline `替换/删除` action visible, and is appended to the collapsed visible list when it would otherwise be hidden beyond the first 8 rows.

2026-07-02 active issue row sync results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Playwright browser check on `http://localhost:3001/`:
  - Submit 9 repeated `测试！！！` lines from the home state.
  - Use editor `下一处命中` until the counter reaches `9/9`.
  - Verify exactly one right-side issue row is active.
  - Verify the active row text is `9:3测试！！！替换`, proving a collapsed-list hit beyond the first 8 rows is still visible.
  - Verify the active row's inline replacement button remains visible.

2026-07-02 source comment activation iteration:

- Preview mode already allowed clicking a rendered comment mark to activate the matching rail card, but source mode only projected the comment mark in the textarea backdrop. Clicking inside commented source text did not activate the sidecar comment, so source and preview felt inconsistent.
- Updated `web/app/components/ReviewEditor.vue` so source-mode caret clicks still emit the normal issue offset, then also check whether the clicked UTF-16 offset falls inside a sidecar comment range.
- When the source click is inside a comment range, the editor opens the comment rail, activates the matching comment, and scrolls the card into view.
- This keeps source mode as the precise UTF-16 editing contract while giving it the same comment activation loop as preview mode.

2026-07-02 source comment activation results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Playwright browser check on `http://localhost:3001/`:
  - Submit `唯一文本\n保留行\n` from the home state.
  - Add a source inline sidecar comment to `唯一文本`.
  - Collapse the comment rail.
  - Click inside the commented source text.
  - Verify the rail reopens, the comment card is active, and the source mark is active.

2026-07-02 replacement auto-advance iteration:

- Applying a single replacement removed the active hit, after which the user had to manually find the next remaining issue. This interrupted the continuous review loop introduced by editor-side issue navigation.
- Updated `web/app/components/TextPanel.vue` so any single replacement emits `replacement-applied` with the original source offset.
- Updated `web/app/pages/index.vue` to wait for the text and computed scan results to settle, then locate the first remaining visible issue at or after the replaced offset. If no visible issues remain, active issue/rule/offset state is cleared.
- This covers replacement from the editor toolbar, source/preview inline menus, and the right report card because all of them still route through `TextPanel.acceptReplacement()`.

2026-07-02 replacement auto-advance results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Playwright browser check on `http://localhost:3001/`:
  - Submit `测试！！！\n测试！！！\n保留行\n` from the home state.
  - Navigate to the first issue and apply the active replacement from the editor toolbar.
  - Verify the text becomes `测试！\n测试！！！\n保留行\n`.
  - Verify the issue counter automatically becomes `1/1`.
  - Verify the right report active row is now `2:3测试！！！替换`.

2026-07-02 manuscript scan visibility guard iteration:

- User reported that the web page appeared unable to find issues on `workspace/ming-ding-zhi-shi-2/manuscript`, although it had worked before.
- Re-ran the real manuscript path through the CLI and confirmed the engine is healthy:
  - `001-volume/001-chapter/index.md` with default `agent/low`: 61 visible hits.
  - The same chapter with `--review all --min-level low`: 352 hits.
  - The whole `manuscript` directory with `--review all --min-level low`: 788 hits.
- Re-ran the web registry path directly from `web/app/data/registry.json` and confirmed it also finds 352 total hits and 61 default Agent-visible hits for the same chapter.
- The remaining product gap was visibility state: `startCheck()` only auto-relaxed stale filters when entering from the home state. If a reviewer was already in the workbench and replaced the editor content with a new long manuscript, old filters could still hide every visible hit and make the page feel like the scanner failed.
- Updated `web/app/pages/index.vue` with a single `ensureScanVisible()` guard used by both home submit and likely-new-document changes inside the workbench.
- The guard only auto-relaxes current filters when they hide all existing hits. It does not reset rule overrides; if rule overrides disable default hits, the existing restore-default-rules warning remains the user-controlled path.

2026-07-02 manuscript scan visibility guard results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Pure web-registry smoke on the real NeuroBook chapter: pass, 352 total hits and 61 Agent-visible hits.
- Browser Playwright smoke was attempted but not used as evidence this round because local Chromium launch hung before navigation. No page-level failure was observed in that path.

2026-07-02 active issue comment iteration:

- Compared llmlint `ReviewEditor` against NeuroBook `TipTapMarkdownEditor` / `MarkdownSelectionMenu`. The useful next gap was not general Markdown formatting, but turning the current review context into a direct action.
- Before this change, a reviewer who had already located a rule hit still had to manually re-select the exact text before writing a sidecar comment. That interrupted the report -> editor -> comment review loop.
- Updated `web/app/components/ReviewEditor.vue` so an active issue exposes a `批注命中` action in the editor toolbar.
- The action opens a compact form bound to the active `ReviewIssueMark` range and emits the existing `add-comment` event. It reuses the same sidecar comment store, comment rail, source/preview marks, comment numbering, and text-change transform path.
- The form closes when the active issue changes, supports Escape to cancel and Ctrl/Cmd+Enter to save, and keeps source mode as the precise UTF-16 range contract.

2026-07-02 active issue comment results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Browser automation was not used this round because the available in-app browser control tool was not exposed in this session and local Playwright/Chromium launch had previously hung before navigation.

2026-07-02 comment rail navigation iteration:

- The sidecar comment rail could display, edit, resolve, reopen, and delete comments, but reviewers still had to click cards one by one. With several comments this was weaker than NeuroBook's comment-review style workflow.
- Updated `web/app/components/ReviewEditor.vue` with a comment review queue. The queue prioritizes unresolved comments; once all comments are resolved it falls back to all comments.
- Added compact previous/next controls and a queue position counter to the comment rail header.
- Navigation reuses the existing `activateComment()` path, so it keeps source/preview marks, rail card activation, and scroll behavior consistent.

2026-07-02 comment rail navigation results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Browser automation remains blocked at Chromium/Edge launch before page navigation in this local environment; no page-specific browser failure was observed.

2026-07-02 external LLM prompt export iteration:

- User clarified that llmlint has not integrated an LLM yet. The web UI should therefore offer a temporary compromise: copy the current report and optimization suggestions so users can paste them into an external LLM.
- Added `web/app/utils/llm-optimization-prompt.ts` to turn the current filtered report into a Markdown prompt.
- The generated prompt includes editing principles, current filters, hit summary, grouped rule suggestions, concrete locations, matched text, context snippets, and optional full source text.
- Added two summary-bar actions:
  - `复制优化指令`: copies the prompt without the full text, so users can paste or attach the source separately.
  - `带正文`: copies the same prompt with the current editor text appended in a safe dynamic Markdown fence.
- This remains purely local clipboard export. It does not pretend that llmlint has an LLM backend and does not upload text.

2026-07-02 external LLM prompt export results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Pure prompt smoke on a real NeuroBook chapter: pass. The generated prompt contains the task title, rule suggestions, full-text section, and Markdown fence.

2026-07-02 external LLM export polish iteration:

- The temporary external-LLM workflow was present, but the summary bar exposed it as two small peer buttons beside JSON export. That made the current "copy report/suggestions to an outside LLM" path feel secondary even though llmlint has no built-in LLM yet.
- Updated `web/app/components/SummaryBar.vue` to use the shared NeuroBook-style `Dropdown` component for a single `外部 LLM` action.
- The dropdown offers two explicit modes: `复制指令（不带正文）` and `复制指令 + 当前正文`.
- When the current filtered report has visible hits, the external LLM action uses the accent treatment so the next step is easier to find after scanning.
- Updated `web/app/utils/llm-optimization-prompt.ts` with a dedicated return-format section: keep Markdown structure, output only the optimized full text, avoid explanations or change lists, and wait for pasted text when the copied prompt did not include the body.
- This remains a local clipboard export only. It does not introduce an LLM backend or change any scan/review state.

2026-07-02 external LLM export polish results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Pure prompt smoke: pass. The generated prompt includes the stricter return-format instructions and the full-text Markdown fence when `includeText=true`.
- Browser automation was attempted against `http://localhost:3001/`, but Playwright timed out while launching Edge before page navigation. No page-level failure was observed; this run is not counted as UI behavior evidence.

2026-07-02 inline issue context iteration:

- Compared the current llmlint source/preview selection menus with NeuroBook's `MarkdownSelectionMenu`. The practical gap was contextual awareness: llmlint's menu could comment/copy/replace, but when a selection intersected a rule hit it did not say which rule the user was acting on.
- Updated `web/app/components/ReviewEditor.vue` to compute the most relevant issue for the current review selection, preferring higher severity and then larger overlap.
- Updated both `web/app/components/ReviewSelectionMenu.vue` and `web/app/components/ReviewSourceSelectionMenu.vue` so source and preview menus show the selected hit's level, rule title, and action state (`可替换` / `可删除` / `候选` / `需人工判断`).
- The existing replacement action is unchanged: it still appears only when the selected hit has a deterministic `replacement !== null`.
- This keeps source mode as the precise UTF-16 contract and avoids adding a new scan/report state.

2026-07-02 inline issue context results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Browser automation was retried with a CDP-port Edge launch to avoid the previous Playwright pipe timeout, but the CDP connection also timed out before navigation. No page-level failure was observed; this remains environment-level browser automation blockage.

2026-07-02 inline copy feedback iteration:

- Compared llmlint's source/preview selection menus with NeuroBook's editor copy path. NeuroBook reports clipboard failures through the notification channel, while llmlint's inline copy buttons directly awaited `navigator.clipboard.writeText()` and could fail silently when clipboard permission was unavailable.
- Updated `web/app/components/ReviewSelectionMenu.vue` and `web/app/components/ReviewSourceSelectionMenu.vue` so successful selection copy keeps the existing check icon and also sends a short success notification.
- Clipboard failures now show the shared `notify.copyFailed` message instead of leaving the user unsure whether the action worked.
- Added `notify.selectionCopied` to `web/app/i18n/messages.ts` for both zh-CN and en-US.
- This only changes action feedback. It does not alter selection mapping, source offsets, comments, replacement semantics, or report state.

2026-07-02 inline copy feedback results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Browser automation was not retried this mini-iteration because the immediately previous runs failed before page navigation at Edge/Chromium launch and CDP connection. No page-level failure was observed.

2026-07-02 comment delete undo iteration:

- The comment rail supported delete, but deleting a review note was immediate and unrecoverable. That was inconsistent with the replacement path, where potentially destructive edits already show an undo notification.
- Updated `web/app/components/TextPanel.vue` so deleting a sidecar comment captures the deleted comment and its original index, then shows an undo action through the shared notification channel.
- Undo restores the comment at its original position when possible, preserving the current session comment numbering as closely as the live list allows.
- Added `notify.commentDeleted` to `web/app/i18n/messages.ts`.
- This stays within the sidecar comment model. It does not write comments into Markdown, change text offsets, or alter text-change comment transforms.

2026-07-02 comment delete undo results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 comment delete undo safety iteration:

- Re-reviewed the new comment-delete undo path against the existing sidecar comment transform invariant.
- The first undo implementation restored the deleted comment with its original offsets. If the user edited the Markdown text before clicking undo, that could reinsert the comment at a stale range.
- Updated `web/app/components/TextPanel.vue` so delete undo captures the text at deletion time and reuses `transformReviewCommentsForTextChange()` before restoring the comment.
- If text changes before the deleted comment, undo shifts the restored range. If text changes overlap the deleted comment range, undo refuses to restore and shows a warning instead of drifting to the wrong text.
- Added `notify.commentRestoreSkipped` to `web/app/i18n/messages.ts`.

2026-07-02 comment delete undo safety results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Pure transform smoke: pass. A deleted comment shifts after front insertion and is dropped after overlapping edit.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 comment rail close iteration:

- Compared llmlint's comment rail with NeuroBook's `MarkdownCommentFlowPanel`. NeuroBook lets the user close the comment panel from the panel header itself, while llmlint only exposed this through the editor toolbar.
- Updated `web/app/components/ReviewEditor.vue` so the comment rail header has a compact close button beside the review queue and unresolved count.
- The button only sets `commentsOpen = false`; it does not change active comment state, comment data, text offsets, or review queue ordering.

2026-07-02 comment rail close results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 source menu vertical placement iteration:

- Rechecked the source-mode inline menu after adding issue context and multiline comment input.
- The source menu is manually positioned from a textarea selection anchor, unlike the TipTap preview BubbleMenu. Its bottom-overflow check still used a fixed `132px` height estimate from the older compact menu.
- With issue context plus an open comment form, the menu can be much taller than that estimate, so selecting text near the bottom of the source editor could leave the expanded menu overflowing below the editor.
- Updated `web/app/components/ReviewSourceSelectionMenu.vue` so the vertical flip uses an estimated height composed from toolbar, issue-context row, and comment form state.
- This keeps the existing source textarea / UTF-16 offset contract intact and only improves menu placement.

2026-07-02 source menu vertical placement results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 report action discoverability iteration:

- Rechecked the right report list's per-hit deterministic replacement action.
- The `替换 / 删除` button was hidden with hover opacity unless the row was active. That works on desktop mouse, but non-hover / coarse-pointer devices can make the action hard to discover.
- Updated `web/app/components/IssueCard.vue` so the apply button remains desktop-hover driven, but becomes always visible on `(hover: none)` or `(pointer: coarse)` devices.
- Added a `focus-visible` safeguard so keyboard navigation also reveals the action when the button receives focus.
- Replacement behavior still routes through the existing `TextPanel.acceptIssueReplacement()` path; no text mutation logic was duplicated.

2026-07-02 report action discoverability results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 report row keyboard navigation iteration:

- Rechecked the report -> editor navigation path from a keyboard-accessibility angle.
- Issue rows were clickable `<li>` elements, so mouse users could locate a hit in the editor, but keyboard users could not focus a row or trigger the same locate action with Enter / Space.
- Updated `web/app/components/IssueCard.vue` so issue rows expose `role="button"`, `tabindex="0"`, a focus ring, and Enter / Space handling.
- The row key handler ignores events that originate from an inner button, so the per-hit `替换 / 删除` action remains separate from row-location behavior.
- This does not alter issue identity, replacement routing, active-row syncing, or text mutation logic.

2026-07-02 report row keyboard navigation results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 report row semantic follow-up iteration:

- Re-reviewed the new keyboard row navigation markup.
- The first implementation made the `<li>` itself act like a button while it still contained the per-hit `替换 / 删除` button. That worked behaviorally, but nested interactive controls are not a clean accessibility structure.
- Updated `web/app/components/IssueCard.vue` so each issue row is a neutral list item containing two sibling controls:
  - a native button for locating the issue in the editor;
  - the existing native button for applying the deterministic replacement/delete.
- Enter / Space now come from the browser's native button behavior instead of custom row key handling.
- Active row, focus ring, hover visibility, touch visibility, and replacement routing remain aligned with the previous behavior.

2026-07-02 report row semantic follow-up results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 source comment form pointer iteration:

- Rechecked the source-mode inline comment form after the source menu gained issue context and multiline input.
- The source menu root used `@mousedown.prevent` to keep source selection state stable. That also prevented normal default mouse behavior inside the menu, including clicking inside the multiline textarea to place the caret.
- Updated `web/app/components/ReviewSourceSelectionMenu.vue` to use `@mousedown.stop` instead. The editor shell already ignores pointer events whose target is inside `.review-source-selection-menu`, so preventing the default action is not needed for menu lifecycle.
- This keeps outside-click behavior intact while allowing the textarea to focus and position the cursor normally.

2026-07-02 source comment form pointer results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 comment rail edit shortcut iteration:

- Rechecked keyboard behavior across comment entry points.
- Source inline comments, preview inline comments, and active-issue comments already support `Ctrl/Cmd+Enter` to save. Editing an existing comment in the rail still required clicking the save button.
- Updated `web/app/components/ReviewEditor.vue` so the rail edit textarea also saves with `Ctrl+Enter` / `Cmd+Enter`, while `Esc` still cancels.
- This reuses the existing `saveEditComment()` path and does not alter sidecar comment storage or range behavior.

2026-07-02 comment rail edit shortcut results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 report action keyboard visibility iteration:

- Rechecked the report issue row after splitting the locate and replacement actions into sibling buttons.
- The per-hit replacement button already becomes visible on hover, touch/coarse-pointer devices, and when the button itself receives focus. However, when keyboard focus was on the row's locate button, the next tabbable replacement action could still be visually hidden until focus moved to it.
- Updated `web/app/components/IssueCard.vue` so `.issue-card-apply-button` is visible whenever the issue row has `focus-within`.
- This lets keyboard users see the available replacement/delete action before tabbing to it, without changing desktop hover behavior or replacement routing.

2026-07-02 report action keyboard visibility results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 active issue comment key lifecycle iteration:

- Rechecked keyboard handling across comment forms.
- The active-issue comment textarea supported `Esc` and `Ctrl/Cmd+Enter`, but the handlers only used `.prevent`. The document-level Escape fallback could still receive the same event and run the active-issue close path again.
- Updated `web/app/components/ReviewEditor.vue` so the active-issue comment form uses `.prevent.stop` for `Esc`, `Ctrl+Enter`, and `Cmd+Enter`, matching the rail edit form behavior.
- This does not change comment creation semantics; it only keeps the key event local to the active form.

2026-07-02 active issue comment key lifecycle results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 inline comment selection lifecycle iteration:

- Rechecked source/preview inline comment forms against the single-selection invariant.
- If a user opened an inline comment form, typed a note, then changed the selected text before saving, the form could keep the old body while targeting the new selection range.
- Updated `web/app/components/ReviewSelectionMenu.vue` and `web/app/components/ReviewSourceSelectionMenu.vue` to watch the selection identity (`source/start/end/mappable`) and close the inline comment form when it changes.
- The watch intentionally ignores anchor-only changes, so scrolling the source textarea can still update menu position without closing a draft tied to the same selection.
- This prevents stale inline comment text from being saved onto a different source range.

2026-07-02 inline comment selection lifecycle results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 inline comment key stop follow-up:

- Rechecked source/preview inline comment textareas after the document-level Escape fallback was added.
- Updated `web/app/components/ReviewSelectionMenu.vue` and `web/app/components/ReviewSourceSelectionMenu.vue` so inline comment `Esc`, `Ctrl+Enter`, and `Cmd+Enter` use `.prevent.stop`.
- This keeps key events local to the inline comment form, matching the active-issue comment form and comment-rail edit form. It does not change comment range mapping, sidecar storage, or replacement semantics.

2026-07-02 external LLM temporary workflow follow-up:

- User clarified that llmlint still has no built-in LLM integration. The web workflow should therefore make the temporary handoff to an external LLM obvious.
- The summary bar now exposes a single `外部 LLM` dropdown with two modes:
  - `复制指令（不带正文）`
  - `复制指令 + 当前正文`
- The copied prompt includes the current visible report, grouped optimization suggestions, filters, hit summary, concrete examples, and a strict return-format section asking the external LLM to output only the optimized Markdown body.
- This is only a local clipboard export. It does not upload text and does not imply that llmlint has an LLM backend.

2026-07-02 current follow-up results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.
- Pure prompt smoke on `../neuro-book/workspace/ming-ding-zhi-shi-2/manuscript/001-volume/001-chapter/index.md`: pass. The scanner produced sample hits, and both prompt modes generated the expected report/body sections.

2026-07-02 external LLM prompt comment handoff iteration:

- Rechecked the temporary external-LLM workflow against the current review-editor interaction model.
- User comments live as session-local sidecar state inside `TextPanel` / `ReviewEditor`. Before this iteration, `外部 LLM` export included llmlint rule hits but not the user's own review comments, even though those comments are part of the user's current optimization intent.
- Updated `web/app/components/TextPanel.vue` to expose a read-only `getReviewComments()` snapshot for parent-level export actions.
- Updated `web/app/pages/index.vue` so `onCopyOptimizationPrompt()` passes the current comment snapshot into `buildLlmOptimizationPrompt()`.
- Updated `web/app/utils/llm-optimization-prompt.ts` to render a `用户批注` section. Unresolved comments are listed before resolved comments, each with source line/column, quote, status, and comment body.
- This keeps the sidecar comment ownership unchanged. It does not persist comments, move them to page state, upload text, or introduce an LLM backend.

2026-07-02 external LLM prompt comment handoff results:

- `http://localhost:3001/`: HTTP 200.
- Browser automation attempt with Playwright + Edge: blocked before navigation by Edge launch timeout. This matches the existing environment-level browser blockage; no page-level failure was observed.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Pure prompt smoke on the NeuroBook chapter with two synthetic comments: pass. The generated prompt includes `用户批注`, pending/resolved statuses, comment bodies, report section, and full-text fence.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 menu close and focus lifecycle iteration:

- Rechecked the review workbench controls from the user's "filter -> review -> export" flow.
- The shared `Dropdown` is now used for critical actions such as account and external LLM export. It previously closed on click outside and item click, but did not handle keyboard Escape or return focus to the trigger after selecting an item.
- Updated `web/app/components/common/Dropdown.vue` with:
  - `Escape` closes the open menu;
  - `ArrowDown` from the trigger opens the menu and focuses the first item;
  - selecting an item closes the menu and returns focus to the trigger control;
  - basic `role="menu"` / `role="menuitem"` and `aria-expanded` / `aria-controls` wiring.
- Rechecked the namespace filter popup in `web/app/components/FilterControls.vue`. It now closes on outside click and Escape, so the filter menu does not stay over the report/editor when the user returns to reviewing.
- This is a small interaction lifecycle fix. It does not change filtering semantics, scan results, prompt export contents, or editor state.

2026-07-02 menu close and focus lifecycle results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Static smoke: pass. The shared dropdown contains Escape / ArrowDown hooks, and the namespace filter contains click-outside / Escape close hooks.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 inline replacement ranking iteration:

- Rechecked source/preview inline menus for selections that intersect more than one rule hit.
- The menu already showed the most relevant issue context by severity and overlap, but the deterministic replacement action used the first replaceable issue in document order. That could make the visible issue context and the action target feel disconnected when several hits overlap one selection.
- Updated `web/app/components/ReviewEditor.vue` so selection issue context and selection replacement both use the same ranked intersection helper:
  - higher severity first;
  - then larger overlap with the selected text;
  - then earlier source offset as a stable tie-breaker.
- Updated `web/app/components/ReviewSelectionMenu.vue` and `web/app/components/ReviewSourceSelectionMenu.vue` so replacement button titles include the rule title, e.g. `规则标题: 命中 -> 替换` or `规则标题: 删除「命中」`.
- This does not change replacement semantics. It only makes the inline action target more predictable and inspectable.

2026-07-02 inline replacement ranking results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Static smoke: pass. The shared ranked selection helper and rule-title replacement tooltips are present.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 locate-source selection cleanup iteration:

- Rechecked the preview inline menu action that jumps from rendered preview selection to the exact source offset.
- The action stored a pending source offset and switched mode, but it did not clear the preview selection state through the shared `clearSelectionState()` path. This could leave the toolbar showing the old preview selection after the source editor appeared.
- Updated `web/app/components/ReviewEditor.vue` so `locateSelectionInSource()` captures the source offset, clears the current selection/BubbleMenu/browser selection, then switches to source mode and emits the caret offset.
- Updated mode switching through the segmented control to use the same `clearSelectionState()` path instead of only setting `selected = null`.
- This keeps the toolbar selection chip, preview BubbleMenu, browser selection, and source reveal action aligned.

2026-07-02 locate-source selection cleanup results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Static source check: pass. `locateSelectionInSource()` stores `offset`, calls `clearSelectionState()`, switches to source mode, and emits the captured offset.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 selection-level external LLM prompt iteration:

- Rechecked the temporary external-LLM workflow from the inline review path.
- The summary bar can export a full-document prompt, but source/preview inline menus only copied the selected text. For local edits, users often need a smaller prompt that carries the selected fragment plus the current rule context.
- Added `buildSelectionOptimizationPrompt()` in `web/app/utils/llm-optimization-prompt.ts`.
- Updated `web/app/components/ReviewSelectionMenu.vue` and `web/app/components/ReviewSourceSelectionMenu.vue` with a `复制选区优化指令` action.
- The selection prompt includes:
  - selected text in a Markdown fence;
  - current issue title, level, match, and fixability/replacement guidance when available;
  - separate deterministic replacement context when it differs from the visible issue context;
  - strict return-format instructions asking the external LLM to output only the optimized fragment.
- This remains a local clipboard export for an external LLM. It does not add an LLM backend, upload text, or change review/editor state.

2026-07-02 selection-level external LLM prompt results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Pure prompt smoke: pass. The generated selection prompt includes the task title, rule context, replacement suggestion, Markdown fence, and selected text.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 source selection menu width follow-up:

- Rechecked source-mode inline menu placement after adding the `复制选区优化指令` icon action.
- Source mode uses a manually calculated textarea selection anchor, unlike preview mode's TipTap BubbleMenu. Its horizontal clamp still used the old toolbar width estimate from before the extra icon button.
- Updated `web/app/components/ReviewSourceSelectionMenu.vue` so width estimation is centralized in `estimateMenuWidth()`:
  - base toolbar: `178px`;
  - toolbar with deterministic replacement action: `238px`;
  - issue context row or open comment form: `320px`.
- This keeps source selection menus better clamped near the left/right edges after the toolbar gained the external-LLM prompt action. It does not change selection offsets, comments, replacement behavior, or prompt contents.

2026-07-02 source selection menu width follow-up results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Static source check: pass. `ReviewSourceSelectionMenu.vue` now uses `estimateMenuWidth()` and the updated base/replacement estimates.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 comment review queue action iteration:

- Rechecked the comment rail as a review queue rather than a passive note list.
- The rail already prioritized unresolved comments in previous/next navigation, but completing the active comment left the reviewer on the same now-resolved card even when other unresolved comments remained. Deleting the active comment also cleared active state instead of keeping the reviewer oriented.
- Updated `web/app/components/ReviewEditor.vue` with small rail-level action wrappers:
  - completing the active unresolved comment advances to the next unresolved comment when one exists;
  - deleting the active comment advances to the next remaining comment when one exists;
  - reopen and non-active actions keep the current active target unchanged.
- Both paths reuse the existing `activateComment()` function, so source/preview mark activation, card scrolling, and rail state remain consistent.
- Comment storage, undo behavior, text transforms, and persistence model remain unchanged.

2026-07-02 comment review queue action results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Static source check: pass. `nextCommentAfter()`, `toggleCommentResolvedFromRail()`, and `deleteCommentFromRail()` are wired to the rail action buttons.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 comment review queue label iteration:

- Rechecked the comment rail header after the queue-action update.
- The review queue prioritizes unresolved comments. When the active card is resolved while unresolved comments still exist, the active card is not part of the current navigation queue, but the header previously fell back to `1/N`, which made it look like the active card was the first unresolved item.
- Updated `web/app/components/ReviewEditor.vue` so the queue label shows `0/N` when the active comment is not in the current queue.
- Updated previous/next button titles to say `上一条批注 / 下一条批注` once all comments are resolved, while keeping `上一条未处理批注 / 下一条未处理批注` during unresolved review.
- This only corrects rail navigation display. Queue membership, activation, comment data, and source/preview marks are unchanged.

2026-07-02 comment review queue label results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Static source check: pass. The queue label has an explicit `0/N` branch and dynamic previous/next titles.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 inline prompt copy feedback iteration:

- Rechecked source/preview inline menus after adding `复制选区优化指令`.
- Copying plain selected text already shows a temporary check icon, but copying the selection-level optimization prompt only showed a notification. Selection changes could also leave the old copy-check state visible briefly on a new selection.
- Updated `web/app/components/ReviewSelectionMenu.vue` and `web/app/components/ReviewSourceSelectionMenu.vue` so:
  - selection prompt copy has its own temporary check icon;
  - selection identity changes clear both plain-copy and prompt-copy visual states;
  - success/failure notifications keep using the shared notification channel.
- This only changes inline menu feedback. Clipboard content, prompt contents, comments, replacements, and selection mapping are unchanged.

2026-07-02 inline prompt copy feedback results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Static source check: pass. Both inline menus contain `promptCopied` state and reset copy states on selection identity changes.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 comment card activation semantics iteration:

- Rechecked the comment rail cards from a keyboard and semantic HTML perspective.
- Comment cards were clickable `<article>` containers while also containing edit/resolve/delete buttons. Mouse behavior worked, but the activation target was not a native control and the card mixed container click behavior with inner controls.
- Updated `web/app/components/ReviewEditor.vue` so the card itself is a neutral article, and the quote/header row is a real `button` for locating the comment in source/preview.
- The header button has a focus-visible ring and reuses `activateComment(comment.id)`. Edit, resolve, reopen, and delete remain separate sibling controls.
- This improves keyboard access and avoids nested-interactive ambiguity. Comment data, review queue behavior, source/preview activation, and card actions are unchanged.

2026-07-02 comment card activation semantics results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Static source check: pass. The comment card activation target is now a header button with `title="定位到这条批注"`, and the old `cursor-pointer` card click path is gone.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 source mode switch selection cleanup iteration:

- Rechecked the mode switch lifecycle after previous preview-to-source cleanup work.
- Switching from source mode to preview mode with a textarea selection active called `clearSelectionState()` without a source offset. Because source selection collapsing intentionally requires an offset, the hidden textarea could keep its old browser selection and show it again when returning to source mode.
- Updated `web/app/components/ReviewEditor.vue` so `updateMode()` captures `selected.end` when the current selection comes from source mode and passes it into `clearSelectionState(sourceOffset)`.
- This makes source -> preview and preview -> source mode switches use the same selection cleanup contract. It does not change text content, issue offsets, comments, or replacement behavior.

2026-07-02 source mode switch selection cleanup results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Static source check: pass. `updateMode()` now passes the source selection end offset into `clearSelectionState()`.
- `cd web && bun run build`: pass. Existing Nuxt/Vite/VueUse/chunk-size/Node deprecation warnings remain.

2026-07-02 external LLM handoff verification:

- Rechecked the temporary external-LLM path after the user clarified that llmlint does not have an LLM backend yet.
- The web workflow remains a local clipboard handoff only:
  - `SummaryBar` exposes one `外部 LLM` dropdown.
  - `复制指令（不带正文）` copies the current report, optimization guidance, filters, examples, and user comments, then asks the external LLM to wait for the body.
  - `复制指令 + 当前正文` includes the same report plus the current Markdown body.
  - Source/preview inline menus also expose `复制选区优化指令` for local fragment rewriting.
- Browser smoke through Chrome CDP on `http://localhost:3001/` now runs without Playwright pipe:
  - Short sample path: home submit -> report appears -> source inline menu -> copy selection optimization prompt -> add comment -> switch preview -> open `外部 LLM` menu. Result: pass.
  - Real NeuroBook chapter path using `../neuro-book/workspace/ming-ding-zhi-shi-2/manuscript/001-volume/001-chapter/index.md`: home submit -> report appears -> 26 rule cards render -> `外部 LLM` menu opens. Result: pass.
- This verifies that the current web page can still find deterministic regex issues on the provided manuscript text. Previous "no issues" symptoms remain most likely caused by persisted filters or rule overrides; the UI now has reveal/reset paths for both.

2026-07-02 external LLM handoff verification results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-02 clipboard replacement handoff iteration:

- Rechecked llmlint's inline menus against NeuroBook `TipTapMarkdownEditor` / selection reference flow.
- NeuroBook can keep selected text as an actionable inline context for later AI/editor actions. llmlint already had `复制选区优化指令`, but the temporary external-LLM path still ended at the clipboard: after the user pasted the prompt into an outside LLM, there was no precise in-app action for bringing the optimized fragment back into the selected range.
- Updated `web/app/components/ReviewSelectionMenu.vue` and `web/app/components/ReviewSourceSelectionMenu.vue` with a `用剪贴板替换选区` action:
  - source mode replaces the exact UTF-16 selection range;
  - preview mode only enables the action when the rendered selection maps safely back to Markdown source;
  - empty clipboard content is ignored to avoid accidental deletion;
  - clipboard read failures use the existing clipboard failure notification path.
- Updated `web/app/components/ReviewEditor.vue` so the replacement writes a new single Markdown string through the existing `update:modelValue` path. This keeps comment range transforms, rescanning, preview refresh, and source caret collapse on the same text-change contract as ordinary edits.
- This closes the current temporary external-LLM loop without adding an LLM backend: copy prompt out, paste external result to clipboard, then replace the original selection in place.

2026-07-02 clipboard replacement handoff results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3001/`: pass. Path: home submit -> source mode -> select `待优化片段` -> write simulated external LLM result `更自然的片段` to clipboard -> click `用剪贴板替换选区` -> source text becomes `测试！！！\n更自然的片段\n结尾\n`, menu closes, success notification appears.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Walkthrough note: this iteration intentionally did not port NeuroBook's full formatting menu. The practical gap for llmlint right now is the external-LLM handoff loop, because llmlint still has no built-in LLM integration.

2026-07-02 clipboard replacement undo follow-up:

- Rechecked the newly added `用剪贴板替换选区` action against the rest of the review editor's safety model.
- Before this follow-up, the action changed `modelValue` directly from `ReviewEditor`. That kept rescanning and comment transforms working, but it bypassed `TextPanel`'s existing text/comment snapshot undo path used by single deterministic replacements and one-click mechanical cleaning.
- Updated `web/app/components/ReviewEditor.vue` so selection replacement only emits `{from, to, replacement}`.
- Updated `web/app/components/TextPanel.vue` so the parent applies the replacement, captures the previous Markdown text and sidecar comments, and shows the same undo affordance as other destructive text changes.
- Removed duplicate success notifications from the source/preview inline menus. Menus now only handle clipboard read / empty-clipboard feedback; the parent text owner reports successful replacement.
- This keeps a single text-change safety boundary for ordinary edits, auto replacements, mechanical cleanup, and external-LLM clipboard replacement.

2026-07-02 clipboard replacement undo results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3001/`: pass. Path: home submit -> source mode -> select `待优化片段` -> clipboard replacement with `更自然的片段` -> success notification exposes `撤销` -> click `撤销` -> source text restores to `测试！！！\n待优化片段\n结尾\n`.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Walkthrough note: the implementation changed slightly from the previous iteration: the feature surface stayed the same, but the commit point moved up to `TextPanel` so sidecar comments and text can be restored together.

2026-07-02 preview clipboard replacement verification:

- Rechecked the clipboard replacement loop specifically in TipTap preview mode. The previous browser smoke covered source mode; preview mode also needs proof because its selection first maps rendered text back to Markdown source offsets.
- Cleaned up the new clipboard replacement notifications:
  - added i18n keys for empty clipboard, clipboard read failure, and selection replacement success;
  - source/preview inline menus now report empty/read failures only;
  - `TextPanel` reports successful replacement and owns the undo action.
- Chrome CDP smoke now uses real mouse drag selection in `.llmlint-review-preview`, not a synthetic DOM Range only. This exercises the browser selection + ProseMirror selection update path that users actually hit.

2026-07-02 preview clipboard replacement verification results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3001/`: pass. Path: home submit -> preview mode -> drag-select rendered `待优化片段` -> clipboard replacement with `更自然的片段` -> success notification appears -> click `撤销` -> preview text restores to `待优化片段` and the selection menu closes.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Walkthrough note: the first automation attempt using only DOM Range selection did not open the BubbleMenu, so the verification was corrected to dispatch real mouse events. No product code change was needed for that failure.

2026-07-02 full-document external LLM handoff iteration:

- Rechecked the full-document external LLM workflow. The summary bar could already copy `复制指令 + 当前正文`, but there was no matching first-class way to bring the external LLM's full optimized Markdown body back into llmlint.
- Added a third `外部 LLM` dropdown action in `web/app/components/SummaryBar.vue`: `用剪贴板替换全文`.
- `web/app/pages/index.vue` routes that action to the current `TextPanel` instance.
- `web/app/components/TextPanel.vue` now exposes `replaceTextFromClipboard()`:
  - reads the clipboard locally;
  - ignores empty clipboard content;
  - replaces the single Markdown source string;
  - captures the previous Markdown text and sidecar comments;
  - shows an undo notification that restores both text and comments.
- Added `notify.fullTextReplaced` and made the empty-clipboard notification generic (`未替换文本`) so the same message works for both selection and full-document replacement.
- This keeps the temporary no-LLM-backend workflow coherent: copy report/prompt out, ask an external LLM for a full rewrite, copy its Markdown result, then replace the whole document with undo protection.

2026-07-02 full-document external LLM handoff results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3001/`: pass. Path: home submit -> open `外部 LLM` dropdown -> write simulated full optimized Markdown to clipboard -> click `用剪贴板替换全文` -> source text contains `更自然的全文` -> success notification exposes `撤销` -> click `撤销` -> source text restores to `测试！！！\n原始正文\n`.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Walkthrough note: this iteration extends the external-LLM loop at document scope. It does not add an LLM backend and does not change scanner/fix semantics.

2026-07-02 full-document replacement comment-safety follow-up:

- Rechecked full-document clipboard replacement with existing sidecar comments.
- The replacement already used the same text/comment snapshot undo path as deterministic replacements, but the success message did not make it clear that comments are session-local sidecar state and will be updated or dropped according to the text diff.
- Added `notify.fullTextReplacedWithComments` and use it when full-document replacement starts from a text that has comments.
- The implementation intentionally does not duplicate `transformReviewCommentsForTextChange()` prediction inside `replaceTextFromClipboard()`. The single text watcher remains the only comment-transform authority; the notification simply tells the user what to expect and keeps undo visible.

2026-07-02 full-document replacement comment-safety results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3001/`: pass. Path: home submit -> source mode -> add comment `保留这条批注` on `原始正文` -> use `外部 LLM` / `用剪贴板替换全文` -> notification says `批注会随正文变化更新` -> click `撤销` -> source text restores to `测试！！！\n原始正文\n` and the comment body is visible again.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Walkthrough note: this is a safety/clarity refinement over the previous full-document replacement feature. No scanner behavior, prompt content, or TipTap mapping behavior changed.

2026-07-02 full-document replacement confirmation iteration:

- Rechecked the `外部 LLM` dropdown after adding `用剪贴板替换全文`.
- Full-document replacement is intentionally broad and destructive, so a single dropdown click should not immediately replace the whole manuscript even though undo exists.
- Updated `web/app/pages/index.vue` to open the shared `Dialog` component before reading the clipboard or changing text.
- Added `llm.replaceFullTitle`, `llm.replaceFullBody`, and `llm.replaceFullConfirm` i18n strings.
- The dialog has `closeOnOverlay=false` so an accidental outside click does not ambiguously dismiss the action while the user is deciding.
- Confirm still delegates to `TextPanel.replaceTextFromClipboard()`, so text/comment snapshots and undo remain owned by the text panel.

2026-07-02 full-document replacement confirmation results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3001/`: pass. Path: home submit -> open `外部 LLM` dropdown -> click `用剪贴板替换全文` -> confirmation dialog opens and text is unchanged -> click `取消` -> text is still unchanged -> reopen and click `替换全文` -> text is replaced from clipboard -> notification exposes `撤销` -> click `撤销` -> source text restores to `测试！！！\n原始正文\n`.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Walkthrough note: this iteration only adds a confirmation layer for a destructive full-document action. Selection-level clipboard replacement remains a fast inline action.

2026-07-02 external LLM i18n polish iteration:

- Rechecked the external-LLM handoff UI in the context of the existing zh-CN/en-US switcher.
- The feature behavior was already local and clipboard-only, but several user-facing strings were still hard-coded in Chinese:
  - `SummaryBar` dropdown labels and title;
  - success notifications for copying optimization prompts with/without正文;
  - filter auto-reveal / rule-reset notifications;
  - source/preview inline menu tooltips, replacement labels, and compact comment form text.
- Added dedicated `llm.*`, `summary.*`, `notify.*`, and `review.*` i18n keys instead of reusing unrelated contribution-page copy.
- Updated `SummaryBar.vue`, `pages/index.vue`, `ReviewSelectionMenu.vue`, and `ReviewSourceSelectionMenu.vue` to use `t(...)` for those strings.
- This is a presentation-layer consistency fix only. It does not change scanner behavior, prompt content, comment storage, replacement semantics, or TipTap/source offset mapping.

2026-07-02 external LLM i18n polish results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Chrome CDP smoke on `http://localhost:3002/`: pass. Because `3001` was already occupied, Nuxt dev used `3002`. Path: set default Chinese settings -> home submit sample text -> open external LLM menu -> verify `外部 LLM`, `复制指令（不带正文）`, `复制指令 + 当前正文`, `用剪贴板替换全文`; then set `en-US` settings -> reload -> home submit sample text -> open external LLM menu -> verify `External LLM`, `Copy prompt only`, `Copy prompt + current text`, `Replace full text from clipboard`.
- Temporary Chrome CDP smoke script and smoke profile directories were removed after validation.

2026-07-02 review editor chrome i18n polish iteration:

- Rechecked the editor itself after polishing the external-LLM dropdown. The source/preview editor chrome still had hard-coded Chinese in:
  - mode labels (`源码` / `预览`);
  - top toolbar counters (`命中`, `可替换`, selected text status);
  - active-hit comment form;
  - comments rail title, unresolved counters, status chips, and card actions;
  - `TextPanel` toolbar titles for deterministic cleanup, next/previous issue navigation, highlight, and Markdown masking.
- Added dedicated `review.*` and `text.*` i18n keys for these editor-specific strings.
- Updated `ReviewEditor.vue` and `TextPanel.vue` to use the existing `useLlmlintI18n()` path instead of inline literals.
- Preview selection failure reasons now also come from i18n, so repeated/unmappable preview selection hints stay consistent with the current locale.
- This remains a UI chrome consistency change only. Rule titles and scanned Chinese manuscript text can still be Chinese in an English interface because they are content, not interface labels.

2026-07-02 review editor chrome i18n polish results:

- Static scan: pass. `ReviewEditor.vue` and `TextPanel.vue` no longer contain direct Chinese UI strings.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Chrome CDP smoke on `http://localhost:3001/`: pass. Path: set `en-US` settings -> submit sample text -> confirm editor toolbar shows `Source`, `Preview`, `hits`, `replaceable`, and `Select body text to add a comment` -> select source text -> add a comment -> confirm comments rail shows `Comments`, `Open 1 / 1`, `Complete`, `Edit`, `Delete` without Chinese UI fallback. The smoke assertion intentionally scopes to editor chrome and comment rail; rule titles and manuscript content are allowed to remain Chinese.
- Temporary Chrome CDP smoke script and smoke profile directories were removed after validation.

2026-07-02 local sidecar comment persistence iteration:

- Rechecked the remaining TODO "Decide whether comments should persist to localStorage or a backend record" against the current no-backend web workflow.
- Chose a conservative browser-local persistence layer:
  - comments remain sidecar review data and are not written back into Markdown;
  - comments are keyed by an exact Markdown body fingerprint (`length + FNV-1a`), so they only restore for the same text content;
  - restored comments are validated by `offset` and `quote`, preventing stale comments from attaching to the wrong text;
  - deleting all comments for a text removes that text's stored comment entry;
  - local storage is capped to the most recent 20 text/comment entries.
- Added `web/app/utils/review-comment-storage.ts`.
- Updated `web/app/components/TextPanel.vue` because it already owns the single sidecar comment state and all text/comment snapshot undo paths.
- During browser verification, the recent-scan reopen path exposed a separate user-flow bug: `HomeInputPanel.loadRecentScan()` set the child `v-model` and immediately submitted before the parent page had received the new text. Updated `web/app/components/HomeInputPanel.vue` to wait one `nextTick()` before submit.
- This keeps the current storage model practical without introducing a backend, URL state, or Markdown serialization change.

2026-07-02 local sidecar comment persistence results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: submit sample text -> add a source sidecar comment on `持久批注目标` -> verify `llmlint.reviewComments.v1` contains the comment -> reload page -> click recent scan -> enter workbench -> verify comment body `刷新后应该恢复` and quote `持久批注目标` are restored.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Temporary Chrome CDP smoke script, smoke profile directories, and the temporary `3003` dev server were removed/stopped after validation.

2026-07-02 clear persisted comments iteration:

- Rechecked the new local sidecar comment persistence from the user's point of view. Once comments reliably restore for the same text, the comments rail also needs a first-class way to clear all comments for the current text instead of forcing one-by-one deletion.
- Added a clear-comments action to the comments rail header in `ReviewEditor.vue`.
- Routed the action to `TextPanel.vue`, the existing owner of sidecar comment state and local persistence.
- Clearing comments now:
  - removes all current text comments from memory;
  - naturally removes the current text entry from `llmlint.reviewComments.v1` through the existing post-flush storage watcher;
  - shows an undo notification;
  - restores the same comment snapshot if undo is clicked, including localStorage persistence.
- Added `review.clearComments`, `review.clearCommentsTitle`, and `notify.commentsCleared` i18n strings for zh-CN/en-US.

2026-07-02 clear persisted comments results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: submit sample text -> add a source sidecar comment -> verify `llmlint.reviewComments.v1` contains the comment -> click comments rail clear button -> verify comment text disappears and storage no longer contains it -> click notification undo -> verify comment text and storage entry return.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Temporary Chrome CDP smoke script, smoke profile directories, and the temporary `3003` dev server were removed/stopped after validation.

2026-07-02 recent scan history i18n polish iteration:

- Rechecked the full "home -> workbench -> recent history -> workbench" loop after local comment persistence made recent history part of the review recovery path.
- `HomeInputPanel.vue` still had hard-coded Chinese in recent history chrome:
  - relative time labels (`刚刚`, `分钟前`, `小时前`);
  - clear/collapse/expand/delete button titles;
  - issue count label (`处 AI 味`);
  - desktop collapsed vertical label (`最近检测`).
- Added `home.*` i18n keys for those labels and switched the date formatter to the current llmlint locale.
- Also added the missing English override for `text.wordCount`, because the same history card and home textarea still showed `0 字` / `31 字` in English mode.
- This is intentionally scoped to UI chrome. Recent scan titles and manuscript snippets can still be Chinese because they are user content.

2026-07-02 recent scan history i18n polish results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: set `en-US` settings -> submit sample text -> reload to home -> verify recent history shows `Recent Scans`, `AI-style hits`, `Just now`, English button titles, and `chars`; collapse history and verify the responsive collapsed label is localized (`RECENT` on desktop or `Recent Scans (1)` on narrower viewport).
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Temporary Chrome CDP smoke script, smoke profile directories, and the temporary `3003` dev server were removed/stopped after validation.

2026-07-02 history cleanup comment-storage iteration:

- Rechecked the local data lifecycle after recent history became the main way to return to a text and restore sidecar comments.
- Before this iteration, deleting a recent scan removed the scan card but left any matching `llmlint.reviewComments.v1` entry behind. Clearing all recent scans also left persisted review comments behind.
- Added storage cleanup helpers to `web/app/utils/review-comment-storage.ts`:
  - `removeStoredReviewCommentsForText(text)` removes one exact text fingerprint entry;
  - `clearStoredReviewComments()` clears all local sidecar comment entries.
- Updated `web/app/composables/useRecentScans.ts`:
  - `removeScan(id)` now removes that scan's comment entry before dropping the scan;
  - `clearScans()` now clears all persisted review comments with the history list.
- This aligns the local privacy/data lifecycle with the UI: if a user clears history, the hidden review notes used by that history path are cleared too.

2026-07-02 history cleanup comment-storage results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: seed local recent scans and matching `llmlint.reviewComments.v1` entries -> click a visible `Delete` history action -> verify that scan and its matching comment entry are removed -> seed two scans/comments -> click `Clear history` -> verify both `llmlint.recentScans.v1` and `llmlint.reviewComments.v1` are `[]`.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Temporary Chrome CDP smoke script, smoke profile directories, and the temporary `3003` dev server were removed/stopped after validation.

2026-07-02 long recent-scan restore iteration:

- Rechecked recent history after sidecar comments started restoring by exact text fingerprint.
- `useRecentScans()` still capped stored text at 10,000 UTF-16 units. For long manuscripts, a comment created after that cutoff could be stored under the full current text but recent-history reopen would load a truncated text, so the comment fingerprint would not match.
- Removed silent text truncation from recent scans. Recent history now keeps exact text in memory and only falls back when `localStorage` cannot persist the list.
- Added defensive recent-scan persistence:
  - write failures prune the largest stored scan first, preserving smaller usable history instead of throwing during editing;
  - old truncated entries where `charCount !== text.length` are filtered on read so stale localStorage cards do not reopen partial text.
- The change is deliberately local to recent history. It does not alter scanner offsets, report export, comment fingerprinting, or the single Markdown text truth state.

2026-07-02 long recent-scan restore results:

- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: seed an old truncated history entry and reload -> verify that card is filtered -> submit a synthetic text whose comment target lands after the old 100k cap -> add a source sidecar comment on that target -> verify recent history and comment storage contain the target/comment -> reload -> reopen from recent history -> verify the full text length, target text, and restored comment are present.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Temporary Chrome CDP smoke script, smoke profile directories, and the temporary `3003` dev server were removed/stopped after validation.

2026-07-02 resizable review workspace and static diff iteration:

- User requested:
  - the gap between the left `ReviewEditor` and right `IssueList` should be draggable, following NeuroBook's resizable panel composable direction;
  - text modifications should be reviewable, starting with deterministic static rule replacement;
  - diff should support an annotation mode with strikethrough deletions; split diff can wait.
- Added `web/app/composables/useResizablePanel.ts`, adapted from NeuroBook's VueUse-based edge-drag composable.
- Changed the workbench from fixed desktop `grid-cols-2` to a desktop flex layout:
  - left editor fills remaining width;
  - right report pane has a persisted width (`workbenchReportWidth`);
  - a center resize handle adjusts the report pane from its left edge;
  - mobile/narrow layout remains stacked and does not enable width dragging.
- Added a sidecar `ReviewTextDiff` model for deterministic static replacements:
  - single auto replacement records deleted text, inserted text, source, title, and next-text range;
  - undo restores text, comments, and diff markers together;
  - ordinary edits transform diff ranges with the same minimal contiguous diff approach as comments and drop markers if the user edits across them.
- Added annotated diff rendering:
  - source mode shows inserted text with a green mark and deleted text as a red strikethrough marker near the replacement point;
  - preview mode uses TipTap decorations/widgets to show the same inserted and deleted text;
  - invisible deleted characters such as zero-width spaces are rendered as readable labels, so deletion-only fixes are visible.
- This does not implement split-screen diff yet, and it does not introduce a real LLM edit backend. Clipboard-based external-LLM replacement remains the temporary flow.

2026-07-02 resizable review workspace and static diff results:

- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: submit static-replacement sample text -> drag the center resize handle left -> verify the right report pane grows and `workbenchReportWidth` persists -> click a right-list auto replacement -> verify text changes -> verify source diff marker exists -> switch preview -> verify strikethrough deletion and diff count are visible.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Temporary Chrome CDP smoke script, smoke profile directories, and the temporary `3003` dev server were removed/stopped after validation.

2026-07-02 batch mechanical clean diff iteration:

- Rechecked the static modification loop after adding annotated diff for single replacements. The top toolbar `清理机械问题` action also changes正文, but it previously replaced the whole text without producing per-change diff markers.
- Added `applyAutoFixWithChanges()` in `skill/src/fix.ts`:
  - reuses the same rule order, target regex, replacement template expansion, and Markdown mask segmentation as `applyAutoFix()`;
  - returns the final fixed text plus per-replacement changes in final-text coordinates;
  - keeps the existing CLI `applyAutoFix()` behavior unchanged.
- Updated `web/app/composables/useLlmlint.ts` so `autoFix()` now returns `changes` alongside `fixed` and `count`.
- Updated `TextPanel.cleanMechanical()` to convert those changes into `ReviewTextDiff` sidecar entries. Undo restores text, comments, and all generated diff markers together.
- This keeps deterministic static cleanup and single static replacement on the same review surface: source/preview both show strikethrough deletions and inserted text markers; deletion-only fixes such as zero-width spaces remain visible as readable labels.

2026-07-02 batch mechanical clean diff results:

- `bun test tests/llmlint.test.ts`: pass, 55 tests. Added coverage for `applyAutoFixWithChanges()` with punctuation replacement, zero-width deletion, and Markdown code-block masking.
- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: submit `测试！！！ / 测​试 / 他说……...` -> click `清理机械问题` -> verify text becomes `测试！ / 测试 / 他说……` -> verify source shows three deletion markers and inserted text -> switch preview and verify three strikethrough deletions plus diff count -> click undo and verify original text and diff markers are restored/cleared.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Temporary Chrome CDP smoke script, smoke profile directories, and the temporary `3003` dev server were removed/stopped after validation.

2026-07-02 selection clipboard diff iteration:

- Rechecked the temporary external-LLM workflow. Source/preview inline menus already support `用剪贴板替换选区`, but that edit did not leave a reviewable diff marker.
- Updated `TextPanel.replaceSelection()` to create a `ReviewTextDiff` entry with `source: "llm"` and title `剪贴板替换选区`.
- This covers both source mode and preview mode because both inline menus already emit the same `{from, to, replacement}` payload.
- Undo now restores text, comments, and clipboard-selection diff markers together, matching static replacement and mechanical cleanup.
- Full-document clipboard replacement still intentionally does not render an annotation diff, because marking an entire manuscript rewrite inline would be noisy and needs a separate LLM edit lifecycle design.

2026-07-02 selection clipboard diff results:

- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: submit sample text -> source-select `待优化片段` -> write `更自然的片段` to clipboard -> click inline `用剪贴板替换选区` -> verify text changes -> verify source diff marker and inserted mark -> switch preview and verify strikethrough deletion, inserted text, and diff count -> undo and verify original text and diff markers are restored/cleared.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Temporary Chrome CDP smoke script, smoke profile directories, and the temporary `3003` dev server were removed/stopped after validation.

2026-07-02 clear diff markers iteration:

- Rechecked the annotated diff review loop from a user's point of view. Once users have reviewed a change, they need a direct way to clear edit markers without undoing the text change.
- Turned the toolbar diff count chip into an action button:
  - visible only when there are current sidecar diff markers;
  - title explains that it clears edit markers for the current text;
  - clears only diff markers, not正文、规则命中、批注或 recent history.
- Added `TextPanel.clearDiffs()` with notification undo. Undo restores the same diff marker snapshot while leaving the already-edited正文 unchanged.

2026-07-02 clear diff markers results:

- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: submit `测试！！！` -> apply one static replacement -> verify text changed and one source diff marker exists -> click the toolbar diff chip -> verify marker disappears while text remains changed -> click notification undo -> verify marker returns.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Temporary Chrome CDP smoke script, smoke profile directories, and the temporary `3003` dev server were removed/stopped after validation.

2026-07-02 right report i18n polish iteration:

- Rechecked the right report pane after the editor chrome was localized. `IssueList.vue`, `IssueCard.vue`, and `DimensionBadges.vue` still had Chinese UI chrome in empty states, filter/rule-settings recovery prompts, rule details buttons, hit counts, locate/apply button titles, expand/collapse text, and the level/review/fixability badges.
- Added dedicated `issue.*` and `dimension.*` i18n keys, plus the missing `common.agent` and `common.candidate` values.
- Updated the right report components to render those labels through `useLlmlintI18n()`.
- The change is intentionally presentation-only. Rule titles, namespaces, hit context, and manuscript snippets remain content and can still be Chinese in an English interface.

2026-07-02 right report i18n polish results:

- Static scan: pass. `IssueList.vue`, `IssueCard.vue`, and `DimensionBadges.vue` only contain Chinese in comments, not visible UI literals.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Attempted a Playwright smoke on `http://localhost:3003/` with Chrome, but the local browser automation stalled during browser startup before any page interaction. The temporary script was removed and the dev server was stopped. This iteration therefore uses type/build/static-scan verification rather than browser behavior evidence.

2026-07-02 diff review navigation iteration:

- Rechecked the annotated diff loop after single/static/batch/clipboard edits could all create sidecar diff markers. The toolbar showed a diff count and could clear markers, but users could not step through generated edits the way they can step through comments.
- Added a compact diff review control to the editor toolbar:
  - previous/next edit buttons;
  - `current/total` diff position label;
  - existing clear-diffs action stays in the same control.
- Added active diff state in `ReviewEditor.vue`.
  - Source mode passes the active state to `HighlightedTextarea.vue`, which outlines the current inserted/deleted marker and scrolls to it through the existing `revealOffset()` path.
  - Preview mode tags TipTap diff decorations with `data-diff-id`, scrolls the active decoration into view, and adds an active outline for inserted/deleted decorations.
- Fixed a related preview refresh gap: TipTap preview decorations now watch `props.diffs`, so clearing diff markers or changing the active diff refreshes preview immediately even when the Markdown text itself does not change.
- Added zh-CN/en-US i18n strings for previous/next edit tooltips.

2026-07-02 diff review navigation results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: set English settings -> submit `测试！！！ / 测​试 / 他说……...` -> click one-click mechanical cleanup -> verify `0/3` diff review label -> click next edit to `1/3` and `2/3` -> verify source active diff outline exists -> switch preview -> verify active TipTap diff decoration exists. Temporary CDP script, Chrome profile directory, and dev server were removed/stopped after validation.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-02 active issue LLM prompt iteration:

- Rechecked the temporary external-LLM workflow from the point where a user has already selected a concrete hit from the right report list or by clicking the body. The global `External LLM` menu can copy a full report, and inline selection menus can copy a selected-fragment prompt, but the active-hit toolbar only supported comment and deterministic replacement.
- Added `buildIssueOptimizationPrompt()` in `web/app/utils/llm-optimization-prompt.ts`.
  - The prompt includes the active rule title, level, match text, fixability/replacement guidance, two-line local context around the hit, and nearby sidecar comments.
  - It asks the external LLM to return only the optimized local fragment, preserving Markdown and avoiding extra explanation.
- Added a wand button to the active-hit toolbar in `ReviewEditor.vue`.
  - It appears when `activeIssueMark` is present, next to the existing "comment hit" and replacement controls.
  - It copies the active-hit prompt to the clipboard and reuses the existing optimization-copy notification.
- Added zh-CN/en-US i18n keys for this toolbar action.
- This keeps the web app LLM-free: no remote call is made, and no text state changes. It only improves the clipboard bridge for the current no-backend compromise.

2026-07-02 active issue LLM prompt results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: set English settings -> submit text with repeated punctuation / zero-width hit -> select a right-list issue -> verify the active-hit toolbar shows `Copy hit prompt` -> click it -> read clipboard -> verify the prompt contains `# 中文局部命中优化任务`, `## 当前命中`, `## 命中上下文`, the hit text/context, and local-fragment return instructions. Temporary CDP script, Chrome profile directory, and dev server were removed/stopped after validation.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-02 workbench chrome i18n follow-up:

- Browser smoke for the active-hit LLM prompt exposed more English-mode UI chrome falling back to Chinese in the workbench:
  - `TextPanel` toolbar labels `行内高亮` / `Markdown 遮罩`;
  - summary count `共 N 处`;
  - namespace dropdown count text;
  - `LlmRulesPanel` collapsed title and explanatory paragraph.
- Added missing en-US overrides for `text.highlight`, `text.mask`, `summary.clean`, `summary.hidden`, `summary.noIssues`, `summary.total`, and `settings.namespaces`.
- Added `settings.namespaceCount` and wired `FilterControls.vue` to use it.
- Added `llmRules.title` / `llmRules.description` and wired `LlmRulesPanel.vue` to use the existing i18n path.
- This remains scoped to app chrome. Rule titles, rule prompts, namespaces, and user manuscript text are content and can still be Chinese under an English UI.

2026-07-02 workbench chrome i18n follow-up results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: set English settings -> submit text with repeated punctuation / zero-width hit -> verify workbench chrome contains `Inline highlights`, `Markdown mask`, `Namespaces`, `4 hits`, `Scanned 303 rules`, `External LLM`, and `Agent semantic rules`; verify it no longer contains the targeted Chinese UI strings `行内高亮`, `共 4 处`, `命名空间`, `需 Agent 语义判断的规则`, `本页纯 regex 不检测`. Temporary CDP script, Chrome profile directory, and dev server were removed/stopped after validation.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-02 rule detail dialog i18n follow-up:

- Rechecked the right report `Details` flow after the report list chrome was localized. `RuleDetailDialog.vue` still had hard-coded Chinese section labels:
  - `匹配模式`;
  - `修复动作`;
  - empty replacement label `（删除）`;
  - `示例`.
- Added `ruleDetail.*` i18n keys and updated `RuleDetailDialog.vue` to use them.
- This localizes dialog chrome only. Rule title, note, example text, and action message still come from the rule catalog and remain content.

2026-07-02 rule detail dialog i18n follow-up results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- Chrome CDP smoke on `http://localhost:3003/`: pass. Path: set English settings -> submit text with repeated punctuation / zero-width hit -> click first right-list `Details` -> verify dialog shows `Pattern` and `Action`, and no longer shows targeted Chinese chrome `匹配模式`, `修复动作`, `示例`. Temporary CDP script, Chrome profile directory, and dev server were removed/stopped after validation.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-02 settings/header i18n follow-up:

- Rechecked the Settings and account menu path after the workbench and rule detail dialog were localized.
- `AppHeader.vue` logout success/failure notifications now use `notify.logoutOk` / `notify.logoutFailed` instead of hard-coded Chinese strings.
- `SettingsDialog.vue` rule override chrome now uses i18n for Agent/Candidate labels, namespace active-count text, and Level/Review/Fixability form labels.
- Added the missing en-US settings description overrides (`displayDescription`, `detectionDescription`, `ruleConfig`, `ruleDescription`, `noRuleResult`) so the Rules tab no longer falls back to Chinese explanatory text in English mode.

2026-07-02 settings/header i18n follow-up results:

- Static scan: pass. Targeted Chinese logout and settings-rule chrome remains only in `messages.ts` locale entries, not in `AppHeader.vue` or `SettingsDialog.vue`.
- Browser smoke on `http://localhost:3003/`: pass. Path: set English settings -> open Settings -> switch to Rules -> verify `Reset all rule overrides`, `active`, `Level`, `Review`, and `Fixability`; verify targeted Chinese strings such as `重置全部规则配置`, `启用`, and `修复能力` are not visible. Temporary smoke script and dev server were removed/stopped after validation.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-02 auth pages i18n follow-up:

- A broader UI chrome scan found that the header account menu could switch to English, but the `/login` and `/register` pages still rendered Chinese-only form chrome.
- Added `auth.*` i18n keys for login/register titles, descriptions, username/password/identity labels, identity role options, loading text, success notifications, error fallbacks, and cross-links.
- Updated `login.vue` and `register.vue` to use `useLlmlintI18n()` while keeping the existing auth API payloads and redirect behavior unchanged.

2026-07-02 auth pages i18n follow-up results:

- Static scan: pass. Targeted login/register Chinese UI strings remain only in `messages.ts` locale entries, not in the page components.
- Browser smoke on `http://localhost:3003/`: pass. Path: set English settings -> open `/login` and `/register` -> verify `Log in`, `Create account`, `Username`, `Password`, `Identity`, and cross-links; verify targeted Chinese auth chrome does not appear. Temporary smoke script and dev server were removed/stopped after validation.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 comment context copy iteration:

- Re-ran the main review path and mobile review path before choosing the next increment. Source selection comments, preview comment marks, mechanical cleanup, and annotated diff rendering were already healthy.
- Added a compact copy action to each comment rail card. It copies the reviewed quote, comment body, and current comment status as plain text.
- This keeps comments as sidecar review data, but makes them easier to hand off to an external LLM or another reviewer, matching the current no-LLM-backend bridge instead of adding a premature edit backend.
- Added zh-CN/en-US i18n keys for comment quote/body/status labels, the copy action title, and the success notification.

2026-07-03 comment context copy results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit review text -> select source text -> add sidecar comment -> click the new comment copy action -> read clipboard and verify quote/comment/status -> switch preview -> run mechanical cleanup -> verify preview diff markers.
- Mobile browser smoke on `http://localhost:3003/`: pass. Path: mobile viewport -> submit text -> source select -> verify inline menu stays inside viewport -> add comment -> verify comment card stays inside viewport.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 selection prompt context iteration:

- Rechecked the external-LLM bridge from the inline menu. The selected-fragment prompt contained the selection and any intersecting rule/replacement, but it did not include surrounding text or nearby sidecar comments.
- Extended `buildSelectionOptimizationPrompt()` with optional full text and comments. When available, the prompt now includes:
  - the selected text as the exact return target;
  - a small Markdown context window around the selection;
  - a reminder to return only the selected fragment, not the whole context;
  - nearby user comments, ordered in the same pending/done style used elsewhere.
- `ReviewEditor` now passes the current Markdown text and sidecar comments into both source and preview selection menus. The menus still only own UI actions; prompt assembly stays in `llm-optimization-prompt.ts`.
- This moves llmlint closer to NeuroBook's selection-reference workflow without introducing a real LLM backend or making preview editable.

2026-07-03 selection prompt context results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text with surrounding paragraphs -> source-select a phrase -> add a sidecar comment -> reselect the phrase -> click `复制选区优化指令` -> read clipboard and verify `## 选中文本`, `## 选区上下文`, surrounding paragraphs, the "only return selected text" instruction, and `## 相关用户批注`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 full clipboard replacement diff iteration:

- Rechecked the temporary external-LLM full-document loop. The user could copy a full prompt, let an external LLM rewrite the text, and use `用剪贴板替换全文`, but the resulting edit did not leave reviewable diff markers.
- Added `buildLineDiffRangesForTextReplacement()` in `review-ranges.ts`:
  - computes line-level changed hunks with an LCS over unchanged lines;
  - stores each changed hunk as a `ReviewTextDiff` in the next-text coordinate system;
  - compares lines with CRLF normalized to LF so Windows textarea line endings do not turn unchanged lines into false diffs;
  - falls back to a single line-expanded contiguous hunk for very large line matrices.
- `TextPanel.replaceTextFromClipboard()` now converts a full clipboard replacement into `source: "llm"` diff markers titled `剪贴板替换全文` / `Full text replaced from clipboard`.
- Fixed a preview refresh gap found during the smoke test: when diffs are created while the source editor is visible, switching to preview now refreshes TipTap decorations after `EditorContent` mounts.

2026-07-03 full clipboard replacement diff results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit a three-line document -> write an externally edited full document to clipboard -> use SummaryBar `外部 LLM > 用剪贴板替换全文` -> confirm -> verify textarea value changed -> verify source diff marker only covers the changed line -> switch preview -> verify deleted old line and inserted new line are both visible.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 clear-current diff marker iteration:

- Rechecked the annotated diff review loop after diff navigation was available. Users could jump between edits or clear every marker, but the common "I have reviewed this one edit" action still required clearing all markers.
- Added a current-edit clear action to the diff toolbar:
  - it is disabled until a diff is selected with previous/next;
  - it removes only the active sidecar diff marker and leaves the edited Markdown text unchanged;
  - after removal it advances to the next available diff when possible.
- Added `TextPanel.clearDiff(id)` with notification undo. Undo transforms the cleared marker through any later text change before restoring it, and skips restoration if the marker would be stale.
- Added zh-CN/en-US i18n for the current-edit clear action, disabled tooltip, single-marker success notification, and stale-restore warning.

2026-07-03 clear-current diff marker results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `测试！！！ / 测​试 / 他说……...` -> run mechanical cleanup -> verify 3 source diff markers -> select next edit -> clear current edit marker -> verify 2 source markers -> undo -> verify 3 markers -> switch preview -> select next edit -> clear current edit marker -> verify 2 preview markers -> undo -> verify 3 preview markers -> switch source and verify正文 remains `测试！ / 测试 / 他说……`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 clickable preview diff marker iteration:

- Rechecked the preview diff review loop against NeuroBook's document-object interaction pattern. The toolbar could step through edits, but rendered diff marks themselves were passive, so users had to move their eyes from the document back to the toolbar before acting.
- Preview diff decorations now expose a direct click target:
  - clicking a deleted or inserted diff decoration activates that sidecar diff;
  - the active diff styling and toolbar position update through the same state as previous/next navigation;
  - the existing current-diff clear action can then remove the clicked marker without changing正文.
- Added a localized hover title to preview diff decorations (`点击选中这处修改` / `Click to select this edit`) and pointer cursor styling.

2026-07-03 clickable preview diff marker results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `测试！！！ / 测​试 / 他说……...` -> run mechanical cleanup -> switch preview -> verify 3 diff decorations -> click the first deleted marker -> verify an active preview diff decoration appears -> clear current edit marker -> verify only 2 preview diff decorations remain and rendered正文 still contains the fixed text.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 inline Markdown formatting iteration:

- Rechecked llmlint's source/preview selection menus against NeuroBook `MarkdownSelectionMenu`. llmlint already had review actions (comment/copy/prompt/clipboard replace/static replacement), but it still lacked the basic Markdown formatting actions that make selected text directly editable.
- Added deterministic inline Markdown formatting actions to both source and preview menus:
  - bold wraps/toggles the selected source range with `**...**`;
  - italic wraps/toggles with `*...*`;
  - inline code wraps/toggles with backticks, using double backticks when the selected text already contains a backtick.
- Formatting uses the same `replace-selection` path as clipboard edits, but can pass a specific diff title/source. This keeps text changes, sidecar comment transforms, sidecar diff markers, and notification undo on the existing single text-change path.
- The source and preview menu toolbars now wrap on narrow widths so the additional icons do not overflow mobile layouts.
- Added zh-CN/en-US i18n for formatting button titles and the `Markdown formatting` diff title.

2026-07-03 inline Markdown formatting results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit plain text -> source-select `需要格式化` -> click bold -> verify source becomes `**需要格式化**` and source diff title is `Markdown 格式化` -> switch preview and verify rendered `<strong>` -> preview-select text in `第二段文本` -> click inline-code -> switch source and verify the selected preview text is written back as Markdown inline code.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 formatting feedback and shortcut iteration:

- Rechecked the inline formatting path after adding B/I/code buttons. The text update and diff marker were correct, but the success toast still used the clipboard replacement wording because both actions shared `replace-selection`.
- Extended the `replace-selection` payload with an explicit `notify` kind. Formatting now shows `已格式化选区` / `Selection formatted`, while clipboard replacement keeps the clipboard-specific copy.
- Added keyboard shortcuts for mapped selections:
  - `Ctrl/Cmd+B` toggles bold;
  - `Ctrl/Cmd+I` toggles italic;
  - `Ctrl/Cmd+\`` toggles inline code.
- Shortcut handling reuses `formatSelection()` and deliberately skips comment/edit textareas, so it does not steal keys while a reviewer is writing a comment.
- Formatting button titles now show the shortcuts, making the keyboard path discoverable without adding visible instructional text to the app.

2026-07-03 formatting feedback and shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit plain text -> source-select `需要快捷键` -> verify bold button title includes `Ctrl/Cmd+B` -> press `Ctrl+B` -> verify source becomes `**需要快捷键**` -> verify toast says `已格式化选区` / `Selection formatted` and does not mention clipboard -> click undo -> verify source returns to the original text.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 block Markdown formatting iteration:

- Rechecked the remaining gap against NeuroBook `MarkdownSelectionMenu`. llmlint had inline B/I/code formatting, but not the block-level Markdown actions that authors commonly need while restructuring review text.
- Added deterministic block formatting actions to both source and preview selection menus:
  - blockquote toggles `> ` on the selected lines;
  - bullet list toggles `- ` on the selected lines;
  - ordered list toggles `1.`, `2.`, ... on non-empty selected lines.
- Block formatting expands the edit to the full source lines touched by the selection, so a partial word/line selection still produces valid Markdown lines instead of inserting prefixes mid-line.
- These actions reuse the same `formatSelection()` -> `replace-selection` path as inline formatting, so diff markers, comment transforms, and undo stay on the single Markdown text truth.

2026-07-03 block Markdown formatting results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `第一项 / 第二项 / 引用段落` -> source-select the first two lines -> click bullet list -> verify source becomes `- 第一项 / - 第二项` -> switch preview -> select the last paragraph -> click blockquote -> switch source and verify `> 引用段落` -> source-select the two bullet lines -> click bullet list again -> verify the list prefix is removed.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 mobile selection menu width follow-up:

- Rechecked the inline menus after adding B/I/code and block formatting buttons. The toolbars wrapped, but a 390px mobile smoke caught the source menu shifted 19px past the left viewport edge because the positioning math still used an estimated width while CSS had already capped the actual width.
- Updated `ReviewSourceSelectionMenu.vue` so the computed style also sets the actual menu width to the same clamped width used for center positioning.
- Updated `ReviewSelectionMenu.vue` with an explicit `max-width: min(520px, calc(100vw - 20px))`, keeping the TipTap BubbleMenu content itself inside the viewport after Floating UI placement.
- Both source and preview menu issue rows/toolbars now use `width/max-width: 100%` constraints so wrapped rows stay inside the menu shell.

2026-07-03 mobile selection menu width results:

- Mobile browser smoke on `http://localhost:3003/` at `390x844`: pass. Path: submit text -> source-select text -> verify `.review-source-selection-menu` left/right/width stay inside viewport -> switch preview -> drag-select rendered text -> verify `.review-selection-menu` left/right/width stay inside viewport.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 Markdown link formatting iteration:

- Rechecked the next visible gap against NeuroBook `MarkdownSelectionMenu`: llmlint had review actions plus B/I/code/blockquote/list formatting, but still lacked the common selected-text link action.
- Added a link action to both source and preview inline selection menus. The action opens an inline URL form inside the menu instead of a browser prompt, so the user stays in the current review context and mobile width constraints still apply.
- `ReviewEditor` now formats links through the same single Markdown text path as other selection edits:
  - source and preview selections emit a mapped source range;
  - selected text is written as `[label](url)`;
  - selecting a complete existing Markdown link updates the URL while keeping the label;
  - whitespace around the selected core text is preserved.
- Link formatting uses `replace-selection` with a dedicated `Markdown 链接` / `Markdown link` diff title, so sidecar diff markers, comment transforms, and notification undo remain on the existing edit pipeline.

2026-07-03 Markdown link formatting results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit plain text -> source-select `链接文本` -> use the source inline link form -> verify source becomes `[链接文本](https://example.com/source)` -> switch preview and verify the rendered `<a>` -> preview-select `预览链接` -> use the preview inline link form -> switch source and verify `[预览链接](https://example.com/preview)` was written back.
- Mobile browser smoke on `http://localhost:3003/` at `390x844`: pass. Path: submit text -> source-select `移动链接` -> open the link URL form -> verify `.review-source-selection-menu` remains inside the viewport.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 strikethrough and code-block formatting iteration:

- Rechecked the inline menus against NeuroBook `MarkdownSelectionMenu` again after link support. The next practical Markdown actions missing from llmlint were strikethrough and fenced code block formatting.
- Added deterministic strikethrough formatting to both source and preview menus. It toggles the selected core text with `~~...~~` and reuses the existing formatting notification/diff path.
- Added deterministic fenced code-block formatting to both source and preview menus. The action expands to the full selected source lines and toggles a surrounding triple-backtick block.
- Browser validation exposed a lifecycle bug specific to preview structural formatting: changing a selected paragraph into a code block while the TipTap BubbleMenu was still mounted could trigger a Vue DOM patch error. `formatSelection()` now closes the preview selection menu first and applies the Markdown replacement on the next tick, so the menu unmount and ProseMirror document rewrite no longer collide. Source mode still applies synchronously.

2026-07-03 strikethrough and code-block formatting results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit plain text -> source-select `删除线文本` -> click strikethrough -> verify source contains `~~删除线文本~~` -> switch preview and verify rendered `<s>/<del>` -> preview-select `代码段` -> click code block -> verify rendered `<pre><code>` -> switch source and verify the fenced block was written back.
- Mobile browser smoke on `http://localhost:3003/` at `390x844`: pass. Path: submit text -> source-select `移动端文本` and verify `.review-source-selection-menu` stays inside viewport -> switch preview, select the same text, and verify `.review-selection-menu` stays inside viewport after the extra buttons.
- Focused probes: source-only strikethrough passed; preview code-block formatting passed without the previous Vue `insertBefore`/`__vnode` page errors after the next-tick menu teardown fix.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 text block style menu iteration:

- Rechecked the source/preview inline menus against NeuroBook `MarkdownSelectionMenu` after the toolbar gained many Markdown actions. Adding more always-visible heading icons would keep making the menu wider, so this iteration adds a compact text-block style entry instead.
- Both source and preview menus now expose a `文本块样式` / `Text block style` button. It opens an in-menu panel with `段落`, `标题 1`, `标题 2`, and `标题 3`.
- Heading formatting stays deterministic over the single Markdown string:
  - selected source lines expand to full lines;
  - H1/H2/H3 replace any existing ATX heading prefix or add the selected level;
  - selecting the same heading level again removes that heading marker;
  - `段落` only removes ATX heading markers, and deliberately does not strip list/quote/code syntax.
- The text-block panel lives inside the same menu shell instead of as a free-floating dropdown, so it stays within the established mobile width constraints.

2026-07-03 text block style menu results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit plain text -> source-select `标题文本` -> open `文本块样式` -> choose `标题 2` -> verify source contains `## 标题文本` and preview renders `<h2>` -> preview-select `预览标题` -> choose `标题 3` -> switch source and verify `### 预览标题` -> source-select it -> choose `段落` -> verify the heading marker is removed.
- Mobile browser smoke on `http://localhost:3003/` at `390x844`: pass. Path: source-select `移动标题` -> open text-block panel -> verify `.review-source-selection-menu` stays inside viewport -> switch preview, select the same text, open text-block panel, and verify `.review-selection-menu` stays inside viewport.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 clear Markdown formatting iteration:

- Rechecked NeuroBook `MarkdownSelectionMenu` after adding text-block style. The remaining common editing action that fits llmlint's single Markdown text contract is "clear formatting".
- Added a clear-formatting eraser action to both source and preview inline menus.
- The action is now inline/block adaptive:
  - a normal single-line inline selection clears only the selected inline Markdown wrapper, so clearing `~~删除线~~` does not also strip a nearby `` `代码` `` span;
  - a cross-line selection, or any selection inside heading/list/quote/fenced-block structure, expands to the full selected source lines and removes common block Markdown syntax while preserving visible text.
- Block clearing removes:
  - ATX heading markers;
  - quote and one list marker level;
  - surrounding fenced code block lines when the selection covers a fenced block;
  - links/images while keeping labels/alt text;
  - inline code, strikethrough, bold, and italic markers.
- This intentionally stays Markdown-native. It does not try to strip HTML, custom color syntax, or private editor attributes because llmlint web does not own those formats.

2026-07-03 clear Markdown formatting results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit Markdown with heading, bold, quote/list, link, strikethrough, and inline code -> source-select the heading/link block -> clear formatting -> verify source becomes `标题文本 / 链接文本` without heading/bold/quote/list/link markers -> reset to `这段有 ~~删除线~~ 和 \`代码\`。` -> preview-select only `删除线` -> clear formatting -> verify source becomes `这段有 删除线 和 \`代码\`。`, preserving the unrelated inline code span.
- Mobile browser smoke on `http://localhost:3003/` at `390x700`: pass. Path: source-select text and verify `.review-source-selection-menu` stays inside viewport after the eraser button -> switch preview, select rendered text, and verify `.review-selection-menu` stays inside viewport.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 inline menu active-state iteration:

- Rechecked llmlint source/preview menus against NeuroBook `MarkdownSelectionMenu`. The actions were present, but buttons did not show whether the selected text was already bold, linked, struck through, inline code, heading, quote, list, or code block.
- Added shared `markdownSelectionState()` for source-range based Markdown state detection. Both source and preview menus use the same Markdown truth instead of making preview depend on TipTap `isActive()`, which is unreliable in llmlint's intentionally read-only preview.
- Source and preview menu buttons now show an `is-active` state for:
  - text block style when the selection is inside an H1/H2/H3 line;
  - bold, italic, inline code, strikethrough, link;
  - blockquote, bullet list, ordered list, and fenced code block.
- Added `data-selection-*` attributes to the menu shells so browser smoke and future debugging can inspect the mapped source range without reaching into Vue internals.

2026-07-03 inline menu active-state results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit Markdown with H2, bold, link, strikethrough, inline code, quote, and list -> source-select formatted spans and verify source menu active states -> switch preview, select rendered bold/link/strike/code/heading text, and verify preview menu active states.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 existing link edit iteration:

- Rechecked the link action against NeuroBook `MarkdownSelectionMenu`. NeuroBook pre-fills the current URL when editing an existing link; llmlint always opened the inline link form with `https://`, even though the underlying formatter already knew how to update an existing Markdown link.
- Extended the shared Markdown selection helper with `markdownSelectionLinkHref()`. Source and preview menus now use the same source-range contract to:
  - detect whether the selected text is inside an existing Markdown link;
  - prefill the inline URL field with that link's current href;
  - keep the existing label while replacing only the destination URL.
- Browser validation exposed a read-only preview edge case: selecting rendered link text did not always update ProseMirror selection, so TipTap's BubbleMenu did not open. `ReviewEditor` now syncs browser DOM selection back into a ProseMirror `TextSelection` on preview mouseup when the selection lives inside the preview editor. This keeps rendered-link selection on the same `selectionFromPreview()` mapping path as ordinary text.

2026-07-03 existing link edit results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `[源码链接](https://old.example/source)` and `[预览链接](https://old.example/preview)` -> source-select the first label -> open link form and verify old URL is prefilled -> change URL and verify Markdown updates -> switch preview -> select rendered link label -> open link form and verify old preview URL is prefilled -> change URL and verify source Markdown updates.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 remove link from inline form iteration:

- Rechecked the link editing loop after href prefill. The user could update an existing URL, but unlike NeuroBook's link prompt behavior, there was no direct way to remove the link from the link editing surface.
- Source and preview link forms now show `移除链接` / `Remove link` when the current selection is inside an existing Markdown link.
- The remove action reuses the existing `clear-formatting` path, so it removes only the Markdown link wrapper, preserves the visible label, and still creates the normal formatting diff/undo snapshot.

2026-07-03 remove link from inline form results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit source/preview Markdown links -> source-select first link label -> open link form -> click `移除链接` -> verify source text keeps the label and removes the Markdown link wrapper -> switch preview -> select rendered second link -> open link form -> click `移除链接` -> switch source and verify both labels are plain text.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 block style menu completion iteration:

- Rechecked llmlint's source/preview inline menus against NeuroBook `MarkdownSelectionMenu`. NeuroBook keeps paragraph, headings, lists, blockquote, and code block in one text-block selector; llmlint had the commands and active-state detection, but the dropdown only exposed paragraph and H1/H2/H3.
- Extended the shared block-style dropdown in both source and preview menus to include unordered list, ordered list, blockquote, and fenced code block.
- The block-style button now shows the current list/quote/code-block icon when the selected source range is already inside that block type, instead of falling back to paragraph while a separate icon button is active.
- Kept the existing direct toolbar buttons for fast one-click formatting. The dropdown is now the compact NeuroBook-like overview; the icon buttons remain useful for frequent review edits.

2026-07-03 block style menu completion results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit Markdown text -> source-select an H1 line -> open `文本块样式` and verify unordered list, ordered list, blockquote, and code block options are visible and the current icon shows H1 -> switch preview -> mouse-select a rendered paragraph -> open the same menu and verify those options are visible.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 paragraph block-style semantics iteration:

- After the block-style dropdown gained list/quote/code-block entries, `段落` still only removed ATX heading markers. That made the dropdown look NeuroBook-like but behave inconsistently when the current block was a list item, blockquote, or fenced code block.
- `paragraph` formatting now removes block-level Markdown structure while preserving inline Markdown content:
  - list markers are removed but inline bold/link/code text is kept;
  - blockquote markers are removed;
  - fenced code blocks are unwrapped when the selected text is inside the fence;
  - inline formatting is not cleared, so this stays separate from the eraser action.
- The editor now resolves block-format ranges through a small Markdown block range helper. Normal text still expands to full selected source lines; selections inside complete ``` / ~~~ fenced code blocks expand to the whole fenced block.
- The shared Markdown selection-state helper now also detects that a selection inside a fenced code block is currently a code block, so source/preview block-style buttons do not fall back to paragraph for code-block interiors.

2026-07-03 paragraph block-style semantics results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit Markdown with `- **列表项**`, `> 引用段落`, and a fenced code block -> source-select `列表项` and choose `段落`, verifying the bullet marker is removed while `**...**` remains -> preview-select rendered `引用段落` and choose `段落`, verifying the quote marker is removed -> preview-select text inside the rendered code block and choose `段落`, verifying both fences are removed while code text remains.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 tilde fenced code-block toggle iteration:

- The source-range state helper already recognized both ``` and ~~~ fenced code blocks, and paragraph/clear-formatting could unwrap both forms. However, the dedicated `代码块` toggle only unwrapped ``` fences.
- This meant selecting text inside an existing `~~~js ... ~~~` block and clicking `代码块` could wrap the whole tilde block inside a new triple-backtick block instead of toggling it off.
- `toggleCodeFenceBlock()` now detects the opening fence marker and unwraps when the matching closing marker is either ``` or ~~~. New code blocks still use ``` as the normalized output.

2026-07-03 tilde fenced code-block toggle results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit a `~~~js` fenced code block -> source-select `const tilde` -> choose `代码块` and verify both tilde fences are removed while code text remains -> resubmit the same text -> preview-select the rendered code text -> verify the block-style button detects code-block state -> choose `代码块` and verify source no longer contains tilde fences.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 angle link destination iteration:

- Link editing still relied on `[^)]`-style regexes in two places. This was fragile for the Markdown links llmlint itself can produce, because `formatMarkdownLinkDestination()` wraps destinations containing spaces or parentheses as `<...>`.
- Example problem: selecting the label in `[源码链接](<https://old.example/a path/foo(bar)>)` could prefill a truncated URL or update only the label text, producing nested Markdown links instead of replacing the existing link destination.
- Added a small shared inline Markdown link scanner in `markdown-selection-state.ts`. It handles `[label](url)`, `![alt](url)`, and angle destinations such as `<https://example.test/a path/foo(bar)>`.
- Source and preview menus now use the shared scanner for active-link state and href prefill. `ReviewEditor` also reuses it for updating and clearing existing links, so selecting any part of the label updates/removes the whole link wrapper while preserving the label text.
- The link form now pre-fills angle destinations without the surrounding `< >`; submitting a destination with spaces or parentheses still writes normalized angle syntax back to Markdown.

2026-07-03 angle link destination results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `[源码链接](<https://old.example/a path/foo(bar)>)` and `[预览链接](<https://old.example/preview(foo) path>)` -> source-select the first label, open link form, verify the old URL is prefilled without angle brackets, update it to `https://new.example/fn(x) y`, and verify Markdown becomes `[源码链接](<https://new.example/fn(x) y>)` without nested brackets -> switch preview, select the rendered second link, verify prefill, click `移除链接`, and verify source keeps plain `预览链接`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 balanced parenthesis link destination iteration:

- After angle destination support, non-angle links with balanced parentheses still used the first unescaped `)` as the destination end. Common Markdown links such as `[源码链接](https://old.example/foo(bar))` were therefore parsed as `https://old.example/foo(bar`.
- The inline link scanner now balances unescaped parentheses for non-angle destinations. It still keeps angle destinations on the simpler `<...>` scan path.
- This keeps source/preview link editing consistent for the two URL shapes users are likely to paste: raw balanced-parenthesis URLs and normalized angle URLs generated by llmlint when the user submits a URL containing spaces or parentheses.

2026-07-03 balanced parenthesis link destination results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `[源码链接](https://old.example/foo(bar))` and `[预览链接](https://old.example/preview(foo))` -> source-select the first label and verify the link form pre-fills the full balanced-parenthesis URL -> update to `https://new.example/fn(x)` and verify Markdown normalizes to `[源码链接](<https://new.example/fn(x)>)` without nesting -> switch preview, select rendered `预览链接`, verify prefill is `https://old.example/preview(foo)`, remove the link, and verify the label remains as plain text.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 exclusive block type conversion iteration:

- Rechecked the block-style dropdown against NeuroBook `MarkdownSelectionMenu`. TipTap changes the current block node/list type; it does not stack incompatible block markers.
- llmlint's Markdown-string implementation still stacked markers in some cross-type transitions, for example H2 -> bullet list could produce `- ## 标题`, and blockquote -> heading could produce `### > 引用`.
- Block-style formatting now treats heading, bullet list, ordered list, and blockquote as mutually exclusive block types:
  - applying a different block type strips existing heading/list/quote prefixes before adding the target marker;
  - applying the same block type still toggles it off;
  - inline Markdown inside the line remains intact.
- `段落` and clear-formatting now reuse the same block-prefix stripping helper, keeping the behavior consistent across block-style and eraser actions.

2026-07-03 exclusive block type conversion results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `## 标题转列表`, `> 引用转标题`, and `1. 有序转引用` -> source-select the heading and choose `无序列表`, verifying `- 标题转列表` without `##` stacking -> preview-select the blockquote and choose `标题 3`, verifying `### 引用转标题` without `>` stacking -> source-select the ordered-list item and choose `引用`, verifying `> 有序转引用` without `1.` stacking.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 list indent/outdent iteration:

- NeuroBook `MarkdownSelectionMenu` exposes list indent/outdent through TipTap `sinkListItem` / `liftListItem`. llmlint had list type switching, but no way to adjust nested list levels from the inline review menu.
- Added `增加列表缩进` / `减少列表缩进` icon buttons to both source and preview inline menus, enabled only when the mapped source range is currently inside a bullet or ordered list.
- The implementation stays Markdown-string native and conservative:
  - indent adds four leading spaces to selected list lines;
  - outdent removes one tab or up to four leading spaces from selected list lines;
  - non-list lines in the selected block are left unchanged;
  - ordered and unordered list markers are preserved.
- The command uses the same format pipeline as other source/preview edits, so diff markers, comment transforms, and undo notifications remain consistent.

2026-07-03 list indent/outdent results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `- 第一项`, `- 第二项`, `1. 第三项` -> source-select `第一项`, click `增加列表缩进`, verify `    - 第一项` -> source-select it again, click `减少列表缩进`, verify it returns to `- 第一项` -> preview-select rendered `第二项`, click `增加列表缩进`, switch source and verify `    - 第二项` -> source-select ordered `第三项`, click `增加列表缩进`, verify `    1. 第三项`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 source list Tab shortcut iteration:

- Source mode still required the inline menu for list nesting even though NeuroBook's TipTap editor supports keyboard list editing.
- `HighlightedTextarea` now detects `Tab` / `Shift+Tab` only when the current caret line or selected line range contains Markdown bullet/ordered list items. Non-list paragraphs keep the browser's default Tab behavior, so the source editor does not unexpectedly insert formatting into ordinary prose.
- The textarea emits a narrow source-format command with the exact line range and caret offset. `ReviewEditor` still owns Markdown replacement through the existing formatting pipeline, so diff markers, comment transforms, undo notifications, and source truth remain unified.
- After the replacement, the source caret is adjusted by the changed indentation width instead of jumping to an arbitrary line end.

2026-07-03 source list Tab shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit normal prose, bullet list, and ordered list -> place caret inside `- 第一项`, press `Tab`, verify `    - 第一项` -> press `Shift+Tab`, verify it returns to `- 第一项` -> select two ordered-list lines and press `Tab`, verify both become indented ordered-list lines -> place caret inside normal prose and press `Tab`, verify text is unchanged.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 block formatting shortcut iteration:

- Rechecked llmlint review menus against NeuroBook's TipTap `MarkdownSelectionMenu`. llmlint already had menu buttons for block styles, but keyboard formatting was still limited to inline marks (`Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Ctrl/Cmd+\``).
- Added conservative block-format shortcuts for existing source/preview selections:
  - `Ctrl/Cmd+Alt+0` -> paragraph;
  - `Ctrl/Cmd+Alt+1/2/3` -> H1/H2/H3;
  - `Ctrl/Cmd+Shift+7` -> ordered list;
  - `Ctrl/Cmd+Shift+8` -> bullet list.
- The shortcuts only fire when a mappable review selection exists and the target is not a comment/link editing field. They reuse `formatSelection()`, so source truth, sidecar diff, undo notification, and comment range transforms remain on the same path as menu formatting.
- Preview list indent/outdent disabled tooltips now say `先选择列表项` when a valid non-list selection is active, instead of misleadingly saying the user should select text first.
- Updated zh-CN/en-US tooltips so the block style and list buttons expose the new shortcuts.

2026-07-03 block formatting shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `alpha line / beta line / gamma line` -> source-select `alpha line`, press `Ctrl+Alt+1`, verify `# alpha line` -> select it again, press `Ctrl+Alt+0`, verify paragraph -> source-select `beta line`, press `Ctrl+Shift+8`, verify `- beta line` -> switch preview, DOM-select rendered `gamma line`, press `Ctrl+Alt+2`, switch source and verify `## gamma line`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 link shortcut iteration:

- Rechecked common TipTap/Markdown editing expectations after block shortcuts. The link button and link form existed in both source and preview menus, but keyboard users still had to reach for the mouse.
- Added `Ctrl/Cmd+K` as a source/preview review-selection shortcut. It opens the existing link form for the active mappable selection rather than writing a default link directly.
- The shortcut is coordinated by `ReviewEditor` through a small request token, while `ReviewSelectionMenu` and `ReviewSourceSelectionMenu` keep owning their local link forms. This keeps source/preview behavior aligned without creating a duplicate link-editing UI.
- Link input fields are now excluded from global review shortcuts, so typing or editing a URL cannot accidentally retrigger selection formatting.
- Updated zh-CN/en-US link tooltips to expose `Ctrl/Cmd+K`.

2026-07-03 link shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `alpha link / beta link` -> source-select `alpha link`, press `Ctrl+K`, verify the source link form opens, enter `https://example.test/source`, submit, verify `[alpha link](https://example.test/source)` -> switch preview, DOM-select `beta link`, press `Ctrl+K`, enter `https://example.test/preview`, submit, switch source and verify `[beta link](https://example.test/preview)`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 comment shortcut iteration:

- Rechecked the reviewer's core loop after link shortcuts. Adding comments is the central review action, but keyboard users still had to click the inline menu's `批注` button.
- Added `Ctrl/Cmd+Alt+M` as a source/preview review-selection shortcut. It opens the existing inline comment form for the active mappable selection.
- The shortcut uses a parent-owned request token, like the link shortcut, while `ReviewSelectionMenu` and `ReviewSourceSelectionMenu` keep owning their local comment forms. This avoids a second comment UI and preserves the existing save/cancel/rail activation path.
- The shortcut is ignored inside review comment/link inputs and active-issue comment inputs, so writing a comment cannot accidentally reopen or replace another selection action.
- Updated zh-CN/en-US comment tooltips to expose `Ctrl/Cmd+Alt+M`.

2026-07-03 comment shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `alpha comment / beta comment` -> source-select `alpha comment`, press `Ctrl+Alt+M`, verify the source comment form opens, save `source shortcut note`, verify the rail shows it -> switch preview, DOM-select `beta comment`, press `Ctrl+Alt+M`, save `preview shortcut note`, verify the rail shows it.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 diff review shortcut iteration:

- Rechecked the post-edit review loop. Diff markers already had toolbar buttons for previous/next/current-clear, but keyboard users still had to leave the editor surface to inspect or clear modifications.
- Added diff-review shortcuts that only run outside review text inputs:
  - `Ctrl/Cmd+Alt+N` -> next edit marker;
  - `Ctrl/Cmd+Alt+P` -> previous edit marker;
  - `Ctrl/Cmd+Alt+Enter` -> clear the current active edit marker.
- The shortcuts reuse existing `navigateDiff()` / `clearActiveDiff()`, so source/preview scrolling, active marker state, and clear-current behavior stay on the same implementation path as the toolbar buttons.
- Updated zh-CN/en-US toolbar titles for previous/next/current-clear diff actions to expose the shortcuts.

2026-07-03 diff review shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `alpha edit / beta edit` -> source-select `alpha edit`, press `Ctrl+B` to create one formatting diff -> source-select `beta edit`, press `Ctrl+I` to create another diff -> verify review label starts at `0/2` -> press `Ctrl+Alt+N`, verify `1/2` -> press `Ctrl+Alt+N`, verify `2/2` -> press `Ctrl+Alt+P`, verify `1/2` -> press `Ctrl+Alt+Enter`, verify the active marker is cleared and the review label becomes `1/1`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 strikethrough shortcut iteration:

- Rechecked inline formatting parity. Bold, italic, and inline code already had keyboard shortcuts, but strikethrough still required clicking the inline menu even though the command and active-state detection already existed in source/preview.
- Added `Ctrl/Cmd+Shift+X` to `formatCommandFromShortcut()` for `strike`.
- The shortcut reuses the existing `formatSelection("strike")` path, so source/preview Markdown replacement, diff creation, undo notification, and comment range transform behavior remain identical to the toolbar button.
- Updated zh-CN/en-US strikethrough tooltips to expose the shortcut.

2026-07-03 strikethrough shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `alpha strike / beta strike` -> source-select `alpha strike`, press `Ctrl+Shift+X`, verify source contains `~~alpha strike~~` -> switch preview, DOM-select rendered `beta strike`, press `Ctrl+Shift+X`, switch source and verify `~~beta strike~~`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 clear-formatting shortcut iteration:

- Rechecked keyboard parity after inline mark shortcuts. Source and preview inline menus already exposed the eraser action, but keyboard users still had no direct way to strip Markdown formatting from a selected range.
- Added `Ctrl/Cmd+\` to `formatCommandFromShortcut()` for `clear-formatting`.
- The shortcut reuses the existing clear-formatting pipeline, so source/preview Markdown replacement, sidecar diff creation, undo notification, and comment range transforms remain consistent with the eraser button.
- Updated zh-CN/en-US clear-formatting tooltips to expose the shortcut.

2026-07-03 clear-formatting shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `**alpha clear**` and `~~beta clear~~` -> source-select `alpha clear`, press `Ctrl+\`, verify the bold wrapper is removed while the selected text remains -> switch preview, DOM-select rendered `beta clear`, press `Ctrl+\`, switch source and verify the strikethrough wrapper is removed.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 comment review shortcut iteration:

- Rechecked the reviewer loop around the comment rail. The rail already had previous/next buttons and an unresolved-first queue, but keyboard users still had to leave the editor surface to move between comments.
- Added comment review shortcuts:
  - `Ctrl/Cmd+Alt+J` -> next comment in the current review queue;
  - `Ctrl/Cmd+Alt+K` -> previous comment in the current review queue.
- The shortcuts reuse `navigateComment()`, so source/preview scrolling, active numbered marks, comment card activation, and unresolved-first behavior stay identical to the rail buttons.
- Shortcut handling skips review text inputs and link fields, so writing or editing a comment does not accidentally move the active comment.
- Updated zh-CN/en-US rail button titles to expose the shortcuts.

2026-07-03 comment review shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `alpha comment / beta comment` -> create two source comments through the existing inline comment shortcut -> verify the rail label starts on the second comment -> press `Ctrl+Alt+K` and verify the active card moves to the first comment -> press `Ctrl+Alt+J` and verify it moves back to the second comment.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 active comment resolve shortcut iteration:

- Rechecked the keyboard review loop after adding comment navigation. Users could move between comments with the keyboard, but completing or reopening the active comment still required clicking the card action.
- Added `Ctrl/Cmd+Alt+D` for the active comment:
  - if the active comment is open, the shortcut completes it;
  - if the active comment is already completed, the shortcut reopens it.
- The shortcut reuses `toggleCommentResolvedFromRail()`, so completing the active unresolved comment still advances to the next unresolved comment when one exists.
- The shortcut is ignored inside comment/link inputs, and the rail action button titles now expose the same shortcut.

2026-07-03 active comment resolve shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `alpha comment / beta comment` -> create two source comments -> press `Ctrl+Alt+K` to activate the first comment -> press `Ctrl+Alt+D` and verify the first comment becomes completed and the active review label advances to `1/1` for the remaining open comment -> press `Ctrl+Alt+D` again and verify the second comment becomes completed.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 active comment edit shortcut iteration:

- Rechecked the keyboard review loop after comment navigation and completion shortcuts. Users could move between comments and mark them done, but editing the active comment still required clicking the card button.
- Added `Ctrl/Cmd+Alt+E` for editing the active comment.
- The shortcut reuses `startEditComment()`, so it activates the existing comment card, opens the existing rail edit form, and focuses the same textarea used by the button path.
- The shortcut is ignored inside comment/link inputs, and the rail edit button title now exposes the same shortcut.

2026-07-03 active comment edit shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `alpha comment` -> create a source comment through the existing inline comment shortcut -> press `Ctrl+Alt+E` -> verify the rail edit textarea opens with the current comment body -> edit and save with `Ctrl+Enter` -> verify the updated body appears in the rail.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 active issue comment shortcut fallback iteration:

- Rechecked the active-hit review path. The toolbar already allowed adding a comment to the current issue without reselecting text, but `Ctrl/Cmd+Alt+M` only opened selection comments.
- Updated the shortcut priority:
  - if a mappable source/preview selection exists, `Ctrl/Cmd+Alt+M` keeps opening the inline selection comment form;
  - if no review selection exists and an active issue exists, the same shortcut opens the current-hit comment form.
- The fallback reuses `openActiveIssueComment()`, so it clears stale selection state, opens the comment rail, and focuses the existing active-hit textarea.
- Updated zh-CN/en-US active-hit comment tooltips to expose the shortcut.

2026-07-03 active issue comment shortcut fallback results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `测试！！！` -> activate the first visible issue row -> press `Ctrl+Alt+M` with no body selection -> verify the active-hit comment textarea opens -> save `active issue shortcut note` with `Ctrl+Enter` -> verify the comment rail contains the note.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 active issue prompt shortcut iteration:

- Rechecked the external-LLM bridge for the active-hit path. The toolbar already had a "copy current hit prompt" button, but keyboard users still had to leave the editor/report flow to click it.
- Added `Ctrl/Cmd+Alt+L` for copying the current active issue prompt.
- The shortcut reuses `copyActiveIssuePrompt()`, so prompt construction, related-comment inclusion, clipboard writing, and success/error notifications stay identical to the toolbar button.
- The shortcut is ignored inside comment/link inputs, and the toolbar button title now exposes the shortcut.

2026-07-03 active issue prompt shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `测试！！！` -> activate the first visible issue row -> press `Ctrl+Alt+L` -> read clipboard -> verify it contains `# 中文局部命中优化任务`, `## 当前命中`, `## 命中上下文`, and the current hit text.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 active replacement shortcut iteration:

- Rechecked the static replacement path for active hits. The toolbar already showed `应用替换/应用删除` when the current issue had a deterministic replacement, but keyboard users still had to click the button.
- Added `Ctrl/Cmd+Alt+R` for the current active replacement.
- The shortcut is gated by `activeReplacement`, so candidate/manual rules do not trigger it.
- The shortcut reuses `acceptReplacement()`, so selection cleanup, parent replacement handling, diff sidecar creation, comment range transforms, undo notification, and post-replacement rescan behavior stay identical to the toolbar/inline menu paths.
- Updated zh-CN/en-US active replacement button title to expose the shortcut.

2026-07-03 active replacement shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `测试！！！` -> activate a visible auto-replace issue row -> press `Ctrl+Alt+R` -> verify source text no longer contains `！！！` and contains the normalized replacement.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 issue navigation shortcut iteration:

- Rechecked the active-hit review loop after adding active-hit actions. The toolbar already had previous/next hit buttons, but keyboard users still had to click those buttons to move through the report.
- Added issue navigation shortcuts in `TextPanel`:
  - `Ctrl/Cmd+Alt+ArrowDown` -> next visible hit;
  - `Ctrl/Cmd+Alt+ArrowUp` -> previous visible hit.
- The shortcuts emit the same `navigate-issue` event as the toolbar buttons, so parent-level active issue state, source scrolling, right-list active row, and active-hit toolbar actions stay on the existing path.
- The shortcut skips review comment/link inputs, but remains available while focus is in the main source editor.
- Updated zh-CN/en-US previous/next hit button titles to expose the shortcuts.

2026-07-03 issue navigation shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit two-line text with two visible hits -> press `Ctrl+Alt+ArrowDown` twice and verify the hit label advances `1/2` then `2/2` -> press `Ctrl+Alt+ArrowUp` and verify it returns to `1/2`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 selection prompt shortcut priority iteration:

- Rechecked the external-LLM shortcut after adding active-hit prompt copy. `Ctrl/Cmd+Alt+L` copied the active-hit prompt when an active issue existed, even if the user had a precise source/preview selection.
- Updated the shortcut priority:
  - if a mappable source/preview selection exists, `Ctrl/Cmd+Alt+L` copies the selection optimization prompt;
  - otherwise, if an active issue exists, it copies the current-hit prompt.
- The selection path reuses `buildSelectionOptimizationPrompt()`, so issue overlap, replacement hints, surrounding context, related user comments, clipboard writing, and notifications stay aligned with the inline menu button.
- Updated zh-CN/en-US selection prompt tooltips to expose the shortcut.

2026-07-03 selection prompt shortcut priority results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `alpha selection` -> select the source text -> press `Ctrl+Alt+L` -> read clipboard -> verify it contains `# 中文片段优化任务`, `## 选中文本`, and `alpha selection`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 selection clipboard replace shortcut iteration:

- Rechecked the external-LLM roundtrip after selection prompt copy. Users could copy a selection prompt with the keyboard, but replacing that same selection from the LLM-returned clipboard still required clicking the inline menu paste button.
- Added `Ctrl/Cmd+Alt+V` for replacing the current mapped source/preview selection from the clipboard.
- The shortcut reads the clipboard and reuses `replaceSelectionWithText()`, so source/preview selection cleanup, parent `replace-selection`, sidecar diff creation, comment range transforms, undo notification, and caret restoration stay aligned with the inline menu button.
- The shortcut is ignored inside comment/link inputs and only fires when a mappable selection exists.
- Updated zh-CN/en-US clipboard replacement tooltips to expose the shortcut.

2026-07-03 selection clipboard replace shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `alpha replace` -> write `beta replacement` to the clipboard -> source-select `alpha replace` -> press `Ctrl+Alt+V` -> verify the source text contains `beta replacement` and no longer contains `alpha replace`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 editor mode toggle shortcut iteration:

- Rechecked the source/preview loop. The segmented control already switched modes and persisted through `reviewEditorMode`, but keyboard users still had to click it.
- Added `Ctrl/Cmd+Alt+T` to toggle between source and preview modes.
- The shortcut calls the existing `updateMode()` path, so source selection cleanup, pending source offset handling, persisted mode state, and preview locate behavior remain unchanged.
- The shortcut is ignored inside comment/link inputs.
- Added mode button titles so the segmented control exposes the shortcut.

2026-07-03 editor mode toggle shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit Markdown text -> verify source editor is visible -> press `Ctrl+Alt+T` and verify preview is visible -> press `Ctrl+Alt+T` again and verify source editor returns.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 workbench resize keyboard iteration:

- Rechecked the left ReviewEditor / right report split after adding pointer drag resizing. The separator had drag behavior and ARIA values, but it was not keyboard focusable.
- Added keyboard resize support to the existing separator:
  - `ArrowLeft` increases the right report pane width;
  - `ArrowRight` decreases the right report pane width;
  - `Shift+ArrowLeft/Right` uses a larger step;
  - `Home` snaps to the minimum report width;
  - `End` snaps to the maximum report width.
- The keyboard path reuses the same persisted `workbenchReportWidth`, viewport-based min/max widths, and `clampResizablePanelSize()` rule as the pointer drag path.
- Added a focused separator outline so keyboard users can see the active resize target without adding visible instruction copy.

2026-07-03 workbench resize keyboard results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text -> focus the separator -> press `Home` and verify right report width clamps to 380px -> press `ArrowLeft` and verify width increases -> press `ArrowRight` and verify it returns -> press `End` and verify width clamps to 960px at a 1440px viewport.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 inline external-LLM prompt entry iteration:

- Rechecked the temporary external-LLM workflow against NeuroBook's `TipTapMarkdownEditor` selection menu. NeuroBook promotes the AI/reference action as a visible primary action; llmlint had the equivalent "copy selection optimization prompt" path, but it was only a wand icon.
- Promoted source and preview selection menus' prompt-copy action to a primary text button labeled `复制指令` / `Copy prompt`.
- The action still reuses the existing `copyOptimizationPrompt()` path, so prompt construction, selected text/context/comment inclusion, clipboard writes, success icon swap, and `Ctrl/Cmd+Alt+L` shortcut behavior remain unchanged.
- Updated the tooltip copy to make the external-LLM handoff explicit: selection + surrounding context + related comments.

2026-07-03 inline external-LLM prompt entry results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text -> source-select `alpha source selection` -> click inline `复制指令` -> verify clipboard contains `# 中文片段优化任务` and the selected text -> switch preview -> drag-select `beta preview selection` -> click preview inline `复制指令` -> verify clipboard contains `# 中文片段优化任务` and the selected text.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 comment rail resize iteration:

- Rechecked the ReviewEditor comment rail after the workbench-level report pane resize landed. The rail still used a fixed desktop width, which made long quotes and multi-line review comments cramped.
- Added a desktop-only resize separator between the editor surface and comment rail.
- The separator reuses the shared `useResizablePanel()` composable, the same pointer handling pattern as the workbench report pane, and stores width in `reviewCommentPanelWidth` inside web settings.
- Mobile remains the existing stacked layout; comment data, active comment state, unresolved-first queue, editing, resolve/reopen, delete, copy context, and source/preview mark mapping are unchanged.
- Added zh-CN/en-US title text for the resize handle.

2026-07-03 comment rail resize results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text -> source-select `alpha comment target` -> add a sidecar comment -> verify the comment rail appears -> drag the new rail separator left -> verify the rail width grows and `llmlint.webSettings.v1.reviewCommentPanelWidth` is persisted.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 comment rail keyboard resize iteration:

- Rechecked the comment rail resize separator after pointer drag support landed. It exposed ARIA value attributes but was not keyboard focusable yet.
- Added keyboard support to the same separator:
  - `ArrowLeft` increases the comment rail width;
  - `ArrowRight` decreases the comment rail width;
  - `Shift+ArrowLeft/Right` uses a larger step;
  - `Home` snaps to the minimum comment rail width;
  - `End` snaps to the maximum comment rail width.
- The keyboard path reuses `reviewCommentPanelWidth`, the same viewport min/max computed values, and `clampResizablePanelSize()` as the pointer path.
- Added focus-visible styling for the separator without adding visible instructional copy.

2026-07-03 comment rail keyboard resize results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text -> add a source sidecar comment -> focus the comment rail separator -> press `Home` and verify width clamps to 280px -> press `ArrowLeft` and verify width increases -> press `ArrowRight` and verify it returns -> press `End` and verify width clamps to 560px at a 1440px viewport, with `llmlint.webSettings.v1.reviewCommentPanelWidth` persisted.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 active comment context shortcut iteration:

- Rechecked the comment review keyboard loop. Users could move through comments, complete/reopen, and edit the active comment from the keyboard, but copying the active comment context for an external LLM still required clicking the card action.
- Added `Ctrl/Cmd+Alt+C` for the active comment.
- The shortcut reuses `copyCommentContext()`, so the copied payload still contains quote, comment body, and resolved/open status, and notification behavior stays aligned with the card button.
- The shortcut is ignored inside review text inputs, and the card copy button title now exposes the same shortcut.

2026-07-03 active comment context shortcut results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text -> add two source sidecar comments -> activate the first comment card -> press `Ctrl+Alt+C` -> verify clipboard contains the first comment's quote/body/status and does not contain the second comment body.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 active diff context copy iteration:

- Rechecked the edit-marker review loop. Users could navigate edits, select one, and clear one marker, but could not copy the current edit context for an external LLM or manual reviewer.
- Added a copy button to the diff toolbar and `Ctrl/Cmd+Alt+Shift+C` for the active diff.
- The copied payload includes edit title, source (`static` vs external LLM/clipboard), deleted text, and inserted text. Invisible zero-width characters are rendered as readable labels.
- The shortcut is ignored inside review text inputs and only fires when an active diff exists.

2026-07-03 active diff context copy results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `测试！！！` -> apply the deterministic replacement -> activate the diff with `Ctrl+Alt+N` -> press `Ctrl+Alt+Shift+C` -> verify clipboard contains edit title, source `静态规则`, deleted text, and inserted text.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 toolbar icon aria-label iteration:

- Rechecked ReviewEditor toolbar and comment rail controls after adding more icon-only actions. Several buttons relied on `title` only.
- Added explicit `aria-label` bindings to icon-only diff controls, comment rail toggle, active-hit prompt button, comment rail resize separator, comment rail previous/next, clear-comments, and collapse buttons.
- The labels reuse existing i18n/title computed values and do not change visual layout, shortcut handling, review data, or clipboard behavior.

2026-07-03 toolbar icon aria-label results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text -> add a source sidecar comment -> apply deterministic replacement -> activate the diff -> verify diff previous/next/clear/copy buttons, comment rail resize separator, and comment rail previous/next buttons expose explicit `aria-label` values.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 selection menu aria-label iteration:

- Rechecked the source textarea menu and preview TipTap BubbleMenu after expanding TipTap-like formatting actions. The visual buttons had titles, but pure icon controls still needed explicit accessible names.
- Added `aria-label` bindings to source and preview selection menu icon buttons for copy, clipboard replacement, block style, inline formatting, link, quote/list/code-block controls, list indent/outdent, locate-source, and clear-formatting.
- The labels reuse the same i18n strings as titles, including shortcut hints, so visual copy, hover tooltips, keyboard documentation, and accessibility names stay aligned.

2026-07-03 selection menu aria-label results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text -> select text in source textarea -> verify source inline menu icon buttons expose explicit `aria-label` values -> switch to preview -> select rendered text -> verify preview BubbleMenu icon buttons expose explicit `aria-label` values.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 source diff activation iteration:

- Rechecked the annotated diff review loop in source mode. Preview diff marks were clickable, and toolbar shortcuts could navigate diffs, but clicking/caret-ing into a source-mode edit mark did not activate the corresponding diff.
- Added source caret hit-testing for `ReviewTextDiff`: inserted/replaced ranges activate when the caret lands inside the new text range; pure deletion markers activate on the exact deletion offset.
- This keeps source and preview review behavior aligned: once a source edit mark is active, the existing copy/clear-current-diff toolbar actions and keyboard shortcuts become available without extra navigation.

2026-07-03 source diff activation results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text with `测试！！！` -> apply the right-side deterministic replacement -> verify diff toolbar copy action is disabled before selecting an edit -> place source caret on the modified punctuation -> verify current diff becomes active and the copy-current-diff action becomes enabled.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 comment rail action aria-label iteration:

- Rechecked the comment rail card actions after toolbar and selection menu accessibility cleanup. The card locate button still relied on title plus mixed quote/status text, and the delete action used a generic visible label.
- Added explicit `aria-label`/`title` bindings for locate-comment, copy-context, complete/reopen, edit, and delete-comment actions. Added a dedicated `review.deleteCommentTitle` i18n key so delete buttons are named as comment deletion rather than a generic delete command.
- The visible layout and existing copy/resolve/edit/delete behavior are unchanged.

2026-07-03 comment rail action aria-label results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text -> select source text -> add a sidecar comment -> verify the comment card exposes accessible names for locate, copy context, complete, edit, and delete -> mark complete -> verify the resolve action name changes to reopen.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 issue card action labels iteration:

- Rechecked the right-side issue list as part of the review loop. Rule detail, locate-hit, and apply-replacement buttons were visually clear, but their programmatic names were generic (`Details`, `Locate`, `Replace/Delete`) across many repeated issue rows.
- Added issue-specific `aria-label`/`title` values for rule details, locating a hit in the text, and applying a deterministic replacement/delete. Labels include the rule title or compact matched text.
- This keeps the right-side list aligned with the editor toolbar/rail accessibility cleanup and makes browser/keyboard review paths less ambiguous.

2026-07-03 issue card action labels results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text with `测试！！！` and `他说……...` -> verify IssueCard buttons expose names like `查看规则详情：...`, `定位到正文：...`, `替换此处命中：...` / `删除此处命中：...` -> click a locate button and verify the editor remains reachable.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 toolbar action labels iteration:

- Rechecked the high-frequency toolbar path after IssueCard cleanup. TextPanel previous/next issue buttons and ReviewEditor current-hit/diff actions still had some title-only or generic programmatic names.
- Added explicit `aria-label` bindings for previous/next hit navigation, clear-all-diffs, current-hit comment, and active replacement actions. The labels reuse existing shortcut/context titles and do not change visual layout.
- This improves the keyboard/browser-verifiable path from navigating hits to applying a replacement and clearing diff markers.

2026-07-03 toolbar action labels results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text with replaceable hits -> verify previous/next issue navigation buttons expose shortcut labels -> verify current-hit comment and active replacement actions expose contextual names -> apply one replacement -> verify clear-all-diffs exposes `清除当前文本的修改标注`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 double-backtick clear-formatting iteration:

- Rechecked TipTap-like inline Markdown formatting. Inline code correctly switches to double backticks when the selected text contains a backtick, but clear-formatting only stripped single-backtick code spans.
- Updated inline Markdown clearing to strip double-backtick code spans before single-backtick spans, and taught wrapper-range clearing to recognize double-backtick wrappers.
- This makes the inline menu `code` and `clear formatting` actions symmetric for selections like `foo\`bar`.

2026-07-03 double-backtick clear-formatting results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit text containing `foo\`bar` -> select it in source mode -> click inline code -> verify it becomes ``foo\`bar`` with double backticks -> select the formatted span -> click clear Markdown formatting -> verify text returns to `foo\`bar`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 inline inner-toggle unwrap iteration:

- Rechecked inline Markdown toggle behavior against TipTap expectations. Selecting the inner text of an already formatted span, such as `**粗体**` -> `粗体`, should remove that format when the same button is clicked again.
- Updated inline formatting to detect active wrappers immediately outside the selected core text before adding a new wrapper. Bold now unwraps `**...**` / `__...__`, italic unwraps `*...*` / `_..._`, strike unwraps `~~...~~`, and code unwraps both single- and double-backtick code spans.
- Added standalone-marker checks so italic/code single-character toggles do not accidentally treat the inner half of `**...**` or ``...`` as a single-character wrapper.

2026-07-03 inline inner-toggle unwrap results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `**粗体** 和 \`code\` 以及 \`\`foo\`bar\`\`` -> select inner `粗体` and click bold -> verify wrapper removed -> select inner `code` and click code -> verify single-backtick wrapper removed -> select inner `foo\`bar` and click code -> verify double-backtick wrapper removed without nesting.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 link label escaping iteration:

- Rechecked inline link editing. Updating an existing link reused the raw Markdown label, so labels containing escaped brackets or slashes could be escaped again. Removing a link also left Markdown escape slashes in the plain text.
- Added link-label unescaping for existing links before updating hrefs, then re-escape only for the new Markdown link label. Link removal now returns the unescaped label text.
- This keeps source-mode link edit/remove behavior closer to what users see in rendered Markdown.

2026-07-03 link label escaping results:

- Browser smoke on `http://localhost:3003/`: pass. Path: submit `[a\\]b](https://old.example/path)` -> select full link -> update href -> verify label remains `[a\\]b]` instead of double-escaping -> select updated link -> remove link -> verify plain text becomes `a]b`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 link href prefill iteration:

- Rechecked source/preview inline link creation after fixing existing-link escaping. Creating a link from selected URL/email text still opened the href field with the generic `https://`, forcing users to copy or retype the text they had already selected.
- Added shared selection-state logic so an existing Markdown link href still wins, while plain selected `http://` / `https://` / `mailto:` / `tel:` values prefill directly; `www.example.com` is normalized to `https://www.example.com`, and `editor@example.com` is normalized to `mailto:editor@example.com`.
- Both the source textarea menu and preview BubbleMenu now use the same helper, keeping the TipTap-like link flow consistent across modes without changing the single Markdown source-of-truth model.

2026-07-03 link href prefill results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit text containing `https://example.com/path` and `editor@example.com` -> select the URL in source mode -> open link menu -> verify href prefilled as `https://example.com/path` -> apply link -> verify Markdown becomes `[https://example.com/path](https://example.com/path)` -> select email -> verify href prefilled as `mailto:editor@example.com`.
- `bun test tests/llmlint.test.ts`: pass. Added regression coverage for selected URL/email/`www.` href inference and existing Markdown link href priority.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 existing empty link href iteration:

- Tightened the same link prefill helper after noticing the implementation treated existing empty hrefs as missing hrefs. This contradicted the intended rule that an existing Markdown link destination wins over URL/email inference.
- Changed the existing-link check from truthy to `!== null`, so `[https://example.com]()` opens the link editor with an empty href instead of inferring `https://example.com` from the label text.
- Added regression coverage for full-link and label-only selections on an empty destination.

2026-07-03 existing empty link href results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `参考 [https://example.com]()` -> select the label in source mode -> open link menu -> verify the href input remains empty.
- `bun test tests/llmlint.test.ts`: pass, 58 tests / 183 assertions.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 unlink preserves block structure iteration:

- Rechecked the link removal path from the source/preview inline menu. The `Remove link` button reused the broad `clear-formatting` command, so unlinking a link inside a heading/list/quote could also clear the surrounding block Markdown.
- Added a dedicated `remove-link` formatting command for both source and preview selection menus. The command only unwraps the detected Markdown link range through `markdownLinkRangeAtSelection` and preserves the link label text; block-level structure remains untouched.
- Kept the general eraser button mapped to `clear-formatting`, so explicit full formatting removal still behaves as before.

2026-07-03 unlink preserves block structure results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `# [标题](https://example.com)` -> select `标题` in source mode -> open link menu -> click `移除链接` -> verify the source becomes `# 标题`, not plain `标题`.
- `bun test tests/llmlint.test.ts`: pass, 58 tests / 183 assertions.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 shared format command contract iteration:

- Rechecked the source selection menu, preview BubbleMenu, and ReviewEditor command handler after adding `remove-link`. The supported Markdown command union was duplicated in three files, which made future TipTap-like command additions easy to drift.
- Added shared `web/app/utils/markdown-format-command.ts` and imported `MarkdownFormatCommand` from the source menu, preview menu, and editor implementation.
- Re-ran the unlink path in preview mode so the BubbleMenu side is verified, not only the source textarea menu.

2026-07-03 shared format command contract results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `# [标题](https://example.com)` -> switch to preview -> select rendered heading link text -> open BubbleMenu link form -> click `移除链接` -> switch back to source -> verify the source becomes `# 标题`.
- `bun test tests/llmlint.test.ts`: pass, 58 tests / 183 assertions.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 link href punctuation cleanup iteration:

- Rechecked the link creation flow for sentence-level selections. If the user selected `https://example.com/path。` with the surrounding Chinese period, the href field also received `。`, which is almost never the intended link destination.
- Added link-candidate normalization for selected URL/email/`www.` text before href inference. It strips trailing sentence punctuation and unmatched closing brackets while preserving balanced URL parentheses such as `https://example.com/a(b)`.
- The normalization only affects the href suggestion; it does not silently alter the selected source text.

2026-07-03 link href punctuation cleanup results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `参考 https://example.com/path。` -> select the URL plus `。` in source mode -> open link menu -> verify href input is `https://example.com/path`.
- `bun test tests/llmlint.test.ts`: pass, 59 tests / 187 assertions. Added regression coverage for URL/email sentence punctuation and unmatched closing bracket cleanup.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 link label punctuation range iteration:

- Rechecked the same sentence-level URL path through the actual `Apply link` action. The href field was clean, but applying the link still wrapped the selected punctuation into the Markdown label, producing `[https://example.com/path。](https://example.com/path)`.
- Reused the shared URL/email/`www.` link-candidate helper in `formatMarkdownLink()`. New links created from detected URL-like selections now move trailing sentence punctuation and unmatched closing brackets outside the Markdown link label, while ordinary phrase selections still keep their punctuation inside the label.
- This keeps href inference and Markdown replacement range aligned without changing existing-link update semantics.

2026-07-03 link label punctuation range results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `参考 https://example.com/path。` -> select the URL plus `。` in source mode -> open link menu -> apply link -> verify the source becomes `参考 [https://example.com/path](https://example.com/path)。`.
- `bun test tests/llmlint.test.ts`: pass, 59 tests / 187 assertions.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 preview link punctuation apply verification:

- Re-ran the URL-like selection cleanup through preview BubbleMenu, not only the source textarea menu. This verifies the TipTap-rendered selection mapping, href prefill, link application, and source writeback stay aligned.
- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `参考 https://example.com/path。` -> switch to preview -> select rendered `https://example.com/path。` -> open BubbleMenu link form -> verify href input is `https://example.com/path` -> apply link -> switch back to source -> verify the source becomes `参考 [https://example.com/path](https://example.com/path)。`.
- `bun test tests/llmlint.test.ts`: pass, 59 tests / 187 assertions.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 root typecheck alias hardening:

- Rechecked the validation chain after the ReviewEditor pure helpers started being imported by root tests. `bun run typecheck` at repo root still failed because root `tsconfig.json` did not know Nuxt's `llmlint` alias, so imported web editor utilities could not resolve `llmlint/fix` and `llmlint/types`.
- Added root TypeScript `baseUrl`/`paths` for `llmlint/* -> skill/src/*` and `evals/* -> evals/lib/*`, matching the web Nuxt aliases used by the editor and report code.
- This restores a useful long-term guardrail: web editor pure helpers referenced from root tests are now typechecked instead of being blocked by alias resolution.

2026-07-03 root typecheck alias hardening results:

- `bun run typecheck`: pass.
- `bun test tests/llmlint.test.ts`: pass, 59 tests / 187 assertions.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 existing link title edit iteration:

- Rechecked existing Markdown links with optional titles, such as `[example](https://old.example/path "旧标题")`. The link parser treated the entire parenthesized content as destination, so the inline menu href field could be polluted by the title.
- Updated Markdown link destination parsing to split common title forms: double-quoted, single-quoted, and parenthesized titles. Angle destinations with titles, such as `<https://old.example/a(b)> '旧标题'`, are also handled.
- Updating an existing link href now preserves the original raw title text, while the href input only shows the destination.

2026-07-03 existing link title edit results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `[example](https://old.example/path "旧标题")` -> select `example` in source mode -> open link menu -> verify href input is `https://old.example/path` -> update href -> verify source becomes `[example](https://new.example/path "旧标题")`.
- `bun test tests/llmlint.test.ts`: pass, 60 tests / 189 assertions. Added regression coverage for quoted title and angle destination title parsing.
- `bun run typecheck`: pass.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 repair mode baseline iteration:

- The workbench now captures the submitted text as an original baseline and treats the editable left document as the repair draft.
- `TextPanel` shows a compact repair status strip with original length, net draft delta, unchanged/changed state, and a reset-to-original action with undo.
- Static replacements remain source-first and reuse the existing sidecar diff/undo/comment-transform path. Web single replacements can explicitly allow `candidate` replace actions for user-confirmed static fixes, while CLI `fix` still defaults to `fixability:auto` only.
- Source mode receives repair-baseline diff marks derived from the original baseline, so the repair draft can show paper-like insert/delete marks without changing preview into an editable surface.
- Deletion visuals were adjusted after review: delete candidates are drawn directly as red strikethrough on the source text instead of showing `-> 删除` corner badges, and applied deletion diff text is rendered on the text baseline instead of as a top-right marker.

2026-07-03 repair mode baseline results:

- `bun test tests/llmlint.test.ts`: pass, 61 tests / 191 assertions.
- `bun run typecheck`: pass.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `测试！！！ / 测\u200b试 / 他说……...` -> enter workbench with original baseline -> apply mechanical fixes -> verify repair draft text changes, source delete/insert marks render, reset-to-original restores the submitted text, and delete candidates/diffs use direct strikethrough rather than corner badges.

2026-07-03 repair diff layering iteration:

- Source mode now layers concrete edit marks above baseline repair marks. Static/LLM sidecar diffs remain the precise review queue; repair-baseline diffs only fill regions that do not overlap an existing concrete diff.
- This prevents a mechanical fix from rendering duplicate deletion marks from both the applied static diff and the full repair-draft-vs-original diff, while ordinary manual edits still get a baseline repair mark.

2026-07-03 repair diff layering results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: apply the same three mechanical fixes -> verify exactly three source deletion markers, not duplicated baseline markers -> reset to original -> manually append a sentence -> verify baseline repair marks still render for manual edits.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 61 tests / 191 assertions.
- `bun run typecheck`: pass.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 source replacement semantic flag iteration:

- Source replacement ranges now carry a structured `isDelete` flag from `ReviewEditor` into `HighlightedTextarea`.
- The source backdrop no longer infers delete styling by comparing the visible replacement label with the localized `review.delete` text. This keeps deletion semantics independent from i18n copy and prevents future wording changes from breaking the draft-paper strikethrough display.

2026-07-03 source replacement semantic flag results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit text containing a zero-width delete candidate -> verify source mode renders direct strikethrough and suppresses the `-> 删除` corner badge.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 61 tests / 191 assertions.
- `bun run typecheck`: pass.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 preview delete replacement visual iteration:

- Preview mode had kept the generic replaceable issue decoration, so delete candidates still rendered as `-> 删除` after the matched text.
- Delete candidates now receive `llmlint-issue-delete-replacement` in the TipTap preview decoration. They render as direct red strikethrough text and suppress the replacement arrow, matching source mode's draft-paper repair mark. Non-delete replacements still keep the inline `-> replacement` hint.

2026-07-03 preview delete replacement visual results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit text with both `测试！！！` and `测\u200b试` -> verify source delete candidate uses strikethrough -> switch to preview -> verify preview delete candidate uses strikethrough with no `-> 删除` badge -> verify preview replacement candidate still exposes an arrow hint.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 61 tests / 191 assertions.
- `bun run typecheck`: pass.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 repair action count iteration:

- The ReviewEditor toolbar repair chip now separates deterministic replacement and deletion counts (`替换 N / 删除 M`) instead of showing one generic replaceable total.
- This keeps the repair-mode status closer to a draft-paper editing workflow: users can see whether the remaining static work is mostly deletions or substitutions before applying rules.

2026-07-03 repair action count results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit text with one punctuation replacement and one zero-width deletion -> verify toolbar shows `替换 1 / 删除 1` and the deletion candidate remains direct strikethrough.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 61 tests / 191 assertions.
- `bun run typecheck`: pass.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 candidate apply affordance iteration:

- IssueCard apply buttons now distinguish `fixability:candidate` from `fixability:auto`.
- Auto replace/delete actions keep the existing green `替换` / `删除` labels. Candidate replace/delete actions render as amber `候选替换` / `候选删除`, and the same wording is used in `aria-label` and `title`.
- This keeps Web's explicit candidate-application ability visible as a human-confirmed action, not an automatic mechanical fix.

2026-07-03 candidate apply affordance results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `测试！！！ / 其实很好。` -> verify default Agent view shows `候选删除` for `其实` -> reveal all hits -> verify punctuation auto issue still shows plain `替换` -> click candidate delete and verify the repair draft removes `其实`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 61 tests / 191 assertions.
- `bun run typecheck`: pass.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 delete visual polish iteration:

- Source textarea menu, preview BubbleMenu, and the active-hit toolbar now carry the same candidate affordance as the right report list: candidate static fixes render as amber `候选替换` / `候选删除`, while auto fixes keep the existing green action language.
- Applied source deletion diffs no longer look like small floating badges. The deleted text remains a non-layout-shifting overlay so textarea highlights stay aligned, but the overlay uses the editor's baseline font size, transparent background, zero radius, and direct red strikethrough.
- Delete candidates in source and preview still suppress the replacement `::after` arrow entirely; replacement candidates keep the arrow hint.

2026-07-03 delete visual polish results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `测\u200b试 / 测试！！！ / 其实很好。` -> verify source delete candidate has `::after: none` and `line-through` -> switch preview and verify the same -> click `候选删除` -> verify applied source diff has deleted text content, transparent background, `0px` border radius, and `line-through`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 61 tests / 191 assertions.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 source menu disabled affordance iteration:

- Rechecked source textarea selection menu against the preview BubbleMenu and NeuroBook selection menu behavior. Preview already had a clear disabled state for unavailable formatting actions, but source mode disabled list indent/outdent controls relied mostly on the browser default.
- Added the same explicit disabled visual contract to source menu buttons: `cursor: default`, reduced opacity, and no hover highlight. This keeps source/preview inline menus visually consistent when a paragraph selection cannot use list indentation.

2026-07-03 source menu disabled affordance results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit a normal paragraph -> select source text -> verify source inline menu opens -> verify the first disabled list control has `aria-label/title = 先选择列表项`, `disabled = true`, `opacity = 0.45`, and `cursor = default`.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 61 tests / 191 assertions.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 shared issue UI labels iteration:

- Rechecked the source textarea menu, preview BubbleMenu, and active-hit toolbar after the candidate/delete affordance work. They had repeated local implementations for level labels, issue action labels, replacement titles, and replacement button text.
- Added `web/app/utils/review-issue-ui.ts` as a tiny shared UI helper for those labels. It keeps delete title wording, candidate action wording, and toolbar apply wording in one place without changing scanner/fix behavior.
- Updated `ReviewSourceSelectionMenu.vue`, `ReviewSelectionMenu.vue`, and `ReviewEditor.vue` to use the shared helper.
- Added a pure regression test so future copy changes cannot accidentally turn `候选删除` into an empty arrow title or `候选应用删除` again.

2026-07-03 shared issue UI labels results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `其实很好。` -> activate the right-side hit -> verify active toolbar shows `应用候选删除` -> source-select `其实` and verify source inline menu shows `候选删除` with title `候选 · ... 删除「其实」` -> switch preview, select the rendered hit, and verify the BubbleMenu shows the same candidate delete wording/title.
- `bun test tests/llmlint.test.ts`: pass, 62 tests / 196 assertions.
- `bun run typecheck`: pass.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 inline menu local focus refs iteration:

- Rechecked source textarea selection menu and preview BubbleMenu form opening behavior. Both menus focused their comment/link form controls through global `document.querySelector(...)` selectors.
- Replaced those global lookups with component-local template refs in `ReviewSourceSelectionMenu.vue` and `ReviewSelectionMenu.vue`. Existing `data-review-*` attributes remain for smoke tests and host-level keyboard guards, but focus ownership now stays inside each menu instance.
- This brings the inline menus closer to normal component boundaries used by TipTap-style editors and avoids future wrong-focus bugs if source and preview surfaces are mounted at the same time.

2026-07-03 inline menu local focus refs results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `普通段落 [链接](https://old.example/path)。` -> source-select text and open comment form, verify source comment textarea receives focus -> source-select link text and open link form, verify href is `https://old.example/path` and fully selected -> switch preview, select rendered link, open link form, verify the same focused/full-selection href state.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 62 tests / 196 assertions.
- `bun run typecheck`: pass.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 source menu mousedown preservation iteration:

- Rechecked source textarea selection menu against the preview BubbleMenu. Preview buttons already use `@mousedown.prevent` so the editor selection is preserved while clicking menu controls; source menu only stopped propagation at the container level, so toolbar buttons could take focus before the command ran.
- Added `@mousedown.prevent` to the source menu toolbar and block-style option group, while leaving comment/link form areas untouched. This preserves the source textarea focus/selection during toolbar interaction without breaking form inputs.

2026-07-03 source menu mousedown preservation results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `普通段落 [链接](https://old.example/path)。` -> source-select `普通段落` -> dispatch mousedown on the bold toolbar button and verify the body textarea remains active with selection `0..4` -> source-select the Markdown link label, open the link form, and verify href remains focused/full-selected as before.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 62 tests / 196 assertions.
- `bun run typecheck`: pass.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 inline menu accessible names iteration:

- Rechecked source textarea menu and preview BubbleMenu controls after the selection/focus fixes. Most pure icon buttons already had explicit `aria-label`, but several visible-text buttons still only exposed their short text while the richer context lived only in `title`.
- Added explicit `aria-label` to comment, external-LLM prompt, and replacement action buttons in both source and preview menus. Replacement buttons now expose the same rule-aware title as their accessible name, e.g. `候选 · 无意义填充词: 删除「其实」`.
- Added title/aria labels to block-style menu items so keyboard and assistive-tech users get the same item names across source and preview menus.

2026-07-03 inline menu accessible names results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `其实很好。` -> source-select `其实` -> verify source inline menu comment, prompt, candidate delete, and block-style item all have non-empty aria/title with candidate delete carrying rule context -> switch preview, select rendered hit, and verify the same controls expose matching aria/title.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 62 tests / 196 assertions.
- `bun run typecheck`: pass.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 block style menu semantics iteration:

- Rechecked the source textarea menu and preview BubbleMenu block-style controls after the accessible-name pass. The trigger buttons behaved like dropdowns visually, but did not expose dropdown state or menu roles.
- Added `aria-haspopup="menu"`, `aria-controls`, and `aria-expanded` to the block-style trigger in both source and preview menus.
- Added stable menu ids, `role="menu"`, menu labels, and `role="menuitem"` on block-style options. This keeps the compact editor toolbar closer to a real TipTap-style menu surface without changing formatting behavior.

2026-07-03 block style menu semantics results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit a normal paragraph -> source-select text -> verify source block-style trigger starts with `aria-haspopup=menu` and `aria-expanded=false`, opens to `aria-expanded=true`, controls a `role=menu`, and its first option is `role=menuitem` -> repeat the same verification in preview BubbleMenu.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `bun test tests/llmlint.test.ts`: pass, 62 tests / 196 assertions.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- `bun run typecheck`: failed in unrelated eval code (`evals/generator/model-client.ts`: `Type 'string' is not assignable to type 'CallResult'`, and a `piAI` call argument count mismatch). Not changed in this iteration.

2026-07-03 block style menu keyboard iteration:

- Rechecked the source textarea menu and preview BubbleMenu block-style dropdown after adding ARIA menu semantics. The controls exposed menu roles but still behaved like mouse-only popovers.
- Added `web/app/composables/useReviewBlockStyleMenu.ts` to share the block-style keyboard model between source and preview menus instead of duplicating key handling in each component.
- The trigger now opens the menu with `Enter`, `Space`, `ArrowDown`, or `ArrowUp`. The menu supports `ArrowUp/Down/Left/Right`, `Home`, `End`, `Enter`, `Space`, `Escape`, and `Tab` close behavior. `Escape` returns focus to the block-style trigger.
- Menu items now have stable ids, roving `tabindex`, and `aria-activedescendant`, keeping the compact Markdown toolbar closer to a real TipTap-style dropdown without changing formatting semantics.

2026-07-03 block style menu keyboard results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `普通段落\n第二行` -> source-select text -> focus block-style trigger -> open with `ArrowDown` -> `End` focuses the code block item -> `Escape` closes and returns focus -> reopen and apply heading via keyboard -> switch preview -> select rendered text -> repeat open/Home/Escape focus-return path in the BubbleMenu.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 new comment activation iteration:

- Rechecked the comment creation path after the rail navigation and focus improvements. Clicking an existing comment already used `activateComment()` to open the rail, scroll the text mark, and scroll the rail card, but newly saved comments only set `activeCommentId` directly.
- Changed the new-comment watcher to route the latest added comment through `activateComment()` as well. Source inline comments, preview BubbleMenu comments, and active-hit comments now share the same activation path after save.
- This keeps the comment rail feeling like one continuous review surface: after saving, the newly created card is visible and the body mark is active without the user hunting for it.

2026-07-03 new comment activation results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `第一段普通文本。\n第二段预览文本。` -> source-select text -> save a source inline comment -> verify the new rail card is visible and the source mark is active -> switch preview -> save a preview BubbleMenu comment -> verify the second rail card is visible and the preview mark is active.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.

2026-07-03 comment click activation path iteration:

- Rechecked existing-comment activation after the new-comment activation fix. Preview comment marks already routed through `activateComment()`, while source mode still used a local active-id + rail-scroll path in `handleSourceCaretClick()`.
- Source comment clicks now route through `activateComment(comment.id)` as well, so source, preview, rail navigation, and newly saved comments share one activation path.
- `activateComment()` now clears any current source/preview selection state first. This prevents an inline selection menu from lingering when the user switches from text formatting/comment creation into comment review.

2026-07-03 comment click activation path results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Browser smoke: attempted. A focused Playwright source-comment click smoke could open the source selection menu, but automating the floating comment form submission proved unstable (`locator.click`, `dispatchEvent("click")`, and synthetic `submit` did not reliably complete in the smoke). No passing browser result is claimed for this iteration; rerun a focused source-comment click smoke with a more robust form-submit driver.

2026-07-03 comment form smokeability iteration:

- Rechecked the failed source-comment click smoke. The source and preview comment inputs already had stable `data-*` hooks, but their forms and submit buttons only exposed style classes / visible copy.
- Added stable hooks to both comment forms and submit buttons: `data-review-source-comment-form`, `data-review-source-comment-submit`, `data-review-comment-form`, and `data-review-comment-submit`.
- Split new-comment activation out into `activateNewComment()`. Existing-comment activation still clears the inline selection menu, while saving a brand-new comment now sets the active comment immediately and defers source/preview scrolling until after the floating form submit has settled.

2026-07-03 comment form smokeability results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit text -> source-select text -> open source comment form -> fill comment -> save via Ctrl+Enter -> verify the comment rail card appears and the source comment mark is active. The smoke printed `source comment submit smoke passed`; the Playwright browser process needed a follow-up `taskkill` because `browser.close()` did not return promptly in this local run.

2026-07-03 comment form accessibility iteration:

- Rechecked source textarea menu, preview BubbleMenu, and active-hit comment forms after the submit smoke fix. The form controls were stable enough for smoke, but the textarea/input accessible names still depended on placeholder text in several paths.
- Added explicit `aria-label` to source/preview inline comment textareas, source/preview link URL inputs, and the active-hit comment textarea.
- Added stable `data-review-active-issue-comment-form` and `data-review-active-issue-comment-submit` hooks to the active-hit comment form so this path has the same smokeability contract as source/preview inline comment forms.

2026-07-03 comment form accessibility results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit text -> open source inline comment form -> verify `aria-label="批注"` and submit hook -> activate a right-side issue -> open active-hit comment form -> verify `aria-label="批注"` and submit hook.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 link form smokeability iteration:

- Rechecked source textarea menu and preview BubbleMenu link forms after the comment form hook pass. The URL inputs had stable hooks and explicit labels, but the link form itself, apply button, and remove-link button still depended on style classes / visible copy for smoke.
- Added stable hooks to source link form controls: `data-review-source-link-form`, `data-review-source-link-submit`, and `data-review-source-link-remove`.
- Added matching preview hooks: `data-review-link-form`, `data-review-link-submit`, and `data-review-link-remove`.

2026-07-03 link form smokeability results:

- Browser smoke on `http://127.0.0.1:3003/`: pass for source link form. Path: submit Markdown link text -> source-select link label -> open link form -> verify source link URL input label, form hook, submit hook, and remove-link hook.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 active issue comment local focus iteration:

- Rechecked active-hit comment form focus management after source/preview inline forms had already moved to component-local template refs.
- Replaced the active-hit form's global `document.querySelector("[data-review-active-issue-comment-input]")` focus lookup with a local `activeIssueCommentInput` ref.
- The stable `data-review-active-issue-comment-*` hooks remain for smoke tests and host-level keyboard guards, but focus ownership now stays inside `ReviewEditor`.

2026-07-03 active issue comment local focus results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit text -> activate first right-side issue -> open current-hit comment form -> verify the textarea is focused, has `aria-label="批注"`, and the submit hook exists.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 delete mark paper-editing iteration:

- Rechecked the repair-mode deletion visuals after the candidate/delete affordance work. Delete candidates already suppressed the `-> 删除` replacement arrow, but source and preview still carried highlight backgrounds/rounded boxes in some paths, making deletion feel like another badge instead of a direct manuscript edit.
- Tightened source and preview deletion styles to the draft-paper contract: deletion marks now render as text-colored red strikethrough only, with transparent background, zero radius, no replacement arrow, and no top-corner label. Replacement candidates still keep their replacement hint path.
- Source diff deletion overlays also keep the same baseline font and explicit strikethrough behavior, so applied deletion diffs read as crossed-out old text rather than small floating pills.

2026-07-03 delete mark paper-editing results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `其实很好。测试！！！` -> verify the source delete candidate for `其实` has `line-through`, transparent background, `0px` radius, and no `::after` label -> switch to preview and verify the same contract.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 comment rail contextual action labels iteration:

- Rechecked the comment rail after the focus and smokeability work. The card actions were accessible, but repeated comments still exposed mostly generic button names such as locate/edit/delete, which is weak when reviewing several comment cards by keyboard or assistive tooling.
- Added a compact quote label helper for comment actions. It keeps normal whitespace natural, converts invisible characters to readable labels, trims long quotes, and appends the quote to locate, copy-context, complete/reopen, edit, delete, save-edit, and cancel-edit controls.
- Added a stable `data-comment-edit-cancel-id` hook beside the existing edit form/input/submit hooks, so the rail edit form now has a complete smokeable control set.

2026-07-03 comment rail contextual action labels results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `其实很好。` -> activate the right-side hit -> open current-hit comment form with `Ctrl+Alt+M` -> save a comment -> verify rail locate/copy/complete/edit/delete labels include `其实` -> open edit form -> verify save/cancel labels and hooks include the same quote context.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 inline form button contract iteration:

- Rechecked the source textarea menu and preview BubbleMenu inline forms after the local-ref focus work. Inputs and forms already had stable hooks, but several action buttons still depended on visible copy only.
- Added explicit `aria-label` and `title` to source/preview inline comment save/cancel buttons and source/preview inline link apply/cancel/remove buttons.
- Added stable cancel hooks: `data-review-source-comment-cancel`, `data-review-source-link-cancel`, `data-review-comment-cancel`, and `data-review-link-cancel`. Existing submit/remove hooks remain unchanged.

2026-07-03 inline form button contract results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit Markdown text with an existing link -> source-select text and open comment form -> verify source comment cancel/save labels and hooks -> source-select the Markdown link label and open link form -> verify source link remove/cancel/apply labels and hooks -> switch preview, select rendered text via DOM Range, open comment form, and verify preview comment cancel/save labels.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 active-hit form button contract iteration:

- Rechecked the current-hit comment form after source/preview inline forms had complete button contracts. The active-hit textarea and submit hook were stable, but the cancel button still had no stable hook and both form action buttons lacked explicit action labels.
- Added `data-review-active-issue-comment-cancel` to the active-hit comment cancel button.
- Added explicit `aria-label` and `title` to the active-hit comment cancel/save buttons, matching the inline comment form contract.

2026-07-03 active-hit form button contract results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit `其实很好。` -> activate the first right-side issue -> open current-hit comment form with `Ctrl+Alt+M` -> verify cancel/save labels and hooks -> click cancel and verify the form closes.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 segmented mode control accessibility iteration:

- Rechecked the source/preview segmented mode switch after adding `Ctrl/Cmd+Alt+T`. The shortcut was visible in button titles, but the shared `SegmentedControl` did not expose those titles as accessible names.
- Updated `SegmentedControl` to set `aria-label` from `option.title` when present, falling back to the visible label. This keeps hover tooltip, shortcut discovery, and programmatic button names aligned for the ReviewEditor mode switch and other segmented controls.
- Visual layout, selected state, and `aria-pressed` behavior are unchanged.

2026-07-03 segmented mode control accessibility results:

- Browser smoke on `http://127.0.0.1:3003/`: pass. Path: submit text -> verify source/preview segmented buttons can be found by accessible names containing `Ctrl/Cmd+Alt+T` -> press `Ctrl+Alt+T` to switch preview -> press it again to return source.
- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.

2026-07-03 comment edit undo iteration:

- Rechecked comment editing against delete/clear behavior. Deleting one comment and clearing all comments already show an undo notification, but editing a comment body saved silently and had no one-step recovery.
- Updated `TextPanel.updateComment()` to record the previous body, show `notify.commentUpdated`, and provide an undo action that restores the old body if the comment still exists.
- Added zh-CN/en-US `notify.commentUpdated` copy.

2026-07-03 comment edit undo results:

- `cd web && bun run typecheck`: pass. Existing `vue-router/volar/sfc-route-blocks` warning remains.
- `cd web && bun run build`: pass. Existing Nuxt module-preload sourcemap, VueUse pure annotation, chunk-size, and Node `DEP0155` warnings remain.
- Browser smoke on `http://127.0.0.1:3003/`: attempted but not claimed pass. The focused edit-undo script repeatedly hit Playwright/dev-server timing instability around the rail edit form submit path (`click`/`requestSubmit`/synthetic submit/keyboard submit variants). Temporary scripts were deleted and the dev server was stopped. Re-run this path with a more robust driver before claiming browser coverage for edit undo.

2026-07-03 fixability affordance and rule metadata cleanup:

- Investigated why repair actions still looked unclickable. The right report list only revealed per-hit repair buttons on hover/focus, while the rule dimension badge showed raw `fixability` even when a `suggest` / `llm` rule had no deterministic replacement.
- Tightened rule loading: rule JSON `review` / `fixability` fields are now read by the loader, and final `fixability` is constrained by actual rule capability. Only `regex` + `replace` rules can remain `auto` / `candidate`; `suggest` and `llm` rules resolve to `manual` even if a namespace policy or rule file tries to mark them as candidate.
- Updated the report UI so repairable rules display explicit `能修复` / `候选修复` labels, and per-hit apply buttons are visible instead of hover-only. This keeps the UI promise aligned with the actual replacement path (`replacement !== null` remains the editor action gate).

2026-07-03 fixability affordance results:

- `cd web && bun run typecheck`: pass. Registry was rebuilt as part of typecheck; existing `vue-router/volar/sfc-route-blocks` warning remains.
- Focused tests passed: `bun test tests/llmlint.test.ts -t "规则文件中的 review"` and `bun test tests/llmlint.test.ts -t "Review issue UI"`.
- Full `bun test tests/llmlint.test.ts` was attempted twice, but multiple CLI subprocess tests hit the existing 5s timeout / Windows temp cleanup instability after long-running `--help` / check commands. The failures cascaded after temporary directories were removed and are not treated as meaningful assertions for this change.
- `cd web && bun run build` was attempted. Client and server bundles completed after existing Nuxt module-preload, VueUse pure annotation, and chunk-size warnings, but Nitro server packaging stayed silent for several minutes; the build process tree was stopped and this run is not claimed as pass.

## TODO / Follow-ups

- Improve rendered Markdown source-offset mapping after the first usable version is proven.
- Add split-screen diff after the annotated diff path is stable.
- Design the real LLM edit lifecycle separately; current web still has no LLM backend.
- Consider reusing the same review editor in `/contribute` report mode.
- Decide whether preview should become a truly editable TipTap surface. Current iteration intentionally keeps preview read-only and uses source mode as the precise editing contract.
