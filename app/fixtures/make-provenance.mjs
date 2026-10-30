// Writes the fixture's provenance table in
// the production placement: a file per block and the pages of the provenance
// orders under provenance/<table_id>/, and library.provenance in
// releases/fixture.json. The fixture dictionary was never measured, so the
// records are real records of production blocks, from the published table
// 0b11859663634baf (8,192 library previews, seed 13), lent to
// fixture blocks in turn:
//   - patch: blocks 0–23 except 7, which have cards on the fixture's page 0; block b
//     gets record b % 11, so each record is lent two or three times;
//   - cls: blocks 0–3, block b gets cls record b % 3;
//   - block 7 and blocks 24 and 25 have no record ("roles": {}).
// The fixture has block files (blocks/<n>.json) for blocks 0–7 only, so the block panel's
// cases sit there: 0 no family below 100 sample tokens (production 1836; cls 129 on
// blocks 0 and 3), 1 local, 2 neighbourhood, 3 position (5983; 3822 on blocks 8 and 19),
// 4 a share above 1 (15729, context 1.07), 5 and 6 a split pair (1525 and 3654; again on
// 16 and 17), 7 no record. The family is the table's word, copied as published.
// Order pages follow the producer's rule (dinoDreamer deploy/public/provenance.py,
// defining_share): a family's blocks by its term, the context order by context,
// largest first, equal values by block number.
//
// Run from app/: node fixtures/make-provenance.mjs

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = import.meta.dirname;
const PUBLICATION = "a8d6b0022652213f3916c6c348655a0af47bd51c7b1563e058fec4bfb81d6990";
const READOUT = join(FIXTURES, `web/v2/readouts/${PUBLICATION}`);
const BLOCKS = 26;
const PAGE_SIZE = 24;
const ORDERS = ["context", "local", "neighbourhood", "surround", "global", "position"];

// [production block, its published patch record]: the core shares, the family, the border fraction and the split partner.
const PATCH_RECORDS = [
  [1836, { sample_tokens: 59, carried: 0.0381235741, self: 0.0193910077, near: 0.2272719, far: 0.727570713, cls: -0.00733976299, storage: 0.000108568158, attention_bias: -0.0626293346, mlp: -0.126044169, constant: 0.183547586, context: 0.947611392, local: -0.068529591, family: null, border_fraction: 0.203389823, split_partner: null }],
  [12534, { sample_tokens: 6585, carried: 0.953470707, self: -0.000743882498, near: 0.016433157, far: 0.061724104, cls: -0.0013729569, storage: 0.00157258508, attention_bias: -0.0429719724, mlp: 0.0337599926, constant: -0.0218728259, context: 0.0783568919, local: 0.986486793, family: "local", border_fraction: 0.184510246, split_partner: null }],
  [9023, { sample_tokens: 5433, carried: 0.153873891, self: 0.0778024197, near: 0.559003353, far: 0.251850307, cls: 0.00808810163, storage: -0.00221698615, attention_bias: -0.0245718043, mlp: -0.0224680249, constant: -0.00136164878, context: 0.816724777, local: 0.20920828, family: "neighbourhood", border_fraction: 0.169151485, split_partner: null }],
  [5983, { sample_tokens: 10759, carried: 0.845922172, self: 0.00363794831, near: 0.0291128941, far: 0.131016314, cls: 0.0104189599, storage: -0.000454128865, attention_bias: -0.0678469315, mlp: 0.0417813063, constant: 0.00641215313, context: 0.170094043, local: 0.891341448, family: "position", border_fraction: 0.838739634, split_partner: null }],
  [15729, { sample_tokens: 1966, carried: -0.113518588, self: 0.0151334805, near: 0.19807893, far: 0.852300525, cls: 0.0209794585, storage: -0.000553967897, attention_bias: -0.0900737494, mlp: -0.0962273404, constant: 0.213881344, context: 1.07080495, local: -0.194612443, family: "surround", border_fraction: 0.201424211, split_partner: null }],
  [1525, { sample_tokens: 5042, carried: 0.0718103126, self: 0.0166413821, near: 0.143345505, far: 0.683890402, cls: 0.0345644616, storage: 0.0024092081, attention_bias: -0.0914407447, mlp: 0.0182032287, constant: 0.120576128, context: 0.864209592, local: 0.106654927, family: "surround", border_fraction: 0.19773899, split_partner: 3654 }],
  [3654, { sample_tokens: 3982, carried: 0.0149985477, self: 0.0140692266, near: 0.137890369, far: 0.750362813, cls: 0.0300953612, storage: 0.00282393093, attention_bias: -0.0444858372, mlp: -0.117988952, constant: 0.21223484, context: 0.9211725, local: -0.0889211744, family: "surround", border_fraction: 0.21170266, split_partner: 1525 }],
  [1470, { sample_tokens: 8471, carried: -0.00632086303, self: 0.00775788631, near: 0.0506487377, far: 0.153732747, cls: 0.598462224, storage: 0.0494943373, attention_bias: 0.148550779, mlp: 0.140258387, constant: -0.142583728, context: 0.852338076, local: 0.14169541, family: "global", border_fraction: 0.24294652, split_partner: null }],
  [3822, { sample_tokens: 3683, carried: 0.425669342, self: 0.024241019, near: 0.106493309, far: 0.263477355, cls: 0.0144554218, storage: 0.00832262915, attention_bias: 0.00482881162, mlp: 0.125009179, constant: 0.0275027696, context: 0.392748713, local: 0.574919522, family: "position", border_fraction: 0.872115135, split_partner: null }],
  [8092, { sample_tokens: 6917, carried: 0.101442263, self: 0.0599569939, near: 0.580981493, far: 0.228560492, cls: 0.0167297795, storage: 0.00011427109, attention_bias: -0.0112878494, mlp: 0.24253504, constant: -0.219033137, context: 0.826386034, local: 0.4039343, family: "neighbourhood", border_fraction: 0.152378201, split_partner: null }],
  [4945, { sample_tokens: 14367, carried: 0.143234998, self: 0.0202241186, near: 0.130622566, far: 0.342813611, cls: 0.412040681, storage: 0.0203077104, attention_bias: -0.0019172437, mlp: 0.0546286814, constant: -0.121955737, context: 0.905784547, local: 0.218087792, family: "global", border_fraction: 0.311199278, split_partner: null }],
];

// Production cls records of blocks 129 (no family), 217 (local) and 2069 (surround): no near patches for a prefix token.
const CLS_RECORDS = [
  [129, { sample_tokens: 43, carried: -0.0689873621, self: 0.000819417706, near: 0, far: 0.833142579, cls: 0, storage: -0.024704475, attention_bias: 0.173655316, mlp: 0.142353043, constant: -0.0562786348, context: 0.808438122, local: 0.0741850957, family: null }],
  [217, { sample_tokens: 235, carried: 0.0735555142, self: -0.00349487946, near: 0, far: 0.380056947, cls: 0, storage: -0.00328735961, attention_bias: -0.102250129, mlp: 0.376954079, constant: 0.278466046, context: 0.376769602, local: 0.447014719, family: "local" }],
  [2069, { sample_tokens: 216, carried: 0.223071262, self: 0.0167494658, near: 0, far: 0.853380978, cls: 0, storage: -0.0163071994, attention_bias: 0.0701151714, mlp: 0.00113028625, constant: -0.148140073, context: 0.837073803, local: 0.240951017, family: "surround" }],
];

/** The value an order ranks by: the producer's defining_share. */
const ORDER_TERM = {
  context: (record) => record.context,
  local: (record) => record.local,
  neighbourhood: (record) => record.near,
  surround: (record) => record.far,
  global: (record) => record.cls + record.storage,
  position: (record) => record.border_fraction ?? record.local,
};

/**
 * Production record `index` lent to fixture `block`. A split partner names a production
 * block; in the fixture it names the block that holds the partner's record in the same turn.
 */
function lentRecord(block, index) {
  const [, record] = PATCH_RECORDS[index];
  if (record.split_partner === null) return record;
  const partnerIndex = PATCH_RECORDS.findIndex(([production]) => production === record.split_partner);
  return { ...record, split_partner: block - index + partnerIndex };
}

const roles = Array.from({ length: BLOCKS }, () => ({}));
for (let block = 0; block < 24; block += 1) {
  if (block !== 7) roles[block].patch = lentRecord(block, block % PATCH_RECORDS.length);
}
for (let block = 0; block < 4; block += 1) roles[block].cls = CLS_RECORDS[block % CLS_RECORDS.length][1];
for (const [block, byRole] of roles.entries()) {
  const partner = byRole.patch?.split_partner;
  if (partner != null && roles[partner]?.patch?.split_partner !== block) throw new Error(`block ${block}: partner ${partner} does not name it back`);
}

const tableId = createHash("sha256").update(JSON.stringify(roles)).digest("hex").slice(0, 16);
const prefix = `web/v2/readouts/${PUBLICATION}/provenance/${tableId}/`;
const folder = join(FIXTURES, prefix);
mkdirSync(folder, { recursive: true });
for (let block = 0; block < BLOCKS; block += 1) {
  writeFileSync(join(folder, `${block}.json`), `${JSON.stringify({ format: 1, block, roles: roles[block] })}\n`);
}

// Every block's patch category in one letter, as
// engine/tools/prepare_provenance_categories.py writes it for a production table.
const LETTERS = { L: "local", N: "neighbourhood", S: "surround", G: "global", P: "position", "-": null };
const LETTER_OF_WORD = new Map(Object.entries(LETTERS).map(([letter, word]) => [word, letter]));
const patchLetters = roles.map((byRole) => LETTER_OF_WORD.get(byRole.patch?.family ?? null)).join("");
const categories = { format: 1, table: tableId, rule: "the table's family column", letters: LETTERS, roles: { patch: patchLetters } };
writeFileSync(join(folder, "categories.json"), `${JSON.stringify(categories)}\n`);

const counts = {};
for (const role of ["patch", "cls"]) {
  const source = JSON.parse(readFileSync(join(READOUT, `atlas/${role}/block/0.json`), "utf8"));
  const cards = new Map(source.cards.map((card) => [card.block, card]));
  counts[role] = {};
  for (const order of ORDERS) {
    const blocks = roles
      .map((byRole, block) => ({ block, record: byRole[role] }))
      .filter(({ record }) => record && (order === "context" || record.family === order))
      .sort((a, b) => ORDER_TERM[order](b.record) - ORDER_TERM[order](a.record) || a.block - b.block);
    counts[role][order] = blocks.length;
    const pages = Math.ceil(blocks.length / PAGE_SIZE);
    for (let page = 0; page < pages; page += 1) {
      const listed = blocks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      const file = {
        ...source,
        sort: order,
        page,
        total_blocks: blocks.length,
        total_pages: pages,
        cards: listed.map(({ block, record }) => ({ ...cards.get(block), provenance: record })),
      };
      mkdirSync(join(folder, `atlas/${role}/${order}`), { recursive: true });
      writeFileSync(join(folder, `atlas/${role}/${order}/${page}.json`), `${JSON.stringify(file)}\n`);
    }
    console.log(role, order, blocks.map(({ block }) => block).join(" "));
  }
}

const releasePath = join(FIXTURES, "releases/fixture.json");
const release = JSON.parse(readFileSync(releasePath, "utf8"));
release.library.provenance = {
  prefix,
  format: 1,
  table_sha256: createHash("sha256").update(JSON.stringify(roles)).digest("hex"),
  sample: { images: 8192, seed: 13, min_winning_tokens: 20, near_radius: 2, near_window: "5 x 5 patches" },
  family_rule: "the table's family column",
  orders: ORDERS,
  blocks: counts,
};
writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);
