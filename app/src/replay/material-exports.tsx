import { useState } from "react";
import type { FigureMaterial } from "../materials/material-file";
import { fill, SITE_WORDS } from "../app/site-words";
import { downloadBlob } from "../ui/files";
import { agentBrief, automatonEmbed, type AutomatonEmbed, type AutomatonMaker } from "./automaton-embed";
import { shadertoyShaderName, shadertoyShaderSource, supportsShadertoy } from "./shadertoy-export";

const WORDS = SITE_WORDS.stage;

/** Download the embed file of one automaton: the file a visitor puts on their own site. */
function downloadEmbed(material: FigureMaterial, maker: AutomatonMaker): AutomatonEmbed {
  const embed = automatonEmbed(material.file, maker);
  downloadBlob(new Blob([embed.script], { type: "text/javascript" }), embed.fileName);
  return embed;
}

/**
 * The Export panel: the embed for another site, with or without a brief for a coding agent, then
 * the page, the definition and the shaders.
 */
export function MaterialExports({ material, maker, onError }: { material: FigureMaterial; maker: AutomatonMaker; onError: (message: string) => void }) {
  const { file } = material;
  const [copied, setCopied] = useState(false);
  const run = (work: () => Promise<void>) => { work().catch((error: unknown) => onError(String(error))); };
  // One click: the file downloads, and the brief that names it goes to the clipboard.
  const copyForAgent = () => {
    const embed = downloadEmbed(material, maker);
    navigator.clipboard.writeText(agentBrief(embed, file)).then(
      () => setCopied(true),
      (error: unknown) => onError(fill(WORDS.copyFailed, { message: String(error instanceof Error ? error.message : error) })),
    );
  };
  return <>
    <button type="button" className="button" onClick={() => downloadEmbed(material, maker)}>{WORDS.downloadEmbed}</button>
    <button type="button" className="button" onClick={copyForAgent}>{WORDS.copyForAgent}</button>
    {copied && <p className="stage-message" role="status">{WORDS.copiedForAgent}</p>}
    <button type="button" className="button" onClick={() => run(async () => {
      const { replayPageHtml, replayPageName } = await import("./replay-page");
      downloadBlob(new Blob([replayPageHtml(file, maker)], { type: "text/html" }), replayPageName(file));
    })}>{WORDS.downloadPage}</button>
    <button type="button" className="button" onClick={() => downloadBlob(
      new Blob([JSON.stringify(file)], { type: "application/json" }), `${file.id}.material.json`)}>{WORDS.downloadMaterial}</button>
    <button type="button" className="button" onClick={() => run(async () => {
      const { embeddedRuleShaderName, embeddedRuleShaderSource } = await import("./embedded-rule-shader");
      downloadBlob(new Blob([embeddedRuleShaderSource(file, material.values)], { type: "text/plain" }), embeddedRuleShaderName(file));
    })}>{WORDS.downloadShader}</button>
    <button type="button" className="button" disabled={!supportsShadertoy(file)} onClick={() => run(async () => {
      downloadBlob(new Blob([shadertoyShaderSource(file, material.values)], { type: "text/plain" }), shadertoyShaderName(file));
    })}>{supportsShadertoy(file) ? WORDS.downloadShadertoy : WORDS.shadertoyUnavailable}</button>
  </>;
}
