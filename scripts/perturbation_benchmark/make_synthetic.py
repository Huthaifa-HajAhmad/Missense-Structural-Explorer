"""Generate synthetic benchmark inputs with known planted effect sizes and verify analyze.py.

All synthetic inputs and outputs are written strictly inside
logs/perturbation_bench/synthetic/ and never touch real outputs.

Usage:
  uv run --python 3.12 --with numpy,pandas,scipy,scikit-learn \\
    scripts/perturbation_benchmark/make_synthetic.py --verify
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 20261118
AAS = list("ACDEFGHIKLMNPQRSTVWY")
THREEDI = list("ACDEFGHIKLMNPQRSTVWY")
EVEN_ODDS_LLR = math.log(2.0)


def generate_synthetic_dataset(out_dir: Path, seed: int = SEED) -> dict[str, float]:
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.Generator(np.random.PCG64(seed))

    n_proteins = 50
    n_per_class = 9  # 9 per class per protein => 27/protein => 1,350 variants total

    variant_rows: list[dict] = []
    am_rows: list[dict] = []
    score_rows: list[dict] = []
    emb_rows: list[dict] = []

    # Planted signal parameters on LLR (more negative = more pathogenic)
    # Normal separation d' = sqrt(2) * norm.ppf(AUROC):
    # AUROC=0.80 -> d' ~ 1.190; AUROC=0.72 -> d' ~ 0.824; AUROC=0.50 -> d' = 0.0
    # Add small protein random effect (sd=0.20) so cluster bootstrap differs meaningfully from iid.
    for p_idx in range(n_proteins):
        uid = f"P{p_idx:05d}"
        seq_len = int(rng.integers(250, 1200))
        truncated = seq_len > 1022
        prot_re_esm2 = float(rng.normal(0.0, 0.20))
        prot_re_saprot = float(rng.normal(0.0, 0.20))
        prot_re_vesm = float(rng.normal(0.0, 0.20))

        pos_pool = rng.choice(np.arange(1, min(seq_len, 1020) + 1), size=n_per_class * 3, replace=False)
        pos_idx = 0

        for cls in ["pathogenic", "benign", "gnomad_common"]:
            is_path = cls == "pathogenic"
            for _ in range(n_per_class):
                pos = int(pos_pool[pos_idx])
                pos_idx += 1
                wt, mut = rng.choice(AAS, size=2, replace=False)

                # Latent orthogonal components for AM vs ESM-2 added value
                z_shared = float(rng.normal(0.75 if is_path else 0.0, 1.0))
                z_am_only = float(rng.normal(0.85 if is_path else 0.0, 1.0))
                z_esm2_only = float(rng.normal(0.85 if is_path else 0.0, 1.0))

                # AlphaMissense in (0, 1), AUROC ~ 0.82
                am_logit = -0.7 + 0.85 * z_shared + 0.95 * z_am_only + float(rng.normal(0.0, 0.4))
                am_val = float(1.0 / (1.0 + math.exp(-am_logit)))
                am_cls = "LP" if am_val >= 0.564 else ("LB" if am_val <= 0.34 else "Amb")

                am_rows.append(
                    {
                        "uniprot_id": uid,
                        "pos": pos,
                        "wt": wt,
                        "mut": mut,
                        "am_pathogenicity": round(am_val, 4),
                        "am_class": am_cls,
                        "source": "synthetic",
                        "version": "synthetic-v1",
                    }
                )

                # ESM-2 650M: benign centered at -1.90 so all-3 <= -0.693 occurs >50% on neutral; AUROC ~ 0.81
                esm2_llr = (-1.90 - 0.85 * z_shared - 1.15 * z_esm2_only) + prot_re_esm2 + float(rng.normal(0.0, 0.40))
                # SaProt 35M AF2: AUROC ~ 0.72
                saprot_llr = (-1.85 - (0.78 if is_path else 0.0)) + prot_re_saprot + float(rng.normal(0.0, 0.95))
                # VESM-150M: null AUROC ~ 0.50
                vesm_llr = -1.85 + prot_re_vesm + float(rng.normal(0.0, 0.95))

                # Entropy: mildly lower in pathogenic (AUROC ~ 0.65); ~8% flat (>= 4.1058)
                is_flat_draw = rng.random() < 0.08
                if is_flat_draw:
                    ent_base = float(rng.uniform(4.11, 4.30))
                else:
                    ent_base = float(np.clip(rng.normal(2.1 if is_path else 2.6, 0.8), 0.1, 4.05))

                tok = "#" if rng.random() < 0.15 else str(rng.choice(THREEDI))

                for m_name, ckpt, method, llr_val, s_tok in [
                    ("ESM-2 650M", "facebook/esm2_t33_650M_UR50D", "masked-marginal", esm2_llr, ""),
                    ("SaProt 35M AF2", "westlake-repl/SaProt_35M_AF2", "masked-marginal", saprot_llr, tok),
                    ("VESM-150M", "ntranoslab/vesm VESM_150M", "wild-type-marginal", vesm_llr, ""),
                ]:
                    ent_m = float(np.clip(ent_base + rng.normal(0.0, 0.15), 0.05, 4.32))
                    if is_flat_draw:
                        ent_m = float(rng.uniform(4.11, 4.31))
                    wt_logp = float(rng.uniform(-2.0, -0.05))
                    mut_logp = wt_logp + llr_val
                    wt_rank = int(rng.integers(1, 5)) if llr_val < -0.5 else int(rng.integers(3, 15))
                    mut_rank = int(np.clip(wt_rank + round(-llr_val * 2.0), 1, 20))
                    score_rows.append(
                        {
                            "uniprot_id": uid,
                            "pos": pos,
                            "wt": wt,
                            "mut": mut,
                            "label": cls,
                            "label_source": "synthetic_clinvar" if cls != "gnomad_common" else "synthetic_gnomad",
                            "model": m_name,
                            "checkpoint": ckpt,
                            "scoring_method": method,
                            "llr": round(llr_val, 6),
                            "wt_logp": round(wt_logp, 6),
                            "mut_logp": round(mut_logp, 6),
                            "wt_rank": wt_rank,
                            "mut_rank": mut_rank,
                            "entropy_bits": round(ent_m, 6),
                            "structure_token": s_tok,
                            "sequence_length": seq_len,
                            "truncated": truncated,
                        }
                    )

                # Embedding shift: null/near-chance signal (AUROC ~ 0.52) to exercise Q6 removal rule
                emb_rows.append(
                    {
                        "uniprot_id": uid,
                        "pos": pos,
                        "wt": wt,
                        "mut": mut,
                        "model": "VESM-150M",
                        "shift_at_site": round(float(rng.normal(0.35 + (0.02 if is_path else 0.0), 0.25)), 6),
                        "shift_window_mean": round(float(rng.normal(0.18 + (0.01 if is_path else 0.0), 0.12)), 6),
                    }
                )

                variant_rows.append({"uniprot_id": uid, "pos": pos, "wt": wt, "mut": mut, "label": cls})

    pd.DataFrame(score_rows).to_csv(out_dir / "scores.csv", index=False)
    pd.DataFrame(am_rows).to_csv(out_dir / "alphamissense.csv", index=False)
    pd.DataFrame(emb_rows).to_csv(out_dir / "embedding_shift.csv", index=False)

    return {
        "n_proteins": n_proteins,
        "n_variants": len(variant_rows),
        "n_score_rows": len(score_rows),
    }


def verify_outputs(out_dir: Path) -> None:
    summary_path = out_dir / "summary.json"
    assert summary_path.exists(), f"Missing {summary_path}"
    s = json.loads(summary_path.read_text(encoding="utf-8"))

    # Q1: Benign/gnomAD rates >= 0.50 by construction -> must flag not discriminative
    assert s["q1"]["decision_all_favour_native_not_discriminative"] is True, "Expected Q1 to flag not discriminative"
    ben_all = s["q1"]["per_class"]["benign"]["all_favour_native"]["rate"]
    print(f"[PASS] Q1 benign all_favour_native = {ben_all:.3f}, flagged not discriminative.")

    # Q2: Verify planted AUROCs recovered
    esm2_auc = s["q2"]["ESM-2 650M"]["pathogenic vs benign"]["overall"]["auroc"]
    saprot_auc = s["q2"]["SaProt 35M AF2"]["pathogenic vs benign"]["overall"]["auroc"]
    vesm_auc = s["q2"]["VESM-150M"]["pathogenic vs benign"]["overall"]["auroc"]
    assert 0.74 <= esm2_auc <= 0.88, f"Unexpected ESM-2 AUROC: {esm2_auc}"
    assert 0.65 <= saprot_auc <= 0.80, f"Unexpected SaProt AUROC: {saprot_auc}"
    assert 0.43 <= vesm_auc <= 0.57, f"Unexpected VESM chance AUROC: {vesm_auc}"

    bal_k = s["q2"]["ESM-2 650M"]["pathogenic vs benign"]["per_protein_balanced"]["k_proteins"]
    assert bal_k == 50, f"Expected 50 qualifying proteins for balanced AUROC, got {bal_k}"

    th = s["q2"]["ESM-2 650M"]["pathogenic vs benign"]["thresholds"]
    assert th["spec95_spec"] >= 0.95 - 1e-9, f"Spec95 violated: {th['spec95_spec']}"
    print(
        f"[PASS] Q2 recovered AUROCs: ESM-2={esm2_auc:.3f}, SaProt={saprot_auc:.3f}, "
        f"VESM={vesm_auc:.3f}; K_bal={bal_k}; Spec95={th['spec95_spec']:.3f}"
    )

    # Q3: ESM-2 adds significant value over AM; VESM does not
    cmps = s["q3"]["tasks"]["pathogenic vs benign"]["comparisons"]
    assert cmps["AM + ESM-2 650M"]["significant_gain"] is True, f"Expected ESM-2 gain over AM: {cmps['AM + ESM-2 650M']}"
    assert cmps["AM + VESM-150M"]["significant_gain"] is False, f"Expected no VESM gain over AM: {cmps['AM + VESM-150M']}"
    print(
        f"[PASS] Q3 dAUROC: +ESM-2={cmps['AM + ESM-2 650M']['delta_auroc']:.4f} "
        f"[{cmps['AM + ESM-2 650M']['delta_ci_low']:.4f}, {cmps['AM + ESM-2 650M']['delta_ci_high']:.4f}], "
        f"+VESM={cmps['AM + VESM-150M']['delta_auroc']:.4f}"
    )

    # Q4 & Q5
    q4_pv = s["q4"]["tasks"]["pathogenic vs benign"]
    assert q4_pv["best_single_model"] == "ESM-2 650M", f"Expected ESM-2 best single, got {q4_pv['best_single_model']}"
    q5_esm2 = s["q5"]["ESM-2 650M"]["pathogenic vs benign"]["auroc"]
    assert 0.58 <= q5_esm2 <= 0.75, f"Unexpected entropy AUROC: {q5_esm2}"
    print(f"[PASS] Q4 best={q4_pv['best_single_model']}; Q5 entropy AUROC={q5_esm2:.3f}")

    # Q6: Embedding shift should trigger removal recommendation
    assert s["q6"]["decision"] == "RECOMMEND_REMOVE_EMBEDDINGS_SUBTAB", f"Unexpected Q6 decision: {s['q6']}"
    print(f"[PASS] Q6 decision={s['q6']['decision']}")

    # Q7: Reference JSONs
    for slug in ["esm2_650m", "saprot_35m_af2", "vesm_150m"]:
        rf = out_dir / f"reference_{slug}.json"
        assert rf.exists(), f"Missing {rf}"
        rj = json.loads(rf.read_text(encoding="utf-8"))
        assert rj["histogram_spec"]["n_bins"] == 41
        assert len(rj["histogram_spec"]["edges"]) == 42
        for cls in ["pathogenic", "benign", "gnomad_common"]:
            c = rj["classes"][cls]
            assert c["n"] == 450
            assert sum(c["histogram"]["counts"]) == c["n"]
            qs = [c["quantiles"][str(k)] for k in [1, 5, 10, 25, 50, 75, 90, 95, 99]]
            assert all(qs[i] <= qs[i + 1] for i in range(len(qs) - 1)), f"Non-monotonic quantiles in {rf}"
    print("[PASS] Q7 reference JSONs validated (41 bins, sum==n, monotonic quantiles).")
    print("[PASS] All synthetic validation checks passed!")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic benchmark data and optionally verify analyze.py.")
    parser.add_argument("--out-dir", type=Path, default=Path("logs/perturbation_bench/synthetic"))
    parser.add_argument("--verify", action="store_true", help="Run analyze.py on synthetic data and assert recovery.")
    args = parser.parse_args()

    info = generate_synthetic_dataset(args.out_dir)
    print(f"Generated synthetic dataset in {args.out_dir}: {info}")

    if args.verify:
        analyze_script = Path(__file__).with_name("analyze.py")
        cmd = [
            sys.executable,
            str(analyze_script),
            "--input-dir",
            str(args.out_dir),
            "--output-dir",
            str(args.out_dir),
            "--skip-fetch-am",
            "--synthetic",
        ]
        subprocess.run(cmd, check=True)
        verify_outputs(args.out_dir)


if __name__ == "__main__":
    main()
