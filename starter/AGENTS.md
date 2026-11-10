# Workstreams

My threads belong to workstreams, shown as feature groups on the Focus Board
(`bb focus-board group list`).

- Early in a thread, once its subject is clear, put it in the matching group with
  `focus_board_group_set` (or `bb focus-board group add "<group>" "$BB_THREAD_ID"`).
  Judge by what the thread is about, not by its title.
- If no group fits, leave the thread ungrouped. Don't create a new group yourself;
  if this looks like a new workstream, suggest one to me instead.
- When I agree to a new workstream, create the group and add this thread in the
  same step (`bb focus-board group create "<name>"` then `group add` straight
  away): bb deletes a group that has no threads in it.
- If the work moves to a different workstream, move the thread
  (`bb focus-board group move`) or suggest starting a new thread there.
