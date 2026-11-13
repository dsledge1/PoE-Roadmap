/* ---------- Plan data (from the author's 3.30 launch plan, v3 Nov 12: Spectre Necro 1A) ---------- */
// Cumulative minutes from league start for each pace column (§1.2 table).
const MILESTONES = [
  { id: 'M1',  btn: 'Act 1 done',          label: 'A1 done (Merveil)',                 split: 50, t6: 50,  t7: 55,  t8: 65,  gate: 'SRS 3L + Shield Charge linked, Absolution bought' },
  { id: 'M2',  btn: 'Act 2 done',          label: 'A2 done, bandits killed',           split: 35, t6: 88,  t7: 100, t8: 115, stop: 1, gate: 'Ele res ≥ 30%. Absolution 3–4L, Desecrate + Flesh Offering' },
  { id: 'M3',  btn: 'Act 3 done',          label: 'A3 done, Raise Spectre in hand',    split: 35, t6: 127, t7: 147, t8: 170, stop: 2, gate: 'Raise Spectre (Gravicious reward), 1–2 spectres up' },
  { id: 'M4',  btn: 'Normal lab done',     label: 'Normal lab (Mistress of Sacrifice)', split: 5, t6: 132, t7: 152, t8: 175, gate: 'Ele res ≥ 45%. Bone Offering now covers you' },
  { id: 'M5',  btn: 'Act 4 done',          label: 'A4 done (Malachai)',                split: 30, t6: 162, t7: 187, t8: 215, gate: 'Absolution 4–5L, zombie/golem 4L', risk: 'Malachai: people die here running out of flask charges. Re-cast Absolution first.' },
  { id: 'M6',  btn: 'A5 Kitava done',      label: 'A5 Kitava (−30% res after)',        split: 25, t6: 187, t7: 217, t8: 250, gate: 'Res capped, or the swap pieces already in your bag', risk: 'Kitava: check res BEFORE walking in (−30% afterwards). Minions die in some A5 zones: normal.' },
  { id: 'M7',  btn: 'Act 6 done',          label: 'A6 done (re-cap)',                  split: 35, t6: 226, t7: 264, t8: 305, stop: 3, gate: 'Ele res re-capped. Brine King pantheon', risk: 'Brine King (freeze), Abberath.' },
  { id: 'M8',  btn: 'Act 7 done',          label: 'A7 done',                           split: 30, t6: 256, t7: 299, t8: 345, gate: 'Life ≥ 2.5k', risk: 'Arakaali chaos degen.' },
  { id: 'M9',  btn: 'Act 8 done',          label: 'A8 done (Lunaris/Solaris)',         split: 35, t6: 291, t7: 342, t8: 395, gate: 'Chaos res ≥ 0. Quick "would this one-shot me" look at life', risk: 'Lunaris/Solaris.' },
  { id: 'M10', btn: 'Act 9 done',          label: 'A9 done (Depraved Trinity)',        split: 30, t6: 321, t7: 377, t8: 435, gate: 'Frost Auto-Scouts raised (The Tunnel / Refinery). Trigger craft on the wand', risk: 'Shakari chaos degen, Depraved Trinity.' },
  { id: 'M11', btn: 'A10 staff + skill pt', label: 'A10 up to Kitava: skill points',   split: 20, t6: 345, t7: 405, t8: 465, gate: 'Then go straight to Cruel lab (your habit)' },
  { id: 'M12', btn: 'Cruel lab done',      label: 'Cruel lab (Commander of Darkness)', split: 10, t6: 355, t7: 415, t8: 475, gate: 'Before Kitava: can you re-cap after −60 with what you carry?' },
  { id: 'M13', btn: 'A10 Kitava done',     label: 'A10 Kitava (−60% total)',           split: 5,  t6: 360, t7: 420, t8: 480, stop: 4, gate: 'Re-cap for −60 before anything else', risk: 'Kitava: check res BEFORE the fight.' },
  { id: 'M14', btn: 'Merciless lab done',  label: 'Merciless lab (Mindless Aggression)', split: 15, t6: 375, t7: 435, t8: 495, gate: 'Skip it if tired: do it fresh Saturday' },
  { id: 'M15', btn: 'Maps started',        label: 'White maps, Atlas started',         split: 0,  t6: 375, t7: 435, t8: 495, gate: 'Map-entry gate first. Atlas: Kingsmarch/Ore → Verisium nodes. Verisium protocol (N02)' },
];
const KITAVA_IDX = 12; // M13
const PACE_NAMES = { t6: '6h stretch', t7: '7h realistic', t8: '8h fallback' };

const STOPS = {
  1: { title: 'Stop 1 at A2 town: Absolution links + minion wand + gambler', todo: ['Absolution 3–4L, Desecrate + Flesh Offering', 'Essence/alch a minion wand (Fear essence = minion damage)', 'Mid-campaign gambler for any empty res slot (cheaper in 3.30)'] },
  2: { title: 'Stop 2 at A3: Raise Spectre + first spectres', todo: ['Raise Spectre (Gravicious reward): Flame Sentinel / Carnage Chieftain', 'Library gems: Feeding Frenzy, Haste, Convocation, Phys to Lightning', '4-link recipe if needed'] },
  3: { title: 'Stop 3 at A6 town: re-cap after Kitava', todo: ['Re-cap res from pieces already in your bag', 'Pantheon: Brine King'] },
  4: { title: 'Stop 4 after A10 Kitava: re-cap for −60', todo: ['Re-cap res for −60', 'Merciless lab (skip if tired)', 'Map-entry gate check (Defense panel)'] },
};
const STOP_BUDGET = { t6: 4, t7: 12, t8: 15 };

/* Defensive gates (§4.2). ehp + pool: per bar (standard = Occultist, relaxed = minion/Necro). */
const GATES = [
  { id: 'G01', band: 'T1–5',   name: 'Map entry', minTier: 1,  fateCap: 1, overcap: false, chaos: 0,  pool: { standard: 3200, melee: 3200, relaxed: 3000 }, pmh: 0,     ehp: { standard: 0, melee: 0, relaxed: 0 },             block: 0 },
  { id: 'G02', band: 'T6–10',  name: 'T6+',       minTier: 6,  fateCap: 2, overcap: true,  chaos: 30, pool: { standard: 4500, melee: 4500, relaxed: 4000 }, pmh: 6000,  ehp: { standard: 0, melee: 0, relaxed: 0 },             block: 0 },
  { id: 'G03', band: 'T11–14', name: 'T11+',      minTier: 11, fateCap: 3, overcap: true,  chaos: 60, pool: { standard: 6000, melee: 6000, relaxed: 5000 }, pmh: 0,     ehp: { standard: 60000, melee: 115000, relaxed: 51000 }, block: 50 },
  { id: 'G04', band: 'T15+ / Legion / 3-Fate red', name: 'T15', minTier: 15, fateCap: 3, overcap: false, chaos: 75, pool: { standard: 7000, melee: 7000, relaxed: 5500 }, pmh: 10000, ehp: { standard: 100000, melee: 115000, relaxed: 51000 }, block: 0 },
];
// Endgame bar used for Grim Fates (F03).
const ENDGAME_EHP = { standard: 115000, melee: 115000, relaxed: 51000 };

const BUILDS = [
  { name: 'Spectre Necromancer', bar: 'relaxed', spellBlock: true },
  { name: 'ED Occultist', bar: 'standard', spellBlock: true },
  { name: 'PRAW Necromancer', bar: 'relaxed' },
  { name: 'Boneshatter Juggernaut', bar: 'melee' },
  { name: 'Cyclone Slayer', bar: 'melee' },
  { name: 'EQ Gladiator', bar: 'melee' },
  { name: 'Storm Burst Hierophant (dropped)', bar: 'relaxed' },
  { name: 'EA Champion (dropped)', bar: 'relaxed' },
  { name: 'Shield Crush Slayer', bar: 'melee' },
  { name: 'Saboteur miner', bar: 'standard' },
  { name: 'Other', bar: 'standard' },
];

/* Quick events: label shown in autocomplete -> trigger ids + state effect. */
const EVENTS = [
  { label: 'Death (character died)',              ids: ['E02'], fx: 'death', quick: 'Death' },
  { label: 'Near-death (flasks empty / pool < 30%)', ids: ['E01'], fx: 'near', quick: 'Near-death' },
  { label: 'Reached white maps (T1)',              ids: ['G01'], fx: 'band1' },
  { label: 'Reached T6',                           ids: ['G02'], fx: 'band6', quick: 'Reached T6' },
  { label: 'Reached T11',                          ids: ['G03'], fx: 'band11', quick: 'Reached T11' },
  { label: 'Reached T15',                          ids: ['G04'], fx: 'band15', quick: 'Reached T15' },
  { label: 'Reached level 68',                     ids: ['S04'], fx: 'lvl68' },
  { label: 'Atlas opened',                         ids: ['T01', 'N13'] },
  { label: 'Second map-device slot unlocked',      ids: ['T02'] },
  { label: 'New Fate seen: ',                      ids: ['F05'] },
  { label: 'PoB 3.30 data released',               ids: ['I05', 'H04'] },
  { label: 'Hotfix touching Raise Spectre/Absolution/minions or ED/Occultist', ids: ['I02', 'H04'] },
  { label: 'Verisium Outcrop found', ids: ['N02'], quick: 'Verisium' },
  { label: 'Frostbearer captured', ids: ['N01'], quick: 'Frostbearer!' },
  { label: 'Spectre swap check (Frostbearers / eff. level / count)', ids: ['N12'] },
  { label: 'No Frostbearers by T11', ids: ['N11'] },
  { label: 'Nothing works (Necro + Occultist failing)', ids: ['H05'] },
  { label: 'poedb drop source found: ',            ids: ['I01'] },
  { label: 'Deadly Fate / OP Viscera report (2+ sources)', ids: ['I04'] },
  { label: "Smuggler's Cache maps identified",    ids: ['I06'] },
];

/* Extra aliases for fuzzy matching typed text to trigger ids (whole-word match after normalising). */
const ALIASES = {
  D01: ['cane of unravelling', 'cane of unraveling', 'cane'],
  D02: ['seething fury'],
  D03: ['animate weapon of ranged arms', 'awora', 'ranged arms', 'praw gem'],
  D04: ['storm burst of repulsion', 'sb of repulsion', 'sbor'],
  D05: ['sword of ages', 'the sword of ages'],
  D06: ['750 pdps staff', '750 pdps'],
  D07: ['dyadian dawn', 'dyadian'],
  D08: ['allelopathy'],
  D09: ['artillery quiver'],
  D10: ['orb of chance', 'chance orb'],
  D11: ['fugitive boots', 'apothecary s gloves', 'apothecarys gloves', 'two toned boots'],
  D12: ['matching rares', 'same name rares', 'matching name rares'],
  E01: ['near death', 'close call'],
  E02: ['death', 'died', 'rip', 'dead'],
  F05: ['new fate', 'fate seen'],
  I05: ['pob 3 30'],
  T01: ['atlas opened'],
  N01: ['forged frostbearer', 'frostbearer', 'frostbearers', 'frost bearer', 'frost bearers'],
  N02: ['verisium', 'verisium outcrop', 'verisium ore'],
  N03: ['raise spectre 21', 'vaal raise spectre', 'level 21 raise spectre', '21 raise spectre', 'spectre gem 21'],
  N04: ['bones of ullr', 'bones of uller'],
  N05: ['minion wand', 'minion shield', 'minion helmet', 'minion helm', '1 minion', '2 minion'],
  N06: ['jinxed juju'],
  N07: ['darkness enthroned'],
  N08: ['dark monarch'],
  N09: ['femurs of the saints', 'femurs'],
  N10: ['ghastly eye', 'bone ring', 'bone helmet'],
};

/* Suggestions shown in the drop field besides the trigger items. */
const DROP_SUGGEST = ['Forged Frostbearer captured', 'Bones of Ullr', 'The Jinxed Juju', 'Darkness Enthroned', 'The Dark Monarch', 'Femurs of the Saints', 'Raise Spectre 21', '+1 minion wand', '+1 minion shield', '+2 minion helmet', 'Ghastly Eye Jewel', 'Bone Ring', 'Cane of Unravelling', 'Animate Weapon of Ranged Arms', 'The Sword of Ages', 'Staff 750+ pDPS', 'Seething Fury', 'Allelopathy', 'Orb of Chance', 'Fugitive Boots', "Apothecary's Gloves", 'Two-Toned Boots', 'Matching-name rare pair', 'Replica Stampede'];

/* Weekday chunks (§2.3). mins = typical length. */
const CHUNKS = {
  W1: { title: 'Run 3 maps in your current Shaped Region', mins: 30, short: 'Run 1–2 maps in your Shaped Region', shortMins: 15, repeat: true },
  W2: { title: 'Whakano: buy/reroll contracts, run 1 contract', mins: 25 },
  W3: { title: 'Sort the Betrayal board for the next intervention (Rin for Threads)', mins: 10 },
  W4: { title: 'Harvest res-swap craft (300 + 300 lifeforce)', mins: 10 },
  W5: { title: 'Essence craft a good base missing res/life', mins: 15 },
  W6: { title: 'Vendor recipes: same-name rare pairs → Chaos (3 → Exalt)', mins: 5 },
  W7: { title: 'Gear audit: send a pobb.in link for a headless PoB check vs next gate', mins: 15 },
  W8: { title: 'One map boss with 1 Fate (only if gate met)', mins: 15 },
  W9: { title: 'News check: poe.ninja HC SSF + poedb digest; react to triggers', mins: 10 },
  W10: { title: 'Level death-insurance gems in weapon swap', mins: 5 },
  W11: { title: 'Verisium hunt: 3 maps, channel every Verisium fully, check cold waves', mins: 30, short: 'Verisium hunt: 1–2 low maps', shortMins: 15, repeat: true },
  W12: { title: 'Spectre level audit: eff. Raise Spectre level, spectre count, +levels still open', mins: 10 },
  W13: { title: 'Abyss Thread map for Ghastly Eye jewels / Darkness Enthroned base', mins: 15 },
};
