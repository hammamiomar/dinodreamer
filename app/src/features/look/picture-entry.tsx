import { useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useUploadedPicture } from "../../app/uploaded-picture";
import "./picture.css";

/**
 * The door to Your picture: a button that opens the file chooser. The chosen picture is read on this
 * device, and its page, /picture, opens. The home, Train, the Index and the picture page share it.
 */
export function ChoosePictureButton({ className, children }: { className: string; children: ReactNode }) {
  const upload = useUploadedPicture();
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <input ref={input} type="file" accept="image/*" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;
        void upload.choose(file);
        navigate(picturePath(location.search));
      }} />
      <button type="button" className={className} onClick={() => input.current?.click()}>{children}</button>
    </>
  );
}

/** Optional picture exploration from the Index. Reading continues on the picture's own page. */
export function PictureEntry({ text }: {
  text: { button: string; view: string };
}) {
  const upload = useUploadedPicture();
  const location = useLocation();
  return (
    <div className="picture-entry">
      {upload.picture && <Link className="link-control" to={picturePath(location.search)}>{text.view}</Link>}
      <ChoosePictureButton className="button">{text.button}</ChoosePictureButton>
    </div>
  );
}

/** Keep the explicit engine choice when moving from the Atlas or a block. */
export function picturePath(search: string): string {
  const engine = new URLSearchParams(search).get("engine");
  return engine === "fake" ? "/picture?engine=fake" : "/picture";
}
