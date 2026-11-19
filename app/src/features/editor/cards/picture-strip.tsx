// Appearance reference pictures show their source windows with veiled cells outside.
// Cards open a window editor; the dock shows plain pictures. Touch users remove a
// card picture in its window editor, keeping the remove target separate from Open.
//
// LibraryImage requests anonymous CORS so an immutable preview response remains
// usable by the worker's later fetch.

import { useEffect, useRef } from "react";
import { useEditorSession } from "../../../app/editor-session";
import { useLibrary } from "../../../app/library-session";
import { GRID, type Reference } from "../../../recipe";
import { LibraryImage } from "../../../ui/library-image";
import { findRequest } from "../model";
import { palette } from "../presentation";
import { fill } from "../../../app/site-words";
import { CREATE_TEXT } from "../create-text";
import "./cards.css";

const WORDS = CREATE_TEXT.pictures;

const PICTURE_SIZE = 56;

/**
 * One request's reference pictures, reading the request from the editor session and
 * editing it there: × removes one. Nothing when the request
 * no longer exists (removed while the block panel still shows its rail).
 */
export function ReferenceStrip({ requestId, onEditWindow }: { requestId: number; onEditWindow?(imageId: number): void }) {
  const { state, dispatch } = useEditorSession();
  const library = useLibrary();
  const request = findRequest(state.recipe, requestId);
  if (!request) return null;
  return (
    <PictureStrip
      references={request.lookLike.references}
      src={(imageId) => library.previewUrl(imageId)}
      onRemove={(imageId) => dispatch({ type: "removeReference", requestId, imageId })}
      onEditWindow={onEditWindow}
    />
  );
}

function PictureStrip({
  references,
  src,
  onRemove,
  onEditWindow,
}: {
  references: Reference[];
  src(imageId: number): string;
  onRemove(imageId: number): void;
  /** Absent, the pictures are not clickable. */
  onEditWindow?(imageId: number): void;
}) {
  return (
    <div className="picture-strip" data-edits={onEditWindow ? "" : undefined}>
      {references.map((reference) => (
        <span key={reference.token.imageId} className="picture">
          <ReferencePicture reference={reference} src={src(reference.token.imageId)} onEditWindow={onEditWindow} />
          <button type="button" className="picture-remove" aria-label={WORDS.remove} onClick={() => onRemove(reference.token.imageId)}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/** The picture under its window veil: a button that opens the window editor where the strip offers one. */
function ReferencePicture({ reference, src, onEditWindow }: { reference: Reference; src: string; onEditWindow?(imageId: number): void }) {
  const image = (
    <>
      <LibraryImage src={src} alt="" loading="lazy" />
      <WindowVeil source={reference.source} />
    </>
  );
  const size = { width: PICTURE_SIZE, height: PICTURE_SIZE };
  if (!onEditWindow) {
    return (
      <span className="picture-image" style={size} role="img" aria-label={fill(WORDS.image, { id: reference.token.imageId })}>
        {image}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="picture-image"
      style={size}
      aria-label={fill(WORDS.editWindow, { id: reference.token.imageId })}
      onClick={() => onEditWindow(reference.token.imageId)}
    >
      {image}
    </button>
  );
}

/** How strongly a cell outside a source window is veiled. */
const WINDOW_VEIL_ALPHA = 0.72;

/** Veils the cells of a picture outside its source window, on a 16 × 16 canvas stretched over the picture. */
function WindowVeil({ source }: { source: boolean[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, GRID, GRID);
    context.fillStyle = palette().ground;
    context.globalAlpha = WINDOW_VEIL_ALPHA;
    source.forEach((selected, cell) => {
      if (!selected) context.fillRect(cell % GRID, Math.floor(cell / GRID), 1, 1);
    });
  }, [source]);
  return <canvas ref={canvasRef} className="window-veil" width={GRID} height={GRID} aria-hidden="true" />;
}
