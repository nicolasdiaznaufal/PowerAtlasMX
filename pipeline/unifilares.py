"""Index of the CENACE single-line diagrams (Mod Gral Planeacion 2020-2025, PDF drawings, April 2021).
The drawings are vector art: only text per page is indexed (substation names appear in it); the zone title is detected on ~1/3 of pages,
so search by NAME with unifilar_pages(). Topology is from 2021 (before the 2028 short-circuit study): use for substation layout only.
Run: .venv/bin/python pipeline/unifilares.py -> data/ref/cenace/unifilares_index.csv"""
import csv
import re
import subprocess
import sys
from pathlib import Path

from norm_name import norm_name

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "data/raw/cenace/Mod Gral Planeación 2020-2025 Diagramas Unifilares RNT y RGD del MEM.pdf"
IDX = ROOT / "data/ref/cenace/unifilares_index.csv"
GER = re.compile(r"(Central|Oriental|Occidental|Noroeste|Norte|Noreste|Baja California|Peninsular)", re.I)


def build():
    n = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", str(PDF)], capture_output=True, text=True).stdout).group(1))
    rows = []
    for p in range(1, n + 1):
        t = subprocess.run(["pdftotext", "-f", str(p), "-l", str(p), str(PDF), "-"], capture_output=True, text=True).stdout
        lines = [l.strip() for l in t.splitlines() if l.strip()]
        zona = next((l for l in lines if re.match(r"^(Zona|Área|Area)\s", l, re.I)), "")
        ger = next((m.group(1).title() for l in lines[:25] if (m := re.search(r"Gerencia.*?" + GER.pattern, l, re.I))), "")
        names = sorted({norm_name(l, True) for l in lines if re.search(r"[A-Za-zÁÉÍÓÚÑ]{3}", l) and not re.fullmatch(r"[\d.\sx]+", l)})
        rows.append({"page": p, "gerencia": ger, "zona": zona, "text": "|".join(x for x in names if x)})
    with open(IDX, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["page", "gerencia", "zona", "text"])
        w.writeheader()
        w.writerows(rows)
    return rows


def unifilar_pages(nombre):
    """pages whose text contains the normalised substation name (whole-token match)."""
    k = norm_name(nombre, True)
    if not k:
        return []
    pat = re.compile(r"(^|[| ])" + re.escape(k) + r"($|[| ])")
    return [int(r["page"]) for r in csv.DictReader(open(IDX, encoding="utf-8")) if pat.search(r["text"])]


if __name__ == "__main__":
    if len(sys.argv) > 1:
        print(unifilar_pages(" ".join(sys.argv[1:])))
    else:
        r = build()
        print(len(r), "pages;", sum(1 for x in r if x["zona"]), "with zone title;", sum(1 for x in r if x["gerencia"]), "with gerencia")
