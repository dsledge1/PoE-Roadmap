# Making your PoB compatible

The tracker reads your Path of Building (PoB) build and shows, for every stage of the game, the links you should be running and a closeup of the passive tree. It decides which skill set and which tree belong to which stage **from their titles**. Name things the way this guide describes and every stage maps by itself. You can always fix the mapping by hand afterwards (**Links & tree → Import Path of Building / edit → Edit mapping + categories**).

Everything here comes straight from the importer, [`voice/pob_import.py`](../voice/pob_import.py). A complete example you can import is in [`docs/examples/example_pob.xml`](examples/example_pob.xml).

## What you can import
The PoB import accepts a **PoB export code, pobb.in or poe.ninja/pob link, or .xml file**:
- **Export code:** in PoB, Import/Export Build → Generate → Copy, then paste it in the box and press **Import PoB**.
- **Link:** `https://pobb.in/AbC123`, `pobb.in/u/name/AbC123`, or `https://poe.ninja/pob/xyz9`. The companion fetches the raw build.
- **.xml file:** **Choose .xml file** (or drop the file on the import box). PoB keeps its builds in `Documents\Path of Building\Builds\`.

Import runs in the voice companion, so open the tracker through `run.bat` (http://127.0.0.1:8765/). From a terminal you can also run `companion.py --import-pob <code | link | file.xml>`.

## The stages
The tracker has 13 stages: **Act 1 … Act 10**, **Early maps**, **Mid maps** and **Late maps**.

## Rule 1: name your trees and skill sets by stage
The same title rules apply to **skill sets** (the Skills tab's set dropdown) and **passive tree specs** (the Tree tab's dropdown). Titles are matched without case, after colour codes and `{n}` tags are removed. The first rule that matches wins:

| Title contains | Stage | Examples that work |
|---|---|---|
| An act range: `Act N-M`, `Acts N to M`, `AN-AM`, `act N through M` (N and M from 1 to 10) | Act N … Act M | `Act 4-10`, `Acts 4 to 10`, `A4-A10` |
| One act: `Act N`, `AN`, `actN` (1–10), **without** "map", "maps" or "mapping" | Act N | `Act 1`, `A3`, `act3` |
| `min-max`, `minmax`, `endgame`, `end game`, `late`, `red map(s)`, `T14`–`T17` | Late maps | `Late Umbral Army`, `Min-Max Mageblood`, `Red maps`, `T16 farming` |
| `mid`, `middle`, `yellow map(s)` | Mid maps | `Mid Dark Monarch`, `Yellow maps` |
| `early`, `white map(s)`, `mapping`, `maps`, `map start`, `lvl 7x` / `level 7x` | Early maps | `Lvl70 Early mapping`, `Early Bitterdream`, `Map start`, `Act 10 maps` |
| Only a level: `Lvl N`, `Level N` | The act you'd be in at that level: ≤12 Act 1, ≤23 Act 2, ≤33 Act 3, ≤40 Act 4, ≤45 Act 5, ≤50 Act 6, ≤55 Act 7, ≤60 Act 8, ≤64 Act 9, ≤69 Act 10, 70+ Early maps | `Lvl 30` → Act 3, `Level 50 swap` → Act 6 |
| `campaign`, `leveling`, `levelling` | Act 1 | `Leveling` |
| Anything else | Not mapped. Listed under "Not mapped by title" so you can assign it by hand | `Respec Frostbearers` |

Watch out for:
- **"a" followed by a number reads as an act.** "Get a 6 link" maps to Act 6. Write "6L" or "six link" instead.
- **"Act 10 maps" is Early maps**, because "maps" wins over the act number.
- Act numbers outside 1–10 are ignored ("Act 11"), and a range that goes past 10 ("Act 3-12") falls back to its first act.

## Rule 2: one tree per act, skill sets can cover a range
For each act, the tracker uses:
- **Skill set:** the **first** skill set (in PoB's order) whose title covers that act. A range like `Act 4-10` covers seven acts with one set.
- **Tree:** the first tree titled for that act **without** a `{n}` tag, else one with a tag.

So the usual setup is a tree per act (`Act 1` … `Act 10`) and as many or as few skill sets as you need (`Act 1`, `Act 2`, `Act 3`, `Act 4-10`). With a range set, the tracker shows the same links for every act in the range; split it into separate sets if you want different links per act.

## Rule 3: map stages use `{n}` tags to pair skill sets with trees
Map stages can have **several variants** (for example three late-game setups). Every skill set whose title maps to Early, Mid or Late maps becomes a variant of that stage, in PoB's order. The first one is the default and the tracker shows a dropdown for the rest.

Each variant finds its tree like this:
1. **The tree with the same `{n}` tag.** `Late Umbral Army {6}` pairs with the tree titled `Late {6}` (or any title containing `{6}`). This is the reliable way.
2. Otherwise, the tree in the same stage with the most similar title (words compared, level numbers ignored).
3. Otherwise, a tree in the same stage whose `Lvl N` is within 5 levels of the set's.
4. Otherwise, the first tree that has no stage at all.

The tag can go anywhere in the title and is removed from what's displayed. Acts don't need tags.

**Item sets** aren't read by the tracker yet, so a `{n}` on an item set is just for your own organisation in PoB.

## Rule 4: what happens when a stage is missing
Stages are filled in order (Act 1 → Act 10 → Early → Mid → Late):
- A stage with **no skill set and no tree** copies the stage before it (both set and tree).
- A stage with a **skill set but no tree** uses the previous stage's tree, and the other way round.
- Copied stages are marked "(inherited)" in the tracker and in the import summary.
- If Act 1 has nothing, there's nothing to copy, so it stays empty until a later stage has something.
- Skill sets and trees that matched no stage are listed as "Not mapped by title". Assign them in **Edit mapping + categories**.

For example, with trees for Act 1, Act 2 and Act 5 only, Acts 3 and 4 show the Act 2 tree and Acts 6–10 show the Act 5 tree. A Mid maps stage with no set of its own shows Early maps.

## Rule 5: socket groups, section headers and categories
Inside each skill set, every socket group becomes a link card in one of seven categories: **main attack, movement, utility, auras, curse, minions, other**.

**Section headers.** A socket group with **no gems** whose label starts with `=` is a header. It sets the category for the groups under it until the next header. Headers never become cards:

| Header text contains | Category |
|---|---|
| `main` | Main attack |
| `utility`, `utilities` | Utility |
| `aura`, `auras`, `reserv` | Auras |
| `curse`, `curses`, `hex` | Curse |
| `spectre`, `spectres`, `minion`, `minions`, `zombie`, `golem` | Minions |
| `movement`, `mobility` | Movement |
| Anything else (e.g. `==== Misc ====`) | Ends the section: groups below are sorted by their gems |

So `==== Main Skills ====`, `==== Utility ====`, `==== Auras ====` and `==== Support Spectres ====` all work. An empty group with no label is a spacer and is skipped.

**Labels beat headers.** A word in the group's own label wins over the section it sits in:
| Label contains | Category |
|---|---|
| `mobility`, `movement`, `move`, `dash`, `blink`, `leap`, `charge`, `travel` | Movement |
| `main dmg`, `main damage`, `main skill`, `main attack`, `main`, `dmg` | Main attack (a group of only minion gems needs "dmg" or "damage" in the label for this) |
| `aura(s)`, `herald(s)` | Auras |
| `curse(s)`, `hex` | Curse |
| `guard`, `trigger`, `utility`, `extra(s)`, `offering` | Utility |

A note that says the group replaces your main skill ("replace SRS after Merveil", "instead of Absolution") also makes it main attack, as does a label with "before minions".

**No label, no header.** The gems decide: a movement, aura or curse gem first makes it that category; a damage skill is a main attack candidate; only minion gems is minions. If a skill set ends up with no main attack, its biggest damage group becomes main and the other damage groups become "other".

You can change any card's category in **Edit mapping + categories**.

## Rule 6: notes and link counts in labels
Socket group labels can carry two extras:
- **A leading link count**, like `3L`, `4L`, `6L`, `5-6L` or `3S`, shows as a badge on the card.
- **A note in brackets at the end**, like `(until you get SRS)`, shows in gold under the card title and is read out when you ask for your links by voice.

`^63L Lvl 12 Absolution (Replace SRS after Merveil)` becomes a card named "Lvl 12 Absolution" with a `3L` badge and the note "Replace SRS after Merveil". A label with nothing left after that uses the first gem's name.

Within a card, active gems come first in PoB's order, then supports. Gems you've disabled in PoB stay on the card, struck through. Gem colours come from PoB's gem data.

## Rule 7: colour codes are stripped
PoB colour codes (`^0`–`^9` and `^xRRGGBB`) are removed from every title and label before matching, so `^6Act 1` is "Act 1" and `^xE05030MAIN DMG SRS` is "MAIN DMG SRS". Colour your PoB however you like.

## Worked example
[`docs/examples/example_pob.xml`](examples/example_pob.xml) is a small made-up build:

| In PoB | Title | Maps to |
|---|---|---|
| Skill set | `^6Act 1` | Act 1 |
| Skill set | `^6Act 2` | Act 2 |
| Skill set | `^6Act 3-10` | Acts 3–10 |
| Skill set | `^5Early maps {1}` | Early maps, paired with tree `{1}` |
| Skill set | `^5Late maps {2}` | Late maps, paired with tree `{2}` |
| Tree | `Act 1`, `Act 2`, `Act 5` | Acts 1, 2 and 5 |
| Tree | `^2Early {1}`, `^1Late {2}` | Early and Late maps |

The import summary (also printed by `python voice/pob_import.py docs/examples/example_pob.xml`):
```
Necromancer (PoB): 5 skill sets, 5 trees (tree 3_29).
  A1  Act 1 / tree 'Act 1'
  A2  Act 2 / tree 'Act 2'
  A3  Act 3-10 / tree 'Act 2' (inherited)
  A4  Act 3-10 / tree 'Act 2' (inherited)
  A5  Act 3-10 / tree 'Act 5'
  A6  Act 3-10 / tree 'Act 5' (inherited)
  ...
  A10 Act 3-10 / tree 'Act 5' (inherited)
  EM  Early maps / tree 'Early'
  MM  Early maps / tree 'Early' (inherited)
  LM  Late maps / tree 'Late'
```

Inside the `Act 1` skill set:
```
==== Main Skills ====                        header: following groups are main attack
3L Rolling Magma (until you get SRS)         card "Rolling Magma", 3L badge, note "until you get SRS"   → main attack
^xE05030MAIN DMG SRS                         card "MAIN DMG SRS"                                         → main attack
(empty group)                                spacer, skipped
==== Utility ====                            header: following groups are utility
Mobility          [Flame Dash]               label says "mobility"                                       → movement
Flesh offering    [Flesh Offering]           section                                                     → utility
```
And in `Act 3-10`, the `==== Support Spectres ====` header puts the spectre group under minions.

## Checklist
- [ ] A tree per act titled `Act 1` … `Act 10` (or fewer; missing acts copy the one before).
- [ ] Skill sets titled `Act N` or a range like `Act 4-10`, in act order.
- [ ] Map skill sets titled with `Early`, `Mid` or `Late` (or `Min-Max`, `Endgame`), each with a `{n}` tag that matches its tree.
- [ ] `==== Section ====` headers (gem-less groups) to group your links, and labels like `Mobility` or `MAIN DMG` where it matters.
- [ ] Notes in brackets at the end of labels.
- [ ] No "a 6 link"-style wording in titles.

After importing, check the summary under the import box, then fix anything left in "Not mapped by title" with **Edit mapping + categories**. **Export build config** saves your fixed mapping as `.json`, and **Export profile** saves it together with your drop and event types and Power Chase list.
