// Typed records of the public release and their decoders.
//
// The JSON shapes come from the producer, ../dinoDreamer/src/dinodreamer/native_bank/web.py
// and bank.py. Each decoder checks the fields the app uses, converts them to
// camelCase records and keeps nothing else. A decoder throws on the first field
// that does not match, so a changed release format fails at this boundary.

import { CELLS, TOKEN_SLOTS } from "../recipe";
import type { Token } from "../recipe";
import { slotRole } from "../recipe-parse";
import { isLibraryRole, LIBRARY_ROLES, librarySlot, slotLibraryRole } from "./roles";
import type { LibraryRole } from "./roles";

export type Code = [number, number, number];

/** releases/<name>.json: names the library tree and model files of one release. */
export interface Release {
  name: string;
  publicationId: string;
  assetId: string;
  /** Blocks in the release's dictionary; validateRecipe refuses a block at or beyond it. */
  blocks: number;
  /** Folder of the per-picture strongest-blocks files, relative to the base URL; null until the release has them all. */
  strongestBlocks: string | null;
  /** Folder of the per-picture address files (library/addresses.ts), relative to the base URL; null until the release has them all. */
  addresses: string | null;
  /** The provenance table the release names; null when it names none, or one in a format this app does not read. */
  provenance: ProvenanceTable | null;
  /** The contributions table the release names; null when it names none, or one in a format this app does not read. */
  contributions: ContributionsTable | null;
}

/**
 * release.library.contributions: each listed example's code split into five vectors that
 * add to it. The parts are, in order, itself
 * (carried + self + MLP), near, far, prefix (CLS and storage) and constants: the five
 * parts of a block's bar (library/provenance.ts), for one token.
 */
export interface ContributionsTable {
  /** Folder of the table's files, relative to the base URL. A new table is a new folder. */
  prefix: string;
}

/** The parts of a contributions table, in the order its vectors and shares use. */
export const CONTRIBUTION_PARTS = ["itself", "near", "far", "prefix", "constants"] as const;

/** release.library.provenance: one measured provenance table and where its files are. */
export interface ProvenanceTable {
  /** Folder of the table's files, relative to the base URL. A new table is a new folder. */
  prefix: string;
  /** Pictures in the measured sample. */
  sampleImages: number;
  /** A block has a record in a role when it wins at least this many tokens of the sample there. */
  minWinningTokens: number;
  /** Near patches lie within this Chebyshev distance of the token: 2 is the 5 × 5 square around it. */
  nearRadius: number;
  /** Explore's orders of the table, in display order: "context", then one per family. */
  orders: string[];
  /** Per role with records, the number of blocks in each order. */
  blocks: Partial<Record<LibraryRole, Record<string, number>>>;
}

export interface RoleStats {
  respondingImages: number;
  winningTokens: number;
  galleryImages: number;
  strongImages: number;
  moderateImages: number;
  variationImages: number;
  /** Effective dimension of the role's codes, 0–3. */
  dimension: number;
  /** The role's typical response norm (95th percentile). */
  mapScale: number;
}

export interface Catalog {
  name: string;
  publicationId: string;
  assetId: string;
  blocks: number;
  images: number;
  /** Per role, the number of responding images of every block; length = blocks. */
  respondingImages: Record<LibraryRole, number[]>;
}

/** Response norms and top-K flags of a set of token slots, in slot order. */
export interface TokenResponses {
  norm: number[];
  gated: boolean[];
}

/** One strong example on an atlas card, with every response needed to draw it. */
export interface AtlasExample {
  imageId: number;
  /** The example's patch position for a patch card; null for a prefix role. */
  position: number | null;
  rank: number;
  /** The 256 patch cells, row-major. */
  patches: TokenResponses;
  /** CLS and the four storage tokens, slot order. */
  prefix: TokenResponses;
}

export interface AtlasCard {
  block: number;
  role: LibraryRole;
  stats: RoleStats;
  examples: AtlasExample[];
  /** The block's provenance in the card's role: on the pages of a provenance order only. */
  provenance: Provenance | null;
}

/**
 * A page of a provenance order, under the table's folder: atlas/<role>/<order>/<page>.json,
 * 24 cards. Its sort is the order's name and every card carries its provenance. The
 * release's own atlas/<role>/<sort>/ pages have the same shape; the app no longer reads them.
 */
export interface AtlasPage {
  role: LibraryRole;
  sort: string;
  page: number;
  totalPages: number;
  totalBlocks: number;
  cards: AtlasCard[];
}

export const BANDS = ["strong", "moderate", "variation"] as const;
export type Band = (typeof BANDS)[number];

/** One listed example of a block: an image and the token that represents it for one role. */
export interface BlockExample {
  entryId: number;
  token: Token;
  libraryRole: LibraryRole;
  band: Band;
  rank: number;
  /** RMS of the image's winning codes in this role. */
  strength: number;
  winningTokens: number;
  source: string;
  license: string | null;
}

/** One sampled winning token of the block's code cloud. */
export interface CloudPoint {
  token: Token;
  code: Code;
  weight: number;
}

/** blocks/<block>.json */
export interface BlockRecord {
  block: number;
  stats: Record<LibraryRole, RoleStats>;
  /** In producer order: role, then band, then rank. */
  examples: BlockExample[];
  cloud: CloudPoint[];
  /** Images with an observation record, ascending; the order of observations/<block>.bin. */
  imageIds: number[];
}

/** One block of a picture's strongest-blocks file: the block's best token in the picture. */
export interface StrongestBlock {
  block: number;
  token: Token;
  libraryRole: LibraryRole;
  /**
   * The token's code in the block, as the producer computed it; a recipe can use it as is.
   * It is not copied from the observation record: where the block also records the
   * picture, the two agree within 1e-5 of ‖code‖.
   */
  code: Code;
  /** ‖code‖. */
  response: number;
  /** response ÷ the block's map_scale for the token's role; the list is ordered by it. */
  relative: number;
  /** Patch cells (0–255) where the block is among the token's top 32: where the block fires. */
  cells: number[];
}

/** strongest-blocks/<image_id>.json: the blocks where one picture responds most, strongest first. */
export interface StrongestBlocks {
  imageId: number;
  blocks: StrongestBlock[];
}

/**
 * Where a block's code comes from in one role. The research table splits each
 * winning token's code exactly into what writes it in the encoder's last block,
 * and averages each part's share over the block's winning tokens in a sample of
 * library pictures. The nine parts from `carried` to `constant` sum to 1.
 * A share is signed and can pass 1: a part can
 * write against the code the other parts write.
 */
export interface Provenance {
  /** The block's winning tokens in the measured sample; not the library's winning token count. */
  sampleTokens: number;
  /** The token's own state before the last block, carried by the residual stream. */
  carried: number;
  /** Attention from the token to itself. */
  self: number;
  /** Attention from the patches within the table's near radius. */
  near: number;
  /** Attention from every other patch. */
  far: number;
  /** Attention from the CLS token. */
  cls: number;
  /** Attention from the four storage tokens. */
  storage: number;
  /** The attention output's bias. */
  attentionBias: number;
  /** The last block's MLP. */
  mlp: number;
  /** The readout's constant: the final normalization's bias less the dictionary's calibration mean. */
  constant: number;
  /** near + far + cls + storage: the share written from other tokens. */
  context: number;
  /** carried + self + mlp. */
  local: number;
  /**
   * The table's family word ("local", "neighbourhood", "surround", "global", "position"), or null where
   * the table gives none: a block with fewer than 100 sample tokens has no family. The rule belongs to the table.
   */
  family: string | null;
  /**
   * The fraction of the block's winning tokens on the grid's outer ring, which holds 60 of
   * the 256 cells: about 0.23 when the block fires anywhere. Null or absent where the table
   * has none.
   */
  borderFraction?: number | null;
  /** The block that wins most of the same tokens: one feature split across two blocks. Null or absent when there is none. */
  splitPartner?: number | null;
}

/** <provenance prefix>/<block>.json: the block's provenance in each role the table measured; no role when it has no record. */
export interface BlockProvenance {
  block: number;
  roles: Partial<Record<LibraryRole, Provenance>>;
}

/**
 * <provenance prefix>/categories.json: every block's
 * response category in one letter, so a view reads the categories of the whole dictionary
 * in one file of about 16 kB instead of table.json (14.6 MB).
 */
export interface ProvenanceCategories {
  /** The table's id: the first 16 hexadecimal digits of its SHA-256, the name of its folder. */
  table: string;
  /** The rule that assigned the categories, as the release manifest states it (`family_rule`). */
  rule: string;
  /** Per role in the file, each block's category word; a block without a category is absent. */
  roles: Partial<Record<LibraryRole, ReadonlyMap<number, string>>>;
}

/** images/<image_id>.json: where a view came from. */
export interface ImageInfo {
  imageId: number;
  viewId: string;
  viewKind: string;
  source: string;
  split: string;
  license: string | null;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Decoders

export function decodeRelease(value: unknown): Release {
  const record = object(value, "release");
  if (record.format !== 1) throw new Error(`release: unsupported format ${String(record.format)}`);
  const library = object(record.library, "release.library");
  const model = object(record.model, "release.model");
  return {
    name: string(record.release, "release.release"),
    publicationId: string(library.publication_id, "release.library.publication_id"),
    assetId: string(library.asset_id, "release.library.asset_id"),
    blocks: integer(model.blocks, "release.model.blocks"),
    strongestBlocks: library.strongest_blocks === undefined ? null : string(library.strongest_blocks, "release.library.strongest_blocks"),
    addresses: library.addresses === undefined ? null : string(library.addresses, "release.library.addresses"),
    provenance: library.provenance === undefined ? null : decodeProvenanceTable(library.provenance, "release.library.provenance"),
    contributions: library.contributions === undefined ? null : decodeContributionsTable(library.contributions, "release.library.contributions"),
  };
}

/** As for provenance, a table in another format, or with other parts, is no table rather than a failed release. */
function decodeContributionsTable(value: unknown, path: string): ContributionsTable | null {
  const record = object(value, path);
  if (record.format !== 1) return null;
  const parts = array(record.parts, `${path}.parts`, string);
  if (parts.join() !== CONTRIBUTION_PARTS.join()) return null;
  return { prefix: string(record.prefix, `${path}.prefix`) };
}

/** One listed example's code as five vectors that add to it, and each vector's share of the code. */
export interface ContributionEntry {
  /** In CONTRIBUTION_PARTS order; calibrated code units, the axes of the block's cloud codes. */
  vectors: [Code, Code, Code, Code, Code];
  /** ⟨v, c⟩ / ‖c‖², with c the sum of the vectors; signed, summing to one. */
  shares: [number, number, number, number, number];
}

/** <contributions prefix>/<block>.json: the split of each listed example of the block, by entry id. */
export interface BlockContributions {
  block: number;
  entries: Map<number, ContributionEntry>;
}

export function decodeBlockContributions(value: unknown): BlockContributions {
  const record = object(value, "contributions");
  if (record.format !== 1) throw new Error(`contributions: unsupported format ${String(record.format)}`);
  const entries = new Map<number, ContributionEntry>();
  array(record.entries, "contributions.entries", (entry, path) => {
    const item = object(entry, path);
    const vectors = array(item.vectors, `${path}.vectors`, code);
    const shares = array(item.shares, `${path}.shares`, number);
    if (vectors.length !== CONTRIBUTION_PARTS.length) throw new Error(`${path}.vectors: expected ${CONTRIBUTION_PARTS.length} vectors`);
    if (shares.length !== CONTRIBUTION_PARTS.length) throw new Error(`${path}.shares: expected ${CONTRIBUTION_PARTS.length} shares`);
    entries.set(integer(item.entry_id, `${path}.entry_id`), {
      vectors: vectors as ContributionEntry["vectors"],
      shares: shares as ContributionEntry["shares"],
    });
  });
  return { block: integer(record.block, "contributions.block"), entries };
}

/** Names that become parts of a file path or a URL: an order, a family. */
const PATH_WORD = /^[a-z][a-z0-9_]*$/;

/**
 * A table in another format is not an error: the manifest is the one file every
 * open tab reads again, so a tab older than a format change shows no provenance
 * instead of failing the release.
 */
function decodeProvenanceTable(value: unknown, path: string): ProvenanceTable | null {
  const record = object(value, path);
  if (record.format !== 1) return null;
  const sample = object(record.sample, `${path}.sample`);
  const orders = array(record.orders, `${path}.orders`, (order, orderPath) => {
    const name = string(order, orderPath);
    if (!PATH_WORD.test(name)) throw new Error(`${orderPath}: ${name} is not an order name`);
    return name;
  });
  const counts = object(record.blocks, `${path}.blocks`);
  const blocks: ProvenanceTable["blocks"] = {};
  for (const role of LIBRARY_ROLES) {
    if (counts[role] === undefined) continue;
    const byOrder = object(counts[role], `${path}.blocks.${role}`);
    blocks[role] = Object.fromEntries(orders.map((order) => [order, integer(byOrder[order] ?? 0, `${path}.blocks.${role}.${order}`)]));
  }
  return {
    prefix: string(record.prefix, `${path}.prefix`),
    sampleImages: integer(sample.images, `${path}.sample.images`),
    minWinningTokens: integer(sample.min_winning_tokens, `${path}.sample.min_winning_tokens`),
    nearRadius: integer(sample.near_radius, `${path}.sample.near_radius`),
    orders,
    blocks,
  };
}

export function decodeBlockProvenance(value: unknown): BlockProvenance {
  const record = object(value, "provenance");
  if (record.format !== 1) throw new Error(`provenance: unsupported format ${String(record.format)}`);
  const roles = object(record.roles, "provenance.roles");
  const decoded: BlockProvenance["roles"] = {};
  // A role this app does not know (a pooled "storage") is left out.
  for (const role of LIBRARY_ROLES) {
    if (roles[role] !== undefined) decoded[role] = decodeProvenance(roles[role], `provenance.roles.${role}`);
  }
  return { block: integer(record.block, "provenance.block"), roles: decoded };
}

/** `blocks` is the dictionary's size: a role's letters name every block once, in block order. */
export function decodeProvenanceCategories(value: unknown, blocks: number): ProvenanceCategories {
  const record = object(value, "categories");
  if (record.format !== 1) throw new Error(`categories: unsupported format ${String(record.format)}`);
  // Each letter's category word; null is the letter of a block without a category.
  const words = new Map<string, string | null>();
  for (const [letter, word] of Object.entries(object(record.letters, "categories.letters"))) {
    words.set(letter, nullable(word, `categories.letters.${letter}`, string));
  }
  const roles = object(record.roles, "categories.roles");
  const decoded: ProvenanceCategories["roles"] = {};
  // A role this app does not know is left out, as in a block's provenance file.
  for (const role of LIBRARY_ROLES) {
    if (roles[role] === undefined) continue;
    const path = `categories.roles.${role}`;
    const letters = string(roles[role], path);
    if (letters.length !== blocks) throw new Error(`${path}: ${letters.length} letters for ${blocks} blocks`);
    const categories = new Map<number, string>();
    for (let block = 0; block < blocks; block += 1) {
      const word = words.get(letters.charAt(block));
      if (word === undefined) throw new Error(`${path}: block ${block} has the letter ${letters.charAt(block)}, which categories.letters does not name`);
      if (word !== null) categories.set(block, word);
    }
    decoded[role] = categories;
  }
  return { table: string(record.table, "categories.table"), rule: string(record.rule, "categories.rule"), roles: decoded };
}

function decodeProvenance(value: unknown, path: string): Provenance {
  const record = object(value, path);
  const family = nullable(record.family, `${path}.family`, string);
  if (family !== null && !PATH_WORD.test(family)) throw new Error(`${path}.family: ${family} is not a response category`);
  return {
    sampleTokens: integer(record.sample_tokens, `${path}.sample_tokens`),
    carried: number(record.carried, `${path}.carried`),
    self: number(record.self, `${path}.self`),
    near: number(record.near, `${path}.near`),
    far: number(record.far, `${path}.far`),
    cls: number(record.cls, `${path}.cls`),
    storage: number(record.storage, `${path}.storage`),
    attentionBias: number(record.attention_bias, `${path}.attention_bias`),
    mlp: number(record.mlp, `${path}.mlp`),
    constant: number(record.constant, `${path}.constant`),
    context: number(record.context, `${path}.context`),
    local: number(record.local, `${path}.local`),
    family,
    borderFraction: nullable(record.border_fraction, `${path}.border_fraction`, number),
    // The research table writes −1 for no partner; the release writes null.
    splitPartner: nullable(record.split_partner, `${path}.split_partner`, (value, field) => {
      const block = integer(value, field);
      return block >= 0 ? block : null;
    }),
  };
}

export function decodeCatalog(value: unknown): Catalog {
  const record = object(value, "catalog");
  const summary = object(record.summary, "catalog.summary");
  const blocks = integer(summary.blocks, "catalog.summary.blocks");
  const responding = object(record.responding_images, "catalog.responding_images");
  const respondingImages = {} as Record<LibraryRole, number[]>;
  for (const role of LIBRARY_ROLES) {
    const counts = array(responding[role], `catalog.responding_images.${role}`, integer);
    if (counts.length !== blocks) throw new Error(`catalog.responding_images.${role}: expected ${blocks} basis groups`);
    respondingImages[role] = counts;
  }
  return {
    name: string(record.name, "catalog.name"),
    publicationId: string(record.publication_id, "catalog.publication_id"),
    assetId: string(record.asset_id, "catalog.asset_id"),
    blocks,
    images: integer(summary.images, "catalog.summary.images"),
    respondingImages,
  };
}

/** A page of a provenance order: the order the file was read for, and a provenance on every card. */
export function decodeProvenancePage(value: unknown, order: string): AtlasPage {
  const page = decodePage(value);
  if (page.sort !== order) throw new Error(`atlas page.sort: the page is in order ${page.sort}, not ${order}`);
  const bare = page.cards.findIndex((card) => card.provenance === null);
  if (bare >= 0) throw new Error(`atlas page.cards[${bare}]: expected a provenance`);
  return page;
}

function decodePage(value: unknown): AtlasPage {
  const record = object(value, "atlas page");
  return {
    role: libraryRole(record.role, "atlas page.role"),
    sort: string(record.sort, "atlas page.sort"),
    page: integer(record.page, "atlas page.page"),
    totalPages: integer(record.total_pages, "atlas page.total_pages"),
    totalBlocks: integer(record.total_blocks, "atlas page.total_blocks"),
    cards: array(record.cards, "atlas page.cards", decodeAtlasCard),
  };
}

function decodeAtlasCard(value: unknown, path: string): AtlasCard {
  const record = object(value, path);
  const role = libraryRole(record.role, `${path}.role`);
  return {
    block: integer(record.block, `${path}.block`),
    role,
    stats: decodeRoleStats(record.stats, `${path}.stats`),
    examples: array(record.examples, `${path}.examples`, (example, examplePath) =>
      decodeAtlasExample(example, examplePath, role),
    ),
    provenance: nullable(record.provenance, `${path}.provenance`, decodeProvenance),
  };
}

/**
 * A patch card stores the patch map in `norm`/`gated`. A prefix-role card stores
 * its own token's scalar there and the patch map in `patch_map`.
 */
function decodeAtlasExample(value: unknown, path: string, role: LibraryRole): AtlasExample {
  const record = object(value, path);
  const patchSource = role === "patch" ? record : object(record.patch_map, `${path}.patch_map`);
  const patches = responses(patchSource, path, 256);
  const prefix = responses(object(record.prefix, `${path}.prefix`), `${path}.prefix`, 5);
  return {
    imageId: imageId(record.image_id, `${path}.image_id`),
    position: role === "patch" ? integer(record.position, `${path}.position`) : null,
    rank: integer(record.rank, `${path}.rank`),
    patches,
    prefix,
  };
}

export function decodeBlockRecord(value: unknown): BlockRecord {
  const record = object(value, "block");
  const block = integer(record.block, "block.block");
  const roles = object(object(record.stats, "block.stats").roles, "block.stats.roles");
  const stats = {} as Record<LibraryRole, RoleStats>;
  for (const role of LIBRARY_ROLES) stats[role] = decodeRoleStats(roles[role], `block.stats.roles.${role}`);
  const imageIds = array(record.images, "block.images", (image, path) => imageId(object(image, path).image_id, `${path}.image_id`));
  return {
    block,
    stats,
    examples: array(record.entries, "block.entries", decodeBlockExample),
    cloud: array(record.cloud, "block.cloud", decodeCloudPoint),
    imageIds,
  };
}

function decodeBlockExample(value: unknown, path: string): BlockExample {
  const record = object(value, path);
  const band = string(record.band, `${path}.band`);
  if (!(BANDS as readonly string[]).includes(band)) throw new Error(`${path}.band: unknown response level ${band}`);
  const role = libraryRole(record.role, `${path}.role`);
  return {
    entryId: integer(record.entry_id, `${path}.entry_id`),
    token: token(record, path, role),
    libraryRole: role,
    band: band as Band,
    rank: integer(record.rank, `${path}.rank`),
    strength: number(record.strength, `${path}.strength`),
    winningTokens: integer(record.winning_tokens, `${path}.winning_tokens`),
    source: string(record.source, `${path}.source`),
    license: nullable(record.license, `${path}.license`, string),
  };
}

function decodeCloudPoint(value: unknown, path: string): CloudPoint {
  const record = object(value, path);
  const role = libraryRole(record.role, `${path}.role`);
  return {
    token: token(record, path, role),
    code: code(record.code, `${path}.code`),
    weight: number(record.weight, `${path}.weight`),
  };
}

export function decodeStrongestBlocks(value: unknown): StrongestBlocks {
  const record = object(value, "strongest blocks");
  if (record.format !== 1) throw new Error(`strongest basis groups: unsupported format ${String(record.format)}`);
  const picture = imageId(record.image_id, "strongest blocks.image_id");
  const blocks = array(record.blocks, "strongest blocks.blocks", (entry, path) => decodeStrongestBlock(entry, path, picture));
  return { imageId: picture, blocks };
}

function decodeStrongestBlock(value: unknown, path: string, picture: number): StrongestBlock {
  const record = object(value, path);
  const role = libraryRole(record.role, `${path}.role`);
  const slot = integer(record.slot, `${path}.slot`);
  if (slot < 0 || slot >= TOKEN_SLOTS || slotLibraryRole(slot) !== role) throw new Error(`${path}: slot ${slot} is not a ${role} slot`);
  const cells = array(record.cells, `${path}.cells`, integer);
  if (cells.some((cell) => cell < 0 || cell >= CELLS)) throw new Error(`${path}.cells: a cell is outside the 16 × 16 grid`);
  return {
    block: integer(record.block, `${path}.block`),
    token: { imageId: picture, role: slotRole(slot), slot },
    libraryRole: role,
    code: code(record.code, `${path}.code`),
    response: number(record.response, `${path}.response`),
    relative: number(record.relative, `${path}.relative`),
    cells,
  };
}

export function decodeImageInfo(value: unknown): ImageInfo {
  const record = object(value, "image");
  return {
    imageId: imageId(record.image_id, "image.image_id"),
    viewId: string(record.view_id, "image.view_id"),
    viewKind: string(record.view_kind, "image.view_kind"),
    source: string(record.source, "image.source"),
    split: string(record.split, "image.split"),
    license: nullable(record.license, "image.license", string),
    width: integer(record.width, "image.width"),
    height: integer(record.height, "image.height"),
  };
}

function decodeRoleStats(value: unknown, path: string): RoleStats {
  const record = object(value, path);
  return {
    respondingImages: integer(record.responding_images, `${path}.responding_images`),
    winningTokens: integer(record.winning_tokens, `${path}.winning_tokens`),
    galleryImages: integer(record.gallery_images, `${path}.gallery_images`),
    strongImages: integer(record.strong_images, `${path}.strong_images`),
    moderateImages: integer(record.moderate_images, `${path}.moderate_images`),
    variationImages: integer(record.variation_images, `${path}.variation_images`),
    dimension: number(record.dimension, `${path}.dimension`),
    mapScale: number(record.map_scale, `${path}.map_scale`),
  };
}

/** The recipe token of an entry or cloud point; its stored slot must agree with role and position. */
function token(record: Record<string, unknown>, path: string, role: LibraryRole): Token {
  const position = nullable(record.position, `${path}.position`, integer);
  const slot = integer(record.slot, `${path}.slot`);
  if (librarySlot(role, position) !== slot) throw new Error(`${path}: slot ${slot} does not match ${role} ${position}`);
  return { imageId: imageId(record.image_id, `${path}.image_id`), role: slotRole(slot), slot };
}

function responses(record: Record<string, unknown>, path: string, length: number): TokenResponses {
  const norm = array(record.norm, `${path}.norm`, number);
  const gated = array(record.gated, `${path}.gated`, boolean);
  if (norm.length !== length || gated.length !== length) throw new Error(`${path}: expected ${length} responses`);
  return { norm, gated };
}

// ---------------------------------------------------------------------------
// Field readers. Each names the failing path.

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path}: expected an object`);
  return value as Record<string, unknown>;
}

function array<T>(value: unknown, path: string, item: (value: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array`);
  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}

function nullable<T>(value: unknown, path: string, read: (value: unknown, path: string) => T): T | null {
  return value === null || value === undefined ? null : read(value, path);
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path}: expected a string`);
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path}: expected a finite number`);
  return value;
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${path}: expected an integer`);
  return value as number;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path}: expected a boolean`);
  return value;
}

/**
 * Image ids are int64 in the producer. JSON.parse keeps them exact only up to
 * 2^53 − 1, so a larger id would silently name another image.
 */
function imageId(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${path}: image id is not an exact non-negative integer`);
  return value as number;
}

function libraryRole(value: unknown, path: string): LibraryRole {
  if (!isLibraryRole(value)) throw new Error(`${path}: unknown role ${String(value)}`);
  return value;
}

function code(value: unknown, path: string): Code {
  const values = array(value, path, number);
  if (values.length !== 3) throw new Error(`${path}: expected 3 numbers`);
  return [values[0]!, values[1]!, values[2]!];
}
