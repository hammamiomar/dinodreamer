"""Copy the How page's automaton training history from its research run, compact (CPU only).

The run folder is the one the home's story names for the definition (app/public/story/story.json,
`run`), relative to the research checkout. The page's act 3 draws the loss at every
optimizer update and the selection fraction of every readout from `history.json` written here:

    {"run": ..., "updates": [[update, loss, overflow], ...], "readouts": [[update, selection, median], ...]}

selection is the readout's share of patches that select the group at simulation step 600, and
median its median response magnitude in units of m, as the research readouts recorded them.

    python3 engine/tools/prepare_how_automaton_history.py <run folder> <record folder>
"""
import json
import sys
from pathlib import Path


def main() -> None:
    run = Path(sys.argv[1])
    output = Path(sys.argv[2])
    history = json.loads((run / "history.json").read_text())
    readouts = json.loads((run / "readouts.json").read_text())
    compact = {
        "run": str(run).split("/research/")[-1],
        "updates": [[row["iteration"] + 1, round(row["loss"], 5), round(row["overflow"], 7)] for row in history],
        "readouts": [
            [row["updates"], round(row["tick_600"]["winner"], 5), round(row["tick_600"]["median_norm_over_m"], 4)]
            for row in readouts if "tick_600" in row
        ],
    }
    (output / "history.json").write_text(json.dumps(compact, separators=(",", ":")) + "\n")
    print(f"{len(compact['updates'])} updates, {len(compact['readouts'])} readouts, written to {output / 'history.json'}")


if __name__ == "__main__":
    main()
