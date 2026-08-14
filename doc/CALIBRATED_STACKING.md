# Calibrated Biophysical Stacking & Conformal Prediction Intervals

This document outlines the calibration methodology, datasets, and mathematical formulations used to evaluate missense variant biophysical stability in MissenseResolve.

## 1. Datasets

### Training Dataset: Mega-scale ddG (Tsuboyama et al. 2023)
* **Citation**: Tsuboyama, K. et al. Mega-scale experimental analysis of protein folding stability in biology and design. *Nature* (2023).
* **Details**: Contains over 776,000 $\Delta\Delta G$ experimental measurements across 776 structural domains, providing dense coverage of variant space.
* **Target Mapping**: We map experimental $\Delta\Delta G$ values to binary stability classes where $Y = 1$ (destabilizing) if experimental $\Delta\Delta G \ge 1.0\text{ kcal/mol}$ (or $1.5\text{ kcal/mol}$ depending on local thresholds), and $Y = 0$ (neutral/stable) otherwise.

### Validation Dataset: S669
* **Citation**: S669 is a curated benchmark dataset of 669 variants across 94 proteins with high-quality experimental $\Delta\Delta G$ measurements.
* **Details**: Used strictly as a hold-out validation set to assess generalization and calibrate final conformal prediction intervals.

### Homology-Aware Leakage Prevention
To prevent optimistic bias in validation metrics, sequence redundancy reduction is applied:
* We run CD-HIT or MMseqs2 on all protein sequences in the training set (Mega-scale).
* We drop any protein domain sequence from the training partition that shares $>30\%$ sequence identity with any of the 94 S669 validation proteins.

---

## 2. Stacking & Calibration Mathematical Formulation

Rather than a simple confidence-weighted vote on binary verdicts, we implement a two-stage calibrated consensus:

### Stage 1: Individual Tool Isotonic Calibration
For each tool $i \in \{\text{FoldX}, \text{DynaMut2}, \text{DDMut}, \text{RaSP}, \text{ThermoMPNN}\}$, we fit a non-parametric isotonic regression function $f_i(x_i) \to [0, 1]$ mapping the raw $\Delta\Delta G$ output $x_i$ to a probability of destabilization.
* **Why**: Isotonic regression is monotonic and handles highly non-linear or bounded distributions (like FoldX steric clash penalties) without requiring normality.

### Stage 2: Dynamic Probability Averaging (Handling Missingness)
If a subset of tools $\mathcal{A}$ completes, we compute the consensus probability $\bar{P}$ as a weighted average of their calibrated probabilities:
$$ \bar{P} = \frac{\sum_{i \in \mathcal{A}} w_i f_i(x_i)}{\sum_{i \in \mathcal{A}} w_i} $$
where $w_i$ is the relative validation accuracy weight of tool $i$ (based on balanced accuracy on the S669 validation set):
* **FoldX**: 1.2
* **DynaMut2**: 1.0
* **DDMut**: 1.0
* **RaSP**: 1.5
* **ThermoMPNN**: 2.0

### Conformal Prediction Intervals (Venn-ABERS)
Venn-ABERS calibration maps the stacked probability to a mathematically guaranteed conformal interval $[P_{\text{min}}, P_{\text{max}}]$:
* **$P_{\text{min}}$** is the lower bound (calibrated probability under the hypothesis that $Y=0$).
* **$P_{\text{max}}$** is the upper bound (calibrated probability under the hypothesis that $Y=1$).
* The width of the interval $P_{\text{max}} - P_{\text{min}}$ reflects the **epistemic uncertainty** of the prediction, which increases when tools conflict or when fewer tools are available.
