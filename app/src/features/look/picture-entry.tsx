import { useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useUploadedPicture } from "../../app/uploaded-picture";
import { LOOK_TEXT } from "./look-text";
import "./picture.css";

/** Optional picture exploration from the Index. Reading continues on the picture's own page. */
export function PictureEntry({ text }: {
  text: { button: string; choose: string; view: string };
}) {
  const upload = useUploadedPicture();
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const to = picturePath(location.search);
  return (
    <div className="picture-entry">
      {upload.picture && <Link className="link-control" to={to}>{text.view}</Link>}
      <input ref={input} type="file" accept="image/*" aria-label={text.choose} hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;
        void upload.choose(file);
        navigate(to);
      }} />
      <button type="button" className="link-control" onClick={() => input.current?.click()}>{text.button}</button>
    </div>
  );
}

/** A block keeps the picture context without turning into another upload entrance. */
export function PictureSourceChip() {
  const upload = useUploadedPicture();
  const location = useLocation();
  if (!upload.readout || !upload.picture || !upload.previewUrl) return null;
  return (
    <div className="picture-source-chip" aria-label={LOOK_TEXT.source.name}>
      <Link to={picturePath(location.search)}>
        <img src={upload.previewUrl} width={32} height={32} alt="" />
        <span>{LOOK_TEXT.source.from} <b>{upload.picture.name}</b></span>
      </Link>
      <button className="link-control" aria-label={LOOK_TEXT.source.removeName} onClick={upload.clear}>{LOOK_TEXT.source.remove}</button>
    </div>
  );
}

/** Keep the explicit engine choice when moving from the Atlas or a block. */
export function picturePath(search: string): string {
  const engine = new URLSearchParams(search).get("engine");
  return engine === "fake" ? "/picture?engine=fake" : "/picture";
}
