#!/usr/bin/env python3
"""Rebuild voice/poe_names.json from official Path of Exile data.

Sources, in order:
  1. GGG trade API (https://www.pathofexile.com/api/trade/data/items and
     /api/trade/data/static) — complete live unique, gem, card and currency names.
     Until the 3.30 realm patch this is the 3.29.x catalog.
  2. Official 3.30 item-filter post (Natalia_GGG, 12 Nov 2026) — new, renamed
     and removed names: Threads, Viscera, new currency, two new gems, etc.
  3. PoEDB Covens unique list (https://poedb.tw/us/Covens_uniques) — the five
     of eleven 3.30 uniques that have been named so far.
  4. Announced Fate names from GGG's 3.30 preview (full Fate list is not
     datamined yet).

Usage:
  python build_names.py              # fetch and write poe_names.json here
  python build_names.py --offline    # rebuild from cached /tmp or existing json inputs
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "poe_names.json"
TRADE_ITEMS = "https://www.pathofexile.com/api/trade/data/items"
TRADE_STATIC = "https://www.pathofexile.com/api/trade/data/static"
UA = "PoE330VoiceCompanion/1.0 (local tracker; name dictionary rebuild)"

# --------------------------------------------------------------------------------------------
# Official 3.30 overlay (GGG item-filter post, 2026-11-12)
# --------------------------------------------------------------------------------------------
NEW_330 = {
    "unique": [
        "Hide of the Vendigo",
        "The Sword of Ages",
        "Putrid Seed",
        "The Covetous Dark",
        "Dreadmaidens' Sacrament",
    ],
    "gem": [
        "Arcane Link",
        "Fireball of Radiation",
    ],
    "currency": [
        "Essence of Trickery",
        "Frayed Thread",
        "Royal Visage",
        "Allflame Ember of the Cloister",
        "Allflame Ember of the Multitude",
        "Allflame Ember of the Divine",
        "Soul Core of Instability",
        "Immortal Astrolabe",
        "Feral Astrolabe",
        "Royal Astrolabe",
        "Cryptic Astrolabe",
        "Afarud Enshrouding Crystal",
        "Maven's Chisel of Threads",  # renamed from Maven's Chisel of Scarabs
        "Threaded Delirium Orb",      # renamed from Skittering Delirium Orb
        "Soul Core of Intellect",     # renamed from Coin of Knowledge
        "Soul Core of Might",         # renamed from Coin of Power
        "Soul Core of Finesse",       # renamed from Coin of Skill
    ],
    "thread": [
        "Expedition Thread",
        "Abyss Thread",
        "Breach Thread",
        "Ritual Thread",
        "Ultimatum Thread",
        "Legion Thread",
        "Blight Thread",
        "Bestiary Thread",
        "Betrayal Thread",
        "Incursion Thread",
    ],
    "fragment": [
        "Cursed Poppet",
    ],
    "base": [
        "Mycelium Core",
        "Enshrouded Quiver",
    ],
    # Announced Fate / Grim Fate names only — GGG has not published a full list.
    "fate": [
        "Doomsayer",
        "Incandescent",
        "Wildfire",
        "Crowkeeper",
        "The Awakened",
        "The Collector",
        "The Emissary",
    ],
}

# Viscera (GGG item-filter post). Generic names; the matcher treats this kind conservatively.
VISCERA_330 = [
    "Scorched Arm", "Severed Rhoa Head", "Sea Witch's Tentacle", "Crustacean's Claw",
    "Totemic Visage", "Skeletal Archer's Arm", "Skeletal Warrior's Leg", "Warden's Arm",
    "Goatman's Horn", "Mariner's Tricorne", "Elemental Essence", "Galvanic Tentacle",
    "Siren's Tentacle", "Cutthroat's Head", "Golemic Stone", "Gargantuan Claws",
    "Hollowed Skull", "Bonestalker's Ribcage", "Templar Skull", "Arachnid Fangs",
    "Severed Stinger", "Bandit Rogue's Head", "Poacher's Leg", "Cobra Tail",
    "Bandit Witch's Head", "Arachnid Leg", "Vaal Appendage", "Bandit Warrior's Head",
    "Primate Foot", "Ursine Flesh", "Artificial Appendage", "Severed Scythe-hand",
    "Captain's Leg", "Spined Claws", "Molten Core", "Defaced Bust", "Spectral Hood",
    "Soldier's Head", "Flaming Ribbon", "Statue Leg", "Voidbearer's Leg",
    "Voltaic Apparatus", "General's Head", "Brute's Arm", "Thaumaturge's Head",
    "Spiked Carapace", "Skeletal Beast Leg", "Scholar's Arm", "Aristocrat's Torso",
    "Despot's Fist", "Vulture's Gut", "Templar Banner", "Pocked Leg", "Pocked Arm",
    "Flesh-fused Lantern", "Carved Haunches", "Blazing Skull", "Gladiator's Heart",
    "Swordmaster's Blade", "Chitinous Leg", "Engorged Eye", "Corrupted Carapace",
    "Vendigo Claws", "Overseer's Whip", "Justicar's Helm", "Flaming Furnace",
    "Adherent's Crown", "Heretical Tome", "Hallowed Descry", "Skeletal Tail",
    "Scholar's Leg", "Ravenous Skull", "Noble's Head", "Conjoined Hound Head",
    "Scout's Bow", "Ancestor's Club", "Skeleton Wheel", "Osseous Talon",
    "Flayed Visage", "Bear Head", "Boar Head", "Stag Head", "Arachnid Egg Sac",
    "Infested Torso", "King Crab's Claw", "Calcified Leg", "Wraith Claws",
    "Infected Leg", "Inquisitor's Claw", "Necromancer's Mask", "Ornate Torso",
    "Devourer's Antenna", "Blackened Lungs", "Construct's Head", "Spider Queen's Head",
    "Dessicated Head", "Hag's Stomach", "Ghostly Claw", "Terrifying Maw",
    "Armoured Leg", "Blackguard's Leg", "Champion's Banner", "Lunar Bow",
    "Golden Ankh", "Gemling Torso", "Scarecrow's Pitchfork", "Charred Leg",
    "Sun-bleached Breastplate", "Resplendent Sceptre", "Solar Shield", "Crescent Blade",
    "Smuggler's Hand", "Coagulated Essence", "Gelid Fangs", "Desert Sword",
    "Scorpion Stinger", "Lithic Haunches", "Chimeral Eye", "Chaos Golem's Core",
    "Desert Queen's Crown", "Voltaic Skull", "Flayed Arm", "Inquisitor's Head",
    "Witch's Head", "Hag's Head", "Diseased Wing", "Bloodied Arm", "Prosthetic Leg",
    "Distended Stomach", "Smouldering Leg", "Broken Bust", "Osseous Scythe",
    "Flaming Goat Hoof", "Maven's Orrery", "Sirus' Head", "Incarnation of Dread's Head",
    "Incarnation of Neglect's Cube", "Incarnation of Fear's Head",
    "Searing Exarch's Descry", "Eater of Worlds' Head", "Elder's Head", "Shaper's Head",
    "Venarius' Scripture", "Minotaur's Head", "Hydra's Head", "Chimera's Head",
    "Phoenix's Head", "Constrictor's Head", "Purifier's Head", "Enslaver's Head",
    "Eradicator's Head", "Baran's Head", "Veritania's Head", "Drox's Head",
    "Al-Hezmin's Head", "Pit Fighter's Helm", "Lion's Claws", "Bat's Wings",
    "Nightmarish Book of Depravity", "Nightmarish Head of Uhtred",
    "Nightmarish Core of the Unbreakable", "Nightmarish Wings of Lycia",
    "Nightmarish Wings of Catarina", "Coven Queen's Crown",
    # Greater pinnacle viscera mentioned in the 3.30 preview
    "Greater Sirus' Head",
]

RENAMES_330 = {
    "Maven's Chisel of Scarabs": "Maven's Chisel of Threads",
    "Skittering Delirium Orb": "Threaded Delirium Orb",
    "Coin of Knowledge": "Soul Core of Intellect",
    "Coin of Power": "Soul Core of Might",
    "Coin of Skill": "Soul Core of Finesse",
}

# Removed in 3.30 (scarabs, vials, a handful of cards, old coins/astrolabes).
# Cards stay in the dictionary so already-tuned phrases like "Her Mask card" still
# resolve; everything else on this list is dropped.
REMOVED_KEEP_CARDS = {
    "Last Hope", "Her Mask", "Sambodhi's Vow", "Buried Treasure",
    "More is Never Enough", "The Deal", "Cameria's Cut", "The Card Sharp",
    "The Rabbit's Foot", "Man With Bear", "The Silly Boy",
}
REMOVED_DROP = {
    "Fragmented Delirium Orb", "Orb of Binding",
    "Vial of Dominance", "Vial of Summoning", "Vial of Awakening", "Vial of the Ritual",
    "Vial of Fate", "Vial of Consequence", "Vial of the Ghost", "Vial of Transcendence",
    "Vial of Sacrifice",
    "Mortal Rage", "Mortal Hope", "Mortal Ignorance", "Mortal Grief", "Mortal Set",
    "Coin of Restoration", "Coin of Desecration",
    "Templar Astrolabe", "Fruiting Astrolabe", "Deceptive Astrolabe", "Prospecting Astrolabe",
    "Sacrifice at Midnight", "Sacrifice at Dawn", "Sacrifice at Noon", "Sacrifice at Dusk",
}

# Common Whisper mishearings / spacing variants. Stored on the item so the parser
# does not have to guess them at runtime.
WHISPER_ALIASES = {
    "The Porcupine": ["porky pine", "porkypine", "porcupyne", "porcu pine", "porcupine"],
    "Mageblood": ["mage blood", "maj blood", "mageblood belt"],
    "Headhunter": ["head hunter", "head hunter belt"],
    "House of Mirrors": ["house of mirror", "house of mirors", "house of miror"],
    "The Apothecary": ["apothecary", "the apothacary", "apothacary", "apothecary card"],
    "Ashes of the Stars": ["ashes of stars", "ashes of the star", "ash of the stars"],
    "Bones of Ullr": ["bones of uller", "bones of ullr", "bones of oolar", "bones of ula"],
    "Darkness Enthroned": ["darkness and throned", "darkness in throned"],
    "Empower Support": ["empower", "empower gem", "empower support"],
    "Enhance Support": ["enhance", "enhance gem", "enhance support"],
    "Enlighten Support": ["enlighten", "enlighten gem", "enlighten support"],
    "Arcane Surge Support": ["arcane surge", "arcane surge gem"],
    "Hide of the Vendigo": ["hide of the vendigo", "vendigo hide", "hide of vendigo"],
    "The Covetous Dark": ["covetous dark", "the covetous dark"],
    "Putrid Seed": ["putrid seed", "putrid seed jewel"],
    "Dreadmaidens' Sacrament": ["dreadmaidens sacrament", "dread maiden's sacrament", "dreadmaidens"],
    "Fireball of Radiation": ["fireball of radiation"],
    "Arcane Link": ["arcane link"],
    "Kaom's Heart": ["kaoms heart", "kaom's heart", "com's heart"],
    "Shavronne's Wrappings": ["shavronne's wrappings", "shavronnes wrappings", "chevron wrappings"],
    "Mirror of Kalandra": ["mirror of kalandra", "a mirror"],
    "Hinekora's Lock": ["hinekora's lock", "hinekoras lock", "hinekora lock"],
    "The Doctor": ["the doctor", "doctor card"],
    "The Fiend": ["the fiend", "fiend card"],
    "The Demon": ["the demon", "demon card"],
    "The Enlightened": ["the enlightened", "enlightened card"],
    "Seven Years Bad Luck": ["seven years bad luck", "7 years bad luck"],
    "Unrequited Love": ["unrequited love"],
    "Belly of the Beast": ["belly of the beast"],
    "Windripper": ["wind ripper", "windripper"],
    "Ralakesh's Impatience": ["ralakesh's impatience", "ralakesh impatience"],
    "Femurs of the Saints": ["femurs of the saints", "femurs of the saint"],
    "Abyss Thread": ["abyss thread"],
    "Frayed Thread": ["frayed thread", "frayed threads"],
    "Expedition Thread": ["expedition thread"],
    "Essence of Trickery": ["essence of trickery"],
    "Doomsayer": ["doomsayer", "doomsayer fate"],
    "Crowkeeper": ["crowkeeper", "crow keeper", "crowkeeper fate"],
    "Incandescent": ["incandescent fate"],
    "Wildfire": ["wildfire fate"],  # bare "wildfire" is also a unique jewel
    "The Sword of Ages": ["sword of ages", "the sword of ages"],
}

# Static-data groups worth keeping (currency and common league items).
STATIC_KEEP = {
    "Currency", "Fragments", "Ducats", "EnshroudingCrystals", "Keepers",
    "AllflameEmbers", "Runegrafts", "Expedition", "DeliriumOrbs", "Catalysts",
    "Oils", "Delve", "Essences", "Cards",
}

JUNK_NAME = re.compile(
    r"^\d+$| piece$| net$|^simple |^reinforced |^strong |^thaumaturgical net|^necromancy net",
    re.I,
)


def fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


# "The X" remainder is only auto-aliased when it is distinctive. Short or common
# words ("Doctor", "Awakened") are too easy to false-positive.
_SKIP_THE_STRIP = {
    "awakened", "doctor", "demon", "lover", "twins", "union", "scholar", "hermit",
    "gambler", "hoarder", "fiend", "enlightened", "wrath", "inventor", "survivalist",
    "collector", "emissary", "fallen", "forgotten", "bargain", "offering", "trial",
    "tower", "poet", "fool", "damned", "one", "end", "sun", "moon", "star", "void",
    "mirror", "gold", "hope", "dream", "light", "darkness", "cat", "wolf", "bear",
    "lion", "witch", "queen", "king", "lord", "lady", "soul", "heart", "mind",
}


def add(bucket: dict, name: str, kind: str, aliases: list | None = None, **extra):
    name = (name or "").strip()
    if not name or JUNK_NAME.search(name):
        return
    if name in RENAMES_330:
        name = RENAMES_330[name]
    if name in REMOVED_DROP:
        return
    key = (name.lower(), kind)
    rec = bucket.get(key)
    if rec is None:
        rec = {"name": name, "kind": kind}
        if extra:
            rec.update(extra)
        bucket[key] = rec
    if aliases:
        rec.setdefault("aliases", [])
        for a in aliases:
            a = (a or "").strip()
            if a and a.lower() != name.lower() and a not in rec["aliases"]:
                rec["aliases"].append(a)
    if name in REMOVED_KEEP_CARDS:
        rec["retired"] = True


def unique_aliases(name: str) -> list[str]:
    out = []
    if name.lower().startswith("the "):
        rest = name[4:]
        if rest.lower() not in _SKIP_THE_STRIP and (len(rest) >= 8 or " " in rest):
            out.append(rest)
    if name.endswith(" Support"):
        out.append(name[: -len(" Support")])
    return out


def from_trade_items(data: dict, bucket: dict) -> None:
    for cat in data.get("result") or []:
        cid = cat.get("id")
        for e in cat.get("entries") or []:
            flags = e.get("flags") or {}
            if flags.get("unique") and e.get("name"):
                if e.get("disc") == "legacy" and e["name"].lower() in bucket:
                    continue
                add(bucket, e["name"], "unique", unique_aliases(e["name"]))
            elif cid == "card" and e.get("type"):
                add(bucket, e["type"], "divcard", unique_aliases(e["type"]))
            elif cid == "gem" and e.get("type"):
                add(bucket, e["type"], "gem", unique_aliases(e["type"]))


def from_trade_static(data: dict, bucket: dict) -> None:
    for cat in data.get("result") or []:
        cid = cat.get("id")
        if cid not in STATIC_KEEP:
            continue
        kind = {
            "Cards": "divcard",
            "Fragments": "fragment",
            "Essences": "currency",
            "Currency": "currency",
            "Oils": "currency",
            "Delve": "currency",
            "Catalysts": "currency",
            "DeliriumOrbs": "currency",
            "Expedition": "currency",
            "AllflameEmbers": "currency",
            "EnshroudingCrystals": "currency",
            "Keepers": "currency",
            "Runegrafts": "currency",
            "Ducats": "currency",
        }[cid]
        for e in cat.get("entries") or []:
            name = e.get("text") or ""
            if name.lower() in {"maps", "low-tier contracts"} or name.startswith(" "):
                continue
            if "Scarab" in name or "scarab" in name:
                continue
            add(bucket, name, kind, unique_aliases(name))


def apply_330(bucket: dict) -> None:
    for kind, names in NEW_330.items():
        for n in names:
            add(bucket, n, kind, unique_aliases(n) + WHISPER_ALIASES.get(n, []))
    for n in VISCERA_330:
        add(bucket, n, "viscera", unique_aliases(n))
    # Attach curated whisper aliases to every existing record of that name.
    # Never invent a new item (that would mis-type cards such as The Porcupine).
    for canon, aliases in WHISPER_ALIASES.items():
        matches = [rec for (n, _k), rec in list(bucket.items()) if n == canon.lower()]
        if not matches:
            continue
        for rec in matches:
            add(bucket, rec["name"], rec["kind"], aliases)


def build(items: dict, static: dict) -> dict:
    bucket: dict = {}
    from_trade_items(items, bucket)
    from_trade_static(static, bucket)
    apply_330(bucket)
    records = sorted(bucket.values(), key=lambda r: (r["kind"], r["name"].lower()))
    counts: dict[str, int] = {}
    for r in records:
        counts[r["kind"]] = counts.get(r["kind"], 0) + 1
    return {
        "version": "3.29.x-trade + 3.30-filter-preview",
        "poe_patch": "3.30 Covens of Umbra (league launch 2026-11-13 14:00 ET)",
        "sources": [
            "GGG trade API /api/trade/data/items and /api/trade/data/static (live catalog, still 3.29.x until realm patch)",
            "Official 3.30 item-filter post, Natalia_GGG, 2026-11-12 (new/renamed/removed names)",
            "PoEDB Covens uniques (https://poedb.tw/us/Covens_uniques): 5 of 11 new uniques named",
            "Announced Fate names from the 3.30 preview (full Fate list not datamined)",
        ],
        "notes": [
            "6 of 11 new 3.30 uniques are still unnamed.",
            "Full Fate / Grim Fate list has not been datamined; only announced examples are included.",
            "Scarabs and other 3.30-removed items (except a few retired divination cards) are omitted.",
            "Regenerate after the 3.30 realm patch: python build_names.py",
        ],
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "counts": counts,
        "size": len(records),
        "items": records,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description="Rebuild poe_names.json")
    ap.add_argument("--items-json", help="pre-downloaded trade items JSON")
    ap.add_argument("--static-json", help="pre-downloaded trade static JSON")
    ap.add_argument("-o", "--output", default=str(OUT))
    a = ap.parse_args(argv)
    try:
        if a.items_json:
            items = json.loads(Path(a.items_json).read_text(encoding="utf-8"))
        else:
            print("fetching", TRADE_ITEMS, flush=True)
            items = fetch(TRADE_ITEMS)
        if a.static_json:
            static = json.loads(Path(a.static_json).read_text(encoding="utf-8"))
        else:
            print("fetching", TRADE_STATIC, flush=True)
            static = fetch(TRADE_STATIC)
    except Exception as e:
        print("fetch failed:", e, file=sys.stderr)
        return 1
    doc = build(items, static)
    path = Path(a.output)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=None, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path}  {doc['size']} names  {doc['counts']}  version={doc['version']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
