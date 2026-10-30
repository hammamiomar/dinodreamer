import type { FigureMaterial } from "../materials/material-file";
import { SITE_WORDS } from "../app/site-words";
import { downloadBlob } from "../ui/files";
import { shadertoyShaderName, shadertoyShaderSource, supportsShadertoy } from "./shadertoy-export";

const WORDS = SITE_WORDS.stage;

/** Download the definition, page or shader. The video is in the player. */
export function MaterialExports({ material, onError }: { material: FigureMaterial; onError: (message: string) => void }) {
  const { file } = material;
  const run = (work: () => Promise<void>) => { work().catch((error: unknown) => onError(String(error))); };
  return <>
    <button type="button" className="button" onClick={() => downloadBlob(
      new Blob([JSON.stringify(file)], { type: "application/json" }), `${file.id}.material.json`)}>{WORDS.downloadMaterial}</button>
    <button type="button" className="button" onClick={() => run(async () => {
      const { replayPageHtml, replayPageName } = await import("./replay-page");
      downloadBlob(new Blob([replayPageHtml(file)], { type: "text/html" }), replayPageName(file));
    })}>{WORDS.downloadPage}</button>
    <button type="button" className="button" onClick={() => run(async () => {
      const { embeddedRuleShaderName, embeddedRuleShaderSource } = await import("./embedded-rule-shader");
      downloadBlob(new Blob([embeddedRuleShaderSource(file, material.values)], { type: "text/plain" }), embeddedRuleShaderName(file));
    })}>{WORDS.downloadShader}</button>
    <button type="button" className="button" disabled={!supportsShadertoy(file)} onClick={() => run(async () => {
      downloadBlob(new Blob([shadertoyShaderSource(file, material.values)], { type: "text/plain" }), shadertoyShaderName(file));
    })}>{supportsShadertoy(file) ? WORDS.downloadShadertoy : WORDS.shadertoyUnavailable}</button>
  </>;
}
