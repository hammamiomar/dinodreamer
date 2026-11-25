// Scene 3 stage: one basis group's trainable Starts × Methods gallery matrix paired with a live
// WebGPU player for the selected filled cell and direct `/train` links for every open slot.

import { useState } from "react";
import { Link } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import { useMediaMatch } from "../../ui/media-match";
import { groupPath } from "../automata/gallery";
import { nameOf, type BasisGroupNames } from "../gallery/basis-groups";
import { materialFileUrl, usePublishedMaterial } from "../gallery/material-gallery";
import type { MaterialEntry } from "../gallery/material-index";
import { HOME_TICKS_PER_SECOND, kindWords, REGROW_AT_TICK } from "./home-material";
import { HomeMaterial, type HomeStill } from "./home-material-view";
import {
  buildTrainMatrix,
  chooseTrainMatrixGroup,
  TRAIN_STAGE_METHODS,
  TRAIN_STAGE_STARTS,
} from "./home-specimens";

const WORDS = SITE_WORDS.home.train;

export function HomeTrainStage({ entries, names, approached, active, still, onNoReplay }: {
  entries: readonly MaterialEntry[];
  names: BasisGroupNames;
  approached: boolean;
  active: boolean;
  still: HomeStill;
  onNoReplay: () => void;
}) {
  const group = chooseTrainMatrixGroup(entries);
  const matrix = buildTrainMatrix(entries, group);
  const filledCells = matrix.cells.filter((cell) => cell.entry !== null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const compact = useMediaMatch("(max-width: 640px)");

  const selectedCell = filledCells.find((cell) => cell.entry?.id === chosenId) ?? filledCells[0] ?? null;
  const selectedEntry = selectedCell?.entry ?? null;
  const material = usePublishedMaterial(!still && approached ? selectedEntry : null);

  const groupName = nameOf(names, group) ?? (group === 6638 ? SITE_WORDS.home.properties.groupDefaultNames[6638] : null);
  const creditLine = selectedEntry?.credit ? fill(SITE_WORDS.stage.by, { credit: selectedEntry.credit }) : null;

  const renderCell = (start: (typeof TRAIN_STAGE_STARTS)[number], method: (typeof TRAIN_STAGE_METHODS)[number]) => {
    const cell = matrix.cells.find((item) => item.start === start && item.method === method)!;
    const startWord = WORDS.starts[start];
    const methodWord = WORDS.methodFull[method];
    if (cell.entry) {
      const isSelected = selectedEntry?.id === cell.entry.id;
      return (
        <td key={`${start}-${method}`}>
          <button
            type="button"
            className="home-matrix-cell"
            aria-pressed={isSelected}
            aria-label={fill(WORDS.cellPlay, { start: startWord, method: methodWord })}
            onClick={() => setChosenId(cell.entry!.id)}
          >
            <img
              src={materialFileUrl(cell.entry, "poster.png")}
              alt=""
              width={96}
              height={96}
              loading="lazy"
            />
          </button>
        </td>
      );
    }
    return (
      <td key={`${start}-${method}`}>
        <Link
          className="home-matrix-cell home-matrix-open"
          to={cell.trainPath}
          aria-label={fill(WORDS.cellTrainLabel, { start: startWord, method: methodWord })}
        >
          <span>{WORDS.cellTrainWord}</span>
        </Link>
      </td>
    );
  };

  return (
    <div className="home-stage-frame home-train">
      {selectedEntry && selectedCell && (
        <div className="home-train-preview">
          <div className="home-train-player">
            <HomeMaterial
              key={selectedEntry.id}
              entry={selectedEntry}
              material={!still && material.status === "ready" ? material.value : null}
              playing={active && !still}
              stepsPerSecond={HOME_TICKS_PER_SECOND}
              regrowAtTick={REGROW_AT_TICK}
              brushRing
              onNoReplay={onNoReplay}
            />
          </div>
          <div className="home-train-meta">
            <Link className="link-control home-train-group" to={groupPath(group, selectedEntry.id)}>
              {fill(WORDS.groupLabel, { block: group })}{groupName ? ` · ${groupName}` : ""}
            </Link>
            <p className="home-train-recipe">
              {WORDS.starts[selectedCell.start]} · {WORDS.methodFull[selectedCell.method]}
            </p>
            {creditLine && <p className="home-train-credit">{creditLine}</p>}
            <p className="label">{kindWords(selectedEntry)}</p>
          </div>
        </div>
      )}

      <div className="home-train-scroll">
        {compact ? (
          <table className="home-train-table home-train-table-turned" aria-label={fill(WORDS.tableLabel, { block: group })}>
            <thead>
              <tr>
                <th scope="col" className="home-train-corner">
                  <span className="label">{WORDS.startsHeading}</span>
                </th>
                {TRAIN_STAGE_STARTS.map((start) => (
                  <th key={start} scope="col" className="home-train-col">
                    {WORDS.starts[start]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TRAIN_STAGE_METHODS.map((method) => (
                <tr key={method}>
                  <th scope="row" className="home-train-row">
                    {WORDS.methodFull[method]}
                  </th>
                  {TRAIN_STAGE_STARTS.map((start) => renderCell(start, method))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="home-train-table" aria-label={fill(WORDS.tableLabel, { block: group })}>
            <thead>
              <tr>
                <th scope="col" rowSpan={2} className="home-train-corner">
                  <span className="label">{WORDS.startsHeading}</span>
                </th>
                <th scope="colgroup" colSpan={2} className="home-train-band">
                  {WORDS.spaces["basis-group"]}
                </th>
                <th scope="colgroup" colSpan={2} className="home-train-band">
                  {WORDS.spaces.token}
                </th>
              </tr>
              <tr>
                {TRAIN_STAGE_METHODS.map((method) => (
                  <th key={method} scope="col" className="home-train-col">
                    {WORDS.methods[method]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TRAIN_STAGE_STARTS.map((start) => (
                <tr key={start}>
                  <th scope="row" className="home-train-row">
                    {WORDS.starts[start]}
                  </th>
                  {TRAIN_STAGE_METHODS.map((method) => renderCell(start, method))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="home-stage-caption">
        <span>
          {fill(WORDS.tableCaption, {
            filled: matrix.filledCount,
            total: matrix.cells.length,
          })}
        </span>
      </p>
    </div>
  );
}
