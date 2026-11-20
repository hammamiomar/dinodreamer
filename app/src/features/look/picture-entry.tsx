import { useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useUploadedPicture } from "../../app/uploaded-picture";
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

/** Keep the explicit engine choice when moving from the Atlas or a block. */
export function picturePath(search: string): string {
  const engine = new URLSearchParams(search).get("engine");
  return engine === "fake" ? "/picture?engine=fake" : "/picture";
}
