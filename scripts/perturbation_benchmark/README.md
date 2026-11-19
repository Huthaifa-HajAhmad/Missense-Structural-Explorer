# Perturbation benchmark — research record

The pre-registered benchmark behind `doc/PROTEIN_LANGUAGE_MODELS_DECISION.md`. `PLAN.md` holds the plan
and the decision rules fixed before any scoring; `score.py`, `analyze.py` and `make_synthetic.py` produced
the numbers quoted in the decision.

`score.py` imports the model server's own scoring code (`tools/model_server_app/routers/esm2.py`,
`saprot.py`, `vesm.py`, `utils.py`, `models.py`). That code was deleted when the models were retired, so
the scripts do not run on later commits. To rerun the benchmark, check out the whole repository at the
last commit before the change titled "stop running retired language models" (on `main`, the parent of
that merge; on its review branch, commit `777f24bb`). That commit has both these scripts and the scoring
code they import.
