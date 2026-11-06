---
trigger: always_on
description: Leave nothing behind. Remove the scratch files, worktrees, branches and stashes you made, and never remove what you did not make.
---

# Clean up behind you

Before you report a task as finished, remove everything you created for it. The working directory,
`origin` and the folder that holds the repository must look the way you found them, plus your change.

## What to remove

* **Scratch files.** Review diffs (`.review-*.diff`), probe tests (`zz-*.e2e.ts`), logs, `tmp*.pdb`
  and similar output. Write scratch output to the session scratchpad or the system temp folder, not
  to the repository root or to a folder next to the repository. A test that writes a file deletes it.
* **Worktrees.** A worktree you made is removed when its branch is merged or dropped. Remove the
  folder too, not only the Git entry: `git worktree remove`, then `git worktree prune`.
* **Branches.** After a pull request merges, delete the local branch and the remote branch (GitHub may
  already have deleted the remote one; run `git fetch --prune`). Then move local `main` forward to
  `origin/main`.
* **Stashes.** Apply or drop them. A stash is not a place to keep work.

## Links inside worktree folders

A worktree folder often holds only Windows junctions (folder links) to the main repository's
`node_modules`, `tools/.venv` and model weights. A normal recursive delete can follow the link and
delete the real files. Remove each link on its own first, without recursion, then the folder:

```powershell
[System.IO.Directory]::Delete($link.FullName, $false)
```

After that, check that the real `node_modules`, `tools/.venv` and weights still have their files.

## Only remove what you made

* Before you delete a branch, run `git cherry origin/main <branch>`. Delete it only when no commit is
  missing from `main`. A rebased or squashed merge changes the commit hash, so compare patches, not hashes.
* Before you delete a worktree, stash or folder that holds uncommitted changes, compare it with
  `main`. If the work is not in `main`, commit it or ask. If it is already in `main`, save a patch
  outside the repository first, then delete.
* Never delete something another person or agent made without asking: their worktrees, stashes,
  research data, or a separate project in a neighbouring folder.
* Another agent may be writing to the same folder. Check file modification times before you switch
  branches or stash. Do not switch branches under a running process.

## Before you say you are done

Run these and fix what they show, or say why something stays:

```
git status -sb
git branch -vv
git stash list
git worktree list
git branch -r
```

Your report names what remains and why.
