"""CENACE "Niveles de cortocircuito RNT 2028" (PDF) -> data/ref/cenace/cortocircuito_2028.csv.
Row: NAME  ACR-KV  kV  Icc3F_min Icc1F_min Zth+_min Zth0_min  Icc3F_max Icc1F_max Zth+_max Zth0_max. Region from the page header.
Run: .venv/bin/python pipeline/cc_parse.py   (needs pdftotext). Prints counts per region against the document's own totals."""
import csv
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "data/raw/cenace/Niveles de cortocircuito RNT 2028 v2025.pdf"
OUT = ROOT / "data/ref/cenace/cortocircuito_2028.csv"
Z = r"(-?[\d,]*\d\.\d{3}[+-]j-?[\d,]*\d\.\d{3})"
N = r"(\d+(?:\.\d+)?)"
K = r"(\d+\.\d{2})"
ROW = re.compile(rf"^\s*(.+?)(?:\s{{2,}}|(?<=\.V\.)|\s(?=[A-Z]{{3}}-[A-Z]{{3}}\s))([A-Z0-9Ñ&_.]{{2,8}}(?:-[A-Z0-9_]{{1,6}}(?: \d+)?| \d+\.\d)?)\s+{N}\s+{K}\s+{K}\s+{Z}\s*{Z}\s*{K}\s+{K}\s+{Z}\s*{Z}\s*$")
REGION = re.compile(r"Gerencia de Control Regional\s+(Central|Oriental|Occidental|Noroeste|Norte|Noreste|Baja California|Peninsular)", re.I)
EXPECT = {"Peninsular": 160, "Baja California": 199, "Noroeste": 299, "Norte": 339, "Central": 365, "Noreste": 599, "Oriental": 709, "Occidental": 761}


def cplx(s):
    a, b = s.replace(",", "").split("j")
    return complex(float(a.rstrip("+-")) * (1 if True else 0), float(b) * (-1 if a.endswith("-") else 1))


def parse():
    txt = subprocess.run(["pdftotext", "-layout", str(PDF), "-"], capture_output=True, text=True, check=True).stdout
    rows, region, bad = [], None, []
    for ln in txt.splitlines():
        m = REGION.search(ln)
        if m and len(ln.strip()) < 80:
            region = m.group(1).title()
        r = ROW.match(ln)
        if r and region:
            g = r.groups()
            z = [cplx(x) for x in (g[5], g[6], g[9], g[10])]
            rows.append({"name": g[0].strip(), "acr_kv": g[1], "kv": float(g[2]), "region": region,
                         "icc3f_min": float(g[3]), "icc1f_min": float(g[4]), "zth1_min": z[0], "zth0_min": z[1],
                         "icc3f_max": float(g[7]), "icc1f_max": float(g[8]), "zth1_max": z[2], "zth0_max": z[3]})
        elif re.search(r"[A-Z]{2,6}-\d+\s+\d+\.\d", ln) and "j" in ln:
            bad.append(ln.strip())
    return rows, bad


def main():
    rows, bad = parse()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    cnt = {}
    for r in rows:
        cnt[r["region"]] = cnt.get(r["region"], 0) + 1
    print(len(rows), "rows;", len(bad), "lines with the pattern but not parsed")
    for k, v in EXPECT.items():
        print(f"  {k:16s} {cnt.get(k, 0):4d} / {v}")
    (ROOT / "data/ref/cenace/cc_unparsed.txt").write_text("\n".join(bad))


if __name__ == "__main__":
    main()
