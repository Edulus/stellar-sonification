"""Verify the pipeline outputs against the build spec's acceptance criteria."""
import json
import os
import sys

for s in (sys.stdout, sys.stderr):
    try:
        s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
BS = os.path.join(HERE, "output", "bright-stars.json")
TPL = os.path.join(HERE, "output", "spectral-templates.json")

# Ground-truth seed lines from src/data/bright-stars.js (the validation set).
SEED_LINES = {
    "Sol": [(393.4,0.85,0.80,"voigt",800,"Ca II K",0.00),(486.1,0.50,0.50,"voigt",350,"Hβ",10.20),
            (516.7,0.45,0.30,"gaussian",200,"Mg I b₁",2.71),(527.0,0.40,0.25,"gaussian",150,"Fe I",0.86),
            (589.0,0.60,0.40,"voigt",400,"Na I D₁",0.00),(656.3,0.55,0.60,"voigt",380,"Hα",10.20)],
    "Sirius": [(410.2,0.60,1.40,"lorentzian",700,"Hδ",10.20),(434.0,0.75,1.70,"lorentzian",1000,"Hγ",10.20),
               (448.1,0.18,0.25,"gaussian",50,"Mg II",8.86),(486.1,0.85,2.00,"lorentzian",1250,"Hβ",10.20),
               (516.9,0.12,0.20,"gaussian",35,"Fe II",2.89),(656.3,0.80,2.20,"lorentzian",1300,"Hα",10.20)],
    "Vega": [(410.2,0.55,1.20,"lorentzian",600,"Hδ",10.20),(434.0,0.70,1.50,"lorentzian",900,"Hγ",10.20),
             (448.1,0.15,0.20,"gaussian",40,"Mg II",8.86),(486.1,0.80,1.80,"lorentzian",1100,"Hβ",10.20),
             (527.0,0.08,0.15,"gaussian",20,"Fe I",0.86),(656.3,0.75,2.00,"lorentzian",1200,"Hα",10.20)],
    "Betelgeuse": [(393.4,0.60,1.00,"voigt",550,"Ca II K",0.00),(422.7,0.80,0.60,"voigt",700,"Ca I",0.00),
                   (516.7,0.55,0.40,"gaussian",350,"Mg I b₁",2.71),(527.0,0.70,0.50,"gaussian",500,"Fe I",0.86),
                   (589.0,0.90,0.80,"voigt",900,"Na I D₁",0.00),(705.3,0.65,3.00,"gaussian",1500,"TiO γ",0.00)],
    "Arcturus": [(393.4,0.90,1.00,"voigt",950,"Ca II K",0.00),(422.7,0.70,0.50,"voigt",550,"Ca I",0.00),
                 (516.7,0.55,0.40,"gaussian",300,"Mg I b₁",2.71),(527.0,0.60,0.35,"gaussian",350,"Fe I",0.86),
                 (589.0,0.75,0.50,"voigt",600,"Na I D₁",0.00),(656.3,0.30,0.40,"voigt",200,"Hα",10.20)],
    "Rigel": [(434.0,0.55,1.80,"lorentzian",800,"Hγ",10.20),(447.1,0.25,0.80,"voigt",200,"He I",20.96),
              (486.1,0.65,2.20,"lorentzian",1000,"Hβ",10.20),(587.6,0.30,1.00,"voigt",300,"He I D₃",20.96),
              (634.7,0.20,0.40,"gaussian",100,"Si II",8.12),(656.3,0.40,2.50,"lorentzian",800,"Hα",10.20)],
}
EXPECTED_TYPES = ["O5V","O9V","B0V","B2V","B5V","B8V","B8Ia","A0V","A1V","A5V","F0V","F5V",
                  "G0V","G2V","G5V","K0V","K1.5III","K5V","M0V","M1Iab","M2V","M5V"]

passed, failed = [], []
def check(name, ok, detail=""):
    (passed if ok else failed).append(name)
    print(f"  {'✅' if ok else '❌'} {name}" + (f" — {detail}" if detail else ""))

def line_tuple(ln):
    return (ln["wl"], ln["depth"], ln["width"], ln["profile"], ln["ew"], ln["el"], ln["ep"])

# 4. Valid JSON
try:
    bright = json.load(open(BS, encoding="utf-8"))
    tpl = json.load(open(TPL, encoding="utf-8"))
    check("4. both files parse as valid JSON", True)
except Exception as e:  # noqa: BLE001
    check("4. both files parse as valid JSON", False, str(e))
    print("\nFATAL: cannot continue without valid JSON")
    sys.exit(1)

print("\n[1] Six seed stars present with exact values:")
by_name = {s["name"]: s for s in bright.values()}
for name, expected in SEED_LINES.items():
    star = by_name.get(name)
    if not star:
        check(f"1. {name} present", False, "missing")
        continue
    got = {line_tuple(l) for l in star["lines"]}
    want = {tuple(round(x, 2) if isinstance(x, float) else x for x in t) for t in expected}
    got_r = {tuple(round(x, 2) if isinstance(x, float) else x for x in t) for t in got}
    check(f"1. {name} all 7 fields x {len(expected)} lines", got_r == want,
          "" if got_r == want else f"diff: {want ^ got_r}")

print("\n[5] No HIP key collisions:")
keys = list(bright.keys())
check("5. unique keys", len(keys) == len(set(keys)), f"{len(keys)} keys")
check("5. Sol keyed non-HIP (SOL)", "SOL" in bright and bright["SOL"]["name"] == "Sol")

print("\n[2] All 22 spectral types present:")
missing = [t for t in EXPECTED_TYPES if t not in tpl]
check("2. all 22 types", not missing, f"missing: {missing}" if missing else f"{len(tpl)} present")

print("\n[3] Template EWs physically reasonable:")
def ew_of(t, el_contains):
    return max((l["ew"] for l in tpl[t]["lines"] if el_contains.lower() in l["el"].lower()), default=0)
def has(t, el_contains):
    return any(el_contains.lower() in l["el"].lower() for l in tpl[t]["lines"])

check("3. A1V Hα EW > 500", ew_of("A1V", "Hα") > 500, f"EW={ew_of('A1V','Hα')}")
check("3. A1V Hβ EW > 500", ew_of("A1V", "Hβ") > 500, f"EW={ew_of('A1V','Hβ')}")
check("3. G2V Ca II K EW > 300", ew_of("G2V", "Ca II K") > 300, f"EW={ew_of('G2V','Ca II K')}")
check("3. G2V Hα EW < 200", 0 < ew_of("G2V", "Hα") < 200, f"EW={ew_of('G2V','Hα')}")
check("3. M2V TiO present", has("M2V", "TiO"))
check("3. M2V Ca II K present", has("M2V", "Ca II K"), f"EW={ew_of('M2V','Ca II K')}")

print(f"\n{'='*60}\n{len(passed)} passed, {len(failed)} failed")
if failed:
    print("FAILED:", ", ".join(failed))
    sys.exit(1)
print("✅ ALL VERIFICATION CHECKS PASS")
